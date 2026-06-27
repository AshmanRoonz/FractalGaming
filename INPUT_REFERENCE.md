# Input Reference — Gamepad / Keyboard / Mouse

Canonical control scheme for **Fractal Reality / FractalGaming** builds. New games and prototypes should match this so every title in the project feels the same on a controller. Derived from `last_ship_sailing.html` (combat) and `Caverns/world.html` (free-fly), which are the two reference implementations.

> TL;DR for a new build: **gamepad is the primary interface.** Left stick = move, right stick = look, triggers = primary/secondary action, A/B = down/up (or jump/cancel), bumpers = abilities/boost. Always ship a keyboard+mouse fallback that mirrors it. Poll `navigator.getGamepads()` every frame; there is no reliable connect event, so just read it live.

---

## 1. Polling

Poll once per frame inside the update loop. Pick the first connected pad. Do **not** rely on `gamepadconnected` — poll live.

```js
const pads = navigator.getGamepads ? navigator.getGamepads() : [];
let gp = null;
for (const g of pads) { if (g && g.connected) { gp = g; break; } }
```

(LSS additionally synthesizes a virtual pad from WebXR controllers and OR-merges it with the real pad for VR. Only do that in VR builds.)

---

## 2. Standard button map (Xbox layout)

| Index | Button | Free-fly role (world.html) | Combat role (LSS `gpBindings`) |
|------:|--------|----------------------------|--------------------------------|
| 0 | A | Descend | Dash |
| 1 | B | Ascend | (cancel) |
| 2 | X | — | Reload |
| 3 | Y | — | Ability 2 (utility) |
| 4 | LB | — | Ability 0 (offensive) |
| 5 | RB | Boost | Ability 1 (defensive) |
| 6 | LT (analog) | — | Alt-fire / zoom |
| 7 | RT (analog) | — | **Fire** |
| 8 | Back/Select | — | Scoreboard |
| 9 | Start | — | Menu |
| 10 | L3 (stick click) | Dash (held) | Move up |
| 11 | R3 (stick click) | — | Move down |
| 12 | D-pad Up | — | Core ability |
| 13 | D-pad Down | — | — |
| 14 | D-pad Left | — | — |
| 15 | D-pad Right | — | — |
| 16 | Home/Guide | — | (VR synthetic) |

A button is "pressed" when `gp.buttons[i].pressed || gp.buttons[i].value > TRIGGER_THRESHOLD`.
Triggers (6, 7) are **analog** — read `.value` in `0..1`, treat `>= 0.3` as pressed.

```js
const TRIGGER_THRESHOLD = 0.3;
const pressed = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > TRIGGER_THRESHOLD);
```

---

## 3. Analog sticks

| Axes | Stick | Role |
|------|-------|------|
| `axes[0]`, `axes[1]` | Left | Move (strafe X, forward/back Y — note **forward = −Y**) |
| `axes[2]`, `axes[3]` | Right | Look (yaw from X, pitch from Y) |

**Deadzone** (radial rescale so motion ramps smoothly from the edge of the dead region):

```js
const DEAD = 0.12;                                   // 0.12 responsive, 0.18-0.2 looser
const dz = v => Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);
```

LSS additionally applies a response curve `sign(v) * pow(abs(v), curve)` (`gpMoveCurve` / `gpLookCurve`, default `1.0` = linear; `>1` = softer center). Optional.

**Look application** (per frame, dt-scaled — this is the world.html feel):

```js
const LOOK = 2.4;                                    // rad/s at full deflection
yaw   -= lx * LOOK * dt;
pitch  = Math.max(-1.45, Math.min(1.45, pitch - ly * LOOK * dt));
```

D-pad can be emulated from the left stick with a hard threshold of `0.6` (so analog deflection registers as a digital press).

---

## 4. Movement feel

Free-fly reference (world.html):

```js
const SPEED = 380 * (1 + boost * 2.0);   // RB / ShiftRight triples speed
const DASH_SPEED = 820;                   // held L3 / F = continuous forward dash
// up = (B pressed ? 1 : 0) - (A pressed ? 1 : 0)
```

Scale `SPEED` to your world units. Boost should noticeably widen FOV (`targetFov = base + boost * 16`) for a speed rush.

---

## 5. Edge detection (just-pressed)

For one-shot actions (menus, toggles, fire-on-press), store last frame's state and compare:

```js
if (gpDash && !gpDashPrev) doDash();        // rising edge
if (!gpAbility0 && gpAbility0Prev) release(0); // falling edge
// at end of frame: gpDashPrev = gpDash; ...
```

Held actions (thrust, fire-while-down) just read the current state.

---

## 6. Haptics (nice-to-have, never fatal)

```js
function rumble(strong, weak, ms) {
  try {
    for (const gp of (navigator.getGamepads?.() || [])) {
      if (!gp) continue;
      const ha = gp.hapticActuators;
      if (ha && ha.length && ha[0].pulse) { ha[0].pulse(Math.max(strong, weak), ms); continue; }
      const va = gp.vibrationActuator;
      if (va && va.playEffect) va.playEffect('dual-rumble', { duration: ms, startDelay: 0, strongMagnitude: strong, weakMagnitude: weak });
    }
  } catch (_) {}
}
```

---

## 7. Keyboard + mouse fallback (always ship it)

Mirror the gamepad so the game is fully playable without one.

```js
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup',   e => { keys[e.code] = false; });

// Movement (overrides stick when pressed):
if (keys['KeyW']) my = -1; if (keys['KeyS']) my = 1;       // forward / back
if (keys['KeyA']) mx = -1; if (keys['KeyD']) mx = 1;       // strafe
if (keys['ArrowLeft'])  lx = -1; if (keys['ArrowRight']) lx = 1;   // look yaw
if (keys['ArrowUp'])    ly = -1; if (keys['ArrowDown'])  ly = 1;   // look pitch
if (keys['Space']) up = 1; if (keys['ShiftLeft'] || keys['ControlLeft']) up = -1;  // up / down
if (keys['ShiftRight']) boost = 1;
if (keys['KeyF']) dash = 1;

// Mouse look (requires pointer lock on the canvas):
const cv = renderer.domElement;          // or document.getElementById('gfx')
cv.addEventListener('click', () => { if (!document.pointerLockElement) cv.requestPointerLock(); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement === cv) {
    yaw   -= e.movementX * 0.0022;        // mouse look sensitivity
    pitch -= e.movementY * 0.0022;
  }
});
```

(LSS uses `sensitivity: 0.0015` with accumulated `mouseDX/DY`; world.html uses `0.0022` applied directly. Either is fine — expose it as a setting.)

---

## 8. Key constants cheat-sheet

| Constant | Value | Meaning |
|----------|-------|---------|
| `DEAD` | `0.12` | Stick deadzone (radial) |
| `TRIGGER_THRESHOLD` | `0.3` | `button.value` ≥ this = pressed |
| `LOOK` | `2.4` rad/s | Stick look rate |
| D-pad / stick-as-dpad threshold | `0.6` | Analog → digital |
| Mouse sensitivity | `0.0015`–`0.0022` | × `movementX/Y` |
| Move curve / look curve | `1.0` | `pow` exponent, 1 = linear |
| Boost multiplier | `×3` (`1 + boost*2`) | Speed on RB / ShiftRight |

---

*Used by `recursive_emergence_world.html`. Update this file when the scheme changes so every build stays consistent.*
