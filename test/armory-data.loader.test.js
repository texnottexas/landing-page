'use strict';
// ArmoryData (pages/armory-data.js): the loaders and the orchestrator, against a stub fetch and an in-memory storage.
// No network, no real player: one invented player (test/helpers/armory-world.js). Covers the share-code states
// (expired vs unreachable), the report CDN fallback, the supplement privacy 403 and clear markers, the handshake body,
// identity from the same localStorage keys as v1, and that two instances never share state.
// Run: node --test test/armory-data.loader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const AD = require('../pages/armory-data.js');
const W = require('./helpers/armory-world.js');

const ROSTER = [{ siteKey: W.SK, name: W.NAME, alliance: 'DOG', rank: 3, power: 59181928, profession: 'Mechanical Master' }, { siteKey: 'ffffffffffffffff', name: 'Other', alliance: 'MSS' }];

// A worker + CDN + static-data router. `over(url, opts, calls)` wins when it returns something.
function router(over) {
  return (url, opts, calls) => {
    const o = over ? over(url, opts, calls) : undefined;
    if (o !== undefined) return o;
    const st = W.staticRoute(url);
    if (st) return st;
    if (url === 'player-data.json') return { status: 200, body: ROSTER };
    if (url === W.reportUrl(W.CDN, W.REPORT_ID)) return { status: 200, body: W.battleReport() };
    if (url.startsWith(W.WORKER + '/report-config?code=')) return { status: 200, body: { ok: true, playerName: W.NAME, siteKey: W.SK, reportIds: W.REPORT_ID, date: 'x' } };
    if (url.startsWith(W.WORKER + '/supplement/privacy/')) return { status: 200, body: {} };
    if (url.startsWith(W.WORKER + '/supplement/handshake')) return { status: 200, body: { token: 'tok-1', expires: Date.now() + 1e7, siteKey: W.SK } };
    if (url.startsWith(W.WORKER + '/collect-report')) return { status: 200, body: { ok: true } };
    return undefined; // 404
  };
}
const make = (over, storageInit) => {
  const fetch = W.makeFetch(router(over));
  const storage = W.memStorage(storageInit);
  const d = AD.create({ fetch, storage });
  return { d, fetch, storage };
};
const ident = (sk, name) => ({ playerIdentity: JSON.stringify({ name: name || W.NAME, siteKey: sk || W.SK, alliance: 'DOG' }) });
const suppUrl = (kind) => W.WORKER + '/supplement/' + kind + '/' + W.SK;
const invSupp = (ts) => ({ meta: { ts }, tabs: { item: [{ id: 20213232, a: 100 }], decor: [] } });

test('share code: a code the worker does not know is the expired state, not an error', async () => {
  const { d, fetch } = make((u) => (u.includes('/report-config?code=') ? { status: 404, body: { ok: false, error: 'not_found' } } : undefined));
  const r = await d.loadArmory({ code: 'abcd' });
  assert.equal(r.state, 'expired');
  assert.deepStrictEqual(r.errors, [{ kind: 'not_found', status: undefined }]);
  assert.equal(r.merged, null);
  assert.ok(fetch.calls.some((c) => c.url === W.WORKER + '/report-config?code=ABCD'), 'the code is upper-cased');
  assert.ok(!fetch.calls.some((c) => c.url.includes('aliyuncs')), 'no report is fetched for an expired code');
});

test('share code: malformed is expired (no request); an unreachable worker is an error, not expired', async () => {
  let a = make();
  assert.equal((await a.d.loadArmory({ code: 'zz' })).state, 'expired');
  assert.equal(a.fetch.calls.length, 0);
  a = make((u) => (u.includes('/report-config?code=') ? { status: 400, body: { ok: false, error: 'invalid_code' } } : undefined));
  assert.equal((await a.d.loadArmory({ code: 'ABCD' })).state, 'expired');
  a = make((u) => { if (u.includes('/report-config?code=')) throw new Error('offline'); });
  assert.equal((await a.d.loadArmory({ code: 'ABCD' })).state, 'error');
  a = make((u) => (u.includes('/report-config?code=') ? { status: 503, body: 'x' } : undefined));
  const r = await a.d.loadArmory({ code: 'ABCD' });
  assert.equal(r.state, 'error');
  assert.equal(r.errors[0].kind, 'unavailable');
  assert.equal(r.errors[0].status, 503);
});

test('share code: a foreign code opens read-only, your own code does not (siteKey first, then name; ambiguous = read-only)', async () => {
  let a = make(null, ident('0000000000000000', 'Someone Else'));
  let r = await a.d.loadArmory({ code: 'ABCD' });
  assert.equal(r.state, 'ready');
  assert.equal(r.readOnly, true);
  assert.equal(r.identity.isOwn, false);
  a = make(null, ident(W.SK));
  r = await a.d.loadArmory({ code: 'ABCD' });
  assert.equal(r.readOnly, false);
  assert.equal(r.identity.isOwn, true);
  a = make(); // no identity at all: view-only (bug #107)
  assert.equal((await a.d.loadArmory({ code: 'ABCD' })).readOnly, true);
  // name fallback when a side has no siteKey, case and spacing ignored
  a = make((u) => (u.includes('/report-config?code=') ? { status: 200, body: { ok: true, playerName: '  tester ', siteKey: null, reportIds: W.REPORT_ID } } : undefined), { playerIdentity: JSON.stringify({ name: 'TESTER' }) });
  assert.equal((await a.d.loadArmory({ code: 'ABCD' })).readOnly, false);
  // the code's march groups and "set up by" come through
  a = make((u) => (u.includes('/report-config?code=') ? { status: 200, body: { ok: true, playerName: W.NAME, siteKey: W.SK, reportIds: W.REPORT_ID, marchGroups: [{ n: 1 }], createdByAdvisor: 'Wonka' } } : undefined));
  r = await a.d.loadArmory({ code: 'ABCD' });
  assert.deepStrictEqual(r.marchGroups, [{ n: 1 }]);
  assert.equal(r.setupBy, 'Wonka');
});

test('report fetch: global CDN first, CN when the global host answers non-2xx or fails; both down is a reported error', async () => {
  const gl = W.reportUrl(W.CDN, W.REPORT_ID), cn = W.reportUrl(W.CDN_CN, W.REPORT_ID);
  let a = make((u) => (u === gl ? { status: 404, body: {} } : u === cn ? { status: 200, body: W.battleReport() } : undefined));
  let r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'ready');
  assert.deepStrictEqual(a.fetch.calls.filter((c) => c.url.includes('aliyuncs')).map((c) => c.url), [gl, cn]);
  a = make((u) => { if (u === gl) throw new Error('dns'); if (u === cn) return { status: 200, body: W.battleReport() }; });
  r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'ready', 'a network failure on the global host also falls back');
  a = make((u) => (u === gl || u === cn ? { status: 404, body: {} } : undefined));
  r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'empty');
  assert.deepStrictEqual(r.errors.filter((e) => e.kind === 'report'), [{ kind: 'report', id: W.REPORT_ID, status: 404 }]);
  // the id is validated before any CDN URL is built
  a = make();
  r = await a.d.loadArmory({ reportIds: ['../../etc', '12', W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(a.fetch.calls.filter((c) => c.url.includes('aliyuncs')).length, 1);
  assert.equal(a.d.validReportId('1234567890'), true);
  assert.equal(a.d.validReportId('123456789'), false);
  assert.equal(a.d.validReportId('1234567890123456789012345'), true);
  assert.equal(a.d.validReportId('12345678901234567890123456'), false);
});

test('a report that does not contain the player is skipped and named; the others still load', async () => {
  const other = '9999999999999999999';
  const a = make((u) => (u === W.reportUrl(W.CDN, other) ? { status: 200, body: W.battleReport({ name: 'Nobody' }) } : undefined));
  const r = await a.d.loadArmory({ reportIds: [other, W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'ready');
  assert.deepStrictEqual(r.reports.map((x) => x.id), [W.REPORT_ID]);
  assert.deepStrictEqual(r.errors.filter((e) => e.kind === 'player_not_in_report'), [{ kind: 'player_not_in_report', id: other }]);
});

test('merged report, roster siteKey, avatar and source times', async () => {
  const a = make();
  const r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'ready');
  assert.equal(r.player.siteKey, W.SK, 'siteKey comes from the roster by name when the code carries none');
  assert.equal(r.rosterEntry.alliance, 'DOG');
  assert.ok(r.player.avatar && r.player.avatar.includes('hero_icon116_global'));
  assert.equal(r.merged.heroes.length, 3);
  assert.deepStrictEqual(r.merged.heroes.map((h) => h.heroEquips.length), W.gearHeroes().slice(0, 3).map((h) => h.heroEquips.length));
  assert.equal(r.sources.reportsTs, 1779000000 * 1000);
  assert.equal(r.sources.dataTs, 0);
  assert.deepStrictEqual(r.sources.kinds, []);
  assert.deepStrictEqual(r.reportMechaIds, [1006]);
  assert.equal(r.readOnly, true, 'explicit loads are read-only unless own:true');
  assert.equal((await make().d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME }, own: true })).readOnly, false);
  // a fresh report is archived through /collect-report, as the page does
  assert.ok(a.fetch.calls.some((c) => c.url === W.WORKER + '/collect-report' && c.body.id === W.REPORT_ID));
});

test('saved report: reads playerReport + the playerReportData cache (no CDN call), refreshes the cache, never rewrites playerReport', async () => {
  const first = make();
  await first.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  const extracted = first.d.extractPlayerData(W.battleReport(), W.NAME);
  const saved = { player: { name: W.NAME, siteKey: W.SK }, reportIds: [W.REPORT_ID, '8888888888888888888'], marchGroups: [{ n: 2 }] };
  const a = make(null, Object.assign(ident(), { playerReport: JSON.stringify(saved), playerReportData: JSON.stringify({ [W.REPORT_ID]: extracted }) }));
  const r = await a.d.loadArmory({ saved: true });
  assert.equal(r.state, 'ready');
  assert.equal(r.readOnly, false);
  assert.deepStrictEqual(r.marchGroups, [{ n: 2 }]);
  assert.deepStrictEqual(a.fetch.calls.filter((c) => c.url.includes('aliyuncs')).map((c) => c.url), [W.reportUrl(W.CDN, '8888888888888888888'), W.reportUrl(W.CDN_CN, '8888888888888888888')], 'only the uncached id goes to the CDN (global host, then CN)');
  assert.equal(a.storage.getItem('playerReport'), JSON.stringify(saved), 'the saved report is left exactly as it was (a failed id is not dropped)');
  assert.deepStrictEqual(Object.keys(JSON.parse(a.storage.getItem('playerReportData'))), [W.REPORT_ID]);
  // a view-only saved report does not touch the cache
  const b = make(null, { playerReport: JSON.stringify(Object.assign({ _viewOnly: true }, saved)), playerReportData: '{}' });
  assert.equal((await b.d.loadArmory({ saved: true })).readOnly, true);
  assert.equal(b.storage.getItem('playerReportData'), '{}');
  // nothing saved
  assert.equal((await make().d.loadArmory({ saved: true })).state, 'none');
});

test('identity: the same localStorage keys as v1 (playerIdentity, armory_uid_*, armory_unlocked, armoryToken)', async () => {
  const a = make(null, ident());
  assert.equal(a.d.getStoredIdentity().siteKey, W.SK);
  assert.equal(a.d.identity.get().name, W.NAME);
  a.d.storeUid(W.SK, W.UID_RAW);
  a.d.setUnlocked(W.SK, true);
  const keys = Object.keys(a.storage.dump()).sort();
  assert.deepStrictEqual(keys, ['armory_uid_' + W.SK, 'armory_unlocked', 'playerIdentity'].sort());
  assert.equal(a.d.getStoredUid(W.SK), W.UID_RAW);
  assert.equal(a.d.isUnlocked(W.SK), true);
  // 'anonymous' is no identity
  const b = make(null, { playerIdentity: 'anonymous' });
  assert.equal(b.d.getStoredIdentity(), null);
});

test('handshake: sends the raw UID as {uid}, keeps the token in memory and in armoryToken; ensureToken re-handshakes from the stored UID', async () => {
  const a = make(null, ident());
  const r = await a.d.handshake(W.UID_RAW);
  const call = a.fetch.calls.find((c) => c.url === W.WORKER + '/supplement/handshake');
  assert.deepStrictEqual(call.body, { uid: W.UID_RAW });
  assert.equal(call.opts.method, 'POST');
  assert.equal(r.token, 'tok-1');
  assert.equal(a.d.token(), 'tok-1');
  assert.equal(JSON.parse(a.storage.getItem('armoryToken')).siteKey, W.SK);
  // a fresh token is kept: no second handshake
  await a.d.ensureToken(W.SK);
  assert.equal(a.fetch.calls.filter((c) => c.url.includes('/handshake')).length, 1);
  // no stored UID and no token: the page's own message
  const b = make();
  await assert.rejects(() => b.d.ensureToken(W.SK), /Verify your in-game UID first/);
  // a stored UID lets it re-handshake without asking
  b.d.storeUid(W.SK, W.UID_RAW);
  await b.d.ensureToken(W.SK);
  assert.equal(b.d.token(), 'tok-1');
  // a refused handshake is a plain message, never a status code or JSON
  const c = make((u) => (u.includes('/handshake') ? { status: 403, body: 'uid_mismatch' } : undefined));
  await assert.rejects(() => c.d.handshake('000'), /sign-in has expired/);
});

test('verifyUid: the right UID unlocks (also with a pasted prefix), a wrong one does not and sends nothing', async () => {
  const a = make();
  let r = await a.d.verifyUid(W.SK, 'UID: ' + W.UID_RAW);
  assert.equal(r.ok, true);
  assert.equal(r.handshake, true);
  assert.deepStrictEqual(a.fetch.calls.find((c) => c.url.includes('/handshake')).body, { uid: W.UID_RAW }, 'the digits-only attempt is what is sent');
  assert.equal(a.d.isUnlocked(W.SK), true);
  assert.equal(a.d.getStoredUid(W.SK), W.UID_RAW);
  const b = make();
  r = await b.d.verifyUid(W.SK, '999999999999');
  assert.deepStrictEqual(r, { ok: false, reason: 'mismatch' });
  assert.deepStrictEqual(b.fetch.calls.map((c) => c.url), ['player-data.json'], 'only the roster is read (the roster-heal check); the UID is never sent');
  assert.equal(b.d.isUnlocked(W.SK), false);
  // the server being down still unlocks locally (fail-soft), and says so
  const c = make((u) => { if (u.includes('/handshake')) throw new Error('offline'); });
  r = await c.d.verifyUid(W.SK, W.UID_RAW);
  assert.deepStrictEqual(r, { ok: true, handshake: false });
});

test('supplements: a 403 marks the kind private and wipes the stale local copy; the viewer gets no data for it', async () => {
  const stale = invSupp('2026-01-01T00:00:00Z');
  const a = make((u) => (u === suppUrl('inv') ? { status: 403, body: { error: 'private' } } : u === W.WORKER + '/supplement/privacy/' + W.SK ? { status: 200, body: { inv: true } } : undefined),
    { ['armory_inv_' + W.SK]: JSON.stringify(stale) });
  const r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.privacy.inv, true);
  assert.equal(a.storage.getItem('armory_inv_' + W.SK), null, 'the stale copy is wiped');
  assert.equal(r.supp.inv, undefined);
  assert.ok(!r.sources.kinds.includes('inv'));
  assert.equal(a.d.isSupplementPrivate(W.SK, 'inv'), true);
  assert.equal(a.d.isSupplementPrivate(W.SK, 'gear'), false);
  assert.deepStrictEqual(await a.d.fetchSupplement('inv', W.SK), { __private: true });
});

test('supplements: a clear marker (header or body) drops a local copy that is not newer, and keeps newer local data', async () => {
  const t0 = Date.parse('2026-03-01T00:00:00Z'), tOld = '2026-02-01T00:00:00Z', tNew = '2026-04-01T00:00:00Z';
  const cleared = (u, how) => (u === suppUrl('inv') ? (how === 'header' ? { status: 404, body: {}, headers: { 'X-Supplement-Cleared': String(t0) } } : { status: 404, body: { cleared: t0 } }) : undefined);
  for (const how of ['header', 'body']) {
    let a = make((u) => cleared(u, how), { ['armory_inv_' + W.SK]: JSON.stringify(invSupp(tOld)), ['armory_lastSync_inv_' + W.SK]: '5' });
    await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
    assert.equal(a.storage.getItem('armory_inv_' + W.SK), null, how + ': older local copy dropped');
    assert.equal(a.storage.getItem('armory_lastSync_inv_' + W.SK), null, how + ': its sync time too');
    a = make((u) => cleared(u, how), { ['armory_inv_' + W.SK]: JSON.stringify(invSupp(tNew)) });
    const r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
    assert.ok(a.storage.getItem('armory_inv_' + W.SK), how + ': newer local copy kept');
    assert.ok(r.sources.kinds.includes('inv'));
  }
  // a plain 404 with no marker is "never uploaded": null, and nothing is dropped
  const b = make(null, { ['armory_inv_' + W.SK]: JSON.stringify(invSupp(tOld)) });
  assert.equal(await b.d.fetchSupplement('inv', W.SK), null);
  assert.ok(b.storage.getItem('armory_inv_' + W.SK));
  // right after a clear on this device the read revalidates instead of trusting the 60 s browser copy
  const c = make(null, { ['armory_justCleared_' + W.SK]: String(Date.now()) });
  await c.d.fetchSupplement('inv', W.SK);
  assert.equal(c.fetch.calls.find((x) => x.url === suppUrl('inv')).opts.cache, 'no-cache');
  const d2 = make();
  await d2.d.fetchSupplement('inv', W.SK);
  assert.equal(d2.fetch.calls.find((x) => x.url === suppUrl('inv')).opts.cache, 'default');
  await d2.d.fetchSupplement('inv', W.SK, true);
  assert.equal(d2.fetch.calls.filter((x) => x.url === suppUrl('inv'))[1].opts.cache, 'no-store');
});

test('supplements: newer worker data is adopted into the player\'s local copy; heroes/decor/enigma fill what the reports lack; kinds + dataTs are reported', async () => {
  const ts = '2026-05-19T10:00:00Z';
  const heroesSupp = { ts, list: [{ id: 101, lv: 120, st: 5, q: 5, t: 0, pwr: 1000, aw: 2, fa: true }, { id: 190, lv: 90, st: 3, q: 4, pwr: 500 }] };
  const decorSupp = { ts, active: [{ id: 49803 }, { id: 50566 }], suits: [{ suitId: 1201, rewarded: true, rewardedLevel: 2 }] };
  const worker = { heroes: heroesSupp, decor: decorSupp, inv: invSupp(ts) };
  const a = make((u) => {
    const m = /\/supplement\/([a-z]+)\/([0-9a-f]{16})$/.exec(u);
    return m && worker[m[1]] ? { status: 200, body: worker[m[1]] } : undefined;
  });
  const r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.deepStrictEqual(r.changedKinds.sort(), ['decor', 'heroes', 'inv']);
  assert.ok(a.storage.getItem('armory_heroes_' + W.SK), 'adopted into localStorage');
  assert.equal(r.sources.dataTs, Date.parse(ts));
  assert.deepStrictEqual(r.sources.kinds.sort(), ['decor', 'heroes', 'inv']);
  assert.equal(r.merged.heroes.length, 3, 'reports keep priority (auto): the report heroes stay');
  const aw = r.merged.heroes.find((h) => h.id === 101);
  assert.equal(aw.awakenLevel, 2, 'awakening is account truth: the snapshot wins');
  assert.equal(aw.fullAwaken, true);
  assert.equal(r.merged.decorations.ids.length, 40, 'auto: the report decor stays (the snapshot only fills gaps)');
  // bookmarklet-first pin: the live decor snapshot wins
  const bm = make((u) => { const m = /\/supplement\/([a-z]+)\//.exec(u); return m && worker[m[1]] ? { status: 200, body: worker[m[1]] } : undefined; }, { armory_source_priority: 'bookmarklet' });
  const rbm = await bm.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(rbm.merged.decorations.ids.length, 2);
  assert.deepStrictEqual(rbm.merged.decorations.suit, [1201]);
  // reports-first pin: decor stays the report's
  const b = make((u) => { const m = /\/supplement\/([a-z]+)\//.exec(u); return m && worker[m[1]] ? { status: 200, body: worker[m[1]] } : undefined; }, { armory_source_priority: 'reports' });
  const rb = await b.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(rb.merged.decorations.ids.length, 40);
  assert.equal(b.d.sourcePriority(), 'reports');
});

test('no reports at all (data only): a code whose reports are gone gives state empty with the identity still filled in', async () => {
  const a = make((u) => (u.includes('aliyuncs') ? { status: 404, body: {} } : undefined), ident());
  const r = await a.d.loadArmory({ code: 'ABCD' });
  assert.equal(r.state, 'empty');
  assert.equal(r.identity.siteKey, W.SK);
});

test('instances share nothing: token, privacy map, promise cache and roster are per create()', async () => {
  const a = make(null, ident()), b = make();
  await a.d.handshake(W.UID_RAW);
  assert.equal(a.d.token(), 'tok-1');
  assert.equal(b.d.token(), null);
  assert.equal(b.storage.getItem('armoryToken'), null);
  await a.d.fetchJson('data/rune-types.json');
  assert.equal(a.fetch.calls.filter((c) => c.url === 'data/rune-types.json').length, 1);
  await a.d.fetchJson('data/rune-types.json');
  assert.equal(a.fetch.calls.filter((c) => c.url === 'data/rune-types.json').length, 1, 'one promise cache per instance');
  await b.d.fetchJson('data/rune-types.json');
  assert.equal(b.fetch.calls.filter((c) => c.url === 'data/rune-types.json').length, 1);
  assert.notEqual(a.d.core, b.d.core);
});

test('static data: one fetch per file for a whole load; a failed file is reported and the load still completes', async () => {
  const a = make((u) => (u === 'data/decoration-index.json' ? { status: 500, body: {} } : undefined));
  const r = await a.d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME } });
  assert.equal(r.state, 'ready');
  assert.ok(r.errors.some((e) => e.kind === 'static' && e.name === 'decorIndex'));
  assert.equal(r.statics.decorIndex, null);
  assert.ok(r.statics.runeTypes && r.statics.decorLevels && r.statics.decorLookups && r.statics.itemTable);
  const n = (f) => a.fetch.calls.filter((c) => c.url === 'data/' + f).length;
  assert.equal(n('decor-lookups.json'), 1, 'decor lookups are fetched once although two loaders want them');
  assert.equal(n('item-table.json'), 1);
  assert.equal(n('all-heroes.json'), 1);
  // a failed file is not cached: the next call retries
  await a.d.fetchJson('data/decoration-index.json').then(() => assert.fail('should reject'), () => {});
  assert.equal(n('decoration-index.json'), 2);
});

test('no DOM and no global network or storage: the module reads only the fetch and storage it is given', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../pages/armory-data.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
  assert.ok(!/\bdocument\b|\bsessionStorage\b|XMLHttpRequest|\bnavigator\b|addEventListener|\blocation\b/.test(code));
  // `fetch` and `localStorage` are factory variables (so a stub replaces them); the only global reads are the defaults for a browser
  assert.match(code, /var fetch = env\.fetch/);
  assert.match(code, /var localStorage = env\.storage/);
});

test('verifyUid: a UID that is a roster player (not this report) heals playerIdentity and unlocks that player (v1 Unlock modal)', async () => {
  const a = make(null, ident('aaaaaaaaaaaaaaaa', 'Stale'));
  const r = await a.d.verifyUid('aaaaaaaaaaaaaaaa', W.UID_RAW);
  assert.equal(r.ok, true); assert.equal(r.healed, true); assert.equal(r.siteKey, W.SK);
  const id = JSON.parse(a.storage.getItem('playerIdentity'));
  assert.equal(id.siteKey, W.SK); assert.equal(id.name, W.NAME); assert.equal(id.alliance, 'DOG');
  assert.equal(a.d.isUnlocked(W.SK), true);
  assert.deepStrictEqual(a.fetch.calls.find((c) => c.url.includes('/handshake')).body, { uid: W.UID_RAW });
});

test('saved report: a stale _viewOnly and a missing siteKey are healed for the signed-in player (v1 initFromSaved)', async () => {
  const saved = { _viewOnly: true, player: { name: W.NAME }, reportIds: [W.REPORT_ID] };
  const a = make(null, Object.assign(ident(), { playerReport: JSON.stringify(saved) }));
  const r = await a.d.loadArmory({ saved: true });
  assert.equal(r.readOnly, false);
  assert.equal(r.player.siteKey, W.SK);
  const kept = JSON.parse(a.storage.getItem('playerReport'));
  assert.equal(kept._viewOnly, false); assert.equal(kept.player.siteKey, W.SK);
  // a different siteKey is NOT healed to the signed-in one (bug 107: siteKey decides)
  const other = { _viewOnly: true, player: { name: W.NAME, siteKey: 'bbbbbbbbbbbbbbbb' }, reportIds: [W.REPORT_ID] };
  const b = make(null, Object.assign(ident(), { playerReport: JSON.stringify(other) }));
  assert.equal((await b.d.loadArmory({ saved: true })).readOnly, true);
  assert.equal(JSON.parse(b.storage.getItem('playerReport')).player.siteKey, 'bbbbbbbbbbbbbbbb');
});

test('noHydrate: the first paint reads local supplements only (no /supplement request)', async () => {
  const a = make(null, Object.assign(ident(), { playerReport: JSON.stringify({ player: { name: W.NAME, siteKey: W.SK }, reportIds: [W.REPORT_ID] }) }));
  const r = await a.d.loadArmory({ saved: true, noHydrate: true });
  assert.equal(r.state, 'ready');
  assert.ok(!a.fetch.calls.some((c) => c.url.includes('/supplement/')), 'nothing asked of the supplement endpoints');
});

test('data only: no report, own siteKey, game data from the worker; no data or no siteKey is "none"', async () => {
  const withInv = (u) => (u === suppUrl('inv') ? { status: 200, body: invSupp(new Date().toISOString()) } : undefined);
  const a = make(withInv, ident());
  const r = await a.d.loadArmory({ dataOnly: true });
  assert.equal(r.state, 'ready'); assert.equal(r.readOnly, false); assert.deepStrictEqual(r.reports, []);
  assert.ok(r.sources.kinds.indexOf('inv') >= 0 && r.sources.dataTs > 0);
  assert.ok(r.merged && Array.isArray(r.merged.heroes));
  assert.equal((await make(null, ident()).d.loadArmory({ dataOnly: true })).state, 'none', 'identity but no game data');
  assert.equal((await make().d.loadArmory({ dataOnly: true })).state, 'none', 'no identity');
  assert.equal((await make(withInv, ident('zzzz')).d.loadArmory({ dataOnly: true })).state, 'none', 'a malformed siteKey is never used');
});
