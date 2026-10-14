'use strict';
// The Troop Optimizer's minimised pill drags; the full screen never moves. Its helpers are stubbed: this is the shell.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/troop-drag.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/+/, '');
    if (name === 'ops-drag.js' || name === 'troop-bookmarklet.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(path.join(ROOT, name))); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + 15, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}
test('TROOP-DRAG-1: the minimised pill drags and comes back there; opened, the screen fills the window as before', async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => { window.TroopCore = {}; window.TroopGame = { stop() {}, removeLock() {}, lockActive() { return false; } }; });
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  await page.addScriptTag({ url: base + 'troop-bookmarklet.js' });
  await page.waitForSelector('#tp-overlay');
  const full = () => page.evaluate(() => { const r = document.getElementById('tp-overlay').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  assert.deepEqual(await full(), { x: 0, y: 0, w: 375, h: 740 });
  await page.getByRole('button', { name: 'Minimise' }).click();
  await dragBy(page, '#tp-overlay .tp-pill', 0, 300);
  const p = await page.evaluate(() => Math.round(document.getElementById('tp-overlay').getBoundingClientRect().top));
  assert.equal(p, 72 + 300);
  await page.getByRole('button', { name: 'Open' }).click();
  assert.deepEqual(await full(), { x: 0, y: 0, w: 375, h: 740 }, 'the open screen fills the window');
  await page.getByRole('button', { name: 'Minimise' }).click();
  assert.equal(await page.evaluate(() => Math.round(document.getElementById('tp-overlay').getBoundingClientRect().top)), 372, 'the pill comes back to its spot');
  await ctx.close();
});
