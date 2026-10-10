// Pholama Studio, the website Cloud Studio client.
// Provider credentials stay in the backend environment. The browser only calls the proxy.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (label, fn, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };

function endpoint(cfg) { return String((cfg && cfg.CLOUD_STUDIO_URL) || '').replace(/\/+$/, ''); }
function selectedPreview(p) {
  if (!p) return '';
  const field = p.developmentUrlFieldToUse;
  return field === 'cachedDevelopmentUrl' ? (p.cachedDevelopmentUrl || '') : (p.temporalDevelopmentProjectUrl || p.cachedDevelopmentUrl || '');
}
function messageText(e) { return String(e && (e.errorMessage || e.message) || e || 'Something went wrong.'); }

export function mountCloudStudio(host, { Account, cfg = () => ({}), now = () => Date.now(), setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}) {
  host.textContent = '';
  const root = el('div', 'cloudstudio');
  const head = el('div', 'cloudstudio-head');
  const title = el('div'); title.append(el('h2', null, 'Pholama Studio'), el('p', 'dmut', 'Build and preview websites with Pholama AI. This is separate from the PC Studio.'));
  const credits = el('div', 'cloudstudio-credits', 'Studio credits: loading…');
  const refresh = button('Refresh', () => loadProjects(), 'cloudstudio-refresh');
  head.append(title, credits, refresh); root.append(head);
  const notice = el('div', 'sys cloudstudio-notice'); root.append(notice);
  const layout = el('div', 'cloudstudio-layout'); const list = el('aside', 'cloudstudio-list'); const main = el('main', 'cloudstudio-main'); layout.append(list, main); root.append(layout); host.append(root);
  let projects = [], active = null, timer = null, busy = false, allowance = { used: 0, cap: 1000 };

  function stopPoll() { if (timer) { ci(timer); timer = null; } }
  function setNotice(text, kind = '') { notice.textContent = text || ''; notice.className = 'sys cloudstudio-notice' + (kind ? ' ' + kind : ''); notice.hidden = !text; }
  async function loadAllowance() { try { allowance = await call('usage'); credits.textContent = `Studio credits: ${Math.max(0, allowance.cap - allowance.used)} left this week`; } catch { credits.textContent = 'Studio credits: unavailable'; } }
  function call(action, body = {}) {
    const base = endpoint(cfg());
    if (!base) return Promise.reject(new Error('Pholama Studio AI is waiting for its secure backend connection.'));
    return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(Account && Account.token() ? { Authorization: 'Bearer ' + Account.token() } : {}) }, body: JSON.stringify({ action, ...body }) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error(messageText(j.errors || j)); return j.data == null ? j : j.data; });
  }
  function emptyMain() { main.textContent = ''; const c = el('section', 'dcard cloudstudio-empty'); c.append(el('h3', null, 'Create your first cloud project'), el('p', 'dmut', 'Describe what you want to build. Pholama Studio will send the prompt to the secure cloud builder when the backend key is configured.')); main.append(c, launchCard()); }
  function launchCard() {
    const c = el('section', 'dcard cloudstudio-form'); c.append(el('h3', null, 'New project'));
    const name = document.createElement('input'); name.placeholder = 'Project name, for example portfolio'; name.maxLength = 80;
    const prompt = document.createElement('textarea'); prompt.rows = 5; prompt.placeholder = 'Build a responsive website for...';
    const out = el('div', 'sys'); const go = button('Launch project', async () => { const label = name.value.trim(); const projectId = label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); if (!projectId || !prompt.value.trim()) { out.textContent = 'Add a project name using letters or numbers, and a build prompt.'; return; } go.disabled = true; out.textContent = 'Starting cloud build...'; try { const p = await call('launch', { projectId, label, prompt: prompt.value.trim() }); active = p.projectId; out.textContent = 'Project launched.'; await loadProjects(); await openProject(active); } catch (e) { out.textContent = messageText(e); } finally { go.disabled = false; } }, 'p');
    c.append(name, prompt, go, out); return c;
  }
  function paintList() {
    list.textContent = ''; list.append(el('div', 'cloudstudio-list-head', 'Your projects'));
    if (!projects.length) { list.append(el('p', 'dmut', 'No cloud projects yet.')); return; }
    for (const p of projects) { const b = button(p.label || p.projectId || p.id || 'Untitled', () => openProject(p.projectId || p.id), 'cloudstudio-project'); b.classList.toggle('on', (p.projectId || p.id) === active); const meta = el('small', null, p.status || 'Project'); b.append(meta); list.append(b); }
  }
  function projectCard(p) {
    main.textContent = '';
    const top = el('section', 'dcard cloudstudio-project-head');
    const h = el('div'); h.append(el('h2', null, p.label || p.projectId || 'Project'), el('p', 'dmut', p.projectId || ''));
    const deploy = button('Deploy', () => deployProject(p), 'p'); const open = button('Open live view', () => { const u = selectedPreview(p); if (u) window.open(u, '_blank', 'noopener'); }, ''); open.disabled = !selectedPreview(p); top.append(h, open, deploy); main.append(top);
    const status = el('div', 'cloudstudio-status'); status.append(el('b', null, p.agentStatus || p.status || 'Ready')); if (p.agentMessage) status.append(el('span', 'dmut', p.agentMessage)); main.append(status);
    const output = String(p.output || '').replace(/^```html\s*/i, '').replace(/```\s*$/i, '');
    const draftKey = 'pholama-studio-draft:' + String(p.projectId || 'project');
    const saved = localStorage.getItem(draftKey); let source = saved || output;
    const work = el('section', 'dcard cloudstudio-workspace');
    const bar = el('div', 'cloudstudio-workbar'); const mode = el('strong', null, 'Live editor'); const view = el('span', 'dmut', 'Edit code, preview changes instantly, then test the app/game screen.'); bar.append(mode, view); work.append(bar);
    const split = el('div', 'cloudstudio-split');
    const editor = document.createElement('textarea'); editor.className = 'cloudstudio-editor'; editor.spellcheck = false; editor.value = source; editor.setAttribute('aria-label', 'Live project editor');
    const screen = el('div', 'cloudstudio-screen'); const screenTitle = el('div', 'cloudstudio-screen-title', 'App / game test screen'); const frame = document.createElement('iframe'); frame.title = 'Live Pholama Studio app and game test screen'; frame.sandbox = 'allow-scripts'; frame.srcdoc = source; screen.append(screenTitle, frame); split.append(editor, screen); work.append(split);
    const actions = el('div', 'cloudstudio-editor-actions'); const save = button('Save local draft', () => { localStorage.setItem(draftKey, editor.value); setNotice('Draft saved on this device.', 'cloudstudio-ok'); }, ''); const reset = button('Reset generated output', () => { editor.value = output; frame.srcdoc = output; localStorage.removeItem(draftKey); }, ''); const test = button('Test app/game screen', () => { frame.focus(); screen.scrollIntoView({ behavior: 'smooth', block: 'center' }); setNotice('Test screen is live. Use the app/game controls inside the preview.', 'cloudstudio-ok'); }, 'p'); actions.append(save, reset, test); work.append(actions); main.append(work);
    editor.addEventListener('input', () => { frame.srcdoc = editor.value; });
    const chat = el('section', 'dcard cloudstudio-chat'); const chatHead = el('div', 'cloudstudio-section-title'); chatHead.append(el('h3', null, 'Pholama Studio chatbot'), el('span', 'dmut', 'Live edit assistant')); chat.append(chatHead);
    const transcript = el('div', 'cloudstudio-transcript'); transcript.append(el('p', 'dmut', 'Ask for a change and the assistant will regenerate the complete project.')); const prompt = document.createElement('textarea'); prompt.rows = 3; prompt.placeholder = 'Add a map, change the game rules, fix the layout...'; const out = el('div', 'sys'); const send = button('Send to Studio AI', async () => { const text = prompt.value.trim(); if (!text) return; send.disabled = true; transcript.append(el('p', 'cloudstudio-user', text)); out.textContent = 'Studio AI is editing the project...'; try { const result = await call('prompt', { projectId: active, prompt: text }); prompt.value = ''; transcript.append(el('p', 'cloudstudio-ai', 'Project updated. Preview refreshed below.')); out.textContent = `Updated. ${result.usage ? Math.max(0, result.usage.cap - result.usage.used) : ''} credits remain this week.`; localStorage.removeItem(draftKey); await loadAllowance(); await openProject(active); } catch (e) { out.textContent = messageText(e); } finally { send.disabled = false; } }, 'p'); chat.append(transcript, prompt, send, out); main.append(chat);
  }
  async function loadProjects() { try { projects = await call('projects'); projects = Array.isArray(projects) ? projects : (projects.projects || []); paintList(); if (!active && projects[0]) active = projects[0].projectId || projects[0].id; if (active) await openProject(active); else emptyMain(); } catch (e) { paintList(); emptyMain(); setNotice(messageText(e), 'cloudstudio-warn'); } }
  async function openProject(id) { if (!id) return; active = id; paintList(); try { const p = await call('project', { projectId: id }); projectCard(p); if (p.agentStatus === 'running' || p.agentStatus === 'init' || p.status === 'building') pollProject(); else stopPoll(); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }
  async function pollProject() { stopPoll(); const started = now(); const tick = async () => { if (now() - started > 2 * 60 * 60 * 1000) { stopPoll(); return; } try { const p = await call('project', { projectId: active }); projectCard(p); if (!['running', 'init', 'building'].includes(p.agentStatus) && p.status !== 'building') stopPoll(); } catch {} }; await tick(); timer = si(tick, 12000); }
  async function deployProject(p) { if (!confirm('Deploy this project to production?')) return; try { await call('deploy', { projectId: p.projectId || active }); setNotice('Deployment started. Refresh the project to see its status.', 'cloudstudio-ok'); await openProject(active); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }
  notice.hidden = true; emptyMain(); loadAllowance(); loadProjects();
  return { refresh: loadProjects, stop: stopPoll };
}
