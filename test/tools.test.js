// The workspace file tools, run for real against a temporary folder: good use works, bad or hostile use is refused with a clear reason.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-tools-'));
const t2 = require('../server/tools2.js'); let bad = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x))); if (!c) bad++; };
const list = t2.tools(); const run = async (name, args) => { const t = list.find(x => x.name === name); if (!t) throw new Error('no tool ' + name); try { return { v: await (t.run ? t.run(args) : require('../server/tools2.js').run(name, args)) }; } catch (e) { return { e: e.message }; } };
const api = t2.run ? (n, a) => Promise.resolve().then(() => t2.run(n, a)).then(v => ({ v }), e => ({ e: e.message })) : run;
(async () => {
  let r;
  r = await api('write_file', { path: 'a.txt', content: 'hello' }); ok('write works', /Created a\.txt/.test(r.v), r);
  r = await api('write_file', { path: 'a.txt' }); ok('write with no content is refused (never silently empties a file)', /"content" is missing/.test(r.e || ''), r);
  r = await api('read_file', { path: 'a.txt' }); ok('and the file is untouched', /hello/.test(r.v || ''), r);
  r = await api('write_file', { path: 'empty.txt', content: '' }); ok('an empty string on purpose is allowed', /Created empty\.txt \(0 bytes\)/.test(r.v || ''), r);
  r = await api('write_file', { path: 'n.txt', content: 42 }); ok('a number is written as text', /Created n\.txt \(2 bytes\)/.test(r.v || ''), r);
  r = await api('append_file', { path: 'a.txt' }); ok('append with no content is refused', /"content" is missing/.test(r.e || ''), r);
  r = await api('write_file', { path: '', content: 'x' }); ok('an empty path is refused', /file name/.test(r.e || ''), r);
  r = await api('write_file', { path: '.', content: 'x' }); ok('"." (the folder itself) is refused', /file name/.test(r.e || ''), r);
  for (const n of ['CON', 'nul', 'COM1', 'lpt9.txt', 'aux.log', 'sub/PRN', 'con.', 'CON .txt']) { r = await api('write_file', { path: n, content: 'x' }); ok('Windows device name refused: ' + n, /reserved by Windows/.test(r.e || ''), r); }
  for (const n of ['console.txt', 'contact.md', 'communion.txt', 'auxiliary.js', 'nullable.ts', 'com10.txt', 'lpt.txt', 'prnt.md']) { r = await api('write_file', { path: n, content: 'x' }); ok('normal name still works: ' + n, /Created/.test(r.v || ''), r); }
  r = await api('delete_file', { path: 'nope.txt' }); ok('deleting a missing file names it', /file not found: nope\.txt/.test(r.e || ''), r);
  fs.mkdirSync(path.join(process.env.PHOLAMA_WORKSPACE, 'dir')); r = await api('delete_file', { path: 'dir' }); ok('deleting a folder says it is a folder', /is a folder/.test(r.e || ''), r);
  r = await api('delete_file', { path: '.' }); ok('deleting "." is refused', /file name/.test(r.e || ''), r);
  r = await api('delete_file', { path: 'a.txt' }); ok('deleting a file works', /Deleted a\.txt/.test(r.v || ''), r);
  for (const p of ['../x', '..\\x', 'a/../../x', 'C:\\Windows\\x', 'a\0b']) { r = await api('write_file', { path: p, content: 'x' }); ok('escape refused: ' + JSON.stringify(p), !!r.e && !/Created/.test(r.v || ''), r); }
  r = await api('write_file', { path: '/etc/passwd2', content: 'x' }); ok('a leading slash stays INSIDE the workspace (not the real /etc)', /Created etc\/passwd2/.test(r.v || '') && !fs.existsSync('/etc/passwd2'), r);
  r = await api('write_file', { path: 'big.txt', content: 'x'.repeat(200001) }); ok('over the size limit is refused', /too big/.test(r.e || ''), r);
  r = await api('write_file', { path: 'run.exe', content: 'x' }); ok('program file types are refused', /not allowed/.test(r.e || ''), r);
  await api('write_file', { path: 'two.txt', content: 'ab ab' });
  r = await api('edit_file', { path: 'two.txt', find: 'ab', replace: 'c' }); ok('edit: ambiguous text is refused', /2 times/.test(r.e || ''), r);
  r = await api('edit_file', { path: 'two.txt', find: 'zz', replace: 'c' }); ok('edit: missing text is refused', /not found/.test(r.e || ''), r);
  await api('edit_file', { path: 'two.txt', find: 'ab ab', replace: '$&$&' }); r = await api('read_file', { path: 'two.txt' }); ok('edit: "$&" in the new text is kept literally', /\$&\$&/.test(r.v || ''), r);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
