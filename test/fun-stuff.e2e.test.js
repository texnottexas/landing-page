'use strict';
// Fun Stuff (Emoji sender) in a real browser against the fake game (test/fixtures/mapc/index.html) and a fake
// emoji CDN (catalog.json + images).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/fun-stuff.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['fun-stuff.js', 'fun-stuff-core.js'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const CATALOG = {
  version: 'test',
  packs: [{ id: 23, name: 'Heroes', icon: 'packs/23.png' }, { id: 32, name: 'Critters', icon: 'static/303.png' }],
  emojis: [
    { id: 192, kind: 'static', pack: 23, name: 'Tywin: Cheer up', file: 'static/192.png' },
    { id: 193, kind: 'static', pack: 23, name: 'Hero two', file: 'static/193.png' },
    { id: 303, kind: 'static', pack: 32, name: 'Above the Stars', file: 'static/303.png' },
    { id: 999, kind: 'static', pack: 32, name: 'Retired', file: 'static/999.png' },
    { id: 10005, kind: 'gif', pack: 'gif', name: 'Sara: Cyber Thumbs-Up', file: 'gif/10005.gif', thumb: 'gif-thumb/10005.png' }
  ]
};

let server, base, browser, cdnMode, cdnHits;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    if (name.startsWith('cdn/')) {
      const cors = { 'access-control-allow-origin': '*' };
      if (name === 'cdn/catalog.json') {
        cdnHits++;
        if (cdnMode === 'down') { res.writeHead(503, cors); res.end('down'); return; }
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify(CATALOG)); return;
      }
      res.writeHead(200, Object.assign({ 'content-type': 'image/png' }, cors)); res.end(PNG); return;
    }
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
test.beforeEach(() => { cdnMode = 'ok'; cdnHits = 0; });

async function open(setup, arg) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => { window.__FUN_CDN = b + 'cdn'; }, base);
  await page.addScriptTag({ url: base + 'fun-stuff-core.js' });
  if (setup) await page.evaluate(setup, arg);
  await launch(page);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'fun-stuff.js' });
const sends = (page) => page.evaluate(() => __fake.emoji);
const waitSends = (page, n) => page.waitForFunction((k) => __fake.emoji.length >= k, n, { timeout: 8000 });
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 6000 });
const strip = (s) => s.map((x) => { const o = Object.assign({}, x); delete o.at; return o; });
async function picker(page) {
  await page.waitForSelector('#fun-grid button[data-key]');
}
const tap = (page, key) => page.click('#fun-grid button[data-key="' + key + '"]');
const tab = (page, id) => page.click('#fun-tabs button[data-tab="' + id + '"]');

test('the tile opens straight into the Emoji Sender picker (a fixed screen on <body>), with no menu or Back', async () => {
  const { ctx, page } = await open();
  await waitText(page, '#fun-root .fun-title', /^Emoji Sender$/);
  assert.equal(await page.$('#fun-emoji'), null, 'no one-item menu');
  assert.equal(await page.$('#fun-back'), null, 'nothing to go back to');
  assert.ok(!/Fun Stuff/.test(await page.textContent('#fun-root')));
  const pos = await page.$eval('#fun-root', (e) => ({ parent: e.parentNode === document.body, pos: getComputedStyle(e).position, z: Number(getComputedStyle(e).zIndex) }));
  assert.deepEqual([pos.parent, pos.pos], [true, 'fixed']);
  assert.ok(pos.z >= 1000);
  await picker(page);
  await waitText(page, '#fun-to', /Sending to: World/);
  const tabs = await page.$$eval('#fun-tabs button', (b) => b.map((x) => x.dataset.tab));
  assert.deepEqual(tabs, ['recent', '23', '32', 'gif']);
  const grid = await page.$$eval('#fun-grid button[data-key]', (b) => b.map((x) => x.dataset.key));
  assert.deepEqual(grid, ['static:192', 'static:193'], 'first pack when Recent is empty');
  const img = await page.$eval('#fun-grid button[data-key="static:192"] img', (i) => ({ src: i.getAttribute('src'), lazy: i.loading, alt: i.alt }));
  assert.equal(img.src, base + 'cdn/static/192.png');
  assert.equal(img.lazy, 'lazy');
  assert.equal(img.alt, 'Tywin: Cheer up');
  await ctx.close();
});

test('a static tap with no chat open goes to world: sendEmotionGroup(0, id, "", "")', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await tap(page, 'static:192');
  await waitSends(page, 1);
  assert.deepEqual(strip(await sends(page)), [{ fn: 'emotion', ch: 0, id: 192, uid: '', name: '' }]);
  await waitText(page, '#fun-status', /Sent Tywin: Cheer up to World/);
  await ctx.close();
});

test('the chat is re-read at each tap: alliance (2), then a private chat (1, uid, name), 3 s or more apart', async () => {
  const { ctx, page } = await open(() => { __fake.choice = { _channel: 2, _id: '102_2_2864_1', _name: 'Alliance' }; });
  await picker(page);
  await waitText(page, '#fun-to', /Sending to: Alliance/);
  await tap(page, 'static:192');
  await waitSends(page, 1);
  await page.evaluate(() => { __fake.choice = { _channel: 1, _id: '217160163552', _name: 'Rex' }; });
  await waitText(page, '#fun-to', /Sending to: Rex/, 3000);
  await page.waitForTimeout(3100);
  await tap(page, 'static:193');
  await waitSends(page, 2);
  const s = await sends(page);
  assert.deepEqual(strip(s), [{ fn: 'emotion', ch: 2, id: 192, uid: '102_2_2864_1', name: '' }, { fn: 'emotion', ch: 1, id: 193, uid: '217160163552', name: '' }]);
  assert.ok(s[1].at - s[0].at >= 3000, 'gap ' + (s[1].at - s[0].at));
  await ctx.close();
});

test('a group chat and a temporary private chat get the emoji, addressed like the game\'s own picker', async () => {
  const { ctx, page } = await open(() => { __fake.choice = { _channel: 5, _id: '102_5_994194adfcb944938909c1c8e9f662c9', _name: 'Husky Homies' }; });
  await picker(page);
  await waitText(page, '#fun-to', /Sending to: Husky Homies/);
  await tap(page, 'static:192');
  await waitSends(page, 1);
  await page.evaluate(() => { __fake.choice = { _channel: 202, _id: '7550807444272', _name: 'Tex' }; });
  await waitText(page, '#fun-to', /Sending to: Tex/, 3000);
  await page.waitForTimeout(3100);
  await tap(page, 'static:193');
  await waitSends(page, 2);
  assert.deepEqual(strip(await sends(page)), [
    { fn: 'emotion', ch: 5, id: 192, uid: '102_5_994194adfcb944938909c1c8e9f662c9', name: '' },
    { fn: 'emotion', ch: 202, id: 193, uid: '7550807444272', name: '' }]);
  await ctx.close();
});

test('a private chat with yourself goes to world', async () => {
  const { ctx, page } = await open(() => { __fake.choice = { _channel: 1, _id: __fake.uid, _name: 'Tex' }; });
  await picker(page);
  await waitText(page, '#fun-to', /Sending to: World/);
  await tap(page, 'static:192');
  await waitSends(page, 1);
  assert.equal((await sends(page))[0].ch, 0);
  await ctx.close();
});

test('animated emojis send with sendGIFGroup', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await tab(page, 'gif');
  const src = await page.$eval('#fun-grid button[data-key="gif:10005"] img', (i) => i.getAttribute('src'));
  assert.equal(src, base + 'cdn/gif-thumb/10005.png');
  await tap(page, 'gif:10005');
  await waitSends(page, 1);
  assert.deepEqual(strip(await sends(page)), [{ fn: 'gif', ch: 0, id: 10005, uid: '', name: '' }]);
  await ctx.close();
});

test('below the game level floor, animated emojis are greyed out and never sent', async () => {
  const { ctx, page } = await open(() => { __fake.level = 19; });
  await picker(page);
  await tab(page, 'gif');
  assert.equal(await page.$eval('#fun-grid button[data-key="gif:10005"]', (b) => b.getAttribute('aria-disabled')), 'true');
  await page.$eval('#fun-grid button[data-key="gif:10005"]', (b) => b.click());   // Playwright won't click aria-disabled
  await waitText(page, '#fun-status', /level 20/);
  await page.waitForTimeout(1500);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('rapid taps: only the first goes out inside 3 s, with a countdown', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await tap(page, 'static:192');
  await tap(page, 'static:193');
  await waitSends(page, 1);
  await tap(page, 'static:193');
  await waitText(page, '#fun-status', /Wait \d s/);
  await page.waitForTimeout(1500);
  assert.deepEqual((await sends(page)).map((x) => x.id), [192]);
  await ctx.close();
});

test('emoji list down: the card says so and nothing can be sent', async () => {
  cdnMode = 'down';
  const { ctx, page } = await open();
  await waitText(page, '#fun-root', /Emoji list unavailable/);
  assert.equal(await page.$$eval('#fun-grid button[data-key]', (b) => b.length), 0);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('a send that throws stops sending, with a message', async () => {
  const { ctx, page } = await open(() => { __fake.emojiThrows = true; });
  await picker(page);
  await tap(page, 'static:192');
  await waitText(page, '#fun-status', /Sending stopped: chat panel not ready/);
  await page.evaluate(() => { __fake.emojiThrows = false; });
  await page.waitForTimeout(3200);
  await tap(page, 'static:193');
  await page.waitForTimeout(1500);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('not connected: nothing is sent and the card says so', async () => {
  const { ctx, page } = await open(() => { __fake.socket = 3; });
  await picker(page);
  await tap(page, 'static:192');
  await waitText(page, '#fun-status', /not connected/);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('Recent fills newest first and opens first on the next launch; Close removes the screen', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await tap(page, 'static:192');
  await waitSends(page, 1);
  await page.waitForTimeout(3100);
  await tab(page, '32');
  await tap(page, 'static:303');
  await waitSends(page, 2);
  await tab(page, 'recent');
  assert.deepEqual(await page.$$eval('#fun-grid button[data-key]', (b) => b.map((x) => x.dataset.key)), ['static:303', 'static:192']);
  await page.click('#fun-close');
  assert.equal(await page.$('#fun-root'), null);
  await launch(page);
  await picker(page);
  assert.equal(await page.$eval('#fun-tabs button[aria-selected="true"]', (b) => b.dataset.tab), 'recent');
  assert.deepEqual(await page.$$eval('#fun-grid button[data-key]', (b) => b.map((x) => x.dataset.key)), ['static:303', 'static:192']);
  await ctx.close();
});

test('closing the card while the send waits on the Ops clock sends nothing', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await page.evaluate(() => { window.__opsPace = { at: Date.now() + 1500 }; });   // another tool holds the clock
  await tap(page, 'static:192');
  await page.click('#fun-close');
  await page.waitForTimeout(3500);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('the chat changing while the send waits on the Ops clock sends nothing', async () => {
  const { ctx, page } = await open(() => { __fake.choice = { _channel: 2, _id: '102_2_2864_1', _name: 'Alliance' }; });
  await picker(page);
  await page.evaluate(() => { window.__opsPace = { at: Date.now() + 1500 }; });
  await tap(page, 'static:192');
  await page.evaluate(() => { __fake.choice = null; });                            // chat panel closed during the wait
  await waitText(page, '#fun-status', /chat changed/, 6000);
  assert.equal((await sends(page)).length, 0);
  await ctx.close();
});

test('an emoji the game no longer knows is refused before the send, and others still go out', async () => {
  const { ctx, page } = await open();
  await picker(page);
  await tab(page, '32');
  await tap(page, 'static:999');
  await waitText(page, '#fun-status', /not in the game/);
  assert.deepEqual(await page.evaluate(() => __fake.toasts), []);
  await tap(page, 'static:303');
  await waitSends(page, 1);
  assert.deepEqual((await sends(page)).map((x) => x.id), [303]);
  await ctx.close();
});
