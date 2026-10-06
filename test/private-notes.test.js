// Operator-only setup steps (Supabase, GitHub callback, making a moderator) must never be in anything public.
const fs = require('fs'), path = require('path'), cp = require('child_process'); const root = path.join(__dirname, '..');
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const secretWords = /pholama_moderators\s*\(user_id\)|auth\/v1\/callback|Setup for whoever runs Supabase|Moderator guide|insert into public\.pholama_moderators|SQL editor|Owner setup|select public\.pholama_mod_cmd|supabase\/[a-z0-9_]+\.sql/i;
const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'test', 'supabase'].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.(md|html|js|json|txt)$/i.test(f.name) && f.name !== 'PRIVATE-OPERATOR-NOTES.md') out.push(p); } return out; };
const hits = walk(root).filter(f => secretWords.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(root, f));
ok('release notes (shown to every user) have no owner setup wording', !/SQL editor|Owner setup|supabase\/[a-z0-9_]+\.sql/i.test(fs.readFileSync(path.join(root, 'releases.json'), 'utf8')));
ok('no public file (README, docs, website, app, release notes) contains the operator setup steps', hits.length === 0, hits.join(', '));
ok('the shipped app folder is clean', !walk(path.join(root, 'web')).some(f => secretWords.test(fs.readFileSync(f, 'utf8'))));
ok('the website folder is clean', !walk(path.join(root, 'docs')).some(f => secretWords.test(fs.readFileSync(f, 'utf8'))));
ok('the README has no moderator SQL', !/pholama_moderators/.test(fs.readFileSync(path.join(root, 'README.md'), 'utf8')));
ok('the private file is listed in .gitignore', /^PRIVATE-OPERATOR-NOTES\.md$/m.test(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')));
let tracked = ''; try { tracked = cp.execSync('git ls-files PRIVATE-OPERATOR-NOTES.md private', { cwd: root, encoding: 'utf8' }).trim(); } catch {}
ok('git is not tracking the private file', tracked === '', tracked);
if (fs.existsSync(path.join(root, 'PRIVATE-OPERATOR-NOTES.md'))) ok('the private file keeps the steps for you', /pholama_moderators/.test(fs.readFileSync(path.join(root, 'PRIVATE-OPERATOR-NOTES.md'), 'utf8')));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
