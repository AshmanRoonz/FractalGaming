// v17 ability + core dispatch system
// Extracted verbatim from last_ship_sailing_v17.html

// ============================================================================
// LSS v17 — Ability + Core system extraction
// All code below is taken verbatim from last_ship_sailing_v17.html
// ============================================================================


// ----- TRACKER state declarations (player object init, ~line 3236) -----
// (v17 -> webgpu) These fields are PROPERTIES of the player object literal
// in v17, not standalone statements. The extraction agent included them as
// reference but JS can't parse property syntax outside a literal. The
// equivalent state is already declared on window.player in
// last_ship_sailing_webGPU.html (vortexAdsActive, trackerLocks, etc.) so
// this comment block is just documentation.
//
//   vortexAdsActive: false,
//   trackerLocks: {}, trackerLockedTarget: null,
//   enemyToneLocks: {}, enemyToneLockMax: 0,


// ----- _ABILITY_OVERLAY_FILES + descriptors (~line 26388) -----

// Per-ship preload manifest. Filenames the loader probes on ship-commit.
// (v17 -> webgpu) Skip redeclaration ; the cockpit module declares the
// canonical _ABILITY_OVERLAY_FILES before this module loads.
// (v17 -> webgpu) duplicate _ABILITY_OVERLAY_FILES declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _ABILITY_OVERLAY_FILES === 'undefined') var _ABILITY_OVERLAY_FILES = {
//     SLAYER:   ['SLAYER-S.png', 'SLAYER-S1.png'],
//     VORTEX:   ['laser_VORTEX.png', 'laserfire_VORTEX.png', 'laserfire1_VORTEX.png'],
//     PUNCTURE: ['PUNCTURE-M.png', 'PUNCTURE-M1.png', 'core_PUNCTURE.png', 'corefire_PUNCTURE.png'],
//     SYPHON:   ['SYPHON-M.png', 'SYPHON-M1.png', 'energy_SYPHON.png', 'energy1_SYPHON.png'],
//     TRACKER:  ['missile_TRACKER.png', 'missilefire_TRACKER.png', 'sonar_TRACKER.png'],
//     BLASTER:  ['core_BLASTER.png', 'core1_BLASTER.png'],
//   };

// Per (loadoutKey + ability/core) overlay descriptor.
//
// Fields :
//   baseFile  : filename of the bring-out / rest frame
//   fireFile  : filename to swap to during the muzzle-fire window (optional)
//   altFile   : filename to alternate WITH baseFile during sustained holds (optional)
//   slide     : 'down' (from above) or 'up' (from below)
//   sustained : true for cores that stay up for their duration
//   totalDur  : seconds (one-shot cycle length, or sustained ceiling)
function _abilityOverlayDescFor(loadoutKey, abilityName) {
  if (loadoutKey === 'SLAYER' && abilityName === 'Stun Bolt') {
    return { baseFile: 'SLAYER-S.png', fireFile: 'SLAYER-S1.png', slide: 'down', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'VORTEX' && abilityName === 'Laser') {
    return { baseFile: 'laser_VORTEX.png', fireFile: 'laserfire_VORTEX.png', slide: 'down', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'PUNCTURE' && abilityName === 'Cluster Missile') {
    return { baseFile: 'PUNCTURE-M.png', fireFile: 'PUNCTURE-M1.png', slide: 'up', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'SYPHON' && abilityName === 'Rocket Salvo') {
    return { baseFile: 'SYPHON-M.png', fireFile: 'SYPHON-M1.png', slide: 'down', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'SYPHON' && abilityName === 'Energy Syphon') {
    // (v17) Slides DOWN from above to match Rocket Salvo. Hold to bring in,
    // release fires the instant zap (energy1 muzzle), then slides back up.
    return { baseFile: 'energy_SYPHON.png', fireFile: 'energy1_SYPHON.png', slide: 'down', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'TRACKER' && abilityName === 'Tracker Rockets') {
    return { baseFile: 'missile_TRACKER.png', fireFile: 'missilefire_TRACKER.png', slide: 'down', sustained: false, totalDur: 1.0 };
  }
  if (loadoutKey === 'TRACKER' && abilityName === 'Sonar Pulse') {
    return { baseFile: 'sonar_TRACKER.png', fireFile: null, slide: 'down', sustained: false, totalDur: 1.0 };
  }
  return null;
}
function _coreOverlayDescFor(loadoutKey, coreName) {
  if (loadoutKey === 'VORTEX' && coreName === 'Mega Laser') {
    // 4 s sustained beam : slide laserfire in, alternate laserfire / laserfire1
    // at 10 Hz for the core duration, slide out when coreActive drops.
    return { baseFile: 'laserfire_VORTEX.png', altFile: 'laserfire1_VORTEX.png', slide: 'down', sustained: true, totalDur: 4.0 };
  }
  if (loadoutKey === 'TRACKER' && coreName === 'Mega Tracker Rockets') {
    // 3 s barrage : missile / missilefire alternation.
    return { baseFile: 'missile_TRACKER.png', altFile: 'missilefire_TRACKER.png', slide: 'down', sustained: true, totalDur: 3.0 };
  }
  if (loadoutKey === 'BLASTER' && coreName === 'AI Assist') {
    // (v17) AI Assist core machinery sits at the top of core_BLASTER.png
    // (upper cockpit), so slides DOWN from above. core1 is the muzzle-fire
    // variant ; alternation at 10 Hz reads as the auto-aim system pulsing
    // during the 10 s burst. The lower-half guns keep cycling on the
    // gun-layer underneath so they stay visible the whole time.
    return { baseFile: 'core_BLASTER.png', altFile: 'core1_BLASTER.png', slide: 'down', sustained: true, totalDur: 10.0 };
  }
  if (loadoutKey === 'PUNCTURE' && coreName === 'Mega Barrage') {
    // (v17) Mega Barrage : 5 s speed boost + rocket barrage. Core PNGs
    // (core_PUNCTURE.png / corefire_PUNCTURE.png) slide DOWN from above
    // and alternate at 10 Hz during the burst, same pattern as the
    // Mega Tracker Rockets core. The PNG files don't exist yet ; the
    // loader handles missing files gracefully (status 'missing' falls
    // back to baseFile, or hides if baseFile is also missing), so this
    // wiring is safe to land before the art is dropped in.
    return { baseFile: 'core_PUNCTURE.png', altFile: 'corefire_PUNCTURE.png', slide: 'down', sustained: true, totalDur: 5.0 };
  }
  return null;
}


// ----- _preloadAbilityOverlayFrames (~line 26467) -----

// Per-ship loader cache for the overlay PNGs. Separate from the cockpit-frame
// cache so the two layers can be reasoned about independently. Keys by filename.
// (v17 -> webgpu) duplicate _abilityOverlayCache declaration removed ; canonical lives in the earlier-loaded module.
//   if (typeof _abilityOverlayCache === 'undefined') var _abilityOverlayCache = {};   // key (ship) -> { frames: { filename: { url, img, status } } }
//   if (typeof _abilityOverlayInFlight === 'undefined') var _abilityOverlayInFlight = {};
function _preloadAbilityOverlayFrames(loadoutKey) {
  if (!loadoutKey) return;
  if (_abilityOverlayCache[loadoutKey] || _abilityOverlayInFlight[loadoutKey]) return;
  const files = _ABILITY_OVERLAY_FILES[loadoutKey];
  if (!files || files.length === 0) return;
  _abilityOverlayInFlight[loadoutKey] = true;
  const dir = loadoutKey.charAt(0) + loadoutKey.slice(1).toLowerCase();
  const entry = { frames: {} };
  let remaining = files.length;
  // (v17) Off-thread bitmap decode for the same reason as the gun-layer
  // preloader : avoid the first-paint decode hitch when ability slide-ins
  // start the moment gameplay begins.
  for (const filename of files) {
    const url = _framesBaseUrl + dir + '/' + filename + _FRAME_CACHE_BUST;
    const img = new Image();
    try { img.decoding = 'async'; } catch (_) {}
    const slot = { url, img, status: null };
    entry.frames[filename] = slot;
    const onReady = () => { slot.status = 'ok'; if (--remaining === 0) finish(); };
    img.onload  = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(onReady).catch(onReady);
      } else {
        onReady();
      }
    };
    img.onerror = () => { slot.status = 'missing'; if (--remaining === 0) finish(); };
    img.src = url;
  }
  function finish() {
    _abilityOverlayInFlight[loadoutKey] = false;
    _abilityOverlayCache[loadoutKey] = entry;
  }
}


// ----- triggerAbilityOverlay / Prime / release / cancel (~line 26506) -----

// Called by activateAbility() right after the ability is committed (energy /
// cooldown checks already passed). loadoutKey doubles as the ship key for
// _ABILITY_OVERLAY_FRAMES lookups. Sets player._abilityOverlayTrigger which
// the per-frame ticker reads.
function triggerAbilityOverlay(loadoutKey, abilityName) {
  // (v17) Hold-prime abilities : if a prime overlay is currently in flight
  // for this ship (released or still held), let the existing prime->release
  // path play out instead of restarting the cycle. abilityInputRelease calls
  // releaseAbilityOverlayPrime BEFORE activateAbility, so by the time we get
  // here the overlay is already running its muzzle / slide-out phase.
  const existing = player && player._abilityOverlayTrigger;
  if (existing && existing.primed && existing.ship === loadoutKey) {
    return;
  }
  const desc = _abilityOverlayDescFor(loadoutKey, abilityName);
  if (!desc) return;
  _preloadAbilityOverlayFrames(loadoutKey);
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  player._abilityOverlayTrigger = {
    ship: loadoutKey,
    desc,
    startTime: now,
    primed: false,
    // For sustained overlays we read abilityActive[] each tick to decide
    // when to slide out. For one-shots we just run the canned 1 s cycle.
    sustainedAbility: desc.sustained ? abilityName : null,
    sustainedCore: false,
    releaseTime: null, // set when sustaining state ends
  };
}

// (v17) Hold-prime trigger : weapon slides up and stays in place until the
// player releases the bound input. Called by abilityInputPress() for the
// abilities listed in _isHoldPrimeAbility. Visual matches the standard
// slide path but with no auto-fire ; releaseAbilityOverlayPrime drives the
// muzzle + slide-out half once the player lets go.
function triggerAbilityOverlayPrime(loadoutKey, abilityName) {
  const desc = _abilityOverlayDescFor(loadoutKey, abilityName);
  if (!desc) return;
  _preloadAbilityOverlayFrames(loadoutKey);
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  player._abilityOverlayTrigger = {
    ship: loadoutKey,
    desc,
    abilityName: abilityName,
    startTime: now,
    primed: true,
    primedReleaseTime: null, // set by releaseAbilityOverlayPrime
    sustainedAbility: null,
    sustainedCore: false,
    releaseTime: null,
  };
}

// (v17) Latches the release timestamp onto a primed overlay so the per-frame
// driver knows when to play the muzzle frame + slide-out. Idempotent : if
// the trigger isn't primed (or doesn't exist), this is a no-op.
function releaseAbilityOverlayPrime(loadoutKey, abilityName) {
  const trig = player && player._abilityOverlayTrigger;
  if (!trig || !trig.primed) return;
  if (trig.ship !== loadoutKey) return;
  if (trig.primedReleaseTime !== null) return; // already released
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  trig.primedReleaseTime = now;
}

// (v17) Hold-prime ability registry. Press starts the slide-in + hold ;
// release fires (muzzle frame + slide-out) and runs the actual ability
// effect. Only cores stay tap-fire (player wants the big-moment cores
// to land instantly when committed).
function _isHoldPrimeAbility(loadoutKey, abilityName) {
  if (loadoutKey === 'SLAYER'   && abilityName === 'Stun Bolt')       return true;
  if (loadoutKey === 'VORTEX'   && abilityName === 'Laser')           return true;
  if (loadoutKey === 'PUNCTURE' && abilityName === 'Cluster Missile') return true;
  if (loadoutKey === 'SYPHON'   && abilityName === 'Energy Syphon')   return true;
  if (loadoutKey === 'SYPHON'   && abilityName === 'Rocket Salvo')    return true;
  if (loadoutKey === 'TRACKER'  && abilityName === 'Tracker Rockets') return true;
  if (loadoutKey === 'TRACKER'  && abilityName === 'Sonar Pulse')     return true;
  return false;
}

// Per-ability prereq check for entering the priming state. Mirrors what
// activateAbility checks at fire time so a doomed activation never paints
// the slide-in (per the user's request, Tracker Rockets with zero full
// locks should not even animate).
function _canPrimeAbility(slot, ability) {
  if (!player || !ability) return false;
  if (player.shipState === 'dead') return false;
  if (typeof game !== 'undefined' && game.state === 'warmup') return false;
  if (player.abilityCooldowns && player.abilityCooldowns[slot] > 0) return false;
  if (player.loadoutKey === 'TRACKER' && ability.name === 'Tracker Rockets') {
    let hasFullLock = false;
    for (const id in (player.trackerLocks || {})) {
      if (player.trackerLocks[id] >= 3) { hasFullLock = true; break; }
    }
    if (!hasFullLock) return false;
  }
  // Vortex Laser : 350 vortex energy. Mirrors the check in executeAbility so
  // we never paint a slide-in for a press that would silently no-op.
  if (player.loadoutKey === 'VORTEX' && ability.name === 'Laser') {
    if ((player.vortexEnergy || 0) < 350) return false;
  }
  return true;
}

// Top-level press handler. Routes to the prime path for hold abilities,
// or to the existing activateAbility tap-fire path for everything else.
function abilityInputPress(slot) {
  if (!player || !player.abilities || !player.abilities[slot]) return;
  const ability = player.abilities[slot];
  if (!_isHoldPrimeAbility(player.loadoutKey, ability.name)) {
    activateAbility(slot);
    return;
  }
  if (!_canPrimeAbility(slot, ability)) return;
  player._abilityPrime = { slot: slot, abilityName: ability.name };
  triggerAbilityOverlayPrime(player.loadoutKey, ability.name);
}

// Top-level release handler. Only triggers a fire if the matching slot is
// currently primed. The order matters here : releaseAbilityOverlayPrime
// runs BEFORE activateAbility so triggerAbilityOverlay (called inside
// activateAbility) sees an active primed trigger and bails out instead of
// restarting the cycle. The visual transitions prime -> muzzle -> slide-out
// while activateAbility runs the gameplay effect.
function abilityInputRelease(slot) {
  if (!player || !player._abilityPrime) return;
  if (player._abilityPrime.slot !== slot) return;
  const ability = player.abilities && player.abilities[slot];
  player._abilityPrime = null;
  if (!ability) return;
  // Final prereq check at release time : if a Tracker Rockets player lost
  // all locks WHILE holding, cancel silently per user spec ("nothing will
  // happen"). Same for cooldown that elapsed externally, dying mid-hold, etc.
  if (!_canPrimeAbility(slot, ability)) {
    cancelAbilityOverlayPrime();
    return;
  }
  releaseAbilityOverlayPrime(player.loadoutKey, ability.name);
  activateAbility(slot);
}

// (v17) Cancel an in-flight prime (slide back down with no muzzle frame).
// Used when the player dies mid-prime, swaps loadout, or loses an ability
// prereq while holding (e.g. Tracker Rockets losing its last full lock).
function cancelAbilityOverlayPrime() {
  const trig = player && player._abilityOverlayTrigger;
  if (!trig || !trig.primed) return;
  if (trig.primedReleaseTime !== null) return;
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  trig.primedReleaseTime = now;
  trig.primedCancelled = true; // skip muzzle frame on slide-out
}
function triggerCoreOverlay(loadoutKey, coreName) {
  const desc = _coreOverlayDescFor(loadoutKey, coreName);
  if (!desc) return;
  _preloadAbilityOverlayFrames(loadoutKey);
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  player._abilityOverlayTrigger = {
    ship: loadoutKey,
    desc,
    startTime: now,
    sustainedAbility: null,
    sustainedCore: true,
    releaseTime: null,
  };
}


// ----- tickAbilityOverlayFrame (~line 26760) -----

function tickAbilityOverlayFrame() {
  const el = document.getElementById('ability-overlay-frame');
  if (!el || !player || !player.loadoutKey) return;
  // Ghost / VR : hide overlay just like cockpit-frame.
  if (player.shipState === 'dead') {
    el.classList.remove('active');
    el.style.backgroundImage = '';
    el._currentUrl = null;
    player._abilityOverlayTrigger = null;
    player._abilityPrime = null;
    return;
  }
  // (v17) Live prereq re-check for an in-flight prime. If the player loses
  // the lock state mid-hold (e.g. their last full-locked Tracker target
  // dies while they're holding), silently cancel the slide and skip the
  // muzzle frame, per spec.
  if (player._abilityPrime) {
    const a = player.abilities && player.abilities[player._abilityPrime.slot];
    if (!a || !_canPrimeAbility(player._abilityPrime.slot, a)) {
      cancelAbilityOverlayPrime();
      player._abilityPrime = null;
    }
  }
  const trig = player._abilityOverlayTrigger;
  if (!trig) {
    if (el.classList.contains('active')) {
      el.classList.remove('active');
      el.style.backgroundImage = '';
      el._currentUrl = null;
    }
    return;
  }
  const cache = _abilityOverlayCache[trig.ship];
  if (!cache) {
    // Frames still loading ; leave hidden. Trigger stays armed so when they
    // arrive (next tick) we pick up cleanly.
    return;
  }
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  const desc = trig.desc;
  // For sustaining triggers : detect when the source state has ended so
  // the slide-out can play. Once detected, latch releaseTime so we can
  // measure slide-out elapsed time even though the source state is gone.
  if (desc.sustained && trig.releaseTime === null) {
    let stillActive = false;
    if (trig.sustainedCore) {
      stillActive = !!player.coreActive;
    } else if (trig.sustainedAbility) {
      const abilities = player.loadout && player.loadout.abilities || [];
      for (let i = 0; i < abilities.length; i++) {
        if (abilities[i] && abilities[i].name === trig.sustainedAbility && player.abilityActive[i]) {
          stillActive = true; break;
        }
      }
    }
    if (!stillActive) trig.releaseTime = now;
  }
  const SLIDE_IN_DUR   = 0.25;
  const FIRE_DUR       = 0.15;
  const HOLD_DUR       = 0.25;
  const SLIDE_OUT_DUR  = 0.35;
  const FLICKER_PERIOD = 0.1;  // 10 Hz for sustained-loop alternation
  let phase, phaseT; // phase name + 0..1 progress within phase
  let suffix = desc.baseKey;
  let yOffset = 0; // translateY percentage (0 means fully in place)
  const slideSign = (desc.slide === 'up') ? +1 : -1; // 'up' means start below (+50%), 'down' means start above (-50%)
  let pickedFile = desc.baseFile;
  const fileExists = (fname) => fname && cache.frames[fname] && cache.frames[fname].status === 'ok';
  if (trig.primed) {
    const elapsedSinceStart = now - trig.startTime;
    if (trig.primedReleaseTime === null) {
      if (elapsedSinceStart < SLIDE_IN_DUR) {
        phaseT = elapsedSinceStart / SLIDE_IN_DUR;
        yOffset = slideSign * 50 * (1 - phaseT);
      }
      pickedFile = desc.baseFile;
    } else {
      const sinceRelease = now - trig.primedReleaseTime;
      if (!trig.primedCancelled && sinceRelease < FIRE_DUR) {
        yOffset = 0;
        pickedFile = fileExists(desc.fireFile) ? desc.fireFile : desc.baseFile;
      } else {
        const slideStart = trig.primedCancelled ? 0 : FIRE_DUR;
        const slideElapsed = sinceRelease - slideStart;
        if (slideElapsed < SLIDE_OUT_DUR) {
          phaseT = slideElapsed / SLIDE_OUT_DUR;
          yOffset = slideSign * 50 * phaseT;
          pickedFile = desc.baseFile;
        } else {
          el.classList.remove('active');
          el.style.backgroundImage = '';
          el._currentUrl = null;
          player._abilityOverlayTrigger = null;
          return;
        }
      }
    }
  } else if (desc.sustained) {
    const elapsedSinceStart = now - trig.startTime;
    if (elapsedSinceStart < SLIDE_IN_DUR && trig.releaseTime === null) {
      phaseT = elapsedSinceStart / SLIDE_IN_DUR;
      yOffset = slideSign * 50 * (1 - phaseT);
      pickedFile = desc.baseFile;
    } else if (trig.releaseTime === null) {
      yOffset = 0;
      if (fileExists(desc.altFile)) {
        pickedFile = (Math.floor(now / FLICKER_PERIOD) % 2 === 0) ? desc.baseFile : desc.altFile;
      } else if (fileExists(desc.fireFile)) {
        pickedFile = (Math.floor(now / FLICKER_PERIOD) % 2 === 0) ? desc.baseFile : desc.fireFile;
      } else {
        pickedFile = desc.baseFile;
      }
    } else {
      const sinceRelease = now - trig.releaseTime;
      if (sinceRelease < SLIDE_OUT_DUR) {
        phaseT = sinceRelease / SLIDE_OUT_DUR;
        yOffset = slideSign * 50 * phaseT;
        pickedFile = desc.baseFile;
      } else {
        el.classList.remove('active');
        el.style.backgroundImage = '';
        el._currentUrl = null;
        player._abilityOverlayTrigger = null;
        return;
      }
    }
  } else {
    const elapsed = now - trig.startTime;
    const total = desc.totalDur || 1.0;
    const slideOutStart = total - SLIDE_OUT_DUR;
    if (elapsed < SLIDE_IN_DUR) {
      phaseT = elapsed / SLIDE_IN_DUR;
      yOffset = slideSign * 50 * (1 - phaseT);
      pickedFile = desc.baseFile;
    } else if (elapsed < SLIDE_IN_DUR + FIRE_DUR) {
      yOffset = 0;
      pickedFile = fileExists(desc.fireFile) ? desc.fireFile : desc.baseFile;
    } else if (elapsed < slideOutStart) {
      yOffset = 0;
      pickedFile = desc.baseFile;
    } else if (elapsed < total) {
      phaseT = (elapsed - slideOutStart) / SLIDE_OUT_DUR;
      yOffset = slideSign * 50 * phaseT;
      pickedFile = desc.baseFile;
    } else {
      el.classList.remove('active');
      el.style.backgroundImage = '';
      el._currentUrl = null;
      player._abilityOverlayTrigger = null;
      return;
    }
  }
  // Resolve filename -> cache slot ; fall back to baseFile if the requested
  // one didn't load (e.g. a missing alt frame still gets the base painted).
  let slot = cache.frames[pickedFile];
  if (!slot || slot.status !== 'ok') slot = cache.frames[desc.baseFile];
  if (!slot || slot.status !== 'ok') {
    if (el.classList.contains('active')) {
      el.classList.remove('active');
      el.style.backgroundImage = '';
      el._currentUrl = null;
    }
    return;
  }
  if (el._currentUrl !== slot.url) {
    el.style.backgroundImage = 'url("' + slot.url + '")';
    el._currentUrl = slot.url;
  }
  if (!el.classList.contains('active')) el.classList.add('active');
  // Combine slide-in translateY with the per-frame directional shift so both
  // effects compose cleanly. The shift moves the layer in the opposite
  // direction of the player's turn (see _updateOverlayShift below).
  const sx = (_overlayShift && _overlayShift.x) || 0;
  const sy = (_overlayShift && _overlayShift.y) || 0;
  el.style.transform = 'translate(' + sx.toFixed(2) + '%, ' + (yOffset + sy).toFixed(2) + '%)';
}


// ----- activateAbility (~line 28832) -----

function activateAbility(slot) {
  if (player.shipState === 'dead' || !player.abilities[slot]) return;
  // No abilities during the pre-round warmup countdown
  if (game.state === 'warmup') return;

  const ability = player.abilities[slot];

  // Explosive Gas (Pyro): charge-based gating instead of cooldown gating
  const isTrapCharges = (ability.name === 'Explosive Gas' && player.loadoutKey === 'PYRO');
  if (isTrapCharges) {
    if ((player.trapCharges || 0) <= 0) return;
  } else {
    if (player.abilityCooldowns[slot] > 0) return;
  }

  // Vortex Shield: can't reactivate while the post-depletion lockout is set.
  // The lockout is raised when the shield drained to zero during a hold; it
  // clears only once the energy pool has refilled to at least 20% of max
  // (see updateAbilities). This forces a real cooldown after a full drain
  // so the shield can't be spammed back on with a sliver of charge.
  if (ability.name === 'Vortex Shield' && player.vortexShieldLockout) return;

  // Hold-to-use abilities: pressing while already held does nothing (release handles deactivation)
  const isHoldAbility = ['Vortex Shield', 'Absorption', 'Fire Shield'].includes(ability.name);
  if (ability.cooldown === 0 && player.abilityActive[slot]) {
    if (isHoldAbility) return; // hold abilities deactivate on key release, not re-press
    player.abilityActive[slot] = false; // toggle abilities (Body Shield, Range Mode)
    // (v11c fix) Manual toggle-off of the Body Shield needs to clear the
    // shield state too. The network broadcast at sendPlayerState checks
    // `player.gunShieldHP > 0` for `abilityShield`, while the local view
    // checks abilityActive[1]. Without resetting HP/timer here, peers
    // kept seeing the dome up after the pilot toggled it off.
    if (ability.name === 'Body Shield') {
      player.gunShieldHP = 0;
      player.gunShieldTimer = 0;
    }
    return;
  }

  player.abilityActive[slot] = true;
  player.abilityTimers[slot] = ability.duration;
  // Cinematic: edge glow + "X ACTIVE" label. Map the long ability name to a
  // color bucket; Overlays.abilityFlash picks the color for known keys and
  // accepts an explicit hex otherwise.
  if (window.Overlays) {
    const ABILITY_COLORS = {
      dash: '#00ccff', shield: '#4488ff', overclock: '#ffaa00', cloak: '#aa44ff',
      emp: '#ff4400', heal: '#44ff88', stasis: '#00ffcc', missiles: '#ff6600',
    };
    const keyMap = {
      'afterburner': 'overclock', 'teleport': 'dash', 'body shield': 'shield',
      'fire shield': 'shield', 'vortex shield': 'shield', 'absorption': 'shield',
      'plasma shield': 'shield', 'cluster missile': 'missiles', 'tracker rockets': 'missiles',
      'rocket salvo': 'missiles', 'laser': 'emp', 'stun bolt': 'emp',
      'charge shot': 'overclock', 'flame chain': 'emp', 'inner spark': 'heal',
      'plasma mines': 'stasis', 'explosive gas': 'emp', 'stasis trap': 'stasis',
      'energy syphon': 'heal',
    };
    const bucket = keyMap[(ability.name || '').toLowerCase()] || null;
    Overlays.abilityFlash(ability.name || 'ABILITY', bucket ? ABILITY_COLORS[bucket] : null);
  }
  executeAbility(slot, ability);
  // (v17) Per-ability "weapon out" overlay frame (slides in/out from off-screen
  // behind the cockpit-frame). No-op when the ability/ship pair isn't
  // registered in _abilityOverlayDescFor.
  try { triggerAbilityOverlay(player.loadoutKey, ability.name); } catch (_) {}
  if (isTrapCharges) {
    // Consume a trap charge; start the per-charge regen timer if not already running
    player.trapCharges = Math.max(0, (player.trapCharges || 0) - 1);
    if (player.trapCooldownTimer <= 0) player.trapCooldownTimer = player.trapChargeCooldown;
  } else if (ability.cooldown > 0) {
    let cd = ability.cooldown;
    // Syphon tier 3: 30% cooldown reduction
    if (player.syphonCooldownMult < 1) cd *= player.syphonCooldownMult;
    player.abilityCooldowns[slot] = cd;
  }
}


// ----- executeAbility (~line 28910) -----

function executeAbility(slot, ability) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

  // VORTEX energy cost check (all VORTEX abilities share one energy pool).
  // Vortex Shield has NO upfront cost; it's a continuous hold ability whose
  // cost comes from the per-frame drain in updateAbilities while held.
  const vortexEnergyCosts = { 'Laser': 350, 'Plasma Mines': 250 };
  if (player.loadoutKey === 'VORTEX' && vortexEnergyCosts[ability.name]) {
    if (player.vortexEnergy < vortexEnergyCosts[ability.name]) return; // not enough energy
    player.vortexEnergy -= vortexEnergyCosts[ability.name];
  }

  // ---- OFFENSIVE ABILITIES ----
  if (ability.type === 'offensive') {
    // VORTEX: Laser (concentrated beam, 2400 dmg in a line). Three-
    // layer visual: (1) volumetric shader cylinder for the bulk of the
    // beam mass ; (2) stacked converging tracer streaks from the painted
    // muzzle tips ; (3) lightning arcs cracking off the beam length.
    if (ability.name === 'Laser') {
      const range = 2500;
      const beamEnd = player.position.clone().add(forward.clone().multiplyScalar(range));
      // (v6.9) Volumetric shader beam. Spawned as a transient effect with
      // a short lifetime that matches the ability's burst window. The
      // mesh's transform is fixed at spawn time (laser leaves a snapshot
      // of where the player was aiming when they pulled the trigger,
      // which feels more like a "shot" than a moving beam). (v14c) Now
      // uses the LayeredFX 'core_beam' preset so the crackle / pulse look
      // composes through the shared shader.
      const BEAM_RADIUS = 80;
      const beamLife = 0.45;
      const beamMid = player.position.clone().add(forward.clone().multiplyScalar(range * 0.5));
      const beamMat = _makeFXMaterial('core_beam');
      if (beamMat.uniforms.uPosScale) beamMat.uniforms.uPosScale.value = 1.0 / Math.max(1, BEAM_RADIUS);
      const beamMesh = new THREE.Mesh(_getVortexCoreBeamGeometry(), beamMat);
      beamMesh.position.copy(beamMid);
      beamMesh.quaternion.setFromUnitVectors(_mvUp, forward);
      beamMesh.scale.set(BEAM_RADIUS, range, BEAM_RADIUS);
      beamMesh.frustumCulled = false;
      beamMesh.renderOrder = 2;
      scene.add(beamMesh);
      game.effects.push({
        mesh: beamMesh,
        type: 'vortexLaserBeam',
        age: 0,
        lifetime: beamLife,
      });
      // (v17) ONE laser beam from the painted single-cannon muzzle in
      // laser_VORTEX.png (the cannon sits upper-right with its barrel tip
      // projecting at roughly (60%, 40%) of the screen). Width scaled up
      // so the visual mass roughly matches the old 5-pair stack.
      const _vlMuzzle = (typeof _computeScreenMuzzleWorld === 'function')
        ? (_computeScreenMuzzleWorld(0.60, 0.40) || player.position)
        : player.position;
      if (typeof _spawnSingleTracer === 'function') {
        _spawnSingleTracer(_vlMuzzle, beamEnd, LSS.CLASS_COLORS.VORTEX, 2.4);
      }
      // Network broadcast : one tracer instead of two. Peers receive the
      // origin in world space (muzzle position is camera-local, but for a
      // single-shot beam the slight offset reads fine from outside).
      if (net.active && net.sendEvent) {
        net.sendEvent({
          type: 'fire_tracer',
          ox: _vlMuzzle.x, oy: _vlMuzzle.y, oz: _vlMuzzle.z,
          ex: beamEnd.x, ey: beamEnd.y, ez: beamEnd.z,
          color: LSS.CLASS_COLORS.VORTEX,
        });
      }
      // Lightning crackle along the beam path. Six arcs at staggered
      // positions, each with lateral jitter, gives a high-voltage feel
      // without tying us to per-frame emission (this is one-shot).
      if (typeof spawnLightningBolt === 'function') {
        for (let a = 0; a < 6; a++) {
          const t = 0.12 + (a / 6) * 0.78 + (Math.random() - 0.5) * 0.05;
          const along = player.position.clone().add(forward.clone().multiplyScalar(range * t));
          const reach = 90 + Math.random() * 100;
          const jit = new THREE.Vector3(
            (Math.random() - 0.5) * reach,
            (Math.random() - 0.5) * reach,
            (Math.random() - 0.5) * reach
          );
          const tip = along.clone().add(jit);
          spawnLightningBolt(along, tip, 0xeeccff, 0.18, 1, 2.2);
        }
      }
      // Muzzle flash + nearby spark/embers
      if (typeof spawnDynamicLight === 'function') {
        const muzzlePos = player.position.clone().add(forward.clone().multiplyScalar(40));
        spawnDynamicLight(muzzlePos, 0xffaa66, 4.5, 700, 0.25);
      }
      const beamSteps = 3;
      for (let step = 1; step < beamSteps; step++) {
        const tStep = step / beamSteps;
        const sparkPos = player.position.clone().add(forward.clone().multiplyScalar(range * tStep));
        for (let i = 0; i < 2; i++) {
          const sparkVel = new THREE.Vector3(
            (Math.random() - 0.5) * 220,
            (Math.random() - 0.5) * 220,
            (Math.random() - 0.5) * 220
          );
          game.particles.push({
            position: sparkPos.clone(),
            velocity: sparkVel,
            life: 0.2,
            maxLife: 0.2,
            color: 0xffcc66,
            size: 1.2 + Math.random() * 1.4
          });
        }
      }

      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position);
        const proj = toBot.dot(forward);
        if (proj < 0 || proj > range) continue;
        const closest = player.position.clone().add(forward.clone().multiplyScalar(proj));
        if (closest.distanceTo(bot.position) < bot.chassis.hullLength * 1.0) {
          const hadShield = bot.shield > 0;
          // Surface-clamped hit point so impact FX render outside the hull.
          const _surfR = bot.chassis.hullLength * 0.5;
          const _toClosest = closest.clone().sub(bot.position);
          const _len = _toClosest.length();
          const hitPoint = (_len > 0.001)
            ? bot.position.clone().add(_toClosest.multiplyScalar(_surfR / _len))
            : bot.position.clone();
          const dealt = bot.takeDamage(2400, 'player', hitPoint);
          if (dealt > 0) { player.damageDealt += dealt; player.coreMeter = Math.min(100, player.coreMeter + dealt / 100); showHitMarker(); }
          spawnExplosion(hitPoint, 60);
          if (typeof spawnHullBurst === 'function') {
            spawnHullBurst(hitPoint, 0xffffff, 110); // hot white core
            spawnHullBurst(hitPoint, 0xeeccff, 85);  // violet halo
          }
          if (!hadShield && typeof spawnImpactSparks === 'function') {
            spawnImpactSparks(hitPoint, 18);
          }
          if (typeof spawnLightningBolt === 'function') {
            for (let a = 0; a < 4; a++) {
              const arcEnd = new THREE.Vector3(
                hitPoint.x + (Math.random() - 0.5) * 110,
                hitPoint.y + (Math.random() - 0.5) * 110,
                hitPoint.z + (Math.random() - 0.5) * 110
              );
              spawnLightningBolt(hitPoint, arcEnd, 0xeeccff, 0.18, 1, 2.5);
            }
          }
          spawnDynamicLight(hitPoint, 0xeebbff, 6.0, 900, 0.45);
        }
      }
      try { playSound('laser_shot'); } catch (_) {}
    }
    // PYRO: Flame Chain (path of fire laid forward from player, 5s duration)
    else if (ability.name === 'Flame Chain') {
      const wallLen = 800;
      const start = player.position.clone().add(forward.clone().multiplyScalar(100));
      const myEffId = ++net.effectIdCounter;
      const effData = {
        type: 'firewall', position: start.clone(), direction: forward.clone(),
        length: wallLen, timer: 5, dmgPerSec: 400, owner: 'player', team: player.team,
        fxTimer: 0, meshes: [],
        ownerPeerId: net.myPeerId, netId: myEffId,
      };
      game.worldEffects.push(effData);
      if (net.active && net.sendEvent) {
        net.sendEvent({
          type: 'effect_spawn', kind: 'firewall',
          netId: myEffId, ownerPeerId: net.myPeerId, team: player.team,
          px: start.x, py: start.y, pz: start.z,
          dx: forward.x, dy: forward.y, dz: forward.z,
          length: wallLen,
        });
      }
      try { _buildFlameChainFlameLicks(effData, start, forward, wallLen); }
      catch (e) { /* visual best-effort */ }
      for (let t = 0; t <= wallLen; t += 60) {
        const pt = start.clone().add(forward.clone().multiplyScalar(t));
        spawnExplosion(pt, 12);
      }
      const wallCenter = start.clone().add(forward.clone().multiplyScalar(wallLen * 0.5));
      spawnDynamicLight(wallCenter, LSS.CLASS_COLORS.PYRO, 2.5, 800, 0.5);
    }
    // PUNCTURE: Cluster Missile (impact + sustained explosions in area for 3s)
    else if (ability.name === 'Cluster Missile') {
      try { playSound('cluster_missile_fire'); } catch (_) {}
      const vel = forward.clone().multiplyScalar(1000);
      const proj = new Projectile(player.position.clone(), vel, 800, 250, 'player', LSS.CLASS_COLORS.PUNCTURE);
      proj.smokeTrail = true;
      proj.removeHaze();
      proj.isCluster = true; // on impact, creates sustained explosion zone
      proj.clusterDmg = 500; // DPS of the sustained cluster area
      proj.clusterDuration = 5; // seconds of sustained explosions
      proj.sizeMult = 3.0;
      if (proj._baseOpacityCore  !== undefined) proj._baseOpacityCore  = 1.0;
      if (proj._baseOpacityGlow  !== undefined) proj._baseOpacityGlow  = 0.95;
      if (proj._baseOpacityHaze  !== undefined) proj._baseOpacityHaze  = 0.45;
      if (proj._baseOpacityTrail !== undefined) proj._baseOpacityTrail = 1.0;
      if (proj._baseOpacityRibbon!== undefined) proj._baseOpacityRibbon= 1.0;
      game.projectiles.push(proj);
      broadcastAbilityProjectile(proj);
    }
    // SLAYER: Stun Bolt
    else if (ability.name === 'Stun Bolt') {
      const arcDmg = player.coreActive && player.loadout.core.name === 'Mega Stun Bolt' ? 3000 : 2000;
      const vel = forward.clone().multiplyScalar(800);
      const proj = new Projectile(player.position.clone(), vel, arcDmg, 150, 'player', LSS.CLASS_COLORS.SLAYER);
      proj.isArcWave = true; // applies slow on hit + pierces + leaves trail
      game.projectiles.push(proj);
      broadcastAbilityProjectile(proj);
      try { playSound('siphon_drain'); } catch (_) {}
    }
    // TRACKER: Tracker Rockets (strict full-lock-only)
    else if (ability.name === 'Tracker Rockets') {
      const lockedTargets = [];
      for (const [botId, locks] of Object.entries(player.trackerLocks)) {
        if (locks >= 3) {
          const bot = game.entities.find(b => b.id == botId && b.alive);
          if (bot) lockedTargets.push(bot);
        }
      }
      if (lockedTargets.length === 0) {
        return;
      }
      try { playSound('tracker_rockets'); } catch (_) {}
      const _trLaunchers = _PLAYER_LAUNCHER_FRACS.TRACKER;
      let _trIdx = 0;
      const _trQueue = [];
      for (const target of lockedTargets) {
        for (let m = 0; m < 5; m++) {
          const _trSpread = new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, 0);
          const _trVel = forward.clone().add(_trSpread).normalize().multiplyScalar(900);
          _trQueue.push({
            velocity:    _trVel,
            damage:      1000,
            splash:      80,
            color:       LSS.CLASS_COLORS.TRACKER,
            smokeTrail:  true,
            removeHaze:  true,
            tracking:    true,
            trackTarget: target,
            originFrac:  _trLaunchers[_trIdx++ % _trLaunchers.length],
          });
        }
        // Consume the full lock immediately so a second press during the
        // burst doesn't double-fire on the same target.
        delete player.trackerLocks[target.id];
      }
      _enqueueStaggeredRocketSalvo(player, _trQueue, 0.035);
      player.trackerLockedTarget = null;
    }
    // BLASTER: Charge Shot (1s charge, then fires; mode-dependent)
    else if (ability.name === 'Charge Shot') {
      player.powerShotCharging = true;
      player.powerShotCharge = 0;
      try { playSound('powershot_charge'); } catch (e) {}
    }
    // SYPHON: Rocket Salvo
    else if (ability.name === 'Rocket Salvo') {
      try { playSound('rocket_salvo'); } catch (_) {}
      const rocketCount = player.syphonMissileRacks ? 10 : 5;
      const _rsQueue = [];
      for (let r = 0; r < rocketCount; r++) {
        const _rsSpread = new THREE.Vector3((Math.random()-0.5)*0.12, (Math.random()-0.5)*0.12, 0);
        const _rsVel = forward.clone().add(_rsSpread).normalize().multiplyScalar(800);
        _rsQueue.push({
          velocity:   _rsVel,
          damage:     700,
          splash:     100,
          color:      LSS.CLASS_COLORS.SYPHON,
          smokeTrail: true,
        });
      }
      _enqueueStaggeredRocketSalvo(player, _rsQueue, 0.035);
    }
  }

  // ---- DEFENSIVE ABILITIES ----
  else if (ability.type === 'defensive') {
    // Energy Syphon (SYPHON): actively drains enemy shields and heals player
    if (ability.name === 'Energy Syphon') {
      try { playSound('siphon_drain'); } catch (_) {}
      let bestBot = null, bestDist = Infinity;
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const dist = player.position.distanceTo(bot.position);
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position).normalize();
        if (dist < 1500 && forward.dot(toBot) > 0.5 && dist < bestDist) {
          bestBot = bot; bestDist = dist;
        }
      }
      if (bestBot) {
        const drainAmt = Math.min(bestBot.shield || 0, 800);
        if (drainAmt > 0 && bestBot.takeDamage) {
          bestBot.shield = Math.max(0, (bestBot.shield || 0) - drainAmt);
        }
        try {
          if (typeof playSpatialSound === 'function') playSpatialSound('siphon_hit', bestBot.position.clone());
          else playSound('siphon_hit');
        } catch (_) {}
        if (bestBot.velocity) bestBot.velocity.multiplyScalar(0.4);
        bestBot.arcSlowTimer = Math.max(bestBot.arcSlowTimer || 0, 2.0); // 2s slow
        try {
          if (typeof playSpatialSound === 'function') playSpatialSound('stun', bestBot.position);
          else playSound('stun');
        } catch (e) {}
        player.shield = Math.min(player.maxShield, player.shield + 800);

        // Siphon conduit visuals (royal-blue palette).
        spawnLightningBolt(player.position, bestBot.position, 0x4169E1, 0.32, 8, 9.0);
        spawnLightningBolt(player.position, bestBot.position, 0x6080ff, 0.28, 6, 7.0);
        if (net && net.active && net.sendEvent) {
          net.sendEvent({
            type: 'siphon_beam',
            ax: player.position.x, ay: player.position.y, az: player.position.z,
            bx: bestBot.position.x, by: bestBot.position.y, bz: bestBot.position.z
          });
        }
        spawnLightningBolt(player.position, bestBot.position, LSS.CLASS_COLORS.SYPHON, 0.32, 8, 14.0);
        for (let oi = 0; oi < 5; oi++) {
          const offset = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
            .normalize().multiplyScalar(40 + Math.random() * 30);
          const tint = (oi % 2 === 0) ? 0x88ccff : LSS.CLASS_COLORS.SYPHON;
          spawnLightningBolt(
            player.position.clone().add(offset),
            bestBot.position.clone().add(offset),
            tint, 0.20 + Math.random() * 0.10, 4, 4.0
          );
        }
        const _siphonDir = new THREE.Vector3().subVectors(bestBot.position, player.position);
        const _siphonLen = _siphonDir.length();
        if (_siphonLen > 1) {
          for (let gi = 0; gi < 24; gi++) {
            const t = Math.random();
            const pPos = player.position.clone().addScaledVector(_siphonDir, t);
            pPos.x += (Math.random() - 0.5) * 50;
            pPos.y += (Math.random() - 0.5) * 50;
            pPos.z += (Math.random() - 0.5) * 50;
            game.particles.push({
              position: pPos,
              velocity: _pVel(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
              ),
              life: 0.18 + Math.random() * 0.18,
              maxLife: 0.36,
              color: Math.random() < 0.5 ? 0x66ccff : 0xaaeeff,
              size: 4 + Math.random() * 4,
            });
          }
        }
        if (net.active && net.sendEvent) {
          net.sendEvent({
            type: 'lightning',
            ox: player.position.x, oy: player.position.y, oz: player.position.z,
            ex: bestBot.position.x, ey: bestBot.position.y, ez: bestBot.position.z,
            color: 0x4169E1, lifetime: 0.32, branches: 8, thickness: 9.0,
          });
          net.sendEvent({
            type: 'lightning',
            ox: player.position.x, oy: player.position.y, oz: player.position.z,
            ex: bestBot.position.x, ey: bestBot.position.y, ez: bestBot.position.z,
            color: LSS.CLASS_COLORS.SYPHON, lifetime: 0.32, branches: 8, thickness: 14.0,
          });
        }

        for (let i = 0; i < 5; i++) {
          const sparkDir = new THREE.Vector3(
            (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.8
          ).normalize();
          const sparkVel = sparkDir.multiplyScalar(120 + Math.random() * 80);
          game.particles.push({
            position: bestBot.position.clone(),
            velocity: sparkVel,
            life: 0.2,
            maxLife: 0.2,
            color: 0x44ffaa,
            size: 1.5 + Math.random() * 1
          });
        }

        for (let i = 0; i < 4; i++) {
          const sparkDir = new THREE.Vector3(
            (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.8,
            (Math.random() - 0.5) * 0.8
          ).normalize();
          const sparkVel = sparkDir.multiplyScalar(100 + Math.random() * 60);
          game.particles.push({
            position: player.position.clone(),
            velocity: sparkVel,
            life: 0.15,
            maxLife: 0.15,
            color: 0x44ffaa,
            size: 1 + Math.random() * 0.8
          });
        }

        spawnDynamicLight(player.position, 0x44ffaa, 2.0, 400, 0.3);
        spawnDynamicLight(bestBot.position, 0x44ffaa, 2.0, 400, 0.3);

        showHitMarker();
      }
    }
    // Afterburner (PUNCTURE): speed boost for the duration
    else if (ability.name === 'Afterburner') {
      player.afterburnerActive = true;
      player.afterburnerSpeedMult = 1.5; // 50% speed boost
      try { playSound('afterburner'); } catch (_) {}
    }
    // Body Shield (BLASTER): activate with full HP, 10s duration
    else if (ability.name === 'Body Shield') {
      player.gunShieldHP = player.gunShieldMaxHP;
      player.gunShieldTimer = 10;
    }
    // Fire Shield (PYRO): hold-to-use
    else if (ability.name === 'Fire Shield') {
      if (player.thermalShieldHP <= 0) {
        // Refuse activation: power is empty; let it recharge.
        player.abilityActive[slot] = false;
        player.abilityTimers[slot] = 0;
        return;
      }
    }
    // Plasma Shield (TRACKER): deploy a floating rectangle shield that stays in place
    else if (ability.name === 'Plasma Shield') {
      const wallPos = player.position.clone().add(forward.clone().multiplyScalar(200));
      const wallDir = forward.clone();
      spawnParticleWall(wallPos, wallDir, 'player', player.team, net.myPeerId, ++net.effectIdCounter, true);
    }
    // Absorption, Vortex Shield are handled passively in playerTakeDamage
  }

  // ---- UTILITY ABILITIES ----
  else if (ability.type === 'utility') {
    // SLAYER: Teleport (movement direction + brief invulnerability)
    if (ability.name === 'Teleport') {
      player.phaseInvuln = true;
      try { playSound('phase_dash'); } catch (_) {}
      const speed = player.velocity ? player.velocity.length() : 0;
      if (speed > 5) {
        // Dash in movement direction
        const moveDir = player.velocity.clone().normalize();
        player.phaseInvulnTimer = 0.3; // 0.3s i-frames
        const dashStart = player.position.clone();
        const dashLen   = 400;
        player.position.add(moveDir.clone().multiplyScalar(dashLen));
        spawnExplosion(player.position.clone().add(moveDir.clone().multiplyScalar(-200)), 15);
        // Green smoke trail along the phase-dash path (Slayer identity color).
        if (typeof spawnFXBurst === 'function') {
          const PUFF_COUNT = 10;
          const _slayerSmokeCol = new THREE.Color(LSS.CLASS_COLORS.SLAYER);
          for (let pi = 0; pi < PUFF_COUNT; pi++) {
            const t = (pi + 0.5) / PUFF_COUNT;
            const px = dashStart.x + moveDir.x * dashLen * t + (Math.random() - 0.5) * 28;
            const py = dashStart.y + moveDir.y * dashLen * t + (Math.random() - 0.5) * 28;
            const pz = dashStart.z + moveDir.z * dashLen * t + (Math.random() - 0.5) * 28;
            const puff = spawnFXBurst('cloud', { x: px, y: py, z: pz },
              22 + Math.random() * 8,
              0.85 + Math.random() * 0.45,
              { startScale: 0.30, endScale: 1.50, segs: 14 });
            if (puff && puff.material && puff.material.uniforms && puff.material.uniforms.uBaseColor) {
              puff.material.uniforms.uBaseColor.value.copy(_slayerSmokeCol);
            }
          }
        }
        // Dash sweep stun: bots whose center lies within DASH_SWEEP_R of segment.
        try {
          const DASH_SWEEP_R = 90;
          const DASH_SWEEP_R2 = DASH_SWEEP_R * DASH_SWEEP_R;
          if (game && game.entities) {
            for (let _ei = 0; _ei < game.entities.length; _ei++) {
              const _b = game.entities[_ei];
              if (!_b || !_b.alive || !_b.position) continue;
              if (_b.team === player.team) continue;       // friendly fire safe
              if (_b.spawnProtection > 0) continue;
              const _vx = _b.position.x - dashStart.x;
              const _vy = _b.position.y - dashStart.y;
              const _vz = _b.position.z - dashStart.z;
              let _t = (_vx * moveDir.x + _vy * moveDir.y + _vz * moveDir.z) / dashLen;
              _t = Math.max(0, Math.min(1, _t));
              const _cx = dashStart.x + moveDir.x * dashLen * _t;
              const _cy = dashStart.y + moveDir.y * dashLen * _t;
              const _cz = dashStart.z + moveDir.z * dashLen * _t;
              const _dx = _b.position.x - _cx;
              const _dy = _b.position.y - _cy;
              const _dz = _b.position.z - _cz;
              const _d2 = _dx * _dx + _dy * _dy + _dz * _dz;
              if (_d2 <= DASH_SWEEP_R2) {
                _b.stunTimer = Math.max(_b.stunTimer || 0, 1.5);
                if (_b.velocity) _b.velocity.multiplyScalar(0.2);
                try {
                  if (typeof playSpatialSound === 'function') playSpatialSound('stun', _b.position);
                  else if (typeof playSound === 'function') playSound('stun');
                } catch (_e) {}
                if (typeof spawnImpactSparks === 'function') {
                  try { spawnImpactSparks(_b.position, 6); } catch (_e) {}
                }
              }
            }
          }
        } catch (_dashErr) { /* non-fatal */ }
      } else {
        // Stationary: phase in place (longer invulnerability, no movement)
        player.phaseInvulnTimer = 1.0;
        spawnExplosion(player.position.clone(), 10);
      }
    }
    // SYPHON: Inner Spark (reset Dash, Ordnance, and Defensive cooldowns)
    else if (ability.name === 'Inner Spark') {
      for (let i = 0; i < 3; i++) {
        if (i !== slot) player.abilityCooldowns[i] = 0;
      }
      player.dashCharges = player.maxDashes;
      player.dashCooldownTimer = 0;
      try { playSound('rearm_reset'); } catch (_) {}
    }
    // VORTEX: Plasma Mines
    else if (ability.name === 'Plasma Mines') {
      try { playSound('trip_wire_deploy'); } catch (_) {}
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const armLen = 180;
      const offsets = [
        [0, 0],            // center
        [ armLen, 0],      // right arm
        [-armLen, 0],      // left arm
        [0,  armLen],      // top arm
        [0, -armLen],      // bottom arm
      ];
      const tripGroupId = ++net.effectIdCounter;
      for (let ti = 0; ti < offsets.length; ti++) {
        const [rOff, uOff] = offsets[ti];
        const target = forward.clone().multiplyScalar(250)
                         .add(right.clone().multiplyScalar(rOff))
                         .add(up.clone().multiplyScalar(uOff));
        const distTo = target.length();
        const dirTo  = target.clone().normalize();
        let minePos;
        const wallDist = (typeof raycastLevel === 'function')
                         ? raycastLevel(player.position, dirTo, distTo)
                         : Infinity;
        if (wallDist < distTo) {
          const hitPoint = player.position.clone().addScaledVector(dirTo, Math.max(0, wallDist - 6));
          const remaining = distTo - wallDist;
          const normal = (typeof getWallNormal === 'function')
                         ? getWallNormal(hitPoint)
                         : dirTo.clone().multiplyScalar(-1);
          const vn = dirTo.dot(normal);
          const reflected = dirTo.clone().addScaledVector(normal, -2 * vn).normalize();
          const secondDist = (typeof raycastLevel === 'function')
                             ? Math.min(remaining, raycastLevel(hitPoint, reflected, remaining + 4) - 6)
                             : remaining;
          const useDist = Math.max(0, secondDist);
          minePos = hitPoint.clone().addScaledVector(reflected, useDist);
        } else {
          minePos = player.position.clone().add(target);
        }
        spawnTripWireOrb(minePos, 'player', player.team, net.myPeerId, ++net.effectIdCounter, true, tripGroupId);
      }
    }
    // PYRO: Explosive Gas
    else if (ability.name === 'Explosive Gas') {
      const trapPos = player.position.clone().add(forward.clone().multiplyScalar(400));
      spawnIncendiaryGas(trapPos, 'player', player.team, net.myPeerId, ++net.effectIdCounter, true);
      try {
        if (typeof playSpatialSound === 'function') playSpatialSound('incendiary_ignite', trapPos.clone());
        else playSound('incendiary_ignite');
      } catch (_) {}
    }
    // PUNCTURE: Stasis Trap (slow + root enemies for 4s); wall-bend deploy
    else if (ability.name === 'Stasis Trap') {
      const TETHER_TARGET_DIST = 300;
      const target = forward.clone().multiplyScalar(TETHER_TARGET_DIST);
      const distTo = target.length();
      const dirTo  = target.clone().normalize();
      let trapPos;
      const wallDist = (typeof raycastLevel === 'function')
                       ? raycastLevel(player.position, dirTo, distTo)
                       : Infinity;
      if (wallDist < distTo) {
        const hitPoint = player.position.clone().addScaledVector(dirTo, Math.max(0, wallDist - 6));
        const remaining = distTo - wallDist;
        const normal = (typeof getWallNormal === 'function')
                       ? getWallNormal(hitPoint)
                       : dirTo.clone().multiplyScalar(-1);
        const vn = dirTo.dot(normal);
        const reflected = dirTo.clone().addScaledVector(normal, -2 * vn).normalize();
        const secondDist = (typeof raycastLevel === 'function')
                           ? Math.min(remaining, raycastLevel(hitPoint, reflected, remaining + 4) - 6)
                           : remaining;
        const useDist = Math.max(0, secondDist);
        trapPos = hitPoint.clone().addScaledVector(reflected, useDist);
      } else {
        trapPos = player.position.clone().add(target);
      }
      try { playSound('tether_trap_deploy'); } catch (_) {}
      spawnTetherTrap(trapPos, 'player', player.team, net.myPeerId, ++net.effectIdCounter, true);
    }
    // TRACKER: Sonar Pulse (beacon projectile that grants locks on detonate)
    else if (ability.name === 'Sonar Pulse') {
      const beaconSpeed = 2400;
      const vel = forward.clone().multiplyScalar(beaconSpeed);
      const proj = new Projectile(player.position.clone(), vel, 0, 0, 'player', LSS.CLASS_COLORS.TRACKER);
      proj.isSonar = true;
      proj.lifetime = 4.0;
      proj.sizeMult = 0.5;
      game.projectiles.push(proj);
      broadcastAbilityProjectile(proj);
    }
    // BLASTER: Range Mode (toggle close/long range, 1s transition delay)
    else if (ability.name === 'Range Mode') {
      player.blasterSwitchTimer = 1.0;
      player.blasterPendingMode = player.blasterMode === 'close' ? 'long' : 'close';
      try { playSound('mode_switch'); } catch (_) {}
    }
  }

  // Small core bonus for ability use
  player.coreMeter = Math.min(100, player.coreMeter + 2);
}


// ----- activateCore (~line 29825) -----

function activateCore() {
  if (player.coreMeter < 100 || player.coreActive || player.shipState === 'dead') return;
  // Syphon: block activation if already at max tier (3)
  if (player.loadout && player.loadout.core.name === 'AI Nanobots' && player.syphonTier >= 3) return;
  player.coreActive = true;
  player.coreTimer = player.loadout.core.duration;
  player.coreMeter = 0;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const coreName = player.loadout.core.name;
  // (v17) Sustained core overlay frame
  try { triggerCoreOverlay(player.loadoutKey, coreName); } catch (_) {}

  // VORTEX: Mega Laser
  if (coreName === 'Mega Laser') {
    spawnTracer(player.position, player.position.clone().add(forward.clone().multiplyScalar(3000)), LSS.CLASS_COLORS.VORTEX);
    try { playSound('laser_core_beam'); } catch (_) {}
  }
  // PYRO: Mega Flame Chain
  else if (coreName === 'Mega Flame Chain') {
    try { playSound('flame_core_blast'); } catch (_) {}
    const radius = 1200;
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const dist = player.position.distanceTo(bot.position);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        const dealt = bot.takeDamage(9000 * falloff, 'player');
        if (dealt > 0) { player.damageDealt += dealt; showHitMarker(); }
      }
    }
    igniteNearbyGas(player.position, radius);
    spawnExplosion(player.position, 80);
    triggerScreenShake(8);
    // Three trails of flame radiating outward, 120 deg apart in horizontal plane.
    const _flameSpine = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    _flameSpine.y = 0;
    if (_flameSpine.lengthSq() < 0.001) _flameSpine.set(0, 0, -1);
    _flameSpine.normalize();
    const FLAME_TRAIL_LENGTH = 700;
    const _flameY = new THREE.Vector3(0, 1, 0);
    const _flameAngles = [0, (2 * Math.PI) / 3, -(2 * Math.PI) / 3];
    for (const ang of _flameAngles) {
      const dir = _flameSpine.clone().applyAxisAngle(_flameY, ang);
      const start = player.position.clone().add(dir.clone().multiplyScalar(60));
      const trailId = ++net.effectIdCounter;
      spawnFlameChainVisual(start, dir, FLAME_TRAIL_LENGTH, player.team, net.myPeerId, trailId);
      if (net.active && net.sendEvent) {
        net.sendEvent({
          type: 'effect_spawn', kind: 'firewall',
          netId: trailId, ownerPeerId: net.myPeerId, team: player.team,
          px: start.x, py: start.y, pz: start.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
          length: FLAME_TRAIL_LENGTH,
        });
      }
    }
  }
  // PUNCTURE: Mega Barrage
  else if (coreName === 'Mega Barrage') {
    // Speed boost is handled in updateAbilities; initial rocket volley
    player.velocity.add(forward.clone().multiplyScalar(600));
    try { playSound('barrage_core_thrust'); } catch (_) {}
  }
  // SLAYER: Mega Stun Bolt (5s lightning storm aura + Stun Bolt flurry)
  else if (coreName === 'Mega Stun Bolt') {
    try { playSound('sword_core_swing'); } catch (_) {}
    try { playSound('stun_core_zap'); } catch (_) {}
    _spawnSlayerCoreStormFX(player.position, net.myPeerId);
    if (net.active && net.sendEvent) {
      net.sendEvent({
        type: 'slayer_core_storm',
        ownerPeerId: net.myPeerId,
        px: player.position.x, py: player.position.y, pz: player.position.z,
      });
    }
  }
  // TRACKER: Mega Tracker Rockets
  else if (coreName === 'Mega Tracker Rockets') {
    try { playSound('salvo_core_burst'); } catch (_) {}
    const _mtrLaunchers = _PLAYER_LAUNCHER_FRACS.TRACKER || null;
    for (let m = 0; m < 8; m++) {
      const spread = new THREE.Vector3((Math.random()-0.5)*0.3, (Math.random()-0.5)*0.3, 0);
      const vel = forward.clone().add(spread).normalize().multiplyScalar(525);
      let _mtrOrigin = player.position.clone();
      if (_mtrLaunchers && typeof _computeScreenMuzzleWorld === 'function') {
        const _f = _mtrLaunchers[m % _mtrLaunchers.length];
        _mtrOrigin = _computeScreenMuzzleWorld(_f.x, _f.y) || _mtrOrigin;
      }
      const proj = new Projectile(_mtrOrigin, vel, 250, 120, 'player', 0xffcc00);
      proj.salvoGuided = true; // remote-guided: follows player crosshair
      proj.smokeTrail = true;
      proj.removeHaze();
      game.projectiles.push(proj);
    }
  }
  // BLASTER: AI Assist (auto-aim + max accuracy, 3500 dmg over 8s)
  else if (coreName === 'AI Assist') {
    // Handled per-tick in updateAbilities (auto-aim firing)
  }
  // SYPHON: AI Nanobots (permanent tier upgrade, 3 tiers)
  else if (coreName === 'AI Nanobots') {
    try { playSound('upgrade_core'); } catch (_) {}
    player.syphonTier = Math.min(3, player.syphonTier + 1);
    switch (player.syphonTier) {
      case 1: // Tier 1: Arc Rounds (+50% vs shields/walls/Body Shield, +10 ammo)
        player.syphonArcRounds = true;
        player.maxClip = 50;
        player.clipAmmo = Math.min(player.clipAmmo + 10, 50);
        break;
      case 2: // Tier 2: Maelstrom (shield recharge + 500 bonus shield HP)
        player.syphonShieldBonus = 500;
        player.maxShield = player.chassis.maxShield + 500;
        player.shield = Math.min(player.shield + 500, player.maxShield);
        player.syphonCooldownMult = 0.7;
        break;
      case 3: // Tier 3: XO-16 Accelerator (+25% damage, faster fire rate)
        player.syphonXO16Accel = true;
        player.syphonDmgMult = 1.25;
        if (player.weapon) player.weapon.fireRate = Math.max(0.06, player.weapon.fireRate * 0.75);
        break;
    }
  }
}


// ----- updateAbilities — hold-key release detection block (~line 30944) -----

function updateAbilities(dt) {
  // (v16a Phase T) Drain queued staggered rocket salvos
  _drainStaggeredRocketSalvo(dt);
  updateShieldVisuals(dt);

  // Hold-to-use abilities: auto-deactivate when button released
  const holdKey = !input.keys['e'] && !(input.gpAbility1); // E key or gamepad RB
  // Detonate the Vortex Shield's stored projectile damage as a forward burst.
  const _vortexShieldRelease = () => {
    if (player.vortexStored <= 0) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const dist = player.position.distanceTo(bot.position);
      if (dist < 300) {
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position).normalize();
        if (fwd.dot(toBot) > 0.2) {
          const dealt = bot.takeDamage(player.vortexStored, 'player');
          if (dealt > 0) { player.damageDealt += dealt; showHitMarker(); }
        }
      }
    }
    spawnExplosion(player.position.clone().add(fwd.multiplyScalar(100)), 30);
    try { playSound('vortex_reflect'); } catch (_) {}
    player.vortexStored = 0;
  };
  for (let i = 0; i < 3; i++) {
    if (player.abilityActive[i] && player.abilities[i] && _holdAbilityNames.includes(player.abilities[i].name)) {
      const abName = player.abilities[i].name;
      if (holdKey) {
        player.abilityActive[i] = false;
        // Trigger Vortex Shield burst release on drop
        if (abName === 'Vortex Shield') _vortexShieldRelease();
        // Afterburner deactivation
        if (abName === 'Afterburner') {
          player.afterburnerActive = false;
          player.afterburnerSpeedMult = 1.0;
        }
      } else if (abName === 'Vortex Shield') {
        // Held: drain VORTEX energy pool. 250/sec.
        const VORTEX_SHIELD_DRAIN = 250;
        player.vortexEnergy = Math.max(0, player.vortexEnergy - VORTEX_SHIELD_DRAIN * dt);
        if (player.vortexEnergy <= 0) {
          player.abilityActive[i] = false;
          player.vortexShieldLockout = true;
          _vortexShieldRelease();
        }
      }
    }
  }
  // Clear Vortex Shield lockout once energy refills to 20%.
  if (player.vortexShieldLockout && player.vortexEnergy >= player.vortexMaxEnergy * 0.20) {
    player.vortexShieldLockout = false;
  }

  // Cooldown ticking
  for (let i = 0; i < 3; i++) {
    if (player.abilityCooldowns[i] > 0) player.abilityCooldowns[i] = Math.max(0, player.abilityCooldowns[i] - dt);
    if (player.abilityActive[i] && player.abilityTimers[i] < 999) {
      player.abilityTimers[i] -= dt;
      if (player.abilityTimers[i] <= 0) {
        player.abilityActive[i] = false;
        // Vortex Shield: release stored damage as burst on deactivation
        if (player.abilities[i] && player.abilities[i].name === 'Vortex Shield' && player.vortexStored > 0) {
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          const burstRadius = 300;
          for (const bot of game.entities) {
            if (!bot.alive || bot.team === player.team) continue;
            const dist = player.position.distanceTo(bot.position);
            if (dist < burstRadius) {
              const toBot = new THREE.Vector3().subVectors(bot.position, player.position).normalize();
              if (forward.dot(toBot) > 0.2) {
                const dealt = bot.takeDamage(player.vortexStored, 'player');
                if (dealt > 0) { player.damageDealt += dealt; showHitMarker(); }
              }
            }
          }
          spawnExplosion(player.position.clone().add(forward.multiplyScalar(100)), 30);
          player.vortexStored = 0;
        }
        // Afterburner: deactivate speed boost
        if (player.abilities[i] && player.abilities[i].name === 'Afterburner') {
          player.afterburnerActive = false;
          player.afterburnerSpeedMult = 1.0;
        }
      }
    }
    // Body Shield: 10s duration timer (expires even if not depleted by damage)
    if (player.abilityActive[i] && player.abilities[i] && player.abilities[i].name === 'Body Shield' && player.gunShieldHP > 0) {
      player.gunShieldTimer -= dt;
      if (player.gunShieldTimer <= 0) {
        player.gunShieldHP = 0; player.gunShieldTimer = 0;
        player.abilityActive[i] = false;
        player.abilityCooldowns[i] = 15;
      }
    }
    // Fire Shield: hold-to-use forward-cone burn
    if (player.abilityActive[i] && player.abilities[i] && player.abilities[i].name === 'Fire Shield') {
      const shieldDrainRate = player.thermalShieldMaxHP / 5;
      player.thermalShieldHP -= shieldDrainRate * dt;
      if (player.thermalShieldHP <= 0) {
        player.thermalShieldHP = 0;
        player.abilityActive[i] = false;
        player.abilityTimers[i] = 0;
      }
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const reach = player.chassis.hullLength * 2.6;
      const baseRadius = player.chassis.hullLength * 0.75;
      const tipRadius  = player.chassis.hullLength * 1.70;
      const maxDPS = 4000;
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position);
        const along = toBot.dot(forward);
        if (along < 0 || along > reach) continue;
        const perp = toBot.clone().sub(forward.clone().multiplyScalar(along));
        const perpLen = perp.length();
        const along01 = along / reach;
        const coneR = baseRadius + (tipRadius - baseRadius) * along01;
        if (perpLen > coneR) continue;
        const forwardFall = 1 - along01;
        const lateralFall = 1 - (perpLen / coneR);
        const dmgPerSec = maxDPS * forwardFall * (0.5 + 0.5 * lateralFall);
        const dealt = bot.takeDamage(dmgPerSec * dt, 'player');
        if (dealt > 0) {
          player.damageDealt += dealt;
          player.coreMeter = Math.min(100, player.coreMeter + dealt / 200);
          if (bot._thermalBurnSfxTimer == null) bot._thermalBurnSfxTimer = 0;
          bot._thermalBurnSfxTimer -= dt;
          if (bot._thermalBurnSfxTimer <= 0) {
            bot._thermalBurnSfxTimer = 0.33;
            try {
              if (typeof playSpatialSound === 'function') playSpatialSound('thermal_burn', bot.position.clone());
              else playSound('thermal_burn');
            } catch (_) {}
          }
        }
      }
      const probeMid = player.position.clone().add(forward.clone().multiplyScalar(reach * 0.5));
      const probeRadius = Math.max(reach * 0.5, (baseRadius + tipRadius) * 0.5);
      igniteNearbyGas(probeMid, probeRadius);
      igniteNearbyGas(player.position, baseRadius);
    }
    // Fire Shield recharge (guarded to only regen when NOT actively held)
    if (player.loadoutKey === 'PYRO' && !player.abilityActive[i] &&
        player.abilities[i] && player.abilities[i].name === 'Fire Shield' &&
        player.thermalShieldHP < player.thermalShieldMaxHP) {
      const rechargePerSec = player.thermalShieldMaxHP / 10;
      player.thermalShieldHP = Math.min(
        player.thermalShieldMaxHP,
        player.thermalShieldHP + rechargePerSec * dt
      );
    }
    // Vortex Shield: drains VORTEX energy while held; auto-drops when depleted
    if (player.abilityActive[i] && player.abilities[i] && player.abilities[i].name === 'Vortex Shield') {
      const drainRate = 120;
      player.vortexEnergy -= drainRate * dt;
      if (player.vortexEnergy <= 0) {
        player.vortexEnergy = 0;
        player.abilityActive[i] = false;
        player.abilityTimers[i] = 0;
        if (player.vortexStored > 0) {
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          const burstR = 300;
          for (const bot of game.entities) {
            if (!bot.alive || bot.team === player.team) continue;
            const dist = player.position.distanceTo(bot.position);
            if (dist < burstR) {
              const toBot = new THREE.Vector3().subVectors(bot.position, player.position).normalize();
              if (fwd.dot(toBot) > 0.2) {
                const dealt = bot.takeDamage(player.vortexStored, 'player');
                if (dealt > 0) { player.damageDealt += dealt; showHitMarker(); }
              }
            }
          }
          spawnExplosion(player.position.clone().add(fwd.multiplyScalar(100)), 30);
          player.vortexStored = 0;
        }
      }
    }
  }

  // Teleport invulnerability timer
  if (player.phaseInvuln) {
    player.phaseInvulnTimer -= dt;
    if (player.phaseInvulnTimer <= 0) player.phaseInvuln = false;
  }

  // ---- CORE ABILITY TICK EFFECTS ----
  if (player.coreActive) {
    player.coreTimer -= dt;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const coreName = player.loadout ? player.loadout.core.name : '';

    // VORTEX Mega Laser: continuous heavy laser
    if (coreName === 'Mega Laser') {
      const range = 3000;
      const end = player.position.clone().add(forward.clone().multiplyScalar(range));
      if (!player._vortexCoreBeam) {
        const beamMat = _makeFXMaterial('core_beam');
        if (beamMat.uniforms.uPosScale) beamMat.uniforms.uPosScale.value = 1.0 / 95;
        const beamMesh = new THREE.Mesh(_getVortexCoreBeamGeometry(), beamMat);
        beamMesh.frustumCulled = false;
        beamMesh.renderOrder = 2;
        scene.add(beamMesh);
        player._vortexCoreBeam = beamMesh;
      }
      const beam = player._vortexCoreBeam;
      const BEAM_RADIUS = 95;
      const mid = player.position.clone().add(forward.clone().multiplyScalar(range * 0.5));
      beam.position.copy(mid);
      beam.quaternion.setFromUnitVectors(_mvUp, forward);
      beam.scale.set(BEAM_RADIUS, range, BEAM_RADIUS);
      beam.visible = true;
      if (beam.material && beam.material.uniforms && beam.material.uniforms.uIntensity) {
        const breath = 0.92 + 0.10 * Math.sin(game.time * 7.0);
        beam.material.uniforms.uIntensity.value = breath;
      }
      // Stacked converging tracer beams (purple-themed Vortex identity).
      spawnTracer(player.position, end, LSS.CLASS_COLORS.VORTEX, 1.8);
      spawnTracer(player.position, end, 0xbb66ff, 1.7);
      spawnTracer(player.position, end, 0xcc99ff, 1.6);
      spawnTracer(player.position, end, 0xeeccff, 1.5);
      spawnTracer(player.position, end, 0xffffff, 1.4);
      spawnTracer(player.position, end, 0xeebbff, 1.3);
      // (v17) Third beam from painted top-right laser muzzle.
      if (typeof _computeScreenMuzzleWorld === 'function' && typeof _spawnSingleTracer === 'function') {
        const _mlMuzzle = _computeScreenMuzzleWorld(0.60, 0.40);
        if (_mlMuzzle) {
          _spawnSingleTracer(_mlMuzzle, end, LSS.CLASS_COLORS.VORTEX, 1.55);
          _spawnSingleTracer(_mlMuzzle, end, 0xeeccff, 1.30);
          _spawnSingleTracer(_mlMuzzle, end, 0xffffff, 1.10);
        }
      }
      // Electric crackle along beam length.
      if (typeof spawnLightningBolt === 'function') {
        if (!player._laserCoreArcTimer) player._laserCoreArcTimer = 0;
        player._laserCoreArcTimer -= dt;
        if (player._laserCoreArcTimer <= 0) {
          for (let a = 0; a < 4; a++) {
            const t = 0.15 + Math.random() * 0.78;
            const along = player.position.clone().add(forward.clone().multiplyScalar(range * t));
            const reach = 110 + Math.random() * 90;
            const jit = new THREE.Vector3(
              (Math.random() - 0.5) * reach,
              (Math.random() - 0.5) * reach,
              (Math.random() - 0.5) * reach
            );
            const tip = along.clone().add(jit);
            spawnLightningBolt(along, tip, 0xeeccff, 0.12, 1, 2.4);
          }
          player._laserCoreArcTimer = 0.025 + Math.random() * 0.03;
        }
      }
      // Per-tick damage + rate-limited impact FX per hit ship.
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const toBot = new THREE.Vector3().subVectors(bot.position, player.position);
        const proj = toBot.dot(forward);
        if (proj > 0 && proj < range) {
          const closest = player.position.clone().add(forward.clone().multiplyScalar(proj));
          if (closest.distanceTo(bot.position) < bot.chassis.hullLength * 1.2) {
            const hadShield = bot.shield > 0;
            const _surfR = bot.chassis.hullLength * 0.5;
            const _toClosest = closest.clone().sub(bot.position);
            const _len = _toClosest.length();
            const hitPoint = (_len > 0.001)
              ? bot.position.clone().add(_toClosest.multiplyScalar(_surfR / _len))
              : bot.position.clone();
            const dealt = bot.takeDamage(3000 * dt, 'player', hitPoint);
            if (dealt > 0) { player.damageDealt += dealt; }
            bot._megaLaserFxTimer = (bot._megaLaserFxTimer || 0) - dt;
            if (bot._megaLaserFxTimer <= 0 && dealt > 0) {
              bot._megaLaserFxTimer = 0.06;
              if (typeof spawnHullBurst === 'function') {
                spawnHullBurst(hitPoint, 0xffffff, 70);
                spawnHullBurst(hitPoint, 0xeeccff, 55);
              }
              if (!hadShield && typeof spawnImpactSparks === 'function') {
                spawnImpactSparks(hitPoint, 8);
              }
              if (typeof spawnLightningBolt === 'function') {
                const arcEnd = new THREE.Vector3(
                  hitPoint.x + (Math.random() - 0.5) * 70,
                  hitPoint.y + (Math.random() - 0.5) * 70,
                  hitPoint.z + (Math.random() - 0.5) * 70
                );
                spawnLightningBolt(hitPoint, arcEnd, 0xeeccff, 0.14, 1, 2.0);
              }
              spawnDynamicLight(hitPoint, 0xeebbff, 4.0, 600, 0.22);
            }
            bot._megaLaserHitMarkerTimer = (bot._megaLaserHitMarkerTimer || 0) - dt;
            if (bot._megaLaserHitMarkerTimer <= 0 && dealt > 0) {
              bot._megaLaserHitMarkerTimer = 0.18;
              if (typeof showHitMarker === 'function') showHitMarker();
            }
          }
        }
      }
    }
    // PUNCTURE Mega Barrage: speed boost + rockets every 0.5s
    else if (coreName === 'Mega Barrage') {
      const curSpeed = player.velocity.length();
      if (curSpeed < player.chassis.flightSpeed * 2) {
        player.velocity.add(forward.clone().multiplyScalar(200 * dt));
      }
      if (Math.random() < dt * 3) {
        const spread = new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, 0);
        const vel = forward.clone().add(spread).normalize().multiplyScalar(1200);
        let _pbOrigin = player.position.clone();
        const _pbLaunchers = _PLAYER_LAUNCHER_FRACS.PUNCTURE;
        if (_pbLaunchers && typeof _computeScreenMuzzleWorld === 'function') {
          player._megaBarrageLaunchIdx = (player._megaBarrageLaunchIdx || 0) + 1;
          const _f = _pbLaunchers[player._megaBarrageLaunchIdx % _pbLaunchers.length];
          _pbOrigin = _computeScreenMuzzleWorld(_f.x, _f.y) || _pbOrigin;
        }
        const proj = new Projectile(_pbOrigin, vel, 200, 100, 'player', LSS.CLASS_COLORS.PUNCTURE);
        proj.smokeTrail = true;
        proj.removeHaze();
        game.projectiles.push(proj);
      }
    }
    // SLAYER Mega Stun Bolt: lightning AoE + Stun Bolt flurry
    else if (coreName === 'Mega Stun Bolt') {
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const dist = player.position.distanceTo(bot.position);
        if (dist < 500) {
          const dealt = bot.takeDamage(1800 * dt, 'player');
          if (dealt > 0) player.damageDealt += dealt;
        }
      }
      if (Math.random() < dt * 2) {
        const vel = forward.clone().multiplyScalar(800);
        const proj = new Projectile(player.position.clone(), vel, 600, 150, 'player', LSS.CLASS_COLORS.SLAYER);
        proj.isArcWave = true;
        game.projectiles.push(proj);
        if (typeof broadcastAbilityProjectile === 'function') {
          broadcastAbilityProjectile(proj);
        }
      }
    }
    // TRACKER Mega Tracker Rockets: keep spawning remote-guided missiles
    else if (coreName === 'Mega Tracker Rockets') {
      if (Math.random() < dt * 10) {
        const spread = new THREE.Vector3((Math.random()-0.5)*0.25, (Math.random()-0.5)*0.25, 0);
        const aimDir = forward.clone().add(spread).normalize();
        const vel = aimDir.multiplyScalar(525);
        let _mtrcOrigin = player.position.clone();
        const _mtrcLaunchers = _PLAYER_LAUNCHER_FRACS.TRACKER;
        if (_mtrcLaunchers && typeof _computeScreenMuzzleWorld === 'function') {
          player._megaTrackerLaunchIdx = (player._megaTrackerLaunchIdx || 0) + 1;
          const _f = _mtrcLaunchers[player._megaTrackerLaunchIdx % _mtrcLaunchers.length];
          _mtrcOrigin = _computeScreenMuzzleWorld(_f.x, _f.y) || _mtrcOrigin;
        }
        const missile = new Projectile(_mtrcOrigin, vel, 200, 120, 'player', LSS.CLASS_COLORS.TRACKER);
        missile.salvoGuided = true;
        missile.smokeTrail = true;
        missile.removeHaze();
        game.projectiles.push(missile);
      }
    }
    // BLASTER AI Assist: auto-aim rapid fire at nearest VISIBLE enemy.
    else if (coreName === 'AI Assist') {
      let nearest = null, nearDist = Infinity;
      for (const bot of game.entities) {
        if (!bot.alive || bot.team === player.team) continue;
        const dist = player.position.distanceTo(bot.position);
        if (dist >= 3000 || dist >= nearDist) continue;
        const losDir = new THREE.Vector3().subVectors(bot.position, player.position).normalize();
        const wallDist = raycastLevel(player.position, losDir, dist + 20);
        if (wallDist < dist) continue;
        nearest = bot; nearDist = dist;
      }
      if (nearest) {
        const toTarget = new THREE.Vector3().subVectors(nearest.position, player.position).normalize();
        if (Math.random() < dt * 20) {
          const wallDist = raycastLevel(player.position, toTarget, 3000);
          const end = player.position.clone().add(toTarget.clone().multiplyScalar(wallDist));
          spawnTracer(player.position, end, LSS.CLASS_COLORS.BLASTER);
          if (net.active && net.sendEvent) {
            net.sendEvent({
              type: 'fire_tracer',
              ox: player.position.x, oy: player.position.y, oz: player.position.z,
              ex: end.x, ey: end.y, ez: end.z,
              color: LSS.CLASS_COLORS.BLASTER,
            });
          }
          if (wallDist >= nearDist) {
            const dealt = nearest.takeDamage(110 * 1.2, 'player');
            if (dealt > 0) { player.damageDealt += dealt; showHitMarker(); }
          }
        }
      }
    }

    if (player.coreTimer <= 0) player.coreActive = false;
  }

  // Hide Vortex Mega Laser beam outside the firing window.
  if (player._vortexCoreBeam) {
    const _coreName = (player.loadout && player.loadout.core) ? player.loadout.core.name : '';
    const isFiringLaserCore = player.coreActive && _coreName === 'Mega Laser';
    if (!isFiringLaserCore) player._vortexCoreBeam.visible = false;
  }

  // ... (continues with worldEffects update — out of scope here)
}

// (v17 -> webgpu) Trailing snippet sections (TRACKER lock add, enemyToneLocks
// decay, Sonar pulse lock-grant, key/gamepad input wiring) intentionally
// elided here. They were function-internal code extracted without their
// wrapping context, 
