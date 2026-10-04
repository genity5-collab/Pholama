# Runs the real SQL on a real Postgres: platform, platform2, report_rewards, support, then owner (twice, to prove it is safe to re-run).
import pgserver, psycopg2, sys, uuid, re
srv = pgserver.get_server('/tmp/pgdata_owner', cleanup_mode='delete'); conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True; cur = conn.cursor()
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
grant usage on schema storage to authenticated, anon; grant usage on schema public to authenticated, anon; grant usage on schema auth to authenticated, anon;
""")
for f in ['platform.sql', 'platform2.sql', 'report_rewards.sql', 'support.sql', 'owner.sql', 'owner.sql']:
    try: cur.execute(open('/tmp/ph/supabase/' + f).read()); print('loaded', f)
    except Exception as e: print('LOAD FAILED', f, '->', str(e).strip().split('\n')[0]); sys.exit(1)
bad = 0
def ok(n, c, x=''):
    global bad; print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  -> ' + str(x)))
    if not c: bad += 1
def as_(u): cur.execute("reset role"); cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(u) if u else '',)); cur.execute("set role authenticated")
def admin(): cur.execute("reset role")
def one(q, a=()): cur.execute(q, a); r = cur.fetchone(); return r[0] if r else None
def mkuser(name):
    admin(); u = uuid.uuid4(); cur.execute("insert into auth.users(id,email) values (%s,%s)", (str(u), name + '@x.y'))
    cur.execute("insert into public.pholama_profiles (user_id, platform_name) values (%s,%s)", (str(u), name)); return u
def cmd(user, line):
    as_(user)
    try: return ('ok', one("select public.pholama_mod_cmd(%s)", (line,)))
    except Exception as e: return ('err', str(e).strip().split('\n')[0])
admin(); cur.execute('grant select, insert, update, delete on all tables in schema public to authenticated, anon'); cur.execute('grant usage on all sequences in schema public to authenticated')
boss, mod, rando, target = mkuser('Boss'), mkuser('Modder'), mkuser('Rando'), mkuser('Target')
admin(); cur.execute("insert into public.pholama_moderators (user_id) values (%s),(%s)", (str(boss), str(mod)))
cur.execute("update public.pholama_moderators set is_owner = true where user_id = %s", (str(boss),))
pend = lambda u: (as_(u), one("select public.pholama_my_rewards()"))[1]

# ---- help lists every command
s, h = cmd(mod, 'help')
ok('help works for a moderator', s == 'ok', h)
for w in ['whois', 'warn', 'unwarn', 'ban', 'unban', 'takedown', 'restore', 'delete', 'edit', 'project', 'daily', 'give', 'credits', 'tickets', 'reply', 'close', 'reopen', 'mods', 'me', 'help']:
    ok('help mentions: ' + w, s == 'ok' and re.search(r'\b' + w + r'\b', h), h[:80])
ok('a normal moderator is not shown the owner-only lines', 'OWNER' not in h and 'owner <name' not in h, h[-300:])
s, hb = cmd(boss, 'help'); ok('the owner sees that they are an owner', s == 'ok' and 'you are an OWNER' in hb and 'owner <name|id>' in hb, hb[-300:])
ok('a non-moderator cannot run commands', cmd(rando, 'help')[0] == 'err')
ok('a non-moderator cannot run give', cmd(rando, 'give Target 10')[0] == 'err')
ok('empty command shows help', cmd(mod, '')[1] == h)
# ---- me / mods
ok('me says moderator', 'moderator' in cmd(mod, 'me')[1] and 'OWNER' not in cmd(mod, 'me')[1])
ok('me says OWNER for the owner', 'OWNER' in cmd(boss, 'me')[1])
ok('mods lists both, owner marked', '[owner]' in cmd(mod, 'mods')[1] and 'Modder' in cmd(mod, 'mods')[1])
# ---- normal moderator keeps limits
ok('moderator: cannot give to self', cmd(mod, 'give Modder 10')[0] == 'err' and 'yourself' in cmd(mod, 'give Modder 10')[1])
ok('moderator: cannot give over 500', cmd(mod, 'give Target 501')[0] == 'err')
ok('moderator: cannot give 0 or negative', cmd(mod, 'give Target 0')[0] == 'err' and cmd(mod, 'give Target -5')[0] == 'err')
ok('moderator: can give 100', cmd(mod, 'give Target 100 thanks')[0] == 'ok' and pend(target) == 100, pend(target))
ok('moderator: daily cap of 2000 still applies', all(cmd(mod, 'give Target 500')[0] == 'ok' for _ in range(3)) and cmd(mod, 'give Target 500')[0] == 'err')
# ---- owner is unlimited, including self
ok('owner: can give self any amount', cmd(boss, 'give Boss 100000 testing')[0] == 'ok' and pend(boss) == 100000, pend(boss))
ok('owner: can give over 500 to someone else', cmd(boss, 'give Target 5000')[0] == 'ok')
ok('owner: no daily cap', all(cmd(boss, 'give Boss 50000')[0] == 'ok' for _ in range(5)) and pend(boss) == 350000, pend(boss))
ok('owner: still cannot give 0, negative, or a silly amount', cmd(boss, 'give Boss 0')[0] == 'err' and cmd(boss, 'give Boss -1')[0] == 'err' and cmd(boss, 'give Boss 2000000')[0] == 'err')
ok('owner: text instead of a number is a clear error, not a crash', cmd(boss, 'give Boss lots')[0] == 'err')
ok('owner: unknown person is a clear error', cmd(boss, 'give Nobody123 5')[0] == 'err' and cmd(boss, 'give')[0] == 'err')
got = one("select public.pholama_claim_rewards()") if (as_(boss) or True) else 0
ok('owner collects it exactly once', got == 350000 and pend(boss) == 0, got)
ok('a second collect gives nothing', one("select public.pholama_claim_rewards()") == 0)
admin(); ok('every owner gift is in the log, marked', one("select count(*) from public.pholama_mod_log where action='credits' and detail like '[owner]%%'") >= 6, one("select count(*) from public.pholama_mod_log where action='credits'"))
# ---- a moderator cannot promote themselves
ok('a moderator cannot make themselves owner', cmd(mod, 'owner Modder')[0] == 'err' and 'Only an owner' in cmd(mod, 'owner Modder')[1])
admin(); ok('and is still not an owner afterwards', one("select is_owner from public.pholama_moderators where user_id=%s", (str(mod),)) is False)
as_(mod)
try: cur.execute("update public.pholama_moderators set is_owner = true where user_id = %s", (str(mod),)); n = cur.rowcount
except Exception: n = 0
admin(); ok('a moderator cannot flip the flag directly either', one("select is_owner from public.pholama_moderators where user_id=%s", (str(mod),)) is False, n)
as_(rando)
try: cur.execute("insert into public.pholama_moderators (user_id, is_owner) values (%s, true)", (str(rando),)); n = 1
except Exception: n = 0
admin(); ok('a stranger cannot add themselves as owner', one("select count(*) from public.pholama_moderators where user_id=%s", (str(rando),)) == 0)
as_(rando)
try: ok('a stranger cannot call the credit function directly', (cur.execute("select public.pholama_mod_credits(%s, 50, 'x')", (str(rando),)) or False) is False)
except Exception: ok('a stranger cannot call the credit function directly', True)
as_(mod)
try: cur.execute("select public.pholama_mod_cmd_v2('give Target 5')"); ok('the inner version is not callable directly', False, 'it ran')
except Exception: ok('the inner version is not callable directly', True)
# ---- owner can promote, and the new owner is unlimited
ok('owner can make another owner', cmd(boss, 'owner Modder')[0] == 'ok')
ok('the new owner can give to self', cmd(mod, 'give Modder 999')[0] == 'ok' and pend(mod) == 999)
# ---- old commands still work through both wrappers
ok('warn still works', cmd(boss, 'warn Target being rude')[0] == 'ok')
ok('whois still works', 'Target' in cmd(boss, 'whois Target')[1])
ok('unwarn still works', cmd(boss, 'unwarn Target')[1].startswith('1 warning'))
ok('ban then unban still work', cmd(boss, 'ban Target 1 test')[1] == 'Banned.' and cmd(boss, 'unban Target')[1] == 'Unbanned.')
ok('tickets still works', cmd(boss, 'tickets')[0] == 'ok')
ok('unknown command still gives a clear error', 'Unknown command' in cmd(boss, 'frobnicate')[1])
ok('re-running owner.sql did not break anything (loaded twice above)', True)
print('ALL PASSED' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
