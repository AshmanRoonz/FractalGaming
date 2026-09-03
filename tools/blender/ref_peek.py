import bpy, os, sys, json
from mathutils import Vector
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools/blender/reports/original')
for ship in ['vortex', 'pyro', 'tracker', 'slayer']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'tools/blender/work/ref', ship + '.glb'))
    sc = bpy.context.scene
    info = {}
    for o in [o for o in sc.objects if o.type == 'MESH']:
        me = o.data
        names = [m.name if m else None for m in me.materials]
        cnt = {}
        for pg in me.polygons:
            n = names[pg.material_index] if pg.material_index < len(names) else None
            cnt[n] = cnt.get(n, 0) + 1
        info[o.name] = {'mats': names, 'faces_per_mat': cnt, 'scale': [round(v, 4) for v in o.matrix_world.to_scale()], 'loc': [round(v, 4) for v in o.matrix_world.translation]}
        for i, m in enumerate(me.materials):
            if m and m.name.startswith('canopy_glass'):
                dbg = bpy.data.materials.new('DBG'); dbg.use_nodes = True
                dbg.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 1, 0.1, 1)
                dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.1, 1, 0.1, 1)
                dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.5
                me.materials[i] = dbg
    print('REF', ship, json.dumps(info))
    # top render
    bb = [Vector(c) for c in [o for o in sc.objects if o.type == 'MESH'][0].bound_box]
    sc.world = bpy.data.worlds.new('W')
    cd = bpy.data.cameras.new('C'); cd.lens = 40; cam = bpy.data.objects.new('C', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = Vector((0, 0.0001, 3.2)); cam.rotation_euler = (Vector((0, 0, -1)).to_track_quat('-Z', 'Y').to_euler())
    cam2 = Vector((-1.6, 1.2, 0.9))
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x, sc.render.resolution_y = 700, 500
    sc.render.filepath = os.path.join(OUT, f'{ship}_ref_top.png'); bpy.ops.render.render(write_still=True)
    cam.location = cam2; cam.rotation_euler = (Vector((0, 0, 0)) - cam2).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'{ship}_ref_34.png'); bpy.ops.render.render(write_still=True)
print('DONE')
