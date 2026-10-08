// test/guide-videos.e2e.test.js
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/guide-videos.e2e.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const G = require('../guide-videos.js');

const ROOT = path.join(__dirname, '..');
const FILES = {
  'rickroll.html': path.join(ROOT, 'pages', 'rickroll.html'),
  'armory-report.html': path.join(ROOT, 'pages', 'armory-report.html'),
  'guide-videos.js': path.join(ROOT, 'guide-videos.js'),
  'player-data.json': path.join(ROOT, 'player-data.json'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const file = FILES[decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

async function open(file, ua, viewport, mobile) {
  const ctx = await browser.newContext({ userAgent: ua, viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.request().url().startsWith('https://www.youtube-nocookie.com/')
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' })
    : route.abort());
  const page = await ctx.newPage();
  const csp = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to frame/i.test(m.text())) csp.push(m.text()); });
  await page.goto(base + file);
  return { ctx, page, csp };
}
const frameSrc = (page) => page.$eval('.guide-videos iframe', (f) => f.src);

test('Ops page on iPhone: no YouTube until opened, then the Firefox film, portrait, allowed by CSP', async () => {
  const { ctx, page, csp } = await open('rickroll.html', IPHONE, PHONE, true);
  await page.waitForSelector('details.guide-videos');
  assert.equal(await page.$('.guide-videos iframe'), null);           // review focus 4
  await page.click('details.guide-videos summary');
  await page.waitForSelector('.guide-videos iframe');
  assert.match(await frameSrc(page), new RegExp(G.FILMS.opsFirefox.id));
  assert.equal(await page.$eval('.guide-videos iframe', (f) => f.referrerPolicy), 'strict-origin-when-cross-origin');
  const box = await page.$eval('.guide-videos iframe', (f) => f.getBoundingClientRect().toJSON());
  assert.ok(box.height > box.width, 'portrait player');
  await page.waitForTimeout(500);
  assert.deepEqual(csp, []);                                           // review focus 5
  await ctx.close();
});

test('Ops page defaults: Chrome on Android, Desktop (landscape) on a computer; buttons switch', async () => {
  let { ctx, page } = await open('rickroll.html', ANDROID, PHONE, true);
  await page.click('details.guide-videos summary');
  await page.waitForSelector('.guide-videos iframe');
  assert.match(await frameSrc(page), new RegExp(G.FILMS.opsChrome.id));
  await page.click('.guide-videos button[data-film="opsFirefox"]');
  assert.match(await frameSrc(page), new RegExp(G.FILMS.opsFirefox.id));
  await ctx.close();
  ({ ctx, page } = await open('rickroll.html', MAC, DESKTOP, false));
  await page.click('details.guide-videos summary');
  await page.waitForSelector('.guide-videos iframe');
  assert.match(await frameSrc(page), new RegExp(G.FILMS.opsDesktop.id));
  const box = await page.$eval('.guide-videos iframe', (f) => f.getBoundingClientRect().toJSON());
  assert.ok(box.width > box.height, 'landscape player');
  await ctx.close();
});

test('Armory card: Firefox film on iPhone, skip link, desktop link, allowed by CSP', async () => {
  const { ctx, page, csp } = await open('armory-report.html', IPHONE, PHONE, true);
  await page.waitForFunction(() => window.GuideVideos);
  await page.evaluate(() => document.body.prepend(GuideVideos.buildCard('armory')));
  await page.waitForSelector('.guide-videos iframe');
  assert.match(await frameSrc(page), new RegExp(G.FILMS.armoryFirefox.id));
  await page.click('.guide-skip');
  assert.match(await frameSrc(page), new RegExp('&start=' + G.SETS.armory.skip.at.armoryFirefox + '$'));
  const link = await page.$eval('.guide-link', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
  assert.deepEqual(link, { href: G.watchUrl(G.FILMS.opsDesktop.id), target: '_blank', rel: 'noopener' });
  await page.waitForTimeout(500);
  assert.deepEqual(csp, []);
  await ctx.close();
});
