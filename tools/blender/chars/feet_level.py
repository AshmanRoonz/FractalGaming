# Level the feet of a standing clip: every frame, each foot (then its toes) is turned back to lie as it does in the REST
# pose - flat on the floor - keeping the heading the clip gives it.
# Step script (ARGS in, `result` out) - feet.py --fix on a finished GLB (or char_pipeline.py --feet).
# ARGS: arm, clips ("A,B": action names), keep (share of the clip's own tilt that survives, default 0), toes (1 = level the
#       toe bones too, default 1)
#
# Owner (2026-10-11, game v53.65), on the CUSTOMIZE line-up: "pilot and animal pilot both look like they are standing on a
# ball, ankles tilted in". The standing bodies hold their talk clip's first frame (+ a share of the clip; the gameshow plays
# all of it), and Meshy's talk clips do not keep the feet flat. Measured against the rest pose (feet.py), the whole clip
# long: Ashman's Stand_Talking_Angry rolls both feet ~16 deg onto their OUTER edges and lifts the toes ~16 deg (22 deg in
# all), Frostfang's Talk_with_Hands_Open rolls his 17 / 11 deg (17-18 deg in all), Azure's Talk_Passionately lifts hers
# ~22 deg with a 6 deg roll - which is why the owner saw the first two and not her.
#
# THE REFERENCE IS THE REST POSE, NOT THE MESH. Every one of the three was modelled standing flat (renders: the tread
# level from behind and from the side). A plane fitted to the boot's down-facing skin was the first measure and it lied:
# on Frostfang's left boot three readings of the same sole gave 11.5 deg one way, 10.5 another and 4.6 the opposite way
# (the toe cap's underside, the heel bevel and the lugs all face down), and "levelling" it by that fit rolled the foot to
# 31 deg. So: u = the foot bone's own direction that points UP at rest; per frame, the shortest world rotation taking
# where u points now back onto world up (its axis is horizontal: no change of heading) turns the bone about its head
# (the ankle). Exact in one step - no measuring loop.
import bpy, math, mathutils

arm = bpy.data.objects[ARGS['arm']]
keep = float(ARGS.get('keep', 0)); toes = ARGS.get('toes', '1') != '0'
scn = bpy.context.scene; vl = bpy.context.view_layer
UP = mathutils.Vector((0, 0, 1))
Mw = arm.matrix_world.copy(); Mwi = Mw.inverted()
bn = [b.name for b in arm.data.bones]
CHAIN = []   # (side, pose bone, its rest 'up' in bone space), foot before toe
for s in ('Left', 'Right'):
    for part in (('Foot', 'ToeBase') if toes else ('Foot',)):
        n = next((x for x in bn if x.endswith(s + part)), None)
        if not n:
            continue
        pb = arm.pose.bones[n]; pb.rotation_mode = 'QUATERNION'
        Rr = (Mw @ arm.data.bones[n].matrix_local).to_3x3().normalized()
        CHAIN.append((s, part, pb, (Rr.inverted() @ UP).normalized()))


def tilt(pb, u):
    un = ((Mw @ pb.matrix).to_3x3().normalized() @ u).normalized()
    return un, math.degrees(un.angle(UP))


def turn(pb, q):
    h = Mw @ pb.head
    pb.matrix = Mwi @ (mathutils.Matrix.Translation(h) @ q.to_matrix().to_4x4() @ mathutils.Matrix.Translation(-h) @ (Mw @ pb.matrix))
    vl.update()


ad = arm.animation_data
act0, slot0 = ad.action, getattr(ad, 'action_slot', None)
mutes = [(t, t.mute) for t in ad.nla_tracks]
for t, _ in mutes:
    t.mute = True
out = {}
for name in [c for c in ARGS['clips'].split(',') if c]:
    act = bpy.data.actions[name]
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    f0, f1 = (int(x) for x in act.frame_range)
    before, after = {}, {}
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        for s, part, pb, u in CHAIN:
            un, t0 = tilt(pb, u)
            before.setdefault(s + part, []).append(t0)
            q = un.rotation_difference(UP)
            if keep > 0:
                q = mathutils.Quaternion().slerp(q, 1.0 - keep)
            turn(pb, q)
            pb.keyframe_insert('rotation_quaternion', frame=f)
            after.setdefault(s + part, []).append(tilt(pb, u)[1])
    rng = lambda v: [round(min(v), 2), round(sum(v) / len(v), 2), round(max(v), 2)]
    out[name] = {'frames': f1 - f0 + 1, 'tilt_before': {k: rng(v) for k, v in before.items()},
                 'tilt_after': {k: rng(v) for k, v in after.items()}}
for t, m in mutes:
    t.mute = m
ad.action = act0
if slot0 is not None:
    try: ad.action_slot = slot0
    except Exception: pass
result = out
