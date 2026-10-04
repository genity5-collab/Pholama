// Closed-app update logic and generated systemd timer are testable without creating OS tasks.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-schedule-'));
const U = require('../server/update'), S = require('../server/update-scheduler');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x || ''))); if (!c) bad++; };
(async () => {
  let runs = 0;
  U.setAuto(false);
  let r = await U.offlineCheck({ isRunning: async () => false, runUpdate: async () => { runs++; return { ok: true }; } });
  ok('closed-app checker respects the automatic-update off switch', r.skipped === 'automatic-updates-off' && runs === 0);
  U.setAuto(true);
  r = await U.offlineCheck({ isRunning: async () => true, runUpdate: async () => { runs++; return { ok: true }; } });
  ok('scheduled check skips when Pholama is already running', r.skipped === 'app-running' && runs === 0);
  r = await U.offlineCheck({ isRunning: async () => false, runUpdate: async () => { runs++; return { ok: true, updated: true }; } });
  ok('closed and enabled checker invokes the updater', r.updated === true && runs === 1);
  const units = S.unitContents();
  ok('Linux timer waits after boot and repeats every five hours', /OnBootSec=5min/.test(units.timer) && /OnUnitActiveSec=5h/.test(units.timer) && /Persistent=true/.test(units.timer));
  ok('Linux updater invokes this install’s absolute Node and CLI paths', units.service.includes(S.paths.NODE) && units.service.includes(S.paths.CLI) && /--if-closed/.test(units.service));
  ok('scheduler config reserves a per-user saved server port', S.files().port.endsWith(path.join('update-scheduler', 'port')));
  ok('scheduled check is a separate CLI mode', /--if-closed/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'cli.js'), 'utf8')));
  ok('the live server uses a five-minute automatic check interval', /startBackground\(5\s*\/\s*60\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8')));
  try { fs.rmSync(process.env.PHOLAMA_HOME, { recursive: true, force: true }); } catch {}
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
