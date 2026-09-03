"""optimizer_try.py - drive Hinneman/blender-model-optimizer's geometry steps headless on a ship
(owner: "try this https://github.com/Hinneman/blender-model-optimizer").

The add-on targets Blender 4.2+ as a sidebar panel ; its geometry code is plain bpy, so this
loads the package from a checkout (--pkg) bypassing __init__ and runs, on LSS/ships_original/<Ship>.glb:
  fix_geometry_single  -> remove_interior_single (LOOSE_PARTS ; RAY_CAST fires 13 Python rays per face)
  -> remove_small_pieces_single -> decimate_single (planar pre-pass + N-pass collapse, UV-seam protection)
then renders the same three close-ups as ship_remesh.py ('opt' tag) and exports assets_base/ships_opt/<Ship>.glb.

Usage: blender --background --python tools/blender/optimizer_try.py -- --pkg <checkout> [--ships pyro]
       [--target 150000] [--passes 2] [--planar 5] [--interior LOOSE_PARTS|RAY_CAST|OFF] [--render]
"""
import importlib
import json
import math
import os
import sys
import time
import types

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d


REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PKG = opt('--pkg', os.path.join(REPO, 'tools', 'blender', 'vendor', 'blender-model-optimizer'))
ORIG_DIR = os.path.join(REPO, 'LSS', 'ships_original')
OUT_DIR = os.path.join(REPO, 'assets_base', 'ships_opt')
REPORT = os.path.join(REPO, 'tools', 'blender', 'reports', 'remesh')
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(REPORT, exist_ok=True)
SHIPS = [s for s in opt('--ships', 'pyro').split(',') if s]
TARGET = int(opt('--target', '150000'))
PASSES = int(opt('--passes', '2'))
PLANAR_DEG = float(opt('--planar', '5'))
INTERIOR = opt('--interior', 'LOOSE_PARTS')
RENDER = '--render' in argv

# ---- load the add-on's geometry module without its __init__ (which registers UI classes)
pkg_dir = os.path.join(PKG, 'blender_model_optimizer')
if not os.path.isdir(pkg_dir):
    raise SystemExit(f'--pkg must point at a checkout containing blender_model_optimizer/ (got {PKG})')
pkg = types.ModuleType('blender_model_optimizer')
pkg.__path__ = [pkg_dir]
sys.modules['blender_model_optimizer'] = pkg
geometry = importlib.import_module('blender_model_optimizer.geometry')
geometry.log = lambda context, message, level='INFO': print(f'[optimizer:{level}] {message}')


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return [o for o in new if o.type == 'MESH'], [o for o in new if o.type == 'EMPTY']


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def render_views(objs_visible, tag, ship, L, ctr, cp):
    sc = bpy.context.scene
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o not in objs_visible
    sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 16
    sc.render.resolution_x, sc.render.resolution_y = 960, 640
    sc.render.image_settings.file_format = 'PNG'
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.5, 0.6, 1)
    sun = bpy.data.objects.get('sun_')
    if not sun:
        sun = bpy.data.objects.new('sun_', bpy.data.lights.new('sun_', 'SUN'))
        sun.data.energy = 3.0
        sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
        sc.collection.objects.link(sun)
    cam = bpy.data.objects.get('cam_')
    if not cam:
        cam = bpy.data.objects.new('cam_', bpy.data.cameras.new('cam_'))
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.clip_start = 0.002 * L
    cam.data.clip_end = 60 * L
    fwd, right, up = Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    shots = {
        'front34': (ctr + fwd * 0.9 * L + right * 0.7 * L + up * 0.5 * L, ctr, 40),
        'canopy_close': (cp + fwd * 0.30 * L + right * 0.22 * L + up * 0.22 * L, cp, 55),
        'skin_macro': (cp + fwd * 0.16 * L + right * 0.10 * L + up * 0.12 * L, cp + fwd * 0.05 * L, 70),
    }
    for name, (loc, tgt, lens) in shots.items():
        cam.data.lens = lens
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(REPORT, f'{ship}_{tag}_{name}.png')
        bpy.ops.render.render(write_still=True)


def process(ship):
    t0 = time.time()
    rep = {'ship': ship, 'tool': 'blender-model-optimizer', 'interior': INTERIOR, 'passes': PASSES, 'planar_deg': PLANAR_DEG}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ctx = bpy.context
    meshes, empties = import_glb(os.path.join(ORIG_DIR, ship.capitalize() + '.glb'))
    for o in meshes + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    if len(meshes) > 1:
        select_only(meshes, meshes[0])
        bpy.ops.object.join()
    obj = meshes[0]
    select_only([obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = 'mesh_0'
    lo_, hi_ = bbox(obj)
    L = max(hi_ - lo_)
    ctr = (lo_ + hi_) / 2
    cp = next((e.matrix_world.translation.copy() for e in empties if e.name.startswith('cockpit')), ctr)
    n0 = len(obj.data.polygons)
    rep['tris_in'] = n0
    props = types.SimpleNamespace(
        merge_distance_mm=0.1, recalculate_normals=True, manifold_method='FILL_HOLES',
        interior_method=INTERIOR, small_pieces_face_threshold=50, small_pieces_size_threshold=1.0,
        decimate_ratio=min(1.0, TARGET / max(1, n0)), decimate_passes=PASSES, protect_uv_seams=True,
        run_planar_prepass=PLANAR_DEG > 0, planar_angle=math.radians(PLANAR_DEG),
        bake_normal_map=False, normal_map_resolution='2048', auto_cage_extrusion=True, cage_extrusion_mm=10.0,
        verbose_logging=True,
    )
    steps = {}
    t1 = time.time()
    steps['fix_geometry'] = {'result': str(geometry.fix_geometry_single(ctx, obj, props)), 'polys': len(obj.data.polygons), 'seconds': round(time.time() - t1, 1)}
    if INTERIOR != 'OFF':
        t1 = time.time()
        removed = geometry.remove_interior_single(ctx, obj, props)
        steps['remove_interior'] = {'removed': int(removed), 'polys': len(obj.data.polygons), 'seconds': round(time.time() - t1, 1)}
    t1 = time.time()
    r = geometry.remove_small_pieces_single(ctx, obj, props)
    steps['remove_small_pieces'] = {'result': str(r), 'polys': len(obj.data.polygons), 'seconds': round(time.time() - t1, 1)}
    props.decimate_ratio = min(1.0, TARGET / max(1, sum(len(p.vertices) - 2 for p in obj.data.polygons)))
    t1 = time.time()
    r = geometry.decimate_single(ctx, obj, props)
    steps['decimate'] = {'result': str(r), 'polys': len(obj.data.polygons), 'tris': sum(len(p.vertices) - 2 for p in obj.data.polygons), 'seconds': round(time.time() - t1, 1)}
    # their collapse leaves a mesh the glTF exporter rejects ('Array length mismatch', 760-byte file) -
    # the same thing ship_remesh.py hit ; validate + drop degenerate geometry before anything else
    bad = obj.data.validate(verbose=False, clean_customdata=True)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6 * L, edges=bm.edges[:])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    steps['validate'] = {'fixed': bool(bad), 'polys': len(obj.data.polygons), 'tris': sum(len(p.vertices) - 2 for p in obj.data.polygons)}
    rep['steps'] = steps
    rep['tris_out'] = steps['validate']['tris']
    if RENDER:
        render_views([obj], 'opt', ship, L, ctr, cp)
        for nm in ('cam_', 'sun_'):
            o = bpy.data.objects.get(nm)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
    out = os.path.join(OUT_DIR, ship.capitalize() + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                              export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                              export_texcoords=True, export_extras=False, export_lights=False,
                              export_cameras=False, export_animations=False, use_selection=False)
    rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out)}
    rep['seconds'] = round(time.time() - t0, 1)
    json.dump(rep, open(os.path.join(REPORT, f'{ship}_optimizer.json'), 'w'), indent=1)
    print('OPTIMIZER', json.dumps(rep))


for s_ in SHIPS:
    process(s_)
print('OPTIMIZER_DONE')
