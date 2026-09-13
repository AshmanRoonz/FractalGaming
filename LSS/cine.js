/* ─────────────────────────────────────────────────────────────────────────────
   LSS CINE RIG  —  the trailer-making fork.

   Loaded by cine.html, AFTER lss.js, and by nothing else. The game does not know
   this file exists and never will: every line here is additive, and the only
   engine state it writes is the camera transform (plus the HUD's display style
   while recording). Nothing in the game has to be kept in sync with it.

   WHY A SEPARATE FILE AND NOT A COPY OF THE GAME.
   Owner asked to fork the game so cinematic hacking cannot destabilise play. A
   literal copy of index-working.html would do that - and would be a 6 MB file
   that starts drifting the moment the next water or ship fix lands, so within a
   week the trailer build is filming an older game. cine.html is instead emitted
   by strip.py from the SAME stripped page, with one extra script tag: it is a
   real, separate entry point (open cine.html, get the cine build; open
   index.html, get the untouched game) that automatically carries every engine
   change forward. The fork is in the ENTRY POINT, not in a duplicated engine.

   WHAT IT DOES
     - THE INVISIBLE SELFIE STICK: a boom of configurable length with a camera on
       the end, always locked to look at the ship, which can orbit, trail, crane,
       or FREEZE in world space and let the ship rip past it.
     - An auto-cutting shot director, so a single flight yields varied coverage
       instead of one long take.
     - An in-engine recorder: canvas.captureStream -> MediaRecorder -> a .webm you
       can drop straight into an editor.

   CONSOLE IS THE REAL INTERFACE. Every knob is on window.__cine and every action
   is a function there, so nothing depends on a keybind that the game might also
   want. Hotkeys are a convenience on top.
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const CINE = (window.__cine = window.__cine || {});

  // ---- knobs (all live) ------------------------------------------------------
  const D = {
    on: false,            // is the cine camera driving?
    boom: 420,            // selfie-stick length, world units
    lift: 130,            // how far above the ship the cam rides
    yaw: 2.2,             // boom bearing, radians (relative to ship heading in 'chase')
    orbit: 0.22,          // rad/sec for the orbiting shots
    fov: 52,              // cine FOV (the game's is wider; long lens reads more filmic)
    smooth: 0.10,         // 0 = snap, 1 = glued. Position easing per frame at 60fps
    aim: 0.18,            // how fast the look-at eases (lower = lazier, more handheld)
    lead: 0.0,            // aim ahead of the ship along its velocity, seconds
    shake: 0.0,           // handheld noise, world units
    autoCut: 0,           // seconds per shot; 0 = hold the current shot forever
    shot: 'orbit',        // orbit | chase | freeze | crane | flyby | low
    hideHud: true,        // hide the HUD whenever the cine cam is driving
    // ⚠⚠ HOW FAR A PARKED CAMERA MAY LET THE SHIP GET. This is not a taste knob,
    // it is a correctness one. The terrain streamer, the clipmap LOD rings, the
    // water sheet and the ripple window all follow player.position, NOT the
    // camera - the engine only re-anchors them on the camera while its own
    // `_cinematic.active` is set, and that flag also FREEZES the simulation,
    // which is the opposite of what a trailer wants (we are filming live
    // action). So a parked shot that lets the ship fly far away starts showing
    // the edge of the world: the clipmap ring boundaries and the rim of the
    // camera-following water disc. That is the documented v33.96 bug, reached
    // from the other direction.
    // Capping it is also just better filmmaking - a shot where the subject
    // becomes a speck is a bad shot - so `freeze` and `flyby` re-anchor rather
    // than let the distance run.
    maxDist: 2600,
    // Third person only, for now — see the note beside the enforcement in drive().
    // Set 0 if the cockpits ever become worth filming from inside.
    forceThirdPerson: 1,
    // recorder
    fps: 60,
    bitrate: 40000000,    // 40 Mbit - generous; trailer source should not be soft
  };
  for (const k in D) if (CINE[k] === undefined) CINE[k] = D[k];

  // ---- engine handles --------------------------------------------------------
  // `scene` / `camera` / `renderer` / `player` / `game` / `THREE` are reachable
  // from this scope because the game declares them at the top level of its own
  // script. (Plenty of its internals are NOT - anything inside a wrapper, like
  // OW or LOADOUTS, is invisible here. The camera rig deliberately needs none of
  // them.) Everything below re-reads them each frame rather than caching, so a
  // scene rebuild or a respawn cannot leave the rig holding a dead object.
  const has = (n) => { try { return typeof eval(n) !== 'undefined' && eval(n); } catch (_) { return null; } };

  let ready = false;
  const boot = () => {
    if (ready) return true;
    if (!has('THREE') || !has('renderer') || !has('scene') || !has('camera')) return false;
    ready = true;
    install();
    return true;
  };

  // ---- state -----------------------------------------------------------------
  const S = {
    pos: null,            // the rig's smoothed world position
    aimAt: null,          // the smoothed look-at point
    frozenAt: null,       // where the camera parked, for 'freeze'
    t: 0,                 // shot clock
    phase: Math.random() * Math.PI * 2,
    shotT: 0,
    rec: null,            // MediaRecorder
    chunks: [],
    hudWas: null,
  };

  // ⚠ `#fps-counter` lives OUTSIDE #hud and is in none of the game's own hide
  // lists (that is deliberate there - the perf counter is meant to survive the
  // HUD being hidden for a screenshot). A trailer frame must not have it, so it
  // is listed explicitly here.
  const HUD_IDS = ['hud', 'circumpunct-hud', 'crosshair', 'minimap', 'cockpit-frame',
                   'gun-layer', 'enemy-healthbars', 'kill-feed', 'hud-world',
                   'lss-version-badge', 'gamepad-indicator', 'fps-counter',
                   'stasis-warning', 'stasis-vignette', 'enemy-lockon-warning',
                   'hit-marker', 'hit-marker-kill', 'clip-save-btn'];

  function hud(show) {
    for (const id of HUD_IDS) {
      const e = document.getElementById(id);
      if (!e) continue;
      if (show) e.style.removeProperty('display');
      else e.style.setProperty('display', 'none', 'important');
    }
  }

  // The subject: the ship's visible mesh if it has one (that is what the viewer
  // is looking at), else the logical position.
  function subject() {
    const p = has('player');
    if (!p) return null;
    if (p.mesh && p.mesh.position) return p.mesh.position;
    return p.position || null;
  }

  function shipHeading() {
    const p = has('player');
    if (p && p.velocity) {
      const v = p.velocity;
      const h = Math.hypot(v.x, v.z);
      if (h > 25) return Math.atan2(v.x, v.z);
    }
    if (p && p.euler) return p.euler.y;
    return 0;
  }

  // ---- the shots -------------------------------------------------------------
  // Each returns the WORLD position the camera wants to be at this instant. The
  // look-at is always the ship, so every shot is "a camera on a stick pointed at
  // you"; what differs is where the far end of the stick goes.
  const SHOTS = {
    // boom swings around the ship - the default "action cam" read
    orbit(sub, dt) {
      S.phase += CINE.orbit * dt;
      const r = CINE.boom;
      return new THREE.Vector3(
        sub.x + Math.cos(S.phase) * r,
        sub.y + CINE.lift,
        sub.z + Math.sin(S.phase) * r);
    },
    // boom held at a bearing relative to the ship's own heading: a free chase
    // that still lets the ship turn inside frame
    chase(sub) {
      const h = shipHeading() + CINE.yaw;
      const r = CINE.boom;
      return new THREE.Vector3(sub.x + Math.sin(h) * r, sub.y + CINE.lift, sub.z + Math.cos(h) * r);
    },
    // ⭐ THE OWNER'S IDEA: the stick lets go. The camera stops dead in the world
    // and keeps looking at the ship as it flies away, past, or back around. This
    // is the shot that reads as "a camera was there", and it costs nothing -
    // hold the position, keep the aim.
    freeze(sub) {
      if (!S.frozenAt) S.frozenAt = (S.pos ? S.pos.clone() : sub.clone().add(new THREE.Vector3(CINE.boom, CINE.lift, 0)));
      return S.frozenAt;
    },
    // rises while it films: the reveal
    crane(sub, dt) {
      S.phase += CINE.orbit * 0.45 * dt;
      const r = CINE.boom;
      const climb = CINE.lift + S.t * 55;
      return new THREE.Vector3(sub.x + Math.cos(S.phase) * r, sub.y + climb, sub.z + Math.sin(S.phase) * r);
    },
    // parks AHEAD on the ship's current course so the ship flies at and past the
    // lens. Re-anchors whenever the shot starts.
    flyby(sub) {
      if (!S.frozenAt) {
        const h = shipHeading();
        const ahead = CINE.boom * 2.2;
        S.frozenAt = new THREE.Vector3(
          sub.x + Math.sin(h) * ahead + Math.cos(h) * CINE.boom * 0.55,
          sub.y + CINE.lift * 0.5,
          sub.z + Math.cos(h) * ahead - Math.sin(h) * CINE.boom * 0.55);
      }
      return S.frozenAt;
    },
    // down near the deck looking up - makes the ship look fast and heavy
    low(sub, dt) {
      S.phase += CINE.orbit * 0.7 * dt;
      const r = CINE.boom * 0.8;
      let y = sub.y - CINE.lift * 0.8;
      try {
        if (typeof window.__groundY === 'function') {
          const g = window.__groundY(sub.x, sub.z);
          if (isFinite(g)) y = Math.max(y, g + 40);
        }
      } catch (_) {}
      return new THREE.Vector3(sub.x + Math.cos(S.phase) * r, y, sub.z + Math.sin(S.phase) * r);
    },
  };

  const SHOT_NAMES = Object.keys(SHOTS);

  CINE.shots = SHOT_NAMES;
  CINE.setShot = function (name) {
    if (!SHOTS[name]) { console.warn('[cine] unknown shot:', name, 'try', SHOT_NAMES.join(' / ')); return; }
    CINE.shot = name;
    S.frozenAt = null;        // a new shot re-anchors the parked ones
    S.shotT = 0; S.t = 0;
    console.log('[cine] shot:', name);
  };
  CINE.next = function () {
    const i = SHOT_NAMES.indexOf(CINE.shot);
    CINE.setShot(SHOT_NAMES[(i + 1) % SHOT_NAMES.length]);
  };
  CINE.reanchor = function () { S.frozenAt = null; };

  // ---- the per-frame drive ---------------------------------------------------
  // ⚠ THE GAME OWNS THE CAMERA, SO WE TAKE IT LAST.
  // `_lssApplyShipRig` (and the warmup path, and the cinematic path) all write
  // camera.position/quaternion during the game's own update. A rAF of our own
  // has no guaranteed ordering against that, so instead we wrap renderer.render
  // and stamp the transform immediately before the draw that matters. That runs
  // after every writer by construction, whatever order they are in and whatever
  // the game adds later.
  // ⚠ Only for the MAIN pass: the mirror/reflection pass renders the same scene
  // with its OWN camera, and the overlay/zoom passes use their own scene. Moving
  // the camera for those would break the reflection and the ship overlay, so the
  // stamp is gated on the pair being the main scene AND the main camera.
  function install() {
    const R = has('renderer');
    const MAIN_SCENE = has('scene');
    const MAIN_CAM = has('camera');
    if (!R || !R.render) { console.warn('[cine] no renderer'); return; }

    const _render = R.render.bind(R);
    let lastT = performance.now();

    R.render = function (sc, cam) {
      // (v42.88) the projection rig's own six cube faces come back through here;
      // let them straight through or it recurses.
      if (PR.busy) return _render(sc, cam);
      if (sc === MAIN_SCENE && cam === MAIN_CAM) {
        const now = performance.now();
        const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
        lastT = now;
        // clouds tick whether or not the cine camera is driving - you want to
        // fly through the bank and watch it billow while still on the normal
        // chase view, then take the camera for the take.
        try { cloudsTick(dt); } catch (e) {
          if (!CINE._cerr) { CINE._cerr = String((e && e.stack) || e); console.warn('[cine] clouds threw:', e); }
        }
        if (CINE.on) {
          try { drive(cam, dt); } catch (e) {
            if (!CINE._err) { CINE._err = String((e && e.stack) || e); console.warn('[cine] drive threw:', e); }
          }
        }
        // the warp replaces this draw entirely when it is on
        if (PROJ.on && projRender(sc, cam)) return;
      }
      return _render(sc, cam);
    };

    console.log('[cine] rig installed. window.__cine.on = true to take the camera.');
  }

  const _tmpAim = () => new THREE.Vector3();

  function drive(cam, dt) {
    const sub = subject();
    if (!sub) return;
    S.t += dt; S.shotT += dt;

    // the director: cut to a new setup on a timer, if one is set
    if (CINE.autoCut > 0 && S.shotT > CINE.autoCut) {
      const pick = SHOT_NAMES[Math.floor(Math.random() * SHOT_NAMES.length)];
      S.phase = Math.random() * Math.PI * 2;
      CINE.setShot(pick);
    }

    // A parked camera re-anchors before the ship gets far enough to strand the
    // world behind it (see `maxDist`). Doing it here rather than inside the shot
    // keeps every parked shot honest without each one repeating the test.
    if (S.frozenAt && CINE.maxDist > 0 && S.frozenAt.distanceTo(sub) > CINE.maxDist) {
      S.frozenAt = null;
      S.phase = Math.random() * Math.PI * 2;
    }

    const fn = SHOTS[CINE.shot] || SHOTS.orbit;
    const want = fn(sub, dt);

    // ease the body of the stick. `smooth` is expressed per 60fps frame, so the
    // feel does not change with framerate.
    const k = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, CINE.smooth)), dt * 60);
    if (!S.pos) S.pos = want.clone();
    S.pos.lerp(want, k);

    // handheld
    let px = S.pos.x, py = S.pos.y, pz = S.pos.z;
    if (CINE.shake > 0) {
      const t = S.t;
      px += Math.sin(t * 7.3) * CINE.shake;
      py += Math.sin(t * 5.1 + 1.7) * CINE.shake;
      pz += Math.sin(t * 6.2 + 3.1) * CINE.shake;
    }
    cam.position.set(px, py, pz);

    // ALWAYS LOCKED TO THE SHIP. Eased separately from the body so the operator
    // can lag behind a fast pass instead of snapping onto it.
    const target = _tmpAim().copy(sub);
    const p = has('player');
    if (CINE.lead > 0 && p && p.velocity) target.addScaledVector(p.velocity, CINE.lead);
    const ak = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, CINE.aim)), dt * 60);
    if (!S.aimAt) S.aimAt = target.clone();
    S.aimAt.lerp(target, ak);
    cam.lookAt(S.aimAt);

    if (CINE.fov > 0 && Math.abs(cam.fov - CINE.fov) > 0.01) {
      cam.fov = CINE.fov;
      cam.updateProjectionMatrix();
    }

    // ⚠⚠ THE SUBJECT MUST BE VISIBLE. Owner: "it will only ever be third person...
    // for now, until we perfect the cockpits."
    // This is not just a preference, it is load-bearing for the whole rig: in
    // FIRST person the engine hides the ship mesh (the cockpit view IS the ghost
    // shell, so the hull would be inside your face), and a cine camera parked
    // 400 units away would then be filming an invisible ship. Worse, the flag is
    // written from half a dozen places every frame - the ship rig's two branches,
    // the view toggle, _applyStartView, the ADS layer-5 overlay and the XR path -
    // so setting it once at start() does not hold.
    // Forced here, in the same post-everything stamp as the camera, so whoever
    // wrote it this frame has already had their turn.
    if (CINE.forceThirdPerson) {
      try {
        const g = has('game');
        if (g && !g.thirdPerson) g.thirdPerson = true;
        const p = has('player');
        if (p && p.mesh && !p.mesh.visible) p.mesh.visible = true;
      } catch (_) {}
    }
  }

  // ---- take the camera / give it back ----------------------------------------
  CINE.start = function (shot) {
    if (!boot()) { console.warn('[cine] engine not up yet'); return; }
    if (shot) CINE.setShot(shot);
    CINE._fov0 = (CINE._fov0 == null && has('camera')) ? camera.fov : CINE._fov0;
    S.pos = null; S.aimAt = null; S.frozenAt = null; S.t = 0; S.shotT = 0;
    CINE.on = true;
    if (CINE.hideHud) hud(false);
    console.log('[cine] camera taken —', CINE.shot);
  };
  CINE.stop = function () {
    CINE.on = false;
    hud(true);
    try { if (CINE._fov0 != null && has('camera')) { camera.fov = CINE._fov0; camera.updateProjectionMatrix(); } } catch (_) {}
    console.log('[cine] camera released');
  };
  CINE.toggle = function () { CINE.on ? CINE.stop() : CINE.start(); };
  CINE.hud = hud;

  /* ── THE CLOUD SET ─────────────────────────────────────────────────────────
     Owner: "two clouds with rocks and lightning on the two sides of the shot,
     and then some basin clouds or dots or whatever they are called in the
     middle... they float around and get pushed out the way by the ships, it
     looks really cool."

     Nothing here is new cloud tech - the game already has all of it, and the
     source even records where the name came from ("the owner's clouds we
     funnily named dots"). `GasCloud` claims slots in a shared GPU-instanced
     billboard pool and ships the whole disturbance API: applyWake to shove
     sprites aside, tickWake to let them settle back. This just ARRANGES that
     into a set and drives the wake from every ship on screen.

     ⚠⚠ THE SLOTS ARE A SHARED, FINITE POOL AND THEY LEAK. Each cloud claims
     `segments` slots out of the pool for the life of the page unless dispose()
     is called on it. Building a bank repeatedly without clearing will silently
     exhaust it and then new clouds come up empty. `clear()` is not optional
     housekeeping, it is the only thing standing between a few takes and an
     unusable session - so build() always clears first.
     ────────────────────────────────────────────────────────────────────────── */
  const CL = (CINE.clouds = CINE.clouds || {});
  const CLD = {
    // Tuned against the owner live: "thicker" -> "too thick" -> "more dense,
    // like a smaller cloud". The answer was not more sprites, it was a TIGHTER
    // set with SMALLER sprites - a big radius with big billboards reads as flat
    // fog filling frame, while a compact mass of smaller ones has internal
    // structure and a silhouette you can fly past.
    mid: 30,            // drifting clouds through the middle of frame
    flank: 18,          // per flanking storm mass
    gap: 1500,          // how far apart the two flanking masses sit
    midR: 430,          // radius the middle drift fills
    flankR: 300,        // radius of each storm mass
    depth: 650,         // how far the set runs along the shot axis
    segs: 12,           // sprites per cloud (pool cost: (mid + 2*flank) * segs)
    scale: 165,         // sprite size — small enough to show structure
    alpha: 0.62,
    color: 0xa8bccd,    // the light middle drift
    stormColor: 0x5d6b7e,  // the heavy flanking masses
    stormAlpha: 0.8,
    // ⚠⚠ WITHOUT THIS THE CLOUDS ARE INVISIBLE IN DAYLIGHT. The pool ships in
    // ADDITIVE blending, which is right where it is normally used - dark arena
    // shafts and caves, where adding light reads beautifully. Against a bright
    // overworld sky, adding light to an already-bright background does almost
    // nothing: the clouds are genuinely there, slots claimed and drawing, and
    // you cannot see them. Cost me a build chasing a render bug that was not
    // one. 'normal' | 'additive' | 'multiply'.
    blend: 'normal',
    strike: 1.1,        // lightning strikes per second across both masses
    wakeR: 520,         // matches the arenas' own _AR_CLOUD_WAKE_R
    wakeStr: 14,        // ...and its strength. See the engine's note: the drag
                        // term is tiny, so this has to be big or the sprites
                        // barely move during the handful of frames a ship is
                        // inside the radius.
  };
  for (const k in CLD) if (CL[k] === undefined) CL[k] = CLD[k];

  const BANK = { list: [], storms: [], strikeT: 0 };

  CL.clear = function () {
    for (const c of BANK.list) { try { c.dispose(); } catch (_) {} }
    BANK.list.length = 0; BANK.storms.length = 0;
    console.log('[cine] cloud bank cleared');
  };

  // Build the set centred on `at`, laid out across the axis you are shooting
  // along. With no argument it places itself ahead of the ship on its current
  // heading, which is the "fly into it" setup.
  CL.build = function (at, headingRad) {
    const A = window.__cineAPI;
    if (!A || !A.GasCloud || !A.bcs) { console.warn('[cine] no cloud API - is this cine.html on build 42.85+?'); return 0; }
    CL.clear();
    try { if (A.bcs.setBlendMode) A.bcs.setBlendMode(CL.blend); } catch (_) {}

    const sub = subject();
    let c0 = at;
    if (!c0) {
      if (!sub) { console.warn('[cine] no ship to place clouds around'); return 0; }
      const h = (headingRad != null) ? headingRad : shipHeading();
      c0 = new THREE.Vector3(sub.x + Math.sin(h) * 2600, sub.y + 120, sub.z + Math.cos(h) * 2600);
    }
    const h = (headingRad != null) ? headingRad : (sub ? shipHeading() : 0);
    // right-hand axis across the shot
    const rx = Math.cos(h), rz = -Math.sin(h);
    // forward axis, for depth
    const fx = Math.sin(h), fz = Math.cos(h);

    const mk = (p, storm) => {
      try {
        const c = new A.GasCloud(A.bcs, p, {
          boundsRadius: storm ? CL.flankR * 0.55 : CL.midR * 0.32,
          spriteScale: CL.scale * (storm ? 1.25 : 1),
          spriteScaleVar: 0.55,
          alpha: storm ? CL.stormAlpha : CL.alpha,
          color: storm ? CL.stormColor : CL.color,
          colorJitter: 0.14,
          segments: CL.segs,
        });
        BANK.list.push(c);
        if (storm) BANK.storms.push(c);
        return c;
      } catch (e) { console.warn('[cine] cloud failed', e); return null; }
    };

    const R = (n) => (Math.random() - 0.5) * 2 * n;

    // the two flanking storm masses
    for (const side of [-1, 1]) {
      const cx = c0.x + rx * (CL.gap * 0.5) * side;
      const cz = c0.z + rz * (CL.gap * 0.5) * side;
      for (let i = 0; i < CL.flank; i++) {
        mk(new THREE.Vector3(cx + R(CL.flankR), c0.y + R(CL.flankR * 0.7),
                             cz + R(CL.flankR)), true);
      }
    }
    // the lighter drift through the middle, spread along the shot axis so you
    // fly THROUGH it rather than at a wall
    for (let i = 0; i < CL.mid; i++) {
      const d = R(CL.depth * 0.5);
      mk(new THREE.Vector3(c0.x + rx * R(CL.midR) + fx * d,
                           c0.y + R(CL.midR * 0.45),
                           c0.z + rz * R(CL.midR) + fz * d), false);
    }

    BANK.at = c0.clone();
    // ⚠⚠ THE POOL RUNS OUT SILENTLY. claimSlot() returns -1 when the shared pool
    // is exhausted and GasCloud's constructor just `break`s out of its loop - you
    // get a short or completely EMPTY cloud, with no throw and no warning, and
    // the only symptom is a bank that looks thinner than the numbers say. The
    // pool is also fixed at boot (measured 6144 here; it ranges ~1536-7168 by
    // quality tier) and changing the quality setting mid-session does not resize
    // it. So count what we actually got and say so.
    let short = 0, got = 0;
    for (const c of BANK.list) { const n = c.slots ? c.slots.length : 0; got += n; if (n < CL.segs) short++; }
    const free = A.bcs._free ? A.bcs._free.length : -1;
    console.log('[cine] cloud bank:', BANK.list.length, 'clouds (' + BANK.storms.length + ' storm),',
                got, 'sprites @', [c0.x | 0, c0.y | 0, c0.z | 0],
                '| pool', (A.bcs.maxSlots - free) + '/' + A.bcs.maxSlots);
    if (short) console.warn('[cine] POOL SHORT -', short, 'clouds got fewer sprites than asked;',
                            'lower clouds.segs / counts, or clear() an old bank.');
    return BANK.list.length;
  };

  // Drop the whole set right where the ship is, for an immediate emerge shot.
  CL.here = function () {
    const sub = subject();
    if (!sub) return 0;
    return CL.build(sub.clone(), shipHeading());
  };

  const _shipsBuf = [];
  function cloudsTick(dt) {
    if (!BANK.list.length) return;
    // gather the ships once, not per cloud - same shape as the arena tick
    _shipsBuf.length = 0;
    try {
      const p = has('player');
      if (p && p.position && p.shipState !== 'dead' && p.shipState !== 'spawning') _shipsBuf.push(p);
      const g = has('game');
      if (g && g.entities) for (const b of g.entities) { if (b && b.alive && b.position) _shipsBuf.push(b); }
    } catch (_) {}

    const R2 = CL.wakeR * CL.wakeR;
    for (let i = 0; i < BANK.list.length; i++) {
      const c = BANK.list[i];
      if (!c || !c.position) continue;
      let hit = null, best = R2;
      for (let s = 0; s < _shipsBuf.length; s++) {
        const sp = _shipsBuf[s].position;
        const dx = sp.x - c.position.x, dy = sp.y - c.position.y, dz = sp.z - c.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; hit = _shipsBuf[s]; }
      }
      if (hit) {
        const v = hit.velocity;
        try {
          c.applyWake(hit.position.x, hit.position.y, hit.position.z,
                      v ? v.x : 0, v ? v.y : 0, v ? v.z : 0,
                      CL.wakeStr, CL.wakeR, dt);
        } catch (_) {}
      }
      try { c.tickWake(dt); } catch (_) {}
    }

    // lightning inside the flanking masses: a bolt between two points within
    // one storm cloud, so it reads as discharge INSIDE the cloud rather than a
    // beam crossing open sky.
    if (CL.strike > 0 && BANK.storms.length) {
      BANK.strikeT -= dt;
      if (BANK.strikeT <= 0) {
        BANK.strikeT = (1 / CL.strike) * (0.5 + Math.random());
        const A = window.__cineAPI;
        const c = BANK.storms[(Math.random() * BANK.storms.length) | 0];
        if (A && A.lightning && c && c.position) {
          const r = CL.flankR * 0.8;
          const a = c.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, (Math.random() - 0.5) * r * 0.8, (Math.random() - 0.5) * r));
          const b = c.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, (Math.random() - 0.5) * r * 0.8, (Math.random() - 0.5) * r));
          try { A.lightning(a, b, 0xbfe4ff, 0.5, 3, 3, true, 0.7); } catch (_) {}
          try { if (A.light) A.light(a, 0xbfe4ff, 4.0, 2600, 0.18); } catch (_) {}
        }
      }
    }
  }

  /* ── PANINI / CYLINDRICAL PROJECTION ───────────────────────────────────────
     Owner picked FULL Panini in projection_lab.html. This is the same maths in
     the trailer fork, so it can be judged in motion over the real game before
     anyone touches the game's render path.

     WHY PANINI IS NOT A COST.
     Rectilinear projection maps angle as tan(theta), so at a wide field of view
     it hands the far periphery enormous angular resolution and starves the
     middle. At 140 degrees horizontal, the central 60 degrees of your vision -
     the part you are actually looking at - gets 21% of the screen width, and the
     outer periphery takes the other 79%. Panini at d=1 is exactly x = 2*tan(lon/2)
     horizontally, which gives that same central 60 degrees 38% of the width.
     It is geometric foveation: it spends pixels where the eye can use them. At
     equal framebuffer it is SHARPER where it matters, not more expensive.

     ⚠⚠ DESIGNED FOR THE PORT. Both directions live here together on purpose:
       dirFor()  - screen -> view direction, as GLSL, for drawing
       project() - world  -> screen, as JS, for anything that positions UI
     The game has exactly SEVEN `.project(camera)` call sites (bot markers,
     health bars, labels, radar, and three others). Porting means copying the
     shader and pointing those seven at project(). If only the shader moves, the
     world renders correctly and every marker sits in the wrong place - which is
     the whole reason the JS half is written now rather than later.

     ⚠ POST-PROCESSING. The warp renders the scene into a cubemap and resolves it
     into whatever target the game was about to draw into, so the postFX chain
     still runs - but it now runs on the WARPED image rather than before the warp.
     For bloom that is fine. Anything screen-space and geometry-aware would need
     thought before this goes anywhere near the game.
     ────────────────────────────────────────────────────────────────────────── */
  const PROJ = (CINE.proj = CINE.proj || {});
  const PROJD = {
    on: 0,        // 0 = off (normal rectilinear), 1 = Panini, 2 = cylindrical
    d: 1.0,       // Panini compression. 0 = rectilinear, 1 = full (owner's pick)
    hFov: 140,    // horizontal field of view, degrees
    cube: 1024,   // cubemap face size. 1024 is ample at 1080-1440p output
  };
  for (const k in PROJD) if (PROJ[k] === undefined) PROJ[k] = PROJD[k];

  const PR = { rt: null, cam: null, quad: null, scene: null, ortho: null, busy: false };

  const PROJ_FRAG = [
    'precision highp float;',
    'uniform samplerCube uCube;',
    'uniform float uMode, uHFov, uD, uAspect;',
    // (v42.88) textureCube samples in WORLD space but dirFor returns a VIEW-space
    // direction, so without this the warp looks down a fixed world axis no matter
    // where the camera is pointed - caught on the first frame: correct terrain,
    // wrong direction, subject not in shot.
    'uniform mat3 uRot;',
    'varying vec2 vUv;',
    'vec3 dirFor(int mode, vec2 p){',
    '  float hf = uHFov * 0.5;',
    '  float ymax = tan(hf) / uAspect;',        // vertical identical in all modes
    '  float xmax;',
    '  if (mode == 1)      xmax = (uD + 1.0) * sin(hf) / (uD + cos(hf));',
    '  else if (mode == 2) xmax = hf;',
    '  else                xmax = tan(hf);',
    '  float x = p.x * xmax, y = p.y * ymax;',
    '  if (mode == 1) {',
    '    float d = uD;',
    '    float k = x / (d + 1.0);',
    '    float k2 = k * k;',
    '    float disc = 1.0 + k2 * (1.0 - d * d);',
    '    float clon = (-k2 * d + sqrt(max(0.0, disc))) / (k2 + 1.0);',
    '    float slon = k * (d + clon);',
    '    float S = (d + 1.0) / (d + clon);',
    '    return normalize(vec3(slon, y / S, -clon));',
    '  }',
    '  if (mode == 2) return normalize(vec3(sin(x), y, -cos(x)));',
    '  return normalize(vec3(x, y, -1.0));',
    '}',
    'void main(){',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  gl_FragColor = vec4(textureCube(uCube, uRot * dirFor(int(uMode + 0.5), p)).rgb, 1.0);',
    '}',
  ].join('\n');

  function projInit() {
    if (PR.rt) return true;
    const R = has('renderer');
    if (!R || typeof THREE === 'undefined') return false;
    PR.rt = new THREE.WebGLCubeRenderTarget(PROJ.cube, { generateMipmaps: false, minFilter: THREE.LinearFilter });
    PR.cam = new THREE.CubeCamera(1, 30000, PR.rt);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCube: { value: PR.rt.texture }, uMode: { value: 1 },
                  uHFov: { value: PROJ.hFov * Math.PI / 180 }, uD: { value: PROJ.d }, uAspect: { value: 1.6 },
                  uRot: { value: new THREE.Matrix3() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: PROJ_FRAG, depthTest: false, depthWrite: false,
    });
    PR.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    PR.quad.frustumCulled = false;
    PR.scene = new THREE.Scene(); PR.scene.add(PR.quad);
    PR.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    console.log('[cine] projection rig ready (cube ' + PROJ.cube + ')');
    return true;
  }

  // world -> screen, matching dirFor exactly. THIS is what the game's seven
  // `.project(camera)` sites become. Returns NDC in x/y (-1..1), and z<0 behind.
  PROJ.project = function (worldPos, cam) {
    cam = cam || has('camera');
    if (!cam) return null;
    const v = worldPos.clone().applyMatrix4(cam.matrixWorldInverse);   // view space
    const hf = (PROJ.hFov * Math.PI / 180) * 0.5;
    const asp = (typeof PR.quad !== 'undefined' && PR.quad) ? PR.quad.material.uniforms.uAspect.value : 1.6;
    const ymax = Math.tan(hf) / asp;
    const m = PROJ.on | 0, d = PROJ.d;
    const fwd = -v.z;
    if (m === 0) {
      const xmax = Math.tan(hf);
      return { x: (v.x / -v.z) / xmax, y: (v.y / -v.z) / ymax, z: fwd };
    }
    const lon = Math.atan2(v.x, -v.z);
    const tanlat = v.y / Math.hypot(v.x, v.z);
    if (m === 1) {
      const S = (d + 1) / (d + Math.cos(lon));
      const xmax = (d + 1) * Math.sin(hf) / (d + Math.cos(hf));
      return { x: (S * Math.sin(lon)) / xmax, y: (S * tanlat) / ymax, z: fwd };
    }
    return { x: lon / hf, y: tanlat / ymax, z: fwd };
  };

  PROJ.set = function (mode, d) {
    PROJ.on = mode | 0;
    if (d != null) PROJ.d = +d;
    console.log('[cine] projection:', ['rectilinear', 'panini', 'cylindrical'][PROJ.on] || PROJ.on,
                PROJ.on === 1 ? '(d ' + PROJ.d.toFixed(2) + ')' : '', '@', PROJ.hFov + ' deg');
  };
  PROJ.cycle = function () { PROJ.set((PROJ.on + 1) % 3); };

  // Draws the warped frame into whatever target the game was about to use.
  // Returns true if it handled the frame (caller must then NOT draw normally).
  function projRender(sc, cam) {
    if (!PROJ.on || PR.busy) return false;
    if (!projInit()) return false;
    const R = has('renderer');
    const target = R.getRenderTarget();
    const sz = new THREE.Vector2(); R.getSize(sz);
    const u = PR.quad.material.uniforms;
    u.uMode.value = PROJ.on;
    u.uD.value = PROJ.d;
    u.uHFov.value = PROJ.hFov * Math.PI / 180;
    u.uAspect.value = Math.max(0.2, sz.x / Math.max(1, sz.y));
    // view -> world rotation for this frame
    u.uRot.value.setFromMatrix4(cam.matrixWorld);
    // ⚠ RE-ENTRANCY. CubeCamera.update() calls renderer.render six times, and
    // renderer.render is OUR wrapper - without this flag it recurses forever.
    PR.busy = true;
    try {
      PR.cam.position.setFromMatrixPosition(cam.matrixWorld);
      PR.cam.update(R, sc);
      R.setRenderTarget(target);
      R.render(PR.scene, PR.ortho);
    } catch (e) {
      if (!CINE._perr) { CINE._perr = String((e && e.stack) || e); console.warn('[cine] projection threw:', e); }
      PR.busy = false; return false;
    }
    PR.busy = false;
    return true;
  }

  // ---- the recorder ----------------------------------------------------------
  // canvas.captureStream feeds MediaRecorder directly off the drawing buffer, so
  // what lands in the file is exactly what was rendered - no screen capture, no
  // compositor, no window furniture, and it keeps working if the window is a
  // different size than the render target.
  // ⚠ preserveDrawingBuffer is NOT required for captureStream (it grabs at
  // composite time), so nothing about the renderer has to change to record.
  function pickMime() {
    const want = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of want) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {} }
    return '';
  }

  CINE.record = function () {
    if (S.rec) { console.warn('[cine] already recording'); return; }
    const cv = document.querySelector('canvas');
    if (!cv || !cv.captureStream) { console.warn('[cine] no capturable canvas'); return; }
    const stream = cv.captureStream(CINE.fps);
    const mime = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: CINE.bitrate }
                                           : { videoBitsPerSecond: CINE.bitrate });
    } catch (e) { console.warn('[cine] MediaRecorder failed:', e); return; }
    S.chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) S.chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(S.chunks, { type: mime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url; a.download = 'lss_' + stamp + '.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      console.log('[cine] saved', a.download, (blob.size / 1048576).toFixed(1) + ' MB');
      S.chunks = []; S.rec = null;
      dot(false);
    };
    rec.start(1000);   // 1 s chunks: a crash still leaves usable footage
    S.rec = rec;
    dot(true);
    console.log('[cine] RECORDING —', cv.width + 'x' + cv.height, '@', CINE.fps, mime || '(default)');
  };
  CINE.stopRecord = function () { if (S.rec) { try { S.rec.stop(); } catch (_) {} } };
  CINE.rec = function () { S.rec ? CINE.stopRecord() : CINE.record(); };

  // a small always-on-top dot so a take is obviously running. Not captured: it
  // is a DOM element, and captureStream only sees the canvas.
  function dot(on) {
    let d = document.getElementById('cine-rec-dot');
    if (!on) { if (d) d.remove(); return; }
    if (d) return;
    d = document.createElement('div');
    d.id = 'cine-rec-dot';
    d.style.cssText = 'position:fixed;top:14px;right:16px;z-index:99999;width:14px;height:14px;' +
                      'border-radius:50%;background:#ff2d3d;box-shadow:0 0 12px #ff2d3d;' +
                      'animation:cineBlink 1s steps(2,start) infinite;pointer-events:none';
    if (!document.getElementById('cine-rec-style')) {
      const st = document.createElement('style');
      st.id = 'cine-rec-style';
      st.textContent = '@keyframes cineBlink{0%{opacity:1}50%{opacity:.25}100%{opacity:1}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(d);
  }

  // ---- render resolution -----------------------------------------------------
  // Trailer source should not be limited to the window. This forces the drawing
  // buffer to a fixed size; the canvas still displays letterboxed in the page.
  // ⚠ The game's own resize handler will reclaim this on the next window resize.
  CINE.res = function (w, h) {
    const R = has('renderer'), C = has('camera');
    if (!R || !C) return;
    if (!w) { console.log('[cine] current', R.domElement.width + 'x' + R.domElement.height); return; }
    R.setPixelRatio(1);
    R.setSize(w, h, false);
    C.aspect = w / h;
    C.updateProjectionMatrix();
    console.log('[cine] render size ->', w + 'x' + h);
  };

  // ---- hotkeys ---------------------------------------------------------------
  // F-keys only: the game binds letters for flight, and a trailer take must not
  // be interrupted by the camera stealing a movement key.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F2') { e.preventDefault(); CINE.toggle(); }
    else if (e.code === 'F3') { e.preventDefault(); CINE.next(); }
    else if (e.code === 'F4') { e.preventDefault(); CINE.setShot('freeze'); }
    else if (e.code === 'F8') { e.preventDefault(); hud(document.getElementById('hud') && document.getElementById('hud').style.display === 'none'); }
    else if (e.code === 'F9') { e.preventDefault(); CINE.rec(); }
    else if (e.code === 'F6') { e.preventDefault(); CINE.proj.cycle(); }
  }, true);

  // ---- come up when the engine does ------------------------------------------
  const poll = setInterval(() => { if (boot()) clearInterval(poll); }, 250);
  setTimeout(() => clearInterval(poll), 120000);

  console.log('%c[cine] LSS cine rig loaded', 'color:#8fe6ff',
    '\n  F2 camera on/off   F3 next shot   F4 freeze   F8 HUD   F9 record' +
    '\n  window.__cine.start(\'orbit\'|\'chase\'|\'freeze\'|\'crane\'|\'flyby\'|\'low\')' +
    '\n  window.__cine.rec()  .res(2560,1440)  .boom/.lift/.fov/.smooth/.autoCut');
})();
