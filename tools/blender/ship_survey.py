# Blender 4.1 headless survey of the 7 LSS ship GLBs.
# usage: blender --background --python ship_survey.py -- <outdir>
import bpy, sys, os, json, math, bmesh
from mathutils import Vector

SHIPS = ['blaster','puncture','pyro','slayer','syphon','tracker','vortex']
SRC = r'C:\Users\ashro\Fractal_Reality\FractalGaming\LSS\ships'
OUT = sys.argv[sys.argv.index('--')+1]
os.makedirs(OUT, exist_ok=True)
stats = {}

def look_at(cam, target):
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()

def render(path, engine='BLENDER_EEVEE'):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
        return engine
    except Exception as e:
        print('RENDER FAIL', engine, e)
        if engine != 'CYCLES':
            sc.cycles.samples = 24
            sc.cycles.device = 'CPU'
            return render(path, 'CYCLES')
        return None

for name in SHIPS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    ok = True
    try:
        bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    except Exception as e:
        print('IMPORT FAIL', name, e); stats[name] = {'error': str(e)}; continue
    meshes = [o for o in sc.objects if o.type == 'MESH']
    empties = {o.name: o for o in sc.objects if o.type == 'EMPTY'}
    # world-space bbox
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (lo + hi) / 2; size = hi - lo; rad = max(size) / 2
    # marker positions (world)
    mk = {k: list((v.matrix_world.translation - ctr)) for k, v in empties.items()}
    guns = [Vector(v) for k, v in mk.items() if k.startswith('gun')]
    thr = [Vector(v) for k, v in mk.items() if k.startswith('thruster')]
    fwd = Vector((0, 1, 0))
    if guns and thr:
        g = sum(guns, Vector()) / len(guns); t = sum(thr, Vector()) / len(thr)
        if (g - t).length > 1e-6: fwd = (g - t).normalized()
    # topology stats on the (single) mesh
    topo = {}
    for o in meshes:
        bm = bmesh.new(); bm.from_mesh(o.data)
        nm = sum(1 for e in bm.edges if not e.is_manifold)
        bnd = sum(1 for e in bm.edges if e.is_boundary)
        # connected components
        seen = set(); comps = 0
        for v in bm.verts:
            if v.index in seen: continue
            comps += 1; stack = [v]
            while stack:
                x = stack.pop()
                if x.index in seen: continue
                seen.add(x.index)
                for e in x.link_edges:
                    y = e.other_vert(x)
                    if y.index not in seen: stack.append(y)
        smooth = sum(1 for p in o.data.polygons if p.use_smooth) / max(1, len(o.data.polygons))
        topo[o.name] = {'verts': len(bm.verts), 'faces': len(bm.faces), 'edges': len(bm.edges),
                        'non_manifold_edges': nm, 'boundary_edges': bnd, 'loose_parts': comps,
                        'smooth_frac': round(smooth, 3), 'uv_layers': len(o.data.uv_layers),
                        'materials': [m.name if m else None for m in o.data.materials],
                        'has_custom_normals': o.data.has_custom_normals}
        # verts near the cockpit marker (does any geometry exist INSIDE?)
        if 'cockpit1' in empties:
            cp = empties['cockpit1'].matrix_world.translation
            r = rad * 0.08
            near = sum(1 for v in bm.verts if ((o.matrix_world @ v.co) - cp).length < r)
            topo[o.name]['verts_within_8pct_of_cockpit1'] = near
        bm.free()
    stats[name] = {'bbox_size': list(size), 'center': list(ctr), 'markers_rel_center': mk,
                   'forward_guess_blender': list(fwd), 'topo': topo,
                   'images': [(i.name, i.size[0], i.size[1]) for i in bpy.data.images if i.size[0]]}
    # ---- render setup ----
    sc.render.resolution_x = 960; sc.render.resolution_y = 720
    sc.eevee.taa_render_samples = 16
    sc.view_settings.view_transform = 'Filmic'
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    bgn = w.node_tree.nodes['Background']; bgn.inputs[0].default_value = (0.07, 0.08, 0.11, 1); bgn.inputs[1].default_value = 1.0
    def add_light(kind, loc, energy, color=(1,1,1), size=None):
        ld = bpy.data.lights.new('L', kind); ld.energy = energy; ld.color = color
        if size and kind == 'AREA': ld.size = size
        lo_ = bpy.data.objects.new('L', ld); lo_.location = ctr + loc; sc.collection.objects.link(lo_)
        look_at(lo_, ctr); return lo_
    add_light('SUN', Vector((rad*2, -rad*2, rad*3)), 3.0, (0.85, 0.9, 1.0))
    add_light('AREA', Vector((-rad*2, rad*1.5, -rad*0.5)), rad*rad*40, (1.0, 0.75, 0.5), size=rad*2)
    add_light('AREA', Vector((0, rad*2.5, rad*1.5)), rad*rad*20, (1.0, 0.85, 0.6), size=rad*2)
    cd = bpy.data.cameras.new('C'); cd.lens = 40; cd.clip_start = rad*0.002; cd.clip_end = rad*50
    cam = bpy.data.objects.new('C', cd); sc.collection.objects.link(cam); sc.camera = cam
    # side/up vectors from forward guess
    up = Vector((0, 0, 1))
    right = fwd.cross(up)
    if right.length < 1e-3: right = Vector((1, 0, 0))
    right.normalize()
    D = rad * 2.6
    views = {
        'front34': ctr + fwd*D*0.8 + right*D*0.6 + up*D*0.45,
        'rear34':  ctr - fwd*D*0.8 - right*D*0.6 + up*D*0.45,
        'top':     ctr + up*D*1.1 + fwd*D*0.02,
        'side':    ctr + right*D*1.05,
    }
    used = None
    for vn, loc in views.items():
        cam.location = loc; look_at(cam, ctr)
        used = render(os.path.join(OUT, f'{name}_{vn}.png'))
    # pilot POV: camera at the cockpit1 marker looking forward (does an interior exist?)
    if 'cockpit1' in empties:
        cp = empties['cockpit1'].matrix_world.translation
        cd.lens = 18
        cam.location = cp; look_at(cam, cp + fwd)
        render(os.path.join(OUT, f'{name}_pilotpov.png'))
        # exterior close-up of the cockpit area
        cd.lens = 50
        cam.location = cp + fwd*rad*0.9 + up*rad*0.5 + right*rad*0.35; look_at(cam, cp)
        render(os.path.join(OUT, f'{name}_cockpit_closeup.png'))
    stats[name]['render_engine'] = used
    print('DONE', name, json.dumps(stats[name]['topo']))

with open(os.path.join(OUT, 'ship_stats.json'), 'w') as f: json.dump(stats, f, indent=1)
print('ALL DONE')
