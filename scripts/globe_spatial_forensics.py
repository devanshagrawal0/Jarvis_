from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import linear_sum_assignment
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
    else ROOT / ".playwright-cli" / "jarvis-globe-final-locked.png"
)
OUTPUT = (
    Path(sys.argv[2]).resolve()
    if len(sys.argv) > 2
    else ROOT / "artifacts" / "globe-spatial-forensics"
)
OUTPUT.mkdir(parents=True, exist_ok=True)

NORMALIZED_SIZE = (520, 480)
GLOBE_CENTER = (260, 186)
GLOBE_RADIUS = 132
CROP_RADIUS = 148
ANALYSIS_SIZE = CROP_RADIUS * 2


def load_rgb(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def normalize_reference(image: np.ndarray) -> np.ndarray:
    return cv2.resize(image, NORMALIZED_SIZE, interpolation=cv2.INTER_LANCZOS4)


def normalize_current(image: np.ndarray) -> np.ndarray:
    resized = cv2.resize(image, (920, 518), interpolation=cv2.INTER_LANCZOS4)
    return resized[0:480, 200:720]


def globe_crop(image: np.ndarray) -> np.ndarray:
    cx, cy = GLOBE_CENTER
    return image[
        cy - CROP_RADIUS : cy + CROP_RADIUS,
        cx - CROP_RADIUS : cx + CROP_RADIUS,
    ]


def luma(rgb: np.ndarray) -> np.ndarray:
    return (
        rgb[..., 0].astype(np.float32) * 0.2126
        + rgb[..., 1].astype(np.float32) * 0.7152
        + rgb[..., 2].astype(np.float32) * 0.0722
    )


yy, xx = np.mgrid[:ANALYSIS_SIZE, :ANALYSIS_SIZE]
cc = CROP_RADIUS
radius_map = np.sqrt((xx - cc) ** 2 + (yy - cc) ** 2)
angle_map = (np.degrees(np.arctan2(-(yy - cc), xx - cc)) + 360.0) % 360.0
disc_mask = radius_map <= GLOBE_RADIUS
interior_mask = radius_map <= GLOBE_RADIUS * 0.84
rim_mask = (radius_map >= GLOBE_RADIUS * 0.84) & (radius_map <= GLOBE_RADIUS * 1.03)


def percentile(values: np.ndarray, amount: float) -> float:
    return float(np.percentile(values, amount))


def color_metrics(rgb: np.ndarray, mask: np.ndarray) -> dict:
    pixels = rgb[mask]
    lum = luma(rgb)[mask]
    mx = pixels.max(axis=1).astype(np.float32)
    mn = pixels.min(axis=1).astype(np.float32)
    saturation = np.divide(mx - mn, np.maximum(mx, 1), dtype=np.float32)
    cyan = (
        (pixels[:, 2] > pixels[:, 0] * 1.35)
        & (pixels[:, 2] > pixels[:, 1] * 1.06)
        & (lum > 18)
    )
    near_white = (
        (np.abs(pixels[:, 0].astype(np.int16) - pixels[:, 1]) < 20)
        & (np.abs(pixels[:, 1].astype(np.int16) - pixels[:, 2]) < 20)
        & (lum > 100)
    )
    return {
        "mean_rgb": [float(value) for value in pixels.mean(axis=0)],
        "luminance": {
            "mean": float(lum.mean()),
            "p10": percentile(lum, 10),
            "p50": percentile(lum, 50),
            "p75": percentile(lum, 75),
            "p90": percentile(lum, 90),
            "p95": percentile(lum, 95),
            "p99": percentile(lum, 99),
        },
        "saturation_mean": float(saturation.mean()),
        "cyan_percent": float(cyan.mean() * 100),
        "white_percent": float(near_white.mean() * 100),
        "bright_percent_80": float((lum >= 80).mean() * 100),
        "bright_percent_120": float((lum >= 120).mean() * 100),
        "dark_percent_16": float((lum <= 16).mean() * 100),
    }


def radial_profile(rgb: np.ndarray, bins: int = 28) -> list[dict]:
    lum = luma(rgb)
    result = []
    for index in range(bins):
        inner = GLOBE_RADIUS * index / bins
        outer = GLOBE_RADIUS * (index + 1) / bins
        mask = (radius_map >= inner) & (radius_map < outer)
        values = lum[mask]
        result.append(
            {
                "radius_fraction": float((index + 0.5) / bins),
                "mean": float(values.mean()),
                "p90": percentile(values, 90),
                "p99": percentile(values, 99),
            }
        )
    return result


def polar_rim_profile(rgb: np.ndarray, bins: int = 72) -> list[dict]:
    lum = luma(rgb)
    result = []
    for index in range(bins):
        low = index * 360 / bins
        high = (index + 1) * 360 / bins
        mask = rim_mask & (angle_map >= low) & (angle_map < high)
        values = lum[mask]
        result.append(
            {
                "angle_degrees": float((low + high) / 2),
                "mean": float(values.mean()),
                "p90": percentile(values, 90),
                "p99": percentile(values, 99),
            }
        )
    return result


def grid_metrics(rgb: np.ndarray, size: int = 6) -> list[dict]:
    lum = luma(rgb)
    result = []
    diameter = GLOBE_RADIUS * 2
    left = CROP_RADIUS - GLOBE_RADIUS
    top = CROP_RADIUS - GLOBE_RADIUS
    for row in range(size):
        for col in range(size):
            x0 = round(left + diameter * col / size)
            x1 = round(left + diameter * (col + 1) / size)
            y0 = round(top + diameter * row / size)
            y1 = round(top + diameter * (row + 1) / size)
            local_mask = disc_mask[y0:y1, x0:x1]
            values = lum[y0:y1, x0:x1][local_mask]
            if values.size == 0:
                continue
            result.append(
                {
                    "row": row,
                    "col": col,
                    "mean": float(values.mean()),
                    "p90": percentile(values, 90),
                    "bright80_percent": float((values >= 80).mean() * 100),
                    "bright120_percent": float((values >= 120).mean() * 100),
                }
            )
    return result


def edge_metrics(rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 22, 72)
    edges[~disc_mask] = 0
    quadrants = {}
    for name, mask in {
        "top_left": disc_mask & (xx < cc) & (yy < cc),
        "top_right": disc_mask & (xx >= cc) & (yy < cc),
        "bottom_left": disc_mask & (xx < cc) & (yy >= cc),
        "bottom_right": disc_mask & (xx >= cc) & (yy >= cc),
    }.items():
        quadrants[name] = float((edges[mask] > 0).mean() * 100)
    return edges, {
        "edge_percent": float((edges[disc_mask] > 0).mean() * 100),
        "quadrant_edge_percent": quadrants,
    }


def bright_components(rgb: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    lum = luma(rgb)
    bright = ((lum >= 92) & interior_mask).astype(np.uint8) * 255
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(bright, 8)
    components = []
    for index in range(1, count):
        area = int(stats[index, cv2.CC_STAT_AREA])
        if area < 3:
            continue
        x, y = centroids[index]
        mask = labels == index
        components.append(
            {
                "area": area,
                "x_fraction": float((x - cc) / GLOBE_RADIUS),
                "y_fraction": float((y - cc) / GLOBE_RADIUS),
                "peak_luminance": float(lum[mask].max()),
                "mean_luminance": float(lum[mask].mean()),
            }
        )
    components.sort(key=lambda item: item["area"], reverse=True)
    return bright, components[:40]


def component_transport(reference: list[dict], current: list[dict]) -> dict:
    ref = reference[:16]
    cur = current[:16]
    if not ref or not cur:
        return {"matched": 0, "mean_distance": None}
    matrix = np.zeros((len(ref), len(cur)), dtype=np.float32)
    for i, a in enumerate(ref):
        for j, b in enumerate(cur):
            distance = math.dist(
                (a["x_fraction"], a["y_fraction"]),
                (b["x_fraction"], b["y_fraction"]),
            )
            area_penalty = abs(math.log((a["area"] + 1) / (b["area"] + 1))) * 0.12
            matrix[i, j] = distance + area_penalty
    rows, cols = linear_sum_assignment(matrix)
    return {
        "matched": int(len(rows)),
        "mean_distance": float(matrix[rows, cols].mean()),
        "max_distance": float(matrix[rows, cols].max()),
        "pairs": [
            {
                "reference_index": int(row),
                "current_index": int(col),
                "cost": float(matrix[row, col]),
            }
            for row, col in zip(rows, cols)
        ],
    }


def save_heatmap(values: list[dict], key: str, path: Path, size: int = 6) -> None:
    matrix = np.full((size, size), np.nan, dtype=np.float32)
    for item in values:
        matrix[item["row"], item["col"]] = item[key]
    valid = matrix[np.isfinite(matrix)]
    low = float(valid.min())
    high = float(valid.max())
    normalized = np.nan_to_num((matrix - low) / max(1e-5, high - low))
    image = cv2.applyColorMap((normalized * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    image = cv2.resize(image, (480, 480), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(path), image)


def plot_profiles(
    ref_radial: list[dict],
    cur_radial: list[dict],
    ref_polar: list[dict],
    cur_polar: list[dict],
) -> None:
    canvas = Image.new("RGB", (1080, 540), "#02070c")
    draw = ImageDraw.Draw(canvas)

    def plot(
        values_a: list[dict],
        values_b: list[dict],
        key: str,
        box: tuple[int, int, int, int],
        title: str,
    ) -> None:
        x0, y0, x1, y1 = box
        draw.rectangle(box, outline="#16455c", width=1)
        all_values = [item[key] for item in values_a + values_b]
        max_value = max(all_values) * 1.06
        for step in range(5):
            y = y1 - (y1 - y0) * step / 4
            draw.line((x0, y, x1, y), fill="#0b2634", width=1)
        for items, color in ((values_a, "#9cecff"), (values_b, "#ff8c5a")):
            points = []
            for index, item in enumerate(items):
                x = x0 + (x1 - x0) * index / max(1, len(items) - 1)
                y = y1 - (y1 - y0) * item[key] / max_value
                points.append((x, y))
            draw.line(points, fill=color, width=3)
        draw.text((x0 + 8, y0 + 8), title, fill="#d9f7ff")

    plot(ref_radial, cur_radial, "mean", (45, 55, 515, 485), "RADIAL MEAN LUMINANCE")
    plot(ref_polar, cur_polar, "p90", (565, 55, 1035, 485), "RIM P90 BY ANGLE")
    draw.text((45, 18), "REFERENCE", fill="#9cecff")
    draw.text((145, 18), "CURRENT", fill="#ff8c5a")
    canvas.save(OUTPUT / "profile-comparison.png")


reference_normalized = normalize_reference(load_rgb(REFERENCE))
current_normalized = normalize_current(load_rgb(CURRENT))
reference = globe_crop(reference_normalized)
current = globe_crop(current_normalized)

Image.fromarray(reference_normalized).save(OUTPUT / "reference-normalized.png")
Image.fromarray(current_normalized).save(OUTPUT / "current-normalized.png")
Image.fromarray(reference).save(OUTPUT / "reference-globe.png")
Image.fromarray(current).save(OUTPUT / "current-globe.png")

reference_edges, reference_edge_metrics = edge_metrics(reference)
current_edges, current_edge_metrics = edge_metrics(current)
Image.fromarray(reference_edges).save(OUTPUT / "reference-edges.png")
Image.fromarray(current_edges).save(OUTPUT / "current-edges.png")

reference_bright, reference_components = bright_components(reference)
current_bright, current_components = bright_components(current)
Image.fromarray(reference_bright).save(OUTPUT / "reference-bright-components.png")
Image.fromarray(current_bright).save(OUTPUT / "current-bright-components.png")

reference_radial = radial_profile(reference)
current_radial = radial_profile(current)
reference_polar = polar_rim_profile(reference)
current_polar = polar_rim_profile(current)
reference_grid = grid_metrics(reference)
current_grid = grid_metrics(current)

save_heatmap(reference_grid, "mean", OUTPUT / "reference-grid-mean.png")
save_heatmap(current_grid, "mean", OUTPUT / "current-grid-mean.png")
save_heatmap(reference_grid, "bright80_percent", OUTPUT / "reference-grid-bright.png")
save_heatmap(current_grid, "bright80_percent", OUTPUT / "current-grid-bright.png")
plot_profiles(reference_radial, current_radial, reference_polar, current_polar)

gray_reference = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
gray_current = cv2.cvtColor(current, cv2.COLOR_RGB2GRAY)
disc_indices = np.where(disc_mask)
ssim, ssim_map = structural_similarity(
    gray_reference,
    gray_current,
    data_range=255,
    full=True,
)
ssim_disc = float(ssim_map[disc_indices].mean())
ssim_error = np.clip((1 - ssim_map) * 255, 0, 255).astype(np.uint8)
ssim_error[~disc_mask] = 0
Image.fromarray(ssim_error).save(OUTPUT / "ssim-error.png")

edge_intersection = np.logical_and(reference_edges > 0, current_edges > 0).sum()
edge_union = np.logical_or(reference_edges > 0, current_edges > 0).sum()

report = {
    "inputs": {"reference": str(REFERENCE), "current": str(CURRENT)},
    "registration": {
        "normalized_size": NORMALIZED_SIZE,
        "globe_center": GLOBE_CENTER,
        "globe_radius": GLOBE_RADIUS,
        "crop_size": [ANALYSIS_SIZE, ANALYSIS_SIZE],
    },
    "reference": {
        "disc": color_metrics(reference, disc_mask),
        "interior": color_metrics(reference, interior_mask),
        "rim": color_metrics(reference, rim_mask),
        "edge": reference_edge_metrics,
        "radial_profile": reference_radial,
        "rim_polar_profile": reference_polar,
        "grid": reference_grid,
        "bright_components": reference_components,
    },
    "current": {
        "disc": color_metrics(current, disc_mask),
        "interior": color_metrics(current, interior_mask),
        "rim": color_metrics(current, rim_mask),
        "edge": current_edge_metrics,
        "radial_profile": current_radial,
        "rim_polar_profile": current_polar,
        "grid": current_grid,
        "bright_components": current_components,
    },
    "comparison": {
        "ssim_full_crop": float(ssim),
        "ssim_disc": ssim_disc,
        "edge_iou": float(edge_intersection / max(1, edge_union)),
        "component_transport": component_transport(reference_components, current_components),
    },
}

(OUTPUT / "globe-spatial-metrics.json").write_text(
    json.dumps(report, indent=2),
    encoding="utf-8",
)
print(json.dumps(report, indent=2))
