# -*- coding: utf-8 -*-
"""
verify_culled.py — render every hull the way COMBAT renders it (backface culling ON, i.e.
three.js FrontSide) from six fixed vantages, before (assets_base) and after (assets_src),
on a transparent film. Any see-through hole in the hull becomes alpha=0, so a plain alpha
diff between the two renders is an exact map of what the cleanup changed in-game.

    blender --background --python tools/blender/verify_culled.py -- [--ships a,b] [--before DIR] [--after DIR]

Writes tools/blender/reports/culled/<ship>_<before|after>_<view>.png ; then run
    python tools/blender/verify_culled_diff.py
"""
import bpy
import os
import sys
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


SHIPS = opt('--ships', 'blaster,puncture,pyro,slayer,syphon,tracker,vortex').split(',')
BEFORE = os.path.join(REPO, opt('--before', 'assets_base/ships'))
AFTER = os.path.join(REPO, opt('--after', 'assets_src/ships'))
OUT = os.path.join(REPO, 'tools/blender/reports/culled')
os.makedirs(OUT, exist_ok=True)


def look_at(o, t):
    o.rotation_euler = (t - o.location).to_track_quat('-Z', 'Y').to_euler()


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=False)
    sc = bpy.context.scene
    objs = [o for o in sc.objects if o.type == 'MESH']
    for o in objs:
        for m in o.data.materials:
            if m:
                m.use_backface_culling = True
                m.blend_method = 'OPAQUE'
    empt = {o.name: o.matrix_world.translation.copy() for o in sc.objects if o.type == 'EMPTY'}
    return sc, objs, empt


def frame_of(objs, empt):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (lo + hi) / 2
    L = max(hi - lo)
    guns = [v for k, v in empt.items() if k.startswith('gun')]
    thr = [v for k, v in empt.items() if k.startswith('thruster')]
    fwd = Vector((-1, 0, 0))
    if guns and thr:
        fwd = sum(guns, Vector()) / len(guns) - sum(thr, Vector()) / len(thr)
        fwd.z = 0
        fwd.normalize()
    up = Vector((0, 0, 1))
    right = fwd.cross(up).normalized()
    return ctr, L, fwd, right, up


def render_set(sc, ctr, L, fwd, right, up, tag, name):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 768
    sc.render.film_transparent = True
    sc.eevee.taa_render_samples = 8
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.6, 0.65, 1)
    ld = bpy.data.lights.new('S', 'SUN')
    ld.energy = 3.0
    sun = bpy.data.objects.new('S', ld)
    sun.location = ctr + Vector((L, -L, L * 1.5))
    sc.collection.objects.link(sun)
    look_at(sun, ctr)
    cd = bpy.data.cameras.new('C')
    cd.lens = 40
    cd.clip_start = L * 0.002
    cd.clip_end = L * 60
    cam = bpy.data.objects.new('C', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    D = L * 1.3
    views = {
        'front34': ctr + fwd * D * 0.8 + right * D * 0.6 + up * D * 0.45,
        'rear34': ctr - fwd * D * 0.8 - right * D * 0.6 + up * D * 0.45,
        'top': ctr + up * D * 1.1 + fwd * D * 0.05,
        'bottom_front': ctr + fwd * D * 0.7 - right * D * 0.5 - up * D * 0.6,
        'bottom_rear': ctr - fwd * D * 0.7 + right * D * 0.5 - up * D * 0.6,
        'side': ctr + right * D * 1.05 + up * D * 0.1,
    }
    for vn, loc in views.items():
        cam.location = loc
        look_at(cam, ctr)
        sc.render.filepath = os.path.join(OUT, f'{name}_{tag}_{vn}.png')
        bpy.ops.render.render(write_still=True)


for name in SHIPS:
    sc, objs, empt = load(os.path.join(BEFORE, name + '.glb'))
    frame = frame_of(objs, empt)
    render_set(sc, *frame, 'before', name)
    sc, objs, empt = load(os.path.join(AFTER, name + '.glb'))
    render_set(sc, *frame, 'after', name)
    print('CULLED', name)
print('CULLED_DONE')
