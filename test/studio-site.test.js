// Website regression tests for the chat-first Free.ai site and safe Roblox: RetroStudio mock.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let bad = 0;
const ok = (name, condition, detail = '') => { console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' -> ' + String(detail).slice(0, 250))); if (!condition) bad++; };
(async () => {
  const html = read('docs/index.html'), app = read('docs/app.js'), attach = read('docs/attachui.js');
  const worker = read('docs/sw.js'), credits = read('supabase/agents.sql'), endpoint = read('functions/pholamaAgents.ts');
  ok('main site navigation calls the experience Chat', /id="vChat"[^>]*>Chat<\/button>/.test(html));
  ok('site has chat history, attachment composer, agent packs and the optional plugin', /id="histBtn"/.test(html) && /id="in"/.test(html) && /id="siteAgentBar"/.test(html) && /id="retroPluginBtn"/.test(html));
  ok('the old standalone website Studio is not mounted by the page', !/cloudstudio\.js|mountCloudStudio|st_host|studioworkspace\.js/.test(html + app));
  ok('the service worker caches new agent and safe-preview modules', /agentcloud\.js/.test(worker) && /retrostudio\.js/.test(worker) && /pholama-v47/.test(worker));
  ok('attachment module enforces three images, keeps a four-file total, and exports attachedFiles', /imageCount\s*>=\s*3/.test(attach) && /picked\.length\s*>=\s*4/.test(attach) && /export const attachedFiles/.test(attach));
  ok('failed/cancelled requests only pop history after the current user turn was added', /historyAdded\s*=\s*true/.test(app) && app.split('\n').filter(l => /history\.pop\(\)/.test(l)).every(l => /historyAdded/.test(l)));
  ok('continuation is an explicit two-credit action and the server bills it atomically', /Continue · 2 credits/.test(app) && /action === 'continue'/.test(endpoint) && /const cost = 2/.test(endpoint));
  ok('continuation can be offered after a two-minute response or a token-limited reply', /finishReason === 'length' \|\| Date\.now\(\) - startedAt >= 120000/.test(endpoint));
  ok('agent credits are 12, reset by UTC date and use database-side cost checks', /daily int := 12/.test(credits) && /now\(\) at time zone 'utc'/.test(credits) && /pholama_credits_spend/.test(endpoint));
  ok('cloud client contains no Free.ai secret and keeps requests behind the account function', !/sk-[A-Za-z0-9]{20,}/.test(read('docs/agentcloud.js')) && /functions\/pholamaAgents/.test(read('docs/agentcloud.js')));
  ok('mock preview source has no dynamic evaluator or executable Lua runtime', !/\beval\s*\(|new Function\s*\(/.test(read('docs/retrostudio.js')) && /never evals user or AI code/.test(read('docs/retrostudio.js')));

  const retro = await import(pathToFileURL(path.join(root, 'docs/retrostudio.js')).href);
  const blocks = retro.extractLuauBlocks('```lua\nlocal A = Instance.new("Part")\n```\n```luau\nlocal B = Instance.new("Part")\n```');
  ok('each returned Lua fence becomes a separate script document', blocks.length === 2);
  const safe = retro.simulateLuau('local base = Instance.new("Part")\nbase.Name = "Base"\nbase.Size = Vector3.new(8, 1, 4)\nbase.Parent = workspace');
  ok('allowlisted part creation becomes a static simulated preview', safe.simulated === true && safe.created === 1 && safe.parts.length === 1 && safe.parts[0].name === 'Base');
  const unsafe = retro.simulateLuau('loadstring("print(1)")\nworkspace:ClearAllChildren()');
  ok('unsupported Lua is never executed and is reported instead', unsafe.simulated === true && unsafe.parts.length === 0 && unsafe.diagnostics.length > 0);
  console.log(bad ? `${bad} FAILED` : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
