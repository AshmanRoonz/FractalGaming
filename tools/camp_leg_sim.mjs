#!/usr/bin/env node
/**
 * CAMPAIGN LEG LENGTHS vs THEIR SCENES, OFFLINE (2026-10-08, v52.99). Reads the REAL leg data out of
 * LSS/index-working.html (CAMPAIGN_LEG_HALF_Z, _campLegRooms, every MAP_DATA camp_ leg + its legHalfZ, CAMPAIGN_LEGS,
 * CAMP_SCENES, CAMP_SEQS, the dialogue box's cfg) and the clip lengths in LSS/campaign_media/voice/manifest.json, then
 * flies each leg straight at three speeds. No Browser pane, no GPU.
 *
 *   node tools/camp_leg_sim.mjs [LSS/index-working.html]
 *
 * Owner (v52.99): "in leg 4, campaign, i made it to the end while we were mid conversation... so this leg needs to be
 * physically longer". Per leg it prints the travel (spawn -> the arena trigger at H - 1400), its scene (when it is due,
 * roughly when it starts and ends: clips + voiceTail + gap per line + delays), when you reach the arena at 350 / 450 /
 * 550 u/s (medium cruise / light cruise / light + dashes), and its checkpoints (the real _campCkptTick, flown).
 * The scene's start is an estimate: due point, then the leg's opening beat (beatDelay.leg + its clips) must free the box.
 * Checks: Molten Core's scene ends before you can reach its arena at 550; a standard leg has no checkpoint; Molten
 * Core's checkpoints sit at -20,400 and +14,200. Exits 1 if a check fails.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || join(ROOT, 'LSS', 'index-working.html');
const html = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const man = JSON.parse(readFileSync(join(ROOT, 'LSS', 'campaign_media', 'voice', 'manifest.json'), 'utf8'));
const cut = (from, to) => {
  const a = html.indexOf(from); const b = a < 0 ? -1 : html.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + JSON.stringify(a < 0 ? from : to));
  return html.slice(a, b + to.length);
};
// the leg data: CAMPAIGN_LEG_HALF_Z .. CAMPAIGN_LEGS, run with a stub MAP_DATA (the camp_ lines only need SU + the leg map)
const legsSrc = cut('const CAMPAIGN_LEG_HALF_Z = ', 'MAP_DATA.camp_approach = CAMPAIGN_LEG_MAP;') + '\n' +
  cut('MAP_DATA.camp_grassy ', "{ locked: true, name: 'More legs unlock as you journey on' },\n];");
const scenesSrc = cut('const CAMP_SCENES = [', '];\n');
const seqsSrc = cut('const CAMP_SEQS = {', '\n};\n');
const ckSrc = cut('const CAMP_CKPT = {', '\n}\n');
const cfgSrc = cut('  const cfg = { cps: 42, holdMin:', '};\n');
const W = new Function('SU', 'MAP_DATA', 'game', 'window', 'player',
  legsSrc + '\n' + scenesSrc + '\n' + seqsSrc + '\n' + ckSrc + '\n' + cfgSrc +
  '\nreturn { CAMPAIGN_LEG_HALF_Z, CAMPAIGN_LEGS, CAMP_SCENES, CAMP_SEQS, CAMP_CKPT, cfg, _campCkptTick, ' +
  'setPlayer: (p) => { player = p; } };');
const MAP_DATA = {}, game = {};
const api = W(150, MAP_DATA, game, {}, null);
const { CAMPAIGN_LEG_HALF_Z: H0, CAMPAIGN_LEGS, CAMP_SCENES, CAMP_SEQS, cfg } = api;

const clip = (id) => (man[id] && man[id].secs) || 0;
const idOf = (x) => (typeof x === 'string' ? x : (x && x.id) || null);
function seqSecs(list) {   // clips + the box's tail and gap per voiced line, + each item's delay / an fx hold
  let s = 0;
  for (const x of list || []) {
    if (x && x.delay) s += x.delay;
    if (x && x.fx) { s += (x.hold || 0); continue; }
    const id = idOf(x); if (!id) continue;
    s += clip(id) + (cfg.voiceTail || 0.5) + (cfg.gap || 0.35);
  }
  return s;
}
const SPEEDS = [350, 450, 550];
let fails = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) fails++; };
console.log('source: ' + file);
const legs = CAMPAIGN_LEGS.filter((l) => l && l.key);
const rows = [];
legs.forEach((L, i) => {
  const m = MAP_DATA[L.key] || {};
  const H = m.legHalfZ || H0;
  const roomsOk = Array.isArray(m.rooms) && m.rooms.some((r) => r.id === 'spawn' && r.z === -H) && m.rooms.some((r) => r.id === 'boss' && r.z === H);
  const travel = 2 * H - 1400;
  const S = CAMP_SCENES.find((s) => s.leg === i) || null;
  const legBeat = (cfg.beatDelay && cfg.beatDelay.leg) || 0;
  const open = legBeat + seqSecs(CAMP_SEQS['leg' + i]);
  let due = null, scn = 0;
  if (S) { due = (S.atD != null) ? S.atD : (S.at > 0 ? S.at * travel : 0); scn = seqSecs(CAMP_SEQS[S.seq]); }
  // checkpoints: fly the real tick from the spawn to the arena trigger
  game._campLegH = H;
  const c = {}; const cks = [];
  for (let z = -H; z <= H - 1400; z += 100) {
    api.setPlayer({ position: { z, clone() { return { z: this.z }; } }, shipState: 'flying' });
    api._campCkptTick(c);
    if (c._ck && (!cks.length || cks[cks.length - 1] !== c._ck.z)) cks.push(c._ck.z);
  }
  rows.push({ i, key: L.key, name: m.name, H, travel, roomsOk, S, due, scn, open, cks });
});
for (const r of rows) {
  console.log('\nleg ' + (r.i + 1) + ' ' + r.name + ' (' + r.key + '): H ' + r.H + ', travel ' + (r.travel / 1000).toFixed(1) + ' km' + (r.roomsOk ? '' : '  (ROOMS DO NOT MATCH H)'));
  const arrive = SPEEDS.map((v) => v + ' u/s ' + (r.travel / v).toFixed(0) + ' s').join(' · ');
  console.log('  arena at: ' + arrive);
  if (r.S) {
    // due at a distance; at each speed it starts when due AND the opening beat has freed the box
    const ends = SPEEDS.map((v) => {
      const start = Math.max(r.due / v, r.open), end = start + r.scn;
      return v + ': ends ' + end.toFixed(0) + ' s, arena ' + (r.travel / v - end >= 0 ? '+' : '') + (r.travel / v - end).toFixed(0) + ' s after';
    }).join(' · ');
    console.log('  scene ' + r.S.seq + ': due at ' + (r.due / 1000).toFixed(1) + ' km, ~' + r.scn.toFixed(0) + ' s long (opening beat frees the box at ~' + r.open.toFixed(0) + ' s)');
    console.log('    ' + ends);
  }
  console.log('  checkpoints: ' + (r.cks.length ? r.cks.join(', ') : 'none'));
}
console.log('');
const mc = rows.find((r) => r.key === 'camp_volcanic');
ok(rows.every((r) => r.roomsOk), 'every leg: its rooms at -H / +H (Molten Core ' + (mc ? mc.H : '-') + ')');
// (v53.01) every leg with a scene: it is over before the fastest hull can be at the arena (the owner's complaint, per leg)
for (const r of rows.filter((x) => x.S)) {
  const v = 550, end = Math.max(r.due / v, r.open) + r.scn;
  ok(r.travel / v >= end, r.name + ': its scene ends before you can reach the arena at 550 u/s (' + (r.travel / v - end).toFixed(0) + ' s to spare)');
}
ok(rows.filter((r) => r.H === H0).every((r) => r.cks.length === 0 && r.roomsOk), 'every standard leg: its rooms at +-' + H0 + ', no checkpoint');
ok(mc && JSON.stringify(mc.cks) === JSON.stringify([-20400, 14200]), 'Molten Core: checkpoints at -20,400 and +14,200 (' + (mc ? mc.cks.join(', ') : '-') + ')');
console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks pass');
process.exit(fails ? 1 : 0);
