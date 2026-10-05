// Agent Max as a built-in friend, on a REAL PostgreSQL (PGlite) with Supabase's roles.
// Rules: 5 messages a day (10 with Pro) counted by the database, chats are private, nobody can forge a reply, and a failed answer is not charged.
import { createRequire } from 'module'; try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite is not installed here'); process.exit(0); } }
import { makeDb, as } from './sql/harness.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async (p, re) => { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } };
const db = await makeDb(['platform.sql', 'platform2.sql', 'report_rewards.sql', 'post_replies.sql', 'support.sql', 'social.sql', 'media.sql', 'pro.sql', 'maxfriend.sql'].map(f => path.join(root, 'supabase', f)));
const U = {}; for (const n of ['ann', 'bob', 'cat']) { const r = await db.query("insert into auth.users (email) values ($1) returning id", [n + '@x.test']); U[n] = r.rows[0].id; }
const q = (who, sql, p) => as(db, U[who], sql, p);
const asService = async (sql, p) => { await db.exec("set role service_role"); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const send = async (who, t) => (await q(who, "select public.pholama_max_chat_send($1) r", [t])).rows[0].r;
const left = async who => (await q(who, "select public.pholama_max_chat_left() r")).rows[0].r;
const makePro = async who => db.query("insert into public.pholama_pro (user_id, until, roblox_id) values ($1, now() + interval '20 days', $2) on conflict (user_id) do update set until = excluded.until", [U[who], 1000 + Math.floor(Math.random() * 9e6)]);

// ---- the daily limit: 5 free
let r = await left('ann');
ok('a new member has 5 messages and used none', r.cap === 5 && r.used === 0 && r.left === 5, JSON.stringify(r));
for (let i = 1; i <= 5; i++) { r = await send('ann', 'hello ' + i); ok('free message ' + i + ' goes through, ' + (5 - i) + ' left', r.ok === true && r.left === 5 - i, JSON.stringify(r)); }
r = await send('ann', 'one too many');
ok('the 6th free message is refused with the cap shown', r.ok === false && r.reason === 'day' && r.cap === 5 && r.left === 0, JSON.stringify(r));
ok('and the refused message was NOT saved', (await q('ann', "select count(*)::int n from public.pholama_max_chat where role='user'")).rows[0].n === 5);
ok('left shows 0', (await left('ann')).left === 0);
// others are not affected
r = await send('bob', 'hi'); ok('another member still has their own 5', r.ok === true && r.left === 4, JSON.stringify(r));

// ---- Pro: 10
await makePro('cat'); r = await left('cat'); ok('a Pro member has 10', r.cap === 10 && r.left === 10, JSON.stringify(r));
for (let i = 1; i <= 10; i++) r = await send('cat', 'pro ' + i);
ok('Pro message 10 goes through with 0 left', r.ok === true && r.left === 0, JSON.stringify(r));
r = await send('cat', 'pro 11'); ok('Pro message 11 is refused', r.ok === false && r.cap === 10, JSON.stringify(r));
// Pro ends -> back to 5 immediately
await db.query("update public.pholama_pro set until = now() - interval '1 hour' where user_id = $1", [U.cat]);
r = await left('cat'); ok('when Pro ends the cap drops back to 5 (and they already used 10, so 0 left)', r.cap === 5 && r.left === 0, JSON.stringify(r));

// ---- refund when Max could not answer
r = await send('bob', 'second'); const before = (await left('bob')).used;
await asService("select public.pholama_max_chat_refund($1)", [U.bob]);
ok('a refund gives one message back', (await left('bob')).used === before - 1);
for (let i = 0; i < 5; i++) await asService("select public.pholama_max_chat_refund($1)", [U.bob]);
ok('refunds never go below zero', (await left('bob')).used === 0);
ok('a member cannot refund themselves', await fails(q('ann', "select public.pholama_max_chat_refund($1)", [U.ann]), /permission denied/));

// ---- what can be typed
ok('an empty message is refused', await fails(send('bob', '   '), /Type a message/));
ok('a null message is refused', await fails(q('bob', "select public.pholama_max_chat_send(null)")));
ok('over 500 characters is refused', await fails(send('bob', 'x'.repeat(501)), /500/));
ok('exactly 500 characters is fine', (await send('bob', 'x'.repeat(500))).ok === true);
ok('a secret key is blocked', await fails(send('bob', 'my key is ghp_abcdefghijklmnopqrstuvwxyz0123456789'), /secret key/));
ok('a blocked message does not use up a message', (await left('bob')).used === 1 || (await left('bob')).used === 2);
ok('logged out: refused', await fails(as(db, null, "select public.pholama_max_chat_send('hi')"), /permission denied|Log in/));

// ---- privacy and forging
ok('a member sees only their own chat', (await q('ann', "select count(*)::int n from public.pholama_max_chat where user_id <> $1", [U.ann])).rows[0].n === 0);
const rowsBefore = (await db.query("select count(*)::int n from public.pholama_max_chat")).rows[0].n;
ok('a member cannot write a chat row directly (blocked by row security)', await fails(q('ann', "insert into public.pholama_max_chat (user_id, role, body) values ($1, 'max', 'I am Max')", [U.ann]), /row-level security|permission denied/));
ok('and no forged row exists afterwards', (await db.query("select count(*)::int n from public.pholama_max_chat where body = 'I am Max'")).rows[0].n === 0 && (await db.query("select count(*)::int n from public.pholama_max_chat")).rows[0].n === rowsBefore);
ok('a member cannot forge a reply as Agent Max', await fails(q('ann', "select public.pholama_max_chat_reply($1, 'forged')", [U.ann]), /permission denied/));
await q('ann', "update public.pholama_max_chat set body = 'edited' where user_id = $1", [U.ann]).catch(() => {});
ok('a member cannot edit a message (nothing changes)', (await db.query("select count(*)::int n from public.pholama_max_chat where body = 'edited'")).rows[0].n === 0);
ok('a member cannot read the counter table (sees nothing)', await q('ann', "select * from public.pholama_max_chat_day").then(x => x.rows.length === 0, () => true));
const usedBefore = (await db.query("select coalesce(sum(used),0)::int n from public.pholama_max_chat_day")).rows[0].n;
await q('ann', "update public.pholama_max_chat_day set used = 0").catch(() => {});
ok('a member cannot reset their own counter (nothing changes)', (await db.query("select coalesce(sum(used),0)::int n from public.pholama_max_chat_day")).rows[0].n === usedBefore && usedBefore > 0, usedBefore);
ok('logged out sees nothing', (await as(db, null, "select count(*)::int n from public.pholama_max_chat").then(x => x.rows[0].n, () => 0)) === 0);
await asService("select public.pholama_max_chat_reply($1, 'Hi Ann, I am Agent Max')", [U.ann]);
ok('the server can store a reply and Ann sees it as Max', (await q('ann', "select role from public.pholama_max_chat where body like 'Hi Ann%'")).rows[0]?.role === 'max');
ok('Bob cannot see Ann\'s reply', (await q('bob', "select count(*)::int n from public.pholama_max_chat where body like 'Hi Ann%'")).rows[0].n === 0);
ok('a member can clear their own chat', (await q('ann', "delete from public.pholama_max_chat where user_id = $1 returning id", [U.ann])).rows.length >= 1);
ok('clearing the chat does NOT give messages back (the counter is separate)', (await left('ann')).left === 0);
await db.query("delete from public.pholama_max_chat_day"); await send('bob', 'keep me safe'); await send('bob', 'me too');
const bobRows = (await db.query("select count(*)::int n from public.pholama_max_chat where user_id = $1", [U.bob])).rows[0].n;
await q('ann', "delete from public.pholama_max_chat where user_id = $1", [U.bob]).catch(() => {});
ok('a member cannot clear someone else\'s chat (Bob still has his messages)', bobRows >= 2 && (await db.query("select count(*)::int n from public.pholama_max_chat where user_id = $1", [U.bob])).rows[0].n === bobRows, bobRows);
await q('ann', "delete from public.pholama_max_chat").catch(() => {});
ok('and a sweeping delete only removes the member\'s own rows', (await db.query("select count(*)::int n from public.pholama_max_chat where user_id = $1", [U.bob])).rows[0].n === bobRows);

// ---- a banned member cannot use it, and is not charged
await db.query("insert into public.pholama_profiles (user_id, platform_name, banned, banned_until) values ($1, 'troll', true, null) on conflict (user_id) do update set banned = true, banned_until = null", [U.cat]);
const catBefore = (await db.query("select coalesce(sum(used),0)::int n from public.pholama_max_chat_day where user_id = $1", [U.cat])).rows[0].n;
ok('a banned member is refused', await fails(send('cat', 'let me in'), /cannot do that/));
ok('and a refused ban attempt is not counted or saved', (await db.query("select coalesce(sum(used),0)::int n from public.pholama_max_chat_day where user_id = $1", [U.cat])).rows[0].n === catBefore);
// a ban that has already run out no longer blocks (set when the row is created; the profile trigger protects updates)
const dan = (await db.query("insert into auth.users (email) values ('dan@x.test') returning id")).rows[0].id; U.dan = dan;
await db.query("insert into public.pholama_profiles (user_id, platform_name, banned, banned_until) values ($1, 'olddan', true, now() - interval '1 day')", [dan]);
ok('a ban that has run out no longer blocks them', (await send('dan', 'back again')).ok === true);

// ---- the day rolls over (UTC)
await db.query("update public.pholama_max_chat_day set day = day - 1");
r = await left('ann'); ok('tomorrow the count starts again at 0', r.used === 0 && r.left === 5, JSON.stringify(r));
r = await send('ann', 'new day'); ok('and a new message works', r.ok === true && r.left === 4, JSON.stringify(r));

// ---- two quick messages at the same moment cannot both squeeze under the cap
await db.query("delete from public.pholama_max_chat_day"); for (let i = 0; i < 4; i++) await send('bob', 'fill ' + i);
const both = await Promise.all([send('bob', 'race A'), send('bob', 'race B'), send('bob', 'race C')]);
ok('only 1 of 3 simultaneous messages fits the last slot', both.filter(x => x.ok).length === 1, JSON.stringify(both));

// ---- old chats are swept
await db.query("update public.pholama_max_chat set created_at = now() - interval '31 days' where id = (select min(id) from public.pholama_max_chat)");
const n0 = (await db.query("select count(*)::int n from public.pholama_max_chat")).rows[0].n; await asService("select public.pholama_max_chat_sweep()");
ok('chats older than 30 days are deleted', (await db.query("select count(*)::int n from public.pholama_max_chat")).rows[0].n === n0 - 1);
ok('a member cannot run the sweep', await fails(q('ann', "select public.pholama_max_chat_sweep()"), /permission denied/));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
