#!/usr/bin/env node
/**
 * THE CAMPAIGN RING AFTER THE SUMMONERS LEAVE, OFFLINE (2026-10-08, v52.98). Runs the game's REAL _campArenaTick (and
 * CAMP_ARENA, _campRingMayOpen, _campRingOpen) sliced out of LSS/index-working.html, on a fake leg: the 'boss' phase,
 * the ring 60 % formed at your arrival, the Summoners on station, the leviathan alive. No Browser pane, no GPU.
 *
 *   node tools/camp_ring_sim.mjs [LSS/index-working.html]
 *
 * Owner (v52.98): "let's have it so when the summoners go through the portal, it stays open you can just go through
 * without having to clear all the hoard ships". Checks each CAMP_ARENA.openOn rule: 'leave' (the default - steady and
 * 'cleared' on the frame they go through, one banner, sum_escape + xz_follow), 'boss' (waits for the leviathan only)
 * and 'clear' (the v49.48 rule). "The advance can take you" = phase 'cleared' + a ring that is not unstable, which is
 * what CampaignMode's 'cleared' case asks before it warps you (unchanged code). An older source (a backup) runs the
 * 'leave' case on its own rule and fails it. Exits 1 if a check fails.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(ROOT, 'LSS', 'index-working.html');
const html = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to, optional, dropTo) => {
  const a = html.indexOf(from); const b = a < 0 ? -1 : html.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { if (optional) return ''; throw new Error('marker not found: ' + JSON.stringify(a < 0 ? from : to)); }
  return html.slice(a, dropTo ? b : b + to.length);
};
const helpers = cut('function _campRingMayOpen(c) {', '\n}\n', true) + cut('function _campRingOpen(c, P) {', '\n}\n', true);
const isNew = !!helpers;
const src = [
  // CAMP_ARENA, its window knob, the scratch vectors and _campPortalPos
  cut('const CAMP_ARENA = {', 'function _campSpawnSummoner(c, at) {', false, true),
  helpers,
  cut('function _campArenaTick(c, dt, auth) {', '\n}\n'),
].join('\n');

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } clone() { return new V3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } length() { return Math.hypot(this.x, this.y, this.z); }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
let log;
const game = { bossPortal: null, entities: [] };
const env = {
  THREE: { Vector3: V3 }, game, CAMPAIGN_LEG_HALF_Z: 18000, PORTAL_GATE_DIAMETER: 600,
  window: {
    Overlays: { banner: (t, s) => log.push(['banner', t, s]) },
    CampDialogue: { interject: (ids) => log.push(['lines', ids.join(' + ')]) },
  },
  _spawnBossPortal: (pos) => { game.bossPortal = { position: pos, form: 0, stable: undefined, mesh: {}, update() {} }; },
  _campSpawnSummoner: () => {}, spawnLightningBolt: () => {}, _campChaseTick: () => {}, _campBroadcastState: () => {},
  _campNemesisEscape: () => { const c = game.campaign; if (c && c._nemesisBot) { c._nemesisBot.alive = false; c._nemesisBot = null; } },
};
env.Overlays = env.window.Overlays;
const names = Object.keys(env);
const api = new Function(...names, src + '\nreturn { CAMP_ARENA, _campArenaTick };')(...names.map((k) => env[k]));

function leg(rule) {
  log = []; game.bossPortal = null;
  if (rule) api.CAMP_ARENA.openOn = rule;
  const nb = { alive: true, position: new V3(0, 170, 18000 - 230), velocity: new V3(), _formationActive: true };
  const c = { phase: 'boss', bossActive: true, _arrived: true, _formAtArrive: 0.6, _summonerSpawned: true, _nemesisBot: nb,
              _boss: { alive: true }, nemesis: {} };
  game.campaign = c;
  return c;
}
const tick = (c, secs) => { for (let t = 0; t < secs; t += 0.05) api._campArenaTick(c, 0.05, true); };
const runToLeave = (c) => { for (let t = 0; t < 60 && !c._summonerLeft; t += 0.05) api._campArenaTick(c, 0.05, true); return c._summonerLeft; };
const canAdvance = (c) => c.phase === 'cleared' && !!game.bossPortal && game.bossPortal.stable !== false;

let fails = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) fails++; };
console.log('source: ' + file + (isNew ? '' : '  (no openOn: the old rule only)'));

console.log("openOn 'leave' (the default): their leaving opens it");
{
  const c = leg(isNew ? 'leave' : null);
  ok(runToLeave(c), 'the Summoners go through (' + log.length + ' event(s) so far)');
  ok(game.bossPortal.stable === true, 'the ring is steady on that frame');
  ok(c.phase === 'cleared' && c._boss.alive, "phase 'cleared' with the leviathan still alive (hoard stragglers never counted)");
  ok(canAdvance(c), 'the advance can take you through it');
  const b = log.filter((e) => e[0] === 'banner'), l = log.filter((e) => e[0] === 'lines');
  ok(b.length === 1 && /fly through after them/.test(b[0][2]), 'ONE banner: ' + JSON.stringify(b.map((e) => e[1] + ' / ' + e[2])));
  ok(l.length === 1 && l[0][1] === 'sum_escape + xz_follow', 'one beat of lines: ' + JSON.stringify(l.map((e) => e[1])));
  tick(c, 5);
  ok(log.length === b.length + l.length, 'nothing repeats over the next 5 s');
}

if (isNew) {
  console.log("openOn 'boss': waits for the leviathan, never for the hoard");
  const c = leg('boss');
  runToLeave(c);
  ok(game.bossPortal.stable === false && c.phase === 'boss', 'they are through, the leviathan lives: still unsteady');
  ok(log.some((e) => e[0] === 'lines' && e[1] === 'sum_escape'), 'their taunt alone');
  c._boss.alive = false; tick(c, 0.05);
  ok(canAdvance(c), 'the leviathan down: steady + cleared');
  ok(log.some((e) => e[0] === 'banner' && e[1] === 'PORTAL OPEN') && log.some((e) => e[0] === 'lines' && e[1] === 'xz_follow'), 'PORTAL OPEN + xz_follow then');

  console.log("openOn 'clear': the v49.48 rule");
  const d = leg('clear');
  runToLeave(d); d._boss.alive = false; tick(d, 1);
  ok(game.bossPortal.stable === false, 'leviathan down, a straggler alive (phase still boss): unsteady, as before');
  d.phase = 'cleared'; tick(d, 0.05);
  ok(game.bossPortal.stable === true, 'the clear steadies it');
  api.CAMP_ARENA.openOn = 'leave';
}

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks pass');
process.exit(fails ? 1 : 0);
