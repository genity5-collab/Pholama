// Pholama Secrets: up to 10 per project. A key pasted into a chat message is found, saved for that project, and removed from the
// message BEFORE the model or any history sees it. They can also be added by hand. The AI only ever sees the NAMES; the values are
// written into a project's runtime environment (.env) only when a project is run or published, never into the project's own files.
// Stored OUTSIDE the project folder so checkpoints, search, diffs and GitHub pushes can never include them.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const ROOT = () => process.env.PHOLAMA_PRIVATE || path.join(os.homedir(), '.pholama', 'private');
const MAX_SECRETS = 10, MAX_VALUE = 4096, MAX_NAME = 48;

const projDir = p => {
  const n = String(p == null ? '' : p).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  if (!n) throw new Error('Pick a project first.'); return n;
};
const fileFor = p => path.join(ROOT(), projDir(p), 'secrets.json');

// The machine key: random, made once, kept beside the data with owner-only access. This stops a casual look at the file or a stray
// copy of the folder; it is not a defence against someone who already controls this PC, and the screen says so.
function machineKey() {
  const f = path.join(ROOT(), '.key'); fs.mkdirSync(ROOT(), { recursive: true, mode: 0o700 });
  try { const k = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); if (k.length === 32) return k; } catch {}
  const k = crypto.randomBytes(32); fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch {} return k;
}
const seal = v => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', machineKey(), iv), ct = Buffer.concat([c.update(String(v), 'utf8'), c.final()]); return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.'); };
const open = s => { const [iv, tag, ct] = String(s).split('.').map(x => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', machineKey(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); };

function readAll(p) { try { const j = JSON.parse(fs.readFileSync(fileFor(p), 'utf8')); return Array.isArray(j.items) ? j.items : []; } catch { return []; } }
function writeAll(p, items) {
  const f = fileFor(p); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ items }), { mode: 0o600 }); fs.renameSync(tmp, f); try { fs.chmodSync(f, 0o600); } catch {}
}

// ---------- names ----------
function cleanName(n) {
  const s = String(n == null ? '' : n).trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!s || s.length > MAX_NAME || /^[0-9]/.test(s)) throw new Error('A secret name uses letters, numbers and underscores, and starts with a letter (like OPENAI_API_KEY).');
  if (/^(PATH|HOME|USER|SHELL|PWD|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|PORT)$/.test(s)) throw new Error('That name is used by the system. Pick another.');
  return s;
}

// ---------- detection ----------
// Provider shapes we can recognise with confidence. Each gives a friendly default name.
const KNOWN = [
  { name: 'GITHUB_TOKEN', re: /\b(gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g },
  { name: 'OPENAI_API_KEY', re: /\bsk-(?:proj-|live-)?[A-Za-z0-9_\-]{32,200}\b/g },
  { name: 'ANTHROPIC_API_KEY', re: /\bsk-ant-[A-Za-z0-9_\-]{30,200}\b/g },
  { name: 'GROQ_API_KEY', re: /\bgsk_[A-Za-z0-9]{40,100}\b/g },
  { name: 'RESEND_API_KEY', re: /\bre_[A-Za-z0-9_]{20,100}\b/g },
  { name: 'STRIPE_SECRET_KEY', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,120}\b/g },
  { name: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: 'AWS_ACCESS_KEY_ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'SLACK_TOKEN', re: /\bxox[abprs]-[A-Za-z0-9-]{20,200}\b/g },
  { name: 'DISCORD_BOT_TOKEN', re: /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g },
  { name: 'SUPABASE_SERVICE_KEY', re: /\bsb_secret_[A-Za-z0-9_\-]{20,120}\b/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];
// "NAME=value", "NAME: value" and JSON "name": "value" where the name itself says it is a secret. The name may be quoted, start a line, or
// follow punctuation. A name like apiKey / clientSecret / DB_PASSWORD all count.
const WORD = '(?:API[_-]?KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIAL)';
const NAMED = new RegExp('(^|[\\s;,{(\\[])["\'`]?([A-Za-z][A-Za-z0-9_-]*?' + WORD + '[A-Za-z0-9_-]*|' + WORD + '[A-Za-z0-9_-]*)["\'`]?\\s*(?:=|:)\\s*["\'`]?([^\\s"\'`<>,;]{8,})', 'gim');
// "my password is hunter2hunter2", "the api key is ..."
const SAID = new RegExp('\\b((?:my|the|our)\\s+(?:[a-z]+\\s+)?(?:password|passcode|api\\s?key|token|secret(?:\\s?key)?))\\s+(?:is|=|:)\\s+["\'`]?([^\\s"\'`<>,;]{8,})', 'gi');
const PLACEHOLDER = /^(your[_-]?|xxx+|\*+|<|\{\{|\$\{|process\.env|example|changeme|todo|placeholder|insert|none|null|undefined|true|false)/i;

const CODEISH = v => /[()\[\]]/.test(v) || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(v) || /^(get|set|fetch|read|load|create|make|new)[A-Z]/.test(v);
const mask = v => v.length <= 8 ? '••••' : v.slice(0, 3) + '••••' + v.slice(-2);

// Finds secrets in text. Returns where each one is, a friendly name, and the text with each value replaced by {{secret:NAME}}.
function scan(text) {
  const src = String(text == null ? '' : text), found = []; const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  for (const k of KNOWN) { k.re.lastIndex = 0; let m; while ((m = k.re.exec(src))) { const a = m.index, b = a + m[0].length; if (free(a, b)) { taken.push([a, b]); found.push({ at: a, end: b, value: m[0], name: k.name, kind: 'known' }); } } }
  const take = (m, value, rawName, kind) => {
    if (PLACEHOLDER.test(value) || CODEISH(value) || /^[A-Za-z]+$/.test(value) && value.length < 12) return;
    const a = m.index + m[0].lastIndexOf(value), b = a + value.length; if (!free(a, b)) return;
    let nm; try { nm = cleanName(String(rawName).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\s+/g, '_')); } catch { return; }
    taken.push([a, b]); found.push({ at: a, end: b, value, name: nm, kind });
  };
  NAMED.lastIndex = 0; let m;
  while ((m = NAMED.exec(src))) take(m, m[3], m[2], 'named');
  SAID.lastIndex = 0;
  while ((m = SAID.exec(src))) take(m, m[2], m[1].replace(/^(my|the|our)\s+/i, ''), 'said');
  found.sort((x, y) => x.at - y.at);
  const used = new Map(); let out = '', last = 0;
  for (const f of found) {
    let n = f.name, i = 2; while (used.has(n) && used.get(n) !== f.value) n = f.name + '_' + i++; used.set(n, f.value); f.name = n;
    out += src.slice(last, f.at) + '{{secret:' + n + '}}'; last = f.end;
  }
  out += src.slice(last);
  return { found: found.map(f => ({ name: f.name, value: f.value, kind: f.kind })), redacted: out };
}

// ---------- the store ----------
function list(project) { return readAll(project).map(s => ({ name: s.name, preview: s.preview, source: s.source, added: s.added })); }
function count(project) { return readAll(project).length; }

function set(project, name, value, source = 'manual') {
  const n = cleanName(name), v = String(value == null ? '' : value);
  if (!v.trim()) throw new Error('The value is empty.');
  if (v.length > MAX_VALUE) throw new Error('That value is too long (max ' + MAX_VALUE + ' characters).');
  if (/[\r\n\0]/.test(v)) throw new Error('A secret value must be on one line.');
  const items = readAll(project), at = items.findIndex(s => s.name === n);
  if (at < 0 && items.length >= MAX_SECRETS) throw new Error('A project can hold ' + MAX_SECRETS + ' secrets. Delete one first.');
  const rec = { name: n, sealed: seal(v), preview: mask(v), source: source === 'detected' ? 'detected' : 'manual', added: Date.now() };
  if (at >= 0) items[at] = rec; else items.push(rec);
  writeAll(project, items); return { name: n, preview: rec.preview, source: rec.source, replaced: at >= 0 };
}
function remove(project, name) { const n = cleanName(name), items = readAll(project), keep = items.filter(s => s.name !== n); if (keep.length === items.length) return false; writeAll(project, keep); return true; }
function removeAll(project) { try { fs.rmSync(path.dirname(fileFor(project)) + path.sep + 'secrets.json', { force: true }); } catch {} }

// Values are only read here, and only to run or publish a project.
function values(project) { const o = {}; for (const s of readAll(project)) { try { o[s.name] = open(s.sealed); } catch {} } return o; }
function envText(project) { return Object.entries(values(project)).map(([k, v]) => k + '=' + JSON.stringify(v)).join('\n') + '\n'; }

// Protects a chat message: finds secrets, saves what fits, and returns the safe text. Anything past the limit is still removed from the
// text (never left in the open) and the answer says so.
function protect(project, text) {
  const s = scan(text); if (!s.found.length) return { text: String(text == null ? '' : text), saved: [], dropped: [] };
  const saved = [], dropped = []; let out = s.redacted;
  for (const f of s.found) {
    try { const r = set(project, f.name, f.value, 'detected'); saved.push({ name: r.name, preview: r.preview, replaced: r.replaced }); }
    catch (e) { dropped.push({ name: f.name, why: String(e.message || e) }); out = out.split('{{secret:' + f.name + '}}').join('[secret removed: ' + f.name + ']'); }
  }
  return { text: out, saved, dropped };
}

// The AI is told which names exist (never values) and how to refer to them.
function promptNote(project) {
  const names = list(project).map(s => s.name); if (!names.length) return '';
  return 'This project has these saved secrets: ' + names.join(', ') + '. Never ask for, print or write their values. In server code read them as process.env.NAME. Anything that must run in a browser must NOT use a secret directly; call a server route instead.';
}

// Every saved value across all projects. Used only to hide them in stored run text and tool output; never sent anywhere.
function allValues() {
  const out = []; let dirs = []; try { dirs = fs.readdirSync(ROOT(), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
  for (const d of dirs) for (const v of Object.values(values(d))) if (v && v.length >= 8) out.push(v);
  return out;
}
// A last safety net: anything about to be written into a project file or shown that still contains a saved value is blocked or masked.
function leaks(project, text) { const t = String(text == null ? '' : text); return Object.entries(values(project)).filter(([, v]) => v.length >= 8 && t.includes(v)).map(([k]) => k); }
function scrub(project, text) { let t = String(text == null ? '' : text); for (const [k, v] of Object.entries(values(project))) if (v.length >= 8) t = t.split(v).join('{{secret:' + k + '}}'); return t; }

module.exports = { allValues, MAX_SECRETS, scan, protect, set, remove, removeAll, list, count, values, envText, promptNote, leaks, scrub, cleanName, mask };
