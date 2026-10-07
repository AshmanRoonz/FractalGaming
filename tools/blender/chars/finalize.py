# restore the captured real corner normals (caps -> auto), verify, and strip the debug / work attributes
import bpy, numpy as np
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
m = me.data; n = len(m.loops)
cn = np.zeros(n * 3, np.float32); m.attributes['cc_nrm'].data.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
cap = np.zeros(n, bool)
if 'cc_cap' in m.attributes:
    cf = np.zeros(len(m.polygons), np.int32); m.attributes['cc_cap'].data.foreach_get('value', cf)
    lp = np.zeros(n, np.int32); ls = np.zeros(len(m.polygons), np.int32); lt = np.zeros(len(m.polygons), np.int32)
    m.polygons.foreach_get('loop_start', ls); m.polygons.foreach_get('loop_total', lt)
    lp = np.repeat(np.arange(len(m.polygons)), lt)
    cap = cf[lp] == 1
L = np.linalg.norm(cn, axis=1)
zero = (L < 1e-6) & ~cap
cn[cap | (L < 1e-6)] = 0
ok = L > 1e-6; cn[ok & ~cap] /= L[ok & ~cap, None]
m.normals_split_custom_set([tuple(x) for x in cn])
got = np.zeros(n * 3, np.float32); m.corner_normals.foreach_get('vector', got); got = got.reshape(-1, 3)
keep = ~cap & ~zero
dev = np.degrees(np.arccos(np.clip((got[keep] * cn[keep]).sum(1), -1, 1)))
res = {'corners': n, 'cap_corners': int(cap.sum()), 'lost_normal_corners': int(zero.sum()),
       'restored_max_dev_deg': round(float(dev.max()), 3), 'restored_mean_dev_deg': round(float(dev.mean()), 4)}
if ARGS.get('strip', '1') == '1':
    for an in ('cc_nrm', 'cc_cap', 'cc_side', 'capcol', 'cut', 'wts', 'sdf'):
        if an in m.attributes: m.attributes.remove(m.attributes[an])
    for ca in list(m.color_attributes): m.color_attributes.remove(ca)
res['attrs'] = [a.name for a in m.attributes if not a.name.startswith('.')]
result = res
