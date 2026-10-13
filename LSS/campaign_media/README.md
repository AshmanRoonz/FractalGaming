# Campaign media

Drop campaign cutscene videos and boss-voice audio here. The game loads these by
**exact filename** (lowercase) and **gracefully skips any file that is missing** (no
crash, no hang) — so you can add them one at a time.

A full draft script for every file below lives in **`SCRIPT.md`** (same folder).

## Videos (`.mp4`) — 10 files

Played in a semi-transparent panel **over the HUD, non-modal, no skip** — you keep
flying while it plays, and the next story beat fires when the clip **ends** (so keep
them short; see the production notes in SCRIPT.md).

| File         | Leg                            | When it plays                                                     |
|--------------|--------------------------------|-------------------------------------------------------------------|
| `video1.mp4` | Hub (overworld)                | On campaign start — the mission briefing. The rift portal appears when it ends. |
| `video2.mp4` | Leg 1 · The Approach           | The moment you gain control at the start of the leg.              |
| `video3.mp4` | Leg 2 · Verdant Pass           | Start of the leg.                                                 |
| `video4.mp4` | Leg 3 · Frozen Reach           | Start of the leg.                                                 |
| `video5.mp4` | Leg 4 · Molten Core            | Start of the leg.                                                 |
| `video6.mp4` | Leg 5 · The Golden Deep        | Start of the leg.                                                 |
| `video7.mp4` | Leg 6 · The Crystal Caverns    | Start of the leg.                                                 |
| `video8.mp4` | Leg 7 · The Broken Simulation  | Start of the finale leg.                                          |
| `video9.mp4` | Hub (overworld)                | The final video — after Xorzo's closing lines ("...And we'll need a ship!"), right before TO BE CONTINUED. (v49.68) |
| `video10.mp4` | Hub (overworld)               | **The Summoners' vow** — after the giant falls, before their escape attempt. Until it exists, the vow plays as dialogue lines (`vw_1`, `vw_2`). (v49.68) |

## Voice (`.mp3`) — 7 files

One line per leg, played **once, the moment that leg's boss arrives** (the
travel→boss transition), over combat.

| File         | Leg                            | Boss                          |
|--------------|--------------------------------|-------------------------------|
| `voice1.mp3` | Leg 1 · The Approach           | FleshMaw                      |
| `voice2.mp3` | Leg 2 · Verdant Pass           | GraveTitan                    |
| `voice3.mp3` | Leg 3 · Frozen Reach           | HallowWalker                  |
| `voice4.mp3` | Leg 4 · Molten Core            | IronBloom                     |
| `voice5.mp3` | Leg 5 · The Golden Deep        | StoneShroud                   |
| `voice6.mp3` | Leg 6 · The Crystal Caverns    | VoidGazer                     |
| `voice7.mp3` | Leg 7 · The Broken Simulation  | The Summoner (the final duel) |

## `media.json` — list what exists (v49.47)

Nothing in this folder is requested unless `media.json` lists it, so a missing file never
shows up as an error:

```json
{ "videos": [1, 2], "voices": [1], "lines": ["op_real", "op_light"] }
```

- `videos` / `voices` — the numbered slots in the tables above (`video1.mp4` = `1`).
- `lines` — the dialogue box's spoken lines. Every line in `CAMP_LINES`
  (index-working.html, beside `CampMedia`) has an id — `op_real`, `leg0_a`, `boss4_a`…
  Record a line as `voice/<id>.mp3` and add its id here. A voiced line stays on screen for
  its clip's length; an unvoiced one for its reading time.

## Baking the dialogue voices (ElevenLabs, 2026-10-08)

The cast: narrator **Quentin** · Xorzo **Cybertronic** · the Summoners **Victor** · pilot
**Grainger** · Jimmy **Joe** (`../voice_casting.html` has the auditions). From the repo root:

```bash
node tools/campaign_voice.mjs --dry            # every line's voice, spoken text, credits, state
node tools/campaign_voice.mjs --dry --seq gameshow   # just one scene (any CAMP_SEQS name)
```

With an ElevenLabs API key set in your own shell (`$env:ELEVENLABS_API_KEY = "..."` in
PowerShell; never paste it anywhere else), `node tools/campaign_voice.mjs` bakes every missing
or changed line into `voice/<id>.mp3` and fills `media.json` `lines`. Edit a line in
`CAMP_LINES`, run it again, and only that line is re-baked. A clip you record yourself (an mp3
the baker didn't make) is never overwritten. The whole campaign is ~12,600 credits: more than
the free plan's monthly 10,000, and free-plan audio is non-commercial, so bake the shipping set
on a paid plan. (All 171 were baked on Starter, 2026-10-08, through the ElevenLabs connector:
`--plan`, generate, `node tools/campaign_voice_fetch.mjs`, `--ingest`.)

**A second voice for one speaker (2026-10-11).** The pilot you fly can be Azure Vanguard, so every pilot line has a
second take in her voice, **Verity**: `voice/<id>.azure.mp3` beside `voice/<id>.mp3`, listed in `media.json` like any
line. The game plays the `.azure` take when Azure is the chosen pilot and falls back to the line's own clip otherwise
(Frostfang speaks with Grainger's). `VARIANTS` in the baker holds them; `--var azure` selects only those, `--var none`
only the lines' own. 32 lines, 2,020 credits.

**Azure is Tammy (2026-10-13).** The owner: "azure's voice sounds bad... i just added Tammy, so let's redo all her lines in
Tammy". All 38 of her clips (`*.azure` + her six `hg_*`) were re-made in **Tammy** under the same names (media.json `rev`
changed, so browsers fetch the new takes); Verity's are kept in `assets_base/campaign_voice_raw/verity_backup_2026-10-13/`.
Erik's `hg_built` was re-taken the same day with "A.I." spelled (he had read "AI wasn't" as "Ah... I wasn't") and misread
again ("Uhh. I wasn't"), so `voice/hg_built.mp3` is now **the owner's own clip** (levelled to -17 LUFS by hand, no
manifest entry: the baker shows it `own` and never overwrites it). All its takes are in
`assets_base/campaign_voice_raw/hg_built_takes_2026-10-13/`.

**A third (2026-10-12).** Captain Frostfang has his own voice too, **Erik**: `voice/<id>.frostfang.mp3` (`--var frostfang`),
32 lines. And **the hangar talk** (the campaign's first scene, `hg_*`) has the three pilots speaking as themselves, whoever
you fly: those lines are baked under their own speakers (`ashman` Grainger, `azure` Verity, `frostfang` Erik), and the
narrator's `hg_onto` with Gerald. 18 + 32 = 50 clips, 2,921 credits.

**The hangar pictures.** `hangar_perspective1-3.png` are the owner's originals; the game loads their `.webp` twins (same
pixels, ~0.3 MB each instead of ~2.5). Replacing a picture means re-fitting its camera (`cfg.talk.pics` in the game).

**The intro's pictures (2026-10-13).** `fractalgaming_logo.webp` and `lss_title.webp` are the WebP twins of the owner's
`../FractalGaming.png` and `../LSS_title.png` (232 KB / 293 KB instead of 1.6 / 2.2 MB): the logo card and the title card
that open a brand-new campaign, before the hangar talk (`cfg.intro` in the game). A replaced PNG needs its twin re-made
(Pillow: `quality=92` for the logo, `90` for the title, `method=6`).

Every clip is **levelled to -17 LUFS** on the way in (`tools/campaign_voice_level.py`, run inside
Blender): the voices come out of ElevenLabs at very different levels (the narrator 10-15 dB
quieter than the rest). The raw takes are kept in `assets_base/campaign_voice_raw/` (local only),
so `node tools/campaign_voice.mjs --level --force` re-levels everything without spending credits.

## Notes
- Keep videos reasonably small (web-friendly H.264 `.mp4`); they stream from this folder.
- Filenames are case-sensitive on some hosts — use lowercase exactly as above.
- Missing file ⇒ that beat is silently skipped; the rest of the flow still runs.
- Replaying a leg (level picker, or the v37.12 rift-resume) replays that leg's intro
  video and boss voice — the numbering follows the leg, not overall progress.
