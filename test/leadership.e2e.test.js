'use strict';
// leadership.html + the homepage Leadership chip. Static server + a routed fake worker with in-memory state.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/leadership.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const W = 'https://push-worker.27tb8s6fct.workers.dev';
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.LD_SHOTS || null;
const FILES = {
  '/leadership.html': [path.join(ROOT, 'pages', 'leadership.html'), 'text/html'],
  '/index.html': [path.join(ROOT, 'pages', 'index.html'), 'text/html'],
  '/rotation.html': [path.join(ROOT, 'pages', 'rotation.html'), 'text/html'],
  '/rotation-admin.html': [path.join(ROOT, 'pages', 'rotation-admin.html'), 'text/html'],
  '/player-data.json': [path.join(__dirname, 'fixtures', 'leadership', 'player-data.json'), 'application/json'],
};
const EVIL = '<img src=x onerror=window.__pwned=1>';
let server, base, origin, browser, st, calls;

const LINKS = [
  { group: 'Editors', items: [1, 2, 3, 4, 5].map((n) => ({ title: 'Editor ' + n, url: 'https://2864tw.com/push-admin.html?n=' + n, desc: 'Edit thing ' + n })) },
  { group: 'Leadership views', items: [1, 2, 3, 4].map((n) => ({ title: 'View ' + n, url: 'https://2864tw.com/secret-view-' + n + '.html', desc: 'See thing ' + n })) },
];
const idea = (id, title, status, votes, createdAt, extra) => Object.assign({ id, title, details: 'Details for ' + title, status, authorName: 'Gary', mine: false, createdAt, updatedAt: createdAt, version: 1, votes, myVote: false, comments: [] }, extra || {});

function fresh(role) {
  const now = Date.now();
  return {
    uid: '1234567890123', signinError: null,
    me: { siteKey: 'aaaaaaaaaaaaaaaa', name: 'Tex', alliance: 'DOG', rank: 5, role: role || 'member' },
    ideas: [
      idea('i1', 'MM of the week recognition', 'new', 1, now - 3 * 3600e3, { mine: true }),
      idea('i2', 'Set aside a share of final rewards for MMs only', 'discussing', 4, now - 86400e3),
      idea('i3', 'Publish reward scope and requirements before the main event starts', 'new', 3, now - 2 * 86400e3),
      idea('i4', 'Score leaderboard for tracking (gamify)', 'planned', 0, now - 5 * 86400e3, { comments: [{ id: 11, authorName: 'Gary', text: 'Good one', createdAt: now - 3600e3, mine: false }] }),
    ],
    nextId: 10, over: {},
  };
}

test.before(async () => {
  server = http.createServer((req, res) => {
    const f = FILES[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f[1] }); res.end(fs.readFileSync(f[0]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  base = origin + '/leadership.html';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { st = fresh(); calls = []; });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const find = (id) => st.ideas.find((x) => x.id === id);
async function route(rt) {
  const req = rt.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
  const fulfil = (status, body) => rt.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return rt.fulfill({ status: 204, headers: CORS });
  let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { /* none */ }
  calls.push({ method: m, path: p, body, auth: req.headers()['authorization'] || null });
  if (st.over[p]) { const o = st.over[p](body, m); if (o) return fulfil(o[0], o[1]); }
  if (p === '/lead/handshake') {
    if (st.signinError) return fulfil(st.signinError.status, { error: st.signinError.error });
    return fulfil(200, { token: 'tok' + calls.length, expires: Date.now() + 3600e3, me: st.me });
  }
  if (p === '/lead/home') return fulfil(200, { me: st.me, links: LINKS, statuses: ['new', 'discussing', 'planned', 'done', 'parked'], ideas: st.ideas });
  if (p === '/lead/idea') {
    const e = body.idea;
    if (e.id) {
      const cur = find(e.id);
      if (!cur) return fulfil(404, { error: 'not_found' });
      if (body.version !== cur.version) return fulfil(409, { error: 'conflict', idea: cur });
      Object.assign(cur, { title: e.title, details: e.details, version: cur.version + 1 });
      return fulfil(200, { idea: cur });
    }
    const n = idea('n' + st.nextId++, e.title, 'new', 0, Date.now(), { mine: true, authorName: st.me.name, details: e.details });
    st.ideas.push(n); return fulfil(200, { idea: n });
  }
  if (p === '/lead/idea/status') {
    const cur = find(body.id);
    if (st.me.role !== 'lead') return fulfil(403, { error: 'leads_only' });
    if (body.version !== cur.version) return fulfil(409, { error: 'conflict', idea: cur });
    cur.status = body.status; cur.version++; return fulfil(200, { idea: cur });
  }
  if (p === '/lead/idea/vote') {
    const cur = find(body.id); if (!cur) return fulfil(404, { error: 'not_found' });
    if (body.vote && !cur.myVote) cur.votes++; if (!body.vote && cur.myVote) cur.votes--; cur.myVote = body.vote;
    return fulfil(200, { idea: cur });
  }
  if (p === '/lead/idea/comment') {
    const cur = find(body.id); cur.comments.push({ id: st.nextId++, authorName: st.me.name, text: body.text, createdAt: Date.now(), mine: true });
    return fulfil(200, { idea: cur });
  }
  if (p === '/lead/comment/delete') {
    const cur = st.ideas.find((x) => x.comments.some((c) => c.id === body.id));
    cur.comments = cur.comments.filter((c) => c.id !== body.id); return fulfil(200, { idea: cur });
  }
  if (p === '/lead/idea/delete') {
    const cur = find(body.id);
    if (body.version !== cur.version) return fulfil(409, { error: 'conflict', idea: cur });
    st.ideas = st.ideas.filter((x) => x.id !== body.id); return fulfil(200, { ok: true });
  }
  return fulfil(404, { error: 'nope' });
}

async function open({ signedIn = true, width = 1280, role } = {}) {
  if (role) st = fresh(role);
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await ctx.route(W + '/**', route);
  if (signedIn) await ctx.addInitScript(() => { try { if (!localStorage.getItem('ld_pass_v1')) localStorage.setItem('ld_pass_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })); } catch (e) { /* none */ } });
  await page.goto(base);
  if (signedIn) await page.waitForSelector('#ld-chip:not([hidden])');
  return { ctx, page, errs };
}
const last = (p) => calls.filter((c) => c.path === p).pop();
const card = (page, id) => page.locator('.ld-idea[data-id="' + id + '"], .idea[data-id="' + id + '"]');

test('LD-SIGNIN: errors, then success shows the chip and stores a pass without the UID', async () => {
  const { ctx, page, errs } = await open({ signedIn: false });
  const tryUid = async (uid) => { await page.fill('#ld-uid', uid); await page.click('#ld-signin-go'); };
  const cases = [['not_leadership', 403, /DOG and MSS R4s, R5s and appointed officers/], ['not_on_roster', 403, /isn't on the Server 2864 roster/],
    ['locked', 429, /Too many tries/], ['rate_limited', 429, /Too many tries/], ['uid_required', 400, /numbers only/]];
  for (const [error, status, re] of cases) {
    st.signinError = { status, error };
    await tryUid('1234-567 890123');
    await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('ld-signin-err').innerText), re.source);
  }
  assert.equal(last('/lead/handshake').body.uid, '1234567890123', 'non-digits stripped');
  st.signinError = null;
  await tryUid('1234567890123');
  await page.waitForSelector('#ld-chip:not([hidden])');
  assert.match(await page.innerText('#ld-chip'), /Tex · R5 · DOG/);
  const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  assert.ok(!stored.includes('1234567890123'), 'UID not stored');
  const v = await page.evaluate(() => JSON.parse(localStorage.getItem('ld_pass_v1')));
  assert.ok(v.token && v.expires);
  assert.ok(await page.isVisible('#ld-signout'));
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('LD-SIGNIN: the UID is prefilled from the armory ID', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); await ctx.route(W + '/**', route);
  await ctx.addInitScript(() => { localStorage.setItem('playerIdentity', JSON.stringify({ siteKey: 'aaaaaaaaaaaaaaaa' })); localStorage.setItem('armory_uid_aaaaaaaaaaaaaaaa', '1234567890123'); });
  await page.goto(base);
  assert.equal(await page.inputValue('#ld-uid'), '1234567890123');
  await ctx.close();
});

test('LD-ACCESS: a 403 on home drops the pass and shows the sign-in with the message', async () => {
  st.over['/lead/home'] = () => [403, { error: 'not_leadership' }];
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await ctx.route(W + '/**', route);
  await ctx.addInitScript(() => localStorage.setItem('ld_pass_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })));
  await page.goto(base);
  await page.waitForFunction(() => /DOG and MSS R4s/.test(document.getElementById('ld-signin-err').innerText));
  assert.equal(await page.evaluate(() => localStorage.getItem('ld_pass_v1')), null);
  assert.ok(await page.isVisible('#ld-signin'));
  await ctx.close();
});

test('LD-LINKS: 9 links in 2 groups, none of their URLs in the raw page', async () => {
  const raw = fs.readFileSync(FILES['/leadership.html'][0], 'utf8');
  for (const w of ['push-admin.html', 'titan-admin', 'transfer-admin', 'learn-admin', 'secret-view']) assert.ok(!raw.includes(w), w + ' must not be in the page source');
  const { ctx, page } = await open();
  assert.equal(await page.locator('#ld-links h3').count(), 2);
  assert.equal(await page.locator('#ld-links a').count(), 9);
  assert.deepEqual(await page.locator('#ld-links h3').allTextContents(), ['Editors', 'Leadership views']);
  const a = page.locator('#ld-links a').first();
  assert.equal(await a.getAttribute('target'), '_blank');
  assert.match(await a.getAttribute('rel'), /noopener/);
  assert.match(await page.innerText('#ld-app'), /Each page still asks for its own password\./);
  assert.match(await page.innerText('#ld-app'), /Seal Stone Chaos planning ideas/);
  await ctx.close();
});

test('LD-ADD: counters show, the idea lands under New, and the list order is status, votes, newest', async () => {
  const { ctx, page } = await open();
  const order = await page.locator('.ld-idea .ttl, .idea .ttl').allInnerTexts();
  assert.deepEqual(order, ['Publish reward scope and requirements before the main event starts', 'MM of the week recognition', 'Set aside a share of final rewards for MMs only', 'Score leaderboard for tracking (gamify)']);
  assert.match(await page.innerText('.chips'), /All 4/);
  assert.equal(await page.locator('#ld-addbox').isVisible(), false, 'form starts collapsed');
  await page.click('#ld-new');
  assert.equal(await page.locator('#ld-addbox').isVisible(), true);
  await page.fill('#ld-title', 'Rally calendar');
  await page.fill('#ld-details', 'line one\nline two');
  assert.equal((await page.innerText('#ld-title-count')).trim(), '14 / 120');
  assert.equal((await page.innerText('#ld-details-count')).trim(), '17 / 2000');
  await page.click('#ld-add');
  await page.waitForSelector('text=Rally calendar');
  assert.equal(last('/lead/idea').body.idea.title, 'Rally calendar');
  assert.equal(await page.inputValue('#ld-title'), '');
  assert.equal(await page.locator('#ld-addbox').isVisible(), false, 'collapses after add');
  const c = card(page, 'n10');
  assert.match(await c.innerText(), /new/i);
  assert.match(await c.innerText(), /by Tex/);
  assert.match(await page.innerText('.chips'), /New 3/);
  await page.click('.chips button[data-status="planned"]');
  assert.equal(await page.locator('.idea').count(), 1);
  await ctx.close();
});

test('LD-VOTE: Support toggles on and off', async () => {
  const { ctx, page } = await open();
  const v = card(page, 'i2').locator('.ld-vote');
  assert.equal((await v.innerText()).trim(), 'Support');
  assert.equal(await card(page, 'i2').locator('.ld-votes').innerText(), '4 leaders support this');
  await v.click();
  await page.waitForFunction(() => /^Supported/.test(document.querySelector('.idea[data-id="i2"] .ld-vote').innerText.trim()));
  assert.equal(await card(page, 'i2').locator('.ld-vote').getAttribute('aria-pressed'), 'true');
  assert.equal(await card(page, 'i2').locator('.ld-votes').innerText(), '5 leaders support this');
  assert.equal(last('/lead/idea/vote').body.vote, true);
  await card(page, 'i2').locator('.ld-vote').click();
  await page.waitForFunction(() => document.querySelector('.idea[data-id="i2"] .ld-vote').innerText.trim() === 'Support');
  assert.equal(await card(page, 'i2').locator('.ld-vote').getAttribute('aria-pressed'), 'false');
  assert.equal(last('/lead/idea/vote').body.vote, false);
  await ctx.close();
});

test('LD-VOTE: zero support wording, one leader, and the Comment label with no comments', async () => {
  st.ideas.push(idea('z0', 'Zero idea', 'new', 0, Date.now()));
  const { ctx, page } = await open();
  const c = card(page, 'z0');
  assert.equal(await c.locator('.ld-votes').innerText(), 'No support yet');
  assert.equal((await c.locator('.ld-ctoggle').innerText()).trim(), 'Comment');
  await c.locator('.ld-vote').click();
  await page.waitForFunction(() => document.querySelector('.idea[data-id="z0"] .ld-votes').innerText === '1 leader supports this');
  await card(page, 'z0').locator('.ld-ctoggle').click();
  assert.equal((await card(page, 'z0').locator('.ld-ctoggle').innerText()).trim(), 'Hide comments');
  assert.match(await card(page, 'z0').innerText(), /No comments yet\./);
  await ctx.close();
});

test('LD-COMMENT: add a comment, then remove your own', async () => {
  const { ctx, page } = await open();
  const c = card(page, 'i4');
  assert.match(await c.locator('.ld-ctoggle').innerText(), /1 comment/);
  await c.locator('.ld-ctoggle').click();
  assert.match(await c.locator('.ld-ctoggle').innerText(), /Hide comments/);
  assert.equal(await c.locator('.ld-cdel').count(), 0, 'a member cannot remove someone else\'s comment');
  await c.locator('.ld-ctext').fill('Count me in');
  await c.locator('.ld-cadd').click();
  await page.waitForSelector('text=Count me in');
  assert.deepEqual({ ...last('/lead/idea/comment').body }, { id: 'i4', text: 'Count me in' });
  assert.match(await card(page, 'i4').locator('.ld-ctoggle').innerText(), /2 comments|Hide comments/);
  await card(page, 'i4').locator('.cm', { hasText: 'Count me in' }).locator('.ld-cdel').click();
  await page.waitForFunction(() => !/Count me in/.test(document.body.innerText));
  assert.equal(typeof last('/lead/comment/delete').body.id, 'number');
  await ctx.close();
});

test('LD-LEAD: a member sees no status select; a lead changes status with the version', async () => {
  let o = await open();
  assert.equal(await o.page.locator('select.ld-status').count(), 0);
  assert.equal(await card(o.page, 'i2').locator('.ld-edit').count(), 0, 'not the author');
  assert.equal(await card(o.page, 'i1').locator('.ld-edit').count(), 1, 'own idea');
  await o.ctx.close();
  o = await open({ role: 'lead' });
  assert.match(await o.page.innerText('#ld-chip'), /lead/i);
  assert.equal(await o.page.locator('select.ld-status').count(), 4);
  await card(o.page, 'i2').locator('select.ld-status').selectOption('planned');
  await o.page.waitForFunction(() => document.querySelector('.idea[data-id="i2"]').dataset.status === 'planned');
  assert.deepEqual(last('/lead/idea/status').body, { id: 'i2', status: 'planned', version: 1 });
  assert.equal(await card(o.page, 'i2').locator('.ld-edit').count(), 1, 'leads can edit anything');
  await o.ctx.close();
});

test('LD-EDIT: edit and remove an own idea', async () => {
  const { ctx, page } = await open();
  const c = card(page, 'i1');
  await c.locator('.ld-edit').click();
  await c.locator('.ld-etitle').fill('MM of the week');
  await c.locator('.ld-esave').click();
  await page.waitForSelector('.idea .ttl:text-is("MM of the week")');
  assert.equal(last('/lead/idea').body.version, 1);
  await card(page, 'i1').locator('.ld-remove').click();
  await page.waitForFunction(() => !document.querySelector('.idea[data-id="i1"]'));
  assert.deepEqual(last('/lead/idea/delete').body, { id: 'i1', version: 2 });
  await ctx.close();
});

test('LD-CONFLICT: a 409 keeps the text and offers Load latest', async () => {
  const { ctx, page } = await open();
  const c = card(page, 'i1');
  await c.locator('.ld-edit').click();
  await c.locator('.ld-etitle').fill('My careful rewrite');
  Object.assign(find('i1'), { title: 'Their rewrite', version: 5 });
  await c.locator('.ld-esave').click();
  await page.waitForSelector('.ld-conflict');
  assert.match(await page.innerText('.ld-conflict'), /Someone else changed this/);
  assert.match(await page.innerText('.ld-conflict'), /Their rewrite/);
  assert.equal(await card(page, 'i1').locator('.ld-etitle').inputValue(), 'My careful rewrite');
  await card(page, 'i1').locator('.ld-reload').click();
  await page.waitForFunction(() => !document.querySelector('.ld-conflict'));
  assert.equal(await card(page, 'i1').locator('.ld-etitle').inputValue(), 'My careful rewrite', 'text kept after loading latest');
  await card(page, 'i1').locator('.ld-esave').click();
  await page.waitForSelector('.idea .ttl:text-is("My careful rewrite")');
  assert.equal(last('/lead/idea').body.version, 5);
  await ctx.close();
});

test('LD-EXPIRED: a 401 brings the sign-in overlay and the text is kept', async () => {
  const { ctx, page } = await open();
  st.over['/lead/idea'] = () => [401, { error: 'signed_out' }];
  await page.click('#ld-new');
  await page.fill('#ld-title', 'Keep me');
  await page.fill('#ld-details', 'Please keep this');
  await page.click('#ld-add');
  await page.waitForSelector('#ld-signin.overlay:not([hidden])');
  assert.equal(await page.inputValue('#ld-title'), 'Keep me');
  assert.equal(await page.inputValue('#ld-details'), 'Please keep this');
  delete st.over['/lead/idea'];
  await page.fill('#ld-uid', '1234567890123'); await page.click('#ld-signin-go');
  await page.waitForSelector('#ld-signin', { state: 'hidden' });
  assert.equal(await page.inputValue('#ld-title'), 'Keep me');
  await ctx.close();
});

test('LD-DOWN: 5xx on home shows Try again, keeps the pass, and recovers', async () => {
  st.over['/lead/home'] = () => [503, { error: 'x' }];
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await ctx.route(W + '/**', route);
  await ctx.addInitScript(() => localStorage.setItem('ld_pass_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })));
  await page.goto(base);
  await page.waitForSelector('#ld-down:not([hidden])');
  assert.match(await page.innerText('#ld-down'), /Can't reach the leadership page right now/);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('ld_pass_v1')));
  delete st.over['/lead/home'];
  await page.click('#ld-down-retry');
  await page.waitForSelector('#ld-chip:not([hidden])');
  await ctx.close();
});

test('LD-XSS: hostile title, details, comment and author names stay inert', async () => {
  st.ideas.push(idea('x1', EVIL, 'new', 9, Date.now(), { details: EVIL, authorName: EVIL, comments: [{ id: 99, authorName: EVIL, text: EVIL, createdAt: Date.now(), mine: false }] }));
  st.me.name = EVIL;
  const { ctx, page } = await open();
  await card(page, 'x1').locator('.ld-ctoggle').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#ld-app img').count(), 0);
  assert.equal(await page.locator('#ld-chip img').count(), 0);
  assert.ok((await page.innerText('.idea[data-id="x1"]')).includes(EVIL));
  await ctx.close();
});

test('LD-MOBILE: 360 px has no horizontal scroll and the screenshots are saved', async () => {
  st = fresh('lead');
  st.ideas.push(idea('long', 'A'.repeat(110), 'new', 2, Date.now(), { details: 'B'.repeat(300), authorName: 'C'.repeat(40), comments: [{ id: 98, authorName: 'D', text: 'E'.repeat(200), createdAt: Date.now(), mine: true }] }));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const [name, width] of [['desktop', 1280], ['mobile', 360]]) {
    const { ctx, page } = await open({ width });
    await card(page, 'long').locator('.ld-ctoggle').click();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, name + ' horizontal overflow ' + over);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, a.ld-link, select, input')).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).map((e) => e.className || e.id));
    assert.deepEqual(small, [], name + ' tap targets under 44px');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'task-3-leadership-' + name + '.png'), fullPage: true });
    await ctx.close();
  }
});

test('ROTATION-NOTICE: both retired pages are the plain notice with a strict policy and no scripts', async () => {
  for (const f of ['rotation.html', 'rotation-admin.html']) {
    const raw = fs.readFileSync(FILES['/' + f][0], 'utf8');
    assert.ok(raw.includes("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"), f + ' csp');
    assert.ok(!/<script/i.test(raw), f + ' has no scripts');
    assert.ok(raw.includes('<title>Rotations · Server 2864</title>'));
    assert.ok(raw.includes('Rotations are retired for now'));
    assert.ok(raw.includes('Check with your alliance leaders for the current plan.'));
    assert.ok(raw.includes('Back to 2864tw.com'));
  }
});

// ── homepage chip ──
async function homePage(identity, rosterStatus) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await ctx.route((u) => u.origin !== origin, (rt) => rt.abort());
  await ctx.route(origin + '/player-data.json', (rt) => (rosterStatus ? rt.fulfill({ status: rosterStatus, body: 'nope' }) : rt.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: fs.readFileSync(FILES['/player-data.json'][0]) })));
  await ctx.route((u) => u.origin === origin && !/\/(index\.html|player-data\.json)$/.test(u.pathname), (rt) => rt.fulfill({ status: 404, body: '' }));
  if (identity !== undefined) await ctx.addInitScript((v) => { localStorage.setItem('playerIdentity', v); }, typeof identity === 'string' ? identity : JSON.stringify(identity));
  await page.goto(origin + '/index.html');
  await page.waitForTimeout(1200);
  return { ctx, page, errs };
}
const chipCount = (page) => page.evaluate(() => document.querySelectorAll('#leadership-cta').length);

test('HOME-CHIP: the Leadership chip shows for a DOG R4, and nothing else does', async () => {
  const dog = await homePage({ siteKey: 'aaaaaaaaaaaaaaaa', name: 'Tex' });
  assert.equal(await chipCount(dog.page), 1);
  const a = dog.page.locator('#leadership-cta');
  assert.equal((await a.innerText()).trim(), 'Leadership');
  assert.equal(await a.getAttribute('href'), 'leadership');
  assert.equal(await dog.page.locator('#rotations-cta').count(), 0);
  const html = await dog.page.content();
  assert.ok(!/rotation\.html/.test(html), 'no rotation.html link left on the homepage');
  assert.deepEqual(dog.errs.filter((e) => /leadership|roster/i.test(e)), [], 'the chip code never throws');
  await dog.ctx.close();
  const mss = await homePage({ siteKey: 'dddddddddddddddd', name: 'Willow' });
  assert.equal(await chipCount(mss.page), 1, 'MSS in any letter case');
  await mss.ctx.close();
  const cases = [['Cat+ R5', { siteKey: 'bbbbbbbbbbbbbbbb' }], ['DOG R3', { siteKey: 'cccccccccccccccc' }], ['guest', { guest: true, siteKey: 'aaaaaaaaaaaaaaaa', name: 'x' }],
    ['not on the roster', { siteKey: 'ffffffffffffffff' }], ['anonymous', 'anonymous'], ['no identity', undefined]];
  for (const [name, id] of cases) {
    const h = await homePage(id);
    assert.equal(await chipCount(h.page), 0, name);
    assert.equal(await h.page.locator('#rotations-cta').count(), 0, name + ' rotations');
    await h.ctx.close();
  }
  const down = await homePage({ siteKey: 'aaaaaaaaaaaaaaaa', name: 'Tex' }, 500);
  assert.equal(await chipCount(down.page), 0, 'roster fetch 500 fails closed');
  assert.deepEqual(down.errs.filter((e) => /leadership|roster/i.test(e)), [], 'a failed roster fetch never throws');
  await down.ctx.close();
});

test('HOME-CHIP: identity changes in session add and remove the chip without a reload', async () => {
  const h = await homePage({ siteKey: 'cccccccccccccccc', name: 'Newbie' });
  assert.equal(await chipCount(h.page), 0);
  await h.page.evaluate(() => { localStorage.setItem('playerIdentity', JSON.stringify({ siteKey: 'aaaaaaaaaaaaaaaa', name: 'Tex' })); return window.syncLeadershipCta(); });
  await h.page.waitForFunction(() => document.querySelectorAll('#leadership-cta').length === 1);
  await h.page.evaluate(() => { localStorage.setItem('playerIdentity', 'anonymous'); return window.syncLeadershipCta(); });
  await h.page.waitForFunction(() => document.querySelectorAll('#leadership-cta').length === 0);
  assert.equal(typeof await h.page.evaluate(() => window.syncRotationsCta), 'undefined');
  await h.ctx.close();
});
