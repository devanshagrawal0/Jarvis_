from __future__ import annotations

import csv
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
FRAME_DIR = ROOT / "artifacts" / "constant-motion" / "frames"
OUTPUT_DIR = ROOT / "artifacts" / "constant-motion"
RETIMED_FRAME_DIR = OUTPUT_DIR / "retimed-frames"
TARGET_DURATION = 5.0
OUTPUT_FRAME_COUNT = 120


def estimate_step(previous: np.ndarray, current: np.ndarray) -> tuple[float, int]:
    scale = 0.5
    previous_gray = cv2.cvtColor(
        cv2.resize(previous, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )
    current_gray = cv2.cvtColor(
        cv2.resize(current, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )

    height, width = previous_gray.shape
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.circle(
        mask,
        (width // 2, int(height * 0.382)),
        int(height * 0.265),
        255,
        thickness=-1,
    )

    points = cv2.goodFeaturesToTrack(
        previous_gray,
        maxCorners=900,
        qualityLevel=0.008,
        minDistance=3,
        blockSize=5,
        mask=mask,
    )
    if points is None:
        return 1.0, 0

    tracked, status, errors = cv2.calcOpticalFlowPyrLK(
        previous_gray,
        current_gray,
        points,
        None,
        winSize=(25, 25),
        maxLevel=4,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.001),
    )
    if tracked is None or status is None:
        return 1.0, 0

    valid = status.reshape(-1).astype(bool)
    if errors is not None:
        valid &= errors.reshape(-1) < 24

    source = points.reshape(-1, 2)[valid]
    destination = tracked.reshape(-1, 2)[valid]
    displacement = destination - source
    finite = np.isfinite(displacement).all(axis=1)
    displacement = displacement[finite]
    source = source[finite]

    plausible = (
        (np.abs(displacement[:, 0]) < 18)
        & (np.abs(displacement[:, 1]) < 8)
        & (source[:, 1] < height * 0.63)
    )
    displacement = displacement[plausible]
    if len(displacement) < 20:
        return 1.0, len(displacement)

    horizontal = np.abs(displacement[:, 0])
    lower, upper = np.percentile(horizontal, [15, 85])
    horizontal = horizontal[(horizontal >= lower) & (horizontal <= upper)]
    return float(np.median(horizontal)), len(horizontal)


def smooth_motion(raw: np.ndarray) -> np.ndarray:
    padded = np.pad(raw, (8, 8), mode="edge")
    kernel = np.hanning(17)
    kernel /= kernel.sum()
    smooth = np.convolve(padded, kernel, mode="valid")
    return np.maximum(smooth, 0.05)


def interpolate_frame(
    previous: np.ndarray,
    current: np.ndarray,
    alpha: float,
) -> np.ndarray:
    if alpha <= 0.001:
        return previous.copy()
    if alpha >= 0.999:
        return current.copy()

    height, width = previous.shape[:2]
    flow_width = width // 2
    flow_height = height // 2
    previous_small = cv2.resize(previous, (flow_width, flow_height), interpolation=cv2.INTER_AREA)
    current_small = cv2.resize(current, (flow_width, flow_height), interpolation=cv2.INTER_AREA)
    previous_gray = cv2.cvtColor(previous_small, cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current_small, cv2.COLOR_BGR2GRAY)

    flow_forward = cv2.calcOpticalFlowFarneback(
        previous_gray,
        current_gray,
        None,
        0.5,
        4,
        25,
        4,
        7,
        1.5,
        cv2.OPTFLOW_FARNEBACK_GAUSSIAN,
    )
    flow_backward = cv2.calcOpticalFlowFarneback(
        current_gray,
        previous_gray,
        None,
        0.5,
        4,
        25,
        4,
        7,
        1.5,
        cv2.OPTFLOW_FARNEBACK_GAUSSIAN,
    )
    flow_forward = cv2.resize(flow_forward, (width, height), interpolation=cv2.INTER_LINEAR) * 2
    flow_backward = cv2.resize(flow_backward, (width, height), interpolation=cv2.INTER_LINEAR) * 2

    grid_x, grid_y = np.meshgrid(
        np.arange(width, dtype=np.float32),
        np.arange(height, dtype=np.float32),
    )
    previous_warped = cv2.remap(
        previous,
        grid_x - flow_forward[..., 0] * alpha,
        grid_y - flow_forward[..., 1] * alpha,
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )
    current_warped = cv2.remap(
        current,
        grid_x - flow_backward[..., 0] * (1 - alpha),
        grid_y - flow_backward[..., 1] * (1 - alpha),
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )
    return cv2.addWeighted(previous_warped, 1 - alpha, current_warped, alpha, 0)


def render_equal_angle_frames(
    frames: list[np.ndarray],
    motion: np.ndarray,
) -> list[tuple[int, int, float]]:
    cumulative = np.concatenate(([0.0], np.cumsum(motion)))
    total_motion = cumulative[-1]
    target_positions = np.linspace(
        0,
        total_motion,
        OUTPUT_FRAME_COUNT,
        endpoint=False,
    )

    RETIMED_FRAME_DIR.mkdir(parents=True, exist_ok=True)
    mapping: list[tuple[int, int, float]] = []
    for output_index, target in enumerate(target_positions):
        source_index = int(np.searchsorted(cumulative, target, side="right") - 1)
        source_index = min(max(source_index, 0), len(frames) - 2)
        interval_motion = max(motion[source_index], 1e-6)
        alpha = float((target - cumulative[source_index]) / interval_motion)
        alpha = float(np.clip(alpha, 0, 1))
        output = interpolate_frame(
            frames[source_index],
            frames[source_index + 1],
            alpha,
        )
        output_path = RETIMED_FRAME_DIR / f"frame-{output_index:03d}.png"
        if not cv2.imwrite(str(output_path), output, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
            raise RuntimeError(f"Could not write {output_path}")
        mapping.append((output_index, source_index, alpha))

    return mapping


def main() -> None:
    frame_paths = sorted(FRAME_DIR.glob("frame-*.jpg"))
    if len(frame_paths) < 3:
        raise RuntimeError(f"Expected extracted frames in {FRAME_DIR}")

    frames = [cv2.imread(str(path), cv2.IMREAD_COLOR) for path in frame_paths]
    if any(frame is None for frame in frames):
        raise RuntimeError("One or more extracted frames could not be decoded.")

    measurements: list[float] = []
    tracked_counts: list[int] = []
    for previous, current in zip(frames, frames[1:]):
        motion, tracked = estimate_step(previous, current)
        measurements.append(motion)
        tracked_counts.append(tracked)

    raw = np.asarray(measurements, dtype=np.float64)
    smooth = smooth_motion(raw)
    durations = smooth / smooth.sum() * TARGET_DURATION
    mapping = render_equal_angle_frames(frames, smooth)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUTPUT_DIR / "motion-analysis.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("interval", "raw_motion", "smoothed_motion", "duration", "tracks"))
        for index, (raw_step, smooth_step, duration, tracks) in enumerate(
            zip(raw, smooth, durations, tracked_counts)
        ):
            writer.writerow((index, raw_step, smooth_step, duration, tracks))

    with (OUTPUT_DIR / "frame-map.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("output_frame", "source_interval", "alpha"))
        writer.writerows(mapping)

    concat_path = OUTPUT_DIR / "constant-motion.ffconcat"
    with concat_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("ffconcat version 1.0\n")
        for path, duration in zip(frame_paths[:-1], durations):
            escaped = path.as_posix().replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")
            handle.write(f"duration {duration:.9f}\n")
        escaped_last = frame_paths[-1].as_posix().replace("'", "'\\''")
        handle.write(f"file '{escaped_last}'\n")

    print(f"frames={len(frame_paths)}")
    print(f"raw_motion_range={raw.min():.4f}..{raw.max():.4f}")
    print(f"smoothed_motion_range={smooth.min():.4f}..{smooth.max():.4f}")
    print(f"duration_range={durations.min():.6f}..{durations.max():.6f}")
    print(f"duration_sum={durations.sum():.9f}")
    print(f"retimed_frames={len(mapping)}")
    print(concat_path)


if __name__ == "__main__":
    main()
