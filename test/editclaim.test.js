// Studio must not claim "I added X" when no file was written this message.
const e = require('../server/editclaim.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
// which tool calls really changed a file
ok('studio_write "Created index.html" is a change', e.changedFile('studio_write', 'Created index.html (420 bytes)'));
ok('studio_write "Saved style.css" is a change', e.changedFile('studio_write', 'Saved style.css (90 bytes)'));
ok('studio_patch "Edited" is a change', e.changedFile('studio_patch', 'Edited script.js'));
ok('studio_patch matched ignoring spacing is a change', e.changedFile('studio_patch', 'Edited script.js (matched ignoring spacing)'));
ok('studio_lines Replaced/Inserted/Deleted are changes', e.changedFile('studio_lines', 'Replaced lines 3-5 with 2 line(s) in a.js') && e.changedFile('studio_lines', 'Inserted 1 line(s) before line 4 in a.js') && e.changedFile('studio_lines', 'Deleted lines 2-2 in a.js'));
ok('studio_create and studio_delete count', e.changedFile('studio_create', 'Created project zoo') && e.changedFile('studio_delete', 'Deleted old.js'));
ok('a FAILED edit is not a change', !e.changedFile('studio_patch', 'Tool error: the text to replace was not found in a.js') && !e.changedFile('studio_write', 'Tool error: no such project'));
ok('reading is never a change', !e.changedFile('studio_read', 'Saved the planet') && !e.changedFile('studio_files', 'Created a list') && !e.changedFile('studio_check', 'Edited nothing') && !e.changedFile('studio_diagnose', 'Saved'));
ok('other tools are never a change', !e.changedFile('web_search', 'Saved') && !e.changedFile('calculator', 'Edited'));
ok('empty or odd results are not a change', !e.changedFile('studio_write', '') && !e.changedFile('studio_write', null) && !e.changedFile(undefined, 'Saved x') && !e.changedFile('studio_patch', 'Could not edit'));

// replies that CLAIM a change
for (const s of ["I added a cooldown timer to the UI.", "I've updated the HTML with a random message generator.", "I have now added a cooldown timer and a random message generator.",
  "The HTML for the \"ai_project\" UI has been enhanced with improved elements like a cooldown timer.", "The cooldown timer has been added to index.html.", "I just fixed the button and changed the colours.",
  "Done! I implemented the shop and wrote the script.", "The code is now updated.", "We've built the whole page for you.", "I successfully modified style.css."])
  ok('claim: ' + s.slice(0, 55), e.claimsEdit(s), s);
// replies that are NOT claims
for (const s of ["Want me to add a cooldown timer?", "I can add a timer if you like.", "You could add a cooldown to the button.", "I will update the HTML next.", "Let me know if you want a random message generator.",
  "To add a timer, use setInterval.", "Here is how to update the file: open index.html and edit line 3.", "What should I change first?", "That page has a cooldown timer already.", "Hello! How can I help with your project?",
  "I'd suggest adding a timer.", "", null, undefined])
  ok('not a claim: ' + String(s).slice(0, 55), !e.claimsEdit(s), s);
ok('code inside a block is an example, not a claim', !e.claimsEdit("Here is an example:\n```js\n// I added a timer\nlet added = true;\n```\nTell me if you want it."));
ok('inline code is ignored', !e.claimsEdit("Use `const added = true` to track it."));

// the decision
ok('claim + nothing written + Studio tools -> replaced', e.invented('I added a timer.', { changed: false, hasStudioTools: true }));
ok('claim + a file WAS written -> kept', !e.invented('I added a timer.', { changed: true, hasStudioTools: true }));
ok('no claim -> kept', !e.invented('Want me to add a timer?', { changed: false, hasStudioTools: true }));
ok('no Studio tools (plain chat) -> never touched', !e.invented('I added a timer.', { changed: false, hasStudioTools: false }));
ok('the replacement text says nothing was changed and how to ask', /haven't changed any files/.test(e.NO_EDIT_RAN) && /nothing new was added/.test(e.NO_EDIT_RAN));
ok('a very long reply is handled quickly', (() => { const t = Date.now(); e.claimsEdit('I added a thing. '.repeat(3000)); e.claimsEdit('word '.repeat(20000)); return Date.now() - t < 1500; })());
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
