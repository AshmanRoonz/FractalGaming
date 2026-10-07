# Make an ALERT copy of a slumped clip: hold the face up, keep a little of the original head motion.
# Step script (ARGS in, `result` out). ARGS: arm, src (action name), dst (new action name),
#   target (face pitch to hold, degrees; 0 = level, - = looking down)    default -7
#   keep   (fraction of the source's own pitch swing that survives)      default 0.25
#   neck   (share of each frame's correction taken by the neck; the head takes the rest)   default 0.4
#
# Owner (2026-10-06): "can you edit my pilot and make him so his sleepy looks more alert lol... stop his chin from
# dropping down". The pilot's seat idle is Meshy's Sit_and_Doze_Off: face pitched 35-60 deg down (mean -43; the
# walk holds ~0, his own cheer ~-7, the Summoners' seated clip ~+2) while the chest only leans ~10 deg - so it is
# all neck and head. Per frame: read the face's pitch off the rig's `headfront` bone (Meshy's face-forward marker),
# aim it at target + keep x (its own swing about its mean), and turn the neck then the head about the body's
# lateral axis to get there. The source clip is left untouched.
import bpy, math, mathutils

arm = bpy.data.objects[ARGS['arm']]
src = bpy.data.actions[ARGS['src']]
target = float(ARGS.get('target', -7)); keep = float(ARGS.get('keep', 0.25)); share = float(ARGS.get('neck', 0.4))
scn = bpy.context.scene
ad = arm.animation_data
act0, slot0 = ad.action, getattr(ad, 'action_slot', None)

dst = src.copy(); dst.name = ARGS['dst']; dst.use_fake_user = True
ad.action = dst
if dst.slots:
    ad.action_slot = dst.slots[0]
M = arm.matrix_world
lat = (M.inverted().to_3x3() @ mathutils.Vector((1, 0, 0))).normalized()   # the body's lateral axis in armature space
pb_neck = arm.pose.bones['mixamorig:Neck']; pb_head = arm.pose.bones['mixamorig:Head']; pb_face = arm.pose.bones['headfront']
for pb in (pb_neck, pb_head):
    pb.rotation_mode = 'QUATERNION'


def face_pitch():
    f = ((M @ pb_face.tail) - (M @ pb_face.head)).normalized()
    return math.degrees(math.asin(max(-1.0, min(1.0, f.z))))


def turn(pb, deg):
    # rotate the bone about its own head, about the lateral axis, by `deg` (positive = face up)
    Mp = pb.matrix.copy(); h = Mp.to_translation()
    R = mathutils.Matrix.Rotation(math.radians(deg), 4, lat)
    pb.matrix = mathutils.Matrix.Translation(h) @ R @ mathutils.Matrix.Translation(-h) @ Mp
    bpy.context.view_layer.update()


f0, f1 = map(int, dst.frame_range)
pitches = []
for f in range(f0, f1 + 1):
    scn.frame_set(f); pitches.append(face_pitch())
mean = sum(pitches) / len(pitches)
# the sign of "face up" about +lateral: measure once instead of trusting a convention
scn.frame_set(f0); p0 = face_pitch(); turn(pb_head, 5.0); sgn = 1.0 if face_pitch() > p0 else -1.0
after = []
for i, f in enumerate(range(f0, f1 + 1)):
    scn.frame_set(f)
    want = target + keep * (pitches[i] - mean)
    corr = want - face_pitch()
    turn(pb_neck, sgn * corr * share)
    turn(pb_head, sgn * (want - face_pitch()))      # the head takes whatever is left, measured after the neck moved
    pb_neck.keyframe_insert('rotation_quaternion', frame=f)
    pb_head.keyframe_insert('rotation_quaternion', frame=f)
    after.append(face_pitch())
ad.action = act0
if slot0 is not None:
    try: ad.action_slot = slot0
    except Exception: pass
result = {'dst': dst.name, 'frames': f1 - f0 + 1, 'src_pitch': [round(min(pitches), 1), round(mean, 1), round(max(pitches), 1)],
          'new_pitch': [round(min(after), 1), round(sum(after) / len(after), 1), round(max(after), 1)], 'sign': sgn}
