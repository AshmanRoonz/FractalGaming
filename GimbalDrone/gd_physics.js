// gd_physics.js : GIMBAL DRONE flight physics + flight controller for the GimbalDrone copy of LSS.
//
// Zero dependencies. Plain {x,y,z} / {x,y,z,w} objects, no THREE, no DOM. The game loads it as a
// classic <script> before the game script and reaches it as `window.GD`; GimbalDrone/check_physics.mjs
// require()s the same file and flies it in Node. Nothing in here knows a scene exists, so the drone
// could be dropped into any other build (LSS proper included) by handing it an intent each frame.
//
// SI units inside (metres, kilograms, seconds, newtons). The game converts at the boundary with
// GD.U game units per metre (LSS hulls are 80..140 u long, so U = 25 makes them 3.2..5.6 m drones
// and LSS's 250..450 u/s cruise speeds come out at 10..18 m/s: camera-drone numbers).
//
// ---------------------------------------------------------------------------------------------------
// THE AIRFRAME
// Four thrust pods on an X, each at the end of an arm, each held in a three-ring gimbal. A pod can
// only push along its own axis, so one pod is a 3-DOF FORCE actuator: two DOF of aim (the gimbal)
// plus one of magnitude (the throttle). Four pods = 12 inputs for the 6 DOF of a rigid body (3 force
// + 3 torque). The airframe is FULLY ACTUATED and OVER-ACTUATED by six.
//   * A normal quadcopter has 4 inputs (four thrust magnitudes along body-up) for 6 DOF. It can only
//     push along its own up axis, so to move sideways it must first tilt the whole body; position
//     and attitude are coupled. That is the QUAD mode below, kept for comparison.
//   * This airframe can push in any direction while holding any attitude: hover level while sliding
//     sideways, hover pitched 60 degrees nose-up without drifting, hold a knife-edge (rolled 90) with
//     the pods pointing at the sky. That is the HOVER and FREE modes.
//
// THE THIRD RING. Aim is two DOF; the third ring is the twist about the thrust axis, which a plain
// thruster does not care about. It earns its place two ways. (1) Each pod slews along the SHORTEST
// ARC to its new aim (the least angular travel, so the least gimbal work and, for fans, the least
// gyroscopic kick). Shortest-arc steps do not commute: drive the aim around a closed loop and the
// pod comes back twisted by the solid angle it swept (holonomy, the same geometry as a Foucault
// pendulum). The inner ring is where that twist goes. (2) With only two rings the aim set has a
// singular direction where one ring has to spin infinitely fast (gimbal lock). Our outer ring
// pivots on the arm axis and the middle ring tilts radially, so the singular aim is thrust straight
// along the arm. Outward along the arm is already forbidden (KEEP-OUT, the exhaust would blast the
// arm), which leaves only thrust straight back at the body, needed only for hard sideways pushes
// while rolled. You can watch the outer and inner rings whirl when a pod passes near it.
//
// ---------------------------------------------------------------------------------------------------
// CONTROL ALLOCATION (the heart of it)
// The controller asks for a body-frame force F and torque tau. Find four pod thrust vectors f_i with
//     sum f_i            = F
//     sum r_i x f_i (+ rotor reaction torques for fans) = tau
// That is A u = w with u in R^12, w in R^6, A a constant 6x12 matrix (pods are bolted to the body).
// Twelve unknowns, six equations: infinitely many answers. We take the MINIMUM-NORM one,
//     u = A^T (A A^T)^-1 w   (the pseudo-inverse, precomputed once per airframe),
// which minimises sum |f_i|^2. That spreads the load evenly and keeps every pod as far from its
// limit as possible. For the symmetric X it has a lovely closed form: every pod gets F/4, plus a
// rigid "twist" field (M^-1 tau) x r_i. Read that field and you get the classic behaviours for free:
//   roll / pitch torque -> pods on one side push harder (vertical differential thrust, like a quad)
//   yaw torque          -> every pod leans tangentially, a pinwheel. Vectored yaw is far stronger
//                          than a quad's rotor-drag yaw, which is why these turn so crisply.
//   any force           -> all four pods lean together, the body does not have to.
//
// PRIORITISED SATURATION. Pods top out at Tmax, so a big ask is scaled down in layers:
//   1. attitude torque  (never lose control of the body)
//   2. weight support   (then stay in the air)
//   3. manoeuvre force  (then go where the pilot asked, with whatever is left)
// Each layer gets the largest scale s in [0,1] that keeps |f_i| <= Tmax on every pod, solved exactly
// per pod as a quadratic. Flight controllers call this "airmode"; the HUD shows the three scales.
//
// ---------------------------------------------------------------------------------------------------
// WHAT MAKES IT A SIM AND NOT A TELEPORT
//   * Gimbal slew rate. A pod turns at a finite rate along the shortest arc. Reversing a push means
//     swinging the pods through 180 degrees, during which they push sideways.
//   * Projection. While a pod is still swinging, it is throttled to the component of its desired
//     vector along where it actually points (T = f . d, never negative): the least-squares best a
//     single misaimed pod can do. No pushing hard in the wrong direction mid-swing.
//   * Spool lag. Thrust follows the command through a first-order lag (fans are slower, and slower
//     still spinning down than up).
//   * Exhaust keep-out. A pod may not aim its exhaust into its own arm.
//   * Fans (option) add rotor REACTION torque along each pod axis (counter-rotating diagonal pairs
//     cancel at hover) and GYROSCOPIC precession whenever a spinning pod is slewed or the body turns.
//     The allocator models reaction exactly (it is linear in f_i, so it goes into A); gyro is left
//     as a disturbance the attitude loop has to reject, just as on a real airframe. Plasma pods have
//     no moving parts: neither effect, and a faster spool.
//   * Gravity, quadratic body drag (anisotropic: the flat top has the big area), rigid-body rotation
//     with the full gyroscopic term w x Iw.
(function (root) {
'use strict';

const G = 9.81;          // m/s^2
const RHO = 1.225;       // kg/m^3, sea-level air

// ---------------------------------------------------------------------------------------------------
// Vector / quaternion helpers. All write into an `o` argument and return it, so the hot loop never
// allocates. Quaternions rotate body -> world (three.js convention, q * v * q^-1).
function V(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
function Q(x, y, z, w) { return { x: x || 0, y: y || 0, z: z || 0, w: (w == null) ? 1 : w }; }
function vset(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }
function vcopy(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
function vadd(o, a, b) { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; }
function vsub(o, a, b) { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; }
function vscale(o, a, s) { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; }
function vmad(o, a, s) { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; }
function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vlen(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function vcross(o, a, b) {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
}
function vnorm(o, a) { const l = vlen(a); return l > 1e-12 ? vscale(o, a, 1 / l) : vset(o, 0, 0, 0); }
function qcopy(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; o.w = a.w; return o; }
function qmul(o, a, b) {   // o = a (x) b
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  o.x = x; o.y = y; o.z = z; o.w = w; return o;
}
function qconj(o, a) { o.x = -a.x; o.y = -a.y; o.z = -a.z; o.w = a.w; return o; }
function qnormalize(q) {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  q.x /= l; q.y /= l; q.z /= l; q.w /= l; return q;
}
function qrot(o, q, v) {   // o = q v q^-1
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  o.x = x; o.y = y; o.z = z; return o;
}
function qrotInv(o, q, v) {   // o = q^-1 v q
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
  const x = v.x + qw * tx + (qy * tz - qz * ty);
  const y = v.y + qw * ty + (qz * tx - qx * tz);
  const z = v.z + qw * tz + (qx * ty - qy * tx);
  o.x = x; o.y = y; o.z = z; return o;
}
function qaxisAngle(o, ax, ay, az, ang) {   // axis must be unit
  const h = ang * 0.5, s = Math.sin(h);
  o.x = ax * s; o.y = ay * s; o.z = az * s; o.w = Math.cos(h); return o;
}
// three.js Euler order 'YXZ' (yaw about Y, then pitch about X, then roll about Z). LSS's player.euler
// uses this order, and so does every heading in here.
function qYXZ(o, yaw, pitch, roll) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(roll / 2);
  o.x = s1 * c2 * c3 + c1 * s2 * s3;
  o.y = c1 * s2 * c3 - s1 * c2 * s3;
  o.z = c1 * c2 * s3 - s1 * s2 * c3;
  o.w = c1 * c2 * c3 + s1 * s2 * s3;
  return o;
}
// Rotation vector (axis * angle) of a unit quaternion, shortest way round.
function qToRotVec(o, q) {
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return vset(o, 2 * x, 2 * y, 2 * z);
  const k = 2 * Math.atan2(s, w) / s;
  return vset(o, x * k, y * k, z * k);
}
// Body-rate integration: q <- q (x) exp(w dt / 2), w in BODY frame.
const _qi = Q();
function qintegrate(q, w, dt) {
  const wl = vlen(w);
  if (wl < 1e-12) return q;
  const h = wl * dt * 0.5, s = Math.sin(h) / wl;
  _qi.x = w.x * s; _qi.y = w.y * s; _qi.z = w.z * s; _qi.w = Math.cos(h);
  return qnormalize(qmul(q, q, _qi));
}
// Heading (three.js yaw) of a body attitude: the direction the nose points, flattened. If the nose
// points straight up or down, fall back to where the belly or back points.
const _hv = V();
function headingOf(q) {
  qrot(_hv, q, { x: 0, y: 0, z: -1 });
  if (_hv.x * _hv.x + _hv.z * _hv.z < 1e-4) {
    qrot(_hv, q, { x: 0, y: (_hv.y > 0 ? -1 : 1), z: 0 });
  }
  return Math.atan2(-_hv.x, -_hv.z);
}
// Rotation matrix columns (body axes in world) -> quaternion (three.js setFromRotationMatrix).
function qFromAxes(o, xb, yb, zb) {
  const m11 = xb.x, m12 = yb.x, m13 = zb.x;
  const m21 = xb.y, m22 = yb.y, m23 = zb.y;
  const m31 = xb.z, m32 = yb.z, m33 = zb.z;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    o.w = 0.25 / s; o.x = (m32 - m23) * s; o.y = (m13 - m31) * s; o.z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    o.w = (m32 - m23) / s; o.x = 0.25 * s; o.y = (m12 + m21) / s; o.z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    o.w = (m13 - m31) / s; o.x = (m12 + m21) / s; o.y = 0.25 * s; o.z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    o.w = (m21 - m12) / s; o.x = (m13 + m31) / s; o.y = (m23 + m32) / s; o.z = 0.25 * s;
  }
  return qnormalize(o);
}
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

// ---------------------------------------------------------------------------------------------------
// POD TYPES. Same airframe, two propulsion choices.
//   tauUp / tauDown : thrust spool time constants (s)
//   kq              : rotor reaction torque per newton of thrust, as a fraction of the pod radius
//   gyro            : rotor angular momentum per newton of max thrust (N m s / N), 0 = no rotor
//   slew            : gimbal slew rate (rad/s)
//   ge              : how strongly the exhaust cushions off the ground (ground effect)
const POD_TYPES = {
  plasma: { key: 'plasma', label: 'PLASMA', tauUp: 0.03, tauDown: 0.03, kq: 0, gyro: 0, slew: 9.0, ge: 0.5 },
  fan:    { key: 'fan', label: 'DUCTED FAN', tauUp: 0.08, tauDown: 0.11, kq: 0.06, gyro: 0.0016, slew: 7.0, ge: 1.0 },
};

// ---------------------------------------------------------------------------------------------------
// AIRFRAME. Built from geometry in metres, BODY frame: +X right, +Y up, -Z forward (the three.js
// camera convention, so a level drone looking along -Z is the identity attitude).
//   spec.pods     : 4 x {x,y,z} pod centres, FR, FL, RL, RR
//   spec.podR     : pod (outer ring) radius, m
//   spec.mass     : kg
//   spec.twr      : total max thrust / weight
//   spec.core     : {x,y,z} core box size, m (inertia only)
//   spec.cdA      : {x,y,z} drag area for flow along each body axis, m^2
//   spec.podType  : 'plasma' | 'fan'
//   spec.keepOutDeg : exhaust keep-out half angle around the arm (default 28)
function airframe(spec) {
  const pt = POD_TYPES[spec.podType] || POD_TYPES.plasma;
  const mass = spec.mass || 30;
  const podMassFrac = 0.10;                       // each pod: thruster + gimbal + ring hardware
  const podMass = mass * podMassFrac, coreMass = mass * (1 - 4 * podMassFrac);
  const core = spec.core || V(0.6, 0.3, 0.9);
  const pods = spec.pods.map((p, i) => {
    const r = V(p.x, p.y, p.z);
    const rl = Math.hypot(r.x, r.z) || 1;
    return {
      r,
      radial: V(r.x / rl, 0, r.z / rl),             // arm direction, outward, horizontal
      spin: (i % 2 === 0) ? 1 : -1,                 // fans: diagonal pairs counter-rotate
    };
  });
  // Inertia about the CoM: core box + pods as point masses (pods are well outboard, they dominate).
  let Ixx = coreMass / 12 * (core.y * core.y + core.z * core.z);
  let Iyy = coreMass / 12 * (core.x * core.x + core.z * core.z);
  let Izz = coreMass / 12 * (core.x * core.x + core.y * core.y);
  for (const p of pods) {
    Ixx += podMass * (p.r.y * p.r.y + p.r.z * p.r.z);
    Iyy += podMass * (p.r.x * p.r.x + p.r.z * p.r.z);
    Izz += podMass * (p.r.x * p.r.x + p.r.y * p.r.y);
  }
  const podR = spec.podR || 0.3;
  const Tmax = (spec.twr || 4) * mass * G / 4;
  const a = {
    spec, podType: pt, mass, I: V(Ixx, Iyy, Izz), pods, podR, Tmax,
    kq: pt.kq * podR,                               // reaction torque arm, m (Q = kq * T)
    rotorH: pt.gyro * Tmax,                         // rotor angular momentum at full thrust, N m s
    cdA: spec.cdA || V(0.35, 0.8, 0.3),
    keepCos: Math.cos(((spec.keepOutDeg != null) ? spec.keepOutDeg : 28) * Math.PI / 180),
    slew: pt.slew,
    angDamp: 0.04 * mass * podR,                    // light aero damping on rotation, N m s
  };
  a.P = allocationMatrix(a);
  return a;
}

// 6x6 Gauss-Jordan inverse with partial pivoting (row-major Float64Array(36)).
function invert6(M) {
  const n = 6, A = Float64Array.from(M), I = new Float64Array(36);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > best) { best = v; p = r; } }
    if (best < 1e-14) throw new Error('GD: singular allocation matrix');
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        let t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t;
        t = I[c * n + k]; I[c * n + k] = I[p * n + k]; I[p * n + k] = t;
      }
    }
    const inv = 1 / A[c * n + c];
    for (let k = 0; k < n; k++) { A[c * n + k] *= inv; I[c * n + k] *= inv; }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r * n + c];
      if (f === 0) continue;
      for (let k = 0; k < n; k++) { A[r * n + k] -= f * A[c * n + k]; I[r * n + k] -= f * I[c * n + k]; }
    }
  }
  return I;
}

// P = A^T (A A^T)^-1, 12x6 row-major. Row 3i+k is pod i, component k; columns 0..2 force, 3..5 torque.
function allocationMatrix(a) {
  const A = new Float64Array(6 * 12);     // 6 rows x 12 cols
  for (let i = 0; i < 4; i++) {
    const r = a.pods[i].r, c0 = 3 * i;
    // force rows: identity block
    A[0 * 12 + c0] = 1; A[1 * 12 + c0 + 1] = 1; A[2 * 12 + c0 + 2] = 1;
    // torque rows: [r]x  minus the reaction torque  spin * kq * I  (reaction opposes rotor spin)
    const k = -a.pods[i].spin * a.kq;
    A[3 * 12 + c0] = k;        A[3 * 12 + c0 + 1] = -r.z;  A[3 * 12 + c0 + 2] = r.y;
    A[4 * 12 + c0] = r.z;      A[4 * 12 + c0 + 1] = k;     A[4 * 12 + c0 + 2] = -r.x;
    A[5 * 12 + c0] = -r.y;     A[5 * 12 + c0 + 1] = r.x;   A[5 * 12 + c0 + 2] = k;
  }
  const AAt = new Float64Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0;
    for (let k = 0; k < 12; k++) s += A[i * 12 + k] * A[j * 12 + k];
    AAt[i * 6 + j] = s;
  }
  const inv = invert6(AAt);
  const P = new Float64Array(12 * 6);
  for (let r = 0; r < 12; r++) for (let c = 0; c < 6; c++) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += A[k * 12 + r] * inv[k * 6 + c];
    P[r * 6 + c] = s;
  }
  return P;
}

// Largest s in [0,1] with |a + s b| <= T (exact, per pod). |a|>T already -> 0.
function maxScale(ax, ay, az, bx, by, bz, T) {
  const bb = bx * bx + by * by + bz * bz;
  if (bb < 1e-12) return 1;
  const ab = ax * bx + ay * by + az * bz, c = ax * ax + ay * ay + az * az - T * T;
  if (c > 0) return 0;
  const s = (-ab + Math.sqrt(ab * ab - bb * c)) / bb;
  return s < 0 ? 0 : (s > 1 ? 1 : s);
}

// Largest s >= 0 with |a + s b| <= T, NOT clamped to 1: how much of b fits on top of a.
function maxScaleOpen(ax, ay, az, bx, by, bz, T) {
  const bb = bx * bx + by * by + bz * bz;
  if (bb < 1e-12) return Infinity;
  const ab = ax * bx + ay * by + az * bz, c = ax * ax + ay * ay + az * az - T * T;
  if (c > 0) return 0;
  return Math.max(0, (-ab + Math.sqrt(ab * ab - bb * c)) / bb);
}

// ANGULAR ACCELERATION BUDGET. How hard can this airframe actually twist about each body axis while
// still carrying its weight? Take the hover allocation and see how much unit torque fits on top of it
// before the first pod hits Tmax: that is tau_max, and alpha = tau_max / I. With full gimbals the
// allocator may vector, so the whole thrust sphere counts. With pods locked near body-up (QUAD) only
// the vertical share is real, it can never go negative (a pod cannot pull), and any sideways share is
// limited by how far the pods may lean. Ship-sized drones have big inertia, so this matters: it is
// what the attitude loop below plans its braking around.
function alphaLimits(af, tiltMax, out) {
  const P = af.P, T = af.Tmax, W = af.mass * G, axes = ['x', 'y', 'z'];
  for (let k = 0; k < 3; k++) {
    let sMax = Infinity;
    for (let i = 0; i < 4; i++) {
      const r0 = (3 * i) * 6, r1 = (3 * i + 1) * 6, r2 = (3 * i + 2) * 6;
      const ax = P[r0 + 1] * W, ay = P[r1 + 1] * W, az = P[r2 + 1] * W;     // this pod's share of the weight
      const bx = P[r0 + 3 + k], by = P[r1 + 3 + k], bz = P[r2 + 3 + k];     // ...and of one N m about axis k
      let sv;
      if (tiltMax < Math.PI - 1e-6) {
        sv = Infinity;
        if (by > 1e-12) sv = Math.min(sv, (T - ay) / by);
        else if (by < -1e-12) sv = Math.min(sv, ay / -by);
        const bh = Math.hypot(bx, bz);
        if (bh > 1e-12) sv = Math.min(sv, ay * Math.tan(tiltMax) / bh);
      } else sv = maxScaleOpen(ax, ay, az, bx, by, bz, T);
      sMax = Math.min(sMax, sv);
    }
    out[axes[k]] = isFinite(sMax) ? sMax / af.I[axes[k]] : 1e3;
  }
  return out;
}

// SQUARE-ROOT SHAPING (time-optimal braking). A plain P loop on attitude asks for a turn rate
// proportional to the error, and a heavy airframe at its torque limit cannot brake from that rate in
// the angle left, so it sails past (measured on the 6.4 m VORTEX drone: a 60 deg QUAD lean peaked at
// 67, a 70 deg pitch-up at 89). Instead ask for the fastest rate it can still stop from:
// w = sqrt(2 alpha |e|), which is exactly the constant-deceleration profile, blended into the linear
// law near zero (at e_lin = alpha / K^2 the two meet with the same value) so small errors stay smooth.
function sqrtShape(e, K, alpha, wmax) {
  const ae = Math.abs(e), eLin = alpha / (K * K);
  let w = (ae <= eLin) ? K * ae : Math.sqrt(2 * alpha * (ae - eLin / 2));
  if (w > wmax) w = wmax;
  return e < 0 ? -w : w;
}

// Prioritised allocation. tau, Fg, Fc are BODY-frame {x,y,z}; writes 12 numbers into u and the three
// layer scales into sat. Returns u.
const _uT = new Float64Array(12), _uG = new Float64Array(12), _uC = new Float64Array(12);
function allocate(a, tau, Fg, Fc, u, sat) {
  const P = a.P, Tmax = a.Tmax;
  for (let r = 0; r < 12; r++) {
    const o = r * 6;
    _uT[r] = P[o + 3] * tau.x + P[o + 4] * tau.y + P[o + 5] * tau.z;
    _uG[r] = P[o] * Fg.x + P[o + 1] * Fg.y + P[o + 2] * Fg.z;
    _uC[r] = P[o] * Fc.x + P[o + 1] * Fc.y + P[o + 2] * Fc.z;
  }
  // 1. attitude: cap any pod's torque share at 90% of Tmax so weight support is never starved to zero
  let s1 = 1;
  for (let i = 0; i < 4; i++) {
    const n = Math.hypot(_uT[3 * i], _uT[3 * i + 1], _uT[3 * i + 2]);
    if (n > 0.9 * Tmax) s1 = Math.min(s1, 0.9 * Tmax / n);
  }
  // 2. weight support on top of it
  let s2 = 1;
  for (let i = 0; i < 4; i++) {
    const j = 3 * i;
    s2 = Math.min(s2, maxScale(s1 * _uT[j], s1 * _uT[j + 1], s1 * _uT[j + 2], _uG[j], _uG[j + 1], _uG[j + 2], Tmax));
  }
  // 3. manoeuvre with what is left
  let s3 = 1;
  for (let i = 0; i < 4; i++) {
    const j = 3 * i;
    s3 = Math.min(s3, maxScale(s1 * _uT[j] + s2 * _uG[j], s1 * _uT[j + 1] + s2 * _uG[j + 1], s1 * _uT[j + 2] + s2 * _uG[j + 2],
                               _uC[j], _uC[j + 1], _uC[j + 2], Tmax));
  }
  for (let r = 0; r < 12; r++) u[r] = s1 * _uT[r] + s2 * _uG[r] + s3 * _uC[r];
  if (sat) { sat.att = s1; sat.grav = s2; sat.cmd = s3; }
  return u;
}

// Keep a desired aim inside what the gimbal may do (in place, d is unit, body frame).
//  (a) tilt cone about body up (QUAD mode locks the pods to within ~10 degrees of up)
//  (b) exhaust keep-out: thrust may not point within acos(keepCos) of the arm's OUTWARD direction,
//      because the exhaust (which leaves opposite to the thrust) would then blast the arm and body
function constrainAim(d, radial, tiltMax, keepCos) {
  if (tiltMax < Math.PI - 1e-6) {
    const cosT = Math.cos(tiltMax);
    if (d.y < cosT) {
      let hx = d.x, hz = d.z, hl = Math.hypot(hx, hz);
      if (hl < 1e-6) { hx = radial.x; hz = radial.z; hl = 1; }
      const s = Math.sin(tiltMax);
      d.x = hx / hl * s; d.y = cosT; d.z = hz / hl * s;
    }
  }
  const dr = d.x * radial.x + d.y * radial.y + d.z * radial.z;
  if (dr > keepCos) {
    let px = d.x - dr * radial.x, py = d.y - dr * radial.y, pz = d.z - dr * radial.z;
    let pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-6) { px = 0; py = 1; pz = 0; pl = 1; }
    const s = Math.sqrt(1 - keepCos * keepCos);
    d.x = radial.x * keepCos + px / pl * s;
    d.y = radial.y * keepCos + py / pl * s;
    d.z = radial.z * keepCos + pz / pl * s;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------
// POD STATE + SLEW. qp is the pod's full orientation in the BODY frame (identity = thrust along body
// +Y, exhaust down). d is derived from it every step, so aim and twist can never drift apart.
const _UP = V(0, 1, 0);
function newPod() {
  return { qp: Q(), d: V(0, 1, 0), T: 0, f: V(0, 0, 0), wg: V(0, 0, 0), slew: 0 };
}
const _sq = Q(), _st = V();
// Rotate pod toward unit aim t by at most maxAng (shortest arc), premultiplied in the body frame.
function slewPod(pod, t, maxAng, dt, radial) {
  const d = pod.d;
  let cx = d.y * t.z - d.z * t.y, cy = d.z * t.x - d.x * t.z, cz = d.x * t.y - d.y * t.x;
  const sl = Math.sqrt(cx * cx + cy * cy + cz * cz), dt_ = d.x * t.x + d.y * t.y + d.z * t.z;
  const ang = Math.atan2(sl, dt_);
  if (ang < 1e-6) { vset(pod.wg, 0, 0, 0); pod.slew = 0; return; }
  if (sl < 1e-9) {
    // Exactly opposite, so every great circle is a shortest arc. Pick the one that pivots about the
    // ARM axis (made perpendicular to d): it swings the aim sideways, through the tangential
    // direction, and never sweeps the exhaust across the arm or the body.
    const rd = radial.x * d.x + radial.y * d.y + radial.z * d.z;
    cx = radial.x - rd * d.x; cy = radial.y - rd * d.y; cz = radial.z - rd * d.z;
    let cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cl < 1e-6) { cx = radial.z; cy = 0; cz = -radial.x; cl = Math.hypot(cx, cz) || 1; }
    cx /= cl; cy /= cl; cz /= cl;
  } else { cx /= sl; cy /= sl; cz /= sl; }
  const step = Math.min(ang, maxAng);
  qaxisAngle(_sq, cx, cy, cz, step);
  qnormalize(qmul(pod.qp, _sq, pod.qp));
  qrot(pod.d, pod.qp, _UP);
  const k = step / Math.max(dt, 1e-6);
  vset(pod.wg, cx * k, cy * k, cz * k);
  pod.slew = k;
}

// ---------------------------------------------------------------------------------------------------
// THE DRONE (rigid body + pods). p, v in WORLD (m, m/s); q body->world; w body rates (rad/s).
class Drone {
  constructor(spec) {
    this.p = V(); this.v = V(); this.q = Q(); this.w = V();
    this.pods = [newPod(), newPod(), newPod(), newPod()];
    this.u = new Float64Array(12);
    this.sat = { att: 1, grav: 1, cmd: 1 };
    this.force = V();          // last net force (world), for HUD/tests
    this.thrust = V();         // last total thrust (world)
    this.power = 0;            // W, ideal momentum-theory power across the pods
    this.impact = 0;           // largest contact approach speed this step (m/s)
    this.contacts = 0;
    this.configure(spec);
  }
  configure(spec) {
    this.spec = Object.assign({}, this.spec || {}, spec);
    this.af = airframe(this.spec);
  }
  setPodType(key) { this.configure({ podType: key }); }
  reset(x, y, z, yaw) {
    vset(this.p, x || 0, y || 0, z || 0); vset(this.v, 0, 0, 0); vset(this.w, 0, 0, 0);
    qYXZ(this.q, yaw || 0, 0, 0);
    for (const pd of this.pods) { qcopy(pd.qp, Q()); vset(pd.d, 0, 1, 0); pd.T = 0; vset(pd.wg, 0, 0, 0); pd.slew = 0; }
  }
  // One physics step. cmd = { tau, Fg, Fc (body), tiltMax, armed }. env = { wind?, ground?(x,z) -> y, integrate? }
  step(dt, cmd, env) {
    const a = this.af, pt = a.podType, m = a.mass;
    const armed = !!(cmd && cmd.armed);
    if (armed) allocate(a, cmd.tau, cmd.Fg, cmd.Fc, this.u, this.sat);
    else { this.u.fill(0); this.sat.att = this.sat.grav = this.sat.cmd = 1; }
    const tiltMax = armed ? ((cmd.tiltMax != null) ? cmd.tiltMax : Math.PI) : 0;
    const maxAng = (armed ? a.slew : a.slew * 0.25) * dt;   // disarmed pods drift home slowly
    // ---- pods: aim, slew, throttle, spool ----
    for (let i = 0; i < 4; i++) {
      const pod = this.pods[i], cp = a.pods[i], j = 3 * i;
      vset(pod.f, this.u[j], this.u[j + 1], this.u[j + 2]);
      const fl = vlen(pod.f);
      if (armed && fl > 1e-3 * a.Tmax) vscale(_st, pod.f, 1 / fl);
      else if (!armed) vset(_st, 0, 1, 0);
      else vcopy(_st, pod.d);
      constrainAim(_st, cp.radial, tiltMax, a.keepCos);
      slewPod(pod, _st, maxAng, dt, cp.radial);
      // a slew may cut through the keep-out cone; push the pod back out to its edge
      const dr = vdot(pod.d, cp.radial);
      if (dr > a.keepCos + 1e-4) {
        vcopy(_st, pod.d); constrainAim(_st, cp.radial, Math.PI, a.keepCos);
        slewPod(pod, _st, Math.PI, dt, cp.radial);
      }
      const Tcmd = armed ? clamp(vdot(pod.f, pod.d), 0, a.Tmax) : 0;
      const tau = (Tcmd > pod.T) ? pt.tauUp : pt.tauDown;
      pod.T += (Tcmd - pod.T) * (1 - Math.exp(-dt / tau));
    }
    // ---- forces (world) and torques (body) ----
    const F = this.force, tq = _tq, tb = _tb;
    vset(F, 0, 0, 0); vset(tq, 0, 0, 0); vset(this.thrust, 0, 0, 0);
    let power = 0;
    const podArea = Math.PI * a.podR * a.podR;
    for (let i = 0; i < 4; i++) {
      const pod = this.pods[i], cp = a.pods[i];
      let T = pod.T;
      // Ground effect: the exhaust cushions off the ground under it (classic 1/(1-(R/4z)^2)), only
      // for the part of the thrust that is actually pointing up and only within a few pod radii.
      if (env && env.ground && T > 0) {
        qrot(_tb, this.q, cp.r); const wx = this.p.x + _tb.x, wy = this.p.y + _tb.y, wz = this.p.z + _tb.z;
        qrot(_tb, this.q, pod.d);
        const up = _tb.y;
        if (up > 0) {
          const z = Math.max(0.15 * a.podR, wy - env.ground(wx, wz));
          const k = (a.podR / (4 * z)); const k2 = k * k;
          if (k2 < 0.8) T *= 1 + pt.ge * up * up * Math.min(0.35, k2 / (1 - k2));
        }
      }
      vscale(tb, pod.d, T);                                   // thrust vector, body
      vadd(this.thrust, this.thrust, tb);
      vcross(_tc, cp.r, tb); vadd(tq, tq, _tc);               // r x f
      if (a.kq) vmad(tq, pod.d, -cp.spin * a.kq * T);         // rotor reaction torque
      if (a.rotorH) {                                         // gyroscopic precession, -(w_pod x h)
        const H = cp.spin * a.rotorH * Math.sqrt(Math.max(0, T) / a.Tmax);
        vadd(_tc, this.w, pod.wg); vcross(_tc, _tc, pod.d);
        vmad(tq, _tc, -H);
      }
      power += Math.pow(Math.max(0, T), 1.5) / Math.sqrt(2 * RHO * podArea);
    }
    this.power = power;
    qrot(F, this.q, this.thrust);
    F.y -= m * G;
    // quadratic drag, anisotropic in the body frame
    vcopy(_va, this.v); if (env && env.wind) vsub(_va, _va, env.wind);
    const sp = vlen(_va);
    if (sp > 1e-4) {
      qrotInv(_vb, this.q, _va);
      const k = -0.5 * RHO * sp;
      vset(_vb, k * a.cdA.x * _vb.x, k * a.cdA.y * _vb.y, k * a.cdA.z * _vb.z);
      qrot(_vb, this.q, _vb); vadd(F, F, _vb);
    }
    vmad(tq, this.w, -a.angDamp);
    // ---- simple ground contact (standalone/Node only; the game uses its own collision) ----
    this.impact = 0; this.contacts = 0;
    if (env && env.ground && env.contact !== false) this._groundContact(env, F, tq);
    // ---- integrate (semi-implicit Euler) ----
    vmad(this.v, F, dt / m);
    if (!env || env.integrate !== false) vmad(this.p, this.v, dt);
    const I = a.I, w = this.w;
    const hx = I.x * w.x, hy = I.y * w.y, hz = I.z * w.z;   // I w
    const gx = w.y * hz - w.z * hy, gy = w.z * hx - w.x * hz, gz = w.x * hy - w.y * hx;   // w x Iw
    w.x += (tq.x - gx) / I.x * dt; w.y += (tq.y - gy) / I.y * dt; w.z += (tq.z - gz) / I.z * dt;
    qintegrate(this.q, w, dt);
  }
  // Ground plane / heightfield contact at the four pods and two skids, spring-damper + friction.
  _groundContact(env, F, tq) {
    const a = this.af;
    const pts = this._cpts || (this._cpts = [
      ...a.pods.map(p => ({ r: V(p.r.x, p.r.y - a.podR * 0.6, p.r.z) })),
      { r: V(0, -a.podR * 1.1, -a.podR) }, { r: V(0, -a.podR * 1.1, a.podR) },
    ]);
    const k = 900 * a.mass, c = 2 * 0.9 * Math.sqrt(k * a.mass) / 2.4, mu = 0.9;
    qrot(_wq, this.q, this.w);                                // body rates in world
    for (const cp of pts) {
      qrot(_rr, this.q, cp.r);
      const px = this.p.x + _rr.x, py = this.p.y + _rr.y, pz = this.p.z + _rr.z;
      const pen = env.ground(px, pz) - py;
      if (pen <= 0) continue;
      this.contacts++;
      vcross(_pv, _wq, _rr); vadd(_pv, _pv, this.v);        // contact point velocity
      if (-_pv.y > this.impact) this.impact = -_pv.y;
      const fn = Math.max(0, k * pen - c * _pv.y);
      const tl = Math.hypot(_pv.x, _pv.z);
      const ft = tl > 1e-6 ? Math.min(mu * fn, c * tl) / tl : 0;
      vset(_cf, -_pv.x * ft, fn, -_pv.z * ft);
      vadd(F, F, _cf);
      vcross(_cf, _rr, _cf); qrotInv(_cf, this.q, _cf); vadd(tq, tq, _cf);
    }
  }
}
const _tq = V(), _tb = V(), _tc = V(), _va = V(), _vb = V(), _wq = V(), _rr = V(), _pv = V(), _cf = V();

// ---------------------------------------------------------------------------------------------------
// FLIGHT CONTROLLER. The pilot never touches a pod. They state an INTENT and the firmware turns it
// into a force and a torque; allocation turns those into four thrust vectors.
//
// intent = {
//   mode  : 'hover' | 'free' | 'quad'
//   vCmd  : {x,y,z}  velocity the pilot is asking for, WORLD, m/s ({0,0,0} = stop and hold here)
//   yaw   : heading the body should face, rad (three.js yaw)
//   look  : {x,y,z,w} full look attitude (FREE mode turns the body to it)
//   aMax  : { h, up, down } manoeuvre acceleration caps, m/s^2 (optional)
//   armed : bool
// }
//   HOVER : body stays LEVEL and faces `yaw`; every push is vectored. Translation never tilts it.
//   FREE  : body turns to `look` (pitch too) and still translates however the pilot asks.
//   QUAD  : pods locked near body-up, so the controller does what a quadcopter must: tilt the
//           whole body toward the acceleration it wants and ride the collective.
const MODES = ['hover', 'free', 'quad'];
const MODE_LABEL = { hover: 'HOVER', free: '6DOF', quad: 'QUAD' };
class Controller {
  constructor(drone) {
    this.drone = drone;
    this.qd = Q();             // desired attitude (world)
    this.vI = V();             // velocity-loop integral, m/s^2 (world): soaks up wind / mass error
    this.holdOn = false; this.holdP = V(); this.idleT = 0;
    this.vErr = V(); this.aCmd = V();
    this.wCmd = V();
    this.out = { tau: V(), Fg: V(), Fc: V(), tiltMax: Math.PI, armed: false };
    this.gain = {
      att: V(7, 6, 7),         // attitude P, rad/s per rad (x pitch, y yaw, z roll, body)
      rate: V(16, 12, 16),     // rate P, 1/s
      rateMax: V(4.5, 3.5, 4.5),
      kv: 3.2,                 // velocity P, 1/s
      ki: 2.5,                 // velocity I, 1/s^2. The cascade's slow pole sits near -ki/kv, so keep
                               // ki near kv^2/4 (critically damped velocity PI): 1.6 left a 2 s creep
      iMax: 6,                 // m/s^2
      iBand: 1.5,              // m/s, the integral only runs inside this velocity error
      kp: 1.4,                 // position-hold P, 1/s
      holdVmax: 4,             // m/s
      quadTilt: 0.80,          // rad, how far QUAD mode may lean (46 deg)
      quadPodTilt: 0.16,       // rad, the pod lock in QUAD mode (9 deg, enough for yaw)
      alphaUse: 0.5,           // plan braking on half the angular acceleration the airframe has, so the
                               // other half stays free for holding altitude and translating
      planTilt: 1.0,           // rad, the pod lean the attitude planner may count on (no flips)
      lead: 0.06,              // s, how far ahead the attitude planner looks (rate-loop + spool lag)
    };
    this.alpha = V(); this._aAf = null; this._aTilt = -1;
  }
  reset() {
    qcopy(this.qd, this.drone.q); vset(this.vI, 0, 0, 0); this.holdOn = false; this.idleT = 0;
    vcopy(this.wCmd, this.drone.w);
  }
  update(dt, it) {
    const d = this.drone, a = d.af, m = a.mass, o = this.out, g = this.gain;
    o.armed = !!it.armed;
    if (!o.armed) {
      vset(o.tau, 0, 0, 0); vset(o.Fg, 0, 0, 0); vset(o.Fc, 0, 0, 0);
      vset(this.vI, 0, 0, 0); qcopy(this.qd, d.q); this.holdOn = false; vcopy(this.wCmd, d.w);
      return o;
    }
    const mode = it.mode || 'hover';
    // ---- velocity loop (world) ----
    const vc = _vc; vcopy(vc, it.vCmd || _ZERO);
    const idle = vlen(vc) < 0.05;
    if (idle) {
      this.idleT += dt;
      if (!this.holdOn && this.idleT > 0.2 && vlen(d.v) < 3) {
        // hold where it will come to rest, not where the stick was released
        this.holdOn = true; vcopy(this.holdP, d.p); vmad(this.holdP, d.v, 1 / g.kv);
      }
    } else { this.idleT = 0; this.holdOn = false; }
    if (this.holdOn && it.hold !== false) {
      vsub(_tmp, this.holdP, d.p); vscale(_tmp, _tmp, g.kp);
      const l = vlen(_tmp); if (l > g.holdVmax) vscale(_tmp, _tmp, g.holdVmax / l);
      vadd(vc, vc, _tmp);
    }
    vsub(this.vErr, vc, d.v);
    const ac = this.aCmd;
    vscale(ac, this.vErr, g.kv);
    vadd(ac, ac, this.vI);
    // drag feed-forward: the firmware knows its own airframe (not the wind; the integral gets that)
    { const sp = vlen(d.v);
      if (sp > 1e-3) {
        qrotInv(_tmp, d.q, d.v); const k = 0.5 * RHO * sp / m;
        vset(_tmp, k * a.cdA.x * _tmp.x, k * a.cdA.y * _tmp.y, k * a.cdA.z * _tmp.z);
        qrot(_tmp, d.q, _tmp); vadd(ac, ac, _tmp);
      } }
    const am = it.aMax || _AMAX;
    { const hl = Math.hypot(ac.x, ac.z); if (hl > am.h) { ac.x *= am.h / hl; ac.z *= am.h / hl; } }
    ac.y = clamp(ac.y, -am.down, am.up);
    // Integrate only while the allocator had room AND the error is small. The integral exists for
    // steady disturbances (wind, payload, a mass the firmware got wrong). Letting it run during a
    // big commanded change winds it up and every hard stop or launch overshoots (measured: 14.4 m/s
    // on a 14 m/s command before this gate, 3% for 2 s).
    if (d.sat.cmd > 0.98 && d.sat.grav > 0.98 && vlen(this.vErr) < g.iBand) {
      vmad(this.vI, this.vErr, g.ki * dt);
      const il = vlen(this.vI); if (il > g.iMax) vscale(this.vI, this.vI, g.iMax / il);
    }
    // ---- attitude target ----
    const qd = this.qd;
    o.tiltMax = Math.PI;
    if (mode === 'free' && it.look) {
      qcopy(qd, it.look);
    } else if (mode === 'quad') {
      // QUAD: the thrust axis IS the body up axis, so point the body along the force we need.
      vset(_fw, m * ac.x, m * (ac.y + G), m * ac.z);
      if (_fw.y < 0.25 * m * G) _fw.y = 0.25 * m * G;
      const tmax = Math.tan(g.quadTilt), hl = Math.hypot(_fw.x, _fw.z);
      if (hl > _fw.y * tmax) { const s = _fw.y * tmax / hl; _fw.x *= s; _fw.z *= s; }
      vnorm(_yb, _fw);
      const yaw = (it.yaw != null) ? it.yaw : headingOf(d.q);
      vset(_xh, Math.cos(yaw), 0, -Math.sin(yaw));                 // heading's right vector
      vcross(_zb, _xh, _yb); vnorm(_zb, _zb);                      // body back axis
      vcross(_xb, _yb, _zb);
      qFromAxes(qd, _xb, _yb, _zb);
      o.tiltMax = g.quadPodTilt;
    } else {
      qYXZ(qd, (it.yaw != null) ? it.yaw : headingOf(d.q), 0, 0);
    }
    // ---- attitude loop: error quaternion (body) -> rate command -> torque ----
    qconj(_qe, d.q); qmul(_qe, _qe, qd); qToRotVec(_e, _qe);
    const wc = this.wCmd;
    // Plan on the torque the pods can make WITHOUT FLIPPING (leaning at most ~57 deg off body-up). With
    // full gimbals the allocator could also flip pods over to push DOWN on one side, which on paper
    // doubles the torque, but a flip is a 100-180 deg swing (~0.3 s at slew rate) each way: planned on,
    // the torque arrives late and the brake later still (traced: a 70 deg pitch-up overshot to 88).
    const tPlan = Math.min(o.tiltMax, g.planTilt);
    if (this._aAf !== a || this._aTilt !== tPlan) { alphaLimits(a, tPlan, this.alpha); this._aAf = a; this._aTilt = tPlan; }
    const al = this.alpha, au = g.alphaUse;
    // The commanded rate is the braking-safe sqrt profile, ramped at the same budget so the rate loop
    // never asks for a step it can only meet by saturating.
    // ...and it plans on the error a lag AHEAD (e - w * lead): the real rate trails the command by the
    // rate loop and the spool, so braking from the present error starts that much too late.
    const rx = al.x * au * dt, ry = al.y * au * dt, rz = al.z * au * dt, ld = g.lead, w0 = d.w;
    wc.x = clamp(sqrtShape(_e.x - w0.x * ld, g.att.x, al.x * au, g.rateMax.x), wc.x - rx, wc.x + rx);
    wc.y = clamp(sqrtShape(_e.y - w0.y * ld, g.att.y, al.y * au, g.rateMax.y), wc.y - ry, wc.y + ry);
    wc.z = clamp(sqrtShape(_e.z - w0.z * ld, g.att.z, al.z * au, g.rateMax.z), wc.z - rz, wc.z + rz);
    const w = d.w, I = a.I;
    const hx = I.x * w.x, hy = I.y * w.y, hz = I.z * w.z;
    o.tau.x = I.x * g.rate.x * (wc.x - w.x) + (w.y * hz - w.z * hy);
    o.tau.y = I.y * g.rate.y * (wc.y - w.y) + (w.z * hx - w.x * hz);
    o.tau.z = I.z * g.rate.z * (wc.z - w.z) + (w.x * hy - w.y * hx);
    // ---- forces, split by priority, into the BODY frame ----
    if (mode === 'quad') {
      // collective only: project the force we want onto where body-up actually points right now
      qrot(_tmp, d.q, _UP);
      vset(_fw, m * ac.x, m * (ac.y + G), m * ac.z);
      const col = Math.max(0, vdot(_fw, _tmp));
      vset(o.Fg, 0, col, 0); vset(o.Fc, 0, 0, 0);
    } else {
      vset(_tmp, 0, m * G, 0); qrotInv(o.Fg, d.q, _tmp);
      vscale(_tmp, ac, m);     qrotInv(o.Fc, d.q, _tmp);
    }
    return o;
  }
}
const _vc = V(), _tmp = V(), _fw = V(), _yb = V(), _xb = V(), _zb = V(), _xh = V(), _qe = Q(), _e = V();
const _ZERO = V(), _AMAX = { h: 25, up: 18, down: 14 };

// Advance drone + controller by `dt`, in fixed substeps (default <= 1/400 s). Returns the drone.
function fly(drone, ctrl, intent, env, dt, hMax) {
  const h = hMax || (1 / 400);
  const n = Math.max(1, Math.ceil(dt / h));
  const sh = dt / n;
  for (let i = 0; i < n; i++) drone.step(sh, ctrl.update(sh, intent), env);
  return drone;
}

// ---------------------------------------------------------------------------------------------------
// VISUAL ALLOCATION for drones we only SEE (bots, other players): we know how they moved, not what
// their firmware asked for. Their acceleration a (world) tells us the force they must have made,
// F = m (a + g up) minus drag, so run the same allocator on it and the gimbals point where that
// airframe's pods really would. q is the body attitude (world). Writes 12 numbers into u.
const _vf = V(), _vfb = V(), _vz = V(0, 0, 0);
function visualPods(af, q, aWorld, vWorld, u, sat) {
  vset(_vf, af.mass * aWorld.x, af.mass * (aWorld.y + G), af.mass * aWorld.z);
  if (vWorld) {
    const sp = vlen(vWorld);
    if (sp > 1e-3) {
      qrotInv(_vfb, q, vWorld); const k = 0.5 * RHO * sp;
      vset(_vfb, k * af.cdA.x * _vfb.x, k * af.cdA.y * _vfb.y, k * af.cdA.z * _vfb.z);
      qrot(_vfb, q, _vfb); vadd(_vf, _vf, _vfb);
    }
  }
  qrotInv(_vfb, q, _vf);
  return allocate(af, _vz, _vfb, _vz, u, sat);
}

const GD = {
  G, RHO, U: 25, POD_TYPES, MODES, MODE_LABEL,
  V, Q, vset, vcopy, vadd, vsub, vscale, vmad, vdot, vlen, vcross, vnorm,
  qcopy, qmul, qconj, qnormalize, qrot, qrotInv, qaxisAngle, qYXZ, qToRotVec, qintegrate, qFromAxes, headingOf,
  airframe, allocationMatrix, allocate, maxScale, maxScaleOpen, alphaLimits, sqrtShape, constrainAim, slewPod, newPod,
  Drone, Controller, fly, visualPods,
};
root.GD = GD;
if (typeof module !== 'undefined' && module.exports) module.exports = GD;
})(typeof window !== 'undefined' ? window : globalThis);
