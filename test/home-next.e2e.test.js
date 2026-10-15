'use strict';
// Homepage redesign preview (pages/home-next.html, Tex 2026-10-15): layout "C · the arc" plus the next-up card.
// A static server for the landing-page files and a routed fake worker; nothing reaches 2864tw.com.
// Run:  NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/home-next.e2e.test.js
// HN_SHOTS=<dir> saves screenshots at 360/768/1280/1440. HN_PAGE=index.html runs it against the page after the swap.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = process.env.HN_PAGE || 'home-next.html';
const SHOTS = process.env.HN_SHOTS || null;
const W = 'https://push-worker.27tb8s6fct.workers.dev';
const RC = 'https://rickroll-counter.27tb8s6fct.workers.dev';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const H = 3600e3;
const NOW = Date.parse('2026-10-22T10:00:00Z');          // Thursday 6:00 AM ET
const WEEK = '2026-10-24';
const CLOSES = '2026-10-22T20:00:00.000Z';               // signups close Thursday 4:00 PM ET
const BATTLE = Date.parse('2026-10-24T18:00:00Z');       // Saturday 2:00 PM ET = reset +2
const SVS_UNTIL = 1792252800000;                          // the page's SvS spoke cutoff

const ROSTER = [
  { name: 'Tex', alliance: 'DOG', rank: 4, siteKey: 'aaaaaaaaaaaaaaaa' },
  { name: 'Newbie', alliance: 'DOG', rank: 3, siteKey: 'cccccccccccccccc' },
  { name: 'Willow', alliance: 'MSS', rank: 5, siteKey: 'dddddddddddddddd' },
];
const TEX = { name: 'Tex', alliance: 'DOG', rank: 4, siteKey: 'aaaaaaaaaaaaaaaa' };
const NEWBIE = { name: 'Newbie', alliance: 'DOG', rank: 3, siteKey: 'cccccccccccccccc' };

const TC_PLACED = { ok: true, week: WEEK, closesAt: CLOSES, signedUp: true, squad: 'DOG Squad A', slot: '+2', battleAt: BATTLE };
const TC_NOT_SIGNED = { ok: true, week: WEEK, closesAt: CLOSES, signedUp: false, squad: null, slot: null, battleAt: null };
const TC_NONE = { ok: true, week: '2026-11-07', closesAt: '2026-11-05T20:00:00.000Z', signedUp: false, squad: null, slot: null, battleAt: null };

const iso = (ms) => new Date(ms).toISOString();
const ev = (id, title, tags, startMs, mins) => ({ id, title, tags, start: iso(startMs), end: iso(startMs + (mins || 30) * 60e3), recurring: null, recurUntil: null });
// Calendar events (worker /calendar-events): one recurring, one only MSS sees, one already started, one beyond the first three.
const CAL = [
  ev('e1', 'Titan Canyon battle', ['DOG'], Date.parse('2026-10-22T18:00:00Z')),     // reset +2
  ev('e2', 'Group buff window', ['Group Buffs'], Date.parse('2026-10-22T22:00:00Z')), // reset +6
  ev('e3', 'Late thing', ['fkboats'], Date.parse('2026-10-23T02:00:00Z')),            // reset +10
  ev('e4', 'MSS meeting', ['MSS'], Date.parse('2026-10-22T16:30:00Z')),               // DOG R3 doesn't see it
  ev('e5', 'Fourth DOG thing', ['DOG'], Date.parse('2026-10-23T05:00:00Z')),
  ev('e6', 'Already started', ['DOG'], NOW - H, 180),
  { id: 'r1', title: 'Daily reset buff', tags: ['Group Buffs'], start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T15:30:00.000Z',
    recurring: { days: [0, 1, 2, 3, 4, 5, 6] }, recurUntil: null },                  // 11:00 AM ET daily = reset -1
];

let server, origin, browser, st, rc;

function fresh() {
  return {
    tcStatus: 200, calStatus: 200, cal: [],
    tc: () => TC_NONE,                       // (siteKey, name) -> response body
    calls: [],
  };
}

function staticFile(p) {
  if (p === '/' + PAGE || p === '/home-next') return [fs.readFileSync(path.join(ROOT, 'pages', PAGE)), 'text/html'];
  if (p === '/next-up-core.js') return [fs.readFileSync(path.join(ROOT, 'next-up-core.js')), 'text/javascript'];
  if (p === '/player-data.json') return [JSON.stringify(ROSTER), 'application/json'];
  if (p === '/seal-stone-calendar.json') return [fs.readFileSync(path.join(ROOT, 'seal-stone-calendar.json')), 'application/json'];
  if (p === '/sw.js') return ['/* test stub: no fetch handler */', 'text/javascript'];
  if (/^\/[\w-]+\.html$/.test(p)) return ['<!doctype html><title>stub</title>', 'text/html'];   // pages the eggs open in a new tab
  if (p.startsWith('/data/') || p.startsWith('/assets/')) {
    const f = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return null;
    const ext = path.extname(f);
    const type = { '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    return [fs.readFileSync(f), type];
  }
  return null;
}

test.before(async () => {
  server = http.createServer((req, res) => {
    const f = staticFile(req.url.split('?')[0]);
    if (!f) { res.writeHead(404); res.end(''); return; }
    res.writeHead(200, { 'content-type': f[1] }); res.end(f[0]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { st = fresh(); rc = { count: 42, posts: 0 }; });

async function workerRoute(rt) {
  const req = rt.request(); const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return rt.fulfill({ status: 204, headers: CORS });
  st.calls.push({ method: req.method(), path: u.pathname, q: Object.fromEntries(u.searchParams) });
  const json = (status, body) => rt.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname === '/titan/next-battle') {
    if (st.tcStatus !== 200) return json(st.tcStatus, { error: 'boom' });
    return json(200, st.tc(u.searchParams.get('siteKey'), u.searchParams.get('name')));
  }
  if (u.pathname === '/calendar-events') return st.calStatus !== 200 ? json(st.calStatus, { error: 'boom' }) : json(200, st.cal);
  if (u.pathname === '/flag-overrides') return json(200, {});
  return json(404, { error: 'nope' });
}

async function open(opts) {
  const o = Object.assign({ width: 1280, height: 900, identity: TEX, time: NOW, reduced: false }, opts || {});
  const ctx = await browser.newContext({
    viewport: { width: o.width, height: o.height }, timezoneId: 'America/New_York', locale: 'en-US',
    reducedMotion: o.reduced ? 'reduce' : 'no-preference',
  });
  await ctx.route((u) => u.origin !== origin && !u.href.startsWith(W) && !u.href.startsWith(RC), (rt) => rt.abort());
  await ctx.route((u) => u.href.startsWith(W), workerRoute);
  await ctx.route((u) => u.href.startsWith(RC), (rt) => {
    if (rt.request().method() === 'POST') { rc.posts++; rc.count++; }
    return rt.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ count: rc.count }) });
  });
  await ctx.addInitScript((id) => {
    try {
      if (!sessionStorage.getItem('__hn_seeded')) {
        sessionStorage.setItem('__hn_seeded', '1');
        if (id === null) localStorage.removeItem('playerIdentity');
        else localStorage.setItem('playerIdentity', typeof id === 'string' ? id : JSON.stringify(id));
      }
      localStorage.setItem('release_major_seen', '999');   // keep the first-visit popup out of the way
      localStorage.setItem('install-dismissed', '1');
    } catch (e) { /* none */ }
    window.__perm = 0;
    if (window.Notification) Notification.requestPermission = function () { window.__perm++; return Promise.resolve('denied'); };
  }, o.identity === undefined ? null : o.identity);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  if (o.time != null) await page.clock.install({ time: o.time });
  await page.goto(origin + '/' + PAGE);
  await page.waitForFunction(() => document.readyState === 'complete');
  return { ctx, page, errs };
}

const closeAll = (page) => page.evaluate(() => document.querySelectorAll('.active').forEach((m) => {
  if (/modal|overlay/.test(m.className) || m.id === 'langModal') m.classList.remove('active');
}));
async function shot(page, name, opts) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot(Object.assign({ path: path.join(SHOTS, 'home-next-' + name + '.png') }, opts || {}));
}
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }, sel);
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const SPOKES_FULL = ['March Setups', 'Beta Features', 'Titan Canyon', 'Calendar', 'Join 2864', 'Heroes Awakening', 'Mathomhouse'];
const SPOKES_SHORT = ['Marches', 'Beta', 'Titan', 'Calendar', 'Join', 'Awaken', 'Mathom'];

// ── layout ──
test('HN-LAYOUT: one layout from 360 to 1440, no sideways scroll, 7 spokes + hub, every tap target 44 px', async () => {
  st.tc = () => TC_PLACED; st.cal = CAL;
  for (const width of [360, 768, 1280, 1440]) {
    const { ctx, page, errs } = await open({ width });
    await page.waitForSelector('#nextUp:not([hidden]) .nu-card:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#todayList .ev').length === 3);
    await page.waitForTimeout(150);

    const ov = await page.evaluate(() => {
      const b = document.body, de = document.documentElement;
      const keep = [b.style.overflowX, de.style.overflowX];
      b.style.overflowX = 'visible'; de.style.overflowX = 'visible';
      const iw = de.clientWidth, sw = de.scrollWidth;
      const off = [...document.querySelectorAll('header *, .main *, .site-footer *')].filter((el) => {
        if (el.closest('#google_translate_element')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > iw + 0.5 || r.left < -0.5);
      }).slice(0, 5).map((el) => (el.id || el.className || el.tagName) + ' ' + Math.round(el.getBoundingClientRect().right));
      b.style.overflowX = keep[0]; de.style.overflowX = keep[1];
      return { iw, sw, off };
    });
    assert.ok(ov.sw <= ov.iw, width + ': scrollWidth ' + ov.sw + ' > ' + ov.iw);
    assert.deepEqual(ov.off, [], width + ': elements past the edge');

    const arc = await page.evaluate(() => {
      const nav = document.querySelector('nav.arc');
      const spokes = [...nav.querySelectorAll('.wheel-item')].map((a) => { const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width, h: r.height }; });
      const hub = nav.querySelectorAll('.wheel-center');
      const hr = hub[0] && hub[0].getBoundingClientRect();
      return { n: spokes.length, hubs: hub.length, spokes, hub: hr && { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 } };
    });
    assert.equal(arc.n, 7, width + ': 7 spokes');
    assert.equal(arc.hubs, 1, width + ': one hub');
    for (let i = 1; i < 7; i++) {
      const a = arc.spokes[i - 1], b = arc.spokes[i];
      assert.ok(b.x > a.x, width + ': spokes run left to right');
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= a.d - 0.5, width + ': spokes ' + (i - 1) + '/' + i + ' overlap');
    }
    assert.ok(Math.abs(arc.spokes[0].y - arc.hub.y) < 2 && Math.abs(arc.spokes[6].y - arc.hub.y) < 2, width + ': the arc ends level with the hub');
    assert.ok(arc.spokes[3].y < arc.hub.y - 50 && Math.abs(arc.spokes[3].x - arc.hub.x) < 2, width + ': Calendar sits at the top, over the hub');

    const small = await page.evaluate(() => {
      const sel = 'header a, header button, #bannerChips a, #bannerChips button, #nextUp a, nav.arc a, .home-grid a, .site-footer a, #rc-wrap';
      return [...document.querySelectorAll(sel)].map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && x.r.height > 0 && getComputedStyle(x.el).visibility !== 'hidden')
        .filter((x) => x.r.width < 43.5 || x.r.height < 43.5)
        .map((x) => (x.el.id || x.el.className || x.el.textContent.trim().slice(0, 20)) + ' ' + Math.round(x.r.width) + 'x' + Math.round(x.r.height));
    });
    assert.deepEqual(small, [], width + ': tap targets under 44 px');

    if (width >= 1280) {
      const edges = await page.evaluate(() => ['.banner', 'nav.arc', '.home-grid'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
      assert.deepEqual(edges[2], edges[0], width + ': the grid lines up with the banner');
      assert.deepEqual(edges[1], edges[0], width + ': the arc lines up with the banner');
    }
    const dashes = await page.evaluate(() => ['header', '.main', '.site-footer'].map((s) => document.querySelector(s).innerText).join('\n'));
    assert.ok(!/—/.test(dashes), width + ': no em dash in visible text');
    assert.ok(!/NaN|undefined/.test(dashes), width + ': no NaN/undefined on the page');

    await shot(page, String(width), { fullPage: true });
    if (width === 1280 && SHOTS) {
      await page.evaluate(() => window.toggleTheme());
      await page.waitForTimeout(600);   // the body's 0.3 s colour transition
      await shot(page, '1280-light', { fullPage: true });
      await page.evaluate(() => window.toggleTheme());
    }
    assert.deepEqual(errs, [], width + ': page errors');
    await ctx.close();
  }
});

test('HN-BANNER: the banner and the touch icon are self-hosted; retired list view and stale links are gone', async () => {
  const { ctx, page, errs } = await open();
  const img = await page.evaluate(() => new Promise((res) => {
    const i = document.getElementById('banner-img');
    const done = () => res({ src: i.getAttribute('src'), w: i.naturalWidth });
    if (i.complete) done(); else i.addEventListener('load', done);
  }));
  assert.equal(img.src, 'assets/home/welcome2864.jpg');
  assert.equal(img.w, 1400);
  assert.ok(fs.statSync(path.join(ROOT, 'assets/home/welcome2864.jpg')).size <= 250 * 1024, 'banner is at most 250 KB');
  const html = fs.readFileSync(path.join(ROOT, 'pages', PAGE), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/home\/apple-touch-icon\.png">/);
  assert.ok(!/i\.ibb\.co\/(Swq1hRtp|tjYfSRY)/.test(html), 'no banner or icon from i.ibb.co');
  for (const gone of ['viewToggle', 'view-mode', 'list-view', 'beta-list-item', 'lve-item', 'great-offers-preview', 'mobile-toggle-row', 'wheel-item-inner']) {
    assert.ok(!html.includes(gone), 'retired: ' + gone);
  }
  assert.match(html, /<script src="next-up-core\.js" defer><\/script>/);
  assert.match(html, /<img src="assets\/home\/welcome2864\.jpg"[^>]*fetchpriority="high"/);
  // every <svg> holds only SVG elements (an unclosed one would swallow the HTML after it)
  const bad = await page.evaluate(() => [...document.querySelectorAll('svg')].filter((s) => [...s.querySelectorAll('*')].some((c) => c.namespaceURI !== 'http://www.w3.org/2000/svg')).length);
  assert.equal(bad, 0, 'svg children are all SVG');
  assert.deepEqual(errs, []);
  await ctx.close();
});

// ── every old entry point still works ──
test('HN-NAV: each spoke, bar, header button and chip opens what it opened before', async () => {
  st.tc = () => TC_PLACED; st.cal = CAL;
  const { ctx, page, errs } = await open();
  const opens = async (sel, modal) => {
    await closeAll(page);
    await page.click(sel);
    await page.waitForFunction((m) => document.getElementById(m).classList.contains('active'), modal);
    await closeAll(page);
  };
  await opens('nav.arc .wheel-item[data-modal="defense-modal"]', 'defense-modal');
  await opens('nav.arc .wheel-item[data-modal="beta-modal"]', 'beta-modal');
  await opens('nav.arc .wheel-item[data-modal="cal-modal"]', 'cal-modal');
  await opens('nav.arc .wheel-item[data-modal="join-modal"]', 'join-modal');
  const hrefs = await page.$$eval('nav.arc .wheel-item', (as) => as.map((a) => a.getAttribute('href')));
  assert.equal(hrefs.length, 7);
  assert.ok(hrefs.includes('heroes-awakening'), 'clean link');
  assert.ok(hrefs.includes('https://mathomhouse.github.io/index.html'));
  assert.ok(['svs', 'titan'].includes(await page.getAttribute('#wheelEventSpoke', 'href')), 'clean link');
  assert.deepEqual(hrefs.filter((h) => /\.html$/.test(h) && !/^https:/.test(h)), [], 'no .html on the spokes');

  // the bars (the old inner icons, now labelled)
  await opens('#heartRosterBtn', 'roster-modal');
  await opens('#wheelFeedbackBtn', 'feedback-modal');
  await opens('.home-grid .bar[data-modal="unit-modal"]', 'unit-modal');
  await opens('.today-link', 'cal-modal');
  const bar = (t) => page.locator('.home-grid .bar', { hasText: t });
  assert.equal(await bar('Roadmap').getAttribute('href'), '/roadmap');
  assert.equal(await bar('Learning Lounge').getAttribute('href'), '/learn');
  assert.equal(await bar('Pay portal').getAttribute('href'), 'https://h5.topwargame.com/h5game/bullionPayNew/index.html');
  assert.equal(await bar('Pay portal').getAttribute('target'), '_blank');
  assert.match(await bar('Pay portal').getAttribute('rel'), /noopener/);
  assert.deepEqual(await page.$$eval('.home-grid .home-h', (hs) => hs.map((h) => h.textContent.trim())), ['Today', 'Community', 'Rewards and help']);

  // header: feedback, settings, theme, bell, identity chip, version badge, leadership chip
  await opens('#feedbackBtn', 'feedback-modal');
  await opens('#prefsBtn', 'prefs-modal');
  const theme = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn');
  assert.notEqual(await page.getAttribute('html', 'data-theme'), theme);
  await page.click('#themeBtn');
  await page.waitForFunction(() => document.getElementById('bellBtn').style.display !== 'none' && document.getElementById('bellBtn').getBoundingClientRect().width > 0);
  await page.click('#bellBtn');
  await page.waitForFunction(() => window.__perm === 1);
  await opens('#identity-chip', 'identity-modal');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('version-badge')).display !== 'none');
  await opens('#version-badge', 'release-modal');
  await page.waitForSelector('#leadership-cta');
  assert.equal(await page.getAttribute('#leadership-cta', 'href'), 'leadership');

  // the next-up card links
  assert.equal(await page.getAttribute('#nuCta', 'href'), '/titan');

  // the banner multi-click: five taps open push-admin
  const [pop] = await Promise.all([ctx.waitForEvent('page'), (async () => { for (let i = 0; i < 5; i++) await page.click('#banner-img'); })()]);
  await pop.waitForURL(/push-admin/);
  await pop.close();
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-SWAP: the crossed-swords spoke is SvS until the cutoff, then Titan Canyon, full and short labels both', async () => {
  for (const [time, href, full, short] of [[SVS_UNTIL - 24 * H, 'svs', 'SvS', 'SvS'], [SVS_UNTIL + H, 'titan', 'Titan Canyon', 'Titan']]) {
    const { ctx, page, errs } = await open({ time, width: 360 });
    // phone: the short label is real text (Google Translate only rewrites DOM text), the full one is hidden
    const s = await page.$eval('#wheelEventSpoke', (a) => ({ href: a.getAttribute('href'), aria: a.getAttribute('aria-label'),
      label: a.querySelector('.w-label').textContent.trim(), short: a.querySelector('.w-short').textContent.trim(),
      shown: getComputedStyle(a.querySelector('.w-short')).display !== 'none' && getComputedStyle(a.querySelector('.w-label')).display === 'none' }));
    assert.deepEqual(s, { href, aria: full, label: full, short, shown: true });
    assert.deepEqual(errs, []);
    await ctx.close();
  }
});

test('HN-EGGS: the hub and the burger still count, and the popcorn shows the count', async () => {
  const { ctx, page, errs } = await open();
  for (const sel of ['nav.arc .wheel-center', 'header .easter-egg']) {
    const before = rc.posts;
    // force: these two pulse forever, so Playwright's "stable" wait never settles; it is still a real mouse click
    const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click(sel, { force: true })]);
    await pop.close();
    for (let i = 0; i < 50 && rc.posts === before; i++) await page.waitForTimeout(50);
    assert.ok(rc.posts > before, sel + ' POSTs the counter');
  }
  assert.match(await page.getAttribute('nav.arc .wheel-center', 'href'), /^passwords\.html$/);
  assert.equal(await txt(page, 'nav.arc .wheel-center'), '2864fk boats');
  await page.waitForTimeout(200);
  await page.click('#rc-wrap');
  await page.waitForFunction(() => document.getElementById('rc-count').classList.contains('visible'));
  assert.equal(await txt(page, '#rc-count'), String(rc.count));
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-LANG: the flag button opens the language picker, on desktop and phone', async () => {
  for (const width of [1280, 360]) {
    const { ctx, page, errs } = await open({ width });
    assert.ok(await visible(page, '#langBtn #langFlag'));
    await page.click('#langBtn');
    await page.waitForSelector('#langModal.active');
    assert.equal(await page.$$eval('#langGrid .lang-option', (b) => b.length), 18);
    assert.deepEqual(errs, []);
    await ctx.close();
  }
});

// ── phone menu ──
test('HN-MENU: the phone menu moves the same buttons in, opens and closes, returns focus, and each button still works', async () => {
  const { ctx, page, errs } = await open({ width: 360 });
  const MOVED = ['bellBtn', 'feedbackBtn', 'prefsBtn', 'themeBtn'];
  const where = () => page.evaluate((ids) => ids.map((id) => [document.querySelectorAll('#' + id).length, document.getElementById(id).parentElement.id || document.getElementById(id).parentElement.className]), MOVED);
  assert.ok(await visible(page, '#menuBtn'));
  assert.deepEqual(await where(), MOVED.map(() => [1, 'menuSheet']));
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
  assert.ok(!(await visible(page, '#feedbackBtn')), 'closed sheet hides its buttons');

  const openSheet = async () => { await page.click('#menuBtn'); await page.waitForSelector('#menuSheet:not([hidden])'); };
  await openSheet();
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'true');
  assert.ok(await page.evaluate(() => document.getElementById('menuSheet').contains(document.activeElement)), 'focus moves into the sheet');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menuSheet[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menuBtn', 'focus returns to the menu button');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');

  // the menu button toggles; an outside tap closes
  await openSheet();
  await page.click('#menuBtn');
  await page.waitForSelector('#menuSheet[hidden]', { state: 'attached' });
  await openSheet();
  await page.click('.home-h >> nth=0');
  await page.waitForSelector('#menuSheet[hidden]', { state: 'attached' });

  // theme toggles in place; feedback, settings and the bell close the sheet and do their job
  await openSheet();
  await shot(page, '360-menu', { clip: { x: 0, y: 0, width: 360, height: 420 } });
  const theme = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn');
  assert.notEqual(await page.getAttribute('html', 'data-theme'), theme);
  assert.ok(await visible(page, '#menuSheet'), 'theme keeps the sheet open');
  await page.click('#feedbackBtn');
  await page.waitForSelector('#feedback-modal.active');
  assert.ok(await page.evaluate(() => document.getElementById('menuSheet').hidden), 'the sheet never covers the modal it opened');
  assert.notEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'menuBtn', 'focus is not pulled back behind the modal');
  await closeAll(page);
  await openSheet();
  await page.click('#prefsBtn');
  await page.waitForSelector('#prefs-modal.active');
  assert.ok(await page.evaluate(() => document.getElementById('menuSheet').hidden));
  assert.notEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'menuBtn');
  await closeAll(page);
  await page.waitForFunction(() => document.getElementById('bellBtn').style.display !== 'none');
  await openSheet();
  await page.click('#bellBtn');
  await page.waitForFunction(() => window.__perm === 1);
  assert.ok(await page.evaluate(() => document.getElementById('menuSheet').hidden));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menuBtn', 'no modal: focus returns to the menu button');

  // back to desktop width: the same buttons return to the header, in order
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.getElementById('themeBtn').parentElement.classList.contains('header-actions'));
  const order = await page.$$eval('.header-actions > button, .header-actions > a, .header-actions > div', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id || e.className));
  assert.deepEqual(order, ['easter-egg', 'langBtn', 'identity-greeting', 'bellBtn', 'feedbackBtn', 'prefsBtn', 'themeBtn']);
  assert.ok(!(await visible(page, '#menuBtn')));
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-TEXT: phone menu labels, short spoke labels and "What\'s new" are real text that Google Translate can rewrite', async () => {
  const gen = (page, sel, pseudo) => page.$eval(sel, (e, p) => getComputedStyle(e, p).content, pseudo);
  // phone: labels live in the sheet, visible when it is open; no CSS-generated words
  let h = await open({ width: 360 });
  await h.page.waitForFunction(() => document.getElementById('bellBtn').style.display !== 'none' && /\u{1F515}/u.test(document.getElementById('bellBtn').textContent));
  const phone = await h.page.evaluate(() => ['bellBtn', 'feedbackBtn', 'prefsBtn', 'themeBtn'].map((id) => {
    const b = document.getElementById(id);
    return [id, b.parentElement.id, b.textContent.replace(/\s+/g, ' ').trim()];
  }));
  assert.match(phone[0][2], /^\u{1F515}\s*Notifications$/u, 'bell: the push script\'s icon and the label both survive');
  assert.match(phone[1][2], /Feedback$/);
  assert.match(phone[2][2], /Settings$/);
  assert.match(phone[3][2], /Theme$/);
  assert.equal(await h.page.evaluate(() => document.getElementById('bellBtn').firstChild.nodeType), 3, 'the bell icon is still its first text node');
  for (const id of ['bellBtn', 'prefsBtn', 'themeBtn']) {
    assert.equal(await gen(h.page, '#' + id, '::before'), 'none', id + ': no CSS label');
    assert.equal(await gen(h.page, '#' + id, '::after'), 'none', id + ': no CSS label');
  }
  await h.page.click('#menuBtn');
  await h.page.waitForSelector('#menuSheet:not([hidden])');
  assert.ok(await visible(h.page, '#bellBtn .menu-lbl') && await visible(h.page, '#prefsBtn .menu-lbl') && await visible(h.page, '#themeBtn .menu-lbl'));
  assert.equal(await h.page.$eval('nav.arc .wheel-item[data-modal="defense-modal"] .w-short', (e) => e.textContent), 'Marches');
  await h.page.waitForFunction(() => getComputedStyle(document.getElementById('version-badge')).display !== 'none');
  assert.match(await h.page.$eval('#version-badge', (e) => e.textContent), /What's new/);
  assert.deepEqual(h.errs, []);
  await h.ctx.close();
  // desktop: the same buttons, labels hidden, the bell still shows only its icon
  h = await open({ width: 1280 });
  await h.page.waitForFunction(() => document.getElementById('bellBtn').style.display !== 'none' && /\u{1F515}/u.test(document.getElementById('bellBtn').textContent));
  assert.ok(!(await visible(h.page, '#bellBtn .menu-lbl')) && !(await visible(h.page, '#prefsBtn .menu-lbl')));
  assert.equal(await h.page.$eval('#bellBtn', (b) => b.innerText.trim()), '\u{1F515}');
  assert.ok(!(await visible(h.page, 'nav.arc .w-short')));
  assert.deepEqual(h.errs, []);
  await h.ctx.close();
});

// ── the next-up card ──
async function timerSecs(page) {
  return page.evaluate(() => ['nuD', 'nuH', 'nuM', 'nuS'].map((id) => document.getElementById(id).textContent))
    .then((p) => ((+p[0] * 24 + +p[1]) * 60 + +p[2]) * 60 + +p[3]);
}

test('HN-NEXT: signed up and placed, the big card shows the squad and a ticking countdown', async () => {
  st.tc = (sk) => (sk === TEX.siteKey ? TC_PLACED : TC_NONE);
  const { ctx, page, errs } = await open({ identity: TEX });
  await page.waitForSelector('#nextUp:not([hidden]) .nu-card:not([hidden])');
  assert.equal(await txt(page, '#nuEyebrow'), 'Titan Canyon week · Saturday, reset +2');
  assert.equal(await txt(page, '#nuTitle'), 'Your squad: DOG Squad A');
  assert.equal(await txt(page, '#nuSub'), 'Battle starts Saturday 2:00 PM your time');
  assert.equal(await page.getAttribute('#nuCta', 'href'), '/titan');
  assert.equal(await txt(page, '#nuCta'), 'See my squad');
  assert.ok(await page.evaluate(() => document.getElementById('nuStrip').hidden));
  const a = await timerSecs(page);
  const full = (BATTLE - NOW) / 1000;
  assert.ok(a <= full && a > full - 10, 'counts down to the battle: ' + a);
  await page.waitForTimeout(2200);
  const b = await timerSecs(page);
  assert.ok(b < a, 'the countdown ticks: ' + a + ' -> ' + b);
  assert.match(await page.getAttribute('#nuTimer', 'aria-label'), /^Battle starts in 2 days, (7|8) hours, \d+ minutes?$/);
  assert.equal(await page.getAttribute('#nuTimer', 'role'), 'timer');
  const q = st.calls.find((c) => c.path === '/titan/next-battle').q;
  assert.deepEqual(q, { siteKey: TEX.siteKey, name: 'Tex' });

  // a hidden tab stops the tick
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const c = await timerSecs(page);
  await page.waitForTimeout(2200);
  assert.equal(await timerSecs(page), c, 'no tick while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1300);
  assert.ok(await timerSecs(page) < c, 'ticks again when visible');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-NEXT: not signed up before signups close, a nudge with a Sign up link', async () => {
  st.tc = () => TC_NOT_SIGNED;
  const { ctx, page, errs } = await open({ identity: NEWBIE });
  await page.waitForSelector('#nextUp:not([hidden]) .nu-card:not([hidden])');
  assert.equal(await txt(page, '#nuEyebrow'), 'Titan Canyon this Saturday');
  assert.equal(await txt(page, '#nuTitle'), "You're not signed up yet");
  assert.equal(await txt(page, '#nuSub'), 'Signups close Thursday 4:00 PM your time');
  assert.equal(await page.getAttribute('#nuCta', 'href'), '/titan-signup');
  assert.equal(await txt(page, '#nuCta'), 'Sign up');
  await shot(page, '1280-nudge', { clip: { x: 0, y: 0, width: 1280, height: 620 } });
  const s = await timerSecs(page);
  assert.ok(s <= 10 * 3600 && s > 10 * 3600 - 10, 'counts to the close: ' + s);
  assert.match(await page.getAttribute('#nuTimer', 'aria-label'), /^Signups close in 0 days, (9|10) hours, \d+ minutes?$/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-NEXT: after signups close without a signup there is no TC card; during the battle hour it says so', async () => {
  st.tc = () => TC_NOT_SIGNED;
  let h = await open({ identity: NEWBIE, time: Date.parse(CLOSES) + 60e3 });
  await page_settle(h.page);
  assert.ok(await h.page.evaluate(() => document.getElementById('nextUp').hidden), 'no card after the close');
  await h.ctx.close();

  st.tc = () => TC_PLACED;
  h = await open({ identity: TEX, time: BATTLE + 10 * 60e3 });
  await h.page.waitForSelector('#nextUp:not([hidden]) .nu-card:not([hidden])');
  assert.equal(await txt(h.page, '#nuTitle'), 'Battle in progress');
  assert.equal(await txt(h.page, '#nuSub'), 'Your squad: DOG Squad A');
  assert.ok(!(await visible(h.page, '#nuTimer')), 'no countdown while the battle runs');
  assert.equal(await h.page.getAttribute('#nuCta', 'href'), '/titan');
  assert.deepEqual(h.errs, []);
  await h.ctx.close();
});

async function page_settle(page) {
  await page.waitForFunction(() => document.querySelector('#todayList .ev, #todayList .today-empty:not(.is-loading)'));
  await page.waitForTimeout(250);
}

test('HN-NEXT: a calendar event within 24 hours is a slim strip; nothing at all hides the card', async () => {
  st.cal = [ev('s1', 'Group buff window', ['Group Buffs'], NOW + 3 * H)];
  let h = await open({ identity: NEWBIE });
  await h.page.waitForSelector('#nextUp:not([hidden]) #nuStrip:not([hidden])');
  assert.ok(await h.page.evaluate(() => document.querySelector('.nu-card').hidden));
  assert.match(await txt(h.page, '#nuStrip'), /^Next up · Group buff window · in (3h 0m|2h 59m)$/);
  const box = await h.page.$eval('#nuStrip', (e) => e.getBoundingClientRect().height);
  await shot(h.page, '1280-strip', { clip: { x: 0, y: 0, width: 1280, height: 560 } });
  assert.ok(box <= 56, 'the strip is slim: ' + box);
  await h.page.click('#nuStrip');
  await h.page.waitForSelector('#cal-modal.active');
  assert.deepEqual(h.errs, []);
  await h.ctx.close();

  st.cal = [ev('s2', 'Tomorrow thing', ['Group Buffs'], NOW + 30 * H)];
  h = await open({ identity: NEWBIE });
  await page_settle(h.page);
  assert.ok(await h.page.evaluate(() => document.getElementById('nextUp').hidden), 'nothing within 24 h: hidden');
  // with no card the arc sits right under the chips
  const gap = await h.page.evaluate(() => document.querySelector('nav.arc').getBoundingClientRect().top - document.getElementById('bannerChips').getBoundingClientRect().bottom);
  assert.ok(gap < 40, 'arc close under the chips: ' + gap);
  await h.ctx.close();

  st.calls = [];
  h = await open({ identity: null });
  await page_settle(h.page);
  assert.equal(st.calls.filter((c) => c.path === '/titan/next-battle').length, 0, 'no identity: no TC lookup');
  assert.ok(await h.page.evaluate(() => document.getElementById('nextUp').hidden));
  await h.ctx.close();
});

test('HN-NEXT: with nothing to show the check runs once a minute, then shows up within that minute', async () => {
  st.cal = [ev('s3', 'Just over a day away', ['Group Buffs'], NOW + 24 * H + 30e3)];
  const { ctx, page, errs } = await open({ identity: NEWBIE });
  await page_settle(page);
  assert.ok(await page.evaluate(() => document.getElementById('nextUp').hidden));
  await page.clock.fastForward(31000);   // the event is now inside 24 h, but the idle (60 s) check hasn't come round
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.getElementById('nextUp').hidden), 'idle: no once-a-second tick');
  await page.clock.fastForward(31000);
  await page.waitForSelector('#nextUp:not([hidden]) #nuStrip:not([hidden])');
  assert.match(await txt(page, '#nuStrip'), /Just over a day away/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-NEXT: worker errors fall back to the strip or hide, never NaN, never throw', async () => {
  st.tcStatus = 500; st.calStatus = 500;
  let h = await open({ identity: TEX });
  await page_settle(h.page);
  assert.ok(await h.page.evaluate(() => document.getElementById('nextUp').hidden));
  assert.ok(!/NaN|undefined/.test(await h.page.evaluate(() => document.body.innerText)));
  assert.deepEqual(h.errs, []);
  await h.ctx.close();

  st.calStatus = 200; st.cal = [ev('s1', 'Group buff window', ['Group Buffs'], NOW + 2 * H)];
  h = await open({ identity: TEX });
  await h.page.waitForSelector('#nextUp:not([hidden]) #nuStrip:not([hidden])');
  assert.match(await txt(h.page, '#nuStrip'), /Group buff window/);
  assert.deepEqual(h.errs, []);
  await h.ctx.close();

  // a malformed body (battleAt without a squad, strings for numbers) never reaches the card as NaN
  st.tcStatus = 200; st.tc = () => ({ ok: true, week: WEEK, closesAt: 'soon', signedUp: 'yes', squad: null, slot: 'x', battleAt: 'tomorrow' });
  h = await open({ identity: TEX });
  await page_settle(h.page);
  assert.ok(!/NaN|undefined|null/.test(await h.page.evaluate(() => document.getElementById('nextUp').innerText)));
  assert.deepEqual(h.errs, []);
  await h.ctx.close();
});

test('HN-NEXT: switching identity in session updates the card, the Today list and the Leadership chip', async () => {
  st.tc = (sk) => (sk === TEX.siteKey ? TC_PLACED : TC_NOT_SIGNED);
  st.cal = CAL;
  const { ctx, page, errs } = await open({ identity: NEWBIE });
  await page.waitForFunction(() => document.getElementById('nuTitle').textContent === "You're not signed up yet");
  await page.waitForFunction(() => document.querySelectorAll('#todayList .ev').length === 3);
  assert.equal(await page.locator('#leadership-cta').count(), 0);
  const today = () => page.$$eval('#todayList .ev .ev-name', (e) => e.map((x) => x.textContent));

  // pick Tex from the identity picker (opened from the chip)
  await page.click('#identity-chip');
  await page.waitForSelector('#identity-modal.active');
  await page.fill('#identity-search', 'Tex');
  await page.locator('#identity-list .identity-item', { hasText: 'Tex' }).click();
  await page.waitForFunction(() => document.getElementById('nuTitle').textContent === 'Your squad: DOG Squad A');
  await page.waitForSelector('#leadership-cta');
  await page.waitForFunction(() => [...document.querySelectorAll('#todayList .ev-name')].some((e) => e.textContent === 'MSS meeting'));
  assert.equal(await txt(page, '#identity-name'), 'Tex');
  await closeAll(page);

  // switch to guest: no TC lookup for guests, the chip and the leadership link follow
  await page.click('#identity-chip');
  await page.waitForSelector('#identity-modal.active');
  await page.click('#identity-guest');
  await page.waitForFunction(() => !document.getElementById('leadership-cta'));
  await page.waitForFunction(() => document.getElementById('nextUp').hidden || !document.getElementById('nuStrip').hidden);
  // (innerText of a display:none element is its textContent, so read only what is shown)
  assert.ok(await page.evaluate(() => document.getElementById('nextUp').hidden || document.querySelector('.nu-card').hidden), 'no TC card for a guest');
  assert.deepEqual(await today(), [], 'a guest sees Eternal Land events only (none here)');
  assert.equal(await txt(page, '#identity-name'), 'Dingus');

  // reset from the chip's ✕ (desktop): anonymous, "Who are you?"
  await page.click('#identity-reset');
  await page.waitForSelector('#identity-set-link');
  assert.match(await txt(page, '#identity-set-link'), /Who are you\?/);
  assert.equal(await page.evaluate(() => localStorage.getItem('playerIdentity')), 'anonymous');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('HN-TODAY: the next three events for this player, as reset times, from the calendar\'s own expansion', async () => {
  st.cal = CAL;
  const { ctx, page, errs } = await open({ identity: NEWBIE });
  await page.waitForFunction(() => document.querySelectorAll('#todayList .ev').length === 3);
  const rows = await page.$$eval('#todayList .ev', (e) => e.map((r) => [r.querySelector('.ev-t').textContent, r.querySelector('.ev-name').textContent]));
  assert.deepEqual(rows, [['reset -1', 'Daily reset buff'], ['reset +2', 'Titan Canyon battle'], ['reset +6', 'Group buff window']]);
  assert.equal(await page.evaluate(() => typeof window.getUpcomingEvents), 'function');
  // the same function the calendar modal fills from: the modal's Today view lists the recurring event too
  await page.click('.today-link');
  await page.waitForSelector('#cal-modal.active');
  await page.waitForFunction(() => /Daily reset buff/.test(document.getElementById('cal-events').textContent));
  assert.deepEqual(errs, []);
  await ctx.close();
});

// ── chips row ──
test('HN-CHIPS: the version badge and the Leadership chip sit in a row under the banner', async () => {
  const { ctx, page, errs } = await open({ identity: TEX });
  await page.waitForSelector('#leadership-cta');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('version-badge')).display !== 'none');
  const g = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const b = r('banner-img'), v = r('version-badge'), l = r('leadership-cta');
    return { parentV: document.getElementById('version-badge').parentElement.id, parentL: document.getElementById('leadership-cta').parentElement.id,
      below: v.top >= b.bottom && l.top >= b.bottom, row: Math.abs(v.top - l.top) < 2, leftRight: v.right < l.left,
      text: document.getElementById('version-badge').textContent, after: getComputedStyle(document.querySelector('#version-badge .vb-label'), '::after').content, sync: typeof window.syncLeadershipCta };
  });
  assert.match(g.text, /^v\d+\.\d+\.\d+· What's new$/, 'the badge text is real text');
  delete g.text;
  assert.deepEqual(g, { parentV: 'bannerChips', parentL: 'bannerChips', below: true, row: true, leftRight: true, after: 'none', sync: 'function' });
  assert.equal((await page.innerText('#leadership-cta')).trim(), 'Leadership');
  assert.deepEqual(errs, []);
  await ctx.close();
});

// ── accessibility ──
test('HN-A11Y: spokes are reachable by Tab in arc order with a visible focus ring; the arc is labelled; phones get short labels', async () => {
  const { ctx, page, errs } = await open();
  assert.equal(await page.getAttribute('nav.arc', 'aria-label'), 'Main');
  const seen = [];
  for (let i = 0; i < 80 && seen.length < 7; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.classList.contains('wheel-item') || !a.closest('nav.arc')) return null;
      const cs = getComputedStyle(a);
      return { label: a.getAttribute('aria-label'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    if (f) seen.push(f);
  }
  assert.deepEqual(seen.map((f) => f.label), (await page.$eval('#wheelEventSpoke', (a) => a.getAttribute('aria-label'))) === 'SvS' ? SPOKES_FULL.map((x) => (x === 'Titan Canyon' ? 'SvS' : x)) : SPOKES_FULL);
  for (const f of seen) assert.ok(f.style !== 'none' && f.width >= 2, 'focus ring on ' + f.label);
  // bars and the card link show a ring too
  await page.focus('#heartRosterBtn');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  assert.notEqual(await page.$eval('#heartRosterBtn', (a) => getComputedStyle(a).outlineStyle), 'none');
  assert.deepEqual(errs, []);
  await ctx.close();

  const ph = await open({ width: 360, time: SVS_UNTIL + H });
  const labels = await ph.page.$$eval('nav.arc .wheel-item', (as) => as.map((a) => [a.getAttribute('aria-label'),
    getComputedStyle(a.querySelector('.w-short')).display !== 'none' && getComputedStyle(a.querySelector('.w-label')).display === 'none' ? a.querySelector('.w-short').textContent : 'not shown']));
  assert.deepEqual(labels, SPOKES_FULL.map((f, i) => [f, SPOKES_SHORT[i]]));
  await ph.ctx.close();
});

test('HN-RM: reduced motion stops the hub, burger, ring, popcorn, footer shimmer and the Leadership glow', async () => {
  const names = (page) => page.evaluate(() => {
    const an = (sel, pseudo) => { const el = document.querySelector(sel); return el ? getComputedStyle(el, pseudo || null).animationName : 'missing'; };
    return { hub: an('nav.arc .wheel-center'), egg: an('header .easter-egg'), ring: an('nav.arc .arc-ring', '::before'), pop: an('#rc-wrap .rc-icon'), shimmer: an('.site-footer .shimmer-text'), lead: an('#leadership-cta') };
  });
  let h = await open({ identity: TEX });
  await h.page.waitForSelector('#leadership-cta');
  const on = await names(h.page);
  assert.equal(on.ring, 'ring-color-shift');
  assert.match(on.hub, /center-shimmer/);
  assert.equal(on.egg, 'egg-pulse');
  await h.ctx.close();
  h = await open({ identity: TEX, reduced: true });
  await h.page.waitForSelector('#leadership-cta');
  assert.equal(await h.page.getAttribute('html', 'data-reduced-motion'), 'true');
  assert.deepEqual(await names(h.page), { hub: 'none', egg: 'none', ring: 'none', pop: 'none', shimmer: 'none', lead: 'none' });
  assert.deepEqual(h.errs, []);
  await h.ctx.close();
});
