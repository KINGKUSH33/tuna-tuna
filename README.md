# Tuna Tuna

An analog-style guitar tuner for the browser (standard E: E2 A2 D3 G3 B3 E4). Pitch detection runs locally from your microphone using the Web Audio API and a plain-JS McLeod Pitch Method (NSDF, key-maxima peak picking, parabolic interpolation), with an RMS noise gate and a clarity threshold. No build step, no libraries.

## Run

    cd needle && python3 -m http.server 8000
    # or: npx serve

Open http://localhost:8000 and press **Start tuner**.

- `getUserMedia` only works on **localhost or HTTPS**.
- **Microphone permission is required**; the browser will prompt.

## Test

    node tests/detect.test.js
