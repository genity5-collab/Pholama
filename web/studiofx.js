// Studio "AI is editing" effects. The diff is plain logic (tested in test/studiofx.test.js); the drawing part only touches the screen.

// Which lines of `next` are new or changed compared to `prev`? Returns 0-based line numbers.
// Lines are matched in order (a simple longest-common-subsequence), so inserting a line at the top does not light up the whole file.
export function changedLines(prev, next) {
  const a = String(prev || '').split('\n'), b = String(next || '').split('\n');
  if (a.length * b.length > 4e6) { const out = []; for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) out.push(i); return out; }   // huge file: cheap line-by-line check
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const same = new Set(); let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { same.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const out = []; for (let k = 0; k < m; k++) if (!same.has(k)) out.push(k);
  return out;
}

// Turn a list of line numbers into runs, so the screen draws a few bars instead of hundreds. [2,3,4,9] -> [{from:2,to:4},{from:9,to:9}]
export function runs(lines) {
  const out = []; for (const n of lines) { const l = out[out.length - 1]; if (l && n === l.to + 1) l.to = n; else out.push({ from: n, to: n }); } return out;
}

// What the status strip says. Only file-changing tools count as "editing"; reading and searching say "looking".
const WRITE = /^studio_(write|patch|create|delete)$/, READ = /^studio_(read|read_numbered|files|lines|projects)$/, TEST = /^studio_(check|run_js)$/;
export function toolStatus(tool) {
  const name = String((tool && tool.name) || ''), file = tool && tool.args && tool.args.file ? String(tool.args.file).slice(0, 60) : '';
  if (WRITE.test(name)) return { kind: 'edit', file, text: (name === 'studio_delete' ? 'Removing ' : name === 'studio_create' ? 'Creating ' : 'Editing ') + (file || 'your project') };
  if (READ.test(name)) return { kind: 'look', file, text: 'Reading ' + (file || 'your project') };
  if (TEST.test(name)) return { kind: 'test', file, text: name === 'studio_check' ? 'Checking the code for mistakes' : 'Testing your code' };
  return { kind: 'work', file, text: 'Working' + (file ? ' on ' + file : '') };
}

const REDUCED = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The visual layer. It sits on top of the editor with pointer-events:none, so typing and clicking are never blocked.
export function createFx({ host, code, tabs, frame }) {
  const layer = document.createElement('div'); layer.className = 'stfx'; layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<div class="stfx-scan"></div><div class="stfx-flashes"></div>';
  const strip = document.createElement('div'); strip.className = 'stfx-strip'; strip.setAttribute('role', 'status'); strip.hidden = true;
  strip.innerHTML = '<span class="stfx-dot"></span><span class="stfx-txt"></span><span class="stfx-dots"><i></i><i></i><i></i></span>';
  host.style.position = host.style.position || 'relative'; host.append(layer, strip);
  const scan = layer.firstChild, flashes = layer.lastChild, txt = strip.querySelector('.stfx-txt');
  let active = 0, hideTimer = 0;

  function working(status) {
    clearTimeout(hideTimer); active++;
    txt.textContent = status.text; strip.dataset.kind = status.kind; strip.hidden = false; layer.classList.add('on');
    if (status.file && tabs) for (const b of tabs.children) if (b.textContent.replace(/\s*\u2022$/, '') === status.file) { b.classList.add('stfx-busy'); }
  }
  function idle() {
    active = Math.max(0, active - 1); if (active) return;
    hideTimer = setTimeout(() => { strip.hidden = true; layer.classList.remove('on'); if (tabs) for (const b of tabs.children) b.classList.remove('stfx-busy'); }, 500);
  }
  function lineHeight() { const cs = getComputedStyle(code); const lh = parseFloat(cs.lineHeight); return lh > 0 ? lh : parseFloat(cs.fontSize) * 1.6; }
  // Flash the changed lines green, then let them fade. Bars follow the editor's scroll so they stay on the right lines.
  function landed(prev, next) {
    if (REDUCED()) return 0;
    const lines = changedLines(prev, next); if (!lines.length) return 0;
    const lh = lineHeight(), pad = parseFloat(getComputedStyle(code).paddingTop) || 0, r = runs(lines.slice(0, 400));
    flashes.textContent = ''; flashes.style.transform = `translateY(${-code.scrollTop}px)`;
    const first = lines[0]; code.scrollTop = Math.max(0, first * lh - code.clientHeight / 3);   // bring the first change into view
    flashes.style.transform = `translateY(${-code.scrollTop}px)`;
    r.forEach((run, k) => {
      const bar = document.createElement('div'); bar.className = 'stfx-bar';
      bar.style.cssText = `top:${pad + run.from * lh}px;height:${(run.to - run.from + 1) * lh}px;animation-delay:${Math.min(k * 70, 700)}ms`;
      flashes.appendChild(bar);
    });
    setTimeout(() => { flashes.textContent = ''; }, 2600);
    return lines.length;
  }
  // The tab bar is rebuilt whenever Studio repaints it, which would wipe a running pulse. So remember which files are pulsing and put the class back on the new buttons.
  const pulsing = new Map();
  const tabName = b => b.textContent.replace(/\s*\u2022$/, '');
  function pulseTab(name) {
    if (!tabs || REDUCED()) return; pulsing.set(name, Date.now() + 1300); setTimeout(() => pulsing.delete(name), 1350);
    for (const b of tabs.children) if (tabName(b) === name) { b.classList.remove('stfx-pulse'); void b.offsetWidth; b.classList.add('stfx-pulse'); }
  }
  function restoreTabs() {   // call after the tab bar was repainted
    const now = Date.now();
    for (const b of tabs.children) { const until = pulsing.get(tabName(b)); if (until && until > now) { b.style.animationDuration = Math.max(0.05, (until - now) / 1000) + 's'; b.classList.add('stfx-pulse'); } }
  }
  function pulsePreview() { if (!frame || REDUCED()) return; frame.classList.remove('stfx-reload'); void frame.offsetWidth; frame.classList.add('stfx-reload'); }
  code.addEventListener('scroll', () => { flashes.style.transform = `translateY(${-code.scrollTop}px)`; }, { passive: true });
  return { working, idle, landed, pulseTab, restoreTabs, pulsePreview, layer, strip };
}
