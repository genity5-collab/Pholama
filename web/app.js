// Pholama UI. Two engines:
//  "browser": WebLLM (WebGPU) runs the model inside this tab, weights cached in browser storage. Works on phones.
//  "local":   talks to the Pholama server on your PC (llama.cpp / Ollama) using PC RAM/GPU.
const $ = s => document.querySelector(s);
const chatEl = $('#chat'), inEl = $('#in'), sel = $('#model'), dlg = $('#dlg'), listEl = $('#list');
let catalog = null, server = null, tab = 'browser', engine = null, engineModel = null, history = [], busy = false;

const add = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; chatEl.appendChild(d); chatEl.scrollTop = 1e9; return d; };
const saved = () => JSON.parse(localStorage.getItem('pholama.ready') || '[]');
const markReady = id => { const s = new Set(saved()); s.add(id); localStorage.setItem('pholama.ready', JSON.stringify([...s])); };

async function init() {
  catalog = await (await fetch('models.json')).json();
  try { const r = await fetch('api/hardware'); if (r.ok && (r.headers.get('content-type') || '').includes('json')) server = await r.json(); } catch {}
  tab = server ? 'local' : 'browser';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !server) navigator.serviceWorker.register('sw.js').catch(() => {});
  refreshSelect();
  add('sys', server ? 'Connected to your PC. Pick a model, or open Models to download one.' : 'Running in browser mode. Open Models to download a small model to this device.');
  if (!sel.options.length) dlg.showModal(), render();
}

async function refreshSelect() {
  sel.innerHTML = '';
  for (const id of saved()) { const m = catalog.browser.find(x => x.id === id); if (m) sel.add(new Option('📱 ' + m.name, 'web:' + id)); }
  if (server) try {
    const t = await (await fetch('api/tags')).json();
    for (const m of t.models) sel.add(new Option('💻 ' + m.name.replace(/^(gguf|ollama):/, ''), m.name));
  } catch {}
}

async function ensureEngine(value) {
  if (!value.startsWith('web:')) return;
  const id = value.slice(4);
  if (engine && engineModel === id) return;
  if (!navigator.gpu) throw new Error('This browser has no WebGPU. Use Chrome on Android 121+, or Chrome/Edge on desktop.');
  const note = add('sys', 'Loading model...');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: p => note.textContent = p.text });
  engineModel = id; note.textContent = 'Model ready.'; markReady(id);
}

async function send() {
  const text = inEl.value.trim(); if (!text || busy || !sel.value) return;
  busy = true; $('#send').disabled = true; inEl.value = '';
  history.push({ role: 'user', content: text }); add('m u', text);
  const out = add('m a', '...'); let acc = '';
  try {
    await ensureEngine(sel.value);
    if (sel.value.startsWith('web:')) {
      const s = await engine.chat.completions.create({ messages: history, stream: true });
      for await (const c of s) { acc += c.choices[0]?.delta?.content || ''; out.textContent = acc; chatEl.scrollTop = 1e9; }
    } else {
      const r = await fetch('api/chat', { method: 'POST', body: JSON.stringify({ model: sel.value, messages: history }) });
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
          const j = JSON.parse(l); if (j.error) throw new Error(j.error);
          acc += j.message?.content || ''; out.textContent = acc; chatEl.scrollTop = 1e9;
        }
      }
    }
    history.push({ role: 'assistant', content: acc });
  } catch (e) { out.textContent = 'Error: ' + e.message; history.pop(); }
  busy = false; $('#send').disabled = false; inEl.focus();
}

// ----- model manager -----
function render() {
  $('#tLocal').style.display = server ? '' : 'none';
  $('#tBrowser').classList.toggle('on', tab === 'browser'); $('#tLocal').classList.toggle('on', tab === 'local');
  listEl.innerHTML = '';
  if (tab === 'browser') {
    $('#hw').textContent = navigator.gpu ? 'Models run inside this browser and are cached after the first download.' : 'WebGPU not available here. Try Chrome on Android 121+ or desktop Chrome/Edge.';
    for (const m of catalog.browser) {
      const ready = saved().includes(m.id), r = row(m.name, `${m.size} · ${m.note}`, ready ? 'Ready' : 'Download');
      r.btn.disabled = ready; r.btn.onclick = async () => { r.btn.disabled = true; r.btn.textContent = '...'; try { sel.add(new Option('📱 ' + m.name, 'web:' + m.id)); sel.value = 'web:' + m.id; await ensureEngineWithBar(m.id, r); r.btn.textContent = 'Ready'; } catch (e) { r.sub.textContent = 'Error: ' + e.message; r.btn.disabled = false; r.btn.textContent = 'Retry'; } };
    }
  } else {
    const h = server.hardware;
    $('#hw').textContent = `${h.ramGB} GB RAM${h.gpu ? ' · ' + h.gpu : ''}${server.ollama ? ' · Ollama detected' : ''}${server.llamaServer ? ' · llama.cpp found' : ''}`;
    if (!server.ollama && !server.llamaServer) {
      const r = row('Engine not installed', 'Needs llama.cpp (about 20-200 MB) to run models on this PC. Or install Ollama.', 'Install');
      r.btn.onclick = async () => {
        r.btn.disabled = true; r.btn.textContent = 'Installing...'; await fetch('api/install-llama', { method: 'POST' });
        const t = setInterval(async () => { const s = await (await fetch('api/install-llama/status')).json();
          if (s.status === 'done') { clearInterval(t); server = await (await fetch('api/hardware')).json(); render(); }
          if (s.status === 'error') { clearInterval(t); r.sub.textContent = 'Error: ' + s.error; r.btn.disabled = false; r.btn.textContent = 'Retry'; } }, 1500);
      };
    }
    for (const m of server.models) {
      const r = row(m.name, `${m.sizeGB} GB · ${m.fits ? 'fits your PC' : 'may be too big for your RAM'}`, m.downloaded ? 'Downloaded' : 'Download');
      r.btn.disabled = m.downloaded;
      r.btn.onclick = async () => { r.btn.disabled = true; await fetch('api/pull', { method: 'POST', body: JSON.stringify({ id: m.id }) }); poll(m, r); };
    }
  }
}
function row(title, sub, btn) {
  const d = document.createElement('div'); d.className = 'row';
  d.innerHTML = '<div class="sp"><b></b><small></small><div class="bar" style="display:none"><i></i></div></div><button></button>';
  d.querySelector('b').textContent = title; const s = d.querySelector('small'); s.textContent = sub;
  const b = d.querySelector('button'); b.textContent = btn; listEl.appendChild(d);
  return { btn: b, sub: s, bar: d.querySelector('.bar'), fill: d.querySelector('.bar i') };
}
async function ensureEngineWithBar(id, r) {
  r.bar.style.display = '';
  if (!navigator.gpu) throw new Error('No WebGPU in this browser');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: p => { r.fill.style.width = Math.round(p.progress * 100) + '%'; r.sub.textContent = p.text.slice(0, 70); } });
  engineModel = id; markReady(id);
}
async function poll(m, r) {
  r.bar.style.display = '';
  const t = setInterval(async () => {
    const s = (await (await fetch('api/pull/status')).json())[m.id]; if (!s) return;
    if (s.status === 'downloading') r.fill.style.width = s.total ? Math.round(s.done / s.total * 100) + '%' : '50%';
    if (s.status === 'done') { clearInterval(t); r.btn.textContent = 'Downloaded'; r.fill.style.width = '100%'; server = await (await fetch('api/hardware')).json(); refreshSelect(); }
    if (s.status === 'error') { clearInterval(t); r.sub.textContent = 'Error: ' + s.error; r.btn.disabled = false; r.btn.textContent = 'Retry'; }
  }, 1000);
}

$('#mgr').onclick = () => { render(); dlg.showModal(); };
$('#close').onclick = () => { dlg.close(); refreshSelect(); };
$('#tBrowser').onclick = () => { tab = 'browser'; render(); };
$('#tLocal').onclick = () => { tab = 'local'; render(); };
$('#send').onclick = send;
inEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); send(); } });
init();
