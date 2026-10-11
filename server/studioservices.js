// Glue for Pholama Secrets and the Pholama Database inside a Studio. One place, so the PC Studio and the website Studio behave the same.
//  - protectMessage: a chat message is scrubbed BEFORE it is stored or sent to any model.
//  - tools: what the AI may do (names only for secrets; setup of the database is AI-only).
//  - guardWrite: a file can never be saved with a saved secret inside it.
//  - notes: what the AI is told about both features.
'use strict';
const sec = require('./studiosecrets'), db = require('./studiodb');
try { require('./studiorun').setSecretSource(() => sec.allValues()); } catch {}   // saved values are hidden in every stored run

function protectMessage(project, text) {
  const r = sec.protect(project || 'default', text);
  const notice = r.saved.length || r.dropped.length ? [
    r.saved.length ? 'Saved ' + r.saved.length + ' secret' + (r.saved.length > 1 ? 's' : '') + ' for this project (' + r.saved.map(s => s.name).join(', ') + '). The value was removed from your message and is never shown to the AI.' : '',
    r.dropped.length ? r.dropped.length + ' more could not be saved (' + r.dropped.map(s => s.why).join('; ') + '), and was removed from your message.' : '',
  ].filter(Boolean).join(' ') : '';
  return { text: r.text, saved: r.saved, dropped: r.dropped, notice };
}

// A file about to be written. Returns the content to write, or throws. A leaked value is swapped for its {{secret:NAME}} reference
// when that is safe (text files) so the AI's work is not lost, and the AI is told why.
function guardWrite(project, file, content) {
  const hit = sec.leaks(project, content); if (!hit.length) return { content, scrubbed: [] };
  return { content: sec.scrub(project, content), scrubbed: hit };
}

function notes(project) { return [sec.promptNote(project), db.promptNote(project)].filter(Boolean).join('\n'); }

// Tools for the AI. Everything here is by name or structure; no tool returns a secret value or a password hash.
const TOOLS = {
  studio_secret_names: { desc: 'List the NAMES of the secrets saved for a project (never the values). args: {"project": string}',
    run: a => { const l = sec.list(a.project); return l.length ? l.map(s => s.name + ' (' + s.source + ')').join('\n') + '\nRead them in server code as process.env.NAME.' : 'No secrets saved for this project. The user can paste a key in chat or add one in the Secrets panel.'; } },
  studio_db_status: { desc: 'Show whether the Pholama Database is on, how full it is, and its tables. args: {"project": string}',
    run: a => { const s = db.status(a.project); return s.enabled ? 'ON. ' + s.usedPercent + '% of 0.01 GB used. ' + s.accounts + ' accounts. Tables: ' + (s.tables.map(t => t.name + ' [' + Object.entries(t.columns).map(([k, v]) => k + ':' + v).join(', ') + '] ' + t.rows + ' rows').join('; ') || 'none') : 'OFF. Turn it on with studio_db_enable only if the app really needs accounts or saved data.'; } },
  studio_db_enable: { desc: 'Turn the Pholama Database on for a project (free, under 0.01 GB, built-in accounts). Only do this if the app needs accounts or saved data. args: {"project": string}',
    run: async a => { await db.enable(a.project, 'ai'); return 'The database is on (free, under 0.01 GB). Accounts are built in. Rule to respect: each account can sign in 10 times a week, then takes a 4 hour break, so never build auto-login or retry loops. Create tables with studio_db_create_table.'; } },
  studio_db_create_table: { desc: 'Create a table. Column types: text, number, boolean, date. An id column is added for you. args: {"project": string, "table": string, "columns": [{"name": string, "type": string}]}',
    run: async a => { const r = await db.createTable(a.project, a.table, a.columns, 'ai'); return 'Created table ' + r.table + ' with ' + Object.keys(r.columns).join(', ') + '.'; } },
  studio_db_drop_table: { desc: 'Delete a table and all its rows. args: {"project": string, "table": string}',
    run: async a => { await db.dropTable(a.project, a.table, 'ai'); return 'Deleted the table.'; } },
};
const toolList = () => Object.entries(TOOLS).map(([name, t]) => ({ name, desc: t.desc, kind: 'studio' }));
const isTool = n => Object.prototype.hasOwnProperty.call(TOOLS, n);
async function runTool(name, args) { if (!isTool(name)) throw new Error('unknown tool ' + name); try { return String(await TOOLS[name].run(args || {})); } catch (e) { return 'Tool error: ' + (e && e.message || e); } }
const READ_ONLY = new Set(['studio_secret_names', 'studio_db_status']);

module.exports = { protectMessage, guardWrite, notes, toolList, isTool, runTool, READ_ONLY, TOOLS };
