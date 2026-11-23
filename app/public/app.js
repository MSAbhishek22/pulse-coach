/*
 * Pulse Coach — browser logic.
 *
 * Signal sources (always labelled on screen):
 *  - "presage": the server runs the real SmartSpectra SDK and streams its
 *    metrics here over Server-Sent Events.
 *  - "local": no Presage key on the server, so this page makes its own
 *    rough estimate from the webcam, on-device (see signal.js). The page
 *    says plainly that this is an estimate, not a Presage reading.
 *
 * The reaction is the same either way (WATCHES pattern): watch the pulse,
 * and only when it stays high for a full 5 seconds, flag it and start the
 * breathing guide. One noisy second never triggers anything.
 */
(function () {
  'use strict';
  var S = window.PulseSignal;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    idle: $('state-idle'), loading: $('state-loading'), error: $('state-error'),
    live: $('state-live'), errorText: $('error-text'), startNote: $('start-note'),
    sourceLabel: $('source-label'), pulseNum: $('pulse-num'), breathNum: $('breath-num'),
    qualityText: $('quality-text'), qualityBar: $('quality-bar'),
    cam: $('cam'), wave: $('wave'), liveNote: $('live-note'), hintLine: $('hint-line'),
    flagCard: $('flag-card'), flagStats: $('flag-stats'),
    settledCard: $('settled-card'), settledText: $('settled-text'),
    breathCircle: $('breath-circle'), breathWord: $('breath-word'),
  };

  var HIGH_BPM = 100;      // flag threshold
  var SETTLE_BPM = 90;     // settled threshold
  var HOLD_SECONDS = 5;    // how long a level must hold before we react

  var mode = null;               // 'presage' | 'local'
  var stream = null;             // MediaStream (local)
  var es = null;                 // EventSource (presage)
  var rafId = null, tickId = null;
  var samples = [];              // local mode: {t, v} green-mean samples
  var readings = [];             // both modes: {t, bpm}
  var pulseHistory = [];         // presage mode waveform: recent bpm values
  var flagOn = false, flagSince = 0, peakBpm = 0;
  var breathTimers = [];
  var lastBpm = null;

  function show(state) {
    els.idle.classList.toggle('hidden', state !== 'idle');
    els.loading.classList.toggle('hidden', state !== 'loading');
    els.error.classList.toggle('hidden', state !== 'error');
    els.live.classList.toggle('hidden', state !== 'live');
  }

  function showError(text) {
    stopAll();
    els.errorText.textContent = text;
    show('error');
  }

  // ---------- shared reading / reaction logic ----------

  function sustainedBelow(list, threshold, holdSeconds) {
    if (!list.length) return false;
    var last = list[list.length - 1];
    if (last.bpm >= threshold) return false;
    var since = last.t - holdSeconds;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].t < since) break;
      if (list[i].bpm >= threshold) return false;
      if (list[i].t <= since) return true;
    }
    return list[0].t <= since;
  }

  function onReading(bpm, quality01, nowSec) {
    if (lastBpm != null) bpm = Math.round((bpm + lastBpm) / 2); // light smoothing
    lastBpm = bpm;
    readings.push({ t: nowSec, bpm: bpm });
    while (readings.length && readings[0].t < nowSec - 300) readings.shift();
    if (bpm > peakBpm) peakBpm = bpm;

    els.pulseNum.textContent = String(bpm);
    if (quality01 != null) {
      var label = S.qualityLabel(quality01);
      els.qualityText.textContent = label;
      els.qualityBar.style.width = Math.round(quality01 * 100) + '%';
    }

    if (!flagOn && S.sustainedAbove(readings, HIGH_BPM, HOLD_SECONDS)) {
      flagOn = true;
      flagSince = nowSec;
      els.settledCard.classList.add('hidden');
      els.flagCard.classList.remove('hidden');
      startBreathingGuide();
    } else if (flagOn && sustainedBelow(readings, SETTLE_BPM, HOLD_SECONDS)) {
      flagOn = false;
      stopBreathingGuide();
      els.flagCard.classList.add('hidden');
      var mins = Math.max(1, Math.round((nowSec - flagSince) / 60 * 10) / 10);
      els.settledText.textContent =
        'Your pulse came back under ' + SETTLE_BPM + '. It peaked at ' + peakBpm +
        ' beats per minute, and the high stretch lasted about ' + mins + ' minute' +
        (mins === 1 ? '' : 's') + '. That is the whole trick: notice it, slow the out-breath, wait.';
      els.settledCard.classList.remove('hidden');
    }
    if (flagOn) {
      els.flagStats.textContent = 'Peak so far: ' + peakBpm + ' beats per minute.';
    }
  }

  // ---------- breathing guide ----------

  function startBreathingGuide() {
    stopBreathingGuide();
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function cycle() {
      els.breathWord.textContent = 'breathe in';
      if (!reduced) {
        els.breathCircle.style.transition = 'transform 4s ease-in-out';
        els.breathCircle.style.transform = 'scale(1)';
      }
      breathTimers.push(setTimeout(function () {
        els.breathWord.textContent = 'breathe out';
        if (!reduced) {
          els.breathCircle.style.transition = 'transform 6s ease-in-out';
          els.breathCircle.style.transform = 'scale(0.72)';
        }
        breathTimers.push(setTimeout(cycle, 6000));
      }, 4000));
    }
    cycle();
  }
  function stopBreathingGuide() {
    breathTimers.forEach(clearTimeout);
    breathTimers = [];
  }

  // ---------- waveform ----------

  function drawWave(values, colour) {
    var ctx = els.wave.getContext('2d');
    var w = els.wave.width, h = els.wave.height;
    ctx.clearRect(0, 0, w, h);
    if (!values || values.length < 2) return;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (max - min < 1e-6) { max = min + 1; }
    ctx.beginPath();
    ctx.strokeStyle = colour || '#0e7a4f';
    ctx.lineWidth = 2;
    values.forEach(function (v, i) {
      var x = (i / (values.length - 1)) * (w - 8) + 4;
      var y = h - 10 - ((v - min) / (max - min)) * (h - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ---------- local mode (browser rPPG estimate) ----------

  var sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 160; sampleCanvas.height = 120;

  function startLocal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser cannot use a camera here. Try a recent Chrome, Edge, Firefox or Safari, served over https or localhost.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(function (s) {
        stream = s;
        mode = 'local';
        els.cam.srcObject = s;
        els.cam.classList.remove('hidden');
        els.sourceLabel.textContent = 'local estimate in your browser — not a Presage reading';
        els.liveNote.textContent = 'This mode has no Presage key, so the page estimates your pulse itself, on this device. Sit still, face the light, and give it about ten seconds.';
        show('live');
        sampleLoop();
        tickId = setInterval(localTick, 1000);
      })
      .catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          showError('Camera permission was not given, so nothing can be measured. That is your call — press Try again if you change your mind.');
        } else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
          showError('No camera was found on this device. The Presage mode on a server with a camera and a key would still work.');
        } else {
          showError('The camera did not start (' + (err && err.name ? err.name : 'unknown error') + '). Press Try again, or check that no other app is using the camera.');
        }
      });
  }

  function sampleLoop() {
    var ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    var lastPush = 0;
    function frame(now) {
      rafId = requestAnimationFrame(frame);
      if (now - lastPush < 33) return; // ~30 fps
      lastPush = now;
      if (els.cam.readyState < 2) return;
      ctx.drawImage(els.cam, 0, 0, 160, 120);
      // Centre, slightly high: where a seated face usually is.
      var x0 = 56, y0 = 24, w = 48, h = 48;
      var img = ctx.getImageData(x0, y0, w, h).data;
      var sum = 0, count = 0;
      for (var i = 0; i < img.length; i += 16) { // every 4th pixel is plenty
        sum += img[i + 1]; // green channel
        count++;
      }
      var t = performance.now() / 1000;
      samples.push({ t: t, v: sum / count });
      while (samples.length && samples[0].t < t - 35) samples.shift();
    }
    rafId = requestAnimationFrame(frame);
  }

  // Build a uniform fs-Hz series over the last `seconds` by interpolation.
  function uniformSeries(seconds, fs) {
    if (samples.length < 10) return null;
    var end = samples[samples.length - 1].t;
    var start = end - seconds;
    var n = Math.floor(seconds * fs);
    var out = new Array(n);
    var j = 0;
    for (var i = 0; i < n; i++) {
      var t = start + i / fs;
      while (j < samples.length - 2 && samples[j + 1].t < t) j++;
      var a = samples[j], b = samples[j + 1] || a;
      if (t <= a.t) { out[i] = a.v; continue; }
      if (b.t === a.t) { out[i] = a.v; continue; }
      out[i] = a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
    }
    return out;
  }

  function localTick() {
    var series = uniformSeries(12, 30);
    if (!series) return;
    var r = S.estimatePulse(series, 30);
    // Waveform: the detrended signal itself.
    drawWave(S.detrend(series, 45).slice(-360));
    if (!r) return;
    onReading(Math.round(r.bpm), r.quality, performance.now() / 1000);
  }

  // ---------- Presage mode (SmartSpectra SDK on the server) ----------

  function startPresage() {
    mode = 'presage';
    els.cam.classList.add('hidden');
    els.sourceLabel.textContent = 'Presage SmartSpectra SDK (live, on the server)';
    els.liveNote.textContent = 'The SmartSpectra SDK is measuring on the server machine\u2019s camera. The chart below is your pulse over the last minute, as the SDK reports it.';
    show('live');
    var gotStarted = false;
    es = new EventSource('/api/stream');
    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'started') { gotStarted = true; return; }
      if (msg.type === 'no-key') { es.close(); es = null; startLocal(); return; }
      if (msg.type === 'error') {
        es.close(); es = null;
        if (!gotStarted) { startLocal(); }
        else showError('The SmartSpectra SDK stopped: ' + msg.message);
        return;
      }
      if (msg.type === 'hint') { els.hintLine.textContent = 'Camera hint: ' + msg.hint; return; }
      if (msg.type === 'metrics') {
        if (msg.breathing != null) els.breathNum.textContent = String(Math.round(msg.breathing));
        if (msg.pulse != null) {
          pulseHistory.push(msg.pulse);
          if (pulseHistory.length > 60) pulseHistory.shift();
          drawWave(pulseHistory, '#b3540e');
          onReading(Math.round(msg.pulse), msg.confidence, performance.now() / 1000);
        }
      }
    };
    es.onerror = function () {
      if (!gotStarted && mode === 'presage') {
        // Server could not run the SDK path — fall back to the local estimate.
        try { es.close(); } catch (_) {}
        es = null;
        startLocal();
      }
    };
  }

  // ---------- start / stop ----------

  var presageAvailable = false;

  function start() {
    show('loading');
    readings = []; pulseHistory = []; samples = [];
    flagOn = false; peakBpm = 0; lastBpm = null;
    els.pulseNum.textContent = '––';
    els.breathNum.textContent = presageAvailable ? '––' : '—';
    els.qualityText.textContent = '—';
    els.qualityBar.style.width = '0%';
    els.flagCard.classList.add('hidden');
    els.settledCard.classList.add('hidden');
    els.hintLine.textContent = '';
    if (presageAvailable) startPresage(); else startLocal();
  }

  function stopAll() {
    if (rafId) cancelAnimationFrame(rafId);
    if (tickId) clearInterval(tickId);
    rafId = tickId = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (es) { try { es.close(); } catch (_) {} es = null; }
    stopBreathingGuide();
    mode = null;
  }

  $('btn-start').addEventListener('click', start);
  $('btn-retry').addEventListener('click', start);
  $('btn-stop').addEventListener('click', function () { stopAll(); show('idle'); });

  // Find out what this server can do, and say so before the click.
  fetch('/api/status')
    .then(function (r) { return r.json(); })
    .then(function (st) {
      presageAvailable = Boolean(st.presageKey);
      els.startNote.textContent = presageAvailable
        ? 'This server has a Presage key, so the SmartSpectra SDK will do the measuring.'
        : 'This server has no Presage key, so the page will use its local browser estimate. Add a free key (see the README) to switch on the SmartSpectra SDK.';
      if (!presageAvailable) els.breathNum.textContent = '—';
    })
    .catch(function () {
      presageAvailable = false;
      els.startNote.textContent = 'Could not check the server — the page will use its local browser estimate.';
    });

  show('idle');
})();
