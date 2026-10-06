// AI-CITY BOARDS - build-time prep for the LSS city facades (labs/eml_blocks.html is where the look
// was designed with the owner). Run from the repo root:   node tools/ai_boards_prep.mjs
//
// IN : LSS/concept/shaders/circuits.png, circuit2.png .. circuit5.png  (the owner's concept boards,
//      1254 px). circuit2-5 each sit inside a FLAT dark border (~3 % a side) with the panel's own thin
//      edge line inside it. (v51.98) The flat border is TRIMMED (panelRect): owner, marking the black band
//      between two stacked tiles on a tower, "this is what i mean by the vertical spacing between tiles" -
//      two stacked boards showed the border twice (~6 % of a tile of black between every row and column),
//      while at a face's edges the building frame hid the same border. The panel's edge line is KEPT, so
//      fitted boards still read as panels and now meet on a hairline. circuits.png tiles seamlessly: untouched.
// OUT: LSS/tex/ai_boards.webp  - the five boards resized to 1024 and stacked vertically (1024 x 5120),
//                                lossy q88. Layer i = rows [i*1024, (i+1)*1024).
//      LSS/tex/ai_phase.webp   - per pixel, where along its LINE NETWORK it sits, so dots can ride the
//                                real traces (lossless): R,G = 0.5 + 0.5*(cos,sin)(2pi*dist/90px)*strength,
//                                B = dist / 1100 px (absolute, for spikes running out along the lines).
//                                Off-line pixels are (128,128,0): a zero vector = no dots.
// The phase is computed from the ENCODED albedo (decoded back here), so it lines up with exactly the
// pixels the game samples.
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'LSS', 'concept', 'shaders');
const OUT = path.join(ROOT, 'LSS', 'tex');
const BOARDS = ['circuits.png', 'circuit2.png', 'circuit3.png', 'circuit4.png', 'circuit5.png'];
const FROM_CENTRE = [false, true, false, false, false];   // circuit2 is radial: its dots stream out of the heart
const FRAMED = [false, true, true, true, true];           // circuit2-5 sit in a flat border (trimmed, see panelRect)
const N = 1024, PERIOD = 90, DMAX = 1100;

// The panel inside a flat border: walk in from each side while the whole line is still the border colour
// (measured on these boards: exactly 0 % of a border line differs from the corner colour by > 10; the panel's
// first line - its edge line, or circuit2's and circuit3's content - is 74-95 %). Capped at 8 % a side.
async function panelRect(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) { const o = (y * W + x) * C; br += data[o]; bg += data[o + 1]; bb += data[o + 2]; n++; }
  br /= n; bg /= n; bb /= n;
  const off = (o) => Math.max(Math.abs(data[o] - br), Math.abs(data[o + 1] - bg), Math.abs(data[o + 2] - bb)) > 10;
  const row = (y) => { let k = 0; for (let x = 0; x < W; x++) if (off((y * W + x) * C)) k++; return k / W; };
  const col = (x) => { let k = 0; for (let y = 0; y < H; y++) if (off((y * W + x) * C)) k++; return k / H; };
  const lim = Math.round(Math.min(W, H) * 0.08);
  let t = 0, b = H - 1, l = 0, r = W - 1;
  while (t < lim && row(t) < 0.5) t++;
  while (H - 1 - b < lim && row(b) < 0.5) b--;
  while (l < lim && col(l) < 0.5) l++;
  while (W - 1 - r < lim && col(r) < 0.5) r--;
  return { left: l, top: t, width: r - l + 1, height: b - t + 1 };
}

// Walk every line network of one board. Line pixels = saturated neon (cyan / magenta) OR copper
// (copper is faint - saturation 20-50 at brightness 60-120 on circuit4 - so it gets its own warm test).
// Networks flood on the mask grown by 1 px (thin traces dim for a pixel or two), seeded at their
// brightest pixel (or nearest the centre on a radial board), then Dial's shortest path with 5 per
// straight step / 7 per diagonal (~sqrt 2) so a dot's speed is the same on the 45-degree runs.
// (v52.00) W x H boards, and wrapX: the board tiles left-right, so the walk runs round a horizontal torus and
// the dots go straight through the wrap (the bevel strip). dmax = the distance B saturates at.
function boardPhase(d, ch, out, off, fromCentre, W = N, H = N, wrapX = false, dmax = DMAX) {
  const M = W * H, mask = new Float32Array(M), dist = new Int32Array(M).fill(-1), comp = new Int32Array(M).fill(-1), q = new Int32Array(M);
  const nbX = (x, dx) => { const nx = x + dx; return wrapX ? (nx + W) % W : nx; };
  for (let p = 0; p < M; p++) {
    const r = d[p * ch], g = d[p * ch + 1], b = d[p * ch + 2], mx = Math.max(r, g, b), sat = mx - Math.min(r, g, b);
    const neon = Math.min(1, Math.max(0, (sat - 40) / 50)) * Math.min(1, Math.max(0, (mx - 60) / 60));
    const copper = r >= g ? Math.min(1, Math.max(0, (r - b - 16) / 22)) * Math.min(1, Math.max(0, (mx - 50) / 35)) : 0;
    mask[p] = Math.max(neon, copper);
    out[off + p * 3] = 128; out[off + p * 3 + 1] = 128; out[off + p * 3 + 2] = 0;
  }
  const conn = new Uint8Array(M);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on = 0;
    for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) {
      const nx = nbX(x, dx), ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask[ny * W + nx] >= .25) on = 1;
    }
    conn[y * W + x] = on;
  }
  let id = 0, nets = 0;
  for (let p0 = 0; p0 < M; p0++) {
    if (!conn[p0] || comp[p0] >= 0) continue;
    let qh = 0, qt = 0, best = p0, bestV = -Infinity; q[qt++] = p0; comp[p0] = id;
    while (qh < qt) {
      const p = q[qh++];
      const v = fromCentre ? -((p % W - W / 2) ** 2 + (((p / W) | 0) - H / 2) ** 2) : mask[p] * Math.max(d[p * ch], d[p * ch + 1], d[p * ch + 2]);
      if (v > bestV) { bestV = v; best = p; }
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = nbX(x, dx), ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (comp[n] < 0 && conn[n]) { comp[n] = id; q[qt++] = n; }
      }
    }
    if (qt >= 40) {
      nets++;
      const B = [[], [], [], [], [], [], [], []]; let cur = 0, pending = 1; dist[best] = 0; B[0].push(best);
      while (pending > 0) {
        const bk = B[cur & 7];
        while (bk.length) {
          const p = bk.pop(); pending--; if (dist[p] !== cur) continue;
          const x = p % W, y = (p / W) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = nbX(x, dx), ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const n = ny * W + nx; if (comp[n] !== id) continue;
            const nd = cur + (dx && dy ? 7 : 5);
            if (dist[n] < 0 || nd < dist[n]) { dist[n] = nd; B[nd & 7].push(n); pending++; }
          }
        }
        cur++;
      }
      for (let i = 0; i < qt; i++) {
        const pp = q[i], dpx = dist[pp] / 5, a = dpx / PERIOD * Math.PI * 2, s = mask[pp], o = off + pp * 3;
        out[o] = Math.round((0.5 + 0.5 * Math.cos(a) * s) * 255);
        out[o + 1] = Math.round((0.5 + 0.5 * Math.sin(a) * s) * 255);
        out[o + 2] = Math.min(255, Math.round(dpx / dmax * 255));
      }
    }
    id++;
  }
  return nets;
}

const t0 = Date.now();
const layers = [];
const crops = [];
for (let i = 0; i < BOARDS.length; i++) {
  const file = path.join(SRC, BOARDS[i]);
  let img = sharp(file).removeAlpha();
  if (FRAMED[i]) { const rc = await panelRect(file); crops.push(BOARDS[i] + ' ' + rc.left + ',' + rc.top + ' ' + rc.width + 'x' + rc.height); img = img.extract(rc); }
  layers.push(await img.resize(N, N, { kernel: 'lanczos3' }).raw().toBuffer());
}
console.log('panels:', crops.join(' | '));
const atlas = Buffer.concat(layers);
fs.mkdirSync(OUT, { recursive: true });
const albPath = path.join(OUT, 'ai_boards.webp');
await sharp(atlas, { raw: { width: N, height: N * BOARDS.length, channels: 3 } }).webp({ quality: 88, effort: 6 }).toFile(albPath);
// phase from what the game will actually decode
const dec = await sharp(albPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const ch = dec.info.channels;
const ph = new Uint8Array(N * N * BOARDS.length * 3);
const nets = BOARDS.map((_, i) => boardPhase(dec.data.subarray(i * N * N * ch, (i + 1) * N * N * ch), ch, ph, i * N * N * 3, FROM_CENTRE[i]));
const phPath = path.join(OUT, 'ai_phase.webp');
await sharp(Buffer.from(ph.buffer), { raw: { width: N, height: N * BOARDS.length, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(phPath);
// (v52.00) THE BEVEL BOARD - circuit_horizontal.png. Owner, of the black bevel the core towers stand on: "can be used on
// the bevel connector". A 3:1 strip that tiles left-right (measured: the wrap seam differs from its neighbour column
// ~2x as much as neighbouring columns do, unrelated columns ~5x) but not top-bottom: laid round each sloped side of
// the bevel, one board up the slope. Its own pair of files (the atlas layers are square), the phase walked round a
// horizontal torus so dots run straight through the wrap, B saturating at 2200 px (the strip's networks run long).
const BVW = 2048, BVH = Math.round(BVW / 3);
const bvBuf = await sharp(path.join(SRC, 'circuit_horizontal.png')).removeAlpha().resize(BVW, BVH, { kernel: 'lanczos3' }).raw().toBuffer();
const bvPath = path.join(OUT, 'ai_bevel.webp');
await sharp(bvBuf, { raw: { width: BVW, height: BVH, channels: 3 } }).webp({ quality: 88, effort: 6 }).toFile(bvPath);
const bvDec = await sharp(bvPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const bvPh = new Uint8Array(BVW * BVH * 3);
const bvNets = boardPhase(bvDec.data, bvDec.info.channels, bvPh, 0, false, BVW, BVH, true, 2200);
const bvPhPath = path.join(OUT, 'ai_bevel_phase.webp');
await sharp(Buffer.from(bvPh.buffer), { raw: { width: BVW, height: BVH, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(bvPhPath);
console.log('bevel board', BVW + 'x' + BVH, bvNets, 'line networks | ai_bevel.webp', (fs.statSync(bvPath).size / 1024).toFixed(0) + ' KB',
  '| ai_bevel_phase.webp', (fs.statSync(bvPhPath).size / 1024).toFixed(0) + ' KB');
console.log('boards', BOARDS.length, 'line networks per board', nets.join(' / '),
  '| ai_boards.webp', (fs.statSync(albPath).size / 1024).toFixed(0) + ' KB',
  '| ai_phase.webp', (fs.statSync(phPath).size / 1024).toFixed(0) + ' KB', '|', Date.now() - t0, 'ms');
