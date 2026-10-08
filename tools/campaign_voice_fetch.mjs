#!/usr/bin/env node
/**
 * CAMPAIGN VOICE: fetch the connector's takes (2026-10-08) - the download half of the connector route in
 * tools/campaign_voice.mjs (--plan -> generate on the ElevenLabs connector -> THIS -> --ingest).
 *
 *   node tools/campaign_voice_fetch.mjs <plan.json> <status.json> [<status.json> ...] [--force]
 *
 * <status.json> = a creative_get_flow_run_status result saved to a file (the harness saves an oversized result to
 * disk on its own: poll many sessions at once). Each finished take is matched to its line by voice id + its EXACT
 * prompt, so a take whose text differs from the plan never lands under a line's name; its content_url (signed for 2 h)
 * is downloaded to assets_base/campaign_voice_raw/<id>.mp3. A clip already there is kept only when raw.json records it
 * as made from this entry's text (--force replaces it anyway).
 * Checks each download: HTTP 200, > 1 KB, starts like an MP3 (ID3 tag or an MPEG frame sync).
 * Prints: fetched / kept / pending (not finished: poll again later) / unmatched / failed. Exit 1 if any failed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'assets_base', 'campaign_voice_raw');
const args = process.argv.slice(2).filter((a) => a !== '--force');
const FORCE = process.argv.includes('--force');
if (args.length < 2) { console.error('usage: node tools/campaign_voice_fetch.mjs <plan.json> <status.json> [...] [--force]'); process.exit(2); }

const plan = JSON.parse(readFileSync(args[0], 'utf8'));
const byKey = new Map(plan.map((e) => [e.voice_id + '\n' + e.text, e]));
mkdirSync(RAW_DIR, { recursive: true });
// a raw clip is KEPT only if raw.json says it was made from this plan entry's text (its hash): a re-take after a
// script / pronunciation change (v52.65 "AIs") must replace the old take, not be skipped because a file exists
const RAW_JSON = join(RAW_DIR, 'raw.json');
const raw = existsSync(RAW_JSON) ? JSON.parse(readFileSync(RAW_JSON, 'utf8')) : {};

const isMp3 = (b) => b.length > 1024 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
let fetched = 0, kept = 0, failed = 0;
const unmatched = [], pending = new Set(), done = new Set();

for (const f of args.slice(1)) {
  const st = JSON.parse(readFileSync(f, 'utf8'));
  for (const g of st.generations || []) if (g.status !== 'completed') pending.add(g.prompt + (g.error_message ? '  (' + g.error_message + ')' : ''));
  for (const m of st.media || []) {
    const vid = m.voice && m.voice.voice_id, e = byKey.get(vid + '\n' + m.prompt);
    if (!e) { unmatched.push((m.voice && m.voice.name) + ': ' + m.prompt); continue; }
    if (done.has(e.id)) continue;
    const out = join(RAW_DIR, e.id + '.mp3');
    if (existsSync(out) && !FORCE && raw[e.id] && raw[e.id].hash === e.hash) { kept++; done.add(e.id); continue; }
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isMp3(buf)) throw new Error('not an MP3 (' + buf.length + ' bytes)');
      writeFileSync(out, buf);
      fetched++; done.add(e.id);
      console.log('  got ' + e.id.padEnd(16) + String(Math.round(buf.length / 1024)).padStart(4) + ' KB  ' + (m.duration_secs || '?') + ' s');
    } catch (err) { failed++; console.error('  FAILED ' + e.id + ': ' + err.message); }
  }
}
// a take that finished after its status file was saved is "pending" there but may be fetched from a later one
const stillPending = [...pending].filter((p) => !plan.some((e) => done.has(e.id) && (p === e.text || p.startsWith(e.text + '  ('))));
console.log('fetched ' + fetched + ' · kept ' + kept + ' · pending ' + stillPending.length + ' · unmatched ' + unmatched.length + ' · failed ' + failed);
for (const p of stillPending) console.log('  pending: ' + p.slice(0, 90));
for (const u of unmatched) console.log('  unmatched: ' + u.slice(0, 90));
// exitCode, not process.exit(): exiting while fetch's keep-alive sockets close trips a libuv assertion on Windows
process.exitCode = failed ? 1 : 0;
