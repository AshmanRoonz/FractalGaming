#!/usr/bin/env node
/**
 * HUB BAKE FILE (v54.24) - the overworld's height tables, baked OFFLINE and shipped, so neither a PC nor a phone bakes
 * them in the browser. Owner: "what if we make the map its own file... it's the biggest map and requires the most load
 * time" / "21mb is barely anything these days". See THE OVERWORLD SHIPS AS A FILE in LSS/index-working.html.
 *
 *   1. In the game, DESKTOP, in the overworld (Exhibition):  copy(JSON.stringify(window.__hbakeSpec()))
 *      and save it as tools/hub_bake_spec.json   (or have Claude export it from the Browser pane)
 *   2. node tools/hub_bake_file.mjs [spec.json]           -> LSS/hub_bake/<keyBase>.hb + <keyFar>.hbf + manifest.json
 *      node tools/hub_bake_file.mjs --check [spec.json]   -> is the spec still the shipped lss.js's field? exit 1 if not
 *
 * The spec carries the field as the game's OWN worker program (_hbWorkerSrc: the live functions' source + the game bits)
 * and this runs that program, unchanged, in a pool of worker_threads with the same row-band jobs _hbBakeWorkers sends -
 * so the tables are the very Int16 a browser bake makes (lossless: 1/8 u, as baked). Before a texel is baked, the 48
 * check points the game evaluated on its main thread must come back the same here (to 1e-6), the game's own rule.
 *
 * Files: 'LSSHB01\0', u32 LE header length, the header JSON (padded with spaces so the data starts 8-aligned), then the
 * Int16 LE tables. The base (32 u, 3328^2 = 21.1 MiB) and the far tables (desktop's clipmap) are separate files because
 * Cloudflare Pages takes 25 MiB a file. The names are the keys - the game's _hbHash, the same key its IndexedDB cache
 * uses - so a terrain change makes a new name, the old file is never fetched again, and the game falls back to baking
 * until this is re-run. Old .hb / .hbf files are deleted here.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'LSS', 'hub_bake');
const MAGIC = 'LSSHB01\0';

if (!isMainThread) {
  // A pool worker: the game's worker program, as a function of `self` (its top-level declarations stay local to it).
  const self = { postMessage: (m, transfer) => parentPort.postMessage(m, transfer) };
  new Function('self', workerData.src)(self);
  parentPort.on('message', (job) => self.onmessage({ data: job }));
} else {
  main().catch((e) => { console.error('[hub_bake] FAILED:', e && e.stack || e); process.exit(1); });
}

function readSpec(args) {
  const p = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'tools', 'hub_bake_spec.json');
  if (!fs.existsSync(p)) throw new Error('no spec at ' + p + ' - export it from the game: window.__hbakeSpec()');
  const s = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
  if (!s || s.v !== 1 || !s.src || !s.keyBase || !s.keyFar || !Array.isArray(s.fam)) throw new Error('not a hub bake spec: ' + p);
  return { s, p };
}

// Every function of the field must still read, byte for byte, as the shipped lss.js has it.
function staleness(s) {
  const lss = fs.readFileSync(path.join(ROOT, 'LSS', 'lss.js'), 'utf8');
  return s.fam.filter((f) => !lss.includes(f.src)).map((f) => f.name);
}

function writeTable(file, kind, key, levels, arrays) {
  let off = 0;
  const lv = levels.map((L, i) => { const o = { sp: L.sp, N: L.N, x0: L.x0, z0: L.z0, off }; off += arrays[i].byteLength; return o; });
  let hdr = JSON.stringify({ v: 1, kind, key, levels: lv });
  while ((12 + Buffer.byteLength(hdr)) % 8) hdr += ' ';
  const H = Buffer.from(hdr, 'utf8'), head = Buffer.alloc(12);
  head.write(MAGIC, 0, 'latin1'); head.writeUInt32LE(H.length, 8);
  const parts = [head, H, ...arrays.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))];
  fs.writeFileSync(file, Buffer.concat(parts));
  return fs.statSync(file).size;
}

async function main() {
  const args = process.argv.slice(2);
  const { s, p } = readSpec(args);
  const stale = staleness(s);
  if (args.includes('--check')) {
    const man = path.join(OUT, 'manifest.json');
    let have = false;
    try { const m = JSON.parse(fs.readFileSync(man, 'utf8')); have = !!(m.base && m.base[s.keyBase] && m.far && m.far[s.keyFar] &&
      fs.existsSync(path.join(OUT, m.base[s.keyBase].file)) && fs.existsSync(path.join(OUT, m.far[s.keyFar].file))); } catch (_) {}
    if (stale.length) console.log('[hub_bake] STALE: the shipped lss.js changed ' + stale.join(', ') + ' since the spec (' + s.build + ') - re-export window.__hbakeSpec() and re-run');
    else console.log('[hub_bake] spec matches lss.js (build ' + s.build + ')' + (have ? ', files present' : ' - but the files are MISSING: run without --check'));
    process.exit(stale.length || !have ? 1 : 0);
  }
  if (stale.length) throw new Error('STALE spec - lss.js no longer has ' + stale.join(', ') + ' as exported in build ' + s.build + '. Re-export window.__hbakeSpec() from the current build.');
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian host: the files are little-endian');

  const nW = Math.max(1, Math.min(16, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
  const ws = Array.from({ length: nW }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { src: s.src } }));
  const kill = () => { for (const w of ws) { try { w.terminate(); } catch (_) {} } };
  try {
    // (1) THE SELF-CHECK, the game's own: reproduce its main thread at 48 points, inside the box and far out
    const got = await new Promise((res, rej) => {
      const w = ws[0], to = setTimeout(() => rej(new Error('self-check timeout')), 30000);
      w.once('message', (m) => { clearTimeout(to); res(m && m.check); });
      w.once('error', (e) => { clearTimeout(to); rej(e); });
      w.postMessage({ check: Float64Array.from(s.check), T: s.T });
    });
    let worst = 0;
    for (let i = 0; i < s.expect.length; i++) {
      const a = s.expect[i], b = got[i], d = Math.abs(a - b);
      worst = Math.max(worst, d);
      if (!(d <= 1e-6 * Math.max(1, Math.abs(a)))) throw new Error('disagrees with the game at check ' + i + ': ' + a + ' vs ' + b);
    }
    console.log('[hub_bake] self-check: 48/48 agree with the game (worst |d| ' + worst.toExponential(2) + '), ' + nW + ' workers');

    // (2) THE JOBS: row bands of 16, pulled by whichever worker is free - the base, then each far table (which skips
    //     the base box, exactly as the game's do)
    const targets = [{ N: s.N, sp: s.sp, x0: s.x0, z0: s.z0, skip: 0, data: new Int16Array(s.N * s.N) }];
    for (const f of s.far) targets.push({ N: f.N, sp: f.sp, x0: f.x0, z0: f.z0, skip: s.box, data: new Int16Array(f.N * f.N) });
    const jobs = []; let total = 0;
    targets.forEach((tg, t) => { for (let j0 = 0; j0 < tg.N; j0 += 16) { const j1 = Math.min(tg.N, j0 + 16);
      jobs.push({ id: jobs.length, t, j0, j1, N: tg.N, sp: tg.sp, x0: tg.x0, z0: tg.z0, skip: tg.skip, T: s.T }); total += (j1 - j0) * tg.N; } });
    const t0 = Date.now(); let done = 0, next = 0, lastPct = -1;
    await new Promise((resolve, reject) => {
      let active = 0, failed = null;
      const pump = (w) => {
        if (failed) return;
        if (next >= jobs.length) { if (active === 0) resolve(); return; }
        const job = jobs[next++]; active++;
        w.once('message', (r) => {
          const tg = targets[r.t]; tg.data.set(r.data, r.j0 * tg.N);
          done += (r.j1 - r.j0) * tg.N; active--;
          const pct = Math.floor(100 * done / total); if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write('  ' + pct + '%'); }
          pump(w);
        });
        w.postMessage(job);
      };
      for (const w of ws) { w.on('error', (e) => { failed = e; reject(e); }); pump(w); }
    });
    console.log('\n[hub_bake] baked ' + total + ' samples in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

    // (3) THE FILES, named by their keys; the manifest says which exist; old ones go
    fs.mkdirSync(OUT, { recursive: true });
    const baseFile = s.keyBase + '.hb', farFile = s.keyFar + '.hbf';
    const bb = writeTable(path.join(OUT, baseFile), 'base', s.keyBase, [targets[0]], [targets[0].data]);
    const fb = writeTable(path.join(OUT, farFile), 'far', s.keyFar, targets.slice(1), targets.slice(1).map((t) => t.data));
    const LIM = 25 * 1024 * 1024;
    for (const [f, b] of [[baseFile, bb], [farFile, fb]]) if (b > LIM) throw new Error(f + ' is ' + (b / 1048576).toFixed(1) + ' MiB - over Pages\' 25 MiB per file');
    const manifest = { v: 1, build: s.build, made: new Date().toISOString(), spec: path.relative(ROOT, p).replace(/\\/g, '/'),
                       base: { [s.keyBase]: { file: baseFile, bytes: bb } }, far: { [s.keyFar]: { file: farFile, bytes: fb } } };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const f of fs.readdirSync(OUT)) if (/\.(hb|hbf)$/.test(f) && f !== baseFile && f !== farFile) { fs.unlinkSync(path.join(OUT, f)); console.log('[hub_bake] removed old ' + f); }
    console.log('[hub_bake] wrote LSS/hub_bake/' + baseFile + ' (' + (bb / 1048576).toFixed(1) + ' MiB) + ' + farFile + ' (' + (fb / 1048576).toFixed(1) + ' MiB) + manifest.json');
  } finally { kill(); }
}
