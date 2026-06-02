/* ============================================================
   LSS lightning/perf profiler  (paste into the game's DevTools console)
   ------------------------------------------------------------
   1. Start a match and get into combat.
   2. Paste this whole file into the Console and press Enter.
   3. Play a HEAVY fight for ~20-30s: lots of lightning
      (Slayer / Puncture / Vortex / Stun, gas arcs, etc.).
      Reproduce the lag + audio distortion while it runs.
   4. Run:  __lssProf.stop()
   5. Copy the printed table(s) back to me.
   ============================================================ */
(function () {
  if (window.__lssProf && window.__lssProf.running) {
    console.log('[lssProf] already running. Stop with __lssProf.stop()');
    return;
  }
  var R = window.renderer, G = window.game;
  if (!R || !G) { console.warn('[lssProf] window.renderer/game not ready - start a match first.'); return; }

  var LIGHTNING_TYPES = { lightning:1, siphonHelix:1, lightningSeg:1, darkLightningSeg:1 };
  var P = {
    running: true,
    LONG_MS: 24,          // a frame slower than this counts as a hitch (~<42fps)
    GC_DROP: 1.5e6,       // heap drop (bytes) treated as a GC event
    samples: [],
    _raf: null,
    lastT: performance.now(),
    lastHeap: (performance.memory ? performance.memory.usedJSHeapSize : 0),
  };

  function countLightning() {
    var e = G.effects; if (!e) return 0;
    var n = 0;
    for (var i = 0; i < e.length; i++) { var t = e[i] && e[i].type; if (t && LIGHTNING_TYPES[t]) n++; }
    return n;
  }

  function tick() {
    if (!P.running) return;
    var now = performance.now();
    var dt = now - P.lastT; P.lastT = now;
    var heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
    var dHeap = heap - P.lastHeap; P.lastHeap = heap;
    var info = R.info;
    P.samples.push({
      dt: dt,
      lit: countLightning(),
      heap: heap,
      dHeap: dHeap,
      calls: info.render ? info.render.calls : 0,
      geos: info.memory ? info.memory.geometries : 0,
      fx: G.effects ? G.effects.length : 0,
      par: G.particles ? G.particles.length : 0,
    });
    if (P.samples.length > 12000) P.samples.shift();
    P._raf = requestAnimationFrame(tick);
  }

  function pctl(arr, p) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  }
  function corr(xs, ys) {
    var n = xs.length; if (!n) return 0;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
    var cov = 0, vx = 0, vy = 0;
    for (i = 0; i < n; i++) { var a = xs[i] - mx, b = ys[i] - my; cov += a * b; vx += a * a; vy += b * b; }
    return (vx && vy) ? (cov / Math.sqrt(vx * vy)) : 0;
  }

  P.stop = function () {
    P.running = false;
    if (P._raf) cancelAnimationFrame(P._raf);
    var s = P.samples;
    if (!s.length) { console.warn('[lssProf] no samples'); return; }
    var dts = s.map(function (x) { return x.dt; });
    var lits = s.map(function (x) { return x.lit; });
    var durSec = s.reduce(function (a, x) { return a + x.dt; }, 0) / 1000;

    var longs = s.filter(function (x) { return x.dt > P.LONG_MS; });
    var gcFrames = s.filter(function (x) { return x.dHeap < -P.GC_DROP; });
    // mark indices near a GC (this frame or the one right after a big alloc frame)
    var gcSet = new Set(); for (var i = 0; i < s.length; i++) if (s[i].dHeap < -P.GC_DROP) gcSet.add(i);
    var longNearGC = 0, longWithLit = 0;
    for (i = 0; i < s.length; i++) {
      if (s[i].dt <= P.LONG_MS) continue;
      if (s[i].lit > 0) longWithLit++;
      if (gcSet.has(i) || gcSet.has(i - 1) || gcSet.has(i + 1)) longNearGC++;
    }
    var allocBytes = s.reduce(function (a, x) { return a + (x.dHeap > 0 ? x.dHeap : 0); }, 0);

    var summary = {
      seconds: +durSec.toFixed(1),
      frames: s.length,
      avgFps: +(s.length / durSec).toFixed(1),
      avgMs: +(dts.reduce(function (a, b) { return a + b; }, 0) / s.length).toFixed(2),
      p95Ms: +pctl(dts, 0.95).toFixed(2),
      maxMs: +Math.max.apply(null, dts).toFixed(2),
      longFrames: longs.length,
      longFramesWithLightning: longWithLit,
      longFramesNearGC: longNearGC,
      gcEvents: gcFrames.length,
      allocMB_per_sec: +((allocBytes / 1e6) / durSec).toFixed(1),
      maxLightningActive: Math.max.apply(null, lits),
      maxDrawCalls: Math.max.apply(null, s.map(function (x) { return x.calls; })),
      corr_lightning_vs_frameMs: +corr(lits, dts).toFixed(3),
    };

    console.log('%c=== LSS lightning/perf profile ===', 'font-weight:bold');
    console.table([summary]);
    console.log('Worst 10 hitch frames:');
    console.table(longs.sort(function (a, b) { return b.dt - a.dt; }).slice(0, 10).map(function (x) {
      return { ms: +x.dt.toFixed(1), lightningActive: x.lit, heapDeltaKB: Math.round(x.dHeap / 1024), drawCalls: x.calls, effects: x.fx, particles: x.par };
    }));
    console.log('Interpretation: a high corr_lightning_vs_frameMs (>~0.4), most longFrames having lightningActive>0, and longFramesNearGC close to longFrames all point at lightning-driven allocation churn.');
    window.__lssProfResult = summary;
    return summary;
  };

  window.__lssProf = P;
  P.lastT = performance.now();
  P._raf = requestAnimationFrame(tick);
  console.log('%c[lssProf] started.', 'color:#6cf', 'Play a heavy lightning fight ~20-30s, then run:  __lssProf.stop()');
  if (!performance.memory) console.warn('[lssProf] performance.memory unavailable - GC/alloc metrics will be 0. Launch Chrome with --enable-precise-memory-info for heap data (optional).');
})();
