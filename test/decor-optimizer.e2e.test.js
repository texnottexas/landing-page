'use strict';
// Decor Optimizer (Tex 2026-10-17) in a real browser against the fake game (test/fixtures/decor/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/decor-optimizer.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'decor');
const OWN = ['decor-core.js', 'decor-game.js', 'decor-optimizer.js', 'ops-drag.js'];
const UID = 'test-owner-uid';
const SK = crypto.createHash('sha256').update(UID).digest('hex').slice(0, 16);
const DECOR = [104, 129, 130, 131, 4754, 4755, 4757, 4760, 4792, 4793, 4798, 4800];

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

// o: { mode: {rid: 'refuse'|'silent'|'nostate'}, staleAfter, inBase, cap, drag }
async function open(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate(([b, o2]) => {
    window.__DPO_WORKER = b.replace(/\/$/, ''); window.__DPO_FAST = true; window.__DPO_GAP_MS = 60; window.__DPO_TIMEOUT_MS = 800; window.__DPO_SETTLE_MS = 600;
    if (o2.cap) window.__DPO_RUN_CAP = o2.cap;
    Object.assign(__fake.mode, o2.mode || {});
    if (o2.staleAfter) __fake.staleAfter = o2.staleAfter;
    if (o2.inBase === false) __fake.inBase = false;
  }, [base, o]);
  if (o.drag) await page.addScriptTag({ url: base + 'ops-drag.js' });
  await page.addScriptTag({ url: base + 'decor-core.js' });
  await page.addScriptTag({ url: base + 'decor-game.js' });
  return { ctx, page };
}
const launch = (page) => page.addScriptTag({ url: base + 'decor-optimizer.js' });
const sent = (page) => page.evaluate((ids) => __fake.sent.filter((x) => ids.includes(x.rid)).map((x) => ({ rid: x.rid, p: x.p, at: x.at })), DECOR);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: timeout || 8000 });
const runToEnd = async (page) => { await page.click('#dpo-run'); await page.waitForFunction(() => window.__DPO && window.__DPO.state().view === 'message', null, { timeout: 15000 }); return page.$eval('#dpo-root', (e) => e.textContent); };

test('DPO-1: the preview sends nothing and shows the plan, the stats and what stays in the bag', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const text = await page.$eval('#dpo-preview', (e) => e.textContent);
  assert.match(text, /Collab box: 1 in/);
  assert.match(text, /To the bag: 2 that don't count/);
  assert.match(text, /Advanced Upgrade: 1 step/);
  assert.match(text, /Sea decor moved south: 1/);
  assert.match(text, /Base decor into the showcase: 6 \(biggest first\)/, 'Weapon Box and the 5 Benches (Tex: showcase first)');
  assert.match(text, /All Units HP \+2\.00%/);
  assert.equal((await sent(page)).length, 0);
  await ctx.close();
});

test('DPO-2: Run follows the phase order and leaves the base as planned', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const end = await runToEnd(page);
  assert.match(end, /Done\./, end);
  const rids = (await sent(page)).map((x) => x.rid);
  const first = (r) => rids.indexOf(r);
  assert.ok(first(4760) === 0, rids.join(','));
  assert.ok(first(4760) < first(131) && first(131) < first(4757), rids.join(','));
  assert.ok(first(4757) < first(130) && first(130) < first(4793), rids.join(','));
  assert.ok(first(4793) < first(4755) && first(4755) < first(104), rids.join(','));
  const st = await page.evaluate(() => {
    const U = __require('DataCenter').DATA.UserData;
    const rows = __require('TableManager').TABLE._tableMap.building, inShow = U._museumData.flatMap((l) => l.labelStoreData.map((e) => rows[e.decorationId]));
    const bench = U.Buildings.map((b) => b.Data).concat(inShow).filter((d) => d.group === 4080).map((d) => d.level).sort();
    const baseLand = U.Buildings.filter((b) => b.Data.type === 4 && b.Data.point_type === 1 && b.Data.buff_id).map((b) => b.Data.name);
    return { slot79: U.collabDecorateBox[79] && U.collabDecorateBox[79].decorationId, hsLv1: __fake.count(48217), exp: __fake.up.exp,
      tab1: U._museumData[0].labelStoreData.map((e) => e.decorationId).sort(), bench, dockY: __fake.building('dock').Pos % 1000, buoy: __fake.building('buoy').Pos,
      sax: !!__fake.building('sax'), troopDecor: U.Buildings.filter((b) => b.Data.type === 4 && b.Pos % 1000 < 10 && b.Data.buff_id).length, baseLand,
      wbInShow: inShow.some((d) => d.id === 47129) };
  });
  assert.equal(st.slot79, 53159, 'Toothless in its collab slot');
  assert.equal(st.hsLv1, 0); assert.equal(st.exp, 2, 'both spare Hardcore Shooters fed');
  assert.ok(st.tab1.includes(54731) && !st.tab1.includes(47128), 'Cherished Affection in the showcase; the spare Weapon Box out');
  assert.deepEqual(st.bench, [2, 2, 2, 2, 3], 'one Bench raised from the 6 spare Lv1');
  assert.deepEqual(st.baseLand, [], 'showcase first: no wanted land decor left in the base (Tex)');
  assert.equal(st.wbInShow, true);
  assert.ok(st.dockY >= 10, 'the Floating Dock left the troop area\'s water');
  assert.equal(st.buoy, 22004, 'decor with no stats never moves');
  assert.equal(st.sax, false, 'the completed set\'s member went to the bag');
  assert.equal(st.troopDecor, 0);
  await ctx.close();
});

test('DPO-3: one request at a time on the shared Ops clock; the run limit stops with "Run it again"', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const at0 = await page.evaluate(() => (window.__opsPace || {}).at || 0);
  await runToEnd(page);
  const s = await sent(page);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 55, 'gap ' + (s[i].at - s[i - 1].at));
  assert.ok((await page.evaluate(() => window.__opsPace.at)) > at0);
  await ctx.close();
  const b = await open({ cap: 3 });
  await launch(b.page);
  await waitText(b.page, '#dpo-preview', /The plan/);
  const end = await runToEnd(b.page);
  assert.match(end, /Run it again/);
  assert.equal((await sent(b.page)).length, 3);
  await b.ctx.close();
});

test('DPO-4: the unit switches change the plan and are remembered per account', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  assert.doesNotMatch(await page.$eval('#dpo-preview', (e) => e.textContent), /Communication Cable/);
  await page.click('#dpo-navy');
  await waitText(page, '#dpo-preview', /unit switched off\): Communication Cable/);
  assert.equal(await page.$eval('#dpo-navy', (e) => e.getAttribute('aria-pressed')), 'false');
  assert.deepEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), 'dpo_units_v1_' + SK)), { army: true, navy: false, air: true });
  await ctx.close();
});

test('DPO-REFUSE: a refusal stops the run with the game\'s own text and nothing more is sent', async () => {
  const { ctx, page } = await open({ mode: { 129: 'refuse' } });
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const end = await runToEnd(page);
  assert.match(end, /Refused: "refused_129"/);
  const s = await sent(page);
  assert.equal(s[s.length - 1].rid, 129);
  await ctx.close();
});

test('DPO-SILENT: a yes from the game with no change stops the run (Review Focus 3)', async () => {
  const { ctx, page } = await open({ mode: { 130: 'nostate' } });
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const end = await runToEnd(page);
  assert.match(end, /didn't confirm merge/);
  const s = await sent(page);
  assert.equal(s[s.length - 1].rid, 130);
  assert.equal(s.filter((x) => x.rid === 130).length, 1);
  await ctx.close();
});

test('DPO-STALE: a planned piece that moved meanwhile stops the run and is never sent (Review Focus 2)', async () => {
  const { ctx, page } = await open({ staleAfter: 131 });
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const end = await runToEnd(page);
  assert.match(end, /The base changed\. Run again\./);
  assert.equal((await sent(page)).filter((x) => x.rid === 4757).length, 0);
  await ctx.close();
});

test('DPO-HOME: launched on the world map, it goes home first, then shows the preview (Review Focus 1)', async () => {
  const { ctx, page } = await open({ inBase: false });
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  assert.equal(await page.evaluate(() => __fake.homePressed), 1);
  await ctx.close();
});

test('DPO-USAGE: one usage report with the changes made, never a UID', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  await runToEnd(page);
  await page.waitForTimeout(300);
  assert.equal(usageLog.length, 1);
  const n = (await sent(page)).length;
  assert.equal(usageLog[0].body.tool, 'decor-optimizer');
  assert.equal(usageLog[0].body.siteKey, SK);
  assert.equal(usageLog[0].body.count, n);
  assert.equal(usageLog[0].type, 'text/plain');
  assert.ok(!usageLog[0].raw.includes(UID));
  await ctx.close();
});

test('DPO-DRAG: the card drags by its title and keeps its spot after a relaunch', async () => {
  const { ctx, page } = await open({ drag: true });
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  const at = () => page.$eval('#dpo-root', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; });
  const a = await at(), h = await page.$eval('#dpo-root .dpo-head', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x + 20, h.y + 150, { steps: 6 }); await page.mouse.up();
  const b = await at();
  assert.deepEqual(b, { x: a.x + 20, y: a.y + 150 });
  await page.evaluate(() => window.__DPO.stop());
  await launch(page);
  await waitText(page, '#dpo-preview', /The plan/);
  assert.deepEqual(await at(), b);
  await ctx.close();
});
