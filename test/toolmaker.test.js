// "Create a tool with AI": thumbnails are safe, a tool can be renamed and re-described, and the AI's draft can never carry a real key.
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-tm-')); process.env.HOME = home; process.env.USERPROFILE = home;
const u = require(path.join(__dirname, '..', 'server', 'usertools.js'));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
const base = { name: 'notion_read', what: 'Read a page from my Notion workspace', method: 'GET', url: 'https://api.notion.com/v1/pages/{{page}}', headers: { Authorization: 'Bearer {{secret.NOTION_KEY}}' }, params: ['page'] };

// thumbnails
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
ok('png data picture accepted', u.cleanThumb(png) === png);
ok('https picture link accepted', u.cleanThumb('https://cdn.example.com/a.png') === 'https://cdn.example.com/a.png');
ok('svg data refused (can carry script)', u.cleanThumb('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=') === '');
ok('svg link refused', u.cleanThumb('https://a.com/logo.svg') === '' && u.cleanThumb('https://a.com/logo.svg?x=1') === '');
ok('html data refused', u.cleanThumb('data:text/html;base64,PHNjcmlwdD4=') === '');
ok('javascript: refused', u.cleanThumb('javascript:alert(1)') === '');
ok('http refused', u.cleanThumb('http://a.com/a.png') === '');
ok('user:pass@ refused', u.cleanThumb('https://u:p@a.com/a.png') === '');
ok('huge picture refused', u.cleanThumb('data:image/png;base64,' + 'A'.repeat(90000)) === '');
ok('quote characters in data refused', u.cleanThumb('data:image/png;base64,AAAA"onerror="x') === '');

// save with a thumbnail and a title, then edit them
u.save({ ...base, title: 'Notion reader', thumb: png });
let t = u.read('notion_read'); ok('title and picture are saved', t.title === 'Notion reader' && t.thumb === png);
u.update('notion_read', { title: 'Read Notion', what: 'Read any Notion page by its id', thumb: 'https://cdn.example.com/n.png' });
t = u.read('notion_read'); ok('title, description and picture can be changed', t.title === 'Read Notion' && t.what === 'Read any Notion page by its id' && t.thumb === 'https://cdn.example.com/n.png');
ok('the recipe is untouched by an edit', t.url === base.url && t.headers.Authorization === base.headers.Authorization && t.method === 'GET');
let threw = ''; try { u.update('notion_read', { thumb: 'javascript:alert(1)' }); } catch (e) { threw = e.message; } ok('a bad picture is refused, not silently dropped', /not allowed/.test(threw), threw);
u.update('notion_read', { thumb: '' }); ok('picture can be removed', u.read('notion_read').thumb === '');
ok('a short description is refused', (() => { try { u.update('notion_read', { what: 'x' }); return false; } catch { return true; } })());

// rename
const n = u.update('notion_read', { name: 'notion_page' });
ok('rename moves the tool', n === 'notion_page' && !!u.read('notion_page') && !u.read('notion_read'));
ok('rename keeps the recipe and picture fields', u.read('notion_page').url === base.url);
u.save({ ...base, name: 'other_tool' });
ok('rename onto an existing tool is refused', (() => { try { u.update('notion_page', { name: 'other_tool' }); return false; } catch (e) { return /already/.test(e.message); } })());
ok('rename to a bad name is refused', (() => { try { u.update('notion_page', { name: 'a' }); return false; } catch { return true; } })());
ok('unknown tool is refused', (() => { try { u.update('nope_nope', { title: 'x' }); return false; } catch { return true; } })());
ok('the AI sees the new name', u.asTools().some(x => x.name === 'x_notion_page') && !u.asTools().some(x => x.name === 'x_notion_read'));

// drafts never carry a real key
u.setSecret('NOTION_KEY', 'secret_REALKEYVALUE_12345');
const vals = Object.values(u.secretValues());
const leak = u.sanitizeDraft({ ...base, headers: { Authorization: 'Bearer secret_REALKEYVALUE_12345' } }, vals, ['NOTION_KEY']);
ok('a real key the AI wrote out is swapped for the secret name', !JSON.stringify(leak).includes('REALKEYVALUE') && leak.headers.Authorization === 'Bearer {{secret.NOTION_KEY}}', JSON.stringify(leak.headers));
const leak2 = u.sanitizeDraft({ ...base, url: 'https://x.com/a?key=secret_REALKEYVALUE_12345', headers: {} }, vals, ['NOTION_KEY']);
ok('a key in the address is swapped too', !JSON.stringify(leak2).includes('REALKEYVALUE'), leak2.url);
ok('a secret that does not exist is refused', (() => { try { u.sanitizeDraft({ ...base, headers: { A: 'Bearer {{secret.MADE_UP}}' } }, vals, ['NOTION_KEY']); return false; } catch (e) { return /does not exist/.test(e.message); } })());
ok('no key saved: a leaked key is removed, not turned into a secret name', !JSON.stringify(u.sanitizeDraft({ ...base, headers: {}, url: 'https://x.com/?k=secret_REALKEYVALUE_12345' }, vals, [])).includes('REALKEYVALUE'));
ok('the draft is marked as made by the AI and on', (() => { const d = u.sanitizeDraft(base, vals, ['NOTION_KEY']); return d.by === 'ai' && d.on === true; })());
ok('parses JSON wrapped in text', u.parseToolJson('Sure! {"name":"a_b","url":"https://x.com"} done').name === 'a_b');
ok('bad JSON gives null', u.parseToolJson('nothing here') === null);
ok('the writer prompt forbids writing real keys', /NEVER write a real key/.test(u.TOOL_WRITER_PROMPT));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
