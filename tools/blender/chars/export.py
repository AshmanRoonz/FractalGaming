# Export one character (armature + skinned mesh) with ONLY its own clips, each as a named glTF animation.
# The two characters share bone names, so 'ACTIONS' mode would hand each one the other's clips too: every clip
# of this character is put on its own NLA track (named without the PIL_ / SUM_ work prefix) and exported with
# export_animation_mode='NLA_TRACKS'. The armature is exported at the origin; scene state is restored after.
import bpy
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
prefix = ARGS['prefix']
loc0 = arm.location.copy(); arm.location = (0, 0, 0)
ad = arm.animation_data or arm.animation_data_create()
act0 = ad.action
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
names = []
for act in sorted((a for a in bpy.data.actions if a.name.startswith(prefix)), key=lambda a: a.name):
    tr = ad.nla_tracks.new(); tr.name = act.name[len(prefix):]
    st = tr.strips.new(tr.name, int(act.frame_range[0]), act)
    if hasattr(st, 'action_slot') and act.slots:
        st.action_slot = act.slots[0]
    names.append(tr.name)
vl = bpy.context.view_layer
for o in bpy.context.selected_objects:
    o.select_set(False)
hid = {}
for o in (arm, me):
    hid[o] = o.hide_get(); o.hide_set(False); o.select_set(True)
vl.objects.active = arm
err = None
try:
    bpy.ops.export_scene.gltf(
        filepath=ARGS['out'], export_format='GLB', use_selection=True,
        export_animation_mode='NLA_TRACKS', export_apply=False, export_yup=True,
        export_skins=True, export_all_influences=False, export_morph=False,
        export_tangents=False, export_image_format='AUTO', export_force_sampling=True,
        export_frame_step=1, export_reset_pose_bones=True, export_extras=False, export_cameras=False,
        export_lights=False)
except Exception as e:
    err = repr(e)
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = act0
if act0 and act0.slots:
    ad.action_slot = act0.slots[0]
arm.location = loc0
for o, h in hid.items():
    o.hide_set(h)
import os
result = {'out': ARGS['out'], 'clips': names, 'err': err, 'bytes': os.path.getsize(ARGS['out']) if os.path.exists(ARGS['out']) else None}
