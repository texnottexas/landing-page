'use strict';
// Ops Center in a real browser against a fake game page (test/fixtures/ops/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ops-center.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'ops');
const OWN = ['ops-center.js', 'ops-kit.js', 'ops-core.js'];
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    let name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    // /broken/... has no tool list, /nomember/... has no member list
    const mode = (name.match(/^(broken|nomember)\//) || [])[1];
    if (mode) name = name.slice(mode.length + 1);
    if ((mode === 'broken' && name === 'ops-tools.json') || (mode === 'nomember' && name === 'player-data.json')) { res.writeHead(404); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

async function open(viewport, before) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  if (before) await page.evaluate(before);
  await page.addScriptTag({ url: base + 'ops-center.js' });          // what the bookmarklet does
  await page.waitForSelector('.ops-card');
  return { ctx, page };
}
const PHONE = { width: 375, height: 740 }, DESKTOP = { width: 1280, height: 800 };
const tileNames = (page) => page.$$eval('.ops-tile .ops-tname', (els) => els.map((e) => e.textContent));
const tileStatus = (page, name) => page.$$eval('.ops-tile', (els, n) => {
  const t = els.find((e) => e.querySelector('.ops-tname').textContent === n);
  return t ? [...t.querySelectorAll('.ops-pill')].map((p) => p.textContent) : null;
}, name);
const clickTile = (page, name) => page.click('.ops-tile:has(.ops-tname:text-is("' + name + '"))');

test('phone menu: member header, 2 columns, live statuses, no first-run badges, search', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  assert.equal(await page.textContent('.ops-sub'), 'Tester · S2864 ✓');
  assert.deepEqual(await tileNames(page), ['Alpha Tool', 'Beta Tool', 'Gamma Tool', 'Delta Tool']);
  const boxes = await page.$$eval('.ops-tile', (els) => els.slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
  assert.notEqual(boxes[0][0], boxes[1][0]); assert.equal(boxes[0][1], boxes[1][1], 'two tiles side by side');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready']);
  assert.deepEqual(await tileStatus(page, 'Beta Tool'), ['Locked']);
  assert.deepEqual(await tileStatus(page, 'Gamma Tool'), ['Not ready']);
  await page.fill('.ops-input', 'layout');
  assert.deepEqual(await tileNames(page), ['Beta Tool']);
  await page.fill('.ops-input', 'zzz');
  assert.match(await page.textContent('.ops-empty'), /No tools match "zzz"/);
  const text = await page.textContent('.ops-root');
  assert.ok(!text.includes('—'), 'no em dashes');
  await ctx.close();
});

test('desktop menu: 4 tiles per row', async () => {
  const { ctx, page } = await open(DESKTOP);
  await page.waitForSelector('.ops-tile');
  const tops = await page.$$eval('.ops-tile', (els) => els.slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1);
  await ctx.close();
});

test('tool page: unlock with the code, readiness turns green live, Launch anyway until then', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Beta Tool');
  assert.equal(await page.textContent('.ops-title'), 'Beta Tool');
  assert.ok(await page.isDisabled('.ops-btn.primary'));
  await page.fill('input[type=password]', 'nope');
  await page.click('.ops-btn:text-is("Unlock")');
  await page.waitForSelector('.ops-note.err:text-is("That code is not right.")');
  await page.fill('input[type=password]', 'open-sesame');
  await page.click('.ops-btn:text-is("Unlock")');
  await page.waitForSelector('input[type=password]', { state: 'detached' });
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch anyway');
  assert.ok((await page.textContent('.ops-box')).includes('Open your base'));
  await page.evaluate(() => { window.__fake.base = true; });
  await page.waitForSelector('.ops-btn.primary:text-is("Launch")', { timeout: 2500 });
  assert.ok((await page.textContent('.ops-box')).includes('Your base is open'));
  await page.click('.ops-icon-btn[aria-label=Back]');
  assert.deepEqual(await tileStatus(page, 'Beta Tool'), ['Ready']);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops_unlock_v1')), '"1"');
  await ctx.close();
});

test('launch: menu becomes a pill above the tool, re-run shows a note, closing the tool brings the menu back', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await page.waitForSelector('.ops-card', { state: 'detached' });
  await page.waitForSelector('.ops-fab:has-text("Alpha Tool running")');
  const onTop = await page.evaluate(() => {
    const r = document.querySelector('.ops-fab').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit.closest('.ops-fab');
  });
  assert.ok(onTop, 'the pill sits above the tool screen');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Alpha Tool is open")');
  await page.click('.ops-fab');
  await page.click('.ops-bubble .ops-btn:text-is("Hide this button")');
  await page.waitForSelector('.ops-fab', { state: 'detached' });
  await page.click('#fake-alpha-close');
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  assert.equal((await tileNames(page))[0], 'Alpha Tool', 'recently used first');
  assert.equal(await page.$('.ops-fab'), null);
  await ctx.close();
});

test('a tool found only by its declared overlay id is tracked too', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_unlock_v1', '"1"'); window.__fake.base = true; });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Beta Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("Beta Tool running")');
  await page.evaluate(() => document.getElementById('fake-beta').remove());
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  await ctx.close();
});

test('a tool that opens nothing hands back to the menu after about 10 s', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Gamma Tool');
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch anyway');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("starting Gamma Tool")');
  await page.waitForSelector('.ops-card', { timeout: 13000 });
  assert.equal(await page.evaluate(() => window.__silentRuns), 1);
  await ctx.close();
});

test('a script that fails to load shows a retry message', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Delta Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t load Delta Tool")', { timeout: 4000 });
  await ctx.close();
});

test('not an S2864 member: no tiles, a plain message', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; });
  await page.waitForSelector('.ops-note:has-text("This is for Server 2864 members.")');
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});

test('waiting for the game, then tiles once it has loaded', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.loaded = false; });
  await page.waitForSelector('.ops-note:has-text("Waiting for the game")');
  await page.evaluate(() => { window.__fake.loaded = true; });
  await page.waitForSelector('.ops-tile', { timeout: 5000 });
  await ctx.close();
});

test('badges: Updated after a version change, New for a newly listed tool', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_seen_v1', JSON.stringify({ alpha: '0', beta: '1', gamma: '1' })); });
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready', 'Updated']);
  assert.deepEqual(await tileStatus(page, 'Delta Tool'), ['Ready', 'New']);
  assert.deepEqual(await tileStatus(page, 'Gamma Tool'), ['Not ready']);
  await ctx.close();
});

test('Esc closes everything; running the bookmarklet again reopens the menu', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ops-root', { state: 'detached' });
  await page.addScriptTag({ url: base + 'ops-center.js' });
  await page.waitForSelector('.ops-tile');
  await ctx.close();
});

test('the tool list fails to load: a plain message with Retry, not a broken menu', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/broken/'; });
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t load the tool list")');
  assert.ok(await page.$('.ops-toast .ops-btn:text-is("Retry")'));
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});

test('the member list fails to load: a plain message with Retry, no tiles', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/nomember/'; });
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t check your membership")');
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});
