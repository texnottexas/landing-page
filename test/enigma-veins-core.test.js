'use strict';
// Enigma Veins rules. Run: node --test test/enigma-veins-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../enigma-veins-core.js');

const L = (n) => ({ toNumber: () => n, toString: () => String(n) });   // the game's protobuf Longs
const NOW = 1792000000000;
const vein = (o) => Object.assign({ uid: 'finder', x: 571, y: 329, expireTimeMilli: L(NOW + 3600000), gatherStatus: 0 }, o);

test('findEvent: the Enigma Field Hunt by type 279 or showUiType, only between its begin and end', () => {
  const s = NOW / 1000;
  const ev = { id: 83000157, type: 279, showUiType: 'domainTreasure', begintime: s - 60, endtime: s + 600 };
  assert.equal(V.findEvent([{ id: 1, type: 292, endtime: s + 600 }, ev], s), ev);
  assert.equal(V.findEvent([Object.assign({}, ev, { type: 0 })], s).id, 83000157, 'found by showUiType too');
  assert.equal(V.findEvent([Object.assign({}, ev, { begintime: s + 10 })], s), null, 'not begun yet');
  assert.equal(V.findEvent([Object.assign({}, ev, { endtime: s })], s), null, 'ended');
  assert.equal(V.findEvent([{ id: 2, type: 279, endtime: s + 600 }], s).id, 2, 'no begintime counts as begun');
  assert.equal(V.findEvent([null, { type: 279, endtime: s + 600 }], s), null, 'no id: not an activity');
  assert.equal(V.findEvent(null, s), null);
});

test('maxOut: the event\'s para6 (6 live), else 6', () => {
  assert.equal(V.maxOut({ para6: '6' }), 6);
  assert.equal(V.maxOut({ para6: '3' }), 3);
  ['', '0', 'x', '2.5', '99', null].forEach((p) => assert.equal(V.maxOut({ para6: p }), 6, String(p)));
  assert.equal(V.maxOut(null), 6);
});

test('pickVeins: not mined, more than 5 minutes left, not sent, no march of ours there; least time left first', () => {
  const list = [
    vein({ x: 1, y: 1, expireTimeMilli: L(NOW + 3600000) }),
    vein({ x: 2, y: 2, expireTimeMilli: L(NOW + 1200000) }),
    vein({ x: 3, y: 3, gatherStatus: 2 }),                        // mined
    vein({ x: 4, y: 4, gatherStatus: 1 }),                        // mining
    vein({ x: 5, y: 5, gatherStatus: 3 }),                        // on the way
    vein({ x: 6, y: 6, expireTimeMilli: L(NOW + 300000) }),       // exactly 5 minutes: too late
    vein({ x: 7, y: 7, expireTimeMilli: L(NOW + 300001) }),       // just over
    vein({ x: 8, y: 8 }),                                         // sent already
    vein({ x: 9, y: 9 }),                                         // our march is headed there
    vein({ x: 10, y: 10, gatherStatus: undefined }),              // no status: not a vein we can read
    vein({ x: -1, y: 4 }), vein({ x: 1.5, y: 4 })                 // bad tiles
  ];
  const sent = { [V.veinKey(list[7])]: 1 };
  const got = V.pickVeins(list, { sent, marchTiles: { '9,9': 1 }, now: NOW });
  assert.deepEqual(got.map((v) => v.x + ',' + v.y), ['7,7', '2,2', '1,1']);
  assert.deepEqual(got[0], { at: 6, key: '7,7,' + Math.floor((NOW + 300001) / 1000), x: 7, y: 7, leftMs: 300001 });
  assert.deepEqual(V.pickVeins(null, { now: NOW }), []);
});

test('pickVeins: each vein once; a new vein on an ended vein\'s tile is a different vein', () => {
  const a = vein({ expireTimeMilli: L(NOW + 600000) }), b = vein({ expireTimeMilli: L(NOW + 7200000) });
  assert.equal(V.pickVeins([a, a], { now: NOW }).length, 1);
  assert.notEqual(V.veinKey(a), V.veinKey(b));
  assert.equal(V.pickVeins([b], { sent: { [V.veinKey(a)]: 1 }, now: NOW }).length, 1);
});

test('counts: veins up, mined by this player, on the way or mining', () => {
  const c = V.counts([vein({ gatherStatus: 0 }), vein({ gatherStatus: 2 }), vein({ gatherStatus: 1 }), vein({ gatherStatus: 3 }), vein({ gatherStatus: 2, expireTimeMilli: L(NOW - 1) })], NOW);
  assert.deepEqual(c, { up: 4, mined: 1, busy: 2 });
  assert.deepEqual(V.counts(undefined, NOW), { up: 0, mined: 0, busy: 0 });
});

test('gate: at most 10 marches a minute and 40 in 10 minutes', () => {
  assert.equal(V.gate(Array.from({ length: 9 }, (_, i) => NOW - i * 1000), NOW).ok, true);
  const g = V.gate(Array.from({ length: 10 }, (_, i) => NOW - 50000 + i), NOW);
  assert.deepEqual(g, { ok: false, until: NOW - 50000 + 60000, reason: '10 marches in a minute' });
  const h = V.gate(Array.from({ length: 40 }, (_, i) => NOW - 590000 + i * 1000), NOW);
  assert.equal(h.ok, false); assert.equal(h.reason, '40 marches in 10 minutes');
});

test('classify: sent, the game\'s "not enough time" (by key or text), other refusals, silence', () => {
  assert.deepEqual(V.classify({ s: 0, d: '{}' }), { kind: 'ok' });
  assert.deepEqual(V.classify({ s: 3, d: 'field_lottery_37' }), { kind: 'time', s: 3, key: 'field_lottery_37' });
  assert.deepEqual(V.classify({ s: 3, d: 'kuang_99' }, 'Not enough time remaining on the Vein to start a march.'), { kind: 'time', s: 3, key: 'kuang_99' });
  assert.deepEqual(V.classify({ s: 3, d: 'field_lottery_35' }, 'March failed!'), { kind: 'refused', s: 3, key: 'field_lottery_35' });
  assert.deepEqual(V.classify({ s: 'timeout' }), { kind: 'silent' });
  assert.deepEqual(V.classify({ s: 'blocked' }), { kind: 'silent' });
  assert.deepEqual(V.classify(null), { kind: 'silent' });
});

test('sentFor: one event\'s list; a new event starts empty; ended veins drop out', () => {
  const live = '5,5,' + (NOW / 1000 + 600), gone = '6,6,' + (NOW / 1000 - 1);
  assert.deepEqual(V.sentFor({ eventId: '83000157', keys: { [live]: 1, [gone]: 1 } }, 83000157, NOW), { eventId: '83000157', keys: { [live]: 1 } });
  assert.deepEqual(V.sentFor({ eventId: '1', keys: { [live]: 1 } }, 83000157, NOW), { eventId: '83000157', keys: {} });
  assert.deepEqual(V.sentFor('junk', 83000157, NOW), { eventId: '83000157', keys: {} });
});

test('gameDay: reset is 12:00 ET', () => {
  assert.equal(V.gameDay(Date.UTC(2026, 9, 14, 15, 59)), '2026-10-13');   // 11:59 ET
  assert.equal(V.gameDay(Date.UTC(2026, 9, 14, 16, 0)), '2026-10-14');    // 12:00 ET
});
