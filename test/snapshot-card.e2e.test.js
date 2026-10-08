'use strict';
// The Snapshot's finished card (Tex, 2026-10-08: "too much"): summary, armory sync, report setup, Copy JSON as a
// backup and Close. No JSON box unless the clipboard refuses, and no Dismantle hand-off. Uses a canned snapshot
// (window.__SNAP_TEST_DUMP) and a fake worker, no game.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/snapshot-card.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DUMP = {
  v: 3, ts: '2026-10-08T10:00:00.000Z', meta: { uid: '1234567890', lvl: 100, sid: 2864, ts: '2026-10-08T10:00:00.000Z' },
  inventory: { v: 1, meta: { uid: '1234567890', ts: '2026-10-08T10:00:00.000Z' }, resources: {}, tabs: { item: [{ id: 1 }] } },
  beasts: { v: 1, ts: '2026-10-08T10:00:00.000Z', kept: 2, beasts: [] },
  chips: { v: 1, ts: '2026-10-08T10:00:00.000Z', total: 3, chips: [] },
  gear: null, heroes: null, formation: null, enigmaState: null, decorations: null, baseSkin: null, errors: []
};
let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/+/, '');
    if (name === 'all-bookmarklet.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(path.join(ROOT, name))); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

async function open(opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  // the fake worker: handshake + uploads succeed
  await page.route('https://worker.test/**', (rt) => {
    const u = rt.request().url();
    const body = u.endsWith('/supplement/handshake') ? { token: 't', siteKey: 'abcd' } : { ok: true };
    rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(base);
  await page.evaluate(([d, o]) => {
    window.__SNAP_TEST_DUMP = d; window.__SNAP_WORKER = 'https://worker.test';
    if (o && o.noClipboard) { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.execCommand = () => false; }
  }, [DUMP, opts || {}]);
  await page.addScriptTag({ url: base + 'all-bookmarklet.js' });
  await page.waitForSelector('#snap-setup-go');
  return { ctx, page, errs };
}

test('the finished card: summary, armory sync, report setup, Copy (backup) and Close; no JSON box, no Dismantle', async () => {
  const { ctx, page, errs } = await open();
  const info = await page.evaluate(() => {
    const card = document.getElementById('snap-card');
    return { inBody: card.parentNode.parentNode === document.body, textareas: document.querySelectorAll('textarea').length,
      text: card.innerText, buttons: [...card.querySelectorAll('button')].map((b) => b.textContent) };
  });
  assert.equal(info.textareas, 0, 'no JSON box on screen');
  assert.ok(!/Dismantle/i.test(info.text), 'no Dismantle hand-off');
  assert.match(info.text, /Snapshot ready/);
  assert.match(info.text, /Armory updated: Inventory, Beasts, Chips\./);
  assert.match(info.text, /Set up my armory report/);
  assert.deepEqual(info.buttons, ['Set up', 'Copy JSON (backup)', 'Close']);
  assert.ok(!/—/.test(info.text), 'no em dash on the card');
  assert.deepEqual(errs, []);
  await page.click('#snap-close');
  assert.equal(await page.$('#snap-card'), null);
  await ctx.close();
});

test('Copy (backup) copies the whole snapshot', async () => {
  const { ctx, page } = await open();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
  await page.click('#snap-copy');
  await page.waitForFunction(() => document.getElementById('snap-copy').textContent === 'Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(JSON.parse(copied).inventory.tabs.item.length, 1);
  await ctx.close();
});

test('the clipboard refuses: the JSON box appears, selected, with how to copy by hand', async () => {
  const { ctx, page } = await open({ noClipboard: true });
  await page.click('#snap-copy');
  await page.waitForSelector('#snap-card textarea');
  assert.match(await page.textContent('#snap-status'), /Long-press the box below/);
  assert.equal(JSON.parse(await page.$eval('#snap-card textarea', (t) => t.value)).v, 3);
  await ctx.close();
});

test('fits a phone: the card stays inside the screen width', async () => {
  const { ctx, page } = await open();
  const r = await page.$eval('#snap-card', (c) => c.getBoundingClientRect().toJSON());
  assert.ok(r.left >= 0 && r.right <= 390, JSON.stringify(r));
  await page.screenshot({ path: path.join(process.env.SNAP_SHOT_DIR || require('node:os').tmpdir(), 'snap-card.png') });
  await ctx.close();
});
