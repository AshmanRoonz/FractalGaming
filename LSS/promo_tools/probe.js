const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCRATCH = __dirname;
const THREE_DIR = path.join(SCRATCH, 'node_modules/three');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--mute-audio',
      '--window-size=1280,720',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));

  // Serve three.js locally in place of the blocked CDN
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    const url = route.request().url();
    const m = url.match(/three@0\.165\.0\/(.+?)(\?.*)?$/);
    if (m) {
      const fp = path.join(THREE_DIR, m[1]);
      if (fs.existsSync(fp)) {
        const ct = fp.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
        return route.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(fp) });
      }
    }
    return route.abort();
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://esm.sh/**', r => r.abort());
  await page.route(/https:\/\/(discord|.*discordapp)\.com\/.*/, r => r.abort());

  await page.goto('http://localhost:8777/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(25000);

  const state = await page.evaluate(() => ({
    build: window.LSS_BUILD || null,
    hasRenderer: typeof window.renderer !== 'undefined',
    showcase: typeof window.showcase !== 'undefined' ? !!(window.showcase && window.showcase.active) : null,
    webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return String(e); } })(),
  })).catch(e => ({ evalError: String(e) }));

  await page.screenshot({ path: path.join(SCRATCH, 'probe_menu.png') });
  console.log(JSON.stringify(state));
  console.log('ERRORS(' + errors.length + '):');
  [...new Set(errors)].slice(0, 12).forEach(e => console.log('  ' + e));
  await browser.close();
})();
