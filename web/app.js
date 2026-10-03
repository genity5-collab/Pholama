// Pholama UI. Two engines:
//  "browser": WebLLM (WebGPU) runs the model inside this tab, weights cached in browser storage. Works on phones.
//  "local":   talks to the Pholama server on your PC (llama.cpp / Ollama) using PC RAM/GPU.
const $ = s => document.querySelector(s);
const chatEl = $('#chat'), inEl = $('#in'), sel = $('#model'), dlg = $('#dlg'), listEl = $('#list');
let hasGPU = false;
async function probeGPU() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; } }
let catalog = null, server = null, tab = 'browser', engine = null, engineModel = null, history = [], busy = false;

const add = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; chatEl.appendChild(d); chatEl.scrollTop = 1e9; return d; };
const saved = () => JSON.parse(localStorage.getItem('pholama.ready') || '[]');
const markReady = id => { const s = new Set(saved()); s.add(id); localStorage.setItem('pholama.ready', JSON.stringify([...s])); };

async function init() {
  hasGPU = await probeGPU();
  catalog = await (await fetch('models.json')).json();
  try { const r = await fetch('api/hardware'); if (r.ok && (r.headers.get('content-type') || '').includes('json')) server = await r.json(); } catch {}
  tab = server ? 'local' : 'browser';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !server) navigator.serviceWorker.register('sw.js').catch(() => {}); navigator.serviceWorker.addEventListener('controllerchange', () => { if (!sessionStorage.getItem('swr')) { sessionStorage.setItem('swr', '1'); location.reload(); } });
  refreshSelect();
  add('sys', server ? 'Connected to your PC. Pick a model, or open Models to download one.' : 'Running in browser mode. Open Models to download a small model to this device.');
  if (!sel.options.length) dlg.showModal(), render();
}

async function refreshSelect() {
  sel.innerHTML = '';
  for (const id of saved()) {
    const m = catalog.browser.find(x => x.id === id); if (m) sel.add(new Option('📱 ' + m.name, 'web:' + id));
    const c = (catalog.cpu || []).find(x => 'cpu:' + x.id === id); if (c) sel.add(new Option('📱 ' + c.name, id));
  }
  if (server) try {
    const t = await (await fetch('api/tags')).json();
    for (const m of t.models) sel.add(new Option('💻 ' + m.name.replace(/^(gguf|ollama):/, ''), m.name));
  } catch {}
}

async function ensureEngine(value) {
  if (value.startsWith('cpu:')) return ensureCpu(value.slice(4));
  if (!value.startsWith('web:')) return;
  const id = value.slice(4);
  if (engine && engineModel === id) return;
  if (!hasGPU) throw new Error('No usable WebGPU in this browser. Open Models and pick a CPU model.');
  const note = add('sys', 'Loading model...');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: p => note.textContent = p.text });
  engineModel = id; note.textContent = 'Model ready.'; markReady(id);
}


// CPU/WASM fallback (transformers.js) for browsers without WebGPU
let cpuPipe = null, cpuModel = null;
async function ensureCpu(id, onProgress) {
  if (cpuPipe && cpuModel === id) return;
  const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
  cpuPipe = await tf.pipeline('text-generation', id, { dtype: 'q4', progress_callback: p => { if (onProgress && p.progress != null) onProgress(p); } }).catch(async () =>
    tf.pipeline('text-generation', id, { dtype: 'q8', progress_callback: p => { if (onProgress && p.progress != null) onProgress(p); } }));
  cpuModel = id; markReady('cpu:' + id);
}
async function cpuChat(messages, onToken) {
  const tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
  const streamer = new tf.TextStreamer(cpuPipe.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onToken });
  await cpuPipe(messages, { max_new_tokens: 512, do_sample: true, temperature: 0.7, streamer });
}

async function send() {
  const text = inEl.value.trim(); if (!text || busy || !sel.value) return;
  busy = true; $('#send').disabled = true; inEl.value = '';
  history.push({ role: 'user', content: text }); add('m u', text);
  const out = add('m a', '...'); let acc = '';
  try {
    await ensureEngine(sel.value);
    if (sel.value.startsWith('cpu:')) {
      await cpuChat(history, t => { acc += t; out.textContent = acc; chatEl.scrollTop = 1e9; });
    } else if (sel.value.startsWith('web:')) {
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
    $('#hw').textContent = hasGPU ? 'Models run inside this browser on your GPU and are cached after the first download.' : 'No WebGPU here, so small models run on the CPU (slower). Chrome on Android 121+ gives full speed.';
    const gpu = hasGPU;
    for (const m of (gpu ? catalog.browser : catalog.cpu || [])) {
      const key = gpu ? m.id : 'cpu:' + m.id, ready = saved().includes(key), r = row(m.name, `${m.size} · ${m.note}`, ready ? 'Ready' : 'Download');
      r.btn.disabled = ready;
      r.btn.onclick = async () => {
        r.btn.disabled = true; r.btn.textContent = '...'; r.bar.style.display = '';
        try {
          if (gpu) await ensureEngineWithBar(m.id, r);
          else await ensureCpu(m.id, p => { r.fill.style.width = Math.round(p.progress) + '%'; r.sub.textContent = (p.file || 'downloading').slice(-40); });
          r.btn.textContent = 'Ready'; await refreshSelect(); sel.value = gpu ? 'web:' + m.id : key; r.sub.textContent = 'Ready to chat. Close this window.';
        } catch (e) { r.sub.textContent = 'Error: ' + e.message.slice(0, 160); r.btn.disabled = false; r.btn.textContent = 'Retry'; }
      };
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
  if (!hasGPU) throw new Error('No usable WebGPU in this browser');
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
