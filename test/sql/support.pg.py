import pgserver, psycopg2, sys, re, os, uuid
srv = pgserver.get_server('/tmp/pgdata_rw8', cleanup_mode='delete')
uri = srv.get_uri()
conn = psycopg2.connect(uri); conn.autocommit = True; cur = conn.cursor()
# a minimal stand-in for what Supabase provides
cur.execute("""
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to authenticated, anon;
grant usage on schema public to authenticated, anon; grant usage on schema auth to authenticated, anon;
""")
ok_all = True
for f in ['platform.sql','platform2.sql','report_rewards.sql','support.sql','support.sql']:
    sql = open('/tmp/ph/supabase/'+f).read()
    try:
        cur.execute(sql); print('loaded', f)
    except Exception as e:
        print('LOAD FAILED', f, '->', str(e).strip().split('\n')[0]); ok_all = False; break
if not ok_all: sys.exit(1)

import psycopg2, uuid
bad = 0
def ok(n, c, x=''):
    global bad
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  -> ' + str(x)))
    if not c: bad += 1
def as_(u):   # act as this user, with the same role Supabase gives a signed-in person
    cur.execute("reset role"); cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(u) if u else '',)); cur.execute("set role authenticated")
def admin(): cur.execute("reset role")
def one(q, a=()): cur.execute(q, a); r = cur.fetchone(); return r[0] if r else None
def mkuser(name):
    admin(); u = uuid.uuid4(); cur.execute("insert into auth.users(id,email) values (%s,%s)", (str(u), name + '@x.y')); 
    cur.execute("insert into public.pholama_profiles (user_id, platform_name) values (%s,%s)", (str(u), name)); return u
def mkpost(author, body='bad post'):
    admin(); p = uuid.uuid4(); author = mkuser('a' + uuid.uuid4().hex[:8]) if author == FRESH else author; cur.execute("insert into public.pholama_posts (id,user_id,community,body) values (%s,%s,(select slug from public.pholama_communities limit 1),%s)", (str(p), str(author), body)); return p
def report(user, post):
    as_(user); cur.execute("insert into public.pholama_reports (post_id, reporter, reason) values (%s,%s,'spam')", (str(post), str(user)))
admin()
cur.execute('grant select, insert, update, delete on all tables in schema public to authenticated, anon'); cur.execute('grant usage on all sequences in schema public to authenticated')
cur.execute("select count(*) from public.pholama_communities"); 
if one("select count(*) from public.pholama_communities") == 0: cur.execute("insert into public.pholama_communities (slug,name) values ('general','General') on conflict do nothing")
mod = mkuser('mod'); admin(); cur.execute("insert into public.pholama_moderators(user_id) values (%s)", (str(mod),))
author = mkuser('author'); alice = mkuser('alice'); bob = mkuser('bob'); carol = mkuser('carol'); dave = mkuser('dave')
FRESH = 'fresh'
def waiting(u): as_(u); return one("select public.pholama_my_rewards()")

# 1. reported, mod deletes -> reporter paid 100
p1 = mkpost(author); report(alice, p1)
ok('before any removal nothing is owed', waiting(alice) == 0, waiting(alice))
as_(mod); cur.execute("select public.pholama_mod_remove(%s)", (str(p1),))
ok('mod deletes a reported post: reporter earns 100', waiting(alice) == 100, waiting(alice))

# 2. reported, mod takes down (hide) -> paid
p2 = mkpost(author); report(bob, p2)
as_(mod); cur.execute("select public.pholama_mod_hide(%s, true)", (str(p2),))
ok('mod takes a reported post down: reporter earns 100', waiting(bob) == 100, waiting(bob))
as_(mod); cur.execute("select public.pholama_mod_hide(%s, true)", (str(p2),))
ok('taking it down twice does not pay twice', waiting(bob) == 100, waiting(bob))
as_(mod); cur.execute("select public.pholama_mod_hide(%s, false)", (str(p2),)); as_(mod); cur.execute("select public.pholama_mod_hide(%s, true)", (str(p2),))
ok('restore then take down again does not pay again', waiting(bob) == 100, waiting(bob))

# 3. you never earn from your own post
p3 = mkpost(carol); report(carol, p3)
as_(mod); cur.execute("select public.pholama_mod_remove(%s)", (str(p3),))
ok('reporting your OWN post earns nothing', waiting(carol) == 0, waiting(carol))

# 4. three reports auto-hide but that alone pays nobody
p4 = mkpost(author); report(alice, p4); report(bob, p4); report(dave, p4)
admin(); hidden = one("select hidden from public.pholama_posts where id=%s", (str(p4),))
ok('three reports auto-hide the post', hidden is True, hidden)
ok('auto-hide alone pays nothing new', waiting(dave) == 0 and waiting(alice) == 100, (waiting(dave), waiting(alice)))
as_(mod); cur.execute("select public.pholama_mod_hide(%s, true)", (str(p4),))
ok('once a moderator confirms, all three reporters are paid', waiting(dave) == 100 and waiting(bob) == 200 and waiting(alice) == 200, (waiting(dave), waiting(bob), waiting(alice)))

# 5. a ban sweep deletes posts but pays nothing
p5 = mkpost(dave); report(alice, p5)
admin(); before = one("select coalesce(sum(credits),0) from public.pholama_rewards")
as_(mod); cur.execute("select public.pholama_mod_ban(%s, true)", (str(dave),))
admin(); after = one("select coalesce(sum(credits),0) from public.pholama_rewards")
ok('banning someone (which deletes their posts) pays nothing', before == after, (before, after))

# 6. non-moderators cannot trigger payment or call internals
as_(alice)
for fn, args in [("pholama_mod_remove", ("%s",)), ("pholama_pay_reporters", ("%s",))]:
    p = mkpost(FRESH); report(bob, p); as_(alice)
    try: cur.execute(f"select public.{fn}(%s)", (str(p),)); err = None
    except Exception as e: err = str(e).strip().split('\n')[0]
    ok(f'a normal user cannot call {fn}', err is not None, 'it ran')
as_(alice)
try: cur.execute("insert into public.pholama_rewards (post_id,reporter,credits) values (%s,%s,100)", (str(uuid.uuid4()), str(alice))); err = None
except Exception as e: err = str(e).strip().split('\n')[0]
ok('nobody can write themselves a reward directly', err is not None, 'insert worked')
try: cur.execute("update public.pholama_rewards set credits=100, claimed_at=null"); n = cur.rowcount
except Exception as e: n = -1
ok('nobody can edit rewards', n <= 0, n)
try: cur.execute("delete from public.pholama_rewards"); n2 = cur.rowcount
except Exception as e: n2 = -1
ok('nobody can delete rewards', n2 <= 0, n2)

# 7. you only see your own reward
as_(alice); cur.execute("select count(*) from public.pholama_rewards"); mine = cur.fetchone()[0]
admin(); total = one("select count(*) from public.pholama_rewards"); cur.execute("select count(*) from public.pholama_rewards where reporter is not null")
ok('you can only read your own rewards', mine < total, (mine, total))

# 8. claiming: once, and across devices
as_(alice); got = one("select public.pholama_claim_rewards()"); again = one("select public.pholama_claim_rewards()")
ok('claiming returns what was waiting, exactly once', got == 200 and again == 0, (got, again))
ok('nothing left waiting after a claim', waiting(alice) == 0)

# 9. late reporter: a report made AFTER removal cannot earn (post is gone / already removed)
p9 = mkpost(FRESH); report(bob, p9); as_(mod); cur.execute("select public.pholama_mod_remove(%s)", (str(p9),))
late = uuid.uuid4(); 
admin(); cur.execute("insert into auth.users(id,email) values (%s,'late@x.y')", (str(late),))
as_(late)
try: cur.execute("insert into public.pholama_reports (post_id, reporter, reason) values (%s,%s,'spam')", (str(p9), str(late))); err = None
except Exception as e: err = 'blocked'
ok('reporting a post that is already removed is impossible', err is not None)
ok('and earns nothing', waiting(late) == 0)

# 10. daily cap: 5 rewards in a day max per person (500)
spam = mkuser('spammer'); paid = 0
for i in range(8):
    pp = mkpost(FRESH); report(spam, pp); as_(mod); cur.execute("select public.pholama_mod_remove(%s)", (str(pp),))
ok('report farming is capped at 500 credits a day', waiting(spam) == 500, waiting(spam))


# ================= support tickets, grants, unwarn, terminal =================
def fails(q, a=()):
    try: cur.execute(q, a); return None
    except Exception as e: return str(e).strip().split('\n')[0]
def ticket(user, subj='Help me', cat='other', body='please help'):
    as_(user); cur.execute("select public.pholama_ticket_open(%s,%s,%s)", (subj, cat, body)); return cur.fetchone()[0]
def status(t): admin(); return one("select status from public.pholama_tickets where id=%s", (str(t),))
def msgs(t): admin(); cur.execute("select from_mod, body from public.pholama_ticket_messages where ticket_id=%s order by id", (str(t),)); return cur.fetchall()

u1 = mkuser('tina'); u2 = mkuser('tom'); 
t1 = ticket(u1)
ok('a person can open a ticket', status(t1) == 'open', status(t1))
ok('their message is stored as NOT from a moderator', msgs(t1) == [(False, 'please help')], msgs(t1))
as_(u2); cur.execute("select count(*) from public.pholama_tickets where id=%s", (str(t1),))
ok('another person cannot see the ticket', cur.fetchone()[0] == 0)
as_(u2); cur.execute("select count(*) from public.pholama_ticket_messages where ticket_id=%s", (str(t1),))
ok('or its messages', cur.fetchone()[0] == 0)
as_(mod); cur.execute("select count(*) from public.pholama_tickets where id=%s", (str(t1),))
ok('a moderator can see it', cur.fetchone()[0] == 1)
as_(u2); e = fails("select public.pholama_ticket_say(%s,'hi from a stranger')", (str(t1),))
ok('a stranger cannot write on it', e is not None, e)
as_(mod); cur.execute("select public.pholama_ticket_say(%s,'Hi Tina, fixed')", (str(t1),))
ok('a moderator reply marks it answered', status(t1) == 'answered', status(t1))
ok('and the reply is marked as from a moderator', msgs(t1)[-1] == (True, 'Hi Tina, fixed'), msgs(t1))
as_(u1); cur.execute("select public.pholama_ticket_say(%s,'thanks, one more thing')", (str(t1),))
ok('the owner can follow up, which reopens it', status(t1) == 'open', status(t1))
ok('and that follow up is NOT marked as moderator', msgs(t1)[-1][0] is False, msgs(t1))
# nobody can insert directly to fake a moderator message
as_(u1); e = fails("insert into public.pholama_ticket_messages (ticket_id, author, from_mod, body) values (%s,%s,true,'I am a mod')", (str(t1), str(u1)))
ok('a person cannot write a fake moderator message directly', e is not None, e)
as_(u1); e = fails("update public.pholama_tickets set status='closed' where id=%s", (str(t1),)); st = status(t1)
ok('a person cannot close or edit tickets directly', st == 'open', st)
as_(u1); e = fails("select public.pholama_ticket_close(%s)", (str(t1),))
ok('a person cannot call close', e is not None, e)
as_(mod); cur.execute("select public.pholama_ticket_close(%s)", (str(t1),))
ok('a moderator can close', status(t1) == 'closed', status(t1))
as_(mod); e = fails("select public.pholama_ticket_say(%s,'late')", (str(t1),))
ok('nobody can write on a closed ticket', e is not None, e)
as_(mod); cur.execute("select public.pholama_ticket_close(%s,false)", (str(t1),))
ok('a moderator can reopen', status(t1) == 'open', status(t1))

# limits
u3 = mkuser('limit'); ticket(u3,'one'); ticket(u3,'two'); ticket(u3,'three')
as_(u3); e = fails("select public.pholama_ticket_open('four','other','x')")
ok('max 3 open tickets per person', e is not None and '3 open' in e, e)
as_(u3); e = fails("select public.pholama_ticket_open('x','other','')")
ok('an empty message is refused', e is not None, e)
as_(None); e = fails("select public.pholama_ticket_open('Anon ticket','other','hello')")
ok('signed out people cannot open tickets', e is not None, e)

# a banned person can still appeal, but only with a "ban" ticket
u4 = mkuser('banned1'); as_(mod); cur.execute("select public.pholama_mod_ban(%s,true,'test',null)", (str(u4),))
as_(u4); e = fails("select public.pholama_ticket_open('Let me in','other','please')")
ok('a banned person cannot open a normal ticket', e is not None, e)
tb = ticket(u4, 'Appeal my ban', 'ban', 'I am sorry')
ok('but can open a ban appeal', status(tb) == 'open', status(tb))
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('unban ' + str(u4),))
admin(); ok('a moderator can unban them', one("select public.pholama_is_banned(%s)", (str(u4),)) is False)

# credit grants
u5 = mkuser('gift')
as_(mod); cur.execute("select public.pholama_mod_credits(%s,150,'thanks for the bug report')", (str(u5),))
ok('a moderator can give credits', waiting(u5) == 150, waiting(u5))
as_(mod); e = fails("select public.pholama_mod_credits(%s,501,'too much')", (str(u5),)); ok('max 500 per grant', e is not None, e)
as_(mod); e = fails("select public.pholama_mod_credits(%s,0,'zero')", (str(u5),)); ok('zero is refused', e is not None, e)
as_(mod); e = fails("select public.pholama_mod_credits(%s,10,'me')", (str(mod),)); ok('a moderator cannot give to themselves', e is not None, e)
as_(u5); e = fails("select public.pholama_mod_credits(%s,500,'self')", (str(u5),)); ok('a normal person cannot give credits', e is not None, e)
as_(u5); e = fails("insert into public.pholama_credit_grants (user_id, credits, reason) values (%s,500,'x')", (str(u5),)); ok('nobody can write a grant directly', e is not None, e)
as_(u5); got = one("select public.pholama_claim_rewards()"); again = one("select public.pholama_claim_rewards()")
ok('the grant is claimed exactly once', got == 150 and again == 0, (got, again))
# daily limit per moderator: 4 x 500 = 2000 then stop
m2 = mkuser('mod2'); admin(); cur.execute("insert into public.pholama_moderators(user_id) values (%s)", (str(m2),))
tgt = mkuser('target')
for i in range(4): as_(m2); cur.execute("select public.pholama_mod_credits(%s,500,'bulk')", (str(tgt),))
as_(m2); e = fails("select public.pholama_mod_credits(%s,1,'one more')", (str(tgt),))
ok('a moderator can give at most 2000 credits a day', e is not None and '2000' in e, e)
# rewards and grants combine
u6 = mkuser('both'); p = mkpost(FRESH); report(u6, p); as_(mod); cur.execute("select public.pholama_mod_remove(%s)", (str(p),)); as_(mod); cur.execute("select public.pholama_mod_credits(%s,50,'bonus')", (str(u6),))
ok('report reward and moderator grant add up in one claim', waiting(u6) == 150, waiting(u6))
as_(u6); ok('and one claim collects both', one("select public.pholama_claim_rewards()") == 150)

# unwarn
u7 = mkuser('warned'); as_(mod); cur.execute("select public.pholama_mod_warn(%s,'first')", (str(u7),)); as_(mod); cur.execute("select public.pholama_mod_warn(%s,'second')", (str(u7),))
admin(); ok('two warnings exist', one("select count(*) from public.pholama_warnings where user_id=%s", (str(u7),)) == 2)
as_(mod); cur.execute("select public.pholama_mod_unwarn(%s)", (str(u7),))
admin(); ok('unwarn removes the newest one only', one("select count(*) from public.pholama_warnings where user_id=%s", (str(u7),)) == 1)
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('unwarn ' + str(u7) + ' all',))
admin(); ok('unwarn all clears them', one("select count(*) from public.pholama_warnings where user_id=%s", (str(u7),)) == 0)
as_(u7); e = fails("select public.pholama_mod_unwarn(%s)", (str(u7),)); ok('a person cannot remove their own warnings', e is not None, e)
admin(); ok('the mod log remembers the unwarn', one("select count(*) from public.pholama_mod_log where action='unwarn'") >= 2)

# terminal
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('tickets',)); out = cur.fetchone()[0]
ok('terminal: tickets lists open tickets', 'Help me' in out or 'one' in out, out)
short = str(t1)[:8]
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('reply ' + short + ' Working on it',)); 
ok('terminal: reply writes a moderator message', msgs(t1)[-1] == (True, 'Working on it'), msgs(t1)[-1])
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('close ' + short,)); ok('terminal: close closes it', status(t1) == 'closed', status(t1))
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('reopen ' + short,)); ok('terminal: reopen reopens it', status(t1) == 'open', status(t1))
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('give ' + str(u5) + ' 25 nice work',)); ok('terminal: give adds credits', waiting(u5) == 25, waiting(u5))
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('warn ' + str(u7) + ' old command still works',)); admin(); ok('terminal: the OLD commands still work (warn)', one("select count(*) from public.pholama_warnings where user_id=%s", (str(u7),)) == 1)
as_(mod); cur.execute("select public.pholama_mod_cmd(%s)", ('help',)); ok('terminal: help still works', 'Commands' in cur.fetchone()[0])
as_(u1); e = fails("select public.pholama_mod_cmd('tickets')"); ok('a normal person cannot use the terminal', e is not None, e)
as_(u1); e = fails("select public.pholama_mod_cmd_base('help')"); ok('nor the hidden base command', e is not None, e)

admin(); cur.execute("select count(*), coalesce(sum(credits),0) from public.pholama_rewards"); n_rows, tot = cur.fetchone()
ok('reward rows survived the edit/delete attempts (data really intact)', n_rows >= 10 and tot >= 1000, (n_rows, tot))
print('ALL PASSED' if not bad else f'{bad} FAILED'); 
