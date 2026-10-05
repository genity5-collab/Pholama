// The Studio companion's little life: it wanders around the screen, naps when idle, and codes on a tiny laptop while the AI is building.
// Pure decisions live here (no DOM) so they can be tested. studio.js does the moving and drawing. ES module like studio.js.
  const CODE = [
    'const app = express();', 'app.get("/", (q, r) => r.send(page));', 'function draw(ctx) {', '  ctx.fillRect(x, y, 8, 8);', '}',
    'let score = 0;', 'for (const c of cards) show(c);', 'if (hp <= 0) gameOver();', '<div class="card">', '  <h1>Hello</h1>', '</div>',
    'button.onclick = () => go();', 'export default App;', 'await save(file);', 'return items.map(render);', '.box { display: grid; }',
    'npm run build', 'git commit -m "ship it"', 'const ok = test(all);', '// TODO: make it shine'];
  const SAYS = { walk: ['on a stroll', 'nice day', 'exploring', 'hi there'], code: ['coding...', 'compiling...', 'adding a feature', 'fixing a bug', 'almost there'], nap: ['zzz', 'nap time'], idle: ['hmm', 'what next?', 'ready'] };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // next place to wander to: a short hop (never a teleport across the screen), kept inside the window
  function pickSpot(pos, box, rnd) {
    rnd = rnd || Math.random; const size = 56, pad = 8;
    const maxX = Math.max(pad, box.w - size - pad), maxY = Math.max(pad, box.h - size - pad);
    const hop = 90 + rnd() * 170, ang = rnd() * Math.PI * 2;
    return { x: clamp(pos.x + Math.cos(ang) * hop, pad, maxX), y: clamp(pos.y + Math.sin(ang) * hop * 0.6, pad, maxY) };
  }
  // what to do next. busy = the AI is really building; blocked = user is dragging / a menu is open / reduced motion
  function nextMood(s, rnd) {
    rnd = rnd || Math.random;
    if (s.blocked) return 'idle';
    if (s.busy) return 'code';
    if (s.idleSeconds > 90) return 'nap';
    return rnd() < 0.72 ? 'walk' : 'idle';
  }
  // how long a walk takes (ms), based on distance, so it looks like walking and not sliding
  const walkMs = (a, b) => clamp(Math.hypot(b.x - a.x, b.y - a.y) * 14, 700, 3200);
  // a window of typed code: `tick` grows by one every ~90 ms; shows the last `rows` lines, the newest one half typed
  function codeView(tick, rows, cols) {
    rows = rows || 4; cols = cols || 22; const lines = [], total = Math.max(0, tick);
    let left = total, i = 0;
    while (left > 0 && lines.length < 400) { const l = CODE[i % CODE.length].slice(0, cols); if (left >= l.length + 2) { lines.push(l); left -= l.length + 2; i++; } else { lines.push(l.slice(0, left)); left = 0; } }
    return lines.slice(-rows);
  }
  const say = (mood, rnd) => { rnd = rnd || Math.random; const a = SAYS[mood] || SAYS.idle; return a[Math.floor(rnd() * a.length) % a.length]; };
export { pickSpot, nextMood, walkMs, codeView, say, CODE };
