"""ship_intake.py - a Meshy hull becomes a pipeline hull.

    blender --background --python tools/blender/ship_intake.py -- --ship slayer --glb assets_base/cockpits/candidates/ship_slayer_a_refined/model.glb [--render]

Reads the generated GLB (PBR textures embedded), joins it into ONE mesh, puts it on the
CANONICAL ship axes (forward -X, right +Y, up +Z, symmetry plane y = 0, bbox centred, length
2.0), places the marker empties the game and the cockpit stage read (gun1/gun2, thruster1..4,
cockpit1) from the geometry, and writes assets_base/ships_v2/<ship>.glb. Per-ship overrides
live in tools/blender/intake/<ship>.json:
    { "flip_forward": true,            # the nose heuristic picked the wrong end
      "yaw_deg": 0,                    # extra yaw before canonicalising
      "markers": { "gun1": [x, y, z] } # canonical-frame positions (units of the 2.0 hull)
    }
--render draws the markers as coloured spheres from the top and the side into
tools/blender/reports/intake/<ship>_markers_*.png (red = gun, blue = thruster, yellow = eye).
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else default
    return default


SHIP = opt('--ship')
GLB = opt('--glb')
RENDER = '--render' in argv
OUT_DIR = os.path.join(ROOT, opt('--out', 'assets_base/ships_v2'))
REPORT_DIR = os.path.join(ROOT, 'tools', 'blender', 'reports', 'intake')
if not SHIP or not GLB:
    sys.exit(__doc__)
GLB = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)
ovr_path = os.path.join(ROOT, 'tools', 'blender', 'intake', f'{SHIP}.json')
OVR = json.load(open(ovr_path, encoding='utf-8')) if os.path.exists(ovr_path) else {}

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=True)
meshes = [o for o in sc.objects if o.type == 'MESH']
for o in list(sc.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
hull = bpy.context.view_layer.objects.active
hull.name = 'hull'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = hull.data
rep = {'ship': SHIP, 'source': os.path.relpath(GLB, ROOT), 'faces_in': len(me.polygons), 'materials': [m.name for m in me.materials if m]}


def verts_np():
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', v)
    return v.reshape(-1, 3)


def apply_matrix(M):
    hull.matrix_world = M @ hull.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    hull.select_set(True)
    bpy.context.view_layer.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


# ---- canonical axes ----------------------------------------------------------------------
# The forward axis is NOT the long one (a wide-winged hull is wider than it is long) : it is
# the horizontal axis that lies IN the mirror plane. Mirror the vertices across each
# candidate plane and keep the axis whose mirror lands closest to the real surface.
from mathutils.kdtree import KDTree
v = verts_np()
ctr0 = (v.max(0) + v.min(0)) / 2


def mirror_error(axis):
    sub = v[::max(1, len(v) // 20000)]
    kd = KDTree(len(sub))
    for i, q in enumerate(sub):
        kd.insert(Vector(q), i)
    kd.balance()
    m = sub.copy()
    m[:, axis] = 2 * ctr0[axis] - m[:, axis]
    d = np.array([kd.find(Vector(q))[2] for q in m[::4]])
    return float(np.median(d))


err_x, err_y = mirror_error(0), mirror_error(1)        # mirror across x = c (plane YZ) / y = c (plane XZ)
rep['mirror_error'] = {'across_x': round(err_x, 4), 'across_y': round(err_y, 4)}
# a plane with LOW error is the symmetry plane ; forward lies in it. Plane x = c (mirroring x)
# being symmetric means forward is along Y -> yaw so forward becomes X.
if err_x < err_y:
    apply_matrix(Matrix.Rotation(math.radians(90), 4, 'Z'))
    v = verts_np()
if OVR.get('yaw_deg'):
    apply_matrix(Matrix.Rotation(math.radians(OVR['yaw_deg']), 4, 'Z'))
    v = verts_np()
# nose vs tail: engine nozzles are big faces looking straight back along the axis. Compare
# outward-facing face area at the two ends ; tie-break with the canopy apex (front half).
nP0 = len(me.polygons)
cen0 = np.empty(nP0 * 3, np.float32)
me.polygons.foreach_get('center', cen0)
cen0 = cen0.reshape(-1, 3)
nrm0 = np.empty(nP0 * 3, np.float32)
me.polygons.foreach_get('normal', nrm0)
nrm0 = nrm0.reshape(-1, 3)
ar0 = np.empty(nP0, np.float32)
me.polygons.foreach_get('area', ar0)
x0, x1 = v[:, 0].min(), v[:, 0].max()
L0 = x1 - x0
a_lo = float(ar0[(cen0[:, 0] < x0 + 0.15 * L0) & (nrm0[:, 0] < -0.7)].sum())   # faces looking out of the -X end
a_hi = float(ar0[(cen0[:, 0] > x1 - 0.15 * L0) & (nrm0[:, 0] > 0.7)].sum())    # faces looking out of the +X end
W0 = np.ptp(v[:, 1])
strip0 = np.abs(v[:, 1] - (v[:, 1].max() + v[:, 1].min()) / 2) < 0.12 * W0
apex_x = float(v[strip0][np.argmax(v[strip0][:, 2])][0]) if strip0.any() else float((x0 + x1) / 2)
tail_at_hi = a_hi > a_lo * 1.15 or (a_hi > a_lo * 0.87 and apex_x < (x0 + x1) / 2)
nose_at_low_x = tail_at_hi
if OVR.get('flip_forward'):
    nose_at_low_x = not nose_at_low_x
rep['nose_heuristic'] = {'nozzle_area_-X': round(a_lo, 4), 'nozzle_area_+X': round(a_hi, 4),
                         'apex_x_frac': round((apex_x - x0) / L0, 3), 'nose_at_-X': bool(nose_at_low_x)}
if not nose_at_low_x:                     # canonical forward is -X
    apply_matrix(Matrix.Rotation(math.radians(180), 4, 'Z'))
    v = verts_np()
# centre + scale to length 2.0
lo, hi = v.min(0), v.max(0)
ctr = (lo + hi) / 2
scale = 2.0 / (hi[0] - lo[0])
apply_matrix(Matrix.Translation(Vector(-ctr)))
apply_matrix(Matrix.Diagonal((scale, scale, scale, 1.0)))
v = verts_np()
lo, hi = v.min(0), v.max(0)
L, W, H = float(hi[0] - lo[0]), float(hi[1] - lo[1]), float(hi[2] - lo[2])
rep['dims'] = {'L': round(L, 3), 'W': round(W, 3), 'H': round(H, 3)}

# ---- markers from the geometry ----------------------------------------------------------
nP = len(me.polygons)
cen = np.empty(nP * 3, np.float32)
me.polygons.foreach_get('center', cen)
cen = cen.reshape(-1, 3)
nrm = np.empty(nP * 3, np.float32)
me.polygons.foreach_get('normal', nrm)
nrm = nrm.reshape(-1, 3)
area = np.empty(nP, np.float32)
me.polygons.foreach_get('area', area)


def clusters(mask, radius):
    """Greedy area-weighted clusters of face centres."""
    idx = np.nonzero(mask)[0]
    idx = idx[np.argsort(-area[idx])]
    out = []
    for i in idx:
        c = cen[i]
        for cl in out:
            if np.linalg.norm(cl['c'] - c) < radius:
                w = cl['a'] + area[i]
                cl['c'] = (cl['c'] * cl['a'] + c * area[i]) / w
                cl['a'] = w
                cl['n'] += 1
                break
        else:
            out.append({'c': c.copy(), 'a': float(area[i]), 'n': 1})
    out.sort(key=lambda cl: -cl['a'])
    return out


markers = {}
# thrusters: rear-facing faces in the last 15% of the length
rear = (cen[:, 0] > hi[0] - 0.15 * L) & (nrm[:, 0] > 0.6)
th = [cl for cl in clusters(rear, 0.09 * L) if cl['a'] > 0.0004 * L * L][:4]
th.sort(key=lambda cl: (abs(cl['c'][1]), -cl['a']))
for i, cl in enumerate(th):
    markers[f'thruster{i + 1}'] = [float(cl['c'][0]) + 0.01 * L, float(cl['c'][1]), float(cl['c'][2])]
# guns: forward-facing faces in the first 10%
front = (cen[:, 0] < lo[0] + 0.10 * L) & (nrm[:, 0] < -0.5)
gn = [cl for cl in clusters(front, 0.07 * L) if cl['a'] > 0.00015 * L * L][:4]
gn.sort(key=lambda cl: -cl['a'])
right = [cl for cl in gn if cl['c'][1] > 0.04 * W]
left = [cl for cl in gn if cl['c'][1] < -0.04 * W]
centre = [cl for cl in gn if abs(cl['c'][1]) <= 0.04 * W]
if right and left:
    markers['gun1'] = [float(x) for x in right[0]['c']]
    markers['gun2'] = [float(x) for x in left[0]['c']]
elif gn:
    markers['gun1'] = [float(x) for x in gn[0]['c']]
for k in list(markers):
    if k.startswith('gun'):
        markers[k][0] -= 0.01 * L
# eye seed. First choice: the PAINTED canopy - Meshy paints a dark, matte tinted glass on a
# closed bulge (and the open cavities read dark too): the largest cluster of dark,
# unsaturated, upward faces in the front 65% near the centreline. Fallback: the highest
# point on the centre strip in the front 60% (fails when the spine or tail is taller).
def face_paint(me):
    mat0 = me.materials[0]
    img = next((n.image for n in mat0.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    if img is None or not me.uv_layers.active:
        return None, None, None
    Wi, Hi = img.size
    px = np.empty(Wi * Hi * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(Hi, Wi, 4)
    n_ = len(me.polygons)
    ls = np.empty(n_, np.int32)
    lt = np.empty(n_, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    me.polygons.foreach_get('loop_total', lt)
    uvs = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    cum = np.cumsum(uvs, axis=0)
    cs = np.concatenate([[0.0], cum[:, 0]])
    ct = np.concatenate([[0.0], cum[:, 1]])
    fu = (cs[ls + lt] - cs[ls]) / lt
    fv = (ct[ls + lt] - ct[ls]) / lt
    ix = (np.mod(fu, 1.0) * Wi).astype(int).clip(0, Wi - 1)
    iy = (np.mod(fv, 1.0) * Hi).astype(int).clip(0, Hi - 1)
    col = px[iy, ix, :3]
    mx = col.max(1)
    mn = col.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r_, g_, b_ = col[:, 0], col[:, 1], col[:, 2]
    dlt = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r_, ((g_ - b_) / dlt) % 6, np.where(mx == g_, (b_ - r_) / dlt + 2, (r_ - g_) / dlt + 4)) / 6.0
    return mx, sat, hue


val, sat, hue = face_paint(me)
cockpit = None
if val is not None:
    hull_val = float(np.median(val))
    if OVR.get('canopy_hue') is not None:
        # chroma-keyed canopy (the refine painted it a colour the hull never wears)
        dh = np.abs(hue - float(OVR['canopy_hue']))
        dh = np.minimum(dh, 1 - dh)
        dark = (dh < 0.08) & (sat > 0.45) & (val > 0.30) & (nrm[:, 2] > 0.0) & (np.abs(cen[:, 1]) < 0.25 * W)
    else:
        dark = (val < min(0.32, 0.55 * hull_val)) & (sat < 0.40) & (nrm[:, 2] > 0.25) & (cen[:, 0] < lo[0] + 0.65 * L) & (np.abs(cen[:, 1]) < 0.18 * W)
    cl = [c for c in clusters(dark, 0.06 * L) if c['a'] > 0.0015 * L * L]
    if cl:
        c0 = cl[0]['c']
        under = (np.abs(v[:, 0] - c0[0]) < 0.05 * L) & (np.abs(v[:, 1] - c0[1]) < 0.05 * W)
        ztop = float(v[under][:, 2].max()) if under.any() else float(c0[2])
        cockpit = [float(c0[0]), 0.0, ztop - 0.01 * L]
        rep['cockpit_by_paint'] = {'cluster_area': round(cl[0]['a'], 4), 'faces': cl[0]['n'], 'hull_val': round(hull_val, 3)}
if cockpit is None:
    strip = (np.abs(v[:, 1]) < 0.12 * W) & (v[:, 0] < lo[0] + 0.60 * L)
    top = v[strip][np.argmax(v[strip][:, 2])] if strip.any() else np.array([lo[0] + 0.3 * L, 0, hi[2]])
    cockpit = [float(top[0]), 0.0, float(top[2]) - 0.01 * L]
    rep['cockpit_by_paint'] = None
markers['cockpit1'] = cockpit
for k, p in (OVR.get('markers') or {}).items():
    markers[k] = [float(x) for x in p]
rep['markers'] = {k: [round(x, 3) for x in p] for k, p in markers.items()}
for k, p in markers.items():
    e = bpy.data.objects.new(k, None)
    e.empty_display_type = 'SPHERE'
    e.empty_display_size = 0.02
    e.location = Vector(p)
    sc.collection.objects.link(e)

# ---- export ------------------------------------------------------------------------------
out = os.path.join(OUT_DIR, f'{SHIP}.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_texcoords=True, export_normals=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_animations=False)
rep['export'] = {'path': os.path.relpath(out, ROOT), 'bytes': os.path.getsize(out)}

# ---- marker render -----------------------------------------------------------------------
if RENDER:
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 960, 720
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.09, 0.10, 0.12, 1)
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cols = {'gun': (1, 0.1, 0.1, 1), 'thruster': (0.2, 0.4, 1, 1), 'cockpit': (1, 0.9, 0.1, 1)}
    for k, p in markers.items():
        kind = 'gun' if k.startswith('gun') else ('thruster' if k.startswith('thruster') else 'cockpit')
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.03)
        m_ = bpy.data.meshes.new('g_' + k)
        bm.to_mesh(m_)
        bm.free()
        g = bpy.data.objects.new('g_' + k, m_)
        g.location = Vector(p)
        mat = bpy.data.materials.new('m_' + k)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = cols[kind]
        bsdf.inputs['Emission Color'].default_value = cols[kind]
        bsdf.inputs['Emission Strength'].default_value = 2.0
        m_.materials.append(mat)
        sc.collection.objects.link(g)

    def shot(name, loc, target, lens=40):
        cam.location = Vector(loc)
        d = (Vector(target) - cam.location).normalized()
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        sc.render.filepath = os.path.join(REPORT_DIR, f'{SHIP}_markers_{name}.png')
        bpy.ops.render.render(write_still=True)

    shot('top', (0, 0.001, 3.2), (0, 0, 0))
    shot('side', (0.001, -3.2, 0.4), (0, 0, 0))
    shot('front34', (-2.6, -2.0, 1.4), (0, 0, 0))
json.dump(rep, open(os.path.join(REPORT_DIR, f'{SHIP}_intake.json'), 'w', encoding='utf-8'), indent=1)
print('INTAKE', json.dumps(rep))
