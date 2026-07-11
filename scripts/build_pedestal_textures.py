import math
import random
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "hologram"
SIZE = 2048


def main():
    random.seed(6174)
    image = Image.new("L", (SIZE, SIZE))
    pixels = image.load()
    center = (SIZE - 1) * 0.5

    radial_noise = [random.uniform(-1.0, 1.0) for _ in range(SIZE * 2)]
    angular_noise = [random.uniform(-1.0, 1.0) for _ in range(4096)]

    for y in range(SIZE):
        dy = y - center
        for x in range(SIZE):
            dx = x - center
            radius = math.sqrt(dx * dx + dy * dy)
            angle = (math.atan2(dy, dx) + math.pi) / math.tau
            radius_index = min(len(radial_noise) - 1, int(radius * 1.9))
            angle_index = min(len(angular_noise) - 1, int(angle * len(angular_noise)))
            fine_ring = math.sin(radius * 0.82) * 0.08
            broad_ring = math.sin(radius * 0.115) * 0.045
            streak = angular_noise[angle_index] * 0.045
            grain = radial_noise[radius_index] * 0.12
            value = int(max(0, min(255, 142 + (fine_ring + broad_ring + streak + grain) * 255)))
            pixels[x, y] = value

    image = image.filter(ImageFilter.GaussianBlur(0.32))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT / "pedestal-brushed-roughness.png", optimize=True)
    print(f"Built {SIZE}x{SIZE} brushed radial roughness map.")


if __name__ == "__main__":
    main()
