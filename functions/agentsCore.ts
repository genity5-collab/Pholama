// Pholama cloud agents: the two configurations, subagent routing, credit costs, names. Pure logic, no network, so it is fully testable.
// Every agent points at a model Free.ai REALLY hosts. An agent whose model Free.ai does not host is listed as unavailable, never faked.

export type Role = 'chat' | 'depth' | 'ocr' | 'stt' | 'voice' | 'vision' | '3d' | 'audio' | 'translation' | 'imageedit' | 'document' | 'avatar';
export type AgentDef = { role: Role; label: string; asked: string; model: string | null; type: string; cost: number; endpoint?: string; note?: string };

// "asked" is the model the user named. "model" is what Free.ai hosts that does the job (null = nothing equivalent exists).
export const CONFIGS: Record<'one' | 'two', { id: 'one' | 'two'; label: string; agents: AgentDef[] }> = {
  one: {
    id: 'one', label: 'First configuration',
    agents: [
      { role: 'chat', label: 'Chat agent', asked: 'Phi-3 Mini', model: 'qwen3-8b', type: 'chat', cost: 0, note: 'Phi-3 Mini is not hosted by Free.ai, so Qwen 3 8B answers.' },
      { role: 'depth', label: 'Depth agent', asked: 'Marigold Depth', model: 'marigold-depth', type: 'depth', cost: 3, endpoint: '/v1/image/depth-map/' },
      { role: 'ocr', label: 'OCR agent', asked: 'TrOCR Base', model: 'got-ocr2', type: 'ocr', cost: 2, endpoint: '/v1/ocr/', note: 'TrOCR Base is not hosted by Free.ai, so GOT-OCR 2.0 reads text.' },
      { role: 'stt', label: 'Speech-to-text', asked: 'faster-whisper large-v3-turbo', model: 'whisper', type: 'stt', cost: 2, endpoint: '/v1/stt/' },
      { role: 'voice', label: 'Voice agent', asked: 'Piper', model: 'kokoro', type: 'tts', cost: 1, endpoint: '/v1/tts/', note: 'Free.ai turned off its English Piper voice for licensing reasons, so Kokoro speaks.' },
      { role: 'vision', label: 'Vision agent', asked: 'Molmo 7B', model: 'qwen25-vl', type: 'vision', cost: 3, endpoint: '/v1/image/describe/', note: 'Molmo 7B is not hosted by Free.ai, so Qwen2.5-VL 7B looks at images.' },
      { role: '3d', label: '3D agent', asked: 'TripoSR', model: 'triposr', type: '3d', cost: 8, endpoint: '/v1/3d/generate/' },
      { role: 'audio', label: 'Audio agent', asked: 'AudioLDM 2', model: 'ace-step', type: 'music', cost: 6, endpoint: '/v1/music/generate/', note: 'AudioLDM 2 is not hosted by Free.ai, so ACE-Step makes the audio.' },
      { role: 'translation', label: 'Translation agent', asked: 'Opus-MT', model: 'madlad', type: 'translation', cost: 1, endpoint: '/v1/translate/', note: 'Opus-MT is not hosted by Free.ai, so MadLAD-400 translates.' }
    ]
  },
  two: {
    id: 'two', label: 'Second configuration',
    agents: [
      { role: 'chat', label: 'Chat agent', asked: 'Mistral 7B', model: 'mistral', type: 'chat', cost: 0 },
      { role: 'imageedit', label: 'Image editing agent', asked: 'BiRefNet v2', model: 'rmbg', type: 'bg_removal', cost: 3, endpoint: '/v1/image/remove-bg/', note: 'BiRefNet v2 is not hosted by Free.ai, so the Background Remover (u2net) edits images.' },
      { role: 'document', label: 'Document agent', asked: 'Florence-2 Large', model: 'paddleocr-vl', type: 'ocr', cost: 3, endpoint: '/v1/ocr/', note: 'Florence-2 Large is not hosted by Free.ai, so PaddleOCR-VL reads documents.' },
      { role: 'stt', label: 'Speech-to-text', asked: 'faster-whisper large-v3-turbo', model: 'whisper', type: 'stt', cost: 2, endpoint: '/v1/stt/' },
      { role: 'voice', label: 'Voice agent', asked: 'Kokoro', model: 'kokoro', type: 'tts', cost: 1, endpoint: '/v1/tts/' },
      { role: 'avatar', label: 'Talking-avatar agent', asked: 'SadTalker', model: null, type: 'avatar', cost: 0, note: 'Free.ai turned SadTalker off (its face model is non-commercial only). Premium lip-sync needs purchased tokens, so this agent is unavailable.' },
      { role: 'vision', label: 'Vision agent', asked: 'Molmo 7B', model: 'qwen25-vl', type: 'vision', cost: 3, endpoint: '/v1/image/describe/', note: 'Molmo 7B is not hosted by Free.ai, so Qwen2.5-VL 7B looks at images.' },
      { role: 'translation', label: 'Translation agent', asked: 'Opus-MT', model: 'madlad', type: 'translation', cost: 1, endpoint: '/v1/translate/', note: 'Opus-MT is not hosted by Free.ai, so MadLAD-400 translates.' }
    ]
  }
};


// Free.ai hosts 45 free models itself and resells ~450 premium ones that spend purchased tokens. This list is the ONLY thing the code may call.
export const SELF_HOSTED = new Set(['qwen7b','qwen-coder','qwen3-coder','qwen3-8b','mistral','deepseek-r1','deepseek-r1-7b','kokoro','whisper','madlad','rmbg','triposr','trellis2-4b','got-ocr2','paddleocr-vl','unlimited-ocr','tesseract','qwen25-vl','qwen-vl','moondream2','ace-step','marigold-depth','qwen-image-edit','bge-m3']);
export const isSelfHosted = (model: unknown) => typeof model === 'string' && SELF_HOSTED.has(model) && !model.includes('/');
// Chat models that are free: small and fast first (the free plan must stay light).
export const LIGHT_CHAT = ['qwen3-8b', 'mistral'];

// The user picks up to TWO agents to work with (the chat agent of a configuration is always one of them).
export const MAX_PICKED = 2;
export const SUBAGENT_LIMIT = 4;   // most subagents one message may call

export const ADJ = ['Nova', 'Ember', 'Quartz', 'Willow', 'Comet', 'Juniper', 'Atlas', 'Sable', 'Orbit', 'Maple', 'Pixel', 'River', 'Cobalt', 'Aster', 'Echo', 'Lumen'];
export const NOUN = ['Fox', 'Owl', 'Wren', 'Lynx', 'Otter', 'Heron', 'Finch', 'Badger', 'Panda', 'Gecko', 'Moth', 'Raven', 'Koala', 'Newt', 'Crane', 'Hare'];

// A friendly random name, stable for one user (so it does not change on every visit).
export function randomName(seed: string): string {
  let h = 2166136261; for (const c of String(seed || 'x')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return ADJ[h % ADJ.length] + ' ' + NOUN[(h >>> 8) % NOUN.length];
}
// A chosen name: letters, numbers, spaces, dash, apostrophe. 2 to 24 characters. Nothing that could pass for a system label.
export function cleanName(v: unknown): string {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 24) throw new Error('Pick a name between 2 and 24 characters.');
  if (!/^[\p{L}\p{N} '\-]+$/u.test(s)) throw new Error('A name can use letters, numbers, spaces, dash and apostrophe.');
  if (/\b(pholama|admin|moderator|staff|support|system|agent max|max)\b/i.test(s)) throw new Error('That name is reserved. Pick another.');
  return s;
}

export const available = (a: AgentDef) => !!a.model;
export function getConfig(id: unknown) { return CONFIGS[id === 'two' ? 'two' : 'one']; }
export function findAgent(cfg: 'one' | 'two', role: string) { return getConfig(cfg).agents.find(a => a.role === role) || null; }

// Which agents may a user turn on? Max two, from ONE configuration, the chat agent first. Unavailable agents can never be picked.
export function pickAgents(cfg: unknown, roles: unknown): { config: 'one' | 'two'; picked: string[] } {
  const c = getConfig(cfg), want = (Array.isArray(roles) ? roles : []).map(String), out: string[] = [];
  for (const r of ['chat', ...want]) {
    const a = c.agents.find(x => x.role === r); if (!a || !available(a) || out.includes(r)) continue;
    out.push(r); if (out.length >= MAX_PICKED) break;
  }
  return { config: c.id, picked: out };
}


// Free plan = light. If a member has not picked two agents, add ONE cheap, useful second agent on their behalf, and keep the heavy ones
// (3D, music) off until they ask for them. A member's own picks always win and are never replaced.
const LIGHT_SECOND: Record<'one' | 'two', Role[]> = { one: ['ocr', 'translation', 'vision'], two: ['translation', 'vision', 'document'] };
export function autoPick(cfg: unknown, roles: unknown): { config: 'one' | 'two'; picked: string[]; auto: string[] } {
  const base = pickAgents(cfg, roles), c = getConfig(base.config), picked = [...base.picked], auto: string[] = [];
  for (const r of LIGHT_SECOND[base.config]) {
    if (picked.length >= MAX_PICKED) break;
    const a = c.agents.find(x => x.role === r);
    if (a && available(a) && !picked.includes(r)) { picked.push(r); auto.push(r); }
  }
  return { config: base.config, picked, auto };
}
// Subagents run on their own for the request, but only light ones unless the member picked a heavy one. 3D and music cost a lot.
export const HEAVY: Role[] = ['3d', 'audio'];
export const isHeavy = (a: AgentDef) => HEAVY.includes(a.role) || a.cost >= 6;

// Which subagents does a message ask for? Only ones the user allowed, never more than the limit. "no subagents" always wins.
const SUBS: { role: Role; re: RegExp }[] = [
  { role: '3d', re: /\b(3d|mesh|model of|3-d|obj file|glb)\b/i },
  { role: 'ocr', re: /\b(ocr|read (the )?text|extract text|scan(ned)? (this|the)|what does (this|the) (image|picture|photo|page) say)\b/i },
  { role: 'document', re: /\b(document|pdf|invoice|receipt|form|table in)\b/i },
  { role: 'vision', re: /\b(look at|describe (this|the) (image|picture|photo)|what('s| is) in (this|the) (image|picture|photo)|screenshot)\b/i },
  { role: 'translation', re: /\btranslat(e|ion)\b/i },
  { role: 'audio', re: /\b(make|generate|compose) (some )?(music|a song|sound|audio)\b/i },
  { role: 'stt', re: /\b(transcribe|speech to text|what (was|is) said in)\b/i },
  { role: 'voice', re: /\b(read (it|this) (out|aloud)|say it|text to speech|speak this)\b/i },
  { role: 'imageedit', re: /\b(remove (the )?background|cut ?out|background remov)/i },
  { role: 'depth', re: /\bdepth (map|estimation)\b/i },
  { role: 'avatar', re: /\b(talking (avatar|head)|lip ?sync)\b/i }
];
export function chooseSubagents(text: string, cfg: unknown, opts: { subagents?: boolean; allow?: string[] } = {}) {
  const c = getConfig(cfg);
  if (opts.subagents === false) return { use: [] as AgentDef[], skipped: [] as { role: string; why: string }[], disabled: true };
  const allow = opts.allow && opts.allow.length ? new Set(opts.allow) : null, use: AgentDef[] = [], skipped: { role: string; why: string }[] = [];
  for (const s of SUBS) {
    if (!s.re.test(String(text || ''))) continue;
    const a = c.agents.find(x => x.role === s.role);
    if (!a) { skipped.push({ role: s.role, why: 'This configuration has no ' + s.role + ' agent.' }); continue; }
    if (!available(a)) { skipped.push({ role: s.role, why: a.note || 'Unavailable.' }); continue; }
    if (allow && !allow.has(s.role)) { skipped.push({ role: s.role, why: isHeavy(a) ? 'This one costs ' + a.cost + ' credits, so it only runs when you turn it on.' : 'You turned this subagent off.' }); continue; }
    if (isHeavy(a) && !(opts.allow || []).includes(s.role)) { skipped.push({ role: s.role, why: 'This one costs ' + a.cost + ' credits, so it only runs when you turn it on.' }); continue; }
    if (use.length >= SUBAGENT_LIMIT) { skipped.push({ role: s.role, why: 'At most ' + SUBAGENT_LIMIT + ' subagents run per message.' }); continue; }
    use.push(a);
  }
  return { use, skipped, disabled: false };
}
export const subagentCost = (list: AgentDef[]) => list.reduce((n, a) => n + a.cost, 0);

// The cloud agent has no fixed product name. It answers to the user's chosen name, or a random one.
export function agentName(profile: { chosen?: string | null }, seed: string) {
  if (profile && profile.chosen) { try { return cleanName(profile.chosen); } catch { /* fall through */ } }
  return randomName(seed);
}
export function systemPrompt(name: string, cfg: 'one' | 'two', picked: string[]) {
  const c = getConfig(cfg), names = c.agents.filter(a => picked.includes(a.role) && available(a)).map(a => a.label + ' (' + a.asked + ')');
  return `You are ${name}, the cloud assistant inside Pholama. Be clear, friendly and honest. If you do not know something, say so. ` +
    `Never claim to have used a tool or subagent that the host did not report. Active agents: ${names.join(', ') || 'chat only'}.`;
}
