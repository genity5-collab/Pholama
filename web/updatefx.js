// Pholama update animations: (1) a banner when an update is ready, (2) a full-screen "installing" scene while the app restarts,
// (3) a "What's new" celebration the first time you open a new version. The logic is plain and tested (test/updatefx.test.js).
const KEY_SEEN = 'pholama_seen_version', KEY_PENDING = 'pholama_updating_to';

// "0.9.14" > "0.9.9"? Compare as numbers, not text.
export function cmpVer(a, b) {
  const p = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0;
}
// Releases newer than the last version you saw, up to and including the one you run now. Newest first, at most 5 so the card stays short.
export function newSince(releases, seen, current) {
  const list = Array.isArray(releases) ? releases : [];
  return list.filter(r => r && r.version && cmpVer(r.version, current) <= 0 && (!seen || cmpVer(r.version, seen) > 0)).sort((a, b) => cmpVer(b.version, a.version)).slice(0, 5);
}
// Show the celebration only when there is something new AND this is not the very first run on this device (a brand new user has not "updated").
export function shouldCelebrate(seen, current, fresh) { return !!seen && cmpVer(current, seen) > 0 && fresh.length > 0; }
// The installing scene is a list of steps. Progress is where we are in the list, so the ring never jumps backwards.
export const STEPS = [{ id: 'save', text: 'Saving your chats and settings' }, { id: 'stop', text: 'Closing the old version' }, { id: 'start', text: 'Starting the new version' }, { id: 'load', text: 'Loading your new Pholama' }];
export function progress(stepIndex, total = STEPS.length) { const i = Math.max(0, Math.min(total, stepIndex)); return Math.round((i / total) * 100); }
// Keep at most 6 notes per release and trim very long ones so the card never overflows.
export function tidyNotes(notes, max = 6, len = 140) { return (Array.isArray(notes) ? notes : []).filter(n => typeof n === 'string' && n.trim()).slice(0, max).map(n => n.length > len ? n.slice(0, len - 1).trimEnd() + '\u2026' : n); }

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- 1. the banner ----
export function showBanner({ version, title, onRestart }) {
  let b = document.getElementById('updBanner');
  if (!b) { b = el('div', 'updb'); b.id = 'updBanner'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
  b.innerHTML = `<span class="updb-ico"><i></i></span><span class="updb-txt"><b>Version ${esc(version)} is ready</b><small>${esc(title || 'New features are waiting')}</small></span><button class="p updb-go">Update now</button><button class="updb-x" aria-label="Later">\u00d7</button>`;
  b.classList.remove('out'); b.classList.add('in'); b.querySelector('.updb-go').onclick = () => { onRestart && onRestart(); };
  b.querySelector('.updb-x').onclick = () => { b.classList.add('out'); setTimeout(() => b.remove(), 400); };
  return b;
}
export function hideBanner() { const b = document.getElementById('updBanner'); if (b) { b.classList.add('out'); setTimeout(() => b.remove(), 400); } }

// ---- 2. the installing scene ----
export function openInstalling(version) {
  try { localStorage.setItem(KEY_PENDING, version || ''); } catch {}
  let o = document.getElementById('updScene'); if (o) o.remove();
  o = el('div', 'upds'); o.id = 'updScene'; o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-label', 'Updating Pholama');
  o.innerHTML = `<div class="upds-glow"></div><div class="upds-card"><div class="upds-ring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52" pathLength="100"/></svg><span class="upds-pct">0%</span></div><h3>Updating Pholama${version ? ' to ' + esc(version) : ''}</h3><div class="upds-step">Getting ready</div><ol class="upds-list">${STEPS.map(s => `<li data-id="${s.id}"><i></i>${esc(s.text)}</li>`).join('')}</ol><small>Please keep this window open. It only takes a moment.</small></div><div class="upds-dust"></div>`;
  document.body.appendChild(o);
  if (!reduced()) { const d = o.querySelector('.upds-dust'); for (let i = 0; i < 18; i++) { const p = el('i'); p.style.cssText = `left:${(i * 37) % 100}%;animation-delay:${(i % 9) * 0.35}s;animation-duration:${4 + (i % 5)}s;--s:${0.5 + (i % 4) * 0.25}`; d.appendChild(p); } }
  const api = {
    step(i) {
      const items = [...o.querySelectorAll('.upds-list li')]; items.forEach((li, k) => { li.classList.toggle('done', k < i); li.classList.toggle('now', k === i); });
      const pct = progress(i); o.querySelector('.fg').style.strokeDashoffset = String(100 - pct); o.querySelector('.upds-pct').textContent = pct + '%';
      o.querySelector('.upds-step').textContent = STEPS[Math.min(i, STEPS.length - 1)].text + '...';
    },
    done() { api.step(STEPS.length); o.querySelector('.upds-step').textContent = 'All set'; o.classList.add('ok'); },
    fail(msg) { o.classList.add('bad'); o.querySelector('.upds-step').textContent = msg || 'Something went wrong'; setTimeout(() => o.remove(), 4200); },
    close() { o.classList.add('out'); setTimeout(() => o.remove(), 500); },
  };
  api.step(0); return api;
}

// ---- 3. the celebration ----
export function showWhatsNew(fresh, current) {
  const old = document.getElementById('updNew'); if (old) old.remove();
  const o = el('div', 'updn'); o.id = 'updNew'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'What is new in Pholama');
  const body = fresh.map(r => `<section><h4>${esc(r.title || 'Version ' + r.version)}<em>${esc(r.version)}</em></h4><ul>${tidyNotes(r.notes).map((n, i) => `<li style="animation-delay:${0.35 + i * 0.12}s">${esc(n)}</li>`).join('')}</ul></section>`).join('');
  o.innerHTML = `<div class="updn-card"><div class="updn-burst"></div><div class="updn-badge">NEW</div><h2>Pholama ${esc(current)} is here</h2><div class="updn-body">${body}</div><button class="p updn-go">Let's go</button></div>`;
  document.body.appendChild(o);
  if (!reduced()) { const bu = o.querySelector('.updn-burst'); for (let i = 0; i < 26; i++) { const c = el('i'); const a = (i / 26) * Math.PI * 2, d = 90 + (i % 5) * 26; c.style.cssText = `--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d - 30)}px;--rot:${(i * 47) % 360}deg;--c:${i % 3};animation-delay:${(i % 6) * 0.03}s`; bu.appendChild(c); } }
  const close = () => { o.classList.add('out'); setTimeout(() => o.remove(), 420); try { localStorage.setItem(KEY_SEEN, current); localStorage.removeItem(KEY_PENDING); } catch {} document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
  o.querySelector('.updn-go').onclick = close; o.addEventListener('click', e => { if (e.target === o) close(); }); document.addEventListener('keydown', onKey);
  o.querySelector('.updn-go').focus(); return o;
}

// Call once at start-up. Remembers the version on a first run, and celebrates when it is newer than the one last seen.
export async function checkCelebrate(current, getReleases) {
  let seen = null; try { seen = localStorage.getItem(KEY_SEEN); } catch {}
  if (!current) return false;
  if (!seen) { try { localStorage.setItem(KEY_SEEN, current); } catch {} return false; }   // first ever run: nothing to celebrate
  if (cmpVer(current, seen) <= 0) return false;
  let rel = null; try { rel = await getReleases(); } catch {}
  if (!Array.isArray(rel) || !rel.length) return 'retry';   // could not read the release notes: do NOT mark this version as seen, try again later
  const fresh = newSince(rel, seen, current);
  if (!shouldCelebrate(seen, current, fresh)) { try { localStorage.setItem(KEY_SEEN, current); } catch {} return false; }
  showWhatsNew(fresh, current); return true;
}
// Calls checkCelebrate until it has an answer (not 'retry'). Waits a little longer each time, up to `tries` attempts.
export async function celebrateWithRetry(getVersion, getReleases, { tries = 5, wait = ms => new Promise(r => setTimeout(r, ms)), first = 1200, step = 2500 } = {}) {
  await wait(first);
  for (let i = 0; i < tries; i++) {
    let cur = null; try { cur = await getVersion(); } catch {}
    if (cur) { const r = await checkCelebrate(cur, getReleases); if (r !== 'retry') return r; }
    if (i < tries - 1) await wait(step * (i + 1));
  }
  return false;
}

// ---- 4. automatic updates ----
// When the server comes back as a NEW version (an automatic update), play the installing scene to the end, then reload.
// `pending` remembers which version we were moving to, so a page that reloads half way still finishes the story.
export function noteUpdating(version) { try { localStorage.setItem(KEY_PENDING, version || ''); } catch {} }
export function pendingVersion() { try { return localStorage.getItem(KEY_PENDING) || ''; } catch { return ''; } }
export async function playAutoUpdate(version, { reload = () => location.reload(), wait = ms => new Promise(r => setTimeout(r, ms)), open = openInstalling } = {}) {
  const scene = open(version);
  scene.step(1); await wait(600); scene.step(2); await wait(600); scene.step(3); await wait(500);
  scene.done(); await wait(900);
  reload();
}
