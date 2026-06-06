# Sandwich Terrain for LSS (Three.js)

How to build the procedural "sandwich" level: jagged mountains below, mirrored
mountains hanging above, flying through the open gap between, with the world
periodically **pinching into a walled corridor** that narrows, forks, and seals
shut so you fly a real route instead of open void. This mirrors the working Ace
Starship (Roblox) build, ported to LSS's Three.js stack (r0.165,
`BufferGeometry`, `FogExp2`, GLSL FBM, marching-cubes worker).

The effect is four ideas stacked: a good noise function for the mountain shape, a
corridor "feature" layer that walls the world in, a displaced mesh to render it,
and chunk streaming so it's endless.

---

## 1. The noise (this is what makes it look like mountains)

Plain summed noise (`fbm`) only makes rounded blobs. Real mountains need three
extra moves, all cheap:

- **Ridged noise** `1 - |noise|`: inverts valleys into sharp ridgelines.
- **Multifractal weighting** (each octave multiplied by the previous): piles
  detail onto ridges, leaves valleys smooth, like real ranges.
- **Power redistribution** `h ^ exponent`: deepens valleys, sharpens peaks.
- **Domain warping**: offset the sample coordinates by another noise so ridges
  meander organically instead of looking grid-aligned.

Self-contained 2D CPU version (no dependency, mirrors your shader's value-noise):

```js
// --- self-contained 2D value noise, range -1..1 ---
function _hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);                 // 0..1
}
function valueNoise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = _hash2(xi,     zi);
  const b = _hash2(xi + 1, zi);
  const c = _hash2(xi,     zi + 1);
  const d = _hash2(xi + 1, zi + 1);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 2 - 1;       // -1..1
}

// --- tuning (scale these to LSS world units; see section 6) ---
const T = {
  OCTAVES:   5,
  BASE_FREQ: 0.0088,   // smaller = fewer, broader mountains
  LACUNARITY: 2.0,
  GAIN:      0.5,
  EXPONENT:  2.3,      // >1 = sharper peaks, flatter valleys
  WARP:      24,       // domain-warp strength (world units)
  WARP_FREQ: 0.0048,
  GROUND_BASE: 0,   GROUND_AMP: 95,   // floor: peaks rise to ~AMP
  CEIL_BASE:   190, CEIL_AMP:   85,   // ceiling: flat at BASE, tips hang to BASE-AMP
};

// --- ridged multifractal, range ~0..1 ---
function ridged(x, z, seed) {
  let sum = 0, amp = 1, freq = T.BASE_FREQ, prev = 1, norm = 0;
  for (let o = 0; o < T.OCTAVES; o++) {
    const n = valueNoise2(x * freq + seed * 19.3, z * freq + seed * 7.1);
    let r = 1 - Math.abs(n);
    r *= r;                       // sharpen
    sum  += r * amp * prev;       // multifractal: weight by previous octave
    prev  = r;
    norm += amp;
    freq *= T.LACUNARITY;
    amp  *= T.GAIN;
  }
  return Math.pow(sum / norm, T.EXPONENT);
}

function warp(x, z) {
  return [
    x + T.WARP * valueNoise2(x * T.WARP_FREQ,          z * T.WARP_FREQ),
    z + T.WARP * valueNoise2(x * T.WARP_FREQ + 31.7,   z * T.WARP_FREQ + 17.3),
  ];
}

// Base (open-world) heights, before the corridor feature in section 2.
function groundBase(x, z) { const [wx, wz] = warp(x, z);               return T.GROUND_BASE + T.GROUND_AMP * ridged(wx, wz, 1.7); }
function ceilBase(x, z)   { const [wx, wz] = warp(x + 4000, z - 4000); return T.CEIL_BASE   - T.CEIL_AMP   * ridged(wx, wz, 5.9); }
```

`groundY`/`ceilY` (defined in the next section, wrapping these bases) are the only
entry points the rest of the system needs.

---

## 2. Course features: pinch corridors, walls, and forks (NEW)

Between open stretches, the world periodically **pinches** into a corridor: the
side mountains grow up and the ceiling tips grow down until they fuse into a wall,
leaving a clear lane down the middle. The lane **narrows** across each pinch
(converging), and every few pinches a central ridge **forks** it into two lanes.
This is what turns the open sandwich into a flyable route toward a landmark.

The corridor runs along the forward travel axis. In Ace Starship the ship spawns
facing **-Z** and the lane is centered on **x = 0**; use whatever your forward
axis is in LSS and center the lane on the perpendicular axis.

### How the wall seals (the important trick)

The ground and ceiling use independent noise, so if you just amplified both they'd
leave random see-through gaps where a ground valley lines up with a ceiling peak.
Instead the wall seals **by construction**: inside a wall the ground is pushed
*above* a shared `MEET` altitude and the ceiling *below* it. So at every walled
column `ground >= MEET >= ceiling` no matter how the two noises fall, which means
the surfaces always overlap (a solid wall) with no sneak-through. The craggy look
is preserved because the amplitude (`GAMP_W` / `CAMP_W`) still rides on the noise.

```js
const F = {
  ON: true,
  FIRST_OPEN: 1500,   // open run right after spawn before the first pinch
  PERIOD:     3600,   // distance from one pinch's start to the next
  LEN:        2200,   // how much of each period is walled (rest is open)
  OPEN_HALF:  300,    // clear-lane half-width where a pinch begins
  NARROW_HALF:150,    // clear-lane half-width by the pinch's end (converging)
  WALL_SOFT:  80,     // soft thickness of the wall faces (ramp, not a cliff)
  FORK_EVERY: 3,      // every Nth pinch grows a central ridge -> a fork
  FORK_HALF:  55,     // half-width of that central ridge
  MEET:       100,    // altitude where ground peaks + ceiling tips fuse
  GAMP_W:     60,     // craggy height of wall ground peaks above MEET
  CAMP_W:     60,     // craggy depth of wall ceiling tips below MEET
  CLEAR:      25,     // how much the open lane is pushed clear
};

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Envelope 0..1 along the forward axis only: 0 in open stretches, ramps to 1
// inside a walled pinch. (Forward = -z here; swap to your axis.)
function envAtZ(z) {
  if (!F.ON) return 0;
  const p = -z;                          // forward progress
  if (p < F.FIRST_OPEN) return 0;
  const q = p - F.FIRST_OPEN;
  const seg = Math.floor(q / F.PERIOD);
  const frac = q - seg * F.PERIOD;
  if (frac > F.LEN) return 0;             // open stretch between pinches
  const t = frac / F.LEN;
  return smoothstep(0, 0.12, t) * (1 - smoothstep(0.88, 1, t));  // ramp in/out
}

// Per-column feature: [env, cross]. cross is 0 in the clear lane, 1 out in the
// wall (sides + optional fork ridge). No noise here, so it's cheap.
function feature(x, z) {
  const e = envAtZ(z);
  if (e <= 0) return [0, 0];
  const q = (-z) - F.FIRST_OPEN;
  const seg = Math.floor(q / F.PERIOD);
  const t = (q - seg * F.PERIOD) / F.LEN;
  const half = F.OPEN_HALF + (F.NARROW_HALF - F.OPEN_HALF) * t;   // lane converges
  const d = Math.abs(x);                  // lane centered on x = 0
  let cross = smoothstep(half, half + F.WALL_SOFT, d);            // 0 lane, 1 wall
  if (seg % F.FORK_EVERY === 0 && t > 0.45) {                     // fork on some pinches
    const fenv = smoothstep(0.45, 0.62, t);
    const ridge = 1 - smoothstep(F.FORK_HALF, F.FORK_HALF + F.WALL_SOFT, d);
    cross = Math.max(cross, fenv * ridge);
  }
  return [e, cross];
}

// Final heights = base noise, wrapped with the corridor feature.
function groundY(x, z) {
  const [wx, wz] = warp(x, z);
  const r = ridged(wx, wz, 1.7);
  let g = T.GROUND_BASE + T.GROUND_AMP * r;
  const [e, cross] = feature(x, z);
  if (e > 0) {
    const gw = e * cross;
    g = g * (1 - gw) + (F.MEET + F.GAMP_W * r) * gw;   // wall: rise above MEET
    g -= e * (1 - cross) * F.CLEAR;                     // lane: push the floor down
  }
  return g;
}
function ceilY(x, z) {
  const [wx, wz] = warp(x + 4000, z - 4000);
  const r = ridged(wx, wz, 5.9);
  let c = T.CEIL_BASE - T.CEIL_AMP * r;
  const [e, cross] = feature(x, z);
  if (e > 0) {
    const cw = e * cross;
    c = c * (1 - cw) + (F.MEET - F.CAMP_W * r) * cw;   // wall: drop below MEET
    c += e * (1 - cross) * F.CLEAR;                     // lane: raise the ceiling
  }
  return c;
}

// A column is sealed (solid floor-to-ceiling) wherever the floor reaches the
// ceiling. Use this for collision so the ship can't fly through a wall.
function solid(x, z) { return ceilY(x, z) <= groundY(x, z); }
```

Heightfield note: where a column is sealed, the ground surface pokes *above* the
ceiling surface, so the two meshes simply interpenetrate and read as a solid
craggy wall, which is what you want. If you render with marching cubes (section 7)
the density field closes cleanly with no interpenetration.

---

## 3. Building a chunk mesh

A chunk is a square grid of vertices displaced to the surface height. Use an
indexed `BufferGeometry` and flat shading for the low-poly look.

```js
// size = world width of the chunk, cells = grid resolution (e.g. 10 => coarse)
function buildChunkMesh(originX, originZ, size, cells, surfaceFn, material) {
  const verts = [];
  const step = size / cells;
  for (let j = 0; j <= cells; j++) {
    for (let i = 0; i <= cells; i++) {
      const x = originX + i * step;
      const z = originZ + j * step;
      verts.push(x, surfaceFn(x, z), z);
    }
  }
  const idx = [];
  const row = cells + 1;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b,  b, c, d);   // CCW; flip winding for the ceiling
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}
```

```js
const groundMat  = new THREE.MeshStandardMaterial({ color: 0x747a86, flatShading: true, roughness: 1 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x484c5a, flatShading: true, roughness: 1, side: THREE.BackSide });
```

For the **ceiling**, reverse the triangle winding or render `side: THREE.BackSide`
so its faces point down into the gap.

**Pinch chunks need more vertical detail.** The walls add sharp height changes, so
a coarse `cells` will stair-step them. Either raise `cells` everywhere, or bump it
only for chunks whose span crosses a pinch (sample `envAtZ` across the chunk's
forward range; if any is > 0, use a finer grid). This mirrors how the Roblox build
makes only pinch chunks taller/denser to keep normal chunks cheap.

---

## 4. Streaming chunks (endless world)

Keep a window of chunks around the ship; add ahead, drop behind.

```js
const CHUNK = 800;     // world units per chunk (LSS scale; tune)
const CELLS = 12;      // triangles per chunk side (raise for crisp walls)
const VIEW  = 4;       // chunk radius kept loaded
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const chunks = new Map();        // "cx,cz" -> { ground, ceiling }

function keyOf(cx, cz) { return cx + ',' + cz; }

function updateTerrain(shipPos) {
  const scx = Math.floor(shipPos.x / CHUNK);
  const scz = Math.floor(shipPos.z / CHUNK);

  for (let cx = scx - VIEW; cx <= scx + VIEW; cx++) {
    for (let cz = scz - VIEW; cz <= scz + VIEW; cz++) {
      const k = keyOf(cx, cz);
      if (chunks.has(k)) continue;
      const ox = cx * CHUNK, oz = cz * CHUNK;
      const ground  = buildChunkMesh(ox, oz, CHUNK, CELLS, groundY, groundMat);
      const ceiling = buildChunkMesh(ox, oz, CHUNK, CELLS, ceilY,   ceilingMat);
      terrainGroup.add(ground, ceiling);
      chunks.set(k, { ground, ceiling });
    }
  }
  for (const [k, c] of chunks) {
    const [cx, cz] = k.split(',').map(Number);
    if (Math.abs(cx - scx) > VIEW + 1 || Math.abs(cz - scz) > VIEW + 1) {
      terrainGroup.remove(c.ground, c.ceiling);
      c.ground.geometry.dispose();
      c.ceiling.geometry.dispose();
      chunks.delete(k);
    }
  }
}
```

Call `updateTerrain(ship.position)` once per frame. Build at most one or two
chunks per frame (queue the rest) to avoid hitches.

---

## 5. Fade-in (hide the pop)

Build farther than you can clearly see and fog the far edge so chunks emerge from
haze instead of snapping in.

```js
scene.fog = new THREE.Fog(0x9ab4d2, CHUNK * (VIEW - 1.5), CHUNK * (VIEW + 0.5));
renderer.setClearColor(0x9ab4d2); // match the horizon
```

Keep `FogExp2` if you prefer; just make sure `VIEW * CHUNK` extends past where the
fog goes fully opaque. In open (non-pinch) stretches you can push the fog much
farther so the player sees the next pinch / landmark coming.

---

## 6. Tuning

The constants are at Ace Starship scale (small). LSS uses a much larger world
(camera far plane 25000), so scale to taste: divide `BASE_FREQ`/`WARP_FREQ` and
multiply `*_AMP`/`*_BASE`/`WARP`/`CHUNK`/the `F.*` distances by the same factor to
keep the *shape* identical while resizing.

| Knob | Effect |
| --- | --- |
| `GROUND_AMP` / `CEIL_AMP` | open-mountain peak height |
| `CEIL_BASE` | how low the ceiling hangs (smaller = tighter gap) |
| `BASE_FREQ` | peak spacing (smaller = fewer, broader mountains) |
| `EXPONENT` | peak sharpness |
| `WARP` | how much ridges meander |
| `F.PERIOD` / `F.LEN` | spacing of pinches and how much is walled vs open |
| `F.OPEN_HALF` / `F.NARROW_HALF` | lane width at a pinch's start / end |
| `F.MEET` | altitude the walls fuse at (set near flight height) |
| `F.GAMP_W` / `F.CAMP_W` | how craggy/tall the walls are |
| `F.FORK_EVERY` / `F.FORK_HALF` | fork frequency and ridge width |
| `CELLS` / `CHUNK` / `VIEW` | mesh detail, chunk size, draw distance |

Spawn the ship in the gap, on the lane centerline: roughly
`y = F.MEET`, on the forward axis with the cross axis at 0, and within `FIRST_OPEN`
so the first pinch is ahead of you.

---

## 7. Two ways to render it in LSS

**A. Heightfield mesh (above).** Simplest, matches the Roblox build, clean
low-poly mountains and walls. Limitation: one height per (x,z), so sealed walls
work by surface interpenetration (fine visually) and you can't carve caves.

**B. Marching cubes (you already have the worker).** Feed it a sandwich *density
field* instead of a heightmap for true closed walls, overhangs, and tunnels:

```
density(x, y, z) = min( y - groundY(x, z),      // positive above the floor
                        ceilY(x, z) - y )        // positive below the ceiling
// surface where density == 0; subtract a 3D noise term for caves/arches.
// In a pinch column groundY >= ceilY, so density is negative everywhere there
// (no surface) -> the column is solid rock, exactly the sealed wall.
```

Start with A to lock the feel, move to B if you want caves and crisp wall solids.

---

## 8. Performance notes

- Indexed geometry + `flatShading` keeps triangle counts low. Use a finer `CELLS`
  only for pinch chunks (detect via `envAtZ` over the chunk's forward span).
- Build chunks incrementally (1-2 per frame). `feature`/`envAtZ` are noise-free
  and nearly free; the cost is the `ridged` noise per vertex.
- `dispose()` geometries on unload (done above) to avoid GPU leaks.
- `groundY`/`ceilY`/`feature`/`solid` are pure functions of (x,z), so they run
  identically on a worker, the main thread, or server-side for collision/AI.

---

## Reference

- Ridged multifractal + power redistribution + domain warping: Red Blob Games,
  "Making maps with noise functions" (redblobgames.com/maps/terrain-from-noise).
- Mirrors the working Ace Starship implementation:
  `Ace_Starship/src/shared/WorldHeights.luau` (noise + corridor feature, shared by
  client visuals and server line-of-sight) and
  `Ace_Starship/src/client/Controllers/TerrainController.luau` (chunk voxelizer).
