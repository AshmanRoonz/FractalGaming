# -*- coding: utf-8 -*-
"""Straighten the bumpy canopy window-frame lines, in the GLB itself.

WHAT THE OWNER SAW
  From the pilot's seat the canopy frame rails wobble - "you'll see bumps on one side and not
  the other, that's the clue". The clue is exact: the frame is a single swept tube and the two
  rails were generated INDEPENDENTLY, so they carry different wobble and are not even sampled
  the same (Pyro: 108 stations down one rail, 98 down the other). Nothing in the repo authors
  this mesh - it arrives asymmetric from the source art, which is why no pipeline stage ever
  fixed it.

WHAT THIS DOES
  The frame shell is a closed swept tube: a ring of M verts repeated over N stations, running
  aft arch -> one rail -> bow -> the other rail. So:

    1. find the tube (largest connected component with a clean ring topology),
    2. walk it into rings, take each ring's centroid -> the sweep PATH,
    3. split the path at its two centreline crossings (the arch apex and the bow) into two
       halves, resample both by arc length, mirror one onto the other and AVERAGE -> one
       canonical half. Both rails now agree by construction.
    4. LOW-PASS the half with a local quadratic (Savitzky-Golay) fit. Quadratic, not linear:
       the aft arch is a real arc and a straightening filter would pull it into a chord. This
       kills the wobble and leaves the intended curvature alone. Genuine corners are detected
       by turn angle and the fit is blended out near them so they stay crisp.
    5. move each ring RIGIDLY onto its new centroid.

  Rigid ring moves are the whole trick: the tube's cross-section - its thickness, its facets,
  its shading - is carried along untouched, so the part still looks like itself. Only the line
  it sweeps changes.

(!) NORMALS ARE DELIBERATELY NOT RECOMPUTED. A rigid translation does not change a face normal,
  and the residual tilt between neighbouring stations is under a degree. Recomputing them would
  area-average the facets into a round tube and visibly change the shading - a bigger error than
  the one being fixed.

(!) EDIT assets_src/, NOT LSS/. assets_src/ships/*.glb is float32 and unquantized ; LSS/ships is
  the i16-quantized deploy copy and LSS/ships/m is decimated to a different vertex count, so
  neither can be patched by index. Run `node tools/compress_glb.mjs --only ships` afterwards to
  rebuild both, then bump _MODELS_VERSION in LSS/index-working.html or the browser serves the
  cached asset under the unchanged query string and the fix is invisible. See
  tools/raise_cockpit_marker.py for the same trap.

USAGE
  python tools/straighten_canopy_frame.py                  # report only, every ship
  python tools/straighten_canopy_frame.py --write          # apply
  python tools/straighten_canopy_frame.py --ships pyro --write
  python tools/straighten_canopy_frame.py --mesh CanopyFrame   # narrow which meshes are touched
  python tools/straighten_canopy_frame.py --extend             # also rebuild short rails (see EXTEND_ENABLED)
"""
import json
import math
import os
import struct
import sys

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
SHIPS = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']

# ---------------------------------------------------------------------------------------------
# tuning
# ---------------------------------------------------------------------------------------------
# All four windows are in RESAMPLE samples, not stations.
# (!) SG_HALF MUST EXCEED THE WOBBLE'S HALF-WAVELENGTH or the fit rides the wobble instead of
# cutting it. Pyro's worst wobble runs ~9 stations ~= 20 samples, and SG_HALF 9 removed almost
# none of it (mean rail deviation 0.0132 -> 0.0123). 20 is chosen from that measurement.
SG_HALF = 20
CORNER_DEG = 22.0    # turn over +-CORNER_WIN that counts as a real corner rather than wobble
CORNER_WIN = 12
CORNER_FALLOFF = 14  # samples over which the fit is blended back out around a corner
RESAMPLE = 240       # samples used for the mirror-average of the two halves
# A sweep only earns the mirror pass if it is a proper canopy ring: closed, crossing the
# centreline exactly twice, and with two halves of comparable length. Measured on the fleet the
# split is absolute - blaster/puncture/pyro/syphon sit at ratio 0.93-1.00 with a zero seam gap,
# while tracker/vortex/slayer are OPEN sweeps at 0.19-0.82 whose two rails simply end at
# different places. Averaging a truncated half against a full one drags one rail's end onto the
# other's, so those get the de-wobble alone.
CLOSED_SEAM = 0.02   # seam gap, as a fraction of the across-span, that still counts as closed
HALF_RATIO = 0.88    # shorter half / longer half
PLANE_TOL = 0.01     # |arc-weighted plane - bbox midplane|, as a fraction of the across-span
# An OPEN sweep with ONE centreline crossing is a canopy hoop whose two rails simply stop at
# different places. Below this ratio the short rail is REBUILT from the long one's mirror rather
# than averaged - averaging would meet in the middle and shorten the good side, and the owner's
# complaint is the opposite: "from the back of the frame, it should go down a lot more, but it
# doesn't, it stops". Measured: vortex 0.63, tracker 0.82, slayer 0.20.
#
# (!) OPT-IN ONLY, AND IT DID NOT WORK ON VORTEX. Rebuilding the short rail from the long one's
# mirror is geometrically sound but visually wrong here: vortex's short rail is not the window-edge
# rail, so the mirrored path lands INSIDE the canopy and renders as a bar across the glass. Judged
# from outside at high zoom, the original stub reads better than the rebuild. The rail that really
# stops short (owner: "from the back of the frame, it should go down a lot more, but it doesn't,
# it stops") needs the frame EXTENDED along its own tangent to meet the hull - that is modelling,
# not filtering. Kept because the measurement is the useful part.
EXTEND_RATIO = 0.90
EXTEND_ENABLED = False   # --extend flips this on
# (!) THE MIRROR AXIS IS Z, NOT Y. These GLBs are raw glTF (Y-up): the ship's axes are
# forward -X, up +Y, right -Z, so the centreline plane is z = 0. Blender's importer rotates
# Y-up -> Z-up on the way in, which is why the same hull mirrors about y = 0 once it is open in
# Blender. Getting this wrong finds no centreline crossing at all and the fix silently no-ops.
MIRROR_AXIS = 2


# ---------------------------------------------------------------------------------------------
# tiny vector helpers (pure python - this module is imported by Blender AND by system python)
# ---------------------------------------------------------------------------------------------
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def length(a):
    return math.sqrt(dot(a, a))


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def across(a):
    return a[MIRROR_AXIS]


def mirror(a, c=0.0):
    """Reflect across the plane `across == c`."""
    return tuple(2.0 * c - v if k == MIRROR_AXIS else v for k, v in enumerate(a))


def plane_of(path):
    """Where the part's own centreline plane actually sits.

    (!) IT IS NOT ZERO. Each canopy part is a child node with its own translation, and on Pyro
    that translation is 0.00023 off centre - so the mesh's local `across == 0` is NOT the ship's
    mirror plane, and reflecting about it bakes the offset in as a permanent residual skew.
    A closed loop that straddles the plane has its arc-length-weighted mean ON the plane, so
    that mean is the plane."""
    n = len(path)
    num = den = 0.0
    for i in range(n):
        w = 0.5 * (length(sub(path[i], path[(i - 1) % n])) + length(sub(path[(i + 1) % n], path[i])))
        num += across(path[i]) * w
        den += w
    return num / den if den else 0.0


# ---------------------------------------------------------------------------------------------
# topology
# ---------------------------------------------------------------------------------------------
def components(nv, tris):
    adj = [[] for _ in range(nv)]
    for t in tris:
        for i in range(3):
            a, b = t[i], t[(i + 1) % 3]
            adj[a].append(b)
            adj[b].append(a)
    seen = [False] * nv
    out = []
    for s in range(nv):
        if seen[s]:
            continue
        seen[s] = True
        stack, comp = [s], [s]
        while stack:
            x = stack.pop()
            for o in adj[x]:
                if not seen[o]:
                    seen[o] = True
                    stack.append(o)
                    comp.append(o)
        out.append(comp)
    out.sort(key=len, reverse=True)
    return out, adj


def rings_of(comp, adj, tris_of_comp):
    """Walk a swept tube into its rings. Returns [[vi,...], ...] or None if it isn't one.

    BFS from one open rim gives the rings directly: in a (triangulated) grid tube every edge -
    the quad diagonals included - advances the station index by at most one, so BFS level ==
    station. A part that is not a tube fails the constant-ring-size check and is skipped."""
    cset = set(comp)
    ecount = {}
    for t in tris_of_comp:
        for i in range(3):
            a, b = t[i], t[(i + 1) % 3]
            k = (a, b) if a < b else (b, a)
            ecount[k] = ecount.get(k, 0) + 1
    rim = [e for e, n in ecount.items() if n == 1]
    if not rim:
        return None
    radj = {}
    for a, b in rim:
        radj.setdefault(a, []).append(b)
        radj.setdefault(b, []).append(a)
    used, loops = set(), []
    for s in list(radj):
        if s in used:
            continue
        used.add(s)
        loop, cur = [s], s
        while True:
            nxt = [x for x in radj[cur] if x not in used]
            if not nxt:
                break
            cur = nxt[0]
            used.add(cur)
            loop.append(cur)
        loops.append(loop)
    if len(loops) != 2 or len(loops[0]) != len(loops[1]):
        return None
    M = len(loops[0])
    lvl = {v: 0 for v in loops[0]}
    frontier, out = list(loops[0]), [list(loops[0])]
    while frontier:
        nxt = []
        k = len(out)
        for v in frontier:
            for o in adj[v]:
                if o in cset and o not in lvl:
                    lvl[o] = k
                    nxt.append(o)
        if nxt:
            out.append(nxt)
        frontier = nxt
    if sum(len(r) for r in out) != len(comp) or any(len(r) != M for r in out):
        return None
    return out


# ---------------------------------------------------------------------------------------------
# the path fix
# ---------------------------------------------------------------------------------------------
def arc_params(pts):
    """Cumulative normalised arc length over an open polyline."""
    d = [0.0]
    for i in range(1, len(pts)):
        d.append(d[-1] + length(sub(pts[i], pts[i - 1])))
    total = d[-1] or 1.0
    return [x / total for x in d]


def sample_at(pts, ts, t):
    """Linear sample of a polyline at normalised arc position t."""
    if t <= ts[0]:
        return pts[0]
    if t >= ts[-1]:
        return pts[-1]
    lo, hi = 0, len(ts) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if ts[mid] <= t:
            lo = mid
        else:
            hi = mid
    span = ts[hi] - ts[lo]
    return lerp(pts[lo], pts[hi], 0.0 if span <= 0 else (t - ts[lo]) / span)


def corner_weight(pts):
    """1 where the path really turns a corner, 0 along a run. Smoothly blended between."""
    n = len(pts)
    raw = [0.0] * n
    for i in range(n):
        a = pts[max(0, i - CORNER_WIN)]
        b = pts[min(n - 1, i + CORNER_WIN)]
        u, v = sub(pts[i], a), sub(b, pts[i])
        lu, lv = length(u), length(v)
        if lu < 1e-9 or lv < 1e-9:
            continue
        c = max(-1.0, min(1.0, dot(u, v) / (lu * lv)))
        raw[i] = 1.0 if math.degrees(math.acos(c)) > CORNER_DEG else 0.0
    w = [0.0] * n
    for i in range(n):
        if raw[i] == 0.0:
            continue
        for j in range(max(0, i - CORNER_FALLOFF), min(n, i + CORNER_FALLOFF + 1)):
            w[j] = max(w[j], 1.0 - abs(j - i) / float(CORNER_FALLOFF + 1))
    return w


def sg_smooth(pts, half=SG_HALF):
    """Local least-squares QUADRATIC in arc length, evaluated at the sample.

    Quadratic so a genuine arc (the aft roll hoop) survives ; a linear fit would chord it."""
    n = len(pts)
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + length(sub(pts[i], pts[i - 1])))
    out = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n - 1, i + half)
        if hi - lo < 4:
            out.append(pts[i])
            continue
        xs = [s[k] - s[i] for k in range(lo, hi + 1)]
        m = [[sum(x ** (p + q) for x in xs) for q in range(3)] for p in range(3)]
        fit = []
        for axis in range(3):
            ys = [pts[k][axis] for k in range(lo, hi + 1)]
            rhs = [sum(y * (x ** p) for x, y in zip(xs, ys)) for p in range(3)]
            a = [row[:] + [r] for row, r in zip(m, rhs)]
            ok = True
            for c in range(3):                      # gaussian elimination, 3x3
                piv = max(range(c, 3), key=lambda r_: abs(a[r_][c]))
                a[c], a[piv] = a[piv], a[c]
                if abs(a[c][c]) < 1e-18:
                    ok = False
                    break
                for r_ in range(3):
                    if r_ == c:
                        continue
                    f = a[r_][c] / a[c][c]
                    for k in range(c, 4):
                        a[r_][k] -= f * a[c][k]
            fit.append(a[0][3] / a[0][0] if ok and abs(a[0][0]) > 1e-18 else pts[i][axis])
        out.append(tuple(fit))
    # (!) DETECT CORNERS ON THE SMOOTHED CURVE, NOT THE RAW ONE. A wobble of a few samples turns
    # through a large angle over a short window, so measuring the raw path flags the very bumps
    # this is here to remove and then faithfully protects them. A real corner survives the fit ;
    # a bump does not, so the fit is the honest place to ask.
    w = corner_weight(out)
    return [lerp(out[i], pts[i], w[i]) for i in range(n)]


def straighten_path(cent):
    """cent = the closed ring-centroid path. Returns (corrected path, None) or (None, why)."""
    n = len(cent)
    c = plane_of(cent)
    cross = [i for i in range(n)
             if (across(cent[i]) - c) * (across(cent[(i + 1) % n]) - c) < 0]
    if len(cross) != 2:
        return None, 'path crosses the centreline %d times, expected 2' % len(cross)
    p, q = cross
    def pole(i):
        a, b = across(cent[i]) - c, across(cent[(i + 1) % n]) - c
        pt = list(lerp(cent[i], cent[(i + 1) % n], a / (a - b)))
        pt[MIRROR_AXIS] = c                        # land it exactly on the centreline
        return tuple(pt)

    poleA, poleB = pole(p), pole(q)

    idxA = [(p + 1 + k) % n for k in range((q - p) % n)]            # first half
    idxB = [(q + 1 + k) % n for k in range((p - q) % n)]            # second half
    A = [poleA] + [cent[i] for i in idxA] + [poleB]
    B = [poleB] + [cent[i] for i in idxB] + [poleA]
    A2 = [mirror(x, c) for x in reversed(B)]                       # B, mirrored, re-run A's way

    tA, tA2, tB = arc_params(A), arc_params(A2), arc_params(B)
    H = []
    for k in range(RESAMPLE):
        t = k / float(RESAMPLE - 1)
        H.append(mul(add(sample_at(A, tA, t), sample_at(A2, tA2, t)), 0.5))
    H = sg_smooth(H)
    for k in (0, -1):                              # the fit may drift the poles off the plane
        e = list(H[k])
        e[MIRROR_AXIS] = c
        H[k] = tuple(e)
    tH = arc_params(H)

    out = list(cent)
    for k, i in enumerate(idxA):
        out[i] = sample_at(H, tH, tA[k + 1])
    for k, i in enumerate(idxB):
        # a point at arc u along B sits at arc 1-u along A2, which shares H's parameterisation
        out[i] = mirror(sample_at(H, tH, 1.0 - tB[k + 1]), c)
    return out, None


def smooth_only(cent, closed):
    """De-wobble a sweep that has no usable mirror partner. Shape kept, bumps cut.

    (!) THE RIMS ARE PINNED. On these hulls the frame is a CHAIN of tube segments that butt
    against each other, so moving an end vertex opens a visible gap at the joint. The fit is
    blended back to the original over the last `half` stations at each end."""
    n = len(cent)
    half = max(3, int(round(SG_HALF * n / float(2 * RESAMPLE))))
    out = sg_smooth(cent, half)
    if not closed:
        for i in range(n):
            e = min(i, n - 1 - i)
            if e < half:
                out[i] = lerp(out[i], cent[i], 1.0 - e / float(half))
    return out


def mirror_short_half(cent):
    """Open sweep, one crossing, one rail short: rebuild the short rail from the long one.

    The long rail is mirrored across the centreline and the short rail's stations are re-spread
    along it by arc length. The station COUNT is unchanged - the tube simply takes longer strides
    on that side - so nothing downstream (indices, normals, the gasket's matching topology) moves.
    """
    n = len(cent)
    c = plane_of(cent)
    cross = [i for i in range(n - 1) if (across(cent[i]) - c) * (across(cent[i + 1]) - c) < 0]
    if len(cross) != 1:
        return None, 'open sweep with %d centreline crossings, expected 1' % len(cross)
    k = cross[0]
    a, b = across(cent[k]) - c, across(cent[k + 1]) - c
    pole = list(lerp(cent[k], cent[k + 1], a / (a - b)))
    pole[MIRROR_AXIS] = c
    pole = tuple(pole)

    idxA = list(range(k, -1, -1))                  # stations k..0, walking out from the pole
    idxB = list(range(k + 1, n))                   # stations k+1..n-1, likewise
    A = [pole] + [cent[i] for i in idxA]
    B = [pole] + [cent[i] for i in idxB]

    def alen(p):
        return sum(length(sub(p[i], p[i - 1])) for i in range(1, len(p)))

    la, lb = alen(A), alen(B)
    r = min(la, lb) / max(la, lb) if max(la, lb) else 1.0
    if r >= EXTEND_RATIO:
        return None, 'rails already match (ratio %.2f)' % r
    if lb > la:
        good, bad, bad_idx = B, A, idxA
    else:
        good, bad, bad_idx = A, B, idxB
    goodm = [mirror(p, c) for p in good]
    tg, tb = arc_params(goodm), arc_params(bad)
    out = list(cent)
    for j, i in enumerate(bad_idx):
        out[i] = sample_at(goodm, tg, tb[j + 1])
    return out, 'short rail rebuilt from the long one (was %.2f of it, %.4f -> %.4f)' % (
        r, min(la, lb), max(la, lb))


def classify(cent):
    """Can this sweep take the mirror pass, or only the de-wobble?"""
    n = len(cent)
    vals = [across(p) for p in cent]
    span = max(vals) - min(vals)
    if span <= 1e-9:
        return 'skip', 'flat - the sweep never leaves the centreline plane', span
    mid = 0.5 * (max(vals) + min(vals))
    c = plane_of(cent)
    seam = length(sub(cent[0], cent[-1])) / span
    closed = seam < CLOSED_SEAM
    cross = [i for i in range(n) if (vals[i] - c) * (vals[(i + 1) % n] - c) < 0]
    if not closed:
        cx = [i for i in range(n - 1) if (vals[i] - c) * (vals[i + 1] - c) < 0]
        if len(cx) == 1 and EXTEND_ENABLED:
            return 'extend', 'open sweep, one crossing (seam %.2f of span)' % seam, span
        return 'smooth', 'open sweep, %d crossings (seam %.2f of span)' % (len(cx), seam), span
    if len(cross) != 2:
        return 'smooth', 'crosses the centreline %d times, not 2' % len(cross), span
    if abs(c - mid) > PLANE_TOL * span:
        return 'smooth', 'centreline plane %.1f%% of span off the midplane' % (100 * abs(c - mid) / span), span
    p, q = cross
    iA = [(p + 1 + k) % n for k in range((q - p) % n)]
    iB = [(q + 1 + k) % n for k in range((p - q) % n)]

    def plen(idx):
        pts = [cent[i] for i in idx]
        return sum(length(sub(pts[k], pts[k - 1])) for k in range(1, len(pts))) or 1e-9

    la, lb = plen(iA), plen(iB)
    r = min(la, lb) / max(la, lb)
    if r < HALF_RATIO:
        return 'smooth', 'halves differ in length (ratio %.2f)' % r, span
    return 'mirror', 'closed ring, halves match (ratio %.2f)' % r, span


def fix_mesh(verts, tris):
    """verts: list of (x,y,z) ; tris: list of (a,b,c). Returns (new_verts, info) or (None, why)."""
    comps, adj = components(len(verts), tris)
    owner = {}
    for ci, c in enumerate(comps):
        for v in c:
            owner[v] = ci
    by_comp = {}
    for t in tris:
        by_comp.setdefault(owner[t[0]], []).append(t)
    best = None
    for ci, c in enumerate(comps):
        if len(c) < 200:
            continue
        r = rings_of(c, adj, by_comp.get(ci, []))
        if r and len(r) > 40:
            best = (ci, c, r)
            break
    if not best:
        return None, 'no swept-tube component found'
    ci, comp, rings = best
    cent = []
    for r in rings:
        s = (0.0, 0.0, 0.0)
        for v in r:
            s = add(s, verts[v])
        cent.append(mul(s, 1.0 / len(r)))
    mode, why, span = classify(cent)
    if mode == 'skip':
        return None, why
    if mode == 'mirror':
        new, err = straighten_path(cent)
        if new is None:                        # classify already vetted it ; belt and braces
            mode, why, new = 'smooth', err, None
    if mode == 'extend':
        new, err = mirror_short_half(cent)
        if new is None:
            mode, why, new = 'smooth', err, None
        else:
            why = err
            closed0 = length(sub(cent[0], cent[-1])) < CLOSED_SEAM * span
            new = smooth_only(new, closed0)
    if mode == 'smooth':
        closed = length(sub(cent[0], cent[-1])) < CLOSED_SEAM * span
        new = smooth_only(cent, closed)
    out = list(verts)
    moves = []
    for i, r in enumerate(rings):
        d = sub(new[i], cent[i])
        moves.append(length(d))
        if moves[-1] < 1e-12:
            continue
        for v in r:
            out[v] = add(verts[v], d)
    info = {'rings': len(rings), 'ring_size': len(rings[0]), 'verts_moved': len(comp),
            'max_move': max(moves), 'mean_move': sum(moves) / len(moves),
            'plane': plane_of(cent), 'mode': mode, 'why': why}
    return out, info


# ---------------------------------------------------------------------------------------------
# GLB plumbing
# ---------------------------------------------------------------------------------------------
def read_glb(path):
    blob = open(path, 'rb').read()
    magic, ver, _ = struct.unpack('<III', blob[:12])
    if magic != 0x46546C67:
        raise RuntimeError('%s is not a GLB' % path)
    off, chunks = 12, []
    while off < len(blob):
        clen, ctype = struct.unpack('<II', blob[off:off + 8])
        chunks.append([ctype, bytearray(blob[off + 8:off + 8 + clen])])
        off += 8 + clen
    j = json.loads(bytes(chunks[0][1]).decode('utf-8'))
    return ver, j, chunks


def write_glb(path, ver, j, chunks):
    chunks[0][1] = bytearray(json.dumps(j, separators=(',', ':')).encode('utf-8'))
    body = b''
    for ctype, data in chunks:
        data = bytearray(data)
        pad = b' ' if ctype == JSON_CHUNK else b'\x00'
        while len(data) % 4:
            data += pad
        body += struct.pack('<II', len(data), ctype) + bytes(data)
    open(path, 'wb').write(struct.pack('<III', 0x46546C67, ver, 12 + len(body)) + body)


def acc_span(j, acc_idx, default_stride):
    a = j['accessors'][acc_idx]
    bv = j['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return base, (bv.get('byteStride') or default_stride), a['count']


def read_prim(j, binary, pr):
    pi = pr['attributes']['POSITION']
    base, stride, count = acc_span(j, pi, 12)
    verts = [struct.unpack_from('<3f', binary, base + i * stride) for i in range(count)]
    ia = j['accessors'][pr['indices']]
    ifmt = {5121: 'B', 5123: 'H', 5125: 'I'}[ia['componentType']]
    ibase, _, icount = acc_span(j, pr['indices'], 0)
    idx = struct.unpack_from('<' + ifmt * icount, binary, ibase)
    return verts, [idx[i:i + 3] for i in range(0, icount, 3)], (pi, base, stride)


def run(path, mesh_filter, write, log=print):
    ver, j, chunks = read_glb(path)
    binary = chunks[1][1]
    touched = []
    for m in j.get('meshes', []):
        name = m.get('name') or ''
        if mesh_filter.lower() not in name.lower():
            continue
        for pr in m['primitives']:
            pi = pr['attributes'].get('POSITION')
            if pi is None or j['accessors'][pi]['componentType'] != 5126:
                log('    %-38s skip (POSITION is not float32)' % name[:38])
                continue
            verts, tris, (pi, base, stride) = read_prim(j, binary, pr)
            out, info = fix_mesh(verts, tris)
            if out is None:
                log('    %-38s %s' % (name[:38], info))
                continue
            log('    %-38s %-6s %3d rings x %d  move mean %.5f max %.5f   %s'
                % (name[:38], info['mode'].upper(), info['rings'], info['ring_size'],
                   info['mean_move'], info['max_move'], info['why']))
            if write:
                for i, v in enumerate(out):
                    struct.pack_into('<3f', binary, base + i * stride, *v)
                j['accessors'][pi]['min'] = [min(v[k] for v in out) for k in range(3)]
                j['accessors'][pi]['max'] = [max(v[k] for v in out) for k in range(3)]
            touched.append(name)
    if write and touched:
        write_glb(path, ver, j, chunks)
    return touched


if __name__ == '__main__':
    argv = sys.argv[1:]

    def opt(n, d):
        return argv[argv.index(n) + 1] if n in argv else d

    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ships = opt('--ships', ','.join(SHIPS)).split(',')
    mesh_filter = opt('--mesh', 'Canopy')
    write = '--write' in argv
    EXTEND_ENABLED = '--extend' in argv
    for s in ships:
        p = os.path.join(repo, 'assets_src', 'ships', s + '.glb')
        if not os.path.exists(p):
            print('%-10s missing %s' % (s, p))
            continue
        print('%s:' % s)
        run(p, mesh_filter, write)
    print('WROTE' if write else 'DRY RUN (pass --write to apply)')
