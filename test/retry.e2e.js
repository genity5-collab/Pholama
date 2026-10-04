// End to end: the REAL server talking to a scripted fake model that misbehaves the way small models do.
// Run: node test/retry.e2e.js    (used by test/core.test.js too)
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const scenarios = {
  // every scenario is a list of replies the fake model gives, in order. The last one repeats.
  brokenThenGood: ['Sure, I will list them. <tool_call>{name: list_files, arguments: }</tool_call>', '<tool_call>{"name": "list_files", "arguments": {}}</tool_call>', 'Your workspace is empty.'],
  alwaysBroken: ['<tool_call>{oops</tool_call>'],
  wordsThenBroken: ['Let me check that for you. <tool_call>{"name": "list_files", "arguments": '],
  toolFailsThenFixed: ['<tool_call>{"name": "read_file", "arguments": {"path": "nope/missing.txt"}}</tool_call>', '<tool_call>{"name": "list_files", "arguments": {}}</tool_call>', 'There is no such file, the folder is empty.'],
  toolAlwaysFails: ['<tool_call>{"name": "read_file", "arguments": {"path": "nope/missing.txt"}}</tool_call>', '<tool_call>{"name": "read_file", "arguments": {"path": "nope/missing.txt"}}</tool_call>', '<tool_call>{"name": "read_file", "arguments": {"path": "nope/missing2.txt"}}</tool_call>', 'I could not read that file because it does not exist.'],
  plainAnswer: ['Hello! Nice to meet you.'],
};
async function run(name, thinkingOn) {
  let n = 0, seen = [];
  const fake = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', c => b += c); rq.on('end', () => {
      if (rq.url === '/api/chat') { let j = {}; try { j = JSON.parse(b); } catch {} seen.push((j.messages || []).slice(-1)[0]); const list = scenarios[name], text = list[Math.min(n++, list.length - 1)];
        rs.setHeader('Content-Type', 'application/x-ndjson'); for (let i = 0; i < text.length; i += 6) rs.write(JSON.stringify({ message: { content: text.slice(i, i + 6) }, done: false }) + '\n'); return rs.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n'); }
      rs.setHeader('Content-Type', 'application/json');
      if (rq.url === '/api/show') return rs.end(JSON.stringify({ capabilities: ['completion', 'tools'], details: { parameter_size: '7B' } }));
      rs.end(JSON.stringify({ models: [] })); }); });
  await new Promise(r => fake.listen(0, r)); const fport = fake.address().port;
  const port = 20000 + Math.floor(Math.random() * 9000), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-e2e-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), OLLAMA_URL: 'http://127.0.0.1:' + fport, HOME: home, USERPROFILE: home, PHOLAMA_NO_OPEN: '1', PHOLAMA_NO_SCHEDULE: '1', PHOLAMA_NO_AUTOUPDATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/hardware`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  let shown = '', tools = [], err = null, steps = [];
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'ollama:fake', agent: true, switches: { thinking: !!thinkingOn }, messages: [{ role: 'user', content: 'what files do I have?' }] }) });
    const txt = await r.text(); for (const l of txt.split('\n')) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch { continue; } if (o.message && o.message.content && !o.done) shown += o.message.content; if (o.tool) tools.push(o.tool); if (o.error) err = o.error; }
  } catch (e) { err = String(e.message); }
  srv.kill(); fake.close(); try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  return { shown, tools, err, calls: n, logs };
}
module.exports = { run, scenarios };
if (require.main === module) (async () => {
  let bad = 0; const ok = (nm, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + nm + (c ? '' : '  -> ' + x)); if (!c) bad++; };
  const leak = s => /<\/?tool|"arguments"\s*:|tool_call/i.test(s);
  let r = await run('plainAnswer'); ok('plain answer is shown as is', /Nice to meet you/.test(r.shown) && r.calls === 1, JSON.stringify(r).slice(0, 300));
  r = await run('brokenThenGood'); ok('broken call: retried, then it worked', r.calls >= 3 && r.tools.some(t => t.name === 'list_files') && /empty/i.test(r.shown), JSON.stringify({ calls: r.calls, tools: r.tools, shown: r.shown }));
  ok('broken call: the command text never reached the screen', !leak(r.shown), r.shown);
  r = await run('alwaysBroken'); ok('always broken: gave up politely after retries, not instantly', r.calls === 3, 'calls=' + r.calls);
  ok('always broken: says it could not, shows no command', /could not get it right/.test(r.shown) && !leak(r.shown), r.shown);
  r = await run('wordsThenBroken'); ok('words then a half command: the words show, the command does not', /Let me check that/.test(r.shown) && !leak(r.shown), r.shown);
  r = await run('toolFailsThenFixed'); ok('tool error: the AI got a second try and used it', r.calls >= 3 && r.tools.some(t => t.name === 'list_files'), JSON.stringify({ calls: r.calls, tools: r.tools.map(t => t.name) }));
  ok('tool error: final answer is words, no command', /no such file|empty/i.test(r.shown) && !leak(r.shown), r.shown);
  r = await run('toolAlwaysFails'); ok('tool always fails: tried again twice, then stopped and explained', r.calls >= 3 && r.calls <= 5 && /not exist|could not/i.test(r.shown), JSON.stringify({ calls: r.calls, shown: r.shown }));
  // Same bugs with Thinking ON (the default). The model may write its command inside its working notes.
  r = await run('brokenThenGood', true); ok('thinking on: a command written in the notes never reaches the screen', !leak(r.shown), r.shown);
  r = await run('alwaysBroken', true); ok('thinking on: still no command shown, and a polite stop', !leak(r.shown) && /could not get it right|empty|workspace/i.test(r.shown), r.shown);
  r = await run('toolFailsThenFixed', true); ok('thinking on: tool error still gets its retry', r.tools.some(t => t.name === 'list_files') && !leak(r.shown), JSON.stringify({ tools: r.tools.map(t => t.name), shown: r.shown }));
  console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
