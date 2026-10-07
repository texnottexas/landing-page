'use strict';
// Mask Mystery Boxes in a real browser against the fake game (test/fixtures/mapc/index.html), a fake /maskintel
// feed and, for the shared-tab case, Map Collector's fake worker.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/mask-boxes.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['mask-boxes.js', 'mask-boxes-core.js', 'map-collector.js', 'map-collector-core.js', 'ops-tools.json'];
const UID = 'test-owner-uid';
const SK = crypto.createHash('sha256').update(UID).digest('hex').slice(0, 16);
const T = 260617001;                                     // a box's item is T + its type

let server, base, browser, feed, feedMode, feedHits;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (name === 'maskintel') {
      feedHits++;
      if (feedMode === 'down') { res.writeHead(502, Object.assign({ 'content-type': 'application/json' }, cors)); res.end('{"ok":false,"error":"upstream"}'); return; }
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
      res.end(JSON.stringify({ ok: true, fetchedAt: Date.now(), boxes: feed }));
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
test.beforeEach(() => { feed = []; feedMode = 'ok'; feedHits = 0; });

const box = (o) => Object.assign({ server: 619, x: 404, y: 612, owner: 'A', type: 1, endMs: Date.now() + 600000 }, o);

// The page, with the fake game set up by `setup` (runs in the page; MaskBoxesCore is loaded by then).
async function open(setup, arg) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => { window.__MBX_WORKER = b.replace(/\/$/, ''); window.__MBX_FAST = true; window.__MBX_FEED_MS = 1000; window.__MBX_TIMEOUT_MS = 1000; window.__MBX_LATE_MS = 5000; }, base);
  await page.addScriptTag({ url: base + 'mask-boxes-core.js' });
  if (setup) await page.evaluate(setup, arg);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'mask-boxes.js' });
const sent = (page) => page.evaluate(() => __fake.sent);
const waitSent = (page, n, timeout) => page.waitForFunction((k) => __fake.sent.length >= k, n, { timeout: timeout || 10000 });
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 6000 });
const gaps = (s) => s.slice(1).map((x, i) => x.at - s[i].at);

test('two reported boxes: soonest-ending first, the exact view and collect requests, 1.1 s or more apart; counted by type', async () => {
  feed = [box({ server: 619, x: 404, y: 612, type: 1, endMs: Date.now() + 600000 }), box({ server: 4002, x: 400, y: 596, type: 2, endMs: Date.now() + 300000 })];
  const { ctx, page } = await open((t) => {
    __fake.cities['4002:400:596'] = { pid: '111', itemId: t + 2, instanceId: 'i1' };
    __fake.cities['619:404:612'] = { pid: '222', itemId: t + 1, instanceId: 'i2' };
  }, T);
  await launch(page);
  await waitSent(page, 4);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid), [901, 2503, 901, 2503]);
  assert.deepEqual(s[0].p, { x: 400, y: 596, k: 4002, rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 });
  assert.deepEqual(s[1].p, { targetUidStr: '111' });
  assert.equal(s[1].target, 'object');
  assert.deepEqual(s[3].p, { targetUidStr: '222' });
  gaps(s).forEach((g) => assert.ok(g >= 1100, 'gap ' + g + ' ms'));
  await waitText(page, '#mbx-t1', /1\/20/);
  assert.match(await text(page, '#mbx-t2'), /HT\s*1\/20/);
  assert.match(await text(page, '#mbx-t3'), /RSS\s*0\/20/);
  await waitText(page, '#mbx-last', /Mask Treasure ×1 from S619 \(404, 612\)/);
  assert.equal(await page.getAttribute('#mbx-t1', 'aria-label'), 'Treasure 1/20 since reset');
  const store = await page.evaluate((k) => JSON.parse(localStorage.getItem('mbx_count_v1_' + k)), SK);
  assert.deepEqual(store.counts, { 1: 1, 2: 1, 3: 0 });
  await page.waitForTimeout(1500);
  assert.equal((await sent(page)).length, 4, 'each box is tried once per run');
  await ctx.close();
});

test('a box that is gone (no cityReward, or no city) gets no collect; the next box still goes', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 }), box({ server: 3, endMs: Date.now() + 300000 })];
  const { ctx, page } = await open((t) => {
    __fake.cities['1:404:612'] = { pid: '1' };                                    // the box is gone
    __fake.cities['3:404:612'] = { pid: '3', itemId: t + 3, instanceId: 'r3' };  // reported as Treasure, really RSS
  }, T);
  await launch(page);
  await waitSent(page, 4);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid + ':' + (x.p.k || x.p.targetUidStr)), ['901:1', '901:2', '901:3', '2503:3']);
  await waitText(page, '#mbx-t3', /1\/20/);
  assert.match(await text(page, '#mbx-t1'), /0\/20/, 'counted by the box\'s own type');
  await ctx.close();
});

test('"Reward claimed" records the box: no count; a relaunch skips the remembered spot, and without spot memory views it but never collects it', async () => {
  feed = [box({ server: 5 })];
  const { ctx, page } = await open((t) => { __fake.cities['5:404:612'] = { pid: '5', itemId: t + 1, instanceId: 'c5' }; __fake.claimed.c5 = 1; }, T);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForFunction((k) => { const d = JSON.parse(localStorage.getItem('mbx_done_v1_' + k) || 'null'); return !!d && d.ids.includes('c5'); }, SK);
  assert.match(await text(page, '#mbx-t1'), /0\/20/);
  await page.evaluate(() => { __MBX.stop(); __fake.sent = []; });
  await page.waitForFunction(() => !document.getElementById('mbx-root'));
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  await page.waitForTimeout(2500);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [], 'the spot is remembered: not viewed again');
  await page.evaluate((k) => { __MBX.stop(); localStorage.removeItem('mbx_spots_v1_' + k); }, SK);
  await page.waitForFunction(() => !document.getElementById('mbx-root'));
  await launch(page);
  await waitSent(page, 1);
  await page.waitForTimeout(2500);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [901], 'without spot memory: viewed, not collected');
  await ctx.close();
});

test('an answer it has never seen stops the run with the game\'s own text, and nothing more is sent', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 }), box({ server: 3, endMs: Date.now() + 300000 })];
  const { ctx, page } = await open((t) => {
    [1, 2, 3].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'l' + k }; });
    __fake.limitAfter = 1;
  }, T);
  await launch(page);
  await waitText(page, '#mbx-root', /Mask Mystery Boxes stopped: Daily limit reached/, 12000);
  const n = (await sent(page)).length;
  assert.equal(n, 4);
  await page.waitForTimeout(2500);
  assert.equal((await sent(page)).length, n);
  assert.equal(await page.evaluate(() => __MBX.running), false);
  await ctx.close();
});

test('the daily 20: a type already at 20 today is not even viewed', async () => {
  feed = [box({ server: 1, type: 1, endMs: Date.now() + 100000 }), box({ server: 2, type: 3, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open(([t, sk]) => {
    __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 'd1' };
    __fake.cities['2:404:612'] = { pid: '2', itemId: t + 3, instanceId: 'd2' };
    localStorage.setItem('mbx_count_v1_' + sk, JSON.stringify({ day: MaskBoxesCore.gameDay(Date.now()), counts: { 1: 20 } }));
  }, [T, SK]);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(1500);
  assert.deepEqual((await sent(page)).map((x) => x.rid + ':' + (x.p.k || x.p.targetUidStr)), ['901:2', '2503:2']);
  assert.match(await text(page, '#mbx-t1'), /20\/20/);
  await ctx.close();
});

test('type toggles: a type switched off is skipped, and the choice is remembered on the next launch', async () => {
  const { ctx, page } = await open((t) => {
    __fake.cities['1:404:612'] = { pid: '1', itemId: t + 3, instanceId: 'g1' };
    __fake.cities['2:404:612'] = { pid: '2', itemId: t + 1, instanceId: 'g2' };
  }, T);
  await launch(page);
  await page.waitForSelector('#mbx-t3[aria-pressed="true"]');
  await page.click('#mbx-t3');
  await page.waitForSelector('#mbx-t3[aria-pressed="false"]');
  feed = [box({ server: 1, type: 3, endMs: Date.now() + 100000 }), box({ server: 2, type: 1, endMs: Date.now() + 200000 })];
  await waitSent(page, 2);
  await page.waitForTimeout(1500);
  assert.deepEqual((await sent(page)).map((x) => x.rid + ':' + (x.p.k || x.p.targetUidStr)), ['901:2', '2503:2']);
  await page.evaluate(() => __MBX.stop());
  await launch(page);
  await page.waitForSelector('#mbx-t3[aria-pressed="false"]');
  assert.equal(await page.getAttribute('#mbx-t1', 'aria-pressed'), 'true');
  await ctx.close();
});

test('box list unavailable: the card says so and no game request is sent', async () => {
  feedMode = 'down';
  const { ctx, page } = await open((t) => { __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 'u1' }; }, T);
  await launch(page);
  await waitText(page, '#mbx-foot', /Box list unavailable/);
  await page.waitForTimeout(2500);
  assert.ok(feedHits >= 2, 'it keeps checking');
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('launching again while it runs brings the card forward instead of starting a second loop', async () => {
  feed = [box({ server: 1 })];
  const { ctx, page } = await open((t) => { __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 'a1' }; }, T);
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(2000);
  assert.equal((await sent(page)).length, 2);
  assert.equal(await page.$$eval('#mbx-root', (e) => e.length), 1);
  await ctx.close();
});

test('as part of Map Collector: its card starts Mask Boxes in the same tab, every request from both tools is 1.1 s or more apart, and the button stops it', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open(([t, b]) => {
    __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 'm1' };
    __fake.cities['2:404:612'] = { pid: '2', itemId: t + 2, instanceId: 'm2' };
    window.__OPS_BASE = b; window.__MAPC_WORKER = b.replace(/\/$/, ''); window.__MAPC_REPORT_MS = 1000;
    localStorage.setItem('mapc_pw_v1', 'good pass');
  }, [T, base]);
  await page.addScriptTag({ url: base + 'map-collector-core.js' });
  await page.addScriptTag({ url: base + 'map-collector.js' });
  await page.waitForSelector('#mapc-mbx[aria-pressed="false"]');
  assert.match(await text(page, '#mapc-mbx'), /Mask Boxes off/);
  await page.click('#mapc-mbx');
  await page.waitForSelector('#mbx-root #mbx-t1');
  await page.waitForSelector('#mapc-mbx[aria-pressed="true"]');
  await page.evaluate(() => { __fake.notice(91, 'A', 10, 20); __fake.notice(92, 'A', 11, 21); });
  await waitSent(page, 6, 15000);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid).sort(), [2503, 2503, 901, 901, 902, 902]);
  gaps(s).forEach((g) => assert.ok(g >= 1100, 'gap ' + g + ' ms between the two tools'));
  const r = await page.$eval('#mbx-root', (e) => e.getBoundingClientRect().toJSON());
  const m = await page.$eval('#mapc-root', (e) => e.getBoundingClientRect().toJSON());
  assert.ok(r.bottom <= m.top || m.bottom <= r.top, 'the two cards do not overlap');
  await page.click('#mapc-mbx');
  await page.waitForFunction(() => !document.getElementById('mbx-root'));
  await page.waitForSelector('#mapc-mbx[aria-pressed="false"]');
  assert.equal(await page.evaluate(() => __MBX.running), false);
  assert.equal(await page.evaluate(() => __MAPC.running), true, 'Map Collector keeps running');
  await ctx.close();
});

test('as part of Map Collector in Unattended mode: Mask Boxes uses the framed game, never the paused outer one', async () => {
  feed = [box({ server: 7 })];
  const { ctx, page } = await open((b) => {
    window.__OPS_BASE = b; window.__MAPC_WORKER = b.replace(/\/$/, ''); window.__MAPC_REPORT_MS = 1000;
    localStorage.setItem('mapc_pw_v1', 'good pass');
  }, base);
  await page.addScriptTag({ url: base + 'map-collector-core.js' });
  await page.addScriptTag({ url: base + 'map-collector.js' });
  await page.waitForSelector('#mapc-unattended');
  await page.click('#mapc-unattended');
  await page.click('#mapc-unattended-go');
  await page.waitForFunction(() => window.__MAPC && window.__MAPC.attached === 'frame', null, { timeout: 15000 });
  await page.evaluate((t) => { document.getElementById('mapc-frame').contentWindow.__fake.cities['7:404:612'] = { pid: '7', itemId: t + 1, instanceId: 'f7' }; }, T);
  await page.click('#mapc-mbx');
  await page.waitForFunction(() => document.getElementById('mapc-frame').contentWindow.__fake.sent.filter((x) => x.rid === 2503).length === 1, null, { timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => document.getElementById('mapc-frame').contentWindow.__fake.sent.map((x) => x.rid)), [901, 2503]);
  assert.equal((await sent(page)).length, 0, 'nothing goes through the paused outer game');
  await waitText(page, '#mbx-t1', /1\/20/);
  assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('mbx-root')).zIndex > getComputedStyle(document.getElementById('mapc-frame')).zIndex), 'the card stays above the game');
  await ctx.close();
});

test('a relaunch after a stop message replaces the old card instead of stacking a second one', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open((t) => {
    [1, 2].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'r' + k }; });
    __fake.limitAfter = 1;
  }, T);
  await launch(page);
  await waitText(page, '#mbx-root', /stopped: Daily limit reached/, 12000);
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  assert.equal(await page.$$eval('#mbx-root', (e) => e.length), 1);
  await ctx.close();
});

// ---------------------------------------------------------------- final review fixes
const rids = async (page) => (await sent(page)).map((x) => x.rid);

test('REVIEW #1: the socket closing while a collect waits on the shared clock means the collect is never sent', async () => {
  feed = [box({ server: 1 })];
  const { ctx, page } = await open((t) => {
    __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 's1' };
    const N = __require('NetMgr').NET, orig = N.send;
    N.send = function (rid) {                            // another Ops tool holds the clock; the game drops 1 s later
      const r = orig.apply(this, arguments);
      if (rid === 901) { window.__opsPace = { at: Date.now() + 2500 }; setTimeout(() => { __fake.socket = 3; }, 1000); }
      return r;
    };
  }, T);
  await launch(page);
  await waitSent(page, 1);
  await page.waitForTimeout(6000);
  assert.deepEqual(await rids(page), [901]);
  await ctx.close();
});

test('REVIEW #3: a game error on the view stops the run with the game\'s own text', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open((t) => {
    [1, 2].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'v' + k }; });
    __fake.viewError = 'view_too_fast';
  }, T);
  await launch(page);
  await waitText(page, '#mbx-root', /Mask Mystery Boxes stopped: Too frequent/);
  await page.waitForTimeout(2000);
  assert.deepEqual(await rids(page), [901]);
  await ctx.close();
});

test('REVIEW #3: a collect that answers success with no reward stops the run', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open((t) => {
    [1, 2].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'e' + k }; });
    __fake.emptyReward = true;
  }, T);
  await launch(page);
  await waitText(page, '#mbx-root', /Mask Mystery Boxes stopped: a collect came back without a reward/);
  await page.waitForTimeout(2000);
  assert.deepEqual(await rids(page), [901, 2503]);
  await ctx.close();
});

test('REVIEW #4: a city reward that is not a Mask Mystery box is never collected', async () => {
  feed = [box({ server: 1 })];
  const { ctx, page } = await open(() => { __fake.cities['1:404:612'] = { pid: '1', itemId: 999, instanceId: 'x1' }; });
  await launch(page);
  await waitSent(page, 1);
  await page.waitForTimeout(2500);
  assert.deepEqual(await rids(page), [901]);
  await ctx.close();
});

test('REVIEW #6: an unanswered request holds the next one until its answer comes or 5 s (test value) pass', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open((t) => {
    [1, 2].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'h' + k }; });
    __fake.lose901 = 1;
  }, T);
  await launch(page);
  await waitSent(page, 2, 12000);
  const s = await sent(page);
  assert.deepEqual(s.slice(0, 2).map((x) => x.p.k), [1, 2]);
  assert.ok(s[1].at - s[0].at >= 5000, 'second view ' + (s[1].at - s[0].at) + ' ms after the unanswered one');
  await ctx.close();
});

test('REVIEW #7: a reward list with an empty entry is still counted and the run carries on', async () => {
  feed = [box({ server: 1, endMs: Date.now() + 100000 }), box({ server: 2, endMs: Date.now() + 200000 })];
  const { ctx, page } = await open((t) => {
    [1, 2].forEach((k) => { __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'n' + k }; });
    __fake.nullItem = true;
  }, T);
  await launch(page);
  await waitSent(page, 4);
  await waitText(page, '#mbx-t1', /2\/20/);
  assert.equal(await page.evaluate(() => __MBX.running), true);
  await ctx.close();
});

test('REVIEW #7: an unexpected error stops the run with a message instead of a frozen card', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  await page.evaluate(() => { MaskBoxesCore.candidates = () => { throw new Error('boom'); }; });
  feed = [box({ server: 1 })];
  await waitText(page, '#mbx-root', /Mask Mystery Boxes stopped: something went wrong \(boom\)/, 8000);
  assert.equal(await page.evaluate(() => __MBX.running), false);
  await ctx.close();
});

test('LIVE: the game\'s own count shows on the card and a type the game says is at 20 is skipped; its collected boxes are never collected', async () => {
  feed = [box({ server: 1, type: 1, endMs: Date.now() + 100000 }), box({ server: 2, type: 3, endMs: Date.now() + 200000 }), box({ server: 3, type: 3, endMs: Date.now() + 300000 })];
  const { ctx, page } = await open((t) => {
    __fake.cities['1:404:612'] = { pid: '1', itemId: t + 1, instanceId: 'w1' };
    __fake.cities['2:404:612'] = { pid: '2', itemId: t + 3, instanceId: 'w2' };
    __fake.cities['3:404:612'] = { pid: '3', itemId: t + 3, instanceId: 'w3' };
    __fake.serverNum = { 260617002: 20, 260617004: 4 }; __fake.serverIds = ['w2'];
  }, T);
  await launch(page);
  await waitText(page, '#mbx-t1', /20\/20/);
  await waitSent(page, 3);
  await page.waitForTimeout(2000);
  assert.deepEqual((await sent(page)).map((x) => x.rid + ':' + (x.p.k || x.p.targetUidStr)), ['901:2', '901:3', '2503:3']);
  await waitText(page, '#mbx-t3', /5\/20/);
  await ctx.close();
});

// ---------------------------------------------------------------- chat sources and spot memory (2026-10-07)
const ks = async (page) => (await sent(page)).map((x) => x.rid + ':' + (x.p.k || x.p.targetUidStr));

test('CHAT-1: feed down: box cards in world chat are viewed and collected, soonest-ending first; the card says it is using chat', async () => {
  feedMode = 'down';
  const { ctx, page } = await open((t) => {
    const now = Date.now();
    [[1, 300000], [2, 100000], [3, 200000]].forEach(([k, left]) => {
      __fake.cities[k + ':404:612'] = { pid: String(k), itemId: t + 1, instanceId: 'w' + k, endMs: now + left };
      __fake.card('w', k, 404, 612, 1, now + left);
    });
  }, T);
  await launch(page);
  await waitSent(page, 6, 15000);
  assert.deepEqual(await ks(page), ['901:2', '2503:2', '901:3', '2503:3', '901:1', '2503:1']);
  await waitText(page, '#mbx-foot', /Box list unavailable · using chat/);
  await waitText(page, '#mbx-t1', /3\/20/);
  await ctx.close();
});

test('CHAT-2: a box card in alliance chat is collected too', async () => {
  const { ctx, page } = await open((t) => {
    const end = Date.now() + 300000;
    __fake.cities['5:404:612'] = { pid: '5', itemId: t + 2, instanceId: 'a5', endMs: end };
    __fake.card('a', 5, 404, 612, 2, end);
  }, T);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(1500);
  assert.deepEqual(await ks(page), ['901:5', '2503:5']);
  await ctx.close();
});

test('CHAT-3: the same box shared three times and listed by the feed is viewed once; after a relaunch its spot is not viewed again', async () => {
  const end = Date.now() + 600000;
  feed = [box({ server: 6, endMs: end })];
  const { ctx, page } = await open(([t, e]) => {
    __fake.cities['6:404:612'] = { pid: '6', itemId: t + 1, instanceId: 'r6', endMs: e };
    __fake.card('w', 6, 404, 612, 1, e); __fake.card('w', 6, 404, 612, 1, e); __fake.card('a', 6, 404, 612, 1, e);
  }, [T, end]);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(2500);
  assert.deepEqual(await ks(page), ['901:6', '2503:6']);
  await page.evaluate(() => { __MBX.stop(); __fake.sent = []; });
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  await page.evaluate((e) => __fake.card('w', 6, 404, 612, 1, e), end);
  await page.waitForTimeout(3500);
  assert.deepEqual(await ks(page), [], 'the remembered spot is not viewed again');
  await ctx.close();
});

test('CHAT-4: a fresh base share in world chat is viewed once and its box collected; an 11-minute-old one and an alliance one are not', async () => {
  const { ctx, page } = await open((t) => {
    const end = Date.now() + 600000;
    __fake.cities['7:450:610'] = { pid: '7', itemId: t + 3, instanceId: 'b7', endMs: end };
    __fake.cities['8:450:610'] = { pid: '8', itemId: t + 1, instanceId: 'b8', endMs: end };
    __fake.cities['9:450:610'] = { pid: '9', itemId: t + 1, instanceId: 'b9', endMs: end };
    __fake.base('w', 7, 450, 610, 30); __fake.base('w', 8, 450, 610, 660); __fake.base('a', 9, 450, 610, 30);
  }, T);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(3000);
  assert.deepEqual(await ks(page), ['901:7', '2503:7']);
  await waitText(page, '#mbx-t3', /1\/20/);
  await ctx.close();
});

test('CHAT-5: a base share with no box is viewed once; shared again after a relaunch it is not viewed again', async () => {
  const { ctx, page } = await open(() => { __fake.cities['10:450:610'] = { pid: '10' }; __fake.base('w', 10, 450, 610, 30); });
  await launch(page);
  await waitSent(page, 1);
  await page.waitForTimeout(2000);
  assert.deepEqual(await ks(page), ['901:10']);
  await page.evaluate(() => { __MBX.stop(); __fake.sent = []; });
  await launch(page);
  await page.waitForSelector('#mbx-t1');
  await page.evaluate(() => __fake.base('w', 10, 450, 610, 0));
  await page.waitForTimeout(3500);
  assert.deepEqual(await ks(page), []);
  await ctx.close();
});

test('CHAT-6: base shares are rationed: five fresh ones, three views', async () => {
  const { ctx, page } = await open(() => { [11, 12, 13, 14, 15].forEach((k, i) => { __fake.cities[k + ':450:610'] = { pid: String(k) }; __fake.base('w', k, 450, 610, 10 + i * 10); }); });
  await launch(page);
  await waitSent(page, 3, 10000);
  await page.waitForTimeout(4000);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [901, 901, 901]);
  await waitText(page, '#mbx-src', /Bases 5/);
  await ctx.close();
});

// ---------------------------------------------------------------- sharing mode (2026-10-07)
const shares = (page) => page.evaluate(() => __fake.shares);

test('SHARE-1: sharing is off by default and a collect posts nothing; the switch turns it on and is remembered', async () => {
  const end = Date.now() + 600000;
  feed = [box({ server: 21, endMs: end })];
  const { ctx, page } = await open(([t, e]) => { __fake.cities['21:404:612'] = { pid: '21', itemId: t + 1, instanceId: 's21', endMs: e, host: 'Hosty' }; }, [T, end]);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(3000);
  assert.equal((await shares(page)).length, 0);
  assert.equal(await page.getAttribute('#mbx-share', 'aria-pressed'), 'false');
  await page.click('#mbx-share');
  await page.waitForSelector('#mbx-share[aria-pressed="true"]');
  assert.equal(await page.evaluate(() => localStorage.getItem('mbx_share_v1')), '1');
  await ctx.close();
});

test('SHARE-2: sharing on: after a collect the game\'s exact card is posted to world chat once', async () => {
  const end = Date.now() + 600000;
  feed = [box({ server: 864, x: 405, y: 429, endMs: end })];
  const { ctx, page } = await open(([t, e]) => { localStorage.setItem('mbx_share_v1', '1'); __fake.cities['864:405:429'] = { pid: '22', itemId: t + 1, instanceId: 's22', endMs: e, host: 'Super🐝' }; }, [T, end]);
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 10000 });
  await page.waitForTimeout(2000);
  const s = await shares(page);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].link, { t: 48, icon: 'm/UserItemCityReward/images/shareIcon2', s: 'JMR_bs_001', p: { x: 405, y: 429 },
    extra: { btnKey: '102385', aid: 0, shareBgPath: 'image/NChat/chat_v3_share_bg11', shareIconPath: 'image/NChat/chat_v3_share_icon_pos5', shareTitleColor: '#5674d2', expireTime: end / 1000, contentParams: ['Super🐝'], jumpServerId: 864 },
    actt: 63, uts: 1 });
  await waitText(page, '#mbx-shared', /Shared 1/);
  await ctx.close();
});

test('SHARE-3: a box world chat already has a card for is collected but not shared', async () => {
  const end = Date.now() + 600000;
  const { ctx, page } = await open(([t, e]) => {
    localStorage.setItem('mbx_share_v1', '1');
    __fake.cities['23:404:612'] = { pid: '23', itemId: t + 1, instanceId: 's23', endMs: e };
    __fake.card('w', 23, 404, 612, 1, e);
  }, [T, end]);
  await launch(page);
  await waitSent(page, 2);
  await page.waitForTimeout(3500);
  assert.deepEqual(await ks(page), ['901:23', '2503:23']);
  assert.equal((await shares(page)).length, 0);
  await ctx.close();
});

test('SHARE-4: two collects close together are both shared, the second at least 10 s after the first', async () => {
  const end = Date.now() + 600000;
  feed = [box({ server: 24, endMs: end - 1000 }), box({ server: 25, endMs: end })];
  const { ctx, page } = await open(([t, e]) => {
    localStorage.setItem('mbx_share_v1', '1');
    __fake.cities['24:404:612'] = { pid: '24', itemId: t + 1, instanceId: 's24', endMs: e - 1000 };
    __fake.cities['25:404:612'] = { pid: '25', itemId: t + 2, instanceId: 's25', endMs: e };
  }, [T, end]);
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 2, null, { timeout: 25000 });
  const s = await shares(page);
  assert.deepEqual(s.map((x) => x.link.extra.jumpServerId), [24, 25]);
  assert.ok(s[1].at - s[0].at >= 10000, 'gap ' + (s[1].at - s[0].at) + ' ms');
  await ctx.close();
});

test('SHARE-5: our own card coming back in world chat does not cause another view of that box', async () => {
  const end = Date.now() + 600000;
  feed = [box({ server: 26, endMs: end })];
  const { ctx, page } = await open(([t, e]) => { localStorage.setItem('mbx_share_v1', '1'); __fake.cities['26:404:612'] = { pid: '26', itemId: t + 1, instanceId: 's26', endMs: e }; }, [T, end]);
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 10000 });
  await page.waitForTimeout(4000);
  assert.deepEqual(await ks(page), ['901:26', '2503:26']);
  await ctx.close();
});
