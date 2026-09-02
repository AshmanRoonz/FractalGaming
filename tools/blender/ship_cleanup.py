# -*- coding: utf-8 -*-
"""
ship_cleanup.py — stage-1 hull cleanup for the seven LSS ship GLBs, headless Blender 4.1.

Run from the REPO ROOT:

    "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background \
        --python tools/blender/ship_cleanup.py -- [--in DIR] [--out DIR] [--report DIR] [--ships a,b] [--render]

Defaults:  --in assets_base/ships   --out tools/blender/work/clean   --report tools/blender/reports

Per ship:
  1. import (merge_vertices) and flatten the node hierarchy ; the gun*/thruster*/cockpit*
     marker empties are kept as root nodes at their world positions (the game reads gun*
     and thruster* by name — losing them fails silently).
  2. DEBRIS   loose parts that sit entirely INSIDE the main hull (never visible) or are tiny
     slivers -> deleted.  Small parts that are visible (antennas, barrels) are kept and listed.
  3. INVERTED faces whose front side points INTO the solid hull -> flipped.  In-game ship
     materials are rebuilt WITHOUT `side`, i.e. FrontSide, so every inverted face was a hole
     in combat (the ship-select stage clones the DoubleSide GLB material and hid the problem).
  4. CRACKS   small boundary loops (<= 12 edges and < 1.5% of hull length) -> filled.  Large
     openings (nozzles, vents) are intentional and left alone.
  5. export GLB (float32, unquantized) -> --out.  Then:  node tools/compress_glb.mjs
     (weld + quantize, simplify is OFF for ships) writes the shipped file into LSS/ships/.

All destructive edits go through edit-mode operators, which keep the GLB's custom split
normals (a bmesh reverse_faces would leave the stored normals pointing the old way).
Inside/outside decisions use a parity ray-cast vote against a BVH of the main hull.
"""
import bpy
import bmesh
import json
import math
import os
import struct
import sys
import time

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SHIPS_ALL = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']

# ------------------------------------------------------------------ args --
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


IN_DIR = os.path.join(REPO, opt('--in', 'assets_base/ships'))
OUT_DIR = os.path.join(REPO, opt('--out', 'tools/blender/work/clean'))
REPORT_DIR = os.path.join(REPO, opt('--report', 'tools/blender/reports'))
SHIPS = opt('--ships', ','.join(SHIPS_ALL)).split(',')
RENDER = '--render' in argv
# Inverted-face flipping is OPT-IN. verify_culled.py showed the faces the parity vote flags
# are buried plates inside the hull: flipping them fixed 0 see-through pixels from six
# vantages and created 0, so it is a no-op with unmeasured risk. The analysis still runs
# and is reported ; pass --flip-inverted to actually flip.
FLIP_INVERTED = '--flip-inverted' in argv
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

DIRS = [Vector(v) for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
                            (0.577, 0.577, 0.577), (-0.577, -0.577, 0.577))]


# --------------------------------------------------------------- helpers --
def fresh_bm(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return bm


def components(bm):
    """Connected components by shared vertices ; list of vert-index lists, largest first."""
    seen = np.zeros(len(bm.verts), bool)
    comps = []
    for v in bm.verts:
        if seen[v.index]:
            continue
        stack = [v]
        comp = []
        while stack:
            x = stack.pop()
            if seen[x.index]:
                continue
            seen[x.index] = True
            comp.append(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if not seen[y.index]:
                    stack.append(y)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def bvh_of(bm, vert_set):
    """BVH of the faces whose vertices all lie in vert_set (the main hull)."""
    verts = [v.co.copy() for v in bm.verts]
    polys = [[v.index for v in f.verts] for f in bm.faces if all(v.index in vert_set for v in f.verts)]
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def inside_votes(bvh, p, eps):
    """How many of the DIRS rays cross the hull an odd number of times (=> p is inside)."""
    odd = 0
    for d in DIRS:
        n = 0
        o = p.copy()
        for _ in range(128):
            loc = bvh.ray_cast(o, d)[0]
            if loc is None:
                break
            n += 1
            o = loc + d * eps
        odd += n & 1
    return odd


def boundary_loops(bm):
    """Chain boundary edges into loops ; returns list of dicts."""
    b_edges = [e for e in bm.edges if e.is_boundary]
    v_edges = {}
    for e in b_edges:
        for v in e.verts:
            v_edges.setdefault(v.index, []).append(e)
    seen = set()
    loops = []
    for e0 in b_edges:
        if e0.index in seen:
            continue
        chain = [e0]
        seen.add(e0.index)
        clean = True
        # walk both directions from e0
        for start_v in e0.verts:
            v = start_v
            e = e0
            while True:
                nxt = [x for x in v_edges.get(v.index, []) if x is not e and x.index not in seen]
                if len(v_edges.get(v.index, [])) != 2:
                    clean = False
                    break
                if not nxt:
                    break
                e = nxt[0]
                seen.add(e.index)
                chain.append(e)
                v = e.other_vert(v)
                if v is start_v:
                    break
        vs = {v for e in chain for v in e.verts}
        closed = clean and all(len(v_edges.get(v.index, [])) == 2 for v in vs) and len(vs) == len(chain)
        cos = np.array([v.co[:] for v in vs])
        diag = float(np.linalg.norm(cos.max(0) - cos.min(0))) if len(cos) else 0.0
        loops.append({'edges': [e.index for e in chain], 'n': len(chain), 'diag': diag, 'closed': closed,
                      'center': [round(float(x), 4) for x in cos.mean(0)] if len(cos) else None})
    return loops


def set_select_mode(mode):
    ts = bpy.context.tool_settings
    ts.mesh_select_mode = (mode == 'VERT', mode == 'EDGE', mode == 'FACE')


def clear_selection(me):
    for coll in (me.vertices, me.edges, me.polygons):
        coll.foreach_set('select', np.zeros(len(coll), bool))


def edit_op(obj, fn):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    try:
        fn()
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')


def normal_deviation(me):
    """Histogram fingerprint of custom-vs-smooth normal angles (to prove edits kept the normals)."""
    n = len(me.loops)
    cn = np.empty(n * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    vn = np.empty(len(me.vertices) * 3, np.float32)
    me.vertex_normals.foreach_get('vector', vn)
    li = np.empty(n, np.int32)
    me.loops.foreach_get('vertex_index', li)
    dot = np.clip((cn.reshape(-1, 3) * vn.reshape(-1, 3)[li]).sum(1), -1, 1)
    ang = np.degrees(np.arccos(dot))
    return {'mean_deg': round(float(ang.mean()), 2), 'p95_deg': round(float(np.percentile(ang, 95)), 2),
            'over20_pct': round(float(100 * (ang > 20).mean()), 2)}


def glb_image_bytes(path):
    with open(path, 'rb') as fh:
        _magic, _ver, _length = struct.unpack('<III', fh.read(12))
        clen, _ctype = struct.unpack('<II', fh.read(8))
        js = json.loads(fh.read(clen))
        blen, _btype = struct.unpack('<II', fh.read(8))
        bin_ = fh.read(blen)
    out = []
    for img in js.get('images', []):
        bv = js['bufferViews'][img['bufferView']]
        off = bv.get('byteOffset', 0)
        out.append(bin_[off:off + bv['byteLength']])
    return js, out


# ---------------------------------------------------------------- render --
def setup_render(sc, ctr, rad):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 800
    sc.render.resolution_y = 600
    sc.eevee.taa_render_samples = 16
    sc.view_settings.view_transform = 'Filmic'
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.07, 0.08, 0.11, 1)

    def look_at(o, t):
        o.rotation_euler = (t - o.location).to_track_quat('-Z', 'Y').to_euler()

    def light(kind, loc, energy, color=(1, 1, 1), size=None):
        ld = bpy.data.lights.new('L', kind)
        ld.energy = energy
        ld.color = color
        if size and kind == 'AREA':
            ld.size = size
        o = bpy.data.objects.new('L', ld)
        o.location = ctr + loc
        sc.collection.objects.link(o)
        look_at(o, ctr)
    light('SUN', Vector((rad * 2, -rad * 2, rad * 3)), 3.0, (0.85, 0.9, 1.0))
    light('AREA', Vector((-rad * 2, rad * 1.5, -rad * 0.5)), rad * rad * 40, (1.0, 0.75, 0.5), size=rad * 2)
    light('AREA', Vector((0, rad * 2.5, rad * 1.5)), rad * rad * 20, (1.0, 0.85, 0.6), size=rad * 2)
    cd = bpy.data.cameras.new('C')
    cd.lens = 40
    cd.clip_start = rad * 0.002
    cd.clip_end = rad * 60
    cam = bpy.data.objects.new('C', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam, look_at


def shots(sc, cam, look_at, ctr, fwd, right, up, L, tag, name):
    D = L * 1.3
    for vn, loc in {'front34': ctr + fwd * D * 0.8 + right * D * 0.6 + up * D * 0.45,
                    'rear34': ctr - fwd * D * 0.8 - right * D * 0.6 + up * D * 0.45,
                    'below': ctr + fwd * D * 0.7 - right * D * 0.5 - up * D * 0.5}.items():
        cam.location = loc
        look_at(cam, ctr)
        sc.render.filepath = os.path.join(REPORT_DIR, f'{name}_{tag}_{vn}.png')
        bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------- process --
def process(name):
    t0 = time.time()
    rep = {'ship': name}
    src = os.path.join(IN_DIR, name + '.glb')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
    sc = bpy.context.scene
    vl = bpy.context.view_layer
    hull = [o for o in sc.objects if o.type == 'MESH'][0]
    empties = [o for o in sc.objects if o.type == 'EMPTY']
    for o in [hull] + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    hull.select_set(True)
    vl.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    markers = {}
    for o in empties:
        if any(o.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
            markers[o.name] = o
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    rep['markers'] = {k: [round(float(x), 4) for x in v.matrix_world.translation] for k, v in markers.items()}
    hull.name = 'mesh_0'
    me = hull.data
    bb = [Vector(c) for c in hull.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    L = max(hi - lo)
    ctr = (lo + hi) / 2
    guns = [v.matrix_world.translation for k, v in markers.items() if k.startswith('gun')]
    thr = [v.matrix_world.translation for k, v in markers.items() if k.startswith('thruster')]
    fwd = Vector((-1, 0, 0))
    if guns and thr:
        fwd = sum(guns, Vector()) / len(guns) - sum(thr, Vector()) / len(thr)
        fwd.z = 0
        fwd.normalize()
    up = Vector((0, 0, 1))
    right = fwd.cross(up).normalized()
    eps = L * 1e-4
    rep['before'] = {'verts': len(me.vertices), 'faces': len(me.polygons), 'custom_normals': me.has_custom_normals,
                     'normal_fingerprint': normal_deviation(me)}

    cam = look_at = None
    if RENDER:
        cam, look_at = setup_render(sc, ctr, L / 2)
        shots(sc, cam, look_at, ctr, fwd, right, up, L, 'before', name)

    # ---- pass A: loose-part analysis --------------------------------------------------
    bm = fresh_bm(me)
    comps = components(bm)
    main = set(comps[0])
    bvh = bvh_of(bm, main)
    parts = []
    del_verts = np.zeros(len(me.vertices), bool)
    for comp in comps[1:]:
        cos = np.array([bm.verts[i].co[:] for i in comp])
        diag = float(np.linalg.norm(cos.max(0) - cos.min(0)))
        cen = Vector(cos.mean(0))
        sample = [cen] + [bm.verts[i].co for i in comp[::max(1, len(comp) // 8)][:8]]
        votes = [inside_votes(bvh, p, eps) for p in sample]
        inside = all(v >= len(DIRS) * 0.6 for v in votes)
        tiny = len(comp) < 12 or diag < 0.004 * L
        verdict = 'delete:inside' if inside else ('delete:sliver' if tiny else 'keep')
        parts.append({'verts': len(comp), 'diag_pct': round(100 * diag / L, 2), 'center': [round(float(x), 3) for x in cen],
                      'inside_votes': votes[0], 'verdict': verdict})
        if verdict != 'keep':
            del_verts[comp] = True
    rep['loose_parts'] = parts
    rep['debris_deleted'] = {'parts': sum(1 for p in parts if p['verdict'] != 'keep'), 'verts': int(del_verts.sum())}

    # ---- pass B: inverted faces of the main hull ------------------------------------------
    inv = np.zeros(len(me.polygons), bool)
    weak = 0
    for f in bm.faces:
        if not all(v.index in main for v in f.verts):
            continue
        n = f.normal
        if n.length < 0.5:
            continue
        votes = inside_votes(bvh, f.calc_center_median() + n * eps, eps)
        if votes >= len(DIRS) - 1:
            inv[f.index] = True
        elif votes >= len(DIRS) * 0.5:
            weak += 1
    rep['inverted_faces'] = {'flipped': int(inv.sum()), 'ambiguous_left_alone': weak}

    # ---- pass C: boundary loops (cracks) ---------------------------------------------------
    loops = boundary_loops(bm)
    fill_edges = np.zeros(len(me.edges), bool)
    fill_n = 0
    for lp in loops:
        if lp['closed'] and lp['n'] <= 12 and lp['diag'] < 0.015 * L:
            fill_edges[lp['edges']] = True
            fill_n += 1
    rep['boundary_loops'] = {'total': len(loops), 'filled': fill_n,
                             'left_open': sorted([{'n': lp['n'], 'diag_pct': round(100 * lp['diag'] / L, 2), 'center': lp['center']}
                                                  for lp in loops if not (lp['closed'] and lp['n'] <= 12 and lp['diag'] < 0.015 * L)],
                                                 key=lambda d: -d['diag_pct'])[:12]}
    bm.free()

    # ---- debug render of the flags ---------------------------------------------------------
    if RENDER:
        dbg = []
        for nm, col in (('DBG_inverted', (1, 0.05, 0.05, 1)), ('DBG_debris', (0.1, 1, 0.1, 1)), ('DBG_keptsmall', (0.2, 0.4, 1, 1))):
            m = bpy.data.materials.new(nm)
            m.use_nodes = True
            b = m.node_tree.nodes['Principled BSDF']
            b.inputs['Base Color'].default_value = col
            b.inputs['Emission Color'].default_value = col
            b.inputs['Emission Strength'].default_value = 2.0
            me.materials.append(m)
            dbg.append(m)
        base_n = len(me.materials) - 3
        mi = np.zeros(len(me.polygons), np.int32)
        mi[inv] = base_n
        vsel = del_verts
        pv = np.empty(sum(len(p.vertices) for p in me.polygons), np.int32)
        me.polygons.foreach_get('vertices', pv)
        ls = np.empty(len(me.polygons), np.int32)
        me.polygons.foreach_get('loop_start', ls)
        first_v = pv[ls]
        mi[vsel[first_v]] = base_n + 1
        keep_small = np.zeros(len(me.vertices), bool)
        for comp, p in zip(comps[1:], parts):
            if p['verdict'] == 'keep':
                keep_small[comp] = True
        mi[keep_small[first_v]] = base_n + 2
        me.polygons.foreach_set('material_index', mi)
        shots(sc, cam, look_at, ctr, fwd, right, up, L, 'flags', name)
        me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
        for _ in range(3):
            me.materials.pop(index=len(me.materials) - 1)

    # ---- edits (edit-mode operators keep custom normals) --------------------------------------
    if del_verts.any():
        set_select_mode('VERT')
        clear_selection(me)
        me.vertices.foreach_set('select', del_verts)
        edit_op(hull, lambda: bpy.ops.mesh.delete(type='VERT'))
    rep['inverted_faces']['flipped'] = int(inv.sum()) if FLIP_INVERTED else 0
    rep['inverted_faces']['detected'] = int(inv.sum())
    if inv.any() and FLIP_INVERTED:
        set_select_mode('FACE')
        clear_selection(me)
        if rep['debris_deleted']['verts'] == 0:
            me.polygons.foreach_set('select', inv)
        else:
            # Blender renumbered faces after the vertex delete ; re-run the vote on the new mesh.
            bm2 = fresh_bm(me)
            sel = np.zeros(len(me.polygons), bool)
            main2 = set(components(bm2)[0])
            bvh2 = bvh_of(bm2, main2)
            for f in bm2.faces:
                if not all(v.index in main2 for v in f.verts) or f.normal.length < 0.5:
                    continue
                if inside_votes(bvh2, f.calc_center_median() + f.normal * eps, eps) >= len(DIRS) - 1:
                    sel[f.index] = True
            bm2.free()
            me.polygons.foreach_set('select', sel)
            rep['inverted_faces']['flipped'] = int(sel.sum())
        edit_op(hull, lambda: bpy.ops.mesh.flip_normals())
    if fill_edges.any():
        set_select_mode('EDGE')
        clear_selection(me)
        bm3 = fresh_bm(me)
        loops3 = boundary_loops(bm3)
        sel_e = np.zeros(len(me.edges), bool)
        for lp in loops3:
            if lp['closed'] and lp['n'] <= 12 and lp['diag'] < 0.015 * L:
                sel_e[lp['edges']] = True
        bm3.free()
        me.edges.foreach_set('select', sel_e)
        edit_op(hull, lambda: bpy.ops.mesh.fill_holes(sides=16))
    me.update()
    rep['after'] = {'verts': len(me.vertices), 'faces': len(me.polygons), 'custom_normals': me.has_custom_normals,
                    'normal_fingerprint': normal_deviation(me)}
    bm4 = fresh_bm(me)
    comps4 = components(bm4)
    rep['after']['loose_parts'] = len(comps4)
    rep['after']['boundary_edges'] = sum(1 for e in bm4.edges if e.is_boundary)
    rep['after']['non_manifold_edges'] = sum(1 for e in bm4.edges if not e.is_manifold)
    bm4.free()

    if RENDER:
        shots(sc, cam, look_at, ctr, fwd, right, up, L, 'after', name)
        for o in [cam] + [o for o in sc.objects if o.type == 'LIGHT']:
            bpy.data.objects.remove(o, do_unlink=True)

    # ---- export ------------------------------------------------------------------------------
    out = os.path.join(OUT_DIR, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                              export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                              export_texcoords=True, export_extras=False, export_lights=False,
                              export_cameras=False, export_animations=False, use_selection=False)
    js_in, img_in = glb_image_bytes(src)
    js_out, img_out = glb_image_bytes(out)
    rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out),
                     'nodes': [n.get('name') for n in js_out['nodes']],
                     'texture_bytes_identical': bool(img_in and img_out and img_in[0] == img_out[0]),
                     'texture_bytes': [len(b) for b in img_out]}
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(REPORT_DIR, name + '_cleanup.json'), 'w') as fh:
        json.dump(rep, fh, indent=1)
    print('CLEANUP', json.dumps({k: rep[k] for k in ('ship', 'before', 'debris_deleted', 'inverted_faces', 'boundary_loops', 'after', 'export', 'seconds')}))


for s in SHIPS:
    process(s)
print('CLEANUP_DONE')
