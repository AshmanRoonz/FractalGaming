// Shared capture harness for LSS headless filming
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCRATCH = __dirname;
const THREE_DIR = path.join(SCRATCH, 'node_modules/three');

const VT_INIT = `
(() => {
  if (window.__vt) return;
  const vt = { t: 1000, cbs: new Map(), nextId: 1, auto: null };
  window.__vt = vt;
  window.requestAnimationFrame = (cb) => { const id = vt.nextId++; vt.cbs.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { vt.cbs.delete(id); };
  const realNow = performance.now.bind(performance);
  performance.now = () => vt.t;
  const D0 = Date.now();
  const RealDate = Date;
  // keep Date.now roughly aligned to virtual clock (some code stamps ids/timers with it)
  Date.now = () => D0 + Math.floor(vt.t);
  window.__step = (dtMs) => {
    vt.t += dtMs;
    const cbs = Array.from(vt.cbs.entries());
    vt.cbs.clear();
    for (const [id, cb] of cbs) { try { cb(vt.t); } catch (e) { console.error('rafcb', e); } }
  };
  // background pumper for boot/menus (real cadence, virtual dt)
  window.__autopump = (on, dt) => {
    if (vt.auto) { clearInterval(vt.auto); vt.auto = null; }
    if (on) vt.auto = setInterval(() => window.__step(dt || 16.667), 5);
  };
})();
`;

async function launch(opts = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const W = opts.width || 1280, H = opts.height || 720;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 160)));
  if (opts.log) page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 160)); });

  await page.route('https://cdn.jsdelivr.net/**', async route => {
    const url = route.request().url();
    const m = url.match(/three@0\.165\.0\/(.+?)(\?.*)?$/);
    if (m) {
      const fp = path.join(THREE_DIR, m[1]);
      if (fs.existsSync(fp)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(fp) });
      }
    }
    return route.abort();
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://esm.sh/**', r => r.abort());
  await page.route(/https:\/\/((ptb|canary)?\.?discord|.*discordapp)\.com\/.*/, r => r.abort());

  if (!opts.realtime) await page.addInitScript(VT_INIT);
  const quality = opts.quality || 'medium';
  await page.addInitScript(`try { localStorage.setItem('lss_quality', '${quality}'); localStorage.setItem('lss_touch_enabled', '0'); } catch(e) {}`);
  await page.goto('http://localhost:8777/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!opts.realtime) await page.evaluate(() => window.__autopump(true, 33.334));
  return { browser, page };
}

// wait in *virtual* game time while autopump runs (poll real time)
async function waitGameMs(page, ms, label) {
  const t0 = await page.evaluate(() => window.__vt.t);
  const r0 = Date.now();
  let lastLog = r0;
  while (true) {
    await new Promise(r => setTimeout(r, 150));
    const t = await page.evaluate(() => window.__vt.t);
    if (t - t0 >= ms) return;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(`[wait${label ? ' ' + label : ''}] game ${(t - t0).toFixed(0)}/${ms}ms, real ${((Date.now() - r0) / 1000).toFixed(0)}s, speed x${((t - t0) / (Date.now() - r0)).toFixed(2)}`);
    }
  }
}

// capture N frames at fixed dt via compositor screenshots (includes DOM HUD).
// opts.onFrame(i) runs before each step — schedule input there.
async function captureFrames(page, outDir, opts = {}) {
  const { frames = 90, dtMs = 33.333, prefix = 'f', quality = 90, startIndex = 0, onFrame = null, log = 30 } = opts;
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => window.__autopump(false));
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    if (onFrame) await onFrame(i);
    await page.evaluate((dt) => window.__step(dt), dtMs);
    const buf = await page.screenshot({ type: 'jpeg', quality });
    fs.writeFileSync(path.join(outDir, `${prefix}${String(startIndex + i).padStart(4, '0')}.jpg`), buf);
    if (log && i % log === 0) console.log(`  frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await page.evaluate(() => window.__autopump(true));
  return frames;
}

module.exports = { launch, waitGameMs, captureFrames, SCRATCH };
