# -*- coding: utf-8 -*-
"""
ship_symmetry.py — measure and fix left/right asymmetry in the AI-generated hulls.

    blender --background --python tools/blender/ship_symmetry.py -- [--in DIR] [--out DIR] [--ships a,b] [--fix] [--render]

Defaults: --in tools/blender/work/clean   --out tools/blender/work/sym   reports -> tools/blender/reports/symmetry

Diagnostic (always): finds the ship's true symmetry plane by search (a one-sided gun skews
the bounding box), then for every vertex measures the distance from its mirror image to
the real hull surface. Prints median / p90 / fraction of the hull that is off by more than
1% and 3% of the hull width, and (--render) paints the error as a heat map from four views.

--fix: SURFACE-AVERAGE symmetrization. For a vertex v with mirror image M(v), q = the
nearest hull point to M(v) is v's counterpart on the other side ; v moves to the average of
v and M(q), so both sides converge on the mean shape. Only vertices whose counterpart lies
within `thresh` (a few % of the width) move — deliberately one-sided features (a railgun,
a single gun boom) protrude further than that and are left alone. Three passes. Marker
pairs (gun1/gun2, thruster1/2 ...) are snapped to exact mirror positions ; single markers
stay. Custom split normals on moved vertices are reset to the (now symmetric) geometry.
The whole ship is then re-centred so the symmetry plane is the model's own centre plane.
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SHIPS_ALL = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


IN_DIR = os.path.join(REPO, opt('--in', 'tools/blender/work/clean'))
OUT_DIR = os.path.join(REPO, opt('--out', 'tools/blender/work/sym'))
REPORT_DIR = os.path.join(REPO, 'tools/blender/reports/symmetry')
SHIPS = opt('--ships', ','.join(SHIPS_ALL)).split(',')
FIX = '--fix' in argv
RENDER = '--render' in argv
PASSES = int(opt('--passes', '3'))
# How far apart (as a fraction of hull width) the two sides may be and still count as the
# SAME feature that wobbled. Anything further apart is treated as deliberately one-sided.
# PYRO keeps the default: its right pod is ~2x the left one - an obvious one-sided feature
# (owner's rule: those are design, not wobble). A 9% window half-moved the small pod
# toward the big one's mirror, which looked worse than either.
SYM_THRESH = {'default': 0.035}
# Vertices within this radius (fraction of width) of an UNPAIRED gun marker are never moved:
# that is the one-sided weapon itself (Puncture's railgun, Tracker's boom).
PROTECT_R = {'default': 0.16, 'pyro': 0.0}
THRESH_FRAC = float(opt('--thresh', '0'))          # >0 overrides SYM_THRESH
for d in (OUT_DIR, REPORT_DIR):
    os.makedirs(d, exist_ok=True)


def look_at(o, t):
    o.rotation_euler = (t - o.location).to_track_quat('-Z', 'Y').to_euler()


def load(ship):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(IN_DIR, ship + '.glb'), merge_vertices=True)
    sc = bpy.context.scene
    hull = [o for o in sc.objects if o.type == 'MESH'][0]
    empties = [o for o in sc.objects if o.type == 'EMPTY']
    for o in [hull] + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    hull.select_set(True)
    bpy.context.view_layer.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    markers = {}
    for o in empties:
        if any(o.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
            markers[o.name] = o
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    hull.name = 'mesh_0'
    return sc, hull, markers


def frame_of(hull, markers):
    bb = [Vector(c) for c in hull.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    ctr = (lo + hi) / 2
    # CANONICAL axes. All seven GLBs face -X in Blender space (the game applies the same
    # faceRotY to every hull, and the four mirror-perfect hulls confirm -X exactly). The
    # gun markers must NOT define forward: a single one-sided gun skews that axis by up to
    # 24 deg (Pyro) and every cockpit built in that frame was yawed by as much.
    fwd = Vector((-1, 0, 0))
    up = Vector((0, 0, 1))
    right = Vector((0, 1, 0))
    W = (hi - lo).y
    return ctr, fwd, right, up, lo, hi, W


def mirror_pts(P, c, n):
    """Mirror an (N,3) array across the plane through c with unit normal n."""
    d = (P - c) @ n
    return P - 2.0 * d[:, None] * n[None, :]


def nearest_dists(bvh, P):
    out = np.empty(len(P), np.float64)
    Q = np.empty_like(P)
    for i in range(len(P)):
        r = bvh.find_nearest(Vector(P[i]))
        out[i] = r[3] if r[0] is not None else 1e9
        Q[i] = r[0] if r[0] is not None else P[i]
    return out, Q


def find_plane(V, bvh, ctr, right, up, W, L):
    """Search offset (along right) and yaw (about up) for the plane with the smallest median
    mirror error on a vertex subsample."""
    rng = np.random.default_rng(1)
    sub = V[rng.choice(len(V), size=min(3000, len(V)), replace=False)]
    best = None
    c0 = np.array(ctr)
    # odd step counts so the grids contain 0 exactly ; refine tight around the coarse best
    for it, (offs, yaws) in enumerate(((np.linspace(-0.15, 0.15, 31) * W, np.radians(np.linspace(-2, 2, 9))),
                                       (None, None))):
        if it == 1:
            offs = best[1] + np.linspace(-0.01, 0.01, 9) * W
            yaws = best[2] + np.radians(np.linspace(-0.5, 0.5, 11))
        for o in offs:
            for y in yaws:
                Rm = Matrix.Rotation(float(y), 3, up)
                n = np.array(Rm @ right)
                c = c0 + n * o
                d, _ = nearest_dists(bvh, mirror_pts(sub, c, n))
                med = float(np.median(d))
                if best is None or med < best[0]:
                    best = (med, float(o), float(y), n, c)
    return best


def heat_material(me, err, scale):
    col = me.color_attributes.get('err') or me.color_attributes.new('err', 'FLOAT_COLOR', 'POINT')
    t = np.clip(err / scale, 0, 1)
    rgba = np.zeros((len(err), 4), np.float32)
    rgba[:, 0] = np.clip(t * 2, 0, 1)
    rgba[:, 1] = np.clip(1 - np.abs(t - 0.5) * 2, 0, 1) * 0.9
    rgba[:, 2] = np.clip(1 - t * 2, 0, 1)
    rgba[:, 3] = 1
    col.data.foreach_set('color', rgba.ravel())
    mat = bpy.data.materials.new('HEAT')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'err'
    nt.links.new(vc.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def render_views(sc, hull, ctr, fwd, right, up, L, tag, ship, eye=None):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 900
    sc.render.resolution_y = 675
    sc.eevee.taa_render_samples = 8
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.12, 0.12, 0.14, 1)
    cd = bpy.data.cameras.new('C')
    cd.lens = 40
    cd.clip_start = L * 0.002
    cd.clip_end = L * 60
    cam = bpy.data.objects.new('C', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    D = L * 1.25
    views = {'top': (ctr + up * D * 1.1 + fwd * D * 0.02, ctr, 40),
             'front': (ctr + fwd * D * 1.2 + up * D * 0.15, ctr, 40),
             'front34': (ctr + fwd * D * 0.8 + right * D * 0.6 + up * D * 0.45, ctr, 40)}
    if eye is not None:
        views['pilot'] = (eye, eye + fwd, 16)
    for vn, (loc, tgt, lens) in views.items():
        cd.lens = lens
        cam.location = loc
        look_at(cam, tgt)
        sc.render.filepath = os.path.join(REPORT_DIR, f'{ship}_{tag}_{vn}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def process(ship):
    t0 = time.time()
    sc, hull, markers = load(ship)
    me = hull.data
    ctr, fwd, right, up, lo, hi, W = frame_of(hull, markers)
    L = max(hi - lo)
    n_v = len(me.vertices)
    V = np.empty(n_v * 3, np.float64)
    me.vertices.foreach_get('co', V)
    V = V.reshape(-1, 3)
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm, epsilon=0.0)
    med, o, yaw, n, c = find_plane(V, bvh, ctr, right, up, W, L)
    err, Q = nearest_dists(bvh, mirror_pts(V, c, n))
    rep = {'ship': ship, 'width': round(W, 4), 'plane_offset_pctW': round(100 * o / W, 2), 'plane_yaw_deg': round(math.degrees(yaw), 2),
           'before': {'median_pctW': round(100 * float(np.median(err)) / W, 3), 'p90_pctW': round(100 * float(np.percentile(err, 90)) / W, 3),
                      'over1pct': round(100 * float((err > 0.01 * W).mean()), 1), 'over3pct': round(100 * float((err > 0.03 * W).mean()), 1)}}
    eye = markers['cockpit1'].matrix_world.translation.copy() if 'cockpit1' in markers else None
    if RENDER:
        hm = heat_material(me, err, 0.03 * W)
        saved = list(me.materials)
        for i in range(len(me.materials)):
            me.materials[i] = hm
        render_views(sc, hull, ctr, fwd, right, up, L, 'before', ship, eye)
        for i, m in enumerate(saved):
            me.materials[i] = m
    bm.free()

    if FIX:
        thresh = (THRESH_FRAC if THRESH_FRAC > 0 else SYM_THRESH.get(ship, SYM_THRESH['default'])) * W
        # protect the one-sided weapon around any UNPAIRED gun marker
        protect = np.zeros(n_v, bool)
        pr = PROTECT_R.get(ship, PROTECT_R['default']) * W
        gun_names = [k for k in markers if k.startswith('gun')]
        if len(gun_names) == 1 and pr > 0:
            g = np.array(markers[gun_names[0]].matrix_world.translation)
            protect = np.linalg.norm(V - g, axis=1) < pr
        moved_total = np.zeros(n_v, bool)
        for p in range(PASSES):
            bm = bmesh.new()
            bm.from_mesh(me)
            bvh = BVHTree.FromBMesh(bm, epsilon=0.0)
            bm.free()
            me.vertices.foreach_get('co', V.reshape(-1))
            Mv = mirror_pts(V, c, n)
            d, Q = nearest_dists(bvh, Mv)
            move = (d < thresh) & ~protect
            target = (V + mirror_pts(Q, c, n)) * 0.5
            Vn = np.where(move[:, None], target, V)
            me.vertices.foreach_set('co', Vn.reshape(-1))
            me.update()
            moved_total |= move & (np.linalg.norm(Vn - V, axis=1) > 1e-6 * W)
            V = Vn
        rep['protected_verts_pct'] = round(100 * float(protect.mean()), 1)
        # markers: pairs snap to exact mirrors, singles stay
        pairs = [('gun1', 'gun2'), ('thruster1', 'thruster2'), ('thruster3', 'thruster4')]
        for a, b in pairs:
            if a in markers and b in markers:
                pa = np.array(markers[a].matrix_world.translation)
                pb = np.array(markers[b].matrix_world.translation)
                avg = (pa + mirror_pts(pb[None, :], c, n)[0]) * 0.5
                markers[a].location = Vector(avg)
                markers[b].location = Vector(mirror_pts(avg[None, :], c, n)[0])
        if 'cockpit1' in markers:
            pc = np.array(markers['cockpit1'].matrix_world.translation)
            markers['cockpit1'].location = Vector((pc + mirror_pts(pc[None, :], c, n)[0]) * 0.5)
        # Custom split normals are deliberately KEPT on moved vertices: a few degrees stale
        # on a surface that moved 1-3% of the width is invisible, whereas resetting them to
        # the all-smooth-flagged geometry turns every panel crease in that region to mush.
        # re-centre: symmetry plane -> the model's own centre plane (translate by -offset,
        # rotate by -yaw about up around the centre), markers included
        T = Matrix.Translation(Vector(ctr)) @ Matrix.Rotation(-yaw, 4, up) @ Matrix.Translation(-Vector(ctr) - Vector(n) * o)
        hull.matrix_world = T @ hull.matrix_world
        for o_ in markers.values():
            o_.matrix_world = T @ o_.matrix_world
        bpy.ops.object.select_all(action='DESELECT')
        hull.select_set(True)
        bpy.context.view_layer.objects.active = hull
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # measure again against the centred plane
        me.vertices.foreach_get('co', V.reshape(-1))
        bm = bmesh.new()
        bm.from_mesh(me)
        bvh = BVHTree.FromBMesh(bm, epsilon=0.0)
        n2 = np.array(right)
        c2 = np.array(ctr)
        err2, _ = nearest_dists(bvh, mirror_pts(V, c2, n2))
        bm.free()
        rep['after'] = {'median_pctW': round(100 * float(np.median(err2)) / W, 3), 'p90_pctW': round(100 * float(np.percentile(err2, 90)) / W, 3),
                        'over1pct': round(100 * float((err2 > 0.01 * W).mean()), 1), 'over3pct': round(100 * float((err2 > 0.03 * W).mean()), 1),
                        'moved_verts_pct': round(100 * float(moved_total.mean()), 1), 'thresh_pctW': round(100 * thresh / W, 1)}
        if RENDER:
            hm = heat_material(me, err2, 0.03 * W)
            saved = list(me.materials)
            for i in range(len(me.materials)):
                me.materials[i] = hm
            eye2 = markers['cockpit1'].matrix_world.translation.copy() if 'cockpit1' in markers else None
            render_views(sc, hull, Vector(c2), fwd, right, up, L, 'after', ship, eye2)
            for i, m in enumerate(saved):
                me.materials[i] = m
        out = os.path.join(OUT_DIR, ship + '.glb')
        for o_ in list(sc.objects):
            if o_.type in ('CAMERA', 'LIGHT'):
                bpy.data.objects.remove(o_, do_unlink=True)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                                  export_texcoords=True, export_extras=False, export_lights=False,
                                  export_cameras=False, export_animations=False, use_selection=False)
        rep['export'] = os.path.relpath(out, REPO)
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(REPORT_DIR, ship + '_symmetry.json'), 'w') as fh:
        json.dump(rep, fh, indent=1)
    print('SYMMETRY', json.dumps(rep))


for s in SHIPS:
    process(s)
print('SYMMETRY_DONE')
