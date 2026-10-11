# Meshy characters → game-ready GLBs

Meshy's rigged bipeds arrive as one GLB per animation clip. Each file holds the same mesh, the same 28-joint
Mixamo-named skin and one clip. Meshy builds the model with the hands resting on the thighs and **fuses them
there**: weld the UV seams and the whole body is one surface, joined to the leg by thin bridge triangles or a
small fused patch. Its auto-rig also heat-weights the fingers half to the thigh. So whenever a clip lifts an arm,
the fingers stay behind and stretch down to the leg. Edges stretched up to **70×** on the Summoners and
**155×** on the pilot.

`char_pipeline.py` cuts the hands free, keeps the original normals, merges every clip into one file and exports
it. `tools/compress_glb.mjs` (recipe `character`) builds the shipped copy.

```bash
B="$(python tools/blender/blender_path.py)"
"$B" -b --factory-startup -P tools/blender/chars/char_pipeline.py -- \
    --name Pilot --dir assets_base/objects/characters/Meshy_AI_Hangar_Vanguard_biped \
    --out assets_src/objects/characters/pilot_ashman.glb --report tools/blender/work/chars/pilot_report.json     --alert Sit_and_Doze_Off:Sit_Alert \
    --upper 0 --feet Stand_Talking_Angry
cp assets_src/objects/characters/pilot_ashman.glb assets_src/objects/characters/pilot_ashman_seat.glb   # the in-seat LOD source
node tools/compress_glb.mjs --only characters/
```

(`--upper 0` since v52.59 and `--feet` since v53.66: see below.)

## Level feet in the standing clips (2026-10-11, game v53.66)

Owner, on the CUSTOMIZE line-up: "pilot and animal pilot both look like they are standing on a ball, ankles tilted in".
Meshy's talk clips, which every standing pilot holds, keep the feet 17–23° off flat for the whole clip:

| pilot | clip | the feet |
|---|---|---|
| Ashman | Stand_Talking_Angry | rolled ~16° onto the outer edges and toes up ~16° |
| Frostfang | Talk_with_Hands_Open | rolled 17° / 11° |
| Azure | Talk_Passionately | toes up ~22°, rolled ~6° |

These are measured against the rest pose, where all three stand flat.

- **`feet.py`** (headless) measures the feet and renders front, back, side and leg close-ups. With `--fix 1 --out X.glb` it
  levels a finished GLB and exports it with `export.py`.
- **`feet_level.py`** is the step that does the levelling (also `char_pipeline.py --feet Clip`). Each foot bone, then its toe
  bone, is turned back to its rest lie on every frame, about the ankle, by the shortest rotation. That rotation never
  changes the heading. It is exact in one step.

**Don't fit a plane to the sole.** The first measure fitted a plane to the boot's down-facing skin (toe cap, heel bevel, lugs).
It read Frostfang's left sole as 11.5° one way, and other readings of the same sole gave 10.5° and 4.6° the opposite way.
"Levelling" by that fit rolled the foot to 31°.

**Still off:** Azure's right foot hangs 2.5 cm off the floor in her clip. That is the leg's height, not a tilt, so it would
need leg IK.

The shipped six were fixed on the finished GLBs (originals in `tools/blender/work/chars/feet/orig_2026-10-11/`). Each pilot has
its own `art` / `fullArt` stamp in the game; `_LSS_SEAT_ART` stays the Summoners'.

Then look at it in `LSS/character_lab.html`, which loads the files with the game's own three 0.165. It has a clip
picker, a scrubber, and CLAY / SKELETON / IN PLACE / WIRE toggles, plus `window.CL` hooks for headless checks.

| file | role |
|---|---|
| `char_pipeline.py` | headless driver: import every clip, capture normals, cut, clean, export (refuses a GUI session) |
| `handfix.py` | the cut: min-cut labelling, bridge deletion, caps, re-weighting (`mode=preview` colours it instead) |
| `islands.py` | lists or deletes loose islands; the model's own small pieces are recorded first and kept |
| `finalize.py` | restores the captured corner normals (caps get auto normals) and strips the work attributes |
| `alert_head.py` | an ALERT copy of a slumped clip (`--alert SRC:DST[:target:keep:neck]`): face held at `target` deg, `keep` of the swing |
| `export.py` | GLB holding only this character's clips, each a named animation (one NLA track per clip) |
| `stretch.py` | the measurement: worst edge stretch per clip, broken down by bone pair |
| `shot.py`, `sheet.py` | Workbench close-ups (`views=lhand,rhandS,q,pt…`, `color=VERTEX attr=…`) and contact sheets |
| `bl.py` | runs any step script inside the owner's live Blender 5.2 (Blender Lab MCP extension, port 9876) |

**Normals.** Blender 5 stores custom normals relative to each corner's smoothing fan, so any weld or
delete quietly changes them, and Meshy's normal maps are baked against those exact normals. The pipeline
copies the real vectors into a corner attribute (`cc_nrm`) before touching the mesh and writes them back at the
end. After restore they are within 0.6°.

**Measured (2026-10-06).** Edges stretched past 4× across all clips:

| | original | hands cut | + arm pass |
|---|---|---|---|
| Summoners | 1,056 | 75 | 29 |
| Pilot | 11,123 | 5,624 | 2,029 |

Hand edges now peak at 3.7–4.1×, which is ordinary wrist bending. The pilot's running clip falls from a 31.7×
worst stretch to 7.8×, and the cheer from 76× to 19.6×.

**⛔ The shipped files are built WITHOUT the arm pass since 2026-10-07 (game v52.59), `--upper 0`.** Ashman, looking at
the arm-pass build: "when you cut under their arm, you cut into their chest... you cut the hand, away from the legs,
good... but then you did the arm after, we should undo that step if possible, and see how the animations look". The
arm-pass cut leaves a dark slash down the side of the chest (worst on the Summoners) when the arms go up; without it
the side of the suit stretches up with a raised arm instead (pilot cheer 76×, angry talk 52× worst). Rebuild what
ships now with `--upper 0` added to the commands above (and `--alert Sit_and_Doze_Off:Sit_Alert` for the pilot). The
arm-pass builds are kept: sources `tools/blender/work/chars/arm_summoners.glb` / `alert_pilot_ashman.glb`, shipped
copies `LSS/old_files/characters_armpass/` (local only; `character_lab.html` → COMPARE WITH ARM PASS shows them
beside the current files, same clip, same time).

**The arm pass** (`upper=1`, the script's default). The pilot's inner upper arm and elbow were fused to the torso and
waist too. On top of that, Meshy's arms-down auto-rig weights the side of the torso about 45% to the upper-arm
bone, so any raised arm dragged the side of the suit up with it. The cut now climbs the arm to `t0` (0.35 of the
way from shoulder to elbow, just below the armpit), and the torso side loses its arm weight. That weight change
fades in over the top of the region (`fade`), so the shoulder keeps its blend.

**What's left** is ordinary skinning:
- the armpit stretches when an arm goes overhead, because the cut deliberately stops below it
- the upper back pulls up to about 20× where Meshy's angry-talk clip shrugs the shoulders
- the pilot's belt line pulls at the waist bend when he sits

Where the inner arm used to merge into the torso, a cap now fills the side of the torso: Meshy never modelled
that surface. It takes a single nearby texel, so on these dark suits it reads as fabric.

## Seating a character in a ship

Run `seatfit.py`. It poses the character at one frame of a sit clip and fits it into each ship's seat, in
the ship GLB's own model space (forward −X, up +Y), which is the space the game parents it into. It writes
`{scale, pos}` per ship and renders a cut-away and a quarter view for checking.

```bash
"$B" -b --factory-startup -P tools/blender/chars/seatfit.py -- --char assets_src/objects/characters/pilot_ashman.glb \
    --clip Sit_and_Doze_Off --frame 1 --ships LSS/ships/tracker.glb,LSS/ships/pyro.glb \
    --out tools/blender/work/chars/seat_pilot.json --renders tools/blender/work/chars/seatP_ --zoom 0.42
```

There are two fitting modes, because the two kinds of seat put `cockpit1` in different places.

- **Pod mode**, the seven concept hulls. These have a `<ship>_game_cockpit` pod. The script finds the
  backrest face and the cushion height from rays along the centreline, then scales the character so its
  eyes sit at `cockpit1`'s height. That makes the first-person camera land where the pilot's eyes are.
- **Seat mode**, the old c1seat hulls (`--pan_y --back_x --scale`). On these hulls `cockpit1` sits at chest
  height, so eye-based fitting would shrink the character. The cushion height and backrest face are read off
  a profile instead, and the scale is chosen by eye. The Summoners in the old Pyro use −0.025 / −0.261 / 0.17.

The glTF importer sets `rotation_mode = 'QUATERNION'`, so a Blender `rotation_euler` write does nothing until
the mode is switched. That one cost a round of sideways-facing renders.

## More pilots: Azure Vanguard and Captain Frostfang (2026-10-10, game v53.44)

The owner's second and third pilots, picked under the hangar's CUSTOMIZE (`_LSS_SEATS.azure` / `.frostfang` in the game;
`_LSS_SEATS.pilot` is now a getter for the chosen one). Two differences from the first pilot:

- **Rigged in an A-pose (Azure) and a T-pose (Frostfang), with FINGER bones** (50 / 44 joints). Their hands never touched
  their legs, so there is nothing to cut: `--handfix 0` skips steps 3-5 (handfix.py does not know finger bones anyway).
- **Meshy gave them only a cross-legged FLOOR sit.** The seat is fitted to, and the game asks for, the first pilot's
  `Sit_Alert` (+ `Sit_Cheer_with_Left_Hand`), so `--retarget` brings those over (`retarget.py`). Their rest poses differ
  from his (arms down vs 45 deg vs straight out: bone directions 27-31 deg / 66-70 deg apart), so a bone's local rotation
  means something else on each rig. Limbs are AIMED like the source (`QT = (QS QS0^-1) A QT0`, `A` = the shortest turn from
  the target's rest bone direction onto the source's); the trunk takes the source's motion away from ITS rest onto the
  target's own rest. Bones the source lacks (fingers) keep their rest pose.

```bash
"$B" -b --factory-startup -P tools/blender/chars/char_pipeline.py -- --name Azure \
    --dir assets_base/objects/characters/Meshy_AI_Azure_Vanguard_biped --out tools/blender/work/chars/pilot_azure.glb \
    --report tools/blender/work/chars/azure_report.json --handfix 0 \
    --retarget assets_src/objects/characters/pilot_ashman.glb:Sit_Alert,Sit_Cheer_with_Left_Hand --feet Talk_Passionately
cp tools/blender/work/chars/pilot_azure.glb assets_src/objects/characters/pilot_azure_seat.glb   # the in-seat LOD source
cp tools/blender/work/chars/pilot_azure.glb assets_src/objects/characters/pilot_azure.glb        # (v53.64) the gameshow's full file
node tools/compress_glb.mjs --only characters/pilot_azure
```

(Frostfang: the same with `--name Frostfang`, his folder, `pilot_frostfang` and `--feet Talk_with_Hands_Open`.) ⚠ The retarget
reads the FIRST pilot's assets_src file: since v53.66 its Stand_Talking_Angry has level feet, which does not touch the
Sit_Alert / cheer brought over. (v53.64) Both files now ship: the `_seat` LOD and the full one the gameshow stands in. The
text below is from v53.44, when only the `_seat` LOD went into assets_src:
the game uses it for the seat, the hangar stand and the CUSTOMIZE line-up, and a full-size copy there would ship ~10 MB
nobody loads.

**Stretch report caveat:** both read thousands of >4x edges even in Meshy's OWN walk. It is real movement (up to 7-12 cm)
on spine-weighted vertices - Azure's long hair, Frostfang's tail - not the hands; the retargeted sit is no worse than their
own clips.

## Seat fitting: tails and headroom (v53.44)

- `--tail 1`: a tail skinned to the hips made "the lowest hip vertex" its tip (butt -0.09 m, every seat scaled him to
  ~60%). With it the cushion contact is read off the thighs and the back off the spine only.
- `--headroom CM --headroom_frames F1,F2,...`: the HEAD (head / neck bones + anything above eye level: ears, a mane, hair)
  is posed at those frames and measured against the canopy (glass + frame, a ray UP from the cushion's height finds the
  glass's inner face) after the eye fit. Owner, on Frostfang's head through the Slayer's glass: "lower the pilots down
  into their seats instead of resizing them, it's okay if they're almost touching the glass" -> `--headroom_mode lower`
  (the default) drops the body by exactly the shortfall (a vertical drop moves every head point straight down under the
  same glass); `shrink` scales it about the cushion instead. Measured with 1 cm and 8 frames of Sit_Alert: the FIRST
  pilot was through the glass too (Slayer -17, Puncture -13, Tracker -4 cm) and got the same drop in the game table.
- The Slayer's numbers assume its RAISED canopy (v53.44, `backups/concept_ships/canopy/scripts/slayer_glass_raise.py` +
  `glass_splice.mjs`): with the old glass the drops there were ~18-21 cm.
