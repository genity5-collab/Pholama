// The screenshot bug: the model writes its tool call as text, "<web_search {...}>", and then invents an answer.
// On the REAL server with a fake model, the search must really run, the raw tag must never be shown, and the answer must use the real result.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-tt-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  fs.writeFileSync(path.join(home, 'search.html'), '<a class="result__a" href="https://example.com/pholama">Pholama 0.9.6 released</a> x <a class="result__snippet" href="#">Pholama adds plugins and skills in version 0.9.6.</a>');
  const script = path.join(home, 'fake-engine.js');
  // Turn 1: the model writes the call as TEXT in the given style. Turn 2 (it has now seen a tool result): it answers from the result.
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
const sawResult=/0\\.9\\.6 released|Pholama adds plugins/.test(b);
const style=(/STYLE_(\\w+)/.exec(b)||[])[1]||'TAG';
const call={TAG:'<web_search {"query": "latest news Pholama app"}>',BODY:'Let me check.\\n<web_search>{"query":"latest news Pholama app"}</web_search>',FUNC:'web_search({"query": "latest news Pholama app"})',MISTRAL:'[TOOL_CALLS] [{"name":"web_search","arguments":{"query":"latest news Pholama app"}}]'}[style];
const out=sawResult?'Pholama 0.9.6 adds plugins and skills.':call;
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');for(const ch of out.match(/.{1,6}/gs))s.write('data: '+JSON.stringify({choices:[{delta:{content:ch}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_TEST_SEARCH: path.join(home, 'search.html') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 500))); if (!c) bad++; };
  const say = async content => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, messages: [{ role: 'user', content }] }) }); const t = await r.text(); let shown = ''; for (const l of t.split('\n')) { try { const j = JSON.parse(l); if (j.message && j.message.content && !j.tool) shown += j.message.content; } catch {} } return { raw: t, shown }; };
  try {
    for (const style of ['TAG', 'BODY', 'FUNC', 'MISTRAL']) {
      const r = await say('what is new with the Pholama app lately STYLE_' + style);
      ok(style + ': the search really ran', /web_search/.test(r.raw) && /Pholama 0\.9\.6 released|example\.com\/pholama/.test(r.raw), r.raw.slice(0, 400));
      ok(style + ': the raw tool text was never shown', !/<web_search|web_search\(|\[TOOL_CALLS\]/.test(r.shown), r.shown);
      ok(style + ': the answer comes from the real result', /0\.9\.6/.test(r.shown), r.shown);
    }
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
