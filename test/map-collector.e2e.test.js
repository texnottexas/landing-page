'use strict';
// Map Collector in a real browser against a fake game (test/fixtures/mapc/index.html) and a fake worker.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/map-collector.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['map-collector.js', 'map-collector-core.js'];
// The fake worker registers one made-up account; no real uid appears anywhere in tests.
const OWNER_UID = 'test-owner-uid';
const OWNER_SK = crypto.createHash('sha256').update(OWNER_UID).digest('hex').slice(0, 16);

let server, base, browser, reports, workerMode;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (name === 'mapcollector/report') {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        const pw = req.headers['x-map-collector-password'];
        const body = JSON.parse(b);
        reports.push({ pw, body });
        let code = 200, out = { ok: true };
        if (workerMode === 'down') { code = 503; out = { ok: false }; }
        else if (body.siteKey !== OWNER_SK) { code = 403; out = { ok: false, error: 'not_registered' }; }
        else if (pw !== 'good pass') { code = 401; out = { ok: false, error: 'unauthorized' }; }
        else if (workerMode === 'superseded') { code = 409; out = { ok: false, error: 'superseded' }; }
        res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors));
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { reports = []; workerMode = 'ok'; });

async function start(opts) {
  const o = Object.assign({ uid: OWNER_UID, pw: 'good pass' }, opts);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((a) => {
    __fake.uid = a.uid; window.__MAPC_WORKER = a.base.replace(/\/$/, ''); window.__MAPC_REPORT_MS = 1000;
    if (a.pw) localStorage.setItem('mapc_pw_v1', a.pw);
    if (a.left != null) __fake.left = a.left;
  }, { uid: o.uid, base, pw: o.pw, left: o.left });
  await page.addScriptTag({ url: base + 'map-collector-core.js' });
  await page.addScriptTag({ url: base + 'map-collector.js' });
  return { ctx, page };
}
const sent = (page) => page.evaluate(() => __fake.sent);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 5000 });

test('an account the worker does not know sees the not-set-up message and nothing is claimed', async () => {
  const { ctx, page } = await start({ uid: 'someone-else' });
  await page.evaluate(() => __fake.notice(1, 'A', 10, 20));
  await waitText(page, '#mapc-root', /This account isn't set up for Map Collector\./);
  await page.waitForTimeout(1500);
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('a spawn notice sends the exact Claim request, paced 1.1 s apart; the card stacks the stats', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.notice(11, 'HELLFIRE', 438, 690); __fake.notice(12, 'HELLFIRE', 431, 695); });
  await page.waitForFunction(() => __fake.sent.length === 2, null, { timeout: 6000 });
  const s = await sent(page);
  assert.equal(s[0].rid, 902);
  assert.deepEqual(s[0].p, { marchType: 143, x: 438, y: 690, armyList: [], armyListNew: [], heroList: [], trapList: [], ext: {} });
  assert.equal(s[0].target, 'object');
  assert.ok(s[1].at - s[0].at >= 1100, 'second claim waits at least 1.1 s');
  await waitText(page, '#mapc-enroute', /^2$/);
  assert.equal(await text(page, '#mapc-left'), '50');
  const box = await page.$eval('#mapc-root .mapc-card', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  assert.ok(box.h > box.w, 'taller than wide');
  assert.ok(reports.length >= 1);
  assert.equal(reports[0].pw, 'good pass');
  assert.equal(reports[0].body.siteKey, OWNER_SK);
  const until = Date.now() + 5000;
  while (Date.now() < until && !reports.some((r) => r.body.maps.some((m) => m.id === '11'))) await page.waitForTimeout(200);
  assert.ok(reports.some((r) => r.body.maps.some((m) => m.id === '11')), 'the claimed map reaches the dashboard');
  await ctx.close();
});

test('"Too fast" holds that map 10 s while the next map goes first', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.answers.push({ s: 3, d: 'march_time_control_info001' }); __fake.notice(21, 'A', 1, 1); __fake.notice(22, 'A', 2, 2); });
  await page.waitForFunction(() => __fake.sent.length >= 2, null, { timeout: 6000 });
  const s = await sent(page);
  assert.deepEqual([s[0].p.x, s[1].p.x], [1, 2]);
  await page.waitForTimeout(2000);
  assert.equal((await sent(page)).length, 2, 'map 1 is still held');
  await page.waitForFunction(() => __fake.sent.length >= 3, null, { timeout: 12000 });
  assert.equal((await sent(page))[2].p.x, 1);
  await ctx.close();
});

test('a reward marks the map collected with its item name and reports it', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => __fake.notice(31, 'Rеx', 433, 647));
  await page.waitForFunction(() => __fake.sent.length === 1);
  await page.waitForTimeout(300);
  await page.evaluate(() => __fake.emit('TitanBlessWorldRewardGet', { uuid: 'u1', reward: { items: [{ itemId: 79200004, itemCount: 1 }] } }));
  await waitText(page, '#mapc-collected', /^1$/);
  await page.waitForFunction(() => true);
  const deadline = Date.now() + 5000;
  let row;
  while (Date.now() < deadline) {
    row = reports.flatMap((r) => r.body.maps).filter((m) => m.id === '31').pop();
    if (row && row.state === 'collected') break;
    await page.waitForTimeout(200);
  }
  assert.equal(row.state, 'collected');
  assert.equal(row.reward, 'Blessing Key ×1');
  await ctx.close();
});

test('a march that leaves the game list without a reward shows as missed', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.answers.push({ s: 0, d: JSON.stringify({ marchInfo: { marchId: 'mm1', marchArrive: Math.floor(Date.now() / 1000) + 600 } }) }); __fake.notice(61, 'Wonka', 5, 127); });
  await page.waitForFunction(() => __fake.sent.length === 1);
  await page.evaluate(() => { __fake.myMarch.mm1 = { marchId: 'mm1', marchArrive: Math.floor(Date.now() / 1000) + 30 }; });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { delete __fake.myMarch.mm1; });
  await waitText(page, '#mapc-missed', /^1$/, 10000);
  assert.equal(await text(page, '#mapc-enroute'), '0');
  await ctx.close();
});

test('closed socket and hidden tab are reported; report failure turns the card amber', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.socket = 3; });
  await waitText(page, '#mapc-foot', /Game disconnected/);
  await page.waitForFunction(() => document.querySelector('#mapc-root .mapc-card').classList.contains('bad'));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !reports.some((r) => r.body.status.connected === false)) await page.waitForTimeout(200);
  assert.ok(reports.some((r) => r.body.status.connected === false), 'a report says the game is disconnected');
  workerMode = 'down';
  await page.evaluate(() => { __fake.socket = 1; __fake.notice(41, 'A', 5, 5); });
  await waitText(page, '#mapc-foot', /Dashboard not reachable/, 10000);
  const border = await page.$eval('#mapc-root .mapc-card', (e) => getComputedStyle(e).borderTopColor);
  assert.equal(border, 'rgb(210, 153, 34)');
  await ctx.close();
});

test('a wrong password asks again; Stop sends a final report and removes the card', async () => {
  const { ctx, page } = await start({ pw: 'bad pass' });
  await page.waitForSelector('#mapc-pw', { timeout: 5000 });
  assert.match(await text(page, '#mapc-root'), /That password didn't work\./);
  assert.equal(await page.evaluate(() => localStorage.getItem('mapc_pw_v1')), null);
  await page.fill('#mapc-pw', 'good pass');
  await page.click('#mapc-pw-go');
  await page.waitForSelector('#mapc-enroute');
  await page.click('#mapc-stop');
  await page.waitForSelector('#mapc-root', { state: 'detached' });
  await page.waitForTimeout(300);
  const last = reports[reports.length - 1].body.status;
  assert.equal(last.state, 'stopped');
  assert.equal(last.stopReason, 'stopped by you');
  assert.equal(await page.evaluate(() => window.__MAPC.running), false);
  await ctx.close();
});

test('another collector taking over stops this one', async () => {
  workerMode = 'superseded';
  const { ctx, page } = await start();
  await waitText(page, '#mapc-root', /Another Map Collector took over/);
  await page.evaluate(() => __fake.notice(71, 'A', 1, 1));
  await page.waitForTimeout(1500);
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('out of claims stops with the reason, reports it and claims nothing', async () => {
  const { ctx, page } = await start({ left: 0 });
  await waitText(page, '#mapc-root', /no claims left/);
  await page.evaluate(() => __fake.notice(51, 'A', 1, 1));
  await page.waitForTimeout(1500);
  assert.equal((await sent(page)).length, 0);
  assert.ok(reports.some((r) => r.body.status.state === 'stopped' && r.body.status.stopReason === 'out of claims'));
  await ctx.close();
});

test('launching again while it runs keeps the same run', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  const run1 = reports[0].body.runId;
  await page.addScriptTag({ url: base + 'map-collector.js?again' });
  await page.waitForTimeout(500);
  assert.equal(await page.$$eval('#mapc-root', (l) => l.length), 1);
  assert.ok(reports.every((r) => r.body.runId === run1));
  await ctx.close();
});

test('REGRESSION 2026-10-04: a chat list longer than the seen memory never re-claims a map', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  // 700 ordinary chat rows (the live alliance list had 658 when the flood happened), then one spawn
  await page.evaluate(() => {
    for (let i = 0; i < 700; i++) __fake.chat.push({ _msgId: 'c' + i, _mt: '', _time: Math.floor(Date.now() / 1000), _msg: 'hi' });
    __fake.notice(900, 'HELLFIRE', 438, 690);
  });
  await page.waitForTimeout(12000);
  const s = await sent(page);
  assert.equal(s.length, 1, 'exactly one claim for one map, got ' + s.length);
  assert.equal(await text(page, '#mapc-enroute'), '1');
  await ctx.close();
});

test('rate limit: never more than 12 claims in a minute; the card says it paused', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { for (let i = 0; i < 13; i++) __fake.notice(1000 + i, 'Burst', 100 + i * 3, 200); });
  await page.waitForFunction(() => __fake.sent.length >= 12, null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  assert.equal((await sent(page)).length, 12);
  assert.match(await text(page, '#mapc-foot'), /Paused: too many claims in a minute/);
  await ctx.close();
});
