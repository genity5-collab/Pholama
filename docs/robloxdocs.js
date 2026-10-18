// Live Roblox documentation lookup. Before the AI writes a script, the page reads the OFFICIAL Roblox API reference for the things the request is about
// (classes, datatypes, enums) straight from the creator-docs repository, and gives the AI a short brief. Nothing is guessed from memory.
// Pure and testable: the fetcher is passed in, results are cached.

const RAW = 'https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/';
export const SOURCE_NAME = 'Roblox Creator Docs';

// Words in a request -> the official reference pages worth reading. Kept short on purpose: a small, relevant brief beats a long one.
const TOPICS = [
  [/\b(wedge|roof|ramp|slope|stairs?|slanted)\b/i, ['classes/WedgePart', 'classes/BasePart', 'datatypes/CFrame']],
  [/\b(corner\s*wedge)\b/i, ['classes/CornerWedgePart']],
  [/\b(rotat\w*|turn\w*|angle\w*|tilt\w*|orient\w*|spin\w*|face\s+the)\b/i, ['datatypes/CFrame']],
  [/\b(ball|sphere|round|cylinder|shape)\b/i, ['classes/Part', 'enums/PartType']],
  [/\b(neon|glass|wood|metal|brick|grass|concrete|material|shiny)\b/i, ['enums/Material']],
  [/\b(colou?r|paint|red|blue|green|yellow|brickcolor)\b/i, ['datatypes/BrickColor', 'datatypes/Color3']],
  [/\b(touch\w*|step on|collide|hit)\b/i, ['classes/BasePart']],
  [/\b(click\w*|button|prompt|press|interact)\b/i, ['classes/ClickDetector', 'classes/ProximityPrompt']],
  [/\b(light|lamp|torch|glow|fire|flame)\b/i, ['classes/PointLight', 'classes/Fire']],
  [/\b(sound|music|audio|noise)\b/i, ['classes/Sound']],
  [/\b(gui|menu|screen|text|label|hud|score)\b/i, ['classes/ScreenGui', 'classes/TextLabel']],
  [/\b(tween\w*|animat\w*|smooth\w*|move\s+slowly)\b/i, ['classes/TweenService']],
  [/\b(spawn|respawn|checkpoint)\b/i, ['classes/SpawnLocation']],
  [/\b(door|gate|hinge|weld|attach\w*)\b/i, ['classes/WeldConstraint', 'classes/HingeConstraint']],
  [/\b(npc|humanoid|character|noob|player|health)\b/i, ['classes/Humanoid']],
  [/\b(tool|sword|gun|weapon|equip)\b/i, ['classes/Tool']],
  [/\b(model|house|building|castle|tower|car|tree|robot|dragon|group)\b/i, ['classes/Model', 'classes/Part']],
  [/\b(part|block|brick|cube|wall|floor|platform|obby)\b/i, ['classes/Part']]
];
export function topicsFor(text, max = 5) {
  const out = [], seen = new Set();
  for (const [re, pages] of TOPICS) if (re.test(String(text || ''))) for (const p of pages) if (!seen.has(p)) { seen.add(p); out.push(p); }
  return out.slice(0, max);
}

// The reference pages are YAML. We only need a few fields, so read them without a YAML library.
// Layout (checked against the real files): top-level keys at column 0; text blocks are `key: |` followed by 2-space indented lines;
// lists are `section:` followed by `  - name: X` entries.
function block(text, key) {
  const lines = text.split('\n'), start = lines.findIndex(l => l.startsWith(key + ':')); if (start < 0) return '';
  const first = lines[start].slice(key.length + 1).trim();
  if (!/^[|>][-+]?$/.test(first)) return first.replace(/^['"]|['"]$/g, '');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) { const l = lines[i]; if (l.length && !/^\s/.test(l)) break; out.push(l.replace(/^ {2}/, '')); }
  // keep prose, drop fenced code and blank-line clutter
  let inCode = false; const prose = [];
  for (const l of out) { if (/^\s*```/.test(l)) { inCode = !inCode; continue; } if (!inCode && l.trim()) prose.push(l.trim()); }
  return prose.join(' ').replace(/\s+/g, ' ').trim();
}
function names(text, section, max) {   // unique `name:` values listed under a section (properties, methods, events, constructors, functions, items)
  const lines = text.split('\n'), start = lines.findIndex(l => l.startsWith(section + ':')); if (start < 0 || /\[\]\s*$/.test(lines[start])) return [];
  const out = [], seen = new Set();
  for (let i = start + 1; i < lines.length && out.length < max; i++) {
    const l = lines[i]; if (l.length && !/^\s/.test(l)) break;
    const m = /^\s{2}- name: (\S+)/.exec(l); if (m) { const n = m[1].replace(/^.*[.:]/, ''); if (!seen.has(n)) { seen.add(n); out.push(n); } }
  }
  return out;
}
const COMMON = ['Position', 'Size', 'CFrame', 'Orientation', 'Rotation', 'Color', 'BrickColor', 'Material', 'Transparency', 'Anchored', 'CanCollide', 'Shape', 'Name', 'Parent', 'Touched', 'TouchEnded',
  'Clone', 'Destroy', 'FindFirstChild', 'GetChildren', 'SetPrimaryPartCFrame', 'PivotTo', 'MoveTo', 'PrimaryPart', 'Reflectance', 'CastShadow', 'Massless', 'Health', 'WalkSpeed', 'MouseClick', 'Triggered', 'Play', 'Stop', 'Create', 'Value'];
const byUse = list => [...list].sort((a, b) => { const ia = COMMON.indexOf(a), ib = COMMON.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
const clean = s => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`?(?:Class|Datatype|Enum|Library|Global)\.([A-Za-z0-9_.]+)`?(?:\|[A-Za-z0-9_.]+)?/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
export function condense(page, yaml) {
  const t = String(yaml || ''); if (!t.trim() || !/^name:/m.test(t)) return null;
  const name = block(t, 'name') || page.split('/').pop(), kind = block(t, 'type') || '';
  const two = x => (x.match(/[^.!?]+[.!?]+/g) || [x]).slice(0, 2).join(' ').trim(), summary = clean(block(t, 'summary')).slice(0, 240), desc = two(clean(block(t, 'description'))).slice(0, 300);
  const isEnum = kind === 'enum';
  return { page, name, kind, summary, description: desc && !summary.startsWith(desc.slice(0, 40)) && desc !== summary ? desc : '',
    constructors: kind === 'datatype' ? names(t, 'constructors', 8) : [], functions: names(t, 'functions', 12),
    properties: byUse(names(t, 'properties', 400)).slice(0, 14), methods: byUse(names(t, 'methods', 400)).slice(0, 10), events: byUse(names(t, 'events', 100)).slice(0, 6), items: isEnum ? names(t, 'items', 30) : [] };
}
export function briefLine(d) {
  const parts = [`${d.name} (${d.kind}): ${d.summary}`];
  if (d.description) parts.push(d.description);
  if (d.items.length) parts.push('Values: ' + d.items.join(', ') + '.');
  if (d.constructors.length) parts.push('Constructors: ' + d.constructors.map(c => d.name + '.' + c).join(', ') + '.');
  if (d.functions.length) parts.push('Functions: ' + d.functions.join(', ') + '.');
  if (d.properties.length) parts.push('Properties: ' + d.properties.join(', ') + '.');
  if (d.methods.length) parts.push('Methods: ' + d.methods.join(', ') + '.');
  if (d.events.length) parts.push('Events: ' + d.events.join(', ') + '.');
  return parts.join(' ');
}

const cache = new Map();   // page -> condensed doc (or null), kept for the visit so the same page is never fetched twice
export async function lookup(text, fetchText, opts = {}) {
  const pages = topicsFor(text, opts.max || 4), docs = [], failed = [];
  await Promise.all(pages.map(async page => {
    if (cache.has(page)) { const c = cache.get(page); if (c) docs.push(c); else failed.push(page); return; }
    try {
      const yaml = await Promise.race([fetchText(RAW + page + '.yaml'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), opts.timeout || 6000))]);
      const d = condense(page, yaml); cache.set(page, d); if (d) docs.push(d); else failed.push(page);
    } catch { failed.push(page); }
  }));
  docs.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
  return { pages, docs, failed, brief: docs.map(briefLine).join('\n'), source: SOURCE_NAME };
}
export const _clearCache = () => cache.clear();
/** The text added to the AI's request: what the official docs say, plus the instruction to rely on it. Empty when nothing was found. */
export function briefFor(result) {
  if (!result || !result.docs.length) return '';
  return `[Roblox documentation, just looked up from ${SOURCE_NAME}. Rely on these names exactly; do not invent properties or methods that are not real.]\n${result.brief}`;
}
