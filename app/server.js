/*
 * Pulse Coach — tiny Node server. No web framework.
 *
 * Two jobs:
 *  1. Serve the static page in ./public.
 *  2. When a Presage API key is configured, run the real SmartSpectra SDK
 *     (@smartspectra/node-sdk) on this machine's camera and stream its live
 *     metrics to the page over Server-Sent Events (/api/stream).
 *
 * Key handling: the key is read from the environment variable
 * PRESAGE_API_KEY or from a local .env file next to this script. It is
 * never sent to the browser and never logged. Get a free key at
 * https://physiology.presagetech.com (free tier, no card needed).
 *
 * Optional: set DEMO_FILE=/path/to/face-video.mp4 to feed the SDK a
 * recorded video instead of a live camera (useful on machines with no
 * camera, for testing the Presage path end to end).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = parseInt(process.env.PORT || '8377', 10);

// --- tiny .env reader (only fills variables that are not already set) ---
(function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] == null) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {
    /* no .env file — fine, local mode still works */
  }
})();

const API_KEY = process.env.PRESAGE_API_KEY || '';
const DEMO_FILE = process.env.DEMO_FILE || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// Pull the newest numeric value out of a decoded-metrics array field.
function latestValue(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const m = arr[arr.length - 1];
  if (typeof m === 'number') return m;
  if (m && typeof m.value === 'number') return m.value;
  return null;
}
function latestConfidence(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const m = arr[arr.length - 1];
  if (m && typeof m.confidence === 'number') return m.confidence;
  return null;
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (obj) => {
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {}
  };

  if (!API_KEY) {
    send({ type: 'no-key' });
    res.end();
    return;
  }

  let sdk = null;
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (sdk) {
      try { await sdk.stopAsync(); } catch (_) {}
      try { await sdk.destroy(); } catch (_) {}
      sdk = null;
    }
  };
  req.on('close', cleanup);

  try {
    // Required lazily so the static site also runs on machines where the
    // native SDK cannot load.
    const S = require('@smartspectra/node-sdk');
    sdk = new S.SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...S.breathingMetrics, ...S.cardioMetrics],
    });
    sdk.on('metrics', (buf) => {
      try {
        const m = S.decodeMetrics(buf);
        const pulse = latestValue(m.pulseRate);
        const breathing = latestValue(m.breathingRate);
        if (pulse == null && breathing == null) return;
        send({
          type: 'metrics',
          pulse: pulse,
          breathing: breathing,
          confidence: latestConfidence(m.pulseRate),
          t: Date.now(),
        });
      } catch (_) { /* one bad packet should not kill the stream */ }
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
      if (hint) send({ type: 'hint', hint: String(hint) });
    });
    if (DEMO_FILE) {
      sdk.useFile(DEMO_FILE);
    } else {
      sdk.useCamera(S.CameraSelection.default);
    }
    sdk.start();
    send({ type: 'started', source: DEMO_FILE ? 'file' : 'camera' });
  } catch (err) {
    send({ type: 'error', message: 'SmartSpectra SDK could not start: ' + (err && err.message ? err.message : String(err)) });
    cleanup();
    res.end();
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ presageKey: Boolean(API_KEY), demoFile: Boolean(DEMO_FILE) }));
    return;
  }
  if (url === '/api/stream') { handleStream(req, res); return; }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('Pulse Coach running at http://localhost:' + PORT);
  console.log(API_KEY
    ? 'Presage mode available (API key found). The camera runs on this machine.'
    : 'No PRESAGE_API_KEY set — the page will use its local browser estimate.');
});
