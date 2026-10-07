// Play Store phone screenshots (1080x1920) from the sample data. Run with `npm run screenshots`.
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store', 'screenshots');
const TYPES = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };

(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const snap = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, name) }); };
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto(base);
  await snap('1-welcome.png');
  await page.click('#demoBtn');
  await snap('2-home.png');
  await page.click('.hero-start');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  // Mid-swipe, to show the gesture.
  const box = await page.locator('.card.top').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + 13 * i, y + 2 * i);
  await snap('3-swipe.png');
  await page.mouse.move(x + 220, y + 12); await page.mouse.up();
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowRight']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
  await page.waitForTimeout(4500); // let the undo bar fade
  await snap('4-finish.png');
  await page.click('#view-today [data-go="home"]');
  await page.click('#view-home [data-go="records"]');
  await snap('5-records.png');

  await browser.close();
  srv.close();
  console.log('screenshots written to store/screenshots');
})();
