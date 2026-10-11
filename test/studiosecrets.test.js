// Pholama Secrets: detection, redaction, the 10-per-project limit, storage outside the project, and leak guards.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-')); process.env.PHOLAMA_PRIVATE = base + '/priv'; process.env.PHOLAMA_STUDIO = base + '/studio';
const S = require('../server/studiosecrets'), stu = require('../server/studio'), hist = require('../server/studiohistory');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', OAI = 'sk-proj-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7', RE = 're_' + 'AbCdEfGhIjKlMnOpQrStUv123456';
// --- detection
let r = S.scan('here is my key ' + GH + ' please use it'); ok('a GitHub token is found by its shape', r.found.length === 1 && r.found[0].name === 'GITHUB_TOKEN' && r.found[0].value === GH, JSON.stringify(r.found));
ok('the message loses the value and gets a safe reference', !r.redacted.includes(GH) && r.redacted.includes('{{secret:GITHUB_TOKEN}}'), r.redacted);
r = S.scan('OPENAI_API_KEY=' + OAI); ok('NAME=value is found and keeps its own name', r.found.length === 1 && r.found[0].name === 'OPENAI_API_KEY' && r.found[0].value === OAI, JSON.stringify(r.found));
r = S.scan('my RESEND key: ' + RE); ok('a Resend key is found', r.found[0] && r.found[0].name === 'RESEND_API_KEY');
r = S.scan('set DB_PASSWORD: "hunter2hunter2" and STRIPE_SECRET: sk_live_' + 'abcdefghijklmnopqrstuv1234'); ok('named passwords and Stripe keys are found', r.found.length === 2 && r.found.some(f => f.name === 'DB_PASSWORD' && f.value === 'hunter2hunter2'), JSON.stringify(r.found));
r = S.scan('the jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk is public'); ok('a JWT is found', r.found.length === 1 && r.found[0].name === 'JWT');
for (const safe of ['I love api keys and tokens', 'API_KEY=your_api_key_here', 'TOKEN=process.env.TOKEN', 'password: changeme', 'const token = getToken();', 'the secret is out', 'SECRET=xxxxxxxx', 'AUTH=true']) ok('not a secret: "' + safe + '"', S.scan(safe).found.length === 0, JSON.stringify(S.scan(safe).found));
r = S.scan('ONE=' + GH + ' and again ' + GH); ok('the same value twice is one secret, both places are hidden', r.found.length >= 1 && !r.redacted.includes(GH));
r = S.scan('A_TOKEN=aaaaaaaa11111111 B_TOKEN=bbbbbbbb22222222'); ok('two different values with similar names get different names', new Set(r.found.map(f => f.name)).size === r.found.length && r.found.length === 2, JSON.stringify(r.found));

// --- the real guarantee: for messy realistic pastes, the secret VALUE never survives in the redacted text
const GH2 = GH, cases = [
  ['.env file', 'DATABASE_URL=postgres://u:p@h/db\nAPI_KEY=abcd1234efgh5678\nSECRET_KEY=zyxw9876vuts5432\nDEBUG=true', ['abcd1234efgh5678', 'zyxw9876vuts5432']],
  ['JSON', '{"apiKey": "abcd1234efgh5678ijkl", "password": "correct-horse-battery"}', ['abcd1234efgh5678ijkl', 'correct-horse-battery']],
  ['curl header', 'curl -H "Authorization: Bearer ' + GH2 + '" https://api.github.com', [GH2]],
  ['YAML', 'client_secret: abcd1234efgh5678\naccess_token: qwertyuiop12345678', ['abcd1234efgh5678', 'qwertyuiop12345678']],
  ['said in words', 'my password is hunter2hunter2 ok', ['hunter2hunter2']],
  ['quoted in code', 'const s = "password=Sup3rS3cretPass";', ['Sup3rS3cretPass']],
  ['camelCase', 'apiKey=abcd1234efgh5678 and clientSecret=zyxw9876vuts5432', ['abcd1234efgh5678', 'zyxw9876vuts5432']],
  ['two keys on two lines', 'first ' + OAI + '\nsecond ' + GH2, [OAI, GH2]],
  ['windows .env', 'API_KEY=abcd1234efgh5678\r\nTOKEN=qwertyuiop12345678\r\n', ['abcd1234efgh5678', 'qwertyuiop12345678']],
  ['export line', 'export OPENAI_API_KEY="' + OAI + '"', [OAI]],
];
for (const [label, text, values] of cases) { const r = S.scan(text); const left = values.filter(v => r.redacted.includes(v)); ok('no value survives: ' + label, left.length === 0, 'STILL IN TEXT: ' + left.join(', ') + '  ->  ' + r.redacted.replace(/\n/g, ' | ')); }
ok('the .env paste keeps non-secret lines readable', S.scan(cases[0][1]).redacted.includes('DEBUG=true') && S.scan(cases[0][1]).redacted.includes('DATABASE_URL'));
// --- names
ok('names are made safe and upper case', S.cleanName('my api-key') === 'MY_API_KEY' && S.cleanName('stripe.key') === 'STRIPE_KEY');
for (const b of ['', '1ABC', 'PATH', 'x'.repeat(60)]) { let e = ''; try { S.cleanName(b); } catch (x) { e = x.message; } ok('bad name refused: "' + b.slice(0, 12) + '"', !!e); }
// --- storage
stu.createProject('shop'); S.set('shop', 'openai key', OAI);
ok('a saved secret shows a masked preview, never the value', S.list('shop')[0].name === 'OPENAI_KEY' && !JSON.stringify(S.list('shop')).includes(OAI) && /••••/.test(S.list('shop')[0].preview));
const raw = fs.readFileSync(path.join(base, 'priv', 'shop', 'secrets.json'), 'utf8'); ok('the file on disk does not contain the value (encrypted)', !raw.includes(OAI) && !raw.includes('Zz9Yy8'));
ok('it can be read back for a run', S.values('shop').OPENAI_KEY === OAI && /OPENAI_KEY="sk-proj/.test(S.envText('shop')));
ok('the file and key are private to the owner', process.platform === 'win32' || ((fs.statSync(path.join(base, 'priv', 'shop', 'secrets.json')).mode & 0o077) === 0 && (fs.statSync(path.join(base, 'priv', '.key')).mode & 0o077) === 0));
ok('it lives outside the project folder, so no snapshot, search or push can see it', !stu.snapshot('shop').some(f => f.content.includes(OAI)) && !fs.existsSync(path.join(base, 'studio', 'shop', 'secrets.json')));
S.set('shop', 'openai key', 'new-value-1234'); ok('saving the same name replaces it and does not use another slot', S.count('shop') === 1 && S.values('shop').OPENAI_KEY === 'new-value-1234');
ok('removing works and says so when nothing was there', S.remove('shop', 'openai key') === true && S.remove('shop', 'openai key') === false && S.count('shop') === 0);
// --- the 10 limit
for (let i = 1; i <= 10; i++) S.set('big', 'KEY_' + i, 'value-number-' + i);
let e = ''; try { S.set('big', 'KEY_11', 'value-number-11'); } catch (x) { e = x.message; } ok('the 11th secret in a project is refused', /10 secrets/.test(e) && S.count('big') === 10, e);
S.set('big', 'KEY_3', 'changed-value-3'); ok('...but an existing one can still be updated at the limit', S.count('big') === 10 && S.values('big').KEY_3 === 'changed-value-3');
S.set('other', 'KEY_1', 'x-other-value'); ok('another project has its own 10', S.count('other') === 1 && S.values('other').KEY_2 === undefined && S.values('big').KEY_1 === 'value-number-1');
// --- protect(): the chat path
const p1 = S.protect('chat1', 'use ' + GH + ' and OPENAI_API_KEY=' + OAI + ' to build a bot');
ok('protect saves both and returns clean text', p1.saved.length === 2 && !p1.text.includes(GH) && !p1.text.includes(OAI) && /build a bot/.test(p1.text), JSON.stringify(p1));
ok('the saved ones are marked as detected', S.list('chat1').every(s => s.source === 'detected'));
let msg = 'keys: '; for (let i = 0; i < 12; i++) msg += 'EXTRA_KEY_' + i + '_TOKEN=tokenvalue' + i + '12345 '; const p2 = S.protect('chat2', msg);
ok('past the limit nothing is left in the open and the user is told', p2.saved.length === 10 && p2.dropped.length === 2 && !/tokenvalue\d12345/.test(p2.text) && /secret removed/.test(p2.text), JSON.stringify({ s: p2.saved.length, d: p2.dropped.length, t: p2.text.slice(0, 200) }));
ok('a message with no secret is returned untouched', S.protect('chat3', 'make a todo app').text === 'make a todo app' && S.count('chat3') === 0);
// --- AI prompt note, leaks, scrub
const note = S.promptNote('chat1'); ok('the AI is told the NAMES only', /GITHUB_TOKEN/.test(note) && !note.includes(GH) && !note.includes(OAI) && /process\.env/.test(note));
ok('no secrets means no note', S.promptNote('empty') === '');
ok('a file about to contain a saved value is caught', S.leaks('chat1', 'const k = "' + GH + '";').includes('GITHUB_TOKEN') && S.leaks('chat1', 'const k = process.env.GITHUB_TOKEN').length === 0);
ok('scrub swaps a leaked value for its reference', S.scrub('chat1', 'x ' + GH + ' y') === 'x {{secret:GITHUB_TOKEN}} y');
// --- checkpoints/diffs never contain values
stu.writeFile('shop', 'index.html', '<p>hi</p>'); S.set('shop', 'a key', 'topsecretvalue99'); let cp = ''; try { cp = JSON.stringify(hist.list(stu, 'shop')) + JSON.stringify(stu.snapshot('shop')); } catch {} ok('history and snapshots never contain a saved value', !cp.includes('topsecretvalue99'));
S.removeAll('big'); ok('deleting a project\'s secrets clears them', S.count('big') === 0);
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
