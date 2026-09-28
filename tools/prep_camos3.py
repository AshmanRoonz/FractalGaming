"""Make concept camos seamless and ship them as LSS/skins/*.webp (rebuild of the lost v49.26 prep_camos2.py).

Per image:
  1. roll by the offset near half the size that makes the image most self-similar (a periodic weave lands on
     a whole number of periods, so the two copies line up and the cut is invisible);
  2. X pass: B = roll_x(A) tiles left/right but has a seam down the middle; replace a band around that seam with
     A (continuous there), entering and leaving along two MIN-CUT vertical paths (dynamic programming over the
     A-vs-B error), each path CYCLIC (its first and last rows meet) so the result still wraps top/bottom;
  3. Y pass: the same with rows on the X-pass result;
  4. a 3 px feather across each cut, never a wide blend (a wide one left a grey grid in v49.26);
  5. resize to 1024 with a WRAPPED pad, so the filter never sees a clamped edge;
  6. imageMean = linear-light mean of the tile, back in sRGB.
Usage: py -3.11 prep_camos3.py name [name ...]
"""
import sys, os, json
import numpy as np
from PIL import Image

SRC = r'C:/Users/ashro/Fractal_Reality/FractalGaming/LSS/concept/camos'
DST = r'C:/Users/ashro/Fractal_Reality/FractalGaming/LSS/skins'
PREV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview')
OUT_N = 1024
BAND = 0.10     # half-band as a fraction of the size, each side of the centre seam
MARGIN = 6      # px either side of the centre line that must come from A
FEATHER = 3


def to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055)


def best_shift(lum, axis, center, span):
    best = None
    for s in range(center - span, center + span + 1):
        d = lum - np.roll(lum, s, axis=axis)
        e = float(np.mean(d * d))
        if best is None or e < best[0]:
            best = (e, s)
    return best[1]


def cyclic_vpath(E):
    """Min-cost top-to-bottom path through E (rows x cols), |dx| <= 1 per row, whose LAST x is within 1 of its
    FIRST x. All start columns are run at once: state[s, x] = best cost of a path that started at s."""
    H, W = E.shape
    INF = 1e30
    cost = np.full((W, W), INF)
    cost[np.arange(W), np.arange(W)] = E[0]
    back = np.zeros((H, W, W), dtype=np.int8)   # -1 / 0 / +1 step taken to reach (row, s, x)
    for y in range(1, H):
        left = np.concatenate([np.full((W, 1), INF), cost[:, :-1]], axis=1)    # came from x-1
        right = np.concatenate([cost[:, 1:], np.full((W, 1), INF)], axis=1)    # came from x+1
        stack = np.stack([left, cost, right])                                   # 0: from x-1, 1: from x, 2: from x+1
        arg = np.argmin(stack, axis=0)
        cost = np.take_along_axis(stack, arg[None], axis=0)[0] + E[y][None, :]
        back[y] = (arg - 1).astype(np.int8)                                     # -1 from x-1, 0 from x, +1 from x+1
    best = (INF, None, None)
    for s in range(W):
        for x in (s - 1, s, s + 1):
            if 0 <= x < W and cost[s, x] < best[0]:
                best = (cost[s, x], s, x)
    _, s, x = best
    path = np.zeros(H, dtype=np.int64)
    path[H - 1] = x
    for y in range(H - 1, 0, -1):
        x = x + back[y, s, x]
        path[y - 1] = x
    return path


def pass_x(A):
    """A is (H, W, 3) float. Returns an image that wraps left/right, and the shift used."""
    H, W, _ = A.shape
    lum = A.mean(axis=2)
    s = best_shift(lum, 1, W // 2, int(W * 0.07))
    B = np.roll(A, s, axis=1)                  # B wraps left/right; its seam sits at column s
    c = s                                      # B[:, c] = A[:, 0], B[:, c-1] = A[:, W-1]
    b = int(W * BAND)
    err = ((A - B) ** 2).sum(axis=2)
    # left cut in [c-b, c-MARGIN], right cut in [c+MARGIN, c+b] (columns of the image)
    L0, L1 = c - b, c - MARGIN
    R0, R1 = c + MARGIN, c + b
    pl = cyclic_vpath(err[:, L0:L1]) + L0
    pr = cyclic_vpath(err[:, R0:R1]) + R0
    O = B.copy()
    xs = np.arange(W)[None, :]
    # A between the cuts, B outside; feather FEATHER px across each cut
    wl = np.clip((xs - pl[:, None] + FEATHER / 2) / FEATHER, 0, 1)
    wr = np.clip((pr[:, None] - xs + FEATHER / 2) / FEATHER, 0, 1)
    w = np.minimum(wl, wr)[:, :, None]
    O = w * A + (1 - w) * B
    return O, s


def seamless(A):
    O1, sx = pass_x(A)
    O2t, sy = pass_x(np.transpose(O1, (1, 0, 2)))
    return np.transpose(O2t, (1, 0, 2)), (sx, sy)


def resize_wrapped(img, n):
    H, W, _ = img.shape
    pad = 49
    P = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    k = n / W
    pn = int(round(pad * k))
    tgt = n + 2 * pn
    im = Image.fromarray(np.clip(P, 0, 255).astype(np.uint8)).resize((tgt, tgt), Image.LANCZOS)
    a = np.asarray(im)
    return a[pn:pn + n, pn:pn + n]


def wrap_stats(a):
    a = a.astype(np.float32)
    return (float(np.abs(a[:, 0] - a[:, -1]).mean()), float(np.abs(a[0] - a[-1]).mean()),
            float(np.abs(a[:, 1:] - a[:, :-1]).mean()), float(np.abs(a[1:] - a[:-1]).mean()))


def main(names):
    os.makedirs(PREV, exist_ok=True)
    out = {}
    for n in names:
        src = os.path.join(SRC, n + '.png')
        A = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
        S, shifts = seamless(A)
        T = resize_wrapped(S, OUT_N)
        dst = os.path.join(DST, n + '.webp')
        Image.fromarray(T).save(dst, 'WEBP', quality=86, method=6)
        lin = to_lin(T.astype(np.float64)).reshape(-1, 3).mean(axis=0)
        mean = (to_srgb(lin) * 255 + 0.5).astype(int)
        hexs = '0x%02x%02x%02x' % tuple(mean)
        # 2x2 preview of the SHIPPED file, so a seam would show as a cross in the middle
        back = np.asarray(Image.open(dst).convert('RGB'))
        tile2 = np.tile(back, (2, 2, 1))
        Image.fromarray(tile2).resize((768, 768), Image.LANCZOS).save(os.path.join(PREV, n + '_2x2.jpg'), quality=85)
        st = wrap_stats(back)
        out[n] = {'mean': hexs, 'kb': round(os.path.getsize(dst) / 1024), 'shift': shifts,
                  'wrapH': round(st[0], 1), 'wrapV': round(st[1], 1), 'nbH': round(st[2], 1), 'nbV': round(st[3], 1)}
        print(n, json.dumps(out[n]), flush=True)
    return out


if __name__ == '__main__':
    main(sys.argv[1:])
