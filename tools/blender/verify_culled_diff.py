# -*- coding: utf-8 -*-
"""
verify_culled_diff.py — compare the before/after culled renders written by verify_culled.py.

A pixel that is transparent (alpha < 128) but ENCLOSED by opaque hull pixels is a hole the
player could see through in combat. For every ship and vantage this reports:
    holes_before / holes_after   enclosed transparent pixels
    fixed                        hole in before, hull in after      (the cleanup closed it)
    new                          hull in before, hole in after      (a REGRESSION — must be 0)
and writes tools/blender/reports/culled/_sheet_<ship>.png with zoomed crops of the biggest
changes: before | after | overlay (green = fixed, red = new).

    python tools/blender/verify_culled_diff.py [ship,ship]
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, 'reports', 'culled')
SHIPS = sys.argv[1].split(',') if len(sys.argv) > 1 else ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']
VIEWS = ['front34', 'rear34', 'top', 'bottom_front', 'bottom_rear', 'side']


def enclosed_transparent(alpha):
    """Transparent pixels not reachable from the image border through transparent pixels."""
    t = alpha < 128
    h, w = t.shape
    outside = np.zeros_like(t)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if t[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if t[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and t[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    return t & ~outside


def crop_box(mask, pad=48):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    cy, cx = int(np.median(ys)), int(np.median(xs))
    h, w = mask.shape
    x0, y0 = max(0, cx - pad * 2), max(0, cy - pad * 3 // 2)
    x1, y1 = min(w, cx + pad * 2), min(h, cy + pad * 3 // 2)
    return x0, y0, x1, y1


total_new = 0
for ship in SHIPS:
    rows = []
    for v in VIEWS:
        b = np.array(Image.open(os.path.join(DIR, f'{ship}_before_{v}.png')).convert('RGBA'))
        a = np.array(Image.open(os.path.join(DIR, f'{ship}_after_{v}.png')).convert('RGBA'))
        hb = enclosed_transparent(b[:, :, 3])
        ha = enclosed_transparent(a[:, :, 3])
        fixed = hb & ~ha
        new = ha & ~hb
        # any opaque->transparent flip anywhere (also catches silhouette-edge changes)
        lost = (b[:, :, 3] >= 128) & (a[:, :, 3] < 128)
        rows.append((v, int(hb.sum()), int(ha.sum()), int(fixed.sum()), int(new.sum()), int(lost.sum()), b, a, fixed, new))
        total_new += int(new.sum())
        print(f'{ship:9s} {v:13s} holes_before={int(hb.sum()):6d} holes_after={int(ha.sum()):6d} fixed={int(fixed.sum()):6d} NEW={int(new.sum()):5d} opaque_lost={int(lost.sum()):5d}')
    # sheet: the 3 views with the most change, each as before | after | overlay, 2x zoom crops
    rows.sort(key=lambda r: -(r[3] + r[4] * 4))
    tiles = []
    for v, nhb, nha, nfix, nnew, nlost, b, a, fixed, new in rows[:3]:
        box = crop_box(fixed | new)
        if box is None:
            continue
        x0, y0, x1, y1 = box
        bi = Image.fromarray(b[y0:y1, x0:x1]).convert('RGB')
        ai = Image.fromarray(a[y0:y1, x0:x1]).convert('RGB')
        ov = ai.copy()
        ovn = np.array(ov)
        ovn[fixed[y0:y1, x0:x1]] = (40, 255, 40)
        ovn[new[y0:y1, x0:x1]] = (255, 30, 30)
        ov = Image.fromarray(ovn)
        z = 3
        tile = Image.new('RGB', ((x1 - x0) * z * 3 + 8, (y1 - y0) * z + 18), (30, 30, 34))
        for i, im in enumerate((bi, ai, ov)):
            tile.paste(im.resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST), (i * ((x1 - x0) * z + 4), 18))
        ImageDraw.Draw(tile).text((4, 2), f'{ship} {v}: fixed {nfix}px  new {nnew}px  (before | after | overlay green=fixed red=new)', fill=(255, 255, 255))
        tiles.append(tile)
    if tiles:
        W = max(t.width for t in tiles)
        H = sum(t.height for t in tiles)
        sheet = Image.new('RGB', (W, H), (30, 30, 34))
        y = 0
        for t in tiles:
            sheet.paste(t, (0, y))
            y += t.height
        sheet.save(os.path.join(DIR, f'_sheet_{ship}.png'))
    # remaining holes in the AFTER renders: crop the biggest cluster of each of the 3 worst views
    rows.sort(key=lambda r: -r[2])
    htiles = []
    for v, nhb, nha, nfix, nnew, nlost, b, a, fixed, new in rows[:3]:
        ha = enclosed_transparent(a[:, :, 3])
        box = crop_box(ha, pad=40)
        if box is None or nha == 0:
            continue
        x0, y0, x1, y1 = box
        ai = Image.fromarray(a[y0:y1, x0:x1]).convert('RGB')
        ov = np.array(ai)
        ov[ha[y0:y1, x0:x1]] = (255, 0, 255)
        z = 4
        tile = Image.new('RGB', ((x1 - x0) * z * 2 + 4, (y1 - y0) * z + 18), (30, 30, 34))
        tile.paste(ai.resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST), (0, 18))
        tile.paste(Image.fromarray(ov).resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST), ((x1 - x0) * z + 4, 18))
        ImageDraw.Draw(tile).text((4, 2), f'{ship} {v}: {nha} enclosed transparent px remain (right: magenta = hole)', fill=(255, 255, 255))
        htiles.append(tile)
    if htiles:
        W = max(t.width for t in htiles)
        H = sum(t.height for t in htiles)
        sheet = Image.new('RGB', (W, H), (30, 30, 34))
        y = 0
        for t in htiles:
            sheet.paste(t, (0, y))
            y += t.height
        sheet.save(os.path.join(DIR, f'_holes_{ship}.png'))
print('TOTAL_NEW_HOLE_PIXELS', total_new)
