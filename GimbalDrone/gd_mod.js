// gd_mod.js : the GIMBAL DRONE mod for the GimbalDrone copy of Last Ship Sailing.
//
// Loaded as a classic <script> after gd_physics.js and before the engine. The engine is one big
// closure (_bootLSS), so it calls GDMod.install(ctx) near its top with lazy getters into that
// closure, and calls the hooks below from the handful of (GD)-tagged seams GimbalDrone/fork.py
// puts into the copy:
//
//   preloadShips()          every LSS chassis hull becomes a procedural gimbal drone
//   hoardProto(key)         ...and so does every campaign hoard hull
//   attachRig(group, key)   finds a built drone's gimbal rings, plasma cores and exhaust jets
//   animate(mesh, dt)       gimbals + jets move on EVERY drone on screen, every frame
//   moveBasis(f, r, u)      HOVER / QUAD fly the heading, 6DOF flies the look
//   flyPlayer(dt, ...)      the player's flight: LSS's velocity target in, physics out
//   poseHull(mesh)          the player's hull wears the drone's real (physical) attitude
//
// The physics itself is in gd_physics.js (pure, testable: node GimbalDrone/check_physics.mjs).
// Live knobs for tuning in the console: window.GDMod.mode / setMode / setPodType / gains / dump().
(function () {
'use strict';
const GD = window.GD;
if (!GD) { console.error('[GD] gd_physics.js did not load; the copy will fly like LSS.'); return; }
const U = GD.U;                         // game units per metre
let C = null;                           // engine context (lazy getters into _bootLSS)
let T = null;                           // THREE, resolved on first use

// ---------------------------------------------------------------------------------------------------
// SETTINGS (localStorage is namespaced to gd:* by the copy's head shim, so these never touch LSS)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} },
};
let mode = store.get('gd_mode', 'hover');
if (GD.MODES.indexOf(mode) < 0) mode = 'hover';
let podType = store.get('gd_pods', 'plasma');
if (!GD.POD_TYPES[podType]) podType = 'plasma';
const MODE_HELP = {
  hover: 'body stays level - the pods vector every push',
  free:  'body turns with your aim - still moves any way you push',
  quad:  'pods locked - it has to tilt to move, like a normal quadcopter',
};

// ---------------------------------------------------------------------------------------------------
// THE DRONE, in canonical units (about 1.7 across), NOSE +Z, up +Y: the LSS hull convention, which the
// engine turns to face the camera with a 180-degree flip. The physics body frame is the camera's
// (nose -Z), so mesh <-> body is that same flip: (x, y, z) <-> (-x, y, -z).
//
// Each pod is a little circumpunct: three nested rings around a glowing core.
//   mount  (fixed to the arm, local +X = the arm, pointing outward)
//   outer  ring, pivots on the ARM axis (X)                    rotation.x
//   middle ring, pivots on the tangential axis (Z), so the aim tilts radially   rotation.z
//   inner  ring, pivots on the THRUST axis (Y): the twist        rotation.y
//   core + nozzle + exhaust jet ride the inner ring; thrust is +Y, the jet streams out along -Y.
// Rest pose (all three angles 0) puts the rings in three perpendicular planes: XZ, YZ, XY.
const CANON = { a: 0.62, Ro: 0.24, Rm: 0.20, Ri: 0.165, tO: 0.019, tM: 0.016, tI: 0.014 };

function _mat(hex, o) {
  return new T.MeshStandardMaterial(Object.assign({ color: hex, metalness: 0.35, roughness: 0.5 }, o || {}));
}
function _keep(mesh) { mesh.userData.gdKeepMat = true; mesh.castShadow = false; return mesh; }

function buildDroneModel(accentHex, hullHex) {
  const root = new T.Group();
  root.name = 'gdDrone';
  const hull = _mat(hullHex != null ? hullHex : 0xc8cdd8);
  const dark = _mat(0x30353f, { metalness: 0.5, roughness: 0.45 });
  const glassDark = _mat(0x141a24, { metalness: 0.1, roughness: 0.15 });
  const accent = accentHex != null ? accentHex : 0x44eeff;
  const glow = new T.MeshStandardMaterial({ color: 0x111111, emissive: accent, emissiveIntensity: 1.6, metalness: 0, roughness: 0.4 });

  // ---- core body: a flattened lozenge with a dark dorsal canopy and a sensor eye on the nose ----
  const body = new T.Mesh(new T.SphereGeometry(1, 32, 18), hull);
  body.scale.set(0.30, 0.13, 0.46); root.add(body);
  const keel = new T.Mesh(new T.SphereGeometry(1, 24, 12), dark);
  keel.scale.set(0.22, 0.09, 0.36); keel.position.y = -0.06; root.add(keel);
  const canopy = new T.Mesh(new T.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassDark);
  canopy.scale.set(0.15, 0.08, 0.24); canopy.position.set(0, 0.09, 0.07); root.add(canopy);
  const eye = _keep(new T.Mesh(new T.SphereGeometry(0.045, 16, 10), glow));
  eye.position.set(0, 0.0, 0.455); root.add(eye);
  const tail = _keep(new T.Mesh(new T.BoxGeometry(0.16, 0.025, 0.02), glow));
  tail.position.set(0, 0.03, -0.455); root.add(tail);
  // landing skids
  for (const sx of [-1, 1]) {
    const rail = new T.Mesh(new T.BoxGeometry(0.03, 0.025, 0.62), dark);
    rail.position.set(sx * 0.17, -0.235, 0); root.add(rail);
    for (const sz of [-1, 1]) {
      const strut = new T.Mesh(new T.BoxGeometry(0.022, 0.13, 0.022), dark);
      strut.position.set(sx * 0.15, -0.17, sz * 0.2); strut.rotation.z = sx * 0.28; root.add(strut);
    }
  }
  // weapon muzzles + pilot eye markers (the engine finds these by name)
  for (const [n, x] of [['gun1', -0.09], ['gun2', 0.09]]) {
    const g = new T.Object3D(); g.name = n; g.position.set(x, -0.07, 0.43); root.add(g);
  }
  const eyeM = new T.Object3D(); eyeM.name = 'cockpit1'; eyeM.position.set(0, 0.11, 0.30);
  eyeM.rotation.y = Math.PI / 2;   // GLB marker convention: marker -X = forward (mesh +Z)
  root.add(eyeM);

  // ---- four arms and four gimbals ----
  const pods = [];
  const ringO = new T.TorusGeometry(CANON.Ro, CANON.tO, 8, 44); ringO.rotateX(Math.PI / 2);   // XZ plane
  const ringM = new T.TorusGeometry(CANON.Rm, CANON.tM, 8, 40); ringM.rotateY(Math.PI / 2);   // YZ plane
  const ringI = new T.TorusGeometry(CANON.Ri, CANON.tI, 8, 36);                               // XY plane
  const pinG = new T.CylinderGeometry(0.018, 0.018, 0.05, 10);
  const yokeG = new T.TorusGeometry(CANON.Ro + 0.045, 0.013, 6, 28, Math.PI);                 // upper half arc, XY
  const coreG = new T.SphereGeometry(0.062, 18, 12);
  const bellG = new T.CylinderGeometry(0.05, 0.085, 0.10, 18, 1, true);
  const capG = new T.CylinderGeometry(0.03, 0.05, 0.035, 14);
  const ringMat = [_mat(0x6d7482, { metalness: 0.6, roughness: 0.35 }), _mat(0xa7aebb, { metalness: 0.6, roughness: 0.3 }), _mat(accent, { metalness: 0.4, roughness: 0.35 })];
  const P = [[1, 1], [-1, 1], [-1, -1], [1, -1]];   // mesh space: FR, FL, RL, RR (nose +Z)
  for (let i = 0; i < 4; i++) {
    const px = P[i][0] * CANON.a, pz = P[i][1] * CANON.a;
    const yaw = Math.atan2(-pz, px);                  // mount +X = the arm, outward
    const mount = new T.Group(); mount.name = 'gdMount' + i;
    mount.position.set(px, 0, pz); mount.rotation.y = yaw; root.add(mount);
    // ⚠ Keep the yaw in userData, never read it back from mount.rotation.y: clone() rebuilds the Euler
    // from the quaternion, and a -135 deg yaw comes back as (180, -45, 180). Reading .y there posed the
    // two left pods' rings 90 deg wrong (caught by the ring-mapping check, not by eye).
    mount.userData.gdYaw = yaw;
    // the arm: from the body to the outer ring's inner pivot
    const rl = Math.hypot(px, pz), armIn = 0.20, armOut = rl - CANON.Ro - 0.03, armLen = armOut - armIn;
    const arm = new T.Mesh(new T.BoxGeometry(armLen, 0.05, 0.075), hull);
    arm.position.set(-(rl - (armIn + armLen / 2)), 0, 0); mount.add(arm);
    const armStripe = _keep(new T.Mesh(new T.BoxGeometry(armLen * 0.7, 0.008, 0.02), glow));
    armStripe.position.set(arm.position.x, 0.03, 0); mount.add(armStripe);
    // yoke: a half-ring over the top carrying both outer pivots, so the gimbal is held at both ends
    const yoke = new T.Mesh(yokeG, dark); mount.add(yoke);
    for (const sx of [-1, 1]) {
      const pin = new T.Mesh(pinG, dark); pin.rotation.z = Math.PI / 2;
      pin.position.set(sx * (CANON.Ro + 0.02), 0, 0); mount.add(pin);
    }
    // thruster marker: the engine hangs its class-coloured engine orb here
    const th = new T.Object3D(); th.name = 'thruster' + (i + 1); mount.add(th);
    // the three rings
    const outer = new T.Group(); outer.name = 'gdO' + i; mount.add(outer);
    outer.add(new T.Mesh(ringO, ringMat[0]));
    for (const sz of [-1, 1]) { const pin = new T.Mesh(pinG, dark); pin.rotation.x = Math.PI / 2; pin.position.set(0, 0, sz * (CANON.Rm + 0.012)); outer.add(pin); }
    const middle = new T.Group(); middle.name = 'gdM' + i; outer.add(middle);
    middle.add(new T.Mesh(ringM, ringMat[1]));
    for (const sy of [-1, 1]) { const pin = new T.Mesh(pinG, dark); pin.position.set(0, sy * (CANON.Ri + 0.012), 0); middle.add(pin); }
    const inner = new T.Group(); inner.name = 'gdI' + i; middle.add(inner);
    inner.add(new T.Mesh(ringI, ringMat[2]));
    // the thruster itself: glowing core, intake cap above, nozzle bell below
    const core = _keep(new T.Mesh(coreG, glow)); core.name = 'gdCore' + i; inner.add(core);
    const cap = new T.Mesh(capG, dark); cap.position.y = 0.075; inner.add(cap);
    const bell = new T.Mesh(bellG, dark); bell.position.y = -0.095; inner.add(bell);
    for (const sx of [-1, 1]) {   // struts from the inner ring to the core
      const s = new T.Mesh(new T.BoxGeometry(CANON.Ri - 0.06, 0.012, 0.012), dark);
      s.position.set(sx * (CANON.Ri / 2 + 0.03), 0, 0); inner.add(s);
    }
    pods.push({ mount, outer, middle, inner, px, pz, yaw });
  }
  root.userData.gdPods = pods;
  return root;
}

// The exhaust jet, added AFTER fitting so it does not stretch the hull's bounding box. Two nested
// additive cones streaming out of the nozzle along -Y; animate() scales them with thrust.
// A flat additive cone reads as a solid searchlight beam (it did, in the first lobby render), so the
// plume shader fades it along its length (hot at the nozzle, gone at the tip) and toward its silhouette
// edges, where the view grazes the surface.
const JET_VS = 'varying float vT; varying vec3 vN; varying vec3 vV;\n'
  + 'void main() { vT = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);\n'
  + '  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
const JET_FS = 'uniform vec3 uColor; uniform float uOpacity; varying float vT; varying vec3 vN; varying vec3 vV;\n'
  + 'void main() { float along = pow(clamp(1.0 - vT, 0.0, 1.0), 1.7);\n'
  + '  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);\n'
  + '  float a = uOpacity * along * edge; gl_FragColor = vec4(uColor * a, a); }';
function jetMaterial(hex, opacity) {
  return new T.ShaderMaterial({
    uniforms: { uColor: { value: new T.Color(hex) }, uOpacity: { value: opacity } },
    vertexShader: JET_VS, fragmentShader: JET_FS,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
  });
}
function addJets(root, accentHex) {
  // A cone's apex is +Y: flip it (apex -Y), then slide it down so the wide base sits at y=0 and the tip
  // trails off at y=-1. Hung at the nozzle exit, the jet streams out along -Y and tapers away.
  // (The cone's uv.y is 0 at its base and 1 at its apex, which is what the plume shader fades along.)
  const outerG = new T.ConeGeometry(0.075, 1, 20, 1, true); outerG.rotateX(Math.PI); outerG.translate(0, -0.5, 0);
  const innerG = new T.ConeGeometry(0.038, 1, 14, 1, true); innerG.rotateX(Math.PI); innerG.translate(0, -0.5, 0);
  const cOut = new T.Color(accentHex != null ? accentHex : 0x44eeff).lerp(new T.Color(0xffffff), 0.1);
  const mOut = jetMaterial(cOut, 0.85);
  const mIn = jetMaterial(new T.Color(0xeafcff), 1.0);
  for (let i = 0; i < 4; i++) {
    const inner = root.getObjectByName('gdI' + i);
    if (!inner) continue;
    const jet = new T.Group(); jet.name = 'gdJet' + i; jet.position.y = -0.145;
    const o = _keep(new T.Mesh(outerG, mOut)); o.renderOrder = 3; jet.add(o);
    const c = _keep(new T.Mesh(innerG, mIn)); c.renderOrder = 3; jet.add(c);
    jet.scale.set(0.8, 0.12, 0.8);   // rest pose for static copies (previews, thumbnails); animate() takes over in flight
    inner.add(jet);
  }
}

// Fit like preloadShipModels does a GLB: longest side -> target length, centred on the origin.
function fitProto(proto, targetLen) {
  const box = new T.Box3().setFromObject(proto);
  const sz = box.getSize(new T.Vector3());
  const longest = Math.max(sz.x, sz.y, sz.z) || 1;
  proto.scale.setScalar(targetLen / longest);
  proto.updateMatrixWorld(true);
  const box2 = new T.Box3().setFromObject(proto);
  proto.position.sub(box2.getCenter(new T.Vector3()));
  proto.updateMatrixWorld(true);
  proto.userData.bboxSize = box2.getSize(new T.Vector3());
}

// ---------------------------------------------------------------------------------------------------
// AIRFRAMES. Physics geometry comes straight from the fitted model (the torque arms you see are the
// ones that fly), converted to metres in the body frame. Agility is matched to the LSS chassis: its
// `acceleration` becomes the drone's horizontal manoeuvre limit and sets the thrust/weight ratio
// that can deliver it (a = g sqrt(TWR^2 - 1)), plus 15% headroom for attitude control.
const frames = {};   // key -> { af, spec, aH, accent }
function makeFrame(key, proto, accelU) {
  const s = proto.scale.x, o = proto.position, pods = proto.userData.gdPods;
  const posM = pods.map(p => GD.V(-(o.x + s * p.px) / U, o.y / U, -(o.z + s * p.pz) / U));
  const span = 2 * (CANON.a + CANON.Ro) * s / U;
  const aH = Math.max(8, (accelU || 800) / U);
  const twr = Math.min(6.5, Math.max(2.2, 1.15 * Math.sqrt((aH / GD.G) * (aH / GD.G) + 1)));
  const spec = {
    pods: posM, podR: CANON.Ro * s / U,
    mass: 25 * Math.pow(span / 3, 2.5),
    twr, core: GD.V(0.6 * s / U, 0.26 * s / U, 0.92 * s / U),
    cdA: GD.V(0.06 * span * span, 0.16 * span * span, 0.05 * span * span),
    podType,
  };
  const fr = { key, spec, af: GD.airframe(spec), aH, span };
  frames[key] = fr;
  return fr;
}
function frameFor(key) { return frames[key] || null; }

function accentFor(key) {
  try { const c = C.LSS && C.LSS.CLASS_COLORS && C.LSS.CLASS_COLORS[key]; if (c != null) return c; } catch (_) {}
  let h = 0; for (let i = 0; i < String(key).length; i++) h = (h * 31 + String(key).charCodeAt(i)) >>> 0;
  return new T.Color().setHSL((h % 360) / 360, 0.85, 0.55).getHex();
}

// ---------------------------------------------------------------------------------------------------
// PLAYER FLIGHT STATE
const pl = { drone: null, ctrl: null, key: null, lastT: 0, gpPrev: false, xrPrev: false, flying: false };
const ENV = { integrate: true, contact: false };
const _vc = GD.V(), _look = GD.Q(), _int = { mode: 'hover', vCmd: _vc, yaw: 0, look: _look, armed: true, aMax: { h: 25, up: 18, down: 14 } };

function seatDrone(fr, P) {
  const d = pl.drone || (pl.drone = new GD.Drone(fr.spec));
  if (d.spec !== fr.spec) d.configure(fr.spec);
  d.af = GD.airframe(Object.assign({}, fr.spec, { podType }));
  const yaw = (P.euler && P.euler.y) || 0;
  d.reset(P.position.x / U, P.position.y / U, P.position.z / U, yaw);
  GD.vset(d.v, P.velocity.x / U, P.velocity.y / U, P.velocity.z / U);
  for (const pod of d.pods) pod.T = d.af.mass * GD.G / 4;   // already spooled: no sag on spawn
  pl.ctrl = pl.ctrl || new GD.Controller(d);
  pl.ctrl.drone = d;
  pl.ctrl.gain.quadTilt = 1.05;   // a game quad leans further than a camera drone (60 deg)
  pl.ctrl.reset();
  pl.key = P.loadoutKey;
}

// ---------------------------------------------------------------------------------------------------
// GIMBAL POSING (shared by the player and every watched drone)
const _q3 = { a: null, b: null, e: null };
function poseRings(rig, pods, Tmax) {
  const q = _q3.a || (_q3.a = new T.Quaternion()), qm = _q3.b || (_q3.b = new T.Quaternion()), e = _q3.e || (_q3.e = new T.Euler());
  for (let i = 0; i < 4; i++) {
    const r = rig.pods[i], pq = pods[i].qp;
    // body -> mesh frame is conjugation by the 180-degree Y flip: axis (x,y,z) -> (-x,y,-z)
    q.set(-pq.x, pq.y, -pq.z, pq.w);
    qm.setFromAxisAngle(_Y3 || (_Y3 = new T.Vector3(0, 1, 0)), r.yaw).invert();
    qm.multiply(q);                                 // pod orientation relative to its mount
    e.setFromQuaternion(qm, 'XZY');                 // outer (X) . middle (Z) . inner (Y)
    r.outer.rotation.x = e.x; r.middle.rotation.z = e.z; r.inner.rotation.y = e.y;
    const f = Math.max(0, Math.min(1.3, pods[i].T / Tmax));
    if (r.jet) {
      // full thrust streams about half a drone-span (the hull is ~1.8 canonical units across)
      const flick = 1 + 0.06 * Math.sin(_time * 41 + i * 1.7) + 0.04 * Math.sin(_time * 67 + i);
      r.jet.scale.set(0.8 + 0.35 * f, (0.10 + 0.62 * f) * flick, 0.8 + 0.35 * f);
      r.jet.visible = f > 0.01;
      for (const m of r.jetMats) {
        const k = (m.userData.gdBaseOp || 0.8) * Math.min(1, 0.3 + 1.0 * f);
        if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = k; else m.opacity = k;
      }
    }
    if (r.coreMat) r.coreMat.emissiveIntensity = 0.5 + 2.2 * Math.min(1, f);
  }
}
let _Y3 = null, _time = 0;

// ---------------------------------------------------------------------------------------------------
// HUD: a small instrument in the corner. The four pods drawn top-down (nose up), each with its thrust
// vector: the arrow is the sideways part, the filled disc the vertical part (hollow = pushing DOWN).
const hud = { cv: null, ctx: null, t: 0, vis: false, visT: 0, btn: null, toast: null, toastT: 0 };
function hudEnsure() {
  if (hud.cv) return;
  const cv = document.createElement('canvas');
  cv.id = 'gd-hud';
  cv.width = 440; cv.height = 300;
  // ⚠ top/left MUST be set (to auto): on touch devices LSS pins EVERY <canvas> with
  // `html.lss-touch canvas { position: fixed; top: 0; left: 0 }`, and with top and bottom both set the
  // browser keeps top, which dragged this instrument into the top-left corner over the touch buttons.
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const w = touch ? 180 : 220;
  cv.style.cssText = 'position:fixed;top:auto;left:auto;right:14px;bottom:14px;width:' + w + 'px;height:' + Math.round(w * 300 / 440) + 'px;'
    + 'z-index:12;pointer-events:none;display:none;';
  document.body.appendChild(cv);
  hud.cv = cv; hud.ctx = cv.getContext('2d');
  const toast = document.createElement('div');
  toast.id = 'gd-toast';
  toast.style.cssText = 'position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:13;pointer-events:none;'
    + 'font-family:Orbitron,Rajdhani,sans-serif;color:#bff6ff;text-align:center;text-shadow:0 0 12px rgba(0,200,255,.6),0 2px 3px #000;'
    + 'opacity:0;transition:opacity .35s;letter-spacing:.12em;';
  document.body.appendChild(toast);
  hud.toast = toast;
  if ((navigator.maxTouchPoints || 0) > 0) {
    const b = document.createElement('button');
    b.id = 'gd-mode-btn'; b.textContent = 'MODE';
    b.style.cssText = 'position:fixed;right:14px;bottom:' + (Math.round(w * 300 / 440) + 24) + 'px;z-index:12;display:none;padding:10px 14px;border-radius:10px;'
      + 'background:rgba(80,200,255,.18);border:1.5px solid rgba(140,230,255,.65);color:#d7f5ff;font:600 13px Orbitron,sans-serif;letter-spacing:.1em;touch-action:manipulation;';
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); cycleMode(); }, { passive: false });
    document.body.appendChild(b);
    hud.btn = b;
  }
}
function toast(big, small) {
  hudEnsure();
  hud.toast.innerHTML = '<div style="font-size:26px;font-weight:700">' + big + '</div>' + (small ? '<div style="font-family:Rajdhani,sans-serif;font-size:16px;margin-top:4px;letter-spacing:.06em">' + small + '</div>' : '');
  hud.toast.style.opacity = '1';
  hud.toastT = 2.4;
}
function lssHudVisible() {
  const h = document.getElementById('hud');
  if (!h) return true;
  try { return getComputedStyle(h).display !== 'none' && getComputedStyle(h).visibility !== 'hidden'; } catch (_) { return true; }
}
// In VR the DOM is invisible, so the same canvas is shown on a small panel parented to the engine's
// xrDolly (the rig that carries the ship; LSS hangs its own VR HUD and the controllers there too). It
// sits low and to the right like a cockpit instrument, so it never rides on your head.
// Live knob: GDMod.vrPanel = { x, y, z, tilt, w }.
const vr = { mesh: null, tex: null };
function vrPanel(show) {
  let dolly = null;
  try { dolly = C.xrDolly; } catch (_) {}
  if (!dolly || !hud.cv) return;
  if (!vr.mesh) {
    vr.tex = new T.CanvasTexture(hud.cv);
    vr.tex.colorSpace = T.SRGBColorSpace; vr.tex.minFilter = T.LinearFilter;
    const mat = new T.MeshBasicMaterial({ map: vr.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    vr.mesh = new T.Mesh(new T.PlaneGeometry(1, 300 / 440), mat);
    vr.mesh.name = 'gdVrPanel'; vr.mesh.renderOrder = 9990; vr.mesh.frustumCulled = false;
    dolly.add(vr.mesh);
  }
  const P = GDMod.vrPanel;
  vr.mesh.position.set(P.x, P.y, P.z); vr.mesh.rotation.set(P.tilt, -0.35, 0); vr.mesh.scale.setScalar(P.w);
  vr.mesh.visible = !!show;
}
function hudTick(dt) {
  hudEnsure();
  if (hud.toastT > 0) { hud.toastT -= dt; if (hud.toastT <= 0) hud.toast.style.opacity = '0'; }
  const xr = !!(C && C.isXR());
  hud.visT -= dt;
  if (hud.visT <= 0) {
    hud.visT = 0.25;
    const want = pl.flying && (xr || lssHudVisible());
    hud.vis = want;
    hud.cv.style.display = (want && !xr) ? 'block' : 'none';
    if (hud.btn) hud.btn.style.display = (want && !xr) ? 'block' : 'none';
    if (xr || vr.mesh) vrPanel(want && xr);
  }
  if (!hud.vis) return;
  hud.t -= dt;
  if (hud.t > 0) return;
  hud.t = 1 / 15;
  drawHud();
  if (xr && vr.tex) vr.tex.needsUpdate = true;
}
function drawHud() {
  const g = hud.ctx, W = hud.cv.width, H = hud.cv.height, d = pl.drone;
  if (!d) return;
  const af = d.af, col = '#7fe8ff', dim = 'rgba(127,232,255,0.35)';
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(4,12,20,0.42)'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, W, H, 18) : g.rect(0, 0, W, H); g.fill();
  g.font = '700 26px Orbitron, sans-serif'; g.fillStyle = col; g.textAlign = 'left';
  g.fillText(GD.MODE_LABEL[mode], 18, 38);
  g.font = '600 18px Rajdhani, sans-serif'; g.fillStyle = dim;
  g.fillText('M mode  N pods  ' + (af.podType.label), 18, 62);
  // pods, top-down, nose up
  const cx = 300, cy = 150, k = 95 / (Math.max(...af.pods.map(p => Math.hypot(p.r.x, p.r.z))) || 1);
  g.strokeStyle = dim; g.lineWidth = 3;
  g.beginPath(); g.ellipse(cx, cy, 16, 26, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, cy - 34); g.lineTo(cx - 7, cy - 24); g.lineTo(cx + 7, cy - 24); g.closePath(); g.fillStyle = col; g.fill();
  for (let i = 0; i < 4; i++) {
    const r = af.pods[i].r, pod = d.pods[i];
    const x = cx + r.x * k, y = cy + r.z * k, R = 30;
    g.strokeStyle = dim; g.beginPath(); g.moveTo(cx + r.x * 0.25 * k, cy + r.z * 0.25 * k); g.lineTo(x, y); g.stroke();
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
    const f = Math.min(1.2, pod.T / af.Tmax);
    const vy = pod.d.y * f, hx = pod.d.x * f, hz = pod.d.z * f;
    g.fillStyle = vy >= 0 ? 'rgba(127,232,255,0.55)' : 'rgba(0,0,0,0)';
    g.strokeStyle = vy >= 0 ? col : '#ffb070';
    g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, Math.max(2, Math.abs(vy) * R), 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + hx * R * 1.6, y + hz * R * 1.6); g.stroke();
  }
  // readouts
  g.font = '600 19px Rajdhani, sans-serif'; g.fillStyle = col;
  const up = GD.qrot(GD.V(), d.q, GD.V(0, 1, 0));
  const tilt = Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI;
  const spd = GD.vlen(d.v);
  g.fillText('SPD ' + (spd * 3.6).toFixed(0) + ' km/h', 18, 104);
  g.fillText('TILT ' + tilt.toFixed(0) + '°', 18, 130);
  g.fillText('PWR ' + (d.power / 1000).toFixed(1) + ' kW', 18, 156);
  g.fillText('T/W ' + af.spec.twr.toFixed(1) + '  ' + (af.mass).toFixed(0) + ' kg', 18, 182);
  // allocation headroom: attitude / weight / manoeuvre (the three priority layers)
  const bars = [['ATT', d.sat.att], ['LIFT', d.sat.grav], ['MNV', d.sat.cmd]];
  for (let j = 0; j < 3; j++) {
    const y = 214 + j * 26, v = bars[j][1];
    g.fillStyle = dim; g.fillText(bars[j][0], 18, y + 7);
    g.fillStyle = 'rgba(127,232,255,0.15)'; g.fillRect(70, y - 6, 110, 14);
    g.fillStyle = v > 0.98 ? col : '#ffb070'; g.fillRect(70, y - 6, 110 * v, 14);
  }
}

// ---------------------------------------------------------------------------------------------------
// HERO ART. LSS's lobby background and loading card are paintings of an LSS ship (with the LSS name
// painted in), so the copy renders its own: one offscreen frame of a drone mid-manoeuvre, its pods
// vectored by the real allocator, standing in LSS's ship-free hangar art. The stylesheet the copy's
// <head> carries shows it through --gd-hero (falling back to the bare hangar until this lands).
function renderHero() {
  const key = C.shipModelCache.loaded.BLASTER ? 'BLASTER' : Object.keys(frames)[0];
  const proto = key && C.shipModelCache.loaded[key], fr = frameFor(key);
  if (!proto || !fr) return;
  const img = new Image();
  img.onload = () => {
    let r = null;
    try {
      const W = 1600, H = 900, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      r = new T.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
      r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
      const sc = new T.Scene();
      const bg = new T.Texture(img); bg.colorSpace = T.SRGBColorSpace; bg.needsUpdate = true; sc.background = bg;
      sc.add(new T.HemisphereLight(0xcfe6ff, 0x1a1d26, 1.5));
      const k1 = new T.DirectionalLight(0xffffff, 2.4); k1.position.set(4, 6, 5); sc.add(k1);
      const k2 = new T.DirectionalLight(0x66ccff, 2.0); k2.position.set(-6, 1.5, -4); sc.add(k2);
      const m = proto.clone(true);
      m.position.set(0, 0, 0); m.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(m), c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
      m.position.sub(c); sc.add(m);
      // pose the gimbals as if banking into a climbing right turn: allocate that manoeuvre for real
      const rig = { pods: [] };
      for (let i = 0; i < 4; i++) {
        const jet = m.getObjectByName('gdJet' + i), jetMats = [];
        if (jet) jet.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); const mm = o.material; mm.userData.gdBaseOp = (mm.uniforms && mm.uniforms.uOpacity) ? mm.uniforms.uOpacity.value : mm.opacity; jetMats.push(mm); } });
        rig.pods.push({ outer: m.getObjectByName('gdO' + i), middle: m.getObjectByName('gdM' + i), inner: m.getObjectByName('gdI' + i), jet, jetMats, yaw: m.getObjectByName('gdMount' + i).userData.gdYaw });
      }
      const u = new Float64Array(12), pods = [GD.newPod(), GD.newPod(), GD.newPod(), GD.newPod()];
      GD.allocate(fr.af, GD.V(0, 0.35 * fr.af.Tmax * 2, 0), GD.V(0, fr.af.mass * GD.G, 0), GD.V(fr.af.mass * 7, fr.af.mass * 4, -fr.af.mass * 9), u, {});
      for (let i = 0; i < 4; i++) {
        const v = GD.V(u[3 * i], u[3 * i + 1], u[3 * i + 2]), l = GD.vlen(v) || 1;
        GD.slewPod(pods[i], GD.V(v.x / l, v.y / l, v.z / l), Math.PI, 1, fr.af.pods[i].radial);
        pods[i].T = l;
      }
      poseRings(rig, pods, fr.af.Tmax);
      const R = Math.max(sz.x, sz.z);
      const cam = new T.PerspectiveCamera(30, W / H, R * 0.05, R * 50);
      cam.position.set(R * 0.95, R * 0.42, R * 1.65); cam.lookAt(0, -R * 0.06, 0);
      r.render(sc, cam);
      const url = cv.toDataURL('image/jpeg', 0.9);
      document.documentElement.style.setProperty('--gd-hero', 'url("' + url + '")');
      const ld = document.getElementById('lss-loading-img');
      if (ld) { ld.src = url; ld.style.borderRadius = '10px'; }
    } catch (e) { console.warn('[GD] hero render failed:', e && e.message); }
    try { if (r) { r.dispose(); r.forceContextLoss(); } } catch (_) {}
  };
  img.src = 'hangar.webp';   // relative to the copy's <base>: LSS's own hangar art
}

// ---------------------------------------------------------------------------------------------------
// MODE / POD SWITCHING
function setMode(m) {
  if (GD.MODES.indexOf(m) < 0) return;
  mode = m; store.set('gd_mode', m);
  if (pl.ctrl) { pl.ctrl.reset(); }
  toast(GD.MODE_LABEL[m], MODE_HELP[m]);
}
function cycleMode() { setMode(GD.MODES[(GD.MODES.indexOf(mode) + 1) % GD.MODES.length]); }
function setPodType(t) {
  if (!GD.POD_TYPES[t]) return;
  podType = t; store.set('gd_pods', t);
  for (const k in frames) { frames[k].spec.podType = t; frames[k].af = GD.airframe(frames[k].spec); }
  if (pl.drone) pl.drone.af = GD.airframe(Object.assign({}, pl.drone.spec, { podType: t }));
  toast(GD.POD_TYPES[t].label + ' PODS', t === 'fan' ? 'spinning rotors: spool lag, reaction torque, gyroscopic precession' : 'no moving parts: fast spool, no rotor torques');
}
function pollModeInputs() {
  // gamepad D-pad down (button 13 is unbound in play)
  let gp = false;
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) { if (p && p.connected && p.buttons[13] && p.buttons[13].pressed) { gp = true; break; } }
  } catch (_) {}
  if (gp && !pl.gpPrev) cycleMode();
  pl.gpPrev = gp;
  // VR: a flick DOWN on the right stick (the engine leaves that direction unbound)
  let xr = false;
  try {
    const s = C.isXR() && C.renderer && C.renderer.xr && C.renderer.xr.getSession && C.renderer.xr.getSession();
    if (s) for (const src of s.inputSources) {
      if (src.handedness === 'right' && src.gamepad && src.gamepad.axes.length >= 4 && src.gamepad.axes[3] > 0.8) xr = true;
    }
  } catch (_) {}
  if (xr && !pl.xrPrev) cycleMode();
  pl.xrPrev = xr;
}
document.addEventListener('keydown', (e) => {
  if (e.repeat || !pl.flying) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.code === 'KeyM') cycleMode();
  else if (e.code === 'KeyN') setPodType(podType === 'plasma' ? 'fan' : 'plasma');
});

// ---------------------------------------------------------------------------------------------------
// THE HOOKS
const _tmpV = GD.V(), _aW = GD.V(), _vW = GD.V(), _qb = GD.Q(), _u12 = new Float64Array(12), _sat = {};
const GDMod = {
  get mode() { return mode; }, get podType() { return podType; },
  vrPanel: { x: 0.95, y: -0.62, z: -1.6, tilt: -0.3, w: 0.62 },
  setMode, cycleMode, setPodType, frames, pl,
  get gains() { return pl.ctrl && pl.ctrl.gain; },
  dump() { return { mode, podType, frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, { span: +f.span.toFixed(2), mass: +f.af.mass.toFixed(1), twr: +f.spec.twr.toFixed(2), aH: +f.aH.toFixed(1), Tmax: +f.af.Tmax.toFixed(1), I: f.af.I }])), drone: pl.drone && { p: pl.drone.p, v: pl.drone.v, sat: pl.drone.sat } }; },

  install(ctx) { C = ctx; },
  _test: { poseRings: (rig, pods, Tmax) => poseRings(rig, pods, Tmax), setThree: (t) => { T = t; } },
  enabled() { return !!C; },

  preloadShips() {
    T = T || window.THREE;
    for (const key of Object.keys(C.SHIP_MODELS)) {
      const ld = C.LOADOUTS[key], ch = ld ? C.CHASSIS[ld.chassis] : null;
      const spec = C.SHIP_MODELS[key] || {};
      const accent = accentFor(key);
      const proto = buildDroneModel(accent);
      fitProto(proto, (ch ? ch.hullLength : 100) * (spec.scaleMult || 1) * (C.VISUAL_SCALE_BOOST || 1));
      addJets(proto, accent);
      C.shipModelCache.loaded[key] = proto;
      makeFrame(key, proto, ch ? ch.acceleration : 800);
    }
    console.log('[GD] built ' + Object.keys(frames).length + ' gimbal drone hulls (' + podType + ' pods, ' + mode + ' mode)');
    const hero = () => setTimeout(() => { try { renderHero(); } catch (e) { console.warn('[GD] hero:', e); } }, 300);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hero); else hero();
    return Promise.resolve();
  },

  hoardProto(key) {
    T = T || window.THREE;
    if (C.shipModelCache.loaded[key]) return C.shipModelCache.loaded[key];
    const accent = accentFor(key);
    const proto = buildDroneModel(accent, 0x8e95a3);
    fitProto(proto, 140);
    addJets(proto, accent);
    C.shipModelCache.loaded[key] = proto;
    makeFrame(key, proto, 700);
    return proto;
  },

  attachRig(group, key) {
    const fr = frameFor(key);
    if (!fr) return;
    const model = group.getObjectByName('gdDrone');
    if (!model) return;
    const pods = [];
    for (let i = 0; i < 4; i++) {
      const mount = model.getObjectByName('gdMount' + i);
      const outer = model.getObjectByName('gdO' + i), middle = model.getObjectByName('gdM' + i), inner = model.getObjectByName('gdI' + i);
      if (!mount || !outer || !middle || !inner) return;
      const jet = model.getObjectByName('gdJet' + i);
      const jetMats = [];
      if (jet) jet.traverse(o => { if (o.isMesh) { const mm = o.material; mm.userData.gdBaseOp = (mm.uniforms && mm.uniforms.uOpacity) ? mm.uniforms.uOpacity.value : mm.opacity; jetMats.push(mm); } });
      const core = model.getObjectByName('gdCore' + i);
      pods.push({ mount, outer, middle, inner, jet, jetMats, coreMat: core && core.material, yaw: mount.userData.gdYaw });
    }
    group.userData.gdRig = { key, pods, vis: null };
  },

  animate(mesh, dt, doomed) {
    const rig = mesh.userData.gdRig;
    if (!rig || !(dt > 0)) return;
    _time = performance.now() / 1000;
    const fr = frameFor(rig.key);
    if (!fr) return;
    // the player's own drone: show the REAL pods
    if (C && C.player && mesh === C.player.mesh && pl.drone && pl.flying) {
      poseRings(rig, pl.drone.pods, pl.drone.af.Tmax);
      return;
    }
    // anyone else: infer the pods from how the drone actually moved
    const vs = rig.vis || (rig.vis = { p: mesh.position.clone(), v: GD.V(), a: GD.V(), pods: [GD.newPod(), GD.newPod(), GD.newPod(), GD.newPod()], fresh: true });
    const p = mesh.position;
    const vx = (p.x - vs.p.x) / dt / U, vy = (p.y - vs.p.y) / dt / U, vz = (p.z - vs.p.z) / dt / U;
    vs.p.copy(p);
    if (vs.fresh || vx * vx + vy * vy + vz * vz > 200 * 200) {   // first sight or a teleport
      GD.vset(vs.v, 0, 0, 0); GD.vset(vs.a, 0, 0, 0); vs.fresh = false;
      for (const pod of vs.pods) pod.T = fr.af.mass * GD.G / 4;
    } else {
      const k = 1 - Math.exp(-dt / 0.15);
      vs.a.x += ((vx - vs.v.x) / dt - vs.a.x) * k;
      vs.a.y += ((vy - vs.v.y) / dt - vs.a.y) * k;
      vs.a.z += ((vz - vs.v.z) / dt - vs.a.z) * k;
      GD.vset(vs.v, vx, vy, vz);
    }
    const am = GD.vlen(vs.a), aMax = fr.aH * 1.3;
    if (am > aMax) GD.vscale(vs.a, vs.a, aMax / am);
    // body attitude = mesh attitude with the hull flip taken back out
    const mq = mesh.quaternion;
    GD.qmul(_qb, { x: mq.x, y: mq.y, z: mq.z, w: mq.w }, _FLIP);
    GD.visualPods(fr.af, _qb, vs.a, vs.v, _u12, _sat);
    const af = fr.af, maxAng = af.slew * dt, kT = 1 - Math.exp(-dt / af.podType.tauUp);
    for (let i = 0; i < 4; i++) {
      const pod = vs.pods[i];
      GD.vset(_tmpV, _u12[3 * i], _u12[3 * i + 1], _u12[3 * i + 2]);
      const f = GD.vlen(_tmpV);
      if (f > 1e-3) {
        GD.vscale(_tmpV, _tmpV, 1 / f);
        GD.constrainAim(_tmpV, af.pods[i].radial, Math.PI, af.keepCos);
        GD.slewPod(pod, _tmpV, maxAng, dt, af.pods[i].radial);
      }
      pod.T += (Math.max(0, GD.vdot(_tmpV, pod.d)) * f * (doomed ? 0.6 : 1) - pod.T) * kT;
    }
    poseRings(rig, vs.pods, af.Tmax);
  },

  moveBasis(forward, right, up) {
    if (!C || mode === 'free') return;
    const yaw = (C.player && C.player.euler) ? C.player.euler.y : 0;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.set(0, 1, 0);
  },

  flyPlayer(dt, moveDir, maxSpeed, ch) {
    if (!C) return false;
    const P = C.player;
    if (!P || !P.position || !P.velocity || !P.loadoutKey) return false;
    const fr = frameFor(P.loadoutKey);
    if (!fr) return false;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    const now = performance.now();
    const d = pl.drone;
    const gap = now - pl.lastT;
    const jump = d ? Math.hypot(P.position.x / U - d.p.x, P.position.y / U - d.p.y, P.position.z / U - d.p.z) : 1e9;
    if (!d || pl.key !== P.loadoutKey || gap > 500 || jump > 24) seatDrone(fr, P);   // spawn, swap, teleport, pause
    const dr = pl.drone;
    pl.lastT = now; pl.flying = true;
    pollModeInputs();
    if (dt <= 0) return true;
    // the engine's world is the truth: collisions, knockbacks, dashes and teleports all land in
    // player.position / velocity, so start every frame from there
    GD.vset(dr.p, P.position.x / U, P.position.y / U, P.position.z / U);
    GD.vset(dr.v, P.velocity.x / U, P.velocity.y / U, P.velocity.z / U);
    // the pilot's velocity request (LSS's moveDir), capped at the chassis' current speed limit
    const cap = maxSpeed / U;
    GD.vset(_vc, moveDir.x / U, moveDir.y / U, moveDir.z / U);
    if (P.dashActive) {   // a dash is an impulse the engine already applied: hold it, do not brake it
      const l = GD.vlen(dr.v);
      if (l > 1e-3) GD.vscale(_vc, dr.v, cap / l);
    }
    const l = GD.vlen(_vc);
    if (l > cap) GD.vscale(_vc, _vc, cap / l);
    // intent
    const e = P.euler;
    _int.mode = mode; _int.yaw = e ? e.y : 0;
    GD.qYXZ(_look, e ? e.y : 0, e ? e.x : 0, e ? e.z : 0);
    const aU = (ch && ch.acceleration) ? ch.acceleration / U : fr.aH;
    _int.aMax.h = aU; _int.aMax.up = aU * 0.8; _int.aMax.down = aU * 0.8;
    GD.fly(dr, pl.ctrl, _int, ENV, dt, 1 / 240);
    P.velocity.set(dr.v.x * U, dr.v.y * U, dr.v.z * U);
    hudTick(dt);
    return true;
  },

  poseHull(mesh) {
    if (!pl.drone || !pl.flying || !C) return;
    if (performance.now() - pl.lastT > 500) return;
    const q = pl.drone.q;
    mesh.position.copy(C.player.position);
    mesh.quaternion.set(q.x, q.y, q.z, q.w).multiply(_FLIP3 || (_FLIP3 = new T.Quaternion(0, 1, 0, 0)));
  },
};
const _FLIP = GD.Q(0, 1, 0, 0);   // 180 degrees about Y
let _FLIP3 = null;
// The flight hook only runs while the pilot is actually flying, so "it stopped being called" is the
// signal for death, menus, spectating and the lobby: stand the drone HUD down when that happens.
setInterval(() => {
  if (pl.flying && performance.now() - pl.lastT > 400) {
    pl.flying = false;
    if (hud.cv) { hud.vis = false; hud.cv.style.display = 'none'; if (hud.btn) hud.btn.style.display = 'none'; }
    if (vr.mesh) vr.mesh.visible = false;
  }
}, 250);
window.GDMod = GDMod;
})();
