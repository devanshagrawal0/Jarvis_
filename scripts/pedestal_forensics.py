from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from skimage.metrics import structural_similarity


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = (
    ROOT.parent
    / "jarvis_globe_codex_package"
    / "references"
    / ".target-globe-crop.png"
)
CURRENT = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else ROOT / ".playwright-cli" / "base-pixelmatch-baseline.png"
)
OUTPUT = (
    Path(sys.argv[2]).resolve()
    if len(sys.argv) > 2
    else ROOT / "artifacts" / "pedestal-forensics"
)
OUTPUT.mkdir(parents=True, exist_ok=True)

CANVAS_WIDTH = 680
CANVAS_HEIGHT = 250


def load_rgb(path: Path) -> np.ndarray:
    return cv2.cvtColor(cv2.imread(str(path), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)


def normalized_reference(image: np.ndarray) -> np.ndarray:
    # Reference globe diameter is ~260 px and current globe diameter is ~360 px.
    # Scale the pedestal by the same ratio so width/height errors remain visible.
    crop = image[328:493, 65:455]
    scale = 360.0 / 260.0
    resized = cv2.resize(
        crop,
        (round(crop.shape[1] * scale), round(crop.shape[0] * scale)),
        interpolation=cv2.INTER_LANCZOS4,
    )
    canvas = np.zeros((CANVAS_HEIGHT, CANVAS_WIDTH, 3), dtype=np.uint8)
    canvas[:] = (1, 6, 11)
    x = (CANVAS_WIDTH - resized.shape[1]) // 2
    h = min(CANVAS_HEIGHT, resized.shape[0])
    canvas[:h, x : x + resized.shape[1]] = resized[:h]
    return canvas


def normalized_current(image: np.ndarray) -> np.ndarray:
    crop = image[450:700, 300:980]
    if crop.shape[:2] != (CANVAS_HEIGHT, CANVAS_WIDTH):
        crop = cv2.resize(crop, (CANVAS_WIDTH, CANVAS_HEIGHT), interpolation=cv2.INTER_AREA)
    return crop


def luma(rgb: np.ndarray) -> np.ndarray:
    return (
        rgb[..., 0].astype(np.float32) * 0.2126
        + rgb[..., 1].astype(np.float32) * 0.7152
        + rgb[..., 2].astype(np.float32) * 0.0722
    )


def cyan_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    lum = luma(rgb)
    # Luminous cyan/blue emission; excludes the dark blue floor and body.
    result = (lum >= 28) & ((b - r) >= 18) & ((g - r) >= 7) & (b >= g)
    return result.astype(np.uint8) * 255


def bright_mask(rgb: np.ndarray) -> np.ndarray:
    return (luma(rgb) >= 80).astype(np.uint8) * 255


def edge_mask(rgb: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 18, 62)


def bounds(mask: np.ndarray) -> dict[str, int] | None:
    points = cv2.findNonZero(mask)
    if points is None:
        return None
    x, y, w, h = cv2.boundingRect(points)
    return {"left": x, "top": y, "right": x + w - 1, "bottom": y + h - 1, "width": w, "height": h}


def row_extent(mask: np.ndarray, row: int) -> int:
    xs = np.flatnonzero(mask[max(0, min(mask.shape[0] - 1, row))] > 0)
    return 0 if xs.size == 0 else int(xs[-1] - xs[0] + 1)


def metrics(rgb: np.ndarray) -> dict:
    cyan = cyan_mask(rgb)
    bright = bright_mask(rgb)
    edges = edge_mask(rgb)
    luminance = luma(rgb)
    center = CANVAS_WIDTH // 2

    # Body region begins below the top plate. Dark-but-visible pixels estimate
    # the silhouette without treating the floor as part of the pedestal.
    body_zone = rgb[86:222, 110:570]
    body_luma = luma(body_zone)
    body_sat = cv2.cvtColor(body_zone, cv2.COLOR_RGB2HSV)[..., 1]
    body = ((body_luma >= 2) & (body_luma <= 42) & (body_sat >= 25)).astype(np.uint8) * 255
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((9, 17), np.uint8))

    vertical_profile = cyan.sum(axis=1) / 255.0
    emitter_crop = luminance[20:105, center - 100 : center + 100]

    return {
        "mean_luminance": float(luminance.mean()),
        "median_luminance": float(np.median(luminance)),
        "p90_luminance": float(np.percentile(luminance, 90)),
        "cyan_percent": float(np.mean(cyan > 0) * 100),
        "bright_percent": float(np.mean(bright > 0) * 100),
        "edge_percent": float(np.mean(edges > 0) * 100),
        "cyan_bounds": bounds(cyan),
        "bright_bounds": bounds(bright),
        "body_bounds_local": bounds(body),
        "top_plate_width_y40": row_extent(cyan, 40),
        "top_plate_width_y55": row_extent(cyan, 55),
        "top_plate_width_y70": row_extent(cyan, 70),
        "cyan_peak_row": int(np.argmax(vertical_profile)),
        "cyan_peak_width": row_extent(cyan, int(np.argmax(vertical_profile))),
        "emitter_pixels_over_150": int(np.sum(emitter_crop > 150)),
        "emitter_pixels_over_220": int(np.sum(emitter_crop > 220)),
    }


def save_mask(name: str, mask: np.ndarray) -> None:
    Image.fromarray(mask).save(OUTPUT / name)


reference = normalized_reference(load_rgb(REFERENCE))
current = normalized_current(load_rgb(CURRENT))

Image.fromarray(reference).save(OUTPUT / "reference-pedestal-normalized.png")
Image.fromarray(current).save(OUTPUT / "current-pedestal-normalized.png")

reference_metrics = metrics(reference)
current_metrics = metrics(current)

for prefix, image in (("reference", reference), ("current", current)):
    save_mask(f"{prefix}-cyan-mask.png", cyan_mask(image))
    save_mask(f"{prefix}-bright-mask.png", bright_mask(image))
    save_mask(f"{prefix}-edges.png", edge_mask(image))

gray_ref = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
gray_cur = cv2.cvtColor(current, cv2.COLOR_RGB2GRAY)
ssim, ssim_map = structural_similarity(gray_ref, gray_cur, data_range=255, full=True)
ssim_vis = np.clip((1.0 - ssim_map) * 255.0, 0, 255).astype(np.uint8)
Image.fromarray(ssim_vis).save(OUTPUT / "ssim-error.png")

ref_edges = edge_mask(reference)
cur_edges = edge_mask(current)
edge_intersection = np.logical_and(ref_edges > 0, cur_edges > 0).sum()
edge_union = np.logical_or(ref_edges > 0, cur_edges > 0).sum()

report = {
    "inputs": {"reference": str(REFERENCE), "current": str(CURRENT)},
    "normalization": {
        "canvas": [CANVAS_WIDTH, CANVAS_HEIGHT],
        "reference_globe_scale": 360.0 / 260.0,
        "reference_crop": [65, 328, 390, 165],
        "current_crop": [300, 450, 680, 250],
    },
    "reference": reference_metrics,
    "current": current_metrics,
    "ratios": {
        "mean_luminance": current_metrics["mean_luminance"] / reference_metrics["mean_luminance"],
        "cyan_percent": current_metrics["cyan_percent"] / reference_metrics["cyan_percent"],
        "bright_percent": current_metrics["bright_percent"] / reference_metrics["bright_percent"],
        "edge_percent": current_metrics["edge_percent"] / reference_metrics["edge_percent"],
        "emitter_over_150": current_metrics["emitter_pixels_over_150"]
        / max(1, reference_metrics["emitter_pixels_over_150"]),
        "emitter_over_220": current_metrics["emitter_pixels_over_220"]
        / max(1, reference_metrics["emitter_pixels_over_220"]),
    },
    "ssim": float(ssim),
    "edge_iou": float(edge_intersection / max(1, edge_union)),
}

(OUTPUT / "pedestal-metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

# Annotated comparison.
sheet = Image.new("RGB", (CANVAS_WIDTH * 2, CANVAS_HEIGHT + 42), "#02060b")
sheet.paste(Image.fromarray(reference), (0, 42))
sheet.paste(Image.fromarray(current), (CANVAS_WIDTH, 42))
draw = ImageDraw.Draw(sheet)
draw.text((14, 13), "REFERENCE PEDESTAL", fill="#9ce8ff")
draw.text((CANVAS_WIDTH + 14, 13), "CURRENT PEDESTAL", fill="#9ce8ff")
sheet.save(OUTPUT / "pedestal-comparison.png")

print(json.dumps(report, indent=2))
