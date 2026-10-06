// Optional updates with live progress and "what's new", against a fake GitHub that serves a real tarball slowly.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-upd-')); process.env.HOME = home; process.env.USERPROFILE = home;
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };

// a "newer" release: the real app folder, but version 9.9.9 and its own notes
const src = path.join(home, 'src', 'Pholama-main'); fs.mkdirSync(path.join(home, 'src'), { recursive: true });
cp.execSync(`cp -r "${path.join(__dirname, '..')}" "${src}"`, { stdio: 'ignore' }); cp.execSync(`rm -rf "${src}/node_modules" "${src}/.git"`, { stdio: 'ignore' });
const pk = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')); pk.version = '9.9.9'; fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify(pk));
const rel = { latest: '9.9.9', releases: [{ version: '9.9.9', date: '2026-12-01', title: 'A shiny new thing', notes: ['New: first thing', 'Fixed: second thing <b>not html</b>'] }] };
fs.writeFileSync(path.join(src, 'releases.json'), JSON.stringify(rel));
fs.writeFileSync(path.join(src, 'padding.bin'), require('crypto').randomBytes(3 * 1024 * 1024));   // big enough to see progress climb
const tgz = path.join(home, 'new.tgz'); cp.execSync(`tar -czf "${tgz}" -C "${path.join(home, 'src')}" Pholama-main`);
const bytes = fs.readFileSync(tgz);

const gh = http.createServer((q, s) => {
  if (q.url.endsWith('/package.json')) return s.end(JSON.stringify(pk));
  if (q.url.endsWith('/releases.json')) return s.end(JSON.stringify(rel));
  if (q.url.endsWith('.tgz')) { s.setHeader('content-length', bytes.length); let i = 0; const t = setInterval(() => { if (i >= bytes.length) { clearInterval(t); return s.end(); } s.write(bytes.slice(i, i + 256 * 1024)); i += 256 * 1024; }, 40); return; }
  s.statusCode = 404; s.end('no');
}).listen(0, '127.0.0.1');

setTimeout(async () => {
  const base = 'http://127.0.0.1:' + gh.address().port;
  process.env.PHOLAMA_UPDATE_BASE = base; process.env.PHOLAMA_UPDATE_ARCHIVE = base + '/new.tgz'; process.env.PHOLAMA_NO_FRESH = '1';
  // run the updater from a throwaway copy of the app so the real tree is never touched
  const app = path.join(home, 'app'); cp.execSync(`cp -r "${path.join(__dirname, '..')}" "${app}"`, { stdio: 'ignore' }); cp.execSync(`rm -rf "${app}/.git"`, { stdio: 'ignore' });
  try { fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(app, 'node_modules')); } catch {}
  const U = require(path.join(app, 'server', 'update.js'));
  const old = U.localVersion();

  ok('a NEW install starts with automatic updates OFF (the user chooses)', U.status().auto === false, JSON.stringify(U.status().auto));
  ok('the progress starts idle', U.status().progress.phase === 'idle');
  // check only: must not install while auto is off
  let st = await U.backgroundCheck();
  ok('with auto OFF, a newer version is announced but NOT installed', st.latest === '9.9.9' && U.localVersion() === old && !st.ready, JSON.stringify([st.latest, U.localVersion()]));
  ok('the page is told what is new BEFORE installing', st.whatsNew && st.whatsNew.version === '9.9.9' && st.whatsNew.title === 'A shiny new thing' && st.whatsNew.notes.length === 2, JSON.stringify(st.whatsNew));
  ok('the old version keeps working untouched (no new files)', !fs.existsSync(path.join(app, 'padding.bin')));

  // the user presses Install: progress must climb while it downloads
  const seen = []; const poll = setInterval(() => { const p = U.status().progress; seen.push(p); }, 25);
  const res = await U.backgroundCheck({ installNow: true }); clearInterval(poll);
  const dl = seen.filter(p => p.phase === 'downloading' && p.total > 0);
  ok('the install worked and the new version is on disk', U.localVersion() === '9.9.9' && fs.existsSync(path.join(app, 'padding.bin')), U.localVersion());
  ok('progress was reported WHILE downloading (several readings)', dl.length >= 3, dl.length);
  const pcts = dl.map(p => p.percent); ok('the percentage only goes up', pcts.every((v, i) => i === 0 || v >= pcts[i - 1]) && pcts[pcts.length - 1] >= 50, pcts.join(','));
  ok('it reaches done at 100%', U.status().progress.phase === 'done' && U.status().progress.percent === 100, JSON.stringify(U.status().progress));
  ok('a speed number is reported', dl.some(p => p.speed > 0), JSON.stringify(dl.slice(-1)));
  ok('the notes are kept after installing', U.status().whatsNew && U.status().whatsNew.notes[1].includes('<b>not html</b>'), JSON.stringify(U.status().whatsNew));
  ok('the previous version was backed up', fs.existsSync(path.join(home, '.pholama', 'previous-version', 'package.json')));

  // a broken download must report an error, change nothing, and say so
  const app2 = path.join(home, 'app2'); fs.mkdirSync(app2);
  gh.close(); fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
}, 300);
