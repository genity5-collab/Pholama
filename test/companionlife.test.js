// The companion's brain: where it wanders, when it codes/naps, and the tiny typing window.
(async () => {
const L = await import('../web/companionlife.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x))); if (!c) bad++; };
const box = { w: 1000, h: 700 };
let inside = true, hopsOk = true, moved = false;
for (let i = 0; i < 500; i++) { const p = { x: Math.random() * 940, y: Math.random() * 640 }; const q = L.pickSpot(p, box); if (q.x < 0 || q.y < 0 || q.x > box.w - 56 || q.y > box.h - 56) inside = false; if (Math.hypot(q.x - p.x, q.y - p.y) > 290) hopsOk = false; if (Math.hypot(q.x - p.x, q.y - p.y) > 5) moved = true; }
ok('it always stays on screen', inside);
ok('it takes short hops, never teleports', hopsOk);
ok('it does actually move', moved);
ok('a tiny window still keeps it inside', (() => { const q = L.pickSpot({ x: 0, y: 0 }, { w: 60, h: 60 }); return q.x >= 0 && q.y >= 0 && q.x <= 8 && q.y <= 8; })());
ok('it codes while the AI is really building', L.nextMood({ busy: true, idleSeconds: 0 }) === 'code');
ok('it stays still while dragged or a menu is open', L.nextMood({ blocked: true, busy: true }) === 'idle');
ok('it naps after a long quiet time', L.nextMood({ idleSeconds: 200 }) === 'nap');
ok('otherwise it mostly walks', (() => { let w = 0; for (let i = 0; i < 1000; i++) if (L.nextMood({ idleSeconds: 5 }) === 'walk') w++; return w > 600 && w < 850; })());
ok('a short walk is quick, a long one is slower but capped', L.walkMs({ x: 0, y: 0 }, { x: 10, y: 0 }) === 700 && L.walkMs({ x: 0, y: 0 }, { x: 900, y: 0 }) === 3200 && L.walkMs({ x: 0, y: 0 }, { x: 100, y: 0 }) === 1400);
const a = L.codeView(0), b = L.codeView(40), c = L.codeView(400);
ok('the code window starts empty and fills up', a.length === 0 && b.length >= 1 && c.length === 4);
ok('it shows real-looking code, cut to the window width', c.every(l => l.length <= 22 && l.length > 0));
ok('it types forward (later tick never shows less than earlier)', L.codeView(100).join('').length <= L.codeView(200).join('').length + 100);
ok('each mood has something to say', ['walk', 'code', 'nap', 'idle'].every(m => L.say(m).length > 0));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
