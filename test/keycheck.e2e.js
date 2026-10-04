// Adding a ChatGPT / Gemini style key is checked with the company first, and the person gets a model that really exists.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
async function main() {
  const seen = [];
  // A fake company: lists models (incl. junk ones), refuses one key, and has retired gemini-2.0-flash.
  const prov = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    seen.push({ url: q.url, auth: q.headers.authorization, body: b }); s.setHeader('Content-Type', 'application/json');
    if (/BADKEYBADKEY/.test(q.headers.authorization || '')) { s.statusCode = 401; return s.end(JSON.stringify({ error: { message: 'Incorrect API key provided: BADKEYBADKEY' } })); }
    if (q.url.endsWith('/models')) return s.end(JSON.stringify({ data: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-embedding-2' }, { id: 'gemini-3.5-flash-lite' }, { id: 'gemini-3.8-flash-tts' }] }));
    if (q.url.endsWith('/chat/completions')) { const j = JSON.parse(b); if (j.model === 'gemini-2.0-flash') { s.statusCode = 404; return s.end(JSON.stringify({ error: { message: 'models/gemini-2.0-flash is no longer available' } })); }
      s.setHeader('Content-Type', 'text/event-stream'); s.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi from ' + j.model } }] }) + '\n\ndata: [DONE]\n\n'); return s.end(); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await wait(200); const pport = prov.address().port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-kc-')); const port = 33000 + Math.floor(Math.random() * 3000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const J = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
  const custom = (key, model) => J('/api/providers', { method: 'POST', body: JSON.stringify({ kind: 'custom', key, model, base: 'http://127.0.0.1:' + pport + '/v1', name: 'Fake Gemini' }) });
  try {
    // 1. a wrong key is refused, not saved, and never echoed
    let r = await custom('BADKEYBADKEY', 'gemini-3.8-flash'), j = await r.json();
    ok('a wrong key is refused with a plain sentence', r.status === 400 && /key was refused/.test(j.error), JSON.stringify(j));
    ok('the refused key is not echoed anywhere', !JSON.stringify(j).includes('BADKEYBADKEY'), JSON.stringify(j));
    ok('and it was not saved', (await (await J('/api/providers')).json()).providers.length === 0);
    // 2. a retired model name is swapped for one that exists
    r = await custom('GOODKEY123456', 'gemini-2.0-flash'); j = await r.json();
    ok('a retired model is swapped for a live one', r.ok && j.provider.model === 'gemini-3.8-flash', JSON.stringify(j));
    ok('and the person is told', /not available for this key/.test(j.note || ''), JSON.stringify(j));
    ok('the key was checked against the company first', seen.some(x => x.url.endsWith('/models') && x.auth === 'Bearer GOODKEY123456'), JSON.stringify(seen.map(x => x.url)));
    const id = j.provider.id;
    ok('the key is never in the reply', !JSON.stringify(j).includes('GOODKEY123456'));
    // 3. chat really uses the chosen model
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + id, messages: [{ role: 'user', content: 'hello' }] }) }); let t = await r.text();
    ok('chat works with the chosen model', /Hi from gemini-3\.8-flash/.test(t), t.slice(0, 300));
    // 4. Change model: real list only, junk models hidden
    j = await (await J('/api/providers/models?id=' + id)).json();
    ok('the list shows only chat models', JSON.stringify(j.models) === '["gemini-3.8-flash","gemini-3.5-flash-lite"]' || (j.models.length === 2 && !j.models.some(m => /embed|tts/.test(m))), JSON.stringify(j));
    ok('it says the current model is fine', j.currentOk === true && j.current === 'gemini-3.8-flash', JSON.stringify(j));
    r = await J('/api/providers', { method: 'PATCH', body: JSON.stringify({ id, model: 'gemini-3.5-flash-lite' }) }); j = await r.json(); ok('the model can be changed without the key', r.ok && j.provider.model === 'gemini-3.5-flash-lite', JSON.stringify(j));
    r = await J('/api/providers', { method: 'PATCH', body: JSON.stringify({ id, model: 'x; echo hacked' }) }); ok('a junk model name is refused', r.status === 400);
    r = await J('/api/providers', { method: 'PATCH', body: JSON.stringify({ id: 'nope', model: 'a-b' }) }); ok('an unknown key id is refused', r.status === 400);
    // 5. a model that has been retired AFTER saving gives a plain message in chat
    r = await J('/api/providers', { method: 'PATCH', body: JSON.stringify({ id, model: 'gemini-2.0-flash' }) });
    r = await J('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'byok:' + id, messages: [{ role: 'user', content: 'hello' }] }) }); t = await r.text();
    ok('a model retired after saving is explained in chat', /not available any more/.test(t) && !/no longer available\./.test(t.replace(/not available any more/, '')), t.slice(0, 400));
    // 6. remote callers (through a tunnel) can do none of this
    for (const [m, u2] of [['GET', '/api/providers'], ['GET', '/api/providers/models?id=' + id], ['PATCH', '/api/providers'], ['POST', '/api/providers']]) {
      r = await fetch(B + u2, { method: m, headers: { 'Content-Type': 'application/json', 'Tailscale-Funnel-Request': '?1', 'X-Forwarded-For': '203.0.113.5' }, body: m === 'GET' ? undefined : '{}' });
      ok('a remote caller cannot ' + m + ' ' + u2.split('?')[0], r.status === 401 || r.status === 403, r.status);
    }
    ok('the key file is private and the key is only there', (process.platform === 'win32' || (fs.statSync(path.join(home, '.pholama', 'providers.json')).mode & 0o777) === 0o600) && fs.readFileSync(path.join(home, '.pholama', 'providers.json'), 'utf8').includes('GOODKEY123456'));
  } finally { srv.kill('SIGKILL'); prov.close(); await wait(300); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
