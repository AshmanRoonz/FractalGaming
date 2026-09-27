"""prepare_prints.py - turn the LSS game models into print-ready STL files (3DPrints/).

Game meshes are not printable as they are: hundreds of overlapping, open shells, zero-thickness
fins, loose debris inside the hull. This rebuilds each model as ONE closed solid:

  1. load the GLB (node transforms applied), glTF Y-up -> printer Z-up, scale to a size in mm
  2. inside/outside by generalized winding number (igl.fast_winding_number), which works on open,
     overlapping shells: coarse grid everywhere, full resolution only in cells the surface touches
  3. fill enclosed voids (trapped resin cracks a print), drop crumbs under --min-part mm^3
  4. thicken anything thinner than --min-wall so fins and spikes survive printing and washing
  5. marching cubes on the lightly smoothed volume -> watertight mesh -> decimate -> binary STL

Usage (repo root):  python tools/print3d/prepare_prints.py [--only slayer,papa] [--voxel 0.1]
Needs: pip install trimesh libigl pymeshfix fast-simplification scikit-image scipy numpy matplotlib

The player ships come from assets_base/ships (the frozen v37.23 hulls, before any cockpit was cut
into them). The owner's hi-poly originals live in assets_base/ships_original/ (gitignored, not in a
fresh clone); to print those instead, run with --ships-dir assets_base/ships_original.
"""
import argparse
import glob
import json
import os
import re
import time

import fast_simplification
import igl
import numpy as np
import pymeshfix
import trimesh
from scipy import ndimage
from skimage import measure

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, '3DPrints')

SHIPS = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']
MONSTERS = ['FleshMaw', 'GraveTitan', 'HallowWalker', 'IronBloom', 'StoneShroud', 'VoidGazer']


def model_list(ships_dir):
    """(group, name, source glb, longest side in mm, triangle budget)"""
    out = []
    for s in SHIPS:
        cands = [p for p in glob.glob(os.path.join(REPO, ships_dir, '*.glb'))
                 if os.path.basename(p).lower() == s + '.glb']
        out.append(('ships', s, cands[0], 80, 250_000))
    for p in sorted(glob.glob(os.path.join(REPO, 'LSS/objects/hoard/*.glb'))):
        out.append(('hoard', os.path.splitext(os.path.basename(p))[0], p, 60, 120_000))
    out.append(('hoard', 'carrier', os.path.join(REPO, 'LSS/objects/carrier.glb'), 160, 350_000))
    for m in MONSTERS:
        out.append(('monsters', m, os.path.join(REPO, f'LSS/objects/{m}.glb'), 80, 200_000))
    return out


def load(path, exclude=None):
    scene = trimesh.load(path, force='scene')
    parts = []
    for node in scene.graph.nodes_geometry:
        T, gname = scene.graph[node]
        g = scene.geometry[gname]
        if not isinstance(g, trimesh.Trimesh):
            continue
        if exclude and (re.search(exclude, gname) or re.search(exclude, node)):
            continue
        parts.append(trimesh.Trimesh(g.vertices.copy(), g.faces.copy(), process=False).apply_transform(T))
    m = trimesh.util.concatenate(parts)
    # glTF is Y-up, slicers are Z-up: (x, y, z) -> (x, -z, y)
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    return m


def solid_grid(V, F, lo, n, v, c=4):
    """Boolean occupancy at points lo + idx*v. Coarse winding numbers everywhere, fine only near
    the surface (cells touched by dense surface samples, plus one cell of margin)."""
    nc = np.ceil(n / c).astype(int) + 1
    ci = np.stack(np.meshgrid(*[np.arange(k) for k in nc], indexing='ij'), -1).reshape(-1, 3)
    coarse = (igl.fast_winding_number(V, F, lo + ci * c * v) > 0.5).reshape(nc)

    mesh = trimesh.Trimesh(V, F, process=False)
    count = int(min(mesh.area / (v * v) * 2, 20_000_000))
    pts, _ = trimesh.sample.sample_surface(mesh, count, seed=0)
    pts = np.concatenate([pts, V])
    cell = np.clip(np.floor((pts - lo) / (c * v)).astype(int), 0, nc - 1)
    marked = np.zeros(nc, bool)
    marked[tuple(cell.T)] = True
    marked = ndimage.binary_dilation(marked, np.ones((3, 3, 3), bool))

    # every fine voxel starts from its cell's coarse corner (cells with no surface nearby are uniform)
    idx = [np.arange(k) // c for k in n]
    solid = coarse[np.ix_(*idx)].copy()

    off = np.stack(np.meshgrid(*[np.arange(c)] * 3, indexing='ij'), -1).reshape(-1, 3)
    cells = np.argwhere(marked)
    step = max(1, 4_000_000 // len(off))
    for s in range(0, len(cells), step):
        fi = (cells[s:s + step, None, :] * c + off[None]).reshape(-1, 3)
        fi = fi[(fi < n).all(1)]
        w = igl.fast_winding_number(V, F, lo + fi * v)
        solid[tuple(fi.T)] = w > 0.5
    return solid


def ball(r):
    r = max(1, int(round(r)))
    g = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (g ** 2).sum(0) <= r * r + 0.5


def process(group, name, src, size_mm, budget, a):
    t0 = time.time()
    m = load(src, a.exclude)
    m.apply_scale(size_mm / m.extents.max())
    m.apply_translation(-m.bounds[0])
    v = max(a.voxel, size_mm / 800)  # ~800 voxels on the long side keeps the grid in memory
    pad = int(np.ceil((a.min_wall + 0.6) / v)) + 3
    lo = -pad * v * np.ones(3)
    n = np.ceil(m.extents / v).astype(int) + 2 * pad + 1
    V = np.ascontiguousarray(m.vertices, np.float64)
    F = np.ascontiguousarray(m.faces, np.int64)
    solid = solid_grid(V, F, lo, n, v)

    solid = ndimage.binary_fill_holes(solid)
    lab, k = ndimage.label(solid)
    sizes = np.bincount(lab.ravel())[1:] * v ** 3
    keep = np.flatnonzero(sizes >= a.min_part) + 1
    solid = np.isin(lab, keep)
    del lab

    # thicken: voxels an opening of radius min_wall/2 removes are thinner than min_wall;
    # grow just those by the shortfall
    r_open = a.min_wall / 2 / v
    opened = ndimage.binary_dilation(ndimage.binary_erosion(solid, ball(r_open)), ball(r_open))
    thin = solid & ~opened
    del opened
    thin_pct = 100.0 * thin.sum() / max(1, solid.sum())
    if thin.any():
        solid |= ndimage.binary_dilation(thin, ball(a.grow / v))
    del thin

    field = ndimage.gaussian_filter(solid.astype(np.float32), 0.7)
    del solid
    verts, faces, _, _ = measure.marching_cubes(field, 0.5, spacing=(v, v, v))
    del field
    verts += lo
    raw = len(faces)
    if len(faces) > budget:
        verts, faces = fast_simplification.simplify(verts.astype(np.float32), faces.astype(np.int64),
                                                    target_count=budget)
    # decimation can pinch a few edges non-manifold; MeshFix closes each piece again
    pieces = []
    for b in trimesh.Trimesh(verts, faces, process=True).split(only_watertight=False):
        if len(b.faces) < 20:
            continue
        mf = pymeshfix.MeshFix(b.vertices, b.faces)
        mf.repair(joincomp=False, remove_smallest_components=True)
        b = trimesh.Trimesh(mf.points, mf.faces, process=True)
        if b.volume < 0:
            b.invert()
        if b.volume >= a.min_part:
            pieces.append(b)
    out = trimesh.util.concatenate(pieces)
    out.apply_translation([-out.bounds[0][0], -out.bounds[0][1], -out.bounds[0][2]])

    d = os.path.join(OUT, group)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{name}.stl')
    out.export(path)
    info = dict(group=group, name=name, source=os.path.relpath(src, REPO), size_mm=[round(x, 1) for x in out.extents],
                triangles=len(out.faces), marching_cubes_triangles=raw, watertight=bool(out.is_watertight),
                volume_ml=round(out.volume / 1000, 2), parts=len(pieces), thickened_pct=round(thin_pct, 1),
                seconds=round(time.time() - t0, 1), file_mb=round(os.path.getsize(path) / 1e6, 1))
    print(json.dumps(info), flush=True)
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='', help='comma list of model names')
    ap.add_argument('--voxel', type=float, default=0.1, help='voxel size in mm')
    ap.add_argument('--min-wall', type=float, default=0.4, help='features thinner than this (mm) get thickened')
    ap.add_argument('--grow', type=float, default=0.15, help='how far thin features grow (mm per side)')
    ap.add_argument('--min-part', type=float, default=1.0, help='drop loose pieces under this volume (mm^3)')
    ap.add_argument('--exclude', default=r'glass|harness|flightpath|holo',
                    help='regex of node / mesh names to leave out (cockpit interior pieces)')
    ap.add_argument('--ships-dir', default='assets_base/ships')
    a = ap.parse_args()
    only = {s.lower() for s in a.only.split(',') if s}
    report = os.path.join(OUT, 'report.json')
    results = {}
    if os.path.exists(report):
        results = {r['name']: r for r in json.load(open(report))}
    for group, name, src, size_mm, budget in model_list(a.ships_dir):
        if only and name.lower() not in only:
            continue
        results[name] = process(group, name, src, size_mm, budget, a)
        json.dump(sorted(results.values(), key=lambda r: (r['group'], r['name'])), open(report, 'w'), indent=1)


if __name__ == '__main__':
    main()
