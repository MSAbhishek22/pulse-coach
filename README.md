# Pulse Coach

**Live app:** runs locally on your own machine — see "Run it" below (the
SmartSpectra SDK needs your camera, so there is no hosted version; the
challenge makes hosting optional for exactly this reason).
**Demo video:** <https://youtu.be/1OzUB13VuPc>

Your webcam watches your pulse. If it stays high for a bit, the page breathes
with you until it settles.

Built solo for the **Presage SmartSpectra SDK Challenge** (DEV × MLH), inside
the entry period (built 23 Nov 2026 IST, before the 13:29 IST deadline).

## What it does

Sit in front of the camera. The app measures your pulse (and, in Presage
mode, your breathing rate) live, draws the signal, and keeps an eye on it.
If your pulse stays at or above 100 beats per minute for a full five
seconds, it says so, plainly, and starts a slow breathing guide — in for
four seconds, out for six. When your pulse stays under 90 for five seconds,
it tells you that you settled, and how high it had peaked.

It is a wellness toy, not a medical tool. It does not diagnose or treat
anything, and it never watches anyone in secret: the camera starts only
after a clear consent click, on your own screen.

## How it works — two signal sources, always labelled

1. **Presage mode (the real thing).** A small Node server runs the actual
   **SmartSpectra SDK** (`@smartspectra/node-sdk`) on the machine's camera,
   asking for the SDK's breathing and cardio metric sets. Decoded metrics
   (pulse rate, breathing rate, confidence) stream to the page over
   Server-Sent Events. This is the mode the challenge asks for.
2. **Local estimate mode (fallback, clearly labelled).** If the server has
   no Presage key, the page estimates the pulse itself, in the browser: it
   averages the green channel over the face area of each frame, cleans the
   signal, and finds its rhythm (see `app/public/signal.js`). The screen
   says, in words, that this is a rough local estimate and **not** a Presage
   reading. This mode exists so anyone can try the whole flow without a
   key — several of us do not have a key yet, and an app that only shows an
   error helps nobody.

The reaction logic — the five-second hold, the flag, the breathing guide,
the settled note — is shared and identical for both sources.

## Run it

You need Node.js 20+ and a webcam.

```bash
git clone https://github.com/MSAbhishek22/pulse-coach
cd pulse-coach/app
npm install
```

### With the SmartSpectra SDK (recommended)

1. Get a free API key at <https://physiology.presagetech.com> — free tier,
   about 100 credits, no card needed.
2. `cp .env.example .env` and put your key in `.env` as `PRESAGE_API_KEY=…`
   (the file is gitignored; the key never reaches the browser).
3. `npm start`, then open <http://localhost:8377> and press **Start the camera**.

No camera on the server machine? Record a short face video and point the
SDK at it instead: `DEMO_FILE=/path/to/face.mp4 npm start`.

### Without a key

Just `npm start` and open the page. It will tell you it is using the local
browser estimate, and the full flow — pulse, waveform, flag, breathing
guide — works from your own webcam.

## Tests

```bash
cd pulse-coach/app && npm test
```

Nine tests, no dependencies. Synthetic signals with known rates (72, 120
and 55 bpm; 12 and 18 breaths/min) plus noise and drift must come back
within a few beats of the truth; the flag rule must not fire on a dip or on
too little history. The same `signal.js` file runs in the browser and in
the tests.

## Consent and data handling

- The camera starts only after the user reads the consent card and clicks.
- The app records nothing and stores nothing. No accounts, no database.
- Local mode: all processing happens in the browser, on the device. Video
  never leaves the device.
- Presage mode: the SmartSpectra SDK connects to Presage's service to
  authenticate the key and process the signal, per Presage's own telemetry
  and privacy documentation. That traffic is between the SDK and Presage;
  this app adds no other network calls and keeps no copy of anything.
- Stop with the Stop button or close the tab; the camera turns off.

## Files

- `AGENTS.md` — project memory: event facts, architecture, decisions.
- `app/server.js` — static hosting + SmartSpectra SDK session + SSE stream.
- `app/public/` — the page (`index.html`, `styles.css`, `app.js`) and
  `signal.js`, the shared signal helpers.
- `tests/test_signal.js` — the test suite.
- `demo-video/` — the scripts that recorded the demo (`record_demo.py`,
  `make_feed.py`) and the assertions the recording had to pass.

## Honest limits

- A webcam pulse estimate moves around with light, motion and skin tone.
  Treat every number as a rough guide.
- Presage mode runs the camera on the machine that runs the server, so it
  is a local app, not a hosted one. Public hosting of the full Presage path
  would need a server with a camera attached, which is not a thing — that
  is why the challenge makes hosting optional.
