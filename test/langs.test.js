// Code running: Python, C++, Rust ... The compilers are the USER's own; Pholama finds them, runs inside the workspace only, and explains what is missing.
const fs = require('fs'), os = require('os'), path = require('path');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-langs-')); process.env.PHOLAMA_WORKSPACE = ws;
const langs = require('../server/langs'), t2 = require('../server/tools2');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const put = (n, c) => t2.run('write_file', { path: n, content: c });
const has = id => !!langs.detect(id, true);

ok('the AI gets run_code and check_languages', t2.isTool2('run_code') && t2.isTool2('check_languages'));
ok('the big languages are all supported', ['python', 'cpp', 'c', 'rust', 'go', 'java', 'csharp', 'node', 'typescript', 'ruby', 'php', 'lua', 'bash', 'kotlin', 'swift', 'dart', 'r', 'zig', 'powershell'].every(k => langs.LANGS[k]));
ok('language from file ending', langs.langOf('a.py') === 'python' && langs.langOf('x/y.cpp') === 'cpp' && langs.langOf('m.rs') === 'rust' && langs.langOf('a.GO') === 'go');
ok('language from a name or nickname', langs.langOf('x', 'c++') === 'cpp' && langs.langOf('x', 'Python3') === 'python' && langs.langOf('x', 'rs') === 'rust');
ok('an unknown language is refused with the list', (() => { try { langs.langOf('a.xyz'); } catch (e) { return /cannot tell/.test(e.message); } })() && (() => { try { langs.langOf('a', 'cobol9'); } catch (e) { return /Supported/.test(e.message); } })());
ok('check_languages lists installed and missing with install help', /INSTALLED|No programming language/.test(t2.run('check_languages', {})) && /https?:\/\//.test(t2.run('check_languages', {})) || !/NOT INSTALLED/.test(t2.run('check_languages', {})));

if (has('python')) {
  put('a.py', 'import sys\nprint("sum", sum(range(5)))\nprint(sys.argv[1:])\nprint(input().upper())');
  const r = t2.run('run_code', { path: 'a.py', args: ['x', 'y'], stdin: 'shout' });
  ok('Python runs, gets arguments and typed input', /sum 10/.test(r) && /\['x', 'y'\]/.test(r) && /SHOUT/.test(r) && /exit code 0/.test(r), r);
  put('bad.py', 'print(1/0)');
  const e = t2.run('run_code', { path: 'bad.py' });
  ok('a crash shows the error and a non-zero exit code', /ZeroDivisionError/.test(e) && !/exit code 0/.test(e), e);
  put('loop.py', 'import time\nwhile True: time.sleep(0.1)');
  const t0 = Date.now(), lp = t2.run('run_code', { path: 'loop.py', seconds: 2 });
  ok('a runaway program is stopped after the time limit', /STOPPED/.test(lp) && Date.now() - t0 < 6000, lp);
  put('big.py', 'print("x" * 50000)');
  ok('huge output is cut, not dumped', t2.run('run_code', { path: 'big.py' }).length < 10000);
  put('weird name; echo pwned.py', 'print("ok")');
  ok('a file name with shell characters cannot inject a command', /ok/.test(t2.run('run_code', { path: 'weird name; echo pwned.py' })) && !fs.existsSync(path.join(ws, 'pwned')));
} else console.log('SKIP python checks: Python is not installed here');

if (has('cpp')) {
  put('h.cpp', '#include <iostream>\nint main(){std::cout<<"cpp "<<6*7<<"\\n";}');
  ok('C++ builds and runs', /cpp 42/.test(t2.run('run_code', { path: 'h.cpp' })));
  put('broken.cpp', 'int main( { return 0 }');
  const b = t2.run('run_code', { path: 'broken.cpp' });
  ok('a C++ compile error is reported as BUILD FAILED with the message', /BUILD FAILED/.test(b) && /error/i.test(b), b);
  ok('no build leftovers in the temp folder', fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('pholama-build-' + process.pid)).length === 0);
} else console.log('SKIP C++ checks: no C++ compiler installed here');

// a missing language explains itself (force one that cannot exist by hiding PATH)
{
  const keep = process.env.PATH; process.env.PATH = ''; langs.forget();
  put('m.rs', 'fn main(){}');
  const m = t2.run('run_code', { path: 'm.rs' });
  ok('a missing language says what to install, not a stack trace', /Rust is not installed/.test(m) && /rustup\.rs/.test(m), m);
  process.env.PATH = keep; langs.forget();
}

// the jail
ok('a path outside the workspace is refused', (() => { try { t2.run('run_code', { path: '../../etc/passwd.py' }); } catch (e) { return /not allowed|outside/.test(e.message); } })());
ok('a missing file is refused clearly', (() => { try { t2.run('run_code', { path: 'nope.py' }); } catch (e) { return /not found/.test(e.message); } })());
ok('a missing path argument is explained', (() => { try { t2.run('run_code', {}); } catch (e) { return /path/.test(e.message); } })());
fs.rmSync(ws, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
