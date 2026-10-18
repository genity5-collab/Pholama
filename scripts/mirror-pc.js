// Keeps the PC app files in THIS (site) repo identical to the PC repo, so installs that were made before the split
// (their updater still reads genity5-collab/Pholama) keep receiving every PC update.
// Usage:  node scripts/mirror-pc.js <path-to-Pholama-PC-checkout>        (copies)
//         node scripts/mirror-pc.js <path-to-Pholama-PC-checkout> --check (exits 1 if they differ)
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2], check = process.argv.includes('--check');
if (!src || !fs.existsSync(path.join(src, 'package.json'))) { console.error('Give the path to a Pholama-PC checkout.'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const PARTS = ['server', 'web', 'bin', 'install', 'start.sh', 'start.bat'];   // what an old install downloads and runs
const walk = p => fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap(f => walk(path.join(p, f))) : [p];
const files = d => PARTS.filter(x => fs.existsSync(path.join(d, x))).flatMap(x => walk(path.join(d, x)).map(f => path.relative(d, f).split(path.sep).join('/'))).sort();
const a = files(src), b = files(ROOT); let diff = 0;
for (const f of a) { const s = fs.readFileSync(path.join(src, f)); const t = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f)) : null; if (!t || !s.equals(t)) { diff++; if (check) console.log('differs:', f); else { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), s); console.log('copied:', f); } } }
for (const f of b) if (!a.includes(f)) { diff++; if (check) console.log('extra here:', f); else { fs.rmSync(path.join(ROOT, f)); console.log('removed:', f); } }
console.log(diff ? (check ? diff + ' file(s) out of step' : 'mirrored ' + diff + ' file(s)') : 'already identical');
process.exit(check && diff ? 1 : 0);
