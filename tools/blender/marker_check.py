import bpy, os, json
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
peek = json.load(open(os.path.join(REPO, 'tools/blender/reports/orig/peek.json')))
for ship in ['vortex', 'pyro', 'puncture', 'slayer', 'tracker', 'blaster', 'syphon']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'LSS/ships_original', ship.capitalize() + '.glb'))
    got = {o.name: [round(v, 4) for v in o.matrix_world.translation] for o in bpy.context.scene.objects if o.type == 'EMPTY'}
    ref = peek[ship]['frozen_markers']
    worst = 0.0
    for k, v in got.items():
        if k in ref:
            worst = max(worst, max(abs(a - b) for a, b in zip(v, ref[k])))
    print('CHECK', ship, len(got), 'markers, worst offset vs frozen', round(worst, 5), sorted(got))
