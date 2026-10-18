// The Studio workspace: one place that holds every script and every model of the project, the way Roblox's Explorer does.
// A "script" is Lua text. A "model" is a named group of parts that the preview draws; it comes from running a script
// (the safe preview reads the script and builds the parts it describes) so the two stay linked.
// Pure data, no DOM, so it can be tested and saved to the browser.

const uid = (() => { let n = 0; return p => p + '_' + Date.now().toString(36) + '_' + (++n); })();
const cleanName = (s, fallback) => String(s || '').replace(/[^\w .-]/g, '').trim().slice(0, 40) || fallback;

export function newWorkspace() { return { items: [], active: null, rev: 0 }; }

export function addScript(ws, name, source = '') {
  const item = { id: uid('s'), kind: 'script', name: uniqueName(ws, cleanName(name, 'Script')), source: String(source) };
  ws.items.push(item); ws.active = ws.active || item.id; ws.rev++; return item;
}
export function addModel(ws, name, parts = [], fromScript = null) {
  const item = { id: uid('m'), kind: 'model', name: uniqueName(ws, cleanName(name, 'Model')), parts: parts.map(p => ({ ...p })), fromScript };
  ws.items.push(item); ws.rev++; return item;
}
function uniqueName(ws, base) {
  const taken = new Set(ws.items.map(i => i.name.toLowerCase())); if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has((base + ' ' + n).toLowerCase())) return base + ' ' + n;
}
export const find = (ws, id) => ws.items.find(i => i.id === id) || null;
export const scripts = ws => ws.items.filter(i => i.kind === 'script');
export const models = ws => ws.items.filter(i => i.kind === 'model');

export function activate(ws, id) { if (find(ws, id)) { ws.active = id; ws.rev++; return true; } return false; }
export function active(ws) { return find(ws, ws.active); }

// Live edit: change a script's text. Its model (if any) is rebuilt by the caller from the new text.
export function editScript(ws, id, source) { const it = find(ws, id); if (!it || it.kind !== 'script') return false; if (it.source === source) return true; it.source = String(source); ws.rev++; return true; }
export function rename(ws, id, name) { const it = find(ws, id); if (!it) return false; it.name = uniqueName({ items: ws.items.filter(i => i.id !== id) }, cleanName(name, it.name)); ws.rev++; return true; }
export function remove(ws, id) {
  const i = ws.items.findIndex(x => x.id === id); if (i < 0) return false;
  ws.items.splice(i, 1);
  for (const m of models(ws)) if (m.fromScript === id) m.fromScript = null;
  if (ws.active === id) ws.active = (ws.items[Math.max(0, i - 1)] || ws.items[0] || {}).id || null;
  ws.rev++; return true;
}

// Run a script into its model: the model named after the script is created or refreshed with the parts the preview built.
export function syncModel(ws, scriptId, parts) {
  const sc = find(ws, scriptId); if (!sc || sc.kind !== 'script') return null;
  let m = models(ws).find(x => x.fromScript === scriptId);
  if (!m) return parts.length ? addModel(ws, sc.name, parts, scriptId) : null;
  m.parts = parts.map(p => ({ ...p }));
  if (!parts.length) { const i = ws.items.indexOf(m); if (i >= 0) ws.items.splice(i, 1); ws.rev++; return null; }   // the script no longer builds anything: its model goes away
  ws.rev++; return m;
}

// Every part from every model, for the viewport to draw the whole project at once. Parts keep their model's name.
export function allParts(ws) {
  const out = []; for (const m of models(ws)) for (const p of m.parts) out.push({ ...p, model: m.name });
  return out;
}

// The Explorer tree, shaped like Roblox: Workspace (models) and Scripts, each with its children.
export function tree(ws) {
  return [
    { label: 'Workspace', kind: 'folder', children: models(ws).map(m => ({ id: m.id, label: m.name, kind: 'model', count: m.parts.length, active: ws.active === m.id })) },
    { label: 'Scripts', kind: 'folder', children: scripts(ws).map(s => ({ id: s.id, label: s.name, kind: 'script', lines: s.source ? s.source.split('\n').length : 0, active: ws.active === s.id })) }
  ];
}

// Save and restore from plain JSON (browser storage). Bad data never throws; it gives back an empty workspace.
export function save(ws) { return JSON.stringify({ v: 1, items: ws.items, active: ws.active }); }
export function load(text) {
  try {
    const d = JSON.parse(text); if (!d || d.v !== 1 || !Array.isArray(d.items)) return newWorkspace();
    const ws = newWorkspace();
    for (const i of d.items.slice(0, 200)) {
      if (i && i.kind === 'script' && typeof i.name === 'string') ws.items.push({ id: String(i.id || uid('s')), kind: 'script', name: cleanName(i.name, 'Script'), source: String(i.source || '').slice(0, 100000) });
      else if (i && i.kind === 'model' && typeof i.name === 'string') ws.items.push({ id: String(i.id || uid('m')), kind: 'model', name: cleanName(i.name, 'Model'), parts: Array.isArray(i.parts) ? i.parts.slice(0, 500) : [], fromScript: i.fromScript || null });
    }
    ws.active = ws.items.some(i => i.id === d.active) ? d.active : (ws.items[0] || {}).id || null;
    return ws;
  } catch { return newWorkspace(); }
}
