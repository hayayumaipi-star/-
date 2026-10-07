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

async function open({ state, width = 390, height = 844, scheme = 'light', hash = '', init, permissions = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, serviceWorkers: 'block', acceptDownloads: true, permissions });
  if (init) await ctx.addInitScript(init);
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
  await test('first run: pick habits, add your own, and start', async () => {
    const page = await open();
    assert.ok(await page.isVisible('#view-welcome'));
    assert.ok(await page.isDisabled('#startBtn'));
    await page.click('.chip[data-name="ストレッチ"]');
    await page.click('.chip[data-name="水を1杯のむ"]');
    await page.fill('#welcomeInput', 'ギターを5分');
    await page.press('#welcomeInput', 'Enter');
    await page.click('.chip[data-name="ストレッチ"]');
    await page.click('.chip[data-name="ストレッチ"]');
    assert.equal(await text(page, '#startBtn'), '3つではじめる');
    await page.click('#startBtn'); await page.waitForTimeout(300);
    assert.ok(await page.isVisible('#view-today'));
    assert.equal(await text(page, '#count'), 'あと3枚');
    assert.ok(await page.isVisible('#hint'));
    const s = await stored(page);
    assert.deepEqual(s.habits.map((h) => h.name), ['水を1杯のむ', 'ギターを5分', 'ストレッチ']);
    assert.equal(s.sample, false);
    await page.reload(); await page.waitForTimeout(250);
    assert.ok(await page.isVisible('#view-today'), 'welcome shown again after starting');
  });

  await test('first run: try it with sample records', async () => {
    const page = await open();
    await page.click('#demoBtn'); await page.waitForTimeout(300);
    assert.equal(await text(page, '#count'), 'あと5枚');
    assert.equal(await text(page, '#streakNum'), '2');
    assert.equal((await stored(page)).sample, true);
  });

  await test('older saves skip the welcome screen', async () => {
    const state = makeState();
    delete state.welcomed;
    const page = await open({ state });
    assert.ok(await page.isVisible('#view-today'));
  });

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

  // A session where h1 was swiped `agoMs` ago, after `activeMs` of swiping.
  function midSession(agoMs, activeMs) {
    const t = dayKey(0), now = Date.now();
    const state = makeState({ days: { [t]: { done: ['h1'], skipped: [], seconds: null, total: 4, finished: false, complete: false } } });
    state.session = { date: t, queue: ['h2', 'h3', 'h4'], history: [{ type: 'done', id: 'h1', ms: activeMs, prevLastAt: null }],
      startedAt: now - agoMs - activeMs, finishedAt: null, activeMs, lastAt: now - agoMs };
    return state;
  }

  await test('time away between swipes is not counted', async () => {
    const page = await open({ state: midSession(5 * 60 * 1000, 3000) });
    assert.equal(await page.getAttribute('#clock', 'data-mode'), 'paused');
    assert.equal(await text(page, '#clock'), '3.00秒');
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowRight');
    const secs = (await stored(page)).days[dayKey(0)].seconds;
    assert.ok(secs >= 3 && secs < 5, `expected about 3s, got ${secs}`);
  });

  await test('time within a sitting is counted, and undo takes it back', async () => {
    const page = await open({ state: midSession(10 * 1000, 2000) });
    assert.equal(await page.getAttribute('#clock', 'data-mode'), 'running');
    await press(page, 'ArrowRight');
    const active = (await stored(page)).session.activeMs;
    assert.ok(active >= 12000 && active < 14000, `expected about 12s, got ${active}`);
    await page.click('#snackAct'); await page.waitForTimeout(200);
    assert.equal((await stored(page)).session.activeMs, 2000);
  });

  const wd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getDay(); };

  await test('schedules: a habit not due today stays off the stack', async () => {
    const state = makeState();
    state.habits[1].days = [wd(1)];
    const page = await open({ state });
    assert.equal(await text(page, '#count'), 'あと3枚');
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowRight');
    assert.equal(await text(page, '#donePct'), '100%');
    assert.equal((await stored(page)).days[dayKey(0)].total, 3);
  });

  await test('schedules: a rest day shows no cards and keeps the streak', async () => {
    const state = makeState({ days: { [dayKey(-6)]: pastDay(4, [0, 1, 2, 3]) } });
    state.habits.forEach((h) => { h.days = [wd(1)]; });
    const page = await open({ state });
    assert.ok(await page.isVisible('#rest'));
    assert.equal(await text(page, '#restNext'), '明日は4つ');
    assert.equal(await page.locator('.card').count(), 0);
    assert.ok(await page.isHidden('#clock'));
    assert.equal(await text(page, '#streakNum'), '1');
  });

  await test('schedules: pick weekdays in settings', async () => {
    const page = await open({ state: makeState(), hash: '#settings' });
    const row = '.edit-row[data-id="h1"]';
    assert.equal(await text(page, `${row} .sched`), '毎日');
    await page.click(`${row} .sched`);
    await page.click(`${row} [data-act="day"][data-day="${wd(0)}"]`);
    const s = await stored(page);
    assert.equal(s.habits[0].days.length, 6);
    assert.ok(!s.habits[0].days.includes(wd(0)));
    for (const d of [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== wd(0))) await page.click(`${row} [data-act="day"][data-day="${d}"]`);
    assert.equal((await stored(page)).habits[0].days.length, 1, 'the last day can be removed');
    assert.equal(await text(page, '#snackText'), '少なくとも1日は選んでください');
    await page.click('.back[data-go="records"]');
    await page.click('.back[data-go="today"]');
    assert.equal(await text(page, '#count'), 'あと3枚');
  });

  await test('schedules: rates only count the days a habit was due', async () => {
    const state = makeState({ names: ['A', 'B'], days: {
      [dayKey(-1)]: pastDay(2, [0, 1]),
      [dayKey(-2)]: { done: ['h1'], skipped: [], seconds: 4, total: 1, finished: true, complete: true },
    } });
    state.habits[1].days = [wd(-1)];
    const page = await open({ state, hash: '#records' });
    assert.equal(await text(page, '#statRate'), '100%');
    assert.deepEqual(await page.$$eval('#habitStats .pct', (els) => els.map((e) => e.textContent)), ['100%', '100%']);
    await page.click(`[data-day="${dayKey(-2)}"]`).catch(async () => { await page.click('#prevMonth'); await page.click(`[data-day="${dayKey(-2)}"]`); });
    assert.equal(await page.locator('#detailRows .row').count(), 1);
  });

  await test('backup: export, then restore it on a fresh device', async () => {
    const days = { [dayKey(-1)]: pastDay(4, [0, 1]) };
    const page = await open({ state: makeState({ days }), hash: '#settings' });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    assert.equal(download.suggestedFilename(), `speedtask-${dayKey(0)}.json`);
    const json = fs.readFileSync(await download.path(), 'utf8');
    const data = JSON.parse(json);
    assert.equal(data.app, 'SpeedTask');
    assert.deepEqual(data.state.habits.map((h) => h.name), ['A', 'B', 'C', 'D']);

    const fresh = await open({ state: makeState({ names: ['X'] }), hash: '#settings' });
    await fresh.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await fresh.waitForTimeout(200);
    assert.equal(await text(fresh, '#importBtn'), '4つの習慣・1日分で置き換える（もう一度タップ）');
    assert.equal((await stored(fresh)).habits.length, 1, 'replaced before confirming');
    await fresh.click('#importBtn');
    const s = await stored(fresh);
    assert.deepEqual(s.habits.map((h) => h.name), ['A', 'B', 'C', 'D']);
    assert.deepEqual(s.days[dayKey(-1)].done, ['h1', 'h2']);
    assert.equal(await text(fresh, '#snackText'), 'バックアップから戻しました');
  });

  await test('backup: a file that is not a backup is rejected', async () => {
    const page = await open({ state: makeState(), hash: '#settings' });
    await page.setInputFiles('#importFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await page.waitForTimeout(200);
    assert.equal(await text(page, '#snackText'), '読み込めませんでした。SpeedTaskのバックアップを選んでください');
    assert.equal(await text(page, '#importBtn'), 'バックアップから戻す');
    assert.equal((await stored(page)).habits.length, 4);
  });

  await test('share: sends an image and text through the share sheet', async () => {
    const init = () => {
      navigator.canShare = (d) => !!(d && d.files);
      navigator.share = async (d) => { window.__shared = { text: d.text, files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) }; };
    };
    const page = await open({ state: makeState({ days: { [dayKey(-1)]: pastDay(4, [0]) } }), init });
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight');
    await page.waitForTimeout(800);
    await page.click('#shareBtn'); await page.waitForTimeout(200);
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.text, '今日の習慣、4つ中3つできた（75%）。🔥2日連続 #SpeedTask');
    assert.equal(shared.files.length, 1);
    assert.equal(shared.files[0].type, 'image/png');
    assert.ok(shared.files[0].size > 10000, `image too small: ${shared.files[0].size}`);
  });

  await test('share: copies the result where there is no share sheet', async () => {
    const page = await open({ state: makeState(), permissions: ['clipboard-read', 'clipboard-write'] });
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight');
    await page.click('#shareBtn'); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '今日の習慣、4つ全部できた（100%）。🔥1日連続 #SpeedTask');
    assert.equal(await text(page, '#snackText'), '結果をコピーしました');
  });

  await test('inside the Claude viewer, backup and share go through its downloads capability', async () => {
    const init = () => {
      window.__saved = [];
      window.claude = { use: async (name) => (name === 'downloads' ? Object.freeze({
        save: async ({ filename, data }) => { window.__saved.push({ filename, size: typeof data === 'string' ? data.length : data.size }); return { status: 'saved' }; },
      }) : null) };
    };
    const page = await open({ state: makeState(), init, permissions: ['clipboard-read', 'clipboard-write'] });
    await press(page, 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft');
    await page.click('#shareBtn'); await page.waitForTimeout(600);
    await page.click('[data-go="records"]'); await page.click('.link[data-go="settings"]');
    await page.click('#exportBtn'); await page.waitForTimeout(200);
    const saved = await page.evaluate(() => window.__saved);
    assert.deepEqual(saved.map((x) => x.filename), [`speedtask-${dayKey(0)}.png`, `speedtask-${dayKey(0)}.json`]);
    assert.ok(saved.every((x) => x.size > 100));
    assert.equal(await text(page, '#snackText'), 'バックアップを書き出しました');
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
