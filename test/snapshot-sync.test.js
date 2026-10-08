'use strict';
// Snapshot → armory direct sync (Tex, 2026-10-08): the bookmarklet signs in with the worker using the game's own UID
// and uploads every section the armory's paste-import would. Run: node --test test/snapshot-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../all-bookmarklet.js');

const W = 'https://worker.test';
function dump(o) {
  return Object.assign({
    v: 3, ts: '2026-10-08T10:00:00.000Z', meta: { uid: '1234567890', lvl: 100, sid: 2864 },
    inventory: { v: 1, meta: { uid: '1234567890', lvl: 100, sid: 2864, ts: '2026-10-08T10:00:00.000Z' }, resources: { gold: 5, _paidgold: 9, _payCNYTotal: 8 }, tabs: {} },
    beasts: { v: 1, ts: '2026-10-08T10:00:00.000Z', beasts: [] },
    chips: { v: 1, chips: [] },
    gear: { v: 1, meta: { ts: '2026-10-08T10:00:00.000Z' }, summary: {} },
    heroes: null, formation: null, enigmaState: { v: 1, fields: [] }, decorations: null, baseSkin: null, errors: []
  }, o || {});
}
// A fake worker: records calls; handshake answers per `hs`, uploads per `up(kind)`.
function fakeFetch(opts) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (opts.down) throw new Error('network');
    if (url === W + '/supplement/handshake') {
      const st = opts.hs || 200;
      return { ok: st === 200, status: st, json: async () => (st === 200 ? { token: 'tok123', siteKey: 'abcd' } : { error: 'x' }) };
    }
    const kind = JSON.parse(init.body).kind, st = (opts.up && opts.up(kind)) || 200;
    return { ok: st === 200, status: st, json: async () => (st === 200 ? { ok: true } : { error: 'schema: bad ' + kind }) };
  };
  f.calls = calls;
  return f;
}

test('the section list matches the armory\'s paste import (field → kind)', () => {
  assert.deepEqual(S.SECTIONS.map((s) => s.field + ':' + s.kind),
    ['inventory:inv', 'beasts:bench', 'chips:chips', 'gear:gear', 'heroes:heroes', 'formation:formation', 'enigmaState:enigma', 'decorations:decor', 'baseSkin:skin']);
});

test('sends: one handshake with the game UID, then each present section with the Bearer token', async () => {
  const f = fakeFetch({});
  const r = await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '1234567890', now: '2026-10-08T11:00:00.000Z' });
  assert.equal(r.state, 'done');
  assert.deepEqual(r.results.map((x) => x.kind + ':' + x.status), ['inv:ok', 'bench:ok', 'chips:ok', 'gear:ok', 'enigma:ok']);
  assert.equal(f.calls[0].url, W + '/supplement/handshake');
  assert.deepEqual(f.calls[0].body, { uid: '1234567890' });
  const ups = f.calls.slice(1);
  assert.equal(ups.length, 5);
  ups.forEach((c) => { assert.equal(c.url, W + '/supplement/upload'); assert.equal(c.init.headers.Authorization, 'Bearer tok123'); });
});

test('uploads never carry the UID or the spending fields, and a missing time is stamped where the armory reads it', async () => {
  const f = fakeFetch({});
  const d = dump();
  await S.sendToArmory(d, { fetch: f, worker: W, uid: '1234567890', now: '2026-10-08T11:00:00.000Z' });
  const byKind = {}; f.calls.slice(1).forEach((c) => { byKind[c.body.kind] = c.body.json; });
  assert.equal(byKind.inv.meta.uid, undefined);
  assert.equal(byKind.inv.resources._paidgold, undefined);
  assert.equal(byKind.inv.resources._payCNYTotal, undefined);
  assert.equal(byKind.inv.resources.gold, 5);
  assert.equal(byKind.chips.ts, '2026-10-08T11:00:00.000Z', 'ts stamped');
  assert.equal(byKind.bench.ts, '2026-10-08T10:00:00.000Z', 'existing ts kept');
  assert.equal(d.inventory.meta.uid, '1234567890', 'the dump itself (for Copy) is untouched');
  assert.ok(!JSON.stringify(f.calls.slice(1).map((c) => c.body)).includes('1234567890'), 'the UID appears in no upload');
});

test('not on the roster: one handshake, no uploads', async () => {
  const f = fakeFetch({ hs: 403 });
  const r = await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '1234567890' });
  assert.equal(r.state, 'not-member');
  assert.equal(f.calls.length, 1);
});

test('worker unreachable or no UID: an error, nothing uploaded', async () => {
  assert.equal((await S.sendToArmory(dump(), { fetch: fakeFetch({ down: true }), worker: W, uid: '1234567890' })).state, 'error');
  assert.equal((await S.sendToArmory(dump(), { fetch: fakeFetch({ hs: 429 }), worker: W, uid: '1234567890' })).state, 'error');
  const f = fakeFetch({});
  assert.equal((await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '' })).state, 'no-uid');
  assert.equal(f.calls.length, 0);
});

test('one section refused or too large does not stop the others', async () => {
  const big = { v: 1, ts: 't', chips: [{ x: 'y'.repeat(1100000) }] };
  const f = fakeFetch({ up: (k) => (k === 'gear' ? 400 : 200) });
  const r = await S.sendToArmory(dump({ chips: big }), { fetch: f, worker: W, uid: '1234567890' });
  const st = {}; r.results.forEach((x) => { st[x.kind] = x.status; });
  assert.deepEqual(st, { inv: 'ok', bench: 'ok', chips: 'too-large', gear: 'failed', enigma: 'ok' });
  assert.match(r.results.find((x) => x.kind === 'gear').error, /schema: bad gear/);
  assert.ok(!f.calls.some((c) => c.body && c.body.kind === 'chips'), 'the too-large section is not sent');
});

test('summary text for the card', () => {
  const ok = (k, l) => ({ kind: k, label: l, status: 'ok' });
  assert.equal(S.syncText({ state: 'done', results: [ok('inv', 'Inventory'), ok('bench', 'Beasts')] }).text, 'Armory updated: Inventory, Beasts.');
  const part = S.syncText({ state: 'done', results: [ok('inv', 'Inventory'), { kind: 'gear', label: 'Titan gear', status: 'failed' }] });
  assert.equal(part.text, 'Armory updated: Inventory. Not saved: Titan gear.');
  assert.equal(part.tone, 'warn');
  assert.match(S.syncText({ state: 'not-member' }).text, /isn't on the Server 2864 roster/);
  assert.match(S.syncText({ state: 'error' }).text, /Couldn't reach your armory/);
  [ok('inv', 'Inventory')].concat([S.syncText({ state: 'error' }), S.syncText({ state: 'not-member' })]).forEach((x) => assert.ok(!/—/.test(JSON.stringify(x)), 'no em dash'));
});

// ---- "Set up my armory report" from the latest Time Clash attacks (Tex, 2026-10-08)
const ME = '1234567890';
const log = (id, t, att) => ({ reportId: id, time: t, isAttacker: att ? 1 : 0, isWin: 1, pos: 5 });
const report = (side, heroes, uid) => ({ battle: { attacker: { players: [] }, defender: { players: [] }, [side]: { players: [{ uid: uid || ME, heroList: heroes.map((h) => ({ heroId: h })) }] } } });

test('attackLogs: only our attacks (a defense report needs an attack first), newest first', () => {
  const out = S.attackLogs([log('a', 100, 0), log('b', 300, 1), log('c', 200, 1), { reportId: '', time: 400, isAttacker: 1 }, null]);
  assert.deepEqual(out.map((l) => l.reportId), ['b', 'c']);
  assert.deepEqual(S.attackLogs(undefined), []);
});

test('heroSetOf: our march on either side, sorted; null when we are not in the report', () => {
  assert.deepEqual(S.heroSetOf(report('attacker', [173, 165, 172]), ME), [165, 172, 173]);
  assert.deepEqual(S.heroSetOf(report('defender', [338, 332, 334]), ME), [332, 334, 338]);
  assert.equal(S.heroSetOf(report('attacker', [1, 2, 3], '999'), ME), null);
  assert.equal(S.heroSetOf(null, ME), null);
});

test('pickReports: the newest report for each different 3-hero march, up to the chosen number', async () => {
  const reps = { r1: report('attacker', [165, 172, 173]), r2: report('attacker', [173, 172, 165]), r3: report('attacker', [332, 334, 338]),
    r4: report('attacker', [169, 170, 174]), r5: report('attacker', [1, 2, 3]) };
  const logs = [log('r1', 500, 1), log('d1', 450, 0), log('r2', 400, 1), log('r3', 300, 1), log('bad', 250, 1), log('r4', 200, 1), log('r5', 100, 1)];
  const fetched = [];
  const fetchReport = async (id) => { fetched.push(id); if (id === 'bad') throw new Error('404'); return reps[id]; };
  const r = await S.pickReports(logs, { fetchReport, uid: ME, max: 3 });
  assert.deepEqual(r.picked.map((p) => p.reportId), ['r1', 'r3', 'r4']);
  assert.deepEqual(r.picked[1].heroes, [332, 334, 338]);
  assert.ok(!fetched.includes('d1'), 'defense reports are never fetched');
  assert.ok(!fetched.includes('r5'), 'stops once it has enough');
  assert.equal(r.attacks, 6);
  const all = await S.pickReports(logs, { fetchReport, uid: ME, max: 99 });
  assert.equal(all.picked.length, 4, 'max is capped at 6 and limited by distinct marches');
  assert.equal(S.SETUP_MAX, 6);
});

test('pickReports reads at most 20 attacks', async () => {
  const logs = Array.from({ length: 30 }, (_, i) => log('x' + i, 1000 - i, 1));
  let n = 0;
  const r = await S.pickReports(logs, { fetchReport: async () => { n++; return report('attacker', [1, 2, 3]); }, uid: ME, max: 6 });
  assert.equal(n, 20);
  assert.equal(r.picked.length, 1);
});

test('parseLogAnswer: the game answer {s:0, d:"{logs}"} → logs; anything else → null', () => {
  assert.deepEqual(S.parseLogAnswer({ s: 0, d: JSON.stringify({ logs: [log('a', 1, 1)] }) }), [log('a', 1, 1)]);
  assert.equal(S.parseLogAnswer({ s: 3, d: 'err' }), null);
  assert.equal(S.parseLogAnswer({ s: 0, d: 'not json' }), null);
  assert.equal(S.parseLogAnswer(null), null);
});

test('saveReportSetup: one config per Snapshot device, report ids in order, each picked march named', async () => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), origin: init.headers }); return { ok: true, status: 201, json: async () => ({ ok: true, shortcode: 'AB12' }) }; };
  const picked = [{ reportId: '4876001', heroes: [165, 172, 173] }, { reportId: '4875002', heroes: [332, 334, 338] }];
  const r = await S.saveReportSetup(picked, { fetch: f, worker: W, siteKey: 'abcdabcdabcdabcd', name: 'Tex' });
  assert.deepEqual(r, { ok: true, code: 'AB12' });
  assert.equal(calls[0].url, W + '/report-config');
  assert.deepEqual(calls[0].body, { siteKey: 'abcdabcdabcdabcd', playerName: 'Tex', deviceId: 'ops-snapshot', reportIds: '4876001,4875002',
    marchGroups: [{ name: 'March 1', heroIds: [165, 172, 173] }, { name: 'March 2', heroIds: [332, 334, 338] }] });
  const bad = async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error: 'rate_limited' }) });
  assert.deepEqual(await S.saveReportSetup(picked, { fetch: bad, worker: W, siteKey: 'a', name: 'b' }), { ok: false, error: 'rate_limited' });
});

test('setupText for the card', () => {
  assert.equal(S.setupText({ state: 'done', picked: [1, 2, 3] }).text, 'Armory report set up with your latest 3 different marches.');
  assert.equal(S.setupText({ state: 'done', picked: [1] }).text, 'Armory report set up with your latest march.');
  // fewer different marches than asked: still set up, and says so
  assert.equal(S.setupText({ state: 'done', picked: [1, 2, 3], asked: 6 }).text,
    'Armory report set up with your latest 3 different marches. You asked for 6, but your recent Time Clash attacks only had 3 different marches.');
  assert.equal(S.setupText({ state: 'done', picked: [1], asked: 4 }).text,
    'Armory report set up with your latest march. You asked for 4, but your recent Time Clash attacks only had 1 march.');
  assert.equal(S.setupText({ state: 'done', picked: [1, 2], asked: 2 }).text, 'Armory report set up with your latest 2 different marches.');
  assert.match(S.setupText({ state: 'no-attacks' }).text, /Fight at least one Time Clash battle first/);
  assert.match(S.setupText({ state: 'unreadable' }).text, /Couldn't read your Time Clash reports/);
  assert.match(S.setupText({ state: 'save-failed' }).text, /Couldn't save/);
  assert.match(S.setupText({ state: 'no-log' }).text, /Couldn't get your Time Clash reports/);
});
