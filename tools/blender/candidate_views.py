"""Render a Meshy candidate GLB from four vantages (front 3/4, top, side, cockpit close-up)
into tools/blender/reports/candidates/<slug>_<view>.png and one sheet per slug.

    blender --background --python tools/blender/candidate_views.py -- --slugs ship_vortex_a,ship_pyro_a
    (default: every folder under assets_base/cockpits/candidates that has a model.glb)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAND = os.path.join(ROOT, 'assets_base', 'cockpits', 'candidates')
OUT = os.path.join(ROOT, 'tools', 'blender', 'reports', 'candidates')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
slugs = None
if '--slugs' in argv:
    slugs = argv[argv.index('--slugs') + 1].split(',')
if slugs is None:
    slugs = sorted(d for d in os.listdir(CAND) if os.path.exists(os.path.join(CAND, d, 'model.glb')))
os.makedirs(OUT, exist_ok=True)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 800, 600
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.09, 0.10, 0.12, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 1.0
    fill.rotation_euler = (math.radians(-60), math.radians(20), math.radians(-120))
    sc.collection.objects.link(fill)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def look_at(cam, target):
    d = (target - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


for slug in slugs:
    path = os.path.join(CAND, slug, 'model.glb')
    sc, cam = setup_scene()
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    if not meshes:
        print('NOVIEW', slug)
        continue
    # clay look when the preview has no textures
    for o in meshes:
        if not o.data.materials or all(m is None for m in o.data.materials):
            m = bpy.data.materials.new('clay')
            m.use_nodes = True
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.56, 0.6, 1)
            o.data.materials.append(m)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(min(a, b) for a, b in zip(lo, w))
            hi = Vector(max(a, b) for a, b in zip(hi, w))
    ctr = (lo + hi) / 2
    size = max(hi - lo)
    L = hi - lo
    ax = 'X' if L.x >= L.y else 'Y'      # long axis of the hull
    print('BBOX', slug, [round(v, 3) for v in L], 'long', ax, 'tris', sum(len(o.data.polygons) for o in meshes))
    views = {
        'front34': Vector((1.6, -1.4, 0.9)) if ax == 'X' else Vector((-1.4, 1.6, 0.9)),
        'top': Vector((0.001, 0.001, 2.2)),
        'side': Vector((0.001, -2.2, 0.15)) if ax == 'X' else Vector((2.2, 0.001, 0.15)),
        'rear34': Vector((-1.6, -1.4, 0.9)) if ax == 'X' else Vector((-1.4, -1.6, 0.9)),
    }
    for name, off in views.items():
        cam.location = ctr + off * size * 0.75
        look_at(cam, ctr)
        cam.data.lens = 40
        sc.render.filepath = os.path.join(OUT, f'{slug}_{name}.png')
        bpy.ops.render.render(write_still=True)
    # cockpit close-up: from above-front looking down into the top of the hull's front half
    fwd = Vector((1, 0, 0)) if ax == 'X' else Vector((0, 1, 0))
    for sgn, nm in ((1, 'topfrontA'), (-1, 'topfrontB')):
        cam.location = ctr + fwd * sgn * size * 0.9 + Vector((0, 0, size * 0.9))
        look_at(cam, ctr + fwd * sgn * size * 0.15)
        cam.data.lens = 50
        sc.render.filepath = os.path.join(OUT, f'{slug}_{nm}.png')
        bpy.ops.render.render(write_still=True)
    print('VIEWS_DONE', slug)
