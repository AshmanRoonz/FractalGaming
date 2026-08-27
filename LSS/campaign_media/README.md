# Campaign media

Drop campaign cutscene videos and boss-voice audio here. The game loads these by
**exact filename** (lowercase) and **gracefully skips any file that is missing** (no
crash, no hang) — so you can add them one at a time.

A full draft script for every file below lives in **`SCRIPT.md`** (same folder).

## Videos (`.mp4`) — 9 files

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
| `video9.mp4` | Hub (overworld)                | The final video — back in the overworld after the last boss falls. |

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

## Notes
- Keep videos reasonably small (web-friendly H.264 `.mp4`); they stream from this folder.
- Filenames are case-sensitive on some hosts — use lowercase exactly as above.
- Missing file ⇒ that beat is silently skipped; the rest of the flow still runs.
- Replaying a leg (level picker, or the v37.12 rift-resume) replays that leg's intro
  video and boss voice — the numbering follows the leg, not overall progress.
