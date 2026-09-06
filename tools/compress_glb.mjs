#!/usr/bin/env node
/**
 * compress_glb.mjs — rebuild every shipped GLB in LSS/ from the pristine
 * originals in assets_src/.  Run from the REPO ROOT:
 *
 *     node tools/compress_glb.mjs                 # full rebuild
 *     node tools/compress_glb.mjs --dry           # report only, write nothing
 *     node tools/compress_glb.mjs --only pyro     # substring filter
 *
 * One-time setup:  cd tools && npm install
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * assets_src/ is the SOURCE OF TRUTH (a byte-identical copy of the June art
 * drop). LSS/ is the DEPLOY ROOT — everything under it ships to players, so
 * originals must never live there. This script is the only thing that writes
 * GLBs into LSS/. Re-run it whenever the art changes: drop the new GLB into
 * assets_src/ at the same relative path and run the command above.
 *
 * (v37.24) The June drop is no longer on this machine. For the SEVEN SHIPS the
 * chain is now:   assets_base/ships/  (frozen v37.23 hulls, == git f6260f2)
 *              -> tools/blender/ship_cleanup.py  (headless Blender 4.1, bpy)
 *              -> assets_src/ships/  (float32 Blender export, the new source)
 *              -> this script with simplify OFF (OVERRIDES) -> LSS/ships/
 * See tools/blender/README.md. Only the files present under assets_src/ are
 * rebuilt, so running this with just ships/ in there touches nothing else.
 *
 * ---------------------------------------------------------------------------
 * NO RUNTIME DECODER IS REQUIRED — AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * Everything here writes plain glTF plus two extensions three.js r165 already
 * parses natively, both of which the repo ALREADY shipped before this script
 * existed (rings/*.glb carried EXT_texture_webp; ships/ + objects/hoard/
 * carried KHR_mesh_quantization):
 *
 *     KHR_mesh_quantization   i16/u16/u8 vertex attributes
 *     EXT_texture_webp        WebP texture payloads
 *
 * Draco (KHR_draco_mesh_compression) and EXT_meshopt_compression would each
 * buy another ~10-15 MB, but both need a decoder wired into all FIVE
 * `new THREE.GLTFLoader()` sites in index-working.html (~L8361, 28854, 39919,
 * 40089, 40311). A missing/404 decoder there means EVERY model fails, not one.
 * That risk was judged not worth 10 MB. `simplify()` below is meshoptimizer
 * running at BUILD TIME — it emits plain glTF and needs no runtime decoder.
 * Do not confuse it with EXT_meshopt_compression, which does.
 *
 * ---------------------------------------------------------------------------
 * WHICH TEXTURE SLOTS SURVIVE, AND WHY  (read before "optimising" further)
 * ---------------------------------------------------------------------------
 * A GLB's material slots only matter if some code path actually reads them.
 * There are three distinct consumers in this game and they disagree:
 *
 *   1. buildModelShipMesh (~L29302) REBUILDS every material from scratch and
 *      copies exactly one slot:  `if (m && m.map) params.map = m.map;`
 *      -> in-game player ships + campaign/hoard enemies use baseColor ONLY.
 *
 *   2. bakeShipThumbnails (~L29155) and the hub-city traffic fleet (~L26292)
 *      CLONE the prototype's materials as-is — every slot survives and is
 *      rendered. 34 hub traffic ships draw from 14 distinct hoard hulls.
 *
 *   3. Monsters (_monAttach) and ChampionShell (_champSelfIlluminate ~L40096)
 *      collapse to `new MeshBasicMaterial({ map })` — baseColor ONLY.
 *
 * So: hoard normal maps LOOK discardable from consumer 1's point of view, but
 * consumer 2 renders them all over the hub. Dropping them saves only 2.37 MB
 * (8.92 vs 11.29 MB across the 22 hulls) and would silently swap authored art
 * for the procedural panel-noise normal map that _applyProceduralShipNormalMap
 * (~L28829) falls back to. Not worth it — hoard keeps every slot.
 *
 * Sphere.glb is the one file where dropping IS free: consumer 3 owns it
 * outright, so its normal/MR/emissive maps are decoded and thrown away.
 *
 * rings/cyanring.glb is cloned with NO material swap at all (BossPortal
 * _buildMesh ~L40342) — it keeps everything, unconditionally.
 *
 * ---------------------------------------------------------------------------
 * TWO TRAPS
 * ---------------------------------------------------------------------------
 * 1. prune() MUST be called with { keepLeaves: true }. gun1/gun2/thruster1-4/
 *    cockpit1 are EMPTY marker nodes — exactly what prune deletes by default.
 *    buildModelShipMesh walks for /^gun\d+$/ to place muzzle flashes and bot
 *    gunfire origins; losing them fails silently.
 *
 * 2. The original quantized files use bufferView.byteStride 6 for vec3 i16.
 *    The glTF spec requires a multiple of 4; three.js tolerates it,
 *    gltf-transform writes a compliant stride 8. That costs +2 bytes/vertex on
 *    POSITION and NORMAL, so a round-trip with NO geometry reduction is a net
 *    LOSS on an already-quantized file (pyro grew 6.01 -> 6.69 MB in trial).
 *    Ships therefore only win via simplify(); never round-trip them for free.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, dequantize, simplify, simplifyPrimitive, textureCompress, join, flatten, cloneDocument } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(REPO, 'assets_src');
const DST  = path.join(REPO, 'LSS');

const DRY  = process.argv.includes('--dry');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();

// ---------------------------------------------------------------- settings --
// Bump this when the recipe changes, so `_MODELS_VERSION` in index-working.html
// can be bumped alongside it and players actually get the new bytes.
// (v37.24) 1.0 -> 1.1: ship hulls are now AUTHORED in Blender (tools/blender/),
// starting from the already-simplified v37.23 hulls frozen in assets_base/ships.
// assets_src/ships holds the Blender output (float32, unquantized) and the ship
// recipe must NOT simplify it again — see OVERRIDES.
// (v38.92) 1.1 -> 1.2: ships may JOIN (OVERRIDES.join). The c1seat hulls arrive as ~240
// separate cockpit parts under a scaled/rotated Cockpit_Root: 244 draw calls and 244
// mesh+material clones per spawn. flatten+join merges everything sharing a material
// into ONE primitive each (14 per hull), which is what buildModelShipMesh clones and
// the GPU draws. Bytes: neutral. Frame time and spawn hitches: the whole point.
const RECIPE_VERSION = '1.2';
// The game's marker empties. join() leaves every absorbed part behind as a node holding
// an EMPTY mesh; prune strips the mesh, then everything mesh-less that is not one of
// these is dropped (prune's keepLeaves would otherwise keep ~240 dead empties).
const MARKER_RE = /^(cockpit1|gun\d+|thruster\d+)$/;
const dropJoinLeftovers = (doc) => {
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh() && !n.listChildren().length && !MARKER_RE.test(n.getName())) n.dispose();
  }
};

const Q = { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 };
const WEBP_Q = 90;
// PNG ONLY — and that exclusion is measured, not stylistic.
//
//   WebP is NOT free: browser WebP decode of a 1024x1024 costs ~25 ms against
//   ~10 ms for the same image as PNG or JPEG. That is worth paying when the PNG
//   is 1-3.5 MB (every hoard hull, every monster) because the byte saving is
//   80-90% and the PNG decode was even slower — those files got FASTER to parse.
//
//   It is NOT worth paying for the 7 ships. Their baseColor maps are already
//   JPEG (~0.42 MB each, the repo's only JPEGs), so WebP q90 saved just 0.04 MB
//   per ship while adding +13.7 to +18.0 ms of parse EACH — measured per-ship,
//   isolated against a simplify+quantize-with-PNG control that parsed at 11.0 ms
//   vs the original's 10.4 ms. 0.35 MB total for +110 ms of boot is a bad trade.
//   Re-encoding an already-lossy JPEG into lossy WebP is generation loss on top.
//
//   rings/*.glb and Sphere.glb already carry WebP payloads; WebP->WebP would be
//   lossy-on-lossy for a handful of KB. Excluded by the same filter.
const LOSSY_SOURCES = /^image\/png$/;
const SHIP_SIMPLIFY = 0.5;   // 0.25 showed visible surface wobble at 3.2x zoom

// Unreferenced in game code AND absent from asset-manifest.json. Verified with
// a full-text grep of index-working.html: zero hits for any of these names.
// They stay in assets_src/ forever; they just don't ship.
const DEAD = new Set([
  'objects/unanimated/FleshMaw.glb', 'objects/unanimated/GraveTitan.glb',
  'objects/unanimated/HallowWalker.glb', 'objects/unanimated/IronBloom.glb',
  'objects/unanimated/StoneShroud.glb', 'objects/unanimated/VoidGazer.glb',
  'rings/archway.glb', 'rings/bluemetalring.glb', 'rings/bluering.glb',
  'rings/bonearch.glb', 'rings/cyanring2.glb', 'rings/stargate.glb',
]);

// Per-file escape hatches. Set `skip: true` to ship the original untouched,
// or override any recipe knob. Empty today — every file passed visual review.
//   e.g. 'ships/pyro.glb': { simplify: 0.35 },
//        'objects/hoard/disco.glb': { skip: true },
const OVERRIDES = {
  // (v37.64) The seven ship hulls in assets_src/ are written by
  // tools/blender/ship_plain.py: the owner's ORIGINAL hi-poly exports in
  // LSS/ships_original, decimated to ~60k triangles with their own texture kept. Running simplify(0.5) on them again would decimate twice
  // (~58k -> ~29k tris) and bring back the surface wobble the 0.5 pass was
  // tuned to avoid. simplify: 1.0 skips the simplifier ; weld + quantize still
  // run, which is what recovers the byte size the float32 Blender export lost.
  ...Object.fromEntries(['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex'].map((s) =>
    [`ships/${s}.glb`, { simplify: 1.0, join: true, mobile: { baseColorMax: 1024, lean: true, cockpitRatio: 0.35 },
                        reason: 'Blender-authored from the already-simplified hull ; c1seat cockpit parts joined per material' }])),
  // (v37.73) the flying carrier: 565k triangles decimated to 120k in Blender with its own UVs and
  // all three maps kept. Simplifying again would decimate twice.
  'objects/carrier.glb': { simplify: 1.0, reason: 'Blender-decimated capital hull' },
};

// ------------------------------------------------------------- categories --
function categoryOf(rel) {
  if (rel.startsWith('ships/')) return 'ship';
  // (v37.73) the flying carrier is a Blender-authored hull like the ships (weld + quantize,
  // no re-simplify via OVERRIDES) ; it only lives under objects/ because it is not a loadout.
  if (rel === 'objects/carrier.glb') return 'ship';
  if (rel.startsWith('objects/hoard/')) return 'hoard';
  if (rel === 'objects/Sphere.glb') return 'shell';
  if (rel.startsWith('rings/')) return 'ring';
  if (/^objects\/[A-Z]/.test(rel)) return 'monster';
  return 'other';
}

/** Delete every texture slot except baseColor. ONLY safe where the game
 *  collapses the material to MeshBasicMaterial({ map }). */
function dropNonBaseColor(doc) {
  const root = doc.getRoot();
  const keep = new Set();
  for (const m of root.listMaterials()) { const t = m.getBaseColorTexture(); if (t) keep.add(t); }
  for (const m of root.listMaterials()) {
    m.setNormalTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setOcclusionTexture(null);
    const e = m.getEmissiveTexture();
    if (e && !keep.has(e)) m.setEmissiveTexture(null);
  }
  let freed = 0;
  for (const t of root.listTextures()) {
    if (keep.has(t)) continue;
    freed += t.getImage()?.byteLength || 0;
    t.dispose();
  }
  return freed;
}

const webp = (q = WEBP_Q) => textureCompress({
  encoder: sharp, targetFormat: 'webp', quality: q, formats: LOSSY_SOURCES,
});

// ------------------------------------------------------------- the recipes --
const RECIPES = {
  // 175k tris average on a hull normalised to 140 units. Pure geometry bloat;
  // textures are a rounding error (~0.42 MB each) and there are no normal maps
  // at all, so there is nothing to drop. dequantize->weld->simplify->requantize
  // is the only lever that beats the stride-8 penalty (see trap 2).
  ship: async (doc, o) => {
    const ratio = o.simplify ?? SHIP_SIMPLIFY;
    // (v37.24) ratio >= 1 means "already simplified upstream" (see OVERRIDES):
    // the simplifier is skipped outright rather than asked for a 1.0 ratio, so
    // an authored hull round-trips with its triangles untouched.
    const steps = [dedup(), prune({ keepLeaves: true }), dequantize(), weld()];
    if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
    if (o.join) {
      // cleanup:false on both, or join's own prune() deletes the marker empties (trap 1).
      steps.push(flatten({ cleanup: false }), join({ keepNamed: false, cleanup: false }),
                 prune({ keepLeaves: true }), dropJoinLeftovers, prune({ keepLeaves: true }));
    }
    steps.push(quantize(Q), webp());
    // (v37.37) The Meshy v2 hulls ship real PBR maps (2k normal + metallicRoughness
    // PNGs = 7 MB raw). Colour stays 2k ; the data maps go to 1k WebP q85, which
    // is invisible at hull scale and takes a hull from ~10 MB to ~4 MB.
    steps.push(textureCompress({
      // (v38.92) WebP sources pass through untouched: re-encoding an authored 2k WebP at q88
      // is a generation of loss for no bytes (the c1seat hulls ship WebP already).
      encoder: sharp, targetFormat: 'webp', quality: 88, formats: /^image\/(png|jpeg)$/,
      slots: /baseColorTexture/,
    }));
    steps.push(textureCompress({
      encoder: sharp, targetFormat: 'webp', quality: 85, formats: /^image\/(png|jpeg|webp)$/,
      slots: /normalTexture|metallicRoughnessTexture|occlusionTexture/, resize: [1024, 1024],
    }));
    await doc.transform(...steps);
    return ratio < 1 ? `simplify ${ratio} + requantize (JPEG kept)` : `weld + quantize only, no simplify (Blender-authored hull)${o.join ? ' + join per material' : ''} ; PBR data maps 1k`;
  },

  // 2-5k tris carrying 3 MB of PNG. Pure texture bloat. EVERY slot is kept —
  // hub-city traffic clones these materials verbatim (see header).
  // Already quantized; a geometry round-trip would cost bytes, so we don't weld
  // or requantize, we only re-encode the images.
  hoard: async (doc) => {
    await doc.transform(dedup(), prune({ keepLeaves: true }), webp());
    return `WebP q${WEBP_Q}, all slots kept (hub traffic renders them)`;
  },

  // Skinned, 24 joints, 1 clip / 72 channels, float32 geometry, PNG baseColor.
  // baseColor is the only slot present, so there is nothing to drop.
  monster: async (doc) => {
    await doc.transform(
      dedup(), prune({ keepLeaves: true }), weld(),
      quantize({ ...Q, quantizeWeight: 8 }), webp(),
    );
    return `quantize + WebP q${WEBP_Q}`;
  },

  // ChampionShell. _champSelfIlluminate collapses it to MeshBasicMaterial({map}),
  // so normal/MR/emissive are decoded and discarded — the one free drop.
  // Textures are already WebP, so only the geometry moves.
  shell: async (doc) => {
    const freed = dropNonBaseColor(doc);
    await doc.transform(dedup(), prune({ keepLeaves: true }), weld(), quantize(Q), webp());
    return `drop discarded slots (${(freed / 1048576).toFixed(2)} MB) + quantize`;
  },

  // cyanring is cloned with NO material swap, so all five slots must survive.
  // fence.glb has no code reference at all but is kept on disk in case it gets
  // wired up; it is OUT of asset-manifest.json so nobody downloads it.
  ring: async (doc) => {
    await doc.transform(dedup(), prune({ keepLeaves: true }), weld(), quantize(Q));
    return 'quantize only (textures already WebP, all slots kept)';
  },
};

// --------------------------------------------------------------------- run --
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.glb')) out.push(rel);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`compress_glb: ${SRC} not found. It holds the pristine originals; nothing can be rebuilt without it.`);
  process.exit(1);
}

const all = walk(SRC).sort();
const files = ONLY ? all.filter((f) => f.includes(ONLY)) : all;
const mb = (n) => (n / 1048576).toFixed(2);

console.log(`compress_glb v${RECIPE_VERSION}${DRY ? '  [DRY RUN]' : ''}`);
console.log(`  ${SRC}  ->  ${DST}`);
console.log(`  ${files.length} of ${all.length} source GLBs\n`);
console.log('file'.padEnd(36) + 'cat'.padEnd(9) + 'before'.padStart(8) + 'after'.padStart(8) + 'saved'.padStart(8) + '  recipe');

let before = 0, after = 0, deadBytes = 0, removed = 0;
const per = {};

for (const rel of files) {
  const srcPath = path.join(SRC, rel);
  const dstPath = path.join(DST, rel);
  const srcBytes = fs.statSync(srcPath).size;
  before += srcBytes;

  if (DEAD.has(rel)) {
    deadBytes += srcBytes;
    let note = 'unreferenced + not in manifest';
    if (fs.existsSync(dstPath)) {
      if (!DRY) { fs.unlinkSync(dstPath); removed++; }
      note += DRY ? ' -> would remove from LSS/' : ' -> REMOVED from LSS/';
    }
    console.log(rel.padEnd(36) + categoryOf(rel).padEnd(9) + mb(srcBytes).padStart(8) +
      'DROP'.padStart(8) + mb(srcBytes).padStart(8) + '  ' + note);
    continue;
  }

  const o = OVERRIDES[rel] || {};
  const cat = categoryOf(rel);

  if (o.skip || !RECIPES[cat]) {
    after += srcBytes;
    if (!DRY) { fs.mkdirSync(path.dirname(dstPath), { recursive: true }); fs.copyFileSync(srcPath, dstPath); }
    console.log(rel.padEnd(36) + cat.padEnd(9) + mb(srcBytes).padStart(8) + mb(srcBytes).padStart(8) +
      '    0.00' + '  ' + (o.skip ? 'OVERRIDE skip: ' + (o.reason || 'shipped as-is') : 'no recipe for category — copied'));
    (per[cat] ??= { b: 0, a: 0, n: 0 }).b += srcBytes; per[cat].a += srcBytes; per[cat].n++;
    continue;
  }

  const doc = await io.read(srcPath);
  const note = await RECIPES[cat](doc, o);
  const bin = await io.writeBinary(doc);
  after += bin.byteLength;

  if (!DRY) {
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.writeFileSync(dstPath, Buffer.from(bin));
  }
  (per[cat] ??= { b: 0, a: 0, n: 0 }).b += srcBytes; per[cat].a += bin.byteLength; per[cat].n++;

  console.log(rel.padEnd(36) + cat.padEnd(9) + mb(srcBytes).padStart(8) + mb(bin.byteLength).padStart(8) +
    mb(srcBytes - bin.byteLength).padStart(8) + '  ' + note);

  // (v38.93) DEVICE VARIANT. `o.mobile` writes a SECOND copy of the finished file under
  // <dir>/m/<name> with the base-colour map resized (ships: 2k -> 1k, ~-0.7 MB and a 4x
  // cheaper decode per hull). The game picks it via _shipsVariant() when _lssTexCap() says
  // small device (phone / standalone Quest / window.__texCap override) and the preloader
  // walks the matching manifest group ('ships' vs 'ships_m'), so a PC never downloads the
  // 1k set and a phone never downloads the 2k one. Distinct URLs share _MODELS_VERSION: a
  // change to one set alone still needs the stamp bumped, exactly like any other GLB.
  if (o.mobile) {
    const mx = o.mobile.baseColorMax || 1024;
    const mdoc = cloneDocument(doc);
    if (o.mobile.lean) {
      // (v38.96) LEAN MOBILE HULLS. The c1seat hulls lost phones their GL context: per hull
      // ~117k tris (57k of it cockpit interior every bot carries around unseen), a 1k normal
      // map the game never samples in flight (buildModelShipMesh copies `map` only) but the
      // loader decodes and the thumbnail bake uploads, and clearcoat/specular/ior extensions
      // that make the loader build MeshPhysicalMaterial - the heaviest shader family - 14 per
      // hull. The small-device set keeps the base colour only, comes in as plain Standard
      // materials, and thins everything but the hull to cockpitRatio.
      const mroot = mdoc.getRoot();
      for (const m of mroot.listMaterials()) {
        m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null);
      }
      // Extension.dispose() strips the extension AND every property of it from the document,
      // so the materials come into three.js as MeshStandardMaterial, not MeshPhysicalMaterial.
      for (const e of mroot.listExtensionsUsed()) {
        if (/materials_(clearcoat|specular|ior|transmission|sheen|iridescence|volume|anisotropy)/.test(e.extensionName)) e.dispose();
      }
      // Re-weld with a normal tolerance: the hull carries authored split normals that keep
      // ~3 verts per triangle apart; on a phone the soft edge is the better trade.
      await mdoc.transform(dequantize(), weld({ toleranceNormal: 0.25 }));
      const prims = mroot.listMeshes().flatMap((mm) => mm.listPrimitives());
      const tri = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
      const hull = prims.reduce((a, b) => (tri(b) > tri(a) ? b : a));
      const ratio = o.mobile.cockpitRatio ?? 0.4;
      for (const p of prims) if (p !== hull && tri(p) > 300) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false });
      // identical materials now (no maps, no extensions) -> dedup + a second join shrinks draw calls
      await mdoc.transform(dedup(), prune({ keepLeaves: true }), join({ keepNamed: false, cleanup: false }),
                           prune({ keepLeaves: true }), dropJoinLeftovers, prune({ keepLeaves: true }), quantize(Q));
    }
    await mdoc.transform(textureCompress({
      encoder: sharp, targetFormat: 'webp', quality: 88, formats: /^image\/(png|jpeg|webp)$/,
      slots: /baseColorTexture/, resize: [mx, mx],
    }));
    const mrel = path.posix.join(path.posix.dirname(rel), 'm', path.posix.basename(rel));
    const mbin = await io.writeBinary(mdoc);
    if (!DRY) {
      const mp = path.join(DST, mrel);
      fs.mkdirSync(path.dirname(mp), { recursive: true });
      fs.writeFileSync(mp, Buffer.from(mbin));
    }
    const mcat = cat + '-m';
    (per[mcat] ??= { b: 0, a: 0, n: 0 }).b += bin.byteLength; per[mcat].a += mbin.byteLength; per[mcat].n++;
    console.log(mrel.padEnd(36) + mcat.padEnd(9) + mb(bin.byteLength).padStart(8) + mb(mbin.byteLength).padStart(8) +
      mb(bin.byteLength - mbin.byteLength).padStart(8) + `  mobile variant: base colour capped at ${mx}${o.mobile.lean ? ' ; lean (no PBR maps/extensions, cockpit x' + (o.mobile.cockpitRatio ?? 0.4) + ')' : ''}`);
  }
}

console.log('\n=== PER CATEGORY ===');
for (const [k, v] of Object.entries(per).sort((a, b) => b[1].b - a[1].b)) {
  console.log(`  ${k.padEnd(9)}${String(v.n).padStart(2)} files  ${mb(v.b).padStart(8)} -> ${mb(v.a).padStart(8)} MB   -${(100 * (1 - v.a / v.b)).toFixed(1)}%`);
}
if (deadBytes) console.log(`  ${'dead'.padEnd(9)}${String(DEAD.size).padStart(2)} files  ${mb(deadBytes).padStart(8)} ->     0.00 MB   -100%  (kept in assets_src/, ${removed} removed from LSS/)`);

console.log(`\nSHIPPED BYTES  ${mb(before)} MB -> ${mb(after)} MB`);
console.log(`SAVED          ${mb(before - after)} MB  (-${(100 * (1 - after / before)).toFixed(1)}%)`);
if (DRY) console.log('\n(dry run — nothing written)');
else console.log('\nNext: python tools/gen_manifest.py   # refresh preload sizes');
