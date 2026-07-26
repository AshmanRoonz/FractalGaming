const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('file://' + path.join(__dirname, 'cards.html'));
  await page.waitForTimeout(1200);
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
    await page.evaluate((id) => {
      document.querySelectorAll('.card').forEach(c => c.classList.remove('show'));
      document.getElementById(id).classList.add('show');
    }, id);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(__dirname, 'cards', id + '.png') });
  }
  await browser.close();
  console.log('cards done');
})();
