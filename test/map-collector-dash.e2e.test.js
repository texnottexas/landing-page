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
let server, base, browser, state, asked, commands, posted, seenHours;
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
  ],
  settings: { speedOn: false, gemReserve: 10000, gemCap: 1500, updatedAt: 0 }, today: { speedups: 3, gems: 37 }, speedTotals: { speedups: 3, gems: 37 }, truncated: false });

test.before(async () => {
  server = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.url.startsWith('/mapcollector/command') && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        commands.push({ pw: req.headers['x-map-collector-password'], body: JSON.parse(b) });
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end('{"ok":true}');
      });
      return;
    }
    if (req.url.startsWith('/mapcollector/settings') && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        const body = JSON.parse(b); posted.push(body);
        const { player: _p, ...patch } = body;
        state.settings = Object.assign({}, state.settings, patch);
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify({ ok: true, settings: state.settings }));
      });
      return;
    }
    if (req.url.startsWith('/mapcollector/state')) {
      const pw = req.headers['x-map-collector-password'];
      seenHours.push(new URL(req.url, 'http://x').searchParams.get('hours'));
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
test.beforeEach(() => { state = S(); asked = []; commands = []; posted = []; seenHours = []; });

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

test('a collector logged out by another login offers a reconnect, which queues the command', async () => {
  state.status = Object.assign({}, state.status, { connected: 0, kicked: 1 });
  const { ctx, page } = await open('good pass');
  await page.waitForFunction(() => document.querySelector('#dash-status').textContent === 'Logged out by another login');
  assert.equal(await page.isVisible('#dash-reconnect'), true);
  await page.click('#dash-reconnect');
  await page.waitForFunction(() => /Reconnect sent/.test(document.querySelector('#dash-reconnect-msg').textContent));
  assert.deepEqual(commands.map((c) => c.body), [{ player: TEX, cmd: 'reconnect' }]);
  assert.equal(commands[0].pw, 'good pass');
  assert.equal(await page.isDisabled('#dash-reconnect'), true, 'one tap is enough; the button rests');
  await ctx.close();
});

test('no reconnect button while the collector is connected', async () => {
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  assert.equal(await page.isVisible('#dash-reconnect'), false);
  await ctx.close();
});

test('rewards show their item icons: from the item ids, or by name for older rows; unknown items stay text', async () => {
  state.maps = [
    { id: 'i3', noticed_at: NOW - 7000, spawner: 'C', x: 3, y: 3, state: 'collected', reward: 'Mystery Box ×3', reward_items: '', reason: '', arrive_at: 0 },
    { id: 'i2', noticed_at: NOW - 8000, spawner: 'B', x: 2, y: 2, state: 'collected', reward: 'Blessing Chest ×1', reward_items: '', reason: '', arrive_at: 0 },
    { id: 'i1', noticed_at: NOW - 9000, spawner: 'A', x: 1, y: 1, state: 'collected', reward: 'Blessing Key ×1, Titan Gear Random Material Chest ×2', reward_items: '79200004x1,62908x2', reason: '', arrive_at: 0 }
  ];
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  const icons = await page.$$eval('li.map', (lis) => lis.map((li) => Array.from(li.querySelectorAll('img.ri')).map((i) => i.getAttribute('src').split('/').pop())));
  const byText = await page.$$eval('li.map', (lis) => lis.map((li) => li.querySelector('.sub').textContent));
  const at = (sp) => state.maps.findIndex((m) => m.spawner === sp);
  // the worker returns newest first: C, B, A
  assert.deepEqual(icons[0], []);
  assert.match(byText[0], /Mystery Box ×3/);
  assert.deepEqual(icons[1], ['image__item__item_79200003.png']);
  assert.match(byText[1], /Blessing Chest ×1/);
  assert.deepEqual(icons[2], ['image__item__item_79200004.png', 'image__item__item_62908.png']);
  assert.match(byText[2], /Blessing Key ×1.*Titan Gear Random Material Chest ×2/);
  assert.ok(await page.$eval('img.ri', (i) => i.src.startsWith('https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/inventory-icons/')));
  assert.ok(at('A') >= 0);
  await ctx.close();
});

test('older rows: the three catalysts show their icons by name (Mid, Advanced, Top tier)', async () => {
  state.maps = [
    { id: 'c3', noticed_at: NOW - 7000, spawner: 'C', x: 3, y: 3, state: 'collected', reward: 'Top-tier Catalyst ×1', reward_items: '', reason: '', arrive_at: 0 },
    { id: 'c2', noticed_at: NOW - 8000, spawner: 'B', x: 2, y: 2, state: 'collected', reward: 'Advanced-tier Catalyst ×1', reward_items: '', reason: '', arrive_at: 0 },
    { id: 'c1', noticed_at: NOW - 9000, spawner: 'A', x: 1, y: 1, state: 'collected', reward: 'Mid-tier Catalyst ×1', reward_items: '', reason: '', arrive_at: 0 }
  ];
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  const icons = await page.$$eval('li.map', (lis) => lis.map((li) => Array.from(li.querySelectorAll('img.ri')).map((i) => i.getAttribute('src').split('/').pop())));
  assert.deepEqual(icons, [['image__item__item_820017.png'], ['image__item__item_820016.png'], ['image__item__item_820015.png']]);
  await ctx.close();
});

test('speed-up panel: switch and gem fields post settings; today line shows use and spend', async () => {
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('#dash-speed');
  assert.match(await page.textContent('#dash-speed-today'), /3 speed-ups.*37 of 1,500 gems/);
  assert.equal(await page.$eval('#dash-speed', (b) => b.getAttribute('aria-checked')), 'false');
  await page.click('#dash-speed');
  await page.waitForFunction(() => document.querySelector('#dash-speed').getAttribute('aria-checked') === 'true');
  assert.deepEqual(posted.at(-1), { player: TEX, speedOn: true });
  await page.fill('#dash-reserve', '5000'); await page.fill('#dash-cap', '740'); await page.click('#dash-speed-save');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#dash-speed-msg').textContent));
  assert.deepEqual(posted.at(-1), { player: TEX, gemReserve: 5000, gemCap: 740 });
  await page.fill('#dash-cap', '-4'); await page.click('#dash-speed-save');
  assert.match(await page.textContent('#dash-speed-msg'), /whole numbers/);
  assert.equal(posted.length, 2, 'a bad value is not sent');
  assert.match(await page.textContent('#dash-boost'), /your time/);
  await ctx.close();
});
test('rows show speed-ups; period switch asks for 7 days; radar keeps 24 h; truncated note', async () => {
  state.maps = [
    { id: 'n', noticed_at: NOW - 3600e3, spawner: 'A', x: 1, y: 1, state: 'collected', reward: 'Blessing Key ×1', reward_items: '79200004x1', speedups: 2, gems: 37, reason: '', arrive_at: 0 },
    { id: 'o', noticed_at: NOW - 3 * 864e5, spawner: 'B', x: 9, y: 9, state: 'missed', reward: '', reward_items: '', speedups: 0, gems: 0, reason: '', arrive_at: 0 }];
  state.truncated = true;
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('li.map');
  assert.match(await page.textContent('li.map .spd'), /2 speed-ups · 37 gems/);
  assert.equal(await page.$$eval('li.map .spd', (l) => l.length), 1, 'only the map that used some');
  assert.equal(await page.$$eval('#dash-radar circle.dot', (c) => c.length), 1, 'only the last 24 h on the radar');
  assert.equal(seenHours.at(-1), '24');
  await page.click('#dash-period button[data-h="168"]');
  await page.waitForFunction(() => document.querySelector('#dash-period button[data-h="168"]').getAttribute('aria-pressed') === 'true');
  assert.equal(seenHours.at(-1), '168');
  await page.waitForFunction(() => /Last 7 days/.test(document.querySelector('#dash-totals').textContent));
  assert.ok(await page.isVisible('#dash-trunc'));
  assert.ok(await page.$eval('li.map:nth-child(2) .t small', (e) => e.textContent.length > 0), 'an older day shows its weekday');
  await page.reload();
  await page.waitForSelector('li.map');
  assert.equal(seenHours.at(-1), '168', 'the period is remembered');
  await ctx.close();
});
test('auto-reconnect time shows while disconnected; radar dots have gradient fill and rim', async () => {
  state.status = Object.assign({}, state.status, { connected: 0, kicked: 1, auto_reconnect_at: NOW + 1800e3 });
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('#dash-auto:not([hidden])');
  assert.match(await page.textContent('#dash-auto'), /Reconnects by itself at/);
  const dot = await page.$eval('#dash-radar circle.dot', (c) => ({ fill: c.getAttribute('fill'), stroke: c.getAttribute('stroke') }));
  assert.match(dot.fill, /^url\(#rg/); assert.ok(dot.stroke && dot.stroke !== 'none');
  const pos = await page.$$eval('#dash-radar circle.dot', (c) => c.map((x) => [Number(x.getAttribute('cx')), Number(x.getAttribute('cy'))]));
  assert.ok(pos.length > 0 && pos.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.hypot(p[0] - 100, p[1] - 100) <= 92), 'every dot sits inside the radar: ' + JSON.stringify(pos));
  await ctx.close();
});

test('gems spent on speed-ups show in the status panel while speed-ups are on or gems were spent', async () => {
  state.settings.speedOn = true; state.speedTotals = { speedups: 7, gems: 111 };
  const { ctx, page } = await open('good pass');
  await page.waitForSelector('#dash-spend:not([hidden])');
  assert.match(await page.textContent('#dash-spend'), /111 gems spent on 7 speed-ups/);
  await ctx.close();
  state = S(); state.speedTotals = { speedups: 0, gems: 0 };
  const two = await open('good pass');
  await two.page.waitForSelector('li.map');
  assert.equal(await two.page.isVisible('#dash-spend'), false, 'nothing to show while off and nothing spent');
  await two.ctx.close();
});
