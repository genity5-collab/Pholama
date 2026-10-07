// Edit log organising: collapse each command to its final outcome, group by day, filter, summarise.
// Pure logic, no page code, so it can be tested on its own.

export const STATUS = {
  ok:        { word: 'Done',               tone: 'good', group: 'done' },
  failed:    { word: 'Failed',             tone: 'bad',  group: 'problem' },
  error:     { word: 'Error',              tone: 'bad',  group: 'problem' },
  stopped:   { word: 'Stopped',            tone: 'warn', group: 'problem' },
  refused:   { word: 'Blocked for safety', tone: 'bad',  group: 'blocked' },
  denied:    { word: 'Denied by you',      tone: 'warn', group: 'blocked' },
  expired:   { word: 'Expired',            tone: 'mute', group: 'blocked' },
  proposed:  { word: 'Waiting for you',    tone: 'info', group: 'waiting' },
  granted:   { word: 'Bonus added',        tone: 'good', group: 'bonus' },
  'already-granted': { word: 'Bonus already added', tone: 'mute', group: 'bonus' },
};
export const FILTERS = [['all', 'All'], ['done', 'Done'], ['problem', 'Problems'], ['blocked', 'Blocked'], ['waiting', 'Waiting']];
export const info = s => STATUS[s] || { word: String(s || 'Unknown'), tone: 'mute', group: 'other' };

// Each command is logged several times (proposed, then ok/failed/...). Show only its latest state. Entries arrive newest first.
export function collapse(entries) {
  const seen = new Set(), out = [];
  for (const e of entries || []) {
    if (!e || typeof e !== 'object') continue;
    if (e.id && e.kind === 'command') { if (seen.has(e.id)) continue; seen.add(e.id); }
    out.push(e);
  }
  return out;
}

export function dayKey(iso) { const d = new Date(iso); return isNaN(d) ? 'unknown' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function dayTitle(key, now = new Date()) {
  if (key === 'unknown') return 'Earlier';
  if (key === dayKey(now)) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1); if (key === dayKey(y)) return 'Yesterday';
  const [Y, M, D] = key.split('-').map(Number); return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function groupByDay(entries) {
  const map = new Map();
  for (const e of entries) { const k = dayKey(e.t); if (!map.has(k)) map.set(k, []); map.get(k).push(e); }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}
export const applyFilter = (entries, f) => (!f || f === 'all') ? entries : entries.filter(e => info(e.status).group === f);

export function summarise(entries) {
  const c = { all: entries.length, done: 0, problem: 0, blocked: 0, waiting: 0 };
  for (const e of entries) { const g = info(e.status).group; if (c[g] != null) c[g]++; }
  return c;
}
export function summaryText(c) {
  if (!c.all) return 'Nothing yet';
  const bits = [`${c.all} action${c.all === 1 ? '' : 's'}`];
  if (c.done) bits.push(`${c.done} done`); if (c.problem) bits.push(`${c.problem} problem${c.problem === 1 ? '' : 's'}`);
  if (c.blocked) bits.push(`${c.blocked} blocked`); if (c.waiting) bits.push(`${c.waiting} waiting`);
  return bits.join(' \u00b7 ');
}
export function fmtDuration(ms) { if (ms == null || isNaN(ms)) return ''; return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + 's'; }
export function fmtBytes(n) { if (n == null || isNaN(n)) return ''; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
export function fmtTime(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// What the expanded row shows. Only facts the log really holds; nothing is invented.
export function detailRows(e) {
  const r = [];
  if (e.why) r.push(['Why the AI wanted it', e.why]);
  if (e.cwd) r.push(['Folder', e.cwd]);
  if (e.reason) r.push(['Reason', e.reason]);
  if (e.error) r.push(['Error', e.error]);
  if (e.code != null) r.push(['Exit code', String(e.code)]);
  if (e.ms != null) r.push(['Took', fmtDuration(e.ms)]);
  if (e.bytes != null) r.push(['Output size', fmtBytes(e.bytes)]);
  if (e.approvedBy) r.push(['Approved by', e.approvedBy === 'user' ? 'You' : String(e.approvedBy)]);
  if (e.kind === 'bonus') r.push(['Credits', '+' + (e.credits || 0)]);
  return r;
}
