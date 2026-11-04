/* Tuna Tuna — analog guitar tuner. McLeod Pitch Method (NSDF) in plain JS. */
(function (root) {
  'use strict';
  const STRINGS = [
    { name: 'E', oct: 2, f: 82.41 }, { name: 'A', oct: 2, f: 110.0 },
    { name: 'D', oct: 3, f: 146.83 }, { name: 'G', oct: 3, f: 196.0 },
    { name: 'B', oct: 3, f: 246.94 }, { name: 'E', oct: 4, f: 329.63 }
  ];

  // Pure detector: returns {freq, clarity, rms} or null.
  function detectPitch(buf, sampleRate, opts) {
    opts = opts || {};
    const minF = opts.minFreq || 70, maxF = opts.maxFreq || 1000;
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
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minF));
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
    const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    const clarity = b - 0.25 * (a - c) * shift;
    if (clarity < clarityMin) return null;
    const freq = sampleRate / (chosen + shift);
    if (freq < minF || freq > maxF) return null;
    return { freq, clarity, rms };
  }

  function nearestString(freq) {
    let best = STRINGS[0], bd = Infinity, idx = 0;
    STRINGS.forEach((s, i) => { const d = Math.abs(Math.log2(freq / s.f)); if (d < bd) { bd = d; best = s; idx = i; } });
    return { string: best, index: idx, cents: 1200 * Math.log2(freq / best.f) };
  }

  // Pure sweep tracker. Feed frames {index, cents, t(ms)}; index null = silence.
  // A string is confirmed after holding |cents|<=tol for holdMs. Six distinct within windowMs = success.
  function newSweep() { return { confirmed: [], start: null, cand: null, candSince: 0 }; }
  function sweepStep(st, f, opts) {
    opts = opts || {};
    const tol = opts.tol != null ? opts.tol : 5, holdMs = opts.holdMs || 150, windowMs = opts.windowMs || 8000;
    st = { confirmed: st.confirmed.slice(), start: st.start, cand: st.cand, candSince: st.candSince };
    let event = null;
    if (st.start != null && f.t - st.start > windowMs) { st = newSweep(); event = 'reset'; }
    const ok = f.index != null && Math.abs(f.cents) <= tol;
    if (!ok) { st.cand = null; return { state: st, event }; }
    if (st.cand !== f.index) { st.cand = f.index; st.candSince = f.t; }
    if (f.t - st.candSince >= holdMs && st.confirmed.indexOf(f.index) < 0) {
      if (st.start == null) st.start = f.t;
      st.confirmed.push(f.index); event = 'confirm';
      if (st.confirmed.length === 6) {
        const ordered = st.confirmed.every((v, i) => v === i);
        return { state: newSweep(), event: 'success', ordered, confirmed: st.confirmed };
      }
    }
    return { state: st, event };
  }

  const api = { detectPitch, nearestString, STRINGS, newSweep, sweepStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Needle = api;
  if (typeof document === 'undefined') return;

  // ---------------- UI ----------------
  const $ = id => document.getElementById(id);
  const MAX_ANGLE = 60; // degrees at ±50 cents
  function buildGauge() {
    const g = $('ticks'); const NS = 'http://www.w3.org/2000/svg';
    for (let c = -50; c <= 50; c += 5) {
      const ang = (c / 50) * MAX_ANGLE * Math.PI / 180;
      const major = c % 10 === 0, center = c === 0;
      const r1 = 200, r2 = center ? 166 : major ? 178 : 188;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', 250 + r1 * Math.sin(ang)); l.setAttribute('y1', 250 - r1 * Math.cos(ang));
      l.setAttribute('x2', 250 + r2 * Math.sin(ang)); l.setAttribute('y2', 250 - r2 * Math.cos(ang));
      l.setAttribute('class', center ? 'tick center' : major ? 'tick major' : 'tick');
      g.appendChild(l);
      if (major && !center) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', 250 + 150 * Math.sin(ang)); t.setAttribute('y', 250 - 150 * Math.cos(ang) + 4);
        t.setAttribute('class', 'tick-label'); t.textContent = (c > 0 ? '+' : '') + c; g.appendChild(t);
      }
    }
    const row = $('strings');
    STRINGS.forEach((s, i) => { const d = document.createElement('div'); d.className = 'string'; d.id = 's' + i; d.innerHTML = s.name + '<sub>' + s.oct + '</sub>'; row.appendChild(d); });
  }

  // Spring physics needle
  let angle = 0, vel = 0, target = 0, lastT = 0, lastHit = 0, smoothCents = null;
  function animate(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
    const kSpring = 60, damp = 2 * Math.sqrt(kSpring) * 0.75;
    vel += (kSpring * (target - angle) - damp * vel) * dt; angle += vel * dt;
    $('needle').setAttribute('transform', 'rotate(' + angle.toFixed(2) + ' 250 250)');
    if (performance.now() - lastHit > 600) { target = 0; smoothCents = null; idle(); }
    if (sweep.start != null && performance.now() - sweep.start > 8000) { sweep = newSweep(); paintSweep(); }
    requestAnimationFrame(animate);
  }
  let sweep = newSweep(), celebrating = false;
  function paintSweep() {
    document.querySelectorAll('.string').forEach((e, i) => e.classList.toggle('done', sweep.confirmed.indexOf(i) >= 0));
  }
  function celebrate(ordered) {
    if (celebrating) return; celebrating = true;
    const c = $('celebrate');
    $('celebrate-sub').textContent = ordered ? 'Low to high, clean sweep' : 'Clean sweep';
    document.querySelectorAll('.string').forEach(e => e.classList.add('done'));
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    setTimeout(() => { c.classList.remove('show'); celebrating = false; paintSweep(); }, 2800);
  }
  function feedSweep(index, cents) {
    const r = sweepStep(sweep, { index, cents, t: performance.now() });
    sweep = r.state;
    if (r.event === 'success') celebrate(r.ordered);
    if (r.event) paintSweep();
  }
  function idle() {
    $('note').innerHTML = '&ndash;'; $('cents').textContent = '— ¢'; $('hz').textContent = '— Hz';
    document.body.classList.remove('intune');
    document.querySelectorAll('.string').forEach(e => e.classList.remove('active'));
  }
  function show(res) {
    const ns = nearestString(res.freq);
    smoothCents = smoothCents == null ? ns.cents : smoothCents * 0.6 + ns.cents * 0.4;
    const c = Math.max(-50, Math.min(50, smoothCents));
    target = (c / 50) * MAX_ANGLE; lastHit = performance.now();
    $('note').innerHTML = ns.string.name + '<sub>' + ns.string.oct + '</sub>';
    $('cents').textContent = (smoothCents >= 0 ? '+' : '−') + Math.abs(smoothCents).toFixed(1) + ' ¢';
    $('hz').textContent = res.freq.toFixed(2) + ' Hz';
    document.body.classList.toggle('intune', Math.abs(smoothCents) <= 5);
    document.querySelectorAll('.string').forEach((e, i) => e.classList.toggle('active', i === ns.index));
    feedSweep(ns.index, smoothCents);
  }

  async function start() {
    const btn = $('start');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 4096; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      btn.textContent = 'Listening'; btn.disabled = true; $('status').textContent = 'Pluck a string.';
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const r = detectPitch(buf, ctx.sampleRate, { rmsThreshold: 0.008, clarityThreshold: 0.85 });
        if (r) show(r); else feedSweep(null, 0);
      }, 50);
    } catch (e) {
      $('status').textContent = 'Microphone unavailable: ' + e.message + ' (needs localhost/https and permission).';
    }
  }
  document.addEventListener('DOMContentLoaded', () => { buildGauge(); idle(); $('start').addEventListener('click', start); requestAnimationFrame(animate); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
