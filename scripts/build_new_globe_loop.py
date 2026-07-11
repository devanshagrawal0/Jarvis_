from __future__ import annotations

import shutil
from pathlib import Path

import cv2

from retime_higgsfield_rotation import interpolate_frame


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "artifacts" / "new-globe" / "source-frames"
OUTPUT_DIR = ROOT / "artifacts" / "new-globe" / "loop-frames"
FIRST_SOURCE_FRAME = 1
LAST_SOURCE_FRAME = 120
SEAM_ALPHAS = (0.325, 0.675)


def main() -> None:
    source_paths = [
        SOURCE_DIR / f"frame-{index:03d}.png"
        for index in range(FIRST_SOURCE_FRAME, LAST_SOURCE_FRAME + 1)
    ]
    if not all(path.exists() for path in source_paths):
        raise RuntimeError(f"Missing extracted source frames in {SOURCE_DIR}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for old_frame in OUTPUT_DIR.glob("frame-*.png"):
        old_frame.unlink()

    output_index = 0
    for source_path in source_paths:
        shutil.copyfile(
            source_path,
            OUTPUT_DIR / f"frame-{output_index:03d}.png",
        )
        output_index += 1

    final_frame = cv2.imread(str(source_paths[-1]), cv2.IMREAD_COLOR)
    first_frame = cv2.imread(str(source_paths[0]), cv2.IMREAD_COLOR)
    if final_frame is None or first_frame is None:
        raise RuntimeError("Unable to decode the new globe loop boundary.")

    for alpha in SEAM_ALPHAS:
        transition = interpolate_frame(final_frame, first_frame, alpha)
        output_path = OUTPUT_DIR / f"frame-{output_index:03d}.png"
        if not cv2.imwrite(
            str(output_path),
            transition,
            [cv2.IMWRITE_PNG_COMPRESSION, 3],
        ):
            raise RuntimeError(f"Could not write {output_path}")
        output_index += 1

    print(f"source_frames={len(source_paths)}")
    print(f"generated_seam_frames={len(SEAM_ALPHAS)}")
    print(f"loop_frames={output_index}")
    print(f"duration_seconds={output_index / 24:.6f}")


if __name__ == "__main__":
    main()
