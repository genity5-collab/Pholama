// Pholama as an MCP SERVER, so ChatGPT (or any MCP client) can call a few safe, read-only tools on this PC.
// Transport: Streamable HTTP, stateless, plain JSON replies (no sessions, no streaming). Wire format: JSON-RPC 2.0.
// Safety rules, all enforced here and tested:
//   - OFF until the owner turns it on, from the PC itself (the route checks that before calling anything in this file)
//   - only the tools listed in TOOLS exist. No file, terminal, GitHub, key or Studio tool can ever be reached from here
//   - every argument is checked and clamped before use, and every reply is cut to a fixed size
const fs = require('fs'), path = require('path'), os = require('os');
const HOME = process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const FILE = path.join(HOME, 'mcp-server.json');
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 6000, MAX_BODY = 64 * 1024, MAX_BATCH = 8;

function isOn() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).on === true; } catch { return false; } }
function setOn(on) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ on: on === true }), { mode: 0o600 }); return isOn(); }

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const whole = (v, lo, hi, d) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// The only four things ChatGPT may do. Each one is read-only.
const TOOLS = [
  { name: 'pholama_news', description: 'Read the newest Pholama releases and what changed in each.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5, description: 'How many releases (1-5). Default 3.' } }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'web_search', description: 'Search the web for current information using the search built into Pholama.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200, description: 'What to search for.' } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'list_models', description: 'List the AI models installed on this PC and whether they can use tools.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'credits_left', description: 'How many Pholama credits are left today.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
];
const NAMES = new Set(TOOLS.map(t => t.name));

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
const text = (t, isError) => ({ content: [{ type: 'text', text: str(t, MAX_TEXT) || '(nothing)' }], isError: !!isError });

// deps = { news(limit), search(query), models(), credits() }  (passed in by the server, so this file never touches the PC itself)
async function callTool(name, args, deps) {
  if (!NAMES.has(name)) return null;
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  try {
    if (name === 'pholama_news') return text(await deps.news(whole(a.limit, 1, 5, 3)));
    if (name === 'web_search') { const q = str(a.query, 200); if (q.length < 2) return text('Give a search query of at least 2 characters.', true); return text(await deps.search(q)); }
    if (name === 'list_models') return text(await deps.models());
    if (name === 'credits_left') return text(await deps.credits());
  } catch (e) { return text('That did not work: ' + str(e && e.message, 200), true); }
  return null;
}

// One JSON-RPC message in, one out (or null for a notification, which gets no reply).
async function handle(msg, deps) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg && msg.id, -32600, 'Invalid request');
  const { id, method } = msg; const isNote = id === undefined || method.startsWith('notifications/');
  if (isNote) return null;
  if (method === 'initialize') {
    const want = msg.params && msg.params.protocolVersion;
    return ok(id, { protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'pholama', version: deps.version || '0' }, instructions: 'Pholama runs on the owner\'s PC. These tools are read-only: Pholama news, web search, installed models and credits.' });
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const p = msg.params || {}; if (typeof p.name !== 'string') return err(id, -32602, 'Missing tool name');
    const r = await callTool(p.name, p.arguments, deps); if (!r) return err(id, -32602, 'Unknown tool: ' + str(p.name, 60));
    return ok(id, r);
  }
  return err(id, -32601, 'Method not found');
}

// Whole HTTP body (text) -> { status, body } . Handles single messages and batches.
async function handleBody(raw, deps) {
  if (Buffer.byteLength(String(raw || '')) > MAX_BODY) return { status: 413, body: err(null, -32600, 'Too large') };
  let j; try { j = JSON.parse(raw); } catch { return { status: 400, body: err(null, -32700, 'Parse error') }; }
  if (Array.isArray(j)) {
    if (!j.length || j.length > MAX_BATCH) return { status: 400, body: err(null, -32600, 'Batch must have 1 to ' + MAX_BATCH + ' messages') };
    const out = (await Promise.all(j.map(m => handle(m, deps)))).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const r = await handle(j, deps); return r ? { status: 200, body: r } : { status: 202, body: null };
}
module.exports = { TOOLS, PROTOCOLS, MAX_TEXT, MAX_BODY, MAX_BATCH, FILE, isOn, setOn, handle, handleBody, callTool };
