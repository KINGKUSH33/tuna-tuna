const T = require('../app.js');
let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fail++; };
function tone(f, sr = 48000, n = 4096, noise = 0.005) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (let h = 1; h <= 8; h++) v += (h === 2 ? 1.2 : 1 / h) * Math.sin(2 * Math.PI * f * h * t + h); b[i] = 0.3 * Math.exp(-2 * t) * v + (Math.random() - 0.5) * noise; }
  return b;
}
// Sub-cent precision on slightly detuned strings.
for (const a4 of [432, 440, 446]) for (const [i, off] of [[0, 2], [2, -1.5], [5, 0.7]]) {
  const f = T.stringsFor(a4)[i].f * Math.pow(2, off / 1200);
  const r = T.detectPitch(tone(f), 48000); const c = r && T.nearestString(r.freq, a4).cents;
  check(`A4=${a4} string ${i} at ${off}c`, r && Math.abs(c - off) < 0.5, r ? `got ${c.toFixed(2)}c` : 'null');
}
check('A4 clamps to 432-446', T.clampA4(400) === 432 && T.clampA4(500) === 446 && T.clampA4('x') === 440);
check('A4=432 shifts A2 to 108 Hz', Math.abs(T.stringsFor(432)[1].f - 108) < 1e-9);
check('in-tune zone ±3c', T.isInTune(2.9) && T.isInTune(-3) && !T.isInTune(3.1) && !T.isInTune(null));
check('locked string folds octave harmonic', Math.abs(T.centsToString(164.81 * 1.001, 0, 440) - 1200 * Math.log2(1.001)) < 0.2);
check('chromatic note name', T.noteFromFreq(277.18).name === 'C♯' && T.noteFromFreq(440).oct === 4);
// Smoother: rejects short octave glitches, follows a sustained change, damps jitter.
let s = T.createSmoother(); for (let i = 0; i < 6; i++) s.push(110);
check('smoother ignores single octave glitch', Math.abs(s.push(220) - 110) < 0.01);
check('smoother ignores two-frame octave glitch', Math.abs(s.push(220) - 110) < 0.01);
s.push(220); check('smoother follows sustained new note', Math.abs(s.value - 220) < 1);
s = T.createSmoother(); let maxDev = 0;
for (let i = 0; i < 60; i++) { const v = s.push(110 * Math.pow(2, (Math.random() - 0.5) * 4 / 1200)); if (i > 10) maxDev = Math.max(maxDev, Math.abs(1200 * Math.log2(v / 110))); }
check('smoother damps ±2c jitter (under 1.8c)', maxDev < 1.8, `max ${maxDev.toFixed(2)}c`);
let fl = null; for (let i = 0; i < 50; i++) fl = T.updateNoiseFloor(fl, 0.004, false);
check('noise gate adapts to room', Math.abs(fl - 0.004) < 1e-4 && T.gateFor(fl) === 0.01 && T.gateFor(null) === 0.006);
process.exit(fail ? 1 : 0);
