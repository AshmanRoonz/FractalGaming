"""ship_remesh.py - the AI originals rebuilt as CLEAN hulls: one watertight shell, real topology,
the original paint baked on, a normal map baked from the hi-poly.

Owner (2026-09-03): "the GLB files are shit... they look nice from far, but when you zoom in, it is
a hot mess" - every original is ~2000 loose overlapping panels with no shared edges or thickness.

Per ship:  LSS/ships_original/<Ship>.glb (markers included, v37.51)
  1. voxel remesh (OpenVDB) at --voxel x L  -> one shell per solid piece
  2. drop interior cavities (loose parts whose box lies inside another part's box)
  3. decimate (collapse, Y symmetry) to --target triangles, smooth by angle
  4. smart UV unwrap
  5. Cycles bake, hi-poly -> clean: DIFFUSE colour only (the paint) + tangent NORMAL (the detail)
  6. export assets_base/ships_clean/<Ship>.glb with the markers ; ship_original.py --orig assets_base/ships_clean

Usage: blender --background --python tools/blender/ship_remesh.py -- [--ships pyro] [--voxel 0.003]
       [--target 150000] [--tex 2048] [--no-normal] [--render] [--samples 4]
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d


REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ORIG_DIR = os.path.join(REPO, 'LSS', 'ships_original')
OUT_DIR = os.path.join(REPO, opt('--out', 'assets_base/ships_clean'))
WORK = os.path.join(REPO, 'tools', 'blender', 'work', 'remesh')
REPORT = os.path.join(REPO, 'tools', 'blender', 'reports', 'remesh')
for d_ in (OUT_DIR, WORK, REPORT):
    os.makedirs(d_, exist_ok=True)
SHIPS = [s for s in opt('--ships', 'pyro').split(',') if s]
VOXEL = float(opt('--voxel', '0.002'))        # of L
SOLID = float(opt('--solid', '0.006'))        # of L: shell thickness given to the panels before remeshing
SMOOTH_ITERS = int(opt('--smooth', '2'))
TARGET = int(opt('--target', '150000'))
TEX = int(opt('--tex', '4096'))              # the bake ; the game recipe converts it to WebP (4k ~ 2-3 MB)
SAMPLES = int(opt('--samples', '4'))
BAKE_NORMAL = '--no-normal' not in argv
RENDER = '--render' in argv
EXPORT = '--no-export' not in argv


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
    """three close-ups from fixed vantages so before/after compare like for like"""
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
    rep = {'ship': ship, 'voxel': VOXEL, 'target': TARGET}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    meshes, empties = import_glb(os.path.join(ORIG_DIR, ship.capitalize() + '.glb'))
    for o in meshes + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    if len(meshes) > 1:
        select_only(meshes, meshes[0])
        bpy.ops.object.join()
    hi = meshes[0]
    select_only([hi])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    hi.name = 'hi'
    lo_, hi_ = bbox(hi)
    L = max(hi_ - lo_)
    ctr = (lo_ + hi_) / 2
    cp = next((e.matrix_world.translation.copy() for e in empties if e.name.startswith('cockpit')), ctr + Vector((-0.3 * L, 0, 0.05 * L)))
    rep['hi'] = {'tris': len(hi.data.polygons), 'L': round(L, 4)}
    mat_hi = hi.data.materials[0]
    img_hi = next(n.image for n in mat_hi.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    # ---- 1. voxel remesh on a copy (the REMESH modifier, applied: the voxel_remesh operator
    # crashed Blender with an access violation right after the EEVEE renders - a thread race) --
    # a SECOND import of the file is remeshed in place: the operator on a copied mesh datablock
    # crashed Blender (access violation) two runs out of three ; on the imported object directly
    # it has never crashed. (The REMESH modifier is stable but rebuilds only part of the hull:
    # 113k quads at 0.001 L against the operator's 415k at 0.003 L.)
    meshes2, empties2 = import_glb(os.path.join(ORIG_DIR, ship.capitalize() + '.glb'))
    for o in meshes2 + empties2:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for e in empties2:
        bpy.data.objects.remove(e, do_unlink=True)
    if len(meshes2) > 1:
        select_only(meshes2, meshes2[0])
        bpy.ops.object.join()
    clean = meshes2[0]
    select_only([clean])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    clean.name = 'mesh_0'
    clean.data.name = 'mesh_0'
    t1 = time.time()
    # SOLIDIFY first: the panels have no thickness, so a voxel remesh cannot tell inside from
    # outside (the operator gave a pitted, porous surface and crashed two runs in three ; the
    # modifier gave a sparse cloud). Closed slabs remesh into one watertight hull, and the
    # REMESH modifier is stable. A light smooth takes the voxel terracing off curved skin ; the
    # normal map baked from the hi-poly brings the fine detail back.
    so = clean.modifiers.new('solid', 'SOLIDIFY')
    so.thickness = SOLID * L
    so.offset = 0.0
    so.use_even_offset = False
    so.use_quality_normals = False
    bpy.ops.object.modifier_apply(modifier=so.name)
    rm = clean.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = VOXEL * L
    rm.adaptivity = 0.0
    rm.use_smooth_shade = False
    bpy.ops.object.modifier_apply(modifier=rm.name)
    sm = clean.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.5
    sm.iterations = SMOOTH_ITERS
    bpy.ops.object.modifier_apply(modifier=sm.name)
    rep['remesh'] = {'tris_raw': len(clean.data.polygons), 'seconds': round(time.time() - t1, 1), 'solid': SOLID, 'smooth_iters': SMOOTH_ITERS}
    if RENDER:
        render_views([hi], 'before', ship, L, ctr, cp)

    # ---- 2. drop interior cavities (parts boxed inside another part) --------------------------
    select_only([clean])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('mesh_0')]
    boxes = {o: bbox(o) for o in parts}
    npoly = {o: len(o.data.polygons) for o in parts}
    drop = set()
    for o in parts:
        lo1, hi1 = boxes[o]
        inside = False
        for p in parts:
            if p is o:
                continue
            lo2, hi2 = boxes[p]
            if all(lo2[i] - 1e-6 <= lo1[i] and hi1[i] <= hi2[i] + 1e-6 for i in range(3)) and npoly[p] > npoly[o]:
                inside = True
                break
        if inside or npoly[o] < 50:
            drop.add(o)
    keep = [o for o in parts if o not in drop]
    for o in drop:
        bpy.data.objects.remove(o, do_unlink=True)
    dropped = len(drop)
    select_only(keep, keep[0])
    if len(keep) > 1:
        bpy.ops.object.join()
    clean = bpy.context.view_layer.objects.active
    clean.name = 'mesh_0'
    clean.data.name = 'mesh_0'
    rep['remesh'].update({'parts': len(parts), 'dropped': dropped, 'tris_shell': len(clean.data.polygons)})

    # ---- 3. decimate + smooth ----------------------------------------------------------------
    n_tri = sum(len(pg.vertices) - 2 for pg in clean.data.polygons)      # the remesh is quads
    if n_tri > TARGET:
        select_only([clean])
        mod = clean.modifiers.new('dec', 'DECIMATE')
        mod.ratio = TARGET / n_tri
        mod.use_collapse_triangulate = True
        mod.use_symmetry = True
        mod.symmetry_axis = 'Y'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # the decimated mesh must be VALID: the first run left one face without loops and every later
    # step (unwrap, bake, export) silently did nothing on it
    bad = clean.data.validate(verbose=False, clean_customdata=True)
    bm = bmesh.new()
    bm.from_mesh(clean.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6 * L, edges=bm.edges[:])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6 * L)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(clean.data)
    bm.free()
    clean.data.update()
    rep['clean'] = {'tris': sum(len(pg.vertices) - 2 for pg in clean.data.polygons), 'polys': len(clean.data.polygons),
                    'validate_fixed': bool(bad)}
    # smooth shading with sharp edges by angle (4.1: smooth-by-angle is a modifier ; sharp edges are native)
    select_only([clean])
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_mode(type='EDGE')
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(45))
    bpy.ops.mesh.mark_sharp()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.object.mode_set(mode='OBJECT')

    # ---- 4. UV unwrap -----------------------------------------------------------------------
    t1 = time.time()
    select_only([clean])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.001, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002)       # smart_project alone covered ~37% of the texture
    except Exception as ex:
        print('pack_islands skipped:', ex)
    bpy.ops.object.mode_set(mode='OBJECT')
    rep['uv_seconds'] = round(time.time() - t1, 1)
    uvl = clean.data.uv_layers.active
    uv = np.empty(len(clean.data.loops) * 2, np.float32)
    uvl.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    rep['uv'] = {'layers': len(clean.data.uv_layers), 'span': [round(float(v), 3) for v in (uv[:, 0].min(), uv[:, 0].max(), uv[:, 1].min(), uv[:, 1].max())]}
    if len(clean.data.uv_layers) == 0 or (uv.max() - uv.min()) < 0.5:
        raise RuntimeError(f'{ship}: smart_project produced no usable UVs: {rep["uv"]}')

    # ---- 5. bake hi -> clean ----------------------------------------------------------------
    mat = bpy.data.materials.new('hull')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    img_c = bpy.data.images.new(f'{ship}_clean_base', TEX, TEX, alpha=False)
    tex_c = nt.nodes.new('ShaderNodeTexImage')
    tex_c.image = img_c
    nt.links.new(tex_c.outputs['Color'], bsdf.inputs['Base Color'])
    clean.data.materials.clear()
    clean.data.materials.append(mat)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.015 * L
    sc.render.bake.max_ray_distance = 0.035 * L
    sc.render.bake.margin = 8
    hi.hide_render = False
    clean.hide_render = False
    select_only([hi, clean], clean)
    nt.nodes.active = tex_c
    t1 = time.time()
    res = bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                              cage_extrusion=0.015 * L, max_ray_distance=0.035 * L, margin=8)
    pxc = np.empty(TEX * TEX * 4, np.float32)
    img_c.pixels.foreach_get(pxc)
    rep['bake_color'] = {'result': str(res), 'mean_rgb': [round(float(v), 3) for v in pxc.reshape(-1, 4)[:, :3].mean(0)],
                         'nonblack_pct': round(float(100 * (pxc.reshape(-1, 4)[:, :3].max(1) > 0.02).mean()), 1)}
    if rep['bake_color']['nonblack_pct'] < 5:
        raise RuntimeError(f'{ship}: the colour bake wrote nothing: {rep["bake_color"]}')
    img_c.filepath_raw = os.path.join(WORK, f'{ship}_clean_base.png')
    img_c.file_format = 'PNG'
    img_c.save()
    img_c.pack()
    rep['bake_color_seconds'] = round(time.time() - t1, 1)
    if BAKE_NORMAL:
        img_n = bpy.data.images.new(f'{ship}_clean_normal', TEX, TEX, alpha=False)
        img_n.colorspace_settings.name = 'Non-Color'
        tex_n = nt.nodes.new('ShaderNodeTexImage')
        tex_n.image = img_n
        nt.nodes.active = tex_n
        select_only([hi, clean], clean)
        t1 = time.time()
        res = bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                                  cage_extrusion=0.015 * L, max_ray_distance=0.035 * L, margin=8)
        pxn = np.empty(TEX * TEX * 4, np.float32)
        img_n.pixels.foreach_get(pxn)
        rep['bake_normal'] = {'result': str(res), 'mean_rgb': [round(float(v), 3) for v in pxn.reshape(-1, 4)[:, :3].mean(0)]}
        img_n.filepath_raw = os.path.join(WORK, f'{ship}_clean_normal.png')
        img_n.file_format = 'PNG'
        img_n.save()
        img_n.pack()
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(tex_n.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        rep['bake_normal_seconds'] = round(time.time() - t1, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Metallic'].default_value = 0.2

    if RENDER:
        render_views([clean], 'after', ship, L, ctr, cp)
    # ---- 6. export: the clean hull + the markers ---------------------------------------------
    bpy.data.objects.remove(hi, do_unlink=True)
    for nm in ('cam_', 'sun_'):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    if EXPORT:
        out = os.path.join(OUT_DIR, ship.capitalize() + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                                  export_texcoords=True, export_extras=False, export_lights=False,
                                  export_cameras=False, export_animations=False, use_selection=False)
        rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out)}
    rep['seconds'] = round(time.time() - t0, 1)
    json.dump(rep, open(os.path.join(REPORT, f'{ship}_remesh.json'), 'w'), indent=1)
    print('REMESH', json.dumps(rep))


for s_ in SHIPS:
    process(s_)
print('REMESH_DONE')
