from __future__ import annotations

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "design" / "generated" / "blender-globe-framework" / "material-tiles"
BLEND_PATH = OUTPUT_DIR / "jarvis-globe-color-reference-tiles.blend"
PNG_PATH = OUTPUT_DIR / "jarvis-globe-color-reference-tiles-4k.png"


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
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            collection.remove(item)


def make_flat_material(name: str, color: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba(color)
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.0
    return mat


def make_emission_material(name: str, color: str, strength: float = 0.7) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    emission.inputs["Color"].default_value = rgba(color)
    emission.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def make_rect(name: str, cx: float, cy: float, width: float, height: float, z: float, mat: bpy.types.Material) -> None:
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


def add_text(name: str, body: str, x: float, y: float, size: float, mat: bpy.types.Material) -> None:
    bpy.ops.object.text_add(location=(x, y, 0.05), rotation=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.body = body
    obj.data.size = size
    obj.data.materials.append(mat)


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 3840
    scene.render.resolution_y = 2160
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = rgba("000407")[:3]

    bpy.ops.object.camera_add(location=(0, 0, 10), rotation=(0, 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 8.0
    scene.camera = camera


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()
    configure_scene()

    bg = make_flat_material("Board background", "000407")
    label = make_emission_material("Readable label", "BDEFFF", 0.85)
    muted = make_emission_material("Muted label", "78AFC7", 0.55)

    make_rect("Background", 0, 0, 16, 9, -0.08, bg)

    colors = [
        ("01", "Reference Black", "00060C", "closest current target"),
        ("02", "Ink Navy", "000A14", "slightly bluer surface"),
        ("03", "Cold Graphite", "020B12", "more premium charcoal"),
        ("04", "Abyss Teal", "001015", "subtle teal body"),
        ("05", "Blue Obsidian", "020713", "cool violet-blue shadow"),
    ]

    tile_w = 2.58
    tile_h = 4.85
    start_x = -5.85
    spacing = 2.94
    y = 0.18

    add_text("Title", "GLOBE SURFACE COLOR ONLY", 0, 3.38, 0.22, label)
    add_text("Subtitle", "no texture / no lines / no particles / no material changes applied", 0, 3.05, 0.105, muted)

    for idx, (num, name, color, note) in enumerate(colors):
        x = start_x + idx * spacing
        mat = make_flat_material(f"{name} {color}", color)
        make_rect(f"Tile {num} {name}", x, y, tile_w, tile_h, 0, mat)
        edge = make_flat_material(f"{name} edge", "0B2D3A")
        make_rect(f"Tile {num} top edge", x, y + tile_h / 2 + 0.035, tile_w, 0.035, 0.02, edge)
        make_rect(f"Tile {num} bottom edge", x, y - tile_h / 2 - 0.035, tile_w, 0.035, 0.02, edge)
        make_rect(f"Tile {num} left edge", x - tile_w / 2 - 0.035, y, 0.035, tile_h + 0.07, 0.02, edge)
        make_rect(f"Tile {num} right edge", x + tile_w / 2 + 0.035, y, 0.035, tile_h + 0.07, 0.02, edge)
        add_text(f"{name} number", num, x, y + 1.92, 0.22, label)
        add_text(f"{name} label", name.upper(), x, y - 1.95, 0.125, label)
        add_text(f"{name} hex", f"#{color}", x, y - 2.22, 0.115, muted)
        add_text(f"{name} note", note, x, y - 2.48, 0.064, muted)

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.context.scene.render.filepath = str(PNG_PATH)
    bpy.ops.render.render(write_still=True)
    print(f"BLEND_PATH={BLEND_PATH}")
    print(f"PNG_PATH={PNG_PATH}")


if __name__ == "__main__":
    main()
