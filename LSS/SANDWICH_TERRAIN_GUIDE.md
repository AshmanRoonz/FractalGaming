# Sandwich Terrain for LSS (Three.js)

How to build the procedural "sandwich" level: jagged mountains below, mirrored
mountains hanging above, flying through the open gap between. This is the same
technique prototyped in Ace Starship (Roblox), ported to LSS's Three.js stack
(r0.165, `BufferGeometry`, `FogExp2`, GLSL FBM, marching-cubes worker).

The whole effect is three ideas stacked: a good noise function for the shape, a
displaced mesh to render it, and chunk streaming so it's endless.

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

LSS only has noise in GLSL shaders, so here's a self-contained 2D CPU version
(no dependency, mirrors your shader's value-noise style):

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

// --- tuning (scale these to LSS world units; see section 5) ---
const T = {
  OCTAVES:   5,
  BASE_FREQ: 0.0088,   // smaller = fewer, broader mountains
  LACUNARITY: 2.0,
  GAIN:      0.5,
  EXPONENT:  2.3,      // >1 = sharper peaks, flatter valleys
  WARP:      24,       // domain-warp strength (world units)
  WARP_FREQ: 0.0048,
  GROUND_BASE: 0,   GROUND_AMP: 95,   // floor: peaks rise to ~AMP
  CEIL_BASE:   205, CEIL_AMP:   95,   // ceiling: flat at BASE, tips hang to BASE-AMP
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

function groundY(x, z) { const [wx, wz] = warp(x, z);               return T.GROUND_BASE + T.GROUND_AMP * ridged(wx, wz, 1.7); }
function ceilY(x, z)   { const [wx, wz] = warp(x + 4000, z - 4000); return T.CEIL_BASE   - T.CEIL_AMP   * ridged(wx, wz, 5.9); }
```

`groundY`/`ceilY` are the only entry points the rest of the system needs.

---

## 2. Building a chunk mesh

A chunk is a square grid of vertices displaced to the surface height. Use an
indexed `BufferGeometry` and let the material do flat shading for the low-poly
look (no need to duplicate vertices).

```js
// size = world width of the chunk, cells = grid resolution (e.g. 8 => coarse/low-poly)
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

Materials (flat-shaded low-poly; swap for your wall/pipe textures or a shader
later):

```js
const groundMat  = new THREE.MeshStandardMaterial({ color: 0x747a86, flatShading: true, roughness: 1 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x484c5a, flatShading: true, roughness: 1, side: THREE.BackSide });
```

For the **ceiling**, either reverse the triangle winding (swap the index order)
or render with `side: THREE.BackSide` so its faces point down into the gap.

`flatShading: true` gives the faceted look from few triangles. Drop it (and call
`computeVertexNormals`) for smooth shading.

---

## 3. Streaming chunks (endless world)

Keep a window of chunks around the ship; add new ones ahead, drop ones behind.
Drive it from LSS's existing animate loop using the ship's world position.

```js
const CHUNK = 800;     // world units per chunk (LSS scale; tune)
const CELLS = 10;      // triangles per chunk side
const VIEW  = 4;       // chunk radius kept loaded
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const chunks = new Map();        // "cx,cz" -> { ground, ceiling }

function keyOf(cx, cz) { return cx + ',' + cz; }

function updateTerrain(shipPos) {
  const scx = Math.floor(shipPos.x / CHUNK);
  const scz = Math.floor(shipPos.z / CHUNK);

  // add chunks in view
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
  // drop chunks out of view
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

Call `updateTerrain(ship.position)` once per frame in LSS's render loop. To avoid
hitches, build at most one or two chunks per frame (queue the rest), exactly like
the Roblox version.

---

## 4. Fade-in (hide the pop)

Build a bit farther than you can clearly see, and fog the far edge so new chunks
emerge from haze instead of snapping in. LSS already sets `scene.fog`. For a hard
build-radius fade, linear fog is easiest to tune to the streaming distance:

```js
// fade matched to VIEW * CHUNK so chunks appear inside the haze
scene.fog = new THREE.Fog(0x9ab4d2, CHUNK * (VIEW - 1.5), CHUNK * (VIEW + 0.5));
renderer.setClearColor(0x9ab4d2); // match the horizon so terrain dissolves into sky
```

Keep your existing `FogExp2` instead if you prefer the look; just lower the
density so distant peaks are visible, and make sure `VIEW * CHUNK` extends past
where the fog goes fully opaque.

---

## 5. Tuning for LSS's scale

The constants above are at Ace Starship scale (small). LSS uses a much larger
world (camera far plane 25000), so scale the noise to taste. The trick that keeps
the *shape* identical while resizing is: divide `BASE_FREQ`/`WARP_FREQ` and
multiply `*_AMP`/`*_BASE`/`WARP`/`CHUNK` by the same factor.

| Knob | Effect |
| --- | --- |
| `GROUND_AMP` / `CEIL_AMP` | peak height |
| `CEIL_BASE` | how low the ceiling hangs (smaller = tighter gap) |
| `BASE_FREQ` | peak spacing (smaller = fewer, broader mountains) |
| `EXPONENT` | peak sharpness (higher = spikier, flatter valleys) |
| `WARP` | how much ridges meander |
| `CELLS` | triangles per chunk (face count vs detail) |
| `CHUNK` / `VIEW` | chunk size and how far it draws |

Spawn the ship in the gap: roughly `y = (GROUND_AMP + (CEIL_BASE - CEIL_AMP)) / 2`.

---

## 6. Two ways to render it in LSS

**A. Heightfield mesh (above).** Simplest, matches the Roblox build, gives clean
low-poly mountains. Best starting point. Limitation: a heightfield can't make
caves or overhangs (one height per x,z).

**B. Marching cubes (you already have the worker).** LSS builds levels through
`initializeMarchingCubesWorker()`. You can feed it a sandwich *density field*
instead of a heightmap to get overhangs, arches, and tunnels through the rock:

```
density(x, y, z) = min( y - groundY(x, z),      // positive above the floor
                        ceilY(x, z) - y )        // positive below the ceiling
// surface where density == 0; subtract a 3D noise term from it for caves/arches
```

This reuses your existing level pipeline and matches LSS's volumetric look, at
more CPU cost. Start with A to lock the feel, move to B if you want caves.

---

## 7. Performance notes

- Indexed geometry + `flatShading` keeps triangle counts low; `CELLS = 8-12`
  per chunk is plenty for a low-poly look.
- Build chunks incrementally (a queue, 1-2 per frame) so generation never stalls
  a frame. `valueNoise2` is cheap, but a full chunk is hundreds of samples.
- `dispose()` geometries when unloading chunks (done above) to avoid GPU leaks.
- If you need it on a worker, the noise + vertex/index arrays compute fine
  off-thread; post the typed arrays back and build the `BufferGeometry` on the
  main thread (same pattern as your marching-cubes worker).

---

## Reference

- Ridged multifractal + power redistribution + domain warping: Red Blob Games,
  "Making maps with noise functions" (redblobgames.com/maps/terrain-from-noise).
- This guide mirrors the working Ace Starship implementation
  (`Ace_Starship/src/client/Controllers/TerrainController.luau`).
