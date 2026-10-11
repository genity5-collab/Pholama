// A tiny fake PostgREST: just enough filtering to run the adapter offline. It applies exactly the filters the adapter sends, so a missing
// "user_id=eq." filter shows up as one member seeing another's data.
module.exports = function fakePg() {
  const tables = {}; const log = [];
  const T = n => (tables[n] = tables[n] || []);
  const keys = { pholama_site_projects: ['user_id', 'name'], pholama_site_files: ['user_id', 'project', 'path'], pholama_site_secrets: ['user_id', 'project', 'name'], pholama_site_runs: ['id'], pholama_site_checkpoints: ['id'], pholama_site_db: ['user_id', 'project'] };
  const match = (row, params) => { for (const [k, v] of params) { if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue; const m = /^eq\.(.*)$/.exec(v); if (m && String(row[k]) !== decodeURIComponent(m[1])) return false; } return true; };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), table = u.pathname.split('/').pop(), params = [...u.searchParams], method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null; log.push(method + ' ' + table + '?' + u.searchParams.toString());
    const rows = T(table); const res = (code, data) => ({ ok: code < 300, status: code, text: async () => data === undefined ? '' : JSON.stringify(data) });
    if (method === 'GET') { let out = rows.filter(r => match(r, params)); const ord = params.find(([k]) => k === 'order'); if (ord) { const [f, d] = ord[1].split('.'); out = out.slice().sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (d === 'desc' ? -1 : 1)); } const off = +(params.find(([k]) => k === 'offset') || [0, 0])[1], lim = +(params.find(([k]) => k === 'limit') || [0, 1000])[1]; return res(200, out.slice(off, off + lim).map(r => ({ ...r }))); }
    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body], merge = /merge-duplicates/.test((init.headers || {}).Prefer || ''), kc = keys[table] || ['id'];
      for (const it of items) { const ex = rows.find(r => kc.every(k => r[k] === it[k])); if (ex) { if (!merge) return res(409, { code: '23505' }); Object.assign(ex, it); } else rows.push({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...it }); }
      return res(201);
    }
    if (method === 'PATCH') { const hit = rows.filter(r => match(r, params)); for (const r of hit) { Object.assign(r, body); r.updated_at = new Date(Date.now() + hit.length).toISOString(); } return res(200, /return=representation/.test((init.headers || {}).Prefer || '') ? hit.map(r => ({ ...r })) : undefined); }
    if (method === 'DELETE') { const keep = rows.filter(r => !match(r, params)); rows.length = 0; rows.push(...keep); return res(204); }
    return res(405);
  };
  return { fetch, tables, log };
};
