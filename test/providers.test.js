// Bring-your-own-key: storage, secrecy, address rules.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-prov-'));
const P = require('../server/providers'), S = require('../server/sources');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const KEY = 'sk-test-SECRET-1234567890abcdef';

const a = P.add({ kind: 'openai', key: KEY }, S.checkLink);
ok('add works and uses the default model', a.model === 'gpt-4o-mini' && a.base === 'https://api.openai.com/v1', JSON.stringify(a));
ok('the view never contains the key', !JSON.stringify(a).includes('SECRET') && !JSON.stringify(P.list()).includes('SECRET'), JSON.stringify(P.list()));
ok('only the last 4 characters are shown', a.hint === '...cdef', a.hint);
ok('key file is private (mode 600)', process.platform === 'win32' || (fs.statSync(P.FILE).mode & 0o777) === 0o600, (fs.statSync(P.FILE).mode & 0o777).toString(8));
ok('ids are unique for the same model', P.add({ kind: 'openai', key: KEY + 'x' }, S.checkLink).id !== a.id);
ok('groq / gemini / openrouter point at their own company', ['groq', 'gemini', 'openrouter', 'mistral', 'deepseek'].every(k => P.add({ kind: k, key: 'abcdefgh1234' }, S.checkLink).base.startsWith('https://')));
ok('unknown company is refused', /Pick one/.test(throws(() => P.add({ kind: 'evil', key: 'abcdefgh1234' }))));
ok('short key refused', /does not look right/.test(throws(() => P.add({ kind: 'openai', key: 'abc' }))));
ok('key with spaces refused', /does not look right/.test(throws(() => P.add({ kind: 'openai', key: 'abcd efgh 1234' }))));
ok('odd model name refused', /model name/.test(throws(() => P.add({ kind: 'openai', key: 'abcdefgh1234', model: 'x; echo hacked' }))));
const c = (base) => throws(() => P.add({ kind: 'custom', key: 'abcdefgh1234', model: 'm', base }, S.checkLink));
ok('custom: https public address ok', c('https://llm.example.com/v1') === null);
ok('custom: http on this same PC ok (LM Studio)', c('http://localhost:1234/v1') === null);
ok('custom: http on the internet refused', /https/.test(c('http://llm.example.com/v1')), c('http://llm.example.com/v1'));
ok('custom: home network refused', /private network/.test(c('https://192.168.1.10/v1')), c('https://192.168.1.10/v1'));
ok('custom: cloud metadata address refused', /private network/.test(c('https://169.254.169.254/latest')), c('https://169.254.169.254/latest'));
ok('custom: password in the address refused', /password/.test(c('https://user:pw@llm.example.com/v1')), c('https://user:pw@llm.example.com/v1'));
ok('custom: not a URL refused', /not valid/.test(c('hello')));
ok('custom: file:// refused', c('file:///etc/passwd') !== null);
ok('scrub removes the exact key', !P.scrub('bad key ' + KEY + ' here', [KEY]).includes('SECRET'));
ok('scrub removes OpenAI/Google/Groq style keys', !/sk-abc|AIzaSy|gsk_abc/.test(P.scrub('sk-abcdefghijklmnop AIzaSyA1234567890123456789012 gsk_abcdefghij12', [])));
ok('scrub removes a Bearer header', !/eyJhbGci/.test(P.scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc', [])));
ok('scrub keeps normal text', P.scrub('hello world', [KEY]) === 'hello world');
const before = P.list().length; ok('remove works', P.remove(a.id) === true && P.list().length === before - 1 && P.remove(a.id) === false);
try { for (let i = 0; i < 20; i++) P.add({ kind: 'openai', key: 'abcdefgh' + i, model: 'm' + i }, S.checkLink); } catch {}
ok('a limit on saved keys', P.list().length <= 12, P.list().length);
ok('known() has no secrets and includes custom', P.known().some(k => k.id === 'custom') && !JSON.stringify(P.known()).includes('"key"'));
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
