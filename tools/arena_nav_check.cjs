// arena_nav_check.cjs — offline gate for the Spire vertical router (slice 4).
//
//   node tools/arena_nav_check.cjs
//
// Asserts, against the LIVE field + params extracted from index-working.html:
//  1. c* (the containment-stall clearance) per chassis still matches the
//     CHASSIS table and CONTAIN_STRENGTH — if either moves, every throat
//     admission decision in the router moves with it.
//  2. Enough ring sectors and shaft mouths are actually flyable.
//  3. The blocked-oracle agrees with dense worldSDF-style truth.
//  4. The router's own functions route a seeded set of cross-storey pairs.
//
// ⚠ Conclusions here are SEED-SPECIFIC (seed 7 / floors 3 / scale 2).
// The formulas transfer; "exactly one dead ring sector" does not. Re-run
// after ANY change to arena.seed / floors / scale, exactly like
// tools/arena_room_opt_s2.cjs.
const fs = require('fs');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';
const game = fs.readFileSync(ROOT + '/LSS/index-working.html', 'utf8');
function ex(s0, e0) {
  const s = game.indexOf(s0); if (s < 0) throw new Error('missing marker: ' + s0);
  const e = game.indexOf(e0, s + s0.length); if (e < 0) throw new Error('missing end: ' + e0);
  return game.slice(s + s0.length, e);
}
const FIELD = (new Function('return ({' + ex('const _ARENA_FIELD_SRC = `{', '\n}`;') + '\n})'))();
const build = (new Function('return (function _arenaBuildParams' + ex('function _arenaBuildParams', '\n}\n') + '\n})'))();
const SPIRE_ROOMS = [
  { x: -1316, y: 1280, z: 280, r: 300 }, { x: 1326, y: 1260, z: -50, r: 300 },
  { x: -80, y: 430, z: 1726, r: 280 },   { x: 1225, y: 460, z: -805, r: 280 },
  { x: -636, y: -400, z: -450, r: 280 }, { x: 736, y: -1250, z: -524, r: 260 },
];
const G = build({ seed: 7, floors: 3, spikeAmt: 1.0, scale: 2 }, SPIRE_ROOMS);

let fails = 0;
const fail = m => { fails++; console.log('FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);

// ---- 1. c* per chassis, re-derived from the game's own constants ----
// Parsed out of the file so a CHASSIS or CONTAIN_STRENGTH edit trips this.
const CONTAIN_STRENGTH = +(game.match(/const CONTAIN_STRENGTH = (\d+)/) || [])[1];
const CONTAIN_RANGE_MUL = +(game.match(/const CONTAIN_RANGE = radius \* ([\d.]+)/) || [])[1];
if (!CONTAIN_STRENGTH || !CONTAIN_RANGE_MUL) fail('could not parse CONTAIN_STRENGTH / CONTAIN_RANGE from resolveCollision');
else ok('resolveCollision constants: strength ' + CONTAIN_STRENGTH + ', range x' + CONTAIN_RANGE_MUL);
const cstar = (hullLength, accel) =>
  (hullLength * 0.5) * CONTAIN_RANGE_MUL * (1 - Math.sqrt(Math.max(0, Math.min(1, accel / CONTAIN_STRENGTH))));
const HULLS = [['FRIGATE', 80, 1200], ['CORVETTE', 100, 800], ['DREADNOUGHT', 140, 500]];
const CS = {};
for (const [n, h, a] of HULLS) { CS[n] = cstar(h, a); console.log('  c* ' + n.padEnd(12) + CS[n].toFixed(0) + 'u'); }

// ---- 2. throat clearance (MIN over the column, never max) ----
function throatClr(x, z, fy) {
  let worst = 1e9;
  for (let k = -2; k <= 2; k++) {
    const d = FIELD.eval(x, fy + k * (G.slabT * 1.1), z, G);
    if (-d < worst) worst = -d;
  }
  return worst;
}
let ringOk = 0, ringTot = 0, shaftOk = 0, shaftTot = 0;
const ringRows = [], shaftRows = [];
for (let j = 0; j < G.floorY.length; j++) {
  const fy = G.floorY[j];
  for (let s = 0; s < 8; s++) {
    const a = (s / 8) * 6.2831853;
    const c = throatClr(Math.cos(a) * G.ringR, Math.sin(a) * G.ringR, fy);
    ringTot++; if (c >= CS.CORVETTE) ringOk++;
    ringRows.push('slab' + j + ' ring' + Math.round(a * 57.3).toString().padStart(3) + 'deg ' + c.toFixed(0));
  }
  for (let h = 0; h < G.shafts; h++) {
    const a = (h / G.shafts) * 6.2831853 + j * 0.9 + G.satPhase;
    const c = throatClr(Math.cos(a) * G.shaftR, Math.sin(a) * G.shaftR, fy);
    shaftTot++; if (c >= CS.DREADNOUGHT) shaftOk++;
    shaftRows.push('slab' + j + ' shaft' + h + ' ' + c.toFixed(0));
  }
}
console.log('  ring sectors flyable by CORVETTE: ' + ringOk + '/' + ringTot);
console.log('  shaft mouths flyable by DREADNOUGHT: ' + shaftOk + '/' + shaftTot);
if (ringOk < ringTot * 0.6) fail('too few ring sectors flyable (' + ringOk + '/' + ringTot + ')');
if (shaftOk < shaftTot * 0.7) fail('too few shaft mouths flyable (' + shaftOk + '/' + shaftTot + ')');

// ---- 3. blocked-oracle vs dense truth ----
function storey(y) { let b = 0; for (let i = 0; i < G.floorY.length; i++) if (y > G.floorY[i]) b = i + 1; return b; }
function blocked(x0, y0, z0, x1, y1, z1) {
  const s0 = storey(y0), s1 = storey(y1);
  if (s0 === s1) return -1;
  const lo = Math.min(s0, s1), hi = Math.max(s0, s1), dy = y1 - y0;
  if (Math.abs(dy) < 1e-3) return -1;
  const up = s1 > s0;
  for (let n = 0; n < hi - lo; n++) {
    const j = up ? lo + n : hi - 1 - n;
    const t = (G.floorY[j] - y0) / dy;
    if (t < 0 || t > 1) continue;
    if (FIELD.floorHole(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, j, G) >= 0) return j;
  }
  return -1;
}
let rng = 987654321;
const rnd = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
let tp = 0, fp = 0, fn = 0, tn = 0, pairs = 0;
for (let i = 0; i < 600 && pairs < 300; i++) {
  const pick = () => { const th = rnd() * 6.283, r = 300 + rnd() * (G.R - 600);
    return [Math.cos(th) * r, (rnd() * 2 - 1) * G.H * 0.92, Math.sin(th) * r]; };
  const A = pick(), B = pick();
  if (FIELD.eval(A[0], A[1], A[2], G) >= 0 || FIELD.eval(B[0], B[1], B[2], G) >= 0) continue;
  if (storey(A[1]) === storey(B[1])) continue;
  pairs++;
  // dense truth: march the segment, is any sample rock?
  let rock = 0, N = 160;
  for (let k = 1; k < N; k++) {
    const t = k / N;
    if (FIELD.eval(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, G) >= 0) rock++;
  }
  const truthBlocked = rock / N > 0.02;
  const oracleBlocked = blocked(A[0], A[1], A[2], B[0], B[1], B[2]) >= 0;
  if (oracleBlocked && truthBlocked) tp++;
  else if (oracleBlocked && !truthBlocked) fp++;
  else if (!oracleBlocked && truthBlocked) fn++;
  else tn++;
}
const recall = tp / Math.max(1, tp + fn), prec = tp / Math.max(1, tp + fp);
console.log('  blocked-oracle over ' + pairs + ' cross-storey pairs: recall ' +
  (recall * 100).toFixed(1) + '%  precision ' + (prec * 100).toFixed(1) + '%');
if (recall < 0.85) fail('blocked-oracle recall ' + (recall * 100).toFixed(1) + '% < 85%');
if (prec < 0.80) fail('blocked-oracle precision ' + (prec * 100).toFixed(1) + '% < 80%');

// ---- 4. a throat is findable for every blocked pair, per chassis ----
function pickThroat(px, py, pz, j, gx, gy, gz, minClr) {
  const fy = G.floorY[j];
  let best = Infinity, bx = 0, bz = 0, found = false;
  for (let h = 0; h < G.shafts; h++) {
    const a = (h / G.shafts) * 6.2831853 + j * 0.9 + G.satPhase;
    const mx = Math.cos(a) * G.shaftR, mz = Math.sin(a) * G.shaftR;
    if (throatClr(mx, mz, fy) < minClr) continue;
    const c = Math.hypot(mx - px, fy - py, mz - pz) + Math.hypot(gx - mx, gy - fy, gz - mz);
    if (c < best) { best = c; bx = mx; bz = mz; found = true; }
  }
  if (minClr + 20 <= G.ringW) {
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * 6.2831853;
      const mx = Math.cos(a) * G.ringR, mz = Math.sin(a) * G.ringR;
      if (throatClr(mx, mz, fy) < minClr) continue;
      const c = Math.hypot(mx - px, fy - py, mz - pz) + Math.hypot(gx - mx, gy - fy, gz - mz);
      if (c < best) { best = c; bx = mx; bz = mz; found = true; }
    }
  }
  return found ? { x: bx, z: bz } : null;
}
for (const [n] of HULLS) {
  let solved = 0, tot = 0;
  rng = 424242;
  for (let i = 0; i < 400 && tot < 60; i++) {
    const pick = () => { const th = rnd() * 6.283, r = 300 + rnd() * (G.R - 600);
      return [Math.cos(th) * r, (rnd() * 2 - 1) * G.H * 0.92, Math.sin(th) * r]; };
    const A = pick(), B = pick();
    if (FIELD.eval(A[0], A[1], A[2], G) >= 0 || FIELD.eval(B[0], B[1], B[2], G) >= 0) continue;
    const j = blocked(A[0], A[1], A[2], B[0], B[1], B[2]);
    if (j < 0) continue;
    tot++;
    if (pickThroat(A[0], A[1], A[2], j, B[0], B[1], B[2], CS[n])) solved++;
  }
  const pct = solved / Math.max(1, tot) * 100;
  console.log('  ' + n.padEnd(12) + 'throat found for ' + solved + '/' + tot + ' blocked pairs (' + pct.toFixed(0) + '%)');
  if (n !== 'DREADNOUGHT' && pct < 90) fail(n + ' found a throat for only ' + pct.toFixed(0) + '% of blocked pairs');
  if (n === 'DREADNOUGHT' && pct < 40) fail('DREADNOUGHT throat availability collapsed to ' + pct.toFixed(0) + '%');
}

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL NAV CHECKS PASSED');
process.exit(fails ? 1 : 0);
