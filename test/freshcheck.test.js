// The update check must see a new commit within a minute (GitHub caches raw files for 5) without using up the 60/hour API allowance.
const fc = require('../server/freshcheck.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x).slice(0, 300))); if (!c) bad++; };
const SHA1 = 'a'.repeat(40), SHA2 = 'b'.repeat(40);
function world() {
  const w = { sha: SHA1, version: '0.9.25', calls: [], remaining: 60, status: 200, now: 1000000 };
  w.http = async (url, headers) => {
    w.calls.push(url.includes('api.github') ? 'API' + (headers['If-None-Match'] ? '+etag' : '') : 'RAW:' + url.split('/')[5]);
    if (url.includes('api.github.com')) {
      if (w.status !== 200) return { status: w.status, headers: { 'x-ratelimit-remaining': String(w.remaining), 'x-ratelimit-reset': String(Math.floor((w.now + 3600000) / 1000)) }, body: '{}' };
      w.remaining--;
      const h = { etag: 'W/"' + w.sha.slice(0, 6) + '"', 'x-ratelimit-remaining': String(w.remaining), 'x-ratelimit-reset': String(Math.floor((w.now + 3600000) / 1000)) };
      if (headers['If-None-Match'] === h.etag) return { status: 304, headers: h, body: '' };
      return { status: 200, headers: h, body: JSON.stringify({ sha: w.sha }) };
    }
    return { status: 200, headers: {}, body: JSON.stringify({ version: w.version }) };
  };
  w.ask = () => fc.latest({ repo: 'o/r', branch: 'main', http: w.http, now: () => w.now });
  return w;
}
(async () => {
  fc.reset(); let w = world(); let r = await w.ask();
  ok('first check reads the newest commit and its version', r.ok && r.version === '0.9.25' && r.sha === SHA1 && r.changed === true, r);
  ok('the version is read AT the commit (a commit-pinned address, never the cached branch file)', w.calls.includes('RAW:' + SHA1) && !w.calls.includes('RAW:main'), w.calls);
  w.calls.length = 0; r = await w.ask();
  ok('nothing new: answered by the API alone, no file downloaded', r.ok && r.changed === false && w.calls.join() === 'API+etag', w.calls);
  w.sha = SHA2; w.version = '0.9.26'; w.calls.length = 0; r = await w.ask();
  ok('a NEW commit is seen on the very next check', r.ok && r.version === '0.9.26' && r.changed === true && r.sha === SHA2, r);
  w.calls.length = 0; r = await w.ask();
  ok('and then it goes quiet again', r.changed === false && w.calls.join() === 'API+etag', w.calls);

  // allowance: 60 an hour. One check a minute = 60 an hour, so the guard must slow down before it runs out.
  fc.reset(); w = world(); w.remaining = 11; await w.ask(); w.calls.length = 0;
  w.remaining = 9; w.http2 = w.http; const first = await w.ask(); w.calls.length = 0;
  r = await w.ask();
  ok('allowance nearly used up: stops asking the API (so it can never be blocked)', r.ok === false && /rate limit/.test(r.reason) && w.calls.length === 0, { r, calls: w.calls });
  w.now += 3600001; w.remaining = 60; w.calls.length = 0; r = await w.ask();
  ok('after GitHub resets the allowance it resumes', r.ok === true && w.calls.length > 0, r);

  fc.reset(); w = world(); w.status = 403; r = await w.ask();
  ok('a 403 (blocked) falls back instead of failing', r.ok === false && /rate limited/.test(r.reason), r);
  w.calls.length = 0; w.status = 200; r = await w.ask();
  ok('…and then leaves GitHub alone for a while', r.ok === false && w.calls.length === 0, { r, calls: w.calls });
  w.now += 11 * 60 * 1000 + 3600000; r = await w.ask();
  ok('…and tries again later', r.ok === true, r);

  fc.reset(); w = world(); w.http = async () => { throw new Error('ENOTFOUND api.github.com'); }; r = await w.ask();
  ok('no internet: a clean "not ok" so the old route is used', r.ok === false, r);
  fc.reset(); w = world(); const base = w.http; w.http = async (u, h) => u.includes('api.github') ? { status: 200, headers: {}, body: 'not json' } : base(u, h); r = await w.ask();
  ok('garbage from GitHub never crashes', r.ok === false, r);
  fc.reset(); w = world(); w.http = async (u, h) => u.includes('api.github') ? { status: 200, headers: {}, body: JSON.stringify({ sha: '../../etc/passwd' }) } : base(u, h); r = await w.ask();
  ok('a commit id that is not 40 hex characters is refused (it goes into a web address)', r.ok === false && /no commit id/.test(r.reason), r);
  fc.reset(); w = world(); const b2 = w.http; w.http = async (u, h) => u.includes('raw.') ? { status: 404, headers: {}, body: 'nope' } : b2(u, h); r = await w.ask();
  ok('package.json missing at that commit: falls back, does not report a wrong version', r.ok === false, r);

  // wired into the real updater
  const src = require('fs').readFileSync(__dirname + '/../server/update.js', 'utf8');
  ok('the updater asks the fresh check first, then the old cached route', /require\('\.\/freshcheck'\)\.latest/.test(src) && src.indexOf('freshcheck') < src.indexOf('textUrls()));'), 'order');
  ok('tests and private mirrors can still turn it off', /PHOLAMA_UPDATE_BASE/.test(src.slice(src.indexOf('async function check()'), src.indexOf('async function check()') + 400)) && /PHOLAMA_NO_FRESH/.test(src));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
