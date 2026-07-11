from pathlib import Path
import math

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "hologram"
OUT.mkdir(parents=True, exist_ok=True)

WIDTH = 1024
HEIGHT = 512
u = np.linspace(0.0, 1.0, WIDTH, dtype=np.float32)[None, :]
v = np.linspace(0.0, 1.0, HEIGHT, dtype=np.float32)[:, None]
longitude = u * math.tau
latitude = (v - 0.5) * math.pi


def gaussian(value, center, width):
    delta = (value - center) / width
    return np.exp(-0.5 * delta * delta)


def save(name, data):
    normalized = np.clip(data, 0.0, 1.0)
    rgba = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    channel = (normalized * 255.0).astype(np.uint8)
    rgba[:, :, 0] = channel
    rgba[:, :, 1] = channel
    rgba[:, :, 2] = channel
    rgba[:, :, 3] = 255
    Image.fromarray(rgba, mode="RGBA").save(OUT / f"{name}.png", optimize=True)


bands = (
    gaussian(latitude, -0.72, 0.13) * 0.5
    + gaussian(latitude, -0.42, 0.11) * 0.42
    + gaussian(latitude, -0.12, 0.16) * 0.18
    + gaussian(latitude, 0.43, 0.14) * 0.26
)
swirl = 0.5 + 0.5 * np.sin(longitude * 4.0 + latitude * 7.5 + np.sin(longitude * 1.4) * 1.5)
micro = 0.5 + 0.5 * np.sin(longitude * 17.0 - latitude * 11.0)
exclusion = gaussian(latitude, 0.04, 0.28) * gaussian(np.sin(longitude - 3.0), 0.0, 0.34) * 0.28
density = 0.18 + bands * (0.54 + swirl * 0.46) + micro * 0.07 - exclusion
save("globe-density", density)

hotspots = [
    (0.10, 0.28, 0.035, 0.75),
    (0.22, 0.35, 0.026, 0.92),
    (0.36, 0.42, 0.022, 0.78),
    (0.49, 0.31, 0.034, 0.9),
    (0.60, 0.38, 0.027, 0.82),
    (0.73, 0.46, 0.03, 0.88),
    (0.84, 0.34, 0.024, 0.96),
    (0.92, 0.58, 0.027, 0.84),
    (0.18, 0.67, 0.03, 0.72),
    (0.42, 0.72, 0.026, 0.88),
    (0.68, 0.69, 0.031, 0.7),
]
hotspot_map = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
for hu, hv, radius, strength in hotspots:
    du = np.minimum(np.abs(u - hu), 1.0 - np.abs(u - hu))
    dv = v - hv
    hotspot_map += np.exp(-(du * du + dv * dv) / (2.0 * radius * radius)) * strength
save("globe-hotspots", hotspot_map)

rim_breakup = (
    0.38
    + 0.2 * np.sin(longitude * 3.0 - latitude * 2.0)
    + 0.22 * np.sin(longitude * 13.0 + latitude * 9.0)
    + 0.14 * np.sin(longitude * 29.0 - latitude * 15.0)
    + gaussian(latitude, 0.96, 0.36) * 0.38
    + gaussian(latitude, -1.0, 0.3) * 0.28
)
save("globe-rim-breakup", rim_breakup)

print(f"Built hologram texture masks in {OUT}")
