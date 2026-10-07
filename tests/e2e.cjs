// End-to-end tests: serves the repo and drives the app in a phone-sized Chromium.
// Run with `npm test`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---------- fixtures ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return keyOf(d); };
const COLORS = ['mint', 'orange', 'pink', 'purple', 'blue', 'yellow'];

function makeState({ names = ['A', 'B', 'C', 'D'], days = {}, ...rest } = {}) {
  const habits = names.map((name, i) => ({ id: `h${i + 1}`, name, color: COLORS[i % COLORS.length] }));
  return { habits, days, session: null, sample: false, onboarded: true, welcomed: true, ...rest };
}
// A finished past day: `done` is a list of habit indexes (0-based).
function pastDay(total, doneIdx, seconds = 6.5) {
  const all = Array.from({ length: total }, (_, i) => `h${i + 1}`);
  const done = doneIdx.map((i) => all[i]);
  return { done, skipped: all.filter((id) => !done.includes(id)), seconds, total, finished: true, complete: done.length === total };
}

// ---------- harness ----------
let browser, server, base;
const errors = [];
const results = [];

async function open({ state, width = 390, height = 844, scheme = 'light', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (state) {
    await ctx.addInitScript((json) => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem('speedtask.v1', json); sessionStorage.setItem('seeded', '1'); }
    }, JSON.stringify(state));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${hash}`);
  await page.waitForTimeout(250);
  return page;
}
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('speedtask.v1')));
async function press(page, ...keys) { for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(120); } await page.waitForTimeout(250); }

async function test(name, fn) {
  const before = errors.length;
  try {
    await fn();
    assert.equal(errors.length, before, `page errors: ${errors.slice(before).join(' | ')}`);
    results.push([true, name]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

// ---------- tests ----------
async function run() {
  await test('right = done, left = missed; finish shows the achievement rate', async () => {
    const page = await open({ state: makeState() });
    assert.equal(await text(page, '#count'), 'あと4枚');
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight');
    assert.ok(await page.isVisible('#done'));
    assert.equal(await text(page, '#donePct'), '75%');
    assert.equal(await text(page, '#doneLine'), '4つ中3つ、できた。');
    assert.equal(await text(page, '#retryBtn'), 'できなかった1つをやり直す');
    const s = await stored(page);
    const d = s.days[dayKey(0)];
    assert.deepEqual([d.done.length, d.skipped.length, d.finished, d.complete], [3, 1, true, false]);
  });

  await test('dragging the top card swipes it', async () => {
    const page = await open({ state: makeState() });
    const box = await page.locator('.card.top').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x - 25 * i, y);
    await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal(await text(page, '#count'), 'あと3枚');
    assert.equal((await stored(page)).days[dayKey(0)].skipped[0], 'h1');
  });

  await test('a short drag springs back without recording', async () => {
    const page = await open({ state: makeState() });
    const box = await page.locator('.card.top').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 4; i++) { await page.mouse.move(x + 5 * i, y); await page.waitForTimeout(40); }
    await page.mouse.up(); await page.waitForTimeout(450);
    assert.equal(await text(page, '#count'), 'あと4枚');
  });

  await test('undo from the snackbar puts the card back', async () => {
    const page = await open({ state: makeState() });
    await press(page, 'ArrowRight');
    assert.ok(await page.isVisible('#snack.show'));
    await page.click('#snackAct'); await page.waitForTimeout(300);
    assert.equal(await text(page, '#count'), 'あと4枚');
    assert.equal((await stored(page)).days[dayKey(0)].done.length, 0);
  });

  await test('redoing misses can reach 100% and keeps the streak', async () => {
    const page = await open({ state: makeState() });
    await press(page, 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowRight');
    const streak = await text(page, '#streakNum');
    await page.click('#retryBtn'); await page.waitForTimeout(300);
    assert.equal(await text(page, '#count'), 'あと1枚');
    assert.equal(await text(page, '#streakNum'), streak, 'streak dropped while redoing');
    await press(page, 'ArrowRight');
    assert.equal(await text(page, '#donePct'), '100%');
    assert.equal(await text(page, '#doneLine'), '全部できた。');
  });

  await test('streak counts finished days; misses do not break it', async () => {
    const days = { [dayKey(-1)]: pastDay(4, [0]), [dayKey(-2)]: pastDay(4, [0, 1, 2, 3]), [dayKey(-4)]: pastDay(4, [0, 1, 2, 3]) };
    const page = await open({ state: makeState({ days }) });
    assert.equal(await text(page, '#streakNum'), '2');
    await press(page, 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
    assert.equal(await text(page, '#streakNum'), '3');
    assert.equal(await text(page, '#donePct'), '0%');
  });

  await test('records: filling a forgotten day reconnects the streak', async () => {
    const days = { [dayKey(-1)]: pastDay(4, [0, 1, 2, 3]), [dayKey(-3)]: pastDay(4, [0, 1, 2, 3]) };
    const page = await open({ state: makeState({ days }), hash: '#records' });
    assert.equal(await text(page, '#statStreak'), '1日');
    const target = dayKey(-2);
    if (!(await page.locator(`[data-day="${target}"]`).count())) await page.click('#prevMonth');
    await page.click(`[data-day="${target}"]`);
    assert.equal(await text(page, '#detailMeta'), '記録なし');
    await page.click('#detailRows [data-habit="h1"]');
    assert.equal(await text(page, '#detailMeta'), '1/4');
    assert.equal(await text(page, '#statStreak'), '3日');
  });

  await test('records: tapping today cycles まだ → やった → できなかった', async () => {
    const page = await open({ state: makeState(), hash: '#records' });
    const row = '#detailRows [data-habit="h2"] .state';
    assert.equal(await text(page, row), 'まだ');
    await page.click('#detailRows [data-habit="h2"]');
    assert.equal(await text(page, row), 'やった');
    await page.click('#detailRows [data-habit="h2"]');
    assert.equal(await text(page, row), 'できなかった');
    await page.click('#detailRows [data-habit="h2"]');
    assert.equal(await text(page, row), 'まだ');
  });

  await test('settings: add, rename, recolor and delete a habit', async () => {
    const page = await open({ state: makeState(), hash: '#settings' });
    await page.fill('#addInput', '水を1杯のむ');
    await page.press('#addInput', 'Enter');
    assert.equal(await page.locator('.edit-row').count(), 5);
    await page.fill('#habit-h1', 'ランニング');
    await page.press('#habit-h1', 'Enter');
    await page.click('.edit-row[data-id="h1"] [data-act="color"]');
    const del = page.locator('.edit-row[data-id="h2"] [data-act="del"]');
    await del.click();
    assert.equal(await del.textContent(), '削除');
    await del.click();
    const s = await stored(page);
    assert.deepEqual(s.habits.map((h) => h.name), ['ランニング', 'C', 'D', '水を1杯のむ']);
    assert.equal(s.habits[0].color, 'orange');
    await page.click('.back[data-go="records"]');
    await page.click('.back[data-go="today"]');
    assert.equal(await text(page, '#count'), 'あと4枚');
  });

  await test('progress survives a reload', async () => {
    const page = await open({ state: makeState() });
    await press(page, 'ArrowRight', 'ArrowLeft');
    await page.reload(); await page.waitForTimeout(250);
    assert.equal(await text(page, '#count'), 'あと2枚');
  });

  await test('a new day starts a fresh stack and keeps yesterday', async () => {
    const y = dayKey(-1);
    const state = makeState({ days: { [y]: { done: ['h1'], skipped: [], seconds: null, total: 4, finished: false, complete: false } } });
    state.session = { date: y, queue: ['h2', 'h3', 'h4'], history: [{ type: 'done', id: 'h1' }], startedAt: Date.now() - 86400000, finishedAt: null };
    const page = await open({ state });
    assert.equal(await text(page, '#count'), 'あと4枚');
    const s = await stored(page);
    assert.deepEqual(s.days[y].done, ['h1']);
  });

  await test('no horizontal overflow on a small phone, light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      for (const hash of ['', '#records', '#settings']) {
        const page = await open({ state: makeState({ names: ['とても長い習慣の名前をここに入れてみるテスト', 'B'] }), width: 360, height: 640, scheme, hash });
        const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(over, false, `overflow on ${scheme} ${hash || '#today'}`);
      }
    }
  });
}

(async () => {
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  console.log('SpeedTask e2e');
  try { await run(); } finally { await browser.close(); server.close(); }
  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
