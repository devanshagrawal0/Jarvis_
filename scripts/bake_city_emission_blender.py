import json
import math
import os

import bpy
import numpy as np


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "scripts", "data", "ne_10m_populated_places.geojson")
OUTPUT = os.path.join(ROOT, "public", "hologram", "globe-city-emission.png")

WIDTH = 4096
HEIGHT = 2048
SPECIAL_CITIES = {
    "boston": (-71.0589, 42.3601),
    "nagpur": (79.0882, 21.1458),
}


def add_gaussian(channel, center_x, center_y, radius, intensity):
    reach = max(2, int(math.ceil(radius * 3.2)))
    x0 = max(0, center_x - reach)
    x1 = min(WIDTH, center_x + reach + 1)
    y0 = max(0, center_y - reach)
    y1 = min(HEIGHT, center_y + reach + 1)
    if x0 >= x1 or y0 >= y1:
        return

    yy, xx = np.mgrid[y0:y1, x0:x1]
    distance = ((xx - center_x) ** 2 + (yy - center_y) ** 2) / max(radius * radius, 0.01)
    glow = np.exp(-distance * 0.5) * intensity
    channel[y0:y1, x0:x1] = np.maximum(channel[y0:y1, x0:x1], glow)

    if center_x < reach:
        add_gaussian(channel, center_x + WIDTH, center_y, radius, intensity)
    elif center_x > WIDTH - reach:
        add_gaussian(channel, center_x - WIDTH, center_y, radius, intensity)


def project(longitude, latitude):
    x = int(round(((longitude + 180.0) / 360.0) * (WIDTH - 1)))
    y = int(round(((90.0 - latitude) / 180.0) * (HEIGHT - 1)))
    return x, y


def main():
    with open(SOURCE, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    ordinary = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    major = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    special = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    halo = np.zeros((HEIGHT, WIDTH), dtype=np.float32)

    for feature in data["features"]:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        if not coordinates or len(coordinates) < 2:
            continue

        longitude, latitude = float(coordinates[0]), float(coordinates[1])
        population = max(
            1000.0,
            float(properties.get("POP_MAX") or properties.get("POP2025") or 1000.0),
        )
        population_scale = min(1.0, max(0.0, (math.log10(population) - 3.0) / 4.2))
        x, y = project(longitude, latitude)

        ordinary_radius = 0.72 + population_scale * 0.72
        ordinary_intensity = 0.16 + population_scale * 0.52
        add_gaussian(ordinary, x, y, ordinary_radius, ordinary_intensity)

        if population >= 750_000 or properties.get("WORLDCITY") == 1:
            major_radius = 1.15 + population_scale * 1.05
            major_intensity = 0.28 + population_scale * 0.7
            add_gaussian(major, x, y, major_radius, major_intensity)
            add_gaussian(halo, x, y, major_radius * 3.4, major_intensity * 0.18)

    for longitude, latitude in SPECIAL_CITIES.values():
        x, y = project(longitude, latitude)
        add_gaussian(special, x, y, 2.15, 1.0)
        add_gaussian(halo, x, y, 10.0, 0.76)

    rgba = np.zeros((HEIGHT, WIDTH, 4), dtype=np.float32)
    rgba[..., 0] = np.clip(ordinary, 0.0, 1.0)
    rgba[..., 1] = np.clip(major, 0.0, 1.0)
    rgba[..., 2] = np.clip(special, 0.0, 1.0)
    rgba[..., 3] = np.clip(halo, 0.0, 1.0)

    image = bpy.data.images.new(
        "Jarvis City Emission",
        width=WIDTH,
        height=HEIGHT,
        alpha=True,
        float_buffer=False,
    )
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(rgba[::-1].reshape(-1))
    image.filepath_raw = OUTPUT
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    print(f"Baked {WIDTH}x{HEIGHT} city emission atlas to {OUTPUT}")


main()
