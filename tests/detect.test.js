const { detectPitch, nearestString, STRINGS } = require('../app.js');
let fail = 0;
for (const sr of [44100, 48000]) for (const s of STRINGS) for (const kind of ['harm', 'saw']) {
  const n = 4096, buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, env = Math.exp(-3 * t); let v = 0;
    if (kind === 'saw') { const ph = (t * s.f) % 1; v = 2 * ph - 1; }
    else for (let h = 1; h <= 10; h++) v += Math.exp(-0.4 * t * h) * (h === 2 ? 1.2 : 1 / h) * Math.sin(2 * Math.PI * s.f * h * t + h);
    buf[i] = 0.3 * env * v + (Math.random() - 0.5) * 0.005;
  }
  const r = detectPitch(buf, sr); const ok = r && Math.abs(r.freq - s.f) <= 1;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${sr} ${kind.padEnd(4)} ${s.name}${s.oct} ${s.f} -> ${r ? r.freq.toFixed(3) : 'null'} (${r ? nearestString(r.freq).cents.toFixed(2) : '-'}c)`);
}
console.log(detectPitch(new Float32Array(4096), 48000) === null ? 'PASS silence gated' : (fail++, 'FAIL silence'));
process.exit(fail ? 1 : 0);
