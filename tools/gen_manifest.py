#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_manifest.py — build LSS/asset-manifest.json from the GAME'S OWN CODE TABLES.

Run from the REPO ROOT:

    python tools/gen_manifest.py

It parses LSS/index.html (the shipped build; falls back to index-working.html)
and walks the same tables the runtime walks — SHIP_MODELS, HOARD_SHIPS,
MONSTER_DEFS + MONSTER_BASE_URL, the cockpit-frame tables (_GUN_CYCLE,
_GUN_EXTRA_FRAMES, _ABILITY_OVERLAY_FILES, the ability/core overlay
descriptors, the mapped-HUD mock JSONs), MAP_DATA's `thumb:` literals,
MUSIC_TRACKS, the announcer audio manifest, and the ring GLB literals — so the
manifest can only ever contain URLs the game actually asks for. It is NOT a
directory listing: anything on disk with no code reference is reported as an
ORPHAN instead of being shipped to players.

Deliberately EXCLUDED (owner's call): skybox/ (theme-scoped, loaded on demand),
campaign_media/, sounds/, walls/, themes/, effects/ (procedural or per-theme).

GROUP EXCLUSIONS (v36.25, owner's call — see EXCLUDE_GROUPS below). Whole
groups can be dropped from the preload set without touching the code walk, so
the "what does the game reference" logic and the "what is worth preloading"
policy stay separate. Excluded groups are still walked and still reported, they
just don't ship in the manifest. Pass --all to build the untrimmed set.

Cache-busting: each entry's "v" says WHICH stamp the game appends at runtime.
    0  none                                    (map_thumbs, music, audio)
    1  '?v=' + _MODELS_VERSION  (every GLB)    -> _MODEL_CACHE_BUST
    2  '?v=' + _FRAMES_VERSION  (frames/**)    -> _FRAME_CACHE_BUST
Both were '?v=' + LSS_BUILD before v36.25, which re-minted ~146 MB of URLs on
every single build bump. They are ART versions now: this manifest does NOT need
regenerating on a build bump, only when the asset TABLES change.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LSS = os.path.join(REPO, 'LSS')
OUT = os.path.join(LSS, 'asset-manifest.json')

# Directories the orphan scan covers (relative to LSS/). Anything under these
# with no code reference gets reported.
SCAN_DIRS = ['objects', 'ships', 'frames', 'map_thumbs', 'music', 'audio', 'rings']

# Owner-named extras: files the owner explicitly wants preloaded even though the
# code-reference walk does not find them. Each one is reported in the orphan
# section too, so the discrepancy stays visible.
#
# (v36.29) rings/fence.glb REMOVED from this list. Resource Timing on the live
# pane confirmed it downloaded on every visit (fence.glb 1647K) while a
# full-text grep of index-working.html finds ZERO references to it — no
# _ringBaseUrl literal, no table entry, nothing. It was pure preload cost. The
# FILE is still on disk (rebuilt by tools/compress_glb.mjs like everything
# else), so wiring it up later is a one-line change; it just isn't downloaded
# by people who will never see it. Restore by un-commenting the line below.
OWNER_EXTRAS = [
    # ('rings/fence.glb', 1, 'rings'),   # owner listed it with cyanring.glb; no code reference found
]

# (v36.25) Groups the owner does NOT want bulk-preloaded. They are still walked
# and still reported ("EXCLUDED" section) — only kept out of the shipped list.
#   music  5 files / 42.0 MB : <audio> streams these natively, progressively,
#                              and only one track plays at a time. Downloading
#                              all five up front buys nothing.
#   hoard 22 files / 60.4 MB : HOARD enemy ships arrive progressively over a
#                              run; loadHoardModel() pulls each on first sight.
# Together they were 102.4 MB of the 193 MB set — more than half the bytes for
# assets that are either streamed or not needed for minutes.
#
# TRADE-OFF, stated plainly: excluding `hoard` means a HOARD-mode enemy type
# seen for the first time is a cold network fetch instead of a disk-cache hit.
# That is the owner's call (193 MB up front for every visitor was the bigger
# problem), and `loadHoardModel` already handles the async arrival — but if
# HOARD ever reports first-sight stutter, this is the line that caused it.
# `--all` on the command line overrides this and builds the full set.
EXCLUDE_GROUPS = {'music', 'hoard'}


def read_source():
    for name in ('index.html', 'index-working.html'):
        p = os.path.join(LSS, name)
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                text = f.read()
            # (v38.64) The shipped build keeps the game script in LSS/lss.js
            # (strip.py splits it out of index.html); the code tables this
            # walks live there now. Concatenate so both layouts work.
            js = os.path.join(LSS, 'lss.js')
            if name == 'index.html' and os.path.exists(js):
                with open(js, 'r', encoding='utf-8') as f:
                    text += '\n' + f.read()
                name = 'index.html+lss.js'
            return name, text
    sys.exit('gen_manifest: no LSS/index.html or LSS/index-working.html found')


def block(src, header, closer):
    """Return the text of a `const NAME = {` ... `\\n};` style declaration."""
    i = src.find(header)
    if i < 0:
        return ''
    j = src.find('\n' + closer, i)
    if j < 0:
        return ''
    return src[i + len(header):j]


def js_strings(text):
    """Every single-quoted string literal in a chunk of JS."""
    return re.findall(r"'([^'\\\n]*)'", text)


def obj_of_lists(text):
    """Parse `KEY: ['a','b'],` entries (values may wrap across lines)."""
    out = {}
    for m in re.finditer(r"(\w+)\s*:\s*\[(.*?)\]", text, re.S):
        out[m.group(1)] = js_strings(m.group(2))
    return out


def main():
    src_name, src = read_source()

    build_m = re.search(r"const LSS_BUILD\s*=\s*'([^']+)'", src)
    build = build_m.group(1) if build_m else '0'

    # url -> (stamp, group). dict keeps insertion order = manifest order.
    # stamp: 0 none / 1 _MODELS_VERSION / 2 _FRAMES_VERSION (see module docstring).
    refs = {}

    def add(url, versioned, group):
        if url not in refs:
            refs[url] = (int(versioned), group)

    # ---------------------------------------------------------------- ships --
    ship_block = block(src, 'const SHIP_MODELS = {', '};')
    ship_keys = re.findall(r"(\w+)\s*:\s*\{\s*url:\s*'([^']+)'", ship_block)
    for key, url in ship_keys:
        add('ships/' + url, True, 'ships')
        # (v38.93) the small-device set (base colour 1k) compress_glb.mjs writes beside it.
        # Its own group so the runtime preloader can walk exactly one of the two.
        add('ships/m/' + url, True, 'ships_m')
    playable = [k for k, _ in ship_keys]

    # Cross-check against LOADOUTS so a new ship without a GLB is visible.
    lo_block = block(src, 'const LOADOUTS = {', '};')
    loadout_keys = re.findall(r"^  (\w+):\s*\{", lo_block, re.M)

    # ------------------------------------------------------------- monsters --
    mon_block = block(src, 'const MONSTER_DEFS = [', '];')
    mon_keys = re.findall(r"key:\s*'([^']+)'", mon_block)
    mon_base_m = re.search(r"const MONSTER_BASE_URL\s*=\s*'([^']*)'", src)
    mon_base = mon_base_m.group(1) if mon_base_m else 'objects/'
    for k in mon_keys:
        add(mon_base + k + '.glb', True, 'objects')
    # Literal `MONSTER_BASE_URL + 'Sphere.glb?v='` style loads (champion shell).
    # The literal usually carries the cache-bust tail, so allow `?...` after .glb.
    for lit in re.findall(r"MONSTER_BASE_URL\s*\+\s*'([^']+?\.glb)[^']*'", src):
        add(mon_base + lit, True, 'objects')

    # ---------------------------------------------------------------- hoard --
    hoard_block = block(src, 'const HOARD_SHIPS = [', '];')
    hoard = js_strings(hoard_block)
    nem = re.search(r"const NEMESIS_SHIP\s*=\s*'([^']+)'", src)
    if nem and nem.group(1) not in hoard:
        hoard.append(nem.group(1))
    hoard_base_m = re.search(r"const _hoardBaseUrl[\s\S]{0,400}?return\s*'\./([^']+)'", src)
    hoard_base = hoard_base_m.group(1) if hoard_base_m else 'objects/hoard/'
    for k in sorted(hoard):
        add(hoard_base + k + '.glb', True, 'hoard')

    # ---------------------------------------------------------------- rings --
    ring_base_m = re.search(r"const _ringBaseUrl[\s\S]{0,400}?return\s*'\./([^']+)'", src)
    ring_base = ring_base_m.group(1) if ring_base_m else 'rings/'
    for lit in re.findall(r"_ringBaseUrl\s*\+\s*'([^']+?\.glb)[^']*'", src):
        add(ring_base + lit, True, 'rings')

    # --------------------------------------------------------------- frames --
    gun_cycle = obj_of_lists(block(src, 'const _GUN_CYCLE = {', '};'))
    gun_extra = obj_of_lists(block(src, 'const _GUN_EXTRA_FRAMES = {', '};'))
    abil_files = obj_of_lists(block(src, 'const _ABILITY_OVERLAY_FILES = {', '};'))

    # Ability + core overlay descriptors: every `loadoutKey === 'KEY'` branch
    # owns the *.png literals that follow it until the next branch.
    desc_files = {}
    for fn in ('function _abilityOverlayDescFor(', 'function _coreOverlayDescFor('):
        body = block(src, fn, '}\n')
        if not body:
            continue
        parts = re.split(r"loadoutKey\s*===\s*'(\w+)'", body)
        for i in range(1, len(parts) - 1, 2):
            key, chunk = parts[i], parts[i + 1]
            for f in re.findall(r"'([^']+\.png)'", chunk):
                desc_files.setdefault(key, set()).add(f)

    # stamp 2 = _FRAMES_VERSION (_FRAME_CACHE_BUST), NOT the model/build stamp.
    frame_keys = sorted(set(playable) | set(gun_cycle) | set(abil_files) | set(desc_files))
    for key in frame_keys:
        d = key[0] + key[1:].lower()
        add('frames/%s/frame_%s.png' % (d, key), 2, 'frames')
        for sfx in list(gun_cycle.get(key, [])) + list(gun_extra.get(key, [])):
            add('frames/%s/%s_%s.png' % (d, sfx, key), 2, 'frames')
        for f in list(abil_files.get(key, [])) + sorted(desc_files.get(key, ())):
            add('frames/%s/%s' % (d, f), 2, 'frames')
        # Mapped-HUD geometry (_hmGet fetches frames/mock/<ship>.json).
        add('frames/mock/%s.json' % key.lower(), 2, 'frames')

    # ----------------------------------------------------------- map thumbs --
    for t in sorted(set(re.findall(r"thumb:\s*'(map_thumbs/[^']+)'", src))):
        add(t, False, 'map_thumbs')

    # ---------------------------------------------------------------- music --
    for t in js_strings(block(src, 'const MUSIC_TRACKS = {', '};')):
        if t.endswith('.mp3'):
            add(t, False, 'music')

    # ------------------------------------------------ announcer voice lines --
    ann_base_m = re.search(r"const AUDIO_BASE_CANDIDATES\s*=\s*\[\s*'([^']+)'", src)
    ann_base = ann_base_m.group(1) if ann_base_m else 'audio/'
    ann_manifest = os.path.join(LSS, ann_base.replace('/', os.sep), 'manifest.json')
    add(ann_base + 'manifest.json', False, 'audio')
    if os.path.exists(ann_manifest):
        with open(ann_manifest, 'r', encoding='utf-8') as f:
            for h in sorted(json.load(f).keys()):
                add(ann_base + h + '.mp3', False, 'audio')
    else:
        print('  ! announcer manifest missing: %s' % ann_manifest)

    # --------------------------------------------------------- owner extras --
    for url, ver, grp in OWNER_EXTRAS:
        add(url, ver, grp)
    extra_urls = set(u for u, _, _ in OWNER_EXTRAS)

    # ---------------------------------------------------- size + disk check --
    keep_all = '--all' in sys.argv[1:]
    excluded = set() if keep_all else EXCLUDE_GROUPS
    files, missing, total = [], [], 0
    dropped, dropped_bytes = [], 0
    for url, (ver, grp) in refs.items():
        p = os.path.join(LSS, url.replace('/', os.sep))
        if not os.path.exists(p):
            missing.append(url)
            continue
        b = os.path.getsize(p)
        if grp in excluded:
            dropped.append((url, b, grp))
            dropped_bytes += b
            continue
        total += b
        files.append({'u': url, 'b': b, 'v': ver, 'g': grp})

    # ------------------------------------------------------------- orphans ---
    referenced = set(refs.keys())
    orphans = []
    for d in SCAN_DIRS:
        root = os.path.join(LSS, d)
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, LSS).replace(os.sep, '/')
                if rel in referenced and rel not in extra_urls:
                    continue
                orphans.append({'u': rel, 'b': os.path.getsize(full)})
    orphans.sort(key=lambda o: -o['b'])
    orphan_bytes = sum(o['b'] for o in orphans)

    manifest = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sourceBuild': build,
        'source': src_name,
        'excludedGroups': sorted(excluded),
        'count': len(files),
        'totalBytes': total,
        'files': files,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, separators=(',', ':'))
        f.write('\n')

    mb = lambda n: '%.1f MB' % (n / 1048576.0)
    by_group = {}
    for e in files:
        g = by_group.setdefault(e['g'], [0, 0])
        g[0] += 1
        g[1] += e['b']

    print('gen_manifest: wrote %s' % os.path.relpath(OUT, REPO))
    print('  source        : LSS/%s  (LSS_BUILD %s)' % (src_name, build))
    print('  files         : %d' % len(files))
    print('  total         : %s (%d bytes)' % (mb(total), total))
    for g in sorted(by_group):
        n, b = by_group[g]
        print('    %-11s %3d files  %10s' % (g, n, mb(b)))
    if dropped:
        by_ex = {}
        for _u, b, g in dropped:
            e = by_ex.setdefault(g, [0, 0])
            e[0] += 1
            e[1] += b
        print('  EXCLUDED (referenced by code, deliberately NOT preloaded — EXCLUDE_GROUPS):')
        for g in sorted(by_ex):
            n, b = by_ex[g]
            print('    %-11s %3d files  %10s' % (g, n, mb(b)))
        print('    %-11s %3d files  %10s  <-- kept off the wire' % ('TOTAL', len(dropped), mb(dropped_bytes)))
    elif keep_all:
        print('  (--all: EXCLUDE_GROUPS ignored, full set written)')
    if playable and sorted(playable) != sorted(loadout_keys):
        print('  ! SHIP_MODELS keys != LOADOUTS keys: %s vs %s'
              % (sorted(playable), sorted(loadout_keys)))
    if missing:
        print('  MISSING (referenced by code, not on disk): %d' % len(missing))
        for u in missing:
            print('    - %s' % u)
    print('  ORPHANS (on disk under %s, no code reference): %d files, %s'
          % ('/'.join(SCAN_DIRS), len(orphans), mb(orphan_bytes)))
    for o in orphans:
        note = '   <-- shipped anyway (OWNER_EXTRAS)' if o['u'] in extra_urls else ''
        print('    %10s  %s%s' % (mb(o['b']), o['u'], note))


if __name__ == '__main__':
    main()
