// v48.40 (perf review O1.12): The Spire's field with its trig tables vs a git ref's field.
//   node tools/spire_table_check.mjs [gitRef]      (gitRef defaults to HEAD)
// eval(), floorHole() - including storeys outside the table (-1, nfl, 1.5: the per-call fallback) -
// and grad() must be bit-identical (Object.is), and so must eval() on a G mutated IN PLACE after the
// tables were built (the __spireArena.G() console case: _tok must rebuild them). Also parses the source
// in the worker form (`const FIELD = SRC;`), and times eval() both ways.
// tools/arena_port_check.cjs is the other half: it pins the ported field to the LAB source.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'HEAD';
const NEW = fs.readFileSync(path.join(ROOT, 'LSS/lss.js'), 'utf8');
const OLD = execSync('git show ' + REF + ':LSS/lss.js', { cwd: ROOT, maxBuffer: 1 << 30 }).toString();
function fieldSrc(S) {
  const k = 'const _ARENA_FIELD_SRC = `';
  const a = S.indexOf(k) + k.length;
  return S.slice(a, S.indexOf('\n}`;', a) + 2);
}
function buildParams(S) {
  const a = S.indexOf('\nfunction _arenaBuildParams(');
  return new Function('return (' + S.slice(a + 1, S.indexOf('\n}\n', a) + 2) + ')')();
}
const FO = new Function('return (' + fieldSrc(OLD) + ')')();
const FN = new Function('return (' + fieldSrc(NEW) + ')')();
new Function('const FIELD = ' + fieldSrc(NEW) + ';\nreturn FIELD;')();   // the worker realms' form
const mk = buildParams(NEW);
const rooms = [{ x: 0, z: 0, r: 300 }, { x: 900, z: -400, r: 260 }, { x: -700, z: 800, r: 240 }];
const med = (v) => v.slice().sort((p, q) => p - q)[v.length >> 1];
let allOk = true;
for (const a of [{ seed: 7, floors: 3, spikeAmt: 1.0, scale: 2 }, { seed: 31, floors: 4, spikeAmt: 0.6, scale: 1 }, { seed: 99, floors: 2, spikeAmt: 1.0, scale: 1.5 }]) {
  const G = mk(a, rooms);
  let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pts = [];
  for (let k = 0; k < 6000; k++) pts.push([(rnd() * 2 - 1) * G.R * 1.05, (rnd() * 2 - 1) * G.H * 1.05, (rnd() * 2 - 1) * G.R * 1.05]);
  let bad = 0, fh = 0, gr = 0, mu = 0;
  for (const [x, y, z] of pts) {
    if (!Object.is(FO.eval(x, y, z, G), FN.eval(x, y, z, G))) bad++;
    for (const f of [-1, 0, 1, G.floorY.length - 1, G.floorY.length, 1.5]) if (!Object.is(FO.floorHole(x, z, f, G), FN.floorHole(x, z, f, G))) fh++;
  }
  for (const [x, y, z] of pts.slice(0, 800)) { const o = FO.grad(x, y, z, G), n = FN.grad(x, y, z, G); for (let i = 0; i < 3; i++) if (!Object.is(o[i], n[i])) gr++; }
  const G2 = mk(a, rooms); FN.eval(1, 2, 3, G2); G2.satPhase += 0.5; G2.shaftR *= 1.1; G2.satR *= 0.9;
  for (const [x, y, z] of pts.slice(0, 300)) if (!Object.is(FO.eval(x, y, z, G2), FN.eval(x, y, z, G2))) mu++;
  const time = (F) => { const t0 = performance.now(); for (const [x, y, z] of pts) F.eval(x, y, z, G); return performance.now() - t0; };
  for (let w = 0; w < 3; w++) { time(FO); time(FN); }
  const to = [], tn = []; for (let r = 0; r < 5; r++) { to.push(time(FO)); tn.push(time(FN)); }
  const ok = !bad && !fh && !gr && !mu; allOk = allOk && ok;
  console.log((ok ? 'OK   ' : 'FAIL ') + JSON.stringify(a) + ': eval!= ' + bad + '/' + pts.length + ', floorHole!= ' + fh + ', grad!= ' + gr +
    ', mutated-G!= ' + mu + ' | ' + REF + ' ' + (1000 * med(to) / pts.length).toFixed(2) + ' us, now ' + (1000 * med(tn) / pts.length).toFixed(2) + ' us per eval');
}
console.log(allOk ? 'ALL BIT-IDENTICAL' : 'MISMATCH');
process.exit(allOk ? 0 : 1);
