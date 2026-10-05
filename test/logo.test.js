// The Pholama logo: icons are the right size and really contain the llama, the animation plan is ordered, and it is wired in everywhere.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.join(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
// tiny PNG reader (8-bit RGBA/RGB, no interlace): enough to look at real pixels without extra packages
function png(f) {
  const b = fs.readFileSync(path.join(root, f)); let p = 8, w = 0, h = 0, ct = 0, idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len); if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (t === 'IDAT') idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) return { w, h, px: null };
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) { const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? cur[i - bpp] : 0, u = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += u; else if (ft === 3) v += (a + u) >> 1; else if (ft === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c); } cur[i] = v & 255; }
    prev = Buffer.from(cur); }
  return { w, h, bpp, px: out };
}
const px = (im, x, y) => { const i = (y * im.w + x) * im.bpp; return { r: im.px[i], g: im.px[i + 1], b: im.px[i + 2], a: im.bpp === 4 ? im.px[i + 3] : 255 }; };
(async () => {
  const m = await import(path.join(root, 'web', 'logointro.js'));
  // ---- icons
  for (const [f, s, max] of [['icon-192.png', 192, 30000], ['icon-512.png', 512, 60000], ['icon-maskable-512.png', 512, 60000]]) for (const dir of ['web', 'docs']) {
    const im = png(dir + '/' + f), size = fs.statSync(path.join(root, dir, f)).size;
    ok(`${dir}/${f} is really ${s}x${s}`, im.w === s && im.h === s, im.w + 'x' + im.h);
    ok(`${dir}/${f} stays small (${size} bytes, limit ${max})`, size < max, size);
  }
  const big = png('web/icon-512.png');
  let white = 0, dark = 0; for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) { const c = px(big, x, y); if (c.a > 200) { if (c.r > 200) white++; else if (c.r < 40) dark++; } }
  ok('the 512 icon really shows a white llama on black (not blank, not the old one)', white > 400 && dark > 2000, white + ' white, ' + dark + ' dark samples');
  ok('the icon has rounded transparent corners', px(big, 0, 0).a === 0 && px(big, 256, 256).a === 255);
  const mk = png('web/icon-maskable-512.png'); let out = 0;   // phones crop maskable icons: nothing bright may sit outside the central circle (radius 205)
  for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2) if (px(mk, x, y).r > 128 && Math.hypot(x - 256, y - 256) > 205) out++;
  ok('maskable llama stays inside the phone-safe circle', out === 0, out + ' bright pixels outside');
  ok('maskable icon has no transparent corners', px(mk, 0, 0).a === 255);
  ok('web and docs icon.svg are identical', rd('web/icon.svg') === rd('docs/icon.svg'));
  ok('icon.svg is a real drawing (path data), not a 1 KB stub', rd('web/icon.svg').length > 3000 && /<path[^>]+d="M/.test(rd('web/icon.svg')));
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) ok(`web and docs ${f} are the same picture`, fs.readFileSync(path.join(root, 'web', f)).equals(fs.readFileSync(path.join(root, 'docs', f))));
  // .ico: header says 7 images, with the sizes the notes promise
  const ico = fs.readFileSync(path.join(root, 'install/pholama.ico')), n = ico.readUInt16LE(4), sizes = []; for (let i = 0; i < n; i++) sizes.push(ico[6 + i * 16] || 256);
  ok('pholama.ico holds 16,24,32,48,64,128,256', ico.readUInt16LE(2) === 1 && sizes.sort((a, b) => a - b).join() === '16,24,32,48,64,128,256', sizes.join());
  for (const f of ['manifest.webmanifest']) for (const dir of ['web', 'docs']) { const mf = JSON.parse(rd(dir + '/' + f)); ok(`${dir} manifest lists the 3 PNG icons`, ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].every(i => mf.icons.some(x => x.src === i)));
    ok(`${dir} manifest colours match the black logo`, mf.theme_color === '#000000' && mf.background_color === '#000000'); }
  // ---- animation plan
  const p = m.plan(), order = p.stages.map(s => s.name).join();
  ok('stages run in the video order', order === 'dots,rise,face,glasses,name', order);
  ok('every stage starts after the one before', p.stages.every((s, i) => i === 0 || s.at > p.stages[i - 1].at));
  ok('the whole intro ends after the last stage and is under 5 seconds', p.total > p.stages[4].at && p.total <= 5000, p.total);
  const f = m.plan({ fast: true }); ok('the fast version is shorter but keeps the same order', f.total < p.total && f.stages.map(s => s.name).join() === order);
  const r = m.plan({ reduced: true }); ok('reduced motion: no stages, no delay', r.reduced && r.total === 0 && r.stages.length === 0);
  ok('stageAt follows the clock', m.stageAt(p, 0) === 'dots' && m.stageAt(p, 1000) === 'rise' && m.stageAt(p, 2800) === 'glasses' && m.stageAt(p, 3500) === 'name' && m.stageAt(p, 9000) === 'done');
  // ---- markup
  const h = m.sceneHTML('t1'), h2 = m.sceneHTML('t2', { name: false });
  ok('the llama path is written once and reused', (h.match(/fill-rule="evenodd" d=/g) || []).length === 1 && (h.match(/<use /g) || []).length === 2);
  ok('ids are unique per scene', !h2.includes('t1-') && h2.includes('t2-p'));
  ok('the name can be left out', h.includes('PHOLAMA') && !h2.includes('PHOLAMA'));
  ok('scene has an accessible label', /role="img"[^>]+aria-label="Pholama llama logo"/.test(h));
  ok('no scripts, no inline event handlers in the scene', !/<script|\son\w+=/i.test(h));
  ok('path data is only drawing commands (no text can sneak in)', /^[MLCZ0-9 .\-]+$/.test(m.LLAMA_D));
  ok('the animation file is light (under 25 KB)', fs.statSync(path.join(root, 'web/logointro.js')).size < 25000);
  ok('reduced-motion CSS exists and shows the finished logo', /prefers-reduced-motion:reduce\)\{\.pi \.pi-dot/.test(m.INTRO_CSS) && /\.pi \.pi-wipe\{y:0px\}/.test(m.INTRO_CSS));
  ok('the CSS has no fixed colours', !/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(m.INTRO_CSS));
  // ---- wiring
  for (const dir of ['web', 'docs']) {
    const a = rd(dir + '/app.js');
    ok(`${dir}/app.js imports and starts the splash before init()`, /import \{ playSplash \} from '\.\/logointro\.js'/.test(a) && a.indexOf('playSplash({ fast })') > 0 && a.indexOf('playSplash({ fast })') < a.indexOf('async function init()'));
    ok(`${dir}: ?nosplash turns it off`, /nosplash/.test(a));
    ok(`${dir}: service worker caches logointro.js`, /'logointro\.js'/.test(rd(dir + '/sw.js')));
    ok(`${dir}: the file exists`, fs.existsSync(path.join(root, dir, 'logointro.js')));
    ok(`${dir}/index.html theme colour is black`, /name="theme-color" content="#000000"/.test(rd(dir + '/index.html')));
  }
  ok('web and docs logointro.js are identical', rd('web/logointro.js') === rd('docs/logointro.js'));
  ok('cache names were raised', /pholama-v4[1-9]|pholama-v[5-9]\d/.test(rd('web/sw.js')) && /pholama-v(39|[4-9]\d)/.test(rd('docs/sw.js')));
  const u = rd('web/updatefx.js');
  ok('the update scene plays the logo', /import \{ mountLogo \} from '\.\/logointro\.js'/.test(u) && /mountLogo\(o\.querySelector\('\.upds-logo'\)\)/.test(u) && u.includes('class="upds-logo"'));
  ok('the update scene keeps its progress ring and percentage', u.includes('class="fg"') && u.includes('class="upds-pct"'));
  ok('the logo loop stops on done, fail and close', (u.match(/if \(logo\) logo\.stop\(\)/g) || []).length === 3);
  console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
})();
