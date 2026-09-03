"""Which loose shell(s) do upward rays from the frozen cockpit1 hit, per original hull?"""
import bpy, os, sys, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
peek = json.load(open(os.path.join(REPO, 'tools/blender/reports/orig/peek.json')))
for ship in ['vortex', 'pyro', 'puncture', 'slayer', 'tracker', 'blaster', 'syphon']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'LSS/ships_original', ship.capitalize() + '.glb'))
    hull = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT'); hull.select_set(True); bpy.context.view_layer.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    L = max(peek[ship]['dims']); cp = Vector(peek[ship]['frozen_markers']['cockpit1'])
    ntot = len(hull.data.polygons)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    dg = bpy.context.evaluated_depsgraph_get()
    hits = {}
    for o in parts:
        bvh = BVHTree.FromObject(o, dg)
        for dx in (-0.04, 0, 0.04):
            for dy in (-0.04, 0, 0.04):
                org = cp + Vector((dx * L, dy * L, 0))
                h = bvh.ray_cast(org, Vector((0, 0, 1)), 0.6 * L)
                if h[0] is not None:
                    hits.setdefault(o.name, []).append(round(float(h[0].z), 3))
    out = []
    for name, zs in sorted(hits.items(), key=lambda kv: min(kv[1])):
        o = bpy.data.objects[name]
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = [min(v[i] for v in bb) for i in range(3)]; hi = [max(v[i] for v in bb) for i in range(3)]
        out.append({'tris': len(o.data.polygons), 'pct': round(100 * len(o.data.polygons) / ntot, 1), 'dims_L': [round((hi[i] - lo[i]) / L, 3) for i in range(3)], 'zmin': min(zs), 'rays': len(zs)})
    print('SHELLS', ship, 'parts', len(parts), json.dumps(out[:6]))
print('DONE')
