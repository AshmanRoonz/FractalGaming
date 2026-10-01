#!/usr/bin/env node
/**
 * ship_edit_splice.mjs - bring a Ship Lab XR edit (LSS/ship_lab_xr.html -> EXPORT -> <ship>_edit.glb) into the
 * game's source hull, assets_src/ships/<ship>.glb. Run from the REPO ROOT:
 *
 *     node tools/ship_edit_splice.mjs tracker backups/concept_ships/tracker_edit.glb          # write
 *     node tools/ship_edit_splice.mjs tracker backups/concept_ships/tracker_edit.glb --dry    # report only
 *     ... --box x0,x1,y0,y1,z0,z1     only edits INSIDE this ship-space box go in; outside it the shipped geometry is
 *                                    kept, so stray touches elsewhere (owner, on Tracker's first edit: "engine and
 *                                    wingtip? maybe that was an accident") are dropped. A triangle belongs to the side
 *                                    its centroid falls on - untouched triangles are identical in the edit and the
 *                                    shipped file, so the two halves meet without a seam as long as the box edge runs
 *                                    through untouched surface.
 *
 * then   node tools/compress_glb.mjs --only ships/tracker   and bump _MODELS_VERSION in index-working.html.
 *
 * The lab edits the SHIPPED file (LSS/ships/<ship>.glb: welded, joined per material, quantised), so every part of the
 * edit is compared with the shipped part it came from and ONLY what really changed is written:
 *   - GEOMETRY (sculpt, MELD, DELETE, PIECE moves): the source primitive with the same node + material is replaced by
 *     the edited one (positions / normals taken into the source node's frame). Untouched parts keep their float32
 *     source data byte for byte. A shipped part that compress_glb JOINED from several source nodes of one material
 *     (Tracker's hood + console pedestal) replaces the first of them and the others are removed.
 *   - PAINT (`__paint__<material>` nodes carry the raw layer): laid OVER the source colour map at the SOURCE's
 *     resolution (the shipped map is 2k, the source 4k) and re-encoded JPEG, so compress_glb's 2k cap still applies.
 *     A painted cockpit_CP_* map gets its own texture name, or _lssShareCockpitTextures (keyed by material + texture
 *     name + size) would fold it into the fleet's shared, unpainted copy.
 *   - COLOUR (FILL on untextured parts): the material's base colour factor.
 *   - MARKERS (PIECE on a gem): the source marker node, and backups/concept_ships/canopy/markers.json (the Blender
 *     recipe's copy, Blender frame [x, -z, y]) so a recipe re-run keeps them.
 * The source is backed up first (backups/concept_ships/pre_edit/), and after writing, every primitive, image,
 * material and node that was not meant to change is checked identical (the seat_splice.mjs fingerprint).
 * ⚠ The Blender .blend does NOT know about geometry or paint edits: re-exporting a ship from Blender (export_game.py)
 *   undoes them. Markers survive (markers.json).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), boxAt = argv.indexOf('--box');
const BOX = boxAt >= 0 ? (([x0, x1, y0, y1, z0, z1]) => ({ x0, x1, y0, y1, z0, z1 }))(argv[boxAt + 1].split(',').map(Number)) : null;
const [ship, editArg] = argv.filter((a, i) => !a.startsWith('--') && !(boxAt >= 0 && i === boxAt + 1));
const DRY = argv.includes('--dry');
const inBox = (c) => !BOX || (c[0] >= BOX.x0 && c[0] <= BOX.x1 && c[1] >= BOX.y0 && c[1] <= BOX.y1 && c[2] >= BOX.z0 && c[2] <= BOX.z1);
if (!ship || !editArg) { console.error('usage: node tools/ship_edit_splice.mjs <ship> <edit.glb> [--dry]'); process.exit(1); }
const SRC = path.join(REPO, 'assets_src/ships', ship + '.glb'), SHIPPED = path.join(REPO, 'LSS/ships', ship + '.glb');
const MARKERS_JSON = path.join(REPO, 'backups/concept_ships/canopy/markers.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const S = await io.read(SRC), Q = await io.read(SHIPPED), E = await io.read(path.resolve(REPO, editArg));

// ---------------------------------------------------------------- small math
const mul = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
function inv(m) {   // general 4x4 inverse (column-major)
  const a = m, o = new Array(16);
  o[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  o[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  o[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  o[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  o[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  o[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  o[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  o[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  o[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  o[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  o[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  o[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  o[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  o[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  o[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  o[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  const det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
  return o.map((x) => x / det);
}
const normalMat = (m) => { const i = inv(m); return [i[0], i[4], i[8], 0, i[1], i[5], i[9], 0, i[2], i[6], i[10], 0, 0, 0, 0, 1]; };   // inverse-transpose (3x3)
const h = (a) => crypto.createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 12);

// ---------------------------------------------------------------- parts
const parts = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh()).flatMap((n) => n.getMesh().listPrimitives().map((p, i) => ({ node: n, prim: p, i, name: n.getName(), mat: p.getMaterial() ? p.getMaterial().getName() : '' })));
const sp = parts(S), qp = parts(Q);
const baseName = (n) => n.replace(/_\d+$/, '');
const findIn = (list, name, mat) => list.find((x) => x.mat === mat && x.name === name) || list.find((x) => x.mat === mat && x.name === baseName(name));
function shipSpace(node, prim) {   // positions + normals in the edit's / shipped file's ship space
  const m = node.getWorldMatrix(), nm = normalMat(m), P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
  const n = P.getCount(), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), e = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e); pos.set(mul(m, e, 1), i * 3);
    if (N) { N.getElement(i, e); const v = mul(nm, e, 0), l = Math.hypot(v[0], v[1], v[2]) || 1; nrm.set([v[0] / l, v[1] / l, v[2] / l], i * 3); }
  }
  return { pos, nrm, n };
}
function uvOf(prim) { const A = prim.getAttribute('TEXCOORD_0'); if (!A) return null; const a = new Float32Array(A.getCount() * 2), e = [0, 0]; for (let i = 0; i < A.getCount(); i++) { A.getElement(i, e); a[i * 2] = e[0]; a[i * 2 + 1] = e[1]; } return a; }
const pkey = (g, i) => Math.round(g.pos[i * 3] * 2e4) + ',' + Math.round(g.pos[i * 3 + 1] * 2e4) + ',' + Math.round(g.pos[i * 3 + 2] * 2e4);
const centroid = (g, I, f) => [0, 1, 2].map((j) => (g.pos[I[f] * 3 + j] + g.pos[I[f + 1] * 3 + j] + g.pos[I[f + 2] * 3 + j]) / 3);
// new geometry for a part: the whole edit, or with --box the edit's triangles inside + the shipped ones outside
function newGeometry(e, q, eg, qg) {
  const eI = e.prim.getIndices().getArray(), eUV = uvOf(e.prim);
  if (!BOX) return { pos: eg.pos, nrm: eg.nrm, uv: eUV, idx: Uint32Array.from(eI), n: eg.n, inside: eI.length / 3, kept: 0 };
  const qI = q.prim.getIndices().getArray(), qUV = uvOf(q.prim), out = { pos: [], nrm: [], uv: eUV && qUV ? [] : null, idx: [] };
  const take = (g, uv, I, f, map) => { for (let k = 0; k < 3; k++) { const v = I[f + k]; let j = map.get(v); if (j === undefined) { j = out.pos.length / 3; map.set(v, j);
    out.pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]); out.nrm.push(g.nrm[v * 3], g.nrm[v * 3 + 1], g.nrm[v * 3 + 2]); if (out.uv) out.uv.push(uv[v * 2], uv[v * 2 + 1]); } out.idx.push(j); } };
  const qm = new Map(), em = new Map(); let inside = 0, kept = 0;
  for (let f = 0; f < qI.length; f += 3) if (!inBox(centroid(qg, qI, f))) { take(qg, qUV, qI, f, qm); kept++; }
  for (let f = 0; f < eI.length; f += 3) if (inBox(centroid(eg, eI, f))) { take(eg, eUV, eI, f, em); inside++; }
  return { pos: Float32Array.from(out.pos), nrm: Float32Array.from(out.nrm), uv: out.uv ? Float32Array.from(out.uv) : null, idx: Uint32Array.from(out.idx), n: out.pos.length / 3, inside, kept };
}
// a triangle soup's identity, independent of vertex order (did the merged result actually differ from what shipped?)
const faceSet = (g, I) => { const s = new Map(); for (let f = 0; f < I.length; f += 3) { const k = [pkey(g, I[f]), pkey(g, I[f + 1]), pkey(g, I[f + 2])].sort().join('|'); s.set(k, (s.get(k) || 0) + 1); } return s; };
const sameFaces = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
// fingerprint of everything that must survive (seat_splice.mjs, keyed by name + occurrence)
function fingerprint(doc, skip) {
  const f = {}, seen = {};
  for (const n of doc.getRoot().listNodes()) {
    f['node:' + n.getName()] = JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]);
    if (n.getMesh()) n.getMesh().listPrimitives().forEach((p, i) => {
      const k = n.getName() + '#' + i; if (skip.has(k)) return;
      f['prim:' + k] = p.listSemantics().sort().map((s) => s + '=' + h(p.getAttribute(s).getArray())).join(' ') + (p.getIndices() ? ' I=' + h(p.getIndices().getArray()) : '');
    });
  }
  for (const t of doc.getRoot().listTextures()) { if (skip.has('tex:' + t.getName())) continue; seen[t.getName()] = (seen[t.getName()] || 0) + 1; f['tex:' + t.getName() + '#' + seen[t.getName()]] = h(t.getImage()); }
  for (const m of doc.getRoot().listMaterials()) if (!skip.has('mat:' + m.getName())) f['mat:' + m.getName()] = JSON.stringify([m.getBaseColorFactor(), m.getEmissiveFactor()]);
  return f;
}

// ---------------------------------------------------------------- 1. what changed
const plan = [], skip = new Set(), notes = [];
for (const e of parts(E)) {
  if (e.name.startsWith('__paint__')) continue;
  const q = findIn(qp, e.name, e.mat), s = findIn(sp, e.name, e.mat);
  if (!q || !s) { notes.push(`${e.name} (${e.mat}): no ${!q ? 'shipped' : 'source'} match - skipped`); continue; }
  const eg0 = shipSpace(e.node, e.prim), qg = shipSpace(q.node, q.prim), qTris = q.prim.getIndices().getCount() / 3;
  const eg = newGeometry(e, q, eg0, qg), eTris = eg.idx.length / 3;
  let changed = !sameFaces(faceSet(eg, eg.idx), faceSet(qg, q.prim.getIndices().getArray())), maxMove = 0;
  if (changed && eg.n === qg.n && eTris === qTris && !BOX) { for (let i = 0; i < eg.pos.length; i += 3) maxMove = Math.max(maxMove, Math.hypot(eg.pos[i] - qg.pos[i], eg.pos[i + 1] - qg.pos[i + 1], eg.pos[i + 2] - qg.pos[i + 2])); }
  if (BOX && changed) notes.push(`${e.name}: ${eg.inside} edited triangles inside the box + ${eg.kept} shipped ones outside it`);
  const ef = e.prim.getMaterial().getBaseColorFactor(), qf = q.prim.getMaterial().getBaseColorFactor();
  const colour = ef.some((v, k) => Math.abs(v - qf[k]) > 1e-4) ? ef : null;
  if (changed || colour) plan.push({ e, q, s, eg, changed, colour, eTris, qTris, maxMove });
}
// paint layers with anything on them
const paints = [];
for (const n of E.getRoot().listNodes().filter((x) => x.getName().startsWith('__paint__') && x.getMesh())) {
  const t = n.getMesh().listPrimitives()[0].getMaterial().getBaseColorTexture(); if (!t) continue;
  const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let painted = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
  const mat = n.getMesh().listPrimitives()[0].getMaterial().getName().replace(/^__paint__/, '');
  if (painted) paints.push({ mat, png: Buffer.from(t.getImage()), painted, w: info.width, h: info.height });
  else notes.push(`${n.getName()}: paint layer is empty - nothing to lay down`);
}
// markers
const markersOf = (doc) => Object.fromEntries(doc.getRoot().listNodes().filter((n) => !n.getMesh() && /^(gun|thruster|cockpit)\d+$/.test(n.getName())).map((n) => [n.getName(), n.getWorldMatrix().slice(12, 15)]));
const em = markersOf(E), qm = markersOf(Q), moves = [];
for (const k of Object.keys(em)) if (qm[k] && Math.hypot(em[k][0] - qm[k][0], em[k][1] - qm[k][1], em[k][2] - qm[k][2]) > 1e-5) moves.push({ name: k, from: qm[k], to: em[k] });

console.log(`${ship}: ${plan.filter((p) => p.changed).length} part(s) with new geometry, ${plan.filter((p) => p.colour).length} recoloured, ${paints.length} painted, ${moves.length} marker(s) moved`);
for (const p of plan) console.log(`  ${p.e.name} [${p.e.mat}] ${p.changed ? (p.eTris !== p.qTris ? `tris ${p.qTris} -> ${p.eTris}` : `sculpted, max move ${p.maxMove.toFixed(5)}`) : ''}${p.colour ? ' colour ' + p.colour.map((v) => v.toFixed(3)).join(',') : ''}`);
for (const p of paints) console.log(`  paint on ${p.mat}: ${p.painted} texels of a ${p.w}x${p.h} layer`);
for (const m of moves) console.log(`  marker ${m.name}: ${m.from.map((v) => v.toFixed(4))} -> ${m.to.map((v) => v.toFixed(4))}`);
for (const n of notes) console.log('  note: ' + n);
if (!plan.length && !paints.length && !moves.length) { console.log('nothing to do'); process.exit(0); }
if (DRY) { console.log('(dry run - nothing written)'); process.exit(0); }

// ---------------------------------------------------------------- 2. apply
const buf = S.getRoot().listBuffers()[0];
for (const p of plan) {
  const sk = p.s.name + '#' + p.s.i;
  if (p.colour) { p.s.prim.getMaterial().setBaseColorFactor(p.colour); skip.add('mat:' + p.s.mat); }
  if (!p.changed) continue;
  skip.add(sk);
  // into the source node's frame (identity for the concept ships, but don't assume it)
  const sm = p.s.node.getWorldMatrix(), si = inv(sm), sn = normalMat(si), n = p.eg.n;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(mul(si, [p.eg.pos[i * 3], p.eg.pos[i * 3 + 1], p.eg.pos[i * 3 + 2]], 1), i * 3);
    const v = mul(sn, [p.eg.nrm[i * 3], p.eg.nrm[i * 3 + 1], p.eg.nrm[i * 3 + 2]], 0), l = Math.hypot(v[0], v[1], v[2]) || 1; nrm.set([v[0] / l, v[1] / l, v[2] / l], i * 3);
  }
  const prim = p.s.prim, old = [...prim.listSemantics().map((k) => prim.getAttribute(k)), prim.getIndices()].filter(Boolean);
  for (const k of prim.listSemantics()) prim.setAttribute(k, null);
  prim.setAttribute('POSITION', S.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf));
  prim.setAttribute('NORMAL', S.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf));
  if (p.eg.uv) prim.setAttribute('TEXCOORD_0', S.createAccessor().setType('VEC2').setArray(p.eg.uv).setBuffer(buf));
  prim.setIndices(S.createAccessor().setType('SCALAR').setArray(p.eg.idx).setBuffer(buf));
  for (const a of old) if (a.listParents().every((x) => x.propertyType === 'Root')) a.dispose();
  // a shipped part JOINED from several source nodes of this material: the edit already holds all of them
  const siblings = sp.filter((x) => x !== p.s && x.mat === p.s.mat && x.node.getParentNode() === p.s.node.getParentNode() && !qp.some((q) => q.name === x.name && q.mat === x.mat));
  for (const x of siblings) { console.log(`  ${x.name} was joined into ${p.q.name} when shipped - removed (its triangles are in the edit)`); skip.add(x.name + '#' + x.i); x.node.setMesh(null); }
}
for (const p of paints) {
  const mat = S.getRoot().listMaterials().find((m) => m.getName() === p.mat), tex = mat && mat.getBaseColorTexture();
  if (!tex) { console.log(`  paint on ${p.mat}: no colour map in the source - skipped`); continue; }
  const base = sharp(Buffer.from(tex.getImage())), meta = await base.metadata();
  const layer = await sharp(p.png).resize(meta.width, meta.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const out = await base.composite([{ input: layer, blend: 'over' }]).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  // its own texture (a copy if another material shares it), named so the fleet texture share never folds it away
  const own = tex.listParents().filter((x) => x.propertyType === 'Material').length > 1 || /^cockpit_CP_/.test(p.mat);
  const t2 = own ? S.createTexture(tex.getName() + '_' + ship + '_paint') : tex;
  t2.setImage(new Uint8Array(out)).setMimeType('image/jpeg'); if (own) mat.setBaseColorTexture(t2);
  skip.add('tex:' + tex.getName());
  console.log(`  paint laid on ${p.mat}: ${meta.width}x${meta.height} -> ${(out.length / 1048576).toFixed(1)} MB JPEG${own ? ' as ' + t2.getName() : ''}`);
}
if (moves.length) {
  const mj = JSON.parse(fs.readFileSync(MARKERS_JSON, 'utf8'));
  for (const m of moves) {
    const n = S.getRoot().listNodes().find((x) => x.getName() === m.name && !x.getMesh()); if (!n) { console.log(`  marker ${m.name}: not in the source - skipped`); continue; }
    const par = n.getParentNode(), pm = par ? inv(par.getWorldMatrix()) : null;
    n.setTranslation(pm ? mul(pm, m.to, 1) : m.to); skip.add('node:' + m.name);
    if (mj[ship]) mj[ship][m.name] = [m.to[0], -m.to[2], m.to[1]].map((v) => +v.toFixed(5));
  }
  fs.writeFileSync(MARKERS_JSON, JSON.stringify(mj, null, 1));
}

// ---------------------------------------------------------------- 3. back up, write, verify
const keep = fingerprint(await io.read(SRC), skip);
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
const bak = path.join(REPO, 'backups/concept_ships/pre_edit', `${ship}_${stamp}.glb`);
fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(SRC, bak);
const tmp = SRC + '.edit.tmp'; fs.writeFileSync(tmp, Buffer.from(await io.writeBinary(S)));
const got = fingerprint(await io.read(tmp), skip);
const diff = [...new Set([...Object.keys(keep), ...Object.keys(got)])].filter((k) => keep[k] !== got[k] && !k.startsWith('node:'));
if (diff.length) { fs.unlinkSync(tmp); console.error('VERIFY FAILED - source untouched:', diff.slice(0, 12)); process.exit(2); }
fs.renameSync(tmp, SRC);
console.log(`wrote ${path.relative(REPO, SRC)} (${Object.keys(keep).length} untouched properties verified identical); backup ${path.relative(REPO, bak)}`);
console.log(`next: node tools/compress_glb.mjs --only ships/${ship}   then bump _MODELS_VERSION`);
