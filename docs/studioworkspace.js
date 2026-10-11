// Pholama Studio Workspace Module
// Prompt-driven autonomous workspace view for PC web app.

// Pure exported helpers
export function fmtMs(ms) {
  if (ms == null || isNaN(ms)) return '0ms';
  const n = Number(ms);
  if (n < 1000) return Math.round(n) + 'ms';
  return (n / 1000).toFixed(1) + 's';
}

export function stepStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'passed' || s === 'ok') return 'ws-status-completed';
  if (s === 'running') return 'ws-status-running';
  if (s === 'failed' || s === 'error') return 'ws-status-failed';
  if (s === 'cancelled' || s === 'canceled') return 'ws-status-cancelled';
  if (s === 'waiting' || s === 'waiting-for-approval') return 'ws-status-waiting';
  if (s === 'skipped') return 'ws-status-skipped';
  return 'ws-status-pending';
}

export function stageSummary(run) {
  if (!run || !Array.isArray(run.stages)) {
    return { total: 0, completed: 0, failed: 0, running: 0, skipped: 0, pending: 0, current: run ? (run.stage || '') : '' };
  }
  let completed = 0, failed = 0, running = 0, skipped = 0, pending = 0;
  for (const s of run.stages) {
    const st = String(s.status || '').toLowerCase();
    if (st === 'completed') completed++;
    else if (st === 'failed') failed++;
    else if (st === 'running') running++;
    else if (st === 'skipped') skipped++;
    else pending++;
  }
  const activeStage = run.stages.find(s => s.status === 'running') || run.stages.find(s => s.status === 'pending') || null;
  return {
    total: run.stages.length,
    completed,
    failed,
    running,
    skipped,
    pending,
    current: activeStage ? activeStage.id : (run.stage || '')
  };
}

export function filterEntries(entries, { q, failedOnly } = {}) {
  if (!Array.isArray(entries)) return [];
  const searchQ = String(q || '').trim().toLowerCase();
  return entries.filter(item => {
    if (!item) return false;
    if (failedOnly) {
      const st = String(item.status || item.severity || item.ok || '').toLowerCase();
      const isFailed = st === 'failed' || st === 'error' || item.failed === true || item.ok === false || !!item.error;
      if (!isFailed) return false;
    }
    if (searchQ) {
      const fields = [
        item.title, item.tool, item.kind, item.input, item.output,
        item.status, item.file, item.message, item.error, item.note,
        item.text, item.cmd, item.source, item.stage
      ];
      const match = fields.some(f => f != null && String(f).toLowerCase().includes(searchQ));
      if (!match) return false;
    }
    return true;
  });
}

export function buildTree(files, dirs) {
  const root = { name: '', type: 'dir', path: '', children: [] };
  const dirMap = new Map([['', root]]);

  function ensureDir(dirPath) {
    if (!dirPath) return root;
    if (dirMap.has(dirPath)) return dirMap.get(dirPath);
    const parts = dirPath.split('/').filter(Boolean);
    let currPath = '';
    let parent = root;
    for (const part of parts) {
      currPath = currPath ? `${currPath}/${part}` : part;
      if (!dirMap.has(currPath)) {
        const node = { name: part, type: 'dir', path: currPath, children: [] };
        dirMap.set(currPath, node);
        parent.children.push(node);
      }
      parent = dirMap.get(currPath);
    }
    return parent;
  }

  if (Array.isArray(dirs)) {
    for (const d of dirs) {
      const dirPath = typeof d === 'string' ? d : (d && d.name);
      if (dirPath) ensureDir(dirPath.replace(/\/+$/, ''));
    }
  }

  if (Array.isArray(files)) {
    for (const f of files) {
      const name = typeof f === 'string' ? f : (f && f.name);
      if (!name) continue;
      const parts = name.split('/').filter(Boolean);
      const fileName = parts.pop();
      const dirPath = parts.join('/');
      const parent = ensureDir(dirPath);
      const fileNode = {
        name: fileName,
        type: 'file',
        path: name,
        size: typeof f === 'object' && f ? f.size : undefined,
        content: typeof f === 'object' && f ? f.content : undefined
      };
      if (!parent.children.some(c => c.path === name)) {
        parent.children.push(fileNode);
      }
    }
  }

  function sortNodes(node) {
    if (node.children && node.children.length) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) {
        if (child.type === 'dir') sortNodes(child);
      }
    }
  }

  sortNodes(root);
  return root.children;
}

// Safe DOM Builder
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k === 'hidden') node.hidden = !!v;
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child == null) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  }
  return node;
}

const STAGES = ['understand', 'inspect', 'plan', 'execute', 'verify', 'repair', 'report'];

export function createWorkspace(host, env) {
  const S = {
    capabilities: null,
    dashboard: [],
    projects: [],
    selectedProject: '',
    runs: [],
    currentRun: null,
    diff: null,
    activeTab: 'activity',
    tabFilter: { q: '', failedOnly: false },
    diffViewMode: 'unified',
    tree: [],
    projectFiles: [],
    openFile: null,
    evtSource: null,
    pollTimer: null,
    resolveAsk: null,
    leftWidth: 320,
    bottomHeight: 260
  };

  // Restore splitter sizes from localStorage
  try {
    const savedH = localStorage.getItem('pholama_ws_split_h');
    if (savedH) S.leftWidth = Math.max(200, Math.min(600, parseInt(savedH, 10)));
    const savedV = localStorage.getItem('pholama_ws_split_v');
    if (savedV) S.bottomHeight = Math.max(120, Math.min(600, parseInt(savedV, 10)));
  } catch {}

  async function req(path, opts = {}) {
    const p = path.startsWith('/') ? path.slice(1) : path;
    const fullPath = p.startsWith('api/') ? p : `api/studio/ws/${p}`;
    if (typeof env.api === 'function') {
      return env.api(fullPath, opts);
    }
    return fetch(`/${fullPath}`, opts);
  }

  async function reqJson(path, opts = {}) {
    const res = await req(path, opts);
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.error) err = j.error;
      } catch {}
      throw new Error(err);
    }
    return res.json();
  }

  function stopStream() {
    if (S.evtSource) { S.evtSource.close(); S.evtSource = null; }
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
  }

  function startStream(runId) {
    stopStream();
    const sseUrl = `/api/studio/ws/runs/${encodeURIComponent(runId)}/stream`;
    let fallbackStarted = false;

    const startPolling = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      if (S.evtSource) { S.evtSource.close(); S.evtSource = null; }
      S.pollTimer = setInterval(async () => {
        try {
          const data = await reqJson(`runs/${encodeURIComponent(runId)}`);
          if (data && data.run) {
            S.currentRun = data.run;
            renderRunDetails();
            if (['completed', 'failed', 'cancelled'].includes(data.run.status)) {
              stopStream();
              refreshDiff();
              refreshProjectTree();
            }
          }
        } catch (e) {
          console.warn('Poll error:', e);
        }
      }, 1500);
    };

    if (env.noStream) { startPolling(); return; }   // the website cannot send a login with a stream, so it polls (each poll also moves the run forward)
    try {
      S.evtSource = new EventSource(sseUrl);
      S.evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.type === 'run' && data.run) {
            S.currentRun = data.run;
            renderRunDetails();
            if (data.final || ['completed', 'failed', 'cancelled'].includes(data.run.status)) {
              stopStream();
              refreshDiff();
              refreshProjectTree();
            }
          }
        } catch (err) {
          console.warn('SSE parse error:', err);
        }
      };
      S.evtSource.onerror = () => {
        startPolling();
      };
    } catch {
      startPolling();
    }
  }

  // UI Elements
  let topEl, mainEl, leftEl, centreWrapEl, centreEl, bottomEl, splitHEl, splitVEl;
  let promptEl, projSelEl, newProjInputEl, modelSelEl, modeSelEl, modeNoteEl, attachmentsEl, startBtnEl, resolveAskEl;
  let dashCardsEl, taskHistEl, searchInputEl, searchHitsEl, treeContainerEl, newFileBtn, newFolderBtn, editorAreaEl, editorSaveBtn, editorTitleEl;
  let stageBarEl, planContainerEl, stepsTimelineEl, changesDiffEl, reportCardEl;
  let tabHeaderEl, tabControlsEl, tabContentEl, tabSearchEl, tabFilterFailedEl, tabCopyBtn;

  function buildShell() {
    host.replaceChildren();

    // Top Controls
    promptEl = el('textarea', { className: 'ws-prompt', placeholder: 'Describe what you want to build or change...' });
    projSelEl = el('select', { className: 'ws-select', title: 'Project' });
    newProjInputEl = el('input', { type: 'text', className: 'ws-input', placeholder: 'New project name...', hidden: true });
    modelSelEl = el('select', { className: 'ws-select', title: 'Model' });
    modeSelEl = el('select', { className: 'ws-select', title: 'Mode' });
    modeNoteEl = el('span', { className: 'ws-mode-note' });
    attachmentsEl = el('input', { type: 'text', className: 'ws-input', placeholder: 'Attachments (e.g. index.html)' });
    startBtnEl = el('button', { className: 'ws-btn ws-btn-primary', textContent: 'Start building', onclick: handleStartBuilding });
    resolveAskEl = el('div', { className: 'ws-section', hidden: true });

    modeSelEl.onchange = () => {
      const modeId = modeSelEl.value;
      const mObj = S.capabilities && S.capabilities.modes ? S.capabilities.modes.find(m => m.id === modeId) : null;
      modeNoteEl.textContent = mObj ? mObj.note || '' : '';
    };

    projSelEl.onchange = () => {
      if (projSelEl.value === '__new__') {
        newProjInputEl.hidden = false;
      } else {
        newProjInputEl.hidden = true;
        S.selectedProject = projSelEl.value;
        onProjectChanged();
      }
    };

    topEl = el('div', { className: 'ws-top' }, [
      el('div', { className: 'ws-prompt-row' }, [promptEl]),
      el('div', { className: 'ws-controls-row' }, [
        el('label', { textContent: 'Project: ' }, [projSelEl, newProjInputEl]),
        el('label', { textContent: 'Model: ' }, [modelSelEl]),
        el('label', { textContent: 'Mode: ' }, [modeSelEl, modeNoteEl]),
        el('label', { textContent: 'Files: ' }, [attachmentsEl]),
        startBtnEl
      ]),
      resolveAskEl
    ]);

    // Left Panel
    dashCardsEl = el('div', { className: 'ws-section' }, [el('div', { className: 'ws-section-title', textContent: 'Dashboard Projects' })]);
    taskHistEl = el('div', { className: 'ws-section' }, [el('div', { className: 'ws-section-title', textContent: 'Task History' })]);
    
    searchInputEl = el('input', { type: 'text', className: 'ws-input', placeholder: 'Search in project...' });
    searchHitsEl = el('div', { className: 'ws-tree-children' });
    searchInputEl.oninput = debounceSearch;

    newFileBtn = el('button', { className: 'ws-btn', textContent: '+ File', onclick: handleNewFile });
    newFolderBtn = el('button', { className: 'ws-btn', textContent: '+ Folder', onclick: handleNewFolder });
    treeContainerEl = el('div', { className: 'ws-tree-children' });

    editorTitleEl = el('div', { style: { fontWeight: '600', fontSize: '13px' }, textContent: 'Editor' });
    editorAreaEl = el('textarea', { className: 'ws-prompt', style: { minHeight: '120px', fontFamily: 'monospace' } });
    editorSaveBtn = el('button', { className: 'ws-btn ws-btn-primary', textContent: 'Save File', onclick: handleSaveFile, disabled: true });

    const explorerSection = el('div', { className: 'ws-section' }, [
      el('div', { className: 'ws-section-title' }, [
        el('span', { textContent: 'File Explorer' }),
        el('div', { style: { display: 'flex', gap: '4px' } }, [newFileBtn, newFolderBtn])
      ]),
      searchInputEl,
      searchHitsEl,
      treeContainerEl,
      el('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' } }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [editorTitleEl, editorSaveBtn]),
        editorAreaEl
      ])
    ]);

    leftEl = el('div', { className: 'ws-left', style: { width: S.leftWidth + 'px' } }, [
      dashCardsEl,
      taskHistEl,
      explorerSection
    ]);

    // Splitter Horizontal
    splitHEl = el('div', { className: 'ws-split-h', onpointerdown: onSplitHDown });

    // Centre Panel
    stageBarEl = el('div', { className: 'ws-stage-bar' });
    planContainerEl = el('div', { className: 'ws-section' });
    stepsTimelineEl = el('div', { className: 'ws-section' });
    changesDiffEl = el('div', { className: 'ws-section' });
    reportCardEl = el('div', { className: 'ws-section' });

    centreEl = el('div', { className: 'ws-centre' }, [
      stageBarEl,
      planContainerEl,
      stepsTimelineEl,
      changesDiffEl,
      reportCardEl
    ]);

    // Splitter Vertical
    splitVEl = el('div', { className: 'ws-split-v', onpointerdown: onSplitVDown });

    // Bottom Panel Tabs
    const tabNames = [
      { id: 'activity', label: 'Agent Activity' },
      { id: 'tools', label: 'Tool Logs' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'problems', label: 'Problems' },
      { id: 'tests', label: 'Tests' }
    ];

    tabHeaderEl = el('div', { className: 'ws-bottom-tabs' }, tabNames.map(t =>
      el('button', {
        className: 'ws-tab-btn' + (S.activeTab === t.id ? ' active' : ''),
        textContent: t.label,
        onclick: () => { S.activeTab = t.id; renderBottomTab(); }
      })
    ));

    tabSearchEl = el('input', { type: 'text', className: 'ws-input', placeholder: 'Filter tab content...', style: { width: '180px' } });
    tabSearchEl.oninput = () => { S.tabFilter.q = tabSearchEl.value; renderBottomTabContent(); };

    tabFilterFailedEl = el('button', {
      className: 'ws-btn',
      textContent: 'All / Failed',
      onclick: () => { S.tabFilter.failedOnly = !S.tabFilter.failedOnly; renderBottomTabContent(); }
    });

    tabCopyBtn = el('button', { className: 'ws-btn', textContent: 'Copy', onclick: handleCopyTabContent });

    tabControlsEl = el('div', { className: 'ws-tab-controls' }, [
      tabSearchEl,
      tabFilterFailedEl,
      tabCopyBtn
    ]);

    tabContentEl = el('div', { className: 'ws-tab-content' });

    bottomEl = el('div', { className: 'ws-bottom', style: { height: S.bottomHeight + 'px' } }, [
      tabHeaderEl,
      tabControlsEl,
      tabContentEl
    ]);

    centreWrapEl = el('div', { className: 'ws-centre-wrap' }, [
      centreEl,
      splitVEl,
      bottomEl
    ]);

    mainEl = el('div', { className: 'ws-main' }, [
      leftEl,
      splitHEl,
      centreWrapEl
    ]);

    host.append(topEl, mainEl);
  }

  // Drag Splitter Handlers
  function onSplitHDown(e) {
    e.preventDefault();
    splitHEl.classList.add('dragging');
    splitHEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = leftEl.getBoundingClientRect().width;

    function onMove(ev) {
      const newW = Math.max(200, Math.min(600, startW + (ev.clientX - startX)));
      leftEl.style.width = newW + 'px';
      S.leftWidth = newW;
      try { localStorage.setItem('pholama_ws_split_h', String(newW)); } catch {}
    }

    function onUp(ev) {
      splitHEl.classList.remove('dragging');
      splitHEl.releasePointerCapture(ev.pointerId);
      splitHEl.onpointermove = null;
      splitHEl.onpointerup = null;
    }

    splitHEl.onpointermove = onMove;
    splitHEl.onpointerup = onUp;
  }

  function onSplitVDown(e) {
    e.preventDefault();
    splitVEl.classList.add('dragging');
    splitVEl.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = bottomEl.getBoundingClientRect().height;

    function onMove(ev) {
      const newH = Math.max(120, Math.min(600, startH - (ev.clientY - startY)));
      bottomEl.style.height = newH + 'px';
      S.bottomHeight = newH;
      try { localStorage.setItem('pholama_ws_split_v', String(newH)); } catch {}
    }

    function onUp(ev) {
      splitVEl.classList.remove('dragging');
      splitVEl.releasePointerCapture(ev.pointerId);
      splitVEl.onpointermove = null;
      splitVEl.onpointerup = null;
    }

    splitVEl.onpointermove = onMove;
    splitVEl.onpointerup = onUp;
  }

  // Actions & Event Handlers
  async function handleStartBuilding() {
    const promptText = promptEl.value.trim();
    if (!promptText) return alert('Please enter a prompt first.');

    let proj = projSelEl.value;
    if (proj === '__new__') {
      proj = newProjInputEl.value.trim();
      if (!proj) return alert('Please enter a new project name.');
    }

    // If no project specified or if prompt asks to edit older projects and no project chosen
    if (!proj) {
      try {
        const res = await reqJson('resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: promptText }) });
        if (res.status === 'ask') {
          showResolveAsk(res);
          return;
        } else if (res.status === 'found' && res.project) {
          proj = res.project;
          S.selectedProject = proj;
        } else {
          proj = 'my-project';
        }
      } catch {
        proj = 'my-project';
      }
    }

    const mode = modeSelEl.value || 'build';
    const model = modelSelEl.value || '';
    const attStr = attachmentsEl.value.trim();
    const attachments = attStr ? attStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    startBtnEl.disabled = true;
    startBtnEl.textContent = 'Starting...';

    try {
      const res = await reqJson('runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, project: proj, mode, model, attachments })
      });
      if (res && res.id) {
        S.selectedProject = proj;
        projSelEl.value = proj;
        newProjInputEl.hidden = true;
        promptEl.value = '';
        startStream(res.id);
        refreshDashboard();
      }
    } catch (e) {
      alert('Could not start run: ' + e.message);
    } finally {
      startBtnEl.disabled = false;
      startBtnEl.textContent = 'Start building';
    }
  }

  function showResolveAsk(res) {
    resolveAskEl.hidden = false;
    resolveAskEl.replaceChildren();
    const msg = el('b', { textContent: res.message || 'Which project should I open?' });
    const btnRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } });
    for (const name of (res.projects || [])) {
      btnRow.append(el('button', {
        className: 'ws-btn ws-btn-primary',
        textContent: name,
        onclick: () => {
          resolveAskEl.hidden = true;
          S.selectedProject = name;
          projSelEl.value = name;
          handleStartBuilding();
        }
      }));
    }
    const cancelBtn = el('button', { className: 'ws-btn', textContent: 'Cancel', onclick: () => { resolveAskEl.hidden = true; } });
    btnRow.append(cancelBtn);
    resolveAskEl.append(msg, btnRow);
  }

  async function onProjectChanged() {
    refreshTaskHistory();
    refreshProjectTree();
  }

  async function refreshDashboard() {
    try {
      const dash = await reqJson('dashboard');
      S.dashboard = dash.projects || [];
      renderDashboardCards();
    } catch (e) {
      console.warn('Failed to load dashboard:', e);
    }
  }

  function renderDashboardCards() {
    dashCardsEl.replaceChildren(el('div', { className: 'ws-section-title', textContent: 'Dashboard Projects' }));
    for (const p of S.dashboard) {
      const lastRunStatus = p.lastRun ? p.lastRun.status : 'no runs';
      const card = el('div', { className: 'ws-card' }, [
        el('div', { className: 'ws-card-head' }, [
          el('span', { textContent: p.name }),
          el('span', { className: stepStatusClass(lastRunStatus), textContent: lastRunStatus })
        ]),
        el('div', { className: 'ws-card-body' }, [
          el('span', { textContent: `${p.files ? p.files.length : 0} files · ${p.checkpoints || 0} checkpoints` }),
          p.lastChange ? el('span', { textContent: `Last change: ${p.lastChange.label}` }) : null
        ]),
        el('button', {
          className: 'ws-btn',
          textContent: 'Select Project',
          onclick: () => {
            S.selectedProject = p.name;
            projSelEl.value = p.name;
            newProjInputEl.hidden = true;
            onProjectChanged();
          }
        })
      ]);
      dashCardsEl.append(card);
    }
  }

  async function refreshTaskHistory() {
    if (!S.selectedProject) return;
    try {
      const data = await reqJson(`runs?project=${encodeURIComponent(S.selectedProject)}`);
      S.runs = data.runs || [];
      renderTaskHistory();
    } catch {
      S.runs = [];
      renderTaskHistory();
    }
  }

  function renderTaskHistory() {
    taskHistEl.replaceChildren(el('div', { className: 'ws-section-title', textContent: 'Task History' }));
    if (!S.runs.length) {
      taskHistEl.append(el('div', { style: { color: 'var(--mut)', fontSize: '12px' }, textContent: 'No runs recorded for this project yet.' }));
      return;
    }
    for (const r of S.runs) {
      const item = el('div', {
        className: 'ws-entry',
        style: { cursor: 'pointer', padding: '8px' },
        onclick: async () => {
          try {
            const data = await reqJson(`runs/${encodeURIComponent(r.id)}`);
            S.currentRun = data.run;
            renderRunDetails();
            refreshDiff();
          } catch (e) {
            alert('Could not load run: ' + e.message);
          }
        }
      }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600' } }, [
          el('span', { textContent: r.mode.toUpperCase() }),
          el('span', { className: stepStatusClass(r.status), textContent: r.status })
        ]),
        el('div', { style: { fontSize: '12px', color: 'var(--fg)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, textContent: r.prompt })
      ]);
      taskHistEl.append(item);
    }
  }

  async function refreshProjectTree() {
    if (!S.selectedProject) {
      treeContainerEl.replaceChildren();
      return;
    }
    try {
      const treeData = await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}/tree`);
      S.tree = buildTree(treeData.files || [], treeData.dirs || []);
      renderTreeNodes(treeContainerEl, S.tree);
    } catch {
      try {
        const projData = await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}`);
        S.projectFiles = projData.files || [];
        S.tree = buildTree(S.projectFiles, []);
        renderTreeNodes(treeContainerEl, S.tree);
      } catch (e) {
        console.warn('Failed to load tree:', e);
      }
    }
  }

  function renderTreeNodes(container, nodes) {
    container.replaceChildren();
    for (const node of nodes) {
      if (node.type === 'dir') {
        const childrenDiv = el('div', { className: 'ws-tree-children', hidden: true });
        const dirItem = el('div', {
          className: 'ws-tree-item ws-tree-dir',
          textContent: '📁 ' + node.name,
          onclick: (e) => {
            e.stopPropagation();
            childrenDiv.hidden = !childrenDiv.hidden;
          }
        });
        renderTreeNodes(childrenDiv, node.children);
        container.append(dirItem, childrenDiv);
      } else {
        const fileItem = el('div', {
          className: 'ws-tree-item',
          textContent: '📄 ' + node.name,
          onclick: (e) => {
            e.stopPropagation();
            openFileInEditor(node.path);
          }
        });
        container.append(fileItem);
      }
    }
  }

  async function openFileInEditor(filePath, scrollToLine = null) {
    if (!S.selectedProject) return;
    try {
      const projData = await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}`);
      const fileObj = (projData.files || []).find(f => f.name === filePath);
      S.openFile = { name: filePath, content: fileObj ? fileObj.content : '' };
      editorTitleEl.textContent = 'Editing: ' + filePath;
      editorAreaEl.value = S.openFile.content;
      editorSaveBtn.disabled = false;

      if (scrollToLine && Number(scrollToLine) > 0) {
        const lines = editorAreaEl.value.split('\n');
        let charPos = 0;
        for (let i = 0; i < Math.min(lines.length, scrollToLine - 1); i++) {
          charPos += lines[i].length + 1;
        }
        editorAreaEl.focus();
        editorAreaEl.setSelectionRange(charPos, charPos + (lines[scrollToLine - 1] || '').length);
      }
    } catch (e) {
      alert('Could not open file: ' + e.message);
    }
  }

  async function handleSaveFile() {
    if (!S.selectedProject || !S.openFile) return;
    try {
      await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: S.openFile.name, content: editorAreaEl.value })
      });
      S.openFile.content = editorAreaEl.value;
      alert('File saved successfully.');
      refreshProjectTree();
    } catch (e) {
      alert('Could not save file: ' + e.message);
    }
  }

  async function handleNewFile() {
    if (!S.selectedProject) return alert('Select a project first.');
    const fileName = prompt('Enter new file path/name (e.g. src/index.js):');
    if (!fileName) return;
    try {
      await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileName, content: '' })
      });
      refreshProjectTree();
      openFileInEditor(fileName);
    } catch (e) {
      alert('Could not create file: ' + e.message);
    }
  }

  async function handleNewFolder() {
    if (!S.selectedProject) return alert('Select a project first.');
    const folderName = prompt('Enter new folder name (e.g. src/components):');
    if (!folderName) return;
    try {
      await reqJson(`../../projects/${encodeURIComponent(S.selectedProject)}/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderName })
      });
      refreshProjectTree();
    } catch (e) {
      alert('Could not create folder: ' + e.message);
    }
  }

  let searchDebounceTimer = null;
  function debounceSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(performProjectSearch, 300);
  }

  async function performProjectSearch() {
    const q = searchInputEl.value.trim();
    if (!q || !S.selectedProject) {
      searchHitsEl.replaceChildren();
      return;
    }
    try {
      const data = await reqJson(`search?project=${encodeURIComponent(S.selectedProject)}&q=${encodeURIComponent(q)}`);
      searchHitsEl.replaceChildren();
      for (const hit of (data.hits || [])) {
        const hitItem = el('div', {
          className: 'ws-tree-item',
          style: { fontSize: '12px' },
          textContent: `${hit.file}:${hit.line} ${hit.text}`,
          onclick: () => openFileInEditor(hit.file, hit.line)
        });
        searchHitsEl.append(hitItem);
      }
    } catch {
      searchHitsEl.replaceChildren();
    }
  }

  function renderRunDetails() {
    renderStageBar();
    renderPlan();
    renderStepsTimeline();
    renderChangesDiff();
    renderReportCard();
    renderBottomTab();
  }

  function renderStageBar() {
    stageBarEl.replaceChildren();
    const run = S.currentRun;
    const stages = run && Array.isArray(run.stages) ? run.stages : STAGES.map(s => ({ id: s, status: 'pending' }));

    for (const st of stages) {
      const stClass = st.status === 'completed' ? 'completed' : st.status === 'running' ? 'running' : st.status === 'failed' ? 'failed' : st.status === 'skipped' ? 'skipped' : '';
      const chip = el('div', { className: `ws-stage-chip ${stClass}` }, [
        st.status === 'running' ? el('span', { className: 'ws-dot-pulse' }) : null,
        el('span', { textContent: st.id.toUpperCase() }),
        st.note ? el('small', { style: { opacity: 0.8 }, textContent: `(${st.note})` }) : null
      ]);
      stageBarEl.append(chip);
    }
  }

  function renderPlan() {
    planContainerEl.replaceChildren();
    const run = S.currentRun;
    if (!run || !Array.isArray(run.plan)) return;

    const isActive = run.status === 'running' || run.status === 'queued';
    const head = el('div', { className: 'ws-section-title' }, [
      el('span', { textContent: 'Execution Plan' }),
      !isActive ? el('button', { className: 'ws-btn', textContent: 'Save Plan', onclick: handleSavePlan }) : null
    ]);

    const tasksList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    for (const task of run.plan) {
      const taskRow = el('div', { className: 'ws-entry', style: { padding: '8px', display: 'flex', alignItems: 'center', gap: '8px' } }, [
        el('span', { className: stepStatusClass(task.status), textContent: task.status }),
        el('span', { style: { fontWeight: '600' }, textContent: task.title }),
        task.dependsOn && task.dependsOn.length ? el('small', { style: { color: 'var(--mut)' }, textContent: `[depends: ${task.dependsOn.join(', ')}]` }) : null
      ]);
      tasksList.append(taskRow);
    }

    planContainerEl.append(head, tasksList);
  }

  async function handleSavePlan() {
    const run = S.currentRun;
    if (!run) return;
    try {
      const tasks = (run.plan || []).map(t => ({ title: t.title, dependsOn: t.dependsOn }));
      const updated = await reqJson(`runs/${encodeURIComponent(run.id)}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks })
      });
      if (updated && updated.run) {
        S.currentRun = updated.run;
        renderPlan();
      }
    } catch (e) {
      alert('Could not save plan: ' + e.message);
    }
  }

  function renderStepsTimeline() {
    stepsTimelineEl.replaceChildren();
    const run = S.currentRun;
    if (!run || !Array.isArray(run.steps)) return;

    const head = el('div', { className: 'ws-section-title', textContent: 'Activity Timeline' });
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });

    for (const step of run.steps) {
      const isWaiting = step.status === 'waiting' || step.status === 'waiting-for-approval';
      const headRow = el('div', { className: 'ws-entry-head' }, [
        step.status === 'running' ? el('span', { className: 'ws-dot-pulse' }) : null,
        el('b', { textContent: `[${(step.kind || step.stage || 'tool').toUpperCase()}]` }),
        el('span', { style: { flex: 1 }, textContent: step.title || step.tool }),
        el('span', { className: stepStatusClass(step.status), textContent: step.status }),
        el('span', { style: { color: 'var(--mut)', fontSize: '11px' }, textContent: fmtMs(step.ms) })
      ]);

      const bodyBox = el('div', { className: 'ws-entry-body', hidden: true });

      if (isWaiting) {
        bodyBox.append(el('div', {
          style: { color: 'var(--warn)', fontWeight: '600' },
          textContent: 'Needs approval in the Pholama window to proceed.'
        }));
      }

      if (step.input) {
        bodyBox.append(el('div', { style: { fontWeight: '600' }, textContent: 'Input:' }));
        bodyBox.append(el('div', { className: 'ws-entry-box', textContent: typeof step.input === 'string' ? step.input : JSON.stringify(step.input, null, 2) }));
      }
      if (step.output) {
        bodyBox.append(el('div', { style: { fontWeight: '600' }, textContent: 'Output:' }));
        bodyBox.append(el('div', { className: 'ws-entry-box', textContent: typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2) }));
      }
      if (step.error) {
        bodyBox.append(el('div', { style: { fontWeight: '600', color: 'var(--err)' }, textContent: 'Error:' }));
        bodyBox.append(el('div', { className: 'ws-entry-box', style: { color: 'var(--err)' }, textContent: step.error }));
      }
      if (step.files && step.files.length) {
        bodyBox.append(el('div', { style: { fontWeight: '600' }, textContent: 'Related Files:' }));
        const filesDiv = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
        for (const f of step.files) {
          filesDiv.append(el('button', {
            className: 'ws-btn',
            textContent: f,
            onclick: () => openFileInEditor(f)
          }));
        }
        bodyBox.append(filesDiv);
      }

      headRow.onclick = () => { bodyBox.hidden = !bodyBox.hidden; };
      list.append(el('div', { className: 'ws-entry' }, [headRow, bodyBox]));
    }

    stepsTimelineEl.append(head, list);
  }

  async function refreshDiff() {
    const run = S.currentRun;
    if (!run) return;
    try {
      const data = await reqJson(`runs/${encodeURIComponent(run.id)}/diff`);
      S.diff = data;
      renderChangesDiff();
    } catch {
      S.diff = null;
      renderChangesDiff();
    }
  }

  function renderChangesDiff() {
    changesDiffEl.replaceChildren();
    const run = S.currentRun;
    if (!run) return;

    const diff = S.diff;
    const changes = (diff && diff.changes) ? diff.changes : (run.files ? Object.entries(run.files).map(([f, s]) => ({ file: f, status: s.status, added: s.added || 0, removed: s.removed || 0, hunks: [] })) : []);

    if (!changes.length) return;

    const head = el('div', { className: 'ws-section-title' }, [
      el('span', { textContent: 'File Changes & Diff' }),
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        el('button', {
          className: 'ws-btn' + (S.diffViewMode === 'unified' ? ' ws-btn-primary' : ''),
          textContent: 'Unified',
          onclick: () => { S.diffViewMode = 'unified'; renderChangesDiff(); }
        }),
        el('button', {
          className: 'ws-btn' + (S.diffViewMode === 'side-by-side' ? ' ws-btn-primary' : ''),
          textContent: 'Side-by-Side',
          onclick: () => { S.diffViewMode = 'side-by-side'; renderChangesDiff(); }
        }),
        el('button', {
          className: 'ws-btn ws-btn-danger',
          textContent: 'Revert All',
          onclick: handleRevertAll
        })
      ])
    ]);

    const filesList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

    for (const c of changes) {
      const fileHead = el('div', { className: 'ws-entry-head' }, [
        el('span', { style: { fontWeight: '600', flex: 1 }, textContent: `${c.file} (${c.status})` }),
        el('span', { style: { color: 'var(--ok)', fontSize: '11px' }, textContent: `+${c.added || 0}` }),
        el('span', { style: { color: 'var(--err)', fontSize: '11px', marginRight: '8px' }, textContent: `-${c.removed || 0}` }),
        el('button', {
          className: 'ws-btn ws-btn-danger',
          style: { padding: '2px 8px', fontSize: '11px' },
          textContent: 'Reject',
          onclick: (e) => { e.stopPropagation(); handleRejectFile(c.file); }
        })
      ]);

      const hunkBox = el('div', { className: 'ws-entry-body' });

      if (Array.isArray(c.hunks) && c.hunks.length) {
        if (S.diffViewMode === 'unified') {
          for (const h of c.hunks) {
            for (const l of h.lines) {
              const lineClass = l.t === '+' ? 'ws-diff-line-add' : l.t === '-' ? 'ws-diff-line-del' : 'ws-diff-line-ctx';
              hunkBox.append(el('div', { className: lineClass, textContent: `${l.t} ${l.s}` }));
            }
          }
        } else {
          const sideGrid = el('div', { className: 'ws-diff-side' });
          const leftCol = el('div');
          const rightCol = el('div');
          for (const h of c.hunks) {
            for (const l of h.lines) {
              if (l.t === '-') {
                leftCol.append(el('div', { className: 'ws-diff-line-del', textContent: `- ${l.s}` }));
              } else if (l.t === '+') {
                rightCol.append(el('div', { className: 'ws-diff-line-add', textContent: `+ ${l.s}` }));
              } else {
                leftCol.append(el('div', { className: 'ws-diff-line-ctx', textContent: `  ${l.s}` }));
                rightCol.append(el('div', { className: 'ws-diff-line-ctx', textContent: `  ${l.s}` }));
              }
            }
          }
          sideGrid.append(leftCol, rightCol);
          hunkBox.append(sideGrid);
        }
      }

      filesList.append(el('div', { className: 'ws-entry' }, [fileHead, hunkBox]));
    }

    changesDiffEl.append(head, filesList);
  }

  async function handleRejectFile(file) {
    const run = S.currentRun;
    if (!run) return;
    if (!confirm(`Reject changes for ${file}?`)) return;
    try {
      await reqJson(`runs/${encodeURIComponent(run.id)}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file })
      });
      refreshDiff();
      refreshProjectTree();
    } catch (e) {
      alert('Could not reject file: ' + e.message);
    }
  }

  async function handleRevertAll() {
    const run = S.currentRun;
    if (!run) return;
    if (!confirm('Revert all changes for this run?')) return;
    try {
      await reqJson(`runs/${encodeURIComponent(run.id)}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      refreshDiff();
      refreshProjectTree();
    } catch (e) {
      alert('Could not revert run: ' + e.message);
    }
  }

  function renderReportCard() {
    reportCardEl.replaceChildren();
    const run = S.currentRun;
    if (!run || !run.report) return;

    const report = run.report;
    const isCompleted = run.status === 'completed';

    const head = el('div', { className: 'ws-section-title' }, [
      el('span', { textContent: 'Final Report Card' }),
      el('span', { className: stepStatusClass(isCompleted ? 'completed' : run.status), textContent: isCompleted ? 'Completed' : run.status.toUpperCase() })
    ]);

    const infoList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' } }, [
      el('div', { textContent: `Files Changed: ${report.changed || 0}` }),
      report.verified ? el('div', { textContent: `Verification - Build: ${report.verified.build}, Tests: ${report.verified.tests}` }) : null,
      el('div', { textContent: `Repairs Attempted: ${report.repairs || 0}` })
    ]);

    if (report.unresolved && report.unresolved.length) {
      const unresolvedBox = el('div', { style: { marginTop: '6px', color: 'var(--err)' } }, [
        el('b', { textContent: 'Unresolved Issues:' }),
        el('div', { className: 'ws-entry-box', style: { color: 'var(--err)' } }, report.unresolved.join('\n'))
      ]);
      infoList.append(unresolvedBox);
    }

    reportCardEl.append(head, infoList);
  }

  function renderBottomTab() {
    const tabBtns = tabHeaderEl.querySelectorAll('.ws-tab-btn');
    const tabNames = ['activity', 'tools', 'terminal', 'problems', 'tests'];
    tabBtns.forEach((btn, idx) => {
      btn.classList.toggle('active', tabNames[idx] === S.activeTab);
    });
    renderBottomTabContent();
  }

  function renderBottomTabContent() {
    tabContentEl.replaceChildren();
    const run = S.currentRun;
    const filter = S.tabFilter;

    if (S.activeTab === 'activity') {
      const stages = run && Array.isArray(run.stages) ? run.stages : [];
      const modelSteps = run && Array.isArray(run.steps) ? run.steps.filter(s => s.kind === 'model' || s.tool === 'callModel' || s.kind === 'read') : [];
      const entries = filterEntries([...stages.map(s => ({ title: `Stage: ${s.id}`, status: s.status, note: s.note })), ...modelSteps], filter);

      for (const e of entries) {
        tabContentEl.append(el('div', { className: 'ws-entry', style: { padding: '8px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [
            el('b', { textContent: e.title || e.tool }),
            el('span', { className: stepStatusClass(e.status), textContent: e.status })
          ]),
          e.note ? el('div', { style: { color: 'var(--mut)', marginTop: '4px' }, textContent: e.note }) : null,
          e.output ? el('div', { className: 'ws-entry-box', style: { marginTop: '4px' }, textContent: typeof e.output === 'string' ? e.output : JSON.stringify(e.output) }) : null
        ]));
      }
    } else if (S.activeTab === 'tools') {
      const steps = run && Array.isArray(run.steps) ? run.steps : [];
      const entries = filterEntries(steps, filter);

      for (const s of entries) {
        tabContentEl.append(el('div', { className: 'ws-entry', style: { padding: '8px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: '600' } }, [
            el('span', { textContent: `${s.tool || s.kind} (${fmtMs(s.ms)})` }),
            el('span', { className: stepStatusClass(s.status), textContent: s.status })
          ]),
          s.input ? el('div', { className: 'ws-entry-box', style: { marginTop: '4px' }, textContent: typeof s.input === 'string' ? s.input : JSON.stringify(s.input) }) : null,
          s.output ? el('div', { className: 'ws-entry-box', style: { marginTop: '4px' }, textContent: typeof s.output === 'string' ? s.output : JSON.stringify(s.output) }) : null,
          s.error ? el('div', { className: 'ws-entry-box', style: { marginTop: '4px', color: 'var(--err)' }, textContent: s.error }) : null
        ]));
      }
    } else if (S.activeTab === 'terminal') {
      if (S.capabilities && S.capabilities.terminal && !S.capabilities.terminal.available) {
        tabContentEl.append(el('div', { style: { color: 'var(--warn)', padding: '8px', fontWeight: '600' }, textContent: S.capabilities.terminal.note || 'Terminal is not available on this host.' }));
      } else if (run && run.verify) {
        const builds = run.verify.builds || [];
        const tests = run.verify.tests || [];
        if (!builds.length && !tests.length) {
          tabContentEl.append(el('div', { style: { color: 'var(--mut)', padding: '8px' }, textContent: 'No terminal verification commands run.' }));
        } else {
          for (const b of builds) {
            tabContentEl.append(el('div', { className: 'ws-entry-box', style: { marginBottom: '8px' } }, [
              el('b', { textContent: `$ ${b.cmd} (exit code: ${b.code})` }),
              el('div', { textContent: b.output || '' })
            ]));
          }
          for (const t of tests) {
            tabContentEl.append(el('div', { className: 'ws-entry-box', style: { marginBottom: '8px' } }, [
              el('b', { textContent: `$ ${t.cmd} (passed: ${t.passed}, failed: ${t.failed})` }),
              el('div', { textContent: t.output || '' })
            ]));
          }
        }
      } else {
        tabContentEl.append(el('div', { style: { color: 'var(--mut)', padding: '8px' }, textContent: 'No terminal output available.' }));
      }
    } else if (S.activeTab === 'problems') {
      const probs = (run && run.verify && run.verify.problems) ? run.verify.problems : [];
      const entries = filterEntries(probs, filter);

      if (!entries.length) {
        tabContentEl.append(el('div', { style: { color: 'var(--mut)', padding: '8px' }, textContent: 'No problems detected.' }));
      } else {
        for (const p of entries) {
          tabContentEl.append(el('div', { className: 'ws-entry', style: { padding: '8px' } }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
              el('span', { style: { fontWeight: '600', color: p.severity === 'error' ? 'var(--err)' : 'var(--warn)' }, textContent: `[${p.severity.toUpperCase()}] ${p.file}:${p.line}` }),
              el('button', {
                className: 'ws-btn ws-btn-primary',
                style: { padding: '2px 8px', fontSize: '11px' },
                textContent: 'Fix with AI',
                onclick: () => handleFixProblemWithAI(p)
              })
            ]),
            el('div', { style: { marginTop: '4px', cursor: 'pointer' }, textContent: p.message, onclick: () => openFileInEditor(p.file, p.line) })
          ]));
        }
      }
    } else if (S.activeTab === 'tests') {
      const testResults = (run && run.verify && run.verify.tests) ? run.verify.tests : [];

      const topRow = el('div', { style: { marginBottom: '8px' } }, [
        el('button', {
          className: 'ws-btn ws-btn-primary',
          textContent: 'Run tests',
          onclick: handleRunTests
        })
      ]);
      tabContentEl.append(topRow);

      if (!testResults.length) {
        tabContentEl.append(el('div', { style: { color: 'var(--mut)', padding: '8px' }, textContent: 'No tests run yet.' }));
      } else {
        for (const t of testResults) {
          tabContentEl.append(el('div', { className: 'ws-entry-box', style: { marginBottom: '8px' } }, [
            el('b', { textContent: `Cmd: ${t.cmd} (ok: ${t.ok}, passed: ${t.passed}, failed: ${t.failed})` }),
            el('div', { textContent: t.output || '' })
          ]));
        }
      }
    }
  }

  async function handleFixProblemWithAI(problem) {
    if (!S.selectedProject) return alert('No project selected.');
    const promptText = `Fix problem in ${problem.file} line ${problem.line}: ${problem.message}`;
    try {
      const res = await reqJson('runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          project: S.selectedProject,
          mode: 'repair',
          model: modelSelEl.value || ''
        })
      });
      if (res && res.id) {
        startStream(res.id);
      }
    } catch (e) {
      alert('Could not start repair run: ' + e.message);
    }
  }

  async function handleRunTests() {
    if (!S.selectedProject) return alert('No project selected.');
    try {
      const res = await reqJson('tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: S.selectedProject })
      });
      if (res) {
        if (!S.currentRun) S.currentRun = {};
        if (!S.currentRun.verify) S.currentRun.verify = {};
        S.currentRun.verify.tests = [res];
        renderBottomTabContent();
      }
    } catch (e) {
      alert('Could not run tests: ' + e.message);
    }
  }

  function handleCopyTabContent() {
    const text = tabContentEl.innerText || tabContentEl.textContent || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
      }).catch(e => {
        alert('Could not copy: ' + e.message);
      });
    }
  }

  async function open() {
    try {
      S.capabilities = await reqJson('capabilities');
    } catch (e) {
      // Say WHY the screen is empty when the cause is simply that nobody is logged in (the website needs a login; the PC does not).
      if (/log in/i.test(String(e && e.message))) {
        host.replaceChildren(el('div', { className: 'ws-section ws-login-note', textContent: 'Log in to use Pholama Studio.' }));
        return;
      }
      S.capabilities = { modes: [], models: [], toolCalling: false, terminal: { available: false, note: 'Terminal unavailable' }, build: { available: false }, tests: { available: false } };
    }

    try {
      const dashData = await reqJson('dashboard');
      S.dashboard = dashData.projects || [];
    } catch {
      S.dashboard = [];
    }

    buildShell();

    // Populate Modes
    modeSelEl.replaceChildren();
    const modes = (S.capabilities && S.capabilities.modes) || [
      { id: 'fast', label: 'Fast', note: 'Quick edits' },
      { id: 'build', label: 'Build', note: 'Standard full agent' },
      { id: 'think', label: 'Think', note: 'Deep reasoning' },
      { id: 'repair', label: 'Repair', note: 'Fix errors' }
    ];
    for (const m of modes) {
      modeSelEl.append(el('option', { value: m.id, textContent: m.label }));
    }
    modeSelEl.value = 'build';
    modeSelEl.onchange();

    // Populate Models
    modelSelEl.replaceChildren();
    let modelList = [];
    if (S.capabilities && S.capabilities.models && S.capabilities.models.length) {
      modelList = S.capabilities.models;
    } else if (typeof env.getModels === 'function') {
      modelList = env.getModels();
    }
    if (!modelList.length) {
      modelList = [{ id: 'default', name: 'Default Model' }];
    }
    for (const m of modelList) {
      modelSelEl.append(el('option', { value: m.id || m.name, textContent: m.name || m.id }));
    }

    // Populate Projects
    projSelEl.replaceChildren();
    projSelEl.append(el('option', { value: '', textContent: '-- Select Project --' }));
    for (const p of S.dashboard) {
      projSelEl.append(el('option', { value: p.name, textContent: p.name }));
    }
    projSelEl.append(el('option', { value: '__new__', textContent: '➕ New project...' }));

    if (S.dashboard.length) {
      S.selectedProject = S.dashboard[0].name;
      projSelEl.value = S.selectedProject;
      onProjectChanged();
    }

    renderDashboardCards();
  }

  return {
    open,
    refresh: () => { refreshDashboard(); onProjectChanged(); },
    stop: stopStream
  };
}
