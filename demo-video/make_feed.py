"""Generate the synthetic camera feed for the Pulse Coach demo recording.

Why a synthetic feed: the build machine has no camera. This .y4m is a
clearly fake "face" (flat shapes, no person) whose green channel carries a
known pulse: 72 bpm for the first stretch, ramping up to 114 bpm, so the
recording can show the app's real pipeline reading it and reacting.
The DEV post discloses this. Nothing about it pretends to be a real person
or a real Presage measurement.

Output: demo-video/feed.y4m  (320x240, 30 fps, ~70 s, YUV420)
Run: python3 demo-video/make_feed.py
"""
import os
import numpy as np

W, H, FPS, SECONDS = 320, 240, 30, 70
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "feed.y4m")

rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# Static scene in RGB.
frame_rgb = np.zeros((H, W, 3), np.float32)
frame_rgb[:] = (168, 178, 188)  # plain background
face = ((xx - 160) / 88.0) ** 2 + ((yy - 118) / 106.0) ** 2 <= 1.0
frame_rgb[face] = (203, 144, 112)  # flat skin tone
for cx in (128, 192):  # eyes
    eye = ((xx - cx) / 11.0) ** 2 + ((yy - 104) / 6.0) ** 2 <= 1.0
    frame_rgb[eye] = (70, 52, 44)
mouth = ((xx - 160) / 26.0) ** 2 + ((yy - 168) / 5.0) ** 2 <= 1.0
frame_rgb[mouth] = (150, 92, 78)

def freq_at(t):
    """Pulse frequency in Hz: 72 bpm, ramp at 24-29 s to 114 bpm."""
    if t < 24:
        return 72 / 60.0
    if t < 29:
        return (72 + (114 - 72) * (t - 24) / 5.0) / 60.0
    return 114 / 60.0

# Integrate frequency into phase so the ramp has no jumps.
phases = np.zeros(FPS * SECONDS)
phase = 0.0
for i in range(len(phases)):
    phase += 2 * np.pi * freq_at(i / FPS) / FPS
    phases[i] = phase

def rgb_to_yuv420(rgb):
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.14713 * r - 0.28886 * g + 0.436 * b + 128
    v = 0.615 * r - 0.51499 * g - 0.10001 * b + 128
    y = np.clip(y, 0, 255).astype(np.uint8)
    u = np.clip(u, 0, 255).astype(np.uint8).reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v = np.clip(v, 0, 255).astype(np.uint8).reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y, u, v

with open(OUT, "wb") as fh:
    fh.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
    for i in range(FPS * SECONDS):
        t = i / FPS
        img = frame_rgb.copy()
        pulse = np.sin(phases[i])
        # The pulse lives mostly in the green channel of the face area,
        # like a real rPPG signal, with a little in red and blue.
        img[face, 1] += 5.0 * pulse
        img[face, 0] += 2.0 * pulse
        img[face, 2] += 1.2 * pulse
        # Slow light drift over the whole frame + a touch of noise.
        img += 2.0 * np.sin(2 * np.pi * 0.05 * t)
        img += rng.normal(0, 1.1, img.shape)
        y, u, v = rgb_to_yuv420(np.clip(img, 0, 255))
        fh.write(b"FRAME\n")
        fh.write(y.tobytes()); fh.write(u.tobytes()); fh.write(v.tobytes())
        if i % 300 == 0:
            print(f"frame {i}/{FPS * SECONDS}", flush=True)

print("wrote", OUT, os.path.getsize(OUT) // (1024 * 1024), "MB")
