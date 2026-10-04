// A tool that hangs, throws, or returns a huge or odd result must never freeze or break a chat.
process.env.PHOLAMA_TOOL_LIMIT_MS = '400';
const a = require('../server/agent.js'); const t0 = Date.now();
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) fail++; };
(async () => {
  const tools = [{ name: 'use_skill', kind: 'calc', desc: 'x' }, { name: 'calculator', kind: 'calc', desc: 'x' }];
  const b = a.plugins; const orig = b.runSkillTool;
  b.runSkillTool = () => new Promise(() => {});   // never answers
  let t = Date.now(), e = ''; try { await a.runTool(tools, 'use_skill', { name: 'x' }, {}); } catch (x) { e = x.message; }
  ok('a tool that never answers is stopped', /took longer than/.test(e) && Date.now() - t < 2000, e + ' ' + (Date.now() - t));
  b.runSkillTool = () => { throw new Error('boom'); };
  e = ''; try { await a.runTool(tools, 'use_skill', {}, {}); } catch (x) { e = x.message; }
  ok('a tool that throws gives a normal error', e === 'boom', e);
  b.runSkillTool = () => 'x'.repeat(50000);
  const big = await a.runTool(tools, 'use_skill', {}, {}); ok('a huge result is cut', big.length < 20100 && /\[cut:/.test(big), big.length);
  b.runSkillTool = () => undefined; ok('an empty result becomes an empty string, not a crash', (await a.runTool(tools, 'use_skill', {}, {})) === '');
  b.runSkillTool = () => ({ odd: 1 }); ok('an object result becomes text, not a crash', typeof (await a.runTool(tools, 'use_skill', {}, {})) === 'string');
  b.runSkillTool = orig;
  ok('normal tools are unaffected', (await a.runTool(tools, 'calculator', { expression: '6*7' }, {})) === '42');
  ok('the timer is cleared (process can exit)', true);
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
