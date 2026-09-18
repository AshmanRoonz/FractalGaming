/* hub_terrain_probe.mjs — measure the OVERWORLD heightfield without launching the game.
 *
 * WHY: _stGroundY runs per clipmap vertex AND per collision query, it is duplicated
 * (main + worker, byte-identical), and the hub city sits on a HARD-CODED pad. Every
 * previous terrain change in this project was tuned by measurement, not by eye — the
 * comments in the function itself quote median/p90 slope before and after. This pulls
 * the real function straight out of index-working.html so any edit can be measured the
 * same way, in ~1 s, with no browser.
 *
 *   node tools/hub_terrain_probe.mjs                 stats for the current file
 *   node tools/hub_terrain_probe.mjs <other.html>    stats for a variant
 *
 * Reports: land/water split, elevation quantiles, slope quantiles, and the terrain
 * height under every fixed city pad (the thing a terrain edit can silently break).
 */
import fs from 'fs';

const SRC = process.argv[2] || 'LSS/index-working.html';
const src = fs.readFileSync(SRC, 'utf8');

// ---- pull the terrain block out of the MAIN copy -------------------------------
// The block runs from the first _stHash2 to just before the first _stCeilY. There are
// two byte-identical copies (the second lives inside the worker's template literal);
// taking the first is correct and also proves they are extractable independently.
const a = src.indexOf('function _stHash2');
const b = src.indexOf('function _stCeilY');
if (a < 0 || b < 0 || b < a) { console.error('could not locate the terrain block'); process.exit(1); }
const block = src.slice(a, b);
for (const need of ['_stNoise2', '_stFbm', '_stRidged', '_stGroundY']) {
  if (!block.includes('function ' + need)) { console.error('missing ' + need); process.exit(1); }
}
const mod = await import('data:text/javascript,' + encodeURIComponent(
  block + '\nexport { _stGroundY, _stFbm, _stRidged, _stNoise2 };'));
const { _stGroundY } = mod;

// ---- the hub's terrain params, read off the level builder -----------------------
// Every hub room is at y:0 and the bounds are symmetric, so yMid = 0.
const SPACING = 670, GAP_HALF = 600, AMP = 1120, yMid = 0;
const T = {
  ON: true,
  OCTAVES: 5, LACUNARITY: 2.0, GAIN: 0.5, EXPONENT: 1.75,
  BASE_FREQ: 1 / SPACING,
  WARP: 250, WARP_FREQ: 1 / (SPACING * 2.2),
  GROUND_AMP: AMP, CEIL_AMP: 520,
  YFLOOR: yMid - GAP_HALF,
  YCEIL: yMid + 3200,
  YMID: yMid, AMP,
  WALL_PINCH: 0, PILLARS: null, CLEAR_SOFT: 120,
  ARENA_DROP: 640, ARENA_RISE: 760, FOOT: null, ENDLESS: false,
  _openTop: true, HUB: true,
  WL: yMid - GAP_HALF - 120,
  biome: 'mossy', snowLine: 0.68,
};
const WL = T.WL;

const H = (x, z) => _stGroundY(x, z, T);
const slope = (x, z, e = 90) =>
  Math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e);

const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const fmt = (n, d = 0) => n.toFixed(d).padStart(7);

// ---- sweep -----------------------------------------------------------------------
// 120 km box around the hub, which is well past where anyone flies, on a prime-ish
// stride so the sample never lands on the noise lattice.
const N = 260, EXT = 60000;
const hs = [], sl = [];
let wet = 0, n = 0;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const x = -EXT + (2 * EXT) * ((i + 0.5) / N);
  const z = -EXT + (2 * EXT) * ((j + 0.5) / N);
  const h = H(x, z);
  hs.push(h); n++;
  if (h < WL) wet++;
  if ((i + j) % 3 === 0) sl.push(Math.atan(slope(x, z)) * 180 / Math.PI);
}
hs.sort((p, r) => p - r); sl.sort((p, r) => p - r);

console.log('SOURCE   ' + SRC);
console.log('WL (waterline) ' + WL + '    YFLOOR ' + T.YFLOOR);
console.log('');
console.log('water fraction   ' + (wet / n * 100).toFixed(1) + '%   (of a ' + (2 * EXT / 1000) + ' km box)');
console.log('elevation  p05 ' + fmt(q(hs, .05)) + '  p25 ' + fmt(q(hs, .25)) +
            '  med ' + fmt(q(hs, .50)) + '  p75 ' + fmt(q(hs, .75)) +
            '  p95 ' + fmt(q(hs, .95)) + '  max ' + fmt(q(hs, .999)));
console.log('slope(deg) med ' + fmt(q(sl, .50), 1) + '  p75 ' + fmt(q(sl, .75), 1) +
            '  p90 ' + fmt(q(sl, .90), 1) + '  p99 ' + fmt(q(sl, .99), 1) +
            '   steep>40deg ' + (sl.filter(v => v > 40).length / sl.length * 100).toFixed(1) + '%');
console.log('');

// ---- the fixed pads --------------------------------------------------------------
// HUB_CITY's padY is a literal in the source; the six satellite cities choose their
// own pad from measured terrain at runtime, so only this one can be broken by an edit.
const HUB_CITY = { x: 11000, z: -11000, padY: -639.4, R: 7500 };
console.log('HUB_CITY pad ' + HUB_CITY.padY + '  (hard-coded)');
let mn = Infinity, mx = -Infinity, sum = 0, c = 0;
for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
  const x = HUB_CITY.x + (i / 39 - 0.5) * 2 * HUB_CITY.R;
  const z = HUB_CITY.z + (j / 39 - 0.5) * 2 * HUB_CITY.R;
  if (Math.hypot(x - HUB_CITY.x, z - HUB_CITY.z) > HUB_CITY.R) continue;
  const h = H(x, z);
  mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; c++;
}
console.log('  terrain under it   min ' + fmt(mn) + '  mean ' + fmt(sum / c) + '  max ' + fmt(mx));
console.log('  pad - mean         ' + fmt(HUB_CITY.padY - sum / c) +
            '   (pad sits ' + (HUB_CITY.padY > sum / c ? 'ABOVE' : 'BELOW') + ' mean ground)');
console.log('  ground above pad   ' + fmt(mx - HUB_CITY.padY) + '  <- anything that pokes THROUGH the city');
console.log('');
console.log('centre point        ' + fmt(H(HUB_CITY.x, HUB_CITY.z)));
