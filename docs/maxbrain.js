// Which brain powers "Agent Max"? The user picks:
//   cloud : the official Max (cloud). Has daily and monthly limits, and is the smartest option.
//   local : one of the AIs installed on the user's own PC. Free, no limits, but only as smart as that model.
// This file is plain decision logic (tested in test/maxbrain.test.js). The page only reads the answer.

export const BRAIN_KEY = 'pholama.maxBrain';
export const CLOUD = 'cloud';

// What is saved: { mode: 'cloud' } or { mode: 'local', model: 'gguf:qwen2.5-1.5b' }. Anything odd becomes the official cloud brain.
export function readBrain(raw) {
  let o = null; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  if (o && o.mode === 'local' && typeof o.model === 'string' && /^(gguf|ollama):[\w.\-:/]{1,120}$/.test(o.model)) return { mode: 'local', model: o.model };
  return { mode: CLOUD };
}
export const saveBrain = b => JSON.stringify(b && b.mode === 'local' && b.model ? { mode: 'local', model: b.model } : { mode: CLOUD });

// Only models that live on the PC can be a local brain. Never a phone/browser model, never another cloud one, never a remote key.
export function localChoices(models) {
  return (models || []).filter(m => m && typeof m.id === 'string' && /^(gguf|ollama):/.test(m.id)).map(m => ({ id: m.id, name: String(m.name || m.id).replace(/^(gguf|ollama):/, ''), tools: m.tools !== false }));
}

// What should the "Agent Max" entry actually run right now?
//   isPc:     this page is served by the user's own PC app (the website has no local AI)
//   installed: models installed on the PC (ids like 'gguf:...')
// Returns { run: 'cloud' } or { run: 'local', model } plus a one-line `note` the page can show.
export function resolveBrain({ brain, isPc, installed }) {
  const b = readBrain(brain);
  if (b.mode !== 'local') return { run: 'cloud', note: '' };
  if (!isPc) return { run: 'cloud', note: 'A local brain only works in the PC app, so Max uses the official cloud brain here.' };
  const have = (installed || []).includes(b.model);
  if (!have) return { run: 'cloud', note: 'Your chosen local AI is not installed on this PC any more, so Max uses the official cloud brain. Pick another one in Settings > Usage.' };
  return { run: 'local', model: b.model, note: 'Max runs on ' + b.model.replace(/^(gguf|ollama):/, '') + ' on your PC. Free and unlimited, as smart as that model.' };
}

// The two choices, written for the Settings card.
export function brainChoices(models) {
  const loc = localChoices(models);
  return [
    { value: CLOUD, label: 'Max (official, cloud)', help: 'The smartest. Uses your daily and monthly Max messages.' },
    ...loc.map(m => ({ value: m.id, label: m.name + ' (local, free)', help: 'Free and unlimited. Only as smart as this model.' + (m.tools ? '' : ' It cannot use tools.') })),
  ];
}
// Studio and tools need a model that can run them. The page uses this to warn, not to block.
export function brainWarning(choice, models) {
  if (!choice || choice === CLOUD) return '';
  const m = (models || []).find(x => x.id === choice); if (!m) return '';
  return m.tools === false ? 'This local AI cannot use tools, so in Studio it can talk but not edit your files. Pick a tool model for that.' : '';
}
