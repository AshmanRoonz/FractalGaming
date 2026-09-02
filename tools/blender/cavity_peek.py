"""Render the RAW Meshy cavity from the pilot's spot (no pipeline furniture) so the native
interior can be judged: blender --background --python tools/blender/cavity_peek.py -- --ship slayer
Reads assets_base/ships_v2/<ship>.glb (intake output: canonical axes + cockpit1)."""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ship = argv[argv.index('--ship') + 1]
OUT = os.path.join(ROOT, 'tools', 'blender', 'reports', 'intake')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets_base', 'ships_v2', f'{ship}.glb'), merge_vertices=True)
cp = [o for o in sc.objects if o.name == 'cockpit1'][0].matrix_world.translation.copy()
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 960, 720
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
sc.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(35), math.radians(10), math.radians(35))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam


def shot(name, loc, target, lens):
    cam.location = Vector(loc)
    d = (Vector(target) - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.005
    sc.render.filepath = os.path.join(OUT, f'{ship}_cavity_{name}.png')
    bpy.ops.render.render(write_still=True)


# the eye a little below the rim marker, looking forward (-X) ; and down into the cavity
eye = Vector((cp.x + 0.02, 0.0, cp.z - 0.06))
shot('fwd', eye, eye + Vector((-1, 0, -0.15)), 16)
shot('down', eye, eye + Vector((-0.6, 0, -0.8)), 16)
shot('above', (cp.x + 0.35, -0.35, cp.z + 0.45), (cp.x - 0.05, 0, cp.z - 0.1), 35)
print('PEEK_DONE', ship)
