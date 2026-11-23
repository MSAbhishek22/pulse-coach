/*
 * signal.js — small, honest signal helpers shared by the browser page and
 * the Node tests. No dependencies. UMD: works as a browser global
 * (window.PulseSignal) and via require() in Node.
 *
 * What this does: given a sampled brightness/colour series (for example the
 * mean green value of a face region, once per video frame), estimate the
 * dominant repeating rate inside a frequency band — pulse (0.7–3 Hz) or
 * breathing (0.1–0.5 Hz) — and say how strong that rhythm is.
 *
 * What this does not do: it is not a medical measurement. It is a rough
 * estimate from a noisy camera signal, and the page says so.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PulseSignal = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Remove slow drift: subtract a centred moving average. */
  function detrend(samples, windowSize) {
    var n = samples.length;
    var out = new Array(n);
    var half = Math.floor(windowSize / 2);
    // Prefix sums for a fast moving average.
    var prefix = new Array(n + 1);
    prefix[0] = 0;
    for (var i = 0; i < n; i++) prefix[i + 1] = prefix[i] + samples[i];
    for (var j = 0; j < n; j++) {
      var a = Math.max(0, j - half);
      var b = Math.min(n - 1, j + half);
      var mean = (prefix[b + 1] - prefix[a]) / (b - a + 1);
      out[j] = samples[j] - mean;
    }
    return out;
  }

  /** Power of a detrended series at one frequency (Goertzel). */
  function powerAt(samples, fs, freq) {
    var n = samples.length;
    var w = (2 * Math.PI * freq) / fs;
    var coeff = 2 * Math.cos(w);
    var s0 = 0, s1 = 0, s2 = 0;
    for (var i = 0; i < n; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }

  /**
   * Estimate the dominant rate in [minHz, maxHz].
   * Returns { ratePerMin, freqHz, quality } where quality is the share of
   * in-band power sitting at the peak (0–1). Returns null when there is not
   * enough data.
   */
  function estimateRate(samples, fs, minHz, maxHz) {
    if (!samples || samples.length < fs * 4) return null; // need >= ~4 s
    var trendWindow = Math.max(3, Math.round(fs * 1.5));
    var x = detrend(samples, trendWindow);
    // Hann window to soften the edges.
    var n = x.length;
    for (var i = 0; i < n; i++) {
      x[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    var step = 0.01;
    var bestFreq = 0, bestPower = -1, totalPower = 0, count = 0;
    for (var f = minHz; f <= maxHz + 1e-9; f += step) {
      var p = powerAt(x, fs, f);
      totalPower += p;
      count++;
      if (p > bestPower) { bestPower = p; bestFreq = f; }
    }
    var meanPower = count > 0 ? totalPower / count : 0;
    // A clear rhythm stands well above the average in-band power.
    var quality = meanPower > 0 ? Math.min(1, bestPower / (meanPower * 12)) : 0;
    return {
      ratePerMin: bestFreq * 60,
      freqHz: bestFreq,
      quality: quality,
      peakPower: bestPower,
      meanPower: meanPower,
    };
  }

  /** Pulse estimate from a brightness series sampled at fs Hz. */
  function estimatePulse(samples, fs) {
    var r = estimateRate(samples, fs, 0.7, 3.0); // 42–180 bpm
    if (!r) return null;
    return { bpm: r.ratePerMin, quality: r.quality };
  }

  /** Breathing estimate from a brightness/motion series sampled at fs Hz. */
  function estimateBreathing(samples, fs) {
    var r = estimateRate(samples, fs, 0.1, 0.5); // 6–30 breaths/min
    if (!r) return null;
    return { breathsPerMin: r.ratePerMin, quality: r.quality };
  }

  /**
   * Plain-language signal quality from an estimate's quality score.
   * Returns 'good' | 'weak' | 'none'.
   */
  function qualityLabel(quality) {
    if (quality == null || isNaN(quality)) return 'none';
    if (quality >= 0.45) return 'good';
    if (quality >= 0.2) return 'weak';
    return 'none';
  }

  /**
   * The reaction rule (WATCHES pattern): a flag rises only when the pulse
   * stays at or above the threshold for the whole hold window, so one noisy
   * second cannot trigger it.
   * readings: array of { t (seconds), bpm } in time order.
   */
  function sustainedAbove(readings, threshold, holdSeconds) {
    if (!readings || readings.length === 0) return false;
    var last = readings[readings.length - 1];
    if (last.bpm < threshold) return false;
    var since = last.t - holdSeconds;
    for (var i = readings.length - 1; i >= 0; i--) {
      if (readings[i].t < since) break;
      if (readings[i].bpm < threshold) return false;
      if (readings[i].t <= since) return true;
    }
    // Window covered back to the first reading: only counts if the first
    // reading is at or before the start of the hold window.
    return readings[0].t <= since;
  }

  return {
    detrend: detrend,
    powerAt: powerAt,
    estimateRate: estimateRate,
    estimatePulse: estimatePulse,
    estimateBreathing: estimateBreathing,
    qualityLabel: qualityLabel,
    sustainedAbove: sustainedAbove,
  };
});
