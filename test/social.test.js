// The pure helpers behind friends, chat and attachments.
const assert = require('assert');
(async () => {
  const m = await import('../docs/social.js');
  let n = 0; const t = (name, f) => { f(); n++; };
  const file = (type, size) => ({ type, size });
  t('pictures and videos are accepted', () => { for (const ty of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']) assert.strictEqual(m.mediaProblem(file(ty, 1000)), ''); });
  t('svg, html, scripts and pdfs are refused', () => { for (const ty of ['image/svg+xml', 'text/html', 'application/javascript', 'application/pdf', 'video/quicktime', '']) assert.ok(m.mediaProblem(file(ty, 1000))); });
  t('size limits', () => { assert.ok(m.mediaProblem(file('image/png', 5 * 1024 * 1024 + 1))); assert.strictEqual(m.mediaProblem(file('image/png', 5 * 1024 * 1024)), ''); assert.ok(m.mediaProblem(file('video/mp4', 25 * 1024 * 1024 + 1))); assert.strictEqual(m.mediaProblem(file('video/mp4', 25 * 1024 * 1024)), ''); assert.ok(m.mediaProblem(file('image/png', 0))); assert.ok(m.mediaProblem(null)); });
  t('a path is built from the owner, never from the file name', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000001';
    assert.strictEqual(m.mediaPathFor('U1', 'dm', 'image/png', id), 'U1/dm/' + id + '.png');
    assert.strictEqual(m.mediaPathFor('U1', 'post', 'video/mp4', id), 'U1/post/' + id + '.mp4');
    assert.strictEqual(m.mediaPathFor('U1', 'dm', 'image/svg+xml', id), '');
    assert.strictEqual(m.mediaPathFor('U1', 'secret', 'image/png', id), '');
    assert.strictEqual(m.mediaPathFor('U1', 'dm', 'image/png', '../../x'), '');
    assert.ok(!m.mediaPathFor('U1', 'dm', 'image/png', 'ab/../cd-12345678').includes('..'));
  });
  t('the path matches the rule the database enforces', () => {
    const re = uid => new RegExp('^' + uid + '/(post|build|ticket|dm)/[0-9a-f-]{8,40}\\.(png|jpg|jpeg|webp|gif|mp4|webm)$');
    for (const k of ['post', 'build', 'ticket', 'dm']) for (const ty of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']) assert.ok(re('U1').test(m.mediaPathFor('U1', k, ty, 'a1b2c3d4-0000-4000-8000-000000000001')));
  });
  t('private and public buckets', () => { assert.strictEqual(m.bucketFor('dm'), 'pholama-private'); assert.strictEqual(m.bucketFor('ticket'), 'pholama-private'); assert.strictEqual(m.bucketFor('post'), 'pholama-media'); assert.strictEqual(m.bucketFor('build'), 'pholama-media'); });
  t('public files have an address, private ones need signing', () => { assert.ok(m.mediaUrl('https://x.supabase.co/', 'post', 'U/post/a.png').startsWith('https://x.supabase.co/storage/v1/object/public/pholama-media/')); assert.strictEqual(m.mediaUrl('https://x.supabase.co', 'dm', 'U/dm/a.png'), ''); assert.strictEqual(m.mediaUrl('https://x.supabase.co', 'post', ''), ''); });
  t('video detection', () => { assert.ok(m.isVideoPath('a/b.mp4')); assert.ok(m.isVideoPath('a/b.WEBM')); assert.ok(!m.isVideoPath('a/b.png')); assert.ok(!m.isVideoPath(null)); });
  t('a message needs words or a file', () => { assert.ok(m.dmProblem('', false)); assert.ok(m.dmProblem('   ', false)); assert.strictEqual(m.dmProblem('', true), ''); assert.strictEqual(m.dmProblem('hi', false), ''); assert.ok(m.dmProblem('x'.repeat(501), false)); assert.strictEqual(m.dmProblem('x'.repeat(500), false), ''); });
  t('relations', () => { assert.strictEqual(m.relation(null), 'none'); assert.strictEqual(m.relation({ status: 'accepted' }), 'friend'); assert.strictEqual(m.relation({ status: 'blocked' }), 'blocked'); assert.strictEqual(m.relation({ status: 'pending', i_asked: true }), 'sent'); assert.strictEqual(m.relation({ status: 'pending', i_asked: false }), 'received'); });
  t('friends with unread messages come first, then the newest chat', () => {
    const s = m.sortFriends([{ name: 'Zed', unread: 0, last_at: '2026-01-02' }, { name: 'Amy', unread: 0, last_at: '2026-01-05' }, { name: 'Bo', unread: 2, last_at: '2026-01-01' }]).map(x => x.name);
    assert.deepStrictEqual(s, ['Bo', 'Amy', 'Zed']); });
  t('unread counts only friends', () => { assert.strictEqual(m.unreadTotal([{ status: 'accepted', unread: 2 }, { status: 'accepted', unread: 1 }, { status: 'blocked', unread: 9 }, { status: 'pending', unread: 4 }]), 3); assert.strictEqual(m.unreadTotal(null), 0); });
  t('notification wording', () => { assert.strictEqual(m.notificationText({ kind: 'friend_request', info: 'Amy' }), 'Amy wants to be your friend.'); assert.strictEqual(m.notificationText({ kind: 'missed_call', info: 'Amy' }), 'Missed call from Amy.'); assert.strictEqual(m.notificationText({ kind: 'message' }), 'New message from Someone.'); assert.ok(m.notificationText({ kind: 'weird' })); assert.ok(m.notificationText(null)); });
  t('call clock', () => { assert.strictEqual(m.formatClock(0), '0:00'); assert.strictEqual(m.formatClock(65), '1:05'); assert.strictEqual(m.formatClock(-4), '0:00'); assert.strictEqual(m.formatClock(3599), '59:59'); });
  t('switches default to on and ignore junk', () => { assert.deepStrictEqual(m.cleanPrefs(null), { allow_requests: true, allow_dms: true, allow_calls: true, notify: true }); assert.deepStrictEqual(m.cleanPrefs({ allow_calls: false, notify: 'no', evil: 1 }), { allow_requests: true, allow_dms: true, allow_calls: false, notify: true }); });
  t('friendly errors', () => { assert.ok(/not set up/i.test(m.socialFriendly(new Error('function public.pholama_my_social does not exist')))); assert.ok(/friends first/i.test(m.socialFriendly(new Error('new row violates row-level security policy')))); assert.ok(/too big/i.test(m.socialFriendly(new Error('Payload too large')))); assert.ok(/not allowed/i.test(m.socialFriendly(new Error('mime type image/svg+xml is not supported')))); assert.strictEqual(m.socialFriendly(new Error('Links are not allowed in messages.')), 'Links are not allowed in messages.'); assert.ok(m.socialFriendly(null)); });
  // the data layer talks to the right places
  const calls = []; const Account = { user: () => ({ id: 'U1' }), rest: async (p, o) => { calls.push([p, o]); return []; }, storageTo: async (b, p, f) => calls.push(['up', b, p]), signedUrl: async () => 'x' };
  const S = m.makeSocial(Account, () => ({ SUPABASE_URL: 'https://x.supabase.co' }));
  await S.send('U2', 'hi', { type: 'image/png', size: 100 });
  const up = calls.find(c => c[0] === 'up'); assert.strictEqual(up[1], 'pholama-private'); assert.ok(up[2].startsWith('U1/dm/')); n++;
  const ins = calls.find(c => c[0] === 'pholama_dms'); const body = JSON.parse(ins[1].body); assert.strictEqual(body.sender, 'U1'); assert.strictEqual(body.receiver, 'U2'); assert.ok(body.media_path.startsWith('U1/dm/')); n++;
  await assert.rejects(S.send('U2', 'hi', { type: 'image/svg+xml', size: 100 })); n++;
  await assert.rejects(S.send('U2', '', null)); n++;
  await assert.rejects(S.upload('post', { type: 'application/pdf', size: 5 })); n++;
  assert.ok((await S.upload('build', { type: 'video/mp4', size: 5 })).startsWith('U1/build/')); n++;
  const before = calls.length; await S.send('U2', 'no file', null); assert.ok(!calls.slice(before).some(c => c[0] === 'up')); n++;
  await S.savePrefs({ allow_calls: false, notify: true }); const sp = calls.find(c => String(c[0]).startsWith('pholama_social_prefs?on_conflict')); assert.strictEqual(JSON.parse(sp[1].body).allow_calls, false); assert.strictEqual(JSON.parse(sp[1].body).user_id, 'U1'); n++;
  console.log('social: all ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
