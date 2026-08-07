// aegis_perk_check.cjs — coverage gate for the 35 Aegis ship perks.
//
//   node tools/aegis_perk_check.cjs
//
// Parses AEGIS.TREES out of index-working.html (7 ships x 5 ranks) and asserts
// each perk has an implementation site tagged with its own marker comment. The
// point is NOT to prove behaviour — it is to make a SILENTLY MISSING perk
// impossible. Three of the five bugs found in the v36.66-69 pass were perks
// whose code did something plausible for a DIFFERENT perk, so "there is code
// near rank N" is not enough: each entry names the function it must live in.
const fs = require('fs');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';
const src = fs.readFileSync(ROOT + '/LSS/index-working.html', 'utf8');

const treeStart = src.indexOf('AEGIS.TREES = {');
if (treeStart < 0) { console.log('FAIL: could not find AEGIS.TREES'); process.exit(1); }
const chunk = src.slice(treeStart, treeStart + 6000);
const ships = {};
let cur = null;
for (const line of chunk.split('\n')) {
  const sh = line.match(/^\s{2}([A-Z]+):\s*\[/);
  if (sh) { cur = sh[1]; ships[cur] = []; continue; }
  const row = line.match(/^\s*\[(\d+),\s*'([^']+)'/);
  if (row && cur) ships[cur].push([+row[1], row[2]]);
}
const names = Object.keys(ships);
let fails = 0;
const fail = m => { fails++; console.log('FAIL: ' + m); };

let total = 0;
for (const sh of names) total += ships[sh].length;
console.log('  parsed ' + names.length + ' ships / ' + total + ' perks');
if (names.length !== 7) fail('expected 7 ships, got ' + names.length + ' (' + names.join(',') + ')');
if (total !== 35) fail('expected 35 perks, got ' + total);

// Where each perk's implementation must be reachable from. A perk counts as
// implemented if its rank gate appears inside one of these functions.
const HOMES = {
  'PYRO:2':  ['_pyroBurstN'], 'PYRO:8':  ['_aegisDmgOut'], 'PYRO:11': ['_aegisDmgOut'],
  'PYRO:17': ['_pyroBurstN'], 'PYRO:20': ['_pyroGasIgniteBlast'],
  'VORTEX:2':  ['fireHitscan'], 'VORTEX:8': ['_aegisShipUpgrades'], 'VORTEX:11': ['executeAbility'],
  'VORTEX:17': ['_aegisShipUpgrades'], 'VORTEX:20': ['*'],
  'PUNCTURE:2': ['updateWorldEffects'], 'PUNCTURE:8': ['_aegisShipUpgrades'],
  'PUNCTURE:11': ['executeAbility', 'updateShooting', 'activateAbility'], 'PUNCTURE:17': ['fireHitscan'], 'PUNCTURE:20': ['executeAbility'],
  'SLAYER:2': ['_aegisDmgOut'], 'SLAYER:8': ['executeAbility', 'activateAbility'],
  'SLAYER:11': ['*'], 'SLAYER:17': ['executeAbility'], 'SLAYER:20': ['*'],
  'TRACKER:2': ['fireProjectile'], 'TRACKER:8': ['_aegisDmgOut'], 'TRACKER:11': ['_aegisShipUpgrades'],
  'TRACKER:17': ['_tickTrackerSonarDOT'], 'TRACKER:20': ['activateCore', 'updateAbilities'],
  'BLASTER:2': ['fireHitscan'], 'BLASTER:8': ['firePowerShot'], 'BLASTER:11': ['*'],
  'BLASTER:17': ['firePowerShot'], 'BLASTER:20': ['_perkEffectiveBag', '_aegisShipUpgrades'],
  'SYPHON:2': ['_aegisDmgOut'], 'SYPHON:8': ['fireHitscan', '_syphonChainZap'], 'SYPHON:11': ['*'],
  'SYPHON:17': ['_aegisDmgOut'], 'SYPHON:20': ['_aegisShipUpgrades'],
};
// Map every `_aegisUpFor(N)` call site to its enclosing top-level function.
const fnStarts = [];
const fnRe = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\())/gm;
let m;
while ((m = fnRe.exec(src))) fnStarts.push([m.index, m[1] || m[2]]);
const enclosing = idx => {
  let best = '?';
  for (const [at, nm] of fnStarts) { if (at <= idx) best = nm; else break; }
  return best;
};
const sites = {};
const upRe = /_aegisUpFor\((\d+)\)/g;
while ((m = upRe.exec(src))) {
  const r = m[1], fn = enclosing(m.index);
  (sites[r] = sites[r] || new Set()).add(fn);
}
for (const sh of names) {
  for (const [rank, label] of ships[sh]) {
    const key = sh + ':' + rank;
    const want = HOMES[key];
    const got = sites[String(rank)] ? [...sites[String(rank)]] : [];
    if (!want) { fail(key + ' "' + label + '" has no declared home in this gate'); continue; }
    if (!got.length) { fail(key + ' "' + label + '" — no _aegisUpFor(' + rank + ') site anywhere'); continue; }
    if (want[0] === '*') continue;
    if (!want.some(w => got.some(g => g && g.indexOf(w) >= 0))) {
      fail(key + ' "' + label + '" — expected a site in {' + want.join(', ') + '}, found only {' + got.join(', ') + '}');
    }
  }
}
// Regression guards for the specific wrong-subject bugs fixed in v36.66-69.
const GUARDS = [
  ['_aegisDmgOut is not a dumping ground', () => {
    const a = src.indexOf('function _aegisDmgOut'), b = src.indexOf('\n}', a);
    return (src.slice(a, b).match(/_aegisUpFor\(/g) || []).length <= 7;
  }],
  ['SYPHON 20 actually writes syphonMissileRacks', () => /player\.syphonMissileRacks\s*=/.test(src)],
  ['BLASTER 20 no longer grants the deleted +1000 shield', () => !/maxShield \+= 1000/.test(src)],
  ['PYRO burst drains before the reload gate', () => {
    const d = src.indexOf('_pyroBurstLeft > 0'), g = src.indexOf('if (firing && player.fireTimer <= 0)');
    return d > 0 && g > 0 && d < g;
  }],
  ['TRACKER 20 fires from the CORE, not the Rockets ability', () =>
    /_mtrN\s*=/.test(src) && /_mtrRate\s*=/.test(src)],
  ['w.splash is never mutated in place', () => !/\bw\.splash\s*\*=/.test(src)],
];
for (const [label, fn] of GUARDS) {
  let pass = false;
  try { pass = !!fn(); } catch (_) {}
  if (pass) console.log('  ok: ' + label); else fail(label);
}
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL AEGIS PERK CHECKS PASSED');
process.exit(fails ? 1 : 0);
