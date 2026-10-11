# Retarget clips from ANOTHER Meshy biped onto this character's rig: `src` is a GLB holding them (the shipped pilot's
# assets_src file), `clips` the names to bring over. Each lands as a PREFIX_<clip> action, so export.py ships it
# beside the character's own clips.
#
# WHY (2026-10-10): the owner's new pilots (Azure Vanguard, Captain Frostfang) came from Meshy with a cross-legged
# FLOOR sit and no chair sit, and the cockpit seat is fitted to - and the game asks for - the first pilot's
# Sit_Alert (+ Sit_Cheer_with_Left_Hand on a kill). Meshy rigs share their joint NAMES, but not their rest pose:
# the first pilot was rigged arms-down (his hands on his thighs, hence the hand cut), Azure in an A-pose (arms ~45 deg
# out), Frostfang in a T-pose (arms straight out); measured rest-direction gaps 27-31 deg (Azure's arms) and 66-70 deg
# (Frostfang's). So a bone's local rotation means different things on each rig, and copying them as they are would
# put the arms somewhere else entirely.
#
# HOW, per bone, in WORLD space (QS = the source bone's posed rotation, QS0 / QT0 = the rest rotations):
#   trunk (hips, spine, neck, head, shoulders, toes...)  QT = (QS * QS0^-1) * QT0
#       the source's motion AWAY FROM ITS REST, applied to the target's own rest: the target keeps its build (a
#       curvier spine, a longer neck) and gets the same bend and twist.
#   limbs (Arm / ForeArm / Hand / UpLeg / Leg / Foot)      QT = (QS * QS0^-1) * A * QT0,  A = the shortest turn
#       taking the target's rest bone direction onto the source's: the limb points where the source's points, so
#       the arms come down to the console and the shins down into the footwell whatever the rest pose was.
#   hips position: the target's rest + the source's offset from its rest, scaled by hip height (the game pins the
#       hips at the idle's first frame anyway, _lssSeatLoad).
#   bones the source does not have (fingers, Frostfang's two extra bones) keep their rest pose.
# The meshes' armature modifiers are off while the source is sampled (every frame_set would otherwise re-skin two
# 150k-triangle meshes) and back on afterwards; the source armature, its meshes, actions and images are deleted.
import bpy, os, re
from mathutils import Matrix, Quaternion, Vector

tgt = bpy.data.objects[ARGS['arm']]
prefix = ARGS['prefix']
clips = [c for c in ARGS['clips'].split(',') if c]
ALIGN = re.compile(r'(Left|Right)(Arm|ForeArm|Hand|UpLeg|Leg|Foot)$')
HIPS = 'mixamorig:Hips'

before = set(bpy.data.objects); acts0 = set(bpy.data.actions); imgs0 = set(bpy.data.images)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(ARGS['src']))
new = [o for o in bpy.data.objects if o not in before]
src = next(o for o in new if o.type == 'ARMATURE')
srcacts = [a for a in bpy.data.actions if a not in acts0]

mods = []
for o in bpy.data.objects:
    if o.type == 'MESH':
        for m in o.modifiers:
            if m.type == 'ARMATURE' and m.show_viewport:
                m.show_viewport = False; mods.append(m)

def wrot(obj, m):
    return (obj.matrix_world @ m).to_3x3().normalized().to_quaternion()

common = sorted(set(b.name for b in src.data.bones) & set(b.name for b in tgt.data.bones))
QS0 = {n: wrot(src, src.data.bones[n].matrix_local) for n in common}
QT0 = {n: wrot(tgt, tgt.data.bones[n].matrix_local) for n in common}
Y = Vector((0, 1, 0))
A = {}
for n in common:
    if ALIGN.search(n):
        A[n] = (QT0[n] @ Y).rotation_difference(QS0[n] @ Y)
pS0 = (src.matrix_world @ src.data.bones[HIPS].matrix_local).translation
pT0 = (tgt.matrix_world @ tgt.data.bones[HIPS].matrix_local).translation
k = pT0.z / max(1e-6, pS0.z)
Tinv = tgt.matrix_world.inverted()
TinvQ = Tinv.to_3x3().normalized().to_quaternion()

def depth(b):
    d, p = 0, b.parent
    while p:
        d += 1; p = p.parent
    return d
order = sorted(tgt.data.bones, key=depth)

ad_s = src.animation_data or src.animation_data_create()
for t in list(ad_s.nla_tracks):     # export.py wrote one NLA track per clip: only the action being sampled may play
    ad_s.nla_tracks.remove(t)
ad_t = tgt.animation_data or tgt.animation_data_create()
keep_t = (ad_t.action, ad_t.action_slot if hasattr(ad_t, 'action_slot') else None)
scn = bpy.context.scene
out = {'common_bones': len(common), 'aligned': sorted(A), 'hip_scale': round(k, 3), 'clips': {}}
for clip in clips:
    act = next((a for a in srcacts if a.name == clip or a.name.split('.')[0] == clip or a.name.startswith(clip + '_')), None)
    if act is None:
        out['clips'][clip] = 'NOT IN SOURCE: ' + ', '.join(a.name for a in srcacts); continue
    ad_s.action = act
    if act.slots:
        ad_s.action_slot = act.slots[0]
    f0, f1 = (int(round(x)) for x in act.frame_range)
    frames = []
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        QS = {n: wrot(src, src.pose.bones[n].matrix) for n in common}
        pS = (src.matrix_world @ src.pose.bones[HIPS].matrix).translation.copy()
        frames.append((f, QS, pS))
    tact = bpy.data.actions.new(prefix + clip); tact.use_fake_user = True
    ad_t.action = tact
    prev = {}
    for f, QS, pS in frames:
        P = {}
        for b in order:
            n = b.name
            base = (P[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local)) if b.parent else b.matrix_local.copy()
            if n in common:
                qw = (QS[n] @ QS0[n].inverted()) @ A.get(n, Quaternion()) @ QT0[n]
                rb = base.to_3x3().normalized().to_quaternion().inverted() @ (TinvQ @ qw)
            else:
                rb = Quaternion()
            loc = Vector()
            if n == HIPS and not b.parent:
                pA = Tinv @ (pT0 + (pS - pS0) * k)
                loc = base.to_3x3().inverted() @ (pA - base.translation)
            q0 = prev.get(n)
            if q0 is not None and q0.dot(rb) < 0:
                rb = -rb            # same rotation, no flip through the long way between frames
            prev[n] = rb
            P[n] = base @ Matrix.Translation(loc) @ rb.to_matrix().to_4x4()
            pb = tgt.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = rb
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if n == HIPS:
                pb.location = loc
                pb.keyframe_insert('location', frame=f)
    out['clips'][clip] = {'frames': len(frames), 'action': tact.name}

# back as found: the target's action, the modifiers; the source and everything it brought, gone
ad_t.action = keep_t[0]
if keep_t[1] is not None and hasattr(ad_t, 'action_slot'):
    try:
        ad_t.action_slot = keep_t[1]
    except Exception:
        pass
for m in mods:
    m.show_viewport = True
for o in new:
    d = o.data
    bpy.data.objects.remove(o)
    if d is not None and getattr(d, 'users', 1) == 0:
        coll = bpy.data.meshes if isinstance(d, bpy.types.Mesh) else bpy.data.armatures if isinstance(d, bpy.types.Armature) else None
        if coll is not None:
            coll.remove(d)
for a in srcacts:
    bpy.data.actions.remove(a)
for im in [i for i in bpy.data.images if i not in imgs0]:
    if im.users == 0:
        bpy.data.images.remove(im)
for c in (bpy.data.materials, bpy.data.meshes, bpy.data.armatures, bpy.data.images):
    for x in list(c):
        if x.users == 0 and not getattr(x, 'use_fake_user', False):
            c.remove(x)
result = out
