// Daily cloud-agent credits and continuation costs on PostgreSQL (PGlite).
import { createRequire } from 'module';
try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite is not installed here'); process.exit(0); } }
const { makeDb } = await import('./sql/harness.mjs');
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const ok = (name, condition, detail = '') => { console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' -> ' + String(detail).slice(0, 300))); if (!condition) bad++; };
const db = await makeDb([path.join(root, 'supabase', 'agents.sql')]);
const user = async email => (await db.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
const ann = await user('ann@credits.test'), bob = await user('bob@credits.test');
const spend = async (uid, cost) => (await db.query('select public.pholama_credits_spend($1, $2) as r', [uid, cost])).rows[0].r;
const balance = async uid => (await db.query('select balance from public.pholama_credits where user_id=$1', [uid])).rows[0]?.balance;

let r = await spend(ann, 0);
ok('new account is provisioned with 12 credits and next UTC refill date', r.ok && r.balance === 12 && !!r.refill_on, JSON.stringify(r));
r = await spend(ann, 1);
ok('ordinary chat costs one credit', r.ok && r.balance === 11, JSON.stringify(r));
r = await spend(ann, 3);
ok('specialist action can cost more than chat', r.ok && r.balance === 8, JSON.stringify(r));
r = await spend(ann, 2);
ok('continuation costs exactly two credits', r.ok && r.balance === 6, JSON.stringify(r));
r = await spend(ann, 6);
ok('member can use exactly the remaining balance', r.ok && r.balance === 0, JSON.stringify(r));
r = await spend(ann, 1);
ok('member cannot spend below zero', !r.ok && r.balance === 0 && (await balance(ann)) === 0, JSON.stringify(r));

await db.query('update public.pholama_credits set balance=60 where user_id=$1', [bob]);
r = await spend(bob, 0);
ok('legacy monthly balance is capped at 12 on first request', r.ok && r.balance === 12, JSON.stringify(r));
await db.query("update public.pholama_credits set balance=0, period_start=(now() at time zone 'utc')::date - 1 where user_id=$1", [bob]);
r = await spend(bob, 1);
ok('first spend on a new UTC date refills to 12 then charges one', r.ok && r.balance === 11, JSON.stringify(r));
const expected = (await db.query("select ((now() at time zone 'utc')::date + 1)::text as d")).rows[0].d;
ok('refill date is the next UTC calendar day', r.refill_on === expected, JSON.stringify({ actual: r.refill_on, expected }));

const race = await user('race@credits.test');
await spend(race, 11);
const both = await Promise.all([spend(race, 1), spend(race, 1)]);
ok('concurrent requests cannot overspend the last credit', both.filter(x => x.ok).length === 1 && (await balance(race)) === 0, JSON.stringify(both));

await db.query('update public.pholama_credits set balance=5 where user_id=$1', [ann]);
await db.query('select public.pholama_credits_refund($1, 2)', [ann]);
ok('failed-call refund restores only the specified amount', await balance(ann) === 7);
await db.query('update public.pholama_credits set balance=12 where user_id=$1', [ann]);
await db.query('select public.pholama_credits_refund($1, 20)', [ann]);
ok('refund cannot raise a balance above the daily cap', await balance(ann) === 12);
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
await db.close();
process.exit(bad ? 1 : 0);
