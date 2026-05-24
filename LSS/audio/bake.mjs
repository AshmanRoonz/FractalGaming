#!/usr/bin/env node
/**
 * Bake announcer lines into static MP3 files using ElevenLabs.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=sk_... node bake.mjs           # idempotent: skip files that exist
 *   ELEVENLABS_API_KEY=sk_... node bake.mjs --force   # re-bake everything
 *   node bake.mjs --dry                               # print the plan, no API calls
 *
 * Optional env vars:
 *   ELEVENLABS_VOICE_ID  - override lines.json voice.id (e.g. to test a different voice)
 *   ELEVENLABS_MODEL_ID  - override model_id            (default eleven_turbo_v2_5)
 *
 * Output:
 *   audio/<sha256-16>.mp3   - one per unique text
 *   audio/manifest.json     - { hash: { key, text, bytes } } map for the client snippet
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARGS = new Set(process.argv.slice(2));
const FORCE = ARGS.has('--force');
const DRY   = ARGS.has('--dry');

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!DRY && !API_KEY) {
  console.error('error: ELEVENLABS_API_KEY env var is required (or pass --dry to preview).');
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(HERE, 'lines.json'), 'utf8'));
const voiceId = process.env.ELEVENLABS_VOICE_ID || config.voice?.id;
const modelId = process.env.ELEVENLABS_MODEL_ID || config.voice?.model_id || 'eleven_turbo_v2_5';
const settings = config.voice?.settings || { stability: 0.45, similarity_boost: 0.75, speed: 1.0 };
const ships = config.ships || [];

if (!voiceId) {
  console.error('error: no voice id (set voice.id in lines.json or pass ELEVENLABS_VOICE_ID env var).');
  process.exit(1);
}

// Expand templates: every line with {ship} becomes one entry per ship.
const expanded = [];
for (const line of config.lines) {
  if (line.template && /\{ship\}/.test(line.text)) {
    for (const ship of ships) {
      expanded.push({
        key: `${line.key}__${ship}`,
        text: line.text.replace(/\{ship\}/g, ship),
      });
    }
  } else {
    expanded.push({ key: line.key, text: line.text });
  }
}

// Deduplicate by exact text (content-addressed; same text -> same file).
const byHash = new Map();
for (const entry of expanded) {
  const hash = sha16(entry.text);
  if (!byHash.has(hash)) byHash.set(hash, { hash, key: entry.key, text: entry.text });
}

console.log(`voice id:    ${voiceId}`);
console.log(`model id:    ${modelId}`);
console.log(`unique lines: ${byHash.size}`);
console.log(`total chars:  ${[...byHash.values()].reduce((n, e) => n + e.text.length, 0)}`);
console.log();

if (DRY) {
  for (const e of byHash.values()) {
    console.log(`  ${e.hash}.mp3  [${e.key.padEnd(28)}] ${JSON.stringify(e.text).slice(0, 80)}`);
  }
  console.log('\ndry run; no files written, no API calls made.');
  process.exit(0);
}

mkdirSync(HERE, { recursive: true });

let baked = 0, skipped = 0, totalBytes = 0;
const manifest = {};

for (const e of byHash.values()) {
  const out = join(HERE, `${e.hash}.mp3`);
  const existing = existsSync(out);
  if (existing && !FORCE) {
    const bytes = statSync(out).size;
    manifest[e.hash] = { key: e.key, text: e.text, bytes };
    totalBytes += bytes;
    skipped++;
    console.log(`skip  ${e.hash}.mp3  (${bytes} bytes)  [${e.key}]`);
    continue;
  }
  process.stdout.write(`bake  ${e.hash}.mp3  [${e.key}] ... `);
  const audio = await synth(e.text);
  writeFileSync(out, Buffer.from(audio));
  manifest[e.hash] = { key: e.key, text: e.text, bytes: audio.byteLength };
  totalBytes += audio.byteLength;
  baked++;
  console.log(`${audio.byteLength} bytes`);
}

// Sort manifest by key for stable diffs.
const sortedManifest = Object.fromEntries(
  Object.entries(manifest).sort(([, a], [, b]) => a.key.localeCompare(b.key))
);
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(sortedManifest, null, 2) + '\n');

console.log();
console.log(`done. baked=${baked} skipped=${skipped} totalBytes=${totalBytes}`);
console.log(`wrote manifest.json (${Object.keys(sortedManifest).length} entries)`);

// -- helpers ---------------------------------------------------------------

function sha16(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

async function synth(text) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'content-type': 'application/json',
      'accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: settings,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`elevenlabs ${resp.status}: ${body.slice(0, 300)}`);
  }
  return await resp.arrayBuffer();
}
