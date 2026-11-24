# Tuna Tuna

A studio guitar tuner for the browser. Pitch detection runs on your microphone with the Web Audio API and a plain-JS McLeod Pitch Method (NSDF, key-maxima peak picking, parabolic interpolation). The site at the repository root has no bundler. Paths are relative so it serves from GitHub Pages at `/tuna-tuna/`.

## Run

```
python3 -m http.server 8000
```

Open http://localhost:8000 and press **Start tuner**.

- `getUserMedia` only works on **localhost or HTTPS**.
- **Microphone permission is required**; the browser will prompt.
- The tuner asks for raw guitar audio: echo cancellation, noise suppression, and auto gain are off.

## Test

```
npm test
```

## v3 Pro

- Instant pluck pickup and a hysteresis gate so a ringing string stays tracked as it gets quiet, then a short display hold as it fades. Live mic level meter.
- Studio pitch from about 55 Hz through 1200 Hz, within ±1 cent, including wound low strings with strong 2nd/3rd harmonics. Needle runs at display rate. Cents read like `+1.4¢`. A4 is adjustable from 432–446 Hz and saved.
- Guitar mode: Standard, Drop D, Half-Step Down, Open G, DADGAD, Auto or locked strings, and the six-string sage/gold/coral/sky sweep.
- Chromatic mode: all 12 pitch classes and the octave.
- Plucked reference tone per string (and for the chromatic note), using the chosen A4. The mic is ignored while the tone plays, plus a short tail.
- Service worker cache `tuna-tuna-v3`, so a refresh replaces v2.1.

## v3.1

- Service worker cache `tuna-tuna-v3.1`, including `privacy.html` and `config.js`.
- Same site at the repo root for GitHub Pages. `npm run build:web` copies it into `www/` for Capacitor.
- Android app `com.kingkush33.tunatuna`, version 3.1.0, `minSdk` 24, `compileSdk` / `targetSdk` 36.
- Microphone explanation before the first prompt. Audio stays on the device.
- Privacy policy at `privacy.html`.
- Optional tip jar. The link lives in `config.js`.

## Android

The Pages site is still `index.html` and the other files at the repository root. Capacitor packages a copy.

```
npm test
npm run build:web
npx cap sync android
```

### Tip jar

Open `config.js` and set `TIP_JAR_URL` to your PayPal.me or Ko-fi link. Leave it as `""` until you have one. The button reads **Tip the developer**. A tip is optional, goes to you, and unlocks nothing. Do not use Google Play Billing for it, and do not label the button as a charity contribution. After you change the URL on a site people already installed, bump `CACHE` in `sw.js`.

### Signed release

Create an upload keystore, then add these GitHub Actions secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 your-upload.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Run **Android release** from the Actions tab, or push a `v*` tag. The workflow runs the tests, packs `www/`, syncs Capacitor, and uploads a debug APK plus a release app bundle. With all four secrets set, the bundle is signed. Without them, the bundle is unsigned and the debug APK is still produced. `versionName` is `3.1.0` and `versionCode` is `30100`.

## v2.1

- Cleaner stage UI, 62 Hz floor, octave correction, rolling 20s six-string celebration.

## v2

- Installable PWA, median + EMA smoothing, adaptive noise gate, ±3¢ in-tune zone.
