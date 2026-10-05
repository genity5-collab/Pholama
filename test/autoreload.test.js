// After an automatic update the server restarts on new code. An open page must reload itself, but never interrupt work.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x).slice(0, 250))); if (!c) bad++; };
const a = src.indexOf('let pageVersion = null'), b = src.indexOf('// Ask this PC', a);
ok('the version watch is in the page', a > 0 && b > a);
const code = src.slice(a, b);
function page({ server, studioBusy = false, typed = '' }) {
  const timers = []; let reloads = 0, cur = server.current;
  const env = {
    fetch: async () => ({ ok: true, json: async () => ({ current: cur, latest: cur, auto: true, ready: false }) }),
    $: () => ({ style: {}, checked: false, textContent: '', onclick: null }),
    document: { getElementById: id => id === 'in' ? { value: typed } : null, querySelector: () => null },
    location: { reload: () => { reloads++; } }, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    studio: { isBusy: () => studioBusy }, shownBanner: null,
  };
  const fn = new Function(...Object.keys(env), code + '\nreturn { paintUpdate };');
  const api = fn(...Object.values(env));
  return { paint: api.paintUpdate, set: v => { cur = v; }, reloads: () => reloads, timers, env };
}
const run = async t => { while (t.timers.length) { const x = t.timers.shift(); await x.f(); } };
(async () => {
  let t = page({ server: { current: '0.9.25' } });
  await t.paint(); await t.paint();
  ok('same version: never reloads', t.reloads() === 0 && t.timers.length === 0, t.timers.length);
  t.set('0.9.27'); await t.paint(); await run(t);
  ok('the server came back on a NEWER version: the page reloads itself', t.reloads() === 1, t.reloads());
  await t.paint(); await t.paint(); await run(t);
  ok('…once, not in a loop', t.reloads() === 1, t.reloads());

  t = page({ server: { current: '0.9.25' }, studioBusy: true }); await t.paint(); t.set('0.9.27'); await t.paint();
  await t.timers.shift().f();
  ok('Studio is working or has unsaved edits: it waits and does NOT reload', t.reloads() === 0 && t.timers.length === 1, { r: t.reloads(), timers: t.timers.length });
  t.env.studio.isBusy = () => false; await run(t);
  ok('…and reloads as soon as Studio is idle', t.reloads() === 1, t.reloads());

  t = page({ server: { current: '0.9.25' }, typed: 'half a message I am writing' }); await t.paint(); t.set('0.9.27'); await t.paint(); await t.timers.shift().f();
  ok('a message being typed in the chat box is never thrown away', t.reloads() === 0, t.reloads());
  t.env.document.getElementById = () => ({ value: '' }); await run(t);
  ok('…it reloads once the box is empty', t.reloads() === 1, t.reloads());

  t = page({ server: { current: '0.9.25' } }); t.env.fetch = async () => { throw new Error('server restarting'); }; await t.paint(); 
  ok('server down mid-restart: no crash, no reload yet', t.reloads() === 0);
  // Studio's own busy test uses the real field names
  const st = fs.readFileSync(path.join(__dirname, '..', 'web', 'studio.js'), 'utf8');
  ok("Studio's isBusy uses the real prompt box (stAsk), unsaved edits and the running flag", /isBusy: \(\) => !!\(S\.busy \|\| S\.dirty\.size \|\| \(el\.stAsk && el\.stAsk\.value\.trim\(\)\)\)/.test(st) && /el\.stAsk = |stAsk/.test(st));
  ok("the chat box id it checks ('in') exists in the page", /<textarea id="in"/.test(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8')));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
