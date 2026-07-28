---
name: lss-visual-iteration
description: Iterate on how the LSS hub/city LOOKS while proving the framerate held. Use whenever a task is "make X look better / more like Y" in index-working.html — city, terrain, sky, weather, lighting, shaders. Covers the edit→strip→launch→position→screenshot→read-fps loop, the browser-pane facts that make it possible, and the write-order traps that silently eat visual changes.
---

# Iterating on LSS visuals with a measured framerate

The whole point: **you can see the game and read its real framerate from this
environment.** Earlier notes claiming the sandbox is software-GL and useless for
visuals are out of date. Verify once at the start of a session (below), then
iterate freely.

Quality work here is never done blind and never done unmeasured. Every visual
change gets a screenshot AND an fps number, both from the same frame.

## The loop

1. Edit `index-working.html` (the commented source — **never** `index.html`).
2. `python strip.py` — regenerates `index.html`. It refuses to write on a syntax
   error, so a failure here is a real bug you just introduced, not a hiccup.
3. Reload the pane, relaunch into the hub, position the camera, screenshot,
   read fps.
4. Compare against the target. Change one thing. Repeat.

Live-tune first where you can (most look constants are exposed on `window.__*`),
then bake the values you settled on into the source. That turns a 60-second
rebuild cycle into an instant one.

## Confirm the pane is usable (once per session)

```js
// In the pane. Want a real GPU, not SwiftShader/llvmpipe.
const c = document.createElement('canvas');
const gl = c.getContext('webgl2');
const d = gl.getExtension('WEBGL_debug_renderer_info');
gl.getParameter(d.UNMASKED_RENDERER_WEBGL)
```
A result like `ANGLE (NVIDIA ... D3D11)` means screenshots and fps are both
trustworthy. The game also logs this itself at boot — check
`read_console_messages` for `[v8VR GPU] renderer:`.

**One tab only.** Two live WebGL contexts compete and skew fps. Check
`tabs_context` before trusting any number. The `seed` tab is the main one and
can't be closed — close the extras.

**The pane must be displayed.** Hidden, rAF throttles to ~2 fps and
`setAnimationLoop` hands off to a 30 Hz worker (see `setupBackgroundTick`). A
framerate read while hidden is meaningless. If `screenshot`/`javascript_tool`
start timing out at 30 s the pane has wedged — `preview_start` a fresh tab.

## Reading the framerate

Turn the on-screen counter on once, then read it as plain DOM — no screenshot
needed, no OCR:

```js
// enable (settings checkbox)
document.getElementById('lobby-settings-btn-main').click();
document.getElementById('set-show-fps').click();
document.getElementById('settings-close').click();

// read, any time after
document.getElementById('fps-counter').textContent   // "144 fps"
```

It's a 60-sample rolling average written 4x/sec, so give it a moment after a
scene change before trusting it. `window.lssPerfSnapshot()` and
`window.__profOn = true; window.__prof` give per-system CPU breakdowns when you
need to know *where* time went.

## Getting into the hub headlessly

```js
window.startFreeFlight();                                    // -> ship select
document.querySelector('.ship-chip').click();                // pick a ship
document.getElementById('ship-preview-confirm').click();     // launch
```
Put real delays between the steps (a busy-wait spin works — `while
(performance.now() - t0 < ms) {}`), the screens need frames to build.

## Positioning the camera

`window.player` and `window.camera` are exposed. `window.HUBCITY.cfg` has the
city's `x`, `z`, `padY` and `genome.radius`.

```js
const C = window.HUBCITY.cfg;                  // city centre + pad height
player.position.set(C.x + 1800, C.padY + 260, C.z + 1800);
player.velocity.set(0, 0, 0);                  // or drift ruins the shot
// look at a target: three.js YXZ euler
const dx = C.x - px, dy = ty - py, dz = C.z - pz, len = Math.hypot(dx, dy, dz);
player.euler.y = Math.atan2(-dx / len, -dz / len);
player.euler.x = Math.atan2(dy / len, Math.hypot(dx, dz) / len);
```

Shoot the same two vantages every iteration so comparisons are like-for-like:
a **skyline** stand-off and a **street-level** pass. Street level is where
lighting and material problems show; the stand-off is where palette and
silhouette problems show.

**A connected gamepad drives flight input** — resting-stick drift will move the
ship between your positioning call and the screenshot. Reposition immediately
before shooting, or unplug.

## Clean judging shots

The HUD eats ~40% of the frame. Hide it, and remember these are `!important` in
places:

```js
['hud','circumpunct-hud','crosshair','minimap','cockpit-frame','gun-layer']
  .forEach(id => { const e = document.getElementById(id);
                   if (e) e.style.setProperty('display','none','important'); });
```
The fps counter is outside `#hud`, so it survives — you still get the number in
the corner of the judging shot. Reload to restore.

## Traps that silently eat visual changes

**Write order — find out who writes last.** `gameLoop` runs
`_hubZoneTick` -> `_hubCityFrame` -> `_wxFrame`. The weather system owns the
light intensities, so anything the zone tick writes to `dirLight`/`ambientLight`
is overwritten before it renders. Symptom: your multiplier asks for 0.16 and the
light measures 3.00. Fix: apply after `_wxFrame`. **Before assuming a value
didn't apply, read it back live** — `scene.traverse(o => o.isLight && ...)`,
`scene.fog.color.getHexString()`, `__swU.uColGrass.value` — and find out whether
it was never written or written then clobbered.

**Don't multiply light intensities in place.** The weather system writes them on
*change*, not every frame, so `intensity *= k` compounds every frame and hits
0.000 within seconds. Use the sentinel pattern: remember what you last wrote; if
the live value has drifted from that, someone else set it and that's your new
baseline. This survives both writers and a teleport straight into the zone.

**No backticks inside template-literal GLSL.** The shaders live in JS template
strings. A backtick in a comment (```like `this` ```) terminates the string and
the error surfaces far away. `strip.py`'s `node --check` catches it — that gate
is why it's there.

**Inline style beats the stylesheet.** Markup carrying `style="flex-direction:row"`
will defeat a CSS rule with the same property. Fix it at the markup, don't stack
`!important`.

**Computed style right after a class toggle on a hidden element is stale.** It
will report the old value and send you hunting a CSS bug that isn't there. Force
a reflow (`void el.offsetHeight`) or read it while the element is visible.

## Making a procedural city read (what actually moved the needle)

In order of impact per unit of GPU cost — the first three are free:

1. **Value structure.** Building mass near-black, emissive windows the only
   bright thing. Mid-grey facades compete with their own windows and nothing
   pops. This is the single biggest lever.
2. **Palette discipline.** A small set of hues with assigned *roles* (one
   dominant, one counter, two accents), not an even pick across five saturated
   colours. Jitter **brightness within a hue**, never across RGB channels.
3. **Hue coherence per object.** Pick the window hue per *tower*, not per
   *window*. Mixed hues inside one facade read as confetti at any distance;
   real buildings light by tenancy.
4. **Time of day.** A neon city under a blue sky on green grass cannot read as
   cyberpunk whatever you do to the palette. LSS has a radial zone system
   (`_HUB_ZONES` / `_hubZoneTick`) — add a ramp rather than new machinery, and
   it composes with the existing sector blend for free.
5. **Atmosphere.** Fog density does the depth separation between near and far
   towers. Cheap, and it's what makes a skyline feel deep.
6. **Reflections / wet ground.** The only item here with real GPU cost — a
   `Reflector` is a full extra scene render. Measure it alone, never bundled
   with free changes.

## Perf rules for this repo

- Measure the **same vantage** before and after. A number without a matching
  camera position proves nothing.
- Colour lerps, uniform writes and light-intensity assignments are free. New
  render passes, render targets and draw calls are not.
- This repo has a history of perf changes that looked free and weren't
  (`antialias:false`, the terrain tile cache). If a change adds a pass, it gets
  measured on its own before it stays.
- Keep `antialias: true`. Keep grass off. Don't re-add projectile/tracer pooling.
