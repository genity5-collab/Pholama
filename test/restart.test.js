// The replacement server must not race the old copy for its listening port.
const net = require('net'), path = require('path');
const { relaunch } = require('../server/restart-child');
const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x || ''))); if (!c) bad++; };
(async () => {
  const server = net.createServer().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const port = server.address().port; let called = 0, unref = 0, atRelease = false;
  const job = relaunch(port, path.join(__dirname, '..', 'server', 'server.js'), { tries: 40, interval: 15, spawnProcess: () => { called++; const c = net.createConnection({ host: '127.0.0.1', port }); c.on('error', () => {}); c.destroy(); atRelease = !server.listening; return { unref() { unref++; } }; } });
  await wait(90); await new Promise(r => server.close(r));
  const success = await job;
  ok('restart helper eventually launches after the port is released', success && called === 1 && unref === 1 && atRelease, { success, called, unref, atRelease });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
