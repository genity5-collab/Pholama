// Your own API key, end to end on the real server with a fake provider.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
const KEY = 'gsk_TESTKEY_9f8e7d6c5b4a3210';
async function main() {
  const seen = [];
  const prov = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    seen.push({ url: q.url, auth: q.headers.authorization, body: b });
    if (/BADKEY/.test(q.headers.authorization || '')) { s.statusCode = 401; s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ error: { message: 'Invalid key ' + (q.headers.authorization || '') } })); return; }
    s.setHeader('Content-Type', 'text/event-stream');
    for (const t of ['Hello ', 'from ', 'the ', 'cloud.']) s.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
    s.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 4 } }) + '\n\ndata: [DONE]\n\n'); s.end(); }); }).listen(0, '127.0.0.1');
  await wait(200); const pport = prov.address().port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-byok-')); const port = 31000 + Math.floor(Math.random() * 4000);
  // seed one provider pointing at the fake server (the module only allows http for localhost, which is exactly this case)
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_TEST_NO_KEYCHECK: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const J = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
  try {
    let r = await J('/api/providers', { method: 'POST', body: JSON.stringify({ kind: 'custom', key: KEY, model: 'test-model', base: 'http://127.0.0.1:' + pport + '/v1', name: 'Fake Cloud' }) }); let j = await r.json();
    ok('adding a key works', r.ok && j.provider && j.provider.id, JSON.stringify(j));
    const id = j.provider.id;
    ok('the reply to adding never contains the key', !JSON.stringify(j).includes('TESTKEY'), JSON.stringify(j));
    r = await J('/api/providers'); const lt = await r.text(); ok('listing never contains the key', !lt.includes('TESTKEY') && lt.includes('Fake Cloud'), lt);
    const models = await (await J('/api/tags')).text(); ok('the model shows in the model list', models.includes('byok:' + id), models.slice(0, 300));
    { const cj = await (await J('/api/caps?model=' + encodeURIComponent('byok:' + id))).json(); ok('a custom address is NOT trusted with tools (basic)', cj.tier === 'basic' && cj.tools === false, JSON.stringify(cj));
      const g = await (await J('/api/providers', { method: 'POST', body: JSON.stringify({ kind: 'groq', key: 'gsk_abcdefgh1234' }) })).json();
      const gj = await (await J('/api/caps?model=' + encodeURIComponent('byok:' + g.provider.id))).json(); ok('a known company (Groq) is a full tool model', gj.tier === 'good' && gj.tools === true, JSON.stringify(gj)); }
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + id, messages: [{ role: 'user', content: 'hi there' }] }) }); const t = await r.text();
    ok('chat streams the provider reply', /Hello /.test(t) && /cloud\./.test(t), t.slice(0, 400));
    ok('the key reached the provider as a Bearer token', seen.some(s => s.auth === 'Bearer ' + KEY && s.url === '/v1/chat/completions'), JSON.stringify(seen.map(s => s.url + ' ' + s.auth)));
    ok('the key is NOT in anything sent back to the page', !t.includes('TESTKEY'), t);
    // chat with agent + tools on, no crash
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + id, agent: true, messages: [{ role: 'user', content: 'say hi' }] }) }); const ta = await r.text();
    ok('agent mode works through a hosted model', /Hello /.test(ta) && !/could not get it right|Error/.test(ta), ta.slice(0, 500));
    // bad key: error is friendly and does not echo the key
    const bad2 = await (await J('/api/providers', { method: 'POST', body: JSON.stringify({ kind: 'custom', key: 'BADKEY_abcdefgh', model: 'test-model', base: 'http://127.0.0.1:' + pport + '/v1', name: 'Bad' }) })).json();
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + bad2.provider.id, messages: [{ role: 'user', content: 'hi' }] }) }); const tb = await r.text();
    ok('a refused key gives a clear message', /refused|HTTP 401/.test(tb), tb.slice(0, 500));
    ok('the refused key is not echoed back', !/BADKEY_abcdefgh/.test(tb), tb);
    // the public website origin may not touch keys
    r = await J('/api/providers', { headers: { Origin: 'https://evil.example.com' } }); ok('a website cannot list keys', r.status === 403, r.status);
    r = await J('/api/providers', { method: 'POST', headers: { Origin: 'https://evil.example.com' }, body: JSON.stringify({ kind: 'openai', key: 'abcdefgh1234' }) }); ok('a website cannot add keys', r.status === 403, r.status);
    r = await J('/api/providers?id=' + id, { method: 'DELETE', headers: { Origin: 'https://evil.example.com' } }); ok('a website cannot delete keys', r.status === 403, r.status);
    // a private address is refused through the API too
    r = await J('/api/providers', { method: 'POST', body: JSON.stringify({ kind: 'custom', key: 'abcdefgh1234', model: 'm', base: 'https://192.168.0.1/v1' }) }); ok('private network address refused by the API', r.status === 400, r.status);
    // delete
    r = await J('/api/providers?id=' + id, { method: 'DELETE' }); ok('delete works', (await r.json()).ok === true);
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + id, messages: [{ role: 'user', content: 'hi' }] }) }); const td = await r.text(); ok('a removed key gives a clear message', /removed/.test(td), td.slice(0, 300));
    ok('the key file on disk is private', process.platform === 'win32' || (fs.statSync(path.join(home, '.pholama', 'providers.json')).mode & 0o777) === 0o600);
  } finally { srv.kill('SIGKILL'); prov.close(); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
