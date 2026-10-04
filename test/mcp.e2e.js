// Pholama as an MCP server for ChatGPT: off by default, needs a key, four read-only tools, nothing else reachable.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mcp-')), port = 29000 + Math.floor(Math.random() * 3000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let KEY = '';
  const rpc = (m, h = {}) => fetch(B + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(KEY ? { Authorization: 'Bearer ' + KEY } : {}), ...h }, body: typeof m === 'string' ? m : JSON.stringify(m) });
  const call = async (name, args) => (await (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).json());
  try {
    let r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }); ok('OFF by default', r.status === 404, r.status);
    r = await fetch(B + '/api/mcp-server'); let j = await r.json(); ok('switch reads as off', j.on === false && j.tools.length === 4, JSON.stringify(j));
    r = await fetch(B + '/api/mcp-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) }); ok('owner turns it on from the PC', (await r.json()).on === true);
    // auth: a key is ALWAYS needed, even from this PC
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }); ok('no key = refused, even from this PC', r.status === 401, r.status);
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer phk_notarealkey000000000000000000' }); ok('wrong key = refused', r.status === 401, r.status);
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer ' }); ok('empty key = refused', r.status === 401, r.status);
    r = await fetch(B + '/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'ChatGPT' }) }); const kj = await r.json(); KEY = kj.key;
    ok('owner makes a ChatGPT key on the PC', /^phk_/.test(KEY), JSON.stringify(kj));
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'Tailscale-Funnel-Request': '?1' }); ok('a tunnel request with the right key works', r.status === 200, r.status);
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'X-Api-Key': KEY, Authorization: '' }); ok('the X-API-Key header works too', r.status === 200, r.status);
    r = await fetch(B + '/api/mcp-server', { headers: { 'Tailscale-Funnel-Request': '?1' } }); ok('the on/off switch is refused from a tunnel', r.status === 403 || r.status === 401, r.status);
    r = await fetch(B + '/api/mcp-server', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Tailscale-Funnel-Request': '?1', Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ on: false }) }); ok('even the right key cannot flip the switch (PC only)', r.status === 403 || r.status === 401, r.status);
    r = await fetch(B + '/api/keys', { headers: { 'Tailscale-Funnel-Request': '?1', Authorization: 'Bearer ' + KEY } }); ok('the ChatGPT key cannot list or make keys', r.status === 403 || r.status === 401, r.status);
    r = await fetch(B + '/api/studio/projects', { headers: { 'Tailscale-Funnel-Request': '?1', Authorization: 'Bearer ' + KEY } }); ok('the ChatGPT key cannot reach Studio', r.status === 403 || r.status === 401, r.status);
    // protocol
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chatgpt', version: '1' } } }); j = await r.json();
    ok('initialize answers with the same protocol version', j.result && j.result.protocolVersion === '2025-06-18' && j.result.serverInfo.name === 'pholama' && j.result.capabilities.tools, JSON.stringify(j));
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }); j = await r.json(); ok('unknown version gets our newest', j.result.protocolVersion === '2025-06-18', JSON.stringify(j));
    r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }); ok('notification gets 202 and no body', r.status === 202 && (await r.text()) === '', r.status);
    r = await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' }); ok('ping works', (await r.json()).result !== undefined);
    j = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).json(); const names = j.result.tools.map(t => t.name).sort();
    ok('exactly four tools', JSON.stringify(names) === JSON.stringify(['credits_left', 'list_models', 'pholama_news', 'web_search']), names.join());
    ok('every tool is marked read-only with a schema', j.result.tools.every(t => t.annotations.readOnlyHint === true && t.inputSchema.type === 'object'));
    ok('no dangerous tool is listed', !names.some(n => /file|write|terminal|shell|github|key|studio|cmd|delete/i.test(n)));
    // tools work
    j = await call('pholama_news', { limit: 2 }); ok('news returns real release text', j.result && !j.result.isError && /v\d+\.\d+\.\d+/.test(j.result.content[0].text), JSON.stringify(j).slice(0, 300));
    j = await call('credits_left', {}); ok('credits returns a number', /\d+ credits left/.test(j.result.content[0].text), JSON.stringify(j));
    j = await call('list_models', {}); ok('models returns text', j.result && typeof j.result.content[0].text === 'string', JSON.stringify(j));
    j = await call('web_search', { query: 'x' }); ok('too-short search is a tool error, not a crash', j.result && j.result.isError === true, JSON.stringify(j));
    j = await call('pholama_news', { limit: 'DROP TABLE' }); ok('nonsense argument falls back to a default', j.result && !j.result.isError, JSON.stringify(j).slice(0, 200));
    // nothing else reachable
    for (const n of ['studio_write', 'write_file', 'run_command', 'github_push', 'read_file', 'delete_file']) { j = await call(n, { file: '/etc/passwd', content: 'x', command: 'id' }); ok('cannot call ' + n, j.error && j.error.code === -32602, JSON.stringify(j).slice(0, 200)); }
    j = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).json(); ok('unknown method is an error', j.error && j.error.code === -32601, JSON.stringify(j));
    j = await (await rpc('{bad json')).json(); ok('bad JSON is a parse error', j.error && j.error.code === -32700);
    j = await (await rpc({ hello: 1 })).json(); ok('not JSON-RPC is invalid', j.error && j.error.code === -32600);
    j = await (await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }])).json(); ok('batch works', Array.isArray(j) && j.length === 2, JSON.stringify(j).slice(0, 200));
    r = await rpc(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))); ok('too big a batch is refused', r.status === 400, r.status);
    { let st = 'dropped'; try { st = (await rpc('x'.repeat(200000))).status; } catch {} ok('huge body is refused (413 or the connection is cut)', st === 413 || st === 'dropped', st); }
    j = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'ping' })).json(); ok('server still fine after the huge body', j.result !== undefined, JSON.stringify(j));
    r = await fetch(B + '/mcp'); ok('GET without a key is 401 (reveals nothing)', r.status === 401, r.status);
    r = await fetch(B + '/mcp', { headers: { Authorization: 'Bearer ' + KEY } }); ok('GET with a key is not allowed (stateless)', r.status === 405, r.status);
    // the website origin rule still applies
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'https://evil.example.com' }); ok('a random website cannot call it from a browser', r.status === 403, r.status);
    // revoke: the key stops working at once
    { const list = await (await fetch(B + '/api/keys')).json(); const id = (list.keys.find(k => k.label === 'ChatGPT') || {}).id; const d = await fetch(B + '/api/keys?id=' + id, { method: 'DELETE' }); ok('owner removes the key', d.ok);
      r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }); ok('a removed key stops working at once', r.status === 401, r.status); }
    // guessing keys gets locked out (needs a real key to exist, otherwise there is nothing to guess)
    r = await fetch(B + '/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'ChatGPT' }) }); KEY = (await r.json()).key;
    { let last = 0; for (let i = 0; i < 30; i++) { last = (await rpc({ jsonrpc: '2.0', id: i, method: 'ping' }, { Authorization: 'Bearer phk_guess' + i + 'x'.repeat(24) })).status; if (last === 429) break; }
      ok('too many wrong guesses get locked out (429)', last === 429, last);
      r = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }); ok('and then even the right key waits', r.status === 429, r.status); }
    // turn off again
    r = await fetch(B + '/api/mcp-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) }); ok('owner turns it off', (await r.json()).on === false);
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }); ok('off means off again', r.status === 404, r.status);
    ok('switch file is private', process.platform === 'win32' || (fs.statSync(path.join(home, '.pholama', 'mcp-server.json')).mode & 0o777) === 0o600);
  } finally { srv.kill('SIGKILL'); await wait(300); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
