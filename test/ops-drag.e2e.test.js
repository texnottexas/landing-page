'use strict';
// The drag helper in a real browser, on a plain test card.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ops-drag.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
let server, base, browser;
const PAGE = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
  + '#tcard{position:fixed;left:8px;top:84px;width:200px;background:#161b22;color:#e6edf3;z-index:1000;font:13px sans-serif}'
  + '#tcard .t-head{display:flex;height:44px;align-items:center}#tcard .t-title{flex:1}#tcard button{width:44px;height:44px}'
  + '#tcard .t-body{height:120px}#tcard.min .t-body{display:none}#big{position:fixed;left:0;top:0;width:900px;height:1200px}'
  + '</style></head><body></body></html>';

test.before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/+/, '');
    if (name === 'ops-drag.js') { fs.readFile(path.join(ROOT, name), (err, buf) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(buf); }); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

// A test card: a title row with a fold button, a body, clicks counted.
async function open(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  return { ctx, page };
}
const make = (page, o) => page.evaluate((o) => {
  const old = document.getElementById('tcard'); if (old) old.remove();
  const c = document.createElement('div'); c.id = 'tcard';
  c.innerHTML = '<div class="t-head"><span class="t-title">Test card</span><button id="t-min" type="button">v</button></div><div class="t-body"><button id="t-pill" type="button">pill</button></div>';
  document.body.appendChild(c);
  window.__clicks = { head: 0, min: 0, pill: 0 };
  c.querySelector('.t-head').addEventListener('click', () => { window.__clicks.head++; });
  c.querySelector('#t-min').addEventListener('click', () => { window.__clicks.min++; c.classList.toggle('min'); });
  c.querySelector('#t-pill').addEventListener('click', () => { window.__clicks.pill++; });
  window.__ctl = OpsDrag.attach(c, Object.assign({ key: 'test', handle: '.t-head' }, o || {}));
}, o || {});
const rect = (page) => page.evaluate(() => { const r = document.getElementById('tcard').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + 15, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}

test('DRAG-1: dragging the title row moves the card, saves the spot, and a new card comes back there', async () => {
  const { ctx, page } = await open();
  await make(page);
  await dragBy(page, '#tcard .t-title', 60, 200);
  assert.deepEqual(await rect(page), { x: 68, y: 284, w: 200, h: 164 });
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ops_pos_v1_test'))), { x: 68, y: 284 });
  await make(page);                                         // the tool draws its card again (a relaunch)
  const r = await rect(page); assert.equal(r.x, 68); assert.equal(r.y, 284);
  await ctx.close();
});

test('DRAG-2: the fold button still folds; a press on it never drags; the click after a drag is swallowed', async () => {
  const { ctx, page } = await open();
  await make(page);
  await page.click('#t-min');
  assert.equal(await page.evaluate(() => window.__clicks.min), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops_pos_v1_test')), null, 'no drag from a button');
  await dragBy(page, '#t-min', 40, 40);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops_pos_v1_test')), null, 'pressing the button and moving does not drag');
  const before = await page.evaluate(() => window.__clicks.head);   // the fold button's own click bubbles to the title row
  await dragBy(page, '#tcard .t-title', 30, 30);
  assert.equal(await page.evaluate(() => window.__clicks.head), before, 'the click after the drag never reached the title');
  await ctx.close();
});

test('DRAG-3: a double-tap on the title puts the card back and forgets the spot', async () => {
  const { ctx, page } = await open();
  await make(page);
  await dragBy(page, '#tcard .t-title', 50, 50);
  await page.click('#tcard .t-title'); await page.click('#tcard .t-title');
  const r = await rect(page); assert.equal(r.x, 8); assert.equal(r.y, 84);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops_pos_v1_test')), null);
  assert.equal(await page.evaluate(() => document.getElementById('tcard').style.left), '', 'the card\'s own placement is back');
  await ctx.close();
});

test('DRAG-4: a spot saved on a bigger screen is pulled onto a smaller one, and the saved spot is kept', async () => {
  const { ctx, page } = await open({ width: 375, height: 740 });
  await page.evaluate(() => localStorage.setItem('ops_pos_v1_test', JSON.stringify({ x: 1200, y: 900 })));
  await make(page);
  const r = await rect(page);
  assert.equal(r.x, 375 - 200 - 8); assert.equal(r.y, 740 - 164 - 8);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ops_pos_v1_test'))), { x: 1200, y: 900 });
  await ctx.close();
});

test('DRAG-5: touch dragging moves the card', async () => {
  const { ctx, page } = await open();
  await make(page);
  await page.evaluate(() => {
    const t = document.querySelector('#tcard .t-title'), b = t.getBoundingClientRect(), x = b.left + 10, y = b.top + 10;
    const ev = (type, dx, dy) => (type === 'pointerdown' ? t : window).dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, bubbles: true, cancelable: true }));
    ev('pointerdown', 0, 0); ev('pointermove', 20, 40); ev('pointermove', 40, 120); ev('pointerup', 40, 120);
  });
  const r = await rect(page); assert.equal(r.x, 48); assert.equal(r.y, 204);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#tcard .t-head')).touchAction), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#tcard .t-body')).touchAction), 'auto', 'only the title row');
  await ctx.close();
});

test('DRAG-6: while the card says it isn\'t movable (active false), no drag and no saved spot applied', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { localStorage.setItem('ops_pos_v1_test', JSON.stringify({ x: 100, y: 300 })); window.__on = false; });
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'tcard';
    c.innerHTML = '<div class="t-head"><span class="t-title">Test card</span></div><div class="t-body"></div>';
    document.body.appendChild(c);
    window.__ctl = OpsDrag.attach(c, { key: 'test', handle: '.t-head', active: () => window.__on });
  });
  let r = await rect(page); assert.equal(r.y, 84, 'saved spot not applied');
  await dragBy(page, '#tcard .t-title', 40, 40);
  r = await rect(page); assert.equal(r.y, 84, 'not dragged');
  await page.evaluate(() => { window.__on = true; window.__ctl.reclamp(); });
  r = await rect(page); assert.equal(r.x, 100); assert.equal(r.y, 300);
  await ctx.close();
});

test('DRAG-7: a pill that is itself a button can be dragged (dragButtons); a plain tap on it still clicks', async () => {
  const { ctx, page } = await open();
  await make(page, { handle: null, dragButtons: '#t-pill' });
  await page.click('#t-pill');
  assert.equal(await page.evaluate(() => window.__clicks.pill), 1, 'a tap clicks');
  await dragBy(page, '#t-pill', 30, 60);
  assert.equal(await page.evaluate(() => window.__clicks.pill), 1, 'a drag does not click');
  assert.notEqual(await page.evaluate(() => localStorage.getItem('ops_pos_v1_test')), null);
  await ctx.close();
});

test('DRAG-8: a resize pulls a placed card back on screen', async () => {
  const { ctx, page } = await open({ width: 800, height: 900 });
  await make(page);
  await dragBy(page, '#tcard .t-title', 500, 600);
  await page.setViewportSize({ width: 375, height: 740 });
  await page.waitForTimeout(100);
  const r = await rect(page);
  assert.ok(r.x + r.w <= 375 - 8 && r.y + r.h <= 740 - 8);
  await ctx.close();
});

test('DRAG-9: a card drawn again many times leaves no stray listeners and still drags', async () => {
  const { ctx, page } = await open();
  for (let i = 0; i < 20; i++) await make(page);
  await dragBy(page, '#tcard .t-title', 20, 20);
  const r = await rect(page); assert.equal(r.x, 28); assert.equal(r.y, 104);
  assert.equal(await page.evaluate(() => window.OpsDrag.attached()), 1, 'removed cards were let go: one card, one set of listeners');
  await ctx.close();
});

test('DRAG-10: the title row can\'t be text-selected (no Safari text selection or long-press loupe while dragging)', async () => {
  const { ctx, page } = await open();
  await make(page);
  const st = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#tcard .t-head')); return s.userSelect || s.webkitUserSelect; });
  assert.equal(st, 'none');
  await dragBy(page, '#tcard .t-title', 40, 40);
  assert.equal(await page.evaluate(() => String(window.getSelection())), '', 'no text selected by the drag');
  await ctx.close();
});
