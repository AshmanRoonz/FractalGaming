#!/usr/bin/env node
/**
 * fit_parts_prep.mjs - the parts Ship Lab XR's FIT-OUT mode places by hand, and where each one starts in every ship.
 * Run from the REPO ROOT:   node tools/fit_parts_prep.mjs [--dry]
 *
 * Owner (2026-10-02): "in the ship_lab_xr i want the ships without the cockpit or console... i want to be able to place
 * the objects inside the ships... i want to do the fitting myself". So the lab loads each hull BARE (no seat, console,
 * hood or arm panels) and offers the two parts on its ADD page. This script makes what that needs:
 *
 *   LSS/ships/edit/console1_lab.glb   THE CONSOLE - the game's console1 (the owner's Meshy console1.glb, welded, decimated
 *                                     734k -> 20k, normal re-baked: Blender object console1_lo) with its screens split off as
 *                                     cockpit_CP_screen. Four ships carry it UNCLIPPED (blaster / puncture / pyro / vortex:
 *                                     19,866 + 134 tris); slayer / syphon / tracker lost a few triangles where it sinks into
 *                                     the bowl. Lifted from blaster and taken into the SEAT's lab frame through blaster's
 *                                     own seat placement, so the console and the seat models share one scale.
 *   LSS/ships/edit/fit_parts.json     where each part starts in each ship = where the game has it now:
 *     seat     the seat model is LSS/ships/edit/cockpit4_lab.glb (= cockpit4_seat_v5090.glb: the owner's edit (6),
 *              un-turned, reclined 8.6 deg, width x0.85 - exactly what all seven ships wear before their roof trim), and
 *              cockpit4_swap2.mjs placed it at  ship = T + s (P + D)  with each ship's pod_T / pod_s (pod_dump.json) and
 *              D = (-0.02, 0.025, -0.0141). A uniform scale and a shift: { s, t: T + s D }.
 *     console  a uniform scale and a shift too (one console_tilt for the fleet, sized per opening), solved from the
 *              SCREENS' box - the one part of the console no ship clipped - and checked against the whole console box on
 *              the four unclipped ships.
 * Re-run it whenever a ship's seat or console placement changes in the game.
 */
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const SHIPS = ['blaster', 'puncture', 'pyro', 'slayer', 'syphon', 'tracker', 'vortex'];
const SRC_SHIP = 'blaster';                       // an unclipped console (19,866 + 134 tris)
const D = [-0.02, 0.025, -0.0141];                // lab -> pod offset (v50.71 profile fit, cockpit4_swap2.mjs)
const POD = JSON.parse(fs.readFileSync(path.join(REPO, 'backups/concept_ships/canopy/scripts/data/pod_dump.json'), 'utf8')).ships;
const OUT_GLB = path.join(REPO, 'LSS/ships/edit/console1_lab.glb'), OUT_JSON = path.join(REPO, 'LSS/ships/edit/fit_parts.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const mul = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const r6 = (v) => +v.toFixed(6);
// seat placement, glTF frame: Blender (x, y, z) -> glTF (x, z, -y)
const seatOf = (ship) => { const p = POD[ship], T = [p.pod_T[0], p.pod_T[2], -p.pod_T[1]], s = p.pod_s; return { s, t: T.map((v, k) => v + s * D[k]) }; };
// a primitive's attributes in SHIP space (dequantised through the node's world matrix)
function shipArrays(node, prim) {
  const m = node.getWorldMatrix(), P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
  const n = P.getCount(), pos = new Float32Array(n * 3), e = [0, 0, 0];
  // normals: the inverse-transpose of a uniform-scale + shift matrix is the rotation part, i.e. none here - just normalise
  const nrm = N ? new Float32Array(n * 3) : null, uv = T ? new Float32Array(n * 2) : null, t2 = [0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e); pos.set(mul(m, e), i * 3);
    if (N) { N.getElement(i, e); const l = Math.hypot(e[0], e[1], e[2]) || 1; nrm.set([e[0] / l, e[1] / l, e[2] / l], i * 3); }
    if (T) { T.getElement(i, t2); uv.set(t2, i * 2); }
  }
  const rot = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  if (rot.some((v, i) => Math.abs(v - (i % 4 === 0 ? rot[0] : 0)) > 1e-7)) throw new Error(node.getName() + ': node is not a uniform scale + shift');
  return { pos, nrm, uv, idx: prim.getIndices() ? Uint32Array.from(prim.getIndices().getArray()) : null, n };
}
function box(pos) {
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  return { lo, hi, ext: hi.map((v, k) => v - lo[k]), c: hi.map((v, k) => (v + lo[k]) / 2) };
}
const consoleParts = (doc, ship) => {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === ship + '_game_console'); if (!node) throw new Error(ship + ': no console');
  const prims = node.getMesh().listPrimitives(), byMat = (nm) => prims.find((p) => p.getMaterial() && p.getMaterial().getName() === nm);
  return { node, body: byMat('cockpit_CP_console1'), screen: byMat('cockpit_CP_screen') };
};

// ---------------------------------------------------------------- the console model, in the seat's lab frame
const SD = await io.read(path.join(REPO, 'LSS/ships', SRC_SHIP + '.glb'));
const sc = consoleParts(SD, SRC_SHIP), bs = seatOf(SRC_SHIP);
const toLab = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = (a[i + k] - bs.t[k]) / bs.s; return o; };
const body = shipArrays(sc.node, sc.body), screen = shipArrays(sc.node, sc.screen);
body.lab = toLab(body.pos); screen.lab = toLab(screen.pos);
const labScreenBox = box(screen.lab), labBodyBox = box(body.lab);
console.log(`console (from ${SRC_SHIP}): body ${body.idx.length / 3} tris, screens ${screen.idx.length / 3} tris; lab-frame box ${labBodyBox.lo.map(r6)} .. ${labBodyBox.hi.map(r6)}`);

// ---------------------------------------------------------------- where each part starts, per ship
const fit = { v: 1, made: new Date().toISOString(), by: 'tools/fit_parts_prep.mjs',
  seat: { url: 'ships/edit/cockpit4_lab.glb', material: 'cockpit_CP_seat4', note: 'the game seat before its roof trim: edit (6) straight, reclined 8.6 deg, width x0.85' },
  console: { url: 'ships/edit/console1_lab.glb', note: 'console1_lo as the game wears it (screens = cockpit_CP_screen)' }, ships: {} };
for (const ship of SHIPS) {
  const doc = ship === SRC_SHIP ? SD : await io.read(path.join(REPO, 'LSS/ships', ship + '.glb'));
  const cp = consoleParts(doc, ship), sb = box(shipArrays(cp.node, cp.screen).pos), bb = box(shipArrays(cp.node, cp.body).pos);
  // scale = the screens' box ratio (all three axes must agree: no per-ship rotation), shift = box centres
  const ks = [0, 1, 2].map((k) => sb.ext[k] / labScreenBox.ext[k]), s = (ks[0] + ks[1] + ks[2]) / 3;
  const spread = Math.max(...ks) / Math.min(...ks) - 1;
  const t = [0, 1, 2].map((k) => sb.c[k] - s * labScreenBox.c[k]);
  // check: the whole console box this predicts vs the one shipped (clipped ships differ where the bowl cut them)
  const plo = labBodyBox.lo.map((v, k) => t[k] + s * v), phi = labBodyBox.hi.map((v, k) => t[k] + s * v);
  const off = Math.max(...[0, 1, 2].map((k) => Math.max(Math.abs(plo[k] - bb.lo[k]), Math.abs(phi[k] - bb.hi[k]))));
  // and the seat: the shipped (trimmed) seat's vertices should sit ON the placed model's surface; report the box gap
  const seat = seatOf(ship);
  fit.ships[ship] = { seat: { s: r6(seat.s), t: seat.t.map(r6) }, console: { s: r6(s), t: t.map(r6) } };
  console.log(`${ship.padEnd(9)} seat s ${seat.s.toFixed(5)} t ${seat.t.map((v) => v.toFixed(4))} | console s ${s.toFixed(5)} (axes agree to ${(spread * 100).toFixed(3)}%) t ${t.map((v) => v.toFixed(4))} | whole-console box off by ${(off * 1000).toFixed(2)} mm-units`);
}

// verify the seat placement against the shipped seats: every shipped vertex should lie within a hair of the placed model
{
  const LD = await io.read(path.join(REPO, 'LSS/ships/edit/cockpit4_lab.glb'));
  const ln = LD.getRoot().listNodes().find((n) => n.getMesh()), lp = shipArrays(ln, ln.getMesh().listPrimitives()[0]).pos;
  for (const ship of SHIPS) {
    const doc = await io.read(path.join(REPO, 'LSS/ships', ship + '.glb'));
    const node = doc.getRoot().listNodes().find((n) => n.getName() === ship + '_game_cockpit');
    const sp = shipArrays(node, node.getMesh().listPrimitives()[0]).pos, f = fit.ships[ship].seat;
    // hash the placed model's vertices on a 2 mm grid, then each shipped vertex's nearest placed vertex
    const G = 0.002, grid = new Map(), key = (x, y, z) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
    for (let i = 0; i < lp.length; i += 3) { const p = [0, 1, 2].map((k) => f.t[k] + f.s * lp[i + k]), kk = key(...p.map((v) => Math.floor(v / G))); let a = grid.get(kk); if (!a) grid.set(kk, a = []); a.push(p); }
    let near = 0, worst = 0;
    for (let i = 0; i < sp.length; i += 3) {
      const q = [sp[i], sp[i + 1], sp[i + 2]], c = q.map((v) => Math.floor(v / G)); let best = 1;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const p of grid.get(key(c[0] + a, c[1] + b, c[2] + d)) || []) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      if (best < 1e-4) near++; worst = Math.max(worst, best);
    }
    console.log(`  seat check ${ship.padEnd(9)} ${near} of ${sp.length / 3} shipped vertices on a placed vertex (<0.1 mm-units); the rest are roof-trim cuts`);
  }
}
if (DRY) { console.log('--dry: nothing written'); process.exit(0); }

// ---------------------------------------------------------------- write the console model
const d = new Document(), buf = d.createBuffer();
d.createExtension(EXTTextureWebP).setRequired(true);   // the shipped maps are WebP; without this the file is not valid glTF
const copyTex = (t) => t ? d.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType()) : null;
function copyMat(m) {
  const o = d.createMaterial(m.getName()).setBaseColorFactor(m.getBaseColorFactor()).setEmissiveFactor(m.getEmissiveFactor())
    .setMetallicFactor(m.getMetallicFactor()).setRoughnessFactor(m.getRoughnessFactor()).setDoubleSided(m.getDoubleSided()).setAlphaMode(m.getAlphaMode());
  if (m.getBaseColorTexture()) o.setBaseColorTexture(copyTex(m.getBaseColorTexture()));
  if (m.getMetallicRoughnessTexture()) o.setMetallicRoughnessTexture(copyTex(m.getMetallicRoughnessTexture()));
  if (m.getNormalTexture()) o.setNormalTexture(copyTex(m.getNormalTexture())).setNormalScale(m.getNormalScale());
  if (m.getEmissiveTexture()) o.setEmissiveTexture(copyTex(m.getEmissiveTexture()));
  return o;
}
const prim = (g, mat) => {
  const p = d.createPrimitive().setMaterial(copyMat(mat)).setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(g.lab).setBuffer(buf));
  if (g.nrm) p.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(g.nrm).setBuffer(buf));
  if (g.uv) p.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buf));
  return p.setIndices(d.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buf));
};
const mesh = d.createMesh('console1_game_console').addPrimitive(prim(body, sc.body.getMaterial())).addPrimitive(prim(screen, sc.screen.getMaterial()));
d.createScene('console1').addChild(d.createNode('console1_game_console').setMesh(mesh));
fs.writeFileSync(OUT_GLB, Buffer.from(await io.writeBinary(d)));
fs.writeFileSync(OUT_JSON, JSON.stringify(fit, null, 1) + '\n');
console.log('wrote', path.relative(REPO, OUT_GLB), (fs.statSync(OUT_GLB).size / 1048576).toFixed(2) + ' MB;', path.relative(REPO, OUT_JSON));
