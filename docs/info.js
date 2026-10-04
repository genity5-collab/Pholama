// Pholama information pages: update log, API and keys, guides. Pure reading material, no secrets are ever collected here.
// Everything is built with textContent, so release notes or any text can never inject markup.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? +m[3] + ' ' + MON[+m[2] - 1] + ' ' + m[1] : String(d || ''); };

// The guides. Plain data so they are easy to extend. `code` blocks are shown as text only.
export const GUIDES = [
  { id: 'start', title: 'Get started on PC', steps: ['Open the Pholama page on GitHub and download the installer for your system.', 'Start Pholama. It opens in your browser at http://localhost:11435.', 'Open Models, pick one marked "Runs tools", and press Download.', 'Close Models and start typing. It works offline after the first download.'] },
  { id: 'github', title: 'Sign in with GitHub', steps: ['Open Settings, then Account, and press Continue with GitHub.', 'GitHub asks for access to your repositories. This replaces pasting a token.', 'Pholama still asks you before every write to GitHub.', 'Sign in with the same GitHub account on the site and the PC app to earn the 250 credit bonus, once per account.'] },
  { id: 'api', title: 'Use your local AI in a game or site', steps: ['Start Pholama and download a model.', 'Your PC answers at http://localhost:11435/v1, in the same format as OpenAI.', 'Call /v1/chat/completions from your page or script. No key is needed on the same PC.', 'Only pages on localhost can call it unless you allow a site with PHOLAMA_ORIGINS.'], code: 'fetch("http://localhost:11435/v1/chat/completions", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ model: "gguf:qwen2.5-7b", messages: [{ role: "user", content: "Hi!" }] })\n})' },
  { id: 'remote', title: 'Reach your PC from another device', steps: ['On the PC open Settings, then Remote access, and make an API key.', 'Keys start with phk_. They can only chat. They can never run tools or commands.', 'Use a tunnel such as Tailscale so the PC is reachable, then use http://<address>:11435/v1 as the base URL.', 'Delete a key in the same place if you ever lose it.'] },
];

export const KEY_FACTS = [
  ['Where keys come from', 'You make them yourself in the PC app under Settings, Remote access. Nobody else can create one for you.'],
  ['What a key can do', 'Chat only. It cannot run tools, edit files or run commands on your PC.'],
  ['Keep it private', 'Treat a key like a password. Never post it in a public repository, a screenshot or a chat.'],
  ['This site and keys', 'This site never asks for or stores your keys. Enter them only inside the PC app.'],
  ['Cloud AI (Agent Max)', 'The cloud model key is held on the server. It is never sent to your browser.'],
];

function section(title, lead) { const s = el('section', 'dcard'); s.append(el('h3', null, title)); if (lead) s.append(el('p', 'dmut', lead)); return s; }

export function updateLog(releases) {
  const s = section('Update log', 'Every version, newest first.');
  const list = (releases || []).slice(0, 30);
  if (!list.length) { s.append(el('p', 'dmut', 'No releases could be loaded right now.')); return s; }
  for (const r of list) {
    const d = el('details', 'infrel'); if (r === list[0]) d.open = true;
    const sm = el('summary'); sm.append(el('b', null, 'v' + r.version), el('span', null, '  ' + (r.title || '')), el('small', 'dmut', '  ' + fmtDate(r.date)));
    const ul = el('ul', 'dbul'); for (const n of (r.notes || [])) ul.append(el('li', null, n));
    d.append(sm, ul); s.append(d);
  }
  return s;
}

export function apiAndKeys() {
  const s = section('API and keys', 'How to use Pholama from your own code, and how keys work.');
  const dl = el('dl', 'infkv'); for (const [k, v] of KEY_FACTS) { dl.append(el('dt', null, k), el('dd', null, v)); } s.append(dl);
  const t = el('table', 'inftbl'); const head = el('tr'); for (const h of ['Method', 'Path', 'What it does']) head.append(el('th', null, h)); t.append(head);
  for (const [m, p, w] of [['GET', '/v1/models', 'List your models'], ['POST', '/v1/chat/completions', 'Chat, with streaming'], ['POST', '/v1/completions', 'Plain text completion'], ['POST', '/v1/embeddings', 'Turn text into numbers for search'], ['GET', '/api/version', 'Pholama version']]) { const r = el('tr'); r.append(el('td', null, m), el('td', null, p), el('td', null, w)); t.append(r); }
  s.append(t); return s;
}

export function guides() {
  const s = section('Guides');
  for (const g of GUIDES) {
    const d = el('details', 'infrel'); d.id = 'guide-' + g.id; d.append(el('summary', null, g.title));
    const ol = el('ol', 'dbul'); for (const st of g.steps) ol.append(el('li', null, st)); d.append(ol);
    if (g.code) d.append(el('pre', 'cmdcode', g.code));
    s.append(d);
  }
  return s;
}

export function mountInfo(host, data) {
  host.textContent = '';
  const wrap = el('div', 'infwrap');
  wrap.append(el('h2', null, 'Pholama information'), el('p', 'dmut', 'This site is now an information site. The AI lives in the PC app.'),
    updateLog(data && data.releases), apiAndKeys(), guides());
  host.append(wrap);
}
