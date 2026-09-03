import bpy, os, time, math
from mathutils import Vector
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools/blender/reports/remesh')
def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'LSS/ships_original/Pyro.glb'))
    hi = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); bpy.context.view_layer.objects.active = hi
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return hi
def shot(obj, name, close=False):
    sc = bpy.context.scene
    sc.world = sc.world or bpy.data.worlds.new('W'); sc.world.use_nodes = True
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'; sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
    L = max(obj.dimensions); ctr = sum((obj.matrix_world @ Vector(b) for b in obj.bound_box), Vector()) / 8
    if close:
        cp = ctr + Vector((-0.3 * L, 0, 0.05 * L)); cam.location = cp + Vector((-0.30 * L, 0.22 * L, 0.22 * L)); tgt = cp; cam.data.lens = 55
    else:
        cam.location = ctr + Vector((-1.5 * L, 1.1 * L, 0.8 * L)); tgt = ctr; cam.data.lens = 40
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_start = 0.002 * L; cam.data.clip_end = 50 * L
    sc.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
for thick, vox in ((0.006, 0.003), (0.010, 0.003)):
    hi = load(); L = max(hi.dimensions)
    t = time.time()
    so = hi.modifiers.new('solid', 'SOLIDIFY'); so.thickness = thick * L; so.offset = 0.0; so.use_even_offset = False; so.use_quality_normals = False
    bpy.ops.object.modifier_apply(modifier=so.name)
    n_solid = len(hi.data.polygons)
    m = hi.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = vox * L; m.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier=m.name)
    print('PROBE solidify', thick, 'voxel', vox, 'solid polys', n_solid, '-> quads', len(hi.data.polygons), 'sec', round(time.time() - t, 1))
    tag = f'probe_solid{int(thick*1000)}_v{int(vox*1000)}'
    shot(hi, tag + '.png'); shot(hi, tag + '_close.png', close=True)
print('PROBE_DONE')
