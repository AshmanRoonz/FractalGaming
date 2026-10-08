#!/usr/bin/env node
/**
 * CAMPAIGN VOICE BAKER (2026-10-08) - the campaign's spoken lines (CAMP_LINES in LSS/index-working.html) into
 * LSS/campaign_media/voice/<id>.mp3 with ElevenLabs, and their ids into campaign_media/media.json "lines": the game
 * fetches only the ids listed there (CampMedia / CampDialogue, v49.47), and a voiced line holds its box for the clip.
 * The ship AI is a separate set (LSS/audio/, audio/bake.mjs).
 *
 * THE CAST (the owner, 2026-10-07: "i just added joe for jimmy, grainger for pilot, victor for the summoners, quentin
 * for the narrator", and Xorzo is their own designed voice "Cybertronic"). LSS/voice_casting.html has the comparisons
 * and the auditions. After hearing them: "they all sound right, but quentin sounded quieter than the rest" - measured,
 * Quentin comes out of ElevenLabs at -30..-32 LUFS against ~-17..-21 for the rest, hence THE LEVELLING below.
 *
 * THE PIPELINE. ElevenLabs -> raw clip (assets_base/campaign_voice_raw/<id>.mp3 + raw.json, the hash each was made
 * from; git-ignored, never deployed, kept so a re-level costs no credits) -> tools/campaign_voice_level.py inside
 * Blender (BS.1770 loudness to LEVEL.target, peak-safe; Blender because it bundles numpy + an MP3 codec and this
 * machine has no ffmpeg) -> campaign_media/voice/<id>.mp3 + voice/manifest.json -> media.json "lines".
 *
 * Usage (from the repo root):
 *   node tools/campaign_voice.mjs --dry [--list]       the plan, no network: per speaker, characters = credits, states
 *   node tools/campaign_voice.mjs --plan out.json      the lines to make, as JSON. The CONNECTOR route: generate each
 *                                                      (eleven_v4, one take), download it to the raw folder as <id>.mp3,
 *                                                      then --ingest the same plan
 *   node tools/campaign_voice.mjs --ingest out.json    register a plan's downloaded raw clips (only lines unchanged since
 *                                                      the plan), level them into voice/, record, rewrite media.json
 *   ELEVENLABS_API_KEY=... node tools/campaign_voice.mjs   the API route: make every missing / stale line, level, record
 *   node tools/campaign_voice.mjs --level              level every made-but-unlevelled clip (e.g. after changing LEVEL;
 *                                                      --force re-levels them all) - no credits
 *   node tools/campaign_voice.mjs --adopt id,id        record clips put in voice/ by hand as made from the CURRENT text
 *   selectors (any mode): --only id,id   --who xorzo,pilot   --seq gameshow,pro_e   --force   --model eleven_v4
 *
 * STATES. missing = never made. stale = made from other text / voice / model (the script changed since). raw = made,
 * waiting to be levelled (or levelled to another LEVEL). baked = up to date. own = a clip in voice/ the baker never made
 * (no manifest entry): the owner's own recording - never overwritten unless --only names it with --force.
 *
 * Keys: the API key is read from the environment and never printed or written anywhere. Set it in your own shell;
 * never paste it into chat or a tracked file.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'LSS', 'index-working.html');
const MEDIA = join(ROOT, 'LSS', 'campaign_media');
const VOICE_DIR = join(MEDIA, 'voice');
const MEDIA_JSON = join(MEDIA, 'media.json');
const MANIFEST = join(VOICE_DIR, 'manifest.json');
const RAW_DIR = join(ROOT, 'assets_base', 'campaign_voice_raw');
const RAW_JSON = join(RAW_DIR, 'raw.json');
const LEVELER = join(ROOT, 'tools', 'campaign_voice_level.py');

// voice ids from creative_list_voices (the owner's ElevenLabs workspace), 2026-10-07
// (2026-10-08) the narrator is Gerald now (the owner: "i want to do a new voice for the narrator, i added gerald") - the
// raspy older British "Gerald - Exciting Older Character", the one Gerald listed twice (the library entry and the
// workspace's copy). Was Quentin 'Aa6nEBJJMKJwJkCx8VU2'. The id is in every narrator line's hash, so those 18 go stale.
const CAST = {
  narrator:  { name: 'Gerald',      id: 'fGIZlgPQ75MMlvQ6WxgY' },
  xorzo:     { name: 'Cybertronic', id: 'ZwO5tc54OHmMnLcq9Vep' },
  summoners: { name: 'Victor',      id: 'ttNi9wVM8M97tsxE7PFZ' },
  pilot:     { name: 'Grainger',    id: 'e6UxWrNGwfbzUCaklNVm' },
  jimmy:     { name: 'Joe',         id: 'I1ApPIaF2fI21XlrwfaW' },
};
// eleven_v4: the auditions' model. Same price as eleven_multilingual_v2 (1 credit per character, checked with
// estimate_only on the same line), and it performs [audio tags]. FORMAT asks the API for what the levelled files are.
const MODEL = 'eleven_v4';
const FORMAT = 'mp3_44100_128';
// THE LEVELLING (campaign_voice_level.py has the measurements behind these): -17 LUFS sits ~2 dB under the ship AI
// (median -14.9 LUFS, the same sfxBus at ~0.9) and keeps the dynamic voices to <= 6 dB of peak limiting.
const LEVEL = { target: -17, ceiling: -1.5, max_lim: 6 };
const LEVEL_KEY = LEVEL.target + '/' + LEVEL.ceiling + '/' + LEVEL.max_lim;
const CPS = 14.3;          // the auditions spoke 478 characters in 33.4 s - for the length estimate only
const BYTES_PER_S = 16000; // 128 kbps

// A line's style flags (CampDialogue: whisper / angry / think) become audio tags in the SPOKEN text only; the box
// still shows the plain line. ~hacked~ markers are dropped: the stutter is in the words ("K-k-kill").
const STYLE_TAGS = { whisper: '[whispers]', angry: '[angry]', think: '[quietly]' };
// Whole-line performance overrides, where the plain text would be read out rather than performed.
const SAY = {
  op_groan: '[groaning] Arrgh... Ughhhhh...',
};
// Pronunciation, per speaker: word -> what is SENT (eleven_v4 also takes IPA between slashes). "Xorzo" needs none: the
// owner checked it in two voices before the bake - "they all sound right". (2026-10-08) Cybertronic read "AIs" as
// "A is" (the owner: "maybe make him say 'AI' instead of 'AIs'"): leg1_c's text became "AI"; his other lines need the
// plural, so he is sent "AI's" (read "A-I's"). Quentin and Victor read "AIs" without complaint, so theirs stay.
const PRON = {
  xorzo: { AIs: "AI's" },
};

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] || '') : null; };
const csv = (k) => (opt(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

// CAMP_LINES / CAMP_SEQS are plain object literals (strings, flags, comments) closed by "};" at a line start
function jsLiteral(src, name) {
  const head = 'const ' + name + ' = ';
  const a = src.indexOf(head);
  if (a < 0) throw new Error(name + ' not found in ' + SRC);
  const b = src.indexOf('\n};', a);
  if (b < 0) throw new Error(name + ': no "};" at a line start after it');
  return new Function('return (' + src.slice(a + head.length, b + 2) + ');')();
}

function spoken(id, line) {
  if (SAY[id]) return SAY[id];
  let t = String(line.text).replace(/~/g, '');
  for (const [w, r] of Object.entries(PRON[line.who] || {})) t = t.replace(new RegExp('\\b' + w + '\\b', 'g'), r);
  const tags = Object.keys(STYLE_TAGS).filter((k) => line[k]).map((k) => STYLE_TAGS[k]);
  return (tags.length ? tags.join(' ') + ' ' : '') + t;
}

const hashOf = (voiceId, model, text) =>
  createHash('sha256').update(JSON.stringify({ voiceId, model, text, format: FORMAT })).digest('hex').slice(0, 16);

const src = readFileSync(SRC, 'utf8');
const LINES = jsLiteral(src, 'CAMP_LINES');
const SEQS = jsLiteral(src, 'CAMP_SEQS');
const manifest = readJson(MANIFEST, {});
const raw = readJson(RAW_JSON, {});
const model = opt('--model') || MODEL;
const rawPath = (id) => join(RAW_DIR, id + '.mp3');
const voicePath = (id) => join(VOICE_DIR, id + '.mp3');

// ── the selection ──
let ids = Object.keys(LINES);
const only = csv('--only'), who = csv('--who'), seqs = csv('--seq'), adopt = csv('--adopt');
const ingest = opt('--ingest') ? readJson(opt('--ingest'), []) : null;
if (only.length) { const s = new Set(only); for (const i of only) if (!LINES[i]) console.warn('warn: no line "' + i + '"'); ids = ids.filter((i) => s.has(i)); }
if (who.length) { const s = new Set(who); ids = ids.filter((i) => s.has(LINES[i].who)); }
if (seqs.length) {
  const want = new Set();
  for (const n of seqs) {
    if (!SEQS[n]) console.warn('warn: no sequence "' + n + '"');
    for (const e of SEQS[n] || []) { const id = typeof e === 'string' ? e : e && e.id; if (id) want.add(id); }
  }
  ids = ids.filter((i) => want.has(i));
}
if (adopt.length) { const s = new Set(adopt); ids = ids.filter((i) => s.has(i)); }
if (ingest) { const s = new Set(ingest.map((e) => e.id)); ids = ids.filter((i) => s.has(i)); }

function stateOf(p) {
  const m = manifest[p.id], r = raw[p.id], inVoice = existsSync(voicePath(p.id));
  if (inVoice && m && m.hash === p.hash && (m.level === LEVEL_KEY || m.level === 'adopted')) return 'baked';
  if (inVoice && !m) return 'own';
  if (r && r.hash === p.hash && existsSync(rawPath(p.id))) return 'raw';
  return inVoice || r ? 'stale' : 'missing';
}
const plan = ids.map((id) => {
  const L = LINES[id], cast = CAST[L.who];
  if (!cast) throw new Error(id + ': no voice cast for speaker "' + L.who + '"');
  const text = spoken(id, L), p = { id, who: L.who, voice: cast.name, voice_id: cast.id, model_id: model, text, chars: text.length, hash: hashOf(cast.id, model, text) };
  p.status = stateOf(p);
  return p;
});
// to MAKE (spends credits): missing / stale, and with --force everything selected - but an 'own' clip only when
// --only names it (a hand recording is precious)
const todo = plan.filter((p) => p.status === 'missing' || p.status === 'stale' ||
  (has('--force') && (p.status !== 'own' || only.includes(p.id))));

function report() {
  const fmt = (n) => n.toLocaleString('en-US');
  console.log('CAMPAIGN VOICE · model ' + model + ' · ' + FORMAT + ' · 1 credit per character · levelled to ' + LEVEL.target + ' LUFS');
  for (const k of Object.keys(CAST)) {
    const p = plan.filter((x) => x.who === k);
    if (!p.length) continue;
    const c = p.reduce((s, x) => s + x.chars, 0);
    console.log('  ' + k.padEnd(10) + CAST[k].name.padEnd(13) + String(p.length).padStart(4) + ' lines ' + fmt(c).padStart(7) + ' chars');
  }
  const chars = plan.reduce((s, x) => s + x.chars, 0), tchars = todo.reduce((s, x) => s + x.chars, 0);
  const secs = chars / CPS;
  console.log('  ' + plan.length + ' lines · ' + fmt(chars) + ' characters · ~' + (secs / 60).toFixed(1) + ' min of audio · ~' +
    (secs * BYTES_PER_S / 1048576).toFixed(1) + ' MB');
  const by = (s) => plan.filter((x) => x.status === s).length;
  console.log('  to make: ' + todo.length + ' lines = ' + fmt(tchars) + ' credits  (missing ' + by('missing') + ', stale ' + by('stale') +
    ') · to level ' + by('raw') + ' · baked ' + by('baked') + ' · own ' + by('own'));
  const tagged = plan.filter((x) => /^\[/.test(x.text));
  if (tagged.length) console.log('  performed: ' + tagged.map((x) => x.id + ' ' + x.text.match(/^(\[[^\]]+\]\s*)+/)[0].trim()).join(' · '));
  if (has('--list')) for (const x of plan) console.log('  ' + x.status.padEnd(8) + x.id.padEnd(16) + x.who.padEnd(10) + String(x.chars).padStart(4) + '  ' + x.text);
}

function syncMediaJson() {
  const text = existsSync(MEDIA_JSON) ? readFileSync(MEDIA_JSON, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const mj = text ? JSON.parse(text) : { videos: [], voices: [], lines: [] };
  const before = (mj.lines || []).length;
  mj.lines = Object.keys(LINES).filter((id) => existsSync(voicePath(id)));
  // (2026-10-08, v52.96) "rev": each clip's content version (the first 8 hex of the shipped file's sha1). The game asks for
  // voice/<id>.mp3?v=<rev> (CampMedia.voiceUrl) and fetches with cache:'force-cache', so a re-made clip - the narrator's
  // 18 when Gerald replaced Quentin - is a new URL, while every unchanged clip keeps its cached copy.
  const prevRev = mj.rev || {};
  mj.rev = {};
  for (const id of mj.lines) mj.rev[id] = createHash('sha1').update(readFileSync(voicePath(id))).digest('hex').slice(0, 8);
  const changed = mj.lines.filter((id) => prevRev[id] !== mj.rev[id]).length;
  writeFileSync(MEDIA_JSON, JSON.stringify(mj, null, 2).replace(/\n/g, eol) + eol);
  console.log('media.json "lines": ' + before + ' -> ' + mj.lines.length + ' · "rev" changed for ' + changed);
}
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
const saveRaw = () => { mkdirSync(RAW_DIR, { recursive: true }); writeFileSync(RAW_JSON, JSON.stringify(raw, null, 2) + '\n'); };

function blenderExe() {
  if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER;
  try {
    const out = execFileSync('python', [join(ROOT, 'tools', 'blender', 'blender_path.py')], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (out && existsSync(out)) return out;
  } catch (_) {}
  throw new Error('no Blender found (set BLENDER=path\\to\\blender.exe): the leveller runs inside it');
}

// level the given plan entries' raw clips into voice/ (one Blender run for all of them) and record each result
function level(list) {
  if (!list.length) return 0;
  mkdirSync(VOICE_DIR, { recursive: true });
  const job = join(tmpdir(), 'lss_campaign_voice_level_' + process.pid + '.json');
  writeFileSync(job, JSON.stringify(Object.assign({}, LEVEL, { items: list.map((p) => ({ id: p.id, src: rawPath(p.id), dst: voicePath(p.id) })) })));
  const r = spawnSync(blenderExe(), ['-b', '--factory-startup', '--python', LEVELER, '--', job], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const results = new Map();
  for (const line of String(r.stdout || '').split(/\r?\n/)) if (line.startsWith('LVL ')) { const o = JSON.parse(line.slice(4)); results.set(o.id, o); }
  let n = 0, short = [];
  for (const p of list) {
    const o = results.get(p.id);
    if (!o || o.error) { console.error('  LEVEL FAILED ' + p.id + ': ' + (o ? o.error : 'no result (Blender exit ' + r.status + ')')); continue; }
    manifest[p.id] = { hash: p.hash, who: p.who, voice: p.voice, model: p.model_id, text: p.text, bytes: statSync(voicePath(p.id)).size,
      secs: o.secs, level: LEVEL_KEY, lufs_in: o.lufs, gain: o.gain, lufs: o.out_lufs, peak: o.out_peak, lim: o.lim, at: new Date().toISOString() };
    if (o.short) { manifest[p.id].short = o.short; short.push(p.id + ' ' + o.short); }
    n++;
  }
  saveManifest();
  console.log('levelled ' + n + '/' + list.length + ' to ' + LEVEL.target + ' LUFS' + (short.length ? ' · short of it (limiter cap): ' + short.join(', ') : ''));
  return n;
}

async function synth(key, p) {
  const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(p.voice_id) + '?output_format=' + FORMAT;
  for (let tries = 1; ; tries++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: p.text, model_id: p.model_id }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = (await res.text()).slice(0, 300);
    // 429 = over the plan's concurrency / rate: wait and retry; anything else is a real error (bad voice, no credits)
    if (res.status === 429 && tries < 6) { await new Promise((r) => setTimeout(r, 2000 * tries)); continue; }
    throw new Error('HTTP ' + res.status + ' ' + body);
  }
}

if (has('--dry')) { report(); process.exit(0); }

if (opt('--plan') !== null && !ingest) {
  const out = opt('--plan') || 'campaign_voice_plan.json';
  writeFileSync(out, JSON.stringify(todo.map(({ id, who, voice, voice_id, model_id, text, chars, hash, status }) =>
    ({ id, who, voice, voice_id, model_id, text, chars, hash, status })), null, 2) + '\n');
  report();
  console.log('plan: ' + todo.length + ' lines -> ' + out + ' · download each take to ' + RAW_DIR + '\\<id>.mp3, then --ingest it');
  process.exit(0);
}

if (ingest) {
  // a plan entry registers only if its line still hashes the same: the clip was made from THAT text
  // (a plan is ingested batch by batch as its takes arrive: lines already baked are left alone, missing ones counted)
  const planned = new Map(ingest.map((e) => [e.id, e.hash]));
  let n = 0, absent = 0, already = 0;
  for (const p of plan) {
    if (p.status === 'baked' && !has('--force')) { already++; continue; }
    if (!existsSync(rawPath(p.id))) { absent++; continue; }
    if (planned.get(p.id) !== p.hash) { console.warn('  skip ' + p.id + ': the line changed since the plan'); continue; }
    raw[p.id] = { hash: p.hash, bytes: statSync(rawPath(p.id)).size, via: 'connector', at: new Date().toISOString() };
    p.status = 'raw'; n++;
  }
  saveRaw();
  console.log('ingested ' + n + ' raw clip(s) · already baked ' + already + ' · not downloaded yet ' + absent);
  level(plan.filter((p) => p.status === 'raw'));
  syncMediaJson();
  process.exit(0);
}

if (has('--level')) {
  level(plan.filter((p) => p.status === 'raw' || (has('--force') && p.status === 'baked' && raw[p.id] && raw[p.id].hash === p.hash && existsSync(rawPath(p.id)))));
  syncMediaJson();
  process.exit(0);
}

if (adopt.length) {
  let n = 0;
  for (const p of plan) {
    if (!existsSync(voicePath(p.id))) { console.warn('  skip ' + p.id + ': no clip in voice/'); continue; }
    manifest[p.id] = { hash: p.hash, who: p.who, voice: p.voice, model: p.model_id, text: p.text, bytes: statSync(voicePath(p.id)).size,
      level: 'adopted', at: new Date().toISOString() };
    n++;
  }
  saveManifest();
  console.log('adopted ' + n + ' clip(s) as made from the current text');
  syncMediaJson();
  process.exit(0);
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('error: set ELEVENLABS_API_KEY in your shell to bake (or --dry to preview, --plan / --ingest for the connector route).');
  process.exit(1);
}
report();
mkdirSync(RAW_DIR, { recursive: true });
let done = 0, spent = 0, fails = 0;
for (const p of todo) {
  try {
    const mp3 = await synth(KEY, p);
    writeFileSync(rawPath(p.id), mp3);
    raw[p.id] = { hash: p.hash, bytes: mp3.length, via: 'api', at: new Date().toISOString() };
    saveRaw();   // after every clip, so a stopped run keeps what it made
    p.status = 'raw'; done++; spent += p.chars; fails = 0;
    console.log('  ' + String(done).padStart(3) + '/' + todo.length + '  ' + p.id.padEnd(16) + (mp3.length / 1024).toFixed(0).padStart(4) + ' KB  ' + p.text.slice(0, 60));
  } catch (e) {
    console.error('  FAILED ' + p.id + ': ' + e.message);
    if (/HTTP 40[13]|quota|credits/i.test(e.message)) { console.error('stopping: the key or the credits are the problem, not this line'); break; }
    // three in a row is the setup (a model id the API doesn't take, a voice not in the workspace), not the lines
    if (++fails >= 3) { console.error('stopping: 3 failures in a row'); break; }
  }
}
console.log('made ' + done + '/' + todo.length + ' (' + spent.toLocaleString('en-US') + ' credits)');
level(plan.filter((p) => p.status === 'raw'));
syncMediaJson();
