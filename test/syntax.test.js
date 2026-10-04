// Every browser and server file must parse. A single bad regex in web/studio.js once made Studio fail to load with
// "invalid regular expression flag" and nothing in the old tests noticed.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
let bad = 0; const root = path.join(__dirname, '..');
for (const dir of ['web', 'server']) for (const f of fs.readdirSync(path.join(root, dir)).filter(x => x.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, dir, f)], { encoding: 'utf8' });
  const okk = r.status === 0; console.log((okk ? 'PASS ' : 'FAIL ') + dir + '/' + f + (okk ? '' : '  -> ' + String(r.stderr).split('\n').filter(l => /Error/.test(l))[0])); if (!okk) bad++;
}
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
