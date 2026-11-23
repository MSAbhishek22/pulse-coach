# Pulse Posture Coach — project memory (Presage SmartSpectra SDK Challenge, DEV × MLH)

## What it is
A small web app that watches your live pulse through the webcam and reacts in
real time (WATCHES pattern): it samples the camera signal, shows your pulse
and a live waveform, and when your pulse stays high it flags it and starts a
slow breathing guide to help you settle. Wellness only — no diagnosis, no
treatment claims, no covert monitoring. The camera starts only after a clear
consent click.

## Event facts (verified 23 Nov 2026 on dev.to/challenges/presage-2026-11-04)
- Deadline: 22 Nov 2026, 11:59 PM PST = **23 Nov 2026, 13:29 IST**. Entry must
  be created inside the entry period.
- Solo only. 18+. Free DEV account. No entry fee. India eligible.
- $3,000 total, 10 winners × $300. Judged on Use of Underlying Technology,
  Usability/UX, Originality/Creativity. Winners 10 Dec 2026.
- **Hard requirement: the app MUST integrate the SmartSpectra SDK and use at
  least one live Presage signal (pulse / breathing / HRV / expressions).
  Judges verify SDK use from the public repo + demo video.**
- Submission = DEV post (template, tags devchallenge + presagechallenge) +
  public repo with setup instructions + demo video. Public hosting optional.
- Required DEV post sections: What I Built, Demo, Code, How It Responds to
  Human Signals, Prize Categories, **Consent and Data Handling (required)**.

## Architecture
- `app/server.js` — small Node server (no framework). Serves the page, and
  when `PRESAGE_API_KEY` is set in `app/.env`, runs the real SmartSpectra SDK
  (`@smartspectra/node-sdk`) on the machine's camera and streams its metrics
  to the page over Server-Sent Events. This is the primary, judged path.
- `app/public/` — the page. Two clearly labelled signal sources:
  1. **Presage mode** (default when the server has a key): live pulse /
     breathing / HRV from the SmartSpectra SDK.
  2. **Local estimate mode** (no key, or camera runs in the browser): the page
     does its own simple rPPG — green-channel average over the face area,
     band-pass, peak detection — computed on-device. The page says plainly
     that this mode is a rough local estimate, not Presage.
- The reaction logic (flag when pulse is high, breathing guide, waveform,
  signal quality) is shared and works the same for both sources.

## Data rules
- Real data only: the camera signal is the data. No typed-in or faked vitals.
- Demo mode, if ever used for a recording, must be labelled on screen.
- No video is stored or sent anywhere by the app itself. In Presage mode the
  SDK talks to Presage's service to authenticate and process, per Presage's
  own telemetry docs — the DEV post must disclose this.
- No secrets in the repo. The key lives only in `app/.env` (gitignored);
  `.env.example` shows the variable name with no value.

## Copy rules
- Human tone: plain words, short sentences, first person in the DEV post.
  No marketing phrases (no "revolutionary", "cutting-edge", "leverage",
  "seamless", "empowering").
- Wellness wording only: "your pulse looks high, try slowing your breathing"
  is fine; any diagnosis or treatment claim is a disqualifier.

## Tests
- `tests/test_signal.js` — Node, no dependencies. Pure signal functions live
  in `app/public/signal.js` (shared by browser + tests via a UMD guard):
  synthetic sine + noise at a known rate must come back within ±3 BPM for
  pulse and ±2 breaths/min for breathing. Never edit a test to make it pass;
  fix the code.

## Status log
- 23 Nov 2026 ~07:55 IST: build started inside the entry period. GO decision:
  SDK is free (free trial key, no card — presagetech.com pricing page), solo,
  India eligible. Remaining user steps: provide the free Presage API key
  (register at physiology.presagetech.com) for a live Presage-signal demo,
  and publish the DEV post from the user's DEV account (pack in
  SUBMISSION_PACK.md).
- 23 Nov 2026 ~08:35 IST: build complete. `@smartspectra/node-sdk` installed
  and loads on Node 24; server wiring verified with a dummy key — the native
  engine started, then failed cleanly (this VM has no camera, and its egress
  proxy breaks Presage's TLS), the server turned that into a plain SSE error
  and the page falls back to local mode. A live Presage session was NOT
  completed here; it needs the user's real free key + a camera machine.
  Tests: 9/9 pass (`node tests/test_signal.js`). Demo video recorded against
  the locally served app with a synthetic camera feed (72 bpm → 114 bpm):
  the app read exactly 72, tracked to 113–114, flag + breathing guide shown;
  assertions in demo-video/assertions.json; final file
  demo-video/pulse-coach-demo.mp4 (55 s). Local git repo committed
  (f2852c5). NOT filed — DEV post, repo creation and video upload are the
  user's/parent's steps, listed in SUBMISSION_PACK.md.
