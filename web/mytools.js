// Browser side of: (1) videos and pictures the AI shows, (2) the Allow card for your own tools, (3) the "My tools" maker.
// Everything is built with textContent and setAttribute on fixed element types. AI text can never become markup.
const YT = /^[A-Za-z0-9_-]{11}$/;
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// The server already checked these values. They are checked again here, so a bad message can still never draw anything unsafe.
export function safeVideo(id) { return YT.test(String(id || '')) ? id : null; }
export function safeImage(u) { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && !x.username && !x.password ? x.toString() : null; } catch { return null; } }

export function mediaCard(m) {
  const box = mk('figure', 'mediacard');
  if (m && m.kind === 'video') {
    const id = safeVideo(m.id); if (!id) return null;
    const f = mk('iframe', 'media-frame'); f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0'; f.title = (m.title || 'YouTube video').slice(0, 120);
    f.setAttribute('allow', 'accelerometer; encrypted-media; picture-in-picture; fullscreen'); f.setAttribute('allowfullscreen', ''); f.setAttribute('loading', 'lazy'); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
    box.append(f);
    const a = mk('a', 'media-link', 'Open on YouTube'); a.href = 'https://www.youtube.com/watch?v=' + id; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a);
  } else if (m && m.kind === 'image') {
    const url = safeImage(m.url); if (!url) return null;
    const img = mk('img', 'media-img'); img.src = url; img.alt = (m.title || 'picture').slice(0, 120); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
    img.onerror = () => { box.replaceChildren(mk('small', 'media-fail', 'That picture would not load.')); };
    const a = mk('a', 'media-link', 'Open the picture'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    box.append(img, a);
  } else return null;
  if (m.title) box.append(mk('figcaption', 'media-cap', String(m.title).slice(0, 120)));
  return box;
}

// Allow card for a custom tool that changes data. Nothing has run yet.
export function toolAsk(a, api, onDone) {
  const box = mk('div', 'sys cmdcard'), h = mk('b', null, 'Let the AI use your tool "' + String(a.tool || '').slice(0, 40) + '"?');
  const what = mk('small', null, 'This tool changes data on another service. It has NOT run yet.');
  const det = mk('pre', 'cmdcode', String(a.details || '').slice(0, 400));
  const row = mk('div', 'cmdrow'), ok = mk('button', 'p', 'Allow'), no = mk('button', null, 'Deny'); row.append(ok, no);
  const out = mk('pre', 'cmdout'); out.style.display = 'none';
  const settle = (label, text) => { row.remove(); h.textContent = label; if (text) { out.textContent = text; out.style.display = ''; } onDone && onDone(); };
  no.onclick = async () => { ok.disabled = no.disabled = true; try { await api('api/mytools/approve', { method: 'POST', body: JSON.stringify({ id: a.id, approve: false }) }); } catch {} settle('Denied. Nothing ran.'); };
  ok.onclick = async () => { ok.disabled = no.disabled = true; h.textContent = 'Running...'; try { const r = await (await api('api/mytools/approve', { method: 'POST', body: JSON.stringify({ id: a.id, approve: true }) })).json(); settle(r.ok ? 'Done.' : 'It did not work.', r.text); } catch (e) { settle('It did not work.', e.message); } };
  box.append(h, what, det, row, out); return box;
}

// ---------- The "My tools" panel: tool cards (picture, name, description), edit, create with AI, make by hand, secrets ----------
const PIC_MAX = 60000;   // the server accepts up to 80,000 characters of picture text; this keeps a comfortable margin
// Reads a chosen picture file and shrinks it to a small square, so it fits the limit. Returns a data URL or null.
export function pictureToThumb(file) {
  return new Promise(resolve => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return resolve(null);
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const S = 96, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const k = Math.max(S / img.width, S / img.height), w = img.width * k, h = img.height * k;
        g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        let q = 0.85, out = c.toDataURL('image/jpeg', q); while (out.length > PIC_MAX && q > 0.3) { q -= 0.15; out = c.toDataURL('image/jpeg', q); }
        resolve(out.length <= PIC_MAX ? out : null);
      } catch { resolve(null); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
const thumbEl = (t, size = 44) => {
  const safe = safeImage(t.thumb) || (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/]+={0,2}$/.test(t.thumb || '') ? t.thumb : null);
  if (safe) { const i = mk('img', 'tl-thumb'); i.src = safe; i.alt = ''; i.width = i.height = size; i.referrerPolicy = 'no-referrer'; return i; }
  const d = mk('div', 'tl-thumb tl-ph', (t.title || t.name || '?').trim().charAt(0).toUpperCase()); return d;   // a letter when there is no picture
};
const post = (api, path, body) => api(path, { method: 'POST', body: JSON.stringify(body) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'failed'); return j; });

export async function paintMyTools(root, api, opts = {}) {
  let d; try { d = await (await api('api/mytools')).json(); } catch { return; }
  root.textContent = '';
  const again = () => paintMyTools(root, api, opts);
  const intro = mk('div', 'sys', 'Tools let the AI use any web service, like Notion, Supabase or Discord. Keys stay on this PC and the AI never sees them. Anything that changes data asks you first.'); intro.style.textAlign = 'left'; root.append(intro);

  // ----- the list of tool cards -----
  const list = mk('div', 'tl-list'); root.append(list);
  if (!d.tools.length) list.append(mk('div', 'sys', 'No tools yet. Use "Create with AI" below.'));
  for (const t of d.tools) {
    const card = mk('div', 'tl-card'), info = mk('div', 'tl-info');
    const head = mk('div', 'tl-head'); head.append(mk('b', null, t.title || t.name), mk('span', 'tl-badge', t.method + (t.by === 'ai' ? ' \u00b7 AI' : '')));
    info.append(head, mk('small', null, t.what), mk('small', 'tl-id', 'x_' + t.name));
    const ctl = mk('div', 'tl-ctl'); const cb = mk('input'); cb.type = 'checkbox'; cb.checked = t.on; cb.title = 'On or off'; cb.setAttribute('aria-label', 'Switch ' + (t.title || t.name));
    const edit = mk('button', null, 'Edit'), del = mk('button', null, 'Delete'); edit.type = del.type = 'button'; ctl.append(cb, edit, del);
    card.append(thumbEl(t), info, ctl); list.append(card);
    cb.onchange = async () => { try { await post(api, 'api/mytools/switch', { name: t.name, on: cb.checked }); } catch {} again(); };
    del.onclick = async () => { if (!confirm('Delete the tool "' + (t.title || t.name) + '"?')) return; try { await post(api, 'api/mytools/delete', { name: t.name }); } catch {} again(); };
    edit.onclick = () => { card.replaceWith(editor(t, api, again)); };
  }

  // ----- create with AI -----
  const ai = mk('div', 'tl-box'); root.append(ai);
  ai.append(mk('b', null, 'Create a tool with AI'), mk('small', null, 'Tell the AI what you want and give it the API key. It writes the tool, you check it, then it is saved. The AI only sees the key\u2019s name, never the key itself.'));
  const inp = (ph, type = 'input') => { const e = mk(type); e.placeholder = ph; if (type === 'input') { e.autocomplete = 'off'; } return e; };
  const service = inp('Service, like Notion, Discord or Supabase'), want = inp('What should the tool do? Like: read a page from my workspace by its id', 'textarea'); want.rows = 2;
  const docs = inp('Address or notes (optional), like https://api.notion.com/v1/pages/{id}', 'textarea'); docs.rows = 2;
  const keyName = inp('Name for the key, like NOTION_KEY'), key = inp('Paste the API key here'); key.type = 'password';
  const noKeyRow = mk('label', 'sw'), noKey = mk('input'); noKey.type = 'checkbox'; const nks = mk('span', null, 'No key needed'); nks.append(mk('small', null, 'For open services that do not need one.')); noKeyRow.append(noKey, nks);
  const go = mk('button', 'p', 'Create with AI'), msg = mk('small'); go.type = 'button';
  const review = mk('div'); 
  ai.append(service, want, docs, keyName, key, noKeyRow, go, msg, review);
  go.onclick = async () => {
    msg.textContent = ''; review.textContent = '';
    const model = opts.model ? opts.model() : ''; if (!model) { msg.textContent = 'Pick a model at the top first.'; return; }
    go.disabled = true; go.textContent = 'The AI is writing...';
    try {
      const j = await post(api, 'api/mytools/draft', { model, service: service.value, want: want.value, docs: docs.value, secretName: keyName.value || (service.value || 'MY').replace(/[^A-Za-z0-9]/g, '').toUpperCase() + '_KEY', apiKey: noKey.checked ? '' : key.value, needsKey: !noKey.checked });
      key.value = '';   // the key is saved now; do not keep it on the page
      review.append(draftReview(j.draft, j.secret, api, again, msg));
    } catch (e) { msg.textContent = 'Could not make it: ' + e.message; }
    go.disabled = false; go.textContent = 'Create with AI';
  };

  // ----- by hand -----
  const hand = mk('details', 'tl-box'); root.append(hand); hand.append(mk('summary', null, 'Make a tool by hand'));
  const f = mk('div'); f.style.cssText = 'display:grid;gap:6px;margin-top:8px;text-align:left'; hand.append(f);
  const name = inp('Name, like supabase_read'), what = inp('What it does, in one sentence'), method = mk('select'), url = inp('https://your-project.supabase.co/rest/v1/{{table}}'), hdr = inp('Headers, one per line: apikey: {{secret.SB_KEY}}', 'textarea'), body = inp('Body (for POST/PUT/PATCH), like {"text":"{{text}}"}', 'textarea'), params = inp('Values the AI fills in, comma separated: table, text');
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) method.append(new Option(m, m));
  hdr.rows = 2; body.rows = 2; const save = mk('button', 'p', 'Make the tool'), hmsg = mk('small'); save.type = 'button';
  f.append(name, what, method, url, hdr, body, params, save, hmsg);
  save.onclick = async () => {
    const headers = {}; for (const l of hdr.value.split('\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    try { await post(api, 'api/mytools/save', { name: name.value, what: what.value, method: method.value, url: url.value, headers, body: body.value, params: params.value.split(',').map(x => x.trim()).filter(Boolean) }); again(); }
    catch (e) { hmsg.textContent = 'Could not make it: ' + e.message; }
  };

  // ----- secrets -----
  const sec = mk('details', 'tl-box'); root.append(sec); sec.append(mk('summary', null, 'Saved keys (' + d.secrets.length + ')'));
  const sf = mk('div'); sf.style.cssText = 'display:grid;gap:6px;margin-top:8px;text-align:left'; sec.append(sf);
  const sn = inp('Key name, like SB_KEY'), sv = inp('Key value'); sv.type = 'password'; sv.autocomplete = 'off';
  const ss = mk('button', null, 'Save key'), sm = mk('small', null, (d.secrets.length ? 'Saved: ' + d.secrets.join(', ') + '. ' : 'None saved yet. ') + 'Values are never shown again. Save an empty value to delete one.'); ss.type = 'button';
  sf.append(sn, sv, ss, sm);
  ss.onclick = async () => { try { await post(api, 'api/mytools/secret', { name: sn.value, value: sv.value }); sv.value = ''; again(); } catch (e) { sm.textContent = 'Could not save: ' + e.message; } };
}

// The AI's draft, shown for review. Nothing is saved as a tool until the person presses Save.
function draftReview(dr, secret, api, again, msg) {
  const box = mk('div', 'tl-review'); box.append(mk('b', null, 'Check what the AI wrote'));
  const title = mk('input'); title.value = dr.title || dr.name; title.maxLength = 60; title.setAttribute('aria-label', 'Tool title');
  const what = mk('textarea'); what.rows = 2; what.value = dr.what; const nm = mk('input'); nm.value = dr.name; nm.maxLength = 32; nm.setAttribute('aria-label', 'Tool name');
  const det = mk('pre', 'cmdcode', dr.method + ' ' + dr.url + '\n' + Object.entries(dr.headers || {}).map(([k, v]) => k + ': ' + v).join('\n') + (dr.body ? '\n\n' + dr.body : '') + '\n\nThe AI fills in: ' + ((dr.params || []).join(', ') || 'nothing') + (secret ? '\nUses the saved key: ' + secret : ''));
  const row = mk('div', 'cmdrow'), ok = mk('button', 'p', 'Save tool'), no = mk('button', null, 'Discard'); ok.type = no.type = 'button'; row.append(ok, no);
  box.append(mk('small', null, 'Name'), nm, mk('small', null, 'Title'), title, mk('small', null, 'What it does'), what, det, mk('small', null, dr.method === 'GET' ? 'Reads only. It runs by itself.' : 'This changes data, so it will ask you to Allow every time.'), row);
  no.onclick = () => box.remove();
  ok.onclick = async () => { ok.disabled = true; try { await post(api, 'api/mytools/save', { ...dr, name: nm.value, title: title.value, what: what.value }); again(); } catch (e) { ok.disabled = false; msg.textContent = 'Could not save: ' + e.message; } };
  return box;
}

// Edit a tool's name, title, description and picture. The recipe itself is not touched here.
function editor(t, api, again) {
  const box = mk('div', 'tl-card tl-edit'); let pic = t.thumb || '';
  const prev = mk('div'); const paintPrev = () => { prev.textContent = ''; prev.append(thumbEl({ ...t, thumb: pic }, 56)); }; paintPrev();
  const col = mk('div', 'tl-info');
  const nm = mk('input'); nm.value = t.name; nm.maxLength = 32; nm.setAttribute('aria-label', 'Tool name');
  const ti = mk('input'); ti.value = t.title || ''; ti.placeholder = 'Title (optional)'; ti.maxLength = 60; ti.setAttribute('aria-label', 'Tool title');
  const wh = mk('textarea'); wh.rows = 2; wh.value = t.what; wh.setAttribute('aria-label', 'What it does');
  const file = mk('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif'; file.setAttribute('aria-label', 'Choose a picture');
  const link = mk('input'); link.placeholder = 'or an https:// picture link'; link.value = /^https:/.test(pic) ? pic : '';
  const rm = mk('button', null, 'Remove picture'); rm.type = 'button';
  const msg = mk('small'); const row = mk('div', 'cmdrow'), sv = mk('button', 'p', 'Save'), cn = mk('button', null, 'Cancel'); sv.type = cn.type = 'button'; row.append(sv, cn);
  col.append(mk('small', null, 'Name (the AI sees it as x_' + t.name + ')'), nm, mk('small', null, 'Title'), ti, mk('small', null, 'Description (tells the AI when to use it)'), wh, mk('small', null, 'Picture'), file, link, rm, msg, row);
  box.append(prev, col);
  file.onchange = async () => { const d = await pictureToThumb(file.files[0]); if (!d) { msg.textContent = 'That picture could not be used. Try a png, jpeg, webp or gif.'; return; } pic = d; link.value = ''; msg.textContent = ''; paintPrev(); };
  link.oninput = () => { pic = link.value.trim(); paintPrev(); };
  rm.onclick = () => { pic = ''; link.value = ''; file.value = ''; paintPrev(); };
  cn.onclick = () => again();
  sv.onclick = async () => { sv.disabled = true; try { await post(api, 'api/mytools/update', { name: t.name, newName: nm.value, title: ti.value, what: wh.value, thumb: pic }); again(); } catch (e) { sv.disabled = false; msg.textContent = e.message; } };
  return box;
}
