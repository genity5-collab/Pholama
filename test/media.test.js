// Videos and pictures the AI shows: only real YouTube ids and real https picture links are ever accepted.
const path = require('path'); const m = require(path.join(__dirname, '..', 'server', 'media.js'));
let bad = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
ok('watch link', m.ytId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
ok('short link', m.ytId('https://youtu.be/dQw4w9WgXcQ?t=10') === 'dQw4w9WgXcQ');
ok('shorts link', m.ytId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
ok('bare id', m.ytId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
ok('lookalike host refused', m.ytId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ') === null);
ok('other site refused', m.ytId('https://vimeo.com/123') === null);
ok('script in id refused', m.ytId('"><script>alert(1)</script>') === null);
ok('picture file accepted', !!m.imageUrl('https://a.com/x/cat.jpg') && !!m.imageUrl('https://a.com/cat.png?w=400'));
ok('wikimedia picture accepted', !!m.imageUrl('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example'));
ok('a YouTube page is not a picture', m.imageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === null);
ok('a Wikipedia article is not a picture', m.imageUrl('https://en.wikipedia.org/wiki/Mount_Everest') === null);
ok('http refused', m.imageUrl('http://a.com/a.jpg') === null);
ok('localhost and home network refused', m.imageUrl('https://localhost/a.jpg') === null && m.imageUrl('https://192.168.1.5/a.jpg') === null && m.imageUrl('https://10.0.0.2/a.png') === null);
ok('javascript: and data: refused', m.imageUrl('javascript:alert(1)') === null && m.imageUrl('data:image/png;base64,AAAA') === null);
ok('user:password@host refused', m.imageUrl('https://u:p@a.com/a.jpg') === null);
ok('a bad id gives a clear error, not a card', (() => { try { m.run('show_video', { url: 'nope' }, {}); return false; } catch (e) { return /not a YouTube link/.test(e.message); } })());
ok('a good video reaches the chat', (() => { let got; m.run('show_video', { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'T' }, { onMedia: x => got = x }); return got && got.kind === 'video' && got.id === 'dQw4w9WgXcQ'; })());
(async () => {
  process.env.PHOLAMA_TEST_WIKI = require('path').join(require('os').tmpdir(), 'ph-wiki-t.json');
  require('fs').writeFileSync(process.env.PHOLAMA_TEST_WIKI, JSON.stringify({ query: { pages: { 2: { title: 'B', index: 2, original: { source: 'https://upload.wikimedia.org/b.jpg' } }, 1: { title: 'A', index: 1, original: { source: 'https://upload.wikimedia.org/a.jpg' } } } } }));
  const w = await m.imageSearch('red panda photo'); ok('Wikipedia fallback picks the best ranked picture', w && w.title === 'A' && /a\.jpg$/.test(w.url));
  require('fs').writeFileSync(process.env.PHOLAMA_TEST_WIKI, JSON.stringify({ query: { pages: { 1: { title: 'C', index: 1, original: { source: 'http://insecure.example/c.jpg' } } } } }));
  ok('Wikipedia fallback ignores an insecure link', (await m.imageSearch('x y')) === null);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
