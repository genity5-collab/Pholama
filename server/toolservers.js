// Pholama tool servers (an MCP client; NOT the removed ChatGPT door): lets the AI use tools from ANY Model Context Protocol server (stdio), the same way editors like Cursor do.
// A server is a program the user adds (for example the bundled "pholama-files" one, or any npx/python MCP server).
// Safety: the AI never starts a program. Only the USER adds a server (name + command), it is saved on this PC, and every
// call to its tools is treated as ADMIN by the tool gate (asks the user first, cannot be switched off).
// Zero dependencies: this speaks newline-delimited JSON-RPC 2.0 over the child's stdin/stdout.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

const HOME = () => process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const CONFIG = () => path.join(HOME(), 'mcp-servers.json');
const NAME = /^[a-z][a-z0-9]{1,15}$/;               // server id: short, no underscores, so mcp_<id>_<tool> stays unambiguous
const TOOL_PREFIX = 'mcp_', CALL_MS = 60000, START_MS = 20000, MAX_TOOLS = 40, MAX_OUT = 16000;
const live = new Map();                            // id -> { proc, tools, pending, buf, ready }

// ---------- saved servers ----------
function readAll() { try { const j = JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeAll(o) { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(o, null, 1)); }
function validate(id, cfg) {
  if (!NAME.test(String(id))) throw new Error('Server name: 2-16 lowercase letters/digits, starting with a letter.');
  if (!cfg || typeof cfg.command !== 'string' || !cfg.command.trim() || cfg.command.length > 300) throw new Error('A server needs a command.');
  if (/[\r\n\0]/.test(cfg.command)) throw new Error('That command is not allowed.');
  const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  if (args.length > 40 || args.some(a => a.length > 600 || /\0/.test(a))) throw new Error('Too many or too long arguments.');
  const env = {}; for (const [k, v] of Object.entries(cfg.env || {})) { if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) throw new Error('Bad variable name: ' + k); env[k] = String(v).slice(0, 2000); }
  return { command: cfg.command.trim(), args, env, enabled: cfg.enabled !== false };
}
function add(id, cfg) { const c = validate(id, cfg), all = readAll(); all[id] = c; writeAll(all); return c; }
function remove(id) { stop(id); const all = readAll(); const had = id in all; delete all[id]; writeAll(all); return had; }
function list() { const all = readAll(); return Object.entries(all).map(([id, c]) => ({ id, command: c.command, args: c.args, enabled: c.enabled !== false, running: live.has(id) && live.get(id).ready, tools: (live.get(id) && live.get(id).tools || []).length })); }

// ---------- JSON-RPC over stdio ----------
function send(s, msg) { try { s.proc.stdin.write(JSON.stringify(msg) + '\n'); return true; } catch { return false; } }
function request(s, method, params, ms = CALL_MS) {
  return new Promise((resolve, reject) => {
    const id = s.next++, t = setTimeout(() => { s.pending.delete(id); reject(new Error('The tool server did not answer in time.')); }, ms);
    s.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
    if (!send(s, { jsonrpc: '2.0', id, method, params })) { clearTimeout(t); s.pending.delete(id); reject(new Error('The tool server is not running.')); }
  });
}
function onData(s, chunk) {
  s.buf += chunk; let i;
  while ((i = s.buf.indexOf('\n')) >= 0) {
    const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }          // servers may print logs: ignore anything that is not JSON
    if (m && m.id != null && s.pending.has(m.id)) { const p = s.pending.get(m.id); s.pending.delete(m.id); m.error ? p.reject(new Error(String(m.error.message || 'tool server error').slice(0, 300))) : p.resolve(m.result); }
  }
  if (s.buf.length > 4e6) s.buf = '';                                  // never grow without limit
}
async function start(id) {
  if (live.has(id) && live.get(id).ready) return live.get(id);
  const cfg = readAll()[id]; if (!cfg) throw new Error('No tool server called ' + id + '.');
  if (cfg.enabled === false) throw new Error('That tool server is switched off.');
  const proc = cp.spawn(cfg.command, cfg.args || [], { env: { ...process.env, ...(cfg.env || {}), PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  const s = { proc, tools: [], pending: new Map(), buf: '', next: 1, ready: false, err: '' };
  live.set(id, s);
  proc.stdout.setEncoding('utf8'); proc.stdout.on('data', d => onData(s, d));
  proc.stderr.setEncoding('utf8'); proc.stderr.on('data', d => { s.err = (s.err + d).slice(-600); });
  const fail = e => { for (const p of s.pending.values()) p.reject(e); s.pending.clear(); s.ready = false; if (live.get(id) === s) live.delete(id); };
  proc.on('error', e => fail(new Error('Could not start the tool server: ' + (e.code === 'ENOENT' ? cfg.command + ' was not found. Is it installed?' : e.message))));
  proc.on('exit', () => fail(new Error('The tool server stopped.' + (s.err ? ' ' + s.err.trim().slice(-200) : ''))));
  try {
    await request(s, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pholama', version: '1' } }, START_MS);
    send(s, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const r = await request(s, 'tools/list', {}, START_MS);
    s.tools = (r && Array.isArray(r.tools) ? r.tools : []).slice(0, MAX_TOOLS).filter(t => t && /^[A-Za-z0-9_.-]{1,64}$/.test(t.name || ''));
    s.ready = true; return s;
  } catch (e) { stop(id); throw e; }
}
function stop(id) { const s = live.get(id); if (!s) return; live.delete(id); s.ready = false; try { s.proc.kill(); } catch {} }
function stopAll() { for (const id of [...live.keys()]) stop(id); }

// ---------- how the AI sees it ----------
const safeName = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
const toolId = (server, tool) => `${TOOL_PREFIX}${server}_${safeName(tool)}`;
const isMcpTool = name => typeof name === 'string' && name.startsWith(TOOL_PREFIX) && /^mcp_[a-z][a-z0-9]{1,15}_[a-z0-9_]{1,28}$/.test(name);
async function asTools() {
  const out = [];
  for (const [id, c] of Object.entries(readAll())) {
    if (c.enabled === false) continue;
    let s; try { s = await start(id); } catch { continue; }          // a broken server never breaks the chat
    for (const t of s.tools) out.push({ name: toolId(id, t.name), desc: String(t.description || t.name).slice(0, 200).replace(/\s+/g, ' ') + ' Arguments ' + signature(t.inputSchema) + ' (tool server: ' + id + ')', params: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }, kind: 'mcp', server: id, tool: t.name });
  }
  return out;
}
function textOf(r) {
  if (!r) return '(no result)';
  const parts = Array.isArray(r.content) ? r.content.map(c => c && c.type === 'text' ? String(c.text) : c && c.type === 'image' ? '[image]' : c ? JSON.stringify(c).slice(0, 400) : '').filter(Boolean) : [];
  const t = (parts.join('\n') || (r.structuredContent ? JSON.stringify(r.structuredContent) : '') || '(empty result)').slice(0, MAX_OUT);
  return r.isError ? 'Tool error: ' + t : t;
}
async function call(name, args) {
  if (!isMcpTool(name)) throw new Error('That is not a tool-server tool.');
  for (const [id] of Object.entries(readAll())) {
    if (!name.startsWith(TOOL_PREFIX + id + '_')) continue;
    const s = await start(id), t = s.tools.find(x => toolId(id, x.name) === name);
    if (!t) continue;
    return textOf(await request(s, 'tools/call', { name: t.name, arguments: args && typeof args === 'object' ? args : {} }));
  }
  throw new Error('That tool no longer exists.');
}
// A short, exact signature a small model can copy: mcp_files_read_file(path*: text, max_bytes: whole number). * = required.
function signature(schema) {
  const props = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {}, req = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
  const kind = t => ({ string: 'text', integer: 'whole number', number: 'number', boolean: 'true/false', array: 'list', object: 'object' }[Array.isArray(t) ? t[0] : t] || 'value');
  const parts = Object.entries(props).slice(0, 8).map(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k) ? k + (req.has(k) ? '*' : '') + ': ' + kind(v && v.type) : null).filter(Boolean);
  return '(' + (parts.join(', ') || 'no arguments') + ')';
}
function schemaOf(name) { for (const [id, s] of live) { if (!s.ready) continue; const t = s.tools.find(x => toolId(id, x.name) === name); if (t) return t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }; } return null; }
module.exports = { signature, schemaOf, NAME, TOOL_PREFIX, validate, add, remove, list, start, stop, stopAll, asTools, call, isMcpTool, toolId, textOf, CONFIG };
