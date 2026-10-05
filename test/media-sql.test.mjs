// Pictures and videos in posts, builds, tickets and private messages, proven on a REAL PostgreSQL (PGlite) with Supabase's roles.
// Links stay blocked: a file is uploaded, never pointed at by a web address.
import { createRequire } from 'module'; try { createRequire(import.meta.url)('@electric-sql/pglite'); } catch { try { await import('@electric-sql/pglite'); } catch { console.log('SKIPPED: PGlite (npm i --no-save @electric-sql/pglite) is not installed here'); process.exit(0); } }
import { makeDb, as } from './sql/harness.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async (p, re) => { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } };
const db = await makeDb(['platform.sql', 'platform2.sql', 'report_rewards.sql', 'post_replies.sql', 'support.sql', 'social.sql', 'media.sql'].map(f => path.join(root, 'supabase', f)));
const U = {}; for (const n of ['ann', 'bob', 'cat', 'mod']) { const r = await db.query("insert into auth.users (email) values ($1) returning id", [n + '@x.test']); U[n] = r.rows[0].id; await db.query("insert into public.pholama_profiles (user_id, platform_name) values ($1, $2)", [U[n], n[0].toUpperCase() + n.slice(1) + 'Name']); }
await db.query("insert into public.pholama_moderators (user_id) values ($1)", [U.mod]);
const q = (who, sql, p) => as(db, U[who], sql, p);
const file = (who, kind, ext = 'png', id = 'a1b2c3d4-0000-4000-8000-000000000001') => `${U[who]}/${kind}/${id}.${ext}`;
// Ann and Bob are friends
await q('ann', "select public.pholama_friend_request('BobName')"); await q('bob', "select public.pholama_friend_answer((select id from public.pholama_friends limit 1), true)");

// ---- path rule
const pathOk = async (p, who, kind) => (await db.query("select public.pholama_media_path_ok($1,$2,$3) v", [p, U[who], kind])).rows[0].v;
ok('a normal picture path is accepted', await pathOk(file('ann', 'post'), 'ann', 'post'));
for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']) ok('.' + ext + ' is accepted', await pathOk(file('ann', 'post', ext), 'ann', 'post'));
for (const ext of ['svg', 'html', 'js', 'exe', 'php', 'avi', 'mov', 'png.exe', 'pdf']) ok('.' + ext + ' is refused', !(await pathOk(file('ann', 'post', ext), 'ann', 'post')));
ok('someone elses folder is refused', !(await pathOk(file('bob', 'post'), 'ann', 'post')));
ok('the wrong kind of folder is refused', !(await pathOk(file('ann', 'dm'), 'ann', 'post')));
ok('a web address is refused', !(await pathOk('https://evil.example/x.png', 'ann', 'post')));
ok('a path trying to climb out is refused', !(await pathOk(`${U.ann}/post/../${U.bob}/dm/a1b2c3d4-0000.png`, 'ann', 'post')));
ok('a path with a sub-folder trick is refused', !(await pathOk(`${U.ann}/post/x/a1b2c3d4-0000.png`, 'ann', 'post')));
ok('a very short name is refused', !(await pathOk(`${U.ann}/post/ab.png`, 'ann', 'post')));
ok('video detection', (await db.query("select public.pholama_media_is_video($1) a, public.pholama_media_is_video($2) b", ['x/y/z.mp4', 'x/y/z.png'])).rows[0].a === true);

// ---- posts
const post = (who, body, media) => q(who, "insert into public.pholama_posts (user_id, community, body, media_path) values ($1,'general',$2,$3)", [U[who], body, media]);
ok('a post with a picture works', !(await fails(post('ann', 'look at this', file('ann', 'post')))));
ok('a post with only a video (no words) works', !(await fails(post('ann', '', file('ann', 'post', 'mp4', 'a1b2c3d4-0000-4000-8000-000000000002')))));
ok('a post with neither words nor a file is refused', await fails(post('ann', '', null)));
ok('a post cannot point at someone elses file', await fails(post('ann', 'stolen', file('bob', 'post')), /uploading it here/));
ok('a post cannot use a web address as its picture', await fails(post('ann', 'hi', 'https://evil.example/x.png'), /uploading it here/));
ok('a post cannot use an svg', await fails(post('ann', 'hi', file('ann', 'post', 'svg')), /uploading it here/));
ok('links in the words are still blocked, even with a picture', await fails(post('ann', 'see https://evil.example', file('ann', 'post')), /Links are not allowed/));
ok('secret keys in the words are still blocked', await fails(post('ann', 'ghp_abcdef1234567890', file('ann', 'post')), /secret key/));
ok('the picture shows on the post', (await q('bob', "select media_path from public.pholama_posts where media_path is not null")).rows.length === 2);

// ---- replies
ok('replies can carry a picture', await (async () => { const id = (await db.query("select id from public.pholama_posts limit 1")).rows[0].id; await q('bob', "insert into public.pholama_post_replies (post_id, user_id, body, media_path) values ($1,$2,'nice',$3)", [id, U.bob, file('bob', 'post', 'png', 'a1b2c3d4-0000-4000-8000-000000000003')]); return true; })());
ok('a reply cannot use someone elses file', await (async () => { const id = (await db.query("select id from public.pholama_posts limit 1")).rows[0].id; return fails(q('bob', "insert into public.pholama_post_replies (post_id, user_id, body, media_path) values ($1,$2,'x',$3)", [id, U.bob, file('ann', 'post')]), /uploading it here/); })());

// ---- builds
const build = (who, video, imgs = []) => q(who, "insert into public.pholama_projects (user_id, title, blurb, image_paths, video_path) values ($1,'My build','A cool thing I made today',$2,$3)", [U[who], imgs, video]);
ok('a build can have a video', !(await fails(build('ann', file('ann', 'build', 'mp4')))));
ok('a build video must be a video, not a picture', await fails(build('bob', file('bob', 'build', 'png')), /MP4 or WebM/));
ok('a build video cannot be someone elses', await fails(build('bob', file('ann', 'build', 'mp4')), /MP4 or WebM/));
ok('a build video cannot be a web address', await fails(build('bob', 'https://evil.example/v.mp4'), /MP4 or WebM/));
ok('build pictures still follow the old rule', !(await fails(build('cat', null, [`${U.cat}/projects/a1b2c3d4-0000.png`]))));

// ---- tickets
await q('ann', "select public.pholama_ticket_open('Need help','bug','It broke')");
const tid = (await db.query("select id from public.pholama_tickets limit 1")).rows[0].id;
const tsay = (who, body, media) => q(who, "select public.pholama_ticket_say($1,$2,$3)", [tid, body, media]);
ok('the ticket owner can add a screenshot', !(await fails(tsay('ann', 'see screenshot', file('ann', 'ticket')))));
ok('a screenshot alone, with no words, is fine', !(await fails(tsay('ann', '', file('ann', 'ticket', 'mp4', 'a1b2c3d4-0000-4000-8000-000000000020')))));
ok('a ticket with no words and no file is refused', await fails(tsay('ann', '', null)));
ok('a moderator can reply with a picture', !(await fails(tsay('mod', 'here is how', file('mod', 'ticket', 'png', 'a1b2c3d4-0000-4000-8000-000000000021')))));
ok('a ticket file cannot be someone elses', await fails(tsay('ann', 'x', file('bob', 'ticket')), /uploading it here/));
ok('a ticket file cannot be a web address', await fails(tsay('ann', 'x', 'https://evil.example/x.png'), /uploading it here/));
ok('a stranger cannot write on the ticket', await fails(tsay('cat', 'x', null), /not your ticket/));
ok('links in a ticket message are blocked', await fails(tsay('ann', 'see https://evil.example', null), /Links are not allowed/));
ok('links in a NEW ticket are blocked', await fails(q('bob', "select public.pholama_ticket_open('Hi there','bug','look www.evil.example', null)"), /Links are not allowed/));
ok('links in a ticket title are blocked', await fails(q('bob', "select public.pholama_ticket_open('see discord.gg/abc','bug','my problem', null)"), /Links are not allowed/));
ok('secret keys in a ticket are blocked', await fails(tsay('ann', 'my token ghp_abcdef1234567890', null), /secret key/));
ok('a new ticket can start with a screenshot', !(await fails(q('bob', "select public.pholama_ticket_open('Broken thing','bug','look at the picture', $1)", [file('bob', 'ticket', 'png', 'a1b2c3d4-0000-4000-8000-000000000022')]))));
ok('the old three-argument call still works', !(await fails(q('cat', "select public.pholama_ticket_open('Old style','other','no file here')"))));

// ---- private messages
const dm = (who, to, body, media) => q(who, "insert into public.pholama_dms (sender, receiver, body, media_path) values ($1,$2,$3,$4)", [U[who], U[to], body, media]);
ok('a friend can send a picture', !(await fails(dm('ann', 'bob', 'look', file('ann', 'dm')))));
ok('a friend can send only a video, no words', !(await fails(dm('ann', 'bob', '', file('ann', 'dm', 'mp4', 'a1b2c3d4-0000-4000-8000-000000000009')))));
ok('an empty message with no file is refused', await fails(dm('ann', 'bob', '   ', null)));
ok('a DM cannot carry a web address as its picture', await fails(dm('ann', 'bob', 'x', 'https://evil.example/x.png'), /uploading it here/));
ok('a DM cannot carry someone elses file', await fails(dm('ann', 'bob', 'x', file('cat', 'dm')), /uploading it here/));
ok('a DM file from the post folder is refused', await fails(dm('ann', 'bob', 'x', file('ann', 'post')), /uploading it here/));
ok('links in the words are still blocked in a DM with a picture', await fails(dm('ann', 'bob', 'www.evil.example', file('ann', 'dm')), /Links are not allowed/));
ok('a stranger cannot send a picture to a non-friend', await fails(dm('cat', 'bob', 'hi', file('cat', 'dm'))));

// ---- storage: who can open a private file
const putObj = (who, bucket, name) => q(who, "insert into storage.objects (bucket_id, name, owner) values ($1,$2,$3)", [bucket, name, U[who]]);
const canRead = async (who, bucket, name) => (await q(who, "select count(*) n from storage.objects where bucket_id=$1 and name=$2", [bucket, name])).rows[0].n > 0;
const dmFile = file('ann', 'dm', 'png', 'a1b2c3d4-0000-4000-8000-00000000000a');
await putObj('ann', 'pholama-private', dmFile); await dm('ann', 'bob', 'secret pic', dmFile);
ok('the sender can open their private file', await canRead('ann', 'pholama-private', dmFile));
ok('the receiver can open it', await canRead('bob', 'pholama-private', dmFile));
ok('a stranger cannot open it', !(await canRead('cat', 'pholama-private', dmFile)));
ok('a moderator cannot open a private message file', !(await canRead('mod', 'pholama-private', dmFile)));
ok('a logged-out visitor cannot open it', (await as(db, null, "select count(*) n from storage.objects where bucket_id='pholama-private'")).rows[0].n == 0);
const tf = file('ann', 'ticket', 'png', 'a1b2c3d4-0000-4000-8000-00000000000b'); await putObj('ann', 'pholama-private', tf); await tsay('ann', 'proof', tf);
ok('the ticket owner can open the ticket file', await canRead('ann', 'pholama-private', tf));
ok('a moderator can open a ticket file', await canRead('mod', 'pholama-private', tf));
ok('another member cannot open a ticket file', !(await canRead('cat', 'pholama-private', tf)));
ok('an uploaded file that no message uses is private to its owner', await (async () => { const f = file('ann', 'dm', 'png', 'a1b2c3d4-0000-4000-8000-00000000000c'); await putObj('ann', 'pholama-private', f); return (await canRead('ann', 'pholama-private', f)) && !(await canRead('bob', 'pholama-private', f)); })());

// ---- storage: who can upload / delete
ok('you can upload to your own public folder', !(await fails(putObj('ann', 'pholama-media', file('ann', 'post', 'png', 'a1b2c3d4-0000-4000-8000-00000000000d')))));
ok('you cannot upload into someone elses folder', await fails(putObj('cat', 'pholama-media', file('ann', 'post', 'png', 'a1b2c3d4-0000-4000-8000-00000000000e'))));
ok('you cannot upload to a folder that is not post or build', await fails(putObj('ann', 'pholama-media', `${U.ann}/avatar/a1b2c3d4-0000.png`)));
ok('you cannot put a ticket file in the public bucket', await fails(putObj('ann', 'pholama-media', file('ann', 'ticket', 'png', 'a1b2c3d4-0000-4000-8000-00000000000f'))));
ok('you cannot put a DM file in the public bucket', await fails(putObj('ann', 'pholama-media', file('ann', 'dm', 'png', 'a1b2c3d4-0000-4000-8000-000000000010'))));
ok('you cannot put a post file in the private bucket', await fails(putObj('ann', 'pholama-private', file('ann', 'post', 'png', 'a1b2c3d4-0000-4000-8000-000000000011'))));
ok('a logged-out visitor cannot upload', await fails(as(db, null, "insert into storage.objects (bucket_id, name) values ('pholama-media', $1)", [file('ann', 'post', 'png', 'a1b2c3d4-0000-4000-8000-000000000012')])));
ok('anyone can see a public post file', (await as(db, null, "select count(*) n from storage.objects where bucket_id='pholama-media'")).rows[0].n > 0);
ok('you can delete your own file', (await q('ann', "delete from storage.objects where bucket_id='pholama-media' and name=$1 returning id", [file('ann', 'post', 'png', 'a1b2c3d4-0000-4000-8000-00000000000d')])).rows.length === 1);
ok('you cannot delete someone elses file', (await q('cat', "delete from storage.objects where bucket_id='pholama-private' returning id")).rows.length === 0);
ok('the limits are what we promised', await (async () => { const r = (await db.query("select id, public, file_size_limit, allowed_mime_types m from storage.buckets where id in ('pholama-media','pholama-private') order by id")).rows; return r.length === 2 && r[0].public === true && r[1].public === false && r.every(x => x.file_size_limit == 26214400 && !x.m.includes('image/svg+xml') && x.m.includes('video/mp4') && x.m.includes('image/gif')); })());
ok('a banned person cannot upload', await (async () => { await db.query("alter table public.pholama_profiles disable trigger pholama_profile_guard"); await db.query("update public.pholama_profiles set banned=true where user_id=$1", [U.cat]); await db.query("alter table public.pholama_profiles enable trigger pholama_profile_guard"); return fails(putObj('cat', 'pholama-media', file('cat', 'post', 'png', 'a1b2c3d4-0000-4000-8000-000000000013'))); })());
ok('a person cannot keep more than 200 files', await (async () => { await db.exec("alter table storage.objects disable trigger pholama_media_quota"); for (let i = 0; i < 200; i++) await db.query("insert into storage.objects (bucket_id, name) values ('pholama-media', $1)", [`${U.bob}/post/aaaaaaaa-${String(i).padStart(4, '0')}.png`]); await db.exec("alter table storage.objects enable trigger pholama_media_quota"); return fails(putObj('bob', 'pholama-media', file('bob', 'post', 'png', 'a1b2c3d4-0000-4000-8000-000000000014')), /200 files/); })());
console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
