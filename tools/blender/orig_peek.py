"""Peek at LSS/ships_original/<Ship>.glb: dims + orientation vs the frozen hull, outside renders,
and a cut-away render (camera near plane slices just under the canopy skin) to see the interior.
Usage: blender --background --python tools/blender/orig_peek.py -- [--ships pyro,vortex]"""
import bpy, os, sys, math, json, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools', 'blender', 'reports', 'orig')
os.makedirs(OUT, exist_ok=True)
SHIPS = [s for s in opt('--ships', 'vortex,pyro,puncture,slayer,tracker,blaster,syphon').split(',') if s]

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    empties = [o for o in new if o.type == 'EMPTY']
    return meshes, empties

def verts_world(objs):
    arrs = []
    for o in objs:
        me = o.data
        n = len(me.vertices)
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        M = np.array(o.matrix_world)
        arrs.append(co @ M[:3, :3].T + M[:3, 3])
    return np.concatenate(arrs) if arrs else np.zeros((0, 3), np.float32)

def sym_score(P, axis):
    """mirror-symmetry error across plane axis=0 (lower = more symmetric), on a subsample"""
    q = P[np.random.default_rng(0).choice(len(P), min(20000, len(P)), replace=False)].copy()
    m = q.copy(); m[:, axis] *= -1
    # nearest-neighbour distance via a coarse grid
    from scipy.spatial import cKDTree  # may not exist in blender python
    return float(cKDTree(q).query(m)[0].mean())

def sym_score_np(P, axis):
    rng = np.random.default_rng(0)
    q = P[rng.choice(len(P), min(6000, len(P)), replace=False)].copy()
    m = q.copy(); m[:, axis] *= -1
    d = ((m[:, None, :] - q[None, :, :]) ** 2).sum(-1)
    return float(np.sqrt(d.min(1)).mean())

def cam_look(loc, target, name='cam', lens=35, clip_start=0.01, clip_end=1000, ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = clip_start
    cd.clip_end = clip_end
    if ortho:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    d = (Vector(target) - Vector(loc)).normalized()
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam

def render(path, cam, res=(900, 700)):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_backface_culling = False
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)

report = {}
for ship in SHIPS:
    t0 = time.time()
    clear()
    src = os.path.join(REPO, 'LSS', 'ships_original', ship.capitalize() + '.glb')
    if not os.path.exists(src):
        print('MISSING', src); continue
    meshes, empties = import_glb(src)
    P = verts_world(meshes)
    lo, hi = P.min(0), P.max(0)
    dims = hi - lo
    ctr = (lo + hi) / 2
    # frozen hull for comparison (dims + markers)
    fm, fe = import_glb(os.path.join(REPO, 'assets_base', 'ships', ship + '.glb'))
    FP = verts_world(fm)
    flo, fhi = FP.min(0), FP.max(0)
    fdims = fhi - flo
    markers = {e.name: [round(float(v), 4) for v in e.matrix_world.translation] for e in fe}
    for o in fm + fe:
        bpy.data.objects.remove(o, do_unlink=True)
    # symmetry: which of x / y is the mirror plane (both centred first)
    Pc = P - ctr
    sx, sy = sym_score_np(Pc, 0), sym_score_np(Pc, 1)
    ntri = sum(len(o.data.polygons) for o in meshes)
    info = {'tris': ntri, 'objects': len(meshes), 'dims': [round(float(v), 4) for v in dims],
            'centre': [round(float(v), 4) for v in ctr], 'frozen_dims': [round(float(v), 4) for v in fdims],
            'frozen_centre': [round(float(v), 4) for v in ((flo + fhi) / 2)],
            'sym_err_x_plane': round(sx, 5), 'sym_err_y_plane': round(sy, 5), 'frozen_markers': markers}
    L = float(max(dims))
    # ---- renders: 3/4 front-top, side, top ; cut-away from above at the canopy apex
    world = bpy.context.scene.world or bpy.data.worlds.new('W')
    bpy.context.scene.world = world
    c = Vector(ctr)
    cam = cam_look(c + Vector((-1.6 * L, 1.2 * L, 0.9 * L)), c, 'c34', lens=40)
    render(os.path.join(OUT, f'{ship}_34.png'), cam)
    cam = cam_look(c + Vector((0, 2.2 * L, 0.0)), c, 'cside', lens=40)
    render(os.path.join(OUT, f'{ship}_side.png'), cam)
    cam = cam_look(c + Vector((0, 0.0001, 2.2 * L)), c, 'ctop', lens=40)
    render(os.path.join(OUT, f'{ship}_top.png'), cam)
    # canopy apex: highest point in the central strip; cut-away = camera above, near plane just under the apex
    strip = np.abs(Pc[:, 1]) < 0.08 * dims[1]
    iz = int(np.argmax(Pc[strip, 2]))
    apex = Pc[strip][iz] + ctr
    info['apex'] = [round(float(v), 4) for v in apex]
    h = 1.2 * L
    for k, depth in enumerate((0.03, 0.08, 0.15)):
        cam = cam_look(Vector(apex) + Vector((0, 0.0001, h)), Vector(apex), f'ccut{k}', lens=50, clip_start=h + depth * L)
        render(os.path.join(OUT, f'{ship}_cut{k}.png'), cam)
    # a peek from INSIDE: camera 0.06 L below the apex looking forward (-x) and one looking back
    for nm, fwd in (('fwd', -1), ('back', 1)):
        eye = Vector(apex) + Vector((0, 0, -0.06 * L))
        cam = cam_look(eye, eye + Vector((fwd * 1.0, 0, -0.15)), f'cin_{nm}', lens=18, clip_start=0.005 * L)
        render(os.path.join(OUT, f'{ship}_in_{nm}.png'), cam)
    info['seconds'] = round(time.time() - t0, 1)
    report[ship] = info
    print('PEEK', ship, json.dumps(info))
json.dump(report, open(os.path.join(OUT, 'peek.json'), 'w'), indent=1)
print('DONE')
