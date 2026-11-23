/*
 * Tests for the pure signal functions in app/public/signal.js.
 * Run: node tests/test_signal.js   (from ~/workspace/hackathons/presage)
 * Synthetic signals with known rates must come back close to those rates.
 */
'use strict';
const assert = require('assert');
const S = require('../app/public/signal.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// Deterministic pseudo-noise so the tests never flake.
function noise(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

function makeSignal(fs, seconds, freqHz, opts) {
  opts = opts || {};
  const rnd = noise(opts.seed || 42);
  const amp = opts.amp != null ? opts.amp : 1;
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 0.25;
  const drift = opts.drift != null ? opts.drift : 0.6;
  const out = [];
  const n = Math.floor(fs * seconds);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    out.push(
      100 +
        amp * Math.sin(2 * Math.PI * freqHz * t) +
        drift * Math.sin(2 * Math.PI * 0.05 * t) +
        noiseAmp * rnd()
    );
  }
  return out;
}

check('pulse: 72 bpm sine + noise reads back within ±3 bpm', () => {
  const sig = makeSignal(30, 12, 72 / 60);
  const r = S.estimatePulse(sig, 30);
  assert(r, 'expected an estimate');
  assert(Math.abs(r.bpm - 72) <= 3, 'got ' + r.bpm);
});

check('pulse: 120 bpm sine + noise reads back within ±3 bpm', () => {
  const sig = makeSignal(30, 12, 120 / 60, { seed: 7 });
  const r = S.estimatePulse(sig, 30);
  assert(r, 'expected an estimate');
  assert(Math.abs(r.bpm - 120) <= 3, 'got ' + r.bpm);
});

check('pulse: 55 bpm sine + noise reads back within ±3 bpm', () => {
  const sig = makeSignal(30, 12, 55 / 60, { seed: 99 });
  const r = S.estimatePulse(sig, 30);
  assert(r, 'expected an estimate');
  assert(Math.abs(r.bpm - 55) <= 3, 'got ' + r.bpm);
});

check('breathing: 12 breaths/min reads back within ±2', () => {
  const sig = makeSignal(30, 30, 12 / 60, { seed: 5, noiseAmp: 0.2 });
  const r = S.estimateBreathing(sig, 30);
  assert(r, 'expected an estimate');
  assert(Math.abs(r.breathsPerMin - 12) <= 2, 'got ' + r.breathsPerMin);
});

check('breathing: 18 breaths/min reads back within ±2', () => {
  const sig = makeSignal(30, 30, 18 / 60, { seed: 11, noiseAmp: 0.2 });
  const r = S.estimateBreathing(sig, 30);
  assert(r, 'expected an estimate');
  assert(Math.abs(r.breathsPerMin - 18) <= 2, 'got ' + r.breathsPerMin);
});

check('too little data returns null', () => {
  assert.strictEqual(S.estimatePulse([1, 2, 3], 30), null);
  assert.strictEqual(S.estimatePulse(makeSignal(30, 2, 1.2), 30), null);
});

check('clean rhythm scores higher quality than pure noise', () => {
  const clean = S.estimatePulse(makeSignal(30, 12, 1.2, { noiseAmp: 0.05 }), 30);
  const rnd = noise(3);
  const pureNoise = Array.from({ length: 360 }, () => 100 + rnd());
  const noisy = S.estimatePulse(pureNoise, 30);
  assert(clean.quality > noisy.quality,
    'clean ' + clean.quality + ' should beat noise ' + noisy.quality);
  assert.strictEqual(S.qualityLabel(clean.quality), 'good');
});

check('qualityLabel bands', () => {
  assert.strictEqual(S.qualityLabel(0.9), 'good');
  assert.strictEqual(S.qualityLabel(0.3), 'weak');
  assert.strictEqual(S.qualityLabel(0.05), 'none');
  assert.strictEqual(S.qualityLabel(null), 'none');
});

check('sustainedAbove: needs the full hold window above threshold', () => {
  const mk = (arr) => arr.map(([t, bpm]) => ({ t, bpm }));
  assert.strictEqual(S.sustainedAbove(mk([[0, 105], [2, 108], [4, 110], [6, 107]]), 100, 5), true);
  assert.strictEqual(S.sustainedAbove(mk([[0, 105], [2, 95], [4, 110], [6, 107]]), 100, 5), false);
  assert.strictEqual(S.sustainedAbove(mk([[4, 110], [6, 107]]), 100, 5), false); // not enough history
  assert.strictEqual(S.sustainedAbove(mk([[0, 105], [6, 90]]), 100, 5), false); // latest below
  assert.strictEqual(S.sustainedAbove([], 100, 5), false);
});

console.log('\n' + passed + ' tests passed');
