from __future__ import annotations

import math
import random
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_HOLOGRAM = ROOT / "public" / "hologram"
OUTPUT_DIR = ROOT / "design" / "generated" / "blender-globe-framework"
BLEND_PATH = OUTPUT_DIR / "jarvis-globe-framework-first-pass.blend"

FRAME_START = 1
FRAME_END = 240
GLOBE_RADIUS = 1.04
GLOBE_CENTER_Z = 1.64


@dataclass(frozen=True)
class RenderConfig:
    width: int = 3840
    height: int = 2160
    samples: int = 128
    output_tag: str = "4k"
    render: bool = True


def parse_args() -> RenderConfig:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    width = 3840
    height = 2160
    samples = 128
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

    return RenderConfig(
        width=width,
        height=height,
        samples=samples,
        output_tag=output_tag,
        render=render,
    )


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
        alpha,
    )


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for datablock in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.lights,
        bpy.data.cameras,
    ):
        for item in list(datablock):
            if item.users == 0:
                datablock.remove(item)


def configure_scene(config: RenderConfig) -> None:
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.frame_set(FRAME_START)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = config.samples
    scene.cycles.preview_samples = min(config.samples, 48)
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 4
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.volume_bounces = 1

    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"

    scene.render.resolution_x = config.width
    scene.render.resolution_y = config.height
    if hasattr(scene.render, "filter_size"):
        scene.render.filter_size = 0.65
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.compression = 8
    scene.world = bpy.data.worlds.new("JARVIS_Black_World")
    scene.world.color = (0.001, 0.004, 0.008)

    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "Medium High Contrast"
    except Exception:
        scene.view_settings.view_transform = "Filmic"
        scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.82
    scene.view_settings.gamma = 1.0

    scene.use_nodes = False
    try:
        scene.compositing_node_group = None
    except Exception:
        pass


def make_principled_material(
    name: str,
    base: str,
    *,
    metallic: float = 0.0,
    roughness: float = 0.35,
    emission: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = rgba(base)
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        for input_name in ("Specular IOR Level", "Specular", "Coat Weight", "Coat Roughness"):
            if input_name in bsdf.inputs:
                bsdf.inputs[input_name].default_value = 0.0
        if emission and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = rgba(emission)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def make_black_core_material(name: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    ramp = nodes.new("ShaderNodeValToRGB")
    bump = nodes.new("ShaderNodeBump")

    noise.inputs["Scale"].default_value = 148.0
    noise.inputs["Detail"].default_value = 16.0
    noise.inputs["Roughness"].default_value = 0.54
    ramp.color_ramp.elements[0].position = 0.05
    ramp.color_ramp.elements[0].color = rgba("#000000")
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba("#020303")
    bump.inputs["Strength"].default_value = 0.014
    bump.inputs["Distance"].default_value = 0.011

    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.72
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.12
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.0

    links = mat.node_tree.links
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat


def make_emission_material(
    name: str,
    color: str,
    *,
    strength: float = 1.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.use_screen_refraction = False
    try:
        mat.cycles.use_transparent_shadow = False
    except Exception:
        pass

    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rgba(color)
    emission.inputs["Strength"].default_value = strength
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    mat.node_tree.links.new(transparent.outputs["BSDF"], mix.inputs[1])
    mat.node_tree.links.new(emission.outputs["Emission"], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def make_fresnel_material(name: str, color: str, accent: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    try:
        mat.cycles.use_transparent_shadow = False
    except Exception:
        pass

    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    emission = nodes.new("ShaderNodeEmission")
    layer = nodes.new("ShaderNodeLayerWeight")
    ramp = nodes.new("ShaderNodeValToRGB")
    mix = nodes.new("ShaderNodeMixShader")
    color_mix = nodes.new("ShaderNodeValToRGB")

    layer.inputs["Blend"].default_value = 0.24
    ramp.color_ramp.elements[0].position = 0.08
    ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.985
    ramp.color_ramp.elements[1].color = (0.22, 0.22, 0.22, 1.0)
    color_mix.color_ramp.elements[0].position = 0.0
    color_mix.color_ramp.elements[0].color = rgba(accent)
    color_mix.color_ramp.elements[1].position = 0.86
    color_mix.color_ramp.elements[1].color = rgba(color)
    emission.inputs["Strength"].default_value = 1.45

    links = mat.node_tree.links
    links.new(layer.outputs["Facing"], ramp.inputs["Fac"])
    links.new(layer.outputs["Facing"], color_mix.inputs["Fac"])
    links.new(color_mix.outputs["Color"], emission.inputs["Color"])
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def make_texture_mask_emission_material(
    name: str,
    image_path: Path,
    color: str,
    *,
    strength: float,
    low: float,
    high: float,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    try:
        mat.cycles.use_transparent_shadow = False
    except Exception:
        pass

    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(image_path), check_existing=True)
    try:
        texture.image.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    grayscale = nodes.new("ShaderNodeRGBToBW")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = low
    ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = high
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rgba(color)
    emission.inputs["Strength"].default_value = strength
    mix = nodes.new("ShaderNodeMixShader")

    links = mat.node_tree.links
    links.new(texture.outputs["Color"], grayscale.inputs["Color"])
    links.new(grayscale.outputs["Val"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def make_channel_mask_emission_material(
    name: str,
    image_path: Path,
    color: str,
    *,
    channel: str,
    strength: float,
    low: float,
    high: float,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    try:
        mat.cycles.use_transparent_shadow = False
    except Exception:
        pass

    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(image_path), check_existing=True)
    try:
        texture.image.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    separate = nodes.new("ShaderNodeSeparateColor")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = low
    ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = high
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = rgba(color)
    emission.inputs["Strength"].default_value = strength
    mix = nodes.new("ShaderNodeMixShader")

    output_index = {"r": 0, "g": 1, "b": 2}[channel.lower()]
    links = mat.node_tree.links
    links.new(texture.outputs["Color"], separate.inputs[0])
    links.new(separate.outputs[output_index], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def make_image_emission_card_material(
    name: str,
    image_path: Path,
    *,
    strength: float,
    low: float = 0.025,
    high: float = 0.34,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    try:
        mat.cycles.use_transparent_shadow = False
    except Exception:
        pass

    nodes = mat.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(image_path), check_existing=True)
    grayscale = nodes.new("ShaderNodeRGBToBW")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = low
    ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = high
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = strength
    mix = nodes.new("ShaderNodeMixShader")

    links = mat.node_tree.links
    links.new(texture.outputs["Color"], emission.inputs["Color"])
    links.new(texture.outputs["Color"], grayscale.inputs["Color"])
    links.new(grayscale.outputs["Val"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def shade_smooth(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth()
    finally:
        obj.select_set(False)


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    z: float,
    material: bpy.types.Material,
    *,
    vertices: int = 192,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=(0.0, 0.0, z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(material)
    shade_smooth(obj)
    if bevel:
        modifier = obj.modifiers.new(f"{name}_Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 5
        modifier.affect = "EDGES"
        obj.modifiers.new(f"{name}_WeightedNormals", "WEIGHTED_NORMAL")
    return obj


def add_torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    z: float,
    material: bpy.types.Material,
    *,
    segments: int = 192,
    minor_segments: int = 12,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_segments=segments,
        minor_segments=minor_segments,
        location=(0.0, 0.0, z),
        major_radius=major_radius,
        minor_radius=minor_radius,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    shade_smooth(obj)
    return obj


def add_uv_sphere(
    name: str,
    radius: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    segments: int = 160,
    rings: int = 96,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    shade_smooth(obj)
    return obj


def add_billboard_plane(
    name: str,
    material: bpy.types.Material,
    *,
    location: tuple[float, float, float],
    width: float,
    height: float,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(
        size=1,
        location=location,
        rotation=(math.pi / 2, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.scale = (width, height, 1)
    obj.data.materials.append(material)
    return obj


def create_empty(name: str, location: tuple[float, float, float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.22
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


class ImageSampler:
    def __init__(self, path: Path, channel: int = 0) -> None:
        self.image = bpy.data.images.load(str(path))
        self.width, self.height = self.image.size
        self.channel = channel
        self.pixels = tuple(self.image.pixels[:])

    def sample(self, u: float, v: float) -> float:
        x = int((u % 1.0) * (self.width - 1))
        y = int(max(0.0, min(1.0, v)) * (self.height - 1))
        offset = (y * self.width + x) * 4 + self.channel
        return self.pixels[offset]


def sphere_position(latitude: float, longitude: float, radius: float) -> Vector:
    return Vector(
        (
            math.cos(latitude) * math.cos(longitude) * radius,
            math.cos(latitude) * math.sin(longitude) * radius,
            math.sin(latitude) * radius,
        )
    )


def seeded_random_points(
    count: int,
    *,
    radius: float,
    density: ImageSampler,
    hotspot: ImageSampler,
    seed: int,
    shell_jitter: float = 0.012,
) -> list[tuple[Vector, float, float]]:
    random.seed(seed)
    points: list[tuple[Vector, float, float]] = []
    attempts = 0
    while len(points) < count and attempts < count * 50:
        attempts += 1
        zone = random.random()
        if zone < 0.17:
            latitude = random.gauss(-0.38, 0.12)
        elif zone < 0.32:
            latitude = random.gauss(0.34, 0.14)
        elif zone < 0.43:
            latitude = random.gauss(0.0, 0.1)
        else:
            latitude = math.asin(2.0 * random.random() - 1.0)
        latitude = max(-math.pi / 2, min(math.pi / 2, latitude))
        longitude = random.random() * math.tau
        u = longitude / math.tau
        v = latitude / math.pi + 0.5
        density_value = density.sample(u, v)
        hot_value = hotspot.sample(u, v)
        keep = min(0.96, 0.11 + density_value * 0.78 + hot_value * 0.55)
        if random.random() > keep:
            continue
        point_radius = radius + random.uniform(-shell_jitter, shell_jitter)
        pos = sphere_position(latitude, longitude, point_radius)
        size = 0.00145 + random.random() * 0.00165 + hot_value * 0.0014
        brightness = 0.45 + density_value * 0.6 + hot_value * 1.55
        points.append((pos, size, brightness))
    return points


def seeded_mask_points(
    count: int,
    *,
    radius: float,
    masks: list[tuple[ImageSampler, float]],
    seed: int,
    threshold: float,
    gain: float,
    min_size: float,
    max_size: float,
) -> list[tuple[Vector, float, float]]:
    random.seed(seed)
    points: list[tuple[Vector, float, float]] = []
    attempts = 0
    while len(points) < count and attempts < count * 80:
        attempts += 1
        latitude = math.asin(2.0 * random.random() - 1.0)
        longitude = random.random() * math.tau
        u = longitude / math.tau
        v = latitude / math.pi + 0.5
        importance = sum(mask.sample(u, v) * weight for mask, weight in masks)
        keep = max(0.0, min(0.92, (importance - threshold) * gain))
        if random.random() > keep:
            continue
        pos = sphere_position(latitude, longitude, radius + random.uniform(-0.003, 0.003))
        size = min_size + random.random() * (max_size - min_size)
        brightness = 0.35 + min(2.2, importance)
        points.append((pos, size, brightness))
    return points


def ico_base() -> tuple[list[Vector], list[tuple[int, int, int]]]:
    phi = (1.0 + math.sqrt(5.0)) / 2.0
    verts = [
        Vector((-1, phi, 0)),
        Vector((1, phi, 0)),
        Vector((-1, -phi, 0)),
        Vector((1, -phi, 0)),
        Vector((0, -1, phi)),
        Vector((0, 1, phi)),
        Vector((0, -1, -phi)),
        Vector((0, 1, -phi)),
        Vector((phi, 0, -1)),
        Vector((phi, 0, 1)),
        Vector((-phi, 0, -1)),
        Vector((-phi, 0, 1)),
    ]
    verts = [v.normalized() for v in verts]
    faces = [
        (0, 11, 5),
        (0, 5, 1),
        (0, 1, 7),
        (0, 7, 10),
        (0, 10, 11),
        (1, 5, 9),
        (5, 11, 4),
        (11, 10, 2),
        (10, 7, 6),
        (7, 1, 8),
        (3, 9, 4),
        (3, 4, 2),
        (3, 2, 6),
        (3, 6, 8),
        (3, 8, 9),
        (4, 9, 5),
        (2, 4, 11),
        (6, 2, 10),
        (8, 6, 7),
        (9, 8, 1),
    ]
    return verts, faces


def make_dot_mesh(
    name: str,
    points: list[tuple[Vector, float, float]],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    base_verts, base_faces = ico_base()
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for point, size, _brightness in points:
        start = len(vertices)
        for vert in base_verts:
            v = point + vert * size
            vertices.append((v.x, v.y, v.z))
        for face in base_faces:
            faces.append((start + face[0], start + face[1], start + face[2]))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def create_poly_curve(
    name: str,
    points: list[Vector],
    material: bpy.types.Material,
    *,
    bevel_depth: float,
    parent: bpy.types.Object | None = None,
    cyclic: bool = False,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 16
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 4
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (co.x, co.y, co.z, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def slerp(a: Vector, b: Vector, t: float) -> Vector:
    dot = max(-1.0, min(1.0, a.dot(b)))
    omega = math.acos(dot)
    if abs(omega) < 1e-5:
        return a.lerp(b, t).normalized()
    return (
        math.sin((1.0 - t) * omega) / math.sin(omega) * a
        + math.sin(t * omega) / math.sin(omega) * b
    ).normalized()


def create_arc(
    name: str,
    start_lat: float,
    start_lon: float,
    end_lat: float,
    end_lon: float,
    material: bpy.types.Material,
    *,
    radius: float,
    parent: bpy.types.Object,
    lift: float = 0.055,
    bevel_depth: float = 0.0028,
) -> bpy.types.Object:
    start = sphere_position(math.radians(start_lat), math.radians(start_lon), 1.0)
    end = sphere_position(math.radians(end_lat), math.radians(end_lon), 1.0)
    points: list[Vector] = []
    for index in range(42):
        t = index / 41
        normal = slerp(start, end, t)
        arc_lift = math.sin(t * math.pi) * lift
        points.append(normal * (radius + arc_lift))
    return create_poly_curve(
        name,
        points,
        material,
        bevel_depth=bevel_depth,
        parent=parent,
    )


def create_surface_stroke(
    name: str,
    latitude: float,
    longitude: float,
    length: float,
    bend: float,
    material: bpy.types.Material,
    *,
    radius: float,
    parent: bpy.types.Object,
    bevel_depth: float,
    steps: int = 11,
) -> bpy.types.Object:
    points: list[Vector] = []
    for step in range(steps):
        t = step / (steps - 1)
        lat = latitude + math.sin(t * math.pi) * bend + (t - 0.5) * bend * 0.18
        lon = longitude + (t - 0.5) * length
        points.append(sphere_position(math.radians(lat), math.radians(lon), radius))
    return create_poly_curve(
        name,
        points,
        material,
        bevel_depth=bevel_depth,
        parent=parent,
    )


def create_reference_texture_strokes(
    root: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    random.seed(33017)
    for index in range(76):
        band = random.random()
        if band < 0.28:
            latitude = random.gauss(-22, 10)
        elif band < 0.58:
            latitude = random.gauss(11, 12)
        else:
            latitude = random.uniform(-55, 58)
        longitude = random.uniform(-180, 180)
        length = random.uniform(10, 42)
        bend = random.uniform(-5.5, 5.5)
        material = materials["trail_dim"] if index % 4 else materials["trail"]
        create_surface_stroke(
            f"Globe_Broken_Texture_Stroke_{index:03d}",
            latitude,
            longitude,
            length,
            bend,
            material,
            radius=GLOBE_RADIUS * (1.016 + random.random() * 0.006),
            parent=root,
            bevel_depth=0.00105 if index % 4 else 0.00175,
            steps=random.randint(7, 15),
        )


def create_broken_silhouette_rim(
    root: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    segments = [
        (92, 188, 0.00325, "rim_hot"),
        (188, 238, 0.00215, "rim_line"),
        (242, 315, 0.00205, "rim_line"),
        (318, 356, 0.00155, "rim_line_dim"),
        (4, 76, 0.00165, "rim_line_dim"),
        (80, 92, 0.0012, "rim_line_dim"),
    ]
    for index, (start_deg, end_deg, bevel, material_key) in enumerate(segments):
        points: list[Vector] = []
        steps = 34
        for step in range(steps):
            t = step / (steps - 1)
            angle = math.radians(start_deg + (end_deg - start_deg) * t)
            radius = GLOBE_RADIUS * (1.012 + 0.004 * math.sin(t * math.pi))
            points.append(Vector((math.cos(angle) * radius, -0.018, math.sin(angle) * radius)))
        create_poly_curve(
            f"Globe_Broken_Silhouette_Rim_{index:02d}",
            points,
            materials[material_key],
            bevel_depth=bevel,
            parent=root,
        )


def create_constellation_routes(
    root: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    nodes = [
        (34, -124, 0.0065),
        (18, -100, 0.0056),
        (-6, -82, 0.0072),
        (-24, -55, 0.0062),
        (42, -34, 0.0054),
        (26, 12, 0.0060),
        (7, 42, 0.0057),
        (-17, 73, 0.0061),
        (31, 115, 0.0057),
        (4, 148, 0.0069),
        (-32, 132, 0.0057),
        (50, 158, 0.0053),
    ]
    hot_points = [
        (sphere_position(math.radians(lat), math.radians(lon), GLOBE_RADIUS * 1.026), size, 1.0)
        for lat, lon, size in nodes
    ]
    halo_points = [(point, size * 2.1, brightness) for point, size, brightness in hot_points]
    make_dot_mesh("Globe_Constellation_Node_Halos", halo_points, materials["node_halo"], parent=root)
    make_dot_mesh("Globe_Constellation_Hot_Nodes", hot_points, materials["node_hot"], parent=root)

    routes = [
        (0, 1, 0.026, "arc_hot"),
        (1, 2, 0.034, "arc_hot"),
        (2, 3, 0.024, "arc"),
        (4, 5, 0.025, "arc"),
        (5, 6, 0.031, "arc_hot"),
        (6, 7, 0.023, "arc"),
        (8, 9, 0.027, "arc_hot"),
        (9, 10, 0.025, "arc"),
        (8, 11, 0.024, "arc"),
    ]
    for index, (start, end, lift, material_key) in enumerate(routes):
        a_lat, a_lon, _ = nodes[start]
        b_lat, b_lon, _ = nodes[end]
        create_arc(
            f"Globe_Constellation_Route_{index:02d}",
            a_lat,
            a_lon,
            b_lat,
            b_lon,
            materials[material_key],
            radius=GLOBE_RADIUS * 1.024,
            parent=root,
            lift=lift,
            bevel_depth=0.00205 if material_key == "arc_hot" else 0.00165,
        )


def build_globe(root: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> None:
    density = ImageSampler(PUBLIC_HOLOGRAM / "globe-density.png", channel=0)
    hotspot = ImageSampler(PUBLIC_HOLOGRAM / "globe-hotspots.png", channel=0)
    country_land = ImageSampler(PUBLIC_HOLOGRAM / "globe-country-map.png", channel=0)
    country_border = ImageSampler(PUBLIC_HOLOGRAM / "globe-country-map.png", channel=1)
    country_coast = ImageSampler(PUBLIC_HOLOGRAM / "globe-country-map.png", channel=2)
    city_ordinary = ImageSampler(PUBLIC_HOLOGRAM / "globe-city-emission.png", channel=0)
    city_major = ImageSampler(PUBLIC_HOLOGRAM / "globe-city-emission.png", channel=1)
    city_special = ImageSampler(PUBLIC_HOLOGRAM / "globe-city-emission.png", channel=2)

    dark = add_uv_sphere(
        "Globe_Dark_Volume",
        GLOBE_RADIUS * 0.982,
        (0, 0, 0),
        materials["globe_dark"],
        segments=192,
        rings=112,
        parent=root,
    )
    dark.show_transparent = True

    border_shell = add_uv_sphere(
        "Globe_Actual_Border_Texture_Shell",
        GLOBE_RADIUS * 1.004,
        (0, 0, 0),
        materials["country_border_overlay"],
        segments=192,
        rings=112,
        parent=root,
    )
    border_shell.show_transparent = True

    coast_shell = add_uv_sphere(
        "Globe_Actual_Coast_Texture_Shell",
        GLOBE_RADIUS * 1.006,
        (0, 0, 0),
        materials["country_coast_overlay"],
        segments=192,
        rings=112,
        parent=root,
    )
    coast_shell.show_transparent = True

    surface_points = seeded_random_points(
        14200,
        radius=GLOBE_RADIUS * 1.006,
        density=density,
        hotspot=hotspot,
        seed=1729,
        shell_jitter=0.012,
    )
    surface_points_by_brightness = sorted(surface_points, key=lambda item: item[2], reverse=True)
    make_dot_mesh("Globe_Surface_Dot_Field_Dim", surface_points, materials["dot_dim"], parent=root)
    make_dot_mesh(
        "Globe_Surface_Dot_Field_Bright",
        surface_points_by_brightness[:3600],
        materials["dot"],
        parent=root,
    )

    country_points = seeded_mask_points(
        3200,
        radius=GLOBE_RADIUS * 1.014,
        masks=[
            (country_land, 0.16),
            (country_border, 0.95),
            (country_coast, 0.7),
        ],
        seed=2601,
        threshold=0.12,
        gain=0.72,
        min_size=0.00135,
        max_size=0.0026,
    )
    make_dot_mesh("Globe_Texture_Country_Coast_Detail", country_points, materials["map_texture_dot"], parent=root)

    city_points = seeded_mask_points(
        1450,
        radius=GLOBE_RADIUS * 1.018,
        masks=[
            (city_ordinary, 0.62),
            (city_major, 1.2),
            (city_special, 2.0),
        ],
        seed=421337,
        threshold=0.035,
        gain=1.15,
        min_size=0.00165,
        max_size=0.0031,
    )
    make_dot_mesh("Globe_Texture_City_Hotspot_Detail", city_points, materials["map_city_dot"], parent=root)

    random.seed(9017)
    inner_points: list[tuple[Vector, float, float]] = []
    for _ in range(900):
        latitude = math.asin(2.0 * random.random() - 1.0)
        longitude = random.random() * math.tau
        radius = GLOBE_RADIUS * (0.18 + random.random() ** 0.55 * 0.73)
        pos = sphere_position(latitude, longitude, radius)
        size = 0.0017 + random.random() * 0.002
        inner_points.append((pos, size, 0.2))
    make_dot_mesh("Globe_Inner_Depth_Dust", inner_points, materials["inner_dot"], parent=root)

    hotspot_points = surface_points_by_brightness[:118]
    hotspot_points = [
        (point.normalized() * (GLOBE_RADIUS * 1.021), size * 1.35, brightness)
        for point, size, brightness in hotspot_points
    ]
    hotspot_halos = [(point, size * 4.2, brightness) for point, size, brightness in hotspot_points]
    make_dot_mesh("Globe_Bright_Node_Glow_Halos", hotspot_halos, materials["hot_dot_halo"], parent=root)
    make_dot_mesh("Globe_Bright_Node_Sparks", hotspot_points, materials["hot_dot"], parent=root)

    create_reference_texture_strokes(root, materials)
    create_constellation_routes(root, materials)
    create_broken_silhouette_rim(root, materials)

    for latitude in [-52, -31, -13, 0, 16, 34, 55]:
        points = [
            sphere_position(math.radians(latitude), step / 160 * math.tau, GLOBE_RADIUS * 1.012)
            for step in range(160)
        ]
        create_poly_curve(
            f"Globe_Faint_Latitude_{latitude:+d}",
            points,
            materials["grid"],
            bevel_depth=0.0017,
            parent=root,
            cyclic=True,
        )

    for longitude in range(0, 180, 30):
        points = [
            sphere_position(
                -math.pi / 2 + step / 144 * math.pi,
                math.radians(longitude),
                GLOBE_RADIUS * 1.013,
            )
            for step in range(145)
        ]
        create_poly_curve(
            f"Globe_Faint_Meridian_{longitude:03d}",
            points,
            materials["grid"],
            bevel_depth=0.00135,
            parent=root,
        )

    for index, (a_lat, a_lon, b_lat, b_lon) in enumerate(
        [
            (24, -122, 37, -88),
            (41, -73, 50, -8),
            (35, 139, 22, 114),
            (-23, -46, -6, -78),
            (52, 13, 33, 45),
        ],
        start=1,
    ):
        create_arc(
            f"Globe_Subtle_Data_Arc_{index:02d}",
            a_lat,
            a_lon,
            b_lat,
            b_lon,
            materials["arc"],
            radius=GLOBE_RADIUS * 1.02,
            parent=root,
            lift=0.018,
        )


def build_base(materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    ring_root = create_empty("Pedestal_Ring_Animation_Root", (0, 0, 0))
    add_cylinder("Pedestal_Lower_Black_Glass_Disc", 1.48, 0.105, 0.055, materials["pedestal_dark"], bevel=0.022)
    add_cylinder("Pedestal_Metallic_Mid_Disc", 1.32, 0.095, 0.146, materials["pedestal_mid"], bevel=0.02)
    add_cylinder("Pedestal_Upper_Stepped_Disc", 1.08, 0.07, 0.224, materials["pedestal_upper"], bevel=0.016)
    add_cylinder("Pedestal_Central_Lens_Collar", 0.82, 0.045, 0.282, materials["pedestal_collar"], bevel=0.014)
    add_cylinder("Pedestal_Core_Dark_Recess", 0.58, 0.012, 0.314, materials["pedestal_recess"], vertices=160, bevel=0.004)

    animated_rings: list[bpy.types.Object] = []
    ring_specs = [
        ("Pedestal_Outer_Bright_Rim", 1.50, 0.010, 0.333, "ring_soft"),
        ("Pedestal_Outer_Thin_Cyan_Line", 1.27, 0.0045, 0.348, "ring"),
        ("Pedestal_Data_Ring_A", 0.99, 0.004, 0.366, "ring"),
        ("Pedestal_Data_Ring_B", 0.73, 0.0038, 0.383, "ring_hot"),
        ("Pedestal_Inner_Lens_Ring", 0.42, 0.0038, 0.392, "ring_hot"),
        ("Pedestal_Center_Dim_Rim", 0.22, 0.0026, 0.397, "ring_center_dim"),
    ]
    for name, major, minor, z, mat_key in ring_specs:
        ring = add_torus(name, major, minor, z, materials[mat_key], parent=ring_root)
        animated_rings.append(ring)

    tick_materials = [materials["slot_dim"], materials["slot_hot"], materials["slot_soft"]]
    for index in range(48):
        angle = index / 48 * math.tau
        radius = 1.345 if index % 2 else 1.405
        length = 0.12 if index % 8 == 0 else 0.066
        width = 0.012
        depth = 0.018
        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(math.cos(angle) * radius, math.sin(angle) * radius, 0.205 + (index % 3) * 0.018),
            rotation=(0, 0, angle),
        )
        tick = bpy.context.object
        tick.name = f"Pedestal_Side_Emission_Slot_{index:02d}"
        tick.scale = (length, width, depth)
        tick.data.materials.append(tick_materials[index % len(tick_materials)])

    for radius, z, material, depth in [
        (0.98, 0.334, materials["pool"], 0.0016),
        (1.62, 0.052, materials["pool_dim"], 0.0016),
    ]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=192, radius=radius, depth=depth, location=(0, 0, z))
        glow = bpy.context.object
        glow.name = f"Pedestal_Flat_Glow_Disc_{radius:.2f}"
        glow.data.materials.append(material)

    return animated_rings


def animate_rotation(obj: bpy.types.Object, axis: str = "Z", turns: float = 1.0) -> None:
    axis_index = {"X": 0, "Y": 1, "Z": 2}[axis]
    obj.rotation_euler[axis_index] = 0.0
    obj.keyframe_insert(data_path="rotation_euler", frame=FRAME_START)
    obj.rotation_euler[axis_index] = math.tau * turns
    obj.keyframe_insert(data_path="rotation_euler", frame=FRAME_END)
    action = obj.animation_data.action if obj.animation_data else None
    fcurves = getattr(action, "fcurves", None)
    if fcurves:
        for fcurve in fcurves:
            for key in fcurve.keyframe_points:
                key.interpolation = "LINEAR"
            fcurve.modifiers.new(type="CYCLES")


def add_lights() -> None:
    world = bpy.context.scene.world
    if world:
        world.color = (0.0006, 0.0011, 0.0018)

    light_specs = [
        ("Left_White_Side_Key", "AREA", (-3.6, -2.9, 2.15), "#CFE5E7", 420, 2.35),
        ("Right_Cyan_Side_Rim", "AREA", (3.45, -2.35, 1.85), "#38C9DF", 310, 1.85),
        ("Back_Teal_Edge", "AREA", (0.35, 2.7, 2.1), "#0A5B73", 210, 3.3),
        ("Top_Soft_Catch", "AREA", (-0.75, -2.2, 3.3), "#EAF9FA", 110, 1.3),
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
        if light_type == "AREA":
            look_at(obj, Vector((0.0, 0.0, GLOBE_CENTER_Z)))


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera() -> None:
    data = bpy.data.cameras.new("Jarvis_Globe_Framework_Camera")
    data.type = "ORTHO"
    data.ortho_scale = 5.55
    data.dof.use_dof = False
    data.dof.focus_distance = 5.0
    data.dof.aperture_fstop = 64.0
    camera = bpy.data.objects.new("Jarvis_Globe_Framework_Camera", data)
    camera.location = (0.0, -5.35, 1.55)
    bpy.context.scene.collection.objects.link(camera)
    look_at(camera, Vector((0.0, 0.0, 1.44)))
    bpy.context.scene.camera = camera


def add_floor_reflection(materials: dict[str, bpy.types.Material]) -> None:
    bpy.ops.mesh.primitive_plane_add(
        size=7.4,
        location=(0, 2.55, 1.45),
        rotation=(math.pi / 2, 0, 0),
    )
    backdrop = bpy.context.object
    backdrop.name = "Minimal_Deep_Blue_Backdrop"
    backdrop.data.materials.append(materials["backdrop"])

    bpy.ops.mesh.primitive_plane_add(size=7.2, location=(0, 0.15, -0.01))
    floor = bpy.context.object
    floor.name = "Minimal_Dark_Reflection_Floor"
    floor.data.materials.append(materials["floor"])

    grid_mat = materials["floor_grid"]
    extent = 3.0
    for i in range(-11, 12):
        offset = i * 0.25
        create_poly_curve(
            f"Floor_Faint_Grid_X_{i:+03d}",
            [Vector((-extent, offset, 0.006)), Vector((extent, offset, 0.006))],
            grid_mat,
            bevel_depth=0.0009,
        )
        create_poly_curve(
            f"Floor_Faint_Grid_Y_{i:+03d}",
            [Vector((offset, -extent, 0.006)), Vector((offset, extent, 0.006))],
            grid_mat,
            bevel_depth=0.0009,
        )


def build_materials() -> dict[str, bpy.types.Material]:
    return {
        "pedestal_dark": make_principled_material(
            "Pedestal almost-black brushed metal",
            "#01060A",
            metallic=0.94,
            roughness=0.28,
            emission="#000E18",
            emission_strength=0.018,
        ),
        "pedestal_mid": make_principled_material(
            "Pedestal deep blue graphite",
            "#03101A",
            metallic=0.9,
            roughness=0.33,
            emission="#001D2E",
            emission_strength=0.026,
        ),
        "pedestal_upper": make_principled_material(
            "Pedestal upper cyan catch",
            "#041827",
            metallic=0.82,
            roughness=0.34,
            emission="#002F47",
            emission_strength=0.034,
        ),
        "pedestal_collar": make_principled_material(
            "Pedestal raised lens collar",
            "#062134",
            metallic=0.72,
            roughness=0.32,
            emission="#00435E",
            emission_strength=0.048,
        ),
        "pedestal_recess": make_principled_material(
            "Pedestal dark recessed center",
            "#071B2A",
            metallic=0.0,
            roughness=0.78,
            emission="#003451",
            emission_strength=0.025,
        ),
        "ring": make_emission_material("Pedestal cyan ring material", "#22BDF2", strength=1.48, alpha=0.18),
        "ring_soft": make_emission_material("Pedestal soft outer rim", "#0A6397", strength=0.96, alpha=0.13),
        "ring_hot": make_emission_material("Pedestal hot cyan ring", "#35C6EC", strength=1.42, alpha=0.18),
        "ring_center_dim": make_emission_material("Pedestal dim center ring", "#22A5D4", strength=0.68, alpha=0.1),
        "slot_dim": make_emission_material("Pedestal dim side slots", "#09466E", strength=0.78, alpha=0.11),
        "slot_hot": make_emission_material("Pedestal hot side slots", "#36C6EC", strength=1.5, alpha=0.18),
        "slot_soft": make_emission_material("Pedestal soft side slots", "#1285B9", strength=1.12, alpha=0.16),
        "pool": make_emission_material("Pedestal soft pool glow", "#119AC8", strength=0.46, alpha=0.04),
        "pool_dim": make_emission_material("Pedestal dim floor pool", "#032844", strength=0.28, alpha=0.018),
        "globe_dark": make_black_core_material("Globe black reference core"),
        "rim": make_fresnel_material("Globe cyan fresnel atmosphere", "#079CFF", "#E2FBFF"),
        "country_border_overlay": make_channel_mask_emission_material(
            "Globe actual border texture overlay",
            PUBLIC_HOLOGRAM / "globe-country-map.png",
            "#0B6E80",
            channel="g",
            strength=0.3,
            low=0.18,
            high=0.62,
        ),
        "country_coast_overlay": make_channel_mask_emission_material(
            "Globe actual coast texture overlay",
            PUBLIC_HOLOGRAM / "globe-country-map.png",
            "#0F8496",
            channel="b",
            strength=0.36,
            low=0.16,
            high=0.58,
        ),
        "dot_dim": make_emission_material("Globe surface dim micro dots", "#0F89AA", strength=0.72, alpha=0.14),
        "dot": make_emission_material("Globe surface bright micro dots", "#22BBD8", strength=1.22, alpha=0.25),
        "map_texture_dot": make_emission_material("Globe map texture cyan particles", "#17A5C6", strength=1.02, alpha=0.21),
        "map_city_dot": make_emission_material("Globe map city texture sparks", "#8AE8F2", strength=2.05, alpha=0.31),
        "inner_dot": make_emission_material("Globe inner depth dust", "#062A3A", strength=0.08, alpha=0.018),
        "hot_dot_halo": make_emission_material("Globe bright node glow halos", "#14BBD4", strength=0.42, alpha=0.08),
        "hot_dot": make_emission_material("Globe bright node sparks", "#A9F3F8", strength=2.05, alpha=0.36),
        "node_hot": make_emission_material("Globe large constellation nodes", "#A8F1F5", strength=1.55, alpha=0.26),
        "node_halo": make_emission_material("Globe soft constellation node halo", "#149AB4", strength=0.36, alpha=0.06),
        "grid": make_emission_material("Globe ultra faint latitude grid", "#0C7C96", strength=0.15, alpha=0.018),
        "arc": make_emission_material("Globe thin orbital data arcs", "#54CAD9", strength=0.6, alpha=0.1),
        "arc_hot": make_emission_material("Globe hot connected data arcs", "#8DEAF2", strength=0.72, alpha=0.11),
        "trail": make_emission_material("Globe broken hologram strokes", "#55CADB", strength=0.72, alpha=0.11),
        "trail_dim": make_emission_material("Globe dim broken hologram strokes", "#118BA8", strength=0.42, alpha=0.07),
        "rim_hot": make_emission_material("Globe brightest electric rim", "#81E6EE", strength=1.55, alpha=0.22),
        "rim_line": make_emission_material("Globe broken electric rim", "#5DD6E2", strength=1.28, alpha=0.21),
        "rim_line_dim": make_emission_material("Globe dim broken electric rim", "#1390AA", strength=0.72, alpha=0.11),
        "floor": make_principled_material(
            "Minimal black glossy floor",
            "#00050A",
            metallic=0.0,
            roughness=0.18,
            emission="#00192B",
            emission_strength=0.01,
        ),
        "backdrop": make_principled_material(
            "Minimal deep blue-black backdrop",
            "#00050A",
            metallic=0.0,
            roughness=0.92,
            emission="#000B14",
            emission_strength=0.018,
        ),
        "floor_grid": make_emission_material("Faint floor perspective grid", "#0D79B4", strength=0.8, alpha=0.08),
    }


def main() -> None:
    config = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    reset_scene()
    configure_scene(config)
    materials = build_materials()

    build_base(materials)
    globe_root = create_empty("Globe_Rotation_Root", (0, 0, GLOBE_CENTER_Z))
    globe_root.rotation_euler = (math.radians(-8.0), 0.0, math.radians(-112.0))
    build_globe(globe_root, materials)
    animate_rotation(globe_root, axis="Z", turns=1.0)

    for index, obj in enumerate(
        [item for item in bpy.context.scene.objects if item.name.startswith("Pedestal_") and "Ring" in item.name]
    ):
        animate_rotation(obj, axis="Z", turns=1.0 if index % 2 == 0 else -1.0)

    add_floor_reflection(materials)
    add_lights()
    add_camera()

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    if config.render:
        render_path = OUTPUT_DIR / f"jarvis-globe-framework-first-pass-{config.output_tag}.png"
        bpy.context.scene.render.filepath = str(render_path)
        bpy.ops.render.render(write_still=True)
        print(f"RENDER_PATH={render_path}")
    print(f"BLEND_PATH={BLEND_PATH}")


if __name__ == "__main__":
    main()
