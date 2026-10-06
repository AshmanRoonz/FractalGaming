// CITY FLOAT PROBE (v51.99) - runs LSS's own _hubCityBuild in node (canvas stubbed out) and reports every decoration
// that touches no building: raised cylinders / boxes / solar / dishes by their base centre, holo ads at mid-height, the
// vertical neon EDGE strips sampled up their height, the PARAPET strips at their middle (tolerance 12 u). Also prints
// the twr layer's hash: a decoration-only change must leave it identical (the rng stream - so the whole city - unchanged).
// Owner, v51.98: "some of these cylinders at the tops of smaller buildings, they are floating" - this measured 64 floating
// cylinders, 126 floating neon strips and more in the hub; v51.99 = 0 (the industrial holo projections hang in the air
// over their shed blocks by design, ~170-550 u off).
//   node tools/city_float_probe.mjs [LSS/index-working.html] [label]                 the hub
//   GEN='{"seed":4101,"towerH":2300}' node tools/city_float_probe.mjs              a sector-city-like variant at the origin
import fs from 'node:fs';
import crypto from 'node:crypto';
const file = process.argv[2] || new URL('../LSS/index-working.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const label = process.argv[3] || '';
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('const HUB_CITY = {');
const b = src.indexOf('// ─────────────────────────── rendering ───────────────────────────');
if (a < 0 || b < 0) throw new Error('anchors not found');
const chunk = src.slice(a, b);
const helpers = [];
for (const re of [/function _aiSkirtR\(w, h, d\) \{[^\n]*\}/, /function _aiRoofFit[\s\S]*?\n\}\n/]) { const m = src.match(re); if (m) helpers.push(m[0]); }
const stubCtx = () => new Proxy({}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});
const document = { createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx() }) };
const fn = new Function('document', 'performance', 'isStandaloneQuest', '_LSS_IS_MOBILE',
  chunk + '\n' + helpers.join('\n') + '\nreturn { HUB_CITY, _hubCityBuild };');
const { HUB_CITY, _hubCityBuild } = fn(document, performance, () => false, false);
const V = JSON.parse(process.env.GEN || "null"); const city = V ? _hubCityBuild(Object.assign({}, HUB_CITY.genome, V), { x: 0, z: 0, padY: 0, genome: Object.assign({}, HUB_CITY.genome, V), palette: null }) : _hubCityBuild(HUB_CITY.genome);
const PY = V ? 0 : HUB_CITY.padY, Ly = city.layers;
const hash = (arr) => crypto.createHash('md5').update(Buffer.from(arr.buffer)).digest('hex').slice(0, 10);
// supports: tower boxes, cylinders, bevels (as their bounding box, conservative), skirts ignored
const boxes = [], cyls = [];
const addBoxes = (arr) => { for (let i = 0; i < arr.length; i += 12) boxes.push([arr[i], arr[i + 1], arr[i + 2], arr[i + 3] / 2, arr[i + 4], arr[i + 5] / 2, arr[i + 6]]); };
addBoxes(Ly.twr); addBoxes(Ly.box); if (Ly.bevel) addBoxes(Ly.bevel); addBoxes(Ly.solar);
for (let i = 0; i < Ly.cyl.length; i += 12) cyls.push([Ly.cyl[i], Ly.cyl[i + 1], Ly.cyl[i + 2], Ly.cyl[i + 3] / 2, Ly.cyl[i + 4]]);
const dist = (x, y, z, self) => {
  let best = Infinity;
  for (const B of boxes) {
    if (B === self) continue;
    const dx = x - B[0], dz = z - B[2], ca = Math.cos(B[6]), sa = Math.sin(B[6]);
    const lx = ca * dx + sa * dz, lz = -sa * dx + ca * dz;
    const qx = Math.max(Math.abs(lx) - B[3], 0), qz = Math.max(Math.abs(lz) - B[5], 0), qy = Math.max(B[1] - y, 0, y - (B[1] + B[4]));
    const d = Math.hypot(qx, qy, qz); if (d < best) best = d;
  }
  for (const C of cyls) {
    if (C === self) continue;
    const r = Math.max(Math.hypot(x - C[0], z - C[2]) - C[3], 0), qy = Math.max(C[1] - y, 0, y - (C[1] + C[4]));
    const d = Math.hypot(r, qy); if (d < best) best = d;
  }
  return best;
};
// a decoration floats if its base centre (or, for a tall strip, any of four points up it) is > TOL from every support
const TOL = 12;
const out = {};
const probe = (key, pts, keep, name) => {
  const arr = Ly[key]; if (!arr) return;
  let n = 0, fl = 0; const ex = [];
  for (let i = 0; i < arr.length; i += 12) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2], sy = arr[i + 4];
    if (y < PY + 2) continue;   // on the deck
    if (keep && !keep(arr[i + 3], sy, arr[i + 5], arr[i + 10])) continue;
    n++;
    const selfB = key === 'box' || key === 'solar' ? boxes.find(B => B[0] === x && B[1] === y && B[2] === z) : null;
    const selfC = key === 'cyl' ? cyls.find(C => C[0] === x && C[1] === y && C[2] === z) : null;
    let worst = 0;
    for (const f of pts) { const d = dist(x, y + sy * f, z, selfB || selfC); if (d > worst) worst = d; }
    // a big cylinder (a round tower) is supported when >= 3 stilts stand under its disc and reach its base
    if (worst > TOL && key === 'cyl' && arr[i + 3] > 120) {
      const R = arr[i + 3] / 2;
      let n3 = 0; for (const C of cyls) if (Math.abs(C[3] - 18) < 0.01 && Math.hypot(C[0] - x, C[2] - z) + 18 <= R + 0.5 && C[1] + C[4] >= y - 1) n3++;
      if (n3 >= 3) worst = 0;
    }
    if (worst > TOL) { fl++; if (ex.length < 3) ex.push([Math.round(x), Math.round(y - PY), Math.round(z), Math.round(arr[i + 3]), Math.round(sy), Math.round(worst)]); }
  }
  out[name || key] = { above_deck: n, floating: fl, eg: ex };
};
probe('cyl', [0]); probe('box', [0]); probe('solar', [0]); probe('dish', [0]); probe('holo', [0.5]);
// neon: the vertical EDGE strips (8 x h x 8) sampled up their height, the PARAPET strips (h 9) at their middle;
// beacon cubes on mast tips (mode 2) and door slabs are not edge strips
probe('neon', [0.05, 0.35, 0.65, 0.95], (sx, sy, sz, mode) => mode < 1.5 && sx <= 9.5 && sz <= 9.5 && sy >= 60, 'n_edge');
probe('neon', [0.5], (sx, sy, sz, mode) => mode < 1.5 && Math.abs(sy - 9) < 0.01, 'n_parapet');
console.log(label, JSON.stringify({ counts: Object.fromEntries(Object.keys(Ly).map(k => [k, Ly[k].length / 12])), twrHash: hash(Ly.twr), stats: city.stats }));
for (const k of Object.keys(out)) console.log('  ', k.padEnd(6), JSON.stringify(out[k]));
