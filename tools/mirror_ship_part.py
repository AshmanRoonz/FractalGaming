# -*- coding: utf-8 -*-
"""Replace one ship part with the mirror image of its opposite number, in the GLB.

WHY THIS EXISTS
  The AI-authored hulls ship left/right pairs that were generated independently, so a pair can
  disagree badly enough to see. On Vortex the canopy's purple interface trim is such a pair:

      Vortex_v04_L_FrameInterfaceTrim   671 verts / 1200 tris
      Vortex_v04_R_FrameInterfaceTrim   539 verts /  960 tris     <- 132 verts / 240 tris short

  The shortfall is all at the FORWARD end (per 10 mm bin the counts run 60/56/57/57 against
  25/32/32/21), and there the R strip sits up to 9.8 mm out of line with its twin. Those two
  strips are the only purple geometry that touches the windshield - 1.0-2.5 mm off the glass rim -
  so the mismatch reads from outside as a corner of purple in the window frame that does not line
  up. Owner: "he's got some purple parts that need to be cut to line up... delete it by color."

(!) THE NAMES ARE INVERTED. With the canonical axes (forward -X, up +Y, right -Z) the mesh named
  _L_ sits at z = -0.0755, which is the PILOT'S RIGHT, and _R_ is on the pilot's left. The same
  inversion holds for v02_L/R_SeatContourRail, v04_L/R_InnerSillLiner_Mesh, v01_L/R_Harness and
  v01_L/R_TaperedSidewall_Mesh. Pick the part by measuring z, never by trusting the name.

(!) MIRRORING FLIPS HANDEDNESS. Positions and normals both reflect, and the triangle winding must
  be reversed or every face ends up backwards and the part renders inside-out.

(!) EDIT assets_src/, NOT LSS/. LSS/ships and LSS/ships/m are build outputs; rebuild them with
  `node tools/compress_glb.mjs --only ships` and then bump _MODELS_VERSION in index-working.html,
  or the browser keeps serving the cached asset. See tools/straighten_canopy_frame.py.

USAGE
  python tools/mirror_ship_part.py --ship vortex --src Vortex_v04_L_FrameInterfaceTrim \
                                   --dst Vortex_v04_R_FrameInterfaceTrim [--write]
  python tools/mirror_ship_part.py --ship vortex --pair FrameInterfaceTrim [--write]
      (--pair picks the _L_/_R_ meshes whose names contain the string and copies the one with
       MORE geometry onto the one with less)
"""
import json
import math
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))
from straighten_canopy_frame import read_glb, write_glb, MIRROR_AXIS  # noqa: E402

IFMT = {5121: 'B', 5123: 'H', 5125: 'I'}
ISZ = {'B': 1, 'H': 2, 'I': 4}


def find_mesh(j, name):
    hits = [(i, m) for i, m in enumerate(j['meshes']) if (m.get('name') or '') == name]
    if not hits:
        hits = [(i, m) for i, m in enumerate(j['meshes']) if name in (m.get('name') or '')]
    if len(hits) != 1:
        raise SystemExit('%r matches %d meshes: %s'
                         % (name, len(hits), [m.get('name') for _, m in hits]))
    return hits[0]


def acc_bytes(j, binary, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return a, bv, base


def read_vec(j, binary, ai, n):
    a, bv, base = acc_bytes(j, binary, ai)
    stride = bv.get('byteStride') or (4 * n)
    return [struct.unpack_from('<' + 'f' * n, binary, base + i * stride) for i in range(a['count'])]


def read_idx(j, binary, ai):
    a, bv, base = acc_bytes(j, binary, ai)
    f = IFMT[a['componentType']]
    return list(struct.unpack_from('<' + f * a['count'], binary, base)), a['componentType']


def append_view(j, binary, blob, target=None):
    while len(binary) % 4:
        binary += b'\x00'
    off = len(binary)
    binary += blob
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(blob)}
                            if target is None else
                            {'buffer': 0, 'byteOffset': off, 'byteLength': len(blob), 'target': target})
    return len(j['bufferViews']) - 1, binary


def mirror_part(path, src_name, dst_name, write, log=print, plane=None):
    ver, j, chunks = read_glb(path)
    binary = bytes(chunks[1][1])
    smi, smesh = find_mesh(j, src_name)
    dmi, dmesh = find_mesh(j, dst_name)
    sp = smesh['primitives'][0]
    dp = dmesh['primitives'][0]

    pos = read_vec(j, binary, sp['attributes']['POSITION'], 3)
    nrm = read_vec(j, binary, sp['attributes']['NORMAL'], 3) if 'NORMAL' in sp['attributes'] else None
    uv = read_vec(j, binary, sp['attributes']['TEXCOORD_0'], 2) if 'TEXCOORD_0' in sp['attributes'] else None
    idx, icomp = read_idx(j, binary, sp['indices'])

    dpos = read_vec(j, binary, dp['attributes']['POSITION'], 3)
    zs = [p[MIRROR_AXIS] for p in pos]
    zd = [p[MIRROR_AXIS] for p in dpos]
    log('  src %-34s %5d verts  %5d tris  across %+.4f..%+.4f'
        % (src_name[:34], len(pos), len(idx) // 3, min(zs), max(zs)))
    log('  dst %-34s %5d verts  %5d tris  across %+.4f..%+.4f'
        % (dst_name[:34], len(dpos), len(read_idx(j, binary, dp['indices'])[0]) // 3, min(zd), max(zd)))
    if (min(zs) + max(zs)) * (min(zd) + max(zd)) > 0:
        raise SystemExit('both parts sit on the SAME side of the centreline - wrong pair')

    # (!) THE SHIP IS NOT BUILT ABOUT ZERO. Every L/R pair on Vortex sits about a plane ~0.0008 off
    # the origin (the hull's own measured skew), so reflecting about 0 lands the copy 1.6 mm out and
    # the pair still reads wrong. Default: solve for the plane that maps the source's bounding box
    # onto the destination's, which is the plane the artist actually worked to.
    if plane is None:
        plane = ((min(zs) + max(zd)) + (max(zs) + min(zd))) / 4.0
        log('  mirror plane solved from the pair: %+.5f  (z=0 would miss by %.4f)'
            % (plane, abs(plane) * 2))
    c0 = plane

    def mir(v):
        return tuple(2.0 * c0 - q if k == MIRROR_AXIS else q for k, q in enumerate(v))

    def mirn(v):
        return tuple(-q if k == MIRROR_AXIS else q for k, q in enumerate(v))

    mpos = [mir(p) for p in pos]
    mnrm = [mirn(n) for n in nrm] if nrm else None
    # reflection reverses handedness, so the winding has to flip or every face points inward
    midx = []
    for t in range(0, len(idx), 3):
        midx += [idx[t], idx[t + 2], idx[t + 1]]

    err = max(abs(min(p[MIRROR_AXIS] for p in mpos) - min(zd)),
              abs(max(p[MIRROR_AXIS] for p in mpos) - max(zd)))
    log('  mirrored src lands across %+.4f..%+.4f  (dst was %+.4f..%+.4f, edge delta %.4f)'
        % (min(p[MIRROR_AXIS] for p in mpos), max(p[MIRROR_AXIS] for p in mpos),
           min(zd), max(zd), err))

    if not write:
        return False

    ba = bytearray(binary)
    binary = bytes(ba)
    bvp, binary = append_view(j, binary, b''.join(struct.pack('<3f', *p) for p in mpos), 34962)
    j['accessors'].append({'bufferView': bvp, 'componentType': 5126, 'count': len(mpos),
                           'type': 'VEC3',
                           'min': [min(p[k] for p in mpos) for k in range(3)],
                           'max': [max(p[k] for p in mpos) for k in range(3)]})
    dp['attributes']['POSITION'] = len(j['accessors']) - 1
    if mnrm:
        bvn, binary = append_view(j, binary, b''.join(struct.pack('<3f', *n) for n in mnrm), 34962)
        j['accessors'].append({'bufferView': bvn, 'componentType': 5126, 'count': len(mnrm),
                               'type': 'VEC3'})
        dp['attributes']['NORMAL'] = len(j['accessors']) - 1
    elif 'NORMAL' in dp['attributes']:
        del dp['attributes']['NORMAL']
    if uv:
        bvt, binary = append_view(j, binary, b''.join(struct.pack('<2f', *t) for t in uv), 34962)
        j['accessors'].append({'bufferView': bvt, 'componentType': 5126, 'count': len(uv),
                               'type': 'VEC2'})
        dp['attributes']['TEXCOORD_0'] = len(j['accessors']) - 1
    elif 'TEXCOORD_0' in dp['attributes']:
        del dp['attributes']['TEXCOORD_0']
    f = IFMT[icomp]
    bvi, binary = append_view(j, binary, struct.pack('<' + f * len(midx), *midx), 34963)
    j['accessors'].append({'bufferView': bvi, 'componentType': icomp, 'count': len(midx),
                           'type': 'SCALAR'})
    dp['indices'] = len(j['accessors']) - 1

    j['buffers'][0]['byteLength'] = len(binary)
    chunks[1][1] = bytearray(binary)
    write_glb(path, ver, j, chunks)
    log('  WROTE %s  dst is now %d verts / %d tris' % (path, len(mpos), len(midx) // 3))
    return True


if __name__ == '__main__':
    argv = sys.argv[1:]

    def opt(n, d=None):
        return argv[argv.index(n) + 1] if n in argv else d

    ship = opt('--ship', 'vortex')
    write = '--write' in argv
    pl = opt('--plane')
    pl = None if pl in (None, 'auto') else float(pl)
    path = os.path.join(REPO, 'assets_src', 'ships', ship + '.glb')
    pair = opt('--pair')
    src, dst = opt('--src'), opt('--dst')
    if pair:
        ver, j, chunks = read_glb(path)
        binary = bytes(chunks[1][1])
        cands = [(i, m) for i, m in enumerate(j['meshes']) if pair in (m.get('name') or '')]
        if len(cands) != 2:
            raise SystemExit('--pair %r matched %d meshes: %s'
                             % (pair, len(cands), [m.get('name') for _, m in cands]))
        counts = []
        for i, m in cands:
            a = j['accessors'][m['primitives'][0]['attributes']['POSITION']]
            counts.append((a['count'], m.get('name')))
        counts.sort(reverse=True)
        src, dst = counts[0][1], counts[1][1]
        print('%s: --pair %s -> copying the larger part onto the smaller (%d -> %d verts)'
              % (ship, pair, counts[0][0], counts[1][0]))
    if not src or not dst:
        print(__doc__)
        raise SystemExit(2)
    print('%s:' % ship)
    mirror_part(path, src, dst, write, plane=pl)
    print('WROTE' if write else 'DRY RUN (pass --write to apply)')
