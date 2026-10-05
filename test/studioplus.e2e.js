// Studio extras over HTTP against a real server: folders, pictures, map, publish check, and the hostile cases.
const { spawn } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function call(port, method, p, body, raw) {
  return new Promise(res => { const data = raw != null ? raw : body ? JSON.stringify(body) : null; const q = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => { let j = null; try { j = JSON.parse(t); } catch {} res({ s: r.statusCode, j, t }); }); }); q.on('error', e => res({ s: 0, j: null, t: String(e) })); if (data) q.write(data); q.end(); });
}
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-spe-')), studio = path.join(home, 'studio'), port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: studio, PHOLAMA_NO_UPDATE: '1' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { const r = await call(port, 'GET', '/api/studio/projects'); if (r.s === 200) break; await wait(250); }
    const P = '/api/studio/projects';
    let r = await call(port, 'POST', P, { name: 'demo' }); ok('make a project', r.s === 200 && r.j.name === 'demo', r.t);
    r = await call(port, 'POST', P + '/demo/folder', { folder: 'img' }); ok('make a folder', r.s === 200 && r.j.name === 'img' && r.j.existed === false, r.t);
    r = await call(port, 'PUT', P + '/demo/image', { file: 'img/dot.png', data: PNG }); ok('upload a real picture', r.s === 200 && r.j.type === 'image/png' && r.j.w === 1, r.t);
    r = await call(port, 'GET', P + '/demo/image?file=img%2Fdot.png'); ok('read the picture back', r.s === 200 && r.j.data === PNG && r.j.type === 'image/png', r.t.slice(0, 200));
    r = await call(port, 'GET', P + '/demo/tree'); ok('the tree lists folders and pictures', r.s === 200 && r.j.dirs.includes('img') && r.j.files.some(f => f.name === 'img/dot.png' && f.image === true), r.t);
    r = await call(port, 'GET', P + '/demo'); ok('the editor file list never contains picture bytes', r.s === 200 && !r.j.files.some(f => /\.png$/.test(f.name)), r.t.slice(0, 200));
    r = await call(port, 'POST', P + '/demo/move', { from: 'style.css', to: 'css/main.css' }); ok('move a file', r.s === 200 && /Moved/.test(r.j.text), r.t);
    r = await call(port, 'POST', P + '/demo/copy', { from: 'script.js', to: 'copy.js' }); ok('copy a file', r.s === 200 && /Copied/.test(r.j.text), r.t);
    r = await call(port, 'GET', P + '/demo/map'); ok('the map is served', r.s === 200 && /PROJECT "demo"/.test(r.j.map) && /img\//.test(r.j.map), r.t.slice(0, 200));
    r = await call(port, 'GET', P + '/demo/verify'); ok('the publish check is served with steps', r.s === 200 && Array.isArray(r.j.steps) && r.j.steps.length >= 8 && typeof r.j.pass === 'boolean', r.t.slice(0, 200));
    ok('that check found the stylesheet I moved (link now broken)', r.j.steps.find(s => s.id === 'links').status === 'fail', JSON.stringify(r.j.steps.find(s => s.id === 'links')));
    r = await call(port, 'DELETE', P + '/demo/folder', { folder: 'img' }); ok('delete a folder', r.s === 200 && /Deleted folder img/.test(r.j.text), r.t);
    // ---- hostile
    r = await call(port, 'PUT', P + '/demo/image', { file: 'evil.png', data: Buffer.from('<script>alert(1)</script> not a picture at all').toString('base64') }); ok('a fake picture is refused with a clear error', r.s === 400 && /not a real picture/.test(r.j.error), r.t);
    r = await call(port, 'PUT', P + '/demo/image', null, '{"file":"big.png","data":"' + 'A'.repeat(3 * 1024 * 1024) + '"}'); ok('a 3 MB upload is stopped before it is stored', (r.s === 413 || r.s === 0) && !fs.existsSync(path.join(studio, 'demo', 'big.png')), r.s + ' ' + r.t.slice(0, 150));
    r = await call(port, 'POST', P + '/demo/folder', { folder: '../../pwned' }); ok('folder traversal is refused', r.s === 400 && !fs.existsSync(path.join(home, 'pwned')) && !fs.existsSync(path.join(studio, '..', 'pwned')), r.t);
    r = await call(port, 'POST', P + '/demo/move', { from: 'index.html', to: '../../moved.html' }); ok('moving out of the project is refused', r.s === 400 && !fs.existsSync(path.join(home, 'moved.html')), r.t);
    r = await call(port, 'GET', P + '/demo/image?file=..%2F..%2Fsecret.png'); ok('reading a picture outside the project is refused', r.s === 400, r.t);
    r = await call(port, 'GET', P + '/..%2F..%2Fetc/map'); ok('a project name cannot climb out', r.s === 400 || r.s === 404, r.s + ' ' + r.t.slice(0, 120));
    r = await call(port, 'GET', P + '/nope/map'); ok('a missing project is a clean error, not a crash', r.s === 400 && /no such project/.test(r.j.error), r.t);
    r = await call(port, 'POST', P + '/demo/folder', null, '{not json'); ok('broken JSON does not crash the server', r.s === 400 || r.s === 200, r.s);
    r = await call(port, 'GET', P); ok('the server is still alive after all that', r.s === 200, r.s);
  } finally { srv.kill('SIGKILL'); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
