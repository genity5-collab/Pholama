// Updates are the user's choice. A user who NEVER touched the switch must not get updates installed behind their back,
// not by the live app and not by the scheduled task that runs while Pholama is closed.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x || '').slice(0, 240))); if (!c) bad++; };
// Each case runs in its own process, because the update module reads its saved choice once when it loads.
const run = (settings, code) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-opt-'));
  if (settings !== null) { fs.mkdirSync(path.join(home, '.pholama'), { recursive: true }); fs.writeFileSync(path.join(home, '.pholama', 'update.json'), JSON.stringify(settings)); }
  const r = spawnSync(process.execPath, ['-e', `process.env.HOME=process.env.USERPROFILE=${JSON.stringify(home)};process.env.PHOLAMA_HOME=${JSON.stringify(home)};(async()=>{const U=require(${JSON.stringify(path.join(__dirname, '..', 'server', 'update'))});${code}})().catch(e=>console.log('CRASH '+e.message))`], { encoding: 'utf8', timeout: 20000 });
  fs.rmSync(home, { recursive: true, force: true }); return (r.stdout || '').trim().split('\n').pop();
};
const closed = "let runs=0;const r=await U.offlineCheck({isRunning:async()=>false,runUpdate:async()=>{runs++;return{ok:true,updated:true}}});console.log(JSON.stringify({skipped:r.skipped||null,runs,auto:U.status().auto}));";
let o = JSON.parse(run(null, closed));
ok('a user who never chose has automatic updates OFF', o.auto === false, JSON.stringify(o));
ok('the closed-app scheduled task does NOT install for a user who never chose', o.runs === 0 && o.skipped === 'automatic-updates-off', JSON.stringify(o));
o = JSON.parse(run({}, closed)); ok('an empty settings file counts as never chose', o.runs === 0 && o.auto === false, JSON.stringify(o));
o = JSON.parse(run({ auto: 'yes' }, closed)); ok('a garbage value does not switch updates on', o.runs === 0 && o.auto === false, JSON.stringify(o));
o = JSON.parse(run({ auto: false }, closed)); ok('a user who chose OFF stays off', o.runs === 0 && o.skipped === 'automatic-updates-off', JSON.stringify(o));
o = JSON.parse(run({ auto: true }, closed)); ok('a user who chose ON keeps getting updates', o.runs === 1 && o.auto === true, JSON.stringify(o));
// the live background check must also leave a never-chose user alone
const bg = "const r=await U.backgroundCheck({});console.log(JSON.stringify({auto:U.status().auto,installing:!!(r&&r.updated)}));";
o = JSON.parse(run(null, bg)); ok('the live check never installs for a user who never chose', o.installing === false && o.auto === false, JSON.stringify(o));
ok('turning it ON is remembered', JSON.parse(run(null, "U.setAuto(true);console.log(JSON.stringify({auto:U.status().auto,saved:JSON.parse(require('fs').readFileSync(require('path').join(process.env.HOME,'.pholama','update.json'),'utf8')).auto}))")).saved === true);
console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
