/* Tuna Tuna v3 Pro — studio guitar tuner. McLeod Pitch Method (NSDF) in plain JS. */
(function (root) {
  'use strict';

  const A4_MIN = 432, A4_MAX = 446, IN_TUNE_CENTS = 3;
  const MIN_FREQ = 50, MAX_FREQ = 1320;
  // Raw guitar: phone voice processing (echo cancel, noise suppression, AGC)
  // chokes a ringing string and is the main reason plucks feel late or die early.
  const MIC_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const REFERENCE_PLAY_MS = 1450, REFERENCE_TAIL_MS = 400;
  const SWEEP_HOLD_MS = 40, SWEEP_WINDOW_MS = 20000;
  const SPLAT_COLORS = ['#7dca8e', '#6fb383', '#5aa872', '#e7a75b', '#f0c45c', '#d4923a', '#ee7a5f', '#e06c5c', '#f09580', '#5eb7e5', '#7ec8ea', '#4aa3d8'];
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  const TUNINGS = {
    standard: { id: 'standard', label: 'Standard E', notes: [
      { name: 'E', oct: 2, midi: 40 }, { name: 'A', oct: 2, midi: 45 }, { name: 'D', oct: 3, midi: 50 },
      { name: 'G', oct: 3, midi: 55 }, { name: 'B', oct: 3, midi: 59 }, { name: 'E', oct: 4, midi: 64 }
    ]},
    dropd: { id: 'dropd', label: 'Drop D', notes: [
      { name: 'D', oct: 2, midi: 38 }, { name: 'A', oct: 2, midi: 45 }, { name: 'D', oct: 3, midi: 50 },
      { name: 'G', oct: 3, midi: 55 }, { name: 'B', oct: 3, midi: 59 }, { name: 'E', oct: 4, midi: 64 }
    ]},
    half: { id: 'half', label: 'Half-Step Down', notes: [
      { name: 'E♭', oct: 2, midi: 39 }, { name: 'A♭', oct: 2, midi: 44 }, { name: 'D♭', oct: 3, midi: 49 },
      { name: 'G♭', oct: 3, midi: 54 }, { name: 'B♭', oct: 3, midi: 58 }, { name: 'E♭', oct: 4, midi: 63 }
    ]},
    openg: { id: 'openg', label: 'Open G', notes: [
      { name: 'D', oct: 2, midi: 38 }, { name: 'G', oct: 2, midi: 43 }, { name: 'D', oct: 3, midi: 50 },
      { name: 'G', oct: 3, midi: 55 }, { name: 'B', oct: 3, midi: 59 }, { name: 'D', oct: 4, midi: 62 }
    ]},
    dadgad: { id: 'dadgad', label: 'DADGAD', notes: [
      { name: 'D', oct: 2, midi: 38 }, { name: 'A', oct: 2, midi: 45 }, { name: 'D', oct: 3, midi: 50 },
      { name: 'G', oct: 3, midi: 55 }, { name: 'A', oct: 3, midi: 57 }, { name: 'D', oct: 4, midi: 62 }
    ]}
  };

  const clampA4 = a4 => { a4 = Number(a4); return isFinite(a4) ? Math.min(A4_MAX, Math.max(A4_MIN, a4)) : 440; };
  const midiToFreq = (midi, a4) => clampA4(a4 || 440) * Math.pow(2, (midi - 69) / 12);
  function tuningSpec(tuning) { return (typeof tuning === 'string' && TUNINGS[tuning]) || TUNINGS.standard; }
  function stringsFor(a4, tuning) {
    return tuningSpec(tuning).notes.map(s => ({ name: s.name, oct: s.oct, midi: s.midi, f: midiToFreq(s.midi, a4) }));
  }
  const STRINGS = stringsFor(440).map(s => Object.assign({}, s, { f: Math.round(s.f * 100) / 100 }));

  function formatCents(c) {
    const v = Math.round(Number(c) * 10) / 10;
    if (!isFinite(v) || Math.abs(v) < 0.05) return '0.0¢';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '¢';
  }

  function signalRms(buf) {
    const n = buf.length;
    if (!n) return 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += buf[i];
    mean /= n;
    let ss = 0;
    for (let i = 0; i < n; i++) { const d = buf[i] - mean; ss += d * d; }
    return Math.sqrt(ss / n);
  }

  // Map RMS to 0..1. Quiet room noise sits near the bottom; a real pluck climbs the meter.
  function meterLevel(rms) {
    if (!(rms > 0)) return 0;
    const t = (20 * Math.log10(rms) + 54) / 42;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // Pure detector: returns {freq, clarity, rms} or null.
  function detectPitch(buf, sampleRate, opts) {
    opts = opts || {};
    const minF = opts.minFreq || MIN_FREQ, maxF = opts.maxFreq || MAX_FREQ;
    const rmsGate = opts.rmsThreshold != null ? opts.rmsThreshold : 0.01;
    const clarityMin = opts.clarityThreshold != null ? opts.clarityThreshold : 0.8;
    const k = opts.peakK || 0.9;
    const n = buf.length;
    let mean = 0; for (let i = 0; i < n; i++) mean += buf[i]; mean /= n;
    const x = new Float32Array(n); let ss = 0;
    for (let i = 0; i < n; i++) { x[i] = buf[i] - mean; ss += x[i] * x[i]; }
    const rms = Math.sqrt(ss / n);
    if (rms < rmsGate) return null;
    const minLag = Math.max(2, Math.floor(sampleRate / maxF));
    // Analyse a little below the output floor so a 3×-lag octave check can run
    // on mid-range strings (D3) without changing the reporting floor.
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / Math.min(minF, 45)));
    const nsdf = new Float32Array(maxLag + 2);
    for (let tau = 0; tau <= maxLag + 1; tau++) {
      let acf = 0, m = 0;
      for (let i = 0; i < n - tau; i++) { const a = x[i], b = x[i + tau]; acf += a * b; m += a * a + b * b; }
      nsdf[tau] = m > 0 ? 2 * acf / m : 0;
    }
    const peaks = []; let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    while (tau < maxLag) {
      while (tau < maxLag && nsdf[tau] <= 0) tau++;
      let best = -1, bi = -1;
      while (tau < maxLag && nsdf[tau] > 0) {
        if (nsdf[tau] > best && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) { best = nsdf[tau]; bi = tau; }
        tau++;
      }
      if (bi >= minLag) peaks.push(bi);
    }
    if (!peaks.length) return null;
    let maxV = 0; for (const p of peaks) maxV = Math.max(maxV, nsdf[p]);
    const thr = k * maxV;
    let chosen = peaks.find(p => nsdf[p] >= thr);
    if (chosen == null) return null;
    // If a strong peak sits at ~2× lag and the 3× lag peak of the current
    // choice is weak, the short lag is likely an octave-up harmonic (common
    // on harmonic-rich E2/A2 plucks). Prefer the lower guitar fundamental.
    const near = target => {
      const tol = Math.max(2, Math.round(target * 0.04));
      let best = -1, bd = Infinity;
      for (const p of peaks) { const d = Math.abs(p - target); if (d < bd && d <= tol) { bd = d; best = p; } }
      return best;
    };
    const twice = near(chosen * 2);
    if (twice > 0 && chosen * 3 <= maxLag - 1) {
      const thrice = near(chosen * 3);
      const c1 = nsdf[chosen], c2 = nsdf[twice], c3 = thrice > 0 ? nsdf[thrice] : 0;
      const f2 = sampleRate / twice;
      if (c2 >= 0.78 * c1 && c3 < 0.72 * c1 && f2 >= minF && f2 <= maxF) chosen = twice;
    }
    const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? Math.max(-1, Math.min(1, 0.5 * (a - c) / den)) : 0;
    const clarity = b - 0.25 * (a - c) * shift;
    if (clarity < clarityMin) return null;
    const freq = sampleRate / (chosen + shift);
    if (freq < minF || freq > maxF) return null;
    return { freq, clarity, rms };
  }

  function nearestString(freq, a4, tuning) {
    const list = stringsFor(a4 || 440, tuning);
    let idx = 0, bd = Infinity;
    list.forEach((s, i) => { const d = Math.abs(Math.log2(freq / s.f)); if (d < bd) { bd = d; idx = i; } });
    return { string: list[idx], index: idx, cents: 1200 * Math.log2(freq / list[idx].f) };
  }
  function centsToString(freq, index, a4, tuning) {
    const c = 1200 * Math.log2(freq / stringsFor(a4 || 440, tuning)[index].f);
    return c - 1200 * Math.round(c / 1200);
  }
  function noteFromFreq(freq, a4) {
    const m = 69 + 12 * Math.log2(freq / clampA4(a4 || 440)), midi = Math.round(m);
    return { name: NOTE_NAMES[((midi % 12) + 12) % 12], oct: Math.floor(midi / 12) - 1, midi, cents: (m - midi) * 100 };
  }
  const isInTune = (cents, tol) => cents != null && Math.abs(cents) <= (tol != null ? tol : IN_TUNE_CENTS);

  function referenceFreq(index, a4, tuning) {
    const s = stringsFor(a4 || 440, tuning)[index];
    return s ? s.f : null;
  }
  function referenceMuteMs(playMs, tailMs) {
    const play = playMs != null ? playMs : REFERENCE_PLAY_MS;
    const tail = tailMs != null ? tailMs : REFERENCE_TAIL_MS;
    return play + tail;
  }

  // Attack opens the gate; sustain is intentionally lower so a decaying pluck
  // stays locked. confirmFrames is 1 — a single clean frame is a pluck.
  function gateThresholds(noiseFloor, opts) {
    opts = opts || {};
    const g = gateFor(noiseFloor);
    const attackRms = opts.attackRms != null ? opts.attackRms : Math.max(0.0035, g * 0.8);
    let sustainRms = opts.sustainRms != null ? opts.sustainRms : Math.max(0.00115, attackRms * 0.32);
    if (!(sustainRms < attackRms)) sustainRms = attackRms * 0.45;
    const attackClarity = opts.attackClarity != null ? opts.attackClarity : 0.66;
    let sustainClarity = opts.sustainClarity != null ? opts.sustainClarity : 0.38;
    if (!(sustainClarity < attackClarity)) sustainClarity = attackClarity * 0.6;
    return {
      attackRms, sustainRms, attackClarity, sustainClarity,
      confirmFrames: Math.max(1, opts.confirmFrames != null ? opts.confirmFrames : 1),
      releaseMs: opts.releaseMs != null ? opts.releaseMs : 600
    };
  }

  function createTracker(opts) {
    opts = opts || {};
    let locked = false, pending = 0, freq = null, lastGoodT = -1e15;
    return {
      push(frame, t, noiseFloor) {
        const th = gateThresholds(noiseFloor, opts);
        const rms = frame && frame.rms > 0 ? frame.rms : 0;
        const clarity = frame && frame.clarity > 0 ? frame.clarity : 0;
        const has = !!(frame && frame.freq > 0);
        const attack = has && rms >= th.attackRms && clarity >= th.attackClarity;
        const sustain = has && rms >= th.sustainRms && clarity >= th.sustainClarity;
        const blank = { voiced: false, holding: false, onset: false, fresh: false, freq: null, rms, clarity };
        if (!locked) {
          if (!attack) { pending = 0; return blank; }
          pending += 1;
          if (pending < th.confirmFrames) return blank;
          locked = true; pending = 0; freq = frame.freq; lastGoodT = t;
          return { voiced: true, holding: false, onset: true, fresh: true, freq, rms, clarity };
        }
        if (sustain) {
          const jumped = freq > 0 && Math.abs(1200 * Math.log2(frame.freq / freq)) > 400;
          // A quiet octave hop on a dying wound string is not a new note.
          if (jumped && !attack) {
            if (t - lastGoodT <= th.releaseMs) return { voiced: true, holding: true, onset: false, fresh: false, freq, rms, clarity };
            locked = false; pending = 0; freq = null;
            return blank;
          }
          const onset = !!(jumped && attack);
          freq = frame.freq; lastGoodT = t; pending = 0;
          return { voiced: true, holding: false, onset, fresh: true, freq, rms, clarity };
        }
        if (t - lastGoodT <= th.releaseMs) return { voiced: true, holding: true, onset: false, fresh: false, freq, rms, clarity };
        locked = false; pending = 0; freq = null;
        return blank;
      },
      reset() { locked = false; pending = 0; freq = null; lastGoodT = -1e15; }
    };
  }

  function createSmoother(opts) {
    opts = opts || {};
    const size = opts.size || 5, jump = opts.jumpCents || 50, confirm = opts.confirm || 3;
    const slow = opts.slowAlpha || 0.2, fast = opts.fastAlpha || 0.65;
    let hist = [], ema = null, pending = 0;
    const toC = f => 1200 * Math.log2(f / 440), toF = c => 440 * Math.pow(2, c / 1200);
    return {
      push(freq) {
        const c = toC(freq);
        if (ema != null && Math.abs(c - ema) > jump) {
          if (++pending < confirm) return toF(ema);
          hist = []; ema = null;
        }
        pending = 0;
        hist.push(c); if (hist.length > size) hist.shift();
        const med = hist.slice().sort((p, q) => p - q)[hist.length >> 1];
        if (ema == null) ema = med;
        else ema += (Math.abs(med - ema) > 8 ? fast : slow) * (med - ema);
        return toF(ema);
      },
      reset() { hist = []; ema = null; pending = 0; },
      get value() { return ema == null ? null : toF(ema); }
    };
  }
  function updateNoiseFloor(floor, rms, voiced) {
    if (voiced) return floor;
    return floor == null ? rms : floor + (rms < floor ? 0.2 : 0.02) * (rms - floor);
  }
  const gateFor = floor => Math.max(0.006, Math.min(0.05, (floor || 0) * 2.5));

  function newSweep() { return { confirmed: [], start: null, last: null, cand: null, candSince: 0 }; }
  function sweepStep(st, f, opts) {
    opts = opts || {};
    const tol = opts.tol != null ? opts.tol : IN_TUNE_CENTS;
    const holdMs = opts.holdMs != null ? opts.holdMs : SWEEP_HOLD_MS;
    const windowMs = opts.windowMs != null ? opts.windowMs : SWEEP_WINDOW_MS;
    st = { confirmed: st.confirmed.slice(), start: st.start, last: st.last, cand: st.cand, candSince: st.candSince };
    let event = null;
    if (st.last != null && f.t - st.last > windowMs) { st = newSweep(); event = 'reset'; }
    const ok = f.index != null && Math.abs(f.cents) <= tol;
    if (!ok) { st.cand = null; return { state: st, event }; }
    if (st.cand !== f.index) { st.cand = f.index; st.candSince = f.t; }
    if (f.t - st.candSince >= holdMs && st.confirmed.indexOf(f.index) < 0) {
      if (st.start == null) st.start = f.t;
      st.last = f.t;
      st.confirmed.push(f.index); event = 'confirm';
      if (st.confirmed.length === 6) {
        const ordered = st.confirmed.every((v, i) => v === i);
        return { state: newSweep(), event: 'success', ordered, confirmed: st.confirmed };
      }
    }
    return { state: st, event };
  }

  const api = {
    detectPitch, nearestString, centsToString, noteFromFreq, stringsFor, midiToFreq, clampA4, isInTune,
    createSmoother, updateNoiseFloor, gateFor, gateThresholds, createTracker,
    STRINGS, TUNINGS, NOTE_NAMES, A4_MIN, A4_MAX, IN_TUNE_CENTS, MIN_FREQ, MAX_FREQ, MIC_CONSTRAINTS,
    newSweep, sweepStep, SWEEP_HOLD_MS, SWEEP_WINDOW_MS,
    referenceFreq, referenceMuteMs, REFERENCE_PLAY_MS, REFERENCE_TAIL_MS,
    formatCents, signalRms, meterLevel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Needle = api;
  if (typeof document === 'undefined') return;

  // ---------------- UI ----------------
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_ANGLE = 60;
  const CX = 250, CY = 250, R = 200;
  const LEVEL_LEDS = 12;
  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tt.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tt.' + k, v); } catch (e) {} }
  };

  let a4 = clampA4(store.get('a4', 440));
  let tuningId = TUNINGS[store.get('tuning', 'standard')] ? store.get('tuning', 'standard') : 'standard';
  let mode = store.get('mode', 'guitar') === 'chromatic' ? 'chromatic' : 'guitar';
  let lock = null;
  let audioCtx = null, suppressUntil = 0, refTimer = 0, activeTone = null;
  let shownMidi = 69;

  const polar = (c, r) => { const a = (c / 50) * MAX_ANGLE * Math.PI / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  function buildGauge() {
    const band = $('band'), ticks = $('ticks');
    for (let c = -50; c < 50; c += 1) {
      const mid = c + 0.5;
      const [x1, y1] = polar(c, R), [x2, y2] = polar(c + 1, R), d = Math.abs(mid);
      const hue = d <= IN_TUNE_CENTS ? 146 : mid < 0 ? 40 : 4;
      const op = d <= IN_TUNE_CENTS ? 1 : 0.5 + 0.4 * (1 - d / 50);
      svgEl('path', {
        d: 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + R + ' ' + R + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2),
        stroke: 'hsla(' + hue + ',85%,62%,' + op.toFixed(2) + ')', class: 'band-seg'
      }, band);
    }
    const [zx1, zy1] = polar(-IN_TUNE_CENTS, R + 14), [zx2, zy2] = polar(IN_TUNE_CENTS, R + 14);
    svgEl('path', { d: 'M ' + zx1 + ' ' + zy1 + ' A ' + (R + 14) + ' ' + (R + 14) + ' 0 0 1 ' + zx2 + ' ' + zy2, class: 'zone' }, ticks);
    for (let c = -50; c <= 50; c += 5) {
      const major = c % 10 === 0, center = c === 0;
      const [x1, y1] = polar(c, R - 14), [x2, y2] = polar(c, R - 14 - (center ? 30 : major ? 18 : 9));
      svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: center ? 'tick center' : major ? 'tick major' : 'tick' }, ticks);
      if (major && !center) {
        const [tx, ty] = polar(c, R - 54);
        svgEl('text', { x: tx, y: ty + 4, class: 'tick-label' }, ticks).textContent = (c > 0 ? '+' : '') + c;
      }
    }
    for (let c = -10; c <= 10; c += 1) {
      if (c % 5 === 0) continue;
      const [x1, y1] = polar(c, R - 14), [x2, y2] = polar(c, R - 20);
      svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'tick fine' }, ticks);
    }
    const level = $('level');
    for (let i = 0; i < LEVEL_LEDS; i++) {
      const s = document.createElement('span');
      s.className = 'led' + (i >= LEVEL_LEDS - 2 ? ' hot' : '');
      level.appendChild(s);
    }
    const sel = $('tuning');
    Object.keys(TUNINGS).forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = TUNINGS[id].label;
      sel.appendChild(o);
    });
    const chroma = $('chroma');
    NOTE_NAMES.forEach(name => {
      const b = document.createElement('span');
      b.className = 'pc'; b.dataset.note = name; b.textContent = name;
      chroma.appendChild(b);
    });
  }

  function paintLevel(rms) {
    const level = meterLevel(rms);
    const n = Math.round(level * LEVEL_LEDS);
    const leds = $('level').children;
    for (let i = 0; i < leds.length; i++) leds[i].classList.toggle('on', i < n);
    $('level').setAttribute('aria-valuenow', String(Math.round(level * 100)));
  }

  function paintNote(name, oct) {
    $('note-name').textContent = name;
    const o = $('note-oct');
    const show = oct != null && oct !== '';
    o.textContent = show ? String(oct) : '';
    o.hidden = !show;
  }
  function paintChroma(name, inTune) {
    document.querySelectorAll('.pc').forEach(el => {
      const on = el.dataset.note === name;
      el.classList.toggle('on', on);
      el.classList.toggle('in', on && inTune);
    });
  }
  function paintTargets() {
    const list = stringsFor(a4, tuningId);
    list.forEach((s, i) => {
      const b = $('s' + i);
      if (!b) return;
      const tone = b.parentNode.querySelector('.tone');
      b.title = s.name + s.oct + ' · ' + s.f.toFixed(2) + ' Hz';
      b.setAttribute('aria-label', 'String ' + (6 - i) + ', ' + s.name + s.oct);
      if (tone) tone.setAttribute('aria-label', 'Play ' + s.name + s.oct + ' reference');
    });
  }
  function renderStrings() {
    const row = $('strings');
    row.innerHTML = '';
    stringsFor(a4, tuningId).forEach((s, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip string'; b.id = 's' + i;
      b.innerHTML = '<span class="light" aria-hidden="true"></span><span class="lab">' + s.name + '<sub>' + s.oct + '</sub></span>';
      b.addEventListener('click', () => setLock(lock === i ? null : i));
      const p = document.createElement('button');
      p.type = 'button'; p.className = 'tone'; p.textContent = 'Play';
      p.addEventListener('click', () => playString(i));
      slot.appendChild(b); slot.appendChild(p);
      row.appendChild(slot);
    });
    paintTargets();
    paintSweep();
  }

  function setLock(i) {
    lock = i;
    smoother.reset();
    const autoBtn = $('auto');
    const list = stringsFor(a4, tuningId);
    autoBtn.setAttribute('aria-pressed', String(i == null));
    if (i == null) {
      autoBtn.textContent = 'Auto';
      autoBtn.setAttribute('aria-label', 'Auto-detect string');
    } else {
      autoBtn.textContent = 'Locked';
      autoBtn.setAttribute('aria-label', 'Unlock ' + list[i].name + list[i].oct);
    }
    document.querySelectorAll('.chip.string').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  }
  function setA4(v) {
    a4 = clampA4(Math.round(Number(v)));
    store.set('a4', a4);
    $('a4').value = a4;
    $('a4-val').textContent = String(a4);
    $('a4-pill').textContent = 'A4 ' + a4 + ' Hz';
    paintTargets();
  }
  function setTuning(id) {
    tuningId = TUNINGS[id] ? id : 'standard';
    store.set('tuning', tuningId);
    $('tuning').value = tuningId;
    lock = null;
    sweep = newSweep();
    smoother.reset();
    renderStrings();
    setLock(null);
    if ($('meter-kicker') && mode === 'guitar') $('meter-kicker').textContent = TUNINGS[tuningId].label;
  }
  function setMode(next) {
    mode = next === 'chromatic' ? 'chromatic' : 'guitar';
    store.set('mode', mode);
    document.body.classList.toggle('chromatic', mode === 'chromatic');
    $('mode-guitar').setAttribute('aria-pressed', String(mode === 'guitar'));
    $('mode-chromatic').setAttribute('aria-pressed', String(mode === 'chromatic'));
    $('guitar-panel').hidden = mode !== 'guitar';
    $('chromatic-panel').hidden = mode !== 'chromatic';
    $('meter-kicker').textContent = mode === 'chromatic' ? 'Chromatic' : TUNINGS[tuningId].label;
    $('hint').textContent = mode === 'chromatic'
      ? 'Every pitch, any octave. Green lock is within ±3¢.'
      : 'Green lock is within ±3¢. Pluck all six strings for the sweep.';
    smoother.reset();
  }

  let angle = 0, vel = 0, target = 0, lastT = 0, lastHit = 0, idleShown = false, holdUi = false;
  function animate(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
    if (reducedMotion) { angle = target; vel = 0; }
    else {
      const kS = 120, damp = 2 * Math.sqrt(kS) * 0.86;
      vel += (kS * (target - angle) - damp * vel) * dt;
      angle += vel * dt;
    }
    $('needle').setAttribute('transform', 'rotate(' + angle.toFixed(2) + ' ' + CX + ' ' + CY + ')');
    const now = performance.now();
    if (!holdUi && now >= suppressUntil && now - lastHit > 1400 && !idleShown) {
      target = 0; smoother.reset(); idle();
    }
    if (mode === 'guitar' && sweep.last != null && now - sweep.last > SWEEP_WINDOW_MS) { sweep = newSweep(); paintSweep(); }
    requestAnimationFrame(animate);
  }

  let sweep = newSweep(), celebrating = false;
  function paintSweep() {
    document.querySelectorAll('.chip.string').forEach((e, i) => e.classList.toggle('done', sweep.confirmed.indexOf(i) >= 0));
  }
  function mulberry(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function burstSplatters(seed) {
    const layer = $('splatters');
    if (!layer) return;
    layer.innerHTML = '';
    const rnd = mulberry(seed != null ? seed : (Date.now() ^ Math.floor(performance.now())));
    const n = reducedMotion ? 24 : 46;
    for (let i = 0; i < n; i++) {
      const dot = document.createElement('span');
      const spark = i % 7 === 0;
      dot.className = spark ? 'splat splat-spark' : (i % 5 === 0 ? 'splat splat-lg' : (i % 2 === 0 ? 'splat splat-drip' : 'splat'));
      const color = SPLAT_COLORS[Math.floor(rnd() * SPLAT_COLORS.length)];
      const ang = (i / n) * 360 + (rnd() * 22 - 11);
      const dist = spark ? (30 + rnd() * 50) : (26 + rnd() * 52);
      const size = spark ? (10 + rnd() * 10) : (12 + rnd() * (i % 6 === 0 ? 64 : 32));
      dot.style.setProperty('--c', color);
      dot.style.setProperty('--ang', ang + 'deg');
      dot.style.setProperty('--dist', dist + 'vmin');
      dot.style.setProperty('--sz', size + 'px');
      dot.style.setProperty('--delay', (rnd() * 0.14) + 's');
      dot.style.setProperty('--rot', (rnd() * 360) + 'deg');
      layer.appendChild(dot);
    }
  }
  function celebrate(ordered, seed) {
    if (celebrating) return;
    celebrating = true;
    const c = $('celebrate');
    burstSplatters(seed);
    $('celebrate-sub').textContent = ordered ? 'Low to high, clean sweep' : 'Clean sweep';
    document.querySelectorAll('.chip.string').forEach(e => e.classList.add('done'));
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 120]);
    setTimeout(() => { c.classList.remove('show'); celebrating = false; paintSweep(); }, 3000);
  }
  function feedSweep(index, cents) {
    if (mode !== 'guitar') return;
    const r = sweepStep(sweep, { index, cents, t: performance.now() });
    sweep = r.state;
    if (r.event === 'success') celebrate(r.ordered);
    if (r.event) paintSweep();
  }

  let lastSpoken = '', inTuneSince = 0, buzzed = false;
  function say(msg) { if (msg !== lastSpoken) { lastSpoken = msg; $('sr').textContent = msg; } }
  function idle() {
    if (performance.now() < suppressUntil) return;
    idleShown = true;
    holdUi = false;
    paintNote('–', '');
    $('cents').textContent = '—';
    $('hz').textContent = '— Hz';
    $('dir').textContent = running ? 'Pluck a string' : 'Tap start, then pluck a string';
    document.body.classList.remove('intune', 'flat', 'sharp', 'live');
    document.querySelectorAll('.chip.string').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.pc').forEach(e => e.classList.remove('on', 'in'));
    inTuneSince = 0; buzzed = false;
  }
  function applyReading(name, oct, cents, freq, idx) {
    idleShown = false;
    const c = Math.max(-50, Math.min(50, cents));
    target = (c / 50) * MAX_ANGLE;
    lastHit = performance.now();
    const ok = isInTune(cents);
    paintNote(name, oct);
    $('cents').textContent = formatCents(cents);
    $('hz').textContent = freq.toFixed(2) + ' Hz';
    const dir = ok ? 'In tune' : cents < 0 ? 'Tune up' : 'Tune down';
    $('dir').textContent = dir;
    const b = document.body;
    b.classList.add('live');
    b.classList.toggle('intune', ok);
    b.classList.toggle('flat', !ok && cents < 0);
    b.classList.toggle('sharp', !ok && cents > 0);
    if (idx == null) {
      document.querySelectorAll('.chip.string').forEach(e => e.classList.remove('active'));
      paintChroma(name, ok);
    } else {
      document.querySelectorAll('.chip.string').forEach((e, i) => e.classList.toggle('active', i === idx));
      paintChroma(null, false);
    }
    say(name + oct + ', ' + (ok ? 'in tune' : dir.toLowerCase()));
    if (ok) {
      if (!inTuneSince) inTuneSince = lastHit;
      if (!buzzed && lastHit - inTuneSince > 280) { buzzed = true; if (navigator.vibrate) navigator.vibrate(18); }
    } else { inTuneSince = 0; buzzed = false; }
  }
  function show(freq) {
    holdUi = false;
    if (mode === 'chromatic') {
      const n = noteFromFreq(freq, a4);
      shownMidi = n.midi;
      applyReading(n.name, n.oct, n.cents, freq, null);
      const play = $('play-chroma');
      if (play) play.setAttribute('aria-label', 'Play ' + n.name + n.oct + ' reference');
      return;
    }
    const auto = lock == null;
    const idx = auto ? nearestString(freq, a4, tuningId).index : lock;
    const s = stringsFor(a4, tuningId)[idx];
    const cents = auto ? nearestString(freq, a4, tuningId).cents : centsToString(freq, idx, a4, tuningId);
    shownMidi = s.midi;
    applyReading(s.name, s.oct, cents, freq, idx);
    feedSweep(idx, cents);
  }
  function showReference(s) {
    holdUi = true;
    idleShown = false;
    target = 0;
    lastHit = performance.now();
    paintNote(s.name, s.oct);
    $('cents').textContent = '0.0¢';
    $('hz').textContent = s.f.toFixed(2) + ' Hz';
    $('dir').textContent = 'Reference';
    document.body.classList.remove('flat', 'sharp', 'intune');
    document.body.classList.add('live', 'referencing');
    say('Reference ' + s.name + s.oct);
  }

  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function karplusBuffer(ctx, freq, seconds) {
    const sr = ctx.sampleRate;
    const period = Math.max(2, Math.round(sr / freq));
    const len = Math.max(period + 2, Math.floor(sr * seconds));
    const buffer = ctx.createBuffer(1, len, sr);
    const out = buffer.getChannelData(0);
    const delay = new Float32Array(period);
    for (let i = 0; i < period; i++) delay[i] = Math.random() * 2 - 1;
    for (let i = 1; i < period; i++) delay[i] = delay[i] * 0.62 + delay[i - 1] * 0.38;
    const loopGain = Math.pow(0.06, 1 / (freq * Math.max(0.4, seconds * 0.92)));
    let idx = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const cur = delay[idx];
      const filtered = (cur + prev) * 0.5;
      prev = cur;
      delay[idx] = filtered * loopGain;
      idx = idx + 1 === period ? 0 : idx + 1;
      const attack = Math.min(1, i / 24);
      const rel = i > len - sr * 0.045 ? Math.max(0, (len - i) / (sr * 0.045)) : 1;
      out[i] = cur * attack * rel * 0.62;
    }
    return buffer;
  }
  function endReference() {
    document.body.classList.remove('referencing');
    document.querySelectorAll('#strings .tone.playing, #play-chroma.playing').forEach(el => el.classList.remove('playing'));
    suppressUntil = 0;
    holdUi = false;
    if (!running) { target = 0; idle(); }
  }
  function armMute() {
    const ms = referenceMuteMs();
    suppressUntil = performance.now() + ms;
    document.body.classList.add('referencing');
    clearTimeout(refTimer);
    refTimer = setTimeout(endReference, ms);
  }
  function playFreq(freq, label) {
    // Mute detection in this turn, before the speaker can leak back into the mic.
    armMute();
    const ctx = getAudio();
    const resume = ctx.resume ? ctx.resume() : Promise.resolve();
    Promise.resolve(resume).then(() => {
      armMute();
      if (activeTone) { try { activeTone.stop(); } catch (e) {} activeTone = null; }
      const seconds = REFERENCE_PLAY_MS / 1000;
      const src = ctx.createBufferSource();
      src.buffer = karplusBuffer(ctx, freq, seconds);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.max(900, Math.min(4800, freq * 10 + 700));
      filter.Q.value = 0.55;
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start();
      activeTone = src;
      const info = label || noteFromFreq(freq, a4);
      const s = { name: info.name, oct: info.oct, f: freq, midi: info.midi };
      shownMidi = info.midi != null ? info.midi : shownMidi;
      showReference(s);
    }).catch(err => { $('status').textContent = 'Reference tone unavailable: ' + err.message; });
  }
  function playString(i) {
    const s = stringsFor(a4, tuningId)[i];
    document.querySelectorAll('#strings .tone.playing').forEach(el => el.classList.remove('playing'));
    const btn = document.querySelectorAll('#strings .tone')[i];
    if (btn) btn.classList.add('playing');
    playFreq(s.f, s);
  }
  function playChromatic() {
    const midi = shownMidi != null ? shownMidi : 69;
    const btn = $('play-chroma');
    if (btn) btn.classList.add('playing');
    playFreq(midiToFreq(midi, a4), noteFromFreq(midiToFreq(midi, a4), a4));
  }

  const smoother = createSmoother();
  const tracker = createTracker();
  let running = false, noiseFloor = null;

  async function openMic() {
    const exact = { audio: MIC_CONSTRAINTS };
    try { return await navigator.mediaDevices.getUserMedia(exact); }
    catch (e) {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false }
        }
      });
    }
  }
  async function start() {
    const btn = $('start');
    try {
      btn.disabled = true; btn.textContent = 'Starting…';
      // Resume in the click turn so iOS will actually start the audio graph.
      const ctx = getAudio();
      const resumed = ctx.resume ? ctx.resume() : Promise.resolve();
      const stream = await openMic();
      await resumed;
      const src = ctx.createMediaStreamSource(stream);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 28; // rumble only — 55 Hz drop-tunings must pass
      hp.Q.value = 0.707;
      const an = ctx.createAnalyser();
      an.fftSize = ctx.sampleRate >= 64000 ? 8192 : 4096;
      an.smoothingTimeConstant = 0; // default 0.8 smears the pluck across frames
      src.connect(hp); hp.connect(an);
      const buf = new Float32Array(an.fftSize);
      running = true;
      btn.textContent = 'Listening';
      btn.classList.add('on');
      $('status').textContent = '';
      idle();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) ctx.suspend(); else ctx.resume();
      });
      setInterval(() => {
        if (document.hidden) return;
        an.getFloatTimeDomainData(buf);
        if (performance.now() < suppressUntil) return;
        const rms = signalRms(buf);
        paintLevel(rms);
        const det = detectPitch(buf, ctx.sampleRate, {
          minFreq: MIN_FREQ, maxFreq: MAX_FREQ, rmsThreshold: 0.00105, clarityThreshold: 0.34
        });
        const tr = tracker.push(det, performance.now(), noiseFloor);
        if (!tr.voiced) noiseFloor = updateNoiseFloor(noiseFloor, rms, false);
        if (tr.onset) smoother.reset();
        if (tr.fresh) {
          holdUi = false;
          show(smoother.push(tr.freq));
        } else if (tr.holding) {
          holdUi = true;
          lastHit = performance.now();
        } else {
          holdUi = false;
          if (!idleShown) { target = 0; smoother.reset(); idle(); }
          feedSweep(null, 0);
        }
      }, 32);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Start tuner';
      $('status').textContent = 'Microphone unavailable: ' + e.message + '. Allow mic access and try again.';
    }
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('install').hidden = false; });
  window.addEventListener('appinstalled', () => { $('install').hidden = true; deferredPrompt = null; });

  api.demo = {
    idle() { running = false; holdUi = false; suppressUntil = 0; idle(); target = 0; angle = 0; },
    inTune(freq) { running = true; show(freq != null ? freq : midiToFreq(45, a4)); lastHit = performance.now() + 1e9; },
    celebrate(ordered, seed) {
      running = true;
      document.querySelectorAll('.chip.string').forEach(e => e.classList.add('done'));
      celebrate(ordered !== false, seed != null ? seed : 42);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    buildGauge();
    setA4(a4);
    setTuning(tuningId);
    setMode(mode);
    idle();
    $('start').addEventListener('click', start);
    $('a4').addEventListener('input', e => setA4(e.target.value));
    $('a4-down').addEventListener('click', () => setA4(a4 - 1));
    $('a4-up').addEventListener('click', () => setA4(a4 + 1));
    $('a4-reset').addEventListener('click', () => setA4(440));
    $('tuning').addEventListener('change', e => setTuning(e.target.value));
    $('mode-guitar').addEventListener('click', () => setMode('guitar'));
    $('mode-chromatic').addEventListener('click', () => setMode('chromatic'));
    $('auto').addEventListener('click', () => setLock(null));
    $('play-chroma').addEventListener('click', playChromatic);
    $('install').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('install').hidden = true;
    });
    requestAnimationFrame(animate);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
