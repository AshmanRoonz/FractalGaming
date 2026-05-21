// =====================================================================
// LSS v17 FX / Particle / Effect System Extraction
// Source: C:\Users\ashro\Fractal_Reality\fractalgaming\LSS\old_versions\last_ship_sailing_v17.html
// Verbatim where size permits; large orchestration functions reduced
// to signatures + key skeleton when full body exceeds budget.
// =====================================================================

// ----- 1. GAME STATE ARRAYS (declared on `game` object, line 3144+) -----
// game = {
//   ...
//   entities: [],
//   projectiles: [],
//   particles: [],  // muzzle flash particles, sparks, etc.
//   effects: [],
//   killFeed: [],
//   levelBoxes: [],     // AABB collision boxes for obstacles
//   levelSpheres: [],   // sphere containment volumes (rooms)
//   levelCylinders: [], // cylinder containment volumes (tunnels)
//   deltaTime: 0,
//   time: 0,
//   lastTime: 0,
//   // Screen shake
//   shakeIntensity: 0,
//   shakeDecay: 8,
//   shakeOffset: { x: 0, y: 0 },
//   // Damage indicators
//   damageIndicators: { top: 0, bottom: 0, left: 0, right: 0 },
//   // Stasis fields
//   stasisFields: [],
//   stasisSpawnTimer: 30, // first batch spawns at 30s
//   stasisFirstBatch: true,
//   stasisInterval: 30, // one every 30s after first batch
//   playerInStasis: false,
//   playerStasisTimer: 0,
//   playerStasisDuration: 3,
//   playerPreStasisVelocity: null,
//   playerInChampionStasis: false,
//   // Persistent world effects (firewalls, trip wires, traps, tethers)
//   worldEffects: [],
//   // Destructible moving geometry
//   dynamicObjects: [],
//   // Cluster obstacles (hold groups of dynamicObjects as their children)
//   clusters: [],
//   // (v14d Phase 4) Detached gas pockets ; when an atom is destroyed its
//   // attached gas mesh transfers here and drifts via inherited velocity.
//   // Each entry: { mesh, velocity, drag } ; cleared at round-rebuild.
//   detachedGasPockets: [],
//   ...
// };

// ----- 2. PARTICLE POOL -----
const MAX_PARTICLES = 500;
const _sharedParticleGeo = new THREE.SphereGeometry(1, 4, 3); // shared; scale per particle

// Soft radial-falloff texture for ember sprites: generated once, shared by every ember.
// Camera-facing quad via THREE.Sprite + radial gradient gives embers soft edges instead of
// polygonal sphere silhouettes, and the additive blending reads as light rather than geometry.
const _emberFalloffTexture = (function() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.70)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.20)');
  g.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
})();

// ---- PARTICLE SPRITE POOL ----
// Replaces updateParticles' per-particle lazy-create-on-first-frame path
// (new SpriteMaterial + new Sprite + scene.add per particle, then dispose
// + scene.remove on expiration). Pool is sized to MAX_PARTICLES so every
// particle gets a slot. Pre-allocated Sprites stay scene-resident at
// visible:false when free; acquire/release just toggles visibility.
const _particlePool = [];
function _initParticlePool() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const mat = new THREE.SpriteMaterial({
      map: _emberFalloffTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    _particlePool.push({ sprite, mat, free: true });
  }
}
_initParticlePool();

let _particlePoolCursor = 0;
function _acquireParticleSlot() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const idx = (_particlePoolCursor + i) % MAX_PARTICLES;
    const slot = _particlePool[idx];
    if (slot.free) {
      slot.free = false;
      slot.sprite.visible = true;
      _particlePoolCursor = (idx + 1) % MAX_PARTICLES;
      return slot;
    }
  }
  return null; // pool exhausted (shouldn't happen — pool size = MAX_PARTICLES)
}
function _releaseParticleSlot(slot) {
  if (!slot) return;
  slot.free = true;
  slot.sprite.visible = false;
}

function cullOldestParticle() {
  // Remove the particle with the least remaining life
  let oldestIdx = 0, lowestLife = Infinity;
  for (let i = 0; i < game.particles.length; i++) {
    if (game.particles[i].life < lowestLife) { lowestLife = game.particles[i].life; oldestIdx = i; }
  }
  const p = game.particles[oldestIdx];
  if (p.poolSlot) _releaseParticleSlot(p.poolSlot);
  game.particles.splice(oldestIdx, 1);
}

// (v16c Phase C) Lightweight velocity factory. Returns a plain
// {x, y, z} object instead of a full THREE.Vector3 instance. Per-frame
// particle spawn churn was a measurable allocation hotspot ; a POJO
// has a fixed hidden class, no prototype chain, no Three.js method
// table, and lets V8 inline x/y/z reads cleanly. NOTE: if you need
// a Vector3 method on a particle velocity (e.g. .length()), inline
// the math instead. Gas-cloud particles (p.gasCloud != null) go
// through a separate update path that still uses Vector3 methods on
// p.velocity ; THOSE spawns retain `new THREE.Vector3(...)`.
function _pVel(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }

// ----- 3. updateParticles + updateEffects + _disposeOrReleaseEffect -----
function updateParticles(dt) {
  if (getVRPerfTier() >= 3) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      if (p && p.poolSlot) _releaseParticleSlot(p.poolSlot);
    }
    game.particles.length = 0;
    return;
  }
  // Cap particle count: cull oldest when over budget.
  // (bugfix 2026-05-20 #301) Read window.MAX_PARTICLES instead of the
  // module-local const so applyQualityPreset's per-tier cap actually
  // takes effect. potato 200 / low 350 / medium 500 / high 700 / ultra
  // 1000 ; falls back to the module default (500) if the window value
  // is missing or non-numeric. The pool itself is still sized to 500 at
  // module load (these const refs at lines 83/102/103/108/112 are
  // unchangeable), so ultra is effectively capped at 500 by the pool
  // anyway ; the key win is potato actually getting 200 instead of 500.
  const _CAP = (typeof window.MAX_PARTICLES === 'number' && window.MAX_PARTICLES > 0)
    ? window.MAX_PARTICLES : MAX_PARTICLES;
  while (game.particles.length > _CAP) cullOldestParticle();

  const arenaLimit = LSS.ARENA_SIZE;
  // (v16c Phase C) Manual x/y/z math on velocity so POJO-typed
  // velocities work alongside any remaining Vector3-typed ones
  // (gas-cloud particles). Replaces p.velocity.multiplyScalar(0.95).
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= dt;
    const pos = p.position;
    if (p.life <= 0 || Math.abs(pos.x) > arenaLimit || Math.abs(pos.y) > arenaLimit || Math.abs(pos.z) > arenaLimit) {
      if (p.poolSlot) _releaseParticleSlot(p.poolSlot);
      game.particles.splice(i, 1);
      continue;
    }
    const _pv = p.velocity;
    pos.x += _pv.x * dt;
    pos.y += _pv.y * dt;
    pos.z += _pv.z * dt;
    _pv.x *= 0.95;
    _pv.y *= 0.95;
    _pv.z *= 0.95;
    const alpha = p.life / p.maxLife;
    if (!p.poolSlot) {
      const slot = _acquireParticleSlot();
      if (!slot) continue;
      p.poolSlot = slot;
      slot.mat.color.setHex(p.color || 0xffffff);
    }
    const slot = p.poolSlot;
    slot.sprite.position.copy(pos);
    slot.mat.opacity = alpha;
    slot.sprite.scale.setScalar(p.size * 2.2 * (0.5 + alpha * 0.5));
  }
}

const MAX_EFFECTS = 350;

function getEffectBudget() {
  const tier = getVRPerfTier();
  if (tier >= 3) return 80;
  if (tier >= 2) return 140;
  if (tier >= 1) return 220;
  return MAX_EFFECTS;
}

function _disposeOrReleaseEffect(e) {
  // Heat-trail sprites route back to the pool instead of disposing; every
  // other effect type disposes normally.
  if (e.type === 'heatTrail') {
    _releaseHeatTrail(e.mesh);
    return;
  }
  // Pooled-geometry effects (T3.14): tracer + tracerTail meshes share the
  // four module-level _TRACER_*_GEO prototypes, so we must NOT call
  // geometry.dispose() on them.
  if (e.type === 'tracer' || e.type === 'tracerTail') {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.mesh.material) e.mesh.material.dispose();
    return;
  }
  // (v11d) Puncture railgun spiral: per-instance geometry AND material
  if (e.type === 'tracerSpiral') {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.mesh.geometry && e.mesh.geometry.dispose) e.mesh.geometry.dispose();
    if (e.mesh.material && e.mesh.material.dispose) e.mesh.material.dispose();
    return;
  }
  // Shader-smoke meshes (explosion plumes) share the global _SMOKE_GEO so
  // disposing the geometry would break the next spawn.
  if (e.type === 'shaderSmoke') {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.mesh.material) e.mesh.material.dispose();
    return;
  }
  // (v6.9) Vortex Laser beams share the global _VORTEX_CORE_BEAM_GEO
  if (e.type === 'vortexLaserBeam') {
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    if (e.mesh.material) e.mesh.material.dispose();
    return;
  }
  // (v16a Phase P) Fractal lightning bolt
  if (e.type === 'lightning') {
    _releaseLightningSlot(e.poolSlot);
    return;
  }
  // (legacy compat) The old per-segment cylinder lightning type.
  if (e.type === 'lightningSeg') {
    if (e.poolSlot) { e.poolSlot.free = true; if (e.poolSlot.mesh) e.poolSlot.mesh.visible = false; }
    return;
  }
  // (v11b) Same pattern for the dark-lightning pool used by Slayer's sword-block aura.
  if (e.type === 'darkLightningSeg') {
    if (e.poolSlot) {
      e.poolSlot.free = true;
      e.poolSlot.mesh.visible = false;
    }
    return;
  }
  // Pooled explosion / impact meshes
  if (e.pooled) {
    _releaseExplosionMesh(e.mesh);
    return;
  }
  if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
  if (e.mesh.geometry) e.mesh.geometry.dispose();
  if (e.mesh.material) e.mesh.material.dispose();
}

function updateEffects(dt) {
  // (v9) Tick the fractal atom shaders so they animate.
  if (_atomFractalMaterials.length) {
    const _gameT = (typeof game !== 'undefined' && typeof game.time === 'number') ? game.time : 0;
    for (let _mi = 0; _mi < _atomFractalMaterials.length; _mi++) {
      const _am = _atomFractalMaterials[_mi];
      if (_am && _am.uniforms && _am.uniforms.time) _am.uniforms.time.value = _gameT;
    }
  }
  // v8VR: drive the InstancedMesh particle pools from inside the same
  // per-frame effects update so they age on the same hitstop-respecting dt.
  if (typeof v8UpdateDebris === 'function') v8UpdateDebris(dt);
  if (typeof v8UpdateSparks === 'function') v8UpdateSparks(dt);

  // Cap effects: swap-with-last + pop is O(1)
  while (game.effects.length > getEffectBudget()) {
    const e = game.effects[0];
    const last = game.effects.length - 1;
    if (last > 0) game.effects[0] = game.effects[last];
    game.effects.pop();
    _disposeOrReleaseEffect(e);
  }
  for (let i = game.effects.length - 1; i >= 0; i--) {
    const e = game.effects[i];
    e.age += dt;
    if (e.age >= e.lifetime) {
      _disposeOrReleaseEffect(e);
      game.effects.splice(i, 1);
      continue;
    }
    const t = e.age / e.lifetime;
    // Generic time + age uniform tick for ShaderMaterials
    if (e.mesh && e.mesh.material && e.mesh.material.uniforms) {
      const u = e.mesh.material.uniforms;
      if (u.time) u.time.value = game.time;
      if (u.uAge) u.uAge.value = t;
    }
    // --- Per-type animation/fade branches (abridged) ---
    // 'fx_burst' : ease-out scale ramp + uBrightness fade + wake integration
    // 'explosion' : scale up + opacity * (1 - t)
    // 'explosionFlash' : rapid quadratic fade, billboard lookAt
    // 'explosionFire' : expand + color shift orange->red, billboard
    // 'shockwave' : radial ring expand (1 + t * maxSize) * baseScale
    // 'smoke' : slow expand + rotation + slow quadratic fade
    // 'shaderSmoke' : updates time/uBaseAlpha uniforms, rotates, drifts,
    //                 inter-cloud lightning arcs, player/bot/proj wake push
    // 'vortexLaserBeam' : uIntensity fade
    // 'debris' : pos += vel*dt; vel*=0.97; spin; shrink; opacity fade
    // 'rockChunk' : drift outward, spin, fade via uOpacity uniform
    // 'tracer' : opacity *= (1 - t)
    // 'lightningTube' : _initialOpacity * max(0, 1 - t)
    // 'lightning' : halo+core uOpacity = _haloOp0/_coreOp0 * (1 - t); uTime ticks
    // 'lightningSeg' / 'darkLightningSeg' : initialOpacity * (1 - t)
    // 'tracerTail' : cubic ease-out fade + radial swell
    // 'tracerSpiral' : cubic ease-out fade
    // 'spark' : pos += vel*dt; vel*=0.93; opacity = 1 - t; shrink
    // 'shieldHit' : slight shimmer scale + opacity 0.6 * (1 - t)
    // 'electricSmoke' : swell + flicker envelope, opacity ~0.45 * env * flicker
    // 'heatTrail' : stretch-along-velocity scale, opacity * (1-t)^2, drift
  }
}

// ----- 4. TRACER SYSTEM -----
// (v16a) Tier-aware radial segment counts
const _TRC_SEG = (function() {
  const t = (typeof QUALITY !== 'undefined' && QUALITY.level) ? QUALITY.level : 'high';
  if (t === 'potato') return { core: 4,  beam: 6,  inner: 8,  outer: 12 };
  if (t === 'ultra')  return { core: 8,  beam: 16, inner: 16, outer: 24 };
  return                       { core: 6,  beam: 12, inner: 12, outer: 16 };
})();
const _TRACER_CORE_GEO = new THREE.CylinderGeometry(0.55, 0.55, 1, _TRC_SEG.core, 1);
_TRACER_CORE_GEO.rotateX(Math.PI / 2);
const _TRACER_BEAM_GEO = new THREE.CylinderGeometry(1.30, 0.95, 1, _TRC_SEG.beam, 1);
_TRACER_BEAM_GEO.rotateX(Math.PI / 2);
const _TRACER_TAIL_INNER_GEO = new THREE.CylinderGeometry(3.50, 2.50, 1, _TRC_SEG.inner, 1);
_TRACER_TAIL_INNER_GEO.rotateX(Math.PI / 2);
const _TRACER_TAIL_OUTER_GEO = new THREE.CylinderGeometry(9.00, 6.50, 1, _TRC_SEG.outer, 1);
_TRACER_TAIL_OUTER_GEO.rotateX(Math.PI / 2);

// Per-vertex fade attribute on shared tracer cylinders. Smoothstep curve
// near end = black, far end = white. With AdditiveBlending + vertexColors:true
// per-spawn material color multiplies by vertex color (fade-in).
[ _TRACER_CORE_GEO, _TRACER_BEAM_GEO, _TRACER_TAIL_INNER_GEO, _TRACER_TAIL_OUTER_GEO ].forEach(g => {
  const pos = g.attributes.position.array;
  const count = pos.length / 3;
  const colors = new Float32Array(count * 3);
  const FADE_START = -0.50;
  const FADE_END   = -0.20;
  for (let i = 0; i < count; i++) {
    const z = pos[i * 3 + 2];
    let t;
    if (z <= FADE_START) t = 0;
    else if (z >= FADE_END) t = 1;
    else {
      const k = (z - FADE_START) / (FADE_END - FADE_START);
      t = k * k * (3 - 2 * k); // smoothstep
    }
    colors[i * 3]     = t;
    colors[i * 3 + 1] = t;
    colors[i * 3 + 2] = t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
});

const _TRACER_CORE_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, vertexColors: true });
const _TRACER_BEAM_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, vertexColors: true });
const _TRACER_TAIL_INNER_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true });
const _TRACER_TAIL_OUTER_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true });

// Internal: spawn one tracer streak along (fromVec -> toVec).
function _spawnSingleTracer(fromVec, toVec, color, widthScale) {
  widthScale = widthScale || 1.0;
  const dir = new THREE.Vector3().subVectors(toVec, fromVec);
  const len = dir.length();
  if (len < 1) return;
  const mid = new THREE.Vector3().addVectors(fromVec, toVec).multiplyScalar(0.5);

  function _makeShape(geo, matProto, col, opacity, lifetime, type) {
    const m = matProto.clone();
    m.color = new THREE.Color(col);
    m.opacity = opacity;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(mid);
    mesh.lookAt(toVec);
    mesh.scale.set(widthScale, widthScale, len);
    mesh.renderOrder = 1;
    scene.add(mesh);
    game.effects.push({ mesh, lifetime, age: 0, type });
  }

  // Hot core (white-hot pinprick, very short-lived)
  _makeShape(_TRACER_CORE_GEO, _TRACER_CORE_MAT_PROTO, 0xffffff, 1.0, 0.10, 'tracer');
  // Beam (weapon color, thin filament)
  _makeShape(_TRACER_BEAM_GEO, _TRACER_BEAM_MAT_PROTO, color, 1.0, 0.18, 'tracer');
  // Inner haze
  _makeShape(_TRACER_TAIL_INNER_GEO, _TRACER_TAIL_INNER_MAT_PROTO, color, 0.55, 0.42, 'tracerTail');
  // Outer haze
  _makeShape(_TRACER_TAIL_OUTER_GEO, _TRACER_TAIL_OUTER_MAT_PROTO, color, 0.18, 0.65, 'tracerTail');

  // Tracer sparkles along the beam
  const particleCount = Math.min(Math.ceil(len / 400), 3);
  for (let i = 0; i < particleCount; i++) {
    const t = 0.25 + Math.random() * 0.55;
    const pPos = fromVec.clone().add(dir.clone().multiplyScalar(t));
    pPos.x += (Math.random() - 0.5) * 6;
    pPos.y += (Math.random() - 0.5) * 6;
    pPos.z += (Math.random() - 0.5) * 6;
    const pVel = new THREE.Vector3(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40
    );
    game.particles.push({
      position: pPos, velocity: pVel,
      life: 0.12 + Math.random() * 0.10, maxLife: 0.22,
      color, size: 0.9 + Math.random() * 1.2
    });
  }
}

function spawnTracer(from, to, color, widthScale) {
  color = color || 0xffff00;
  const wScale = (typeof widthScale === 'number' && widthScale > 0) ? widthScale : 1.0;
  // Player-side: split into two converging tracers from painted barrel tips
  const camDist = (typeof camera !== 'undefined' && camera) ? from.distanceTo(camera.position) : 9999;
  if (camDist < 80) {
    const q = camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const fwdOff = 60;
    const winW = (typeof window !== 'undefined') ? window.innerWidth : 1920;
    const winH = (typeof window !== 'undefined') ? window.innerHeight : 1080;
    const fovRad = (camera.fov || 90) * Math.PI / 180;
    const halfH = fwdOff * Math.tan(fovRad / 2);
    const halfW = halfH * (winW / winH);
    function screenToMuzzle(sx, sy) {
      const ndx = (2 * (sx - winW / 2)) / winW;
      const ndy = -(2 * (sy - winH / 2)) / winH;
      return from.clone()
        .add(right.clone().multiplyScalar(ndx * halfW))
        .add(up.clone().multiplyScalar(ndy * halfH))
        .add(fwd.clone().multiplyScalar(fwdOff));
    }
    const TIP_FRAC_X_LEFT  = 0.305;
    const TIP_FRAC_X_RIGHT = 0.695;
    const TIP_FRAC_Y       = 0.680;
    const sxL = winW * TIP_FRAC_X_LEFT;
    const sxR = winW * TIP_FRAC_X_RIGHT;
    const syLR = winH * TIP_FRAC_Y;
    const leftMuzzle  = screenToMuzzle(sxL,  syLR);
    const rightMuzzle = screenToMuzzle(sxR, syLR);
    _spawnSingleTracer(leftMuzzle, to, color, 0.85 * wScale);
    _spawnSingleTracer(rightMuzzle, to, color, 0.85 * wScale);
    return;
  }
  // Bot / far-field shots: single tracer
  _spawnSingleTracer(from, to, color, 1.0 * wScale);
}

// ----- 5. EXPLOSION SYSTEM -----
const _EXPL_SPHERE_LG  = new THREE.SphereGeometry(1, 8, 6);     // flash, fire
const _EXPL_SPHERE_SM  = new THREE.SphereGeometry(1, 6, 4);     // explosion core
const _EXPL_SPHERE_TINY= new THREE.SphereGeometry(1, 4, 3);     // impact sparks
const _EXPL_PLANE      = new THREE.PlaneGeometry(1, 1);          // flare billboard
const _EXPL_RING_FLAT  = new THREE.TorusGeometry(0.5, 0.05, 6, 48); // thin torus shockwave
const _EXPL_TORUS_PRI  = new THREE.TorusGeometry(0.5, 0.10, 8, 32);
const _EXPL_TORUS_SEC  = new THREE.TorusGeometry(0.5, 0.07, 8, 32);
const _EXPL_ICOS       = new THREE.IcosahedronGeometry(1, 1);    // smoke + impact puff
const _EXPL_TETRA      = new THREE.TetrahedronGeometry(1, 0);    // debris chunk

const _EXPL_POOL = {
  flash: [], flare: [], fire: [], core: [],
  flatShock: [], ringShock: [], ring2Shock: [],
  smoke: [], chunk: [],
  sparkFlash: [], spark: [], puff: [],
  potatoSphere: []
};
const _EXPL_POOL_CAP = {
  flash: 32, flare: 32, fire: 32, core: 32,
  flatShock: 16, ringShock: 16, ring2Shock: 12,
  smoke: 24, chunk: 64,
  sparkFlash: 32, spark: 96, puff: 32,
  potatoSphere: 24
};

function _makeExplosionMesh(type) {
  let geo, matOpts;
  switch (type) {
    case 'flash':
      // Camera-facing billboard quad with ember radial-falloff texture
      geo = _EXPL_PLANE;
      matOpts = { color: 0xffffff, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        map: _emberFalloffTexture };
      break;
    case 'flare':
      geo = _EXPL_PLANE;
      matOpts = { color: 0xffeec0, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        map: _emberFalloffTexture };
      break;
    case 'fire':
      geo = _EXPL_PLANE;
      matOpts = { color: 0xff6600, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        map: _emberFalloffTexture };
      break;
    case 'core':
      geo = _EXPL_PLANE;
      matOpts = { color: 0xff2200, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        map: _emberFalloffTexture };
      break;
    case 'flatShock':
      geo = _EXPL_RING_FLAT;
      matOpts = { color: 0xffd080, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
      break;
    case 'ringShock':
      geo = _EXPL_TORUS_PRI;
      matOpts = { color: 0xffaa44, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false };
      break;
    case 'ring2Shock':
      geo = _EXPL_TORUS_SEC;
      matOpts = { color: 0xff8833, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false };
      break;
    case 'smoke':
      geo = _EXPL_ICOS;
      matOpts = { color: 0x221100, transparent: true, opacity: 0.4 };
      break;
    case 'chunk':
      geo = _EXPL_TETRA;
      matOpts = { color: 0x443322, transparent: true, opacity: 0.8 };
      break;
    case 'sparkFlash':
      geo = _EXPL_SPHERE_SM;
      matOpts = { color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending };
      break;
    case 'spark':
      geo = _EXPL_SPHERE_TINY;
      matOpts = { color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending };
      break;
    case 'puff':
      geo = _EXPL_ICOS;
      matOpts = { color: 0x111111, transparent: true, opacity: 0.3 };
      break;
    case 'potatoSphere':
      geo = _EXPL_SPHERE_LG;
      matOpts = { color: 0xff6600, transparent: true, opacity: 0.85, depthWrite: false };
      break;
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(matOpts));
  mesh.userData._poolType = type;
  return mesh;
}

function _acquireExplosionMesh(type) {
  const pool = _EXPL_POOL[type];
  let mesh = (pool && pool.length) ? pool.pop() : _makeExplosionMesh(type);
  if (!mesh.parent) scene.add(mesh);
  mesh.visible = true;
  mesh.rotation.set(0, 0, 0);
  return mesh;
}

function _releaseExplosionMesh(mesh) {
  if (!mesh) return;
  const type = mesh.userData && mesh.userData._poolType;
  const pool = type ? _EXPL_POOL[type] : null;
  if (!pool) {
    if (mesh.parent) scene.remove(mesh);
    if (mesh.material) mesh.material.dispose();
    return;
  }
  const cap = _EXPL_POOL_CAP[type] || 16;
  if (pool.length >= cap) {
    if (mesh.parent) scene.remove(mesh);
    if (mesh.material) mesh.material.dispose();
    return;
  }
  mesh.visible = false;
  mesh.position.set(0, -1e7, 0);
  mesh.scale.set(1, 1, 1);
  mesh.rotation.set(0, 0, 0);
  if (mesh.material) mesh.material.opacity = 1;
  pool.push(mesh);
}

// spawnExplosion orchestrates: cluster fireball preset bursts, instanced
// debris/sparks, dynamic light, audio, screen shake, post-FX shockwave warp,
// and a series of pooled-mesh phases (flash, flare, fire, core, shockwave
// rings, smoke). Pseudo-skeleton:
function spawnExplosion(pos, size) {
  size = size || 20;
  // (v16a Potato) Minimal explosion : one 3D sphere mesh from the pool only.
  if (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) {
    /* spatial audio + screen shake + pooled potatoSphere mesh + return */
    const sphereMesh = _acquireExplosionMesh('potatoSphere');
    sphereMesh.position.copy(pos);
    sphereMesh.scale.setScalar(size);
    sphereMesh.material.color.setHex(0xff6600);
    sphereMesh.material.opacity = 0.85;
    game.effects.push({ mesh: sphereMesh, lifetime: 0.45, age: 0,
      type: 'explosionFire', pooled: true, billboard: false,
      maxSize: size * 2.5, baseScale: size });
    return;
  }
  // (v14g) Isotropic cloud push impulse to nearby smoke
  if (typeof applyExplosionPush === 'function') {
    applyExplosionPush(pos, 40 + size * 2.5, 200 + size * 12);
  }
  // (v11b) Dynamic point light
  if (typeof _spawnExplosionLight === 'function') _spawnExplosionLight(pos, size);

  // (v11 Phase 5) Cluster explosion: primary fireball + 3-7 secondary bursts
  if (typeof spawnFXBurst === 'function' && size >= 8 && getVRPerfTier() < 2) {
    const coreR = Math.max(40, size * 1.4);
    if (size >= 35 && typeof spawnSupershapeBurst === 'function') {
      spawnSupershapeBurst('fireball', pos, coreR, 0.45 + size * 0.005,
        { startScale: 0.25, endScale: 1.0 });
    } else {
      spawnFXBurst('fireball', pos, coreR, 0.45 + size * 0.005,
        { startScale: 0.25, endScale: 1.0 });
    }
    const clusterCount = Math.min(8, 3 + Math.floor(size / 12));
    const spreadR = size * 1.2;
    for (let ci = 0; ci < clusterCount; ci++) {
      const phi = Math.random() * Math.PI * 2;
      const cosTheta = 2 * Math.random() - 1;
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const r = spreadR * Math.pow(Math.random(), 0.5);
      const offset = new THREE.Vector3(
        r * sinTheta * Math.cos(phi),
        r * sinTheta * Math.sin(phi),
        r * cosTheta);
      const subPos = pos.clone().add(offset);
      const isFire = Math.random() < 0.4;
      const subR = (isFire ? 0.4 : 0.7) * size * (0.55 + Math.random() * 0.9);
      const subLife = isFire ? 0.30 + Math.random() * 0.25 : 0.90 + Math.random() * 0.90;
      spawnFXBurst(isFire ? 'fireball' : 'cloud', subPos, subR, subLife, {
        startScale: 0.20 + Math.random() * 0.20,
        endScale: 0.85 + Math.random() * 0.5 });
    }
  }
  // v8VR instanced debris + sparks
  if (typeof v8SpawnDebris === 'function') v8SpawnDebris(pos, /* count */ Math.min(48, Math.max(6, Math.round(size * 0.6))), Math.max(0.6, size * 0.05), Math.max(60, size * 6));
  if (typeof v8SpawnSparks === 'function') v8SpawnSparks(pos, Math.min(64, Math.max(8, Math.round(size * 1.2))), Math.max(0.8, size * 0.07), Math.max(140, size * 14), 0xff8822, 0xfff8a0);
  // Audio, ambient duck, screen shake, post-FX shockwave warp ...
  // ---- Phase 1: White-hot flash core (camera-facing billboard) ----
  const flashMesh = _acquireExplosionMesh('flash');
  flashMesh.position.copy(pos);
  flashMesh.scale.setScalar(size * 0.55);
  flashMesh.lookAt(camera.position);
  flashMesh.material.color.setHex(0xffffff);
  flashMesh.material.opacity = 1.0;
  game.effects.push({ mesh: flashMesh, lifetime: 0.12, age: 0,
    type: 'explosionFlash', pooled: true, billboard: true, baseScale: size * 0.55 });
  // ---- Phase 1b: lens flare disc ----
  const flareMesh = _acquireExplosionMesh('flare');
  flareMesh.position.copy(pos);
  flareMesh.scale.setScalar(size * 1.6);
  flareMesh.lookAt(camera.position);
  flareMesh.material.color.setHex(0xffeec0);
  flareMesh.material.opacity = 0.95;
  game.effects.push({ mesh: flareMesh, lifetime: 0.22, age: 0,
    type: 'explosionFlash', pooled: true, billboard: true, baseScale: size * 1.6 });
  // ---- Phase 2: Expanding fireball (orange-red, multi-layer, camera-facing) ----
  const fireMesh = _acquireExplosionMesh('fire');
  fireMesh.position.copy(pos);
  fireMesh.scale.setScalar(size);
  fireMesh.lookAt(camera.position);
  fireMesh.material.color.setHex(0xff6600);
  fireMesh.material.opacity = 0.85;
  // ... continues with shockwave torus rings, smoke puffs, debris chunks ...
}

// Hull-hit cloud burst: tighter, smaller version of shield-hit cloud. Only
// fired when a SHIP's hull takes a hit (not shields/walls/obstacles).
function spawnHullBurst(pos, color, size) {
  size = size || 50;
  color = color != null ? color : 0xffaa44;
  const PARTS = 8;
  const baseSpeed = 100 + size * 0.8;
  for (let i = 0; i < PARTS; i++) {
    const dx = (Math.random() - 0.5);
    const dy = (Math.random() - 0.5);
    const dz = (Math.random() - 0.5);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const speed = baseSpeed * (0.55 + Math.random() * 0.65);
    game.particles.push({
      position: pos.clone(),
      velocity: _pVel(dx / len * speed, dy / len * speed, dz / len * speed),
      life: 0.20 + Math.random() * 0.20,
      maxLife: 0.40,
      color: Math.random() < 0.30 ? 0xffffff : color,
      size: 1.2 + Math.random() * 1.4,
    });
  }
}

// Spawn impact sparks at a hit location (small fast-moving particles)
function spawnImpactSparks(pos, count) {
  if (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) return;
  count = count || 6;
  // v8VR instanced bright spark layer
  if (typeof v8SpawnSparks === 'function') {
    const sparkCount = Math.min(36, Math.max(4, Math.round(count * 2.2)));
    v8SpawnSparks(pos, sparkCount, 0.9, 240);
  }
  // Bright impact flash (white-hot center)
  const flashMesh = _acquireExplosionMesh('sparkFlash');
  flashMesh.position.copy(pos);
  flashMesh.scale.setScalar(3);
  flashMesh.material.color.setHex(0xffffff);
  flashMesh.material.opacity = 0.9;
  game.effects.push({ mesh: flashMesh, lifetime: 0.06, age: 0,
    type: 'explosionFlash', pooled: true, baseScale: 3 });
  // Spark streaks (fast, bright, varied angles)
  for (let i = 0; i < count; i++) {
    const brightness = 0.8 + Math.random() * 0.2;
    const sparkScale = 1.2 + Math.random() * 0.8;
    const spark = _acquireExplosionMesh('spark');
    spark.position.copy(pos);
    spark.scale.setScalar(sparkScale);
    spark.material.color.setRGB(brightness, brightness * 0.6 + Math.random() * 0.2, brightness * 0.15);
    spark.material.opacity = 1;
    const speed = 300 + Math.random() * 500;
    const vel = new THREE.Vector3(
      (Math.random()-0.5) * speed,
      (Math.random()-0.5) * speed,
      (Math.random()-0.5) * speed);
    game.effects.push({ mesh: spark, lifetime: 0.2 + Math.random() * 0.3, age: 0,
      type: 'spark', pooled: true, baseScale: sparkScale, vel });
  }
  // Tiny secondary sparks (ember spray)
  const secondaryCount = Math.ceil(count * 0.6);
  for (let i = 0; i < secondaryCount; i++) {
    const speed = 100 + Math.random() * 200;
    game.particles.push({
      position: pos.clone(),
      velocity: _pVel((Math.random()-0.5)*speed, (Math.random()-0.5)*speed, (Math.random()-0.5)*speed),
      life: 0.15 + Math.random() * 0.2,
      maxLife: 0.35,
      color: Math.random() > 0.5 ? 0xff8800 : 0xffcc44,
      size: 1 + Math.random() * 1
    });
  }
  // ... Volumetric scorch shaderSmoke puffs (1-2 if count > 3) ...
}

// ----- 6. LIGHTNING BOLT SYSTEM -----
// (FX migration #370) Lightning moved to lss_v17_fx_lightning.js. fx.js
// no longer owns spawnLightningBolt or the pool. The pool that fx.js
// built was using GLSL ShaderMaterial which the WebGPU port could not
// honor anyway ; the new module uses MeshBasicMaterial + a hand-built
// tapered tube. _releaseLightningSlot / _initDarkLightningPool dropped
// (no callers ; were leftover from v17o pool retire path).

// ----- 7. DYNAMIC LIGHTS + SMOKE-LIGHT PIGGYBACK -----
// Pool of PointLights for explosions, impacts. NUM_POINT_LIGHTS is pinned
// to MAX_LIGHTS by keeping all pool lights permanently visible with
// intensity=0 when idle, avoiding runtime program relinks.
// (bugfix 2026-05-22 #369) Reuse the window.dynamicLights pool from
// webGPU.html instead of building a parallel one. fx.js was constructing
// its own pool of 8 PointLights at boot and adding them to the scene,
// running alongside webGPU.html's pool of 8 → 16 idle lights in scene
// at all times. WebGPU's per-fragment lighting pass scales with light
// count so doubling N doubled fragment shader cost. By aliasing the
// fx.js local `dynamicLights` to the window object's pool, the two
// modules share a single pool of MAX_LIGHTS=4 (cut down per the same
// fix), and fx.js's spawnDynamicLight below correctly pops from the
// already-built pool instead of creating duplicates.
const dynamicLights = (typeof window !== 'undefined' && window.dynamicLights)
  || { pool: [], active: [], MAX_LIGHTS: 4 };

function spawnDynamicLight(pos, color, intensity, range, duration) {
  const tier = getVRPerfTier();
  if (tier >= 3) return;
  if (tier >= 2 && (intensity || 0) < 3.0) return;
  if (tier >= 1) { intensity *= 0.6; range *= 0.75; }
  let light;
  if (dynamicLights.pool.length > 0) {
    light = dynamicLights.pool.pop();
  } else {
    const oldest = dynamicLights.active.shift();
    if (oldest) { oldest.light.intensity = 0; light = oldest.light; }
    else return;
  }
  light.color.setHex(color);
  light.intensity = intensity;
  light.distance = range;
  light.position.copy(pos);
  // (bugfix 2026-05-22 #369) Attach to scene on activation ; mirrors
  // the same attach/detach lifecycle from webGPU.html's spawnDynamicLight.
  // Pool lights live OUTSIDE the scene so the WebGPU lighting pass only
  // counts the active set.
  if (light.parent !== scene) scene.add(light);
  dynamicLights.active.push({ light, intensity, duration, age: 0 });
  // (v9) Track this flash so the smoke shader can pick it up.
  if (typeof _smokeLightFlashes !== 'undefined') {
    _smokeLightFlashes.push({
      pos: pos.clone(),
      color: new THREE.Color(color),
      intensity: intensity,
      duration: duration,
      age: 0,
    });
    while (_smokeLightFlashes.length > _SMOKE_FLASH_MAX) _smokeLightFlashes.shift();
  }
}

// (v9) Smoke-flash queue ; capped at twice the per-shader slot count.
const _smokeLightFlashes = [];
const _SMOKE_FLASH_MAX = 12;

function updateSmokeLights(dt) {
  for (let i = _smokeLightFlashes.length - 1; i >= 0; i--) {
    const f = _smokeLightFlashes[i];
    f.age += dt;
    if (f.age >= f.duration) _smokeLightFlashes.splice(i, 1);
  }
  // Build up to 4 strongest active flashes (intensity * fadeOut).
  const top = [];
  for (const f of _smokeLightFlashes) {
    const t = f.age / f.duration;
    const fadeOut = Math.max(0, 1 - t * t);
    const eff = f.intensity * fadeOut;
    top.push({ f, eff });
  }
  top.sort((a, b) => b.eff - a.eff);
  // Walk the smoke material registry. Drop dead WeakRefs.
  for (let i = _smokeMatRegistry.length - 1; i >= 0; i--) {
    const ref = _smokeMatRegistry[i];
    const mat = (ref && typeof ref.deref === 'function') ? ref.deref() : null;
    if (!mat || !mat.uniforms || !mat.uniforms.uLightStrength) {
      _smokeMatRegistry.splice(i, 1);
      continue;
    }
    const lp = mat.uniforms.uLightPos.value;
    const lc = mat.uniforms.uLightColor.value;
    const ls = mat.uniforms.uLightStrength.value;
    for (let k = 0; k < _MAX_SMOKE_LIGHTS; k++) {
      const e = top[k];
      if (e) {
        lp[k].copy(e.f.pos);
        lc[k].copy(e.f.color);
        ls[k] = e.eff;
      } else {
        ls[k] = 0;
      }
    }
    mat.uniforms.uLightStrength.needsUpdate = true;
  }
}

function updateDynamicLights() {
  const dt = game.deltaTime;
  for (let i = dynamicLights.active.length - 1; i >= 0; i--) {
    const entry = dynamicLights.active[i];
    entry.age += dt;
    if (entry.age >= entry.duration) {
      entry.light.intensity = 0;
      // (bugfix 2026-05-22 #369) Detach from scene on recycle so the
      // lighting pass doesn't keep iterating an idle light.
      if (entry.light.parent) entry.light.parent.remove(entry.light);
      dynamicLights.pool.push(entry.light);
      dynamicLights.active.splice(i, 1);
    } else {
      const t = entry.age / entry.duration;
      entry.light.intensity = entry.intensity * (1 - t * t); // quadratic falloff
    }
  }
}

// ----- 8. SHADER SMOKE -----
const _SMOKE_GEO = new THREE.SphereGeometry(1, 12, 8);
const _smokeMatRegistry = []; // WeakRefs to live smoke materials
const _MAX_SMOKE_LIGHTS = 4;
// Factory signature only (GLSL omitted - will port to TSL during integration):
//   _makeSmokeMaterial(initialColor, baseAlpha) -> THREE.ShaderMaterial
// Uniforms: time, uColor, uBaseAlpha, uOctaves,
//           uLightPos[4], uLightColor[4], uLightStrength[4],
//           uDisplaceAmount (default 0.45), uDisplaceFreq (default 1.4)
// The factory pushes a WeakRef(mat) into _smokeMatRegistry, and patches
// mat.dispose() to skip duplicate disposal.

// ----- 9. ATOM FRACTAL MATERIALS -----
const _atomFractalMaterials = []; // all live fractal mats so we can tick `time`
// Factory signature only (GLSL Mandelbox iterations omitted):
//   _makeAtomFractalMaterial(baseColor) -> THREE.ShaderMaterial
// Uniforms: time, uBaseColor, uOpacity (default 0.78)
// Vertex: varying vLocalPos, vWorldPos, vNormal (no displacement).
// Fragment: ray-marched Mandelbox-style escape-time over vLocalPos, output
// modulated by uBaseColor; outputs gl_FragColor.a = uOpacity.
// Caller pushes mat into _atomFractalMaterials so updateEffects can tick time.

// ----- 10. STASIS FIELD SYSTEM -----
class StasisField {
  constructor(position, championMode) {
    this.position = position.clone();
    this.alive = true;
    this.championMode = !!championMode;
    // (v16a Phase AA) Champion capture = contact zone size of visible core.
    this.radius = this.championMode ? 50 : 120;
    this.pulseTime = 0;
    this.chargingTeam = null;
    this.chargeTimer = 0;
    this.lastChargingShipDiedTeam = null;
    // (v16) Per-team accumulated charge time. When champion is shoved out
    // their team's progress is PRESERVED so they can resume on re-entry.
    this.teamProgress = {};
    this.recentlyReleasedShip = null;
    this.recentlyReleasedTimer = 0;

    // Visual: shader-driven energy core + two rotating rings
    const coreColor = this.championMode ? 0xaa55ff : 0x00ccff;
    const ringColor = this.championMode ? 0x9933ff : 0x0088ff;
    const coreRadius = this.championMode ? 50 : 22;
    const ringRadius = this.championMode ? 90 : 40;
    this.group = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(coreRadius, 32, 20);
    // Potato falls back to MeshBasicMaterial ; full path uses LayeredFX
    // 'plasma_purple' / 'plasma_wall' shader (driven by _layeredFXTick).
    let coreMat;
    if (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) {
      coreMat = new THREE.MeshBasicMaterial({
        color: coreColor, transparent: true, opacity: 0.65,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
    } else if (typeof _makeFXMaterial === 'function') {
      coreMat = _makeFXMaterial(this.championMode ? 'plasma_purple' : 'plasma_wall', { /* opts */ });
      // Add uPulse custom uniform driven by proximityBoost in update(dt).
    }
    this.core = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this.core);
    // ... two rotating rings (TorusGeometry), beacon column ...
    this.group.position.copy(this.position);
    scene.add(this.group);
  }
  update(dt) {
    this.pulseTime += dt;
    // proximity boost: distance(player, this.position) -> uPulse uniform
    // ring rotations, beacon pulse, charge timer accumulation, ...
  }
  destroy() {
    if (this.group && this.group.parent) scene.remove(this.group);
    if (this.core && this.core.geometry) this.core.geometry.dispose();
    if (this.core && this.core.material && this.core.material.dispose) this.core.material.dispose();
    // dispose ring geometries/materials, beacon column
    this.alive = false;
  }
}

function spawnStasisField() {
  // (v6.7) Only the stasis owner computes spawns; receivers get them via the
  // stasis_spawn event.
  if (net.active && !amStasisOwner()) return;

  const aliveFields = game.stasisFields.filter(f => f.alive);
  if (aliveFields.length >= 3) return;

  // Get sphere indices already occupied
  const occupiedSpheres = new Set();
  for (const f of aliveFields) {
    const idx = getStasisSphereIndex(f.position);
    if (idx >= 0) occupiedSpheres.add(idx);
  }

  const minDist = 300;
  for (let attempt = 0; attempt < 50; attempt++) {
    const pos = getValidSpawnPoint(null, 80);
    const sphereIdx = getStasisSphereIndex(pos);
    if (sphereIdx < 0) continue;
    if (occupiedSpheres.has(sphereIdx)) continue;
    let tooClose = false;
    for (const f of aliveFields) {
      if (pos.distanceTo(f.position) < minDist) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const fieldId = ++net.stasisIdCounter;
    instantiateStasisField(pos, fieldId);
    if (net.active && net.sendEvent) {
      net.sendEvent({ type: 'stasis_spawn', x: pos.x, y: pos.y, z: pos.z, fieldId });
    }
    return;
  }
}

// (v16) Centralized release for champion-field claims.
function _releaseChampionClaim(field, preserveProgress, releasedShip) {
  if (!field) return;
  const ship = releasedShip || field.claimedBy;
  const isPlayer = (ship === player);
  field.claimedBy = null;
  field.chargingTeam = null;
  field._championChargeStartShield = null;
  if (!preserveProgress) {
    field.teamProgress = {};
    field.chargeTimer = 0;
  }
  if (ship) {
    field.recentlyReleasedShip = ship;
    field.recentlyReleasedTimer = 0.6;
  }
  if (isPlayer) {
    game.playerInChampionStasis = false;
    game.playerInStasis = false;
    const w = document.getElementById('stasis-warning');
    const v = document.getElementById('stasis-vignette');
    if (w) w.style.display = 'none';
    if (v) v.style.display = 'none';
  }
}

function updateStasisFields(dt) {
  // Spawn timer (3-field max, 30s interval; first-batch staggered 0/250/500ms)
  if (game.state === 'playing') {
    const aliveCount = game.stasisFields.filter(f => f.alive).length;
    if (aliveCount < 3) {
      game.stasisSpawnTimer -= dt;
      if (game.stasisSpawnTimer <= 0) {
        if (game.stasisFirstBatch) {
          spawnStasisField();
          game.stasisFirstBatch = false;
          setTimeout(() => { if (game.state === 'playing') spawnStasisField(); }, 250);
          setTimeout(() => { if (game.state === 'playing') spawnStasisField(); }, 500);
        } else {
          spawnStasisField();
        }
        game.stasisSpawnTimer = game.stasisInterval;
      }
    }
  }
  // Champion-field auto-spawn near round end (purple, at map center)
  // ... champion spawn gating via CHAMPION_TIME / game.championSpawned ...

  // Per-field tick:
  // - field.update(dt) drives pulse/rings/proximity boost
  // - player + bots distance check; entry triggers stasis state, exit releases
  // - champion mode : charge timer accumulation, dash-ram shove-out detection,
  //   per-team progress accrual, win-on-CHAMPION_CHARGE_TIME, _releaseChampionClaim
  // - field destruction when player dies in stasis or claimed long enough
}

// ----- 11. DYNAMIC OBJECTS + ORGANICS UPDATES (signatures + skeleton) -----
// updateDynamicObjects(dt) : ticks game.dynamicObjects[] - destructible
// moving geometry (cluster atom children). Per-object: gravity/orbit motion
// around cluster center, collision with player/bots, atom-to-atom lightning
// arcs within a cluster, on-destruction releases _makeAtomFractalMaterial,
// spawns rockChunk debris (game.effects type='rockChunk'), transfers
// attached gas mesh to game.detachedGasPockets.
function updateDynamicObjects(dt) { /* large body omitted */ }

// updateOrganics(dt) : ticks long-lived gas / cloud / nebula entities that
// drift through the arena. Per-organic: drift velocity integration, life
// timer, optional Perlin-noise wobble, edge-of-arena wrap, dispose on death.
function updateOrganics(dt) { /* large body omitted */ }

// updateGasChemistry(dt) : tracks lightning ignition of gas pockets ; bolt
// near gas mesh -> ignite, gas mesh transitions to fireball mode + radial
// damage hitbox, then fades. Wires into spawnFXBurst('fireball', ...).
function updateGasChemistry(dt) { /* large body omitted */ }

// updateDetachedGasPockets(dt) : ticks game.detachedGasPockets[].
// Each entry: { mesh, velocity (Vector3), drag } ; mesh.position += velocity*dt,
// velocity *= drag^dt, optional lifetime fade, dispose when fully transparent
// or outside arena bounds.
function updateDetachedGasPockets(dt) { /* large body omitted */ }

// ----- 12. WAKE / BCS LIGHTING / DOTS -----
// updateBCSWakes(dt) : ambient cloud / smoke / BCS gas push from moving
// player + bots + projectiles. For each cloud, accumulates wakeVel impulse
// (proportional to source speed, inverse distance), integrates velocity into
// position, dampens with exp(-dt * k). Same pattern as the inline
// 'shaderSmoke' / 'fx_burst' branches in updateEffects.
function updateBCSWakes(dt) { /* large body omitted */ }

// updateBCSLighting() : per-frame writes top-K (typically 4) live dynamic
// lights into each BCS material's uLightPos/uLightColor/uLightStrength
// uniforms. Same registry pattern as updateSmokeLights() but for the
// "Big Cosmic System" body shader materials.
function updateBCSLighting() { /* large body omitted */ }

// updateAmbientCloudWakes(dt) : like updateBCSWakes but for the ambient
// background cloud dots (non-collidable atmospheric layer).
function updateAmbientCloudWakes(dt) { /* large body omitted */ }

// updateAmbientCloudDots(dt) : ticks the ambient cloud dot layer ; rotates,
// drifts, fades in/out based on camera distance, regenerates particles that
// drift out of range.
function updateAmbientCloudDots(dt) { /* large body omitted */ }

// updateDots(dt) : ticks game.dots[] - the unified Dot anchor system
// (ambient clouds, beacons, stasis-link anchors). Per-dot: anchor position
// update, attached smoke mesh / sprite / wireframe update, lifecycle.
function updateDots(dt) { /* large body omitted */ }

function clearAmbientCloudDots() {
  if (!game || !game.dots || !game.dots.length) return;
  for (let i = game.dots.length - 1; i >= 0; i--) {
    const d = game.dots[i];
    if (d && d._isAmbientCloud) {
      try { d.dispose(); } catch (_) {}
      game.dots.splice(i, 1);
    }
  }
}

// ----- 13. HEAT TRAILS -----
const _heatTrailPool = [];
const _HEAT_TRAIL_POOL_MAX = 96;
function _acquireHeatTrail(tex) {
  if (_heatTrailPool.length) return _heatTrailPool.pop();
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffb070,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    rotation: 0,
  });
  const sprite = new THREE.Sprite(mat);
  return { sprite, mat };
}
function _releaseHeatTrail(sprite) {
  if (!sprite) return;
  if (sprite.parent) sprite.parent.remove(sprite);
  if (_heatTrailPool.length < _HEAT_TRAIL_POOL_MAX) {
    _heatTrailPool.push({ sprite, mat: sprite.material });
  } else {
    if (sprite.material) sprite.material.dispose();
  }
}

// Heat trail blur behind a moving ship. Stretched additive sprite aft of hull.
function spawnHeatTrail(pos, velocity, maxSpeed, hullRadius) {
  if (getVRPerfTier() >= 1) return;
  const speed = velocity.length();
  if (speed < 30) return;
  const t = Math.min(1, speed / Math.max(1, maxSpeed));
  if (t < 0.12) return;
  const tex = getHeatTrailTexture();
  const entry = _acquireHeatTrail(tex);
  const sprite = entry.sprite;
  const mat = entry.mat;
  mat.map = tex;
  mat.color.setHex(0xffb070);
  mat.opacity = 0.45 + t * 0.35;
  mat.rotation = Math.random() * Math.PI * 2;
  mat.needsUpdate = true;
  const back = velocity.clone().normalize().multiplyScalar(-(hullRadius * 0.85));
  sprite.position.copy(pos).add(back);
  sprite.position.x += (Math.random() - 0.5) * (hullRadius * 0.4);
  sprite.position.y += (Math.random() - 0.5) * (hullRadius * 0.4);
  sprite.position.z += (Math.random() - 0.5) * (hullRadius * 0.4);
  const baseScale = hullRadius * (0.9 + t * 1.1);
  sprite.scale.set(baseScale * 0.7, baseScale, 1);
  scene.add(sprite);
  game.effects.push({
    mesh: sprite,
    lifetime: 0.35 + t * 0.45,
    age: 0,
    type: 'heatTrail',
    baseScale: baseScale,
    grow: 1.15 + t * 0.6,
    drift: velocity.clone().multiplyScalar(-0.08),
  });
}

// ----- 14. HITSTOP + SCREEN SHAKE + DAMAGE INDICATORS -----
function triggerScreenShake(intensity) {
  game.shakeIntensity = Math.min(game.shakeIntensity + intensity, 15);
}

const hitFX = {
  hitstopRemaining: 0,
  hitstopScale: 1.0,
  vignetteUntil: 0,
  TIERS: {
    tap:       { shake: 1.5, rumbleStrong: 0.15, rumbleWeak: 0.2, rumbleMs: 60,  hitstopMs: 0,   flash: 0.4 },
    hit:       { shake: 4,   rumbleStrong: 0.4,  rumbleWeak: 0.6, rumbleMs: 120, hitstopMs: 0,   flash: 0.7 },
    kill:      { shake: 8,   rumbleStrong: 0.7,  rumbleWeak: 0.9, rumbleMs: 220, hitstopMs: 80,  flash: 1.0 },
    multikill: { shake: 12,  rumbleStrong: 0.95, rumbleWeak: 1.0, rumbleMs: 380, hitstopMs: 140, flash: 1.0 },
  },
};

// Drive the hitstop window. Called from gameLoop with wall-clock dt; returns
// dt to actually feed downstream systems.
function updateHitstop(dt) {
  if (hitFX.hitstopRemaining > 0) {
    hitFX.hitstopRemaining -= dt;
    if (hitFX.hitstopRemaining <= 0) { hitFX.hitstopRemaining = 0; hitFX.hitstopScale = 1.0; }
    return dt * hitFX.hitstopScale;
  }
  return dt;
}

function updateScreenShake(dt) {
  if (game.shakeIntensity > 0.1) {
    game.shakeOffset.x = (Math.random() - 0.5) * game.shakeIntensity * 2;
    game.shakeOffset.y = (Math.random() - 0.5) * game.shakeIntensity * 2;
    game.shakeIntensity *= Math.pow(0.5, dt * game.shakeDecay);
  } else {
    game.shakeIntensity = 0;
    game.shakeOffset.x = 0;
    game.shakeOffset.y = 0;
  }
}
