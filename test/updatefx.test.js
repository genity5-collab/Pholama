// Update animations: which releases count as new, who gets the celebration, the installing steps, and the wiring.
const fs = require('fs'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
(async () => {
  const m = await import(path.join(__dirname, '..', 'web', 'updatefx.js'));
  const { cmpVer, newSince, shouldCelebrate, progress, STEPS, tidyNotes } = m;
  // version order
  ok('0.9.14 is newer than 0.9.9 (numbers, not text)', cmpVer('0.9.14', '0.9.9') === 1);
  ok('0.10.0 is newer than 0.9.99', cmpVer('0.10.0', '0.9.99') === 1);
  ok('equal versions compare equal', cmpVer('1.2.3', '1.2.3') === 0);
  ok('1.0 equals 1.0.0', cmpVer('1.0', '1.0.0') === 0);
  ok('older is -1', cmpVer('0.8.0', '0.9.0') === -1);
  ok('junk never throws', (() => { try { cmpVer(null, undefined); cmpVer('abc', '1'); return true; } catch { return false; } })());
  // which releases are new
  const R = ['0.9.14', '0.9.13', '0.9.12', '0.9.11', '0.9.10', '0.9.9', '0.9.8'].map(v => ({ version: v, title: 't' + v, notes: ['n'] }));
  ok('from 0.9.11 to 0.9.14 shows 0.9.12, .13, .14 newest first', newSince(R, '0.9.11', '0.9.14').map(r => r.version).join() === '0.9.14,0.9.13,0.9.12');
  ok('does not show the version you already saw', !newSince(R, '0.9.13', '0.9.14').some(r => r.version === '0.9.13'));
  ok('does not show versions newer than the one you run', !newSince(R, '0.9.9', '0.9.12').some(r => r.version === '0.9.14'));
  ok('a big jump is capped at 5 so the card stays short', newSince(R, '0.9.0', '0.9.14').length === 5);
  ok('nothing new -> empty', newSince(R, '0.9.14', '0.9.14').length === 0);
  ok('bad input is safe', newSince(null, '1', '2').length === 0 && newSince([null, {}], '1', '2').length === 0);
  // who gets the celebration
  ok('an upgrade with news celebrates', shouldCelebrate('0.9.11', '0.9.14', [{}]) === true);
  ok('a brand new device (nothing seen) does not', shouldCelebrate(null, '0.9.14', [{}]) === false);
  ok('same version does not', shouldCelebrate('0.9.14', '0.9.14', [{}]) === false);
  ok('a downgrade does not', shouldCelebrate('0.9.14', '0.9.12', [{}]) === false);
  ok('an upgrade with no notes does not open an empty card', shouldCelebrate('0.9.11', '0.9.14', []) === false);
  // installing steps
  ok('there are 4 steps', STEPS.length === 4);
  ok('progress goes 0,25,50,75,100', [0, 1, 2, 3, 4].map(i => progress(i)).join() === '0,25,50,75,100');
  ok('progress never goes below 0 or above 100', progress(-3) === 0 && progress(99) === 100);
  // notes
  ok('long notes are trimmed with an ellipsis', tidyNotes(['x'.repeat(400)])[0].length <= 140 && tidyNotes(['x'.repeat(400)])[0].endsWith('\u2026'));
  ok('at most 6 notes per release', tidyNotes(Array.from({ length: 20 }, (_, i) => 'n' + i)).length === 6);
  ok('empty and non-text notes are dropped', tidyNotes(['a', '', '  ', 5, null, 'b']).join() === 'a,b');
  ok('notes that are not a list are safe', tidyNotes(undefined).length === 0 && tidyNotes('x').length === 0);
  // wiring
  const R2 = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8'), app = R2('web/app.js'), css = R2('web/style.css'), sw = R2('web/sw.js'), fx = R2('web/updatefx.js');
  ok('the app loads the update animations', /from '\.\/updatefx\.js'/.test(app));
  ok('Restart opens the installing scene and closes the banner', /hideBanner\(\); const scene = openInstalling\(version\)/.test(app));
  ok('the scene reports success before reloading', /scene\.done\(\);[^]*location\.reload\(\)/.test(app));
  ok('the scene shows a failure instead of hanging forever', /fail\('Could not restart from here'\)/.test(app) && /fail\('Pholama did not come back'\)/.test(app));
  ok('the celebration is checked at start-up', /checkCelebrate\(cur,/.test(app));
  ok('the new files work offline (service worker list)', /'studiofx\.js', 'updatefx\.js'/.test(sw));
  ok('all colours come from the theme (no fixed hex) in the update styles', !/\.(updb|upds|updn)[^{]*\{[^}]*#[0-9a-fA-F]{3,6}\b/.test(css.slice(css.indexOf('Update animations:'))));
  ok('every theme variable used in the update styles exists', (() => { const t = css.slice(css.indexOf('Update animations:')); const used = [...new Set([...t.matchAll(/var\(--([a-z]+)/g)].map(x => x[1]))]; const own = ['s', 'x', 'y', 'rot']; const root = css.split('\n')[0]; return used.filter(u => !own.includes(u) && !new RegExp('--' + u + ':').test(root)).length === 0; })());
  ok('motion is off for people who asked for less', /prefers-reduced-motion:reduce\)\{[^}]*\.updb/.test(css));
  ok('the celebration can be closed by Escape, Enter, a click outside or the button', /Escape/.test(fx) && /e\.target === o/.test(fx) && /updn-go/.test(fx));
  ok('what the user sees is escaped (release text cannot inject HTML)', /const esc = s =>/.test(fx) && !/\$\{r\.title\}|\$\{n\}/.test(fx));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
