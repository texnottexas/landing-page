'use strict';
// Angel Attacks in a real browser against the fake game (test/fixtures/mapc/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/angel-attacks.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['angel-attacks.js', 'angel-attacks-core.js', 'mask-boxes.js', 'mask-boxes-core.js', 'ops-tools.json'];
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
    if (name === 'maskintel') { res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify({ ok: true, boxes: [], spots: [] })); return; }
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { usageLog = []; });

// An Angel event with these Angels (minutes left), and the fake game's knobs.
async function open(setup, arg) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => { window.__ANG_WORKER = b.replace(/\/$/, ''); window.__ANG_FAST = true; window.__ANG_CHECK_MS = 1500; window.__ANG_IDLE_MS = 1500; window.__ANG_TIMEOUT_MS = 800; window.__OPS_BASE = b; window.__MBX_WORKER = b.replace(/\/$/, ''); window.__MBX_FAST = true; }, base);
  await page.addScriptTag({ url: base + 'angel-attacks-core.js' });
  if (setup) await page.evaluate(setup, arg);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'angel-attacks.js' });
const attacks = (page) => page.evaluate(() => __fake.sent.filter((s) => s.rid === 902));
const lists = (page) => page.evaluate(() => __fake.sent.filter((s) => s.rid === 8802));
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 8000 });
const event = (angels) => {
  const now = Date.now();
  __fake.angelEvent = { id: 83000151, type: 292, endtime: Math.floor(now / 1000) + 7200, extra: { attackMonsterIds: [], groupId: 5 } };
  __fake.angels = angels.map((a, i) => Object.assign({ uuid: String(4880000000000000000n + BigInt(i + 1)), x: 100 + i, y: 200 + i, serverId: 2691, expireMilli: now + 3600000 }, a));
};

test('ANG-1: one carrier attack at each Angel, in the list\'s order, with the game\'s own request; skips attacked, ours, marching and ending ones', async () => {
  const { ctx, page } = await open(() => {
    const now = Date.now();
    __fake.angelEvent = { id: 83000151, type: 292, endtime: Math.floor(now / 1000) + 7200, extra: { attackMonsterIds: ['2'], groupId: 5 } };
    __fake.angels = [
      { uuid: '1', x: 10, y: 11, expireMilli: now + 3600000 },
      { uuid: '2', x: 20, y: 21, expireMilli: now + 3600000 },                       // attacked already
      { uuid: '3', x: 30, y: 31, expireMilli: now + 3600000, uid: 'test-owner-uid' }, // ours
      { uuid: '4', x: 40, y: 41, expireMilli: now + 3600000, hasMarch: true },
      { uuid: '5', x: 50, y: 51, expireMilli: now + 60000 },                          // ending
      { uuid: '6', x: 60, y: 61, expireMilli: now + 3600000 }
    ];
  });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 2);
  await page.waitForTimeout(1000);
  const a = await attacks(page);
  assert.deepEqual(a.map((s) => s.p), [{ isAirCraftCarrier: true, marchType: 189, x: 10, y: 11 }, { isAirCraftCarrier: true, marchType: 189, x: 60, y: 61 }]);
  assert.deepEqual((await lists(page))[0].p, { aid: 83000151, type: 2 });
  await waitText(page, '#ang-stat', /Attacked 3 this round/);            // '2' plus the two that landed
  await waitText(page, '#ang-sub', /Sent 2 this run/);
  await waitText(page, '#ang-last', /60, 61/);
  assert.ok(!/—/.test(await page.$eval('#ang-root', (e) => e.textContent)), 'no em dash');
  await ctx.close();
});

test('ANG-2: never the same Angel twice: not on the next check, not after a relaunch, not after an attack the game never answered', async () => {
  const { ctx, page } = await open(() => { __fake.angelMode = 'silent'; const now = Date.now(); __fake.angelEvent = { id: 7, endtime: Math.floor(now / 1000) + 7200, extra: { attackMonsterIds: [], groupId: 5 } }; __fake.angels = [{ uuid: '1', x: 10, y: 11, expireMilli: now + 3600000 }]; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 8802).length >= 2, null, { timeout: 8000 });   // a second check came and went
  assert.equal((await attacks(page)).length, 1, 'the lost one is not sent again');
  await page.evaluate(() => { window.__ANG.stop(); __fake.angelMode = 'ok'; });
  await launch(page);
  await page.waitForFunction(() => window.__ANG && window.__ANG.running && __fake.sent.filter((s) => s.rid === 8802).length >= 3);
  await page.waitForTimeout(800);
  assert.equal((await attacks(page)).length, 1, 'remembered across a relaunch');
  const store = await page.evaluate((sk) => JSON.parse(localStorage.getItem('ang_sent_v1_' + sk)), SK);
  assert.equal(store.eventId, '7');
  assert.deepEqual(Object.keys(store.uuids), ['1']);
  await ctx.close();
});

test('ANG-3: a refusal stops the run with the game\'s text; nothing more is sent', async () => {
  const { ctx, page } = await open(() => { __fake.angelMode = 'refuse'; });
  await page.evaluate(event, [{}, {}, {}]);
  await launch(page);
  await waitText(page, '#ang-root', /Angel Attacks stopped: March failed! A commander can only attack the same Heavy Mothership Angel once!/);
  await page.waitForTimeout(1500);
  assert.equal((await attacks(page)).length, 1);
  assert.equal(await page.evaluate(() => window.__ANG.running), false);
  await page.click('#ang-close');
  assert.equal(await page.$('#ang-root'), null);
  await ctx.close();
});

test('ANG-4: three attacks in a row with no answer stop the run', async () => {
  const { ctx, page } = await open(() => { __fake.angelMode = 'silent'; });
  await page.evaluate(event, [{}, {}, {}, {}, {}]);
  await launch(page);
  await waitText(page, '#ang-root', /stopped: the game did not answer 3 attacks in a row/, 12000);
  assert.equal((await attacks(page)).length, 3);
  await ctx.close();
});

test('ANG-5: no Angel event: says so and sends nothing', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#ang-foot', /No Angel event right now/);
  await page.waitForTimeout(2500);
  assert.deepEqual(await page.evaluate(() => __fake.sent), []);
  await ctx.close();
});

test('ANG-6: disconnected: nothing goes out until the game is back', async () => {
  const { ctx, page } = await open(() => { __fake.socket = 3; });
  await page.evaluate(event, [{}]);
  await launch(page);
  await waitText(page, '#ang-foot', /Game disconnected/);
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.evaluate(() => __fake.sent), []);
  await page.evaluate(() => { __fake.socket = 1; });
  await page.waitForFunction(() => __fake.sent.some((s) => s.rid === 902));
  await ctx.close();
});

test('ANG-7: at most 10 attacks a minute, the rest wait (50 Angels)', async () => {
  const { ctx, page } = await open();
  await page.evaluate(event, Array.from({ length: 50 }, () => ({})));
  await launch(page);
  await waitText(page, '#ang-foot', /Paused: 10 attacks in a minute/, 25000);
  await page.waitForTimeout(1500);
  assert.equal((await attacks(page)).length, 10);
  await ctx.close();
});

test('ANG-8: the card fits a phone, folds to a bar that stays folded, and Stop closes it', async () => {
  const { ctx, page } = await open();
  await page.evaluate(event, [{}]);
  await launch(page);
  await waitText(page, '#ang-stat', /Attacked/);
  const r = await page.$eval('#ang-root', (e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return { l: b.left, r: b.right, pos: c.position, z: +c.zIndex, parent: e.parentNode === document.body }; });
  assert.ok(r.l >= 0 && r.r <= 375 && r.pos === 'fixed' && r.z >= 1000 && r.parent);
  await page.click('#ang-min');
  assert.equal(await page.evaluate(() => localStorage.getItem('ang_min_v1')), '1');
  const h = await page.$eval('#ang-root .ang-card', (e) => e.getBoundingClientRect().height);
  assert.ok(h <= 48, 'a 44 px bar: ' + h);
  await page.click('#ang-root .ang-head');
  assert.equal(await page.evaluate(() => localStorage.getItem('ang_min_v1')), null);
  await page.click('#ang-stop');
  assert.equal(await page.$('#ang-root'), null);
  assert.equal(await page.evaluate(() => window.__ANG.running), false);
  await ctx.close();
});

test('ANG-9: it reports its attacks for the Tool usage panel: siteKey, name, tool, version, count, game day; no UID', async () => {
  const { ctx, page } = await open();
  await page.evaluate(event, [{}, {}]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 2);
  await page.waitForTimeout(800);
  const version = await page.evaluate(() => window.__ANG.version);
  const counts = usageLog.map((u) => u.body.count);
  assert.deepEqual(counts.slice(0, 3), [0, 1, 2]);
  usageLog.forEach((u) => {
    assert.equal(u.body.siteKey, SK); assert.equal(u.body.tool, 'angels'); assert.equal(u.body.version, version); assert.equal(u.body.name, 'Tex');
    assert.match(u.body.day, /^\d{4}-\d{2}-\d{2}$/); assert.match(u.type, /^text\/plain/); assert.ok(!u.raw.includes(UID), 'no UID');
  });
  await ctx.close();
});

test('ANG-10: the list can\'t be read: says so, attacks nothing, keeps going', async () => {
  const { ctx, page } = await open(() => { __fake.angelMode = 'listdown'; });
  await page.evaluate(event, [{}]);
  await launch(page);
  await waitText(page, '#ang-foot', /Couldn't read the Angel list/);
  assert.equal((await attacks(page)).length, 0);
  assert.equal(await page.evaluate(() => window.__ANG.running), true);
  await ctx.close();
});

test('ANG-11: the march type is the one the game names (read live, not hard-coded)', async () => {
  const { ctx, page } = await open(() => { __fake.marchType189 = 203; });
  await page.evaluate(event, [{}]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((s) => s.rid === 902));
  assert.equal((await attacks(page))[0].p.marchType, 203);
  await ctx.close();
});
