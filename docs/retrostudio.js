// In-app Roblox: RetroStudio mock. This is deliberately NOT a Lua/Luau runtime.
// It statically recognizes a tiny Instance.new/property subset; it never evals user or AI code.
export const MAX_PARTS = 80;
export const MAX_SOURCE_CHARS = 50000;
const PART_TYPES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart']);
const MATERIALS = new Set(['Plastic', 'SmoothPlastic', 'Wood', 'Concrete', 'Metal', 'Glass', 'Neon', 'Brick', 'Grass', 'Fabric']);
const number3 = s => {
  const m = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(s);
  return m ? m.slice(1).map(Number) : null;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const cleanString = s => { try { return JSON.parse('"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'); } catch { return s.slice(0, 64); } };

export function extractLuau(text) {
  return extractLuauBlocks(text)[0] || '';
}
export function extractLuauBlocks(text) {
  const source = String(text || '');
  const blocks = [...source.matchAll(/```(?:lua|luau)\s*\n([\s\S]*?)```/gi)];
  return blocks.slice(0, 6).map(m => String(m[1] || '').slice(0, MAX_SOURCE_CHARS));
}

export function testLuau(source) {
  const result = simulateLuau(source);
  return { ok: result.diagnostics.length === 0, diagnostics: result.diagnostics, created: result.created, simulated: true };
}
export function simulateLuau(source) {
  const text = String(source || '').slice(0, MAX_SOURCE_CHARS);
  const parts = [], diagnostics = [], byVar = new Map();
  if (String(source || '').length > MAX_SOURCE_CHARS) diagnostics.push(`Source was limited to ${MAX_SOURCE_CHARS.toLocaleString()} characters.`);
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    const make = /^(?:local\s+)?([A-Za-z_]\w*)\s*=\s*Instance\.new\(\s*['"]([A-Za-z]+)['"]\s*(?:,\s*(workspace|game\.Workspace)\s*)?\)\s*;?\s*(?:--.*)?$/i.exec(line);
    if (make) {
      if (!PART_TYPES.has(make[2])) { diagnostics.push(`Line ${i + 1}: ${make[2]} is outside the mock's part whitelist.`); continue; }
      if (parts.length >= MAX_PARTS) { diagnostics.push(`Preview stopped at ${MAX_PARTS} parts.`); break; }
      const part = { name: make[1].slice(0, 48), type: make[2], size: [4, 1, 4], position: [0, parts.length * 2, 1], color: [111, 139, 255], material: 'Plastic', anchored: true, parented: !!make[3] };
      parts.push(part); byVar.set(make[1], part); continue;
    }
    const set = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*(.*?)\s*;?\s*(?:--.*)?$/.exec(line);
    if (set && byVar.has(set[1])) {
      const part = byVar.get(set[1]), value = set[3].replace(/;$/, '').trim();
      if (set[2] === 'Name' && /^['"][\s\S]*['"]$/.test(value)) part.name = cleanString(value.slice(1, -1)).slice(0, 48) || part.name;
      else if (set[2] === 'Anchored' && /^(true|false)$/.test(value)) part.anchored = value === 'true';
      else if (set[2] === 'CanCollide' && /^(true|false)$/.test(value)) part.canCollide = value === 'true';
      else if (set[2] === 'Parent' && /^workspace(?:\s*)$/.test(value)) part.parented = true;
      else if (set[2] === 'Size' || set[2] === 'Position' || set[2] === 'CFrame') {
        const v = /^(?:Vector3\.new|CFrame\.new)\(\s*([^)]*)\)$/.exec(value), xyz = v && number3(v[1]);
        if (!xyz) diagnostics.push(`Line ${i + 1}: ${set[2]} needs three numeric coordinates in the supported constructor.`);
        else if (set[2] === 'Size') part.size = xyz.map(n => clamp(n, 0.2, 30));
        else part.position = xyz.map(n => clamp(n, -100, 100));
      } else if (set[2] === 'Color') {
        const m = /^Color3\.fromRGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
        if (m) part.color = m.slice(1).map(n => clamp(Number(n), 0, 255));
        else diagnostics.push(`Line ${i + 1}: only Color3.fromRGB(r, g, b) is supported by the mock.`);
      } else if (set[2] === 'Material') {
        const m = /^Enum\.Material\.([A-Za-z]+)$/.exec(value);
        if (m && MATERIALS.has(m[1])) part.material = m[1];
        else diagnostics.push(`Line ${i + 1}: material is not in the mock whitelist.`);
      } else diagnostics.push(`Line ${i + 1}: ${set[2]} is not simulated.`);
      continue;
    }
    if (/\b(Instance\.new|loadstring|require\s*\(|game\s*:|game\.|workspace\.|HttpService|RemoteEvent|task\.|while\s+true|repeat\b)/i.test(line)) {
      diagnostics.push(`Line ${i + 1}: unsupported action; not executed by the mock.`);
    }
  }
  if (!parts.length) diagnostics.push('No supported Part objects found. Add Instance.new("Part") on its own line.');
  const unparented = parts.filter(p => !p.parented).length;
  if (unparented) diagnostics.push(`${unparented} part${unparented === 1 ? '' : 's'} are not parented to workspace, so they are not shown.`);
  return { parts: parts.filter(p => p.parented), created: parts.length, diagnostics, simulated: true };
}

function shade(rgb, factor) { return `rgb(${rgb.map(n => Math.round(clamp(n * factor, 0, 255))).join(',')})`; }
function project(x, y, z, cx, cy, scale) { return [cx + (x - y) * scale * 0.72, cy + (x + y) * scale * 0.36 - z * scale * 0.72]; }
// Lighting like RetroStudio's Lighting service: TimeOfDay (0-24), Brightness, Ambient colour, Fog.
export const DEFAULT_LIGHTING = { time: 14, brightness: 1, ambient: [127, 127, 127], fog: 0 };
export function skyColors(time) {
  const t = ((Number(time) % 24) + 24) % 24, day = Math.max(0, Math.sin(((t - 6) / 12) * Math.PI));   // 0 at night, 1 at noon
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const nightTop = [8, 10, 24], nightBot = [18, 22, 44], dayTop = [86, 148, 235], dayBot = [190, 220, 248];
  const dusk = Math.max(0, 1 - Math.abs(day - 0.18) / 0.18) * (day < 0.5 ? 1 : 0);
  let top = mix(nightTop, dayTop, Math.min(1, day * 1.3)), bot = mix(nightBot, dayBot, Math.min(1, day * 1.3));
  bot = mix(bot, [245, 150, 80], dusk * 0.7);
  return { top, bot, day };
}
export function drawPreview(canvas, parts = [], lighting = DEFAULT_LIGHTING) {
  lighting = { ...DEFAULT_LIGHTING, ...(lighting || {}) };
  if (!canvas || !canvas.getContext) return false;
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = Math.max(320, Math.round((rect.width || 700) * dpr)), h = Math.max(220, Math.round((rect.height || 420) * dpr));
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d'); if (!c) return false;
  c.scale(dpr, dpr);
  const cw = w / dpr, ch = h / dpr;
  const sky = skyColors(lighting.time), rgb = a => `rgb(${a.join(',')})`;
  const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, rgb(sky.top)); g.addColorStop(1, rgb(sky.bot)); c.fillStyle = g; c.fillRect(0, 0, cw, ch);
  if (sky.day < 0.25) { c.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 40; i++) c.fillRect((i * 97) % cw, ((i * 53) % (ch * 0.5)), 1.2, 1.2); }   // stars at night
  const scale = Math.min(11, Math.max(4, cw / 72)), cx = cw / 2, cy = ch * 0.62;
  const lightK = Math.max(0.18, Math.min(1.6, (0.35 + sky.day * 0.75) * lighting.brightness)), amb = lighting.ambient;
  { const A = project(-12, -12, 0, cx, cy, scale), B = project(12, -12, 0, cx, cy, scale), C = project(12, 12, 0, cx, cy, scale), D = project(-12, 12, 0, cx, cy, scale);
    c.fillStyle = shade([99, 138, 72].map((v, i) => v * 0.7 + amb[i] * 0.3), lightK); c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.lineTo(...C); c.lineTo(...D); c.closePath(); c.fill(); }
  c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 1;
  for (let n = -12; n <= 12; n++) { const a = project(n, -12, 0, cx, cy, scale), b = project(n, 12, 0, cx, cy, scale), d = project(-12, n, 0, cx, cy, scale), e = project(12, n, 0, cx, cy, scale); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.moveTo(...d); c.lineTo(...e); c.stroke(); }
  const ordered = [...parts].sort((a, b) => (a.position[0] + a.position[1]) - (b.position[0] + b.position[1]));
  for (const p of ordered) {
    const [x, y, z] = p.position, [sx, sy, sz] = p.size, base = project(x, y, z, cx, cy, scale), top = project(x, y, z + sz, cx, cy, scale);
    const dx = sx * scale * 0.36, dy = sy * scale * 0.36, dz = sz * scale * 0.72;
    const left = [top[0] - dx, top[1] - dy], right = [top[0] + dx, top[1] - dy], front = [top[0], top[1] + dx + dy];
    const bottomLeft = [left[0], left[1] + dz], bottomRight = [right[0], right[1] + dz], bottomFront = [front[0], front[1] + dz];
    const pc = p.color.map((v, i) => v * 0.8 + amb[i] * 0.2);
    c.fillStyle = shade(pc, .68 * lightK); c.beginPath(); c.moveTo(left[0], left[1]); c.lineTo(front[0], front[1]); c.lineTo(bottomFront[0], bottomFront[1]); c.lineTo(bottomLeft[0], bottomLeft[1]); c.closePath(); c.fill();
    c.fillStyle = shade(pc, .52 * lightK); c.beginPath(); c.moveTo(right[0], right[1]); c.lineTo(front[0], front[1]); c.lineTo(bottomFront[0], bottomFront[1]); c.lineTo(bottomRight[0], bottomRight[1]); c.closePath(); c.fill();
    c.fillStyle = shade(pc, 1.12 * lightK); c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(right[0], right[1]); c.lineTo(front[0], front[1]); c.lineTo(left[0], left[1]); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.stroke();
    if (ordered.length <= 18) { c.fillStyle = '#e8efff'; c.font = '10px system-ui'; c.textAlign = 'center'; c.fillText(String(p.name).slice(0, 18), top[0], top[1] - 5); }
  }
  if (lighting.fog > 0) { const f = c.createLinearGradient(0, 0, 0, ch); const fa = Math.min(0.85, lighting.fog / 100); f.addColorStop(0, `rgba(${sky.bot.join(',')},${fa * 0.2})`); f.addColorStop(1, `rgba(${sky.bot.join(',')},${fa})`); c.fillStyle = f; c.fillRect(0, 0, cw, ch); }
  c.fillStyle = 'rgba(226,235,255,.82)'; c.font = '11px system-ui'; c.textAlign = 'left'; c.fillText(`${parts.length} part${parts.length === 1 ? '' : 's'} · preview only, nothing runs here`, 12, 20);
  return true;
}
