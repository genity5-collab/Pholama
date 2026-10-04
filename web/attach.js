// Attachments: what a model accepts, and how a file becomes something the model can read.
// Pure logic (no page code) so it is tested in test/core.test.js. One copy lives in web/ and docs/.

export const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'log', 'js', 'ts', 'py', 'lua', 'luau', 'html', 'css', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'c', 'cpp', 'h', 'java', 'kt', 'cs', 'go', 'rs', 'sh', 'bat', 'sql', 'tsv'];
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_TEXT_BYTES = 200 * 1024;      // a text file bigger than this is cut, so a small model is not flooded
export const MAX_TEXT_CHARS = 6000;            // what actually goes to the model (small models have small windows)
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 4;

// What a model accepts. A model can list "accepts" itself in its catalog entry; otherwise it is text only.
// accepts: ['text'] | ['text','image'] | ['text','file'] ...  ("file" = text-like documents; every chat model can read those once they are pasted in as text)
export function accepts(model) {
  if (!model) return { image: false, file: false };
  const a = Array.isArray(model.accepts) ? model.accepts : [];
  const caps = Array.isArray(model.caps) ? model.caps : [];
  return { image: a.includes('image') || caps.includes('vision'), file: true };
}

export function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }

// Classify one picked file: 'image' | 'text' | 'unsupported'
export function kindOf(file) {
  if (!file) return 'unsupported';
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (TEXT_EXT.includes(extOf(file.name))) return 'text';
  if (/^text\//.test(file.type || '')) return 'text';
  return 'unsupported';
}

// Decide if a batch of picked files can be sent to this model. Returns { ok, files:[{file,kind}], problems:[string] }
export function checkFiles(files, model) {
  const can = accepts(model), out = [], problems = [];
  const list = [...(files || [])];
  if (list.length > MAX_FILES) problems.push(`Up to ${MAX_FILES} files at a time (you picked ${list.length}).`);
  for (const f of list.slice(0, MAX_FILES)) {
    const k = kindOf(f);
    if (k === 'unsupported') { problems.push(`${f.name}: this file type is not supported. Text, code and images (PNG, JPG, WebP, GIF) work.`); continue; }
    if (k === 'image' && !can.image) { problems.push(`${f.name}: ${model && model.name ? model.name : 'this model'} cannot read images. Pick an image model.`); continue; }
    if (k === 'image' && f.size > MAX_IMAGE_BYTES) { problems.push(`${f.name}: image is over ${MAX_IMAGE_BYTES / 1048576} MB.`); continue; }
    out.push({ file: f, kind: k });
  }
  return { ok: out.length > 0 && !problems.length, files: out, problems };
}

// Turn the text of a file into a prompt block. Keeps the start, says plainly when it was cut.
export function textBlock(name, text) {
  let t = String(text == null ? '' : text).replace(/\u0000/g, '');
  const total = t.length;
  if (t.length > MAX_TEXT_CHARS) t = t.slice(0, MAX_TEXT_CHARS);
  const cut = total > t.length;
  return `[File: ${name}${cut ? ` (first ${t.length} of ${total} characters)` : ''}]\n${t}\n[End of file]`;
}

// Build the user message that goes to the model: text files are added as text, images are kept separately.
// Returns { content:string, images:[dataUrl], names:[string] }
export function buildMessage(userText, parts) {
  const blocks = [], images = [], names = [];
  for (const p of parts || []) {
    names.push(p.name);
    if (p.kind === 'text') blocks.push(textBlock(p.name, p.text));
    else if (p.kind === 'image') images.push(p.dataUrl);
  }
  const ask = String(userText || '').trim() || (images.length && !blocks.length ? 'Describe this image.' : 'Read the file and summarize it.');
  return { content: (blocks.length ? blocks.join('\n\n') + '\n\n' : '') + ask, images, names };
}

// Shorten an image to a size a tiny vision model handles well (long side <= max), returns a canvas size only (pure maths, so it is testable).
export function fitSize(w, h, max = 512) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

// ---------- the pair: a tiny image reader + a small chat model ----------
// The reader (SmolVLM 256M, ~190 MB) only looks: it writes down what is in the picture. The chat model then answers.
// Tested: the reader read "17+25=?" correctly and this exact hand-off made Qwen2.5 0.5B answer 42.
export const READER = { id: 'HuggingFaceTB/SmolVLM-256M-Instruct', name: 'SmolVLM 256M (image reader)', sizeMB: 190, dtype: { embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' } };
export const PAIR_BRAIN = { id: 'onnx-community/Qwen2.5-0.5B-Instruct', name: 'Qwen2.5 0.5B', sizeMB: 500 };
export const PAIR_MB = READER.sizeMB + PAIR_BRAIN.sizeMB;

export const LOOK_PROMPT = 'Write out exactly the text and numbers you can read in this image. If there is no text, describe it in one sentence.';
export const PICTURE_SYSTEM = 'You are a helpful assistant. The user sent a picture. The picture contains the text shown in <picture>. Answer the user using it.';

// Build the messages the chat model gets once the reader has looked. Keeps earlier chat, swaps the last user message.
export function withPicture(history, userText, seenList) {
  const got = (seenList || []).map(s => String(s || '').trim()).filter(Boolean);   // drop blank readings first, then number what is left
  const seen = got.map((s, i) => (got.length > 1 ? `Picture ${i + 1}: ` : '') + s).join('\n');
  const ask = String(userText || '').trim() || 'Describe it.';
  const past = (history || []).filter(m => m.role !== 'system');
  return [{ role: 'system', content: PICTURE_SYSTEM }, ...past, { role: 'user', content: `<picture>${seen || '(nothing could be read)'}</picture>\n${ask}` }];
}
