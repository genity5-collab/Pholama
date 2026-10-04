// "Connect ChatGPT" card (PC app only). Turns the ChatGPT connection on or off, makes a key just for ChatGPT, and shows the steps.
// ChatGPT reaches Pholama through a public https address, so this PC has to be exposed with a tunnel (Tailscale Funnel is the one we recommend).
export const TOOL_LIST = ['Pholama news', 'Web search', 'Installed models', 'Credits left'];
export function connectorUrl(base) {   // what the person pastes into ChatGPT: the https address of their tunnel + /mcp
  let b = String(base || '').trim().replace(/\/+$/, '').replace(/\/mcp$/i, '');
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  try { const u = new URL(b); if (u.protocol !== 'https:') return ''; return u.origin + '/mcp'; } catch { return ''; }   // ChatGPT only accepts https
}
export const STEPS = [
  'Turn the switch below on.',
  'Press "Make a ChatGPT key" and copy it. It is shown once.',
  'Expose this PC with Tailscale Funnel: run  tailscale funnel 11435  and copy the https address it prints.',
  'In ChatGPT: Settings > Connectors > Advanced > turn on Developer mode (needs a paid plan).',
  'Add a connector: paste your address ending in /mcp, choose "API key / Bearer" and paste the key.',
];
export function buildChatGptCard({ api, parent }) {
  const box = document.createElement('div'); box.className = 'gptbox'; box.style.cssText = 'margin:8px 0;padding:10px 12px;border:1px solid var(--line,#ddd);border-radius:12px';
  const top = document.createElement('label'); top.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer';
  const cb = document.createElement('input'); cb.type = 'checkbox'; const t = document.createElement('b'); t.textContent = 'Connect ChatGPT to Pholama'; top.append(cb, t);
  const info = document.createElement('div'); info.className = 'sys'; info.style.cssText = 'text-align:left;margin:6px 0';
  const steps = document.createElement('ol'); steps.style.cssText = 'text-align:left;margin:6px 0 6px 18px;padding:0'; for (const s of STEPS) { const li = document.createElement('li'); li.textContent = s; steps.appendChild(li); }
  const keyBtn = document.createElement('button'); keyBtn.textContent = 'Make a ChatGPT key';
  const keyOut = document.createElement('input'); keyOut.readOnly = true; keyOut.style.cssText = 'display:none;width:100%;box-sizing:border-box;margin-top:6px'; keyOut.onclick = () => keyOut.select();
  const addr = document.createElement('input'); addr.placeholder = 'Your tunnel address, for example https://my-pc.tail1234.ts.net'; addr.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px';
  const url = document.createElement('div'); url.className = 'sys'; url.style.cssText = 'text-align:left;margin-top:4px;word-break:break-all';
  const msg = document.createElement('div'); msg.className = 'sys'; msg.style.cssText = 'text-align:left;margin-top:6px';
  const paint = () => { info.textContent = cb.checked ? 'On. ChatGPT can use only these read-only tools: ' + TOOL_LIST.join(', ') + '. It cannot read your files, run commands, use GitHub or see your keys. It needs the key below on every call.' : 'Off. Nothing outside this PC can reach Pholama through this connection.'; const u = connectorUrl(addr.value); url.textContent = u ? 'Paste this into ChatGPT: ' + u : (addr.value.trim() ? 'ChatGPT needs an https address.' : ''); };
  async function load() { try { cb.checked = (await (await api('api/mcp-server')).json()).on === true; } catch { cb.checked = false; } paint(); }
  cb.onchange = async () => { try { const r = await api('api/mcp-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: cb.checked }) }); cb.checked = (await r.json()).on === true; } catch { msg.textContent = 'Could not change it.'; } paint(); };
  keyBtn.onclick = async () => { keyBtn.disabled = true; msg.textContent = ''; try { const r = await api('api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'ChatGPT' }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not make a key.'); keyOut.value = j.key; keyOut.style.display = ''; keyOut.select(); msg.textContent = 'Copy this now. It is not shown again. You can remove it any time in Remote access.'; } catch (e) { msg.textContent = e.message; } finally { keyBtn.disabled = false; } };
  addr.oninput = paint;
  box.append(top, info, steps, keyBtn, keyOut, addr, url, msg); parent.appendChild(box); load();
}
