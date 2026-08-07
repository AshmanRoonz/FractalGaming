// aegis_scope_check.cjs — containment gate for the TWO Aegis systems.
//
//   node tools/aegis_scope_check.cjs
//
// There are two unrelated things called "Aegis" and the whole class of bug this
// gate exists for is one of them leaking into a place the other owns:
//
//   System A  PERMANENT per-ship perk trees (AEGIS.TREES / _aegisUpFor).
//             Earned by XP, saved to localStorage AND synced to the account.
//             Must apply in SOLO EXHIBITION ONLY.
//   System B  ENDLESS AEGIS SURGE (run.aegis / _aegisSetLvl). A per-RUN bolt
//             ladder that must die with the run.
//
// ⚠ The trap that produced every bug here: `LSS.MODE === 'freeflight'` IS NOT
// "solo exhibition". startFreeFlight() sets MODE and THEN branches into the
// hosted-room path, so a SHARED exhibition room is 'freeflight' too. From
// v34.94 to v36.69 a comment claimed "freeflight-only, so MP balance is
// untouched" and nothing enforced it.
const fs = require('fs');
const ROOT = 'C:/Users/ashro/Fractal_Reality/FractalGaming';
const src = fs.readFileSync(ROOT + '/LSS/index-working.html', 'utf8');

let fails = 0;
const fail = m => { fails++; console.log('FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);

function body(sig, endMark) {
  const a = src.indexOf(sig);
  if (a < 0) return null;
  const b = src.indexOf(endMark, a);
  return b < 0 ? null : src.slice(a, b);
}

// ---- System A: every entry point to the PERSISTENT ladder is solo-gated ----
if (!/function _aegisSoloOnly/.test(src)) fail('_aegisSoloOnly is gone — the solo gate has no implementation');
else ok('_aegisSoloOnly exists');

const SOLO_GATED = [
  ['_aegisAbilityRank', 'function _aegisAbilityRank', '\n}'],
  ['_aegisApply',       'function _aegisApply()',     '\n}'],
  ['_aegisAwardXp',     'function _aegisAwardXp(',    '\n  const st'],
];
for (const [label, sig, end] of SOLO_GATED) {
  const b = body(sig, end);
  if (b === null) { fail(label + ' not found'); continue; }
  if (!/_aegisSoloOnly\(\)/.test(b)) {
    fail(label + ' reads the PERSISTENT ladder without _aegisSoloOnly() — ' +
         'a shared exhibition room would get full permanent perks');
  } else ok(label + ' is solo-gated');
}
// The gate must actually test the network flag, not just exist.
const soloBody = body('function _aegisSoloOnly', '\n}');
if (soloBody && /net\.active/.test(soloBody)) ok('_aegisSoloOnly tests net.active');
else fail('_aegisSoloOnly does not test net.active — it cannot distinguish a shared room');

// Endless must stay EXEMPT: its ranks are per-run, so gating them would break
// co-op endless for no balance gain. Assert the endless branch returns BEFORE
// the solo check rather than being folded into it.
const rankBody = body('function _aegisAbilityRank', '\n}');
if (rankBody) {
  const iEndless = rankBody.indexOf("LSS.MODE === 'endless'");
  const iSolo = rankBody.indexOf('_aegisSoloOnly()');
  if (iEndless >= 0 && iSolo >= 0 && iEndless < iSolo) ok('endless branch precedes the solo gate (deliberately exempt)');
  else fail('the endless branch no longer precedes the solo gate — co-op endless would lose its per-run ladder');
}

// ---- System A: modes that must NEVER see it ----
// The gate is centralised in _aegisAbilityRank, so the guarantee is that every
// perk reads through it. _aegisUpFor is the only public reader.
const upBody = body('function _aegisUpFor', '\n}');
if (upBody && /_aegisAbilityRank\(\)/.test(upBody)) ok('_aegisUpFor routes through _aegisAbilityRank (single choke point)');
else fail('_aegisUpFor no longer routes through _aegisAbilityRank — the mode gate is bypassable');
if (/function _aegisDmgOut[\s\S]{0,800}?_aegisAbilityRank\(\) < 0/.test(src)) ok('_aegisDmgOut early-returns on rank < 0');
else fail('_aegisDmgOut lost its rank < 0 early-return');

// ---- System B: the surge discharges on BOTH paths ----
const setLvl = body('_aegisSetLvl(run, lvl)', '\n  },');
if (!setLvl) fail('_aegisSetLvl not found');
else {
  if (/player\.chassis = a\.baseCh/.test(setLvl)) ok('_aegisSetLvl(0) restores the exact base chassis reference');
  else fail('_aegisSetLvl(0) no longer restores the base chassis reference');
  // The v36.70 additive revert.
  if (/maxHealth -= 2500/.test(setLvl) && /maxShield -= 2500/.test(setLvl)) ok('_aegisSetLvl(0) reverts the +2500 hull/shield grants');
  else fail('_aegisSetLvl(0) does not revert the +2500 grants — they leak onto the player singleton');
  if (/a\._absDone = \{\}/.test(setLvl)) ok('_aegisSetLvl(0) clears _absDone so the next run can re-grant');
  else fail('_aegisSetLvl(0) does not clear _absDone — the next run would skip the lvl 5/14 grants');
}
// Run-over must discharge itself, not rely on returnToRootMenu (co-op skips it).
const overIdx = src.indexOf('if (run.lives <= 0) {');
if (overIdx < 0) fail('run-over branch not found');
else {
  const seg = src.slice(overIdx, overIdx + 1600);
  if (/_aegisSetLvl\(run, 0\)/.test(seg)) ok('run-over discharges the surge directly (co-op never reaches teardown)');
  else fail('run-over does NOT discharge the surge — a co-op player keeps max rank while spectating');
}
// Teardown must still discharge too (the solo/quit path).
const teardown = src.indexOf('AEGIS SURGE teardown');
if (teardown > 0 && /_aegisSetLvl\(run, 0\)/.test(src.slice(teardown, teardown + 900))) ok('onTeardown discharges the surge');
else fail('onTeardown no longer discharges the surge');
// ⚠ Load-bearing ORDER: teardown nulls game.endlessRun AFTER the discharge.
// If that moved up, _aegisAbilityRank() would return -1, _aegisShipUpgrades
// would early-return, and the boosted clip/dashes/energy pool would leak.
if (teardown > 0) {
  const seg = src.slice(teardown, teardown + 2000);
  const iDis = seg.indexOf('_aegisSetLvl(run, 0)'), iNull = seg.indexOf('game.endlessRun = null');
  if (iDis >= 0 && iNull >= 0 && iDis < iNull) ok('teardown discharges BEFORE nulling game.endlessRun (load-bearing order)');
  else fail('teardown nulls game.endlessRun before discharging — the ability unlocks would leak');
}

// ---- respawn must heal to the PLAYER max, not the chassis max ----
if (/player\.health = player\.maxHealth \|\| ch\.maxHealth/.test(src)) ok('respawn heals to player.maxHealth (rank 5 +2500 honoured)');
else fail('respawn heals to the chassis max — a ranked pilot respawns up to 2500 hull short, every death');
if (/player\.shield = \(player\.maxShield != null\) \? player\.maxShield : ch\.maxShield/.test(src)) ok('respawn heals to player.maxShield (rank 14 +2500 honoured)');
else fail('respawn heals to the chassis shield max — rank 14 half-fails after every death');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL AEGIS SCOPE CHECKS PASSED');
process.exit(fails ? 1 : 0);
