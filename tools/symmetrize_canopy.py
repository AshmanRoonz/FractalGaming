# -*- coding: utf-8 -*-
"""Make the canopy read the same on both sides, without changing a single triangle.

WHY THIS EXISTS
  Owner, looking at the window from the seat: "i don't like how these parts are not symmetrical
  with each other." The shapes he boxed are not geometry at all - rays through them miss - they are
  the OPENING, and its outline is set by the canopy frame, the gasket and the hull's surround. All
  three are independently generated on Vortex and none of them mirrors:

      canopy frame     max mirror error 12.1 mm
      canopy gasket    max mirror error 12.1 mm
      aft canopy arch  max mirror error  8.1 mm
      windshield glass max mirror error  8.5 mm
      hull surround    median 1.4 mm, up to 10 mm at the window corners

  The eye sits ~80 mm from that rim, so single millimetres read plainly.

WHAT THIS DOES - SURFACE-AVERAGE SYMMETRISATION, the house technique from ship_symmetry.py.
  For each vertex v, reflect it across the ship's mirror plane, find the nearest point q on the
  part's own surface, reflect q back, and move v half way to it. Repeat. Both sides converge on
  their mean shape.

(!) TOPOLOGY IS NEVER TOUCHED. Only vertex positions move, so there are no new vertices, no
  re-indexing, no seams and no cracks - which is exactly why this is used instead of "delete one
  side and paste a mirrored copy". That approach leaves a crack wherever the mirrored patch meets
  hull that was not mirrored, and weld() will not close it because the two edges do not coincide.

(!) THE MIRROR PLANE IS NOT ZERO. Every left/right pair on Vortex sits about z = -0.0004 (the
  hull's own build skew). Reflecting about the origin bakes that 0.8 mm in as a permanent lean.

(!) THE HULL IS DONE BY REGION, WITH A FALLOFF. Symmetrising a whole 121k-vert hull would fight
  the deliberately one-sided greebles all over the ship. Only the canopy surround is corrected, and
  the correction ramps to zero at the region boundary so no crease appears where it stops.

(!) RUN THIS BEFORE cut_canopy_aperture.py. The cut uses a symmetric prism, so cutting symmetric
  geometry gives a symmetric opening. Cutting first and symmetrising after works too but has to
  mirror against holes.

USAGE
  python tools/symmetrize_canopy.py --ship vortex
  python tools/symmetrize_canopy.py --ship vortex --write
"""
import math
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))
from straighten_canopy_frame import read_glb, write_glb, read_prim  # noqa: E402
from cut_canopy_aperture import world_of, xf, FWD, UP, ACROSS       # noqa: E402

# Parts whose whole mesh is canopy and can be symmetrised entire.
WHOLE = ('CanopyFrame', 'CanopyGasket', 'CanopyArch', 'Windshield')
# Parts symmetrised only around the window, with a falloff (they continue far beyond it).
REGION = ('Hull_01', 'ConformalCabinShell')
PASSES = 4


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _safe(n, d, fb=0.0):
    # (!) these hulls contain degenerate (zero-area / duplicated-vertex) triangles, so every
    # barycentric division here can be 0/0. Guarding is not optional.
    return fb if abs(d) < 1e-20 else n / d


def closest_on_tri(p, a, b, c):
    """Standard closest-point-on-triangle (Ericson, Real-Time Collision Detection)."""
    ab, ac, ap = sub(b, a), sub(c, a), sub(p, a)
    d1, d2 = dot(ab, ap), dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        return a
    bp = sub(p, b)
    d3, d4 = dot(ab, bp), dot(ac, bp)
    if d3 >= 0 and d4 <= d3:
        return b
    vc = d1 * d4 - d3 * d2
    if vc <= 0 <= d1 and d3 <= 0:
        return add(a, mul(ab, _safe(d1, d1 - d3)))
    cp = sub(p, c)
    d5, d6 = dot(ab, cp), dot(ac, cp)
    if d6 >= 0 and d5 <= d6:
        return c
    vb = d5 * d2 - d1 * d6
    if vb <= 0 <= d2 and d6 <= 0:
        return add(a, mul(ac, _safe(d2, d2 - d6)))
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        return add(b, mul(sub(c, b), _safe(d4 - d3, (d4 - d3) + (d5 - d6))))
    tot = va + vb + vc
    if abs(tot) < 1e-20:
        return a
    den = 1.0 / tot
    return add(a, add(mul(ab, vb * den), mul(ac, vc * den)))


class Grid(object):
    """Uniform spatial hash over triangles - enough for meshes this size, and no numpy."""

    def __init__(self, verts, tris, cell):
        self.cell = cell
        self.tris = tris
        self.verts = verts
        self.g = {}
        for ti, (a, b, c) in enumerate(tris):
            pa, pb, pc = verts[a], verts[b], verts[c]
            lo = [min(pa[k], pb[k], pc[k]) for k in range(3)]
            hi = [max(pa[k], pb[k], pc[k]) for k in range(3)]
            for i in range(int(lo[0] // cell), int(hi[0] // cell) + 1):
                for j in range(int(lo[1] // cell), int(hi[1] // cell) + 1):
                    for k in range(int(lo[2] // cell), int(hi[2] // cell) + 1):
                        self.g.setdefault((i, j, k), []).append(ti)

    def nearest(self, p, maxd):
        best, bq = maxd * maxd, None
        c = self.cell
        r = int(maxd // c) + 1
        bi, bj, bk = int(p[0] // c), int(p[1] // c), int(p[2] // c)
        seen = set()
        for ring in range(r + 1):
            found = False
            for i in range(bi - ring, bi + ring + 1):
                for j in range(bj - ring, bj + ring + 1):
                    for k in range(bk - ring, bk + ring + 1):
                        if max(abs(i - bi), abs(j - bj), abs(k - bk)) != ring:
                            continue
                        for ti in self.g.get((i, j, k), ()):
                            if ti in seen:
                                continue
                            seen.add(ti)
                            a, b, cc = self.tris[ti]
                            q = closest_on_tri(p, self.verts[a], self.verts[b], self.verts[cc])
                            d = dot(sub(q, p), sub(q, p))
                            if d < best:
                                best, bq, found = d, q, True
            if bq is not None and ring > 0 and not found:
                break
        return bq, (math.sqrt(best) if bq is not None else None)


def ramp(t, lo, hi, f):
    if t < lo - f or t > hi + f:
        return 0.0
    if t < lo:
        return (t - (lo - f)) / f
    if t > hi:
        return ((hi + f) - t) / f
    return 1.0


def run(path, write, log=print):
    ver, j, chunks = read_glb(path)
    binary = bytes(chunks[1][1])

    gmi = next(i for i, m in enumerate(j['meshes']) if 'Windshield' in (m.get('name') or ''))
    gverts, _, _ = read_prim(j, binary, j['meshes'][gmi]['primitives'][0])
    GW = world_of(j, gmi)
    gverts = [xf(GW, v) for v in gverts]
    GX = (min(v[FWD] for v in gverts), max(v[FWD] for v in gverts))
    GZ = max(abs(v[ACROSS]) for v in gverts)
    GY = (min(v[UP] for v in gverts), max(v[UP] for v in gverts))
    # the plane the parts were actually built about, not the origin
    PLANE = 0.5 * (min(v[ACROSS] for v in gverts) + max(v[ACROSS] for v in gverts))
    log('  window x %.3f..%.3f  up %.3f..%.3f  half-width %.4f   mirror plane %+.5f'
        % (GX[0], GX[1], GY[0], GY[1], GZ, PLANE))

    CX = (GX[0] - 0.05, GX[1] + 0.045)
    CZ = (GY[0] - 0.015, GY[1] + 0.04)
    CY = GZ + 0.10
    FX, FZ, FY = 0.045, 0.035, 0.045

    def region_w(v):
        return min(ramp(v[FWD], CX[0], CX[1], FX), ramp(v[UP], CZ[0], CZ[1], FZ),
                   1.0 if abs(v[ACROSS]) <= CY else max(0.0, ((CY + FY) - abs(v[ACROSS])) / FY))

    def mirror(p):
        return (p[FWD], p[UP], 2.0 * PLANE - p[ACROSS]) if ACROSS == 2 else p

    touched = 0
    for mi, m in enumerate(j['meshes']):
        nm = m.get('name') or ''
        whole = any(t in nm for t in WHOLE)
        region = any(t in nm for t in REGION)
        if not (whole or region):
            continue
        prim = m['primitives'][0]
        pi = prim['attributes']['POSITION']
        if j['accessors'][pi]['componentType'] != 5126:
            continue
        raw, tris, _ = read_prim(j, binary, prim)
        W = world_of(j, mi)
        verts = [xf(W, v) for v in raw]
        wts = [1.0 if whole else region_w(v) for v in verts]
        live = [i for i, w in enumerate(wts) if w > 0.0]
        if not live:
            continue
        span = max(max(v[k] for v in verts) - min(v[k] for v in verts) for k in range(3))
        cell = max(span / 48.0, 0.004)
        before = None
        for it in range(PASSES):
            grid = Grid(verts, tris, cell)
            tot = 0.0
            worst = 0.0
            for i in live:
                v = verts[i]
                q, d = grid.nearest(mirror(v), 0.06)
                if q is None:
                    continue
                if before is None:
                    worst = max(worst, d)
                back = mirror(q)
                tgt = mul(add(v, back), 0.5)
                w = wts[i]
                nv = (v[0] + (tgt[0] - v[0]) * w, v[1] + (tgt[1] - v[1]) * w, v[2] + (tgt[2] - v[2]) * w)
                tot += math.sqrt(dot(sub(nv, v), sub(nv, v)))
                verts[i] = nv
            if before is None:
                before = worst
        # residual
        grid = Grid(verts, tris, cell)
        res = 0.0
        for i in live:
            if wts[i] < 0.9:
                continue
            q, d = grid.nearest(mirror(verts[i]), 0.06)
            if d is not None:
                res = max(res, d)
        log('    %-36s %5d verts (%d moved)  worst mirror error %.5f -> %.5f'
            % (nm[:36], len(verts), len(live), before or 0.0, res))
        touched += 1
        if write:
            # back to the node's local space, then into the POSITION buffer in place
            inv_s = 1.0
            t = (W[12], W[13], W[14])
            sx = math.sqrt(W[0] ** 2 + W[1] ** 2 + W[2] ** 2) or 1.0
            base, stride, count = _span(j, pi)
            b = bytearray(chunks[1][1])
            out = []
            for v in verts:
                out.append(((v[0] - t[0]) / sx, (v[1] - t[1]) / sx, (v[2] - t[2]) / sx))
            for i, v in enumerate(out):
                struct.pack_into('<3f', b, base + i * stride, *v)
            chunks[1][1] = b
            j['accessors'][pi]['min'] = [min(v[k] for v in out) for k in range(3)]
            j['accessors'][pi]['max'] = [max(v[k] for v in out) for k in range(3)]
            binary = bytes(b)
    if write and touched:
        write_glb(path, ver, j, chunks)
        log('  WROTE %s  (%d meshes symmetrised)' % (path, touched))
    return touched


def _span(j, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return base, (bv.get('byteStride') or 12), a['count']


if __name__ == '__main__':
    argv = sys.argv[1:]

    def opt(n, d):
        return argv[argv.index(n) + 1] if n in argv else d

    ship = opt('--ship', 'vortex')
    write = '--write' in argv
    print('%s:' % ship)
    run(os.path.join(REPO, 'assets_src', 'ships', ship + '.glb'), write)
    print('WROTE' if write else 'DRY RUN (pass --write to apply)')
