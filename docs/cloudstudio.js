// Pholama Studio, the website Cloud Studio client.
// The browser never receives the Totalum API key. It talks to the configured backend proxy.
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
  const title = el('div'); title.append(el('h2', null, 'Pholama Studio'), el('p', 'dmut', 'Build and publish websites in the cloud. This is separate from the PC Studio.'));
  const refresh = button('Refresh', () => loadProjects(), 'cloudstudio-refresh');
  head.append(title, refresh); root.append(head);
  const notice = el('div', 'sys cloudstudio-notice'); root.append(notice);
  const layout = el('div', 'cloudstudio-layout'); const list = el('aside', 'cloudstudio-list'); const main = el('main', 'cloudstudio-main'); layout.append(list, main); root.append(layout); host.append(root);
  let projects = [], active = null, timer = null, busy = false;

  function stopPoll() { if (timer) { ci(timer); timer = null; } }
  function setNotice(text, kind = '') { notice.textContent = text || ''; notice.className = 'sys cloudstudio-notice' + (kind ? ' ' + kind : ''); notice.hidden = !text; }
  function call(action, body = {}) {
    const base = endpoint(cfg());
    if (!base) return Promise.reject(new Error('Cloud Studio is waiting for its secure backend connection.'));
    return fetch(base + '/' + encodeURIComponent(action), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(Account && Account.token() ? { Authorization: 'Bearer ' + Account.token() } : {}) }, body: JSON.stringify(body) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error(messageText(j.errors || j)); return j.data == null ? j : j.data; });
  }
  function emptyMain() { main.textContent = ''; const c = el('section', 'dcard cloudstudio-empty'); c.append(el('h3', null, 'Create your first cloud project'), el('p', 'dmut', 'Describe what you want to build. Pholama Studio will send the prompt to the secure cloud builder when the backend key is configured.')); main.append(c, launchCard()); }
  function launchCard() {
    const c = el('section', 'dcard cloudstudio-form'); c.append(el('h3', null, 'New project'));
    const name = document.createElement('input'); name.placeholder = 'Project name, for example portfolio'; name.maxLength = 80;
    const prompt = document.createElement('textarea'); prompt.rows = 5; prompt.placeholder = 'Build a responsive website for...';
    const out = el('div', 'sys'); const go = button('Launch project', async () => { if (!name.value.trim() || !prompt.value.trim()) { out.textContent = 'Add a project name and a build prompt.'; return; } go.disabled = true; out.textContent = 'Starting cloud build...'; try { const p = await call('launch', { projectId: name.value.trim(), label: name.value.trim(), prompt: prompt.value.trim() }); active = p.projectId; out.textContent = p.agent && p.agent.started === false ? 'Project created. The first build needs a retry.' : 'Project launched.'; await loadProjects(); await openProject(active); } catch (e) { out.textContent = messageText(e); } finally { go.disabled = false; } }, 'p');
    c.append(name, prompt, go, out); return c;
  }
  function paintList() {
    list.textContent = ''; list.append(el('div', 'cloudstudio-list-head', 'Your projects'));
    if (!projects.length) { list.append(el('p', 'dmut', 'No cloud projects yet.')); return; }
    for (const p of projects) { const b = button(p.label || p.projectId || p.id || 'Untitled', () => openProject(p.projectId || p.id), 'cloudstudio-project'); b.classList.toggle('on', (p.projectId || p.id) === active); const meta = el('small', null, p.status || 'Project'); b.append(meta); list.append(b); }
  }
  function projectCard(p) {
    main.textContent = ''; const top = el('section', 'dcard cloudstudio-project-head');
    const h = el('div'); h.append(el('h2', null, p.label || p.projectId || 'Project'), el('p', 'dmut', p.projectId || ''));
    const deploy = button('Deploy', () => deployProject(p), 'p'); const open = button('Open preview', () => { const u = selectedPreview(p); if (u) window.open(u, '_blank', 'noopener'); }, ''); open.disabled = !selectedPreview(p); top.append(h, open, deploy); main.append(top);
    const status = el('div', 'cloudstudio-status'); status.append(el('b', null, p.agentStatus || p.status || 'Ready')); if (p.agentMessage) status.append(el('span', 'dmut', p.agentMessage)); main.append(status);
    const preview = selectedPreview(p); if (preview) { const frame = el('section', 'dcard cloudstudio-preview'); const ph = el('div', 'cloudstudio-section-title'); ph.append(el('h3', null, 'Live preview'), button('Open in new tab', () => window.open(preview, '_blank', 'noopener'))); const iframe = document.createElement('iframe'); iframe.src = preview; iframe.title = 'Cloud project preview'; iframe.loading = 'lazy'; frame.append(ph, iframe); main.append(frame); }
    const form = el('section', 'dcard cloudstudio-form'); form.append(el('h3', null, 'Continue building')); const prompt = document.createElement('textarea'); prompt.rows = 4; prompt.placeholder = 'Add a change or improvement...'; const out = el('div', 'sys'); const send = button('Send prompt', async () => { if (!prompt.value.trim()) return; send.disabled = true; out.textContent = 'Sending prompt...'; try { await call('prompt', { projectId: active, prompt: prompt.value.trim() }); prompt.value = ''; out.textContent = 'Prompt sent. Studio will refresh when the run finishes.'; pollProject(); } catch (e) { out.textContent = messageText(e); } finally { send.disabled = false; } }, 'p'); form.append(prompt, send, out); main.append(form);
  }
  async function loadProjects() { try { projects = await call('projects'); projects = Array.isArray(projects) ? projects : (projects.projects || []); paintList(); if (!active && projects[0]) active = projects[0].projectId || projects[0].id; if (active) await openProject(active); else emptyMain(); } catch (e) { paintList(); emptyMain(); setNotice(messageText(e), 'cloudstudio-warn'); } }
  async function openProject(id) { if (!id) return; active = id; paintList(); try { const p = await call('project', { projectId: id }); projectCard(p); if (p.agentStatus === 'running' || p.agentStatus === 'init' || p.status === 'building') pollProject(); else stopPoll(); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }
  async function pollProject() { stopPoll(); const started = now(); const tick = async () => { if (now() - started > 2 * 60 * 60 * 1000) { stopPoll(); return; } try { const p = await call('project', { projectId: active }); projectCard(p); if (!['running', 'init', 'building'].includes(p.agentStatus) && p.status !== 'building') stopPoll(); } catch {} }; await tick(); timer = si(tick, 12000); }
  async function deployProject(p) { if (!confirm('Deploy this project to production?')) return; try { await call('deploy', { projectId: p.projectId || active }); setNotice('Deployment started. Refresh the project to see its status.', 'cloudstudio-ok'); await openProject(active); } catch (e) { setNotice(messageText(e), 'cloudstudio-warn'); } }
  notice.hidden = true; emptyMain(); loadProjects();
  return { refresh: loadProjects, stop: stopPoll };
}
