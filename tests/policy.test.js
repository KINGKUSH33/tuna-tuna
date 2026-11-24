const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const T = require('../app.js');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fail++;
};

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const DISCLOSURE = T.MIC_DISCLOSURE_TEXT;
const TIP = T.TIP_JAR_EXPLAIN;

check('disclosure sentence is the Play copy',
  DISCLOSURE === 'Tuna Tuna uses your microphone only in real time on your device to detect pitch. Audio is never recorded, saved, or sent anywhere.');
check('tip copy says free and unlocks nothing',
  TIP === 'Tuna Tuna is 100% free with every feature unlocked. Optional tips go directly to the creator and unlock nothing.');
check('empty tip url', T.resolveTipJarUrl('') === '' && T.resolveTipJarUrl('   ') === '' && T.resolveTipJarUrl(null) === '');
check('https tip url', T.resolveTipJarUrl('https://paypal.me/example') === 'https://paypal.me/example');
check('http tip url', T.resolveTipJarUrl('http://ko-fi.com/example') === 'http://ko-fi.com/example');
check('non-http tip url is ignored', T.resolveTipJarUrl('javascript:alert(1)') === '' && T.resolveTipJarUrl('file:///tmp/x') === '');
check('denied mic message names the refusal',
  T.micAccessMessage({ name: 'NotAllowedError', message: 'Permission denied' }).includes('Microphone access was denied') &&
  T.micAccessMessage({ name: 'NotAllowedError' }).includes('never recorded'));

const PRODUCT = ['index.html', 'privacy.html', 'app.js', 'config.js', 'styles.css', 'sw.js', 'manifest.webmanifest'];
for (const file of PRODUCT) {
  check(file + ' has no donate wording', !/donat/i.test(read(file)));
}

const privacy = read('privacy.html');
check('privacy mentions on-device realtime audio',
  /on-device/i.test(privacy) && /real time/i.test(privacy) && /never recorded, stored, transmitted, or shared/i.test(privacy));
check('privacy lists local tuner preferences',
  /A4 calibration/.test(privacy) && /tuning preset/i.test(privacy) && /mode/.test(privacy) && /only locally/i.test(privacy));
check('privacy refuses ads analytics tracking',
  /no ads/i.test(privacy) && /no analytics/i.test(privacy) && /no tracking/i.test(privacy) && /personal data/i.test(privacy));
check('privacy explains the external tip',
  /optional tip/i.test(privacy) && /browser/i.test(privacy) && /payment provider/i.test(privacy) && /their own privacy policy/i.test(privacy));
check('privacy links the repo', privacy.includes('https://github.com/KINGKUSH33/tuna-tuna'));
check('index links privacy.html', /<a class="privacy-link" href="privacy.html">Privacy<\/a>/.test(read('index.html')));
check('index has the tip control', read('index.html').includes('>Tip the developer<'));
check('service worker caches v3.1, privacy, and config',
  read('sw.js').includes("'tuna-tuna-v3.1'") && read('sw.js').includes('privacy.html') && read('sw.js').includes('config.js'));

function audioStub() {
  return class AudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = {};
    }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; }
    createAnalyser() {
      return {
        fftSize: 2048,
        smoothingTimeConstant: 0,
        connect() {},
        getFloatTimeDomainData(buf) { buf.fill(0); }
      };
    }
    createBuffer() { return { getChannelData() { return new Float32Array(8); } }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null }; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
  };
}

function loadApp(opts) {
  opts = opts || {};
  const html = read('index.html');
  const dom = new JSDOM(html, {
    url: 'https://kingkush33.github.io/tuna-tuna/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const window = dom.window;
  const calls = [];
  let getUserMedia = (constraints) => {
    calls.push(constraints);
    return Promise.resolve({ getTracks() { return []; } });
  };
  if (opts.getUserMedia) getUserMedia = opts.getUserMedia(calls);
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  });
  const AudioContext = audioStub();
  window.AudioContext = AudioContext;
  window.webkitAudioContext = AudioContext;
  const opens = [];
  window.open = (url, target, features) => {
    opens.push({ url, target, features });
    return { opener: window };
  };
  const nativeCalls = [];
  if (opts.native) {
    window.TunaNative = {
      ensureRecordAudio() { nativeCalls.push('ensure'); window.__tunaMicResult(opts.nativeAllow !== false); },
      openExternal(url) { nativeCalls.push(url); }
    };
  }
  window.eval(read('config.js'));
  if (opts.tipUrl != null) window.TIP_JAR_URL = opts.tipUrl;
  if (opts.accepted) window.localStorage.setItem('tt.micDisclosure', 'accepted');
  window.eval(read('app.js'));
  return { window, document: window.document, calls, opens, nativeCalls, dom };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const first = loadApp();
  const doc = first.document;
  const modal = doc.getElementById('mic-disclosure');
  const privacy = doc.querySelector('a.privacy-link');
  check('privacy link opens privacy.html', privacy && privacy.getAttribute('href') === 'privacy.html' && privacy.textContent === 'Privacy');
  check('disclosure starts hidden', modal.hidden === true);
  check('disclosure copy is on the page', doc.getElementById('mic-disclosure-copy').textContent === DISCLOSURE);
  doc.getElementById('start').click();
  check('disclosure shows before any microphone request', modal.hidden === false && first.calls.length === 0);
  doc.getElementById('mic-disclosure-cancel').click();
  check('not now leaves the prompt unaccepted', modal.hidden === true && first.window.localStorage.getItem('tt.micDisclosure') == null && first.calls.length === 0);

  doc.getElementById('start').click();
  doc.getElementById('mic-disclosure-accept').click();
  await delay(40);
  check('continue stores acceptance', first.window.localStorage.getItem('tt.micDisclosure') === 'accepted');
  check('continue then requests raw audio',
    first.calls.length === 1 &&
    first.calls[0].audio.echoCancellation === false &&
    first.calls[0].audio.noiseSuppression === false &&
    first.calls[0].audio.autoGainControl === false);
  check('listening after a grant', doc.getElementById('start').textContent === 'Listening');

  const back = loadApp({ accepted: true });
  back.document.getElementById('start').click();
  await delay(20);
  check('returning user skips the disclosure',
    back.document.getElementById('mic-disclosure').hidden === true && back.calls.length === 1);

  const denied = loadApp({
    accepted: true,
    getUserMedia(calls) {
      return (constraints) => {
        calls.push(constraints);
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      };
    }
  });
  denied.document.getElementById('start').click();
  await delay(20);
  const deniedText = denied.document.getElementById('status').textContent;
  check('denial is a single request and a clear message',
    denied.calls.length === 1 && /denied/i.test(deniedText) && /never recorded/i.test(deniedText));
  check('denial re-enables start', denied.document.getElementById('start').disabled === false && denied.document.getElementById('start').textContent === 'Start tuner');

  const loose = loadApp({
    accepted: true,
    getUserMedia(calls) {
      return (constraints) => {
        calls.push(constraints);
        if (calls.length === 1) {
          const err = new Error('overconstrained');
          err.name = 'OverconstrainedError';
          return Promise.reject(err);
        }
        return Promise.resolve({ getTracks() { return []; } });
      };
    }
  });
  loose.document.getElementById('start').click();
  await delay(20);
  check('raw constraints stay first, ideal false is only the fallback',
    loose.calls.length === 2 &&
    loose.calls[0].audio.echoCancellation === false &&
    loose.calls[1].audio.echoCancellation.ideal === false &&
    loose.calls[1].audio.noiseSuppression.ideal === false &&
    loose.calls[1].audio.autoGainControl.ideal === false);

  const emptyTip = loadApp();
  emptyTip.document.getElementById('tip').click();
  const soon = emptyTip.document.getElementById('tip-soon');
  const tipOpen = emptyTip.document.getElementById('tip-open');
  check('empty tip jar explains the policy', emptyTip.document.getElementById('tip-copy').textContent === TIP);
  check('empty tip jar says the link is coming soon', soon.hidden === false && soon.textContent === T.TIP_JAR_SOON);
  check('empty tip jar has no link', tipOpen.hidden === true && !tipOpen.hasAttribute('href') && emptyTip.opens.length === 0);
  check('tip control label', emptyTip.document.getElementById('tip').textContent === 'Tip the developer');

  const tip = loadApp({ tipUrl: 'https://paypal.me/example' });
  tip.document.getElementById('tip').click();
  const open = tip.document.getElementById('tip-open');
  check('configured tip link is external',
    open.hidden === false &&
    open.getAttribute('href') === 'https://paypal.me/example' &&
    open.getAttribute('target') === '_blank' &&
    open.getAttribute('rel').includes('noopener') &&
    open.getAttribute('rel').includes('noreferrer') &&
    tip.document.getElementById('tip-soon').hidden === true);
  open.click();
  check('web tip opens a new tab',
    tip.opens.length === 1 && tip.opens[0].url === 'https://paypal.me/example' && tip.opens[0].target === '_blank' && String(tip.opens[0].features).includes('noopener'));

  const native = loadApp({ tipUrl: 'https://ko-fi.com/example', native: true, nativeAllow: true, accepted: true });
  native.document.getElementById('tip').click();
  native.document.getElementById('tip-open').click();
  check('android tip uses the external intent',
    native.nativeCalls.includes('https://ko-fi.com/example') && native.opens.length === 0);
  native.document.getElementById('start').click();
  await delay(20);
  check('android asks the native bridge before getUserMedia',
    native.nativeCalls.includes('ensure') && native.calls.length === 1);

  const blocked = loadApp({ native: true, nativeAllow: false, accepted: true });
  blocked.document.getElementById('start').click();
  await delay(20);
  check('native denial skips getUserMedia',
    blocked.calls.length === 0 && /denied/i.test(blocked.document.getElementById('status').textContent));

  const policyPage = new JSDOM(read('privacy.html'), { url: 'https://kingkush33.github.io/tuna-tuna/privacy.html' });
  const policyText = policyPage.window.document.body.textContent;
  check('privacy page shows the microphone sentence', policyText.includes('never recorded, stored, transmitted, or shared'));
  check('privacy page shows the repo link',
    policyPage.window.document.querySelector('a[href="https://github.com/KINGKUSH33/tuna-tuna"]') != null);

  [first, back, denied, loose, emptyTip, tip, native, blocked].forEach(session => {
    session.window.close();
  });
  policyPage.window.close();
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
