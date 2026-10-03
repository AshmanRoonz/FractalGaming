#!/usr/bin/env node
/**
 * ship_cockpit_fix.mjs - put a ship's cockpit parts back from an OLDER source, and/or paint its tub solid.
 * Run from the REPO ROOT (it edits assets_src/ships/<ship>.glb; compress_glb rebuilds LSS/ships + ships/m from it):
 *
 *     node tools/ship_cockpit_fix.mjs puncture --from backups/concept_ships/pre_fit/puncture_20261003T0552.glb --console --hood --dry
 *     node tools/ship_cockpit_fix.mjs puncture --from <older.glb> --console --hood      # write
 *     node tools/ship_cockpit_fix.mjs slayer --tub '#699852'                             # tub only
 *
 *   --console   the cockpit_CP_console1 primitive (geometry AND its base-colour map) exactly as the older source had it.
 *               The screens (cockpit_CP_screen) are left alone: they are what cockpit1 and the frame solve key on.
 *   --hood      the <ship>_game_hood + <ship>_game_pedestal meshes from the older source, onto the empty nodes the
 *               FIT-OUT splice left behind (same names, same identity transforms), in the cockpit_CP_hood material
 *   --tub HEX   cockpit_CP_tub loses its map and becomes solid HEX (sRGB, stored linear - glTF's baseColorFactor is linear)
 *
 * (2026-10-03, v51.22) Owner: "puncture and pyro, i messed up their consoles, and stretched them, i was trying to replace
 * the hoods but it looks dumb... we could just replace the console with the original and delete the stretched one...
 * make sure it's placed in the same spot / after you replace the console with the fixed one, put on the hoods on those
 * two ships / then on every ship, there is a part called the tub, it needs to be painted solid, the ship's main color".
 * The stretched consoles were the lab's console asset (its own vertex order), re-placed and scaled along x from its rear
 * face; the screens never moved. So "the same spot" IS the pre-fit-out placement: same rear face, top and width, same
 * screens - the older source's primitive, copied whole.
 *
 * Safety: the source is backed up first (backups/concept_ships/pre_cockpit_fix/), and after the edit every node,
 * transform, primitive and material that was not meant to change is compared with the file as read - the write is
 * refused on any difference. The restored parts are checked against the older source (world-space bounds).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const ship = argv[0];
const FROM = val('--from'), TUB = val('--tub');
const DO_CONSOLE = flag('--console'), DO_HOOD = flag('--hood'), DRY = flag('--dry');
if (!ship || ship.startsWith('--') || (!(DO_CONSOLE || DO_HOOD) && !TUB) || ((DO_CONSOLE || DO_HOOD) && !FROM)) {
  console.error('usage: node tools/ship_cockpit_fix.mjs <ship> [--from <older.glb> --console --hood] [--tub "#rrggbb"] [--dry]');
  process.exit(1);
}
const SRC = path.join(REPO, 'assets_src/ships', ship + '.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const S = await io.read(SRC);
const P = FROM ? await io.read(path.resolve(REPO, FROM)) : null;
const buf = S.getRoot().listBuffers()[0];

// ------------------------------------------------------------------ helpers
const sha = (a) => crypto.createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 12);
const mulP = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
function worldBox(node, prim) {
  const W = node.getWorldMatrix(), pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const w = mulP(W, v); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); } }
  return { lo, hi };
}
const boxStr = (b) => `[${b.lo.map((x) => x.toFixed(4)).join(',')}]..[${b.hi.map((x) => x.toFixed(4)).join(',')}]`;
function copyAcc(acc) {
  return S.createAccessor(acc.getName()).setType(acc.getType()).setArray(acc.getArray().slice()).setNormalized(acc.getNormalized()).setBuffer(buf);
}
function copyTexture(tx) {
  return S.createTexture(tx.getName()).setImage(tx.getImage().slice()).setMimeType(tx.getMimeType()).setURI(tx.getURI() || '');
}
// a property nothing but the root points at any more
function disposeIfOrphan(p) { if (p && p.listParents().filter((x) => x.propertyType !== 'Root').length === 0) { p.dispose(); return true; } return false; }
function primByMat(doc, matName, nodeRe) {
  for (const n of doc.getRoot().listNodes()) {
    if (nodeRe && !nodeRe.test(n.getName())) continue;
    const m = n.getMesh(); if (!m) continue;
    for (const p of m.listPrimitives()) if (p.getMaterial() && p.getMaterial().getName() === matName) return { node: n, mesh: m, prim: p };
  }
  return null;
}
const nodeByName = (doc, nm) => doc.getRoot().listNodes().find((n) => n.getName() === nm) || null;
// everything about the file that is NOT meant to change, as one map (name -> signature)
function snapshot(doc, skip) {
  const out = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const key = 'node:' + n.getName();
    const parent = n.getParentNode() ? n.getParentNode().getName() : '-';
    let sig = `${parent}|${n.getMatrix().map((x) => x.toFixed(7)).join(',')}|${JSON.stringify(n.getExtras())}`;
    const m = n.getMesh();
    if (skip.nodes.has(n.getName())) sig += '|restored';   // its mesh is what changes; its place / parent may not
    else if (m) {
      sig += '|' + m.listPrimitives().map((p) => {
        if (skip.prims.has(p)) return 'SKIP';
        const mat = p.getMaterial();
        return (mat ? mat.getName() : '-') + ':' + p.listSemantics().map((s) => s + '=' + sha(p.getAttribute(s).getArray())).join(';') + ':' + (p.getIndices() ? sha(p.getIndices().getArray()) : '-');
      }).join('/');
    } else if (!m) sig += '|nomesh';
    out.set(key, sig);
  }
  for (const mat of doc.getRoot().listMaterials()) {
    if (skip.mats.has(mat.getName())) continue;
    if (mat.listParents().filter((x) => x.propertyType !== 'Root').length === 0) continue;   // unused (a restored part may adopt it)
    const tx = ['BaseColor', 'Normal', 'MetallicRoughness', 'Emissive', 'Occlusion'].map((s) => { const t = mat['get' + s + 'Texture'](); return t ? s + '=' + sha(t.getImage()) : ''; }).join(',');
    out.set('mat:' + mat.getName(), `${mat.getBaseColorFactor().join(',')}|${mat.getEmissiveFactor().join(',')}|${mat.getRoughnessFactor()}|${mat.getMetallicFactor()}|${mat.getDoubleSided()}|${mat.getAlphaMode()}|${tx}`);
  }
  return out;
}

// ------------------------------------------------------------------ what changes
const skip = { nodes: new Set(), prims: new Set(), mats: new Set() };
const sCon = primByMat(S, 'cockpit_CP_console1'), pCon = P ? primByMat(P, 'cockpit_CP_console1') : null;
if (DO_CONSOLE) {
  if (!sCon || !pCon) throw new Error('no cockpit_CP_console1 primitive in ' + (!sCon ? 'the source' : 'the older file'));
  skip.prims.add(sCon.prim); skip.mats.add('cockpit_CP_console1');
}
const hoodNames = [ship + '_game_hood', ship + '_game_pedestal'];
if (DO_HOOD) { for (const nm of hoodNames) skip.nodes.add(nm); skip.mats.add('cockpit_CP_hood'); }   // its factors are set from the older file
if (TUB) skip.mats.add('cockpit_CP_tub');
const before = snapshot(S, skip);
const report = [];

// ------------------------------------------------------------------ the console
if (DO_CONSOLE) {
  const was = worldBox(sCon.node, sCon.prim);
  const sem = pCon.prim.listSemantics();
  for (const s of sCon.prim.listSemantics()) if (!sem.includes(s)) { const a = sCon.prim.getAttribute(s); sCon.prim.setAttribute(s, null); disposeIfOrphan(a); }
  for (const s of sem) { const old = sCon.prim.getAttribute(s); sCon.prim.setAttribute(s, copyAcc(pCon.prim.getAttribute(s))); disposeIfOrphan(old); }
  { const old = sCon.prim.getIndices(); sCon.prim.setIndices(copyAcc(pCon.prim.getIndices())); disposeIfOrphan(old); }
  // its base-colour map, the older file's (the fleet's shared console art); the other maps are checked equal
  const sm = sCon.prim.getMaterial(), pm = pCon.prim.getMaterial();
  const oldTx = sm.getBaseColorTexture(), pTx = pm.getBaseColorTexture();
  sm.setBaseColorTexture(pTx ? copyTexture(pTx) : null);
  if (pTx) {
    const si = sm.getBaseColorTextureInfo(), pi = pm.getBaseColorTextureInfo();
    si.setTexCoord(pi.getTexCoord()).setWrapS(pi.getWrapS()).setWrapT(pi.getWrapT());
    if (pi.getMagFilter() != null) si.setMagFilter(pi.getMagFilter());
    if (pi.getMinFilter() != null) si.setMinFilter(pi.getMinFilter());
  }
  if (oldTx && oldTx !== sm.getBaseColorTexture()) disposeIfOrphan(oldTx);
  for (const s of ['Normal', 'MetallicRoughness', 'Emissive', 'Occlusion']) {
    const a = sm['get' + s + 'Texture'](), b = pm['get' + s + 'Texture']();
    if (!!a !== !!b || (a && sha(a.getImage()) !== sha(b.getImage()))) throw new Error('console material ' + s + ' map differs from the older file - not handled');
  }
  for (const k of ['BaseColorFactor', 'EmissiveFactor', 'RoughnessFactor', 'MetallicFactor', 'DoubleSided', 'AlphaMode']) sm['set' + k](pm['get' + k]());
  const now = worldBox(sCon.node, sCon.prim), ref = worldBox(pCon.node, pCon.prim);
  report.push(`console: ${boxStr(was)} -> ${boxStr(now)}   (older file ${boxStr(ref)})   map ${oldTx ? oldTx.getName() : '-'} -> ${pTx ? pTx.getName() : '-'}`);
  if (boxStr(now) !== boxStr(ref)) throw new Error('restored console is not where the older file had it');
}

// ------------------------------------------------------------------ the hood (+ its pedestal)
if (DO_HOOD) {
  let hoodMat = S.getRoot().listMaterials().find((m) => m.getName() === 'cockpit_CP_hood');
  for (const nm of hoodNames) {
    const sn = nodeByName(S, nm), pn = nodeByName(P, nm);
    if (!pn || !pn.getMesh()) { report.push(`${nm}: not in the older file - skipped`); continue; }
    if (!sn) throw new Error(nm + ': no such node in the source (the splice normally leaves it, empty)');
    if (sn.getMesh()) throw new Error(nm + ': the source node already has a mesh');
    if (sn.getMatrix().map((x) => x.toFixed(7)).join() !== pn.getMatrix().map((x) => x.toFixed(7)).join() ||
        (sn.getParentNode() && sn.getParentNode().getName()) !== (pn.getParentNode() && pn.getParentNode().getName())) throw new Error(nm + ': node transform / parent differ from the older file');
    const pm = pn.getMesh(), mesh = S.createMesh(pm.getName());
    for (const pp of pm.listPrimitives()) {
      const mat = pp.getMaterial();
      if (mat && mat.getName() === 'cockpit_CP_hood') {
        if (!hoodMat) hoodMat = S.createMaterial('cockpit_CP_hood');
        for (const k of ['BaseColorFactor', 'EmissiveFactor', 'RoughnessFactor', 'MetallicFactor', 'DoubleSided', 'AlphaMode']) hoodMat['set' + k](mat['get' + k]());
      } else throw new Error(nm + ': unexpected material ' + (mat && mat.getName()));
      const np = S.createPrimitive().setMode(pp.getMode()).setMaterial(hoodMat);
      for (const s of pp.listSemantics()) np.setAttribute(s, copyAcc(pp.getAttribute(s)));
      if (pp.getIndices()) np.setIndices(copyAcc(pp.getIndices()));
      mesh.addPrimitive(np);
    }
    sn.setMesh(mesh);
    const a = worldBox(sn, mesh.listPrimitives()[0]), b = worldBox(pn, pm.listPrimitives()[0]);
    report.push(`${nm}: ${boxStr(a)}   (older file ${boxStr(b)})`);
    if (boxStr(a) !== boxStr(b)) throw new Error(nm + ' is not where the older file had it');
  }
}

// ------------------------------------------------------------------ the tub, solid
if (TUB) {
  const m = /^#?([0-9a-f]{6})$/i.exec(TUB);
  if (!m) throw new Error('--tub wants #rrggbb');
  const hex = parseInt(m[1], 16), lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const f = [lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255), 1];
  const tub = S.getRoot().listMaterials().find((x) => x.getName() === 'cockpit_CP_tub');
  if (!tub) throw new Error('no cockpit_CP_tub material');
  const old = tub.getBaseColorTexture();
  tub.setBaseColorTexture(null).setBaseColorFactor(f);
  if (old) disposeIfOrphan(old);
  report.push(`tub: ${old ? old.getName() : 'no map'} -> solid #${m[1].toLowerCase()} (linear ${f.slice(0, 3).map((x) => x.toFixed(4)).join(',')})`);
}

// ------------------------------------------------------------------ nothing else moved
const after = snapshot(S, skip);
const diffs = [];
for (const [k, v] of before) if (after.get(k) !== v) diffs.push(k);
for (const k of after.keys()) if (!before.has(k)) diffs.push('+' + k);
console.log(ship + ':\n  ' + report.join('\n  '));
if (diffs.length) { console.error('  REFUSED - unexpected changes: ' + diffs.join(', ')); process.exit(2); }
console.log('  everything else identical (' + before.size + ' nodes + materials compared)');
if (DRY) { console.log('  --dry: nothing written'); process.exit(0); }
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const bdir = path.join(REPO, 'backups/concept_ships/pre_cockpit_fix');
fs.mkdirSync(bdir, { recursive: true });
fs.copyFileSync(SRC, path.join(bdir, `${ship}_${stamp}.glb`));
await io.write(SRC, S);
console.log('  wrote ' + path.relative(REPO, SRC) + ' (backup backups/concept_ships/pre_cockpit_fix/' + ship + '_' + stamp + '.glb)');
console.log('  next: node tools/compress_glb.mjs --only ' + ship + '   then bump _MODELS_VERSION');
