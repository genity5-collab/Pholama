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

// The "My tools" panel: list, switch, delete, make a tool, save secrets.
export async function paintMyTools(root, api) {
  let d; try { d = await (await api('api/mytools')).json(); } catch { return; }
  root.textContent = '';
  const info = mk('div', 'sys', 'Make your AI able to use any web service: Supabase, Discord, Notion, your own API. Keys stay on this PC and the AI never sees them. Anything that changes data asks for your OK first.'); info.style.textAlign = 'left'; root.append(info);
  const list = mk('div'); root.append(list);
  if (!d.tools.length) list.append(mk('div', 'sys', 'No tools yet. Make one below, or ask the AI: "make a tool that posts to my Discord".'));
  for (const t of d.tools) {
    const row = mk('div', 'sys'); row.style.cssText = 'display:flex;gap:6px;align-items:center;text-align:left';
    const cb = mk('input'); cb.type = 'checkbox'; cb.checked = t.on; const tx = mk('span', null, 'x_' + t.name + ' (' + t.method + '): ' + t.what + (t.by === 'ai' ? ' (made by the AI)' : '')); tx.style.flex = '1';
    const del = mk('button', null, 'Delete'); del.type = 'button'; row.append(cb, tx, del); list.append(row);
    cb.onchange = async () => { await api('api/mytools/switch', { method: 'POST', body: JSON.stringify({ name: t.name, on: cb.checked }) }); paintMyTools(root, api); };
    del.onclick = async () => { if (!confirm('Delete the tool "' + t.name + '"?')) return; await api('api/mytools/delete', { method: 'POST', body: JSON.stringify({ name: t.name }) }); paintMyTools(root, api); };
  }
  const f = mk('div'); f.style.cssText = 'display:grid;gap:6px;margin-top:10px;text-align:left'; root.append(f);
  const inp = (ph, tag = 'input') => { const e = mk(tag); e.placeholder = ph; return e; };
  const name = inp('Name, like supabase_read'), what = inp('What it does, in one sentence'), method = mk('select'), url = inp('https://your-project.supabase.co/rest/v1/{{table}}'), hdr = inp('Headers, one per line: apikey: {{secret.SB_KEY}}', 'textarea'), body = inp('Body (for POST/PUT/PATCH), like {"text":"{{text}}"}', 'textarea'), params = inp('Values the AI fills in, comma separated: table, text');
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) method.append(new Option(m, m));
  hdr.rows = 2; body.rows = 2; const save = mk('button', 'p', 'Make the tool'), msg = mk('small'); 
  f.append(mk('b', null, 'Make a tool'), name, what, method, url, hdr, body, params, save, msg);
  save.onclick = async () => {
    const headers = {}; for (const l of hdr.value.split('\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    try { const r = await api('api/mytools/save', { method: 'POST', body: JSON.stringify({ name: name.value, what: what.value, method: method.value, url: url.value, headers, body: body.value, params: params.value.split(',').map(x => x.trim()).filter(Boolean) }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); paintMyTools(root, api); }
    catch (e) { msg.textContent = 'Could not make it: ' + e.message; }
  };
  const sf = mk('div'); sf.style.cssText = 'display:grid;gap:6px;margin-top:12px;text-align:left'; root.append(sf);
  const sn = inp('Secret name, like SB_KEY'), sv = inp('Secret value'); sv.type = 'password'; sv.autocomplete = 'off';
  const ss = mk('button', null, 'Save secret'), sm = mk('small', null, 'Saved secrets: ' + (d.secrets.length ? d.secrets.join(', ') : 'none') + '. Values are never shown again. Save an empty value to delete one.');
  sf.append(mk('b', null, 'Secrets'), sn, sv, ss, sm);
  ss.onclick = async () => { try { const r = await api('api/mytools/secret', { method: 'POST', body: JSON.stringify({ name: sn.value, value: sv.value }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); sv.value = ''; paintMyTools(root, api); } catch (e) { sm.textContent = 'Could not save: ' + e.message; } };
}
