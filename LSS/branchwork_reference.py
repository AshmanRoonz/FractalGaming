"""THE BRANCHWORK — prototype of a fractal branching spike field for LSS terrain.

LSS's sandwich terrain is a strict heightfield (_swBuildShell writes one Y per
(x,z) for a ground shell and a ceiling shell), so "spikes that bend and branch"
cannot be 3D overhangs in that path. What they CAN be is a recursive branch
skeleton in the XZ plane driving both carved surfaces — the _stPillarAt pattern
(Worley points fusing floor to ceiling) generalized from points to a bending,
forking, tapering tree.

Trunk fuses floor to ceiling as a full column; each generation of branches
reaches less high, so the silhouette is a fractal massif with arms that taper
down to ridges you can fly over. The ceiling runs the same field on a different
seed, so stalactite trees hang between the stalagmite ones.

Uses the engine's real constants: SPACING 670, GAP_HALF 600, AMP 1120,
OCTAVES 5, LACUNARITY 2, GAIN 0.5, EXPONENT 1.75, terrain vertex step 22.5u.

This file is the reference implementation; branch_field.js is its twin, and
the two are cross-validated point-for-point.
"""
import numpy as np, math, zlib, struct, sys, time, json

# ---------------------------------------------------------------- engine noise
def hash2(x, z):
    h = np.sin(x * 127.1 + z * 311.7) * 43758.5453
    return h - np.floor(h)

def noise2(x, z):
    xi = np.floor(x); zi = np.floor(z)
    xf = x - xi; zf = z - zi
    u = xf * xf * (3 - 2 * xf); v = zf * zf * (3 - 2 * zf)
    a = hash2(xi, zi); b = hash2(xi + 1, zi)
    c = hash2(xi, zi + 1); d = hash2(xi + 1, zi + 1)
    ab = a + (b - a) * u; cd = c + (d - c) * u
    return (ab + (cd - ab) * v) * 2 - 1

T_OCTAVES, T_LACUNARITY, T_GAIN, T_EXPONENT = 5, 2.0, 0.5, 1.75
SPACING = 670.0
# Zone tuning: the stock cavern is GAP_HALF 600 / AMP 1120 — a violently ridged
# gap where the noise spikes ARE the terrain. In the Branchwork the base is
# calmed and the gap opened so the branch trees carry the silhouette instead of
# competing with fbm hash. Both are per-map values the engine already reads.
GAP_HALF, AMP = 900.0, 480.0
BASE_FREQ = 1.0 / SPACING
YMID = 0.0
YFLOOR = YMID - GAP_HALF
YCEIL = YMID + GAP_HALF

def ridged(x, z, seed):
    s = np.zeros_like(x); amp = 1.0; freq = BASE_FREQ
    prev = np.ones_like(x); norm = 0.0
    for _ in range(T_OCTAVES):
        n = noise2(x * freq + seed * 19.3, z * freq + seed * 7.1)
        r = 1 - np.abs(n); r = r * r
        s = s + r * amp * prev; prev = r; norm += amp
        freq *= T_LACUNARITY; amp *= T_GAIN
    return np.power(s / norm, T_EXPONENT)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / np.maximum(np.asarray(e1) - np.asarray(e0), 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

# ------------------------------------------------------- the branch field spec
# B = dict of tuning knobs; ox/oz are the per-round seed offsets (like PILLARS).
BRANCH_DEFAULT = dict(
    # Legibility rule: a tree's total reach must stay under ~cell/2, or
    # neighbouring trees merge into an undifferentiated ridge maze (measured:
    # cell 2600 with reach 1800 gave exactly that). Reach here is
    # 820+476+276+160 = 1732 against a 3600 cell.
    cell=4200.0,     # one tree per cell of this size
    drop=0.26,       # fraction of cells left empty (open halls between groves)
    jitter=0.55,     # root position jitter within the cell
    depth=4,         # generations: 1+2+4+8 = 15 branches
    subs=4,          # sub-segments per branch (this is what BENDS them)
    # SLENDERNESS RULE (measured the hard way): half-thickness must be well
    # under the sub-segment length or the tree fuses into one blob. First pass
    # had r0 300 against a 273u sub-segment and every tree rendered as a lump.
    # Here: sub-segment 225u vs half-thickness 115u.
    len0=900.0,      # trunk length
    lenRatio=0.58,   # child length = parent * this
    r0=115.0,        # trunk half-thickness
    rRatio=0.62,     # child thickness
    soft=95.0,       # falloff outside the branch radius
    spread=0.75,     # fork half-angle (radians)
    curve=0.38,      # angle drift per sub-segment => the bend
    rise0=0.98,      # depth-0 height fraction (1 = fuse floor to ceiling)
    riseFall=0.26,   # each generation reaches this much less
    overlap=80.0,    # push past the midline so fused cores are solid
    ox=0.0, oz=0.0,
)

def tree_segments(cxi, czi, B):
    """Segments of one cell's tree: [(ax,az,bx,bz,radius,rise), ...].
    Pure function of (cell index, seed offsets) — the same on every client."""
    ox, oz = B['ox'], B['oz']
    if float(hash2(cxi * 26.651 + ox * 0.71, czi * 67.131 + oz * 1.37)) < B['drop']:
        return []
    cs = B['cell']; jit = B['jitter']
    rx = (cxi + 0.5 + (float(hash2(cxi * 12.9898 + ox, czi * 78.233 + oz)) - 0.5) * jit) * cs
    rz = (czi + 0.5 + (float(hash2(cxi * 39.346 + oz, czi * 11.135 + ox)) - 0.5) * jit) * cs
    a0 = float(hash2(cxi * 5.31 + oz * 1.7, czi * 2.17 + ox * 3.1)) * 6.2831853
    segs = []
    # (x, z, angle, length, radius, depth, branchId, riseAtBase)
    stack = [(rx, rz, a0, B['len0'], B['r0'], 0, 1.0, B['rise0'])]
    while stack:
        bx, bz, ang, L, rad, d, bid, riseA = stack.pop()
        # Height tapers ALONG the branch, not just per generation. Constant
        # per-branch rise made every arm a flat-topped mesa; descending from a
        # central crown out to the tips is what reads as a branching spike.
        riseB = riseA * (1.0 - B['riseFall'])
        # Bend: the angle drifts by a hashed amount at every sub-step, so a
        # branch is an arc, not a spoke. Sign is per-branch so arms curl.
        curv = (float(hash2(bid * 7.77 + d * 13.1 + ox, bid * 3.33 + d * 5.7 + oz)) - 0.5) * 2.0 * B['curve']
        px, pz = bx, bz
        subL = L / B['subs']
        for s in range(B['subs']):
            ang += curv
            nx = px + math.cos(ang) * subL
            nz = pz + math.sin(ang) * subL
            f0 = s / B['subs']; f1 = (s + 1) / B['subs']
            t0 = rad * (1.0 - 0.34 * f0); t1 = rad * (1.0 - 0.34 * f1)
            h0 = riseA + (riseB - riseA) * f0; h1 = riseA + (riseB - riseA) * f1
            segs.append((px, pz, nx, nz, t0, t1, h0, h1))
            px, pz = nx, nz
        if d + 1 < B['depth']:
            for k in (0, 1):
                h = float(hash2(bid * 11.3 + k * 4.9 + ox, bid * 6.1 + d * 2.3 + oz))
                a2 = ang + (1 if k else -1) * B['spread'] * (0.55 + 0.9 * h)
                stack.append((px, pz, a2, L * B['lenRatio'], rad * B['rRatio'],
                              d + 1, bid * 2 + k + 1, riseB))
    return segs

def branch_field(X, Z, B):
    """Vectorised: returns (w, rise) — max branch weight at each point and the
    height fraction that winning branch wants. Segment-bbox limited, which is
    what keeps it affordable."""
    W = np.zeros_like(X); RISE = np.zeros_like(X)
    cs = B['cell']
    i0 = int(math.floor(X.min() / cs)) - 1; i1 = int(math.ceil(X.max() / cs)) + 1
    j0 = int(math.floor(Z.min() / cs)) - 1; j1 = int(math.ceil(Z.max() / cs)) + 1
    x0, z0 = X[0, 0], Z[0, 0]
    dx = X[0, 1] - X[0, 0]; dz = Z[1, 0] - Z[0, 0]
    H, Wd = X.shape
    for cxi in range(i0, i1 + 1):
        for czi in range(j0, j1 + 1):
            for (ax, az, bx, bz, r0, r1, h0, h1) in tree_segments(cxi, czi, B):
                pad = max(r0, r1) + B['soft']
                lo_x = min(ax, bx) - pad; hi_x = max(ax, bx) + pad
                lo_z = min(az, bz) - pad; hi_z = max(az, bz) + pad
                ia = max(0, int((lo_x - x0) / dx)); ib = min(Wd - 1, int((hi_x - x0) / dx) + 1)
                ja = max(0, int((lo_z - z0) / dz)); jb = min(H - 1, int((hi_z - z0) / dz) + 1)
                if ia > ib or ja > jb: continue
                sx = X[ja:jb+1, ia:ib+1]; sz = Z[ja:jb+1, ia:ib+1]
                ex = bx - ax; ez = bz - az; l2 = ex*ex + ez*ez
                t = ((sx - ax) * ex + (sz - az) * ez) / max(l2, 1e-9)
                t = np.clip(t, 0, 1)
                d = np.hypot(sx - (ax + ex * t), sz - (az + ez * t))
                rr = r0 + (r1 - r0) * t
                w = 1.0 - smoothstep(rr, rr + B['soft'], d)
                sub = W[ja:jb+1, ia:ib+1]
                take = w > sub
                sub[take] = w[take]
                RISE[ja:jb+1, ia:ib+1][take] = (h0 + (h1 - h0) * t)[take]
    return W, RISE

def branch_field_points(px, pz, B):
    """Scalar-ish path used for cross-validation against the JS twin."""
    px = np.atleast_1d(np.asarray(px, float)); pz = np.atleast_1d(np.asarray(pz, float))
    W = np.zeros_like(px); RISE = np.zeros_like(px)
    cs = B['cell']
    for n in range(px.size):
        x, z = px[n], pz[n]
        ix = math.floor(x / cs); iz = math.floor(z / cs)
        bw, br = 0.0, 0.0
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for (ax, az, bx, bz, r0, r1, h0, h1) in tree_segments(ix + di, iz + dj, B):
                    ex = bx - ax; ez = bz - az; l2 = ex*ex + ez*ez
                    t = 0.0 if l2 <= 0 else ((x - ax) * ex + (z - az) * ez) / l2
                    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                    d = math.hypot(x - (ax + ex * t), z - (az + ez * t))
                    rr = r0 + (r1 - r0) * t
                    w = 1.0 - float(smoothstep(rr, rr + B['soft'], np.array(d)))
                    if w > bw: bw, br = w, h0 + (h1 - h0) * t
        W[n] = bw; RISE[n] = br
    return W, RISE

# ------------------------------------------------------------- carved surfaces
def surfaces(X, Z, B, route=None):
    """Ground and ceiling after branch fusion (+ an optional carved route lane,
    the Endless-mode corridor, so there is somewhere to fly)."""
    g = YFLOOR + AMP * ridged(X, Z, 1.7)
    c = YCEIL - AMP * ridged(X + 4000, Z - 4000, 5.9)
    if route is not None:
        o = np.zeros_like(X)
        for (ax, az, bx, bz, rad, soft) in route:
            ex = bx - ax; ez = bz - az; l2 = ex*ex + ez*ez
            t = np.clip(((X - ax) * ex + (Z - az) * ez) / max(l2, 1e-9), 0, 1)
            d = np.hypot(X - (ax + ex * t), Z - (az + ez * t))
            o = np.maximum(o, 1 - smoothstep(rad, rad + soft, d))
        g = g + ((YMID - 640) - g) * o
        c = c + ((YMID + 760) - c) * o
        keep = 1.0 - o                       # route keepout for branches
    else:
        keep = np.ones_like(X)

    wg, rg = branch_field(X, Z, B)
    Bc = dict(B); Bc['ox'] = B['ox'] + 917.0; Bc['oz'] = B['oz'] + 431.0
    wc, rc = branch_field(X, Z, Bc)
    wg = wg * keep; wc = wc * keep
    mid = (g + c) * 0.5
    # Trunks (rise 1) fuse to the midline+overlap; each generation reaches less.
    gt = g + (mid + B['overlap'] - g) * rg
    ct = c + (mid - B['overlap'] - c) * rc
    g = g + (gt - g) * wg
    c = c + (ct - c) * wc
    return g, c

# ------------------------------------------------------------------- rendering
def write_png(path, img):
    H, W, _ = img.shape
    raw = b''.join(b'\x00' + img[r].tobytes() for r in range(H))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
    print('  wrote', path)

def topdown(g, c, ext, px, cell):
    """Hillshaded plan view of the ground shell: is the branching legible?"""
    gy, gx = np.gradient(g, cell)
    n = np.dstack([-gx, np.ones_like(g), -gy])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    L = np.array([0.42, 0.72, -0.55]); L /= np.linalg.norm(L)
    lam = np.clip(n @ L, 0, 1)
    t = np.clip((g - g.min()) / max(float(g.max() - g.min()), 1e-6), 0, 1)
    lo = np.array([0.05, 0.08, 0.14]); hi = np.array([0.62, 0.72, 0.86])
    warm = np.array([0.95, 0.72, 0.38])
    col = lo[None, None, :] * (1 - t[..., None]) + hi[None, None, :] * t[..., None]
    col = col * (0.28 + 0.85 * lam[..., None])
    fused = (c - g) < 40                       # floor met ceiling: solid rock
    col[fused] = col[fused] * 0.35 + warm * 0.10
    return (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)

def perspective(g, c, ext, N, cam, fwd, W=960, H=540, fov=70.0):
    """Raymarch the gap between the two shells by bilinear-sampling the baked
    heightmaps — the same surfaces the game would build."""
    x0, x1, z0, z1 = ext
    sx = (N - 1) / (x1 - x0); sz = (N - 1) / (z1 - z0)
    def sample(M, X, Z):
        fx = np.clip((X - x0) * sx, 0, N - 1.001); fz = np.clip((Z - z0) * sz, 0, N - 1.001)
        i0 = fx.astype(np.int32); j0 = fz.astype(np.int32)
        tx = fx - i0; tz = fz - j0
        a = M[j0, i0]; b = M[j0, i0 + 1]; cc = M[j0 + 1, i0]; d = M[j0 + 1, i0 + 1]
        return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz
    fwd = np.asarray(fwd, float); fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    tanH = math.tan(math.radians(fov) * 0.5); aspect = W / H
    u = ((np.arange(W) + 0.5) / W * 2 - 1)[None, :] * tanH * aspect
    v = (1 - (np.arange(H) + 0.5) / H * 2)[:, None] * tanH
    rd = right[None, None, :] * u[..., None] + up[None, None, :] * v[..., None] + fwd[None, None, :]
    rd = (rd / np.linalg.norm(rd, axis=-1, keepdims=True)).reshape(-1, 3)
    ro = np.asarray(cam, float)
    t = np.full(rd.shape[0], 20.0); hit = np.zeros(rd.shape[0], bool)
    FAR = 14000.0
    for _ in range(320):
        live = (~hit) & (t < FAR)
        if not live.any(): break
        p = ro[None, :] + rd[live] * t[live, None]
        gy = sample(g, p[:, 0], p[:, 2]); cy = sample(c, p[:, 0], p[:, 2])
        d = np.maximum(gy - p[:, 1], p[:, 1] - cy)      # vertical gap SDF
        h = np.where(d < 0, np.maximum(-d * 0.55, 14.0), np.maximum(d * 0.55, 14.0))
        idx = np.nonzero(live)[0]
        newhit = d >= 0
        hit[idx[newhit]] = True
        t[idx[~newhit]] += h[~newhit]
    p = ro[None, :] + rd * t[:, None]
    gy = sample(g, p[:, 0], p[:, 2]); cy = sample(c, p[:, 0], p[:, 2])
    e = 26.0
    ng = np.dstack([sample(g, p[:, 0] - e, p[:, 2]) - sample(g, p[:, 0] + e, p[:, 2]),
                    np.full(p.shape[0], 2 * e),
                    sample(g, p[:, 0], p[:, 2] - e) - sample(g, p[:, 0], p[:, 2] + e)])[0]
    nc = np.dstack([sample(c, p[:, 0] - e, p[:, 2]) - sample(c, p[:, 0] + e, p[:, 2]),
                    np.full(p.shape[0], -2 * e),
                    sample(c, p[:, 0], p[:, 2] - e) - sample(c, p[:, 0], p[:, 2] + e)])[0]
    isCeil = (p[:, 1] - cy) > (gy - p[:, 1])
    n = np.where(isCeil[:, None], nc, ng)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    L = np.array([0.35, 0.80, 0.42]); L /= np.linalg.norm(L)
    dif = np.clip(n @ L, 0, 1)
    head = np.clip(-np.sum(n * rd, axis=1), 0, 1) / (1 + t * t * 4e-7)
    ROCK = np.array([0.46, 0.42, 0.38]); CEIL = np.array([0.26, 0.26, 0.32])
    base = np.where(isCeil[:, None], CEIL[None, :], ROCK[None, :])
    hgt = np.clip((p[:, 1] - YFLOOR) / (2 * GAP_HALF), 0, 1)
    base = base * (0.62 + 0.85 * hgt)[:, None]
    GLOW = np.array([0.42, 0.82, 0.98])
    col = base * (0.30 + 0.80 * dif + 1.30 * head)[:, None]
    # Emissive seam where a trunk fuses floor to ceiling — reads the columns.
    col += GLOW[None, :] * (np.clip(1 - np.abs(gy - cy) / 700.0, 0, 1) * 0.30)[:, None]
    FOG = np.array([0.10, 0.15, 0.23])
    fog = (1 - np.exp(-t * 1.6e-4))[:, None]
    col = col * (1 - fog) + FOG[None, :] * fog
    col[~hit] = FOG
    return (np.clip(col, 0, 1).reshape(H, W, 3) * 255 + 0.5).astype(np.uint8)

# ------------------------------------------------------------------------ main
if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    B = dict(BRANCH_DEFAULT); B['ox'] = 1234.0; B['oz'] = 5678.0

    if '--emit-samples' in sys.argv:
        # Grid checksum matching branchwork_probe.html exactly.
        xs = np.array([-4000 + i * 100 for i in range(120)], float)
        zs = np.array([-4000 + j * 100 for j in range(120)], float)
        GX, GZ = np.meshgrid(xs, zs)
        w, r = branch_field_points(GX.ravel(), GZ.ravel(), B)
        print(f'  sum(w)    = {w.sum():.6f}')
        print(f'  sum(rise) = {r.sum():.6f}')
        print(f'  hits      = {int(np.count_nonzero(w > 0))}   max(w) = {w.max():.6f}')
        sys.exit(0)

    # A winding Endless-style corridor through the grove.
    route = [(-9000, -1200, -3000, 900, 620, 340), (-3000, 900, 1800, -800, 620, 340),
             (1800, -800, 6200, 1500, 620, 340), (6200, 1500, 9000, -600, 620, 340)]

    N = 900; EXT = (-9000, 9000, -9000, 9000)
    ax = np.linspace(EXT[0], EXT[1], N); az = np.linspace(EXT[2], EXT[3], N)
    X, Z = np.meshgrid(ax, az)
    t0 = time.time()
    g, c = surfaces(X, Z, B, route)
    print(f'field {N}x{N} in {time.time()-t0:.1f}s')
    cellsz = (EXT[1] - EXT[0]) / (N - 1)
    write_png(f'{out}/branchwork_plan.png', topdown(g, c, EXT, N, cellsz))

    gap = c - g
    open_pct = 100.0 * np.count_nonzero(gap > 260) / gap.size
    print(f'flyable (gap > 260u): {open_pct:.1f}% of plan area')

    # Cameras among the grove: high enough to see whole trees, angled across
    # the field rather than straight down the corridor.
    for tag, cam, fwd in [
        ('a', (-4200, 250, -2600), (1.0, -0.10, 0.55)),
        ('b', (900, 420, 2600), (0.75, -0.16, -1.0)),
        ('c', (4600, 180, -1400), (-1.0, -0.04, 0.30)),
        ('d', (-1500, -120, -5200), (0.35, 0.10, 1.0)),
    ]:
        t0 = time.time()
        img = perspective(g, c, EXT, N, cam, fwd)
        print(f'  view {tag} in {time.time()-t0:.1f}s')
        write_png(f'{out}/branchwork_view_{tag}.png', img)
