"""xorzo_build.py - Xorzo, the red and green orb, from the owner's Meshy export.

Owner (2026-09-28): "Xorzo.glb needs fixing and condensing... meshy couldn't get his coloring right... he did
the entire orb green... this glb will replace the red and green orb, in the campaign and everywhere in the
game... we have to get the size and coloring right".

    assets_base/objects/Xorzo.glb   the Meshy export: 4.39 M triangles, one material, 4k JPEG colour + 4k
                                    normal + 2k metal/rough; dark metal with TEAL accents; a lens eye at +Z and
                                    at -Z, big glowing panels at +X and -X, a ridge over the top along Z
      -> RECOLOUR   the faces left of the centre plane (x < 0 = the running light's red PORT side) get a copy
                    of the material whose colour map has its teal re-hued to RED; the right half's teal is
                    re-hued to a clear GREEN (Meshy's is cyan-leaning). Greys, blacks and the white lens
                    centres keep their colour: only the saturated teal band moves.
      -> LOW POLY   a UV sphere (--seg around, --seg/2 rings) shrink-wrapped onto the hi-poly along its own
                    normals. Xorzo IS a sphere, so this keeps his silhouette with ONE clean UV layout -
                    Meshy's atlas is thousands of islands, and a collapse decimation of it smears the texture
                    across every seam (the ship_plain.py lesson).
      -> BAKE       Cycles, hi -> lo: a tangent NORMAL map first (the panel relief the sphere does not have),
                    then COLOUR and METAL/ROUGH through an emission rewire - a DIFFUSE colour bake would be
                    black wherever the surface is metal.
      -> assets_src/objects/xorzo.glb       then: node tools/compress_glb.mjs --only xorzo

    blender --background --python tools/blender/xorzo_build.py -- [--seg 64] [--tex 2048]
        [--red 358] [--green 140] [--src assets_base/objects/Xorzo.glb] [--out assets_src/objects/xorzo.glb]

Orientation is the export's own: lenses on +/-Z, panels on +/-X, red on -X. In the game the orb is a child of
the ship's running-light group, whose -X is port - so it mounts with no rotation (see _addShipRunningLight).
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(k, d=''):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d


def step(*a):
    print('[step]', *a, flush=True)


REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(REPO, opt('--src', 'assets_base/objects/Xorzo.glb'))
OUT = os.path.join(REPO, opt('--out', 'assets_src/objects/xorzo.glb'))
REPORT = os.path.join(REPO, 'tools', 'blender', 'reports', 'xorzo')
SEG = int(opt('--seg', '64'))              # 64 around x 32 rings = ~4k triangles
TEX = int(opt('--tex', '2048'))            # colour + normal ; metal/rough at half
RED_HUE = float(opt('--red', '358'))       # degrees ; the old bead is 0xff3030
GREEN_HUE = float(opt('--green', '140'))   # the old bead is 0x30ff30 (120) ; 140 keeps a little of the teal
SAMPLES = int(opt('--samples', '4'))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
os.makedirs(REPORT, exist_ok=True)
t0 = time.time()
rep = {'src': os.path.relpath(SRC, REPO), 'seg': SEG, 'tex': TEX, 'red_hue': RED_HUE, 'green_hue': GREEN_HUE}


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def src_image_node(sock):
    """The image texture node that feeds a socket, walking back through any converters."""
    seen, stack = set(), [l.from_node for l in sock.links]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        if n.type == 'TEX_IMAGE' and n.image:
            return n
        for i in n.inputs:
            stack += [l.from_node for l in i.links]
    return None


def rehue(img, name, hue_deg):
    """A copy of `img` with its saturated teal/green band moved to `hue_deg`, value and saturation kept.
    Works on the stored (sRGB-encoded) values, which is where hue means what the eye sees."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    mx, mn = rgb.max(1), rgb.min(1)
    d = mx - mn
    dd = np.maximum(d, 1e-6)
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    hh = np.where(mx == r, ((g - b) / dd) % 6.0, np.where(mx == g, (b - r) / dd + 2.0, (r - g) / dd + 4.0)) * 60.0
    # the band Meshy painted (measured: 120-180, almost all 150-180) with soft shoulders, and only where
    # there is colour to move (greys stay grey, the lens centres stay white)
    w_h = np.clip((hh - 90.0) / 20.0, 0, 1) * np.clip((225.0 - hh) / 20.0, 0, 1)
    w_s = np.clip((s - 0.06) / 0.10, 0, 1)
    wt = (w_h * w_s)[:, None]
    # HSV -> RGB at one constant hue
    c = mx * s
    hn = (hue_deg % 360.0) / 60.0
    x = c * (1.0 - abs(hn % 2.0 - 1.0))
    z = np.zeros_like(c)
    sector = int(hn) % 6
    cols = [(c, x, z), (x, c, z), (z, c, x), (z, x, c), (x, z, c), (c, z, x)][sector]
    m = mx - c
    new = np.stack([cols[0] + m, cols[1] + m, cols[2] + m], axis=1)
    out_rgb = rgb * (1.0 - wt) + new * wt
    out = np.concatenate([out_rgb, px[:, 3:4]], axis=1).astype(np.float32).ravel()
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.colorspace_settings.name = img.colorspace_settings.name
    im.pixels.foreach_set(out)
    im.pack()
    return im, float(wt.mean())


# ---- import ------------------------------------------------------------------------------------
step('import', SRC)
bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
if len(meshes) > 1:
    select_only(meshes, meshes[0])
    bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active if len(meshes) > 1 else meshes[0]
select_only([hi])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hi.name = 'hi'
co = np.empty(len(hi.data.vertices) * 3, np.float32)
hi.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
ctr, half = (mn + mx) / 2.0, (mx - mn) / 2.0
L = float((mx - mn).max())
rep['in'] = {'tris': sum(len(p.vertices) - 2 for p in hi.data.polygons), 'min': mn.round(4).tolist(), 'max': mx.round(4).tolist()}
step('in', rep['in'])

# ---- recolour: two materials on the hi-poly -----------------------------------------------------
step('recolour')
mat_g = hi.data.materials[0]
bsdf = next(n for n in mat_g.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
base_node = src_image_node(bsdf.inputs['Base Color'])
mr_node = src_image_node(bsdf.inputs['Roughness']) or src_image_node(bsdf.inputs['Metallic'])
nrm_node = src_image_node(bsdf.inputs['Normal'])
if base_node is None:
    raise RuntimeError('no base colour image on the Meshy material')
src_img = base_node.image
if src_img.size[0] > TEX:
    src_img.scale(TEX, TEX)              # the bake target is TEX: no point re-hueing 4k
img_green, cov_g = rehue(src_img, 'xorzo_src_green', GREEN_HUE)
img_red, cov_r = rehue(src_img, 'xorzo_src_red', RED_HUE)
base_node.image = img_green
mat_g.name = 'xorzo_green'
mat_r = mat_g.copy()
mat_r.name = 'xorzo_red'
bsdf_r = next(n for n in mat_r.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
src_image_node(bsdf_r.inputs['Base Color']).image = img_red
hi.data.materials.append(mat_r)
npoly = len(hi.data.polygons)
pc = np.empty(npoly * 3, np.float32)
hi.data.polygons.foreach_get('center', pc)
side = (pc[0::3] < ctr[0]).astype(np.int32)          # x < centre -> material 1 (red, port)
hi.data.polygons.foreach_set('material_index', side)
hi.data.update()
rep['recolour'] = {'teal_moved_pct': round(100 * cov_g, 2), 'red_faces_pct': round(100 * float(side.mean()), 1),
                   'maps': {'base': src_img.name, 'mr': mr_node.image.name if mr_node else None,
                            'normal': nrm_node.image.name if nrm_node else None}}
step('recolour', rep['recolour'])

# ---- low poly: a sphere wrapped onto him --------------------------------------------------------
step('low poly')
bpy.ops.mesh.primitive_uv_sphere_add(segments=SEG, ring_count=SEG // 2, radius=1.0, location=tuple(ctr))
lo = bpy.context.view_layer.objects.active
lo.name = lo.data.name = 'xorzo'
lo.scale = tuple(half * 1.04)
select_only([lo])
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
sw = lo.modifiers.new('wrap', 'SHRINKWRAP')
sw.target = hi
sw.wrap_method = 'PROJECT'
sw.use_negative_direction = True
sw.use_positive_direction = True
sw.project_limit = 0.25 * L               # a lens recess must not drag a vertex across the orb
bpy.ops.object.modifier_apply(modifier=sw.name)
smooth = np.ones(len(lo.data.polygons), dtype=bool)
lo.data.polygons.foreach_set('use_smooth', smooth)
lo.data.update()
rep['low'] = {'tris': sum(len(p.vertices) - 2 for p in lo.data.polygons), 'verts': len(lo.data.vertices)}
step('low', rep['low'])

# ---- the low material + bake targets (image nodes are linked AFTER the bakes: a bake target that is
#      also an input of the material being shaded is a circular dependency) -------------------------
mat = bpy.data.materials.new('xorzo')
try:
    mat.use_nodes = True
except Exception:
    pass
nt = mat.node_tree
lb = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')


def new_img(name, size, data):
    im = bpy.data.images.new(name, size, size, alpha=False)
    if data:
        im.colorspace_settings.name = 'Non-Color'
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = im
    return im, n


img_c, n_c = new_img('xorzo_base', TEX, False)
img_n, n_n = new_img('xorzo_normal', TEX, True)
img_m, n_m = new_img('xorzo_mr', TEX // 2, True)
lo.data.materials.clear()
lo.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
cage, ray = 0.02 * L, 0.06 * L


def bake(kind, node, **kw):
    nt.nodes.active = node
    select_only([hi, lo], lo)
    t1 = time.time()
    res = bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=cage,
                              max_ray_distance=ray, margin=8, **kw)
    node.image.pack()
    return {'result': str(res), 'seconds': round(time.time() - t1, 1)}


step('bake normal')
rep['bake_normal'] = bake('NORMAL', n_n, normal_space='TANGENT')


def emit_from(sock_name):
    """Rewire both hi-poly materials so their surface EMITS what feeds `sock_name` (colour or the MR map)."""
    for m in (mat_g, mat_r):
        t = m.node_tree
        b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
        src = src_image_node(b.inputs[sock_name])
        out = next(n for n in t.nodes if n.type == 'OUTPUT_MATERIAL')
        em = t.nodes.get('bake_emit') or t.nodes.new('ShaderNodeEmission')
        em.name = 'bake_emit'
        em.inputs['Strength'].default_value = 1.0
        for l in list(em.inputs['Color'].links):
            t.links.remove(l)
        if src is not None:
            t.links.new(src.outputs['Color'], em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = (0.0, 0.6, 1.0, 1.0)   # no map: rough 0.6, metal 1 (glTF G/B)
        t.links.new(em.outputs['Emission'], out.inputs['Surface'])


step('bake colour')
emit_from('Base Color')
rep['bake_color'] = bake('EMIT', n_c)
px = np.empty(TEX * TEX * 4, np.float32)
img_c.pixels.foreach_get(px)
rgb = px.reshape(-1, 4)[:, :3]
rep['bake_color']['mean_rgb'] = rgb.mean(0).round(3).tolist()
rep['bake_color']['nonblack_pct'] = round(float(100 * (rgb.max(1) > 0.02).mean()), 1)
if rep['bake_color']['nonblack_pct'] < 5:
    raise RuntimeError('the colour bake wrote nothing: %s' % rep['bake_color'])

step('bake metal/rough')
emit_from('Roughness')
rep['bake_mr'] = bake('EMIT', n_m)

# ---- link the low material ---------------------------------------------------------------------
nt.links.new(n_c.outputs['Color'], lb.inputs['Base Color'])
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(n_m.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], lb.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], lb.inputs['Metallic'])
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(n_n.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], lb.inputs['Normal'])

bpy.data.objects.remove(hi, do_unlink=True)

# ---- export ------------------------------------------------------------------------------------
step('export', OUT)
select_only([lo])
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_image_format='AUTO', export_materials='EXPORT',
                          export_normals=True, export_texcoords=True, export_animations=False,
                          export_lights=False, export_cameras=False, export_extras=False)
rep['out'] = {'path': os.path.relpath(OUT, REPO), 'bytes': os.path.getsize(OUT)}
rep['seconds'] = round(time.time() - t0, 1)
with open(os.path.join(REPORT, 'xorzo_build.json'), 'w') as fh:
    json.dump(rep, fh, indent=1)
print('XORZO', json.dumps(rep))
