import bpy
import json
import math
import os
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "hologram")
os.makedirs(OUT, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def material(name, base, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*base, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def bevel(obj, amount=0.04, segments=4):
    modifier = obj.modifiers.new("Precision Bevel", "BEVEL")
    modifier.width = amount
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def cylinder(name, radius, depth, z, mat, bevel_width=0.035, vertices=192):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    bevel(obj, bevel_width, 3)
    for polygon in obj.data.polygons:
        if abs(polygon.normal.z) < 0.72:
            polygon.use_smooth = True
    obj.data.materials.append(mat)
    return obj


def torus(name, major_radius, minor_radius, z, mat, major_segments=192, minor_segments=14):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=(0, 0, z),
    )
    obj = bpy.context.object
    obj.name = name
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.materials.append(mat)
    return obj


def arc_tube(name, radius, start_angle, end_angle, z, mat, thickness=0.006, points=44):
    curve_data = bpy.data.curves.new(name=f"{name}_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 1
    curve_data.bevel_depth = thickness
    curve_data.bevel_resolution = 1
    curve_data.resolution_u = 1
    spline = curve_data.splines.new("POLY")
    spline.points.add(points - 1)
    for index in range(points):
        progress = index / (points - 1)
        angle = start_angle + (end_angle - start_angle) * progress
        spline.points[index].co = (
            math.cos(angle) * radius,
            math.sin(angle) * radius,
            z,
            1.0,
        )
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def radial_segment(name, radius, width, length, angle, z, mat, height=0.018):
    x = math.cos(angle) * radius
    y = math.sin(angle) * radius
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z), scale=(length * 0.5, width * 0.5, height * 0.5))
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler.z = angle
    bevel(obj, min(width, height) * 0.22, 2)
    obj.data.materials.append(mat)
    return obj


def build_pedestal():
    dark = material("Jarvis Dark Metal", (0.002, 0.007, 0.012), metallic=0.72, roughness=0.48)
    dark_mid = material("Jarvis Mid Metal", (0.006, 0.022, 0.034), metallic=0.62, roughness=0.4)
    cyan = material(
        "Jarvis Cyan Emission",
        (0.0, 0.025, 0.04),
        metallic=0.18,
        roughness=0.16,
        emission=(0.0, 0.42, 0.64),
        strength=1.2,
    )
    ice = material(
        "Jarvis Ice Core",
        (0.18, 0.55, 0.68),
        metallic=0.0,
        roughness=0.1,
        emission=(0.65, 0.96, 1.0),
        strength=3.0,
    )

    objects = []
    objects.append(cylinder("Base_Lower", 1.28, 0.13, 0.065, dark, 0.022))
    objects.append(cylinder("Base_Mid", 1.17, 0.10, 0.145, dark_mid, 0.018))
    objects.append(cylinder("Base_Upper", 1.02, 0.075, 0.232, dark, 0.015))
    objects.append(cylinder("Energy_Basin", 0.78, 0.045, 0.302, dark_mid, 0.012))
    objects.append(cylinder("Core_Recess", 0.38, 0.027, 0.337, dark, 0.009))
    objects.append(cylinder("Core_Light", 0.068, 0.012, 0.36, ice, 0.004))

    for idx, radius in enumerate((0.24, 0.48, 0.73, 1.0)):
        z = 0.35 - idx * 0.003
        objects.append(torus(f"Recessed_Groove_{idx:02d}", radius, 0.006, z, dark_mid, 120, 8))

    objects.append(torus("Energy_Ring_Core", 0.24, 0.004, 0.357, cyan, 120, 8))
    for index, (radius, start, end) in enumerate((
        (0.48, 0.12, 1.38),
        (0.48, 3.25, 4.25),
        (0.73, 0.62, 2.12),
        (0.73, 4.02, 5.2),
        (1.0, -0.28, 0.58),
        (1.0, 2.72, 3.48),
    )):
        objects.append(
            arc_tube(
                f"Energy_Arc_{index:02d}",
                radius,
                start,
                end,
                0.358,
                cyan,
                0.0045,
            )
        )

    for idx in range(28):
        angle = idx * math.tau / 28
        long_tick = idx % 7 == 0
        radius = 1.09 if long_tick else 1.15
        length = 0.16 if long_tick else 0.08
        width = 0.011 if long_tick else 0.006
        objects.append(
            radial_segment(
                f"Outer_Tick_{idx:02d}",
                radius,
                width,
                length,
                angle,
                0.341,
                cyan,
                0.008,
            )
        )

    for idx in range(9):
        angle = idx * math.tau / 9 + (idx % 2) * 0.045
        radius = 0.81 + (idx % 3) * 0.07
        objects.append(
            radial_segment(
                f"Inner_Sector_{idx:02d}",
                radius,
                0.011,
                0.14 + (idx % 3) * 0.035,
                angle,
                0.348,
                cyan,
                0.007,
            )
        )

    material_groups = {}
    for obj in objects:
        if obj.data.materials:
            material_groups.setdefault(obj.data.materials[0].name, []).append(obj)

    joined = []
    for material_name in ("Jarvis Dark Metal", "Jarvis Mid Metal", "Jarvis Cyan Emission", "Jarvis Ice Core"):
        group = material_groups.get(material_name, [])
        if not group:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        group[0].name = material_name.replace(" ", "_")
        joined.append(group[0])

    for obj in joined:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = joined[0]
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "jarvis-pedestal.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )


def gaussian(value, center, width):
    d = (value - center) / width
    return math.exp(-0.5 * d * d)


def save_mask(name, width, height, pixel_fn):
    image = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=False)
    pixels = [0.0] * (width * height * 4)
    for y in range(height):
        v = y / (height - 1)
        latitude = (v - 0.5) * math.pi
        for x in range(width):
            u = x / (width - 1)
            longitude = u * math.tau
            value = max(0.0, min(1.0, pixel_fn(u, v, longitude, latitude)))
            index = (y * width + x) * 4
            pixels[index:index + 4] = (value, value, value, 1.0)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = os.path.join(OUT, f"{name}.png")
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def build_masks():
    def density(u, v, lon, lat):
        base = 0.18
        bands = (
            gaussian(lat, -0.72, 0.13) * 0.5
            + gaussian(lat, -0.42, 0.11) * 0.42
            + gaussian(lat, -0.12, 0.16) * 0.18
            + gaussian(lat, 0.43, 0.14) * 0.26
        )
        swirl = 0.5 + 0.5 * math.sin(lon * 4.0 + lat * 7.5 + math.sin(lon * 1.4) * 1.5)
        micro = 0.5 + 0.5 * math.sin(lon * 17.0 - lat * 11.0)
        exclusion = gaussian(lat, 0.04, 0.28) * gaussian(math.sin(lon - 3.0), 0.0, 0.34) * 0.28
        return base + bands * (0.54 + swirl * 0.46) + micro * 0.07 - exclusion

    hotspots = [
        (0.10, 0.28, 0.035, 0.75),
        (0.22, 0.35, 0.026, 0.92),
        (0.36, 0.42, 0.022, 0.78),
        (0.49, 0.31, 0.034, 0.9),
        (0.60, 0.38, 0.027, 0.82),
        (0.73, 0.46, 0.03, 0.88),
        (0.84, 0.34, 0.024, 0.96),
        (0.92, 0.58, 0.027, 0.84),
        (0.18, 0.67, 0.03, 0.72),
        (0.42, 0.72, 0.026, 0.88),
        (0.68, 0.69, 0.031, 0.7),
    ]

    def hotspot(u, v, lon, lat):
        total = 0.0
        for hu, hv, radius, strength in hotspots:
            du = min(abs(u - hu), 1.0 - abs(u - hu))
            dv = v - hv
            total += math.exp(-(du * du + dv * dv) / (2 * radius * radius)) * strength
        return total

    def rim_breakup(u, v, lon, lat):
        broad = 0.38 + 0.2 * math.sin(lon * 3.0 - lat * 2.0)
        detail = 0.22 * math.sin(lon * 13.0 + lat * 9.0) + 0.14 * math.sin(lon * 29.0 - lat * 15.0)
        top = gaussian(lat, 0.96, 0.36) * 0.38
        lower = gaussian(lat, -1.0, 0.3) * 0.28
        return broad + detail + top + lower

    save_mask("globe-density", 1024, 512, density)
    save_mask("globe-hotspots", 1024, 512, hotspot)
    save_mask("globe-rim-breakup", 1024, 512, rim_breakup)


def spherical_point(radius, longitude, latitude, tilt_x=0.0, tilt_z=0.0):
    point = Vector(
        (
            math.cos(latitude) * math.cos(longitude) * radius,
            math.sin(latitude) * radius,
            math.cos(latitude) * math.sin(longitude) * radius,
        )
    )
    point.rotate(Vector((1, 0, 0)), tilt_x) if False else None
    if tilt_x:
        cx, sx = math.cos(tilt_x), math.sin(tilt_x)
        point.y, point.z = point.y * cx - point.z * sx, point.y * sx + point.z * cx
    if tilt_z:
        cz, sz = math.cos(tilt_z), math.sin(tilt_z)
        point.x, point.y = point.x * cz - point.y * sz, point.x * sz + point.y * cz
    return [round(point.x, 6), round(point.y, 6), round(point.z, 6)]


def build_hero_curves():
    presets = [
        (-0.62, 5.35, 1.95, 0.13, 0.12, 0.26),
        (-0.49, 5.7, 1.7, 0.10, -0.08, -0.31),
        (-0.34, 5.95, 1.55, 0.085, 0.06, 0.20),
        (-0.18, 0.15, 1.92, 0.12, -0.05, -0.34),
        (-0.02, 0.42, 1.52, 0.08, 0.08, 0.28),
        (0.14, 0.72, 1.36, 0.07, -0.08, -0.24),
        (0.30, 0.92, 1.24, 0.06, 0.07, 0.19),
        (0.47, 1.15, 1.08, 0.055, -0.05, -0.16),
        (-0.52, 2.65, 1.28, 0.15, 0.16, 0.35),
        (-0.27, 2.9, 1.4, 0.13, -0.12, -0.28),
        (0.08, 3.25, 1.22, 0.095, 0.10, 0.22),
        (0.38, 3.55, 1.05, 0.07, -0.08, -0.18),
    ]
    for index in range(30):
        latitude = -0.72 + (index % 10) * 0.16 + math.sin(index * 1.73) * 0.035
        span = 1.12 + (index % 7) * 0.15
        center = math.pi * 0.5 + math.sin(index * 1.17) * 0.48
        start = center - span * 0.5
        wave = 0.09 + (index % 5) * 0.028
        tilt_x = math.sin(index * 0.83) * 0.07
        tilt_z = math.cos(index * 0.67) * 0.11
        presets.append((latitude, start, span, wave, tilt_x, tilt_z))

    curves = []
    for index, (lat, start, span, wave, tilt_x, tilt_z) in enumerate(presets):
        points = []
        for step in range(80):
            t = step / 79
            longitude = start + span * t
            local_lat = lat + math.sin(t * math.pi) * wave + math.sin(t * math.pi * 2 + index * 0.7) * wave * 0.58
            radius = 1.173 + math.sin(t * math.pi) * 0.018
            points.append(spherical_point(radius, longitude, local_lat, tilt_x, tilt_z))
        curves.append(
            {
                "id": f"hero-{index + 1:02d}",
                "tier": "hero" if index < 10 else "secondary",
                "width": round(
                    0.0125 - index * 0.00032
                    if index < 10
                    else 0.005 + (index % 4) * 0.00055,
                    5,
                ),
                "speed": round(0.028 + (index % 6) * 0.007, 4),
                "phase": round((index * 0.137) % 1.0, 4),
                "points": points,
                "nodes": (
                    [0.18, 0.76]
                    if index < 6
                    else [0.48]
                    if index < 10
                    else [0.36]
                    if index % 5 == 0
                    else []
                ),
            }
        )
    with open(os.path.join(OUT, "hero-curves.json"), "w", encoding="utf-8") as handle:
        json.dump({"version": 1, "curves": curves}, handle, separators=(",", ":"))


def save_blend():
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "jarvis-hologram-assets.blend"))


clear_scene()
build_pedestal()
build_hero_curves()
save_blend()
print(f"Built JARVIS hologram assets in {OUT}")
