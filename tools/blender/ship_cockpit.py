# -*- coding: utf-8 -*-
"""
ship_cockpit.py — stage 2: canopy glass + a modelled cockpit interior for each LSS ship.
Headless Blender 4.1:

    "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background \
        --python tools/blender/ship_cockpit.py -- [--in DIR] [--out DIR] [--ships a,b] [--render] [--no-export]

Defaults:  --in tools/blender/work/clean   --out assets_src/ships   reports -> tools/blender/reports/cockpit

Per ship:
  1. import the cleaned hull, flatten, keep gun*/thruster*/cockpit1 markers.
  2. CANOPY  faces found by texture saturation near the cockpit1 marker (largest saturated
     component, or the union of same-hue components for split canopies like PYRO) ->
     a second material on the hull: the SAME hull texture, alphaMode BLEND at 0.38, single
     sided. From outside the painted canopy is kept but see-through ; from inside (first
     person) the glass is a back face and culls away, so the pilot sees a clear view.
  3. INTERIOR one mesh, one material, one 512^2 atlas (+ emissive atlas) generated here:
     tub following the real canopy rim, seat, wrap-around dash with screens, side consoles,
     rear bulkhead, canopy struts, and a seated pilot. Everything is sized from the canopy
     (Lc x Wc x Hc) so it fits each hull.
  4. cockpit1 marker moved to the pilot's eye (that is what the marker is FOR — stage 3
     puts the first-person camera there).
  5. export GLB -> --out ; then  node tools/compress_glb.mjs --only ships.

In-game note: buildModelShipMesh keeps map / color / transparent / opacity only, so the
emissive atlas shows on the ship-select stage today and needs the stage-3 code change to
glow in combat.
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SHIPS_ALL = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


IN_DIR = os.path.join(REPO, opt('--in', 'tools/blender/work/sym'))
OUT_DIR = os.path.join(REPO, opt('--out', 'assets_src/ships'))
REPORT_DIR = os.path.join(REPO, 'tools/blender/reports/cockpit')
ATLAS_DIR = os.path.join(REPO, 'tools/blender/work/atlas')
SHIPS = opt('--ships', ','.join(SHIPS_ALL)).split(',')
RENDER = '--render' in argv
LINING = '--no-lining' not in argv     # inner lining pass (diagnostics: see the raw holes)
OPEN_SHIPS = set(x for x in opt('--open', '').split(',') if x)   # hulls with an OPEN cockpit cavity: a glass dome is built over the rim
CUT_SHIPS = set(x for x in opt('--cut', '').split(',') if x)     # hulls with a CLOSED canopy bulge: cut it out first, then treat as open
OPEN_SHIPS |= CUT_SHIPS
COAMING = '--no-coaming' not in argv   # tub-top-to-glass wall (diagnostics)
EXPORT = '--no-export' not in argv
for d in (OUT_DIR, REPORT_DIR, ATLAS_DIR):
    os.makedirs(d, exist_ok=True)

# Ship accent colours (sRGB 0-1) = LSS.CLASS_COLORS in index-working.html (~L4479), the
# palette weapons / shields / engine orbs already use, so the cockpit glow matches the ship.
ACCENT = {
    'blaster': (0x44 / 255, 0xee / 255, 0xff / 255), 'puncture': (0xff / 255, 0xee / 255, 0x44 / 255),
    'pyro': (0xff / 255, 0x33 / 255, 0x22 / 255), 'slayer': (0x44 / 255, 0xff / 255, 0x66 / 255),
    'syphon': (0x44 / 255, 0x88 / 255, 0xff / 255), 'tracker': (0xff / 255, 0x88 / 255, 0x00 / 255),
    'vortex': (0xaa / 255, 0x55 / 255, 0xff / 255),
}
# Per-ship canopy detection knobs. mode 'largest' = biggest saturated component ;
# 'union' = every same-hue component above min_comp (canopies split by frame bars).
CANOPY = {
    'default': {'R': 0.16, 'sat': 0.30, 'mode': 'largest', 'min_comp': 30, 'hue_tol': 0.06},
    'pyro': {'R': 0.20, 'sat': 0.28, 'mode': 'union', 'min_comp': 20, 'hue_tol': 0.08},
}
# OPEN-COCKPIT hulls (Meshy v2 fleet): the cavity is found with downward rays on a grid
# around cockpit1, its rim becomes the canopy outline and a lofted glass DOME is joined
# into the hull as the canopy faces. win = search window (of L), depth = how far below
# the rim a cell must sit to be cavity (of L), dome_h = dome height as a fraction of the
# rim width, apex_fwd = apex offset along the rim length (0 = centre, + = forward).
OPEN_CFG = {'default': {'win': 0.30, 'depth': 0.035, 'method': 'pct', 'local_r': 0.06, 'adapt_frac': 0.5, 'dome_h': 0.30, 'apex_fwd': 0.10, 'n_theta': 64, 'rings': 8},
            'vortex': {'method': 'adapt', 'depth': 0.02}}
# CLOSED canopies (Meshy painted a dark tinted bulge): the bulge faces are found and DELETED,
# then the open-cockpit dome replaces them - one canopy look across the fleet. 'dark' mode =
# dark, unsaturated, upward-ish faces near cockpit1 (light hulls) ; 'geo' mode = an ellipse
# footprint (ell_a x ell_b of L) above cockpit1.z - dz (dark hulls, where paint can't tell).
CUT_CFG = {'default': {'mode': 'dark', 'R': 0.30, 'val': 0.32, 'sat': 0.40, 'nz': -0.15,
                       'ell_a': 0.14, 'ell_b': 0.085, 'dz': 0.07, 'min_faces': 40},
           'pyro': {'mode': 'hue', 'hue': 0.50, 'hue_tol': 0.08}}     # refined with a BRIGHT CYAN canopy as the chroma key
# FRAME ART BILLBOARD (v37.39). The owner's painted cockpit overlays (LSS/frames/<Ship>/
# frame_<SHIP>.png, 1536x1024 RGBA: dark hard-surface panelling, hexagonal centre display,
# class-colour glowing instruments, top canopy rail, side pillars) ARE the target look.
# They ride in 3D on a cylinder band around the pilot's eye: the PNG's horizontal extent
# maps to +-FRAME_HFOV/2 degrees of yaw, its vertical extent to +-45 deg of pitch (the game
# camera is 90 deg vertical), alpha keeps the view through the glass. Radius FRAME_R of Lc:
# inside the dash so the painted dashboard is what the seat sees. An emissive map keeps the
# instruments lit ; the mask is saturation x value so dark metal stays dark.
FRAME_ART = True
FRAME_VFOV = 120.0         # the overlay filled the screen: the owner plays at fovDeg 120 (vertical), so the
FRAME_HFOV = 144.0         # PNG spans +-60 deg of pitch and, at 16:9, +-72 deg of yaw. At 90 deg the dash and
                           # rail strips are simply cropped at the screen edges (still there, a touch larger).
FRAME_EMIS_GAIN = 0.9      # the art as emissive (self-lit painting) ; FRAME_LIT = how much scene light adds on top
FRAME_LIT = 0.25
# The PNG is cut into STRIPS by its own alpha (dashboard at the bottom, canopy rail at the top,
# pillars at the sides where the art has them). Each strip keeps the overlay's screen angles
# (pitch -45..+45 over the PNG height, yaw +-HFOV/2 over its width) so the artist's composition
# is exact at the default eye, but sits at its OWN depth (fraction of Lc): dashboard close in
# front of the pilot (inside the procedural dash, which it hides), rail out at the canopy
# front, pillars between - so the head parallaxes against real structure.
FRAME_R = {'dash': 0.27, 'top': 0.60, 'side': 0.48}
FRAME_PNG = {sh: f'LSS/frames/{sh.capitalize()}/frame_{sh.upper()}.png'
             for sh in ('vortex', 'pyro', 'puncture', 'slayer', 'tracker', 'blaster', 'syphon')}
# COMPACT COCKPIT (v37.39, owner: "a lot of wasted space in the cockpits"). The tub follows
# the canopy outline, so a wide canopy left the pilot in an empty box: a shallower pit, side
# consoles from the armrests out to the walls and the full tub length, a raised deck with
# pedals in the footwell, avionics racks behind the seat, ribs along the walls.
COMPACT_DEPTH = 0.75       # tub depth multiplier (1.0 = the v37.36 pit)
EMIS_FILL = 1.5            # interior fill light (LINEAR multiplier on the base tile) baked into the emissive
                           # atlas. 3.0 flattened the cockpit into a grey box (owner: 'worse from inside');
                           # 1.5 keeps the dark, moody v37.34 look with shadowed panels just readable
GLASS_ALPHA = 0.35
# ships whose canopy rim rail should follow the WHOLE glass outline (tall greenhouse slit)
RAIL_FULL = set()          # (v37.40) the painted frame art outlines the window now ; the full thin rail was redundant (the dark bars
                           # across the Pyro's sky are the HULL's own painted greenhouse mullions, not this rail)
# ships whose dash grows into a tall instrument stack (eye high above the rim in a greenhouse)
TALL_DASH = set()          # (v37.40) the painted dashboard strip hides the tall instrument stack anyway
# Hull light-strip emissive mask knobs (see HULL LIGHTS below): pixels more saturated than
# `sat`, brighter than `val`, within `hue_tol` (0..1 hue space) of the class colour.
HULL_GLOW = {
    'default': {'sat': 0.45, 'val': 0.50, 'hue_tol': 0.10, 'strength': 1.0},
    'vortex': {'sat': 0.45, 'val': 0.50, 'hue_tol': 0.14, 'strength': 1.0},    # purple AND blue strips
    'puncture': {'sat': 0.55, 'val': 0.60, 'hue_tol': 0.07, 'strength': 0.8},  # gold panels are paint, not lights
    'tracker': {'sat': 0.55, 'val': 0.55, 'hue_tol': 0.07, 'strength': 0.9},
    'slayer': {'sat': 0.40, 'val': 0.45, 'hue_tol': 0.22, 'strength': 1.0},   # strips are yellow-green, not the class green
}

# atlas regions (u0, v0, u1, v1) ; 'tile' regions repeat across a surface, 'fit' regions are
# stretched onto one face (screens, glow strips, visor)
REG = {
    'metal': (0.00, 0.00, 0.50, 0.50, 'tile'), 'trim': (0.00, 0.50, 0.50, 1.00, 'tile'),
    'seat': (0.50, 0.00, 1.00, 0.50, 'tile'),
    # four distinct instrument tiles in the old screen quadrant: radar / bars / attitude / log
    'screen': (0.50, 0.50, 0.625, 0.625, 'fit'), 'scrB': (0.625, 0.50, 0.75, 0.625, 'fit'),
    'scrC': (0.50, 0.625, 0.625, 0.75, 'fit'), 'scrD': (0.625, 0.625, 0.75, 0.75, 'fit'),
    'glow': (0.75, 0.50, 1.00, 0.75, 'fit'), 'suit': (0.50, 0.75, 0.75, 1.00, 'tile'),
    'visor': (0.75, 0.75, 1.00, 1.00, 'fit'),
}
REG_ID = {k: i for i, k in enumerate(REG)}
REG_NAME = {i: k for k, i in REG_ID.items()}
REG_HULL = 99        # interior faces that wear the HULL material with the hull's own UVs (inner lining)


# ================================================================== atlas ==
def pnoise(h, w, freq, seed):
    """Periodic value noise in [0,1] that tiles at (h, w)."""
    rng = np.random.default_rng(seed)
    g = rng.random((freq + 1, freq + 1))
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    ys = np.linspace(0, freq, h, endpoint=False)
    xs = np.linspace(0, freq, w, endpoint=False)
    yi = np.floor(ys).astype(int)
    xi = np.floor(xs).astype(int)
    fy = ys - yi
    fx = xs - xi
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    return (a * (1 - fx)[None, :] * (1 - fy)[:, None] + b * fx[None, :] * (1 - fy)[:, None]
            + c * (1 - fx)[None, :] * fy[:, None] + d * fx[None, :] * fy[:, None])


def panel_tile(size, base, cell, seed, line_dark=0.55, rivets=True):
    """Dark sci-fi panel metal, tileable. base = sRGB tuple."""
    y, x = np.mgrid[0:size, 0:size]
    img = np.ones((size, size, 3), np.float32) * np.array(base, np.float32)
    n1 = pnoise(size, size, 4, seed)
    n2 = pnoise(size, size, 16, seed + 1)
    img *= (0.88 + 0.16 * n1 + 0.10 * (n2 - 0.5))[:, :, None]
    # per-panel brightness jitter
    rng = np.random.default_rng(seed + 7)
    pid = (y // cell) * 1000 + (x // cell)
    jit = rng.random(int(pid.max()) + 1)[pid]
    img *= (0.94 + 0.12 * jit)[:, :, None]
    # seams
    lx = (x % cell) < 2
    ly = (y % cell) < 2
    img[lx | ly] *= line_dark
    hx = ((x % cell) >= 2) & ((x % cell) < 3)
    hy = ((y % cell) >= 2) & ((y % cell) < 3)
    img[hx | hy] *= 1.18
    if rivets:
        rx = ((x % cell) - 7) ** 2 + ((y % cell) - 7) ** 2 < 4
        rx |= ((x % cell) - (cell - 7)) ** 2 + ((y % cell) - 7) ** 2 < 4
        rx |= ((x % cell) - 7) ** 2 + ((y % cell) - (cell - 7)) ** 2 < 4
        rx |= ((x % cell) - (cell - 7)) ** 2 + ((y % cell) - (cell - 7)) ** 2 < 4
        img[rx] = np.clip(img[rx] * 1.5 + 0.05, 0, 1)
    # scratches
    for _ in range(18):
        x0, y0 = rng.integers(0, size, 2)
        ang = rng.random() * math.pi
        ln = rng.integers(8, 40)
        xs = (x0 + np.cos(ang) * np.arange(ln)).astype(int) % size
        ys = (y0 + np.sin(ang) * np.arange(ln)).astype(int) % size
        img[ys, xs] = np.clip(img[ys, xs] * 1.25 + 0.03, 0, 1)
    return np.clip(img, 0, 1)


def screen_tile(size, tint, seed, kind='radar'):
    """Dark instrument screen with UI glyphs. kind: radar / bars / attitude / log.
    Returns (base, emissive)."""
    y, x = np.mgrid[0:size, 0:size]
    base = np.ones((size, size, 3), np.float32) * np.array((0.02, 0.03, 0.05), np.float32)
    glyph = np.zeros((size, size), np.float32)
    b = max(2, size // 32)
    glyph[(x >= b) & (x < size - b) & (y >= b) & (y < size - b) & ((x < b + 1) | (x >= size - b - 1) | (y < b + 1) | (y >= size - b - 1))] = 0.9
    rng = np.random.default_rng(seed)
    cx, cy = size * 0.5, size * 0.5
    if kind == 'radar':
        r = size * 0.38
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        for rr, w_ in ((r, 1.0), (r * 0.66, 0.5), (r * 0.33, 0.4)):
            glyph[np.abs(d - rr) < max(0.6, size / 100)] = w_
        glyph[(np.abs(x - cx) < 0.6) & (d < r)] = 0.35
        glyph[(np.abs(y - cy) < 0.6) & (d < r)] = 0.35
        ang = np.arctan2(y - cy, x - cx)
        sweep = ((ang - 0.9) % (2 * math.pi)) / (2 * math.pi)
        glyph = np.maximum(glyph, np.where(d < r, (1 - sweep) ** 6 * 0.7, 0))
        for _ in range(5):
            bx, by = rng.uniform(-r * 0.8, r * 0.8, 2)
            glyph[(x - (cx + bx)) ** 2 + (y - (cy + by)) ** 2 < (size * 0.03) ** 2] = 1.0
    elif kind == 'bars':
        n = 7
        for i in range(n):
            hgt = int(rng.integers(size * 0.12, size * 0.6))
            xs0 = int(b + 3 + i * (size - 2 * b - 6) / n)
            wdt = max(2, int((size - 2 * b - 6) / n) - 2)
            glyph[(x >= xs0) & (x < xs0 + wdt) & (y >= size - b - 4 - hgt) & (y < size - b - 4)] = 0.8
        glyph[(y == int(size * 0.2)) & (x > b + 2) & (x < size - b - 2)] = 0.5
    elif kind == 'attitude':
        # pitch ladder with a tilted horizon
        tl = math.radians(8)
        for k in range(-3, 4):
            yy = y - cy - k * size * 0.12 - (x - cx) * math.tan(tl)
            span = size * (0.32 if k == 0 else 0.16)
            glyph[(np.abs(yy) < max(0.7, size / 90)) & (np.abs(x - cx) < span)] = 0.9 if k == 0 else 0.5
        glyph[(np.abs(x - cx) < max(0.7, size / 90)) & (np.abs(y - cy) < size * 0.05)] = 1.0
        glyph[(np.abs(y - cy) < max(0.7, size / 90)) & (np.abs(x - cx) < size * 0.08)] = 1.0
    else:  # log
        for row in range(int(size * 0.7 / 6)):
            yy = b + 3 + row * 6
            xx = b + 3
            while xx < size * 0.8:
                w_ = int(rng.integers(2, 9))
                glyph[(y >= yy) & (y < yy + 2) & (x >= xx) & (x < xx + w_)] = 0.45 + 0.45 * rng.random()
                xx += w_ + 3
    glyph[(y % 4 == 0)] *= 0.75
    t = np.array(tint, np.float32)
    base = base + glyph[:, :, None] * t[None, None, :] * 0.55
    emis = glyph[:, :, None] * t[None, None, :]
    return np.clip(base, 0, 1), np.clip(emis, 0, 1)


def build_atlas(ship, tint, size=512):
    """Writes <ship>_int.png / <ship>_emis.png ; returns their paths."""
    base = np.zeros((size, size, 4), np.float32)
    emis = np.zeros((size, size, 4), np.float32)
    base[:, :, 3] = 1
    emis[:, :, 3] = 1
    h = size // 2
    q = size // 4

    def put(arr, r, tile):
        u0, v0, u1, v1 = r[:4]
        x0, x1 = int(u0 * size), int(u1 * size)
        y0, y1 = int(v0 * size), int(v1 * size)
        arr[y0:y1, x0:x1, :3] = tile

    seed = sum(ord(c) for c in ship)
    put(base, REG['metal'], panel_tile(h, (0.14, 0.15, 0.18), 64, seed))
    put(base, REG['trim'], panel_tile(h, (0.30, 0.31, 0.34), 32, seed + 3, line_dark=0.65, rivets=False))
    # seat fabric: quilted diamonds
    y, x = np.mgrid[0:h, 0:h]
    quilt = (np.abs(np.sin((x + y) * math.pi / 32)) * np.abs(np.sin((x - y) * math.pi / 32)))
    seat = np.ones((h, h, 3), np.float32) * np.array((0.10, 0.10, 0.115), np.float32)
    seat *= (0.85 + 0.35 * quilt)[:, :, None]
    seat *= (0.92 + 0.16 * pnoise(h, h, 8, seed + 5))[:, :, None]
    stripe = (np.abs(x - h * 0.5) < 6)
    seat[stripe] = seat[stripe] * 0.4 + np.array(tint, np.float32) * 0.45
    put(base, REG['seat'], np.clip(seat, 0, 1))
    for rname, kind in (('screen', 'radar'), ('scrB', 'bars'), ('scrC', 'attitude'), ('scrD', 'log')):
        sb, se = screen_tile(q // 2, tint, seed + 9, kind)
        put(base, REG[rname], sb)
        put(emis, REG[rname], se)
    glow = np.ones((q, q, 3), np.float32) * np.array(tint, np.float32)
    yy, xx = np.mgrid[0:q, 0:q]
    glow *= (0.75 + 0.25 * np.sin(yy / q * math.pi))[:, :, None]
    put(base, REG['glow'], np.clip(glow, 0, 1))
    # glow strips sit right under the pilot's eye on the closer seats ; 60% keeps them as an
    # accent rather than a light bar across the bottom of the view
    put(emis, REG['glow'], np.clip(glow * 0.6, 0, 1))
    suit = np.ones((q, q, 3), np.float32) * np.array((0.07, 0.07, 0.08), np.float32)
    suit *= (0.9 + 0.2 * pnoise(q, q, 6, seed + 11))[:, :, None]
    band = (np.abs(yy - q * 0.5) < 5)
    suit[band] = np.array(tint, np.float32) * 0.7
    put(base, REG['suit'], np.clip(suit, 0, 1))
    grad = (1.0 - yy / q)[:, :, None]
    visor = np.array(tint, np.float32)[None, None, :] * (0.15 + 0.55 * grad) + 0.05
    streak = np.exp(-((xx - yy * 0.6 - q * 0.25) ** 2) / (2 * 6.0 ** 2))[:, :, None]
    visor = visor + streak * 0.45
    put(base, REG['visor'], np.clip(visor, 0, 1))
    put(emis, REG['visor'], np.clip(np.array(tint, np.float32)[None, None, :] * 0.25 * grad, 0, 1))
    # emissive FILL on the structural regions: the cockpit sits in the hull's own shadow in
    # combat, and the rim rail / inner canopy frame face the pilot, never the sun, so they
    # read as pure black shards against the sky under ambient alone. The atlas pixels are
    # written as raw BYTES that the game decodes as sRGB (a 0.14 tile is 1.5% linear light),
    # so the fill is defined in LINEAR light: the tile lit by a light of strength EMIS_FILL,
    # re-encoded to sRGB. (v37.35: an sRGB-space "floor" of 0.14..0.8 of base all stayed
    # black - 0.8 x 0.13 = 0.10 sRGB = 1% linear.)
    def _lin(c):
        return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)

    def _srgb(l):
        l = np.clip(l, 0.0, 1.0)
        return np.where(l > 0.0031308, 1.055 * np.power(l, 1.0 / 2.4) - 0.055, 12.92 * l)

    for rname in ('metal', 'trim', 'seat', 'suit'):
        u0, v0, u1, v1 = REG[rname][:4]
        x0, x1, y0, y1 = int(u0 * size), int(u1 * size), int(v0 * size), int(v1 * size)
        fill = _srgb(_lin(base[y0:y1, x0:x1, :3]) * EMIS_FILL)
        emis[y0:y1, x0:x1, :3] = np.maximum(emis[y0:y1, x0:x1, :3], fill)
    paths = []
    for name, arr in (('int', base), ('emis', emis)):
        img = bpy.data.images.new(f'{ship}_{name}', size, size, alpha=True)
        img.pixels.foreach_set(arr.ravel())
        p = os.path.join(ATLAS_DIR, f'{ship}_{name}.png')
        img.filepath_raw = p
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
        paths.append(p)
    return paths


# =============================================================== helpers ==
def region_uv(region, u, v):
    u0, v0, u1, v1 = REG[region][:4]
    pad = 2.5 / 512
    return (u0 + pad + u * (u1 - u0 - 2 * pad), v0 + pad + v * (v1 - v0 - 2 * pad))


class Builder:
    """bmesh interior builder working in the ship-local frame (x fwd, y right, z up ; origin
    at the canopy centre on the rim plane)."""

    def __init__(self, frame, origin):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.reg = self.bm.faces.layers.int.new('region')
        # uv group: 0 = per-face box projection ; N > 0 = one planar (y,z) projection over the
        # whole group's bbox (helmet: the visor tile spans the visor, not every facet)
        self.grp = self.bm.faces.layers.int.new('grp')
        self.next_grp = 1
        self.frame = frame
        self.origin = origin
        self.inv = frame.transposed()
        self.parts = []   # (faces, region, tile_scale)

    def to_world(self, p):
        return self.frame @ (Vector(p) + self.origin)

    def to_local(self, w):
        return self.inv @ Vector(w) - self.origin

    def tag(self, faces, region):
        for f in faces:
            f[self.reg] = REG_ID[region]

    def box(self, center, size, rot=(0, 0, 0), region='metal', bevel=0.0):
        geom = bmesh.ops.create_cube(self.bm, size=1.0)['verts']
        S = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
        R = Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
        for v in geom:
            v.co = self.to_world(R @ (S @ v.co) + Vector(center))
        faces = {f for v in geom for f in v.link_faces}
        if bevel > 0:
            edges = {e for v in geom for e in v.link_edges}
            res = bmesh.ops.bevel(self.bm, geom=list(edges), offset=bevel, offset_type='OFFSET', segments=2,
                                  profile=0.7, affect='EDGES', clamp_overlap=True)
            faces |= set(res['faces'])
        faces = {f for f in faces if f.is_valid}
        self.tag(faces, region)
        for f in faces:
            f.smooth = False
        return faces

    def sphere(self, center, r, region='suit', segs=18, rings=12):
        geom = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0)['verts']
        for v in geom:
            v.co = self.to_world(v.co * r + Vector(center))
        faces = {f for v in geom for f in v.link_faces}
        self.tag(faces, region)
        g = self.next_grp
        self.next_grp += 1
        for f in faces:
            f.smooth = True
            f[self.grp] = g
        return faces

    def loft(self, rings, region='metal', inward_center=None, smooth=True):
        """Bridge consecutive rings (lists of local points, same length) with quads.
        If inward_center is given, orient faces to point TOWARD it."""
        vrings = [[self.bm.verts.new(self.to_world(p)) for p in ring] for ring in rings]
        faces = []
        for a, b in zip(vrings[:-1], vrings[1:]):
            n = len(a)
            for i in range(n):
                f = self.bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
                faces.append(f)
        if inward_center is not None:
            c = self.to_world(inward_center)
            for f in faces:
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - c) > 0:
                    f.normal_flip()
        self.tag(faces, region)
        for f in faces:
            f.smooth = smooth
        return faces, vrings

    def cap(self, vring, region='metal', inward_center=None):
        f = self.bm.faces.new(vring)
        f.normal_update()
        if inward_center is not None and f.normal.dot(f.calc_center_median() - self.to_world(inward_center)) > 0:
            f.normal_flip()
        res = bmesh.ops.triangulate(self.bm, faces=[f])
        faces = [x for x in res['faces'] if x.is_valid]
        self.tag(faces, region)
        for x in faces:
            x.smooth = False
        return faces

    def assign_uvs(self, tile_len):
        """Per-face box projection into the tagged atlas region (or one planar projection per
        uv group)."""
        self.bm.faces.ensure_lookup_table()
        gbox = {}
        for f in self.bm.faces:
            g = f[self.grp]
            if g:
                for l in f.loops:
                    p = self.to_local(l.vert.co)
                    lo_, hi_ = gbox.setdefault(g, [Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))])
                    for i in range(3):
                        lo_[i] = min(lo_[i], p[i])
                        hi_[i] = max(hi_[i], p[i])
        for f in self.bm.faces:
            if f[self.reg] == REG_HULL:
                continue                        # UVs copied from the hull face at creation
            region = REG_NAME[f[self.reg]]
            kind = REG[region][4]
            g = f[self.grp]
            if g:
                lo_, hi_ = gbox[g]
                for l in f.loops:
                    p = self.to_local(l.vert.co)
                    u = (p[1] - lo_[1]) / max(1e-9, hi_[1] - lo_[1])
                    v = (p[2] - lo_[2]) / max(1e-9, hi_[2] - lo_[2])
                    l[self.uv].uv = region_uv(region, min(1.0, max(0.0, u)), min(1.0, max(0.0, v)))
                continue
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            a, b = [i for i in range(3) if i != ax]
            pts = [self.to_local(l.vert.co) for l in f.loops]
            us = [p[a] for p in pts]
            vs = [p[b] for p in pts]
            umin, vmin = min(us), min(vs)
            su, sv = max(us) - umin, max(vs) - vmin
            for l, p in zip(f.loops, pts):
                if kind == 'fit':
                    u = (p[a] - umin) / su if su > 1e-9 else 0.0
                    v = (p[b] - vmin) / sv if sv > 1e-9 else 0.0
                else:
                    k = 1.0 / max(1.0, su / tile_len, sv / tile_len)
                    u = (p[a] - umin) / tile_len * k
                    v = (p[b] - vmin) / tile_len * k
                l[self.uv].uv = region_uv(region, min(1.0, u), min(1.0, v))

    def tub_uvs(self, faces, n_around, levels):
        """Continuous around-the-tub UVs for the lofted tub quads: faces are ordered ring by ring."""
        rep = 5.0
        for idx, f in enumerate(faces):
            i = idx % n_around
            lvl = idx // n_around
            u0 = (i / n_around) * rep % 1.0
            u1 = min(1.0, u0 + rep / n_around)
            v0, v1 = lvl / levels, (lvl + 1) / levels
            # loops were created as (a[i], a[i+1], b[i+1], b[i])
            uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            for l, (u, v) in zip(f.loops, uvs):
                l[self.uv].uv = region_uv('metal', u, v)


def look_at(o, t):
    o.rotation_euler = (t - o.location).to_track_quat('-Z', 'Y').to_euler()


# parity ray-cast vote (same test as ship_cleanup.py): how many of 8 rays from p cross the
# hull an odd number of times -> p is inside the closed surface
DIRS = [Vector(v) for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
                            (0.577, 0.577, 0.577), (-0.577, -0.577, 0.577))]


def inside_votes(bvh, p, eps):
    odd = 0
    for dv in DIRS:
        n = 0
        o = p.copy()
        for _ in range(128):
            loc = bvh.ray_cast(o, dv)[0]
            if loc is None:
                break
            n += 1
            o = loc + dv * eps
        odd += n & 1
    return odd


def cut_canopy_bulge(hull, cp, L, prm, rep):
    """Delete the closed canopy bulge around cp so the open-cockpit dome can replace it."""
    me = hull.data
    nP = len(me.polygons)
    cen = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('center', cen)
    cen = cen.reshape(-1, 3)
    nrm = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    d = np.linalg.norm(cen - np.array(cp), axis=1)
    if prm['mode'] == 'dark':
        mat0 = me.materials[0]
        img = next(n.image for n in mat0.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
        W, H = img.size
        px = np.empty(W * H * 4, np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(H, W, 4)
        ls = np.empty(nP, np.int32)
        lt = np.empty(nP, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        me.polygons.foreach_get('loop_total', lt)
        uvs = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get('uv', uvs)
        uvs = uvs.reshape(-1, 2)
        cum = np.cumsum(uvs, axis=0)
        cs = np.concatenate([[0.0], cum[:, 0]])
        ct = np.concatenate([[0.0], cum[:, 1]])
        fu = (cs[ls + lt] - cs[ls]) / lt
        fv = (ct[ls + lt] - ct[ls]) / lt
        ix = (np.mod(fu, 1.0) * W).astype(int).clip(0, W - 1)
        iy = (np.mod(fv, 1.0) * H).astype(int).clip(0, H - 1)
        col = px[iy, ix, :3]
        mx = col.max(1)
        mn = col.min(1)
        sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
        hull_val = float(np.median(mx))
        seed = (d < prm['R'] * L) & (mx < min(prm['val'], 0.55 * hull_val)) & (sat < prm['sat']) & (nrm[:, 2] > prm['nz'])
        rep['cut_hull_val'] = round(hull_val, 3)
    elif prm['mode'] == 'hue':
        # CHROMA KEY: the refine was prompted to paint the canopy a colour the hull never
        # wears (Pyro: bright cyan on red) ; the canopy is then the saturated patch of that hue
        mat0 = me.materials[0]
        img = next(n.image for n in mat0.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
        W, H = img.size
        px = np.empty(W * H * 4, np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(H, W, 4)
        ls = np.empty(nP, np.int32)
        lt = np.empty(nP, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        me.polygons.foreach_get('loop_total', lt)
        uvs = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get('uv', uvs)
        uvs = uvs.reshape(-1, 2)
        cum = np.cumsum(uvs, axis=0)
        cs = np.concatenate([[0.0], cum[:, 0]])
        ct = np.concatenate([[0.0], cum[:, 1]])
        fu = (cs[ls + lt] - cs[ls]) / lt
        fv = (ct[ls + lt] - ct[ls]) / lt
        ix = (np.mod(fu, 1.0) * W).astype(int).clip(0, W - 1)
        iy = (np.mod(fv, 1.0) * H).astype(int).clip(0, H - 1)
        col = px[iy, ix, :3]
        mx = col.max(1)
        mn = col.min(1)
        sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
        r_, g_, b_ = col[:, 0], col[:, 1], col[:, 2]
        dlt = np.maximum(mx - mn, 1e-6)
        hue = np.where(mx == r_, ((g_ - b_) / dlt) % 6, np.where(mx == g_, (b_ - r_) / dlt + 2, (r_ - g_) / dlt + 4)) / 6.0
        dh = np.abs(hue - prm['hue'])
        dh = np.minimum(dh, 1 - dh)
        seed = (d < prm['R'] * L) & (dh < prm.get('hue_tol', 0.08)) & (sat > prm.get('key_sat', 0.45)) & (mx > prm.get('key_val', 0.30)) & (nrm[:, 2] > prm['nz'])
    else:
        ex = (cen[:, 0] - cp.x) / (prm['ell_a'] * L)
        ey = (cen[:, 1] - cp.y) / (prm['ell_b'] * L)
        seed = (ex * ex + ey * ey < 1.0) & (cen[:, 2] > cp.z - prm['dz'] * L) & (nrm[:, 2] > prm['nz'])
    # SPATIAL clusters of the seed faces (a remeshed Meshy hull is thousands of separate
    # shells, so shared-edge components split the painted canopy into confetti) ; keep the
    # biggest cluster near the marker, then take every seed face within its footprint.
    area = np.empty(nP, np.float32)
    me.polygons.foreach_get('area', area)
    sidx = np.nonzero(seed)[0]
    sidx = sidx[np.argsort(-area[sidx])]
    comps = []
    for i in sidx:
        c = cen[i]
        for cl in comps:
            if np.linalg.norm(cl['c'] - c) < 0.08 * L:
                w = cl['a'] + area[i]
                cl['c'] = (cl['c'] * cl['a'] + c * area[i]) / w
                cl['a'] = w
                cl['m'].append(int(i))
                break
        else:
            comps.append({'c': c.copy(), 'a': float(area[i]), 'm': [int(i)]})
    if not comps:
        raise RuntimeError('cut: no canopy bulge faces found')
    comps.sort(key=lambda cl: (float(np.linalg.norm(cl['c'] - np.array(cp))) > 0.12 * L, -cl['a']))
    best = comps[0]
    cut = np.zeros(nP, bool)
    cut[best['m']] = True
    if prm['mode'] == 'hue':                     # a chroma key is unambiguous: every keyed cluster near the main one is canopy
        for cl in comps[1:]:
            if np.linalg.norm(cl['c'] - best['c']) < 0.25 * L:
                cut[cl['m']] = True
    # footprint: the cluster's members' extent, padded ; every seed face inside it goes too
    mem = cen[best['m']]
    lo_, hi_ = mem.min(0) - 0.02 * L, mem.max(0) + 0.02 * L
    inside = seed & np.all((cen >= lo_) & (cen <= hi_), axis=1)
    cut |= inside
    if cut.sum() < prm['min_faces']:
        raise RuntimeError(f'cut: canopy bulge too small ({int(cut.sum())} faces)')
    comps = [cl['m'] for cl in comps]
    for coll in (me.vertices, me.edges):
        coll.foreach_set('select', np.zeros(len(coll), bool))
    me.polygons.foreach_set('select', cut)
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.context.view_layer.objects.active = hull
    hull.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    try:
        bpy.ops.mesh.delete(type='FACE')
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')
    me.update()
    cc = cen[cut].mean(0)
    base_z = float(cen[cut][:, 2].min())
    rep['_cut_centres'] = cen[cut].copy()
    rep['cut_canopy'] = {'mode': prm['mode'], 'faces_cut': int(cut.sum()), 'components': [len(c) for c in comps[:5]],
                         'centre': [round(float(x), 3) for x in cc], 'base_z': round(base_z, 3)}
    return Vector((float(cc[0]), float(cp.y), float(cc[2]))), base_z


def build_frame_billboard(ship, B, eye_local, Lc, rep):
    """The painted frame PNG as ONE continuous band around the eye (own object + material).

    v37.41: the v37.39 build cut the PNG into dash / rail / pillar strips at three radii and the
    owner saw the cut lines ("it looks cut up on the frame"). Now a single grid covers the whole
    picture and only its RADIUS varies, blended smoothly: the dashboard rows sit close
    (FRAME_R['dash']), the rail rows far (FRAME_R['top']), the pillar columns between
    (FRAME_R['side']). Screen angles stay exact at the default eye (pitch over the PNG height,
    yaw over its width), so the artist's composition holds and the head parallaxes against
    real depth - without a seam anywhere. Cells whose pixels are fully transparent are skipped.
    """
    src = os.path.join(REPO, FRAME_PNG[ship])
    img = bpy.data.images.load(src)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)                      # row 0 = bottom of the picture (Blender)
    rgb = px[..., :3]
    a = px[..., 3:4]
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    glow = np.clip((sat * mx - 0.10) / 0.35, 0, 1) ** 1.2
    glow = np.maximum(glow, np.clip((mx - 0.80) / 0.2, 0, 1))
    emis = np.concatenate([rgb * glow[..., None] * FRAME_EMIS_GAIN, a], 2).clip(0, 1)
    eimg = bpy.data.images.new(f'{ship}_frame_emis', W, H, alpha=True)
    eimg.pixels.foreach_set(emis.astype(np.float32).ravel())
    eimg.filepath_raw = os.path.join(ATLAS_DIR, f'{ship}_frame_emis.png')
    eimg.file_format = 'PNG'
    eimg.save()
    eimg.pack()
    img.pack()
    # where the art has its dashboard rows, rail rows and pillar columns (by alpha coverage)
    op = (px[..., 3] > 0.5)
    row_cov = op.mean(1)                          # per row (bottom -> top)
    col_cov = op[int(0.30 * H):int(0.70 * H)].mean(0)   # per column, middle rows only
    j = 0
    while j < H and row_cov[j] > 0.15:
        j += 1
    v_dash = j / H
    j = H - 1
    while j >= 0 and row_cov[j] > 0.15:
        j -= 1
    v_top = (j + 1) / H
    i = 0
    while i < W and col_cov[i] > 0.5:
        i += 1
    u_left = i / W
    i = W - 1
    while i >= 0 and col_cov[i] > 0.5:
        i -= 1
    u_right = (i + 1) / W
    rep['frame_art'] = {'png': FRAME_PNG[ship], 'size': [W, H], 'v_dash': round(v_dash, 3), 'v_top': round(v_top, 3),
                        'u_left': round(u_left, 3), 'u_right': round(u_right, 3), 'band': 'continuous'}

    def sstep(e0, e1, x):
        t = (x - e0) / (e1 - e0) if e1 != e0 else (1.0 if x >= e1 else 0.0)
        t = max(0.0, min(1.0, t))
        return t * t * (3 - 2 * t)

    def radius(u, v):
        w_dash = sstep(v_dash + 0.08, v_dash - 0.02, v) if v_dash > 0.02 else 0.0
        w_top = sstep(v_top - 0.08, v_top + 0.02, v) if v_top < 0.98 else 0.0
        r_mid = FRAME_R['side'] + (FRAME_R['top'] - FRAME_R['side']) * w_top
        return (r_mid + (FRAME_R['dash'] - r_mid) * w_dash) * Lc

    h = math.radians(FRAME_HFOV / 2)
    NU, NV = 96, 48
    # per-cell alpha presence (skip fully transparent cells)
    cell_a = np.zeros((NV, NU), bool)
    for jj in range(NV):
        y0, y1 = int(jj * H / NV), max(int(jj * H / NV) + 1, int((jj + 1) * H / NV))
        for ii in range(NU):
            x0, x1 = int(ii * W / NU), max(int(ii * W / NU) + 1, int((ii + 1) * W / NU))
            cell_a[jj, ii] = bool(px[y0:y1, x0:x1, 3].max() > 0.02)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = [[None] * (NU + 1) for _ in range(NV + 1)]

    def vert(jj, ii):
        if grid[jj][ii] is None:
            uu, vv = ii / NU, jj / NV
            R = radius(uu, vv)
            z = R * math.tan(math.radians(-FRAME_VFOV / 2 + FRAME_VFOV * vv))
            yaw = -h + 2 * h * uu
            p_ = Vector((eye_local.x + R * math.cos(yaw), eye_local.y + R * math.sin(yaw), eye_local.z + z))
            grid[jj][ii] = (bm.verts.new(B.to_world(p_)), uu, vv)
        return grid[jj][ii]

    n_faces = 0
    for jj in range(NV):
        for ii in range(NU):
            if not cell_a[jj, ii]:
                continue
            a_, b_, c_, d_ = vert(jj, ii), vert(jj, ii + 1), vert(jj + 1, ii + 1), vert(jj + 1, ii)
            try:
                f = bm.faces.new((a_[0], b_[0], c_[0], d_[0]))     # wound to face the eye
            except ValueError:
                continue
            for l, (v0_, uu, vv) in zip(f.loops, (a_, b_, c_, d_)):
                l[uvl].uv = (uu, vv)
            n_faces += 1
    rep['frame_art']['faces'] = n_faces
    fmesh = bpy.data.meshes.new('cockpit_frame')
    bm.to_mesh(fmesh)
    bm.free()
    fmat = bpy.data.materials.new('cockpit_frame')
    fmat.use_nodes = True
    nt = fmat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = new_image_node(nt, img)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    etex = new_image_node(nt, eimg)
    nt.links.new(etex.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.55
    bsdf.inputs['Metallic'].default_value = 0.2
    fmat.blend_method = 'BLEND'
    fmat.use_backface_culling = True
    fmesh.materials.append(fmat)
    fobj = bpy.data.objects.new('cockpit_frame', fmesh)
    bpy.context.scene.collection.objects.link(fobj)
    return fobj


def build_open_canopy(hull, cp, L, prm, rep):
    """Find the open cockpit cavity around cp, loft a glass dome over its rim and JOIN it into
    the hull (dome faces land at the end of the polygon list). Returns the dome face count."""
    from mathutils.bvhtree import BVHTree
    me = hull.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm, epsilon=0.0)
    bm.free()
    top = max((hull.matrix_world @ Vector(c)).z for c in hull.bound_box)
    n = 96
    half = prm['win'] * L
    xs = np.linspace(cp.x - half, cp.x + half, n)
    ys = np.linspace(cp.y - half, cp.y + half, n)
    zh = np.full((n, n), np.nan, np.float32)
    down = Vector((0, 0, -1))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            h = bvh.ray_cast(Vector((float(x), float(y), top + 0.5 * L)), down)
            if h[0] is not None:
                zh[j, i] = h[0].z
    have = ~np.isnan(zh)
    if prm.get('cut_centres') is not None:
        # a cut canopy: the hole IS the footprint of the faces we deleted (a depth test fails
        # both ways - the deck sits at the bulge's base, and Meshy models a shallow interior
        # blob right under the glass)
        from mathutils.kdtree import KDTree as _KDc
        ccs = np.asarray(prm['cut_centres'], np.float32)
        kdc = _KDc(len(ccs))
        for i_, c_ in enumerate(ccs):
            kdc.insert(Vector((float(c_[0]), float(c_[1]), 0.0)), i_)
        kdc.balance()
        cell0 = float(xs[1] - xs[0])
        cav = np.zeros((n, n), bool)
        for j, y in enumerate(ys):
            for i, x in enumerate(xs):
                if kdc.find(Vector((float(x), float(y), 0.0)))[2] < 1.6 * cell0:
                    cav[j, i] = True
        cav &= have
        ref1 = float(prm['cut_base_z'])
    elif prm.get('method', 'pct') == 'adapt':
        # ADAPT (thin deltas - Vortex): a cell is cavity when the highest surface within
        # local_r stands above it by half of the deepest drop found near the marker. The
        # window-wide percentile below reads a flat wing top as cavity on such a hull.
        gx, gy = np.meshgrid(xs, ys)
        rr = np.hypot(gx - cp.x, gy - cp.y)
        cell0 = float(xs[1] - xs[0])
        k = max(1, int(round(prm.get('local_r', 0.06) * L / cell0)))
        zf = np.where(have, zh, -1e9)
        zmax = zf.copy()
        for sh_ in range(1, k + 1):
            zmax[:, sh_:] = np.maximum(zmax[:, sh_:], zf[:, :-sh_])
            zmax[:, :-sh_] = np.maximum(zmax[:, :-sh_], zf[:, sh_:])
        z2 = zmax.copy()
        for sh_ in range(1, k + 1):
            z2[sh_:, :] = np.maximum(z2[sh_:, :], zmax[:-sh_, :])
            z2[:-sh_, :] = np.maximum(z2[:-sh_, :], zmax[sh_:, :])
        dd = z2 - zh
        near_ = have & (rr < 0.12 * L)
        dmax = float(np.percentile(dd[near_], 98)) if near_.any() else 0.0
        thr = max(prm['depth'] * L, prm.get('adapt_frac', 0.5) * dmax)
        cav = have & (dd > thr) & (rr < 0.24 * L)
        ref1 = float(np.nanmedian(np.where(cav, z2, np.nan))) if cav.any() else float(np.nanpercentile(zh, 80))
        rep['cavity_thr'] = {'method': 'adapt', 'dmax': round(dmax, 3), 'thr': round(thr, 3)}
    else:
        # PCT (default): the deck reference is the window's 80th percentile height and cavity
        # is anything `depth` below it, within reach of the marker. Right for a fuselage pit
        # (Slayer, Puncture) ; wrong for a thin delta whose wings sit below the spine.
        gx, gy = np.meshgrid(xs, ys)
        rr = np.hypot(gx - cp.x, gy - cp.y)
        ref1 = float(np.nanpercentile(zh, 80))
        cav = have & (zh < ref1 - prm['depth'] * L) & (rr < 0.30 * L)
        rep['cavity_thr'] = {'method': 'pct', 'ref': round(ref1, 3), 'depth': round(prm['depth'] * L, 3)}
    # diagnostic: the height grid (dark = low) with the cavity mask in red and the marker in yellow
    try:
        _z = np.where(have, zh, np.nan)
        _lo, _hi = float(np.nanmin(_z)), float(np.nanmax(_z))
        _g = np.clip((_z - _lo) / max(1e-6, _hi - _lo), 0, 1)
        _img = np.zeros((n, n, 4), np.float32)
        _img[..., 0] = _img[..., 1] = _img[..., 2] = np.nan_to_num(_g)
        _img[..., 3] = 1.0
        _img[cav, 0] = 1.0
        _img[cav, 1] *= 0.4
        _img[cav, 2] *= 0.4
        ci_, cj_ = int(np.argmin(np.abs(xs - cp.x))), int(np.argmin(np.abs(ys - cp.y)))
        _img[max(0, cj_ - 1):cj_ + 2, max(0, ci_ - 1):ci_ + 2] = (1, 1, 0, 1)
        _im = bpy.data.images.new('cavity_dbg', n, n, alpha=True)
        _im.pixels.foreach_set(_img.ravel())
        _im.filepath_raw = os.path.join(REPORT_DIR, f'{rep["ship"]}_cavity.png')
        _im.file_format = 'PNG'
        _im.save()
    except Exception as _e:
        print('cavity dbg failed', _e)
    # connected cavity components (4-neighbour) ; take the one nearest the marker
    lab = np.zeros((n, n), np.int32)
    comps = []
    for j in range(n):
        for i in range(n):
            if cav[j, i] and lab[j, i] == 0:
                cid = len(comps) + 1
                stack = [(j, i)]
                cells = []
                lab[j, i] = cid
                while stack:
                    a, b = stack.pop()
                    cells.append((a, b))
                    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        a2, b2 = a + da, b + db
                        if 0 <= a2 < n and 0 <= b2 < n and cav[a2, b2] and lab[a2, b2] == 0:
                            lab[a2, b2] = cid
                            stack.append((a2, b2))
                comps.append(cells)
    if not comps:
        raise RuntimeError('open canopy: no cavity found around cockpit1')
    ci, cj = int(np.argmin(np.abs(xs - cp.x))), int(np.argmin(np.abs(ys - cp.y)))
    cell = (xs[1] - xs[0])

    def comp_score(cells):
        arr = np.array(cells)
        dmin = np.min(np.hypot(arr[:, 0] - cj, arr[:, 1] - ci)) * cell
        return (dmin > 0.12 * L, -len(cells))          # near ones first, then the biggest

    comps.sort(key=comp_score)
    cells = comps[0]
    cav[:] = False
    for a, b in cells:
        cav[a, b] = True
    # rim ring: cells outside the cavity touching it
    ring = np.zeros((n, n), bool)
    for a, b in cells:
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            a2, b2 = a + da, b + db
            if 0 <= a2 < n and 0 <= b2 < n and not cav[a2, b2] and have[a2, b2]:
                ring[a2, b2] = True
    rj, ri = np.nonzero(ring)
    rp = np.stack([xs[ri], ys[rj], zh[rj, ri]], 1)
    cx, cy = float(np.mean(xs[[b for a, b in cells]])), float(np.mean(ys[[a for a, b in cells]]))
    cy = float(cp.y)                                   # the cockpit sits on the symmetry plane
    N = prm['n_theta']
    ang = np.arctan2(rp[:, 1] - cy, rp[:, 0] - cx)
    rad = np.hypot(rp[:, 0] - cx, rp[:, 1] - cy)
    bins = ((ang + np.pi) / (2 * np.pi) * N).astype(int) % N
    rmax = np.full(N, np.nan)
    zat = np.full(N, np.nan)
    for b_ in range(N):
        m_ = bins == b_
        if m_.any():
            k_ = int(np.argmax(rad[m_]))
            rmax[b_] = rad[m_][k_]
            zat[b_] = rp[m_][k_, 2]
    idx = np.arange(N)
    good = ~np.isnan(rmax)
    rmax = np.interp(idx, idx[good], rmax[good], period=N)
    zat = np.interp(idx, idx[good], zat[good], period=N)
    for _ in range(2):
        rmax = (np.roll(rmax, 1) + rmax + np.roll(rmax, -1)) / 3.0
        zat = (np.roll(zat, 1) + zat + np.roll(zat, -1)) / 3.0
    mir = (N - 1 - idx) % N                            # theta pairs with -theta (bin symmetry)
    rmax = 0.5 * (rmax + rmax[mir])
    zat = 0.5 * (zat + zat[mir])
    theta = (idx + 0.5) / N * 2 * np.pi - np.pi
    base = np.stack([cx + rmax * np.cos(theta), cy + rmax * np.sin(theta), zat], 1)
    rim_w = float(rmax[np.abs(np.sin(theta)) > 0.7].mean() * 2) if (np.abs(np.sin(theta)) > 0.7).any() else float(rmax.mean() * 2)
    rim_l = float(rmax[np.abs(np.cos(theta)) > 0.7].mean() * 2) if (np.abs(np.cos(theta)) > 0.7).any() else float(rmax.mean() * 2)
    Hd = prm['dome_h'] * rim_w
    apex = Vector((cx - prm['apex_fwd'] * rim_l, cy, float(zat.max()) + Hd))   # forward is -X
    # loft: rings from the rim (t=0) to the apex (t=1)
    M = prm['rings']
    dm = bmesh.new()
    rings = []
    for k in range(M):
        t = k / M
        rr = math.cos(t * math.pi / 2) ** 0.85
        zz = math.sin(t * math.pi / 2)
        ring_v = []
        for i_ in range(N):
            bx, by, bz = base[i_]
            px = apex.x + (bx - apex.x) * rr
            py = apex.y + (by - apex.y) * rr
            pz = bz + (apex.z - bz) * zz
            ring_v.append(dm.verts.new((px, py, pz)))
        rings.append(ring_v)
    top_v = dm.verts.new(apex)
    for k in range(M - 1):
        for i_ in range(N):
            a, b = rings[k][i_], rings[k][(i_ + 1) % N]
            c, d_ = rings[k + 1][(i_ + 1) % N], rings[k + 1][i_]
            try:
                dm.faces.new((a, b, c, d_))
            except ValueError:
                pass
    for i_ in range(N):
        try:
            dm.faces.new((rings[M - 1][i_], rings[M - 1][(i_ + 1) % N], top_v))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(dm, faces=dm.faces[:])
    dmesh = bpy.data.meshes.new('dome')
    dm.to_mesh(dmesh)
    n_faces = len(dmesh.polygons)
    dm.free()
    dmesh.uv_layers.new(name=me.uv_layers.active.name if me.uv_layers.active else 'UVMap')
    for mtl in me.materials:
        dmesh.materials.append(mtl)
    dobj = bpy.data.objects.new('dome', dmesh)
    bpy.context.scene.collection.objects.link(dobj)
    bpy.ops.object.select_all(action='DESELECT')
    dobj.select_set(True)
    hull.select_set(True)
    bpy.context.view_layer.objects.active = hull
    bpy.ops.object.join()
    rep['open_canopy'] = {'cavity_cells': len(cells), 'rim_w': round(rim_w, 3), 'rim_l': round(rim_l, 3),
                          'dome_h': round(Hd, 3), 'apex': [round(float(x), 3) for x in apex], 'dome_faces': n_faces,
                          'ref_z': round(ref1, 3), 'rim_z': [round(float(zat.min()), 3), round(float(zat.max()), 3)]}
    return n_faces


def new_image_node(nt, img):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    return n


# =============================================================== process ==
def process(ship):
    t0 = time.time()
    rep = {'ship': ship}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(IN_DIR, ship + '.glb'), merge_vertices=True)
    sc = bpy.context.scene
    vl = bpy.context.view_layer
    hull = [o for o in sc.objects if o.type == 'MESH'][0]
    empties = [o for o in sc.objects if o.type == 'EMPTY']
    for o in [hull] + empties:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    hull.select_set(True)
    vl.objects.active = hull
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    markers = {}
    for o in empties:
        if any(o.name.startswith(p) for p in ('gun', 'thruster', 'cockpit')):
            markers[o.name] = o
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    hull.name = 'mesh_0'
    me = hull.data
    bb = [Vector(c) for c in hull.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)])
    hi = Vector([max(v[i] for v in bb) for i in range(3)])
    L = max(hi - lo)
    ctr = (lo + hi) / 2
    # CANONICAL ship axes: every hull faces -X in Blender space (same faceRotY in the game
    # for all seven ; the four mirror-perfect hulls confirm it). Deriving forward from the
    # gun markers skewed the frame by up to 24 deg on single-gun hulls (Pyro / Tracker /
    # Puncture) and yawed their whole cockpit inside the hull. ship_symmetry.py re-centres
    # the hull on its true symmetry plane, so right = +Y is exact after that stage.
    fwd = Vector((-1, 0, 0))
    up = Vector((0, 0, 1))
    right = Vector((0, 1, 0))
    frame = Matrix([[fwd.x, right.x, 0, 0], [fwd.y, right.y, 0, 0], [fwd.z, right.z, 1, 0], [0, 0, 0, 1]])
    cp = markers['cockpit1'].matrix_world.translation.copy()
    n_dome = 0
    if ship in CUT_SHIPS:
        cprm = dict(CUT_CFG['default'])
        cprm.update(CUT_CFG.get(ship, {}))
        cp, cut_base_z = cut_canopy_bulge(hull, cp, L, cprm, rep)    # the cavity search starts from the cut's centre
        me = hull.data
    else:
        cut_base_z = None
    if ship in OPEN_SHIPS:
        oprm = dict(OPEN_CFG['default'])
        oprm.update(OPEN_CFG.get(ship, {}))
        oprm['cut_base_z'] = cut_base_z
        oprm['cut_centres'] = rep.pop('_cut_centres', None)
        n_dome = build_open_canopy(hull, cp, L, oprm, rep)
        me = hull.data
        bb = [Vector(c) for c in hull.bound_box]
        lo = Vector([min(v[i] for v in bb) for i in range(3)])
        hi = Vector([max(v[i] for v in bb) for i in range(3)])
        L = max(hi - lo)
        ctr = (lo + hi) / 2
        cp = Vector(rep['open_canopy']['apex']) - Vector((0, 0, 0.3 * rep['open_canopy']['dome_h']))

    # ---------------- canopy faces --------------------------------------------------------
    prm = dict(CANOPY['default'])
    prm.update(CANOPY.get(ship, {}))
    mat0 = me.materials[0]
    img = next(n.image for n in mat0.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)
    nP = len(me.polygons)
    ls = np.empty(nP, np.int32)
    lt = np.empty(nP, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    me.polygons.foreach_get('loop_total', lt)
    uvs = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    cen = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('center', cen)
    cen = cen.reshape(-1, 3)
    nrm = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    cum = np.cumsum(uvs, axis=0)
    cs = np.concatenate([[0.0], cum[:, 0]])
    ct = np.concatenate([[0.0], cum[:, 1]])
    fu = (cs[ls + lt] - cs[ls]) / lt
    fv = (ct[ls + lt] - ct[ls]) / lt
    ix = (np.mod(fu, 1.0) * W).astype(int).clip(0, W - 1)
    iy = (np.mod(fv, 1.0) * H).astype(int).clip(0, H - 1)
    col = px[iy, ix, :3]
    mx = col.max(1)
    mn = col.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    # hue
    r_, g_, b_ = col[:, 0], col[:, 1], col[:, 2]
    dlt = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r_, ((g_ - b_) / dlt) % 6, np.where(mx == g_, (b_ - r_) / dlt + 2, (r_ - g_) / dlt + 4)) / 6.0
    d = np.linalg.norm(cen - np.array(cp), axis=1)
    R = prm['R'] * L
    seed = (d < R) & (sat > prm['sat']) & (mx > 0.10) & (nrm[:, 2] > -0.05)
    if n_dome:                                   # open cockpit: the joined dome IS the canopy
        seed = np.zeros(nP, bool)
        seed[nP - n_dome:] = True
        R = max(R, float(np.linalg.norm(cen[seed] - np.array(cp), axis=1).max()) * 1.05)
    edge_faces = {}
    for p in me.polygons:
        if seed[p.index]:
            for e in p.edge_keys:
                edge_faces.setdefault(e, []).append(p.index)
    adj = {}
    for fs in edge_faces.values():
        for a in fs:
            for b in fs:
                if a != b:
                    adj.setdefault(a, set()).add(b)
    seen = set()
    comps = []
    for f0 in np.nonzero(seed)[0]:
        f0 = int(f0)
        if f0 in seen:
            continue
        stack = [f0]
        comp = []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            stack.extend(adj.get(x, ()))
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    canopy = np.zeros(nP, bool)
    if comps:
        canopy[comps[0]] = True
        if prm['mode'] == 'union':
            h0 = float(np.median(hue[comps[0]]))
            for comp in comps[1:]:
                if len(comp) < prm['min_comp']:
                    continue
                hc = float(np.median(hue[comp]))
                dh = min(abs(hc - h0), 1 - abs(hc - h0))
                if dh < prm['hue_tol']:
                    canopy[comp] = True
    all_edge_faces = {}
    for p in me.polygons:
        for e in p.edge_keys:
            all_edge_faces.setdefault(e, []).append(p.index)
    grow = np.zeros(nP, bool)
    for p in me.polygons:
        if canopy[p.index]:
            continue
        nb = sum(1 for e in p.edge_keys for q in all_edge_faces[e] if canopy[q])
        if nb >= 2 and sat[p.index] > 0.18 and d[p.index] < R:
            grow[p.index] = True
    canopy |= grow
    # enclosed islands: hull faces completely surrounded by canopy faces (painted frame
    # slivers, dark decals inside the glass) would float as opaque shards in the pilot's
    # view — fold them into the glass. Flood the non-canopy faces from far outside ; anything
    # not reached is an island.
    face_edges = [p.edge_keys for p in me.polygons]
    noncan = ~canopy
    reach = np.zeros(nP, bool)
    far = np.nonzero(noncan & (d > R * 1.3))[0]
    reach[far] = True
    stack = list(far)
    while stack:
        x = stack.pop()
        for e in face_edges[x]:
            for q in all_edge_faces[e]:
                if noncan[q] and not reach[q]:
                    reach[q] = True
                    stack.append(q)
    # only islands near the marker count (internal plates elsewhere are disconnected too) ;
    # they get the glass MATERIAL but never drive the cockpit dimensions or the rim.
    islands = noncan & ~reach & (d < R)
    if n_dome:
        islands[:] = False                       # a multi-shell Meshy hull has no 'enclosed' islands, only separate parts
    # ALL enclosed islands become glass. Keeping the dark ones opaque (painted frame bars)
    # was tried: the paint's frame lines are far finer than the mesh triangles, so they came
    # out as random black shards across the pane. A clean tinted pane wins.
    glass_faces = canopy | islands
    _isl_opaque = 0
    # MIRROR the glass region across the hull's symmetry plane (y = ctr.y after
    # ship_symmetry.py): a face whose mirrored centre lands on a glass face is glass too, so
    # both canopy edges match from the seat even where the texture threshold caught only
    # one side.
    from mathutils.kdtree import KDTree as _KD
    gidx0 = np.nonzero(glass_faces)[0]
    kd0 = _KD(len(gidx0))
    for k_, gi_ in enumerate(gidx0):
        kd0.insert(Vector(cen[gi_]), k_)
    kd0.balance()
    fsz = np.sqrt(np.maximum(1e-12, np.array([p.area for p in me.polygons])))
    added = 0
    for fi in np.nonzero(~glass_faces & (d < R * 1.3))[0]:
        m_c = Vector((cen[fi][0], 2 * ctr.y - cen[fi][1], cen[fi][2]))
        if kd0.find(m_c)[2] < 0.9 * max(fsz[fi], 0.004 * L):
            glass_faces[fi] = True
            added += 1
    rep['glass_mirrored_in'] = int(added)
    rep['canopy'] = {'faces': int(canopy.sum()), 'islands_folded_in': int(islands.sum()), 'islands_kept_opaque': _isl_opaque,
                     'components': [len(c) for c in comps[:6]], 'params': prm}
    if canopy.sum() < 20:
        raise RuntimeError(f'{ship}: canopy detection failed ({canopy.sum()} faces)')

    # canopy frame in ship-local coords
    inv = frame.transposed()
    ccw = np.array([inv @ Vector(c) for c in cen[canopy]])   # local (fwd, right, up) of canopy face centres
    # the cockpit sits exactly on the hull's symmetry plane (y = bbox centre after
    # ship_symmetry.py re-centres the hull), not on the centroid of the detected glass faces,
    # which is biased toward whichever side the texture threshold caught more of
    cf0, cr0 = float(ccw[:, 0].mean()), float(ctr.y)
    zmin, zmax = float(ccw[:, 2].min()), float(ccw[:, 2].max())
    Lc = float(ccw[:, 0].max() - ccw[:, 0].min())
    Wc = float(ccw[:, 1].max() - ccw[:, 1].min())
    Hc = max(zmax - zmin, 0.02 * L)
    origin = Vector((cf0, cr0, zmin))
    B = Builder(frame, origin)
    # tub depth below the rim: a seated pilot needs ~half the canopy width ; tall slit
    # windows (PYRO) must not drive it, and it can never reach the hull's underside.
    D = min(max(0.55 * Wc, 0.9 * Hc), 1.4 * Hc)
    D = min(D, 0.85 * max(0.02 * L, zmin - lo.z))
    # ...and by the hull skin right under the seat (engine pods hang far below a thin fuselage)
    _vz = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', _vz)
    _vz = _vz.reshape(-1, 3)
    _cw = B.to_world(Vector((0, 0, 0)))
    _near = (np.abs(_vz[:, 0] - _cw.x) < 0.12 * L) & (np.abs(_vz[:, 1] - _cw.y) < 0.35 * Wc)
    if _near.any():
        _floor = float(_vz[_near][:, 2].min())
        D = min(D, 0.8 * max(0.02 * L, zmin - _floor))
        rep['tub_floor_cap'] = round(_floor, 3)
    D *= COMPACT_DEPTH
    rep['canopy'].update({'Lc': round(Lc, 3), 'Wc': round(Wc, 3), 'Hc': round(Hc, 3), 'D': round(D, 3)})

    # ---------------- rim: POLAR OUTLINE of the glass ---------------------------------------
    # For each angle around the canopy centre take the farthest canopy VERTEX (max radius),
    # interpolate empty bins circularly, smooth. Every canopy here is star-shaped from its
    # centre, concave or not, and unlike a boundary-edge walk this can never pick an inner
    # island loop (the Blaster rail once traced a frame island and cut across the glass).
    vco = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', vco)
    vco = vco.reshape(-1, 3)
    cvidx = set()
    for p in me.polygons:
        if canopy[p.index]:
            cvidx.update(p.vertices)
    cvidx = np.array(sorted(cvidx), np.int64)
    cv = (vco[cvidx] - np.array(B.to_world(Vector((0, 0, 0))))) @ np.array(frame.to_3x3())
    N = 64
    ang = np.arctan2(cv[:, 1], cv[:, 0])
    rad = np.hypot(cv[:, 0], cv[:, 1])
    bins = ((ang + np.pi) / (2 * np.pi) * N).astype(int) % N
    rmax = np.full(N, np.nan)
    zat = np.full(N, np.nan)
    for b_ in range(N):
        m_ = bins == b_
        if m_.any():
            k_ = int(np.argmax(rad[m_]))
            rmax[b_] = rad[m_][k_]
            zat[b_] = cv[m_][k_, 2]
    idx = np.arange(N)
    good = ~np.isnan(rmax)
    rep['rim_bins_filled'] = int(good.sum())
    if good.sum() < 8:
        rmax = np.where(np.isnan(rmax), 0.5 * min(Lc, Wc), rmax)
        zat = np.where(np.isnan(zat), 0.0, zat)
        good = np.ones(N, bool)
    rmax = np.interp(idx, idx[good], rmax[good], period=N)
    zat = np.interp(idx, idx[good], zat[good], period=N)
    for _ in range(2):
        rmax = (np.roll(rmax, 1) + rmax + np.roll(rmax, -1)) / 3.0
        zat = (np.roll(zat, 1) + zat + np.roll(zat, -1)) / 3.0
    # mirror-symmetric outline: bin b (angle theta) pairs with the bin at -theta
    mir = (N - 1 - idx) % N
    rmax = 0.5 * (rmax + rmax[mir])
    zat = 0.5 * (zat + zat[mir])
    theta = (idx + 0.5) / N * 2 * np.pi - np.pi
    rim_rs = np.stack([rmax * np.cos(theta), rmax * np.sin(theta), zat], 1)   # CCW by construction
    rep['rim_verts'] = N
    rc = rim_rs[:, :2].mean(0)

    def ring(shrink, z, zfrac_of_rim=0.0, zcap=None):
        # zcap: the TUB must stay a basin - on a vertical slit window (PYRO) the glass edge
        # climbs to the canopy top and a tub lofted from it walls the pilot in. The rail
        # (zcap=None) still follows the true glass edge.
        pts = []
        for p in rim_rs:
            xy = rc + (p[:2] - rc) * shrink
            zr = p[2] if zcap is None else min(p[2], zcap)
            pts.append(Vector((xy[0], xy[1], zr * zfrac_of_rim + z)))
        return pts

    tub_center = Vector((rc[0], rc[1], -0.45 * D))

    # ---- hull surgery (edit-mode ops keep the custom normals) -------------------------------
    # (a) glass faces pointing INTO the cockpit render as translucent bands from the seat (and
    #     cull from outside) -> flip them.  (b) CARVE: hull faces that sit inside the tub volume
    #     are internal structure (Meshy hulls are full of it) and would wall the pilot in.
    def set_select_mode(mode):
        bpy.context.tool_settings.mesh_select_mode = (mode == 'VERT', mode == 'EDGE', mode == 'FACE')

    def edit_op(fn):
        bpy.context.view_layer.objects.active = hull
        hull.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        try:
            fn()
        finally:
            bpy.ops.object.mode_set(mode='OBJECT')

    def select_faces(mask):
        for coll in (me.vertices, me.edges):
            coll.foreach_set('select', np.zeros(len(coll), bool))
        me.polygons.foreach_set('select', mask)

    mi = np.empty(nP, np.int32)
    me.polygons.foreach_get('material_index', mi)
    mi[glass_faces] = len(me.materials)          # slot the glass material will take (appended below)
    me.polygons.foreach_set('material_index', mi)
    tcw = B.to_world(tub_center)
    inward = glass_faces & (((cen - np.array(tcw)) * nrm).sum(1) < 0)
    rep['glass_flipped_inward'] = int(inward.sum())
    if inward.any():
        set_select_mode('FACE')
        select_faces(inward)
        edit_op(lambda: bpy.ops.mesh.flip_normals())
    # point-in-polygon (rim, shrunk 8%) for every non-glass face centre, in local coords
    loc_all = (cen - np.array(B.to_world(Vector((0, 0, 0))))) @ np.array(frame.to_3x3())
    poly = rc + (rim_rs[:, :2] - rc) * 0.92
    px_, py_ = loc_all[:, 0], loc_all[:, 1]
    inside = np.zeros(nP, bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > py_) != (yj > py_)) & (px_ < (xj - xi) * (py_ - yi) / ((yj - yi) if yj != yi else 1e-12) + xi)
        inside ^= cond
        j = i
    # below the rim everything inside the footprint is interior ; above it (tall slit windows
    # like PYRO put the whole cockpit above zmin) only faces FAR from any glass are internal
    # structure — the window frame bars hug the glass and stay.
    from mathutils.kdtree import KDTree
    gidx = np.nonzero(glass_faces)[0]
    kd = KDTree(len(gidx))
    for k, gi_ in enumerate(gidx):
        kd.insert(Vector(cen[gi_]), k)
    kd.balance()
    cand = inside & ~glass_faces & (loc_all[:, 2] > -1.1 * D) & (loc_all[:, 2] < Hc + 0.02 * L)
    far_from_glass = np.zeros(nP, bool)
    thresh = 0.09 * max(Lc, Wc)
    for idx in np.nonzero(cand & (loc_all[:, 2] >= -0.02 * Hc))[0]:
        if kd.find(Vector(cen[idx]))[2] > thresh:
            far_from_glass[idx] = True
    carve = cand & ((loc_all[:, 2] < -0.02 * Hc) | far_from_glass)
    rep['carved_internal_faces'] = int(carve.sum())
    rep['carved_above_rim'] = int(far_from_glass.sum())
    if carve.any():
        set_select_mode('FACE')
        select_faces(carve)
        edit_op(lambda: bpy.ops.mesh.delete(type='FACE'))
    me.update()
    nP = len(me.polygons)
    # (c) BURIED faces around the cockpit: inner-shell plates whose front side lies inside the
    #     closed hull. Invisible from outside by definition, but they wall the pilot in (PYRO's
    #     nacelle) and clutter the view through the glass. Parity vote against a BVH of the hull.
    from mathutils.bvhtree import BVHTree
    bmh = bmesh.new()
    bmh.from_mesh(me)
    bmh.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bmh, epsilon=0.0)
    cen2 = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('center', cen2)
    cen2 = cen2.reshape(-1, 3)
    nrm2 = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('normal', nrm2)
    nrm2 = nrm2.reshape(-1, 3)
    mi2 = np.empty(nP, np.int32)
    me.polygons.foreach_get('material_index', mi2)
    loc2 = (cen2 - np.array(B.to_world(Vector((0, 0, 0))))) @ np.array(frame.to_3x3())
    box_m = ((loc2[:, 0] > -0.9 * Lc) & (loc2[:, 0] < 1.6 * Lc) & (np.abs(loc2[:, 1]) < 1.2 * Wc)
             & (loc2[:, 2] > -1.3 * D) & (loc2[:, 2] < Hc + 0.5 * D) & (mi2 != len(me.materials)))
    eps = 1e-4 * L
    buried = np.zeros(nP, bool)
    for idx in np.nonzero(box_m)[0]:
        n_ = Vector(nrm2[idx])
        if n_.length < 0.5:
            continue
        if inside_votes(bvh, Vector(cen2[idx]) + n_ * eps, eps) >= 6:
            buried[idx] = True
    bmh.free()
    rep['carved_buried_faces'] = int(buried.sum())
    rep['buried_candidates'] = int(box_m.sum())
    if buried.any():
        set_select_mode('FACE')
        select_faces(buried)
        edit_op(lambda: bpy.ops.mesh.delete(type='FACE'))
    me.update()
    nP = len(me.polygons)

    r0 = ring(0.975, -0.015 * Hc, zfrac_of_rim=1.0, zcap=0.30 * Hc)
    r1 = ring(0.90, -0.50 * D)
    r2 = ring(0.66, -D)
    tub_faces, vrings = B.loft([r0, r1, r2], region='metal', inward_center=tub_center)
    floor_faces = B.cap(vrings[-1], region='trim', inward_center=tub_center)
    # canopy RIM RAIL: a square-section tube riding just inside the glass edge, so the glass
    # boundary reads as a frame from the seat instead of a raw hull cut, and the canopy gets a
    # defined outline from outside.
    rail_pts = ring(0.988, -0.02 * Hc, zfrac_of_rim=1.0)
    rt = 0.03 * Wc
    # Only frame the LOW glass edge by default: on ridged glass (SLAYER) the edge climbs into
    # arches around the pilot's head. A tall greenhouse slit (PYRO) is the exception - there
    # the full outline IS the window frame, drawn thinner so it reads as mullions, not pipes.
    rail_full = ship in RAIL_FULL
    rail_zmax = Hc * 10 if rail_full else 0.35 * Hc
    if rail_full:
        rt *= 0.6
    for a, b in zip(rail_pts, rail_pts[1:] + rail_pts[:1]):
        dv = b - a
        ln = dv.length
        if ln < 1e-6 or max(a.z, b.z) > rail_zmax:
            continue
        yaw = math.atan2(dv.y, dv.x)
        pitch = -math.asin(max(-1.0, min(1.0, dv.z / ln)))
        B.box((a + b) / 2, (ln * 1.06, rt, rt), rot=(0, pitch, yaw), region='trim')

    # ---------------- furniture (local coords) ------------------------------------------------
    # The pilot sits just behind the canopy APEX so the helmet stays under the glass: profile the
    # glass top along the ship axis (centre strip only) and take its highest bin.
    ccl = ccw - np.array([cf0, cr0, zmin])
    strip = np.abs(ccl[:, 1]) < 0.18 * Wc
    xb = np.linspace(ccl[:, 0].min(), ccl[:, 0].max(), 15)
    prof = []
    for i in range(14):
        m_ = strip & (ccl[:, 0] >= xb[i]) & (ccl[:, 0] <= xb[i + 1])
        prof.append(float(ccl[m_, 2].max()) if m_.any() else -1.0)
    prof = np.array(prof)
    xa = float(((xb[:-1] + xb[1:]) / 2)[int(np.argmax(prof))])
    z_apex = float(prof.max())
    hr = 0.075 * Wc

    def glass_top(x):
        i = int(np.clip((x - xb[0]) / max(1e-9, xb[-1] - xb[0]) * 14, 0, 13))
        return float(prof[i]) if prof[i] > 0 else z_apex

    # ---- EYE PLACEMENT = the most OPEN forward view --------------------------------------
    # Recessed canopies (SLAYER's slot between two hull ridges, PUNCTURE's gun spine beside
    # the seat) wall the pilot in when the head sits low. Cast a fan of rays (yaw ±65°,
    # pitch −18..+28°) from candidate eye points against the NON-glass hull and keep the
    # candidate that sees the most sky/world, with the helmet still under the glass.
    from mathutils.bvhtree import BVHTree as _BVH
    bmv = bmesh.new()
    bmv.from_mesh(me)
    gslot = len(me.materials)
    _verts = [v.co.copy() for v in bmv.verts]
    _polys = [[v.index for v in f.verts] for f in bmv.faces if f.material_index != gslot]
    bvh_view = _BVH.FromPolygons(_verts, _polys, all_triangles=False, epsilon=0.0)
    bmv.free()
    yaws = np.radians(np.linspace(-65, 65, 14))
    pitches = np.radians(np.linspace(-18, 28, 7))
    F3 = frame.to_3x3()
    dirs_w = [F3 @ Vector((math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), math.sin(p))) for p in pitches for y in yaws]
    far = 2.5 * Lc
    best = None
    for xc in np.linspace(-0.33 * Lc, 0.02 * Lc, 8):
        zcap = glass_top(xc) - 1.7 * hr
        for zf in (0.35, 0.55, 0.75, 0.92):
            zc = min(zcap, max(0.12 * Hc, zf * Hc))
            eye_w = B.to_world(Vector((xc, 0, zc)))
            open_n = sum(1 for dw in dirs_w if bvh_view.ray_cast(eye_w, dw, far)[0] is None)
            score = open_n / len(dirs_w) - 0.04 * abs(xc / Lc)
            if best is None or score > best[0] + 1e-9:
                best = (score, float(xc), float(zc), open_n)
    eye_x, eye_z = best[1], best[2]
    sx = eye_x + 0.03 * Lc                                    # head sits 0.03 Lc behind the seat centre
    rep['pilot'] = {'seat_x': round(sx, 3), 'eye_x': round(eye_x, 3), 'eye_z': round(eye_z, 3),
                    'apex_x': round(xa, 3), 'z_apex': round(z_apex, 3),
                    'open_frac': round(best[3] / len(dirs_w), 3), 'glass_top_at_eye': round(glass_top(eye_x), 3)}
    # ---- glass orientation against the EYE: from the seat no pane may face the pilot -------------
    # (the earlier flip used the tub centre ; a windscreen pane far down the nose can pass that test
    #  and still face the eye, showing as a translucent band across the view - Puncture had two)
    _eye_w = B.to_world(Vector((eye_x, 0, eye_z)))
    nP = len(me.polygons)
    cen3 = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('center', cen3)
    cen3 = cen3.reshape(-1, 3)
    nrm3 = np.empty(nP * 3, np.float32)
    me.polygons.foreach_get('normal', nrm3)
    nrm3 = nrm3.reshape(-1, 3)
    mi3 = np.empty(nP, np.int32)
    me.polygons.foreach_get('material_index', mi3)
    faces_eye = (mi3 == len(me.materials)) & (((np.array(_eye_w) - cen3) * nrm3).sum(1) > 0)
    rep['glass_flipped_vs_eye'] = int(faces_eye.sum())
    if faces_eye.any():
        set_select_mode('FACE')
        select_faces(faces_eye)
        edit_op(lambda: bpy.ops.mesh.flip_normals())
        me.update()
    bv = 0.06 * min(Wc, D)          # bevel radius
    B.box((sx, 0, -0.56 * D), (0.24 * Lc, 0.36 * Wc, 0.09 * D), region='seat', bevel=bv)              # pan
    B.box((sx - 0.12 * Lc, 0, -0.30 * D), (0.05 * Lc, 0.36 * Wc, 0.50 * D), rot=(0, math.radians(-12), 0), region='seat', bevel=bv * 0.6)  # backrest
    B.box((sx - 0.13 * Lc, 0, 0.02 * D), (0.05 * Lc, 0.16 * Wc, 0.14 * D), rot=(0, math.radians(-12), 0), region='seat', bevel=bv * 0.5)  # headrest
    B.box((sx - 0.02 * Lc, 0.20 * Wc, -0.42 * D), (0.22 * Lc, 0.04 * Wc, 0.16 * D), region='trim', bevel=bv * 0.3)   # armrests
    B.box((sx - 0.02 * Lc, -0.20 * Wc, -0.42 * D), (0.22 * Lc, 0.04 * Wc, 0.16 * D), region='trim', bevel=bv * 0.3)
    # dash: main slab tilted toward the pilot + two angled wings. On a tall greenhouse window
    # (TALL_DASH) the eye sits high above the rim and a bubble-canopy dash ends up far below
    # the sightline, so the slab grows upward into an instrument STACK with a second and third
    # row of screens on its face - the bomber-cockpit look the window asks for.
    dx = 0.30 * Lc
    tilt = math.radians(18)
    tall = ship in TALL_DASH
    dash_bot = -0.50 * D
    dash_top = (0.50 * eye_z) if tall else (-0.14 * D)
    dash_h = dash_top - dash_bot
    dash_cz = 0.5 * (dash_top + dash_bot)
    dash_c = Vector((dx, 0, dash_cz))
    n_top = Vector((-math.sin(tilt), 0, math.cos(tilt)))     # slab top-face normal (toward pilot)
    n_front = Vector((-math.cos(tilt), 0, -math.sin(tilt)))  # slab face toward the pilot
    B.box(dash_c, (0.18 * Lc, 0.70 * Wc, dash_h), rot=(0, tilt, 0), region='metal', bevel=bv * 0.5)
    for sgn in (1, -1):
        B.box((dx - 0.09 * Lc, sgn * 0.40 * Wc, dash_cz - 0.02 * D), (0.16 * Lc, 0.12 * Wc, dash_h * 0.85),
              rot=(0, math.radians(16), sgn * math.radians(-32)), region='metal', bevel=bv * 0.4)
    # screens: thin plates lying on the tilted top
    top_c = dash_c + n_top * (dash_h / 2)
    for i, (yy, rg) in enumerate(((-0.22, 'scrB'), (0.0, 'screen'), (0.22, 'scrC'))):
        c = top_c + Vector((0, yy * Wc, 0)) + n_top * (0.006 * D)
        B.box(c, (0.11 * Lc, 0.18 * Wc, 0.012 * D), rot=(0, tilt, 0), region=rg)
    if tall:
        # instrument stack: two more rows on the face of the slab
        for zf, rgs in ((0.28, ('scrD', 'scrC', 'scrB')), (-0.08, ('screen', 'scrD', 'screen'))):
            for yy, rg in zip((-0.22, 0.0, 0.22), rgs):
                c = dash_c + n_front * (0.09 * Lc + 0.006 * D) + Vector((0, yy * Wc, 0)) + n_top * (zf * dash_h)
                B.box(c, (0.012 * D, 0.18 * Wc, 0.16 * dash_h), rot=(0, tilt, 0), region=rg)
        for yy in (-0.33, 0.33):
            c = dash_c + n_front * (0.09 * Lc + 0.006 * D) + Vector((0, yy * Wc, 0)) + n_top * (0.10 * dash_h)
            B.box(c, (0.012 * D, 0.05 * Wc, 0.5 * dash_h), rot=(0, tilt, 0), region='glow')
    # glow strip along the dash's top-front edge
    edge_c = dash_c + n_front * (0.09 * Lc) + n_top * (dash_h / 2 - 0.01 * D)
    B.box(edge_c, (0.010 * Lc, 0.60 * Wc, 0.018 * D), rot=(0, tilt, 0), region='glow')
    # glareshield hood over the dash's far edge (short, so it never hides the screens from the seat)
    hood_c = dash_c + Vector((math.cos(tilt), 0, math.sin(tilt))) * (0.06 * Lc) + n_top * (dash_h / 2 + 0.03 * D)
    B.box(hood_c, (0.07 * Lc, 0.76 * Wc, 0.014 * D), rot=(0, tilt + math.radians(6), 0), region='trim', bevel=bv * 0.2)
    # centre pedestal between the knees with its own small screen, and a throttle lever on the left console
    B.box((sx + 0.13 * Lc, 0, -0.50 * D), (0.16 * Lc, 0.10 * Wc, 0.14 * D), region='metal', bevel=bv * 0.3)
    B.box((sx + 0.13 * Lc, 0, -0.425 * D), (0.10 * Lc, 0.07 * Wc, 0.012 * D), region='scrD')
    B.box((sx + 0.10 * Lc, 0.36 * Wc, -0.29 * D), (0.012 * Lc, 0.02 * Wc, 0.10 * D), rot=(0, math.radians(-25), 0), region='trim')
    B.box((sx + 0.10 * Lc - 0.02 * Lc, 0.36 * Wc, -0.245 * D), (0.03 * Lc, 0.035 * Wc, 0.02 * D), region='seat')
    # side consoles: SILLS from the armrest out to the tub wall and the whole tub length, at
    # elbow height - no empty floor beside the seat. Screens, keypads, two switch rows and a
    # row of rotary knobs on each ; a raised lip along the inner edge.
    for sgn in (1, -1):
        cx_, cy_ = -0.02 * Lc, sgn * 0.345 * Wc
        B.box((cx_, cy_, -0.40 * D), (0.60 * Lc, 0.31 * Wc, 0.14 * D), region='metal', bevel=bv * 0.4)   # sill
        B.box((cx_, sgn * 0.20 * Wc, -0.33 * D), (0.60 * Lc, 0.02 * Wc, 0.03 * D), region='trim')         # inner lip
        B.box((cx_ + 0.12 * Lc, cy_, -0.325 * D), (0.14 * Lc, 0.11 * Wc, 0.012 * D), region='scrD')       # screen
        B.box((cx_ - 0.16 * Lc, cy_, -0.325 * D), (0.10 * Lc, 0.11 * Wc, 0.012 * D), region='screen')     # screen 2
        for k in range(4):
            B.box((cx_ - 0.02 * Lc + k * 0.04 * Lc, cy_ - sgn * 0.06 * Wc, -0.325 * D), (0.025 * Lc, 0.04 * Wc, 0.012 * D), region='glow')
        # two rows of toggle switches along the outer edge, every third one lit
        for k in range(9):
            for rr, yo in ((0, 0.10), (1, 0.13)):
                lit = ((k + rr) % 3 == 0)
                B.box((cx_ - 0.24 * Lc + k * 0.05 * Lc, cy_ + sgn * yo * Wc, -0.322 * D),
                      (0.014 * Lc, 0.012 * Wc, 0.016 * D), region='glow' if lit else 'trim')
        # rotary knobs along the inner edge, behind the elbow
        for k in range(5):
            B.box((cx_ - 0.26 * Lc + k * 0.03 * Lc, cy_ - sgn * 0.11 * Wc, -0.318 * D), (0.016 * Lc, 0.025 * Wc, 0.024 * D), region='trim', bevel=bv * 0.3)
    # footwell: a raised grating deck between the consoles, rudder pedals at its far end
    B.box((0.12 * Lc, 0, -0.86 * D), (0.46 * Lc, 0.38 * Wc, 0.05 * D), region='trim', bevel=bv * 0.2)
    for sgn in (1, -1):
        B.box((0.30 * Lc, sgn * 0.07 * Wc, -0.78 * D), (0.05 * Lc, 0.07 * Wc, 0.10 * D), rot=(0, math.radians(-30), 0), region='seat', bevel=bv * 0.3)
    # ribs along the tub walls (frames from the floor to just under the rim)
    for xr in (-0.22, 0.0, 0.22):
        for sgn in (1, -1):
            B.box((xr * Lc, sgn * 0.475 * Wc, -0.52 * D), (0.03 * Lc, 0.03 * Wc, 0.92 * D), region='metal', bevel=bv * 0.2)
    # control stick on the pedestal: column leaning back toward the pilot, grip on top
    B.box((sx + 0.15 * Lc, 0, -0.30 * D), (0.014 * Lc, 0.012 * Wc, 0.26 * D), rot=(0, math.radians(-12), 0), region='trim')
    B.box((sx + 0.125 * Lc, 0, -0.17 * D), (0.03 * Lc, 0.03 * Wc, 0.06 * D), rot=(0, math.radians(-12), 0), region='seat', bevel=bv * 0.3)
    B.box((sx + 0.12 * Lc, 0, -0.145 * D), (0.012 * Lc, 0.012 * Wc, 0.008 * D), rot=(0, math.radians(-12), 0), region='glow')
    # harness straps down the backrest
    for yo in (0.09, -0.09):
        B.box((sx - 0.115 * Lc, yo * Wc, -0.30 * D), (0.008 * Lc, 0.05 * Wc, 0.46 * D), rot=(0, math.radians(-12), 0), region='suit')
    # rear bulkhead right behind the seat, with avionics racks filling the gap to it
    bx = min(-0.26 * Lc, sx - 0.20 * Lc)
    B.box((bx, 0, -0.40 * D), (0.04 * Lc, 0.70 * Wc, 0.55 * D), region='trim', bevel=bv * 0.3)
    B.box((bx + 0.025 * Lc, 0.22 * Wc, -0.30 * D), (0.03 * Lc, 0.14 * Wc, 0.22 * D), region='metal')
    B.box((bx + 0.025 * Lc, -0.22 * Wc, -0.30 * D), (0.03 * Lc, 0.14 * Wc, 0.22 * D), region='metal')
    B.box((bx + 0.025 * Lc, 0, -0.62 * D), (0.03 * Lc, 0.44 * Wc, 0.05 * D), region='glow')
    for sgn in (1, -1):                                   # racks between the seat back and the bulkhead
        B.box(((bx + sx - 0.14 * Lc) / 2, sgn * 0.30 * Wc, -0.50 * D), (max(0.02 * Lc, sx - 0.14 * Lc - bx - 0.02 * Lc), 0.16 * Wc, 0.30 * D), region='metal', bevel=bv * 0.3)
        for k in range(3):
            B.box(((bx + sx - 0.14 * Lc) / 2, sgn * 0.30 * Wc, -0.60 * D + k * 0.09 * D), (max(0.02 * Lc, sx - 0.14 * Lc - bx - 0.02 * Lc) + 0.004 * Lc, 0.12 * Wc, 0.012 * D), region='glow' if k == 1 else 'trim')
    # pilot
    head = Vector((sx - 0.03 * Lc, 0, eye_z))
    helmet = B.sphere(head, hr, region='suit')
    visor = {f for f in helmet if (B.to_local(f.calc_center_median()) - head).normalized().x > 0.35}
    B.tag(visor, 'visor')
    B.box((sx - 0.05 * Lc, 0, eye_z - hr - 0.06 * D), (0.09 * Lc, 0.34 * Wc, 0.07 * D), region='suit', bevel=bv * 0.4)     # shoulders
    B.box((sx - 0.04 * Lc, 0, (eye_z - hr - 0.10 * D - 0.52 * D) / 2), (0.09 * Lc, 0.26 * Wc, (eye_z - hr - 0.10 * D + 0.52 * D)),
          rot=(0, math.radians(-8), 0), region='suit', bevel=bv * 0.4)                                                        # torso
    for sgn in (1, -1):
        B.box((sx + 0.10 * Lc, sgn * 0.08 * Wc, -0.46 * D), (0.22 * Lc, 0.09 * Wc, 0.10 * D), region='suit', bevel=bv * 0.3)  # thighs
    # canopy struts: arcs following the glass, offset inward (ccl = canopy centres RELATIVE
    # to the canopy origin, i.e. the same frame the furniture is placed in)
    # one strut = the roll bar behind the head (unseen from the seat, a bar across the glass from
    # outside). A front strut was tried at eye level (barred the view) and at the nose end
    # (the narrowing glass made it a jagged crown) ; the rim rail frames the windscreen instead.
    strut_faces = []
    for xs in (sx - 0.17 * Lc,):
        selm = np.abs(ccl[:, 0] - xs) < 0.05 * Lc
        if selm.sum() < 6:
            continue
        pts = ccl[selm]
        order = np.argsort(pts[:, 1])
        ys_, zs_ = pts[order, 1], pts[order, 2]
        # keep the top surface only: running max per y bin
        ybins = np.linspace(ys_.min(), ys_.max(), 13)
        zb = [zs_[(ys_ >= ybins[i]) & (ys_ <= ybins[i + 1])].max() if ((ys_ >= ybins[i]) & (ys_ <= ybins[i + 1])).any() else np.nan for i in range(12)]
        yb = (ybins[:-1] + ybins[1:]) / 2
        zb = np.array(zb)
        good = ~np.isnan(zb)
        yb, zb = yb[good], zb[good]
        if len(yb) < 4:
            continue
        zb = zb - 0.010 * L
        pts3 = [Vector((xs, y, z)) for y, z in zip(yb, zb)]
        for a, b in zip(pts3[:-1], pts3[1:]):
            mid = (a + b) / 2
            dv = b - a
            ln = dv.length
            roll = math.atan2(dv.z, dv.y)
            strut_faces += list(B.box(mid, (0.022 * Wc, ln * 1.03, 0.022 * Wc), rot=(roll, 0, 0), region='trim'))
    rep['struts_faces'] = len(strut_faces)

    # ---------------- COAMING: seal the tub top to the bottom of the glass -----------------------
    # The tub top is capped at 0.30 Hc so it stays a basin, but where the glass edge sits higher
    # (a bubble on a raised fairing behind the seat, a slit window's sill) a slot is left between
    # the tub top and the glass through which the seat looks straight into the fuselage void.
    # Per rim angle: a wall from the tub top up to just under the LOWEST glass at that angle
    # (the outer 25% of the canopy radius there), so no window is covered.
    ang_c = np.arctan2(cv[:, 1], cv[:, 0])
    rad_c = np.hypot(cv[:, 0], cv[:, 1])
    bins_c = ((ang_c + np.pi) / (2 * np.pi) * N).astype(int) % N
    zlo = np.full(N, np.nan)
    for b_ in range(N):
        m_ = (bins_c == b_) & (rad_c >= 0.75 * rmax[b_])
        if m_.any():
            zlo[b_] = float(cv[m_][:, 2].min())
    good_c = ~np.isnan(zlo)
    idx_c = np.arange(N)
    if good_c.sum() >= 8:
        zlo = np.interp(idx_c, idx_c[good_c], zlo[good_c], period=N)
    else:
        zlo = np.where(np.isnan(zlo), zat, zlo)
    zlo = np.minimum(zlo, zat)
    zlo = 0.5 * (zlo + zlo[mir])
    zlo = (np.roll(zlo, 1) + zlo + np.roll(zlo, -1)) / 3.0
    coaming_faces = []
    cm_top = []
    for i_ in range(N):
        xy_ = rc + (rim_rs[i_, :2] - rc) * 0.985
        cm_top.append(Vector((xy_[0], xy_[1], float(zlo[i_]) - 0.01 * Hc)))
    cm_gap = np.array([cm_top[i_].z - r0[i_].z for i_ in range(N)])
    cm_h = 0
    for i_ in (range(N) if COAMING else ()):
        j_ = (i_ + 1) % N
        if max(cm_gap[i_], cm_gap[j_]) < 0.002 * Hc:      # even a sliver: grazing rays over the dash slip through it
            continue
        ta, tb = r0[i_], r0[j_]
        ca = Vector((cm_top[i_].x, cm_top[i_].y, max(cm_top[i_].z, ta.z + 0.002 * Hc)))
        cb = Vector((cm_top[j_].x, cm_top[j_].y, max(cm_top[j_].z, tb.z + 0.002 * Hc)))
        vs_ = [B.bm.verts.new(B.to_world(q_)) for q_ in (ta, tb, cb, ca)]
        n_ = (vs_[1].co - vs_[0].co).cross(vs_[2].co - vs_[0].co)
        cen_ = sum((v_.co for v_ in vs_), Vector()) / 4.0
        if n_.dot(B.to_world(tub_center) - cen_) < 0:
            vs_.reverse()
        try:
            f_ = B.bm.faces.new(vs_)
        except ValueError:
            continue
        f_[B.reg] = REG_ID['metal']
        f_.smooth = True
        coaming_faces.append(f_)
        cm_h = max(cm_h, float(max(cm_gap[i_], cm_gap[j_])))
    rep['coaming'] = {'faces': len(coaming_faces), 'max_height_Hc': round(cm_h / Hc, 3)}

    # ---------------- INNER LINING: no hull face may be seen from behind ------------------------
    # In the game the hull is single-sided, so any hull face the seat looks at from its back
    # side is see-through (the rear of the fuselage, Pyro's window frame, the sides beside the
    # tub). A ray fan from the eye (helmet and glass passed through, exactly like the game's
    # culling) collects every hull face it reaches from behind; each gets an inward-facing
    # copy pushed 1% of the width inward, in the panel material, plus its 1-ring neighbours.
    # Rounds repeat with the new plates in place until the fan finds nothing new. From outside
    # the plates sit inside the hull skin.
    from mathutils.bvhtree import BVHTree as _BVH3
    hbm0 = bmesh.new()
    hbm0.from_mesh(me)
    hull_bvh0 = _BVH3.FromBMesh(hbm0, epsilon=0.0)
    hbm0.free()
    eye_w0 = B.to_world(head + Vector((0.3 * hr, 0, 0)))
    nPh = len(me.polygons)
    nrmH = np.empty(nPh * 3, np.float32)
    me.polygons.foreach_get('normal', nrmH)
    nrmH = nrmH.reshape(-1, 3)
    miH = np.empty(nPh, np.int32)
    me.polygons.foreach_get('material_index', miH)
    gslot0 = len(me.materials)
    vco_h = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', vco_h)
    vco_h = vco_h.reshape(-1, 3)
    poly_vs = [tuple(pg.vertices) for pg in me.polygons]
    v2f = {}
    for fi_, vs_ in enumerate(poly_vs):
        for v_ in vs_:
            v2f.setdefault(v_, []).append(fi_)
    eps_l = 1e-4 * L
    LIN_NY, LIN_NP = 360, 240          # 1 x 0.75 deg cells: the dash-top slit hid between 1.5 deg rows
    F3l = frame.to_3x3()
    lin_dirs = []
    for j_ in range(LIN_NP):
        pt_ = math.radians(-90.0 + 180.0 * (j_ + 0.5) / LIN_NP)
        for i_ in range(LIN_NY):
            yw_ = math.radians(-180.0 + 360.0 * (i_ + 0.5) / LIN_NY)
            lin_dirs.append(F3l @ Vector((math.cos(pt_) * math.cos(yw_), math.cos(pt_) * math.sin(yw_), math.sin(pt_))))

    NEAR_CLIP = L / 150.0          # the game camera near plane (1 unit at ~hullLength/longest*1.55)
    # classes: 0 solid hull, 1 interior, 2 glass/outside, 3 HOLE (hull back face), 4 nothing hit

    def _walk(dw_, int_bvh):
        """One ray from the eye with the game's culling: interior back faces (the helmet around
        the eye), glass and anything inside the camera near plane are passed through.
        Returns (cls, hull face index or -1, travelled distance, passed_near)."""
        o_ = Vector(eye_w0)
        seen_g = False
        near_ = False
        trav = 0.0
        for _ in range(24):
            hh = hull_bvh0.ray_cast(o_, dw_)
            hi = int_bvh.ray_cast(o_, dw_)
            dh = hh[3] if hh[0] is not None else 1e9
            di = hi[3] if hi[0] is not None else 1e9
            if dh >= 1e9 and di >= 1e9:
                return (2 if seen_g else 4), -1, trav, near_
            if di < dh:
                if hi[1].dot(dw_) > 0:
                    o_ = hi[0] + dw_ * eps_l
                    trav += di + eps_l
                    continue
                return 1, -1, trav + di, near_
            if miH[hh[2]] == gslot0:
                o_ = hh[0] + dw_ * eps_l
                trav += dh + eps_l
                seen_g = True
                continue
            if hh[1].dot(dw_) > 0:
                if trav + dh < NEAR_CLIP:
                    o_ = hh[0] + dw_ * eps_l
                    trav += dh + eps_l
                    near_ = True
                    continue
                return 3, int(hh[2]), trav + dh, near_
            return (2 if seen_g else 0), int(hh[2]), trav + dh, near_
        return 4, -1, trav, near_

    fan_out_dirs = []                               # rays that left the hull through a crack

    def _fan_holes(int_bvh):
        holes = {}                                  # hull face -> nearest hit distance
        cnt = {'outside': 0, 'interior': 0, 'glass_out': 0, 'hull': 0, 'hole': 0, 'near': 0}
        names = {0: 'hull', 1: 'interior', 2: 'glass_out', 3: 'hole', 4: 'outside'}
        del fan_out_dirs[:]
        for dw_ in lin_dirs:
            cls_, fi_, tr_, near_ = _walk(dw_, int_bvh)
            cnt[names[cls_]] += 1
            if near_:
                cnt['near'] += 1
            if cls_ == 3:
                holes[fi_] = min(tr_, holes.get(fi_, 1e9))
            elif cls_ == 4:
                fan_out_dirs.append(dw_)
        return holes, cnt

    lined = 0
    lined_set = set()
    lin_rounds = 0
    lining_faces = []
    skirts = 0
    _tubset = set(tub_faces)
    _floorset = set(floor_faces)
    # the parts are wound consistently only by the recalc below; the fan needs the helmet
    # wound outward now (from inside it is a back face to pass through, not a wall)
    _cmset = set(coaming_faces)
    bmesh.ops.recalc_face_normals(B.bm, faces=[f for f in B.bm.faces if f not in _tubset and f not in _floorset and f not in _cmset])
    # inner shell: hull vertices pushed inward along their (averaged) vertex normals and SHARED
    # between plates, so neighbouring plates meet with no crack at creases ; the outline of the
    # lined region gets a double-sided skirt back to the hull surface so no grazing ray slips
    # between the shell edge and the skin. From outside all of it is inside the hull.
    vnH = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('normal', vnH)
    vnH = vnH.reshape(-1, 3)
    shell_off = 0.01 * Wc
    shell_v = {}
    hull_v = {}
    # the plates wear the HULL material with the hull face's own UVs, so the inside of a
    # window frame shows that ship's paint and panel lines instead of a flat grey tile
    # (v37.35's grey plates read as shards - owner: "worse from inside")
    huv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', huv)
    huv = huv.reshape(-1, 2)
    lstart = np.empty(nPh, np.int32)
    me.polygons.foreach_get('loop_start', lstart)
    poly_uvs = [[Vector(huv[lstart[fi_] + k_]) for k_ in range(len(poly_vs[fi_]))] for fi_ in range(nPh)]

    def _hull_face(f_, uvs_):
        f_[B.reg] = REG_HULL
        f_.material_index = 1
        for l_, uv_ in zip(f_.loops, uvs_):
            l_[B.uv].uv = uv_

    def _sv(vi):
        v = shell_v.get(vi)
        if v is None:
            v = shell_v[vi] = B.bm.verts.new(Vector(vco_h[vi]) - Vector(vnH[vi]) * shell_off)
        return v

    def _hv(vi):
        v = hull_v.get(vi)
        if v is None:
            v = hull_v[vi] = B.bm.verts.new(Vector(vco_h[vi]))
        return v

    skirt_done = set()
    crack_centres = []
    crack_patches = 0
    zone_gaps = 0
    # a fan cell is ~1.5 deg: at distance d the rays are 0.026 d apart and the hull triangles in
    # between are never hit, so every hit face grows by that radius (plus one ring) via a KD
    # tree of face centres ; more rounds catch what is still reachable
    cenH = np.empty(nPh * 3, np.float32)
    me.polygons.foreach_get('center', cenH)
    cenH = cenH.reshape(-1, 3)
    from mathutils.kdtree import KDTree as _KD
    kdH = _KD(nPh)
    for fi_ in range(nPh):
        kdH.insert(Vector(cenH[fi_]), fi_)
    kdH.balance()
    cell_ang = math.radians(360.0 / LIN_NY)
    # CANOPY-ZONE holes become GLASS, not plates. The v37.34 cockpits the owner liked were in
    # effect full greenhouses: the painted frame areas between the windows were see-through
    # from the seat and read as open sky, with the thin rim rail as the frame. Plating them
    # (grey tile, then the hull's own paint) put dark shards into that view - "worse from
    # inside". So a hole that sits inside the canopy's own footprint (above its lowest point,
    # within its length/width) is turned into a pane: sealed by design, open by design, and
    # from outside the canopy becomes the greenhouse it already looked like from the seat.
    # Holes below the rim (fuselage, nose skin under the dash) still get the coaming + plates.
    _cx0, _cx1 = float(ccl[:, 0].min()), float(ccl[:, 0].max())

    def _zone_pt(pw_):
        pl_ = B.to_local(Vector(pw_))
        return (0.0 < pl_.z < 1.05 * Hc) and (_cx0 - 0.05 * Lc <= pl_.x <= _cx1 + 0.05 * Lc) and (abs(pl_.y) <= 0.55 * Wc)

    def _in_canopy_zone(fi_):
        return _zone_pt(cenH[fi_])

    glass_conv = 0
    for _round in range(6 if LINING else 0):
        B.bm.normal_update()                    # FromBMesh ray hits report the STORED face normal
        holes, fan_cnt = _fan_holes(_BVH3.FromBMesh(B.bm, epsilon=0.0))
        rep.setdefault('lining_fan', []).append({'holes_rays': fan_cnt['hole'], 'hole_faces': len(holes),
                                                  'already_lined': len(set(holes) & lined_set)})
        new_h = set(holes) - lined_set
        to_glass = {f_ for f_ in new_h if _in_canopy_zone(f_)}
        if to_glass:
            mi_now = np.empty(nPh, np.int32)
            me.polygons.foreach_get('material_index', mi_now)
            gidx_ = np.fromiter(to_glass, np.int64)
            mi_now[gidx_] = gslot0
            me.polygons.foreach_set('material_index', mi_now)
            cen_now = np.empty(nPh * 3, np.float32)
            me.polygons.foreach_get('center', cen_now)
            nrm_now = np.empty(nPh * 3, np.float32)
            me.polygons.foreach_get('normal', nrm_now)
            fe_ = np.zeros(nPh, bool)
            fe_[gidx_] = True
            fe_ &= ((np.array(eye_w0) - cen_now.reshape(-1, 3)) * nrm_now.reshape(-1, 3)).sum(1) > 0
            if fe_.any():                        # panes face away from the eye (cull from inside)
                set_select_mode('FACE')
                select_faces(fe_)
                edit_op(lambda: bpy.ops.mesh.flip_normals())
            me.update()
            me.polygons.foreach_get('material_index', miH)
            hb_ = bmesh.new()
            hb_.from_mesh(me)
            hull_bvh0 = _BVH3.FromBMesh(hb_, epsilon=0.0)
            hb_.free()
            glass_conv += len(to_glass)
            lined_set |= to_glass
            new_h -= to_glass
        # CRACK PATCHES: a ray that leaves the hull with nothing beyond went through a crack
        # in the skin (the cleanup zipper closes most). Nothing to copy there, so a small plate
        # perpendicular to the ray sits where it crossed the skin (the point along the ray
        # nearest to a hull face centre), single-sided towards the eye.
        new_patches = 0
        # crossing points, clustered: one plate per crack, sized to the crack's angular extent
        # (a lone ray = one 1.5 deg cell) - a big plate reads as a black square in the sky
        xs_ = []
        half_dirs = len(DIRS) / 2.0
        for dw_ in fan_out_dirs:
            # the crossing is where the ray's point leaves the hull's volume (parity votes):
            # coarse march, then bisection. (Nearest-face-centre sampling put the plate beside
            # the pilot's face wherever the skin runs close to the helmet.)
            t_in, t_out = None, None
            t_prev = 0.02 * L
            for t_ in np.arange(0.02 * L, 1.5 * L, 0.01 * L):
                p_ = Vector(eye_w0) + dw_ * float(t_)
                if inside_votes(hull_bvh0, p_, eps_l) < half_dirs:
                    t_in, t_out = t_prev, float(t_)
                    break
                t_prev = float(t_)
            if t_out is None:
                continue
            for _ in range(6):
                tm_ = 0.5 * (t_in + t_out)
                if inside_votes(hull_bvh0, Vector(eye_w0) + dw_ * tm_, eps_l) < half_dirs:
                    t_out = tm_
                else:
                    t_in = tm_
            best_t = 0.5 * (t_in + t_out)
            xs_.append((Vector(eye_w0) + dw_ * best_t, dw_, best_t))
        clusters_ = []
        for pc_, dw_, t_ in xs_:
            for cl_ in clusters_:
                if (pc_ - cl_[0][0]).length < 0.05 * Wc:
                    cl_.append((pc_, dw_, t_))
                    break
            else:
                clusters_.append([(pc_, dw_, t_)])
        for cl_ in clusters_:
            pc_ = sum((m_[0] for m_ in cl_), Vector()) / len(cl_)
            dw_ = sum((m_[1] for m_ in cl_), Vector()).normalized()
            t_ = sum(m_[2] for m_ in cl_) / len(cl_)
            # the crack's cross-section only: the parity crossings scatter ALONG the ray (a crack
            # makes the votes unstable), and that depth noise once sized a 6 cm plate for a
            # hairline 11 cm from the head
            spread_ = max(((m_[0] - pc_) - dw_ * (m_[0] - pc_).dot(dw_)).length for m_ in cl_)
            if any((pc_ - c_).length < 0.03 * Wc for c_ in crack_centres):
                continue
            crack_centres.append(pc_)
            if _zone_pt(pc_):
                # a gap in the canopy shell (Puncture: a real hole 4 cm above the pilot's head)
                # stays SKY: from the seat it reads exactly like the 35% glass around it, and
                # any pane that close filled a quarter of the view (black, then pale)
                zone_gaps += 1
                continue
            u_ = dw_.cross(Vector((0, 0, 1)))
            if u_.length < 1e-6:
                u_ = dw_.cross(Vector((0, 1, 0)))
            u_.normalize()
            v_ = dw_.cross(u_).normalized()
            hs_ = min(0.03 * Wc, max(0.004 * Wc, 0.6 * cell_ang * t_ * math.sqrt(len(cl_)) + spread_))
            vs_ = [B.bm.verts.new(pc_ + u_ * hs_ + v_ * hs_), B.bm.verts.new(pc_ - u_ * hs_ + v_ * hs_),
                   B.bm.verts.new(pc_ - u_ * hs_ - v_ * hs_), B.bm.verts.new(pc_ + u_ * hs_ - v_ * hs_)]
            n_ = (vs_[1].co - vs_[0].co).cross(vs_[2].co - vs_[0].co)
            if n_.dot(-dw_) < 0:
                vs_.reverse()
            try:
                f_ = B.bm.faces.new(vs_)
            except ValueError:
                continue
            f_[B.reg] = REG_ID['metal']
            f_.smooth = False
            lining_faces.append(f_)
            new_patches += 1
        crack_patches += new_patches
        if not new_h and not new_patches and not to_glass:
            break
        lin_rounds += 1
        if not new_h:
            continue
        grow = set(new_h)
        for fi_ in new_h:
            for v_ in poly_vs[fi_]:
                grow.update(v2f[v_])
            r_ = max(1.6 * cell_ang * holes[fi_], 0.02 * Wc)
            for (_co, idx_, _d) in kdH.find_range(Vector(cenH[fi_]), r_):
                grow.add(idx_)
        grow = {f_ for f_ in grow if miH[f_] != gslot0} - lined_set
        for fi_ in grow:
            try:
                f_ = B.bm.faces.new([_sv(vi) for vi in reversed(poly_vs[fi_])])
            except ValueError:
                continue
            _hull_face(f_, list(reversed(poly_uvs[fi_])))
            f_.smooth = True
            lining_faces.append(f_)
            lined += 1
        lined_set |= grow
        # skirt along the outline of the lined region (edges with exactly one lined face)
        for fi_ in lined_set:
            vs_ = poly_vs[fi_]
            for k_ in range(len(vs_)):
                va, vb = vs_[k_], vs_[(k_ + 1) % len(vs_)]
                key = (va, vb) if va < vb else (vb, va)
                if key in skirt_done:
                    continue
                shared = [g_ for g_ in v2f[va] if vb in poly_vs[g_]]
                if sum(1 for g_ in shared if g_ in lined_set) != 1:
                    continue
                skirt_done.add(key)
                # single-sided, facing the eye (a coincident double-sided pair fools the ray
                # probes: the tree answers either quad first and the step past it skips both)
                order = [_hv(va), _hv(vb), _sv(vb), _sv(va)]
                # the skirt wears the hull UVs of its edge (both ends), from the one lined face
                lf_ = next(g_ for g_ in shared if g_ in lined_set)
                pvs_ = poly_vs[lf_]
                ua_ = poly_uvs[lf_][pvs_.index(va)]
                ub_ = poly_uvs[lf_][pvs_.index(vb)]
                uvq_ = [ua_, ub_, ub_, ua_]
                pa, pb, pc = order[0].co, order[1].co, order[2].co
                qn = (pb - pa).cross(pc - pa)
                if qn.dot(Vector(eye_w0) - pa) < 0:
                    order.reverse()
                    uvq_.reverse()
                try:
                    q_ = B.bm.faces.new(order)
                except ValueError:
                    continue
                _hull_face(q_, uvq_)
                q_.smooth = False
                lining_faces.append(q_)
                skirts += 1
    rep['lining_faces'] = lined
    rep['lining_skirts'] = skirts
    rep['lining_rounds'] = lin_rounds
    rep['crack_patches'] = crack_patches
    rep['canopy_gaps_left_open'] = zone_gaps
    rep['holes_to_glass'] = glass_conv

    # UVs: box projection everywhere, then continuous UVs on the tub walls
    B.assign_uvs(tile_len=0.30 * Wc)
    B.tub_uvs(tub_faces, N, 2)
    _skip_recalc = set(tub_faces) | set(floor_faces) | set(lining_faces) | set(coaming_faces)
    bmesh.ops.recalc_face_normals(B.bm, faces=[f for f in B.bm.faces if f not in _skip_recalc])
    imesh = bpy.data.meshes.new('cockpit_interior')
    B.bm.to_mesh(imesh)
    B.bm.free()
    iobj = bpy.data.objects.new('cockpit_interior', imesh)
    sc.collection.objects.link(iobj)
    rep['interior'] = {'faces': len(imesh.polygons), 'verts': len(imesh.vertices)}

    # ---------------- materials --------------------------------------------------------------
    tint = ACCENT[ship]
    int_png, emis_png = build_atlas(ship, tint)
    int_img = bpy.data.images.load(int_png)
    emis_img = bpy.data.images.load(emis_png)
    int_img.pack()
    emis_img.pack()
    imat = bpy.data.materials.new('cockpit_interior')
    imat.use_nodes = True
    nt = imat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = new_image_node(nt, int_img)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    etex = new_image_node(nt, emis_img)
    nt.links.new(etex.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.5
    bsdf.inputs['Roughness'].default_value = 0.7
    bsdf.inputs['Metallic'].default_value = 0.25
    imat.use_backface_culling = True
    imesh.materials.append(imat)
    imesh.materials.append(mat0)        # slot 1: the inner lining wears the hull's own material
    # glass: same hull texture, blended
    # FLAT tinted glass, no texture: the hull JPEG paints a fake interior, glare streaks and
    # frame bars into the canopy, and at 38% alpha all of that overlaid the real 3D interior
    # as a veil (worst on Puncture's heavy gold paint). The tint is the mean painted glass
    # colour, desaturated and darkened a touch ; in-game buildModelShipMesh makes this
    # material glossy and reflective (see canopy_glass there).
    glass = bpy.data.materials.new('canopy_glass')
    glass.use_nodes = True
    gt = glass.node_tree
    gb = gt.nodes['Principled BSDF']
    _g = np.array(tint, np.float32)
    _grey = float(_g.mean())
    _gc = np.clip((_g * 0.75 + _grey * 0.25) * 0.85, 0, 1)
    if n_dome:                                   # a generated dome: dark smoked glass with a hint of the class colour
        _gc = np.clip(_g * 0.22 + 0.05, 0, 1)
    gb.inputs['Base Color'].default_value = (float(_gc[0]), float(_gc[1]), float(_gc[2]), 1.0)
    gb.inputs['Alpha'].default_value = GLASS_ALPHA
    gb.inputs['Roughness'].default_value = 0.08
    gb.inputs['Metallic'].default_value = 0.0
    gb.inputs['Specular IOR Level'].default_value = 0.8
    glass.blend_method = 'BLEND'
    glass.show_transparent_back = False
    glass.use_backface_culling = True
    me.materials.append(glass)          # takes the slot index the faces were pointed at above
    gi = len(me.materials) - 1
    me.update()

    # ---------------- HULL LIGHTS: emissive map from the painted class-colour strips ----------
    # Every hull carries painted light strips / vents in its class colour that never emitted ;
    # in dark arenas the ships were black blobs with engine orbs. Mask = saturated, bright
    # pixels within a hue window of the class colour ; emissive = the pixel colour there,
    # feathered. The glass material deliberately gets NO emissive (its faces share this
    # texture). In-game buildModelShipMesh keeps emissiveMap ; input.hullGlow gates it.
    tr, tg, tb = tint
    tmx, tmn = max(tint), min(tint)
    tdl = max(tmx - tmn, 1e-6)
    if tmx == tr:
        thue = ((tg - tb) / tdl) % 6
    elif tmx == tg:
        thue = (tb - tr) / tdl + 2
    else:
        thue = (tr - tg) / tdl + 4
    thue /= 6.0
    rgb = px[:, :, :3]
    pmx = rgb.max(2)
    pmn = rgb.min(2)
    psat = np.where(pmx > 1e-4, (pmx - pmn) / np.maximum(pmx, 1e-4), 0)
    pdl = np.maximum(pmx - pmn, 1e-6)
    phue = np.where(pmx == rgb[:, :, 0], ((rgb[:, :, 1] - rgb[:, :, 2]) / pdl) % 6,
                    np.where(pmx == rgb[:, :, 1], (rgb[:, :, 2] - rgb[:, :, 0]) / pdl + 2, (rgb[:, :, 0] - rgb[:, :, 1]) / pdl + 4)) / 6.0
    dh = np.abs(phue - thue)
    dh = np.minimum(dh, 1 - dh)
    hp = HULL_GLOW.get(ship, HULL_GLOW['default'])
    m1 = np.clip((psat - hp['sat']) / 0.15, 0, 1) * np.clip((pmx - hp['val']) / 0.15, 0, 1) * np.clip((hp['hue_tol'] - dh) / 0.04, 0, 1)
    hull_emis = np.zeros_like(px)
    hull_emis[:, :, :3] = rgb * m1[:, :, None] * hp['strength']
    hull_emis[:, :, 3] = 1.0
    rep['hull_glow'] = {'pixels_pct': round(float(100 * (m1 > 0.5).mean()), 2), 'params': hp}
    he_img = bpy.data.images.new(f'{ship}_hullemis', W, H, alpha=True)
    he_img.pixels.foreach_set(hull_emis.ravel())
    he_path = os.path.join(ATLAS_DIR, f'{ship}_hullemis.png')
    he_img.filepath_raw = he_path
    he_img.file_format = 'PNG'
    he_img.save()
    he_img.pack()
    h_bsdf = mat0.node_tree.nodes.get('Principled BSDF') or next(n for n in mat0.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    h_tex = new_image_node(mat0.node_tree, he_img)
    mat0.node_tree.links.new(h_tex.outputs['Color'], h_bsdf.inputs['Emission Color'])
    h_bsdf.inputs['Emission Strength'].default_value = 1.0

    # eye marker
    eye_world = B.to_world(head + Vector((0.3 * hr, 0, 0)))
    markers['cockpit1'].location = eye_world
    if FRAME_ART and ship in FRAME_PNG and os.path.exists(os.path.join(REPO, FRAME_PNG[ship])):
        build_frame_billboard(ship, B, head + Vector((0.3 * hr, 0, 0)), Lc, rep)
    rep['eye_world'] = [round(float(x), 4) for x in eye_world]

    # ---------------- SEE-THROUGH MAP from the eye ---------------------------------------------
    # What the seat sees with the game's culling: rays in every direction from the eye ; back
    # faces of the interior (the helmet around the eye) and glass are passed through ; a
    # non-glass hull BACK face reached first = a hole the pilot looks out through. Writes an
    # equirectangular map (yaw across, pitch down) : grey hull, green interior, blue glass,
    # RED hole.
    ibm = bmesh.new()
    ibm.from_mesh(imesh)
    int_bvh = _BVH3.FromBMesh(ibm, epsilon=0.0)
    ibm.free()
    NA, NB = 120, 60
    smap = np.zeros((NB, NA), np.uint8)
    hole_list = []
    near_cnt = 0
    F3 = frame.to_3x3()
    for j, pitch in enumerate(np.linspace(math.pi / 2, -math.pi / 2, NB)):
        for i, yaw in enumerate(np.linspace(-math.pi, math.pi, NA, endpoint=False)):
            dw = F3 @ Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
            cls, fi_hit, trav, near_hit = _walk(dw, int_bvh)
            if cls == 3 and len(hole_list) < 40:
                hole_list.append([round(math.degrees(yaw)), round(math.degrees(pitch)), round(float(trav), 4),
                                  fi_hit, fi_hit in lined_set])
            if near_hit and cls != 3:
                near_cnt += 1
            smap[j, i] = cls
    # the same fan the lining used, on the final mesh: must agree with the lining's last round
    _hf, _cf = _fan_holes(int_bvh)
    rep['lining_fan_final'] = _cf
    hole_pct = 100.0 * float((smap == 3).mean())
    rep['see_through'] = {'hole_pct_of_sphere': round(hole_pct, 2), 'glass_pct': round(100.0 * float((smap == 2).mean()), 1),
                          'interior_pct': round(100.0 * float((smap == 1).mean()), 1), 'hull_pct': round(100.0 * float((smap == 0).mean()), 1),
                          'near_clip_pct': round(100.0 * near_cnt / (NA * NB), 2), 'holes_sample': hole_list}
    pal = np.array([[70, 70, 78], [40, 170, 60], [60, 110, 230], [255, 30, 30], [0, 0, 0]], np.float32) / 255.0
    rgba = np.ones((NB, NA, 4), np.float32)
    rgba[:, :, :3] = pal[smap]
    simg = bpy.data.images.new(f'{ship}_seethrough', NA, NB, alpha=True)
    simg.pixels.foreach_set(rgba[::-1].ravel())     # blender images are bottom-up
    simg.filepath_raw = os.path.join(REPORT_DIR, f'{ship}_seethrough.png')
    simg.file_format = 'PNG'
    simg.save()
    bpy.data.images.remove(simg)

    # ---------------- renders ---------------------------------------------------------------
    if RENDER:
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x = 960
        sc.render.resolution_y = 720
        sc.eevee.taa_render_samples = 24
        sc.eevee.use_ssr = True
        sc.view_settings.view_transform = 'Filmic'
        w = bpy.data.worlds.new('W')
        sc.world = w
        w.use_nodes = True
        bgn = w.node_tree.nodes['Background']
        bgn.inputs[0].default_value = (0.35, 0.45, 0.6, 1)
        rad = L / 2

        def light(kind, loc, energy, color=(1, 1, 1), size=None):
            ld = bpy.data.lights.new('L', kind)
            ld.energy = energy
            ld.color = color
            if size and kind == 'AREA':
                ld.size = size
            o = bpy.data.objects.new('L', ld)
            o.location = ctr + loc
            sc.collection.objects.link(o)
            look_at(o, ctr)
            return o
        lights = [light('SUN', Vector((rad * 2, -rad * 2, rad * 3)), 3.0, (0.85, 0.9, 1.0)),
                  light('AREA', Vector((-rad * 2, rad * 1.5, -rad * 0.5)), rad * rad * 40, (1.0, 0.75, 0.5), size=rad * 2),
                  light('AREA', Vector((0, rad * 2.5, rad * 1.5)), rad * rad * 20, (1.0, 0.85, 0.6), size=rad * 2)]
        cd = bpy.data.cameras.new('C')
        cam = bpy.data.objects.new('C', cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
        c0w = B.to_world(Vector((0, 0, 0.5 * Hc)))

        def shot(name, loc, target, lens=40, clip_start=None):
            cd.lens = lens
            cd.clip_start = clip_start if clip_start else rad * 0.002
            cd.clip_end = rad * 60
            cam.location = loc
            look_at(cam, target)
            sc.render.filepath = os.path.join(REPORT_DIR, f'{ship}_{name}.png')
            bpy.ops.render.render(write_still=True)
        shot('front34_close', c0w + fwd * L * 0.50 + right * L * 0.32 + up * L * 0.28, c0w, lens=55)
        # night: world + lights down, so only the emissive strips / cockpit glow read
        _bg_save = tuple(bgn.inputs[0].default_value)
        _en_save = [(o, o.data.energy) for o in lights]
        bgn.inputs[0].default_value = (0.01, 0.012, 0.02, 1)
        for o, e in _en_save:
            o.data.energy = e * 0.06
        shot('night', ctr + fwd * L * 0.9 + right * L * 0.7 + up * L * 0.5, ctr, lens=40)
        bgn.inputs[0].default_value = _bg_save
        for o, e in _en_save:
            o.data.energy = e
        shot('top_close', c0w + up * L * 0.55 + fwd * L * 0.05, c0w, lens=55)
        side_loc = c0w + right * L * 0.9 + up * L * 0.22
        shot('cutaway', side_loc, c0w, lens=50, clip_start=(side_loc - c0w).length - Wc * 0.02)
        # pilot views with the hull single-sided, as the game renders it (back faces culled)
        mat0.use_backface_culling = True
        shot('pilotpov', eye_world, eye_world + fwd, lens=16)
        shot('pilotpov_down', eye_world, eye_world + fwd * 0.6 - up * 0.5, lens=16)
        shot('pilotpov_back', eye_world, eye_world - fwd - up * 0.15, lens=16)
        mat0.use_backface_culling = False
        # interior only
        hull.hide_render = True
        shot('interior_iso', c0w + fwd * Lc * 1.6 + right * Lc * 1.1 + up * Lc * 1.2, B.to_world(Vector((0, 0, -0.4 * D))), lens=45)
        hull.hide_render = False
        # canopy debug: paint the glass faces bright green
        dbg = bpy.data.materials.new('DBG')
        dbg.use_nodes = True
        dbg.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 1, 0.1, 1)
        dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.1, 1, 0.1, 1)
        dbg.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.5
        me.materials[gi] = dbg
        shot('canopy_debug', c0w + fwd * L * 0.45 + right * L * 0.30 + up * L * 0.40, c0w, lens=50)
        me.materials[gi] = glass
        for o in [cam] + lights:
            bpy.data.objects.remove(o, do_unlink=True)

    # ---------------- export -------------------------------------------------------------------
    if EXPORT:
        out = os.path.join(OUT_DIR, ship + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='AUTO', export_materials='EXPORT', export_normals=True,
                                  export_texcoords=True, export_extras=False, export_lights=False,
                                  export_cameras=False, export_animations=False, use_selection=False)
        rep['export'] = {'path': os.path.relpath(out, REPO), 'bytes': os.path.getsize(out)}
    rep['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(REPORT_DIR, ship + '_cockpit.json'), 'w') as fh:
        json.dump(rep, fh, indent=1)
    print('COCKPIT', json.dumps(rep))


for s in SHIPS:
    process(s)
print('COCKPIT_DONE')
