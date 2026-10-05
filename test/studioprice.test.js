// Studio prices: chat 1, medium task 3, big task 4. Agent Max costs the same (no extra). Decided on the server from the real message.
const p = require('../server/pricing');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x))); if (!c) bad++; };
const cost = (t, extra) => p.extraCost({ studio: true, size: p.taskSize(t), ...extra }).total;
ok('small talk is chat (1)', cost('hi') === 1 && cost('thanks!') === 1);
ok('a question is chat (1)', cost('what does this file do?') === 1 && cost('why is the header blue?') === 1);
ok('a normal build is medium (3)', cost('make a page') === 3 && cost('fix the button colour') === 3 && cost('build a snake game') === 3);
ok('a whole app with several parts is big (4)', cost('make a whole zoo tracking website with login, a dashboard and a shop') === 4);
ok('a numbered list of 4 jobs is big (4)', cost('1. add a nav\n2. add a footer\n3. add dark mode\n4. add a 404 page') === 4);
ok('touching 3 files is big (4)', cost('update index.html, app.js and style.css so the header is blue') === 4);
ok('a very long request is big (4)', cost('please add a feature ' + 'that does something useful '.repeat(30)) === 4);
ok('Agent Max in Studio costs the same, no extra', cost('make a page', { maxStudio: true }) === 3 && cost('hi', { maxStudio: true }) === 1 && p.MAX_STUDIO === 0);
ok('outside Studio nothing is charged', p.extraCost({ studio: false, size: 'big' }).total === 0);
ok('the page cannot pick a lower price: an unknown size is medium', p.extraCost({ studio: true, size: 'free' }).total === 3);
ok('pictures still add on top (big task + 1 picture = 9)', cost('make a whole shop website with login, a dashboard and a cart', { images: 1 }) === 9);
ok('describe names the tier', /big task 4/.test(p.describe(p.extraCost({ studio: true, size: 'big' }))) && /chat 1/.test(p.describe(p.extraCost({ studio: true, size: 'chat' }))));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
