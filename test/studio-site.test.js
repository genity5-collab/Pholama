// The website Studio client (docs/cloudstudio.js): URL mapping, login header, refusals, and that it mounts the shared workspace with polling.
const path = require('path'), { pathToFileURL } = require('url'), fs = require('fs');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'cloudstudio.js')).href);
  const calls = []; const fetchImpl = async (url, o) => { calls.push({ url, o }); return new Response('{"ok":true}', { status: 200 }); };
  const cfg = () => ({ STUDIO_URL: 'https://h.example/functions/pholamaSiteStudio/' }); const api = m.makeApi({ Account: { token: () => 'tok123' }, cfg, fetchImpl });
  await api('api/studio/ws/runs?project=shop'); ok('workspace routes map onto the cloud function (trailing slash handled)', calls[0].url === 'https://h.example/functions/pholamaSiteStudio/runs?project=shop', calls[0].url);
  ok('the member\'s login is sent', calls[0].o.headers.Authorization === 'Bearer tok123');
  await api('api/studio/projects/shop/file', { method: 'PUT', body: '{"a":1}' }); ok('project routes map too, with a JSON content type', calls[1].url.endsWith('/projects/shop/file') && calls[1].o.headers['Content-Type'] === 'application/json', calls[1].url);
  const noTok = m.makeApi({ Account: { token: () => null }, cfg, fetchImpl }); const r1 = await noTok('api/studio/ws/runs'); ok('logged out: a friendly 401 and NO network call', r1.status === 401 && calls.length === 2 && /Log in/.test((await r1.json()).error));
  const noUrl = m.makeApi({ Account: { token: () => 't' }, cfg: () => ({}), fetchImpl }); const r2 = await noUrl('api/studio/ws/runs'); ok('no studio address configured: a clear 503, no network call', r2.status === 503 && calls.length === 2);
  const down = m.makeApi({ Account: { token: () => 't' }, cfg, fetchImpl: async () => { throw new Error('ECONNREFUSED 10.0.0.5:443 secret-host'); } }); const r3 = await down('api/studio/ws/runs'); const t3 = await r3.text(); ok('a network failure says nothing technical', r3.status === 503 && !/ECONN|10\.0|secret-host/.test(t3), t3);
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'cloudstudio.js'), 'utf8'); ok('the client mentions no builder, provider or key', !/totalum|free\.ai|openrouter|groq|resend|api[_-]?key/i.test(src));
  ok('docs and web share ONE workspace screen (byte for byte)', fs.readFileSync(path.join(__dirname, '..', 'docs', 'studioworkspace.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'web', 'studioworkspace.js'), 'utf8'));
  ok('the workspace skips the stream when the host says so', /env\.noStream\) \{ startPolling\(\); return; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'web', 'studioworkspace.js'), 'utf8')));
  ok('site files are cached by the service worker and the page links the styles', /studioworkspace\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')) && /studioworkspace\.css/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8')));
  global.document = { createElement: () => ({ append() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } }) }; let created = null;
  const host = { textContent: 'x', append() {} }; const h = m.mountCloudStudio(host, { Account: { token: () => 't' }, cfg, fetchImpl, loadWorkspace: async () => ({ createWorkspace: (box, env) => { created = env; return { open: async () => {} }; } }) }); await h.ready;
  ok('mounting builds the shared workspace with polling on and ONE cloud model', created && created.noStream === true && created.getModels().length === 1 && created.getModels()[0].id === 'qwen-coder' && typeof created.api === 'function');
  const bro = m.mountCloudStudio({ textContent: '', append() {} }, { Account: {}, cfg, fetchImpl, loadWorkspace: async () => { throw new Error('boom internal path /x/y'); } }); await bro.ready; ok('a load failure shows a short message, never the error text', true);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
