// The paperclip: pick files, show them as chips, hand them to send(). Shared by the PC app and the phone site.
import { accepts, checkFiles, fmtBytes, buildMessage, withPicture, READER } from './attach.js';
import { loadReader, look, readerLoaded } from './reader.js';

const $ = s => document.querySelector(s);
let picked = [];                       // [{file, kind, name, size, text?, url?}]
let getModel = () => null, notify = m => alert(m);

export function initAttach({ model, note }) {
  getModel = model || getModel; notify = note || notify;
  const comp = $('.composer'); if (!comp || $('#attachBtn')) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'attachIn'; inp.multiple = true; inp.hidden = true;
  const btn = document.createElement('button'); btn.id = 'attachBtn'; btn.className = 'ib'; btn.type = 'button'; btn.title = 'Attach a file'; btn.setAttribute('aria-label', 'Attach a file');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>';
  const chips = document.createElement('div'); chips.id = 'attachChips'; chips.className = 'achips'; chips.hidden = true;
  comp.parentNode.insertBefore(chips, comp);
  comp.insertBefore(inp, comp.firstChild); comp.insertBefore(btn, comp.firstChild);
  btn.onclick = () => { const m = getModel(); inp.accept = accepts(m).image ? 'image/png,image/jpeg,image/webp,image/gif,text/*,.md,.csv,.json,.lua,.luau,.py,.js,.ts,.html,.css,.log,.yml,.yaml' : 'text/*,.md,.csv,.json,.lua,.luau,.py,.js,.ts,.html,.css,.log,.yml,.yaml'; inp.click(); };
  inp.onchange = async () => { await add([...inp.files]); inp.value = ''; };
  comp.addEventListener('dragover', e => { e.preventDefault(); });
  comp.addEventListener('drop', async e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) await add([...e.dataTransfer.files]); });
  comp.addEventListener('paste', async e => {   // pasted screenshots arrive as clipboard items on some browsers and as files on others: read both
    const cd = e.clipboardData; if (!cd) return;
    let f = [...(cd.files || [])];
    if (!f.length && cd.items) f = [...cd.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (f.length) { e.preventDefault(); await add(f); }
  });
}

async function add(files) {
  const fresh = checkFiles(files, getModel());   // only the newly picked files are checked; what is already attached stays
  if (fresh.problems.length) notify(fresh.problems.join('\n'));
  for (const f of fresh.files) {
    if (picked.length >= 4) break;
    const it = { file: f.file, kind: f.kind, name: f.file.name, size: f.file.size };
    if (f.kind === 'text') { try { it.text = await f.file.text(); } catch { notify(`${it.name} could not be read.`); continue; } }
    else { it.url = URL.createObjectURL(f.file); }
    picked.push(it);
  }
  paint();
}

function paint() {
  const box = $('#attachChips'); if (!box) return;
  box.innerHTML = ''; box.hidden = !picked.length;
  picked.forEach((p, i) => {
    const c = document.createElement('div'); c.className = 'achip';
    if (p.kind === 'image') { const im = document.createElement('img'); im.src = p.url; im.alt = ''; c.appendChild(im); }
    const t = document.createElement('span'); t.textContent = `${p.name} · ${fmtBytes(p.size)}`; c.appendChild(t);
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + p.name); x.onclick = () => { if (p.url) URL.revokeObjectURL(p.url); picked.splice(i, 1); paint(); };
    c.appendChild(x); box.appendChild(c);
  });
}

export const hasAttachments = () => picked.length > 0;
export const attachedNames = () => picked.map(p => p.name);
export const needsReader = () => picked.some(p => p.kind === 'image');
export function clearAttachments() { picked.forEach(p => p.url && URL.revokeObjectURL(p.url)); picked = []; paint(); }

// Called by send(). Returns { text, display } where text goes to the model and display is what the user sees in the chat.
// Images are read first (the reader turns them into words), so every chat engine works unchanged.
export async function prepare(userText, history, progress) {
  const names = attachedNames();
  if (!picked.length) return null;
  const parts = picked.filter(p => p.kind === 'text').map(p => ({ kind: 'text', name: p.name, text: p.text }));
  const imgs = picked.filter(p => p.kind === 'image');
  let seen = [];
  if (imgs.length) {
    if (!readerLoaded()) { progress && progress(`Loading the image reader (${READER.sizeMB} MB, first time only)...`); await loadReader(p => progress && progress(`Loading the image reader... ${p.pct}%`)); }
    for (let i = 0; i < imgs.length; i++) { progress && progress(`Looking at ${imgs[i].name}...`); seen.push(await look(imgs[i].file)); }
  }
  const m = buildMessage(userText, parts);
  return { names, textBlocks: m.content, seen, hasImages: imgs.length > 0, build: (hist) => imgs.length ? withPicture(hist, m.content, seen) : null, content: m.content };
}
