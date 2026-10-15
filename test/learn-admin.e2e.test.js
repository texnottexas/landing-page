'use strict';
// learning-lounge-mentors.html: the mentor editor. Static server + a routed fake worker with in-memory state.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/learning-lounge-mentors.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const W = 'https://push-worker.27tb8s6fct.workers.dev';
const ROOT = path.join(__dirname, '..');
const FILES = {
  '/learning-lounge-mentors.html': [path.join(ROOT, 'pages', 'learning-lounge-mentors.html'), 'text/html'],
  '/lounge-core.js': [path.join(ROOT, 'lounge-core.js'), 'text/javascript'],
  '/player-data.json': [path.join(__dirname, 'fixtures', 'lounge', 'mentors', 'player-data.json'), 'application/json'],
};
const EVIL = '<img src=x onerror=window.__pwned=1>';
let server, base, browser, st, calls;

function fresh() {
  const me = { siteKey: 'aaaaaaaaaaaaaaaa', name: 'Lady🐞', alliance: 'DOG', rank: 4, role: 'mentor', notify: 1 };
  return {
    uid: '1234567890123', needPass: false, signinError: null, me,
    cats: [{ id: 'armory', name: 'Armory', blurb: 'Your report', sort: 1 }, { id: 'events', name: 'Events', blurb: 'Signups', sort: 2 }],
    entries: [
      { id: 'q-armory-what', question: 'What is the armory?', answer: 'Your **report**.', category_id: 'armory', alternates: ['armoury page'], keywords: ['report'], status: 'published', helpfulYes: 3, helpfulNo: 1, version: 1, updatedByName: 'Tex', updatedAt: Date.now() - 3 * 3600e3, createdByName: 'Tex', createdAt: 1 },
      { id: 'q-ht-what', question: 'What is a Heavy Trooper?', answer: 'A big unit.', category_id: 'events', alternates: [], keywords: ['ht'], status: 'draft', helpfulYes: 0, helpfulNo: 0, version: 1, updatedByName: 'Tex', updatedAt: Date.now() - 86400e3, createdByName: 'Tex', createdAt: 1 },
    ],
    groups: [['ht', 'heavy trooper', 'mecha']], synVersion: 1,
    asks: [{ id: 'ask1', question: 'How do I join the alliance?', name: 'Newbie', status: 'open', createdAt: Date.now() - 600e3 }],
    misses: [{ q: 'armoury', sample: 'armoury', count: 4, firstAt: 1, lastAt: Date.now() - 7200e3 }],
    mentors: [{ siteKey: 'aaaaaaaaaaaaaaaa', name: 'Lady🐞', alliance: 'DOG', rank: 4, role: 'mentor', appointed: false, notify: 1, blocked: false },
      { siteKey: 'zzzzzzzzzzzzzzzz', name: 'Gary', alliance: 'MSS', rank: 5, role: 'lead', appointed: false, notify: 0, blocked: false },
      { siteKey: 'yyyyyyyyyyyyyyyy', name: 'Samyaza', alliance: 'DOG', rank: 2, role: 'mentor', appointed: true, notify: 0, blocked: false }],
    changelog: [{ id: 5, at: Date.now() - 3600e3, actorName: 'Tex', action: 'entry', target: 'entry:q-armory-what', summary: 'Edited armory answer' }],
    older: [{ id: 4, at: Date.now() - 7200e3, actorName: 'Gary', action: 'category', target: 'category:armory', summary: 'Renamed chapter' }],
    saveAnswers: [], nextVersion: 2,
  };
}

test.before(async () => {
  server = http.createServer((req, res) => {
    const f = FILES[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f[1] }); res.end(fs.readFileSync(f[0]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/learning-lounge-mentors.html';
  browser = await chromium.launch({ channel: 'chrome' });
});
test.after(async () => { await browser.close(); server.close(); });
test.beforeEach(() => { st = fresh(); calls = []; });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
function admin() {
  return { me: st.me, entries: st.entries, categories: st.cats, synonyms: { groups: st.groups, version: st.synVersion }, asks: st.asks, misses: st.misses,
    mentors: st.mentors, changelog: st.changelog, limits: { entries: 500, alternates: 25, keywords: 25, answer: 5000, question: 200 } };
}
async function route(route) {
  const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
  const fulfil = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { /* none */ }
  calls.push({ method: m, path: p, search: u.search, body, auth: req.headers()['authorization'] || null });
  if (st.over && st.over[p]) { const o = st.over[p](body, m); if (o) return fulfil(o[0], o[1]); }
  if (p === '/lounge/handshake') {
    if (st.signinError) return fulfil(st.signinError.status, { error: st.signinError.error });
    if (st.needPass && body.passphrase !== 'opensesame') return fulfil(403, { error: 'passphrase' });
    return fulfil(200, { token: 'tok' + calls.length, expires: Date.now() + 3600e3, me: st.me });
  }
  if (p === '/lounge/admin') return fulfil(200, admin());
  if (p === '/lounge/entry') {
    if (st.saveAnswers.length) { const a = st.saveAnswers.shift(); return fulfil(a.status, a.body); }
    const e = body.entry; let cur = e.id && st.entries.find((x) => x.id === e.id);
    if (cur) { Object.assign(cur, e, { version: cur.version + 1, updatedByName: 'Lady🐞', updatedAt: Date.now() }); }
    else { cur = { ...e, id: 'q-new-' + st.entries.length, helpfulYes: 0, helpfulNo: 0, version: 1, updatedByName: 'Lady🐞', updatedAt: Date.now(), createdByName: 'Lady🐞', createdAt: Date.now() }; st.entries.push(cur); }
    return fulfil(200, { entry: cur });
  }
  if (p === '/lounge/entry/status') { const cur = st.entries.find((x) => x.id === body.id); cur.status = body.status; cur.version++; return fulfil(200, { entry: cur }); }
  if (p === '/lounge/ask/resolve') { st.asks = st.asks.filter((a) => a.id !== body.id); return fulfil(200, { ok: true }); }
  if (p === '/lounge/miss/resolve') { st.misses = st.misses.filter((x) => x.q !== body.q); return fulfil(200, { ok: true, attached: body.action === 'attach' }); }
  if (p === '/lounge/synonyms') { st.groups = body.groups; st.synVersion++; return fulfil(200, { synonyms: { groups: st.groups, version: st.synVersion } }); }
  if (p === '/lounge/category') { const c = body.category; if (c.id) Object.assign(st.cats.find((x) => x.id === c.id), c); else st.cats.push({ ...c, id: 'new-' + st.cats.length }); return fulfil(200, { category: c }); }
  if (p === '/lounge/category/delete') return fulfil(200, { ok: true, moved: 0 });
  if (p === '/lounge/mentor') { const t = st.mentors.find((x) => x.siteKey === body.siteKey) || { siteKey: body.siteKey, name: 'New', alliance: 'DOG', rank: 1, role: 'mentor', appointed: true, notify: 0, blocked: false }; Object.assign(t, body); if (body.appointed === false) t.role = null; return fulfil(200, { mentor: t }); }
  if (p === '/lounge/signout-all') return fulfil(200, { ok: true });
  if (p === '/lounge/changelog') return fulfil(200, { changelog: u.searchParams.get('before') ? st.older : [] });
  if (p === '/lounge/change') return fulfil(200, { change: { ...(st.changelog.find((c) => String(c.id) === u.searchParams.get('id')) || st.changelog[0]), before: { question: 'old text' }, after: { question: 'new text' } } });
  if (p === '/lounge/restore') return fulfil(200, { ok: true });
  return fulfil(404, { error: 'nope' });
}

async function open({ signedIn = true, width = 1280, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await ctx.route(W + '/**', route);
  if (signedIn) await ctx.addInitScript(() => { try { if (!localStorage.getItem('ll_mentor_v1')) localStorage.setItem('ll_mentor_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })); } catch (e) { /* none */ } });
  await page.goto(base + hash);
  if (signedIn) await page.waitForSelector('#lm-chip:not([hidden])');
  return { ctx, page, errs };
}
async function signIn(page, uid) {
  await page.fill('#lm-uid', uid || '1234567890123'); await page.click('#lm-signin-go');
}
const last = (p) => calls.filter((c) => c.path === p).pop();
const tab = (page, t) => page.click('#lm-tab-' + t);

test('M-SIGNIN: a not_mentor message, then success shows the chip and stores a pass without the UID', async () => {
  const { ctx, page, errs } = await open({ signedIn: false });
  st.signinError = { status: 403, error: 'not_mentor' };
  await signIn(page, '1234-567 890123');
  await page.waitForFunction(() => /R4s, R5s, appointed officers/.test(document.getElementById('lm-signin-err').innerText));
  assert.equal(last('/lounge/handshake').body.uid, '1234567890123', 'non-digits stripped');
  assert.ok(!('passphrase' in last('/lounge/handshake').body) || !last('/lounge/handshake').body.passphrase);
  st.signinError = null;
  await signIn(page);
  await page.waitForSelector('#lm-chip:not([hidden])');
  assert.match(await page.innerText('#lm-chip'), /Lady🐞 · R4 · DOG/);
  const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  assert.ok(!stored.includes('1234567890123'), 'UID not stored');
  const v = await page.evaluate(() => JSON.parse(localStorage.getItem('ll_mentor_v1')));
  assert.deepEqual(Object.keys(v).sort(), ['expires', 'token']);
  assert.match(last('/lounge/admin').auth, /^Bearer tok/);
  await page.click('#lm-signout');
  assert.equal(await page.evaluate(() => localStorage.getItem('ll_mentor_v1')), null);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('M-PASS: a passphrase answer reveals the field and the retry sends it', async () => {
  st.needPass = true;
  const { ctx, page } = await open({ signedIn: false });
  assert.equal(await page.isVisible('#lm-pass'), false);
  await signIn(page);
  await page.waitForSelector('#lm-pass', { state: 'visible' });
  await page.fill('#lm-pass', 'opensesame'); await page.click('#lm-signin-go');
  await page.waitForSelector('#lm-chip:not([hidden])');
  assert.equal(last('/lounge/handshake').body.passphrase, 'opensesame');
  await ctx.close();
});

test('M-CREATE: new question, similar match shows, save lands as Draft, Publish flips the pill', async () => {
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-q', 'what is the armory page');
  await page.waitForFunction(() => /What is the armory\?/.test(document.getElementById('lm-similar').innerText));
  await page.fill('#lm-a', '## Hello\n- one **two**');
  assert.match(await page.innerHTML('#lm-preview'), /<h3>Hello<\/h3>/);
  await page.selectOption('#lm-cat', 'armory');
  await page.fill('#lm-q', 'How do I reset my base layout');
  await page.selectOption('#lm-status', 'draft');
  await page.click('#lm-save');
  await page.waitForFunction(() => /How do I reset my base layout/.test(document.getElementById('lm-list').innerText));
  assert.deepEqual(Object.keys(last('/lounge/entry').body.entry).sort(), ['alternates', 'answer', 'category_id', 'keywords', 'question', 'status']);
  const row = page.locator('.lm-row', { hasText: 'How do I reset my base layout' });
  assert.match(await row.locator('.pill').innerText(), /Draft/i);
  await page.click('#lm-publish');
  await page.waitForFunction(() => /published/i.test(document.querySelector('.lm-row[data-id^="q-new"] .pill').innerText));
  assert.equal(last('/lounge/entry').body.entry.status, 'published');
  assert.equal(last('/lounge/entry').body.entry.id.startsWith('q-new'), true);
  assert.equal(last('/lounge/entry').body.version, 1);
  await ctx.close();
});

test('M-SIMILAR: Add my wording moves the typed question into the other wording', async () => {
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-q', 'what is the armory page');
  await page.waitForSelector('#lm-similar .lm-add-wording');
  await page.click('#lm-similar .lm-add-wording');
  assert.equal(await page.inputValue('#lm-q'), 'What is the armory?');
  assert.match(await page.inputValue('#lm-alts'), /armoury page\nwhat is the armory page/);
  await ctx.close();
});

test('M-CONFLICT: 409 shows the banner, Load latest keeps Your version', async () => {
  const { ctx, page } = await open();
  await page.click('.lm-row[data-id="q-armory-what"]');
  await page.fill('#lm-a', 'MY LONG EDIT');
  st.saveAnswers.push({ status: 409, body: { error: 'conflict', entry: { ...st.entries[0], answer: 'THEIR EDIT', version: 7 } } });
  await page.click('#lm-save');
  await page.waitForFunction(() => /Someone else changed this while you were editing/.test(document.getElementById('lm-banner').innerText));
  assert.equal(await page.inputValue('#lm-a'), 'MY LONG EDIT', 'text kept');
  await page.click('#lm-load-latest');
  assert.equal(await page.inputValue('#lm-a'), 'THEIR EDIT');
  assert.match(await page.innerText('#lm-yours'), /MY LONG EDIT/);
  await page.click('#lm-save');
  await page.waitForFunction(() => !document.getElementById('lm-banner').innerText.trim());
  assert.equal(last('/lounge/entry').body.version, 7, 'second save used the latest version');
  await ctx.close();
});

test('M-EXPIRED: 401 on save shows the sign-in overlay, drawer text stays, save retries after sign-in', async () => {
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-q', 'Where do I find the calendar');
  await page.fill('#lm-a', 'Under the menu.');
  await page.selectOption('#lm-cat', 'events');
  st.saveAnswers.push({ status: 401, body: { error: 'signed_out' } });
  const before = calls.filter((c) => c.path === '/lounge/entry').length;
  await page.click('#lm-save');
  await page.waitForSelector('#lm-signin', { state: 'visible' });
  assert.equal(await page.inputValue('#lm-a'), 'Under the menu.');
  await signIn(page);
  await page.waitForFunction(() => /Where do I find the calendar/.test(document.getElementById('lm-list').innerText));
  assert.equal(calls.filter((c) => c.path === '/lounge/entry').length - before, 2, 'retried once');
  assert.equal(await page.isVisible('#lm-signin'), false);
  assert.equal(await page.inputValue('#lm-q'), 'Where do I find the calendar');
  await ctx.close();
});

test('M-INBOX: answering an ask prefills the drawer and resolves it with the entry; attach sends the chosen entry', async () => {
  const { ctx, page } = await open();
  await tab(page, 'inbox');
  assert.equal((await page.innerText('#lm-badge')).trim(), '2');
  assert.match(await page.innerText('#lm-asks'), /Newbie/);
  await page.click('#lm-asks .lm-answer');
  assert.equal(await page.inputValue('#lm-q'), 'How do I join the alliance?');
  await page.fill('#lm-a', 'Apply on the transfer page.');
  await page.selectOption('#lm-cat', 'events');
  await page.click('#lm-save');
  await page.waitForFunction(() => document.querySelector('#lm-asks .lm-answer') === null);
  const r = last('/lounge/ask/resolve').body;
  assert.equal(r.id, 'ask1'); assert.equal(r.action, 'answered'); assert.match(r.entryId, /^q-new/);
  await page.click('#lm-close');
  await page.click('#lm-misses .lm-attach');
  await page.waitForSelector('#lm-misses .lm-pick-entry');
  assert.match(await page.innerText('#lm-misses'), /What is the armory\?/);
  await page.selectOption('#lm-misses .lm-pick-entry', 'q-armory-what');
  await page.click('#lm-misses .lm-attach-go');
  await page.waitForFunction(() => document.querySelector('#lm-misses .lm-attach') === null);
  assert.deepEqual(last('/lounge/miss/resolve').body, { q: 'armoury', action: 'attach', entryId: 'q-armory-what' });
  await ctx.close();
});

test('M-SYN: add a term, save, body carries the version', async () => {
  const { ctx, page } = await open();
  await tab(page, 'words');
  assert.match(await page.innerText('#lm-p-words'), /Heavy Trooper|heavy trooper/i);
  await page.fill('#lm-p-words .lm-syn-add input', 'big guy');
  await page.press('#lm-p-words .lm-syn-add input', 'Enter');
  await page.click('#lm-syn-save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('lm-syn-msg').innerText));
  const b = last('/lounge/synonyms').body;
  assert.equal(b.version, 1);
  assert.deepEqual(b.groups[0], ['ht', 'heavy trooper', 'mecha', 'big guy']);
  await ctx.close();
});

test('M-LEAD: appoint is hidden for a mentor, visible for a lead, and sends siteKey + appointed', async () => {
  let o = await open();
  await tab(o.page, 'mentors');
  await o.page.waitForSelector('#lm-p-mentors .lm-mrow');
  assert.equal(await o.page.isVisible('#lm-appoint'), false);
  assert.equal(await o.page.locator('#lm-p-mentors .lm-remove').count(), 0);
  await o.ctx.close();
  st.me.role = 'lead';
  o = await open();
  await tab(o.page, 'mentors');
  await o.page.waitForSelector('#lm-appoint', { state: 'visible' });
  await o.page.waitForSelector('#lm-appoint-pick option[value="cccccccccccccccc"]', { state: 'attached' });
  await o.page.selectOption('#lm-appoint-pick', 'cccccccccccccccc');
  await o.page.click('#lm-appoint-go');
  await o.page.waitForFunction(() => document.querySelectorAll('#lm-p-mentors .lm-mrow').length === 4);
  assert.deepEqual(last('/lounge/mentor').body, { siteKey: 'cccccccccccccccc', appointed: true });
  await o.page.click('#lm-p-mentors .lm-remove');
  await o.page.waitForTimeout(200);
  assert.equal(last('/lounge/mentor').body.appointed, false);
  await o.ctx.close();
});

test('M-HISTORY: Older paginates, Restore sends changeId', async () => {
  const { ctx, page } = await open();
  await tab(page, 'history');
  assert.match(await page.innerText('#lm-history'), /Edited armory answer/);
  await page.click('#lm-older');
  await page.waitForFunction(() => /Renamed chapter/.test(document.getElementById('lm-history').innerText));
  assert.equal(last('/lounge/changelog').search, '?before=5');
  await page.click('#lm-history .lm-crow >> nth=0');
  await page.waitForSelector('#lm-diff');
  assert.match(await page.innerText('#lm-diff'), /old text[\s\S]*new text/);
  await page.click('#lm-restore');
  await page.waitForTimeout(200);
  assert.equal(last('/lounge/restore').body.changeId, 5);
  await ctx.close();
});

test('M-XSS: hostile strings render inert on every tab', async () => {
  st.entries[0].question = EVIL; st.entries[0].alternates = [EVIL]; st.entries[0].keywords = [EVIL];
  st.asks[0].question = EVIL; st.asks[0].name = EVIL;
  st.misses[0].sample = EVIL; st.misses[0].q = EVIL;
  st.groups = [[EVIL, 'x']]; st.cats[0].name = EVIL; st.cats[0].blurb = EVIL;
  st.changelog[0].summary = EVIL; st.changelog[0].actorName = EVIL;
  st.mentors[1].name = EVIL;
  const { ctx, page, errs } = await open();
  for (const t of ['questions', 'inbox', 'chapters', 'words', 'mentors', 'history']) {
    await tab(page, t); await page.waitForTimeout(150);
  }
  await tab(page, 'questions');
  await page.click('.lm-row >> nth=0');
  await page.waitForTimeout(150);
  await page.click('#lm-close');
  await page.fill('#lm-try', EVIL);
  await page.fill('#lm-try', 'armoury');
  await tab(page, 'history'); await page.click('#lm-history .lm-crow >> nth=0'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('M-MOBILE: no horizontal scroll at 360 px on any tab, drawer included', async () => {
  const { ctx, page } = await open({ width: 360 });
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const t of ['questions', 'inbox', 'chapters', 'words', 'mentors', 'history']) {
    await tab(page, t); await page.waitForTimeout(100);
    assert.ok((await over()) <= 0, t + ' overflows by ' + (await over()));
  }
  await tab(page, 'questions');
  await page.click('.lm-row >> nth=0'); await page.waitForTimeout(100);
  assert.ok((await over()) <= 0, 'drawer overflows');
  assert.ok(!/—/.test(await page.innerText('body')), 'no em dash');
  await ctx.close();
});

// Screenshots for review: LM_SHOTS=<dir> node --test ... (skipped otherwise)
test('screenshots', { skip: !process.env.LM_SHOTS }, async () => {
  for (const [name, width] of [['desktop', 1280], ['mobile', 360]]) {
    st = fresh(); st.me.role = 'lead';
    const { ctx, page } = await open({ width });
    for (const t of ['questions', 'inbox', 'chapters', 'words', 'mentors', 'history']) {
      await tab(page, t); await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(process.env.LM_SHOTS, `task-5-${name}-${t}.png`), fullPage: true });
    }
    await tab(page, 'questions'); await page.click('.lm-row >> nth=0'); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(process.env.LM_SHOTS, `task-5-${name}-drawer.png`) });
    await ctx.close();
  }
});

test('M-REMOVED: a removed mentor is not listed after reload and can be appointed again', async () => {
  st.me.role = 'lead';
  let o = await open();
  await tab(o.page, 'mentors');
  await o.page.waitForSelector('#lm-p-mentors .lm-remove');
  await o.page.click('#lm-p-mentors .lm-remove');
  await o.page.waitForFunction(() => document.querySelectorAll('#lm-p-mentors .lm-remove').length === 0);
  assert.equal(st.mentors.find((m) => m.siteKey === 'yyyyyyyyyyyyyyyy').role, null);
  await o.ctx.close();
  st.mentors.push({ siteKey: 'bbbbbbbbbbbbbbbb', name: 'Samson', alliance: 'DOG', rank: 3, role: null, appointed: false, notify: 0, blocked: false });
  o = await open();
  await tab(o.page, 'mentors');
  await o.page.waitForSelector('#lm-appoint-pick option[value="bbbbbbbbbbbbbbbb"]', { state: 'attached' });
  assert.ok(!/Samson/.test(await o.page.innerText('#lm-mentors')), 'not listed');
  await o.ctx.close();
  st.mentors.push({ siteKey: 'cccccccccccccccc', name: 'Willow', alliance: 'MSS', rank: 3, role: null, appointed: false, notify: 0, blocked: true });
  o = await open();
  await tab(o.page, 'mentors');
  assert.match(await o.page.innerText('#lm-mentors'), /Willow[\s\S]*Paused/);
  await o.ctx.close();
});

test('M-ROLELOST: 403 not_mentor on save keeps the text, shows the notice, drops the pass', async () => {
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-q', 'Where is the thing');
  await page.fill('#lm-a', 'Over there.');
  await page.selectOption('#lm-cat', 'events');
  st.saveAnswers.push({ status: 403, body: { error: 'not_mentor' } });
  await page.click('#lm-save');
  await page.waitForFunction(() => /Your mentor access changed, so this wasn't saved/.test(document.getElementById('lm-banner').innerText));
  assert.equal(await page.inputValue('#lm-a'), 'Over there.');
  assert.equal(await page.evaluate(() => localStorage.getItem('ll_mentor_v1')), null);
  await ctx.close();
});

const hasText = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source);

test('M-FIX3: chapter name inputs cap at 40', async () => {
  const { ctx, page } = await open(); await tab(page, 'chapters');
  assert.equal(await page.getAttribute('#lm-nc-name', 'maxlength'), '40');
  assert.equal(await page.getAttribute('#lm-chapters input[aria-label="Chapter name"]', 'maxlength'), '40');
  await ctx.close();
});

test('M-FIX4: wordings, keywords and same-word groups show a note when over the caps', async () => {
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-alts', Array.from({ length: 26 }, (_, i) => 'w' + i).join('\n'));
  await hasText(page, /At most 25 other wordings/);
  await page.fill('#lm-alts', 'x'.repeat(201));
  await hasText(page, /200 characters at most/);
  await page.fill('#lm-kws', Array.from({ length: 26 }, (_, i) => 'k' + i).join(', '));
  await hasText(page, /At most 25 keywords/);
  await page.fill('#lm-kws', 'k'.repeat(41));
  await hasText(page, /40 characters at most/);
  await page.fill('#lm-q', 'Q'); await page.fill('#lm-a', 'A'); await page.selectOption('#lm-cat', 'armory');
  const before = calls.filter((c) => c.path === '/lounge/entry').length;
  await page.click('#lm-save');
  await hasText(page, /Please fix the notes above/);
  assert.equal(calls.filter((c) => c.path === '/lounge/entry').length, before, 'nothing sent');
  await page.click('#lm-close'); await tab(page, 'words');
  const inp = page.locator('.lm-syn-add input').first();
  await inp.fill('y'.repeat(41)); await page.locator('.lm-syn-add button', { hasText: 'Add' }).first().click();
  await hasText(page, /40 characters at most. Shorten it/);
  for (let i = 0; i < 11; i++) { await page.locator('.lm-syn-add input').first().fill('t' + i); await page.keyboard.press('Enter'); }
  await page.locator('.lm-syn-add input').first().fill('extra'); await page.keyboard.press('Enter');
  await hasText(page, /At most 12 words in a group/);
  await ctx.close();
});

test('M-FIX5: un-appointing an R4 who is still a mentor by rank keeps the row, a plain appointee leaves', async () => {
  st.mentors[2].rank = 4; st.me = { ...st.me, role: 'lead' };
  st.over = { '/lounge/mentor': (b) => (b.appointed === false ? [200, { mentor: { ...st.mentors[2], appointed: false, role: 'mentor' } }] : null) };
  const { ctx, page } = await open(); await tab(page, 'mentors');
  await page.locator('.lm-mrow', { hasText: 'Samyaza' }).locator('.lm-remove').click();
  await hasText(page, /Done\./);
  assert.equal(await page.locator('.lm-mrow', { hasText: 'Samyaza' }).count(), 1);
  assert.equal(await page.locator('.lm-mrow', { hasText: 'Samyaza' }).locator('.lm-remove').count(), 0);
  await ctx.close();
});

test('M-FIX6: a rank of 0 prints no stray separator', async () => {
  st.mentors[2].rank = 0; st.me = { ...st.me, rank: 0 };
  const { ctx, page } = await open(); await tab(page, 'mentors');
  const t = await page.locator('.lm-mrow', { hasText: 'Samyaza' }).innerText();
  assert.ok(!/^\s*·|·\s*·/.test(t.split('\n').join(' ').replace('Alerts on new questions', '')), t);
  assert.ok(!/R0/.test(t));
  assert.ok(!/·/.test(await page.innerText('#lm-chip')) || !/· ·/.test(await page.innerText('#lm-chip')));
  await ctx.close();
});

test('M-FIX7: adding a chapter that exists says so', async () => {
  st.over = { '/lounge/category': () => [409, { error: 'exists' }] };
  const { ctx, page } = await open(); await tab(page, 'chapters');
  await page.fill('#lm-nc-name', 'Armory'); await page.click('#lm-nc-add');
  await hasText(page, /There is already a chapter called that\./);
  await ctx.close();
});

test('M-FIX8: delete not_empty message; lone chapter: empty deletes with moveTo empty, non-empty is told to make another', async () => {
  st.over = { '/lounge/category/delete': () => [409, { error: 'not_empty' }] };
  let t = await open(); await tab(t.page, 'chapters');
  await t.page.locator('#lm-chapters .card').first().locator('button', { hasText: 'Delete' }).first().click();
  await t.page.click('.lm-del-go');
  await hasText(t.page, /Someone added a question to that chapter just now\. Try again\./);
  await t.ctx.close();
  st = fresh(); calls = [];
  st.cats = [st.cats[0]]; st.entries = st.entries.filter((e) => e.category_id !== 'armory').map((e) => ({ ...e, category_id: 'zzz' }));
  st.entries = [];
  t = await open(); await tab(t.page, 'chapters');
  await t.page.locator('#lm-chapters .card button', { hasText: 'Delete' }).first().click();
  await t.page.click('.lm-del-go');
  await t.page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(last('/lounge/category/delete').body.moveTo, '');
  await t.ctx.close();
  st = fresh(); calls = [];
  st.cats = [st.cats[0]];
  t = await open(); await tab(t.page, 'chapters');
  await t.page.locator('#lm-chapters .card button', { hasText: 'Delete' }).first().click();
  await hasText(t.page, /Make another chapter first, then move these questions there\./);
  assert.equal(await t.page.locator('.lm-del-go').count(), 0);
  await t.ctx.close();
});

test('M-FIX9: Restore only for entry/category/synonyms rows; cannot_restore has its own message', async () => {
  st.changelog = [
    { id: 7, at: Date.now(), actorName: 'Tex', action: 'mentor', target: 'mentor:abc', summary: 'Appointed X' },
    { id: 5, at: Date.now(), actorName: 'Tex', action: 'entry', target: 'entry:q-armory-what', summary: 'Edited' }];
  st.over = { '/lounge/restore': () => [409, { error: 'cannot_restore' }] };
  const { ctx, page } = await open(); await tab(page, 'history');
  await page.locator('.lm-crow[data-id="7"]').click(); await page.waitForSelector('#lm-diff');
  assert.equal(await page.locator('#lm-restore').count(), 0);
  await page.locator('.lm-crow[data-id="5"]').click(); await page.waitForSelector('#lm-restore');
  await page.click('#lm-restore');
  await hasText(page, /This kind of change can't be undone here\./);
  await ctx.close();
});

test('M-FIX10: a 403 on first load drops the pass and shows the sign-in with that message', async () => {
  st.over = { '/lounge/admin': () => [403, { error: 'blocked' }] };
  const { ctx, page } = await open({ signedIn: false });
  await page.evaluate(() => localStorage.setItem('ll_mentor_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })));
  await page.reload();
  await page.waitForSelector('#lm-signin:not([hidden])');
  await hasText(page, /Your mentor access is paused/);
  assert.equal(await page.evaluate(() => localStorage.getItem('ll_mentor_v1')), null);
  await ctx.close();
});

test('M-FIX11: unreachable worker on first load shows Try again and keeps the pass', async () => {
  let down = true;
  st.over = { '/lounge/admin': () => (down ? [503, { error: 'x' }] : null) };
  const { ctx, page } = await open({ signedIn: false });
  await page.evaluate(() => localStorage.setItem('ll_mentor_v1', JSON.stringify({ token: 'stored', expires: Date.now() + 3600e3 })));
  await page.reload();
  await hasText(page, /The Lounge can't be reached right now\./);
  assert.equal(await page.locator('#lm-signin').isVisible(), false);
  assert.ok(await page.evaluate(() => localStorage.getItem('ll_mentor_v1')));
  down = false;
  await page.click('#lm-down-retry');
  await page.waitForSelector('#lm-chip:not([hidden])');
  await ctx.close();
});

test('M-FIX12: after a re-sign-in from the overlay, the admin load runs again', async () => {
  let first = true;
  st.over = { '/lounge/entry': () => { if (first) { first = false; return [401, { error: 'expired' }]; } return null; } };
  const { ctx, page } = await open();
  await page.click('#lm-new');
  await page.fill('#lm-q', 'Fresh?'); await page.fill('#lm-a', 'Yes'); await page.selectOption('#lm-cat', 'armory');
  await page.click('#lm-save');
  await page.waitForSelector('#lm-signin:not([hidden])');
  const n = calls.filter((c) => c.path === '/lounge/admin').length;
  await signIn(page);
  await page.waitForFunction(() => document.getElementById('lm-signin').hidden);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(calls.filter((c) => c.path === '/lounge/admin').length > n, 'admin reloaded');
  await ctx.close();
});
