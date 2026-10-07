"""char_pipeline.py - Meshy rigged biped (one GLB per clip) -> ONE game-ready GLB with every clip, fingers cut
off the body.  Headless, from the repo root:

    "$(python tools/blender/blender_path.py)" -b --factory-startup -P tools/blender/chars/char_pipeline.py -- \
        --name Pilot --dir assets_base/objects/characters/Meshy_AI_Hangar_Vanguard_biped \
        --out assets_src/objects/characters/pilot_ashman.glb [--report tools/blender/work/chars/pilot_report.json]

then  `node tools/compress_glb.mjs --only characters/`  ->  LSS/objects/characters/<name>.glb  (recipe 'character').

WHY (2026-10-06, owner): "their hands are too close to their body, and so the rig animation moves the hands but
the fingers are still attached to the body so the fingers stretch". Meshy generates the character in a rest pose
with the hands resting on the thighs and FUSES them - after welding the UV seams the whole body is one surface,
joined to the leg through thin bridge triangles (the low-poly Summoners) or a fused contact patch (the pilot) -
and its auto-rig heat-weights the fingers half to the thigh. Every clip that lifts an arm then drags the fingers
down to the leg: edges stretched up to 70x (Summoners) / 155x (pilot) in the angry-talk and cheer clips.

STEPS (each is a step script beside this file, the same scripts the live session ran over the socket via bl.py):
  1. import every clip GLB: the first keeps its armature + mesh, the rest only their action (NAME_ prefix)
  2. capture each corner's REAL normal into 'cc_nrm' (Blender 5 stores custom normals relative to each corner's
     fan, so the weld and the cut would silently re-decode them; Meshy's normal maps are baked against them)
  3. record the model's own small islands (they must survive step 5)
  4. handfix.py apply: weld, min-cut the hand/forearm from the body, delete the straddling faces, cap both
     openings (min-area hole fill), re-weight both sides
  5. islands.py: delete the small fragments the cut freed (< 40 verts, not in the step-3 list)
  6. stretch.py report (optional): worst edge stretch per clip, the number this whole thing exists to drive down
  7. finalize.py: restore the captured normals (caps -> auto), strip the work attributes
  8. export.py: GLB with only this character's clips, each a named animation (NLA tracks)

Refuses to run inside a GUI session (it starts from an empty scene).
"""
import bpy, sys, os, glob, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {}
for i in range(0, len(argv) - 1, 2):
    opt[argv[i].lstrip('-')] = argv[i + 1]
NAME, DIR, OUT = opt['name'], os.path.abspath(opt['dir']), os.path.abspath(opt['out'])
PREFIX = NAME.upper()[:3] + '_'
if not bpy.app.background:
    raise SystemExit('char_pipeline.py starts from an empty scene: run it headless (-b), never in a GUI session')


def step(script, **args):
    ns = {'ARGS': {k: (v if isinstance(v, str) else json.dumps(v) if isinstance(v, (list, dict)) else str(v)) for k, v in args.items()},
          '__name__': '__step__'}
    exec(compile(open(os.path.join(HERE, script), encoding='utf-8').read(), script, 'exec'), ns)
    r = ns.get('result')
    print(f'[char] {script}: ' + json.dumps(r, default=str)[:600])
    return r


report = {'name': NAME}
bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. clips
files = sorted(glob.glob(os.path.join(DIR, '*.glb')))
assert files, f'no GLBs in {DIR}'
arm = None
for k, f in enumerate(files):
    before = set(bpy.data.objects); acts0 = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    for a in set(bpy.data.actions) - acts0:
        a.use_fake_user = True; a.name = PREFIX + a.name.split('.')[0]
    if k == 0:
        arm = next(o for o in new if o.type == 'ARMATURE'); arm.name = NAME
    else:
        for o in new:
            d = o.data; bpy.data.objects.remove(o)
            if d is not None and d.users == 0:
                (bpy.data.meshes if isinstance(d, bpy.types.Mesh) else bpy.data.armatures).remove(d)
for c in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.armatures):
    for x in list(c):
        if x.users == 0 and not getattr(x, 'use_fake_user', False):
            c.remove(x)
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
# 1b. (optional) an ALERT copy of a slumped clip: --alert SRC:DST[:target:keep:neck] (alert_head.py). The pilot's
# seat idle: Sit_and_Doze_Off hangs his chin on his chest, Sit_Alert holds his face ~7 deg down at the console.
if opt.get('alert'):
    a = opt['alert'].split(':')
    kw = {'arm': NAME, 'src': PREFIX + a[0], 'dst': PREFIX + a[1]}
    for k, v in zip(('target', 'keep', 'neck'), a[2:]):
        kw[k] = v
    report['alert'] = step('alert_head.py', **kw)
report['clips'] = sorted(a.name[len(PREFIX):] for a in bpy.data.actions if a.name.startswith(PREFIX))
report['import'] = {'verts': len(me.data.vertices), 'tris': sum(len(p.vertices) - 2 for p in me.data.polygons)}

# 2. real corner normals
m = me.data; n = len(m.loops)
cn = np.zeros(n * 3, np.float32); m.corner_normals.foreach_get('vector', cn)
m.attributes.new('cc_nrm', 'FLOAT_VECTOR', 'CORNER').data.foreach_set('vector', cn)

# 3. the model's own small islands
own = step('islands.py', arm=NAME, weld='1')
keep = [s[2] for s in own['small']]
report['own_islands'] = len(keep)

# 4-5. the cut, then the fragments it freed
if 'stretch' in opt.get('report_before', ''):
    report['stretch_before'] = step('stretch.py', arm=NAME, prefix=PREFIX, step='3')
report['handfix'] = step('handfix.py', arm=NAME, mode='apply', capcol='0')
report['islands'] = step('islands.py', arm=NAME, delete_below='40', keep=keep)

# 6. the number
if opt.get('report'):
    st = step('stretch.py', arm=NAME, prefix=PREFIX, step='3')
    report['stretch'] = {k: st[k] for k in ('clips', 'total >1.5 / >2 / >4')}
    report['stretch']['hands'] = {k: v for k, v in st['by_bones(>1.5)'].items() if 'Hand' in k}

# 7-8
report['finalize'] = step('finalize.py', arm=NAME, strip='1')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
report['export'] = step('export.py', arm=NAME, prefix=PREFIX, out=OUT)
if opt.get('report'):
    with open(opt['report'], 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=1, default=str)
print('[char] DONE ' + json.dumps({'out': OUT, 'bytes': report['export'].get('bytes'), 'clips': report['clips']}))
