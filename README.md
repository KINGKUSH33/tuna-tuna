# Tuna Tuna

An analog-style guitar tuner for the browser (standard E: E2 A2 D3 G3 B3 E4). Pitch detection runs locally from your microphone using the Web Audio API and a plain-JS McLeod Pitch Method (NSDF, key-maxima peak picking, parabolic interpolation), with an RMS noise gate and a clarity threshold. No build step, no libraries.

## Run

    cd needle && python3 -m http.server 8000
    # or: npx serve

Open http://localhost:8000 and press **Start tuner**.

- `getUserMedia` only works on **localhost or HTTPS**.
- **Microphone permission is required**; the browser will prompt.

## Test

    npm test

## v2
- Installable PWA (manifest + offline service worker), relative paths for GitHub Pages `/tuna-tuna/`.
- Precision: parabolic-interpolated MPM, median + adaptive EMA smoothing, octave-glitch rejection, adaptive noise gate, 55 Hz high-pass, adjustable A4 (432–446 Hz, saved), ±3¢ in-tune zone.
- UI: coloured gauge with spring needle, tune up/down hints, Auto or locked string selection, haptic buzz when in tune, screen-reader announcements.
- Tests: `npm test`

## v2.1
- Cleaner UI: larger note and direction pill (Tune up / Tune down / In tune), six easy-tap string buttons with sweep progress lights, Auto-detect tucked into the row header, A4 still in a compact settings pill.
- Steadier pitch: lower 62 Hz floor so a flat E2 still reads, 3×-lag octave correction for harmonic-rich low strings, 3-frame jump confirmation, slightly calmer EMA, clarity 0.84 on brief plucks, longer FFT at high sample rates.
- Easier six-string celebration: a brief in-tune pluck counts, the 20s window rolls forward on each new string, and a colorful sage/gold/coral/sky paint-splatter burst says “All six strings in tune!”.
