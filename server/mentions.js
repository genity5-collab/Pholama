'use strict';
// "@name" in a message calls a plugin for that one message: "@github look at my repo", "@notion_page read page 12".
// A mention turns ONE plugin on even if its switch is off, and tells the AI to use it. It can never:
//  * turn on the Terminal (that has its own switch and asks before every command)
//  * make a model that cannot run tools run them
//  * spend credits you do not have
// Text that only looks like a mention (an email address, @everyone, an unknown name) is ignored.
const GROUPS = {
  github: { pref: 'github', label: 'GitHub', aliases: ['github', 'git', 'repo', 'repos'] },
  search: { pref: 'search', label: 'Live search', aliases: ['search', 'web', 'google', 'browse'] },
  tools: { pref: 'tools', label: 'Files and tools', aliases: ['tools', 'files', 'calculator', 'calc', 'time', 'clock'] },
  skills: { pref: 'skills', label: 'Skills', aliases: ['skills', 'skill'] },
  mcp: { pref: 'mcp', label: 'MCP servers', aliases: ['mcp'] },
  platform: { pref: 'platform', label: 'Pholama Platform', aliases: ['platform', 'pholama'] },
};
const ALIAS = {}; for (const [id, g] of Object.entries(GROUPS)) for (const a of g.aliases) ALIAS[a] = id;
// A mention starts at the beginning or after a space/punctuation (so "me@github.com" is NOT a mention) and is followed by a word end.
const RE = /(^|[\s(\[{,;:"'])@([a-z][a-z0-9_]{1,31})(?![a-z0-9_@.-]*@)(?=$|[\s)\]},;:!?"'.])/gi;

// Returns { groups: ['github'], tools: ['notion_page'], names: ['github','notion_page'] } for the plugins the message calls.
function find(text, customNames = []) {
  const out = { groups: [], tools: [], names: [] }, custom = new Set((customNames || []).map(n => String(n).toLowerCase()));
  const s = String(text || '').slice(0, 4000); let m; RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    const w = m[2].toLowerCase();
    if (custom.has(w)) { if (!out.tools.includes(w)) { out.tools.push(w); out.names.push(w); } }
    else if (ALIAS[w]) { const g = ALIAS[w]; if (!out.groups.includes(g)) { out.groups.push(g); out.names.push(w); } }
    if (out.names.length >= 6) break;
  }
  return out;
}
// Applies the mentions to the per-message "allow" set. Returns what it actually did, so the page and the log can say so.
// canTools: can this model run tools at all? creditsOk: are there credits left for paid plugins?
function apply(allow, found, { canTools, creditsOk, paid = { github: true, search: true, mcp: true, platform: true } } = {}) {
  const did = { forced: [], blocked: [] };
  for (const g of found.groups) {
    if (!canTools) { did.blocked.push({ name: g, why: 'This model cannot run tools. Pick one tagged "tools".' }); continue; }
    if (paid[g] && !creditsOk) { did.blocked.push({ name: g, why: 'Not enough credits for ' + GROUPS[g].label + ' today.' }); continue; }
    if (!allow[g]) { allow[g] = true; did.forced.push(g); }
  }
  if (found.tools.length) {
    if (!canTools) for (const t of found.tools) did.blocked.push({ name: t, why: 'This model cannot run tools. Pick one tagged "tools".' });
    else { allow.skills = true; allow.mentionTools = found.tools.slice(); for (const t of found.tools) did.forced.push(t); }
  }
  return did;
}
// A line added to the system prompt so the model knows WHICH plugin the person meant and does not say "I can't access that".
function hint(found, did) {
  const ok = new Set(did.forced.concat(found.groups.filter(g => did.forced.indexOf(g) < 0 && !did.blocked.some(b => b.name === g))));
  const names = [...found.groups.filter(g => ok.has(g)).map(g => '@' + g + ' = the ' + GROUPS[g].label + ' tools'), ...found.tools.filter(t => ok.has(t)).map(t => '@' + t + ' = the tool x_' + t)];
  if (!names.length) return '';
  return '\n[the user called these plugins by name in their message, so USE their tools for this request and do not say you cannot access them: ' + names.join('; ') + ']';
}
module.exports = { GROUPS, find, apply, hint };
