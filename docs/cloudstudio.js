// Pholama Studio on the website. It is the SAME workspace screen the PC app uses (docs/studioworkspace.js is a byte-for-byte copy of web/studioworkspace.js),
// talking to Pholama's own cloud function. Every request carries the member's login; nothing here knows any provider or key.
export function studioBase(cfg) { return String((cfg && cfg.STUDIO_URL) || '').replace(/\/+$/, ''); }

// The screen asks for "api/studio/ws/<route>" (and "api/studio/projects/..."). Map that onto the cloud function and add the login.
export function makeApi({ Account, cfg, fetchImpl }) {
  return async (fullPath, opts = {}) => {
    const base = studioBase(cfg()); if (!base) return new Response(JSON.stringify({ error: 'Pholama Studio is not available right now.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    const token = Account && Account.token && Account.token();
    if (!token) return new Response(JSON.stringify({ error: 'Log in to use Pholama Studio.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const route = String(fullPath).replace(/^api\/studio\/ws\//, '').replace(/^api\/studio\//, '').replace(/^\/+/, '');
    const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
    // The Base44 host only routes the bare function name, so the route travels in ?path= (a query the host passes through). Any query the screen
    // already had (like ?project=shop) is kept after it.
    const qi = route.indexOf('?'), routePath = qi >= 0 ? route.slice(0, qi) : route, routeQuery = qi >= 0 ? route.slice(qi + 1) : '';
    const url = base + '?path=' + encodeURIComponent(routePath).replace(/%2F/gi, '/') + (routeQuery ? '&' + routeQuery : '');
    try { return await (fetchImpl || fetch)(url, Object.assign({}, opts, { headers })); }
    catch { return new Response(JSON.stringify({ error: 'Could not reach Pholama Studio. Check your connection.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
  };
}

export function mountCloudStudio(host, { Account, cfg = () => ({}), fetchImpl, loadWorkspace } = {}) {
  host.textContent = '';
  const box = document.createElement('div'); box.id = 'workspace'; box.className = 'cloudstudio-ws'; host.append(box);
  const api = makeApi({ Account, cfg, fetchImpl });
  let ws = null;
  const ready = (async () => {
    try {
      const mod = loadWorkspace ? await loadWorkspace() : await import('./studioworkspace.js');
      ws = mod.createWorkspace(box, { api, noStream: true, site: true, getModels: () => [{ id: 'qwen-coder', name: 'Pholama cloud agent' }] });
      await ws.open();
    } catch (e) { box.textContent = 'Pholama Studio could not load. Refresh the page and try again.'; }
  })();
  return { ready, refresh: async () => { await ready; if (ws && ws.open) await ws.open(); }, workspace: () => ws };
}
