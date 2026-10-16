'use strict';
// Tools that run together (Tex 2026-10-16): Mask Boxes, Enigma Veins and HT Gift Boxes in one game page, at the real
// pace of the shared request clock, with their cards kept apart by ops-stack.js.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ops-together.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['mask-boxes.js', 'mask-boxes-core.js', 'enigma-veins.js', 'enigma-veins-core.js', 'ht-gifts.js', 'ht-gifts-core.js',
  'ops-stack.js', 'ops-drag.js', 'ops-tools.json'];
const PW = crypto.createHash('sha256').update('bananas').digest('hex');
const T = 260617001;                                     // a Mask box's item is T + its type

let server, base, browser, feed;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (name === 'maskintel') { res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify({ ok: true, fetchedAt: Date.now(), boxes: feed, spots: [] })); return; }
    if (name === 'ops/usage' || name.startsWith('maskshare/')) { req.resume(); req.on('end', () => { res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end('{"ok":true}'); }); return; }
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { feed = [{ server: 619, x: 404, y: 612, owner: 'A', type: 1, endMs: Date.now() + 600000 }]; });

// The fake game with one Mask box, two veins and one HT gift box; then the helpers and the three tools, as the
// Ops Center loads them (helpers first). No pace overrides: the shared clock runs at its real gaps.
async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(([b, pw, t]) => {
    const w = b.replace(/\/$/, ''), now = Date.now(), s = Math.floor(now / 1000);
    window.__MBX_WORKER = w; window.__VEIN_WORKER = w; window.__HTG_WORKER = w; window.__OPS_BASE = b;
    window.__MBX_FAST = true; window.__MBX_FEED_MS = 1000; window.__VEIN_FAST = true;
    localStorage.setItem('htg_pw_v1', pw);
    __fake.cities['619:404:612'] = { pid: '222', itemId: t + 1, instanceId: 'i2' };
    __fake.vein.event = { id: 83000157, type: 279, showUiType: 'domainTreasure', begintime: s - 60, endtime: s + 7200, para6: '6' };
    __fake.vein.veins = [{ x: 500, y: 300, expireMs: now + 3600000, status: 0 }, { x: 501, y: 301, expireMs: now + 3000000, status: 0 }];
    __fake.htg.gifts = [{ x: 10, y: 10, k: 2864, m: { receiveBagUidList: [], endSecsTime: s + 1200, floatParadeId: 4, luckyBagNum: 10, marchIdStr: 'M1' } }];
  }, [base, PW, T]);
  for (const f of ['ops-drag.js', 'ops-stack.js', 'mask-boxes-core.js', 'enigma-veins-core.js', 'ht-gifts-core.js', 'mask-boxes.js', 'enigma-veins.js', 'ht-gifts.js']) await page.addScriptTag({ url: base + f });
  await page.waitForSelector('#mbx-root .mbx-card');
  await page.waitForSelector('#vein-root .vein-card');
  await page.waitForSelector('#htg-root .htg-card');
  return { ctx, page };
}
const cards = (page) => page.evaluate(() => ['#mbx-root', '#vein-root', '#htg-root'].map((q) => {
  const e = document.querySelector(q), c = e && (e.firstElementChild || e);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { id: q, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
}).filter(Boolean));
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
function assertApart(list, view) {
  list.forEach((c) => assert.ok(c.l >= 0 && c.t >= 0 && c.r <= view.width && c.b <= view.height, c.id + ' on screen ' + JSON.stringify(c)));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), list[i].id + ' and ' + list[j].id + ' overlap: ' + JSON.stringify([list[i], list[j]]));
}

test('TOG-1: Mask Boxes, Enigma Veins and HT Gift Boxes together: every request 1.05 s or more apart; each tool gets its work done', async () => {
  const { ctx, page } = await open({ width: 1280, height: 800 });
  await page.waitForFunction(() => {
    const r = __fake.sent.map((x) => x.rid);
    return r.includes(2503) && r.filter((x) => x === 902).length >= 3 && r.includes(8852) && r.includes(8623);
  }, null, { timeout: 45000 });
  const s = await page.evaluate(() => __fake.sent.map((x) => ({ rid: x.rid, at: x.at })));
  s.slice(1).forEach((x, i) => assert.ok(x.at - s[i].at >= 1050, 'gap ' + (x.at - s[i].at) + ' ms before ' + x.rid));
  assert.equal(await page.evaluate(() => [window.__MBX.running, window.__VEIN.running, window.__HTG.state().running].join()), 'true,true,true');
  await ctx.close();
});

test('TOG-2: desktop 1280x800: the three cards are on screen and do not overlap', async () => {
  const view = { width: 1280, height: 800 };
  const { ctx, page } = await open(view);
  await page.waitForTimeout(2500);                                   // the stack re-places every second
  const list = await cards(page);
  assert.equal(list.length, 3);
  assertApart(list, view);
  await ctx.close();
});

test('TOG-3: phone 375x740: the cards stack or fold, all on screen, none overlapping; a dragged card stays put while another goes', async () => {
  const view = { width: 375, height: 740 };
  const { ctx, page } = await open(view);
  await page.waitForTimeout(2500);
  assertApart(await cards(page), view);
  const head = await page.$eval('#vein-root .vein-head', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await page.mouse.move(head.x, head.y); await page.mouse.down();
  await page.mouse.move(head.x + 5, head.y + 60, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const before = (await cards(page)).find((c) => c.id === '#vein-root');
  await page.evaluate(() => { window.__HTG.stop(); const r = document.getElementById('htg-root'); if (r) r.remove(); });
  await page.waitForTimeout(2500);
  assert.deepEqual((await cards(page)).find((c) => c.id === '#vein-root'), before, 'the dragged card stays put');
  await ctx.close();
});
