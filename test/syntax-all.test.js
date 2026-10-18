// Every browser script in docs/ (the website) and web/ (the PC app) must at least PARSE.
// One syntax error in app.js silently kills every tab and button, and nothing else catches it.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-'));
for (const dir of ['docs', 'web']) {
  const root = path.join(__dirname, '..', dir);
  for (const f of fs.readdirSync(root).filter(x => x.endsWith('.js') && x !== 'sw.js')) {
    const copy = path.join(tmp, dir + '-' + f.replace(/\.js$/, '.mjs')); fs.copyFileSync(path.join(root, f), copy);
    const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
    ok(`${dir}/${f} parses`, r.status === 0, r.stderr.split('\n').slice(0, 4).join(' | '));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
