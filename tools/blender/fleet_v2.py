#!/usr/bin/env python3
"""Build the Meshy v2 fleet end to end.

    python tools/blender/fleet_v2.py [--ships a,b] [--render] [--no-compress]

Mapping: tools/blender/intake/fleet.json = { "slayer": {"slug": "ship_slayer_a_refined", "mode": "open"|"cut"}, ... }
(candidate folder under assets_base/cockpits/candidates ; open = a real cockpit cavity, cut = a closed
canopy bulge that is cut out first). Per ship: ship_intake.py (canonical axes +
markers -> assets_base/ships_v2) then ship_cockpit.py --open (glass dome over the cavity,
interior, lining -> assets_src/ships), then compress_glb.mjs --only ships + gen_manifest.py.
The old assets_base/ships chain (cleanup -> symmetry) is NOT run: the remeshed Meshy hulls are
thousands of shells and its debris rule deletes half the ship ; their mirror error is already
~0.1% of the width.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blender_path import find_blender  # noqa: E402  (needs the path insert above)

# Was hardcoded to "Blender 4.1"; that install is gone. See blender_path.py -
# $LSS_BLENDER overrides, otherwise the newest portable/installed build wins.
BLENDER = find_blender()
argv = sys.argv[1:]


def opt(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else default
    return default


mapping = json.load(open(os.path.join(ROOT, 'tools', 'blender', 'intake', 'fleet.json'), encoding='utf-8'))
ships = opt('--ships', ','.join(mapping)).split(',')
render = ['--render'] if '--render' in argv else []


def run(args, tag):
    print(f'== {tag}', flush=True)
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    keep = [ln for ln in (r.stdout + r.stderr).splitlines()
            if ln.startswith(('INTAKE', 'COCKPIT', 'SHIPPED', 'Traceback', 'Error', '  File', 'ships/')) or 'Error' in ln]
    for ln in keep[-12:]:
        print('   ' + ln[:400])
    if r.returncode != 0:
        sys.exit(f'{tag} failed ({r.returncode})')


for ship in ships:
    slug = mapping[ship]['slug']
    glb = os.path.join('assets_base', 'cockpits', 'candidates', slug, 'model.glb')
    run([BLENDER, '--background', '--python', 'tools/blender/ship_intake.py', '--', '--ship', ship, '--glb', glb] + render, f'intake {ship} <- {slug}')
open_ships = [s_ for s_ in ships if mapping[s_]['mode'] == 'open']
cut_ships = [s_ for s_ in ships if mapping[s_]['mode'] == 'cut']
args = [BLENDER, '--background', '--python', 'tools/blender/ship_cockpit.py', '--', '--in', 'assets_base/ships_v2', '--out', 'assets_src/ships',
        '--ships', ','.join(ships)]
if open_ships:
    args += ['--open', ','.join(open_ships)]
if cut_ships:
    args += ['--cut', ','.join(cut_ships)]
run(args + render, 'cockpit stage')
if '--no-compress' not in argv:
    run(['node', 'tools/compress_glb.mjs', '--only', 'ships'], 'compress')
    run([sys.executable, 'tools/gen_manifest.py'], 'manifest')
print('FLEET_V2_DONE', ships)
