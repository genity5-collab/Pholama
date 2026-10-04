// MCP server logic on its own (no network): protocol, clamping, and that no dangerous tool can be named.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mcpu-'));
const M = require('../server/mcp');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const seen = []; const deps = { version: '9.9.9', news: async l => { seen.push(['news', l]); return 'n'; }, search: async q => { seen.push(['search', q]); return 's'; }, models: async () => 'm', credits: async () => 'c' };
  ok('off by default', M.isOn() === false);
  ok('turn on / off', M.setOn(true) === true && M.isOn() === true && M.setOn(false) === false);
  ok('only "true" turns it on', M.setOn('yes') === false && M.setOn(1) === false);
  let r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, deps); ok('older client version is echoed', r.result.protocolVersion === '2024-11-05' && r.result.serverInfo.version === '9.9.9');
  r = await M.handle({ jsonrpc: '2.0', id: 'abc', method: 'ping' }, deps); ok('string ids are kept', r.id === 'abc');
  r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pholama_news', arguments: { limit: 999 } } }, deps); ok('limit is clamped to 5', seen.pop()[1] === 5);
  await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pholama_news', arguments: { limit: -4 } } }, deps); ok('negative limit clamps to 1', seen.pop()[1] === 1);
  await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pholama_news', arguments: [1, 2] } }, deps); ok('array arguments fall back to default 3', seen.pop()[1] === 3);
  await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'web_search', arguments: { query: '  hello\u0000 world  ' + 'x'.repeat(500) } } }, deps); const q = seen.pop()[1]; ok('search query is cleaned and cut to 200', q.length <= 200 && !q.includes('\u0000') && q.startsWith('hello'));
  r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'credits_left', arguments: { extra: 'ignored' } } }, deps); ok('extra arguments are ignored', r.result.content[0].text === 'c');
  const long = { ...deps, models: async () => 'y'.repeat(50000) }; r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_models' } }, long); ok('replies are cut to a fixed size', r.result.content[0].text.length <= M.MAX_TEXT);
  const boom = { ...deps, credits: async () => { throw new Error('secret path /home/x/.pholama/key ' + 'z'.repeat(500)); } }; r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'credits_left' } }, boom); ok('a failing tool is an error result (not a crash) and the message is short', r.result.isError === true && r.result.content[0].text.length < 260, r.result.content[0].text.length);
  for (const n of ['__proto__', 'constructor', 'toString', 'studio_write', '../../etc/passwd', '']) { r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: n } }, deps); ok('name "' + n + '" is unknown', r.error && r.error.code === -32602, JSON.stringify(r)); }
  r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 42 } }, deps); ok('non-string name refused', r.error && r.error.code === -32602);
  r = await M.handle(null, deps); ok('null message is invalid', r.error.code === -32600);
  r = await M.handle({ jsonrpc: '1.0', id: 1, method: 'ping' }, deps); ok('wrong jsonrpc version is invalid', r.error.code === -32600);
  r = await M.handle({ jsonrpc: '2.0', id: 1, method: 'ping', params: 'x' }, deps); ok('odd params on ping are fine', r.result !== undefined);
  r = await M.handleBody('[]', deps); ok('empty batch is refused', r.status === 400);
  r = await M.handleBody(JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), deps); ok('a batch of only notifications is 202', r.status === 202 && r.body === null);
  r = await M.handleBody('x'.repeat(M.MAX_BODY + 1), deps); ok('body over the limit is 413', r.status === 413);
  ok('TOOLS all read-only and closed schemas', M.TOOLS.every(t => t.annotations.readOnlyHint === true && t.inputSchema.additionalProperties === false));
  ok('mcp.js never touches files/terminal/github itself', !/child_process|require\('\.\/(studio|github|guard)'\)|exec\(|spawn\(/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'mcp.js'), 'utf8')));
  const C = await import(path.join(__dirname, '..', 'web', 'chatgpt.js'));
  ok('address helper adds https and /mcp', C.connectorUrl('a.ts.net') === 'https://a.ts.net/mcp' && C.connectorUrl('https://a.ts.net/mcp/') === 'https://a.ts.net/mcp');
  ok('address helper refuses http and junk', C.connectorUrl('http://a.ts.net') === '' && C.connectorUrl('') === '' && C.connectorUrl('a b') === '');
  ok('address helper drops paths and credentials', C.connectorUrl('https://u:p@a.ts.net/x/y') === 'https://a.ts.net/mcp' || C.connectorUrl('https://u:p@a.ts.net/x/y') === '', C.connectorUrl('https://u:p@a.ts.net/x/y'));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
