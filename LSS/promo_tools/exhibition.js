// Scenic Exhibition (freeflight overworld) capture for the promo
const { launch, waitGameMs, captureFrames } = require('./lib');
const path = require('path');

const FRAMES = parseInt(process.argv[2] || '240', 10);
const SHIP = process.argv[3] || 'TRACKER';

(async () => {
  const t0 = Date.now();
  const log = (s) => console.log(`[exh ${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const { browser, page } = await launch({ quality: 'medium', width: 1280, height: 720 });
  await page.waitForFunction(() => window.LSS_BUILD && typeof window.startFreeFlight === 'function', { timeout: 180000 });
  log('booted');
  await waitGameMs(page, 1500);
  await page.evaluate(() => window.startFreeFlight());
  await waitGameMs(page, 1000);
  // ship select may appear
  const hasSelect = await page.evaluate(() => {
    const c = document.querySelector('.ship-chip');
    return !!(c && c.offsetParent);
  });
  if (hasSelect) {
    await page.evaluate((ship) => {
      const chip = Array.from(document.querySelectorAll('.ship-chip')).find(c => c.dataset.key === ship);
      if (chip) chip.click();
    }, SHIP);
    await waitGameMs(page, 500);
    await page.evaluate(() => { const b = document.getElementById('ship-preview-confirm'); if (b) b.click(); });
  }
  log('launched, waiting for world');
  for (let i = 0; i < 200; i++) {
    await waitGameMs(page, 500);
    const inGame = await page.evaluate(() => {
      const cd = document.getElementById('ship-select-countdown');
      const sel = document.getElementById('ship-select-overlay') || document.getElementById('ship-select');
      const cdV = cd ? getComputedStyle(cd).display : 'none';
      const selV = sel ? getComputedStyle(sel).display : 'none';
      return cdV === 'none' && selV === 'none';
    });
    if (inGame) break;
  }
  log('in world');
  await waitGameMs(page, 3000);
  await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.focus(); });
  await page.keyboard.press('v');
  await waitGameMs(page, 300);
  await page.keyboard.down('w');
  await page.mouse.move(640, 380);
  await waitGameMs(page, 600);
  log('capturing');
  const ms = page.mouse;
  const onFrame = async (i) => {
    if (i === 60) await ms.move(700, 350, { steps: 6 });
    if (i === 130) await ms.move(580, 360, { steps: 6 });
    if (i === 190) await ms.move(640, 340, { steps: 6 });
  };
  await captureFrames(page, path.join(__dirname, 'promo_segments', 'overworld'), { frames: FRAMES, dtMs: 33.333, quality: 92, onFrame });
  log('done');
  await page.screenshot({ path: path.join(__dirname, 'promo_segments', 'overworld_end.png') });
  await browser.close();
})();
