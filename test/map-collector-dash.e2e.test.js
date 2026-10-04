'use strict';
// Map Collector dashboard against a mocked worker.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/map-collector-dash.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = path.join(__dirname, '..', 'pages', 'map-collector.html');
const TEX = 'd847a198622a518d', REX = 'c3c6f3200a4ec1fb';
let server, base, browser, state, asked;
const NOW = Date.now();
const S = () => ({ ok: true, now: NOW, window: { hours: 24, since: NOW - 864e5 },
  players: [{ siteKey: TEX, name: 'Tex' }, { siteKey: REX, name: 'Rеx' }], player: TEX,
  status: { run_id: 'r', state: 'running', stop_reason: '', last_report: NOW - 12000, claims_left: 477, connected: 1, visible: 1 },
  totals: { maps: 4, collected: 2, missed: 1, enRoute: 1, notSent: 0, skipped: 0, queued: 0 },
  bySpawner: [{ spawner: '<img src=x onerror=window.__pwned=1>', maps: 3, collected: 2, missed: 1 }, { spawner: 'Rеx', maps: 1, collected: 0, missed: 0 }],
  maps: [
    { id: '1', noticed_at: NOW - 60000, spawner: '<img src=x onerror=window.__pwned=1>', x: 438, y: 690, state: 'collected', reward: 'Blessing Key ×1', reason: '', arrive_at: 0 },
    { id: '2', noticed_at: NOW - 50000, spawner: 'Rеx', x: 1, y: 2, state: 'sent', reward: '', reason: '', arrive_at: NOW + 95000 },
    { id: '3', noticed_at: NOW - 40000, spawner: 'A', x: 3, y: 4, state: 'missed', reward: '', reason: '', arrive_at: 0 },
    { id: '4', noticed_at: NOW - 30000, spawner: 'B', x: 5, y: 6, state: 'gone', reward: '', reason: 'Location error', arrive_at: 0 }
  ] });

test.before(async () => {
  server = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.url.startsWith('/mapcollector/state')) {
      const pw = req.headers['x-map-collector-password'];
      asked.push(new URL(req.url, 'http://x').searchParams.get('player'));
      const ok = pw === 'good pass';
      let out = state;
      if (ok && asked[asked.length - 1] === REX) out = Object.assign({}, state, { player: REX, status: Object.assign({}, state.status, { claims_left: 123 }) });
      res.writeHead(ok ? 200 : 401, Object.assign({ 'content-type': 'application/json' }, cors));
      res.end(JSON.stringify(ok ? out : { ok: false })); return;
    }
    const html = fs.readFileSync(PAGE, 'utf8').replace(/connect-src [^;"]*/, 'connect-src *');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html.replace('<head>', '<head><script>window.__MAPC_WORKER=location.origin;</script>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { state = S(); asked = []; });

async function open(pw, extra) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  if (pw || extra) {
    await page.evaluate(([p, x]) => { if (p) localStorage.setItem('mapc_dash_pw_v1', p); if (x) localStorage.setItem('mapc_dash_player_v1', x); }, [pw, extra]);
    await page.reload();
  }
  return { ctx, page };
}
const visibleMaps = (page) => page.$$eval('li.map', (l) => l.filter((e) => e.offsetParent !== null).length);

test('gate: wrong password says so, right password shows the dashboard and is remembered', async () => {
  const { ctx, page } = await open();
  await page.fill('#dash-pw', 'nope'); await page.click('#dash-go');
  await page.waitForFunction(() => /That password didn't work\./.test(document.body.textContent));
  await page.fill('#dash-pw', 'good pass'); await page.click('#dash-go');
  await page.waitForSelector('li.map');
  assert.equal(await page.evaluate(() => localStorage.getItem('mapc_dash_pw_v1')), 'good pass');
  await ctx.close();
});

test('status, totals, spawners and maps render; names render as text; no overflow at 375 px', async () => {
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  assert.equal(await page.textContent('#dash-status'), 'Running');
  assert.match(await page.textContent('#dash-last'), /Last report 1\d s ago/);
  assert.match(await page.textContent('#dash-left'), /477 claims left/);
  assert.match(await page.textContent('#dash-totals'), /4 maps/);
  assert.match(await page.textContent('#dash-totals'), /2 collected/);
  assert.equal(await page.$$eval('tr.sp', (r) => r.length), 2);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.match(await page.textContent('#dash-maps'), /<img src=x onerror=window.__pwned=1>/);
  assert.match(await page.textContent('#dash-maps'), /arrives in 1m 3\ds/);
  assert.match(await page.textContent('#dash-maps'), /Location error/);
  assert.match(await page.textContent('#dash-maps'), /Blessing Key ×1/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375));
  assert.ok(!/—/.test(await page.content()));
  await ctx.close();
});

test('filters and status variants', async () => {
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  assert.equal(await visibleMaps(page), 4);
  await page.click('#dash-filter button[data-f="collected"]');
  assert.equal(await visibleMaps(page), 1);
  await page.click('#dash-filter button[data-f="notsent"]');
  assert.equal(await visibleMaps(page), 1);
  await page.click('#dash-filter button[data-f="missed"]');
  assert.equal(await visibleMaps(page), 1);
  await page.click('#dash-filter button[data-f="all"]');
  assert.equal(await visibleMaps(page), 4);
  for (const [patch, label] of [
    [{ last_report: NOW - 200000 }, 'Quiet'], [{ connected: 0 }, 'Disconnected'], [{ visible: 0 }, 'Tab hidden'],
    [{ state: 'stopped', stop_reason: 'out of claims' }, 'Stopped: out of claims']]) {
    state = S(); Object.assign(state.status, patch);
    await page.click('#dash-refresh');
    await page.waitForFunction((l) => document.querySelector('#dash-status').textContent === l, label);
  }
  state = S(); state.status = null; state.maps = []; state.bySpawner = []; state.totals = { maps: 0, collected: 0, missed: 0, enRoute: 0, notSent: 0, skipped: 0, queued: 0 };
  await page.click('#dash-refresh');
  await page.waitForFunction(() => document.querySelector('#dash-status').textContent === 'Not started yet');
  await ctx.close();
});

test('player switcher: both accounts listed, switching asks for that player and is remembered', async () => {
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('#dash-players button[data-sk]');
  assert.deepEqual(await page.$$eval('#dash-players button', (b) => b.map((x) => x.textContent)), ['Tex', 'Rеx']);
  assert.equal(await page.getAttribute('#dash-players button[data-sk="' + TEX + '"]', 'aria-pressed'), 'true');
  await page.click('#dash-players button[data-sk="' + REX + '"]');
  await page.waitForFunction(() => /123 claims left/.test(document.querySelector('#dash-left').textContent));
  assert.equal(asked[asked.length - 1], REX);
  assert.equal(await page.getAttribute('#dash-players button[data-sk="' + REX + '"]', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('mapc_dash_player_v1')), REX);
  await ctx.close();
  const again = await open('good pass', REX);
  await again.page.waitForFunction(() => /123 claims left/.test((document.querySelector('#dash-left') || {}).textContent || ''));
  assert.equal(asked[asked.length - 1], REX);
  await again.ctx.close();
});

test('a single-player password shows no switcher', async () => {
  state.players = [{ siteKey: TEX, name: 'Tex' }];
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  assert.equal(await page.$$eval('#dash-players button', (b) => b.length), 0);
  await ctx.close();
});
