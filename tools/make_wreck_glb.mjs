#!/usr/bin/env node
/**
 * make_wreck_glb.mjs - the Nexus set piece's lighter carrier (LSS 51.88). Run from the REPO ROOT:
 *
 *     node tools/make_wreck_glb.mjs                     # ratio 0.25 (120k -> ~30k triangles), maps capped at 1024
 *     node tools/make_wreck_glb.mjs --ratio 0.15 --tex 512
 *
 * Owner, on the 51.87 wreck in the Nexus: "laggy" ... "maybe edit the glb to make it simpler". The set piece bakes
 * carrier2.glb (120k triangles, already Blender-decimated from Meshy's 1.19 M) into ~30 breakable chunks at 2400 u. At that
 * size, in a dark scorched cavern, the 120k mostly buy vertex cost, a bigger distance grid to voxelise, and a 6 MB download.
 * This writes a DERIVED file beside it; carrier2.glb itself is untouched (the overworld may still want the full hull).
 *
 * Source: LSS/objects/carrier2.glb. There is no assets_src/objects/carrier2.glb (see compress_glb.mjs's OVERRIDES note), so
 * this derives from the shipped hull instead of the pristine one. Re-run it after carrier2.glb changes.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, dequantize, quantize, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RATIO = +arg('--ratio', 0.25), TEX = +arg('--tex', 1024), ERR = +arg('--err', 0.04);
const SRC = 'LSS/objects/carrier2.glb', DST = 'LSS/objects/carrier2_wreck.glb';

const tris = (doc) => { let n = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const ix = p.getIndices(); n += (ix ? ix.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return n; };

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const before = tris(doc);
await doc.transform(
  dedup(), prune({ keepLeaves: true }), dequantize(), weld(),
  // error 0.04 (of the hull's size): a scorched hull 2400 u long in a dark cavern can lose far more than a flying ship can.
  // 0.01 stopped at 56k - the error bound, not the ratio, was the limit
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERR }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX] }),
  quantize(), prune(),
);
await io.write(DST, doc);
console.log(`[wreck] ${SRC} -> ${DST}: ${before} -> ${tris(doc)} triangles, maps <= ${TEX}px, ` +
  `${(fs.statSync(SRC).size / 1048576).toFixed(2)} MB -> ${(fs.statSync(DST).size / 1048576).toFixed(2)} MB`);
