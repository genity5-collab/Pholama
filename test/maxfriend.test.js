// Agent Max as a built-in friend on the website: the logic, the data layer, and the real friends screen (jsdom).
const fs = require('fs');
let bad = 0, pass = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 260))); c ? pass++ : bad++; };
let JSDOM = null; try { ({ JSDOM } = require('/tmp/ph/node_modules/jsdom')); } catch (e) {}   // the screen checks need a real DOM; without jsdom they are skipped and the rest still runs
if (JSDOM) { const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost' }); globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.URL = dom.window.URL; }
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

(async () => {
  const M = await import('../docs/maxfriend.js'), F = JSDOM ? await import('../docs/friendsui.js') : null;

  // ---- pure logic
  ok('Agent Max is a fixed built-in entry', M.MAX_FRIEND.builtin === true && M.MAX_FRIEND.name === 'Agent Max' && Object.isFrozen(M.MAX_FRIEND));
  ok('an empty message is a problem', M.maxProblem('   ') !== '' && M.maxProblem(null) !== '' && M.maxProblem(undefined) !== '');
  ok('a 500 character message is fine, 501 is not', M.maxProblem('x'.repeat(500)) === '' && M.maxProblem('x'.repeat(501)) !== '');
  ok('a normal message is fine', M.maxProblem('hello') === '');
  ok('left line: 3 of 5', M.leftLine({ left: 3, cap: 5 }) === '3 of 5 messages left today.');
  ok('left line: none left (free) mentions Pro', /No messages left/.test(M.leftLine({ left: 0, cap: 5 })) && /Pro/.test(M.leftLine({ left: 0, cap: 5 })));
  ok('left line: none left (Pro) does not push Pro again', !/Pro/.test(M.leftLine({ left: 0, cap: 10 })));
  ok('left line: garbage gives nothing', M.leftLine(null) === '' && M.leftLine({}) === '' && M.leftLine({ left: 'x' }) === '');
  for (const [m, re] of [['Log in first.', /Log in/], ['Your login expired', /Log in/], ['That looks like a secret key, so it was blocked.', /secret key/], ['Keep it under 500 characters.', /500/], ['You cannot do that right now.', /cannot do that/]]) ok('friendly: ' + m, re.test(M.maxFriendly(new Error(m))));
  const raw = M.maxFriendly(new Error('HTTP 500 from openrouter nemotron-3.5 stack trace at line 4'));
  ok('an unknown error never shows model names or raw text', !/500|openrouter|nemotron|stack|line/i.test(raw) && /not available/.test(raw), raw);
  ok('bubbles come oldest first and mark which are mine', (() => { const b = M.toBubbles([{ id: 3, role: 'max', body: 'c' }, { id: 1, role: 'user', body: 'a' }, { id: 2, role: 'max', body: 'b' }]); return b.map(x => x.id).join() === '1,2,3' && b[0].mine === true && b[1].mine === false; })());
  ok('bubbles tolerate garbage', M.toBubbles(null).length === 0 && M.toBubbles([{ id: 1, role: 'user' }])[0].text === '');

  // ---- the data layer
  const log = []; let rpcAnswer = { ok: true, cap: 5, used: 1, left: 4 }, fetchMode = 'ok';
  const Account = { user: () => ({ id: 'U1' }), token: () => 'TOK', rest: async (path, opts = {}) => { log.push({ path, opts }); if (path === 'rpc/pholama_max_chat_send') return rpcAnswer; if (path === 'rpc/pholama_max_chat_left') return { cap: 5, used: 1, left: 4 }; if (path.startsWith('pholama_max_chat?select')) return [{ id: 2, role: 'max', body: 'Hi!' }, { id: 1, role: 'user', body: 'Hello' }]; return null; } };
  const calls = []; const fakeFetch = async (url, o) => { calls.push({ url, o }); if (fetchMode === 'throw') throw new Error('offline'); if (fetchMode === 'fail') return { ok: false, json: async () => ({ error: 'x' }) }; return { ok: true, json: async () => ({ reply: 'Hi there' }) }; };
  const MX = M.makeMaxFriend(Account, fakeFetch);
  let r = await MX.send('  hello  ');
  ok('send: the database is asked first, with the trimmed text', log[0].path === 'rpc/pholama_max_chat_send' && JSON.parse(log[0].opts.body).p_body === 'hello', JSON.stringify(log[0]));
  ok('send: then the cloud is asked in friend mode with the login token', calls.length === 1 && /pholamaCloud$/.test(calls[0].url) && calls[0].o.headers.Authorization === 'Bearer TOK' && JSON.parse(calls[0].o.body).friend === true);
  ok('send: the message text is NOT sent to the cloud (it reads the stored one)', !calls[0].o.body.includes('hello'), calls[0].o.body);
  ok('send: a good answer comes back', r.ok && r.answered && r.reply === 'Hi there' && r.info.left === 4);
  calls.length = 0; rpcAnswer = { ok: false, reason: 'day', cap: 5, used: 5, left: 0 }; r = await MX.send('one more');
  ok('send: over the limit, the cloud is never called', r.ok === false && calls.length === 0 && r.info.left === 0);
  rpcAnswer = { ok: true, cap: 5, used: 1, left: 4 }; fetchMode = 'throw'; r = await MX.send('hi');
  ok('send: offline cloud gives answered=false, not a crash', r.ok === true && r.answered === false);
  fetchMode = 'fail'; r = await MX.send('hi'); ok('send: cloud error gives answered=false', r.ok === true && r.answered === false && r.reply === '');
  fetchMode = 'ok'; calls.length = 0; log.length = 0;
  let threw = ''; try { await MX.send('   '); } catch (e) { threw = e.message; }
  ok('send: an empty message never reaches the database or the cloud', threw !== '' && log.length === 0 && calls.length === 0, threw);
  try { await MX.send('x'.repeat(501)); } catch (e) { threw = e.message; }
  ok('send: a too long message never reaches the database', log.length === 0);
  const h = await MX.history(); ok('history: oldest first', h.map(x => x.id).join() === '1,2');
  log.length = 0; await MX.clear();
  ok('clear: deletes only this member\'s rows', log[0].opts.method === 'DELETE' && /user_id=eq\.U1/.test(log[0].path), JSON.stringify(log[0]));

  if (!JSDOM) { console.log('SKIP the friends screen checks (jsdom is not installed)'); console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + pass + ', screen skipped)'); process.exit(bad ? 1 : 0); }
  // ---- the real friends screen
  const rows = [{ other: 'U3', friend_id: 102, status: 'accepted', i_asked: true, name: 'Charlie', avatar_path: null, unread: 0, last_body: null, last_at: null, allow_calls: true }];
  const sent = []; const fetchCalls = []; let sendAnswer = { ok: true, cap: 5, used: 1, left: 4 }, cloudOk = true, stored = [];
  const Acc = { user: () => ({ id: 'U1' }), token: () => 'TOK', rest: async (path, opts = {}) => {
    if (path === 'rpc/pholama_my_social') return rows;
    if (path === 'rpc/pholama_max_chat_left') return { cap: 5, used: sendAnswer.used || 0, left: sendAnswer.left ?? 5 };
    if (path === 'rpc/pholama_max_chat_send') { sent.push(JSON.parse(opts.body).p_body); if (sendAnswer.ok) stored.push({ id: stored.length + 1, role: 'user', body: JSON.parse(opts.body).p_body }); return sendAnswer; }
    if (path.startsWith('pholama_max_chat?select')) return [...stored].reverse();
    if (path === 'rpc/pholama_dm_read') return null;
    if (path.startsWith('pholama_dms')) return [];
    if (path.startsWith('rpc/pholama_dm')) return [];
    return null; } };
  globalThis.fetch = async (url, o) => { fetchCalls.push({ url, o }); if (!cloudOk) return { ok: false, json: async () => ({}) }; stored.push({ id: stored.length + 1, role: 'max', body: 'Hello from Max' }); return { ok: true, json: async () => ({ reply: 'Hello from Max' }) }; };
  const host = document.createElement('div'); document.body.append(host);
  await F.mountFriends(host, { Account: Acc, cfg: {} }); await tick();
  const sections = [...host.querySelectorAll('.pfr-section')];
  ok('Agent Max shows at the top of the list', !!host.querySelector('.pfr-maxbox') && /Agent Max/.test(host.querySelector('.pfr-maxbox').textContent));
  ok('Agent Max comes before the Requests section', host.querySelector('.pfr-sidebar').firstElementChild.classList.contains('pfr-maxbox'));
  ok('the normal sections are still there in order', sections.length === 4 && /Requests/.test(sections[0].textContent) && /Friends/.test(sections[1].textContent));
  const mb = host.querySelector('.pfr-maxbox'), labels = [...mb.querySelectorAll('button')].map(b => b.textContent);
  ok('Agent Max has a Chat button and NOTHING ELSE (no Remove, Block, Call, Report)', labels.length === 1 && labels[0] === 'Chat', labels.join());
  ok('Agent Max does not appear among the real friends', !/Agent Max/.test(sections[1].textContent));
  ok('a real friend still has Remove friend and Block', ['Remove friend', 'Block'].every(t => [...sections[1].querySelectorAll('button')].some(b => b.textContent === t)));

  mb.querySelector('button').click(); await tick(60);
  const panel = host.querySelector('.pfr-chat-panel'), body = () => host.querySelector('.pfr-chat-body'), send = () => [...panel.querySelectorAll('button')].find(b => b.textContent === 'Send'), ta = () => panel.querySelector('textarea');
  ok('the chat opens with Agent Max in the header', /Agent Max/.test(panel.querySelector('.pfr-chat-header').textContent));
  ok('an empty chat invites a hello', /Say hi/.test(body().textContent));
  ok('the hint shows the messages left, not the links rule', /4 of 5 messages left today|5 of 5|messages left/.test(panel.querySelector('.pfr-hint').textContent) && !/Links are not allowed/.test(panel.querySelector('.pfr-hint').textContent), panel.querySelector('.pfr-hint').textContent);
  ok('the picture / video picker is hidden (text only)', (() => { const node = panel.querySelector('.pfr-composer').children[1]; return node && node.style.display === 'none'; })());

  ta().value = 'Hello Max'; send().click(); await tick(120);
  ok('sending goes to the Agent Max counter', sent.length === 1 && sent[0] === 'Hello Max', JSON.stringify(sent));
  ok('the cloud was asked in friend mode', fetchCalls.length === 1 && JSON.parse(fetchCalls[0].o.body).friend === true);
  ok('both the message and the reply are shown', /Hello Max/.test(body().textContent) && /Hello from Max/.test(body().textContent), body().textContent);
  ok('my message is on my side and Max\'s on the other', body().querySelector('.pfr-mine') && body().querySelector('.pfr-theirs'));
  ok('the box is cleared after sending', ta().value === '');
  ok('no "Delete" buttons on Agent Max messages', ![...body().querySelectorAll('button')].some(b => b.textContent === 'Delete'));

  // over the limit
  sendAnswer = { ok: false, reason: 'day', cap: 5, used: 5, left: 0 }; fetchCalls.length = 0; ta().value = 'too many'; send().click(); await tick(120);
  ok('over the limit: the member is told there are none left', /No messages left/.test(panel.querySelector('.pfr-status').textContent), panel.querySelector('.pfr-status').textContent);
  ok('over the limit: Max is not asked', fetchCalls.length === 0);
  ok('over the limit: it does not claim Max failed to answer', !/did not answer/.test(panel.querySelector('.pfr-status').textContent));
  ok('over the limit: the message box keeps what you typed', ta().value === 'too many');
  ok('over the limit: the Send button works again', !send().disabled);
  // Max fails
  sendAnswer = { ok: true, cap: 5, used: 2, left: 3 }; cloudOk = false; ta().value = 'will fail'; send().click(); await tick(120);
  ok('a failed answer says you were not charged, with no model details', /did not answer/.test(panel.querySelector('.pfr-status').textContent) && /not charged/.test(panel.querySelector('.pfr-status').textContent) && !/500|openrouter|groq|nemotron/i.test(panel.querySelector('.pfr-status').textContent), panel.querySelector('.pfr-status').textContent);
  // a scary database error is shown calmly
  const realRest = Acc.rest; Acc.rest = async (path, opts) => { if (path === 'rpc/pholama_max_chat_send') throw new Error('HTTP 500 postgres connection refused at pholama_max_chat_send line 9'); return realRest(path, opts); };
  cloudOk = true; ta().value = 'scary'; send().click(); await tick(120);
  ok('a database error is shown calmly, no technical text', /not available/.test(panel.querySelector('.pfr-status').textContent) && !/500|postgres|line 9|pholama_/.test(panel.querySelector('.pfr-status').textContent), panel.querySelector('.pfr-status').textContent);
  Acc.rest = realRest;
  // empty / long never sent
  sent.length = 0; ta().value = '   '; send().click(); await tick(40);
  ok('an empty message is never sent', sent.length === 0 && /Type a message/.test(panel.querySelector('.pfr-status').textContent));
  ta().value = 'x'.repeat(600); send().click(); await tick(40); ok('a too-long message is never sent', sent.length === 0);
  // a real friend's chat is unaffected
  const back = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Back')); back.click(); await tick(40);
  const chatBtn = [...host.querySelectorAll('.pfr-section')[1].querySelectorAll('button')].find(b => b.textContent === 'Chat'); chatBtn.click(); await tick(80);
  ok('a real friend\'s chat still shows the links rule and the picker', /Links are not allowed/.test(host.querySelector('.pfr-hint').textContent) && host.querySelector('.pfr-composer').children[1].style.display !== 'none');
  ok('a real friend\'s chat is titled with their name', /Charlie/.test(host.querySelector('.pfr-chat-header').textContent));

  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + pass + ')'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
