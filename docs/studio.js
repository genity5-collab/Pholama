// Pholama Studio (browser side). Editor + live preview + console + AI, all talking to the local PC server.
// Anti-lag rules: typing is debounced, the preview only reloads when something changed, the console is capped,
// and the preview runs in a sandboxed iframe that cannot reach Pholama's storage, keys or account.
import { sourcesCard } from './sources.js';
import { createFx, toolStatus } from './studiofx.js';
import * as CL from './companionlife.js';
import { createLiveCard } from './studiolive.js';

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

export function searchProjectFiles(files, query, limit = 40) {
  const q = String(query || '').trim().toLowerCase(); if (!q) return [];
  const max = Math.max(1, Math.min(100, Number(limit) || 40)), hits = [];
  for (const f of Array.isArray(files) ? files : []) {
    const lines = String(f && f.content || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(q)) {
      hits.push({ file: String(f.name || ''), line: i + 1, text: lines[i].trim().slice(0, 220) });
      if (hits.length >= max) return hits;
    }
  }
  return hits;
}

export function createStudio(env) {
  const { api, $, ghHeaders, getModel, mount } = env;
  const S = { project: null, files: [], current: null, dirty: new Set(), newFiles: new Set(), log: [], activity: [], busy: false, stopper: null, timers: {}, companion: false };
  const el = {};

  mount.innerHTML = `
  <div class="st-bar">
    <select id="stProj" title="Project"></select>
    <button id="stNew">New</button><button id="stDel" title="Delete this project">Delete</button><button id="stRefresh" title="Pull the latest files from the local Pholama server">Refresh files</button><button id="stActivity" title="Show AI edits, checks and commands">Activity</button><button id="stHistory" title="Version history: go back to an earlier version of this project">History</button><button id="stSetup" title="What the AI tools need on this PC, and how big it is">Setup</button><button id="stTools" title="Tool servers: let the AI use tools from other programs (always asks first)">Tools</button><button id="stProject" title="Project variables, export and import">Project</button><button id="stSettings" title="Studio settings">Settings</button>
    <span class="sp"></span>
    <button id="stPublish" class="p" title="Put this project on GitHub">Publish</button>
  </div>
  <div id="stActivityPanel" class="st-activity" hidden><div class="st-panelhead"><b>Activity</b><span class="sp"></span><button id="stActivityRefresh">Refresh</button></div><div id="stActivityList" class="st-activitylist">Loading...</div></div>
  <div id="stHistoryPanel" class="st-activity st-history" hidden><div class="st-panelhead"><b>Version history</b><span class="sp"></span><button id="stHistorySave" title="Save the project as it is now">Save version</button><button id="stHistoryClose">Close</button></div><div id="stHistoryList" class="st-activitylist">Loading...</div></div>
  <div id="stSetupPanel" class="st-activity st-setup" hidden><div class="st-panelhead"><b>Setup</b><span class="sp"></span><button id="stSetupRefresh">Refresh</button><button id="stSetupClose">Close</button></div><div id="stSetupBody" class="st-activitylist">Loading...</div></div>
  <div id="stToolsPanel" class="st-activity st-setup" hidden><div class="st-panelhead"><b>Tool servers</b><span class="sp"></span><button id="stToolsClose">Close</button></div><div id="stToolsBody" class="st-setupbody">Loading...</div></div>
  <div id="stProjectPanel" class="st-activity st-setup" hidden><div class="st-panelhead"><b>Project</b><span class="sp"></span><button id="stProjectClose">Close</button></div><div id="stProjectBody" class="st-setupbody">Loading...</div></div>
  <div id="stSettingsPanel" class="st-settings" hidden><div class="st-panelhead"><b>Studio settings</b><span class="sp"></span><button id="stSettingsClose">Close</button></div><label class="st-setting"><input id="stCompanion" type="checkbox"><span><b>Pholama companion</b><small>Turn it on, drag it anywhere, then click for reactions. It never reads the page or sends anything.</small></span></label><div class="sys">The companion is off by default and can be turned off at any time.</div></div>
  <div class="st-main">
    <div class="st-left">
      <div class="st-findbar"><input id="stFind" type="search" placeholder="Find in project… (Ctrl+Shift+F)" aria-label="Search all project files"><span id="stFindCount" class="st-findcount">Search all files</span></div>
      <div id="stFindResults" class="st-findresults" role="listbox" aria-label="Project search results" hidden></div>
      <div class="st-tabs" id="stTabs"></div>
      <textarea id="stCode" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Code editor"></textarea>
      <div class="st-foot"><span id="stStat">Saved</span><button id="stAddFile">+ File</button><button id="stNewScript">+ Script</button><button id="stRm">Remove file</button></div>
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
    <div class="st-aibox"><textarea id="stAsk" rows="2" placeholder="Describe an app to build, then inspect Preview, Code and Logs side by side..."></textarea><button id="stDiagnose" title="Check the project and explain the next fix">Diagnose</button><button id="stSend" class="p">Send</button></div>
  </div>`;
  for (const id of ['stProj', 'stNew', 'stDel', 'stRefresh', 'stActivity', 'stSettings', 'stActivityPanel', 'stActivityRefresh', 'stActivityList', 'stHistory', 'stHistoryPanel', 'stHistorySave', 'stHistoryClose', 'stHistoryList', 'stSetup', 'stSetupPanel', 'stSetupRefresh', 'stSetupClose', 'stSetupBody', 'stTools', 'stToolsPanel', 'stToolsClose', 'stToolsBody', 'stProject', 'stProjectPanel', 'stProjectClose', 'stProjectBody', 'stSettingsPanel', 'stSettingsClose', 'stCompanion', 'stPublish', 'stFind', 'stFindCount', 'stFindResults', 'stTabs', 'stCode', 'stStat', 'stAddFile', 'stNewScript', 'stRm', 'stFrame', 'stReload', 'stCon', 'stClear', 'stAiLog', 'stAsk', 'stDiagnose', 'stSend']) el[id] = mount.querySelector('#' + id);
  const live = createLiveCard(el.stAiLog);   // the Live Activity card: what the AI thinks and which files it touches, right in the chat
  const fx = createFx({ host: el.stCode.parentElement, code: el.stCode, tabs: el.stTabs, frame: el.stFrame });   // the 'AI is editing' animation
  const activityTitle = e => e.kind === 'file' ? ((e.status === 'working' ? 'Working on ' : e.status === 'failed' ? 'Failed: ' : 'Changed ') + (e.path || 'a file')) : e.kind === 'command' ? (e.status === 'ok' ? 'Command finished' : e.status === 'proposed' ? 'Command waiting for approval' : 'Command ' + (e.status || 'updated')) : (e.text || e.status || e.kind || 'Activity');
  const paintActivity = () => { const box = el.stActivityList; if (!box) return; box.textContent = ''; if (!S.activity.length) { box.textContent = 'No Studio activity yet.'; return; } for (const e of S.activity.slice(0, 80)) { const d = document.createElement('details'); d.className = 'st-activityrow ' + (e.status === 'failed' || e.status === 'error' ? 'bad' : e.status === 'working' || e.status === 'proposed' ? 'wait' : 'good'); const s = document.createElement('summary'); const time = e.t ? new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; s.textContent = (e.status || 'event') + ' · ' + activityTitle(e) + (time ? ' · ' + time : ''); d.appendChild(s); const body = document.createElement('div'); body.className = 'st-activitybody'; const bits = []; if (e.project) bits.push('Project: ' + e.project); if (e.added != null || e.removed != null) bits.push('Lines: +' + (e.added || 0) + ' / -' + (e.removed || 0)); if (e.error) bits.push('Error: ' + e.error); if (e.cmd) bits.push(e.cmd); body.textContent = bits.join('\n') || 'No additional details.'; d.appendChild(body); box.appendChild(d); } };
  const loadActivity = async () => { try { const j = await jget('api/editlog?n=160'); S.activity = j.entries || []; paintActivity(); } catch (e) { if (el.stActivityList) el.stActivityList.textContent = 'Activity is unavailable: ' + e.message; } };
  const openPanel = (panel, other) => { panel.hidden = !panel.hidden; if (!panel.hidden && other) other.hidden = true; };
  el.stActivity.onclick = () => { el.stHistoryPanel.hidden = true; openPanel(el.stActivityPanel, el.stSettingsPanel); if (!el.stActivityPanel.hidden) loadActivity(); };
  el.stActivityRefresh.onclick = loadActivity;
  // ---- Setup: what the tool-calling runtime needs (engine, Python), its size against 1 GB, and a live bar while Python installs ----
  let setupTimer = null;
  const fmtMb = n => n >= 1024 ? (n / 1024).toFixed(2) + ' GB' : Math.round(n) + ' MB';
  const paintSetup = d => {
    const box = el.stSetupBody; box.textContent = '';
    const head = document.createElement('div'); head.className = 'st-setuphead'; head.textContent = 'Runtime ' + fmtMb(d.totalMb) + ' of ' + fmtMb(d.budgetMb) + (d.underBudget ? ' (under 1 GB)' : ' (over 1 GB)') + (d.missing.length ? '  -  still to download ' + fmtMb(d.downloadMb) : '  -  everything is installed'); box.appendChild(head);
    const meter = document.createElement('div'); meter.className = 'st-meter'; const fill = document.createElement('i'); fill.style.width = Math.min(100, Math.round(d.totalMb / d.budgetMb * 100)) + '%'; meter.appendChild(fill); box.appendChild(meter);
    for (const it of d.items) {
      const row = document.createElement('div'); row.className = 'st-setuprow' + (it.installed ? ' ok' : '');
      const t = document.createElement('span'); t.textContent = (it.installed ? 'Installed  ' : 'Missing  ') + it.name + '  (' + fmtMb(it.mb) + ')'; row.appendChild(t);
      if (it.note) { const sm = document.createElement('small'); sm.textContent = it.note; row.appendChild(sm); }
      if (!it.installed && it.id === 'python' && d.windows) { const b = document.createElement('button'); b.textContent = 'Install Python'; b.onclick = async () => { b.disabled = true; try { await jsend('api/setup/python', 'POST', {}); watchSetup(); } catch (e) { say('Could not start: ' + e.message); b.disabled = false; } }; row.appendChild(b); }
      if (!it.installed && it.id === 'engine') { const b = document.createElement('button'); b.textContent = 'Install engine'; b.onclick = async () => { b.disabled = true; try { await jsend('api/install-llama', 'POST', {}); watchSetup(); } catch (e) { say('Could not start: ' + e.message); b.disabled = false; } }; row.appendChild(b); }
      box.appendChild(row);
    }
    const py = d.python || {}; if (py.status === 'installing' || py.status === 'error') { const bar = document.createElement('div'); bar.className = 'st-setupprog'; bar.textContent = py.status === 'error' ? 'Python: ' + py.error : py.step + (py.total ? '  ' + Math.round(py.done / py.total * 100) + '%' : ''); box.appendChild(bar); }
    const note = document.createElement('div'); note.className = 'st-setupnote'; note.textContent = d.modelNote; box.appendChild(note);
    const sm = d.smartModels || [];
    if (sm.length) {
      const h2 = document.createElement('div'); h2.className = 'st-setuphead'; h2.textContent = 'Smart models that can run tools, 4 GB or less'; box.appendChild(h2);
      const why = document.createElement('div'); why.className = 'st-setupnote'; why.textContent = 'Each one is rated good at tool calling, newest first (that is the order they came out, not a score). Pick yours in Models; nothing is downloaded for you.'; box.appendChild(why);
      for (const m of sm.slice(0, 12)) {
        const row = document.createElement('div'); row.className = 'st-setuprow' + (m.downloaded ? ' ok' : '');
        const t = document.createElement('span'); t.textContent = (m.downloaded ? 'Downloaded  ' : '') + m.name + '  (' + m.sizeGB + ' GB)'; row.appendChild(t);
        const s2 = document.createElement('small'); s2.textContent = m.params + ', needs about ' + m.minRamGB + ' GB of memory' + (m.fits === false ? '. Too big for this PC.' : m.comfy ? '. Runs comfortably here.' : m.fits ? '. Fits, but tightly.' : ''); row.appendChild(s2);
        box.appendChild(row);
      }
    }
  };
  const loadSetup = async () => { try { const d = await jget('api/setup'); paintSetup(d); const busy = (d.python && d.python.status === 'installing') || (d.engine && d.engine.status === 'installing'); if (!busy) { clearInterval(setupTimer); setupTimer = null; } return d; } catch (e) { el.stSetupBody.textContent = e.message; } };
  const watchSetup = () => { if (!setupTimer) setupTimer = setInterval(loadSetup, 700); loadSetup(); };
  el.stSetup.onclick = () => { el.stHistoryPanel.hidden = true; el.stActivityPanel.hidden = true; el.stSettingsPanel.hidden = true; el.stSetupPanel.hidden = !el.stSetupPanel.hidden; if (!el.stSetupPanel.hidden) loadSetup(); else { clearInterval(setupTimer); setupTimer = null; } };
  el.stSetupClose.onclick = () => { el.stSetupPanel.hidden = true; clearInterval(setupTimer); setupTimer = null; };
  el.stSetupRefresh.onclick = loadSetup;
  // ---- Tool servers: programs the USER adds so the AI can use their tools. Every call to them asks for a click first. ----
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const closeAll = () => { for (const k of ['stHistoryPanel', 'stActivityPanel', 'stSettingsPanel', 'stSetupPanel', 'stToolsPanel', 'stProjectPanel']) if (el[k]) el[k].hidden = true; };
  const paintTools = d => {
    const box = el.stToolsBody; box.textContent = '';
    box.appendChild(mk('div', 'A tool server is a program that gives the AI extra tools (read files, use git, and more). You add it yourself. The AI can never start one, and every tool it uses asks for your click first.', 'st-setupnote'));
    const list = d.servers || [];
    if (!list.length) box.appendChild(mk('div', 'No tool servers yet.', 'st-setupnote'));
    for (const sv of list) {
      const row = mk('div', null, 'st-setuprow' + (sv.running ? ' ok' : '')); row.appendChild(mk('span', (sv.running ? '[x] ' : '[ ] ') + sv.id + (sv.running ? '  (' + sv.tools + ' tools)' : '  (not running)')));
      row.appendChild(mk('small', sv.command + ' ' + (sv.args || []).join(' ').slice(0, 120)));
      const rm = mk('button', 'Remove'); rm.onclick = async () => { if (!confirm('Remove the tool server "' + sv.id + '"?')) return; try { await jsend('api/toolservers?name=' + encodeURIComponent(sv.id), 'DELETE'); loadTools(); } catch (e) { alert(e.message); } };
      row.appendChild(rm); box.appendChild(row);
    }
    const add = mk('div', null, 'st-setuprow'); add.appendChild(mk('span', 'Pholama files (read_file, analyze_file, sessions)')); add.appendChild(mk('small', 'Built in, needs Python (see Setup). Runs only inside your Pholama workspace folder.'));
    const ab = mk('button', list.some(x => x.id === 'files') ? 'Added' : 'Add'); ab.disabled = list.some(x => x.id === 'files');
    ab.onclick = async () => { if (!confirm('This starts a small Python program on your PC that can read files inside your Pholama workspace folder. Continue?')) return; try { const r = await jsend('api/toolservers', 'POST', { bundled: 'files', confirm: true }); if (r.warning) alert(r.warning); loadTools(); } catch (e) { alert(e.message); } };
    add.appendChild(ab); box.appendChild(add);
    const own = mk('div', null, 'st-setuprow'); own.appendChild(mk('span', 'Add your own')); own.appendChild(mk('small', 'Name (letters/digits), the command, and its arguments. Example: name "git", command "npx", arguments "-y @modelcontextprotocol/server-git".'));
    const nm = mk('input'); nm.type = 'text'; nm.placeholder = 'name'; nm.maxLength = 16; const cm = mk('input'); cm.type = 'text'; cm.placeholder = 'command (python, npx, node...)'; const ag = mk('input'); ag.type = 'text'; ag.placeholder = 'arguments, separated by spaces';
    for (const i of [nm, cm, ag]) { i.style.flexBasis = '100%'; own.appendChild(i); }
    const go = mk('button', 'Add tool server'); go.className = 'st-primary';
    go.onclick = async () => { const name = nm.value.trim().toLowerCase(), command = cm.value.trim(); if (!name || !command) return alert('Give it a name and a command.'); if (!confirm('This will run "' + command + ' ' + ag.value.trim() + '" on your PC. Only continue if you trust it.')) return;
      try { const r = await jsend('api/toolservers', 'POST', { name, command, args: ag.value.trim() ? ag.value.trim().split(/\s+/) : [], confirm: true }); if (r.warning) alert(r.warning); nm.value = cm.value = ag.value = ''; loadTools(); } catch (e) { alert(e.message); } };
    own.appendChild(go); box.appendChild(own);
  };
  const loadTools = async () => { try { paintTools(await jget('api/toolservers')); } catch (e) { el.stToolsBody.textContent = 'Tool servers are unavailable: ' + e.message; } };
  el.stTools.onclick = () => { const was = el.stToolsPanel.hidden; closeAll(); el.stToolsPanel.hidden = !was; if (was) loadTools(); };
  el.stToolsClose.onclick = () => { el.stToolsPanel.hidden = true; };
  // ---- Project: variables the app can use ({{NAME}}), kept on this PC and never shown to the AI; export / import one file ----
  const pBase = () => 'api/studio/projects/' + encodeURIComponent(S.project);
  const paintProject = d => {
    const box = el.stProjectBody; box.textContent = '';
    if (!S.project) { box.textContent = 'Open or create a project first.'; return; }
    box.appendChild(mk('div', 'Variables stay on this PC. Use them in your files as {{NAME}}; they are filled in only in the preview. The AI sees the names, never the values, and exports never include them.', 'st-setupnote'));
    const vars = d.vars || []; if (!vars.length) box.appendChild(mk('div', 'No variables yet.', 'st-setupnote'));
    for (const v of vars) { const row = mk('div', null, 'st-setuprow ok'); row.appendChild(mk('span', '{{' + v.key + '}}  set')); const rm = mk('button', 'Remove'); rm.onclick = async () => { try { await jsend(pBase() + '/secrets', 'DELETE', { key: v.key }); loadProject(); } catch (e) { alert(e.message); } }; row.appendChild(rm); box.appendChild(row); }
    const add = mk('div', null, 'st-setuprow'); const k = mk('input'); k.type = 'text'; k.placeholder = 'NAME (capitals)'; k.maxLength = 48; const val = mk('input'); val.type = 'password'; val.placeholder = 'value'; val.autocomplete = 'off';
    k.style.flexBasis = '100%'; val.style.flexBasis = '100%'; const sv = mk('button', 'Save variable'); sv.className = 'st-primary';
    sv.onclick = async () => { try { await jsend(pBase() + '/secrets', 'PUT', { key: k.value.trim(), value: val.value }); k.value = val.value = ''; loadProject(); } catch (e) { alert(e.message); } };
    add.appendChild(k); add.appendChild(val); add.appendChild(sv); box.appendChild(add);
    const io = mk('div', null, 'st-setuprow'); io.appendChild(mk('span', 'Export or import')); io.appendChild(mk('small', 'One file with all this project\'s files. Import checks every file name and never overwrites a project.'));
    const ex = mk('button', 'Export project'); ex.onclick = async () => { try { const b = await jget(pBase() + '/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' })); a.download = S.project + '.pholama-project.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch (e) { alert(e.message); } };
    const im = mk('button', 'Import project...'); const fi = mk('input'); fi.type = 'file'; fi.accept = '.json,application/json'; fi.hidden = true;
    fi.onchange = async () => { const f = fi.files[0]; fi.value = ''; if (!f) return; if (f.size > 6 * 1024 * 1024) return alert('That file is too big.'); try { const r = await jsend('api/studio/import', 'POST', { bundle: JSON.parse(await f.text()) }); alert('Imported "' + r.name + '" (' + r.files + ' files).'); if (typeof S.reloadProjects === 'function') S.reloadProjects(r.name); else el.stRefresh.click(); } catch (e) { alert(/JSON/.test(e.message) ? 'That is not a project file.' : e.message); } };
    im.onclick = () => fi.click(); io.appendChild(ex); io.appendChild(im); io.appendChild(fi); box.appendChild(io);
  };
  const loadProject = async () => { try { paintProject(S.project ? await jget(pBase() + '/secrets') : {}); } catch (e) { el.stProjectBody.textContent = 'Unavailable: ' + e.message; } };
  el.stProject.onclick = () => { const was = el.stProjectPanel.hidden; closeAll(); el.stProjectPanel.hidden = !was; if (was) loadProject(); };
  el.stProjectClose.onclick = () => { el.stProjectPanel.hidden = true; };
  // ---- version history: the project as it was before each AI edit; see what changed and go back ----
  const histBase = () => 'api/studio/projects/' + encodeURIComponent(S.project) + '/history';
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const paintDiff = (box, changes) => {
    box.textContent = ''; if (!changes.length) { box.textContent = 'No differences: this is the same as now.'; return; }
    for (const c of changes) {
      const h = document.createElement('div'); h.className = 'st-diffhead'; h.textContent = c.file + '  (' + c.status + ', +' + c.added + ' -' + c.removed + ')'; box.appendChild(h);
      for (const hk of c.hunks || []) { if (hk.type === 'too-big') { const d = document.createElement('div'); d.className = 'st-diffline'; d.textContent = 'File is too big to show line by line.'; box.appendChild(d); continue; }
        for (const l of hk.lines) { const d = document.createElement('div'); d.className = 'st-diffline ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''); d.textContent = (l.t === ' ' ? '  ' : l.t + ' ') + l.s; box.appendChild(d); } }   // textContent only: file text is never HTML
    }
  };
  const paintHistory = list => {
    const box = el.stHistoryList; box.textContent = '';
    if (!S.project) { box.textContent = 'Open a project first.'; return; }
    if (!list.length) { box.textContent = 'No saved versions yet. One is saved automatically right before the AI changes your files, or press Save version.'; return; }
    for (const c of list) {
      const row = document.createElement('div'); row.className = 'st-histrow';
      const t = document.createElement('div'); t.className = 'st-histtitle'; t.textContent = c.label + '  -  ' + ago(c.at) + '  -  ' + c.fileCount + ' files' + (c.by === 'ai' ? '  (before AI edit)' : c.by === 'restore' ? '  (before a restore)' : ''); row.appendChild(t);
      const acts = document.createElement('div'); acts.className = 'st-histacts';
      const diffBox = document.createElement('div'); diffBox.className = 'st-diff'; diffBox.hidden = true;
      const bDiff = document.createElement('button'); bDiff.textContent = 'See changes'; bDiff.onclick = async () => { if (!diffBox.hidden) { diffBox.hidden = true; return; } try { diffBox.hidden = false; diffBox.textContent = 'Loading...'; paintDiff(diffBox, (await jget(histBase() + '/' + c.id + '/diff')).changes); } catch (e) { diffBox.textContent = e.message; } };
      const bRes = document.createElement('button'); bRes.textContent = 'Restore'; bRes.onclick = async () => {
        if (S.dirty.size && !confirm('You have unsaved edits in the editor. They will be lost. Continue?')) return;
        if (!confirm('Go back to "' + c.label + '"? Your current version is saved first, so you can undo this.')) return;
        try { await jsend(histBase() + '/' + c.id + '/restore', 'POST', {}); await openProject(S.project); await loadHistory(); say('Restored "' + c.label + '". The version from before is saved in History.'); } catch (e) { say('Could not restore: ' + e.message); }
      };
      const bDel = document.createElement('button'); bDel.textContent = 'Delete'; bDel.onclick = async () => { if (!confirm('Delete this saved version?')) return; try { await jsend(histBase() + '/' + c.id, 'DELETE', {}); await loadHistory(); } catch (e) { say('Could not delete: ' + e.message); } };
      acts.append(bDiff, bRes, bDel); row.append(acts, diffBox); box.appendChild(row);
    }
  };
  const loadHistory = async () => { try { if (!S.project) return paintHistory([]); paintHistory((await jget(histBase())).checkpoints || []); } catch (e) { el.stHistoryList.textContent = e.message; } };
  el.stHistory.onclick = () => { el.stSetupPanel.hidden = true; el.stSettingsPanel.hidden = true; el.stActivityPanel.hidden = true; el.stHistoryPanel.hidden = !el.stHistoryPanel.hidden; if (!el.stHistoryPanel.hidden) loadHistory(); };
  el.stHistoryClose.onclick = () => { el.stHistoryPanel.hidden = true; };
  el.stHistorySave.onclick = async () => { if (!S.project) return; const label = prompt('Name this version (for example: before the new menu)', 'My version'); if (label === null) return; try { const r = await jsend(histBase(), 'POST', { label: label.trim() || 'My version', force: true }); say(r.unchanged ? 'Nothing changed since the last saved version.' : 'Saved the version "' + (r.checkpoint ? r.checkpoint.label : label) + '".'); await loadHistory(); } catch (e) { say('Could not save the version: ' + e.message); } };
  el.stSettings.onclick = () => { el.stHistoryPanel.hidden = true; openPanel(el.stSettingsPanel, el.stActivityPanel); };
  el.stSettingsClose.onclick = () => { el.stSettingsPanel.hidden = true; };
  const companionKey = 'pholama_studio_companion';
  const companionOn = () => { try { return localStorage.getItem(companionKey) === 'on'; } catch { return false; } };
  let companionEl = null, companionBtn = null, companionActions = null, companionBubble = null, suppressCompanionClick = false, dragCompanion = null, bubbleTimer = 0;
  const readCompanionPos = () => { try { const p = JSON.parse(localStorage.getItem('pholama_studio_companion_pos') || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch {} return { x: window.innerWidth - 76, y: window.innerHeight - 110 }; };
  let companionPos = readCompanionPos();
  const placeCompanion = (x, y, save = false) => { companionPos = { x: Math.max(4, Math.min(window.innerWidth - 64, x)), y: Math.max(4, Math.min(window.innerHeight - 64, y)) }; if (companionEl) { companionEl.style.left = companionPos.x + 'px'; companionEl.style.top = companionPos.y + 'px'; companionEl.dataset.side = companionPos.x < window.innerWidth / 2 ? 'left' : 'right'; companionEl.dataset.vertical = companionPos.y < 150 ? 'top' : 'bottom'; } if (save) try { localStorage.setItem('pholama_studio_companion_pos', JSON.stringify(companionPos)); } catch {} };
  const companionSay = text => { if (!companionBubble) return; companionBubble.textContent = text; companionBubble.hidden = false; clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { if (companionBubble) companionBubble.hidden = true; }, 1800); };
  const makeCompanion = () => {
    if (companionEl || !S.companion) return;
    companionEl = document.createElement('div'); companionEl.className = 'st-companion-wrap';
    companionEl.innerHTML = '<button class="st-companion" type="button" title="Drag to place Pholama; click for reactions" aria-label="Pholama companion" aria-expanded="false"><img src="icon.svg" alt=""><span>drag me</span></button><div class="st-companion-actions" hidden aria-label="Pholama reactions"><button type="button" data-reaction="👋 Wave">👋 Wave</button><button type="button" data-reaction="✨ Yay!">✨ Yay</button><button type="button" data-reaction="💚 Love">💚 Love</button><button type="button" data-reaction="💃 Dance">💃 Dance</button><button type="button" data-reaction="😴 Nap">😴 Nap</button><button type="button" data-reaction="🤔 Thinking...">🤔 Think</button></div><div class="st-companion-bubble" hidden></div><div class="st-companion-pc" hidden aria-hidden="true"><div class="st-pc-screen"><pre></pre></div><div class="st-pc-base"></div></div>';
    companionBtn = companionEl.querySelector('.st-companion'); companionActions = companionEl.querySelector('.st-companion-actions'); companionBubble = companionEl.querySelector('.st-companion-bubble');
    companionBtn.addEventListener('pointerdown', e => { if (e.button !== 0) return; lastActive = Date.now(); stopWalking(); dragCompanion = { id: e.pointerId, x: e.clientX, y: e.clientY, left: companionPos.x, top: companionPos.y, moved: false }; try { companionBtn.setPointerCapture(e.pointerId); } catch {} });
    companionBtn.addEventListener('pointermove', e => { if (!dragCompanion || dragCompanion.id !== e.pointerId) return; const dx = e.clientX - dragCompanion.x, dy = e.clientY - dragCompanion.y; if (Math.abs(dx) + Math.abs(dy) > 5) dragCompanion.moved = true; if (dragCompanion.moved) placeCompanion(dragCompanion.left + dx, dragCompanion.top + dy); });
    companionBtn.addEventListener('pointerup', e => { if (!dragCompanion || dragCompanion.id !== e.pointerId) return; if (dragCompanion.moved) { placeCompanion(companionPos.x, companionPos.y, true); suppressCompanionClick = true; setTimeout(() => { suppressCompanionClick = false; }, 150); } dragCompanion = null; });
    companionBtn.onclick = () => { if (suppressCompanionClick) { suppressCompanionClick = false; return; } lastActive = Date.now(); stopWalking(); companionActions.hidden = !companionActions.hidden; companionBtn.setAttribute('aria-expanded', String(!companionActions.hidden)); if (!companionActions.hidden) companionSay('Choose a reaction'); };
    companionActions.addEventListener('click', e => { const b = e.target.closest('[data-reaction]'); if (!b) return; companionEl.classList.remove('react'); void companionEl.offsetWidth; companionEl.classList.add('react'); companionSay(b.dataset.reaction); companionActions.hidden = true; companionBtn.setAttribute('aria-expanded', 'false'); });
    document.addEventListener('pointerdown', e => { if (companionEl && !companionEl.contains(e.target) && companionActions && !companionActions.hidden) { companionActions.hidden = true; companionBtn.setAttribute('aria-expanded', 'false'); } });
    document.body.appendChild(companionEl); placeCompanion(companionPos.x, companionPos.y); startLife();
  };
  // ---- the companion's little life: wanders around, codes on a tiny laptop while the AI builds, naps when nothing happens ----
  let lifeTimer = 0, codeTimer = 0, walkTimer = 0, lastActive = Date.now(), codeTick = 0, mood = 'idle';
  const calm = () => { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const setMood = m => { mood = m; if (!companionEl) return; companionEl.dataset.mood = m; const pc = companionEl.querySelector('.st-companion-pc'); if (pc) pc.hidden = m !== 'code'; };
  const drawCode = () => { const pre = companionEl && companionEl.querySelector('.st-pc-screen pre'); if (pre) pre.textContent = CL.codeView(codeTick, 4, 22).join('\n'); };
  const stopLife = () => { clearTimeout(lifeTimer); clearInterval(codeTimer); clearTimeout(walkTimer); lifeTimer = codeTimer = walkTimer = 0; };
  const stopWalking = () => { if (!companionEl) return; clearTimeout(walkTimer); const r = companionEl.getBoundingClientRect(); companionEl.classList.remove('walking'); companionEl.style.transition = 'none'; placeCompanion(r.left, r.top, true); void companionEl.offsetWidth; companionEl.style.transition = ''; };
  const walkTo = spot => {   // glide to the spot, facing the way it goes
    if (!companionEl) return; const from = { ...companionPos }, ms = CL.walkMs(from, spot);
    companionEl.dataset.face = spot.x < from.x ? 'left' : 'right'; companionEl.classList.add('walking');
    companionEl.style.transition = 'left ' + ms + 'ms ease-in-out, top ' + ms + 'ms ease-in-out'; placeCompanion(spot.x, spot.y, true);
    walkTimer = setTimeout(() => { if (companionEl) { companionEl.classList.remove('walking'); companionEl.style.transition = ''; } }, ms + 50);
  };
  const lifeStep = () => {
    clearTimeout(lifeTimer); if (!companionEl || !S.companion) return;
    const blocked = calm() || !!dragCompanion || (companionActions && !companionActions.hidden) || !document.body.classList.contains('studio-on') || document.hidden;
    if (S.busy) lastActive = Date.now();
    const next = CL.nextMood({ busy: S.busy && !blocked, blocked, idleSeconds: (Date.now() - lastActive) / 1000 });
    if (next === 'code') { if (mood !== 'code') { codeTick = 0; setMood('code'); clearInterval(codeTimer); codeTimer = setInterval(() => { codeTick += 2; drawCode(); }, 90); companionSay(CL.say('code')); } }
    else { if (mood === 'code') { clearInterval(codeTimer); codeTimer = 0; } setMood(next);
      if (next === 'walk') { walkTo(CL.pickSpot(companionPos, { w: window.innerWidth, h: window.innerHeight })); if (Math.random() < 0.3) companionSay(CL.say('walk')); }
      else if (next === 'nap' && Math.random() < 0.5) companionSay(CL.say('nap')); }
    lifeTimer = setTimeout(lifeStep, next === 'code' ? 1500 : 2600 + Math.random() * 3400);
  };
  const startLife = () => { stopLife(); lastActive = Date.now(); lifeTimer = setTimeout(lifeStep, 1800); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInterval(codeTimer); codeTimer = 0; } });
  window.__pholamaStudioBusy = v => { S.busy = !!v; };   // used by the browser tests to stand in for a real build
  const removeCompanion = () => { stopLife(); if (companionEl) { companionEl.remove(); companionEl = null; } };
  const companionFrame = () => { if (companionEl) companionEl.style.display = S.companion && document.body.classList.contains('studio-on') ? '' : 'none'; };
  if (window.MutationObserver) new MutationObserver(companionFrame).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => placeCompanion(companionPos.x, companionPos.y));
  S.companion = companionOn(); el.stCompanion.checked = S.companion; el.stCompanion.onchange = () => { S.companion = el.stCompanion.checked; try { localStorage.setItem(companionKey, S.companion ? 'on' : 'off'); } catch {} if (S.companion) makeCompanion(); else removeCompanion(); companionFrame(); };
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
  S.reloadProjects = name => loadProjects(name).catch(e => say(e.message, 'err'));   // used by Import, so the new project is selected
  async function openProject(name) {
    S.project = name; S.dirty.clear(); S.newFiles.clear(); S.current = null;
    const j = await jget('api/studio/projects/' + encodeURIComponent(name)); S.files = j.files;
    S.current = (S.files.find(f => f.name === 'index.html') || S.files[0] || {}).name || null; paintAll(); paintFind(); try { localStorage.setItem('pholama_studio_proj', name); } catch {}
  }
  function paintAll() { paintTabs(); paintEditor(); renderPreview(true); }
  function paintTabs() {
    el.stTabs.textContent = '';
    for (const f of S.files) { const b = document.createElement('button'); b.className = 'st-tab' + (f.name === S.current ? ' on' : '') + (S.newFiles.has(f.name) ? ' fresh' : ''); b.textContent = f.name + (S.dirty.has(f.name) ? ' \u2022' : '') + (S.newFiles.has(f.name) ? '  NEW' : ''); if (S.newFiles.has(f.name)) b.title = 'New file — click to open and review'; b.onclick = () => { S.current = f.name; S.newFiles.delete(f.name); paintTabs(); paintEditor(); }; el.stTabs.appendChild(b); }
  }
  function paintEditor() {
    const f = S.files.find(x => x.name === S.current);
    el.stCode.disabled = !f; el.stCode.value = f ? f.content : ''; el.stCode.placeholder = S.project ? 'Pick or add a file.' : 'Make a project first with "New".';
    el.stRm.disabled = !f; el.stAddFile.disabled = !S.project || S.busy; el.stNewScript.disabled = !S.project || S.busy;
  }
  function paintFind() {
    const q = el.stFind.value.trim(); el.stFindResults.replaceChildren();
    if (!q) { el.stFindResults.hidden = true; el.stFindCount.textContent = 'Search all files'; return; }
    if (!S.project) { el.stFindResults.hidden = false; el.stFindCount.textContent = 'No project'; const e = document.createElement('div'); e.className = 'st-findempty'; e.textContent = 'Create or open a project first.'; el.stFindResults.appendChild(e); return; }
    const hits = searchProjectFiles(S.files, q); el.stFindCount.textContent = hits.length ? `${hits.length}${hits.length === 40 ? '+' : ''} match${hits.length === 1 ? '' : 'es'}` : 'No matches';
    el.stFindResults.hidden = false;
    if (!hits.length) { const e = document.createElement('div'); e.className = 'st-findempty'; e.textContent = 'No matches in this project.'; el.stFindResults.appendChild(e); return; }
    for (const hit of hits) { const b = document.createElement('button'); b.type = 'button'; b.className = 'st-findresult'; b.setAttribute('role', 'option'); b.textContent = `${hit.file}:${hit.line}  ${hit.text}`; b.title = `Open ${hit.file} at line ${hit.line}`; b.onclick = () => {
      save.flush(); const f = S.files.find(x => x.name === hit.file); if (!f) return;
      S.current = hit.file; S.newFiles.delete(hit.file); paintTabs(); paintEditor();
      const lines = f.content.split(/\r?\n/), offset = lines.slice(0, hit.line - 1).reduce((n, line) => n + line.length + 1, 0);
      el.stCode.focus(); el.stCode.setSelectionRange(Math.min(offset, f.content.length), Math.min(offset, f.content.length));
      const lineHeight = parseFloat(getComputedStyle(el.stCode).lineHeight) || 21; el.stCode.scrollTop = Math.max(0, (hit.line - 3) * lineHeight);
    }; el.stFindResults.appendChild(b); }
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
  el.stCode.addEventListener('input', () => { const f = S.files.find(x => x.name === S.current); if (!f) return; f.content = el.stCode.value; f.size = f.content.length; S.dirty.add(f.name); stat('Unsaved'); previewSoon(); save(); if (el.stFind.value.trim()) paintFind(); });
  el.stFind.addEventListener('input', paintFind);
  el.stCode.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); el.stFind.focus(); el.stFind.select(); return; } if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = el.stCode, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save.flush(); } });

  // ---- pulling the AI's changes into the editor live, without clobbering what the user is typing ----
  async function refreshFromServer() {
    if (!S.project) return;
    try {
      const j = await jget('api/studio/projects/' + encodeURIComponent(S.project));
      const typing = document.activeElement === el.stCode, keep = S.current, pos = typing ? [el.stCode.selectionStart, el.stCode.selectionEnd] : null;
      const oldNames = new Set(S.files.map(f => f.name)), added = j.files.filter(f => !oldNames.has(f.name));
      for (const f of added) S.newFiles.add(f.name);
      const m = mergeIncoming(S.files, j.files, S.dirty); S.files = m.files;
      if (!S.files.some(f => f.name === S.current)) S.current = (S.files.find(f => f.name === 'index.html') || S.files[0] || {}).name || null;
      paintTabs(); fx.restoreTabs(); const f = S.files.find(x => x.name === S.current);
      if (f && el.stCode.value !== f.content && !S.dirty.has(f.name)) { const before = el.stCode.value, fresh = keep === S.current && !typing; el.stCode.value = f.content; if (fresh && (S.busy || fxShow)) { fx.landed(before, f.content); fx.pulseTab(f.name); } if (pos && keep === S.current) el.stCode.setSelectionRange(Math.min(pos[0], f.content.length), Math.min(pos[1], f.content.length)); }
      renderPreview(false); paintFind(); if (S.busy || fxShow) fx.pulsePreview();
      if (added.length) say('New files added: ' + added.map(f => f.name).join(', ') + '. Click a NEW tab to review it.', 'act');
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
  el.stNewScript.onclick = async () => {
    if (!S.project) return;
    save.flush();
    let name = (prompt('Name for your JavaScript script (for example scripts/score.js):') || '').trim().replace(/\\/g, '/');
    if (!name) return; if (!/\.m?js$/i.test(name)) name += '.js';
    if (S.files.some(f => f.name === name)) { say('That file already exists. Pick a different name so nothing is overwritten.', 'warn'); return; }
    const apiPath = 'api/studio/projects/' + encodeURIComponent(S.project) + '/file';
    try {
      await jsend(apiPath, 'PUT', { file: name, content: '// Your JavaScript file. Add your code below.\n\n' });
      const page = S.files.find(f => f.name === 'index.html'); let linked = false;
      if (page && !page.content.includes(name) && /<\/body\s*>/i.test(page.content)) {
        const src = name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const content = page.content.replace(/<\/body\s*>/i, '<script src="' + src + '"></script>\n</body>');
        await jsend(apiPath, 'PUT', { file: page.name, content }); linked = true;
      }
      await refreshFromServer(); S.current = name; S.newFiles.add(name); paintTabs(); paintEditor(); renderPreview(true);
      say('Created and opened ' + name + (linked ? ' and linked it into the Preview.' : '. Add a script tag to index.html to run it in Preview.'), 'act');
    } catch (e) { say(e.message, 'err'); }
  };
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
    if (model === 'cloud:pholama' && !S.maxWarned) { S.maxWarned = true; say('Credits in Studio: chat 1, a medium task 3, a big task 4. Agent Max costs the same, and also uses up to 8 Max messages from your daily and monthly allowance. If Max runs out, your own model on this PC takes over for free.', 'warn'); }
    S.busy = true; el.stAddFile.disabled = true; el.stNewScript.disabled = true; el.stSend.textContent = 'Stop'; say(text, 'me'); hist.push({ role: 'user', content: modelText }); if (hist.length > 8) hist.splice(0, hist.length - 8);
    const ac = new AbortController(); S.stopper = () => ac.abort(); let reply = '', node = null, srcCard = null, thinkNode = null;
    live.begin(); const openTools = [];
    try {
      const r = await api('api/chat', { method: 'POST', signal: ac.signal, headers: ghHeaders(), body: JSON.stringify({ model, messages: hist, agent: true, stream: true, studio: { project: S.project }, switches: { search: true, tools: true } }) });
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; let j; try { j = JSON.parse(l); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.log && j.log.kind === 'thought') { if (!thinkNode) thinkNode = say(j.log.text, 'think'); else thinkNode.textContent = j.log.text; live.thought(j.log.text); }   // live: one line that updates while the model thinks
          else if (j.log && (j.log.kind === 'action' || j.log.kind === 'error')) { thinkNode = null; say(j.log.text, j.log.kind === 'error' ? 'err' : 'act'); }
          else if (j.toolStart) { fxOpen++; const ts = toolStatus(j.toolStart); openTools.push(ts); live.start(ts); fx.working(ts); }   // the AI just started a tool: light up the editor and name the file
          else if (j.tool) { thinkNode = null; live.finish(openTools.shift() || toolStatus(j.tool)); say(toolLine(j.tool), 'tool'); if (fxOpen > 0) { fxOpen--; fx.idle(); } loadActivity(); }   // it finished: the strip fades, the changed lines flash when they arrive
          else if (j.sources) { if (!srcCard) { srcCard = sourcesCard([]); el.stAiLog.appendChild(srcCard.el); } srcCard.update(j.sources); el.stAiLog.scrollTop = 1e9; }
          else if (j.maxUsage) { if (env.onMaxUsage) { try { env.onMaxUsage(j.maxUsage); } catch {} } }   // Agent Max day / month numbers: the counters must move in Studio too
          else if (j.studio) refreshSoon();
          else if (j.approve) approve(j.approve);
          else if (j.message && j.message.content) { reply += j.message.content; if (!node) node = say('', 'ai'); node.textContent = reply; el.stAiLog.scrollTop = 1e9; }
        }
      }
      // Keep only the plain answer in the memory of this chat: the model's own <think> notes and chit-chat make a small model repeat itself.
      const kept = reply.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<\/?think>/g, '').trim();
      if (kept) hist.push({ role: 'assistant', content: kept.slice(0, 1200) }); else hist.pop();
    } catch (e) { if (e.name !== 'AbortError') say(e.message || 'Something went wrong.', 'err'); else say('Stopped.', 'warn'); }
    finally { live.end(); while (fxOpen > 0) { fxOpen--; fx.idle(); } S.busy = false; S.stopper = null; el.stSend.textContent = 'Send'; el.stAddFile.disabled = !S.project; el.stNewScript.disabled = !S.project; fxShow = true; try { await refreshFromServer(); } finally { fxShow = false; } }
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

  return { isBusy: () => !!(S.busy || S.dirty.size || (el.stAsk && el.stAsk.value.trim())), open: async () => { try { await loadProjects(localStorage.getItem('pholama_studio_proj') || undefined); await loadActivity(); } catch (e) { say('Studio could not start: ' + e.message, 'err'); if (/still the old version/.test(e.message)) { const b = document.createElement('button'); b.textContent = 'Restart Pholama now'; b.className = 'st-restart'; b.onclick = () => window.restartPholama && window.restartPholama(b); el.stAiLog.appendChild(b); } } }, state: S, ask, refreshFromServer };
}
