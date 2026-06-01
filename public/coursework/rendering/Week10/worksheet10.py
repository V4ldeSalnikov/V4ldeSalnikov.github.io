import bpy
import sys
import math
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HDRI = ROOT / "luxo_pxr_campus.exr"
BUNNY = ROOT / "Week5" / "bunny.obj"
OUT = HERE / "renders"

GROUND_Z = 0.0
CUBE_CENTER = Vector((0.0, 0.0, 1.0))
SPHERE_CENTER = Vector((2.6, -0.3, 1.0))
LOOK_AT = Vector((1.2, -0.2, 1.25))
CAM_POS = Vector((5.2, -6.5, 1.8))

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def setup_cycles(samples=256):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.refresh_devices()
    has_gpu = any(d.type != 'CPU' for d in prefs.devices)
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU' if has_gpu else 'CPU'

    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 32
    scene.cycles.transmission_bounces = 24
    scene.cycles.glossy_bounces = 16

    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.film_transparent = False

    scene.view_settings.view_transform = 'Khronos PBR Neutral'

ENV_ROT_DEG = 150

def setup_environment():
    world = bpy.data.worlds.new("EnvWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value[2] = math.radians(ENV_ROT_DEG)
    tex = nodes.new('ShaderNodeTexEnvironment')
    tex.image = bpy.data.images.load(str(HDRI))
    background = nodes.new('ShaderNodeBackground')
    output = nodes.new('ShaderNodeOutputWorld')
    links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    links.new(tex.outputs['Color'], background.inputs['Color'])
    links.new(background.outputs['Background'], output.inputs['Surface'])

def add_grade():
    scene = bpy.context.scene
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new('CompositorNodeRLayers')
    contrast = tree.nodes.new('CompositorNodeBrightContrast')
    contrast.inputs['Contrast'].default_value = 8.0
    hsv = tree.nodes.new('CompositorNodeHueSat')
    hsv.inputs['Saturation'].default_value = 1.2
    comp = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(rl.outputs['Image'], contrast.inputs['Image'])
    tree.links.new(contrast.outputs['Image'], hsv.inputs['Image'])
    tree.links.new(hsv.outputs['Image'], comp.inputs['Image'])

def add_shadow_catcher():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND_Z))
    plane = bpy.context.object
    plane.name = "ShadowCatcher"
    plane.is_shadow_catcher = True

    plane.visible_diffuse = False
    plane.visible_glossy = False
    plane.visible_transmission = False
    plane.visible_volume_scatter = False

def look_at(cam, target):
    forward = target - cam.location
    cam.rotation_euler = forward.to_track_quat('-Z', 'Y').to_euler()

def add_camera():
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 40
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = CAM_POS
    bpy.context.collection.objects.link(cam)
    look_at(cam, LOOK_AT)
    bpy.context.scene.camera = cam

def new_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat, mat.node_tree.nodes["Principled BSDF"]

def add_cube():
    bpy.ops.mesh.primitive_cube_add(location=CUBE_CENTER)
    cube = bpy.context.object
    cube.rotation_euler = (0.0, 0.0, math.radians(22))
    return cube

def add_sphere():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=SPHERE_CENTER)
    sphere = bpy.context.object
    bpy.ops.object.shade_smooth()
    return sphere

def mat_mirror():
    mat, bsdf = new_material("Mirror")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.0
    return mat

def mat_metal_glossy(color):
    mat, bsdf = new_material("GlossyMetal")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.15
    return mat

def mat_glass(ior=1.5):
    mat, bsdf = new_material("Glass")
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = ior
    return mat

def build_stage(samples=256):
    reset_scene()
    setup_cycles(samples)
    setup_environment()
    add_camera()
    add_shadow_catcher()
    add_grade()

def build_part1():
    build_stage()
    cube = add_cube()
    cube.data.materials.append(mat_mirror())
    sphere = add_sphere()
    sphere.data.materials.append(mat_mirror())

def build_part2():
    build_stage()
    cube = add_cube()
    cube.data.materials.append(mat_glass(ior=1.5))
    sphere = add_sphere()
    sphere.data.materials.append(mat_metal_glossy((0.85, 0.15, 0.12)))

def build_part3():
    build_stage(samples=384)
    cube = add_cube()
    cube.data.materials.append(mat_glass(ior=1.5))
    sphere = add_sphere()
    sphere.data.materials.append(mat_mirror())

    bpy.ops.wm.obj_import(filepath=str(BUNNY))
    bunny = bpy.context.selected_objects[0]
    scale = 11.0
    bunny.scale = (scale, scale, scale)
    bunny.location = (1.5, -1.6, -0.033 * scale)
    bunny.rotation_euler = (math.radians(90), 0.0, math.radians(150))
    bpy.ops.object.shade_smooth()
    bunny.data.materials.clear()
    bunny.data.materials.append(mat_metal_glossy((0.92, 0.70, 0.22)))

BUILDERS = {"part1": build_part1, "part2": build_part2, "part3": build_part3}

def render(part):
    BUILDERS[part]()
    OUT.mkdir(exist_ok=True)
    bpy.context.scene.render.filepath = str(OUT / f"w10_{part}.png")
    bpy.ops.render.render(write_still=True)

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["all"]
    target = argv[0] if argv else "all"
    parts = list(BUILDERS) if target == "all" else [target]
    for p in parts:
        render(p)

main()
