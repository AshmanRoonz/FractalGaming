#!/usr/bin/env node
/**
 * ship_lab_model.mjs - make Ship Lab XR's copy of a model that is NOT one of the seven shipped hulls (those the lab
 * reads straight from LSS/ships/, so they are always the game's). Run from the REPO ROOT:
 *
 *     node tools/ship_lab_model.mjs <in.glb> <out.glb> [--name cockpit4_game_cockpit] [--max 2048] [--q 90]
 *
 * - Geometry, markers and materials are copied untouched.
 * - Textures are re-encoded as WebP no larger than --max (default 2048), so the file deploys under Cloudflare Pages'
 *   25 MiB-a-file cap. The lab only feeds GEOMETRY back to the game, so 2k is plenty to see what you are editing.
 * - Every unnamed mesh, and the node that carries it, gets --name. The lab keys its autosave and its export on the
 *   piece name, and finds the SEAT height from a `_game_cockpit` piece.
 *
 * 2026-10-01: LSS/ships/edit/cockpit4_lab.glb = this script over LSS/backups/cockpit_edit/cockpit4_edit4.glb, the
 * owner's VR edit that became the seat in all seven ships (v50.70-50.72, canopy/scripts/cockpit4_swap.mjs). Before
 * that the lab offered the UNEDITED Meshy cockpit (10,094 tris) while the game flew the edit (6,827).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [inPath, outPath] = pos;
if (!inPath || !outPath) {
  console.error('usage: node tools/ship_lab_model.mjs <in.glb> <out.glb> [--name <piece name>] [--max 2048] [--q 90]');
  process.exit(1);
}
const name = opt('--name', null);
const max = +opt('--max', 2048);
const quality = +opt('--q', 90);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();

let named = 0;
if (name) {
  for (const m of root.listMeshes()) if (!m.getName()) { m.setName(name); named++; }
  for (const n of root.listNodes()) if (n.getMesh() && !n.getName()) { n.setName(name); named++; }
}
const before = root.listTextures().map((t) => { const s = t.getSize(); return (t.getMimeType() || '?') + ' ' + (s ? s.join('x') : '?'); });
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality }));
const after = root.listTextures().map((t) => { const s = t.getSize(); return (t.getMimeType() || '?') + ' ' + (s ? s.join('x') : '?'); });
await io.write(outPath, doc);

const tris = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0), 0);
console.log('in   ' + inPath + ' (' + (fs.statSync(inPath).size / 1048576).toFixed(1) + ' MB)');
console.log('out  ' + outPath + ' (' + (fs.statSync(outPath).size / 1048576).toFixed(1) + ' MB)');
console.log('     ' + root.listMeshes().length + ' mesh(es), ' + tris.toLocaleString() + ' tris, ' + named + ' name(s) set'
  + ', nodes: ' + root.listNodes().map((n) => n.getName() || '(unnamed)').join(', '));
console.log('     textures ' + before.join(' | ') + '  ->  ' + after.join(' | '));
