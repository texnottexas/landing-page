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
const OWN = ['ops-center.js', 'ops-kit.js', 'ops-core.js', 'ops-drag.js'];
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

const WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
async function open(viewport, before, o) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  // the worker is never reached from a test: usage reports are recorded here (or refused, to show they can fail)
  const usage = [];
  await ctx.route(WORKER + '/**', (rt) => {
    const r = rt.request();
    usage.push({ url: r.url(), method: r.method(), type: r.headers()['content-type'], body: r.postData() });
    if (o && o.workerDown) return rt.abort();
    rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
  });
  if (o && o.dragMissing) await ctx.route('**/ops-drag.js*', (rt) => rt.fulfill({ status: 404, body: '' }));
  if (o && (o.dragFirst || o.events || o.tucked || o.alongside)) await ctx.route('**/ops-tools.json*', async (rt) => {
    const r = await rt.fetch(); const j = await r.json();
    j.tools.forEach((t) => {
      if (o.dragFirst && t.id === 'alpha') t.scripts.unshift('ops-drag.js');   // a tool that lists the drag helper first
      if (o.events && o.events[t.id]) t.event = o.events[t.id];                 // a tool tied to an event
      if (o.tucked && o.tucked.includes(t.id)) t.tucked = true;                 // a tool that always sits under "Not running now"
    });
    if (o.alongside && !j.tools.some((x) => x.id === 'rickroll')) j.tools.push({ id: 'rickroll', title: 'Rickroll', icon: 'disco', gate: 'member', ready: ['game'], scripts: ['fake-rickroll.js'], version: '1', overlay: '#rr-root', alongside: true, desc: 'A song.', keywords: 'song music' });
    rt.fulfill({ response: r, body: JSON.stringify(j) });
  });
  await page.goto(base);
  if (before) await page.evaluate(before);
  await page.addScriptTag({ url: base + 'ops-center.js' });          // what the bookmarklet does
  await page.waitForSelector('.ops-card');
  return { ctx, page, usage };
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

const RESTRICTED = 'this tool has been restricted to fellow server members of the developer';
async function assertRestricted(page) {
  await page.waitForSelector('.ops-note:has-text("' + RESTRICTED + '")');
  assert.equal(await page.$('.ops-tile'), null);
  const text = await page.$eval('.ops-note', (e) => e.textContent);
  assert.match(text, /^Due to an influx of demand, this tool has been restricted to fellow server members of the developer \(Server 2864\)\. You can apply to transfer at discord\.gg\/go-2864 or at 2864tw\.com\/transfer\.$/);
  assert.ok(!/\u2014/.test(text), 'no em dash');
  const links = await page.$$eval('.ops-note a', (a) => a.map((x) => [x.textContent, x.href, x.target, x.rel]));
  assert.deepEqual(links, [['discord.gg/go-2864', 'https://discord.gg/go-2864', '_blank', 'noopener noreferrer'],
    ['2864tw.com/transfer', 'https://2864tw.com/transfer.html', '_blank', 'noopener noreferrer']]);
}

test('not an S2864 member: no tiles, the restriction message with the transfer links', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; });
  await assertRestricted(page);
  await ctx.close();
});

test('on the member list but home server is not 2864: refused the same way', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.server = 619; });
  await assertRestricted(page);
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
  assert.equal(await page.$('.ops-note:has-text("' + RESTRICTED + '")'), null);
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

// Tool usage (Tex, 2026-10-08): each launch tells the worker who opened which tool: siteKey, in-game name, tool id
// and version. Plain text, so no preflight. Never the UID, and a failed report never stops the tool.
test('launching a tool reports one open: siteKey, name, tool and version, no UID', async () => {
  const { ctx, page, usage } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  assert.equal(usage.length, 0, 'opening the menu or a tool page reports nothing');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  for (let i = 0; i < 20 && !usage.length; i++) await page.waitForTimeout(100);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].url, WORKER + '/ops/usage');
  assert.equal(usage[0].method, 'POST');
  assert.match(usage[0].type, /^text\/plain/);
  assert.deepEqual(JSON.parse(usage[0].body), { siteKey: '03c2cd3196b2f243', name: 'Tester', tool: 'alpha', version: '1', open: true });
  assert.ok(!usage[0].body.includes('1000000000001'), 'no UID');
  await ctx.close();
});

test('a usage report that fails changes nothing: the tool still opens and closes back to the menu', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { workerDown: true });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await page.click('#fake-alpha-close');
  await page.waitForSelector('.ops-card', { timeout: 3000 });
  assert.equal(usage.length, 1, 'tried once, no retry');
  await ctx.close();
});

async function dragBy(page, sel, dx, dy) {
  const b = await page.locator(sel).first().boundingBox();
  const x = b.x + 15, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
}
const cardAt = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; }, sel);

test('OPS-DRAG-1: the Ops Center menu drags by its title and opens there next time', async () => {
  const { ctx, page } = await open(DESKTOP);
  await page.waitForSelector('.ops-card .ops-title');
  const a = await cardAt(page, '.ops-card');
  await dragBy(page, '.ops-card .ops-title', -100, 0);
  const b = await cardAt(page, '.ops-card');
  assert.deepEqual(b, { x: a.x - 100, y: a.y });
  await page.click('.ops-card .ops-head [aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('.ops-card'));
  await page.addScriptTag({ url: base + 'ops-center.js' });
  await page.waitForSelector('.ops-card .ops-title');
  assert.deepEqual(await cardAt(page, '.ops-card'), b);
  await ctx.close();
});

test('OPS-DRAG-2: with the drag helper missing (404) the Ops Center still opens, and a tool that lists it still launches', async () => {
  const { ctx, page } = await open(PHONE, null, { dragMissing: true, dragFirst: true });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await ctx.close();
});

// Event tiles (Tex, 2026-10-14): a tool whose event isn't running is tucked into a folded "Not running now" row.
const live = (type) => { const s = Math.floor(Date.now() / 1000); return { type, begintime: s - 60, endtime: s + 3600 }; };
const mainNames = (page) => page.$$eval('.ops-grid:not(.ops-tucked) .ops-tname', (els) => els.map((e) => e.textContent));
const tuckedNames = (page) => page.$$eval('.ops-tucked .ops-tname', (els) => els.map((e) => e.textContent));

test('OPS-EV-1: an event tool whose event is not running is tucked into "Not running now"; a tap shows it, dimmed, "Not running"', async () => {
  const { ctx, page } = await open(PHONE, () => { __fake.activities = [{ type: 292, begintime: 0, endtime: 1 }]; }, { events: { alpha: [279], epsilon: [292] } });
  await page.waitForSelector('.ops-tile');
  assert.ok(!(await mainNames(page)).includes('Alpha Tool'), 'tucked');
  assert.ok(!(await mainNames(page)).includes('Epsilon Tool'), 'an ended event is not running');
  assert.ok((await mainNames(page)).includes('Beta Tool'), 'tools without an event stay');
  assert.equal(await page.textContent('.ops-tuck'), 'Not running now (2)');
  assert.equal(await page.getAttribute('.ops-tuck', 'aria-expanded'), 'false');
  assert.deepEqual(await tuckedNames(page), []);
  await page.click('.ops-tuck');
  assert.deepEqual((await tuckedNames(page)).sort(), ['Alpha Tool', 'Epsilon Tool']);
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Not running']);
  assert.equal(await page.$eval('.ops-tucked .ops-tile', (e) => e.classList.contains('dim')), true);
  assert.equal(await page.getAttribute('.ops-tuck', 'aria-expanded'), 'true');
  await ctx.close();
});

test('OPS-EV-2: search finds a tucked tool and shows it in the opened tucked group', async () => {
  const { ctx, page } = await open(PHONE, () => { __fake.activities = []; }, { events: { alpha: [279] } });
  await page.waitForSelector('.ops-tuck');
  await page.fill('.ops-input', 'first');                           // alpha's keyword
  await page.waitForSelector('.ops-tucked .ops-tile');
  assert.deepEqual(await mainNames(page), []);
  assert.deepEqual(await tuckedNames(page), ['Alpha Tool']);
  assert.equal(await page.$$eval('.ops-empty', (e) => e.length), 0, 'not "No tools match"');
  assert.equal(await page.$eval('.ops-tuck', (e) => e.disabled), true, 'the search holds it open: no tap that does nothing');
  await page.fill('.ops-input', '');
  assert.equal(await page.$eval('.ops-tuck', (e) => e.disabled), false, 'tappable again');
  await ctx.close();
});

test('OPS-EV-3: when the event starts, its tile moves back into the menu without reopening it', async () => {
  const { ctx, page } = await open(PHONE, () => { __fake.activities = []; }, { events: { alpha: [279] } });
  await page.waitForSelector('.ops-tuck');
  await page.evaluate((a) => { __fake.activities.push(a); }, live(279));
  await page.waitForFunction(() => [...document.querySelectorAll('.ops-grid:not(.ops-tucked) .ops-tname')].some((e) => e.textContent === 'Alpha Tool'), null, { timeout: 3000 });
  assert.equal(await page.$$eval('.ops-tuck', (e) => e.length), 0, 'no tuck row left');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready']);
  await ctx.close();
});

test('OPS-EV-4: a tucked tool\'s page says the event isn\'t running and still launches ("Launch anyway")', async () => {
  const { ctx, page } = await open(PHONE, () => { __fake.activities = []; }, { events: { alpha: [279] } });
  await page.click('.ops-tuck');
  await clickTile(page, 'Alpha Tool');
  await page.waitForSelector('.ops-check');
  const rows = await page.$$eval('.ops-check', (els) => els.map((e) => e.textContent));
  assert.ok(rows.some((t) => /The event isn't running now/.test(t)), rows.join(' | '));
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch anyway');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');                         // the tool's own screen
  await ctx.close();
});

test('OPS-EV-5: when the game\'s activities can\'t be read, every tool stays in the menu (a broken read never hides a tool)', async () => {
  const { ctx, page } = await open(PHONE, null, { events: { alpha: [279] } });   // no ActivityController in the fake game
  await page.waitForSelector('.ops-tile');
  assert.ok((await mainNames(page)).includes('Alpha Tool'));
  assert.equal(await page.$$eval('.ops-tuck', (e) => e.length), 0);
  await ctx.close();
});

test('OPS-EV-6 (Tex 2026-10-14): a tucked tool always sits under "Not running now", even when the game\'s events can\'t be read, and still launches from there', async () => {
  const { ctx, page } = await open(PHONE, null, { tucked: ['alpha'] });   // no ActivityController in the fake game
  await page.waitForSelector('.ops-tuck');
  assert.ok(!(await mainNames(page)).includes('Alpha Tool'));
  assert.equal(await page.textContent('.ops-tuck'), 'Not running now (1)');
  await page.click('.ops-tuck');
  assert.deepEqual(await tuckedNames(page), ['Alpha Tool']);
  await clickTile(page, 'Alpha Tool');
  await page.waitForSelector('.ops-btn.primary');
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch anyway');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await ctx.close();
});

test('OPS-JAM-1 (Tex 2026-10-14): Rickroll launched from the menu holds nothing: the menu opens again and Alpha launches while it plays; its tile says Playing', async () => {
  const { ctx, page } = await open(PHONE, null, { alongside: true });
  await clickTile(page, 'Rickroll');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#rr-root');
  await page.waitForSelector('.ops-card', { state: 'detached' });
  assert.equal(await page.$$eval('.ops-fab', (e) => e.length), 0, 'no "running" pill');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-card .ops-tile');
  assert.deepEqual(await tileStatus(page, 'Rickroll'), ['Playing']);
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  assert.ok(await page.$('#rr-root'), 'the song plays on');
  await ctx.close();
});

test('OPS-JAM-2 (Tex 2026-10-14): with Alpha open, the note offers Rickroll; it starts alongside, and closing Alpha brings the menu back while the song plays', async () => {
  const { ctx, page } = await open(PHONE, null, { alongside: true });
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("Alpha Tool running")');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Alpha Tool is open")');
  await page.click('.ops-bubble .ops-btn:text-is("Rickroll ♪")');
  await page.waitForSelector('#rr-root');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble .ops-btn:text-is("Rickroll is on")');
  assert.equal(await page.$eval('.ops-bubble .ops-btn:text-is("Rickroll is on")', (b) => b.disabled), true);
  await page.click('#fake-alpha-close');
  await page.waitForSelector('.ops-card .ops-tile', { timeout: 5000 });   // back to the menu: Rickroll's card is not Alpha's
  assert.ok(await page.$('#rr-root'), 'the song plays on');
  await ctx.close();
});
