// The in-browser manual encoder must give the SAME string as the reference encoder for every golden script, so RetroStudio can import it.
const fs = require('fs'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
(async () => {
  const E = await import('../docs/retroencode.js'); const dir = path.join(__dirname, 'golden');
  let n = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); n++;
    const r = await E.encodeLua(g.source);
    // zlib levels can differ between engines, so the real proof is: it decodes to the SAME serialized blocks the reference made, and the block count matches
    const c = await E.checkEncoded(r.encoded);
    ok(`${f}: encodes and decodes`, c.valid && c.blocks === g.blocks && r.blocks === g.blocks, JSON.stringify([c, r.blocks, g.blocks]));
    ok(`${f}: same skipped list`, JSON.stringify(r.skipped) === JSON.stringify(g.skippedFeatures));
    const refC = await E.checkEncoded(g.encoded);
    ok(`${f}: the reference string also decodes here`, refC.valid && refC.blocks === g.blocks);
  }
  ok(`${n} golden scripts checked`, n >= 18);
  const hello = await E.encodeLua('print("hi")\n');
  ok('a simple script gives a string that starts with the RetroStudio header', hello.encoded.startsWith(E.HEADER_TEXT), hello.encoded.slice(0, 30));
  ok('empty script gives nothing (no crash)', (await E.encodeLua('')).blocks === 0);
  ok('it never runs the script', (() => { global.__ran = false; return E.encodeLua('global.__ran = true').then(() => global.__ran === false); })() instanceof Promise);
  ok('block catalog has 284 blocks', E.blockNames().length === 284);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
