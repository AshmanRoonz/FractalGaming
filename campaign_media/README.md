# Campaign media

Drop campaign cutscene videos and boss-voice audio here. The game loads these by
**exact filename** and **gracefully skips any file that is missing** (no crash, no
hang) — so you can add them one at a time.

## Videos (`.mp4`)

Played in a semi-transparent panel over the HUD. Named in play order:

| File         | When it plays                                                        |
|--------------|----------------------------------------------------------------------|
| `video1.mp4` | Hub, on campaign start — Paladin Commander gives the mission. Portal appears on the minimap when it ends. |
| `video2.mp4` | After teleporting through the portal — intro to the 1st combat leg.   |
| `video3.mp4` | Intro to the 2nd combat leg.                                          |
| `video4.mp4` | Intro to the 3rd combat leg.                                          |
| `…`          | …one per leg…                                                        |
| `videoN.mp4` | Final video, back in the hub after the last boss is beaten.           |

(Exact count depends on the agreed number of legs — see the campaign plan.)

## Voice (`.mp3`)

Boss-battle dialogue, played during each boss fight in order:

| File         | When it plays            |
|--------------|--------------------------|
| `voice1.mp3` | During boss 1's battle.  |
| `voice2.mp3` | During boss 2's battle.  |
| `…`          | …one per boss…          |

## Notes
- Keep videos reasonably small (web-friendly H.264 `.mp4`); they stream from this folder.
- Filenames are case-sensitive on some hosts — use lowercase exactly as above.
- Missing file ⇒ that beat is silently skipped; the rest of the flow still runs.
