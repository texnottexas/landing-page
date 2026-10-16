'use strict';
// Odinium Gatherer (Tex 2026-10-16) in a real browser against the fake game (test/fixtures/mapc/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/odin-gather.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['odin-gather.js', 'odin-gather-core.js', 'ops-drag.js', 'ops-stack.js', 'ops-tools.json'];
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

// The fake game with these Refine Centers: [{x, y, id, left (s), size, aid, st, level, inView, itemId}], plus overrides.
const SETUP = ([list, o]) => {
  const now = Math.floor(Date.now() / 1000), F = __fake, OD = F.odin;
  OD.records = []; OD.towers = []; OD.infos = {};
  list.forEach((f, i) => {
    const left = f.left != null ? f.left : 32400, btime = now - (36000 - left), lv = f.level || 3;
    OD.records.push({ type: 10, tampTime: btime - i, targetPosArr: [{ x: f.x, y: f.y }], msg: 'Well done! The Lv. ' + lv + ' Refine Center (' + f.x + ',' + f.y + ') built by  - B' + i + ' is completed.' });
    if (f.inView !== false) OD.towers.push({ x: f.x, y: f.y, id: f.id, st: f.st || 3, aid: f.aid || OD.aid });
    OD.infos[f.id] = { pt: { x: f.x, y: f.y }, army_size: f.size || 0, btime, ext: { itemId: f.itemId || 1603 }, bid: 71003, aid: f.aid || OD.aid, st: f.st || 3, dur: 2000, march_size: 0 };
  });
  F.rfc.units = [{ armyID: 10102, type: 101, level: 102, power: 200, n: 3000 }];
  F.rfc.armyAdd = 2700;                       // about 300 units a slot
  F.rfc.used = 0; F.rfc.max = (o && o.max) || 6;
  OD.heroScore = { 169: 0.755, 174: 0.683, 170: 0.65 };
  Object.assign(OD, (o && o.odin) || {});
  if (o && o.marchSetting != null) localStorage.setItem('odin_settings_v1', JSON.stringify({ marches: o.marchSetting }));
};
async function open(list, o, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => { window.__ODIN_WORKER = b.replace(/\/$/, ''); window.__ODIN_FAST = true; window.__ODIN_GAP_MS = 60; window.__ODIN_WAIT_MS = 300; window.__ODIN_TIMEOUT_MS = 800; window.__ODIN_SHOW_MS = 300; window.__ODIN_SKIN_MS = 1500; }, base);
  await page.addScriptTag({ url: base + 'odin-gather-core.js' });
  await page.evaluate(SETUP, [list, o || {}]);
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'odin-gather.js' });
const sent = (page) => page.evaluate(() => __fake.sent.map((x) => ({ rid: x.rid, p: x.p, at: x.at })));
const marches = async (page) => (await sent(page)).filter((x) => x.rid === 902);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 8000 });
const units = (p) => p.armyList.reduce((s, a) => s + a.armyNum, 0);
const predicted = (n) => Math.ceil(Math.floor(n * 120000 * (1 + 1.455) / 40000) / (0.005 * 1.2 * (1 + 2.375)));
const T1 = { x: 402, y: 690, id: 'T1' }, T2 = { x: 404, y: 692, id: 'T2' };

test('ODIN-1: two open facilities: one map look, an info for each, then two marches with the game\'s exact payload; no UID kept', async () => {
  const { ctx, page } = await open([T1, T2]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((x) => x.rid === 902).length >= 2, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid), [901, 1034, 1034, 902, 902]);
  assert.deepEqual(s[0].p, { x: 402, y: 690, k: 2864, rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 });
  const m = s.filter((x) => x.rid === 902);
  const a = m[0].p;
  assert.deepEqual(Object.keys(a).sort(), ['armyList', 'armyListNew', 'break', 'extraArmy', 'formation', 'formationV2', 'heroList', 'marchType', 'trapList', 'x', 'y']);
  assert.equal(a.marchType, 26); assert.deepEqual([a.break, a.formation, a.formationV2], [0, 0, 0]); assert.deepEqual(a.trapList, []); assert.deepEqual(a.extraArmy, {});
  assert.deepEqual(a.armyList, a.armyListNew);
  assert.deepEqual(a.heroList, [169, 174, 170], 'the three best gatherers');
  assert.ok(a.armyList.every((x) => [1, 2, 3, 11, 12, 13, 21, 22, 23].includes(x.pos)));
  assert.notDeepEqual(m[0].p.heroList, m[1].p.heroList, 'the second march takes other heroes');
  assert.deepEqual(new Set(m.map((x) => x.p.x + ',' + x.p.y)), new Set(['402,690', '404,692']));
  const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  assert.ok(!ls.includes('test-owner-uid') && !ls.includes('secret'), 'no UID or player id kept');
  await ctx.close();
});

test('ODIN-2: a march is sized to the facility\'s time left: it fills at, or less than an hour after, the time left', async () => {
  const { ctx, page } = await open([Object.assign({}, T1, { left: 7200 })]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  const n = units((await marches(page))[0].p), secs = predicted(n);
  assert.ok(secs >= 7200 && secs <= 7200 + 3600, n + ' units, ' + secs + ' s');
  assert.ok(predicted(n - 1) < 7200, 'one unit fewer would end early');
  await ctx.close();
});

test('ODIN-3: never more units than the facility has room for', async () => {
  const { ctx, page } = await open([Object.assign({}, T1, { size: 2450 })]);   // 50 free: less than the time left would take (about 89)
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  assert.equal(units((await marches(page))[0].p), 50, 'fills the room there is, no more');
  await ctx.close();
});

test('ODIN-4: another alliance\'s, an unfinished and a Lv. 2 facility are never checked or sent to', async () => {
  const { ctx, page } = await open([Object.assign({}, T1, { aid: 123 }), Object.assign({}, T2, { st: 2 }), { x: 410, y: 690, id: 'T3', level: 2 }]);
  await launch(page);
  await waitText(page, '#odin-foot', /No open Refine Centers|No Refine Center has room|Next look/);
  await page.waitForTimeout(600);
  const s = await sent(page);
  assert.equal(s.filter((x) => x.rid === 1034).length, 0);
  assert.equal(s.filter((x) => x.rid === 902).length, 0);
  await ctx.close();
});

test('ODIN-5: one march per facility: later rounds skip a facility we already have a march at', async () => {
  const { ctx, page } = await open([T1]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.waitForTimeout(2000);                                   // several more rounds
  assert.equal((await marches(page)).length, 1);
  await ctx.close();
});

test('ODIN-6: a facility in the log but gone from the map: no info, no march', async () => {
  const { ctx, page } = await open([Object.assign({}, T1, { inView: false })]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 901), null, { timeout: 8000 });
  await page.waitForTimeout(800);
  const s = await sent(page);
  assert.equal(s.filter((x) => x.rid === 1034 || x.rid === 902).length, 0);
  await ctx.close();
});

test('ODIN-7: the Marches setting caps the marches it sends; with no free march nothing is sent', async () => {
  const a = await open([T1, T2], { marchSetting: 1 });
  await launch(a.page);
  await a.page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await a.page.waitForTimeout(1200);
  assert.equal((await marches(a.page)).length, 1);
  assert.equal(await a.page.inputValue('#odin-marches'), '1');
  await a.ctx.close();
  const b = await open([T1], { odin: {} });
  await b.page.evaluate(() => { __fake.rfc.used = __fake.rfc.max; });
  await launch(b.page);
  await waitText(b.page, '#odin-foot', /No free march/);
  assert.equal((await sent(b.page)).length, 0);
  await b.ctx.close();
});

test('ODIN-8: another tool\'s pending march or map look is a wait, no strike; it goes on once clear', async () => {
  const { ctx, page } = await open([T1]);
  await page.evaluate(() => { __fake.pending.push(901); });
  await launch(page);
  await page.waitForTimeout(1000);
  assert.equal((await sent(page)).length, 0, 'no look while a look is pending');
  await page.evaluate(() => { __fake.pending = [902]; });
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 1034), null, { timeout: 8000 });
  await page.waitForTimeout(800);
  assert.equal((await marches(page)).length, 0, 'no march while a march is pending');
  assert.equal(await page.evaluate(() => window.__ODIN.running), true);
  await page.evaluate(() => { __fake.pending = []; });
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await ctx.close();
});

test('ODIN-9: a refused info or march stops the run with the game\'s words; a march with no answer stops it, never resent', async () => {
  const a = await open([T1], { odin: { infoMode: 'refuse' } });
  await launch(a.page);
  await waitText(a.page, '#odin-root .odin-msg', /stopped: The building is gone\./);
  await a.ctx.close();
  const b = await open([T1], { odin: { mode: 'refuse' } });
  await launch(b.page);
  await waitText(b.page, '#odin-root .odin-msg', /stopped: Garrison Troop is full/);
  await b.ctx.close();
  const c = await open([T1], { odin: { mode: 'silent' } });
  await launch(c.page);
  await waitText(c.page, '#odin-root .odin-msg', /didn't answer a march/, 8000);
  assert.equal((await marches(c.page)).length, 1, 'never resent');
  await c.ctx.close();
});

test('ODIN-10: caps: no more than 6 marches a minute; the card says when it goes on', async () => {
  const list = Array.from({ length: 8 }, (_, i) => ({ x: 400 + i, y: 690, id: 'F' + i }));
  const { ctx, page } = await open(list, { max: 8 });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.filter((x) => x.rid === 902).length >= 6, null, { timeout: 15000 });
  await waitText(page, '#odin-foot', /Paused: 6 marches a minute\. Goes on in/, 8000);
  assert.equal((await marches(page)).length, 6);
  await ctx.close();
});

const SKIN = { faces: { 1752000: { endTime: -1 }, 1719000: { endTime: -1 } }, skins: { 1752000: '960002,1000|100001,1000' }, using: 1719000 };
test('ODIN-11: a gathering skin owned: worn before the march, the old skin back once the march has arrived', async () => {
  const { ctx, page } = await open([T1], { odin: Object.assign({}, SKIN, { travelMs: 600 }) });
  await launch(page);
  await page.waitForFunction(() => __fake.odin.skinLog.length >= 2, null, { timeout: 10000 });
  const s = await sent(page), order = s.filter((x) => x.rid === 855 || x.rid === 902).map((x) => x.rid === 855 ? 'skin:' + x.p.skinId : 'march');
  assert.deepEqual(order, ['skin:1752000', 'march', 'skin:1719000']);
  assert.equal(await page.evaluate(() => __fake.odin.using), 1719000);
  const back = s.find((x) => x.rid === 855 && x.p.skinId === 1719000).at, m = s.find((x) => x.rid === 902).at;
  assert.ok(back - m >= 500, 'not before the march arrived: ' + (back - m) + ' ms');
  await page.waitForFunction((k) => localStorage.getItem('odin_skin_v1_' + k) === null, SK, { timeout: 3000 });   // cleared once the game confirms
  await ctx.close();
});

test('ODIN-12: the skin refused: it sends anyway with a note; the switch back refused 3 times asks the player to switch it back', async () => {
  const a = await open([T1], { odin: Object.assign({}, SKIN, { skinRefuse: [1752000] }) });
  await launch(a.page);
  await a.page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await waitText(a.page, '#odin-skin', /Couldn't switch to your gathering skin/);
  await a.ctx.close();
  const b = await open([T1], { odin: Object.assign({}, SKIN, { skinRefuse: [1719000] }) });
  await launch(b.page);
  await waitText(b.page, '#odin-skin', /Switch your base skin back/, 10000);
  assert.equal(await b.page.evaluate(() => __fake.odin.skinLog.filter((x) => x === 1719000).length), 3);
  await b.ctx.close();
});

test('ODIN-13: Stop while wearing the gathering skin puts the old one back', async () => {
  const { ctx, page } = await open([T1], { odin: Object.assign({}, SKIN, { travelMs: 60000 }) });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.click('#odin-stop');
  await page.waitForFunction(() => __fake.odin.using === 1719000, null, { timeout: 6000 });
  await ctx.close();
});

test('ODIN-14: it reports its marches for the Tool usage panel: siteKey, name, tool, version, count, game day; no UID', async () => {
  const { ctx, page } = await open([T1]);
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const last = usageLog[usageLog.length - 1];
  assert.equal(last.body.tool, 'odin-gather'); assert.equal(last.body.siteKey, SK); assert.equal(last.body.count, 1);
  assert.match(last.body.version, /^2026-10-1/); assert.match(last.body.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!last.raw.includes(UID));
  await ctx.close();
});

test('ODIN-DRAG: the card drags by its title and keeps its spot after a relaunch', async () => {
  const { ctx, page } = await open([]);
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  await launch(page);
  await page.waitForSelector('#odin-root .odin-head');
  const at = () => page.$eval('#odin-root', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; });
  const a = await at(), h = await page.$eval('#odin-root .odin-head', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x + 20, h.y + 150, { steps: 6 }); await page.mouse.up();
  const b = await at();
  assert.deepEqual(b, { x: a.x + 20, y: a.y + 150 });
  await page.evaluate(() => window.__ODIN.stop());
  await launch(page);
  await page.waitForSelector('#odin-root .odin-head');
  assert.deepEqual(await at(), b);
  await ctx.close();
});

test('ODIN-15 (live 2026-10-16): its own gathering march is known by the uid the game gives it: Marches 1 sends 1, long after the send', async () => {
  const { ctx, page } = await open([T1, T2], { marchSetting: 1 });
  await page.evaluate(() => { window.__ODIN_UNSHOWN_MS = 100; });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.waitForTimeout(2500);                                  // many rounds after the send, well past the unshown window
  assert.equal((await marches(page)).length, 1);
  await waitText(page, '#odin-stat', /^Out 1 \/ 1/);
  await ctx.close();
});

// Final review fixes (2026-10-16).
test('REV-1 (C1): Stop between marches of a skin batch: no march after Stop, the old skin back, no second copy can start meanwhile', async () => {
  const { ctx, page } = await open([T1, T2], { odin: Object.assign({}, SKIN, { travelMs: 60000, skinMs: 400 }) });
  await page.evaluate(() => { window.__ODIN_GAP_MS = 600; });       // room between the two marches for the click
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.click('#odin-stop');
  assert.equal(await page.evaluate(() => window.__ODIN.running), true, 'still running until the skin is back');
  await page.waitForFunction(() => __fake.odin.using === 1719000, null, { timeout: 6000 });
  await page.waitForTimeout(800);
  assert.equal((await marches(page)).length, 1, 'no march after Stop');
  const after = (await sent(page)).filter((x) => x.rid === 901 || x.rid === 1034).length;
  await page.waitForTimeout(800);
  assert.equal((await sent(page)).filter((x) => x.rid === 901 || x.rid === 1034).length, after, 'no looks after Stop');
  assert.equal(await page.evaluate(() => __fake.odin.skinLog.filter((x) => x === 1719000).length), 1, 'one switch back');
  assert.equal(await page.evaluate(() => window.__ODIN.running), false);
  await ctx.close();
});

test('REV-2 (C2, I4): free marches but no units at home, a skin owned: no skin change and no repeated looks', async () => {
  const { ctx, page } = await open([T1], { odin: SKIN });
  await page.evaluate(() => { __fake.rfc.units = [{ armyID: 10102, type: 101, level: 102, power: 200, n: 0 }]; });
  await launch(page);
  await page.waitForTimeout(2500);                                  // many rounds at the test pace
  assert.equal(await page.evaluate(() => __fake.odin.skinLog.length), 0);
  const s = await sent(page);
  assert.ok(s.filter((x) => x.rid === 901).length <= 1 && s.filter((x) => x.rid === 1034).length <= 1, JSON.stringify(s.map((x) => x.rid)));
  await ctx.close();
});

test('REV-3 (I4): a facility with no room is checked once, not every round', async () => {
  const { ctx, page } = await open([Object.assign({}, T1, { size: 2480 })]);
  await launch(page);
  await page.waitForTimeout(2500);
  assert.equal((await sent(page)).filter((x) => x.rid === 1034).length, 1);
  await ctx.close();
});

test('REV-4 (I1): Stop while the skin switch is on its way: the record is kept and the old skin comes back', async () => {
  const { ctx, page } = await open([T1], { odin: Object.assign({}, SKIN, { skinMs: 700 }) });
  await launch(page);
  await page.waitForFunction(() => __fake.odin.skinLog.length >= 1, null, { timeout: 8000 });
  const rec = await page.evaluate((k) => JSON.parse(localStorage.getItem('odin_skin_v1_' + k)), SK);
  assert.equal(rec && rec.prev, 1719000, 'saved before the switch went out');
  await page.click('#odin-stop');
  await page.waitForFunction(() => __fake.odin.using === 1719000 && __fake.odin.skinLog.length >= 2, null, { timeout: 6000 });
  await page.waitForFunction((k) => localStorage.getItem('odin_skin_v1_' + k) === null, SK, { timeout: 3000 });
  await ctx.close();
});

test('REV-5 (I2): a skin switch the game confirms too late changes nothing: no late switch request', async () => {
  const { ctx, page } = await open([T1], { odin: Object.assign({}, SKIN, { offCosMs: 2500 }) });
  await launch(page);
  await waitText(page, '#odin-skin', /Couldn't switch to your gathering skin/, 8000);
  await page.waitForTimeout(1800);                                  // past the game's late confirm
  assert.equal(await page.evaluate(() => __fake.odin.skinLog.length), 0);
  await ctx.close();
});

test('REV-6 (I3): Stop when the old skin will not come back: the card says so and stays', async () => {
  const { ctx, page } = await open([T1], { odin: Object.assign({}, SKIN, { travelMs: 60000, skinRefuse: [1719000] }) });
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  await page.click('#odin-stop');
  await waitText(page, '#odin-root .odin-msg', /Switch your base skin back/, 6000);
  await ctx.close();
});

test('REV-7 (I6): a player with 6 march positions: troops only in those 6', async () => {
  const { ctx, page } = await open([T1]);
  await page.evaluate(() => { __fake.rfc.armysNum = 6; __fake.rfc.armyAdd = 30; });   // small slots: the march needs more than 6
  await launch(page);
  await page.waitForFunction(() => __fake.sent.some((x) => x.rid === 902), null, { timeout: 8000 });
  const pos = (await marches(page))[0].p.armyList.map((a) => a.pos);
  assert.ok(pos.every((p) => [1, 2, 3, 11, 12, 13].includes(p)), JSON.stringify(pos));
  await ctx.close();
});
