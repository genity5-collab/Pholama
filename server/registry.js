// Pholama tool registry: one place that knows every tool's permission level, and a gate every call passes BEFORE it runs.
// It wraps the existing tool loop (agent.js runTool). It adds nothing a model can reach on its own: the model only ever
// names a tool and gives arguments; this file checks them, and the existing handlers do the work.
//
//   READ         looks at things, changes nothing
//   WRITE        creates or changes a file or data (needs approval only if the policy says so)
//   DESTRUCTIVE  deletes or overwrites for good (always needs approval unless the user switched that off)
//   ADMIN        runs commands or changes settings (always needs approval, cannot be switched off)
'use strict';

const LEVELS = Object.freeze(['READ', 'WRITE', 'DESTRUCTIVE', 'ADMIN']);
const RANK = Object.freeze({ READ: 0, WRITE: 1, DESTRUCTIVE: 2, ADMIN: 3 });
const MAX_ARG_BYTES = 20000;         // one call's arguments may not be bigger than this
const MAX_DEPTH = 6;                 // nor nested deeper than this
const DEFAULT_MAX_CALLS = 12;        // tool calls in one answer
const RATE = { windowMs: 60000, perTool: 30, total: 90 };   // calls a minute, per user

// The names the user asked for, mapped onto the tools that already exist.
const ALIASES = Object.freeze({ create_file: 'write_file', get_current_time: 'current_time' });

// id -> { level, schema, timeoutMs }. A tool that is not listed is treated as ADMIN (safest), so a new tool is never silently free.
const REG = new Map();
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (max = 500) => ({ type: 'string', maxLength: max }), num = (min, max) => ({ type: 'number', minimum: min, maximum: max }), int = (min, max) => ({ type: 'integer', minimum: min, maximum: max });

function register(id, level, schema, opts = {}) {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(id)) throw new Error('bad tool id: ' + id);
  if (!LEVELS.includes(level)) throw new Error('bad level for ' + id + ': ' + level);
  REG.set(id, Object.freeze({ id, level, schema, timeoutMs: opts.timeoutMs || 0, approve: opts.approve || null }));
}

// ---- built-ins (names match server/tools2.js and agent.js) ----
register('list_files', 'READ', S({ path: str(300) }));
register('read_file', 'READ', S({ path: str(300), start: int(1, 1e6), end: int(1, 1e6) }, ['path']));
register('search_files', 'READ', S({ query: str(200), path: str(300), pattern: str(200) }));
register('search_code', 'READ', S({ query: str(200), path: str(300), pattern: str(200) }));
register('write_file', 'WRITE', S({ path: str(300), content: str(MAX_ARG_BYTES) }, ['path', 'content']));
register('append_file', 'WRITE', S({ path: str(300), content: str(MAX_ARG_BYTES) }, ['path', 'content']));
register('edit_file', 'WRITE', S({ path: str(300), find: str(MAX_ARG_BYTES), replace: str(MAX_ARG_BYTES) }, ['path', 'find', 'replace']));
register('edit_code', 'WRITE', S({ path: str(300), find: str(MAX_ARG_BYTES), replace: str(MAX_ARG_BYTES) }, ['path', 'find', 'replace']));
register('make_folder', 'WRITE', S({ path: str(300) }, ['path']));
register('delete_file', 'DESTRUCTIVE', S({ path: str(300) }, ['path']));
register('run_tests', 'ADMIN', S({ path: str(300) }), { timeoutMs: 60000 });
register('run_code', 'ADMIN', S({ path: str(300), language: str(30) }, ['path']), { timeoutMs: 60000 });
register('run_command', 'ADMIN', S({ command: str(1000), cwd: str(300) }, ['command']), { timeoutMs: 60000 });
register('calculator', 'READ', S({ expression: str(300) }, ['expression']));
register('current_time', 'READ', S({}));
register('web_search', 'READ', S({ query: str(300) }, ['query']));
register('fetch_page', 'READ', S({ url: str(2000) }, ['url']));

const canon = name => ALIASES[name] || name;
const get = name => REG.get(canon(String(name || '')));

// What level is this tool? Custom tools (x_name) are READ when they only GET, otherwise WRITE. MCP tools are WRITE (unknown effects).
function levelOf(name, info = {}) {
  const r = get(name); if (r) return r.level;
  const n = String(name || '');
  if (/^x_/.test(n)) return info.method && String(info.method).toUpperCase() !== 'GET' ? (info.method.toUpperCase() === 'DELETE' ? 'DESTRUCTIVE' : 'WRITE') : 'READ';
  if (/^mcp[_:]/.test(n)) return 'WRITE';
  return 'ADMIN';
}

// policy: { approveWrites: bool, approveDestructive: bool }. ADMIN always needs approval. DESTRUCTIVE needs it unless explicitly switched off.
function needsApproval(level, policy = {}) {
  if (level === 'ADMIN') return true;
  if (level === 'DESTRUCTIVE') return policy.approveDestructive !== false;
  if (level === 'WRITE') return policy.approveWrites === true;
  return false;
}

// ---- a small, strict JSON Schema checker (type, properties, required, additionalProperties, min/max, maxLength, enum) ----
function checkValue(v, sch, path, errs, depth) {
  if (depth > MAX_DEPTH) { errs.push(path + ': nested too deep'); return; }
  if (!sch || typeof sch !== 'object') return;
  const t = sch.type;
  if (t === 'string') { if (typeof v !== 'string') return errs.push(path + ': must be text'); if (sch.maxLength != null && v.length > sch.maxLength) errs.push(path + ': longer than ' + sch.maxLength); if (sch.minLength != null && v.length < sch.minLength) errs.push(path + ': shorter than ' + sch.minLength); }
  else if (t === 'number' || t === 'integer') { if (typeof v !== 'number' || !Number.isFinite(v)) return errs.push(path + ': must be a number'); if (t === 'integer' && !Number.isInteger(v)) errs.push(path + ': must be a whole number'); if (sch.minimum != null && v < sch.minimum) errs.push(path + ': below ' + sch.minimum); if (sch.maximum != null && v > sch.maximum) errs.push(path + ': above ' + sch.maximum); }
  else if (t === 'boolean') { if (typeof v !== 'boolean') return errs.push(path + ': must be true or false'); }
  else if (t === 'array') { if (!Array.isArray(v)) return errs.push(path + ': must be a list'); if (sch.maxItems != null && v.length > sch.maxItems) errs.push(path + ': too many items'); if (sch.items) v.forEach((x, i) => checkValue(x, sch.items, path + '[' + i + ']', errs, depth + 1)); }
  else if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return errs.push(path + ': must be an object');
    const props = sch.properties || {};
    for (const k of sch.required || []) if (!(k in v) || v[k] === undefined || v[k] === null) errs.push(path + '.' + k + ': is required');
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') { errs.push(path + '.' + k + ': not allowed'); continue; }
      if (props[k]) checkValue(v[k], props[k], path + '.' + k, errs, depth + 1);
      else if (sch.additionalProperties === false) errs.push(path + '.' + k + ': is not an argument of this tool');
    }
  }
  if (Array.isArray(sch.enum) && !sch.enum.includes(v)) errs.push(path + ': must be one of ' + sch.enum.join(', '));
}
function validate(args, schema) { const errs = []; checkValue(args == null ? {} : args, schema, 'args', errs, 0); return errs; }

function depthOf(v, d = 0) { if (d > MAX_DEPTH + 2 || !v || typeof v !== 'object') return d; let m = d; for (const k of Object.keys(v)) m = Math.max(m, depthOf(v[k], d + 1)); return m; }

// ---- rate limit (per user, sliding window) ----
const hits = new Map();
function rateOk(user, tool, now = Date.now()) {
  const key = String(user || 'anon'), arr = (hits.get(key) || []).filter(h => now - h.t < RATE.windowMs);
  if (arr.length >= RATE.total || arr.filter(h => h.tool === tool).length >= RATE.perTool) { hits.set(key, arr); return false; }
  arr.push({ t: now, tool }); hits.set(key, arr); return true;
}
const resetRate = () => hits.clear();

// ---- THE GATE. Returns { ok:true, name, args, level, approve, timeoutMs } or { ok:false, error } (a sentence the model can act on).
// Nothing here runs a tool. The caller runs it only when ok is true, and waits for the user when approve is true.
function gate(name, args, ctx = {}) {
  const n = canon(String(name || '').trim());
  if (!n) return { ok: false, error: 'No tool name was given.' };
  const r = REG.get(n), info = ctx.toolInfo && ctx.toolInfo[n], isCustom = /^x_/.test(n) || /^mcp[_:]/.test(n);
  if (!r && !isCustom && !(ctx.known && ctx.known.has(n))) return { ok: false, error: 'There is no tool called "' + String(name).slice(0, 60) + '". Use only the tools you were given.' };
  if (ctx.enabled && !ctx.enabled.has(n) && !ctx.enabled.has(String(name))) return { ok: false, error: 'The tool "' + n + '" is switched off.' };
  if (ctx.calls != null && ctx.calls >= (ctx.maxCalls || DEFAULT_MAX_CALLS)) return { ok: false, error: 'Too many tool calls in one answer (limit ' + (ctx.maxCalls || DEFAULT_MAX_CALLS) + '). Give the answer with what you have.' };
  let json; try { json = JSON.stringify(args == null ? {} : args); } catch { return { ok: false, error: 'The arguments could not be read.' }; }
  if (Buffer.byteLength(json) > MAX_ARG_BYTES) return { ok: false, error: 'The arguments are too big (limit ' + MAX_ARG_BYTES + ' bytes).' };
  if (depthOf(args) > MAX_DEPTH) return { ok: false, error: 'The arguments are nested too deeply.' };
  if (r) { const errs = validate(args, r.schema); if (errs.length) return { ok: false, error: 'The arguments are not valid: ' + errs.slice(0, 4).join('; ') + '. Fix them and call the tool again.' }; }
  if (!rateOk(ctx.user, n)) return { ok: false, error: 'Too many tool calls this minute. Wait a little, then try again.' };
  const level = levelOf(n, info), max = ctx.maxLevel || 'ADMIN';
  if (RANK[level] > RANK[max]) return { ok: false, error: 'This tool needs permission level ' + level + ' and this chat only allows up to ' + max + '.' };
  return { ok: true, name: n, args: args == null ? {} : args, level, approve: needsApproval(level, ctx.policy), timeoutMs: (r && r.timeoutMs) || 0 };
}

// What the model is shown for each tool: name, description, schema, level. Secrets never go in here.
function describe(ids) { return ids.map(id => { const r = get(id); return r ? { name: r.id, level: r.level, input_schema: r.schema } : { name: id, level: levelOf(id), input_schema: { type: 'object' } }; }); }

module.exports = { LEVELS, RANK, MAX_ARG_BYTES, DEFAULT_MAX_CALLS, RATE, ALIASES, register, get, canon, levelOf, needsApproval, validate, gate, describe, rateOk, resetRate };
