'use strict';
// mask-spots.html (Tex, 2026-10-11): players paste Mask box spots copied from FunCC ("S4107 345,369") and every
// Mask Boxes collector picks them up. Against a fake worker; no network.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/mask-spots.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = path.join(__dirname, '..', 'pages', 'mask-spots.html');
const TEX = 'd847a198622a518d', SAM = 'b3cf33154662e254';
const ROSTER = [{ siteKey: TEX, name: 'Tex', alliance: 'DOG' }, { siteKey: SAM, name: 'Samson', alliance: 'DOG' }, { siteKey: '', name: 'NoKey', alliance: 'MSS' }];
const EVIL = '<img src=x onerror=window.__pwned=1>';
let server, base, browser, spots, posted, postAnswer, gets;

test.before(async () => {
  server = http.createServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/maskspots') && req.method === 'GET') { gets++; json(200, { ok: true, ttlMs: 1800000, max: 100, spots }); return; }
    if (req.url.startsWith('/maskspots') && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        posted.push({ type: req.headers['content-type'], body: JSON.parse(b) });
        if (postAnswer === 'down') { req.socket.destroy(); return; }
        if (postAnswer.body.spots) spots = postAnswer.body.spots;
        json(postAnswer.status, postAnswer.body);
      });
      return;
    }
    if (req.url.startsWith('/player-data.json')) { json(200, ROSTER); return; }
    const html = fs.readFileSync(PAGE, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html.replace('<head>', '<head><script>window.__MS_WORKER=location.origin;window.__MS_REFRESH_MS=300;</script>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/mask-spots.html';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { spots = []; posted = []; gets = 0; postAnswer = { status: 200, body: { ok: true, results: [], bad: [], spots: [] } }; });

async function open(identity) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  if (identity) await ctx.addInitScript((id) => { localStorage.setItem('playerIdentity', JSON.stringify(id)); }, identity);
  await page.goto(base);
  return { ctx, page, errs };
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText);

test('stored identity: pasted lines are added, each line says what happened, and the live list shows who added each spot', async () => {
  const NOW = Date.now();
  postAnswer = { status: 200, body: { ok: true, bad: ['what'],
    results: [{ spot: 'S4107 345,369', status: 'added' }, { spot: 'S2656 452,422', status: 'already' }],
    spots: [{ server: 4107, x: 345, y: 369, addedAt: NOW, name: 'Tex' }, { server: 2656, x: 452, y: 422, addedAt: NOW - 5 * 60000, name: EVIL }] } };
  const { ctx, page, errs } = await open({ name: 'Tex', siteKey: TEX });
  await page.waitForFunction(() => /No spots right now/.test(document.getElementById('ms-list').innerText));
  assert.match(await text(page, '#ms-as'), /Adding as Tex/);
  await page.fill('#ms-text', 'S4107 345,369\nS2656 452,422\nwhat');
  await page.click('#ms-add');
  await page.waitForFunction(() => /Already listed/.test(document.getElementById('ms-results').innerText));
  assert.deepEqual(posted.map((p) => p.body), [{ siteKey: TEX, text: 'S4107 345,369\nS2656 452,422\nwhat' }]);
  assert.match(posted[0].type, /^application\/json/);
  const r = await text(page, '#ms-results');
  assert.match(r, /S4107 345,369\s*Added/);
  assert.match(r, /S2656 452,422\s*Already listed/);
  assert.match(r, /what\s*Couldn't read/);
  assert.equal(await page.inputValue('#ms-text'), '', 'cleared for the next paste');
  const list = await text(page, '#ms-list');
  assert.match(list, /S4107\s*345, 369/);
  assert.match(list, /Tex/);
  assert.ok(list.includes(EVIL), 'a name is shown as text');
  assert.match(list, /5 min ago/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.match(await text(page, '#ms-count'), /2 of 100/);
  const body = await text(page, 'body');
  assert.ok(!/—/.test(body), 'no em dash');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('no stored identity: pick your name from the roster once and it is remembered; Not you? brings the picker back', async () => {
  const { ctx, page } = await open();
  await page.waitForFunction(() => document.querySelectorAll('#ms-who option[value]:not([value=""])').length === 2);
  assert.equal(await page.isDisabled('#ms-add'), true, 'nothing to add as until a name is picked');
  await page.selectOption('#ms-who', SAM);
  assert.match(await text(page, '#ms-as'), /Adding as Samson/);
  assert.equal(await page.isDisabled('#ms-add'), false);
  await page.reload();
  await page.waitForFunction(() => /Adding as Samson/.test(document.getElementById('ms-as').innerText));
  assert.equal(await page.isVisible('#ms-who'), false);
  await page.fill('#ms-text', 'S1 2,3');
  await page.click('#ms-add');
  await page.waitForFunction(() => document.getElementById('ms-msg').innerText !== '' || document.getElementById('ms-results').innerText !== '');
  assert.equal(posted[0].body.siteKey, SAM);
  await page.click('#ms-change');
  assert.equal(await page.isVisible('#ms-who'), true);
  await ctx.close();
});

test('problems are said in plain words: not on the roster, too many tries, nothing readable, server unreachable', async () => {
  const { ctx, page } = await open({ name: 'Tex', siteKey: TEX });
  const tryAdd = async (answer, re) => {
    postAnswer = answer;
    await page.fill('#ms-text', 'S4107 345,369');
    await page.click('#ms-add');
    await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('ms-msg').innerText), re.source);
    assert.equal(await page.inputValue('#ms-text'), 'S4107 345,369', 'kept so it can be sent again');
  };
  await tryAdd({ status: 403, body: { ok: false, error: 'not_member' } }, /Only players on the Server 2864 roster/);
  await tryAdd({ status: 429, body: { ok: false, error: 'rate_limited' } }, /Too many tries/);
  await tryAdd({ status: 400, body: { ok: false, error: 'nothing_readable', bad: ['S4107 345,369'] } }, /Couldn't read/);
  await tryAdd('down', /Couldn't reach the server/);
  await ctx.close();
});

test('the live list refreshes by itself, links to FunCC, and fits a phone', async () => {
  const { ctx, page } = await open({ name: 'Tex', siteKey: TEX });
  await page.waitForFunction(() => /No spots right now/.test(document.getElementById('ms-list').innerText));
  spots = [{ server: 2656, x: 452, y: 422, addedAt: Date.now() - 60000, name: 'Samson' }];
  await page.waitForFunction(() => /S2656/.test(document.getElementById('ms-list').innerText));
  assert.match(await text(page, '#ms-count'), /1 of 100/);
  const link = await page.$eval('a[href="https://game.funcc.xyz/mask-intel"]', (a) => ({ target: a.target, rel: a.rel }));
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
  const lay = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, add: document.getElementById('ms-add').getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(document.getElementById('ms-text')).fontSize), bg: getComputedStyle(document.body).backgroundColor }));
  assert.ok(lay.sw <= 375, 'no sideways scroll: ' + lay.sw);
  assert.ok(lay.add >= 44, 'Add is a 44 px tap target');
  assert.ok(lay.font >= 16, 'no zoom on focus in iOS Safari');
  assert.equal(lay.bg, 'rgb(13, 17, 23)', 'dark by default');
  await ctx.close();
});

test('limits (Tex 2026-10-14): up to 25 a paste, spots last 30 minutes, 80 an hour each, 100 on the list', async () => {
  postAnswer = { status: 200, body: { ok: true, bad: [], results: [{ spot: 'S1 1,1', status: 'added' }, { spot: 'S2 1,1', status: 'limit' }, { spot: 'S3 1,1', status: 'full' }], spots: [] } };
  const { ctx, page } = await open({ name: 'Tex', siteKey: TEX });
  const lead = await text(page, '.lead');
  assert.match(lead, /up to 25 at a time/);
  assert.match(lead, /for the next 30 minutes/);
  await page.fill('#ms-text', 'S1 1,1\nS2 1,1\nS3 1,1');
  await page.click('#ms-add');
  await page.waitForFunction(() => /List is full/.test(document.getElementById('ms-results').innerText));
  const r = await text(page, '#ms-results');
  assert.match(r, /S2 1,1\s*You can add 80 an hour/);
  assert.match(r, /S3 1,1\s*List is full \(100 spots\)/);
  assert.match(await text(page, '#ms-msg'), /for the next 30 minutes/);
  await ctx.close();
});
