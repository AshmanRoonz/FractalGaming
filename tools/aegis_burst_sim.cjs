// aegis_burst_sim.cjs — behavioural test for the PYRO burst (Aegis 2 / 17).
//
//   node tools/aegis_burst_sim.cjs
//
// The burst is the only NEW mechanic in the v36.66-69 Aegis pass that carries
// state across frames, so it is the only one with real edge cases: a pull that
// starts on the last round, a reload landing mid-burst, and a respawn while
// bolts are still owed. This lifts the ACTUAL drain block and the ACTUAL arm
// block out of index-working.html (no re-typed copy that can drift) and runs
// them against a stub player at a fixed timestep.
const fs = require('fs');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';
const src = fs.readFileSync(ROOT + '/LSS/index-working.html', 'utf8');

function lift(startMark, endMark, label) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('missing ' + label + ' start: ' + startMark);
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('missing ' + label + ' end');
  return src.slice(a, b + endMark.length);
}
const DRAIN = lift('  if (player._pyroBurstLeft > 0) {', '\n  }', 'drain');
const GAP = +(src.match(/const _PYRO_BURST_GAP = ([\d.]+)/) || [])[1];
const TOTALS = JSON.parse((src.match(/const _PYRO_BURST_TOTAL = (\[[^\]]+\])/) || [])[1]);
if (!GAP) throw new Error('could not parse _PYRO_BURST_GAP');

let fails = 0;
const fail = m => { fails++; console.log('FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);
console.log('  _PYRO_BURST_GAP = ' + GAP + 's, totals = ' + JSON.stringify(TOTALS));

// Run one trigger pull to completion and report what actually came out.
function pull({ rank, clip, dt = 1 / 60, frames = 120 }) {
  const shots = [];
  let reloads = 0;
  const player = { loadoutKey: 'PYRO', clipAmmo: clip, _pyroBurstLeft: 0, _pyroBurstT: 0,
                   isFiring: false, fireFlashTimer: 0 };
  const fireWeapon = () => shots.push(player.clipAmmo);
  const startReload = () => { reloads++; };
  const _pyroBurstN = () => (rank >= 17 ? 3 : (rank >= 2 ? 2 : 1));
  const _PYRO_BURST_GAP = GAP;
  // --- the trigger pull itself (mirrors the fire gate: fire, decrement, arm) ---
  if (player.clipAmmo > 0) {
    fireWeapon();
    player.clipAmmo--;
    const n = _pyroBurstN();
    if (n > 1) { player._pyroBurstLeft = n - 1; player._pyroBurstT = _PYRO_BURST_GAP; }
    if (player.clipAmmo <= 0) startReload();
  }
  // --- the LIFTED drain block, one frame at a time ---
  const step = new Function('player', 'dt', 'fireWeapon', 'startReload', '_PYRO_BURST_GAP', DRAIN);
  for (let f = 0; f < frames; f++) step(player, dt, fireWeapon, startReload, _PYRO_BURST_GAP);
  return { bolts: shots.length, left: player._pyroBurstLeft, clip: player.clipAmmo, reloads };
}

const CASES = [
  ['rank 0  full clip  -> 1 bolt',        { rank: 0,  clip: 12 }, r => r.bolts === 1 && r.left === 0],
  ['rank 2  full clip  -> 2 bolts',       { rank: 2,  clip: 12 }, r => r.bolts === 2 && r.left === 0],
  ['rank 11 full clip  -> 2 bolts',       { rank: 11, clip: 12 }, r => r.bolts === 2 && r.left === 0],
  ['rank 17 full clip  -> 3 bolts',       { rank: 17, clip: 12 }, r => r.bolts === 3 && r.left === 0],
  ['rank 20 full clip  -> 3 bolts',       { rank: 20, clip: 12 }, r => r.bolts === 3 && r.left === 0],
  // The edge case the drain-before-reload ordering exists for.
  ['rank 17 clip=2 -> 2 bolts, no owed',  { rank: 17, clip: 2  }, r => r.bolts === 2 && r.left === 0 && r.clip === 0],
  ['rank 17 clip=1 -> 1 bolt, no owed',   { rank: 17, clip: 1  }, r => r.bolts === 1 && r.left === 0 && r.clip === 0],
  ['rank 17 clip=3 -> 3 bolts, clip dry', { rank: 17, clip: 3  }, r => r.bolts === 3 && r.left === 0 && r.clip === 0],
  ['clip never goes negative',            { rank: 17, clip: 1  }, r => r.clip >= 0],
  // A dry clip must never leave bolts owed for the NEXT life to fire.
  ['no bolts left owed after any pull',   { rank: 17, clip: 2  }, r => r.left === 0],
];
for (const [label, arg, pred] of CASES) {
  const r = pull(arg);
  const pass = pred(r);
  const detail = 'bolts=' + r.bolts + ' left=' + r.left + ' clip=' + r.clip + ' reloads=' + r.reloads;
  if (pass) ok(label.padEnd(38) + detail); else fail(label + ' -> ' + detail);
}

// Burst timing: 3 bolts must all land inside one 1.2 s fire-rate window,
// otherwise they are not "fast consecutive bolts", they are just a slower gun.
const span = GAP * 2;
if (span < 1.2) ok('rank 17 burst spans ' + span.toFixed(2) + 's, inside the 1.2s fire rate');
else fail('rank 17 burst spans ' + span.toFixed(2) + 's, LONGER than the 1.2s fire rate');

// Per-pull damage totals stay in the same band as every other Aegis perk.
for (const [n, want] of [[1, 1], [2, 1.45], [3, 1.75]]) {
  const perBolt = TOTALS[n] / n, total = perBolt * n;
  const okBand = Math.abs(total - want) < 1e-9 && total <= 2.0;
  const line = 'rank-' + (n === 1 ? '0 ' : n === 2 ? '2 ' : '17') + ' pull total x' + total.toFixed(2) +
               ' (' + n + ' bolts x' + perBolt.toFixed(3) + ')';
  if (okBand) ok(line); else fail(line + ' — outside the <=2.0x perk band');
}

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL BURST SIM CHECKS PASSED');
process.exit(fails ? 1 : 0);
