'use strict';
// Refugee Camps in a real browser against the fake game (test/fixtures/mapc/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/refugee-camps.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['refugee-camps.js', 'refugee-camps-core.js', 'ops-tools.json', 'ops-drag.js', 'ops-jam.js'];
const UID = 'test-owner-uid';

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

// The fake game at phone size, the tool's clocks shortened unless a test wants the real 1.5 s pace.
async function open(setup, arg, realPace) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(([b, real]) => {
    window.__RFC_WORKER = b.replace(/\/$/, '');
    if (!real) window.__RFC_GAP_MS = 60;
    window.__RFC_TIMEOUT_MS = 800; window.__RFC_CAMP_WAIT_MS = 1500; window.__RFC_POLL_MS = 100; window.__RFC_SETTLE_MS = 1500; window.__RFC_UNSHOWN_MS = 300;
  }, [base, !!realPace]);
  await page.addScriptTag({ url: base + 'refugee-camps-core.js' });
  if (setup) await page.evaluate(setup, arg);
  return { ctx, page };
}
async function launch(page) { await page.addScriptTag({ url: base + 'refugee-camps.js' }); await page.waitForSelector('#rfc-start'); }
async function start(page, s) {
  await launch(page);
  for (const [k, v] of Object.entries(s || {})) {
    if (k === 'buy') { const on = (await page.getAttribute('#rfc-buy', 'aria-pressed')) === 'true'; if (on !== v) await page.click('#rfc-buy'); }
    else await page.fill('#rfc-' + k, String(v));
  }
  await page.click('#rfc-start');
}
const sent = (page) => page.evaluate(() => __fake.sent.filter((x) => [815, 801, 1021, 1201].includes(x.rid)).map((x) => ({ rid: x.rid, p: x.p, at: x.at })));
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 10000 });
const waitMsg = (page, re, timeout) => waitText(page, '#rfc-root .rfc-msg', re, timeout);
const LETTER = { itemid: 1700039, amount: 1 };

test('RFC-1: the set-up card shows marches, letters and capsules, fits a phone, and keeps the settings', async () => {
  const { ctx, page } = await open();
  await launch(page);
  const t = await page.textContent('#rfc-root');
  assert.match(t, /you have 7/); assert.match(t, /20 letters/); assert.match(t, /5 in bag/); assert.match(t, /Diana/);
  assert.ok(!/—/.test(t), 'no em dash');
  assert.equal(await page.inputValue('#rfc-marches'), '1');
  assert.equal(await page.inputValue('#rfc-camps'), '10');
  assert.equal(await page.getAttribute('#rfc-buy', 'aria-pressed'), 'true');
  const box = await page.evaluate(() => {
    const r = document.querySelector('#rfc-root .rfc-card').getBoundingClientRect();
    const small = [...document.querySelectorAll('#rfc-root button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length;
    return { right: r.right, sw: document.documentElement.scrollWidth, small, parent: document.getElementById('rfc-root').parentNode === document.body, pos: getComputedStyle(document.getElementById('rfc-root')).position };
  });
  assert.ok(box.right <= 375 && box.sw <= 375, 'no sideways scroll on a phone');
  assert.equal(box.small, 0, 'every button at least 44 px tall');
  assert.ok(box.parent && box.pos === 'fixed');
  await page.click('#rfc-plus-marches');
  await page.fill('#rfc-camps', '99');                       // more than the letters held
  await page.click('#rfc-start');
  await page.waitForFunction(() => window.__RFC.state().view === 'run');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('rfc_settings_v1'))), { marches: 2, camps: 20, buy: true, small: 0, large: 0 });
  await ctx.close();
});

test('RFC-2: one march: the camp list, a letter, then a 3-minute rally with Diana on the camp the game names, one camp after another', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.rallyMs = 600; window.__maxOut = 0; setInterval(() => { window.__maxOut = Math.max(window.__maxOut, __fake.rfc.used); }, 10); });
  await start(page, { marches: 1, camps: 3 });
  await waitMsg(page, /Done\. Rallied 3 camps\./, 20000);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid), [1021, 815, 1201, 1021, 815, 1201, 1021, 815, 1201], 'the camp comes from the game\'s push: no second list');
  s.filter((x) => x.rid === 815).forEach((x) => assert.deepEqual(x.p, LETTER));
  const rallies = s.filter((x) => x.rid === 1201).map((x) => x.p);
  assert.deepEqual(rallies.map((r) => r.x + ',' + r.y), ['401,601', '402,602', '403,603']);
  rallies.forEach((r) => {
    assert.equal(r.time, 180); assert.equal(r.marchType, 8); assert.deepEqual(r.heroList, [117, 115, 169]);
    assert.deepEqual(r.trapList, []); assert.equal(r.formation, 0); assert.equal(r.formationV2, 0);
  });
  assert.deepEqual(rallies[0].armyList, [1, 2, 3, 11, 12, 13, 21, 22, 23].map((pos, i) => ({ pos, armyId: 901103, armyNum: i < 3 ? 5 : 4 })));
  assert.equal(await page.evaluate(() => window.__maxOut), 1, 'never two rallies out');
  await ctx.close();
});

test('RFC-3: three marches: three rallies out at once, no hero or unit used twice', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.rallyMs = 8000; });
  await start(page, { marches: 3, camps: 3 });
  await waitMsg(page, /Rallied 3 camps/, 20000);
  assert.equal(await page.evaluate(() => __fake.rfc.used), 3);
  const rallies = (await sent(page)).filter((x) => x.rid === 1201).map((x) => x.p);
  assert.deepEqual(rallies.map((r) => r.heroList), [[117, 115, 169], [172, 170, 174], [333, 334, 338]]);
  assert.deepEqual(rallies[1].armyList, [
    { pos: 1, armyId: 901103, armyNum: 5 }, { pos: 2, armyId: 901103, armyNum: 5 }, { pos: 3, armyId: 901103, armyNum: 5 }, { pos: 11, armyId: 901103, armyNum: 4 },
    { pos: 12, armyId: 901103, armyNum: 2 }, { pos: 13, armyId: 10102, armyNum: 4 }, { pos: 21, armyId: 10102, armyNum: 4 }, { pos: 22, armyId: 10102, armyNum: 4 }, { pos: 23, armyId: 10102, armyNum: 4 }
  ], 'the last 2 of 901103, then the next kind: as in Tex\'s 2nd hand rally');
  await ctx.close();
});

test('RFC-4: VIT short: the 50-gem buy first', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.vit = 3; __fake.gems = 1000; });
  await start(page, { camps: 1 });
  await waitMsg(page, /Rallied 1 camp\./);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [801, 1021, 815, 1201]);
  assert.equal(await page.evaluate(() => __fake.gems), 950);
  assert.equal((await page.evaluate(() => window.__RFC.state())).gemsSpent, 50);
  await ctx.close();
});

test('RFC-5: after today\'s buy: a Small capsule, then (Small limit used) a Large one; never another buy', async () => {
  const { ctx, page } = await open(() => { Object.assign(__fake.rfc, { vit: 3, buys: 1, rallyMs: 100 }); });
  await start(page, { camps: 4, small: 1, large: 1 });
  await waitMsg(page, /Rallied 4 camps/, 15000);
  const s = await sent(page);
  assert.ok(!s.some((x) => x.rid === 801), 'no buy at 200 gems');
  assert.deepEqual(s.filter((x) => x.rid === 815).map((x) => x.p.itemid), [600001, 1700039, 1700039, 1700039, 600002, 1700039]);
  await ctx.close();
});

test('RFC-6: out of VIT within the limits: stops before using a letter', async () => {
  const { ctx, page } = await open(() => { Object.assign(__fake.rfc, { vit: 3, buys: 1 }); });
  await start(page, { camps: 3, small: 0, large: 0 });
  await waitMsg(page, /out of VIT \(your limits are used up\)\. Rallied 0 camps\./);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [], 'nothing sent');
  await ctx.close();
});

test('RFC-7: a buy that doesn\'t add up: no more buys this run, the gems spent are shown', async () => {
  const { ctx, page } = await open(() => { Object.assign(__fake.rfc, { vit: 3, gemDrift: 10 }); });
  await start(page, { camps: 1 });
  await waitMsg(page, /Rallied 1 camp\./);
  const st = await page.evaluate(() => window.__RFC.state());
  assert.equal(st.noBuy, true); assert.equal(st.gemsSpent, 60);
  await ctx.close();
});

test('RFC-8: a letter that shows no camp stops the run; no second letter', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.noCamp = true; });
  await start(page, { camps: 3 });
  await waitMsg(page, /a letter showed no camp, so no more letters were used/);
  const s = await sent(page);
  assert.equal(s.filter((x) => x.rid === 815).length, 1);
  assert.ok(s.filter((x) => x.rid === 1021).length >= 2, 'looked again before giving up');
  await ctx.close();
});

test('RFC-9: a refused rally stops with the game\'s words; an unanswered one stops too', async () => {
  const a = await open(() => { __fake.rfc.rallyMode = 'refuse'; });
  await start(a.page, { camps: 3 });
  await waitMsg(a.page, /stopped: The rally could not start\. Rallied 0 camps\./);
  assert.equal((await sent(a.page)).filter((x) => x.rid === 1201).length, 1);
  await a.ctx.close();
  const b = await open(() => { __fake.rfc.rallyMode = 'silent'; });
  await start(b.page, { camps: 3 });
  await waitMsg(b.page, /didn't answer the rally/);
  await b.ctx.close();
});

test('RFC-10: real pace: every request at least 1.5 s after the last one', async () => {
  const { ctx, page } = await open(null, null, true);
  await start(page, { camps: 1 });
  await waitMsg(page, /Rallied 1 camp\./, 15000);
  const s = await sent(page);
  assert.deepEqual(s.map((x) => x.rid), [1021, 815, 1201]);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 1495, 'gap ' + (s[i].at - s[i - 1].at) + ' ms');
  await ctx.close();
});

test('RFC-11: a disconnected game pauses the run; it carries on when the game is back', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.evaluate(() => { __fake.socket = 3; });
  await page.click('#rfc-start');
  await waitText(page, '#rfc-foot', /Game disconnected/);
  await page.waitForTimeout(500);
  assert.equal((await sent(page)).length, 0, 'nothing sent while down');
  await page.evaluate(() => { __fake.socket = 1; });
  await waitText(page, '#rfc-stat', /Camps [1-9]/);
  await page.click('#rfc-stop');
  await ctx.close();
});

test('RFC-12: camps found before the run are left alone', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.camps = [{ x: 300, y: 300 }]; });
  await start(page, { camps: 1 });
  await waitMsg(page, /Rallied 1 camp\./);
  assert.deepEqual((await sent(page)).filter((x) => x.rid === 1201).map((x) => x.p.x + ',' + x.p.y), ['401,601']);
  await ctx.close();
});

test('RFC-13: Stop ends the run; nothing is sent after it', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.rallyMs = 60000; });
  await page.evaluate(() => { window.__RFC_UNSHOWN_MS = 60000; });
  await start(page, { marches: 1, camps: 5 });
  await waitText(page, '#rfc-foot', /Waiting for a march/);
  const n = (await sent(page)).length;
  await page.click('#rfc-stop');
  await waitMsg(page, /Stopped\. Rallied 1 camp\./);
  await page.waitForTimeout(600);
  assert.equal((await sent(page)).length, n);
  await page.click('#rfc-close');
  assert.equal(await page.$('#rfc-root'), null, 'Close removes the card');
  assert.equal(await page.evaluate(() => window.__RFC.open), false);
  await ctx.close();
});

test('RFC-14: the usage report names the tool and today\'s camps, never the UID', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.rallyMs = 100; });
  await start(page, { camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 15000);
  await page.waitForTimeout(300);
  assert.ok(usageLog.length >= 3, 'at launch and after each rally');
  usageLog.forEach((u) => { assert.ok(!u.raw.includes(UID)); assert.equal(u.body.tool, 'refugee-camps'); assert.equal(u.type, 'text/plain'); });
  assert.equal(usageLog[usageLog.length - 1].body.count, 2);
  await ctx.close();
});

test('RFC-15: a march layout other than 9 slots is turned away before anything is sent', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.positions = 8; });
  await page.addScriptTag({ url: base + 'refugee-camps.js' });
  await waitMsg(page, /works with 9 troop slots/);
  assert.equal(await page.$('#rfc-start'), null);
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('RFC-16: preview() gives Quick Deploy\'s picks without sending anything', async () => {
  const { ctx, page } = await open();
  await launch(page);
  const p = await page.evaluate(() => window.__RFC.preview());
  assert.deepEqual(p.heroes, [117, 115, 169]);
  assert.equal(p.army.length, 9);
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('RFC-17: the game shows a new rally in its march count late: one march still never has two rallies out', async () => {
  const { ctx, page } = await open(() => {
    Object.assign(__fake.rfc, { rallyMs: 2500, usedLagMs: 700 });
    window.__maxLive = 0; setInterval(() => { window.__maxLive = Math.max(window.__maxLive, __fake.rfc.live || 0); }, 10);
  });
  await page.evaluate(() => { window.__RFC_UNSHOWN_MS = 2000; });   // shorter than the rally, as in the game
  await start(page, { marches: 1, camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 20000);
  assert.equal(await page.evaluate(() => window.__maxLive), 1, 'never two rallies out');
  await ctx.close();
});

test('RFC-18: the next camp lands on the tile the last one used: still found and rallied', async () => {
  const { ctx, page } = await open(() => { Object.assign(__fake.rfc, { spawnAt: { x: 425, y: 643 }, rallyMs: 300 }); });
  await start(page, { marches: 1, camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 15000);
  assert.deepEqual((await sent(page)).filter((x) => x.rid === 1201).map((x) => x.p.x + ',' + x.p.y), ['425,643', '425,643']);
  await ctx.close();
});

test('RFC-19: two gatherers out and a march count that shows rallies late: three marches never means more than three out', async () => {
  const { ctx, page } = await open(() => {
    Object.assign(__fake.rfc, { used: 2, live: 2, usedLagMs: 3000, rallyMs: 6000 });   // the gatherers never come home
    window.__maxLive = 0; setInterval(() => { window.__maxLive = Math.max(window.__maxLive, __fake.rfc.live || 0); }, 10);
  });
  await page.evaluate(() => { window.__RFC_UNSHOWN_MS = 5000; });
  await start(page, { marches: 3, camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 25000);
  assert.equal(await page.evaluate(() => window.__maxLive), 3);
  await ctx.close();
});

test('RFC-28: a gatherer comes home the moment our rally starts (the count stays flat): the rally is not counted twice, the next march goes', async () => {
  const { ctx, page } = await open(() => {
    Object.assign(__fake.rfc, { used: 1, live: 1, rallyMs: 60000, returnOnRally: 1 });   // our rallies stay out; one gatherer, home at rally 1
    window.__maxLive = 0; setInterval(() => { window.__maxLive = Math.max(window.__maxLive, __fake.rfc.live || 0); }, 10);
  });
  await page.evaluate(() => { delete window.__RFC_UNSHOWN_MS; });   // the tool's own timings, not the harness's short ones
  await start(page, { marches: 2, camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 25000).catch(async (e) => {
    const card = await page.evaluate(() => document.querySelector('#rfc-root').innerText.replace(/\s+/g, ' '));
    const out = await page.evaluate(() => __fake.rfc.used);
    assert.fail('stuck with ' + out + ' march(es) really out; card: ' + card);
  });
  assert.equal(await page.evaluate(() => window.__maxLive), 2, 'never more than 2 out');
  await ctx.close();
});

test('RFC-20: no free heroes or troops: stops before using a letter', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.heroes.forEach((h) => { __fake.rfc.heroOut[h.Id] = 1; }); });
  await start(page, { camps: 3 });
  await waitMsg(page, /no free heroes or troops for a rally/);
  assert.equal((await sent(page)).filter((x) => x.rid === 815).length, 0, 'no letter used');
  await ctx.close();
});

test('RFC-21: the game drops after the letter, or after the camp list before it: on reconnect one camp is rallied, one letter used', async () => {
  for (const drop of [{ rid: 815, n: 1 }, { rid: 1021, n: 1 }]) {
    const { ctx, page } = await open((d) => { __fake.rfc.drop = d; }, drop);
    await start(page, { camps: 1 });
    await waitText(page, '#rfc-foot', /Game disconnected/);
    await page.waitForTimeout(400);
    await page.evaluate(() => { __fake.socket = 1; });
    await waitMsg(page, /Rallied 1 camp\./);
    const s = await sent(page);
    assert.equal(s.filter((x) => x.rid === 815).length, 1, 'one letter (' + drop.rid + ')');
    assert.deepEqual(s.filter((x) => x.rid === 1201).map((x) => x.p.x + ',' + x.p.y), ['401,601']);
    await ctx.close();
  }
});

test('RFC-22: right after login, in base (no battle screen opened yet): the heroes still read, and the run goes', async () => {
  const { ctx, page } = await open();
  assert.equal(await page.evaluate(() => { try { __require('HeroTools').default.getAllEnabledHero(); return 'read'; } catch (e) { return 'throws'; } }), 'throws', 'the game\'s list needs a battle type');
  await launch(page);
  assert.deepEqual((await page.evaluate(() => window.__RFC.preview())).heroes, [117, 115, 169]);
  await page.fill('#rfc-camps', '1');
  await page.click('#rfc-start');
  await waitMsg(page, /Done\. Rallied/, 15000);
  await ctx.close();
});

test('RFC-23: the tool\'s letters don\'t jump the map or close chat; a letter used by hand after the run still does', async () => {
  const { ctx, page } = await open(() => { __fake.rfc.rallyMs = 300; __fake.choice = { Channel: 2, Id: 'alliance' }; });
  await start(page, { marches: 1, camps: 2 });
  await waitMsg(page, /Rallied 2 camps/, 15000);
  assert.deepEqual(await page.evaluate(() => __fake.jumps), [], 'no jump');
  assert.ok(await page.evaluate(() => !!__fake.choice), 'the open chat stays open');
  await page.click('#rfc-close');
  await page.evaluate(() => __fake.pushCamp(410, 610));       // a letter from the bag, after the run
  assert.deepEqual(await page.evaluate(() => __fake.jumps), [{ x: 410, y: 610 }], 'the game\'s own jump is back');
  await ctx.close();
});

test('RFC-24: a rally ends just as the next letter is used, and the new camp takes its tile: found by the game\'s own "camp found" message, rallied', async () => {
  const { ctx, page } = await open(() => { Object.assign(__fake.rfc, { rallyMs: 60000, releaseOnLetter: 2 }); });
  await start(page, { marches: 2, camps: 2 });
  await waitMsg(page, /Rallied/, 20000);
  assert.match(await page.textContent('#rfc-root .rfc-msg'), /^Done\. Rallied 2 camps\.$/);
  assert.deepEqual((await sent(page)).filter((x) => x.rid === 1201).map((x) => x.p.x + ',' + x.p.y), ['401,601', '401,601']);
  await ctx.close();
});

test('RFC-25: no "camp found" push (the module isn\'t there): the camp list after the letter still finds the camp', async () => {
  const { ctx, page } = await open(() => { const R = window.__require; window.__require = (n) => (n === 'PushResponse' ? null : R(n)); __fake.pushCamp = () => {}; });
  await start(page, { camps: 2 });
  await waitMsg(page, /Rallied/, 15000);
  assert.match(await page.textContent('#rfc-root .rfc-msg'), /^Done\. Rallied 2 camps\.$/);
  assert.deepEqual((await sent(page)).map((x) => x.rid), [1021, 815, 1021, 1201, 1021, 815, 1021, 1201]);
  await ctx.close();
});

test('RFC-26: the game shows 6 marches when the card opens and 7 a moment later (a buff\'s march): all 7 are used', async () => {
  const { ctx, page } = await open(() => {
    Object.assign(__fake.rfc, { max: 6, rallyMs: 60000 });
    for (let i = 0; i < 12; i++) __fake.rfc.heroes.push({ Id: 401 + i, Power: 3000 + i, HeroType: 1 });   // heroes enough for 7 rallies
  });
  await page.evaluate(() => { window.__RFC_UNSHOWN_MS = 60000; });
  await launch(page);
  await page.fill('#rfc-marches', '7'); await page.fill('#rfc-camps', '8');
  await page.click('#rfc-start');
  await page.evaluate(() => { __fake.rfc.max = 7; });
  await page.waitForFunction(() => __fake.rfc.live === 7, null, { timeout: 15000 });
  await waitText(page, '#rfc-foot', /Waiting for a march \(7 of 7 out\)/);
  await page.click('#rfc-stop');
  await ctx.close();
});

async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + 15, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}
const cardAt = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; }, sel);

test('RFC-27: the card drags by its title and keeps its spot after a relaunch', async () => {
  const { ctx, page } = await open();
  await page.addScriptTag({ url: base + 'ops-drag.js' });
  await launch(page);
  const a = await cardAt(page, '#rfc-root');
  await dragBy(page, '#rfc-root .rfc-title', 20, 150);
  const b = await cardAt(page, '#rfc-root');
  assert.deepEqual(b, { x: a.x + 20, y: a.y + 150 });
  await page.click('#rfc-close');
  await launch(page);
  assert.deepEqual(await cardAt(page, '#rfc-root'), b);
  await ctx.close();
});

test('RFC-JAM-1 (Tex 2026-10-14): the note in the title row plays Rickroll at the registry\'s version, lights, and a second tap stops it; no game request', async () => {
  const { ctx, page } = await open();
  await page.evaluate((b) => { window.__OPS_BASE = b; }, base);
  await page.addScriptTag({ url: base + 'ops-jam.js' });
  await launch(page);
  const ver = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ops-tools.json'), 'utf8')).tools.find((t) => t.id === 'rickroll').version;
  assert.equal(await page.$eval('#rfc-root .rfc-head .ops-jam + #rfc-min', () => true).catch(() => false), true, 'just before the fold chevron');
  const before = (await page.evaluate(() => __fake.sent.length));
  await page.click('#rfc-root .ops-jam');
  await page.waitForSelector('#rr-root');
  assert.match(await page.evaluate(() => window.__rrSrc), new RegExp('rickroll-audio\\.js\\?v=' + ver.replace(/\./g, '\\.') + '$'));
  await page.waitForFunction(() => document.querySelector('#rfc-root .ops-jam').getAttribute('aria-pressed') === 'true');
  await page.click('#rfc-root .ops-jam');
  await page.waitForSelector('#rr-root', { state: 'detached' });
  assert.equal(await page.getAttribute('#rfc-root .ops-jam', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => __fake.sent.length), before, 'Jam sent nothing to the game');
  await ctx.close();
});
