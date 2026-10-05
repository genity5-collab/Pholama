let bad = 0;
const ok = (name, condition, extra) => { console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' -> ' + extra)); if (!condition) bad++; };
;(async () => {
const { findMentionQuery, pluginOptions, filterPluginOptions } = await import(require('path').join(__dirname, '..', 'web', 'mention-picker.js'));
const options = pluginOptions([
  { name: 'github_local_test', title: 'Local GitHub helper', what: 'Read a repo', on: false },
  { name: 'bad-name', title: 'Invalid slug' },
]);
ok('typing @ at the start opens an empty-query picker', findMentionQuery('@', 1)?.query === '');
ok('partial plugin mention is detected after whitespace', findMentionQuery('please run @sea', 15)?.query === 'sea');
ok('picker replaces the complete token when the caret is in its middle', (() => { const q = findMentionQuery('use @x_github next', 11); return !!q && q.start === 4 && q.query === 'x_gith' && q.end === 13; })());
ok('email addresses do not open the plugin picker', findMentionQuery('person@search.com', 17) === null);
ok('a bare @ inside a word is ignored', findMentionQuery('hello@', 6) === null);
ok('built-in and custom plugin options are shown', options.some(x => x.name === 'search' && x.kind === 'builtin') && options.some(x => x.name === 'x_github_local_test' && x.kind === 'custom'));
ok('disabled custom plugins are still selectable for an explicit one-message mention', options.find(x => x.name === 'x_github_local_test')?.off === true);
ok('invalid custom tool names are omitted', !options.some(x => x.title === 'Invalid slug'));
ok('partial names match custom plugin saved names without x_', filterPluginOptions(options, 'github_local').some(x => x.name === 'x_github_local_test'));
ok('partial names match the visible x_ tool spelling', filterPluginOptions(options, 'x_gith').some(x => x.name === 'x_github_local_test'));
ok('the option list is capped', filterPluginOptions(options, '', 2).length === 2);
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
