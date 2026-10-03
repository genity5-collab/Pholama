// Pholama UI. Two engines:
//  "browser": WebLLM (WebGPU) runs the model inside this tab, weights cached in browser storage. Works on phones.
//  "local":   talks to the Pholama server on your PC (llama.cpp / Ollama) using PC RAM/GPU.
const $ = s => document.querySelector(s);
const chatEl = $('#chat'), inEl = $('#in'), sel = $('#model'), dlg = $('#dlg'), listEl = $('#list');
let hasGPU = false;
let hasF16 = false;
async function probeGPU() { try { const a = navigator.gpu && await navigator.gpu.requestAdapter(); hasF16 = !!(a && a.features && a.features.has('shader-f16')); return !!a; } catch { return false; } }
const deviceRam = () => navigator.deviceMemory || 0; // Chrome reports 0.25-8 (rounded). 0 = unknown.
let catalog = null, server = null, tab = 'browser', engine = null, engineModel = null, history = [], busy = false;

// One AI message = live log (actions/steps) + live thinking + answer. Everything updates while it streams.
function makeMsg() {
  const el = document.createElement('div'); el.className = 'm a';
  const live = document.createElement('details'); live.className = 'live'; live.open = true; live.style.display = 'none';
  live.innerHTML = '<summary><span class="dot"></span><span class="sum">Working...</span></summary><div class="lines"></div>';
  const think = document.createElement('div'); think.className = 'think'; think.style.display = 'none'; think.innerHTML = '<b>Thinking</b><span></span>';
  const ans = document.createElement('div'); ans.className = 'ans';
  el.append(live, think, ans); chatEl.appendChild(el); chatEl.scrollTop = 1e9;
  const lines = live.querySelector('.lines'), sum = live.querySelector('.sum'); let n = 0;
  return {
    el,
    log(kind, text, t) {
      live.style.display = ''; n++;
      const d = document.createElement('div'); d.className = kind;
      d.innerHTML = '<span class="t"></span><span class="x"></span>'; d.querySelector('.t').textContent = t != null ? t.toFixed(1) + 's' : '';
      d.querySelector('.x').textContent = (kind === 'action' ? '> ' : kind === 'result' ? '= ' : kind === 'error' ? '! ' : '') + text;
      lines.appendChild(d); lines.scrollTop = 1e9; sum.textContent = text.slice(0, 70); chatEl.scrollTop = 1e9;
      if (kind === 'error') live.classList.add('err');
    },
    text(raw) {           // raw model text: split <think> from the answer, live
      const m = /<think>([\s\S]*?)(<\/think>|$)/.exec(raw);
      if (m) { think.style.display = ''; think.querySelector('span').textContent = m[1].trim(); think.scrollTop = 1e9; }
      ans.textContent = m ? raw.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim() : raw;
      if (m && m[2]) think.querySelector('b').textContent = 'Thought process';
      chatEl.scrollTop = 1e9;
    },
    finish(ok = true) { live.classList.add(ok ? 'done' : 'err'); if (ok) { live.open = false; sum.textContent = `${n} step${n === 1 ? '' : 's'} (tap to see what happened)`; } },
    fail(msg) { ans.textContent = 'Error: ' + msg; this.finish(false); },
  };
}
const add = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; chatEl.appendChild(d); chatEl.scrollTop = 1e9; return d; };
const saved = () => JSON.parse(localStorage.getItem('pholama.ready') || '[]');
const markReady = id => { const s = new Set(saved()); s.add(id); localStorage.setItem('pholama.ready', JSON.stringify([...s])); };

async function init() {
  hasGPU = await probeGPU();
  catalog = await (await fetch('models.json')).json();
  try { const r = await fetch('api/hardware'); if (r.ok && (r.headers.get('content-type') || '').includes('json')) server = await r.json(); } catch {}
  tab = server ? 'local' : 'browser';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !server) navigator.serviceWorker.register('sw.js').catch(() => {});
  await refreshSelect();
  add('sys', server ? 'Connected to your PC. Pick a model, or open Models to download one.' : 'Running in browser mode. Open Models to download a small model to this device.');
  if (![...sel.options].some(o => !o.disabled)) dlg.showModal(), render();
}

async function refreshSelect() {
  sel.innerHTML = '';
  for (const id of saved()) {
    const m = catalog.browser.find(x => x.id === id || x.fallback === id); if (m) sel.add(new Option('📱 ' + m.name, 'web:' + id));
    const c = (catalog.cpu || []).find(x => 'cpu:' + x.id === id); if (c) sel.add(new Option('📱 ' + c.name, id));
  }
  if (server) try {
    const t = await (await fetch('api/tags')).json();
    for (const m of t.models) sel.add(new Option('💻 ' + m.name.replace(/^(gguf|ollama):/, ''), m.name));
  } catch {}
  const cl = new Option('☁ Cloud models (coming soon)', ''); cl.disabled = true; sel.add(cl);
  const first = [...sel.options].findIndex(o => !o.disabled); if (first >= 0) sel.selectedIndex = first;
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
  await cpuPipe(messages, { max_new_tokens: /Qwen3/i.test(cpuModel || '') ? 1024 : 512, do_sample: true, temperature: 0.7, streamer });
}


// ----- credits, tools, MCP (PC host only) -----
let cred = null;
async function refreshCredits() {
  if (!server) { $('#cr').style.display = 'none'; $('#opt').style.display = 'none'; return; }
  try { cred = await (await fetch('api/credits')).json(); } catch { return; }
  const c = $('#cr'); c.style.display = ''; c.textContent = cred.left + ' / ' + cred.daily + ' credits';
  c.className = 'pill' + (cred.left === 0 ? ' zero' : cred.left < cred.daily * 0.2 ? ' low' : '');
  c.title = cred.left === 0 ? 'Out of credits: search, tools, MCP and thinking are off until tomorrow' : 'Resets daily';
}
async function openOpts() {
  const off = !server; $('#t_off').style.display = off ? '' : 'none'; $('#t_body').style.display = off ? 'none' : '';
  if (!off) {
    await refreshCredits();
    $('#t_cr').textContent = cred.left === 0 ? 'Out of credits. Search, tools, MCP and thinking are off until tomorrow. Plain chat still works.' : `${cred.left} of ${cred.daily} credits left today. Resets at midnight.`;
    const pr = cred.allowed.prefs; for (const k of ['search', 'tools', 'mcp', 'thinking']) $('#p_' + k).checked = !!pr[k];
    await listMcpUI();
  }
  $('#dlg2').showModal();
}
async function listMcpUI() {
  const box = $('#mcpList'); box.innerHTML = '';
  let r; try { r = await (await fetch('api/mcp')).json(); } catch { return; }
  if (!r.servers.length) { box.innerHTML = '<div class="sys" style="text-align:left">No MCP servers yet.</div>'; return; }
  for (const sv of r.servers) {
    const tools = r.tools.filter(t => t.server === sv.name), err = tools.find(t => t.error);
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = '<div class="sp"><b></b><small></small></div><button>Remove</button>';
    d.querySelector('b').textContent = sv.name;
    d.querySelector('small').textContent = err ? 'Error: ' + err.error : tools.length + ' tools: ' + tools.map(t => t.name).join(', ').slice(0, 120);
    d.querySelector('button').onclick = async () => { await fetch('api/mcp?name=' + encodeURIComponent(sv.name), { method: 'DELETE' }); listMcpUI(); };
    box.appendChild(d);
  }
}
for (const k of ['search', 'tools', 'mcp', 'thinking']) $('#p_' + k).onchange = e => fetch('api/prefs', { method: 'POST', body: JSON.stringify({ [k]: e.target.checked }) });
$('#mAdd').onclick = async () => {
  const name = $('#mName').value.trim(), url = $('#mUrl').value.trim(), auth = $('#mAuth').value.trim();
  $('#mMsg').textContent = '';
  try {
    const r = await fetch('api/mcp', { method: 'POST', body: JSON.stringify({ name, url, headers: auth ? { Authorization: auth } : {} }) });
    if (!r.ok) throw new Error((await r.json()).error || 'failed');
    $('#mName').value = $('#mUrl').value = $('#mAuth').value = ''; await listMcpUI();
  } catch (e) { $('#mMsg').textContent = e.message; }
};
$('#opt').onclick = openOpts; $('#close2').onclick = () => $('#dlg2').close();

async function send() {
  const text = inEl.value.trim(); if (!text || busy || !sel.value) { if (!sel.value) add('sys', 'Pick a model first (open Models to download one).'); return; }
  busy = true; $('#send').disabled = true; inEl.value = '';
  history.push({ role: 'user', content: text }); add('m u', text);
  const msg = makeMsg(); let acc = '';
  try {
    if (!sel.value.startsWith('ollama:') && !sel.value.startsWith('gguf:')) msg.log('step', 'Loading the model on this device...', 0);
    await ensureEngine(sel.value);
    if (sel.value.startsWith('cpu:')) {
      msg.log('step', 'Running on your phone CPU. This can be slow.', 0);
      await cpuChat(history, t => { acc += t; msg.text(acc); });
    } else if (sel.value.startsWith('web:')) {
      msg.log('step', 'Running on your phone GPU.', 0);
      const s = await engine.chat.completions.create({ messages: history, stream: true });
      for await (const c of s) { acc += c.choices[0]?.delta?.content || ''; msg.text(acc); }
    } else {
      const r = await fetch('api/chat', { method: 'POST', body: JSON.stringify({ model: sel.value, messages: history, agent: true }) });
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
          const j = JSON.parse(l); if (j.error) throw new Error(j.error);
          if (j.log) { msg.log(j.log.kind, j.log.text, j.log.t); continue; }
          if (j.status) { msg.log('step', j.status); continue; }
          if (j.tool) continue;
          if (j.credits) { refreshCredits(); continue; }
          acc += j.message?.content || ''; msg.text(acc);
        }
      }
    }
    history.push({ role: 'assistant', content: acc.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim() });
    msg.finish(true);
  } catch (e) { msg.fail(e.message); history.pop(); }
  busy = false; $('#send').disabled = false; inEl.focus();
}

// ----- model manager -----
function render() {
  $('#tLocal').style.display = server ? '' : 'none';
  $('#tBrowser').classList.toggle('on', tab === 'browser'); $('#tLocal').classList.toggle('on', tab === 'local');
  listEl.innerHTML = '';
  if (tab === 'browser') {
    const ram = deviceRam(), gpu = hasGPU;
    $('#hw').textContent = gpu
      ? `GPU found${hasF16 ? ' (fast mode)' : ' (compatibility mode)'}${ram ? ' · about ' + ram + '+ GB RAM' : ''}. Models run on this device and stay cached after the first download.`
      : 'No usable WebGPU here, so only small CPU models run (slower). Chrome on Android 121+ gives full speed.';
    const list = gpu ? catalog.browser : (catalog.cpu || []);
    const maxTier = !ram ? 2 : ram >= 8 ? 4 : ram >= 6 ? 3 : ram >= 4 ? 2 : 1; // unknown RAM: assume a typical phone
    let lastTier = 0;
    for (const m of [...list].sort((a, b) => a.tier - b.tier)) {
      if (m.tier !== lastTier) { lastTier = m.tier; const h = document.createElement('h4'); h.textContent = catalog.tiers[m.tier]; h.style.cssText = 'margin:12px 0 2px;font-size:13px;color:#aab1c3'; listEl.appendChild(h); }
      // pick the id to use on this device: f32 fallback when f16 is missing
      let useId = m.id, blocked = '';
      if (gpu && m.needsF16 && !hasF16) { if (m.fallback) useId = m.fallback; else blocked = 'Needs a GPU feature this phone lacks'; }
      const key = gpu ? useId : 'cpu:' + m.id, ready = saved().includes(key);
      const fits = m.tier <= maxTier, caps = (m.caps || []).map(c => catalog.capLabels[c] || c);
      const r = row(m.name, `${m.size} · ${m.note}`, blocked ? 'Not supported' : ready ? 'Ready' : 'Download');
      const chips = document.createElement('div'); chips.style.cssText = 'margin-top:4px;display:flex;flex-wrap:wrap;gap:4px';
      for (const c of [...caps, fits ? 'Fits your phone' : 'May be too big']) { const ch = document.createElement('span'); ch.textContent = c; ch.style.cssText = 'font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid #2a2f3a;color:' + (c === 'Fits your phone' ? '#7fd3a1' : c === 'May be too big' ? '#d9a441' : '#aab1c3'); chips.appendChild(ch); }
      r.sub.parentNode.insertBefore(chips, r.bar);
      r.btn.disabled = ready || !!blocked;
      if (blocked) r.sub.textContent = blocked;
      r.btn.onclick = async () => {
        r.btn.disabled = true; r.btn.textContent = '...'; r.bar.style.display = '';
        try {
          if (gpu) await ensureEngineWithBar(useId, r);
          else await ensureCpu(m.id, p => { r.fill.style.width = Math.round(p.progress) + '%'; r.sub.textContent = (p.file || 'downloading').slice(-40); });
          r.btn.textContent = 'Ready'; await refreshSelect(); sel.value = gpu ? 'web:' + useId : key; r.sub.textContent = 'Ready to chat. Close this window.';
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
      const r = row(m.name, `${m.sizeGB} GB · ${m.fits ? 'fits your PC' : 'may be too big for your RAM'} · ${(m.caps || []).map(c => catalog.capLabels[c] || c).join(', ')}`, m.downloaded ? 'Downloaded' : 'Download');
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
init().then(refreshCredits);
