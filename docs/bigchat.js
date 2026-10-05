// A big chat window (near full screen) used for post replies and for support tickets.
// It knows nothing about posts or tickets: the caller gives it how to load and how to send.
// Everything from the network is set with textContent, never innerHTML.
//
// openBig({ title, subtitle, header, load, send, canSend, maxLen, every, actions, emptyText, closedText })
//   load():  async () => [{ id, who, mine, badge, when, text }]   oldest first
//   send(t): async (text) => void
//   header:  optional DOM node shown above the thread (the post itself, the ticket member tools)
//   actions: optional [{ label, run, cls }] buttons in the window's top bar (Close ticket, Delete ...)
//   canSend: false hides the composer and shows closedText
// Returns { close, refresh }.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// Pure helpers (tested on their own)
export const nearBottom = (scrollTop, clientHeight, scrollHeight, slack = 80) => scrollHeight - (scrollTop + clientHeight) <= slack;
export const sameMessages = (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i].id && m.text === b[i].text);
export const cleanDraft = (t, max) => String(t == null ? '' : t).replace(/\r\n/g, '\n').trim().slice(0, max || 1000);
export const whenText = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

export function openBig(o) {
  const dlg = document.createElement('dialog'); dlg.className = 'bigchat'; dlg.setAttribute('aria-label', o.title || 'Chat');
  const top = el('div', 'bc-top'); const tt = el('div', 'bc-title'); tt.append(el('b', null, o.title || ''), el('small', 'dmut', o.subtitle || '')); top.append(tt);
  const bar = el('div', 'bc-acts');
  for (const a of (o.actions || [])) { const b = el('button', a.cls || '', a.label); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await a.run(api); } catch (e) { note(e && e.message ? e.message : String(e)); } b.disabled = false; }; bar.append(b); }
  const x = el('button', 'bc-x', 'Close'); x.type = 'button'; x.setAttribute('aria-label', 'Close window'); bar.append(x); top.append(bar);
  const head = el('div', 'bc-head'); if (o.header) head.append(o.header);
  const list = el('div', 'bc-list'); list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite');
  const err = el('div', 'err-t bc-err');
  const foot = el('div', 'bc-foot');
  let ta = null, sendBtn = null;
  if (o.canSend === false) foot.append(el('p', 'dmut', o.closedText || 'This conversation is closed.'));
  else {
    ta = el('textarea'); ta.rows = 2; ta.maxLength = o.maxLen || 1000; ta.placeholder = o.placeholder || 'Write a message. Enter sends, Shift+Enter adds a line.'; ta.setAttribute('aria-label', 'Message');
    sendBtn = el('button', 'p', 'Send'); sendBtn.type = 'button';
    foot.append(ta, sendBtn);
  }
  dlg.append(top, head, list, err, foot); document.body.append(dlg);

  let shown = [], timer = null, closed = false, sending = false;
  let sendErr = '';                                              // an error from Send stays until the next Send, a good refresh must not wipe it
  const note = t => { err.textContent = t || ''; };
  async function refresh(force) {
    if (closed) return;
    let msgs; try { msgs = await o.load(); } catch (e) { note(e && e.message ? e.message : 'Could not load messages.'); return; }
    if (closed) return; note(sendErr);
    if (!force && sameMessages(shown, msgs)) return;                                   // nothing new: do not repaint, do not steal the scroll position
    const stick = nearBottom(list.scrollTop, list.clientHeight, list.scrollHeight) || !shown.length;
    shown = msgs; list.textContent = '';
    if (!msgs.length) list.append(el('p', 'dmut bc-empty', o.emptyText || 'No messages yet.'));
    for (const m of msgs) {
      const b = el('div', 'bc-msg' + (m.mine ? ' mine' : '') + (m.badge ? ' badge' : ''));
      const h = el('div', 'bc-meta'); h.append(el('b', null, m.who || 'Someone')); if (m.badge) h.append(el('span', 'bc-badge', m.badge)); h.append(el('span', 'dmut', ' ' + (m.when || '')));
      b.append(h, el('p', 'plbody', m.text)); list.append(b);
    }
    if (stick) list.scrollTop = list.scrollHeight;
  }
  async function doSend() {
    if (!ta || sending) return; const v = cleanDraft(ta.value, o.maxLen); if (!v) return;
    sending = true; sendBtn.disabled = true; sendErr = ''; note('');
    try { await o.send(v); ta.value = ''; await refresh(true); list.scrollTop = list.scrollHeight; }
    catch (e) { sendErr = e && e.message ? e.message : 'Could not send.'; note(sendErr); }
    sending = false; sendBtn.disabled = false; ta.focus();
  }
  if (sendBtn) sendBtn.onclick = doSend;
  if (ta) ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } };
  function close() { if (closed) return; closed = true; clearInterval(timer); document.removeEventListener('visibilitychange', vis); try { dlg.close(); } catch {} dlg.remove(); o.onClose && o.onClose(); }
  // keep it fresh, but only while the window is open and the tab is visible
  const vis = () => { if (!document.hidden) refresh(); };
  x.onclick = close; dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });               // click on the dark area outside
  const api = { close, refresh: () => refresh(true), note, el: dlg };
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  timer = setInterval(() => { if (!document.hidden) refresh(); }, o.every || 4000);
  document.addEventListener('visibilitychange', vis);
  dlg.tabIndex = -1; refresh(true); setTimeout(() => (ta || dlg).focus(), 50);
  return api;
}
