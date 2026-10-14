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

export function simulateLuau(source) {
  const text = String(source || '').slice(0, MAX_SOURCE_CHARS);
  const parts = [], diagnostics = [], byVar = new Map();
  if (String(source || '').length > MAX_SOURCE_CHARS) diagnostics.push(`Source was limited to ${MAX_SOURCE_CHARS.toLocaleString()} characters.`);
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    const make = /^(?:local\s+)?([A-Za-z_]\w*)\s*=\s*Instance\.new\(\s*['"]([A-Za-z]+)['"]\s*\)\s*;?\s*(?:--.*)?$/i.exec(line);
    if (make) {
      if (!PART_TYPES.has(make[2])) { diagnostics.push(`Line ${i + 1}: ${make[2]} is outside the mock's part whitelist.`); continue; }
      if (parts.length >= MAX_PARTS) { diagnostics.push(`Preview stopped at ${MAX_PARTS} parts.`); break; }
      const part = { name: make[1].slice(0, 48), type: make[2], size: [4, 1, 4], position: [0, parts.length * 2, 1], color: [111, 139, 255], material: 'Plastic', anchored: true, parented: false };
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
export function drawPreview(canvas, parts = []) {
  if (!canvas || !canvas.getContext) return false;
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = Math.max(320, Math.round((rect.width || 700) * dpr)), h = Math.max(220, Math.round((rect.height || 420) * dpr));
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d'); if (!c) return false;
  c.scale(dpr, dpr);
  const cw = w / dpr, ch = h / dpr;
  const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, '#141c2d'); g.addColorStop(1, '#090d16'); c.fillStyle = g; c.fillRect(0, 0, cw, ch);
  const scale = Math.min(11, Math.max(4, cw / 72)), cx = cw / 2, cy = ch * 0.62;
  c.strokeStyle = 'rgba(161,181,219,.12)'; c.lineWidth = 1;
  for (let n = -12; n <= 12; n++) { const a = project(n, -12, 0, cx, cy, scale), b = project(n, 12, 0, cx, cy, scale), d = project(-12, n, 0, cx, cy, scale), e = project(12, n, 0, cx, cy, scale); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.moveTo(...d); c.lineTo(...e); c.stroke(); }
  const ordered = [...parts].sort((a, b) => (a.position[0] + a.position[1]) - (b.position[0] + b.position[1]));
  for (const p of ordered) {
    const [x, y, z] = p.position, [sx, sy, sz] = p.size, base = project(x, y, z, cx, cy, scale), top = project(x, y, z + sz, cx, cy, scale);
    const dx = sx * scale * 0.36, dy = sy * scale * 0.36, dz = sz * scale * 0.72;
    const left = [top[0] - dx, top[1] - dy], right = [top[0] + dx, top[1] - dy], front = [top[0], top[1] + dx + dy];
    const bottomLeft = [left[0], left[1] + dz], bottomRight = [right[0], right[1] + dz], bottomFront = [front[0], front[1] + dz];
    c.fillStyle = shade(p.color, .68); c.beginPath(); c.moveTo(left[0], left[1]); c.lineTo(front[0], front[1]); c.lineTo(bottomFront[0], bottomFront[1]); c.lineTo(bottomLeft[0], bottomLeft[1]); c.closePath(); c.fill();
    c.fillStyle = shade(p.color, .52); c.beginPath(); c.moveTo(right[0], right[1]); c.lineTo(front[0], front[1]); c.lineTo(bottomFront[0], bottomFront[1]); c.lineTo(bottomRight[0], bottomRight[1]); c.closePath(); c.fill();
    c.fillStyle = shade(p.color, 1.12); c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(right[0], right[1]); c.lineTo(front[0], front[1]); c.lineTo(left[0], left[1]); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.stroke();
    if (ordered.length <= 18) { c.fillStyle = '#e8efff'; c.font = '10px system-ui'; c.textAlign = 'center'; c.fillText(String(p.name).slice(0, 18), top[0], top[1] - 5); }
  }
  c.fillStyle = 'rgba(226,235,255,.72)'; c.font = '11px system-ui'; c.textAlign = 'left'; c.fillText(`${parts.length} simulated part${parts.length === 1 ? '' : 's'} · no Roblox runtime`, 12, 20);
  return true;
}
