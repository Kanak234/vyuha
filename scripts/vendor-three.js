// Copies the three.js build into media/ so the webview can load it locally.
// Webviews get no network access under our CSP, so the library ships with the
// extension instead of coming from a CDN.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.min.js');
const dst = path.join(__dirname, '..', 'media', 'three.min.js');

if (!fs.existsSync(src)) {
  console.error('three.js not found at ' + src);
  console.error('Run `npm install` first — it installs three@0.128.0 as a dev dependency.');
  process.exit(1);
}
fs.copyFileSync(src, dst);
console.log('Vendored three.js -> media/three.min.js (' + (fs.statSync(dst).size / 1024).toFixed(0) + ' kB)');
