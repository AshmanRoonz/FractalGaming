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
GLASS_ALPHA = 0.38
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
    'seat': (0.50, 0.00, 1.00, 0.50, 'tile'), 'screen': (0.50, 0.50, 0.75, 0.75, 'fit'),
    'glow': (0.75, 0.50, 1.00, 0.75, 'fit'), 'suit': (0.50, 0.75, 0.75, 1.00, 'tile'),
    'visor': (0.75, 0.75, 1.00, 1.00, 'fit'),
}
REG_ID = {k: i for i, k in enumerate(REG)}
REG_NAME = {i: k for k, i in REG_ID.items()}


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


def screen_tile(size, tint, seed):
    """Dark screen with UI glyphs. Returns (base, emissive)."""
    y, x = np.mgrid[0:size, 0:size]
    base = np.ones((size, size, 3), np.float32) * np.array((0.02, 0.03, 0.05), np.float32)
    glyph = np.zeros((size, size), np.float32)
    b = 4
    glyph[(x >= b) & (x < size - b) & (y >= b) & (y < size - b) & ((x < b + 2) | (x >= size - b - 2) | (y < b + 2) | (y >= size - b - 2))] = 0.9
    # bar chart, lower left
    rng = np.random.default_rng(seed)
    for i in range(8):
        hgt = int(rng.integers(6, 34))
        xs0 = 10 + i * 7
        glyph[(x >= xs0) & (x < xs0 + 4) & (y >= size - 12 - hgt) & (y < size - 12)] = 0.75
    # radar circle, upper right
    cx, cy, r = size * 0.72, size * 0.30, size * 0.17
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    glyph[np.abs(d - r) < 1.2] = 0.9
    glyph[np.abs(d - r * 0.5) < 0.8] = 0.5
    glyph[(np.abs(x - cx) < 0.7) & (d < r)] = 0.35
    glyph[(np.abs(y - cy) < 0.7) & (d < r)] = 0.35
    # text dashes, upper left
    for row in range(5):
        yy = 14 + row * 7
        xx = 10
        while xx < size * 0.5:
            w = int(rng.integers(3, 12))
            glyph[(y >= yy) & (y < yy + 2) & (x >= xx) & (x < xx + w)] = 0.6 + 0.3 * rng.random()
            xx += w + 4
    # horizontal scanlines
    glyph[(y % 4 == 0)] *= 0.7
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
    sb, se = screen_tile(q, tint, seed + 9)
    put(base, REG['screen'], sb)
    put(emis, REG['screen'], se)
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
    # emissive FLOOR on the structural regions: the cockpit sits in the hull's own shadow in
    # combat and read near-black under ambient alone ; a faint self-light (~14% of base)
    # keeps panels legible without competing with the screens / glow strips.
    for rname in ('metal', 'trim', 'seat', 'suit'):
        u0, v0, u1, v1 = REG[rname][:4]
        x0, x1, y0, y1 = int(u0 * size), int(u1 * size), int(v0 * size), int(v1 * size)
        emis[y0:y1, x0:x1, :3] = np.maximum(emis[y0:y1, x0:x1, :3], base[y0:y1, x0:x1, :3] * 0.14)
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
    glass_faces = canopy | islands
    rep['canopy'] = {'faces': int(canopy.sum()), 'islands_folded_in': int(islands.sum()),
                     'components': [len(c) for c in comps[:6]], 'params': prm}
    if canopy.sum() < 20:
        raise RuntimeError(f'{ship}: canopy detection failed ({canopy.sum()} faces)')

    # canopy frame in ship-local coords
    inv = frame.transposed()
    ccw = np.array([inv @ Vector(c) for c in cen[canopy]])   # local (fwd, right, up) of canopy face centres
    cf0, cr0 = float(ccw[:, 0].mean()), float(ccw[:, 1].mean())
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
    rail_zmax = 0.35 * Hc     # only frame the LOW glass edge: on a slit window (PYRO) or ridged
    for a, b in zip(rail_pts, rail_pts[1:] + rail_pts[:1]):   # glass (SLAYER) the edge climbs into
        dv = b - a                                              # arches around the pilot's head
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
    bv = 0.06 * min(Wc, D)          # bevel radius
    B.box((sx, 0, -0.56 * D), (0.24 * Lc, 0.36 * Wc, 0.09 * D), region='seat', bevel=bv)              # pan
    B.box((sx - 0.12 * Lc, 0, -0.30 * D), (0.05 * Lc, 0.36 * Wc, 0.50 * D), rot=(0, math.radians(-12), 0), region='seat', bevel=bv * 0.6)  # backrest
    B.box((sx - 0.13 * Lc, 0, 0.02 * D), (0.05 * Lc, 0.16 * Wc, 0.14 * D), rot=(0, math.radians(-12), 0), region='seat', bevel=bv * 0.5)  # headrest
    B.box((sx - 0.02 * Lc, 0.20 * Wc, -0.42 * D), (0.22 * Lc, 0.04 * Wc, 0.16 * D), region='trim', bevel=bv * 0.3)   # armrests
    B.box((sx - 0.02 * Lc, -0.20 * Wc, -0.42 * D), (0.22 * Lc, 0.04 * Wc, 0.16 * D), region='trim', bevel=bv * 0.3)
    # dash: main slab tilted toward the pilot + two angled wings
    dx = 0.30 * Lc
    B.box((dx, 0, -0.32 * D), (0.18 * Lc, 0.70 * Wc, 0.36 * D), rot=(0, math.radians(18), 0), region='metal', bevel=bv * 0.5)
    for sgn in (1, -1):
        B.box((dx - 0.09 * Lc, sgn * 0.40 * Wc, -0.34 * D), (0.16 * Lc, 0.12 * Wc, 0.30 * D),
              rot=(0, math.radians(16), sgn * math.radians(-32)), region='metal', bevel=bv * 0.4)
    # screens: thin plates lying on the tilted dash top (surface normal tilted 18 deg toward pilot)
    tilt = math.radians(18)
    top_c = Vector((dx, 0, -0.32 * D)) + Vector((-math.sin(tilt), 0, math.cos(tilt))) * (0.18 * D)
    for i, yy in enumerate((-0.22, 0.0, 0.22)):
        c = top_c + Vector((0, yy * Wc, 0)) + Vector((-math.sin(tilt), 0, math.cos(tilt))) * (0.006 * D)
        B.box(c, (0.11 * Lc, 0.18 * Wc, 0.012 * D), rot=(0, tilt, 0), region='screen')
    # glow strip along the dash front edge
    edge_c = Vector((dx, 0, -0.32 * D)) + Vector((-math.cos(tilt), 0, -math.sin(tilt))) * (0.09 * Lc) \
        + Vector((-math.sin(tilt), 0, math.cos(tilt))) * (0.17 * D)
    B.box(edge_c, (0.010 * Lc, 0.60 * Wc, 0.018 * D), rot=(0, tilt, 0), region='glow')
    # glareshield hood over the dash's far edge (short, so it never hides the screens from the seat)
    hood_c = Vector((dx, 0, -0.32 * D)) + Vector((math.cos(tilt), 0, math.sin(tilt))) * (0.06 * Lc) \
        + Vector((-math.sin(tilt), 0, math.cos(tilt))) * (0.21 * D)
    B.box(hood_c, (0.07 * Lc, 0.76 * Wc, 0.014 * D), rot=(0, tilt + math.radians(6), 0), region='trim', bevel=bv * 0.2)
    # centre pedestal between the knees with its own small screen, and a throttle lever on the left console
    B.box((sx + 0.13 * Lc, 0, -0.50 * D), (0.16 * Lc, 0.10 * Wc, 0.14 * D), region='metal', bevel=bv * 0.3)
    B.box((sx + 0.13 * Lc, 0, -0.425 * D), (0.10 * Lc, 0.07 * Wc, 0.012 * D), region='screen')
    B.box((sx + 0.10 * Lc, 0.36 * Wc, -0.29 * D), (0.012 * Lc, 0.02 * Wc, 0.10 * D), rot=(0, math.radians(-25), 0), region='trim')
    B.box((sx + 0.10 * Lc - 0.02 * Lc, 0.36 * Wc, -0.245 * D), (0.03 * Lc, 0.035 * Wc, 0.02 * D), region='seat')
    # side consoles with buttons + a small screen each
    for sgn in (1, -1):
        cx_, cy_ = 0.04 * Lc, sgn * 0.36 * Wc
        B.box((cx_, cy_, -0.40 * D), (0.36 * Lc, 0.11 * Wc, 0.14 * D), region='metal', bevel=bv * 0.4)
        B.box((cx_ + 0.08 * Lc, cy_, -0.325 * D), (0.12 * Lc, 0.08 * Wc, 0.012 * D), region='screen')
        for k in range(4):
            B.box((cx_ - 0.10 * Lc + k * 0.045 * Lc, cy_, -0.325 * D), (0.025 * Lc, 0.04 * Wc, 0.012 * D), region='glow')
    # rear bulkhead + details
    B.box((-0.38 * Lc, 0, -0.40 * D), (0.04 * Lc, 0.62 * Wc, 0.55 * D), region='trim', bevel=bv * 0.3)
    B.box((-0.355 * Lc, 0.20 * Wc, -0.25 * D), (0.03 * Lc, 0.12 * Wc, 0.16 * D), region='metal')
    B.box((-0.355 * Lc, -0.20 * Wc, -0.25 * D), (0.03 * Lc, 0.12 * Wc, 0.16 * D), region='metal')
    B.box((-0.355 * Lc, 0, -0.62 * D), (0.03 * Lc, 0.40 * Wc, 0.05 * D), region='glow')
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

    # UVs: box projection everywhere, then continuous UVs on the tub walls
    B.assign_uvs(tile_len=0.30 * Wc)
    B.tub_uvs(tub_faces, N, 2)
    bmesh.ops.recalc_face_normals(B.bm, faces=[f for f in B.bm.faces if f not in set(tub_faces) and f not in set(floor_faces)])
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
    # glass: same hull texture, blended
    glass = bpy.data.materials.new('canopy_glass')
    glass.use_nodes = True
    gt = glass.node_tree
    gb = gt.nodes['Principled BSDF']
    gtex = new_image_node(gt, img)
    gt.links.new(gtex.outputs['Color'], gb.inputs['Base Color'])
    gb.inputs['Alpha'].default_value = GLASS_ALPHA
    gb.inputs['Roughness'].default_value = 0.12
    gb.inputs['Metallic'].default_value = 0.0
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
    rep['eye_world'] = [round(float(x), 4) for x in eye_world]

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
