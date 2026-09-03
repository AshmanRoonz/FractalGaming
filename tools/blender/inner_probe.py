import bpy, os, sys, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
for ship in ['pyro', 'tracker']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'assets_base/ships_clean', ship.capitalize() + '.glb'), merge_vertices=True)
    hull = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT'); hull.select_set(True); bpy.context.view_layer.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = hull.data; L = max(hull.dimensions)
    bvh = BVHTree.FromObject(hull, bpy.context.evaluated_depsgraph_get())
    random.seed(1)
    idx = random.sample(range(len(me.polygons)), 20000)
    blocked = 0
    for i in idx:
        p = me.polygons[i]
        o = p.center + p.normal * (0.0008 * L)
        hit = bvh.ray_cast(o, p.normal, 3 * L)
        if hit[0] is not None:
            blocked += 1
    print('PROBE', ship, 'faces', len(me.polygons), 'sampled', len(idx), 'normal-ray blocked (inner skin)', round(100 * blocked / len(idx), 1), '%')
print('PROBE_DONE')
