# Separate fused fingers from the body on a Meshy auto-rigged biped (no finger bones: the hand is one rigid bone).
# Step script: ARGS dict in, `result` dict out (run by char_pipeline.py headless, or over the live socket by bl.py).
#
# Per side: weld, then label every vertex near the hand + lower forearm ARM or BODY with a min-cut whose cost is
# the AREA of the faces that end up straddling the two labels (Meshy fuses the resting hand into the thigh through
# thin bridge slivers / a small fused patch, so the cheapest cut runs through them). Then delete the straddling
# faces, cap both openings, and re-weight: ARM side -> arm chain only (body weight folded into the vertex's own
# dominant arm bone), BODY side -> arm chain stripped; every leg/hip-dominated vertex elsewhere loses its leaked
# hand/forearm weight too (Meshy's heat weights reach 10+ cm down the thigh).
#
# What the cut is anchored by, and the failure each anchor fixed (Summoners first, 2026-10-06):
#   ARM seeds   hand core (hand weight > 0.9), the SLEEVE TUBE (forearm-weighted, within 1.25x the median
#               sleeve radius of the elbow-wrist axis), region-rim arm vertices within 1.6x that radius
#               (wider armour must not be read as body or the cut rings the forearm).
#   BODY seeds  pure body vertices, the region rim, anything far from the hand and outside the sleeve, and
#               the jacket hem BESIDE the cuff (outside 1.6x the tube, at or above the wrist) - left free, the
#               cut handed the hem to the hand and the raised arm dragged a fin of jacket with it.
#   PRIORS      shape diameter (median inward ray length): thin (< 4.5 cm) AND past the wrist along the hand's
#               direction -> a finger (thin cloth at the wrist is jacket, not finger); thick (> 7.5 cm) and not
#               arm -> thigh. Without them the cut sliced strips of thigh instead of the bridges.
#   CAPS        minimal-area triangulation over each opening's own vertices (holes_fill + BEAUTY and a centroid
#               fan both made spikes on these long non-planar openings); a cap triangle spanning two texture
#               islands takes one texel instead of smearing; caps are smooth-shaded (bm.faces.new makes flat
#               faces, which read as hard dark facets). Tagged 'cc_cap' for finalize.py.
#   ARM PASS    (upper=1, default; owner: "let's continue to fix the arm") the region also climbs the upper arm to
#               T0 (0.35 of shoulder->elbow, below the armpit) with its own measured tube, and takes in every
#               vertex below T0 carrying upper-arm weight: Meshy's arms-down rig fuses the inner arm / elbow to the
#               torso and weights the torso's SIDE ~45% to the humerus, so every raised arm dragged the suit up
#               (pilot cheer 76x elbow-to-waist, 24x ribs). The re-weight fades in over FADE above T0 so the
#               shoulder keeps its blend. A cut that stops below the armpit leaves ONE opening running down the arm
#               side and back up the body side: it is split where it changes side ('cc_side') and each run capped
#               alone - capped whole it bridged arm to torso (82-92x).
# mode=preview colours the labels into a 'cut' corner colour on a CC_regions copy instead (red = hand,
# green = body, blue = faces the apply would delete). Requires the mesh to carry no other edits.
import bpy, bmesh, mathutils, math, collections
arm = bpy.data.objects[ARGS['arm']]
me = max((o for o in arm.children if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
mode = ARGS.get('mode', 'preview')
zs = [v.co.z for v in me.data.vertices]; SC = (max(zs) - min(zs)) / 1.75
R = float(ARGS.get('R', 0.09)) * SC
CORE = float(ARGS.get('core', 0.85)); SRC = float(ARGS.get('src', 0.9)); SNK = float(ARGS.get('snk', 0.02))
# (arm pass) UPPER: extend the cut up the upper arm to T0 (0 = shoulder joint, 1 = elbow), below the armpit, so the
# shoulder stays one surface; the re-weight fades in over FADE above that so the armpit has no step.
UPPER = ARGS.get('upper', '1') == '1'; T0 = float(ARGS.get('t0', 0.35)); FADE = float(ARGS.get('fade', 0.25))
rep = {}
bm = bmesh.new(); bm.from_mesh(me.data)
n0 = len(bm.verts); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6 * SC); rep['weld'] = [n0, len(bm.verts)]
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.edges.ensure_lookup_table()
dl = bm.verts.layers.deform.active
gi = {g.name.replace('mixamorig:', ''): g.index for g in me.vertex_groups}


def ws(v, names):
    d = v[dl]
    return sum(d.get(gi[n], 0.0) for n in names if n in gi)


area = {f.index: f.calc_area() for f in bm.faces}
vA = {v.index: sum(area[f.index] for f in v.link_faces) / 3.0 for v in bm.verts}
# THICKNESS PRIOR (shape diameter): median inward ray length over a 20 deg cone. A finger is ~2 cm through, a
# thigh ~15 cm, so a thin vertex near the hand wants the HAND label and a thick non-arm vertex wants BODY.
bm.normal_update()
bvh = mathutils.bvhtree.BVHTree.FromBMesh(bm)
def sdf(v):
    n = -v.normal
    if n.length < 1e-6:
        return None
    t = n.orthogonal().normalized(); b = n.cross(t); ds = []
    for k in range(7):
        a = 2 * math.pi * k / 6
        d = n if k == 0 else (n + math.tan(math.radians(20)) * (math.cos(a) * t + math.sin(a) * b)).normalized()
        hit = bvh.ray_cast(v.co + d * 1e-4 * SC, d)
        if hit[0] is not None and hit[3] > 1e-4 * SC:
            ds.append(hit[3])
    ds.sort()
    return ds[len(ds) // 2] if ds else None
THIN = float(ARGS.get('thin', 0.045)) * SC; THICK = float(ARGS.get('thick', 0.075)) * SC; LAM = float(ARGS.get('lam', 3.0))


def maxflow(N, S, T, arcs):
    to = []; cap = []; adj = [[] for _ in range(N)]
    for a, b, c1, c2 in arcs:
        adj[a].append(len(to)); to.append(b); cap.append(c1)
        adj[b].append(len(to)); to.append(a); cap.append(c2)
    flow = 0.0
    while True:
        lvl = [-1] * N; lvl[S] = 0; q = collections.deque([S])
        while q:
            x = q.popleft()
            for e in adj[x]:
                if cap[e] > 1e-15 and lvl[to[e]] < 0:
                    lvl[to[e]] = lvl[x] + 1; q.append(to[e])
        if lvl[T] < 0:
            break
        it = [0] * N
        while True:   # iterative blocking-flow DFS
            stack = [S]; path = []
            while stack:
                x = stack[-1]
                if x == T:
                    break
                adv = False
                while it[x] < len(adj[x]):
                    e = adj[x][it[x]]; y = to[e]
                    if cap[e] > 1e-15 and lvl[y] == lvl[x] + 1:
                        stack.append(y); path.append(e); adv = True
                        break
                    it[x] += 1
                if not adv:
                    stack.pop()
                    if path:
                        path.pop()
                    if stack:
                        it[stack[-1]] += 1
            if not stack:
                break
            f = min(cap[e] for e in path)
            for e in path:
                cap[e] -= f; cap[e ^ 1] += f
            flow += f
    seen = [False] * N; seen[S] = True; q = collections.deque([S])
    while q:
        x = q.popleft()
        for e in adj[x]:
            if cap[e] > 1e-15 and not seen[to[e]]:
                seen[to[e]] = True; q.append(to[e])
    return flow, seen


lab = {}          # vert index -> (side, 'H'|'B')
nat = {}
def seg(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return t, (p - (a + ab * t)).length


def segu(p, a, b):   # (unclamped t, distance to the clamped segment)
    ab = b - a
    tu = (p - a).dot(ab) / ab.length_squared
    t = max(0.0, min(1.0, tu))
    return tu, (p - (a + ab * t)).length


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


BL = {}           # vert index -> re-weight blend (1 = fully cleaned; fades to 0 at the top of the upper-arm region)


for side in ('Left', 'Right'):
    HAND = [side + 'Hand', side + 'HandMiddle4']; FORE = [side + 'ForeArm', side + 'Arm', side + 'Shoulder']
    Hc = [ws(v, HAND) for v in bm.verts]; fo = [ws(v, FORE) for v in bm.verts]
    bone = lambda n: me.matrix_world.inverted() @ (arm.matrix_world @ arm.data.bones['mixamorig:' + side + n].head_local)
    shoulder, elbow, wrist = bone('Arm'), bone('ForeArm'), bone('Hand')
    core = [v for v in bm.verts if Hc[v.index] > CORE]
    kd = mathutils.kdtree.KDTree(len(core))
    for v in core:
        kd.insert(v.co, v.index)
    kd.balance()
    # the hand runs DISTAL of the wrist (wrist = the hand bone's head, direction = towards the hand core)
    hdir = (sum((v.co for v in core), mathutils.Vector()) / len(core) - wrist).normalized()
    # THE SLEEVE TUBE: median distance from the elbow-wrist axis of the vertices that are mostly forearm
    TR = {v.index: seg(v.co, elbow, wrist) for v in bm.verts}
    rs = sorted(TR[v.index][1] for v in bm.verts if ws(v, [side + 'ForeArm']) > 0.8 and 0.2 < TR[v.index][0] < 0.9)
    rsl = rs[len(rs) // 2]
    # (arm pass) THE UPPER-ARM TUBE, measured the same way on the shoulder-elbow axis. Meshy's arms-down rig
    # fuses the inner arm / elbow to the torso and waist AND heat-weights the torso's side ~45% to the upper arm:
    # every raised arm dragged the suit's side up with it (pilot: 24x at the ribs, 76x elbow-to-waist).
    UA = {v.index: segu(v.co, shoulder, elbow) for v in bm.verts}
    Aw = [ws(v, [side + 'Arm']) for v in bm.verts]
    ru_ = sorted(UA[v.index][1] for v in bm.verts if Aw[v.index] > 0.8 and 0.3 < UA[v.index][0] < 0.9)
    rup = ru_[len(ru_) // 2] if ru_ else rsl
    def tubeinfo(v):   # (distance to the nearest arm segment, that segment's tube radius, upper?)
        tf, rf = TR[v.index]; tu, ru = UA[v.index]
        if UPPER and tu > T0 and ru < rf:
            return ru, rup, True
        return rf, rsl, False
    # region: around the hand core, the lower forearm and whatever hangs beside it (the jacket hem), every
    # vertex with any hand weight (Meshy's heat weights leak 10+ cm down the thigh), and (arm pass) the upper arm
    # below T0 plus every vertex below T0 that carries upper-arm weight (the torso side)
    def near(v):
        if kd.find(v.co)[2] < R or (TR[v.index][0] > 0.35 and TR[v.index][1] < 2.6 * rsl):
            return True
        tu, ru = UA[v.index]
        return UPPER and tu > T0 and ru < 2.6 * rup
    reg = [v for v in bm.verts if near(v) or Hc[v.index] > 0.01 or (UPPER and UA[v.index][0] > T0 and Aw[v.index] > 0.02)]
    for v in reg:
        tu = UA[v.index][0]
        BL[v.index] = smooth01((tu - T0) / FADE) if (UPPER and tubeinfo(v)[2]) else 1.0
    rid = {v.index: k for k, v in enumerate(reg)}
    N = len(reg) + 2; S = N - 2; T = N - 1
    INF = 1e9; arcs = []; nsrc = nsnk = 0
    for v in reg:
        a = Hc[v.index] + fo[v.index]; th = (v.co - wrist).dot(hdir)
        rf, rr, _up = tubeinfo(v)
        tube = rf < 1.25 * rr
        rim = any(e.other_vert(v).index not in rid for e in v.link_edges)
        if Hc[v.index] > SRC or (fo[v.index] > 0.5 and tube and th < 0.03 * SC) or (rim and a > 0.5 and rf < 1.6 * rr):
            arcs.append((S, rid[v.index], INF, 0)); nsrc += 1                # hand core, the sleeve / arm tube
        elif (th < 0.01 * SC and rf > 1.6 * rr) or a < SNK or rim or not near(v):
            arcs.append((rid[v.index], T, INF, 0)); nsnk += 1                # outside the tube, pure body, rim
    pri = {'H': 0, 'B': 0}
    for v in reg:
        a = Hc[v.index] + fo[v.index]; sd = sdf(v); dc = kd.find(v.co)[2]; th = (v.co - wrist).dot(hdir)
        if sd is None:
            continue
        if sd < THIN and th > 0.02 * SC and (a > 0.08 or dc < 0.05 * SC):   # thin, past the wrist: a finger
            arcs.append((S, rid[v.index], LAM * vA[v.index], 0)); pri['H'] += 1
        elif sd > THICK and a < 0.5:                 # thick and not arm: thigh / hip, never the hand
            arcs.append((rid[v.index], T, LAM * vA[v.index], 0)); pri['B'] += 1
    for e in bm.edges:
        a, b = e.verts
        if a.index in rid and b.index in rid:
            c = sum(area[f.index] for f in e.link_faces) * 0.5 + 1e-9
            arcs.append((rid[a.index], rid[b.index], c, c))
    flow, seen = maxflow(N, S, T, arcs)
    for v in reg:
        if v.index not in lab:
            lab[v.index] = (side, 'H' if seen[rid[v.index]] else 'B')
    rep[side] = {'region_verts': len(reg), 'src': nsrc, 'snk': nsnk,
                 'hand_verts': sum(1 for v in reg if seen[rid[v.index]]),
                 'cut_area_cm2': round(flow / SC / SC * 1e4, 2), 'prior': pri, 'sleeve_r_cm': round(rsl / SC * 100, 1), 'upper_r_cm': round(rup / SC * 100, 1)}
    for v in bm.verts:   # natural class of everything outside the regions, for faces that reach across the rim
        if v.index not in rid and (v.index not in nat or Hc[v.index] + fo[v.index] > 0.5):
            nat[v.index] = 'H' if Hc[v.index] + fo[v.index] > 0.5 else 'B'


def fclass(f):
    ls = [lab.get(v.index) for v in f.verts]
    if all(l is None for l in ls):
        return None
    hs = {l[1] for l in ls if l}
    for v in f.verts:
        if v.index not in lab:
            hs.add(nat.get(v.index, 'B'))   # a face reaching outside the region: its natural class
    return 'M' if len(hs) > 1 else hs.pop()


cls = {f.index: fclass(f) for f in bm.faces}
rep['faces'] = dict(collections.Counter(c for c in cls.values() if c))
if ARGS.get('dbg'):
    INFO = {}
    for side in ('Left', 'Right'):
        HAND = [side + 'Hand', side + 'HandMiddle4']; FORE = [side + 'ForeArm', side + 'Arm', side + 'Shoulder']
        for v in bm.verts:
            if lab.get(v.index, (None,))[0] == side:
                INFO[v.index] = (lab[v.index][1], round(ws(v, HAND), 2), round(ws(v, FORE), 2), None if sdf(v) is None else round(sdf(v) / SC * 100, 1))
    big = sorted((f for f in bm.faces if cls[f.index] == 'M'), key=lambda f: -area[f.index])[:int(ARGS['dbg'])]
    rep['mixed_big'] = [(round(area[f.index] * 1e4, 1), [round(c, 3) for c in f.calc_center_median()], [INFO.get(v.index, ('out', nat.get(v.index))) for v in f.verts]) for f in big]
if mode == 'preview':
    old = bpy.data.objects.get('CC_regions')
    if old:
        bpy.data.objects.remove(old)
    d = me.data.copy(); d.name = 'CC_regions'
    o = bpy.data.objects.new('CC_regions', d); bpy.context.scene.collection.objects.link(o); o.matrix_world = me.matrix_world
    b2 = bm.copy(); b2.faces.ensure_lookup_table()
    keep = {f.index for f in bm.faces if cls[f.index]}
    cl = b2.loops.layers.float_color.get('cut') or b2.loops.layers.float_color.new('cut')
    for f in b2.faces:
        c = {'H': (1, .45, .35, 1), 'B': (.4, .9, .4, 1), 'M': (.1, .3, 1, 1)}.get(cls[f.index], (.5, .5, .5, 1))
        for l in f.loops:
            l[cl] = c
    bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.index not in keep], context='FACES')
    b2.to_mesh(d); b2.free(); d.color_attributes.active_color = d.color_attributes['cut']
    o.hide_render = True
else:
    # (layers first: adding a layer later invalidates every python BMFace reference)
    capl = bm.faces.layers.int.get('cc_cap') or bm.faces.layers.int.new('cc_cap')
    sidel = bm.verts.layers.int.get('cc_side') or bm.verts.layers.int.new('cc_side')
    cl = bm.loops.layers.float_color.get('capcol') or bm.loops.layers.float_color.new('capcol')
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    for v in bm.verts:   # 1 = arm side, 2 = body side (the caps must never join the two)
        l = lab.get(v.index)
        sd = l[1] if l else nat.get(v.index)
        v[sidel] = 1 if sd == 'H' else (2 if sd == 'B' else 0)
    mixed = [f for f in bm.faces if cls[f.index] == 'M']
    b0 = {e for e in bm.edges if e.is_boundary}   # Meshy's own open edges are left alone
    nb0 = len(b0)
    stat = collections.Counter()
    for v in bm.verts:   # re-weight before deleting (indices stay valid)
        l = lab.get(v.index)
        if not l:
            continue
        side, hb = l
        HANDG = [gi[n] for n in (side + 'Hand', side + 'HandMiddle4') if n in gi]
        ARMG = HANDG + [gi[n] for n in (side + 'ForeArm', side + 'Arm', side + 'Shoulder') if n in gi]
        d = v[dl]; w = dict(d.items())
        clean = None
        if hb == 'H':
            body = sum(x for g, x in w.items() if g not in ARMG)
            if body > 0:
                armw = {g: x for g, x in w.items() if g in ARMG}
                tgt = max(armw, key=armw.get) if armw else gi[side + 'Hand']
                clean = dict(armw); clean[tgt] = clean.get(tgt, 0.0) + body; stat['arm_got_body'] += 1
        else:
            armw = sum(x for g, x in w.items() if g in ARMG)
            rest = {g: x for g, x in w.items() if g not in ARMG}
            if armw > 0 and rest:
                s2 = sum(rest.values())
                clean = {g: x / s2 for g, x in rest.items()}; stat['body_lost_arm'] += 1
            elif armw > 0:
                stat['body_no_rest'] += 1
        if clean is not None:
            # (arm pass) fade: full clean-up below the upper-arm region's top band, the original blend at its top
            b = BL.get(v.index, 1.0)
            fin = {g: (1 - b) * w.get(g, 0.0) + b * clean.get(g, 0.0) for g in set(w) | set(clean)}
            tot = sum(fin.values()) or 1.0
            for g in list(d.keys()):
                del d[g]
            for g, x in fin.items():
                if x / tot > 1e-4:
                    d[g] = x / tot
            if b < 1:
                stat['faded'] += 1
    LEGS = {gi[n] for n in ('Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot') if n in gi}
    LOW = {gi[n] for n in ('LeftHand', 'LeftHandMiddle4', 'LeftForeArm', 'RightHand', 'RightHandMiddle4', 'RightForeArm') if n in gi}
    for v in bm.verts:
        if v.index in lab:
            continue
        d = v[dl]; w = dict(d.items())
        if not w or max(w, key=w.get) not in LEGS:
            continue
        lw = sum(x for g, x in w.items() if g in LOW)
        if lw <= 0:
            continue
        for g in LOW:
            if g in d:
                del d[g]
        s2 = sum(x for g, x in w.items() if g not in LOW)
        for g, x in w.items():
            if g not in LOW:
                d[g] = x / s2
        stat['leg_lost_lowarm'] += 1
    rep['reweight'] = dict(stat)
    bmesh.ops.delete(bm, geom=mixed, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    loose_e = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose_e, context='EDGES')
    nb = [e for e in bm.edges if e.is_boundary and e not in b0]
    rep['deleted_faces'] = len(mixed); rep['boundary_edges'] = [nb0, len(nb)]
    rep['bowtie_verts'] = sum(1 for v in bm.verts if sum(1 for e in v.link_edges if e.is_boundary) > 2)
    # MIN-AREA CAPS (Barequet-Sharir / Liepa hole filling): every opening is triangulated over its own boundary
    # vertices by the dynamic programme that minimises total area. No new vertices, so no cones (a centroid fan
    # made spikes on these long curved openings) and no projection overlaps (holes_fill + BEAUTY made spikes too);
    # a slit-shaped opening just zips shut. Winding: each boundary edge is walked opposite its face's own edge, so
    # the caps face the way their neighbours do. UVs: a cap triangle whose three corners sit on one texture island
    # keeps them; one spanning islands takes a single texel (a flat patch of the neighbouring colour, not a smear).
    uvl = bm.loops.layers.uv.active
    nxt = collections.defaultdict(list); cuv = {}
    for e in nb:
        f = e.link_faces[0]
        l = next(l for l in f.loops if l.edge == e)
        v0, v1 = l.vert, l.link_loop_next.vert
        nxt[v1].append(v0)
        if uvl:
            cuv.setdefault(v0, l[uvl].uv.copy()); cuv.setdefault(v1, l.link_loop_next[uvl].uv.copy())
    cycles = []
    while any(nxt.values()):
        st = next(v for v, n in nxt.items() if n)
        cyc = [st]; x = nxt[st].pop()
        while x != st and len(cyc) < 10000:
            cyc.append(x)
            if not nxt[x]:
                break
            x = nxt[x].pop()
        if x == st and len(cyc) >= 3:
            cycles.append(cyc)
    def tri_area(a, b, c):
        return (b.co - a.co).cross(c.co - a.co).length * 0.5
    # (arm pass) An opening whose cut ends below the armpit is ONE loop: down the arm side of the seam and back
    # up the body side, joined where arm and torso are still one surface. Filled whole, its cap bridged arm to
    # torso (82-92x at the pilot's armpits). Split every loop where it changes side; cap each run on its own,
    # closed by the chord between its ends. The few edges between runs stay open: the top of the seam.
    polys = []
    for cyc in cycles:
        sides = [v[sidel] for v in cyc]
        if len(set(sides)) <= 1:
            polys.append(cyc); continue
        k0 = next(i for i in range(len(cyc)) if sides[i] != sides[i - 1])
        cyc = cyc[k0:] + cyc[:k0]; sides = sides[k0:] + sides[:k0]
        run = [cyc[0]]
        for v, sd in zip(cyc[1:], sides[1:]):
            if sd == run[-1][sidel]:
                run.append(v)
            else:
                if len(run) >= 3:
                    polys.append(run)
                run = [v]
        if len(run) >= 3:
            polys.append(run)
    rep['cap_split_loops'] = sum(1 for cyc in cycles if len({v[sidel] for v in cyc}) > 1)
    ncap = 0; worst = 0
    for cyc in polys:
        n = len(cyc); worst = max(worst, n)
        W = [[0.0] * n for _ in range(n)]; K = [[-1] * n for _ in range(n)]
        for span in range(2, n):
            for i in range(0, n - span):
                j = i + span; best = 1e30; bk = -1
                for k in range(i + 1, j):
                    w = W[i][k] + W[k][j] + tri_area(cyc[i], cyc[k], cyc[j])
                    if w < best:
                        best = w; bk = k
                W[i][j] = best; K[i][j] = bk
        st = [(0, n - 1)]
        while st:
            i, j = st.pop()
            if j - i < 2:
                continue
            k = K[i][j]
            tv = (cyc[i], cyc[k], cyc[j])
            if len(set(tv)) == 3:
                try:
                    nf = bm.faces.new(tv)
                except ValueError:
                    nf = None
                if nf:
                    nf[capl] = 1; ncap += 1
                    nf.smooth = True   # bm.faces.new makes FLAT faces: a cap read as a hard dark facet
                    if uvl:
                        us = [cuv.get(v) for v in tv]
                        if any(u is None for u in us) or max((us[0] - us[1]).length, (us[1] - us[2]).length, (us[0] - us[2]).length) > 0.03:
                            u = next((u for u in us if u is not None), mathutils.Vector((0, 0)))
                            us = [u, u, u]
                        for nl, u in zip(nf.loops, us):
                            nl[uvl].uv = u
            st.append((i, k)); st.append((k, j))
    rep['cap_loops'] = len(cycles); rep['cap_tris'] = ncap; rep['cap_max_loop'] = worst
    if ARGS.get('capcol', '1') == '1':   # debug colour: caps red, the rest grey
        for f in bm.faces:
            c = (1, 0.1, 0.1, 1) if f[capl] else (0.75, 0.75, 0.75, 1)
            for l in f.loops:
                l[cl] = c
    rep['still_boundary'] = sum(1 for e in bm.edges if e.is_boundary)
    bm.to_mesh(me.data); me.data.update()
result = rep
bm.free()
