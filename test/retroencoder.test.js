// The RetroStudio encoder must reproduce the reference encoder's output EXACTLY (byte for byte),
// otherwise the RetroStudio plugin cannot import what we give the user.
const fs = require('fs'), path = require('path'), enc = require('../site-only/retroencoder');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
const dir = path.join(__dirname, 'golden');
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), r = enc.compile(g.source);
  ok(`${f}: serialized form is identical`, r.serialized === g.serialized);
  ok(`${f}: encoded string is identical`, r.encoded === g.encoded);
  ok(`${f}: block count and skipped list match`, r.blocks === g.blocks && JSON.stringify(r.skipped) === JSON.stringify(g.skippedFeatures));
  const c = enc.check(r.encoded);
  ok(`${f}: round trip decodes`, c.valid && c.blocks === g.blocks, JSON.stringify(c));
}
ok('base93 round trips arbitrary bytes', (() => { const b = require('crypto').randomBytes(500); return enc.decodeBase93(enc.encodeBase93(b)).equals(b); })());
ok('garbage is rejected by check()', !enc.check('hello').valid && !enc.check(enc.HEADER + 'zzzz').valid);
ok('the encoder never runs the code it reads', (() => { global.__ran = false; enc.compile('global.__ran = true\nprint("x")'); return global.__ran === false; })());
ok('block catalog is loaded (284 blocks)', enc.blockNames().length === 284);
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
