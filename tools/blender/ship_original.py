"""ship_original.py - the ORIGINAL hi-poly exports (LSS/ships_original/<Ship>.glb) into game hulls.

Owner (2026-09-02): "the interiors seem to be intact, but the windows need to be transparent...
most of the symmetry is good, so just add some floating dashboards and other interior cockpit
design" ; "the originals aren't marked for the engines and weapons... but they are similar
shape, so we can transfer that over".

Chain:  LSS/ships_original  ->  THIS  ->  assets_src/ships  ->  node tools/compress_glb.mjs --only ships
No ship_cleanup / ship_symmetry on these (thousands of overlapping shells ; the owner judged the
symmetry good). orig_peek.py verified the originals sit in the SAME frame and scale as the
frozen v37.23 hulls (dims + centres agree to 1e-4), so the markers transfer at identical coords.

Per ship:
  1. import, apply transforms
  2. markers (gun* / thruster* / cockpit1) copied from assets_base/ships/<ship>.glb
  3. canopy paint -> `canopy_glass` (saturated class-hue faces near the cockpit marker, any normal:
     the AI canopy is a shell with an inner surface that must go too)
  4. eye = inside the pit under the glass: downward rays through the glass find the pit floor,
     seated eye height above it ; cockpit1 moved there
  5. hull material double-sided (the inner skin IS the interior the owner saw) + hull-light
     emissive from the paint (same mask as ship_cockpit.py's HULL LIGHTS)
  6. floating dashboard = the painted frame art strips (build_frame_billboard, v37.39) + two
     holographic side panels (`cockpit_holo`, translucent, self-lit) + a seat when the pit is deep
  7. decimate to a game budget: shells near the cockpit lightly, the rest to fill the budget
  8. export

Usage: blender --background --python tools/blender/ship_original.py -- [--ships pyro,vortex]
       [--render] [--target 150000] [--out assets_src/ships] [--no-export]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# The generator's top half (knobs, atlas, Builder, frame-art billboard, helpers) is the library ;
# executing the source up to `def process(` keeps ONE copy of the frame strips and atlas code.
_SRC = open(os.path.join(HERE, 'ship_cockpit.py'), encoding='utf-8').read()
exec(compile(_SRC[:_SRC.index('\ndef process(ship):')], os.path.join(HERE, 'ship_cockpit.py'), 'exec'))

import bpy  # noqa: E402  (already imported by the library ; explicit for readers)
import json
import math
import time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ORIG_DIR = os.path.join(REPO, opt('--orig', 'LSS/ships_original'))   # --orig assets_base/ships_clean = the remeshed hulls (ship_remesh.py)
FROZEN_DIR = os.path.join(REPO, 'assets_base', 'ships')
REPORT_DIR = os.path.join(REPO, 'tools', 'blender', 'reports', 'original')
os.makedirs(REPORT_DIR, exist_ok=True)
TARGET_TRIS = int(opt('--target', '150000'))   # whole-hull triangle budget after decimation
NEAR_R = 0.35          # of L: shells within this radius of the eye decimate lightly
NEAR_RATIO = 0.5
NEAR_SHARE = 0.6       # of TARGET_TRIS: cap on what the near shells may keep
FAR_RATIO_MIN = 0.06
EYE_UNDER = (0.04, 0.10)   # of L: eye candidates this far under the canopy top (scan range ; the shell's inner layer is within 0.03)
EYE_SCAN_X = (0.15, 0.85)  # fraction of the canopy length (front -> back) scanned for the eye
DARK_FILL = 0.20           # panes painted darker than this may join the glass (when surrounded by it)
GROW_R = 0.03              # of L: neighbourhood radius of the surrounded-growth
SURROUND_F = 0.35          # a candidate joins when its glass neighbours' mean sits within this fraction of GROW_R
SURROUND_N = 8             # ... and there are at least this many glass faces in its 27-cell block
SHELL_VOTE_IN = 0.5        # a loose part with at least this fraction of glass faces becomes glass whole
SHELL_VOTE_OUT = 0.12      # ... with less than this loses its stray glass faces
SHELL_VOTE_MAX = 20000     # parts bigger than this (a fuselage holding the canopy) keep the face-level result
ADJ_R = 0.012              # of L: a tinted (seed) face touching glass this closely joins outright
REF_DIR = os.path.join(REPO, 'tools', 'blender', 'work', 'ref')   # old-chain hulls (LSS/ships at v37.39/40) = the canopy reference
REF_TOL = 0.007            # of L: an original face this close to the reference glass surface IS canopy
MARKS_DIR = os.path.join(REPO, 'tools', 'blender', 'marks')   # <ship>_glass.json painted in tools/glb_editor.html (owner's marks win)
MARK_TOL = 0.004           # of L: a painted centroid must land this close to a face centre
INTERIOR = '--interior' in argv   # the procedural cabin (tub, panel, sills, seat, arches) is OPT-IN since v37.59 - owner: 'starting fresh, with just the glass installed'
REF_COMMIT = '5491ffb'     # v37.39: the last old-chain fleet in git (LSS/ships/<ship>.glb) - the reference is re-fetched from here when work/ref is empty
ISLAND_MAX = 1500          # loose shells up to this many faces, lying wholly in the glass fringe, become glass (Puncture's dark decal is ~1000)
GLASS_CFG = {
    'default': {'R': 0.18, 'sat': 0.30, 'val': 0.10, 'hue_tol': 0.10, 'min_comp': 20, 'z_below': 0.06},
    'pyro': {'R': 0.22, 'sat': 0.28, 'hue_tol': 0.12},
    'slayer': {'sat': 0.25, 'hue_tol': 0.22},      # its pane streaks are yellow-green, not the class green (see HULL_GLOW)
}
HOLO_ALPHA = 0.22          # the HUD combiner glass: barely there
# The library's interior atlas bakes an emissive FILL of EMIS_FILL x the base tile (1.5, tuned for the
# old enclosed tub with no light at all). Under a clear canopy the sun comes in and the cockpit light
# rig rides the eye, so at 1.5 (x1.5 emission strength) the tub walls glowed a flat pale grey that no
# light setting could change. Override for this chain:
EMIS_FILL = 0.35
# Owner (v37.42): "i dont think merging the png dashboards with the glbs is working" - the painted
# overlay and the 3D cabin are two visual languages. No frame-art band in the model ; the
# cockpit is fully 3D (instrument panel, glare shield, rim rail).
FRAME_ART = False
TUB_SHRINK = 0.92          # tub rim = this fraction of the canopy outline (polar profile of the glass)
TUB_DEPTH = 0.42           # of Lc: tub floor below the eye (a seated pilot ; the AI pit is often the whole hull)


def _hue_of(c):
    r, g, b = c
    mx, mn = max(c), min(c)
    d = max(mx - mn, 1e-6)
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h / 6.0


def face_paint(me, px):
    """Per-face texture colour at the face's mean UV -> (mx, sat, hue)."""
    H, W = px.shape[:2]
    nP = len(me.polygons)
    ls = np.empty(nP, np.int32)
    lt = np.empty(nP, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    me.polygons.foreach_get('loop_total', lt)
    uvs = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    cum = np.cumsum(uvs, axis=0, dtype=np.float64)
    cs = np.concatenate([[0.0], cum[:, 0]])
    ct = np.concatenate([[0.0], cum[:, 1]])
    fu = (cs[ls + lt] - cs[ls]) / lt
    fv = (ct[ls + lt] - ct[ls]) / lt
    ix = (np.mod(fu, 1.0) * W).astype(int).clip(0, W - 1)
    iy = (np.mod(fv, 1.0) * H).astype(int).clip(0, H - 1)
    col = px[iy, ix, :3]
    mx = col.max(1)
    mn = col.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r_, g_, b_ = col[:, 0], col[:, 1], col[:, 2]
    dlt = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r_, ((g_ - b_) / dlt) % 6, np.where(mx == g_, (b_ - r_) / dlt + 2, (r_ - g_) / dlt + 4)) / 6.0
    return mx, sat, hue


def cyl(B, p0, p1, r, region, n=10):
    """a capped cylinder from p0 to p1 (local points) via the Builder's loft"""
    p0 = Vector(p0)
    p1 = Vector(p1)
    ax = (p1 - p0)
    if ax.length < 1e-9:
        return []
    ax.normalize()
    ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    u = ax.cross(ref).normalized()
    v = ax.cross(u).normalized()
    rings = []
    for pc in (p0, p1):
        rings.append([pc + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r for k in range(n)])
    faces, vr = B.loft(rings, region=region, inward_center=None, smooth=True)
    mid = (p0 + p1) / 2
    for f in faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - B.to_world(mid)) < 0:
            f.normal_flip()
    for vring, sign in ((vr[0], -1), (vr[1], 1)):
        try:
            cap = B.bm.faces.new(vring)
            cap.normal_update()
            if cap.normal.dot(B.frame.to_3x3() @ (ax * sign)) < 0:
                cap.normal_flip()
            B.tag([cap], region)
            faces.append(cap)
        except ValueError:
            pass
    return faces


def tube(B, pts, r, region, n=8, closed=False):
    """a smooth tube along a polyline of local points (rings perpendicular to the local tangent)"""
    pts = [Vector(p) for p in pts]
    if closed:
        pts = pts + [pts[0]]
    if len(pts) < 2:
        return []
    rings = []
    up = Vector((0, 0, 1))
    for i, pc in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        if t.length < 1e-9:
            t = Vector((1, 0, 0))
        t.normalize()
        ref = up if abs(t.dot(up)) < 0.9 else Vector((1, 0, 0))
        u = t.cross(ref).normalized()
        v = t.cross(u).normalized()
        rings.append([pc + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r for k in range(n)])
    faces, vr = B.loft(rings, region=region, inward_center=None, smooth=True)
    for idx, f in enumerate(faces):
        i = idx // n
        c = B.to_world((pts[i] + pts[min(i + 1, len(pts) - 1)]) / 2)
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - c) < 0:
            f.normal_flip()
    return faces


def import_glb(path, **kw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, **kw)
    new = [o for o in bpy.data.objects if o not in before]
    return [o for o in new if o.type == 'MESH'], [o for o in new if o.type == 'EMPTY']


def load_marks(ship):
    """The owner's painted glass from tools/glb_editor.html: face centroids in glTF local space
    (three.js) -> Blender (x, -z, y). None when no file exists."""
    path = os.path.join(MARKS_DIR, f'{ship}_glass.json')
    if not os.path.exists(path):
        return None
    j = json.load(open(path, encoding='utf-8'))
    c = np.array(j.get('centroids', []), np.float32)
    if len(c) == 0:
        return None
    cen_b = np.stack([c[:, 0], -c[:, 2], c[:, 1]], 1)
    mk = j.get('markers', {}) or {}
    eye = None
    if mk.get('cockpit'):
        e = mk['cockpit'][0]
        eye = Vector((e[0], -e[2], e[1]))
    g2b = lambda q: Vector((q[0], -q[2], q[1]))
    # optional tools/blender/marks/<ship>_adjust.json: {"level_bottom": true | <z>} makes the glass's
    # lower edge a LEVEL line (a horizontal cut plane at the lowest outline point, or at z)
    adj_path = os.path.join(MARKS_DIR, f'{ship}_adjust.json')
    adjust = json.load(open(adj_path, encoding='utf-8')) if os.path.exists(adj_path) else {}
    markers = {}
    for kind in ('gun', 'thruster', 'cockpit'):
        if mk.get(kind):
            markers[kind] = [g2b(q) for q in mk[kind]]
    fills = []
    for op in j.get('fills', []) or []:
        pts = [g2b(q) for q in op.get('points', [])]
        if len(pts) < 3:
            continue
        cam = g2b(op['cam'])
        mirror = op.get('mirror')
        if mirror:
            # glTF z -> Blender y ; glTF x -> Blender x ; glTF y -> Blender z
            ax = {'z': 1, 'x': 0, 'y': 2}.get(mirror, 1)
            # an outline drawn up to the centreline meets its mirror there: the edge plane through
            # the camera and its mirrored plane make a thin wedge neither polygon covers (a jagged
            # crack down the Pyro's pane). Nudge points near the mirror plane 2% of the model
            # across it, so the two halves overlap instead of touching.
            ext = max(abs(c[ax]) for c in pts) if pts else 1.0
            span = 2.0 * max(ext, 1e-6)
            side = 1.0 if sum(q[ax] for q in pts) >= 0 else -1.0
            pts = [Vector([(q[i] if i != ax else (q[i] if abs(q[i]) > 0.02 * span else -side * 0.02 * span)) for i in range(3)]) for q in pts]
        level_z = None
        lb = adjust.get('level_bottom')
        if lb is not None and lb is not False:
            zs = [q.z for q in pts]
            level_z = float(lb) if not isinstance(lb, bool) else min(zs)
            zr = max(zs) - min(zs)
            # points near the bottom drop well below the level so the polygon covers it ; the
            # horizontal cut and the z >= level test then draw the lower edge
            pts = [Vector((q.x, q.y, (level_z - 0.5 * zr) if q.z < level_z + 0.35 * zr else q.z)) for q in pts]
        fills.append({'cam': cam, 'points': pts, 'erase': bool(op.get('erase')), 'level_z': level_z})
        if mirror:
            mv = lambda v: Vector([(-v[i] if i == ax else v[i]) for i in range(3)])
            fills.append({'cam': mv(cam), 'points': [mv(q) for q in pts], 'erase': bool(op.get('erase')), 'level_z': level_z})
    return {'centroids': cen_b, 'eye': eye, 'tris': j.get('tris'), 'path': path, 'fills': fills, 'markers': markers}


def replay_fills(me, fills, L, rep):
    """CUT the hull along every outline's straight lines and mark the pieces inside.

    An outline drawn in the editor is a polygon on the screen ; each of its edges together with
    the camera position spans a plane. Bisecting the hull's front-facing faces near the edge with
    that plane splits the triangles exactly where the line runs, so after classifying the pieces
    (inside the polygon as seen from that camera, front-facing, not occluded) the glass edge IS
    the line. Returns a bool array over me.polygons (after the cuts)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.faces.layers.int.new('gmark')
    lay_c = bm.faces.layers.int.new('gcand')      # inside the outline, facing the camera, hidden only by glass
    n_cuts = 0
    up = Vector((0, 0, 1))
    for op in fills:
        C = Vector(op['cam'])
        P = [Vector(q) for q in op['points']]
        V = (sum(P, Vector()) / len(P) - C).normalized()
        ref = up if abs(V.dot(up)) < 0.9 else Vector((1, 0, 0))
        U = V.cross(ref).normalized()
        W = U.cross(V).normalized()

        def p2(X):
            d = X - C
            t = d.dot(V)
            if t <= 1e-6:
                return None
            return (d.dot(U) / t, d.dot(W) / t)

        poly = [p2(q) for q in P]
        if any(q is None for q in poly):
            continue
        xs = [q[0] for q in poly]
        ys = [q[1] for q in poly]
        ext = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
        m = 0.05 * ext
        bx0, bx1, by0, by1 = min(xs) - m, max(xs) + m, min(ys) - m, max(ys) + m

        def inbox(q):
            return q is not None and bx0 <= q[0] <= bx1 and by0 <= q[1] <= by1

        def inpoly(q):
            inside = False
            j = len(poly) - 1
            for i in range(len(poly)):
                xi, yi = poly[i]
                xj, yj = poly[j]
                if (yi > q[1]) != (yj > q[1]) and q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
            return inside

        def seg_d2(q, a, b):
            vx, vy = b[0] - a[0], b[1] - a[1]
            wx, wy = q[0] - a[0], q[1] - a[1]
            ll = vx * vx + vy * vy
            t = 0.0 if ll < 1e-18 else max(0.0, min(1.0, (wx * vx + wy * vy) / ll))
            dx, dy = wx - t * vx, wy - t * vy
            return dx * dx + dy * dy

        bm.normal_update()
        # the working subset: front-facing faces whose centre projects into the outline's box
        subset = set()
        for f in bm.faces:
            c = f.calc_center_median()
            q = p2(c)
            if inbox(q) and f.normal.dot(C - c) > 0:
                subset.add(f)
        margin2 = (0.02 * ext) ** 2
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            a2, b2 = poly[i], poly[(i + 1) % len(P)]
            no = (a - C).cross(b - C)
            if no.length < 1e-12:
                continue
            no.normalize()
            # every face that CROSSES the edge's plane within the segment's span gets cut - a large flat
            # triangle straddling the outline with its centre far from the line was left whole and
            # floated as a dark shard inside the Blaster's pane
            sx0, sx1 = min(a2[0], b2[0]) - 0.03 * ext, max(a2[0], b2[0]) + 0.03 * ext
            sy0, sy1 = min(a2[1], b2[1]) - 0.03 * ext, max(a2[1], b2[1]) + 0.03 * ext
            cand = []
            for f in subset:
                if not f.is_valid:
                    continue
                sd = [(v.co - a).dot(no) for v in f.verts]
                if max(sd) <= 1e-7 or min(sd) >= -1e-7:
                    continue                                  # all on one side: no crossing
                qs = [p2(v.co) for v in f.verts]
                qs = [q for q in qs if q is not None]
                if not qs:
                    continue
                fx0, fx1 = min(q[0] for q in qs), max(q[0] for q in qs)
                fy0, fy1 = min(q[1] for q in qs), max(q[1] for q in qs)
                if fx1 < sx0 or fx0 > sx1 or fy1 < sy0 or fy0 > sy1:
                    continue
                cand.append(f)
            if not cand:
                continue
            verts = {v for f in cand for v in f.verts}
            edges = {e for f in cand for e in f.edges}
            ret = bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + cand, dist=1e-5 * L, plane_co=a, plane_no=no,
                                         use_snap_center=False, clear_outer=False, clear_inner=False)
            n_cuts += 1
            subset = {f for f in subset if f.is_valid}
            for g in ret['geom']:
                if isinstance(g, bmesh.types.BMFace) and g.is_valid:
                    subset.add(g)
            for g in ret['geom_cut']:
                if isinstance(g, bmesh.types.BMEdge) and g.is_valid:
                    for f in g.link_faces:
                        subset.add(f)
        level_z = op.get('level_z')
        if level_z is not None:
            # a LEVEL lower edge: one horizontal plane through the whole working subset
            cand = [f for f in subset if f.is_valid]
            if cand:
                verts = {v for f in cand for v in f.verts}
                edges = {e for f in cand for e in f.edges}
                ret = bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + cand, dist=1e-5 * L,
                                             plane_co=Vector((0, 0, level_z)), plane_no=Vector((0, 0, 1)),
                                             use_snap_center=False, clear_outer=False, clear_inner=False)
                n_cuts += 1
                subset = {f for f in subset if f.is_valid}
                for g in ret['geom']:
                    if isinstance(g, bmesh.types.BMFace) and g.is_valid:
                        subset.add(g)
        bm.normal_update()
        bvh = BVHTree.FromBMesh(bm)
        val = 0 if op['erase'] else 1
        for f in subset:
            if not f.is_valid:
                continue
            c = f.calc_center_median()
            q = p2(c)
            if q is None or not inpoly(q):
                continue
            if level_z is not None and c.z < level_z - 1e-5 * L:
                continue
            if f.normal.dot(C - c) <= 0:
                # the far slope of a bubble canopy faces away from the camera it was outlined from ;
                # seen THROUGH the near glass it is still the pane (Blaster's front) - a candidate,
                # confirmed later only if it sits in the glass fringe
                f[lay_c] = 1 if not op['erase'] else 0
                continue
            d = c - C
            dist = d.length
            hit = bvh.ray_cast(C, d / dist, dist + 0.01 * L)
            if hit[0] is None or hit[3] >= dist - 0.002 * L:
                f[lay] = val
            else:
                f[lay_c] = 1 if not op['erase'] else 0
        # a second look: faces inside the outline whose occluder is glass (the canopy's own bulge
        # at grazing angles hid the far slope of the pane) are candidates, confirmed later when
        # they sit in the glass fringe - so the deck behind a canopy does not qualify
        bm.faces.ensure_lookup_table()
        for f in subset:
            if not f.is_valid or f[lay] or not f[lay_c]:
                continue
            c = f.calc_center_median()
            d = c - C
            dist = d.length
            hit = bvh.ray_cast(C, d / dist, dist + 0.01 * L)
            if hit[0] is not None and hit[3] < dist - 0.002 * L and not bm.faces[hit[2]][lay]:
                f[lay_c] = 0
    bm.to_mesh(me)
    bm.free()
    me.update()
    out = np.zeros(len(me.polygons), np.int32)
    me.attributes['gmark'].data.foreach_get('value', out)
    me.attributes.remove(me.attributes['gmark'])
    outc = np.zeros(len(me.polygons), np.int32)
    me.attributes['gcand'].data.foreach_get('value', outc)
    me.attributes.remove(me.attributes['gcand'])
    rep['glass']['fill_ops'] = len(fills)
    rep['glass']['fill_cuts'] = n_cuts
    rep['glass']['fill_candidates'] = int((outc > 0).sum())
    return out > 0, outc > 0


def load_reference_glass(ship):
    """The old chain's `canopy_glass` faces (LSS/ships/<ship>.glb, judged in-game through v37.36-40) as
    world-space (verts, polys) - the canopy REGION, transferred onto the original by proximity."""
    path = os.path.join(REF_DIR, ship + '.glb')
    if not os.path.exists(path):
        # tools/blender/work/ is gitignored: recover the old chain's hull from the commit that shipped it
        import subprocess
        os.makedirs(REF_DIR, exist_ok=True)
        try:
            data = subprocess.run(['git', 'show', f'{REF_COMMIT}:LSS/ships/{ship}.glb'], cwd=REPO, capture_output=True, check=True).stdout
            with open(path, 'wb') as fh:
                fh.write(data)
        except Exception as ex:
            print('REF', ship, 'git show failed:', ex)
            return None
    meshes, empties = import_glb(path)
    verts, polys = [], []
    for o in meshes:
        me_ = o.data
        gidx = [i for i, m in enumerate(me_.materials) if m and m.name.startswith('canopy_glass')]
        if not gidx:
            continue
        M = o.matrix_world
        base = len(verts)
        verts.extend([tuple(M @ v.co) for v in me_.vertices])
        for pg in me_.polygons:
            if pg.material_index in gidx:
                polys.append(tuple(base + vi for vi in pg.vertices))
    for o in meshes + empties:
        bpy.data.objects.remove(o, do_unlink=True)
    if not polys:
        return None
    # the canopy proper = the big edge-connected component(s). The old chain also laid hundreds
    # of small glass panes over see-through gaps all around the canopy zone (v37.36) ; those
    # blotches must not transfer.
    ef = {}
    for i, pg in enumerate(polys):
        for k in range(len(pg)):
            e = (min(pg[k], pg[(k + 1) % len(pg)]), max(pg[k], pg[(k + 1) % len(pg)]))
            ef.setdefault(e, []).append(i)
    seen = set()
    comps = []
    for i in range(len(polys)):
        if i in seen:
            continue
        stack = [i]
        comp = []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            pg = polys[x]
            for k in range(len(pg)):
                e = (min(pg[k], pg[(k + 1) % len(pg)]), max(pg[k], pg[(k + 1) % len(pg)]))
                stack.extend(ef[e])
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    keep = [c for c in comps if len(c) >= 0.10 * len(comps[0])]
    kept = [polys[i] for c in keep for i in c]
    return verts, kept, {'components': len(comps), 'kept': len(keep), 'largest': len(comps[0]), 'total': len(polys)}


def process(ship):
    t0 = time.time()
    rep = {'ship': ship, 'source': 'ships_original'}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    vl = bpy.context.view_layer
    src = os.path.join(ORIG_DIR, ship.capitalize() + '.glb')
    # the remeshed hulls (ship_remesh.py) are ONE shell whose export split vertices along UV seams
    # and sharp edges: merge them back or the loose-part split sees 5000 "shells"
    meshes, orig_empties = import_glb(src, merge_vertices=(os.path.normpath(ORIG_DIR).lower().endswith('ships_clean') or '--merge' in argv))
    hull = meshes[0]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    if len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        vl.objects.active = hull
        bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    hull.select_set(True)
    vl.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    hull.name = 'mesh_0'
    me = hull.data
    me.name = 'mesh_0'
    # SHELLS: the AI hull is ~2000 loose parts and the canopy is its own small shell(s), so shell
    # membership is the leak guard a bounding box never was. Blender's loose split is fast ; a
    # face attribute carries each part's id back through the join.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in sc.objects if o.type == 'MESH']
    for k_, o in enumerate(parts):
        at = o.data.attributes.new('shell', 'INT', 'FACE')
        at.data.foreach_set('value', np.full(len(o.data.polygons), k_, np.int32))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    vl.objects.active = hull
    bpy.ops.object.join()
    me = hull.data
    n_shells = len(parts)
    rep['shells'] = n_shells
    # (the 'shell' face attribute is read in the selection stage, after any outline cuts)
    bb = [Vector(c) for c in hull.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    L = max(hi - lo)
    ctr = (lo + hi) / 2
    rep['hull'] = {'tris_in': len(me.polygons), 'L': round(L, 4), 'dims': [round(v, 4) for v in (hi - lo)]}
    fwd, up, right = Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    frame = Matrix([[fwd.x, right.x, 0, 0], [fwd.y, right.y, 0, 0], [fwd.z, right.z, 1, 0], [0, 0, 0, 1]])

    # ---------------- 2. markers: the original's own nodes (tools/transfer_markers.mjs put the
    # owner's gun* / thruster* / cockpit* there), else the frozen hull's ---------------------------
    mk = {}
    for e in orig_empties:
        if any(e.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
            mk[e.name] = e.matrix_world.translation.copy()
    rep['markers_source'] = 'original' if mk else 'frozen'
    for e in orig_empties:
        bpy.data.objects.remove(e, do_unlink=True)
    if not mk:
        fm, fe = import_glb(os.path.join(FROZEN_DIR, ship + '.glb'))
        for e in fe:
            if any(e.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
                mk[e.name] = e.matrix_world.translation.copy()
        for o in fm + fe:
            bpy.data.objects.remove(o, do_unlink=True)
    # markers placed in the editor (marks JSON) override
    _mj = load_marks(ship)
    if _mj and _mj.get('markers'):
        for kind, pts in _mj['markers'].items():
            for k_, q in enumerate(pts):
                mk[f'{kind}{k_ + 1}'] = Vector(q)
        rep['markers_source'] = 'editor_json'
    markers = {}
    for name, loc in mk.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.02
        e.location = loc
        sc.collection.objects.link(e)
        markers[name] = e
    rep['markers'] = {k: [round(v, 4) for v in loc] for k, loc in mk.items()}
    cp = mk['cockpit1'].copy()

    # ---------------- 3. canopy paint -> glass ---------------------------------------------------
    mat0 = me.materials[0]
    mat0.name = 'hull'
    marks = load_marks(ship)
    rep['glass'] = {}
    glass_cut = None
    glass_cand = None
    if marks is not None and marks.get('fills'):
        glass_cut, glass_cand = replay_fills(me, marks['fills'], L, rep)     # cuts the mesh: everything below reads the cut mesh
    flab = np.empty(len(me.polygons), np.int32)
    me.attributes['shell'].data.foreach_get('value', flab)
    me.attributes.remove(me.attributes['shell'])
    img = next(n.image for n in mat0.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)
    nP = len(me.polygons)
    mx, sat, hue = face_paint(me, px)
    cen = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('center', cen)
    cen = cen.reshape(-1, 3)
    nrm = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    prm = dict(GLASS_CFG['default'])
    prm.update(GLASS_CFG.get(ship, {}))
    tint = ACCENT[ship]
    thue = _hue_of(tint)
    dh = np.abs(hue - thue)
    dh = np.minimum(dh, 1 - dh)
    d = np.linalg.norm(cen - np.array(cp, np.float32), axis=1)
    R = prm['R'] * L
    # tinted seed: class-hue paint on the upper skin near the marker (panes, streaks, decals)
    seed = ((d < R) & (sat > prm['sat']) & (mx > prm['val']) & (dh < prm['hue_tol'])
            & (cen[:, 2] > cp.z - prm['z_below'] * L) & (nrm[:, 2] > -0.05))
    rep['glass']['seed_faces'] = int(seed.sum())
    shell_n = np.bincount(flab, minlength=n_shells)
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(hull, dg)
    # TRANSFER: the canopy region comes from the old chain's glass (same surface, same frame ;
    # the owner judged those canopies in-game). Every original face within REF_TOL of that
    # surface, facing the same way, is canopy - bars and streaked panes included. No paint rule
    # survived these hulls: Vortex's canopy and fuselage share one purple, Pyro's bars and hull
    # one black, and every growth heuristic leaked over the nose.
    glass = np.zeros(nP, bool)
    near_idx = np.nonzero(d < R * 1.6)[0]
    if glass_cut is not None:
        # OUTLINE CUTS: the owner's straight lines, replayed as bisections ; the pieces inside are glass
        glass = glass_cut.copy()
        rep['glass'].update({'marks': os.path.relpath(marks['path'], REPO), 'cut_faces': int(glass.sum())})
        if int(glass.sum()) < 10:
            raise RuntimeError(f'{ship}: the outline cuts produced {int(glass.sum())} glass faces - camera/points mismatch?')
    elif marks is not None:
        # OWNER'S MARKS (tools/glb_editor.html, Paint Glass): match every painted centroid to the
        # nearest face centre. The editor works on the same file in the same triangle order, so
        # this is exact up to float noise ; matching by position also survives any reordering.
        from mathutils.kdtree import KDTree as _KDT
        kd_all = _KDT(nP)
        for i_ in range(nP):
            kd_all.insert(Vector(cen[i_]), i_)
        kd_all.balance()
        tol = MARK_TOL * L
        missed = 0
        for c_ in marks['centroids']:
            co, i_, dist = kd_all.find(Vector(c_))
            if co is not None and dist < tol:
                glass[i_] = True
            else:
                missed += 1
        rep['glass'].update({'marks': os.path.relpath(marks['path'], REPO), 'marks_painted': int(len(marks['centroids'])),
                             'marks_matched': int(glass.sum()), 'marks_missed': missed})
        if int(glass.sum()) < 10:
            raise RuntimeError(f'{ship}: the painted marks matched {int(glass.sum())} faces - wrong file or coordinates?')
        near_idx = np.nonzero(d < R * 1.6)[0]
    else:
        ref = load_reference_glass(ship)
        if ref is None:
            raise RuntimeError(f'{ship}: no reference glass in {REF_DIR} (copy LSS/ships/<ship>.glb of the old chain there)')
        bvh_ref = BVHTree.FromPolygons(ref[0], ref[1])
        tol = REF_TOL * L
        for fi in near_idx:
            fi = int(fi)
            loc, n_, idx_, dist = bvh_ref.find_nearest(Vector(cen[fi]), tol * 3)
            if loc is not None and dist < tol and abs(n_.dot(Vector(nrm[fi]))) > 0.4:
                glass[fi] = True
        rep['glass'].update({'ref_polys': len(ref[1]), 'ref_components': ref[2], 'transferred': int(glass.sum())})
        if int(glass.sum()) < 10:
            raise RuntimeError(f'{ship}: reference glass transferred {int(glass.sum())} faces - frame mismatch?')
    # painted faces may sit further from the frozen marker than the heuristics assumed
    if marks is not None and glass.any():
        gc_ = cen[glass]
        R = max(R, float(np.linalg.norm(gc_ - np.array(cp, np.float32), axis=1).max()) * 1.15)
        near_idx = np.nonzero(d < R * 1.6)[0]
    cxy = cen[glass][:, :2].mean(0)

    def escapes(fi, sign=1.0, reach=0.5):
        """ray from face fi along +-its normal: True when it leaves the hull (nothing, or only glass, hit)"""
        n_ = Vector(nrm[fi]) * sign
        o = Vector(cen[fi]) + n_ * (0.0008 * L)
        for _ in range(4):
            hit = bvh.ray_cast(o, n_, reach * L)
            if hit[0] is None:
                return True
            if glass[hit[2]]:
                o = hit[0] + n_ * (0.0008 * L)
                continue
            return False
        return False

    # SURROUND FILL, vectorised on a voxel grid (cells of GROW_R hold glass counts and centroid
    # sums ; a face's neighbourhood is its 27-cell block): an opaque outer-skin face whose glass
    # neighbours' mean sits at its own centre has glass all around it (a bar between panes, a
    # pane triangle the reference missed) -> glass. The rim has glass on one side only and stays.
    ncen = cen[near_idx]
    r_g = GROW_R * L
    org = ncen.min(0) - r_g

    class Grid:
        def __init__(self, cell):
            k = np.floor((ncen - org) / cell).astype(np.int64) + 1
            self.dims = k.max(0) + 2
            self.lin = (k[:, 0] * self.dims[1] + k[:, 1]) * self.dims[2] + k[:, 2]
            self.n = int(self.dims.prod())
            self.offs = np.array([(dx * self.dims[1] + dy) * self.dims[2] + dz
                                  for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)], np.int64)
            self.idx = np.clip(self.lin[:, None] + self.offs[None, :], 0, self.n - 1)

        def stats(self, gmask):
            src = self.lin[gmask]
            cnt = np.bincount(src, minlength=self.n).astype(np.float64)
            sx = np.bincount(src, weights=ncen[gmask, 0], minlength=self.n)
            sy = np.bincount(src, weights=ncen[gmask, 1], minlength=self.n)
            sz = np.bincount(src, weights=ncen[gmask, 2], minlength=self.n)
            c = cnt[self.idx].sum(1)
            m = np.stack([sx[self.idx].sum(1), sy[self.idx].sum(1), sz[self.idx].sum(1)], 1) / np.maximum(c, 1)[:, None]
            return c, m

    grid_g = Grid(r_g)
    grown = 0
    it = 0
    # under the owner's marks the SURROUND fill still runs: a mirrored outline and its original
    # both cut along the centreline and leave sliver triangles between the two planes (Pyro) ;
    # a face with glass all around it joins, the straight outer edges are untouched
    changed = True
    while changed and it < 12:
        changed = False
        it += 1
        gmask = glass[near_idx]
        cnt_g, mean_g = grid_g.stats(gmask)
        dist = np.linalg.norm(mean_g - ncen, axis=1)
        surr = ~gmask & (cnt_g >= SURROUND_N) & (dist < SURROUND_F * r_g)
        for k_ in np.nonzero(surr)[0]:
            fi = int(near_idx[k_])
            if escapes(fi):
                glass[fi] = True
                grown += 1
                changed = True
    rep['glass']['grown'] = grown
    rep['glass']['grow_iters'] = it
    if glass_cand is not None:
        c_, _ = grid_g.stats(glass[near_idx])
        fr = np.zeros(nP, bool)
        fr[near_idx[c_ > 0]] = True
        # ... and oriented like the pane: the Tracker's belly, seen through the canopy from above,
        # sat in the fringe of a thin hull and turned to glass
        gmean = nrm[glass].mean(0)
        gmean = gmean / max(1e-9, np.linalg.norm(gmean))
        aligned = (nrm @ gmean) > 0.2
        add = glass_cand & fr & aligned & ~glass
        # ... and on the OUTSIDE: the hull's own inner skin under the canopy faces up like the pane
        # and sits in the fringe, and from the seat the floor under the window went transparent
        # (owner, Vortex v37.60: "a bit of cut out on the hull under the window"). A real far-half
        # pane face looks out at open air ; the floor's normal ray ends inside the hull
        for fi_ in np.nonzero(add)[0]:
            if not escapes(int(fi_)):
                add[fi_] = False
        glass |= add
        rep['glass']['hidden_by_glass_added'] = int(add.sum())
    # CLOSE: a face with glass on two of its edges is a notch or a one-face crack inside the pane
    # (the Pyro's jagged line) ; straight outer edges touch glass along one edge only and stay
    if glass.any():
        ef_c = {}
        for fi in near_idx:
            fi = int(fi)
            for e in me.polygons[fi].edge_keys:
                ef_c.setdefault(e, []).append(fi)
        closed = 0
        for _pass in range(4):
            added = 0
            for fi in near_idx:
                fi = int(fi)
                if glass[fi]:
                    continue
                ng = sum(1 for e in me.polygons[fi].edge_keys if any(glass[q] for q in ef_c.get(e, ()) if q != fi))
                if ng >= 2:
                    glass[fi] = True
                    added += 1
            closed += added
            if not added:
                break
        rep['glass']['closed'] = closed

    # SLIVERS: the cuts leave needle-thin faces along the planes ; some sit inside the glass with
    # glass on two of their edges but fail the surround test (their centroid is on a line). A near
    # face far smaller than the glass faces around it, sharing >= 2 edges with glass, joins.
    if glass.any():
        areas = np.empty(nP, np.float32)
        me.polygons.foreach_get('area', areas)
        med = float(np.median(areas[glass]))
        ef_s = {}
        for fi in near_idx:
            fi = int(fi)
            for e in me.polygons[fi].edge_keys:
                ef_s.setdefault(e, []).append(fi)
        slivers = 0
        for _pass in range(3):
            added = 0
            for fi in near_idx:
                fi = int(fi)
                if glass[fi] or areas[fi] > 0.15 * med:
                    continue
                ng = sum(1 for e in me.polygons[fi].edge_keys for q in ef_s.get(e, ()) if q != fi and glass[q])
                if ng >= 2:
                    glass[fi] = True
                    added += 1
            slivers += added
            if not added:
                break
        rep['glass']['slivers'] = slivers

    def fringe():
        c_, _ = grid_g.stats(glass[near_idx])
        ng = np.zeros(nP, bool)
        ng[near_idx[(c_ > 0) & ~glass[near_idx]]] = True
        return ng

    # UNDERSIDE: the canopy shell's inner surface (a few mm inside the outer panes, normals
    # pointing in) would stay opaque from the seat. Any opaque face in the glass fringe whose ray
    # along -normal meets glass within 0.03 L is that inner surface -> glass.
    inner = 0
    for fi in np.nonzero(fringe())[0]:
        fi = int(fi)
        n_ = -Vector(nrm[fi])
        o = Vector(cen[fi]) + n_ * (0.0005 * L)
        hit = bvh.ray_cast(o, n_, 0.03 * L)
        if hit[0] is not None and glass[hit[2]]:
            glass[fi] = True
            inner += 1
    rep['glass']['inner_layer'] = inner
    # ISLANDS: small loose shells lying WHOLLY inside the glass fringe (bar remnants, stray
    # specks) would float as shards in the pilot's sky -> glass. Big shells and anything that
    # reaches beyond the fringe stay (they are hull).
    ng = fringe()
    in_fr = np.bincount(flab[glass | ng], minlength=n_shells)
    sh_ok = (in_fr == shell_n) & (shell_n <= ISLAND_MAX) & (in_fr > 0) & (marks is None)   # painted marks are the truth
    isl = sh_ok[flab] & ~glass
    islands = int(isl.sum())
    glass |= isl
    rep['glass']['islands'] = islands
    # BOUNDARY SMOOTHING (owner: "the cockpit glass looks like it's tearing into the frame...
    # ripped apart"): along the rim, glass and opaque triangles alternated. Erode glass faces with
    # few glass neighbours, close opaque outer-skin faces with mostly glass around them.
    tot_g, _ = grid_g.stats(np.ones(len(near_idx), bool))
    for _pass in range(0 if marks is not None else 2):
        gm = glass[near_idx]
        cnt_g, _ = grid_g.stats(gm)
        frac = cnt_g / np.maximum(tot_g, 1)
        erode = gm & (frac < 0.22)
        glass[near_idx[erode]] = False
        gm = glass[near_idx]
        cnt_g, _ = grid_g.stats(gm)
        frac = cnt_g / np.maximum(tot_g, 1)
        for k_ in np.nonzero(~gm & (frac > 0.62))[0]:
            fi = int(near_idx[k_])
            if escapes(fi):
                glass[fi] = True
    rep['glass']['smoothed'] = True
    # SHELL VOTE (owner: "if you use the original GLB files, it might be easier to find the lines for
    # the actual cockpit glass"): the canopy panes are their own loose parts in the original, so the
    # glass edge should follow the model's part lines, not the face-by-face transfer. A part that is
    # mostly glass becomes glass whole ; a small part with only stray glass faces loses them. Huge
    # parts (a fuselage that includes the canopy) keep the face-level result.
    g_per = np.bincount(flab[glass], minlength=n_shells)
    fr_sh = g_per / np.maximum(shell_n, 1)
    whole = (fr_sh >= SHELL_VOTE_IN) & (shell_n <= SHELL_VOTE_MAX) & (marks is None)
    drop = (g_per > 0) & (fr_sh < SHELL_VOTE_OUT) & (shell_n <= SHELL_VOTE_MAX) & (marks is None)
    added = whole[flab] & ~glass
    removed = drop[flab] & glass
    glass[added] = True
    glass[removed] = False
    rep['glass']['shell_vote'] = {'added': int(added.sum()), 'removed': int(removed.sum()),
                                  'whole_shells': int(whole.sum()), 'dropped_shells': int(drop.sum())}
    n_glass = int(glass.sum())
    rep['glass']['faces'] = n_glass
    rep['glass']['shells_touched'] = int((np.bincount(flab[glass], minlength=n_shells) > 0).sum())
    glass_set = set(np.nonzero(glass)[0].tolist())
    gc = cen[glass]
    g_lo, g_hi = gc.min(0), gc.max(0)
    Lc = float(g_hi[0] - g_lo[0])
    Wc = float(g_hi[1] - g_lo[1])
    g_ctr = Vector(((g_lo[0] + g_hi[0]) / 2, (g_lo[1] + g_hi[1]) / 2, float(gc[:, 2].mean())))
    rep['canopy'] = {'Lc': round(Lc, 4), 'Wc': round(Wc, 4), 'centre': [round(v, 4) for v in g_ctr],
                     'z_top': round(float(g_hi[2]), 4)}

    # glass material
    glass_mat = bpy.data.materials.new('canopy_glass')
    glass_mat.use_nodes = True
    gb = glass_mat.node_tree.nodes['Principled BSDF']
    _g = np.array(tint, np.float32)
    _gc = np.clip((_g * 0.75 + float(_g.mean()) * 0.25) * 0.85, 0, 1)
    gb.inputs['Base Color'].default_value = (float(_gc[0]), float(_gc[1]), float(_gc[2]), 1.0)
    gb.inputs['Alpha'].default_value = GLASS_ALPHA
    gb.inputs['Roughness'].default_value = 0.08
    gb.inputs['Metallic'].default_value = 0.0
    gb.inputs['Specular IOR Level'].default_value = 0.8
    glass_mat.blend_method = 'BLEND'
    glass_mat.show_transparent_back = False
    glass_mat.use_backface_culling = True
    me.materials.append(glass_mat)
    gi = len(me.materials) - 1
    midx = np.zeros(nP, np.int32)
    me.polygons.foreach_get('material_index', midx)
    midx[glass] = gi
    me.polygons.foreach_set('material_index', midx)
    me.update()

    # ---------------- 4. the eye: inside the pit under the glass ------------------------------
    def down_hits(x, y):
        """z of every surface below (x, y) from above the hull, top first: [(z, is_glass), ...]"""
        out = []
        o = Vector((x, y, hi.z + 0.05 * L))
        for _ in range(12):
            hit = bvh.ray_cast(o, Vector((0, 0, -1)), 2.0 * L)
            if hit[0] is None:
                break
            loc, nrm, idx, dist = hit
            out.append((float(loc.z), idx in glass_set))
            o = loc - Vector((0, 0, 0.002 * L))
        return out

    def glass_z_at(x, y):
        """z of the canopy's TOP surface over (x, y) - the first glass hit from above ; a lower glass
        hit is the shell's inner layer or a stray pane (Tracker's eye fell through on min())"""
        gz = [z for z, g in down_hits(x, y) if g]
        return max(gz) if gz else None

    def floor_under(e):
        hits = down_hits(e.x, e.y)
        below = [z for z, g in hits if not g and z < e.z]
        return below[0] if below else None

    def open_score(eye):
        """fraction of a forward cone of rays that leave the hull through glass (or hit nothing)"""
        n_open = 0
        n = 0
        for pitch in (-12, 0, 12, 24):
            for yaw in range(-50, 51, 10):
                p_, y_ = math.radians(pitch), math.radians(yaw)
                dv = Vector((-math.cos(p_) * math.cos(y_), math.cos(p_) * math.sin(y_), math.sin(p_)))
                o = Vector(eye)
                ok = False
                for _ in range(6):
                    hit = bvh.ray_cast(o, dv, 0.7 * L)
                    if hit[0] is None:
                        ok = True
                        break
                    if hit[2] in glass_set:
                        o = hit[0] + dv * (0.002 * L)
                        continue
                    break
                n += 1
                n_open += ok
        return n_open / max(1, n)

    # EYE = the most open forward view (the v37.2x rule): scan along the canopy centreline under
    # the glass, keep the best score, rearmost on ties (the pilot sits behind the apex).
    cands = []
    for k in range(8):
        fx_ = EYE_SCAN_X[0] + (EYE_SCAN_X[1] - EYE_SCAN_X[0]) * k / 7
        x = float(g_lo[0] + fx_ * Lc)          # fwd = -x : g_lo.x is the canopy front
        gz = glass_z_at(x, 0.0)
        if gz is None:
            continue
        for j in range(3):
            under = EYE_UNDER[0] + (EYE_UNDER[1] - EYE_UNDER[0]) * j / 2
            e = Vector((x, 0.0, gz - under * L))
            fl = floor_under(e)
            # a seat needs a floor: candidates hanging in a void (or below the pit) lose 0.5
            sc0 = open_score(e) - (0.0 if fl is not None and e.z - fl < 0.5 * L else 0.5)
            cands.append((sc0, x, e, gz))
    _eye_moved = (marks is not None and marks.get('eye') is not None
                  and ('cockpit1' not in mk or (Vector(marks['eye']) - Vector(mk['cockpit1'])).length > 0.01 * L))
    if _eye_moved:
        # the editor re-exports the GLB's own cockpit1 unchanged ; only a marker the owner MOVED
        # is an eye (the frozen one sits inside the old carved tub - Tracker scored 0.00 on it)
        eye_world = Vector(marks['eye'])
        gz = glass_z_at(eye_world.x, eye_world.y)
        glass_z_eye = gz if gz is not None else float(g_hi[2])
        if eye_world.z > glass_z_eye - EYE_UNDER[0] * L:
            eye_world.z = glass_z_eye - EYE_UNDER[0] * L
        sc_ = open_score(eye_world)
        eye_src = 'editor_cockpit_marker'
    elif cands:
        best = max(c[0] for c in cands)
        x_target = float(g_lo[0]) + 0.55 * Lc          # (v37.45) rearmost-on-ties put the panel far away on long canopies
        sc_, x, eye_world, glass_z_eye = min((c for c in cands if c[0] >= best - 0.03), key=lambda c: abs(c[1] - x_target))
        eye_src = 'scan'
    else:
        sc_, eye_world, glass_z_eye, eye_src = 0.0, Vector(cp), float(g_hi[2]), 'frozen_marker'
    floor_z = floor_under(eye_world)
    if floor_z is not None and eye_world.z - floor_z < 0.04 * L:
        eye_world.z = floor_z + 0.04 * L
    eye_z = eye_world.z
    markers['cockpit1'].location = eye_world
    rep['eye'] = {'world': [round(v, 4) for v in eye_world], 'floor_z': None if floor_z is None else round(floor_z, 4),
                  'glass_z_above': round(glass_z_eye, 4), 'source': eye_src, 'open_score': round(sc_, 3),
                  'frozen_cockpit1': [round(v, 4) for v in cp],
                  'pit_depth_L': None if floor_z is None else round((glass_z_eye - floor_z) / L, 3),
                  'scan': [[round(c[0], 2), round(c[1], 3), round(c[2].z, 3)] for c in cands]}

    # ---------------- 5. hull material: double-sided + hull lights ---------------------------------
    mat0.use_backface_culling = False          # exported doubleSided ; the game keeps m.side
    tr, tg, tb = tint
    rgb = px[:, :, :3]
    pmx = rgb.max(2)
    pmn = rgb.min(2)
    psat = np.where(pmx > 1e-4, (pmx - pmn) / np.maximum(pmx, 1e-4), 0)
    pdl = np.maximum(pmx - pmn, 1e-6)
    phue = np.where(pmx == rgb[:, :, 0], ((rgb[:, :, 1] - rgb[:, :, 2]) / pdl) % 6,
                    np.where(pmx == rgb[:, :, 1], (rgb[:, :, 2] - rgb[:, :, 0]) / pdl + 2, (rgb[:, :, 0] - rgb[:, :, 1]) / pdl + 4)) / 6.0
    pdh = np.abs(phue - thue)
    pdh = np.minimum(pdh, 1 - pdh)
    hp = HULL_GLOW.get(ship, HULL_GLOW['default'])
    m1 = np.clip((psat - hp['sat']) / 0.15, 0, 1) * np.clip((pmx - hp['val']) / 0.15, 0, 1) * np.clip((hp['hue_tol'] - pdh) / 0.04, 0, 1)
    hull_emis = np.zeros_like(px)
    hull_emis[:, :, :3] = rgb * m1[:, :, None] * hp['strength']
    hull_emis[:, :, 3] = 1.0
    # half resolution is plenty for a glow mask
    he = hull_emis.reshape(H // 2, 2, W // 2, 2, 4).mean((1, 3))
    he_img = bpy.data.images.new(f'{ship}_hullemis', W // 2, H // 2, alpha=True)
    he_img.pixels.foreach_set(he.astype(np.float32).ravel())
    he_img.filepath_raw = os.path.join(ATLAS_DIR, f'{ship}_orig_hullemis.png')
    he_img.file_format = 'PNG'
    he_img.save()
    he_img.pack()
    nt = mat0.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    etex = new_image_node(nt, he_img)
    nt.links.new(etex.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    rep['hull_glow'] = {'pixels_pct': round(float(100 * (m1 > 0.5).mean()), 2)}

    # ---------------- 6. the TUB: an authored cabin inside the hull (--interior only) --------------
    if not INTERIOR:
        rep['interior'] = 'none (--interior to build the cabin)'
    else:
        # Owner on v37.41 ("they all look so bad" - the seat view): the AI hull has no interior, only
        # hollow overlapping panels, and the clear canopy exposed them. So: a lofted tub from the
        # canopy outline - walls up to the lowest glass of each sector, a coaming ledge out to the
        # glass rim, a floor - the hull's junk inside it deleted, seat / sills / consoles / bulkhead /
        # ribs / pedals inside, MFDs on the sill fronts, the painted frame band at the eye.
        origin_local = frame.transposed() @ eye_world
        B = Builder(frame, origin_local)          # local (0, 0, 0) = the eye ; x fwd, y right, z up
        if FRAME_ART and ship in FRAME_PNG and os.path.exists(os.path.join(REPO, FRAME_PNG[ship])):
            build_frame_billboard(ship, B, Vector((0, 0, 0)), Lc, rep)
        # canopy outline as a polar profile around the canopy centre (local: x fwd = -world x)
        gcl = cen[glass]
        cxw = float(g_ctr.x)
        NA = 48
        lx = -(gcl[:, 0] - cxw)
        ly = gcl[:, 1]
        ang = np.arctan2(ly, lx)
        rad = np.hypot(lx, ly)
        zl = gcl[:, 2] - eye_z
        bins = ((ang + np.pi) / (2 * np.pi) * NA).astype(int) % NA
        prof = np.full(NA, np.nan)
        z_lo_g = np.full(NA, np.nan)
        z_hi_g = np.full(NA, np.nan)
        for k in range(NA):
            m_ = bins == k
            if m_.sum() >= 3:
                prof[k] = np.percentile(rad[m_], 90)
                outer = m_ & (rad > 0.8 * prof[k])
                z_lo_g[k] = np.percentile(zl[outer], 5) if outer.sum() >= 3 else np.percentile(zl[m_], 5)
                z_hi_g[k] = np.percentile(zl[m_], 98)

        def fill_circular(arr):
            idx = np.arange(NA)
            valid = ~np.isnan(arr)
            if not valid.any():
                raise RuntimeError(f'{ship}: empty canopy profile')
            out = arr.copy()
            for k in np.nonzero(~valid)[0]:
                dd = np.minimum(np.abs(idx[valid] - k), NA - np.abs(idx[valid] - k))
                out[k] = arr[valid][np.argmin(dd)]
            return (np.roll(out, 1) + 2 * out + np.roll(out, -1)) / 4

        prof_raw = fill_circular(prof)
        z_lo_g = fill_circular(z_lo_g)
        z_hi_g = fill_circular(z_hi_g)
        prof_t = prof_raw * TUB_SHRINK
        thetas = -np.pi + 2 * np.pi * (np.arange(NA) + 0.5) / NA
        c_loc = B.to_local(Vector((cxw, 0.0, eye_z)))

        def rim_pt(k, f, z):
            return Vector((c_loc.x + f * prof_t[k] * math.cos(thetas[k]), f * prof_t[k] * math.sin(thetas[k]), z))

        z_floor = max(-TUB_DEPTH * Lc, float(lo.z) + 0.03 * L - eye_z)
        top = [rim_pt(k, 1.0, float(z_lo_g[k]) - 0.002 * L) for k in range(NA)]
        r2 = [rim_pt(k, 0.96, min(-0.10 * Lc, top[k].z - 0.03 * Lc)) for k in range(NA)]
        r3 = [rim_pt(k, 0.86, min(0.6 * z_floor, r2[k].z - 0.05 * Lc)) for k in range(NA)]
        fl = [rim_pt(k, 0.72, z_floor) for k in range(NA)]
        tub_center = Vector((c_loc.x, 0.0, 0.5 * z_floor))
        tub_faces, vrings = B.loft([top, r2, r3, fl], region='metal', inward_center=tub_center)
        floor_faces = B.cap(vrings[-1], region='trim', inward_center=tub_center)
        # coaming ledge: from the wall top out past the glass rim, facing up
        outer = [Vector((c_loc.x + 1.06 * prof_raw[k] * math.cos(thetas[k]), 1.06 * prof_raw[k] * math.sin(thetas[k]), top[k].z)) for k in range(NA)]
        coam_faces, _ = B.loft([top, outer], region='trim', inward_center=Vector((c_loc.x, 0.0, 5.0 * Lc)), smooth=False)
        # window-sill LIP: from the ledge's outer edge up to whatever skin is above it, facing the pilot,
        # so the ragged glass boundary just outside the tub is never in view from the seat
        lip_top = []
        for k in range(NA):
            w_ = B.to_world(outer[k])
            hits = down_hits(w_.x, w_.y)
            zs = (hits[0][0] - eye_z) if hits else outer[k].z
            lip_top.append(Vector((outer[k].x, outer[k].y, max(outer[k].z + 0.004 * Lc, zs - 0.003 * L))))
        lip_faces, _ = B.loft([outer, lip_top], region='metal', inward_center=tub_center, smooth=False)
        w = float(min(prof_t[(NA * 3) // 4], prof_t[NA // 4]))     # half-width at the sides (+-90 deg)
        rep['tub'] = {'z_floor': round(z_floor, 4), 'half_width': round(w, 4), 'rim_mean': round(float(prof_t.mean()), 4),
                      'wall_top_z': [round(float(v), 3) for v in (z_lo_g.min(), z_lo_g.max())]}
        # ---- furniture (local, relative to the eye)
        sw = 0.30 * w
        for sgn in (1, -1):
            ys = sgn * (w - sw / 2 - 0.004 * L)
            B.box(Vector((-0.04 * Lc, ys, -0.14 * Lc)), (0.52 * Lc, sw, 0.05 * Lc), region='metal', bevel=0.003 * Lc)   # sill
            B.box(Vector((-0.04 * Lc, sgn * (w - sw - 0.004 * L), -0.108 * Lc)), (0.52 * Lc, 0.02 * w, 0.02 * Lc), region='trim')  # lip
            B.box(Vector((0.10 * Lc, ys, -0.112 * Lc)), (0.12 * Lc, 0.55 * sw, 0.008 * Lc), region='scrD' if sgn > 0 else 'scrB')
            for k in range(4):
                B.box(Vector((-0.02 * Lc + k * 0.045 * Lc, ys, -0.112 * Lc)), (0.025 * Lc, 0.30 * sw, 0.008 * Lc), region='glow')
            for k in range(6):
                lit = (k % 3 == 0)
                B.box(Vector((-0.24 * Lc + k * 0.04 * Lc, ys + sgn * 0.30 * sw, -0.110 * Lc)), (0.012 * Lc, 0.10 * sw, 0.014 * Lc), region='glow' if lit else 'trim')
            # MFD on the sill front, angled toward the pilot
            yaw = sgn * math.radians(28)
            B.box(Vector((0.20 * Lc, sgn * 0.78 * w, -0.06 * Lc)), (0.006 * Lc, 0.10 * Lc, 0.07 * Lc), rot=(0, math.radians(-10), yaw), region='scrB' if sgn > 0 else 'scrC')
            B.box(Vector((0.20 * Lc, sgn * 0.78 * w, -0.10 * Lc)), (0.02 * Lc, 0.03 * Lc, 0.02 * Lc), region='trim')
        # bulkhead behind the seat with avionics racks and a light strip
        bx = -0.34 * Lc
        B.box(Vector((bx, 0, -0.16 * Lc)), (0.03 * Lc, 1.8 * w, 0.40 * Lc), region='trim', bevel=0.003 * Lc)
        for sgn in (1, -1):
            B.box(Vector((bx + 0.02 * Lc, sgn * 0.5 * w, -0.22 * Lc)), (0.03 * Lc, 0.5 * w, 0.22 * Lc), region='metal')
            for k in range(3):
                B.box(Vector((bx + 0.036 * Lc, sgn * 0.5 * w, -0.30 * Lc + k * 0.07 * Lc)), (0.004 * Lc, 0.4 * w, 0.01 * Lc), region='glow' if k == 1 else 'trim')
        B.box(Vector((bx + 0.02 * Lc, 0, -0.35 * Lc)), (0.03 * Lc, 1.4 * w, 0.015 * Lc), region='glow')
        # INSTRUMENT PANEL across the front of the tub, tilted toward the pilot, top just under the eye
        # line so the view forward stays clear: attitude display in the centre, radar left, bars right,
        # a log strip, buttons along the bottom, glow strips along the top, a glare shield on top.
        k0 = int(((0.0 + math.pi) / (2 * math.pi)) * NA) % NA
        x_front = c_loc.x + prof_t[k0]
        # (v37.43 in-game: at 0.36 Lc the panel was a small far box and the cabin read as a corridor)
        x_d = min(0.22 * Lc, x_front - 0.05 * Lc)
        wd = max(min(1.5 * w, 0.55 * Lc), 0.34 * Lc)
        tilt = math.radians(22)
        n_d = Vector((-math.cos(tilt), 0.0, math.sin(tilt)))      # the tilted face's normal (toward the eye)
        dc = Vector((x_d, 0.0, -0.16 * Lc))
        B.box(dc, (0.05 * Lc, wd, 0.20 * Lc), rot=(0, tilt, 0), region='metal', bevel=0.004 * Lc)
        face = dc + n_d * (0.025 * Lc + 0.004 * Lc)

        def on_dash(y, up, size, region):
            c_ = face + Vector((0, y, 0)) + Vector((-math.sin(tilt), 0.0, math.cos(tilt))) * up
            B.box(c_, (0.006 * Lc, size[0], size[1]), rot=(0, tilt, 0), region=region)
        on_dash(0.0, 0.015 * Lc, (0.26 * wd, 0.10 * Lc), 'scrC')
        on_dash(-0.34 * wd, 0.015 * Lc, (0.22 * wd, 0.09 * Lc), 'screen')
        on_dash(0.34 * wd, 0.015 * Lc, (0.22 * wd, 0.09 * Lc), 'scrB')
        on_dash(0.0, -0.062 * Lc, (0.36 * wd, 0.025 * Lc), 'scrD')
        for k in range(8):
            on_dash(-0.42 * wd + k * 0.12 * wd, -0.080 * Lc, (0.05 * wd, 0.014 * Lc), 'glow' if k % 2 == 0 else 'trim')
        for sgn in (1, -1):
            on_dash(sgn * 0.30 * wd, 0.082 * Lc, (0.30 * wd, 0.008 * Lc), 'glow')
        # (v37.53) no glare shield: from the seat it read as a wide flat upper deck across the front
        # CANOPY ARCHES: a mullion over the glass ahead and a roll bar behind the head, each a chain of
        # short tubes riding just under the glass surface - the window gets a 3D frame again.
        for xa in (0.12 * Lc, -0.10 * Lc):
            pts = []
            for j in range(17):
                y_ = -1.05 * w + 2.10 * w * j / 16
                w_ = B.to_world(Vector((xa, y_, 0.0)))
                gz = glass_z_at(w_.x, w_.y)
                if gz is None:
                    continue
                pts.append(Vector((xa, y_, gz - eye_z - 0.006 * L)))
            if len(pts) >= 3:
                tube(B, pts, 0.007 * Lc, 'trim', n=8)
            if xa < 0 and len(pts) > 4:
                # overhead switch strip hanging under the roll bar, in the top of the 120-degree view
                zc = min(pt.z for pt in pts[len(pts) // 3: 2 * len(pts) // 3]) - 0.02 * Lc
                B.box(Vector((xa, 0.0, zc)), (0.035 * Lc, 0.7 * w, 0.018 * Lc), region='trim', bevel=0.002 * Lc)
                for k in range(5):
                    B.box(Vector((xa, -0.28 * w + k * 0.14 * w, zc - 0.012 * Lc)), (0.012 * Lc, 0.05 * w, 0.010 * Lc), region='glow' if k % 2 == 0 else 'seat')
        # (v37.53) no HUD combiner plate either: "it shouldn't have that upper deck part and square"
        Bh = Builder(frame, origin_local)
        Bh.assign_uvs(tile_len=0.30 * Wc)
        bmesh.ops.recalc_face_normals(Bh.bm, faces=list(Bh.bm.faces))
        # control stick between the knees, throttle on the left sill
        stick_base = Vector((0.11 * Lc, 0.0, z_floor + 0.035 * Lc))
        stick_top = Vector((0.09 * Lc, 0.0, -0.20 * Lc))
        cyl(B, stick_base + Vector((0, 0, -0.01 * Lc)), stick_base + Vector((0, 0, 0.012 * Lc)), 0.035 * Lc, 'trim')
        cyl(B, stick_base, stick_top, 0.008 * Lc, 'metal')
        B.box(stick_top + Vector((-0.005 * Lc, 0.0, 0.03 * Lc)), (0.028 * Lc, 0.026 * Lc, 0.075 * Lc), rot=(0, math.radians(-12), 0), region='seat', bevel=0.005 * Lc)
        B.box(stick_top + Vector((-0.017 * Lc, 0.0, 0.062 * Lc)), (0.008 * Lc, 0.010 * Lc, 0.010 * Lc), region='glow')
        thr = Vector((0.0, -(w - sw / 2 - 0.004 * L), -0.108 * Lc))
        B.box(thr + Vector((0, 0, 0.004 * Lc)), (0.14 * Lc, 0.016 * Lc, 0.006 * Lc), region='seat')                       # slot
        B.box(thr + Vector((0.02 * Lc, 0, 0.028 * Lc)), (0.045 * Lc, 0.030 * Lc, 0.040 * Lc), region='seat', bevel=0.004 * Lc)   # grip
        # RIM RAIL: a square tube along the outer edge of the coaming, so the window has an outline
        tube(B, [Vector((pt.x, pt.y, pt.z + 0.008 * Lc)) for pt in lip_top], 0.008 * Lc, 'trim', n=8, closed=True)
        # ribs along the walls, deck grating, pedals
        for xr in (-0.22, 0.02, 0.26):
            for sgn in (1, -1):
                B.box(Vector((xr * Lc, sgn * 0.97 * w, -0.20 * Lc)), (0.02 * Lc, 0.02 * Lc, 0.34 * Lc), region='metal', bevel=0.002 * Lc)
        B.box(Vector((0.12 * Lc, 0, z_floor + 0.02 * Lc)), (0.40 * Lc, 1.2 * w, 0.03 * Lc), region='trim', bevel=0.002 * Lc)
        for sgn in (1, -1):
            B.box(Vector((0.34 * Lc, sgn * 0.06 * Lc, z_floor + 0.06 * Lc)), (0.05 * Lc, 0.06 * Lc, 0.08 * Lc), rot=(0, math.radians(-30), 0), region='seat', bevel=0.002 * Lc)
        # seat: pan under the eye, back, headrest, armrests, pedestal to the floor
        pan_z = -0.30 * Lc
        B.box(Vector((-0.02 * Lc, 0, pan_z)), (0.30 * Lc, 0.22 * Lc, 0.05 * Lc), region='seat', bevel=0.004 * Lc)
        B.box(Vector((-0.17 * Lc, 0, pan_z * 0.5 + 0.02 * Lc)), (0.05 * Lc, 0.22 * Lc, -pan_z - 0.06 * Lc), region='seat', bevel=0.004 * Lc)
        B.box(Vector((-0.17 * Lc, 0, 0.07 * Lc)), (0.05 * Lc, 0.11 * Lc, 0.09 * Lc), region='seat', bevel=0.004 * Lc)
        for sgn in (1, -1):
            B.box(Vector((-0.02 * Lc, sgn * 0.13 * Lc, pan_z + 0.07 * Lc)), (0.26 * Lc, 0.03 * Lc, 0.03 * Lc), region='trim', bevel=0.003 * Lc)
        ped_top = pan_z - 0.025 * Lc
        ped_bot = z_floor + 0.01 * Lc
        if ped_top - ped_bot > 0.02 * Lc:
            B.box(Vector((-0.04 * Lc, 0, (ped_top + ped_bot) / 2)), (0.16 * Lc, 0.12 * Lc, ped_top - ped_bot), region='metal', bevel=0.003 * Lc)
        seat_built = True
        B.assign_uvs(tile_len=0.30 * Wc)
        B.tub_uvs(tub_faces, NA, 3)
        _skip = set(tub_faces) | set(floor_faces) | set(coam_faces) | set(lip_faces)
        bmesh.ops.recalc_face_normals(B.bm, faces=[f for f in B.bm.faces if f not in _skip])
        imesh = bpy.data.meshes.new('cockpit_interior')
        B.bm.to_mesh(imesh)
        B.bm.free()
        iobj = bpy.data.objects.new('cockpit_interior', imesh)
        sc.collection.objects.link(iobj)
        hmesh = bpy.data.meshes.new('cockpit_holo')          # the HUD combiner glass (translucent material)
        Bh.bm.to_mesh(hmesh)
        Bh.bm.free()
        hobj = bpy.data.objects.new('cockpit_holo', hmesh)
        sc.collection.objects.link(hobj)
        rep['interior'] = {'seat': seat_built, 'tub_faces': len(tub_faces), 'interior_faces': len(imesh.polygons)}

        # ---- the hull's junk inside the tub goes: every opaque face inside the canopy outline,
        # between the tub floor and the glass of its sector, unless it hugs the glass (frame bars)
        lxh = -(cen[:, 0] - cxw)
        lyh = cen[:, 1]
        angh = np.arctan2(lyh, lxh)
        radh = np.hypot(lxh, lyh)
        binh = ((angh + np.pi) / (2 * np.pi) * NA).astype(int) % NA
        zh = cen[:, 2] - eye_z
        inside = (radh < prof_raw[binh] * 0.98) & (zh > z_floor - 0.01 * L) & (zh < z_hi_g[binh] - 0.003 * L)
        kill = inside & ~glass & ~fringe()
        n_kill = int(kill.sum())
        if n_kill:
            bpy.ops.object.select_all(action='DESELECT')
            hull.select_set(True)
            vl.objects.active = hull
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_mode(type='FACE')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.mode_set(mode='OBJECT')
            me.polygons.foreach_set('select', kill)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.delete(type='FACE')
            bpy.ops.object.mode_set(mode='OBJECT')
            me = hull.data
            me.update()
            nP = len(me.polygons)
            cen = np.empty(nP * 3, np.float32)
            me.polygons.foreach_get('center', cen)
            cen = cen.reshape(-1, 3)
            d = np.linalg.norm(cen - np.array(cp, np.float32), axis=1)
        rep['hull']['junk_deleted'] = n_kill

        # materials: the interior atlas (opaque) and a translucent self-lit copy for the holograms
        int_png, emis_png = build_atlas(ship, tint)
        int_img = bpy.data.images.load(int_png)
        emis_img = bpy.data.images.load(emis_png)
        int_img.pack()
        emis_img.pack()

        # roughness / metallic per atlas region (R = AO 1, G = roughness, B = metallic) so the screens
        # read as glass and the panels as metal instead of one flat finish
        ORM = {'metal': (0.60, 0.80), 'trim': (0.55, 0.35), 'seat': (0.90, 0.00), 'screen': (0.28, 0.0), 'scrB': (0.28, 0.0),
               'scrC': (0.28, 0.0), 'scrD': (0.28, 0.0), 'glow': (0.35, 0.0), 'suit': (0.80, 0.0), 'visor': (0.08, 0.0)}   # v37.46: the arch read as chrome, the displays glinted
        orm = np.ones((512, 512, 4), np.float32)
        for rname, (rg, mt) in ORM.items():
            u0, v0, u1, v1 = REG[rname][:4]
            orm[int(v0 * 512):int(v1 * 512), int(u0 * 512):int(u1 * 512), 1] = rg
            orm[int(v0 * 512):int(v1 * 512), int(u0 * 512):int(u1 * 512), 2] = mt
        orm_img = bpy.data.images.new(f'{ship}_orm', 512, 512, alpha=True)
        orm_img.pixels.foreach_set(orm.ravel())
        orm_img.filepath_raw = os.path.join(ATLAS_DIR, f'{ship}_orm.png')
        orm_img.file_format = 'PNG'
        orm_img.save()
        orm_img.pack()
        orm_img.colorspace_settings.name = 'Non-Color'

        def atlas_material(name, alpha=None, emis_strength=1.5):
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            nt_ = m.node_tree
            b_ = nt_.nodes['Principled BSDF']
            t_ = new_image_node(nt_, int_img)
            nt_.links.new(t_.outputs['Color'], b_.inputs['Base Color'])
            e_ = new_image_node(nt_, emis_img)
            nt_.links.new(e_.outputs['Color'], b_.inputs['Emission Color'])
            b_.inputs['Emission Strength'].default_value = emis_strength
            o_ = new_image_node(nt_, orm_img)
            sep = nt_.nodes.new('ShaderNodeSeparateColor')
            nt_.links.new(o_.outputs['Color'], sep.inputs['Color'])
            nt_.links.new(sep.outputs['Green'], b_.inputs['Roughness'])
            nt_.links.new(sep.outputs['Blue'], b_.inputs['Metallic'])
            if alpha is not None:
                b_.inputs['Alpha'].default_value = alpha
                m.blend_method = 'BLEND'
                m.show_transparent_back = False
            m.use_backface_culling = True
            return m
        imesh.materials.append(atlas_material('cockpit_interior', emis_strength=1.0))
        hmesh.materials.append(atlas_material('cockpit_holo', alpha=HOLO_ALPHA, emis_strength=0.6))

    # ---------------- 7. decimate to the budget -----------------------------------------------
    n_in = len(me.polygons)
    if n_in > TARGET_TRIS * 1.10:      # 10% slack: the outline cuts add faces and must never trigger a decimation of the canopy region (Blaster lost 36k faces around the cockpit)
        near_mask = d < NEAR_R * L
        n_near = int(near_mask.sum())
        n_far = n_in - n_near
        # the near shells take at most NEAR_SHARE of the budget (a mid-hull eye pulls half the
        # hull into the near sphere: Blaster came out at 272k before this cap)
        r_near = min(NEAR_RATIO, NEAR_SHARE * TARGET_TRIS / max(1, n_near))
        r_far = max(FAR_RATIO_MIN, min(1.0, (TARGET_TRIS - n_near * r_near) / max(1, n_far)))
        bpy.ops.object.select_all(action='DESELECT')
        hull.select_set(True)
        vl.objects.active = hull
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_mode(type='FACE')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        me.polygons.foreach_set('select', near_mask)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        near_obj = next(o for o in sc.objects if o.type == 'MESH' and o != hull and o.name.startswith('mesh_0'))
        for obj, ratio in ((near_obj, r_near), (hull, r_far)):
            if ratio >= 0.999:
                continue
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            vl.objects.active = obj
            mod = obj.modifiers.new('dec', 'DECIMATE')
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            mod.delimit = {'MATERIAL'}          # never collapse across the glass border (slivers from the seat)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action='DESELECT')
        near_obj.select_set(True)
        hull.select_set(True)
        vl.objects.active = hull
        bpy.ops.object.join()
        me = hull.data
        rep['hull'].update({'near_faces': n_near, 'r_near': r_near, 'r_far': round(r_far, 4), 'tris_out': len(me.polygons)})
    else:
        rep['hull'].update({'tris_out': n_in})
    me.update()
    hull.name = 'mesh_0'
    me.name = 'mesh_0'

    # ---------------- renders --------------------------------------------------------------------
    if RENDER:
        sc.render.engine = 'BLENDER_EEVEE'
        sc.eevee.taa_render_samples = 16
        sc.render.resolution_x, sc.render.resolution_y = 960, 640
        sc.render.image_settings.file_format = 'PNG'
        world = bpy.data.worlds.new('W')
        sc.world = world
        world.use_nodes = True
        bgn = world.node_tree.nodes['Background']
        bgn.inputs[0].default_value = (0.45, 0.5, 0.6, 1)
        bgn.inputs[1].default_value = 1.0
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = 3.0
        sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
        sc.collection.objects.link(sun)
        cd = bpy.data.cameras.new('C')
        cam = bpy.data.objects.new('C', cd)
        sc.collection.objects.link(cam)
        sc.camera = cam

        def shot(name, loc, target, lens=40, clip_start=None):
            cd.lens = lens
            cd.clip_start = clip_start if clip_start else L * 0.004
            cd.clip_end = L * 60
            cam.location = loc
            look_at(cam, target)
            sc.render.filepath = os.path.join(REPORT_DIR, f'{ship}_{name}.png')
            bpy.ops.render.render(write_still=True)
        # the frame art is first-person only in the game ; show it in the seat shots only
        fobj = next((o for o in sc.objects if o.name.startswith('cockpit_frame')), None)
        if fobj:
            fobj.hide_render = True
        shot('front34', ctr + fwd * L * 0.9 + right * L * 0.7 + up * L * 0.5, ctr, lens=40)
        shot('canopy_close', g_ctr + fwd * L * 0.30 + right * L * 0.22 + up * L * 0.22, g_ctr, lens=55)
        shot('top_close', g_ctr + up * L * 0.5 + fwd * L * 0.03, g_ctr, lens=55)
        side_loc = g_ctr + right * L * 0.8 + up * L * 0.12
        shot('cutaway', side_loc, g_ctr, lens=55, clip_start=(side_loc - g_ctr).length - Wc * 0.05)
        if fobj:
            fobj.hide_render = False
        shot('pilotpov', eye_world, eye_world + fwd, lens=14)
        shot('pilotpov_down', eye_world, eye_world + fwd * 0.6 - up * 0.5, lens=14)
        shot('pilotpov_right', eye_world, eye_world + fwd * 0.4 + right * 0.9 - up * 0.2, lens=14)
        if fobj:
            fobj.hide_render = True
        # canopy debug: glass painted green
        dbg = bpy.data.materials.new('DBG')
        dbg.use_nodes = True
        dbg.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 1, 0.1, 1)
        dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.1, 1, 0.1, 1)
        dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.5
        me.materials[gi] = dbg
        shot('canopy_debug', g_ctr + fwd * L * 0.35 + right * L * 0.30 + up * L * 0.35, g_ctr, lens=50)
        me.materials[gi] = glass_mat
        if fobj:
            fobj.hide_render = False
        for o in [cam, sun]:
            bpy.data.objects.remove(o, do_unlink=True)

    # ---------------- 8. export -------------------------------------------------------------------
    if EXPORT:
        out = os.path.join(OUT_DIR, ship + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                                  export_texcoords=True, export_extras=False, export_lights=False,
                                  export_cameras=False, export_animations=False, use_selection=False)
        rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out)}
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(REPORT_DIR, ship + '_original.json'), 'w') as fh:
        json.dump(rep, fh, indent=1)
    print('ORIGINAL', json.dumps(rep))


for s in SHIPS:
    process(s)
print('ORIGINAL_DONE')
