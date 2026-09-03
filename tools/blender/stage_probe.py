import bpy, os, math
from mathutils import Vector
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools/blender/reports/remesh')
STAGES = [('orig', 'LSS/ships_original/{S}.glb'), ('clean', 'assets_base/ships_clean/{S}.glb'), ('out', 'assets_src/ships/{s}.glb'), ('game', 'LSS/ships/{s}.glb')]
for ship in ['syphon', 'pyro', 'blaster']:
    for tag, rel in STAGES:
        path = os.path.join(REPO, rel.format(S=ship.capitalize(), s=ship))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
        dims = [round(hi[i] - lo[i], 3) for i in range(3)]
        print('STAGE', ship, tag, 'meshes', len(meshes), 'tris', tris, 'dims', dims, 'names', [o.name for o in meshes][:4])
        sc = bpy.context.scene; sc.world = bpy.data.worlds.new('W')
        sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
        sc.render.resolution_x, sc.render.resolution_y = 640, 440
        cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
        L = max(dims); ctr = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
        cam.location = ctr + Vector((1.4 * L, 1.1 * L, 0.9 * L)); cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 40; cam.data.clip_start = 0.002 * L; cam.data.clip_end = 50 * L
        sc.render.filepath = os.path.join(OUT, f'stage_{ship}_{tag}.png'); bpy.ops.render.render(write_still=True)
print('STAGE_DONE')
