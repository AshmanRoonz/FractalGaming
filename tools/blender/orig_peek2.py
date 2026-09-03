"""Targeted cockpit peek at LSS/ships_original: sections + pilot views around the FROZEN hull's
cockpit1 marker (same frame/scale, verified), and a loose-parts inventory near it."""
import bpy, os, sys, math, json, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools', 'blender', 'reports', 'orig')
SHIPS = [s for s in opt('--ships', 'vortex,pyro,puncture,slayer,tracker,blaster,syphon').split(',') if s]
peek = json.load(open(os.path.join(OUT, 'peek.json')))

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return [o for o in new if o.type == 'MESH'], [o for o in new if o.type == 'EMPTY']

def cam_look(loc, target, name, lens=35, clip_start=0.002, clip_end=1000):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_start = clip_start; cd.clip_end = clip_end
    cam = bpy.data.objects.new(name, cd); bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).normalized().to_track_quat('-Z', 'Y').to_euler()
    return cam

def render(path, cam, cull=False, res=(900, 700)):
    sc = bpy.context.scene; sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_backface_culling = cull; sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path; sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)

for ship in SHIPS:
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new('W')
    meshes, _ = import_glb(os.path.join(REPO, 'LSS', 'ships_original', ship.capitalize() + '.glb'))
    hull = meshes[0]
    bpy.ops.object.select_all(action='DESELECT'); hull.select_set(True); bpy.context.view_layer.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = hull.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    L = float(max(peek[ship]['dims']))
    cp = Vector(peek[ship]['frozen_markers']['cockpit1'])
    # skin top above the marker: max z within 0.03 L of (x, y)
    near = (np.abs(co[:, 0] - cp.x) < 0.03 * L) & (np.abs(co[:, 1] - cp.y) < 0.03 * L)
    ztop = float(co[near, 2].max()) if near.any() else cp.z
    zbot = float(co[near, 2].min()) if near.any() else cp.z
    info = {'cockpit1': list(cp), 'skin_top_z': round(ztop, 4), 'skin_bot_z': round(zbot, 4), 'L': L}
    fwd, up, right = Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    # longitudinal section through y=0 (camera on +y, near plane at the symmetry plane)
    d = 0.9 * L
    cam = cam_look(cp + right * d + up * 0.05 * L, cp, 'sec_side', lens=60, clip_start=d + cp.y)
    render(os.path.join(OUT, f'{ship}_sec_side.png'), cam)
    # top section: just under the skin, and deeper
    h = 0.9 * L
    for k, dz in enumerate((0.015, 0.05)):
        cam = cam_look(cp + up * h + Vector((0, 1e-4, 0)), cp, f'sec_top{k}', lens=60, clip_start=h - (ztop - dz * L - cp.z))
        render(os.path.join(OUT, f'{ship}_sec_top{k}.png'), cam)
    # pilot views from the marker: culled (as the game renders) and double-sided
    for cull in (True, False):
        tag = 'cull' if cull else 'ds'
        cam = cam_look(cp, cp + fwd - up * 0.15, f'pov_fwd_{tag}', lens=16, clip_start=0.003 * L)
        render(os.path.join(OUT, f'{ship}_pov_fwd_{tag}.png'), cam, cull=cull)
        cam = cam_look(cp, cp + fwd * 0.5 - up * 0.8, f'pov_down_{tag}', lens=16, clip_start=0.003 * L)
        render(os.path.join(OUT, f'{ship}_pov_down_{tag}.png'), cam, cull=cull)
    # loose parts inventory (on a copy) : count + the parts whose bbox centre lies within 0.25 L of the marker
    dup = hull.copy(); dup.data = hull.data.copy(); bpy.context.scene.collection.objects.link(dup)
    bpy.ops.object.select_all(action='DESELECT'); dup.select_set(True); bpy.context.view_layer.objects.active = dup
    hull.hide_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o != hull]
    inv = []
    for o in parts:
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector([min(v[i] for v in bb) for i in range(3)]); hi = Vector([max(v[i] for v in bb) for i in range(3)])
        c = (lo + hi) / 2
        inv.append({'tris': len(o.data.polygons), 'c': [round(v, 3) for v in c], 'dims': [round(v, 3) for v in (hi - lo)], 'dist': round((c - cp).length / L, 3)})
    inv.sort(key=lambda r: -r['tris'])
    info['parts'] = len(parts)
    info['big_parts'] = inv[:6]
    info['parts_near_cockpit'] = [r for r in inv if r['dist'] < 0.25 and r['tris'] > 50][:25]
    info['seconds'] = round(time.time() - t0, 1)
    print('PEEK2', ship, json.dumps(info))
    json.dump(info, open(os.path.join(OUT, f'{ship}_peek2.json'), 'w'), indent=1)
print('DONE')
