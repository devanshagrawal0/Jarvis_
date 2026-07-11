from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = (
    ROOT
    / "design"
    / "generated"
    / "blender-globe-framework"
    / "jarvis-globe-framework-first-pass-remake-4k.png"
)
DEFAULT_OUTPUT = (
    ROOT
    / "design"
    / "generated"
    / "blender-globe-framework"
    / "jarvis-globe-framework-first-pass-remake-beauty-4k.png"
)


def parse_args() -> tuple[Path, Path]:
    argv = sys.argv[1:]
    input_path = DEFAULT_INPUT
    output_path = DEFAULT_OUTPUT
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--input":
            input_path = Path(argv[index + 1])
            index += 2
        elif arg == "--output":
            output_path = Path(argv[index + 1])
            index += 2
        else:
            raise ValueError(f"Unknown argument: {arg}")
    return input_path, output_path


def screen_blend(base: Image.Image, glow: Image.Image, opacity: float) -> Image.Image:
    screened = ImageChops.screen(base, glow)
    return Image.blend(base, screened, opacity)


def main() -> None:
    input_path, output_path = parse_args()
    image = Image.open(input_path).convert("RGB")
    luma = ImageOps.grayscale(image)

    # A selective bloom mask: bright hologram pixels glow, the dark globe body stays sharp.
    bright_mask = luma.point(lambda value: max(0, min(255, int((value - 36) * 3.1))))
    cyan_source = Image.new("RGB", image.size, (32, 214, 255))
    bright_rgb = Image.composite(cyan_source, Image.new("RGB", image.size, (0, 0, 0)), bright_mask)
    source_color = ImageChops.screen(
        ImageEnhance.Color(Image.composite(image, Image.new("RGB", image.size, (0, 0, 0)), bright_mask)).enhance(1.45),
        bright_rgb,
    )

    small = ImageEnhance.Brightness(source_color.filter(ImageFilter.GaussianBlur(3.0))).enhance(1.35)
    medium = ImageEnhance.Brightness(source_color.filter(ImageFilter.GaussianBlur(13.0))).enhance(1.08)
    large = ImageEnhance.Brightness(source_color.filter(ImageFilter.GaussianBlur(44.0))).enhance(0.58)

    result = image
    result = screen_blend(result, large, 0.18)
    result = screen_blend(result, medium, 0.30)
    result = screen_blend(result, small, 0.38)

    # Lift the blue channel very slightly to better match the reference crop without washing out black.
    tint = Image.new("RGB", image.size, (0, 18, 31))
    result = screen_blend(result, tint, 0.045)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path, compress_level=8)
    print(f"BEAUTY_PATH={output_path}")


if __name__ == "__main__":
    main()
