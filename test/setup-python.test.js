// The AI's Python tool uses the bundled Python as soon as it exists (no restart), and falls back to the system Python otherwise.
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-py-')); process.env.PHOLAMA_HOME = home;
const langs = require('../server/langs.js'), S = require('../server/setup.js');
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const before = langs.status(true).find(x => x.id === 'python');
ok('Python status works with no bundled copy (system Python or "not installed")', typeof before.installed === 'boolean', JSON.stringify(before));
ok('when missing, the hint points to Studio > Setup', before.installed || /Setup/.test(before.howToInstall), before.howToInstall);
// plant a fake bundled python: a script that answers --version and runs a file
fs.mkdirSync(S.pythonDir(), { recursive: true });
const fake = process.platform === 'win32' ? S.pythonExe() : S.pythonExe();
fs.writeFileSync(fake, process.platform === 'win32' ? '' : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Python 9.9.9-bundled"; exit 0; fi\ncat "$1"\n');
if (process.platform !== 'win32') fs.chmodSync(fake, 0o755);
const after = langs.status(true).find(x => x.id === 'python');
if (process.platform === 'win32') ok('(Windows) bundled Python is detected', after.installed, JSON.stringify(after));
else { ok('the bundled Python is picked up at once, with no restart', after.installed && /9\.9\.9-bundled/.test(after.version), JSON.stringify(after)); ok('and it is preferred over any system Python', /bundled/.test(after.version)); }
fs.rmSync(S.pythonDir(), { recursive: true, force: true });
const gone = langs.status(true).find(x => x.id === 'python');
ok('removing the bundled Python falls back cleanly', !/bundled/.test(gone.version || ''), JSON.stringify(gone));
fs.rmSync(home, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
