// Injected before the app's own scripts: keeps the AudioContext the page makes, counts frames and
// long main-thread tasks, and measures audio glitches through AudioContext.playoutStats when the
// browser has it (Chrome's count of moments the audio thread had nothing ready to play).
(() => {
  if (window.__phi) return;
  const P = window.__phi = { ctx: null, opts: [], long: [], frames: 0 };
  // Experiments: window.__phiForce = { latency: 'playback' | seconds, fps: 30 } set before this runs
  const F = window.__phiForce || {};
  const AC = window.AudioContext;
  if (AC) {
    window.AudioContext = class extends AC {
      constructor(o) {
        if (F.latency !== undefined) o = Object.assign({}, o, { latencyHint: F.latency });
        super(o); P.ctx = this; P.opts.push(o === undefined ? null : o);
      }
    };
  }
  if (F.noCssAnim) {
    // stop the page's never-ending CSS animations (the title tag's jitter and glitch, the dots)
    const st = document.createElement('style');
    st.textContent = '.lss-tag, .lss-tag *, .dot { animation: none !important; }';
    (document.head || document.documentElement).appendChild(st);
  }
  if (F.fps) {
    // every animation loop on the page runs at most F.fps times a second
    const raf = window.requestAnimationFrame.bind(window);
    const gap = 1000 / F.fps - 2;
    let last = 0, queue = [];
    const pump = (t) => {
      if (t - last < gap) { raf(pump); return; }
      last = t;
      const q = queue; queue = [];
      q.forEach(f => { try { f(t); } catch (e) {} });
    };
    window.requestAnimationFrame = (cb) => { queue.push(cb); if (queue.length === 1) raf(pump); return queue.length; };
  }
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) P.long.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  const tick = () => { P.frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  P.stats = () => {
    const c = P.ctx, s = c && (c.playoutStats || c.playbackStats);
    if (!s) return null;
    // WebView 155 names them underrun* (seconds); the spec's playoutStats uses fallbackFrames* (ms)
    if (s.underrunEvents != null) return { ev: s.underrunEvents, fb: 1000 * s.underrunDuration, total: 1000 * s.totalDuration };
    return { ev: s.fallbackFramesEvents, fb: s.fallbackFramesDuration, total: s.totalFramesDuration };
  };
  P.measure = async (sec) => {
    const c = P.ctx;
    const s0 = P.stats(), f0 = P.frames, l0 = P.long.length, t0 = performance.now();
    await new Promise(r => setTimeout(r, sec * 1000));
    const s1 = P.stats(), dt = (performance.now() - t0) / 1000;
    const long = P.long.slice(l0);
    return {
      secs: +dt.toFixed(1),
      ctx: c ? c.state : 'none',
      fps: +((P.frames - f0) / dt).toFixed(1),
      longTasks: long.length,
      longestMs: long.reduce((m, x) => Math.max(m, x[1]), 0),
      glitchEvents: s0 && s1 ? s1.ev - s0.ev : 'n/a',
      glitchMs: s0 && s1 ? +(s1.fb - s0.fb).toFixed(1) : 'n/a',
      audioMs: s0 && s1 ? Math.round(s1.total - s0.total) : 'n/a'
    };
  };
})();
