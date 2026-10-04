// Pholama dashboard: the landing view. Shows the newest version, what's new, newest models and your setup at a glance.
// Self-contained: reads releases.json and models.json, needs nothing from the chat code except two callbacks.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = ym => { const [y, m] = String(ym || '').split('-'); return m ? MON[+m - 1] + ' ' + y : ''; };
const fmtDay = d => { const [y, m, dd] = String(d || '').split('-'); return dd ? +dd + ' ' + MON[+m - 1] + ' ' + y : ''; };
const TIER = { good: ['Runs tools', 'ok'], basic: ['Basic tools', 'warn'], none: ['Chat only', ''] };

// Pure helpers (tested without a browser).
export function newestModels(list, n = 6) {
  return (list || []).filter(m => m.released).slice().sort((a, b) => b.released.localeCompare(a.released) || (b.sizeGB || 0) - (a.sizeGB || 0)).slice(0, n);
}
export function stats(list) {
  const l = list || [], gb = l.reduce((s, m) => s + (m.sizeGB || 0), 0);
  return { total: l.length, tools: l.filter(m => m.toolTier === 'good').length, basic: l.filter(m => m.toolTier === 'basic').length, chat: l.filter(m => m.toolTier === 'none').length, families: new Set(l.map(m => m.family).filter(Boolean)).size, gb: Math.round(gb) };
}
export function pickForRam(list, ramGB) {   // the best model that really runs tools and fits: biggest "good" model within the RAM
  const ok = (list || []).filter(m => m.toolTier === 'good' && m.minRamGB <= ramGB).sort((a, b) => b.sizeGB - a.sizeGB);
  return ok[0] || null;
}
export function compareVersions(a, b) {
  const p = s => String(s || '0').split('.').map(x => parseInt(x, 10) || 0); const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0;
}

const card = (title, body, cls = '') => `<section class="dcard ${cls}"><h3>${esc(title)}</h3>${body}</section>`;

export async function mountDashboard(el, ctx) {
  // ctx: { server (hardware info or null), openChat(prompt?), openModels(), installedCount?, credits? }
  el.innerHTML = '<div class="dload">Loading...</div>';
  let rel = null, models = [];
  try { rel = await (await fetch('releases.json', { cache: 'no-cache' })).json(); } catch {}
  try { const j = await (await fetch('models.json', { cache: 'no-cache' })).json(); models = j.local || []; } catch {}
  const st = stats(models), latest = rel && rel.releases && rel.releases[0], hw = ctx.server;
  let yourVer = null, updNote = '';
  if (hw) { try { const u = await (await fetch('/api/update')).json(); yourVer = u.current || u.version || null; if (yourVer && rel && compareVersions(yourVer, rel.latest) < 0) updNote = `Update available: you have ${yourVer}, the newest is ${rel.latest}.`; } catch {} }

  const top = `<div class="dhero"><div><h2>Pholama</h2><p>Run AI on your own device. Free and private.</p></div><div class="dver"><span class="dbadge">${latest ? 'v' + esc(latest.version) : ''}</span><small>${latest ? 'Newest version, ' + fmtDay(latest.date) : ''}</small></div></div>` +
    (updNote ? `<div class="dnote">${esc(updNote)}</div>` : '');

  const tiles = `<div class="dtiles">
    <div class="dtile"><b>${st.total}</b><span>PC models</span></div>
    <div class="dtile"><b>${st.tools}</b><span>Run tools</span></div>
    <div class="dtile"><b>${st.families}</b><span>Model makers</span></div>
    <div class="dtile"><b>19</b><span>Built-in tools</span></div></div>`;

  const nm = newestModels(models, 6);
  const newest = card('Newest models', nm.length ? `<ul class="dlist">${nm.map(m => { const t = TIER[m.toolTier] || TIER.none; return `<li><div><b>${esc(m.name)}</b><small>${esc(m.params || '')} · ${m.sizeGB} GB · needs ${m.minRamGB} GB RAM · ${fmtMonth(m.released)}</small></div><span class="dchip ${t[1]}">${t[0]}</span></li>`; }).join('')}</ul><button class="dlink" data-go="models">Browse all ${st.total} models</button>` : '<p class="dmut">No model data yet.</p>');

  const whatsNew = card('What\'s new', latest ? `<div class="dnewhead"><b>${esc(latest.title)}</b><small>v${esc(latest.version)}</small></div><ul class="dbul">${latest.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>${rel.releases.length > 1 ? `<details><summary>Earlier versions</summary>${rel.releases.slice(1).map(r => `<div class="dold"><b>v${esc(r.version)}</b> <small>${fmtDay(r.date)}</small> · ${esc(r.title)}<ul class="dbul">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('')}</details>` : ''}` : '<p class="dmut">Could not load the version history.</p>');

  let yours = '';
  if (hw) {
    const pick = pickForRam(models, hw.ramGB || 0);
    yours = card('Your PC', `<ul class="dkv"><li><span>Memory</span><b>${esc(hw.ramGB)} GB</b></li>${hw.gpu ? `<li><span>Graphics</span><b>${esc(hw.gpu)}${hw.vramGB ? ' · ' + esc(hw.vramGB) + ' GB' : ''}</b></li>` : ''}${yourVer ? `<li><span>Version</span><b>${esc(yourVer)}</b></li>` : ''}</ul>` +
      (pick ? `<div class="dpick">Best tool model for this PC: <b>${esc(pick.name)}</b> <small>(${pick.sizeGB} GB)</small></div>` : '<div class="dpick">Your PC is short on memory for tool models. Small models still chat well.</div>'));
  } else {
    yours = card('Get more power', '<p class="dmut">The PC app adds tools, web search, file editing and Roblox Studio building. Everything runs on your own computer.</p><a class="dlink" href="https://github.com/genity5-collab/Pholama#on-your-pc-more-power-tools-web-search" target="_blank" rel="noopener">Get Pholama PC</a>');
  }

  const actions = card('Start', `<div class="dact"><button class="p" data-go="chat">Open chat</button><button data-go="models">Models</button>${hw ? '<button data-go="studio">Roblox Studio</button>' : ''}<button data-go="prompt" data-p="Explain how a rocket works">Try a question</button></div>`);
  const api = hw ? card('Use it in your game or site', `<p class="dmut">Your PC answers like Ollama and OpenAI at <code>${esc(location.origin)}/v1</code>.</p><a class="dlink" href="/api/docs" target="_blank" rel="noopener">Open the API guide</a>`) : '';

  el.innerHTML = `<div class="dwrap">${top}${tiles}<div class="dgrid">${actions}${newest}${whatsNew}${yours}${api}</div></div>`;
  el.onclick = e => {
    const b = e.target.closest('[data-go]'); if (!b) return; const go = b.dataset.go;
    if (go === 'chat') ctx.openChat(); else if (go === 'models') ctx.openModels(); else if (go === 'studio' && ctx.openStudio) ctx.openStudio(); else if (go === 'prompt') ctx.openChat(b.dataset.p);
  };
}
