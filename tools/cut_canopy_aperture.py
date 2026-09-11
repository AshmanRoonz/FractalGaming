# -*- coding: utf-8 -*-
"""Cut the OLD window out of the hull, where the canopy cut missed it.

WHY THIS EXISTS
  Owner, pointing at Vortex's canopy: "he's got some purple parts that need to be cut to line up,
  it was part of the windshield that got missed... the purple shit is the old window."

  He is exactly right, and it is visible in one measurement. Cast rays straight down through the
  windshield's own footprint and ask what they meet FIRST:

      Vortex_Hull_01_Glazed  ... 40 of 196 rays        <- the hull is ON TOP of the window
      Vortex_Windshield_Glass ... 43
      canopy frame / gasket  ... the rim

  So roughly a fifth of the window area is still capped by outer hull. That hull surface carries
  the ship's painted canopy - the OLD window, drawn into vortex_base before a real one was cut in -
  and its paint is purple, which is why the leftover reads as purple slivers along the window edge
  and not as "hull". Render the hull on its own and there is no opening there at all.

WHAT THIS DOES
  Deletes the hull triangles that sit above the windshield: project each hull face centroid onto
  the glass in the ship's ground plane, and if it lands inside the glass and sits above it, the
  face is capping the window and goes. Only the INDEX buffer is rewritten - positions, normals,
  UVs and every other mesh are untouched, and the orphaned vertices are swept up by weld/prune in
  compress_glb.

(!) It deletes, so run it without --write first and read the face count and the render.

(!) EDIT assets_src/, NOT LSS/. Then `node tools/compress_glb.mjs --only <ship>` and bump
  _MODELS_VERSION in index-working.html, or the browser serves the cached asset.

USAGE
  python tools/cut_canopy_aperture.py --ship vortex
  python tools/cut_canopy_aperture.py --ship vortex --write
  python tools/cut_canopy_aperture.py --ship vortex --triangle           # the right-angle-triangle opening
  python tools/cut_canopy_aperture.py --ship vortex --triangle --write
"""
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))
from straighten_canopy_frame import read_glb, write_glb, read_prim  # noqa: E402

# glTF axes: forward -X, up +Y, right -Z. The window is a roughly horizontal sheet, so "is this
# hull face over the glass" is a 2D test in the (X, Z) ground plane plus a height comparison.
FWD, UP, ACROSS = 0, 1, 2
IFMT = {5121: 'B', 5123: 'H', 5125: 'I'}
# Parts on the cabin side of the hull that stand proud of the new sill once the hull is opened.
CABIN_SIDE = ('ConformalCabinShell', 'InnerSillLiner', 'FrameInterfaceTrim')


def _mul(a, b):
    return [sum(a[i + 4 * k] * b[k + 4 * jj] for k in range(4)) for jj in range(4) for i in range(4)]


def _trs(n):
    if n.get('matrix'):
        return list(n['matrix'])
    t = n.get('translation') or [0, 0, 0]
    r = n.get('rotation') or [0, 0, 0, 1]
    sc = n.get('scale') or [1, 1, 1]
    x, y, z, w = r
    m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
         0, 0, 0, 1]
    for c in range(3):
        for rr in range(3):
            m[c * 4 + rr] *= sc[c]
    m[12], m[13], m[14] = t
    return m


def world_of(j, mesh_index):
    """World matrix of the node carrying this mesh.

    (!) NOT OPTIONAL. Each canopy part sits on its own node with its own translation, so raw
    accessor coordinates from two different meshes are in two different spaces. Comparing them
    directly put the windshield near the origin and matched 700-1100 hull faces on every hull,
    including the two that are fine."""
    stack = [(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
             for i in j['scenes'][j.get('scene', 0)]['nodes']]
    while stack:
        ni, par = stack.pop()
        n = j['nodes'][ni]
        m = _mul(par, _trs(n))
        if n.get('mesh') == mesh_index:
            return m
        for c in n.get('children', []):
            stack.append((c, m))
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def xf(m, p):
    return (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14])


def mesh_by(j, frag):
    for mi, m in enumerate(j['meshes']):
        if frag in (m.get('name') or ''):
            return mi, m
    raise SystemExit('no mesh matching %r' % frag)


def tri_area2(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def build_grid(tris, cell):
    grid = {}
    for ti, (p, q, r) in enumerate(tris):
        xs = (p[0], q[0], r[0])
        zs = (p[1], q[1], r[1])
        for gx in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
            for gz in range(int(min(zs) // cell), int(max(zs) // cell) + 1):
                grid.setdefault((gx, gz), []).append(ti)
    return grid


def height_at(tris, grid, cell, x, z):
    """Highest glass surface directly under/over (x, z), or None if outside the glass."""
    best = None
    for ti in grid.get((int(x // cell), int(z // cell)), ()):
        p, q, r = tris[ti]
        d = tri_area2(p, q, r)
        if abs(d) < 1e-12:
            continue
        w0 = tri_area2((x, z), q, r) / d
        w1 = tri_area2(p, (x, z), r) / d
        w2 = 1.0 - w0 - w1
        if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
            continue
        y = w0 * p[2] + w1 * q[2] + w2 * r[2]
        if best is None or y > best:
            best = y
    return best


def cut_triangle(path, margin, write, log=print, widen=0.0):
    """Open the canopy aperture out to a RIGHT-ANGLE TRIANGLE in side profile.

    Owner: "from the back of the frame at the top, it should go straight down, but it doesn't...
    we need it to be more triangular", and on the drawn proposal: "yes".

    The window keeps its raked top, gains a VERTICAL aft edge, and its sill runs dead level at the
    height the windscreen already meets the hull at the nose. Everything between that level sill and
    the old ragged lower rim is hull, and it is the hull you can see purple paint on - measured from
    above, hull was 704 of the ~1100 ray hits inside the "window". This deletes it.

    The footprint is taken FROM THE GLASS, per 10 mm station, so the nose taper is respected and the
    cut never reaches the fairings outboard of the canopy.
    """
    ver, j, chunks = read_glb(path)
    binary = bytes(chunks[1][1])
    hmi, hmesh = mesh_by(j, 'Hull_01')
    gmi, gmesh = mesh_by(j, 'Windshield')
    hp, gp = hmesh['primitives'][0], gmesh['primitives'][0]

    gverts, _, _ = read_prim(j, binary, gp)
    GW = world_of(j, gmi)
    gverts = [xf(GW, v) for v in gverts]
    BIN = 0.01
    half = {}
    for v in gverts:
        k = int(round(v[FWD] / BIN))
        half[k] = max(half.get(k, 0.0), abs(v[ACROSS]))
    ks = sorted(half)
    X0, X1 = ks[0] * BIN, ks[-1] * BIN
    SILL = min(v[UP] for v in gverts)

    def halfw(x):
        k = x / BIN
        lo, hi = int(k // 1), int(k // 1) + 1
        a, b = half.get(lo), half.get(hi)
        if a is None and b is None:
            return 0.0
        if a is None:
            return b
        if b is None:
            return a
        return a + (b - a) * (k - lo)

    def inside(tri, verts):
        a, b, c = tri
        x = (verts[a][FWD] + verts[b][FWD] + verts[c][FWD]) / 3.0
        z = (verts[a][ACROSS] + verts[b][ACROSS] + verts[c][ACROSS]) / 3.0
        y = (verts[a][UP] + verts[b][UP] + verts[c][UP]) / 3.0
        return (X0 - 0.005 <= x <= X1 + margin) and y >= SILL and abs(z) <= halfw(x) + margin + widen

    log('  window x %.3f..%.3f  sill %.4f  half-width %.4f..%.4f  margin %.4f  widen %.4f'
        % (X0, X1, SILL, min(half.values()), max(half.values()), margin, widen))

    # (!) THE CABIN SIDE HAS TO GO TOO. Owner, after the first cut: "the cut out needs to include
    # the geometry inside the cabin that was next to it, because it protrudes up in the same spot."
    # Opening the hull exposes the lining that used to hide behind it - the sill liners and the
    # cabin shell stand proud of the new sill by up to 50 mm - so the same prism is applied to them.
    # NOT to the seat, harness, HUD or consoles: the pilot's eye is 40 mm ABOVE this sill, so a
    # blanket "everything above the sill" cut would take the headrest with it.
    jobs = [(hmi, hp, 'hull')]
    for mi, m in enumerate(j['meshes']):
        nm = m.get('name') or ''
        if mi == hmi or not any(t in nm for t in CABIN_SIDE):
            continue
        jobs.append((mi, m['primitives'][0], nm))

    total = 0
    binary = bytes(chunks[1][1])
    for mi, prim, nm in jobs:
        verts, tris, _ = read_prim(j, binary, prim)
        W = world_of(j, mi)
        verts = [xf(W, v) for v in verts]
        doomed = set(ti for ti, t in enumerate(tris) if inside(t, verts))
        if not doomed:
            continue
        total += len(doomed)
        log('    %-36s %6d -> %6d tris  (cut %d)'
            % (nm[:36], len(tris), len(tris) - len(doomed), len(doomed)))
        if write:
            _rewrite_indices(j, chunks, binary, prim, tris, doomed)
            binary = bytes(chunks[1][1])
    if write and total:
        j['buffers'][0]['byteLength'] = len(chunks[1][1])
        write_glb(path, ver, j, chunks)
        log('  WROTE %s  (%d tris removed in total)' % (path, total))
    return total


def _rewrite_indices(j, chunks, binary, prim, htris, doomed):
    keep = [t for ti, t in enumerate(htris) if ti not in doomed]
    flat = [i for t in keep for i in t]
    ia = j['accessors'][prim['indices']]
    f = IFMT[ia['componentType']]
    blob = struct.pack('<' + f * len(flat), *flat)
    b = bytearray(binary)
    while len(b) % 4:
        b += bytes(1)
    off = len(b)
    b += blob
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(blob), 'target': 34963})
    j['accessors'].append({'bufferView': len(j['bufferViews']) - 1,
                           'componentType': ia['componentType'], 'count': len(flat), 'type': 'SCALAR'})
    prim['indices'] = len(j['accessors']) - 1
    j['buffers'][0]['byteLength'] = len(b)
    chunks[1][1] = b


def cut(path, margin, write, log=print):
    ver, j, chunks = read_glb(path)
    binary = bytes(chunks[1][1])
    hmi, hmesh = mesh_by(j, 'Hull_01')
    gmi, gmesh = mesh_by(j, 'Windshield')
    hp, gp = hmesh['primitives'][0], gmesh['primitives'][0]

    gverts, gtris_i, _ = read_prim(j, binary, gp)
    GW = world_of(j, gmi)
    gverts = [xf(GW, v) for v in gverts]
    gtris = [((gverts[a][FWD], gverts[a][ACROSS], gverts[a][UP]),
              (gverts[b][FWD], gverts[b][ACROSS], gverts[b][UP]),
              (gverts[c][FWD], gverts[c][ACROSS], gverts[c][UP])) for a, b, c in gtris_i]
    cell = 0.01
    grid = build_grid(gtris, cell)

    hverts, htris, _ = read_prim(j, binary, hp)
    HW = world_of(j, hmi)
    hverts = [xf(HW, v) for v in hverts]
    doomed = set()
    for ti, (a, b, c) in enumerate(htris):
        x = (hverts[a][FWD] + hverts[b][FWD] + hverts[c][FWD]) / 3.0
        z = (hverts[a][ACROSS] + hverts[b][ACROSS] + hverts[c][ACROSS]) / 3.0
        y = (hverts[a][UP] + hverts[b][UP] + hverts[c][UP]) / 3.0
        gy = height_at(gtris, grid, cell, x, z)
        if gy is not None and y > gy - margin:
            doomed.add(ti)
    log('  hull %d tris ; over the windshield and above it: %d (%.2f%%)   margin %.4f'
        % (len(htris), len(doomed), 100.0 * len(doomed) / len(htris), margin))
    if doomed:
        xs = [(hverts[htris[t][0]][FWD]) for t in doomed]
        zs = [(hverts[htris[t][0]][ACROSS]) for t in doomed]
        log('  patch spans forward %.3f..%.3f  across %.3f..%.3f   (+ %d / - %d)'
            % (min(xs), max(xs), min(zs), max(zs),
               sum(1 for t in doomed if hverts[htris[t][0]][ACROSS] > 0),
               sum(1 for t in doomed if hverts[htris[t][0]][ACROSS] < 0)))
    if not write or not doomed:
        return len(doomed)

    keep = [t for ti, t in enumerate(htris) if ti not in doomed]
    flat = [i for t in keep for i in t]
    ia = j['accessors'][hp['indices']]
    f = IFMT[ia['componentType']]
    blob = struct.pack('<' + f * len(flat), *flat)
    b = bytearray(binary)
    while len(b) % 4:
        b += b'\x00'
    off = len(b)
    b += blob
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(blob), 'target': 34963})
    j['accessors'].append({'bufferView': len(j['bufferViews']) - 1,
                           'componentType': ia['componentType'], 'count': len(flat), 'type': 'SCALAR'})
    hp['indices'] = len(j['accessors']) - 1
    j['buffers'][0]['byteLength'] = len(b)
    chunks[1][1] = b
    write_glb(path, ver, j, chunks)
    log('  WROTE %s  hull now %d tris' % (path, len(keep)))
    return len(doomed)


if __name__ == '__main__':
    argv = sys.argv[1:]

    def opt(n, d):
        return argv[argv.index(n) + 1] if n in argv else d

    ship = opt('--ship', 'vortex')
    margin = float(opt('--margin', '0.004'))
    write = '--write' in argv
    p = os.path.join(REPO, 'assets_src', 'ships', ship + '.glb')
    print('%s:' % ship)
    if '--triangle' in argv:
        cut_triangle(p, margin, write, widen=float(opt('--widen', '0.0')))
    else:
        cut(p, margin, write)
    print('WROTE' if write else 'DRY RUN (pass --write to apply)')
