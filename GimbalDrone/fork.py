#!/usr/bin/env python3
"""fork.py - make the Gimbal Drone copy of Last Ship Sailing.

    python GimbalDrone/fork.py          # from the repo root, then: python GimbalDrone/build.py

Reads LSS/index-working.html (READ-ONLY: LSS is never written) and writes
GimbalDrone/index-working.html: the same engine with a handful of small,
anchored hooks that hand flight, hulls and gimbal animation to the drone mod.

Where the mod actually lives:
  gd_physics.js   the physics + flight controller (pure, no THREE, tested by check_physics.mjs)
  gd_mod.js       the game side: procedural drone hulls, the flight hook, gimbal animation, HUD
  this file       only the seams: every hook below is one or two lines in the copied engine

Each patch is anchored on an exact string that must occur EXACTLY ONCE in the
source. If LSS moves on and an anchor changes, this script stops and names the
anchor instead of producing a half-patched copy. That is what makes re-running
it safe: pull the latest LSS into the drone game by running it again.

    WARNING: re-running overwrites GimbalDrone/index-working.html. Edit that file
    directly if you like (it is the copy to mod), but then either stop using
    fork.py or move your edit into a patch below / into gd_mod.js.

Every hook is tagged `(GD)` in the generated source, so `grep -n "(GD)"` lists them.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "LSS", "index-working.html")
DST = os.path.join(ROOT, "GimbalDrone", "index-working.html")

PATCHES = []
def patch(name, anchor, replacement):
    PATCHES.append((name, anchor, replacement))

# ---------------------------------------------------------------------------------------------
# 1. HEAD: assets come from ../LSS/, storage is namespaced, the mod scripts load first.
patch("head: base href + storage namespace + mod scripts",
'<meta charset="UTF-8">\n',
'''<meta charset="UTF-8">
<!-- (GD) GIMBAL DRONE is a COPY of Last Ship Sailing that lives beside it in GimbalDrone/. Every
     relative asset URL in the engine (skyboxes, textures, music, maps, effects...) is written for
     the LSS site root, so this one element points them all at ../LSS/ instead of duplicating
     ~500 MB of art. LSS itself is only ever READ. The copy's own scripts therefore have to be
     addressed as ../GimbalDrone/<file> (relative to the base, not to this page). -->
<base href="../LSS/">
<script>
// (GD) SAME ORIGIN, SEPARATE SAVES. Served from the same host as LSS, this copy would otherwise read
// and WRITE the LSS saves (settings, loadouts, keybinds, campaign progress). The engine only ever
// touches localStorage through getItem / setItem / removeItem (checked when the copy was made: 140
// call sites, no clear(), no enumeration), so prefixing those three on window.localStorage gives the
// copy its own namespace ("gd:...") and leaves every LSS key exactly as it was.
(function () {
  try {
    var ls = window.localStorage, P = 'gd:', S = Storage.prototype;
    var g = S.getItem, s = S.setItem, r = S.removeItem;
    S.getItem = function (k) { return g.call(this, this === ls ? P + k : k); };
    S.setItem = function (k, v) { return s.call(this, this === ls ? P + k : k, v); };
    S.removeItem = function (k) { return r.call(this, this === ls ? P + k : k); };
  } catch (_) {}
})();
</script>
<script src="../GimbalDrone/gd_physics.js"></script>
<script src="../GimbalDrone/gd_mod.js"></script>
<style>
/* (GD) Menu entries that only work against the LSS backend (Discord sign-in, stats, the LSS
   leaderboard and live-room pages) are hidden in the copy: the backend is unreachable on purpose.
   Room codes still work: multiplayer is peer-to-peer and only the app id changed. */
#discord-identity, #lobby-stats-btn, a[href="leaderboard.html"], a[href="rooms.html"] { display: none !important; }
/* (GD) LSS's lobby art is a painting of an LSS ship. gd_mod.js renders a gimbal drone into LSS's
   ship-free hangar art and publishes it as --gd-hero; until then the bare hangar shows. A stylesheet
   !important is needed because the lobby script rewrites the inline background on load and rotate. */
#lobby-bg { background-image: var(--gd-hero, url('hangar.webp')) !important; background-position: center !important; }
#lobby-bg.portrait-fallback { filter: none !important; transform: none !important; }
</style>
''')
patch("head: title", "<title>Last Ship Sailing</title>", "<title>Gimbal Drone</title>")
patch("head: app name", '<meta name="application-name" content="Last Ship Sailing">',
      '<meta name="application-name" content="Gimbal Drone">')
patch("head: web manifest name",
      '"name":"Last%20Ship%20Sailing%20v35.18","short_name":"LSS%20v35.18","description":"Zero-gravity%20ship%20combat%2C%20WebXR-capable."',
      '"name":"Gimbal%20Drone","short_name":"Gimbal%20Drone","description":"Gimbal%20drone%20flight%20sim%20on%20the%20LSS%20engine%2C%20WebXR-capable."')

# ---------------------------------------------------------------------------------------------
# 2. ISOLATION: never talk to LSS's backend, Discord relay or P2P rooms.
patch("isolate: backend API",
"  const prod = 'https://lss-backend.ashroney.workers.dev';",
"  // (GD) The copy must never post matches to the LSS leaderboards, appear in its lobby browser,\n"
"  // overwrite a pilot's synced LSS account state or open its shop. `.invalid` is reserved and can\n"
"  // never resolve (RFC 2606), so every call fails fast into the engine's existing offline path.\n"
"  const prod = 'https://gimbal-drone-offline.invalid';")
patch("isolate: Discord relay",
"  WORKER_BASE_URL: 'https://lss-discord-proxy.ashroney.workers.dev',",
"  WORKER_BASE_URL: 'https://gimbal-drone-discord.invalid',   // (GD) never relay into the LSS Discord")
patch("isolate: lobby room",
"const LOBBY_P2P_ROOM_ID = 'LSS_LOBBY_GLOBAL_v1';",
"const LOBBY_P2P_ROOM_ID = 'GIMBAL_DRONE_LOBBY_v1';   // (GD) drone pilots only meet drone pilots")
patch("isolate: lobby app id",
"const LOBBY_P2P_APP_ID  = 'last-ship-sailing';",
"const LOBBY_P2P_APP_ID  = 'gimbal-drone-sim';         // (GD)")
patch("isolate: match app id",
"    const _joinCfg = { appId: 'last-ship-sailing-v1' };",
"    const _joinCfg = { appId: 'gimbal-drone-sim-v1' };   // (GD) separate match rooms from LSS")

# ---------------------------------------------------------------------------------------------
# 3. BUILD STAMP + hand the mod its view of the engine (lazy getters: no TDZ at install time).
patch("build stamp + mod install",
'const LSS_BUILD = "50.91";\n',
'''const LSS_BUILD = "50.91";
// (GD) The drone copy's own version. LSS_BUILD above stays the engine it was forked from (it also
// stamps shared LSS asset URLs, so leaving it alone keeps the browser cache shared with LSS);
// GimbalDrone/build.py stamps gd.js?v= with GD_BUILD instead. Bump it on every drone build.
const GD_BUILD = "1.00";
try { window.GD_BUILD = GD_BUILD; } catch (_) {}
// (GD) The engine is one closure, so the mod gets a window into it. GETTERS, not values: most of
// these consts are declared far below this line, and a getter is only evaluated when the mod uses
// it (always after boot), which keeps every one of them out of its temporal dead zone.
try {
  if (window.GDMod) window.GDMod.install({
    get THREE() { return THREE; },
    get player() { return player; }, get input() { return input; }, get game() { return game; },
    get camera() { return camera; }, get scene() { return scene; }, get LSS() { return LSS; },
    get LOADOUTS() { return LOADOUTS; }, get CHASSIS() { return CHASSIS; },
    get SHIP_MODELS() { return SHIP_MODELS; }, get shipModelCache() { return shipModelCache; },
    get VISUAL_SCALE_BOOST() { return VISUAL_SCALE_BOOST; },
    get renderer() { return renderer; },
    get xrDolly() { return xrDolly; },
    isXR() { try { return (typeof isXRPresenting === 'function') && isXRPresenting(); } catch (_) { return false; } },
  });
} catch (e) { console.error('[GD] mod install failed:', e); }
''')

# ---------------------------------------------------------------------------------------------
# 4. HULLS: every ship (the 7 chassis + the 21 campaign hoard hulls) is a procedural gimbal drone.
patch("hulls: procedural drones instead of GLB ships",
"function preloadShipModels() {\n  if (shipModelCache.ready) return shipModelCache.ready;\n",
"function preloadShipModels() {\n  if (shipModelCache.ready) return shipModelCache.ready;\n"
"  // (GD) Every hull is a procedural gimbal drone built in gd_mod.js, fitted to the same chassis\n"
"  // hullLength the GLB would have been. Nothing is downloaded.\n"
"  if (window.GDMod) { shipModelCache.ready = window.GDMod.preloadShips(); return shipModelCache.ready; }\n")
patch("hulls: campaign hoard ships are drones too",
"function loadHoardModel(key) {\n  if (shipModelCache.loaded[key]) return Promise.resolve(shipModelCache.loaded[key]);\n",
"function loadHoardModel(key) {\n  if (shipModelCache.loaded[key]) return Promise.resolve(shipModelCache.loaded[key]);\n"
"  if (window.GDMod) return Promise.resolve(window.GDMod.hoardProto(key));   // (GD) a drone per hoard key\n")
patch("hulls: preloader skips the ship GLB sets",
"        .filter((e) => !(e.g === 'ships' || e.g === 'ships_m') || e.g === _shipGroup);",
"        .filter((e) => !(e.g === 'ships' || e.g === 'ships_m') || (!window.GDMod && e.g === _shipGroup));   // (GD) no hull GLBs: 37-54 MB never fetched")
patch("hulls: keep the drone's glow/exhaust materials",
"  model.traverse(child => {\n    if (child.isMesh) {\n      const mats = Array.isArray(child.material) ? child.material : [child.material];\n      const newMats = mats.map(m => {\n",
"  model.traverse(child => {\n    if (child.isMesh) {\n"
"      // (GD) The drone's exhaust jets and emissive bits are not hull paint: the rebuild below would turn\n"
"      // an additive plume into a lit, opaque-ish standard material. Give them their own clone and move on.\n"
"      if (child.userData && child.userData.gdKeepMat) {\n"
"        child.material = Array.isArray(child.material) ? child.material.map(mm => mm.clone()) : child.material.clone();\n"
"        child.userData._sharedGLBGeo = true; child.castShadow = false; child.receiveShadow = false;\n"
"        return;\n"
"      }\n"
"      const mats = Array.isArray(child.material) ? child.material : [child.material];\n      const newMats = mats.map(m => {\n")
patch("hulls: wire each built drone's gimbal rig",
"  try { _applyShipSkin(group, skinId, trim); } catch (_) {}   // (v50.82) + the secondary skin\n  return group;\n}",
"  try { _applyShipSkin(group, skinId, trim); } catch (_) {}   // (v50.82) + the secondary skin\n"
"  if (window.GDMod) window.GDMod.attachRig(group, loadoutKey);   // (GD) find the rings + jets for animateShipMesh\n"
"  return group;\n}")

# ---------------------------------------------------------------------------------------------
# 5. GIMBALS MOVE on every drone on screen (player, bots, peers, replays), every frame.
patch("animate: gimbals on every drone",
"function animateShipMesh(mesh, speed, maxSpeed, isFiring, dt, doomed) {\n  if (!mesh || !mesh.userData) return;\n",
"function animateShipMesh(mesh, speed, maxSpeed, isFiring, dt, doomed) {\n  if (!mesh || !mesh.userData) return;\n"
"  if (mesh.userData.gdRig && window.GDMod) window.GDMod.animate(mesh, dt, doomed);   // (GD)\n")

# ---------------------------------------------------------------------------------------------
# 6. FLIGHT: the inputs still build LSS's velocity target, the drone decides how to get there.
patch("flight: mode-dependent movement basis",
"  const up = _mvUpCam.set(0, 1, 0).applyQuaternion(camera.quaternion);\n",
"  const up = _mvUpCam.set(0, 1, 0).applyQuaternion(camera.quaternion);\n"
"  // (GD) HOVER and QUAD fly the pilot's HEADING: forward and strafe stay horizontal and up is world up,\n"
"  // whatever the camera's pitch. 6DOF keeps the camera basis above (forward = where you look).\n"
"  if (window.GDMod) window.GDMod.moveBasis(forward, right, up);\n")
patch("flight: physics replaces the velocity-target block",
"""  // Acceleration
  if (moveDir.lengthSq() > 0) {
    const accelDir = _mvAccelDir.copy(moveDir).sub(player.velocity);
    const accelMag = Math.min(accelDir.length(), ch.acceleration * dt);
    if (accelMag > 0.01) player.velocity.add(accelDir.normalize().multiplyScalar(accelMag));
  } else {
    const speed = player.velocity.length();
    if (speed > 1) {
      const drag = Math.min(speed, ch.deceleration * dt);
      player.velocity.sub(_mvDrag.copy(player.velocity).normalize().multiplyScalar(drag));
    } else {
      player.velocity.set(0, 0, 0);
    }
  }

  // Speed cap (afterburner raises the cap to 600 ; sword block clamps to 40%)
  // In race mode the afterburner cap rises to RACE_DASH_SPEED so
  // afterburner-equipped ships can lean on it without dropping below
  // base race velocity.
  const _ab = _lssSpeedLerp(600, LSS.RACE_DASH_SPEED, _lssSpeedMix());   // (v43.13, blended v44.18)
  let maxSpeed = player.dashActive ? ch.dashSpeed : (player.afterburnerActive ? _ab : ch.flightSpeed);
  if (swordBlockActive) maxSpeed = ch.flightSpeed * 0.4;
  // Stun Bolt slow caps top speed too, so the player can't outrun
  // the slow window with afterburner / dash.
  if (arcSlowed) maxSpeed *= 0.3;
  if (player.velocity.length() > maxSpeed) {
    player.velocity.normalize().multiplyScalar(maxSpeed);
  }
""",
"""  // Speed cap (afterburner raises the cap to 600 ; sword block clamps to 40%)
  // In race mode the afterburner cap rises to RACE_DASH_SPEED so
  // afterburner-equipped ships can lean on it without dropping below
  // base race velocity.
  // (GD) Computed BEFORE the move now: the drone needs the cap as its speed limit.
  const _ab = _lssSpeedLerp(600, LSS.RACE_DASH_SPEED, _lssSpeedMix());   // (v43.13, blended v44.18)
  let maxSpeed = player.dashActive ? ch.dashSpeed : (player.afterburnerActive ? _ab : ch.flightSpeed);
  if (swordBlockActive) maxSpeed = ch.flightSpeed * 0.4;
  // Stun Bolt slow caps top speed too, so the player can't outrun
  // the slow window with afterburner / dash.
  if (arcSlowed) maxSpeed *= 0.3;

  // (GD) THE GIMBAL DRONE FLIES HERE. moveDir is still LSS's velocity target, built from every input
  // device above (keyboard, gamepad, touch sticks + VTOL track, VR controllers through the synthesised
  // pad), so all of them fly the drone with no changes of their own. What changes is HOW the target is
  // reached: instead of steering the velocity straight to it, the flight controller asks for a force and
  // torque, the allocator turns that into four thrust vectors, the gimbals slew and the pods spool, and
  // gravity, drag and thrust limits decide the velocity. LSS's own collision loop below still moves the
  // ship and resolves walls, so nothing about the world had to change.
  if (window.GDMod && window.GDMod.flyPlayer(dt, moveDir, maxSpeed, ch)) {
    // (GD) flown
  } else {
  // Acceleration
  if (moveDir.lengthSq() > 0) {
    const accelDir = _mvAccelDir.copy(moveDir).sub(player.velocity);
    const accelMag = Math.min(accelDir.length(), ch.acceleration * dt);
    if (accelMag > 0.01) player.velocity.add(accelDir.normalize().multiplyScalar(accelMag));
  } else {
    const speed = player.velocity.length();
    if (speed > 1) {
      const drag = Math.min(speed, ch.deceleration * dt);
      player.velocity.sub(_mvDrag.copy(player.velocity).normalize().multiplyScalar(drag));
    } else {
      player.velocity.set(0, 0, 0);
    }
  }
  if (player.velocity.length() > maxSpeed) {
    player.velocity.normalize().multiplyScalar(maxSpeed);
  }
  }
""")
patch("flight: the hull wears the drone's real attitude",
"    player.mesh.rotateZ(game._tpBank);\n",
"    player.mesh.rotateZ(game._tpBank);\n"
"    // (GD) Everything above poses the hull from the LOOK (plus a cosmetic steer and bank). A gimbal\n"
"    // drone's body has its own physical attitude, which in HOVER mode stays level while you look\n"
"    // around: show that instead. The camera keeps the look, like a stabilised camera gimbal.\n"
"    if (window.GDMod) window.GDMod.poseHull(player.mesh);\n")

# ---------------------------------------------------------------------------------------------
# 7. BRANDING
patch("brand: lobby wordmark",
"    <h1>LAST SHIP<br>SAILING</h1>\n    <span>ZERO-GRAVITY SHIP COMBAT</span>",
"    <h1>GIMBAL<br>DRONE</h1>\n    <span>VECTORED-THRUST FLIGHT SIM</span>   <!-- (GD) -->")
patch("brand: lobby title row",
"        ZERO-GRAVITY SHIP COMBAT\n      </h2>",
"        VECTORED-THRUST FLIGHT SIM   <!-- (GD) -->\n      </h2>")
patch("brand: ship-select masthead",
"          '<span class=\"ssm-title\">LAST SHIP SAILING</span>' +",
"          '<span class=\"ssm-title\">GIMBAL DRONE</span>' +   // (GD)")
patch("brand: VR lobby title",
"  ctx.fillText('LAST SHIP SAILING', W / 2, 120);",
"  ctx.fillText('GIMBAL DRONE', W / 2, 120);   // (GD)")


def main():
    if not os.path.isfile(SRC):
        sys.exit("fork.py: cannot find " + SRC)
    raw = open(SRC, "rb").read()
    crlf = b"\r\n" in raw
    src = raw.decode("utf-8").replace("\r\n", "\n")
    out = src
    for name, anchor, repl in PATCHES:
        n = out.count(anchor)
        if n != 1:
            sys.exit("fork.py: anchor for '%s' found %d times (need exactly 1). LSS moved on: update the "
                     "anchor in GimbalDrone/fork.py.\n  anchor: %r" % (name, n, anchor[:160]))
        out = out.replace(anchor, repl, 1)
        print("  patched: " + name)
    banner = ("<!-- (GD) GIMBAL DRONE: generated from LSS/index-working.html by GimbalDrone/fork.py.\n"
              "     Edit this copy freely, or re-run fork.py to re-sync with LSS (that overwrites this file).\n"
              "     grep -n \"(GD)\" lists every place the drone mod hooks the engine. -->\n")
    out = out.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + banner, 1)
    if crlf:
        out = out.replace("\n", "\r\n")
    open(DST, "wb").write(out.encode("utf-8"))
    print("wrote %s (%d patches)" % (DST, len(PATCHES)))

if __name__ == "__main__":
    main()
