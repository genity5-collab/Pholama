// The image reader for the browser: SmolVLM 256M through transformers.js (same code path that was tested in Node).
// Loads once, then looks at each picture and returns the text it sees. Nothing is sent anywhere.
import { READER, LOOK_PROMPT, fitSize } from './attach.js';

let tf = null, proc = null, vlm = null, loading = null;
export const readerLoaded = () => !!vlm;

async function lib() { return tf || (tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3')); }

// onProgress({pct, file}) is called while the ~190 MB downloads (first time only, then the browser cache has it).
export async function loadReader(onProgress) {
  if (vlm) return;
  if (loading) return loading;
  loading = (async () => {
    const t = await lib(), files = {};
    const progress_callback = p => {
      if (p.file && p.total) files[p.file] = { l: p.loaded || 0, t: p.total };
      const all = Object.values(files), tot = all.reduce((a, f) => a + f.t, 0), got = all.reduce((a, f) => a + f.l, 0);
      if (onProgress && tot) onProgress({ pct: Math.min(99, Math.round(got / tot * 100)), file: p.file || '' });
    };
    proc = await t.AutoProcessor.from_pretrained(READER.id, { progress_callback });
    // WebGPU when the phone has it, otherwise the CPU (slower, still works)
    const device = (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
    try { vlm = await t.AutoModelForVision2Seq.from_pretrained(READER.id, { dtype: READER.dtype, device, progress_callback }); }
    catch (e) { if (device === 'webgpu') vlm = await t.AutoModelForVision2Seq.from_pretrained(READER.id, { dtype: READER.dtype, device: 'wasm', progress_callback }); else throw e; }
    if (onProgress) onProgress({ pct: 100, file: '' });
  })();
  try { await loading; } finally { loading = null; }
}

// Shrink a picked image to a canvas, so a 12 MP photo does not swamp a tiny model (or the phone's memory).
async function toImage(file) {
  const t = await lib(), url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image could not be opened.')); i.src = url; });
    const s = fitSize(img.naturalWidth, img.naturalHeight, 768), c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
    c.getContext('2d').drawImage(img, 0, 0, s.w, s.h);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return await t.RawImage.fromBlob(blob);
  } finally { URL.revokeObjectURL(url); }
}

// Look at one picture. Returns the text the reader wrote.
export async function look(file, question) {
  if (!vlm) throw new Error('The image reader is not loaded yet.');
  const image = await toImage(file);
  const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: question || LOOK_PROMPT }] }];
  const inputs = await proc(proc.apply_chat_template(messages, { add_generation_prompt: true }), [image], { do_image_splitting: false });
  const out = await vlm.generate({ ...inputs, max_new_tokens: 96 });
  return proc.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0].trim();
}
