// Subagent runner against a FAKE Free.ai (no internet, no key): shapes, limits, refusals, self-hosted lock, light free-plan picks.
const { execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-')); const bundle = f => { const o = path.join(dir, f + '.mjs'); execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', f + '.ts'), '--bundle', '--format=esm', '--log-level=error', '--outfile=' + o], { cwd: path.join(__dirname, '..') }); return o; };
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
(async () => {
  const R = await import('file://' + bundle('agentsRun')), A = await import('file://' + bundle('agentsCore'));
  const calls = []; const fake = (route) => async (url, init) => { calls.push({ url: String(url), init }); const r = route(String(url), init); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const hdr = c => c.init.headers || {};
  // --- the free-only lock
  ok('every model any agent uses is on the self-hosted allowlist', A.CONFIGS.one.agents.concat(A.CONFIGS.two.agents).filter(a => a.model).every(a => A.isSelfHosted(a.model)), '');
  ok('premium-style ids are refused', !A.isSelfHosted('openai/gpt-6.1-sol') && !A.isSelfHosted('anthropic/claude-haiku-5.5') && !A.isSelfHosted('nvidia/anything') && !A.isSelfHosted(null));
  ok('the lists name only real agents (depth is real, avatar is off with the true reason)', A.available(A.findAgent('one', 'depth')) && !A.available(A.findAgent('two', 'avatar')) && /non-commercial/.test(A.findAgent('two', 'avatar').note));
  ok('the English Piper voice is replaced by Kokoro because Free.ai turned it off', A.findAgent('one', 'voice').model === 'kokoro' && /licensing/.test(A.findAgent('one', 'voice').note));
  // --- vision / depth / bg removal use multipart `image`
  let f = fake(u => u.endsWith('/v1/image/describe/') ? { status: 200, body: { description: 'A gradient.' } } : { status: 404, body: {} });
  let r = await R.runSubagent('K', { role: 'vision', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('vision returns the description', r.ok && r.text === 'A gradient.' && r.model === 'qwen25-vl', JSON.stringify(r));
  ok('the key goes in the auth header only', hdr(calls[0]).Authorization === 'Bearer K' && !calls[0].url.includes('K'));
  ok('vision sends a multipart form, not JSON', calls[0].init.body instanceof FormData && calls[0].url === 'https://api.free.ai/v1/image/describe/');
  f = fake(u => ({ status: 200, body: { image_url: 'https://api.free.ai/static/outputs/a.png' } }));
  r = await R.runSubagent('K', { role: 'depth', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('depth returns a Free.ai image link', r.ok && r.kind === 'image' && r.url === 'https://api.free.ai/static/outputs/a.png');
  r = await R.runSubagent('K', { role: 'imageedit', config: 'two', fileBase64: PNG, mime: 'image/png' }, f); ok('background removal works from configuration two', r.ok && r.kind === 'image');
  f = fake(u => ({ status: 200, body: { image_url: 'https://evil.example/x.png' } })); r = await R.runSubagent('K', { role: 'depth', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('a link that is not Free.ai\'s is never returned', !r.ok, JSON.stringify(r));
  // --- OCR uses JSON image_url
  calls.length = 0; f = fake(u => ({ status: 200, body: { text: 'HELLO 42' } })); r = await R.runSubagent('K', { role: 'ocr', config: 'one', fileBase64: PNG, mime: 'image/png' }, f);
  ok('OCR reads text', r.ok && r.text === 'HELLO 42'); const body = JSON.parse(calls[0].init.body); ok('OCR sends a JSON image_url data link', /^data:image\/png;base64,/.test(body.image_url) && !body.image);
  r = await R.runSubagent('K', { role: 'document', config: 'two', fileBase64: PNG, mime: 'image/png' }, f); ok('the document agent reads documents', r.ok && r.model === 'paddleocr-vl');
  f = fake(() => ({ status: 422, body: { error: 'We could not read text from this image. You were not charged for this request.' } })); r = await R.runSubagent('K', { role: 'ocr', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('an unreadable image gives the real reason', !r.ok && /could not read text/.test(r.error));
  // --- tts / translate / audio use JSON text
  calls.length = 0; f = fake(() => ({ status: 200, body: { queued: true, job_id: 'abc-123-def-456' } })); r = await R.runSubagent('K', { role: 'voice', config: 'two', text: 'hello' }, f);
  ok('a queued voice job returns a job id', r.ok && r.kind === 'job' && r.jobId === 'abc-123-def-456'); ok('voice asks for the self-hosted Kokoro model', JSON.parse(calls[0].init.body).model === 'kokoro');
  r = await R.runSubagent('K', { role: 'voice', config: 'two', text: 'x'.repeat(601) }, f); ok('long voice text is refused on the free plan', !r.ok && /600/.test(r.error));
  calls.length = 0; f = fake(() => ({ status: 200, body: { translated_text: 'Salut', source: 'auto', target: 'ro' } })); r = await R.runSubagent('K', { role: 'translation', config: 'one', text: 'Hello', lang: 'ro' }, f); ok('translation reads the real translated_text field', r.ok && r.text === 'Salut', JSON.stringify(r)); ok('translation sends the real target field', JSON.parse(calls[0].init.body).target === 'ro');
  // --- file checks
  r = await R.runSubagent('K', { role: 'vision', config: 'one' }, f); ok('no file means a clear message and no request', !r.ok && /Attach a file/.test(r.error));
  r = await R.runSubagent('K', { role: 'vision', config: 'one', fileBase64: PNG, mime: 'application/pdf' }, f); ok('the wrong file type is refused', !r.ok && /image/.test(r.error));
  r = await R.runSubagent('K', { role: 'stt', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('speech needs audio, not a picture', !r.ok && /audio/.test(r.error));
  r = await R.runSubagent('K', { role: 'vision', config: 'one', fileBase64: Buffer.alloc(R.MAX_FILE + 10).toString('base64'), mime: 'image/png' }, f); ok('a file over the free-plan limit is refused', !r.ok && /too big/.test(r.error));
  // --- unavailable + missing key
  calls.length = 0; r = await R.runSubagent('K', { role: 'avatar', config: 'two', fileBase64: PNG, mime: 'image/png' }, f); ok('the avatar agent refuses without calling anything', !r.ok && /non-commercial/.test(r.error) && calls.length === 0);
  r = await R.runSubagent('', { role: 'vision', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('no key means not configured', !r.ok && /not configured/.test(r.error));
  r = await R.runSubagent('K', { role: 'nope', config: 'one' }, f); ok('an unknown agent is refused', !r.ok);
  r = await R.runSubagent('K', { role: '3d', config: 'two', fileBase64: PNG, mime: 'image/png' }, f); ok('an agent the configuration does not have is refused', !r.ok && /no such agent/.test(r.error));
  f = fake(() => ({ status: 429, body: {} })); r = await R.runSubagent('K', { role: 'vision', config: 'one', fileBase64: PNG, mime: 'image/png' }, f); ok('a busy GPU is reported kindly', !r.ok && /busy/.test(r.error));
  r = await R.runSubagent('K', { role: 'vision', config: 'one', fileBase64: PNG, mime: 'image/png' }, async () => { throw new Error('boom'); }); ok('a network failure never throws', !r.ok && /could not be reached/.test(r.error));
  // --- polling
  let p = await R.pollJob('K', 'abc-123-def-456', async () => ({ ok: true, json: async () => ({ job_id: 'x', status: 'unknown' }) })); ok('an unfinished job says waiting', p.status === 'waiting');
  p = await R.pollJob('K', 'abc-123-def-456', async () => ({ ok: true, json: async () => ({ status: 'done', url: 'https://api.free.ai/static/outputs/z.wav' }) })); ok('a finished job returns its Free.ai link', p.status === 'done' && /api\.free\.ai/.test(p.url));
  p = await R.pollJob('K', '../../etc', async () => { throw new Error('should not call'); }); ok('a bad job id never reaches Free.ai', p.status === 'error');
  // --- light free-plan picks
  let a = A.autoPick('one', []); ok('with no picks, one cheap second agent is added for the member', a.picked.length === 2 && a.picked[0] === 'chat' && a.auto.length === 1 && !['3d', 'audio'].includes(a.picked[1]), JSON.stringify(a));
  a = A.autoPick('two', ['vision']); ok("a member's own pick is kept and nothing is added over it", a.picked.join() === 'chat,vision' && a.auto.length === 0);
  a = A.autoPick('one', ['3d']); ok('a heavy agent the member chose stays (their choice)', a.picked.includes('3d'));
  let c = A.chooseSubagents('make a 3d mesh of a chair', 'one', { allow: ['ocr', 'translation'] }); ok('a heavy subagent never runs unless the member turned it on', c.use.length === 0 && /costs 8 credits/.test(c.skipped[0].why), JSON.stringify(c.skipped));
  c = A.chooseSubagents('make a 3d mesh of a chair', 'one', { allow: ['3d'] }); ok('...and runs once they did', c.use.length === 1 && c.use[0].role === '3d');
  c = A.chooseSubagents('translate this', 'one', { subagents: false }); ok('"no subagents" still wins', c.use.length === 0 && c.disabled);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(dir, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
})();
