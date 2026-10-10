// Pholama Studio, the website Studio client (Totalum builder).
// The builder key stays in the backend. The browser only calls the Pholama proxy with the user's login.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (label, fn, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };

function endpoint(cfg) { return String((cfg && (cfg.STUDIO_URL || cfg.CLOUD_STUDIO_URL)) || '').replace(/\/+$/, ''); }
function messageText(e) { return String(e && (e.errorMessage || e.message) || e || 'Something went wrong.'); }
const RUNNING = s => s === 'init' || s === 'running' || s === 'building';

export function mountCloudStudio(host, { Account, cfg = () => ({}), now = () => Date.now(), setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}) {
  host.textContent = '';
  const root = el('div', 'cloudstudio');
  const head = el('div', 'cloudstudio-head');
  const title = el('div'); title.append(el('h2', null, 'Pholama Studio'), el('p', 'dmut', 'Describe a website, app or game. The builder writes it, you watch it live and keep editing.'));
  const credits = el('div', 'cloudstudio-credits', 'Build credits: loading…');
  const refresh = button('Refresh', () => loadProjects(), 'cloudstudio-refresh');
  head.append(title, credits, refresh); root.append(head);
  const notice = el('div', 'sys cloudstudio-notice'); root.append(notice);
  const layout = el('div', 'cloudstudio-layout'); const list = el('aside', 'cloudstudio-list'); const main = el('main', 'cloudstudio-main'); layout.append(list, main); root.append(layout); host.append(root);
  let projects = [], active = null, timer = null, deployTimer = null;

  function stopPoll() { if (timer) { ci(timer); timer = null; } }
  function stopDeployPoll() { if (deployTimer) { ci(deployTimer); deployTimer = null; } }
  function setNotice(text, kind = '') { notice.textContent = text || ''; notice.className = 'sys cloudstudio-notice' + (kind ? ' ' + kind : ''); notice.hidden = !text; }
  function call(action, body = {}) {
    const base = endpoint(cfg());
    if (!base) return Promise.reject(new Error('Pholama Studio is waiting for its secure backend connection.'));
    return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(Account && Account.token() ? { Authorization: 'Bearer ' + Account.token() } : {}) }, body: JSON.stringify({ action, ...body }) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error(messageText(j.errors || j)); return j.data == null ? j : j.data; });
  }
  async function loadCredits() { try { const c = await call('credits'); credits.textContent = 'Build credits: ' + Math.floor(c.credits); credits.title = 'A build or change usually costs 6 to 46 credits.'; } catch { credits.textContent = 'Build credits: unavailable'; } }

  function emptyMain() { main.textContent = ''; const c = el('section', 'dcard cloudstudio-empty'); c.append(el('h3', null, 'Create your first project'), el('p', 'dmut', 'Describe what you want to build. A first build usually takes 5 to 40 minutes, and you can watch the builder work.')); main.append(c, launchCard()); }
  function launchCard() {
    const c = el('section', 'dcard cloudstudio-form'); c.append(el('h3', null, 'New project'));
    const name = document.createElement('input'); name.placeholder = 'Project name, for example portfolio'; name.maxLength = 80;
    const prompt = document.createElement('textarea'); prompt.rows = 5; prompt.placeholder = 'Build a responsive website for...'; prompt.maxLength = 8000;
    const out = el('div', 'sys');
    const go = button('Launch project', async () => {
      const label = name.value.trim();
      if (!label || !prompt.value.trim()) { out.textContent = 'Add a project name and a build prompt.'; return; }
      go.disabled = true; out.textContent = 'Starting the builder...';
      try {
        const p = await call('launch', { label, prompt: prompt.value.trim() });
        active = p.projectId; out.textContent = p.started ? 'Builder started.' : 'Project created. Send the prompt again from the chat to start the build.';
        await loadProjects(); loadCredits();
      } catch (e) { out.textContent = messageText(e); } finally { go.disabled = false; }
    }, 'p');
    c.append(name, prompt, go, out); return c;
  }
  function paintList() {
    list.textContent = ''; list.append(el('div', 'cloudstudio-list-head', 'Your projects'));
    if (!projects.length) { list.append(el('p', 'dmut', 'No projects yet.')); return; }
    for (const p of projects) { const b = button(p.label || p.projectId, () => openProject(p.projectId), 'cloudstudio-project'); b.classList.toggle('on', p.projectId === active); b.append(el('small', null, RUNNING(p.status) ? 'Building…' : p.status === 'done' ? 'Ready' : 'Idle')); list.append(b); }
  }

  // The workspace is built once per project, then only its live parts are updated while the builder runs.
  let ui = null;
  function buildWorkspace(s) {
    main.textContent = ''; ui = {};
    const top = el('section', 'dcard cloudstudio-project-head');
    const h = el('div'); ui.title = el('h2', null, s.label); ui.sub = el('p', 'dmut', ''); h.append(ui.title, ui.sub);
    ui.open = button('Open in new tab', () => { if (ui.url) window.open(ui.url, '_blank', 'noopener'); }, ''); ui.open.disabled = true;
    ui.stop = button('Stop builder', async () => { try { await call('stop', { projectId: active }); setNotice('Stop signal sent.', 'cloudstudio-ok'); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }, '');
    ui.deploy = button('Publish', () => deployProject(), 'p');
    top.append(h, ui.open, ui.stop, ui.deploy); main.append(top);
    ui.status = el('div', 'cloudstudio-status'); main.append(ui.status);

    const work = el('section', 'dcard cloudstudio-workspace');
    const bar = el('div', 'cloudstudio-workbar'); bar.append(el('strong', null, 'Live app / game screen'), el('span', 'dmut', 'This is the real running project. Click, play and test it here.')); work.append(bar);
    ui.frame = document.createElement('iframe'); ui.frame.className = 'cloudstudio-live'; ui.frame.title = 'Live Pholama Studio project'; ui.frame.allow = 'fullscreen; gamepad; autoplay'; ui.frame.referrerPolicy = 'no-referrer'; ui.frame.hidden = true;
    ui.wait = el('div', 'cloudstudio-wait', 'The builder is still creating your first version. The live screen appears here as soon as it is ready.');
    work.append(ui.wait, ui.frame); main.append(work);

    const chat = el('section', 'dcard cloudstudio-chat'); const chatHead = el('div', 'cloudstudio-section-title'); chatHead.append(el('h3', null, 'Studio chatbot'), el('span', 'dmut', 'Live builder messages'));
    ui.transcript = el('div', 'cloudstudio-transcript');
    ui.prompt = document.createElement('textarea'); ui.prompt.rows = 3; ui.prompt.maxLength = 8000; ui.prompt.placeholder = 'Ask for a change: add a map, fix the game rules, change the colors...';
    ui.out = el('div', 'sys');
    ui.send = button('Send to builder', async () => {
      const text = ui.prompt.value.trim(); if (!text) return;
      ui.send.disabled = true; ui.out.textContent = 'Sending...';
      try { await call('prompt', { projectId: active, prompt: text }); ui.transcript.append(el('p', 'cloudstudio-user', text)); ui.prompt.value = ''; ui.out.textContent = 'The builder is on it.'; loadCredits(); pollProject(); }
      catch (e) { ui.out.textContent = messageText(e); } finally { ui.send.disabled = false; }
    }, 'p');
    chat.append(chatHead, ui.transcript, ui.prompt, ui.send, ui.out); main.append(chat);

    ui.versions = el('section', 'dcard cloudstudio-versions'); main.append(ui.versions);
    loadVersions();
  }
  function paint(s) {
    if (!ui || ui.pid !== s.projectId) { buildWorkspace(s); ui.pid = s.projectId; }
    const running = RUNNING(s.status);
    ui.title.textContent = s.label; ui.sub.textContent = s.projectId;
    ui.stop.hidden = !running; ui.deploy.disabled = running || !s.previewUrl;
    ui.status.textContent = ''; ui.status.append(el('b', null, running ? 'Builder working…' : s.done ? 'Ready' : 'Idle'));
    if (running && s.expectedMinutes) ui.status.append(el('span', 'dmut', 'About ' + s.expectedMinutes + ' min'));
    if (!running && s.creditsSpent != null) ui.status.append(el('span', 'dmut', 'Last run used ' + Number(s.creditsSpent).toFixed(1) + ' credits'));
    if (s.deployment === 'success' && s.productionUrl) { const a = el('a', null, 'Published site'); a.href = s.productionUrl; a.target = '_blank'; a.rel = 'noopener'; ui.status.append(a); }
    // Re-read the preview URL every time (it can change after a run).
    if (s.previewUrl) { ui.url = s.previewUrl; ui.open.disabled = false; ui.wait.hidden = true; ui.frame.hidden = false; if (ui.frame.src !== s.previewUrl) ui.frame.src = s.previewUrl; } else { ui.url = ''; ui.open.disabled = true; ui.wait.hidden = false; ui.frame.hidden = true; }
    ui.transcript.querySelectorAll('.cloudstudio-ai').forEach(n => n.remove());
    for (const m of s.messages) ui.transcript.append(el('p', 'cloudstudio-ai' + (m.type === 'error' || m.type === 'limit-reached' ? ' cloudstudio-bad' : ''), m.text));
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }
  async function loadVersions() {
    if (!ui) return; ui.versions.textContent = ''; const hd = el('div', 'cloudstudio-section-title'); hd.append(el('h3', null, 'Version history')); ui.versions.append(hd);
    try {
      const v = await call('versions', { projectId: active });
      if (!v.length) { ui.versions.append(el('p', 'dmut', 'Versions appear after the first build.')); return; }
      for (const x of v) { const row = el('div', 'cloudstudio-version'); row.append(el('span', null, x.name + (x.createdAt ? ' · ' + new Date(x.createdAt).toLocaleString() : '')), button('Restore', async () => { if (!confirm('Restore this version? The current version is replaced.')) return; try { await call('recover', { versionId: x.id, projectId: active }); setNotice('Restoring. This takes 1 to 4 minutes.', 'cloudstudio-ok'); loadCredits(); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }, '')); ui.versions.append(row); }
    } catch { ui.versions.append(el('p', 'dmut', 'Version history is unavailable right now.')); }
  }

  async function loadProjects() {
    try { projects = await call('projects'); if (!Array.isArray(projects)) projects = []; paintList(); if (!active && projects[0]) active = projects[0].projectId; if (active && projects.some(p => p.projectId === active)) await openProject(active); else { active = null; emptyMain(); } setNotice(''); loadCredits(); }
    catch (e) { paintList(); emptyMain(); setNotice(messageText(e), 'cloudstudio-warn'); }
  }
  async function openProject(id) {
    if (!id) return; active = id; ui = null; paintList(); stopPoll();
    try { const s = await call('status', { projectId: id }); paint(s); if (RUNNING(s.status)) pollProject(); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); }
  }
  // Poll every 12s while the builder runs, and re-read the preview when it finishes.
  async function pollProject() {
    stopPoll(); const started = now();
    const tick = async () => {
      if (now() - started > 2 * 60 * 60 * 1000) { stopPoll(); return; }
      try { const s = await call('status', { projectId: active }); paint(s); if (!RUNNING(s.status)) { stopPoll(); loadCredits(); loadVersions(); } } catch {}
    };
    await tick(); if (timer === null) timer = si(tick, 12000);
  }
  async function deployProject() {
    if (!confirm('Publish this project to a public address?')) return;
    try {
      await call('deploy', { projectId: active }); setNotice('Publishing. This takes 2 to 5 minutes.', 'cloudstudio-ok'); stopDeployPoll();
      deployTimer = si(async () => { try { const d = await call('deploystatus', { projectId: active }); if (d.status === 'success') { stopDeployPoll(); setNotice('Published: ' + (d.url || ''), 'cloudstudio-ok'); const s = await call('status', { projectId: active }); paint(s); } else if (d.status === 'error') { stopDeployPoll(); setNotice('Publishing failed. Try again.', 'cloudstudio-warn'); } } catch {} }, 12000);
    } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); }
  }
  notice.hidden = true; emptyMain(); loadCredits(); loadProjects();
  return { refresh: loadProjects, stop() { stopPoll(); stopDeployPoll(); } };
}
