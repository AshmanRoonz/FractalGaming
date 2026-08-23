# Grassy Mountain Texturing

How the grassy mountains get their look, and how to reproduce it in LSS's Three.js
stack. Two parts: what Ace Starship (Roblox) actually does today, then the port to
LSS (which has no built-in terrain materials, so it's done in a shader).

The grassy look is really three layers working together:

1. **A grass surface** that hugs the flat, gentle ground and gives way to bare
   rock on the steep faces (and snow on the very high peaks).
2. **A green scene tint** so the whole world (sky included) reads as a soft green
   valley, not a grey one.
3. **Matching haze** (fog) in the same green so distance dissolves cleanly.

---

## 1. How Ace Starship does it (Roblox)

Roblox Terrain already ships textured materials, so "grassy" is mostly material
choice plus a color filter. See
`Ace_Starship/src/client/Controllers/TerrainController.luau`.

**Per-biome theme.** Each biome is a small table; the grassy one is:

```lua
grassy = {
  ground = Enum.Material.Grass,       -- floor mountains
  ceil   = Enum.Material.LeafyGrass,  -- the hanging ceiling mountains
  fog    = Color3.fromRGB(168, 205, 158),
  sky    = { tint = Color3.fromRGB(190, 240, 180), sat = -0.5, bright = 0.03 },
}
```

When the voxelizer fills a chunk it stamps `ground` on the floor and `ceil` on the
ceiling; Roblox's Grass/LeafyGrass materials supply the actual grass texture and
normal detail for free.

**Grass-to-rock-to-snow by height.** The floor material is chosen per voxel from
the surface height, so peaks can cap differently from valleys:

```lua
local function groundMaterial(wy)
  if currentTheme.cap and wy > currentTheme.capY then return currentTheme.cap end   -- e.g. Snow up high
  if currentTheme.base and wy < currentTheme.baseY then return currentTheme.base end -- e.g. lava down low
  return currentTheme.ground                                                          -- Grass elsewhere
end
```

The pure grassy biome has no `cap`/`base` (all grass); the `snowcap` biome reuses
`ground = Grass` with `cap = Snow` above `capY = 55` for green-below / white-peaks.

**Green scene tint.** A single `ColorCorrectionEffect` recolors the whole view
(the skybox is greyscale, so this is what makes the world green):

```lua
cc.TintColor  = theme.sky.tint   -- (190,240,180) green
cc.Saturation = theme.sky.sat    -- -0.5  (mute the base skybox)
cc.Brightness = theme.sky.bright -- +0.03
```

It's skipped entirely on Low quality (a full-screen pass is costly on weak GPUs).

**Matching fog.** `Lighting.FogColor` is set to the theme's `fog` green and eased
when the biome changes, so haze and tint agree.

**Biome rotation.** The world cycles `rocky -> grassy -> snowcap -> frozen ->
volcanic`, one per boss (`THEME_EVERY = 10` waves); new chunks build in the
current theme so it bleeds in as you fly forward.

Takeaway for the port: grass on gentle ground, rock on steep, snow on peaks, all
under a green tint + matching fog.

---

## 2. Porting the look to LSS (Three.js)

LSS builds the mountains as a displaced `BufferGeometry` (see
`SANDWICH_TERRAIN_GUIDE.md`) and has no terrain materials, so the grass/rock/snow
split is decided **in the material** from each fragment's **slope** (how flat it
is) and **height**. This works the same on flat-shaded low-poly or smooth meshes.

### 2a. Low-poly, no textures (cheapest, matches the faceted look)

Blend three flat colors by slope + height. Drop this into a `MeshStandardMaterial`
with `onBeforeCompile` so you keep Three's lighting/fog for free.

```js
const GRASS = new THREE.Color(0x5fae4e);
const ROCK  = new THREE.Color(0x6b6f74);
const SNOW  = new THREE.Color(0xeef2f5);

function grassyMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 });
  mat.userData.uniforms = {
    uGrass: { value: GRASS }, uRock: { value: ROCK }, uSnow: { value: SNOW },
    uSnowStart: { value: opts.snowStart ?? 70 },   // world Y where snow begins
    uSnowFull:  { value: opts.snowFull  ?? 95 },
    uSlopeGrass:{ value: opts.slopeGrass ?? 0.80 },  // normal.y above this = grass
    uSlopeRock: { value: opts.slopeRock  ?? 0.55 },  // below this = bare rock
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWPos; varying vec3 vWNnormal;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n vWNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n varying vec3 vWPos; varying vec3 vWNormal;\n uniform vec3 uGrass,uRock,uSnow;\n uniform float uSnowStart,uSnowFull,uSlopeGrass,uSlopeRock;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float flat_ = clamp((vWNormal.y - uSlopeRock) / (uSlopeGrass - uSlopeRock), 0.0, 1.0);
        vec3 terr = mix(uRock, uGrass, flat_);                 // steep -> rock, gentle -> grass
        float snow = smoothstep(uSnowStart, uSnowFull, vWPos.y);
        terr = mix(terr, uSnow, snow * flat_);                 // snow on high + flattish only
        vec4 diffuseColor = vec4( terr, opacity );`);
  };
  return mat;
}
```

Use it for the ground mesh (and a darker `uGrass` for the ceiling so the hanging
mountains read as shadowed). No UVs, no textures, no seams; it just colors by the
geometry. The Roblox `capY = 55` becomes `uSnowStart`/`uSnowFull`.

### 2b. With textures (triplanar grass + rock)

For real grass/rock images on procedural geometry you can't use normal UVs (they
stretch on cliffs), so sample each texture **triplanar** (project on X/Y/Z by the
world normal and blend), then mix grass vs rock by slope exactly as above.

```glsl
vec3 triplanar(sampler2D tex, vec3 wp, vec3 n, float scale) {
  vec3 b = abs(n); b /= (b.x + b.y + b.z);
  vec3 xz = texture2D(tex, wp.xz * scale).rgb; // top-down (grass loves this one)
  vec3 xy = texture2D(tex, wp.xy * scale).rgb;
  vec3 zy = texture2D(tex, wp.zy * scale).rgb;
  return xz * b.y + xy * b.z + zy * b.x;
}
// fragment: blend by slope, then height for snow
float flat_ = clamp((n.y - uSlopeRock) / (uSlopeGrass - uSlopeRock), 0.0, 1.0);
vec3 col = mix(triplanar(uRockTex, wp, n, 0.04),
               triplanar(uGrassTex, wp, n, 0.05), flat_);
col = mix(col, triplanar(uSnowTex, wp, n, 0.04), smoothstep(uSnowStart, uSnowFull, wp.y) * flat_);
```

Same slope/height logic, just swapping flat colors for triplanar texture samples.
Keep `scale` small for big features; add a second octave at a larger scale and
multiply for close-up detail. Grass tiles best on the `.xz` (top-down) projection,
which is why it dominates on flats.

### 2c. The green tint + fog (don't skip this)

Most of the "grassy valley" feeling is the scene tint, not the ground. Reproduce
the Roblox ColorCorrection with a cheap post pass or just tint your lights + fog:

```js
// quickest: tint ambient/hemisphere light green and match the fog
hemiLight.color.set(0xbfe6a8);          // sky term, soft green
hemiLight.groundColor.set(0x6f7d5a);
scene.fog.color.set(0xa8cd9e);           // the theme 'fog' green
renderer.setClearColor(0xa8cd9e);        // horizon matches the fog
```

For the exact Roblox feel (desaturate + tint the whole frame, sky included), do it
as a final full-screen pass in your composer: `mix(toGrey(color), color, 1.0+sat)`
then `* tint + bright`, with `sat = -0.5`, `tint = (190,240,180)/255`,
`bright = +0.03`. Skip the pass on a low-detail setting, same as Ace.

### 2d. Biome swap

To cycle biomes like Ace, keep a small table of `{ grass, rock, snow, fog, tint }`
and lerp the material uniforms + fog color toward the target set over ~1s when the
biome changes. New chunks just read the current values.

---

## Reference

- Ace grassy theme + per-height material + biome filter:
  `Ace_Starship/src/client/Controllers/TerrainController.luau` (THEMES, `groundMaterial`, the `ColorCorrectionEffect`).
- Mesh + streaming this textures: `SANDWICH_TERRAIN_GUIDE.md`.
- Triplanar mapping background: the standard "texturing procedural terrain without
  UVs" technique (project per world axis, blend by normal).
