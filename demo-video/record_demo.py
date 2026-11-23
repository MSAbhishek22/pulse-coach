"""Record the Pulse Coach demo against the locally served app.

Honesty rules (same as the fleet's other demo videos):
- The page is recorded exactly as served. No CSS injection, no JS clicks.
  Buttons are pressed with normal Playwright locator clicks.
- The camera is Chromium's fake device playing feed.y4m — a generated,
  clearly fake face whose green channel pulses at a known rate
  (72 bpm, ramping to 114 bpm). The app's real pipeline reads it.
  The DEV post discloses this: the build machine has no camera and no
  Presage key, so the recording shows the local-estimate mode.
- If a step fails, the script stops, closes the context so the partial
  video is flushed, writes assertions.json, and exits non-zero.

Flow: consent card -> Start -> reading settles near 72 -> pulse ramps ->
reading climbs -> after 5 s sustained high, the flag card and breathing
guide appear -> hold -> Stop.

Run: xvfb-run -a python3 demo-video/record_demo.py
Then: ffmpeg -i demo-video/raw/<file>.webm -c:v libx264 -pix_fmt yuv420p demo-video/pulse-coach-demo.mp4
"""
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "..", "app")
RAW_DIR = os.path.join(HERE, "raw")
os.makedirs(RAW_DIR, exist_ok=True)
FEED = os.path.join(HERE, "feed.y4m")
URL = "http://localhost:8377/"

stages, assertions = {}, {}
t0 = time.monotonic()
failure = None


def mark(name):
    stages[name] = round(time.monotonic() - t0, 2)
    print(f"[{stages[name]:7.2f}s] {name}", flush=True)


def wait_for(page, fn, timeout_s, what):
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        try:
            v = fn()
        except Exception:
            v = None
        if v:
            return v
        page.wait_for_timeout(500)
    raise TimeoutError("timed out waiting for " + what)


server = subprocess.Popen(
    ["node", "server.js"], cwd=APP_DIR,
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    env={**os.environ, "PORT": "8377"},
)
time.sleep(1.2)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=[
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-video-capture={FEED}",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 720},
            record_video_dir=RAW_DIR,
            record_video_size={"width": 1280, "height": 720},
            permissions=["camera"],
        )
        page = ctx.new_page()
        page.goto(URL)
        mark("page loaded, consent card shown")
        page.wait_for_timeout(2500)

        page.locator("#btn-start").click()
        mark("clicked Start the camera")

        page.wait_for_selector("#state-live:not(.hidden)", timeout=15000)
        mark("live state visible")

        def pulse_value():
            txt = page.locator("#pulse-num").inner_text().strip()
            return int(txt) if txt.isdigit() else None

        bpm = wait_for(page, lambda: (lambda v: v if v and 55 <= v <= 95 else None)(pulse_value()),
                       45, "first pulse reading near 72 bpm")
        assertions["first_reading_bpm"] = bpm
        mark(f"first reading settled: {bpm} bpm (feed is 72 bpm)")

        src = page.locator("#source-label").inner_text()
        assertions["source_label"] = src
        assert "local estimate" in src, "expected the local-estimate label, got: " + src
        mark("source label honestly says local estimate")

        page.wait_for_timeout(6000)  # hold on the calm reading + waveform

        wait_for(page, lambda: page.locator("#flag-card").is_visible(), 90,
                 "flag card after the ramp to 114 bpm")
        peak = pulse_value()
        assertions["reading_at_flag"] = peak
        mark(f"flag card shown — pulse stayed high (reading {peak})")

        page.locator("#flag-card").scroll_into_view_if_needed()
        page.wait_for_timeout(1000)
        mark("flag card scrolled into view, breathing guide running")
        page.wait_for_timeout(10000)  # hold on the breathing guide

        page.locator("#btn-stop").click()
        page.wait_for_timeout(2000)
        mark("stopped, back to consent card")

        ctx.close()
        browser.close()
except Exception as exc:  # noqa: BLE001
    failure = f"{type(exc).__name__}: {exc}"
    print("FAILED:", failure, flush=True)
finally:
    server.terminate()
    assertions["failure"] = failure
    with open(os.path.join(HERE, "assertions.json"), "w") as fh:
        json.dump(assertions, fh, indent=2)
    with open(os.path.join(HERE, "stage_times.json"), "w") as fh:
        json.dump(stages, fh, indent=2)

sys.exit(1 if failure else 0)
