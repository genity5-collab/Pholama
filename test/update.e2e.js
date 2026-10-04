// The updater end to end: an old copy of Pholama finds a newer one on a fake "GitHub", installs it, and keeps user data.
const { execSync, spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-upd-')); const home = path.join(work, 'home'); fs.mkdirSync(path.join(home, '.pholama'), { recursive: true });
  // "old install": a copy of this project with an older version number
  const old = path.join(work, 'old'); fs.mkdirSync(old);
  execSync(`tar -c --exclude=.git --exclude=node_modules -f - . | tar -x -C "${old}"`, { cwd: root, shell: '/bin/sh' });
  const setVer = (dir, v) => { const p = path.join(dir, 'package.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.version = v; fs.writeFileSync(p, JSON.stringify(j, null, 2)); };
  setVer(old, '0.1.0');
  // "new release" on the fake GitHub: same files, higher version, and a marker file in web/studio.js to prove Studio files arrive
  const neu = path.join(work, 'Pholama-main'); fs.mkdirSync(neu);
  execSync(`tar -c --exclude=.git --exclude=node_modules -f - . | tar -x -C "${neu}"`, { cwd: root, shell: '/bin/sh' });
  setVer(neu, '9.9.9'); fs.appendFileSync(path.join(neu, 'web', 'studio.js'), '\n// UPDATED-STUDIO-MARKER\n');
  const tgz = path.join(work, 'new.tgz'); execSync(`tar -czf "${tgz}" -C "${work}" Pholama-main`);
  let hits = []; const gh = http.createServer((q, s) => { hits.push(q.url);
    if (q.url.endsWith('/package.json')) { s.setHeader('Content-Type', 'application/json'); return setTimeout(() => { if (!s.destroyed) s.end(fs.readFileSync(path.join(neu, 'package.json'))); }, 180); }
    if (q.url.endsWith('.tar.gz')) { s.setHeader('Content-Type', 'application/gzip'); return s.end(fs.readFileSync(tgz)); }
    s.statusCode = 404; s.end('no'); }).listen(0, '127.0.0.1');
  await wait(200); const G = 'http://127.0.0.1:' + gh.address().port;
  // user data that an update must never touch
  const keep = path.join(home, '.pholama', 'providers.json'); fs.writeFileSync(keep, '{"providers":[{"id":"mine"}]}');
  const port = 36000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, [path.join(old, 'server', 'server.js')], { cwd: old, env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_UPDATE_BASE: G, PHOLAMA_UPDATE_ARCHIVE: G + '/x.tar.gz', PHOLAMA_NO_AUTOUPDATE: '1', PHOLAMA_NO_SCHEDULE: '1', PHOLAMA_TEST_NO_RESTART: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const J = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
  try {
    let u = await (await J('/api/update')).json(); ok('starts on the old version', u.current === '0.1.0' && u.running === '0.1.0', JSON.stringify(u));
    await J('/api/update/auto', { method: 'POST', body: JSON.stringify({ auto: false }) });
    let r = await J('/api/update/check', { method: 'POST', body: JSON.stringify({ install: false }) }); u = await r.json();
    ok('it notices the newer version', u.latest === '9.9.9', JSON.stringify(u));
    ok('automatic-update off: a normal check does not install', u.ready === false && u.current === '0.1.0' && JSON.parse(fs.readFileSync(path.join(old, 'package.json'), 'utf8')).version === '0.1.0', JSON.stringify(u));
    const overlappingCheck = J('/api/update/check', { method: 'POST', body: JSON.stringify({ install: false }) }); await wait(35);
    r = await J('/api/update/check', { method: 'POST', body: JSON.stringify({ install: true }) }); const installed = await r.json(); await overlappingCheck; u = await (await J('/api/update')).json();
    ok('Check now forces install even when automatic updates are off', r.ok && installed.current === '9.9.9' && u.ready === true && u.current === '9.9.9' && u.running === '0.1.0', JSON.stringify(u));
    ok('the Studio file on disk is the new one', fs.readFileSync(path.join(old, 'web', 'studio.js'), 'utf8').includes('UPDATED-STUDIO-MARKER'));
    ok('the program version on disk is now 9.9.9', JSON.parse(fs.readFileSync(path.join(old, 'package.json'), 'utf8')).version === '9.9.9');
    ok('the user data was not touched', fs.readFileSync(keep, 'utf8').includes('"mine"'));
    ok('a backup of the old version was kept', fs.existsSync(path.join(home, '.pholama', 'previous-version', 'server', 'server.js')));
    // the running server must now SERVE the new files (this is what "Studio did not update" looks like if it does not)
    const served = await (await fetch(B + '/studio.js')).text(); ok('the running app serves the NEW studio.js right away', served.includes('UPDATED-STUDIO-MARKER'), served.slice(-120));
    const sw = await (await fetch(B + '/sw.js')).text(); ok('and the new service worker, so the browser cache refreshes', /const C = 'pholama-v\d+'/.test(sw));
    // the browser must be told to re-check every time, or it keeps showing the old Studio after an update
    { const a = await fetch(B + '/studio.js'); const tag = a.headers.get('etag');
      ok('page files say "check with me every time"', /no-cache/.test(a.headers.get('cache-control') || ''), a.headers.get('cache-control'));
      ok('page files carry an ETag', !!tag && /^"/.test(tag), tag);
      const b = await fetch(B + '/studio.js', { headers: { 'If-None-Match': tag } }); ok('an unchanged file answers 304 with no body (cheap)', b.status === 304 && (await b.text()) === '', b.status);
      fs.appendFileSync(path.join(old, 'web', 'studio.js'), '\n// CHANGED-AGAIN\n');
      const c = await fetch(B + '/studio.js', { headers: { 'If-None-Match': tag } }); ok('a changed file is sent again in full', c.status === 200 && (await c.text()).includes('CHANGED-AGAIN'), c.status);
      for (const f of ['/index.html', '/style.css', '/icon-192.png', '/icon.svg', '/manifest.webmanifest']) { const x = await fetch(B + f); ok(f + ' is served with no-cache', x.status === 200 && /no-cache/.test(x.headers.get('cache-control') || ''), x.status); }
      const ic = await fetch(B + '/icon-192.png'); ok('the PNG icon is small (not the 700 KB one)', (await ic.arrayBuffer()).byteLength < 30000); }
    // nothing outside the web folder can be read, including a sibling folder whose name starts the same
    { fs.mkdirSync(path.join(old, 'web-private'), { recursive: true }); fs.writeFileSync(path.join(old, 'web-private', 'secret.txt'), 'TOPSECRET');
      for (const u2 of ['/../web-private/secret.txt', '/%2e%2e/web-private/secret.txt', '/..%2fweb-private%2fsecret.txt', '/../package.json', '/..\\package.json', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd']) {
        const x = await fetch(B + u2); const t2 = await x.text(); ok('cannot read outside the web folder: ' + u2, !t2.includes('TOPSECRET') && !t2.includes('"name": "pholama"') && !/root:/.test(t2), x.status + ' ' + t2.slice(0, 60)); } }
    // restart: the new version runs
    r = await J('/api/restart', { method: 'POST' }); ok('restart is accepted', r.ok, r.status);
  } finally { srv.kill('SIGKILL'); gh.close(); await wait(300); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
