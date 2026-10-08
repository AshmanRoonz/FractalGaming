#!/usr/bin/env node
/**
 * SHIP MEMORY, OFFLINE (2026-10-08, v52.72). Runs the game's REAL swap code - _campSwapTo / cycleHubShip, the
 * _shipMem* functions, _syphonApplyTiers / _syphonFastGun, activateCore (its 'AI Nanobots' tier ladder), _aegisApply,
 * commitLoadout's own player-reset block and respawnPlayer's own heal lines - sliced out of LSS/index-working.html,
 * against the real LOADOUTS / CHASSIS / PILOT_PERKS tables. No Browser pane, no GPU.
 *
 *   node tools/ship_memory_sim.mjs [LSS/index-working.html]
 *
 * commitLoadout itself is NOT run whole (it builds meshes, HUD, the world): a small wrapper runs its memory line, its
 * reset block (sliced between two markers) and its live-swap / death re-entry returns, in the real order. Re-run
 * after touching any of those. Exits 1 if a check fails; the slices are found by marker strings, so a moved marker
 * names itself in the error.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(process.argv[2] || join(ROOT, 'LSS', 'index-working.html'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to, keepTo) => {
  const a = html.indexOf(from); const b = a < 0 ? -1 : html.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + JSON.stringify(a < 0 ? from : to));
  return html.slice(a, keepTo ? b + to.length : b);
};
const src = {
  chassis: cut('const CHASSIS = {', '\n};\n', true),
  perks: cut('const PILOT_PERKS = {', "const PILOT_PERK_DEFAULT = 'shield';", true),
  bag: cut('function _perkEffectiveBag() {', '\n}\n', true),
  loadouts: cut('const LOADOUTS = {', '\n};\n', true),
  aegis: cut('function _aegisApply() {', '\n}\n', true),
  mem: cut('function _shipMemSave() {', '// (v32.97) LIVE in-flight ship cycle for campaign'),
  swaps: cut('function _campSwapTo(nextKey) {', '// (v36.20) Run `fn` after one PAINTED frame'),
  core: cut('function activateCore() {', '// ---- SHIELD VISUAL MESHES ----'),
  commitMem: cut('  try { if (game._campReentry) _shipMemSave();', '\n', true),
  commitReset: cut('  player.chassis = ch;\n  player.health = ch.maxHealth;', '  player.phaseInvuln = false;'),
  // respawnPlayer from its heal to the Blaster mode reset (v52.73) and the switch-timer line after it
  respawnHeal: cut('  const ch = player.chassis;\n  // (v52.72) Owner: "if you die', '  player.phaseInvuln = false;'),
  // (v52.73) updateAbilities' Blaster Range Mode tick, whole
  rangeTick: cut('  // Blaster Range Mode: 1s transition delay\n', '  // (v38.05) A PRIMED ABILITY CRACKLES'),
};

// ---- the world the slices expect ------------------------------------------------------------------------------
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } clone() { return new V3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  applyQuaternion() { return this; } add() { return this; } multiplyScalar() { return this; } distanceTo() { return 1e9; } }
class Eul { clone() { return new Eul(); } copy() { return this; } }
const noop = () => {};
const g = globalThis;
Object.assign(g, {
  THREE: { Vector3: V3, Euler: Eul }, window: g, localStorage: { getItem: () => null, setItem: noop },
  camera: { quaternion: {} }, net: { active: false, myPeerId: 'me', effectIdCounter: 0 }, Overlays: { banner: noop },
  LSS: { MODE: 'freeflight', SPAWN_PROTECTION: 3, DOOMED_TIMER: 10, DOOMED_HEALTH_PCT: 0.15, CLASS_COLORS: {} },
  game: { time: 100, state: 'playing', campaign: null, entities: [], monsters: [], projectiles: [], _liveSwap: false, _campReentry: false },
  input: { kbBindings: { ability0: 'q', ability1: 'e', ability2: 'f' }, keys: {} },
  _perkAllBag: null, _aegisRank: 15,
  playSound: noop, triggerCoreOverlay: noop, _innerSparkRipple: noop, _isrCoreOpts: () => ({}), spawnDynamicLight: noop,
  _clearAllOutlineOptics: noop, _blasterChargeGlowOff: noop, _quickEquipRefresh: noop,
  _aegisSoloOnly: () => true, _aegisModeAllowed: () => true, _aegisShipUpgrades: noop, _aegisUpFor: () => false,
  _aegisShipState: () => ({ xp: 0 }), AEGIS: { rankFromXp: () => ({ rank: g._aegisRank }) },
});
g.player = { position: new V3(5, 6, 7), velocity: new V3(), euler: new Eul(), mesh: { position: new V3() }, perkId: 'shield',
             shipState: 'flying', abilityCooldowns: [0, 0, 0], maxTrapCharges: 2, thermalShieldMaxHP: 0 };
for (const k of ['chassis', 'perks', 'bag', 'loadouts', 'aegis', 'mem', 'swaps', 'core']) (0, eval)(src[k].replace(/^const (\w+) = /gm, 'globalThis.$1 = '));
// commitLoadout, reduced to the parts that own the player's state, in the real order (see the header)
g.commitLoadout = (0, eval)('(function commitLoadout(key) {\n' + src.commitMem +
  '  const loadout = LOADOUTS[key]; const ch = CHASSIS[loadout.chassis]; const midMatch = false;\n' +
  '  player.loadout = loadout; player.loadoutKey = key;\n' + src.commitReset +
  '  if (game._liveSwap) return;\n' +
  '  if (game._campReentry) { game._campReentry = false; try { _shipMemRestore(key); } catch (_) {} respawnPlayer(); return; }\n' +
  '  if (LSS.MODE === "freeflight") _aegisApply();\n})');
g.respawnPlayer = (0, eval)('(function respawnPlayer() {\n' + src.respawnHeal + "  player.shipState = 'spawning'; player.doomed = false; player.coreActive = false;\n})");
g.blasterTick = (0, eval)('(function blasterTick(dt) {\n' + src.rangeTick + '\n})');

// ---- checks ---------------------------------------------------------------------------------------------------
const P = g.player, G = g.game, M = () => g.__shipMem.state();
let fails = 0;
const ok = (cond, what, got) => { console.log((cond ? '  ok   ' : '  FAIL ') + what + (got !== undefined ? '   ' + JSON.stringify(got) : '')); if (!cond) fails++; };
const quiet = () => { G.time += 1; P.lastDamageTime = G.time - 6; };   // 6 s since the last hit, past the 0.6 s anti-spam
const fire = () => { P.coreActive = false; P.coreMeter = 100; g.activateCore(); };
const key = () => P.loadoutKey;
const order = Object.keys(g.LOADOUTS);

console.log('EXHIBITION (Aegis rank 15: +2500 hull, +2500 shield):');
g.LSS.MODE = 'freeflight';
g.commitLoadout('SYPHON');
const sMax = [P.maxHealth, P.maxShield];
ok(sMax[0] === 12500 && sMax[1] === 6000, 'Syphon launches at chassis + Aegis', sMax);
fire(); ok(P.syphonTier === 1 && P.maxClip === 50, 'core 1 -> tier 1 (50-round clip)', [P.syphonTier, P.maxClip]);
fire(); ok(P.syphonTier === 2 && P.maxShield === 6500 && P.shield === 6500, 'core 2 -> tier 2: +500 ON TOP of Aegis (was chassis + 500 = 4000)', [P.maxShield, P.shield]);
fire(); ok(P.syphonTier === 3 && Math.abs(P.weapon.fireRate - 0.0675) < 1e-9 && g.LOADOUTS.SYPHON.weapon.fireRate === 0.09, 'core 3 -> tier 3: own gun 0.0675, the bots\' table stays 0.09', [P.weapon.fireRate, g.LOADOUTS.SYPHON.weapon.fireRate]);
P.coreActive = false; P.health = 7000; P.shield = 0; P.coreMeter = 40;
P.position.set(5, 6, 7);   // (the launch commit put the ship at the origin; respawnPlayer places it in the game)
P.lastDamageTime = G.time - 2; const before = key(); g.cycleHubShip(1);
ok(key() === before, 'hit 2 s ago -> the swap is refused (the 5 s rule)', key());
quiet(); g.cycleHubShip(1);
ok(key() === order[0] && P.health === P.maxHealth && P.shield === P.maxShield && P.coreMeter === 0, 'swap -> ' + order[0] + ' boards fresh (never flown)', [P.health, P.shield, P.coreMeter]);
ok(JSON.stringify(M().ships.SYPHON) === JSON.stringify({ hull: 7000, shield: 0, over: 0, core: 40, doomed: false, tier: 3 }), 'Syphon is remembered as he was left', M().ships.SYPHON);
ok(P.position.x === 5 && P.position.z === 7, 'the swap stays where it was', [P.position.x, P.position.z]);
P.health -= 3000; P.shield = 100; P.coreMeter = 70; const vHull = P.health;
quiet(); g.cycleHubShip(-1);
ok(key() === 'SYPHON' && P.health === 7000 && P.shield === 0 && P.coreMeter === 40, 'swap back -> Syphon\'s hull / shield / core as left', [P.health, P.shield, P.coreMeter]);
ok(P.syphonTier === 3 && P.maxShield === 6500 && P.maxClip === 50 && Math.abs(P.weapon.fireRate - 0.0675) < 1e-9, '...and his tier 3 (shield cap 6500, clip 50, fast gun)', [P.syphonTier, P.maxShield, P.maxClip, P.weapon.fireRate]);
ok(M().ships[order[0]].hull === vHull && M().ships[order[0]].core === 70, order[0] + ' remembered too', M().ships[order[0]]);
for (let i = 0; i < 4; i++) { quiet(); g.cycleHubShip(1); quiet(); g.cycleHubShip(-1); }
ok(P.maxShield === 6500 && Math.abs(P.weapon.fireRate - 0.0675) < 1e-9 && g.LOADOUTS.SYPHON.weapon.fireRate === 0.09, '4 more round trips: nothing stacks or compounds', [P.maxShield, P.weapon.fireRate, g.LOADOUTS.SYPHON.weapon.fireRate]);
// a doomed ship stays doomed
quiet(); g.cycleHubShip(1); P.health = P.maxHealth * 0.1; P.doomed = true; P.shipState = 'doomed';
quiet(); g.cycleHubShip(-1); quiet(); g.cycleHubShip(1);
ok(P.doomed === true && P.shipState === 'doomed' && Math.round(P.health) === Math.round(P.maxHealth * 0.1), 'a doomed ship you leave is still doomed when you come back', [P.doomed, P.shipState]);
// Nano Repair's over-heal is part of the hull
P.perkId = 'nano'; P.doomed = false; P.shipState = 'flying'; P.health = P.maxHealth * 1.6; const over = P.health;
quiet(); g.cycleHubShip(-1); quiet(); g.cycleHubShip(1);
ok(P.health === over, 'Nano Repair over-heal (1.6x) comes back with the ship', [P.health, P.maxHealth]);
P.perkId = 'shield';
// death: every hull and shield full, cores and Syphon's tier kept
P.health = 0; P.shipState = 'dead'; g.respawnPlayer();
const st = M();
ok(Object.values(st.ships).every((m) => m.hull === 'full' && m.shield === 'full' && !m.doomed), 'respawn -> every remembered ship full hull + shield', st.ships);
ok(st.ships.SYPHON.tier === 3 && st.ships.SYPHON.core === 40, '...Syphon keeps tier 3 and his 40% core', st.ships.SYPHON);
P.shipState = 'flying'; quiet(); g.cycleHubShip(-1);
ok(key() === 'SYPHON' && P.health === P.maxHealth && P.shield === 6500 && P.syphonTier === 3, 'board Syphon after the respawn: full, at his tier-3 shield cap', [P.health, P.shield, P.maxShield]);

console.log('CAMPAIGN (no Aegis):');
g.LSS.MODE = 'campaign'; G.campaign = { unlockedLoadouts: order.slice() };
g.commitLoadout('PYRO');
ok(Object.keys(M().ships).length === 0, 'a new launch forgets Exhibition\'s ships', M().ships);
P.health = 4000; P.shield = 500; P.coreMeter = 55; quiet();
ok(g._campSwapTo('SYPHON') === true && P.health === P.maxHealth && P.syphonTier === 0, 'quick-equip Syphon: fresh hull, tier 0 (a new set)', [P.health, P.syphonTier]);
fire(); fire(); P.coreActive = false; P.health = 3000; P.coreMeter = 10;
ok(P.syphonTier === 2 && P.maxShield === 4000, 'tier 2 in the campaign = chassis 3500 + 500', P.maxShield);
quiet(); g._campSwapTo('PYRO');
ok(P.health === 4000 && P.shield === 500 && P.coreMeter === 55, 'back to Pyro: 4000 / 500 / 55% (it used to carry Syphon\'s damage fraction)', [P.health, P.shield, P.coreMeter]);
// a campaign death re-picks through commitLoadout (_campReentry)
P.health = 0; P.shipState = 'dead'; G._campReentry = true;
g.commitLoadout('SYPHON');
ok(key() === 'SYPHON' && P.health === P.maxHealth && P.syphonTier === 2 && P.maxShield === 4000 && P.shield === 4000 && P.coreMeter === 10,
   'death -> re-pick Syphon: full, keeps tier 2 + his 10% core', [P.health, P.shield, P.syphonTier, P.coreMeter]);
ok(M().ships.PYRO.hull === 'full' && M().ships.PYRO.core === 55, '...and the Pyro that died is full again, its core kept', M().ships.PYRO);
g.commitLoadout('VORTEX');
ok(Object.keys(M().ships).length === 0, 'a new launch starts a fresh set', M().ships);

console.log('BLASTER RANGE MODE (v52.73):');
g.LSS.MODE = 'freeflight';
const T = g.LOADOUTS.BLASTER.weapon;
const tableClose = () => T.fireRate === 0.05 && T.range === 2600 && T.damage === 85 && T.spread === 0.04;
const toggle = () => { P.blasterPendingMode = P.blasterMode === 'close' ? 'long' : 'close'; P.blasterSwitchTimer = 1.0; g.blasterTick(1.05); };
g.commitLoadout('BLASTER');
ok(P.weapon === T && P.blasterMode === 'close' && P.maxClip === 150, 'launch: close mode flies the table gun, 150 clip', [P.blasterMode, P.maxClip]);
toggle();
ok(P.blasterMode === 'long' && P.weapon !== T && P.weapon.fireRate === 0.08 && P.weapon.range === 4600 && P.weapon.damage === 100 && P.weapon.spread === 0.005 && P.maxClip === 100,
   'long mode: the pilot\'s own long gun, 100 clip', [P.weapon.fireRate, P.weapon.range, P.weapon.damage, P.weapon.spread, P.maxClip]);
ok(tableClose(), 'the table every Blaster bot + peer reads stays close (0.05 / 2600 / 85 / 0.04)', [T.fireRate, T.range, T.damage, T.spread]);
toggle();
ok(P.blasterMode === 'close' && P.weapon === T && P.maxClip === 150, 'back to close: the table gun again', [P.blasterMode, P.maxClip]);
toggle(); quiet(); g.cycleHubShip(1); quiet(); g.cycleHubShip(-1);
ok(key() === 'BLASTER' && P.blasterMode === 'close' && P.weapon === T && P.maxClip === 150 && tableClose(),
   'swapped away + back in long mode: boards close with the close gun (was close + the long numbers)', [P.blasterMode, P.weapon.fireRate, P.maxClip]);
toggle(); P.clipAmmo = 37; P.health = 0; P.shipState = 'dead'; g.respawnPlayer();
ok(P.blasterMode === 'close' && P.weapon === T && P.maxClip === 150 && P.clipAmmo === 150 && tableClose(),
   'died in long mode: respawns close with the close gun and a full 150 clip (was 100)', [P.blasterMode, P.weapon.fireRate, P.maxClip, P.clipAmmo]);
g.commitLoadout('SYPHON'); fire(); fire(); fire(); P.coreActive = false; P.health = 0; P.shipState = 'dead'; g.respawnPlayer();
ok(P.syphonTier === 3 && Math.abs(P.weapon.fireRate - 0.0675) < 1e-9, 'a respawned Syphon keeps his tier-3 gun (the reset is Blaster-only)', [P.syphonTier, P.weapon.fireRate]);

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exitCode = fails ? 1 : 0;
