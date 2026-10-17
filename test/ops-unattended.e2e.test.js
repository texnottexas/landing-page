'use strict';
// Ops Center Unattended mode (Tex 2026-10-16) in a real browser: the fake game (test/fixtures/mapc/) on the page and in
// the frame, a fake worker for /opsremote/*, and commands signed in node with the same core the dashboard uses.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/ops-unattended.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const U = require('../ops-unattended-core.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'mapc');
const OWN = ['ops-unattended.js', 'ops-unattended-core.js', 'ops-tools.json', 'ops-drag.js', 'ops-jam.js', 'ops-stack.js',
  'mask-boxes.js', 'mask-boxes-core.js', 'ht-gifts.js', 'ht-gifts-core.js', 'map-collector.js', 'map-collector-core.js'];
const UID = 'test-owner-uid';
const SK = crypto.createHash('sha256').update(UID).digest('hex').slice(0, 16);
const OTHER = 'c3c6f3200a4ec1fb';
const PW = 'amber falcon river';
let server, base, browser, W, KEY;

const freshWorker = () => ({ mode: 'ok', offset: 0, queue: [], syncs: [], acks: [], enabled: [], off: 0, mapc: [], mapcCommand: '', current: '', strict: false, resumed: 0, failRegistry: 0 });
function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(JSON.stringify(body)); }
test.before(async () => {
  KEY = await U.deriveKey(PW, SK);
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(); return; }
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      let j = null; try { j = JSON.parse(b); } catch (e) {}
      const wnow = Date.now() + W.offset;
      if (name === 'opsremote/enable') {
        W.enabled.push({ pw: req.headers['x-map-collector-password'], body: j });
        if (req.headers['x-map-collector-password'] !== PW) return json(res, 401, { ok: false, error: 'unauthorized' });
        W.current = 'ou1.' + SK + '.' + wnow + '.' + (wnow + 2592e6) + '.' + 'd'.repeat(64);
        return json(res, 200, { ok: true, pass: W.current, exp: wnow + 2592e6, now: wnow });
      }
      if (name === 'opsremote/resume') {              // a launch claims the account: the pass is swapped (review I4)
        if (W.strict && req.headers.authorization !== 'Bearer ' + W.current) return json(res, 409, { ok: false, error: 'superseded' });
        W.resumed++;
        W.current = 'ou1.' + SK + '.' + (wnow + W.resumed) + '.' + (wnow + 2592e6) + '.' + 'd'.repeat(64);
        return json(res, 200, { ok: true, pass: W.current, exp: wnow + 2592e6, now: wnow });
      }
      if (name === 'opsremote/sync') {
        if (W.mode === '401' || W.mode === '403') return json(res, Number(W.mode), { ok: false, error: 'x' });
        if (W.mode === '409' || W.mode === 'off') return json(res, 409, { ok: false, error: W.mode === 'off' ? 'off' : 'superseded' });
        if (W.strict && req.headers.authorization !== 'Bearer ' + W.current) return json(res, 409, { ok: false, error: 'superseded' });
        W.syncs.push({ auth: req.headers.authorization, status: j && j.status }); (j && j.acks || []).forEach((a) => W.acks.push(a));
        return json(res, 200, { ok: true, now: wnow, commands: W.queue.splice(0) });
      }
      if (name === 'opsremote/off') { W.off++; return json(res, 200, { ok: true }); }
      if (name === 'maskintel') return json(res, 200, { ok: true, fetchedAt: Date.now(), boxes: [], spots: [] });
      if (name === 'ops/usage' || name.startsWith('maskshare/')) return json(res, 200, { ok: true });
      if (name === 'mapcollector/report') { W.mapc.push(j); const c = W.mapcCommand; W.mapcCommand = ''; return json(res, 200, Object.assign({ ok: true, now: Date.now() }, c ? { command: c } : {})); }
      if (name === 'ops-tools.json' && /[?&]_=/.test(req.url) && W.failRegistry > 0) { W.failRegistry--; res.writeHead(500); res.end(); return; }   // the card's own fetch
      if (name.includes('..')) { res.writeHead(400); res.end(); return; }
      const file = OWN.includes(name) ? path.join(ROOT, name) : path.join(FIX, name);
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { W = freshWorker(); });

async function open(setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.evaluate((b) => {
    const w = b.replace(/\/$/, '');
    window.__OPSU_WORKER = w; window.__OPSU_BASE = b; window.__OPSU_SYNC_MS = 300; window.__OPSU_READY_MS = 8000; window.__OPSU_CARD_MS = 5000;
    window.__MBX_WORKER = w; window.__MBX_FAST = true; window.__HTG_WORKER = w; window.__MAPC_WORKER = w; window.__MAPC_REPORT_MS = 1000;
  }, base);
  if (setup) await page.evaluate(setup);
  await page.addScriptTag({ url: base + 'ops-unattended-core.js' });
  await page.addScriptTag({ url: base + 'ops-unattended.js' });
  return { ctx, page };
}
async function turnOn(page) {
  await page.waitForSelector('#opsu-pw');
  await page.fill('#opsu-pw', PW); await page.click('#opsu-go');
  await page.waitForFunction(() => /Connected/.test((document.getElementById('opsu-stat') || {}).textContent || ''), null, { timeout: 15000 });
}
async function send(kind, tool, o) {
  o = o || {};
  const cmd = Object.assign(U.makeCommand(o.sk || SK, kind, tool || '', Date.now() + W.offset + (o.age || 0)), o.cmd || {});
  const sig = o.sig || await U.sign(o.key || KEY, cmd);
  W.queue.push({ cmd, sig });
  return cmd;
}
async function ack(nonce, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) { const a = W.acks.find((x) => x.nonce === nonce); if (a) return a.result; await new Promise((r) => setTimeout(r, 100)); }
  return null;
}
const count = (page, sel) => page.$$eval(sel, (e) => e.length);
const frameEval = (page, fn) => page.evaluate((f) => new Function('w', f)(document.getElementById('mapc-frame').contentWindow), fn);

test('OPSU-1: turning on: the password once, a pass and a key kept (never the password), the game in #mapc-frame, check-ins with the six tools', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  assert.equal(W.enabled.length, 1); assert.equal(W.enabled[0].pw, PW); assert.deepEqual(W.enabled[0].body, { siteKey: SK });
  const saved = await page.evaluate((sk) => JSON.parse(localStorage.getItem('opsu_v1_' + sk)), SK);
  assert.match(saved.key, /^[0-9a-f]{64}$/); assert.equal(saved.key, KEY); assert.match(saved.pass, /^ou1\./);
  assert.equal(await page.evaluate((pw) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(pw)), PW), false, 'the password is not stored');
  assert.equal(await count(page, 'iframe#mapc-frame'), 1);
  assert.equal(await page.evaluate(() => document.getElementById('mapc-frame').src), base);
  const st = W.syncs[W.syncs.length - 1];
  assert.match(st.auth, /^Bearer ou1\./);
  assert.equal(st.status.connected, true);
  assert.deepEqual(Object.keys(st.status.tools), U.ORDER);
  assert.ok(Object.values(st.status.tools).every((t) => t.state === 'off'));
  await ctx.close();
});

test('OPSU-2: a signed Start loads Mask Boxes at its registry version; Stop stops it and clears its card', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  const c = await send('start', 'mask-boxes');
  assert.equal(await ack(c.nonce), 'Started');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops-tools.json'), 'utf8')).tools.find((t) => t.id === 'mask-boxes').version;
  assert.equal(await page.$$eval('script', (s, v) => s.filter((x) => x.src.includes('mask-boxes.js?v=' + encodeURIComponent(v))).length, ver), 1);
  await page.waitForFunction(() => window.__OPSU.state().tools['mask-boxes'].state === 'running', null, { timeout: 5000 });
  const s = await send('stop', 'mask-boxes');
  assert.match(await ack(s.nonce), /^Stopped/);
  assert.equal(await count(page, '#mbx-root'), 0);
  await ctx.close();
});

test('OPSU-3: forged, stale, replayed, wrong-account and unknown-tool commands are refused and run nothing', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  const forged = await send('start', 'mask-boxes', { sig: 'e'.repeat(64) });
  assert.equal(await ack(forged.nonce), 'refused: bad signature');
  const stale = await send('start', 'mask-boxes', { age: -3 * 60000 });
  assert.equal(await ack(stale.nonce), 'refused: too old');
  const other = await send('start', 'mask-boxes', { sk: OTHER });
  assert.equal(await ack(other.nonce), 'refused: wrong account');
  const odd = await send('start', 'troop');
  assert.equal(await ack(odd.nonce), 'refused: unknown tool');
  const good = await send('stopall', '');
  assert.equal(await ack(good.nonce), 'Nothing running');
  W.queue.push({ cmd: good, sig: await U.sign(KEY, good) });   // the same command again
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(W.acks.filter((a) => a.nonce === good.nonce).length, 2);
  assert.equal(W.acks.filter((a) => a.nonce === good.nonce)[1].result, 'refused: seen before');
  assert.equal(await count(page, '#mbx-root'), 0);
  await ctx.close();
});

test('OPSU-4: three bad signatures in a row stop remote control: no more check-ins, the card says why', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  for (let i = 0; i < 3; i++) await send('start', 'mask-boxes', { sig: (i + 'a').repeat(32) });
  await page.waitForFunction(() => /doesn't match/.test((document.getElementById('opsu-stat') || {}).textContent || ''), null, { timeout: 8000 });
  const n = W.syncs.length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(W.syncs.length <= n + 1, 'check-ins stopped');
  assert.equal(await page.evaluate(() => window.__OPSU.state().halted), true);
  await ctx.close();
});

test('OPSU-5: Reconnect reloads only the frame; the tab and its card carry on', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await page.evaluate(() => { window.__outer = 1; });
  await frameEval(page, 'w.__marker = 1;');
  const c = await send('reconnect', '');
  assert.equal(await ack(c.nonce, 15000), 'Reconnected');
  assert.equal(await frameEval(page, 'return !!w.__marker;'), false, 'the frame reloaded');
  assert.equal(await page.evaluate(() => window.__outer), 1, 'this page did not');
  assert.equal(await page.evaluate(() => window.__OPSU.state().reconnects), 1);
  await ctx.close();
});

test('OPSU-6 (Tex 2026-10-16): HT Gift Boxes starts with no password saved on this computer', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('htg_pw_v1')), null);
  const a = await send('start', 'ht-gifts');
  assert.equal(await ack(a.nonce), 'Started');
  await page.waitForFunction(() => window.__HTG && window.__HTG.state().running === true, null, { timeout: 5000 });
  assert.equal(await count(page, '#htg-pw'), 0);
  await ctx.close();
});

test('OPSU-7: another tab took over (409) or turned off: every tool it started stops, the pass is forgotten (Review Focus 3)', async () => {
  for (const mode of ['409', 'off']) {
    W = freshWorker();
    const { ctx, page } = await open();
    await turnOn(page);
    const c = await send('start', 'mask-boxes');
    assert.equal(await ack(c.nonce), 'Started');
    W.mode = mode;
    await page.waitForFunction((m) => new RegExp(m === 'off' ? 'turned off' : 'Another tab').test(document.getElementById('opsu-root').textContent), mode, { timeout: 8000 });
    await page.waitForFunction(() => !document.getElementById('mbx-root'), null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__OPSU.running), false);
    const saved = await page.evaluate((sk) => JSON.parse(localStorage.getItem('opsu_v1_' + sk)), SK);
    assert.ok(!saved || !saved.pass, 'the pass is forgotten: the next launch asks for the password');
    await ctx.close();
  }
});

test('OPSU-8: 401 or 403 on a check-in: everything stops and the pass is forgotten', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  W.mode = '403';
  await page.waitForFunction(() => /turned off for this account/.test(document.getElementById('opsu-root').textContent), null, { timeout: 8000 });
  const saved = await page.evaluate((sk) => JSON.parse(localStorage.getItem('opsu_v1_' + sk)), SK);
  assert.ok(!saved || !saved.pass);
  await ctx.close();
});

test('OPSU-9: Stop on the card stops its tools, tells the worker, forgets the pass (keeps the key) and leaves the game up', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  const c = await send('start', 'mask-boxes');
  assert.equal(await ack(c.nonce), 'Started');
  await page.click('#opsu-stop');
  await page.waitForFunction(() => /Unattended mode is off/.test(document.getElementById('opsu-root').textContent), null, { timeout: 8000 });
  assert.equal(W.off, 1);
  assert.equal(await count(page, '#mbx-root'), 0);
  const saved = await page.evaluate((sk) => JSON.parse(localStorage.getItem('opsu_v1_' + sk)), SK);
  assert.ok(!saved.pass); assert.equal(saved.key, KEY);
  assert.equal(await count(page, 'iframe#mapc-frame'), 1, 'the game stays usable here');
  await ctx.close();
});

test('OPSU-10: the tab\'s clock 5 minutes behind the worker\'s: fresh commands still run (Review Focus 1)', async () => {
  W.offset = 5 * 60000;
  const { ctx, page } = await open();
  await turnOn(page);
  await page.waitForFunction(() => window.__OPSU.state().tools, null, { timeout: 3000 });
  await new Promise((r) => setTimeout(r, 700));                     // a check-in carried the worker's clock
  const c = await send('stopall', '');
  assert.equal(await ack(c.nonce), 'Nothing running');
  await ctx.close();
});

test('OPSU-11: Start while the game in the frame is down: "the game is down: reconnect first", nothing loads (Review Focus 2)', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await frameEval(page, 'w.__fake.socket = 3;');
  const c = await send('start', 'mask-boxes');
  assert.equal(await ack(c.nonce), 'the game is down: reconnect first');
  assert.equal(await page.$$eval('script', (s) => s.filter((x) => x.src.includes('mask-boxes.js')).length), 0);
  assert.equal(W.syncs[W.syncs.length - 1].status.connected, false);
  await ctx.close();
});

test('OPSU-12: two Starts tapped quickly: one load, the second "Already running" (Review Focus 4)', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  const a = await send('start', 'mask-boxes'), b = await send('start', 'mask-boxes');
  assert.equal(await ack(a.nonce), 'Started');
  assert.equal(await ack(b.nonce), 'Already running');
  assert.equal(await page.$$eval('script', (s) => s.filter((x) => x.src.includes('mask-boxes.js?')).length), 1);
  await ctx.close();
});

test('OPSU-13: a remembered pass and key skip the password', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await c2.newPage();
  await p2.goto(base);
  await p2.evaluate(([b, sk, key]) => {
    const w = b.replace(/\/$/, '');
    window.__OPSU_WORKER = w; window.__OPSU_BASE = b; window.__OPSU_SYNC_MS = 300; window.__OPSU_READY_MS = 8000;
    localStorage.setItem('opsu_v1_' + sk, JSON.stringify({ pass: 'ou1.' + sk + '.1.' + (Date.now() + 2592e6) + '.' + 'd'.repeat(64), exp: Date.now() + 2592e6, key }));
  }, [base, SK, KEY]);
  await p2.addScriptTag({ url: base + 'ops-unattended-core.js' });
  await p2.addScriptTag({ url: base + 'ops-unattended.js' });
  await p2.waitForFunction(() => /Connected/.test((document.getElementById('opsu-stat') || {}).textContent || ''), null, { timeout: 15000 });
  assert.equal(W.enabled.length, 0);
  assert.equal(W.resumed, 1, 'the launch claimed the account with its remembered pass (review I4)');
  await c2.close();
});

test('OPSU-14: the card folds to its title bar and remembers it', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await page.click('#opsu-min');
  assert.match(await page.$eval('#opsu-root .opsu-card', (e) => e.className), /\bmin\b/);
  assert.equal(await page.evaluate(() => localStorage.getItem('opsu_min_v1')), '1');
  await ctx.close();
});

// Map Collector on the shared frame (Tex 2026-10-16).
async function startMapc(page) {
  await page.evaluate(() => localStorage.setItem('mapc_pw_v1', 'good pass'));
  const c = await send('start', 'map-collector');
  assert.equal(await ack(c.nonce, 15000), 'Started');
  await page.waitForFunction(() => window.__MAPC && window.__MAPC.attached === 'frame', null, { timeout: 15000 });
}
test('MCSF-1: Map Collector started here uses the shared frame: one frame, no Unattended button of its own', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await startMapc(page);
  assert.equal(await count(page, 'iframe'), 1);
  assert.equal(await count(page, '#mapc-unattended'), 0);
  assert.match(await page.textContent('#mapc-root'), /Unattended mode is on for this tab/);
  await ctx.close();
});
test('MCSF-2: Map Collector\'s own reconnect (its dashboard command) goes through Unattended mode: the frame reloads once', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await startMapc(page);
  await frameEval(page, 'w.__marker = 1;');
  W.mapcCommand = 'reconnect';
  await page.waitForFunction(() => window.__OPSU.state().reconnects === 1, null, { timeout: 15000 });
  await page.waitForFunction(() => { const w = document.getElementById('mapc-frame').contentWindow; return !!w.__fake && !w.__marker && window.__MAPC.attached === 'frame'; }, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__OPSU.state().reconnects), 1, 'one reload');
  await ctx.close();
});
test('MCSF-3: Map Collector stopped with a message is marked stopped; the tab reports it', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await startMapc(page);
  await page.evaluate(() => window.__MAPC.stop('a test reason'));
  assert.equal(await page.$eval('#mapc-root', (e) => e.getAttribute('data-ops-stopped')), '1');
  await page.waitForFunction(() => window.__OPSU.state().tools['map-collector'].state === 'stopped', null, { timeout: 5000 });
  await ctx.close();
});

// Final review fixes (2026-10-16).
test('OPSU-15 (C2): HT Gift Boxes stopped remotely starts again remotely', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  assert.equal(await ack((await send('start', 'ht-gifts')).nonce), 'Started');
  assert.match(await ack((await send('stop', 'ht-gifts')).nonce), /^Stopped/);
  assert.equal(await ack((await send('start', 'ht-gifts')).nonce), 'Started');
  assert.equal(await page.evaluate(() => window.__HTG.state().running), true);
  await ctx.close();
});

test('OPSU-16 (I3): Stop while commands wait (a tool slow to stop): none of them runs after "Unattended mode is off"', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  assert.equal(await ack((await send('start', 'mask-boxes')).nonce), 'Started');
  await page.evaluate(() => { const real = window.__MBX.stop; window.__MBX.stop = function () { setTimeout(real, 3000); }; });   // stands in for the Gatherer's skin switch-back
  await send('reconnect', ''); await send('start', 'ht-gifts');
  await page.waitForFunction(() => /Reconnecting/.test((document.getElementById('opsu-stat') || {}).textContent || ''), null, { timeout: 8000 });
  await page.click('#opsu-stop');
  await page.waitForFunction(() => /Unattended mode is off/.test(document.getElementById('opsu-root').textContent), null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  assert.equal(await count(page, '#htg-root'), 0, 'the queued Start never ran');
  assert.equal(await page.evaluate(() => !!(window.__HTG && window.__HTG.state && window.__HTG.state().running)), false);
  await ctx.close();
});

test('OPSU-17 (I4): a second tab launched with the remembered pass takes over; the first says so and stops', async () => {
  W.strict = true;
  const a = await open();
  await turnOn(a.page);
  const b = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await b.newPage();
  await p2.goto(base);
  await p2.evaluate(([bs, sk, key, pass]) => {
    const w = bs.replace(/\/$/, '');
    window.__OPSU_WORKER = w; window.__OPSU_BASE = bs; window.__OPSU_SYNC_MS = 300; window.__OPSU_READY_MS = 8000;
    localStorage.setItem('opsu_v1_' + sk, JSON.stringify({ pass, exp: Date.now() + 2592e6, key }));
  }, [base, SK, KEY, W.current]);
  await p2.addScriptTag({ url: base + 'ops-unattended-core.js' });
  await p2.addScriptTag({ url: base + 'ops-unattended.js' });
  await p2.waitForFunction(() => /Connected/.test((document.getElementById('opsu-stat') || {}).textContent || ''), null, { timeout: 15000 });
  await a.page.waitForFunction(() => /Another tab took over/.test(document.getElementById('opsu-root').textContent), null, { timeout: 8000 });
  assert.equal(await a.page.evaluate(() => window.__OPSU.running), false);
  await a.ctx.close(); await b.close();
});

test('OPSU-18 (I5): the tool list failing at turn-on is fetched again; a Start then works', async () => {
  W.failRegistry = 1;
  const { ctx, page } = await open();
  await turnOn(page);
  assert.equal(await ack((await send('start', 'mask-boxes')).nonce), 'Started');
  await ctx.close();
});

test('MCSF-4 (C1): stopping Map Collector leaves the shared game frame up; the other tools carry on', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await startMapc(page);
  assert.match(await ack((await send('stop', 'map-collector')).nonce), /^Stopped/);
  assert.equal(await page.$$eval('iframe#mapc-frame', (f) => f.filter((x) => x.isConnected).length), 1);
  assert.equal(await ack((await send('start', 'mask-boxes')).nonce), 'Started');
  await ctx.close();
});

test('MCSF-5 (I6): Map Collector launched after Unattended mode was turned off uses the frame still up', async () => {
  const { ctx, page } = await open();
  await turnOn(page);
  await page.click('#opsu-stop');
  await page.waitForFunction(() => /Unattended mode is off/.test(document.getElementById('opsu-root').textContent), null, { timeout: 8000 });
  await page.evaluate(() => localStorage.setItem('mapc_pw_v1', 'good pass'));
  await page.addScriptTag({ url: base + 'map-collector-core.js' });
  await page.addScriptTag({ url: base + 'map-collector.js' });
  await page.waitForFunction(() => window.__MAPC && window.__MAPC.attached === 'frame', null, { timeout: 15000 });
  assert.equal(await count(page, 'iframe'), 1);
  await ctx.close();
});

