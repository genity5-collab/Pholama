// Bundles a cloud function and its sibling modules into ONE self-contained file for deployment.
// Usage: node build/bundle.js pholamaSiteStudio   ->   build/out/pholamaSiteStudio.js
const esbuild = require('esbuild'), path = require('path'), fs = require('fs');
const name = process.argv[2]; if (!name) { console.error('name a function'); process.exit(1); }
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const r = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'functions', name + '.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'], outfile: path.join(out, name + '.js'), logLevel: 'error', legalComments: 'none', external: [], minify: !!process.env.MIN, minifyWhitespace: !!process.env.MIN, minifySyntax: !!process.env.MIN });
const size = fs.statSync(path.join(out, name + '.js')).size; console.log(name + '.js ' + (size / 1024).toFixed(1) + ' KB');
