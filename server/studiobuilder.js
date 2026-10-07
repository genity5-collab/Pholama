// Studio builder extras, modelled on the feature list of open AI app builders (project export/import, secrets, logs).
// Written for Pholama: local, no cloud, no API key.
//  * Project secrets/env live OUTSIDE the project folder (~/.pholama/studio-secrets/<project>.json), so they are never listed as a project file,
//    never read by the AI's file tools, never published, and never put in an export. Values are only handed to the preview/run step.
//  * Export is ONE json file with the project's files. Import checks every name with the same rules Studio already uses.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const studio = require('./studio');

const SECRETS_DIR = () => process.env.PHOLAMA_STUDIO_SECRETS || path.join(os.homedir(), '.pholama', 'studio-secrets');
const KEY = /^[A-Z][A-Z0-9_]{0,47}$/, MAX_VARS = 40, MAX_VALUE = 4000, FORMAT = 'pholama-studio-project', VERSION = 1;
const secretFile = p => path.join(SECRETS_DIR(), studio.projName(p) + '.json');

function readSecrets(p) { try { const j = JSON.parse(fs.readFileSync(secretFile(p), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
function setSecret(p, key, value) {
  if (!KEY.test(String(key))) throw new Error('A variable name uses CAPITAL letters, numbers and _ (for example API_KEY).');
  value = String(value == null ? '' : value); if (value.length > MAX_VALUE) throw new Error('That value is too long.'); if (/\0/.test(value)) throw new Error('That value is not allowed.');
  const all = readSecrets(p); if (!(key in all) && Object.keys(all).length >= MAX_VARS) throw new Error('Too many variables (max ' + MAX_VARS + ').');
  all[key] = value; fs.mkdirSync(SECRETS_DIR(), { recursive: true }); fs.writeFileSync(secretFile(p), JSON.stringify(all), { mode: 0o600 }); return names(p);
}
function removeSecret(p, key) { const all = readSecrets(p); delete all[key]; fs.mkdirSync(SECRETS_DIR(), { recursive: true }); fs.writeFileSync(secretFile(p), JSON.stringify(all), { mode: 0o600 }); return names(p); }
// The page and the AI only ever get NAMES (and whether a value is set), never the values.
function names(p) { return Object.keys(readSecrets(p)).sort().map(k => ({ key: k, set: true })); }
// Replace {{NAME}} in a text with the saved value. Used only when running/previewing; the result is never saved back into the project.
function inject(p, text) { const all = readSecrets(p); return String(text).replace(/\{\{([A-Z][A-Z0-9_]{0,47})\}\}/g, (m, k) => k in all ? all[k] : m); }
// Hide any saved value if it shows up in output (a log line, a tool result).
function scrub(p, text) { let t = String(text); for (const v of Object.values(readSecrets(p))) if (v && v.length >= 4) t = t.split(v).join('***'); return t; }

function exportProject(p) {
  const name = studio.projName(p), dir = path.join(studio.ROOT, name); if (!fs.existsSync(dir)) throw new Error('no such project');
  const files = []; let total = 0;
  const walk = (d, base) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isSymbolicLink()) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, base); else { const rel = path.relative(base, f).split(path.sep).join('/'); let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; } total += txt.length; files.push({ name: rel, content: txt }); } } };
  walk(dir, dir);
  if (total > studio.LIMITS.MAX_TOTAL) throw new Error('That project is too big to export.');
  return { format: FORMAT, version: VERSION, name, exported: new Date().toISOString(), files, note: 'Secrets are never included.' };
}
// Check an import BEFORE writing anything. Returns { name, files } or throws a sentence the user can read.
function checkImport(bundle, asName) {
  if (!bundle || typeof bundle !== 'object' || bundle.format !== FORMAT) throw new Error('This is not a Pholama project file.');
  if (bundle.version !== VERSION) throw new Error('This project file is from a different version.');
  if (!Array.isArray(bundle.files) || !bundle.files.length) throw new Error('This project file has no files.');
  if (bundle.files.length > studio.LIMITS.MAX_FILES) throw new Error('Too many files (max ' + studio.LIMITS.MAX_FILES + ').');
  let total = 0; const seen = new Set(), clean = [];
  for (const f of bundle.files) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') throw new Error('A file in this project is not valid.');
    if (/^[\\/]|^[A-Za-z]:|\\/.test(f.name)) throw new Error('A file name must be a plain relative name like css/site.css, not "' + f.name.slice(0, 40) + '".');   // refuse, do not quietly rewrite
    const n = studio.fileName(f.name);                                  // the same rules Studio always uses (no .., no hidden files, allowed types only)
    if (seen.has(n.toLowerCase())) throw new Error('Two files have the same name: ' + n);
    if (f.content.length > studio.LIMITS.MAX_FILE) throw new Error(n + ' is too big.');
    total += f.content.length; if (total > studio.LIMITS.MAX_TOTAL) throw new Error('The project is too big.');
    seen.add(n.toLowerCase()); clean.push({ name: n, content: f.content });
  }
  return { name: studio.projName(asName || bundle.name || 'imported'), files: clean };
}
function importProject(bundle, asName) {
  const c = checkImport(bundle, asName);
  let name = c.name, i = 2; while (fs.existsSync(path.join(studio.ROOT, name))) { name = studio.projName(c.name + '-' + i++); if (i > 99) throw new Error('Pick another name.'); }
  const made = studio.createProject(name, 'empty');
  try { for (const f of c.files) studio.writeFile(name, f.name, f.content); }
  catch (e) { try { studio.deleteProject(name); } catch {} throw new Error('Import stopped: ' + e.message); }   // never leave a half-imported project
  return { name: made.name, files: c.files.length };
}
module.exports = { readSecrets, setSecret, removeSecret, names, inject, scrub, exportProject, checkImport, importProject, FORMAT, VERSION, SECRETS_DIR };
