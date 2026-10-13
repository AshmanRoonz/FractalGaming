#!/usr/bin/env node
/**
 * CAMPAIGN DIALOGUE, OFFLINE (2026-10-08, v52.71). Runs the game's REAL CampDialogue IIFE and the REAL tip tick
 * (_campTipsTick), sliced out of LSS/index-working.html, on a fake clock with a DOM stub - no Browser pane, no GPU
 * (the owner closes the pane while playing). Re-run it after any change to CampDialogue's queue or the tips.
 *
 *   node tools/campaign_dialogue_sim.mjs [LSS/index-working.html]
 *
 * Checks, and exits 1 if any fails:
 *   A. the ship AI finishes first (v52.70): "Welcome aboard" talking until 2.6 s holds a leg line due at 2.0 s until
 *      2.6 s + cfg.aiGap
 *   B. tips (v52.70-71): the first leg's first tip is "ships" (the owner's order) once the box has been quiet idleMin s;
 *      a story line that cuts it early brings it back ONCE (a second cut does not); the next tip follows on `every`
 *   C. the core tip shows when the core fills
 *   D. (v54.23) a clip that starts LATE is never cut: the owner heard Azure / Frostfang's "Yeah..." then nothing (gs_money
 *      before gs_people, op_hear before op_train) - their takes were new to the browser, fetched + decoded as the line
 *      began, and the hold ran from the line's start. Here: no prefetch, the new takes 1.5-2.5 s to load.
 *   E. (v54.23) with the prefetch on, those clips start with their lines (and are still never cut)
 * Prints the box's timeline. The slices are found by marker strings: if one moves, the error names it.
 * Timers run in time order with microtasks flushed after each (the box chains promises), so the times are exact.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(process.argv[2] || join(ROOT, 'LSS', 'index-working.html'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = html.indexOf(from), b = a < 0 ? -1 : html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('marker not found: ' + JSON.stringify(from)); return html.slice(a, b); };
const dlgSrc = cut("(function () {\n  // (v52.23) + the prologue's two", '\n})();\n') + '\n})();\n';
const tipSrc = cut('const CAMP_TIPS = {', 'try {\n  window.__campTips') + '\nglobalThis.__T = { CAMP_TIPS, CAMP_TIP_LINES };';

// --- fake clock --------------------------------------------------------------------------------------------------
const realImmediate = setImmediate;
let clock = 0, tid = 0; const timers = [];
const g = globalThis;
g.performance = { now: () => clock };
g.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: clock + Math.max(0, +ms || 0), fn }); return id; };
g.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
g.setInterval = (fn, ms) => { const id = ++tid; const rep = () => { timers.push({ id, at: clock + ms, fn: () => { fn(); rep(); } }); }; rep(); return id; };
g.clearInterval = g.clearTimeout;
g.requestAnimationFrame = (fn) => g.setTimeout(() => fn(clock), 16);
g.cancelAnimationFrame = g.clearTimeout;
const flush = () => new Promise((r) => realImmediate(r));
async function advance(sec) {
  const end = clock + sec * 1000;
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0]; if (!t || t.at > end) break;
    timers.shift(); clock = t.at; t.fn(); await flush();
  }
  clock = end;
}

// --- just enough of the page --------------------------------------------------------------------------------------
const kids = { '.cd-name': { textContent: '', innerHTML: '' }, '.cd-text': { textContent: '', innerHTML: '' } };
const cls = new Set();
const box = { dataset: {}, style: {}, querySelector: (s) => kids[s] || null, animate() {},
              classList: { add: (c) => cls.add(c), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
                           toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)) } };
g.window = g;
g.document = { getElementById: (id) => (id === 'camp-dialogue' ? box : null), hidden: false, documentElement: { classList: { contains: () => false } } };
g.getComputedStyle = () => ({ opacity: '0' });
g._DIGI_GLYPHS = ['#'];
g.CAMP_LINES = { leg0_a: { who: 'xorzo', text: 'Leg line one, a short one.' }, leg0_b: { who: 'pilot', text: 'And a reply.' },
                 boss0_a: { who: 'summoners', text: 'The boss arrives and says so.' } };
g.CAMP_SEQS = { leg0: ['leg0_a', 'leg0_b'] };
g._welcomeAboardDeferred = false; g._loadingAudioHold = false;
let aiUntil = 0;   // the ship AI "speaks" until this many seconds (window.announcerBusy, the MP3 bridge's)
g.announcerBusy = () => Math.max(0, aiUntil - clock / 1000);
g.input = { campTips: true, gpConnected: false, touchActive: false };
g.player = { coreReady: false, coreActive: false };
g.game = { _campOpenArrive: false, campaign: null };
g.renderer = { xr: { isPresenting: false } };
g._howtoBindLabel = (s, a) => ({ shipPrev: '[', shipNext: ']', core: 'G' })[a] || '(unbound)';

(0, eval)(dlgSrc);
(0, eval)(tipSrc);
const D = g.CampDialogue;
if (!D || !D.tip || typeof g._campTipsTick !== 'function') throw new Error('the slices did not define CampDialogue / _campTipsTick');

// --- the run -------------------------------------------------------------------------------------------------------
const c = { sceneIndex: 0 }; g.game.campaign = c;
const log = [], fails = []; let last = null;
const t = () => clock / 1000;
const stamp = (s) => log.push(t().toFixed(2).padStart(7) + '  ' + s);
const expect = (ok, what) => { stamp((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const shows = () => { const st = (g.CampDialogue || D).state(); return st.cur ? kids['.cd-name'].textContent + ': ' + String(st.cur) : null; };   // (v54.23) whichever box is live (D / E make a second one)
const tipUp = () => !!(D.state().cur && kids['.cd-name'].textContent.includes('TIP'));
let firstLineAt = null;
g.setInterval(() => {   // the game: a 50 ms frame running the tips tick, and a watcher on the box
  g._campTipsTick(c, 0.05);
  const now = shows();
  if (now !== last) { stamp(now ? 'SHOW ' + now.slice(0, 80) : '(box clear)'); last = now; if (now && firstLineAt == null) firstLineAt = t(); }
}, 50);
const waitFor = async (f, sec) => { for (let i = 0; i < sec * 20 && !f(); i++) await advance(0.05); return f(); };

aiUntil = 2.6;
g.setTimeout(() => { stamp('beat leg0 (its lines due at 2.0 s; the ship AI talks until 2.6 s)'); D.beat('leg', 0); }, 500);
await advance(4);
expect(firstLineAt != null && firstLineAt >= 2.6 + D.cfg.aiGap - 0.06, 'A. the leg line waited for the ship AI (+ aiGap): started ' + firstLineAt);
expect(await waitFor(tipUp, 30) && /switch ships/.test(shows()), 'B. the first tip is "ships": ' + shows());
await advance(2.5); stamp('interject boss0_a (cuts the tip 2.5 s in)'); D.interject(['boss0_a']);
expect(await waitFor(tipUp, 30) && /switch ships/.test(shows()), 'B. the cut tip came back');
await advance(1); stamp('interject boss0_a (cuts it again 1 s in)'); D.interject(['boss0_a']);
await waitFor(tipUp, 60);
expect(!/switch ships/.test(shows() || ''), 'B. no second retry; the next tip: ' + shows());
await advance(12);
stamp('core ready'); g.player.coreReady = true;
expect(await waitFor(() => tipUp() && /core/.test(shows()), 30), 'C. the core tip: ' + shows());
await advance(5);

// --- D / E: voiced lines with slow new takes (v54.23) ----------------------------------------------------------------
// A fresh CampDialogue (its manifest cache was filled empty above), a stub CampMedia: clip lengths are the real files'
// (decoded 2026-10-13), a "cold" take loads in `slow` s and a cached one in 0.02 s; one voice at a time, like the game's -
// a clip stopped before its end is a CUT.
g.input.campTips = false;
Object.assign(g.CAMP_LINES, {
  gs_sim: { who: 'summoners', text: "Of course you would accept. My contest is going to feel very real, Pilot, but I assure you, it's just a simulation. Are you ready?" },
  gs_money: { who: 'pilot', text: 'Yeah... just have my money ready.' },
  gs_people: { who: 'summoners', text: "I'll have my people get you in the simulation right away." },
  op_remember: { who: 'summoners', text: 'Remember, pilot... nothing here is real...' },
  op_hear: { who: 'pilot', text: 'Yeah, okay there, buddy.' },
  op_train: { who: 'xorzo', text: '~A-access den-denied.~ This is your training ground. You can do whatever you want here. Go ahead... ~K-k-kill~ something.' },
});
const CLIP = { gs_sim: 9.2, 'gs_money': 2.32, 'gs_money.azure': 2.16, gs_people: 3.04, op_remember: 3.0, op_hear: 1.92, 'op_hear.azure': 2.0, op_train: 7.5 };
const M = { cur: null, cuts: [], starts: {}, loads: new Map(), cold: new Set(), slow: 1.5 };
const idOf = (url) => String(url).replace(/^voice\//, '').replace(/\.mp3.*$/, '');
const load = (url) => {
  let p = M.loads.get(url);
  if (!p) { const id = idOf(url), d = M.cold.has(id) ? M.slow : 0.02; p = new Promise((res) => g.setTimeout(() => res(CLIP[id] || 0), d * 1000)); M.loads.set(url, p); }
  return p;
};
const stopClip = (why) => {
  const c = M.cur; if (!c) return; M.cur = null;
  const played = t() - c.at;
  if (played < c.dur - 0.02) { M.cuts.push(c.id + ' at ' + played.toFixed(2) + ' of ' + c.dur + ' s (' + why + ')'); stamp('CUT  ' + c.id + ' at ' + played.toFixed(2) + ' s of ' + c.dur + ' (' + why + ')'); }
};
g.CampMedia = {
  manifest: () => Promise.resolve({ lines: new Set(Object.keys(CLIP)), rev: {} }),
  voiceUrl: (id) => 'voice/' + id + '.mp3', base: () => '',
  preloadVoice: (url) => { load(url); },
  playVoiceUrl: async (url) => { const dur = await load(url); stopClip('the next clip'); const id = idOf(url); M.cur = { id, at: t(), dur }; M.starts[id] = t(); stamp('CLIP ' + id + ' (' + dur + ' s)'); return dur; },
  stopVoice: () => stopClip('clear()'),
};
g._LSS_SEATS = { azure: { voice: 'azure' } }; g._lssPilotId = () => 'azure';
(0, eval)(dlgSrc);
const D2 = g.CampDialogue;
const lineStart = {};
D2.onLine((ln) => { if (ln && ln.id) lineStart[ln.id] = t(); });
const scene = async (name, list, coldIds, slow, prefetch) => {
  M.cur = null; M.cuts = []; M.loads.clear(); M.cold = new Set(coldIds); M.slow = slow;
  for (const k of Object.keys(lineStart)) delete lineStart[k];
  D2.cfg.prefetch = prefetch;
  stamp('--- ' + name + ' (new takes load in ' + slow + ' s, prefetch ' + prefetch + ')');
  D2.clear(); const done = D2.sayLines(list);
  let idle = false; done.then(() => { idle = true; });
  for (let i = 0; i < 1200 && !idle; i++) await advance(0.05);
  await advance(0.6); stopClip('the scene ends (clear)');   // the gameshow clears 0.6 s after its last line
  return M.cuts.slice();
};
// the gameshow's tail (sayLines(CAMP_SEQS.gameshow)), and the caverns' arrive(): op_remember after 1.6 s, op_hear, op_train
let cuts = await scene('gameshow tail, no prefetch', ['gs_sim', 'gs_money', 'gs_people'], ['gs_money.azure'], 1.5, 0);
expect(!cuts.length, 'D. gameshow: a late gs_money.azure is not cut ' + (cuts.join('; ') || ''));
cuts = await scene('caverns arrive, no prefetch', [{ id: 'op_remember', delay: 1.6 }, 'op_hear', 'op_train'], ['op_hear.azure'], 2.5, 0);
expect(!cuts.length, 'D. caverns: a late op_hear.azure is not cut ' + (cuts.join('; ') || ''));
cuts = await scene('gameshow tail, prefetch', ['gs_sim', 'gs_money', 'gs_people'], ['gs_money.azure'], 1.5, 3);
const lagG = (M.starts['gs_money.azure'] || 99) - (lineStart.gs_money || 0);
expect(!cuts.length && lagG < 0.1, 'E. gameshow: gs_money.azure starts with its line (' + lagG.toFixed(2) + ' s) ' + (cuts.join('; ') || ''));
cuts = await scene('caverns arrive, prefetch', [{ id: 'op_remember', delay: 1.6 }, 'op_hear', 'op_train'], ['op_hear.azure'], 2.5, 3);
const lagC = (M.starts['op_hear.azure'] || 99) - (lineStart.op_hear || 0);
expect(!cuts.length && lagC < 0.1, 'E. caverns: op_hear.azure starts with its line (' + lagC.toFixed(2) + ' s) ' + (cuts.join('; ') || ''));

console.log(log.join('\n'));
console.log('tips state ' + JSON.stringify({ shown: c._tips.shown, left: c._tips.left, order: c._tips.order }));
console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
process.exitCode = fails.length ? 1 : 0;
