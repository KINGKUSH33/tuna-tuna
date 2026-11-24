const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fail++;
};

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-web.js')], { cwd: root, stdio: 'inherit' });

const packed = [
  'index.html',
  'privacy.html',
  'app.js',
  'config.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/maskable.svg'
];
for (const file of packed) {
  const src = fs.readFileSync(path.join(root, file));
  const out = fs.readFileSync(path.join(root, 'www', file));
  check('www/' + file + ' matches source', src.equals(out));
}
check('www is gitignored', /(^|\n)www\/(\n|$)/.test(read('.gitignore')));

const cap = JSON.parse(read('capacitor.config.json'));
check('capacitor app id', cap.appId === 'com.kingkush33.tunatuna');
check('capacitor app name', cap.appName === 'Tuna Tuna');
check('capacitor webDir is www', cap.webDir === 'www' && !['dist', 'build', 'out'].includes(cap.webDir));
check('build script writes www only', read('scripts/build-web.js').includes("path.join(root, 'www')") && !/path\.join\(root,\s*'(dist|build|out)'\)/.test(read('scripts/build-web.js')));

const gradle = ['android/variables.gradle', 'android/app/build.gradle']
  .filter(file => fs.existsSync(path.join(root, file)))
  .map(read)
  .join('\n');
check('android project present', gradle.length > 0);
check('compileSdk 36', /compileSdk(Version)?\s*=\s*36/.test(gradle));
check('targetSdk 36', /targetSdk(Version)?\s*=\s*36/.test(gradle));
check('minSdk 24', /minSdk(Version)?\s*=\s*24/.test(gradle));
check('versionName 3.1.0', /versionName\s+"3\.1\.0"/.test(gradle));
check('versionCode set', /versionCode\s+30100/.test(gradle));

const manifest = read('android/app/src/main/AndroidManifest.xml');
check('RECORD_AUDIO permission', manifest.includes('android.permission.RECORD_AUDIO'));
check('microphone feature is optional',
  /<uses-feature\b[^>]*android:name="android\.hardware\.microphone"[^>]*android:required="false"/.test(manifest));

const activity = read('android/app/src/main/java/com/kingkush33/tunatuna/MainActivity.java');
check('webview permission request', activity.includes('onPermissionRequest'));
check('runtime record permission', activity.includes('ActivityCompat.requestPermissions') && activity.includes('RECORD_AUDIO'));
check('external view intent', activity.includes('Intent.ACTION_VIEW'));

const workflow = read('.github/workflows/android-release.yml');
check('workflow dispatch and tags', /workflow_dispatch/.test(workflow) && /tags:/.test(workflow) && /v\*/.test(workflow));
check('workflow tests, packs, and syncs',
  workflow.includes('npm test') && workflow.includes('npm run build:web') && workflow.includes('npx cap sync android'));
check('workflow builds debug apk and release bundle',
  workflow.includes('assembleDebug') && workflow.includes('bundleRelease'));
check('workflow signing secrets',
  ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].every(name => workflow.includes(name)));

const pkg = JSON.parse(read('package.json'));
check('package version 3.1.0', pkg.version === '3.1.0');
check('build:web script', pkg.scripts['build:web'] === 'node scripts/build-web.js');

process.exit(fail ? 1 : 0);
