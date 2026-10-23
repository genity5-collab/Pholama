// The AI only writes Lua. The RetroStudio encoder rules, the preview loop and the encoder service are used ONLY when the encoder switch is on.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const L = await import('../docs/studioloop.js'); const fs = require('fs'); const app = fs.readFileSync(require('path').join(__dirname, '..', 'docs', 'app.js'), 'utf8');
  const off = L.rulesFor(false), on = L.rulesFor(true);
  ok('encoder OFF: the AI is told it writes Lua and nothing else', /Roblox Lua \(Luau\) scripts and nothing else/.test(off));
  ok('encoder OFF: the AI is told never to write encoded text, base93 or block data', /Never write encoded text, base64 or base93 strings, block data or "CoolFormat"/.test(off));
  ok('encoder OFF: no mention of the RetroStudio encoder or block directives', !/RetroStudio encoder|--@block|blocks automatically/.test(off), off);
  ok('encoder ON: the same Lua rules are there', on.startsWith(off));
  ok('encoder ON: the encoder rules are added on top', /RetroStudio encoder is ON/.test(on) && /--@block/.test(on) && on.length > off.length);
  ok('encoder ON: the AI is still told not to write encoded text itself', /Never write encoded text/.test(on) && /do not mention encoding/.test(on));
  ok('the Lua rules let the AI build real models (loops, functions, Model, details)', /Loops, local functions/.test(off) && /Instance\.new\("Model", workspace\)/.test(off) && /head, torso, two arms, two legs/.test(off) && /Never build a thing from a single part/.test(off));
  ok('the old toy-subset ban is gone', !/Do NOT use: elseif, while/.test(on) && !/one statement per line/.test(on));
  ok('the older STUDIO_RULES export still works and equals the encoder-on set', L.STUDIO_RULES === on);
  // the page: the loop and the encoder service hang off the switch only
  const handler = app.slice(app.indexOf('const retroForMessage'), app.indexOf('if (sessionAtStart === sessionId) { stopper = null'));
  ok('the encoder is on only when it was on, a Lua request is detected, or @retrostudio is typed', /const retroForMessage = retroEnabled \|\| LUA_ASK\.test\(text\) \|\| \/@\(\?:roblox/.test(handler));
  ok('the rules sent follow the switch (rulesFor(retroForMessage))', /rulesFor\(retroForMessage\)/.test(handler));
  ok('the preview + encode loop runs only when the switch is on', /if \(retroForMessage && setScriptsFromAnswer\(acc\)\) \{[^}]*runStudioLoop\(/.test(handler));
  ok('the encoder runs in the page, only from the Studio loop and the manual Encode button (no server call)', !/retro\/encode/.test(app) && (app.match(/await encodeLua\(/g) || []).length === 2 && app.indexOf('await encodeLua(') > app.indexOf('async function runStudioLoop') && app.indexOf('await encodeLua(') < app.indexOf('const result = await studioLoop('));
  ok('nothing outside the Studio loop calls the encoder (no auto-encode while typing)', app.slice(0, app.indexOf('async function runStudioLoop')).indexOf('retro/encode') < 0 && app.slice(app.indexOf('const result = await studioLoop(')).indexOf('retro/encode') < 0);
  // when is a message a Lua request
  const re = eval(app.match(/const LUA_ASK = (\/.*\/i);/)[1]);
  for (const t of ['create a cool noob model with shades', 'make me a roblox script', 'write a lua script', 'build a house', 'I need a sword model', 'make an obby']) ok(`"${t}" gets the Lua rules`, re.test(t));
  for (const t of ['what is the capital of france', 'make me a sandwich recipe', 'create a plan for my week', 'help me write an email', 'write a poem about the sea', 'what is 2+2']) ok(`"${t}" is left as normal chat`, !re.test(t));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
