// Pholama Studio (browser side). Editor + live preview + console + AI, all talking to the local PC server.
// Anti-lag rules: typing is debounced, the preview only reloads when something changed, the console is capped,
// and the preview runs in a sandboxed iframe that cannot reach Pholama's storage, keys or account.
import { sourcesCard } from './sources.js';
import { createFx, toolStatus } from './studiofx.js';

export const PREVIEW_DELAY = 300, SAVE_DELAY = 600, MAX_CONSOLE = 200, MAX_LINE = 400;

// Build one self-contained HTML page from the project's files: inlines style.css / script.js so the iframe needs no server.
// Also injects a tiny reporter that sends console output and errors to the parent page.
export function buildPreview(files, entry = 'index.html') {
  const by = new Map(files.map(f => [f.name, f.content]));
  let html = by.get(entry);
  if (html == null) {
    const any = files.find(f => /\.html?$/i.test(f.name));
    if (!any) return wrap('<body style="font:15px system-ui;padding:2rem;color:#888">Nothing to show yet. Ask the AI to build something, or add an index.html file.</body>');
    html = any.content;
  }
  const esc = s => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  html = html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (m, h) => /stylesheet/i.test(m) && by.has(clean(h)) ? `<style>${String(by.get(clean(h))).replace(/<\/style/gi, '<\\/style')}</style>` : m);
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, s, b) => by.has(clean(s)) ? `<script${((a + b).replace(/\btype=["']module["']/i, '').trim() ? ' ' + (a + b).replace(/\btype=["']module["']/i, '').trim() : '')}>${esc(by.get(clean(s)))}</script>` : m);
  return wrap(html);
}
const clean = p => String(p).replace(/^\.?\//, '').split(/[?#]/)[0];
const REPORTER = `<script>(function(){var n=0,max=${MAX_CONSOLE};function s(k,a){if(n++>max)return;try{parent.postMessage({pholamaStudio:1,kind:k,text:Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ').slice(0,${MAX_LINE})},'*')}catch(e){}}
['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){s(k,arguments);try{o.apply(console,arguments)}catch(e){}}});
window.addEventListener('error',function(e){s('error',[e.message+(e.lineno?' (line '+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){s('error',['Unhandled: '+(e.reason&&e.reason.message||e.reason)])});})();<\/script>`;
function wrap(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + REPORTER);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + '<head>' + REPORTER + '</head>');
  return REPORTER + html;
}

// Calls fn at most once after `ms` of quiet. Used for typing so a fast typist never triggers a reload per key.
export function debounce(fn, ms) { let t = null; const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); }; d.flush = (...a) => { clearTimeout(t); t = null; fn(...a); }; d.cancel = () => clearTimeout(t); return d; }

// Decides what the editor should do when the server reports a file changed while the user may be typing.
// dirty = the user has unsaved edits in that file. The user's own typing is never overwritten silently.
export function mergeIncoming(local, server, dirtyNames) {
  const out = new Map(local.map(f => [f.name, f])), conflicts = [];
  for (const s of server) {
    const cur = out.get(s.name);
    if (cur && dirtyNames.has(s.name) && cur.content !== s.content) { conflicts.push(s.name); continue; }
    out.set(s.name, { name: s.name, size: s.size, content: s.content });
  }
  for (const n of [...out.keys()]) if (!server.some(s => s.name === n) && !dirtyNames.has(n)) out.delete(n);
  return { files: [...out.values()].sort((a, b) => (a.name === 'index.html' ? -1 : b.name === 'index.html' ? 1 : a.name.localeCompare(b.name))), conflicts };
}

export function createStudio(env) {
  const { api, $, ghHeaders, getModel, mount } = env;
  const S = { project: null, files: [], current: null, dirty: new Set(), log: [], activity: [], busy: false, stopper: null, timers: {}, companion: false };
  const el = {};

  mount.innerHTML = `
  <div class="st-bar">
    <select id="stProj" title="Project"></select>
    <button id="stNew">New</button><button id="stDel" title="Delete this project">Delete</button><button id="stRefresh" title="Pull the latest files from the local Pholama server">Refresh files</button><button id="stActivity" title="Show AI edits, checks and commands">Activity</button><button id="stSettings" title="Studio settings">Settings</button>
    <span class="sp"></span>
    <button id="stPublish" class="p" title="Put this project on GitHub">Publish</button>
  </div>
  <div id="stActivityPanel" class="st-activity" hidden><div class="st-panelhead"><b>Activity</b><span class="sp"></span><button id="stActivityRefresh">Refresh</button></div><div id="stActivityList" class="st-activitylist">Loading...</div></div>
  <div id="stSettingsPanel" class="st-settings" hidden><div class="st-panelhead"><b>Studio settings</b><span class="sp"></span><button id="stSettingsClose">Close</button></div><label class="st-setting"><input id="stCompanion" type="checkbox"><span><b>Pholama companion</b><small>A tiny local llama follows your cursor. Click it to pet it. It never reads the page or sends anything.</small></span></label><div class="sys">The companion is off by default and can be turned off at any time.</div></div>
  <div class="st-main">
    <div class="st-left">
      <div class="st-tabs" id="stTabs"></div>
      <textarea id="stCode" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Code editor"></textarea>
      <div class="st-foot"><span id="stStat">Saved</span><button id="stAddFile">+ File</button><button id="stRm">Remove file</button></div>
    </div>
    <div class="st-right">
      <div class="st-prevhead"><b>Preview</b><span class="sp"></span><button id="stReload" title="Reload preview">Reload</button></div>
      <iframe id="stFrame" sandbox="allow-scripts allow-forms allow-modals" title="Preview"></iframe>
      <div class="st-conhead"><b>Output</b><span class="sp"></span><button id="stClear">Clear</button></div>
      <div id="stCon" class="st-con" aria-live="polite"></div>
    </div>
  </div>
  <div class="st-ai">
    <div id="stAiLog" class="st-ailog"></div>
    <div class="st-aibox"><textarea id="stAsk" rows="2" placeholder="Ask the AI to build, fix or explain anything..."></textarea><button id="stDiagnose" title="Check the project and explain the next fix">Diagnose</button><button id="stSend" class="p">Send</button></div>
  </div>`;
  for (const id of ['stProj', 'stNew', 'stDel', 'stRefresh', 'stActivity', 'stSettings', 'stActivityPanel', 'stActivityRefresh', 'stActivityList', 'stSettingsPanel', 'stSettingsClose', 'stCompanion', 'stPublish', 'stTabs', 'stCode', 'stStat', 'stAddFile', 'stRm', 'stFrame', 'stReload', 'stCon', 'stClear', 'stAiLog', 'stAsk', 'stDiagnose', 'stSend']) el[id] = mount.querySelector('#' + id);
  const fx = createFx({ host: el.stCode.parentElement, code: el.stCode, tabs: el.stTabs, frame: el.stFrame });   // the 'AI is editing' animation
  const activityTitle = e => e.kind === 'file' ? ((e.status === 'working' ? 'Working on ' : e.status === 'failed' ? 'Failed: ' : 'Changed ') + (e.path || 'a file')) : e.kind === 'command' ? (e.status === 'ok' ? 'Command finished' : e.status === 'proposed' ? 'Command waiting for approval' : 'Command ' + (e.status || 'updated')) : (e.text || e.status || e.kind || 'Activity');
  const paintActivity = () => { const box = el.stActivityList; if (!box) return; box.textContent = ''; if (!S.activity.length) { box.textContent = 'No Studio activity yet.'; return; } for (const e of S.activity.slice(0, 80)) { const d = document.createElement('details'); d.className = 'st-activityrow ' + (e.status === 'failed' || e.status === 'error' ? 'bad' : e.status === 'working' || e.status === 'proposed' ? 'wait' : 'good'); const s = document.createElement('summary'); const time = e.t ? new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; s.textContent = (e.status || 'event') + ' · ' + activityTitle(e) + (time ? ' · ' + time : ''); d.appendChild(s); const body = document.createElement('div'); body.className = 'st-activitybody'; const bits = []; if (e.project) bits.push('Project: ' + e.project); if (e.added != null || e.removed != null) bits.push('Lines: +' + (e.added || 0) + ' / -' + (e.removed || 0)); if (e.error) bits.push('Error: ' + e.error); if (e.cmd) bits.push(e.cmd); body.textContent = bits.join('\n') || 'No additional details.'; d.appendChild(body); box.appendChild(d); } };
  const loadActivity = async () => { try { const j = await jget('api/editlog?n=160'); S.activity = j.entries || []; paintActivity(); } catch (e) { if (el.stActivityList) el.stActivityList.textContent = 'Activity is unavailable: ' + e.message; } };
  const openPanel = (panel, other) => { panel.hidden = !panel.hidden; if (!panel.hidden && other) other.hidden = true; };
  el.stActivity.onclick = () => { openPanel(el.stActivityPanel, el.stSettingsPanel); if (!el.stActivityPanel.hidden) loadActivity(); };
  el.stActivityRefresh.onclick = loadActivity;
  el.stSettings.onclick = () => openPanel(el.stSettingsPanel, el.stActivityPanel);
  el.stSettingsClose.onclick = () => { el.stSettingsPanel.hidden = true; };
  const companionKey = 'pholama_studio_companion';
  const companionOn = () => { try { return localStorage.getItem(companionKey) === 'on'; } catch { return false; } };
  let petCount = 0, companionEl = null, companionTarget = { x: window.innerWidth - 80, y: window.innerHeight - 130 }, companionPos = { x: companionTarget.x, y: companionTarget.y };
  const makeCompanion = () => { if (companionEl || !S.companion) return; companionEl = document.createElement('button'); companionEl.className = 'st-companion'; companionEl.type = 'button'; companionEl.title = 'Pet Pholama'; companionEl.innerHTML = '<img src="icon.svg" alt="Pholama companion"><span>pet</span>'; companionEl.onclick = () => { petCount++; companionEl.classList.remove('pet'); void companionEl.offsetWidth; companionEl.classList.add('pet'); companionEl.title = 'Pholama liked that (' + petCount + ')'; }; document.body.appendChild(companionEl); };
  const removeCompanion = () => { if (companionEl) { companionEl.remove(); companionEl = null; } };
  const companionFrame = () => { if (companionEl) companionEl.style.display = S.companion && document.body.classList.contains('studio-on') ? '' : 'none'; if (companionEl && S.companion && document.body.classList.contains('studio-on')) { companionPos.x += (companionTarget.x - companionPos.x) * .12; companionPos.y += (companionTarget.y - companionPos.y) * .12; companionEl.style.transform = `translate3d(${companionPos.x}px,${companionPos.y}px,0)`; } requestAnimationFrame(companionFrame); };
  document.addEventListener('pointermove', e => { companionTarget.x = Math.min(window.innerWidth - 68, Math.max(8, e.clientX + 18)); companionTarget.y = Math.min(window.innerHeight - 76, Math.max(8, e.clientY + 18)); }, { passive: true });
  S.companion = companionOn(); el.stCompanion.checked = S.companion; el.stCompanion.onchange = () => { S.companion = el.stCompanion.checked; try { localStorage.setItem(companionKey, S.companion ? 'on' : 'off'); } catch {} if (S.companion) makeCompanion(); else removeCompanion(); };
  if (S.companion) makeCompanion(); companionFrame();
  let fxOpen = 0, fxShow = false;   // fxShow stays true through the last refresh after a run, so the final change still flashes

  const say = (txt, cls = '') => { const d = document.createElement('div'); d.className = 'st-msg ' + cls; d.textContent = txt; el.stAiLog.appendChild(d); while (el.stAiLog.childElementCount > 150) el.stAiLog.firstChild.remove(); el.stAiLog.scrollTop = 1e9; return d; };
  const con = (kind, text) => { if (S.log.length >= MAX_CONSOLE) { if (S.log.length === MAX_CONSOLE) { S.log.push({ kind: 'warn', text: 'Too much output. Further lines are hidden. Press Clear.' }); paintConLine(S.log[S.log.length - 1]); } return; } S.log.push({ kind, text }); paintConLine({ kind, text }); };
  const paintConLine = l => { const d = document.createElement('div'); d.className = 'st-l ' + l.kind; d.textContent = l.text; el.stCon.appendChild(d); el.stCon.scrollTop = 1e9; };
  const stat = t => { el.stStat.textContent = t; };
  // An out-of-date PC server has no Studio routes and answers with a web page instead of JSON. Say so plainly instead of showing a raw parse error.
  const STALE = 'Your Pholama server on the PC is still the old version. Close Pholama completely (the black window too), then open it again so it loads the new Studio.';
  const jget = async p => { const r = await api(p); const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(r.status === 404 || /^\s*</.test(t) || !t.trim() ? STALE : 'The server sent something unexpected: ' + t.slice(0, 80)); } };
  const jsend = async (p, method, body) => { const r = await api(p, { method, body: JSON.stringify(body || {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error(r.status === 404 || /^\s*</.test(t) ? STALE : 'The server sent something unexpected.'); } if (j.error) throw new Error(j.error); return j; };

  async function loadProjects(pick) {
    const { projects } = await jget('api/studio/projects');
    el.stProj.textContent = '';
    for (const p of projects) { const o = document.createElement('option'); o.value = p.name; o.textContent = p.name; el.stProj.appendChild(o); }
    if (!projects.length) { S.project = null; S.files = []; paintAll(); return; }
    const want = pick && projects.some(p => p.name === pick) ? pick : (S.project && projects.some(p => p.name === S.project) ? S.project : projects[0].name);
    el.stProj.value = want; await openProject(want);
  }
  async function openProject(name) {
    S.project = name; S.dirty.clear(); S.current = null;
    const j = await jget('api/studio/projects/' + encodeURIComponent(name)); S.files = j.files;
    S.current = (S.files.find(f => f.name === 'index.html') || S.files[0] || {}).name || null; paintAll(); try { localStorage.setItem('pholama_studio_proj', name); } catch {}
  }
  function paintAll() { paintTabs(); paintEditor(); renderPreview(true); }
  function paintTabs() {
    el.stTabs.textContent = '';
    for (const f of S.files) { const b = document.createElement('button'); b.className = 'st-tab' + (f.name === S.current ? ' on' : ''); b.textContent = f.name + (S.dirty.has(f.name) ? ' \u2022' : ''); b.onclick = () => { S.current = f.name; paintTabs(); paintEditor(); }; el.stTabs.appendChild(b); }
  }
  function paintEditor() {
    const f = S.files.find(x => x.name === S.current);
    el.stCode.disabled = !f; el.stCode.value = f ? f.content : ''; el.stCode.placeholder = S.project ? 'Pick or add a file.' : 'Make a project first with "New".';
    el.stRm.disabled = !f; el.stAddFile.disabled = !S.project;
  }

  // ---- preview (debounced; identical content never reloads) ----
  let lastHtml = '';
  function renderPreview(force) {
    const html = buildPreview(S.files); if (!force && html === lastHtml) return; lastHtml = html;
    el.stFrame.srcdoc = html;
  }
  const previewSoon = debounce(() => renderPreview(false), PREVIEW_DELAY);
  window.addEventListener('message', e => { if (e.source !== el.stFrame.contentWindow) return; const d = e.data; if (d && d.pholamaStudio === 1 && typeof d.text === 'string') con(['log', 'info', 'warn', 'error'].includes(d.kind) ? d.kind : 'log', d.text); });

  // ---- saving (debounced, one file at a time, never loses the latest keystroke) ----
  const save = debounce(async () => {
    const name = S.current, f = S.files.find(x => x.name === name); if (!f || !S.project || !S.dirty.has(name)) return;
    const sent = f.content; stat('Saving...');
    try { await jsend('api/studio/projects/' + encodeURIComponent(S.project) + '/file', 'PUT', { file: name, content: sent }); if (f.content === sent) S.dirty.delete(name); stat(S.dirty.size ? 'Unsaved' : 'Saved'); paintTabs(); }
    catch (e) { stat('Not saved: ' + e.message); }
  }, SAVE_DELAY);
  el.stCode.addEventListener('input', () => { const f = S.files.find(x => x.name === S.current); if (!f) return; f.content = el.stCode.value; f.size = f.content.length; S.dirty.add(f.name); stat('Unsaved'); previewSoon(); save(); });
  el.stCode.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = el.stCode, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save.flush(); } });

  // ---- pulling the AI's changes into the editor live, without clobbering what the user is typing ----
  async function refreshFromServer() {
    if (!S.project) return;
    try {
      const j = await jget('api/studio/projects/' + encodeURIComponent(S.project));
      const typing = document.activeElement === el.stCode, keep = S.current, pos = typing ? [el.stCode.selectionStart, el.stCode.selectionEnd] : null;
      const m = mergeIncoming(S.files, j.files, S.dirty); S.files = m.files;
      if (!S.files.some(f => f.name === S.current)) S.current = (S.files.find(f => f.name === 'index.html') || S.files[0] || {}).name || null;
      paintTabs(); fx.restoreTabs(); const f = S.files.find(x => x.name === S.current);
      if (f && el.stCode.value !== f.content && !S.dirty.has(f.name)) { const before = el.stCode.value, fresh = keep === S.current && !typing; el.stCode.value = f.content; if (fresh && (S.busy || fxShow)) { fx.landed(before, f.content); fx.pulseTab(f.name); } if (pos && keep === S.current) el.stCode.setSelectionRange(Math.min(pos[0], f.content.length), Math.min(pos[1], f.content.length)); }
      renderPreview(false); if (S.busy || fxShow) fx.pulsePreview();
      if (m.conflicts.length) say('The AI also changed ' + m.conflicts.join(', ') + ' but you have unsaved edits there, so your version was kept.', 'warn');
    } catch (e) { say('Could not refresh: ' + e.message, 'err'); }
  }
  const refreshSoon = debounce(refreshFromServer, 150);

  // ---- project actions ----
  el.stProj.onchange = () => openProject(el.stProj.value).catch(e => say(e.message, 'err'));
  el.stRefresh.onclick = async () => { el.stRefresh.disabled = true; stat('Refreshing...'); try { await refreshFromServer(); stat(S.dirty.size ? 'Unsaved' : 'Saved'); say('Pulled the latest files from the local Pholama server.', 'act'); } finally { el.stRefresh.disabled = false; } };
  el.stNew.onclick = async () => { const n = (prompt('Name of the new project (letters, numbers, dashes):') || '').trim(); if (!n) return; try { const r = await jsend('api/studio/projects', 'POST', { name: n }); await loadProjects(r.name); } catch (e) { say(e.message, 'err'); } };
  el.stDel.onclick = async () => { if (!S.project || !confirm('Delete the project "' + S.project + '" and all its files from this PC? This cannot be undone.')) return; try { await jsend('api/studio/projects/' + encodeURIComponent(S.project), 'DELETE'); S.project = null; await loadProjects(); } catch (e) { say(e.message, 'err'); } };
  el.stAddFile.onclick = async () => { const n = (prompt('File name (for example page2.html, extra.js):') || '').trim(); if (!n || !S.project) return; try { await jsend('api/studio/projects/' + encodeURIComponent(S.project) + '/file', 'PUT', { file: n, content: '' }); await refreshFromServer(); S.current = n.replace(/^\/+/, ''); paintTabs(); paintEditor(); } catch (e) { say(e.message, 'err'); } };
  el.stRm.onclick = async () => { const n = S.current; if (!n || !confirm('Remove ' + n + '?')) return; try { await jsend('api/studio/projects/' + encodeURIComponent(S.project) + '/file', 'DELETE', { file: n }); S.dirty.delete(n); await refreshFromServer(); } catch (e) { say(e.message, 'err'); } };
  el.stReload.onclick = () => { S.log.length = 0; el.stCon.textContent = ''; renderPreview(true); };
  el.stClear.onclick = () => { S.log.length = 0; el.stCon.textContent = ''; };

  // ---- AI ----
  const hist = [];
  async function ask(text) {
    if (!text.trim() || S.busy) return;
    if (!S.project) { say('Make a project first: press New.', 'err'); return; }
    save.flush(); await new Promise(r => setTimeout(r, 60));   // make sure the AI sees what the user just typed
    const model = getModel(); if (!model) { say('Pick a model at the top first.', 'err'); return; }
    const previewErrors = S.log.filter(x => x.kind === 'error' || x.kind === 'warn').slice(-8).map(x => x.kind.toUpperCase() + ': ' + x.text).join('\n');
    const modelText = previewErrors ? text + '\n\n[Preview diagnostics from the running app]\n' + previewErrors + '\n[/Preview diagnostics]' : text;
    if (model === 'cloud:pholama' && !S.maxWarned) { S.maxWarned = true; say('Agent Max in Studio costs more: about 23 credits a message, plus up to 8 Max messages from your daily and monthly allowance. If Max runs out, your own model on this PC takes over for free.', 'warn'); }
    S.busy = true; el.stSend.textContent = 'Stop'; say(text, 'me'); hist.push({ role: 'user', content: modelText }); if (hist.length > 8) hist.splice(0, hist.length - 8);
    const ac = new AbortController(); S.stopper = () => ac.abort(); let reply = '', node = null, srcCard = null, thinkNode = null;
    try {
      const r = await api('api/chat', { method: 'POST', signal: ac.signal, headers: ghHeaders(), body: JSON.stringify({ model, messages: hist, agent: true, stream: true, studio: { project: S.project }, switches: { search: true, tools: true } }) });
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.log && j.log.kind === 'thought') { if (!thinkNode) thinkNode = say(j.log.text, 'think'); else thinkNode.textContent = j.log.text; }   // live: one line that updates while the model thinks
          else if (j.log && (j.log.kind === 'action' || j.log.kind === 'error')) { thinkNode = null; say(j.log.text, j.log.kind === 'error' ? 'err' : 'act'); }
          else if (j.toolStart) { fxOpen++; fx.working(toolStatus(j.toolStart)); }   // the AI just started a tool: light up the editor and name the file
          else if (j.tool) { thinkNode = null; say(toolLine(j.tool), 'tool'); if (fxOpen > 0) { fxOpen--; fx.idle(); } loadActivity(); }   // it finished: the strip fades, the changed lines flash when they arrive
          else if (j.sources) { if (!srcCard) { srcCard = sourcesCard([]); el.stAiLog.appendChild(srcCard.el); } srcCard.update(j.sources); el.stAiLog.scrollTop = 1e9; }
          else if (j.studio) refreshSoon();
          else if (j.approve) approve(j.approve);
          else if (j.message && j.message.content) { reply += j.message.content; if (!node) node = say('', 'ai'); node.textContent = reply; el.stAiLog.scrollTop = 1e9; }
        }
      }
      // Keep only the plain answer in the memory of this chat: the model's own <think> notes and chit-chat make a small model repeat itself.
      const kept = reply.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<\/?think>/g, '').trim();
      if (kept) hist.push({ role: 'assistant', content: kept.slice(0, 1200) }); else hist.pop();
    } catch (e) { if (e.name !== 'AbortError') say(e.message || 'Something went wrong.', 'err'); else say('Stopped.', 'warn'); }
    finally { while (fxOpen > 0) { fxOpen--; fx.idle(); } S.busy = false; S.stopper = null; el.stSend.textContent = 'Send'; fxShow = true; try { await refreshFromServer(); } finally { fxShow = false; } }
  }
  const toolLine = t => { const a = t.args || {}; const f = a.file ? ' ' + a.file : ''; return (t.name || 'tool').replace(/^studio_/, '').replace(/_/g, ' ') + f + (t.result ? ': ' + String(t.result).split('\n')[0].slice(0, 100) : ''); };
  el.stDiagnose.onclick = () => { if (!S.busy) ask('Diagnose the current project, inspect the preview problems, and tell me the most useful next fix.'); };
  el.stSend.onclick = () => { if (S.busy) { if (S.stopper) S.stopper(); } else { const t = el.stAsk.value; el.stAsk.value = ''; ask(t); } };
  el.stAsk.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.stSend.onclick(); } });

  // ---- publish: every GitHub write waits for an explicit Allow click ----
  function approve(a) {
    const box = document.createElement('div'); box.className = 'st-msg appr';
    const t = document.createElement('div'); t.textContent = 'Allow this on GitHub? ' + a.summary;
    const ok = document.createElement('button'), no = document.createElement('button'); ok.textContent = 'Allow'; ok.className = 'p'; no.textContent = 'Deny';
    const go = async yes => { ok.disabled = no.disabled = true; try { const r = await jsend('api/github/approve', 'POST', { id: a.id, approve: yes }); box.textContent = r.text || (yes ? 'Done.' : 'Cancelled.'); } catch (e) { box.textContent = 'Failed: ' + e.message; } };
    ok.onclick = () => go(true); no.onclick = () => go(false); box.append(t, ok, no); el.stAiLog.appendChild(box); el.stAiLog.scrollTop = 1e9;
  }
  el.stPublish.onclick = () => {
    if (!S.project) { say('Make or pick a project first.', 'err'); return; }
    if (!(ghHeaders()['x-github-token'])) { say('Connect GitHub first: Settings > Tools > GitHub token. Your token stays on this device.', 'err'); return; }
    save.flush();
    const repo = (prompt('Repository name to publish to (a new one is created if it does not exist). You can also type owner/name:', S.project) || '').trim(); if (!repo) return;
    const priv = confirm('Make the repository PRIVATE?\n\nOK = private, Cancel = public');
    ask('Publish my project "' + S.project + '" to GitHub. ' + (repo.includes('/') ? 'Use the repository ' + repo + '.' : 'Create a ' + (priv ? 'private' : 'public') + ' repository named ' + repo + ', then publish all project files to it.') + ' Use github_create_repo if needed and then github_publish_project with all the files.');
  };

  return { open: async () => { try { await loadProjects(localStorage.getItem('pholama_studio_proj') || undefined); await loadActivity(); } catch (e) { say('Studio could not start: ' + e.message, 'err'); if (/still the old version/.test(e.message)) { const b = document.createElement('button'); b.textContent = 'Restart Pholama now'; b.className = 'st-restart'; b.onclick = () => window.restartPholama && window.restartPholama(b); el.stAiLog.appendChild(b); } } }, state: S, ask, refreshFromServer };
}
