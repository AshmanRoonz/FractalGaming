// Put the canopy glass back on the ships.
//
// The v37.36 cockpit pipeline built each hull with four materials - Material_0 (the hull),
// canopy_glass, cockpit_interior and cockpit_frame - and those files still exist, untouched, in
// tools/blender/work/ref/. What ships today came from tools/blender/ship_original.py instead: the
// SAME hull mesh, re-exported on its own, so the glass, the interior and the frame were dropped.
// Measured: the ref hull dequantizes to within 0.001 of the shipped hull on every ship, which is
// why this graft is a copy rather than a fit.
//
//   node tools/graft_canopy_glass.mjs                 # all seven
//   node tools/graft_canopy_glass.mjs --only vortex
//   node tools/graft_canopy_glass.mjs --part cockpit_interior
//
// ⚠ NOTHING IS OVERWRITTEN. Reads assets_src/ships/ (the pristine sources, untracked) and
// tools/blender/work/ref/ (the pipeline's own output), writes assets_src/ships_glass/. Run
// tools/compress_glb.mjs afterwards to produce LSS/ships_glass/.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const REF = path.join(REPO, 'tools', 'blender', 'work', 'ref');
const SRC = path.join(REPO, 'assets_src', 'ships');
const OUT = path.join(REPO, 'assets_src', 'ships_glass');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ONLY = arg('--only', null);
const PART = arg('--part', 'canopy_glass');

const SHIPS = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex']
  .filter(s => !ONLY || s.includes(ONLY));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });

// world transform of a node, walking up the parent chain (these files have no rotations on the
// mesh nodes - asserted below rather than assumed)
function worldTRS(node) {
  let s = [1, 1, 1], t = [0, 0, 0];
  const chain = [];
  for (let n = node; n; n = n.getParentNode ? n.getParentNode() : null) chain.push(n);
  for (const n of chain.reverse()) {
    const r = n.getRotation();
    if (Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) > 1e-6) {
      throw new Error(`node ${n.getName()} carries a rotation; this script assumes none`);
    }
    const ns = n.getScale(), nt = n.getTranslation();
    t = [0, 1, 2].map(d => t[d] + s[d] * nt[d]);
    s = [0, 1, 2].map(d => s[d] * ns[d]);
  }
  return { s, t };
}

let done = 0;
for (const ship of SHIPS) {
  const refPath = path.join(REF, ship + '.glb');
  const srcPath = path.join(SRC, ship + '.glb');
  if (!fs.existsSync(refPath) || !fs.existsSync(srcPath)) {
    console.warn(`skip ${ship}: missing ${!fs.existsSync(refPath) ? refPath : srcPath}`);
    continue;
  }
  const ref = await io.read(refPath);
  await ref.transform(dequantize());          // int16 -> float32, still in node-local space

  // find the primitive carrying the part, and the node that draws it
  let found = null;
  for (const node of ref.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const m = prim.getMaterial();
      if (m && m.getName() === PART) found = { node, prim, mat: m };
    }
  }
  if (!found) { console.warn(`skip ${ship}: no '${PART}' primitive in the reference`); continue; }

  const { s, t } = worldTRS(found.node);
  const pos = found.prim.getAttribute('POSITION').getArray();
  const nrm = found.prim.getAttribute('NORMAL');
  const idx = found.prim.getIndices();

  // bake the node transform into the positions: the target's mesh node is identity, so the
  // reference's WORLD space is the target's local space
  const outPos = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    outPos[i]     = pos[i]     * s[0] + t[0];
    outPos[i + 1] = pos[i + 1] * s[1] + t[1];
    outPos[i + 2] = pos[i + 2] * s[2] + t[2];
  }

  // ---- graft into a copy of the shipped hull ----
  const dst = await io.read(srcPath);
  const buf = dst.getRoot().listBuffers()[0] || dst.createBuffer();

  const dstMesh = dst.getRoot().listMeshes()[0];
  if (!dstMesh) { console.warn(`skip ${ship}: target has no mesh`); continue; }
  // assert the target node really is identity - the whole graft rests on it
  const dstNode = dst.getRoot().listNodes().find(n => n.getMesh() === dstMesh);
  const ds = dstNode.getScale(), dt = dstNode.getTranslation();
  const ident = Math.abs(ds[0] - 1) + Math.abs(ds[1] - 1) + Math.abs(ds[2] - 1) +
                Math.abs(dt[0]) + Math.abs(dt[1]) + Math.abs(dt[2]);
  if (ident > 1e-4) { console.warn(`skip ${ship}: target mesh node is not identity (${ds}, ${dt})`); continue; }

  const posAcc = dst.createAccessor(PART + '_POSITION').setType('VEC3').setArray(outPos).setBuffer(buf);
  const prim = dst.createPrimitive().setAttribute('POSITION', posAcc);
  if (nrm) {
    prim.setAttribute('NORMAL', dst.createAccessor(PART + '_NORMAL')
      .setType('VEC3').setArray(new Float32Array(nrm.getArray())).setBuffer(buf));
  }
  if (idx) {
    prim.setIndices(dst.createAccessor(PART + '_INDEX')
      .setType('SCALAR').setArray(new Uint32Array(idx.getArray())).setBuffer(buf));
  }

  // rebuild the material rather than copying it across documents: only the fields the game reads
  const rm = found.mat;
  const mat = dst.createMaterial(PART)
    .setAlphaMode(rm.getAlphaMode())
    .setBaseColorFactor(rm.getBaseColorFactor())
    .setRoughnessFactor(rm.getRoughnessFactor())
    .setMetallicFactor(rm.getMetallicFactor())
    .setDoubleSided(rm.getDoubleSided());
  prim.setMaterial(mat);
  dstMesh.addPrimitive(prim);

  const outPath = path.join(OUT, ship + '.glb');
  await io.write(outPath, dst);
  const bc = rm.getBaseColorFactor();
  console.log(`${ship.padEnd(9)} + ${PART}: ${(outPos.length / 3).toString().padStart(6)} verts, ` +
              `alpha ${bc[3].toFixed(2)}, tint ${bc.slice(0, 3).map(v => v.toFixed(2)).join('/')} ` +
              `-> ${path.relative(REPO, outPath)}`);
  done++;
}
console.log(`\n${done} hull(s) written to ${path.relative(REPO, OUT)} ; assets_src/ships is untouched.`);
