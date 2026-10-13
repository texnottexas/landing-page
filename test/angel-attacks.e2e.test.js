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
const OWN = ['angel-attacks.js', 'angel-attacks-core.js', 'mask-boxes.js', 'mask-boxes-core.js', 'map-collector.js', 'map-collector-core.js', 'ops-tools.json'];
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
    if (name === 'mapcollector/report') {                 // Map Collector's worker, just enough to run
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
        res.end(JSON.stringify({ ok: true, settings: { speedOn: false, gemReserve: 100, gemCap: 1000 }, spentToday: 0, now: Date.now() }));
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
  await waitText(page, '#ang-sub', /^On the way \d+ · Sent 2$/);
  await waitText(page, '#ang-last', /^Attacked 60, 61 · S2691$/);
  const cut = await page.evaluate(() => ['ang-stat', 'ang-sub', 'ang-last'].filter((id) => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth; }));
  assert.deepEqual(cut, [], 'no line is cut off on the 190 px card');
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

test('ANG-4: an attack the game never answers stays pending in the game: no second attack goes out, and the run stops saying so', async () => {
  const { ctx, page } = await open(() => { __fake.angelMode = 'silent'; });
  await page.evaluate(event, [{}, {}, {}, {}, {}]);
  await launch(page);
  await waitText(page, '#ang-root', /stopped: the game stopped answering attacks/, 15000);
  assert.equal((await attacks(page)).length, 1, 'nothing more while the game still waits for the first');
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
  assert.ok(await page.$eval('#ang-foot', (e) => e.scrollWidth <= e.clientWidth), 'the reason is shown in full, not cut off');
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

test('MBX-ANG-1: the Mask Boxes card\'s Angels switch loads Angel Attacks at the registry\'s version and turns it off; both tools keep 1.1 s apart', async () => {
  const { ctx, page } = await open();
  await page.evaluate(event, [{}, {}, {}]);
  await page.evaluate(() => {                                       // a Mask box in chat, so both tools have work at once
    __fake.cities['619:404:612'] = { pid: '22', itemId: 260617002, instanceId: 'm1', endMs: Date.now() + 600000 };
    __fake.card('w', 619, 404, 612, 1, Date.now() + 600000);
  });
  await page.addScriptTag({ url: base + 'mask-boxes-core.js' });
  await page.addScriptTag({ url: base + 'mask-boxes.js' });
  await page.waitForSelector('#mbx-angels');
  assert.equal(await page.getAttribute('#mbx-angels', 'aria-pressed'), 'false');
  // one row of three buttons, so the card is no taller (it must still fit beside Map Collector's on a phone); Share keeps its words
  const row = await page.evaluate(() => { const b = ['mbx-share', 'mbx-angels', 'mbx-stop'].map((id) => document.getElementById(id));
    return { same: b.every((x) => x.parentNode === b[0].parentNode), fits: b.every((x) => x.scrollWidth <= x.clientWidth), tall: b.every((x) => x.getBoundingClientRect().height >= 44), text: b.map((x) => x.textContent) }; });
  assert.deepEqual(row, { same: true, fits: true, tall: true, text: ['Share: off', 'Angels: off', 'Stop'] });
  await page.click('#mbx-angels');
  await page.waitForFunction(() => window.__ANG && window.__ANG.running);
  await page.waitForFunction(() => document.getElementById('mbx-angels').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 3);
  await page.waitForFunction(() => __fake.sent.some((s) => s.rid === 2503));
  const rids = await page.evaluate(() => __fake.sent.map((s) => s.rid));
  assert.ok(rids.includes(901) && rids.includes(902), 'both tools sent: ' + rids.join(','));
  const gaps = await page.evaluate(() => { const s = __fake.sent; return s.slice(1).map((x, i) => x.at - s[i].at); });
  assert.ok(gaps.every((g) => g >= 1050), 'every request from the two tools 1.1 s apart: ' + gaps.join(','));
  const pos = await page.evaluate(() => [document.getElementById('mbx-root').getBoundingClientRect().bottom, document.getElementById('ang-root').getBoundingClientRect().top]);
  assert.ok(pos[1] >= pos[0], 'the Angels card sits under the Mask Boxes card');
  await page.click('#mbx-angels');
  await page.waitForFunction(() => !window.__ANG.running && document.getElementById('mbx-angels').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.$('#ang-root'), null);
  await ctx.close();
});

test('MBX-ANG-2: Map Collector, Mask Boxes and Angel Attacks all open on a phone: no card covers another, all on screen', async () => {
  const { ctx, page } = await open((b) => { window.__MAPC_WORKER = b.replace(/\/$/, ''); window.__MAPC_REPORT_MS = 1000; localStorage.setItem('mapc_pw_v1', 'good pass'); }, base);
  await page.evaluate(event, [{}]);
  await page.addScriptTag({ url: base + 'mask-boxes-core.js' });
  await page.addScriptTag({ url: base + 'map-collector-core.js' });
  await page.addScriptTag({ url: base + 'map-collector.js' });
  await page.waitForSelector('#mapc-mbx');
  await page.click('#mapc-mbx');
  await page.waitForSelector('#mbx-angels');
  await page.click('#mbx-angels');
  await page.waitForFunction(() => window.__ANG && window.__ANG.running && document.getElementById('ang-stat'));
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ['mapc-root', 'mbx-root', 'ang-root'].map((id) => document.getElementById(id).querySelector('div').getBoundingClientRect().toJSON()));
  const over = (a, b) => !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
  assert.ok(!over(r[0], r[1]) && !over(r[0], r[2]) && !over(r[1], r[2]), 'no overlap: ' + JSON.stringify(r.map((x) => [x.left, x.top, x.right, x.bottom].map(Math.round))));
  r.forEach((x) => assert.ok(x.left >= 0 && x.right <= 375 && x.top >= 0 && x.bottom <= 740, 'on screen'));
  assert.equal(await page.evaluate(() => localStorage.getItem('ang_min_v1')), null, 'a fold made for room is not saved as the player\'s choice');
  await page.click('#ang-root .ang-head');                          // the player can still open it
  await page.waitForFunction(() => !document.querySelector('#ang-root .ang-card').classList.contains('min'));
  assert.equal(await page.evaluate(() => localStorage.getItem('ang_min_v1')), null);
  await ctx.close();
});

test('ANG-12: another tool\'s march request still waiting (the game says busy): no attack, no strike against us, and it goes out once the game is free', async () => {
  const { ctx, page } = await open(() => { __fake.pending.push(902); });
  await page.evaluate(event, [{}]);
  await launch(page);
  await waitText(page, '#ang-foot', /The game is busy with a march/);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 8802).length >= 4, null, { timeout: 12000 });   // several checks, all busy
  assert.equal((await attacks(page)).length, 0);
  assert.equal(await page.evaluate(() => window.__ANG.running), true, 'busy because of someone else is not a reason to stop');
  await page.evaluate(() => { __fake.pending = []; });
  await page.waitForFunction(() => __fake.sent.some((s) => s.rid === 902), null, { timeout: 8000 });
  await ctx.close();
});

test('ANG-13: at most 8 attacks on the way at once (8 is what the game was seen to take); the rest go when some have landed', async () => {
  const { ctx, page } = await open(() => { __fake.landMs = 12000; });   // live marches take minutes; 8 must be out together
  await page.evaluate(event, Array.from({ length: 10 }, () => ({})));
  await launch(page);
  await waitText(page, '#ang-foot', /8 attacks on the way/, 20000);
  assert.equal((await attacks(page)).length, 8);
  assert.match(await page.textContent('#ang-sub'), /On the way 8/);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 10, null, { timeout: 25000 });   // after landing, the rest
  const xy = (await attacks(page)).map((s) => s.p.x + ',' + s.p.y);
  assert.equal(new Set(xy).size, xy.length, 'each Angel once');
  await ctx.close();
});
