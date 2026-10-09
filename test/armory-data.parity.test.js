'use strict';
// Parity: pages/armory-data.js against pages/armory-report.html (armory redesign, phase 2a). Every function and var in
// section 1 of the module is a verbatim copy. This test pulls the same name out of the page and requires
// (1) the exact source text in the module file, and (2) the same behaviour when the PAGE's text and the module run
// against the same stub fetch / storage: report fetch + CN fallback, identity, handshake, supplement fetch
// (404 + cleared marker, 403 privacy), hydrate, roster map, extract, the supplement merge.
// Run: node --test test/armory-data.parity.test.js
// ARMORY_FILE=<scratch copy of the page> proves it fails when the page changes (docs/armory-review-2026-10/v2-phase1.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./helpers/armory-page.js');
const W = require('./helpers/armory-world.js');
const AD = require('../pages/armory-data.js');
const Core = require('../pages/armory-core.js');

const FILE = fs.readFileSync(path.join(P.ROOT, 'pages/armory-data.js'), 'utf8');
const FNS = ['fetchReportResponse', 'fetchJson', '_ar_validReportId', 'getStoredIdentity', '_ar_plainError', '_ar_handshake', '_ar_storeUid',
  '_ar_getStoredUid', '_ar_ensureSupplementToken', '_ar_sha256Hex', '_ar_isUnlocked', '_ar_setUnlocked', '_ar_supTsMs', '_ar_clearedTsFrom',
  '_ar_shouldDropForClear', '_ar_dropLocalSupplement', '_ar_applyClearedMarker', '_ar_recentlyCleared', '_ar_fetchSupplementPrivacy',
  '_ar_isSupplementPrivate', '_ar_fetchSupplement', '_ar_hydrateSupplementsFromWorker', '_ar_getRosterMap', '_ar_loadItemTable',
  '_ar_loadInvLookups', '_ar_supplementLocalTs', '_ar_lastSnapshotTs', '_ar_getSourcePriority', '_ar_gearPieceToEquip',
  '_ar_synthHeroesFromSupp', '_ar_synthEnigmasFromSupp', '_ar_applySupplementsToMerged', 'resolveAvatar', 'getAvatar', 'extractPlayerData'];
const VARS = ['CDN_BASE', 'CDN_BASE_CN', 'PUSH_WORKER', '_ar_jsonCache', 'ArmoryIdentity', 'SUPPLEMENT_WORKER', '_ar_supplementToken',
  '_ar_supplementTokenExpires', '_ar_supplementPrivacy', '_ar_rosterMap', '_ar_rosterByName', '_ar_rosterList', '_ar_rosterPromise',
  '_ar_invLookups', '_AR_SNAPSHOT_KINDS'];

test('every copied function and var is the exact text of the page (names are not renamed, bodies not re-indented)', () => {
  for (const n of FNS) {
    const src = P.fnSource(n);
    assert.ok(src, 'page has function ' + n);
    assert.ok(FILE.includes(src), 'module carries the exact text of ' + n);
  }
  for (const n of VARS) {
    const src = P.varSource(n);
    assert.ok(src, 'page has var ' + n);
    assert.ok(FILE.includes(src), 'module carries the exact text of ' + n);
  }
  // the module's file lists them in its header comment order: nothing copied is missing from the lists above
  const marked = FILE.slice(FILE.indexOf('/* ---- copied verbatim from'), FILE.indexOf('/* ---- NOT copied'));
  const declared = (marked.match(/^  (?:async )?function (\w+)\(/gm) || []).map((x) => x.replace(/^  (?:async )?function /, '').replace('(', ''));
  assert.deepStrictEqual(declared.slice().sort(), FNS.slice().sort(), 'the module copies exactly these functions, no more');
});

// ---- behaviour: the page's text vs the module on the same stubs ------------------------------------------------------
function pageSide(handler, storageInit) {
  const fetch = W.makeFetch(handler);
  const localStorage = W.memStorage(storageInit);
  const ctx = P.loadPage(FNS.concat(VARS, ['_ar_synthDecorationsFromSupp', '_ar_synthSkinsFromSupp']), { fetch, localStorage, crypto: require('node:crypto').webcrypto, TextEncoder, location: { reload() {} } });
  return { ctx, fetch, localStorage };
}
function moduleSide(handler, storageInit) {
  const fetch = W.makeFetch(handler);
  const storage = W.memStorage(storageInit);
  return { d: AD.create({ fetch, storage }), fetch, storage };
}
const urls = (f) => f.calls.map((c) => c.url + ' ' + JSON.stringify(c.opts));

test('fetchReportResponse: same requests in the same order, same answer, for 200 / 404 + CN / network error + CN / both fail', async () => {
  const gl = W.reportUrl(W.CDN, W.REPORT_ID), cn = W.reportUrl(W.CDN_CN, W.REPORT_ID);
  const cases = [
    (u) => (u === gl ? { status: 200, body: { a: 1 } } : undefined),
    (u) => (u === gl ? { status: 404, body: {} } : { status: 200, body: { a: 2 } }),
    (u) => { if (u === gl) throw new Error('x'); return { status: 200, body: { a: 3 } }; },
    () => undefined,
    (u) => { throw new Error('all down ' + u); },
  ];
  for (const h of cases) {
    const p = pageSide(h), m = moduleSide(h);
    const settle = (pr) => pr.then((r) => ({ status: r.status, ok: r.ok }), (e) => ({ error: String(e.message) }));
    assert.deepStrictEqual(await settle(m.d.fetchReportResponse(W.REPORT_ID)), await settle(p.ctx.fetchReportResponse(W.REPORT_ID)));
    assert.deepStrictEqual(urls(m.fetch), urls(p.fetch));
  }
});

test('ArmoryIdentity + identity helpers: identical reads and writes against the same storage', () => {
  const init = { playerIdentity: JSON.stringify({ name: 'T', siteKey: W.SK }), armory_unlocked: '{"x":true}' };
  const p = pageSide(() => undefined, init), m = moduleSide(() => undefined, init);
  const run = (api, st) => {
    const out = [];
    out.push(api.get(), api.getUnlocked(), api.isUnlocked('x'), api.getUid('k'));
    api.setUid('k', '555'); out.push(api.getUid('k'));
    api.setSupplement('inv', 'k', { a: 1 }); out.push(api.getSupplement('inv', 'k'));
    api.setLastSync('inv', 'k', 12); out.push(api.getLastSync('inv', 'k'));
    api.removeSupplement('inv', 'k'); api.removeLastSync('inv', 'k'); api.clearUid('k');
    out.push(api.KINDS, st.dump());
    return P.j(out);
  };
  assert.deepStrictEqual(run(m.d.identity, m.storage), run(p.ctx.ArmoryIdentity, p.localStorage));
  const a = { playerIdentity: 'anonymous' };
  assert.equal(moduleSide(() => undefined, a).d.getStoredIdentity(), pageSide(() => undefined, a).ctx.getStoredIdentity());
});

test('handshake + ensureToken: same request, same stored token, same plain error', async () => {
  const handler = (u) => (u.endsWith('/handshake') ? { status: 200, body: { token: 't', expires: 4102444800000, siteKey: W.SK } } : undefined);
  const p = pageSide(handler), m = moduleSide(handler);
  await p.ctx._ar_handshake(W.UID_RAW); await m.d.handshake(W.UID_RAW);
  assert.deepStrictEqual(urls(m.fetch), urls(p.fetch));
  assert.deepStrictEqual(m.storage.dump(), p.localStorage.dump());
  assert.equal(m.d.token(), p.ctx._ar_supplementToken);
  assert.equal(m.d.tokenExpires(), p.ctx._ar_supplementTokenExpires);
  await p.ctx._ar_ensureSupplementToken(W.SK); await m.d.ensureToken(W.SK);
  assert.equal(m.fetch.calls.length, p.fetch.calls.length, 'a fresh token: no second call on either side');
  for (const status of [401, 403, 404, 409, 413, 429, 500, 418]) {
    const h = () => ({ status, body: 'nope' });
    const pe = await pageSide(h).ctx._ar_handshake('1').catch((e) => e.message);
    const me = await moduleSide(h).d.handshake('1').catch((e) => e.message);
    assert.equal(me, pe, 'status ' + status);
  }
});

test('supplement fetch: 200, 404 with header, 404 with body, 404 plain, 403, 500, network error: same answer and same side effects', async () => {
  const t = 1780000000000;
  const cases = [
    { status: 200, body: { ts: 'x' } },
    { status: 404, body: {}, headers: { 'X-Supplement-Cleared': String(t) } },
    { status: 404, body: { cleared: t } },
    { status: 404, body: { clearedTs: t } },
    { status: 404, body: {} },
    { status: 403, body: {} },
    { status: 500, body: {} },
    'throw',
  ];
  for (const c of cases) {
    const h = (u) => { if (!u.includes('/supplement/inv/')) return undefined; if (c === 'throw') throw new Error('x'); return c; };
    const init = { ['armory_inv_' + W.SK]: '{"ts":"2020-01-01T00:00:00Z"}', ['armory_justCleared_' + W.SK]: String(Date.now()) };
    const p = pageSide(h, init), m = moduleSide(h, init);
    for (const fresh of [false, true]) {
      assert.deepStrictEqual(P.j(await m.d.fetchSupplement('inv', W.SK, fresh)), P.j(await p.ctx._ar_fetchSupplement('inv', W.SK, fresh)), JSON.stringify(c) + ' fresh=' + fresh);
    }
    assert.deepStrictEqual(urls(m.fetch), urls(p.fetch));
    assert.deepStrictEqual(m.storage.dump(), p.localStorage.dump());
    assert.equal(m.d.isSupplementPrivate(W.SK, 'inv'), p.ctx._ar_isSupplementPrivate(W.SK, 'inv'));
  }
});

test('clear-marker helpers: identical over a grid of inputs', () => {
  const p = pageSide(() => undefined).ctx, m = moduleSide(() => undefined).d;
  const vals = [undefined, null, 0, '', '1780000000000', 1780000000000, -5, 'abc', { cleared: 5 }, { clearedTs: '7' }, { cleared: 'x' }, []];
  for (const h of vals) for (const b of vals) assert.equal(m.clearedTsFrom(h, b), p._ar_clearedTsFrom(h, b));
  for (const a of [0, 5, 6, undefined, null, NaN]) for (const b of [0, 5, 6, undefined, null, -1]) assert.equal(m.shouldDropForClear(a, b), p._ar_shouldDropForClear(a, b));
  const objs = [null, 'x', {}, { meta: { ts: '2026-05-01T00:00:00Z' } }, { ts: '2026-05-01T00:00:00Z' }, { ts: 'garbage' }, { meta: {} }];
  for (const k of ['inv', 'gear', 'runepool', 'heroes', 'chips', 'decor']) for (const o of objs) assert.equal(m.supTsMs(k, o), p._ar_supTsMs(k, o));
});

test('hydrate: same requests, same adopted data, same changed list (newer adopted, older kept, cleared dropped, private skipped)', async () => {
  const mk = (ts) => ({ ts, list: [] });
  const worker = {
    heroes: { status: 200, body: mk('2026-05-02T00:00:00Z') }, bench: { status: 200, body: mk('2026-05-01T00:00:00Z') },
    chips: { status: 404, body: {}, headers: { 'X-Supplement-Cleared': String(Date.parse('2026-05-10T00:00:00Z')) } },
    formation: { status: 403, body: {} }, decor: { status: 200, body: { ts: '2026-05-03T00:00:00Z', active: [] } },
  };
  const h = (u) => {
    const m = /\/supplement\/([a-z]+)\/[0-9a-f]{16}$/.exec(u);
    if (m) return worker[m[1]];
    if (u.includes('/supplement/privacy/')) return { status: 200, body: { formation: true } };
  };
  const init = {
    ['armory_heroes_' + W.SK]: JSON.stringify(mk('2026-04-01T00:00:00Z')), ['armory_bench_' + W.SK]: JSON.stringify(mk('2026-06-01T00:00:00Z')),
    ['armory_chips_' + W.SK]: JSON.stringify(mk('2026-05-05T00:00:00Z')), ['armory_formation_' + W.SK]: JSON.stringify(mk('2026-05-05T00:00:00Z')),
  };
  const p = pageSide(h, init), m = moduleSide(h, init);
  const pc = await p.ctx._ar_hydrateSupplementsFromWorker(W.SK), mc = await m.d.hydrateSupplements(W.SK);
  assert.deepStrictEqual(P.j(mc), P.j(pc));
  assert.ok(mc.includes('heroes') && mc.includes('chips') && mc.includes('decor') && !mc.includes('bench'));
  assert.deepStrictEqual(urls(m.fetch).sort(), urls(p.fetch).sort());
  assert.deepStrictEqual(m.storage.dump(), p.localStorage.dump());
  assert.equal(P.j(p.ctx._ar_lastSnapshotTs(W.SK)), P.j(m.d.lastSnapshotTs(W.SK)));
});

test('roster map: same maps, one fetch, failure not cached', async () => {
  const roster = { players: [{ siteKey: 'aa', name: 'Zed' }, { siteKey: 'bb', name: 'amy' }, { name: 'nokey' }] };
  const h = (u) => (u === 'player-data.json' ? { status: 200, body: roster } : undefined);
  const p = pageSide(h), m = moduleSide(h);
  assert.deepStrictEqual(P.j(await m.d.getRosterMap()), P.j(await p.ctx._ar_getRosterMap()));
  await m.d.getRosterMap(); await p.ctx._ar_getRosterMap();
  assert.deepStrictEqual(urls(m.fetch), urls(p.fetch));
  assert.equal(m.fetch.calls.length, 1);
  let fail = true;
  const h2 = () => { if (fail) throw new Error('down'); return { status: 200, body: [] }; };
  const m2 = moduleSide(h2), p2 = pageSide(h2);
  await assert.rejects(m2.d.getRosterMap()); await assert.rejects(p2.ctx._ar_getRosterMap());
  fail = false;
  assert.deepStrictEqual(P.j(await m2.d.getRosterMap()), P.j(await p2.ctx._ar_getRosterMap()));
});

test('extractPlayerData + avatar: identical on a synthetic report (found, trimmed name, other side, missing, no battle)', () => {
  const p = pageSide(() => undefined).ctx, m = moduleSide(() => undefined).d;
  const rep = W.battleReport();
  const def = JSON.parse(JSON.stringify(rep));
  def.battle.defender.players[0] = def.battle.attacker.players[0];
  def.battle.defender.mechas = [{ mechaId: 1005, chips: [] }];
  def.battle.attacker.players = [];
  for (const [data, name] of [[rep, W.NAME], [rep, ' Tester '], [def, W.NAME], [rep, 'Nobody'], [{}, W.NAME], [{ battle: null }, W.NAME]]) {
    assert.deepStrictEqual(P.j(m.extractPlayerData(data, name)), P.j(p.extractPlayerData(data, name)));
  }
  const pi = { headimgurl_custom: 'https://x/a.jpg', avatarurl: 'hero_icon1_global' };
  assert.equal(p.getAvatar(pi), 'https://x/a.jpg');
  assert.equal(p.getAvatar({ avatarurl: 'hero_icon1_global' }), 'https://h5.topwargame.com/DynRes/images/headpic/hero_icon1_global.png?t=21.jpg');
  assert.equal(p.getAvatar({}), null);
});

test('supplement merge: _ar_applySupplementsToMerged is identical under all three source priorities (heroes, enigmas, decor, skins, awakening)', () => {
  const gear = P.fixture('gear-supp.json').gearSupp;
  const supp = {
    heroes: { ts: 't', list: [{ id: 101, lv: 120, st: 5, q: 5, t: 0, pwr: 9, aw: 3, aws: 'x', fa: true, ap: 2, p1: { a: 1 } }, { id: 102, lv: 60, st: 2, q: 4, pwr: 3 }, { id: 103, aw: 0 }] },
    gear, enigma: { ts: 't', beasts: [{ id: 1, cfgId: 25, st: 1, lv: 10, pot: 1500, mb: 520000, bb: [{ id: 520010 }], type: 3, fac: 2, q: 4 }], fields: [{ fid: 1, holes: [{ hid: 1, lv: 1, beastId: 1 }] }] },
    decor: { ts: 't', active: [{ id: 49803 }, { id: 50566 }], suits: [{ suitId: 1201, rewarded: true, rewardedLevel: 2 }, null, { suitId: 1202, rewarded: false }] },
    skin: { ts: 't', activeSkinId: 4, ownedSkins: [1, 2], collectSkins: [3], ownedNameplates: [9] },
  };
  const baseMerged = () => P.clone({
    heroes: [{ id: 101, awakenLevel: 0, heroEquips: [] }, { id: 102, awakenLevel: 1, heroEquips: [] }],
    decorations: { ids: [1, 2, 3], suit: [], suitLevelBuff: {} }, skins: null, enigmas: null, ctcs: null, mechas: [],
  });
  for (const pri of [null, 'auto', 'reports', 'bookmarklet']) {
    for (const merged0 of [baseMerged, () => ({ heroes: [], decorations: null, skins: null, enigmas: null })]) {
      const init = {}; if (pri) init.armory_source_priority = pri;
      Object.keys(supp).forEach((k) => { init['armory_' + k + '_' + W.SK] = JSON.stringify(supp[k]); });
      const p = pageSide(() => undefined, init), m = moduleSide(() => undefined, init);
      const pm = merged0(), mm = merged0();
      p.ctx._ar_applySupplementsToMerged(pm, W.SK);
      m.d.applySupplementsToMerged(mm, W.SK);
      assert.deepStrictEqual(P.j(mm), P.j(pm), 'priority ' + pri);
      // the enigma decode hint lands on the instance's own window (the page's is the page window)
      assert.deepStrictEqual(P.j(m.d.suppDecode()), P.j(p.ctx.window._enigmaSuppDecode || null));
    }
  }
  // and null merged / siteKey are no-ops on both
  const p = pageSide(() => undefined), m = moduleSide(() => undefined);
  assert.equal(p.ctx._ar_applySupplementsToMerged(null, W.SK), m.d.applySupplementsToMerged(null, W.SK));
  assert.equal(p.ctx._ar_applySupplementsToMerged({}, ''), m.d.applySupplementsToMerged({}, ''));
});

test('item table / inventory lookups: same URLs, one fetch each', async () => {
  const h = (u) => W.staticRoute(u) || undefined;
  const p = pageSide(h), m = moduleSide(h);
  assert.deepStrictEqual(P.j(await m.d.loadItemTable()), P.j(await p.ctx._ar_loadItemTable()));
  const pl = await p.ctx._ar_loadInvLookups(), ml = await m.d.loadInvLookups();
  assert.deepStrictEqual(Object.keys(ml).sort(), Object.keys(pl).sort());
  assert.deepStrictEqual(urls(m.fetch).sort(), urls(p.fetch).sort());
});
