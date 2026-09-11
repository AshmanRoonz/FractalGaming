# -*- coding: utf-8 -*-
"""Raise a hull's `cockpit1` eye marker, in the GLB itself.

WHY THIS EXISTS
  The game reads the pilot's eye straight off the asset - `player.mesh.getObjectByName('cockpit1')`
  then `getWorldPosition()` - so the seat height IS GLB data and belongs in the GLB, not in a
  game-side offset table.

THE ONE THING TO GET RIGHT: UNITS.
  The marker's translation is in MODEL units. The game fits each hull by scaling its longest axis to
  the chassis' `hullLength`, so a model-space delta `d` arrives in the cockpit as `d * baseScale`
  game units. Pass the nudge in GAME units (a corvette is ~100 long) and this converts.
  Model axes are canonical: forward -X, up +Y, right -Z. "Raise" is therefore +Y.
  `cockpit1` is a childless Empty at the scene root with a translation and nothing else, and it
  carries no geometry - so moving it cannot shift the hull's bounding box, and the load-time
  recentre is unaffected.

⚠ THE PIPELINE OWNS THIS MARKER. tools/blender/ship_cockpit.py derives the eye from "the most open
  forward view" and writes `markers['cockpit1'].location = eye_world` on every export, so re-running
  that stage will discard an edit made here. If a nudge is meant to be permanent it has to go into
  that stage too. This script exists for dialling a hull in against the real game, which is the only
  place the seat can actually be judged.

⚠⚠ IT MUST WRITE assets_src/ TOO, NOT JUST LSS/. LSS/ships and LSS/ships/m are BUILD OUTPUTS -
  `node tools/compress_glb.mjs --only ships` regenerates both from assets_src/ships, so a marker
  written only into LSS/ is silently discarded the next time anything rebuilds the fleet. That is
  exactly what happened to the v42.47 seat raises when the canopy frames were straightened: they
  reverted to 0.09 with no error and no sign. All three copies are written here.

USAGE
  python tools/raise_cockpit_marker.py blaster 3 slayer 5
  (pairs of <ship> <up-in-game-units>; edits assets_src/ships/, LSS/ships/ and LSS/ships/m/)
"""
import struct, json, sys, os

# baseScale per hull = chassis hullLength / the model's longest axis, measured from the shipped GLBs.
BASE_SCALE = {
    'blaster': 120.01, 'pyro': 119.95, 'vortex': 93.85, 'syphon': 89.26,
    'tracker': 81.63, 'slayer': 71.86, 'puncture': 71.81,
}
JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942


def read_glb(path):
    with open(path, 'rb') as fh:
        blob = fh.read()
    magic, ver, total = struct.unpack('<III', blob[:12])
    if magic != 0x46546C67:
        raise RuntimeError('%s is not a GLB' % path)
    off, chunks = 12, []
    while off < len(blob):
        clen, ctype = struct.unpack('<II', blob[off:off + 8])
        chunks.append((ctype, blob[off + 8:off + 8 + clen]))
        off += 8 + clen
    return ver, chunks


def write_glb(path, ver, chunks):
    body = b''
    for ctype, data in chunks:
        pad = b' ' if ctype == JSON_CHUNK else b'\x00'
        while len(data) % 4:
            data += pad
        body += struct.pack('<II', len(data), ctype) + data
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, ver, 12 + len(body)) + body)


def raise_marker(path, up_game, scale):
    ver, chunks = read_glb(path)
    out, moved = [], None
    for ctype, data in chunks:
        if ctype != JSON_CHUNK:
            out.append((ctype, data))          # BIN preserved byte for byte
            continue
        j = json.loads(data.decode('utf-8'))
        for n in j.get('nodes', []):
            if (n.get('name') or '') != 'cockpit1':
                continue
            t = n.get('translation') or [0.0, 0.0, 0.0]
            before = t[1]
            t[1] = before + (up_game / scale)   # +Y is up in model space
            n['translation'] = t
            moved = (before, t[1])
        out.append((ctype, json.dumps(j, separators=(',', ':')).encode('utf-8')))
    if not moved:
        raise RuntimeError('%s has no cockpit1 node' % path)
    write_glb(path, ver, out)
    return moved


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or len(args) % 2:
        print(__doc__)
        raise SystemExit(2)
    for i in range(0, len(args), 2):
        ship, up = args[i].lower(), float(args[i + 1])
        scale = BASE_SCALE.get(ship)
        if not scale:
            raise SystemExit('unknown ship %s' % ship)
        for p in ('assets_src/ships/%s.glb' % ship, 'LSS/ships/%s.glb' % ship,
                  'LSS/ships/m/%s.glb' % ship):
            if not os.path.exists(p):
                print('  skip (missing) %s' % p)
                continue
            b, a = raise_marker(p, up, scale)
            print('%-26s cockpit1.y %.5f -> %.5f   (+%.1f game units @ scale %.2f)'
                  % (p, b, a, up, scale))
