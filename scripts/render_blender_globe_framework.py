from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "design" / "generated" / "blender-globe-framework"


@dataclass(frozen=True)
class RenderConfig:
    width: int = 3840
    height: int = 2160
    samples: int = 96
    output_tag: str = "4k"
    denoise: bool = False
    engine: str | None = None


def parse_args() -> RenderConfig:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    width = 3840
    height = 2160
    samples = 96
    output_tag = "4k"
    denoise = False
    engine: str | None = None

    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--resolution":
            width = int(argv[index + 1])
            height = int(argv[index + 2])
            index += 3
        elif arg == "--samples":
            samples = int(argv[index + 1])
            index += 2
        elif arg == "--output-tag":
            output_tag = argv[index + 1]
            index += 2
        elif arg == "--denoise":
            denoise = True
            index += 1
        elif arg == "--engine":
            engine = argv[index + 1]
            index += 2
        else:
            raise ValueError(f"Unknown argument: {arg}")

    return RenderConfig(
        width=width,
        height=height,
        samples=samples,
        output_tag=output_tag,
        denoise=denoise,
        engine=engine,
    )


def main() -> None:
    config = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    if config.engine:
        scene.render.engine = config.engine
    scene.render.resolution_x = config.width
    scene.render.resolution_y = config.height
    scene.cycles.samples = config.samples
    scene.cycles.use_denoising = config.denoise
    if config.engine == "BLENDER_EEVEE" and hasattr(scene, "eevee"):
        eevee = scene.eevee
        for attr, value in (
            ("taa_render_samples", max(64, min(config.samples, 256))),
            ("taa_samples", max(32, min(config.samples, 128))),
            ("use_gtao", True),
            ("gtao_distance", 3),
            ("gtao_factor", 0.42),
        ):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)
    if hasattr(scene.render, "filter_size"):
        scene.render.filter_size = 0.65
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.compression = 8

    render_path = OUTPUT_DIR / f"jarvis-globe-framework-first-pass-{config.output_tag}.png"
    scene.render.filepath = str(render_path)
    bpy.ops.render.render(write_still=True)
    print(f"RENDER_PATH={render_path}")


if __name__ == "__main__":
    main()
