// "Your own AI keys" panel: use ChatGPT, Gemini, Groq and others with your own account.
// Only on the PC app. The key is sent to this PC once, stored there, and never shown again (only the last 4 characters).
export function keyLine(p) { return (p && p.name ? p.name : 'Key') + ' · ' + (p && p.model ? p.model : '') + ' · key ' + (p && p.hint ? p.hint : ''); }
export function friendlyModelName(value, providers) {   // "byok:groq-llama" -> "Groq (llama-3.3-70b-versatile)"
  const id = String(value || '').replace(/^byok:/, ''); const p = (providers || []).find(x => x.id === id);
  return p ? p.name + ' (' + p.model + ')' : id;
}

export function buildKeysPanel({ api, parent, onChange }) {
  const box = document.createElement('div'); box.className = 'keysbox'; box.style.cssText = 'margin:8px 0;padding:10px 12px;border:1px solid var(--line,#ddd);border-radius:12px';
  const head = document.createElement('b'); head.textContent = 'Your own AI keys (ChatGPT, Gemini, Groq...)';
  const info = document.createElement('div'); info.className = 'sys'; info.style.cssText = 'text-align:left;margin:6px 0';
  info.textContent = 'Use an AI from your own account. The key stays on this PC, is never shown again, and is only sent to the company it belongs to. You pay that company directly. They work in Chat and in Studio.';
  const listBox = document.createElement('div');
  const form = document.createElement('div'); form.style.cssText = 'display:none;margin-top:8px;gap:6px;flex-direction:column';
  const kind = document.createElement('select'), model = document.createElement('input'), base = document.createElement('input'), key = document.createElement('input'), note = document.createElement('div'), msg = document.createElement('div');
  model.placeholder = 'Model name'; base.placeholder = 'Address, for example https://your-server.com/v1'; key.placeholder = 'Paste your key'; key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false;
  for (const el of [model, base, key]) el.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px';
  note.className = 'sys'; note.style.cssText = 'text-align:left;margin-top:4px'; msg.className = 'sys'; msg.style.cssText = 'text-align:left;margin-top:6px';
  const save = document.createElement('button'); save.textContent = 'Save key'; save.style.marginTop = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Add a key'; addBtn.style.marginTop = '6px';
  let known = [], providers = [];
  const paintKind = () => { const k = known.find(x => x.id === kind.value) || {}; model.value = k.model || ''; model.placeholder = k.model || 'Model name'; base.style.display = k.custom ? '' : 'none'; note.textContent = k.note ? 'Get a key at ' + k.note : ''; };
  kind.onchange = paintKind;
  const paintList = () => {
    listBox.innerHTML = '';
    if (!providers.length) { const e = document.createElement('div'); e.className = 'sys'; e.style.textAlign = 'left'; e.textContent = 'No keys yet.'; listBox.appendChild(e); }
    for (const p of providers) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;justify-content:space-between';
      const t = document.createElement('span'); t.textContent = keyLine(p); t.style.wordBreak = 'break-word';
      const del = document.createElement('button'); del.textContent = 'Remove';
      del.onclick = async () => { del.disabled = true; try { await api('api/providers?id=' + encodeURIComponent(p.id), { method: 'DELETE' }); } catch {} await load(); if (onChange) onChange(); };
      const chg = document.createElement('button'); chg.textContent = 'Change model';
      const pick = document.createElement('select'); pick.style.display = 'none'; const status = document.createElement('div'); status.className = 'sys'; status.style.cssText = 'text-align:left;flex-basis:100%';
      chg.onclick = async () => {   // ask the company which models this key can use right now
        chg.disabled = true; status.textContent = 'Asking ' + (p.name || 'the company') + ' which models your key can use...';
        try {
          const r = await api('api/providers/models?id=' + encodeURIComponent(p.id)); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not check.');
          pick.innerHTML = ''; for (const m of j.models) pick.add(new Option(m, m, false, m === p.model)); if (!j.currentOk) pick.add(new Option(p.model + ' (not available)', p.model, false, true), 0);
          pick.style.display = ''; status.textContent = j.currentOk ? 'Your key can use these models. Pick one.' : 'The model "' + p.model + '" is not available for this key any more. Pick another one.';
        } catch (e) { status.textContent = e.message; } finally { chg.disabled = false; }
      };
      pick.onchange = async () => { try { const r = await api('api/providers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, model: pick.value }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not change it.'); status.textContent = 'Now using ' + pick.value + '.'; await load(); if (onChange) onChange(); } catch (e) { status.textContent = e.message; } };
      row.style.flexWrap = 'wrap'; row.append(t, chg, del, pick, status); listBox.appendChild(row);
    }
  };
  async function load() {
    try { const j = await (await api('api/providers')).json(); providers = j.providers || []; known = j.known || []; } catch { providers = []; }
    if (!kind.options.length) for (const k of known) kind.add(new Option(k.name, k.id));
    paintKind(); paintList();
  }
  addBtn.onclick = () => { form.style.display = form.style.display === 'none' ? 'flex' : 'none'; };
  save.onclick = async () => {
    msg.textContent = 'Checking your key with the company...'; save.disabled = true;
    try {
      const r = await api('api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind.value, key: key.value, model: model.value, base: base.value }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not save.');
      key.value = ''; msg.textContent = 'Saved and checked with ' + (j.provider && j.provider.name || 'the company') + '. ' + (j.note ? j.note + ' ' : '') + 'Pick it in the model list at the top.'; form.style.display = 'none'; await load(); if (onChange) onChange();
    } catch (e) { msg.textContent = e.message; } finally { save.disabled = false; }
  };
  form.append(kind, model, base, key, note, save);
  box.append(head, info, listBox, addBtn, form, msg); parent.appendChild(box); load();
  return { reload: load, providers: () => providers };
}
