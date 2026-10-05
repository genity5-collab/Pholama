// Settings > Plans: the table matches the database limits, the code box counts down and expires, and one live code at a time.
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const P = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'plans.js')).href);
  ok('the website and the PC app have the SAME plans.js', fs.readFileSync(path.join(__dirname, '..', 'docs/plans.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'web/plans.js'), 'utf8'));
  // the table must say what the DATABASE gives (pro.sql is the one source of truth)
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/pro.sql'), 'utf8');
  const pick = (which, k) => { const blk = sql.split(which)[1]; const m = blk.match(new RegExp("'" + k + "', (\\d+)")); return m && Number(m[1]); };
  const proBlk = "when p_pro then", freeBlk = "else";
  for (const k of ['max_day', 'max_month', 'projects', 'friends', 'max_dms', 'memories_web', 'memories_pc', 'integration_tokens']) {
    ok('Pro ' + k + ' on the page matches the database', pick(proBlk, k) === P.PRO[k], pick(proBlk, k) + ' vs ' + P.PRO[k]);
    const freeTxt = sql.split('else')[1]; const m = freeTxt.match(new RegExp("'" + k + "', (\\d+)"));
    ok('Free ' + k + ' on the page matches the database', m && Number(m[1]) === P.FREE[k], (m && m[1]) + ' vs ' + P.FREE[k]);
  }
  ok('every row has a label and two values, and Pro is never less than Free', P.rows().every(r => r.length === 3 && r[0] && String(r[1]) && String(r[2])) && Object.keys(P.FREE).every(k => P.PRO[k] >= P.FREE[k]));
  ok('a code lasts 30 minutes', P.CODE_MINUTES === 30 && /interval '30 minutes'/.test(sql));

  // days left
  const now = Date.now();
  ok('days left rounds up', P.daysLeft(new Date(now + 29.2 * 864e5).toISOString(), now) === 30 && P.daysLeft(new Date(now + 864e5 * 0.1).toISOString(), now) === 1);
  ok('an ended plan has 0 days left, even one that ended long ago', P.daysLeft(new Date(now - 1000).toISOString(), now) === 0 && P.daysLeft(new Date(now - 5 * 864e5).toISOString(), now) === 0 && P.daysLeft('garbage', now) === 0 && P.daysLeft(null, now) === 0);
  // the clock
  ok('clock shows minutes and seconds', P.codeClock(now + 125000, now).text === 'Use it in the game within 2:05', P.codeClock(now + 125000, now).text);
  ok('clock expires at zero', P.codeClock(now, now).expired === true && P.codeClock(now - 5, now).expired === true && P.codeClock(now + 1500, now).expired === false);

  // the page text
  const free = P.html({ pro: false }, 'https://roblox.com/games/1'), pro = P.html({ pro: true, until: new Date(now + 10 * 864e5).toISOString() });
  ok('free page says Free and offers a code', /Free plan/.test(free) && /Get my code/.test(free) && !/You are on Pholama Pro/.test(free));
  ok('pro page says Pro, the days left, and offers renewal', /You are on Pholama Pro/.test(pro) && /10 days left/.test(pro) && /Get a code to renew/.test(pro));
  ok('one day left is singular', /1 day left/.test(P.html({ pro: true, until: new Date(now + 3600000).toISOString() })));
  ok('the steps say the code works for 30 minutes and only once', /30 minutes/.test(free) && /only once/.test(free));
  ok('the game link appears only when one is set', /roblox\.com\/games\/1/.test(free) && !/Open the game/.test(pro));
  ok('a hostile game link cannot break out of the page', !/<script/.test(P.html({ pro: false }, '"><script>alert(1)</script>')));
  ok('a missing plan is treated as Free', /Free plan/.test(P.html(null)));

  // the live tab, with a fake page and a fake account
  const mk = () => { const els = {}; const host = { innerHTML: '', querySelector: s => { const id = s.slice(1); if (!els[id]) els[id] = { style: {}, textContent: '', disabled: false, onclick: null }; if (!host.innerHTML.includes('id="' + id + '"')) return null; return els[id]; } }; return host; };
  let plan = { pro: false }, codeOut = 'ABCD1234', fail = null, calls = [], user = true;
  const Account = { user: () => user, rest: async (p) => { calls.push(p); if (fail) throw new Error(fail); if (p.includes('my_plan')) return plan; if (p.includes('code_new')) return codeOut; } };
  let t = now, ticks = []; const si = f => { ticks.push(f); return ticks.length; }, ci = () => { ticks = []; };
  let host = mk(); let tab = await P.mount(host, { Account, now: () => t, setInterval: si, clearInterval: ci });
  ok('logged out shows a log in message and asks nothing', (user = false, await tab.paint()) === 'login' && /Log in/.test(host.innerHTML) && calls.length === 0); user = true;
  ok('a free member sees the free page', (await tab.paint()) === 'free');
  plan = { pro: true, until: new Date(now + 5 * 864e5).toISOString() };
  ok('a Pro member sees the pro page', (await tab.paint()) === 'pro');
  plan = { pro: false }; await tab.paint();
  const get = host.querySelector('#pl_get'); await get.onclick();
  ok('tapping Get my code shows the code', host.querySelector('#pl_codebox').textContent === 'ABCD1234' && host.querySelector('#pl_code').style.display === '');
  ok('the countdown starts at 30:00', /30:00/.test(host.querySelector('#pl_clock').textContent), host.querySelector('#pl_clock').textContent);
  ok('the button is locked while a code is live (a new one would cancel it)', get.disabled === true);
  t += 61000; ticks.forEach(f => f());
  ok('the countdown moves', /28:59/.test(host.querySelector('#pl_clock').textContent), host.querySelector('#pl_clock').textContent);
  t = now + 31 * 60000; ticks.forEach(f => f());
  ok('after 30 minutes the code is hidden and marked expired', /expired/.test(host.querySelector('#pl_clock').textContent) && host.querySelector('#pl_codebox').textContent !== 'ABCD1234');
  ok('and a new code can be made', get.disabled === false && /new code/.test(get.textContent || 'new code'));
  ok('the countdown timer stops when it expires', ticks.length === 0);
  codeOut = 'not a code'; await get.onclick();
  ok('a strange answer from the server is not shown as a code', host.querySelector('#pl_codebox').textContent !== 'not a code' && /Could not make a code/.test(host.querySelector('#pl_msg').textContent), host.querySelector('#pl_msg').textContent);
  codeOut = 'ABCD1234'; fail = 'Too many codes. Try again in a while.'; await get.onclick();
  ok('the rate limit message is shown', /Too many codes/.test(host.querySelector('#pl_msg').textContent));
  ok('and the button comes back so they can retry later', get.disabled === false);
  fail = 'down'; ok('if the plan cannot be read, the page still shows (as Free)', (await tab.paint()) === 'free');
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
