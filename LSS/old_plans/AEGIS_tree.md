# Aegis Tree: ship evolutions past rank 20

**Status:** planned with the owner on 2026-11-02. Nothing is built. One number is still open (the cost of a rank past 20, below).
**Builds on:** [`AEGIS_ships.md`](AEGIS_ships.md), the July ladder (ranks 1-20, the 35 fixed unlocks, live since v34.99).

## Why

The July ladder ends at 20: every ship gets the same seven unlocks and then there is nothing left to earn. The owner wants a second stage on top of it:

> "so this would be after you reach level 20, level 21.... various abilities for each ship will unlock and you can start dumping aegis xp into them to level those abilities or weapon upgrades"

The inspiration is R-Type, where weapons change SHAPE as they upgrade, not just numbers:

> "laser beams turned into tri-beams, or wider beams... rockets turned into splitting rockets or small clusters... stuff like that"

R-Type's rule is the one worth keeping: the weapon's TYPE is a choice and its LEVEL is earned.

## The rules

1. **Ranks 1-20 do not change.** The 35 fixed unlocks stay the same for every pilot.
2. **Every rank past 20 is one point.** All four slots open at 20, and a point goes wherever you want it. Owner: *"you can choose to power up just the weapon, or just an ability or spread it out how you want per rank"*.
3. **Four slots per ship: the weapon and its three abilities.** The core is not a slot. Owner: *"each ship has a weapon plus 3 abilities, currently... so there would be 4 upgrade slots per ship"*.
4. **Evolutions.** A weapon has 3 evolutions, and each ability has 2. Every evolution has 3 levels (I, II, III), and a point buys one level.
   - That makes 27 levels per ship, so a fully grown ship reads **Aegis 47**.
   - Level I is where the new shape appears, II makes it stronger, and III adds its signature twist.
5. **One active evolution per slot, switched for free at any time.** Levels you bought stay bought, so you can grow both Tri-beam and Lance and swap between them.
   - *Working rule: proposed, and the owner did not object, but it was never explicitly confirmed.*
6. **Points bank. You place them later.** Owner's pick: *"Bank it, place later"*.
   - A rank-up past 20 says so on its banner ("AEGIS 21 · point banked").
   - A small chip next to the Aegis readout on the HUD shows how many points are waiting.
   - Nothing pops up and nothing pauses. The owner's standing rule is never to take the stick away.
   - Points are placed from the **scoreboard's Aegis card** (a toggle since v54.55), or from the **hangar's Aegis panel** between runs.
   - On the card: the D-pad or arrow keys move between slots and evolutions, and A, Enter or a click places a point. The same card switches which evolution is active.
7. **XP already earned past 20 is honoured.** When the tree ships, each ladder turns the XP it already holds past 20 into points straight away. Owner: *"Yes, honour it"*.
   - Past a full tree, XP keeps saving and the rank can keep counting as a bragging number.
8. **Every Aegis mode, each kept separate.** Owner: *"this will be for all the modes with aegis, and we will keep them separate"*.

| Mode | Ladder | The tree |
|---|---|---|
| Exhibition | `lss_aegis`, permanent | permanent |
| Campaign | `lss_aegis_camp`, permanent (v53.08) | permanent, its own |
| Endless | the run's ladder (`run.aegis`), 0-20 from bolts | **per run**: resets when you die or leave |
| PvP | none (Aegis is solo-only) | never |
| Co-op | none today | not at first: the other players would need the new shot shapes sent to them |

### Endless is the sandbox

Owner: *"because you rank up so fast, i can get to level 20 in like 10-15 mins. so endless is actually a good way to complete a skill tree pretty quick to see if that's what you'd want to do for the other modes... endless is temporary, and over when you leave the game or die"*.

- A rank in endless keeps its flat cost of 100 XP (`_EAEGIS_RANK_XP`). A bolt pays 100 on easy, 70 on medium and 50 on hard (`_EAEGIS_XP_MUL`). So a whole tree is about 27 bolts past 20 on easy.
- **Endless keeps everything it has.** Owner: *"endless stays the same... so the speed upgrades keep piling up as well"*.
  - Past 20, every bolt still pays +1 life (up to double your starting lives) or +250 m, plus +1 % speed.
  - Its XP now ALSO builds ranks, and each rank is a point.

## Still open: the cost of a rank past 20 (Exhibition and campaign)

The ladder's curve cannot continue past 20. `stepXp(r) = 300 x 1.33^r` makes each rank 33 % dearer than the last: rank 21 would cost about 90 k XP, rank 30 about 1.6 M, and rank 47 about 150 M.

Past 20 the cost should be flat, or rise gently. Two anchors bracket it:

| Anchor | XP a rank | Full tree (27 ranks) | Feel |
|---|---|---|---|
| The last rank before 20 | ~67.7 k | ~1.83 M (nearly 7x the 1-20 ladder) | the pace you are used to just carries on |
| The tree costs what the ladder cost | ~10 k | ~272 k | a point every few hundred kills |

The right value probably sits between the two. **Set it after measuring an hour of normal play in each mode.**

What XP pays today:

| Source | XP |
|---|---|
| A kill | 33 (`AEGIS.XP_PER_KILL`) |
| A cleared rift cavern | 100 (`AEGIS.CAVERN_BONUS`) |
| A city carrier | 165 (`OW.XP.carrier` x5) |
| A Summoner station | 330 (`OW.XP.sum` x10) |
| A leviathan boss | 990 (`OW.XP.boss` x30) |

## The evolutions

Every evolution below is written as its three levels, I, II and III. The owner approved the list (*"I love all the other ideas"*), except Slayer's Bulwark III, which changed (see Slayer). Two entries were added while writing this up and need the owner's eye: Tracker's **Echo**, and the **+2 / +4** wording on Syphon's Homing swarm.

### Vortex: Corvette Beam

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Energy Blaster | **Tri-beam** | twin bolts | a 3-bolt fan | the fan converges on the crosshair |
| | **Lance** | a wider bolt | pierces one ship | pierces everything in line |
| | **Prism** | ricochets off rock once | twice | splits at every bounce |
| Laser | **Split** | forks in 2 on hit | in 3 | every fork forks again |
| | **Sweep** | a wider beam | sweeps a fan | the fan leaves a burning line |
| Vortex Shield | **Scatter return** | caught shots return as a spread | a wider spread | twice as many |
| | **Homing return** | returned shots seek targets | harder | they split on hit |
| Plasma Mines | **Seeker** | mines drift toward ships | faster | dropped in pairs |
| | **Chain** | a blast sets off its neighbours | bigger blasts | chained blasts stun |

### Pyro: Dreadnought Igniter

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Thermite Launcher | **Cluster** | bursts into 3 bomblets | 5 | 7 |
| | **Napalm** | leaves a burning trail | a longer trail | the trail burns harder |
| | **Skipper** | bounces once, igniting where it lands | twice | three times |
| Flame Chain | **Twin chain** | a V of two lines | three-way | wider |
| | **Fire ring** | a ring around you | bigger | the ring expands outward |
| Fire Shield | **Flashback** | releasing it throws a fire cone | wider | blocked damage feeds the cone |
| | **Inferno** | the burn reaches farther | stronger | shots it blocks explode |
| Explosive Gas | **Chain ignition** | one cloud lights its neighbours | wider | each ignition blasts |
| | **Drift gas** | clouds drift toward ships | faster | they split in two |

### Puncture: Frigate Sniper

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Sodium Railgun | **Spread rail** | a charged shot splits in 2 | a 3-fan | the fan converges at range |
| | **Ricochet rail** | bounces to a second target | a third | each bounce hits harder |
| | **Piercer** | through one ship | through all in line | more damage per ship |
| Cluster Missile | **Splitting** | splits in 2 mid-flight | in 3 | each split airbursts |
| | **MIRV** | the airburst throws homing bomblets | more bomblets | the bomblets burn |
| Afterburner | **Slipstream** | leaves a burning contrail | longer | the contrail slows ships |
| | **Ram** | boosting into ships damages them | more | knocks them away |
| Stasis Trap | **Gravity well** | pulls ships in | stronger | collapses in a blast |
| | **Tripwire** | two traps link with a rooting beam | longer | the beam damages |

### Slayer: Frigate Duelist

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Shotgun | **Choke** | a tighter pattern | longer reach | a heavy slug in the centre |
| | **Scatter** | 12 pellets | wider | pellets split again |
| | **Flechette** | pellets ricochet | twice | ricochets seek |
| Stun Bolt | **Chain bolt** | arcs to 1 more ship | to 2 | to 3 |
| | **Split bolt** | splits into 3 | 5 | every split stuns |
| Absorption | **Reflect** | returns some blocked damage as a shockwave | more | the shockwave stuns |
| | **Bulwark** | blocks 80 % | 90 % | **Parry**: raised just as a hit lands, it blocks all of that hit |
| Teleport | **Afterimage** | a blast where you left | bigger | leaves a decoy that draws fire |
| | **Blink strike** | damages ships you pass through | more | stuns them |

Bulwark III was "you can shoot while blocking" until the owner rejected it: *"slayer cannot shoot while blocking, that's too cheap"*. Parry rewards timing instead. Absorption still never lets Slayer shoot.

### Tracker: Corvette Spotter

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Tracking Bolt | **Twin bolt** | an alternating pair | a 3-round burst | every round adds a lock |
| | **Seeker** | gentle homing | stronger | curves round cover |
| | **Echo** *(new, for review)* | a second bolt follows the first | two followers | the followers home on locked ships |
| Tracker Rockets | **Splitting** | each rocket splits in 2 near its target | in 3 | the splits add locks |
| | **Swarm** | twice the rockets at half the damage | triple | ships with 2 of 3 locks get rockets too |
| Plasma Shield | **Mirror** | shots that hit it bounce back | more | reflected shots home |
| | **Bastion** | bigger | lasts longer | follows you |
| Sonar Pulse | **Sonar mine** | sticks to a ship and pulses | twice | each pulse adds 2 locks |
| | **Wide sonar** | a bigger radius | lasts longer | reveals through rock |

### Blaster: Dreadnought Gunner

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Gatling Cannon | **Twin barrels** | two streams | faster spin-up | the streams converge |
| | **Flak** | rounds burst near ships | bigger bursts | bursts chain |
| | **Incendiary** | rounds burn | burns stack | burns spread ship to ship |
| Charge Shot | **Split charge** | a fan of 3 | 5 | the fan converges |
| | **Drill** | pierces | more damage per pierce | leaves a burning wake |
| Body Shield | **Reflector** | shots reflect off it | more | reflected shots home |
| | **Dome** | wraps around you | bigger | bursts outward when it breaks |
| Range Mode | **Overdrive** | switching modes gives a fire-rate burst | longer | refills ammo |
| | **Siege** | long mode anchors you for more range | more damage | shots pierce |

### Syphon: Corvette Drainer

| Slot | Evolution | I | II | III |
|---|---|---|---|---|
| Zapper | **Chain lightning** | arcs to a 2nd target | a 3rd | the arcs leech shield |
| | **Arc cone** | a short wide cone | wider | the cone stuns |
| | **Leech** | hits heal your hull | more | the overflow becomes shield |
| Rocket Salvo | **Cluster salvo** | each rocket bursts into 3 | bigger bursts | they burn |
| | **Homing swarm** | rockets home | +2 rockets | +4 rockets |
| Energy Syphon | **Wide syphon** | drains every ship in a cone | a wider cone | drains longer |
| | **Overcharge** | draining past full becomes overshield | a bigger cap | the overshield pulses damage |
| Inner Spark | **Spark burst** | the reset releases an EMP pulse | bigger | the pulse stuns |
| | **Double spark** | two charges | faster recharge | it also refills ammo |

Homing swarm counts rockets as "+2 / +4" rather than "8 / 10". The salvo already fires 10 once Syphon reaches rank 20: Apex Ship sets `player.syphonMissileRacks`, which doubles it (v36.67). Every pilot in the tree is past 20, so a fixed 8 or 10 would be no upgrade for anyone.

## How it stacks with ranks 1-20

Some ladder unlocks already change shape. The evolutions build on top of them rather than repeating them:

| Ship | Ladder unlocks that already shape a weapon or ability |
|---|---|
| Pyro | Double / Triple Threat (2 or 3 bolts a trigger pull) |
| Puncture | Twin Cluster, Explosive Traps, Trap Mastery, the railgun's pierce multiplier |
| Slayer | Ghost in the Machine (2 teleports), Wraith |
| Tracker | Splasher Rounds, Extended Ammo |
| Blaster | Piercing Rounds |
| Syphon | Apex Ship (rank 20: the Rocket Salvo fires 10 rockets, not 5) |

Examples:
- Pyro at Triple Threat with Cluster III fires 3 bolts of 7 bomblets each.
- Puncture's Twin Cluster with Splitting III fires two missiles that each split in 3 and airburst.

## Notes for whoever builds it (read from the code on 2026-11-02)

- **Change shots where they are fired.** Evolutions hook the shot at its spawn, the way Twin Cluster adds a second projectile at the Cluster Missile spawn. They must **never mutate `player.weapon`**: that is a shared `LOADOUTS` reference, the v34.99 trap.
- **Pieces that already exist:**
  - **Ricochet:** `Projectile` already bounces off walls up to 3 times, losing speed (x0.5, x0.75 for fire sources) on each bounce, using `getWallNormal`. A lossless bounce flag covers Prism, Skipper, Ricochet rail and Flechette.
  - **Piercing:** hitscan already has a piercing gate (`isPiercing`, Blaster's Piercing Rounds).
  - **Splits and bursts:** the Cluster Missile already airbursts, and `spawnExplosion`'s `opts.mini` / `opts.cloud` make many small blasts in one frame (bomblets, cluster salvos).
  - **Extra shots:** Pyro's Double / Triple Threat already fires extra bolts.
- **The ladder's invariants still hold:**
  - Applies use absolute assignments, so applying twice is safe.
  - Teardown restores base stats so nothing leaks into multiplayer.
  - `_aegisApply` runs once per chassis reset.
  - `_aegisSoloOnly` and `_aegisLadderMode` gate where any of it runs.
- **New saved state.** Placements (which evolution has which level, which one is active, points unspent) are new data for each ship on each ladder. The account sync merges XP by highest value. Placements need their own merge rule.
- **UI:**
  - The scoreboard card (`_sbAegisHtml`, v54.55) becomes the place to spend points.
  - The hangar panel (`_aegisPanelOpen`) shows the whole tree.
  - In Exhibition the D-pad cycles ships (`cycleHubShip`), so while the card is open the D-pad must belong to the card.
  - Phone: placing by tapping the card. VR: its scoreboard is a different surface, so it needs its own way later.
- **Endless:** the run ladder is `run.aegis` with `_EAEGIS_MAX` (20), `_EAEGIS_RANK_XP` and `_EAEGIS_XP_MUL`. The rewards a bolt pays past 20 are `_endlessLivesCapFor`, `_EAEGIS_DIST_BONUS` and `run.aegis.overSpd`. The run's tree resets wherever the run's Aegis does today (`onBuildWorld` / `onTeardown`).
- **Every evolution needs its own look.** A tri-beam has to READ as three beams. The owner judges looks by flying them.
