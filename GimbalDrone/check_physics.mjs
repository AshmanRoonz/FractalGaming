// check_physics.mjs : behavioural checks for the gimbal drone physics.
//
//   node GimbalDrone/check_physics.mjs          (from the repo root; no installs needed)
//
// Loads the REAL gd_physics.js (the same file the game loads, not a re-typed copy) and flies it at a
// fixed timestep. Each check states a property the airframe must have and prints the number that
// settled it, so a failure says what moved, not just that something did.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const GD = require(path.join(path.dirname(fileURLToPath(import.meta.url)), 'gd_physics.js'));
const { V, Q, vlen, qrot, qYXZ, qToRotVec, qconj, qmul } = GD;

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const f2 = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(3));

// A Frigate-sized drone: 3.2 m class, pods 1 m out on each axis.
const SPEC = {
  pods: [V(1.0, 0, -1.0), V(-1.0, 0, -1.0), V(-1.0, 0, 1.0), V(1.0, 0, 1.0)],
  podR: 0.32, mass: 30, twr: 5, core: V(0.7, 0.35, 1.0), cdA: V(0.6, 1.4, 0.5), podType: 'plasma',
};
const ground = (x, z) => 0;
function make(spec) {
  const d = new GD.Drone(Object.assign({}, SPEC, spec || {}));
  const c = new GD.Controller(d);
  return { d, c };
}
const tiltOf = (q) => { const u = qrot(V(), q, V(0, 1, 0)); return Math.acos(Math.max(-1, Math.min(1, u.y))) * 180 / Math.PI; };
const angBetween = (qa, qb) => { const e = qToRotVec(V(), qmul(Q(), qconj(Q(), qa), qb)); return vlen(e) * 180 / Math.PI; };
function run(sim, intent, env, seconds, each) {
  const H = 1 / 400, n = Math.round(seconds / H);
  for (let i = 0; i < n; i++) {
    sim.d.step(H, sim.c.update(H, intent), env);
    if (each) each(i * H);
  }
}

console.log('1. allocation');
{
  const a = GD.airframe(SPEC);
  const u = new Float64Array(12), sat = {};
  // pure force: every pod takes exactly a quarter
  GD.allocate(a, V(), V(0, 400, 0), V(40, 0, -20), u, sat);
  let worst = 0;
  for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(u[3 * i] - 10), Math.abs(u[3 * i + 1] - 100), Math.abs(u[3 * i + 2] + 5));
  ok(worst < 1e-9, 'pure force splits F/4 per pod (worst error ' + f2(worst) + ' N)');
  // pure yaw torque: a tangential pinwheel, no vertical component, no net force
  GD.allocate(a, V(0, 50, 0), V(), V(), u, sat);
  let vert = 0, fx = 0, fz = 0, tq = 0;
  for (let i = 0; i < 4; i++) {
    const r = a.pods[i].r; vert = Math.max(vert, Math.abs(u[3 * i + 1]));
    fx += u[3 * i]; fz += u[3 * i + 2];
    tq += r.z * u[3 * i] - r.x * u[3 * i + 2];
    const radialPart = Math.abs(u[3 * i] * a.pods[i].radial.x + u[3 * i + 2] * a.pods[i].radial.z);
    vert = Math.max(vert, radialPart);
  }
  ok(vert < 1e-9 && Math.abs(fx) < 1e-9 && Math.abs(fz) < 1e-9, 'yaw torque is a pure tangential pinwheel (non-tangential ' + f2(vert) + ', net F ' + f2(Math.hypot(fx, fz)) + ')');
  ok(Math.abs(tq - 50) < 1e-9, 'pinwheel delivers the asked yaw torque (' + f2(tq) + ' / 50 N m)');
  // roll torque = vertical differential thrust, like a quad
  GD.allocate(a, V(0, 0, 30), V(), V(), u, sat);
  const rollLike = u[1] > 0 && u[10] > 0 && u[4] < 0 && u[7] < 0 && Math.abs(u[0]) < 1e-9 && Math.abs(u[2]) < 1e-9;
  ok(rollLike, 'roll torque = right pods up, left pods down, nothing sideways');
  // the fan reaction torque is folded into the matrix exactly: reconstruct the wrench
  const af = GD.airframe(Object.assign({}, SPEC, { podType: 'fan' }));
  const w = [12, 300, -7, 4, 9, -3];
  GD.allocate(af, V(w[3], w[4], w[5]), V(w[0], w[1], w[2]), V(), u, sat);
  const Fr = [0, 0, 0], Tr = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const r = af.pods[i].r, f = [u[3 * i], u[3 * i + 1], u[3 * i + 2]], k = -af.pods[i].spin * af.kq;
    Fr[0] += f[0]; Fr[1] += f[1]; Fr[2] += f[2];
    Tr[0] += r.y * f[2] - r.z * f[1] + k * f[0];
    Tr[1] += r.z * f[0] - r.x * f[2] + k * f[1];
    Tr[2] += r.x * f[1] - r.y * f[0] + k * f[2];
  }
  const res = Math.hypot(Fr[0] - w[0], Fr[1] - w[1], Fr[2] - w[2], Tr[0] - w[3], Tr[1] - w[4], Tr[2] - w[5]);
  ok(res < 1e-9, 'fan airframe: A u reproduces the wrench incl. rotor reaction (residual ' + f2(res) + ')');
  // saturation priority: an absurd manoeuvre must not eat the weight support
  GD.allocate(a, V(0, 0, 0), V(0, a.mass * GD.G, 0), V(5000, 0, 0), u, sat);
  let maxT = 0, sumY = 0;
  for (let i = 0; i < 4; i++) { maxT = Math.max(maxT, Math.hypot(u[3 * i], u[3 * i + 1], u[3 * i + 2])); sumY += u[3 * i + 1]; }
  ok(sat.grav === 1 && sat.cmd < 1 && maxT <= a.Tmax + 1e-6 && Math.abs(sumY - a.mass * GD.G) < 1e-6,
     'saturation keeps weight (grav ' + sat.grav + ', cmd ' + f2(sat.cmd) + ', max pod ' + f2(maxT) + ' / ' + f2(a.Tmax) + ' N)');
}

console.log('2. hover hold (plasma)');
{
  const s = make(); s.d.reset(0, 10, 0, 0.7); s.c.reset();
  const it = { mode: 'hover', vCmd: V(), yaw: 0.7, armed: true };
  // From a cold start the pods spool up from zero, so it sags a little first and then holds where
  // it came to rest (the hold point is captured at the stopping point, by design).
  let sag = 0;
  run(s, it, { ground }, 6, () => { sag = Math.max(sag, 10 - s.d.p.y); });
  const off = Math.hypot(s.d.p.x - s.c.holdP.x, s.d.p.y - s.c.holdP.y, s.d.p.z - s.c.holdP.z);
  ok(sag < 0.15, 'spool-up sag ' + f2(sag) + ' m');
  ok(s.c.holdOn && off < 0.01 && vlen(s.d.v) < 0.005, 'then settles onto its hold point (' + f2(off) + ' m off, ' + f2(vlen(s.d.v)) + ' m/s)');
  ok(tiltOf(s.d.q) < 0.2, 'body level (tilt ' + f2(tiltOf(s.d.q)) + ' deg)');
  const Tsum = s.d.pods.reduce((t, p) => t + p.T, 0);
  ok(Math.abs(Tsum - s.d.af.mass * GD.G) < 0.5, 'total thrust = weight (' + f2(Tsum) + ' N vs ' + f2(s.d.af.mass * GD.G) + ')');
  ok(s.d.power > 0, 'hover power ' + (s.d.power / 1000).toFixed(2) + ' kW');
}

console.log('3. HOVER mode translates without tilting');
{
  const s = make(); s.d.reset(0, 20, 0, 0); s.c.reset();
  const it = { mode: 'hover', vCmd: V(14, 0, 0), yaw: 0, armed: true };
  let maxTilt = 0, maxPod = 0;
  run(s, it, { ground }, 4, () => {
    maxTilt = Math.max(maxTilt, tiltOf(s.d.q));
    for (const p of s.d.pods) maxPod = Math.max(maxPod, Math.acos(Math.max(-1, Math.min(1, p.d.y))) * 180 / Math.PI);
  });
  ok(Math.abs(s.d.v.x - 14) < 0.3, 'reaches the commanded 14 m/s (' + f2(s.d.v.x) + ')');
  ok(maxTilt < 1.5, 'body never tilts more than 1.5 deg while accelerating (' + f2(maxTilt) + ' deg)');
  ok(maxPod > 45, 'the pods do the work: they lean up to ' + f2(maxPod) + ' deg');
  ok(Math.abs(s.d.p.y - 20) < 0.6, 'altitude held through the push (' + f2(s.d.p.y - 20) + ' m)');
}

console.log('4. QUAD mode has to tilt to do the same');
{
  const s = make(); s.d.reset(0, 20, 0, 0); s.c.reset();
  const it = { mode: 'quad', vCmd: V(14, 0, 0), yaw: 0, armed: true };
  let maxTilt = 0, maxPod = 0;
  run(s, it, { ground }, 5, () => {
    maxTilt = Math.max(maxTilt, tiltOf(s.d.q));
    for (const p of s.d.pods) maxPod = Math.max(maxPod, Math.acos(Math.max(-1, Math.min(1, p.d.y))) * 180 / Math.PI);
  });
  ok(Math.abs(s.d.v.x - 14) < 0.6, 'still reaches 14 m/s (' + f2(s.d.v.x) + ')');
  ok(maxTilt > 20, 'body tilts like a quadcopter (' + f2(maxTilt) + ' deg)');
  ok(maxPod < 10, 'pods stay locked near body-up (' + f2(maxPod) + ' deg)');
}

console.log('5. FREE (6DOF) mode: any attitude, no drift');
for (const [label, yaw, pitch, roll] of [['pitched 60 deg nose-up', 0.3, 1.047, 0], ['knife-edge (rolled 90)', 0, 0, Math.PI / 2], ['inverted', 0, 0, Math.PI]]) {
  const s = make(); s.d.reset(0, 30, 0, 0); s.c.reset();
  const look = qYXZ(Q(), yaw, pitch, roll);
  const it = { mode: 'free', vCmd: V(), look, yaw, armed: true };
  let maxDrift = 0;
  run(s, it, { ground }, 6, (t) => { if (t > 0.5) maxDrift = Math.max(maxDrift, Math.hypot(s.d.p.x, s.d.p.y - 30, s.d.p.z)); });
  const err = angBetween(s.d.q, look);
  ok(err < 1 && maxDrift < 1.5, label + ': attitude error ' + f2(err) + ' deg, worst drift ' + f2(maxDrift) + ' m');
}

console.log('6. FREE mode flies forward while looking elsewhere');
{
  const s = make(); s.d.reset(0, 30, 0, 0); s.c.reset();
  const look = qYXZ(Q(), Math.PI / 2, 0.5, 0);           // looking 90 deg left and 29 deg up
  const it = { mode: 'free', vCmd: V(0, 0, -12), look, armed: true };   // ...flying north
  run(s, it, { ground }, 4);
  ok(Math.abs(s.d.v.z + 12) < 0.4 && Math.abs(s.d.v.x) < 0.3 && Math.abs(s.d.v.y) < 0.3,
     'velocity (' + f2(s.d.v.x) + ', ' + f2(s.d.v.y) + ', ' + f2(s.d.v.z) + ') while facing west, nose up');
}

console.log('7. fan pods: reaction + gyro are handled');
{
  const s = make({ podType: 'fan' }); s.d.reset(0, 10, 0, 0); s.c.reset();
  const it = { mode: 'hover', vCmd: V(), yaw: 0, armed: true };
  run(s, it, { ground }, 4);
  const yaw0 = GD.headingOf(s.d.q);
  ok(Math.abs(yaw0) < 0.01, 'no yaw creep at hover (reaction torques cancel), heading ' + f2(yaw0) + ' rad');
  it.yaw = Math.PI / 2;
  let t90 = -1;
  run(s, it, { ground }, 3, (t) => { if (t90 < 0 && Math.abs(GD.headingOf(s.d.q) - Math.PI / 2) < 0.02) t90 = t; });
  ok(t90 > 0 && t90 < 1.5, '90 deg yaw settles in ' + f2(t90) + ' s');
  // hard sideways slam: gyro kick from slewing spinning pods must stay a wobble, not a tumble
  it.vCmd = V(0, 0, 18); let maxTilt = 0;
  run(s, it, { ground }, 2, () => { maxTilt = Math.max(maxTilt, tiltOf(s.d.q)); });
  ok(maxTilt < 6, 'gyro precession during a hard push stays a wobble (' + f2(maxTilt) + ' deg)');
}

console.log('8. wind rejection');
{
  const s = make(); s.d.reset(0, 15, 0, 0); s.c.reset();
  const it = { mode: 'hover', vCmd: V(), yaw: 0, armed: true };
  const env = { ground, wind: V(9, 0, 3) };
  let t = 0, worst = 0;
  run(s, it, env, 12, (tt) => {
    t = tt;
    env.wind.x = 9 + 3 * Math.sin(tt * 1.3) + 1.5 * Math.sin(tt * 3.1);
    if (tt > 6) worst = Math.max(worst, Math.hypot(s.d.p.x, s.d.p.y - 15, s.d.p.z));
  });
  ok(worst < 1.0, 'gusting 9-13 m/s wind: worst drift after settling ' + f2(worst) + ' m');
  ok(tiltOf(s.d.q) < 1.5, 'and the body is still level (' + f2(tiltOf(s.d.q)) + ' deg); the pods lean into it');
}

console.log('9. landing and ground contact');
{
  const s = make(); s.d.reset(0, 6, 0, 0); s.c.reset();
  const it = { mode: 'hover', vCmd: V(0, -3, 0), yaw: 0, armed: true };
  let touch = -1, hit = 0;
  run(s, it, { ground }, 5, (t) => { if (touch < 0 && s.d.contacts > 0) touch = t; hit = Math.max(hit, s.d.impact); });
  ok(touch > 0 && hit > 1 && hit < 4, 'touches down after ' + f2(touch) + ' s at ' + f2(hit) + ' m/s (commanded 3 m/s descent)');
  it.armed = false;
  run(s, it, { ground }, 3);
  ok(vlen(s.d.v) < 0.02 && vlen(s.d.w) < 0.02 && tiltOf(s.d.q) < 3, 'disarmed, it rests on its skids (v ' + f2(vlen(s.d.v)) + ', tilt ' + f2(tiltOf(s.d.q)) + ' deg)');
  const Tsum = s.d.pods.reduce((t, p) => t + p.T, 0);
  ok(Tsum < 0.5, 'and the pods spool down (' + f2(Tsum) + ' N)');
}

console.log('10. visual allocation (for drones we only watch)');
{
  const af = GD.airframe(SPEC), u = new Float64Array(12), sat = {};
  GD.visualPods(af, qYXZ(Q(), 0, 0, 0), V(0, 0, 0), V(), u, sat);
  let worst = 0;
  for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(u[3 * i]), Math.abs(u[3 * i + 1] - af.mass * GD.G / 4), Math.abs(u[3 * i + 2]));
  ok(worst < 1e-9, 'a hovering drone shows four pods straight up at mg/4');
  GD.visualPods(af, qYXZ(Q(), 0, 0, Math.PI / 2), V(0, 0, 0), V(), u, sat);
  const d0 = Math.hypot(u[0], u[1], u[2]);
  ok(u[0] / d0 > 0.99 || u[0] / d0 < -0.99, 'a drone hovering in knife-edge shows its pods aimed along body X (world up)');
}

console.log('11. determinism + holonomy');
{
  const a1 = make(), a2 = make();
  for (const s of [a1, a2]) { s.d.reset(0, 10, 0, 0); s.c.reset(); }
  const it = { mode: 'free', vCmd: V(5, 2, -3), look: qYXZ(Q(), 0.4, 0.3, 0.2), armed: true };
  run(a1, it, { ground }, 3); run(a2, it, { ground }, 3);
  ok(a1.d.p.x === a2.d.p.x && a1.d.q.w === a2.d.q.w, 'two identical runs are bit-identical');
  // Drive one pod's aim around a closed loop with shortest-arc steps; it comes back TWISTED.
  const pod = GD.newPod(), radial = V(Math.SQRT1_2, 0, -Math.SQRT1_2);
  const loop = [V(0.5, 0.866, 0), V(0, 0.866, 0.5), V(-0.5, 0.866, 0), V(0, 0.866, -0.5), V(0.5, 0.866, 0), V(0, 1, 0)];
  for (const t of loop) { const l = vlen(t); GD.slewPod(pod, V(t.x / l, t.y / l, t.z / l), Math.PI, 1, radial); }
  const twist = vlen(qToRotVec(V(), pod.qp)) * 180 / Math.PI;
  ok(Math.abs(pod.d.y - 1) < 1e-9 && twist > 5, 'aim returns to straight up but the pod is twisted ' + f2(twist) + ' deg (what the third ring is for)');
}

console.log('12. ship-sized airframe (VORTEX hull in the game: 6.4 m, 168 kg, T/W 3.9)');
{
  // The game fits each drone to its LSS hull, so the airframes are BIG and slow to rotate. These are the
  // numbers GDMod.dump() reported for VORTEX in the engine (pods 2.32 m out, inertia ~470/866/413).
  const k = 3.74;
  const BIG = { pods: [V(0.62 * k, 0.05, -0.62 * k), V(-0.62 * k, 0.05, -0.62 * k), V(-0.62 * k, 0.05, 0.62 * k), V(0.62 * k, 0.05, 0.62 * k)],
    podR: 0.24 * k, mass: 168.4, twr: 3.92, core: V(0.6 * k, 0.26 * k, 0.92 * k), cdA: V(2.48, 6.6, 2.07), podType: 'plasma' };
  const mk = () => { const d = new GD.Drone(BIG), c = new GD.Controller(d); c.gain.quadTilt = 1.05; d.reset(0, 50, 0, 0); for (const p of d.pods) p.T = d.af.mass * GD.G / 4; c.reset(); return { d, c }; };
  const aMax = { h: 32, up: 25.6, down: 25.6 };
  { // QUAD strafing at the chassis' full manoeuvre limit: lean to the 60 deg cap, no further, keep lift
    const s = mk(); const it = { mode: 'quad', vCmd: V(14, 0, 0), yaw: 0, armed: true, aMax };
    let maxTilt = 0, minLift = 1, minY = 50;
    run(s, it, {}, 6, () => { maxTilt = Math.max(maxTilt, tiltOf(s.d.q)); minLift = Math.min(minLift, s.d.sat.grav); minY = Math.min(minY, s.d.p.y); });
    ok(maxTilt < 63, 'QUAD lean stays at its 60 deg cap (peak ' + f2(maxTilt) + ' deg)');
    ok(50 - minY < 3, 'and does not fall out of the sky doing it (lost ' + f2(50 - minY) + ' m, worst lift headroom ' + f2(minLift) + ')');
    ok(Math.abs(s.d.v.x - 14) < 0.6, 'reaches 14 m/s (' + f2(s.d.v.x) + ')');
  }
  { // FREE: follow a 70 deg pitch-up look without overshooting it
    const s = mk(); const look = qYXZ(Q(), 0, 1.22, 0); const it = { mode: 'free', vCmd: V(), look, armed: true, aMax };
    let peak = 0;
    run(s, it, {}, 5, () => { const f = qrot(V(), s.d.q, V(0, 0, -1)); peak = Math.max(peak, Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI); });
    ok(peak < 72 && angBetween(s.d.q, look) < 1, '6DOF pitch-up to 70 deg: peak ' + f2(peak) + ' deg, final error ' + f2(angBetween(s.d.q, look)) + ' deg');
  }
  { // HOVER: a 180 deg turn on the spot
    const s = mk(); const it = { mode: 'hover', vCmd: V(), yaw: Math.PI - 0.01, armed: true, aMax };
    let t180 = -1, maxTilt = 0;
    run(s, it, {}, 6, (t) => { maxTilt = Math.max(maxTilt, tiltOf(s.d.q)); if (t180 < 0 && Math.abs(GD.headingOf(s.d.q) - (Math.PI - 0.01)) < 0.03) t180 = t; });
    ok(t180 > 0 && t180 < 3, 'HOVER 180 deg yaw in ' + f2(t180) + ' s, body tilt ' + f2(maxTilt) + ' deg');
  }
}

console.log(fails ? ('\n' + fails + ' check(s) FAILED') : '\nall checks passed');
process.exit(fails ? 1 : 0);
