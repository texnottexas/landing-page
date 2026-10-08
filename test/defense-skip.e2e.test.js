'use strict';
// Alliance Defense Skipper in a real browser against the fake game (test/fixtures/mapc/index.html), whose siege
// opens a wave's window, marches the boss on a skip (or when the timer runs out) and resolves the wave 0.5 s later.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/defense-skip.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['defense-skip-bookmarklet.js'];
const MARCHING = 2147483647;

let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

// The fake game with a siege at `round`, its window open (or the boss marching), then the tool launched.
async function open(setup, arg) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(() => { __fake.siege = { round: 12, nextTime: 0, winTimes: 12, loseTimes: 0, isEnd: 0, maxRound: 80 }; __fake.openWindow(); });
  if (setup) await page.evaluate(setup, arg);
  await page.addScriptTag({ url: base + 'defense-skip-bookmarklet.js' });
  return { ctx, page };
}
async function startTo(page, target) {
  await page.fill('#ads-target', String(target));
  await page.click('#ads-start');
}
const skips = (page) => page.evaluate(() => __fake.sent.filter((x) => x.rid === 3700));
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 10000 });

test('no panel and no boss click: it skips each wave as its window opens, the exact request, once per wave, to the target', async () => {
  const { ctx, page } = await open();
  const pos = await page.$eval('#ads-root', (e) => ({ parent: e.parentNode === document.body, pos: getComputedStyle(e).position, z: Number(getComputedStyle(e).zIndex) }));
  assert.deepEqual([pos.parent, pos.pos], [true, 'fixed']);
  assert.ok(pos.z >= 1000);
  await waitText(page, '#ads-root', /Wave 12/);
  await startTo(page, 15);
  await waitText(page, '#ads-why', /Reached wave 15/, 15000);
  const s = await skips(page);
  assert.equal(s.length, 3);
  s.forEach((x) => assert.deepEqual(x.p, { header: {}, alMonsterSiegeSkipWait: {} }));
  const opens = await page.evaluate(() => __fake.opens);
  [12, 13, 14].forEach((r, i) => {
    const lag = s[i].at - opens[r];
    assert.ok(lag >= 150 && lag < 2000, 'wave ' + r + ' skipped ' + lag + ' ms after it opened');
  });
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 1100, 'Ops clock gap');
  assert.match(await page.textContent('#ads-root'), /Skipped 3 waves, wave 12 to 15/);
  await ctx.close();
});

test('never sends while the boss is marching; skips once the next window opens', async () => {
  const { ctx, page } = await open(() => { __fake.siege.nextTime = 2147483647; });
  await startTo(page, 14);
  await page.waitForTimeout(2500);
  assert.equal((await skips(page)).length, 0);
  await waitText(page, '#ads-status', /attacking/);
  await page.evaluate(() => __fake.openWindow());
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 3700), null, { timeout: 5000 });
  assert.equal((await skips(page)).length, 1);
  await ctx.close();
});

test('another officer skipping first means nothing is sent for that wave', async () => {
  const { ctx, page } = await open(() => { window.__ADS_JITTER = [1500, 1501]; });
  await startTo(page, 20);
  await page.waitForTimeout(300);
  await page.evaluate((m) => { __fake.siege.nextTime = m; __fake.emit('ACTIVITY_STATE_UPDATE', {}); }, MARCHING);   // their skip landed first
  await page.waitForTimeout(2500);
  assert.equal((await skips(page)).length, 0);
  await ctx.close();
});

test('a lost wave stops skipping', async () => {
  const { ctx, page } = await open(() => { __fake.loseAt = 13; });
  await startTo(page, 30);
  await waitText(page, '#ads-why', /A wave was lost/, 15000);
  assert.deepEqual((await skips(page)).length, 2);
  await page.waitForTimeout(2500);
  assert.deepEqual((await skips(page)).length, 2, 'nothing more after the stop');
  await ctx.close();
});

test('three refusals in a row stop it, one try per wave', async () => {
  const { ctx, page } = await open(() => { __fake.refuseSkip = true; __fake.waitSec = 4; __fake.openWindow(); });
  await startTo(page, 30);
  await waitText(page, '#ads-why', /refused 3 skips in a row/, 25000);
  const s = await skips(page);
  assert.equal(s.length, 3);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 3000, 'one try per wave');
  await ctx.close();
});

test('Stop ends the run and nothing more is sent', async () => {
  const { ctx, page } = await open();
  await startTo(page, 40);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 3700), null, { timeout: 5000 });
  await page.click('#ads-stop');
  await waitText(page, '#ads-why', /Stopped by you/);
  await page.waitForTimeout(2500);
  assert.equal((await skips(page)).length, 1);
  await ctx.close();
});

test('below rank 5, or with no event running, it says so and sends nothing', async () => {
  let r = await open(() => { __fake.rank = 4; });
  await waitText(r.page, '#ads-root', /rank 5/);
  assert.equal(await r.page.$('#ads-start'), null);
  await r.ctx.close();
  r = await open(() => { __fake.siege = null; });
  await waitText(r.page, '#ads-root', /not running/);
  assert.equal((await skips(r.page)).length, 0);
  await r.page.click('#ads-close');
  assert.equal(await r.page.$('#ads-root'), null);
  await r.ctx.close();
});

test('a target at or below the current wave is refused', async () => {
  const { ctx, page } = await open();
  await page.fill('#ads-target', '12');
  await page.click('#ads-start');
  assert.match(await page.getAttribute('#ads-target', 'class'), /bad/);
  assert.equal((await skips(page)).length, 0);
  await ctx.close();
});
