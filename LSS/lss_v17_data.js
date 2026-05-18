// v17 data registries extracted from last_ship_sailing_v17.html
// Pure data ; no runtime behavior. Load before any system that
// references LSS / CHASSIS / LOADOUTS / PILOT_PERKS / MAP_DATA.

// =====================================================================
// LSS DATA REGISTRIES (extracted from last_ship_sailing_v17.html)
// Pure-data tables; no behavior. Safe to paste into any module that
// declares `const SU = 150;` before MAP_DATA (or define it here).
// =====================================================================

const LSS = {
  MAX_PLAYERS: 12, TEAM_FLEET_A: 2, TEAM_FLEET_B: 3,
  ROUND_TIME: 80, WARMUP_TIME: 5, ROUNDS_TO_WIN: 4,
  // (v6.9) Champion mode: at CHAMPION_TIME seconds remaining, a giant
  // purple stasis field spawns at map center. The first team to hold a
  // ship inside it for CHAMPION_CHARGE_TIME seconds wins the round. A
  // charging ship that dies in the field loses the round. If the timer
  // runs out with no champion declared, total team HP breaks the tie.
  CHAMPION_TIME: 10,
  CHAMPION_CHARGE_TIME: 3, // (v16) capture takes 3s ; if the capturer dies, the field is freed and any other ship can try again. Win regardless of HP. The longer window gives dash-ram defenders a real chance to break the claim mid-charge.
  SPAWN_PROTECTION: 3, DOOMED_HEALTH_PCT: 0.15, DOOMED_TIMER: 10,
  GRAVITY: 0, ARENA_SIZE: 25000, TICK_RATE: 60,
  // Seconds shown on the in-screen 3-2-1-LAUNCH ticker. The round-system
  // warmupTimer is kept in lockstep with this so bots stay in 'warmup' (no
  // firing, no movement) for the full duration of the visible countdown.
  LAUNCH_COUNTDOWN: 10,
  // Reserved for a future multiplayer match-start handshake redesign.
  // The first attempt at a "world_ready" gate + in-game 3-2-1 was rolled
  // back ; these constants stay so the next pass has the values to
  // reach for without rederiving them. Not consulted by any current
  // code path.
  READY_TIMEOUT: 10,
  INGAME_COUNTDOWN: 3.5,
  // (v13r) Race mode. MODE drives a few targeted divergences from classic:
  //   * All chassis get clamped to RACE_SPEED (and RACE_DASH_SPEED) so the
  //     race is fair regardless of which ship the player picked.
  //   * spawnChampionField() fires at round start instead of at
  //     CHAMPION_TIME seconds remaining ; the champion-flagged room IS
  //     the finish line.
  //   * Bot AI gains a "seek champion room" steering layer that walks the
  //     rooms+tunnels graph (BFS) toward the finish.
  // Combat stays on, so kill-or-finish both still resolve the round
  // through the existing championResult / round_end pipeline.
  MODE: 'classic',           // 'classic' | 'race'
  RACE_SPEED: 900,           // baseline race velocity for all chassis
  RACE_DASH_SPEED: 1400,     // dash/afterburner velocity in race mode
};

// ---- CHASSIS DEFINITIONS ----
const CHASSIS = {
  FRIGATE: {
    name: 'Frigate', maxHealth: 7500, maxShield: 2500,
    shieldRegenRate: 200, shieldRegenDelay: 5,
    flightSpeed: 450, strafeSpeed: 350, verticalSpeed: 300,
    acceleration: 1200, deceleration: 800,
    turnRate: 180, pitchRate: 120,
    maxDashes: 3, dashSpeed: 900, dashDuration: 0.4, dashCooldown: 4,
    hullWidth: 60, hullHeight: 25, hullLength: 80, mass: 5000,
    color: 0x44aaff, healthSegments: 3,
  },
  CORVETTE: {
    name: 'Corvette', maxHealth: 10000, maxShield: 3500,
    shieldRegenRate: 175, shieldRegenDelay: 6,
    flightSpeed: 350, strafeSpeed: 280, verticalSpeed: 250,
    acceleration: 800, deceleration: 600,
    turnRate: 140, pitchRate: 100,
    maxDashes: 2, dashSpeed: 750, dashDuration: 0.5, dashCooldown: 5,
    hullWidth: 80, hullHeight: 30, hullLength: 100, mass: 8000,
    color: 0x44cc44, healthSegments: 4,
  },
  DREADNOUGHT: {
    name: 'Dreadnought', maxHealth: 12500, maxShield: 5000,
    shieldRegenRate: 150, shieldRegenDelay: 8,
    flightSpeed: 250, strafeSpeed: 180, verticalSpeed: 160,
    acceleration: 500, deceleration: 400,
    turnRate: 100, pitchRate: 70,
    maxDashes: 1, dashSpeed: 550, dashDuration: 0.6, dashCooldown: 7,
    hullWidth: 110, hullHeight: 45, hullLength: 140, mass: 15000,
    color: 0xff6644, healthSegments: 5,
  }
};

// ---- LOADOUT DEFINITIONS (ported from SDK lss_loadout_data.cpp) ----

// Class identity colors used for weapons / abilities / cores / shields / class-tied effects.
// Reference these everywhere a class-tied tint is needed (projectiles, beams, particles,
// tracers, shields, lightning, traps, core abilities) instead of repeating literals.
LSS.CLASS_COLORS = {
  BLASTER:  0x44eeff, // cyan
  PYRO:     0xff3322, // red
  PUNCTURE: 0xffee44, // yellow
  TRACKER:  0xff8800, // orange
  SLAYER:   0x44ff66, // green
  VORTEX:   0xaa55ff, // purple
  SYPHON:   0x4488ff, // blue
};

// (v16 perks) Pilot perk registry. Each player picks ONE perk from this
// list in the ship-select screen ; the choice is persisted to localStorage
// across sessions. Perk effects are applied in commitLoadout (one-shot
// stat bumps like +shield, +dash) and ticked in the gameLoop (per-frame
// effects like nano repair, auto cloak timer, outline optics render).
const PILOT_PERKS = {
  outline: {
    id: 'outline',
    name: 'Outline Optics',
    desc: 'Crisp silhouette outline on every ship in your line of sight ; green allies, red enemies. Sees through clouds, blocked by walls.',
    icon: '\u25c9',
    color: 0x66ddff,
  },
  shield: {
    id: 'shield',
    name: 'Reinforced Shield',
    desc: '+1000 max shield HP. Tanks more burst damage before your hull is exposed.',
    icon: '\u26e8',
    color: 0xaaccff,
    shieldBonus: 1000,
  },
  dash: {
    id: 'dash',
    name: 'Extra Dash',
    desc: '+1 dash charge. More room for evasive maneuvers and ram pressure.',
    icon: '\u27ff',
    color: 0xffcc66,
    dashBonus: 1,
  },
  cloak: {
    id: 'cloak',
    name: 'Auto Cloak',
    desc: 'When your core charges past 75%, your ship goes 99% transparent for 4s. Use the window to reposition.',
    icon: '\u25cc',
    color: 0xaa66ff,
    cloakOnCoreCharge: 75,   // % core meter that triggers a cloak window
    cloakDuration: 4,
    cloakOpacity: 0.01,      // 99% transparent
  },
  nano: {
    id: 'nano',
    name: 'Nano Repair',
    desc: '1% of max HP regenerated per second; over-heals past max up to 2x hull.',
    icon: '\u2720',
    color: 0x66ff88,
    regenPerSec: 0.01,
    overhealMult: 2.0,
  },
};
// Default perk if the player hasn't picked one yet (or localStorage missing).
const PILOT_PERK_DEFAULT = 'shield';

const LOADOUTS = {
  VORTEX: {
    name: 'VORTEX', className: 'Corvette Beam', chassis: 'CORVETTE',
    weapon: { name: 'Energy Blaster', mode: 'hitscan', damage: 380, fireRate: 0.25, clipSize: 30, range: 3000, splash: 0, projSpeed: 0, pellets: 1, spinup: 0 },
    abilities: [
      { name: 'Laser', cooldown: 5, duration: 0.5, desc: 'Massive beam: 2400 damage', type: 'offensive', dmg: 2400 },
      { name: 'Vortex Shield', cooldown: 0, duration: 999, desc: 'Hold to absorb and return projectiles', type: 'defensive' },
      { name: 'Plasma Mines', cooldown: 12, duration: 12, desc: 'Proximity mines on contact', type: 'utility' },
    ],
    core: { name: 'Mega Laser', desc: 'Continuous high-power laser', duration: 4, damage: 12000, cooldown: 60 },
  },
  PYRO: {
    name: 'PYRO', className: 'Dreadnought Igniter', chassis: 'DREADNOUGHT',
    weapon: { name: 'Thermite Launcher', mode: 'projectile', damage: 900, fireRate: 1.2, clipSize: 12, range: 2500, splash: 300, projSpeed: 600, pellets: 1, spinup: 0 },
    abilities: [
      { name: 'Flame Chain', cooldown: 10, duration: 6, desc: 'Fire line: 400 DPS', type: 'offensive', dmg: 2400 },
      { name: 'Fire Shield', cooldown: 0, duration: 5, desc: 'Hold up to 5s; blocks attacks, burns close enemies (recharges over 10s)', type: 'defensive' },
      { name: 'Explosive Gas', cooldown: 15, duration: 10, desc: 'Area denial fire', type: 'utility' },
    ],
    core: { name: 'Mega Flame Chain', desc: 'Massive AoE incendiary', duration: 2, damage: 9000, cooldown: 60 },
  },
  PUNCTURE: {
    name: 'PUNCTURE', className: 'Frigate Sniper', chassis: 'FRIGATE',
    weapon: { name: 'Sodium Railgun', mode: 'hitscan', damage: 1000, fireRate: 1.5, clipSize: 6, range: 4500, splash: 50, projSpeed: 0, pellets: 1, spinup: 0 },
    abilities: [
      { name: 'Cluster Missile', cooldown: 8, duration: 0.3, desc: 'Impact 800 + 500 DPS for 5s', type: 'offensive', dmg: 3300 },
      { name: 'Afterburner', cooldown: 10, duration: 3, desc: 'Speed boost to 600', type: 'defensive' },
      { name: 'Stasis Trap', cooldown: 12, duration: 4, desc: 'Slow and root enemies', type: 'utility' },
    ],
    core: { name: 'Mega Barrage', desc: 'Speed boost + rocket barrage', duration: 5, damage: 7000, cooldown: 60 },
  },
  SLAYER: {
    name: 'SLAYER', className: 'Frigate Duelist', chassis: 'FRIGATE',
    weapon: { name: 'Shotgun', mode: 'spread', damage: 200, fireRate: 0.85, clipSize: 4, range: 900, splash: 0, projSpeed: 350, pellets: 8, spinup: 0 },
    abilities: [
      { name: 'Stun Bolt', cooldown: 8, duration: 0.1, desc: 'Electric proj: 2000 damage', type: 'offensive', dmg: 2000 },
      { name: 'Absorption', cooldown: 0, duration: 999, desc: 'Block 70% incoming (85% Mega Stun Bolt); can\'t shoot', type: 'defensive' },
      { name: 'Teleport', cooldown: 6, duration: 0.2, desc: 'Teleport dash', type: 'utility' },
    ],
    core: { name: 'Mega Stun Bolt', desc: 'Charged Shockwave + Stun Bolt Flurry', duration: 5, damage: 9000, cooldown: 60 },
  },
  TRACKER: {
    name: 'TRACKER', className: 'Corvette Spotter', chassis: 'CORVETTE',
    // (v9) Slower fire rate (0.6 -> 0.85 sec/shot) and tighter clip (20 -> 12)
    // so the main gun is paced more like a sniper-spotter instead of a chaingun.
    // Each main-gun hit still adds +1 lock to its target (capped at 3).
    weapon: { name: 'Tracking Bolt', mode: 'projectile', damage: 660, fireRate: 0.85, clipSize: 12, range: 3500, splash: 0, projSpeed: 900, pellets: 1, spinup: 0 },
    abilities: [
      // (v9) Tracker Rockets: no real cooldown. The gating is the lock state:
      // pressing the ability does NOTHING unless at least one ship has a full
      // 3/3 lock, in which case it fires a 5-rocket volley at every fully
      // locked target and consumes only those full locks (partial 1/3 or 2/3
      // locks on other ships are preserved). The 0.25s cooldown below is just
      // there to dodge the cooldown===0 toggle path in activateAbility ; it
      // is effectively instant from the player's perspective.
      { name: 'Tracker Rockets', cooldown: 0.25, duration: 0.5, desc: 'Volley at every 3/3-locked ship; partial locks preserved', type: 'offensive', dmg: 5000 },
      { name: 'Plasma Shield', cooldown: 14, duration: 0.1, desc: 'Deploy one-way shield (10000 HP, 10s)', type: 'defensive' },
      { name: 'Sonar Pulse', cooldown: 12, duration: 8, desc: 'Fire beacon; sphere of detection grants +1 lock per ship in radius', type: 'utility' },
    ],
    core: { name: 'Mega Tracker Rockets', desc: 'Massive missile barrage', duration: 3, damage: 11000, cooldown: 60 },
  },
  BLASTER: {
    name: 'BLASTER', className: 'Dreadnought Gunner', chassis: 'DREADNOUGHT',
    weapon: { name: 'Gatling Cannon', mode: 'hitscan', damage: 85, fireRate: 0.05, clipSize: 150, range: 1500, splash: 0, projSpeed: 0, pellets: 1, spinup: 1.2, spread: 0.04 }, // close range defaults
    abilities: [
      { name: 'Charge Shot', cooldown: 8, duration: 0.1, desc: 'High-power: 3200 damage', type: 'offensive', dmg: 3200 },
      { name: 'Body Shield', cooldown: 0, duration: 999, desc: 'Frontal shield (5000 HP, 10s)', type: 'defensive' },
      { name: 'Range Mode', cooldown: 2, duration: 0.05, desc: 'Close/long range modes', type: 'utility' },
    ],
    core: { name: 'AI Assist', desc: 'Auto-aim + unlimited ammo', duration: 10, damage: 10000, cooldown: 60 },
  },
  SYPHON: {
    name: 'SYPHON', className: 'Corvette Drainer', chassis: 'CORVETTE',
    weapon: { name: 'Zapper', mode: 'hitscan', damage: 240, fireRate: 0.09, clipSize: 40, range: 3000, splash: 0, projSpeed: 0, pellets: 1, spinup: 0.4 },
    abilities: [
      { name: 'Rocket Salvo', cooldown: 6, duration: 0.3, desc: '5 rockets (10 with Missile Racks)', type: 'offensive', dmg: 3500 },
      { name: 'Energy Syphon', cooldown: 8, duration: 2, desc: 'Drain shields: 800 heal', type: 'defensive' },
      { name: 'Inner Spark', cooldown: 12, duration: 0.1, desc: 'Reset ability cooldowns', type: 'utility' },
    ],
    core: { name: 'AI Nanobots', desc: '3 tiers of permanent upgrades', duration: 12, damage: 3000, cooldown: 60 },
  },
};

// ---- WALL PATTERN NAMES (index -> name) ----
const WALL_PATTERN_NAMES = [
  'Kali IFS (cosmic)',
  'Apollonian Gasket',
  'Voronoi Cells',
  'Wave Interference',
  'Mandelbox Folds',
  'Hex Lattice',
  'Plasma FBM',
  'Circumpunct Lattice',
  'Soul Array (dot lattice)',
  // (post-v6.9 patch, 2026-04-28) Lab-authored high-tech patterns.
  // Same dispatcher as patterns 0-7; route through cosmicField.
  'Circuit Traces',
  'Holographic Glitch',
  'Cellular Membrane',
  'Warped Streaks',
  'Caustic Shimmer',
  'Hex Pulse Radar',
  'Cyber Datamosh',
  'Neon Cube (raymarched)',
  'Panel Maze (architectural)',
  'Ring Tunnel',
  'Layered Cube (transparent)',
  // (v7.1) Special composite slot at index 20. Routes to the multi-layer
  // BG/FG1/FG2 path (Panel Maze + Layered Cube + Wave Interference baked
  // from a mixed_lab_v2 export). The cosmicField shader function checks
  // uPattern == 99 internally, but the wallPattern dispatcher sets
  // uPattern via `(game.wallPattern | 0) % WALL_PATTERN_NAMES.length`,
  // which means index 20 in this array maps to a uPattern of 20 ; the
  // shader-side code maps that into the composite branch below.
  'Lab Composite (3-layer)',
  // (v8VR 2026-05-01) "Digital" preset: another multi-layer composite,
  // routed through the same cosmicField() shader path as Lab Composite.
  // BG = Layered Cube (game 19), FG1 = Cyber Datamosh (game 15) Multiply,
  // FG2 = Plasma FBM (game 6) Multiply. Per-layer values lifted from
  // Mixed Lab v2 export and baked into MULTI_LAYER_PRESETS below.
  'Digital',
  // (v10) Three new user-authored multi-layer composites, exported from
  // wall_pattern_lab.html and translated lab pattern IDs -> game IDs:
  //   lab 0 (Kali) -> game 0  ;  lab 2 (Mandelbox) -> game 4
  //   lab 6 (Panel Maze) -> game 17  ;  lab 9 (Plasma FBM) -> game 6
  //   lab 15 (Cyber Datamosh) -> game 15  ;  lab 18 (Layered Cube) -> game 19
  'Datamosh Cube',  // 22 ; bg=Datamosh + fg=Layered Cube + fg2=Panel Maze
  'Mandelbox Plasma',  // 23 ; bg=Mandelbox + fg=Plasma FBM + fg2=Panel Maze
  'Mandelbox Kali',  // 24 ; bg=Mandelbox + fg=Kali + fg2=Panel Maze
  'Matrix',  // 25 ; bg=Cyber Datamosh + fg=Panel Maze x2 (digital-rain green)
  // (v11d) Three more user-authored multi-layer composites:
  'Hue-Shifting Grid',  // 26 ; bg=Panel Maze + fg=Kali + fg2=Panel Maze (blue tint)
  'Hexeizure',          // 27 ; bg=Panel Maze + fg=Mandelbox + fg2=Hex Pulse (black tint)
  'Starfield',          // 28 ; bg=Panel Maze + fg=Cyber Datamosh + fg2=Apollonian (dark-green)
  'Race Glow',          // 29 ; (v13r) triple Plasma FBM tinted neon green ; auto-flips Pure Black Base OFF for the glow look
  'Stone Folds',        // 30 ; (v14) Mandelbox depth-folds * stone texture
  'Tile Track',         // 31 ; (v14) Voronoi cells * brick tile texture
  'Sheet Metal'         // 32 ; (v14) Kali IFS structure * brushed metal texture
];

// ---- MAP DATA ----
// SU is the ship-unit: hull length of the Dreadnought + a bit of margin.
// MAP_DATA room/tunnel coords use SU multiples (except middlebars and
// race_pole_position, which are absolute world units from map_lab.html).
const SU = 150; // ship unit (Dreadnought hull + margin)

const MAP_DATA = {
  hourglass: {
    name: 'The Nexus',
    description: 'Ring layout. Six chambers. Every room connects to two others; no dead ends.',
    // Cool indigo ring with a warm gold hub (the council-chamber feel).
    // Index 0 = center, then around the hexagonal ring. The shader picks
    // the nearest room's color and steers wall hue toward it.
    palette: [
      0x4a3818, 0x2a1840, 0x1a2848, 0x18283a, 0x202848, 0x1a2840, 0x18203a, 0x1c2848
    ],
    // Feng shui arena design: circular flow, multiple flanking routes, no camping corners,
    // every room has 2+ exits, spawns on opposite sides of the ring, power position in center.
    // Layout: hexagonal ring of 6 chambers with a central hub. Spawns at north and south.
    // Every chamber connects to its neighbors AND to the center, giving 3 exits per room.
    rooms: [
      { id: 'center',  team: null, x: 0, y: 0, z: 0, r: SU * 2.5 },
      // Ring: 6 chambers at 60-degree intervals; spawns at top and bottom
      { id: 'spawn_a', team: 'A',  x: 0,             y: 0, z: -SU * 8,   r: SU * 2.2 },  // north
      { id: 'ne',      team: null, x:  SU * 7,        y: SU * 2, z: -SU * 4,   r: SU * 1.8 },
      { id: 'se',      team: null, x:  SU * 7,        y: -SU * 2, z:  SU * 4,   r: SU * 1.8 },
      { id: 'spawn_b', team: 'B',  x: 0,             y: 0, z:  SU * 8,   r: SU * 2.2 },  // south
      { id: 'sw',      team: null, x: -SU * 7,        y: -SU * 2, z:  SU * 4,   r: SU * 1.8 },
      { id: 'nw',      team: null, x: -SU * 7,        y: SU * 2, z: -SU * 4,   r: SU * 1.8 },
    ],
    tunnels: [
      // Outer ring (hexagon): each chamber to its neighbor (circular flow, no dead ends)
      { path: [{x: 0, y: 0, z: -SU*8}, {x:  SU*7, y: SU*2, z: -SU*4}]},           // spawn_a -> ne
      { path: [{x:  SU*7, y: SU*2, z: -SU*4}, {x:  SU*7, y: -SU*2, z:  SU*4}]},   // ne -> se
      { path: [{x:  SU*7, y: -SU*2, z:  SU*4}, {x: 0, y: 0, z:  SU*8}]},           // se -> spawn_b
      { path: [{x: 0, y: 0, z:  SU*8}, {x: -SU*7, y: -SU*2, z:  SU*4}]},           // spawn_b -> sw
      { path: [{x: -SU*7, y: -SU*2, z:  SU*4}, {x: -SU*7, y: SU*2, z: -SU*4}]},   // sw -> nw
      { path: [{x: -SU*7, y: SU*2, z: -SU*4}, {x: 0, y: 0, z: -SU*8}]},           // nw -> spawn_a
      // Spokes to center (every chamber connects to hub; 3 exits per room)
      { path: [{x: 0, y: 0, z: -SU*8}, {x: 0, y: 0, z: 0}]},           // spawn_a -> center
      { path: [{x:  SU*7, y: SU*2, z: -SU*4}, {x: 0, y: 0, z: 0}]},    // ne -> center
      { path: [{x:  SU*7, y: -SU*2, z:  SU*4}, {x: 0, y: 0, z: 0}]},   // se -> center
      { path: [{x: 0, y: 0, z:  SU*8}, {x: 0, y: 0, z: 0}]},           // spawn_b -> center
      { path: [{x: -SU*7, y: -SU*2, z:  SU*4}, {x: 0, y: 0, z: 0}]},   // sw -> center
      { path: [{x: -SU*7, y: SU*2, z: -SU*4}, {x: 0, y: 0, z: 0}]},    // nw -> center
    ]
  },

  // ----------------------------------------------------------------------
  // The Spine: long-axis corridor with two parallel bypass loops.
  // Favors long-range work (Puncture, Tracker). Center is the contested
  // sightline; bypass rooms (north_arc, south_arc) let flankers cross
  // the map without committing to the spine.
  // 7 rooms; spawns at z = +/- 9*SU; spans roughly +/-9 along z.
  spine: {
    name: 'The Spine',
    description: 'Long axis with parallel bypasses. Center is the killing line; flank through the arcs.',
    // Industrial gunmetal with crimson accents (the kill-corridor feel).
    palette: [
      0x1c1818, 0x281a1a, 0x2a1c1c, 0x381616, 0x281818, 0x202020, 0x301818, 0x401818
    ],
    rooms: [
      { id: 'spawn_a',  team: 'A',  x: 0,        y: 0,       z: -SU * 9, r: SU * 2.2 }, // west end
      { id: 'mid_a',    team: null, x: 0,        y: 0,       z: -SU * 4, r: SU * 2.0 },
      { id: 'center',   team: null, x: 0,        y: 0,       z:  0,      r: SU * 2.5 },
      { id: 'mid_b',    team: null, x: 0,        y: 0,       z:  SU * 4, r: SU * 2.0 },
      { id: 'spawn_b',  team: 'B',  x: 0,        y: 0,       z:  SU * 9, r: SU * 2.2 }, // east end
      { id: 'north_arc',team: null, x: SU * 5,   y: SU * 2,  z:  0,      r: SU * 1.8 }, // bypass north of spine
      { id: 'south_arc',team: null, x: -SU * 5,  y: -SU * 2, z:  0,      r: SU * 1.8 }, // bypass south of spine
    ],
    tunnels: [
      // Backbone (linear spine)
      { path: [{x: 0, y: 0, z: -SU*9}, {x: 0, y: 0, z: -SU*4}]},                    // spawn_a -> mid_a
      { path: [{x: 0, y: 0, z: -SU*4}, {x: 0, y: 0, z:  0}]},                       // mid_a -> center
      { path: [{x: 0, y: 0, z:  0},    {x: 0, y: 0, z:  SU*4}]},                    // center -> mid_b
      { path: [{x: 0, y: 0, z:  SU*4}, {x: 0, y: 0, z:  SU*9}]},                    // mid_b -> spawn_b
      // North bypass (mid_a <-> mid_b via north_arc)
      { path: [{x: 0, y: 0, z: -SU*4}, {x: SU*5, y: SU*2, z:  0}]},                 // mid_a -> north_arc
      { path: [{x: SU*5, y: SU*2, z:  0}, {x: 0, y: 0, z:  SU*4}]},                 // north_arc -> mid_b
      // South bypass (mid_a <-> mid_b via south_arc)
      { path: [{x: 0, y: 0, z: -SU*4}, {x: -SU*5, y: -SU*2, z:  0}]},               // mid_a -> south_arc
      { path: [{x: -SU*5, y: -SU*2, z:  0}, {x: 0, y: 0, z:  SU*4}]},               // south_arc -> mid_b
    ]
  },

  // ----------------------------------------------------------------------
  // The Infinity: figure-8 dual rings sharing one central pinch room.
  // Favors area control (Vortex, Pyro). Each lobe has spawn + 2 ring rooms;
  // the center is the only crossing between lobes, so denying it splits
  // the map. Two paths around each lobe, so no team can be cornered.
  // 7 rooms; spawns at x = +/- 8*SU.
  infinity: {
    name: 'The Infinity',
    description: 'Two rings joined at a pinch. Hold the center, halve the map.',
    // Teal lobe (left) and magenta lobe (right) with a hot orange center pinch.
    // Room order: spawn_a, left_n, left_s, center, spawn_b, right_n, right_s.
    palette: [
      0x103838, 0x14383a, 0x12303a, 0x4a2818, 0x381038, 0x3a1438, 0x381432, 0x183838
    ],
    rooms: [
      { id: 'spawn_a', team: 'A',  x: -SU * 8, y:  0,       z:  0,       r: SU * 2.2 },
      { id: 'left_n',  team: null, x: -SU * 4, y:  SU * 2,  z: -SU * 4,  r: SU * 1.8 },
      { id: 'left_s',  team: null, x: -SU * 4, y: -SU * 2,  z:  SU * 4,  r: SU * 1.8 },
      { id: 'center',  team: null, x:  0,      y:  0,       z:  0,       r: SU * 2.5 },
      { id: 'right_n', team: null, x:  SU * 4, y: -SU * 2,  z: -SU * 4,  r: SU * 1.8 },
      { id: 'right_s', team: null, x:  SU * 4, y:  SU * 2,  z:  SU * 4,  r: SU * 1.8 },
      { id: 'spawn_b', team: 'B',  x:  SU * 8, y:  0,       z:  0,       r: SU * 2.2 },
    ],
    tunnels: [
      // Left ring
      { path: [{x: -SU*8, y: 0, z: 0},          {x: -SU*4, y: SU*2,  z: -SU*4}]},   // spawn_a -> left_n
      { path: [{x: -SU*4, y: SU*2,  z: -SU*4},  {x:  0,    y: 0,     z:  0}]},      // left_n -> center
      { path: [{x:  0,    y: 0,     z:  0},     {x: -SU*4, y: -SU*2, z:  SU*4}]},   // center -> left_s
      { path: [{x: -SU*4, y: -SU*2, z:  SU*4},  {x: -SU*8, y: 0,     z:  0}]},      // left_s -> spawn_a
      // Right ring
      { path: [{x:  SU*8, y: 0, z: 0},          {x:  SU*4, y: -SU*2, z: -SU*4}]},   // spawn_b -> right_n
      { path: [{x:  SU*4, y: -SU*2, z: -SU*4},  {x:  0,    y: 0,     z:  0}]},      // right_n -> center
      { path: [{x:  0,    y: 0,     z:  0},     {x:  SU*4, y: SU*2,  z:  SU*4}]},   // center -> right_s
      { path: [{x:  SU*4, y: SU*2,  z:  SU*4},  {x:  SU*8, y: 0,     z:  0}]},      // right_s -> spawn_b
    ]
  },

  // ----------------------------------------------------------------------
  // The Tower: vertical stack across +/- 8*SU on the Y axis.
  // Favors 3D mobility (Slayer phase dash, Syphon, Vortex). Two horizontal
  // mid-layers connected through a central column; spawns at top and bottom
  // force vertical engagement.
  // 7 rooms; vertical span 16*SU.
  tower: {
    name: 'The Tower',
    description: 'Vertical stack. Two layers between the spawns. Watch your six in three dimensions.',
    // Vertical sky-to-forge gradient: cold purple at the top, neutral center,
    // warm amber at the bottom. Room order: spawn_a(top), mid_hi_e, mid_hi_w,
    // center, mid_lo_e, mid_lo_w, spawn_b(bottom).
    palette: [
      0x281848, 0x201840, 0x282040, 0x303030, 0x382818, 0x402818, 0x481810, 0x3a2010
    ],
    rooms: [
      { id: 'spawn_a',  team: 'A',  x:  0,       y:  SU * 8, z:  0,       r: SU * 2.2 }, // top
      { id: 'mid_hi_e', team: null, x:  SU * 4,  y:  SU * 4, z:  SU * 2,  r: SU * 1.8 },
      { id: 'mid_hi_w', team: null, x: -SU * 4,  y:  SU * 4, z: -SU * 2,  r: SU * 1.8 },
      { id: 'center',   team: null, x:  0,       y:  0,      z:  0,       r: SU * 2.5 },
      { id: 'mid_lo_e', team: null, x:  SU * 4,  y: -SU * 4, z: -SU * 2,  r: SU * 1.8 },
      { id: 'mid_lo_w', team: null, x: -SU * 4,  y: -SU * 4, z:  SU * 2,  r: SU * 1.8 },
      { id: 'spawn_b',  team: 'B',  x:  0,       y: -SU * 8, z:  0,       r: SU * 2.2 }, // bottom
    ],
    tunnels: [
      // Top spawn to upper layer
      { path: [{x:  0, y: SU*8, z: 0}, {x:  SU*4, y: SU*4, z:  SU*2}]},                  // spawn_a -> mid_hi_e
      { path: [{x:  0, y: SU*8, z: 0}, {x: -SU*4, y: SU*4, z: -SU*2}]},                  // spawn_a -> mid_hi_w
      // Upper layer cross
      { path: [{x:  SU*4, y: SU*4, z:  SU*2}, {x: -SU*4, y: SU*4, z: -SU*2}]},           // mid_hi_e -> mid_hi_w
      // Upper layer to center
      { path: [{x:  SU*4, y: SU*4, z:  SU*2}, {x: 0, y: 0, z: 0}]},                      // mid_hi_e -> center
      { path: [{x: -SU*4, y: SU*4, z: -SU*2}, {x: 0, y: 0, z: 0}]},                      // mid_hi_w -> center
      // Center to lower layer
      { path: [{x: 0, y: 0, z: 0}, {x:  SU*4, y: -SU*4, z: -SU*2}]},                     // center -> mid_lo_e
      { path: [{x: 0, y: 0, z: 0}, {x: -SU*4, y: -SU*4, z:  SU*2}]},                     // center -> mid_lo_w
      // Lower layer cross
      { path: [{x:  SU*4, y: -SU*4, z: -SU*2}, {x: -SU*4, y: -SU*4, z:  SU*2}]},         // mid_lo_e -> mid_lo_w
      // Lower layer to bottom spawn
      { path: [{x:  SU*4, y: -SU*4, z: -SU*2}, {x: 0, y: -SU*8, z: 0}]},                 // mid_lo_e -> spawn_b
      { path: [{x: -SU*4, y: -SU*4, z:  SU*2}, {x: 0, y: -SU*8, z: 0}]},                 // mid_lo_w -> spawn_b
    ]
  },

  // ----------------------------------------------------------------------
  // The Cross: compact orthogonal cross with diagonal cuts.
  // Favors close-range brawl (Slayer, Pyro). Tighter than Nexus; the
  // diagonals between arm rooms make corner-camping a death sentence.
  // 7 rooms; horizontal span +/- 8*SU on z.
  cross: {
    name: 'The Cross',
    description: 'Compact crucible. Four arms cut by diagonals; nowhere to hide.',
    // Gladiatorial crimson and gold (close-range brawl feel). Room order:
    // center, arm_n, arm_s, arm_e, arm_w, spawn_a, spawn_b.
    palette: [
      0x4a2818, 0x401818, 0x381818, 0x401010, 0x381010, 0x4a2010, 0x4a2010, 0x382010
    ],
    rooms: [
      { id: 'center',  team: null, x:  0,       y:  0,       z:  0,       r: SU * 2.5 },
      { id: 'arm_n',   team: null, x:  0,       y:  SU * 1,  z: -SU * 4,  r: SU * 1.8 },
      { id: 'arm_s',   team: null, x:  0,       y: -SU * 1,  z:  SU * 4,  r: SU * 1.8 },
      { id: 'arm_e',   team: null, x:  SU * 4,  y:  0,       z:  0,       r: SU * 1.8 },
      { id: 'arm_w',   team: null, x: -SU * 4,  y:  0,       z:  0,       r: SU * 1.8 },
      { id: 'spawn_a', team: 'A',  x:  0,       y:  SU * 2,  z: -SU * 8,  r: SU * 2.2 }, // north of arm_n
      { id: 'spawn_b', team: 'B',  x:  0,       y: -SU * 2,  z:  SU * 8,  r: SU * 2.2 }, // south of arm_s
    ],
    tunnels: [
      // Spokes from center
      { path: [{x: 0, y: 0, z: 0}, {x: 0, y: SU*1, z: -SU*4}]},                          // center -> arm_n
      { path: [{x: 0, y: 0, z: 0}, {x: 0, y: -SU*1, z: SU*4}]},                          // center -> arm_s
      { path: [{x: 0, y: 0, z: 0}, {x: SU*4, y: 0, z: 0}]},                              // center -> arm_e
      { path: [{x: 0, y: 0, z: 0}, {x: -SU*4, y: 0, z: 0}]},                             // center -> arm_w
      // Diagonals between arm tips (so each arm has 3+ exits)
      { path: [{x: 0, y: SU*1, z: -SU*4}, {x: SU*4, y: 0, z: 0}]},                       // arm_n -> arm_e
      { path: [{x: 0, y: SU*1, z: -SU*4}, {x: -SU*4, y: 0, z: 0}]},                      // arm_n -> arm_w
      { path: [{x: 0, y: -SU*1, z: SU*4}, {x: SU*4, y: 0, z: 0}]},                       // arm_s -> arm_e
      { path: [{x: 0, y: -SU*1, z: SU*4}, {x: -SU*4, y: 0, z: 0}]},                      // arm_s -> arm_w
      // Spawn extensions
      { path: [{x: 0, y: SU*1, z: -SU*4}, {x: 0, y: SU*2, z: -SU*8}]},                   // arm_n -> spawn_a
      { path: [{x: 0, y: -SU*1, z: SU*4}, {x: 0, y: -SU*2, z: SU*8}]},                   // arm_s -> spawn_b
    ]
  },

  // ----------------------------------------------------------------------
  // The Arc: curved half-loop with skip-ahead shortcuts over the top.
  // Favors flanking (Syphon, Blaster). Linear arc lets snipers hold,
  // shortcuts let mobile ships punish overextension.
  // 7 rooms arranged in an arc curving through the north half.
  arc: {
    name: 'The Arc',
    description: 'Curved approach with shortcuts over the top. Flank or get flanked.',
    // Sunset palette: deep ocean blue at the wings, sky pink across the arc,
    // sand orange at the peak. Room order: spawn_a(SW), arc_1..arc_5, spawn_b(SE).
    palette: [
      0x101838, 0x182040, 0x282040, 0x481830, 0x382040, 0x282040, 0x182040, 0x101838
    ],
    rooms: [
      { id: 'spawn_a', team: 'A',  x: -SU * 8, y:  0,      z:  SU * 3, r: SU * 2.2 }, // SW
      { id: 'arc_1',   team: null, x: -SU * 6, y:  SU * 1, z: -SU * 3, r: SU * 1.8 },
      { id: 'arc_2',   team: null, x: -SU * 3, y:  SU * 2, z: -SU * 6, r: SU * 1.8 },
      { id: 'arc_3',   team: null, x:  0,      y:  SU * 3, z: -SU * 7, r: SU * 2.0 }, // peak
      { id: 'arc_4',   team: null, x:  SU * 3, y:  SU * 2, z: -SU * 6, r: SU * 1.8 },
      { id: 'arc_5',   team: null, x:  SU * 6, y:  SU * 1, z: -SU * 3, r: SU * 1.8 },
      { id: 'spawn_b', team: 'B',  x:  SU * 8, y:  0,      z:  SU * 3, r: SU * 2.2 }, // SE
    ],
    tunnels: [
      // Main arc (curved spine)
      { path: [{x: -SU*8, y: 0,    z:  SU*3}, {x: -SU*6, y: SU*1, z: -SU*3}]},           // spawn_a -> arc_1
      { path: [{x: -SU*6, y: SU*1, z: -SU*3}, {x: -SU*3, y: SU*2, z: -SU*6}]},           // arc_1 -> arc_2
      { path: [{x: -SU*3, y: SU*2, z: -SU*6}, {x:  0,    y: SU*3, z: -SU*7}]},           // arc_2 -> arc_3
      { path: [{x:  0,    y: SU*3, z: -SU*7}, {x:  SU*3, y: SU*2, z: -SU*6}]},           // arc_3 -> arc_4
      { path: [{x:  SU*3, y: SU*2, z: -SU*6}, {x:  SU*6, y: SU*1, z: -SU*3}]},           // arc_4 -> arc_5
      { path: [{x:  SU*6, y: SU*1, z: -SU*3}, {x:  SU*8, y: 0,    z:  SU*3}]},           // arc_5 -> spawn_b
      // Skip-ahead shortcuts (from arc_1 and arc_5 to the peak; over-the-top from arc_2 to arc_4)
      { path: [{x: -SU*6, y: SU*1, z: -SU*3}, {x:  0,    y: SU*3, z: -SU*7}]},           // arc_1 -> arc_3 (skip)
      { path: [{x:  0,    y: SU*3, z: -SU*7}, {x:  SU*6, y: SU*1, z: -SU*3}]},           // arc_3 -> arc_5 (skip)
      { path: [{x: -SU*3, y: SU*2, z: -SU*6}, {x:  SU*3, y: SU*2, z: -SU*6}]},           // arc_2 -> arc_4 (over the top)
    ]
  },

  // ----------------------------------------------------------------------
  // The Octahedron: classical bipyramid. Two apex spawns (top, bottom) with
  // a four-room equator ring and a central hub. Vertical combat is forced;
  // the center is the most contested room (shared by both the spine and
  // every equator spoke). Every room has >= 3 exits. Cool crystal blues
  // for the equator, warm gold at the hub, icy whites at the apex spawns.
  octahedron: {
    name: 'The Octahedron',
    description: 'Bipyramid. Two apex spawns, four equator rooms, a central hub. Vertical and lateral, no camp.',
    palette: [
      0x4a3818, 0x1a2848, 0x1c2a50, 0x1a2848, 0x1c2a50, 0x1a2848, 0x1c2a50, 0x202848
    ],
    rooms: [
      { id: 'center',   team: null, x: 0,        y: 0,        z: 0,        r: SU * 2.5 },
      { id: 'spawn_a',  team: 'A',  x: 0,        y:  SU * 8,  z: 0,        r: SU * 2.2 }, // top apex
      { id: 'spawn_b',  team: 'B',  x: 0,        y: -SU * 8,  z: 0,        r: SU * 2.2 }, // bottom apex
      { id: 'eq_n',     team: null, x: 0,        y: 0,        z: -SU * 6,  r: SU * 1.8 },
      { id: 'eq_e',     team: null, x:  SU * 6,  y: 0,        z: 0,        r: SU * 1.8 },
      { id: 'eq_s',     team: null, x: 0,        y: 0,        z:  SU * 6,  r: SU * 1.8 },
      { id: 'eq_w',     team: null, x: -SU * 6,  y: 0,        z: 0,        r: SU * 1.8 },
    ],
    tunnels: [
      // Upper pyramid edges (spawn_a to each equator room)
      { path: [{x: 0, y:  SU*8, z: 0}, {x: 0,       y: 0, z: -SU*6}]},     // spawn_a -> eq_n
      { path: [{x: 0, y:  SU*8, z: 0}, {x:  SU*6,  y: 0, z: 0}]},           // spawn_a -> eq_e
      { path: [{x: 0, y:  SU*8, z: 0}, {x: 0,       y: 0, z:  SU*6}]},     // spawn_a -> eq_s
      { path: [{x: 0, y:  SU*8, z: 0}, {x: -SU*6,  y: 0, z: 0}]},           // spawn_a -> eq_w
      // Lower pyramid edges (spawn_b to each equator room)
      { path: [{x: 0, y: -SU*8, z: 0}, {x: 0,       y: 0, z: -SU*6}]},     // spawn_b -> eq_n
      { path: [{x: 0, y: -SU*8, z: 0}, {x:  SU*6,  y: 0, z: 0}]},           // spawn_b -> eq_e
      { path: [{x: 0, y: -SU*8, z: 0}, {x: 0,       y: 0, z:  SU*6}]},     // spawn_b -> eq_s
      { path: [{x: 0, y: -SU*8, z: 0}, {x: -SU*6,  y: 0, z: 0}]},           // spawn_b -> eq_w
      // Equator ring (four-room loop)
      { path: [{x: 0,      y: 0, z: -SU*6}, {x:  SU*6, y: 0, z: 0}]},       // eq_n -> eq_e
      { path: [{x:  SU*6, y: 0, z: 0},      {x: 0,      y: 0, z:  SU*6}]},  // eq_e -> eq_s
      { path: [{x: 0,      y: 0, z:  SU*6}, {x: -SU*6, y: 0, z: 0}]},       // eq_s -> eq_w
      { path: [{x: -SU*6, y: 0, z: 0},      {x: 0,      y: 0, z: -SU*6}]},  // eq_w -> eq_n
      // Vertical spine through the central hub
      { path: [{x: 0, y:  SU*8, z: 0}, {x: 0, y: 0, z: 0}]},                 // spawn_a -> center
      { path: [{x: 0, y: 0,     z: 0}, {x: 0, y: -SU*8, z: 0}]},             // center -> spawn_b
    ]
  },

  // ----------------------------------------------------------------------
  // The Pentagon: pentagonal bipyramid. Two apex spawns, five equator
  // rooms arranged at 72-degree intervals, no center room. Forces the
  // fight outward: every path goes through the ring. Radiant gold palette
  // with a warm amber undertone; spawns at the poles.
  pentagon: {
    name: 'The Pentagon',
    description: 'Pentagonal bipyramid. Two apex spawns, five ring rooms, no hub. Every path crosses the ring.',
    palette: [
      0x4a2a10, 0x3a2818, 0x4a3820, 0x3a2810, 0x4a2a18, 0x4a3820, 0x3a2818, 0x4a2a10
    ],
    rooms: [
      { id: 'spawn_a', team: 'A',  x: 0,             y:  SU * 7,  z: 0,             r: SU * 2.2 }, // top apex
      { id: 'spawn_b', team: 'B',  x: 0,             y: -SU * 7,  z: 0,             r: SU * 2.2 }, // bottom apex
      { id: 'p0',      team: null, x:  SU *  6.000,  y: 0,        z:  SU *  0.000,  r: SU * 1.8 }, // 0 deg
      { id: 'p1',      team: null, x:  SU *  1.854,  y: 0,        z:  SU *  5.706,  r: SU * 1.8 }, // 72 deg
      { id: 'p2',      team: null, x: -SU *  4.854,  y: 0,        z:  SU *  3.527,  r: SU * 1.8 }, // 144 deg
      { id: 'p3',      team: null, x: -SU *  4.854,  y: 0,        z: -SU *  3.527,  r: SU * 1.8 }, // 216 deg
      { id: 'p4',      team: null, x:  SU *  1.854,  y: 0,        z: -SU *  5.706,  r: SU * 1.8 }, // 288 deg
    ],
    tunnels: [
      // Upper cone (spawn_a to each ring room)
      { path: [{x: 0, y:  SU*7, z: 0}, {x:  SU*6.000, y: 0, z:  SU*0.000}]}, // spawn_a -> p0
      { path: [{x: 0, y:  SU*7, z: 0}, {x:  SU*1.854, y: 0, z:  SU*5.706}]}, // spawn_a -> p1
      { path: [{x: 0, y:  SU*7, z: 0}, {x: -SU*4.854, y: 0, z:  SU*3.527}]}, // spawn_a -> p2
      { path: [{x: 0, y:  SU*7, z: 0}, {x: -SU*4.854, y: 0, z: -SU*3.527}]}, // spawn_a -> p3
      { path: [{x: 0, y:  SU*7, z: 0}, {x:  SU*1.854, y: 0, z: -SU*5.706}]}, // spawn_a -> p4
      // Lower cone (spawn_b to each ring room)
      { path: [{x: 0, y: -SU*7, z: 0}, {x:  SU*6.000, y: 0, z:  SU*0.000}]}, // spawn_b -> p0
      { path: [{x: 0, y: -SU*7, z: 0}, {x:  SU*1.854, y: 0, z:  SU*5.706}]}, // spawn_b -> p1
      { path: [{x: 0, y: -SU*7, z: 0}, {x: -SU*4.854, y: 0, z:  SU*3.527}]}, // spawn_b -> p2
      { path: [{x: 0, y: -SU*7, z: 0}, {x: -SU*4.854, y: 0, z: -SU*3.527}]}, // spawn_b -> p3
      { path: [{x: 0, y: -SU*7, z: 0}, {x:  SU*1.854, y: 0, z: -SU*5.706}]}, // spawn_b -> p4
      // Pentagon ring
      { path: [{x:  SU*6.000, y: 0, z:  SU*0.000}, {x:  SU*1.854, y: 0, z:  SU*5.706}]}, // p0 -> p1
      { path: [{x:  SU*1.854, y: 0, z:  SU*5.706}, {x: -SU*4.854, y: 0, z:  SU*3.527}]}, // p1 -> p2
      { path: [{x: -SU*4.854, y: 0, z:  SU*3.527}, {x: -SU*4.854, y: 0, z: -SU*3.527}]}, // p2 -> p3
      { path: [{x: -SU*4.854, y: 0, z: -SU*3.527}, {x:  SU*1.854, y: 0, z: -SU*5.706}]}, // p3 -> p4
      { path: [{x:  SU*1.854, y: 0, z: -SU*5.706}, {x:  SU*6.000, y: 0, z:  SU*0.000}]}, // p4 -> p0
    ]
  },

  // ----------------------------------------------------------------------
  // The Gyre: helix arena. Spawns at the poles, five spiral rooms winding
  // up the Y axis at 72-degree increments. Main spiral is long; three chord
  // shortcuts across the helix let chasers catch and flankers cut. Neon
  // violet/cyan palette; the spiral twists visibly in the low-light glow.
  gyre: {
    name: 'The Gyre',
    description: 'Helix. Spawns at the poles, five spiral rooms climbing Y. Long main path with chord shortcuts.',
    palette: [
      0x2a1848, 0x1a2848, 0x301848, 0x183848, 0x281a48, 0x183048, 0x2a1848, 0x1a2a48
    ],
    rooms: [
      { id: 'spawn_a', team: 'A',  x: 0,             y: -SU * 7,  z: 0,             r: SU * 2.2 }, // south pole
      { id: 'spawn_b', team: 'B',  x: 0,             y:  SU * 7,  z: 0,             r: SU * 2.2 }, // north pole
      { id: 'g1',      team: null, x:  SU *  5.000,  y: -SU * 4,  z:  SU *  0.000,  r: SU * 1.8 }, // 0 deg,   y=-4
      { id: 'g2',      team: null, x:  SU *  1.545,  y: -SU * 2,  z:  SU *  4.755,  r: SU * 1.8 }, // 72 deg,  y=-2
      { id: 'g3',      team: null, x: -SU *  4.045,  y: 0,        z:  SU *  2.939,  r: SU * 2.0 }, // 144 deg, y= 0 (mid)
      { id: 'g4',      team: null, x: -SU *  4.045,  y:  SU * 2,  z: -SU *  2.939,  r: SU * 1.8 }, // 216 deg, y=+2
      { id: 'g5',      team: null, x:  SU *  1.545,  y:  SU * 4,  z: -SU *  4.755,  r: SU * 1.8 }, // 288 deg, y=+4
    ],
    tunnels: [
      // Main spiral (six cylinders from pole to pole)
      { path: [{x: 0,             y: -SU*7, z: 0            }, {x:  SU*5.000, y: -SU*4, z:  SU*0.000}]}, // spawn_a -> g1
      { path: [{x:  SU*5.000,    y: -SU*4, z:  SU*0.000},     {x:  SU*1.545, y: -SU*2, z:  SU*4.755}]}, // g1 -> g2
      { path: [{x:  SU*1.545,    y: -SU*2, z:  SU*4.755},     {x: -SU*4.045, y: 0,     z:  SU*2.939}]}, // g2 -> g3
      { path: [{x: -SU*4.045,    y: 0,     z:  SU*2.939},     {x: -SU*4.045, y:  SU*2, z: -SU*2.939}]}, // g3 -> g4
      { path: [{x: -SU*4.045,    y:  SU*2, z: -SU*2.939},     {x:  SU*1.545, y:  SU*4, z: -SU*4.755}]}, // g4 -> g5
      { path: [{x:  SU*1.545,    y:  SU*4, z: -SU*4.755},     {x: 0,         y:  SU*7, z: 0           }]}, // g5 -> spawn_b
      // Chord shortcuts (cut across the helix)
      { path: [{x: 0,             y: -SU*7, z: 0            }, {x: -SU*4.045, y: 0,     z:  SU*2.939}]}, // spawn_a -> g3 (vertical skip up)
      { path: [{x: -SU*4.045,    y: 0,     z:  SU*2.939},     {x: 0,         y:  SU*7, z: 0           }]}, // g3 -> spawn_b (vertical skip up)
      { path: [{x:  SU*5.000,    y: -SU*4, z:  SU*0.000},     {x: -SU*4.045, y:  SU*2, z: -SU*2.939}]}, // g1 -> g4 (diagonal through middle)
      { path: [{x:  SU*1.545,    y: -SU*2, z:  SU*4.755},     {x:  SU*1.545, y:  SU*4, z: -SU*4.755}]}, // g2 -> g5 (diagonal through middle)
    ]
  },

  // ----------------------------------------------------------------------
  // MiddleBars: two pairs of stacked-bar room clusters between the wide
  // team spawns. Each side has eight small rooms arranged as a 2x2x2 cube
  // (two front/back columns x two top/bottom levels x two halves) ; the
  // horizontal "bars" between paired rooms (eight tight r=100 tunnels) are
  // the map's signature feature. A champion peak sits high above the
  // center, only reachable via two narrow tunnels from the inner tops.
  // Authored in map_lab.html and baked in here ; coordinates are absolute
  // (not SU-derived) so they're preserved verbatim from the lab's export.
  middlebars: {
    name: 'MiddleBars',
    description: 'Bars in the middle. Wide spawns, lattice arenas, champion peak above.',
    palette: [
      0x4477ff, 0xff4488, 0x44ff77, 0xffaa44, 0xaa44ff, 0x44ffff, 0xff44aa, 0xffff44
    ],
    rooms: [
      // Inner lattice (front cluster) ; eight tight rooms at z >= -733.
      { id: 'room_1',  team: null, x: -490, y: 224, z:  390, r: 270 },
      { id: 'room_2',  team: null, x:  510, y: 224, z:  390, r: 270 },
      { id: 'room_3',  team: null, x: -490, y: 224, z:   15, r: 270 },
      { id: 'room_4',  team: null, x:  510, y: 224, z:   15, r: 270 },
      { id: 'room_5',  team: null, x:  498, y: 513, z:   30, r: 270 },
      { id: 'room_6',  team: null, x:  498, y: 513, z:  405, r: 270 },
      { id: 'room_7',  team: null, x: -502, y: 513, z:   30, r: 270 },
      { id: 'room_8',  team: null, x: -502, y: 513, z:  405, r: 270 },
      // Inner lattice (back cluster) ; mirror of the front pair, offset on z.
      { id: 'room_9',  team: null, x: -462, y: 232, z: -358, r: 270 },
      { id: 'room_10', team: null, x:  538, y: 232, z: -358, r: 270 },
      { id: 'room_11', team: null, x: -462, y: 232, z: -733, r: 270 },
      { id: 'room_12', team: null, x:  538, y: 232, z: -733, r: 270 },
      { id: 'room_13', team: null, x:  526, y: 521, z: -718, r: 270 },
      { id: 'room_14', team: null, x:  526, y: 521, z: -343, r: 270 },
      { id: 'room_15', team: null, x: -474, y: 521, z: -718, r: 270 },
      { id: 'room_16', team: null, x: -474, y: 521, z: -343, r: 270 },
      // Wide team spawn rooms flanking the lattice.
      { id: 'spawn_b', team: 'B',  x: -2049, y: 0, z: -164, r: 800 },
      { id: 'spawn_a', team: 'A',  x:  2070, y: 0, z: -164, r: 800 },
      // Champion peak: high above the center, accessed by two narrow tunnels.
      { id: 'champion', team: null, champion: true, x: 17, y: 1213, z: -206, r: 350 },
    ],
    tunnels: [
      // "Bars" ; eight tight r=100 horizontal cylinders linking each room
      // to its mirror across the centerline. These are the namesake feature
      // (sub-passable for some chassis, ship-passable for others).
      { path: [{x: -490, y: 224, z:  390}, {x:  510, y: 224, z:  390}], r: 100 },
      { path: [{x: -490, y: 224, z:   15}, {x:  510, y: 224, z:   15}], r: 100 },
      { path: [{x: -502, y: 513, z:  405}, {x:  498, y: 513, z:  405}], r: 100 },
      { path: [{x: -502, y: 513, z:   30}, {x:  498, y: 513, z:   30}], r: 100 },
      { path: [{x: -462, y: 232, z: -358}, {x:  538, y: 232, z: -358}], r: 100 },
      { path: [{x: -462, y: 232, z: -733}, {x:  538, y: 232, z: -733}], r: 100 },
      { path: [{x: -474, y: 521, z: -343}, {x:  526, y: 521, z: -343}], r: 100 },
      { path: [{x: -474, y: 521, z: -718}, {x:  526, y: 521, z: -718}], r: 100 },
      // West cluster internal connectivity (vertical + z-axis links, r=180).
      { path: [{x: -502, y: 513, z:  405}, {x: -502, y: 513, z:   30}], r: 180 },
      { path: [{x: -502, y: 513, z:   30}, {x: -474, y: 521, z: -343}], r: 180 },
      { path: [{x: -474, y: 521, z: -718}, {x: -474, y: 521, z: -343}], r: 180 },
      { path: [{x: -462, y: 232, z: -733}, {x: -462, y: 232, z: -358}], r: 180 },
      { path: [{x: -462, y: 232, z: -358}, {x: -490, y: 224, z:   15}], r: 180 },
      { path: [{x: -490, y: 224, z:   15}, {x: -490, y: 224, z:  390}], r: 180 },
      { path: [{x: -462, y: 232, z: -733}, {x: -474, y: 521, z: -718}], r: 180 },
      { path: [{x: -462, y: 232, z: -358}, {x: -474, y: 521, z: -343}], r: 180 },
      { path: [{x: -490, y: 224, z:   15}, {x: -502, y: 513, z:   30}], r: 180 },
      { path: [{x: -490, y: 224, z:  390}, {x: -502, y: 513, z:  405}], r: 180 },
      // East cluster internal connectivity (mirror of west).
      { path: [{x:  498, y: 513, z:  405}, {x:  510, y: 224, z:  390}], r: 180 },
      { path: [{x:  498, y: 513, z:   30}, {x:  510, y: 224, z:   15}], r: 180 },
      { path: [{x:  526, y: 521, z: -343}, {x:  538, y: 232, z: -358}], r: 180 },
      { path: [{x:  526, y: 521, z: -718}, {x:  538, y: 232, z: -733}], r: 180 },
      { path: [{x:  526, y: 521, z: -718}, {x:  526, y: 521, z: -343}], r: 180 },
      { path: [{x:  526, y: 521, z: -343}, {x:  498, y: 513, z:   30}], r: 180 },
      { path: [{x:  498, y: 513, z:   30}, {x:  498, y: 513, z:  405}], r: 180 },
      { path: [{x:  510, y: 224, z:  390}, {x:  510, y: 224, z:   15}], r: 180 },
      { path: [{x:  510, y: 224, z:   15}, {x:  538, y: 232, z: -358}], r: 180 },
      { path: [{x:  538, y: 232, z: -358}, {x:  538, y: 232, z: -733}], r: 180 },
      // Spawn B (west, team B) connects to all four west-cluster top rooms.
      { path: [{x: -2049, y: 0, z: -164}, {x: -502, y: 513, z:  405}], r: 180 },
      { path: [{x: -2049, y: 0, z: -164}, {x: -502, y: 513, z:   30}], r: 180 },
      { path: [{x: -2049, y: 0, z: -164}, {x: -474, y: 521, z: -343}], r: 180 },
      { path: [{x: -2049, y: 0, z: -164}, {x: -474, y: 521, z: -718}], r: 180 },
      // Spawn A (east, team A) connects to all four east-cluster top rooms.
      { path: [{x:  2070, y: 0, z: -164}, {x:  498, y: 513, z:  405}], r: 180 },
      { path: [{x:  2070, y: 0, z: -164}, {x:  526, y: 521, z: -718}], r: 180 },
      { path: [{x:  2070, y: 0, z: -164}, {x:  498, y: 513, z:   30}], r: 180 },
      { path: [{x:  2070, y: 0, z: -164}, {x:  526, y: 521, z: -343}], r: 180 },
      // Champion peak access: two narrow r=100 tunnels from the inner tops.
      { path: [{x: -474, y: 521, z: -343}, {x: 17, y: 1213, z: -206}], r: 100 },
      { path: [{x:  498, y: 513, z:   30}, {x: 17, y: 1213, z: -206}], r: 100 },
    ]
  },

  // ============================================================
  // (v13r) Race-mode maps. Two adjacent spawn rooms (Fleet A + Fleet B)
  // sit side-by-side at the start so the lobby reads as team racing ;
  // a single room flagged champion:true sits at the far end as the
  // finish line. Tunnels run wider than classic combat maps (TR ~2.0)
  // so 7 ships per fleet can flow through without constant clipping.
  // These are still valid CLASSIC maps too ; in classic mode they
  // play as deathmatch with the champion field appearing in the
  // finish room at CHAMPION_TIME remaining as usual.
  // ============================================================

  // Pole Position: hand-authored in map_lab.html (race1.json export).
  // 16 rooms, 15 tunnels. Spawns at the eastern start (Fleet A + Fleet B
  // adjacent, sharing room_1 as the gate-room), climb to the cathedral
  // roof at room_4, sweep west through room_5 / room_9 / room_6, descend
  // along the southern spine (rooms 10-13), curl up through room_15,
  // then dive into the central finish (room_17, flagged champion:true).
  // Coordinates are absolute (not SU-multiplied) since map_lab exports
  // in world units already.
  race_pole_position: {
    name: 'Race ; Pole Position',
    description: 'Hand-built sweep ; spawns at the eastern start, climb to the cathedral roof, descend through the western spine, dive into the central finish.',
    palette: [
      0x4487ff, 0xff4488, 0x44ddff, 0xff8844, 0xaaaaff, 0x44ddff, 0xff4488, 0xffffaa
    ],
    rooms: [
      { id: 'room_1',  team: null, x:   274, y:  150, z:  2714, r: 300 },
      { id: 'room_2',  team: 'A',  x:  2798, y:  150, z:  2852, r: 300 },
      { id: 'room_3',  team: 'B',  x:  2820, y:  150, z:  2487, r: 300 },
      { id: 'room_4',  team: null, x:  -835, y: 1183, z:  2463, r: 350 },
      { id: 'room_5',  team: null, x: -1342, y:  524, z:  1112, r: 300 },
      { id: 'room_6',  team: null, x: -2700, y:  219, z:  2331, r: 500 },
      { id: 'room_7',  team: null, x: -2860, y:  175, z:   742, r: 500 },
      { id: 'room_8',  team: null, x: -2234, y:  270, z: -2673, r: 400 },
      { id: 'room_9',  team: null, x:  2572, y:  359, z: -2632, r: 380 },
      { id: 'room_10', team: null, x:  2701, y:  284, z:  -927, r: 330 },
      { id: 'room_11', team: null, x:  2537, y:  532, z:   572, r: 270 },
      { id: 'room_12', team: null, x:  1548, y:  305, z:  1492, r: 270 },
      { id: 'room_13', team: null, x:   324, y:  463, z:  1078, r: 270 },
      { id: 'room_14', team: null, x:  -501, y:  546, z:   917, r: 350 },
      { id: 'room_15', team: null, x: -1226, y:  466, z:  -967, r: 400 },
      { id: 'room_17', team: null, champion: true, x: 1172, y: 466, z: -1544, r: 500 },
    ],
    tunnels: [
      { path: [{x:   274, y:  150, z:  2714}, {x:  2798, y:  150, z:  2852}], r: 250 },
      { path: [{x:  2820, y:  150, z:  2487}, {x:   274, y:  150, z:  2714}], r: 250 },
      { path: [{x:   274, y:  150, z:  2714}, {x:  -835, y: 1183, z:  2463}], r: 300 },
      { path: [{x: -1342, y:  524, z:  1112}, {x:  -835, y: 1183, z:  2463}], r: 300 },
      { path: [{x: -1342, y:  524, z:  1112}, {x: -2700, y:  219, z:  2331}], r: 290 },
      { path: [{x: -2860, y:  175, z:   742}, {x: -2700, y:  219, z:  2331}], r: 250 },
      { path: [{x: -2860, y:  175, z:   742}, {x: -2234, y:  270, z: -2673}], r: 300 },
      { path: [{x:  2572, y:  359, z: -2632}, {x: -2234, y:  270, z: -2673}], r: 300 },
      { path: [{x:  2572, y:  359, z: -2632}, {x:  2701, y:  284, z:  -927}], r: 280 },
      { path: [{x:  2701, y:  284, z:  -927}, {x:  2537, y:  532, z:   572}], r: 250 },
      { path: [{x:  2537, y:  532, z:   572}, {x:  1548, y:  305, z:  1492}], r: 220 },
      { path: [{x:  1548, y:  305, z:  1492}, {x:   324, y:  463, z:  1078}], r: 180 },
      { path: [{x:   324, y:  463, z:  1078}, {x:  -501, y:  546, z:   917}], r: 180 },
      { path: [{x: -1226, y:  466, z:  -967}, {x:  -501, y:  546, z:   917}], r: 250 },
      { path: [{x:  1172, y: 466, z: -1544}, {x: -1226, y:  466, z:  -967}], r: 350 },
    ],
  },

  // ============================================================
  // (v12 patch20) Google Maps overlay slot. Type any location into
  // the lobby DROP panel to either:
  //   - rewrite this slot and select it (pure-city flight, no walls), OR
  //   - leave the current tunnel map selected and overlay the city
  //     under it on LAUNCH (rooms over real geography).
  // The four hardcoded city entries (Tokyo / NYC / Vancouver / Hong
  // Kong) were removed in this patch ; type the name in DROP instead.
  // ============================================================
  gmaps_user: {
    type: 'gmaps',
    name: 'Custom Location',
    description: 'Type a location in the DROP panel and click GO, then LAUNCH.',
    lat: 40.7484,
    lng: -73.9857,
    scale: 1,
    palette: [0x1a2848, 0x2a3858, 0x202848, 0x18283a, 0x202848, 0x1a2840, 0x18203a, 0x1c2848],
    rooms: [],
    tunnels: [],
  }
};
