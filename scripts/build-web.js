/* Copy the static site into www/ for Capacitor. Source of truth stays at the repo root. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const files = [
  'index.html',
  'privacy.html',
  'app.js',
  'config.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest'
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
