const { newSweep, sweepStep } = require('../app.js');
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
r = play([0,1,2,3,4,5], 2000);
check('window over 8s resets, no success', !r.last);
let st = newSweep(); st = sweepStep(st, { index: 2, cents: 0, t: 0 }).state; st = sweepStep(st, { index: 2, cents: 0, t: 100 }).state;
check('held under 150ms not confirmed', st.confirmed.length === 0);
process.exit(fail ? 1 : 0);
