#!/usr/bin/env python3
"""The LSS fleet in Meshy terms: one entry per ship class with the geometry prompt (preview)
and the paint prompt (refine). Drives tools/meshy/meshy.py.

    python tools/meshy/fleet.py preview <ship> [<slug-suffix>]   # 20 credits, clay geometry
    python tools/meshy/fleet.py refine  <ship> <preview-slug>    # 10 credits, PBR 2k textures
    python tools/meshy/fleet.py prompts                           # print them

Slugs: ship_<ship>_<suffix> for previews, <preview-slug>_refined for refines. Preview task ids
are read back from the candidate folder's task JSON so nothing has to be copied by hand.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshy  # noqa: E402

OPEN_COCKPIT = ('the cockpit is an OPEN recess in the top of the fuselage with NO canopy and NO windshield, '
                'the pilot seat and instrument panel are exposed to the sky, ')
COMMON = 'hard-surface sci-fi, clean panel lines, symmetric, game asset'

FLEET = {
    'vortex': {
        'geo': 'sleek arrowhead starfighter VORTEX, small corvette class, single-seat, ' + OPEN_COCKPIT +
               'long spinal beam cannon along the top, twin engine nozzles at the rear, ' + COMMON,
        'paint': 'medium charcoal grey armor panels (not black) with bold bright violet accent stripes and glowing violet light strips, high contrast, '
                 'dark tinted cockpit glass, brushed gunmetal cannon, subtle weathering and panel line grime, '
                 'small squadron decals, clean sci-fi military starfighter',
    },
    'pyro': {
        'geo': 'heavy starfighter bomber PYRO, large dreadnought class, single-seat, ' + OPEN_COCKPIT +
               'two big thermite launcher pods slung under stubby wings, four engine nozzles at the rear, ' + COMMON,
        'paint': 'dark red and gunmetal armor panels with bold black stripes, glowing red light strips and heat-scorched launcher pods, high contrast, '
                 'dark tinted cockpit glass, brushed gunmetal, subtle weathering and panel line grime, '
                 'small squadron decals, clean sci-fi military bomber',
    },
    'puncture': {
        'geo': 'slim sniper starfighter PUNCTURE, medium frigate class, single-seat, ' + OPEN_COCKPIT +
               'one very long railgun barrel mounted along the right side of the fuselage, twin engine nozzles at the rear, '
               'hard-surface sci-fi, clean panel lines, game asset',
        'paint': 'white armor panels with gold accent panels and glowing yellow light strips, dark tinted cockpit glass, '
                 'brushed gunmetal railgun with gold coils, subtle weathering and panel line grime, small squadron decals, '
                 'clean sci-fi military starfighter',
    },
    'slayer': {
        'geo': 'brawler starfighter SLAYER, medium frigate class, single-seat, ' + OPEN_COCKPIT +
               'wide multi-barrel shotgun muzzle cluster in the nose, short swept wings, twin engine nozzles at the rear, ' + COMMON,
        'paint': 'dark olive green armor panels with bright green emissive light strips and glowing green sensor slits, '
                 'dark tinted cockpit glass, brushed gunmetal weapon barrels, subtle weathering and panel line grime, '
                 'small squadron decals, clean sci-fi military starfighter',
    },
    'tracker': {
        'geo': 'recon starfighter TRACKER, small corvette class, single-seat, ' + OPEN_COCKPIT +
               'sensor dish and antenna array on the spine, missile racks under both wings, twin engine nozzles at the rear, ' + COMMON,
        'paint': 'tan and dark bronze armor panels with glowing orange light strips and orange sensor lenses, '
                 'dark tinted cockpit glass, brushed gunmetal missile racks, subtle weathering and panel line grime, '
                 'small squadron decals, clean sci-fi military starfighter',
    },
    'blaster': {
        'geo': 'heavy gunship starfighter BLASTER, large dreadnought class, single-seat, ' + OPEN_COCKPIT +
               'two rotary gatling cannons flanking the nose, broad armored hull, four engine nozzles at the rear, ' + COMMON,
        'paint': 'white armor panels with cyan accent stripes and glowing cyan light strips, dark tinted cockpit glass, '
                 'brushed gunmetal rotary cannons, subtle weathering and panel line grime, small squadron decals, '
                 'clean sci-fi military gunship',
    },
    'syphon': {
        'geo': 'sleek interceptor starfighter SYPHON, small corvette class, single-seat, ' + OPEN_COCKPIT +
               'twin forked zapper prongs at the nose, rocket pods on the flanks, twin engine nozzles at the rear, ' + COMMON,
        'paint': 'medium gunmetal grey armor panels (not black) with bold bright blue accent stripes, glowing blue light strips and blue energy conduits along the prongs, high contrast, '
                 'dark tinted cockpit glass, subtle weathering and panel line grime, small squadron decals, '
                 'clean sci-fi military interceptor',
    },
}


def preview_id(slug):
    js = sorted(glob.glob(os.path.join(meshy.OUT_ROOT, slug, 'task_t2m_*.json')))
    for j in js:
        t = json.load(open(j, encoding='utf-8'))
        if t.get('type') == 'text-to-3d-preview' and t.get('status') == 'SUCCEEDED':
            return t['id']
    sys.exit(f'no succeeded preview task json under {slug}')


def main(argv):
    if not argv or argv[0] == 'prompts':
        for k, v in FLEET.items():
            print(k, '\n  geo:', v['geo'], '\n  paint:', v['paint'])
        return
    cmd, ship = argv[0], argv[1]
    if cmd == 'preview':
        suffix = argv[2] if len(argv) > 2 else 'b'
        slug = f'ship_{ship}_{suffix}'
        body = {'mode': 'preview', 'prompt': FLEET[ship]['geo'], 'ai_model': 'latest', 'should_remesh': True,
                'topology': 'triangle', 'target_polycount': 60000, 'target_formats': ['glb']}
        pid = meshy.call('POST', meshy.KIND_PATH['t2m'], body)['result']
        print('preview task', pid, '->', slug)
        meshy.wait('t2m', pid, slug)
        return
    if cmd == 'refine':
        pslug = argv[2]
        pid = preview_id(pslug)
        body = {'mode': 'refine', 'preview_task_id': pid, 'enable_pbr': True, 'texture_resolution': '2k',
                'ai_model': 'latest', 'target_formats': ['glb'], 'texture_prompt': FLEET[ship]['paint']}
        rid = meshy.call('POST', meshy.KIND_PATH['t2m'], body)['result']
        print('refine task', rid, 'of preview', pid, '->', pslug + '_refined')
        meshy.wait('t2m', rid, pslug + '_refined')
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
