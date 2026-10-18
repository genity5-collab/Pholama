import { flatten } from './luaflatten.js';
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
// Reads real Lua first (loops, functions, tables, Model, BrickColor) by flattening it; scripts it cannot understand fall back to the simple line reader.
export function simulateLuau(source) {
  const full = String(source || '');
  const f = flatten(full);
  if (f.flattened && f.parts.length) {
    const unparented = f.diagnostics.filter(d => /not parented|stopped at/.test(d));
    return { parts: f.parts, created: f.parts.length, diagnostics: f.ok ? [] : f.diagnostics, simulated: true, flat: f.lua, models: f.models, prints: f.prints };
  }
  const simple = simulateLineByLine(full);
  if (!simple.parts.length && f.diagnostics.length && !f.parts.length) {
    // neither reader built anything: show the more useful reason (a real error from the Lua reader beats "no parts")
    const real = f.diagnostics.filter(d => !/not parented/.test(d));
    if (real.length && /^Line \d+:|nested|too long|safely/.test(real[0])) simple.diagnostics = [...real, ...simple.diagnostics.filter(d => !/No supported Part/.test(d))];
  }
  return simple;
}
function simulateLineByLine(source) {
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
// A camera for the viewport: yaw turns the scene, zoom scales it, panX / panY slide it. The default is the old fixed view.
export const DEFAULT_CAMERA = { yaw: 0, zoom: 1, panX: 0, panY: 0 };
export const CAMERA_LIMITS = { minZoom: 0.25, maxZoom: 12 };
export function clampCamera(c) {
  const k = { ...DEFAULT_CAMERA, ...(c || {}) };
  k.zoom = Math.max(CAMERA_LIMITS.minZoom, Math.min(CAMERA_LIMITS.maxZoom, Number.isFinite(k.zoom) ? k.zoom : 1));
  k.yaw = Number.isFinite(k.yaw) ? ((k.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : 0;
  k.panX = Math.max(-4000, Math.min(4000, Number.isFinite(k.panX) ? k.panX : 0)); k.panY = Math.max(-4000, Math.min(4000, Number.isFinite(k.panY) ? k.panY : 0));
  return k;
}
// Zoom toward a point on the canvas (the mouse), so the thing under the cursor stays under the cursor.
export function zoomCamera(cam, factor, px, py, w, h) {
  const c = clampCamera(cam), z = Math.max(CAMERA_LIMITS.minZoom, Math.min(CAMERA_LIMITS.maxZoom, c.zoom * factor)), k = z / c.zoom;
  const cx = w / 2, cy = h * 0.62;
  return clampCamera({ ...c, zoom: z, panX: (px - cx) - (px - cx - c.panX) * k, panY: (py - cy) - (py - cy - c.panY) * k });
}
let CAM = DEFAULT_CAMERA;
const DEFAULT_CAMERA_FLAT = yaw => ({ yaw, zoom: 1, panX: 0, panY: 0 });
function project(x, y, z, cx, cy, scale) {
  const a = CAM.yaw, rx = x * Math.cos(a) - y * Math.sin(a), ry = x * Math.sin(a) + y * Math.cos(a);
  return [cx + CAM.panX + (rx - ry) * scale * 0.72, cy + CAM.panY + (rx + ry) * scale * 0.36 - z * scale * 0.72];
}
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
export function drawPreview(canvas, parts = [], lighting = DEFAULT_LIGHTING, camera = DEFAULT_CAMERA) {
  lighting = { ...DEFAULT_LIGHTING, ...(lighting || {}) };
  CAM = clampCamera(camera);
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
  // Zoom 1 fits the model: measure how big it is on screen at a known scale, then pick the scale that fills ~70% of the view. The camera zoom is on top.
  const probe = 10; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const keep = CAM; CAM = DEFAULT_CAMERA_FLAT(keep.yaw);
  for (const p of parts) for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [0, 1]) {
    const q = project(p.position[0] + dx * p.size[0] / 2, p.position[1] + dy * p.size[1] / 2, p.position[2] + dz * p.size[2], 0, 0, probe);
    if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0]; if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
  }
  CAM = keep;
  const ground = project(0, 0, 0, 0, 0, probe), spanX = parts.length ? Math.max(maxX - minX, 40) : 240, spanY = parts.length ? Math.max(maxY - minY, 40) : 160;
  const fit = parts.length ? Math.min((cw * 0.84) / spanX, (ch * 0.76) / spanY) * probe : Math.min(cw / 72, ch / 44);
  // How far the model reaches along the ground (x and depth only: height must not make the baseplate bigger).
  const reach = parts.reduce((m, p) => Math.max(m, Math.abs(p.position[0]) + p.size[0] / 2, Math.abs(p.position[1]) + p.size[1] / 2), 4);
  const midX = parts.length ? (minX + maxX) / 2 : 0, midY = parts.length ? (minY + maxY) / 2 : 0;
  const scale = Math.max(1.5, Math.min(60, fit)) * CAM.zoom;
  // centre the model on screen (not the origin), so a model off to one side is still framed; the camera pan is added on top
  const cx = cw / 2 - midX * (scale / probe) * 1, cy = ch * 0.5 - midY * (scale / probe) * 1;
  const lightK = Math.max(0.18, Math.min(1.6, (0.35 + sky.day * 0.75) * lighting.brightness)), amb = lighting.ambient;
  // The ground is a baseplate a little wider than the model, so the sky still shows around it and you can see where the model stands.
  const G = Math.max(3, Math.min(200, reach + Math.max(1.5, reach * 0.35)));   // the model's footprint plus a margin: a baseplate, so the sky shows around it
  { const A = project(-G, -G, 0, cx, cy, scale), B = project(G, -G, 0, cx, cy, scale), C = project(G, G, 0, cx, cy, scale), D = project(-G, G, 0, cx, cy, scale);
    c.fillStyle = shade([99, 138, 72].map((v, i) => v * 0.7 + amb[i] * 0.3), lightK); c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.lineTo(...C); c.lineTo(...D); c.closePath(); c.fill(); }
  c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 1;
  for (let n = -Math.floor(G); n <= G; n += G > 40 ? 8 : G > 20 ? 4 : G > 8 ? 2 : 1) { const a = project(n, -G, 0, cx, cy, scale), b = project(n, G, 0, cx, cy, scale), d = project(-G, n, 0, cx, cy, scale), e = project(G, n, 0, cx, cy, scale); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.moveTo(...d); c.lineTo(...e); c.stroke(); }
  // paint far parts first: depth is x + y after the scene is turned by the camera, with height as a tie-break so a head is drawn after the torso under it
  const ca = Math.cos(CAM.yaw), sa = Math.sin(CAM.yaw), depth = p => (p.position[0] * ca - p.position[1] * sa) + (p.position[0] * sa + p.position[1] * ca) + p.position[2] * 0.001;
  const ordered = [...parts].sort((a, b) => depth(a) - depth(b));
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
