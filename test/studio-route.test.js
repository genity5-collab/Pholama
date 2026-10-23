// The Base44 host only routes the bare function name: .../functions/pholamaSiteStudio/projects is a 404 THERE.
// So the website sends the route as ?path=projects/... This runs the real client (docs/cloudstudio.js makeApi) against the real compiled server
// (functions/pholamaSiteStudio.ts) behind a fake host that behaves like that, so a path-style call fails the way it does in production.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { pathToFileURL } = require('url');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-')), out = path.join(dir, 'studio.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaSiteStudio.ts'), '--bundle', '--format=esm', '--platform=neutral', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const store = { projects: new Set(), files: {} };
  const db = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json'); const u = decodeURIComponent(q.url);
    if (u.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1' }));
    if (u.includes('/rpc/pholama_site_spend')) return s.end('1');
    if (u.includes('/rest/v1/pholama_site_projects')) {
      if (q.method === 'POST') { store.projects.add(JSON.parse(b).name); return s.end(''); }
      if (q.method === 'PATCH') return s.end('');
      const m = /name=eq\.([^&]+)/.exec(u); if (m) return s.end(JSON.stringify(store.projects.has(m[1]) ? [{ name: m[1] }] : []));
      return s.end(JSON.stringify([...store.projects].map(name => ({ name, updated_at: new Date().toISOString() }))));
    }
    if (u.includes('/rest/v1/pholama_site_files')) {
      if (q.method === 'POST') { for (const r of [].concat(JSON.parse(b))) store.files[r.project + '/' + r.path] = r.content; return s.end(''); }
      const pr = /project=eq\.([^&]+)/.exec(u); const pa = /path=eq\.([^&]+)/.exec(u);
      let rows = Object.entries(store.files).filter(([k]) => !pr || k.startsWith(pr[1] + '/')).map(([k, content]) => ({ path: k.slice(k.indexOf('/') + 1), content }));
      if (pa) rows = rows.filter(r => r.path === pa[1]);
      return s.end(JSON.stringify(rows));
    }
    s.end('[]'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const dbBase = 'http://127.0.0.1:' + db.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk', PHOLAMA_SEAL_KEY: 'x'.repeat(40) }[k]) } };
  const realFetch = global.fetch, HOST = 'https://host.test/functions/pholamaSiteStudio'; let forwardSubPaths = false;
  global.fetch = async (u, o) => {
    u = String(u);
    if (/nyswblzzvqzheaxvrqtq\.supabase\.co/.test(u)) return realFetch(dbBase + u.replace(/^https?:\/\/[^/]+/, ''), o);
    if (u.startsWith('https://host.test/')) {
      const url = new URL(u);
      // like Base44: any extra path segment means "function not found"; the query string passes through
      if (!forwardSubPaths && url.pathname !== '/functions/pholamaSiteStudio') return new Response(JSON.stringify({ message: 'not found or not deployed' }), { status: 404 });
      return handler(new Request(u, o));
    }
    return realFetch(u, o);
  };
  await import(pathToFileURL(out).href);
  const { makeApi } = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'cloudstudio.js')).href);
  const api = makeApi({ Account: { token: () => 'tok' }, cfg: () => ({ STUDIO_URL: HOST }) });
  const j = async r => ({ s: r.status, j: await r.json().catch(() => ({})) });

  const old = await j(await fetch(HOST + '/projects', { headers: { Authorization: 'Bearer tok' } }));
  ok('a path-style call is a 404 on the Base44-style host (the production failure)', old.s === 404, JSON.stringify(old));
  let r = await j(await api('api/studio/ws/capabilities'));
  ok('capabilities loads through the client', r.s === 200 && Array.isArray(r.j.modes) && r.j.site === true, JSON.stringify(r));
  r = await j(await api('api/studio/ws/projects', { method: 'POST', body: JSON.stringify({ name: 'shop' }) }));
  ok('a project can be created (POST projects)', r.s === 200 && r.j.name === 'shop', JSON.stringify(r));
  r = await j(await api('api/studio/ws/projects'));
  ok('the project list comes back (GET projects)', r.s === 200 && (r.j.projects || []).some(p => p.name === 'shop'), JSON.stringify(r));
  r = await j(await api('api/studio/ws/projects/shop/file', { method: 'PUT', body: JSON.stringify({ file: 'index.html', content: '<h1>hi</h1>' }) }));
  ok('a nested route works (PUT projects/shop/file)', r.s === 200 && r.j.name === 'index.html', JSON.stringify(r));
  r = await j(await api('api/studio/ws/projects/shop'));
  ok('the files come back with their content', r.s === 200 && (r.j.files || []).some(f => f.name === 'index.html' && f.content === '<h1>hi</h1>'), JSON.stringify(r));
  r = await j(await api('api/studio/ws/search?project=shop&q=hi'));
  ok('extra query values (project, q) still reach the handler', r.s === 200 && (r.j.hits || []).some(h => h.file === 'index.html'), JSON.stringify(r));
  const noLogin = await j(await fetch(HOST + '?path=projects'));
  ok('without a login the route is refused', noLogin.s === 401, JSON.stringify(noLogin));
  r = await j(await api('api/studio/ws/nope'));
  ok('an unknown route is a plain Not found', r.s === 404 && r.j.error === 'Not found.', JSON.stringify(r));
  forwardSubPaths = true;
  r = await j(await fetch(HOST + '/projects', { headers: { Authorization: 'Bearer tok' } }));
  ok('the old sub-path style still works on a host that forwards it', r.s === 200 && (r.j.projects || []).length >= 1, JSON.stringify(r));
  ok('the client puts the route in ?path=', /'\?path='/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'cloudstudio.js'), 'utf8')));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); db.close(); process.exit(bad ? 1 : 0);
})();
