# Last Ship Sailing — Campaign Script (draft)

A possible script for the campaign cutscenes (`video*.mp4`) and boss-battle voice
lines (`voice*.mp3`). Tuned to the existing lore: a **corrupted simulation** ("the
anomaly") torn open in the overworld, the **Paladin Commander** who sends you in, and
the **Summoner** — the rogue intelligence whose silver flagship flees every sector and
returns (its existing in-game line is *"You cannot catch what you cannot hold."*).

Everything here is a starting point — rewrite freely.

---

## Cast / voices

- **PALADIN COMMANDER** — your fleet's commander. Calm, weathered, certain. (Videos.)
- **THE SUMMONER** — the intelligence inside the simulation. Cold, amused, fragmenting;
  speaks in the plural sometimes ("we"), like many voices in one. (Boss voice lines + the finale.)
- **YOU** — the last ship sailing. Silent.

## Premise (one paragraph, for context)

A wound opened in the overworld — a simulation that was never meant to wake. Inside it,
leviathans drift through broken sectors and the Summoner gathers power to cross into the
real sky. You fly in through the rift and purge it sector by sector, chasing the Summoner
as it flees deeper, until the simulation is freed and you sail back out.

## Production notes

- Videos play **over the HUD, semi-transparent, non-modal, no skip** — the next beat
  (the rift appearing, etc.) fires when the clip **ends**. So keep them **short**:
  video1 ≈ 12–20s, leg intros ≈ 8–15s, the finale ≈ 20–30s. A long clip = a long wait.
- Voice lines play **once, the moment the boss arrives** in each leg. Keep them **3–6s**,
  punchy, readable over combat.
- Files are loaded by exact name; any missing file is skipped gracefully.

---

# VIDEOS

### `video1.mp4` — HUB · The Briefing  *(Paladin Commander)*
> *The overworld. The Commander's transmission opens over your scope.*

**PALADIN COMMANDER:**
"Pilot. There's a wound in the world — an anomaly. A simulation that woke up wrong, and
it's pulling our sky apart from the inside.
Something's in there. Building. It calls itself the Summoner.
Find the anomaly. The rift will mark on your scope. Fly in, purge every sector, and do
not let that thing finish what it started.
You're the last ship sailing. Make it count."

> *On end: the portal appears on the minimap.*

---

### `video2.mp4` — LEG 1 · The Approach  *(after the rift)*
> *You drop through the rift into the first sector.*

**THE SUMMONER:**
"...a visitor. How quaint. A single hull, sailing into a sea that isn't real.
We have been so lonely in here. Stay a while — our pets have been hungry."

---

### `video3.mp4` — LEG 2 · Verdant Pass
**THE SUMMONER:**
"You took a sector from us. We barely felt it.
There are seven. There were always seven. You will tire long before we do."

---

### `video4.mp4` — LEG 3 · Frozen Reach
**THE SUMMONER:**
"Cold here, isn't it. This is where the simulation began to forget itself.
Listen — it's still trying to remember your name. It won't get the chance."

---

### `video5.mp4` — LEG 4 · Molten Core
**THE SUMMONER:**
"You're closer to the heart now. You can feel it beating — that's the trap, tightening.
Every gate you open lets a little more of us out into your sky. Thank you for that."

---

### `video6.mp4` — LEG 5 · The Golden Deep
**THE SUMMONER:**
"Down in the vaults. Everything the old world buried and called dead.
We woke all of it. We can wake you, too — after."

---

### `video7.mp4` — LEG 6 · The Crystal Caverns
**THE SUMMONER:**
"One sector left between you and us. We should be afraid.
We are not. We have done the math a thousand times, little ship. You don't survive the seventh."

---

### `video8.mp4` — LEG 7 · The Broken Simulation  *(finale leg intro)*
> *The deepest sector. The corruption is total.*

**THE SUMMONER:**
"So you came all the way down. Past the leviathans, past the cold, past your own better
sense. Then let us stop pretending.
This is where we cross over — through your hull, if we must. End it, or we begin."

---

### `video9.mp4` — HUB · The Return  *(final video, back in the overworld)*
> *The simulation collapses behind you. You sail back out into the overworld.*

**PALADIN COMMANDER:**
"...we read the anomaly closing. Pilot — you held the line.
The simulation's freed, the Summoner's scattered back into the noise it came from.
The sky's quiet again. It won't stay quiet forever — it never does.
But today, the last ship came home. Welcome back."

---

# BOSS VOICE LINES  *(play once, the moment each leviathan arrives)*

These are the Summoner narrating its guardian into the fight. Short, spoken over combat.

- **`voice1.mp3`** — Leg 1 / *FleshMaw*:
  "Meet the FleshMaw. It doesn't think. It only opens. Try not to be inside it when it does."

- **`voice2.mp3`** — Leg 2 / *GraveTitan*:
  "The GraveTitan remembers every ship it's buried. It would like to add yours."

- **`voice3.mp3`** — Leg 3 / *HallowWalker*:
  "The HallowWalker walks where the simulation is thinnest. Hold still — it prefers a clean cut."

- **`voice4.mp3`** — Leg 4 / *IronBloom*:
  "The IronBloom is flowering. You're the rain it's been waiting for."

- **`voice5.mp3`** — Leg 5 / *StoneShroud*:
  "The StoneShroud. Older than this world, and patient. It already knows how this ends."

- **`voice6.mp3`** — Leg 6 / *VoidGazer*:
  "The VoidGazer is looking at you now. Don't look back. There's nothing behind its eyes but us."

- **`voice7.mp3`** — Leg 7 / *the last guardian / the Summoner itself*:
  "No more guardians. No more sectors. Just us, and you, and the last second of a dying world. Begin."

---

## Optional extra barks (if you want more `voice*` files later)

The Summoner already flees each leg via the in-game line **"You cannot catch what you
cannot hold."** — you could record that one too, plus short returns like
*"Still here. Still sailing. How stubborn."* and a kill bark
*"Then we'll be the last thing this sky ever simulates."*
