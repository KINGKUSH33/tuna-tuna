const { newSweep, sweepStep, SWEEP_HOLD_MS, SWEEP_WINDOW_MS } = require('../app.js');
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) fail++; };
function play(order, gap, cents = 1, hold = 200) {
  let st = newSweep(), t = 0, last = null;
  for (const idx of order) {
    for (let d = 0; d <= hold; d += 50) { const r = sweepStep(st, { index: idx, cents, t: t + d }); st = r.state; if (r.event === 'success') last = r; }
    t += hold; st = sweepStep(st, { index: null, cents: 0, t }).state; t += gap;
  }
  return { st, last };
}
let r = play([0,1,2,3,4,5], 300);
check('low-to-high sweep succeeds, ordered', r.last && r.last.ordered === true);
r = play([5,2,0,4,1,3], 300);
check('any-order sweep succeeds, not ordered', r.last && r.last.ordered === false);
r = play([0,1,2,3,4,5], 300, 8);
check('out of tune (8c) does not count', !r.last && r.st.confirmed.length === 0);
r = play([0,0,1,1,2,3,4], 200);
check('repeats count once, 5 distinct no success', !r.last && r.st.confirmed.length === 5);
r = play([0,1,2,3,4,5], 2500);
check('rolling 20s window allows relaxed 2.5s gaps', r.last && r.last.ordered === true);
r = play([0,1,2,3,4,5], SWEEP_WINDOW_MS + 1000);
check('gap over 20s since last string resets, no success', !r.last);
let st = newSweep();
st = sweepStep(st, { index: 2, cents: 0, t: 0 }).state;
st = sweepStep(st, { index: 2, cents: 0, t: SWEEP_HOLD_MS }).state;
check('brief ' + SWEEP_HOLD_MS + 'ms in-tune pluck is confirmed', st.confirmed.length === 1);
st = newSweep();
st = sweepStep(st, { index: 2, cents: 0, t: 0 }).state;
st = sweepStep(st, { index: 2, cents: 0, t: SWEEP_HOLD_MS - 10 }).state;
check('held under ' + SWEEP_HOLD_MS + 'ms not confirmed', st.confirmed.length === 0);
// Rolling window: 19s after string 0, string 1 still counts; then a 21s wait resets.
st = newSweep();
st = sweepStep(st, { index: 0, cents: 0, t: 0 }).state;
st = sweepStep(st, { index: 0, cents: 0, t: SWEEP_HOLD_MS }).state;
st = sweepStep(st, { index: 1, cents: 0, t: 19000 }).state;
st = sweepStep(st, { index: 1, cents: 0, t: 19000 + SWEEP_HOLD_MS }).state;
check('rolling timer: 19s later still confirms next string', st.confirmed.length === 2 && st.confirmed[1] === 1);
st = sweepStep(st, { index: 2, cents: 0, t: 19000 + SWEEP_HOLD_MS + 21000 }).state;
check('rolling timer: 21s later resets progress', st.confirmed.length === 0);
check('defaults are a brief hold and a 20s rolling window', SWEEP_HOLD_MS === 40 && SWEEP_WINDOW_MS === 20000);
process.exit(fail ? 1 : 0);
