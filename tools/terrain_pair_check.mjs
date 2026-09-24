// v48.40 (perf review O1.13 + O1.14): prove the chunk-shell build is unchanged.
//   node tools/terrain_pair_check.mjs [gitRef]      (gitRef defaults to HEAD)
// 1. POINT TEST, inside the CURRENT build: _stCarvedPair(x,z,T) must equal _stGroundYCarved(x,z,T) and
//    _stCeilYCarved(x,z,T) bit for bit (Object.is) - run this after ANY edit to the carved trio.
// 2. WHOLE CHUNKS, current build vs gitRef: a ground job, the hand-over, the adopting ceiling job, against
//    the ref's two independent jobs - vertices of both shells and the ceiling colours bit-identical, the
//    ground colours all zero (the ground shader never reads them - proven in the pane by rendering the
//    ground alone with magenta vertex colours: 0 bytes differ). Plus a timing of both shells per chunk.
// Configs: The Nexus as captured live in v48.40 (rim pinch, 7 rooms / 12 lanes) and variants for
// WALL_PINCH, _openTop, colonnade PILLARS, endless-style weighted lanes + warp, grassy, and the HUB branch.
// No three.js install needed: a Color shim with r165's exact sRGB->linear formula stands in for THREE.Color
// on BOTH sides, so the comparison is old code vs new code under one colour implementation.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'HEAD';
const NEW = fs.readFileSync(path.join(ROOT, 'LSS/lss.js'), 'utf8');
const OLD = execSync('git show ' + REF + ':LSS/lss.js', { cwd: ROOT, maxBuffer: 1 << 30 }).toString();

const s2l = (c) => (c < 0.04045) ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
class Color {
  constructor(r, g, b) { this.r = 1; this.g = 1; this.b = 1; if (r !== undefined) this.set(r, g, b); }
  set(r, g, b) {
    if (g !== undefined) { this.r = r; this.g = g; this.b = b; return this; }
    if (r && r.isColor) return this.copy(r);
    const hex = Math.floor(r);
    this.r = s2l((hex >> 16 & 255) / 255); this.g = s2l((hex >> 8 & 255) / 255); this.b = s2l((hex & 255) / 255);
    return this;
  }
  getHex() { return 0; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  lerp(c, a) { this.r += (c.r - this.r) * a; this.g += (c.g - this.g) * a; this.b += (c.b - this.b) * a; return this; }
}
Color.prototype.isColor = true;
const THREE = { Color };

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (ch === '`') { i++; while (src[i] !== '`') { if (src[i] === '\\') i++; else if (src[i] === '$' && src[i + 1] === '{') i = matchBrace(src, i + 1); i++; } continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i; }
  }
  throw new Error('no match');
}
// the LAST definition at line start = the main-thread copy (the worker's copies sit earlier, in a template)
function fnSrc(src, name) {
  const at = src.lastIndexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('missing fn ' + name);
  return src.slice(at + 1, matchBrace(src, src.indexOf('{', src.indexOf(')', at))) + 1);
}
function constSrc(src, name) {
  let at = src.lastIndexOf('\nconst ' + name + ' = ');
  if (at < 0) at = src.lastIndexOf('\nconst ' + name + '=');
  if (at < 0) throw new Error('missing const ' + name);
  const vs = src.indexOf('=', at) + 1; let j = vs; while (src[j] === ' ') j++;
  if (src[j] === '{' || src[j] === '[') return src.slice(at + 1, matchBrace(src, j) + 1) + ';';
  return src.slice(at + 1, src.indexOf(';', vs) + 1);
}
const FNS = ['_stHash2', '_stHash2i', '_stNoise2', '_stFbm', '_stRidged', '_stGroundY', '_stCeilY', '_stSmooth', '_stRouteAt',
  '_stGroundYCarvedBase', '_stCeilYCarvedBase', '_stPillarAt', '_stGroundYCarved', '_stCeilYCarved', '_swRimPinch', '_stPatch',
  '_swPalXfMix', '_swColGroundB', '_swColGround', '_swColCeilB', '_swColCeil', '_swShellJobNew', '_swShellJobRows'];
const CONSTS = ['_ST_EMPTY', '_stRouteScratch', '_SW_CHUNK', '_SW_CELLS', '_SW_FOOT_MARGIN', '_SW_BIOMES', '_SW_tmpC', '_SW_cA', '_swXfC'];
function load(S) {
  const has = (n) => S.lastIndexOf('\nfunction ' + n + '(') >= 0;
  const fns = FNS.slice(), consts = CONSTS.slice();
  const paired = has('_stCarvedPair');
  if (paired) { fns.push('_stCarvedPair', '_swPairOn'); consts.push('_stPairScratch'); }
  if (has('_swLin')) { fns.push('_swLin'); consts.push('_swLinCache'); }
  let code = '';
  for (const c of consts) code += constSrc(S, c) + '\n';
  if (paired) code += 'let _swPairLast = null;\n';
  for (const f of fns) code += fnSrc(S, f) + '\n';
  // _swShellJobFinish's hand-over line (the rest of it builds a mesh and needs a scene)
  code += 'function _handover(J){ if (!J.isCeil && J.gY) _swPairLast = J; }\n';
  code += 'return { paired: ' + paired + ', _stGroundYCarved, _stCeilYCarved, _swShellJobNew, _swShellJobRows, _handover' +
          (paired ? ', _stCarvedPair' : '') + ' };';
  const game = { levelSpheres: [], levelCylinders: [], _swPalXf: null, _hubTerra: null, _buildSeq: 7 };
  const api = new Function('THREE', 'game', 'window', code)(THREE, game, {});
  api.game = game;
  return api;
}
const N = load(NEW), O = load(OLD);
if (!N.paired) { console.log('the current build has no _stCarvedPair - nothing to check'); process.exit(1); }

const NEXUS = { T: { ON: true, OCTAVES: 5, LACUNARITY: 2, GAIN: 0.5, EXPONENT: 1.75, BASE_FREQ: 0.0014925373134328358, WARP: 0,
  WARP_FREQ: 0.0006784260515603799, GROUND_AMP: 1120, CEIL_AMP: 1120, YFLOOR: -600, YCEIL: 600, YMID: 0, AMP: 1120, PILLARS: null,
  CLEAR_SOFT: 120, ARENA_DROP: 640, ARENA_RISE: 760, FOOT: { minX: -1370, maxX: 1370, minZ: -1580, maxZ: 1580 }, ENDLESS: false,
  _openTop: false, HUB: false, WL: -420.8, biome: 'rocky', snowLine: 0.68 },
  S: [[0, 0, 0, 375], [0, 0, -1200, 330], [1050, 300, -600, 270], [1050, -300, 600, 270], [0, 0, 1200, 330], [-1050, -300, 600, 270], [-1050, 300, -600, 270]]
    .map(([cx, cy, cz, r]) => ({ cx, cy, cz, r })),
  C: [[0, 0, -1200, 1050, 300, -600], [1050, 300, -600, 1050, -300, 600], [1050, -300, 600, 0, 0, 1200], [0, 0, 1200, -1050, -300, 600],
      [-1050, -300, 600, -1050, 300, -600], [-1050, 300, -600, 0, 0, -1200], [0, 0, -1200, 0, 0, 0], [1050, 300, -600, 0, 0, 0],
      [1050, -300, 600, 0, 0, 0], [0, 0, 1200, 0, 0, 0], [-1050, -300, 600, 0, 0, 0], [-1050, 300, -600, 0, 0, 0]]
    .map(([ax, ay, az, bx, by, bz]) => ({ ax, ay, az, bx, by, bz, r: 180 })) };
const base = NEXUS.T;
const clear = NEXUS.S.map(s => ({ x: s.cx, z: s.cz, r: s.r + 60 })).concat(NEXUS.C.map(c => ({ ax: c.ax, az: c.az, bx: c.bx, bz: c.bz, r: c.r })));
const PIL = { cell: 820, soft: 160, jitter: 0.62, drop: 0.2, r: 150, ox: 13.7, oz: -4.2, overlap: 80, clear };
const CFGS = [
  ['nexus rocky (rim pinch, rooms + lanes)', { ...base }, NEXUS.S, NEXUS.C],
  ['nexus + WALL_PINCH 0.3', { ...base, WALL_PINCH: 0.3 }, NEXUS.S, NEXUS.C],
  ['nexus _openTop', { ...base, _openTop: true }, NEXUS.S, NEXUS.C],
  ['colonnade-style PILLARS', { ...base, PILLARS: PIL }, NEXUS.S, NEXUS.C],
  ['PILLARS + _openTop', { ...base, _openTop: true, PILLARS: PIL }, NEXUS.S, NEXUS.C],
  ['endless-style (no FOOT, weighted lanes, warp)', { ...base, FOOT: null, ENDLESS: true, WARP: 250 }, [], NEXUS.C.map((c, i) => ({ ...c, r: c.r * 2, w: 0.42 + 0.05 * (i % 3) }))],
  ['grassy biome', { ...base, biome: 'grassy' }, NEXUS.S, NEXUS.C],
  ['HUB branch (mossy, _hubTerra null)', { ...base, HUB: true, biome: 'mossy', WARP: 250 }, [], []],
];
let allOk = true;
for (const [name, T, S, C] of CFGS) {
  for (const A of [N, O]) { A.game.levelSpheres = S; A.game.levelCylinders = C; }
  let bad = 0, pts = 0, err = null;
  const out = { g: 0, c: 0 };
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  try {
    for (let k = 0; k < 20000; k++) {
      const x = (rnd() - 0.5) * 9000, z = (rnd() - 0.5) * 9000;
      N._stCarvedPair(x, z, T, out);
      if (!Object.is(N._stGroundYCarved(x, z, T), out.g) || !Object.is(N._stCeilYCarved(x, z, T), out.c)) bad++;
      pts++;
    }
  } catch (e) { err = String(e); }
  let vBad = 0, cBad = 0, gNonZero = 0, adopted = 0, chunks = 0, tO = 0, tN = 0;
  try {
    for (const [cx, cz] of [[-3, -2], [0, 0], [1, -1], [2, 3], [-1, 2], [4, 0], [-5, 5]]) {
      const x0 = cx * 900, z0 = cz * 900;
      let t0 = performance.now();
      const oG = O._swShellJobNew(x0, z0, false, T); O._swShellJobRows(oG, 1e9); O._handover(oG);
      const oC = O._swShellJobNew(x0, z0, true, T); O._swShellJobRows(oC, 1e9);
      tO += performance.now() - t0; t0 = performance.now();
      const nG = N._swShellJobNew(x0, z0, false, T); N._swShellJobRows(nG, 1e9); N._handover(nG);
      const nC = N._swShellJobNew(x0, z0, true, T); N._swShellJobRows(nC, 1e9);
      tN += performance.now() - t0;
      chunks++; if (nC.adopt) adopted++;
      for (let i = 0; i < oG.verts.length; i++) {
        if (!Object.is(oG.verts[i], nG.verts[i]) || !Object.is(oC.verts[i], nC.verts[i])) vBad++;
        if (!Object.is(oC.cols[i], nC.cols[i])) cBad++;
        if (nG.cols[i] !== 0) gNonZero++;
      }
    }
  } catch (e) { err = (err ? err + ' | ' : '') + String(e); }
  const ok = !err && bad === 0 && vBad === 0 && cBad === 0 && gNonZero === 0 && adopted === chunks;
  allOk = allOk && ok;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + ': pair!=trio ' + bad + '/' + pts + ' | chunks ' + chunks + ', ceiling adopted ' + adopted +
    ', verts!= ' + vBad + ', ceiling cols!= ' + cBad + ', ground cols!=0 ' + gNonZero + ' | ' + REF + ' ' + (tO / chunks).toFixed(2) +
    ' ms, now ' + (tN / chunks).toFixed(2) + ' ms per chunk (cold-ish)' + (err ? ' ERR ' + err : ''));
}
console.log(allOk ? 'ALL BIT-IDENTICAL' : 'MISMATCH');
process.exit(allOk ? 0 : 1);
