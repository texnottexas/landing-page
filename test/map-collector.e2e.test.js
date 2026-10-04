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

let server, base, browser, reports, workerMode, cmdSent, settings;
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
        let code = 200, out = { ok: true }, wait = 0;
        if (workerMode === 'slow') wait = 4000;
        if (workerMode === 'down') { code = 503; out = { ok: false }; }
        else if (body.siteKey !== OWNER_SK) { code = 403; out = { ok: false, error: 'not_registered' }; }
        else if (pw !== 'good pass') { code = 401; out = { ok: false, error: 'unauthorized' }; }
        else if (workerMode === 'superseded') { code = 409; out = { ok: false, error: 'superseded' }; }
        else if (workerMode === 'reconnectOnce' && body.status.kicked && !cmdSent) { cmdSent = true; out = { ok: true, command: 'reconnect' }; }
        else if (workerMode === 'reject1' && body.maps.some((m) => m.id === '81' && m.state === 'gone') && !cmdSent) { cmdSent = true; code = 400; out = { ok: false, error: 'bad_map' }; }
        if (code === 200 && out.ok) {                     // like the worker: a card change is stored, every answer echoes the settings
          if (body.settings && typeof body.settings.speedOn === 'boolean') settings.speedOn = body.settings.speedOn;
          out.settings = Object.assign({}, settings); out.spentToday = 0;
        }
        setTimeout(() => {
          res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors));
          res.end(JSON.stringify(out));
        }, wait);
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
test.beforeEach(() => { reports = []; workerMode = 'ok'; cmdSent = false; settings = { speedOn: false, gemReserve: 100, gemCap: 1000 }; });

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
    if (a.goneMs) window.__MAPC_GONE_MS = a.goneMs;
  }, { uid: o.uid, base, pw: o.pw, left: o.left, goneMs: o.goneMs });
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
  assert.equal(row.rewardItems, '79200004x1');
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

const frameFake = (page, fn, arg) => page.evaluate(([f, a]) => { const w = document.getElementById('mapc-frame').contentWindow; return new Function('F', 'a', 'w', f)(w.__fake, a, w); }, [fn, arg]);
async function goUnattended(page) {
  await page.waitForSelector('#mapc-unattended');
  await page.click('#mapc-unattended');
  await page.click('#mapc-unattended-go');
  await page.waitForFunction(() => window.__MAPC && window.__MAPC.attached === 'frame', null, { timeout: 15000 });
}

test('unattended mode: pauses the outer game, frames the same URL and claims through the frame only', async () => {
  const { ctx, page } = await start();
  await goUnattended(page);
  assert.deepEqual(await page.evaluate(() => [__fake.paused, __fake.disposed]), [true, true]);
  assert.equal(await page.evaluate(() => new URL(document.getElementById('mapc-frame').src).pathname), '/');
  await frameFake(page, 'F.notice(501, "Frame", 7, 8)');
  await page.waitForFunction(() => document.getElementById('mapc-frame').contentWindow.__fake.sent.length === 1, null, { timeout: 8000 });
  assert.equal((await sent(page)).length, 0, 'nothing goes through the paused outer game');
  assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('mapc-root')).zIndex > getComputedStyle(document.getElementById('mapc-frame')).zIndex), 'the card stays above the game');
  await ctx.close();
});

test('unattended mode: a kicked frame reports it, gets reconnect, reloads and carries on without re-claiming', async () => {
  workerMode = 'reconnectOnce';
  const { ctx, page } = await start();
  await goUnattended(page);
  await frameFake(page, 'F.notice(601, "Before", 1, 1)');
  await page.waitForFunction(() => document.getElementById('mapc-frame').contentWindow.__fake.sent.length === 1, null, { timeout: 8000 });
  await frameFake(page, 'w.__marker = 1; F.socket = 3; F.kickBox = true;');
  await page.waitForFunction(() => { const w = document.getElementById('mapc-frame').contentWindow; return !!w && !!w.__fake && !w.__marker && window.__MAPC.attached === 'frame'; }, null, { timeout: 40000 });
  assert.ok(reports.some((r) => r.body.status.kicked === true && r.body.status.connected === false), 'the kick was reported');
  await frameFake(page, 'F.notice(601, "Before", 1, 1); F.notice(602, "After", 9, 9);');
  await page.waitForFunction(() => document.getElementById('mapc-frame').contentWindow.__fake.sent.length >= 1, null, { timeout: 8000 });
  await page.waitForTimeout(3000);
  assert.deepEqual(await frameFake(page, 'return F.sent.map(function (x) { return x.p.x; });'), [9], 'only the new map is claimed after the reconnect');
  await ctx.close();
});

test('outside unattended mode a reconnect command is not acted on, and the card says so', async () => {
  workerMode = 'reconnectOnce';
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { window.__marker = 1; __fake.socket = 3; __fake.kickBox = true; });
  await waitText(page, '#mapc-foot', /Reconnect needs Unattended mode/, 15000);
  assert.equal(await page.evaluate(() => window.__marker), 1, 'the page was not reloaded');
  assert.equal(await page.$('#mapc-frame'), null);
  await ctx.close();
});

test('REVIEW #4: a report the worker rejects is not resent forever; reporting carries on', async () => {
  workerMode = 'reject1';
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.answers.push({ s: 3, d: 'world_130511' }); __fake.notice(81, 'A', 3, 3); });
  const until = Date.now() + 15000;
  while (Date.now() < until && !cmdSent) await page.waitForTimeout(200);
  assert.ok(cmdSent, 'the worker rejected the batch holding map 81');
  const after = reports.length;
  await page.evaluate(() => __fake.notice(82, 'B', 4, 4));
  await page.waitForTimeout(6000);
  const later = reports.slice(after);
  assert.ok(later.length >= 1, 'reports carry on');
  assert.ok(later.every((r) => !r.body.maps.some((m) => m.id === '81')), 'the rejected row is not resent');
  assert.ok(later.some((r) => r.body.maps.some((m) => m.id === '82')), 'new rows still go out');
  assert.doesNotMatch(await text(page, '#mapc-foot'), /not reachable/);
  await ctx.close();
});

test('REVIEW #7: no claims while the game is disconnected; they go out once it is back', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.socket = 3; __fake.notice(91, 'A', 5, 5); });
  await page.waitForTimeout(5000);
  assert.equal((await sent(page)).length, 0, 'nothing is sent into a closed connection');
  await page.evaluate(() => { __fake.socket = 1; });
  await page.waitForFunction(() => __fake.sent.length === 1, null, { timeout: 8000 });
  await ctx.close();
});

test('REVIEW #10: a short gap in the event data does not stop the collector; a long one does', async () => {
  const { ctx, page } = await start({ goneMs: 6000 });
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => { __fake.activity = false; });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { __fake.activity = true; });
  await page.waitForTimeout(3000);
  assert.ok(await page.$('#mapc-enroute'), 'still running after a 3 s gap');
  await page.evaluate(() => { __fake.activity = false; });
  await waitText(page, '#mapc-root', /the event ended/, 15000);
  await ctx.close();
});

test('REVIEW #5: a second tap on Start while the password is being checked claims nothing', async () => {
  workerMode = 'slow';
  const { ctx, page } = await start({ pw: null });
  await page.waitForSelector('#mapc-pw', { timeout: 5000 });
  await page.fill('#mapc-pw', 'bad pass');
  await page.evaluate(() => { const b = document.getElementById('mapc-pw-go'); b.click(); b.click(); });
  await page.evaluate(() => __fake.notice(91, 'A', 9, 9));
  await page.waitForSelector('#mapc-pw', { timeout: 8000 });
  assert.equal((await sent(page)).length, 0, 'no claim before the password is accepted');
  assert.equal(reports.length, 1, 'one password check, not two');
  await ctx.close();
});

test('REVIEW #5: a typed password is not trusted while the server is down; a saved, accepted one still runs', async () => {
  workerMode = 'down';
  const { ctx, page } = await start({ pw: null });
  await page.waitForSelector('#mapc-pw', { timeout: 5000 });
  await page.fill('#mapc-pw', 'any guess');
  await page.click('#mapc-pw-go');
  await waitText(page, '#mapc-root', /Can't reach the Map Collector server/, 5000);
  await page.evaluate(() => __fake.notice(92, 'A', 9, 9));
  await page.waitForTimeout(4000);
  assert.equal((await sent(page)).length, 0, 'an unchecked password claims nothing');
  assert.equal(await page.evaluate(() => localStorage.getItem('mapc_pw_v1')), null, 'an unchecked password is not saved');
  await ctx.close();
  const again = await start();                                  // saved password from an earlier accepted run
  await again.page.waitForSelector('#mapc-enroute', { timeout: 5000 });
  await again.page.evaluate(() => __fake.notice(93, 'A', 9, 9));
  await again.page.waitForFunction(() => __fake.sent.length === 1, null, { timeout: 6000 });
  await again.ctx.close();
});

const rids = async (page) => (await sent(page)).map((x) => x.rid);
async function waitReport(page, pred, ms) { const until = Date.now() + (ms || 10000); while (Date.now() < until && !reports.some(pred)) await page.waitForTimeout(200); return reports.some(pred); }

test('speed-ups: a 40 s march gets two from the bag after all claims, at the claim pace', async () => {
  settings.speedOn = true;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 5; __fake.marchSecs = 40; });
  await page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await page.evaluate(() => { __fake.notice(201, 'A', 5, 5); __fake.notice(202, 'B', 6, 6); });
  await page.waitForFunction(() => __fake.used.length === 4, null, { timeout: 20000 });
  const s = await sent(page), kinds = s.map((x) => x.rid);
  assert.deepEqual(kinds.slice(0, 2), [902, 902], 'both claims first');
  assert.ok(kinds.every((r) => r !== 818), 'no purchase while the bag has some');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 1100, 'every request 1.1 s apart');
  await waitText(page, '#mapc-speed', /^On · 4$/);
  await ctx.close();
});
test('speed-ups: an empty bag buys then uses, gems drop by the price, and the gems reach the report', async () => {
  settings.speedOn = true;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 0; __fake.gems = 1000; __fake.marchSecs = 25; });
  await page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await page.evaluate(() => __fake.notice(211, 'A', 5, 5));
  await page.waitForFunction(() => __fake.used.length === 1, null, { timeout: 15000 });
  assert.deepEqual(await rids(page), [902, 818, 920]);
  assert.equal(await page.evaluate(() => __fake.gems), 963);
  assert.ok(await waitReport(page, (r) => r.body.maps.some((m) => m.id === '211' && m.speedups === 1 && m.gems === 37), 8000));
  await ctx.close();
});
test('speed-ups: the reserve and the daily cap each stop buying, with the reason reported', async () => {
  settings.speedOn = true; settings.gemReserve = 990;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 0; __fake.gems = 1000; __fake.marchSecs = 25; });
  await page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await page.evaluate(() => __fake.notice(221, 'A', 5, 5));
  assert.ok(await waitReport(page, (r) => r.body.status.speedNote === 'gem reserve reached'));
  assert.deepEqual(await rids(page), [902]);
  await ctx.close();
  settings.gemReserve = 0; settings.gemCap = 30;
  const two = await start();
  await two.page.evaluate(() => { __fake.bag = 0; __fake.marchSecs = 25; });
  await two.page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await two.page.evaluate(() => __fake.notice(222, 'A', 7, 7));
  assert.ok(await waitReport(two.page, (r) => r.body.status.speedNote === 'daily gem cap reached'));
  assert.deepEqual(await rids(two.page), [902]);
  await two.ctx.close();
});
test('speed-ups: a purchase that does not add up turns speed-ups off for the run', async () => {
  settings.speedOn = true;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 0; __fake.marchSecs = 40; __fake.drift = 10; });
  await page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await page.evaluate(() => __fake.notice(231, 'A', 5, 5));
  await page.waitForFunction(() => window.__MAPC.speed().off !== '', null, { timeout: 12000 });
  await page.waitForTimeout(3000);
  assert.deepEqual(await rids(page), [902, 818], 'no use, no second purchase');
  await waitText(page, '#mapc-foot', /Speed-ups off: a purchase did not add up/);
  await ctx.close();
});
test('speed-ups: a purchase whose bag update lands late still counts', async () => {
  settings.speedOn = true;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 0; __fake.marchSecs = 25; __fake.bagLagMs = 1200; });
  await page.waitForFunction(() => window.__MAPC.speed().on, null, { timeout: 8000 });
  await page.evaluate(() => __fake.notice(241, 'A', 5, 5));
  await page.waitForFunction(() => __fake.used.length === 1, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__MAPC.speed().off), '');
  await ctx.close();
});
test('speed-ups: worker down means settings never arrive and nothing but claims is sent', async () => {
  workerMode = 'down'; settings.speedOn = true;
  const { ctx, page } = await start();
  await page.evaluate(() => { __fake.bag = 5; __fake.marchSecs = 40; });
  await page.waitForSelector('#mapc-enroute');
  await page.evaluate(() => __fake.notice(251, 'A', 5, 5));
  await page.waitForTimeout(6000);
  assert.deepEqual(await rids(page), [902]);
  await ctx.close();
});
test('speed-ups: two quick toggles end on the last choice at the worker', async () => {
  const { ctx, page } = await start();
  await page.waitForSelector('#mapc-speed-toggle');
  await page.waitForFunction(() => window.__MAPC.speed().known, null, { timeout: 8000 });
  await page.click('#mapc-speed-toggle'); await page.click('#mapc-speed-toggle');
  await page.waitForTimeout(3000);
  assert.equal(settings.speedOn, false);
  assert.equal(await page.$eval('#mapc-speed-toggle', (b) => b.getAttribute('aria-pressed')), 'false');
  await page.click('#mapc-speed-toggle');
  const until = Date.now() + 5000;
  while (Date.now() < until && settings.speedOn !== true) await page.waitForTimeout(200);
  assert.equal(settings.speedOn, true);
  assert.equal(await page.$eval('#mapc-speed-toggle', (b) => b.getAttribute('aria-pressed')), 'true');
  await ctx.close();
});
