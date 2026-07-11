from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    ROOT.parent
    / "jarvis_globe_codex_package"
    / "references"
    / ".target-globe-crop.png"
)
OUTPUT = ROOT / "public" / "hologram" / "pedestal-emission-card.png"

image = Image.open(SOURCE).convert("RGB")
# Pedestal plus the localized floor reflection, excluding the side UI panels.
crop = image.crop((82, 322, 438, 452)).resize((712, 260), Image.Resampling.LANCZOS)
rgb = np.asarray(crop).astype(np.float32)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
luma = r * 0.2126 + g * 0.7152 + b * 0.0722
cyan = np.maximum(0.0, b - r * 0.8) + np.maximum(0.0, g - r * 0.68) * 0.72

# Preserve luminous blue/cyan/white structure while removing the photographic
# background and the dark pedestal body.
energy = np.maximum((luma - 14.0) * 2.0, cyan * 1.05)
core_alpha = np.clip((energy - 18.0) * 2.65, 0.0, 255.0)
core_alpha[luma < 17.0] = 0.0

alpha_image = Image.fromarray(core_alpha.astype(np.uint8), mode="L")
halo = np.asarray(alpha_image.filter(ImageFilter.GaussianBlur(radius=7))).astype(np.float32)
alpha = np.clip(np.maximum(core_alpha, halo * 0.42), 0.0, 220.0)

# Feather the card boundary so the sprite can never reveal a rectangular edge.
h, w = alpha.shape
x = np.minimum(np.arange(w), np.arange(w)[::-1]).astype(np.float32)
y = np.minimum(np.arange(h), np.arange(h)[::-1]).astype(np.float32)
feather = np.minimum(np.clip(x / 42.0, 0.0, 1.0)[None, :], np.clip(y / 22.0, 0.0, 1.0)[:, None])
alpha *= feather

# Protect the central emitter from clipping while allowing the surrounding
# rings, arcs, and floor reflection to carry more energy.
yy, xx = np.mgrid[0:h, 0:w]
center_distance = np.sqrt(((xx - w * 0.5) / 112.0) ** 2 + ((yy - h * 0.39) / 54.0) ** 2)
center_protection = 0.54 + 0.46 * np.clip(center_distance, 0.0, 1.0)
alpha *= center_protection

# Keep the source hue but push low-energy pixels toward cyan instead of gray.
cyan_target = np.stack(
    [
        np.clip(r * 0.7, 0, 255),
        np.clip(np.maximum(g, luma * 0.9), 0, 255),
        np.clip(np.maximum(b, luma * 1.18), 0, 255),
    ],
    axis=-1,
)
mix = np.clip((alpha / 255.0)[..., None] * 0.72, 0.0, 0.72)
out_rgb = np.clip(rgb * (1.0 - mix) + cyan_target * mix, 0.0, 255.0)
out_rgb *= np.clip((alpha / 170.0)[..., None], 0.0, 1.0)
out_rgb[alpha < 5.0] = 0.0
rgba = np.dstack([out_rgb, alpha]).astype(np.uint8)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(rgba, mode="RGBA").save(OUTPUT)
print(OUTPUT)
