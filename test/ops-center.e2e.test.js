'use strict';
// Ops Center in a real browser against a fake game page (test/fixtures/ops/index.html).
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ops-center.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'ops');
const OWN = ['ops-center.js', 'ops-kit.js', 'ops-core.js'];
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    let name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (name.includes('..')) { res.writeHead(400); res.end(); return; }
    // /broken/... has no tool list, /nomember/... has no member list
    const mode = (name.match(/^(broken|nomember|badroster)\//) || [])[1];
    if (mode) name = name.slice(mode.length + 1);
    if ((mode === 'broken' && name === 'ops-tools.json') || (mode === 'nomember' && name === 'player-data.json')) { res.writeHead(404); res.end(); return; }
    if (mode === 'badroster' && name === 'player-data.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"players":"not a list"}'); return; }
    const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });

async function open(viewport, before) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  if (before) await page.evaluate(before);
  await page.addScriptTag({ url: base + 'ops-center.js' });          // what the bookmarklet does
  await page.waitForSelector('.ops-card');
  return { ctx, page };
}
const PHONE = { width: 375, height: 740 }, DESKTOP = { width: 1280, height: 800 };
const tileNames = (page) => page.$$eval('.ops-tile .ops-tname', (els) => els.map((e) => e.textContent));
const tileStatus = (page, name) => page.$$eval('.ops-tile', (els, n) => {
  const t = els.find((e) => e.querySelector('.ops-tname').textContent === n);
  return t ? [...t.querySelectorAll('.ops-pill')].map((p) => p.textContent) : null;
}, name);
const clickTile = (page, name) => page.click('.ops-tile:has(.ops-tname:text-is("' + name + '"))');

test('phone menu: member header, 2 columns, live statuses, no first-run badges, search', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  assert.equal(await page.textContent('.ops-sub'), 'Tester · S2864 ✓');
  assert.deepEqual(await tileNames(page), ['Alpha Tool', 'Beta Tool', 'Gamma Tool', 'Delta Tool', 'Epsilon Tool', 'Zeta Tool', 'Owner Tool']);
  assert.deepEqual(await tileStatus(page, 'Zeta Tool'), ['Not ready'], 'a base the tool does not handle itself is a real Not ready');
  const boxes = await page.$$eval('.ops-tile', (els) => els.slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
  assert.notEqual(boxes[0][0], boxes[1][0]); assert.equal(boxes[0][1], boxes[1][1], 'two tiles side by side');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready']);
  assert.deepEqual(await tileStatus(page, 'Beta Tool'), ['Locked']);
  assert.deepEqual(await tileStatus(page, 'Gamma Tool'), ['Not ready']);
  await page.fill('.ops-input', 'layout');
  assert.deepEqual(await tileNames(page), ['Beta Tool']);
  await page.fill('.ops-input', 'zzz');
  assert.match(await page.textContent('.ops-empty'), /No tools match "zzz"/);
  const text = await page.textContent('.ops-root');
  assert.ok(!text.includes('—'), 'no em dashes');
  await ctx.close();
});

test('desktop menu: 4 tiles per row', async () => {
  const { ctx, page } = await open(DESKTOP);
  await page.waitForSelector('.ops-tile');
  const tops = await page.$$eval('.ops-tile', (els) => els.slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1);
  await ctx.close();
});

test('tool page: unlock with the code, readiness turns green live, a base the tool can reach still says Launch', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Beta Tool');
  assert.equal(await page.textContent('.ops-title'), 'Beta Tool');
  assert.ok(await page.isDisabled('.ops-btn.primary'));
  await page.fill('input[type=password]', 'nope');
  await page.click('.ops-btn:text-is("Unlock")');
  await page.waitForSelector('.ops-note.err:text-is("That code is not right.")');
  await page.fill('input[type=password]', 'open-sesame');
  await page.click('.ops-btn:text-is("Unlock")');
  await page.waitForSelector('input[type=password]', { state: 'detached' });
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch', 'the tool takes you to your base itself');
  assert.ok((await page.textContent('.ops-box')).includes('Takes you to your base first'));
  await page.evaluate(() => { window.__fake.base = true; });
  await page.waitForFunction(() => document.querySelector('.ops-box').textContent.includes('Your base is open'), null, { timeout: 2500 });
  await page.click('.ops-icon-btn[aria-label=Back]');
  assert.deepEqual(await tileStatus(page, 'Beta Tool'), ['Ready']);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops_unlock_v1')), '"1"');
  await ctx.close();
});

test('launch: menu becomes a pill above the tool, re-run shows a note, closing the tool brings the menu back', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await page.waitForSelector('.ops-card', { state: 'detached' });
  await page.waitForSelector('.ops-fab:has-text("Alpha Tool running")');
  assert.ok((await page.$eval('.ops-fab', (e) => e.getBoundingClientRect().height)) >= 44, 'pill is a 44 px tap target');
  const onTop = await page.evaluate(() => {
    const r = document.querySelector('.ops-fab').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit.closest('.ops-fab');
  });
  assert.ok(onTop, 'the pill sits above the tool screen');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Alpha Tool is open")');
  await page.click('.ops-fab');
  await page.click('.ops-bubble .ops-btn:text-is("Hide this button")');
  await page.waitForSelector('.ops-fab', { state: 'detached' });
  await page.click('#fake-alpha-close');
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  assert.equal((await tileNames(page))[0], 'Alpha Tool', 'recently used first');
  assert.equal(await page.$('.ops-fab'), null);
  await ctx.close();
});

test('a tool found only by its declared overlay id is tracked too', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_unlock_v1', '"1"'); window.__fake.base = true; });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Beta Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("Beta Tool running")');
  await page.evaluate(() => document.getElementById('fake-beta').remove());
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  await ctx.close();
});

test('a tool that opens nothing hands back to the menu after about 10 s', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Gamma Tool');
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch anyway');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("starting Gamma Tool")');
  await page.waitForSelector('.ops-card', { timeout: 13000 });
  assert.equal(await page.evaluate(() => window.__silentRuns), 1);
  await ctx.close();
});

test('a script that fails to load shows a retry message', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Delta Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t load Delta Tool")', { timeout: 4000 });
  assert.ok((await page.$eval('.ops-toast .ops-btn', (e) => e.getBoundingClientRect().height)) >= 44, 'Retry is a 44 px tap target');
  await ctx.close();
});

test('not an S2864 member: no tiles, a plain message', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; });
  await page.waitForSelector('.ops-note:has-text("This is for Server 2864 members.")');
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});

test('waiting for the game, then tiles once it has loaded', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.loaded = false; });
  await page.waitForSelector('.ops-note:has-text("Waiting for the game")');
  await page.evaluate(() => { window.__fake.loaded = true; });
  await page.waitForSelector('.ops-tile', { timeout: 5000 });
  await ctx.close();
});

test('badges: Updated after a version change, New for a newly listed tool', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_seen_v1', JSON.stringify({ alpha: '0', beta: '1', gamma: '1' })); });
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready', 'Updated']);
  assert.deepEqual(await tileStatus(page, 'Delta Tool'), ['Ready', 'New']);
  assert.deepEqual(await tileStatus(page, 'Gamma Tool'), ['Not ready']);
  await ctx.close();
});

test('Esc closes everything; running the bookmarklet again reopens the menu', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ops-root', { state: 'detached' });
  await page.addScriptTag({ url: base + 'ops-center.js' });
  await page.waitForSelector('.ops-tile');
  await ctx.close();
});

test('the tool list fails to load: a plain message with Retry, not a broken menu', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/broken/'; });
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t load the tool list")');
  assert.ok(await page.$('.ops-toast .ops-btn:text-is("Retry")'));
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});

test('the member list fails to load: a plain message with Retry, no tiles', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/nomember/'; });
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t check your membership")');
  assert.equal(await page.$('.ops-tile'), null);
  await ctx.close();
});

test('a readiness item the tool handles itself shows an arrow, not a warning', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_unlock_v1', '"1"'); });
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Beta Tool'), ['Ready']);
  await clickTile(page, 'Beta Tool');
  const dots = await page.$$eval('.ops-check .ops-dot', (els) => els.map((e) => e.className.replace('ops-dot ', '') + ':' + e.textContent));
  assert.deepEqual(dots, ['ok:✓', 'info:→']);
  await ctx.close();
});

test('closing the menu while a silent tool is still watched leaves nothing behind', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Gamma Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-card', { timeout: 13000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ops-root', { state: 'detached', timeout: 2000 });
  const st = await page.evaluate(() => { const S = window.OpsCenter._state; return { observer: S.observer, tick: S.tick }; });
  assert.deepEqual(st, { observer: null, tick: null });
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.appendChild(d); });
  await page.waitForTimeout(600);
  assert.equal(await page.$('.ops-fab'), null, 'a later fixed element does not bring the pill back');
  await ctx.close();
});

test('while a tool is starting: the note says starting, and a hidden pill stays hidden once its screen opens', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Epsilon Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("starting Epsilon Tool")');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Starting Epsilon Tool")');
  await page.click('.ops-bubble .ops-btn:text-is("Hide this button")');
  await page.waitForSelector('#fake-late', { timeout: 4000 });
  await page.waitForTimeout(400);
  assert.equal(await page.$('.ops-fab'), null, 'stays hidden after the screen opens');
  await page.evaluate(() => document.getElementById('fake-late').remove());
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("Alpha Tool running")', { timeout: 3000 });
  await ctx.close();
});

test('a corrupt recent-tools entry does not empty the menu', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_recent_v1', '"alpha"'); localStorage.setItem('ops_seen_v1', '"oops"'); });
  await page.waitForSelector('.ops-tile', { timeout: 5000 });
  assert.equal((await tileNames(page)).length, 7);
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha', { timeout: 3000 });
  await ctx.close();
});

test('a member list that is not a list offers Retry instead of saying you are not a member', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/badroster/'; });
  await page.waitForSelector('.ops-toast:has-text("Couldn\'t check your membership")');
  assert.equal(await page.$('.ops-note:has-text("This is for Server 2864 members.")'), null);
  await ctx.close();
});

test('Unlock says so when the browser cannot check the code', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Beta Tool');
  await page.evaluate(() => { crypto.subtle.digest = () => Promise.reject(new Error('no crypto')); });
  await page.fill('input[type=password]', 'open-sesame');
  await page.click('.ops-btn:text-is("Unlock")');
  await page.waitForSelector('.ops-note.err:text-is("Unlocking is not available right now.")', { timeout: 3000 });
  await ctx.close();
});

test('tapping the bookmarklet twice while it is still loading opens one menu and throws nothing', async () => {
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate((b) => { for (let i = 0; i < 2; i++) { const s = document.createElement('script'); s.src = b + 'ops-center.js'; document.body.appendChild(s); } }, base);
  await page.waitForSelector('.ops-tile', { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
  assert.equal(await page.$$eval('.ops-card', (e) => e.length), 1);
  await ctx.close();
});

test('launching the same tool twice works, and script tags do not pile up', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  for (let i = 0; i < 2; i++) {
    await clickTile(page, 'Alpha Tool');
    await page.click('.ops-btn.primary');
    await page.waitForSelector('#fake-alpha');
    await page.click('#fake-alpha-close');
    await page.waitForSelector('.ops-card', { timeout: 3000 });
  }
  assert.equal(await page.evaluate(() => window.__alphaRuns), 2);
  assert.equal(await page.$$eval('script[data-ops]', (e) => e.length), 0, 'loader script tags are removed once loaded');
  await ctx.close();
});

test('a cached membership still picks up a new rank from the member list', async () => {
  const { ctx, page } = await open(PHONE, () => {
    localStorage.setItem('ops_member_v1', JSON.stringify({ sk: '03c2cd3196b2f243', at: Date.now(), row: { name: 'Tester', rank: 1 } }));
  });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Gamma Tool');
  await page.waitForFunction(() => document.querySelector('.ops-box').textContent.includes('You are R4 or leader'), null, { timeout: 4000 });
  await ctx.close();
});

test('base open means the same as for the Troop Optimizer: units still landing is not open yet', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.base = true; window.__fake.armyComplete = false; window.__fake.armys = [{ _id: 'u1', warehouseId: '0' }]; });
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Zeta Tool'), ['Not ready']);
  await page.evaluate(() => { window.__fake.armyItems = { u1: {} }; });
  await page.waitForFunction(() => [...document.querySelectorAll('.ops-tile')].some((t) => t.textContent.includes('Zeta Tool') && t.textContent.includes('Ready') && !t.textContent.includes('Not ready')), null, { timeout: 2500 });
  await ctx.close();
});


test('owner-only tile shows for the owner and is hidden for any other account', async () => {
  const a = await open(DESKTOP);
  await a.page.waitForSelector('.ops-tile');
  assert.ok((await tileNames(a.page)).includes('Owner Tool'));
  await a.ctx.close();
  // a second roster member who is not an owner
  const b = await open(DESKTOP, () => { window.__fake.uid = 'other-member'; window.__fake.name = 'Other Member'; });
  await b.page.waitForSelector('.ops-tile');
  const names = await tileNames(b.page);
  assert.ok(names.includes('Alpha Tool'), 'the member still sees the public tools');
  assert.ok(!names.includes('Owner Tool'));
  await b.page.fill('input[placeholder="Search tools"]', 'owner');
  await b.page.waitForTimeout(200);
  assert.ok(!(await tileNames(b.page)).includes('Owner Tool'), 'search cannot surface it either');
  await b.ctx.close();
});
