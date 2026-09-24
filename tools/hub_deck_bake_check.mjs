// v48.40 (perf review O1.15): the hub-city deck noise bake with per-octave lattice tables vs a git ref's.
//   node tools/hub_deck_bake_check.mjs [gitRef]      (gitRef defaults to HEAD)
// Runs the block from `const img = a2.createImageData(CS, CS);` to `_hubCityBuild._noiseImg = img;` out of
// both builds' lss.js and byte-compares the whole RGBA image at the shipped 1024^2 and two other sizes
// (an off-by-one in a table bound shows up as black pixels: undefined -> NaN -> 0). Then times it.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'HEAD';
const NEW = fs.readFileSync(path.join(ROOT, 'LSS/lss.js'), 'utf8');
const OLD = execSync('git show ' + REF + ':LSS/lss.js', { cwd: ROOT, maxBuffer: 1 << 30 }).toString();
function bake(S, CS) {
  const a = S.indexOf('const img = a2.createImageData(CS, CS);');
  const e = '_hubCityBuild._noiseImg = img;', b = S.indexOf(e, a) + e.length;
  if (a < 0 || b < a) throw new Error('bake block not found');
  const fn = new Function('CS', 'a2', '_hubCityBuild', S.slice(a, b) + '\nreturn img;');
  const a2 = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData() {} };
  const t0 = performance.now(); const img = fn(CS, a2, {}); return { d: img.data, ms: performance.now() - t0 };
}
let allOk = true;
for (const CS of [1024, 512, 777]) {
  const o = bake(OLD, CS), n = bake(NEW, CS);
  let diff = 0; for (let i = 0; i < o.d.length; i++) if (o.d[i] !== n.d[i]) diff++;
  allOk = allOk && diff === 0;
  console.log((diff ? 'FAIL ' : 'OK   ') + 'CS ' + CS + ': bytes differing ' + diff + ' | ' + REF + ' ' + o.ms.toFixed(1) + ' ms, now ' + n.ms.toFixed(1) + ' ms (cold)');
}
const med = (v) => v.slice().sort((p, q) => p - q)[v.length >> 1];
const to = [], tn = []; for (let r = 0; r < 4; r++) { to.push(bake(OLD, 1024).ms); tn.push(bake(NEW, 1024).ms); }
console.log('CS 1024 warm median: ' + REF + ' ' + med(to).toFixed(1) + ' ms, now ' + med(tn).toFixed(1) + ' ms');
console.log(allOk ? 'ALL BYTE-IDENTICAL' : 'MISMATCH');
process.exit(allOk ? 0 : 1);
