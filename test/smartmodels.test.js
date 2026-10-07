// The "smart tool models, 4 GB or less" list must only ever hold models the catalog rates good at tools, and respect the size limit.
const fs = require('fs'), path = require('path'), { smartToolModels, pickRecommended } = require('../server/recommend.js');
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'models.pc.json'), 'utf8'));
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 220))); if (!c) bad++; };
const L = smartToolModels(cat, 4, 16);
ok('there are several smart tool models of 4 GB or less', L.length >= 8, L.length);
ok('every one is rated good at tools in the catalog', L.every(m => cat.find(c => c.id === m.id).toolTier === 'good'));
ok('every one is 4 GB or smaller', L.every(m => m.sizeGB <= 4), L.filter(m => m.sizeGB > 4).map(m => m.id));
ok('no basic or none model sneaks in', !L.some(m => ['basic', 'none'].includes(cat.find(c => c.id === m.id).toolTier)));
ok('every good model of 4 GB or less is included (none left out)', cat.filter(m => m.toolTier === 'good' && m.sizeGB <= 4).every(m => L.some(x => x.id === m.id)));
ok('Qwen3 4B is on the list', L.some(m => m.id === 'qwen3-4b'));
ok('the newest generation comes first', L.every((m, i) => i === 0 || (L[i - 1].released || '') >= (m.released || '')), L.map(m => m.released).join(','));
ok('a smaller limit shrinks the list', smartToolModels(cat, 2.0, 16).every(m => m.sizeGB <= 2.0) && smartToolModels(cat, 2.0, 16).length < L.length);
ok('on a tiny PC the big ones say they do not fit', smartToolModels(cat, 4, 4).some(m => m.fits === false) && smartToolModels(cat, 4, 4).filter(m => m.fits).every(m => m.minRamGB <= 4));
ok('without a memory figure it makes no fit claim', smartToolModels(cat, 4, 0).every(m => m.fits === null));
ok('bad input gives an empty list, not a crash', smartToolModels(null).length === 0 && smartToolModels([{ id: 'x' }, null]).length === 0);
ok('the recommended pick is always on this list when it is 4 GB or less', (() => { const r = pickRecommended(cat, 8); const m = cat.find(c => c.id === r); return !m || m.sizeGB > 4 || L.some(x => x.id === r); })());
console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
