'use strict';
// Runs the standalone updater while the Pholama UI/server is closed. The task is per-user,
// does not require admin rights, and only runs when the user is logged in.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), HOME = path.join(os.homedir(), '.pholama');
const CLI = path.join(ROOT, 'server', 'cli.js'), NODE = process.execPath;
const label = 'com.pholama.background-update';
const psDir = path.join(HOME, 'update-scheduler');
const vb = s => '"' + String(s).replace(/"/g, '""') + '"';
const systemdQuote = s => '"' + String(s).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function files() {
  return { plist: path.join(os.homedir(), 'Library', 'LaunchAgents', label + '.plist'),
    unitDir: path.join(os.homedir(), '.config', 'systemd', 'user'),
    vbs: path.join(psDir, 'update-hidden.vbs'), port: path.join(psDir, 'port') };
}
function rememberPort() { fs.mkdirSync(psDir, { recursive: true }); fs.writeFileSync(files().port, String(Math.max(1, Number(process.env.PORT) || 11435)) + '\n', { mode: 0o600 }); }
function installWindows() {
  fs.mkdirSync(psDir, { recursive: true });
  const command = vb(NODE) + ' ' + vb(CLI) + ' update --if-closed';
  fs.writeFileSync(files().vbs, 'Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = ' + vb(ROOT) + '\r\nsh.Run ' + vb(command) + ', 0, True\r\n', 'ascii');
  const action = 'wscript.exe //B //NoLogo "' + files().vbs + '"';
  const create = (name, trigger) => execFileSync('schtasks.exe', ['/Create', ...trigger, '/TN', name, '/TR', action, '/F', '/RL', 'LIMITED', '/IT'], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
  create('Pholama Background Update', ['/SC', 'HOURLY', '/MO', '5']);
  create('Pholama Background Update on logon', ['/SC', 'ONLOGON']);
  return 'Background updates are scheduled every 5 hours and at sign-in.';
}
function removeWindows() {
  for (const name of ['Pholama Background Update', 'Pholama Background Update on logon']) {
    try { execFileSync('schtasks.exe', ['/Delete', '/TN', name, '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch {}
  }
  try { fs.rmSync(psDir, { recursive: true, force: true }); } catch {}
}
function installMac() {
  const f = files(); fs.mkdirSync(path.dirname(f.plist), { recursive: true }); fs.mkdirSync(HOME, { recursive: true });
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const args = [NODE, CLI, 'update', '--if-closed'];
  const plist = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0"><dict>', '<key>Label</key><string>' + label + '</string>', '<key>ProgramArguments</key><array>' + args.map(a => '<string>' + xml(a) + '</string>').join('') + '</array>', '<key>RunAtLoad</key><true/>', '<key>StartInterval</key><integer>18000</integer>', '<key>StandardOutPath</key><string>' + xml(path.join(HOME, 'update-scheduler.log')) + '</string>', '<key>StandardErrorPath</key><string>' + xml(path.join(HOME, 'update-scheduler.log')) + '</string>', '</dict></plist>'].join('\n');
  fs.writeFileSync(f.plist, plist, { mode: 0o600 });
  const domain = 'gui/' + process.getuid();
  try { execFileSync('launchctl', ['bootout', domain, f.plist], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', domain, f.plist], { stdio: 'ignore', timeout: 10000 });
  return 'Background updates are scheduled every 5 hours and at sign-in.';
}
function removeMac() {
  const f = files(), domain = 'gui/' + process.getuid();
  try { execFileSync('launchctl', ['bootout', domain, f.plist], { stdio: 'ignore' }); } catch {}
  try { fs.rmSync(f.plist, { force: true }); } catch {}
  try { fs.rmSync(psDir, { recursive: true, force: true }); } catch {}
}
function unitContents() {
  return { service: '[Unit]\nDescription=Check for Pholama updates while the app is closed\n\n[Service]\nType=oneshot\nExecStart=' + systemdQuote(NODE) + ' ' + systemdQuote(CLI) + ' update --if-closed\n',
    timer: '[Unit]\nDescription=Check Pholama updates every five hours\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=5h\nPersistent=true\nUnit=pholama-update.service\n\n[Install]\nWantedBy=timers.target\n' };
}
function installLinux() {
  const f = files(), names = unitContents(); fs.mkdirSync(f.unitDir, { recursive: true }); fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(f.unitDir, 'pholama-update.service'), names.service, { mode: 0o600 });
  fs.writeFileSync(path.join(f.unitDir, 'pholama-update.timer'), names.timer, { mode: 0o600 });
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore', timeout: 15000 });
  execFileSync('systemctl', ['--user', 'enable', '--now', 'pholama-update.timer'], { stdio: 'ignore', timeout: 15000 });
  return 'Background updates are scheduled every 5 hours and shortly after sign-in.';
}
function removeLinux() {
  const f = files();
  try { execFileSync('systemctl', ['--user', 'disable', '--now', 'pholama-update.timer'], { stdio: 'ignore', timeout: 10000 }); } catch {}
  for (const n of ['pholama-update.service', 'pholama-update.timer']) try { fs.rmSync(path.join(f.unitDir, n), { force: true }); } catch {}
  try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore', timeout: 10000 }); } catch {}
  try { fs.rmSync(psDir, { recursive: true, force: true }); } catch {}
}
function install() {
  rememberPort();
  if (process.platform === 'win32') return installWindows();
  if (process.platform === 'darwin') return installMac();
  if (process.platform === 'linux') return installLinux();
  throw new Error('Background update scheduling is not supported on this operating system.');
}
function ensure() {
  rememberPort();
  if (process.platform === 'win32') {
    try { execFileSync('schtasks.exe', ['/Query', '/TN', 'Pholama Background Update'], { stdio: 'ignore', windowsHide: true, timeout: 8000 });
      execFileSync('schtasks.exe', ['/Query', '/TN', 'Pholama Background Update on logon'], { stdio: 'ignore', windowsHide: true, timeout: 8000 }); return 'Background update tasks are already installed.'; } catch { return install(); }
  }
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['list', label], { stdio: 'ignore', timeout: 8000 }); if (fs.existsSync(files().plist)) return 'Background update task is already installed.'; } catch {} return install(); }
  if (process.platform === 'linux') {
    try { execFileSync('systemctl', ['--user', 'is-enabled', 'pholama-update.timer'], { stdio: 'ignore', timeout: 8000 }); if (fs.existsSync(path.join(files().unitDir, 'pholama-update.timer'))) return 'Background update task is already installed.'; } catch {}
    return install();
  }
  throw new Error('Background update scheduling is not supported on this operating system.');
}
function remove() {
  if (process.platform === 'win32') return removeWindows();
  if (process.platform === 'darwin') return removeMac();
  if (process.platform === 'linux') return removeLinux();
}
module.exports = { install, ensure, remove, files, rememberPort, unitContents, paths: { ROOT, HOME, CLI, NODE } };
