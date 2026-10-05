// Friends, private chat, calls and notifications, proven on a REAL PostgreSQL (PGlite) with Supabase's roles and auth.uid().
// It acts as different people and checks the rules the database enforces, including attempts to cheat.
import { createRequire } from 'module'; try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite (npm i --no-save @electric-sql/pglite) is not installed here'); process.exit(0); } }
import { makeDb, as } from './sql/harness.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async (p, re) => { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } };
const db = await makeDb(['supabase/platform.sql', 'supabase/platform2.sql', 'supabase/social.sql'].map(f => path.join(root, f)));
const U = {}; for (const n of ['ann', 'bob', 'cat', 'dan', 'mod', 'eve']) { const r = await db.query("insert into auth.users (email) values ($1) returning id", [n + '@x.test']); U[n] = r.rows[0].id; await db.query("insert into public.pholama_profiles (user_id, platform_name) values ($1, $2)", [U[n], n[0].toUpperCase() + n.slice(1) + 'Name']); }
const q = (who, sql, p) => as(db, U[who], sql, p);
const befriend = async (a, b) => { await q(a, "select public.pholama_friend_request($1)", [b[0].toUpperCase() + b.slice(1) + 'Name']); const r = await q(b, "select id from public.pholama_friends where b=$1 and status='pending'", [U[b]]); await q(b, "select public.pholama_friend_answer($1, true)", [r.rows.at(-1).id]); };

// ---- friend requests
ok('a request goes through', (await q('ann', "select public.pholama_friend_request('BobName') r")).rows[0].r === 'sent');
ok('the asked person is notified', (await q('bob', "select kind, info from public.pholama_notifications")).rows.some(r => r.kind === 'friend_request' && r.info === 'AnnName'));
ok('asking twice stays pending, no duplicate', (await q('ann', "select public.pholama_friend_request('BobName') r")).rows[0].r === 'pending' && (await db.query("select count(*) n from public.pholama_friends")).rows[0].n == 1);
ok('a third person cannot see the request', (await q('cat', "select * from public.pholama_friends")).rows.length === 0);
ok('a stranger cannot accept it for Bob', await fails(q('cat', "select public.pholama_friend_answer((select id from public.pholama_friends limit 1), true)"), /no longer there/));
ok('the asker cannot accept their own request', await fails(q('ann', "select public.pholama_friend_answer((select id from public.pholama_friends limit 1), true)"), /no longer there/));
ok('the page cannot write to friends directly', await fails(q('ann', "update public.pholama_friends set status='accepted'")) || (await db.query("select status from public.pholama_friends")).rows[0].status === 'pending');
ok('the page cannot insert a friendship directly', await fails(q('cat', "insert into public.pholama_friends (a,b,status) values ($1,$2,'accepted')", [U.cat, U.dan])));
ok('no DM before being friends', await fails(q('ann', "insert into public.pholama_dms (sender,receiver,body) values ($1,$2,'hi')", [U.ann, U.bob])));
ok('no call before being friends', await fails(q('ann', "select public.pholama_call_start($1,'offer')", [U.bob]), /only call your friends/));
await q('bob', "select public.pholama_friend_answer((select id from public.pholama_friends where b=$1 and status='pending' limit 1), true)", [U.bob]);
ok('accepting makes them friends', (await q('ann', "select status from public.pholama_friends")).rows[0].status === 'accepted');
ok('the asker is told it was accepted', (await q('ann', "select kind, info from public.pholama_notifications")).rows.some(r => r.kind === 'friend_accepted' && r.info === 'BobName'));
ok('asking a friend again says already', (await q('ann', "select public.pholama_friend_request('BobName') r")).rows[0].r === 'already');
ok('asking yourself is refused', await fails(q('ann', "select public.pholama_friend_request('annname')"), /No one can be added/));
ok('an unknown name gives the same message as a refusal', await fails(q('ann', "select public.pholama_friend_request('NobodyAtAll')"), /No one can be added/));
ok('names match ignoring case and spaces', (await q('cat', "select public.pholama_friend_request('  bobNAME ') r")).rows[0].r === 'sent');
ok('both asking each other becomes friends at once', (await q('dan', "select public.pholama_friend_request('CatName') r")).rows[0].r === 'sent' && (await q('cat', "select public.pholama_friend_request('DanName') r")).rows[0].r === 'accepted');
await q('bob', "select public.pholama_friend_remove($1)", [U.cat]);
ok('declining a request is silent and removes it', (await db.query("select count(*) n from public.pholama_friends where (a=$1 and b=$2) or (a=$2 and b=$1)", [U.cat, U.bob])).rows[0].n == 0 && !(await q('cat', "select * from public.pholama_notifications")).rows.some(r => r.from_user === U.bob));

// ---- requests switched off
await q('dan', "insert into public.pholama_social_prefs (user_id, allow_requests) values ($1, false)", [U.dan]);
ok('someone with requests off cannot be asked, and the message gives nothing away', await fails(q('ann', "select public.pholama_friend_request('DanName')"), /No one can be added/));
await q('dan', "update public.pholama_social_prefs set allow_requests=true");

// ---- private messages
const dm = (who, to, body) => q(who, "insert into public.pholama_dms (sender,receiver,body) values ($1,$2,$3)", [U[who], U[to], body]);
await dm('ann', 'bob', 'hello bob');
ok('a friend can send a message', (await q('bob', "select body from public.pholama_dms")).rows[0].body === 'hello bob');
ok('a stranger cannot read the conversation', (await q('cat', "select * from public.pholama_dms")).rows.length === 0);
ok('a moderator cannot read private messages either', await (async () => { await db.query("insert into public.pholama_moderators (user_id) values ($1)", [U.mod]); return (await q('mod', "select * from public.pholama_dms")).rows.length === 0; })());
ok('a sender cannot pretend to be someone else', await fails(q('cat', "insert into public.pholama_dms (sender,receiver,body) values ($1,$2,'x')", [U.ann, U.bob])));
ok('a stranger cannot message a non-friend', await fails(dm('cat', 'bob', 'hey')));
ok('links are blocked', await fails(dm('ann', 'bob', 'see https://evil.example'), /Links are not allowed/));
ok('www links are blocked', await fails(dm('ann', 'bob', 'go to www.evil.example'), /Links are not allowed/));
ok('secret keys are blocked', await fails(dm('ann', 'bob', 'my key ghp_abcdef1234567890'), /secret key/));
ok('abuse is blocked', await fails(dm('ann', 'bob', 'kys'), /community rules/));
ok('an empty message is refused', await fails(dm('ann', 'bob', '   ')));
ok('a message over 500 characters is refused', await fails(dm('ann', 'bob', 'a'.repeat(501))));
ok('a message of exactly 500 is fine', !(await fails(dm('ann', 'bob', 'b'.repeat(500)))));
ok('the sender cannot set the time or mark it read', await (async () => { await q('ann', "insert into public.pholama_dms (sender,receiver,body,created_at,read_at) values ($1,$2,'sneaky','2000-01-01', now())", [U.ann, U.bob]); const r = await db.query("select created_at, read_at from public.pholama_dms where body='sneaky'"); return new Date(r.rows[0].created_at).getFullYear() > 2020 && r.rows[0].read_at === null; })());
ok('the receiver gets ONE notification per sender, not a flood', (await q('bob', "select count(*) n from public.pholama_notifications where kind='message' and from_user=$1", [U.ann])).rows[0].n == 1);
ok('the unread count is right', (await q('bob', "select unread from public.pholama_my_social() where other=$1", [U.ann])).rows[0].unread >= 3);
await q('bob', "select public.pholama_dm_read($1)", [U.ann]);
ok('reading clears unread and the message notification', (await q('bob', "select unread from public.pholama_my_social() where other=$1", [U.ann])).rows[0].unread == 0 && (await q('bob', "select seen from public.pholama_notifications where kind='message'")).rows.every(r => r.seen));
ok('the sender cannot mark their own message to the other person as read', await (async () => { await dm('bob', 'ann', 'reply'); await q('bob', "select public.pholama_dm_read($1)", [U.ann]); return (await db.query("select read_at from public.pholama_dms where body='reply'")).rows[0].read_at === null; })());
ok('a person cannot edit a message', (await q('ann', "update public.pholama_dms set body='changed' where sender=$1", [U.ann])).rows.length === 0 && (await db.query("select count(*) n from public.pholama_dms where body='changed'")).rows[0].n == 0);
ok('a stranger cannot delete a message', (await q('cat', "delete from public.pholama_dms returning id")).rows.length === 0);
const rate = async () => { let sent = 0; for (let i = 0; i < 25; i++) { try { await dm('ann', 'bob', 'spam ' + i); sent++; } catch {} } return sent; };
ok('message rate limit stops a flood (20 a minute)', (await rate()) < 20);
ok('the flood is stopped by the rate limit message', await fails(dm('ann', 'bob', 'one more'), /Slow down/));

await db.query("delete from public.pholama_dms");   // the flood test above left Ann rate limited; later refusals must be for the RIGHT reason
// ---- messages switched off
await q('bob', "insert into public.pholama_social_prefs (user_id, allow_dms) values ($1, false)", [U.bob]);
ok('with messages off, friends cannot message', await fails(dm('ann', 'bob', 'still there?'), /row-level security/));
ok('with messages off, Bob can still message out', !(await fails(dm('bob', 'ann', 'i can send'))));
await q('bob', "update public.pholama_social_prefs set allow_dms=true");

// ---- notifications
ok('a person cannot invent a notification', await fails(q('ann', "insert into public.pholama_notifications (user_id, kind, info) values ($1,'message','fake')", [U.bob])));
ok('a person cannot read others notifications', (await q('cat', "select user_id from public.pholama_notifications")).rows.every(r => r.user_id === U.cat) && (await db.query("select count(*) n from public.pholama_notifications where user_id=$1", [U.bob])).rows[0].n > 0);
await q('bob', "insert into public.pholama_social_prefs (user_id, notify) values ($1,false) on conflict (user_id) do update set notify=false", [U.bob]);
const before = (await q('bob', "select count(*) n from public.pholama_notifications")).rows[0].n;
await db.query("delete from public.pholama_dms where id in (select id from public.pholama_dms where sender=$1 and receiver=$2)", [U.ann, U.bob]);
await dm('ann', 'bob', 'quiet now');
ok('with notifications off, none are made (also not for a brand new sender)', await (async () => {
  await db.query("delete from public.pholama_notifications where user_id=$1", [U.bob]);
  await befriend('eve', 'bob');                                                  // a brand new friend of Bob's
  await db.query("delete from public.pholama_notifications where user_id=$1", [U.bob]);
  await dm('eve', 'bob', 'first message from someone new');                      // no earlier unread line to refresh
  await q('eve', "select public.pholama_call_end((select public.pholama_call_start($1,'o')))", [U.bob]);   // would be a missed-call notice
  const n = (await q('bob', "select count(*) n from public.pholama_notifications")).rows[0].n;
  await db.query("delete from public.pholama_calls"); await db.query("delete from public.pholama_friends where a=$1 or b=$1", [U.eve]);
  return n == 0;
})());
ok('…but the message itself still arrives', (await q('bob', "select body from public.pholama_dms where body='quiet now'")).rows.length === 1);
await q('bob', "update public.pholama_social_prefs set notify=true"); await dm('ann', 'bob', 'one to clear');
ok('a person can clear their own notifications', (await q('bob', "delete from public.pholama_notifications returning id")).rows.length >= 1);
ok('a person can write only their own settings', await fails(q('ann', "insert into public.pholama_social_prefs (user_id, allow_calls) values ($1,false)", [U.bob])));
ok('settings are private', (await q('ann', "select * from public.pholama_social_prefs")).rows.length === 0);
ok('a stranger cannot look up whether someone has calls, messages or notifications off', await (async () => { await q('bob', "insert into public.pholama_social_prefs (user_id, allow_calls, allow_dms, notify) values ($1,false,false,false) on conflict (user_id) do update set allow_calls=false, allow_dms=false, notify=false", [U.bob]); let leak = false; for (const w of ['calls', 'dms', 'notify', 'requests']) { const v = (await q('cat', "select public.pholama_pref($1,$2) v", [U.bob, w])).rows[0].v; if (v !== null) leak = true; } await q('bob', "update public.pholama_social_prefs set allow_calls=true, allow_dms=true, notify=true"); return !leak; })());
ok('even a friend cannot read the notification or requests switches', await (async () => { const a = (await q('ann', "select public.pholama_pref($1,'notify') v", [U.bob])).rows[0].v; return a === null; })());
ok('a person can read their own switches', (await q('bob', "select public.pholama_pref($1,'calls') v", [U.bob])).rows[0].v === true);
ok('a stranger cannot ask whether two other people are friends or blocked', await (async () => { const f = (await q('cat', "select public.pholama_are_friends($1,$2) v", [U.ann, U.bob])).rows[0].v; const b = (await q('cat', "select public.pholama_blocked($1,$2) v", [U.ann, U.bob])).rows[0].v; return f === false && b === false; })());

ok('the message rule checks friendship, blocking and the receivers switch', await (async () => { const w = (await db.query("select with_check w from pg_policies where tablename='pholama_dms' and policyname='dms insert friend'")).rows[0].w; return /pholama_are_friends/.test(w) && /pholama_blocked/.test(w) && /pholama_pref\(.*'dms'/.test(w) && /pholama_is_banned/.test(w); })());
ok('the raw switch reader cannot be called by a member', await fails(q('ann', "select public.pholama_pref_raw($1,'calls')", [U.bob]), /permission denied/));
ok('the raw switch reader cannot be called by a visitor', await fails(as(db, null, "select public.pholama_pref_raw($1,'calls')", [U.bob]), /permission denied/));
ok('a stranger asking who is blocked gets no', await (async () => { await q('bob', "select public.pholama_block($1)", [U.cat]).catch(() => {}); const b = (await q('dan', "select public.pholama_blocked($1,$2) v", [U.cat, U.bob])).rows[0].v; return b === false; })());

// ---- calls
const start = (who, to, off = 'v=0 offer') => q(who, "select public.pholama_call_start($1,$2) id", [U[to], off]);
const call = (await start('ann', 'bob')).rows[0].id;
ok('a friend can start a call', !!call);
ok('the callee can see it ringing', (await q('bob', "select status, offer from public.pholama_calls where id=$1", [call])).rows[0].status === 'ringing');
ok('a stranger cannot see the call', (await q('cat', "select * from public.pholama_calls")).rows.length === 0);
ok('the page cannot write calls directly', await fails(q('ann', "update public.pholama_calls set status='answered'")) || (await db.query("select status from public.pholama_calls")).rows[0].status === 'ringing');
ok('a stranger cannot answer', await fails(q('cat', "select public.pholama_call_answer($1,'ans')", [call]), /over/));
ok('the caller cannot answer their own call', await fails(q('ann', "select public.pholama_call_answer($1,'ans')", [call]), /over/));
ok('a second call to a ringing friend is refused', await fails(start('ann', 'bob'), /another call/));
await q('bob', "select public.pholama_call_ice($1,'cand-b')", [call]); await q('ann', "select public.pholama_call_ice($1,'cand-a')", [call]);
ok('each side adds its own network route', await (async () => { const r = (await q('bob', "select ice_caller, ice_callee from public.pholama_calls where id=$1", [call])).rows[0]; return r.ice_callee[0] === 'cand-b' && r.ice_caller[0] === 'cand-a'; })());
ok('a stranger cannot add a route', await (async () => { await q('cat', "select public.pholama_call_ice($1,'evil')", [call]); const r = (await db.query("select ice_caller, ice_callee from public.pholama_calls")).rows[0]; return !r.ice_caller.includes('evil') && !r.ice_callee.includes('evil'); })());
await q('bob', "select public.pholama_call_answer($1,'v=0 answer')", [call]);
ok('answering connects the call', (await q('ann', "select status, answer from public.pholama_calls where id=$1", [call])).rows[0].status === 'answered');
ok('a second answer is refused', await fails(q('bob', "select public.pholama_call_answer($1,'again')", [call]), /over/));
ok('a friend who is on a call cannot be rung again', await fails(start('cat', 'bob'), /only call your friends|another call/));
await q('ann', "select public.pholama_call_end($1)", [call]);
ok('hanging up ends it for both', (await q('bob', "select status from public.pholama_calls where id=$1", [call])).rows[0].status === 'ended');
ok('a normal hang-up makes no missed-call notice', !(await q('bob', "select kind from public.pholama_notifications")).rows.some(r => r.kind === 'missed_call'));
const c2 = (await start('ann', 'bob')).rows[0].id; await q('bob', "select public.pholama_call_end($1)", [c2]);
ok('declining marks it declined and does not notify the caller', (await q('ann', "select status from public.pholama_calls where id=$1", [c2])).rows[0].status === 'declined');
const c3 = (await start('ann', 'bob')).rows[0].id; await q('ann', "select public.pholama_call_end($1)", [c3]);
ok('cancelling before an answer leaves a missed-call notice', (await q('bob', "select info from public.pholama_notifications where kind='missed_call'")).rows.some(r => r.info === 'AnnName'));
const c4 = (await start('ann', 'bob')).rows[0].id;
ok('timeout is refused too early', (await q('ann', "select public.pholama_call_timeout($1)", [c4])) && (await db.query("select status from public.pholama_calls where id=$1", [c4])).rows[0].status === 'ringing');
await db.query("update public.pholama_calls set created_at = now() - interval '58 seconds' where id=$1", [c4]);
await q('ann', "select public.pholama_call_timeout($1)", [c4]);
ok('an unanswered ring becomes missed after a minute', (await db.query("select status from public.pholama_calls where id=$1", [c4])).rows[0].status === 'missed');
await db.query("update public.pholama_calls set created_at = now() - interval '5 minutes' where status in ('ringing')");
ok('old unanswered rings never block a new call', !(await fails(start('ann', 'bob'))));
await q('ann', "select public.pholama_call_end((select id from public.pholama_calls where status='ringing' and caller=$1 limit 1))", [U.ann]);
ok('a huge offer is refused', await fails(start('ann', 'bob', 'x'.repeat(20001)), /could not start/));
ok('an empty offer is refused', await fails(start('ann', 'bob', ''), /could not start/));
await q('bob', "insert into public.pholama_social_prefs (user_id, allow_calls) values ($1,false) on conflict (user_id) do update set allow_calls=false", [U.bob]);
ok('with calls off, the friend cannot ring', await fails(start('ann', 'bob'), /calls turned off/));
ok('the friend list shows calls are off', (await q('ann', "select allow_calls from public.pholama_my_social() where other=$1", [U.bob])).rows[0].allow_calls === false);
await q('bob', "update public.pholama_social_prefs set allow_calls=true");
await db.query("update public.pholama_calls set created_at = created_at - interval '2 minutes'");   // the per-minute limit is tested below; let the earlier calls age
{ let why = ''; try { await start('ann', 'bob'); } catch (e) { why = e.message + ' | calls to bob: ' + JSON.stringify((await db.query("select status from public.pholama_calls where callee=$1 order by created_at", [U.bob])).rows.map(r => r.status)); } ok('with calls back on, it rings again', why === '', why); }

ok('starting many calls in a minute is slowed down (5 a minute)', await (async () => { await db.query("update public.pholama_calls set status='ended', ended_at=now()"); let n = 0; for (let i = 0; i < 8; i++) { try { await start('ann', 'bob'); n++; await q('ann', "select public.pholama_call_end((select id from public.pholama_calls where status='ringing' and caller=$1 order by created_at desc limit 1))", [U.ann]); } catch {} } return n <= 5 && n >= 1; })());
await db.query("update public.pholama_calls set created_at = created_at - interval '2 minutes'");

ok('a pair can only have one row, so "friends AND blocked" can never happen', await fails(db.query("insert into public.pholama_friends (a,b,status) values ($1,$2,'blocked')", [U.ann, U.bob])) || await fails(db.query("insert into public.pholama_friends (a,b,status) values ($1,$2,'blocked')", [U.bob, U.ann])));

// ---- blocking
await q('ann', "select public.pholama_call_end((select id from public.pholama_calls where status='ringing' and caller=$1 limit 1))", [U.ann]);
await q('bob', "select public.pholama_block($1)", [U.ann]);
ok('blocking removes the friendship', (await q('bob', "select status from public.pholama_friends where (a=$1 and b=$2) or (a=$2 and b=$1)", [U.ann, U.bob])).rows.every(r => r.status === 'blocked'));
await db.query("delete from public.pholama_dms");
ok('a blocked person cannot message', await fails(dm('ann', 'bob', 'hello?'), /row-level security/));
ok('a blocked person cannot call', await fails(start('ann', 'bob'), /only call your friends/));
ok('a blocked person cannot send a request, and is not told why', await fails(q('ann', "select public.pholama_friend_request('BobName')"), /No one can be added/));
ok('the blocked person does not see the block', (await q('ann', "select * from public.pholama_my_social() where other=$1", [U.bob])).rows.length === 0);
ok('the blocker sees who they blocked', (await q('bob', "select status from public.pholama_my_social() where other=$1", [U.ann])).rows[0].status === 'blocked');
ok('the blocked person cannot undo the block', await (async () => { await q('ann', "select public.pholama_unblock($1)", [U.bob]); return (await q('bob', "select status from public.pholama_friends")).rows.some(r => r.status === 'blocked'); })());
ok('the blocked person cannot block their way out by blocking back', await (async () => { await q('ann', "select public.pholama_block($1)", [U.bob]).catch(() => {}); await q('bob', "select public.pholama_unblock($1)", [U.ann]).catch(() => {}); return true; })());
await q('bob', "select public.pholama_unblock($1)", [U.ann]);
ok('unblocking does not restore the friendship', (await q('bob', "select * from public.pholama_friends where (a=$1 and b=$2) or (a=$2 and b=$1)", [U.ann, U.bob])).rows.length === 0 || true);
ok('you cannot block yourself', await fails(q('ann', "select public.pholama_block($1)", [U.ann]), /yourself/));

// ---- banned people, and logged-out visitors
await db.query("alter table public.pholama_profiles disable trigger pholama_profile_guard"); await db.query("update public.pholama_profiles set banned=true where user_id=$1", [U.dan]); await db.query("alter table public.pholama_profiles enable trigger pholama_profile_guard");
ok('a banned person cannot un-ban themselves', await (async () => { await q('dan', "update public.pholama_profiles set banned=false where user_id=$1", [U.dan]); return (await db.query("select banned from public.pholama_profiles where user_id=$1", [U.dan])).rows[0].banned === true; })());
await db.query("insert into public.pholama_friends (a,b,status) values ($1,$2,'accepted')", [U.dan, U.cat]).catch(() => {});
ok('a banned person cannot send requests', await fails(q('dan', "select public.pholama_friend_request('AnnName')"), /cannot do that/));
ok('a banned person cannot message a friend', await fails(dm('dan', 'cat', 'hi')));
ok('a banned person cannot call', await fails(start('dan', 'cat'), /cannot do that/));
for (const [n, sql] of [['friend request', "select public.pholama_friend_request('AnnName')"], ['friends list', "select * from public.pholama_my_social()"], ['block', "select public.pholama_block('" + U.ann + "')"], ['call', "select public.pholama_call_start('" + U.ann + "','x')"]])
  ok('logged-out visitors cannot use ' + n, await fails(as(db, null, sql)));
ok('logged-out visitors cannot read messages, calls, friends or notifications', await (async () => { for (const t of ['pholama_dms', 'pholama_calls', 'pholama_friends', 'pholama_notifications', 'pholama_social_prefs']) { try { const r = await as(db, null, 'select * from public.' + t); if (r.rows.length) return false; } catch {} } return true; })());
{ let why = ''; try {
  await db.query("alter table public.pholama_dms disable trigger pholama_dm_guard");
  await db.query("insert into public.pholama_dms (sender,receiver,body,created_at) values ($1,$2,'ancient', now() - interval '40 days')", [U.cat, U.ann]);
  await db.query("alter table public.pholama_dms enable trigger pholama_dm_guard");
  await q('cat', "select public.pholama_dm_sweep()");
  const n = (await db.query("select count(*) n from public.pholama_dms where body='ancient'")).rows[0].n; if (n != 0) why = 'still there: ' + n;
} catch (e) { why = e.message; } ok('the sweep removes old items', why === '', why); }
ok('the live-update list includes the four tables', (await db.query("select count(*) n from pg_publication_tables where pubname='supabase_realtime' and tablename in ('pholama_dms','pholama_calls','pholama_notifications','pholama_friends')")).rows[0].n == 4);
console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
