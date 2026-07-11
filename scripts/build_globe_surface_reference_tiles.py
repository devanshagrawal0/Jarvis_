from __future__ import annotations

import math
import random
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "design" / "generated" / "blender-globe-framework" / "material-tiles"
BLEND_PATH = OUTPUT_DIR / "jarvis-globe-surface-reference-tiles.blend"
PNG_PATH = OUTPUT_DIR / "jarvis-globe-surface-reference-tiles-4k.png"


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.strip().lstrip("#")
    return (
        int(value[0:2], 16) / 255,
        int(value[2:4], 16) / 255,
        int(value[4:6], 16) / 255,
        alpha,
    )


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.lights,
        bpy.data.cameras,
    ):
        for item in list(collection):
            collection.remove(item)


def make_surface_material(name: str, base: str, emission: str, emission_strength: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba(base)
        bsdf.inputs["Roughness"].default_value = 0.92
        bsdf.inputs["Metallic"].default_value = 0.0
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = 1.0
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = rgba(emission)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def make_emission_material(name: str, color: str, strength: float, alpha: float = 1.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.show_transparent_back = False
    nodes = mat.node_tree.nodes
    nodes.clear()
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    emission = nodes.new("ShaderNodeEmission")
    mix = nodes.new("ShaderNodeMixShader")
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent.inputs["Color"].default_value = (0, 0, 0, 0)
    emission.inputs["Color"].default_value = rgba(color, alpha)
    emission.inputs["Strength"].default_value = strength
    mix.inputs["Fac"].default_value = 1.0 - alpha
    mat.node_tree.links.new(transparent.outputs["BSDF"], mix.inputs[1])
    mat.node_tree.links.new(emission.outputs["Emission"], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def make_rect(name: str, cx: float, cy: float, width: float, height: float, z: float, mat: bpy.types.Material) -> bpy.types.Object:
    hw = width / 2
    hh = height / 2
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(
        [(cx - hw, cy - hh, z), (cx + hw, cy - hh, z), (cx + hw, cy + hh, z), (cx - hw, cy + hh, z)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def add_text(name: str, body: str, x: float, y: float, size: float, mat: bpy.types.Material) -> None:
    bpy.ops.object.text_add(location=(x, y, 0.08), rotation=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.data.body = body
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.materials.append(mat)


def add_disc_batch(
    name: str,
    points: list[tuple[float, float, float]],
    mat: bpy.types.Material,
    segments: int = 9,
) -> bpy.types.Object:
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for px, py, radius in points:
        base = len(verts)
        for index in range(segments):
            angle = math.tau * index / segments
            verts.append((px + math.cos(angle) * radius, py + math.sin(angle) * radius, 0.09))
        faces.append(tuple(base + index for index in range(segments)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def add_poly_curve(name: str, coords: list[tuple[float, float]], mat: bpy.types.Material, bevel: float, z: float = 0.11) -> None:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(coords) - 1)
    for point, (x, y) in zip(spline.points, coords):
        point.co = (x, y, z, 1.0)
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)


def seeded_noise_points(
    rng: random.Random,
    cx: float,
    cy: float,
    width: float,
    height: float,
    count: int,
    radius_range: tuple[float, float],
    bias: str,
) -> list[tuple[float, float, float]]:
    points: list[tuple[float, float, float]] = []
    for _ in range(count):
        x = cx + (rng.random() - 0.5) * width * 0.86
        y = cy + (rng.random() - 0.5) * height * 0.70
        if bias == "equator":
            y = cy + (rng.random() - 0.5) * height * 0.40 + math.sin(rng.random() * math.tau) * height * 0.08
        elif bias == "clusters":
            cluster_x = cx + rng.choice([-0.27, -0.10, 0.18, 0.30]) * width
            cluster_y = cy + rng.choice([-0.18, 0.03, 0.21]) * height
            x = cluster_x + rng.gauss(0, width * 0.065)
            y = cluster_y + rng.gauss(0, height * 0.070)
        elif bias == "rim":
            side = rng.choice([-1, 1])
            x = cx + side * width * (0.33 + rng.random() * 0.10)
            y = cy + (rng.random() - 0.5) * height * 0.64
        radius = rng.uniform(*radius_range)
        if cx - width * 0.45 <= x <= cx + width * 0.45 and cy - height * 0.39 <= y <= cy + height * 0.39:
            points.append((x, y, radius))
    return points


def add_scanlines(cx: float, cy: float, width: float, height: float, mat: bpy.types.Material, count: int, slope: float) -> None:
    for index in range(count):
        y = cy - height * 0.32 + index * (height * 0.64 / max(1, count - 1))
        gap = 0.11 if index % 3 else 0.22
        add_poly_curve(
            f"scanline_{cx}_{index}",
            [(cx - width * 0.38, y - slope), (cx - gap, y), (cx + width * 0.38, y + slope)],
            mat,
            0.004 if index % 4 else 0.006,
        )


def add_hologram_arcs(
    rng: random.Random,
    cx: float,
    cy: float,
    width: float,
    height: float,
    mat: bpy.types.Material,
    count: int,
    broken: bool,
) -> None:
    for index in range(count):
        radius_x = width * rng.uniform(0.16, 0.42)
        radius_y = height * rng.uniform(0.05, 0.20)
        start = rng.uniform(-40, 210)
        length = rng.uniform(26, 96)
        pieces = 2 if broken and index % 2 == 0 else 1
        for piece in range(pieces):
            piece_start = start + piece * length / pieces + (8 if piece else 0)
            piece_end = start + (piece + 1) * length / pieces - (8 if broken else 0)
            coords: list[tuple[float, float]] = []
            for step in range(18):
                t = math.radians(piece_start + (piece_end - piece_start) * step / 17)
                x = cx + math.cos(t) * radius_x + rng.uniform(-0.010, 0.010)
                y = cy + math.sin(t) * radius_y + rng.uniform(-0.010, 0.010)
                coords.append((x, y))
            add_poly_curve(f"arc_{cx}_{index}_{piece}", coords, mat, rng.uniform(0.004, 0.009))


def add_micro_grid(cx: float, cy: float, width: float, height: float, mat: bpy.types.Material) -> None:
    for index in range(8):
        x = cx - width * 0.34 + index * width * 0.10
        add_poly_curve(f"grid_v_{cx}_{index}", [(x, cy - height * 0.34), (x + width * 0.05, cy + height * 0.33)], mat, 0.0025)
    for index in range(7):
        y = cy - height * 0.31 + index * height * 0.10
        add_poly_curve(f"grid_h_{cx}_{index}", [(cx - width * 0.37, y), (cx + width * 0.37, y + height * 0.025)], mat, 0.0025)


def add_tile(
    index: int,
    cx: float,
    cy: float,
    width: float,
    height: float,
    title: str,
    subtitle: str,
    base_hex: str,
    accent_hex: str,
    hot_hex: str,
    style: str,
    materials: dict[str, bpy.types.Material],
) -> None:
    rng = random.Random(8200 + index * 97)
    surface_mat = make_surface_material(f"{title}_surface", base_hex, accent_hex, 0.035)
    make_rect(f"{title}_dark_surface", cx, cy, width, height, 0.0, surface_mat)

    border_mat = make_emission_material(f"{title}_edge_cyan", accent_hex, 0.70, 0.34)
    edge = [
        (cx - width / 2, cy - height / 2),
        (cx + width / 2, cy - height / 2),
        (cx + width / 2, cy + height / 2),
        (cx - width / 2, cy + height / 2),
        (cx - width / 2, cy - height / 2),
    ]
    add_poly_curve(f"{title}_tile_edge", edge, border_mat, 0.006)

    faint_mat = make_emission_material(f"{title}_faint_particles", accent_hex, 0.58, 0.25)
    mid_mat = make_emission_material(f"{title}_mid_particles", accent_hex, 1.12, 0.42)
    hot_mat = make_emission_material(f"{title}_hot_particles", hot_hex, 2.35, 0.62)
    line_mat = make_emission_material(f"{title}_lines", accent_hex, 1.25, 0.50)
    dim_line_mat = make_emission_material(f"{title}_dim_lines", accent_hex, 0.65, 0.24)

    if style == "starfield":
        add_disc_batch(f"{title}_faint_dots", seeded_noise_points(rng, cx, cy, width, height, 360, (0.006, 0.014), "none"), faint_mat)
        add_disc_batch(f"{title}_mid_dots", seeded_noise_points(rng, cx, cy, width, height, 92, (0.010, 0.022), "equator"), mid_mat)
        add_disc_batch(f"{title}_hot_dots", seeded_noise_points(rng, cx, cy, width, height, 14, (0.022, 0.042), "clusters"), hot_mat)
        add_hologram_arcs(rng, cx, cy, width, height, line_mat, 8, True)
    elif style == "circuit":
        add_micro_grid(cx, cy, width, height, dim_line_mat)
        add_disc_batch(f"{title}_pin_dots", seeded_noise_points(rng, cx, cy, width, height, 180, (0.006, 0.014), "clusters"), mid_mat)
        for line_index in range(16):
            x = cx + rng.uniform(-0.37, 0.37) * width
            y = cy + rng.uniform(-0.31, 0.31) * height
            add_poly_curve(
                f"{title}_circuit_{line_index}",
                [(x, y), (x + rng.uniform(-0.25, 0.25), y), (x + rng.uniform(-0.20, 0.20), y + rng.uniform(-0.23, 0.23))],
                line_mat if line_index % 4 == 0 else dim_line_mat,
                0.005,
            )
    elif style == "mist":
        haze_mat = make_emission_material(f"{title}_soft_haze", accent_hex, 0.42, 0.08)
        add_disc_batch(f"{title}_haze_clouds", seeded_noise_points(rng, cx, cy, width, height, 32, (0.075, 0.18), "none"), haze_mat, 18)
        add_scanlines(cx, cy, width, height, dim_line_mat, 14, 0.035)
        add_disc_batch(f"{title}_faint_dots", seeded_noise_points(rng, cx, cy, width, height, 260, (0.005, 0.012), "equator"), faint_mat)
        add_hologram_arcs(rng, cx, cy, width, height, line_mat, 5, True)
    elif style == "continent":
        add_disc_batch(f"{title}_continent_faint", seeded_noise_points(rng, cx, cy, width, height, 260, (0.007, 0.015), "clusters"), faint_mat)
        add_disc_batch(f"{title}_continent_mid", seeded_noise_points(rng, cx, cy, width, height, 140, (0.011, 0.025), "clusters"), mid_mat)
        add_disc_batch(f"{title}_continent_hot", seeded_noise_points(rng, cx, cy, width, height, 22, (0.020, 0.040), "clusters"), hot_mat)
        add_hologram_arcs(rng, cx, cy, width, height, line_mat, 10, True)
    elif style == "rim":
        add_disc_batch(f"{title}_rim_dots", seeded_noise_points(rng, cx, cy, width, height, 190, (0.006, 0.014), "rim"), mid_mat)
        add_disc_batch(f"{title}_center_noise", seeded_noise_points(rng, cx, cy, width, height, 150, (0.005, 0.011), "none"), faint_mat)
        add_scanlines(cx, cy, width, height, dim_line_mat, 18, 0.022)
        for side in (-1, 1):
            x = cx + side * width * 0.39
            add_poly_curve(f"{title}_side_rim_{side}", [(x, cy - height * 0.34), (x + side * width * 0.035, cy), (x, cy + height * 0.34)], line_mat, 0.013)
        add_hologram_arcs(rng, cx, cy, width, height, line_mat, 6, False)

    add_text(f"{title}_label", f"{index}. {title.upper()}", cx, cy - height * 0.47, 0.135, materials["label"])
    add_text(f"{title}_subtitle", subtitle, cx, cy - height * 0.535, 0.072, materials["sub_label"])


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        if hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = 96
        if hasattr(scene.eevee, "use_bloom"):
            scene.eevee.use_bloom = True
        if hasattr(scene.eevee, "bloom_intensity"):
            scene.eevee.bloom_intensity = 0.045
        if hasattr(scene.eevee, "bloom_radius"):
            scene.eevee.bloom_radius = 3.2
    scene.render.resolution_x = 3840
    scene.render.resolution_y = 2160
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.compression = 8
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.45
    scene.view_settings.gamma = 1.0
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = rgba("00050B")[:3]

    bpy.ops.object.camera_add(location=(0, 0, 10), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 10.8
    scene.camera = camera


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()
    configure_scene()

    bg = make_surface_material("Reference_Board_Background", "00050B", "051827", 0.02)
    make_rect("Reference_Board_Background", 0, 0, 20, 12, -0.04, bg)
    label = make_emission_material("Label_Cyan", "B8EFFF", 0.95, 0.74)
    sub_label = make_emission_material("Label_Dim_Cyan", "6BBCE5", 0.65, 0.55)

    materials = {"label": label, "sub_label": sub_label}
    tiles = [
        ("Carbon starfield", "black core / fine cyan data dust", "00060C", "18BCEF", "D7F6FF", "starfield"),
        ("Obsidian circuit", "matte navy / etched micro traces", "000910", "11A9DE", "C8F2FF", "circuit"),
        ("Deep scan haze", "dark surface / controlled atmospheric depth", "01070D", "2ACBFF", "BFEFFF", "mist"),
        ("Continental signal", "clustered map texture / small hot nodes", "00070D", "16B6EE", "D5F8FF", "continent"),
        ("Aurora rim matrix", "edge energy / sparse center texture", "000811", "24D2FF", "D9FBFF", "rim"),
    ]

    tile_width = 3.22
    tile_height = 6.05
    start_x = -7.4
    for idx, tile in enumerate(tiles, start=1):
        add_tile(idx, start_x + (idx - 1) * 3.7, 0.22, tile_width, tile_height, *tile, materials)

    add_text("Board_Title", "GLOBE SURFACE TEXTURE REFERENCES", 0, 4.68, 0.18, label)
    add_text("Board_Subtitle", "near-black surface studies only - no change applied to the current globe", 0, 4.38, 0.088, sub_label)

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.context.scene.render.filepath = str(PNG_PATH)
    bpy.ops.render.render(write_still=True)
    print(f"BLEND_PATH={BLEND_PATH}")
    print(f"PNG_PATH={PNG_PATH}")


if __name__ == "__main__":
    main()
