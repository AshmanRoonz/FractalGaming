#!/usr/bin/env node
/**
 * AUTO CLOAK x THE SEATED BODIES, OFFLINE (2026-10-08, v52.97). Runs the game's REAL _setShipMeshOpacity,
 * _navLightSeatDim and _lssSeatFrame - sliced out of LSS/index-working.html - against a tiny fake scene graph:
 * your ship (a hull material + Xorzo's one material on the running light + the cockpit anchor), your pilot's body
 * (a SCENE child, as in the game), and a Summoners flagship with its own body. No Browser pane, no GPU.
 *
 *   node tools/cloak_seat_sim.mjs [LSS/index-working.html]
 *
 * Owner (v52.97): "during auto cloak, the pilot glb and xorzo glb need to cloak as well". Checks that, through a
 * cloak and an uncloak, in the chase view and the seat view: the pilot is hidden only while HIS ship is cloaked,
 * Xorzo stays at the cloak's opacity every frame (the nav-light dimmer used to put him back to opaque on frame 2),
 * `transparent` flips once each way (not every frame), and the seat view's 16 % dim comes back after the uncloak.
 * Pass an older source (a backup) to watch the same checks fail. Exits 1 if a check fails.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(ROOT, 'LSS', 'index-working.html');
const html = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => {
  const a = html.indexOf(from); const b = a < 0 ? -1 : html.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + JSON.stringify(a < 0 ? from : to));
  return html.slice(a, b + to.length);
};
const src = [
  cut('function _setShipMeshOpacity(root, opacity) {', '\n}\n'),
  cut('function _navLightSeatDim(mesh, on) {', '\n}\n'),
  cut('function _lssSeatFrame() {', '\n}\n'),
].join('\n');

// ---- a scene graph just big enough for the three slices ---------------------------------------------------------
class Col { constructor(h) { this.h = h; this.k = 1; } getHex() { return this.h; } setHex(h) { this.h = h; this.k = 1; return this; } multiplyScalar(k) { this.k *= k; return this; } }
class Mat {
  constructor(name, op = 1, tr = false) { this.name = name; this.opacity = op; this.transparent = tr; this.depthWrite = true; this.color = new Col(0xffffff); this.userData = {}; this.version = 0; this.emissiveIntensity = 1; }
  set needsUpdate(v) { if (v) this.version++; }
}
class Obj {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.userData = {}; this.visible = true; this.material = null; }
  add(c) { c.parent = this; this.children.push(c); return c; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}
const scene = new Obj('scene');
function makeShip(name) {
  const ship = scene.add(new Obj(name));
  const hull = ship.add(new Obj(name + '_hull')); hull.material = new Mat(name + '_hullMat');
  const lg = ship.add(new Obj(name + '_runningLight'));
  const xz = lg.add(new Obj(name + '_xorzo')); xz.material = new Mat(name + '_xorzoMat'); xz.material.userData._xorzo = true;
  ship.userData.runningLightPortMat = ship.userData.runningLightStarMat = xz.material;
  const anchor = ship.add(new Obj(name + '_cockpitParent'));
  const body = scene.add(new Obj(name + '_body'));          // the seated body: a scene child, NOT under the ship
  return { ship, hull: hull.material, xorzo: xz.material, anchor, body };
}
const P = makeShip('player'), S = makeShip('summoners');
const rec = (who, X) => { const r = { who, hull: 'h', ship: X.ship, anchor: X.anchor, body: X.body, mixer: { update() {} }, gone: 0, shown: true }; X.ship.userData.lssSeat = r; return r; };
const recs = [rec('pilot', P), rec('summoners', S)];
let seatView = false;
const env = {
  scene, performance: { now: () => 1000 }, window: { __cockpit: {} }, XORZO: { glow: 2 },
  player: { mesh: P.ship, loadoutKey: 'h' }, game: { entities: [] }, NEMESIS_SHIP: 'summoners_ship', _RPL: null,
  _lssSeatRecs: recs, _lssSeatKnob: (k, d) => d, _lssSeatEnsure() {}, _lssSeatDrop() {}, _lssSeatPlace() {},
  _seatViewLive: () => seatView,
};
const names = Object.keys(env);
const api = new Function(...names, 'let _lssSeatT0 = 0, _lssSeatScanN = 0;\n' + src +
  '\nreturn { _setShipMeshOpacity, _navLightSeatDim, _lssSeatFrame };')(...names.map((k) => env[k]));
const frame = () => { api._lssSeatFrame(); api._navLightSeatDim(P.ship, seatView); };

// ---- the checks -------------------------------------------------------------------------------------------------
let fails = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const every = (n, fn) => { let all = true; for (let i = 0; i < n; i++) { frame(); if (!fn()) all = false; } return all; };
console.log('source: ' + file);

console.log('chase view, before the cloak');
ok(every(3, () => P.body.visible && P.xorzo.opacity === 1 && !P.xorzo.transparent), 'pilot drawn, Xorzo opaque');

console.log('chase view, Auto Cloak fires (_setPlayerShipOpacity(0.01))');
api._setShipMeshOpacity(P.ship, 0.01);
const v0 = P.xorzo.version;
ok(every(10, () => !P.body.visible), 'pilot hidden on every frame of the cloak');
ok(near(P.xorzo.opacity, 0.01) && P.xorzo.transparent, 'Xorzo still at the cloak opacity after 10 frames (' + P.xorzo.opacity + ')');
ok(P.xorzo.version === v0, 'no transparent flip (program re-evaluation) during the cloak (' + (P.xorzo.version - v0) + ')');
ok(near(P.hull.opacity, 0.01), 'hull cloaked as before');
ok(S.body.visible, "the Summoners' body is untouched by YOUR cloak");

console.log('chase view, the cloak ends (_setPlayerShipOpacity(1.0))');
api._setShipMeshOpacity(P.ship, 1.0);
ok(every(3, () => P.body.visible), 'pilot back');
ok(P.xorzo.opacity === 1 && !P.xorzo.transparent && P.xorzo.depthWrite, 'Xorzo opaque again');

console.log('seat view (first person): cloak and uncloak');
seatView = true;
ok(every(2, () => !P.body.visible && near(P.xorzo.opacity, 0.16) && P.xorzo.transparent), 'seat: pilot not drawn, Xorzo at the 16 % dim');
api._setShipMeshOpacity(P.ship, 0.01);
ok(every(5, () => P.xorzo.opacity <= 0.01 + 1e-9), 'seat: Xorzo cloaked every frame (' + P.xorzo.opacity + ')');
api._setShipMeshOpacity(P.ship, 1.0);
ok(every(2, () => near(P.xorzo.opacity, 0.16) && P.xorzo.transparent && !P.xorzo.depthWrite), 'seat: the 16 % dim is back after the uncloak');
seatView = false;
ok(every(2, () => P.body.visible && P.xorzo.opacity === 1 && !P.xorzo.transparent), 'back in the chase view: pilot drawn, Xorzo opaque');

console.log('a cloaked Summoners flagship (a bot / peer cloak: _setShipMeshOpacity(this.mesh, 0.01))');
api._setShipMeshOpacity(S.ship, 0.01);
ok(every(3, () => !S.body.visible && P.body.visible), 'their body hidden, yours drawn');
api._setShipMeshOpacity(S.ship, 1.0);
ok(every(2, () => S.body.visible), 'their body back after their uncloak');

console.log('replay ghost (_RPL_CLOAK_OP 0.18)');
api._setShipMeshOpacity(P.ship, 0.18);
ok(every(2, () => !P.body.visible), 'pilot hidden under the 18 % replay ghost');
api._setShipMeshOpacity(P.ship, 1.0);
ok(every(1, () => P.body.visible), 'pilot back');

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks pass');
process.exit(fails ? 1 : 0);
