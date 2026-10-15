'use strict';
// learning-lounge.html (players search the mentors' Q&A). Against a mocked worker; no network.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/learning-lounge.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lounge', 'public', 'lounge.json'), 'utf8'));
const W = 'https://push-worker.27tb8s6fct.workers.dev';
let server, base, browser, data, getStatus, posts, askStatus, getCount;

test.before(async () => {
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const file = u === '/lounge-core.js' ? path.join(ROOT, 'lounge-core.js') : u === '/learning-lounge.html' ? path.join(ROOT, 'pages', 'learning-lounge.html') : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': u.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/learning-lounge.html';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { data = JSON.parse(JSON.stringify(FIX)); getStatus = 200; posts = []; askStatus = 200; getCount = 0; });

async function open(suffix, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.identity) await ctx.addInitScript((id) => localStorage.setItem('playerIdentity', JSON.stringify(id)), opts.identity);
  await ctx.route(/translate|google|gstatic/, (r) => r.abort());
  await ctx.route(/^https:\/\/push-worker\.27tb8s6fct\.workers\.dev\/lounge/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'GET' && url.pathname === '/lounge') {
      getCount++;
      if (getStatus !== 200) return route.fulfill({ status: getStatus, headers: cors, contentType: 'application/json', body: '{"error":"unavailable"}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
    }
    posts.push({ path: url.pathname, type: req.headers()['content-type'] || '', body: req.postData() });
    const st = url.pathname === '/lounge/ask' ? askStatus : 200;
    return route.fulfill({ status: st, headers: cors, contentType: 'application/json', body: st === 200 ? '{"ok":true,"counted":true}' : '{"error":"x"}' });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + (suffix || ''));
  return { ctx, page, errs };
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const cardFor = (page, id) => page.locator('.ll-card[data-id="' + id + '"]');

test('P-LOAD: chapters render with counts, empty chapters hidden', async () => {
  data.categories.push({ id: 'empty', name: 'Nothing Here', blurb: 'x', sort: 99 });
  const { ctx, page, errs } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  const tiles = await page.$$eval('#ll-chapters .ll-chap', (els) => els.map((e) => e.innerText));
  assert.equal(tiles.length, FIX.categories.length);
  assert.match(tiles[0], /01/);
  assert.match(tiles[0], /getting started/i);
  const n = FIX.entries.filter((e) => e.category_id === FIX.categories[0].id).length;
  assert.match(tiles[0], new RegExp(n + ' (question|answer)'));
  assert.ok(!tiles.join('\n').includes('Nothing Here'));
  const all = await text(page, 'body');
  assert.ok(!/—/.test(all), 'no em dash');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('P-SEARCH: "wat is ht" shows the HT entry first with a mark', async () => {
  const { ctx, page } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.fill('#ll-search', 'wat is ht');
  await page.waitForSelector('#ll-results .ll-card');
  assert.equal(await page.locator('#ll-results .ll-card').first().getAttribute('data-id'), 'w-ht');
  assert.ok(await page.locator('#ll-results .ll-card').first().locator('mark').count() > 0);
  assert.match(await text(page, '#ll-count'), /result/);
  assert.equal(await page.locator('#ll-chapters').isVisible(), false);
  await ctx.close();
});

test('P-TYPO: "armoury" finds the armory entry', async () => {
  const { ctx, page } = await open();
  await page.fill('#ll-search', 'armoury');
  await page.waitForSelector('#ll-results .ll-card');
  const ids = await page.$$eval('#ll-results .ll-card', (e) => e.map((x) => x.dataset.id));
  assert.ok(ids.includes('arm-what-is') || ids.includes('arm-get-mine'), ids.join());
  await ctx.close();
});

test('P-OPEN: opening renders the answer, resolves links, sets the hash, shows answered by and related', async () => {
  const { ctx, page } = await open();
  await page.fill('#ll-search', 'how do I get my own armory');
  await page.waitForSelector('.ll-card[data-id="arm-get-mine"]');
  const card = cardFor(page, 'arm-get-mine');
  await card.locator('.ll-card-head').click();
  await card.locator('.ll-answer').waitFor();
  assert.equal(await card.locator('.ll-answer a').first().getAttribute('href'), 'https://2864tw.com/armory-report.html');
  assert.match(await card.locator('.ll-by').innerText(), /Answered by Wonka/);
  assert.ok(await card.locator('.ll-rel a, .ll-rel button').count() > 0);
  assert.equal(await page.evaluate(() => location.hash), '#q-arm-get-mine');
  // an entry with no updatedByName has no byline
  await page.fill('#ll-search', 'what does tc mean');
  await page.waitForSelector('.ll-card[data-id="w-tc"]');
  const tc = cardFor(page, 'w-tc');
  await tc.locator('.ll-card-head').click();
  await tc.locator('.ll-answer').waitFor();
  assert.equal(await tc.locator('.ll-by').count(), 0);
  await ctx.close();
});

test('P-VOTE: Yes sends once, then disabled; remembered after reload', async () => {
  const { ctx, page } = await open('#q-w-ht');
  const card = cardFor(page, 'w-ht');
  await card.locator('.ll-yes').waitFor();
  await card.locator('.ll-yes').click();
  await page.waitForFunction(() => /Thanks/.test(document.body.innerText));
  const votes = posts.filter((p) => p.path === '/lounge/helpful');
  assert.equal(votes.length, 1);
  assert.deepEqual(JSON.parse(votes[0].body), { id: 'w-ht', helpful: true });
  assert.match(votes[0].type, /^application\/json/);
  assert.equal(await card.locator('.ll-yes').count(), 0, 'buttons gone after voting');
  await page.reload();
  await cardFor(page, 'w-ht').locator('.ll-card-head').waitFor();
  assert.equal(await cardFor(page, 'w-ht').locator('.ll-yes').count(), 0, 'no second vote after reload');
  assert.match(await text(page, '#ll-results'), /Thanks/);
  assert.equal(posts.filter((p) => p.path === '/lounge/helpful').length, 1);
  await ctx.close();
});

test('P-MISS: a no-match query plus Enter posts one miss and shows the Ask card prefilled', async () => {
  const { ctx, page } = await open(null, { identity: { name: 'Tex' } });
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.fill('#ll-search', 'zzqx flurb');
  await page.press('#ll-search', 'Enter');
  await page.waitForSelector('#ll-nomatch');
  assert.match(await text(page, '#ll-nomatch'), /Nothing yet for that/);
  await page.waitForFunction(() => document.getElementById('ll-ask-q') && document.getElementById('ll-ask-q').value === 'zzqx flurb');
  assert.equal(await page.inputValue('#ll-ask-name'), 'Tex');
  await page.press('#ll-search', 'Enter');
  await page.waitForTimeout(200);
  const miss = posts.filter((p) => p.path === '/lounge/miss');
  assert.equal(miss.length, 1);
  assert.match(miss[0].type, /^text\/plain/);
  assert.deepEqual(JSON.parse(miss[0].body), { q: 'zzqx flurb' });
  await ctx.close();
});

test('P-MISS-IDLE: a miss is logged after a quiet spell, but not for a query that matched', async () => {
  const { ctx, page } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.fill('#ll-search', 'what is ht');
  await page.waitForSelector('#ll-results .ll-card');
  await page.fill('#ll-search', 'zzqx flurb');
  await page.waitForFunction(() => /Nothing yet/.test(document.body.textContent));
  await page.waitForTimeout(3000);
  assert.deepEqual(posts.filter((p) => p.path === '/lounge/miss').map((p) => JSON.parse(p.body)), [{ q: 'zzqx flurb' }]);
  await ctx.close();
});

test('P-ASK: sending posts question and name, shows thanks; 429 and 400 show their text', async () => {
  const { ctx, page } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.click('a[href="#ll-ask"], #ll-ask-link');
  await page.fill('#ll-ask-q', 'How do I frobnicate the squad?');
  await page.fill('#ll-ask-name', 'Sam');
  await page.click('#ll-ask-send');
  await page.waitForFunction(() => /Sent\. A mentor will add the answer here, check back soon\./.test(document.getElementById('ll-ask').textContent));
  const a = posts.filter((p) => p.path === '/lounge/ask');
  assert.equal(a.length, 1);
  assert.deepEqual(JSON.parse(a[0].body), { question: 'How do I frobnicate the squad?', name: 'Sam' });
  askStatus = 429;
  await page.click('#ll-ask-send');
  await page.waitForFunction(() => /Too many questions from here right now, try again later\./.test(document.getElementById('ll-ask').textContent));
  askStatus = 400;
  await page.click('#ll-ask-send');
  await page.waitForFunction(() => /Please write a little more\./.test(document.getElementById('ll-ask').textContent));
  askStatus = 500;
  await page.click('#ll-ask-send');
  await page.waitForFunction(() => /Couldn't send, try again\./.test(document.getElementById('ll-ask').textContent));
  assert.equal(await page.locator('#ll-ask-send').isDisabled(), false);
  await ctx.close();
});

test('P-DYM: "squod" offers "Did you mean squad" and clicking runs it', async () => {
  const { ctx, page } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.fill('#ll-search', 'squod');
  await page.press('#ll-search', 'Enter');
  await page.waitForFunction(() => /Did you mean\s+squad/i.test(document.getElementById('ll-dym').innerText));
  await page.click('#ll-dym button');
  await page.waitForSelector('#ll-results .ll-card');
  assert.equal(await page.inputValue('#ll-search'), 'squad');
  assert.ok((await page.$$eval('#ll-results .ll-card', (e) => e.map((x) => x.dataset.id))).includes('ev-tc-where-squad'));
  await ctx.close();
});

test('P-DEEPLINK: #q-known opens it, #q-nope says it is gone, ?q= runs the search', async () => {
  let t = await open('#q-ev-tc-where-squad');
  await cardFor(t.page, 'ev-tc-where-squad').locator('.ll-answer').waitFor();
  assert.equal(await t.page.locator('.ll-card[data-id="ev-tc-where-squad"].open').count(), 1);
  await t.ctx.close();
  t = await open('#q-nope');
  await t.page.waitForFunction(() => /That question isn't here any more\./.test(document.body.innerText));
  assert.equal(await t.page.locator('#ll-search').isVisible(), true);
  await t.ctx.close();
  t = await open('#q-constructor');
  await t.page.waitForFunction(() => /That question isn't here any more\./.test(document.body.innerText));
  assert.equal(await t.page.locator('#ll-results .ll-card').count(), 0);
  assert.equal(await t.page.getAttribute('#ll-search', 'maxlength'), '120');
  await t.ctx.close();
  t = await open('?q=how%20do%20i%20sign%20up%20titan%20canyon');
  await t.page.waitForSelector('#ll-results .ll-card');
  assert.equal(await t.page.inputValue('#ll-search'), 'how do i sign up titan canyon');
  assert.ok((await t.page.$$eval('#ll-results .ll-card', (e) => e.map((x) => x.dataset.id))).includes('ev-tc-signup'));
  await t.page.waitForTimeout(3000);
  assert.equal(posts.filter((p) => p.path === '/lounge/miss').length, 0, 'a matched deep link logs no miss');
  await t.ctx.close();
});

test('P-DOWN: a 503 shows Try again; Try again loads once the worker is back', async () => {
  getStatus = 503;
  const { ctx, page, errs } = await open();
  await page.waitForSelector('#ll-down');
  assert.match(await text(page, '#ll-down'), /The Lounge can't load right now\./);
  getStatus = 200;
  await page.click('#ll-down button');
  await page.waitForSelector('#ll-chapters .ll-chap');
  assert.equal(await page.locator('#ll-down').count() === 0 || !(await page.locator('#ll-down').isVisible()), true);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('P-XSS: hostile text in every field stays inert', async () => {
  const EV = '<img src=x onerror="window.__pwned=1">';
  data.categories.push({ id: 'xss', name: 'Evil chapter ' + EV, blurb: 'blurb ' + EV, sort: 50 });
  data.entries.push({ id: 'xss-1', question: 'Evilword ' + EV + ' question', answer: 'Body ' + EV + '\n\n[x](javascript:window.__pwned=1)\n\n<script>window.__pwned=1</script>',
    category_id: 'xss', alternates: ['evilword ' + EV], keywords: [EV], updatedByName: 'Bob ' + EV, updatedAt: 1 });
  const { ctx, page } = await open();
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.fill('#ll-search', 'evilword');
  await page.waitForSelector('.ll-card[data-id="xss-1"]');
  await cardFor(page, 'xss-1').locator('.ll-card-head').click();
  await cardFor(page, 'xss-1').locator('.ll-answer').waitFor();
  await page.fill('#ll-search', '');
  await page.waitForSelector('#ll-chapters .ll-chap');
  await page.click('#ll-chapters .ll-chap:has-text("Evil chapter")');
  await page.waitForSelector('.ll-card[data-id="xss-1"]');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.equal(await page.locator('a[href^="javascript"]').count(), 0);
  await ctx.close();
});

test('P-MOBILE: no horizontal scroll at 360 px, search stays reachable', async () => {
  const { ctx, page } = await open(null, { viewport: { width: 360, height: 740 } });
  await page.waitForSelector('#ll-chapters .ll-chap');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
  await page.fill('#ll-search', 'how do i get my own armory');
  await page.waitForSelector('.ll-card[data-id="arm-get-mine"]');
  await cardFor(page, 'arm-get-mine').locator('.ll-card-head').click();
  await cardFor(page, 'arm-get-mine').locator('.ll-answer').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
  await ctx.close();
});

test('P-FRESH: ?fresh=1 still loads', async () => {
  const { ctx, page } = await open('?fresh=1');
  await page.waitForSelector('#ll-chapters .ll-chap');
  await ctx.close();
});
