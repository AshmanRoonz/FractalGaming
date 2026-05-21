// v17 weapon firing system + Projectile class
// Extracted verbatim from last_ship_sailing_v17.html

// ----- Projectile class -----
class Projectile {
  constructor(origin, velocity, damage, splash, owner, color) {
    this.position = origin.clone();
    this.velocity = velocity.clone();
    this.damage = damage;
    this.splash = splash;
    this.owner = owner;
    this.alive = true;
    this.lifetime = 5;
    this.age = 0;
    this.bounceCount = 0;
    // (v14c) Visual flags ; defaults preserve legacy look. Spawn sites for
    // specific weapons can flip these post-construction:
    //   smokeTrail = true ; emit fading smoke puffs along the flight path.
    //                       Used by Pyro/Tracker/Puncture/Syphon heavy shots.
    //   _smokeTrailTimer is the per-frame emission accumulator.
    this.smokeTrail = false;
    this._smokeTrailTimer = 0;
    this._smokeTrailInterval = 0.045; // fallback time interval for slow / stationary projectiles
    // (v16a Phase S) Distance-based emission. Fast rockets used to leave
    // big 3D-space gaps between puffs because emission was time-only ;
    // firing directly away from the camera made the trail read as
    // "frame-skipping" because consecutive puffs projected to nearly the
    // same screen pixel until perspective separated them. Emitting per N
    // world units traveled keeps the trail visually continuous.
    this._smokeTrailMinDist = 18;
    this._smokeTrailLastEmitPos = null; // initialized on first frame to spawn position
    this._smokeTrailMaxPuffsPerFrame = 4; // cap for absurd single-frame deltas (alt-tab catch-up)
    // Fade-in: projectile is invisible at the muzzle and ramps to full
    // opacity over the first FADE_IN_DIST world units.
    this.spawnOrigin = origin.clone();
    this.fadeInDist = 80;
    this._fadeInDone = false;
    // Visual size multiplier — applied to the core / glow / haze scales
    // each frame on top of the base pulse animation.
    this.sizeMult = 1.0;

    // (v15 MP color fix) Stash spawn color on the instance.
    this.color = color || 0xffaa00;
    // (v16c Phase I) Reuse shared core geometry. Material is per-instance.
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.mesh = new THREE.Mesh(_SHARED_PROJ_CORE_GEO, mat);
    this.mesh.position.copy(origin);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    // --- Enhanced multi-segment ribbon trail (per-vertex color gradient) ---
    this.trailColor = color || 0xffaa00;
    const trailSegs = 14;
    this.trailSegs = trailSegs;
    this.trailPositions = new Float32Array(trailSegs * 3);
    for (let i = 0; i < trailSegs; i++) {
      this.trailPositions[i*3] = origin.x;
      this.trailPositions[i*3+1] = origin.y;
      this.trailPositions[i*3+2] = origin.z;
    }
    const trailColors = new Float32Array(trailSegs * 3);
    const headCol = new THREE.Color(this.trailColor);
    for (let i = 0; i < trailSegs; i++) {
      const t = 1.0 - (i / (trailSegs - 1));
      const fade = t * t;
      trailColors[i*3]   = headCol.r * fade;
      trailColors[i*3+1] = headCol.g * fade;
      trailColors[i*3+2] = headCol.b * fade;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      linewidth: 1
    });
    this.trail = new THREE.Line(trailGeo, trailMat);
    this.trail.renderOrder = 1;
    this.trail.visible = false;
    scene.add(this.trail);
    this.trailTimer = 0;

    // --- Inner glow halo (LayeredFX proj_glow preset) ---
    const glowMat = _makeFXMaterial('proj_glow');
    if (glowMat.uniforms.uBaseColor) glowMat.uniforms.uBaseColor.value.set(this.trailColor);
    if (glowMat.uniforms.uPosScale)  glowMat.uniforms.uPosScale.value = 1.0 / 7.0;
    this.glowMesh = new THREE.Mesh(_SHARED_PROJ_GLOW_GEO, glowMat);
    this.glowMesh.position.copy(origin);
    this.glowMesh.renderOrder = 1;
    scene.add(this.glowMesh);

    // --- Outer volumetric haze (wide, very soft) ---
    const hazeMat = new THREE.MeshBasicMaterial({ color: this.trailColor, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    this.hazeMesh = new THREE.Mesh(_SHARED_PROJ_HAZE_GEO, hazeMat);
    this.hazeMesh.position.copy(origin);
    this.hazeMesh.renderOrder = 1;
    scene.add(this.hazeMesh);

    // Cache base opacities for fade-in math.
    this._baseOpacityCore   = mat.opacity;
    this._baseOpacityGlow   = glowMat.opacity;
    this._baseOpacityHaze   = hazeMat.opacity;
    this._baseOpacityTrail  = trailMat.opacity;
    this._baseOpacityRibbon = 0.85;

    // --- Tube ribbon trail (Effect 07) ---
    this.trailRibbonBaseWidth = 5.5;
    this.trailRibbonPositions = new Float32Array(trailSegs * 2 * 3);
    const ribbonColors = new Float32Array(trailSegs * 2 * 3);
    const ribbonHeadCol = new THREE.Color(this.trailColor);
    for (let i = 0; i < trailSegs; i++) {
      const tt = 1.0 - (i / (trailSegs - 1));
      const fade = tt * tt;
      const r = ribbonHeadCol.r * fade;
      const g = ribbonHeadCol.g * fade;
      const b = ribbonHeadCol.b * fade;
      ribbonColors[(i * 2)     * 3]     = r;
      ribbonColors[(i * 2)     * 3 + 1] = g;
      ribbonColors[(i * 2)     * 3 + 2] = b;
      ribbonColors[(i * 2 + 1) * 3]     = r;
      ribbonColors[(i * 2 + 1) * 3 + 1] = g;
      ribbonColors[(i * 2 + 1) * 3 + 2] = b;
    }
    const ribbonIndices = new Uint16Array((trailSegs - 1) * 6);
    for (let i = 0; i < trailSegs - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      ribbonIndices[i * 6]     = a;
      ribbonIndices[i * 6 + 1] = b;
      ribbonIndices[i * 6 + 2] = c;
      ribbonIndices[i * 6 + 3] = b;
      ribbonIndices[i * 6 + 4] = d;
      ribbonIndices[i * 6 + 5] = c;
    }
    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.BufferAttribute(this.trailRibbonPositions, 3));
    ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribbonColors, 3));
    ribbonGeo.setIndex(new THREE.BufferAttribute(ribbonIndices, 1));
    const ribbonMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.trailRibbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    this.trailRibbon.frustumCulled = false;
    this.trailRibbon.renderOrder = 1;
    scene.add(this.trailRibbon);

    // --- Per-projectile electric arc emitter ---
    this.electricArcTimer = 0.05 + Math.random() * 0.10;
  }

  update(dt) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age > this.lifetime) {
      if (this.isSonar && typeof _spawnSonarPulse === 'function') {
        _spawnSonarPulse(this.position, this.owner);
      }
      this.destroy(); return;
    }

    // (v16a Phase FF) Drop tube ribbon for smoke-trail projectiles.
    if (this.smokeTrail && this.trailRibbon) {
      if (this.trailRibbon.parent) scene.remove(this.trailRibbon);
      if (this.trailRibbon.geometry) this.trailRibbon.geometry.dispose();
      if (this.trailRibbon.material) this.trailRibbon.material.dispose();
      this.trailRibbon = null;
      this.trailRibbonPositions = null;
    }

    // (v16a Phase HH) Drop bright pinpoint core on Salvo Core missiles.
    if (this.salvoGuided && this.mesh) {
      if (this.mesh.parent) scene.remove(this.mesh);
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
      this.mesh = null;
    }

    // (v14c) Smoke-trail emission with v16a Phase S hybrid distance+time.
    if (this.smokeTrail && typeof spawnFXBurst === 'function') {
      this._smokeTrailTimer -= dt;
      const _szM = this.sizeMult || 1.0;
      const _puffR = 5 * _szM;
      const _emitPuff = (px, py, pz) => {
        const puff = spawnFXBurst('cloud', { x: px, y: py, z: pz }, _puffR, 0.65, {
          startScale: 0.4, endScale: 1.6, segs: 12,
        });
        if (puff && puff.material && puff.material.uniforms && puff.material.uniforms.uBaseColor) {
          puff.material.uniforms.uBaseColor.value.set(this.trailColor);
        }
      };
      if (!this._smokeTrailLastEmitPos) {
        this._smokeTrailLastEmitPos = this.position.clone();
        _emitPuff(this.position.x, this.position.y, this.position.z);
        this._smokeTrailTimer = this._smokeTrailInterval;
      } else {
        const lx = this._smokeTrailLastEmitPos.x;
        const ly = this._smokeTrailLastEmitPos.y;
        const lz = this._smokeTrailLastEmitPos.z;
        const dx = this.position.x - lx;
        const dy = this.position.y - ly;
        const dz = this.position.z - lz;
        const moved = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (moved >= this._smokeTrailMinDist) {
          const want = Math.min(this._smokeTrailMaxPuffsPerFrame, Math.floor(moved / this._smokeTrailMinDist));
          for (let i = 1; i <= want; i++) {
            const t = i / want;
            _emitPuff(lx + dx * t, ly + dy * t, lz + dz * t);
          }
          this._smokeTrailLastEmitPos.copy(this.position);
          this._smokeTrailTimer = this._smokeTrailInterval;
        } else if (this._smokeTrailTimer <= 0) {
          _emitPuff(this.position.x, this.position.y, this.position.z);
          this._smokeTrailLastEmitPos.copy(this.position);
          this._smokeTrailTimer = this._smokeTrailInterval;
        }
      }
    }

    // Homing missiles (Descent 3 style two-tier tracking)
    if (this.tracking && this.trackTarget && this.trackTarget.alive) {
      const toTarget = _projToTarget.subVectors(this.trackTarget.position, this.position);
      const dist = toTarget.length();
      const toTargetDir = toTarget.normalize();
      const speed = this.velocity.length();
      const curDir = _projDir.copy(this.velocity).normalize();
      const dot = curDir.dot(toTargetDir);

      const CLOSE_DIST = 800;
      const MAX_DIST = 3000;
      let turnRate, fovThreshold;

      if (dist < CLOSE_DIST) {
        turnRate = 5.0;
        fovThreshold = -0.3;
      } else if (dist < MAX_DIST) {
        turnRate = 3.0;
        fovThreshold = 0.2;
      } else {
        turnRate = 1.5;
        fovThreshold = 0.5;
      }

      if (dot > fovThreshold) {
        this.velocity.lerp(toTargetDir.multiplyScalar(speed), turnRate * dt);
        this.velocity.normalize().multiplyScalar(speed);
      }
    }

    // Mega Tracker Rockets remote guidance
    if (this.salvoGuided) {
      const aimDir = _projAimDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const speed = this.velocity.length();
      this.velocity.lerp(aimDir.multiplyScalar(speed), 6.0 * dt);
      this.velocity.normalize().multiplyScalar(speed);
    }

    const prevPos = _projPrev.copy(this.position);
    this.position.add(_projStep.copy(this.velocity).multiplyScalar(dt));
    if (this.mesh) this.mesh.position.copy(this.position);

    if (this.isFireSource) {
      igniteNearbyGas(this.position, 150);
    }

    // --- Shift trail positions forward ---
    this.trailTimer += dt;
    if (this.trailTimer > 0.016) {
      this.trailTimer = 0;
      const positions = this.trail.geometry.attributes.position.array;
      positions.copyWithin(3, 0, positions.length - 3);
      positions[0] = this.position.x;
      positions[1] = this.position.y;
      positions[2] = this.position.z;
      this.trail.geometry.attributes.position.needsUpdate = true;
    }

    // --- Fade-in ---
    let _fadeIn = 1;
    if (!this._fadeInDone && this.spawnOrigin && this.fadeInDist > 0) {
      const fadeDistSq = this.fadeInDist * this.fadeInDist;
      const distFromSpawnSq = this.position.distanceToSquared(this.spawnOrigin);
      if (distFromSpawnSq >= fadeDistSq) {
        _fadeIn = 1;
        this._fadeInDone = true;
      } else {
        _fadeIn = Math.sqrt(distFromSpawnSq) / this.fadeInDist;
      }
      if (this.mesh) this.mesh.material.opacity = this._baseOpacityCore * _fadeIn;
      if (this.glowMesh) {
        const gu = this.glowMesh.material.uniforms;
        if (gu && gu.uBrightness) {
          if (gu._fxBaseBrightness == null) gu._fxBaseBrightness = gu.uBrightness.value;
          gu.uBrightness.value = gu._fxBaseBrightness * _fadeIn;
        } else if (typeof this.glowMesh.material.opacity === 'number') {
          this.glowMesh.material.opacity = this._baseOpacityGlow * _fadeIn;
        }
      }
      if (this.hazeMesh)    this.hazeMesh.material.opacity    = this._baseOpacityHaze   * _fadeIn;
      if (this.trail)       this.trail.material.opacity       = this._baseOpacityTrail  * _fadeIn;
      if (this.trailRibbon) this.trailRibbon.material.opacity = this._baseOpacityRibbon * _fadeIn;
    }

    const _szM = this.sizeMult || 1.0;
    if (this.mesh) {
      const corePulse = 1 + Math.sin(this.age * 28) * 0.18 + (Math.random() - 0.5) * 0.10;
      this.mesh.scale.setScalar(corePulse * _szM);
    }
    if (this.glowMesh) {
      this.glowMesh.position.copy(this.position);
      const haloFlicker = 1 + Math.sin(this.age * 22) * 0.18 + (Math.random() - 0.5) * 0.18;
      this.glowMesh.scale.setScalar(haloFlicker * _szM);
      if (this.glowMesh.material && this.glowMesh.material.uniforms && this.glowMesh.material.uniforms.time) {
        this.glowMesh.material.uniforms.time.value = (typeof game !== 'undefined' && game.time) ? game.time : this.age;
      }
    }
    if (this.hazeMesh) {
      this.hazeMesh.position.copy(this.position);
      const hazePulse = 1 + Math.sin(this.age * 8) * 0.10;
      this.hazeMesh.scale.setScalar(hazePulse * _szM);
    }

    // --- Tube ribbon trail update with near-camera fade + far-cull early-out ---
    if (this.trailRibbon && this.trailRibbonPositions) {
      const linePos = this.trail.geometry.attributes.position.array;
      const ribbonPos = this.trailRibbonPositions;
      const camPos = camera.position;
      const segs = this.trailSegs;
      const baseW = this.trailRibbonBaseWidth;
      const NEAR_FADE_END   = 30;
      const NEAR_FADE_START = 110;
      const RIBBON_CULL_DIST_SQ = 9_000_000;
      const headDX = linePos[0] - camPos.x;
      const headDY = linePos[1] - camPos.y;
      const headDZ = linePos[2] - camPos.z;
      const headDistSq = headDX*headDX + headDY*headDY + headDZ*headDZ;
      const tailIdx = (segs - 1) * 3;
      const tailDX = linePos[tailIdx]     - camPos.x;
      const tailDY = linePos[tailIdx + 1] - camPos.y;
      const tailDZ = linePos[tailIdx + 2] - camPos.z;
      const tailDistSq = tailDX*tailDX + tailDY*tailDY + tailDZ*tailDZ;
      if (headDistSq > RIBBON_CULL_DIST_SQ && tailDistSq > RIBBON_CULL_DIST_SQ) {
        // far ribbon ; keep last frame's data
      } else {
        for (let i = 0; i < segs; i++) {
          const px = linePos[i * 3];
          const py = linePos[i * 3 + 1];
          const pz = linePos[i * 3 + 2];
          let dx, dy, dz;
          if (i < segs - 1) {
            dx = linePos[(i + 1) * 3]     - px;
            dy = linePos[(i + 1) * 3 + 1] - py;
            dz = linePos[(i + 1) * 3 + 2] - pz;
          } else {
            dx = px - linePos[(i - 1) * 3];
            dy = py - linePos[(i - 1) * 3 + 1];
            dz = pz - linePos[(i - 1) * 3 + 2];
          }
          const tcx = camPos.x - px;
          const tcy = camPos.y - py;
          const tcz = camPos.z - pz;
          const camDistSq = tcx * tcx + tcy * tcy + tcz * tcz;
          let camFade;
          if (camDistSq >= NEAR_FADE_START * NEAR_FADE_START) camFade = 1;
          else if (camDistSq <= NEAR_FADE_END * NEAR_FADE_END) camFade = 0;
          else {
            const camDist = Math.sqrt(camDistSq);
            camFade = (camDist - NEAR_FADE_END) / (NEAR_FADE_START - NEAR_FADE_END);
            camFade = camFade * camFade * (3 - 2 * camFade);
          }
          let nx = dy * tcz - dz * tcy;
          let ny = dz * tcx - dx * tcz;
          let nz = dx * tcy - dy * tcx;
          const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (nlen > 1e-4) { nx /= nlen; ny /= nlen; nz /= nlen; }
          else { nx = 1; ny = 0; nz = 0; }
          const tt = 1.0 - (i / (segs - 1));
          const w = baseW * (0.30 + 0.70 * tt) * camFade;
          ribbonPos[(i * 2) * 3]     = px + nx * w;
          ribbonPos[(i * 2) * 3 + 1] = py + ny * w;
          ribbonPos[(i * 2) * 3 + 2] = pz + nz * w;
          ribbonPos[(i * 2 + 1) * 3]     = px - nx * w;
          ribbonPos[(i * 2 + 1) * 3 + 1] = py - ny * w;
          ribbonPos[(i * 2 + 1) * 3 + 2] = pz - nz * w;
        }
        this.trailRibbon.geometry.attributes.position.needsUpdate = true;
      }
    }

    // --- Periodic mini lightning arc crackling off the projectile ---
    if (!this.isArcWave) {
      this.electricArcTimer -= dt;
      if (this.electricArcTimer <= 0) {
        const arcLen = 50 + Math.random() * 80;
        const arcEnd = _projArcEnd.set(
          this.position.x + (Math.random() - 0.5) * arcLen,
          this.position.y + (Math.random() - 0.5) * arcLen,
          this.position.z + (Math.random() - 0.5) * arcLen
        );
        spawnLightningBolt(this.position, arcEnd, this.trailColor, 0.08, 1, 0.9);
        this.electricArcTimer = 0.25 + Math.random() * 0.15;
      }
    }

    // Emit trail particles
    if (Math.random() < 0.30) {
      const useWhite = Math.random() < 0.35;
      game.particles.push({
        position: this.position.clone(),
        velocity: _pVel((Math.random()-0.5)*30, (Math.random()-0.5)*30, (Math.random()-0.5)*30),
        life: 0.10 + Math.random() * 0.12,
        maxLife: 0.22,
        color: useWhite ? 0xffffff : this.trailColor,
        size: 1.4 + Math.random() * 1.2
      });
    }

    // Stun Bolt arc effects (Slayer)
    if (this.isArcWave) {
      if (!this.arcLightTimer) this.arcLightTimer = 0;
      this.arcLightTimer -= dt;
      if (this.arcLightTimer <= 0) {
        const ahead = this.velocity.clone().normalize().multiplyScalar(120 + Math.random() * 80);
        const boltEnd = this.position.clone().add(ahead).add(
          new THREE.Vector3((Math.random()-0.5)*80, (Math.random()-0.5)*80, (Math.random()-0.5)*80)
        );
        spawnLightningBolt(this.position, boltEnd, LSS.CLASS_COLORS.SLAYER, 0.10, 1, 1.5);
        if (Math.random() > 0.7) {
          const wallArc = this.position.clone().add(
            new THREE.Vector3((Math.random()-0.5)*200, (Math.random()-0.5)*200, (Math.random()-0.5)*200)
          );
          spawnLightningBolt(this.position, wallArc, 0x22cc44, 0.08, 0, 0.8);
        }
        this.arcLightTimer = 0.14 + Math.random() * 0.08;
      }
      // (v11c) Persistent chain along the path.
      if (!this._arcTrailAnchor) this._arcTrailAnchor = this.position.clone();
      const _trailDist2 = this.position.distanceToSquared(this._arcTrailAnchor);
      if (_trailDist2 > 70 * 70) {
        spawnLightningBolt(this._arcTrailAnchor, this.position, LSS.CLASS_COLORS.SLAYER,
                           0.50 + Math.random() * 0.20, 3 + Math.floor(Math.random() * 3), 2.0 + Math.random() * 1.0);
        if (Math.random() > 0.55) {
          const _side = this.position.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220,
          ));
          spawnLightningBolt(this.position, _side, 0x22cc44,
                             0.30 + Math.random() * 0.15, 1 + Math.floor(Math.random() * 2), 1.0);
        }
        this._arcTrailAnchor = this.position.clone();
      }
      for (let sp = 0; sp < 2; sp++) {
        game.particles.push({
          position: this.position.clone(),
          velocity: _pVel((Math.random()-0.5)*200, (Math.random()-0.5)*200, (Math.random()-0.5)*200),
          life: 0.08 + Math.random() * 0.06,
          maxLife: 0.14,
          color: Math.random() > 0.5 ? LSS.CLASS_COLORS.SLAYER : 0xaaffaa,
          size: 1 + Math.random() * 1.5
        });
      }
    }

    // Wall collision via CSG-aware raycast
    const moveDir = _projDir.copy(this.velocity).normalize();
    const moveDist = _projStep.length();
    if (moveDist > 0.1) {
      const wallDist = raycastLevel(prevPos, moveDir, moveDist + 5);
      if (wallDist < moveDist) {
        const hitPoint = _projHitPoint.copy(prevPos).addScaledVector(moveDir, Math.max(0, wallDist - 2));
        if (this.isSonar) {
          this.position.copy(hitPoint);
          if (this.mesh) this.mesh.position.copy(hitPoint);
          if (typeof _spawnSonarPulse === 'function') _spawnSonarPulse(hitPoint, this.owner);
          this.destroy();
          return;
        }
        const shouldExplode = this.isCluster || this.isArcWave || this.tracking || this.salvoGuided || this.isPyroThermite || (this.splash > 0 && !this.isFireSource);

        if (shouldExplode) {
          this.position.copy(hitPoint);
          if (this.mesh) this.mesh.position.copy(hitPoint);
          if (this.isCluster) this.spawnClusterChildren();
          if (this.splash > 0) this.splashDamage();
          spawnImpactSparks(hitPoint, 8);
          if (typeof playSpatialSound === 'function') playSpatialSound('damage', hitPoint.clone(), { refDistance: 220, maxDistance: 4000 });
          else playSound('damage');
          this.destroy();
          return;
        } else {
          this.bounceCount++;
          if (this.bounceCount > 3) { this.destroy(); return; }
          const normal = getWallNormal(hitPoint);
          const vn = this.velocity.dot(normal);
          this.velocity.addScaledVector(normal, -2 * vn);
          this.velocity.multiplyScalar(this.isFireSource ? 0.75 : 0.5);
          this.position.copy(hitPoint).addScaledVector(normal, 3);
          if (this.mesh) this.mesh.position.copy(this.position);
          spawnImpactSparks(hitPoint, 4);
        }
      }
    }
    const levelHit = checkBoxCollision(this.position, 5);
    if (levelHit) {
      if (this.isCluster) this.spawnClusterChildren();
      if (this.splash > 0) this.splashDamage();
      this.destroy();
      return;
    }

    // (v9) Plasma Shield interception
    if (this.owner !== 'player' && !this.isSonar) {
      for (const eff of game.worldEffects) {
        if (eff.type !== 'particle_wall' || eff.owner !== 'player' || eff.hp <= 0) continue;
        const wallNormal = eff.direction;
        const dx1 = prevPos.x - eff.position.x;
        const dy1 = prevPos.y - eff.position.y;
        const dz1 = prevPos.z - eff.position.z;
        const prevSide = dx1 * wallNormal.x + dy1 * wallNormal.y + dz1 * wallNormal.z;
        const dx2 = this.position.x - eff.position.x;
        const dy2 = this.position.y - eff.position.y;
        const dz2 = this.position.z - eff.position.z;
        const currSide = dx2 * wallNormal.x + dy2 * wallNormal.y + dz2 * wallNormal.z;
        if (prevSide * currSide > 0) continue;
        const denom = prevSide - currSide;
        if (Math.abs(denom) < 1e-6) continue;
        const tParam = prevSide / denom;
        if (tParam < 0 || tParam > 1) continue;
        const intersect = new THREE.Vector3().lerpVectors(prevPos, this.position, tParam);
        const offCenter = new THREE.Vector3().subVectors(intersect, eff.position);
        offCenter.sub(wallNormal.clone().multiplyScalar(offCenter.dot(wallNormal)));
        const wallRadius = 240;
        if (offCenter.lengthSq() > wallRadius * wallRadius) continue;
        const absorbed = Math.min(this.damage, eff.hp);
        eff.hp -= absorbed;
        if (eff.hp <= 0) {
          if (eff.mesh && eff.mesh.parent) scene.remove(eff.mesh);
          if (eff.edgeMesh && eff.edgeMesh.parent) scene.remove(eff.edgeMesh);
          if (eff.plasmaMesh && eff.plasmaMesh.parent) {
            scene.remove(eff.plasmaMesh);
            if (eff.plasmaMesh.material && eff.plasmaMesh.material.dispose) eff.plasmaMesh.material.dispose();
          }
          eff.timer = 0;
        }
        spawnImpactSparks(intersect, 6);
        this.position.copy(intersect);
        if (this.mesh) this.mesh.position.copy(intersect);
        this.destroy();
        return;
      }
    }

    if (this.owner === 'player') {
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        if (this.isArcWave && this._arcHitBots && this._arcHitBots.has(bot.id)) continue;
        // (v16a Phase R/R2) Two-phase unshielded collision : OBB broad-phase
        // + mesh raycast narrow-phase for direct-hit ; v16 distance check
        // for splash-heavy ordnance to avoid close-range salvo lag.
        const hitRadius = bot.chassis.hullLength * 1.2;
        const hasShield = bot.shield > 0;
        const _usesSplashSlop = (this.splash || 0) >= 25;
        let isHit;
        if (hasShield || _usesSplashSlop) {
          isHit = this.position.distanceToSquared(bot.position) < hitRadius * hitRadius;
        } else {
          const inBroadOBB = _pointInsideShipOBB(this.position, bot, { w: 1.4, h: 1.1, l: 1.4 });
          isHit = inBroadOBB && _swepRayHitsShipMesh(this.position, this.velocity, bot.mesh);
        }
        if (isHit) {
          if (this.isSonar) {
            if (typeof _spawnSonarPulse === 'function') _spawnSonarPulse(bot.position, this.owner);
            this.destroy();
            return;
          }
          const hadShield = bot.shield > 0;
          const dealt = bot.takeDamage(this.damage, 'player', this.position);
          if (dealt > 0) {
            player.damageDealt += dealt;
            player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
            showHitMarker();
            if (!hadShield) spawnImpactSparks(this.position, 5);
          }
          this._hitShipBot = bot;
          // TRACKER Tracking Bolt locks
          if (player.loadoutKey === 'TRACKER' &&
              !this.isArcWave && !this.isCluster &&
              !this.tracking && !this.salvoGuided && !this.isSonar &&
              game.state === 'playing') {
            const prevLocks = player.trackerLocks[bot.id] || 0;
            player.trackerLocks[bot.id] = Math.min(3, prevLocks + 1);
            if (player.trackerLocks[bot.id] > prevLocks) {
              playSound('sonar_ping_' + player.trackerLocks[bot.id]);
            }
            if (player.trackerLocks[bot.id] >= 3) player.trackerLockedTarget = bot;
          }
          // Stun Bolt slow
          if (this.isArcWave && bot.velocity) {
            bot.velocity.multiplyScalar(0.3);
            bot.arcSlowTimer = 2.0;
            try {
              if (typeof playSpatialSound === 'function') playSpatialSound('stun', bot.position);
              else playSound('stun');
            } catch (e) {}
          }
          // Stun Bolt counters: destroy Plasma / Body Shields near hit
          if (this.isArcWave) {
            for (let we = game.worldEffects.length - 1; we >= 0; we--) {
              const eff = game.worldEffects[we];
              if (eff.type === 'particle_wall' && eff.team !== player.team && this.position.distanceToSquared(eff.position) < 400 * 400) {
                eff.hp = 0; eff.timer = 0;
                if (eff.mesh && eff.mesh.parent) scene.remove(eff.mesh);
                if (eff.edgeMesh && eff.edgeMesh.parent) scene.remove(eff.edgeMesh);
                if (eff.plasmaMesh && eff.plasmaMesh.parent) {
                  scene.remove(eff.plasmaMesh);
                  if (eff.plasmaMesh.material && eff.plasmaMesh.material.dispose) eff.plasmaMesh.material.dispose();
                }
                spawnExplosion(eff.position, 20);
              }
            }
          }
          if (!bot.alive) showKillMarker();
          if (this.isCluster) this.spawnClusterChildren();
          if (this.splash > 0) this.splashDamage();
          // (v11c) Stun Bolt pierces ships
          if (this.isArcWave) {
            if (!this._arcHitBots) this._arcHitBots = new Set();
            this._arcHitBots.add(bot.id);
            continue;
          }
          this.destroy();
          return;
        }
      }

      // Dynamic obstacle collisions
      for (const dynObj of game.dynamicObjects) {
        if (!dynObj.alive) continue;
        const checkDist = dynObj.collisionRadius || 60;
        if (this.position.distanceToSquared(dynObj.position) < checkDist * checkDist) {
          const dealt = dynObj.takeDamage(this.damage);
          if (dealt > 0) {
            player.damageDealt += dealt;
            player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
            showHitMarker();
            spawnImpactSparks(this.position, 3);
          }
          if (this.isCluster) this.spawnClusterChildren();
          if (this.splash > 0) this.splashDamage();
          this.destroy();
          return;
        }
      }
    } else if (this.owner !== 'player' && player.shipState !== 'dead') {
      // Hostile projectile hitting player
      const hitRadius = player.chassis.hullLength * 1.2;
      const hasShield = player.shield > 0;
      const _usesSplashSlop = (this.splash || 0) >= 25;
      let isHit;
      if (hasShield || _usesSplashSlop) {
        isHit = this.position.distanceToSquared(player.position) < hitRadius * hitRadius;
      } else {
        const inBroadOBB = _pointInsideShipOBB(this.position, player, { w: 1.4, h: 1.1, l: 1.4 });
        isHit = inBroadOBB && _swepRayHitsShipMesh(this.position, this.velocity, player.mesh);
      }
      if (isHit) {
        playerTakeDamage(this.damage, this.owner, this);
        if (this.isCluster) this.spawnClusterChildren();
        this.destroy();
        return;
      }
    }

    const s = LSS.ARENA_SIZE;
    if (Math.abs(this.position.x) > s || Math.abs(this.position.y) > s || Math.abs(this.position.z) > s) {
      this.destroy();
    }
  }

  spawnClusterChildren() {
    // PUNCTURE Cluster Missile : sustained explosion zone + fireworks burst
    try {
      if (typeof playSpatialSound === 'function') playSpatialSound('cluster_split', this.position.clone());
      else playSound('cluster_split');
    } catch (_) {}
    const dmgPerSec = this.clusterDmg || 80;
    const duration = this.clusterDuration || 3;
    game.worldEffects.push({
      type: 'cluster', position: this.position.clone(),
      timer: duration, dmgPerSec: dmgPerSec, radius: 250,
      owner: this.owner, team: player.team, fxTimer: 0,
    });
    spawnExplosion(this.position, 25);
    if (typeof spawnFireworksBurst === 'function') {
      spawnFireworksBurst(this.position, 280);
    }
  }

  splashDamage() {
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const distSq = this.position.distanceToSquared(bot.position);
      if (distSq < this.splash * this.splash && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const falloff = 1 - dist / this.splash;
        const dealt = bot.takeDamage(this.damage * 0.75 * falloff, 'player');
        if (dealt > 0) {
          player.damageDealt += dealt;
          player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
          showHitMarker();
        }
      }
    }
    igniteNearbyGas(this.position, this.splash);
  }

  // (v14c) Dispose outer haze sphere on demand (heavy projectiles).
  removeHaze() {
    if (this.hazeMesh) {
      if (this.hazeMesh.parent) scene.remove(this.hazeMesh);
      if (this.hazeMesh.geometry) this.hazeMesh.geometry.dispose();
      if (this.hazeMesh.material) this.hazeMesh.material.dispose();
      this.hazeMesh = null;
    }
  }

  destroy() {
    this.alive = false;
    // (v16c Phase I) core/glow/haze geos are shared module-level constants ;
    // do NOT dispose them. Materials are per-instance.
    if (this.mesh && this.mesh.parent) {
      scene.remove(this.mesh);
      if (this.mesh.material) this.mesh.material.dispose();
    }
    if (this.trail && this.trail.parent) {
      scene.remove(this.trail);
      if (this.trail.geometry) this.trail.geometry.dispose();
      if (this.trail.material) this.trail.material.dispose();
    }
    if (this.glowMesh && this.glowMesh.parent) {
      scene.remove(this.glowMesh);
      this.glowMesh.material.dispose();
    }
    if (this.hazeMesh && this.hazeMesh.parent) {
      scene.remove(this.hazeMesh);
      this.hazeMesh.material.dispose();
    }
    if (this.trailRibbon && this.trailRibbon.parent) {
      scene.remove(this.trailRibbon);
      if (this.trailRibbon.geometry) this.trailRibbon.geometry.dispose();
      if (this.trailRibbon.material) this.trailRibbon.material.dispose();
    }
    // (v14g) Hull-clamped impact when projectile destroyed by ship hit.
    let _exPos = this.position;
    let _exSize = this.isPyroThermite ? 22 : 15;
    if (this._hitShipBot && this._hitShipBot.position && this._hitShipBot.chassis) {
      const _surfaceR = this._hitShipBot.chassis.hullLength * 0.5;
      const _toHit = this.position.clone().sub(this._hitShipBot.position);
      const _len = _toHit.length();
      if (_len > 0.001) {
        _toHit.multiplyScalar(_surfaceR / _len);
        _exPos = this._hitShipBot.position.clone().add(_toHit);
      } else {
        _exPos = this._hitShipBot.position.clone();
      }
      _exSize = this.isPyroThermite ? 9 : 6;
    }
    spawnExplosion(_exPos, _exSize);
    if (this.isPyroThermite && typeof spawnPyroFlame === 'function') {
      spawnPyroFlame(_exPos);
    }
  }
}


// ----- next block -----

// ----- fireWeapon dispatcher -----
function fireWeapon() {
  // No primary fire during the pre-round warmup countdown
  if (game.state === 'warmup') return;
  const w = player.weapon;
  const origin = player.position.clone();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

  // (v6.7) Per-chassis muzzle flash.
  emitChassisMuzzleFlash(player.loadoutKey, origin, forward);

  if (w.mode === 'hitscan') fireHitscan(origin, forward, w);
  else if (w.mode === 'projectile') fireProjectile(origin, forward, w);
  else if (w.mode === 'spread') fireSpread(origin, forward, w);

  // HUD gun muzzle flash
  player.muzzleFlashTimer = 0.08;
  player.muzzleFlashSide = 1 - player.muzzleFlashSide;
  if (player.muzzleFlashSide === 0) player.gunRecoilL = 1.0;
  else player.gunRecoilR = 1.0;

  // ---- WEAPON FEEDBACK ----
  // NB: route through pooled dynamicLights to avoid re-triggering the
  // NUM_POINT_LIGHTS shader-recompile storm on every shot.
  const flashPos = origin.clone().add(forward.clone().multiplyScalar(30));
  const flashColor = w.mode === 'hitscan' ? 0xffdd44 : 0xff8833;
  spawnDynamicLight(flashPos, flashColor, 3.0, 400, 0.08);

  // Camera recoil
  const recoilAmount = w.mode === 'spread' ? 0.015 : (w.fireRate > 0.5 ? 0.025 : 0.005);
  player.euler.x -= recoilAmount;

  // Screen shake
  triggerScreenShake(w.mode === 'spread' ? 1.5 : (w.fireRate > 0.5 ? 1.0 : 0.3));

  // Muzzle particles
  for (let i = 0; i < 3; i++) {
    const pVel = forward.clone().multiplyScalar(300 + Math.random() * 200);
    pVel.x += (Math.random() - 0.5) * 80;
    pVel.y += (Math.random() - 0.5) * 80;
    pVel.z += (Math.random() - 0.5) * 80;
    game.particles.push({
      position: flashPos.clone(),
      velocity: pVel,
      life: 0.1 + Math.random() * 0.05,
      maxLife: 0.15,
      color: flashColor,
      size: 3 + Math.random() * 3
    });
  }

  // PYRO extra fire particles for projectile mains
  if (player.loadoutKey === 'PYRO' && w.mode === 'projectile') {
    const fireColors = [0xff4400, 0xff6600, 0xff8833];
    for (let i = 0; i < 4; i++) {
      const pVel = forward.clone().multiplyScalar(250 + Math.random() * 150);
      pVel.x += (Math.random() - 0.5) * 100;
      pVel.y += (Math.random() - 0.5) * 100;
      pVel.z += (Math.random() - 0.5) * 100;
      game.particles.push({
        position: flashPos.clone(),
        velocity: pVel,
        life: 0.15 + Math.random() * 0.1,
        maxLife: 0.25,
        color: fireColors[Math.floor(Math.random() * fireColors.length)],
        size: 4 + Math.random() * 3
      });
    }
  }
}


// ----- next block -----

// ----- fireHitscan -----
function fireHitscan(origin, dir, w) {
  let aimDir = dir.clone();
  if (w.spread && w.spread > 0) {
    aimDir.x += (Math.random() - 0.5) * w.spread;
    aimDir.y += (Math.random() - 0.5) * w.spread;
    aimDir.z += (Math.random() - 0.5) * w.spread;
    aimDir.normalize();
  }
  const levelDist = raycastLevel(origin, aimDir, w.range);
  const end = origin.clone().add(aimDir.clone().multiplyScalar(levelDist));
  const tracerColor = chassisFlashColor(player.loadoutKey);
  const isChaingun = (w.fireRate <= 0.10);
  // (v11d) Puncture uses helical spiral instead of standard tracer
  if (player.loadoutKey === 'PUNCTURE') {
    // (v17) Anchor LOCAL spiral to painted railgun muzzle, not player.position.
    const frac = _PLAYER_MAIN_MUZZLE_FRAC.PUNCTURE;
    const localFrom = (frac && typeof _computeScreenMuzzleWorld === 'function')
      ? (_computeScreenMuzzleWorld(frac.x, frac.y) || origin)
      : origin;
    _spawnRailgunSpiral(localFrom, end, tracerColor);
  } else {
    spawnTracer(origin, end, tracerColor, isChaingun ? 0.55 : 1.0);
  }
  // (v6.7) Hitscan tracer broadcast (visual only ; damage via hit-claim).
  if (net.active && net.sendEvent) {
    net.sendEvent({
      type: 'fire_tracer',
      ox: origin.x, oy: origin.y, oz: origin.z,
      ex: end.x,    ey: end.y,    ez: end.z,
      color: tracerColor,
      lo: player.loadoutKey,
    });
  }

  // Destructible obstacle check
  let bestObstacle = null, bestObstDist = Infinity;
  for (const obj of game.dynamicObjects) {
    if (!obj.alive) continue;
    const toObj = new THREE.Vector3().subVectors(obj.position, origin);
    const proj = toObj.dot(aimDir);
    if (proj < 0 || proj > Math.min(w.range, levelDist)) continue;
    const closest = origin.clone().add(aimDir.clone().multiplyScalar(proj));
    const dist = closest.distanceTo(obj.position);
    if (dist < (obj.collisionRadius || 60) && proj < bestObstDist) {
      bestObstacle = obj;
      bestObstDist = proj;
    }
  }
  // (bugfix 2026-05-20 #306, hardened in #317) Cluster obstacle hitscan
  // collision. v17's fireHitscan only walked game.dynamicObjects which
  // is empty in the WebGPU port (clusters own all rocks), so laser /
  // gatling / railgun tracers passed straight through asteroids.
  // The cluster's child mesh is a child of cl.group which has a
  // tumbling rotation, so child.position is LOCAL ; world position
  // must come from child.mesh.getWorldPosition() rather than
  // cl.position + child.position (the latter ignores group rotation,
  // making aim tests miss the moment the cluster spins even slightly).
  const _childW = new THREE.Vector3();
  let bestClusterHit = null, bestClusterDist = Infinity, bestClusterChild = null;
  if (game.clusters && game.clusters.length) {
    for (const cl of game.clusters) {
      if (!cl || !cl.alive || !cl.children || !cl.children.length) continue;
      if (cl.group) cl.group.updateMatrixWorld(true);
      const toCl = new THREE.Vector3().subVectors(cl.position, origin);
      const proj = toCl.dot(aimDir);
      if (proj < 0 || proj > Math.min(w.range, levelDist)) continue;
      const reachR = (cl.clusterScale || 60) * 1.1;
      const closest = origin.clone().add(aimDir.clone().multiplyScalar(proj));
      const distSq = closest.distanceToSquared(cl.position);
      if (distSq > reachR * reachR) continue;
      for (const c of cl.children) {
        if (!c.alive || !c.mesh) continue;
        c.mesh.getWorldPosition(_childW);
        const toChild = _childW.clone().sub(origin);
        const childProj = toChild.dot(aimDir);
        if (childProj < 0 || childProj > Math.min(w.range, levelDist)) continue;
        const cClosest = origin.clone().add(aimDir.clone().multiplyScalar(childProj));
        const cdist = cClosest.distanceToSquared(_childW);
        const cr = (c.scale || 30) * 0.85;
        if (cdist < cr * cr && childProj < bestClusterDist) {
          bestClusterHit = cl;
          bestClusterDist = childProj;
          bestClusterChild = c;
        }
      }
    }
  }
  // If a cluster hit beats the bestObstacle, the beam stops at the
  // cluster impact and the standard "obstacle blocks shot" branch below
  // (line ~1069) calls takeDamage + spawns sparks + spawnExplosion.
  // ClusterObstacle.takeDamage(amount) breaks one alive child via #307.
  // (#306 originally fired its own impact ; removed to avoid double-fire
  // since the bestObstacle path already lands the same effects.)
  if (bestClusterHit && bestClusterDist < bestObstDist) {
    bestObstacle = bestClusterHit;
    bestObstDist = bestClusterDist;
  }

  // (v14f) PUNCTURE pierces ; damage every ship along the line.
  const isPiercing = (player.loadoutKey === 'PUNCTURE');

  let bestHit = null, bestDist = Infinity;
  const pierceHits = [];
  const lineMax = Math.min(w.range, levelDist, bestObstacle ? bestObstDist : Infinity);
  for (const bot of game.entities) {
    if (!bot.alive || bot.team === player.team) continue;
    const toBot = new THREE.Vector3().subVectors(bot.position, origin);
    const proj = toBot.dot(aimDir);
    if (proj < 0 || proj > lineMax) continue;
    const closest = origin.clone().add(aimDir.clone().multiplyScalar(proj));
    const dist = closest.distanceTo(bot.position);
    if (dist < bot.chassis.hullLength * 0.7) {
      if (isPiercing) pierceHits.push({ bot, proj });
      else if (proj < bestDist) { bestHit = bot; bestDist = proj; }
    }
  }

  // (v14f) Pierce branch
  if (isPiercing && pierceHits.length > 0) {
    pierceHits.sort((a, b) => a.proj - b.proj);
    let chargeMul = 1.0;
    if (player.railgunCharge > 0) {
      chargeMul = 1.0 + player.railgunCharge * 3.0;
      player.railgunCharge = 0;
      if (player._railgunChargeAudio) {
        try { _stopRailgunChargeSound(player._railgunChargeAudio); } catch (_) {}
        player._railgunChargeAudio = null;
      }
    }
    for (let i = 0; i < pierceHits.length; i++) {
      const h = pierceHits[i];
      const bot = h.bot;
      const hitDist = h.proj;
      const rangeFalloff = 0.7 + 0.3 * Math.max(0, 1 - hitDist / w.range);
      let finalDmg = w.damage * rangeFalloff * chargeMul;
      if (player.syphonDmgMult > 1) finalDmg *= player.syphonDmgMult;
      if (player.syphonArcRounds && bot.shield > 0) finalDmg *= 1.5;
      const hadShield = bot.shield > 0;
      // (v14g) Hit point on visible HULL SURFACE.
      const _closest = origin.clone().add(aimDir.clone().multiplyScalar(hitDist));
      const _surfR = bot.chassis.hullLength * 0.5;
      const _toClosest = _closest.clone().sub(bot.position);
      const _len = _toClosest.length();
      const hitPoint = (_len > 0.001)
        ? bot.position.clone().add(_toClosest.multiplyScalar(_surfR / _len))
        : bot.position.clone();
      const dealt = bot.takeDamage(finalDmg, 'player', hitPoint);
      if (dealt > 0) {
        player.damageDealt += dealt;
        player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
        showHitMarker();
      }
      // (v16d) Puncture Railgun impact signature scaled with charge.
      const _puncChargeBoost = Math.min(1.6, 1.0 + (chargeMul - 1.0) * 0.5);
      spawnExplosion(hitPoint, 50 * _puncChargeBoost);
      if (typeof spawnHullBurst === 'function') {
        spawnHullBurst(hitPoint, 0xffffff, 110 * _puncChargeBoost);
        spawnHullBurst(hitPoint, LSS.CLASS_COLORS.PUNCTURE, 85 * _puncChargeBoost);
      }
      if (!hadShield && typeof spawnImpactSparks === 'function') {
        spawnImpactSparks(hitPoint, Math.round(16 * _puncChargeBoost));
      }
      spawnDynamicLight(hitPoint, LSS.CLASS_COLORS.PUNCTURE, 5.5 * _puncChargeBoost, 900, 0.4);
      if (!bot.alive) showKillMarker();
    }
    if (bestObstacle) {
      let finalDmg = w.damage * chargeMul;
      if (player.syphonDmgMult > 1) finalDmg *= player.syphonDmgMult;
      const hitPt = origin.clone().add(aimDir.clone().multiplyScalar(bestObstDist));
      // (bugfix 2026-05-20 #312) Cluster vs dynamicObject signature
      // split. Cluster.takeDamage(amount, attacker, projectile) doesn't
      // return dealt damage ; pass hitPt as projectile.position so #307
      // picks the closest alive child. Credit damage to player so the
      // core meter responds.
      if (bestObstacle.constructor && bestObstacle.constructor.name === 'ClusterObstacle') {
        bestObstacle.takeDamage(finalDmg, 'player', { position: hitPt });
        player.damageDealt += finalDmg;
        player.coreMeter = Math.min(100, player.coreMeter + finalDmg / 100);
      } else {
        const dealt = bestObstacle.takeDamage(finalDmg);
        if (dealt > 0) {
          player.damageDealt += dealt;
          player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
        }
      }
      spawnExplosion(hitPt, 8);
      spawnImpactSparks(hitPt, 4);
    }
    return;
  }

  // Obstacle blocks shot
  if (bestObstacle && bestObstDist < bestDist) {
    let finalDmg = w.damage;
    if (player.loadoutKey === 'PUNCTURE' && player.railgunCharge > 0) {
      finalDmg *= 1.0 + player.railgunCharge * 3.0;
      player.railgunCharge = 0;
      if (player._railgunChargeAudio) {
        try { _stopRailgunChargeSound(player._railgunChargeAudio); } catch (_) {}
        player._railgunChargeAudio = null;
      }
    }
    if (player.syphonDmgMult > 1) finalDmg *= player.syphonDmgMult;
    const hitPt = origin.clone().add(aimDir.clone().multiplyScalar(bestObstDist));
    // (bugfix 2026-05-20 #312) Same split as the pierce branch above.
    if (bestObstacle.constructor && bestObstacle.constructor.name === 'ClusterObstacle') {
      bestObstacle.takeDamage(finalDmg, 'player', { position: hitPt });
      player.damageDealt += finalDmg;
      player.coreMeter = Math.min(100, player.coreMeter + finalDmg / 100);
      showHitMarker();
    } else {
      const dealt = bestObstacle.takeDamage(finalDmg);
      if (dealt > 0) {
        player.damageDealt += dealt;
        player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
        showHitMarker();
      }
    }
    spawnExplosion(hitPt, 8);
    spawnImpactSparks(hitPt, 4);
    return;
  }

  if (bestHit) {
    const hitDist = bestDist;
    const rangeFalloff = 0.7 + 0.3 * Math.max(0, 1 - hitDist / w.range);
    let finalDmg = w.damage * rangeFalloff;
    if (player.loadoutKey === 'VORTEX' && player.vortexAdsActive) finalDmg *= 1.75;
    if (player.loadoutKey === 'PUNCTURE' && player.railgunCharge > 0) {
      finalDmg *= 1.0 + player.railgunCharge * 3.0;
      player.railgunCharge = 0;
      if (player._railgunChargeAudio) {
        try { _stopRailgunChargeSound(player._railgunChargeAudio); } catch (_) {}
        player._railgunChargeAudio = null;
      }
    }
    if (player.syphonDmgMult > 1) finalDmg *= player.syphonDmgMult;
    if (player.syphonArcRounds && bestHit.shield > 0) finalDmg *= 1.5;

    const hadShield = bestHit.shield > 0;
    // (v14g) HULL SURFACE hit point.
    const _closest = origin.clone().add(aimDir.clone().multiplyScalar(bestDist));
    const _surfR = bestHit.chassis.hullLength * 0.5;
    const _toClosest = _closest.clone().sub(bestHit.position);
    const _len = _toClosest.length();
    const hitPoint = (_len > 0.001)
      ? bestHit.position.clone().add(_toClosest.multiplyScalar(_surfR / _len))
      : bestHit.position.clone();
    const dealt = bestHit.takeDamage(finalDmg, 'player', hitPoint);
    if (dealt > 0) {
      player.damageDealt += dealt;
      player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
      showHitMarker();
    }
    spawnExplosion(hitPoint, 8);
    if (!hadShield) spawnImpactSparks(hitPoint, 4);

    if (player.loadoutKey === 'VORTEX') {
      for (let i = 0; i < 3; i++) {
        const sparkDir = new THREE.Vector3(
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.8
        ).normalize();
        const sparkVel = sparkDir.multiplyScalar(150 + Math.random() * 100);
        game.particles.push({
          position: hitPoint.clone(),
          velocity: sparkVel,
          life: 0.15 + Math.random() * 0.1,
          maxLife: 0.25,
          color: 0x44ddff,
          size: 1.5 + Math.random() * 1.5
        });
      }
    }

    if (!bestHit.alive) showKillMarker();
  }
}


// ----- next block -----

// ----- fireProjectile -----
function fireProjectile(origin, dir, w) {
  const vel = dir.clone().multiplyScalar(w.projSpeed);
  const projColor = (player.loadoutKey === 'PYRO')    ? LSS.CLASS_COLORS.PYRO
                  : (player.loadoutKey === 'TRACKER') ? LSS.CLASS_COLORS.TRACKER
                  : LSS.CLASS_COLORS.TRACKER;
  const proj = new Projectile(origin, vel, w.damage, w.splash, 'player', projColor);
  if (player.loadoutKey === 'PYRO') {
    proj.isFireSource = true;
    proj.isPyroThermite = true;
  }
  proj.smokeTrail = true;
  proj.removeHaze();
  game.projectiles.push(proj);
  // (v6.7) Broadcast visual twin ; damage stays with hit-claim path.
  if (net.active && net.sendProjectile) {
    net.sendProjectile({
      ox: origin.x, oy: origin.y, oz: origin.z,
      vx: vel.x,   vy: vel.y,   vz: vel.z,
      color: projColor,
      isFireSource:   !!proj.isFireSource,
      isPyroThermite: !!proj.isPyroThermite,
      splash:         (typeof proj.splash === 'number') ? proj.splash : 0,
      tracking:       !!proj.tracking,
      salvoGuided:    !!proj.salvoGuided,
      isCluster:      !!proj.isCluster,
      isArcWave:      !!proj.isArcWave,
      isSonar:        !!proj.isSonar,
      sizeMult:       (typeof proj.sizeMult === 'number') ? proj.sizeMult : 1.0,
    });
  }
}


// ----- next block -----

// ----- fireSpread -----
function fireSpread(origin, dir, w) {
  for (let i = 0; i < w.pellets; i++) {
    // Descent 3 style rotation matrix spread
    const spreadAngle = 0.08;
    const pitch = (Math.random() - 0.5) * spreadAngle;
    const heading = (Math.random() - 0.5) * spreadAngle;
    const bank = (Math.random() - 0.5) * spreadAngle * 0.5;
    const rotQ = new THREE.Quaternion();
    const euler = new THREE.Euler(pitch, heading, bank, 'YXZ');
    rotQ.setFromEuler(euler);
    const spreadDir = dir.clone().applyQuaternion(rotQ).normalize();

    const levelDist = raycastLevel(origin, spreadDir, w.range);
    const end = origin.clone().add(spreadDir.clone().multiplyScalar(levelDist));
    // (v6.7) Spread weapons spawn a particle burst instead of a long tracer.
    spawnPelletBurst(origin, spreadDir, levelDist);
    if (net.active && net.sendEvent) {
      net.sendEvent({
        type: 'pellet_burst',
        ox: origin.x, oy: origin.y, oz: origin.z,
        dx: spreadDir.x, dy: spreadDir.y, dz: spreadDir.z,
        range: levelDist,
      });
    }

    let hitObstacle = false;
    let bestObstDist = Infinity;
    let bestObst = null;
    for (const obj of game.dynamicObjects) {
      if (!obj.alive) continue;
      const toObj = new THREE.Vector3().subVectors(obj.position, origin);
      const proj = toObj.dot(spreadDir);
      if (proj < 0 || proj > Math.min(w.range, levelDist)) continue;
      const closest = origin.clone().add(spreadDir.clone().multiplyScalar(proj));
      if (closest.distanceTo(obj.position) < (obj.collisionRadius || 60) && proj < bestObstDist) {
        bestObst = obj;
        bestObstDist = proj;
      }
    }
    // (bugfix 2026-05-20 #312, hardened in #317) Cluster collision for
    // SLAYER spread / shotgun pellets. Use child.mesh.getWorldPosition
    // (not cl.position + child.position) so the cluster's group rotation
    // is honored. See #317 in fireHitscan for the same fix.
    const _pelletChildW = new THREE.Vector3();
    if (game.clusters && game.clusters.length) {
      for (const cl of game.clusters) {
        if (!cl || !cl.alive || !cl.children || !cl.children.length) continue;
        if (cl.group) cl.group.updateMatrixWorld(true);
        const reachR = (cl.clusterScale || 60) * 1.1;
        const toCl = new THREE.Vector3().subVectors(cl.position, origin);
        const projCl = toCl.dot(spreadDir);
        if (projCl < 0 || projCl > Math.min(w.range, levelDist)) continue;
        const closestCl = origin.clone().add(spreadDir.clone().multiplyScalar(projCl));
        if (closestCl.distanceToSquared(cl.position) > reachR * reachR) continue;
        for (const c of cl.children) {
          if (!c.alive || !c.mesh) continue;
          c.mesh.getWorldPosition(_pelletChildW);
          const toChild = _pelletChildW.clone().sub(origin);
          const childProj = toChild.dot(spreadDir);
          if (childProj < 0 || childProj > Math.min(w.range, levelDist)) continue;
          const cClosest = origin.clone().add(spreadDir.clone().multiplyScalar(childProj));
          const cr = (c.scale || 30) * 0.85;
          if (cClosest.distanceToSquared(_pelletChildW) < cr * cr && childProj < bestObstDist) {
            bestObst = cl;
            bestObstDist = childProj;
          }
        }
      }
    }

    let hitBot = false;
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const toBot = new THREE.Vector3().subVectors(bot.position, origin);
      const proj = toBot.dot(spreadDir);
      if (proj < 0 || proj > Math.min(w.range, levelDist)) continue;
      const closest = origin.clone().add(spreadDir.clone().multiplyScalar(proj));
      if (closest.distanceTo(bot.position) < bot.chassis.hullLength * 1.2) {
        if (bestObst && bestObstDist < proj) break;
        const rangeFalloff = Math.max(0.3, 1 - (proj / w.range) * 0.7);
        let finalDmg = w.damage * rangeFalloff;
        if (player.syphonDmgMult > 1) finalDmg *= player.syphonDmgMult;
        const hadShield = bot.shield > 0;
        const dealt = bot.takeDamage(finalDmg, 'player', closest);
        if (dealt > 0) {
          player.damageDealt += dealt;
          player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
          showHitMarker();
          if (!hadShield) spawnImpactSparks(closest, 3);
        }
        hitBot = true;
        break;
      }
    }

    if (bestObst && !hitBot) {
      const rangeRatio = bestObstDist / w.range;
      const proximityBoost = Math.max(0.3, 1 - rangeRatio * 0.7);
      const hitPt = origin.clone().add(spreadDir.clone().multiplyScalar(bestObstDist));
      // (bugfix 2026-05-20 #312) Cluster path : takeDamage(amount, attacker,
      // projectile) signature ; doesn't return dealt damage, just shatters
      // one child. Fire the player-facing feedback (sparks, hit marker,
      // core meter) unconditionally as long as the damage cleared the
      // threshold (≥ 30, satisfied by every chassis since SLAYER does 200).
      if (bestObst.constructor && bestObst.constructor.name === 'ClusterObstacle') {
        try {
          bestObst.takeDamage(w.damage * proximityBoost, 'player', { position: hitPt });
          player.damageDealt += w.damage * proximityBoost;
          player.coreMeter = Math.min(100, player.coreMeter + (w.damage * proximityBoost) / 100);
          showHitMarker();
          spawnImpactSparks(hitPt, 4);
        } catch (_) {}
      } else {
        const dealt = bestObst.takeDamage(w.damage * proximityBoost);
        if (dealt > 0) {
          player.damageDealt += dealt;
          player.coreMeter = Math.min(100, player.coreMeter + dealt / 100);
          showHitMarker();
          spawnImpactSparks(hitPt, 2);
        }
      }
    }
  }
}


// ----- next block -----

// ----- updateWeapon + startReload (reload state machine in updateWeapon) -----
function updateWeapon(dt) {
  if (player.shipState === 'dead' || !player.weapon) return;
  // Decay fire flash for player gun animation
  if (player.fireFlashTimer > 0) { player.fireFlashTimer -= dt; if (player.fireFlashTimer <= 0) player.isFiring = false; }
  const w = player.weapon;

  if (player.reloading) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) {
      player.clipAmmo = player.maxClip;
      player.reloading = false;
      document.getElementById('reload-indicator').style.display = 'none';
    }
    return;
  }

  // Hold-to-use defensive abilities block firing
  if (player.abilityActive[1] && player.abilities[1]) {
    const defName = player.abilities[1].name;
    if (defName === 'Vortex Shield' || defName === 'Absorption' || defName === 'Fire Shield') {
      return;
    }
  }

  // ADS (aim down sights) state
  const aiming = input.rightMouseDown || input.gpAltFire;

  // VORTEX ADS: zoom + bonus damage (energy drains while firing)
  if (player.loadoutKey === 'VORTEX') {
    if (aiming && player.vortexEnergy > 0) {
      player.vortexAdsActive = true;
      const firing = input.mouseDown || input.gpFire;
      if (firing) {
        player.vortexEnergy = Math.max(0, player.vortexEnergy - 350 * dt);
      }
    } else {
      player.vortexAdsActive = false;
    }
  }

  // Puncture Railgun charge (hold alt-fire 2.5s, boosted dmg)
  if (player.loadoutKey === 'PUNCTURE') {
    // (v11b) Edge-triggered stoppable charge spool audio.
    if (aiming && !player._railgunChargingPrev) {
      try {
        if (player._railgunChargeAudio) _stopRailgunChargeSound(player._railgunChargeAudio);
        player._railgunChargeAudio = _startRailgunChargeSound();
      } catch (e) {}
    } else if (!aiming && player._railgunChargingPrev) {
      try {
        if (player._railgunChargeAudio) _stopRailgunChargeSound(player._railgunChargeAudio);
        player._railgunChargeAudio = null;
      } catch (e) {}
    }
    player._railgunChargingPrev = aiming;
    if (aiming) {
      player.railgunCharge = Math.min(1.0, player.railgunCharge + dt / 2.5);
    } else if (!aiming && player.railgunCharge > 0 && player.railgunCharge < 0.05) {
      player.railgunCharge = 0;
    }
    if (!aiming) player.railgunCharge = Math.max(0, player.railgunCharge - dt * 0.2);
  } else {
    player._railgunChargingPrev = false;
    if (player._railgunChargeAudio) {
      try { _stopRailgunChargeSound(player._railgunChargeAudio); } catch (_) {}
      player._railgunChargeAudio = null;
    }
  }

  // ADS zoom (FOV change)
  const baseFov = 90;
  let targetFov = baseFov;
  if (aiming) {
    if (player.loadoutKey === 'PUNCTURE') targetFov = 40;
    else if (player.loadoutKey === 'VORTEX') targetFov = 55;
    else targetFov = 65;
  }
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  // Spinup
  let firing = input.mouseDown || input.gpFire;
  if (w.spinup > 0 && firing) {
    if (!player.spunUp) {
      player.spinupTimer += dt;
      if (player.spinupTimer >= w.spinup) player.spunUp = true;
      return;
    }
  } else if (w.spinup > 0) {
    player.spinupTimer = Math.max(0, player.spinupTimer - dt * 2);
    player.spunUp = false;
  }

  player.fireTimer -= dt;
  if (player.blasterSwitchTimer > 0) firing = false;
  if (firing && player.fireTimer <= 0) {
    const smartCoreActive = player.coreActive && player.loadoutKey === 'BLASTER';
    if (!smartCoreActive && player.clipAmmo <= 0) { startReload(); return; }
    fireWeapon();
    player.isFiring = true; player.fireFlashTimer = 0.12;
    player.fireTimer = w.fireRate;
    if (!smartCoreActive) {
      player.clipAmmo--;
      if (player.clipAmmo <= 0 && w.clipSize < 999) startReload();
    }
  }

  // Manual reload
  const reloadPressed = _kbActionHeld('reload') || (input.gpReload && !input.gpReloadPrev);
  if (reloadPressed && player.clipAmmo < player.maxClip && !player.reloading && w.clipSize < 999) {
    startReload();
  }
}

function startReload() {
  if (player.weapon.clipSize >= 999) return;
  player.reloading = true;
  player.reloadTimer = 2.0;
  document.getElementById('reload-indicator').style.display = 'block';
}


// ----- next block -----

// ----- emitChassisMuzzleFlash + chassisFlashColor -----
function chassisFlashColor(key) {
  // (v14c) Per-class muzzle/tracer identity tints from LSS.CLASS_COLORS.
  switch (key) {
    case 'VORTEX':   return LSS.CLASS_COLORS.VORTEX;
    case 'PYRO':     return LSS.CLASS_COLORS.PYRO;
    case 'SLAYER':   return LSS.CLASS_COLORS.SLAYER;
    case 'PUNCTURE': return LSS.CLASS_COLORS.PUNCTURE;
    case 'TRACKER':  return LSS.CLASS_COLORS.TRACKER;
    case 'BLASTER':  return LSS.CLASS_COLORS.BLASTER;
    case 'SYPHON':   return LSS.CLASS_COLORS.SYPHON;
    default:         return 0xffffaa;
  }
}

function emitChassisMuzzleFlash(loadoutKey, pos, dir) {
  if (!pos || !dir) return;
  const flashColor = chassisFlashColor(loadoutKey);

  // Universal: small dynamic warm light at the muzzle.
  if (typeof spawnDynamicLight === 'function') {
    spawnDynamicLight(pos, flashColor, 1.4, 90, 0.25);
  }

  // Universal: 4-6 fast forward sparks in a tight cone.
  for (let i = 0; i < 5; i++) {
    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * 0.35,
      (Math.random() - 0.5) * 0.35,
      (Math.random() - 0.5) * 0.35
    );
    const v = dir.clone().add(spread).normalize().multiplyScalar(80 + Math.random() * 60);
    game.particles.push({
      position: pos.clone(),
      velocity: v,
      life: 0.10 + Math.random() * 0.10,
      maxLife: 0.20,
      color: flashColor,
      size: 1.4 + Math.random() * 1.4,
    });
  }

  // Chassis-specific layer.
  if (loadoutKey === 'PYRO') {
    for (let i = 0; i < 5; i++) {
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 0.30,
        (Math.random() - 0.5) * 0.30,
        (Math.random() - 0.5) * 0.30
      );
      const v = dir.clone().add(spread).normalize().multiplyScalar(50 + Math.random() * 50);
      game.particles.push({
        position: pos.clone(),
        velocity: v,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color: 0xff5522,
        size: 3 + Math.random() * 3,
      });
    }
  } else if (loadoutKey === 'PUNCTURE') {
    // Sodium Railgun: bright electric lightning bolt out the barrel.
    if (typeof spawnLightningBolt === 'function') {
      const tip = pos.clone().add(dir.clone().multiplyScalar(140));
      spawnLightningBolt(pos, tip, LSS.CLASS_COLORS.PUNCTURE, 0.18, 2, 1.8);
    }
  } else if (loadoutKey === 'SLAYER') {
    for (let i = 0; i < 6; i++) {
      const v = dir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.45,
        (Math.random() - 0.5) * 0.45,
        (Math.random() - 0.5) * 0.45
      )).normalize().multiplyScalar(180 + Math.random() * 100);
      game.particles.push({
        position: pos.clone(),
        velocity: v,
        life: 0.10 + Math.random() * 0.08,
        maxLife: 0.18,
        color: 0xffcc66,
        size: 2.0 + Math.random() * 1.6,
      });
    }
  } else if (loadoutKey === 'BLASTER') {
    for (let i = 0; i < 3; i++) {
      const v = dir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.25
      )).normalize().multiplyScalar(120 + Math.random() * 80);
      game.particles.push({
        position: pos.clone(),
        velocity: v,
        life: 0.08 + Math.random() * 0.06,
        maxLife: 0.14,
        color: 0xffeebb,
        size: 1.8,
      });
    }
  } else if (loadoutKey === 'TRACKER') {
    // Ring-style expansion approximating a fresnel ring.
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    const up = dir.clone().cross(right).normalize();
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const radial = right.clone().multiplyScalar(Math.cos(angle))
        .add(up.clone().multiplyScalar(Math.sin(angle))).multiplyScalar(60);
      game.particles.push({
        position: pos.clone(),
        velocity: radial,
        life: 0.18,
        maxLife: 0.18,
        color: flashColor,
        size: 1.6,
      });
    }
  }
  // VORTEX uses just the universal flash ; the purple tracer carries identity.
}


// ----- next block -----

// ----- Tracer geometries + material protos + _spawnSingleTracer + _spawnRailgunSpiral + spawnTracer -----

// (v16a) Tier-aware radial segment counts for tracer cylinders.
// (v17 -> webgpu) Skip redeclaration if fx module already set it.
// (v17 -> webgpu) duplicate _TRC_SEG declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRC_SEG === 'undefined') var _TRC_SEG = (function() {
//     const t = (typeof QUALITY !== 'undefined' && QUALITY.level) ? QUALITY.level : 'high';
//     if (t === 'potato') return { core: 4,  beam: 6,  inner: 8,  outer: 12 };
//     if (t === 'ultra')  return { core: 8,  beam: 16, inner: 16, outer: 24 };
//     return                       { core: 6,  beam: 12, inner: 12, outer: 16 };
//   })();
// (v17 -> webgpu) duplicate _TRACER_CORE_GEO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_CORE_GEO === 'undefined') var _TRACER_CORE_GEO = new THREE.CylinderGeometry(0.55, 0.55, 1, _TRC_SEG.core, 1);
_TRACER_CORE_GEO.rotateX(Math.PI / 2);
// (v17 -> webgpu) duplicate _TRACER_BEAM_GEO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_BEAM_GEO === 'undefined') var _TRACER_BEAM_GEO = new THREE.CylinderGeometry(1.30, 0.95, 1, _TRC_SEG.beam, 1);
_TRACER_BEAM_GEO.rotateX(Math.PI / 2);
// (v17 -> webgpu) duplicate _TRACER_TAIL_INNER_GEO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_TAIL_INNER_GEO === 'undefined') var _TRACER_TAIL_INNER_GEO = new THREE.CylinderGeometry(3.50, 2.50, 1, _TRC_SEG.inner, 1);
_TRACER_TAIL_INNER_GEO.rotateX(Math.PI / 2);
// (v17 -> webgpu) duplicate _TRACER_TAIL_OUTER_GEO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_TAIL_OUTER_GEO === 'undefined') var _TRACER_TAIL_OUTER_GEO = new THREE.CylinderGeometry(9.00, 6.50, 1, _TRC_SEG.outer, 1);
_TRACER_TAIL_OUTER_GEO.rotateX(Math.PI / 2);

// Per-vertex fade-in attribute on shared cylinders (near end fades to black).
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
      t = k * k * (3 - 2 * k);
    }
    colors[i * 3]     = t;
    colors[i * 3 + 1] = t;
    colors[i * 3 + 2] = t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
});

// Prototype materials (tracer + tracerTail variants).
// (v17 -> webgpu) duplicate _TRACER_CORE_MAT_PROTO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_CORE_MAT_PROTO === 'undefined') var _TRACER_CORE_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, vertexColors: true });
// (v17 -> webgpu) duplicate _TRACER_BEAM_MAT_PROTO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_BEAM_MAT_PROTO === 'undefined') var _TRACER_BEAM_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, vertexColors: true });
// (v17 -> webgpu) duplicate _TRACER_TAIL_INNER_MAT_PROTO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_TAIL_INNER_MAT_PROTO === 'undefined') var _TRACER_TAIL_INNER_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true });
// (v17 -> webgpu) duplicate _TRACER_TAIL_OUTER_MAT_PROTO declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _TRACER_TAIL_OUTER_MAT_PROTO === 'undefined') var _TRACER_TAIL_OUTER_MAT_PROTO = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true });

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

  _makeShape(_TRACER_CORE_GEO, _TRACER_CORE_MAT_PROTO, 0xffffff, 1.0, 0.10, 'tracer');
  _makeShape(_TRACER_BEAM_GEO, _TRACER_BEAM_MAT_PROTO, color, 1.0, 0.18, 'tracer');
  _makeShape(_TRACER_TAIL_INNER_GEO, _TRACER_TAIL_INNER_MAT_PROTO, color, 0.55, 0.42, 'tracerTail');
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

// (v11d) Puncture railgun helix tracer.
function _spawnRailgunSpiral(from, to, color) {
  if (typeof scene === 'undefined' || typeof THREE === 'undefined') return;
  color = (color != null) ? color : 0xeeff66;
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 8) return;
  const fwd = dir.clone().multiplyScalar(1 / len);
  // Stable perpendicular basis.
  const upHint = (Math.abs(fwd.y) < 0.92) ? new THREE.Vector3(0, 1, 0)
                                          : new THREE.Vector3(1, 0, 0);
  const right  = new THREE.Vector3().crossVectors(fwd, upHint).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const helixR = 9.0;
  const coilsPerUnit = 0.012;
  const totalCoils = Math.max(2, len * coilsPerUnit);
  const ptsPerCoil = 6;
  const numPoints  = Math.max(8, Math.round(totalCoils * ptsPerCoil));
  const pts = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const r = helixR * Math.sin(t * Math.PI);
    const angle = t * totalCoils * Math.PI * 2;
    const center = from.clone().add(fwd.clone().multiplyScalar(t * len));
    const offset = right.clone().multiplyScalar(Math.cos(angle) * r)
              .add(realUp.clone().multiplyScalar(Math.sin(angle) * r));
    pts.push(center.add(offset));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const tubularSegments = Math.min(160, numPoints * 3);
  const tubeRadius      = 0.7;
  const radialSegments  = 5;
  const geo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
  // (v11d fix) FrontSide so cockpit camera doesn't see tube interior.
  const mat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  scene.add(mesh);
  game.effects.push({ mesh, lifetime: 0.6, age: 0, type: 'tracerSpiral' });
  // White-hot core sliver at muzzle for shot-just-left-barrel punch.
  if (typeof _TRACER_CORE_GEO !== 'undefined' && typeof _TRACER_CORE_MAT_PROTO !== 'undefined') {
    const coreLen = Math.min(220, len * 0.25);
    const coreEnd = from.clone().add(fwd.clone().multiplyScalar(coreLen));
    const coreMid = from.clone().add(fwd.clone().multiplyScalar(coreLen * 0.5));
    const cm = _TRACER_CORE_MAT_PROTO.clone();
    cm.color = new THREE.Color(0xffffff);
    cm.opacity = 1.0;
    const coreMesh = new THREE.Mesh(_TRACER_CORE_GEO, cm);
    coreMesh.position.copy(coreMid);
    coreMesh.lookAt(coreEnd);
    coreMesh.scale.set(1.2, 1.2, coreLen);
    coreMesh.renderOrder = 1;
    scene.add(coreMesh);
    game.effects.push({ mesh: coreMesh, lifetime: 0.10, age: 0, type: 'tracer' });
  }
}

function spawnTracer(from, to, color, widthScale) {
  color = color || 0xffff00;
  const wScale = (typeof widthScale === 'number' && widthScale > 0) ? widthScale : 1.0;
  // Player-side shots: split into two converging tracers from painted barrel tips.
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
    // (v6.7) FIXED screen-space muzzle positions (hard-coded fractions).
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
  // Bot / far-field shots: single tracer.
  _spawnSingleTracer(from, to, color, 1.0 * wScale);
}


// ----- next block -----

// ----- Per-ship muzzle tables + _computeScreenMuzzleWorld -----

// (v17) Pixel-fraction → world-space muzzle point at fwdOff in front of camera.
// Used to anchor first-person beams/projectiles to painted gun art rather than
// the camera origin.
function _computeScreenMuzzleWorld(fracX, fracY, fwdOff) {
  if (typeof camera === 'undefined' || !player || !player.position) return null;
  fwdOff = (typeof fwdOff === 'number') ? fwdOff : 60;
  // Compose directional shift applied to gun-layer.
  if (typeof _overlayShift === 'object' && _overlayShift) {
    fracX += _overlayShift.x / 100;
    fracY += _overlayShift.y / 100;
  }
  const q = camera.quaternion;
  const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const upV    = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const fwdV   = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const winW = (typeof window !== 'undefined') ? window.innerWidth : 1920;
  const winH = (typeof window !== 'undefined') ? window.innerHeight : 1080;
  const fovRad = (camera.fov || 90) * Math.PI / 180;
  const halfH = fwdOff * Math.tan(fovRad / 2);
  const halfW = halfH * (winW / winH);
  const ndx =  2 * fracX - 1;
  const ndy = -(2 * fracY - 1);
  return player.position.clone()
    .add(rightV.clone().multiplyScalar(ndx * halfW))
    .add(upV.clone().multiplyScalar(ndy * halfH))
    .add(fwdV.clone().multiplyScalar(fwdOff));
}

// (v17 -> webgpu) duplicate _PLAYER_MAIN_MUZZLE_FRAC declaration removed ;
// canonical declaration lives in lss_v17_cockpit.js. Comment preserves the
// value for reference:
//   _PLAYER_MAIN_MUZZLE_FRAC = { PUNCTURE: { x: 0.62, y: 0.60 } };

// (v17 -> webgpu) duplicate _PLAYER_LAUNCHER_FRACS declaration removed ;
// canonical lives in cockpit module. Values preserved as reference:
//   TRACKER: [ {x:0.38, y:0.29}, {x:0.62, y:0.29} ],
//   PUNCTURE: [ {x:0.37, y:0.28}, {x:0.64, y:0.28} ]


// ----- next block -----

// ----- Staggered rocket salvo dispatcher -----

// (v16a Phase T) Staggered-rocket-salvo support.
// _enqueueStaggeredRocketSalvo(target, configs, interval)
//   configs[*] = { velocity, damage, splash, color, smokeTrail, removeHaze,
//                  tracking, trackTarget, originFrac }
// Dispatcher (_drainStaggeredRocketSalvo, called every frame from
// updateAbilities) shifts one config per frame and spawns the Projectile.
// Prevents the 5-10-rockets-in-one-frame allocation spike that caused
// rocket-fire lag hitches.
function _enqueueStaggeredRocketSalvo(target, configs, interval) {
  if (!target || !configs || configs.length === 0) return;
  target._pendingRocketSalvo = {
    queue: configs,
    nextFireDelay: 0,            // first rocket fires on next dispatcher tick
    interval: (interval > 0) ? interval : 0.035,
  };
}
function _drainStaggeredRocketSalvo(dt) {
  if (typeof player === 'undefined' || !player || !player._pendingRocketSalvo) return;
  // Drop queue if player died mid-burst.
  if (player.shipState === 'dead') { player._pendingRocketSalvo = null; return; }
  const q = player._pendingRocketSalvo;
  if (!q.queue || q.queue.length === 0) { player._pendingRocketSalvo = null; return; }
  q.nextFireDelay -= dt;
  if (q.nextFireDelay > 0) return;
  // One rocket per call ; even on alt-tab catch-up we never spawn multiple
  // Projectiles in one frame.
  const cfg = q.queue.shift();
  // Re-validate tracking target (may have died during burst).
  let tracking = !!cfg.tracking;
  let trackTarget = cfg.trackTarget;
  if (tracking && (!trackTarget || !trackTarget.alive)) {
    tracking = false;
    trackTarget = null;
  }
  // (v17) Per-config muzzle origin from painted launcher fraction.
  let origin;
  if (cfg.originFrac && typeof _computeScreenMuzzleWorld === 'function') {
    origin = _computeScreenMuzzleWorld(cfg.originFrac.x, cfg.originFrac.y) || player.position.clone();
  } else {
    origin = player.position.clone();
  }
  const proj = new Projectile(
    origin,
    cfg.velocity,
    cfg.damage,
    cfg.splash,
    'player',
    cfg.color
  );
  if (cfg.smokeTrail) proj.smokeTrail = true;
  if (cfg.removeHaze && typeof proj.removeHaze === 'function') proj.removeHaze();
  if (tracking) {
    proj.tracking = true;
    proj.trackTarget = trackTarget;
  }
  game.projectiles.push(proj);
  if (typeof broadcastAbilityProjectile === 'function') broadcastAbilityProjectile(proj);
  q.nextFireDelay = q.interval;
  if (q.queue.length === 0) player._pendingRocketSalvo = null;
}


// ----- next block -----

// ----- Blaster Charge Shot: powerShotCharging in updateAbilities + firePowerShot -----

// In updateAbilities(dt) — the charge-up branch:
// Blaster Charge Shot: charge up over 1s, then auto-fire
if (player.powerShotCharging) {
  player.powerShotCharge = Math.min(1.0, player.powerShotCharge + dt / 1.0);
  if (player.powerShotCharge >= 1.0) {
    firePowerShot();
  }
}

// (v17 -> webgpu) Dangling snippet : the agent extracted a branch from
// inside executeAbility(slot, ability) without its wrapping function ; the
// bare `else if (ability.name === ...)` references the function-local
// `ability` parameter which doesn't exist at top level. The real branch
// lives inside lss_v17_abilities.js's executeAbility ; this reference
// block elided.
//
//   else if (ability.name === 'Charge Shot') {
//     player.powerShotCharging = true;
//     player.powerShotCharge = 0;
//     try { playSound('powershot_charge'); } catch (e) {}
//   }

// Release / auto-fire handler:
function firePowerShot() {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (player.blasterMode === 'close') {
    // Close-range: shotgun blast (12 pellets, wide spread, knockback).
    const range = 1200;
    const pelletCount = 12;
    const spreadAngle = 0.12;
    for (let p = 0; p < pelletCount; p++) {
      const pelletDir = forward.clone();
      pelletDir.x += (Math.random() - 0.5) * spreadAngle;
      pelletDir.y += (Math.random() - 0.5) * spreadAngle;
      pelletDir.z += (Math.random() - 0.5) * spreadAngle;
      pelletDir.normalize();
      const pelletEnd = player.position.clone().add(pelletDir.clone().multiplyScalar(range));
      spawnTracer(player.position, pelletEnd, LSS.CLASS_COLORS.BLASTER);
      if (net.active && net.sendEvent) {
        net.sendEvent({
          type: 'fire_tracer',
          ox: player.position.x, oy: player.position.y, oz: player.position.z,
          ex: pelletEnd.x, ey: pelletEnd.y, ez: pelletEnd.z,
          color: LSS.CLASS_COLORS.BLASTER,
        });
      }
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position);
        const proj = toBot.dot(pelletDir);
        if (proj < 0 || proj > range) continue;
        const closest = player.position.clone().add(pelletDir.clone().multiplyScalar(proj));
        if (closest.distanceTo(bot.position) < bot.chassis.hullLength * 1.2) {
          const dealt = bot.takeDamage(270, 'player', closest);
          if (dealt > 0) { player.damageDealt += dealt; player.coreMeter = Math.min(100, player.coreMeter + dealt / 100); showHitMarker(); }
          if (bot.velocity) bot.velocity.add(pelletDir.clone().multiplyScalar(400));
          // (v14g) Surface-clamped burst at actual hit point.
          const _surfR = bot.chassis.hullLength * 0.5;
          const _toHit = closest.clone().sub(bot.position);
          const _len = _toHit.length();
          const _exPos = (_len > 0.001)
            ? bot.position.clone().add(_toHit.multiplyScalar(_surfR / _len))
            : bot.position.clone();
          spawnExplosion(_exPos, 5);
        }
      }
    }
    triggerScreenShake(5);
  } else {
    // Long-range: precision piercing shot (travels through all enemies).
    const range = 3500;
    const end = player.position.clone().add(forward.clone().multiplyScalar(range));
    spawnTracer(player.position, end, LSS.CLASS_COLORS.BLASTER);
    spawnTracer(player.position.clone().add(new THREE.Vector3(0,2,0)), end.clone().add(new THREE.Vector3(0,2,0)), 0xaaeeff);
    if (net.active && net.sendEvent) {
      net.sendEvent({
        type: 'fire_tracer',
        ox: player.position.x, oy: player.position.y, oz: player.position.z,
        ex: end.x, ey: end.y, ez: end.z,
        color: LSS.CLASS_COLORS.BLASTER,
      });
      net.sendEvent({
        type: 'fire_tracer',
        ox: player.position.x, oy: player.position.y + 2, oz: player.position.z,
        ex: end.x, ey: end.y + 2, ez: end.z,
        color: 0xaaeeff,
      });
    }
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const toBot = new THREE.Vector3().subVectors(bot.position, player.position);
      const proj = toBot.dot(forward);
      if (proj < 0 || proj > range) continue;
      const closest = player.position.clone().add(forward.clone().multiplyScalar(proj));
      if (closest.distanceTo(bot.position) < bot.chassis.hullLength * 1.0) {
        const dealt = bot.takeDamage(3200, 'player', closest);
        if (dealt > 0) { player.damageDealt += dealt; player.coreMeter = Math.min(100, player.coreMeter + dealt / 100); showHitMarker(); }
        // (v14g) Surface-clamped burst at actual hit point.
        const _surfR = bot.chassis.hullLength * 0.5;
        const _toHit = closest.clone().sub(bot.position);
        const _len = _toHit.length();
        const _exPos = (_len > 0.001)
          ? bot.position.clone().add(_toHit.multiplyScalar(_surfR / _len))
          : bot.position.clone();
        spawnExplosion(_exPos, 8);
      }
    }
    triggerScreenShake(3);
  }
  // (v14g) Heavy cannon-style boom on release.
  try { playSound('power_shot_release'); } catch (_) {}
  player.powerShotCharging = false;
  player.powerShotCharge = 0;
  player.abilityCooldowns[0] = 8; // Charge Shot is slot 0 (offensive)
}

// Example of Tracker Rockets queue assembly in executeAbility (for context):
// const _trLaunchers = _PLAYER_LAUNCHER_FRACS.TRACKER;
// let _trIdx = 0;
// const _trQueue = [];
// for (const target of lockedTargets) {
//   for (let m = 0; m < 5; m++) {
//     const _trSpread = new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, 0);
//     const _trVel = forward.clone().add(_trSpread).normalize().multiplyScalar(900);
//     _trQueue.push({
//       velocity:    _trVel,
//       damage:      1000,
//       splash:      80,
//       color:       LSS.CLASS_COLORS.TRACKER,
//       smokeTrail:  true,
//       removeHaze:  true,
//       tracking:    true,
//       trackTarget: target,
//       originFrac:  _trLaunchers[_trIdx++ % _trLaunchers.length],
//     });
//   }
//   
