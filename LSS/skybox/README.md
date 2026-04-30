# LSS skybox

`cinematic_2k.hdr` is the equirectangular HDR environment map that v8VR's
`setHdrEnvironment()` loads when Showcase mode is enabled. Once loaded, it
gets fed through `THREE.PMREMGenerator` and assigned to `scene.environment`,
which gives every `MeshStandardMaterial` / `MeshPhysicalMaterial` proper
image-based lighting (real specular reflections at low roughness, soft
diffuse fill at high roughness). PBR-promoted hero ship hulls light up with
warm key + cool fill from this map instead of the flat procedural starfield.

## What's currently in there

A procedural fallback generated at v8VR fork time (2026-04-30):
- 1024 x 512 equirectangular RGBE
- ~2 MB
- Dark deep-space gradient (purple-black up top, dim purple at bottom)
- Two soft nebula blobs: warm orange-pink (sun-warm, lights ship hulls
  with a hero key) and cool teal-purple (rim / fill from opposite side)
- A small bright "star cluster" hot-spot
- ~5000 procedural stars at varied brightness + tint

It looks fine. It's not as cinematic as a real photographed HDR.

## Replacing it with a "real" HDR

For the AAA tier, swap in a free CC0 HDRI from
[polyhaven.com/hdris](https://polyhaven.com/hdris). Good search terms for
the LSS aesthetic: **moonless_golf**, **satara_night**, **kloppenheim_06**,
**spruit_sunrise**, or anything tagged "night sky" / "outer space".

Steps:

1. Download the 2K `.hdr` (typically 1-3 MB).
2. Save as `LSS/skybox/cinematic_2k.hdr` (overwrite this file).
3. Reload v8VR; with Showcase mode on the new HDRI loads automatically.

If you want to point the loader at a different file without renaming, run
in the dev console:

```js
setHdrEnvironment('./skybox/your_file.hdr')
```

## Regenerating the procedural fallback

The original generator is the inline Python script in the v8VR session
chat history (date 2026-04-30). To regenerate:

```bash
# (requires numpy)
python3 generate_skybox.py
```

Output is non-RLE RGBE; Three.js's RGBELoader handles both RLE and non-RLE
under the `FORMAT=32-bit_rle_rgbe` declaration.
