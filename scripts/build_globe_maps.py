import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "data" / "ne_50m_admin_0_countries.geojson"
OUTPUT = ROOT / "public" / "hologram"

WIDTH = 4096
HEIGHT = 2048
SUPERSAMPLE = 2
W = WIDTH * SUPERSAMPLE
H = HEIGHT * SUPERSAMPLE


def project_ring(ring):
    points = [
        (((longitude + 180.0) / 360.0) * W, ((90.0 - latitude) / 180.0) * H)
        for longitude, latitude, *_ in ring
    ]
    xs = [point[0] for point in points]
    if max(xs) - min(xs) > W * 0.5:
        points = [(x + W if x < W * 0.5 else x, y) for x, y in points]
    return points


def draw_wrapped(draw, points, *, fill=None, outline=None, width=1):
    for offset in (-W, 0, W):
        shifted = [(x + offset, y) for x, y in points]
        if fill is not None:
            draw.polygon(shifted, fill=fill)
        if outline is not None:
            draw.line(shifted, fill=outline, width=width, joint="curve")


def iter_polygons(geometry):
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        yield coordinates
    elif geometry_type == "MultiPolygon":
        yield from coordinates


def main():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    land = Image.new("L", (W, H), 0)
    borders = Image.new("L", (W, H), 0)
    land_draw = ImageDraw.Draw(land)
    border_draw = ImageDraw.Draw(borders)

    for feature in data["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        for polygon in iter_polygons(geometry):
            if not polygon:
                continue
            outer = project_ring(polygon[0])
            draw_wrapped(land_draw, outer, fill=255)
            draw_wrapped(
                border_draw,
                outer,
                outline=255,
                width=2 * SUPERSAMPLE,
            )
            for hole in polygon[1:]:
                hole_points = project_ring(hole)
                draw_wrapped(land_draw, hole_points, fill=0)
                draw_wrapped(
                    border_draw,
                    hole_points,
                    outline=255,
                    width=2 * SUPERSAMPLE,
                )

    border_glow = borders.filter(ImageFilter.GaussianBlur(4 * SUPERSAMPLE))
    land = land.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    borders = borders.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    border_glow = border_glow.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    land.convert("RGB").save(
        OUTPUT / "globe-land-mask.png",
        optimize=True,
    )
    Image.merge("RGB", (land, borders, border_glow)).save(
        OUTPUT / "globe-country-map.png",
        optimize=True,
    )

    print(f"Built {WIDTH}x{HEIGHT} land and country maps from Natural Earth 1:50m data.")


if __name__ == "__main__":
    main()
