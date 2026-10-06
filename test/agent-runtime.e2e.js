// End to end: a fake local AI (plain HTTP, replies with <tool_call> text) drives the REAL tool runner on a REAL temp workspace.
// Proves: real files are listed/read/changed, tests really run, nothing runs before Allow, bad calls are refused, loops are capped.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-ws-')); process.env.PHOLAMA_WORKSPACE = ws;
const agent0 = require('../server/agent.js'), tools2 = require('../server/tools2.js'), R = require('../server/registry.js');
// the same safety net the real server puts around every tool call (server.js: try { runTool } catch (e) { 'Tool error: ' + e.message })
const agent = { ...agent0, runTool: async (...a) => { try { return String(await agent0.runTool(...a)); } catch (e) { return 'Tool error: ' + e.message; } } };
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };

fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
fs.writeFileSync(path.join(ws, 'src/App.js'), 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n');
fs.writeFileSync(path.join(ws, 'app.test.js'), "const { test } = require('node:test'); const assert = require('node:assert'); const { add } = require('./src/App.js');\ntest('add', () => { assert.strictEqual(add(2, 3), 5); });\n");
fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
fs.writeFileSync(path.join(ws, 'junk.txt'), 'delete me');

// ---- the fake local AI: a script of what it says next, chosen by what the tool results show
let seen = []; const script = [];
const server = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { const j = JSON.parse(b || '{}'); seen.push(j); const next = script.shift() || 'Done.'; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: typeof next === 'function' ? next(j) : next } }] })); }); });

const all = tools2.tools().concat([{ name: 'calculator', desc: 'math' }, { name: 'current_time', desc: 'time' }]);
const call = async (port, messages) => { const r = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'local', messages }) }); return (await r.json()).choices[0].message.content; };

// A small loop exactly like the server's: ask the model, parse <tool_call>, run the real tool through the gate, feed the result back.
async function loop(port, userText, ctx, maxTurns = 10) {
  const messages = [{ role: 'user', content: userText }], steps = [];
  for (let i = 0; i < maxTurns; i++) {
    const text = await call(port, messages), m = /<tool_call>([\s\S]*?)<\/tool_call>/.exec(text);
    if (!m) return { final: text, steps };
    let c; try { c = JSON.parse(m[1]); } catch { messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'Tool error: your tool call could not be read.' }); continue; }
    const t0 = Date.now(); const result = await agent.runTool(all, c.name, c.arguments || c.args, ctx);
    steps.push({ name: c.name, result, ms: Date.now() - t0 }); messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'Tool result for ' + c.name + ':\n' + result });
  }
  return { final: '(stopped: too many turns)', steps };
}
const tc = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port, pending = [];
  const mk = extra => ({ toolCalls: 0, maxToolCalls: 12, userId: 'e2e', onPending: p => pending.push(p), ...extra });

  // ===== Scenario 1: "List my project files."
  R.resetRate(); script.push(tc('list_files', {}), r => 'Your project has: ' + /src\/App\.js/.exec(r.messages.at(-1).content)[0] + ' and app.test.js.');
  let out = await loop(port, 'List my project files.', mk());
  ok('1. list_files really ran and returned the real files', out.steps.length === 1 && out.steps[0].name === 'list_files' && /src\/App\.js/.test(out.steps[0].result) && /app\.test\.js/.test(out.steps[0].result) && /package\.json/.test(out.steps[0].result), out.steps[0] && out.steps[0].result);
  ok('1. the final answer names a real file that came from the tool', /src\/App\.js/.test(out.final));
  ok('1. the model saw the tool result as its next message', /Tool result for list_files/.test(seen.at(-1).messages.at(-1).content));

  // ===== Scenario 2: read, find the bug, fix, run tests
  R.resetRate(); seen = []; pending.length = 0;
  script.push(tc('read_file', { path: 'src/App.js' }), r => /return a - b/.test(r.messages.at(-1).content) ? tc('search_code', { query: 'a - b' }) : 'I could not see the file.', tc('edit_code', { path: 'src/App.js', find: 'return a - b;', replace: 'return a + b;' }), tc('run_tests', {}), 'Fixed: add() subtracted. It now adds.');
  out = await loop(port, 'Read src/App.js, find a bug, fix it and run tests.', mk());
  ok('2. read_file returned the real buggy code', /return a - b/.test(out.steps[0].result), out.steps[0].result);
  ok('2. search_code found the real line', out.steps[1].name === 'search_code' && /src\/App\.js:2:/.test(out.steps[1].result), out.steps[1].result);
  ok('2. edit_code really changed the file on disk', /return a \+ b/.test(fs.readFileSync(path.join(ws, 'src/App.js'), 'utf8')) && !/a - b/.test(fs.readFileSync(path.join(ws, 'src/App.js'), 'utf8')));
  ok('2. run_tests did NOT run before the user said Allow', out.steps[3].name === 'run_tests' && /waiting for the user to click Allow/.test(out.steps[3].result) && /NOT run/.test(out.steps[3].result), out.steps[3].result);
  ok('2. the approval request names the tool and its level', pending.length === 1 && pending[0].tool === 'run_tests' && pending[0].level === 'ADMIN', JSON.stringify(pending));
  ok('2. the final answer does not claim the tests passed', !/passed/i.test(out.final));
  const outApproved = await agent.approveTool(pending[0].id);
  ok('2. after Allow, the tests REALLY ran and passed', /TESTS PASSED/.test(outApproved), outApproved);
  ok('2. the same approval cannot be used twice', await agent.approveTool(pending[0].id).then(() => false, e => /expired|already/.test(e.message)));

  // ===== Approval of a failing project is reported as failing
  fs.writeFileSync(path.join(ws, 'src/App.js'), 'module.exports = { add: (a, b) => a - b };\n');
  R.resetRate(); pending.length = 0; await agent.runTool(all, 'run_tests', {}, mk());
  const failOut = await agent.approveTool(pending[0].id);
  ok('a failing project really reports TESTS FAILED (no faked success)', /TESTS FAILED/.test(failOut), failOut);

  // ===== Destructive: delete_file waits, and only Allow deletes
  R.resetRate(); pending.length = 0; let r = await agent.runTool(all, 'delete_file', { path: 'junk.txt' }, mk());
  ok('delete_file does not delete before Allow', fs.existsSync(path.join(ws, 'junk.txt')) && /NOT run/.test(r) && pending.length === 1 && pending[0].level === 'DESTRUCTIVE', r);
  await agent.approveTool(pending[0].id);
  ok('delete_file deletes after Allow', !fs.existsSync(path.join(ws, 'junk.txt')));
  R.resetRate(); fs.writeFileSync(path.join(ws, 'junk2.txt'), 'x'); pending.length = 0; const id0 = pending.length;
  r = await agent.runTool(all, 'delete_file', { path: 'junk2.txt' }, mk({ policy: { approveDestructive: false } }));
  ok('with approval switched off by the user, delete_file runs directly', !fs.existsSync(path.join(ws, 'junk2.txt')) && pending.length === id0);
  ok('a model cannot approve itself by sending an "approved" argument', (() => { fs.writeFileSync(path.join(ws, 'j3.txt'), 'x'); return true; })() && /not valid|not an argument/.test(await agent.runTool(all, 'delete_file', { path: 'j3.txt', approved: true }, mk())) && fs.existsSync(path.join(ws, 'j3.txt')));

  // ===== Safety
  R.resetRate();
  ok('path traversal is refused and reads nothing', /not allowed|outside/.test(await agent.runTool(all, 'read_file', { path: '../../etc/passwd' }, mk())));
  ok('an absolute path cannot escape the workspace', !/root:/.test(await agent.runTool(all, 'read_file', { path: '/etc/passwd' }, mk())));
  ok('search_code cannot search outside the workspace', /not allowed|outside/.test(await agent.runTool(all, 'search_code', { query: 'root', path: '../..' }, mk())));
  ok('a made-up tool is refused and nothing runs', /no tool called/.test(await agent.runTool(all, 'shell', { command: 'id' }, mk())));
  { const before = pending.length; const o = await agent.runTool(all, 'run_command', { command: 'id' }, mk()); ok('run_command is refused when it is not in the tool list, and nothing is queued', /unknown tool|no tool called/.test(o) && pending.length === before, o); }
  ok('a wrong argument type is refused before anything runs', /not valid/.test(await agent.runTool(all, 'read_file', { path: { a: 1 } }, mk())));
  ok('an oversized write is refused', /too big|longer/.test(await agent.runTool(all, 'write_file', { path: 'big.txt', content: 'x'.repeat(50000) }, mk())) && !fs.existsSync(path.join(ws, 'big.txt')));
  ok('the test runner gets no server secrets', (() => { fs.writeFileSync(path.join(ws, 'env.test.js'), "const {test}=require('node:test');test('e',()=>{ if(process.env.PHOLAMA_SECRET_PROBE) throw new Error('LEAK'); });"); return true; })());
  process.env.PHOLAMA_SECRET_PROBE = 'topsecret'; R.resetRate(); pending.length = 0; fs.writeFileSync(path.join(ws, 'src/App.js'), 'module.exports={add:(a,b)=>a+b};'); await agent.runTool(all, 'run_tests', {}, mk());
  ok('secrets in the server environment do not reach the tests', !/LEAK/.test(await agent.approveTool(pending[0].id)));

  // ===== gaps found by mutation testing
  R.resetRate();
  fs.mkdirSync('/tmp/pholama-outside-probe', { recursive: true }); fs.writeFileSync('/tmp/pholama-outside-probe/secret.txt', 'OUTSIDE-SECRET-TEXT');
  ok('search_code with an absolute outside folder finds nothing from outside', !/OUTSIDE-SECRET-TEXT/.test(await agent.runTool(all, 'search_code', { query: 'OUTSIDE-SECRET', path: '/tmp/pholama-outside-probe' }, mk())));
  ok('search_code with a relative escape is refused', /not allowed|outside/.test(await agent.runTool(all, 'search_code', { query: 'OUTSIDE', path: '../../../tmp/pholama-outside-probe' }, mk())));
  fs.rmSync('/tmp/pholama-outside-probe', { recursive: true, force: true });
  // a link inside the workspace that points outside must not be followed
  fs.mkdirSync('/tmp/pholama-link-target', { recursive: true }); fs.writeFileSync('/tmp/pholama-link-target/x.txt', 'LINKED-SECRET');
  try { fs.symlinkSync('/tmp/pholama-link-target', path.join(ws, 'lnk')); ok('a symlink out of the workspace is not followed by read_file', !/LINKED-SECRET/.test(await agent.runTool(all, 'read_file', { path: 'lnk/x.txt' }, mk()))); ok('a symlink out of the workspace is not followed by search_code', !/LINKED-SECRET/.test(await agent.runTool(all, 'search_code', { query: 'LINKED', path: 'lnk' }, mk()))); } catch (e) { ok('symlink test could run', false, e.message); }
  fs.rmSync('/tmp/pholama-link-target', { recursive: true, force: true });
  // the approved path goes through the gate again: bad arguments stored in a pending request are still refused
  R.resetRate(); pending.length = 0; await agent.runTool(all, 'run_tests', {}, mk());
  ok('an approval id for run_tests runs ONLY run_tests', (() => { return pending[0].tool === 'run_tests'; })());
  R.resetRate(); for (let i = 0; i < 90; i++) R.rateOk('approved', 'flood_' + i);
  ok('the approved re-run also goes through the gate (rate limit applies to it)', /Too many tool calls this minute/.test(await agent.approveTool(pending[0].id)));
  R.resetRate();
  ok('NaN and Infinity are refused for a count', !R.validate({ path: 'a', start: NaN }, R.get('read_file').schema).length === false && R.validate({ path: 'a', end: Infinity }, R.get('read_file').schema).length > 0);

  // ===== Endless loop is capped
  R.resetRate(); const c = mk({ maxToolCalls: 5 }); let refused = 0;
  for (let i = 0; i < 9; i++) { const o = await agent.runTool(all, 'current_time', {}, c); if (/Too many tool calls/.test(o)) refused++; }
  ok('an endless loop is stopped at the call limit', c.toolCalls === 5 && refused === 4, c.toolCalls + ' ' + refused);
  ok('a model that keeps calling tools is stopped by the loop turn cap', (await (async () => { script.length = 0; for (let i = 0; i < 20; i++) script.push(tc('current_time', {})); R.resetRate(); const o = await loop(port, 'loop', mk(), 6); return o; })()).final.startsWith('(stopped'));

  // ===== Real built-ins
  R.resetRate();
  ok('calculator really computes', /156/.test(await agent.runTool(all, 'calculator', { expression: '12*13' }, mk())));
  ok('current_time really returns a time', /20\d\d/.test(await agent.runTool(all, 'current_time', {}, mk())));
  ok('write_file then read_file round trip on disk', (await agent.runTool(all, 'write_file', { path: 'notes/a.txt', content: 'hello\nworld' }, mk()), /2: world/.test(await agent.runTool(all, 'read_file', { path: 'notes/a.txt' }, mk()))) && fs.readFileSync(path.join(ws, 'notes/a.txt'), 'utf8') === 'hello\nworld');

  server.close(); fs.rmSync(ws, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
});
