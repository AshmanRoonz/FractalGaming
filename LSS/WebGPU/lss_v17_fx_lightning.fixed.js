// =====================================================================
// LSS v17 Lightning FX module
// Owns : spawnLightningBolt, _buildLightningTubeGeometry, _generateLightningPath,
//        _generateLightningBranches, _spawnLayeredGasArc.
//
// Extracted from last_ship_sailing_webGPU.html as part of the #370 FX
// migration. Self-contained ; depends only on:
//   window.THREE
//   window.scene
//   window.game           (for game.effects + game.particles)
//   window.spawnDynamicLight  (the wrapped pool-detach version)
//   window._scheduleEffectDispose (effect lifecycle helper)
//
// Bolts use a hand-built tapered tube (v17o:23175) — NOT THREE.TubeGeometry.
// Each path point gets a ring of `radialSegments` verts, radius tapers
// 0.3 → 1.0 → 0.3 via sin(πv), basis from tangent × world-up. Polyline
// jaggedness from _generateLightningPath survives unchanged.
// =====================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // (FX migration #373 — lightning spike merge) TSL NodeMaterial port
  // of v17o's lightning fragment shader (v17o:23304). Spike-verified in
  // lightning_spike.html ; user signed off on the look. The previous
  // MeshBasicMaterial path is replaced with this. Key features carried
  // from v17o :
  //   - tipFade = sin(πv) per-fragment (was only in geometry before)
  //   - scrolling vnoise pulse along bolt length (mix(0.78, 1.0, ...))
  //   - halo vs core distinction (halo = uColor ; core = white·90 + uColor·10)
  //   - additive blending + double-sided
  // Two-tier render : halo + core, like v17o spawnLightningBolt at 23861.
  let _tslMod = null;
  function _tsl() {
    if (_tslMod) return _tslMod;
    _tslMod = window._tsl || null;
    return _tslMod;
  }
  // Per-bolt material factory ; cheap to construct because uniforms +
  // node graph are reused across calls — but each material is per-bolt
  // so opacity fade-out doesn't bleed across simultaneous bolts.
  function _makeLightningMaterial(colorHex, opacity, isCore) {
    const tsl = _tsl();
    if (!tsl) return null;
    const {
      Fn, uniform, time,
      vec3, vec4, float,
      uv, mix, smoothstep, sin, floor, fract,
    } = tsl;
    const uColor = uniform(new THREE.Color(colorHex));
    const uOpacity = uniform(opacity);
    const uIsCore = uniform(isCore ? 1.0 : 0.0);
    const hash1 = Fn(([x]) => fract(sin(x.mul(12.9898)).mul(43758.5453)));
    const vnoise = Fn(([x]) => {
      const i = floor(x);
      const f = fract(x);
      return mix(hash1(i), hash1(i.add(1.0)), smoothstep(0.0, 1.0, f));
    });
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.colorNode = Fn(() => {
      const v = uv().y;
      const tipFade = sin(v.mul(Math.PI));
      const pulse = mix(
        float(0.78), float(1.0),
        vnoise(v.mul(18.0).add(time.mul(9.0))),
      );
      const col = mix(uColor, mix(vec3(1.0, 1.0, 1.0), uColor, 0.10), uIsCore);
      const a = uOpacity.mul(tipFade).mul(pulse);
      return vec4(col, a);
    })();
    mat.userData = { uColor, uOpacity, uIsCore };
    return mat;
  }

  const _LIGHT_DIR_  = new THREE.Vector3();
  const _LIGHT_PERP_ = new THREE.Vector3();
  const _LIGHT_R1_   = new THREE.Vector3();
  const _LIGHT_R2_   = new THREE.Vector3();

  // ---------------------------------------------------------------
  // _generateLightningPath : recursive midpoint displacement.
  // Depth controls subdivision : 3 = 9 verts, 4 = 17, 5 = 33.
  // Each iteration halves the displacement amplitude.
  // ---------------------------------------------------------------
  window._generateLightningPath = function (from, to, depth, roughness) {
    depth = (depth | 0) || 5;
    roughness = (roughness != null) ? roughness : 0.32;
    let points = [from.clone(), to.clone()];
    for (let d = 0; d < depth; d++) {
      const next = [points[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const segLen = a.distanceTo(b);
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const mz = (a.z + b.z) * 0.5;
        _LIGHT_DIR_.subVectors(b, a).normalize();
        if (Math.abs(_LIGHT_DIR_.y) < 0.9) _LIGHT_PERP_.set(0, 1, 0);
        else _LIGHT_PERP_.set(1, 0, 0);
        _LIGHT_R1_.crossVectors(_LIGHT_DIR_, _LIGHT_PERP_).normalize();
        _LIGHT_R2_.crossVectors(_LIGHT_DIR_, _LIGHT_R1_).normalize();
        const theta = Math.random() * Math.PI * 2;
        const offset = segLen * roughness * Math.pow(0.55, d);
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const ox = (cosT * _LIGHT_R1_.x + sinT * _LIGHT_R2_.x) * offset;
        const oy = (cosT * _LIGHT_R1_.y + sinT * _LIGHT_R2_.y) * offset;
        const oz = (cosT * _LIGHT_R1_.z + sinT * _LIGHT_R2_.z) * offset;
        next.push(new THREE.Vector3(mx + ox, my + oy, mz + oz));
        next.push(b);
      }
      points = next;
    }
    return points;
  };

  // ---------------------------------------------------------------
  // _generateLightningBranches : N sub-paths off the main bolt.
  // Each starts at a random interior point and shoots in a random
  // direction for a fraction of the main bolt's length.
  // ---------------------------------------------------------------
  window._generateLightningBranches = function (mainPath, count, lenFrac) {
    const branches = [];
    count = Math.max(0, count | 0);
    lenFrac = (lenFrac != null) ? lenFrac : 0.22;
    if (count === 0 || mainPath.length < 3) return branches;
    const totalLen = mainPath[0].distanceTo(mainPath[mainPath.length - 1]);
    for (let b = 0; b < count; b++) {
      const idx = 1 + Math.floor(Math.random() * (mainPath.length - 2));
      const start = mainPath[idx];
      const dx = Math.random() - 0.5, dy = Math.random() - 0.5, dz = Math.random() - 0.5;
      const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const branchLen = totalLen * lenFrac * (0.7 + Math.random() * 0.6);
      const end = new THREE.Vector3(
        start.x + (dx / dlen) * branchLen,
        start.y + (dy / dlen) * branchLen,
        start.z + (dz / dlen) * branchLen
      );
      branches.push(window._generateLightningPath(start, end, 3, 0.40));
    }
    return branches;
  };

  // ---------------------------------------------------------------
  // _buildLightningTubeGeometry : v17o:23175 verbatim.
  // Hand-built tapered tube — NOT THREE.TubeGeometry. Each path
  // point becomes a ring of `radialSegments` verts. Radius tapers
  // 0.3 → 1.0 → 0.3 via sin(πv) across the bolt length.
  // Returns null on degenerate input.
  // ---------------------------------------------------------------
  window._buildLightningTubeGeometry = function (paths, radius, radialSegments) {
    radialSegments = radialSegments || 8;
    let totalVerts = 0, totalIdx = 0;
    for (let pi = 0; pi < paths.length; pi++) {
      const np = paths[pi].length;
      if (np < 2) continue;
      totalVerts += np * radialSegments;
      totalIdx   += (np - 1) * radialSegments * 6;
    }
    if (totalVerts === 0) return null;
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(totalVerts * 3);
    const uvArr  = new Float32Array(totalVerts * 2);
    const idxArr = (totalVerts > 65535)
      ? new Uint32Array(totalIdx)
      : new Uint16Array(totalIdx);
    let posCur = 0, uvCur = 0, idxCur = 0, vertOffset = 0;
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi];
      if (path.length < 2) continue;
      const numPts = path.length;
      for (let i = 0; i < numPts; i++) {
        let tx, ty, tz;
        if (i === 0)                { tx = path[1].x - path[0].x;  ty = path[1].y - path[0].y;  tz = path[1].z - path[0].z; }
        else if (i === numPts - 1)  { tx = path[i].x - path[i-1].x; ty = path[i].y - path[i-1].y; tz = path[i].z - path[i-1].z; }
        else                        { tx = path[i+1].x - path[i-1].x; ty = path[i+1].y - path[i-1].y; tz = path[i+1].z - path[i-1].z; }
        const tlen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
        tx /= tlen; ty /= tlen; tz /= tlen;
        let rx, ry, rz;
        if (Math.abs(ty) < 0.95) { rx = -tz; ry = 0; rz = tx; }
        else                     { rx = 1;  ry = 0; rz = 0;  }
        let rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
        if (rlen < 0.001) { rx = 1; ry = 0; rz = 0; rlen = 1; }
        rx /= rlen; ry /= rlen; rz /= rlen;
        const ux = ry*tz - rz*ty;
        const uy = rz*tx - rx*tz;
        const uz = rx*ty - ry*tx;
        const v = i / (numPts - 1);
        // Tapered profile : thin tips, full radius in middle.
        const taper = 0.30 + Math.sin(v * Math.PI) * 0.70;
        const r = radius * taper;
        const px = path[i].x, py = path[i].y, pz = path[i].z;
        for (let s = 0; s < radialSegments; s++) {
          const theta = (s / radialSegments) * Math.PI * 2;
          const ct = Math.cos(theta) * r;
          const st = Math.sin(theta) * r;
          posArr[posCur++] = px + rx * ct + ux * st;
          posArr[posCur++] = py + ry * ct + uy * st;
          posArr[posCur++] = pz + rz * ct + uz * st;
          uvArr[uvCur++] = s / radialSegments;
          uvArr[uvCur++] = v;
        }
      }
      for (let i = 0; i < numPts - 1; i++) {
        for (let s = 0; s < radialSegments; s++) {
          const a = vertOffset + i * radialSegments + s;
          const b = vertOffset + i * radialSegments + (s + 1) % radialSegments;
          const c2 = vertOffset + (i + 1) * radialSegments + s;
          const d2 = vertOffset + (i + 1) * radialSegments + (s + 1) % radialSegments;
          idxArr[idxCur++] = a;  idxArr[idxCur++] = c2; idxArr[idxCur++] = b;
          idxArr[idxCur++] = b;  idxArr[idxCur++] = c2; idxArr[idxCur++] = d2;
        }
      }
      vertOffset += numPts * radialSegments;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geom.setAttribute('uv',       new THREE.BufferAttribute(uvArr, 2));
    geom.setIndex(new THREE.BufferAttribute(idxArr, 1));
    return geom;
  };

  // ---------------------------------------------------------------
  // spawnLightningBolt(from, to, color, lifetime, depth, thickness)
  // Single entry point. Generates a jagged path + branches, builds
  // one tapered tube mesh for the whole set, schedules dispose.
  // Spawns a brief midpoint dynamic light so the bolt illuminates
  // surrounding gas.
  // ---------------------------------------------------------------
  window.spawnLightningBolt = function (from, to, color, lifetime, depth, thickness) {
    if (!from || !to || !window.scene) return;
    const c = color || 0x88ccff;
    const life = (typeof lifetime === 'number' && lifetime > 0) ? lifetime : 0.30;
    const dist = from.distanceTo(to);
    // v17o:23867 — subdivision depth scales with bolt length.
    // If caller didn't specify depth, derive same way v17o does.
    const d = (typeof depth === 'number' && depth > 0)
      ? Math.floor(depth)
      : Math.max(3, Math.min(6, Math.round(Math.log2(Math.max(2, dist / 30)))));
    const thick = (typeof thickness === 'number' && thickness > 0) ? thickness : 1.4;
    const mainPath = window._generateLightningPath(from, to, d, 0.32);
    if (mainPath.length < 2) return;
    let branchPaths = [];
    try {
      const branchCount = (Math.random() < 0.35) ? 2 : 1;
      branchPaths = window._generateLightningBranches(mainPath, branchCount, 0.22) || [];
    } catch (_) {}
    const allPaths = branchPaths.length > 0 ? [mainPath].concat(branchPaths) : [mainPath];
    // v17o:23876-23878 : separate halo + core tubes at different radii.
    // Halo : wide + colored. Core : narrow + near-white. Two meshes.
    const haloRadius = thick * 0.5;
    const coreRadius = Math.max(0.35, thick * 0.18);
    const radSegs = (thick > 4) ? 10 : 8;
    try {
      const haloGeom = window._buildLightningTubeGeometry(allPaths, haloRadius, radSegs);
      const coreGeom = window._buildLightningTubeGeometry(allPaths, coreRadius, Math.max(6, radSegs - 2));
      if (!haloGeom || !coreGeom) return;
      // v17o opacities : halo 0.55, core 0.95.
      const haloMat = _makeLightningMaterial(c, 0.55, false);
      const coreMat = _makeLightningMaterial(c, 0.95, true);
      if (!haloMat || !coreMat) {
        // Fallback : TSL imports weren't ready ; render as additive basic.
        const fallbackMat = new THREE.MeshBasicMaterial({
          color: c, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const fallback = new THREE.Mesh(haloGeom, fallbackMat);
        fallback.renderOrder = 4; fallback.frustumCulled = false;
        window.scene.add(fallback);
        if (typeof window._scheduleEffectDispose === 'function') {
          window._scheduleEffectDispose(fallback, life);
        }
        return;
      }
      const halo = new THREE.Mesh(haloGeom, haloMat);
      const core = new THREE.Mesh(coreGeom, coreMat);
      halo.renderOrder = 4;
      core.renderOrder = 5;
      halo.frustumCulled = false;
      core.frustumCulled = false;
      window.scene.add(halo);
      window.scene.add(core);
      if (typeof window._scheduleEffectDispose === 'function') {
        window._scheduleEffectDispose(halo, life);
        window._scheduleEffectDispose(core, life);
      } else if (window.game && window.game.effects) {
        window.game.effects.push({ mesh: halo, type: 'fxstub', age: 0, lifetime: life });
        window.game.effects.push({ mesh: core, type: 'fxstub', age: 0, lifetime: life });
      }
    } catch (_) {}
    // Midpoint dynamic light — same as v17o:23917, scaled to per-tier cap.
    try {
      if (typeof window.spawnDynamicLight === 'function') {
        const mid = from.clone().lerp(to, 0.5);
        const lightIntensity = 0.6 + Math.min(1.3, thick * 0.25);
        window.spawnDynamicLight(mid, c, lightIntensity, 240, Math.min(0.18, life * 0.7));
      }
    } catch (_) {}
  };

  // ------------