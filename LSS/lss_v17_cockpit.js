// v17 cockpit frame + ship loading + directional shift
// Extracted verbatim from last_ship_sailing_v17.html

// (v17 -> webgpu) The CSS for the cockpit/gun/ability-overlay layers and the
// DOM divs themselves live in last_ship_sailing_webGPU.html as <style> and
// <body> markup respectively. Reference CSS + HTML stripped from this
// module ; the original /* */ comments contained nested /* */ which JS
// does not allow (nesting closes early and the CSS gets parsed as code).


// ----- 3. Frames base URL + cache-bust -----
const _cockpitFrameCache = {}; // key -> { status: 'ok'|'missing', muzzle?: {...} }
// (v6.7) Cache-bust query string so the browser refetches frame PNGs on
// every page load. Without this, replacing a frame file on disk leaves the
// browser showing the previously-cached copy until a hard refresh; with it,
// any reload picks up the latest art.
const _FRAME_CACHE_BUST = '?v=' + Date.now();
const _cockpitFrameInFlight = {}; // key -> true while an Image() probe is loading

// (v16d) Frames folder base URL. Mirrors the _skyboxBaseUrl pattern : local
// dev has the HTML and frames/ folder as siblings inside .../FractalGaming/LSS/,
// so location.pathname contains '/LSS/' and ./frames/ resolves correctly. The
// hosted build at lss.fractalreality.ca puts the HTML (as index.html) at the
// site root with the assets living under /LSS/frames/, so the relative path
// needs an LSS/ prefix. Without this, every cockpit frame 404s on the live
// site (the image at lss.fractalreality.ca/LSS/frames/Vortex/VORTEX.png loads
// fine, but ./frames/... from the root resolves to /frames/... which is empty).
const _framesBaseUrl = (function() {
  // (webgpu port) Allow the host page to force a base path. Falls back to
  // the original auto-detect.
  if (typeof window !== 'undefined' && typeof window._framesBaseUrlOverride === 'string') {
    return window._framesBaseUrlOverride;
  }
  try {
    const path = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
    return /\/LSS\//i.test(path) ? './frames/' : './LSS/frames/';
  } catch (_) { return './frames/'; }
})();

// (v17) Legacy registries kept as stubs for any external references. Recoil
// frames moved to the gun-layer (see _GUN_CYCLE) ; the cockpit-frame layer
// now shows only frame_<SHIP>.png. PUNCTURE's railgun charging visual
// migrated to the gun-layer as guncharge_/guncharge1_PUNCTURE.png
// alternation (see tickGunLayer).
const _SHIP_NAMED_FRAMES = {};
const _SHIP_RECOIL_NUMBERS = {};
function _getActiveAbilityFrameKey(_player, _entry) { return null; }


// ----- 4. Cockpit frame loader -----
// (v16d) Cockpit frame loader. Each ship has its own subdirectory under
// ./frames/ with a base image plus up to five numbered recoil frames :
//   ./frames/Vortex/VORTEX.png  (rest)
//   ./frames/Vortex/VORTEX1.png (recoil frame 1)
//   ./frames/Vortex/VORTEX2.png
//   ./frames/Vortex/VORTEX3.png
//   ./frames/Vortex/VORTEX4.png
// Numbered frames are independently optional ; whichever ones load enter
// the recoil cycle in numerical order. Ships that skip a number (e.g.
// Blaster has only 2, 3, 4) just skip that slot in the sequence ; the
// animator iterates whatever made it into recoilUrls. The subdirectory
// name is the ship key in title-case (VORTEX -> Vortex).
// (v17) Cockpit-frame loader, simplified. The frame_<SHIP>.png is now the
// ONLY image on the #cockpit-frame layer (z=9, top of the stack). It
// always paints in front of the gun-layer (z=7) and ability-overlay (z=8)
// and is stationary, so we don't need the old recoil-swap / named-frame
// override machinery here ; those moved to #gun-layer and
// #ability-overlay-frame respectively.
//
// Muzzle-point detection still runs on the loaded image so the HUD knows
// where the painted barrel tips land for tracer / flash alignment. With
// the new layout the barrel tips live on gun_<SHIP>.png, not on the
// frame ; muzzle detection has been moved to the gun-layer loader where
// it now scans that image.
function updateCockpitFrame() {
  const el = document.getElementById('cockpit-frame');
  if (!el) return;
  const key = (player && player.loadoutKey) || null;
  if (!key) {
    el.classList.remove('active');
    el.style.backgroundImage = '';
    if (player) player.cockpitFrameMuzzle = null;
    return;
  }
  const dir = key.charAt(0) + key.slice(1).toLowerCase();
  const baseUrl = _framesBaseUrl + dir + '/frame_' + key + '.png' + _FRAME_CACHE_BUST;
  const cached = _cockpitFrameCache[key];
  const apply = (entry) => {
    if (!entry || entry.status !== 'ok') {
      el.classList.remove('active');
      el.style.backgroundImage = '';
      return;
    }
    if (el._currentUrl !== entry.baseUrl) {
      el.style.backgroundImage = 'url("' + entry.baseUrl + '")';
      el._currentUrl = entry.baseUrl;
    }
    el.classList.add('active');
  };
  if (cached) { apply(cached); return; }
  if (_cockpitFrameInFlight[key]) return;
  _cockpitFrameInFlight[key] = true;
  const baseProbe = new Image();
  // (v17) Off-thread decode so the first paint of frame_<SHIP>.png at launch
  // doesn't hitch the countdown.
  try { baseProbe.decoding = 'async'; } catch (_) {}
  const finalizeReady = () => {
    _cockpitFrameInFlight[key] = false;
    const entry = { status: 'ok', baseUrl, baseImage: baseProbe };
    _cockpitFrameCache[key] = entry;
    if (player && player.loadoutKey === key) apply(entry);
  };
  baseProbe.onload = () => {
    if (typeof baseProbe.decode === 'function') {
      baseProbe.decode().then(finalizeReady).catch(finalizeReady);
    } else {
      finalizeReady();
    }
  };
  baseProbe.onerror = () => {
    _cockpitFrameInFlight[key] = false;
    const entry = { status: 'missing', baseUrl };
    _cockpitFrameCache[key] = entry;
    if (player && player.loadoutKey === key) apply(entry);
  };
  baseProbe.src = baseUrl;
}


// ----- 5. Gun layer loader + tick -----
// ============================================================================
// (v17) Gun layer : per-ship main-weapon graphics sitting BEHIND both the
// ability overlay (z=8) and the cockpit frame (z=9). Holds the recoil cycle
// PNGs (gun_, gunfire_, gun1_, gunfire1_, guncharge_, core_, core1_).
//
// Recoil cycling :
//   - Each ship has a cycle array of suffix tokens (see _GUN_CYCLE).
//   - Cycle index PERSISTS across shots (continuous cycling, not per-shot
//     reset). Two quick shots on a 2-frame cycle [gun, gunfire] read as
//     gunfire -> gun -> gunfire -> gun.
//   - Shot driver : every fresh shot bumps the index forward one.
//   - Time driver : between shots, the index walks forward at
//     RECOIL_HOLD_PER_FRAME intervals until it reaches the rest frame
//     (index 0), then halts there.
//
// Special states (override the recoil cycle while active) :
//   - PUNCTURE charging : alternates guncharge_ / guncharge1_ at a rate
//     that scales with railgunCharge (slow breath at 0% -> crackling at 100%).
//   - BLASTER core active (AI Assist) : cycle swaps from [gun, gunfire, gun1,
//     gunfire1] to [core, core1] for the duration of the core.
// ============================================================================
const _GUN_CYCLE = {
  BLASTER:  ['gun', 'gunfire', 'gun1', 'gunfire1'],
  PUNCTURE: ['gun', 'gunfire'],
  PYRO:     ['gun', 'guncharge', 'gunfire'],
  SLAYER:   ['gun', 'gunfire'],
  SYPHON:   ['gun', 'gunfire'],
  TRACKER:  ['gun', 'gunfire'],
  VORTEX:   ['gun', 'gunfire'],
};
// (v17) Reserved for future ships whose core actually replaces the main
// gun visuals. BLASTER moved off this path because core_BLASTER.png /
// core1_BLASTER.png paint upper-cockpit machinery that should sit ABOVE
// the still-cycling gun PNGs, not replace them ; the core now rides on
// the #ability-overlay-frame layer instead (see _coreOverlayDescFor).
const _GUN_CORE_CYCLE = {};
// Extra suffixes to preload that aren't in the main cycle (charging frames,
// core frames). The preloader walks the union of these and _GUN_CYCLE.
const _GUN_EXTRA_FRAMES = {
  PUNCTURE: ['guncharge', 'guncharge1'],
  BLASTER:  ['core', 'core1'],
};
const _gunLayerCache = {};
const _gunLayerInFlight = {};
function _preloadGunLayer(loadoutKey) {
  if (!loadoutKey) return;
  if (_gunLayerCache[loadoutKey] || _gunLayerInFlight[loadoutKey]) return;
  const cycle = _GUN_CYCLE[loadoutKey];
  if (!cycle) return;
  _gunLayerInFlight[loadoutKey] = true;
  const dir = loadoutKey.charAt(0) + loadoutKey.slice(1).toLowerCase();
  const allSuffixes = cycle.slice();
  const extras = _GUN_EXTRA_FRAMES[loadoutKey] || [];
  for (const s of extras) if (allSuffixes.indexOf(s) < 0) allSuffixes.push(s);
  const entry = { frames: {}, cycle: cycle, cycleIdx: 0, cycleStartTime: 0, lastTimer: 0 };
  let remaining = allSuffixes.length;
  // (v17) Hint the browser to decode off the main thread. Without this,
  // the first PAINT of each PNG (during/right after launch countdown)
  // triggers a synchronous on-main-thread decode of every gun-layer
  // image, which hitches the countdown ticks. async decoding lets the
  // browser pull bitmaps in parallel ; calling img.decode() in onload
  // forces the work to a worker thread before the image is ever drawn.
  for (const suffix of allSuffixes) {
    const url = _framesBaseUrl + dir + '/' + suffix + '_' + loadoutKey + '.png' + _FRAME_CACHE_BUST;
    const img = new Image();
    try { img.decoding = 'async'; } catch (_) {}
    const slot = { url, img, status: null };
    entry.frames[suffix] = slot;
    const onReady = () => {
      slot.status = 'ok';
      // Run muzzle-point detection on gun_<SHIP>.png since that's where the
      // painted barrel tips live now (used to be on SHIP.png in the old layout).
      if (suffix === 'gun' && player && player.loadoutKey === loadoutKey) {
        try { player.cockpitFrameMuzzle = detectFrameMuzzlePoints(img); } catch (_) {}
      }
      if (--remaining === 0) finish();
    };
    img.onload  = () => {
      // Force off-thread bitmap decode so the first paint isn't blocked.
      // decode() returns a Promise on supporting browsers ; fall back to
      // the onload path if it isn't available or rejects (the image is
      // still usable, just decoded later on paint).
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
    _gunLayerInFlight[loadoutKey] = false;
    _gunLayerCache[loadoutKey] = entry;
  }
}

// Per-frame gun-layer driver.
function tickGunLayer() {
  const el = document.getElementById('gun-layer');
  if (!el || !player || !player.loadoutKey) return;
  if (player.shipState === 'dead') {
    el.classList.remove('active');
    el.style.backgroundImage = '';
    el._currentUrl = null;
    return;
  }
  const entry = _gunLayerCache[player.loadoutKey];
  if (!entry) return; // still loading
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);

  // ---- PUNCTURE charging override : alternate guncharge / guncharge1
  // while railgunCharge > 0. Replaces the old PUNCTURE-C / C2 logic that
  // used to live on the cockpit-frame layer.
  if (player.loadoutKey === 'PUNCTURE' && typeof player.railgunCharge === 'number' && player.railgunCharge > 0.02) {
    const charge = Math.min(1.0, Math.max(0, player.railgunCharge));
    // 500 ms breath at 0% charge -> 50 ms crackle at 100%. 10x dynamic range.
    const period = 0.5 * (1 - charge) + 0.05 * charge;
    const useAlt = (Math.floor(now / period) % 2 === 1);
    const altSlot = useAlt ? entry.frames['guncharge1'] : entry.frames['guncharge'];
    const slot = (altSlot && altSlot.status === 'ok')
      ? altSlot
      : entry.frames['guncharge'] || entry.frames['gun'];
    _applyGunLayer(el, slot);
    return;
  }

  // ---- Optional core-state cycle override per ship (none currently in use).
  // BLASTER previously routed AI Assist through here to swap the gun cycle
  // to core / core1, but that hid the main guns ; the core now overlays via
  // #ability-overlay-frame and gun-layer continues its normal cycle.
  let cycle = entry.cycle;
  if (player.loadoutKey && player.coreActive && _GUN_CORE_CYCLE[player.loadoutKey]) {
    cycle = _GUN_CORE_CYCLE[player.loadoutKey];
    if (entry.cycleIdx >= cycle.length) entry.cycleIdx = 0;
  }
  const cycleLen = cycle.length;
  if (cycleLen === 0) return;

  // Adaptive hold time based on weapon fire rate. Floor 15 ms so very fast
  // cycles don't flicker imperceptibly ; ceiling 60 ms so very slow ones
  // don't drag.
  const fireRate = (player.loadout && player.loadout.weapon && player.loadout.weapon.fireRate) || 0.5;
  const targetCycle = fireRate * 0.5;
  const RECOIL_HOLD_PER_FRAME = Math.max(0.015, Math.min(0.06, targetCycle / cycleLen));

  // Shot driver : muzzleFlashTimer ticks upward each fire. Compare against
  // the cached last value to detect rising edges.
  const timer = player.muzzleFlashTimer || 0;
  const freshShot = timer > entry.lastTimer + 0.001;
  entry.lastTimer = timer;
  if (freshShot) {
    entry.cycleIdx = (entry.cycleIdx + 1) % cycleLen;
    entry.cycleStartTime = now;
  } else if (entry.cycleIdx !== 0 && (now - entry.cycleStartTime) >= RECOIL_HOLD_PER_FRAME) {
    // Time driver : walk forward until we hit the rest frame (idx 0), then halt.
    entry.cycleIdx = (entry.cycleIdx + 1) % cycleLen;
    entry.cycleStartTime = now;
  }

  const suffix = cycle[entry.cycleIdx];
  let slot = entry.frames[suffix];
  if (!slot || slot.status !== 'ok') slot = entry.frames['gun'];
  _applyGunLayer(el, slot);
}

function _applyGunLayer(el, slot) {
  if (!slot || slot.status !== 'ok') {
    el.classList.remove('active');
    el.style.backgroundImage = '';
    el._currentUrl = null;
    return;
  }
  if (el._currentUrl !== slot.url) {
    el.style.backgroundImage = 'url("' + slot.url + '")';
    el._currentUrl = slot.url;
  }
  if (!el.classList.contains('active')) el.classList.add('active');
  // (v17) Apply the directional shift so the gun lags opposite to the
  // ship's turn. Same shift state used by the ability overlay so both
  // behind-layers move in lockstep.
  const sx = (_overlayShift && _overlayShift.x) || 0;
  const sy = (_overlayShift && _overlayShift.y) || 0;
  el.style.transform = 'translate(' + sx.toFixed(2) + '%, ' + sy.toFixed(2) + '%)';
}


// ----- 6. Ability overlay frame system -----
// ============================================================================
// (v17) Ability overlay frame : per-ability "weapon out" PNG that slides in
// behind the cockpit-frame, briefly swaps to a muzzle-fire frame, then slides
// back out. Layered BEHIND #cockpit-frame so the painted cockpit arms / guns
// always sit on top of the bring-out art. The slide starts from halfway
// off-screen (translateY +/- 50%) ; total cycle is ~1 s.
//
// Coverage (filenames in disk-native form):
//   SLAYER-S.png    / SLAYER-S1.png      : Stun Bolt (slide down)
//   laser_VORTEX    / laserfire_VORTEX   : Laser ability (slide down)
//   laserfire / laserfire1_VORTEX        : Mega Laser core (sustained, alternates)
//   PUNCTURE-M.png  / PUNCTURE-M1.png    : Cluster Missile (slide UP)
//   energy_SYPHON   / energy1_SYPHON     : Energy Syphon (slide down)
//   SYPHON-M.png    / SYPHON-M1.png      : Rocket Salvo (slide down)
//   missile_TRACKER / missilefire_TRACKER: Tracker Rockets ability + core (sustained for core)
//   sonar_TRACKER                        : Sonar Pulse (slide down, single frame)
//
// (v17 file naming) Descriptors now carry full filenames instead of bare
// suffixes so the loader can mix the new `<purpose>_<SHIP>.png` style with
// the legacy `<SHIP>-<TAG>.png` style transparently. The cache keys by
// filename ; lookups are O(1).
// ============================================================================
// Per-ship preload manifest. Filenames the loader probes on ship-commit.
const _ABILITY_OVERLAY_FILES = {
  SLAYER:   ['SLAYER-S.png', 'SLAYER-S1.png'],
  VORTEX:   ['laser_VORTEX.png', 'laserfire_VORTEX.png', 'laserfire1_VORTEX.png'],
  PUNCTURE: ['PUNCTURE-M.png', 'PUNCTURE-M1.png', 'core_PUNCTURE.png', 'corefire_PUNCTURE.png'],
  SYPHON:   ['SYPHON-M.png', 'SYPHON-M1.png', 'energy_SYPHON.png', 'energy1_SYPHON.png'],
  TRACKER:  ['missile_TRACKER.png', 'missilefire_TRACKER.png', 'sonar_TRACKER.png'],
  BLASTER:  ['core_BLASTER.png', 'core1_BLASTER.png'],
};

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

// Per-ship loader cache for the overlay PNGs. Separate from the cockpit-frame
// cache so the two layers can be reasoned about independently. Keys by filename.
const _abilityOverlayCache = {};   // key (ship) -> { frames: { filename: { url, img, status } } }
const _abilityOverlayInFlight = {};
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

// Per-frame driver. Computes the current phase from elapsed time + sustaining
// state, picks the suffix to display, and sets the DOM background image +
// transform. Slide phase :
//
//   0.00 - 0.25 s : SLIDE IN  (translateY 50% -> 0%, base frame)
//   0.25 - 0.40 s : FIRE       (muzzle suffix if defined ; otherwise base)
//   0.40 - 0.65 s : HOLD       (base frame in place)
//   0.65 - 1.00 s : SLIDE OUT  (translateY 0% -> 50%, base frame)
//
// For SUSTAINED overlays (Energy Syphon hold, Mega Laser core, Mega Tracker
// Rockets core), the FIRE/HOLD phase is replaced by a continuous loop while
// the ability/core is active : base alternates with altKey at 10 Hz (mega
// laser visual pulse) ; once the source state ends, the slide-out plays.
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


// ----- 7. Muzzle-point helpers -----
// Alpha-channel scan to find where the two painted gun-barrel tips point AND
// what direction the painted barrels are pointing. For each half of the image
// (left half, right half) we:
//   (1) Sweep rows top-to-bottom in the lower 2/3 looking for the first opaque
//       band (the tip).
//   (2) Sample a thin band immediately below the tip and median the horizontal
//       centers to lock the tip's x onto the barrel axis (not a tip-corner).
//   (3) Sample a SECOND band ~8% of imgH below the tip and median again to get
//       a "base" point further down the same barrel. The (tip - base) vector
//       is the painted barrel's apparent direction in image space.
// The direction lets spawnTracer fire each beam ALONG the painted barrel rather
// than always converging hard at screen center, so the lasers visually match
// the angle the painted guns are drawn at.
// Returns { imgW, imgH, left: {x,y,bx,by,dx,dy}, right: {...} } in image-native
// coords (dx,dy is the unit-ish painted direction from base toward tip, so up
// the screen-space barrel toward the muzzle), or null if either tip can't be
// found cleanly.
function detectFrameMuzzlePoints(img) {
  try {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (iw < 100 || ih < 100) return null;
    const cv = document.createElement('canvas');
    cv.width = iw; cv.height = ih;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, iw, ih).data;
    const MIN_RUN = Math.max(6, Math.floor(iw * 0.01)); // ignore specks smaller than ~1% wide
    // Find the median x-center of the opaque run on a single row in [x0,x1).
    // Returns null if no qualifying run exists.
    const rowCenter = (y, x0, x1) => {
      let rS = -1, rE = -1;
      for (let x = x0; x < x1; x++) {
        const a = data[(y * iw + x) * 4 + 3];
        if (a > 40) {
          if (rS < 0) rS = x;
          rE = x;
        }
      }
      if (rS < 0 || (rE - rS) < 1) return null;
      return (rS + rE) / 2;
    };
    const findTipInHalf = (x0, x1) => {
      const yStart = Math.floor(ih * 0.30);
      const yEnd = Math.floor(ih * 0.98);
      let tipY = -1;
      for (let y = yStart; y <= yEnd; y++) {
        let runStart = -1, runEnd = -1;
        for (let x = x0; x < x1; x++) {
          const a = data[(y * iw + x) * 4 + 3];
          if (a > 40) {
            if (runStart < 0) runStart = x;
            runEnd = x;
          }
        }
        if (runStart >= 0 && (runEnd - runStart) > MIN_RUN) {
          tipY = y;
          break;
        }
      }
      if (tipY < 0) return null;
      // Tip band: thin strip (1.5% of imgH) immediately below the first opaque
      // row; lock x onto the barrel's long axis.
      const tipBandH = Math.min(Math.floor(ih * 0.015), yEnd - tipY);
      const tipCenters = [];
      for (let y = tipY; y <= tipY + tipBandH; y++) {
        const c = rowCenter(y, x0, x1);
        if (c !== null) tipCenters.push(c);
      }
      if (tipCenters.length === 0) return null;
      tipCenters.sort((a, b) => a - b);
      const tipX = tipCenters[Math.floor(tipCenters.length / 2)];
      // Base band: thicker strip (2% of imgH) about 8% of imgH below the tip,
      // far enough down the painted barrel to capture its true slope without
      // hitting the cockpit-arm join.
      const baseY0 = Math.min(yEnd, tipY + Math.floor(ih * 0.07));
      const baseY1 = Math.min(yEnd, baseY0 + Math.floor(ih * 0.02));
      const baseCenters = [];
      for (let y = baseY0; y <= baseY1; y++) {
        const c = rowCenter(y, x0, x1);
        if (c !== null) baseCenters.push(c);
      }
      let bx = tipX, by = tipY + Math.floor(ih * 0.08);
      if (baseCenters.length > 0) {
        baseCenters.sort((a, b) => a - b);
        bx = baseCenters[Math.floor(baseCenters.length / 2)];
        by = (baseY0 + baseY1) / 2;
      }
      // Painted direction: from base up to tip (tip is "outward" along barrel).
      const dx = tipX - bx;
      const dy = tipY - by;
      const dlen = Math.hypot(dx, dy) || 1;
      return { x: tipX, y: tipY, bx: bx, by: by, dx: dx / dlen, dy: dy / dlen };
    };
    const halfW = Math.floor(iw / 2);
    const left = findTipInHalf(0, halfW);
    const right = findTipInHalf(halfW, iw);
    if (!left || !right) return null;
    return { imgW: iw, imgH: ih, left: left, right: right };
  } catch (e) {
    // CORS taint, decode failure, whatever: detection is best-effort.
    return null;
  }
}

// Translate an image-space (ix, iy) coord to screen coords assuming the PNG is
// displayed at background-size: cover on a W x H container (image scaled up to
// fully cover the element, aspect preserved, overflow cropped equally on both
// sides of the over-sized axis).
function frameImgToScreen(ix, iy, imgW, imgH, W, H) {
  if (!imgW || !imgH || !W || !H) return { x: 0, y: 0 };
  const scale = Math.max(W / imgW, H / imgH);
  const sw = imgW * scale, sh = imgH * scale;
  const ox = (sw - W) / 2, oy = (sh - H) / 2;
  return { x: ix * scale - ox, y: iy * scale - oy };
}

// (v17) Convert a screen-space pixel (as a 0..1 fraction of viewport
// width / height) to a world-space point at `fwdOff` units in front of
// the camera. Used to anchor first-person weapon tracers and beams to
// the PAINTED gun muzzle on the cockpit frame instead of to the camera
// origin (which sits inside the ship and reads as "the laser came from
// my eyeballs").
// Caller passes the muzzle's image coordinates as 0..1 fractions ; on a
// 16:9 viewport rendered at background-size: cover, those map roughly
// 1:1 to screen fractions for the central crop area. On non-16:9
// aspect ratios the painted muzzle drifts slightly relative to the
// computed world point, same as the existing two-muzzle TIP_FRAC system.
function _computeScreenMuzzleWorld(fracX, fracY, fwdOff) {
  if (typeof camera === 'undefined' || !player || !player.position) return null;
  fwdOff = (typeof fwdOff === 'number') ? fwdOff : 60;
  // (v17) Compose the directional shift applied to the gun-layer so the
  // computed muzzle world point tracks the visibly-shifted painted
  // muzzle. _overlayShift.{x,y} are viewport percents ; divide by 100
  // to convert into the same 0..1 fraction space as the muzzle frac.
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

// Per-ship painted-muzzle screen fractions for first-person main-weapon
// tracer origins. Keys are loadoutKey. Read directly off the gun_<SHIP>.png
// alpha pixels (topmost-leftmost opaque region of the cannon barrel).
// Ships not in this map fall back to the default behavior (origin =
// player.position) which is fine for ships whose tracers visually converge
// through the painted barrels of the older two-gun cockpits.
const _PLAYER_MAIN_MUZZLE_FRAC = {
  PUNCTURE: { x: 0.62, y: 0.60 }, // Sodium Railgun : single cannon, upper-right of frame
};

// (v17) Per-ship launcher fractions for ability / core PROJECTILE spawns.
// Read off missile_TRACKER.png : two pods, upper-left and upper-right, with
// barrel tips that project at the listed screen fractions. Used by Tracker
// Rockets ability and Mega Tracker Rockets core so the missiles visibly
// emerge from the painted launchers instead of from camera center.
const _PLAYER_LAUNCHER_FRACS = {
  TRACKER: [
    { x: 0.38, y: 0.29 },
    { x: 0.62, y: 0.29 },
  ],
  // Mega Barrage core (Puncture). Two side pods painted in core_PUNCTURE.png
  // at the upper-left and upper-right. Used for the per-tick rocket spawn.
  PUNCTURE: [
    { x: 0.37, y: 0.28 },
    { x: 0.64, y: 0.28 },
  ],
};


// ----- 8. Directional shift -----
// (v17) Directional shift state. The non-frame layers (#gun-layer +
// #ability-overlay-frame) translate opposite to the player's turn so the
// guns visually lag the cockpit. Both layers read the SAME _overlayShift
// state so they move in lockstep. Smoothed via spring-damp toward a
// target derived from the per-frame yaw / pitch delta.
//
// SHIFT_GAIN     : viewport-percent per rad/s of angular velocity.
// SHIFT_MAX      : ceiling (percent) so a fast spin doesn't push the layers
//                  fully off-screen.
// SHIFT_FOLLOW   : 0..1 lerp factor toward target each tick. Higher = snappier.
// SHIFT_DECAY    : 0..1 multiplier applied when there's no turn input ; the
//                  shift relaxes back to 0 over a few hundred ms.
const _overlayShift = {
  x: 0, y: 0,
  lastEulerX: 0, lastEulerY: 0,
  lastTime: 0,
  inited: false,
};
const SHIFT_GAIN   = 1.4;  // % per rad/s. ~1 rad/s flick produces ~1.4% shift.
const SHIFT_MAX    = 4.0;  // % cap.
const SHIFT_FOLLOW = 0.22;
const SHIFT_DECAY  = 0.88;
function _updateOverlayShift() {
  if (!player || !player.euler) return;
  const now = (typeof game !== 'undefined' && typeof game.time === 'number')
    ? game.time
    : (performance.now() / 1000);
  const ex = player.euler.x, ey = player.euler.y;
  if (!_overlayShift.inited) {
    _overlayShift.lastEulerX = ex;
    _overlayShift.lastEulerY = ey;
    _overlayShift.lastTime = now;
    _overlayShift.inited = true;
    return;
  }
  const dt = Math.max(0.001, now - _overlayShift.lastTime);
  let dEx = ex - _overlayShift.lastEulerX; // pitch delta
  let dEy = ey - _overlayShift.lastEulerY; // yaw delta
  // Wrap yaw across the +/-pi seam so a 359 -> 1 deg jump doesn't read as a
  // huge spin in the wrong direction.
  if (dEy >  Math.PI) dEy -= 2 * Math.PI;
  if (dEy < -Math.PI) dEy += 2 * Math.PI;
  _overlayShift.lastEulerX = ex;
  _overlayShift.lastEulerY = ey;
  _overlayShift.lastTime = now;
  const omegaY = dEy / dt; // yaw rate (rad/s)
  const omegaX = dEx / dt; // pitch rate
  // Opposite direction (negative). Yaw moves layer horizontally ; pitch moves it vertically.
  let targetX = -omegaY * SHIFT_GAIN;
  let targetY = -omegaX * SHIFT_GAIN;
  if (targetX >  SHIFT_MAX) targetX =  SHIFT_MAX;
  if (targetX < -SHIFT_MAX) targetX = -SHIFT_MAX;
  if (targetY >  SHIFT_MAX) targetY =  SHIFT_MAX;
  if (targetY < -SHIFT_MAX) targetY = -SHIFT_MAX;
  // Spring-damp toward target. When the player stops turning the target
  // collapses to 0 ; the decay keeps the recentering smooth instead of
  // snapping back the instant input ends.
  const tinyInput = Math.abs(omegaX) + Math.abs(omegaY) < 0.05;
  if (tinyInput) {
    _overlayShift.x *= SHIFT_DECAY;
    _overlayShift.y *= SHIFT_DECAY;
  } else {
    _overlayShift.x += (targetX - _overlayShift.x) * SHIFT_FOLLOW;
    _overlayShift.y += (targetY - _overlayShift.y) * SHIFT_FOLLOW;
  }
}


// ----- 9. Ship .glb loading -----
// GLTFLoader import (from module script):
//   import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
//   THREEx.GLTFLoader = GLTFLoader;

const SHIP_MODELS = {
  PUNCTURE: { url: 'ships/puncture.glb', faceRotY: -Math.PI / 2, scaleMult: 1.10 },
  SLAYER:   { url: 'ships/slayer.glb',   faceRotY: -Math.PI / 2, scaleMult: 1.10 },
  VORTEX:   { url: 'ships/vortex.glb',   faceRotY: -Math.PI / 2, scaleMult: 1.15 },
  TRACKER:  { url: 'ships/tracker.glb',  faceRotY: -Math.PI / 2, scaleMult: 1.00 },
  SYPHON:   { url: 'ships/syphon.glb',   faceRotY: -Math.PI / 2, scaleMult: 1.10 },
  PYRO:     { url: 'ships/pyro.glb',     faceRotY: -Math.PI / 2, scaleMult: 1.05 },
  BLASTER:  { url: 'ships/blaster.glb',  faceRotY: -Math.PI / 2, scaleMult: 1.05 },
};

const shipModelCache = { loaded: {}, ready: null };

function preloadShipModels() {
  if (shipModelCache.ready) return shipModelCache.ready;
  // (v17 -> webgpu) r170 ships GLTFLoader as a separate ESM export and
  // the THREE namespace is frozen, so we can't reattach it. Check window
  // first (where the webgpu host puts it) and fall back to the legacy
  // r128 location (THREE.GLTFLoader) for compat.
  const _GLClass = (typeof window !== 'undefined' && window.GLTFLoader)
    || (typeof THREE !== 'undefined' && THREE.GLTFLoader);
  if (!_GLClass) {
    console.warn('[ships] GLTFLoader unavailable; procedural fallback only.');
    shipModelCache.ready = Promise.resolve();
    return shipModelCache.ready;
  }
  const loader = new _GLClass();
  const jobs = Object.entries(SHIP_MODELS).map(([key, spec]) => new Promise(resolve => {
    loader.load(
      spec.url,
      gltf => {
        const proto = gltf.scene;
        // (v11b) Procedural micro-detail normal map. Gives the hull surface
        // panel-level relief so dynamic lights (explosion flashes, weapon
        // muzzle flashes, doomed-state red) actually catch on the body
        // instead of sliding off a uniformly smooth shader. Subtle scale.
        try { _applyProceduralShipNormalMap(proto); }
        catch (e) { console.warn('[ships] normal map apply failed:', e && e.message); }
        // faceRotY overrides; faceFlip kept as legacy alias.
        if (typeof spec.faceRotY === 'number') {
          proto.rotation.y = spec.faceRotY;
        } else if (spec.faceFlip) {
          proto.rotation.y = Math.PI;
        }
        // Fit to chassis hullLength (pre-bake scale; clones inherit it).
        const ld = LOADOUTS[key];
        const ch = ld ? CHASSIS[ld.chassis] : null;
        const targetLen = ch ? ch.hullLength : 100;
        const box = new THREE.Box3().setFromObject(proto);
        const sz = box.getSize(new THREE.Vector3());
        const longest = Math.max(sz.x, sz.y, sz.z) || 1;
        const baseScale = (targetLen / longest) * (spec.scaleMult || 1.0) * VISUAL_SCALE_BOOST;
        proto.scale.setScalar(baseScale);
        // Re-center on origin so plumes at +Z sit flush with tail.
        const box2 = new THREE.Box3().setFromObject(proto);
        const center = box2.getCenter(new THREE.Vector3());
        proto.position.sub(center);
        proto.userData.bboxSize = box2.getSize(new THREE.Vector3());
        shipModelCache.loaded[key] = proto;
        resolve();
      },
      undefined,
      err => {
        console.warn('[ships] failed to load', spec.url, err && err.message ? err.message : err);
        resolve();
      }
    );
  }));
  shipModelCache.ready = Promise.all(jobs).then(() => {
    const n = Object.keys(shipModelCache.loaded).length;
    console.log('[ships] loaded', n, 'of', Object.keys(SHIP_MODELS).length, 'models');
  });
  return shipModelCache.ready;
}

// Kick off the preload as soon as this script runs; by the time the player
// picks a loadout, models are almost certainly ready.
preloadShipModels();

// (v9b) Bake the ship-select strip thumbnails as soon as GLBs land. The
// promise's .then runs once all model fetches are settled. bakeShipThumbnails
// is idempotent so a stray manual call later is harmless.
if (shipModelCache.ready && typeof shipModelCache.ready.then === 'function') {
  shipModelCache.ready.then(() => {
    try { if (typeof bakeShipThumbnails === 'function') bakeShipThumbnails(); } catch (_) {}
  });
}

// If a ship was built before its model finished loading (procedural fallback),
// call this with the owner (player / bot / network player) to swap in the model
// mesh once the cache is ready. The owner must have .mesh, .chassis, .loadoutKey.
function swapToModelMeshWhenReady(owner, teamColor) {
  if (!shipModelCache.ready) return;
  if (!owner) return;
  // Per-owner generation token: each call bumps the counter and captures the
  // captured key/team at call time. If a later swap is queued (respawn, loadout
  // swap, team change) before the promise resolves, the stale callback will see
  // a mismatch and bail. Prevents ghost meshes and wrong-color/wrong-key swaps
  // when the owner mutates between issue and fulfillment.
  const gen = (owner._swapGen || 0) + 1;
  owner._swapGen = gen;
  const capturedKey = owner.loadoutKey;
  const capturedTeam = teamColor;
  shipModelCache.ready.then(() => {
    if (!owner || owner._swapGen !== gen) return;
    // Player uses shipState; bots/network use .alive. Accept either "alive" signal.
    const isDead = (owner.alive === false) || (owner.shipState === 'dead');
    if (isDead) return;
    if (!owner.mesh || (owner.mesh.userData && owner.mesh.userData.isModelShip)) return;
    // Key/team must still match what we were issued with; if not, a newer swap
    // will take over (owner._swapGen would have been bumped).
    if (owner.loadoutKey !== capturedKey) return;
    if (!capturedKey || !shipModelCache.loaded[capturedKey]) return;
    // Preserve position, quaternion, visibility, and the .bot backreference.
    const oldMesh = owner.mesh;
    const pos = oldMesh.position.clone();
    const quat = oldMesh.quaternion.clone();
    const visible = oldMesh.visible;
    const botRef = oldMesh.userData && oldMesh.userData.bot;
    if (oldMesh.parent) oldMesh.parent.remove(oldMesh);
    owner.mesh = createShipMesh(owner.chassis, capturedTeam, capturedKey);
    owner.mesh.position.copy(pos);
    owner.mesh.quaternion.copy(quat);
    owner.mesh.visible = visible;
    if (botRef) owner.mesh.userData.bot = botRef;
    scene.add(owner.mesh);
  });
}

function createShipMesh(chassisData, teamColor, loadoutKey) {
  // Model-backed path: if the cache has a preloaded glTF for this loadout,
  // build the mesh from it. Otherwise, fall through to the procedural path.
  if (loadoutKey && shipModelCache.loaded[loadoutKey]) {
    return buildModelShipMesh(chassisData, teamColor, loadoutKey);
  }
  // (v17 -> webgpu) Procedural fallback. The full v17 procedural ship is a
  // ~400-line Group of plated hulls, dark accent, cockpit canopy, engine
  // discs, plume cones, panel-glow strips, etc. Until the GLB cache lands,
  // we just need a visible placeholder so the owner has a non-undefined mesh
  // with the userData fields animateShipMesh reads. swapToModelMeshWhenReady
  // will replace it the moment the GLB clone is ready.
  const group = new THREE.Group();
  const w = chassisData.hullWidth * 0.5;
  const h = chassisData.hullHeight * 0.5;
  const l = chassisData.hullLength * 0.5;
  const teamCol = new THREE.Color(teamColor || 0x88aaff);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x444a55, metalness: 0.4, roughness: 0.55,
    emissive: teamCol.clone().multiplyScalar(0.06), emissiveIntensity: 1.0,
  });
  const hullGeo = new THREE.BoxGeometry(chassisData.hullWidth, chassisData.hullHeight, chassisData.hullLength);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  group.add(hull);

  const engineGlowMat = new THREE.MeshBasicMaterial({
    color: teamColor || 0xffaa55, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const plumeMat = new THREE.MeshBasicMaterial({
    color: teamCol.clone().lerp(new THREE.Color(0xffffff), 0.35),
    transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(h * 0.45, 16), engineGlowMat);
  glow.position.set(0, 0, l);
  group.add(glow);
  const plumeGeo = new THREE.ConeGeometry(h * 0.55, l * 1.8, 12, 1, true);
  plumeGeo.rotateX(Math.PI / 2);
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  plume.position.set(0, 0, l + l * 0.9);
  plume.userData.isPlume = true;
  plume.userData.basePlumeLength = l * 1.8;
  plume.userData.basePlumeOpacity = plumeMat.opacity;
  group.add(plume);

  const shieldGeo = new THREE.SphereGeometry(Math.max(w, l) * 2, 24, 16);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0xaaccff, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.name = 'shield';
  group.add(shield);

  group.userData = {
    isModelShip: false,
    loadoutKey: loadoutKey,
    engineMesh: glow,
    shieldMesh: shield,
    engineGlows: [glow],
    enginePlumes: [plume],
    barrelMeshes: [],
    panelGlowMat: engineGlowMat,
    engineGlowMat: engineGlowMat,
    hullMats: [hullMat],
    shaderEngineMats: [],
  };
  return group;
}

// (v9b) Ship-thumbnail bake. Renders each loaded GLB ship to a small
// canvas at boot, captures the data URL, caches it keyed by loadoutKey.
// Used by the redesigned teammates / fleet strip to show a 3D-render
// thumbnail in each chip instead of a text label. The bake runs once
// (idempotent), with its own offscreen renderer so it doesn't fight the
// preview pane's renderer for context. Result: 7 PNG-ish thumbs, ~5KB
// each, embedded directly in chip <img> elements via data URL.
const _shipThumbCache = {};            // loadoutKey -> data URL
let _shipThumbsBaked = false;
function bakeShipThumbnails() {
  if (_shipThumbsBaked) return;
  if (typeof THREE === 'undefined') return;
  // (v17 -> webgpu) The thumbnail bake uses THREE.WebGLRenderer for an
  // offscreen capture. The three.webgpu.js bundle drops WebGLRenderer to
  // save weight ; skip silently when it's absent. Phase 8 (lobby) will
  // reintroduce thumbnails via WebGPURenderer.
  if (typeof THREE.WebGLRenderer !== 'function') {
    _shipThumbsBaked = true; // mark done so we don't retry
    return;
  }
  if (!shipModelCache || !shipModelCache.loaded) return;
  const keys = Object.keys(shipModelCache.loaded);
  if (keys.length === 0) return;       // models not preloaded yet ; caller retries
  const W = 256, H = 192;
  let renderer = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true,
      preserveDrawingBuffer: true,    // toDataURL needs the framebuffer kept
      powerPreference: 'low-power',   // tiny renders ; don't fight the dGPU
    });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    if (typeof sceneEnvMap !== 'undefined') scene.environment = sceneEnvMap;
    scene.add(new THREE.AmbientLight(0xffffff, 0.30));
    const keyL = new THREE.DirectionalLight(0xbfd9ff, 0.70); keyL.position.set(180, 240, 160); scene.add(keyL);
    const fillL = new THREE.DirectionalLight(0xffb066, 0.32); fillL.position.set(-140, -80, -200); scene.add(fillL);
    const rimL = new THREE.DirectionalLight(0xffaa00, 0.20); rimL.position.set(0, 120, -260); scene.add(rimL);
    const cam = new THREE.PerspectiveCamera(32, W / H, 1, 8000);
    cam.position.set(0, 70, 320);
    cam.lookAt(0, 0, 0);
    for (const key of keys) {
      const proto = shipModelCache.loaded[key];
      if (!proto) continue;
      const model = proto.clone(true);
      // Hero angle: turned 30 degrees so we see a 3/4 hull instead of square broadside.
      model.rotation.y = -Math.PI * 0.20;
      // Auto-fit: scale so longest model axis = 180 world units (roughly fits cam frustum).
      const bbox = new THREE.Box3().setFromObject(model);
      const dx = bbox.max.x - bbox.min.x;
      const dy = bbox.max.y - bbox.min.y;
      const dz = bbox.max.z - bbox.min.z;
      const longest = Math.max(dx, dy, dz);
      const targetLen = 180;
      if (longest > 0) model.scale.setScalar(targetLen / longest);
      // Re-center after scale.
      const bbox2 = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      bbox2.getCenter(center);
      model.position.sub(center);
      scene.add(model);
      try {
        renderer.render(scene, cam);
        _shipThumbCache[key] = canvas.toDataURL('image/png');
      } catch (e) {
        console.warn('[v9b] thumb bake failed for', key, e && e.message);
      }
      scene.remove(model);
      // Dispose clone meshes/materials so we don't leak.
      model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry && child.geometry.dispose) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) { if (m && m.dispose) m.dispose(); }
          }
        }
      });
    }
    _shipThumbsBaked = true;
    // Refresh the strip if it's already up so the fresh thumbs appear without
    // waiting for the next selectLoadout / commitLoadout call.
    try { if (typeof updateTeammatesStrip === 'function') updateTeammatesStrip(); } catch (_) {}
  } catch (e) {
    console.warn('[v9b] ship-thumbnail bake init failed:', e && e.message);
  } finally {
    if (renderer) {
      try { renderer.dispose(); } catch (_) {}
    }
  }
}


// ----- 10. Ship mesh animation -----
function animateShipMesh(mesh, speed, maxSpeed, isFiring, dt, doomed) {
  if (!mesh || !mesh.userData) return;
  const t = Math.min(1, speed / maxSpeed);
  const time = game.time;
  // Distance-based outline culling: WebGL can't widen GL_LINES, so for distant
  // ships the outline chatter isn't useful. We keep the outline opaque (avoids
  // transparent-queue sort issues that stacked far-side edges onto near-side
  // hull, reading as "all black") and simply hide it past ~2200 u. Distant
  // ships still read via plume + fresnel rim.
  if (mesh.userData.outlineMat && camera) {
    const camPos = camera.position;
    const dx = mesh.position.x - camPos.x;
    const dy = mesh.position.y - camPos.y;
    const dz = mesh.position.z - camPos.z;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    mesh.userData.outlineMat.visible = (d < 2200);
  }
  // Doomed-state hull darkening: ONLY when the ship is doomed we pull hull
  // emissive + color toward black, so the silhouette reads as "executable." In
  // normal play the hull stays at full brightness. Applied per-frame with a
  // smooth lerp so the transition into/out of doomed is cinematic (about 0.5 s
  // to fully dim at 60 fps). Shield/cockpit/plume stay bright so they catch
  // bloom and the outline of the doomed ship stays legible against fog.
  function dimHullMat(hullM, dim) {
    if (hullM.userData._baseHullColor === undefined) {
      hullM.userData._baseHullColor = hullM.color.clone();
      hullM.userData._baseEmissiveI = hullM.emissiveIntensity;
    }
    hullM.color.copy(hullM.userData._baseHullColor).multiplyScalar(dim);
    hullM.emissiveIntensity = hullM.userData._baseEmissiveI * dim;
  }
  const targetDim = doomed ? 0.25 : 1.0;
  const prevDim = mesh.userData._dimAmount === undefined ? 1.0 : mesh.userData._dimAmount;
  const nextDim = prevDim + (targetDim - prevDim) * 0.08;
  mesh.userData._dimAmount = nextDim;
  if (mesh.userData.hullMat) dimHullMat(mesh.userData.hullMat, nextDim);
  if (mesh.userData.hullMats) {
    for (const hm of mesh.userData.hullMats) dimHullMat(hm, nextDim);
  }
  // (v9) Running-light bob. The half-red/half-green tail ball gets a tiny
  // vertical wobble so it reads as floating.
  // (v11b) Doomed-state visual moved here from the separate red halo
  // sphere (retired). Both port + starboard meshes flash bright red on a
  // 1.5 Hz heartbeat envelope while doomed, so the ship's existing nav
  // light becomes the "executable target" tell instead of adding a second
  // sphere around the hull.
  const rl = mesh.userData.runningLight;
  if (rl) {
    const bobBaseY = (rl.userData && rl.userData.baseY != null) ? rl.userData.baseY : rl.position.y;
    rl.position.y = bobBaseY + Math.sin(time * Math.PI) * 0.6;  // 0.5 Hz bob, +/- 0.6 unit
    const portM = mesh.userData.runningLightPortMat;
    const starM = mesh.userData.runningLightStarMat;
    if (portM && starM) {
      // Cache the saturated nav-light hex (red port, green starboard) so
      // the non-doomed branch can restore it after a flash cycle.
      if (!portM.userData._baseHex) portM.userData._baseHex = portM.color.getHex();
      if (!starM.userData._baseHex) starM.userData._baseHex = starM.color.getHex();
      if (doomed) {
        // Heartbeat-pulsed red flash on BOTH halves while doomed. Two-beat
        // envelope: a lub-dub cycle each second-and-change so the ship
        // reads as "running on its last heartbeats" from any angle. The
        // flash overrides the team-color dim treatment that was here in
        // v11a ; doomed ships now light up brighter, not darker.
        const phase = (time * 1.5) % 1;
        const lub = Math.exp(-Math.pow((phase - 0.20) * 5.0, 2));
        const dub = Math.exp(-Math.pow((phase - 0.45) * 5.5, 2)) * 0.55;
        // Brightness ramp 0.4..2.0 ; values >1 push the bloom pass so the
        // peaks bloom out into a halo (recovers some of what the retired
        // doomed-sphere did, without the second mesh).
        const beat = 0.4 + (lub + dub) * 1.6;
        portM.color.setRGB(beat, 0.04, 0.04);
        starM.color.setRGB(beat, 0.04, 0.04);
        portM.userData._rlAlpha = 1.0;
        starM.userData._rlAlpha = 1.0;
      } else {
        // Healthy path: port stays saturated red, starboard saturated
        // green at full alpha. Lerp back smoothly from any prior dim /
        // doomed-flash so we don't pop on respawn.
        const prev = (portM.userData._rlAlpha != null) ? portM.userData._rlAlpha : 1.0;
        const next = prev + (1.0 - prev) * 0.08;
        portM.userData._rlAlpha = next; starM.userData._rlAlpha = next;
        portM.color.setHex(portM.userData._baseHex).multiplyScalar(next);
        starM.color.setHex(starM.userData._baseHex).multiplyScalar(next);
      }
    }
  }
  // (v11b) Doomed-state red sphere halo (added v11) was retired ; the
  // running-light heartbeat flash above carries the doomed tell. Any
  // pre-existing halo mesh from a saved state gets removed here so legacy
  // builds don't leave a stale sphere on the hull.
  if (mesh.userData.doomedHalo) {
    const oldHalo = mesh.userData.doomedHalo;
    if (oldHalo.parent) oldHalo.parent.remove(oldHalo);
    if (oldHalo.geometry) oldHalo.geometry.dispose();
    if (oldHalo.material) oldHalo.material.dispose();
    mesh.userData.doomedHalo = null;
  }

  // Cockpit heartbeat: slow 1 Hz emissive modulation (+/- 10%) so idle ships read as alive.
  // Speeds up toward ~1.6 Hz at full throttle so the pulse tracks energy output.
  if (mesh.userData.cockpitMat) {
    const base = mesh.userData.cockpitBaseEmissiveIntensity || 1.4;
    const hbFreq = 1.0 + t * 0.6; // 1 Hz idle, ~1.6 Hz flat-out
    // Double-beat heartbeat shape: systole then diastole (lub-dub)
    const phase = time * hbFreq * Math.PI * 2;
    const lub = Math.exp(-Math.pow(((phase % (Math.PI * 2)) - 0.5) * 2.0, 2));
    const dub = Math.exp(-Math.pow(((phase % (Math.PI * 2)) - 1.3) * 2.5, 2)) * 0.6;
    const pulse = (lub + dub) * 0.10; // +/-10% of base
    mesh.userData.cockpitMat.emissiveIntensity = base * (1 + pulse - 0.05);
  }
  // Engines: drive shader uniforms (or opacity for legacy basic mat) plus
  // scale with speed. (v14c) LayeredFX path uses uIntensity to scale
  // animation tempo (replaces bespoke uThrottle) ; uTime is auto-ticked
  // by _layeredFXTick so no time write needed here. Legacy fallback path
  // mutates material.opacity directly.
  if (mesh.userData.engineGlows) {
    for (const glow of mesh.userData.engineGlows) {
      if (glow.material && glow.material.uniforms) {
        if (glow.material.uniforms.uIntensity) {
          // Smooth intensity write so the disc doesn't snap when t jitters.
          // 0.5..1.5 range so idle reads dim and full throttle reads vivid.
          const prev = glow.material.uniforms.uIntensity.value;
          const target = 0.5 + t * 1.0;
          glow.material.uniforms.uIntensity.value = prev + (target - prev) * 0.15;
        }
      } else if (glow.material && typeof glow.material.opacity === 'number') {
        const baseOp = 0.45 + t * 0.55;
        const pulse = Math.sin(time * 12 + Math.random() * 0.1) * 0.08 * t;
        glow.material.opacity = baseOp + pulse;
      }
      const baseScale = 0.7 + t * 0.9;
      const flicker = 1 + Math.sin(time * 18) * 0.05 * t;
      glow.scale.setScalar(baseScale * flicker);
    }
  }
  // Engine plumes: stretch length & flare with throttle for cinematic thrust.
  // Strong thrust-modulation: idle plumes nearly vanish, full-throttle plumes double length
  // and pick up a hot-white tint; animateShipMesh already knows speed so no extra state needed.
  if (mesh.userData.enginePlumes) {
    for (const plume of mesh.userData.enginePlumes) {
      const flicker = 1 + Math.sin(time * 22 + plume.position.x * 0.5) * 0.12;
      const opCurve = Math.max(0, t * t * 1.15 + (t > 0.02 ? 0.05 : 0));
      if (plume.material && plume.material.uniforms) {
        // (v14c) LayeredFX plume: drive uIntensity (replaces bespoke
        // uThrottle). The opCurve and flicker still feed in so the
        // perceived brightness matches the legacy path. uTime is
        // auto-ticked by _layeredFXTick.
        if (plume.material.uniforms.uIntensity) {
          const prev = plume.material.uniforms.uIntensity.value;
          const target = Math.min(1.5, opCurve * flicker * 1.5);
          plume.material.uniforms.uIntensity.value = prev + (target - prev) * 0.15;
        }
      } else if (plume.material && typeof plume.material.opacity === 'number') {
        const baseOp = (plume.userData.basePlumeOpacity || 0.55);
        plume.material.opacity = (opCurve * baseOp) * flicker;
      }
      // Stretch along Z with wider dynamic range: 0.22 at rest, up to 2.2 at full throttle.
      const lenScale = 0.22 + t * 2.0 + Math.sin(time * 26) * 0.05 * t;
      const radScale = 0.65 + t * 0.5 + Math.sin(time * 16) * 0.07 * t;
      plume.scale.set(radScale, radScale, lenScale);
      // Hot-white tint at high throttle (legacy basic-material path only --
      // the shader plume mixes hot white internally via the coreHot factor).
      if (plume.material && plume.material.color) {
        if (plume.userData.basePlumeColor === undefined) {
          plume.userData.basePlumeColor = plume.material.color.clone();
        }
        const heat = Math.min(1, Math.max(0, (t - 0.5) * 2.0));
        plume.material.color.copy(plume.userData.basePlumeColor).lerp(new THREE.Color(0xffffff), heat * 0.55);
      }
      // Heat-haze billboard removed in webgpu port (Sprite + getHeatHazeSpriteMat
      // depend on bespoke ShaderMaterials we have not ported yet ; plume scale
      // already conveys thrust).
      // (bugfix 2026-05-20 #309) Particle-stream layer on top of the cone
      // so the plume reads as "spewing exhaust" instead of a static neon
      // cone. Rate scales with throttle ; idle plumes emit zero, full
      // throttle emits ~14 per second per plume.
      // (bugfix 2026-05-20 #315) Wrap the spawn in try/catch + parent
      // chain guard. Without this, plumeless / detached / mid-rebuild
      // ships could throw during plume.getWorldPosition() and animate-
      // ShipMesh would bail mid-loop ; webGPU.html catches the throw
      // silently so the player ship visibly stops animating ("ship
      // froze, game continued").
      try {
        if (plume && plume.parent && mesh && mesh.quaternion &&
            window.game && window.game.particles && t > 0.05 &&
            Math.random() < t * 0.30) {
          const _plumeWorldPos = (plume.userData._tmpWorld = plume.userData._tmpWorld || new THREE.Vector3());
          plume.getWorldPosition(_plumeWorldPos);
          const _shipFwd = (mesh.userData._tmpFwd = mesh.userData._tmpFwd || new THREE.Vector3());
          _shipFwd.set(0, 0, 1).applyQuaternion(mesh.quaternion);
          const backLen = (plume.userData.basePlumeLength || 30) * 0.45;
          const px = _plumeWorldPos.x + _shipFwd.x * backLen + (Math.random() - 0.5) * 1.5;
          const py = _plumeWorldPos.y + _shipFwd.y * backLen + (Math.random() - 0.5) * 1.5;
          const pz = _plumeWorldPos.z + _shipFwd.z * backLen + (Math.random() - 0.5) * 1.5;
          const sp = (mesh.userData._lastShipSpeed || 0);
          const vx = _shipFwd.x * (60 + sp * 0.4) + (Math.random() - 0.5) * 20;
          const vy = _shipFwd.y * (60 + sp * 0.4) + (Math.random() - 0.5) * 20;
          const vz = _shipFwd.z * (60 + sp * 0.4) + (Math.random() - 0.5) * 20;
          const baseCol = (plume.userData.basePlumeColor && plume.userData.basePlumeColor.getHex)
            ? plume.userData.basePlumeColor.getHex() : 0xffaa55;
          window.game.particles.push({
            position: { x: px, y: py, z: pz },
            velocity: { x: vx, y: vy, z: vz },
            life: 0.35 + t * 0.30,
            maxLife: 0.65,
            color: baseCol,
            size: 2.2 + t * 1.6,
          });
        }
      } catch (_) { /* skip emit this frame ; never break animateShipMesh */ }
    }
  }
  // (bugfix 2026-05-20 #309) Cache speed on the mesh so the plume
  // particle emitter above can use it without re-reading the player
  // object every frame. Falls back to 0 ; we don't strictly need this
  // for correctness but it keeps the inner loop branch-free.
  mesh.userData._lastShipSpeed = speed;
  // Barrel recoil decay (procedural ships only ; GLB models have empty barrels).
  if (mesh.userData.barrelMeshes && mesh.userData.barrelMeshes.length) {
    for (const b of mesh.userData.barrelMeshes) {
      if (b.userData && typeof b.userData.recoilZ === "number") {
        b.userData.recoilZ *= 0.85;
        if (Math.abs(b.userData.recoilZ) < 0.001) b.userData.recoilZ = 0;
        b.position.z = (b.userData.baseZ || 0) + b.userData.recoilZ;
      }
    }
  }
}
// Expose to global scope for non-module callers.
try { window.animateShipMesh = animateShipMesh; } catch (_) {}
try { window.createShipMesh = createShipMesh; } catch (_) {}
try { window.swapToModelMeshWhenReady = swapToModelMeshWhenReady; } catch (_) {}
