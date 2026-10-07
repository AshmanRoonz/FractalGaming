"""seatfit.py - fit a seated character into each ship's seat; print a per-ship placement table + render checks.

    "$B" -b --factory-startup -P tools/blender/chars/seatfit.py -- --char assets_src/objects/characters/pilot_ashman.glb \
        --clip Sit_and_Doze_Off --frame 1 --ships LSS/ships/tracker.glb,... --out tools/blender/work/chars/seat_pilot.json \
        [--renders tools/blender/work/chars/seat_]

Everything is measured in the SHIP GLB's model space (glTF: forward -X, up +Y), the space the game parents the
character into. Per ship:
  eye    = the 'cockpit1' marker (the first-person camera seat)
  pan    = first hit of a ray straight down from the eye onto the seat geometry (every mesh but the outer hull
           and glass)                                 -> how far below the eye the seat cushion is
  back   = first hit of a ray from the eye straight back (+X)   -> where the backrest is
Per character (posed at --clip/--frame, measured with its rest scale):
  eyeC   = the head bone + a forward/up offset (Meshy heads: the eyes sit ~0.09 m ahead of and ~0.07 m above the
           head joint)
  buttC  = the lowest point of the vertices weighted mostly to the hips (what sits on the cushion)
  backC  = the rearmost point of the torso (spine-weighted) vertices
Fit: scale s = (eye - pan) / (eyeC - buttC) vertically, the character turned to face -X, placed so its eye lands
on the marker's height and its back on the backrest (a small gap), and centred on the marker sideways.
"""
import bpy, sys, os, json, math, mathutils
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
opt = {argv[i].lstrip('-'): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

# ---- the character, posed
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(opt['char']))
cobjs = [o for o in bpy.data.objects if o not in before]
carm = next(o for o in cobjs if o.type == 'ARMATURE')
cme = max((o for o in cobjs if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
act = bpy.data.actions.get(opt['clip']) or next(a for a in bpy.data.actions if opt['clip'] in a.name)
carm.animation_data.action = act
if act.slots:
    carm.animation_data.action_slot = act.slots[0]
scn.frame_set(int(opt.get('frame', 1)))
dg = bpy.context.evaluated_depsgraph_get()
ev = cme.evaluated_get(dg); em = ev.to_mesh()
P = np.array([ev.matrix_world @ v.co for v in em.vertices]); ev.to_mesh_clear()
gn = {g.index: g.name.replace('mixamorig:', '') for g in cme.vertex_groups}
dom = []
for v in cme.data.vertices:
    d = {gn[g.group]: g.weight for g in v.groups}
    dom.append(max(d, key=d.get) if d else '-')
dom = np.array(dom)
# glTF space (x, y, z) = Blender (x, z, -y); the character imported facing glTF +Z (Blender -Y)
def to_gl(p):
    return np.array([p[0], p[2], -p[1]])
PG = np.array([to_gl(p) for p in P])
head = carm.matrix_world @ carm.pose.bones['mixamorig:Head'].head
headG = to_gl(head)
ch = float(PG[:, 1].max() - PG[:, 1].min())
eyeC = headG + np.array([0, 0.07, 0.09]) * (ch / 1.0) / max(ch, 1e-6) * 1.0   # the offsets are in metres, the rig is metric
hips_m = np.isin(dom, ['Hips', 'LeftUpLeg', 'RightUpLeg'])
buttC = float(PG[hips_m, 1].min())
torso = np.isin(dom, ['Spine', 'Spine1', 'Spine2', 'Hips'])
backC = float(PG[torso, 2].min())          # character faces +Z, so its back is its min Z
midX = float(np.median(PG[torso, 0]))
char = {'eye': eyeC.tolist(), 'butt_y': buttC, 'back_z': backC, 'mid_x': midX, 'height_posed': ch}
for o in cobjs:
    o.hide_render = True

res = {'char': opt['char'], 'clip': act.name, 'frame': int(opt.get('frame', 1)), 'charm': char, 'ships': {}}
for sp in opt['ships'].split(','):
    name = os.path.splitext(os.path.basename(sp))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(sp))
    sobjs = [o for o in bpy.data.objects if o not in before]
    mk = next((o for o in sobjs if o.name.split('.')[0] == 'cockpit1'), None)
    if mk is None:
        res['ships'][name] = {'err': 'no cockpit1'}; continue
    eye = to_gl(mk.matrix_world.translation)
    # seat geometry: every mesh except the outer hull and any glass
    hull = max((o for o in sobjs if o.type == 'MESH'), key=lambda o: o.dimensions.length)
    seat = [o for o in sobjs if o.type == 'MESH' and o is not hull and not any(
        'glass' in (m.name.lower() if m else '') or 'windshield' in (m.name.lower() if m else '') for m in o.data.materials)]
    verts = []; tris = []
    for o in seat:
        e2 = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        base = len(verts)
        for v in e2.vertices:
            verts.append(tuple(to_gl(o.matrix_world @ v.co)))
        e2.calc_loop_triangles()
        for t in e2.loop_triangles:
            tris.append(tuple(base + i for i in t.vertices))
        o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    bvh = mathutils.bvhtree.BVHTree.FromPolygons(verts, tris)
    def ray(o, d):
        h = bvh.ray_cast(mathutils.Vector(o), mathutils.Vector(d))
        return None if h[0] is None else h[3]
    dpan = ray(eye + np.array([0.0, 0, 0]), (0, -1, 0))
    # sample a few points just behind / in front of the eye too: the pan is the highest surface under the torso
    pans = [ray(eye + np.array([dx, 0, 0]), (0, -1, 0)) for dx in (-0.02, 0.0, 0.02, 0.04)]
    pans = [p for p in pans if p is not None]
    dback = ray(eye, (1, 0, 0))
    info = {'eye': eye.tolist(), 'pan_drop': min(pans) if pans else None, 'back_dist': dback,
            'seat_meshes': [o.name for o in seat], 'hull': hull.name}
    pod = next((o for o in sobjs if o.type == 'MESH' and o.name.endswith('_game_cockpit')), None)
    if pod is not None and not opt.get('pan_y'):
        # POD MODE (the seven concept hulls): every seat is the same Meshy pod, hand-placed and reshaped per ship
        # in Ship Lab XR, so read it directly. Centreline rays down give the profile: footwell, a flat cushion,
        # then the jump up to the backrest. backrest face = first hit of a ray from the front at 0.5 / 0.75 of the
        # pod's height; cushion = median height over the last 35% of the pod in front of that face.
        dgp = bpy.context.evaluated_depsgraph_get(); pm = pod.evaluated_get(dgp).to_mesh(); pm.calc_loop_triangles()
        PV = [mathutils.Vector(to_gl(pod.matrix_world @ v.co)) for v in pm.vertices]; PT = [tuple(t.vertices) for t in pm.loop_triangles]
        pod.evaluated_get(dgp).to_mesh_clear()
        pb = mathutils.bvhtree.BVHTree.FromPolygons(PV, PT)
        px0 = min(v.x for v in PV); py0 = min(v.y for v in PV); py1 = max(v.y for v in PV)
        fr = []
        for fy in (0.5, 0.75):
            h = pb.ray_cast(mathutils.Vector((px0 - 0.1, py0 + (py1 - py0) * fy, 0.0)), mathutils.Vector((1, 0, 0)))
            if h[0] is not None:
                fr.append(h[0].x)
        x_back = sum(fr) / len(fr)
        a = x_back - 0.35 * (x_back - px0)
        hs = []
        for i in range(25):
            x = a + (x_back - 0.006 - a) * i / 24
            h = pb.ray_cast(mathutils.Vector((x, py1 + 0.5, 0.0)), mathutils.Vector((0, -1, 0)))
            if h[0] is not None:
                hs.append(h[0].y)
        hs.sort(); cushion = hs[len(hs) // 2]
        s = (eye[1] - cushion) / (char['eye'][1] - char['butt_y'])
        backX = -s * char['back_z']
        tx = x_back - 0.002 - backX
        ty = cushion - s * char['butt_y']
        tz = eye[2] + s * char['mid_x']
        info['fit'] = {'scale': s, 'pos': [tx, ty, tz], 'yaw_deg': 90.0, 'mode': 'pod', 'cushion_y': cushion, 'back_x': x_back,
                       'eye_at': [tx - s * char['eye'][2], ty + s * char['eye'][1], tz], 'eye_shift_x': (tx - s * char['eye'][2]) - eye[0]}
    elif opt.get('pan_y'):
        # SEAT MODE: hips on the cushion (pan_y), back on the backrest face (back_x), scale given
        s = float(opt['scale']); pan_y = float(opt['pan_y']); back_x = float(opt['back_x'])
        backX = -s * char['back_z']
        tx = back_x - 0.004 - backX
        ty = pan_y - s * char['butt_y']
        tz = eye[2] + s * char['mid_x']
        info['fit'] = {'scale': s, 'pos': [tx, ty, tz], 'yaw_deg': 90.0, 'mode': 'seat',
                       'eye_at': [tx - s * char['eye'][2], ty + s * char['eye'][1], tz]}
    elif pans:
        s = min(pans) / (char['eye'][1] - char['butt_y'])
        # placement in ship model space: rotate the character to face -X (glTF yaw +90 deg: +Z -> -X),
        # scale s, translate so its eye sits at the marker height and its back near the backrest
        # after the yaw, character z (forward) maps to -X, so its back (min z) maps to the most +X point
        backX = -s * char['back_z']           # x of the back after yaw+scale (before translation)
        eyeX = -s * char['eye'][2]
        tx_eye = eye[0] - eyeX                                     # eye exactly over the marker
        tx_back = (eye[0] + dback - 0.004) - backX if dback else tx_eye   # back resting on the backrest
        tx = tx_back if dback else tx_eye
        ty = eye[1] - s * char['eye'][1]
        tz = eye[2] + s * char['mid_x']                            # character x maps to ship +Z after the yaw
        info['fit'] = {'scale': s, 'pos': [tx, ty, tz], 'yaw_deg': 90.0, 'eye_shift_x': tx - tx_eye}
    res['ships'][name] = info
    # render check: side view of the cockpit with the character placed (Blender space)
    if opt.get('renders') and 'fit' in info:
        f = info['fit']
        for o in cobjs:
            o.hide_render = False
        carm.scale = (f['scale'],) * 3
        carm.rotation_mode = 'XYZ'                          # the glTF importer leaves QUATERNION: an euler write is ignored
        carm.rotation_euler = (0, 0, math.radians(-90))     # Blender: face -Y -> -X
        carm.location = (f['pos'][0], -f['pos'][2], f['pos'][1])
        bpy.context.view_layer.update()
        cam = bpy.data.objects.get('fitcam') or bpy.data.objects.new('fitcam', bpy.data.cameras.new('fitcam'))
        if cam.name not in scn.collection.objects:
            scn.collection.objects.link(cam)
        scn.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = float(opt.get('zoom', 0.5))
        scn.render.engine = 'BLENDER_WORKBENCH'; scn.display.shading.light = 'STUDIO'; scn.display.shading.color_type = 'TEXTURE'
        scn.render.resolution_x = 700; scn.render.resolution_y = 520
        E = mathutils.Vector((eye[0], -eye[2], eye[1]))
        for vn, d in (('side', mathutils.Vector((0, 1, 0))), ('q', mathutils.Vector((0.6, 0.75, -0.3)).normalized())):
            cam.location = E - d * 3; cam.rotation_euler = d.to_track_quat('-Z', 'Z' if False else 'Y').to_euler()
            cam.data.clip_end = 10
            # cut-away side view: only the seat parts (no hull, tub, cabin shell, frame, glass) + the character
            cut = (vn == 'side')
            for o in sobjs:
                if o.type == 'MESH':
                    nm = o.name.lower()
                    o.hide_render = cut and (o is hull or any(k in nm for k in ('tub', 'lin13', 'shell', 'glass', 'windshield', 'gl11', 'frame', 'hood', 'canopy')))
            scn.render.filepath = os.path.abspath(opt['renders'] + f'{name}_{vn}' + opt.get('tag', '') + '.png')
            bpy.ops.render.render(write_still=True)
        for o in sobjs:
            o.hide_render = False
        for o in cobjs:
            o.hide_render = True
    for o in sobjs:
        bpy.data.objects.remove(o)
print('[seatfit] ' + json.dumps(res))
if opt.get('out'):
    json.dump(res, open(opt['out'], 'w'), indent=1)
