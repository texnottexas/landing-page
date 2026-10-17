'use strict';
// Looter Locator in a real browser against the fake game (test/fixtures/mapc/index.html) and a fake worker.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/looter-locator.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['looter-locator.js', 'looter-locator-core.js', 'ops-tools.json', 'ops-stack.js', 'ops-drag.js'];

let server, base, browser, W;
function resetWorker() { W = { holder: '', worldHolder: '', down: false, claims: [], releases: [], usage: [] }; }
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (name === 'looter/claim' || name === 'looter/release' || name === 'ops/usage') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        const send = (code, o) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify(o)); };
        if (name === 'ops/usage') { W.usage.push(j); return send(200, { ok: true }); }
        if (W.down) return send(503, { ok: false });
        if (name === 'looter/release') { W.releases.push({ body: j, type: req.headers['content-type'] }); return send(200, { ok: true, released: true }); }
        W.claims.push({ body: j, type: req.headers['content-type'], at: Date.now() });
        if (W.holder && W.holder !== (j && j.name)) return send(409, { ok: false, error: 'taken', holder: W.holder });   // our alliance's runner
        const share = j.share !== false, world = share && !W.worldHolder;                                               // another alliance's runner may post to world chat
        return send(200, { ok: true, holder: j && j.name, ttlMs: 180000, world, worldHolder: world ? j.name : W.worldHolder });
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
test.beforeEach(resetWorker);

const AAKASH = { sid: 4419, name: 'Aakash' }, DON = { sid: 2937, name: 'Don' };
const P1 = { x: 480, y: 804, fSid: 4419, marchId: '4888553843884983816', attack: 1 }, P2 = { x: 659, y: 929, fSid: 2937, marchId: '4888562190968615425' };

// The fake game with Loot Quest on, these looters listed and on the map, fast timers; o.setup runs before launch.
async function open(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(([b, o]) => {
    window.__LOOT_WORKER = b.replace(/\/$/, '');
    window.__LOOT_GAP_MS = o.gapMs || 10; window.__LOOT_STUCK_MS = o.stuckMs || 180000; window.__LOOT_LIST_MS = o.listMs || 60000; window.__LOOT_RECHECK_MS = o.recheckMs || 60000;
    window.__LOOT_PUSH_MS = 50; window.__LOOT_BOUNCE_MS = o.bounceMs || 1500; window.__LOOT_TIMEOUT_MS = 600; window.__LOOT_PAUSE_MS = o.pauseMs || 60000;
    window.__LOOT_SHARE_GAP_MS = o.shareGapMs || 50; window.__LOOT_RENEW_MS = o.renewMs || 60000;
    window.__LOOT_MINUTE_MS = o.minuteMs || 0;           // the share delay's minute: 0 = share at once (the older tests), LOOT-DELAY sets it
    if (!o.realCaps) { window.__LOOT_MAX_PER_MIN = 1000; window.__LOOT_MAX_PER_10 = 1000; }   // fast passes; LOOT-9 keeps the real caps
    __fake.loot.list = o.list || []; __fake.loot.points = o.points || []; __fake.loot.infos = o.infos || {};
    __fake.chat.push({ _msgId: 'a0', _time: Math.floor(Date.now() / 1000) - 60, _worldId: '2864', _msgType: 0, _msg: 'hello alliance' });   // like after login: alliance chat holds history
  }, [base, { listMs: o.listMs, recheckMs: o.recheckMs, bounceMs: o.bounceMs, pauseMs: o.pauseMs, shareGapMs: o.shareGapMs, renewMs: o.renewMs, list: o.list, points: o.points, infos: o.infos, realCaps: o.realCaps, gapMs: o.gapMs, stuckMs: o.stuckMs, minuteMs: o.minuteMs }]);
  if (o.setup) await page.evaluate(o.setup);
  await page.addScriptTag({ url: base + 'looter-locator-core.js' });
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'looter-locator.js' });
const views = (page) => page.evaluate(() => __fake.loot.views.slice());
const lists = (page) => page.evaluate(() => __fake.loot.lists);
const shares = (page) => page.evaluate(() => __fake.shares.map((s) => s.link));
const ally = (page) => page.evaluate(() => __fake.loot.allyShares.map((s) => ({ at: s.at, link: s.link })));
const text = (page) => page.evaluate(() => (document.getElementById('loot-root') || {}).textContent || '');
const waitText = (page, re, timeout) => page.waitForFunction((r) => new RegExp(r).test((document.getElementById('loot-root') || {}).textContent || ''), re.source, { timeout: timeout || 10000 });
const running = (page) => page.waitForFunction(() => window.__LOOT && window.__LOOT.state().view === 'run', null, { timeout: 5000 });

test('LOOT-1: claims the runner slot, says only one person needs to run it, reads the looter list; nobody listed: no map lookups', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await running(page);
  await page.waitForFunction(() => __fake.loot.lists >= 1);
  assert.equal(W.claims.length, 1);
  assert.equal(W.claims[0].type, 'text/plain');
  assert.equal(W.claims[0].body.name, 'Tex'); assert.equal(W.claims[0].body.server, 2864); assert.match(W.claims[0].body.siteKey, /^[0-9a-f]{16}$/);
  assert.equal(W.claims[0].body.aid, 500273604, 'the alliance: one runner per alliance (Tex)'); assert.equal(W.claims[0].body.share, true);
  assert.match(await text(page), /Only one person per alliance needs to run Looter Locator\./);
  assert.match(await text(page), /You post to world chat and your alliance chat\./);
  await page.waitForTimeout(500);
  assert.equal((await views(page)).length, 0, 'no looters listed: no map lookups');
  assert.ok(!/—/.test(await text(page)), 'no em dash');
  await ctx.close();
});

test('LOOT-2 (Tex): someone in your alliance is running it: the card says who, counts down 10 s, closes itself, and sends no lookups', async () => {
  W.holder = 'Samson';
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], bounceMs: 1500 });
  await launch(page);
  await waitText(page, /Samson is running Looter Locator for your alliance right now\./);
  const t = await text(page);
  assert.match(t, /Looters it finds go to your alliance chat, so you don't need it open\./);
  assert.match(t, /Back to the Ops Center in \d+ s\./);
  await page.waitForFunction(() => !document.getElementById('loot-root'), null, { timeout: 4000 });
  assert.equal(await lists(page), 0, 'no looter list');
  assert.equal((await views(page)).length, 0, 'no map lookups');
  assert.equal(await page.evaluate(() => window.__LOOT.state().running), false);
  await ctx.close();
});

test('LOOT-2b: the 10-second return is real time by default (only the test shortens it)', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'looter-locator.js'), 'utf8');
  assert.match(src, /BOUNCE_MS = window\.__LOOT_BOUNCE_MS \|\| C\.BOUNCE_MS/);
  assert.equal(require('../looter-locator-core.js').BOUNCE_MS, 10000);
});

test('LOOT-3: the worker can\'t be reached: it says so and closes, with no lookups (fails closed)', async () => {
  W.down = true;
  const { ctx, page } = await open({ list: [AAKASH], points: [P1] });
  await launch(page);
  await waitText(page, /Couldn't check who's running Looter Locator\. Try again in a minute\./);
  await page.waitForFunction(() => !document.getElementById('loot-root'), null, { timeout: 4000 });
  assert.equal(await lists(page), 0);
  assert.equal((await views(page)).length, 0);
  await ctx.close();
});

test('LOOT-4: a looter crosses in (the game\'s event): the list is read, a zoom-level-1 pass finds both looters and stops early; the camera never moves', async () => {
  const { ctx, page } = await open({ points: [P1, P2] });
  await launch(page);
  await running(page);
  await page.waitForFunction(() => __fake.loot.lists >= 1);
  await page.evaluate(() => { __fake.loot.list = [{ sid: 4419, name: 'Aakash' }, { sid: 2937, name: 'Don' }]; __fake.crossIn(4419); });
  await page.waitForFunction(() => window.__LOOT.state().tracked === 2, null, { timeout: 15000 });
  const v = await views(page);
  assert.ok(v.length > 1 && v.length < 84, 'stopped early: ' + v.length);
  assert.ok(v.every((x) => x.lvl === 1), 'zoom level 1');
  assert.deepEqual(v.slice(0, 2).map((x) => [x.x, x.y]), [[60, 40], [180, 40]], 'serpentine from the top-left');
  const t = await text(page);
  assert.match(t, /Aakash/); assert.match(t, /S4419/); assert.match(t, /480, 804/);
  assert.match(t, /S2937/); assert.match(t, /659, 929/);
  assert.deepEqual(await page.evaluate(() => __fake.jumps), [], 'no camera jumps');
  await ctx.close();
});

test('LOOT-5 (Tex): a found looter goes to world chat as the game\'s own looter share, and to the runner\'s alliance chat 2 s later', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], infos: { [P1.marchId]: { leader: 'Aakash', sid: 4419 } } });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  const w = (await shares(page))[0];
  assert.deepEqual(w, { t: 0, st: 1, p: { x: 480, y: 804, z: 2864 }, s: '', sk: "Aakash's Loot Quest Team", icon: 'image/world_unit/cross_treasure_share', uts: 1 });
  const at = await page.evaluate(() => __fake.shares[0].at);
  await page.waitForFunction(() => __fake.loot.allyShares.length === 1, null, { timeout: 5000 });
  const a = (await ally(page))[0];
  assert.ok(a.at - at >= 1900, 'about 2 s after the world post: ' + (a.at - at));
  assert.deepEqual(a.link, w);
  assert.equal(await page.evaluate(() => __fake.loot.pickers), 0, 'never opens the chat picker');
  await ctx.close();
});

test('LOOT-6 (Tex): nobody posts a looter someone shared within 3 tiles in the last 5 minutes; the other looter still goes out; no repeats', async () => {
  const { ctx, page } = await open({ list: [AAKASH, DON], points: [P1, P2], recheckMs: 300, setup: () => { __fake.base('w', 2864, 481, 806, 60); } });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 2, null, { timeout: 15000 });
  await page.waitForFunction(() => __fake.shares.length === 1 && __fake.loot.allyShares.length === 2, null, { timeout: 8000 });
  await page.evaluate(() => { __fake.world.splice(1); __fake.chat.splice(1); });   // the chats forget the posts: only the tool's own memory stops a repeat
  await page.waitForTimeout(3500);                                   // several 30-second checks (300 ms here) later
  const s = await shares(page);
  assert.equal(s.length, 1, 'one post, never repeated');
  assert.deepEqual(s[0].p, { x: 659, y: 929, z: 2864 });
  assert.equal(s[0].sk, "S2937's Loot Quest Team", 'no point info: the server stands in for the name');
  // alliance chat has neither yet: both go there (Aakash right away, the S2937 team 2 s after its world post), once each
  assert.deepEqual((await ally(page)).map((a) => a.link.p.x + ',' + a.link.p.y).sort(), ['480,804', '659,929']);
  await ctx.close();
});

test('LOOT-7 (Tex): every 30 s it looks at each found looter\'s spot; a looter that moved is posted again at the new spot', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [Object.assign({}, P1)], recheckMs: 400 });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  const before = (await views(page)).length;
  await page.waitForTimeout(1000);
  const checks = (await views(page)).slice(before);
  assert.ok(checks.length >= 1 && checks.every((v) => v.x === 480 && v.y === 804 && v.lvl === 1), JSON.stringify(checks));
  await page.evaluate(() => { __fake.loot.points[0].x = 500; __fake.loot.points[0].y = 790; });   // moved within the window
  await page.waitForFunction(() => __fake.shares.length === 2, null, { timeout: 5000 });
  assert.deepEqual((await shares(page))[1].p, { x: 500, y: 790, z: 2864 });
  await page.evaluate(() => { __fake.world.splice(1); __fake.chat.splice(1); });   // only the tool's own memory can stop a repeat now
  await page.waitForTimeout(1200);
  assert.equal((await shares(page)).length, 2, 'staying put is not news');
  await ctx.close();
});

test('LOOT-8: a looter gone from its spot: the ring around it, then the whole map, finds the new spot; one that left the list is dropped', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [Object.assign({}, P1)], recheckMs: 300 });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 15000 });
  await page.evaluate(() => { __fake.loot.points[0].x = 100; __fake.loot.points[0].y = 100; });   // far away
  await page.waitForFunction(() => /100, 100/.test(document.getElementById('loot-root').textContent), null, { timeout: 15000 });
  await page.evaluate(() => { __fake.loot.points = []; __fake.loot.list = []; });
  await page.waitForFunction(() => window.__LOOT.state().tracked === 0, null, { timeout: 5000 });
  assert.ok(!/S4419/.test(await text(page)), 'dropped from the card');
  await ctx.close();
});

test('LOOT-9: hard caps at real volume: a listed looter that is never found pauses the pass at 40 lookups in a minute', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [], realCaps: true });
  await launch(page);
  await waitText(page, /Paused: 40 lookups in a minute/, 20000);
  await page.waitForTimeout(800);
  assert.equal((await views(page)).length, 40, 'not one more');
  await ctx.close();
});

test('LOOT-10: its own unanswered view doesn\'t hold it up, but two in a row pause it, with the reason on the card', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => { __fake.loot.viewMode = 'silent'; } });
  await launch(page);
  await waitText(page, /Paused: the map stopped answering\. Back in \d:\d\d\./, 10000);
  await page.waitForTimeout(1000);
  assert.equal((await views(page)).length, 2, 'the second view went out though the first was still pending; then the pause');
  await ctx.close();
});

test('LOOT-11: Loot Quest isn\'t running and nobody is left on the map: one look at the list, then it waits and says when the next one starts', async () => {
  const { ctx, page } = await open({ list: [], points: [P1], listMs: 300, setup: () => { const n = Date.now(); __fake.loot.cs.timeInfo.openTime = [{ beginMill: String(n + 3600000), endMill: String(n + 10800000) }]; } });
  await launch(page);
  await waitText(page, /Loot Quest isn't running now\. Next one in 1:00:00|Loot Quest isn't running now\. Next one in 59:5\d/);
  await page.waitForTimeout(1500);
  assert.equal(await lists(page), 1, 'one look, no more');
  assert.equal((await views(page)).length, 0);
  await ctx.close();
});

test('LOOT-12: Stop releases the runner slot, stops listening, and closes the card', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await running(page);
  await page.click('#loot-stop');
  await page.waitForFunction(() => !document.getElementById('loot-root'));
  await page.waitForTimeout(300);
  assert.equal(W.releases.length, 1);
  assert.equal(await page.evaluate(() => (__fake.handlers.UPDATE_CS_HUNT_ASSEMBLY_TIPS || []).length), 0, 'no listener left');
  const n = await lists(page);
  await page.evaluate(() => __fake.crossIn(4419));
  await page.waitForTimeout(300);
  assert.equal(await lists(page), n, 'a crossing after Stop does nothing');
  await ctx.close();
});

test('LOOT-13: with Share off it still finds looters but posts nothing; the switch is remembered', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => localStorage.setItem('loot_share_v1', '0') });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  assert.equal((await shares(page)).length, 0);
  assert.equal((await ally(page)).length, 0);
  assert.equal(await page.getAttribute('#loot-share', 'aria-pressed'), 'false');
  assert.equal(W.claims[0].body.share, false, 'Share off never takes the world chat slot');
  assert.match(await text(page), /Share is off: nothing is posted\./);
  await page.click('#loot-share');
  assert.equal(await page.evaluate(() => localStorage.getItem('loot_share_v1')), '1');
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 5000 });
  await ctx.close();
});

test('LOOT-14: Go jumps the camera to a looter, only when tapped', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1] });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => __fake.jumps), []);
  await page.click('.loot-go');
  assert.deepEqual(await page.evaluate(() => __fake.jumps), [{ n: 'WorldMapJumpToTileClick', x: 480, y: 804, z: 2864 }]);
  await ctx.close();
});

test('LOOT-15: the runner slot is renewed while it runs; losing it to someone else stops with their name', async () => {
  const { ctx, page } = await open({ renewMs: 300 });
  await launch(page);
  await running(page);
  await page.waitForTimeout(800);
  assert.ok(W.claims.length >= 2, 'renewed: ' + W.claims.length);
  W.holder = 'Samson';
  await waitText(page, /Looter Locator stopped: Samson is running it for your alliance now\./, 5000);
  assert.equal(await page.getAttribute('#loot-root', 'data-ops-stopped'), '1');
  await ctx.close();
});

test('LOOT-16 (Tex): another alliance\'s runner posts to world chat: this one posts to its alliance chat only, and says who has world chat', async () => {
  W.worldHolder = 'Gary';
  const { ctx, page } = await open({ list: [AAKASH], points: [P1] });
  await launch(page);
  await page.waitForFunction(() => __fake.loot.allyShares.length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  assert.equal((await shares(page)).length, 0, 'no world chat post');
  assert.deepEqual((await ally(page))[0].link.p, { x: 480, y: 804, z: 2864 });
  assert.match(await text(page), /You post to your alliance chat\. Gary posts to world chat\./);
  W.worldHolder = '';                                                   // Gary stopped: the next renewal takes world chat
  await ctx.close();
});

test('LOOT-17 (Tex): the 5-minute rule holds for alliance chat on its own: a spot your alliance already has is not posted there again', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => { __fake.base('a', 2864, 480, 805, 30); } });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(2600);
  assert.equal((await ally(page)).length, 0, 'alliance chat already had it');
  await ctx.close();
});

test('LOOT-18: the runner becomes the world chat poster when the slot frees up (at its next renewal)', async () => {
  W.worldHolder = 'Gary';
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], renewMs: 300 });
  await launch(page);
  await waitText(page, /Gary posts to world chat\./);
  W.worldHolder = '';
  await waitText(page, /You post to world chat and your alliance chat\./, 5000);
  await ctx.close();
});

test('LOOT-19 (review): a chat whose history isn\'t loaded gets nothing (fails closed): world still posts, alliance waits', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => { __fake.chat.length = 0; } });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(2600);
  assert.equal((await ally(page)).length, 0, 'no alliance history: no alliance post');
  await page.evaluate(() => __fake.chat.push({ _msgId: 'late', _time: Math.floor(Date.now() / 1000), _msg: 'history arrived' }));
  await page.waitForFunction(() => __fake.loot.allyShares.length === 1, null, { timeout: 5000 });
  await ctx.close();
});

test('LOOT-20 (review, critical): a refused or unanswered looter list is asked again in a minute, never in a loop', async () => {
  for (const mode of ['refuse', 'silent']) {
    const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: new Function('__fake.loot.listMode = "' + mode + '";') });
    await launch(page);
    await page.waitForFunction(() => __fake.loot.lists >= 1);
    await page.evaluate(() => __fake.crossIn(4419));                  // a push asks for the list again: still one at a time
    await page.waitForTimeout(3500);
    assert.ok((await lists(page)) <= 2, mode + ': ' + (await lists(page)) + ' list requests');
    await ctx.close();
  }
});

test('LOOT-21 (review): a pass never holds up posting: a looter found early is posted while the pass goes on', async () => {
  const B = { x: 180, y: 40, fSid: 3535, marchId: '3535000000000000001' };
  const { ctx, page } = await open({ list: [{ sid: 1000, name: 'Ghost' }, { sid: 3535, name: 'Ice' }], points: [B], gapMs: 60 });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  const n = (await views(page)).length;
  assert.ok(n < 40, 'posted at view ' + n + ', long before the pass ends');
  await ctx.close();
});

test('LOOT-22 (review): after a pass that couldn\'t find someone (held 5 minutes), the next pass ends as soon as the newcomer is found', async () => {
  const { ctx, page } = await open({ list: [{ sid: 1000, name: 'Ghost' }], points: [] });
  await launch(page);
  await page.waitForFunction(() => __fake.loot.views.length >= 84, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  assert.equal((await views(page)).length, 84, 'one full pass, then the ghost is held');
  await page.evaluate(() => { __fake.loot.points.push({ x: 300, y: 40, fSid: 3535, marchId: '3535000000000000002' }); __fake.loot.list.push({ sid: 3535, name: 'Ice' }); __fake.crossIn(3535); });
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 10000 });
  await page.waitForTimeout(1000);
  assert.ok((await views(page)).length <= 84 + 6, 'the second pass stopped at the newcomer: ' + (await views(page)).length);
  await ctx.close();
});

test('LOOT-23 (review): Loot Quest windows follow the game server\'s clock, not the device\'s', async () => {
  const { ctx, page } = await open({ list: [], points: [P1], setup: () => { __fake.timeShift = -7200; } });   // server 2 h behind: the window hasn't opened there
  await launch(page);
  await waitText(page, /Loot Quest isn't running now\./);               // by the device's clock it would say "No looters on the map. Watching."
  await page.waitForTimeout(600);
  assert.ok((await lists(page)) <= 1);
  assert.equal((await views(page)).length, 0);
  await ctx.close();
});

test('LOOT-24 (Tex): another tool\'s map view still out: the card says it is waiting for the game, and sends nothing until it\'s answered', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => { __fake.pending.push(901); } });
  await launch(page);
  await waitText(page, /Waiting for the game to answer a map view\.\.\./, 5000);
  await page.waitForTimeout(600);
  assert.equal((await views(page)).length, 0);
  await page.evaluate(() => { __fake.pending = []; });
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 10000 });
  await ctx.close();
});

test('LOOT-25 (Tex): the pace is about 1.5 s between its own lookups (1.5-1.8 s), sharing the Ops clock', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'looter-locator.js'), 'utf8');
  assert.match(src, /GAP_MS = window\.__LOOT_GAP_MS \|\| 1500/);
  assert.match(src, /Math\.random\(\) \* 300/);
});

// Tex 2026-10-17: looters who came in before Loot Quest ended stay on the map; keep at it until the list is empty.
test('LOOT-26 (Tex): when Loot Quest ends with looters still on the map, it keeps checking and posting until the list is empty, then stops asking', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [Object.assign({}, P1)], recheckMs: 300, listMs: 500, setup: () => { const n = Date.now(); __fake.loot.cs.timeInfo.openTime = [{ beginMill: String(n - 600000), endMill: String(n + 3000) }]; } });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 10000 });
  await waitText(page, /Loot Quest ended\. Watching the looters still on the map\./, 8000);
  const v1 = (await views(page)).length;
  await page.evaluate(() => { __fake.loot.points[0].x = 500; __fake.loot.points[0].y = 790; });   // moved after the window closed
  await page.waitForFunction(() => __fake.shares.length === 2, null, { timeout: 5000 });
  assert.ok((await views(page)).length > v1, 'still checking after the window closed');
  await page.evaluate(() => { __fake.loot.list = []; __fake.loot.points = []; });
  await waitText(page, /Loot Quest isn't running now\./, 5000);
  const v2 = (await views(page)).length, l2 = await lists(page);
  await page.waitForTimeout(1500);
  assert.equal((await views(page)).length, v2, 'no more lookups');
  assert.equal(await lists(page), l2, 'no more list reads');
  await ctx.close();
});

test('LOOT-27 (Tex): opened after Loot Quest ended with a looter still listed: it finds and posts them', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], setup: () => { const n = Date.now(); __fake.loot.cs.timeInfo.openTime = [{ beginMill: String(n - 7800000), endMill: String(n - 600000) }, { beginMill: String(n + 21000000), endMill: String(n + 28200000) }]; } });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 10000 });
  assert.deepEqual((await shares(page))[0].p, { x: 480, y: 804, z: 2864 });
  await ctx.close();
});

test('LOOT-28: outside Loot Quest, a refused looter list ends it there (never a retry loop)', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], listMs: 300, setup: () => { const n = Date.now(); __fake.loot.listMode = 'refuse'; __fake.loot.cs.timeInfo.openTime = [{ beginMill: String(n - 7800000), endMill: String(n - 600000) }]; } });
  await launch(page);
  await waitText(page, /Loot Quest isn't running now\./);
  await page.waitForTimeout(1500);
  assert.equal(await lists(page), 1);
  assert.equal((await views(page)).length, 0);
  await ctx.close();
});

// Tex 2026-10-17: "before sharing to world chat and alliance chat, let us add a 2 minute delay, we are now finding them
// too fast ... configurable from the sharer's menu, default 2 minutes, up to 5". A minute is 300 ms here.
test('LOOT-DELAY-1 (Tex): a found looter is shared 2 minutes after it was found (world, then alliance 2 s later); the card counts down', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], minuteMs: 300, infos: { [P1.marchId]: { leader: 'Aakash', sid: 4419 } } });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 15000 });
  const found = await page.evaluate(() => Date.now());
  assert.equal(await page.$eval('#loot-delay', (e) => e.value), '2');
  assert.deepEqual(await page.$$eval('#loot-delay option', (os) => os.map((o) => o.value + '=' + o.textContent)), ['1=1 min', '2=2 min', '3=3 min', '4=4 min', '5=5 min']);
  await waitText(page, /Shares in \d+:\d\d/);
  assert.equal((await shares(page)).length, 0, 'nothing yet');
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 8000 });
  const w = await page.evaluate(() => __fake.shares[0].at);
  assert.ok(w - found >= 550, 'world chat waited the 2 minutes: ' + (w - found));
  await page.waitForFunction(() => __fake.loot.allyShares.length === 1, null, { timeout: 5000 });
  const a = (await ally(page))[0];
  assert.ok(a.at - w >= 1900, 'alliance chat still 2 s after the world post');
  await ctx.close();
});

test('LOOT-DELAY-2 (Tex): the sharer picks 1 to 5 minutes on the card; it is remembered and used', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [P1], minuteMs: 300, setup: () => localStorage.setItem('loot_delay_v1', '4') });
  await launch(page);
  await page.waitForFunction(() => window.__LOOT.state().tracked === 1, null, { timeout: 15000 });
  const found = await page.evaluate(() => Date.now());
  assert.equal(await page.$eval('#loot-delay', (e) => e.value), '4', 'remembered');
  await page.waitForTimeout(800);
  assert.equal((await shares(page)).length, 0, 'not at 2 minutes: the sharer chose 4');
  await page.selectOption('#loot-delay', '1');
  assert.equal(await page.evaluate(() => localStorage.getItem('loot_delay_v1')), '1');
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 5000 });
  const w = await page.evaluate(() => __fake.shares[0].at);
  assert.ok(w - found >= 250, 'a change applies to looters already waiting');
  await ctx.close();
});

test('LOOT-DELAY-3 (Tex): a looter that moves after it was shared is shared again only after the delay from the move', async () => {
  const { ctx, page } = await open({ list: [AAKASH], points: [Object.assign({}, P1)], minuteMs: 300, recheckMs: 200 });
  await launch(page);
  await page.waitForFunction(() => __fake.shares.length === 1, null, { timeout: 15000 });
  const moved = await page.evaluate(() => { __fake.loot.points[0].x = 500; __fake.loot.points[0].y = 790; return Date.now(); });
  await page.waitForFunction(() => __fake.shares.length === 2, null, { timeout: 8000 });
  const second = await page.evaluate(() => __fake.shares[1]);
  assert.deepEqual(second.link.p, { x: 500, y: 790, z: 2864 });
  assert.ok(second.at - moved >= 550, 'waited the 2 minutes after the move: ' + (second.at - moved));
  await ctx.close();
});

test('LOOT-DELAY-4: the delay minute is real time by default (only the test shortens it)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'looter-locator.js'), 'utf8');
  assert.match(src, /MINUTE_MS = window\.__LOOT_MINUTE_MS != null \? window\.__LOOT_MINUTE_MS : 60000/);
});

