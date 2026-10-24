// The Codebase monthly pool (supabase/codebase_pool.sql) on real PostgreSQL (PGlite): 15,000 a month, atomic, refundable, separate from the weekly credits.
import { createRequire } from 'module';
try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite is not installed here'); process.exit(0); } }
const { makeDb } = await import('./sql/harness.mjs');
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const ok = (name, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : ' -> ' + String(d).slice(0, 300))); if (!c) bad++; };
const db = await makeDb([path.join(root, 'supabase', 'cloudstudio.sql'), path.join(root, 'supabase', 'credits1500.sql'), path.join(root, 'supabase', 'codebase_pool.sql')]);
const user = async e => (await db.query('insert into auth.users (email) values ($1) returning id', [e])).rows[0].id;
const ann = await user('ann@pool.test'), bob = await user('bob@pool.test');
const spend = async (u, c) => (await db.query('select public.pholama_codebase_spend($1,$2) as r', [u, c])).rows[0].r;
const refund = async (u, c) => (await db.query('select public.pholama_codebase_refund($1,$2) as r', [u, c])).rows[0].r;
const weekly = async (u, c) => (await db.query('select public.pholama_cloud_weekly_spend($1,$2) as r', [u, c])).rows[0].r;

let r = await spend(ann, 25);
ok('first charge starts the month at 25 of 15,000', r.ok && r.used === 25 && r.cap === 15000, JSON.stringify(r));
r = await spend(ann, 5000); r = await spend(ann, 5000);
ok('charges add up (10,025)', r.ok && r.used === 10025, JSON.stringify(r));
r = await spend(ann, 4975);
ok('exactly 15,000 is allowed', r.ok && r.used === 15000, JSON.stringify(r));
r = await spend(ann, 1);
ok('one more is refused and the pool stays at 15,000', !r.ok && r.used === 15000, JSON.stringify(r));
r = await refund(ann, 100);
ok('a refund gives credits back (14,900)', r.ok && r.used === 14900, JSON.stringify(r));
r = await refund(ann, 99999);
ok('a refund can never go below zero', r.ok && r.used === 0, JSON.stringify(r));
r = await spend(ann, 99999);
ok('one giant charge is capped to 15,000 and fits exactly once', r.ok && r.used === 15000, JSON.stringify(r));
r = await spend(bob, 10);
ok('another account has its own pool', r.ok && r.used === 10, JSON.stringify(r));
r = await spend(bob, -50); 
ok('a negative charge is treated as zero (cannot add credits)', r.ok && r.used === 10, JSON.stringify(r));
r = await spend(bob, null);
ok('a missing cost is treated as zero', r.ok && r.used === 10, JSON.stringify(r));
r = await weekly(ann, 100);
ok('the weekly credits are untouched by Codebase spending (ann still has all 1,500 weekly)', r.ok && r.used === 100 && r.cap === 1500, JSON.stringify(r));
r = await refund(bob, 5); r = await refund(await user('cy@pool.test'), 5);
ok('refunding an account with no usage is harmless', r.ok === false && r.used === 0, JSON.stringify(r));
let denied = false; try { await db.query('set role authenticated'); await db.query('select public.pholama_codebase_spend($1, 1)', [ann]); } catch { denied = true; } try { await db.query('reset role'); } catch {}
ok('signed-in users cannot call the spend function themselves (service role only)', denied);
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
