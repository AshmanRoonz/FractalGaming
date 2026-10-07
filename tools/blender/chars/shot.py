# render orthographic close-ups from the live session. ARGS: arm, out, frames "1,9", views "front,side,lhand,rhand", color (TEXTURE|ATTRIBUTE|MATERIAL), attr
import bpy, math, mathutils
scn = bpy.context.scene
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
cam = bpy.data.objects.get('CC_cam')
if not cam:
    cam = bpy.data.objects.new('CC_cam', bpy.data.cameras.new('CC_cam')); scn.collection.objects.link(cam)
scn.camera = cam; cam.data.type = 'ORTHO'
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = ARGS.get('color', 'TEXTURE')
if sh.color_type == 'VERTEX' and ARGS.get('attr'): me.data.color_attributes.active_color = me.data.color_attributes[ARGS['attr']]
sh.show_cavity = False; sh.show_backface_culling = False
scn.render.resolution_x = int(ARGS.get('w', 800)); scn.render.resolution_y = int(ARGS.get('h', 1000)); scn.render.resolution_percentage = 100
scn.render.film_transparent = False
outs = []
if ARGS.get('action'):
    ad = arm.animation_data or arm.animation_data_create(); act = bpy.data.actions[ARGS['action']]
    ad.action = act
    if act.slots: ad.action_slot = act.slots[0]
hidden = []
for o in scn.objects:
    if o.type == 'MESH' and (o.name.startswith('CC_') or (o.parent and o.parent != arm and o.parent.type == 'ARMATURE')) and not o.hide_render:
        o.hide_render = True; hidden.append(o)
def bone_head(n):
    pb = arm.pose.bones[n]; return arm.matrix_world @ pb.head
for f in [int(x) for x in ARGS.get('frames', '1').split(',')]:
    scn.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = me.evaluated_get(dg); m = ev.to_mesh()
    P = [ev.matrix_world @ v.co for v in m.vertices]; ev.to_mesh_clear()
    lo = mathutils.Vector((min(p.x for p in P), min(p.y for p in P), min(p.z for p in P)))
    hi = mathutils.Vector((max(p.x for p in P), max(p.y for p in P), max(p.z for p in P)))
    c = (lo + hi) / 2; H = hi.z - lo.z
    for vn in ARGS.get('views', 'front,side').split(','):
        sc = float(ARGS.get('zoom', 0.38))
        if vn == 'front': tgt, d, s = c, mathutils.Vector((0, -1, 0)), H * 1.08
        elif vn == 'back': tgt, d, s = c, mathutils.Vector((0, 1, 0)), H * 1.08
        elif vn == 'side': tgt, d, s = c, mathutils.Vector((1, 0, 0)), H * 1.08
        elif vn.startswith('pt'):
            tgt = bone_head('mixamorig:' + ARGS['bone']) if ARGS.get('bone') else mathutils.Vector([float(x) for x in ARGS['pt'].split(',')]); d = mathutils.Vector([float(x) for x in ARGS.get('dir' + vn[2:], ARGS.get('dir', '0,1,0')).split(',')]).normalized(); s = H * sc
        elif vn == 'q': tgt, d, s = c, mathutils.Vector((0.7, 0.7, -0.15)).normalized(), H * 1.08
        elif vn == 'q2': tgt, d, s = c, mathutils.Vector((-0.7, 0.7, -0.15)).normalized(), H * 1.08
        elif vn in ('lhand', 'rhand', 'lhandS', 'rhandS', 'lhandB', 'rhandB'):
            b = 'mixamorig:LeftHand' if vn[0] == 'l' else 'mixamorig:RightHand'
            tgt = bone_head(b) + mathutils.Vector((0, 0, -0.08 * H / 1.7))
            d = mathutils.Vector((1 if vn[0]=='l' else -1, 0, 0)) if vn.endswith('S') else (mathutils.Vector((0, 1, 0)) if vn.endswith('B') else mathutils.Vector((0, -1, 0)))
            s = H * sc
        cam.data.ortho_scale = s
        cam.location = tgt - d * H * 5
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_end = H * 20
        p = f"{ARGS['out']}_{vn}_f{f}.png"
        scn.render.filepath = p
        bpy.ops.render.render(write_still=True); outs.append(p)
for o in hidden:
    if not o.name.startswith('CC_'): o.hide_render = False
result = {'out': outs}
