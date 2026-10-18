// The Studio loop: the AI writes a script, the workspace "runs" it into a model preview, the result is checked,
// and if it is wrong the AI is shown what is wrong and fixes it. Only when it looks right is the script encoded.
// Nothing here runs Lua. "Running" means the safe preview that reads the script and builds the parts it describes.
// The module is pure (no DOM, no network) so every decision can be tested.

export const MAX_FIX_ROUNDS = 3;

// The rules the AI must follow so its script can be turned into blocks. The encoder only reads this subset.
// Rules for Roblox scripting. The AI writes ONLY Lua. It never writes encoded strings, block data or base93; encoding is done by the page.
export const LUA_RULES = [
  'You write Roblox Lua (Luau) scripts and nothing else. Reply with the script in a ```lua code block and at most one short sentence about what it does.',
  'Write real, working Lua. Loops, local functions, tables and arithmetic are all fine.',
  'Never write encoded text, base64 or base93 strings, block data or "CoolFormat". You only write Lua. Anything that converts the Lua is done for you.',
  'To BUILD a model: group it with local model = Instance.new("Model", workspace). Make a helper such as local function part(name, size, pos, color) local p = Instance.new("Part", model) p.Name = name p.Size = size p.Position = pos p.BrickColor = BrickColor.new(color) p.Anchored = true return p end, then call it for every piece.',
  'Make the model look good and recognisable: a character needs a head, torso, two arms, two legs and details (a face, hair, a hat, sunglasses), several colours and sensible sizes in studs. Stand it on the ground (feet near y = 0), centred near 0, 0, 0. Never build a thing from a single part.',
  'Colours: BrickColor.new("Bright red") or Color3.fromRGB(r, g, b). Materials: Enum.Material.Wood, Metal, Glass, Neon, Brick, Grass, Concrete, SmoothPlastic. Shapes: part.Shape = Enum.PartType.Ball.',
  'Always give every part a parent (second argument of Instance.new) and set Anchored = true so it does not fall apart.',
  'For behaviour (touch, click, loops over time) write a separate short script in its own ```lua block, for example part.Touched:Connect(function(hit) ... end).',
  'Put every script in its own ```lua code block.',
  'DOCUMENT FIRST, then build. Start every script with a short comment header: -- Plan: what you will build, the parts it needs, their sizes and colours. -- Notes: anything the Roblox documentation brief below says that you rely on. When you change an existing script, add one line under -- Changes: saying what you changed and why, and keep the older lines.',
  'Use ONLY properties, methods and enums that really exist. If a [Roblox documentation] brief is included below, rely on it exactly and do not invent names it does not list. Never guess an API: when unsure, build it from plain Parts.',
  'Rotation: use part.CFrame = CFrame.new(x, y, z) * CFrame.Angles(math.rad(rx), math.rad(ry), math.rad(rz)) or part.Orientation = Vector3.new(rx, ry, rz) in degrees. Size always stays in the part\'s own axes, so a part turned 90 degrees keeps its Size.',
  'Position is the CENTRE of a part, so a part of height h that rests on the ground has Position.Y = h / 2. A WedgePart is a ramp: its tall edge is at the back and it slopes down toward the front. For a pitched roof use two WedgeParts turned to face opposite ways, each as wide as half the roof.',
  'Check your own work before replying: every part has a name, a size in studs, a colour and a parent; nothing overlaps by accident; parts that should touch actually touch (position them from the sizes, not by eye).'
].join('\n');

// Added ONLY when the RetroStudio encoder is switched on: the script is also converted to RetroStudio blocks, so the one extra rule is to keep to what blocks can do.
export const ENCODER_RULES = [
  'The RetroStudio encoder is ON. Your Lua is previewed, checked and converted to RetroStudio blocks automatically, so do not mention encoding. Keep to building with parts, models, properties, simple if/for logic, prints and touch or click events.',
  'For any other RetroStudio block write a directive line:  --@block BlockName Field=value'
].join('\n');

// What the AI is shown with a message. Encoder off: Lua only. Encoder on: Lua plus the encoder rules.
export const rulesFor = encoderOn => (encoderOn ? LUA_RULES + '\n' + ENCODER_RULES : LUA_RULES);
// Kept for older callers: the full set with the encoder on.
export const STUDIO_RULES = rulesFor(true);

// Look at what the preview built and decide whether the result is acceptable.
// `sim` is the result of simulateLuau (parts, created, diagnostics). `skipped` is what the encoder could not convert.
export function judge(sim, skipped = [], opts = {}) {
  const problems = [];
  const parts = (sim && sim.parts) || [], created = (sim && sim.created) || 0;
  if (!created) problems.push('The script does not create any parts. Add Instance.new("Part", workspace) lines.');
  else if (!parts.length) problems.push('Parts were created but none are parented to workspace, so nothing shows. Parent them to workspace.');
  for (const d of (sim && sim.diagnostics) || []) {
    if (/not parented|No supported Part/.test(d)) continue;   // already said above
    problems.push(d);
  }
  const off = parts.filter(p => p.position.some(n => Math.abs(n) > 90));
  if (off.length) problems.push(`${off.length} part${off.length === 1 ? ' is' : 's are'} far outside the visible area (position beyond 90). Move ${off.length === 1 ? 'it' : 'them'} closer to 0,0,0.`);
  const tiny = parts.filter(p => p.size.some(n => n < 0.3));
  if (tiny.length && opts.strictSize) problems.push(`${tiny.length} part${tiny.length === 1 ? ' is' : 's are'} too thin to see.`);
  // Two parts only count as a mistake when they are the same size in the same place (a duplicate). Parts of one model touch and overlap on purpose.
  const sameSpot = new Map();
  for (const p of parts) { const k = p.position.map(n => Math.round(n * 10) / 10).join(',') + '|' + p.size.map(n => Math.round(n * 10) / 10).join(','); sameSpot.set(k, (sameSpot.get(k) || 0) + 1); }
  const stacked = [...sameSpot.values()].filter(n => n > 1).length;
  if (stacked) problems.push('Some parts are exact copies sitting in the same place. Give each part its own position or remove the duplicate.');
  const unconvertible = (skipped || []).filter(s => !/^Skip: end$/.test(s));
  if (unconvertible.length) problems.push(`${unconvertible.length} line${unconvertible.length === 1 ? '' : 's'} cannot be converted to blocks: ${unconvertible.slice(0, 4).map(s => s.replace(/^Skip(?:ped[^:]*)?:\s*/, '').slice(0, 60)).join(' | ')}. Rewrite using only the allowed lines, or a --@block directive.`);
  return { ok: problems.length === 0, problems, parts: parts.length };
}


// ---- Automatic repair: fixes the common problems WITHOUT asking the AI, so no cloud message is spent. ----
// Each repair is small and safe; the result is always checked again by judge(). Returns { source, changes }.
export function autoRepair(source, sim, skipped = []) {
  // A script the Lua reader understood (loops, functions, models) is already fully worked out. Editing its lines would damage it, so the AI fixes real problems.
  if (sim && sim.flat) return { source: String(source || ''), changes: [] };
  let lines = String(source || '').split(/\r?\n/), changes = [];
  const drop = new Set((skipped || []).map(x => String(x).replace(/^Skip(?:ped[^:]*)?:\s*/, '').trim()).filter(Boolean));

  // 1. A part that is never parented to workspace: add the parent on creation.
  lines = lines.map(l => {
    const m = /^(\s*(?:local\s+)?[A-Za-z_]\w*\s*=\s*Instance\.new\(\s*(['"])[A-Za-z]+\2)\s*\)(\s*(?:--.*)?)$/.exec(l);
    if (m && !/\.Parent\s*=/.test(source)) { changes.push('parented a part to workspace'); return m[1] + ', workspace)' + m[3]; }
    return l;
  });

  // 2. Lines the encoder cannot convert (while, elseif, function...): remove the line and, for a block opener, its body up to the matching end.
  const out = []; let skipDepth = 0;
  for (const l of lines) {
    const t = l.trim();
    if (skipDepth > 0) {
      if (/\b(?:then|do)\s*$/.test(t) || /^(?:local\s+)?function\b/.test(t) || /^repeat\b/.test(t)) skipDepth++;
      else if (/^end\b|^until\b/.test(t)) skipDepth--;
      continue;
    }
    if (t && drop.has(t.slice(0, 72)) || (t && [...drop].some(d => d && t.startsWith(d.slice(0, 40)) && t.length <= d.length + 40))) {
      changes.push('removed a line that cannot become blocks: ' + t.slice(0, 40));
      if (/\b(?:then|do)\s*$/.test(t) || /^(?:local\s+)?function\b/.test(t) || /^repeat\b/.test(t)) skipDepth = 1;
      continue;
    }
    out.push(l);
  }
  lines = out;

  // 3. Parts stacked in the same spot: spread them along X.
  const seen = new Map(); let spread = 0;
  lines = lines.map(l => {
    const m = /^(\s*)([\w.]+)\.Position\s*=\s*Vector3\.new\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*$/.exec(l);
    if (!m) return l;
    let [, ind, who, x, y, z] = m; let key = [x, y, z].join(',');
    while (seen.has(key)) { x = String(+x + 6); key = [x, y, z].join(','); spread++; }
    seen.set(key, who); return `${ind}${who}.Position = Vector3.new(${x}, ${y}, ${z})`;
  });
  if (spread) changes.push('moved overlapping parts apart');

  // 4. Parts far outside the visible area: pull them in, keeping their relative layout.
  lines = lines.map(l => {
    const m = /^(\s*)([\w.]+)\.Position\s*=\s*Vector3\.new\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*$/.exec(l);
    if (!m || ![m[3], m[4], m[5]].some(n => Math.abs(+n) > 90)) return l;
    const cl = n => Math.max(-80, Math.min(80, +n)); changes.push('pulled a far-away part into view');
    return `${m[1]}${m[2]}.Position = Vector3.new(${cl(m[3])}, ${cl(m[4])}, ${cl(m[5])})`;
  });
  return { source: lines.join('\n').replace(/\n+$/, '') + '\n', changes };
}

// The message sent back to the AI when its script needs fixing.
export function fixRequest(source, verdict, round) {
  return [
    `The script you wrote did not pass the Studio check (attempt ${round} of ${MAX_FIX_ROUNDS}). Problems found:`,
    ...verdict.problems.map(p => '- ' + p),
    '',
    'Here is the script as it is now:',
    '```lua', source, '```',
    '',
    'Reply with the corrected full script in ONE ```lua code block. Keep building the same thing, and fix only what is listed.'
  ].join('\n');
}

// Pull the corrected script out of the AI's reply. Returns '' if there is no code block.
export function pickScript(reply) {
  const m = /```(?:lua|luau)\s*\n([\s\S]*?)```/i.exec(String(reply || ''));
  return m ? m[1].replace(/\s+$/, '') + '\n' : '';
}

// Drive the whole loop. All side effects are passed in, so tests can supply fakes.
//   ask(prompt)        -> Promise<string>   the AI's reply to a fix request
//   run(source)        -> { sim, skipped }  (may be async) runs the preview and the encoder dry run
//   encode(source)     -> Promise<{ok, encoded, blocks, error}>
//   show(event)        -> void              tells the UI what is happening (edit, run, check, fix, done)
export async function studioLoop({ source, ask, run, encode, show = () => {}, maxRounds = MAX_FIX_ROUNDS }) {
  let current = source, round = 0, repairs = 0, last = null;
  for (;;) {
    show({ type: 'edit', source: current, round });
    const r = await run(current);
    show({ type: 'run', parts: (r.sim.parts || []).length, round });
    const verdict = judge(r.sim, r.skipped);
    show({ type: 'check', verdict, round });
    last = { source: current, verdict, sim: r.sim };
    if (verdict.ok) break;
    if (round >= maxRounds) { show({ type: 'gaveup', verdict, round }); return { ok: false, source: current, verdict, rounds: round, repairs }; }
    // First try to repair it ourselves: free, instant, and spends no AI message. Ask the AI only if that is not enough.
    const rep = autoRepair(current, r.sim, r.skipped);
    if (rep.changes.length && rep.source.trim() !== current.trim() && repairs < MAX_FIX_ROUNDS) {
      repairs++; show({ type: 'repair', changes: [...new Set(rep.changes)], round: repairs }); current = rep.source; continue;
    }
    round += 1;
    show({ type: 'fix', round, problems: verdict.problems });
    let reply = '';
    try { reply = await ask(fixRequest(current, verdict, round)); } catch (e) { show({ type: 'gaveup', verdict, round, error: String(e && e.message || e) }); return { ok: false, source: current, verdict, rounds: round, repairs }; }
    const next = pickScript(reply);
    if (!next.trim() || next.trim() === current.trim()) { show({ type: 'gaveup', verdict, round, reason: 'no change' }); return { ok: false, source: current, verdict, rounds: round, repairs }; }
    current = next;
  }
  const enc = await encode(current);
  show({ type: 'done', encoded: !!(enc && enc.ok), rounds: round });
  return { ok: !!(enc && enc.ok), source: current, verdict: last.verdict, encoded: enc && enc.encoded, blocks: enc && enc.blocks, error: enc && enc.error, rounds: round, repairs };
}
