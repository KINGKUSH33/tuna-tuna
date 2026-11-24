const T = require('../app.js');
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fail++;
};

// --- Raw mic constraints (voice processing must stay off) ---
check('mic requests raw guitar audio',
  T.MIC_CONSTRAINTS.echoCancellation === false &&
  T.MIC_CONSTRAINTS.noiseSuppression === false &&
  T.MIC_CONSTRAINTS.autoGainControl === false);
check('range covers 55 Hz through 1200 Hz', T.MIN_FREQ <= 55 && T.MAX_FREQ >= 1200);

// --- Instant pluck + hysteresis sustain ---
const floors = [null, 0.002, 0.004, 0.01, 0.02];
floors.forEach(fl => {
  const th = T.gateThresholds(fl);
  check('hysteresis floor ' + fl, th.sustainRms < th.attackRms && th.sustainClarity < th.attackClarity && th.confirmFrames === 1,
    `attack ${th.attackRms.toFixed(4)} sustain ${th.sustainRms.toFixed(4)}`);
});

const th = T.gateThresholds(null);
const quiet = {
  freq: 82.46,
  rms: th.sustainRms + (th.attackRms - th.sustainRms) * 0.35,
  clarity: th.sustainClarity + (th.attackClarity - th.sustainClarity) * 0.45
};
check('quiet frame is inside the sustain band',
  quiet.rms < th.attackRms && quiet.rms >= th.sustainRms &&
  quiet.clarity < th.attackClarity && quiet.clarity >= th.sustainClarity);

let tr = T.createTracker();
for (let i = 0; i < 6; i++) {
  const r = tr.push(quiet, i * 32);
  if (r.voiced) check('quiet frames never accumulate into a lock', false);
}
check('quiet frames never accumulate into a lock', true);
const pluck = { freq: 82.41, rms: Math.max(0.05, th.attackRms * 3), clarity: 0.93 };
let hit = tr.push(pluck, 200);
check('one pluck frame locks immediately', hit.voiced && hit.onset && hit.fresh && hit.freq === 82.41);

const held = tr.push(quiet, 240);
check('quiet decay stays tracked after lock', held.voiced && held.fresh && !held.holding && held.freq === quiet.freq);

const trFresh = T.createTracker();
check('same quiet frame does not start a note', !trFresh.push(quiet, 0).voiced);

const below = { freq: 82.41, rms: th.sustainRms * 0.25, clarity: 0.2 };
const holding = tr.push(below, 240 + 180);
check('display holds the note as it fades', holding.voiced && holding.holding && !holding.fresh && holding.freq === quiet.freq);
const still = tr.push(null, 240 + th.releaseMs);
check('hold lasts through the release window', still.voiced && still.holding);
const dropped = tr.push(null, 240 + th.releaseMs + 5);
check('note clears after the short hold', !dropped.voiced && dropped.freq == null);

// A new loud pluck during the hold is a fresh note, not stuck on the old one.
tr = T.createTracker();
tr.push(pluck, 0);
tr.push(null, 80);
const next = tr.push({ freq: 146.83, rms: th.attackRms * 4, clarity: 0.9 }, 160);
check('new pluck during the hold locks immediately', next.voiced && next.fresh && Math.abs(next.freq - 146.83) < 1e-9);

// --- Pitch accuracy ±1¢ and low-string harmonic immunity ---
function mix(f, sr, amps, n) {
  const b = new Float32Array(n || 4096);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= amps.length; h++) v += amps[h - 1] * Math.sin(2 * Math.PI * f * h * t + h * 0.17);
    b[i] = 0.24 * v;
  }
  return b;
}
function centsOff(target, detected) {
  return detected ? 1200 * Math.log2(detected / target) : null;
}
const pitches = [55, 65.406, 73.416, 82.407, 110, 146.832, 196, 246.942, 329.628, 440, 880, 1200];
for (const sr of [44100, 48000]) {
  for (const f0 of pitches) {
    for (const off of [-1, 0, 1]) {
      const f = f0 * Math.pow(2, off / 1200);
      const r = T.detectPitch(mix(f, sr, [1, 0.55, 0.3, 0.16, 0.08]), sr);
      const err = centsOff(f, r && r.freq);
      check(`±1¢ ${sr} ${f0}Hz ${off}c`, err != null && Math.abs(err) < 1, err == null ? 'null' : err.toFixed(2) + 'c');
    }
  }
}
const lows = [
  ['E2', T.midiToFreq(40, 440)],
  ['A2', T.midiToFreq(45, 440)],
  ['D3', T.midiToFreq(50, 440)]
];
const spectra = {
  '2×': [0.2, 1.8, 0.55, 0.28, 0.14],
  '3×': [0.16, 0.32, 1.6, 0.4, 0.18],
  '2×+3×': [0.18, 1.4, 1.25, 0.4, 0.2]
};
for (const sr of [44100, 48000]) {
  for (const [name, f0] of lows) {
    for (const kind of Object.keys(spectra)) {
      const r = T.detectPitch(mix(f0, sr, spectra[kind]), sr);
      const err = centsOff(f0, r && r.freq);
      check(`${name} ${kind} ${sr} stays on the fundamental`, err != null && Math.abs(err) < 1, err == null ? 'null' : err.toFixed(2) + 'c');
    }
  }
}

// --- Cents readout ---
check('cents format +1.4', T.formatCents(1.36) === '+1.4¢');
check('cents format 0.0', T.formatCents(0.04) === '0.0¢' && T.formatCents(-0.02) === '0.0¢');
check('cents format −1.4', T.formatCents(-1.44) === '−1.4¢');

// --- Chromatic mapping: 12 pitch classes and octaves, at the chosen A4 ---
for (const a4 of [432, 440, 446]) {
  for (let pc = 0; pc < 12; pc++) {
    for (const oct of [2, 3, 4, 5]) {
      const midi = (oct + 1) * 12 + pc;
      const f = T.midiToFreq(midi, a4);
      const n = T.noteFromFreq(f, a4);
      if (!(n.name === T.NOTE_NAMES[pc] && n.oct === oct && n.midi === midi && Math.abs(n.cents) < 0.05)) {
        check(`chromatic ${a4} ${T.NOTE_NAMES[pc]}${oct}`, false, JSON.stringify(n));
      }
    }
  }
  check(`chromatic ${a4} all 12 classes × octaves 2–5`, true);
}
const sharp = T.midiToFreq(64, 446) * Math.pow(2, 1.4 / 1200);
const sharpNote = T.noteFromFreq(sharp, 446);
check('chromatic +1.4¢ reads E4', sharpNote.name === 'E' && sharpNote.oct === 4 && Math.abs(sharpNote.cents - 1.4) < 0.05 && T.formatCents(sharpNote.cents) === '+1.4¢',
  T.formatCents(sharpNote.cents) + ' ' + sharpNote.cents.toFixed(3));
check('A4 follows calibration', T.noteFromFreq(432, 432).name === 'A' && T.noteFromFreq(432, 432).oct === 4 && Math.abs(T.noteFromFreq(432, 432).cents) < 0.01);

// --- Tuning presets ---
const expectMidi = {
  standard: [40, 45, 50, 55, 59, 64],
  dropd: [38, 45, 50, 55, 59, 64],
  half: [39, 44, 49, 54, 58, 63],
  openg: [38, 43, 50, 55, 59, 62],
  dadgad: [38, 45, 50, 55, 57, 62]
};
Object.keys(expectMidi).forEach(id => {
  const notes = T.TUNINGS[id].notes;
  const midis = notes.map(n => n.midi);
  const strings = T.stringsFor(440, id);
  const midiOk = midis.length === 6 && midis.every((m, i) => m === expectMidi[id][i]);
  const freqOk = strings.every((s, i) => Math.abs(s.f - T.midiToFreq(expectMidi[id][i], 440)) < 1e-9 && s.name === notes[i].name);
  check(`preset ${T.TUNINGS[id].label}`, midiOk && freqOk, midis.join(','));
});
check('half-step uses flats', T.stringsFor(440, 'half').map(s => s.name).join(' ') === 'E♭ A♭ D♭ G♭ B♭ E♭');
const lowD = T.midiToFreq(38, 440);
const drop = T.nearestString(lowD, 440, 'dropd');
check('Drop D low string is string 1', drop.index === 0 && Math.abs(drop.cents) < 0.01);
check('A4 scales a preset', Math.abs(T.stringsFor(432, 'openg')[1].f / T.stringsFor(440, 'openg')[1].f - 432 / 440) < 1e-12);

// --- Reference tone frequency math + mute tail ---
Object.keys(T.TUNINGS).forEach(id => {
  for (let i = 0; i < 6; i++) {
    for (const a4 of [432, 440, 446]) {
      const f = T.referenceFreq(i, a4, id);
      const want = T.midiToFreq(T.TUNINGS[id].notes[i].midi, a4);
      if (!(Math.abs(f - want) < 1e-9)) check(`reference ${id} ${i} A4=${a4}`, false, f + ' vs ' + want);
    }
  }
});
check('reference freqs match string targets at 432/440/446', true);
check('reference mute covers the tone plus a tail',
  T.REFERENCE_TAIL_MS >= 250 && T.referenceMuteMs() === T.REFERENCE_PLAY_MS + T.REFERENCE_TAIL_MS && T.referenceMuteMs() > T.REFERENCE_PLAY_MS);

// --- Level meter ---
check('silence meter is empty', T.signalRms(new Float32Array(2048)) === 0 && T.meterLevel(0) === 0);
const sine = new Float32Array(4800);
for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(2 * Math.PI * 110 * i / 48000);
const rms = T.signalRms(sine);
check('sine rms ~ 0.707', Math.abs(rms - Math.SQRT1_2) < 0.01, rms.toFixed(4));
check('meter rises with level', T.meterLevel(0.004) < T.meterLevel(0.02) && T.meterLevel(0.02) < T.meterLevel(0.2) && T.meterLevel(1) === 1);

// --- Six-string sweep still completes ---
let st = T.newSweep(), success = null, t = 0;
for (const idx of [0, 1, 2, 3, 4, 5]) {
  for (let d = 0; d <= 80; d += 40) {
    const r = T.sweepStep(st, { index: idx, cents: 0.4, t: t + d });
    st = r.state;
    if (r.event === 'success') success = r;
  }
  t += 400;
}
check('six-string sweep celebrates in order', success && success.ordered === true && success.confirmed.length === 6);

process.exit(fail ? 1 : 0);
