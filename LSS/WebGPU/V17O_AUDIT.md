# v17o vs WebGPU port : honest audit

The point of this document is to **stop guessing**. For each visual system in v17o I'll write:
- What v17o actually does (line refs, plain-language summary)
- What our port currently does (honest, including invented substitutes)
- The delta + whether a "fix" is needed or already inventing-our-own is acceptable

Verdicts used:
- **FAITHFUL** : port matches v17o behavior
- **PARTIAL** : core idea ported, details drift
- **MISSING** : v17o does this, port doesn't
- **INVENTED** : port has something v17o doesn't (made up by me); should be retired or marked as deliberate deviation

---

## TODO sections (filling in as I read)
- [x] Clouds (BCS / GasCloud / atom-smoke / ambient Dots)
- [x] Lightning (chemistry / attraction / arc / basin spawn)
- [x] Shields (energy + hull-hug + ability shields)
- [x] Rocks (ClusterObstacle full)
- [x] Explosions + plumes + sparks
- [x] Organics / walls / dots
- [x] Summary : list of bugfixes that should be retired

---

## 1. Clouds

### What v17o actually does

v17o has ONE unified sprite system (`BillboardCloudSystem`, v17o:9964) plus a
separate higher-fidelity shader-smoke layer (`spawnDot` ambient clouds,
v17o:25478) that uses its own `_SMOKE_GEO` + `_makeSmokeMaterial`. Then it
layers four spawners on top.

#### 1a. BillboardCloudSystem (BCS) — the engine

- One scene-wide `InstancedBufferGeometry` with 8192 slots (`new BillboardCloudSystem(scene, { maxSlots: 8192 })`, v17o:10669).
- Custom ShaderMaterial : camera-facing billboard built from view matrix, FBM
  noise inside each quad, per-slot `iSeed` so adjacent sprites read as
  distinct wispy patches rather than identical circles.
- Per-slot attributes : `iPosition`, `iScale`, `iColor`, `iAlpha`, `iSeed`.
- Inactive slots cull cheaply (`iAlpha < 0.001` → degenerate gl_Position).
- 8-slot light uniform array (`uLightPos[8]`, `uLightColor[8]`,
  `uLightStrength[8]`) so sprites pick up nearby projectile color
  (driven per-frame by `updateBCSLighting`).

#### 1b. GasCloud — the unit of gas (v17o:10239)

Each gas pod is a `GasCloud` that claims N slots from BCS (default 8, up to
17 for the dense atom-smoke variant). Per-slot bookkeeping :
- Random offset in a bounds volume (cube-root distribution for uniform
  volume density).
- Per-axis Lissajous drift : `driftPhaseX/Y/Z`, `driftSpeed`, `driftAmp`.
  Each sprite slowly oscillates in 3 axes so the cloud is alive even when
  stationary (toggled off in Potato).
- `wakeOff` Vector3, integrated by `applyWake`.
- `setPosition(x,y,z)` writes the slot positions every frame as
  `position + offset + wakeOff + churn`.

`applyWake(srcX, srcY, srcZ, velX, velY, velZ, strength, radius, dt)`
(v17o:10371) is fluid-like and has THREE components, not one :
1. **Velocity drag** — sprites inherit some of the source's motion and
   get carried along (`s.wakeOff += vel * dragK`).
2. **Perpendicular tube push** — sprites near the source's flight path get
   shoved perpendicular to that path, creating the visible "tube cut through
   gas" wake.
3. **Weak magnetic pull** — small tug toward the source for cosmetic nudge.

#### 1c. The four cloud spawners

1. **Cluster atom-smoke** (v17o:21073, `_buildChildSmokeSphere`) — EACH
   rock child in a `ClusterObstacle` gets its own `GasCloud` at
   `child.position` with `boundsRadius = child.scale × 3.2`, sprite count
   17, alpha 0.80, color = `_smokeColorFromRock(cluster.baseColor)` (hue
   preserved, saturation × 0.4, lightness lifted toward smoke).
2. **Basin clouds** (v17o:21818, `_spawnBasinClouds`) — runs at arena
   build. For each `levelSpheres` sphere, detects "basin" status by
   walking `levelCylinders` and checking whether any attached tunnel
   exits the sphere through the lower hemisphere (yFrac < -0.5). Spheres
   with NO downward drain spawn a pool of 12-16 GasClouds in the lower
   hemisphere (`poolY = sphere.cy - sphere.r * 0.30`), inheriting color
   from the nearest cluster (within 1.5× sphere radius). Each cloud has
   `emitsLightning` so the chemistry walk includes them.
3. **Ambient cloud Dots** (v17o:25478, `_maybeSpawnAmbientCloudDot`) —
   periodic spawn (every 2.5-4.5s) up to `_AMBIENT_CLOUD_MAX` total. Each
   is a `spawnDot(position, opts)` with **infinite lifetime**, a 4-7s
   sprout (alpha ramp-in, no scale-up — would read as jello), and
   `_SMOKE_GEO` + `_makeSmokeMaterial` (its own shader, NOT BCS), with
   internal pluming : 4-7 mini-cluster puffs that orbit + pulse inside the
   parent cloud volume so it reads as a living weather system. Spawned in
   a torus 800-2200 units from the player. Each carries
   `clusterAttraction: true`, `attractRange: 1800`, `emitsLightning: true`.
4. **Detached gas pockets** (v17o:21101+) — when a cluster child dies, its
   `_atomSmoke` GasCloud is NOT disposed ; it's detached with a small
   random velocity and added to `game.detachedGasPockets`. The drift /
   chemistry tick takes it from there.

### What our port currently does

- **No BCS at all.** The custom shader was skip-listed at the start of the
  WebGPU port (TSL conversion risk). Every cloud-ish thing is plain
  `THREE.Sprite` with a multi-octave-noise canvas texture.
- **`_ambientClouds`** (#329 → #340) — 20 sprites at 1800-3500 distance,
  size 400-900, opacity 0.25-0.45. Hand-tuned at boot, never refreshed.
- **`_clusterAttachedClouds`** (#326) — Map keyed by cluster, value
  `{ slots, radius, baseTint, flare }`. Each cluster gets 3-sprite swarm
  at offsets within radius × 0.95 (cube-root distribution copied from
  v17o GasCloud), per-slot churn similar to v17o's drift.
- **`_clusterFlare` + halo** (#332 / #334) — INVENTED. Each cluster gets
  ONE big additive sprite at its center + a second halo sprite at 3.2×
  → 1.5× (#340). v17o has no such effect — its cluster brightness comes
  from the atom-smoke `GasCloud` shader picking up scene lights.
- **Basin pockets** (#331) — INVENTED. Spawns 12 detached pockets in 4
  tight hubs (3 pockets per hub, 240-unit spread) at first frame of
  'playing'. v17o spawns basin gas in PHYSICAL BASIN SPHERES (rooms
  whose tunnels don't drain downward), not in invented hubs.
- **`_detachedGasPockets`** drift tick (#314 onward) — has port of v17o's
  drag + bow-wave + magnetic pull from `applyWake`, sparkTimer chemistry,
  cloud-cloud attraction. Closer to v17o than the rest, but uses our
  sprite swarm visual not BCS shader.
- **Dust field** (#335 / #337) — INVENTED. 2000-point `THREE.Points`
  cloud at 100-1200u from player, additive with radial-gradient texture.
  v17o has no such effect — it relies on dense BCS slots for fine
  atmospheric shimmer.

### Verdict per piece

| Piece | Status |
|---|---|
| BillboardCloudSystem | **MISSING** — skip-list at port start. All cloud visuals downgraded as a result. |
| GasCloud per-child atom-smoke | **MISSING** — v17o gives EACH rock its own gas pod ; we attach ONE swarm to the cluster center. |
| Basin clouds in basin spheres | **MISSING** — replaced by **INVENTED** "basin hub pockets" near player (#331). |
| Ambient cloud Dots (shader smoke + internal pluming) | **MISSING** — replaced by **PARTIAL** sprite-only ambient layer (#329 / #340). |
| Detached pocket drift + wake | **PARTIAL** — physics ports cleanly, visual lacks BCS shader. |
| Cluster flare (#332) | **INVENTED** — retire candidate. |
| Cluster halo (#334) | **INVENTED** — retire candidate. |
| Dust field (#335) | **INVENTED** — retire candidate. |
| `applyWake` 3-component fluid wake | **PARTIAL** — drag + tube + pull all ported in `_tickDetachedGasPockets`, but only applied to detached pockets, not to cluster-attached or ambient clouds. |

### What a faithful port looks like

The skip-list decision to drop BCS is the root of every cloud-system delta.
Two paths forward, neither code yet :

- **Option A : port BCS to TSL NodeMaterial.** The shader is ~80 lines of
  GLSL + a 5-slot uniform array. Risky on WebGPU (NodeMaterial + custom
  attributes + InstancedBufferGeometry is the same combo that crashed our
  fire material in #327→#328), but if it works, every cloud piece falls
  into place uniformly. The BCS recipe is exact and reproducible.
- **Option B : keep sprite-based, but match v17o's STRUCTURE.** One pool
  of `Sprite` instances. One spawn per concept (atom-smoke per child, basin
  per basin-sphere, ambient dot per torus location). Drop the invented
  flare/halo/dust. Then the ports of `applyWake` and `updateGasChemistry`
  drive everything uniformly. Same visual shape as v17o, just lower
  fidelity per-sprite (no shader noise inside each quad).

---

## 2. Lightning

### What v17o actually does

There are THREE coordinated systems : a single layered-arc factory, a
chemistry walker that fires arcs between gas pockets, and an attraction
solver that drives pockets into lattices which the chemistry then reads
to scale arc intensity. A separate Dot-based ambient lightning pathway
also exists (via `spawnDot` `emitsLightning: true`).

#### 2a. `_spawnLayeredGasArc(from, to, scale)` (v17o:22460)

Single entry point for ALL chemistry arcs. `scale` is 0..1 where 0 is a
sparse lone-drifter pair and 1 is the densest lattice. Composes :

1. **Halo bolt** : wider softer outer pass. Color shifts from pale
   blue-white (`0xa8c8ff`) at low scale to icy lavender-white
   (`0xccdfff`) at high. Lifetime `0.22 + scale * 0.10`s, branches
   `2 + floor(scale * 2)`, thickness `2.0 + scale * 2.4`.
2. **Bright core bolt** : narrow inner pass, always `0xeef2ff` ice-white.
   Lifetime `0.16 + scale * 0.08`s, branches `1 + floor(scale * 2)`,
   thickness `0.8 + scale * 0.8`.
3. **Offset crackle** : ONLY when `scale > 0.55`. A parallel thin spark
   8-14 units off-axis (random unit direction × 8-14), color `0x88ccff`,
   lifetime `0.14 + scale * 0.06`, thickness `0.7`. Gives the conduit
   visible 3D thickness at high density.
4. **Path-aligned glow particles** : `4 + floor(scale * 6)` particles
   sampled at random `t` along `(from→to)`, transverse spread
   `6 + scale * 8` per axis, random velocity 30 unit/s, life 0.14-0.26s,
   color alternates `0xaaccff` / `0xddeeff`, size 2.5-4.5. So a sparse
   pair gets 4 embers along the bolt ; a dense lattice arc gets 10
   sprites along it forming a fat blue halo.

#### 2b. `updateGasChemistry(dt)` (v17o:22536)

- `GAS_REACT_RADIUS = 200` for both detached-vs-detached AND
  detached-vs-cluster.
- `GAS_SPARK_INTERVAL_MIN = 12.0s` / `MAX = 30.0s`. Each pocket carries a
  `_sparkTimer` initialized to `Math.random() * 30`, ticked down every
  frame.
- **Detached × detached walk** : for every pair (i, j) with i < j, if
  d² < 200², compute `intensity = 1 + (1 - dist/200) * 1.6` (range
  1.0 → 2.6). If `a._sparkTimer <= 0` :
  - **Lattice decision** : if `a._latticeNeighbors >= 2` AND
    `b._latticeNeighbors >= 2`, it's a lattice arc. Compute
    `denseFrac = min(1, (min(aN, bN) - 1) / 4)` (0 at exactly 2
    neighbors, 1 at 6+) and call
    `_spawnLayeredGasArc(ap, bp, 0.35 + denseFrac * 0.65)` →
    scale 0.35 to 1.00.
  - **Else sparse pair** : `_spawnLayeredGasArc(ap, bp, 0)` → scale 0,
    halo+core only, no offset crackle, minimal path glow.
  - Reset `a._sparkTimer = (12 + Math.random() * 18) / intensity`.
    Close pairs cool down faster, fire more often.
- **Detached × cluster walk** : for each pocket × intact cluster, if
  d² < 200² and `cl.alive && !cl.broken`, fire
  `_spawnLayeredGasArc(pp, cl.position, 0.20)`. Resets timer the same
  way as pair walk but with `intensity = 1 + (1 - dist/200) * 1.0`
  (lower cap than pair walk, since rocks are a "ground" reference).

#### 2c. `_applyCloudAttraction(dt)` (v17o:22141)

Drives detached pockets into local lattices over time. Per pair :
- `equilibriumD = (aR + bR) * 2.0`, `range = (aR + bR) * 2.5`.
  Attraction only kicks in when pockets are already within 2.5 cloud
  radii.
- `d < equilibrium` → quadratic repulsion (always full strength so
  clouds never stack into one blob).
- `d > equilibrium` → quadratic attraction toward equilibrium, scaled
  by `speedScale = 1 / (1 + pairSpd * 0.012)`. Stationary pockets bond
  ; fast-moving pockets (in a wake) escape the lattice.
- **Tangential damping** : projects relative velocity onto radial
  direction, damps only the perpendicular component, bleeds off
  orbital motion so pockets settle instead of orbiting forever. Also
  speed-scaled.
- **Counts `_latticeNeighbors`** per pocket every frame — this is what
  feeds the chemistry's lattice decision.
- **Skipped in potato mode** (~O(D²)).

#### 2d. Dot lightning (separate pathway, ambient + basin)

`spawnDot(pos, { emitsLightning: true, arcRadius, interArcRange, ... })`
(used by both ambient cloud Dots and basin clouds) registers the dot
into the global Dot lightning chain — distinct array from
`game.detachedGasPockets`, distinct cadence. Each Dot fires inter-arcs
to other Dots within `interArcRange` based on its own timer + the
`_isAmbientCloud` flag for the cap counter. This is what produces the
"big atmospheric lightning between the indestructible nebula Dots"
visual that's separate from the per-pocket chemistry.

### What our port currently does

- **`_tickDetachedGasPockets` chemistry pass** (`last_ship_sailing_webGPU.html`
  lines around 9395-9454) does detached × detached AND detached × cluster
  walks BUT :
  - Inlines hardcoded arc layers via 3 direct `spawnLightningBolt` calls
    with fixed lifetimes (0.55 / 0.45 / 0.30) and thicknesses
    (4.5 / 2.8 / 1.4) regardless of pair density.
  - Has no concept of `_latticeNeighbors` or density scaling. Every arc
    looks identical.
  - Has no offset crackle.
  - Spawns no path-glow particles.
  - Timer range 8-20s (pair) and 10-24s (cluster), so arcs fire slightly
    more often than v17o's 12-30s (close to right).
- **`_applyCloudAttraction`** (#318 / line ~9465) is a SIMPLER linear
  attraction : always-attract, range 600u (constant), no equilibrium,
  no repulsion, no speed scaling, no `_latticeNeighbors` counting.
  Pockets would all clump into one mass over time if they didn't
  randomly velocity-decay first.
- **`spawnLightningBolt`** (post #345) renders TubeGeometry along a
  fractal path with branches. Visual fidelity reasonable.
- **NO Dot lightning pathway** — we never built the Dot anchor system,
  so the ambient-cloud-to-ambient-cloud arcing v17o gets through the
  Dot chain doesn't exist.
- **Basin pockets** (#331) are spawned in invented hubs, not in physical
  basin spheres (see Clouds section).

### Verdict per piece

| Piece | Status |
|---|---|
| `_spawnLayeredGasArc` unified factory | **MISSING** — inlined as 3 hardcoded `spawnLightningBolt` calls per pair, no density scaling, no offset crackle, no path glow. |
| Lattice scaling via `_latticeNeighbors` | **MISSING** — every arc is the same regardless of density. |
| Path-aligned glow particles along the bolt | **MISSING** — bolts are bare lightning, no surrounding embers. |
| Offset crackle on dense lattice | **MISSING**. |
| Chemistry pair walk + cluster pair walk | **PARTIAL** — structure ports, but visual output is uniform instead of density-scaled. |
| Spark timer 12-30s | **PARTIAL** — ours is 8-24s, slightly more frequent. |
| `_applyCloudAttraction` quadratic equilibrium + repulsion + speed-gated escape + tangential damping + lattice neighbor count | **INVENTED substitute** — replaced by a much simpler always-attract linear pull (#318). Loses the lattice formation, loses the wake-escape, loses the `_latticeNeighbors` counts that lattice arcs depend on. |
| Dot lightning pathway (ambient + basin) | **MISSING** entirely. |
| `spawnLightningBolt` rendering | **FAITHFUL** post #345 (TubeGeometry along fractal path with branches). |

### What a faithful port looks like

Three concrete deltas to close (in order of visual impact) :

1. **Add `_spawnLayeredGasArc(from, to, scale)` and route both chemistry
   walks through it.** Then implement the lattice decision in the pair
   walk : if both pockets have `_latticeNeighbors >= 2`, compute
   denseFrac and call with scale 0.35-1.00 ; else scale 0. This alone
   gives us density-aware arcs + offset crackle + path glow particles
   for free.
2. **Replace the #318 attraction with v17o's quadratic
   equilibrium-with-repulsion + speed-scaled + tangential-damped
   solver.** Also sets `_latticeNeighbors` per frame, which item 1
   depends on. Without this, item 1 always picks "sparse pair" because
   no pocket ever counts neighbors.
3. **Port basin spawn to USE basin spheres** (see Clouds 1c.2) — at
   arena build, walk `game.levelSpheres`, find basin spheres, spawn 12-16
   pockets each in the lower hemisphere. This + #2 produces dense
   lattices in basin pools, which item 1 reads as max-scale arcs. The
   constant lightning the user expects emerges from THIS, not from
   spawning random hubs near the player.

---

## 3. Shields

### What v17o actually does

v17o has TWO totally distinct shield concepts that share none of their
visual code :

- **Per-ship energy shield bubble** — every ship has one of these
  (built into the ship mesh, never disposed). Custom ShaderMaterial.
  Visible only when an ability lifts `intensity` or when `flashShieldImpact`
  / `recordShieldHit` is firing.
- **Per-ability hull-hug shields** — built on demand when a specific
  ability is active (Vortex Shield, Body Shield, Thermal Shield, etc.),
  disposed when the ability ends. Each one is a mesh-tree mirror of the
  ship at 1.07× scale with a LayeredFX plasma material colored to the
  ability's preset.

#### 3a. Per-ship energy shield ShaderMaterial (v17o:7003-7213)

- Uniforms : `shieldColor`, `intensity` (0 default = invisible),
  `impact`, `time`, `uHitDirs[4]` (vec3 unit dirs, object space),
  `uHitAges[4]` (floats), `uHitColors[4]` (vec3 per-hit tints),
  `uRippleMaxAge` (0.55s).
- Vertex shader passes `vNormal`, `vViewPos`, `vWorldPos`, and a
  per-vertex `vObjPos = normalize(position)` — the unit direction on
  the sphere in object space, which the fragment uses to compare
  against each hit direction.
- Fragment shader has FOUR independent contributions :
  1. **Per-fragment fresnel** : `pow(1 - clamp(dot(N, V), 0, 1), 2.5)`.
     Bright silhouette, dim center.
  2. **Scrolling hex grid** : sampled in `(atan(z,x)*2, y*0.005)` then
     time-scrolled. Adds the iconic sci-fi force-field detail.
  3. **`impact` uniform whole-dome flash** : `impact * 0.5` adds to
     base alpha, `impact * 2.0` multiplies the color. Distinct from
     ripples — this is a uniform whole-shield brightness pulse,
     decayed by `tickEnergyShields` at 4/sec.
  4. **4-slot ripple ring buffer** : for each active slot
     (`age < uRippleMaxAge`), compute angular distance from this
     fragment's `vObjPos` to `uHitDirs[i]`. Hot spot at the hit point
     fades in the first half of life ; ring expands from 0 to π over
     lifetime with bandwidth 0.18 rad. Strength
     `= ringBand * 1.05 + hotSpot * 2.20`, multiplied by `(1 - ageT)`
     for fade-out. Color tinted by `uHitColors[i]`.
  - **Early discard** : if `intensity < 0.001` AND total ripple
    contribution < 0.001, discard. Critical perf optimization since
    shields are invisible most of the time.
  - **Final** : color = `mix(shieldColor, hot, hex*0.4 + impact) *
    (1.2 + impact*2.0) + rippleCol * 1.6`. Alpha =
    `(fr*0.7 + hex*0.15 + impact*0.5) * intensity + rippleA`.
  - AdditiveBlending, depthWrite false, DoubleSide.

- `setShieldIntensity(mesh, level)` (v17o:7194) writes
  `uniforms.intensity.value`. Used by `updateShieldVisuals` to turn the
  dome on/off for ability shields.
- `flashShieldImpact(mesh, amount)` (v17o:7203) lifts the `impact`
  uniform to `max(current, amount)`. SEPARATE call from
  `recordShieldHit` ; this is the whole-dome flash. Decay at 4/sec
  inside `tickEnergyShields`.
- `recordShieldHit(shipMesh, worldHitPoint, color)` (v17o:7162)
  worldToLocal the hit point, normalize to unit direction, pick a free
  slot (or oldest active among 4), write dir + age=0 + color. Per-frame
  `tickEnergyShields` advances each of 4 ages.

#### 3b. Ability hull-hug shields (v17o:30416 `_makeHullHugShield`)

- Mirror the ship's exact mesh hierarchy via `_mirrorMeshTree(player.mesh, mat)`.
  Shares geometry refs (read-only) but assigns a single shared LayeredFX
  plasma material to every leaf.
- Result : shield takes the EXACT SHAPE of the hull (wings, cockpit,
  fins) at 1.07× uniform scale. NOT a sphere or ellipsoid.
- Preset color via `_makeFXMaterial(presetName)`. Preset names :
  `plasma_cyan` (BLASTER Body Shield), `plasma_red` (PYRO Thermal
  Shield), `plasma_purple` (VORTEX Vortex Shield), `plasma_green`
  (SLAYER Sword Block), `plasma_amber`, `plasma_wall`.
- Each preset is a LayeredFX ShaderMaterial with its own
  uniforms (uTime, uHp, uIntensity, uHitRadius, uPosScale, etc.).
- AdditiveBlending, DoubleSide, depthWrite false.
- Child of `player.mesh` so it inherits transform.

#### 3c. `updateShieldVisuals(dt)` (v17o:30609) — the orchestrator

Per ability, evaluates whether to build/maintain/teardown the hull-hug
shield. For each ability shield (Vortex / Body / Thermal / Sword
Block / Plasma Shield), the pattern is :

1. **Check active condition** (e.g. `loadoutKey === 'VORTEX' &&
   abilityActive[1] && abilities[1].name === 'Vortex Shield'`).
2. **If active and no shield exists** : build via `_makeHullHugShield`,
   add as child of `player.mesh`.
3. **If active** : update uniforms (`uTime`, `uHp` ← energyFrac,
   `uIntensity` ← 1.7 + 0.9 * energyFrac for Vortex), call
   `_setShipShieldEmissive` to push hull color toward the shield tint,
   show CSS overlay (`#ov-vortex-shield`), play sound loop.
4. **If not active** : tear down — call `_disposeShieldClone`,
   `_clearShipShieldEmissive`, hide CSS overlay.

Some ability shields ALSO touch the per-ship energy shield bubble
(e.g. PYRO Thermal Shield scanline animation, TRACKER Plasma Shield
spawnParticleWall). Each has its own ability-specific behavior layered
on top of the hull-hug shell.

#### 3d. Other shield-adjacent visuals

- **Hologram scanline texture** (v17o:7220+ `_scanlineTexture` + procedural
  canvas) used by Tracker's Plasma Shield and Blaster's Body Shield :
  mid-gray base with bright horizontal stripes + thicker stripes every
  32px, animated vertically each frame so it reads as classic sci-fi
  hologram flicker.
- **CSS inside-cockpit overlays** (e.g. `#ov-vortex-shield`) :
  full-screen DOM divs with hex-grid backgrounds toggled via
  `.show` class, so the pilot sees the shield "from inside" their own
  ship even though the 3D shell is outside.

### What our port currently does

- **`_makeEnergyShieldMaterial`** (post #343) : TSL NodeMaterial with
  fresnel + scrolling hex + 1-slot ripple (uHitDir, uHitAge, uHitCol,
  uMaxAge). `uIntensity = 0` baseline = invisible. Matches v17o's resting
  behavior.
- **`recordShieldHit`** post #343 : worldToLocal + normalize +
  uHitDir.value.copy + uHitAge.value = 0. Matches v17o except for the
  ring buffer size.
- **`tickEnergyShields`** post #343 : advances uHitAge per frame. Same
  shape as v17o, single slot.
- **`_makeHullHugShield`** post #341/#342 : `SphereGeometry(1, 48, 32)`
  scaled to chassis dimensions (halfW × halfH × halfL) — generic ELLIPSOID,
  not a mesh-tree mirror. Material is either `_makeEnergyShieldMaterial`
  (post #342) at intensity 0.45 or a plain MeshBasicMaterial fallback.
- **`updateShieldVisuals`** : NOT PORTED. Ability shields don't appear.
- **LayeredFX presets** (plasma_cyan / red / purple / etc.) : NOT PORTED.
  Our `_SHIELD_PRESET_COLORS` map is just hex codes ; the underlying
  shader presets don't exist.
- **`flashShieldImpact`** whole-dome flash : NOT PORTED. We only have
  the per-hit directional ripple.
- **Scanline texture** : NOT PORTED.
- **CSS overlays** (`#ov-vortex-shield` etc.) : likely missing or
  stubbed.

### Verdict per piece

| Piece | Status |
|---|---|
| Energy shield ShaderMaterial recipe (fresnel + hex + impact + ripple) | **PARTIAL** — fresnel + hex + 1-slot ripple ported via TSL ; missing `impact` whole-dome flash uniform AND 3 of 4 ripple slots. |
| `setShieldIntensity` (controls dome visibility) | **PARTIAL** — `uIntensity` uniform exists, but no `updateShieldVisuals` orchestrator writes it for ability shields, so it stays at 0 except during the perk hull-hug case. |
| `flashShieldImpact` whole-dome flash | **MISSING**. |
| `recordShieldHit` 4-slot ring buffer | **PARTIAL** — single slot only. Rapid fire overwrites previous ripples. |
| `_makeHullHugShield` mesh-tree mirror at 1.07× | **MISSING** — replaced by **INVENTED** generic ellipsoid sized from chassis dims. Ability shields read as "ship is inside a sphere" not "ship is glowing in its own shape". |
| LayeredFX plasma presets | **MISSING** — only hex color map exists. |
| `updateShieldVisuals` orchestrator | **MISSING** — Vortex Shield / Body Shield / Thermal Shield / Sword Block / Plasma Shield don't have their visuals wired. |
| `_setShipShieldEmissive` / `_clearShipShieldEmissive` | **FAITHFUL** (ported #239). Helper functions are correct ; they just aren't called because `updateShieldVisuals` isn't ported. |
| Scanline texture for hologram shields | **MISSING**. |
| CSS overlays inside-cockpit (`#ov-vortex-shield`, etc.) | **MISSING / unknown** — need to check our HTML. |
| Wireframe lattice from #341 | **INVENTED and REVERTED** in #342. Don't bring it back. |

### What a faithful port looks like

In order of visual impact :

1. **Port `_makeHullHugShield` to use `_mirrorMeshTree`.** This is the
   single biggest visual delta. v17o's ability shields look like the ship
   wrapped in glowing plasma matching every wing and fin ; ours look like
   a sphere around a ship. The recipe is straightforward : walk the ship
   mesh tree, build a parallel tree sharing geometry refs (don't clone
   geometry), assign the shared plasma material to every leaf, scale 1.07×.
   `_mirrorMeshTree` exists (`#247` ported it for Outline Optics) so the
   helper is already there.
2. **Add the `impact` uniform whole-dome flash.** Distinct from the
   directional ripple. `flashShieldImpact(mesh, amount)` sets it ;
   `tickEnergyShields` decays it at 4/sec. Adds a uniform brightness
   pulse on top of the ripple, which is how v17o reads "got hit hard"
   from any viewing angle.
3. **Expand ripple buffer to 4 slots.** Cheap (3 more vec3 + 3 more
   floats per shield material) ; rapid fire stops overwriting prior
   hits. v17o does this exactly.
4. **Port `updateShieldVisuals` so ability shields actually appear.**
   Right now Vortex Shield / Body Shield / Thermal Shield / Sword
   Block do their damage absorption logic but don't show a visual.
   This is a multi-ability port ; can be incremental, one ability at a
   time.
5. **Port at least the cyan/red/purple/green LayeredFX presets** —
   either as TSL NodeMaterial variants of our shield material with
   different base behavior (PYRO scanline, BLASTER smooth, etc.) or
   as carefully tuned NodeMaterial parameter sets. Lower priority
   than 1-4.

---

## 4. Rocks (ClusterObstacle full)

### What v17o actually does

A `ClusterObstacle` is a tumbling group of `DestructibleObstacle` children
(the actual rock pieces). The children are the unit of damage; the
cluster is the orchestrator that breaks all children at once and routes
collision.

#### 4a. `DestructibleObstacle` (v17o:20420+) — the rock piece

Used both standalone AND as cluster children. Built from one of 5 shape
types (`_buildMesh`, v17o:20441) :

- `box` : `BoxGeometry(sx, sy, sz)` with per-axis random scale 0.6-1.4.
- `diamond` : `OctahedronGeometry(scale, 0)`.
- `cross` : `DodecahedronGeometry(scale * 0.75, 0)`.
- `wedge` : `ConeGeometry(scale * 0.7, scale * 1.4, 5)`.
- `ring` : `TorusGeometry(scale * 0.6, scale * 0.25, 8, 12)`.

Material : `MeshStandardMaterial({ color: baseColor, metalness: 0.05,
roughness: 0.95, emissive: baseColor, emissiveIntensity: 0.06,
flatShading: true })`. Low metalness + high roughness + flatShading =
chunky grainy rock, not chrome jewel.

Edge mesh : a CLONED geometry at 1.06× scale with
`MeshBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.08 })`
overlaid on top. The cyan rim glow is what gives every rock its
signature "alien/energetic" outline.

Each instance carries : `hp`, `broken`, `alive`, `position`, `rotation`,
`fragmentVel` (Vector3), `fragmentLife`, `fragmentMaxLife`, `pushVel`
(Vector3), `collisionRadius`, optional `cluster` back-ref.

#### 4b. `_makeAtomFractalMaterial` (v17o:~20780)

Custom `ShaderMaterial` used ONLY for the rock chunks that fly out when
a child dies (`spawnRockChunks`). Vertex shader passes `vLocalPos`,
`vNormal`, `vWorldPos`. Fragment shader :
- Raymarched fractal noise sampling local position (8-iteration
  inversive folding loop with `rotate3D(time, axis)` rotation).
- Hash-based 3D value noise + 3-octave FBM for surface texture.
- Two FBM scales : `lowFreq` darkens crevices, `highFreq` adds grain.
- Density-driven HSV color with hue/saturation tinted by `uBaseColor`.
- Fresnel rim glow at silhouette (`uBaseColor * fres * 0.22`).
- Final : `(base + rim) * texMod`. With `uOpacity` alpha.

So chunks read as "alive plasma rocks" with shifting fractal interiors,
not just tinted spheres.

#### 4c. `spawnRockChunks(pos, baseColor, parentScale)` (v17o:20977)

When a child dies (`destroy()`), spawn 4-8 chunks. Each :
- Geometry : `_makeRockGeometry(0, seed)` — 20-tri irregular icosahedron
  with per-vertex radial displacement.
- Material : `_makeAtomFractalMaterial(baseColor)` — full fractal shader.
- Scale : `parentScale × (0.20 + Math.random() × 0.25)`.
- Velocity : random unit direction × (80-220 unit/sec).
- Rotation velocity : random ±6 rad/sec per axis.
- Lifetime : 1.4-2.6s.
- Lives in `game.effects` with `type: 'rockChunk'`, ticked by
  `updateEffects` (drift + rotate + fade + auto-dispose).

#### 4d. `ClusterObstacle.breakApart(hitPos, hitDir)` (v17o:21648)

The shatter event. Triggered by ANY weapon damage hitting any child OR by
ship ram at ≥ 220 unit/sec :

1. Sets `this.broken = true`.
2. Disposes the distortion shell (cluster envelope).
3. For every per-child `_atomSmoke` GasCloud (Clouds 1c.1), DETACHES
   instead of disposing : pushes into `game.detachedGasPockets` with a
   random ±80 unit/sec outward impulse. The cloud survives the rock's
   death and continues drifting + reacting.
4. For every alive child :
   - `c.broken = true`, `c.fragmentLife = 0`.
   - `outward = (c.position - hitPos).normalize()` (random unit if too close).
   - `scatter = random unit vector`.
   - `speed = 45 + Math.random() × 65`.
   - `c.fragmentVel = outward × (speed × 0.7) + scatter × (speed × 0.4) + hitDir × 25`.
   - `c.rotSpeed = random ±2.2 per axis`.
   - `c.collisionRadius = c.scale × 0.85` (bumped up from intact 0.55).
5. Sympathetic flash : `spawnDynamicLight(this.position, 0xffaa66, 1.2,
   min(260, clusterScale × 3), 0.25)`.
6. Network broadcast `obj_destroy` to peers (MP).
7. `triggerSympatheticDetonation(this.position)` — nearby intact clusters
   get a brief warm light-flash, "they felt the boom." Pure visual.

#### 4e. `DestructibleObstacle.collideEntity` (v17o:20656)

Per-frame ship/obstacle collision check. SHARED logic between standalone
rocks and cluster children. Algorithm :

1. Sphere overlap check (collisionRadius + ship radius).
2. **Broken fragment** : no solid bounce, fragment damages + explodes
   immediately on contact.
3. **Intact** : push ship out by penetration depth. Compute
   `impactSpeed = max(60, |vDotN|)`.
4. **Speed gate** : `RAM_DESTROY_SPEED = 220`. Above = cluster shatters
   AND ship plows through (0.4× velocity damping along normal). Below =
   cluster pushVel kick (0.6× transfer) and ship reflects (1.3× velocity
   reflection).
5. **Ram damage to ship** : `60 + min(220, impactSpeed × 0.5)`. Routes
   through `playerTakeDamage` or `entity.takeDamage`. Sparks at contact
   on slow bump (`spawnImpactSparks(contactPt, 4)`).

#### 4f. `_checkFragmentImpacts` per fragment (v17o:20607)

Each broken fragment, every frame, checks distance to player + each bot.
If within `fragmentRadius + shipRadius` :
- Damage `40 + min(80, impactSpeed × 0.3)` (lower than ram).
- Call `_fragmentExplode` : remove mesh + edge mesh, spawn `spawnExplosion(pos, max(3, scale/10))`, spawn dynamic light `0xffaa55` at intensity 1.6 / range 200 / duration 0.25.
- Hull sparks `spawnImpactSparks(pos, 3)` on unshielded hits; shielded
  hits route to the ripple shader instead (no sparks).

#### 4g. `DestructibleObstacle.update(dt)` (v17o:20505)

- If broken : integrate `position += fragmentVel × dt`, drag
  `(1 - 0.35 × dt)`, SDF wall containment with slide-along-normal,
  copy to mesh + edgeMesh, age fragmentLife, dispose at fragmentMaxLife,
  `_checkFragmentImpacts` for ship contact.
- If intact and NOT cluster child : integrate pushVel × dt, drag
  `(1 - 1.5 × dt)`, SDF containment. Cluster children skip this because
  cluster.update positions them.

#### 4h. Cluster construction (v17o:21155-21250)

- 5-10 children per cluster (`Math.floor(5 + Math.random() * 6)`).
- Pack inside `clusterScale × 0.70` sphere via rejection sampling
  (random unit offset, accept if `|offset| < packR`).
- Avg child scale `clusterScale × (0.22 + Math.random() × 0.10)` (so
  22-32% of cluster radius).
- Random shape per child from the 5 types.

#### 4i. Distortion shell (v17o:21129 `_buildDistortionShell`, DISABLED at user request 2026-05-01)

v17o has this code in place but commented out — a 1.05× cluster-bounds
IcosahedronGeometry with `_makeFXMaterial('distortion_shell')` that
visually wraps the whole cluster in a shimmer field. User disabled it
because it read as "shield" around the rocks which conflicted with the
atom-smoke per-child cloud look. **For our port** : leave it disabled.

### What our port currently does

- **Children** : Plain `{ mesh, position, scale, alive }` objects, NOT
  full `DestructibleObstacle` instances. No hp, no fragmentMaxLife, no
  shapeType variation. Post #344 added `c.broken`, `c.fragmentVel`,
  `c.fragmentLife`, `c.rotSpeed`, `c.collisionRadius` on shatter.
- **Geometry** : All children use `_makeRockGeometry(1, seed)` —
  IcosahedronGeometry at detail=1 with radial displacement. v17o has 5
  shape types ; we have one.
- **Material** : `MeshStandardMaterial(color: baseColor, metalness: 0.15,
  roughness: 0.92, emissive: baseColor × 0.06)`. Close to v17o except
  slightly higher metalness (0.15 vs 0.05) and missing `flatShading: true`.
  Without flatShading, our rocks read smoother than v17o's chunky look.
- **No edge mesh** — the cyan 1.06× rim glow that gives v17o rocks their
  signature outline. This is a significant visual delta.
- **Spawn time** : 5-10 children inside `clusterScale × 0.70` sphere via
  random per-axis offset (NOT rejection sampling, so some children sit
  outside the bounds sphere). Close enough.
- **`takeDamage(amount, attacker, projectile)`** : post #344, gates on
  amount ≥ 30 and routes to `breakApart(hitPos, hitDir)`. Faithful
  except for the 30 threshold which is invented (v17o has no minimum
  damage to break).
- **`breakApart(hitPos, hitDir)`** : post #344, captures child world
  transforms, reparents to scene, assigns fragmentVel + rotSpeed +
  collisionRadius from the same formula as v17o. **FAITHFUL** for the
  core motion. **Missing** the sympathetic detonation chain
  (`triggerSympatheticDetonation`) and the network `obj_destroy` event.
- **`collideEntity`** : post #344, matches v17o's algorithm including
  220-speed threshold, ram damage formula, pushVel transfer, reflection.
  **PARTIAL** — handles cluster but doesn't dispatch to per-child
  fragments (broken fragments aren't separately checked because we don't
  have per-child collideEntity).
- **`update(dt)`** : post #344, ticks broken fragments in world space
  with drag + tumble + lifetime. Missing SDF wall containment (we lack
  worldSDF in our port).
- **NO `_checkFragmentImpacts`** — broken fragments fly outward and
  fade, but don't damage ships on contact. v17o uses this for the
  "rocks-as-shrapnel" gameplay layer.
- **NO `_fragmentExplode`** — fragments just fade away after
  `fragmentLife` expires.
- **`spawnRockChunks`** (#288) : ported with `_makeRockGeometry(0, seed)`
  + `MeshStandardMaterial` tinted with baseColor + parentScale-derived
  size + velocity 80-220 outward + 4-8 chunks. **PARTIAL** — uses
  MeshStandardMaterial instead of the fractal shader material, so
  chunks read as solid tinted rocks not living plasma.
- **`_atomFractalMaterial`** : MISSING entirely. Our port has no fractal
  shader at all.
- **Per-child atom smoke** : MISSING (see Clouds section).
- **Distortion shell** : NOT PORTED. (And shouldn't be ported per v17o's
  user-disabled decision.)
- **Edge mesh rim glow** : MISSING.

### Verdict per piece

| Piece | Status |
|---|---|
| `DestructibleObstacle` as full class with hp / fragmentMaxLife / shape variation | **PARTIAL** — plain `{mesh, position, scale, alive}` object, full state added on break (#344). |
| 5 shape types (box / diamond / cross / wedge / ring) | **MISSING** — all rocks use `_makeRockGeometry` (irregular icosahedron). |
| Material : low-metal + high-roughness + flatShading + per-rock emissive at 0.06 | **PARTIAL** — material exists but `flatShading: true` is missing, metalness slightly off (0.15 vs 0.05). |
| Cyan edge mesh at 1.06× scale | **MISSING** — significant visual delta ; this is the signature rock look. |
| `breakApart` motion formula (outward + scatter + hitDir + tumble + collisionRadius bump) | **FAITHFUL** (post #344). |
| 220-speed `RAM_DESTROY_SPEED` ram threshold | **FAITHFUL** (post #344). |
| Ram damage formula `60 + min(220, impactSpeed × 0.5)` | **FAITHFUL** (post #344). |
| Slow-bump ship reflection 1.3× + cluster pushVel 0.6× | **FAITHFUL** (post #344). |
| `_checkFragmentImpacts` (broken fragments damage ships) | **MISSING** — gameplay layer where shrapnel hurts you. |
| `_fragmentExplode` on contact (spawn explosion + light) | **MISSING**. |
| SDF wall containment for broken fragments | **MISSING** (no worldSDF in port). |
| `spawnRockChunks` (4-8 chunks, fractal material, 1.4-2.6s lifetime) | **PARTIAL** — geometry + lifetime ported, material is plain MeshStandardMaterial not fractal shader. |
| `_makeAtomFractalMaterial` fractal shader | **MISSING**. |
| Distortion shell | **DISABLED per v17o user decision** — don't port. |
| Per-child atom-smoke GasCloud | **MISSING** (see Clouds 1c.1). |
| `triggerSympatheticDetonation` chain (visual flash on nearby clusters when one breaks) | **MISSING**. |
| Network `obj_destroy` broadcast on breakApart | **MISSING** (MP gap). |
| Damage threshold 30 in our `takeDamage` | **INVENTED** — v17o has no minimum, any damage breaks the cluster. Was added in #295 "to keep splash damage from breaking rocks at range" but that's a justification, not a v17o port. Either retire or document as a deliberate deviation. |

### What a faithful port looks like

In order of visual impact :

1. **Add the cyan edge-mesh rim glow.** This is the single biggest
   visual delta — v17o rocks have a distinctive electric outline at
   1.06× scale, ours don't. Cheap : one extra mesh per rock, no
   shader needed (`MeshBasicMaterial(0x00ddff, transparent, opacity 0.08)`).
2. **Add `flatShading: true` to the rock material + drop metalness to
   0.05.** Brings the surface read in line with v17o's chunky grainy
   look instead of our smoother slightly-shiny rocks.
3. **Port `_checkFragmentImpacts` + `_fragmentExplode`.** Broken
   fragments hurt ships on contact ; without this rocks-as-shrapnel
   gameplay layer is missing.
4. **Retire the `amount < 30` threshold** in `takeDamage` OR document
   it as a deliberate deviation. v17o has no minimum.
5. **Port `_makeAtomFractalMaterial` to TSL NodeMaterial** for rock
   chunks. Same risk profile as the fire material (#327→#328) but the
   noise math is simpler (no time-flow direction, just static fractal
   sampling). Would make chunks read as living plasma instead of solid
   tinted rocks. Lower priority than 1-4.
6. **Shape variation across the 5 types.** Easy but cosmetic.

---

## 5. Explosions + plumes + sparks

### What v17o actually does

#### 5a. `spawnExplosion(pos, size)` (v17o:20002)

Beefier than our port. Composes many layers from pooled meshes :

- **Potato path** (early-out) : single sphere mesh from pool, no
  particles, no shockwave, no light, no debris. Audio + screen-shake
  still fire. Lifetime 0.45s ages through `explosionFire` update.
- **Full path** :
  1. `applyExplosionPush(pos, 40 + size*2.5, 200 + size*12)` — every
     cloud / smoke system within radius gets an outward velocity
     impulse. Force scales with size.
  2. `_spawnExplosionLight(pos, size)` — dynamic point light, color
     shifts yellow→orange with size, intensity 4-16, range 200-900,
     duration 0.35-0.90.
  3. **Cluster fireball** (size ≥ 8) : primary hot core via
     `spawnFXBurst('fireball', pos, max(40, size*1.4), 0.45 + size*0.005)`.
     For size ≥ 35, swap to `spawnSupershapeBurst('fireball', ...)` for
     petal/spike silhouette. Then 3-7 secondary bursts at random sphere
     offsets within `size * 1.2` radius. 40% fireball / 60% cloud mix
     (fire short, smoke lingers).
  4. **v8 debris** : `v8SpawnDebris(pos, count: min(48, max(6, size*0.6)), ...)`.
     Instanced bright tumbling debris cloud.
  5. **v8 sparks** : `v8SpawnSparks(pos, count: min(64, max(8, size*1.2)), ...)`.
     Instanced bright sparks at the blast core.
  6. **Spatial audio** : `playSpatialSound('explosion', ...)` with HRTF
     panner + occlusion lowpass + reverb.
  7. **Ambient duck** (size ≥ 18) : briefly drops ambient music bed
     via `v8DuckAmbient`.
  8. **Distance-based screen shake** : up to 12 magnitude with quadratic
     falloff over reach `max(400, size * 25)`.
  9. **Shockwave refraction warp** : sets `postFX.shockwave.active`
     with origin, duration 0.30 + size*0.003s, intensity scales with
     proximity. Renders as a screen-space refraction ring in the post
     pass.
  10. **Phase 1 flash** : pooled camera-facing 'flash' mesh, white,
      lifetime 0.12s.
  11. **Phase 1b lens flare** : pooled 'flare' mesh, warm white,
      `size * 1.6` scale, lifetime 0.22s.
  12. **Phase 2 fireball** : pooled camera-facing 'fire' mesh, orange,
      grows to `size * 2.5`, lifetime 0.5s.
  13. **Phase 2b inner core** : pooled 'core' mesh, red, delayed
      expansion.
  - Many more phases below (shockwave torus, particle bursts, etc.).

So v17o explosions are a 10+-layer composite : light + push + cluster
fireball + supershape + instanced debris + instanced sparks + audio +
ambient duck + screen shake + refraction post-FX + flash + flare +
fireball + core + shockwave + more.

#### 5b. `v8SpawnSparks(pos, count, baseSize, vScale, color1, color2)` (v17o:19780)

Single draw call via `InstancedMesh`. Each spark gets a position +
velocity + color (random between color1 and color2) + size + lifetime.
Updated per frame in `v8UpdateSparks` (drifts under velocity, drag,
fade out). Pool is large (~768 slots) so concurrent explosions don't
stomp each other.

#### 5c. `spawnHeatTrail(pos, velocity, maxSpeed, hullRadius)` (v17o:25703)

- Early-out in potato mode (tier ≥ 1).
- Speed gate : require `speed ≥ 30`.
- Throttle gate : `t = min(1, speed/maxSpeed)`, require `t ≥ 0.12`.
- Acquires a pooled sprite + material from `_acquireHeatTrail`.
- Texture : `getHeatTrailTexture()` — pre-baked canvas radial gradient.
- Color : 0xffb070 (orange) with opacity `0.45 + t * 0.35`.
- Position : `hullRadius * 0.85` behind the ship + small jitter.
- Scale : `hullRadius * (0.9 + t * 1.1)` with 0.7× narrower X (oblong).
- Lifetime : `0.35 + t * 0.45`.
- Updates : grow 1.15× + drift backward.

#### 5d. `spawnImpactSparks(pos, count)` (v17o:25793)

- Early-out in potato mode.
- Calls `v8SpawnSparks(pos, count*2.2, baseSize 0.9, vScale 240)` —
  bright instanced sparks (one draw call).
- Pooled 'sparkFlash' : white sphere at 3-unit scale, opacity 0.9,
  lifetime 0.06s (very brief bright pop).
- Then per-spark loop : `count` pooled 'spark' meshes at random
  velocity, brightness 0.8-1.0, scale 1.2-2.0, lifetime ~0.4s.

#### 5e. Engine plume rendering (v17o cockpit.js animateShipMesh)

We already ported `animateShipMesh` (cockpit.js:1295) at high fidelity :
- Outline distance-cull (hide past 2200u).
- Doomed-state hull dimming with smooth lerp.
- Running-light heartbeat flash (doomed=red lub-dub, healthy=red/green
  full saturation).
- Cockpit heartbeat emissive pulse (1 Hz idle → 1.6 Hz at throttle).
- Engine plumes : opacity + length scale + width modulation per
  throttle, hot-white tint at high throttle.
- Per-plume particle stream emission (#309) at throttle-dependent rate.

Heat haze billboard from v17 is intentionally dropped per #309 comments
(depends on bespoke ShaderMaterial).

### What our port currently does

- **`spawnExplosion`** (`last_ship_sailing_webGPU.html` line 5647) : 5-phase
  composite — orange fireball sphere expanding (#5685+), cyan shockwave
  sphere (#5709+), 48 hot sparks + 32 cooler debris streaks (#5732+),
  torus ring shockwave (#286), dynamic light + spatial audio. Phase 1
  white camera-facing plane was REMOVED in #233 (caused "white squares
  sliding from sides" artifact when turning).
- **`spawnFXBurst`** (line 6129) : simplified particle puff in the spawn
  pool. Used by gas ignition + smaller bursts. Does NOT do the v17o
  `fireball`/`cloud` LayeredFX preset path ; just pushes particles.
- **`spawnSupershapeBurst`** : MISSING (would require supershape geometry
  generation + LayeredFX preset).
- **`applyExplosionPush`** : MISSING — explosions don't push gas
  outward in our port.
- **`v8SpawnSparks` / `v8SparksInit`** (#206) : ported as
  `InstancedMesh` pool with `v8Sparks` global. One draw call.
  **FAITHFUL.**
- **`v8SpawnDebris`** : MISSING — explosion has no instanced debris
  cloud.
- **`v8DuckAmbient`** : MISSING — ambient music bed doesn't duck on
  big blasts.
- **`postFX.shockwave` refraction** : MISSING — no screen-space
  shockwave warp in the post pass.
- **`spawnImpactSparks`** (#206) : ported, routes to `v8SpawnSparks` +
  pooled 'sparkFlash' + per-spark pooled meshes. **FAITHFUL** to v17o's
  shape.
- **`spawnHeatTrail`** (#226) : ported with particle fallback (since
  fx.js's pooled sprite path depended on LayeredFX heat texture which
  is skip-list-adjacent). **PARTIAL** — heat-trail sprites
  conceptually right but visual fidelity drops to plain particles.
- **`_spawnExplosionLight`** (#169) : ported with size-keyed intensity +
  range + duration. **FAITHFUL.**
- **`triggerScreenShake`** (#338) : wired ; v17o's `updateScreenShake`
  decays via fx.js. **FAITHFUL.**
- **Engine plumes via `animateShipMesh`** : ported with high fidelity at
  cockpit.js:1295 plus #309 particle emission. **FAITHFUL.**

### Verdict per piece

| Piece | Status |
|---|---|
| `spawnExplosion` 10+-layer composite | **PARTIAL** — 5 phases ported vs ~10 in v17o ; missing supershape silhouette + cluster sub-bursts + ambient duck + refraction warp + cloud push. |
| `applyExplosionPush` (blast pushes gas outward) | **MISSING** — gas pockets feel nothing from nearby explosions. |
| `spawnSupershapeBurst` | **MISSING** — big blasts (≥ 35) read as plain spheres instead of jagged silhouettes. |
| Secondary cluster sub-bursts (3-7 random offsets, fireball/cloud mix) | **MISSING** — explosions are single-burst not multi-burst. |
| `v8SpawnSparks` instanced pool | **FAITHFUL** (#206). |
| `v8SpawnDebris` instanced debris cloud | **MISSING** — explosions have hot sparks but no tumbling debris pieces. |
| `v8DuckAmbient` ambient sidechain | **MISSING** — music doesn't react to big blasts. |
| `postFX.shockwave` screen-space refraction | **MISSING** — no warp ring in the post pass. |
| `_spawnExplosionLight` size-keyed dynamic point light | **FAITHFUL** (#169). |
| Distance-based screen shake with quadratic falloff | **FAITHFUL** (#338). |
| `spawnImpactSparks` (sparkFlash + per-spark meshes + v8 instanced layer) | **FAITHFUL** (#206). |
| `spawnHeatTrail` (pooled sprite + canvas heat texture + per-throttle gate) | **PARTIAL** — drops to particle puff, missing the canvas radial-gradient sprite. |
| Engine plume rendering (animateShipMesh) | **FAITHFUL** + particle stream layer added (#309). |
| `triggerScreenShake` + `updateScreenShake` | **FAITHFUL**. |
| Phase 1 white flash plane in spawnExplosion | **DELIBERATE DEVIATION** — removed in #233 because the world-locked plane drifted off-screen during turns. Documented decision, not a regression. |

### What a faithful port looks like

In order of visual impact :

1. **Port `applyExplosionPush`.** Every blast within 200-900u of a gas
   pocket should shove it outward. This is what makes the cloud system
   feel alive during combat — without it, explosions don't disturb the
   atmosphere. Cheap : a single sphere-overlap walk per blast.
2. **Port `v8SpawnDebris`.** Instanced tumbling debris pieces alongside
   the hot sparks. Same one-draw-call pool pattern as `v8SpawnSparks`,
   different geometry (small irregular polyhedra instead of unit
   spheres). Massive visual upgrade : explosions read as "the ship
   was shredded" not "an orange sphere appeared".
3. **Port the secondary cluster sub-bursts.** Replace our single
   fireball+shockwave with the v17o multi-burst pattern : primary core
   + 3-7 offset secondaries with fireball/cloud mix. Reads as chaotic
   combustion rather than tidy round expansion.
4. **Port `postFX.shockwave` refraction ring.** This is the cinematic
   "you felt that" tell that screen-shake alone can't carry. Would
   need a custom post-process pass in our TSL pipeline ; non-trivial.
5. **Port `spawnSupershapeBurst`** for size ≥ 35 — petal/spike
   silhouette on death blooms. Lower priority.
6. **Heat trail sprite + canvas gradient texture** — bake the
   `getHeatTrailTexture` once and use it ; bumps heat trail from
   particle puff to proper hot-orange wisp.

---

## 6. Organics + walls + dots

### What v17o actually does

#### 6a. Organics (v17o:22681 `createOrganicMesh` + arena.js `spawnOrganics`)

5 procedurally distinct organic shape types, each its own mini-builder.
Material is `MeshBasicMaterial(color, transparent, opacity 0.7,
additive blend, double-side, depthWrite false)` cloned per piece :

- **`tendril`** : 6-11 segment vine. Chain of small spheres along an
  organic curve (per-segment direction-jitter, tapering radius from
  scale × 0.12 → 0.05), capped with a bright glowing bulb at the tip.
  Each segment opacity ramps from 0.9 (base) to 0.5 (tip).
- **`polyp`** : 3-7 bulbous spheres at radius scale × 0.15-0.4,
  randomly positioned in a disk around the anchor, each tinted from
  the `ORGANIC_PALETTE` (20 saturated colors).
- **`coral`** : 2-4 warped fan-plates. `PlaneGeometry(w, h, 3, 3)`
  with per-vertex Z-jitter (`scale × 0.15`) for organic ripple,
  randomly rotated and tinted.
- **`spore`** : 8-19 tiny floating spheres (radius scale × 0.03-0.09)
  in a 1.2× cube volume around the anchor. Each carries per-mesh
  `driftSpeed` + `driftPhase` on `userData` for animation.
- **`vein`** : (not read in this audit) — vein network shape.

`spawnOrganics(rooms)` (arena.js:1282) walks every room :
- Each room gets `count = max(3, floor(r/60))` organics.
- Position : on the inner surface of the room sphere (0.65-0.90 ×
  room radius, random angle), facing room center via `lookAt`.
- Each gets a random `type` + random `scale 15-55` + random color from
  `ORGANIC_PALETTE`.
- Stored in `game.organics` with `pulseSpeed`, `pulsePhase`, `swaySpeed`,
  `swayAmount` for animation.
- Tunnels also get ~20 organics with smaller scale.

`updateOrganics(dt)` in fx.js animates each organic : opacity pulse via
`sin(t * pulseSpeed + pulsePhase)`, position sway around `basePos`, plus
spore type drifts individual children.

#### 6b. Walls (per-pattern shader system, all SKIP-LIST)

v17o has 19 procedurally distinct wall pattern shaders (Kali IFS,
Apollonian, Voronoi, Mandelbox, Hex, Circuit, Caustic, Panel Maze,
Wave Interference, Plasma FBM, Circumpunct, Holographic Glitch,
Cellular Membrane, Warped Streaks, Hex Pulse, Cyber Datamosh, Ring
Tunnel, Neon Cube, Layered Cube). Plus multi-layer composites and the
Venturi corrugation system. ALL on the skip list per user's "no wall
patterns" instruction.

Walls in v17o use whichever pattern shader is active for the arena ;
in skip-list mode, walls fall back to `MeshStandardMaterial` with
emissive base.

#### 6c. Dot anchor system (v17o:25036+ `spawnDot`)

`spawnDot(position, opts)` is a UNIFIED anchor for everything that
"floats with state in the world." Options include :
- `lifetime`, `growthDuration`, `radius`
- `velocity`, `collidable`, `playerWake`
- `emitsLightning`, `arcRadius`, `interArcRange`
- `hueCycleMaterial`, `hueSpeed`
- `scaleGrowth: { baseScale, maxFactor }`, `fadeOut: { alphaMul }`
- `clusterAttraction`, `attractStrength`, `attractRange`, `orbitBoost`

Result : a `Dot` object pushed to `game.dots`. The Dot system handles :
- Per-dot mesh + multi-mesh attachment (`attachMesh`, `attachHaloSprite`).
- Lifecycle (`age`, `lifetime`, `dispose`).
- Internal pluming (mini-cluster puffs orbiting inside the parent
  cloud volume, ~4-7 per Dot).
- Lightning chain : Dots with `emitsLightning: true` auto-arc to other
  Dots within `interArcRange` based on per-dot timers.
- Cluster attraction : Dots seek each other within `attractRange`.

The Dot system is what unifies ambient clouds, basin gas, and similar
"world-state-carrying ambient objects." It's the same machinery
`spawnTetherTrap`, `spawnStasisField`, and other gameplay world-effects
use.

### What our port currently does

- **Organics** : `createOrganicMesh` (#340) returns an **invisible empty
  Mesh** — `BufferGeometry()` + `MeshBasicMaterial({ visible: false })`.
  The placeholder icosahedrons that used to spawn (50+ flat hexagonal
  shapes per round) are gone. `game.organics` array stays consistent so
  any downstream logic doesn't crash, but nothing renders.
- **Walls** : skip-list per user instruction. Plain
  `MeshStandardMaterial` with emissive + normal map (#267). Wall
  geometry from marching cubes worker. Heavy poly count (1M+ tris per
  room) but no shader cost.
- **Dots** : NO unified Dot system. The functionality is scattered :
  - `game.dots` array exists but is essentially unused (#236
    `cleanupPendingHits` references it, but nothing pushes to it).
  - Sprite arrays in `_ambientClouds`, `_clusterAttachedClouds`,
    `game.detachedGasPockets` each implement their own subset of what
    a Dot would carry.
  - Lightning chemistry walks `game.detachedGasPockets` only ; the
    ambient-cloud lightning chain v17o gets via Dots with
    `emitsLightning: true` doesn't fire.

### Verdict per piece

| Piece | Status |
|---|---|
| Organic procedural shapes (5 types) | **MISSING** — replaced by **DELIBERATE no-op** (#340 invisible mesh). v17o's organics were 50+ procedurally distinct vines / coral / spores / polyps per arena ; ours render nothing. Acceptable per user "shitty graphics" feedback IF we later replace with something better, otherwise a real visual gap. |
| `updateOrganics` (opacity pulse + sway + spore drift) | **PORTED** but operates on invisible meshes (#298 ports the update, but createOrganicMesh produces invisible). Effectively no-op. |
| Wall pattern shaders (19 + composites) | **SKIPPED per user** — documented, not a regression. |
| Wall geometry + emissive material | **FAITHFUL** within skip-list constraint. |
| Procedural wall normal map (#267) | **FAITHFUL+ — IMPROVEMENT over v17o non-shader fallback.** |
| Dot anchor system | **MISSING** — fundamental architectural piece. Ambient clouds, basin gas, ability-shield Dots, stasis-link anchors all expected to flow through this. |
| `attachMesh` / `attachHaloSprite` per-Dot | **MISSING**. |
| Internal pluming (mini-cluster puffs orbiting inside Dot volume) | **MISSING**. |
| Dot lightning chain (`emitsLightning` + `interArcRange` + per-dot timers) | **MISSING** — a second lightning pathway entirely absent. |
| Cluster attraction via `clusterAttraction` Dot option | **MISSING** — what we have is the inline `_applyCloudAttraction` from #318, not the Dot-system flag. |

### What a faithful port looks like

In order of architectural importance :

1. **Decide on the Dot system.** Two options :
   - **Port it** : `spawnDot(position, opts) → Dot` class with the full
     option surface, internal pluming, lightning chain, attraction.
     This is the unification layer that v17o uses. Big refactor but
     it's the cleanest path to v17o-fidelity for clouds, basin gas,
     and ambient lightning.
   - **Inline-everywhere** : keep separate sprite-array systems but
     teach each one to do its own lightning / attraction / animation.
     What we do now. Functional but every system gets its own subtly
     different physics, and the ambient-cloud lightning pathway stays
     missing.
2. **Re-implement organics with the user's preferred aesthetic.** v17o's
   procedural vines / coral / spores look "alien tide pool" ; the user
   rejected the placeholder hexagons but hasn't explicitly opted out of
   organics as a concept. Possibilities :
   - Soft-additive sprite billboards instead of geometry (matches
     cloud aesthetic, no flat polygon clutter).
   - The full v17o procedural shapes if we accept the geometry cost.
   - Just leave organics off and accept the empty arena look.
3. **Walls : stay on skip list** per user instruction. No action needed.

---

## 7. Summary : bugfixes to retire vs port targets to add

### Bugfixes flagged as INVENTED (or partial inventions)

These are tagged bugfixes that I cannot justify against v17o behavior.
None of them are stopping the game from working ; they're cosmetic
inventions that either drift away from v17o or add visual noise the
user has complained about. Recommended action per item :

| Tag | Description | Verdict | Recommended action |
|---|---|---|---|
| #295 | Drop break threshold to 30 (`amount < 30` bails out of cluster takeDamage) | INVENTED — v17o has no minimum damage to break a cluster | **Retire**. Let any damage break the cluster (matches v17o:20769). |
| #307 | "Pick closest-to-impact alive child" in takeDamage | INVENTED — v17o doesn't pick a child at all, `cluster.breakApart` shatters all children at once | **Retire** (superseded by #344 which now routes to breakApart). |
| #318 | Linear always-attract `_applyCloudAttraction` with constant 600u range | INVENTED substitute — v17o uses quadratic equilibrium + repulsion + speed-gated escape + tangential damping + `_latticeNeighbors` count | **Replace** with v17o's solver. Required for lattice-aware lightning intensity scaling (currently every arc is the same density). |
| #326 | "6 sprites per cluster, 4 per pocket" hardcoded counts | INVENTED — v17o GasCloud has `segments: 17` (atom-smoke), `segments: 8` (basin default) | Tune toward v17o counts (17 / 8 per pod) if we keep the sprite-based path, or replace entirely if we port BCS. |
| #329 + #340 | Ambient nebula sprite layer (20 sprites at 1800-3500 distance, 400-900 size, 0.25-0.45 opacity) | INVENTED substitute — v17o has 4 distinct ambient layers (BCS + atom-smoke + basin Dots + ambient Dots) | **Keep as deliberate substitute**, mark in plan. Replacement requires Dot system. Document the choice. |
| #331 | Basin pockets in 4 invented hubs of 3 pockets each | INVENTED — v17o spawns 12-16 GasClouds per BASIN SPHERE (room with no downward-draining tunnel) | **Replace** with v17o's `_spawnBasinClouds` algorithm. Requires walking `game.levelSpheres` + `game.levelCylinders` (we have these). |
| #332 | Cluster glow flare (one big additive sprite at cluster center) | INVENTED — v17o has no cluster flare ; cluster brightness comes from per-child atom-smoke GasClouds picking up scene lights via `uLightPos[8]` array | **Retire** OR keep as deliberate fill-in until we port per-child atom-smoke. Document. |
| #333 | Hardcoded layered bolt thicknesses (4.5/2.8/1.4) + lifetimes (0.55/0.45/0.30) in every chemistry arc | INVENTED — v17o scales these by `scale` parameter (halo `2.0 + scale * 2.4`, core `0.8 + scale * 0.8`, lifetimes `0.22+s*0.10` / `0.16+s*0.08`) | **Replace** by porting `_spawnLayeredGasArc(from, to, scale)` and routing chemistry through it. |
| #334 | Per-cluster "halo" sprite at 3.2× → 1.5× radius | INVENTED — v17o has no cluster halo | **Retire**. Bloom (when enabled) does this for free if we feed it bright pixels. |
| #335 / #337 | 2000-point dust field with radial-gradient texture | INVENTED — v17o gets atmospheric shimmer from dense BCS slots, not a particle field | **Retire** OR keep as deliberate substitute until BCS lands. Document. |
| #341 | Wireframe lattice overlay on shield | INVENTED, REVERTED in #342 | Already retired ✓. |

### Bugfixes that are FAITHFUL or DELIBERATE DEVIATIONS

For clarity, these are NOT inventions ; they're correct ports OR
documented deviations from v17o for valid reasons :

- #169 `_spawnExplosionLight` — faithful.
- #206 `v8SpawnSparks` / `v8SparksInit` — faithful.
- #233 Phase 1 white flash REMOVED from spawnExplosion — deliberate
  deviation, documented (world-locked plane drifted off-screen during
  turns).
- #239 `_setShipShieldEmissive` / `_clearShipShieldEmissive` — faithful
  helpers, just unused because `updateShieldVisuals` isn't ported.
- #267 procedural wall normal map — an IMPROVEMENT over v17o's
  skip-list fallback path.
- #288 `spawnRockChunks` — partial (geometry + lifetime correct,
  material wrong because `_makeAtomFractalMaterial` not ported).
- #298 `updateOrganics` — port is correct but operates on invisible
  meshes (#340) so it's no-op visually.
- #309 engine plume particle stream — faithful + extends v17o with a
  particle emission layer.
- #325 bloom default OFF — deliberate deviation. v17o relies on bloom
  for HDR effects ; we turned it off after a perf cliff at the time.
  Worth revisiting with the "lightning as line + bloom" idea (in
  conversation, not in plan yet).
- #338 gamepad alt-tab fix — bugfix, not a port question.
- #340 createOrganicMesh → invisible — deliberate substitute for the
  unported procedural shapes. Eliminates flat hexagon clutter ; needs
  a real replacement at some point.
- #343 / #344 / #345 — recent v17o-grounded ports of shields, rocks,
  and lightning rendering. Faithful within the constraints (1-slot
  ripple vs v17o's 4-slot, single-stage cluster break vs v17o's
  multi-stage atom-smoke detachment).

### Top port targets (in priority order)

Cross-referenced from all section "What a faithful port looks like"
recommendations. If we close these in order, every "INVENTED" bugfix
above either retires naturally or becomes a documented deliberate
substitute :

1. **Add `_spawnLayeredGasArc(from, to, scale)`** and route both
   chemistry walks through it. Density-aware arcs + path glow + offset
   crackle for free. (Section 2.)
2. **Replace #318 cloud attraction with v17o's quadratic
   equilibrium-plus-repulsion + speed-scaled + lattice-counted solver.**
   Unlocks item 1's lattice decision. (Section 2.)
3. **Port `_spawnBasinClouds` to use physical basin spheres.** Retires
   #331 (invented hubs). Spawns lightning chemistry in the right places.
   (Section 1c.2 + Section 2.)
4. **Port `_checkFragmentImpacts` + `_fragmentExplode` per fragment.**
   Rocks-as-shrapnel gameplay layer. (Section 4f.)
5. **Add cyan edge-mesh rim glow + `flatShading: true` + drop metalness
   to 0.05 on rock material.** Single biggest rock visual delta.
   (Section 4a.)
6. **Port `_makeHullHugShield` to use `_mirrorMeshTree` instead of an
   ellipsoid.** Ability shields take the ship's exact shape.
   (Section 3b.)
7. **Add the shield `impact` uniform whole-dome flash** (separate from
   directional ripple) and expand to 4-slot ripple ring buffer.
   (Section 3a.)
8. **Port `applyExplosionPush`** so explosions disturb the gas system.
   (Section 5a.)
9. **Port `v8SpawnDebris`** instanced debris cloud on explosions.
   (Section 5a.)
10. **Decide on the Dot system** (port full vs inline-everywhere). All
    cloud/lightning paths converge here. (Section 6c.)

### Honest ranking of "what would the user notice most"

Based on the user's stated complaints, ranked subjectively :

- **#1 (lightning intensity scaling) + #2 (proper attraction) + #3
  (basin spheres)** → fixes "I don't see any lightning." Three pieces,
  one visible result.
- **#5 (rock edge-mesh + flatShading)** → fixes "rocks look low-res."
  Single line geometry add + a flag, big visual upgrade.
- **#6 + #7 (hull-hug shields + whole-dome flash + 4-slot ripple)** →
  fixes "shields are still flat" once ability shields are in play.
- **#4 (fragment damage)** → fixes "rocks don't hurt me when they hit."
- **#8 (cloud push from explosions)** → fixes "explosions don't feel
  connected to the gas system."

The TSL fire material risk (from #327→#328) applies to items requiring
NodeMaterial + sphere combos. Plain MeshBasicMaterial / LineBasicMaterial
/ NodeMaterial-without-position-sampling are safer. Item 6 (hull-hug
mirror) uses MeshBasicMaterial, low risk.

