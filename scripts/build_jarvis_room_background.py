from __future__ import annotations

import math
import random
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_blender_globe_framework import (  # noqa: E402
    FRAME_START,
    GLOBE_CENTER_Z,
    GLOBE_RADIUS,
    RenderConfig as BaseRenderConfig,
    animate_rotation,
    build_base,
    build_globe,
    build_materials,
    configure_scene,
    create_empty,
    create_poly_curve,
    look_at,
    make_dot_mesh,
    make_emission_material,
    make_principled_material,
    reset_scene,
    rgba,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "design" / "generated" / "jarvis-room-background"
BLEND_PATH = OUTPUT_DIR / "jarvis-room-background-clean.blend"


@dataclass(frozen=True)
class RoomRenderConfig:
    width: int = 3840
    height: int = 2160
    samples: int = 192
    output_tag: str = "4k"
    render: bool = True


def parse_args() -> RoomRenderConfig:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    width = 3840
    height = 2160
    samples = 192
    output_tag = "4k"
    render = True

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
        elif arg == "--no-render":
            render = False
            index += 1
        else:
            raise ValueError(f"Unknown argument: {arg}")

    return RoomRenderConfig(width=width, height=height, samples=samples, output_tag=output_tag, render=render)


def configure_room_scene(config: RoomRenderConfig) -> None:
    configure_scene(
        BaseRenderConfig(
            width=config.width,
            height=config.height,
            samples=config.samples,
            output_tag=config.output_tag,
            render=config.render,
        )
    )
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        eevee = scene.eevee
        for attr, value in (
            ("taa_render_samples", max(128, min(config.samples, 256))),
            ("taa_samples", 96),
            ("use_gtao", True),
            ("gtao_distance", 3.5),
            ("gtao_factor", 0.55),
        ):
            if hasattr(eevee, attr):
                setattr(eevee, attr, value)

    scene.view_settings.exposure = -0.58
    scene.view_settings.exposure = -0.92
    scene.view_settings.gamma = 1.0
    if scene.world:
        scene.world.color = (0.0, 0.0, 0.0)


def make_room_materials() -> dict[str, bpy.types.Material]:
    return {
        "floor": make_emission_material("Room unlit black floor", "#000001", strength=1.0, alpha=1.0),
        "back_wall": make_emission_material("Room unlit black rear wall", "#000001", strength=1.0, alpha=1.0),
        "side_wall": make_emission_material("Room unlit side darkness", "#000000", strength=1.0, alpha=1.0),
        "floor_grid": make_emission_material("Room floor perspective grid", "#075D78", strength=0.34, alpha=0.04),
        "floor_grid_hot": make_emission_material("Room central floor hot grid", "#22C8EA", strength=1.05, alpha=0.12),
        "floor_strip": make_emission_material("Room hidden bottom light strips", "#24D9FF", strength=1.95, alpha=0.24),
        "floor_strip_dim": make_emission_material("Room dim bottom light strips", "#0D86AA", strength=0.92, alpha=0.11),
        "floor_glow": make_emission_material("Room soft floor light wash", "#0BA6D4", strength=0.55, alpha=0.055),
        "floor_glow_hot": make_emission_material("Room central floor hidden glow", "#50E6FF", strength=1.15, alpha=0.095),
        "wall_grid": make_emission_material("Room rear wall faint data grid", "#064D70", strength=0.22, alpha=0.028),
        "wall_column": make_emission_material("Room vertical data haze", "#16A9D4", strength=0.64, alpha=0.075),
        "wall_haze": make_emission_material("Room broad hidden wall haze", "#0E83B2", strength=0.42, alpha=0.05),
        "wall_haze_hot": make_emission_material("Room central hidden wall haze", "#27CFFF", strength=0.72, alpha=0.07),
        "wall_point": make_emission_material("Room distant data points", "#19CFFF", strength=1.05, alpha=0.22),
        "horizon": make_emission_material("Room horizon light strips", "#20B9DE", strength=0.92, alpha=0.095),
    }


def tune_room_globe_materials(materials: dict[str, bpy.types.Material]) -> None:
    materials.update(
        {
            "pedestal_dark": make_principled_material(
                "Room pedestal black graphite",
                "#000203",
                metallic=0.82,
                roughness=0.4,
                emission="#000609",
                emission_strength=0.008,
            ),
            "pedestal_mid": make_principled_material(
                "Room pedestal dim mid graphite",
                "#01080B",
                metallic=0.76,
                roughness=0.42,
                emission="#001016",
                emission_strength=0.012,
            ),
            "pedestal_upper": make_principled_material(
                "Room pedestal dark upper lip",
                "#020D10",
                metallic=0.7,
                roughness=0.43,
                emission="#001820",
                emission_strength=0.014,
            ),
            "pedestal_collar": make_principled_material(
                "Room pedestal muted collar",
                "#031318",
                metallic=0.66,
                roughness=0.45,
                emission="#00202B",
                emission_strength=0.016,
            ),
            "ring": make_emission_material("Room pedestal cyan ring", "#16A8C4", strength=0.92, alpha=0.105),
            "ring_soft": make_emission_material("Room pedestal soft outer rim", "#064E65", strength=0.42, alpha=0.055),
            "ring_hot": make_emission_material("Room pedestal hot ring", "#24C0DA", strength=0.95, alpha=0.11),
            "ring_center_dim": make_emission_material("Room pedestal dim center ring", "#1492AD", strength=0.4, alpha=0.06),
            "slot_dim": make_emission_material("Room pedestal dim slots", "#063E52", strength=0.38, alpha=0.065),
            "slot_hot": make_emission_material("Room pedestal hot slots", "#1AA9C6", strength=0.78, alpha=0.1),
            "slot_soft": make_emission_material("Room pedestal soft slots", "#08738A", strength=0.5, alpha=0.075),
            "pool": make_emission_material("Room pedestal faint pool", "#0B6C82", strength=0.18, alpha=0.018),
            "pool_dim": make_emission_material("Room pedestal floor pool", "#021826", strength=0.12, alpha=0.01),
            "dot_dim": make_emission_material("Room globe dim micro lights", "#11A5C4", strength=0.95, alpha=0.18),
            "dot": make_emission_material("Room globe bright micro lights", "#2BDBF4", strength=1.55, alpha=0.31),
            "map_texture_dot": make_emission_material("Room globe map texture lights", "#1BC0DA", strength=1.3, alpha=0.26),
            "map_city_dot": make_emission_material("Room globe city light sparks", "#C6FFFF", strength=2.9, alpha=0.43),
            "hot_dot_halo": make_emission_material("Room globe luminous node halos", "#1EDAFF", strength=0.92, alpha=0.17),
            "hot_dot": make_emission_material("Room globe luminous node cores", "#E8FFFF", strength=3.0, alpha=0.5),
            "node_halo": make_emission_material("Room globe route node halos", "#1AC9E8", strength=0.7, alpha=0.13),
            "node_hot": make_emission_material("Room globe route node cores", "#CFFFFF", strength=2.3, alpha=0.36),
            "rim_hot": make_emission_material("Room globe glowing upper rim", "#C6FBFF", strength=2.35, alpha=0.32),
            "rim_line": make_emission_material("Room globe electric rim", "#7BEAFF", strength=1.8, alpha=0.28),
            "rim_line_dim": make_emission_material("Room globe dim electric rim", "#1BB0CE", strength=1.0, alpha=0.16),
        }
    )


def add_plane(
    name: str,
    *,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    return obj


def add_room_environment(materials: dict[str, bpy.types.Material]) -> None:
    add_plane(
        "Room_Full_Black_Glass_Floor",
        location=(0.0, 0.65, -0.03),
        rotation=(0.0, 0.0, 0.0),
        scale=(24.0, 18.0, 1.0),
        material=materials["floor"],
    )
    add_plane(
        "Room_Rear_Deep_Data_Wall",
        location=(0.0, 4.8, 2.55),
        rotation=(math.pi / 2, 0.0, 0.0),
        scale=(34.0, 18.0, 1.0),
        material=materials["back_wall"],
    )
    for index, (x, width, height, z, mat_key) in enumerate(
        [
            (0.0, 2.4, 3.8, 1.95, "wall_haze_hot"),
            (-1.75, 1.15, 3.1, 1.72, "wall_haze"),
            (1.72, 1.2, 3.25, 1.78, "wall_haze"),
            (-3.5, 0.72, 2.45, 1.45, "wall_haze"),
            (3.55, 0.72, 2.45, 1.45, "wall_haze"),
        ]
    ):
        add_plane(
            f"Room_Hidden_Rear_Blue_Haze_{index:02d}",
            location=(x, 2.84, z),
            rotation=(math.pi / 2, 0.0, 0.0),
            scale=(width, height, 1.0),
            material=materials[mat_key],
        )
    for index, (x, y, width, height, mat_key) in enumerate(
        [
            (0.0, -0.18, 2.35, 0.34, "floor_glow_hot"),
            (0.0, -0.78, 4.2, 0.22, "floor_glow"),
            (-3.6, -2.66, 4.8, 0.045, "floor_strip"),
            (3.6, -2.66, 4.8, 0.045, "floor_strip"),
            (-3.3, -2.32, 3.4, 0.035, "floor_strip_dim"),
            (3.3, -2.32, 3.4, 0.035, "floor_strip_dim"),
            (-4.5, -1.92, 2.8, 0.026, "floor_strip_dim"),
            (4.5, -1.92, 2.8, 0.026, "floor_strip_dim"),
        ]
    ):
        add_plane(
            f"Room_Hidden_Floor_Light_Plate_{index:02d}",
            location=(x, y, 0.012 + index * 0.0005),
            rotation=(0.0, 0.0, 0.0),
            scale=(width, height, 1.0),
            material=materials[mat_key],
        )

    floor_extent = 8.3
    for index in range(-18, 19):
        x = index * 0.34
        mat = materials["floor_grid_hot"] if index in {-2, -1, 0, 1, 2} else materials["floor_grid"]
        create_poly_curve(
            f"Room_Floor_Depth_Line_X_{index:+03d}",
            [Vector((x, -3.8, 0.004)), Vector((x * 0.34, 4.6, 0.004))],
            mat,
            bevel_depth=0.00105 if abs(index) > 2 else 0.0017,
        )
    for index in range(24):
        y = -3.15 + index * 0.32
        width = floor_extent * (1.0 - max(0.0, y) * 0.055)
        mat = materials["floor_grid_hot"] if 8 <= index <= 15 else materials["floor_grid"]
        create_poly_curve(
            f"Room_Floor_Cross_Line_{index:02d}",
            [Vector((-width, y, 0.006)), Vector((width, y, 0.006))],
            mat,
            bevel_depth=0.0011 if mat == materials["floor_grid"] else 0.0018,
        )

    for z in (0.34, 0.54, 0.82):
        create_poly_curve(
            f"Room_Back_Horizon_Strip_{z:.2f}",
            [Vector((-6.9, 2.92, z)), Vector((6.9, 2.92, z))],
            materials["horizon"],
            bevel_depth=0.0022 if z == 0.54 else 0.00135,
        )

    bottom_strip_specs = [
        (-3.1, 0.0022, "floor_strip_dim"),
        (-2.72, 0.003, "floor_strip"),
        (-2.34, 0.0018, "floor_strip_dim"),
        (-1.94, 0.0018, "floor_strip_dim"),
    ]
    for index, (y, bevel, material_key) in enumerate(bottom_strip_specs):
        create_poly_curve(
            f"Room_Foreground_Bottom_Light_Strip_{index:02d}",
            [Vector((-8.2, y, 0.018 + index * 0.001)), Vector((8.2, y, 0.018 + index * 0.001))],
            materials[material_key],
            bevel_depth=bevel,
        )

    for side, x0, x1 in [("L", -8.2, -2.1), ("R", 2.1, 8.2)]:
        for index in range(8):
            y = -2.95 + index * 0.18
            create_poly_curve(
                f"Room_Bottom_Angled_Accent_{side}_{index:02d}",
                [Vector((x0, y, 0.022)), Vector((x1, y + 0.48, 0.022))],
                materials["floor_strip_dim" if index % 3 else "floor_strip"],
                bevel_depth=0.0012 if index % 3 else 0.0018,
            )

    for index, x in enumerate([-3.6, -2.7, -1.85, -0.9, 0.0, 0.95, 1.9, 2.85, 3.72]):
        create_poly_curve(
            f"Room_Rear_Vertical_Data_Column_{index:02d}",
            [Vector((x, 2.88, 0.46)), Vector((x * 0.72, 2.88, 3.18))],
            materials["wall_column"],
            bevel_depth=0.0018 if index in {3, 4, 5} else 0.0012,
        )

    random.seed(90210)
    wall_points: list[tuple[Vector, float, float]] = []
    for _ in range(430):
        x = random.uniform(-4.15, 4.15)
        z = random.triangular(0.74, 3.2, 1.85)
        y = random.uniform(2.82, 2.9)
        if random.random() < 0.36 and -1.1 < x < 1.1:
            z += random.uniform(0.15, 0.7)
        wall_points.append((Vector((x, y, z)), random.uniform(0.0018, 0.0036), 1.0))
    make_dot_mesh("Room_Background_Distant_Data_Dust", wall_points, materials["wall_point"], parent=create_empty("Room_Background_Dust_Root", (0, 0, 0)))

    for ring_index, radius in enumerate([1.44, 1.85, 2.46, 3.12]):
        points = [
            Vector((math.cos(t) * radius, math.sin(t) * radius * 0.42 + 0.06, 0.012 + ring_index * 0.001))
            for t in [step / 220 * math.tau for step in range(221)]
        ]
        create_poly_curve(
            f"Room_Floor_Central_Ellipse_{ring_index:02d}",
            points,
            materials["floor_grid_hot" if ring_index < 2 else "floor_grid"],
            bevel_depth=0.0018 if ring_index < 2 else 0.0012,
        )


def add_room_lights() -> None:
    light_specs = [
        ("Room_Left_Top_Key", "AREA", (-3.9, -3.4, 3.35), "#BFDADD", 210, 3.1),
        ("Room_Right_Cyan_Rim", "AREA", (3.55, -2.95, 2.05), "#1AAEC9", 210, 2.2),
        ("Room_Back_Teal_Wash", "AREA", (0.0, 2.65, 2.15), "#064A62", 110, 4.8),
        ("Room_Floor_Soft_Return", "AREA", (0.0, -1.55, 0.54), "#07455B", 28, 3.2),
    ]
    for name, light_type, location, color, energy, size in light_specs:
        data = bpy.data.lights.new(name, light_type)
        data.color = rgba(color)[:3]
        data.energy = energy
        if light_type == "AREA":
            data.size = size
        if hasattr(data, "use_shadow"):
            data.use_shadow = False
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        bpy.context.scene.collection.objects.link(obj)
        look_at(obj, Vector((0.0, 0.0, GLOBE_CENTER_Z)))


def add_room_camera() -> None:
    data = bpy.data.cameras.new("Jarvis_Room_Background_Camera")
    data.type = "PERSP"
    data.lens = 27
    data.dof.use_dof = False
    camera = bpy.data.objects.new("Jarvis_Room_Background_Camera", data)
    camera.location = (0.0, -8.15, 1.72)
    bpy.context.scene.collection.objects.link(camera)
    look_at(camera, Vector((0.0, 0.12, 1.27)))
    bpy.context.scene.camera = camera


def main() -> None:
    config = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    reset_scene()
    configure_room_scene(config)

    globe_materials = build_materials()
    tune_room_globe_materials(globe_materials)
    room_materials = make_room_materials()

    add_room_environment(room_materials)
    build_base(globe_materials)
    globe_root = create_empty("Room_Globe_Rotation_Root", (0, 0, GLOBE_CENTER_Z))
    globe_root.rotation_euler = (math.radians(-8.0), 0.0, math.radians(-112.0))
    build_globe(globe_root, globe_materials)
    animate_rotation(globe_root, axis="Z", turns=1.0)

    for index, obj in enumerate(
        [item for item in bpy.context.scene.objects if item.name.startswith("Pedestal_") and "Ring" in item.name]
    ):
        animate_rotation(obj, axis="Z", turns=1.0 if index % 2 == 0 else -1.0)

    add_room_lights()
    add_room_camera()

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"BLEND_PATH={BLEND_PATH}")

    if config.render:
        render_path = OUTPUT_DIR / f"jarvis-room-background-clean-{config.output_tag}.png"
        bpy.context.scene.render.filepath = str(render_path)
        bpy.ops.render.render(write_still=True)
        print(f"RENDER_PATH={render_path}")


if __name__ == "__main__":
    main()
