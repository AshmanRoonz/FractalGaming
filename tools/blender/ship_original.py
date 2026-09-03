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

ORIG_DIR = os.path.join(REPO, 'LSS', 'ships_original')
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
ADJ_R = 0.012              # of L: a tinted (seed) face touching glass this closely joins outright
REF_DIR = os.path.join(REPO, 'tools', 'blender', 'work', 'ref')   # old-chain hulls (LSS/ships at v37.39/40) = the canopy reference
REF_TOL = 0.007            # of L: an original face this close to the reference glass surface IS canopy
REF_COMMIT = '5491ffb'     # v37.39: the last old-chain fleet in git (LSS/ships/<ship>.glb) - the reference is re-fetched from here when work/ref is empty
ISLAND_MAX = 1500          # loose shells up to this many faces, lying wholly in the glass fringe, become glass (Puncture's dark decal is ~1000)
GLASS_CFG = {
    'default': {'R': 0.18, 'sat': 0.30, 'val': 0.10, 'hue_tol': 0.10, 'min_comp': 20, 'z_below': 0.06},
    'pyro': {'R': 0.22, 'sat': 0.28, 'hue_tol': 0.12},
    'slayer': {'sat': 0.25, 'hue_tol': 0.22},      # its pane streaks are yellow-green, not the class green (see HULL_GLOW)
}
HOLO_ALPHA = 0.72


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


def import_glb(path, **kw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, **kw)
    new = [o for o in bpy.data.objects if o not in before]
    return [o for o in new if o.type == 'MESH'], [o for o in new if o.type == 'EMPTY']


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
    meshes, _ = import_glb(src)
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
    flab = np.empty(len(me.polygons), np.int32)
    me.attributes['shell'].data.foreach_get('value', flab)
    me.attributes.remove(me.attributes['shell'])
    rep['shells'] = n_shells
    bb = [Vector(c) for c in hull.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    L = max(hi - lo)
    ctr = (lo + hi) / 2
    rep['hull'] = {'tris_in': len(me.polygons), 'L': round(L, 4), 'dims': [round(v, 4) for v in (hi - lo)]}
    fwd, up, right = Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    frame = Matrix([[fwd.x, right.x, 0, 0], [fwd.y, right.y, 0, 0], [fwd.z, right.z, 1, 0], [0, 0, 0, 1]])

    # ---------------- 2. markers from the frozen hull -------------------------------------------
    fm, fe = import_glb(os.path.join(FROZEN_DIR, ship + '.glb'))
    mk = {}
    for e in fe:
        if any(e.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
            mk[e.name] = e.matrix_world.translation.copy()
    for o in fm + fe:
        bpy.data.objects.remove(o, do_unlink=True)
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
    rep['glass'] = {'seed_faces': int(seed.sum())}
    shell_n = np.bincount(flab, minlength=n_shells)
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(hull, dg)
    # TRANSFER: the canopy region comes from the old chain's glass (same surface, same frame ;
    # the owner judged those canopies in-game). Every original face within REF_TOL of that
    # surface, facing the same way, is canopy - bars and streaked panes included. No paint rule
    # survived these hulls: Vortex's canopy and fuselage share one purple, Pyro's bars and hull
    # one black, and every growth heuristic leaked over the nose.
    ref = load_reference_glass(ship)
    if ref is None:
        raise RuntimeError(f'{ship}: no reference glass in {REF_DIR} (copy LSS/ships/<ship>.glb of the old chain there)')
    bvh_ref = BVHTree.FromPolygons(ref[0], ref[1])
    glass = np.zeros(nP, bool)
    near_idx = np.nonzero(d < R * 1.6)[0]
    tol = REF_TOL * L
    for fi in near_idx:
        fi = int(fi)
        loc, n_, idx_, dist = bvh_ref.find_nearest(Vector(cen[fi]), tol * 3)
        if loc is not None and dist < tol and abs(n_.dot(Vector(nrm[fi]))) > 0.4:
            glass[fi] = True
    rep['glass'].update({'ref_polys': len(ref[1]), 'ref_components': ref[2], 'transferred': int(glass.sum())})
    if int(glass.sum()) < 10:
        raise RuntimeError(f'{ship}: reference glass transferred {int(glass.sum())} faces - frame mismatch?')
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
    sh_ok = (in_fr == shell_n) & (shell_n <= ISLAND_MAX) & (in_fr > 0)
    isl = sh_ok[flab] & ~glass
    islands = int(isl.sum())
    glass |= isl
    rep['glass']['islands'] = islands
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
    if cands:
        best = max(c[0] for c in cands)
        sc_, x, eye_world, glass_z_eye = max((c for c in cands if c[0] >= best - 0.03), key=lambda c: c[1])
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

    # ---------------- 6. floating dashboard + holo panels + seat --------------------------------
    origin_local = frame.transposed() @ eye_world
    B = Builder(frame, origin_local)          # local (0, 0, 0) = the eye ; x fwd, y right, z up
    if FRAME_ART and ship in FRAME_PNG and os.path.exists(os.path.join(REPO, FRAME_PNG[ship])):
        build_frame_billboard(ship, B, Vector((0, 0, 0)), Lc, rep)
    # holographic side panels: two tilted screens floating beside the dash, a glow bar under each
    Bh = Builder(frame, origin_local)
    for sgn in (1, -1):
        yaw = sgn * math.radians(38)
        r_ = 0.28 * Lc
        c_ = Vector((r_ * math.cos(yaw), r_ * math.sin(yaw), -0.06 * Lc))
        Bh.box(c_, (0.006 * Lc, 0.14 * Lc, 0.09 * Lc), rot=(0, math.radians(-8), yaw), region='scrB' if sgn > 0 else 'scrC')
        Bh.box(c_ + Vector((0, 0, -0.062 * Lc)), (0.006 * Lc, 0.14 * Lc, 0.012 * Lc), rot=(0, 0, yaw), region='glow')
    # (a readout above the centre display was tried: it floated in the sky over the nose)
    Bh.assign_uvs(tile_len=0.30 * Wc)
    bmesh.ops.recalc_face_normals(Bh.bm, faces=list(Bh.bm.faces))
    hmesh = bpy.data.meshes.new('cockpit_holo')
    Bh.bm.to_mesh(hmesh)
    Bh.bm.free()
    hobj = bpy.data.objects.new('cockpit_holo', hmesh)
    sc.collection.objects.link(hobj)
    # seat, only when the pit leaves room for it
    seat_built = False
    if floor_z is not None and (eye_z - floor_z) > 0.22 * Lc:
        pan_z = -0.30 * Lc                                      # hips under the eye
        B.box(Vector((-0.02 * Lc, 0, pan_z)), (0.30 * Lc, 0.22 * Lc, 0.05 * Lc), region='seat', bevel=0.004 * Lc)
        B.box(Vector((-0.17 * Lc, 0, pan_z * 0.5 + 0.02 * Lc)), (0.05 * Lc, 0.22 * Lc, -pan_z - 0.06 * Lc), region='seat', bevel=0.004 * Lc)
        B.box(Vector((-0.17 * Lc, 0, 0.07 * Lc)), (0.05 * Lc, 0.11 * Lc, 0.09 * Lc), region='seat', bevel=0.004 * Lc)
        for sgn in (1, -1):
            B.box(Vector((-0.02 * Lc, sgn * 0.13 * Lc, pan_z + 0.07 * Lc)), (0.26 * Lc, 0.03 * Lc, 0.03 * Lc), region='trim', bevel=0.003 * Lc)
        ped_top = pan_z - 0.025 * Lc
        ped_bot = -(eye_z - floor_z) + 0.01 * Lc
        if ped_top - ped_bot > 0.02 * Lc:
            B.box(Vector((-0.04 * Lc, 0, (ped_top + ped_bot) / 2)), (0.16 * Lc, 0.12 * Lc, ped_top - ped_bot), region='metal', bevel=0.003 * Lc)
        seat_built = True
    B.assign_uvs(tile_len=0.30 * Wc)
    bmesh.ops.recalc_face_normals(B.bm, faces=list(B.bm.faces))
    imesh = bpy.data.meshes.new('cockpit_interior')
    B.bm.to_mesh(imesh)
    B.bm.free()
    iobj = bpy.data.objects.new('cockpit_interior', imesh)
    sc.collection.objects.link(iobj)
    rep['interior'] = {'seat': seat_built, 'holo_faces': len(hmesh.polygons), 'interior_faces': len(imesh.polygons)}
    # materials: the interior atlas (opaque) and a translucent self-lit copy for the holograms
    int_png, emis_png = build_atlas(ship, tint)
    int_img = bpy.data.images.load(int_png)
    emis_img = bpy.data.images.load(emis_png)
    int_img.pack()
    emis_img.pack()

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
        b_.inputs['Roughness'].default_value = 0.7
        b_.inputs['Metallic'].default_value = 0.25
        if alpha is not None:
            b_.inputs['Alpha'].default_value = alpha
            m.blend_method = 'BLEND'
            m.show_transparent_back = False
        m.use_backface_culling = True
        return m
    imesh.materials.append(atlas_material('cockpit_interior'))
    hmesh.materials.append(atlas_material('cockpit_holo', alpha=HOLO_ALPHA, emis_strength=2.2))

    # ---------------- 7. decimate to the budget -----------------------------------------------
    n_in = len(me.polygons)
    if n_in > TARGET_TRIS:
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
