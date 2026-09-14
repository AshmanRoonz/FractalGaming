#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Set a material's baseColorFactor / emissiveFactor inside a .glb without Blender.

    python tools/glb_set_material.py LSS/ships/puncture.glb Puncture_Cabin_Emission \
        --base 1,0.93,0.27,1 --emissive 1,0.93,0.27

The GLB is a 12-byte header, a JSON chunk (padded with spaces to 4 bytes) and a BIN chunk.
Only the JSON chunk is rewritten; the BIN chunk and every accessor offset are untouched, so the
edit is exact and reversible. Prints the before/after factors. Remember _MODELS_VERSION in
index-working.html is the cache-bust for GLB urls - bump it or the game keeps the old file.
"""
import argparse, json, struct, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('material', help='exact material name (see --list)')
    ap.add_argument('--base', help='r,g,b[,a] baseColorFactor (linear 0..1)')
    ap.add_argument('--emissive', help='r,g,b emissiveFactor (linear 0..1)')
    ap.add_argument('--list', action='store_true', help='list material names and factors, change nothing')
    a = ap.parse_args()

    b = open(a.glb, 'rb').read()
    magic, ver, total = struct.unpack('<III', b[:12])
    if magic != 0x46546C67: sys.exit('not a glb')
    jl, jt = struct.unpack('<II', b[12:20])
    if jt != 0x4E4F534A: sys.exit('first chunk is not JSON')
    j = json.loads(b[20:20 + jl].decode('utf-8'))
    rest = b[20 + jl:]   # the BIN chunk(s), verbatim

    mats = j.get('materials', [])
    if a.list:
        for m in mats:
            pbr = m.get('pbrMetallicRoughness', {})
            print('%-40s base=%s emissive=%s' % (m.get('name'), pbr.get('baseColorFactor'), m.get('emissiveFactor')))
        return
    hit = [m for m in mats if m.get('name') == a.material]
    if len(hit) != 1: sys.exit('material %r: found %d (use --list)' % (a.material, len(hit)))
    m = hit[0]
    pbr = m.setdefault('pbrMetallicRoughness', {})
    print('before: base=%s emissive=%s' % (pbr.get('baseColorFactor'), m.get('emissiveFactor')))
    if a.base:
        v = [float(x) for x in a.base.split(',')]
        if len(v) == 3: v.append(1.0)
        pbr['baseColorFactor'] = v
    if a.emissive:
        m['emissiveFactor'] = [float(x) for x in a.emissive.split(',')]
    print('after:  base=%s emissive=%s' % (pbr.get('baseColorFactor'), m.get('emissiveFactor')))

    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    while len(js) % 4: js += b' '
    out = struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), jt) + js + rest
    open(a.glb, 'wb').write(out)
    print('wrote %s (%d -> %d bytes)' % (a.glb, len(b), len(out)))

if __name__ == '__main__':
    main()
