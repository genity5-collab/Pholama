// Setup report and the Python installer's safety checks.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-setup-')); process.env.PHOLAMA_HOME = home;
const S = require('../server/setup.js');
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const fresh = { hardware: { gpu: '' }, llamaServer: false, ollama: false, python: { installed: false }, models: [] };

let r = S.report(fresh);
ok('a fresh PC lists app, node, engine, python', r.items.map(i => i.id).join() === 'app,node,engine,python', r.items.map(i => i.id));
ok('a fresh PC is not ready and the engine + python are missing', !r.runtimeReady && r.missing.join() === 'engine,python', JSON.stringify(r.missing));
ok('CPU runtime total is about 130 MB and well under 1 GB', r.totalMb === 130 && r.underBudget && r.headroomMb === 894, JSON.stringify([r.totalMb, r.headroomMb]));
ok('the download still needed is just engine + python (30 MB)', r.downloadMb === 30, r.downloadMb);
r = S.report({ ...fresh, hardware: { gpu: 'NVIDIA GeForce RTX 3060' } });
ok('an NVIDIA PC gets the bigger engine and is still under 1 GB', r.items.find(i => i.id === 'engine').mb === 252 && r.totalMb === 363 && r.underBudget, r.totalMb);
r = S.report({ ...fresh, llamaServer: true, python: { installed: true, version: '3.12.8' } });
ok('once everything is installed nothing is missing and it is ready', r.missing.length === 0 && r.runtimeReady && r.downloadMb === 0, JSON.stringify(r.missing));
ok('Ollama counts as an engine too', S.report({ ...fresh, ollama: true }).items.find(i => i.id === 'engine').installed === true);
ok('Python is optional, so the runtime is ready without it', S.report({ ...fresh, llamaServer: true }).runtimeReady === true);
ok('NO model is listed, chosen or forced', !S.report(fresh).items.some(i => /model/i.test(i.id)) && !JSON.stringify(S.report(fresh)).match(/qwen|llama3|smollm|starter/i));
ok('the note tells the user the model is their own choice', /Nothing is chosen for you/.test(S.report(fresh).modelNote));
ok('models are not counted in the 1 GB', S.report({ ...fresh, models: [{ id: 'big', downloaded: true, sizeGB: 20 }] }).totalMb === 130);
ok('haveModel follows what is downloaded', S.report({ ...fresh, models: [{ id: 'a', downloaded: true }] }).haveModel === true && S.report(fresh).haveModel === false);
ok('the worst case (NVIDIA, everything) is under 1 GB', S.SIZES.app + S.SIZES.node + S.SIZES.engineCuda + S.SIZES.python < S.BUDGET_MB);
ok('describe prints a readable checklist', /\[ \] Model engine/.test(S.describe(S.report(fresh))) && /under 1 GB/.test(S.describe(S.report(fresh))));
ok('missing/garbage input does not crash', S.report(null).items.length === 4 && S.report({ models: 'x' }).items.length === 4);

ok('auto-install runs on a fresh Windows PC', S.shouldAutoSetup('win32', {}, null) === true);
ok('auto-install never runs on Mac or Linux', !S.shouldAutoSetup('linux', {}, null) && !S.shouldAutoSetup('darwin', {}, null));
ok('auto-install can be switched off', !S.shouldAutoSetup('win32', { PHOLAMA_NO_AUTOSETUP: '1' }, null));
ok('after it worked, the check still runs again (it only installs what is missing, so a healthy PC does nothing)', S.shouldAutoSetup('win32', {}, { ok: true, tries: 1 }));
ok('a failed try is retried next start', S.shouldAutoSetup('win32', {}, { ok: false, tries: 1 }) && S.shouldAutoSetup('win32', {}, { ok: false, tries: 2 }));
ok('after 3 failed tries it stops (no endless loop without internet)', !S.shouldAutoSetup('win32', {}, { ok: false, tries: 3 }));
ok('only python.org https links are allowed', S.PY_HOST_OK(S.PY_URL) && !S.PY_HOST_OK('http://www.python.org/x.zip') && !S.PY_HOST_OK('https://evil.com/python.zip') && !S.PY_HOST_OK('https://www.python.org.evil.com/x') && !S.PY_HOST_OK('nonsense'));

(async () => {
  const rej = async (url, re, label) => { try { await S.installPython(null, undefined, url); ok(label, false, 'did not refuse'); } catch (e) { ok(label, re.test(e.message), e.message); } };
  // the host check runs first, so a local fake server needs the check relaxed: test by calling through a patched URL checker
  const real = S.PY_HOST_OK;
  await rej('https://evil.example.com/python.zip', /only be downloaded from python\.org/, 'refuses a download from another website');
  await rej('http://www.python.org/x.zip', /only be downloaded from python\.org/, 'refuses plain http');
  const body = { v: Buffer.alloc(0), len: null, status: 200 };
  const srv = http.createServer((q, s) => { s.statusCode = body.status; if (body.len != null) s.setHeader('content-length', body.len); else s.setHeader('content-length', body.v.length); s.end(body.v); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + srv.address().port + '/p.zip';
  // the real checker only allows python.org; for the byte-level checks we temporarily allow the local server
  const mod = require('module'); const orig = S.installPython;
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'setup.js'), 'utf8').replace("x.hostname === 'www.python.org'", "(x.hostname === 'www.python.org' || x.hostname === '127.0.0.1')").replace("x.protocol === 'https:'", "(x.protocol === 'https:' || x.protocol === 'http:')");
  const tmp = path.join(os.tmpdir(), 'setup-relaxed-' + process.pid + '.js'); fs.writeFileSync(tmp, src); const R = require(tmp);
  const rej2 = async (b, re, label) => { Object.assign(body, b); try { await R.installPython(null, undefined, base); ok(label, false, 'did not refuse'); } catch (e) { ok(label, re.test(e.message), e.message); } };
  await rej2({ v: Buffer.from('<html>not a zip</html>'), len: null, status: 200 }, /not a zip/, 'refuses a download that is not a zip');
  await rej2({ v: Buffer.from('PK\x03\x04short'), len: 9999, status: 200 }, /cut short|larger/i, 'refuses a truncated download');
  await rej2({ v: Buffer.from('PK'), len: 50 * 1048576, status: 200 }, /larger than expected/, 'refuses an oversized download');
  await rej2({ v: Buffer.from('x'), len: null, status: 404 }, /HTTP 404/, 'reports a failed download clearly');
  const steps = []; Object.assign(body, { v: Buffer.from('PK\x03\x04garbage-not-a-real-zip'), len: null, status: 200 });
  try { await R.installPython((t, d, tt) => steps.push(t), undefined, base); ok('a corrupt zip is reported, not trusted', false, 'accepted'); } catch (e) { ok('a corrupt zip is reported, not trusted', /Could not unpack/.test(e.message), e.message); }
  ok('progress is reported while downloading', steps.some(s => /Downloading/.test(s)) && steps.some(s => /Unpacking/.test(s)), steps.join('|'));
  ok('the half-downloaded zip is cleaned up', !fs.existsSync(path.join(home, 'python-embed.zip')));
  ok('detectPython finds nothing when nothing is there (no crash)', typeof S.detectPython().installed === 'boolean');
  fs.mkdirSync(S.pythonDir(), { recursive: true }); fs.writeFileSync(S.pythonExe(), 'x');
  ok('detectPython finds the private Python once installed', S.detectPython().installed && S.detectPython().own === true);
  srv.close(); try { fs.unlinkSync(tmp); } catch {} fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
})();
