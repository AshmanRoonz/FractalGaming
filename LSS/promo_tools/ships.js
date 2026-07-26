// Per-ship action capture: solo match, third person, thrust + fire + ability choreography.
// usage: node ships.js SHIPKEY [frames] [mapOffset]
const { launch, waitGameMs, captureFrames } = require('./lib');
const path = require('path');

const SHIP = process.argv[2] || 'VORTEX';
const FRAMES = parseInt(process.argv[3] || '210', 10);   // 7s @30fps
const MAP_OFFSET = parseInt(process.argv[4] || '0', 10);
const OUT = path.join(__dirname, 'ship_frames', SHIP);

(async () => {
  const t0 = Date.now();
  const log = (s) => console.log(`[${SHIP} ${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const { browser, page } = await launch({ quality: 'medium', width: 960, height: 540 });
  await page.waitForFunction(() => window.LSS_BUILD && window.__real_startSolo, { timeout: 180000 });
  log('booted');
  await waitGameMs(page, 1500);
  await page.evaluate(() => window.__real_startSolo());
  await waitGameMs(page, 800);
  await page.evaluate((ship) => {
    const chip = Array.from(document.querySelectorAll('.ship-chip')).find(c => c.dataset.key === ship);
    if (chip) chip.click();
  }, SHIP);
  await waitGameMs(page, 500);
  for (let i = 0; i < MAP_OFFSET; i++) {
    await page.evaluate(() => { const b = document.getElementById('map-next'); if (b) b.click(); });
    await waitGameMs(page, 200);
  }
  await page.evaluate(() => document.getElementById('ship-preview-confirm').click());
  log('confirmed');

  // wait until ship-select hides (in game)
  for (let i = 0; i < 160; i++) {
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
  log('in game; waiting out warmup');
  await waitGameMs(page, 4500);   // warmup + spawn shield drop

  await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) c.focus(); });
  await page.keyboard.press('v');            // third person
  await waitGameMs(page, 300);
  await page.keyboard.down('w');             // thrust
  await page.mouse.move(480, 270);
  await waitGameMs(page, 800);
  log('capturing ' + FRAMES);

  const kb = page.keyboard, ms = page.mouse;
  const onFrame = async (i) => {
    switch (i) {
      case 20:  await ms.down(); break;                     // open fire
      case 55:  await ms.move(560, 250, { steps: 4 }); break;
      case 80:  await kb.press('q'); break;                 // offensive ability
      case 100: await ms.move(420, 285, { steps: 4 }); break;
      case 110: await ms.up(); break;
      case 120: await kb.press('Shift'); break;             // dash
      case 140: await ms.down(); break;                     // fire again
      case 165: await kb.press('e'); break;                 // defensive ability
      case 185: await ms.move(500, 260, { steps: 4 }); break;
    }
  };
  await captureFrames(page, OUT, { frames: FRAMES, dtMs: 33.333, quality: 92, onFrame });
  await ms.up().catch(() => {});
  await kb.up('w').catch(() => {});
  log('done');
  await browser.close();
})();
