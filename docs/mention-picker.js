const BUILTINS = [
  { name: 'github', title: 'GitHub', description: 'Read repositories, files and issues' },
  { name: 'search', title: 'Live search', description: 'Search the web for current information' },
  { name: 'tools', title: 'Files and tools', description: 'Use local files, calculator and utilities' },
  { name: 'skills', title: 'Skills and My tools', description: 'Use skills and your custom plugins' },
  { name: 'mcp', title: 'MCP servers', description: 'Use tools from connected MCP servers' },
  { name: 'platform', title: 'Pholama Platform', description: 'Read Pholama community and project data' },
];

export function findMentionQuery(text, cursor = String(text || '').length) {
  const value = String(text || '');
  const at = Math.max(0, Math.min(value.length, Number.isFinite(cursor) ? cursor : value.length));
  const before = value.slice(0, at), match = /(?:^|[\s([{,;:"'])@([a-z0-9_]{0,34})$/i.exec(before);
  if (!match) return null;
  const start = before.length - match[1].length - 1;
  const tail = /^[a-z0-9_]*/i.exec(value.slice(at));
  return { start, end: at + (tail ? tail[0].length : 0), query: match[1].toLowerCase() };
}

export function pluginOptions(customTools = []) {
  const out = BUILTINS.map(x => ({ ...x, kind: 'builtin', off: false }));
  const seen = new Set(BUILTINS.map(x => x.name));
  for (const t of Array.isArray(customTools) ? customTools : []) {
    const slug = String(t && t.name || '').toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: 'x_' + slug, title: String(t.title || slug).slice(0, 60), description: String(t.what || 'Your custom service plugin').slice(0, 180), kind: 'custom', off: t.on === false });
  }
  return out;
}

export function filterPluginOptions(options, query = '', limit = 16) {
  const q = String(query || '').toLowerCase().replace(/^@/, '');
  return (Array.isArray(options) ? options : []).filter(o => {
    const short = String(o.name || '').replace(/^x_/, '');
    return !q || [o.name, short, o.title, o.description].some(s => String(s || '').toLowerCase().includes(q));
  }).slice(0, Math.max(1, Math.min(40, limit)));
}
