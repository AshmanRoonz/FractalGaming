// check_rig.mjs : the gimbal RINGS on screen must show exactly what the physics pods are doing.
//
//   node GimbalDrone/check_rig.mjs
//
// Needs three.js r165 (the version the engine loads). It is not vendored in this repo, so either run
// `npm install --no-save three@0.165.0` inside GimbalDrone/ or point THREE_PATH at a three package
// directory. Without it the check says so and exits 0.
//
// What it proves: for thousands of random pod aims (each pod keeping the twist it accumulates along
// the way), the outer / middle / inner Euler decomposition in gd_mod.js, applied under each pod's
// mount yaw and the hull's 180-degree flip, reproduces the physics pod orientation EXACTLY: thrust
// axis, exhaust direction and twist. It exists because a mount yaw read back from a cloned Euler once
// posed the two left pods 90 degrees wrong while looking plausible on screen.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let THREE;
try {
  THREE = process.env.THREE_PATH
    ? await import(pathToFileURL(path.join(process.env.THREE_PATH, 'build/three.module.js')).href)
    : await import('three');
} catch (_) {
  console.log('check_rig: three.js not found (npm install --no-save three@0.165.0 in GimbalDrone/, or set THREE_PATH). Skipped.');
  process.exit(0);
}

// The mod expects a browser; give it just enough of one.
const store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.document = {
  addEventListener() {}, readyState: 'complete', getElementById: () => null,
  createElement: () => ({ style: {}, getContext: () => null, addEventListener() {} }),
  body: { appendChild() {} }, documentElement: { style: { setProperty() {} } },
};
globalThis.THREE = THREE;
globalThis.Image = class { set src(_) {} };
require(path.join(HERE, 'gd_physics.js'));
require(path.join(HERE, 'gd_mod.js'));
const GD = globalThis.GD, M = globalThis.GDMod;

const cache = { loaded: {} };
M.install({
  THREE, SHIP_MODELS: { VORTEX: { scaleMult: 1.19 } }, LOADOUTS: { VORTEX: { chassis: 'CORVETTE' } },
  CHASSIS: { CORVETTE: { hullLength: 100, acceleration: 800 } }, shipModelCache: cache, VISUAL_SCALE_BOOST: 1.55,
  LSS: { CLASS_COLORS: { VORTEX: 0xaa55ff } }, isXR: () => false,
});
M.preloadShips();
const group = new THREE.Group();
group.add(cache.loaded.VORTEX.clone(true));     // a CLONE, the way the engine builds every hull
M.attachRig(group, 'VORTEX');
const rig = group.userData.gdRig, af = M.frames.VORTEX.af;
if (!rig) { console.log('FAIL: attachRig found no rig'); process.exit(1); }

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const pods = [GD.newPod(), GD.newPod(), GD.newPod(), GD.newPod()];
let worstAxis = 0, worstJet = 0, worstQ = 0, n = 0;
const y = new THREE.Vector3(), want = new THREE.Vector3(), jp = new THREE.Vector3(), cp = new THREE.Vector3();
const q = new THREE.Quaternion(), wq = new THREE.Quaternion();
for (let k = 0; k < 2000; k++) {
  for (let i = 0; i < 4; i++) {
    const t = GD.V(rnd(), rnd(), rnd()), l = GD.vlen(t);
    if (l < 0.1) continue;
    GD.vscale(t, t, 1 / l);
    GD.constrainAim(t, af.pods[i].radial, Math.PI, af.keepCos);
    GD.slewPod(pods[i], t, Math.PI, 1, af.pods[i].radial);
    pods[i].T = af.Tmax * 0.5;
  }
  M._test.poseRings(rig, pods, af.Tmax);
  group.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) {
    const p = rig.pods[i], d = pods[i].d, e = p.inner.matrixWorld.elements;
    y.set(e[4], e[5], e[6]).normalize();               // the ring's thrust axis on the hull
    want.set(-d.x, d.y, -d.z);                          // physics aim, body -> hull flip
    worstAxis = Math.max(worstAxis, y.angleTo(want));
    p.jet.getWorldPosition(jp); p.inner.getWorldPosition(cp);
    worstJet = Math.max(worstJet, jp.sub(cp).normalize().angleTo(want.negate()));
    p.inner.getWorldQuaternion(q);
    const pq = pods[i].qp; wq.set(-pq.x, pq.y, -pq.z, pq.w);
    worstQ = Math.max(worstQ, q.angleTo(wq));
    n++;
  }
}
const deg = (r) => (r * 180 / Math.PI).toExponential(2);
const pass = worstAxis < 1e-4 && worstJet < 1e-4 && worstQ < 1e-4;
console.log((pass ? '  ok   ' : '  FAIL ') + n + ' pod poses: thrust axis ' + deg(worstAxis) + ' deg, exhaust ' + deg(worstJet) + ' deg, full orientation incl. twist ' + deg(worstQ) + ' deg');
process.exit(pass ? 0 : 1);
