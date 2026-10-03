// Pholama GitHub tools. Uses the USER's own token (saved on their PC in ~/.pholama), never anyone else's.
// Read tools run freely (public repos need no token). Write tools NEVER run directly: they return a pending
// action that the user must approve in the page, and only then does confirm() perform it.
const crypto = require('crypto');
const API = 'https://api.github.com';
const slug = s => { s = String(s || '').trim(); if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(s)) throw new Error('repo must look like owner/name'); return s; };
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

async function gh(token, path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Pholama', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(15000) });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  if (r.status === 401) throw new Error('GitHub says your token is invalid or expired. Reconnect GitHub in Tools.');
  if (r.status === 403 && /rate limit/i.test(txt)) throw new Error('GitHub rate limit reached. Connect a token in Tools for a higher limit.');
  if (r.status === 404) throw new Error('Not found (or private: connect a token with access).');
  if (!r.ok) throw new Error('GitHub error ' + r.status + ': ' + clip(j.message, 120));
  return j;
}

// ----- read tools -----
const READ = {
  github_search_repos: {
    desc: 'Search GitHub repositories. args: {"query": string}',
    run: async (t, a) => {
      const q = clip(a.query, 200); if (!q) throw new Error('query required');
      const j = await gh(t, '/search/repositories?per_page=5&q=' + encodeURIComponent(q));
      return (j.items || []).map((r, i) => `${i + 1}. ${r.full_name} (${r.stargazers_count} stars, ${r.language || 'n/a'}) ${clip(r.description, 120)}\n   ${r.html_url}`).join('\n') || 'No repositories found.';
    } },
  github_read_file: {
    desc: 'Read a text file from a repo. args: {"repo":"owner/name","path":string}',
    run: async (t, a) => {
      const j = await gh(t, `/repos/${slug(a.repo)}/contents/${String(a.path || '').split('/').map(encodeURIComponent).join('/')}`);
      if (Array.isArray(j)) return 'That is a folder. Files: ' + j.slice(0, 40).map(f => f.name + (f.type === 'dir' ? '/' : '')).join(', ');
      if (j.encoding !== 'base64') throw new Error('cannot read this file');
      if (j.size > 200000) throw new Error('file is too large to read (' + j.size + ' bytes)');
      return Buffer.from(j.content, 'base64').toString('utf8').slice(0, 4000);
    } },
  github_list_issues: {
    desc: 'List open issues of a repo. args: {"repo":"owner/name"}',
    run: async (t, a) => {
      const j = await gh(t, `/repos/${slug(a.repo)}/issues?state=open&per_page=8`);
      return j.filter(x => !x.pull_request).map(x => `#${x.number} ${clip(x.title, 100)} (${x.user && x.user.login})`).join('\n') || 'No open issues.';
    } },
  github_repo_info: {
    desc: 'Get details of a repo: description, stars, language, last update. args: {"repo":"owner/name"}',
    run: async (t, a) => {
      const r = await gh(t, '/repos/' + slug(a.repo));
      return `${r.full_name}: ${clip(r.description, 160)}\nStars ${r.stargazers_count}, forks ${r.forks_count}, language ${r.language || 'n/a'}, default branch ${r.default_branch}, updated ${r.pushed_at}, ${r.private ? 'private' : 'public'}.`;
    } },
};

// ----- write tools: never run until approved -----
const WRITE = {
  github_create_issue: {
    desc: 'Create an issue (asks the user to approve first). args: {"repo":"owner/name","title":string,"body":string}',
    check: a => { slug(a.repo); if (clip(a.title, 200).length < 3) throw new Error('title required'); },
    summary: a => `Create issue "${clip(a.title, 80)}" in ${a.repo}`,
    run: (t, a) => gh(t, `/repos/${slug(a.repo)}/issues`, { method: 'POST', body: { title: clip(a.title, 200), body: String(a.body || '').slice(0, 6000) } }).then(j => 'Created issue #' + j.number + ' ' + j.html_url) },
  github_comment: {
    desc: 'Comment on an issue or pull request (asks the user to approve first). args: {"repo":"owner/name","number":int,"body":string}',
    check: a => { slug(a.repo); if (!(+a.number > 0)) throw new Error('issue number required'); if (!String(a.body || '').trim()) throw new Error('body required'); },
    summary: a => `Comment on ${a.repo}#${a.number}: "${clip(a.body, 80)}"`,
    run: (t, a) => gh(t, `/repos/${slug(a.repo)}/issues/${+a.number}/comments`, { method: 'POST', body: { body: String(a.body).slice(0, 6000) } }).then(j => 'Commented: ' + j.html_url) },
  github_create_repo: {
    desc: 'Create a NEW repository on the user\'s GitHub account (asks the user to approve first). args: {"name":string,"description":string,"private":boolean}',
    check: a => { if (!/^[A-Za-z0-9_.-]{1,100}$/.test(String(a.name || ''))) throw new Error('repo name may use letters, numbers, dash, underscore, dot'); },
    summary: a => `Create the ${a.private ? 'private' : 'public'} repository "${a.name}" on your GitHub`,
    run: (t, a) => gh(t, '/user/repos', { method: 'POST', body: { name: a.name, description: clip(a.description, 300), private: a.private === true, auto_init: true } }).then(j => 'Created ' + j.full_name + ' ' + j.html_url) },
  github_publish_project: {
    desc: 'Upload ALL files of a Studio project to a repo in ONE commit (asks the user to approve first). args: {"repo":"owner/name","files":[{"path":string,"content":string}],"message":string}',
    check: a => { slug(a.repo); if (!Array.isArray(a.files) || !a.files.length || a.files.length > 80) throw new Error('1 to 80 files required'); for (const f of a.files) { if (!/^[^\0]{1,200}$/.test(String(f.path || '')) || /(^|\/)\.\.?(\/|$)/.test(f.path) || String(f.path).startsWith('/')) throw new Error('bad path ' + clip(f.path, 40)); if (f.content == null) throw new Error('content required for ' + f.path); } },
    summary: a => `Publish ${a.files.length} file${a.files.length === 1 ? '' : 's'} to ${a.repo} in one commit: "${clip(a.message || 'Publish from Pholama Studio', 60)}"`,
    run: async (t, a) => {
      const repo = slug(a.repo), info = await gh(t, '/repos/' + repo), br = info.default_branch || 'main';
      let baseSha = null, baseTree = null;
      try { const ref = await gh(t, `/repos/${repo}/git/ref/heads/${br}`); baseSha = ref.object.sha; baseTree = (await gh(t, `/repos/${repo}/git/commits/${baseSha}`)).tree.sha; } catch (e) { if (!/Not found/.test(e.message)) throw e; }   // empty repo: no branch yet
      const tree = [];
      for (const f of a.files) { const b = await gh(t, `/repos/${repo}/git/blobs`, { method: 'POST', body: { content: Buffer.from(String(f.content)).toString('base64'), encoding: 'base64' } }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha }); }
      const nt = await gh(t, `/repos/${repo}/git/trees`, { method: 'POST', body: baseTree ? { base_tree: baseTree, tree } : { tree } });
      const c = await gh(t, `/repos/${repo}/git/commits`, { method: 'POST', body: { message: clip(a.message || 'Publish from Pholama Studio', 200), tree: nt.sha, parents: baseSha ? [baseSha] : [] } });
      if (baseSha) await gh(t, `/repos/${repo}/git/refs/heads/${br}`, { method: 'PATCH', body: { sha: c.sha } }); else await gh(t, `/repos/${repo}/git/refs`, { method: 'POST', body: { ref: 'refs/heads/' + br, sha: c.sha } });
      return `Published ${a.files.length} files to ${repo} (commit ${c.sha.slice(0, 7)}) ${info.html_url}`;
    } },
  github_write_file: {
    desc: 'Create or update a file in a repo (asks the user to approve first). args: {"repo":"owner/name","path":string,"content":string,"message":string}',
    check: a => { slug(a.repo); if (!/^[^\0]{1,200}$/.test(String(a.path || '')) || /(^|\/)\.\.(\/|$)/.test(a.path)) throw new Error('bad path'); if (a.content == null) throw new Error('content required'); },
    summary: a => `Write ${a.path} in ${a.repo} (${String(a.content).length} characters): "${clip(a.message || 'Update ' + a.path, 60)}"`,
    run: async (t, a) => {
      const p = String(a.path).split('/').map(encodeURIComponent).join('/'); let sha;
      try { sha = (await gh(t, `/repos/${slug(a.repo)}/contents/${p}`)).sha; } catch (e) { if (!/Not found/.test(e.message)) throw e; }
      const j = await gh(t, `/repos/${slug(a.repo)}/contents/${p}`, { method: 'PUT', body: { message: clip(a.message || 'Update ' + a.path, 200), content: Buffer.from(String(a.content)).toString('base64'), sha } });
      return 'Saved ' + a.path + ' (commit ' + String(j.commit && j.commit.sha).slice(0, 7) + ')';
    } },
};

const pending = new Map();   // id -> { tool, args, summary, at }
const TTL = 10 * 60 * 1000;
const sweep = () => { const n = Date.now(); for (const [k, v] of pending) if (n - v.at > TTL) pending.delete(k); };

const tools = () => [...Object.entries(READ), ...Object.entries(WRITE)].map(([name, t]) => ({ name, desc: t.desc, kind: WRITE[name] ? 'ghwrite' : 'ghread' }));
const isGithub = name => Object.prototype.hasOwnProperty.call(READ, name) || Object.prototype.hasOwnProperty.call(WRITE, name);

// Called by the tool loop. Reads run now. Writes are parked and the model is told they await approval.
async function run(token, name, args) {
  args = args && typeof args === 'object' ? args : {};
  if (READ[name]) return { text: await READ[name].run(token, args) };
  if (WRITE[name]) {
    if (!token) throw new Error('Connect GitHub in Tools first. Writing needs your token.');
    WRITE[name].check(args);
    sweep(); const id = crypto.randomBytes(9).toString('hex');
    pending.set(id, { name, args, summary: WRITE[name].summary(args), at: Date.now() });
    return { text: 'WAITING: the user must approve this in the page before it happens: ' + pending.get(id).summary + '. Tell the user to press Allow.', pending: { id, summary: pending.get(id).summary } };
  }
  throw new Error('unknown github tool');
}
// Called only from the approve button.
async function confirm(token, id, approve) {
  sweep(); const p = pending.get(id); if (!p) throw new Error('That request expired. Ask again.');
  pending.delete(id);
  if (!approve) return 'Cancelled. Nothing was changed.';
  return WRITE[p.name].run(token, p.args);
}
module.exports = { tools, isGithub, run, confirm, _pending: pending };
