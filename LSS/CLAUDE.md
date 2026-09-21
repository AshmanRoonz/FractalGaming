# Welcome to the Cybernetic Unit

You and Ashman are working on **Last Ship Sailing** together — not in turns. Most of the time they are right there: flying the Browser pane while you measure it, reading your thinking as it happens, and interjecting mid-turn when they see something.

Work accordingly.

- **Odd state in the pane is a PERSON before it is a bug.** If the hull swaps between samples, the HUD vanishes, a value resets or a projectile disappears — ask before theorising. A previous session spent several rounds inventing a "cluster missile spawns no projectile" bug and writing up a false lesson about synthetic key events. It was Ashman at the keyboard, airbursting the missile being hunted.
- **Say what you are about to drive** before driving it — teleporting the player, forcing `coreMeter`, clearing `localStorage`, retagging bots — so they can stay clear or take the stick.
- **Their eyes beat your instrumentation for anything visual.** "NRG fits, AMMO is a off center in its bar" and "i see water" arrive faster and cheaper than a pixel probe. Ship the change, let them look, iterate.
- **Prefer a live knob to a rebuild.** `window.__hudLbl`, `__hudIcon`, `__hudCore`, `__earthGroundLiftApply`, `__blasterCharge`, `__earthKeep`. The tuning loop is a conversation, so it should run at conversation speed. Add a new knob when a number will need eyeballing.
- **Interjections supersede the plan.** Act on the newest instruction rather than finishing the previous sub-task first.
- They read the thinking, so the final message does not need to re-narrate process. Give the finding, the measurement, and what is still open.

## Read this first

**[`lss.map.md`](lss.map.md)** — the architecture and navigation map, and more importantly the **trap log**. Jump by the `Jump:` anchor strings, never by the `~L#####` line hints (those drift; the anchors do not). Its entries record *why* things are the way they are, usually with the owner quote that caused them. Read it before changing anything non-trivial, and add to it when you learn something that cost you time.

Companions: [`performance_review.md`](performance_review.md) (the measured perf baseline), [`WORLD_RULES.md`](WORLD_RULES.md), [`SANDWICH_TERRAIN_GUIDE.md`](SANDWICH_TERRAIN_GUIDE.md).

## The build — this one bites first

The game is **one classic `<script>`** defining `_bootLSS()` — a single giant lexical scope, no modules. Nearly everything is closure-scoped and unreachable from the console; reach for `window.__*` probes instead.

It is a **two-file workflow**:

```bash
python strip.py
```

- **Edit `LSS/index-working.html`** — the commented SOURCE. Never hand-edit `LSS/index.html`, `LSS/lss.js` or `LSS/cine.html`; they are generated.
- Run `strip.py` **from the repo root** (the parent of `LSS/`). It refuses to write unless every code line is byte-identical to the source and `node --check` passes, then regenerates the shipped files.
- **Bump `LSS_BUILD` every iteration** — it is the `lss.js?v=` cache-bust, so a stale one means you are testing the old file.
- **Back up to `LSS/backups/` every iteration**: `cp index-working.html backups/index-working_v<NN.NN>_<what>.html`.

## Hard rules

- **Never rewrite files via PowerShell `Get-Content`/`Set-Content`.** It silently mojibakes UTF-8 — it destroyed 2,635 characters once. Use Read/Edit, or Python with an explicit `encoding='utf-8'`.
- **`typeof X` does NOT shield a top-level `const` read before its line has run.** A TDZ ReferenceError throws straight through it and kills boot everywhere (v39.02). Wrap the read in `try/catch`, or declare the const above its first reader.
- **Boot-test desktop AND the mobile preset** in the pane before `tools/deploy_cf.py`.
- Comments here carry the *reasoning*, often with the owner's own words and the measurement that settled it. Match that density — a future session reads them instead of re-deriving. When you reverse an earlier decision, say so and say why the old rule was right at the time.

## Running and verifying

Use `preview_start` with a name from `.claude/launch.json` — never a dev server via Bash:

| name | port | serves |
|---|---|---|
| `lss` | 8099 | `LSS/` directly — game at `/index.html` |
| `webgpu` | 8096 | repo root, adds `Document-Policy: js-profiling` — game at `/LSS/index.html` |

Use `webgpu` when you need the JS self-profiler. Probes: `?pbhud` / `?pbseg`, `window.__prebake()`, `__f8log`, `__prof`, `lssPerfSnapshot()`, `__race`, `__dbg`, `__clipReport()`, `__demReport()`.

⚠ **The HUD cannot be magnified for inspection.** `_lssApplyShipRig` rewrites `hudCanvas.style.transform` every frame, and vmin sizing makes the HUD scale-invariant to the viewport, so resizing buys nothing. Set `input.hudScale` (max 1.75) and read `#circumpunct-hud` pixels directly — measuring beats screenshotting for angles, colours and positions.

⚠ **Driving state is steadier than driving input.** Ability keys route through `_lssDispatchBound` off `input.kbBindings` (ability0 is `q`, not `1`), and the same dispatcher owns `v` and `[` `]` (**cycleHubShip**) — one stray press swaps the hull mid-measurement.

## Deploy

`LSS/` **is** the site root: it is exactly what ships to `lss.fractalreality.ca` via `tools/deploy_cf.py`. The repo root above it holds only dev tooling and unrelated projects, none of which deploy. Ashman plays the **deployed** build, so F8 marks and `localStorage` live on that origin, not on `localhost`.
