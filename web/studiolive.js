// Live Activity card: one small card that shows, while the AI works, what it thinks and which files it is touching.
// `createLiveModel` is pure (no DOM) so it can be tested; `createLiveCard` draws it. ES module like studio.js.
export function createLiveModel() {
  const st = { phase: 'idle', title: '', thought: '', files: [], open: 0 };
  const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
  const find = (name, kind) => st.files.find(f => f.name === name && f.kind === kind && !f.done);
  return {
    state: () => st,
    begin() { st.phase = 'thinking'; st.title = 'Thinking'; st.thought = ''; st.files = []; st.open = 0; },
    thought(text) { if (st.phase === 'idle') return; st.thought = clip(text, 140); if (!st.open) { st.phase = 'thinking'; st.title = 'Thinking'; } },
    start(status) {   // status = toolStatus(...) from studiofx: { kind, file, text }
      if (st.phase === 'idle' || !status) return; st.open++; st.phase = status.kind; st.title = clip(status.text, 70);
      const name = status.file || ''; if (name && !find(name, status.kind)) st.files.push({ name, kind: status.kind, done: false });
    },
    finish(status) {
      if (st.phase === 'idle') return; st.open = Math.max(0, st.open - 1);
      const f = status && status.file ? find(status.file, status.kind) : null; if (f) f.done = true;
      if (!st.open) { st.phase = 'thinking'; st.title = 'Thinking'; }
    },
    end() { st.phase = 'idle'; st.open = 0; for (const f of st.files) f.done = true; st.title = ''; },
    summary() { const n = st.files.filter(f => f.kind === 'edit').length; return n ? 'Changed ' + n + (n === 1 ? ' file' : ' files') : ''; }
  };
}

export function createLiveCard(host) {
  const m = createLiveModel(); let card = null, gone = 0;
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const ICON = { edit: 'Edit', look: 'Read', test: 'Test', work: 'Work' };
  const draw = () => {
    if (!card) return; const s = m.state(); card.dataset.phase = s.phase;
    card.querySelector('.lv-title').textContent = s.title || 'Done';
    const th = card.querySelector('.lv-thought'); th.textContent = s.thought; th.hidden = !s.thought;
    const ul = card.querySelector('.lv-files'); ul.textContent = ''; ul.hidden = !s.files.length;
    for (const f of s.files.slice(-6)) { const li = h('li', f.done ? 'done' : ''); li.append(h('b', '', ICON[f.kind] || 'Work'), h('span', '', f.name)); ul.appendChild(li); }   // textContent only: a file name can never become HTML
    host.scrollTop = 1e9;
  };
  return {
    model: m,
    begin() { clearTimeout(gone); if (card) card.remove(); m.begin(); card = h('div', 'st-live'); card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
      const top = h('div', 'lv-top'); top.append(h('i', 'lv-dot'), h('span', 'lv-title')); card.append(top, h('p', 'lv-thought'), h('ul', 'lv-files')); host.appendChild(card); draw(); },
    thought(t) { m.thought(t); draw(); }, start(s) { m.start(s); draw(); }, finish(s) { m.finish(s); draw(); },
    end() { if (!card) return; const sum = m.summary(); m.end(); draw(); const c = card; c.classList.add('ended'); c.querySelector('.lv-title').textContent = sum || 'Done'; card = null;
      gone = setTimeout(() => { if (c.isConnected && !sum) c.remove(); }, 2500); }
  };
}
