// The Studio loop: AI writes -> preview runs -> result is checked -> AI fixes -> encode only when right.
// Uses the REAL preview and the REAL encoder; only the AI is a fake that replies with scripted answers.
import { simulateLuau } from '../docs/retrostudio.js';
import { judge, pickScript, fixRequest, studioLoop, STUDIO_RULES, MAX_FIX_ROUNDS } from '../docs/studioloop.js';
import { createRequire } from 'module';
const enc = createRequire(import.meta.url)('../server/retroencoder.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 220))); if (!c) bad++; };

const GOOD = 'local part = Instance.new("Part", workspace)\npart.Size = Vector3.new(6, 1, 6)\npart.Position = Vector3.new(0, 3, 0)\npart.Anchored = true\nprint("ready")\n';
const run = src => { const sim = simulateLuau(src), c = enc.compile(src); return { sim, skipped: c.skipped }; };
const encode = async src => { const c = enc.compile(src); return c.blocks ? { ok: true, encoded: c.encoded, blocks: c.blocks } : { ok: false, error: 'none' }; };

// judge
ok('a good script passes the check', judge(...Object.values(run(GOOD))).ok);
ok('an empty script is rejected', !judge(...Object.values(run('print("x")'))).ok);
ok('unparented parts are called out', judge(...Object.values(run('local p = Instance.new("Part")\np.Size = Vector3.new(1,1,1)'))).problems.some(p => /parented/.test(p)));
ok('lines the encoder cannot convert are reported', judge(...Object.values(run(GOOD + 'while true do\nwait(1)\nend\n'))).problems.some(p => /cannot be converted/.test(p)));
ok('far away parts are reported', judge(...Object.values(run('local p = Instance.new("Part", workspace)\np.Position = Vector3.new(500, 0, 0)'))).problems.some(p => /far outside/.test(p)));
ok('overlapping parts are reported', judge(...Object.values(run('local a = Instance.new("Part", workspace)\nlocal b = Instance.new("Part", workspace)\na.Position = Vector3.new(0,1,0)\nb.Position = Vector3.new(0,1,0)'))).problems.some(p => /same place/.test(p)));

// pickScript / fixRequest / rules
ok('pickScript takes the lua block', pickScript('Here:\n```lua\nprint("a")\n```\nbye').trim() === 'print("a")');
ok('pickScript returns empty when there is no code', pickScript('sorry, no code') === '');
ok('fix request lists the problems and the script', (() => { const r = fixRequest('print(1)', { problems: ['P1', 'P2'] }, 2); return /P1/.test(r) && /P2/.test(r) && /print\(1\)/.test(r) && /2 of 3/.test(r); })());
ok('the rules tell the AI which lines are allowed', /Instance\.new/.test(STUDIO_RULES) && /--@block/.test(STUDIO_RULES) && /elseif/.test(STUDIO_RULES));

// the loop
{ const events = []; let asked = 0;
  const r = await studioLoop({ source: GOOD, ask: async () => { asked++; return ''; }, run, encode, show: e => events.push(e.type) });
  ok('good script: encoded with no fix needed', r.ok && r.rounds === 0 && asked === 0 && !!r.encoded, JSON.stringify(r).slice(0, 120));
  ok('good script: UI is told edit, run, check, done in order', events.join() === 'edit,run,check,done', events.join()); }
{ const events = []; let asked = 0, prompt = '';
  const r = await studioLoop({ source: 'print("only a print")\n', ask: async p => { asked++; prompt = p; return 'Fixed:\n```lua\n' + GOOD + '```'; }, run, encode, show: e => events.push(e.type) });
  ok('bad script: AI is asked once, fixes it, then it is encoded', r.ok && r.rounds === 1 && asked === 1 && !!r.encoded, JSON.stringify(r).slice(0, 160));
  ok('bad script: the AI was shown the problem', /does not create any parts/.test(prompt));
  ok('bad script: UI sees the fix step', events.includes('fix') && events[events.length - 1] === 'done', events.join()); }
{ let asked = 0; let encoded = 0;
  const r = await studioLoop({ source: 'print("x")\n', ask: async () => { asked++; return '```lua\nprint("still nothing " .. ' + asked + ')\n```'; }, run, encode: async s => { encoded++; return encode(s); } });
  ok('a script that never gets fixed is NOT encoded', !r.ok && encoded === 0 && !r.encoded);
  ok('it stops after the maximum number of fixes', asked === MAX_FIX_ROUNDS, 'asked ' + asked); }
{ const r = await studioLoop({ source: 'print("x")\n', ask: async () => 'I cannot help.', run, encode });
  ok('no code in the reply: stops instead of looping', !r.ok && r.rounds === 1); }
{ const r = await studioLoop({ source: 'print("x")\n', ask: async () => { throw new Error('model down'); }, run, encode });
  ok('an AI failure ends the loop cleanly with no encode', !r.ok && !r.encoded); }
{ const r = await studioLoop({ source: GOOD, ask: async () => '', run, encode: async () => ({ ok: false, error: 'service down' }) });
  ok('encode failure is reported, not hidden', !r.ok && r.error === 'service down'); }

console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
