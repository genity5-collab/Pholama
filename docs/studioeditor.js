// IDE editor pieces for Studio: tabs, breadcrumb, line-numbered code with red/green changed lines.
// Pure helpers first (no DOM) so they can be tested; the small DOM builders sit at the bottom.

// Split a path into breadcrumb parts: "src/ui/app.js" -> ["src","ui","app.js"].
export function crumbs(path) { return String(path || '').split('/').filter(Boolean); }

// A line-by-line diff of two texts (longest-common-subsequence), as rows
// { kind: 'same'|'add'|'del', text, oldNo, newNo }. Big files fall back to a simple prefix/suffix diff.
export function diffRows(before, after) {
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  if (a.length * b.length > 4_000_000) return coarse(a, b);
  const n = a.length, m = b.length, t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const rows = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ kind: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) { rows.push({ kind: 'del', text: a[i], oldNo: i + 1, newNo: null }); i++; }
    else { rows.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 }); j++; }
  }
  while (i < n) { rows.push({ kind: 'del', text: a[i], oldNo: i + 1, newNo: null }); i++; }
  while (j < m) { rows.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 }); j++; }
  return rows;
}
function coarse(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const rows = [];
  for (let i = 0; i < s; i++) rows.push({ kind: 'same', text: a[i], oldNo: i + 1, newNo: i + 1 });
  for (let i = s; i < a.length - e; i++) rows.push({ kind: 'del', text: a[i], oldNo: i + 1, newNo: null });
  for (let j = s; j < b.length - e; j++) rows.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 });
  for (let k = 0; k < e; k++) rows.push({ kind: 'same', text: a[a.length - e + k], oldNo: a.length - e + k + 1, newNo: b.length - e + k + 1 });
  return rows;
}
// Plain code (no changes): every line "same", numbered from 1.
export function plainRows(text) { return String(text ?? '').split('\n').map((t, i) => ({ kind: 'same', text: t, oldNo: i + 1, newNo: i + 1 })); }

// Open-file tabs: a small state machine so it is easy to test.
export function makeTabs() {
  const list = []; let active = null;
  return {
    open(name) { if (!list.includes(name)) list.push(name); active = name; return active; },
    close(name) { const i = list.indexOf(name); if (i < 0) return active; list.splice(i, 1); if (active === name) active = list[Math.min(i, list.length - 1)] ?? null; return active; },
    get list() { return list.slice(); }, get active() { return active; },
    set active(n) { if (list.includes(n)) active = n; },
  };
}

// ---- DOM builders (browser only) ----
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

export function renderCode(rows) {
  const box = mk('div', 'ide-code'), w = String(Math.max(...rows.map(r => r.newNo || r.oldNo || 0), 1)).length;
  for (const r of rows) {
    const line = mk('div', 'ide-line ide-' + r.kind);
    line.append(mk('span', 'ide-no', r.kind === 'del' ? String(r.oldNo ?? '') : String(r.newNo ?? '')), mk('span', 'ide-sign', r.kind === 'add' ? '+' : r.kind === 'del' ? '\u2212' : ' '), mk('span', 'ide-text', r.text === '' ? ' ' : r.text));
    line.style.setProperty('--w', w + 'ch'); box.append(line);
  }
  return box;
}
export function renderBreadcrumb(path) {
  const bar = mk('div', 'ide-crumbs'); const parts = crumbs(path);
  parts.forEach((p, i) => { if (i) bar.append(mk('span', 'ide-sep', '\u203A')); bar.append(mk('span', i === parts.length - 1 ? 'ide-crumb ide-crumb-last' : 'ide-crumb', p)); });
  return bar;
}
export function renderTabs(names, active, dirty, onPick, onClose) {
  const bar = mk('div', 'ide-tabs');
  for (const n of names) {
    const t = mk('div', 'ide-tab' + (n === active ? ' active' : '')); t.dataset.file = n;
    const label = mk('span', 'ide-tab-name', n.split('/').pop()); t.title = n; t.append(label);
    if (dirty && dirty.has(n)) t.append(mk('span', 'ide-dot', '\u25CF'));
    const x = mk('button', 'ide-tab-x', '\u00D7'); x.title = 'Close'; x.onclick = (e) => { e.stopPropagation(); onClose(n); }; t.append(x);
    t.onclick = () => onPick(n); bar.append(t);
  }
  return bar;
}
