#!/usr/bin/env node
/**
 * ship_fit_splice.mjs - bring a Ship Lab XR FIT-OUT export (the owner placed the seat / console by hand, edited and
 * painted the ship) into the game's source hull, assets_src/ships/<ship>.glb. Run from the REPO ROOT:
 *
 *     node tools/ship_fit_splice.mjs slayer backups/concept_ships/painted/slayer_fit.glb --dry   # report only
 *     node tools/ship_fit_splice.mjs slayer backups/concept_ships/painted/slayer_fit.glb         # write
 *       (default)       the parts EXACTLY as exported; cockpit1 = the SHIPPED eye carried with the console's screens
 *                       (see THE EYE below) - owner, 2026-10-03: "just move the C1 position, you don't have to adjust
 *                       anything else"
 *       --eye lab       use the eye as the lab exported it (it rides the seat there) instead
 *       --trim          also cut the seat / console along the roof + belly, 2 mm inside (the v50.72 clean trim); the dry
 *                       run always REPORTS how much of each pokes out, so the choice can be made on numbers
 *       --straighten    take the yaw and roll out of a seat whose LOCK was off (keeps its pitch and its place)
 *
 * THE EYE. The first-person camera is not cockpit1: _lssCockpitFrameSolve moves it forward / up from cockpit1 until the
 * console's centre screen frames the compass rose - but only within bounds measured FROM cockpit1 (-0.25..+0.6 x the
 * eye -> screen distance forward, -0.5..+0.35 up) and only along a path the clearance rays find free. The lab's eye RIDES
 * the seat, so a reclined / slid seat carried it away from the console: on Blaster at FOV 61 the solve would have had to
 * back it ~3.6 game units against a ~2.4 bound - pinned, the console NOT lined up. So cockpit1 keeps its shipped place
 * RELATIVE TO THE SCREENS: the rigid move that takes the shipped screens onto the exported ones (Kabsch over the
 * screens' vertices; identity when the console did not move) is applied to the shipped cockpit1, and z = 0 (the solve
 * moves only forward / up, so an eye off the centre line could never centre the middle screen). Same relation to the
 * console = the same solved eye = the same first-person view as before, at every FOV. VR puts the head ON cockpit1, so
 * it keeps its place against the console too.
 *
 * then   node tools/compress_glb.mjs --only <ship>   and bump _MODELS_VERSION.
 *
 * (2026-10-03) Owner: "7 ships in there, can you check them out, make sure they will work... i adjusted seat and console
 * positions... and painted them all". ship_edit_splice.mjs only REPLACES parts it can match by name + material; a
 * fit-out export also ADDS (a seat or console placed from the lab's ADD page, named <ship>_game_cockpit_2,
 * <ship>_game_console_3_1 ...), HIDES (the game's old seat / console, swapped out) and LEAVES OUT (FIT-OUT mode loads
 * the hull without seat / console / hood / arm panels). So this reads the export as WHAT THE SHIP IS NOW:
 *   - every exported part goes in. A part the lab marked as the SEAT / CONSOLE asset (extras.lab) replaces the game's
 *     seat / console primitives (same node, same material - the fleet texture share and every game lookup key on the
 *     material names); a ship part replaces the source primitive of the same base name + material; anything else
 *     (a SPLIT piece, a shape, a GLB) becomes a new node under the hull with the source's material of that name.
 *   - a part the export does NOT carry (hidden in the lab, or left out in FIT-OUT) is REMOVED - with one exception: a
 *     source node compress_glb JOINED into a part that came back unchanged (the console pedestal inside the hood) stays.
 *   - an exported part identical to the shipped one (micron tolerance, vertex for vertex) keeps its float32 source data.
 *   - paint: every __paint__ layer, in file order, over the full-resolution source map (a re-opened export carries its
 *     first session's layers too - ship_edit_splice kept only the last one per material). One painted texture per
 *     material, own-named for cockpit_CP_* (or the fleet share would fold it into the unpainted copy).
 *   - markers: as exported (the lab's eye rides the seat), cockpit1 on z = 0 (see --keep-eye-z), and markers.json.
 * The source is backed up first (backups/concept_ships/pre_fit/) and everything not meant to change is verified identical.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [ship, editArg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--eye');
if (!ship || !editArg) { console.error('usage: node tools/ship_fit_splice.mjs <ship> <export.glb> [--dry] [--trim] [--eye lab] [--straighten]'); process.exit(1); }
const DRY = flags.has('--dry'), TRIM = flags.has('--trim'), STRAIGHTEN = flags.has('--straighten');
const EYE_ARG = argv.includes('--eye') ? argv[argv.indexOf('--eye') + 1] : null;
const EYE_LAB = EYE_ARG === 'lab';
// --eye x,y,z: cockpit1 exactly there (ship space) - for a ship whose console now sits where the old relation would
// put the eye inside the seat
const EYE_XYZ = EYE_ARG && /^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(EYE_ARG) ? EYE_ARG.split(',').map(Number) : null;
const SRC = path.join(REPO, 'assets_src/ships', ship + '.glb'), SHIPPED = path.join(REPO, 'LSS/ships', ship + '.glb');
const MARKERS_JSON = path.join(REPO, 'backups/concept_ships/canopy/markers.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const S = await io.read(SRC), Q = await io.read(SHIPPED), E = await io.read(path.resolve(REPO, editArg));

// ---------------------------------------------------------------- small math (column-major 4x4)
const mul = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
function inv(a) {
  const o = new Array(16);
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
const normalMat = (m) => { const i = inv(m); return [i[0], i[4], i[8], 0, i[1], i[5], i[9], 0, i[2], i[6], i[10], 0, 0, 0, 0, 1]; };
const mm = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const h = (a) => crypto.createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 12);
const f4 = (a) => a.map((v) => (+v).toFixed(4)).join(', ');

// ---------------------------------------------------------------- parts
const parts = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh()).flatMap((n) => n.getMesh().listPrimitives().map((p, i) => ({ node: n, prim: p, i, name: n.getName(), mat: p.getMaterial() ? p.getMaterial().getName() : '' })));
function geom(node, prim, M) {   // ship-space positions + normals (+ uv, idx); M overrides the node's world matrix
  const m = M || node.getWorldMatrix(), nm = normalMat(m), P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
  const n = P.getCount(), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), e = [0, 0, 0], t = [0, 0], uv = T ? new Float32Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    P.getElement(i, e); pos.set(mul(m, e, 1), i * 3);
    if (N) { N.getElement(i, e); const v = mul(nm, e, 0), l = Math.hypot(v[0], v[1], v[2]) || 1; nrm.set([v[0] / l, v[1] / l, v[2] / l], i * 3); }
    if (T) { T.getElement(i, t); uv[i * 2] = t[0]; uv[i * 2 + 1] = t[1]; }
  }
  return { pos, nrm, uv, idx: prim.getIndices() ? Uint32Array.from(prim.getIndices().getArray()) : Uint32Array.from({ length: n }, (_, i) => i), n };
}
// the same part, the same triangles? Vertex order is kept by the lab, so compare index arrays and positions with a
// micron tolerance (rounded keys once invented "changes" at a wingtip - lss.map.md, the v50.66 splice)
// ⚠ the lab's three-mesh-bvh computeBoundsTree() REORDERS the index buffer in place, so triangles are compared as a SET
// (each rotated to start at its smallest index - winding kept); vertices keep their order and are compared one to one
function sameGeom(a, b) {
  if (a.n !== b.n || a.idx.length !== b.idx.length) return { same: false, why: `${b.idx.length / 3} -> ${a.idx.length / 3} tris` };
  const tri = (I) => { const out = new Array(I.length / 3); for (let f = 0; f < I.length; f += 3) { let x = I[f], y = I[f + 1], z = I[f + 2]; while (x > y || x > z) { const t = x; x = y; y = z; z = t; } out[f / 3] = x + '_' + y + '_' + z; } return out.sort(); };
  const ta = tri(a.idx), tb = tri(b.idx);
  for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return { same: false, why: 'triangles re-made' };
  let mx = 0; for (let i = 0; i < a.pos.length; i++) mx = Math.max(mx, Math.abs(a.pos[i] - b.pos[i]));
  return mx < 2e-5 ? { same: true } : { same: false, why: `moved, max ${(mx * 1000).toFixed(2)} mm-units` };
}
const baseNames = (n) => { const out = [n]; let m; while ((m = n.match(/^(.*)_\d+$/))) { n = m[1]; out.push(n); } return out; };

// ---------------------------------------------------------------- the export as the ship now
const eRoot = E.getRoot().listNodes().find((n) => n.getExtras() && n.getExtras().lab && n.getExtras().lab.ship !== undefined);
const lab = (eRoot && eRoot.getExtras().lab) || { removed: [], hidden: [] };
const sp = parts(S), qp = parts(Q), ep = parts(E).filter((e) => !e.name.startsWith('__paint__'));
const hullNode = S.getRoot().listNodes().find((n) => n.getName() === ship + '_game_hull');
const notes = [], plan = [];
const roleOf = (e) => { const x = e.node.getExtras() && e.node.getExtras().lab; return x ? x : null; };
const used = new Map();   // source part -> export part
for (const e of ep) {
  const r = roleOf(e);
  let s = null;
  if (r && r.kind === 'asset' && r.asset === 'seat') s = sp.find((x) => x.mat === 'cockpit_CP_seat4' && x.name === ship + '_game_cockpit');
  else if (r && r.kind === 'asset' && r.asset === 'console') s = sp.find((x) => x.mat === e.mat && x.name === ship + '_game_console');
  else if (!r || r.kind === 'ship') for (const b of baseNames(e.name)) { s = sp.find((x) => x.mat === e.mat && x.name === b); if (s) break; }
  if (s && used.has(s)) { notes.push(`${e.name} and ${used.get(s).name} both map to ${s.name}#${s.i} - the second one becomes a new node`); s = null; }
  if (s) used.set(s, e);
  plan.push({ e, s, role: r });
}
// the shipped part a source part became (to tell an untouched part from an edited one)
const shippedOf = (s) => qp.find((q) => q.mat === s.mat && q.name === s.name);

// ---------------------------------------------------------------- geometry per exported part (ship space)
const seatPlan = plan.find((p) => p.role && p.role.asset === 'seat');
if (STRAIGHTEN && seatPlan) {
  // take the yaw + roll out of the seat's node rotation, about the seat's own box centre (pitch and place kept)
  const n = seatPlan.e.node, r = n.getRotation(), [x, y, z, w] = r;
  const pitch = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const g0 = geom(n, seatPlan.e.prim); let c = [0, 0, 0]; const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let i = 0; i < g0.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g0.pos[i + k]); hi[k] = Math.max(hi[k], g0.pos[i + k]); }
  c = lo.map((v, k) => (v + hi[k]) / 2);
  const M0 = n.getMatrix(), Mi = inv(M0), cl = mul(Mi, c, 1);   // the box centre in the seat's local frame
  const q2 = [0, 0, Math.sin(pitch / 2), Math.cos(pitch / 2)], s = n.getScale();
  n.setRotation(q2);
  const M1 = n.getMatrix(), c1 = mul(M1, cl, 1);
  n.setTranslation(n.getTranslation().map((v, k) => v + c[k] - c1[k]));
  notes.push(`seat straightened: rotation ${f4(r)} -> pitch only ${(pitch * 180 / Math.PI).toFixed(2)} deg about its box centre (scale ${s[0].toFixed(4)})`);
}
for (const p of plan) {
  p.eg = geom(p.e.node, p.e.prim);
  if (p.s) {
    const q = shippedOf(p.s);
    p.cmp = q ? sameGeom(p.eg, geom(q.node, q.prim)) : { same: false, why: 'not in the shipped file' };
    // the asset seat / console can never be "the same" as what shipped: they are new parts in the old one's place
    p.write = !p.cmp.same;
  } else p.write = true;
}

// ---------------------------------------------------------------- the clean trim (the v50.72 rule, cockpit4_swap2.mjs)
function heightFields(box) {
  const cell = 0.0015, top = new Map(), bot = new Map(), ix = (v) => Math.floor(v / cell), key = (i, j) => i * 100003 + j;
  for (const p of plan) {
    const isHull = /_hull_game$/.test(p.e.mat), isRoof = isHull || p.e.mat === 'canopy_glass' || p.e.mat === 'canopy_frame';
    if (!isRoof) continue;
    const g = p.eg, P = g.pos, I = g.idx;
    for (let f = 0; f < I.length; f += 3) {
      const t = [0, 1, 2].map((k) => [P[I[f + k] * 3], P[I[f + k] * 3 + 1], P[I[f + k] * 3 + 2]]), xs = t.map((q) => q[0]), zs = t.map((q) => q[2]);
      if (Math.max(...xs) < box[0] || Math.min(...xs) > box[1] || Math.max(...zs) < box[2] || Math.min(...zs) > box[3]) continue;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)), nn = Math.max(1, Math.ceil(span / (cell * 0.6)));
      for (let a = 0; a <= nn; a++) for (let b = 0; a + b <= nn; b++) {
        const u = a / nn, v = b / nn, w = 1 - u - v, q = [0, 1, 2].map((j) => t[0][j] * w + t[1][j] * u + t[2][j] * v), k = key(ix(q[0]), ix(q[2]));
        const ct = top.get(k); if (ct === undefined || q[1] > ct) top.set(k, q[1]);
        if (isHull) { const cb = bot.get(k); if (cb === undefined || q[1] < cb) bot.set(k, q[1]); }
      }
    }
  }
  const near = (M, x, z, pick) => { const i0 = ix(x), j0 = ix(z); let r; for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const v = M.get(key(i, j)); if (v === undefined) return undefined; r = r === undefined ? v : pick(r, v); } return r; };
  return { roof: (x, z) => near(top, x, z, Math.min), floor: (x, z) => near(bot, x, z, Math.max) };
}
const MARGIN = 0.002;
function trimToHull(g, F) {
  const P = [], N = [], U = [], I = [];
  const push = (v) => { P.push(v.p[0], v.p[1], v.p[2]); N.push(v.n[0], v.n[1], v.n[2]); if (g.uv) U.push(v.u[0], v.u[1]); return P.length / 3 - 1; };
  const vert = (i) => ({ p: [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]], n: [g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]], u: g.uv ? [g.uv[i * 2], g.uv[i * 2 + 1]] : [0, 0] });
  const lerp = (a, b, t) => ({ p: a.p.map((v, j) => v + (b.p[j] - v) * t), n: a.n.map((v, j) => v + (b.n[j] - v) * t), u: a.u.map((v, j) => v + (b.u[j] - v) * t) });
  const above = (v) => { const r = F.roof(v.p[0], v.p[2]); return r === undefined ? 1 : v.p[1] - (r - MARGIN); };
  const below = (v) => { const f = F.floor(v.p[0], v.p[2]); return f === undefined ? 1 : (f + MARGIN) - v.p[1]; };
  const out = (v) => Math.max(above(v), below(v));
  const clip = (poly, sd) => { const o = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], sa = sd(a), sb = sd(b);
    if (sa <= 0) o.push(a); if ((sa <= 0) !== (sb <= 0)) o.push(lerp(a, b, sa / (sa - sb))); } return o; };
  let cut = 0, gone = 0, split = 0, kept = 0;
  const emit = (poly) => { if (poly.length < 3) { gone++; return; } const ids = poly.map(push); for (let k = 1; k + 1 < ids.length; k++) I.push(ids[0], ids[k], ids[k + 1]); };
  const edge = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  function tri(a, b, c, depth) {
    const m1 = lerp(a, b, 0.5), m2 = lerp(b, c, 0.5), m3 = lerp(c, a, 0.5), cc = lerp(m1, c, 1 / 3);
    const sv = [a, b, c, m1, m2, m3, cc].map(out);
    if (sv.every((v) => v <= 0)) { kept++; emit([a, b, c]); return; }
    if (sv.every((v) => v > 0)) { gone++; return; }
    if (depth < 5 && Math.max(edge(a, b), edge(b, c), edge(c, a)) > 0.006) { split++; tri(a, m1, m3, depth + 1); tri(m1, b, m2, depth + 1); tri(m3, m2, c, depth + 1); tri(m1, m2, m3, depth + 1); return; }
    cut++; emit(clip(clip([a, b, c], above), below));
  }
  for (let f = 0; f < g.idx.length; f += 3) tri(vert(g.idx[f]), vert(g.idx[f + 1]), vert(g.idx[f + 2]), 0);
  // a part wholly inside comes back untouched (same arrays, same vertex order)
  if (!cut && !gone && !split) return { g, cut, gone, split, changed: false };
  const ng = { pos: Float32Array.from(P), nrm: Float32Array.from(N), uv: g.uv ? Float32Array.from(U) : null, idx: Uint32Array.from(I), n: P.length / 3 };
  return { g: ng, cut, gone, split, changed: true };
}
// measured always (how much of the seat / console is outside the ship's shell), applied only with --trim
const trims = [];
for (const p of plan) {
  const isSeat = p.e.mat === 'cockpit_CP_seat4', isCon = /^cockpit_CP_(console|screen)/.test(p.e.mat);
  if (!(isSeat || isCon) || !p.write) continue;
  const P = p.eg.pos; let bx0 = 9, bx1 = -9, bz0 = 9, bz1 = -9;
  for (let i = 0; i < P.length; i += 3) { bx0 = Math.min(bx0, P[i]); bx1 = Math.max(bx1, P[i]); bz0 = Math.min(bz0, P[i + 2]); bz1 = Math.max(bz1, P[i + 2]); }
  const T = trimToHull(p.eg, heightFields([bx0 - 0.02, bx1 + 0.02, bz0 - 0.02, bz1 + 0.02]));
  trims.push({ name: p.e.name, before: p.eg.idx.length / 3, after: T.g.idx.length / 3, cut: T.cut, gone: T.gone, split: T.split, changed: T.changed, applied: TRIM && T.changed });
  if (TRIM && T.changed) p.eg = T.g;
}

// ---------------------------------------------------------------- removals: what the export does not carry
const keepJoined = new Set();
for (const p of plan) if (p.s && !p.write) {   // an unchanged part: the source nodes compress_glb joined into it stay
  for (const x of sp) if (x !== p.s && x.mat === p.s.mat && x.node.getParentNode() === p.s.node.getParentNode() && !qp.some((q) => q.name === x.name && q.mat === x.mat)) keepJoined.add(x);
}
const removals = sp.filter((x) => !used.has(x) && !keepJoined.has(x));

// ---------------------------------------------------------------- paint layers (every one, in file order)
const paints = [];
for (const n of E.getRoot().listNodes().filter((x) => x.getName().startsWith('__paint__') && x.getMesh())) {
  const mt = n.getMesh().listPrimitives()[0].getMaterial(), t = mt && mt.getBaseColorTexture(); if (!t) continue;
  const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let painted = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
  const mat = mt.getName().replace(/^__paint__/, '');
  if (painted) paints.push({ node: n.getName(), mat, png: Buffer.from(t.getImage()), painted, w: info.width, h: info.height });
}

// ---------------------------------------------------------------- markers
const markersOf = (doc) => Object.fromEntries(doc.getRoot().listNodes().filter((n) => !n.getMesh() && /^(gun|thruster|cockpit)\d+$/.test(n.getName())).map((n) => [n.getName(), n.getWorldMatrix().slice(12, 15)]));
const em = markersOf(E), qm = markersOf(Q), sm = markersOf(S), moves = [];
// THE EYE (see the header): the shipped cockpit1 carried by the rigid move shipped screens -> exported screens
function screensOf(list, doc) {   // ship-space vertices of the cockpit_CP_screen primitive(s), in file order
  const out = [];
  for (const x of list) if (x.mat === 'cockpit_CP_screen') { const g = geom(x.node, x.prim); for (let i = 0; i < g.pos.length; i += 3) out.push([g.pos[i], g.pos[i + 1], g.pos[i + 2]]); }
  void doc; return out;
}
function kabsch(A, B) {   // best rigid R, t with R A + t ~ B (Horn's quaternion method), + the rms residual
  const n = A.length, ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += A[i][k] / n; cb[k] += B[i][k] / n; }
  const Sm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Sm[r][c] += (A[i][r] - ca[r]) * (B[i][c] - cb[c]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = Sm;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  let q = [1, 0, 0, 0];   // the dominant eigenvector by power iteration on N + 4|N| I
  const sh = 4 * Math.max(...N.flat().map(Math.abs)) + 1e-12;
  for (let it = 0; it < 200; it++) { const q2 = [0, 1, 2, 3].map((r) => N[r].reduce((a, v, c) => a + v * q[c], 0) + sh * q[r]); const l = Math.hypot(...q2); q = q2.map((v) => v / l); }
  const [w, x, y, z] = q;
  const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
  const ap = (p) => [0, 1, 2].map((r) => R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]);
  const Rca = ap(ca), t = [0, 1, 2].map((k) => cb[k] - Rca[k]);
  let e = 0; for (let i = 0; i < n; i++) { const p = ap(A[i]); e += (p[0] + t[0] - B[i][0]) ** 2 + (p[1] + t[1] - B[i][1]) ** 2 + (p[2] + t[2] - B[i][2]) ** 2; }
  return { apply: (p) => { const v = ap(p); return [v[0] + t[0], v[1] + t[1], v[2] + t[2]]; }, rms: Math.sqrt(e / n), deg: 2 * Math.acos(Math.min(1, Math.abs(w))) * 180 / Math.PI, t };
}
const labEye = em.cockpit1 ? em.cockpit1.slice() : null, shippedEye = qm.cockpit1 || sm.cockpit1;
let eyeWhy = 'as the lab exported it (--eye lab)';
if (EYE_XYZ) { em.cockpit1 = EYE_XYZ.slice(); eyeWhy = 'placed by hand (--eye x,y,z)'; }
else if (!EYE_LAB && shippedEye) {
  const A = screensOf(qp, Q), B = screensOf(ep, E);
  if (A.length && A.length === B.length) {
    const K = kabsch(A, B);
    if (K.rms < 2e-4) { em.cockpit1 = K.apply(shippedEye); eyeWhy = `the shipped eye carried with the screens (moved ${(Math.hypot(...K.t) * 1000).toFixed(1)} mm-units, turned ${K.deg.toFixed(2)} deg, fit rms ${(K.rms * 1e6).toFixed(1)} um)`; }
    else { const ca = A.reduce((s, p) => s.map((v, k) => v + p[k] / A.length), [0, 0, 0]), cb = B.reduce((s, p) => s.map((v, k) => v + p[k] / B.length), [0, 0, 0]); em.cockpit1 = shippedEye.map((v, k) => v + cb[k] - ca[k]); eyeWhy = `the shipped eye + the screens' centroid shift (their shapes differ: rms ${(K.rms * 1000).toFixed(2)} mm-units)`; }
  } else if (B.length) {
    const ca = A.reduce((s, p) => s.map((v, k) => v + p[k] / Math.max(1, A.length)), [0, 0, 0]), cb = B.reduce((s, p) => s.map((v, k) => v + p[k] / B.length), [0, 0, 0]);
    em.cockpit1 = shippedEye.map((v, k) => v + cb[k] - ca[k]); eyeWhy = `the shipped eye + the screens' centroid shift (${A.length} vs ${B.length} screen vertices)`;
  } else eyeWhy = 'as the lab exported it (no screens in the export)';
}
if (em.cockpit1) em.cockpit1 = [em.cockpit1[0], em.cockpit1[1], 0];   // the centre line: the solve never moves it sideways
notes.push(`cockpit1 = ${eyeWhy}: lab ${labEye ? f4(labEye) : '-'} | shipped ${shippedEye ? f4(shippedEye) : '-'} -> ${em.cockpit1 ? f4(em.cockpit1) : '-'}`);
for (const k of Object.keys(em)) { const ref = sm[k] || qm[k]; if (!ref || Math.hypot(em[k][0] - ref[0], em[k][1] - ref[1], em[k][2] - ref[2]) > 1e-5) moves.push({ name: k, from: ref || null, to: em[k] }); }
const lost = Object.keys(sm).filter((k) => !em[k]);

// ---------------------------------------------------------------- report
console.log(`${ship} <- ${path.basename(editArg)} (lab: ${lab.fit ? 'FIT-OUT' : 'as in game'}${lab.hidden && lab.hidden.length ? ', hidden ' + lab.hidden.join(' ') : ''}${lab.removed && lab.removed.length ? ', left out ' + lab.removed.join(' ') : ''})`);
for (const p of plan) {
  const tgt = p.s ? `${p.s.name}#${p.s.i}` : 'NEW node';
  console.log(`  ${p.e.name.padEnd(32)} [${p.e.mat}] -> ${tgt.padEnd(30)} ${p.s ? (p.write ? 'WRITE (' + p.cmp.why + ')' : 'unchanged - source kept') : 'add'}`);
}
for (const x of removals) console.log(`  REMOVE ${x.name}#${x.i} [${x.mat}] ${x.prim.getIndices() ? x.prim.getIndices().getCount() / 3 : 0} tris`);
for (const x of keepJoined) console.log(`  keep   ${x.name}#${x.i} [${x.mat}] (joined into an unchanged part when shipped)`);
for (const t of trims) console.log(`  shell  ${t.name}: ${t.changed ? `${t.gone} tris wholly outside the roof / belly, ${t.cut} crossing it` + (t.applied ? ` - TRIMMED ${t.before} -> ${t.after}` : ' (left as exported; --trim cuts them)') : 'wholly inside the ship'}`);
const pmap = new Map(); for (const p of paints) { const a = pmap.get(p.mat) || []; a.push(p); pmap.set(p.mat, a); }
for (const [m, a] of pmap) console.log(`  paint  ${m}: ${a.length} layer(s) - ${a.map((p) => p.painted + ' texels of ' + p.w + 'x' + p.h + ' (' + p.node + ')').join(', ')}`);
for (const m of moves) console.log(`  marker ${m.name}: ${m.from ? f4(m.from) : '(new)'} -> ${f4(m.to)}`);
for (const k of lost) console.log(`  marker ${k}: NOT in the export - kept as it is`);
for (const n of notes) console.log('  note: ' + n);
if (DRY) { console.log('(dry run - nothing written)'); process.exit(0); }

// ---------------------------------------------------------------- apply
const buf = S.getRoot().listBuffers()[0], skip = new Set();
const disposeIfOrphan = (a) => { if (a && a.listParents().every((x) => x.propertyType === 'Root')) a.dispose(); };
function setPrim(prim, g, worldOfNode) {
  const si = inv(worldOfNode), sn = normalMat(si), n = g.n, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(mul(si, [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]], 1), i * 3);
    const v = mul(sn, [g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]], 0), l = Math.hypot(v[0], v[1], v[2]) || 1; nrm.set([v[0] / l, v[1] / l, v[2] / l], i * 3);
  }
  const old = [...prim.listSemantics().map((k) => prim.getAttribute(k)), prim.getIndices()].filter(Boolean);
  for (const k of prim.listSemantics()) prim.setAttribute(k, null);
  prim.setAttribute('POSITION', S.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf));
  prim.setAttribute('NORMAL', S.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf));
  if (g.uv) prim.setAttribute('TEXCOORD_0', S.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buf));
  prim.setIndices(S.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buf));
  for (const a of old) disposeIfOrphan(a);
}
for (const p of plan) {
  if (p.s && p.write) { setPrim(p.s.prim, p.eg, p.s.node.getWorldMatrix()); skip.add(p.s.name + '#' + p.s.i); }
  else if (!p.s) {
    const mat = S.getRoot().listMaterials().find((m) => m.getName() === p.e.mat);
    if (!mat) { console.log(`  ${p.e.name}: no source material "${p.e.mat}" - skipped`); continue; }
    const prim = S.createPrimitive().setMaterial(mat), node = S.createNode(p.e.name).setMesh(S.createMesh(p.e.name).addPrimitive(prim));
    (hullNode || S.getRoot().listScenes()[0]).addChild(node);
    setPrim(prim, p.eg, node.getWorldMatrix());
    console.log(`  added node ${p.e.name} (${p.eg.idx.length / 3} tris, ${p.e.mat})`);
  }
}
for (const x of removals) {
  skip.add(x.name + '#' + x.i);
  const mesh = x.node.getMesh(); if (!mesh) continue;
  mesh.removePrimitive(x.prim);
  for (const a of [...x.prim.listSemantics().map((k) => x.prim.getAttribute(k)), x.prim.getIndices()].filter(Boolean)) disposeIfOrphan(a);
  if (!mesh.listPrimitives().length) { x.node.setMesh(null); mesh.dispose(); }
}
// paint: per material, stack the layers over the source map (at the source's resolution), encode once
for (const [m, layers] of pmap) {
  const mat = S.getRoot().listMaterials().find((x) => x.getName() === m), tex = mat && mat.getBaseColorTexture();
  if (!tex) { console.log(`  paint on ${m}: no colour map in the source - skipped`); continue; }
  const meta = await sharp(Buffer.from(tex.getImage())).metadata();
  let img = await sharp(Buffer.from(tex.getImage())).ensureAlpha().png().toBuffer();
  for (const L of layers) {
    const layer = await sharp(L.png).resize(meta.width, meta.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    img = await sharp(img).composite([{ input: layer, blend: 'over' }]).png().toBuffer();
  }
  const out = await sharp(img).removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  const own = tex.listParents().filter((x) => x.propertyType === 'Material').length > 1 || /^cockpit_CP_/.test(m);
  const t2 = own ? S.createTexture(tex.getName() + '_' + ship + '_paint') : tex;
  t2.setImage(new Uint8Array(out)).setMimeType('image/jpeg');
  if (own) mat.setBaseColorTexture(t2);
  skip.add('tex:' + tex.getName()); skip.add('mat:' + m);
  console.log(`  paint laid on ${m}: ${layers.length} layer(s), ${meta.width}x${meta.height} -> ${(out.length / 1048576).toFixed(1)} MB JPEG${own ? ' as ' + t2.getName() : ''}`);
}
if (moves.length) {
  const mj = JSON.parse(fs.readFileSync(MARKERS_JSON, 'utf8'));
  for (const m of moves) {
    let n = S.getRoot().listNodes().find((x) => x.getName() === m.name && !x.getMesh());
    if (!n) { n = S.createNode(m.name); (hullNode || S.getRoot().listScenes()[0]).addChild(n); console.log(`  marker ${m.name}: added`); }
    const par = n.getParentNode(), pm = par ? inv(par.getWorldMatrix()) : null;
    n.setTranslation(pm ? mul(pm, m.to, 1) : m.to); skip.add('node:' + m.name);
    if (mj[ship]) mj[ship][m.name] = [m.to[0], -m.to[2], m.to[1]].map((v) => +v.toFixed(5));
  }
  fs.writeFileSync(MARKERS_JSON, JSON.stringify(mj, null, 1));
}
// drop textures / materials nothing uses any more (a replaced seat map, a removed hood's material)
for (const t of S.getRoot().listTextures()) if (t.listParents().every((x) => x.propertyType === 'Root')) { skip.add('tex:' + t.getName()); t.dispose(); }

// ---------------------------------------------------------------- back up, write, verify everything else is identical
function fingerprint(doc) {
  const f = {}, seen = {};
  for (const n of doc.getRoot().listNodes()) {
    if (n.getMesh()) n.getMesh().listPrimitives().forEach((p, i) => {
      const k = n.getName() + '#' + i; if (skip.has(k)) return;
      f['prim:' + k] = p.listSemantics().sort().map((s) => s + '=' + h(p.getAttribute(s).getArray())).join(' ') + (p.getIndices() ? ' I=' + h(p.getIndices().getArray()) : '') + ' M=' + (p.getMaterial() ? p.getMaterial().getName() : '');
    });
    if (!skip.has('node:' + n.getName()) && !n.getMesh()) f['node:' + n.getName()] = JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]);
  }
  for (const t of doc.getRoot().listTextures()) { if (skip.has('tex:' + t.getName())) continue; seen[t.getName()] = (seen[t.getName()] || 0) + 1; f['tex:' + t.getName() + '#' + seen[t.getName()]] = h(t.getImage()); }
  return f;
}
const before = fingerprint(await io.read(SRC));
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
const bak = path.join(REPO, 'backups/concept_ships/pre_fit', `${ship}_${stamp}.glb`);
fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(SRC, bak);
const tmp = SRC + '.fit.tmp'; fs.writeFileSync(tmp, Buffer.from(await io.writeBinary(S)));
const after = fingerprint(await io.read(tmp));
const diff = Object.keys(before).filter((k) => before[k] !== after[k] && !removals.some((x) => k === 'prim:' + x.name + '#' + x.i));
if (diff.length) { fs.unlinkSync(tmp); console.error('VERIFY FAILED - source untouched:', diff.slice(0, 12)); process.exit(2); }
fs.renameSync(tmp, SRC);
console.log(`wrote ${path.relative(REPO, SRC)} (${Object.keys(after).length} untouched properties verified identical); backup ${path.relative(REPO, bak)}`);
