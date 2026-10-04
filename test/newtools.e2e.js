// New: factual questions search first, video/picture cards, and the My tools maker (safe secrets, local only).
// Regression: "search me a image of a cat" crashed with "Cannot access 'searchRan' before initialization" and searched the wrong words.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'llama3.2-3b') || cat.find(x => /llama/.test(x.id));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-fs-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  fs.writeFileSync(path.join(home, 'search.html'), '<a class="result__a" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Great video</a> x <a class="result__snippet" href="#">A video about it.</a> <a class="result__a" href="https://en.wikipedia.org/wiki/Mount_Everest">Mount Everest</a> x <a class="result__snippet" href="#">Mount Everest is 8,849 metres tall.</a>');
  fs.writeFileSync(path.join(home, 'wiki.json'), JSON.stringify({ query: { pages: { 1: { title: 'Red panda', index: 1, original: { source: 'https://upload.wikimedia.org/wikipedia/commons/f/fd/Red_Panda.jpg' } } } } }));
  const script = path.join(home, 'fake.js');
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
require('fs').appendFileSync(process.env.HOME+'/model-saw.txt', b+'\\n');
const out=/design ONE custom web tool/.test(b)?'{"name":"notion_read","title":"Notion reader","what":"Read a Notion page by its id","method":"GET","url":"https://api.notion.com/v1/pages/{{page}}","headers":{"Authorization":"Bearer {{secret.NOTION_KEY}}"},"params":["page"]}':'Here is a gallery of cat pictures from example.com.';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  fs.copyFileSync(process.execPath, path.join(home, 'real')); fs.chmodSync(path.join(home, 'real'), 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${path.join(home, 'real')}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 29000 + Math.floor(Math.random() * 4000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_TEST_WIKI: path.join(home, 'wiki.json'), PHOLAMA_TEST_SEARCH: path.join(home, 'search.html') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 600))); if (!c) bad++; };
  const chat = async q => (await (await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, messages: [{ role: 'user', content: q }] }) })).text());
  try {
    let t = await chat('how tall is mount everest');
    ok('a plain factual question searches the web first', /"name":"web_search"/.test(t) && /mount everest/i.test(t), t);
        t = await chat('show me a video of rick');
    ok('a video request searches, then SHOWS a youtube video', /"name":"web_search"/.test(t) && /"media":\{"kind":"video","id":"dQw4w9WgXcQ"/.test(t), t);
    t = await chat('show me a picture of a red panda');
    ok('a picture request shows a real picture (youtube page is NOT used as a picture)', /"media":\{"kind":"image","url":"https:\/\/upload\.wikimedia\.org/.test(t) && !/"kind":"image","url":"https:\/\/www\.youtube/.test(t), t.slice(0,2000));
    t = await chat('how are you today');
    ok('small talk does NOT search', !/"name":"web_search"/.test(t), t);
    t = await chat('write me a function that adds two numbers');
    ok('a coding request does NOT search', !/"name":"web_search"/.test(t), t);
    // ---- @plugin: calling a plugin by name turns it on for that one message, even if its switch is off
    const seenFile = path.join(home, 'model-saw.txt'), seenNow = () => (fs.existsSync(seenFile) ? fs.readFileSync(seenFile, 'utf8') : '');
    const ask = async (q, sw) => { const before = seenNow().length; const txt = await (await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, switches: sw || {}, messages: [{ role: 'user', content: q }] }) })).text(); return { txt, saw: seenNow().slice(before) }; };
    let q = await ask('what is in my repo', { github: false });
    ok('without a mention and with GitHub off, the AI is NOT given GitHub tools', q.saw.length > 0 && !/github_search_repos|github_read_file/.test(q.saw), q.saw.slice(0, 200));
    q = await ask('@github what is in my repo', { github: false });
    ok('@github gives the AI the GitHub tools even with the switch off', /github_[a-z_]+/.test(q.saw), q.saw.slice(0, 300));
    ok('the AI is told the user called @github and must not say it cannot access it', /called these plugins by name/.test(q.saw) && /@github/.test(q.saw), q.saw.slice(0, 300));
    ok('the live log tells the person the plugin was turned on', /"log"[^\n]*You called @github|You called @github/.test(q.txt), q.txt.slice(0, 300));
    q = await ask('mail bob@github.com about it', { github: false });
    ok('an email address does NOT turn GitHub on', !/called these plugins by name/.test(q.saw), q.saw.slice(0, 200));
    q = await ask('@terminal run ls', { terminal: false });
    ok('@terminal does nothing (the terminal has its own switch)', !/run_command/.test(q.saw) && !/called these plugins by name/.test(q.saw), q.saw.slice(0, 200));
    q = await ask('@nothing_here hello', {});
    ok('an unknown @name is ignored', !/called these plugins by name/.test(q.saw), q.saw.slice(0, 200));
    // ---- my tools: the API only works from this PC, secrets are never sent back
    const J = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ s: r.status, j: await r.json() }));
    let r = await J('/api/mytools/secret', { name: 'SB_KEY', value: 'sbp_TOPSECRETVALUE_123' }); ok('saves a secret', r.j.ok && r.j.secrets.includes('SB_KEY'), JSON.stringify(r));
    r = await fetch(B + '/api/mytools').then(x => x.text()); ok('the secret VALUE is never sent back', !/TOPSECRETVALUE/.test(r) && /SB_KEY/.test(r), r);
    r = await J('/api/mytools/save', { name: 'db_read', what: 'Read rows from my database table', method: 'GET', url: 'https://abc.supabase.co/rest/v1/{{table}}', headers: { apikey: '{{secret.SB_KEY}}' }, params: ['table'] }); ok('saves a tool', r.j.ok, JSON.stringify(r));
    r = await J('/api/mytools/save', { name: 'bad', what: 'points at my own PC', url: 'https://127.0.0.1/x' }); ok('a tool can be saved but is blocked when run', r.j.ok || r.s === 400, JSON.stringify(r));
    r = await J('/api/mytools/save', { name: 'nohttp', what: 'uses plain http here', url: 'http://example.com' }); ok('http:// is refused', r.s === 400, JSON.stringify(r));
    r = await fetch(B + '/api/mytools', { headers: { Origin: 'https://evil.example' } }); ok('a website cannot read or change your tools', r.status === 403, r.status);
    // ---- create a tool with the AI: the key is saved first, the model only ever sees the secret's NAME
    r = await J('/api/mytools/draft', { model: 'gguf:' + m.id, service: 'Notion', want: 'Read a page from my workspace by its id', apiKey: 'secret_SUPERPRIVATEKEY_98765', secretName: 'notion_key' });
    ok('the AI drafts a tool', r.s === 200 && r.j.draft && r.j.draft.name === 'notion_read' && r.j.secret === 'NOTION_KEY', JSON.stringify(r));
    ok('the draft uses the secret name, not the key', r.j.draft && r.j.draft.headers.Authorization === 'Bearer {{secret.NOTION_KEY}}' && !JSON.stringify(r).includes('SUPERPRIVATEKEY'), JSON.stringify(r.j));
    const saw = fs.existsSync(path.join(home, 'model-saw.txt')) ? fs.readFileSync(path.join(home, 'model-saw.txt'), 'utf8') : '';
    ok('the model was asked to design the tool', /design ONE custom web tool/.test(saw), saw.slice(0, 200));
    ok('THE MODEL NEVER SAW THE API KEY', !/SUPERPRIVATEKEY/.test(saw), 'the key reached the model');
    ok('the model was told the secret NAME', /NOTION_KEY/.test(saw));
    ok('the key is saved as a secret', (await fetch(B + '/api/mytools').then(x => x.json())).secrets.includes('NOTION_KEY'));
    ok('drafting does NOT save a tool yet', !(await fetch(B + '/api/mytools').then(x => x.json())).tools.some(x => x.name === 'notion_read'));
    r = await J('/api/mytools/save', { ...r.j.draft }); ok('after review, saving makes the tool', r.j.ok, JSON.stringify(r));
    r = await J('/api/mytools/update', { name: 'notion_read', newName: 'notion_page', title: 'My Notion', what: 'Read a Notion page using its id', thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' });
    ok('a tool can be renamed, re-described and given a picture', r.j.ok && r.j.tools.some(x => x.name === 'notion_page' && x.title === 'My Notion' && x.thumb.startsWith('data:image/png')), JSON.stringify(r).slice(0, 300));
    r = await J('/api/mytools/update', { name: 'notion_page', thumb: 'javascript:alert(1)' }); ok('a dangerous picture is refused', r.s === 400, JSON.stringify(r));
    r = await J('/api/mytools/draft', { model: 'gguf:' + m.id, want: 'x' }); ok('a vague request is refused', r.s === 400, JSON.stringify(r));
    r = await J('/api/mytools/draft', { model: 'gguf:' + m.id, want: 'Read a page from my workspace', secretName: 'nothing_saved', service: 'Zzz' }); ok('no key and none saved: asks for the key', r.s === 400 && /key/i.test(r.j.error), JSON.stringify(r));
    r = await fetch(B + '/api/mytools/draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' }); ok('a website cannot ask the AI to make tools', r.status === 403, r.status);
    r = await J('/api/mytools/approve', { id: 'doesnotexist', approve: true }); ok('approving something that does not exist is harmless', r.j.ok === false, JSON.stringify(r));
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
