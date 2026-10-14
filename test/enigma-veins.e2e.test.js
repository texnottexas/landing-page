'use strict';
// Enigma Veins in a real browser against the fake game (test/fixtures/mapc/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/enigma-veins.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['enigma-veins.js', 'enigma-veins-core.js', 'ops-drag.js'];
const UID = 'test-owner-uid';
const SK = crypto.createHash('sha256').update(UID).digest('hex').slice(0, 16);

let server, base, browser, usageLog;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (name === 'ops/usage') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        usageLog.push({ body: j, raw: b, type: req.headers['content-type'] });
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end('{"ok":true}');
      });
      return;
    }
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' }); res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { usageLog = []; });

// The event with these veins: [{x, y, left (minutes), status, late}], plus event overrides (para6, begintime, ...).
const VEINS = ([veins, o]) => {
  const now = Date.now(), s = Math.floor(now / 1000);
  __fake.vein.event = Object.assign({ id: 83000157, type: 279, showUiType: 'domainTreasure', begintime: s - 60, endtime: s + 7200, para6: '6' }, o || {});
  __fake.vein.veins = veins.map((v, i) => ({ x: v.x != null ? v.x : 500 + i, y: v.y != null ? v.y : 300 + i, expireMs: now + (v.left != null ? v.left : 60) * 60000, status: v.status || 0, late: !!v.late }));
};
async function open(setup, arg, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => { window.__VEIN_WORKER = b.replace(/\/$/, ''); window.__VEIN_FAST = true; window.__VEIN_CHECK_MS = 1500; window.__VEIN_IDLE_MS = 1500; window.__VEIN_TIMEOUT_MS = 800; window.__VEIN_GAP_MS = 60; window.__OPS_BASE = b; }, base);
  await page.addScriptTag({ url: base + 'enigma-veins-core.js' });
  if (setup) await page.evaluate(setup, arg);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'enigma-veins.js' });
const marches = (page) => page.evaluate(() => __fake.sent.filter((s) => s.rid === 902).map((s) => s.p));
const lists = (page) => page.evaluate(() => __fake.sent.filter((s) => s.rid === 8623).map((s) => s.p));
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 8000 });
const M = (x, y) => ({ marchType: 180, x, y, armyList: [], armyListNew: [], heroList: [], trapList: [], ext: {} });

test('VEIN-1: one mining march to each unmined vein, least time left first, with the game\'s own request; skips mined, mining, on the way and 5-minute veins', async () => {
  const { ctx, page } = await open(VEINS, [[
    { x: 1, y: 1, left: 60 }, { x: 2, y: 2, left: 20 }, { x: 3, y: 3, status: 2 }, { x: 4, y: 4, status: 1 }, { x: 5, y: 5, status: 3 },
    { x: 6, y: 6, left: 4 }, { x: 7, y: 7, left: 40 }
  ]]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 3);
  await page.waitForTimeout(600);
  assert.deepEqual(await marches(page), [M(2, 2), M(7, 7), M(1, 1)]);
  assert.deepEqual((await lists(page))[0], { activityId: 83000157, type: 2 });
  await waitText(page, '#vein-sub', /^On the way \d \/ 6$/);
  await waitText(page, '#vein-last', /^Sent to 1, 1$/);
  await waitText(page, '#vein-stat', /^Sent 3 today · Open 3$/, 8000);   // like the game, mined veins leave our list (the 3 we mined, and 3,3); left: mining, on the way, 5-minute
  const cut = await page.evaluate(() => ['vein-stat', 'vein-sub', 'vein-last'].filter((id) => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth; }));
  assert.deepEqual(cut, [], 'no line is cut off on the 190 px card');
  const text = await page.$eval('#vein-root', (e) => e.textContent);
  assert.ok(!/—/.test(text), 'no em dash'); assert.ok(!/finder-uid/.test(text), 'no finder uid');
  await ctx.close();
});

test('VEIN-2: never the same vein twice: not on the next check, not after a relaunch', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 9, y: 9, left: 60 }]]);
  await page.evaluate(() => { __fake.vein.mineMs = 600000; });       // still mining at the next check
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 8623).length >= 2, null, { timeout: 8000 });
  assert.equal((await marches(page)).length, 1);
  await page.evaluate(() => { window.__VEIN.stop(); __fake.vein.veins[0].status = 0; for (const k in __fake.carrier) delete __fake.carrier[k]; });   // even if the game said 0 again and showed no march: only our sent list stops a second one
  await launch(page);
  await page.waitForFunction(() => window.__VEIN && window.__VEIN.running && __fake.sent.filter((s) => s.rid === 8623).length >= 3);
  await page.waitForTimeout(500);
  assert.equal((await marches(page)).length, 1, 'remembered across a relaunch');
  const store = await page.evaluate((sk) => JSON.parse(localStorage.getItem('vein_sent_v1_' + sk)), SK);
  assert.equal(store.eventId, '83000157');
  assert.equal(Object.keys(store.keys).length, 1);
  assert.match(Object.keys(store.keys)[0], /^9,9,\d+$/);
  assert.ok(!/finder/.test(JSON.stringify(store)), 'no finder data stored');
  await ctx.close();
});

test('VEIN-3: a march the game never answers stops the run, and it is never sent again', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 9, y: 9 }, { x: 10, y: 10 }]]);
  await page.evaluate(() => { __fake.vein.mode = 'silent'; });
  await launch(page);
  await waitText(page, '#vein-root .vein-msg', /Enigma Veins stopped: the game stopped answering/);
  assert.equal((await marches(page)).length, 1);
  await page.evaluate(() => { __fake.vein.mode = 'ok'; __fake.pending = []; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 2);
  await page.waitForTimeout(500);
  assert.deepEqual((await marches(page)).map((p) => p.x), [9, 10], 'the unanswered vein is not sent again');
  await ctx.close();
});

test('VEIN-4: a refusal stops the run with the game\'s text; nothing more is sent', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1, left: 20 }, { x: 2, y: 2, left: 30 }]]);
  await page.evaluate(() => { __fake.vein.mode = 'refuse'; });
  await launch(page);
  await waitText(page, '#vein-root .vein-msg', /Enigma Veins stopped: March failed! Only one march is allowed on the same Vein at a time/);
  await page.waitForTimeout(500);
  assert.equal((await marches(page)).length, 1);
  await ctx.close();
});

test('VEIN-5: the game\'s "not enough time" skips that vein only: the run goes on, and the vein is not tried again', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1, left: 10, late: true }, { x: 2, y: 2, left: 30 }]]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 2);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 8623).length >= 2, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  assert.deepEqual((await marches(page)).map((p) => p.x), [1, 2]);
  assert.equal(await page.evaluate(() => window.__VEIN.running), true);
  assert.equal(await page.evaluate(() => window.__VEIN.state().skipped), 1);
  await ctx.close();
});

test('VEIN-6: no Enigma Field Hunt (none, or not begun): says so and sends nothing', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }], { begintime: Math.floor(Date.now() / 1000) + 3600 }]);
  await launch(page);
  await waitText(page, '#vein-foot', /The Enigma Field Hunt isn't on right now/);
  await page.evaluate(() => { __fake.vein.event = null; });
  await page.waitForTimeout(1800);
  assert.equal((await lists(page)).length, 0);
  assert.equal((await marches(page)).length, 0);
  await ctx.close();
});

test('VEIN-7: disconnected: nothing goes out until the game is back', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await page.evaluate(() => { __fake.socket = 3; });
  await launch(page);
  await waitText(page, '#vein-foot', /Game disconnected/);
  await page.waitForTimeout(800);
  assert.equal((await lists(page)).length + (await marches(page)).length, 0);
  await page.evaluate(() => { __fake.socket = 1; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1);
  await ctx.close();
});

test('VEIN-8: at most the event\'s para6 out at once; the rest go when marches come home', async () => {
  const { ctx, page } = await open(VEINS, [[{}, {}, {}, {}, {}], { para6: '2' }]);
  await page.evaluate(() => { __fake.vein.travelMs = 700; __fake.vein.mineMs = 700; });
  await launch(page);
  await waitText(page, '#vein-foot', /2 marches on the way\. The rest when they come back/);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 5, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => __fake.vein.maxOut), 2);
  await ctx.close();
});

test('VEIN-9: at most 10 marches a minute (30 veins)', async () => {
  const { ctx, page } = await open(VEINS, [Array.from({ length: 30 }, (_, i) => ({ x: 600 + i, y: 300, left: 60 + i })), { para6: '20' }]);
  await page.evaluate(() => { __fake.vein.travelMs = 50; __fake.vein.mineMs = 50; });
  await launch(page);
  await waitText(page, '#vein-foot', /Paused: 10 marches in a minute/, 10000);
  await page.waitForTimeout(1500);
  assert.equal((await marches(page)).length, 10);
  await ctx.close();
});

test('VEIN-10: another tool\'s march request still waiting: no march, no stop; it goes once the game is free', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await page.evaluate(() => { __fake.pending = [902]; });
  await launch(page);
  await waitText(page, '#vein-foot', /The game is busy with a march/);
  assert.equal((await marches(page)).length, 0);
  await page.evaluate(() => { __fake.pending = []; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1, null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__VEIN.running), true);
  await ctx.close();
});

test('VEIN-11: the list can\'t be read: says so, sends nothing, keeps going', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await page.evaluate(() => { __fake.vein.mode = 'listdown'; });
  await launch(page);
  await waitText(page, '#vein-foot', /Couldn't read the vein list/);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 8623).length >= 2, null, { timeout: 8000 });
  assert.equal((await marches(page)).length, 0);
  await page.evaluate(() => { __fake.vein.mode = 'ok'; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1, null, { timeout: 8000 });
  await ctx.close();
});

test('VEIN-12: the card fits a phone, folds to a bar that stays folded, drags by its title, and Stop closes it', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  await launch(page);
  await page.waitForSelector('#vein-stop');
  const r = await page.$eval('#vein-root .vein-card', (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
  assert.ok(r.l >= 0 && r.r <= 375 && r.t >= 0 && r.b <= 740, 'on screen');
  await page.click('#vein-min');
  await page.waitForSelector('#vein-root .vein-card.min');
  assert.equal(await page.evaluate(() => localStorage.getItem('vein_min_v1')), '1');
  await page.click('#vein-root .vein-head');                          // the bar opens again
  await page.waitForSelector('#vein-root .vein-card:not(.min)');
  const h = await page.$eval('#vein-root .vein-head', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
  await page.mouse.move(h.x, h.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(h.x + 10 * i, h.y + 20 * i); }
  await page.mouse.up();
  assert.ok(await page.evaluate(() => !!localStorage.getItem('ops_pos_v1_enigma-veins')), 'the spot is saved');
  await page.click('#vein-stop');
  await page.waitForFunction(() => !document.getElementById('vein-root'));
  assert.equal(await page.evaluate(() => window.__VEIN.running), false);
  await ctx.close();
});

test('VEIN-13: it reports its marches for the Tool usage panel: siteKey, name, tool, version, count, game day; no UID', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1);
  await page.waitForTimeout(500);
  const last = usageLog[usageLog.length - 1];
  assert.equal(last.type, 'text/plain');
  assert.equal(last.body.siteKey, SK); assert.equal(last.body.name, 'Tex'); assert.equal(last.body.tool, 'enigma-veins');
  assert.equal(last.body.count, 1); assert.match(last.body.day, /^\d{4}-\d{2}-\d{2}$/); assert.match(last.body.version, /^2026-10-14/);
  assert.ok(usageLog.every((u) => !u.raw.includes(UID) && !u.raw.includes('finder')), 'no UID anywhere');
  await ctx.close();
});

test('VEIN-14: a vein that passes the 5-minute line while the tool waits is not sent; the march type is the one the game names', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1, left: 5.1 }, { x: 2, y: 2, left: 30 }]]);   // 5:06 left: picked at the list (about 5:02), past 5:00 by its send (about 4:58)
  await page.evaluate(() => { __fake.marchType180 = 181; window.__VEIN_GAP_MS = 4000; window.__opsPace = { at: Date.now() }; });   // a 4 s clock wait
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const m = await marches(page);
  assert.deepEqual(m.map((p) => p.x), [2], 'the 5:06 vein crossed 5:00 during the wait and was never sent');
  assert.equal(m[0].marchType, 181);
  await ctx.close();
});

test('VEIN-15 (review): the game\'s march list shows a new march late: still never more than para6 out, and the run goes on', async () => {
  const { ctx, page } = await open(VEINS, [[{}, {}, {}], { para6: '2' }]);
  await page.evaluate(() => { Object.assign(__fake.vein, { listLagMs: 2500, travelMs: 3000, mineMs: 3000 }); });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 3, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __fake.vein.maxOut), 2, 'never a third out');
  assert.equal(await page.evaluate(() => window.__VEIN.running), true, 'no refusal stopped it');
  await ctx.close();
});

test('VEIN-16 (review): stopped while a march answer is on its way and launched again: the old run never writes into the new card', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }]]);
  await page.evaluate(() => { __fake.vein.answerMs = 1500; window.__VEIN_TIMEOUT_MS = 5000; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length === 1);
  await page.click('#vein-stop');                                    // the answer is still on its way
  await launch(page);
  await page.waitForSelector('#vein-stop');
  await page.evaluate(() => {                                         // every text the new card's last-send line ever shows
    window.__lastSeen = [];
    const e = document.getElementById('vein-last');
    new MutationObserver(() => window.__lastSeen.push(e.textContent)).observe(e, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(2000);                                   // the old answer has landed
  assert.deepEqual(await page.evaluate(() => window.__lastSeen.filter((t) => t)), [], 'the old run never wrote into the new card, not even for a moment');
  assert.equal(await page.textContent('#vein-last'), '', 'the new run sent nothing (the vein is in the sent list)');
  await ctx.close();
});

test('VEIN-17 (live 2026-10-14): the game drops a vein from your list once you have mined it: the card counts what was sent today, not mined veins in the list', async () => {
  const { ctx, page } = await open(VEINS, [[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
  await launch(page);
  await page.waitForFunction(() => __fake.vein.veins.every((v) => v.status === 2), null, { timeout: 8000 });   // both mined
  await waitText(page, '#vein-stat', /^Sent 2 today · Open 0$/, 8000);
  await page.click('#vein-min');
  await waitText(page, '#vein-mini', /^2$/);
  await ctx.close();
});
