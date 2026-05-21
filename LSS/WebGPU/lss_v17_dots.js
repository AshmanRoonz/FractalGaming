// =====================================================================
// LSS v17 Dot anchor system + BillboardCloudSystem
// Ports v17o's spawnDot / Dot / BillboardCloudSystem (v17o:25036 / 10239 / 9964)
// to WebGPU via TSL NodeMaterial. Rendering backend validated by bcs_spike.html.
//
// Goal : one InstancedBufferGeometry pool that EVERY cloud-adjacent system
// (ambient clouds, basin gas, cluster atom-smoke, detached gas pockets,
// ability shield anchors, ambient lightning emitters) renders through.
// Replaces the scattered sprite-array implementation in last_ship_sailing_webGPU.html
// that drifted into ~8 invented substitutes (#318, #326, #329, #331, #332,
// #334, #335, #337).
//
// Boot dependencies, must all be set before this script's window.spawnDot
// is called :
//   - window.THREE     : THREE namespace (loaded as r172 webgpu)
//   - window._tsl      : three/tsl module (TSL imports)
//   - window.scene     : THREE.Scene instance
//   - window.game.dots : array (used as the canonical Dot registry ;
//                         created by main HTML at game-init)
//
// Lazy-init : the BCS singleton (window._dotBCS) is built on the first
// spawnDot call, not at script-load. This avoids races with the main HTML
// boot ordering (scene/renderer might not exist when this script loads).
//
// Public surface :
//   - window.spawnDot(position, opts) → Dot
//   - window.updateDots(dt)
//   - window.disposeAllDots()
//   - window._dotBCS (singleton, for inspection / debug)
//
// IIFE so BCS / Dot classes don't leak to the global namespace.
// =====================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // BCS_MAX_SLOTS : cap on concurrent Dot sprites.
  // v17o uses 8192 ; we start at 2048 which comfortably covers
  // realistic gameplay (cluster atom-smoke ~150 + basin ~200 +
  // ambient ~60 + detached ~100 + headroom). Bump later if needed.
  // ---------------------------------------------------------------
  const BCS_MAX_SLOTS = 2048;
  const BCS_LIGHT_SLOTS = 8;

  // ---------------------------------------------------------------
  // (1) BillboardCloudSystem : the rendering pool.
  // Mirrors v17o's BillboardCloudSystem (v17o:9964) — one
  // InstancedBufferGeometry + NodeMaterial, per-slot attributes for
  // position / scale / color / alpha / seed, and an 8-slot uniform
  // light array that Dots can write into to make their sprites pick
  // up nearby projectile / explosion lights.
  // ---------------------------------------------------------------
  class BillboardCloudSystem {
    constructor(scene, maxSlots) {
      this.scene = scene;
      this.maxSlots = maxSlots || BCS_MAX_SLOTS;

      // Per-slot attribute buffers. position is (x,y,z), color is (r,g,b),
      // scale + alpha + seed are scalars. Initialized to inactive
      // (alpha=0, scale=0) so claimed-but-unset slots don't draw a stray
      // quad at origin.
      this._positions = new Float32Array(this.maxSlots * 3);
      this._scales    = new Float32Array(this.maxSlots);
      this._colors    = new Float32Array(this.maxSlots * 3);
      this._alphas    = new Float32Array(this.maxSlots);
      this._seeds     = new Float32Array(this.maxSlots);

      // Free-list of slot indices. Pop = claim, push = release.
      this._free = [];
      for (let i = this.maxSlots - 1; i >= 0; i--) this._free.push(i);

      // (bugfix 2026-05-20 #356, revised 2026-05-21 #365) Build the
      // instanced geometry by hand WITH a uv attribute. Earlier I
      // removed uv to silence the "AttributeNode: Vertex attribute
      // 'uv' not found" warning, on the theory that the warning was
      // cascading into setIndexBuffer crashes. Turned out the actual
      // cascade source was the ship normal-map (closed in #358).
      // Removing the uv attribute had a real visual cost : I switched
      // colorNode / opacityNode to use `positionLocal.xy + 0.5` as a
      // UV substitute, but `positionLocal` is a VERTEX attribute, so
      // TSL evaluates `mx_noise_float` on it at vertex stage and just
      // interpolates the 4 corner samples across the fragment shader.
      // Result : a smooth gradient across each quad = flat circle,
      // not the wispy noise patches we get when noise runs per
      // fragment. Putting uv back + using the `uv()` node (a real
      // fragment varying) restores per-fragment noise evaluation,
      // which is what makes the gas look like gas.
      // Quad vertices in XY plane at corners ±0.5 :
      //   v0 = (-0.5, -0.5, 0)
      //   v1 = ( 0.5, -0.5, 0)
      //   v2 = (-0.5,  0.5, 0)
      //   v3 = ( 0.5,  0.5, 0)
      // UVs : (0,0) (1,0) (0,1) (1,1) — standard.
      const quadPos = new Float32Array([
        -0.5, -0.5, 0,
         0.5, -0.5, 0,
        -0.5,  0.5, 0,
         0.5,  0.5, 0,
      ]);
      const quadUv = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
      ]);
      const quadIdx = new Uint16Array([0, 1, 2, 2, 1, 3]);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(new THREE.BufferAttribute(quadIdx, 1));
      geo.setAttribute('position', new THREE.BufferAttribute(quadPos, 3));
      geo.setAttribute('uv',       new THREE.BufferAttribute(quadUv, 2));
      geo.instanceCount = this.maxSlots;

      const iPosAttr   = new THREE.InstancedBufferAttribute(this._positions, 3);
      const iScaleAttr = new THREE.InstancedBufferAttribute(this._scales,    1);
      const iColorAttr = new THREE.InstancedBufferAttribute(this._colors,    3);
      const iAlphaAttr = new THREE.InstancedBufferAttribute(this._alphas,    1);
      const iSeedAttr  = new THREE.InstancedBufferAttribute(this._seeds,     1);
      // The mutable attributes need dynamic-draw so per-frame updates are
      // cheap. iSeed is set once at slot-claim and never touched again.
      iPosAttr.setUsage(THREE.DynamicDrawUsage);
      iScaleAttr.setUsage(THREE.DynamicDrawUsage);
      iColorAttr.setUsage(THREE.DynamicDrawUsage);
      iAlphaAttr.setUsage(THREE.DynamicDrawUsage);
      iSeedAttr.setUsage(THREE.StaticDrawUsage);
      geo.setAttribute('iPosition', iPosAttr);
      geo.setAttribute('iScale',    iScaleAttr);
      geo.setAttribute('iColor',    iColorAttr);
      geo.setAttribute('iAlpha',    iAlphaAttr);
      geo.setAttribute('iSeed',     iSeedAttr);
      this._iPos   = iPosAttr;
      this._iSca   = iScaleAttr;
      this._iCol   = iColorAttr;
      this._iAlp   = iAlphaAttr;
      this._iSeed  = iSeedAttr;

      // Build the TSL NodeMaterial. Same pattern as bcs_spike.html :
      // positionNode does camera-facing billboard math, colorNode does
      // FBM noise + per-slot tint + 8-slot light pickup, opacityNode
      // does soft radial alpha modulated by noise so edges read as
      // wispy fractal fingers.
      const tsl = window._tsl;
      if (!tsl) {
        throw new Error('BCS: window._tsl not ready (TSL imports must run before BCS init)');
      }
      const {
        Fn, attribute, uniform,
        vec2, vec3, float,
        positionLocal, cameraPosition, uv,
        mix, smoothstep, length, mx_noise_float,
      } = tsl;
      // (bugfix 2026-05-21 #365) Switched back to `uv()` after #356's
      // positionLocal-based fallback turned out to render flat circles
      // (vertex-stage noise interpolation instead of per-fragment).
      // The geometry now carries the uv attribute again (see geo build
      // above) so this lookup succeeds.
      const quadUV = uv();

      const iPosition = attribute('iPosition');
      const iScale    = attribute('iScale');
      const iColor    = attribute('iColor');
      const iAlpha    = attribute('iAlpha');
      const iSeed     = attribute('iSeed');

      // Light uniforms : 8 dynamic light slots. Each is (position,
      // color, strength). Strength 0 → slot inactive ; the shader still
      // computes the inverse-distance falloff but multiplies by zero
      // so contribution is exactly nil. Drove per-frame by Dot consumers
      // via setLight / clearLight.
      this.uLightPos    = [];
      this.uLightColor  = [];
      this.uLightStr    = [];
      for (let i = 0; i < BCS_LIGHT_SLOTS; i++) {
        this.uLightPos.push(uniform(new THREE.Vector3(0, 0, 0)));
        this.uLightColor.push(uniform(new THREE.Color(0x808080)));
        this.uLightStr.push(uniform(0.0));
      }

      // Position node : camera-facing billboard. Per-vertex position
      // in the quad is in [-0.5, 0.5] ; we project that onto the
      // right/up basis derived from the slot-to-camera direction
      // crossed with world-up. The 0.0001 bias on toCam.z avoids the
      // degenerate cross-product when the camera looks exactly along Y.
      const positionNode = Fn(() => {
        const slotWorld = iPosition;
        const toCam = cameraPosition.sub(slotWorld).normalize();
        const worldUp = vec3(0.0, 1.0, 0.0);
        const camBias = toCam.add(vec3(0.0, 0.0, 0.0001));
        const right = worldUp.cross(camBias).normalize();
        const up    = camBias.cross(right).normalize();
        const local = positionLocal.xy;
        const offset = right.mul(local.x).add(up.mul(local.y)).mul(iScale);
        return slotWorld.add(offset);
      })();

      // Color node : two-octave FBM tinted by iColor + summed 8-slot
      // light contribution. Noise field is sampled in (UV × 4 + seed
      // offset) so adjacent slots read as distinct wispy patches.
      const self = this;
      const colorNode = Fn(() => {
        const centered = quadUV.sub(vec2(0.5, 0.5));
        const noiseP = vec3(
          centered.x.mul(4.0).add(iSeed.mul(31.7)),
          centered.y.mul(4.0).add(iSeed.mul(53.3)),
          iSeed.mul(13.1),
        );
        const n1 = mx_noise_float(noiseP).mul(0.5).add(0.5);
        const n2 = mx_noise_float(noiseP.mul(2.3)).mul(0.5).add(0.5);
        const fbm = n1.mul(0.65).add(n2.mul(0.35));
        // Sum light contributions.
        let lightAdd = vec3(0.0, 0.0, 0.0);
        for (let i = 0; i < BCS_LIGHT_SLOTS; i++) {
          const d = length(self.uLightPos[i].sub(iPosition));
          // Inverse-distance falloff : strong at the slot, decays smoothly.
          // 0.012 sets the half-attenuation at ~80 units.
          const atten = float(1.0).div(d.mul(0.012).add(1.0)).mul(self.uLightStr[i]);
          lightAdd = lightAdd.add(self.uLightColor[i].mul(atten));
        }
        return iColor.mul(fbm.mul(1.4)).add(lightAdd);
      })();

      // Opacity node : soft radial falloff broken up by 3-octave FBM
      // with domain warping so the sprite edge dissolves into wispy
      // fingers and internal cavities rather than reading as a hard
      // disc. Multiplied by iAlpha so per-slot fade control is
      // independent of the shape.
      // (bugfix 2026-05-22 #368) User feedback : "still seeing circles
      // drawn". Previous opacityNode used a single noise sample modulating
      // a smooth radial falloff which still read as a soft circle from
      // any distance. Now : 3-octave FBM + domain warp + power curve
      // applied to BOTH the radial falloff AND the alpha modulator, so
      // (a) the silhouette breaks into irregular tendrils, (b) interior
      // gaps appear so the gas looks volumetric not solid, (c) the
      // edge sometimes extends past the original disc radius via the
      // warp offset, dissolving the circle outline.
      const opacityNode = Fn(() => {
        const centered = quadUV.sub(vec2(0.5, 0.5));
        // Domain warp : sample noise at a position offset by another
        // noise sample. Two-level warp gives the gas its organic
        // tendril shape.
        const warpP1 = vec3(
          centered.x.mul(2.2).add(iSeed.mul(31.7)),
          centered.y.mul(2.2).add(iSeed.mul(53.3)),
          iSeed.mul(13.1),
        );
        const warpX = mx_noise_float(warpP1).mul(0.35);
        const warpY = mx_noise_float(warpP1.add(vec3(5.2, 1.3, 2.8))).mul(0.35);
        const warped = vec2(centered.x.add(warpX), centered.y.add(warpY));
        // 3-octave FBM on the warped coords. Each octave at 2.1× the
        // previous frequency with half the amplitude.
        const np1 = vec3(warped.x.mul(3.5).add(iSeed.mul(7.1)), warped.y.mul(3.5).add(iSeed.mul(11.3)), iSeed.mul(2.9));
        const np2 = np1.mul(2.1);
        const np3 = np2.mul(2.1);
        const n1 = mx_noise_float(np1).mul(0.5).add(0.5);
        const n2 = mx_noise_float(np2).mul(0.5).add(0.5);
        const n3 = mx_noise_float(np3).mul(0.5).add(0.5);
        const fbm = n1.mul(0.55).add(n2.mul(0.30)).add(n3.mul(0.15));
        // Radial falloff with noise-perturbed boundary so the edge is
        // ragged. r' = r - warp * fbm so high-noise patches extend
        // outward beyond the nominal disc.
        const r = length(warped);
        const soft = smoothstep(float(0.55), float(0.0), r);
        // Power curve sharpens the noise so we get distinct fingers
        // and gaps instead of uniform speckle. Then aggressive scale
        // so peak fingers saturate to full opacity while gaps fall
        // below the alphaTest cutoff and read as transparent gas.
        const sharpened = fbm.mul(fbm).mul(2.4);
        return soft.mul(iAlpha).mul(sharpened);
      })();

      const mat = new THREE.NodeMaterial();
      mat.transparent  = true;
      mat.blending     = THREE.AdditiveBlending;
      mat.depthWrite   = false;
      mat.depthTest    = true;
      mat.side         = THREE.DoubleSide;
      mat.positionNode = positionNode;
      mat.colorNode    = colorNode;
      mat.opacityNode  = opacityNode;
      this.material = mat;
      this.geometry = geo;

      // Single mesh in the scene. frustumCulled off because the geometry
      // bounding box is the unit quad ; instance positions span the
      // arena and would be culled wrongly. Cheap : one draw call total
      // for every Dot's every sprite.
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = -5; // behind in-world meshes, in front of skybox
      this.mesh.name = 'BCS';
      // (bugfix 2026-05-20 #348) Pre-tag so the defensive normal sweep
      // (#274 in webGPU.html) skips this mesh. BCS uses a custom
      // positionNode billboard ; it doesn't need vertex normals.
      // computeVertexNormals on an InstancedBufferGeometry can corrupt
      // the index buffer binding and crash setIndexBuffer every frame.
      this.mesh._wgpuNormalSwept = true;
      this.mesh._wgpuSkipNormalCompute = true;
      // Also add a synthetic normal attribute so any downstream code
      // that does `geometry.attributes.normal` (e.g. a fallback
      // pathway in the renderer) finds something valid. All four quad
      // vertices have normal (0, 0, 1) since PlaneGeometry faces +Z.
      try {
        if (!geo.attributes.normal) {
          const nArr = new Float32Array(4 * 3);
          for (let v = 0; v < 4; v++) { nArr[v*3+0] = 0; nArr[v*3+1] = 0; nArr[v*3+2] = 1; }
          geo.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
        }
      } catch (_) {}
      scene.add(this.mesh);

      this.activeSlotCount = 0;
    }

    claimSlot() {
      if (this._free.length === 0) return -1;
      const idx = this._free.pop();
      this.activeSlotCount++;
      return idx;
    }

    releaseSlot(idx) {
      if (idx < 0 || idx >= this.maxSlots) return;
      this._alphas[idx] = 0;
      this._scales[idx] = 0;
      this._iAlp.needsUpdate = true;
      this._iSca.needsUpdate = true;
      this._free.push(idx);
      this.activeSlotCount--;
    }

    setSlot(idx, x, y, z, scale, r, g, b, alpha) {
      const i3 = idx * 3;
      this._positions[i3+0] = x;
      this._positions[i3+1] = y;
      this._positions[i3+2] = z;
      this._scales[idx]     = scale;
      this._colors[i3+0]    = r;
      this._colors[i3+1]    = g;
      this._colors[i3+2]    = b;
      this._alphas[idx]     = alpha;
      this._iPos.needsUpdate = true;
      this._iSca.needsUpdate = true;
      this._iCol.needsUpdate = true;
      this._iAlp.needsUpdate = true;
    }

    setSlotPosition(idx, x, y, z) {
      const i3 = idx * 3;
      this._positions[i3+0] = x;
      this._positions[i3+1] = y;
      this._positions[i3+2] = z;
      this._iPos.needsUpdate = true;
    }

    setSlotSeed(idx, seed) {
      this._seeds[idx] = seed;
      this._iSeed.needsUpdate = true;
    }

    setSlotAlpha(idx, alpha) {
      this._alphas[idx] = alpha;
      this._iAlp.needsUpdate = true;
    }

    setSlotScale(idx, scale) {
      this._scales[idx] = scale;
      this._iSca.needsUpdate = true;
    }

    setSlotColor(idx, r, g, b) {
      const i3 = idx * 3;
      this._colors[i3+0] = r;
      this._colors[i3+1] = g;
      this._colors[i3+2] = b;
      this._iCol.needsUpdate = true;
    }

    setLight(lightIdx, pos, color, strength) {
      if (lightIdx < 0 || lightIdx >= BCS_LIGHT_SLOTS) return;
      try {
        this.uLightPos[lightIdx].value.copy(pos);
        if (color != null) {
          if (typeof color === 'number') this.uLightColor[lightIdx].value.setHex(color);
          else this.uLightColor[lightIdx].value.copy(color);
        }
        this.uLightStr[lightIdx].value = strength;
      } catch (_) {}
    }

    clearLight(lightIdx) {
      if (lightIdx < 0 || lightIdx >= BCS_LIGHT_SLOTS) return;
      this.uLightStr[lightIdx].value = 0;
    }
  }

  // ---------------------------------------------------------------
  // (2) Dot : anchor for a multi-sprite cloud + behavior state.
  // Mirrors v17o:25036 spawnDot/Dot. One Dot can :
  //   - claim N BCS slots as its visible body (default 8)
  //   - drift under velocity
  //   - age toward lifetime ; fade out / scale-grow on age
  //   - emit lightning to other Dots within interArcRange
  //   - attract toward other Dots within attractRange
  //   - attach external meshes (e.g. an ability shield clone)
  //   - hue-cycle its slot colors (e.g. plasma anomalies)
  // ---------------------------------------------------------------
  class Dot {
    constructor(position, opts) {
      opts = opts || {};
      const bcs = window._dotBCS;
      if (!bcs) {
        // Lazy init path : main HTML hasn't built BCS yet. Caller
        // should ensure window.scene + window._tsl are ready before
        // spawnDot is called the first time.
        throw new Error('Dot: BCS not initialized yet');
      }

      // Anchor object for world position + attached meshes. Not added
      // to the scene by default ; only added if attachMesh is called.
      this.anchor = new THREE.Object3D();
      this.anchor.position.copy(position);
      this.position = this.anchor.position; // alias for ergonomic access

      this.velocity = opts.velocity ? opts.velocity.clone() : new THREE.Vector3();

      // Lifecycle.
      this.lifetime       = opts.lifetime != null ? opts.lifetime : Infinity;
      this.growthDuration = opts.growthDuration || 0;
      this.age            = 0;
      this.alive          = true;

      // Cloud body.
      this.boundsRadius   = opts.boundsRadius || opts.radius || 40;
      const baseColor     = (opts.color != null) ? opts.color : 0x808080;
      this.color          = new THREE.Color(baseColor);
      this.colorJitter    = opts.colorJitter || 0.0;
      this.baseAlpha      = (opts.alpha != null) ? opts.alpha : 0.65;
      this.segments       = opts.segments || 8;
      this.spriteScale    = opts.spriteScale || (this.boundsRadius * 1.5);
      this.spriteScaleVar = opts.spriteScaleVar || 0.5;

      // Scale / fade.
      this.scaleGrowth    = opts.scaleGrowth || null; // { baseScale, maxFactor }
      this.fadeOut        = opts.fadeOut || null;     // { alphaMul }

      // Physics flags (consumers read these ; the Dot itself doesn't
      // do collision — that's the consumer's job).
      this.collidable = !!opts.collidable;
      this.playerWake = !!opts.playerWake;

      // Lightning emitter state ; ticked by updateDots.
      this.emitsLightning = !!opts.emitsLightning;
      this.arcRadius      = opts.arcRadius || (this.boundsRadius * 0.5);
      this.interArcRange  = opts.interArcRange || 900;
      // Spark cadence in seconds ; randomized initial value so adjacent
      // Dots don't all fire together. Matches v17o GAS_SPARK_INTERVAL_*.
      this.sparkTimer     = (opts.sparkTimer != null)
        ? opts.sparkTimer
        : (12 + Math.random() * 18);

      // Attraction.
      this.clusterAttraction = !!opts.clusterAttraction;
      this.attractStrength   = opts.attractStrength || 10;
      this.attractRange      = opts.attractRange || (this.boundsRadius * 5);
      this.orbitBoost        = opts.orbitBoost || 0;
      this._latticeNeighbors = 0;  // recomputed each frame by attraction pass

      // Hue cycle (e.g. ambient cloud Dots tint over time).
      this.hueCycleMaterial = opts.hueCycleMaterial || false;
      this.hueSpeed         = opts.hueSpeed || 0;
      this.huePhase         = Math.random() * Math.PI * 2;

      // Markers (no behavior — just flags for callers).
      this._isAmbientCloud = !!opts._isAmbientCloud;
      this._isBasinCloud   = !!opts._isBasinCloud;
      this.userData        = opts.userData || {};

      // Claim BCS slots. Each slot owns a local offset within the
      // bounds volume + per-axis Lissajous drift phases so the cloud
      // body looks alive even when stationary.
      this.slots = [];
      for (let i = 0; i < this.segments; i++) {
        const idx = bcs.claimSlot();
        if (idx < 0) break;  // BCS full ; ship with what we have
        // Cube-root distribution for uniform density in volume.
        const u = Math.random();
        const v = Math.random();
        const phi = Math.acos(2 * v - 1);
        const theta = u * Math.PI * 2;
        const r = Math.cbrt(Math.random()) * this.boundsRadius;
        const off = new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
        );
        // Per-slot scale variance.
        const scaleMul = (1.0 - this.spriteScaleVar) + Math.random() * (2 * this.spriteScaleVar);
        const slotScale = this.spriteScale * scaleMul;
        // Per-slot alpha variance.
        const slotAlpha = this.baseAlpha * (0.7 + Math.random() * 0.5);
        // Per-slot color jitter (luminance shift).
        const jitter = (Math.random() - 0.5) * 2.0 * this.colorJitter;
        const sr = Math.max(0, Math.min(1, this.color.r + jitter));
        const sg = Math.max(0, Math.min(1, this.color.g + jitter));
        const sb = Math.max(0, Math.min(1, this.color.b + jitter));
        // Per-axis Lissajous drift for "alive even when still" motion.
        const slot = {
          idx,
          off,
          baseScale: slotScale,
          baseAlpha: slotAlpha,
          // wakeOff is the transient impulse from ship / projectile
          // wakes ; settles back to zero over ~1 sec via the wake-decay
          // in updateDots.
          wakeOff: new THREE.Vector3(),
          driftPhaseX: Math.random() * 6.28318,
          driftPhaseY: Math.random() * 6.28318,
          driftPhaseZ: Math.random() * 6.28318,
          driftSpeed:  0.15 + Math.random() * 0.30,
          driftAmp:    this.boundsRadius * (0.10 + Math.random() * 0.18),
        };
        this.slots.push(slot);
        // Initial setSlot writes ALL attributes ; setSlotPosition each
        // tick after that only writes position.
        const ax = this.position.x + off.x;
        const ay = this.position.y + off.y;
        const az = this.position.z + off.z;
        bcs.setSlot(idx, ax, ay, az, slotScale, sr, sg, sb, slotAlpha);
        bcs.setSlotSeed(idx, Math.random());
      }

      // Optional attached meshes (e.g. a hull-hug shield clone attached
      // to a Dot acting as the anchor). Added to / removed from the
      // anchor Object3D.
      this.attachedMeshes = [];

      // Register on game.dots. Consumers walk this for chemistry,
      // attraction, rendering coordination, round-rebuild cleanup.
      if (typeof window.game !== 'undefined' && window.game) {
        if (!Array.isArray(window.game.dots)) window.game.dots = [];
        window.game.dots.push(this);
      }
    }

    attachMesh(mesh) {
      if (!mesh) return;
      this.attachedMeshes.push(mesh);
      this.anchor.add(mesh);
      if (this.anchor.parent !== window.scene && window.scene) {
        window.scene.add(this.anchor);
      }
    }

    // Update slot positions from current anchor.position + per-slot
    // offset + wakeOff + drift. Called by updateDots each frame.
    _tickSlotPositions(time) {
      const bcs = window._dotBCS;
      if (!bcs) return;
      const px = this.position.x;
      const py = this.position.y;
      const pz = this.position.z;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        const sp = s.driftSpeed;
        const dx = Math.sin(time * sp + s.driftPhaseX) * s.driftAmp;
        const dy = Math.sin(time * sp * 1.3 + s.driftPhaseY) * s.driftAmp * 0.55;
        const dz = Math.sin(time * sp * 0.85 + s.driftPhaseZ) * s.driftAmp;
        bcs.setSlotPosition(s.idx,
          px + s.off.x + s.wakeOff.x + dx,
          py + s.off.y + s.wakeOff.y + dy,
          pz + s.off.z + s.wakeOff.z + dz);
      }
    }

    // Apply per-slot scale + alpha based on the current lifecycle
    // state (growth, fade, hue cycle). Called by updateDots each frame
    // only when something actually changed (age increments, hue cycles).
    _tickSlotAppearance(time, ageT) {
      const bcs = window._dotBCS;
      if (!bcs) return;

      // Scale modifier from scaleGrowth recipe.
      let scaleMul = 1.0;
      if (this.scaleGrowth) {
        const sg = this.scaleGrowth;
        const baseFactor = sg.baseScale ? (sg.baseScale / this.spriteScale) : 1.0;
        const grow = 1.0 + ageT * ((sg.maxFactor || 1.0) - 1.0);
        scaleMul = baseFactor * grow;
      }

      // Alpha modifier : smoothstep bloom-in over growthDuration for
      // infinite-lifetime Dots, quadratic fade-out for finite ones.
      let alphaMul;
      if (this.fadeOut && isFinite(this.lifetime)) {
        const inv = 1.0 - ageT;
        alphaMul = inv * inv * (this.fadeOut.alphaMul || 1.0);
      } else {
        // Smooth bloom-in. tNorm = ageT (which is capped at 1 over growthDuration).
        const t = Math.min(1, ageT);
        alphaMul = t * t * (3 - 2 * t);
      }

      // Optional hue cycling (e.g. ambient anomaly Dots).
      let hueShift = 0;
      if (this.hueCycleMaterial && this.hueSpeed > 0) {
        hueShift = Math.sin(time * this.hueSpeed + this.huePhase) * 0.5 + 0.5;
      }

      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        const finalScale = s.baseScale * scaleMul;
        const finalAlpha = s.baseAlpha * alphaMul;
        bcs.setSlotScale(s.idx, finalScale);
        bcs.setSlotAlpha(s.idx, finalAlpha);
        if (this.hueCycleMaterial && this.hueSpeed > 0) {
          // Cycle through a cheap hue shift in HSL space. Keeps the
          // base hue from this.color, just rotates by hueShift.
          const c = _hueCycleScratch;
          c.copy(this.color);
          c.offsetHSL(hueShift * 0.5, 0, 0);
          bcs.setSlotColor(s.idx, c.r, c.g, c.b);
        }
      }
    }

    // Release the BCS slots back to the pool + detach any attached
    // meshes. After dispose the Dot is dead and should be spliced out
    // of game.dots by updateDots.
    dispose() {
      if (!this.alive) return;
      this.alive = false;
      const bcs = window._dotBCS;
      if (bcs) {
        for (let i = 0; i < this.slots.length; i++) {
          bcs.releaseSlot(this.slots[i].idx);
        }
      }
      this.slots.length = 0;
      // Tear down attached meshes (shield clones, etc.).
      for (const m of this.attachedMeshes) {
        if (m.parent) m.parent.remove(m);
        // Don't dispose geometry — it may be shared (e.g. mesh-tree
        // mirror clones share geometry refs with the source).
        if (m.material && m.material._dotOwned && m.material.dispose) {
          try { m.material.dispose(); } catch (_) {}
        }
      }
      this.attachedMeshes.length = 0;
      if (this.anchor.parent) this.anchor.parent.remove(this.anchor);
    }
  }
  const _hueCycleScratch = new THREE.Color();

  // ---------------------------------------------------------------
  // (3) Lazy BCS init. First call to spawnDot builds the BCS if
  // window.scene + window._tsl are ready. Throws a clear error if
  // they aren't (boot ordering issue).
  // ---------------------------------------------------------------
  function _ensureBCS() {
    if (window._dotBCS) return window._dotBCS;
    if (!window.scene) {
      throw new Error('Dot: window.scene not ready');
    }
    if (!window._tsl) {
      throw new Error('Dot: window._tsl not ready (TSL imports must succeed first)');
    }
    if (typeof window.THREE === 'undefined') {
      throw new Error('Dot: window.THREE not ready');
    }
    const bcs = new BillboardCloudSystem(window.scene, BCS_MAX_SLOTS);
    window._dotBCS = bcs;
    console.log('[dots] BCS initialized :', bcs.maxSlots, 'slots');
    return bcs;
  }

  // ---------------------------------------------------------------
  // (4) Public API
  // ---------------------------------------------------------------

  // Spawn a Dot at position with opts. Returns the Dot instance.
  // Throws if BCS infrastructure isn't ready ; caller should wrap in
  // try/catch during boot transitions.
  window.spawnDot = function (position, opts) {
    // (Debug toggle) Skip the whole dot system when LSS_DOTS_DISABLED is
    // set (via `?clouds=off` URL param at boot, or window flip from
    // devtools). Returns null so callers that store the result get a
    // falsy and can early-out. Used to A/B test whether the cloud
    // system is the perf hog.
    if (window.LSS_DOTS_DISABLED) return null;
    _ensureBCS();
    if (!position) throw new Error('spawnDot: position required');
    return new Dot(position, opts || {});
  };

  // Per-frame tick. Iterates game.dots, ages each Dot, applies velocity,
  // updates slot positions / appearance, disposes when lifetime expires.
  // Cluster attraction + lightning chemistry are SEPARATE passes that
  // can run from this tick OR from caller code ; for now we keep them
  // external (legacy paths still in webGPU.html).
  window.updateDots = function (dt) {
    if (window.LSS_DOTS_DISABLED) return;
    if (!window.game || !Array.isArray(window.game.dots) || window.game.dots.length === 0) return;
    const dots = window.game.dots;
    const time = (window.game && typeof window.game.time === 'number')
      ? window.game.time
      : (performance.now() * 0.001);
    const _dt = (typeof dt === 'number' && dt > 0) ? dt : 0.016;
    // Wake decay constant : sprite wakeOff decays toward zero with
    // ~1 sec time constant. Matches v17o updateBCSWakes.
    const wakeDecay = Math.pow(0.30, _dt);
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      if (!d || !d.alive) {
        dots.splice(i, 1);
        continue;
      }
      d.age += _dt;
      // Lifetime expiry. Infinite lifetime never expires.
      if (isFinite(d.lifetime) && d.age >= d.lifetime) {
        d.dispose();
        dots.splice(i, 1);
        continue;
      }
      // Integrate velocity into position.
      if (d.velocity.lengthSq() > 0.0001) {
        d.position.x += d.velocity.x * _dt;
        d.position.y += d.velocity.y * _dt;
        d.position.z += d.velocity.z * _dt;
        // Mild drag so dots don't fly forever. 0.97^60 per sec.
        d.velocity.multiplyScalar(Math.pow(0.97, _dt));
      }
      // Decay per-slot wakeOff back toward zero.
      for (let s = 0; s < d.slots.length; s++) {
        d.slots[s].wakeOff.multiplyScalar(wakeDecay);
      }
      // Update slot positions every frame so drift + wake oscillation
      // animate even for stationary Dots.
      d._tickSlotPositions(time);
      // Recompute scale + alpha less often (only when something changes
      // visibly). For now we tick it every frame ; can be throttled.
      const ageT = d.growthDuration > 0
        ? Math.min(1, d.age / d.growthDuration)
        : 1.0;
      // For finite-lifetime Dots, ageT also drives the fade-out phase.
      const finiteAgeT = isFinite(d.lifetime)
        ? Math.min(1, d.age / d.lifetime)
        : ageT;
      d._tickSlotAppearance(time, isFinite(d.lifetime) ? finiteAgeT : ageT);
      // Decrement spark cooldown so emitters can fire arcs (consumed
      // by external chemistry pass).
      if (d.emitsLightning && d.sparkTimer > 0) {
        d.sparkTimer -= _dt;
      }
    }
  };

  // Dispose all Dots. Called from round-rebuild cleanup
  // (_resetSceneForNewRound). Cheap : disposes each Dot's slots back
  // to the BCS free list + drops the array.
  window.disposeAllDots = function () {
    if (!window.game || !Array.isArray(window.game.dots)) return;
    for (let i = 0; i < window.game.dots.length; i++) {
      const d = window.game.dots[i];
      if (d && d.alive) {
        try { d.dispose(); } catch (_) {}
      }
    }
    window.game.dots.length = 0;
  };

})();

      const d = window.game.dots[i];
      if (d && d.alive) {
        try { d.dispose(); } catch (_) {}
      }
    }
    window.game.dots.length = 0;
  };

  // Expose the Dot class for type-check / inspection. The BCS is
  // exposed via window._dotBCS once initialized.
  window.LSSDot = Dot;

  console.log('[dots] lss_v17_dots.js loaded ; spawnDot ready (BCS lazy-init on first call)');
})();

      const d = window.game.dots[i];
      if (d && d.alive) {
        try { d.dispose(); } catch (_) {}
      }
    }
    window.game.dots.length = 0;
  };

})();
