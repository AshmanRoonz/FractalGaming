#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Move a marker empty (thrusterN, gunN, cockpitN, ...) inside a .glb without Blender.

    python tools/glb_set_marker.py LSS/ships/slayer.glb thruster1 thruster2 --x 0.88
    python tools/glb_set_marker.py LSS/ships/slayer.glb --list

Coordinates are the GLB's own (glTF, Y-up) node translation - what tools/glb_editor.html shows. The
concept-ship pipeline's backups/concept_ships/canopy/markers.json is Blender Z-up: [x, -z, y] of these.
Same contract as glb_set_material.py: only the JSON chunk is rewritten (re-padded with spaces), the
BIN chunk is copied verbatim, so the edit is exact and reversible. Remember _MODELS_VERSION in
index-working.html is the cache-bust for GLB urls - bump it or the game keeps the old file.
"""
import argparse, json, struct, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('markers', nargs='*', help='exact node names to move (see --list)')
    ap.add_argument('--x', type=float)
    ap.add_argument('--y', type=float)
    ap.add_argument('--z', type=float)
    ap.add_argument('--list', action='store_true', help='list marker-like nodes, change nothing')
    ap.add_argument('--add', action='store_true',
                    help='create a marker that does not exist yet (a scene-root empty, like the others); needs --x --y --z')
    a = ap.parse_args()

    b = open(a.glb, 'rb').read()
    magic, ver, total = struct.unpack('<III', b[:12])
    if magic != 0x46546C67: sys.exit('not a glb')
    jl, jt = struct.unpack('<II', b[12:20])
    if jt != 0x4E4F534A: sys.exit('first chunk is not JSON')
    j = json.loads(b[20:20 + jl].decode('utf-8'))
    rest = b[20 + jl:]   # the BIN chunk(s), verbatim

    nodes = j.get('nodes', [])
    if a.list or not a.markers:
        for n in nodes:
            if 'mesh' not in n:
                print('%-14s t=%s' % (n.get('name'), n.get('translation')))
        return
    for name in a.markers:
        hit = [n for n in nodes if n.get('name') == name]
        if not hit and a.add:
            if a.x is None or a.y is None or a.z is None: sys.exit('--add %r needs --x --y --z' % name)
            # beside its siblings: the parent of an existing marker with the same prefix (gun8 -> gun1's), else the
            # scene root - the shipped GLBs keep markers at the root, the assets_src exports under the hull node
            import re
            pre = re.sub(r'\d+$', '', name)
            par = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
            sib = next((i for i, n in enumerate(nodes) if re.fullmatch(re.escape(pre) + r'\d+', n.get('name', ''))), None)
            nodes.append({'name': name, 'translation': [0.0, 0.0, 0.0]})
            k = len(nodes) - 1
            if sib is not None and sib in par:
                nodes[par[sib]].setdefault('children', []).append(k)
                where = 'under %r' % nodes[par[sib]].get('name')
            else:
                j.setdefault('scenes', [{'nodes': []}])
                j['scenes'][j.get('scene', 0)].setdefault('nodes', []).append(k)
                where = 'at the scene root'
            hit = [nodes[-1]]
            print('%-12s added %s' % (name, where))
        if len(hit) != 1: sys.exit('node %r: found %d (use --list, or --add to create it)' % (name, len(hit)))
        n = hit[0]
        if 'mesh' in n or 'matrix' in n: sys.exit('node %r is not a plain marker empty' % name)
        t = list(n.get('translation', [0.0, 0.0, 0.0]))
        before = list(t)
        for k, v in enumerate((a.x, a.y, a.z)):
            if v is not None: t[k] = v
        n['translation'] = t
        print('%-12s %s -> %s' % (name, [round(v, 5) for v in before], [round(v, 5) for v in t]))

    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    while len(js) % 4: js += b' '
    out = struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), jt) + js + rest
    open(a.glb, 'wb').write(out)
    print('wrote %s (%d -> %d bytes)' % (a.glb, len(b), len(out)))


if __name__ == '__main__':
    main()
