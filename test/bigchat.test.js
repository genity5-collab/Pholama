let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
(async () => {
  const b = await import('../docs/bigchat.js'), p = await import('../docs/platform.js');
  ok('near the bottom means follow new messages', b.nearBottom(900, 100, 1000) === true && b.nearBottom(880, 100, 1000) === true);
  ok('scrolled up to read old messages means do NOT jump down', b.nearBottom(100, 100, 1000) === false);
  ok('same messages are detected (no needless repaint)', b.sameMessages([{ id: 1, text: 'a' }], [{ id: 1, text: 'a' }]) && !b.sameMessages([{ id: 1, text: 'a' }], [{ id: 1, text: 'b' }]) && !b.sameMessages([], [{ id: 1, text: 'a' }]));
  ok('a draft is trimmed and limited', b.cleanDraft('  hi  ', 10) === 'hi' && b.cleanDraft('x'.repeat(50), 10).length === 10 && b.cleanDraft(null) === '' && b.cleanDraft('a\r\nb') === 'a\nb');
  ok('a bad date gives an empty string, not "Invalid Date"', b.whenText('nope') === '' && b.whenText('2026-10-05T10:00:00Z').length > 3);
  ok('reply rules: empty and too long are refused', p.replyProblem('') !== '' && p.replyProblem('   ') !== '' && p.replyProblem('x'.repeat(301)) !== '' && p.replyProblem('hello') === '' && p.MAX_REPLY === 300);
  const sql = require('fs').readFileSync(__dirname + '/../supabase/post_replies.sql', 'utf8');
  ok('replies SQL: row security on, replies die with the post', /enable row level security/.test(sql) && /references public\.pholama_posts\(id\) on delete cascade/.test(sql));
  ok('replies SQL: same link, secret and rule filters as posts', /Links are not allowed/.test(sql) && /secret key/.test(sql) && /community rules/.test(sql));
  ok('replies SQL: banned members and expired or hidden posts cannot receive replies', /banned = false/.test(sql) && /expires_at > now\(\)/.test(sql) && /hidden = false/.test(sql));
  ok('replies SQL: has a rate limit', /Slow down/.test(sql));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
