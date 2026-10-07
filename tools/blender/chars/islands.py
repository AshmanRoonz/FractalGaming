# Connected islands of a character's mesh (welded topology): size, centre, dominant bone.
#   ARGS: arm, [weld=1] (weld a copy first: a raw glTF import is split at every UV seam),
#         [delete_below=N] delete islands under N verts, [bones=A,B] only those whose dominant bone is listed,
#         [keep=JSON [[x,y,z],...]] never delete an island whose centre is within 1 cm of one of these
#         (handfix's cut frees fragments of the old hand-thigh bridge; the model's OWN small pieces - the pilot's
#         armpit and head bits - are recorded before the fix and passed here so they survive).
import bpy, bmesh, collections, json, mathutils
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
bm = bmesh.new(); bm.from_mesh(me.data)
zs = [v.co.z for v in bm.verts]; SC = (max(zs) - min(zs)) / 1.75
if ARGS.get('weld') == '1':
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6 * SC)
bm.verts.ensure_lookup_table()
dl = bm.verts.layers.deform.active
gn = {g.index: g.name.replace('mixamorig:', '') for g in me.vertex_groups}
seen = set(); isl = []
for v in bm.verts:
    if v.index in seen:
        continue
    st = [v]; seen.add(v.index); comp = []
    while st:
        x = st.pop(); comp.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen:
                seen.add(y.index); st.append(y)
    isl.append(comp)
isl.sort(key=len)


def centre(comp):
    return sum((v.co for v in comp), mathutils.Vector()) / len(comp)


def domof(comp):
    dom = collections.Counter()
    for v in comp:
        d = dict(v[dl].items())
        if d:
            dom[gn[max(d, key=d.get)]] += 1
    return dom.most_common(1)[0][0] if dom else '-'


out = []
for comp in isl[:-1]:
    nf = len({f.index for v in comp for f in v.link_faces})
    out.append((len(comp), nf, [round(x, 4) for x in centre(comp)], domof(comp)))
res = {'islands': len(isl), 'main': len(isl[-1]), 'small': out[:60]}
mx = int(ARGS.get('delete_below', 0))
if mx:
    only = set(ARGS['bones'].split(',')) if ARGS.get('bones') else None
    keep = [mathutils.Vector(p) for p in json.loads(ARGS.get('keep', '[]'))]
    kill = []
    for comp in isl[:-1]:
        if len(comp) >= mx or (only is not None and domof(comp) not in only):
            continue
        c = centre(comp)
        if any((c - k).length < 0.01 * SC for k in keep):
            continue
        kill.extend(comp)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(me.data); me.data.update(); res['deleted_verts'] = len(kill)
bm.free()
result = res
