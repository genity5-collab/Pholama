// Locks in the 0.9.13 cleanup: no ChatGPT door, no v0 credit line, no website model downloads, and a Studio stylesheet that cannot put light text on a light panel.
const fs = require('fs'), path = require('path'); const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
const exists = p => fs.existsSync(path.join(__dirname, '..', p));

// ChatGPT connection is gone
ok('the Connect ChatGPT card file is deleted', !exists('web/chatgpt.js'));
ok('the /mcp server file is deleted', !exists('server/mcp.js'));
ok('the page does not import the card', !/chatgpt\.js|buildChatGptCard/.test(R('web/app.js')));
const srv = R('server/server.js');
ok("the server has no '/mcp' door", !/p === '\/mcp'/.test(srv));
ok('the server has no ChatGPT on/off switch', !/mcp-server/.test(srv));
ok('the server no longer loads the deleted file', !/require\('\.\/mcp'\)/.test(srv));
ok('bring-your-own-key for ChatGPT/Gemini/Groq is kept', /openai:/.test(R('server/providers.js')) && exists('web/keys.js'));
ok('the agent still uses other MCP servers (not the same feature)', /\/api\/mcp'/.test(srv));

// v0 credit line is gone
for (const f of ['docs/index.html', 'web/index.html', 'docs/style.css', 'web/style.css']) ok('no v0 credit line in ' + f, !/v0-credit|Built with help from v0/.test(R(f)));

// website model downloads ended
const app = R('web/app.js');
ok('website refuses every browser/CPU download', /if \(!server\) throw new Error\(SITE_NO_DL\)/.test(app));
ok('the refusal runs before the account check', app.indexOf('if (!server) throw new Error(SITE_NO_DL)') < app.indexOf('if (!Account.user()) return;', app.indexOf('async function mustNotDownload')));
ok('all three download paths go through the guard', (app.match(/await mustNotDownload\(/g) || []).length >= 3);
ok('the website picker offers no phone models', /for \(const id of \(server \? saved\(\) : \[\]\)\)/.test(app));
ok('the website Models panel shows the ended notice, not a list', /Model downloads on the website have ended/.test(app));
ok('the website hero no longer promises browser models', !/run inside your browser/.test(R('docs/index.html')));

// Studio stylesheet (Studio only exists in the PC app, so the website stylesheet must simply not carry Studio rules)
ok('the website has no Studio styles (Studio is PC only)', !/\.st-|#studio/.test(R('docs/style.css')));
{
  const css = R('web/style.css');
  ok('Studio no longer forces white text on its panels', !/#studio\{[^}]*color:#f8fafc|\.st-code\{[^}]*color:#fff/.test(css));
  ok('Studio has no fixed dark greys left over', !/#24282f|#30343b|#343a43|#3b414a|#505966/.test(css));
  // the panels get their text colour from the Studio block at the end of the file (also measured in a real browser: contrast 14 to 18 in light and dark)
  ok('panels, tabs, headers, console and page all set a theme text colour', /\.st-left,\.st-right,\.st-ai\{[^}]*color:var\(--fg\)/.test(css) && /\.st-tabs,\.st-prevhead,\.st-conhead\{[^}]*color:var\(--fg\)/.test(css) && /\.st-con,\.st-ailog\{[^}]*color:var\(--fg\)/.test(css) && /#studio\{[^}]*color:var\(--fg\)/.test(css));
  ok('the editor and the message box set their own themed text colour', /\.st-code,#stCode\{[^}]*color:var\(--fg\)/.test(css) && /\.st-aibox textarea\{[^}]*color:var\(--fg\)/.test(css));
  ok('Studio console lines use themed colours (info, warn, error)', /\.st-l\.info\{color:var\(--acc\)\}/.test(css) && /\.st-l\.warn\{color:var\(--warn\)\}/.test(css) && /\.st-l\.error\{color:var\(--err\)\}/.test(css));
}
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
