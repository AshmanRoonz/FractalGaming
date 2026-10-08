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
