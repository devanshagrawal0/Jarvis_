from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import piq
import torch
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
INPUT = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else ROOT / "artifacts" / "globe-spatial-baseline"
)
OUTPUT = (
    Path(sys.argv[2]).resolve()
    if len(sys.argv) > 2
    else INPUT / "perceptual-metrics.json"
)


def tensor(path: Path) -> torch.Tensor:
    image = Image.open(path).convert("RGB").resize((256, 256), Image.Resampling.LANCZOS)
    values = np.asarray(image).astype(np.float32) / 255.0
    return torch.from_numpy(values).permute(2, 0, 1).unsqueeze(0)


reference = tensor(INPUT / "reference-globe.png")
current = tensor(INPUT / "current-globe.png")


def scalar(value: torch.Tensor) -> float:
    return float(value.detach().cpu().item())


metrics: dict[str, float | str] = {}
functions = {
    "psnr": lambda: piq.psnr(reference, current, data_range=1.0),
    "ssim": lambda: piq.ssim(reference, current, data_range=1.0),
    "ms_ssim": lambda: piq.multi_scale_ssim(reference, current, data_range=1.0),
    "vif_p": lambda: piq.vif_p(reference, current, data_range=1.0),
    "gmsd": lambda: piq.gmsd(reference, current, data_range=1.0),
    "multi_scale_gmsd": lambda: piq.multi_scale_gmsd(reference, current, data_range=1.0),
    "fsim": lambda: piq.fsim(reference, current, data_range=1.0),
    "srsim": lambda: piq.srsim(reference, current, data_range=1.0),
    "haarpsi": lambda: piq.haarpsi(reference, current, data_range=1.0),
}

for name, function in functions.items():
    try:
        metrics[name] = scalar(function())
    except Exception as error:  # noqa: BLE001
        metrics[name] = f"error: {error}"

model_metrics = {
    "dists": lambda: piq.DISTS(reduction="mean")(reference, current),
    "lpips": lambda: piq.LPIPS(reduction="mean")(reference, current),
}
for name, function in model_metrics.items():
    try:
        metrics[name] = scalar(function())
    except Exception as error:  # noqa: BLE001
        metrics[name] = f"error: {error}"

report = {
    "inputs": {
        "reference": str(INPUT / "reference-globe.png"),
        "current": str(INPUT / "current-globe.png"),
        "evaluation_size": [256, 256],
    },
    "metrics": metrics,
}
OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
