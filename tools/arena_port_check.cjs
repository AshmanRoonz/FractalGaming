// Slice-1 offline verification: ported arena field vs lab source of truth.
// 1. Extract FIELD_SRC from labs/fractal_arena.html and _ARENA_FIELD_SRC from
//    LSS/index-working.html; Function-construct both.
// 2. Bitwise-compare eval() on the same params over a dense sample.
// 3. Compare _arenaBuildParams(seed 7) vs the lab's buildArena(7,3,1).
// 4. Run the plan's probes: multivalued helix bands, floating-spike voids,
//    spawn-room openness for the MAP_DATA.spire rooms.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';

function extract(hay, startMark, endMark, from) {
  const s = hay.indexOf(startMark, from || 0);
  if (s < 0) throw new Error('start not found: ' + startMark);
  const e = hay.indexOf(endMark, s + startMark.length);
  if (e < 0) throw new Error('end not found: ' + endMark);
  return hay.slice(s + startMark.length, e);
}

const lab = fs.readFileSync(path.join(ROOT, 'labs/fractal_arena.html'), 'utf8');
const game = fs.readFileSync(path.join(ROOT, 'LSS/index-working.html'), 'utf8');

const labSrc = '{' + extract(lab, 'const FIELD_SRC = `{', '\n}`;') + '\n}';
const portSrc = '{' + extract(game, 'const _ARENA_FIELD_SRC = `{', '\n}`;') + '\n}';
const FIELD_LAB = (new Function('return (' + labSrc + ')'))();
const FIELD_PORT = (new Function('return (' + portSrc + ')'))();

// Lab buildArena, copied verbatim from labs/fractal_arena.html (source of truth).
function buildArena(seed, floors, spikeAmt) {
  const R = 1150, H = 780;
  const fy = [];
  for (let i = 0; i < floors; i++) {
    fy.push(-H * 0.55 + (i / Math.max(1, floors - 1)) * H * 1.10);
  }
  return {
    R, H, floorY: fy, slabT: 34,
    colR: 210, sat: 3, satR: 620, satRad: 118, satPhase: (seed % 100) / 100 * 6.28,
    shafts: 4, shaftR: 830, shaftRad: 118,
    ringR: 360, ringW: 74,
    spikeAmt,
    helix: { radius: 330, y0: -H * 0.55, pitch: (H * 1.10) / Math.max(1, floors - 1) * 1.0,
             half: 46, wide: 96, turns: 3 },
    seed,
  };
}

// Ported params builder, extracted from the game file and evaluated.
const pbSrc = 'function _arenaBuildParams' +
  extract(game, 'function _arenaBuildParams', '\n}\n') + '\n}';
const _arenaBuildParams = (new Function('return (' + pbSrc + ')'))();

let fails = 0;
const fail = (msg) => { fails++; console.log('FAIL: ' + msg); };

// --- 3. params parity ---
// (v36.59) The game's params now carry ADDITIVE features the lab never had
// (pillars, themes, lavaY, spikeScale, room keepouts). Parity is against the
// BASE field: strip the additive keys — with them absent the field string's
// new branches are skipped and the math must be byte-for-byte the lab's.
// spikeScale stays: at scale 1 it is 1 and `150*1` is bitwise `150`.
const G_lab = buildArena(7, 3, 1.0);
const G_port = _arenaBuildParams({ seed: 7, floors: 3, spikeAmt: 1.0 });
delete G_port.pillars; delete G_port.themes; delete G_port.lavaY; delete G_port.mystBand;
const jb0 = JSON.stringify(G_port);
const G_cmp = JSON.parse(jb0); delete G_cmp.spikeScale;
const ja = JSON.stringify(G_lab), jb = JSON.stringify(G_cmp);
if (ja !== jb) fail('params mismatch\n lab: ' + ja + '\nport: ' + jb);
else console.log('params: identical (minus additive keys) for seed 7 / floors 3 / spike 1.0');

// --- 2. field parity, deterministic dense sample ---
let rngState = 12345;
const rng = () => (rngState = (rngState * 1664525 + 1013904223) >>> 0) / 4294967296;
let maxDiff = 0, n = 0;
for (let i = 0; i < 20000; i++) {
  const x = (rng() * 2 - 1) * 1300, y = (rng() * 2 - 1) * 900, z = (rng() * 2 - 1) * 1300;
  const a = FIELD_LAB.eval(x, y, z, G_lab);
  const b = FIELD_PORT.eval(x, y, z, G_port);
  if (a !== b) { maxDiff = Math.max(maxDiff, Math.abs(a - b)); n++; }
}
if (n) fail('field mismatch at ' + n + '/20000 points, maxDiff ' + maxDiff);
else console.log('field: bitwise identical at 20000 random points');

// grad + shade parity spot-check
for (let i = 0; i < 200; i++) {
  const x = (rng() * 2 - 1) * 1100, y = (rng() * 2 - 1) * 760, z = (rng() * 2 - 1) * 1100;
  const ga = FIELD_LAB.grad(x, y, z, G_lab, 3.0), gb = FIELD_PORT.grad(x, y, z, G_port, 3.0);
  const sa = FIELD_LAB.shade(x, y, z, G_lab), sb = FIELD_PORT.shade(x, y, z, G_port);
  if (JSON.stringify(ga) !== JSON.stringify(gb)) { fail('grad mismatch at ' + [x,y,z]); break; }
  if (JSON.stringify(sa) !== JSON.stringify(sb)) { fail('shade mismatch at ' + [x,y,z]); break; }
}
console.log('grad/shade: spot-checked 200 points');

// --- 4a. multivalued probe (the plan's method: FIELD.helix ALONE) ---
{
  let bands = 0, open = false;
  for (let y = -G_port.H; y <= G_port.H; y += 2) {
    const d = FIELD_PORT.helix(0, y, 330, G_port.helix);
    if (d < 0 && !open) { bands++; open = true; }
    if (d >= 0) open = false;
  }
  if (bands < 2) fail('multivalued probe: only ' + bands + ' helix band(s)');
  else console.log('multivalued probe: ' + bands + ' open helix bands at (x,z)=(0,330)');
}

// --- 4b. floating-spike probe: ring void + shaft bores, offsets from floors ---
{
  let rock = 0, total = 0;
  for (let f = 0; f < G_port.floorY.length; f++) {
    const fy = G_port.floorY[f];
    for (const dy of [-190, -130, -70, 70, 130, 190]) {
      // annular ring void (8 angles)
      for (let a = 0; a < 8; a++) {
        const th = a / 8 * Math.PI * 2;
        const x = Math.cos(th) * G_port.ringR, z = Math.sin(th) * G_port.ringR;
        total++;
        if (FIELD_PORT.eval(x, fy + dy, z, G_port) >= 0) rock++;
      }
      // each shaft bore centre for this floor
      for (let h = 0; h < G_port.shafts; h++) {
        const a = (h / G_port.shafts) * 6.2831853 + f * 0.9 + G_port.satPhase;
        const x = Math.cos(a) * G_port.shaftR, z = Math.sin(a) * G_port.shaftR;
        total++;
        if (FIELD_PORT.eval(x, fy + dy, z, G_port) >= 0) rock++;
      }
    }
  }
  if (rock > 0) fail('floating-spike probe: ' + rock + '/' + total + ' void samples are rock');
  else console.log('floating-spike probe: 0/' + total + ' rock in ring/shaft voids');
}

// --- 4c. MAP_DATA.spire rooms: openness of the spawn/nav spheres ---
// ⚠ These rooms live in the SCALE-2 field (arena.scale 2 in MAP_DATA —
// load-bearing, see the MAP_DATA comment). G2 below must match the map's
// arena block — INCLUDING the rooms argument (v36.59: rooms feed the
// pillar keepouts, exactly as buildRoomGraphLevel passes level.rooms).
const SPIRE_ROOMS = [
  { id: 'spawn_a', team: 'A', x: -1316, y: 1280, z: 280, r: 300 },
  { id: 'spawn_b', team: 'B', x: 1326, y: 1260, z: -50, r: 300 },
  { id: 'mid_high', x: -80, y: 430, z: 1726, r: 280, champion: true },
  { id: 'mid_east', x: 1225, y: 460, z: -805, r: 280 },
  { id: 'mid_low', x: -636, y: -400, z: -450, r: 280 },
  { id: 'pit', x: 736, y: -1250, z: -524, r: 260 },
];
const G2 = _arenaBuildParams({ seed: 7, floors: 3, spikeAmt: 1.0, scale: 2 }, SPIRE_ROOMS);
// (v36.59) Pillar-presence probe: the full field must contain rock at some
// mid-gap points that the pillar-less field reports as open air.
{
  const G2np = JSON.parse(JSON.stringify(G2)); delete G2np.pillars;
  let pillarHits = 0, probes = 0;
  for (let gi = -1; gi < G2.floorY.length; gi++) {
    const yBot = (gi < 0) ? -G2.H : G2.floorY[gi] + G2.slabT;
    const yTop = (gi + 1 < G2.floorY.length) ? G2.floorY[gi + 1] - G2.slabT : G2.H;
    const yMid = (yBot + yTop) / 2;
    for (let x = -2000; x <= 2000; x += 80) for (let z = -2000; z <= 2000; z += 80) {
      probes++;
      if (FIELD_PORT.eval(x, yMid, z, G2) >= 0 && FIELD_PORT.eval(x, yMid, z, G2np) < 0) pillarHits++;
    }
  }
  // Presence assertion, not a tuning gate: ~8 pillars/gap x 4 gaps at waist
  // radius ~50-95u over an 80u probe grid lands in the dozens.
  if (pillarHits < 40) fail('pillar probe: only ' + pillarHits + ' mid-gap samples turned rock');
  else console.log('pillar probe: ' + pillarHits + ' mid-gap samples are pillar rock (' + probes + ' probed)');
}
{
  const rooms = [
    { id: 'spawn_a', x: -1316, y: 1280, z: 280, r: 300 },
    { id: 'spawn_b', x: 1326, y: 1260, z: -50, r: 300 },
    { id: 'mid_high', x: -80, y: 430, z: 1726, r: 280, champion: true },
    { id: 'mid_east', x: 1225, y: 460, z: -805, r: 280 },
    { id: 'mid_low', x: -636, y: -400, z: -450, r: 280 },
    { id: 'pit', x: 736, y: -1250, z: -524, r: 260 },
  ];
  // rooms must match MAP_DATA.spire in index-working.html — cross-check:
  const mapBlock = extract(game, "spire: {", "\n  },");
  for (const rm of rooms) {
    const re = new RegExp("id: '" + rm.id + "'[^}]*x:\\s*" + rm.x + ",\\s*y:\\s*" + rm.y + ",\\s*z:\\s*" + rm.z + ",");
    if (!re.test(mapBlock)) fail('MAP_DATA.spire room ' + rm.id + ' does not match test coords');
  }
  for (const rm of rooms) {
    const c = FIELD_PORT.eval(rm.x, rm.y, rm.z, G2);
    let rock = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      // uniform in the 0.7r sampling ball corridorPoints actually use
      const u = rng(), v = rng(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
      const rr = rm.r * 0.7 * Math.cbrt(rng());
      const x = rm.x + rr * Math.sin(ph) * Math.cos(th);
      const y = rm.y + rr * Math.sin(ph) * Math.sin(th);
      const z = rm.z + rr * Math.cos(ph);
      if (FIELD_PORT.eval(x, y, z, G2) >= 0) rock++;
    }
    const pct = (rock / N * 100).toFixed(2);
    console.log('room ' + rm.id + ': centre SDF ' + c.toFixed(1) + ', rock fraction ' + pct + '% of sampling ball');
    // Centres must be OUTSIDE the fattest hull's containment band
    // (collRadius*2.5 ~= 160) or ships glue at spawn — the v36.56 bug.
    if (c >= -170) fail('room ' + rm.id + ' centre inside the containment band (SDF ' + c.toFixed(1) + ', need < -170)');
    if (rock / N > 0.08) fail('room ' + rm.id + ' rock fraction ' + pct + '% > 8%');
    // The champion room feeds spawnChampionField, which requires < -150
    // clearance at the room centre (its rescue walk cannot escape the
    // central column if this regresses).
    if (rm.champion && c >= -150) fail('champion room ' + rm.id + ' centre fails the -150 clearance bar');
  }
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
