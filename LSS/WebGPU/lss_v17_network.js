// v17 multiplayer networking layer extracted from last_ship_sailing_v17.html
// Trystero P2P over WebRTC ; tier-1 state (20Hz) + tier-3 hit consensus.

// ---- P2P MESH NETWORK ----
// Uses trystero (BitTorrent tracker signaling) for truly serverless multiplayer.
// Architecture:
//   Tier 1 (broadcast, 20Hz): position, quaternion, velocity, health, shield, loadout, team
//   Tier 2 (foveal, 60Hz):    precise aim, projectile data (between engaged players)
//   Tier 3 (event-driven):    hit claims, kills, round events (consensus validated)

const net = {
  active: false,
  solo: false,
  room: null,
  myPeerId: null,
  peers: new Map(),           // peerId -> { state, mesh, lastUpdate, interpolation, ready }
  networkPlayers: [],         // NetworkPlayer instances (mirrors game.entities for bots)

  // Trystero actions (set up on room join)
  sendState: null,            // broadcast own state
  sendHitClaim: null,         // claim a hit on another player
  sendHitVote: null,          // vote on a hit claim
  sendEvent: null,            // round events, chat, etc.
  sendLoadout: null,          // announce chosen loadout
  sendProjectile: null,       // broadcast projectile spawn

  // Broadcast config
  broadcastHz: 20,
  broadcastAccum: 0,
  fovealHz: 60,
  fovealAccum: 0,

  // Hit consensus
  pendingHits: new Map(),     // hitId -> { claimerId, targetId, damage, votes: Map<peerId, bool>, timestamp }
  hitIdCounter: 0,

  // Stats
  bytesSent: 0,
  bytesReceived: 0,

  // Ready / match-start state (v6.7 ready-lobby)
  myReady: false,
  startScheduledAt: null,   // wall-clock ms when match-start fires (null = not scheduled)
  startTimer: null,         // setTimeout handle for the scheduled start

  // Synced ship-select launch (v6.7). The loadout broadcast IS the "ready"
  // signal in ship-select; when every peer has a loadout, the lowest-peerId
  // proposes a wall-clock launchAt and every peer fires launchCountdown()
  // at that moment.
  launchScheduledAt: null,
  launchTimer: null,

  // Synced world state (v6.7). The lobby proposer picks a map key + a 32-bit
  // seed and broadcasts them with match_start; every peer applies them before
  // commitLoadout's world build. Seeding the corridor / obstacle / organic
  // placement ensures both peers stand in the same physical geometry, so
  // broadcast player positions land in the same coordinate frame.
  worldMap: null,
  worldSeed: null,

  // Stasis field sync (v6.7). Owner pattern: lowest-peerId in the mesh is
  // the spawner. They tick the spawn timer, compute positions, broadcast
  // stasis_spawn; every peer (including spawner) instantiates from the
  // broadcast. Pickup is broadcast by whoever consumed the field so all
  // peers remove it visually.
  stasisIdCounter: 0,

  // World-effect netIds (v6.7). Tripwires, particle walls, gas clouds, etc.
  // Owner-broadcast spawn carries the netId; receivers tag their local copy
  // with the same id so destroy events line up.
  effectIdCounter: 0,

  // ---- CONSENSUS GAME SYNC (3+ peer fix, owner-free) ----
  // Every peer ticks its own game.warmupTimer / roundTimer / scores /
  // currentRound on a local clock and broadcasts that snapshot at
  // gameSyncHz. Every peer also receives every other peer's snapshot and
  // pulls its local values toward the consensus: AVERAGE for continuous
  // values (timers, game.time), MAX for forward-only values (scores,
  // currentRound). No single peer is "the owner" ; if any one peer lags or
  // drops, the consensus is computed from whichever peers are still
  // reporting fresh data, so the mesh self-heals and the lag of one peer
  // can't desync the others. Stale snapshots (no update for STALE_MS) are
  // dropped from the consensus automatically.
  gameSyncHz: 5,
  gameSyncAccum: 0,
  // peerGameSync: fromPeerId -> { rt, wt, et, mt, cr, sa, sb, gt, lastUpdate }
  // Most recent snapshot from each peer. Read by applyGameSyncConsensus.
  peerGameSync: new Map(),
  // Stale-snapshot cutoff. Older than this and the peer is excluded from
  // the consensus (they may be lagging or have dropped). 2s gives enough
  // slack for a peer to miss a few 5 Hz frames before being skipped.
  gameSyncStaleMs: 2000,
};

// Generate a short random ID
function generatePeerId() {
  return 'p' + Math.random().toString(36).substring(2, 8);
}


// ----- next block -----

async function joinRoom() {
  // (v16a) Clear the test-mode flag so a previous TEST MODE session doesn't
  // bleed into multiplayer (passive bots in a multiplayer match would be
  // very confusing, and test mode is offline-only anyway).
  game.testMode = false;
  const codeInput = document.getElementById('room-code');
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    document.getElementById('lobby-status').textContent = 'ENTER A ROOM CODE';
    document.getElementById('lobby-status').style.color = '#ff6666';
    return;
  }

  document.getElementById('lobby-status').textContent = 'CONNECTING TO MESH...';
  document.getElementById('lobby-status').style.color = '#ffaa00';
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-solo').disabled = true;

  try {
    // Dynamic import of trystero (loaded via module script tag)
    const trystero = await import('https://esm.sh/@trystero-p2p/torrent');
    const { joinRoom: trysteroJoin, selfId } = trystero;

    // (v6.7) Use trystero's own peer-id, not our local random id. The mesh
    // identifies us by selfId (the same id other peers see in their onPeerJoin
    // handler), so the proposer-tie-break in checkAllReady() must compare
    // own-id and other-ids in the same id-space. Using two different schemes
    // breaks the all-ready handshake silently (nobody picks themselves).
    net.myPeerId = selfId;
    net.active = true;
    net.solo = false;

    // Join the room via BitTorrent trackers
    net.room = trysteroJoin({ appId: 'last-ship-sailing-v1' }, code);
    // (v10 Phase 6) Stash the room code so the heartbeat ticker can
    // include it in /heartbeat posts and so returnToRootMenu can DELETE
    // the room when we leave.
    net.roomCode = code;
    // (v10 Phase 6) Start heartbeat ticker (~30s) so this room shows up
    // in lss.fractalreality.ca/rooms.html. Skipped silently if user not
    // signed in (the API requires a Discord OAuth token). Idempotent ;
    // calling again replaces the previous interval.
    if (typeof startRoomHeartbeat === 'function') startRoomHeartbeat();

    // Set up data channels
    const [sendState, onState] = net.room.makeAction('state');
    const [sendHitClaim, onHitClaim] = net.room.makeAction('hit');
    const [sendHitVote, onHitVote] = net.room.makeAction('vote');
    const [sendEvent, onEvent] = net.room.makeAction('event');
    const [sendLoadout, onLoadout] = net.room.makeAction('loadout');
    const [sendProjectile, onProjectile] = net.room.makeAction('proj');

    net.sendState = sendState;
    net.sendHitClaim = sendHitClaim;
    net.sendHitVote = sendHitVote;
    net.sendEvent = sendEvent;
    net.sendLoadout = sendLoadout;
    net.sendProjectile = sendProjectile;

    // Peer state updates (Tier 1 broadcast)
    onState((data, peerId) => {
      net.bytesReceived += JSON.stringify(data).length;
      const peer = net.peers.get(peerId);
      if (peer) {
        peer.prevState = peer.state ? { ...peer.state } : null;
        peer.state = data;
        peer.lastUpdate = performance.now();
        peer.interpT = 0;
      }
    });

    // Hit claims (Tier 3: consensus)
    onHitClaim((claim, peerId) => {
      handleHitClaim(claim, peerId);
    });

    // Hit votes
    onHitVote((vote, peerId) => {
      handleHitVote(vote, peerId);
    });

    // Events (round sync, kills, etc.)
    onEvent((evt, peerId) => {
      handleNetEvent(evt, peerId);
    });

    // Loadout announcements
    onLoadout((data, peerId) => {
      const peer = net.peers.get(peerId);
      if (peer) {
        peer.loadoutKey = data.loadoutKey;
        peer.team = data.team;
        // (v10) Capture peer's Discord identity if they sent it ; lets
        // the lobby chips show their avatar + display name instead of
        // generic "PEER" text. May be undefined if the peer isn't
        // signed in with Discord.
        if (data.discord_id) {
          peer.discord_id     = data.discord_id;
          peer.discord_name   = data.discord_name;
          peer.discord_avatar = data.discord_avatar;
        }
        // Create or update their NetworkPlayer
        updateNetworkPlayer(peerId, data);
        // (v6.7) A peer just committed in ship-select; if everyone now has a
        // loadout, this triggers the synced launchAt proposal.
        checkAllLoadoutsReady();
        // (v9b) Refresh the fleet strip so the peer's chip thumb appears.
        try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}
      }
    });

    // Projectile broadcasts
    onProjectile((data, peerId) => {
      spawnNetworkProjectile(data, peerId);
    });

    // Peer joins
    net.room.onPeerJoin(peerId => {
      console.log('Peer joined:', peerId);
      net.peers.set(peerId, {
        state: null,
        prevState: null,
        lastUpdate: 0,
        interpT: 0,
        loadoutKey: null,
        team: null,
        networkPlayer: null,
        ready: false,           // (v6.7) per-peer ready flag for the start handshake
      });
      updateLobbyPeers();
      checkAllReady();          // (v6.7) a new not-ready peer cancels any pending start
      checkAllLoadoutsReady();  // (v6.7) and a new peer in ship-select cancels pending launch
      try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}

      // If we already have a loadout, announce it. (v10) Bundle our
      // Discord identity into the same payload so the new peer can
      // render our avatar + handle in their lobby chips.
      if (player.loadoutKey && net.sendLoadout) {
        const _du = (typeof discordCurrentUser === 'function') ? discordCurrentUser() : null;
        net.sendLoadout({
          loadoutKey: player.loadoutKey,
          team: player.team,
          peerId: net.myPeerId,
          discord_id:     _du ? _du.id : undefined,
          discord_name:   _du ? (_du.global_name || _du.username) : undefined,
          discord_avatar: _du ? _du.avatar : undefined,
        });
      }

      // (v6.7) Re-announce our ready state so the joiner sees it immediately.
      if (net.myReady && net.sendEvent) {
        net.sendEvent({ type: 'ready', ready: true });
      }

      // (v6.7) If I'm the world owner and we have a built world, ship the
      // manifest to the new peer so they don't sit with empty / divergent
      // cluster placements until next round.
      if (game.clusters && game.clusters.length > 0) {
        broadcastWorldObjects();
      }
    });

    // Peer leaves
    net.room.onPeerLeave(peerId => {
      console.log('Peer left:', peerId);
      const peer = net.peers.get(peerId);
      if (peer && peer.networkPlayer) {
        peer.networkPlayer.destroy();
        const idx = net.networkPlayers.indexOf(peer.networkPlayer);
        if (idx >= 0) net.networkPlayers.splice(idx, 1);
        const eidx = game.entities.indexOf(peer.networkPlayer);
        if (eidx >= 0) game.entities.splice(eidx, 1);
      }
      net.peers.delete(peerId);
      // Drop their last game-sync snapshot too so the consensus average
      // doesn't include a frozen reading from a peer that just left.
      if (net.peerGameSync) net.peerGameSync.delete(peerId);
      updateLobbyPeers();
      checkAllReady();
      checkAllLoadoutsReady();
      try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}

      // (v6.7) Host-drop fallback. If the leaver was the world owner, the
      // sorted-peerId tie-break now elects me (or whoever is next-lowest).
      if (game.clusters && game.clusters.length > 0) {
        broadcastWorldObjects();
      }
    });

    document.getElementById('lobby-status').textContent = 'CONNECTED: ROOM ' + code + ' ; WAITING FOR PLAYERS...';
    document.getElementById('lobby-status').style.color = '#66cc66';
    updateLobbyPeers();

    // (v6.7) After connecting, the JOIN button becomes a READY toggle.
    setTimeout(() => {
      const btn = document.getElementById('btn-join');
      btn.disabled = false;
      btn.textContent = 'READY';
      btn.onclick = () => toggleReady();
    }, 500);

  } catch(err) {
    console.error('Network error:', err);
    document.getElementById('lobby-status').textContent = 'CONNECTION FAILED: ' + err.message;
    document.getElementById('lobby-status').style.color = '#ff6666';
    document.getElementById('btn-join').disabled = false;
    document.getElementById('btn-solo').disabled = false;
  }
}


// ----- next block -----

// ---- NETWORK BROADCAST ----

function broadcastPlayerState(dt) {
  if (!net.active || !net.sendState) return;

  net.broadcastAccum += dt;
  if (net.broadcastAccum < 1 / net.broadcastHz) return;
  net.broadcastAccum = 0;

  // Pack state tightly (short keys to reduce bandwidth)
  const state = {
    px: Math.round(player.position.x * 10) / 10,
    py: Math.round(player.position.y * 10) / 10,
    pz: Math.round(player.position.z * 10) / 10,
    vx: Math.round(player.velocity.x * 10) / 10,
    vy: Math.round(player.velocity.y * 10) / 10,
    vz: Math.round(player.velocity.z * 10) / 10,
    qx: Math.round(camera.quaternion.x * 1000) / 1000,
    qy: Math.round(camera.quaternion.y * 1000) / 1000,
    qz: Math.round(camera.quaternion.z * 1000) / 1000,
    qw: Math.round(camera.quaternion.w * 1000) / 1000,
    hp: player.health,
    shield: player.shield,
    doomed: player.doomed,
    dead: player.shipState === 'dead',
    // (v6.7) Per-player stats so the scoreboard isn't permanently 0 for
    // remote peers. Cheap (two ints, broadcast at 20 Hz with the rest).
    kills: player.kills | 0,
    damageDealt: player.damageDealt | 0,
    // (v6.7) Ability-shield state, OR'd into a single bit so NetworkPlayer
    // can light the wraparound shield mesh and chassis-specific visuals.
    // Covers Body Shield (HP-pool, charged on Charge Shot), Teleport
    // i-frames, and the three hold abilities (Absorption, Vortex Shield,
    // Fire Shield). NOTE: thermalShieldHP is NOT used here because it
    // initializes to max on commit (Pyro starts with a fully-charged
    // shield); using HP > 0 would make the shield broadcast permanently
    // on. The held-state check via abilityActive[1] is the correct gate.
    abilityShield: !!(
      (player.gunShieldHP > 0) ||
      player.phaseInvuln ||
      (player.abilityActive && player.abilityActive[1] && player.abilities && player.abilities[1] &&
        (player.abilities[1].name === 'Absorption' ||
         player.abilities[1].name === 'Vortex Shield' ||
         player.abilities[1].name === 'Fire Shield'))
    ),
    // (v6.7) Spawn-protection seconds remaining. Drives the wraparound
    // shield bubble on peers: bright at spawn, fades over LSS.SPAWN_PROTECTION
    // seconds (3s default), gone by the time you can be shot.
    spawnProt: Math.max(0, Math.round((player.spawnProtection || 0) * 10) / 10),
    // (perf 2026-05) Auto Cloak perk : a single bool that drives remote
    // NetworkPlayers to drop the cloaked peer's ship opacity to ~0.02.
    // (cloak 2026-05) Defensive gate : only broadcast cloak:true if the
    // current perk is actually cloak.
    cloak: !!(player.perkCloakActive
              && PILOT_PERKS[player.perkId]
              && PILOT_PERKS[player.perkId].cloakDuration),
  };

  const msg = JSON.stringify(state);
  net.bytesSent += msg.length;
  net.sendState(state);
}

// (v11d) Wall-clock-anchored game timers.
function _anchorTimer(name, durationSec) {
  game[name] = durationSec;
  game[name + 'AnchorMs'] = Date.now();
  game[name + 'Total']    = durationSec;
}
function _tickTimer(name) {
  const anchor = game[name + 'AnchorMs'];
  const total  = game[name + 'Total'];
  if (typeof anchor !== 'number' || typeof total !== 'number') return;
  const elapsed = (Date.now() - anchor) / 1000;
  game[name] = Math.max(0, total - elapsed);
}

// (3+ peer time/round sync) Consensus broadcast (owner-free).
function broadcastGameSync(dt) {
  if (!net.active || !net.sendEvent) return;
  net.gameSyncAccum += dt;
  if (net.gameSyncAccum < 1 / net.gameSyncHz) return;
  net.gameSyncAccum = 0;
  net.sendEvent({
    type: 'game_sync',
    s:  game.state,
    cr: game.currentRound | 0,
    sa: game.scoreA | 0,
    sb: game.scoreB | 0,
    rt: Math.round((game.roundTimer || 0) * 100) / 100,
    wt: Math.round((game.warmupTimer || 0) * 100) / 100,
    et: Math.round((game.roundEndTimer || 0) * 100) / 100,
    mt: Math.round((game.matchEndTimer || 0) * 100) / 100,
    gt: Math.round((game.time || 0) * 100) / 100,
  });
  applyGameSyncConsensus();
}

function applyGameSyncConsensus() {
  if (!net.active) return;
  const peerMap = net.peerGameSync;
  if (!peerMap || peerMap.size === 0) return;
  const now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const STALE = net.gameSyncStaleMs || 2000;
  let n = 1;
  let rtSum = (game.roundTimer    || 0);
  let wtSum = (game.warmupTimer   || 0);
  let etSum = (game.roundEndTimer || 0);
  let mtSum = (game.matchEndTimer || 0);
  let gtSum = (game.time          || 0);
  let crMax = (game.currentRound  | 0);
  let saMax = (game.scoreA        | 0);
  let sbMax = (game.scoreB        | 0);
  for (const [pid, snap] of peerMap) {
    if (!snap) continue;
    if ((now - (snap.lastUpdate || 0)) > STALE) continue;
    n++;
    rtSum += (snap.rt || 0);
    wtSum += (snap.wt || 0);
    etSum += (snap.et || 0);
    mtSum += (snap.mt || 0);
    gtSum += (snap.gt || 0);
    if ((snap.cr | 0) > crMax) crMax = (snap.cr | 0);
    if ((snap.sa | 0) > saMax) saMax = (snap.sa | 0);
    if ((snap.sb | 0) > sbMax) sbMax = (snap.sb | 0);
  }
  if (n < 2) return;
  game.roundTimer    = rtSum / n;
  game.warmupTimer   = wtSum / n;
  game.roundEndTimer = etSum / n;
  game.matchEndTimer = mtSum / n;
  game.time          = gtSum / n;
  game.currentRound  = crMax;
  game.scoreA        = saMax;
  game.scoreB        = sbMax;
  // (v11d) Re-anchor the wall-clock totals so the next _tickTimer call
  // picks up where consensus left us.
  const _nowMs = Date.now();
  if (typeof game.roundTimerAnchorMs === 'number') {
    game.roundTimerAnchorMs = _nowMs; game.roundTimerTotal = game.roundTimer;
  }
  if (typeof game.warmupTimerAnchorMs === 'number') {
    game.warmupTimerAnchorMs = _nowMs; game.warmupTimerTotal = game.warmupTimer;
  }
  if (typeof game.roundEndTimerAnchorMs === 'number') {
    game.roundEndTimerAnchorMs = _nowMs; game.roundEndTimerTotal = game.roundEndTimer;
  }
  if (typeof game.matchEndTimerAnchorMs === 'number') {
    game.matchEndTimerAnchorMs = _nowMs; game.matchEndTimerTotal = game.matchEndTimer;
  }
}


// ----- next block -----

// ---- NETWORK PLAYER CLASS ----
// Mirrors Bot interface; driven by peer state updates instead of AI

class NetworkPlayer {
  constructor(peerId, loadoutKey, team) {
    const loadout = LOADOUTS[loadoutKey];
    if (!loadout) return;
    const chassisData = CHASSIS[loadout.chassis];

    this.peerId = peerId;
    this.id = 'net_' + peerId;
    this.loadoutKey = loadoutKey;
    this.loadout = loadout;
    this.chassis = chassisData;
    this.team = team;
    this.health = chassisData.maxHealth;
    this.maxHealth = chassisData.maxHealth;
    this.shield = chassisData.maxShield;
    this.maxShield = chassisData.maxShield;
    this.alive = true;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.targetDir = new THREE.Vector3(0, 0, -1);
    this.fireTimer = 0;
    this.shieldRegenDelay = 0;
    this.spawnProtection = 0;
    this.doomed = false;
    this.doomTimer = 0;
    this.coreMeter = 0;
    this.arcSlowTimer = 0;
    this.kills = 0;
    this.damageDealt = 0;
    // (perf 2026-05) Auto Cloak perk : tracks the broadcast cloak flag so
    // update() only walks the mesh tree on a transition.
    this._cloaked = false;

    const teamColor = team === LSS.TEAM_FLEET_A ? 0xff4444 : 0x44bb44;
    this.mesh = createShipMesh(chassisData, teamColor, loadoutKey);
    this.mesh.position.copy(this.position);
    this.mesh.userData.bot = this; // reuse existing hit detection that checks .bot
    scene.add(this.mesh);
    swapToModelMeshWhenReady(this, teamColor);

    // Interpolation state
    this.interpPos = new THREE.Vector3();
    this.interpQuat = new THREE.Quaternion();
    this.targetPos = new THREE.Vector3();
    this.targetQuat = new THREE.Quaternion();
  }

  update(dt) {
    // Get latest peer data first; we need to read it even when locally
    // dead so we can detect the next-round respawn (dead -> alive).
    const peer = net.peers.get(this.peerId);
    if (!peer || !peer.state) return;

    const s = peer.state;

    // (v6.7) Revival: locally dead but the peer's broadcast now shows them
    // alive again (next-round respawn). Restore the mesh, reset health,
    // re-snap to the broadcast position so we don't tween through the wreck.
    if (!this.alive && s.dead !== true && (typeof s.hp !== 'number' || s.hp > 0)) {
      this.alive = true;
      this.health = (this.chassis && this.chassis.maxHealth) || 100;
      this.shield = 0;
      if (this.mesh && !this.mesh.parent && typeof scene !== 'undefined') scene.add(this.mesh);
      if (typeof s.px === 'number') this.position.set(s.px, s.py, s.pz);
    }

    if (!this.alive) return;

    // (v6.7) React to the broadcast death flag.
    if (s.dead === true || (typeof s.hp === 'number' && s.hp <= 0)) {
      this.die(null);
      return;
    }

    // Update health/shield from network
    this.health = s.hp || this.health;
    this.shield = s.shield || 0;
    this.doomed = s.doomed || false;
    // (v6.7) Mirror per-player stats so scoreboard rows for remote peers
    // show real kill / damage numbers instead of zeros.
    if (typeof s.kills === 'number') this.kills = s.kills;
    if (typeof s.damageDealt === 'number') this.damageDealt = s.damageDealt;

    // Smooth interpolation toward target position/rotation
    this.targetPos.set(s.px || 0, s.py || 0, s.pz || 0);
    if (s.qx !== undefined) {
      this.targetQuat.set(s.qx, s.qy, s.qz, s.qw);
    }

    // Interpolation (lerp toward target; snaps if too far)
    const dist = this.position.distanceTo(this.targetPos);
    if (dist > 500) {
      // Teleport if way out of sync
      this.position.copy(this.targetPos);
    } else {
      this.position.lerp(this.targetPos, Math.min(1, dt * 15));
    }
    this.mesh.position.copy(this.position);

    // Quaternion slerp
    this.mesh.quaternion.slerp(this.targetQuat, Math.min(1, dt * 15));

    // Velocity (for projectile inheritance, damage calcs)
    this.velocity.set(s.vx || 0, s.vy || 0, s.vz || 0);

    // Shield visual. (v9a, second pass) Only spawn protection lights the
    // generic blue wraparound now.
    if (this.mesh.userData.shieldMesh) {
      let opacity = 0;
      if (s.spawnProt > 0) {
        const frac = Math.min(1, s.spawnProt / 3);
        opacity = Math.max(opacity, 1.0 * frac);
      }
      setShieldIntensity(this.mesh, opacity);
    }

    // (perf 2026-05) Auto Cloak perk : drop the peer's ship opacity to
    // 1 % while they're in their cloak window, restore on exit.
    const wantCloak = !!s.cloak;
    if (wantCloak !== this._cloaked) {
      this._cloaked = wantCloak;
      const cloakOp = (PILOT_PERKS && PILOT_PERKS.cloak && typeof PILOT_PERKS.cloak.cloakOpacity === 'number')
        ? PILOT_PERKS.cloak.cloakOpacity : 0.01;
      _setShipMeshOpacity(this.mesh, wantCloak ? cloakOp : 1.0);
    }
    // (v6.7) Chassis-specific ability-shield visuals on the network player.
    this._updateAbilityShieldVisual(s, dt);
  }

  _updateAbilityShieldVisual(s, dt) {
    const active = !!(s && s.abilityShield);
    // Helper: get our broadcast forward vector without per-frame allocations.
    let getForward = null;
    if (active && !this._shieldForward) {
      this._shieldForward = new THREE.Vector3(0, 0, -1);
      this._shieldPos = new THREE.Vector3();
      this._shieldLook = new THREE.Vector3();
    }
    if (active) {
      getForward = () => this._shieldForward.set(0, 0, -1).applyQuaternion(this.targetQuat);
    }
    const t = (typeof game !== 'undefined' && game.time) ? game.time : 0;

    // ---- BLASTER: Body Shield (peer view : cyan plasma hull-hug) ----
    // (v14f) Hull-hugging clone of this peer's ship mesh, parented under
    // this.mesh so the shield rides the actual silhouette of their hull.
    if (this.loadoutKey === 'BLASTER' && active) {
      if (!this._gunShieldMesh && this.mesh && typeof _makeHullHugShield === 'function') {
        const m = _makeHullHugShield(this, 'plasma_cyan');
        if (m) {
          this._gunShieldMesh = m;
          this.mesh.add(m);
        }
      }
      if (this._gunShieldMesh && this._gunShieldMesh.userData && this._gunShieldMesh.userData._shieldMat) {
        const u = this._gunShieldMesh.userData._shieldMat.uniforms;
        if (u && u.time) u.time.value = t;
        if (u && u.uTime) u.uTime.value = t;
      }
      if (typeof _setShipShieldEmissive === 'function') {
        _setShipShieldEmissive(this.mesh, 0x33ccff, 1.1);
      }
    } else {
      if (this._gunShieldMesh) {
        if (typeof _clearShipShieldEmissive === 'function') _clearShipShieldEmissive(this.mesh);
        if (typeof _disposeShieldClone === 'function') _disposeShieldClone(this._gunShieldMesh);
        this._gunShieldMesh = null;
      }
      // Legacy mesh cleanup (older saved sessions / older fork data).
      if (this._gunShieldBack) {
        if (this._gunShieldBack.parent) scene.remove(this._gunShieldBack);
        if (this._gunShieldBack.geometry) this._gunShieldBack.geometry.dispose();
        if (this._gunShieldBack.material) this._gunShieldBack.material.dispose();
        this._gunShieldBack = null;
      }
      if (this._gunShieldEdge) {
        if (this._gunShieldEdge.parent) scene.remove(this._gunShieldEdge);
        if (this._gunShieldEdge.geometry) this._gunShieldEdge.geometry.dispose();
        if (this._gunShieldEdge.material) this._gunShieldEdge.material.dispose();
        this._gunShieldEdge = null;
      }
    }

    // ---- PYRO: Fire Shield (peer view : red plasma hull-hug) ----
    if (this.loadoutKey === 'PYRO' && active) {
      if (!this._thermalShieldMesh && this.mesh && typeof _makeHullHugShield === 'function') {
        const m = _makeHullHugShield(this, 'plasma_red');
        if (m) { this._thermalShieldMesh = m; this.mesh.add(m); }
      }
      if (this._thermalShieldMesh && this._thermalShieldMesh.userData && this._thermalShieldMesh.userData._shieldMat) {
        const u = this._thermalShieldMesh.userData._shieldMat.uniforms;
        if (u && u.time) u.time.value = t;
        if (u && u.uTime) u.uTime.value = t;
      }
      if (typeof _setShipShieldEmissive === 'function') {
        _setShipShieldEmissive(this.mesh, 0xff3322, 1.1);
      }
      // (v14f) Red fire particles around the peer's hull while shield is up.
      if (typeof _spawnThermalShieldFire === 'function') {
        _spawnThermalShieldFire(this.position, this.mesh && this.mesh.quaternion, this.chassis, (typeof dt === 'number' ? dt : 1/60));
      }
    } else {
      if (this._thermalShieldMesh) {
        if (typeof _clearShipShieldEmissive === 'function') _clearShipShieldEmissive(this.mesh);
        if (typeof _disposeShieldClone === 'function') _disposeShieldClone(this._thermalShieldMesh);
        this._thermalShieldMesh = null;
      }
      if (this._thermalShieldRing) {
        if (this._thermalShieldRing.parent) scene.remove(this._thermalShieldRing);
        if (this._thermalShieldRing.geometry) this._thermalShieldRing.geometry.dispose();
        if (this._thermalShieldRing.material) this._thermalShieldRing.material.dispose();
        this._thermalShieldRing = null;
      }
    }

    // ---- VORTEX: Vortex Shield (peer view : purple plasma hull-hug) ----
    if (this.loadoutKey === 'VORTEX' && active) {
      if (!this._vortexShieldMesh && this.mesh && typeof _makeHullHugShield === 'function') {
        const m = _makeHullHugShield(this, 'plasma_purple');
        if (m) { this._vortexShieldMesh = m; this.mesh.add(m); }
      }
      if (this._vortexShieldMesh && this._vortexShieldMesh.userData && this._vortexShieldMesh.userData._shieldMat) {
        const u = this._vortexShieldMesh.userData._shieldMat.uniforms;
        if (u && u.time) u.time.value = t;
        if (u && u.uTime) u.uTime.value = t;
        if (u && u.uHp)   u.uHp.value   = 1.0;
      }
      if (typeof _setShipShieldEmissive === 'function') {
        _setShipShieldEmissive(this.mesh, 0xaa55ff, 1.1);
      }
    } else {
      if (this._vortexShieldMesh) {
        if (typeof _clearShipShieldEmissive === 'function') _clearShipShieldEmissive(this.mesh);
        if (typeof _disposeShieldClone === 'function') _disposeShieldClone(this._vortexShieldMesh);
        this._vortexShieldMesh = null;
      }
      if (this._vortexShieldRing) {
        if (this._vortexShieldRing.parent) scene.remove(this._vortexShieldRing);
        if (this._vortexShieldRing.geometry) this._vortexShieldRing.geometry.dispose();
        if (this._vortexShieldRing.material) this._vortexShieldRing.material.dispose();
        this._vortexShieldRing = null;
      }
    }

    // ---- SLAYER: Absorption aura (peer view : green plasma hull-hug) ----
    if (this.loadoutKey === 'SLAYER' && active) {
      if (!this._swordBlockMesh && this.mesh && typeof _makeHullHugShield === 'function') {
        const m = _makeHullHugShield(this, 'plasma_green');
        if (m) { this._swordBlockMesh = m; this.mesh.add(m); }
      }
      if (this._swordBlockMesh && this._swordBlockMesh.userData && this._swordBlockMesh.userData._shieldMat) {
        const u = this._swordBlockMesh.userData._shieldMat.uniforms;
        if (u && u.time)  u.time.value  = t;
        if (u && u.uTime) u.uTime.value = t;
        if (u && u.uIntensity) u.uIntensity.value = 1.2;
      }
      if (typeof _setShipShieldEmissive === 'function') {
        _setShipShieldEmissive(this.mesh, 0x33ff66, 1.1);
      }
    } else {
      if (this._swordBlockMesh) {
        if (typeof _clearShipShieldEmissive === 'function') _clearShipShieldEmissive(this.mesh);
        if (typeof _disposeShieldClone === 'function') _disposeShieldClone(this._swordBlockMesh);
        this._swordBlockMesh = null;
      }
      if (this._swordBlockRing) {
        if (this._swordBlockRing.parent) scene.remove(this._swordBlockRing);
        if (this._swordBlockRing.geometry) this._swordBlockRing.geometry.dispose();
        if (this._swordBlockRing.material) this._swordBlockRing.material.dispose();
        this._swordBlockRing = null;
      }
    }
  }

  takeDamage(amount, attacker, hitPoint) {
    // For network players, damage is handled via consensus.
    // Local hit detection creates a claim; actual HP change comes from network state.
    // (v6.7) Wire this up. Every damage path in the engine eventually calls
    // takeDamage on the entity that got hit. For a NetworkPlayer that means
    // we have to tell the actual peer "you took N damage from me." Their
    // handleHitClaim applies it to their local player and the next state
    // broadcast confirms the new HP back to us.
    if (amount > 0 && net.active && net.sendHitClaim && this.peerId) {
      const hitId = ++net.hitIdCounter;
      net.sendHitClaim({
        hitId,
        shooterId: net.myPeerId,
        targetId: this.peerId,
        damage: amount,
        sx: player.position.x,
        sy: player.position.y,
        sz: player.position.z,
      });
    }
    // (v14g) Local shield ripple visual : peer A's projectile just
    // touched peer B's mesh, so peer A should immediately see a ripple.
    if (this.mesh && this.mesh.userData && this.mesh.userData.shieldMesh && this.shield > 0) {
      const ripPoint = hitPoint || this.position;
      const ripColor = _shipShieldColor(this.loadoutKey);
      spawnShieldHit(ripPoint, this.chassis.hullLength * 0.8, ripColor, this.mesh);
    }
    return amount;
  }

  die(attacker) {
    this.alive = false;
    this.health = 0;
    if (this.mesh && this.mesh.parent) scene.remove(this.mesh);
    spawnExplosion(this.position, this.chassis.hullLength);
  }

  destroy() {
    if (this.mesh && this.mesh.parent) scene.remove(this.mesh);
    // (v6.7) Clean up any chassis-specific shield meshes attached to this
    // network player. Without this, they'd leak in the scene when the peer
    // leaves or swaps loadouts.
    const dispose = (m) => {
      if (!m) return;
      if (m.parent) scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    };
    dispose(this._vortexShieldMesh);  this._vortexShieldMesh = null;
    dispose(this._vortexShieldRing);  this._vortexShieldRing = null;
    dispose(this._gunShieldMesh);     this._gunShieldMesh = null;
    dispose(this._gunShieldBack);     this._gunShieldBack = null;
    dispose(this._gunShieldEdge);     this._gunShieldEdge = null;
    dispose(this._thermalShieldMesh); this._thermalShieldMesh = null;
    dispose(this._thermalShieldRing); this._thermalShieldRing = null;
    // (v11b) Slayer Absorption dome / ring ; same dispose pattern.
    dispose(this._swordBlockMesh);    this._swordBlockMesh = null;
    dispose(this._swordBlockRing);    this._swordBlockRing = null;
  }
}

function updateNetworkPlayer(peerId, data) {
  const peer = net.peers.get(peerId);
  if (!peer) return;

  // Remove old NetworkPlayer if loadout changed
  if (peer.networkPlayer) {
    peer.networkPlayer.destroy();
    const idx = net.networkPlayers.indexOf(peer.networkPlayer);
    if (idx >= 0) net.networkPlayers.splice(idx, 1);
    const eidx = game.entities.indexOf(peer.networkPlayer);
    if (eidx >= 0) game.entities.splice(eidx, 1);
  }

  // Create new NetworkPlayer
  const np = new NetworkPlayer(peerId, data.loadoutKey, data.team || LSS.TEAM_FLEET_B);
  peer.networkPlayer = np;
  net.networkPlayers.push(np);
  game.entities.push(np);
}


// ----- next block -----

// ---- HIT CONSENSUS ----
// Shooter claims a hit. Nearest peers validate against their spatial data.
// Majority confirms. If only 2 players, victim authority (victim confirms).

function claimHit(targetPeerId, damage, weaponName) {
  if (!net.active || !net.sendHitClaim) return;

  const hitId = net.myPeerId + '_' + (net.hitIdCounter++);
  const claim = {
    hitId,
    shooterId: net.myPeerId,
    targetId: targetPeerId,
    damage,
    weapon: weaponName,
    // Include shooter position for validation
    sx: player.position.x,
    sy: player.position.y,
    sz: player.position.z,
  };

  // Track locally
  net.pendingHits.set(hitId, {
    ...claim,
    votes: new Map(),
    timestamp: performance.now(),
  });

  // Self-vote (shooter votes yes)
  net.pendingHits.get(hitId).votes.set(net.myPeerId, true);

  net.sendHitClaim(claim);
}

function handleHitClaim(claim, fromPeerId) {
  // Validate: was the target plausibly in the shooter's line of fire?
  // Check using our local spatial data (the broadcast tier gives us everyone's position)
  const shooter = net.peers.get(claim.shooterId);
  const target = net.peers.get(claim.targetId);

  // If the target is us, we have the most accurate data
  let valid = true;
  if (claim.targetId === net.myPeerId) {
    // Am I near where the shooter claims? (generous tolerance: 200 units)
    const dist = Math.sqrt(
      (player.position.x - claim.sx) ** 2 +
      (player.position.y - claim.sy) ** 2 +
      (player.position.z - claim.sz) ** 2
    );
    // If shooter was within weapon range, plausible
    valid = dist < 4000;
  } else if (shooter && shooter.state && target && target.state) {
    // Third-party validation: check if target was near shooter based on our data
    const dx = (shooter.state.px || 0) - (target.state.px || 0);
    const dy = (shooter.state.py || 0) - (target.state.py || 0);
    const dz = (shooter.state.pz || 0) - (target.state.pz || 0);
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    valid = dist < 4000;
  }

  // Send vote
  if (net.sendHitVote) {
    net.sendHitVote({
      hitId: claim.hitId,
      valid,
      voterId: net.myPeerId,
    });
  }

  // If we are the target and the hit is valid, apply damage locally
  // (gives responsive feel; consensus can override if vote fails)
  if (claim.targetId === net.myPeerId && valid) {
    // (v6.7) Synthesize a positioned attacker from the shooter coords carried
    // in the claim. Without this, playerTakeDamage gets attacker=null and:
    //   - directional damage indicator can't pick an edge to pulse
    //   - Plasma Shield's "is the shooter on the wall's front side?" check
    //     short-circuits
    // (kills 2026-05) Also include peerId and loadout on the fake attacker
    // so that if THIS hit kills us, playerDie's broadcast of the 'kill'
    // event has a real killerPeerId / killerName.
    const shooterPeer = net.peers.get(claim.shooterId);
    const shooterLoadout = (shooterPeer && shooterPeer.loadoutKey)
      ? LOADOUTS[shooterPeer.loadoutKey] : null;
    const fakeAttacker = (typeof claim.sx === 'number')
      ? {
          position: new THREE.Vector3(claim.sx, claim.sy, claim.sz),
          peerId: claim.shooterId,
          loadout: shooterLoadout,
        }
      : null;
    playerTakeDamage(claim.damage, fakeAttacker);
  }
}

function handleHitVote(vote, fromPeerId) {
  const hit = net.pendingHits.get(vote.hitId);
  if (!hit) return;
  hit.votes.set(vote.voterId, vote.valid);

  // Check consensus (majority of peers who voted)
  const totalPeers = net.peers.size + 1; // +1 for self
  const votesNeeded = Math.ceil(totalPeers / 2);
  let yesVotes = 0, noVotes = 0;
  for (const v of hit.votes.values()) {
    if (v) yesVotes++; else noVotes++;
  }

  if (yesVotes >= votesNeeded) {
    // Hit confirmed by consensus
    net.pendingHits.delete(vote.hitId);
  } else if (noVotes >= votesNeeded) {
    // Hit rejected; if we already applied damage, we'd need to reverse
    // (for now, accept some imprecision; damage was already applied on victim side)
    net.pendingHits.delete(vote.hitId);
  }
}


// ----- next block -----

function handleNetEvent(evt, fromPeerId) {
  if (evt.type === 'kill') {
    addKillFeed(evt.killerName || 'Peer', evt.victimName || 'Peer');
    // (kills 2026-05) Credit the killer's kill counter.
    if (evt.killerPeerId && evt.killerPeerId === net.myPeerId) {
      player.kills = (player.kills | 0) + 1;
      player.coreMeter = Math.min(100, (player.coreMeter || 0) + 15);
      try { if (typeof showKillMarker === 'function') showKillMarker(); } catch (_) {}
      try {
        if (typeof triggerHitFeedback === 'function') {
          const _now = (typeof game !== 'undefined') ? game.time : 0;
          const isMK = player._lastKillTime != null && (_now - player._lastKillTime) <= 4.0;
          triggerHitFeedback({ weight: isMK ? 'multikill' : 'kill' });
          player._lastKillTime = _now;
        }
      } catch (_) {}
      try { if (typeof musicOnKill === 'function') musicOnKill('player'); } catch (_) {}
    }
    if (typeof triggerScreenShake === 'function') triggerScreenShake(6);
    return;
  }
  // (v10 fix) Authoritative round-end resolution from the stasis owner.
  if (evt.type === 'round_end') {
    if (game.state === 'playing') {
      game.scoreA      = Math.max(game.scoreA | 0, (evt.scoreA | 0));
      game.scoreB      = Math.max(game.scoreB | 0, (evt.scoreB | 0));
      game.state       = 'roundEnd';
      // (v11d) Anchor to wall-clock for the broadcast-driven roundEnd path
      _anchorTimer('roundEndTimer', 5);
      if (window.Overlays) {
        const playerWonRound = (player && evt.winnerTeam === player.team);
        const title = playerWonRound ? 'Round Won!' : 'Round Lost';
        Overlays.banner(title, evt.winnerLabel || '');
      }
      try {
        if (typeof ANN !== 'undefined') {
          if (player && evt.winnerTeam === player.team) ANN.roundWon();
          else ANN.roundLost();
        }
      } catch (_) {}
    }
    return;
  }
  // (v6.7) Lobby ready toggle from a peer.
  if (evt.type === 'ready') {
    const peer = net.peers.get(fromPeerId);
    if (peer) {
      peer.ready = !!evt.ready;
      updateLobbyPeers();
      checkAllReady();
      try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}
    }
    return;
  }
  // (v6.7) Match-start proposal from the lowest-peerId peer.
  if (evt.type === 'match_start' && typeof evt.startAt === 'number') {
    const allIds = [net.myPeerId, ...net.peers.keys()].sort();
    const expectedProposer = allIds[0];
    if (fromPeerId === expectedProposer && net.myReady) {
      if (evt.mapKey && typeof evt.seed === 'number') {
        applyWorldSync(evt.mapKey, evt.seed);
      }
      scheduleMatchStart(evt.startAt);
    }
    return;
  }
  // (v6.7) Synced ship-select launch from the lowest-peerId proposer.
  // (launch-sync 2026-05) Use absolute-clock scheduling.
  if (evt.type === 'launch_at' && typeof evt.launchAt === 'number') {
    const allIds = [net.myPeerId, ...net.peers.keys()].sort();
    const expectedProposer = allIds[0];
    if (fromPeerId === expectedProposer && player.loadoutKey) {
      if (net.lastLaunchId === evt.launchAt) return; // duplicate retry
      net.lastLaunchId = evt.launchAt;
      scheduleLaunch(evt.launchAt);
    }
    return;
  }
  // (v6.7) A peer destroyed a cluster obstacle; mirror it locally.
  if (evt.type === 'obj_destroy' && typeof evt.objId === 'number') {
    const cluster = game.clusters && game.clusters[evt.objId];
    if (cluster && !cluster.broken) {
      const hitPos = (typeof evt.hx === 'number')
        ? new THREE.Vector3(evt.hx, evt.hy, evt.hz) : null;
      const hitDir = (typeof evt.dx === 'number' && (evt.dx || evt.dy || evt.dz))
        ? new THREE.Vector3(evt.dx, evt.dy, evt.dz) : null;
      cluster.breakApart(hitPos, hitDir);
    }
    return;
  }
  // (v12m patch5) Tile-pivot Y sync.
  if (evt.type === 'gmaps_pivot_y' && typeof evt.y === 'number') {
    try {
      if (_lssGmaps && _lssGmaps.tiles && _lssGmaps.tiles.group) {
        _lssGmaps.tiles.group.position.y = evt.y;
      }
    } catch (e) { console.warn('[v12m] pivot_y apply failed:', e); }
    return;
  }
  // (v12m patch2) Energy Syphon conduit visual replay.
  // (v17) Royal-blue palette to match the local shooter side.
  if (evt.type === 'siphon_beam') {
    const a = new THREE.Vector3(evt.ax, evt.ay, evt.az);
    const b = new THREE.Vector3(evt.bx, evt.by, evt.bz);
    if (typeof spawnLightningBolt === 'function') {
      try {
        spawnLightningBolt(a, b, 0x4169E1, 0.32, 8, 9.0);
        spawnLightningBolt(a, b, 0x6080ff, 0.28, 6, 7.0);
      } catch (e) { console.warn('[v12m] siphon_beam replay failed:', e); }
    }
    return;
  }
  // (v6.7) Pre-match map sync.
  if (evt.type === 'map_change' && typeof evt.mapKey === 'string') {
    // (v12m patch4) Update overlay state BEFORE calling selectMap.
    if (evt.gmapsOverlay && typeof evt.gmapsOverlay.lat === 'number' && typeof evt.gmapsOverlay.lng === 'number') {
      const ov = evt.gmapsOverlay;
      game.pendingGmapsOverlay = { lat: ov.lat, lng: ov.lng, name: ov.name || ('lat ' + ov.lat + ',' + ov.lng) };
      game.mapPreset = '';
      if (typeof _updateSkyUI === 'function') { try { _updateSkyUI(); } catch (_) {} }
      try {
        const stat = document.getElementById('gmaps-loc-status');
        if (stat) {
          stat.textContent = 'Set by peer : ' + (ov.name || ('lat ' + ov.lat + ',' + ov.lng)) + ' (you can change it)';
          stat.classList.remove('err'); stat.classList.add('ok');
        }
        const inp = document.getElementById('gmaps-loc-input');
        if (inp) { inp.value = ov.name || ''; inp.disabled = false; }
      } catch(_) {}
    } else if ('gmapsOverlay' in evt && evt.gmapsOverlay === null) {
      game.pendingGmapsOverlay = null;
      if (typeof _updateSkyUI === 'function') { try { _updateSkyUI(); } catch (_) {} }
      try {
        const stat = document.getElementById('gmaps-loc-status');
        if (stat) { stat.textContent = 'Overlay cleared by peer.'; stat.classList.remove('err','ok'); }
        const inp = document.getElementById('gmaps-loc-input');
        if (inp) { inp.disabled = false; }
      } catch(_) {}
    }
    if (typeof selectMap === 'function') selectMap(evt.mapKey);
    if (typeof evt.mode === 'string' && (evt.mode === 'classic' || evt.mode === 'race')) {
      LSS.MODE = evt.mode;
      try {
        const btn = document.getElementById('race-mode-toggle');
        if (btn) {
          const on = (LSS.MODE === 'race');
          btn.dataset.on = on ? '1' : '0';
          btn.textContent = on ? 'RACE MODE: ON' : 'RACE MODE: OFF';
          btn.classList.toggle('active', on);
        }
      } catch (_) {}
    }
    return;
  }
  // (v6.7) Stasis owner spawned a field.
  if (evt.type === 'stasis_spawn' && typeof evt.fieldId === 'number') {
    const exists = game.stasisFields.some(f => f.netId === evt.fieldId);
    if (!exists) {
      const pos = new THREE.Vector3(evt.x, evt.y, evt.z);
      const field = new StasisField(pos, !!evt.champion);
      field.netId = evt.fieldId;
      game.stasisFields.push(field);
      if (evt.champion) {
        game.championField = field;
        game.championSpawned = true;
        try {
          if (window.Overlays) Overlays.banner('CHAMPION OBJECTIVE', 'Charge in the field to win the round');
          if (typeof spawnDynamicLight === 'function') spawnDynamicLight(pos, 0xaa55ff, 6.0, 1500, 0.8);
        } catch (_) {}
      }
      if (evt.fieldId > net.stasisIdCounter) net.stasisIdCounter = evt.fieldId;
    }
    return;
  }
  // (v6.7) Someone else picked up a stasis field; remove it from our world.
  if (evt.type === 'stasis_pickup' && typeof evt.fieldId === 'number') {
    for (let i = game.stasisFields.length - 1; i >= 0; i--) {
      const f = game.stasisFields[i];
      if (f.netId === evt.fieldId && f.alive) {
        f.destroy();
        break;
      }
    }
    return;
  }
  // (v6.7) Authoritative cluster manifest from the world owner.
  if (evt.type === 'world_objects' && Array.isArray(evt.clusters)) {
    applyWorldObjectsManifest(evt.clusters);
    return;
  }
  // (3+ peer time/round sync) Consensus snapshot from a peer.
  if (evt.type === 'game_sync') {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    net.peerGameSync.set(fromPeerId, {
      rt: typeof evt.rt === 'number' ? evt.rt : 0,
      wt: typeof evt.wt === 'number' ? evt.wt : 0,
      et: typeof evt.et === 'number' ? evt.et : 0,
      mt: typeof evt.mt === 'number' ? evt.mt : 0,
      cr: typeof evt.cr === 'number' ? evt.cr : 0,
      sa: typeof evt.sa === 'number' ? evt.sa : 0,
      sb: typeof evt.sb === 'number' ? evt.sb : 0,
      gt: typeof evt.gt === 'number' ? evt.gt : 0,
      s:  typeof evt.s  === 'string' ? evt.s  : null,
      lastUpdate: now,
    });
    return;
  }
  // (v6.7) Hitscan / spread tracer from a peer's shot.
  if (evt.type === 'fire_tracer' && typeof evt.ox === 'number') {
    const from = new THREE.Vector3(evt.ox, evt.oy, evt.oz);
    const to   = new THREE.Vector3(evt.ex, evt.ey, evt.ez);
    const peerForWidth = net.peers.get(fromPeerId);
    const peerLoadout  = peerForWidth && peerForWidth.loadoutKey ? LOADOUTS[peerForWidth.loadoutKey] : null;
    const peerFireRate = peerLoadout && peerLoadout.weapon ? peerLoadout.weapon.fireRate : 0.5;
    const peerWScale   = (peerFireRate <= 0.10) ? 0.55 : 1.0;
    // (v11d) Dispatch Puncture peer shots through the railgun spiral spawner.
    const _shooterLoadout = (typeof evt.lo === 'string' && evt.lo)
      ? evt.lo
      : (peerForWidth && peerForWidth.loadoutKey);
    if (_shooterLoadout === 'PUNCTURE') {
      _spawnRailgunSpiral(from, to, evt.color || 0xeeff66);
    } else {
      spawnTracer(from, to, evt.color || 0xffff44, peerWScale);
    }
    // (v6.7) Chassis-specific muzzle flash for peers viewing this shot.
    const peer = net.peers.get(fromPeerId);
    if (peer && peer.loadoutKey && typeof emitChassisMuzzleFlash === 'function') {
      const dir = new THREE.Vector3().subVectors(to, from);
      if (dir.lengthSq() > 0.0001) {
        dir.normalize();
        emitChassisMuzzleFlash(peer.loadoutKey, from, dir);
      }
    }
    return;
  }
  // (v6.7) Shotgun pellet burst from a peer's spread weapon.
  if (evt.type === 'pellet_burst' && typeof evt.ox === 'number') {
    const origin = new THREE.Vector3(evt.ox, evt.oy, evt.oz);
    const dir = new THREE.Vector3(evt.dx, evt.dy, evt.dz);
    spawnPelletBurst(origin, dir, evt.range || 600);
    return;
  }
  // (v6.7) Branching lightning bolt from a peer.
  if (evt.type === 'lightning' && typeof evt.ox === 'number') {
    const from = new THREE.Vector3(evt.ox, evt.oy, evt.oz);
    const to   = new THREE.Vector3(evt.ex, evt.ey, evt.ez);
    if (typeof spawnLightningBolt === 'function') {
      spawnLightningBolt(from, to, evt.color || 0x44ff88, evt.lifetime || 0.25, evt.branches || 4, evt.thickness || 2.5);
    }
    return;
  }
  // (v6.7) Peer triggered a dash.
  if (evt.type === 'dash_burst' && typeof evt.dx === 'number') {
    const peer = net.peers.get(fromPeerId);
    const np = peer && peer.networkPlayer;
    if (np && np.mesh) {
      const dir = new THREE.Vector3(evt.dx, evt.dy, evt.dz);
      spawnDashBoosters(np.mesh, dir, evt.color || 0xaaeeff);
    }
    return;
  }
  // (v6.7) Persistent world effect spawned by a peer.
  if (evt.type === 'effect_spawn' && typeof evt.netId === 'number') {
    if (evt.kind === 'tripwire') {
      const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
      spawnTripWireOrb(pos, 'peer', evt.team, evt.ownerPeerId, evt.netId, false, evt.groupId);
    } else if (evt.kind === 'particle_wall') {
      const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
      const dir = new THREE.Vector3(evt.dx, evt.dy, evt.dz);
      spawnParticleWall(pos, dir, 'peer', evt.team, evt.ownerPeerId, evt.netId, false);
    } else if (evt.kind === 'incendiary_gas') {
      const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
      spawnIncendiaryGas(pos, 'peer', evt.team, evt.ownerPeerId, evt.netId, false);
    } else if (evt.kind === 'tether') {
      const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
      spawnTetherTrap(pos, 'peer', evt.team, evt.ownerPeerId, evt.netId, false);
    } else if (evt.kind === 'firewall') {
      const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
      const dir = new THREE.Vector3(evt.dx, evt.dy, evt.dz);
      spawnFlameChainVisual(pos, dir, evt.length || 800, evt.team, evt.ownerPeerId, evt.netId);
    }
    return;
  }
  // SLAYER Mega Stun Bolt storm activation from a peer.
  if (evt.type === 'slayer_core_storm' && typeof evt.px === 'number') {
    const pos = new THREE.Vector3(evt.px, evt.py, evt.pz);
    if (typeof _spawnSlayerCoreStormFX === 'function') {
      _spawnSlayerCoreStormFX(pos, evt.ownerPeerId || fromPeerId);
    }
    return;
  }
  if (evt.type === 'effect_destroy' && typeof evt.netId === 'number') {
    for (let i = game.worldEffects.length - 1; i >= 0; i--) {
      const eff = game.worldEffects[i];
      if (eff.netId === evt.netId) {
        eff.timer = 0;
        break;
      }
    }
    return;
  }
}


// ----- next block -----

// ---- READY / START HANDSHAKE (v6.7) ----
// Per docs/LSS/mesh_networking_concept.md: the match starts when every peer
// flips ready=true. There is no "host"; the lowest peerId proposes a synced
// startAt timestamp, and every peer (including the proposer) follows it.

function toggleReady() {
  if (!net.active) return;
  net.myReady = !net.myReady;
  if (net.sendEvent) {
    net.sendEvent({ type: 'ready', ready: net.myReady });
  }
  updateReadyButton();
  updateLobbyPeers();
  checkAllReady();
  try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}
}

function allPeersReady() {
  if (net.peers.size === 0) return false;
  if (!net.myReady) return false;
  for (const peer of net.peers.values()) {
    if (!peer.ready) return false;
  }
  return true;
}

function checkAllReady() {
  if (!net.active) return;
  if (!allPeersReady()) {
    if (net.startTimer) {
      clearTimeout(net.startTimer);
      net.startTimer = null;
      net.startScheduledAt = null;
      const status = document.getElementById('lobby-status');
      if (status) {
        status.textContent = 'WAITING FOR PLAYERS...';
        status.style.color = '#ffaa00';
      }
    }
    return;
  }
  if (net.startScheduledAt) return;

  // Everyone is ready. Lowest peerId proposes the start time, the map, and
  // the world seed. Every peer computes the same proposer independently
  // (deterministic tie-break); no negotiation, no host election.
  const allIds = [net.myPeerId, ...net.peers.keys()].sort();
  const proposer = allIds[0];
  if (proposer === net.myPeerId) {
    const startAt = Date.now() + 3000;
    const mapKey = (typeof game !== 'undefined' && game.selectedMap) || 'hourglass';
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    if (net.sendEvent) net.sendEvent({ type: 'match_start', startAt, mapKey, seed });
    applyWorldSync(mapKey, seed);
    scheduleMatchStart(startAt);
  }
}

function scheduleMatchStart(startAt) {
  if (net.startTimer) clearTimeout(net.startTimer);
  net.startScheduledAt = startAt;
  const delay = Math.max(0, startAt - Date.now());
  net.startTimer = setTimeout(() => {
    net.startTimer = null;
    net.startScheduledAt = null;
    enterShipSelect();
  }, delay);
  tickStartCountdown();
}

// ---- SHIP-SELECT SYNCED LAUNCH (v6.7) ----
function checkAllLoadoutsReady() {
  if (!net.active) return;
  if (typeof _countdownActive !== 'undefined' && _countdownActive) return;
  if (!player.loadoutKey) return;
  showShipSelectWaiting();

  if (net.peers.size === 0) {
    launchCountdown();
    return;
  }

  let allCommitted = true;
  for (const peer of net.peers.values()) {
    if (!peer.loadoutKey) { allCommitted = false; break; }
  }

  if (!allCommitted) {
    if (net.launchTimer) {
      clearTimeout(net.launchTimer);
      net.launchTimer = null;
      net.launchScheduledAt = null;
      if (net.launchRebroadcast) { clearInterval(net.launchRebroadcast); net.launchRebroadcast = null; }
      net.lastLaunchId = null;
      _syncMapButtonsDisabled();
    }
    return;
  }
  if (net.launchScheduledAt) return;

  const allIds = [net.myPeerId, ...net.peers.keys()].sort();
  const proposer = allIds[0];
  if (proposer === net.myPeerId) {
    const launchAt = Date.now() + 1500;
    if (net.sendEvent) net.sendEvent({ type: 'launch_at', launchAt });
    scheduleLaunch(launchAt);
  }
}

function scheduleLaunch(launchAt) {
  if (net.launchTimer) clearTimeout(net.launchTimer);
  if (net.launchRebroadcast) { clearInterval(net.launchRebroadcast); net.launchRebroadcast = null; }
  net.launchScheduledAt = launchAt;
  _syncMapButtonsDisabled();
  const delay = Math.max(0, launchAt - Date.now());

  // (perf 2026-05) Self-healing launch_at handshake. The proposer used to
  // send launch_at exactly once and trust the network to deliver it ;
  // WebRTC data channels can drop messages under congestion.
  if (net.active && net.sendEvent) {
    const allIds = [net.myPeerId, ...net.peers.keys()].sort();
    if (allIds[0] === net.myPeerId) {
      net.launchRebroadcast = setInterval(() => {
        try { net.sendEvent({ type: 'launch_at', launchAt }); } catch (_) {}
      }, 150);
    }
  }

  net.launchTimer = setTimeout(() => {
    net.launchTimer = null;
    net.launchScheduledAt = null;
    if (net.launchRebroadcast) { clearInterval(net.launchRebroadcast); net.launchRebroadcast = null; }
    _syncMapButtonsDisabled();
    launchCountdown();
  }, delay);
}

// ---- WORLD-STATE SYNC (v6.7) ----
function applyWorldSync(mapKey, seed) {
  net.worldMap = mapKey;
  net.worldSeed = seed >>> 0;
  if (typeof game !== 'undefined') game.selectedMap = mapKey;
  // (v6.7) Split peers across Fleet A and Fleet B so the round-end check
  // doesn't insta-end every round.
  assignTeamFromPeerOrder();
}

function assignTeamFromPeerOrder() {
  if (typeof player === 'undefined' || !net.myPeerId) return;
  const allIds = [net.myPeerId, ...net.peers.keys()].sort();
  const myIndex = allIds.indexOf(net.myPeerId);
  player.team = (myIndex % 2 === 0) ? LSS.TEAM_FLEET_A : LSS.TEAM_FLEET_B;
}

// mulberry32: small, fast, well-distributed seedable RNG.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); }
  finally { Math.random = orig; }
}

function getRoundSeed(roundNum) {
  if (typeof net.worldSeed !== 'number') return null;
  return ((net.worldSeed + (roundNum >>> 0) * 0x9E3779B9) >>> 0);
}


// ----- next block -----

function updateLobbyPeers() {
  const el = document.getElementById('lobby-peers');
  if (!el) return;
  const count = net.peers.size;
  if (count === 0) {
    el.textContent = 'WAITING FOR PEERS...';
    el.style.color = '#66bb66';
    return;
  }
  let readyCount = net.myReady ? 1 : 0;
  for (const peer of net.peers.values()) {
    if (peer.ready) readyCount++;
  }
  const total = count + 1; // peers + me
  el.textContent = readyCount + ' / ' + total + ' READY ('
    + count + ' PEER' + (count > 1 ? 'S' : '') + ' IN MESH)';
  el.style.color = readyCount === total ? '#66cc66' : '#ffaa00';
}

function spawnNetworkProjectile(data, fromPeerId) {
  if (!data || !data.ox) return;
  const origin = new THREE.Vector3(data.ox, data.oy, data.oz);
  const vel = new THREE.Vector3(data.vx, data.vy, data.vz);
  const color = data.color || 0xffaa00;
  // Reuse existing Projectile class but mark as network (no local damage;
  // damage flows via the hit-claim path, NetworkPlayer.takeDamage).
  const proj = new Projectile(origin, vel, 0, 0, 'network', color);
  proj.isNetwork = true;
  if (data.isFireSource) proj.isFireSource = true;
  if (data.isArcWave) proj.isArcWave = true;
  // (post-v6.9) Cluster Missile mirror.
  if (data.isCluster) {
    proj.isCluster = true;
    if (proj._baseOpacityCore   !== undefined) proj._baseOpacityCore   = 1.0;
    if (proj._baseOpacityGlow   !== undefined) proj._baseOpacityGlow   = 0.95;
    if (proj._baseOpacityHaze   !== undefined) proj._baseOpacityHaze   = 0.45;
    if (proj._baseOpacityTrail  !== undefined) proj._baseOpacityTrail  = 1.0;
    if (proj._baseOpacityRibbon !== undefined) proj._baseOpacityRibbon = 1.0;
  }
  if (typeof data.sizeMult === 'number' && data.sizeMult > 0) {
    proj.sizeMult = data.sizeMult;
  }
  // (v12m patch2) Mirror explode-vs-bounce flags.
  if (typeof data.splash === 'number') proj.splash = data.splash;
  if (data.tracking)       proj.tracking       = true;
  if (data.salvoGuided)    proj.salvoGuided    = true;
  if (data.isPyroThermite) proj.isPyroThermite = true;
  if (data.isSonar)        proj.isSonar        = true;
  if (!data.isSonar && !data.isArcWave) {
    if (data.isPyroThermite) {
      proj.smokeTrail = true;
      proj.removeHaze();
    } else if (data.isCluster) {
      proj.smokeTrail = true;
      proj.removeHaze();
    } else if (data.tracking) {
      proj.smokeTrail = true;
      proj.removeHaze();
    } else if (data.salvoGuided) {
      proj.smokeTrail = true;
      proj.removeHaze();
    } else if (color === LSS.CLASS_COLORS.SYPHON) {
      proj.smokeTrail = true;
    } else if (color === LSS.CLASS_COLORS.PUNCTURE) {
      proj.smokeTrail = true;
      proj.removeHaze();
    } else if (color === LSS.CLASS_COLORS.TRACKER) {
      proj.smokeTrail = true;
      proj.removeHaze();
    }
  }
  game.projectiles.push(proj);
  const peer = net.peers.get(fromPeerId);
  if (peer && peer.loadoutKey && typeof emitChassisMuzzleFlash === 'function') {
    const dir = vel.clone();
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      emitChassisMuzzleFlash(peer.loadoutKey, origin, dir);
    }
  }
}

function broadcastWorldObjects() {
  if (!net.active || !net.sendEvent) return;
  if (!amStasisOwner()) return;
  if (!game.clusters || game.clusters.length === 0) return;
  net.sendEvent({
    type: 'world_objects',
    clusters: serializeWorldObjects(),
  });
}

function applyWorldObjectsManifest(clusterEntries) {
  if (!Array.isArray(clusterEntries)) return;
  // Tear down whatever clusters / children we currently have.
  for (const c of game.clusters || []) {
    for (const ch of c.children || []) {
      if (ch.mesh && ch.mesh.parent) scene.remove(ch.mesh);
      if (ch.edgeMesh && ch.edgeMesh.parent) scene.remove(ch.edgeMesh);
      // (v15a 2026-05-10 BCS slot leak fix) Dispose the child's atomSmoke
      // GasCloud so its BCS slots are returned to the pool.
      if (ch._atomSmoke && typeof ch._atomSmoke.dispose === 'function') {
        ch._atomSmoke.dispose();
        ch._atomSmoke = null;
      }
    }
  }
  game.clusters = [];
  game.dynamicObjects = [];
  if (typeof disposeAllDetachedGasPockets === 'function') disposeAllDetachedGasPockets();

  // Rebuild from the manifest. ClusterObstacle's config-aware constructor
  // takes the entry directly; child layouts come from entry.children.
  for (let i = 0; i < clusterEntries.length; i++) {
    const e = clusterEntries[i];
    const pos = new THREE.Vector3(e.px, e.py, e.pz);
    const cluster = new ClusterObstacle(pos, e.scale, e);
    cluster.netId = i;
    game.clusters.push(cluster);
  }
}
