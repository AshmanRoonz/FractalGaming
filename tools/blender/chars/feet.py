"""feet.py - how a character's feet meet the floor in its standing clip (probe), and --fix: level them (feet_level.py).
Headless, from the repo root:

    "$(python tools/blender/blender_path.py)" -b --factory-startup -P tools/blender/chars/feet.py -- \
        --glb assets_src/objects/characters/pilot_ashman.glb --clip Stand_Talking_Angry \
        [--frames 0,40,80] [--shots tools/blender/work/chars/feet/ashman] [--views front,back,low,side,legs] \
        [--json out.json] [--fix 1 --out fixed.glb [--keep 0]]

WHY (2026-10-11, owner, on the CUSTOMIZE line-up / hangar stand): "pilot and animal pilot both look like they are standing
on a ball, ankles tilted in". The standing bodies hold their talk clip's first frame (+ a share of the clip; the gameshow
plays all of it), so whatever the clip does with the feet is what they stand on.

MEASURE. Per foot, against the REST pose (every pilot was modelled standing flat): where the foot bone's rest "up" points
now (world space: z up, the character facing -y) -
  tilt      = degrees off vertical
  roll_out  = + the top of the foot leans OUTWARD: the sole faces in and he stands on its outer edge ("on a ball")
  toe_up    = + the toes are lifted (on his heels)
and `low` = the foot's lowest point above the floor (the body's lowest point), from the skinned mesh. Measured over the
whole clip (2026-10-11; the feet barely move in these clips): Ashman 22-23 deg (rolled out ~16 deg AND toes up ~16 deg),
Frostfang 17-18 (rolled 17 / 11), Azure 22-23 (toes up ~22, rolled ~6).
⚠ Not a plane fitted to the sole: a boot's down-facing skin is toe cap, heel bevel and lugs, and that fit read one sole
11.5 deg one way and 4.6 deg the other (feet_level.py).

--fix 1: feet_level.py on --clip (comma list allowed), the after-shots (`<shots>_fixed_*`), and the GLB exported to --out
by export.py (every clip, the pipeline's own export settings).
"""
import bpy, sys, os, json, math, mathutils
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {}
for i in range(0, len(argv) - 1, 2):
    opt[argv[i].lstrip('-')] = argv[i + 1]
if not bpy.app.background:
    raise SystemExit('feet.py starts from an empty scene: run it headless (-b)')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(opt['glb']))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
clips = [c for c in opt['clip'].split(',') if c]
ACTS = {c: (next((a for a in bpy.data.actions if a.name == c), None) or next(a for a in bpy.data.actions if a.name.startswith(c))) for c in clips}
act = ACTS[clips[0]]
ad = arm.animation_data or arm.animation_data_create()
for t in ad.nla_tracks:
    t.mute = True
scn = bpy.context.scene


def use(a):
    ad.action = a
    if a.slots:
        ad.action_slot = a.slots[0]


use(act)
# the foot vertices, by their rest weights: foot + toe bones of each side
bn = [b.name for b in arm.data.bones]
SIDES = {}
for s in ('Left', 'Right'):
    names = [n for n in bn if n.endswith(s + 'Foot') or n.endswith(s + 'ToeBase') or n.endswith(s + 'Toe_End')]
    gi = {me.vertex_groups[n].index for n in names if n in me.vertex_groups}
    w = np.zeros(len(me.data.vertices), np.float32)
    for v in me.data.vertices:
        for g in v.groups:
            if g.group in gi:
                w[v.index] += g.weight
    SIDES[s] = np.nonzero(w >= 0.5)[0]


def evaluated():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = me.evaluated_get(dg)
    m = ev.to_mesh()
    n = len(m.vertices)
    co = np.zeros(n * 3, np.float32); m.vertices.foreach_get('co', co)
    nr = np.zeros(n * 3, np.float32); m.vertex_normals.foreach_get('vector', nr)
    Mw = np.array(ev.matrix_world, dtype=np.float64)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
    nr = nr.reshape(-1, 3) @ Mw[:3, :3].T
    nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
    return co, nr


# (the first measure here was a plane fitted to the boot's down-facing skin; it read the same sole 11.5 deg one way and
# 4.6 the other - see feet_level.py. The tilt is now the foot BONE's against its rest pose, where every pilot stands flat.)
UPV = mathutils.Vector((0, 0, 1))
FOOT = {s: next(n for n in bn if n.endswith(s + 'Foot')) for s in ('Left', 'Right')}
U_REST = {s: ((arm.matrix_world @ arm.data.bones[n].matrix_local).to_3x3().normalized().inverted() @ UPV).normalized() for s, n in FOOT.items()}


def measure(f):
    scn.frame_set(f)
    co, nr = evaluated()
    floor = float(co[:, 2].min())
    out = {}
    for s, idx in SIDES.items():
        P = co[idx]
        pb = arm.pose.bones[FOOT[s]]
        un = ((arm.matrix_world @ pb.matrix).to_3x3().normalized() @ U_REST[s]).normalized()
        outward = 1.0 if P[:, 0].mean() > 0 else -1.0
        out[s] = {'tilt': round(math.degrees(un.angle(UPV)), 1),
                  # + = the foot's top leans OUTWARD: the sole faces in, he stands on its outer edge ("on a ball")
                  'roll_out': round(math.degrees(math.atan2(un.x * outward, un.z)), 1),
                  # facing -y: the top leans back (+y) when the toes come up
                  'toe_up': round(math.degrees(math.atan2(un.y, un.z)), 1),
                  'low': round(float(P[:, 2].min()) - floor, 4)}
    return out


def summary(a, frames):
    use(a)
    f0, f1 = (int(x) for x in a.frame_range)
    r = {'clip': a.name, 'range': [f0, f1], 'frames': {f: measure(f) for f in frames}}
    tilts = {s: [] for s in SIDES}
    for f in range(f0, f1 + 1, max(1, (f1 - f0) // 24)):
        m = measure(f)
        for s in SIDES:
            tilts[s].append(m[s]['tilt'])
    r['tilt_over_clip'] = {s: [min(v), round(sum(v) / len(v), 1), max(v)] for s, v in tilts.items() if v}
    return r


def shots(prefix, frames):
    cam = bpy.data.objects.get('FT_cam')
    if not cam:
        cam = bpy.data.objects.new('FT_cam', bpy.data.cameras.new('FT_cam')); scn.collection.objects.link(cam)
    scn.camera = cam; cam.data.type = 'ORTHO'
    scn.render.engine = 'BLENDER_WORKBENCH'
    sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = opt.get('color', 'TEXTURE'); sh.show_cavity = False
    scn.render.resolution_x = 900; scn.render.resolution_y = 600; scn.render.resolution_percentage = 100
    VIEWS = {'front': (0, -1, 0), 'back': (0, 1, 0), 'low': (0, -1, 0.35), 'side': (1, 0, 0), 'legs': (0, -1, 0)}
    outs = []
    for f in frames:
        scn.frame_set(f)
        co, _ = evaluated()
        idx = np.concatenate([SIDES['Left'], SIDES['Right']])
        P = co[idx]; lo = P.min(0); hi = P.max(0)
        H = float(co[:, 2].max() - co[:, 2].min())
        for vn in opt.get('views', 'front,back,low,side').split(','):
            d = mathutils.Vector(VIEWS[vn]).normalized()
            tgt = mathutils.Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] + H * (0.22 if vn == 'legs' else 0.09)))
            cam.data.ortho_scale = H * (0.62 if vn == 'legs' else 0.36)
            cam.location = tgt + d * H * 4
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            cam.data.clip_end = H * 20
            p = f"{prefix}_{vn}_f{f}.png"
            scn.render.filepath = os.path.abspath(p)
            bpy.ops.render.render(write_still=True); outs.append(p)
    return outs


def step(script, **args):
    ns = {'ARGS': {k: str(v) for k, v in args.items()}, '__name__': '__step__'}
    exec(compile(open(os.path.join(HERE, script), encoding='utf-8').read(), script, 'exec'), ns)
    return ns.get('result')


f0, f1 = (int(x) for x in act.frame_range)
frames = [int(x) for x in opt['frames'].split(',')] if opt.get('frames') else sorted({f0, (f0 + f1) // 2, f1})
res = {'glb': opt['glb'], 'feet_verts': {s: int(len(v)) for s, v in SIDES.items()}}
res['before'] = {c: summary(ACTS[c], frames if c == clips[0] else [int(ACTS[c].frame_range[0])]) for c in clips}
if opt.get('shots'):
    use(act); res['shots'] = shots(opt['shots'], frames)
if opt.get('fix') == '1':
    res['level'] = step('feet_level.py', arm=arm.name, clips=','.join(a.name for a in ACTS.values()), keep=opt.get('keep', '0'))
    res['after'] = {c: summary(ACTS[c], frames if c == clips[0] else [int(ACTS[c].frame_range[0])]) for c in clips}
    if opt.get('shots'):
        use(act); res['shots_fixed'] = shots(opt['shots'] + '_fixed', frames)
    if opt.get('out'):
        # export.py exports the actions named <prefix><clip>, one NLA track each, named <clip>
        for a in bpy.data.actions:
            a.use_fake_user = True; a.name = 'FT_' + a.name
        os.makedirs(os.path.dirname(os.path.abspath(opt['out'])), exist_ok=True)
        res['export'] = step('export.py', arm=arm.name, prefix='FT_', out=os.path.abspath(opt['out']))

txt = json.dumps(res, indent=1, default=str)
if opt.get('json'):
    os.makedirs(os.path.dirname(os.path.abspath(opt['json'])), exist_ok=True)
    open(opt['json'], 'w', encoding='utf-8').write(txt)
print('[feet] ' + txt[:4000])
