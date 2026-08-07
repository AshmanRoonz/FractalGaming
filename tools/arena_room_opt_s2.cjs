// Scale-2 room derivation for MAP_DATA.spire (v36.57).
// Same method as arena_room_opt.cjs but at arena scale 2 with the 6-room set.
// Prints the centres to paste into MAP_DATA.spire. Requires worst-ball
// openness >= 130 (the containment band of the fattest hull is
// collRadius*2.5 = hullLength*0.32*2.5 ~= 160; spawn balls must clear it).
const fs = require('fs');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';
const game = fs.readFileSync(ROOT + '/LSS/index-working.html', 'utf8');
function extract(hay, s0, e0) {
  const s = hay.indexOf(s0); if (s < 0) throw new Error('no ' + s0);
  const e = hay.indexOf(e0, s + s0.length); if (e < 0) throw new Error('no ' + e0);
  return hay.slice(s + s0.length, e);
}
const F = (new Function('return ({' + extract(game, 'const _ARENA_FIELD_SRC = `{', '\n}`;') + '\n})'))();
const build = (new Function('return (function _arenaBuildParams' +
  extract(game, 'function _arenaBuildParams', '\n}\n') + '\n})'))();
// (v36.59) rooms feed the pillar keepouts — pass the CURRENT MAP_DATA
// coords, exactly as buildRoomGraphLevel does. Keep in step with the map.
const SPIRE_ROOMS = [
  { x: -1316, y: 1280, z: 280, r: 300 },
  { x: 1326, y: 1260, z: -50, r: 300 },
  { x: -80, y: 430, z: 1726, r: 280 },
  { x: 1225, y: 460, z: -805, r: 280 },
  { x: -636, y: -400, z: -450, r: 280 },
  { x: 736, y: -1250, z: -524, r: 260 },
];
const G = build({ seed: 7, floors: 3, spikeAmt: 1.0, scale: 2 }, SPIRE_ROOMS);
console.log('params: R ' + G.R + ' H ' + G.H + ' floors ' + JSON.stringify(G.floorY));

function ballStats(cx, cy, cz, r) {
  let worst = Infinity, rock = 0, n = 0;
  for (let i = 0; i < 350; i++) {
    const th = 2 * Math.PI * ((i * 0.61803398875) % 1);
    const ph = Math.acos(2 * ((i * 0.7548776662) % 1) - 1);
    const rr = r * 0.7 * Math.cbrt((i + 0.5) / 350);
    const d = F.eval(cx + rr * Math.sin(ph) * Math.cos(th), cy + rr * Math.sin(ph) * Math.sin(th), cz + rr * Math.cos(ph), G);
    if (-d < worst) worst = -d;
    if (d >= 0) rock++;
    n++;
  }
  return { worst, rockPct: rock / n * 100, centre: F.eval(cx, cy, cz, G) };
}
function optimise(name, cx, cy, cz, r, box, ybox) {
  let best = null;
  for (let dx = -box; dx <= box; dx += 40)
    for (let dz = -box; dz <= box; dz += 40)
      for (let dy = -ybox; dy <= ybox; dy += 30) {
        const s = ballStats(cx + dx, cy + dy, cz + dz, r);
        if (!best || s.worst > best.s.worst) best = { x: cx + dx, y: cy + dy, z: cz + dz, s };
      }
  const ok = best.s.worst >= 130 ? 'OK' : 'BELOW-130';
  console.log(name + ': (' + best.x + ', ' + best.y + ', ' + best.z + ') r ' + r +
    '  worstBall ' + (-best.s.worst).toFixed(1) + '  centre ' + best.s.centre.toFixed(1) +
    '  rock ' + best.s.rockPct.toFixed(2) + '%  ' + ok);
  return best;
}
// Initial guesses = 2x the scale-1 optimised centres; new mid_east in the
// third satellite gap (325.2 deg) on storey 3.
optimise('spawn_a ', -1316, 1280, 280, 300, 280, 140);
optimise('spawn_b ', 1326, 1260, -50, 300, 280, 140);
optimise('mid_high', -80, 430, 1726, 280, 280, 140);
optimise('mid_east', 1225, 460, -805, 280, 280, 140);
optimise('mid_low ', -636, -400, -450, 280, 280, 140);
optimise('pit     ', 736, -1250, -524, 260, 280, 140);
