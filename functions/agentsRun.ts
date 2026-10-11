// Runs ONE subagent on a file or text, against Free.ai's self-hosted models only. Injectable fetch, so it is tested without the internet.
// Shapes were checked live against api.free.ai: image routes take multipart `image`, OCR takes JSON `image_url`, TTS takes {text,model}.
import { findAgent, isSelfHosted, available, type AgentDef } from './agentsCore.ts';

export const MAX_FILE = 6 * 1024 * 1024;   // 6 MB keeps the free plan light
const BASE = 'https://api.free.ai';
export type RunInput = { role: string; config?: string; text?: string; fileBase64?: string; mime?: string; lang?: string };
export type RunOut = { ok: boolean; role: string; label: string; model: string | null; kind: 'text' | 'image' | 'audio' | 'model3d' | 'job'; text?: string; url?: string; jobId?: string; error?: string };

const b64ToBytes = (s: string) => { const bin = atob(s.replace(/^data:[^,]*,/, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const okMime = (m: string, kinds: string[]) => kinds.some(k => String(m || '').toLowerCase().startsWith(k));
const absUrl = (u: unknown) => { const s = String(u || ''); if (!s) return ''; if (/^https:\/\/api\.free\.ai\//.test(s)) return s; if (s.startsWith('/')) return BASE + s; return ''; };   // only Free.ai's own files are ever returned

export async function runSubagent(key: string, inp: RunInput, f: typeof fetch = fetch): Promise<RunOut> {
  const a: AgentDef | null = findAgent(inp.config === 'two' ? 'two' : 'one', String(inp.role || ''));
  const base = (o: Partial<RunOut>): RunOut => ({ ok: false, role: String(inp.role || ''), label: a?.label || String(inp.role || ''), model: a?.model || null, kind: 'text', ...o });
  if (!a) return base({ error: 'This configuration has no such agent.' });
  if (!available(a) || !a.endpoint) return base({ error: a.note || 'This agent is unavailable.' });
  if (!isSelfHosted(a.model)) return base({ error: 'Only Free.ai\'s free self-hosted models are allowed.' });   // a premium model can never be called
  if (!key) return base({ error: 'The cloud agents are not configured yet.' });
  const H = { Authorization: 'Bearer ' + key, 'User-Agent': 'pholama' };
  // The free GPUs sleep when idle, so the first call can time out while one wakes up. One retry, nothing more (free plan stays light).
  const call = async (path: string, init: RequestInit) => {
    for (let tries = 0; ; tries++) {
      try { const r = await f(BASE + path, { ...init, headers: { ...H, ...(init.headers || {}) }, signal: AbortSignal.timeout(tries ? 45000 : 30000) }); const j: any = await r.json().catch(() => ({})); return { r, j }; }
      catch (e) { if (tries >= 1 || !/timed out|abort/i.test(String((e as Error)?.message))) throw e; }
    }
  };
  const fail = (r: Response, j: any) => base({ error: r.status === 429 ? 'The free GPU is busy. Try again in a minute.' : String(j?.error || 'The agent could not do that (' + r.status + ').').slice(0, 220) });
  const needFile = (kinds: string[]) => {
    if (!inp.fileBase64) return 'Attach a file first.';
    let bytes: Uint8Array; try { bytes = b64ToBytes(inp.fileBase64); } catch { return 'That file could not be read.'; }
    if (bytes.length > MAX_FILE) return 'That file is too big (max ' + MAX_FILE / 1048576 + ' MB on the free plan).';
    if (!okMime(inp.mime || '', kinds)) return 'This agent needs ' + kinds.map(k => k.replace('/', '')).join(' or ') + ' files.';
    return '';
  };
  const form = (name: string) => { const fd = new FormData(); fd.append(name, new Blob([b64ToBytes(inp.fileBase64!)], { type: inp.mime || 'application/octet-stream' }), name === 'audio' ? 'clip.wav' : 'upload.png'); return fd; };
  try {
    switch (a.role) {
      case 'vision': { const e = needFile(['image/']); if (e) return base({ error: e }); const { r, j } = await call(a.endpoint, { method: 'POST', body: form('image') }); const t = String(j?.description || j?.text || ''); return r.ok && t ? base({ ok: true, text: t.slice(0, 2000) }) : fail(r, j); }
      case 'depth': { const e = needFile(['image/']); if (e) return base({ error: e }); const { r, j } = await call(a.endpoint, { method: 'POST', body: form('image') }); const u = absUrl(j?.image_url || j?.url); return r.ok && u ? base({ ok: true, kind: 'image', url: u, text: 'Depth map ready.' }) : fail(r, j); }
      case 'imageedit': { const e = needFile(['image/']); if (e) return base({ error: e }); const { r, j } = await call(a.endpoint, { method: 'POST', body: form('image') }); const u = absUrl(j?.image_url || j?.url); return r.ok && u ? base({ ok: true, kind: 'image', url: u, text: 'Background removed.' }) : fail(r, j); }
      case 'ocr': case 'document': {
        const e = needFile(['image/']); if (e) return base({ error: e });
        const { r, j } = await call(a.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: 'data:' + inp.mime + ';base64,' + inp.fileBase64!.replace(/^data:[^,]*,/, '') }) });
        const t = String(j?.text || j?.result || ''); return r.ok && t ? base({ ok: true, text: t.slice(0, 4000) }) : fail(r, j);
      }
      case 'stt': {
        const e = needFile(['audio/', 'video/']); if (e) return base({ error: e });
        const { r, j } = await call(a.endpoint, { method: 'POST', body: form('audio') }); if (!r.ok) return fail(r, j);
        const t = String(j?.text || j?.transcript || ''); return t ? base({ ok: true, text: t.slice(0, 4000) }) : base({ ok: true, kind: 'job', jobId: String(j?.job_id || ''), text: 'Queued. Check back in a moment.' });
      }
      case 'voice': {
        const t = String(inp.text || '').trim(); if (!t) return base({ error: 'Write the text to speak.' }); if (t.length > 600) return base({ error: 'Keep it under 600 characters on the free plan.' });
        const { r, j } = await call(a.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, model: a.model }) }); if (!r.ok) return fail(r, j);
        return j?.queued ? base({ ok: true, kind: 'job', jobId: String(j.job_id || ''), text: 'The voice is being made. It appears when the free GPU is ready.' }) : base({ ok: true, kind: 'audio', url: absUrl(j?.url || j?.audio_url), text: 'Voice ready.' });
      }
      case 'translation': {
        const t = String(inp.text || '').trim(); if (!t) return base({ error: 'Write the text to translate.' }); if (t.length > 2000) return base({ error: 'Keep it under 2000 characters on the free plan.' });
        const { r, j } = await call(a.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, target: String(inp.lang || 'en').slice(0, 8) }) });
        const out = String(j?.translated_text || j?.translation || j?.text || ''); return r.ok && out ? base({ ok: true, text: out.slice(0, 3000) }) : fail(r, j);
      }
      case '3d': {
        const e = needFile(['image/']); if (e) return base({ error: e }); const { r, j } = await call(a.endpoint, { method: 'POST', body: form('image') }); if (!r.ok) return fail(r, j);
        return base({ ok: true, kind: 'job', jobId: String(j?.job_id || ''), url: absUrl(j?.url || j?.model_url), text: j?.queued ? 'The 3D model is queued on the free GPU.' : '3D model ready.' });
      }
      case 'audio': {
        const t = String(inp.text || '').trim(); if (!t) return base({ error: 'Describe the sound or music.' }); if (t.length > 300) return base({ error: 'Keep it under 300 characters on the free plan.' });
        const { r, j } = await call(a.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: t, model: a.model, duration: 10 }) }); if (!r.ok) return fail(r, j);
        return base({ ok: true, kind: j?.queued ? 'job' : 'audio', jobId: String(j?.job_id || ''), url: absUrl(j?.url || j?.audio_url), text: j?.queued ? 'The music is queued on the free GPU.' : 'Audio ready.' });
      }
    }
    return base({ error: 'This agent cannot run from here yet.' });
  } catch (e) { return base({ error: /timed out|abort/i.test(String((e as Error)?.message)) ? 'The free GPU took too long. Try again in a minute.' : 'The agent could not be reached.' }); }
}

// Poll a queued job. Only Free.ai's own output links are returned.
export async function pollJob(key: string, jobId: string, f: typeof fetch = fetch) {
  if (!/^[a-f0-9-]{8,64}$/i.test(String(jobId || ''))) return { status: 'error', error: 'Bad job id.' };
  try { const r = await f(BASE + '/v1/status/' + jobId + '/', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) }); const j: any = await r.json().catch(() => ({}));
    const st = String(j?.status || 'unknown'), url = absUrl(j?.url || j?.output_url || j?.image_url || j?.audio_url);
    return st === 'done' || st === 'completed' || url ? { status: 'done', url } : { status: st === 'unknown' ? 'waiting' : st };
  } catch { return { status: 'waiting' }; }
}
