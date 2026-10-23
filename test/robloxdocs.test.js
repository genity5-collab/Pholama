// Live Roblox documentation lookup, rules for the AI, and the manual encoder wiring. Uses a fake fetcher so the test never touches the network.
const fs = require('fs'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const YAML = `name: WedgePart\ntype: class\nsummary: |\n  A type of \`Class.BasePart\` that has a wedge shape.\ndescription: |\n  Great for slopes. Second sentence here. Third one is cut.\nproperties:\n  - name: Zed\n  - name: Position\n  - name: Size\nmethods: []\nevents:\n  - name: Touched\n`;
(async () => {
  const D = await import('../docs/robloxdocs.js'), L = await import('../docs/studioloop.js');
  ok('a roof request reads WedgePart, BasePart and CFrame', ['classes/WedgePart', 'classes/BasePart', 'datatypes/CFrame'].every(p => D.topicsFor('build a house with a red roof').includes(p)), D.topicsFor('build a house with a red roof'));
  ok('a plain chat message looks nothing up', D.topicsFor('hello how are you today').length === 0);
  ok('it never looks up more than the limit', D.topicsFor('a red wedge roof ball neon door light sound gui tween npc tool', 5).length <= 5);
  const c = D.condense('classes/WedgePart', YAML);
  ok('the page is read: name, kind, clean summary', c && c.name === 'WedgePart' && c.kind === 'class' && c.summary === 'A type of BasePart that has a wedge shape.', JSON.stringify(c));
  ok('the useful properties come first (Position, Size before Zed)', c.properties.join() === 'Position,Size,Zed', c.properties);
  ok('events are listed, and "[]" sections are empty', c.events.join() === 'Touched' && c.methods.length === 0);
  ok('the description is cut to two sentences', !/Third/.test(c.description) && /Second/.test(c.description), c.description);
  ok('junk (not a doc page) gives nothing', D.condense('x', '<html>404</html>') === null && D.condense('x', '') === null);
  let calls = 0; const fetchOk = async u => { calls++; return YAML; };
  D._clearCache(); let r = await D.lookup('make a roof', fetchOk);
  ok('lookup returns a brief that names the source', r.docs.length >= 1 && /Roblox Creator Docs/.test(D.briefFor(r)) && /WedgePart/.test(D.briefFor(r)), D.briefFor(r));
  const first = calls; await D.lookup('make a roof', fetchOk);
  ok('the same page is never fetched twice (cached)', calls === first, [first, calls]);
  D._clearCache(); r = await D.lookup('make a roof', async () => { throw new Error('offline'); });
  ok('offline: no crash, empty brief, failures listed', r.docs.length === 0 && D.briefFor(r) === '' && r.failed.length > 0);
  D._clearCache(); const t0 = Date.now(); r = await D.lookup('make a roof', () => new Promise(() => {}), { timeout: 150 });
  ok('a hanging server cannot freeze the chat (times out)', Date.now() - t0 < 1500 && r.docs.length === 0, Date.now() - t0);
  D._clearCache(); r = await D.lookup('make a roof', async u => { if (/WedgePart/.test(u)) throw new Error('x'); return YAML.replace('WedgePart', 'Other'); });
  ok('one page failing does not lose the others', r.docs.length >= 1 && r.failed.some(f => /WedgePart/.test(f)));
  // rules
  const R = L.rulesFor(false);
  ok('the AI is told to document first (Plan / Notes / Changes)', /DOCUMENT FIRST/.test(R) && /-- Plan:/.test(R) && /-- Changes:/.test(R));
  ok('the AI is told to use only real API names and rely on the docs brief', /ONLY properties, methods and enums that really exist/.test(R) && /Roblox documentation/.test(R));
  ok('the AI knows Position is the centre and how wedges and rotation work', /CENTRE/.test(R) && /WedgePart is a ramp/.test(R) && /CFrame\.Angles/.test(R) && /Orientation/.test(R));
  ok('encoder off: the AI is still told never to write encoded text', /Never write encoded text/.test(R) && !/RetroStudio encoder is ON/.test(R));
  // wiring
  const app = fs.readFileSync(path.join(__dirname, '../docs/app.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '../docs/sw.js'), 'utf8');
  ok('the chat looks up the docs before asking the AI, only for Lua requests', /if \(luaRequest\) \{[\s\S]{0,200}docsLookup/.test(app));
  ok('a failed lookup never blocks the chat', /catch \{ \/\* offline or blocked/.test(app));
  ok('the Encode button exists and is wired', /id="retroEncode"/.test(html) && /\$\('#retroEncode'\)[\s\S]{0,60}encodeNow/.test(app));
  ok('the encoder runs in the page: no server call is needed to encode', /import \{ encodeLua(?:, encodeBest)?(?:, checkEncoded)? \} from '\.\/retroencode\.js'/.test(app) && !/retro\/encode/.test(app));
  ok('the new files are cached for offline use', ['retroencode.js', 'meshes.js', 'robloxdocs.js'].every(f => sw.includes("'" + f + "'")));
  ok('every file in the offline list really exists', [...sw.matchAll(/'([A-Za-z0-9_.-]+\.(?:js|css|json|html))'/g)].every(m => fs.existsSync(path.join(__dirname, '../docs', m[1]))), 'missing file in sw.js');
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
