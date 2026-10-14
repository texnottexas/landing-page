'use strict';
// HT Gift Boxes in a real browser against the fake game (test/fixtures/mapc/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ht-gifts.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['ht-gifts.js', 'ht-gifts-core.js', 'ops-tools.json', 'ops-drag.js'];
const UID = 'test-owner-uid';
const PW = crypto.createHash('sha256').update('bananas').digest('hex');

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

// The fake game with these gift boxes ([x, y, options]), the password already known unless told otherwise.
async function open(gifts, setup, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(([b, real, pw]) => {
    window.__HTG_WORKER = b.replace(/\/$/, '');
    if (!real) window.__HTG_GAP_MS = 60;
    window.__HTG_TIMEOUT_MS = 800; window.__HTG_POLL_MS = 100; window.__HTG_BUSY_MS = 300; window.__HTG_IDLE_MS = 600;
    if (pw) localStorage.setItem('htg_pw_v1', pw);
  }, [base, !!o.realPace, o.noPassword ? '' : PW]);
  await page.evaluate((list) => {
    const now = Math.floor(Date.now() / 1000);
    __fake.htg.gifts = list.map(([x, y, m]) => ({ x, y, k: 2864, m: Object.assign({ receiveBagUidList: [], endSecsTime: now + 1200, floatParadeId: 4, luckyBagNum: x, marchIdStr: 'M1' }, m || {}) }));
  }, gifts || []);
  await page.addScriptTag({ url: base + 'ht-gifts-core.js' });
  if (setup) await page.evaluate(setup);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'ht-gifts.js' });
const sent = (page) => page.evaluate(() => __fake.sent.filter((x) => [8852, 901, 902].includes(x.rid)).map((x) => ({ rid: x.rid, p: x.p, at: x.at })));
const claims = async (page) => (await sent(page)).filter((x) => x.rid === 902).map((x) => x.p.x + ',' + x.p.y);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 10000 });

test('HTG-1: the password gate: wrong is refused, "bananas" opens it, and the browser remembers it', async () => {
  const { ctx, page } = await open([[10, 10]], null, { noPassword: true });
  await launch(page);
  await page.waitForSelector('#htg-pw');
  assert.equal(await page.getAttribute('#htg-pw', 'type'), 'password');
  await page.fill('#htg-pw', 'apples'); await page.click('#htg-unlock');
  await waitText(page, '#htg-root .htg-msg', /That's not the password\./);
  assert.equal((await sent(page)).length, 0, 'nothing sent while locked');
  await page.fill('#htg-pw', '  Bananas '); await page.click('#htg-unlock');
  await page.waitForFunction(() => window.__HTG.state().view === 'run');
  assert.equal(await page.evaluate(() => localStorage.getItem('htg_pw_v1')), PW, 'remembered as the hash, never the word');
  await page.click('#htg-stop');
  await page.click('#htg-close');
  await launch(page);
  await page.waitForFunction(() => window.__HTG && window.__HTG.state().view === 'run', null, { timeout: 5000 });
  await ctx.close();
});

test('HTG-2: asks for the next gift, looks around it, claims each claimable gift box with the game\'s own claim', async () => {
  const { ctx, page } = await open([[10, 10], [11, 11], [12, 12]]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 3);
  const s = await sent(page);
  assert.deepEqual(s.slice(0, 2).map((x) => x.rid), [8852, 901]);
  assert.deepEqual(s[0].p, { queryType: 1, marchType: 256 });
  assert.deepEqual(s[1].p, { x: 10, y: 10, k: 2864, rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 });
  s.filter((x) => x.rid === 902).forEach((x) => assert.equal(x.p.marchType, 257));
  assert.deepEqual((await claims(page)).sort(), ['10,10', '11,11', '12,12']);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-3: never more than 5 gift marches out; the rest go as marches come home', async () => {
  const { ctx, page } = await open(Array.from({ length: 8 }, (_, i) => [20 + i, 20 + i]), () => { __fake.htg.travelMs = 1500; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 8, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => __fake.htg.maxOut), 5);
  assert.equal(new Set(await claims(page)).size, 8, 'each gift once');
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-4: stops at the day\'s cap, counting claims still on the way', async () => {
  const { ctx, page } = await open([[30, 30], [31, 31], [32, 32], [33, 33]], () => { __fake.htg.received = 8; __fake.htg.travelMs = 1500; });
  await launch(page);
  await waitText(page, '#htg-root .htg-msg', /Done for today: 10 of 10\./, 15000);
  assert.equal((await claims(page)).length, 2);
  await ctx.close();
});

test('HTG-5: skips gift boxes already claimed, full, or ending before the march lands', async () => {
  const { ctx, page } = await open([
    [40, 40, { receiveBagUidList: [UID] }],
    [41, 41, { receiveBagUidList: Array(20).fill('x') }],
    [42, 42, { endSecsTime: Math.floor(Date.now() / 1000) + 30 }],
    [43, 43]
  ]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1);
  await page.waitForTimeout(800);
  assert.deepEqual(await claims(page), ['43,43']);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-6: never the same gift box twice, not even after a relaunch while its march is out', async () => {
  const { ctx, page } = await open([[50, 50]], () => { __fake.htg.travelMs = 4000; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1);
  await page.click('#htg-stop');
  await page.click('#htg-close');
  await launch(page);
  await page.waitForTimeout(1500);
  assert.deepEqual(await claims(page), ['50,50']);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-7: no gift boxes: says so, looks again later, claims nothing', async () => {
  const { ctx, page } = await open([]);
  await launch(page);
  await waitText(page, '#htg-foot', /No gift boxes right now\. Looking again in/);
  await page.waitForTimeout(1200);
  const s = await sent(page);
  assert.ok(s.filter((x) => x.rid === 8852).length >= 2, 'looked again');
  assert.equal(s.filter((x) => x.rid !== 8852).length, 0);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-8: a refused claim stops with the game\'s words; an unanswered one stops too', async () => {
  const a = await open([[60, 60]], () => { __fake.htg.claimMode = 'refuse'; });
  await launch(a.page);
  await waitText(a.page, '#htg-root .htg-msg', /HT Gift Boxes stopped: The gift box is gone\./);
  await a.ctx.close();
  const b = await open([[61, 61]], () => { __fake.htg.claimMode = 'silent'; });
  await launch(b.page);
  await waitText(b.page, '#htg-root .htg-msg', /didn't answer a claim/);
  await b.ctx.close();
});

test('HTG-9: real pace: every request at least 1.5 s after the last one', async () => {
  const { ctx, page } = await open([[70, 70]], null, { realPace: true });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1, null, { timeout: 10000 });
  const s = await sent(page);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 1495, 'gap ' + (s[i].at - s[i - 1].at));
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-10: a disconnected game pauses; it carries on when the game is back', async () => {
  const { ctx, page } = await open([[80, 80]], () => { __fake.socket = 3; });
  await launch(page);
  await waitText(page, '#htg-foot', /Game disconnected/);
  await page.waitForTimeout(400);
  assert.equal((await sent(page)).length, 0);
  await page.evaluate(() => { __fake.socket = 1; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-11: the card fits a phone, folds to a bar, and reads plainly', async () => {
  const { ctx, page } = await open([[90, 90]]);
  await launch(page);
  await page.waitForFunction(() => window.__HTG.state().view === 'run');
  const box = await page.evaluate(() => {
    const r = document.querySelector('#htg-root .htg-card').getBoundingClientRect();
    const small = [...document.querySelectorAll('#htg-root button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length;
    return { right: r.right, sw: document.documentElement.scrollWidth, small, text: document.getElementById('htg-root').textContent, parent: document.getElementById('htg-root').parentNode === document.body };
  });
  assert.ok(box.right <= 375 && box.sw <= 375); assert.equal(box.small, 0); assert.ok(box.parent);
  assert.match(box.text, /Claimed today \d+\/10/); assert.match(box.text, /Out \d\/5/); assert.ok(!/—/.test(box.text));
  await page.click('#htg-min');
  assert.ok(await page.evaluate(() => document.querySelector('#htg-root .htg-card').classList.contains('min')));
  assert.ok(await page.evaluate(() => document.querySelector('#htg-root .htg-card').getBoundingClientRect().height <= 46));
  await page.click('#htg-min');
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-12: the usage report names the tool and today\'s claims, never the UID', async () => {
  const { ctx, page } = await open([[100, 100], [101, 101]]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 2);
  await page.waitForTimeout(300);
  assert.ok(usageLog.length >= 3);
  usageLog.forEach((u) => { assert.ok(!u.raw.includes(UID)); assert.equal(u.body.tool, 'ht-gifts'); assert.equal(u.type, 'text/plain'); });
  assert.equal(usageLog[usageLog.length - 1].body.count, 2);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-13: the game names a gift box the map view doesn\'t show: claimed once', async () => {
  const { ctx, page } = await open([[110, 110]], () => { __fake.htg.inview = false; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1);
  await page.waitForTimeout(1500);
  assert.deepEqual(await claims(page), ['110,110']);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-14: another tool\'s march request still waiting: no claim until it clears', async () => {
  const { ctx, page } = await open([[120, 120]], () => { __fake.pending.push(902); });
  await launch(page);
  await waitText(page, '#htg-foot', /busy with a march/);
  assert.equal((await claims(page)).length, 0);
  await page.evaluate(() => { __fake.pending.length = 0; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1);
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-15: a map view the game doesn\'t answer: no claim, says so, looks again later', async () => {
  const { ctx, page } = await open([[130, 130]], () => { __fake.lose901 = 1; });
  await launch(page);
  await waitText(page, '#htg-foot', /didn't answer\. Looking again in/);
  assert.equal((await claims(page)).length, 0, 'no blind claim');
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-16: a map view the game refuses ("too frequent"): stops with the game\'s words, no claim', async () => {
  const { ctx, page } = await open([[131, 131]], () => { __fake.viewError = 'view_too_fast'; });
  await launch(page);
  await waitText(page, '#htg-root .htg-msg', /HT Gift Boxes stopped: Too frequent\./);
  assert.equal((await claims(page)).length, 0);
  await ctx.close();
});

test('HTG-17: after a relaunch, claims still on the way count as out even when the game\'s march list doesn\'t show them', async () => {
  const { ctx, page } = await open(Array.from({ length: 7 }, (_, i) => [140 + i, 140 + i]), () => { Object.assign(__fake.htg, { travelMs: 6000, hideMarches: true }); });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 5);
  await page.click('#htg-stop'); await page.click('#htg-close');
  await launch(page);
  await page.waitForTimeout(1500);
  assert.equal((await claims(page)).length, 5, 'still 5 out: no sixth until one is home');
  await page.click('#htg-stop');
  await ctx.close();
});

test('HTG-18: another tool\'s march request turns up while a claim waits its turn: the claim waits; the gift is claimed once it clears', async () => {
  const { ctx, page } = await open([[150, 150]], () => { __fake.htg.pendAfterView = true; window.__HTG_GAP_MS = 400; });
  await launch(page);
  await waitText(page, '#htg-foot', /busy with a march/);
  assert.equal((await claims(page)).length, 0);
  await page.evaluate(() => { __fake.htg.pendAfterView = false; __fake.pending.length = 0; });
  await page.waitForFunction(() => __fake.sent.filter((s) => s.rid === 902).length >= 1, null, { timeout: 8000 });
  assert.deepEqual(await claims(page), ['150,150']);
  await page.click('#htg-stop');
  await ctx.close();
});

async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + 15, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}
const cardAt = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; }, sel);

test('HTG-19: the card drags by its title and keeps its spot after a relaunch', async () => {
  const { ctx, page } = await open([]);
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  await launch(page);
  await page.waitForFunction(() => window.__HTG.state().view === 'run');
  const a = await cardAt(page, '#htg-root');
  await dragBy(page, '#htg-root .htg-title', 20, 150);
  const b = await cardAt(page, '#htg-root');
  assert.deepEqual(b, { x: a.x + 20, y: a.y + 150 });
  await page.click('#htg-stop'); await page.click('#htg-close');
  await launch(page);
  await page.waitForFunction(() => window.__HTG.state().view === 'run');
  assert.deepEqual(await cardAt(page, '#htg-root'), b);
  await page.click('#htg-stop');
  await ctx.close();
});
