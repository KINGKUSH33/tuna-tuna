# Tuna Tuna

A studio guitar tuner for the browser. Pitch detection runs on your microphone with the Web Audio API and a plain-JS McLeod Pitch Method (NSDF, key-maxima peak picking, parabolic interpolation). No build step, no libraries. Paths are relative so it serves from GitHub Pages at `/tuna-tuna/`.

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

## v2.1

- Cleaner stage UI, 62 Hz floor, octave correction, rolling 20s six-string celebration.

## v2

- Installable PWA, median + EMA smoothing, adaptive noise gate, ±3¢ in-tune zone.
