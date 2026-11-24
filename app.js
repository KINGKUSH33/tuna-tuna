/* Tuna Tuna — guitar tuner. McLeod Pitch Method (NSDF) in plain JS. */
(function (root) {
  'use strict';
  // Standard tuning as MIDI note numbers (E2 A2 D3 G3 B3 E4).
  const STANDARD = [
    { name: 'E', oct: 2, midi: 40 }, { name: 'A', oct: 2, midi: 45 },
    { name: 'D', oct: 3, midi: 50 }, { name: 'G', oct: 3, midi: 55 },
    { name: 'B', oct: 3, midi: 59 }, { name: 'E', oct: 4, midi: 64 }
  ];
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const A4_MIN = 432, A4_MAX = 446, IN_TUNE_CENTS = 3;
  // Sweep: a brief in-tune pluck counts; the window rolls forward on each new string.
  const SWEEP_HOLD_MS = 40, SWEEP_WINDOW_MS = 20000;
  // Colorful paint only — no white/ivory/cream splatters.
  const SPLAT_COLORS = ['#7dca8e', '#6fb383', '#5aa872', '#e7a75b', '#f0c45c', '#d4923a', '#ee7a5f', '#e06c5c', '#f09580', '#5eb7e5', '#7ec8ea', '#4aa3d8'];

  const clampA4 = a4 => { a4 = Number(a4); return isFinite(a4) ? Math.min(A4_MAX, Math.max(A4_MIN, a4)) : 440; };
  const midiToFreq = (midi, a4) => clampA4(a4 || 440) * Math.pow(2, (midi - 69) / 12);
  function stringsFor(a4) { return STANDARD.map(s => ({ name: s.name, oct: s.oct, midi: s.midi, f: midiToFreq(s.midi, a4) })); }
  const STRINGS = stringsFor(440).map(s => Object.assign(s, { f: Math.round(s.f * 100) / 100 }));

  // Pure detector: returns {freq, clarity, rms} or null.
  function detectPitch(buf, sampleRate, opts) {
    opts = opts || {};
    const minF = opts.minFreq || 62, maxF = opts.maxFreq || 1000;
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
    // on mid-range strings (D3) without changing the 62 Hz reporting floor.
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / Math.min(minF, 45)));
    const nsdf = new Float32Array(maxLag + 2);
    for (let tau = 0; tau <= maxLag + 1; tau++) {
      let acf = 0, m = 0;
      for (let i = 0; i < n - tau; i++) { const a = x[i], b = x[i + tau]; acf += a * b; m += a * a + b * b; }
      nsdf[tau] = m > 0 ? 2 * acf / m : 0;
    }
    // Key maxima: highest peak between each positive-going zero crossing and next negative one.
    const peaks = []; let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;           // skip initial lobe
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
    // Only fold the octave when the 3× peak is actually in range to inspect;
    // a missing 3× peak past maxLag is not evidence of a false fundamental.
    if (twice > 0 && chosen * 3 <= maxLag - 1) {
      const thrice = near(chosen * 3);
      const c1 = nsdf[chosen], c2 = nsdf[twice], c3 = thrice > 0 ? nsdf[thrice] : 0;
      const f2 = sampleRate / twice;
      if (c2 >= 0.78 * c1 && c3 < 0.72 * c1 && f2 >= minF && f2 <= maxF) chosen = twice;
    }
    // Parabolic interpolation around the chosen lag for sub-sample precision.
    const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? Math.max(-1, Math.min(1, 0.5 * (a - c) / den)) : 0;
    const clarity = b - 0.25 * (a - c) * shift;
    if (clarity < clarityMin) return null;
    const freq = sampleRate / (chosen + shift);
    if (freq < minF || freq > maxF) return null;
    return { freq, clarity, rms };
  }

  // Nearest standard-tuning string for a frequency, relative to reference A4.
  function nearestString(freq, a4) {
    const list = stringsFor(a4 || 440);
    let idx = 0, bd = Infinity;
    list.forEach((s, i) => { const d = Math.abs(Math.log2(freq / s.f)); if (d < bd) { bd = d; idx = i; } });
    return { string: list[idx], index: idx, cents: 1200 * Math.log2(freq / list[idx].f) };
  }
  // Cents from a chosen string's target, folded by octaves (so a ringing harmonic still reads right).
  function centsToString(freq, index, a4) {
    const c = 1200 * Math.log2(freq / stringsFor(a4 || 440)[index].f);
    return c - 1200 * Math.round(c / 1200);
  }
  // Chromatic note name for any frequency.
  function noteFromFreq(freq, a4) {
    const m = 69 + 12 * Math.log2(freq / clampA4(a4 || 440)), midi = Math.round(m);
    return { name: NOTE_NAMES[((midi % 12) + 12) % 12], oct: Math.floor(midi / 12) - 1, midi, cents: (m - midi) * 100 };
  }
  const isInTune = (cents, tol) => cents != null && Math.abs(cents) <= (tol != null ? tol : IN_TUNE_CENTS);

  // Pitch smoother: median filter (kills single-frame glitches/octave errors) + adaptive EMA
  // (steady when close to pitch, quick when you turn a peg). Works in cents so it's pitch-independent.
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
          if (++pending < confirm) return toF(ema);      // ignore a lone outlier
          hist = []; ema = null;                          // sustained change: new note
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
  // Adaptive noise gate: slowly learns the room's background level while nothing is playing.
  function updateNoiseFloor(floor, rms, voiced) {
    if (voiced) return floor;
    return floor == null ? rms : floor + (rms < floor ? 0.2 : 0.02) * (rms - floor);
  }
  const gateFor = floor => Math.max(0.006, Math.min(0.05, (floor || 0) * 2.5));

  // Pure sweep tracker. Feed frames {index, cents, t(ms)}; index null = silence.
  // A string is confirmed after holding |cents|<=tol for holdMs. The window
  // rolls forward on each newly confirmed string (windowMs from the last one).
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

  const api = { detectPitch, nearestString, centsToString, noteFromFreq, stringsFor, midiToFreq, clampA4, isInTune,
    createSmoother, updateNoiseFloor, gateFor, STRINGS, A4_MIN, A4_MAX, IN_TUNE_CENTS,
    newSweep, sweepStep, SWEEP_HOLD_MS, SWEEP_WINDOW_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Needle = api;
  if (typeof document === 'undefined') return;

  // ---------------- UI ----------------
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_ANGLE = 60;               // needle degrees at ±50 cents
  const CX = 250, CY = 250, R = 200;
  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k, d) { try { const v = localStorage.getItem('tt.' + k); return v == null ? d : v; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem('tt.' + k, v); } catch (e) {} } };

  let a4 = clampA4(store.get('a4', 440));
  let lock = null;                    // null = auto-detect, else string index
  const polar = (c, r) => { const a = (c / 50) * MAX_ANGLE * Math.PI / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; };
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  function buildGauge() {
    const band = $('band'), ticks = $('ticks');
    // Coloured band: amber at the edges fading to sage in the middle; bright in-tune window at ±3¢.
    for (let c = -50; c < 50; c += 1) {
      const [x1, y1] = polar(c, R), [x2, y2] = polar(c + 1, R), d = Math.abs(c + 0.5);
      const hue = d <= IN_TUNE_CENTS ? 140 : Math.max(18, 120 - d * 2.2);
      const op = d <= IN_TUNE_CENTS ? 1 : 0.18 + 0.5 * (1 - d / 50);
      el('path', { d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        stroke: `hsla(${hue},45%,62%,${op.toFixed(2)})`, class: 'band-seg' }, band);
    }
    const [zx1, zy1] = polar(-IN_TUNE_CENTS, R + 14), [zx2, zy2] = polar(IN_TUNE_CENTS, R + 14);
    el('path', { d: `M ${zx1} ${zy1} A ${R + 14} ${R + 14} 0 0 1 ${zx2} ${zy2}`, class: 'zone' }, ticks);
    for (let c = -50; c <= 50; c += 5) {
      const major = c % 10 === 0, center = c === 0;
      const [x1, y1] = polar(c, R - 14), [x2, y2] = polar(c, R - 14 - (center ? 30 : major ? 18 : 9));
      el('line', { x1, y1, x2, y2, class: center ? 'tick center' : major ? 'tick major' : 'tick' }, ticks);
      if (major && !center) {
        const [tx, ty] = polar(c, R - 54);
        el('text', { x: tx, y: ty + 4, class: 'tick-label' }, ticks).textContent = (c > 0 ? '+' : '') + c;
      }
    }
    const row = $('strings');
    STRINGS.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip string'; b.id = 's' + i; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="light" aria-hidden="true"></span><span class="lab">' + s.name + '<sub>' + s.oct + '</sub></span>';
      b.addEventListener('click', () => setLock(lock === i ? null : i));
      row.appendChild(b);
    });
    $('auto').addEventListener('click', () => setLock(null));
    paintTargets();
  }
  function paintTargets() {
    const list = stringsFor(a4);
    list.forEach((s, i) => { const b = $('s' + i); b.title = 'Lock to ' + s.name + s.oct + ' (' + s.f.toFixed(2) + ' Hz)';
      b.setAttribute('aria-label', 'String ' + (6 - i) + ', ' + s.name + s.oct + ', ' + s.f.toFixed(1) + ' hertz'); });
  }
  function setLock(i) {
    lock = i; smoother.reset();
    const autoBtn = $('auto');
    autoBtn.setAttribute('aria-pressed', String(i == null));
    autoBtn.textContent = i == null ? 'Auto-detect' : 'Locked · ' + STRINGS[i].name + STRINGS[i].oct;
    document.querySelectorAll('.chip.string').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  }
  function setA4(v) {
    a4 = clampA4(Math.round(v)); store.set('a4', a4);
    $('a4').value = a4; $('a4-val').textContent = a4; $('a4-pill').textContent = 'A4 ' + a4 + ' Hz';
    paintTargets();
  }

  // Spring-physics needle (critically-ish damped). Runs only while the tab is visible.
  let angle = 0, vel = 0, target = 0, lastT = 0, lastHit = 0, idleShown = false;
  function animate(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
    if (reducedMotion) { angle = target; vel = 0; }
    else { const kS = 90, damp = 2 * Math.sqrt(kS) * 0.8; vel += (kS * (target - angle) - damp * vel) * dt; angle += vel * dt; }
    $('needle').setAttribute('transform', 'rotate(' + angle.toFixed(2) + ' ' + CX + ' ' + CY + ')');
    const now = performance.now();
    if (now - lastHit > 700 && !idleShown) { target = 0; smoother.reset(); idle(); }
    if (sweep.last != null && now - sweep.last > SWEEP_WINDOW_MS) { sweep = newSweep(); paintSweep(); }
    requestAnimationFrame(animate);
  }

  let sweep = newSweep(), celebrating = false;
  function paintSweep() { document.querySelectorAll('.chip.string').forEach((e, i) => e.classList.toggle('done', sweep.confirmed.indexOf(i) >= 0)); }
  function mulberry(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function burstSplatters(seed) {
    const layer = $('splatters');
    if (!layer) return;
    layer.innerHTML = '';
    const rnd = mulberry(seed != null ? seed : (Date.now() ^ Math.floor(performance.now())));
    const n = reducedMotion ? 24 : 46;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      const spark = i % 7 === 0;
      const kind = spark ? 'splat splat-spark' : (i % 5 === 0 ? 'splat splat-lg' : (i % 2 === 0 ? 'splat splat-drip' : 'splat'));
      el.className = kind;
      const color = SPLAT_COLORS[Math.floor(rnd() * SPLAT_COLORS.length)];
      const angle = (i / n) * 360 + (rnd() * 22 - 11);
      // Keep the burst in a ring around the message so paint never hides the words.
      const dist = spark ? (30 + rnd() * 50) : (26 + rnd() * 52);
      const size = spark ? (10 + rnd() * 10) : (12 + rnd() * (i % 6 === 0 ? 64 : 32));
      el.style.setProperty('--c', color);
      el.style.setProperty('--ang', angle + 'deg');
      el.style.setProperty('--dist', dist + 'vmin');
      el.style.setProperty('--sz', size + 'px');
      el.style.setProperty('--delay', (rnd() * 0.14) + 's');
      el.style.setProperty('--rot', (rnd() * 360) + 'deg');
      layer.appendChild(el);
    }
  }
  function celebrate(ordered, seed) {
    if (celebrating) return; celebrating = true;
    const c = $('celebrate');
    burstSplatters(seed);
    $('celebrate-sub').textContent = ordered ? 'Low to high, clean sweep' : 'Clean sweep';
    document.querySelectorAll('.chip.string').forEach(e => e.classList.add('done'));
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 120]);
    setTimeout(() => { c.classList.remove('show'); celebrating = false; paintSweep(); }, 3000);
  }
  function feedSweep(index, cents) {
    const r = sweepStep(sweep, { index, cents, t: performance.now() });
    sweep = r.state;
    if (r.event === 'success') celebrate(r.ordered);
    if (r.event) paintSweep();
  }

  let lastSpoken = '', inTuneSince = 0, buzzed = false;
  function say(msg) { if (msg !== lastSpoken) { lastSpoken = msg; $('sr').textContent = msg; } }
  function idle() {
    idleShown = true;
    $('note').innerHTML = '&ndash;'; $('cents').textContent = '— ¢'; $('hz').textContent = '— Hz';
    $('dir').textContent = running ? 'Pluck a string' : 'Tap start, then pluck a string';
    document.body.classList.remove('intune', 'flat', 'sharp', 'live');
    document.querySelectorAll('.chip.string').forEach(e => e.classList.remove('active'));
    inTuneSince = 0; buzzed = false;
  }
  function show(freq) {
    idleShown = false;
    const auto = lock == null;
    const idx = auto ? nearestString(freq, a4).index : lock;
    const s = stringsFor(a4)[idx];
    const cents = auto ? nearestString(freq, a4).cents : centsToString(freq, idx, a4);
    const c = Math.max(-50, Math.min(50, cents));
    target = (c / 50) * MAX_ANGLE; lastHit = performance.now();
    const ok = isInTune(cents);
    $('note').innerHTML = s.name + '<sub>' + s.oct + '</sub>';
    $('cents').textContent = (cents >= 0 ? '+' : '−') + Math.abs(cents).toFixed(1) + ' ¢';
    $('hz').textContent = freq.toFixed(2) + ' Hz';
    const dir = ok ? 'In tune' : cents < 0 ? (cents < -25 ? 'Tune up ↑↑' : 'Tune up ↑') : (cents > 25 ? 'Tune down ↓↓' : 'Tune down ↓');
    $('dir').textContent = dir;
    const b = document.body;
    b.classList.add('live'); b.classList.toggle('intune', ok);
    b.classList.toggle('flat', !ok && cents < 0); b.classList.toggle('sharp', !ok && cents > 0);
    document.querySelectorAll('.chip.string').forEach((e, i) => e.classList.toggle('active', i === idx));
    say(s.name + s.oct + ', ' + (ok ? 'in tune' : dir.replace(/[↑↓]/g, '').trim()));
    // A short buzz once the string has sat in the green zone for a moment.
    if (ok) { if (!inTuneSince) inTuneSince = lastHit; if (!buzzed && lastHit - inTuneSince > 350) { buzzed = true; if (navigator.vibrate) navigator.vibrate(25); } }
    else { inTuneSince = 0; buzzed = false; }
    feedSweep(idx, cents);
  }

  const smoother = createSmoother();
  let running = false, noiseFloor = null;
  async function start() {
    const btn = $('start');
    try {
      btn.disabled = true; btn.textContent = 'Starting…';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55;   // cut rumble/handling noise
      const an = ctx.createAnalyser();
      // Longer window at high sample rates so low E2/A2 still get enough periods.
      an.fftSize = ctx.sampleRate >= 64000 ? 8192 : 4096;
      src.connect(hp); hp.connect(an);
      const buf = new Float32Array(an.fftSize);
      running = true; btn.textContent = 'Listening'; btn.classList.add('on'); $('status').textContent = '';
      idle();
      document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
      setInterval(() => {
        if (document.hidden) return;
        an.getFloatTimeDomainData(buf);
        const r = detectPitch(buf, ctx.sampleRate, { minFreq: 62, rmsThreshold: gateFor(noiseFloor), clarityThreshold: 0.84 });
        if (!r) {
          let ss = 0; for (let i = 0; i < buf.length; i += 4) ss += buf[i] * buf[i];
          noiseFloor = updateNoiseFloor(noiseFloor, Math.sqrt(ss / (buf.length / 4)), false);
          feedSweep(null, 0); return;
        }
        show(smoother.push(r.freq));
      }, 40);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Start tuner';
      $('status').textContent = 'Microphone unavailable: ' + e.message + '. Allow mic access and try again.';
    }
  }

  // Install button (Android/Chrome) via beforeinstallprompt.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('install').hidden = false; });
  window.addEventListener('appinstalled', () => { $('install').hidden = true; deferredPrompt = null; });

  // Demo hooks used for screenshots / local preview. Not used in normal play.
  api.demo = {
    idle() { running = false; idle(); target = 0; angle = 0; },
    inTune(freq) { running = true; show(freq != null ? freq : 110.05); lastHit = performance.now() + 1e9; },
    celebrate(ordered, seed) {
      running = true;
      document.querySelectorAll('.chip.string').forEach(e => e.classList.add('done'));
      celebrate(ordered !== false, seed != null ? seed : 42);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    buildGauge(); setA4(a4); setLock(null); idle();
    $('start').addEventListener('click', start);
    $('a4').addEventListener('input', e => setA4(e.target.value));
    $('a4-down').addEventListener('click', () => setA4(a4 - 1));
    $('a4-up').addEventListener('click', () => setA4(a4 + 1));
    $('a4-reset').addEventListener('click', () => setA4(440));
    $('install').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('install').hidden = true; });
    requestAnimationFrame(animate);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
