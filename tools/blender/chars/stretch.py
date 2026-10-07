# worst edge stretch (evaluated length / rest length) over every action, sampled every `step` frames
import bpy, numpy as np, collections
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
step = int(ARGS.get('step', 2))
m = me.data; nv = len(m.vertices); ne = len(m.edges)
E = np.zeros(ne * 2, np.int32); m.edges.foreach_get('vertices', E); E = E.reshape(-1, 2)
R = np.zeros(nv * 3, np.float32); m.vertices.foreach_get('co', R); R = R.reshape(-1, 3)
L0 = np.linalg.norm(R[E[:, 0]] - R[E[:, 1]], axis=1) + 1e-9
gn = {g.index: g.name.replace('mixamorig:', '') for g in me.vertex_groups}
dom = [gn[max(v.groups, key=lambda g: g.weight).group] if len(v.groups) else '-' for v in m.vertices]
worst = np.ones(ne, np.float32); wclip = [''] * ne
scn = bpy.context.scene; ad = arm.animation_data or arm.animation_data_create()
keep = ad.action
rep = {'clips': {}}
for act in [a for a in bpy.data.actions if a.name.startswith(ARGS.get('prefix', ''))]:
    ad.action = act
    if act.slots: ad.action_slot = act.slots[0]
    f0, f1 = map(int, act.frame_range)
    cw = np.ones(ne, np.float32)
    for f in range(f0, f1 + 1, step):
        scn.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get(); ev = me.evaluated_get(dg); em = ev.to_mesh()
        P = np.zeros(nv * 3, np.float32); em.vertices.foreach_get('co', P); P = P.reshape(-1, 3); ev.to_mesh_clear()
        r = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) / L0
        cw = np.maximum(cw, r)
    upd = cw > worst
    for i in np.nonzero(upd)[0]: wclip[i] = act.name
    worst = np.maximum(worst, cw)
    rep['clips'][act.name] = {'frames': f1 - f0 + 1, '>1.5': int((cw > 1.5).sum()), '>2': int((cw > 2).sum()), '>4': int((cw > 4).sum()), 'max': round(float(cw.max()), 2)}
ad.action = keep
if keep and keep.slots: ad.action_slot = keep.slots[0]
pairs = collections.Counter(); pmax = {}
for i in np.nonzero(worst > 1.5)[0]:
    k = '|'.join(sorted((dom[E[i, 0]], dom[E[i, 1]]))); pairs[k] += 1; pmax[k] = max(pmax.get(k, 0), float(worst[i]))
rep['by_bones(>1.5)'] = {k: [v, round(pmax[k], 2)] for k, v in pairs.most_common(25)}
top = np.argsort(-worst)[:12]
rep['top'] = [(round(float(worst[i]), 2), wclip[i], dom[E[i, 0]], dom[E[i, 1]], [round(float(x), 3) for x in R[E[i, 0]]], round(float(L0[i]), 3)) for i in top]
if ARGS.get('near'):
    import mathutils
    c = np.array([float(x) for x in ARGS['near'].split(',')]); rr = float(ARGS.get('rad', 0.1))
    sel = [i for i in np.argsort(-worst) if np.linalg.norm(R[E[i, 0]] - c) < rr][:int(ARGS.get('n', 15))]
    def wd(vi):
        return {gn[g.group]: round(g.weight, 2) for g in m.vertices[vi].groups if g.weight > 0.01}
    rep['near'] = [(round(float(worst[i]), 2), wclip[i], [round(float(x), 3) for x in R[E[i, 0]]], [round(float(x), 3) for x in R[E[i, 1]]], wd(E[i, 0]), wd(E[i, 1])) for i in sel]
rep['total >1.5 / >2 / >4'] = [int((worst > 1.5).sum()), int((worst > 2).sum()), int((worst > 4).sum())]
if ARGS.get('save'): np.save(ARGS['save'], worst)
result = rep
