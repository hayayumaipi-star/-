// Draws every icon from the one logo: web icons, Android launcher icons and splash screens,
// and the Play Store icon and feature graphic. Run with `npm run icons` after changing the logo.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BG = '#F4F5F3';
// Same drawing as the #i-logo symbol in index.html (viewBox 0 0 120 110).
const LOGO = `<rect x="12" y="24" width="60" height="74" rx="15" fill="#FF9447" transform="rotate(-12 42 61)"/>
<rect x="42" y="14" width="62" height="78" rx="16" fill="#3DDC9F" transform="rotate(9 73 53)"/>
<g transform="rotate(9 73 53)"><path d="M57 53h30M75 40.5 87.5 53 75 65.5" fill="none" stroke="#0C0E0D" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;

// A square canvas with the logo centered at `scale` of its width. shape: 'square' | 'rounded' | 'circle'.
function square(size, { scale = 0.72, bg = BG, shape = 'square' } = {}) {
  const w = size * scale, h = (w * 110) / 120;
  const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? `${size * 0.22}px` : '0';
  return `<div style="width:${size}px;height:${size}px;background:${bg};border-radius:${radius};display:grid;place-items:center;overflow:hidden">
    <svg viewBox="0 0 120 110" width="${w}" height="${h}" style="margin-left:${-size * 0.02}px">${LOGO}</svg></div>`;
}
function splash(w, h) {
  const s = Math.min(w, h) * 0.34;
  return `<div style="width:${w}px;height:${h}px;background:${BG};display:grid;place-items:center">
    <svg viewBox="0 0 120 110" width="${s}" height="${(s * 110) / 120}">${LOGO}</svg></div>`;
}
function featureGraphic() {
  return `<div style="width:1024px;height:500px;background:${BG};display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:'M PLUS Rounded 1c',sans-serif">
    <svg viewBox="0 0 120 110" width="230" height="211">${LOGO}</svg>
    <div><div style="font-size:84px;font-weight:900;color:#141716;line-height:1.1">スワイプ習慣</div>
    <div style="font-size:38px;font-weight:800;color:#6C7470;margin-top:18px;white-space:nowrap">習慣は、スワイプで終わらせる。</div></div></div>`;
}

async function shot(browser, html, w, h, file, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const fonts = [800, 900].map((wt) => `@font-face{font-family:'M PLUS Rounded 1c';font-weight:${wt};src:url(data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, `fonts/mpr-${wt}.woff2`)).toString('base64')})}`).join('');
  await page.setContent(`<html><head><style>${fonts}html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const out = (...p) => path.join(ROOT, ...p);

  // Web
  await shot(browser, square(180), 180, 180, out('apple-touch-icon.png'));
  await shot(browser, square(192), 192, 192, out('icon-192.png'));
  await shot(browser, square(512), 512, 512, out('icon-512.png'));
  await shot(browser, square(512, { scale: 0.56 }), 512, 512, out('icon-maskable-512.png'));

  // Android launcher icons. The adaptive foreground is 108dp with the logo inside the 66dp safe zone.
  const res = out('android/app/src/main/res');
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, d] of Object.entries(densities)) {
    const icon = Math.round(48 * d), fg = Math.round(108 * d);
    await shot(browser, square(icon, { shape: 'rounded', scale: 0.7 }), icon, icon, path.join(res, `mipmap-${name}`, 'ic_launcher.png'), { transparent: true });
    await shot(browser, square(icon, { shape: 'circle', scale: 0.66 }), icon, icon, path.join(res, `mipmap-${name}`, 'ic_launcher_round.png'), { transparent: true });
    await shot(browser, square(fg, { bg: 'transparent', scale: 0.5 }), fg, fg, path.join(res, `mipmap-${name}`, 'ic_launcher_foreground.png'), { transparent: true });
  }
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);

  // Android splash screens, at the sizes the Capacitor template uses.
  const splashes = {
    drawable: [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480],
    'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
  };
  for (const [dir, [w, h]] of Object.entries(splashes)) await shot(browser, splash(w, h), w, h, path.join(res, dir, 'splash.png'));

  // Play Store listing
  await shot(browser, square(512, { scale: 0.7 }), 512, 512, out('store/icon-512.png'));
  await shot(browser, featureGraphic(), 1024, 500, out('store/feature-graphic.png'));

  await browser.close();
  console.log('icons written');
})();
