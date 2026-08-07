// Corrected multivalued probe + room-placement optimizer for MAP_DATA.spire.
// Finds, for each room, the centre in a local search box that maximises the
// worst-case field openness over the 0.7r corridorPoints sampling ball.
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
const G = build({ seed: 7, floors: 3, spikeAmt: 1.0 });

// --- multivalued probe, the plan's way: FIELD.helix alone, theta = 90deg ---
{
  let bands = 0, open = false, solid = 0, sawBand = false;
  for (let y = -G.H; y <= G.H; y += 2) {
    const d = F.helix(0, y, 330, G.helix);
    if (d < 0) { if (!open) { bands++; open = true; } }
    else { open = false; if (sawBand) solid++; }
    if (d < 0) sawBand = true;
  }
  console.log('multivalued probe (helix alone, x=0 z=330): ' + bands + ' open bands');
  if (bands < 2) { console.log('FAIL multivalued'); process.exit(1); }
}

// --- room optimizer ---
// worstBall: minimum of (-SDF) over a deterministic ball sample = worst openness.
function ballStats(cx, cy, cz, r) {
  let worst = Infinity, rock = 0, n = 0;
  // deterministic spherical shell + interior sample
  for (let i = 0; i < 350; i++) {
    const gr = (i * 0.61803398875) % 1;               // golden-ratio angles
    const th = 2 * Math.PI * gr;
    const ph = Math.acos(2 * ((i * 0.7548776662) % 1) - 1);
    const rr = r * 0.7 * Math.cbrt((i + 0.5) / 350);
    const x = cx + rr * Math.sin(ph) * Math.cos(th);
    const y = cy + rr * Math.sin(ph) * Math.sin(th);
    const z = cz + rr * Math.cos(ph);
    const d = F.eval(x, y, z, G);
    if (-d < worst) worst = -d;                        // openness = -d
    if (d >= 0) rock++;
    n++;
  }
  return { worst, rockPct: rock / n * 100, centre: F.eval(cx, cy, cz, G) };
}
function optimise(name, cx, cy, cz, r, box, ybox) {
  let best = null;
  for (let dx = -box; dx <= box; dx += 25)
    for (let dz = -box; dz <= box; dz += 25)
      for (let dy = -ybox; dy <= ybox; dy += 20) {
        const s = ballStats(cx + dx, cy + dy, cz + dz, r);
        const score = s.worst;                         // maximise worst openness
        if (!best || score > best.score) best = { score, x: cx + dx, y: cy + dy, z: cz + dz, s };
      }
  console.log(name + ': best centre (' + best.x + ', ' + best.y + ', ' + best.z + ')  ' +
    'worstBallSDF ' + (-best.s.worst).toFixed(1) + '  centreSDF ' + best.s.centre.toFixed(1) +
    '  rock ' + best.s.rockPct.toFixed(2) + '%');
  return best;
}
optimise('spawn_a ', -713, 580, 0, 170, 125, 60);
optimise('spawn_b ', 713, 580, 0, 170, 125, 60);
optimise('mid_high', 50, 215, 598, 150, 125, 60);
optimise('mid_low ', -543, -215, -255, 150, 125, 60);
optimise('pit     ', 493, -590, -342, 140, 125, 60);
