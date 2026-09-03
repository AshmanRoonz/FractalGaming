import bpy, os, math
from mathutils import Vector
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'tools/blender/reports/remesh')
for ship in ['vortex', 'pyro', 'blaster', 'tracker']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'LSS/ships', ship + '.glb'))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    n_glass = 0; n_all = 0
    for o in meshes:
        for i, m in enumerate(o.data.materials):
            if m and m.name.startswith('canopy_glass'):
                dbg = bpy.data.materials.new('DBG'); dbg.use_nodes = True
                b = dbg.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.1, 1, 0.1, 1); b.inputs['Emission Color'].default_value = (0.1, 1, 0.1, 1); b.inputs['Emission Strength'].default_value = 1.0
                o.data.materials[i] = dbg
                n_glass += sum(1 for p in o.data.polygons if p.material_index == i)
        n_all += len(o.data.polygons)
    print('GLASS', ship, 'glass faces', n_glass, 'of', n_all)
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
    L = max(hi[i] - lo[i] for i in range(3)); ctr = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
    sc = bpy.context.scene; sc.world = bpy.data.worlds.new('W'); sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.55, 1)
    sc.render.engine = 'BLENDER_EEVEE'; sc.eevee.taa_render_samples = 8
    sc.render.resolution_x, sc.render.resolution_y = 640, 440
    sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(-40)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 40; cam.data.clip_start = 0.002 * L; cam.data.clip_end = 50 * L
    for tag, off in (('side', (0, 2.3, 0.3)), ('top', (0.001, 0.001, 2.3)), ('front34', (-1.5, 1.2, 0.9)), ('bottom', (0.001, 0.4, -2.3))):
        cam.location = ctr + Vector(off) * L; cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, f'glass_{ship}_{tag}.png'); bpy.ops.render.render(write_still=True)
print('GLASS_DONE')
