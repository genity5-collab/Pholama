// Website regression tests for the chat-first Agent Max site and safe RetroStudio mock.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let bad = 0;
const ok = (name, condition, detail = '') => { console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' -> ' + String(detail).slice(0, 250))); if (!condition) bad++; };
(async () => {
  const html = read('docs/index.html'), app = read('docs/app.js'), attach = read('docs/attachui.js');
  const worker = read('docs/sw.js'), credits = read('supabase/maxfriend.sql'), endpoint = read('functions/pholamaCloud.ts');
  ok('main site navigation calls the experience Chat', /id="vChat"[^>]*>Chat<\/button>/.test(html));
  ok('site has chat history, attachment composer, Pholama Cloud and the optional RetroStudio button', /id="histBtn"/.test(html) && /id="in"/.test(html) && !/id="siteAgentBar"/.test(html) && /id="retroPluginBtn"/.test(html) && /Pholama Cloud/.test(html));
  ok('the old standalone website Studio is not mounted by the page', !/cloudstudio\.js|mountCloudStudio|st_host|studioworkspace\.js/.test(html + app));
  ok('the service worker caches the stable cloud and safe-preview modules', !/agentcloud\.js/.test(worker) && /retrostudio\.js/.test(worker) && /pholama-v\d+/.test(worker));
  ok('attachment module enforces three images, keeps a four-file total, and exports attachedFiles', /imageCount\s*>=\s*3/.test(attach) && /picked\.length\s*>=\s*4/.test(attach) && /export const attachedFiles/.test(attach));
  ok('failed/cancelled requests only pop history after the current user turn was added', /historyAdded\s*=\s*true/.test(app) && app.split('\n').filter(l => /history\.pop\(\)/.test(l)).every(l => /historyAdded/.test(l)));
  ok('the site uses the stable Pholama Cloud route', /cloudChat\(/.test(app) && /functions\/pholamaCloud/.test(read('docs/cloud.js')) && !/agentRequest/.test(app));
  ok('Pholama Cloud refunds failed answers', /pholama_max_refund/.test(endpoint) && /nobody pays for an answer they did not get/.test(endpoint));
  ok('Pholama Cloud limits use database-side checks', /pholama_max_spend/.test(endpoint) && /pholama_max_refund/.test(endpoint));
  ok('cloud client keeps requests behind Pholama Cloud', /functions\/pholamaCloud/.test(read('docs/cloud.js')) && !/agentcloud/.test(app));
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
