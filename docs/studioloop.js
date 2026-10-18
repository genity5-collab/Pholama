// The Studio loop: the AI writes a script, the workspace "runs" it into a model preview, the result is checked,
// and if it is wrong the AI is shown what is wrong and fixes it. Only when it looks right is the script encoded.
// Nothing here runs Lua. "Running" means the safe preview that reads the script and builds the parts it describes.
// The module is pure (no DOM, no network) so every decision can be tested.

export const MAX_FIX_ROUNDS = 3;

// The rules the AI must follow so its script can be turned into blocks. The encoder only reads this subset.
export const STUDIO_RULES = [
  'You are writing a script for RetroStudio. The script will be converted to blocks, so write ONLY this simple Lua, one statement per line:',
  '- local part = Instance.new("Part", workspace)   then   part.Size = Vector3.new(4, 1, 4)   part.Position = Vector3.new(0, 5, 0)',
  '- part.Anchored = true   part.BrickColor = BrickColor.new("Bright red")   part.Material = Enum.Material.Wood',
  '- local x = 5      print("hello")      wait(1)      local t = {}      t["key"] = "value"',
  '- if a == b then ... else ... end      for i = 1, 10 do ... end      (simple comparisons only)',
  '- part.Touched:Connect(function(hit)  ...  end)      button.MouseButton1Click:Connect(function()  ...  end)',
  '- For any other RetroStudio block write a directive line:  --@block BlockName Field=value',
  'Do NOT use: elseif, while, function definitions, for-in loops, GetService, math expressions, string.format, or anything else. Those lines cannot be converted.',
  'Put every script in its own ```lua code block. Say what each script does in one short sentence.'
].join('\n');

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
  const sameSpot = new Map();
  for (const p of parts) { const k = p.position.map(n => Math.round(n)).join(','); sameSpot.set(k, (sameSpot.get(k) || 0) + 1); }
  const stacked = [...sameSpot.values()].filter(n => n > 1).length;
  if (stacked) problems.push('Some parts sit in exactly the same place and overlap. Give each part its own position.');
  const unconvertible = (skipped || []).filter(s => !/^Skip: end$/.test(s));
  if (unconvertible.length) problems.push(`${unconvertible.length} line${unconvertible.length === 1 ? '' : 's'} cannot be converted to blocks: ${unconvertible.slice(0, 4).map(s => s.replace(/^Skip(?:ped[^:]*)?:\s*/, '').slice(0, 60)).join(' | ')}. Rewrite using only the allowed lines, or a --@block directive.`);
  return { ok: problems.length === 0, problems, parts: parts.length };
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
    'Reply with the corrected full script in ONE ```lua code block, using only the allowed lines. Keep it short.'
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
  let current = source, round = 0, last = null;
  for (;;) {
    show({ type: 'edit', source: current, round });
    const r = await run(current);
    show({ type: 'run', parts: (r.sim.parts || []).length, round });
    const verdict = judge(r.sim, r.skipped);
    show({ type: 'check', verdict, round });
    last = { source: current, verdict, sim: r.sim };
    if (verdict.ok) break;
    if (round >= maxRounds) { show({ type: 'gaveup', verdict, round }); return { ok: false, source: current, verdict, rounds: round }; }
    round += 1;
    show({ type: 'fix', round, problems: verdict.problems });
    let reply = '';
    try { reply = await ask(fixRequest(current, verdict, round)); } catch (e) { show({ type: 'gaveup', verdict, round, error: String(e && e.message || e) }); return { ok: false, source: current, verdict, rounds: round }; }
    const next = pickScript(reply);
    if (!next.trim() || next.trim() === current.trim()) { show({ type: 'gaveup', verdict, round, reason: 'no change' }); return { ok: false, source: current, verdict, rounds: round }; }
    current = next;
  }
  const enc = await encode(current);
  show({ type: 'done', encoded: !!(enc && enc.ok), rounds: round });
  return { ok: !!(enc && enc.ok), source: current, verdict: last.verdict, encoded: enc && enc.encoded, blocks: enc && enc.blocks, error: enc && enc.error, rounds: round };
}
