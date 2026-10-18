// What the AI "sees" of its own work. A text model cannot look at a picture, so the Studio describes the result in words and drawings it can read:
// a tree of models and parts with exact numbers, a top view and a side view drawn with letters, and a list of anything that looks wrong.
// Pure functions of the simulated parts, so they are cheap, repeatable and testable.

const r1 = n => Math.round(n * 10) / 10;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Half-size of a part's box after its rotation. Parts are [x, depth, height].
function halfExtent(p) {
  const R = p.rot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [0, 1, 2].map(i => (Math.abs(R[i * 3]) * p.size[0] + Math.abs(R[i * 3 + 1]) * p.size[1] + Math.abs(R[i * 3 + 2]) * p.size[2]) / 2);
}
const at = p => p.trueAt || p.position;
export function boxOf(p) {
  const h = halfExtent(p), c = at(p);
  return { lo: c.map((v, i) => v - h[i]), hi: c.map((v, i) => v + h[i]) };
}
const label = p => (p.modelVar ? p.modelVar + '.' : '') + (p.varName || p.name);

// A tree: each model, each part with its real variable, centre, size and the box it covers, written in Roblox order (x, y up, z).
export function describe(parts) {
  if (!parts || !parts.length) return 'Nothing is built yet.';
  const groups = new Map();
  for (const p of parts) { const k = p.modelVar || p.model || '(workspace)'; (groups.get(k) || groups.set(k, []).get(k)).push(p); }
  const out = [];
  for (const [model, ps] of groups) {
    const bs = ps.map(boxOf), lo = [0, 1, 2].map(i => Math.min(...bs.map(b => b.lo[i]))), hi = [0, 1, 2].map(i => Math.max(...bs.map(b => b.hi[i])));
    out.push(`${model}: ${ps.length} part${ps.length === 1 ? '' : 's'}, covers x ${r1(lo[0])}..${r1(hi[0])}, y ${r1(lo[2])}..${r1(hi[2])} (up), z ${r1(lo[1])}..${r1(hi[1])}`);
    for (const p of ps) {
      const c = at(p), s = p.trueSize || p.size, b = boxOf(p);
      out.push(`  ${p.varName || p.name}${p.type && p.type !== 'Part' ? ' [' + p.type + (p.shape && p.shape !== 'Block' ? '/' + p.shape : '') + ']' : p.shape && p.shape !== 'Block' ? ' [' + p.shape + ']' : ''}  centre (${r1(c[0])}, ${r1(c[2])}, ${r1(c[1])})  size (${r1(s[0])}, ${r1(s[2])}, ${r1(s[1])})  bottom ${r1(b.lo[2])}  top ${r1(b.hi[2])}`);
    }
  }
  return out.join('\n');
}

// A drawing made of letters. axes picks which two coordinates form the picture: 'top' looks down (x across, z down), 'side' looks from the front (x across, height up).
export function draw(parts, view = 'top', cols = 48, rows = 18) {
  if (!parts || !parts.length) return '';
  const ax = view === 'top' ? [0, 1] : [0, 2];                 // [across, down-or-up] in preview coordinates [x, depth, height]
  const bs = parts.map(boxOf);
  // One stray part must not squash everything else into a smudge: the picture is scaled to the main group, and a part outside it is marked at the edge with '>' or '<'.
  const mid = k => { const a = parts.map((p, i) => (bs[i].lo[k] + bs[i].hi[k]) / 2).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const reach = k => Math.max(30, ...parts.map((p, i) => Math.max(bs[i].hi[k] - bs[i].lo[k], 0)));
  const m0 = mid(ax[0]), m1 = mid(ax[1]), lim0 = reach(ax[0]) * 3 + 40, lim1 = reach(ax[1]) * 3 + 40;
  const inside = parts.map((p, i) => Math.abs((bs[i].lo[ax[0]] + bs[i].hi[ax[0]]) / 2 - m0) <= lim0 && Math.abs((bs[i].lo[ax[1]] + bs[i].hi[ax[1]]) / 2 - m1) <= lim1);
  const main = bs.filter((b, i) => inside[i]);
  let a0 = Math.min(...main.map(b => b.lo[ax[0]])), a1 = Math.max(...main.map(b => b.hi[ax[0]]));
  let b0 = Math.min(...main.map(b => b.lo[ax[1]])), b1 = Math.max(...main.map(b => b.hi[ax[1]]));
  if (view === 'side') b0 = Math.min(b0, 0);                   // the ground line is always part of the side view
  const sa = Math.max(0.5, a1 - a0), sb = Math.max(0.5, b1 - b0);
  const grid = Array.from({ length: rows }, () => Array(cols).fill('.'));
  const cell = (v, lo, span, n) => Math.max(0, Math.min(n - 1, Math.floor(((v - lo) / span) * n)));
  // draw bigger parts first so small ones stay visible on top of them
  const order = parts.map((p, i) => i).sort((i, j) => { const A = bs[i], B = bs[j]; return (B.hi[ax[0]] - B.lo[ax[0]]) * (B.hi[ax[1]] - B.lo[ax[1]]) - (A.hi[ax[0]] - A.lo[ax[0]]) * (A.hi[ax[1]] - A.lo[ax[1]]); });
  const away = [];
  order.forEach(i => {
    const b = bs[i], ch = LETTERS[i % LETTERS.length];
    if (!inside[i]) {      // outside the picture: put the letter on the nearest edge and say where it really is
      const c = [(b.lo[ax[0]] + b.hi[ax[0]]) / 2, (b.lo[ax[1]] + b.hi[ax[1]]) / 2];
      const gx = c[0] > a1 ? cols - 1 : c[0] < a0 ? 0 : cell(c[0], a0, sa, cols), gy = c[1] > b1 ? rows - 1 : c[1] < b0 ? 0 : cell(c[1], b0, sb, rows);
      grid[gy][gx] = ch; away.push(`${ch} is off the picture at ${view === 'top' ? 'x ' + r1(c[0]) + ', z ' + r1(c[1]) : 'x ' + r1(c[0]) + ', height ' + r1(c[1])}`); return;
    }
    const x0 = cell(b.lo[ax[0]], a0, sa, cols), x1 = cell(b.hi[ax[0]] - 1e-6, a0, sa, cols);
    const y0 = cell(b.lo[ax[1]], b0, sb, rows), y1 = cell(b.hi[ax[1]] - 1e-6, b0, sb, rows);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch;
  });
  if (view === 'side') grid.reverse();                          // height grows upward
  const head = view === 'top' ? `TOP VIEW (looking down). Left to right is x ${r1(a0)}..${r1(a1)}, top to bottom is z ${r1(b0)}..${r1(b1)}.` : `SIDE VIEW (from the front). Left to right is x ${r1(a0)}..${r1(a1)}, bottom to top is height ${r1(b0)}..${r1(b1)}; the ground is height 0.`;
  const key = parts.map((p, i) => `${LETTERS[i % LETTERS.length]}=${label(p)}`).slice(0, 40).join('  ');
  return head + '\n' + grid.map(r => r.join('')).join('\n') + '\n' + key + (away.length ? '\nOutside this picture: ' + away.join('; ') : '');
}

// Things a person would notice at a glance: parts poking out of their model, a gap between pieces, two parts that fill the same space.
export function observations(parts) {
  const notes = [];
  if (!parts || parts.length < 2) return notes;
  const bs = parts.map(boxOf);
  const overlap = (a, b, i) => Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i]);
  // two parts that share nearly the same box are almost certainly a mistake (z-fighting)
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const A = bs[i], B = bs[j];
    const same = [0, 1, 2].every(k => Math.abs(A.lo[k] - B.lo[k]) < 0.15 && Math.abs(A.hi[k] - B.hi[k]) < 0.15);
    if (same) notes.push(`${label(parts[i])} and ${label(parts[j])} fill exactly the same space, so one hides the other.`);
  }
  // a gap: a part whose nearest neighbour is further than 0.6 studs away
  parts.forEach((p, i) => {
    let best = Infinity, who = null;
    bs.forEach((b, j) => { if (j === i) return; const gap = Math.hypot(...[0, 1, 2].map(k => Math.max(0, bs[i].lo[k] - b.hi[k], b.lo[k] - bs[i].hi[k]))); if (gap < best) { best = gap; who = parts[j]; } });
    if (best > 0.6 && who) notes.push(`${label(p)} has a gap of ${r1(best)} studs to its nearest part (${label(who)}). It floats apart from the rest.`);
  });
  // a part sticking out of its own model: far outside the others' combined box
  const byModel = new Map(); parts.forEach((p, i) => { const k = p.modelVar || p.model || ''; if (k) (byModel.get(k) || byModel.set(k, []).get(k)).push(i); });
  for (const [m, idx] of byModel) {
    if (idx.length < 3) continue;
    for (const i of idx) {
      const others = idx.filter(j => j !== i), lo = [0, 1, 2].map(k => Math.min(...others.map(j => bs[j].lo[k]))), hi = [0, 1, 2].map(k => Math.max(...others.map(j => bs[j].hi[k])));
      const out = [0, 1, 2].map(k => Math.max(0, lo[k] - bs[i].hi[k], bs[i].lo[k] - hi[k]));
      const d = Math.hypot(...out); if (d > 10) notes.push(`${label(parts[i])} is ${Math.round(d)} studs outside the box of the other parts of ${m}.`);
    }
  }
  return notes;
}

// The whole report the AI reads after it runs a script.
export function lookReport(parts, extra = {}) {
  const lines = ['WHAT YOU BUILT (the Studio ran your script):', describe(parts)];
  if (parts && parts.length) {
    lines.push('', draw(parts, 'top'), '', draw(parts, 'side'));
    const obs = observations(parts);
    lines.push('', obs.length ? 'LOOKS WRONG:\n' + obs.map(o => '- ' + o).join('\n') : 'Nothing looks wrong from the top or the side.');
  }
  if (extra.prints && extra.prints.length) lines.push('', 'Your script printed: ' + extra.prints.slice(0, 6).join(' | '));
  if (extra.gui && extra.gui.length) lines.push('', 'SCREEN (UI):', describeGui(extra.gui));
  return lines.join('\n');
}

// UI elements are drawn on a screen, so they are described by where they land on a 1280x720 window.
export function describeGui(gui, W = 1280, H = 720) {
  if (!gui || !gui.length) return 'No UI.';
  return gui.map(g => {
    const b = g.box || {}; const x = Math.round(b.x ?? 0), y = Math.round(b.y ?? 0), w = Math.round(b.w ?? 0), h = Math.round(b.h ?? 0);
    const off = x < 0 || y < 0 || x + w > W || y + h > H;
    return `  ${'  '.repeat(g.depth || 0)}${g.varName || g.name} [${g.cls}] at (${x}, ${y}) size ${w}x${h}${g.text ? ' text "' + String(g.text).slice(0, 24) + '"' : ''}${off ? '  <-- PARTLY OFF THE SCREEN' : ''}${w <= 0 || h <= 0 ? '  <-- HAS NO SIZE' : ''}`;
  }).join('\n');
}
