// Max brain choice: official cloud, or a free local AI on the PC. Pure logic.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
(async () => {
  const m = await import('../web/maxbrain.js');
  ok('nothing saved means the official cloud brain', m.readBrain(null).mode === 'cloud' && m.readBrain(undefined).mode === 'cloud' && m.readBrain('').mode === 'cloud');
  ok('broken saved data means cloud, never a crash', m.readBrain('{nope').mode === 'cloud' && m.readBrain('42').mode === 'cloud' && m.readBrain('[]').mode === 'cloud');
  ok('a saved local brain is read back', JSON.stringify(m.readBrain(m.saveBrain({ mode: 'local', model: 'gguf:qwen2.5-1.5b' }))) === '{"mode":"local","model":"gguf:qwen2.5-1.5b"}');
  ok('a local choice without a model becomes cloud', m.saveBrain({ mode: 'local' }) === '{"mode":"cloud"}');
  for (const evil of ['cpu:x', 'web:x', 'cloud:pholama', 'byok:k', '../../etc', 'gguf:', 'gguf:a b', '']) ok('a phone, cloud, key or junk model is never accepted as the local brain: "' + evil + '"', m.readBrain({ mode: 'local', model: evil }).mode === 'cloud');
  ok('only PC models are offered as local brains', JSON.stringify(m.localChoices([{ id: 'gguf:a', name: 'A' }, { id: 'ollama:b' }, { id: 'cpu:c' }, { id: 'web:d' }, { id: 'cloud:pholama' }, null, {}]).map(x => x.id)) === '["gguf:a","ollama:b"]');
  const inst = ['gguf:a', 'gguf:b'];
  ok('cloud brain runs the cloud', m.resolveBrain({ brain: { mode: 'cloud' }, isPc: true, installed: inst }).run === 'cloud');
  let r = m.resolveBrain({ brain: { mode: 'local', model: 'gguf:b' }, isPc: true, installed: inst });
  ok('a local brain on the PC runs locally, on that model', r.run === 'local' && r.model === 'gguf:b' && /Free and unlimited/.test(r.note), JSON.stringify(r));
  r = m.resolveBrain({ brain: { mode: 'local', model: 'gguf:gone' }, isPc: true, installed: inst });
  ok('if the chosen AI was deleted, Max safely uses the cloud and says why', r.run === 'cloud' && /not installed/.test(r.note), JSON.stringify(r));
  r = m.resolveBrain({ brain: { mode: 'local', model: 'gguf:a' }, isPc: false, installed: inst });
  ok('on the website a local brain cannot run, so cloud is used and the page says so', r.run === 'cloud' && /PC app/.test(r.note), JSON.stringify(r));
  ok('the choices list starts with the official cloud brain', m.brainChoices([{ id: 'gguf:a', name: 'A' }])[0].value === 'cloud' && m.brainChoices([{ id: 'gguf:a', name: 'A' }]).length === 2);
  ok('a local choice says it is free and only as smart as the model', /Free and unlimited/.test(m.brainChoices([{ id: 'gguf:a', name: 'A' }])[1].help) && /Only as smart/.test(m.brainChoices([{ id: 'gguf:a', name: 'A' }])[1].help));
  ok('a model that cannot run tools gets a Studio warning', /cannot use tools/.test(m.brainWarning('gguf:t', [{ id: 'gguf:t', tools: false }])) && m.brainWarning('gguf:t', [{ id: 'gguf:t', tools: true }]) === '' && m.brainWarning('cloud', []) === '');
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
