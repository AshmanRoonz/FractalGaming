"""preview_prints.py - contact sheet of every STL in 3DPrints/ -> 3DPrints/previews.png

Usage (repo root):  python tools/print3d/preview_prints.py [--only slayer] [--out path.png]
"""
import argparse
import glob
import os

import fast_simplification
import matplotlib
import numpy as np
import trimesh

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, '3DPrints')


def draw(ax, m, title):
    v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int64), target_count=40_000)
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    shade = 0.25 + 0.75 * np.clip(n @ np.array([0.3, -0.5, 0.8]) / np.linalg.norm([0.3, -0.5, 0.8]), 0, 1)
    col = np.stack([shade * 0.62, shade * 0.66, shade * 0.72, np.ones_like(shade)], 1)
    ax.add_collection3d(Poly3DCollection(tri, facecolors=col, edgecolor='none'))
    c = (v.max(0) + v.min(0)) / 2
    r = (v.max(0) - v.min(0)).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(c[2] - r, c[2] + r)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=35, azim=-60)
    ax.set_axis_off()
    ax.set_title(title, fontsize=9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=os.path.join(OUT, 'previews.png'))
    a = ap.parse_args()
    only = {s.lower() for s in a.only.split(',') if s}
    files = sorted(glob.glob(os.path.join(OUT, '*', '*.stl')))
    files = [p for p in files if not only or os.path.splitext(os.path.basename(p))[0].lower() in only]
    cols = min(6, len(files))
    rows = -(-len(files) // cols)
    fig = plt.figure(figsize=(cols * 3, rows * 3), dpi=110)
    for i, p in enumerate(files):
        m = trimesh.load(p)
        ax = fig.add_subplot(rows, cols, i + 1, projection='3d')
        e = m.extents
        draw(ax, m, f'{os.path.basename(os.path.dirname(p))}/{os.path.basename(p)}\n{e[0]:.0f} x {e[1]:.0f} x {e[2]:.0f} mm')
    fig.tight_layout()
    fig.savefig(a.out)
    print(a.out)


if __name__ == '__main__':
    main()
