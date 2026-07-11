import bpy
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "public", "hologram", "jarvis-pedestal.glb")

bpy.ops.object.select_all(action="DESELECT")
for object_ in bpy.data.objects:
    if object_.type == "MESH":
        object_.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
)

print(f"Exported legacy pedestal to {OUTPUT}")
