# 3DPrints: Last Ship Sailing models, ready to print

Every file here is a single closed (watertight) solid in binary STL, Z-up, sitting at the
origin, sized in millimetres. Load one into your slicer (Lychee, Chitubox, Bambu Studio...) and
it needs no repair. `previews.png` shows them all; `report.json` has the numbers for each.

| folder | what | size (long side) | source |
| --- | --- | --- | --- |
| `ships/` | the 7 player ships | 80 mm | `assets_base/ships/` (the v37.23 hulls, before any cockpit was cut into them) |
| `hoard/` | the 22 hoard ships + the carrier | 60 mm (carrier 160 mm) | `LSS/objects/hoard/`, `LSS/objects/carrier.glb` |
| `monsters/` | FleshMaw, GraveTitan, HallowWalker, IronBloom, StoneShroud, VoidGazer | 80 mm tall | `LSS/objects/` |

## What was done to them

- Hundreds of overlapping, open game shells merged into one solid; internal debris and
  enclosed voids removed (trapped resin cracks a print).
- Cockpit interior pieces (glass, harness, flight marker) left out.
- Anything thinner than 0.4 mm thickened by 0.15 mm a side so fins, antennae and spikes
  survive printing and washing. That touched well under 1% of each model.
- Resolution: 0.1 mm (the carrier 0.2 mm), finer than the detail a resin printer resolves at these sizes.

Scaling **up** in the slicer is always safe. Scaling **down** much below these sizes brings back
features too thin to print; re-run the script with a different size instead.

## Printing notes (resin)

- **Solid is fine for the ships and hoard** (4 to 32 ml each). **Hollow the carrier**
  (151 ml solid) and FleshMaw (63 ml) in your slicer, with 1.5 to 2 mm walls and two drain
  holes on the underside.
- Angle ships 30 to 45 degrees with supports on the belly, so the top detail stays clean.
- A few models include small separate pieces that the game floats beside the hull. Support them
  on their own or delete them in the slicer: vortex (1), redlegend (1), zone (2), carrier (3),
  GraveTitan (4). Each is between 2 and 21 mm^3.

## Regenerating

```bash
pip install trimesh libigl pymeshfix fast-simplification scikit-image scipy numpy matplotlib
python tools/print3d/prepare_prints.py                 # all models (~35 min)
python tools/print3d/prepare_prints.py --only slayer   # just one
python tools/print3d/preview_prints.py                 # rebuild previews.png
```

The owner's hi-poly originals (`assets_base/ships_original/`, kept out of git) should give even
crisper player ships: `python tools/print3d/prepare_prints.py --only blaster,puncture,pyro,slayer,syphon,tracker,vortex --ships-dir assets_base/ships_original`.
