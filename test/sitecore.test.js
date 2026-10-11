// Website Studio core: file rules, forgiving edits, never saving a broken script, project check, and secrets (10 max, nothing leaks).
const load = require('./helpers/sitecore'), memory = load.memory;
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async fn => { try { await fn(); return null; } catch (e) { return e; } };
(async () => {
  const core = await load('siteStudioCore.ts'), { ctx } = memory(core), P = 'shop';
  await core.createProject(ctx, 'Shop'); ok('a project starts with three files', Object.keys(await ctx.store.allFiles(P)).sort().join() === 'index.html,script.js,style.css');
  ok('creating it again just says it exists', (await core.createProject(ctx, 'shop')).existed === true);
  for (const bad of ['../x', '.env', 'a/../b.js', 'x.exe', 'a b?.js', '']) { const e = await fails(() => core.writeFile(ctx, P, bad, 'x')); ok('bad file name refused: "' + bad + '"', !!e); }
  const w = await core.writeFile(ctx, P, 'app.js', 'let a = 1;\nlet b = 2;\n'); ok('a file is written', w.created && (await core.readFile(ctx, P, 'app.js')).includes('let b'));
  let e = await fails(() => core.writeFile(ctx, P, 'big.txt', 'x'.repeat(401 * 1024))); ok('a file over 400 KB is refused', !!e && /too big/.test(e.message));
  // forgiving edits
  await core.writeFile(ctx, P, 'e.js', 'function go() {\n    let x = 1;\n    return x;\n}\n');
  ok('exact edit works', /Edited e\.js$/.test(await core.patchFile(ctx, P, 'e.js', 'let x = 1;', 'let x = 2;')));
  ok('indentation and spacing differences are forgiven', /ignoring spacing/.test(await core.patchFile(ctx, P, 'e.js', 'return x;   ', 'return x * 2;')) && (await core.readFile(ctx, P, 'e.js')).includes('    return x * 2;'));
  await core.writeFile(ctx, P, 'dup.js', 'a();\na();\n'); e = await fails(() => core.patchFile(ctx, P, 'dup.js', 'a();', 'b();')); ok('an ambiguous edit is refused with a hint', !!e && /2 times/.test(e.message));
  ok('...unless "all" is set', /2 places/.test(await core.patchFile(ctx, P, 'dup.js', 'a();', 'b();', true)));
  e = await fails(() => core.patchFile(ctx, P, 'e.js', 'nothing like this', 'x')); ok('text that is not there is refused', !!e && /not found/.test(e.message));
  const before = await core.readFile(ctx, P, 'e.js'); e = await fails(() => core.patchFile(ctx, P, 'e.js', 'return x * 2;', 'return x * ;')); ok('an edit that would BREAK a working script is refused', !!e && /would break/.test(e.message));
  ok('...and the file is untouched', (await core.readFile(ctx, P, 'e.js')) === before);
  await core.writeFile(ctx, P, 'l.js', 'one();\ntwo();\nthree();\n'); await core.editLines(ctx, P, 'l.js', 2, 2, 'TWO();'); ok('edit by line number', (await core.readFile(ctx, P, 'l.js')).split('\n')[1] === 'TWO();');
  await core.editLines(ctx, P, 'l.js', 1, null, 'zero();'); ok('insert before a line', (await core.readFile(ctx, P, 'l.js')).startsWith('zero();\none();'));
  e = await fails(() => core.editLines(ctx, P, 'l.js', 99, 99, 'x')); ok('a line number out of range is refused', !!e);
  ok('numbered reading', /^ ?1 \| zero\(\);/.test(await core.readNumbered(ctx, P, 'l.js')));
  // project limits
  const { ctx: c2 } = memory(core); await core.createProject(c2, 'p'); for (let i = 0; i < 57; i++) await core.writeFile(c2, 'p', 'f' + i + '.txt', 'x'); e = await fails(() => core.writeFile(c2, 'p', 'one-more.txt', 'x')); ok('at most 60 files per project', !!e && /too many files/.test(e.message));
  const { ctx: c3 } = memory(core); for (let i = 0; i < 5; i++) await core.createProject(c3, 'proj' + i); e = await fails(() => core.createProject(c3, 'sixth')); ok('at most 5 website projects', !!e && /5 website projects/.test(e.message));
  // check
  await core.writeFile(ctx, P, 'index.html', '<a href="nope.html">x</a><div id="a"></div><div id="a"></div><script src="script.js"></script>'); await core.writeFile(ctx, P, 'script.js', 'let ok = 1;');
  const probs = await core.check(ctx, P); ok('the check finds a dead link and a duplicate id', probs.some(p => /nope\.html/.test(p)) && probs.some(p => /"a" is used more than once/.test(p)), probs.join(' | '));
  await core.writeFile(ctx, P, 'index.html', '<h1>hi</h1><script src="script.js"></script>'); ok('a clean project has no problems', (await core.check(ctx, P)).length === 0);
  // secrets: same guarantees as the PC
  const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', OAI = 'sk-proj-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7';
  const cases = [['.env', 'DATABASE_URL=postgres://u:p@h/db\nAPI_KEY=abcd1234efgh5678\nSECRET_KEY=zyxw9876vuts5432\nDEBUG=true', ['abcd1234efgh5678', 'zyxw9876vuts5432']], ['JSON', '{"apiKey": "abcd1234efgh5678ijkl", "password": "correct-horse-battery"}', ['abcd1234efgh5678ijkl', 'correct-horse-battery']], ['curl', 'curl -H "Authorization: Bearer ' + GH + '" https://api.github.com', [GH]], ['YAML', 'client_secret: abcd1234efgh5678\naccess_token: qwertyuiop12345678', ['abcd1234efgh5678', 'qwertyuiop12345678']], ['in words', 'my password is hunter2hunter2 ok', ['hunter2hunter2']], ['quoted', 'const s = "password=Sup3rS3cretPass";', ['Sup3rS3cretPass']], ['camelCase', 'apiKey=abcd1234efgh5678 and clientSecret=zyxw9876vuts5432', ['abcd1234efgh5678', 'zyxw9876vuts5432']], ['two keys', 'first ' + OAI + '\nsecond ' + GH, [OAI, GH]], ['export', 'export OPENAI_API_KEY="' + OAI + '"', [OAI]]];
  for (const [l, t, vals] of cases) { const r = core.scanSecrets(t); ok('no value survives: ' + l, vals.every(v => !r.redacted.includes(v)), r.redacted); }
  for (const safe of ['I love api keys and tokens', 'API_KEY=your_api_key_here', 'TOKEN=process.env.TOKEN', 'const token = getToken();', 'SECRET=xxxxxxxx', 'AUTH=true']) ok('not a secret: "' + safe + '"', core.scanSecrets(safe).found.length === 0);
  const { ctx: c4, secrets } = memory(core); await core.createProject(c4, 's'); let r = await core.protectMessage(secrets, 's', 'use ' + GH + ' and OPENAI_API_KEY=' + OAI);
  ok('a pasted message is saved and cleaned', r.saved.length === 2 && !r.text.includes(GH) && !r.text.includes(OAI) && /GITHUB_TOKEN/.test(r.notice) && !r.notice.includes(GH), JSON.stringify(r));
  let msg = ''; for (let i = 0; i < 12; i++) msg += 'EXTRA_KEY_' + i + '_TOKEN=tokenvalue' + i + '12345 '; r = await core.protectMessage(secrets, 's2', msg);
  ok('past 10 nothing stays in the open and the user is told', r.saved.length === 10 && r.dropped.length === 2 && !/tokenvalue\d12345/.test(r.text) && /could not be saved/.test(r.notice));
  await core.createProject(c4, 'leak'); await secrets.set('leak', 'MY_KEY', 'topsecretvalue99', 'manual'); await core.writeFile(c4, 'leak', 'a.js', 'const k = "topsecretvalue99";'); ok('a saved value can never be written into a file', !(await core.readFile(c4, 'leak', 'a.js')).includes('topsecretvalue99') && (await core.readFile(c4, 'leak', 'a.js')).includes('{{secret:MY_KEY}}'));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
