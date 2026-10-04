// The "recommended model" must scale with the computer, never suggest something that cannot run tools, and never crash on odd input.
const { pickRecommended } = require('../server/recommend.js'); const cat = require('../models.pc.json');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x))); if (!c) bad++; };
const by = id => cat.find(m => m.id === id);
const pick = b => pickRecommended(cat, b);
ok('under 4 GB: nothing is recommended (no tool model fits)', pick(2) === null && pick(3.5) === null, [pick(2), pick(3.5)]);
ok('4 GB: the smallest tool model', pick(4) === 'llama3.2-3b', pick(4));
for (const r of [4, 5, 6, 8, 12, 16, 24, 32, 64, 128]) { const id = pick(r), m = by(id); ok(r + ' GB: the pick runs tools', !!m && m.toolTier === 'good', id); ok(r + ' GB: the pick fits', !!m && m.minRamGB <= r, [id, m && m.minRamGB]); ok(r + ' GB: the pick leaves room (file + 2 GB fits)', !!m && m.sizeGB + 2 <= r, [id, m && m.sizeGB]); }
const order = [4, 6, 8, 12, 16, 24, 32, 64].map(r => by(pick(r)).released);
ok('more memory never gives an OLDER model', order.every((v, i) => i === 0 || v >= order[i - 1]), order);
ok('8 GB gets the newer Qwen3.5 4B, not a 2024 model', pick(8) === 'qwen3.5-4b', pick(8));
ok('16 GB gets a bigger model than 8 GB', by(pick(16)).bytes > by(pick(8)).bytes, [pick(16), pick(8)]);
ok('32 GB gets a 2026 model', by(pick(32)).released >= '2026', pick(32));
ok('a chat-only model is never recommended', cat.filter(m => m.toolTier !== 'good').every(m => m.id !== pick(64) && m.id !== pick(8)));
ok('empty catalog does not crash', pickRecommended([], 16) === null);
ok('junk budget does not crash', [NaN, undefined, null, -5, 0].every(b => pickRecommended(cat, b) === null));
ok('tight PC (just over the minimum) still gets the smallest model that works', pickRecommended(cat.filter(m => m.id === 'qwen3.5-9b'), 9) === 'qwen3.5-9b');
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
