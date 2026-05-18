// ===========================================================================
// Bot AI extraction from last_ship_sailing_v17.html
// Source: C:\Users\ashro\Fractal_Reality\fractalgaming\LSS\old_versions\last_ship_sailing_v17.html
// ===========================================================================

// ----- raycastLevel (used by bot LOS checks, line 14196) -----

function raycastLevel(origin, dir, maxDist) {
  // SDF ray march: no CSG awareness needed, the SDF handles junctions naturally
  let nearest = maxDist;
  // (v12) Google Maps mode: SDF is short-circuited (always interior),
  // so sdfRaycast can't find walls. Replace with a raycast against the
  // photoreal tile leaf meshes ; that's what makes projectiles, hitscan,
  // and AI line-of-sight respect real city geometry.
  if (typeof _lssGmaps !== 'undefined' && _lssGmaps && _lssGmaps.active && !_lssGmaps.overlayOnly) {
    const grp = _lssGmaps.tiles && _lssGmaps.tiles.group;
    if (grp && grp.children && grp.children.length > 0) {
      const meshes = _lssGmapsCollectLeaves(grp);
      if (meshes.length > 0) {
        _lssGmapsRaycaster.set(origin, dir);
        _lssGmapsRaycaster.far = maxDist;
        try {
          const hits = _lssGmapsRaycaster.intersectObjects(meshes, false);
          if (hits.length && hits[0].distance < nearest) nearest = hits[0].distance;
        } catch (_) {}
      }
    }
    return nearest;
  }

  // Still check obstacle boxes (if any exist in future)
  const idx = 1/dir.x, idy = 1/dir.y, idz = 1/dir.z;
  for (const box of game.levelBoxes) {
    const t1x = (box.min.x - origin.x) * idx, t1y = (box.min.y - origin.y) * idy, t1z = (box.min.z - origin.z) * idz;
    const t2x = (box.max.x - origin.x) * idx, t2y = (box.max.y - origin.y) * idy, t2z = (box.max.z - origin.z) * idz;
    const enter = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
    const exit = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
    if (enter < exit && enter > 0 && enter < nearest) nearest = enter;
  }

  // SDF ray march for sphere/cylinder walls
  const sdfHit = sdfRaycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, nearest);
  if (sdfHit < nearest) nearest = sdfHit;

  return nearest;
}


// ----- emitDamageState (damage trail/smoke that bots emit when low HP, line 9594) -----
// (v15a 2026-05-10 opt) Scratch vectors for emitDamageState. The function
// previously allocated a fresh `offset` + `pos.clone()` per call plus
// many `new Vector3(...)` per arc anchor (tier 1 spawns 3 arcs x 2 anchors).
// Pooling these reduces per-call allocations by ~70%. Note : the per-particle
// `position` and `velocity` Vec3s on game.particles records ARE retained
// (the particle update loop mutates them each frame), so those stay
// allocated.
const _emitPos = new THREE.Vector3();
const _emitArcA = new THREE.Vector3();
const _emitArcB = new THREE.Vector3();
function emitDamageState(entity, dt) {
  if (!entity || !entity.alive || !entity.position) return;
  // (v11) Shield up = hide all hull damage. Threshold > 0.5 (not == 0)
  // so flickering low-shield ticks don't strobe the effects on/off.
  if ((entity.shield || 0) > 0.5) return;
  const maxHp = entity.maxHealth || (entity.chassis && entity.chassis.maxHealth) || 1;
  const hpFrac = Math.max(0, (entity.health || 0) / maxHp);
  if (hpFrac >= 1.0) return; // pristine ; no effect
  // Tier selection by HP band.
  let tier = 0;
  if (hpFrac < 0.75) tier = 1;
  if (hpFrac < 0.50) tier = 2;
  if (hpFrac < 0.25) tier = 3;
  // Emit cadence: faster as damage worsens. tier 0 = 110ms, tier 3 = 45ms.
  if (entity._dmgEmitTimer == null) entity._dmgEmitTimer = 0;
  entity._dmgEmitTimer -= dt;
  if (entity._dmgEmitTimer > 0) return;
  entity._dmgEmitTimer = 0.11 - tier * 0.022;
  // Pick a random point on the hull as the emit anchor (scratch ; no alloc).
  const hullR = (entity.chassis && entity.chassis.hullLength) ? entity.chassis.hullLength * 0.45 : 45;
  _emitPos.set(
    entity.position.x + (Math.random() - 0.5) * hullR * 2,
    entity.position.y + (Math.random() - 0.5) * hullR * 0.8,
    entity.position.z + (Math.random() - 0.5) * hullR * 2
  );
  const pos = _emitPos;
  if (tier === 0) {
    // SPARKING: a fountain of hot bright sparks pops off the hull. Bigger
    // count + faster outward velocity than v10 so the bloom pass reliably
    // smears them into a visible cluster of glints at any range. Reads as
    // "circuitry exposed and shorting out."
    if (typeof v8SpawnSparks === 'function') {
      // 8 sparks per emit (was 3), wider spread, brighter outer color.
      v8SpawnSparks(pos, 8, 1.1, 320, 0xffd060, 0xffffff);
    }
    // Plus a couple of accent particles via the legacy pool so the spawn
    // reads as "many sparks at once" even if v8SpawnSparks is throttled.
    for (let k = 0; k < 4; k++) {
      game.particles.push({
        position: pos.clone(),
        velocity: _pVel(
          (Math.random() - 0.5) * 220,
          (Math.random() - 0.5) * 220,
          (Math.random() - 0.5) * 220
        ),
        life: 0.22, maxLife: 0.22, color: 0xffe070, size: 3,
      });
    }
  } else if (tier === 1) {
    // ELECTRIC: 2-3 simultaneous cyan arcs jump across the hull surface
    // each emit. Bigger reach + thicker bolts so the player reads "this
    // ship is shorting out hard" from any angle. Reads as "internal
    // systems shorting out."
    if (typeof spawnLightningBolt === 'function') {
      const arcs = 3;
      // (v15a opt) Reuse the scratch arc anchors ; spawnLightningBolt only
      // reads from them, doesn't retain them.
      for (let k = 0; k < arcs; k++) {
        _emitArcA.set(
          pos.x + (Math.random() - 0.5) * hullR * 0.5,
          pos.y + (Math.random() - 0.5) * hullR * 0.4,
          pos.z + (Math.random() - 0.5) * hullR * 0.5
        );
        _emitArcB.set(
          pos.x + (Math.random() - 0.5) * hullR * 1.8,
          pos.y + (Math.random() - 0.5) * hullR * 1.2,
          pos.z + (Math.random() - 0.5) * hullR * 1.8
        );
        // Brighter cyan, doubled lifetime (0.28s), thicker (3) so each
        // arc is unmistakably visible.
        spawnLightningBolt(_emitArcA, _emitArcB, 0x66e0ff, 0.28, 1, 3);
      }
    }
    // Hot punctuation sparks at the arc origin so each emit reads as a
    // discharge event, not just a faint streak.
    for (let k = 0; k < 5; k++) {
      game.particles.push({
        position: pos.clone(),
        velocity: _pVel(
          (Math.random() - 0.5) * 130,
          (Math.random() - 0.5) * 130,
          (Math.random() - 0.5) * 130
        ),
        life: 0.22, maxLife: 0.22, color: 0xbbeeff, size: 2.4,
      });
    }
  } else if (tier === 2) {
    // SMOKE: thicker plumes rising off the hull, with an orange ember
    // accent so the smoke reads as "fire venting through the breach"
    // rather than ambient haze. Bigger size + lighter base color so the
    // plume catches some bloom.
    game.particles.push({
      position: pos.clone(),
      velocity: _pVel(
        (Math.random() - 0.5) * 35,
        35 + Math.random() * 55,
        (Math.random() - 0.5) * 35
      ),
      life: 1.0 + Math.random() * 0.7, maxLife: 1.7,
      color: 0x4a3a30, size: 9 + Math.random() * 5,
    });
    // Hot ember inside the plume base ; bright accent that reads at distance.
    game.particles.push({
      position: pos.clone(),
      velocity: _pVel(
        (Math.random() - 0.5) * 60,
        20 + Math.random() * 50,
        (Math.random() - 0.5) * 60
      ),
      life: 0.35 + Math.random() * 0.25, maxLife: 0.6,
      color: 0xff8833, size: 3 + Math.random() * 2,
    });
  } else {
    // tier 3 ; FIRE: bigger, brighter flame fountain + dense smoke trail.
    // Multiple flame particles per emit so the fire reads as a sustained
    // body of flame engulfing the hull, not single popping sparks.
    for (let k = 0; k < 3; k++) {
      game.particles.push({
        position: pos.clone(),
        velocity: _pVel(
          (Math.random() - 0.5) * 50,
          30 + Math.random() * 90,
          (Math.random() - 0.5) * 50
        ),
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        // Mix of hot orange and yellow so the flames have bloom variation.
        color: Math.random() < 0.4 ? 0xff5022 : (Math.random() < 0.5 ? 0xffaa44 : 0xffd070),
        size: 7 + Math.random() * 5,
      });
    }
    // Heavier trailing smoke above the flames.
    game.particles.push({
      position: pos.clone().add(new THREE.Vector3(0, 18, 0)),
      velocity: _pVel(
        (Math.random() - 0.5) * 28,
        50 + Math.random() * 50,
        (Math.random() - 0.5) * 28
      ),
      life: 1.0 + Math.random() * 0.6, maxLife: 1.6,
      color: 0x252525, size: 10 + Math.random() * 5,
    });
  }
}


// ----- Bot class constructor + helpers (line 16254) -----

class Bot {
  constructor(loadoutKey, team, id) {
    const loadout = LOADOUTS[loadoutKey];
    const chassisData = CHASSIS[loadout.chassis];
    this.id = id;
    this.loadoutKey = loadoutKey;
    this.loadout = loadout;
    this.chassis = chassisData;
    this.team = team;
    this.health = chassisData.maxHealth;
    this.maxHealth = chassisData.maxHealth;
    this.shield = chassisData.maxShield;
    this.maxShield = chassisData.maxShield;
    this.alive = true;
    this.position = new THREE.Vector3(
      (Math.random() - 0.5) * 3000,
      (Math.random() - 0.5) * 1000,
      (Math.random() - 0.5) * 3000
    );
    this.velocity = new THREE.Vector3();
    this.targetDir = new THREE.Vector3(0, 0, -1);
    this.fireTimer = 0;
    // (v6.9) Bot ability cooldowns. Stagger initial values per slot so a
    // wave of just-spawned bots doesn't release every ability on the same
    // frame. Indexing matches the player (0 = offensive, 1 = defensive,
    // 2 = utility) ; the offensive use AI lives in update().
    this.abilityCooldowns = [3 + Math.random() * 4, 0, 5 + Math.random() * 6];
    this.shieldRegenDelay = 0;
    this.spawnProtection = LSS.SPAWN_PROTECTION;
    this.doomed = false;
    this.doomTimer = 0;
    this.coreMeter = 0;
    // (v14e) Stun timer ; set by Slayer Teleport sweep when the dashing
    // ship passes through this bot. While > 0 the bot can't move or fire.
    this.stunTimer = 0;
    // Stats (for scoreboard): kills this match, damage dealt this match
    this.kills = 0;
    this.damageDealt = 0;

    const teamColor = team === LSS.TEAM_FLEET_A ? 0xff4444 : 0x44bb44;
    this.mesh = createShipMesh(chassisData, teamColor, loadoutKey);
    this.mesh.position.copy(this.position);
    this.mesh.userData.bot = this;
    scene.add(this.mesh);
    swapToModelMeshWhenReady(this, teamColor);

    // AI enhancement: squad tactics and navigation
    this.aiTarget = null;
    this.aiTimer = 0;
    this.aiWanderDir = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();

    // Squad coordination: 1 in 3 bots flanks, others engage
    this.aiRole = Math.random() < 0.33 ? 'flank' : 'engage';
    this.aiLastKnownPlayer = null;
    this.aiLastKnownTime = 0;
    this.aiSharedTargetAge = 0;
    this.aiStrafe = false;
    this.aiStrafeTimer = 0;
    this.aiStrafeDir = 0; // 1 for left, -1 for right
    this.aiNavTarget = null;
    this.aiNavPathTimeout = 0;
    this.aiRangePreference = this.getLoadoutRangePreference();
    this.aiRetreating = false;

    // Temp vectors for reuse (performance optimization)
    this._tempVec3a = new THREE.Vector3();
    this._tempVec3b = new THREE.Vector3();
    // Additional per-bot scratches for update(): the flanking / strafing paths
    // used to allocate a fresh THREE.Vector3 per call, and botCollisionStep
    // used to clone velocity once per substep.
    this._tempVec3c = new THREE.Vector3();
    this._tempVec3d = new THREE.Vector3();
    this._botStep = new THREE.Vector3();
  }

  // ----- per-chassis behavior tuning -----
  getLoadoutRangePreference() {
    switch (this.loadoutKey) {
      case 'PYRO': return 500;    // Close range (short range assault)
      case 'SLAYER': return 500;     // Close range (sword range)
      case 'PUNCTURE': return 1500; // Medium range (sniper)
      case 'TRACKER': return 1200;     // Medium range (balanced)
      case 'BLASTER': return 1000;   // Medium range (minigun effective)
      case 'SYPHON': return 800;   // Medium-close (versatile)
      case 'VORTEX': return 1000;      // Medium (energy efficient at range)
      default: return 800;
    }
  }

  // (v13r) Pick the next race-mode steering target. Sticky current-room
  // tracking + room-center preference. Returns the next room's CENTER as
  // the steering target whenever the bot is outside the current room
  // sphere (in a corridor), and only falls back to the tunnel midpoint
  // when the bot is fully inside the current room and needs help finding
  // the corridor mouth. The current room is sticky so transient gaps
  // between sphere coverage don't cause the BFS to flip-flop.
  chooseRaceWaypoint() {
    const graph = game.raceGraph;
    if (!graph || !graph.finishId) return null;
    const nodes = graph.nodes;
    const finish = nodes[graph.finishId];
    if (!finish) return null;

    // Containing-room test (which sphere are we INSIDE right now).
    let insideId = null, insideD2 = Infinity;
    let nearestId = null, nearestD2 = Infinity;
    for (const id in nodes) {
      const n = nodes[id];
      const dx = this.position.x - n.x, dy = this.position.y - n.y, dz = this.position.z - n.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 <= n.r * n.r && d2 < insideD2) { insideId = id; insideD2 = d2; }
      if (d2 < nearestD2) { nearestId = id; nearestD2 = d2; }
    }

    // Sticky current-room: only advance when we ENTER a new room sphere.
    // Outside any sphere, keep the last known so the BFS doesn't oscillate
    // at corridor seams. First call (no sticky yet) bootstraps from the
    // nearest room.
    if (insideId) this._raceCurRoomId = insideId;
    if (!this._raceCurRoomId) this._raceCurRoomId = nearestId;
    let curId = this._raceCurRoomId;
    if (!curId) return null;
    if (curId === graph.finishId) return finish;

    // BFS from current room to finish ; record predecessor to reconstruct
    // the next-step neighbor. Edges carry the tunnel midpoint as the
    // helper-waypoint for inside-room steering.
    const prev = {};
    const queue = [curId];
    const visited = { [curId]: true };
    let found = false;
    while (queue.length) {
      const id = queue.shift();
      if (id === graph.finishId) { found = true; break; }
      const n = nodes[id];
      for (const nb of n.neighbors) {
        if (visited[nb.id]) continue;
        visited[nb.id] = true;
        prev[nb.id] = { fromId: id, mid: nb.mid };
        queue.push(nb.id);
      }
    }
    if (!found) return finish;

    // Walk back from finish to the immediate-next room after curId.
    let stepId = graph.finishId;
    let stepEdge = prev[stepId];
    while (stepEdge && stepEdge.fromId !== curId) {
      stepId = stepEdge.fromId;
      stepEdge = prev[stepId];
    }
    const nextRoom = nodes[stepId];
    if (!nextRoom) return finish;

    // Steering choice:
    //   * Inside the current room sphere : aim at the corridor MIDPOINT to
    //     thread the corridor mouth (the room sphere is wide enough that
    //     aiming at the next-room center can leave the bot scraping a
    //     wall on its way out).
    //   * Outside the current room sphere (we've left through the mouth
    //     and are now in the corridor or near the next room) : aim
    //     DIRECTLY at the next room's CENTER. A room is a guaranteed-clear
    //     sphere ; the line from anywhere on or near the corridor axis to
    //     the room center is clear of geometry.
    if (insideId === curId && stepEdge) return stepEdge.mid;
    return nextRoom;
  }


  // ----- Bot.update(dt) (movement, aiming, firing, ability use, death/respawn) -----
  update(dt) {
    if (!this.alive) return;
    // (webgpu port) SDF collision is now wired (Phase A), so the v17 AI
    // can run natively. The freeze-when-no-levelBoxes guard previously
    // here is no longer needed.
    // Bots are locked in place during pre-round warmup.
    if (game.state === 'warmup') {
      if (this.velocity) this.velocity.set(0, 0, 0);
      return;
    }

    // Decay fire flash for gun animation
    if (this.fireFlashTimer > 0) { this.fireFlashTimer -= dt; if (this.fireFlashTimer <= 0) this.isFiring = false; }

    this.spawnProtection = Math.max(0, this.spawnProtection - dt);

    // (v14e) Slayer Teleport stun. While stunned, the bot can't steer
    // or fire ; velocity bleeds off so it floats helplessly. Doomed timer
    // and shieldRegenDelay still tick down (handled below) so the stun
    // doesn't accidentally extend other state.
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.velocity) this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4));
      // Spawn a brief crackle arc on the bot every ~0.2s so the stun is
      // visually obvious. Cheap fallback if spawnLightningBolt is missing.
      if (typeof spawnLightningBolt === 'function' && Math.random() < dt * 5) {
        const _o1 = new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30).add(this.position);
        const _o2 = new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30).add(this.position);
        try { spawnLightningBolt(_o1, _o2, 0xaaccff, 0.08, 1, 0.8); } catch (_e) {}
      }
      return;
    }

    // Damage smoke/fire when hull is damaged
    if (this.health < this.maxHealth * 0.5) {
      spawnDamageSmoke(this.position, this.health / this.maxHealth);
    }

    // Shield does NOT regen naturally; only via stasis fields and executions

    // Doomed timer
    if (this.doomed) {
      this.doomTimer -= dt;
      if (this.doomTimer <= 0) { this.die(null); return; }
    }

    // Retreat behavior when doomed
    if (this.doomed && !this.aiRetreating) {
      this.aiRetreating = true;
    }

    // AI: find target
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 1 + Math.random() * 2;
      this.findTarget();
      this.aiWanderDir.set(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
    }

    // (v13r) Race-mode movement override. Combat targeting + firing logic
    // above is preserved (fireAtPlayer below uses player.position directly,
    // not aiTarget), so bots still shoot ; we just steer their movement
    // toward the next room along the BFS path to the champion-flagged
    // finish room. The override is a noop if the level has no race graph
    // or no champion room, so race mode degrades gracefully on classic maps.
    let _raceWaypoint = null;
    // (v14e) Classic-mode champion seek. Once the champion field is alive,
    // steer every bot toward it so they actually try to capture. Combat
    // firing logic below still runs independently, so bots will engage
    // enemies they pass on the way without abandoning the objective.
    // Race mode has its own waypoint logic (below) ; only classic uses
    // this hook.
    if (LSS.MODE !== 'race' && game.state === 'playing' &&
        game.championField && game.championField.alive && game.championField.position) {
      // If THIS bot is the one currently capturing, freeze in the field.
      if (game.championField.claimedBy !== this) {
        if (!this.aiTarget) this.aiTarget = new THREE.Vector3();
        this.aiTarget.copy(game.championField.position);
        this.aiRetreating = false;
        this.aiRole = 'engage';
        _raceWaypoint = this.aiTarget; // reuse the race-mode steering shortcut
      }
    }
    if (LSS.MODE === 'race' && game.state === 'playing' && game.raceGraph && game.raceGraph.finishId) {
      _raceWaypoint = this.chooseRaceWaypoint();
      if (_raceWaypoint) {
        if (!this.aiTarget) this.aiTarget = new THREE.Vector3();
        this.aiTarget.set(_raceWaypoint.x, _raceWaypoint.y, _raceWaypoint.z);
        this.aiRetreating = false;
        this.aiRole = 'engage';

        // Stuck detector: if the bot has been near the same position for
        // more than 1.5s while racing, perturb aiTarget by a random vertical
        // and lateral offset for the next ~0.8s. This dislodges bots wedged
        // against a wall or stuck in a corner where pure target-seeking
        // can't escape. Tracked via _stuckPos / _stuckT scratches.
        const _now = (game && typeof game.time === 'number') ? game.time : 0;
        if (!this._stuckPos) {
          this._stuckPos = new THREE.Vector3().copy(this.position);
          this._stuckT = _now;
        } else {
          const dx = this.position.x - this._stuckPos.x;
          const dy = this.position.y - this._stuckPos.y;
          const dz = this.position.z - this._stuckPos.z;
          if (dx*dx + dy*dy + dz*dz > 60 * 60) {
            // Moved enough ; reset.
            this._stuckPos.copy(this.position);
            this._stuckT = _now;
            this._stuckNudgeUntil = 0;
          } else if ((_now - this._stuckT) > 1.5) {
            // Been stuck. Apply (or extend) a nudge for ~0.8s.
            if (!this._stuckNudgeUntil || _now > this._stuckNudgeUntil) {
              this._stuckNudgeUntil = _now + 0.8;
              const ang = Math.random() * Math.PI * 2;
              const r   = 400 + Math.random() * 400;
              this.aiTarget.x += Math.cos(ang) * r;
              this.aiTarget.y += (Math.random() - 0.3) * 600;
              this.aiTarget.z += Math.sin(ang) * r;
            }
          }
        }
      }
    }

    // Strafe timer for combat movement
    this.aiStrafeTimer -= dt;
    if (this.aiStrafeTimer <= 0) {
      this.aiStrafe = Math.random() < 0.5;
      this.aiStrafeDir = Math.random() < 0.5 ? 1 : -1;
      this.aiStrafeTimer = 1 + Math.random() * 2; // Strafe for 1-3 seconds
    }

    // moveDir starts as the wander direction. Previously this used .clone(),
    // which allocated per frame per bot (every bot, every frame). Copy into
    // _tempVec3c and reuse; any reassignments below also point into scratches.
    let moveDir = this._tempVec3c.copy(this.aiWanderDir);
    // (v13r) Race-mode short-circuit. When racing, point straight at the
    // race waypoint and skip the flank/strafe combat overlays below. Those
    // overlays bias movement toward the player's position, which in race
    // mode reads as 'bot abandons the corridor to chase the player' and
    // is the main reason bots used to get stuck on walls. Combat firing
    // (the fireAtPlayer block below) still runs unmodified.
    if (_raceWaypoint && this.aiTarget) {
      moveDir = this._tempVec3a.subVectors(this.aiTarget, this.position);
      const _rd = moveDir.length();
      if (_rd > 0.001) moveDir.multiplyScalar(1 / _rd);
      this.targetDir.lerp(moveDir, dt * 2);
      this.targetDir.normalize();
    } else if (this.aiTarget) {
      const toTarget = this._tempVec3a.subVectors(this.aiTarget, this.position);
      const dist = toTarget.length();

      if (this.aiRetreating) {
        // Retreat at max speed away from player
        moveDir = this._tempVec3b.subVectors(this.position, player.position).normalize();
      } else if (dist > 100) {
        moveDir = toTarget.normalize();

        // Flanking behavior: offset movement perpendicular to player angle
        const toPlayer = this._tempVec3b.subVectors(player.position, this.position);
        const distToPlayer = toPlayer.length();

        if (this.aiRole === 'flank' && distToPlayer < 3000 && distToPlayer > 300) {
          // Build orthogonal direction for flanking (perpendicular to player facing).
          // toPlayer becomes playerDir after normalize(); reuse _tempVec3d for the
          // right/flank math to avoid `new THREE.Vector3()` on every flanking frame.
          const playerDir = toPlayer.normalize();
          const right = this._tempVec3d.set(0, 1, 0).cross(playerDir).normalize();
          // flankTarget = player.position + right * 600, then toFlank = flankTarget - this.position.
          // = (player.position - this.position) + right * 600 = (-toPlayer_was) + right*600,
          // but we've overwritten _tempVec3b; easiest path: reuse _tempVec3d as right*600,
          // then build toFlank into _tempVec3b directly.
          right.multiplyScalar(600);
          this._tempVec3b.set(
            player.position.x + right.x - this.position.x,
            player.position.y + right.y - this.position.y,
            player.position.z + right.z - this.position.z
          ).normalize();
          moveDir.lerp(this._tempVec3b, 0.6);
          moveDir.normalize();
        }

        // Combat strafing: lateral movement when in engagement range.
        // _tempVec3b here may have been overwritten by the flank branch, so
        // re-derive toPlayer into _botStep (we reuse it below for substepping
        // but each substep overwrites via .copy(), so this is safe).
        if (this.aiStrafe && distToPlayer < this.aiRangePreference * 1.5 && !this.doomed) {
          // Original: up.cross(toPlayer). _tempVec3d holds world-up; _botStep holds toPlayer.
          this._tempVec3d.set(0, 1, 0);
          this._botStep.subVectors(player.position, this.position);
          const perp = this._tempVec3d.cross(this._botStep).normalize();
          const k = this.aiStrafeDir * 0.5;
          moveDir.x += perp.x * k;
          moveDir.y += perp.y * k;
          moveDir.z += perp.z * k;
          moveDir.normalize();
        }
      }
    }

    if (!_raceWaypoint) {
      this.targetDir.lerp(moveDir, dt * 2);
      this.targetDir.normalize();
    }

    // Arc slow effect (from SLAYER Stun Bolt). Avoid cloning targetDir just to
    // scale-and-add; apply component-wise to velocity.
    const accelK = (this.arcSlowTimer > 0)
      ? (this.chassis.acceleration * dt * 0.3)
      : (this.chassis.acceleration * dt);
    if (this.arcSlowTimer > 0) this.arcSlowTimer -= dt;
    this.velocity.x += this.targetDir.x * accelK;
    this.velocity.y += this.targetDir.y * accelK;
    this.velocity.z += this.targetDir.z * accelK;

    const speed = this.velocity.length();
    // (v13r) Race mode normalizes bot top speed to LSS.RACE_SPEED across
    // all chassis so the field stays bunched together regardless of
    // ship choice. Arc-slow debuff still applies (debuffs aren't removed
    // by mode), just to the race speed instead of the chassis speed.
    const _baseSpd = (LSS.MODE === 'race') ? LSS.RACE_SPEED : this.chassis.flightSpeed;
    const maxSpd = this.arcSlowTimer > 0 ? _baseSpd * 0.3 : _baseSpd;
    if (speed > maxSpd) {
      this.velocity.multiplyScalar(maxSpd / speed);
    }
    this.velocity.multiplyScalar(1 - this.chassis.deceleration * dt / Math.max(speed, 1));

    // Substep movement + collision (prevents tunneling at high speed).
    // Per-substep: was `this.velocity.clone().multiplyScalar(botSubDt)`.
    // Now uses the per-bot _botStep scratch.
    const botCollR = this.chassis.hullLength * 0.5;
    const botMoveLen = this.velocity.length() * dt;
    const botMaxStep = botCollR * 0.8;
    const botSubs = Math.max(1, Math.ceil(botMoveLen / botMaxStep));
    const botSubDt = dt / botSubs;
    for (let ss = 0; ss < botSubs; ss++) {
      this.position.add(this._botStep.copy(this.velocity).multiplyScalar(botSubDt));
      resolveCollision(this.position, this.velocity, botCollR, this);
    }

    // Boundary clamp
    const s = LSS.ARENA_SIZE * 0.9;
    this.position.clamp(this._tempVec3a.set(-s,-s,-s), this._tempVec3b.set(s,s,s));

    this.mesh.position.copy(this.position);
    if (speed > 1) {
      this.mesh.lookAt(this._tempVec3a.copy(this.position).add(this.targetDir));
    }

    // AI: fire at player (with range preference, LOS check, and doomed suppression)
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && game.state === 'playing' && !this.aiRetreating) {
      const toPlayer = this._tempVec3a.subVectors(player.position, this.position);
      const distToPlayer = toPlayer.length();
      if (distToPlayer < this.loadout.weapon.range && player.shipState !== 'dead' && player.team !== this.team) {
        // Range preference check: only fire if within optimal range or close enough (range * 1.3)
        const preferredDist = this.aiRangePreference;
        const withinRange = distToPlayer <= preferredDist * 1.3;

        const dot = toPlayer.normalize().dot(this.targetDir);
        if (dot > 0.7 && withinRange) {
          // LOS check: raycast toward player, only fire if path is clear
          const losDist = raycastLevel(this.position, toPlayer, distToPlayer + 10);
          if (losDist >= distToPlayer - 5) {
            // (v16a) Test mode : bots fly the same AI patterns but never fire.
            // The fireTimer is still scheduled so movement / target-lock state
            // ticks normally ; only the actual fireAtPlayer call is skipped.
            if (!game.testMode) {
              this.fireAtPlayer(toPlayer, distToPlayer);
            }
            this.fireTimer = this.loadout.weapon.fireRate * (1 + Math.random() * 0.5);
          }
        }
      }
    }

    // (v6.9) Bot ability use. Tick cooldowns and (when not retreating, in
    // playing state, with player visible) attempt the offensive ability.
    // Utility traps (Plasma Mines, Explosive Gas) drop opportunistically
    // when the player is within range and bot is healthy.
    this.abilityCooldowns[0] = Math.max(0, this.abilityCooldowns[0] - dt);
    this.abilityCooldowns[2] = Math.max(0, this.abilityCooldowns[2] - dt);
    // (v16a) Skip ability use in test mode ; offensive abilities spawn
    // projectiles tagged with owner='bot' that damage the player same as
    // weapon fire.
    if (game.state === 'playing' && !this.aiRetreating && player.shipState !== 'dead' && player.team !== this.team && !game.testMode) {
      this.tryUseAbilities();
    }

    this.coreMeter = Math.min(100, this.coreMeter + dt * 1.5);
  }


  // ----- _botFireAbility helpers (tryUseAbilities / _tryUseOffensive / _tryUseUtility) -----

  // (v6.9) Try to fire any ready offensive / utility ability. Each branch
  // implements a simplified version of the player's executeAbility for that
  // loadout: aim toward the player, spawn the same projectile/effect with
  // owner = 'bot' so playerTakeDamage / Plasma Shield etc. accept it. Bots
  // skip defensive shields for now (added complexity for marginal AI gain).
  tryUseAbilities() {
    const off = this.loadout.abilities[0];
    const util = this.loadout.abilities[2];
    if (off && this.abilityCooldowns[0] <= 0) {
      this._tryUseOffensive(off);
    }
    if (util && this.abilityCooldowns[2] <= 0) {
      this._tryUseUtility(util);
    }
  }

  _tryUseOffensive(ability) {
    if (player.shipState === 'dead') return;
    // (v16c Phase D) Cleaned up the .clone() spam in this method. Pattern :
    //   - aim.clone().multiplyScalar(N) -> _tempVec3b.copy(aim).multiplyScalar(N)
    //   - this.position.clone() passed to Projectile is dropped (the
    //     constructor calls origin.clone() itself, so the outer clone
    //     was redundant). Same logic for the velocity arg.
    //   - this.position.clone().add(scaled) -> _tempVec3c.copy(this.position).add(scaled)
    // Each ability fire used to alloc 3-9 Vector3 instances ; now 1-2.
    const toPlayer = this._tempVec3a.subVectors(player.position, this.position);
    const dist = toPlayer.length();
    // Range gate: most offensive abilities want the player within 2400 u and
    // visible. Out-of-range just skips ; we keep the cooldown ticking from 0.
    if (dist > 2400) return;
    // Normalize in place ; toPlayer.dot(aim) below still works because
    // aim is the SAME vector after normalize, but we want toPlayer's
    // un-normalized form for that dot. Capture length first (already
    // done), then normalize toPlayer to use as aim.
    const aim = toPlayer.normalize(); // _tempVec3a, now unit length
    const losDist = raycastLevel(this.position, aim, dist + 10);
    if (losDist < dist - 5) return; // wall in the way
    let used = true;
    if (ability.name === 'Laser') {
      // Hitscan beam. Same color stack as the player's Laser and
      // damage scaled to the ability's listed dmg, with bot accuracy
      // multiplier so shots aren't pinpoint at long range.
      const range = 2500;
      const reach = Math.min(range, losDist);
      const beamEnd = this._tempVec3c.copy(this.position).addScaledVector(aim, reach);
      spawnTracer(this.position, beamEnd, 0xff2200, 1.6);
      spawnTracer(this.position, beamEnd, 0xffaa44, 1.4);
      // Hit if target is roughly along the beam axis. dist is the
      // pre-normalized length we saved above so this still works.
      if (dist > 0 && dist < range) {
        const closest = this._tempVec3d.copy(this.position).addScaledVector(aim, dist);
        if (closest.distanceTo(player.position) < player.chassis.hullLength * 1.0) {
          playerTakeDamage(2400 * 0.6, this, null);
        }
      }
    } else if (ability.name === 'Cluster Missile') {
      const vel = this._tempVec3b.copy(aim).multiplyScalar(900);
      // Projectile constructor clones origin + velocity ; passing scratches
      // is safe because they're not retained.
      const proj = new Projectile(this.position, vel, 800, 200, 'bot', LSS.CLASS_COLORS.PUNCTURE);
      proj.cluster = true;
      proj.sizeMult = 2.4;
      proj.smokeTrail = true;
      proj.removeHaze();
      game.projectiles.push(proj);
    } else if (ability.name === 'Stun Bolt') {
      const vel = this._tempVec3b.copy(aim).multiplyScalar(800);
      const proj = new Projectile(this.position, vel, 1200, 150, 'bot', LSS.CLASS_COLORS.SLAYER);
      proj.isArcWave = true;
      game.projectiles.push(proj);
    } else if (ability.name === 'Charge Shot') {
      const vel = this._tempVec3b.copy(aim).multiplyScalar(1200);
      const proj = new Projectile(this.position, vel, 1900, 100, 'bot', LSS.CLASS_COLORS.BLASTER);
      proj.sizeMult = 1.8;
      game.projectiles.push(proj);
    } else if (ability.name === 'Tracker Rockets') {
      // Three rockets in a tight cone toward the player. Reuse _tempVec3b
      // as the scratch for each rocket's direction+velocity (the
      // constructor clones, so reusing across iterations is fine).
      for (let i = 0; i < 3; i++) {
        const vel = this._tempVec3b.set(
          aim.x + (Math.random()-0.5)*0.10,
          aim.y + (Math.random()-0.5)*0.10,
          aim.z
        ).normalize().multiplyScalar(700);
        const proj = new Projectile(this.position, vel, 1100, 100, 'bot', LSS.CLASS_COLORS.TRACKER);
        proj.smokeTrail = true;
        proj.removeHaze();
        game.projectiles.push(proj);
      }
    } else if (ability.name === 'Energy Syphon') {
      // Beam that pulls + damages. Skip implementation complexity ; bots
      // just fire a high-damage hitscan to mimic the gameplay impact.
      const range = 1500;
      const reach = Math.min(range, losDist);
      const beamEnd = this._tempVec3c.copy(this.position).addScaledVector(aim, reach);
      spawnTracer(this.position, beamEnd, 0x66ddff, 1.4);
      if (dist > 0 && dist < range) {
        const closest = this._tempVec3d.copy(this.position).addScaledVector(aim, dist);
        if (closest.distanceTo(player.position) < player.chassis.hullLength * 1.0) {
          playerTakeDamage(900 * 0.6, this, null);
          // Energy Syphon stuns the target ; play the stun cue so the player
          // hears the disable in addition to seeing/feeling the damage. Plays
          // even when the player's shields fully absorbed the hit because the
          // ability still applies the slow, just like the player-vs-bot path.
          try { playSound('stun'); } catch (e) {}
        }
      }
    } else if (ability.name === 'Flame Chain') {
      // Plant a forward firewall in the bot's facing direction. Same world
      // effect as the player path so it shares damage / sound / cleanup.
      // (Phase D) wallStart and worldEffect.position/direction get retained
      // by the worldEffects array so they DO need real allocations - keep
      // them as fresh Vector3s rather than scratches.
      const wallStart = this.position.clone().addScaledVector(aim, 80);
      const myEffId = ++net.effectIdCounter;
      if (typeof spawnFlameChainVisual === 'function') {
        spawnFlameChainVisual(wallStart, aim, 800, this.team, null, myEffId);
      }
      game.worldEffects.push({
        type: 'firewall', position: wallStart, direction: aim.clone(),
        length: 800, timer: 5, dmgPerSec: 400, owner: 'bot', team: this.team,
        fxTimer: 0, meshes: [], netId: myEffId,
      });
    } else {
      used = false;
    }
    if (used) {
      // 1.5x to 2x the listed cooldown so bots don't spam abilities perfectly.
      // (v9 fix) Tracker Rockets has its real cooldown set to 0.25 because the
      // PLAYER-side gate is the lock requirement (no full lock = no fire).
      // Bots have no lock gate ; they'd fire rockets every 0.35 sec without
      // an override. Force the bot's effective cooldown back up so they
      // simulate the time it takes to build a full lock through chip damage.
      let _baseCd = ability.cooldown;
      if (ability.name === 'Tracker Rockets') _baseCd = 7;
      this.abilityCooldowns[0] = _baseCd * (1.4 + Math.random() * 0.6);
    }
  }

  _tryUseUtility(ability) {
    // Drop traps when the player is in range and roughly in front of us.
    // (v16c Phase D) Same pattern as _tryUseOffensive : normalize toPlayer
    // in place to get aim, use addScaledVector instead of clone().add().
    // wallPos / orb positions are retained by worldEffects so they DO
    // need fresh allocations.
    if (player.shipState === 'dead') return;
    const toPlayer = this._tempVec3a.subVectors(player.position, this.position);
    const dist = toPlayer.length();
    if (dist > 1400) return;
    const aim = toPlayer.normalize(); // unit vector in _tempVec3a
    let used = true;
    if (ability.name === 'Explosive Gas') {
      const dropPos = this.position.clone().addScaledVector(aim, 160);
      if (typeof spawnIncendiaryGas === 'function') {
        spawnIncendiaryGas(dropPos, 'bot', this.team, null, ++net.effectIdCounter, false);
      }
    } else if (ability.name === 'Plasma Mines') {
      // Three trip-wire orbs in a forward line ; matches the player drop.
      // dropAhead is the world-space anchor (220 ahead) ; each orb is at
      // dropAhead + aim * (i * 110). Each orb position is retained by
      // worldEffects.push so they each need a fresh Vector3.
      for (let i = 0; i < 3; i++) {
        const orb = this.position.clone().addScaledVector(aim, 220 + i * 110);
        game.worldEffects.push({
          type: 'tripwire', position: orb, radius: 200,
          timer: 12, owner: 'bot', team: this.team,
          triggered: false, dmg: 600, slowFactor: 0.4, slowTimer: 1.5,
          arcTimer: 0, mesh: null,
        });
      }
    } else if (ability.name === 'Plasma Shield') {
      const wallPos = this.position.clone().addScaledVector(aim, 140);
      if (typeof spawnParticleWall === 'function') {
        spawnParticleWall(wallPos, aim.clone(), 'bot', this.team, null, ++net.effectIdCounter, false);
      }
    } else {
      used = false;
    }
    if (used) {
      this.abilityCooldowns[2] = ability.cooldown * (1.4 + Math.random() * 0.6);
    }
  }

  // ----- target selection / navigation -----
  findTarget() {
    if (player.shipState !== 'dead' && player.team !== this.team) {
      // Direct line of sight check
      const toPlayer = this._tempVec3a.subVectors(player.position, this.position);
      const dist = toPlayer.length();
      const dir = toPlayer.normalize();
      const losDist = raycastLevel(this.position, dir, dist + 10);
      if (losDist >= dist - 5) {
        // Can see the player; update last known position and share with squad
        this.aiLastKnownPlayer = player.position.clone();
        this.aiLastKnownTime = game.time;
        this.aiTarget = player.position.clone();
        this.aiSharedTargetAge = 0;

        // Enemy bots share player position via game state (simple broadcast)
        if (this.team === LSS.TEAM_FLEET_B) {
          if (!game.botSharedTarget) game.botSharedTarget = {};
          game.botSharedTarget.pos = player.position.clone();
          game.botSharedTarget.time = game.time;
        }
      } else {
        // Cannot see player; use last known or squad shared target
        let targetPos = null;

        // Check if squad has recent shared target info (within 5 to 8 seconds)
        if (this.team === LSS.TEAM_FLEET_B && game.botSharedTarget && game.botSharedTarget.time) {
          const targetAge = game.time - game.botSharedTarget.time;
          if (targetAge < 7) {
            targetPos = game.botSharedTarget.pos.clone();
            this.aiSharedTargetAge = targetAge;
          }
        }

        // Fallback: use own last known position (memory decay)
        if (!targetPos && this.aiLastKnownPlayer) {
          const memoryAge = game.time - this.aiLastKnownTime;
          if (memoryAge < 5) {
            // Add drift to simulate memory fade
            targetPos = this.aiLastKnownPlayer.clone().add(
              this._tempVec3b.set(
                (Math.random() - 0.5) * (memoryAge * 80),
                (Math.random() - 0.5) * (memoryAge * 40),
                (Math.random() - 0.5) * (memoryAge * 80)
              )
            );
          }
        }

        if (targetPos) {
          this.aiTarget = targetPos;
        } else {
          // No info; navigate to nearest corridor point toward enemy area
          this.navigateToEnemyTerritory();
        }
      }
    } else if (this.team === LSS.TEAM_FLEET_A) {
      // Friendly bot: protect player if alive, hold position otherwise
      if (player.shipState !== 'dead') {
        this.aiTarget = player.position.clone().add(
          this._tempVec3b.set(
            (Math.random() - 0.5) * 400,
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 400
          )
        );
      } else {
        this.navigateToEnemyTerritory();
      }
    } else {
      // Fallback: navigate via corridor points
      this.navigateToEnemyTerritory();
    }
  }

  navigateToEnemyTerritory() {
    // Find nearest corridor point and navigate toward enemy spawn area
    if (!game.corridorPoints || game.corridorPoints.length === 0) {
      // No nav points; random wander
      this.aiTarget = this._tempVec3a.set(
        (Math.random() - 0.5) * 3000,
        (Math.random() - 0.5) * 1000,
        (Math.random() - 0.5) * 3000
      );
      return;
    }

    const goal = this.team === LSS.TEAM_FLEET_A ? 'B' : 'A';
    let bestNav = null;
    let bestScore = Infinity;

    for (const nav of game.corridorPoints) {
      // Prefer points in enemy territory or leading toward it
      const distToNav = this._tempVec3a.set(nav.x, nav.y, nav.z).distanceTo(this.position);
      let score = distToNav;
      if (nav.team && nav.team !== goal) score -= 500; // Discount points in wrong territory
      if (score < bestScore) {
        bestScore = score;
        bestNav = nav;
      }
    }

    if (bestNav) {
      this.aiNavTarget = this._tempVec3a.set(bestNav.x, bestNav.y, bestNav.z);
      this.aiTarget = this.aiNavTarget.clone();
    }
  }


  // ----- _botFireBullet (fireAtPlayer; weapon firing with hitscan + spread paths) -----
  fireAtPlayer(dir, dist) {
    if (player.shipState === 'dead') return;
    // Line-of-sight check: can't shoot through walls
    const wallDist = raycastLevel(this.position, dir.clone().normalize(), dist + 10);
    if (wallDist < dist - 5) return; // wall blocks the shot
    this.isFiring = true; this.fireFlashTimer = 0.15; // for animation
    const weapon = this.loadout.weapon;
    // Distance-based accuracy: better up close, worse at range
    const rangeRatio = Math.max(0, 1 - dist / weapon.range);
    const accuracy = 0.25 + rangeRatio * 0.45; // 25%-70% hit chance based on range
    if (Math.random() > accuracy) return;

    let damage = weapon.damage;
    if (weapon.mode === 'spread') {
      // Spread weapons: pellet count scales with accuracy (distance)
      const hittingPellets = Math.max(1, Math.floor(weapon.pellets * (0.3 + rangeRatio * 0.5)));
      damage = weapon.damage * hittingPellets;
    }

    // Bot damage scaling: 60% of full damage (bots are less precise, not nerfed to nothing)
    damage *= 0.6;

    // Range falloff for hitscan (TF2 style: full damage up close, 70% at max range)
    if (weapon.mode === 'hitscan') {
      const falloff = 0.7 + rangeRatio * 0.3;
      damage *= falloff;
    }

    // ---- BOT FIRING VFX ----
    const fireOrigin = this.position.clone();
    const fireDir = dir.clone().normalize();

    // Color scheme per loadout. Pulled from chassisFlashColor() so bot
    // tracers share the same per-ship palette as player tracers (Syphon
    // cyan-green, Vortex cyan, etc.) instead of every non-Vortex bot
    // firing yellow.
    const flashColor = (typeof chassisFlashColor === 'function')
      ? chassisFlashColor(this.loadout.name)
      : 0xffdd44;

    if (weapon.mode === 'hitscan') {
      // Hitscan weapons: tracer, muzzle particles, muzzle flash light.
      // Chaingun-class weapons (fireRate <= 0.10) get a thinner tracer so
      // overlapping haze layers don't pile up into a 2D streak.
      const isChaingunBot = (weapon.fireRate <= 0.10);
      spawnTracer(fireOrigin, player.position, flashColor, isChaingunBot ? 0.55 : 1.0);

      // Muzzle particles
      for (let i = 0; i < 2; i++) {
        const pVel = fireDir.clone().multiplyScalar(250 + Math.random() * 150);
        pVel.x += (Math.random() - 0.5) * 100;
        pVel.y += (Math.random() - 0.5) * 100;
        pVel.z += (Math.random() - 0.5) * 100;
        game.particles.push({
          position: fireOrigin.clone(),
          velocity: pVel,
          life: 0.12 + Math.random() * 0.08,
          maxLife: 0.2,
          color: flashColor,
          size: 2 + Math.random() * 2
        });
      }

      // Muzzle flash light
      spawnDynamicLight(fireOrigin, flashColor, 2.0, 300, 0.1);
    } else if (weapon.mode === 'spread') {
      // (v14g) Bot spread weapons (Slayer Shotgun) now use the same
      // spawnPelletBurst as the player so bot Slayers visibly fire a
      // wall of buckshot instead of streaks of laser tracers. Each
      // pellet path emits one burst ; the burst function provides its
      // own muzzle flash light.
      const _shots = Math.max(2, Math.floor(weapon.pellets * 0.5));
      for (let i = 0; i < _shots; i++) {
        const spreadDir = fireDir.clone();
        spreadDir.x += (Math.random() - 0.5) * 0.15;
        spreadDir.y += (Math.random() - 0.5) * 0.15;
        spreadDir.z += (Math.random() - 0.5) * 0.15;
        spreadDir.normalize();
        const _travel = Math.min(dist + 200, weapon.range);
        spawnPelletBurst(fireOrigin, spreadDir, _travel);
      }
    }

    playerTakeDamage(damage, this);
    // TRACKER bot lock-on: hits build lock marks on the player (max 3). The sonar
    // ping is reserved for the player's OWN TRACKER lock progression (hear-when-
    // you-lock), not for enemy lock progression onto you; the on-screen
    // "ENEMY LOCKED-ON" warning pips already communicate incoming threat
    // visually. Otherwise every ship being TRACKER-shot would hear lock pings.
    if (this.loadoutKey === 'TRACKER') {
      const prevEnemyLocks = player.enemyToneLocks[this.id] || 0;
      player.enemyToneLocks[this.id] = Math.min(3, prevEnemyLocks + 1);
      if (player._enemyLockDecayTimers) player._enemyLockDecayTimers[this.id] = 0; // reset decay
    }
    // Bot core meter charges from dealing damage
    this.coreMeter = Math.min(100, this.coreMeter + damage / 100);
  }


  // ----- takeDamage / death animation / respawn path -----

  takeDamage(amount, attacker, hitPoint) {
    if (!this.alive || this.spawnProtection > 0) return 0;

    if (this.shield > 0) {
      if (amount <= this.shield) { this.shield -= amount; }
      else { const overflow = amount - this.shield; this.shield = 0; this.health -= overflow; }
    } else {
      this.health -= amount;
    }

    // Track damage-dealt on bot attackers (player is tracked at the call sites).
    // 'debris' and string attackers pass through unchanged.
    if (attacker && typeof attacker === 'object' && attacker.alive !== undefined) {
      attacker.damageDealt = (attacker.damageDealt || 0) + amount;
    }

    // (v14g) Localized shield ripple at the impact point in the SHIP'S
    // OWN weapon color. Dropped the global flashShieldImpact() call ;
    // that was pulsing the ENTIRE sphere on every hit which read as "the
    // whole shield lit up". Now only the recordShieldHit ripple plays,
    // painting a bright spot at the contact point that propagates outward
    // across the sphere surface and fades over RIPPLE_MAX_AGE seconds.
    const shieldMesh = this.mesh.userData.shieldMesh;
    if (shieldMesh && this.shield > 0) {
      const ripColor = _shipShieldColor(this.loadoutKey);
      spawnShieldHit(hitPoint || this.position, this.chassis.hullLength * 0.8, ripColor, this.mesh);
    }

    if (!this.doomed && this.health > 0 && this.health / this.maxHealth <= LSS.DOOMED_HEALTH_PCT) {
      this.doomed = true;
      this.doomTimer = LSS.DOOMED_TIMER;
    }

    // (port glue) Hit SFX. Spatial ping so the player hears where damage
    // is landing. Shield hits get a higher-pitched tick ; hull hits get
    // the metallic clang.
    try {
      const sfxKey = (this.shield > 0) ? 'shield_hit' : 'hit_metal';
      if (typeof playSpatialSound === 'function') {
        playSpatialSound(sfxKey, hitPoint || this.position, { volume: 0.6 });
      } else if (typeof playSound === 'function') {
        playSound(sfxKey, { volume: 0.5 });
      }
    } catch (_) {}

    if (this.health <= 0) { this.die(attacker); }
    return amount;
  }

  die(attacker) {
    this.alive = false;
    this.health = 0;
    scene.remove(this.mesh);
    spawnExplosion(this.position, this.chassis.hullLength);
    // (port glue) Death SFX. Big spatial explosion clip + a softer kill
    // toast tick if the audio recipe is available.
    try {
      if (typeof playSpatialSound === 'function') {
        playSpatialSound('ship_explode', this.position, { volume: 1.0 });
      } else if (typeof playSound === 'function') {
        playSound('ship_explode', { volume: 0.9 });
      }
    } catch (_) {}
  }

  // (v17 verbatim) Cleanup hook called by spawnBots when wiping the
  // previous round's roster. Removes the mesh from the scene so the
  // next Bot()'s scene.add doesn't pile orphan meshes on top of it.
  destroy() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.alive = false;
  }
  }

// (Phase A+) spawnBots : re-injected verbatim from v17 source after the
// extraction stripped it.
function spawnBots() {
  // Snapshot existing bot match stats by loadoutKey so respawning between
  // rounds does not wipe the scoreboard. Fresh-match callers have no
  // existing entities, so the map is empty and new bots start at zero.
  const _prevStats = {};
  for (const bot of game.entities) {
    if (bot.loadoutKey) {
      _prevStats[bot.loadoutKey] = {
        kills: bot.kills || 0,
        damageDealt: bot.damageDealt || 0,
      };
    }
    bot.destroy();
  }
  game.entities = [];

  const applyPrev = (bot) => {
    const p = _prevStats[bot.loadoutKey];
    if (p) {
      bot.kills = p.kills;
      bot.damageDealt = p.damageDealt;
    }
  };

  const enemyLoadouts = ['PYRO', 'SLAYER', 'TRACKER'];
  for (let i = 0; i < 3; i++) {
    const bot = new Bot(enemyLoadouts[i], LSS.TEAM_FLEET_B, i + 1);
    const sp = (typeof getValidSpawnPoint === 'function') ? getValidSpawnPoint('B') : null;
    if (sp) bot.position.copy(sp);
    applyPrev(bot);
    game.entities.push(bot);
  }

  const friendlyLoadouts = ['PUNCTURE', 'BLASTER'];
  for (let i = 0; i < 2; i++) {
    const bot = new Bot(friendlyLoadouts[i], LSS.TEAM_FLEET_A, i + 10);
    const sp = (typeof getValidSpawnPoint === 'function') ? getValidSpawnPoint('A') : null;
    if (sp) bot.position.copy(sp);
    applyPrev(bot);
    game.entities.push(bot);
  }
}
try { window.spawnBots = spawnBots; } catch (_) {}
try { window.Bot = Bot; } catch (_) {}
