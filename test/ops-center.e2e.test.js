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
const OWN = ['ops-center.js', 'ops-kit.js', 'ops-core.js', 'ops-drag.js', 'ops-potato.js'];
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
async function open(viewport, before, o, arg) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  // the worker is never reached from a test: usage reports are recorded here (or refused, to show they can fail)
  const usage = [];
  await ctx.route(WORKER + '/**', (rt) => {
    const r = rt.request();
    usage.push({ url: r.url(), method: r.method(), type: r.headers()['content-type'], body: r.postData() });
    if (o && o.workerDown) return rt.abort();
    if (r.url() === WORKER + '/mapcollector/visible' && o && o.visible) {             // the registry check: 'yes', 'no' or 'down'
      if (o.visible === 'down') return rt.abort();
      return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, show: o.visible === 'yes' }) });
    }
    rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
  });
  if (o && o.dragMissing) await ctx.route('**/ops-drag.js*', (rt) => rt.fulfill({ status: 404, body: '' }));
  // accounts Tex revoked: a test can add a siteKey to the block list the way ops-core.js holds it
  if (o && o.blocked) await ctx.route('**/ops-core.js*', async (rt) => {
    const r = await rt.fetch();
    rt.fulfill({ response: r, body: (await r.text()) + '\n' + o.blocked.map((k) => 'OpsCore.BLOCKED[' + JSON.stringify(k) + '] = OpsCore.REVOKED_MSG;').join('\n') });
  });
  if (o && o.potatoMissing) await ctx.route('**/ops-potato.js*', (rt) => rt.fulfill({ status: 404, body: '' }));
  if (o && (o.dragFirst || o.jamFirst || o.events || o.tucked || o.alongside || o.registered || o.group || o.beta)) await ctx.route('**/ops-tools.json*', async (rt) => {
    const r = await rt.fetch(); const j = await r.json();
    j.tools.forEach((t) => {
      if (o.dragFirst && t.id === 'alpha') t.scripts.unshift('ops-drag.js');   // a tool that lists the drag helper first
      if (o.jamFirst && t.id === 'alpha') t.scripts.unshift('ops-jam.js');     // and the Jam helper (not served here: 404)
      if (o.events && o.events[t.id]) t.event = o.events[t.id];                 // a tool tied to an event
      if (o.tucked && o.tucked.includes(t.id)) t.tucked = true;                 // a tool that always sits under "Not running now"
      if (o.registered && o.registered.includes(t.id)) t.registered = 'mapcollector';   // shown only to players in the Map Collector registry
      if (o.beta && o.beta.includes(t.id)) t.beta = true;                         // a tool a few players are trying out
    });
    if (o.group) j.tools.push(
      { id: 'grpa', title: 'Group A', icon: 'gift', gate: 'member', ready: ['game'], scripts: ['fake-group-a.js'], version: '1', overlay: '#fake-ga', together: true, desc: 'Runs with B.', keywords: '' },
      { id: 'grpb', title: 'Group B', icon: 'gem', gate: 'member', ready: ['game'], scripts: ['fake-group-b.js'], version: '1', overlay: '#fake-gb', together: true, desc: 'Runs with A.', keywords: '' });
    if (o.alongside && !j.tools.some((x) => x.id === 'rickroll')) j.tools.push({ id: 'rickroll', title: 'Rickroll', icon: 'disco', gate: 'member', ready: ['game'], scripts: ['fake-rickroll.js'], version: '1', overlay: '#rr-root', alongside: true, desc: 'A song.', keywords: 'song music' });
    rt.fulfill({ response: r, body: JSON.stringify(j) });
  });
  await page.goto(base);
  if (before) await page.evaluate(before, arg);
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

test('home server unknown and not on the roster: no tiles, the restriction message with the transfer links', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; window.__fake.server = 0; });
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

test('OPS-BETA (Tex 2026-10-17): a beta tool says so on its tile, beside New, and on its page', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_seen_v1', JSON.stringify({ alpha: '1', beta: '1', gamma: '1' })); }, { beta: ['alpha', 'delta'] });
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready', 'Beta']);
  assert.deepEqual(await tileStatus(page, 'Delta Tool'), ['Ready', 'Beta', 'New']);
  assert.ok(!(await tileStatus(page, 'Beta Tool')).includes('Beta'), 'no tag on the others (the one named Beta Tool included)');
  assert.match(await page.$eval('.ops-tile:has(.ops-tname:text-is("Alpha Tool"))', (e) => e.getAttribute('aria-label')), /Beta/);
  await clickTile(page, 'Alpha Tool');
  await page.waitForSelector('.ops-meta');
  assert.match(await page.$eval('.ops-card', (e) => e.textContent), /Beta: still being tried out\./);
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

test('home server unknown and the member list fails to load: a plain message with Retry, no tiles', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/nomember/'; window.__fake.server = 0; });
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

test('home server unknown and a member list that is not a list: Retry instead of saying you are not a member', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__OPS_BASE = location.origin + '/badroster/'; window.__fake.server = 0; });
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

test('OPS-EV-LQ (Tex 2026-10-16): a Loot Quest tool is tucked between Loot Quest windows and comes back when one opens', async () => {
  const { ctx, page } = await open(PHONE, () => {
    const now = Date.now();
    __fake.activities = [];
    __fake.cshunt = { open: 1, timeInfo: { openTime: [{ beginMill: String(now - 7200000), endMill: String(now - 3600000) }, { beginMill: String(now + 3600000), endMill: String(now + 7200000) }] } };
  }, { events: { alpha: ['lootquest'] } });
  await page.waitForSelector('.ops-tuck');
  assert.ok(!(await mainNames(page)).includes('Alpha Tool'), 'between windows: tucked');
  await page.evaluate(() => { const now = Date.now(); __fake.cshunt.timeInfo.openTime.push({ beginMill: String(now - 1000), endMill: String(now + 7200000) }); });
  await page.waitForFunction(() => [...document.querySelectorAll('.ops-grid:not(.ops-tucked) .ops-tname')].some((e) => e.textContent === 'Alpha Tool'), null, { timeout: 3000 });
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

test('OPS-JAM-2 (Tex 2026-10-14): with Alpha open, the note offers Jam Mode (Rickroll); it starts alongside, and closing Alpha brings the menu back while the song plays', async () => {
  const { ctx, page } = await open(PHONE, null, { alongside: true });
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('.ops-fab:has-text("Alpha Tool running")');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Alpha Tool is open")');
  await page.click('.ops-bubble .ops-btn:text-is("Jam Mode ♪")');
  await page.waitForSelector('#rr-root');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble .ops-btn:text-is("Jam Mode is on")');
  assert.equal(await page.$eval('.ops-bubble .ops-btn:text-is("Jam Mode is on")', (b) => b.disabled), true);
  await page.click('#fake-alpha-close');
  await page.waitForSelector('.ops-card .ops-tile', { timeout: 5000 });   // back to the menu: Rickroll's card is not Alpha's
  assert.ok(await page.$('#rr-root'), 'the song plays on');
  await ctx.close();
});

test('OPS-JAM-3 (review): with the Jam helper missing (404), a tool that lists it still launches', async () => {
  const { ctx, page } = await open(PHONE, null, { jamFirst: true });
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#fake-alpha');
  await ctx.close();
});

test('OPS-JAM-4 (Tex 2026-10-14): opening the Rickroll tile again while it plays only brings its card forward; it is not counted as a second start', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { alongside: true });
  await clickTile(page, 'Rickroll');
  await page.click('.ops-btn.primary');
  await page.waitForSelector('#rr-root');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-card .ops-tile');
  await clickTile(page, 'Rickroll');
  await page.click('.ops-btn.primary');
  await page.waitForFunction(() => window.__rrFlashes === 1);
  await page.waitForTimeout(300);
  const opens = usage.filter((u) => /\/ops\/usage$/.test(u.url) && JSON.parse(u.body).tool === 'rickroll');
  assert.equal(opens.length, 1, 'the first start only');
  await ctx.close();
});

// Tex 2026-10-14: the Map Collector tile shows only to players in its registry. The Ops Center asks the worker once per
// launch (siteKey only, plain text), shows the tile on a yes, and the device remembers a yes for that siteKey.
const SK = '03c2cd3196b2f243';
const visibleAsks = (usage) => usage.filter((u) => u.url === WORKER + '/mapcollector/visible');
async function relaunch(page) {                                       // a fresh game page in the same browser, then the bookmarklet
  await page.reload();
  await page.addScriptTag({ url: base + 'ops-center.js' });
  await page.waitForSelector('.ops-tile');
}

test('OPS-REG-1: the worker says no: the tile is hidden, search cannot find it, and the check sent only the siteKey', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { registered: ['delta'], visible: 'no' });
  await page.waitForSelector('.ops-tile');
  for (let i = 0; i < 20 && !visibleAsks(usage).length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  assert.deepEqual(await tileNames(page), ['Alpha Tool', 'Beta Tool', 'Gamma Tool', 'Epsilon Tool', 'Zeta Tool', 'Owner Tool']);
  await page.fill('.ops-input', 'delta');
  assert.match(await page.textContent('.ops-empty'), /No tools match "delta"/);
  const asks = visibleAsks(usage);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].method, 'POST');
  assert.match(asks[0].type, /^text\/plain/);
  assert.deepEqual(JSON.parse(asks[0].body), { siteKey: SK });
  assert.ok(!asks[0].body.includes('1000000000001'), 'no UID');
  await ctx.close();
});

test('OPS-REG-2: the worker says yes: the tile appears without reopening; the device remembers it, so it shows at once with the worker down', async () => {
  const o = { registered: ['delta'], visible: 'yes' };
  const { ctx, page, usage } = await open(PHONE, null, o);
  await page.waitForSelector('.ops-tile:has(.ops-tname:text-is("Delta Tool"))', { timeout: 3000 });
  assert.deepEqual(await tileNames(page), ['Alpha Tool', 'Beta Tool', 'Gamma Tool', 'Delta Tool', 'Epsilon Tool', 'Zeta Tool', 'Owner Tool']);
  await page.click('.ops-card .ops-head [aria-label="Close"]');      // close and open again: no second check this launch
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-tile');
  assert.equal(visibleAsks(usage).length, 1, 'one check per launch');
  o.visible = 'down';
  await relaunch(page);
  assert.ok((await tileNames(page)).includes('Delta Tool'), 'remembered yes');
  await ctx.close();
});

test('OPS-REG-3: the worker is down and nothing is remembered (or only another player\'s yes): hidden', async () => {
  const other = () => localStorage.setItem('ops_reg_v1', JSON.stringify({ sk: 'ffffffffffffffff', at: Date.now(), yes: { mapcollector: true } }));
  const { ctx, page, usage } = await open(PHONE, other, { registered: ['delta'], visible: 'down' });
  await page.waitForSelector('.ops-tile');
  for (let i = 0; i < 20 && !visibleAsks(usage).length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  assert.equal(visibleAsks(usage).length, 1);
  assert.ok(!(await tileNames(page)).includes('Delta Tool'));
  await ctx.close();
});

test('OPS-REG-4: a remembered yes shows the tile at once, and a later no takes it away and forgets it', async () => {
  const mine = () => localStorage.setItem('ops_reg_v1', JSON.stringify({ sk: '03c2cd3196b2f243', at: Date.now(), yes: { mapcollector: true } }));
  const { ctx, page, usage } = await open(PHONE, mine, { registered: ['delta'], visible: 'no' });
  await page.waitForSelector('.ops-tile');
  for (let i = 0; i < 20 && !visibleAsks(usage).length; i++) await page.waitForTimeout(100);
  await page.waitForSelector('.ops-tile:has(.ops-tname:text-is("Delta Tool"))', { state: 'detached', timeout: 3000 });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('ops_reg_v1')));
  assert.ok(!kept || !kept.yes || kept.yes.mapcollector !== true, 'the yes is forgotten');
  await ctx.close();
});

test('OPS-REG-5: a remembered yes older than a week no longer counts', async () => {
  const stale = () => localStorage.setItem('ops_reg_v1', JSON.stringify({ sk: '03c2cd3196b2f243', at: Date.now() - 8 * 24 * 3600 * 1000, yes: { mapcollector: true } }));
  const { ctx, page, usage } = await open(PHONE, stale, { registered: ['delta'], visible: 'down' });
  await page.waitForSelector('.ops-tile');
  for (let i = 0; i < 20 && !visibleAsks(usage).length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  assert.ok(!(await tileNames(page)).includes('Delta Tool'));
  await ctx.close();
});

test('OPS-REG-6: with no registry tool in the list, the Ops Center never asks', async () => {
  const { ctx, page, usage } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await page.waitForTimeout(800);
  assert.equal(visibleAsks(usage).length, 0);
  await ctx.close();
});

// Tex 2026-10-15: players the Ops Center turns away are logged once per launch with their name and home server
// (tool 'outsider' from another server, 'not-on-roster' on 2864; siteKey from the UID, never the UID). Players from
// another server also get Rickroll, started the way Jam starts it, while the restricted message stays up.
const usageReports = (usage) => usage.filter((u) => u.url === WORKER + '/ops/usage').map((u) => JSON.parse(u.body));
const rrCount = (page) => page.$$eval('#rr-root', (els) => els.length);
async function waitReports(page, usage, n) { for (let i = 0; i < 30 && usageReports(usage).length < n; i++) await page.waitForTimeout(100); }

test('OPS-OUT-1: from another server: the message stays, Rickroll starts at its list version, and the visit is logged with name and server', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.server = 619; }, { alongside: true });
  await assertRestricted(page);
  await page.waitForSelector('#rr-root', { timeout: 3000 });
  assert.equal(await rrCount(page), 1);
  assert.match(await page.evaluate(() => window.__rrSrc), /fake-rickroll\.js\?v=1$/);
  assert.equal(await page.$$eval('.ops-note', (n) => n.filter((e) => e.textContent.includes('influx')).length), 1, 'the message is still up');
  await waitReports(page, usage, 1);
  assert.deepEqual(usageReports(usage), [{ siteKey: '03c2cd3196b2f243', name: 'Tester', tool: 'outsider', version: '1', open: true, server: 619 }]);
  assert.ok(usage.every((u) => !String(u.body || '').includes('1000000000001')), 'no UID');
  await ctx.close();
});

test('OPS-OUT-2 (Tex 2026-10-16): on 2864 but not on the roster: the menu, no Rickroll, no visitor log', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; window.__fake.name = 'New Guy'; }, { alongside: true });
  await page.waitForSelector('.ops-tile');
  assert.equal(await page.textContent('.ops-sub'), 'New Guy · S2864 ✓');
  assert.equal(await page.$$eval('.ops-note', (n) => n.filter((e) => e.textContent.includes('influx')).length), 0, 'no transfer message');
  await page.waitForTimeout(500);
  assert.equal(await rrCount(page), 0);
  assert.equal(usageReports(usage).length, 0);
  await ctx.close();
});

test('OPS-OUT-3: opening the menu again while it plays loads nothing new; after Stop it starts again; the visit is logged once per launch', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.server = 619; }, { alongside: true });
  await page.waitForSelector('#rr-root', { timeout: 3000 });
  await page.evaluate(() => window.OpsCenter.toggle());                // close
  await page.evaluate(() => window.OpsCenter.toggle());                // open again
  await page.waitForSelector('.ops-note:has-text("' + RESTRICTED + '")');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__rrLoads), 1, 'still playing: not loaded again');
  // the message sits above Rickroll (the Ops Center is the top layer); once it is closed, Rickroll's Stop answers
  await page.evaluate(() => window.OpsCenter.toggle());                // close the message
  await page.click('#rr-stop');
  await page.evaluate(() => window.OpsCenter.toggle());                // open again: it starts again
  await page.waitForSelector('#rr-root', { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.__rrLoads), 2);
  await page.waitForTimeout(300);
  assert.equal(usageReports(usage).length, 1, 'one log per launch');
  await ctx.close();
});

test('OPS-OUT-4: a member gets neither Rickroll nor a visitor log', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { alongside: true });
  await page.waitForSelector('.ops-tile');
  await page.waitForTimeout(800);
  assert.equal(await rrCount(page), 0);
  assert.equal(usageReports(usage).length, 0);
  await ctx.close();
});

test('OPS-OUT-5: no Rickroll in the tool list: the message and the log, nothing else', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.server = 619; });
  await assertRestricted(page);
  await waitReports(page, usage, 1);
  await page.waitForTimeout(400);
  assert.equal(await rrCount(page), 0);
  assert.equal(usageReports(usage)[0].tool, 'outsider');
  await ctx.close();
});

test('OPS-OUT-6: home server unknown and not on the roster: logged without a server', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.uid = '1000000000002'; window.__fake.server = 0; }, { alongside: true });
  await assertRestricted(page);
  await waitReports(page, usage, 1);
  assert.deepEqual(usageReports(usage), [{ siteKey: '2f9bc8619956f5da', name: 'Tester', tool: 'not-on-roster', version: '1', open: true }]);
  assert.equal(await rrCount(page), 0);
  await ctx.close();
});

// Tex 2026-10-17: accounts whose access Tex revoked get his message instead of the menu. The block is checked before
// anything else (a cached membership, the roster, the home server), starts no Rickroll, and each launch is logged as
// tool 'blocked' with the home server (siteKey from the UID, never the UID).
const REVOKED = 'Shared connection detected attempting multiple non-2864 accounts in 24H period, access has been revoked, please contact Tatie for access to be restored';
async function assertBlocked(page) {
  await page.waitForSelector('.ops-note:has-text("access has been revoked")');
  assert.equal(await page.$$eval('.ops-tile', (e) => e.length), 0);
  assert.deepEqual(await page.$$eval('.ops-note', (n) => n.filter((e) => e.textContent.includes('revoked')).map((e) => e.textContent)), [REVOKED]);
  assert.equal(await page.$$eval('.ops-note', (n) => n.filter((e) => e.textContent.includes('influx')).length), 0, 'no transfer message');
  assert.ok(!(await page.$$eval('.ops-sub', (e) => e.map((x) => x.textContent).join(''))).includes('S2864'), 'not shown as a member');
}

test('OPS-BLOCK-1: a revoked 2864 roster member, even with a remembered membership: the message, no tiles, no Rickroll, one blocked log per launch', async () => {
  const { ctx, page, usage } = await open(PHONE, () => {
    localStorage.setItem('ops_member_v1', JSON.stringify({ sk: '03c2cd3196b2f243', at: Date.now(), row: { name: 'Tester', rank: 5 } }));
  }, { alongside: true, blocked: [SK] });
  await assertBlocked(page);
  await waitReports(page, usage, 1);
  await page.waitForTimeout(400);
  assert.equal(await rrCount(page), 0);
  assert.deepEqual(usageReports(usage), [{ siteKey: SK, name: 'Tester', tool: 'blocked', version: '1', open: true, server: 2864 }]);
  assert.ok(usage.every((u) => !String(u.body || '').includes('1000000000001')), 'no UID');
  await page.evaluate(() => window.OpsCenter.toggle());                // close
  await page.evaluate(() => window.OpsCenter.toggle());                // open again: still blocked
  await assertBlocked(page);
  await page.waitForTimeout(300);
  assert.equal(usageReports(usage).length, 1, 'one log per launch');
  await ctx.close();
});

test('OPS-BLOCK-2: a revoked account on another server: the revoked message instead of the transfer message, and no Rickroll', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.server = 619; }, { alongside: true, blocked: [SK] });
  await assertBlocked(page);
  await waitReports(page, usage, 1);
  await page.waitForTimeout(400);
  assert.equal(await rrCount(page), 0);
  assert.deepEqual(usageReports(usage), [{ siteKey: SK, name: 'Tester', tool: 'blocked', version: '1', open: true, server: 619 }]);
  await ctx.close();
});

test('OPS-BLOCK-3: a revoked account whose home server is unknown: the message, logged without a server', async () => {
  const { ctx, page, usage } = await open(PHONE, () => { window.__fake.server = 0; }, { blocked: [SK] });
  await assertBlocked(page);
  await waitReports(page, usage, 1);
  assert.deepEqual(usageReports(usage), [{ siteKey: SK, name: 'Tester', tool: 'blocked', version: '1', open: true }]);
  await ctx.close();
});

test('OPS-BLOCK-4: someone else on the block list changes nothing for a member', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { blocked: ['ffffffffffffffff'] });
  await page.waitForSelector('.ops-tile');
  assert.equal(await page.textContent('.ops-sub'), 'Tester · S2864 ✓');
  await page.waitForTimeout(400);
  assert.equal(usageReports(usage).length, 0);
  await ctx.close();
});

// Tex 2026-10-16: on 2864 the home server decides membership; the roster only adds name and rank. A player who isn't on
// the roster takes their alliance rank from the game, and a roster that can't be read never turns a 2864 player away.
test('OPS-SRV-1: on 2864, not on the roster: the game\'s alliance rank decides R4 readiness', async () => {
  for (const [rank, text] of [[4, 'You are R4 or leader'], [3, 'You need to be R4 or leader in your alliance']]) {
    const { ctx, page } = await open(PHONE, (r) => { window.__fake.uid = '1000000000002'; window.__fake.allianceRank = r; }, null, rank);
    await page.waitForSelector('.ops-tile');
    await clickTile(page, 'Gamma Tool');
    await page.waitForFunction((t) => document.querySelector('.ops-box').textContent.includes(t), text, { timeout: 4000 });
    await ctx.close();
  }
});

test('OPS-SRV-2: on 2864 with the member list down (or not a list): the menu anyway, named from the game', async () => {
  for (const mode of ['nomember', 'badroster']) {
    const { ctx, page } = await open(PHONE, (m) => { window.__OPS_BASE = location.origin + '/' + m + '/'; }, null, mode);
    await page.waitForSelector('.ops-tile');
    assert.equal(await page.textContent('.ops-sub'), 'Tester · S2864 ✓');
    assert.equal(await page.$$eval('.ops-toast', (e) => e.length), 0, 'no Retry');
    await ctx.close();
  }
});

test('OPS-SRV-3: a roster member keeps the roster\'s rank (the game\'s rank does not replace it)', async () => {
  const { ctx, page } = await open(PHONE, () => { window.__fake.allianceRank = 1; });   // Tester is rank 5 on the fake roster
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Gamma Tool');
  await page.waitForFunction(() => document.querySelector('.ops-box').textContent.includes('You are R4 or leader'), null, { timeout: 4000 });
  await ctx.close();
});

// Tex 2026-10-16: tools marked together run at the same time, started from the Ops Center.
async function launchTile(page, name) { await clickTile(page, name); await page.click('.ops-btn.primary'); }
const count = (page, sel) => page.$$eval(sel, (e) => e.length);

test('OPS-GRP-1: with a group tool open, a tap opens the menu; the other group tool launches beside it', async () => {
  const { ctx, page, usage } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A');
  await page.waitForSelector('#fake-ga');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-tile');                            // the menu, not the note
  assert.equal(await count(page, '.ops-bubble'), 0);
  assert.deepEqual(await tileStatus(page, 'Group A'), ['Running']);
  assert.deepEqual(await tileStatus(page, 'Group B'), ['Ready']);
  await launchTile(page, 'Group B');
  await page.waitForSelector('#fake-gb');
  assert.equal(await count(page, '#fake-ga'), 1, 'A still up');
  assert.equal(await count(page, '.ops-card'), 0, 'the menu closed');
  await page.waitForTimeout(300);
  assert.deepEqual(usageReports(usage).map((r) => r.tool), ['grpa', 'grpb']);
  await ctx.close();
});

test('OPS-GRP-2: a tool outside the group says Wait; its page names the running tools and Launch is off', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A');
  await page.waitForSelector('#fake-ga');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Wait']);
  await clickTile(page, 'Alpha Tool');
  await page.waitForSelector('.ops-note:has-text("Close the tools that are running first: Group A.")');
  assert.ok(await page.isDisabled('.ops-btn.primary'));
  assert.equal(await page.textContent('.ops-btn.primary'), 'Launch');
  await ctx.close();
});

test('OPS-GRP-3: closing the first group card keeps the session; the pill names what still runs; closing the last brings the menu back', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A'); await page.waitForSelector('#fake-ga');
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group B'); await page.waitForSelector('#fake-gb');
  await page.waitForFunction(() => /2 tools running/.test((document.querySelector('.ops-fab') || {}).textContent || ''));
  await page.click('#fake-ga-close');
  await page.waitForFunction(() => /Group B running/.test((document.querySelector('.ops-fab') || {}).textContent || ''));
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Group B'), ['Running']);
  await page.evaluate(() => window.OpsCenter.toggle());              // close the menu
  await page.click('#fake-gb-close');
  await page.waitForSelector('.ops-tile', { timeout: 4000 });         // the session ended: the menu comes back
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Ready']);
  await ctx.close();
});

test('OPS-GRP-4: a tool outside the group still runs alone: the note, as before', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Alpha Tool'); await page.waitForSelector('#fake-alpha');
  await page.evaluate(() => window.OpsCenter.toggle());
  await page.waitForSelector('.ops-bubble:has-text("Alpha Tool is open")');
  assert.equal(await count(page, '.ops-tile'), 0);
  await ctx.close();
});

test('OPS-GRP-5: tapping a Running tile closes the menu and loads nothing again', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A'); await page.waitForSelector('#fake-ga');
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Group A');
  await page.waitForFunction(() => !document.querySelector('.ops-card'));
  assert.equal(await page.evaluate(() => window.__gaRuns), 1);
  await ctx.close();
});

test('OPS-GRP-6 (review): in a group session the Ops pill still offers Hide this button, and Open menu opens the menu', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A'); await page.waitForSelector('#fake-ga');
  await page.waitForSelector('.ops-fab');
  await page.click('.ops-fab');
  await page.waitForSelector('.ops-bubble:has-text("Hide this button")');
  await page.click('.ops-bubble .ops-btn:text-is("Open menu")');
  await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Group A'), ['Running']);
  await page.evaluate(() => window.OpsCenter.toggle());              // close the menu
  await page.click('.ops-fab');
  await page.click('.ops-bubble .ops-btn:text-is("Hide this button")');
  await page.waitForFunction(() => !document.querySelector('.ops-fab'));
  await ctx.close();
});

// Review minors (2026-10-16).
const FAB = (page) => page.evaluate(() => (document.querySelector('.ops-fab') || {}).textContent || '');
test('OPS-GRP-7 (minor): closing the first card while a tool launched beside it is still loading keeps the session; its card takes over', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  let release; const held = new Promise((r) => { release = r; });
  await ctx.route('**/fake-group-b.js*', async (rt) => { await held; rt.continue(); });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A'); await page.waitForSelector('#fake-ga');
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group B');                                 // its script is held
  await page.click('#fake-ga-close');
  await page.waitForTimeout(2000);                                   // past the 1 s grace
  assert.equal(await count(page, '.ops-tile'), 0, 'the session did not end under the loading tool');
  release();
  await page.waitForSelector('#fake-gb');
  await page.waitForFunction(() => /Group B running/.test((document.querySelector('.ops-fab') || {}).textContent || ''), null, { timeout: 4000 });
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Alpha Tool'), ['Wait'], 'still a group session');
  await ctx.close();
});

test('OPS-GRP-8 (minor): the first group tool failing to load leaves the one launched beside it running, and says so', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  let release; const held = new Promise((r) => { release = r; });
  await ctx.route('**/fake-group-a.js*', async (rt) => { await held; rt.fulfill({ status: 404, body: '' }); });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A');                                 // loading, held
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group B'); await page.waitForSelector('#fake-gb');
  release();
  await page.waitForSelector('.ops-bubble:has-text("Couldn\'t load Group A")', { timeout: 4000 });
  await page.waitForTimeout(1500);
  assert.equal(await count(page, '.ops-tile'), 0, 'no menu: Group B still runs');
  assert.match(await FAB(page), /Group B running/);
  await ctx.close();
});

test('OPS-GRP-9 (minor): a group tool that stopped and shows why says Stopped on its tile and in the pill, until its card closes', async () => {
  const { ctx, page } = await open(PHONE, null, { group: true });
  await page.waitForSelector('.ops-tile');
  await launchTile(page, 'Group A'); await page.waitForSelector('#fake-ga');
  await page.evaluate(() => document.getElementById('fake-ga').setAttribute('data-ops-stopped', '1'));
  await page.waitForFunction(() => /Group A stopped/.test((document.querySelector('.ops-fab') || {}).textContent || ''), null, { timeout: 3000 });
  await page.evaluate(() => window.OpsCenter.toggle()); await page.waitForSelector('.ops-tile');
  assert.deepEqual(await tileStatus(page, 'Group A'), ['Stopped']);
  await ctx.close();
});

// Potato mode (Tex 2026-10-17): a switch in the menu, remembered on the device, for phones that run hot or lose the tab.
const fake = (page) => page.evaluate(() => ({ fps: __fake.fps, retina: __fake.retina, cams: __fake.cams.map((c) => c.enabled), low: localStorage.getItem('topwar_LOW_EFFECT_MODE'), on: localStorage.getItem('ops_potato_v1') }));
test('POT-1: Potato mode is off by default; switched on it caps the frame rate at 29 (even when the game asks for more), draws at 1x, saves low quality and asks for a reload', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('#opsp-switch');
  assert.equal(await page.getAttribute('#opsp-switch', 'aria-checked'), 'false');
  assert.equal(await page.textContent('.opsp-mini-label'), 'Potato Mode (phone less hot)', 'Tex 2026-10-17: the label, first in the menu (players may not scroll)');
  assert.deepEqual(await fake(page), { fps: 30, retina: true, cams: [true, true, true], low: null, on: null }, 'nothing changes while it is off');
  await page.click('#opsp-switch');
  assert.equal(await page.getAttribute('#opsp-switch', 'aria-checked'), 'true');
  assert.deepEqual(await fake(page), { fps: 29, retina: false, cams: [true, true, true], low: '1', on: '1' });
  assert.ok(await page.evaluate(() => __fake.resizes) >= 1, 'the canvas is resized to 1x');
  await page.evaluate(() => cc.game.setFrameRate(60));               // the game opening chat
  assert.equal(await page.evaluate(() => __fake.fps), 29, 'held at 29');
  assert.match(await page.textContent('.opsp-note'), /Reload the game to finish/);
  assert.equal(await page.$$eval('#opsp-reload', (e) => e.length), 1);
  assert.ok(!/\u2014/.test(await page.textContent('.opsp-note') + await page.textContent('.opsp-mini')), 'no em dash');
  await ctx.close();
});

test('POT-2: on a phone held upright, a full-screen window (chat) stops drawing the base behind it; closing it brings the base back; small pop-ups never do', async () => {
  const { ctx, page } = await open(PHONE, () => localStorage.setItem('ops_potato_v1', '1'));
  await page.waitForFunction(() => __fake.fps === 29);
  await page.evaluate(() => { __fake.pop = [{ name: 'UIFrameNone', active: true }, { name: 'UIFramePop', active: true }]; });
  await page.waitForTimeout(500);
  assert.deepEqual((await fake(page)).cams, [true, true, true], 'a pop-up: the base stays drawn');
  await page.evaluate(() => { __fake.pop.push({ name: 'UIFrameScreenV1', active: true }); });
  await page.waitForFunction(() => !__fake.cams[0].enabled && !__fake.cams[1].enabled, null, { timeout: 2000 });
  assert.equal((await fake(page)).cams[2], true, 'the menus and chat camera keeps drawing');
  await page.evaluate(() => { __fake.pop = []; });
  await page.waitForFunction(() => __fake.cams.every((c) => c.enabled), null, { timeout: 2000 });
  await ctx.close();
});

test('POT-3: on a wide screen the base is never frozen (it would show black sides)', async () => {
  const { ctx, page } = await open(DESKTOP, () => localStorage.setItem('ops_potato_v1', '1'));
  await page.waitForFunction(() => __fake.fps === 29);
  await page.evaluate(() => { __fake.pop = [{ name: 'UIFrameScreenV1', active: true }]; });
  await page.waitForTimeout(600);
  assert.deepEqual((await fake(page)).cams, [true, true, true]);
  await ctx.close();
});

test('POT-4: remembered: the next Ops Center load applies it at once, before the menu is even used', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_potato_v1', '1'); localStorage.setItem('topwar_LOW_EFFECT_MODE', '1'); __fake.low = true; });
  await page.waitForFunction(() => __fake.fps === 29 && __fake.retina === false, null, { timeout: 3000 });
  await page.waitForSelector('#opsp-switch');
  assert.equal(await page.getAttribute('#opsp-switch', 'aria-checked'), 'true');
  assert.equal(await page.$$eval('.opsp-note', (e) => e.length), 0, 'the game already runs low quality: no reload asked');
  await ctx.close();
});

test('POT-5: off puts everything back: the frame rate the game last asked for, full sharpness, the base, and the player\'s own low-quality setting', async () => {
  const { ctx, page } = await open(PHONE, () => localStorage.setItem('topwar_LOW_EFFECT_MODE', '0'));
  await page.waitForSelector('#opsp-switch');
  await page.click('#opsp-switch');
  await page.evaluate(() => { cc.game.setFrameRate(60); __fake.pop = [{ name: 'UIFrameScreenV1', active: true }]; });
  await page.waitForFunction(() => !__fake.cams[0].enabled, null, { timeout: 2000 });
  await page.click('#opsp-switch');
  assert.deepEqual(await fake(page), { fps: 60, retina: true, cams: [true, true, true], low: '0', on: '0' });
  await page.evaluate(() => cc.game.setFrameRate(30));
  assert.equal(await page.evaluate(() => __fake.fps), 30, 'the game sets its own frame rate again');
  await ctx.close();
});

test('POT-6: if the potato helper can\'t load, the Ops Center works as before, with no switch', async () => {
  const { ctx, page } = await open(PHONE, null, { potatoMissing: true });
  await page.waitForSelector('.ops-tile');
  assert.equal(await page.$$eval('#opsp-switch', (e) => e.length), 0);
  await ctx.close();
});

// Review fixes (2026-10-17): Unattended mode's frame, a paused page game, the reload note on open.
const FRAME = '<script>window.__fg={fps:30,retina:true,low:false,paused:false};window.cc={game:{_prepared:true,setFrameRate:function(n){__fg.fps=n;__fg.paused=false;},getFrameRate:function(){return __fg.fps;},isPaused:function(){return __fg.paused;},pause:function(){__fg.paused=true;}},view:{isRetinaEnabled:function(){return __fg.retina;},enableRetina:function(b){__fg.retina=!!b;},_resizeEvent:function(){},getFrameSize:function(){return{width:390,height:844};}},Camera:{cameras:[]},isValid:function(o){return !!o;},find:function(){return null;}};window.__require=function(n){return n==="GlobalData"?{GLOBAL:{LowQuality:__fg.low}}:null;};<\/script>';
const addFrame = (page) => page.evaluate((src) => new Promise((res) => { const f = document.createElement('iframe'); f.id = 'mapc-frame'; f.onload = () => res(); f.srcdoc = src; document.body.appendChild(f); }), FRAME);
const frameState = (page) => page.evaluate(() => { const w = document.getElementById('mapc-frame').contentWindow; return { fps: w.__fg.fps, retina: w.__fg.retina }; });

test('POT-7 (review): switching Potato mode on or off never wakes a paused page game', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('#opsp-switch');
  await page.evaluate(() => cc.game.pause());
  await page.click('#opsp-switch');
  assert.equal(await page.evaluate(() => __fake.paused), true, 'still paused after on');
  await page.click('#opsp-switch');
  assert.equal(await page.evaluate(() => __fake.paused), true, 'still paused after off');
  await ctx.close();
});

test('POT-8 (review): with Unattended mode\'s frame up, the live game in the frame gets it, the paused page game is left alone, and a frame reload gets it again', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('#opsp-switch');
  await page.evaluate(() => cc.game.pause());                       // Unattended mode pauses the page's game
  await addFrame(page);
  await page.click('#opsp-switch');
  assert.deepEqual(await frameState(page), { fps: 29, retina: false }, 'the frame game');
  assert.deepEqual(await page.evaluate(() => ({ fps: __fake.fps, paused: __fake.paused, retina: __fake.retina })), { fps: 30, paused: true, retina: true }, 'the page game untouched');
  assert.equal(await page.$$eval('#opsp-reload', (e) => e.length), 0, 'no Reload button inside Unattended mode');
  assert.match(await page.textContent('.opsp-note'), /Reload the game to finish/, 'the frame game runs normal quality: a reload is needed');
  await page.evaluate((src) => { document.getElementById('mapc-frame').srcdoc = src + ' '; }, FRAME);   // the dashboard's reconnect reloads the frame
  await page.waitForFunction(() => { const w = document.getElementById('mapc-frame').contentWindow; return w.__fg && w.__fg.fps === 29 && w.__fg.retina === false; }, null, { timeout: 5000 });
  await ctx.close();
});

test('POT-9 (review): the menu says a reload is needed when Potato mode is on but the game started at normal quality', async () => {
  const { ctx, page } = await open(PHONE, () => { localStorage.setItem('ops_potato_v1', '1'); localStorage.setItem('topwar_LOW_EFFECT_MODE', '1'); __fake.low = false; });
  await page.waitForSelector('#opsp-switch');
  assert.match(await page.textContent('.opsp-note'), /Reload the game to finish/);
  assert.equal(await page.$$eval('#opsp-reload', (e) => e.length), 1);
  await ctx.close();
});

test('POT-10 (Tex 2026-10-17): "Potato Mode (phone less hot)" first in the menu, the toggle right below it, visible on a phone without squeezing the header; tapping it never drags or closes the menu', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('#opsp-switch');
  const box = await page.evaluate(() => {
    const sw = document.getElementById('opsp-switch'), lab = document.querySelector('.opsp-mini-label'), mini = document.querySelector('.opsp-mini'), sub = document.querySelector('.ops-sub');
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return { sw: r(sw), lab: r(lab), first: mini.parentNode.classList.contains('ops-body') && mini.parentNode.firstElementChild === mini,
      head: document.querySelector('.ops-head').getBoundingClientRect().bottom, vh: window.innerHeight,
      labLines: lab.getBoundingClientRect().height / (parseFloat(getComputedStyle(lab).lineHeight) || 15), subCut: sub.scrollWidth > sub.clientWidth };
  });
  assert.ok(box.first, 'first in the menu');
  assert.ok(box.lab.t >= box.head - 1, 'under the header');
  assert.ok(box.labLines < 1.6, 'the label on one line');
  assert.ok(box.sw.t >= box.lab.b - 1 && box.sw.t - box.lab.b < 10, 'the toggle right below the label');
  assert.ok(box.sw.l < box.lab.r && box.sw.r > box.lab.l, 'under the label, not beside it');
  assert.ok(box.sw.b <= box.vh, 'visible without scrolling');
  assert.ok(!box.subCut, 'the player line in the header is not cut off');
  const before = await page.$eval('.ops-card', (c) => [c.style.left, c.style.top]);
  await page.click('#opsp-switch');
  assert.equal(await page.getAttribute('#opsp-switch', 'aria-checked'), 'true');
  assert.equal(await page.$$eval('.ops-card', (e) => e.length), 1, 'the menu is still open');
  assert.deepEqual(await page.$eval('.ops-card', (c) => [c.style.left, c.style.top]), before, 'not dragged');
  assert.equal(await page.$$eval('.opsp-row', (e) => e.length), 0, 'no switch at the bottom any more');
  await ctx.close();
});

test('POT-11: the Potato switch is only in the members\' menu: a tool page header has none', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('.ops-tile');
  await clickTile(page, 'Alpha Tool');
  await page.waitForSelector('.ops-check');
  assert.equal(await page.$$eval('#opsp-switch', (e) => e.length), 0);
  await ctx.close();
});

test('POT-12 (Tex 2026-10-17): the label says what Potato means, so there is no hint line; the reload note goes under the switch', async () => {
  const { ctx, page } = await open(PHONE);
  await page.waitForSelector('#opsp-switch');
  assert.equal(await page.$$eval('.opsp-hint', (e) => e.length), 0, 'no hint line');
  await page.click('#opsp-switch');
  assert.equal(await page.$eval('.ops-body', (b) => [b.children[0].className, b.children[1].className].join(' ')), 'opsp-mini opsp-note', 'the reload note under the switch');
  await ctx.close();
});
