// The Live Activity card's brain: title, thought, files touched, and how it ends.
(async () => {
  const { createLiveModel } = await import('../web/studiolive.js');
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + JSON.stringify(x))); if (!c) bad++; };
  const m = createLiveModel(), s = m.state;
  m.thought('ignored before begin'); m.start({ kind: 'edit', file: 'a.js', text: 'Editing a.js' });
  ok('nothing shows before a job begins', s().phase === 'idle' && s().files.length === 0 && s().thought === '', s());
  m.begin(); ok('a job starts in Thinking', s().phase === 'thinking' && s().title === 'Thinking');
  m.thought('I will add a button\n   to the header, then style it'); ok('the thought is shown on one line', s().thought === 'I will add a button to the header, then style it', s().thought);
  m.thought('x'.repeat(500)); ok('a long thought is cut short', s().thought.length <= 140 && s().thought.endsWith('\u2026'), s().thought.length);
  m.start({ kind: 'look', file: 'index.html', text: 'Reading index.html' }); ok('reading a file shows its name', s().phase === 'look' && s().title === 'Reading index.html' && s().files.length === 1, s());
  m.finish({ kind: 'look', file: 'index.html' }); ok('that file is marked done, and it goes back to Thinking', s().files[0].done === true && s().phase === 'thinking', s());
  m.start({ kind: 'edit', file: 'style.css', text: 'Editing style.css' }); m.start({ kind: 'edit', file: 'app.js', text: 'Editing app.js' });
  ok('two edits at once are both listed', s().files.length === 3 && s().open === 2, s());
  m.finish({ kind: 'edit', file: 'style.css' }); ok('finishing one keeps the card busy for the other', s().open === 1 && s().phase === 'edit' && s().files[1].done && !s().files[2].done, s());
  m.start({ kind: 'edit', file: 'app.js', text: 'Editing app.js' }); ok('the same file is not listed twice', s().files.filter(f => f.name === 'app.js').length === 1, s().files);
  m.finish({ kind: 'edit', file: 'app.js' }); m.finish({ kind: 'edit', file: 'app.js' }); m.finish({ kind: 'edit', file: 'app.js' });
  ok('extra finishes never push the counter below zero', s().open === 0, s().open);
  ok('the summary counts changed files, not read files', m.summary() === 'Changed 2 files', m.summary());
  m.end(); ok('ending clears the title and marks everything done', s().phase === 'idle' && s().title === '' && s().files.every(f => f.done), s());
  const n = createLiveModel(); n.begin(); n.start({ kind: 'test', file: '', text: 'Testing your code' }); ok('a tool without a file still shows a title and adds no empty row', n.state().title === 'Testing your code' && n.state().files.length === 0, n.state());
  ok('no summary when nothing was edited', (n.end(), n.summary()) === 'Changed 0 files' ? false : n.summary() === '', n.summary());
  const o = createLiveModel(); o.begin(); o.start({ kind: 'edit', file: 'only.js', text: 'Editing only.js' }); ok('one edited file reads correctly', o.summary() === 'Changed 1 file', o.summary());
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
