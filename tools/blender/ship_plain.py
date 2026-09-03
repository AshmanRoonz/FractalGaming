"""ship_plain.py - the owner's ORIGINAL hulls, decimated, nothing else.

Owner (v37.64): "i don't think we need the glb models with the cutout, let's start over and use
the ships_original models, let's shrink the file size down / we won't use the glass cutout data at
all / let's do this for all the ships".

So this replaces the remesh + glass chain with one short stage:

    assets_base/ships_original/<Ship>.glb  the hi-poly export, marker nodes already inside
      -> join + apply transforms, weld exact duplicates
      -> planar pre-pass + collapse decimate to --target triangles (UV seams protected: the
         original texture is kept as it is, nothing is re-baked)
      -> validate / dissolve degenerate / recalc normals, smooth with sharp edges by angle
      -> assets_src/ships/<ship>.glb       (then: node tools/compress_glb.mjs --only ships)

No glass material, no cuts, no interior, no marks JSON: the seat view reads the hull through the
v37.61 ghost shell instead, so the canopy does not have to be an opening any more.

    blender --background --python tools/blender/ship_plain.py -- [--ships pyro,vortex]
        [--target 60000] [--tex 2048] [--out assets_src/ships] [--render] [--no-export]
"""
import importlib
import json
import math
import os
import sys
import time
import types

import bmesh
import bpy
import numpy as np
from mathutils import Vector


def step(*a):
    print('[step]', *a, flush=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d


REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ORIG_DIR = os.path.join(REPO, opt('--orig', 'assets_base/ships_original'))
OUT_DIR = os.path.join(REPO, opt('--out', 'assets_src/ships'))
REPORT = os.path.join(REPO, 'tools', 'blender', 'reports', 'plain')
SHIPS = [s for s in opt('--ships', 'vortex,pyro,puncture,slayer,tracker,blaster,syphon').split(',') if s]
TARGET = int(opt('--target', '60000'))     # triangle budget per hull (150k was ~6.9 MB shipped)
TEX = int(opt('--tex', '2048'))            # baked atlas size (the normal map is baked at half)
SAMPLES = int(opt('--samples', '4'))       # Cycles bake samples ; the bake is flat colour, 4 is plenty
BAKE = '--nobake' not in argv              # bake a fresh skin onto the decimated hull
NO_EYE = '--no-eye' in argv                # keep cockpit1 exactly where it was authored
                                           # (the carrier marks its DECK SPAWNS with cockpit<n>;
                                           #  moving cockpit1 to the hull centre is a fighter rule)
SHARP_DEG = float(opt('--sharp', '32'))    # edges sharper than this stay hard after decimation
RENDER = '--render' in argv
EXPORT = '--no-export' not in argv
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(REPORT, exist_ok=True)

# Hinneman/blender-model-optimizer (vendored, MIT). Its decimate_single runs a planar pre-pass
# (limited dissolve) before collapsing, which is worth a lot on these hulls: they are ~2000 flat
# panels, so the pre-pass removes interior vertices of every panel for free before any collapse
# starts spending detail. --pkg '' falls back to a plain collapse modifier.
PKG = opt('--pkg', os.path.join(REPO, 'tools', 'blender', 'vendor', 'blender-model-optimizer'))
_opt_geometry = None
if PKG and os.path.isdir(os.path.join(PKG, 'blender_model_optimizer')):
    _pkg = types.ModuleType('blender_model_optimizer')
    _pkg.__path__ = [os.path.join(PKG, 'blender_model_optimizer')]
    sys.modules['blender_model_optimizer'] = _pkg
    _opt_geometry = importlib.import_module('blender_model_optimizer.geometry')
    _opt_geometry.log = lambda context, message, level='INFO': print(f'[optimizer:{level}] {message}')


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


def tris_of(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def render_views(obj, tag, ship, L, ctr, cp):
    sc = bpy.context.scene
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
        'side': (ctr + right * 1.5 * L + up * 0.12 * L, ctr, 50),
    }
    for name, (loc, tgt, lens) in shots.items():
        cam.data.lens = lens
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(REPORT, f'{ship}_{tag}_{name}.png')
        bpy.ops.render.render(write_still=True)


def seat_eye(obj, marker, L, rep):
    """Put the pilot's eye at the EXACT MIDDLE of the hull (owner, v37.65: "let's try placing the
    cockpit location in the exact middle of each ship").

    The markers came from the old simplified hulls, and on these originals five of the seven sat ON
    the outer skin with nothing above them - the reason the seat view had a floor and no ceiling
    (owner: "it looks like the top half the ship is missing in ghost view"). The middle of the
    bounding box is inside the shell by construction, so the ghost hull wraps the pilot on every
    side. A per-ship tools/blender/marks/<ship>_eye.json {"offset": [fwd, right, up]} (fractions of
    the hull length) nudges it, and window.__cockpit.eye = {fwd, right, up} moves it live in game.
    """
    lo = Vector([min(v.co[i] for v in obj.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in obj.data.vertices) for i in range(3)])
    eye = (lo + hi) / 2
    hits = {}
    for k, d in (('up', (0, 0, 1)), ('down', (0, 0, -1)), ('fwd', (-1, 0, 0)), ('back', (1, 0, 0)),
                 ('left', (0, -1, 0)), ('right', (0, 1, 0))):
        ok, loc, nrm, idx = obj.ray_cast(eye, Vector(d))
        hits[k] = round((loc - eye).length, 4) if ok else None
    rep['eye'] = {'mode': 'hull centre', 'from': [round(v, 4) for v in marker], 'to': [round(v, 4) for v in eye],
                  'clearance': hits, 'enclosed': sum(1 for v in hits.values() if v is not None)}
    return eye


def process(ship):
    t0 = time.time()
    rep = {'ship': ship, 'target': TARGET}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = os.path.join(ORIG_DIR, ship.capitalize() + '.glb')
    meshes, empties = import_glb(src)
    # markers ride the scene root, unparented, exactly where the original put them
    for o in meshes + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    if len(meshes) > 1:
        select_only(meshes, meshes[0])
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active if len(meshes) > 1 else meshes[0]
    select_only([obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = obj.data.name = 'mesh_0'
    lo = Vector([min((obj.matrix_world @ v.co)[i] for v in obj.data.vertices) for i in range(3)])
    hi = Vector([max((obj.matrix_world @ v.co)[i] for v in obj.data.vertices) for i in range(3)])
    L = max(hi - lo)
    ctr = (lo + hi) / 2
    cp = next((e.matrix_world.translation.copy() for e in empties if e.name.lower().startswith('cockpit')), ctr)
    hi = None
    if BAKE:
        # the bake source: the untouched hi-poly with its own material and UVs
        hi = obj.copy()
        hi.data = obj.data.copy()
        hi.name = hi.data.name = 'hi'
        bpy.context.scene.collection.objects.link(hi)
        hi.hide_render = False
    n_in = tris_of(obj.data)
    rep['in'] = {'tris': n_in, 'verts': len(obj.data.vertices), 'materials': [m.name if m else '?' for m in obj.data.materials],
                 'markers': sorted(e.name for e in empties), 'L': round(L, 4), 'bytes': os.path.getsize(src)}
    if RENDER:
        render_views(obj, 'before', ship, L, ctr, cp)

    step('weld')
    # ---- weld exact duplicates -------------------------------------------------------------
    # the export is panel soup: every panel carries its own copy of the shared corner vertices, so
    # a collapse has nothing to collapse ALONG. Welding at 1e-5 of the hull joins only vertices
    # that were already the same point.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    n_v0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * L)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    rep['weld'] = {'verts': f'{n_v0} -> {len(obj.data.vertices)}', 'tris': tris_of(obj.data)}
    # custom split normals came from the modelling package and mean nothing once the topology
    # changes ; drop them and shade by angle after the decimation instead
    step('normals clear')
    try:
        select_only([obj])
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as e:
        rep['normals_clear'] = str(e)[:80]

    # ---- decimate --------------------------------------------------------------------------
    n_tri = tris_of(obj.data)
    step('decimate from', n_tri)
    if n_tri > TARGET * 1.05 and _opt_geometry is not None:
        props = types.SimpleNamespace(merge_distance_mm=0.1, decimate_ratio=TARGET / n_tri, decimate_passes=2,
                                      protect_uv_seams=True,     # the ORIGINAL texture is kept: seams must hold
                                      run_planar_prepass=True, planar_angle=math.radians(5.0),
                                      verbose_logging=True)
        _opt_geometry.decimate_single(bpy.context, obj, props)
        rep['decimate'] = 'optimizer planar 5deg + 2-pass collapse, UV seams protected'
    elif n_tri > TARGET * 1.05:
        select_only([obj])
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = TARGET / n_tri
        mod.use_collapse_triangulate = True
        mod.use_symmetry = True
        mod.symmetry_axis = 'Y'
        bpy.ops.object.modifier_apply(modifier=mod.name)
        rep['decimate'] = 'blender collapse (Y symmetry)'
    else:
        rep['decimate'] = 'none (already under budget)'
    # a second plain collapse when the seam-protected pass could not reach the budget
    n_tri2 = tris_of(obj.data)
    if n_tri2 > TARGET * 1.15:
        select_only([obj])
        mod = obj.modifiers.new('dec2', 'DECIMATE')
        mod.ratio = TARGET / n_tri2
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        rep['decimate2'] = f'plain collapse {n_tri2} -> {tris_of(obj.data)}'

    # ---- clean + shade ---------------------------------------------------------------------
    # (v37.59 lesson) an invalid mesh exports as a 760-byte stub in silence: validate first
    step('rebuild datablock')
    # the seam-protected decimation leaves the mesh datablock in a state bmesh cannot read:
    # bm.from_mesh() crashed Blender outright (exit 127, no traceback). The seam protection works
    # through a vertex group (AIOPT_Seam_Protect), and the deform layer it leaves behind is the
    # part that does not survive. Drop the groups and rebuild the datablock from the evaluated
    # object, which hands back clean geometry with the modifiers already applied.
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    dg = bpy.context.evaluated_depsgraph_get()
    fresh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    stale = obj.data
    obj.data = fresh
    fresh.name = 'mesh_0'
    try:
        bpy.data.meshes.remove(stale)
    except Exception:
        pass
    step('validate', tris_of(obj.data))
    # (v37.59 lesson) an invalid mesh exports as a 760-byte stub in silence: validate first
    bad = obj.data.validate(verbose=False, clean_customdata=True)
    step('shade')
    # shading entirely in bmesh: the 4.1 edit-mode operators (edges_select_sharp / mark_sharp) and
    # the EDGE_SPLIT modifier crashed Blender outright here (no traceback, exit 127) on the
    # decimated originals. Faces smooth, edges over SHARP_DEG split - the same result EDGE_SPLIT
    # gives, and what the glTF exporter needs to write hard edges.
    bm = bmesh.new()
    step('  from_mesh')
    bm.from_mesh(obj.data)
    step('  dissolve', len(bm.faces), 'faces', len(bm.edges), 'edges')
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6 * L, edges=bm.edges[:])
    step('  smooth flags')
    for f in bm.faces:
        f.smooth = True
    cos = math.cos(math.radians(SHARP_DEG))
    sharp = []
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            if lf[0].normal.dot(lf[1].normal) < cos:
                sharp.append(e)
        elif len(lf) > 2:
            sharp.append(e)
    step('  split', len(sharp))
    if sharp:
        bmesh.ops.split_edges(bm, edges=sharp)
    step('  to_mesh')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    rep['out'] = {'tris': tris_of(obj.data), 'verts': len(obj.data.vertices), 'validate_fixed': bool(bad),
                  'sharp_edges': len(sharp)}

    # ---- UV + bake ---------------------------------------------------------------------------
    # (v37.66) owner: "earlier we ran a streamline that cleaned up the ship models... it made the
    # skin theme go on way cleaner... right now we can see a lot of triangles with the skins
    # applied". The original UVs are per-panel and the collapse drags them across their seams, so
    # the texture smears along every decimated triangle. The fix is the one the remesh chain used:
    # give the decimated hull ONE fresh atlas (smart project) and bake the original's appearance
    # into it through space, plus a tangent normal map that puts the panel detail the decimation
    # removed back into the shading.
    if BAKE and hi is not None:
        step('uv unwrap')
        select_only([obj])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.select_mode(type='FACE')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(80), island_margin=0.0005, scale_to_bounds=False)
        try:
            bpy.ops.uv.pack_islands(rotate=True, margin=0.001)      # smart_project alone covers ~37% of the sheet
        except Exception as ex:
            print('pack_islands skipped:', ex)
        bpy.ops.object.mode_set(mode='OBJECT')
        uvl = obj.data.uv_layers.active
        uv = np.empty(len(obj.data.loops) * 2, np.float32)
        uvl.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        rep['uv'] = {'layers': len(obj.data.uv_layers),
                     'span': [round(float(v), 3) for v in (uv[:, 0].min(), uv[:, 0].max(), uv[:, 1].min(), uv[:, 1].max())]}
        if len(obj.data.uv_layers) == 0 or (uv.max() - uv.min()) < 0.5:
            raise RuntimeError('%s: smart_project produced no usable UVs: %s' % (ship, rep['uv']))
        step('bake colour')
        sc = bpy.context.scene
        mat = bpy.data.materials.new('hull')
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        img_c = bpy.data.images.new(ship + '_base', TEX, TEX, alpha=False)
        tex_c = nt.nodes.new('ShaderNodeTexImage')
        tex_c.image = img_c
        nt.links.new(tex_c.outputs['Color'], bsdf.inputs['Base Color'])
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = SAMPLES
        cage, ray = 0.015 * L, 0.035 * L      # tuned in the remesh chain: longer rays streak the bake
        nt.nodes.active = tex_c
        select_only([hi, obj], obj)
        t1 = time.time()
        res = bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                                  cage_extrusion=cage, max_ray_distance=ray, margin=8)
        px = np.empty(TEX * TEX * 4, np.float32)
        img_c.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3]
        rep['bake_color'] = {'result': str(res), 'mean_rgb': [round(float(v), 3) for v in rgb.mean(0)],
                             'nonblack_pct': round(float(100 * (rgb.max(1) > 0.02).mean()), 1),
                             'seconds': round(time.time() - t1, 1)}
        if rep['bake_color']['nonblack_pct'] < 5:
            raise RuntimeError('%s: the colour bake wrote nothing: %s' % (ship, rep['bake_color']))
        img_c.pack()
        step('bake normal')
        img_n = bpy.data.images.new(ship + '_normal', TEX // 2, TEX // 2, alpha=False)
        img_n.colorspace_settings.name = 'Non-Color'
        tex_n = nt.nodes.new('ShaderNodeTexImage')
        tex_n.image = img_n
        nt.nodes.active = tex_n
        select_only([hi, obj], obj)
        t1 = time.time()
        res = bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                                  cage_extrusion=cage, max_ray_distance=ray, margin=8)
        img_n.pack()
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex_n.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        rep['bake_normal'] = {'result': str(res), 'seconds': round(time.time() - t1, 1)}
        bsdf.inputs['Roughness'].default_value = 0.6
        bsdf.inputs['Metallic'].default_value = 0.2
        bpy.data.objects.remove(hi, do_unlink=True)
        hi = None
    step('seat eye')
    cock = None if NO_EYE else next((e for e in empties if e.name.lower() == 'cockpit1'), None)
    if cock is not None:
        eye = seat_eye(obj, cock.matrix_world.translation.copy(), L, rep)
        adj_path = os.path.join(REPO, 'tools', 'blender', 'marks', ship + '_eye.json')
        if os.path.exists(adj_path):
            off = (json.load(open(adj_path, encoding='utf-8')).get('offset') or [0, 0, 0])
            eye = eye + Vector((-off[0] * L, off[1] * L, off[2] * L))   # fwd is -x, right +y, up +z
            rep['eye']['offset'] = off
        cock.matrix_world.translation = eye
    step('textures')
    imgs = []
    for im in bpy.data.images:
        if im.size[0] and (im.size[0] > TEX or im.size[1] > TEX):
            w = min(TEX, im.size[0])
            im.scale(w, max(1, int(round(im.size[1] * w / im.size[0]))))
        if im.size[0]:
            imgs.append(f'{im.name} {im.size[0]}x{im.size[1]}')
    rep['images'] = imgs

    if RENDER:
        render_views(obj, 'after', ship, L, ctr, cp)
        for nm in ('cam_', 'sun_'):
            o = bpy.data.objects.get(nm)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)

    step('export')
    if EXPORT:
        out = os.path.join(OUT_DIR, ship + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                                  export_texcoords=True, export_extras=False, export_lights=False,
                                  export_cameras=False, export_animations=False, use_selection=False)
        rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out)}
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(REPORT, ship + '_plain.json'), 'w') as fh:
        json.dump(rep, fh, indent=1)
    print('PLAIN', json.dumps(rep))


for s_ in SHIPS:
    process(s_)
print('PLAIN_DONE')
