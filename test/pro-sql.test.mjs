// Pholama Pro on a REAL PostgreSQL (PGlite) with Supabase's roles. The money rule: only the server can grant Pro,
// a code works once for the right account, and one Roblox subscription cannot power two accounts.
import { createRequire } from 'module'; try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite is not installed'); process.exit(0); } }
import { makeDb, as } from './sql/harness.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async (p, re) => { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } };
const db = await makeDb(['platform.sql', 'platform2.sql', 'report_rewards.sql', 'post_replies.sql', 'support.sql', 'social.sql', 'media.sql', 'pro.sql'].map(f => path.join(root, 'supabase', f)));
const U = {}; for (const n of ['ann', 'bob', 'cat']) { const r = await db.query("insert into auth.users (email) values ($1) returning id", [n + '@x.test']); U[n] = r.rows[0].id; }
const q = (who, sql, p) => as(db, U[who], sql, p);
const server = (sql, p) => db.query(sql, p);                                   // the cloud function: service role, no page
const asService = async (sql, p) => { await db.exec("set role service_role"); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
const code = async who => (await q(who, "select public.pholama_pro_code_new() c")).rows[0].c;
const plan = async who => (await q(who, "select public.pholama_my_plan() p")).rows[0].p;

// ---- limits
const free = (await db.query("select public.pholama_limits(false) l")).rows[0].l, pro = (await db.query("select public.pholama_limits(true) l")).rows[0].l;
ok('free limits: 10 a day, 30 a month, 5 projects, 5 friends, 5 Max messages', free.max_day === 10 && free.max_month === 30 && free.projects === 5 && free.friends === 5 && free.max_dms === 5, JSON.stringify(free));
ok('pro limits: 15 a day, 35 a month, 10 projects, 10 friends, 10 Max messages', pro.max_day === 15 && pro.max_month === 35 && pro.projects === 10 && pro.friends === 10 && pro.max_dms === 10, JSON.stringify(pro));
ok('pro has 10k integration tokens, free has less', pro.integration_tokens === 10000 && free.integration_tokens < 10000);
ok('pro has more memory than free (web and PC)', pro.memories_web > free.memories_web && pro.memories_pc > free.memories_pc);
ok('free memory matches the existing 5 web / 15 PC limits', free.memories_web === 5 && free.memories_pc === 15);

// ---- nobody is Pro to begin with
ok('a new person is on the free plan', (await plan('ann')).pro === false);
ok('a logged-out visitor cannot read a plan', await fails(as(db, null, "select public.pholama_my_plan() p")));

// ---- a page cannot give itself Pro
ok('a member cannot insert themselves into the Pro table', await fails(q('ann', "insert into public.pholama_pro (user_id, until) values ($1, now() + interval '400 days')", [U.ann])));
await db.query("insert into public.pholama_pro (user_id, until, roblox_id) values ($1, now() + interval '1 day', 1)", [U.cat]);
ok('a member cannot extend their own Pro', await (async () => { try { const r = await q('cat', "update public.pholama_pro set until = now() + interval '900 days' where user_id = $1 returning 1", [U.cat]); return r.rows.length === 0; } catch { return true; } })());
ok('and the end date really did not move', (new Date((await db.query("select until from public.pholama_pro where user_id = $1", [U.cat])).rows[0].until) - Date.now()) / 864e5 < 2);
await db.query("delete from public.pholama_pro where user_id = $1", [U.cat]);
ok('a member cannot call redeem themselves', await fails(q('ann', "select public.pholama_pro_redeem('AAAAAAAA', 5)")));
ok('a member cannot call renew themselves', await fails(q('ann', "select public.pholama_pro_renew(5)")));
ok('a visitor cannot ask for a code', await fails(as(db, null, "select public.pholama_pro_code_new()")));
{ await q('bob', "select public.pholama_pro_code_new()");
  const seen = await (async () => { try { return (await q('ann', "select * from public.pholama_pro_codes")).rows.length; } catch { return 0; } })();
  const own = await (async () => { try { return (await q('bob', "select * from public.pholama_pro_codes")).rows.length; } catch { return 0; } })();
  ok('a member sees no codes at all, not even their own or someone elses', seen === 0 && own === 0, seen + '/' + own);
  ok('but a code really was stored for Bob', (await db.query("select count(*)::int n from public.pholama_pro_codes where user_id = $1", [U.bob])).rows[0].n >= 1); }
ok('a member cannot read other peoples Pro rows', (await q('bob', "select * from public.pholama_pro")).rows.length === 0);
ok('is_pro cannot be asked by a visitor', await fails(as(db, null, "select public.pholama_is_pro($1)", [U.ann])));

// ---- the normal happy path
const c1 = await code('ann');
ok('a code is 8 letters/digits', /^[0-9A-F]{8}$/.test(c1), c1);
ok('the code is stored only as a hash', (await db.query("select count(*)::int n from public.pholama_pro_codes where code_hash = $1", [c1])).rows[0].n === 0);
ok('a wrong code is refused', (await asService("select public.pholama_pro_redeem('ZZZZZZZZ', 111) r")).rows[0].r.ok === false);
const r1 = (await asService("select public.pholama_pro_redeem($1, 111) r", [c1])).rows[0].r;
ok('the right code gives Pro', r1.ok === true, JSON.stringify(r1));
const p1 = await plan('ann');
ok('she is now Pro with the pro limits', p1.pro === true && p1.limits.max_day === 15 && p1.limits.projects === 10, JSON.stringify(p1));
const days = (new Date(p1.until) - Date.now()) / 864e5;
ok('Pro lasts about 30 days', days > 29.9 && days < 30.1, days);
ok('the code works only once', (await asService("select public.pholama_pro_redeem($1, 111) r", [c1])).rows[0].r.ok === false);
const c1b = await code('ann'); const r1b = (await asService("select public.pholama_pro_redeem($1, 111) r", [c1b.toLowerCase() + ' '])).rows[0].r;
ok('a code typed in lower case with a space still works', r1b.ok === true, JSON.stringify(r1b));
const p1b = await plan('ann'); const days2 = (new Date(p1b.until) - Date.now()) / 864e5;
ok('redeeming again cannot stack more than 35 days ahead', days2 <= 35.01, days2);

// ---- codes belong to one person and expire
const c2 = await code('bob');
ok('a code made by Bob gives Pro to Bob, not to whoever types it', (await asService("select public.pholama_pro_redeem($1, 222) r", [c2])).rows[0].r.ok === true && (await plan('bob')).pro === true && (await plan('cat')).pro === false);
const c3 = await code('cat'); await db.query("update public.pholama_pro_codes set expires_at = now() - interval '1 second' where user_id = $1", [U.cat]);
ok('an expired code is refused', (await asService("select public.pholama_pro_redeem($1, 333) r", [c3])).rows[0].r.reason === 'code');
ok('asking for a new code cancels the old one', await (async () => { const a = await code('cat'); const b = await code('cat'); const ra = (await asService("select public.pholama_pro_redeem($1, 333) r", [a])).rows[0].r; const rb = (await asService("select public.pholama_pro_redeem($1, 333) r", [b])).rows[0].r; return ra.ok === false && rb.ok === true; })());
ok('cat is now Pro too', (await plan('cat')).pro === true);

// ---- one Roblox subscription cannot power two Pholama accounts
await db.query("delete from public.pholama_pro where user_id = $1", [U.cat]);
const cs = await code('cat'); const share = (await asService("select public.pholama_pro_redeem($1, 111) r", [cs])).rows[0].r;   // 111 already powers Ann
ok('a Roblox account already powering someone else is refused', share.ok === false && share.reason === 'roblox-used', JSON.stringify(share));
ok('that refusal does not burn the code', (await asService("select public.pholama_pro_redeem($1, 444) r", [cs])).rows[0].r.ok === true);
ok('Ann still has her Pro', (await plan('ann')).pro === true);
ok('a bad Roblox id is refused', (await asService("select public.pholama_pro_redeem('AAAAAAAA', 0) r")).rows[0].r.ok === false && (await asService("select public.pholama_pro_redeem('AAAAAAAA', null) r")).rows[0].r.ok === false);
ok('the Roblox id is unique in the table', await fails(server("insert into public.pholama_pro (user_id, until, roblox_id) values ($1, now(), 111)", [U.bob])));

// ---- a lapsed account frees its Roblox id for someone else
await db.query("update public.pholama_pro set until = now() - interval '1 day' where user_id = $1", [U.ann]);
ok('after it lapses the person is back on the free plan', (await plan('ann')).pro === false);
const cl = await code('bob'); const take = (await asService("select public.pholama_pro_redeem($1, 111) r", [cl])).rows[0].r;
ok('a lapsed subscription id can move to a new account', take.ok === true, JSON.stringify(take));
ok('and the old account stays free', (await plan('ann')).pro === false);

// ---- renewal
const row = async who => (await db.query("select until from public.pholama_pro where user_id = $1", [U[who]])).rows[0];
ok('renew for an unknown Roblox id does nothing', (await asService("select public.pholama_pro_renew(99999) r")).rows[0].r.ok === false);
await db.query("update public.pholama_pro set until = now() + interval '20 days' where user_id = $1", [U.cat]);
const before = (await row('cat')).until; const rn = (await asService("select public.pholama_pro_renew(444) r")).rows[0].r;
ok('logging into the game does not stack days while plenty are left', rn.ok === true && rn.extended === false && String((await row('cat')).until) === String(before), JSON.stringify(rn));
await db.query("update public.pholama_pro set until = now() + interval '1 day' where user_id = $1", [U.cat]);
const rn2 = (await asService("select public.pholama_pro_renew(444) r")).rows[0].r;
const left = (new Date((await row('cat')).until) - Date.now()) / 864e5;
ok('near the end a renewal adds 30 days', rn2.extended === true && left > 30.9 && left < 31.1, left);
await db.query("update public.pholama_pro set until = now() - interval '5 days' where user_id = $1", [U.cat]);
await asService("select public.pholama_pro_renew(444)");
ok('renewing a lapsed one starts from today, not from the past', (new Date((await row('cat')).until) - Date.now()) / 864e5 > 29.9);

// ---- privacy of the Pro table, when people really ARE Pro
await db.query("delete from public.pholama_pro"); await db.query("insert into public.pholama_pro (user_id, until, roblox_id) values ($1, now() + interval '10 days', 7001), ($2, now() + interval '10 days', 7002)", [U.ann, U.bob]);
ok('a member sees ONLY their own Pro row, never another persons', (await q('ann', "select user_id from public.pholama_pro")).rows.map(r => r.user_id).join() === U.ann);
ok('and never another persons Roblox id', (await q('ann', "select roblox_id from public.pholama_pro")).rows.every(r => Number(r.roblox_id) === 7001));

// ---- is_pro: the one yes/no the cloud function uses to pick the daily and monthly caps
const isPro = async who => (await asService("select public.pholama_is_pro($1) v", [U[who]])).rows[0].v;
ok('is_pro is true while the plan runs', (await isPro('ann')) === true);
ok('is_pro is false for someone who was never Pro', (await isPro('cat')) === false);
await db.query("update public.pholama_pro set until = now() - interval '1 second' where user_id = $1", [U.ann]);
ok('is_pro is false the second the plan ends (lapsed is not Pro)', (await isPro('ann')) === false);
ok('and my_plan agrees with is_pro', (await plan('ann')).pro === false && (await plan('bob')).pro === true);
ok('a member cannot ask is_pro about someone else', await fails(q('ann', "select public.pholama_is_pro($1)", [U.bob])));

// ---- rate limit on asking for codes
const spam = []; let blocked = false; for (let i = 0; i < 14; i++) { try { await code('bob'); } catch (e) { blocked = /Too many/.test(e.message); spam.push(i); } }
ok('asking for codes over and over is stopped', blocked, spam.length);

console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
