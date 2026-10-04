'use strict';
// Plugins and skills for the Pholama AI.
//  * A PLUGIN is a group of tools with one on/off switch (Live search, Pholama Platform, Files, GitHub, ...).
//  * A SKILL is a short saved recipe the AI (or you) wrote: a name, when to use it, and the steps. Skills can be turned on and off.
// Everything here is local, small and defensive: a broken plugin or skill is switched off and reported, it never crashes a chat.
const fs = require('fs'), os = require('os'), path = require('path');
const DIR = path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.pholama');
const SKILLS_DIR = path.join(DIR, 'skills');
const SB_URL = 'https://nyswblzzvqzheaxvrqtq.supabase.co';

// ---------- the plugin list (what you can switch on and off) ----------
// group = the switch name used by buildTools. paid = needs integration credits (so it stops at 0 credits).
const PLUGINS = [
  { id: 'search',   name: 'Live search',       desc: 'Search the web and read web pages for current information.',                         paid: true,  pref: 'search' },
  { id: 'platform', name: 'Pholama Platform',  desc: 'Read the newest posts, the daily post, projects, rules and app updates. Read only.', paid: true,  pref: 'platform' },
  { id: 'github',   name: 'GitHub',            desc: 'Look up repositories and files. Changes always ask you first.',                      paid: true,  pref: 'github' },
  { id: 'tools',    name: 'Files and tools',   desc: 'Calculator, time, and the safe file tools inside your workspace folder.',            paid: false, pref: 'tools' },
  { id: 'skills',   name: 'Skills',            desc: 'Use saved skills, and let the AI write new ones when you ask.',                      paid: false, pref: 'skills' },
  { id: 'mcp',      name: 'MCP servers',       desc: 'Tools from MCP servers you added.',                                                  paid: true,  pref: 'mcp' },
  { id: 'terminal', name: 'Terminal',          desc: 'Run a command on your PC. Every command asks you first.',                            paid: false, pref: 'terminal' },
];
const DEFAULT_ON = { search: true, platform: true, github: true, tools: true, skills: true, mcp: true, terminal: false };
function isOn(prefs, id) { const p = PLUGINS.find(x => x.id === id); if (!p) return false; const v = prefs && prefs[p.pref]; return v == null ? !!DEFAULT_ON[id] : v === true; }
function list(prefs, creditsOk) {
  return PLUGINS.map(p => ({ id: p.id, name: p.name, desc: p.desc, paid: p.paid, on: isOn(prefs, p.id), usable: isOn(prefs, p.id) && (!p.paid || !!creditsOk) }));
}

// ---------- Pholama Platform reader (read only, uses the person's own login so the database decides what they may see) ----------
const anon = () => { try { return (fs.readFileSync(path.join(__dirname, '..', 'web', 'config.js'), 'utf8').match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1] || ''; } catch { return ''; } };
const UUID = /^[0-9a-f-]{36}$/i;
async function sb(pathq, token) {
  const h = { apikey: anon(), 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token; else h.Authorization = 'Bearer ' + anon();
  const r = await fetch(SB_URL + '/rest/v1/' + pathq, { headers: h, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('The Pholama Platform answered ' + r.status + '. Sign in and try again.');
  return r.json();
}
const clean = (t, n) => String(t == null ? '' : t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); if (!isFinite(m)) return ''; return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

const PLATFORM_TOOLS = [
  { name: 'platform_latest_posts', desc: 'Read the newest community posts on the Pholama Platform (read only). args: {"community": string (optional), "limit": number 1-15}', kind: 'search' },
  { name: 'platform_daily', desc: 'Read today\'s daily post from the Pholama team. args: {}', kind: 'search' },
  { name: 'platform_projects', desc: 'Read the newest community project showcases. args: {"limit": number 1-10}', kind: 'search' },
  { name: 'platform_rules', desc: 'Read the Pholama Platform community rules. args: {}', kind: 'search' },
  { name: 'platform_updates', desc: 'Read the newest Pholama app releases and what changed. args: {"limit": number 1-5}', kind: 'search' },
];
const isPlatform = n => /^platform_/.test(n);
async function runPlatform(name, args, token) {
  const a = args || {}, lim = (d, max) => Math.min(max, Math.max(1, Math.floor(+a.limit) || d));
  if (name === 'platform_updates') {   // local file, needs no login
    let rel; try { rel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'releases.json'), 'utf8')); } catch { throw new Error('Could not read the release notes.'); }
    return (rel.releases || []).slice(0, lim(3, 5)).map(r => `v${r.version}${r.date ? ' (' + r.date + ')' : ''}: ${clean(r.title || r.summary || (Array.isArray(r.notes) ? r.notes.join('; ') : ''), 400)}`).join('\n') || 'No release notes yet.';
  }
  if (!token) throw new Error('Sign in to Pholama first (Account) so the AI can read the Platform for you.');
  if (name === 'platform_latest_posts') {
    const comm = a.community ? '&community=eq.' + encodeURIComponent(clean(a.community, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '')) : '';
    const posts = await sb('pholama_posts?select=id,user_id,community,body,created_at&hidden=eq.false&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + comm + '&order=created_at.desc&limit=' + lim(8, 15), token);
    if (!posts.length) return 'No live posts right now. Posts disappear after 3 hours.';
    const ids = [...new Set(posts.map(p => p.user_id).filter(u => UUID.test(u)))].join(',');
    const prof = ids ? await sb('pholama_profiles?select=user_id,platform_name&user_id=in.(' + ids + ')', token).catch(() => []) : [];
    const who = new Map(prof.map(p => [p.user_id, p.platform_name]));
    return posts.map(p => `[${clean(p.community, 30)}] ${clean(who.get(p.user_id) || 'Someone', 30)} (${ago(p.created_at)}): ${clean(p.body, 300)}`).join('\n');
  }
  if (name === 'platform_daily') {
    const d = await sb('pholama_daily?select=day,title,body&order=day.desc&limit=1', token);
    return d[0] ? `${clean(d[0].title, 100)} (${d[0].day}): ${clean(d[0].body, 600)}` : 'No daily post yet.';
  }
  if (name === 'platform_projects') {
    const pr = await sb('pholama_projects?select=title,description,link,created_at&hidden=eq.false&order=created_at.desc&limit=' + lim(5, 10), token);
    return pr.length ? pr.map(p => `${clean(p.title, 80)} (${ago(p.created_at)}): ${clean(p.description, 250)}${p.link ? ' ' + clean(p.link, 150) : ''}`).join('\n') : 'No projects shared yet.';
  }
  if (name === 'platform_rules') {
    const r = await sb('pholama_rules?select=n,body&order=n.asc', token);
    return r.length ? r.map(x => `${x.n}. ${clean(x.body, 250)}`).join('\n') : 'No rules published yet.';
  }
  throw new Error('unknown platform tool ' + name);
}

// ---------- skills ----------
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/;
const MAX_SKILLS = 30, MAX_STEPS = 1500;
const slugify = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39);
function skillProblem(s) {
  if (!s || typeof s !== 'object') return 'A skill needs a name, when to use it, and steps.';
  const slug = slugify(s.name); if (!SLUG.test(slug)) return 'Give the skill a short name (2 to 39 letters, numbers or dashes).';
  if (clean(s.when, 200).length < 5) return 'Say when to use it (at least 5 characters).';
  if (clean(s.steps, MAX_STEPS).length < 10) return 'Write the steps (at least 10 characters).';
  if (String(s.steps).length > MAX_STEPS) return 'Keep the steps under ' + MAX_STEPS + ' characters.';
  // A skill is only instructions. It can never grant tools, run code, or point outside its own text.
  if (/(?:ignore|disregard|forget)\s+(?:all\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules)|system prompt|reveal.{0,20}(?:prompt|instructions)/i.test(s.steps + ' ' + s.when)) return 'A skill cannot change the AI\'s rules.';
  return '';
}
const file = slug => path.join(SKILLS_DIR, slug + '.json');
function readSkill(slug) { try { const o = JSON.parse(fs.readFileSync(file(slug), 'utf8')); return o && SLUG.test(slugify(o.name)) ? o : null; } catch { return null; } }
function listSkills() {
  let names = []; try { names = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); } catch { return []; }
  return names.filter(n => SLUG.test(n)).map(readSkill).filter(Boolean).map(s => ({ name: slugify(s.name), when: clean(s.when, 200), steps: clean(s.steps, MAX_STEPS), on: s.on !== false, by: s.by === 'you' ? 'you' : 'ai', made: s.made || '' })).sort((a, b) => a.name.localeCompare(b.name));
}
function saveSkill(s, by = 'ai') {
  const bad = skillProblem(s); if (bad) throw new Error(bad);
  const slug = slugify(s.name), have = listSkills();
  if (!have.some(x => x.name === slug) && have.length >= MAX_SKILLS) throw new Error('You already have ' + MAX_SKILLS + ' skills. Delete one first.');
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const old = readSkill(slug);
  fs.writeFileSync(file(slug), JSON.stringify({ name: slug, when: clean(s.when, 200), steps: String(s.steps).replace(/\r/g, '').slice(0, MAX_STEPS).trim(), on: old ? old.on !== false : true, by: by === 'you' ? 'you' : 'ai', made: new Date().toISOString() }, null, 2));
  return slug;
}
function setSkillOn(name, on) { const slug = slugify(name), o = readSkill(slug); if (!o) throw new Error('No skill called ' + slug + '.'); o.on = !!on; fs.writeFileSync(file(slug), JSON.stringify(o, null, 2)); return slug; }
function deleteSkill(name) { const slug = slugify(name); if (!SLUG.test(slug)) throw new Error('No such skill.'); try { fs.unlinkSync(file(slug)); } catch { throw new Error('No skill called ' + slug + '.'); } return slug; }
// What the AI is told about skills: short names and when to use them. The full steps are loaded only when it asks (or when one clearly matches).
function skillsPrompt(skills) {
  const on = (skills || []).filter(s => s.on); if (!on.length) return '';
  return '\nSKILLS you can use (saved by the user). If one fits the request, follow its steps; or call use_skill with its name:\n' + on.slice(0, 12).map(s => `- ${s.name}: ${s.when}`).join('\n') + '\n';
}
const SKILL_TOOLS = [
  { name: 'use_skill', desc: 'Load the steps of one saved skill so you can follow them. args: {"name": string}', kind: 'calc' },
  { name: 'create_skill', desc: 'Save a NEW reusable skill, only when the user asks you to make one. args: {"name": string (short, lowercase), "when": string (when to use it), "steps": string (clear numbered steps)}', kind: 'calc' },
];
const isSkillTool = n => n === 'use_skill' || n === 'create_skill';
function runSkillTool(name, args) {
  if (name === 'use_skill') { const slug = slugify(args && args.name), s = listSkills().find(x => x.name === slug); if (!s) throw new Error('No skill called "' + slug + '". Saved skills: ' + (listSkills().map(x => x.name).join(', ') || 'none')); if (!s.on) throw new Error('That skill is switched off.'); return `SKILL ${s.name} (${s.when})\n${s.steps}`; }
  if (name === 'create_skill') { const slug = saveSkill(args || {}, 'ai'); return 'SAVED skill "' + slug + '". It is on now; you can switch it off in Plugins.'; }
  throw new Error('unknown skill tool ' + name);
}
// The AI is asked to write a skill from a plain request such as "make me a skill that summarises articles".
const SKILL_WRITER_PROMPT = 'You write ONE reusable skill for an AI assistant. Reply with ONLY a JSON object: {"name":"short-lowercase-name","when":"one sentence: when to use it","steps":"1. ...\\n2. ...\\n3. ..."}. 3 to 7 clear steps. No extra text.';
function parseSkillJson(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || '')); if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === 'object' ? { name: o.name, when: o.when, steps: Array.isArray(o.steps) ? o.steps.map((x, i) => `${i + 1}. ${x}`).join('\n') : o.steps } : null; } catch { return null; }
}

// ---------- self-check: "the AI never breaks" ----------
// Every plugin and skill is validated. Anything broken is reported and switched off; the chat always has a safe fallback (plain chat).
function selfCheck(prefs) {
  const problems = [];
  for (const p of PLUGINS) if (!p.id || !p.name || !p.pref) problems.push('plugin ' + p.id + ' is incomplete');
  for (const t of [...PLATFORM_TOOLS, ...SKILL_TOOLS]) if (!t.name || !t.desc || !t.kind) problems.push('tool ' + t.name + ' is incomplete');
  let names = []; try { names = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.json')); } catch {}
  for (const f of names) { const slug = f.slice(0, -5); const o = readSkill(slug); if (!o) problems.push('skill file ' + f + ' is unreadable'); else { const bad = skillProblem(o); if (bad) problems.push('skill ' + slug + ': ' + bad); } }
  return { ok: !problems.length, problems, plugins: list(prefs, true).length, skills: listSkills().length };
}
module.exports = { PLUGINS, DEFAULT_ON, isOn, list, PLATFORM_TOOLS, isPlatform, runPlatform, SKILL_TOOLS, isSkillTool, runSkillTool, listSkills, saveSkill, setSkillOn, deleteSkill, skillProblem, skillsPrompt, slugify, SKILL_WRITER_PROMPT, parseSkillJson, selfCheck, SKILLS_DIR };
