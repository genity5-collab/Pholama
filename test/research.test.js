// "Research what this API key can do": the key never leaves the PC, links are picked safely, suggestions are checked.
const r = require('../server/research.js'), ut = require('../server/usertools.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 220))); if (!c) bad++; };

// ---- a key can never end up in the search
// Fake keys in the SHAPE of real ones, assembled at run time so no key-shaped text sits in the source (GitHub's secret scanner would rightly block it).
const J = (...p) => p.join(''), Z = '0123456789abcdef';
const KEYS = [J('s', 'k-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'), J('gh', 'p_', '1234567890abcdefghijklmnopqrstuvwxyz'), J('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc'), J('AI', 'zaSyA1234567890abcdefghijklmnopqrstuv'), J('xo', 'xb-1234567890-abcdefghij'), J('sb', 'p_', Z, Z, '01234567'), J('AK', 'IAIOSFODNN7EXAMPLE'), Z + Z, J('github', '_pat_11ABCDEFG0abcdefghijklmnop')];
for (const k of KEYS) {
  ok('key pasted into the service box is dropped: ' + k.slice(0, 10) + '...', !r.queryFor('Supabase ' + k).includes(k.slice(0, 12)) && !r.cleanService('Supabase ' + k).includes(k.slice(0, 12)), r.queryFor('Supabase ' + k));
  ok('…and the service name survives', /Supabase/.test(r.queryFor('Supabase ' + k)));
}
ok('a service that is ONLY a key gives no search at all', r.queryFor(KEYS[0]) === '' && r.cleanService(KEYS[2]) === '');
ok('a normal name becomes a docs search', r.queryFor('Supabase') === 'Supabase REST API reference documentation endpoints');
ok('names with spaces and symbols are kept readable', r.cleanService('  Google  Calendar ') === 'Google Calendar' && r.cleanService('Cloud&Co+') === 'Cloud&Co+');
ok('odd characters cannot shape the search', !/[<>"'`;|\\]/.test(r.cleanService('x"; rm -rf <script>')));
ok('empty and non-text input is safe', r.cleanService(null) === '' && r.cleanService(undefined) === '' && r.cleanService(123) === '123' && r.queryFor('') === '');
ok('a very long name is cut', r.cleanService('a'.repeat(300)).length <= 60);

// ---- picking documentation links from a search page
const HTML = '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fsupabase.com%2Fdocs%2Freference%2Fapi">a</a><a href="https://www.reddit.com/r/x">r</a><a href="https://blog.example.com/post">b</a>' +
  '<a href="https://api.notion.com/v1/docs">n</a><a href="http://insecure.example.com/docs">i</a><a href="https://user:pw@evil.com/docs">u</a><a href="/relative">x</a><a href="https://supabase.com/docs/reference/api">dup</a><a href="https://youtube.com/watch?v=1">y</a>';
const links = r.docLinks(HTML, 'x');
ok('real API docs come first', /docs/.test(links[0]) && links.some(l => l.includes('supabase.com/docs')), links);
ok('social sites are skipped', !links.some(l => /reddit|youtube/.test(l)));
ok('non-https links are skipped', !links.some(l => l.startsWith('http://')));
ok('links carrying a username or password are skipped', !links.some(l => /evil\.com/.test(l)));
ok('relative links and duplicates are skipped', !links.includes('/relative') && links.filter(l => l.includes('supabase.com/docs')).length === 1);
ok('at most 4 links', r.docLinks(Array.from({ length: 20 }, (_, i) => '<a href="https://d' + i + '.example.com/api">x</a>').join('')).length <= 4);
ok('junk input gives no links and never throws', r.docLinks(null).length === 0 && r.docLinks('').length === 0 && r.docLinks('<a href="%%%">').length === 0);
ok('digest strips scripts, styles and tags', (() => { const d = r.digest('<style>b{}</style><script>evil()</script><h1>List users</h1><p>GET /users</p>'); return d === 'List users GET /users'; })());
ok('digest is capped', r.digest('word '.repeat(5000)).length <= 3500 && r.digest(null) === '');

// ---- reading the model's answer
ok('a JSON list is read', r.parseList('[{"name":"a"},{"name":"b"}]').length === 2);
ok('a list wrapped in chat text and a think block is read', r.parseList('<think>x</think>Sure!\n```json\n[{"name":"a"}]\n```').length === 1);
ok('bad JSON gives an empty list, not an error', r.parseList('[{"name":').length === 0 && r.parseList('no json').length === 0 && r.parseList(null).length === 0);
ok('non-object items are dropped', r.parseList('[1,"x",null,{"name":"a"}]').length === 1);

// ---- turning it into safe suggestions
const check = ut.problem;
const good = { name: 'list_users', title: 'List users', what: 'Lists users', method: 'GET', url: 'https://api.example.com/v1/users?limit={{count}}', headers: { Authorization: 'Bearer {{secret.MY_KEY}}' }, body: '', params: ['count'] };
const S = (list, extra) => r.suggestions(list, { secretName: 'MY_KEY', secretValues: ['REALKEY12345'], check, existing: [], ...extra });
ok('a good tool is suggested', S([good]).length === 1 && S([good])[0].name === 'list_users');
ok('reading tools are not marked as writing, others are', S([good])[0].writes === false && S([{ ...good, name: 'make_user', method: 'POST', body: '{"n":"{{n}}"}', params: ['n'] }])[0].writes === true);
ok('a real key the model wrote out is replaced by its secret name', (() => { const s = S([{ ...good, url: 'https://api.example.com/v1/users?k=REALKEY12345', headers: { Authorization: 'Bearer REALKEY12345' } }])[0]; return s && !JSON.stringify(s).includes('REALKEY12345') && /\{\{secret\.MY_KEY\}\}/.test(JSON.stringify(s)); })());
ok('a tool using a DIFFERENT secret name is dropped', S([{ ...good, headers: { Authorization: 'Bearer {{secret.OTHER}}' } }]).length === 0);
ok('an http:// address is dropped', S([{ ...good, url: 'http://api.example.com/x' }]).length === 0);
ok('an address with a built-in password is dropped', S([{ ...good, url: 'https://u:p@api.example.com/x' }]).length === 0);
ok('a bad name is dropped', S([{ ...good, name: '!!' }]).length === 0 && S([{ ...good, name: '' }]).length === 0);
ok('a duplicate name gets a number instead of replacing another tool', (() => { const s = S([good, good]); return s.length === 2 && s[0].name === 'list_users' && s[1].name === 'list_users_2'; })());
ok('a name already in use on this PC is not reused', S([good], { existing: ['list_users'] })[0].name === 'list_users_2');
ok('a mix keeps only the good ones', S([good, { ...good, name: 'bad', url: 'ftp://x' }, { ...good, name: 'fine_two', url: 'https://api.example.com/two' }]).length === 2);
ok('no more than 6 come back', S(Array.from({ length: 10 }, (_, i) => ({ ...good, name: 'tool_' + i, url: 'https://api.example.com/' + i }))).length === 6);
ok('with no key at all, a tool that needs one is dropped', r.suggestions([good], { secretName: '', secretValues: [], check, existing: [] }).length === 0);
ok('with no key, a tool that needs none is kept', r.suggestions([{ ...good, headers: {}, name: 'open_data' }], { secretName: '', secretValues: [], check, existing: [] }).length === 1);
ok('garbage never throws', (() => { try { r.suggestions(null, {}); r.suggestions([null, 1, 'x', {}], { check }); r.suggestions([{ name: 'abc', url: 5, headers: 'x', params: 'y' }], { check }); return true; } catch { return false; } })());
ok('the prompt forbids real keys and insists on https and one secret', /NEVER write a real key/.test(r.PROMPT) && /MUST be https/.test(r.PROMPT) && /ONLY the secret name/.test(r.PROMPT));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
