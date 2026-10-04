#!/usr/bin/env node
// Keeps the website (docs/) in step with the app. Run before every release:  node scripts/sync-site.js
// 1. docs/models.json and web/models.json "local" = the FULL PC catalog (models.pc.json), so neither the site nor the PC app shows an old list.
// 2. docs/releases.json and web/releases.json = releases.json (version history and "latest").
// 3. package.json version must match releases.json "latest".
// Use --check to only verify (exit 1 if anything is out of date). The test suite runs this check.
const fs = require('fs'), path = require('path'); const root = path.join(__dirname, '..');
const rd = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')), wr = (f, o) => fs.writeFileSync(path.join(root, f), JSON.stringify(o, null, 1) + '\n');
const check = process.argv.includes('--check'); const problems = [];
const pc = rd('models.pc.json'), rel = rd('releases.json'), pkg = rd('package.json');
if (rel.latest !== pkg.version) problems.push(`releases.json latest (${rel.latest}) does not match package.json (${pkg.version})`);
if (!rel.releases.length || rel.releases[0].version !== rel.latest) problems.push('the first entry in releases.json must be the latest version');
for (const dir of ['docs', 'web']) {   // docs = the website (phones), web = the PC app: both must show the same newest models and version
  const site = rd(dir + '/models.json');
  if (JSON.stringify(pc) !== JSON.stringify(site.local)) { problems.push(`${dir}/models.json has ${(site.local || []).length} PC models, the app has ${pc.length}`); if (!check) { site.local = pc; wr(dir + '/models.json', site); } }
  let have = null; try { have = rd(dir + '/releases.json'); } catch {}
  if (JSON.stringify(rel) !== JSON.stringify(have)) { problems.push(`${dir}/releases.json is out of date`); if (!check) wr(dir + '/releases.json', rel); }
}
if (check) { if (problems.length) { console.log('Website is out of date:\n - ' + problems.join('\n - ') + '\nRun: node scripts/sync-site.js'); process.exit(1); } console.log('Website matches the app (' + pc.length + ' PC models, v' + rel.latest + ').'); }
else console.log(problems.length ? 'Updated the website: ' + problems.join('; ') : 'Already in sync.');
