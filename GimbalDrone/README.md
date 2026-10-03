# Gimbal Drone

A copy of **Last Ship Sailing**, modded into a gimbal drone flight sim. Every ship in the game (the seven chassis, every bot, every remote pilot, the campaign hoard) is now a four-pod drone. Each thrust pod sits in its own three-ring gimbal and can aim its thrust anywhere, independently of the other three. The world, the modes, the HUD, multiplayer, VR, touch and gamepad support all come from LSS. What changed is the airframe and the physics that fly it.

**LSS itself is untouched.** This folder holds a copy of the LSS engine source plus the mod. It reads LSS's art in place (skyboxes, textures, music, maps) from `../LSS/` rather than duplicating ~500 MB of assets.

## Run it

Serve the **repo root** with any static server and open `/GimbalDrone/`:

```bash
python -m http.server 8000        # from the repo root
# then open http://localhost:8000/GimbalDrone/
```

It needs the `LSS/` folder beside it (for the art), and the page must be served over http(s), not opened from disk. GitHub Pages serving the repo works the same way.

## Flying it

The controls are LSS's, on every device: keyboard and mouse, gamepad, touch sticks with the VTOL track, and VR controllers. The flight model underneath is different. The sticks still say where you want to go; the drone works out how to get there with four thrust vectors, inside its real limits.

| Action | Keyboard | Gamepad | VR | Touch |
|---|---|---|---|---|
| Cycle flight mode | **M** | **D-pad down** | flick **right stick down** | **MODE** button |
| Plasma / ducted-fan pods | **N** | | | |

### Flight modes

- **HOVER** (default). The body stays level and faces where you look; every push is vectored. Fly forward while looking straight up: the drone slides along level, and only the pods lean. This is the thing a normal quadcopter cannot do.
- **6DOF**. The body turns to match your aim (pitch included) and still translates any way you push, with gravity compensated automatically. Strafe a circle around a target while keeping the nose on it.
- **QUAD**. The pods lock near body-up, so it has to fly like an ordinary quadcopter: tilt the whole body toward where it wants to accelerate. Keep it for comparison.

A small instrument in the bottom-right corner shows the four pods from above (nose up). The arrow is each pod's sideways thrust, and the filled disc its vertical thrust (hollow orange means pushing down). Under that are speed, body tilt, power and thrust-to-weight. The **ATT / LIFT / MNV** bars show how much headroom the allocator has left for attitude, weight support and manoeuvring.

## The physics (`gd_physics.js`)

Pure JavaScript with no THREE and no DOM, in SI units. The game converts at 25 game units per metre, which makes the drones 4.8 to 8 m across with LSS's cruise speeds of 10 to 18 m/s.

- **The airframe is fully actuated.** One pod is a 3-DOF force actuator: two DOF of aim from the gimbal, one of magnitude from the throttle. Four pods give 12 inputs for the 6 DOF of a rigid body, over-actuated by six. That is why it can hold any attitude while pushing in any direction.
- **Allocation.** The flight controller asks for a body force and torque. A precomputed 12x6 pseudo-inverse turns them into four thrust vectors with the least total thrust squared. Read the result and you get every pod taking F/4, plus a rigid "twist" field. Roll and pitch come out as vertical differential thrust (like a quad). Yaw comes out as a tangential pinwheel, much stronger than a quad's rotor-drag yaw.
- **Prioritised saturation.** When the pods top out, the ask is scaled in layers: attitude first, then weight support, then the manoeuvre. Each layer is solved exactly per pod.
- **Real actuator limits.**
  - Gimbals slew at a finite rate along the shortest arc, and a pod is throttled to the part of its desired vector it is actually aimed along.
  - Thrust spools with a lag.
  - A pod may not aim its exhaust into its own arm.
  - **Fan** pods add rotor reaction torque (modelled exactly in the allocator) and gyroscopic precession (left for the attitude loop to reject). **Plasma** pods have no moving parts.
- **The third ring.** Aim needs two rings; the third (innermost) takes the twist about the thrust axis. Shortest-arc slews do not commute, so driving the aim around a loop leaves the pod twisted by the solid angle swept (holonomy). The check script measures 33 degrees for one loop.
- **Attitude control that respects the airframe.** The drones are ship-sized, so they are heavy to rotate. The attitude loop computes from the allocation matrix how hard each axis can actually be twisted without flipping pods. It then commands the square-root (time-optimal braking) rate profile with a short lead. A 6.4 m drone pitches 70 degrees in about a second with no overshoot.

`node GimbalDrone/check_physics.mjs` flies the real file through 39 checks: allocation identities, hover hold, HOVER versus QUAD tilt, 6DOF at 60 degrees nose-up / knife-edge / inverted, wind rejection, landing, fan torques, determinism, holonomy and the ship-sized airframe.

## How the copy is made

| File | What it is |
|---|---|
| `fork.py` | Copies `LSS/index-working.html` (read-only) to `index-working.html` and applies 23 small, anchored hooks, all tagged `(GD)`. If LSS has moved on and an anchor no longer matches exactly once, it stops and names it. |
| `index-working.html` | The copy's commented source: the copy to mod. `grep -n "(GD)"` lists every hook. |
| `build.py` | The drone twin of `strip.py`: strips comments and splits out `gd.js`, reusing `strip.py`'s parser and safety checks via import (never modifying it). |
| `index.html`, `gd.js` | Generated by `build.py`. Do not hand-edit. |
| `gd_physics.js` | The physics and flight controller. |
| `gd_mod.js` | The game side: procedural drone hulls, the flight hook, gimbal animation for every drone on screen, the HUD instrument, mode switching and the lobby art. |
| `check_physics.mjs` | The physics checks. |

Workflow:

```bash
python GimbalDrone/build.py           # after editing index-working.html or bumping GD_BUILD
python GimbalDrone/fork.py            # re-sync with the latest LSS (OVERWRITES index-working.html)
python GimbalDrone/build.py
node GimbalDrone/check_physics.mjs
```

Bump `GD_BUILD` in `index-working.html` on every build: it is the `gd.js?v=` cache-bust. If you edit `index-working.html` directly, either stop using `fork.py` or move the edit into a `fork.py` patch (or into `gd_mod.js`), because re-forking overwrites the file.

### Kept apart from LSS

- **Saves.** The copy prefixes every `localStorage` key with `gd:`, so on the same host it never reads or overwrites LSS settings, loadouts or progress.
- **Backend.** The LSS backend and Discord relay are pointed at unresolvable `.invalid` hosts. The copy never posts to the LSS leaderboards, never appears in its lobby browser, never touches a pilot's synced LSS account state, and never opens its shop. The menu items that depend on those are hidden.
- **Multiplayer.** It is peer-to-peer and still works, but on its own app and room ids, so drone pilots only meet drone pilots.
- **Downloads.** The ship GLBs (37 to 54 MB) are never fetched.

## Credits

Built on Ashman Roonz's Last Ship Sailing. The drone physics, the mod and this copy were written with Claude (Anthropic), in keeping with the repo's disclosure policy.

## Known gaps

- Bots and remote pilots still fly with LSS's movement logic. Their gimbals and exhaust are animated by running the same allocator on how they actually accelerate, so the pods point where that airframe's pods really would. Their motion itself is not yet thrust-limited.
- In VR the corner instrument is not drawn (the LSS VR HUD is a separate canvas). Mode switching works there.
- Ship-select, thumbnails and hub traffic show the drones in their rest pose.
