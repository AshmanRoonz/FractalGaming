// Capture the menu attract scene (hero ship flying terrain) — scenic promo footage
const { launch, waitGameMs, captureFrames } = require('./lib');
const path = require('path');

const FRAMES = parseInt(process.argv[2] || '180', 10);

(async () => {
  const t0 = Date.now();
  const { browser, page } = await launch({ quality: 'high', width: 1280, height: 720 });
  await page.waitForFunction(() => window.LSS_BUILD && window.__real_startSolo, { timeout: 180000 });
  console.log('booted', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await waitGameMs(page, 2500);
  // hide the menu UI so the attract scene is clean
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body > div, body > header, body > section')) {
      const canvasInside = el.querySelector && el.querySelector('canvas');
      if (!canvasInside) el.style.opacity = '0';
    }
  });
  await waitGameMs(page, 400);
  const n = await captureFrames(page, path.join(__dirname, 'promo_segments', 'attract'), { frames: FRAMES, dtMs: 33.333, quality: 92 });
  console.log('attract frames', n);
  await browser.close();
})();
