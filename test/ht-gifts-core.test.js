'use strict';
// HT Gift Boxes rules (Tex, 2026-10-13): the password, which gift boxes to claim, marches out, the daily cap, answers.
// Run: node --test test/ht-gifts-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const G = require('../ht-gifts-core.js');

const NOW = 1791946000, NOW_MS = NOW * 1000;
const gift = (x, y, o) => ({ v: 1, x, y, k: 2864, id: x * 1000 + y, pointType: 259, m: Object.assign({ receiveBagUidList: [], endSecsTime: NOW + 1200, floatParadeId: 4, luckyBagNum: x, marchIdStr: 'M1' }, o) });
const O = (o) => Object.assign({ me: 'me', sent: {}, bagCap: () => 20, now: NOW, k: 2864, anchor: null, nowMs: NOW_MS }, o);

test('password: "bananas", trimmed and lowercased, by its SHA-256', () => {
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
  assert.equal(G.PW_HASH, h('bananas'));
  assert.equal(G.checkPassword(h('bananas')), true);
  assert.equal(G.checkPassword(h('apples')), false);
  assert.equal(G.checkPassword(''), false);
});

test('pickGifts: claimable gift boxes only (not mine, not sent, not full, not ending, on my map), fewest claims left first', () => {
  const pts = [
    gift(1, 1, { receiveBagUidList: Array(5).fill('x') }),        // 15 left
    gift(2, 2, { receiveBagUidList: ['me'] }),                       // mine
    gift(3, 3, { receiveBagUidList: Array(20).fill('x') }),       // full
    gift(4, 4, { endSecsTime: NOW + 60 }),                           // ending
    Object.assign(gift(5, 5), { k: 1805 }),                          // another map
    gift(6, 6, { receiveBagUidList: Array(18).fill('x') }),       // 2 left
    gift(7, 7, { luckyBagNum: 7, marchIdStr: 'M1' }),                // sent already
    { pointType: 1, x: 8, y: 8, k: 2864, m: {} },                    // a base
    gift(9, 9, { endSecsTime: NOW + 600 }),                          // 20 left, ends sooner
    gift(10, 10, { endSecsTime: NOW + 900 })                         // 20 left
  ];
  const out = G.pickGifts(pts, O({ sent: { 'M1:7': NOW_MS } }));
  assert.deepEqual(out.map((g) => g.x), [6, 1, 9, 10]);
  assert.deepEqual(out[0], { x: 6, y: 6, key: 'M1:6', claimsLeft: 2, end: NOW + 1200 });
  assert.deepEqual(G.pickGifts(pts, O({ sent: { 'M1:7': NOW_MS }, bagCap: () => 6 })).map((g) => g.x), [1, 9, 10], 'the bag size from the table');
  assert.deepEqual(G.pickGifts(null, O()), []);
});

test('pickGifts: a tile claimed in the last 35 min is skipped even with another key; the 8852 gift is added when the view lacks it', () => {
  const pts = [gift(1, 1), gift(2, 2)];
  assert.deepEqual(G.pickGifts(pts, O({ sent: { '@1,1': NOW_MS - 60000 } })).map((g) => g.x), [2]);
  assert.deepEqual(G.pickGifts(pts, O({ sent: { '@1,1': NOW_MS - 2200000 } })).map((g) => g.x), [1, 2], 'a tile mark older than 35 min is no bar');
  assert.deepEqual(G.pickGifts(pts, O({ anchor: { x: 30, y: 30 } })).map((g) => g.key), ['M1:1', 'M1:2'], 'other gifts in view but not the game\'s pick: it is gone, no blind claim');
  assert.deepEqual(G.pickGifts([], O({ anchor: { x: 30, y: 30 } })).map((g) => g.key), ['@30,30'], 'a view with no gift tiles at all: claim the game\'s own pick');
  assert.deepEqual(G.pickGifts([{ pointType: 1, x: 30, y: 30, k: 2864, m: {} }], O({ anchor: { x: 30, y: 30 } })), [], 'something else stands on that tile now: no claim');
  assert.deepEqual(G.pickGifts(pts, O({ anchor: { x: 2, y: 2 } })).map((g) => g.key), ['M1:1', 'M1:2'], 'the view showed it: no extra');
  assert.deepEqual(G.pickGifts([gift(2, 2, { receiveBagUidList: ['me'] })], O({ anchor: { x: 2, y: 2 } })), [], 'the view showed it as mine: not added back');
  assert.deepEqual(G.pickGifts([], O({ anchor: { x: 30, y: 30 }, sent: { '@30,30': NOW_MS - 1000 } })), [], 'claimed that tile a moment ago');
});

test('out, in flight, room: own estimates or the game\'s march list, the cap counts claims on the way', () => {
  const own = [G.ownFromAnswer({ marchInfo: { marchStartTime: NOW - 10, marchArrive: NOW + 20 } }, NOW), G.ownFromAnswer({ marchInfo: { marchStartTime: NOW - 100, marchArrive: NOW - 50 } }, NOW)];
  assert.deepEqual(own[0], { arrive: NOW + 20, ret: NOW + 50 });
  assert.equal(G.outCount(own, 0, NOW), 1);
  assert.equal(G.outCount(own, 3, NOW), 3, 'the game shows more');
  assert.equal(G.inFlight(own, NOW), 1);
  assert.deepEqual(G.ownFromAnswer(null, NOW), { arrive: NOW + 60, ret: NOW + 120 }, 'no times: assume a long march');
  assert.equal(G.room({ out: 2, received: 3, inflight: 1, cap: 10 }), 3, '5 out at most');
  assert.equal(G.room({ out: 0, received: 8, inflight: 1, cap: 10 }), 1, 'the day\'s cap');
  assert.equal(G.room({ out: 5, received: 0, inflight: 0, cap: 10 }), 0);
  assert.equal(G.room({ out: 0, received: 10, inflight: 0, cap: 10 }), 0);
});

test('sent list belongs to one game day; cap from the game\'s config', () => {
  assert.deepEqual(G.sentFor({ day: '2026-10-13', keys: { a: 1 } }, '2026-10-13'), { day: '2026-10-13', keys: { a: 1 } });
  assert.deepEqual(G.sentFor({ day: '2026-10-12', keys: { a: 1 } }, '2026-10-13'), { day: '2026-10-13', keys: {} });
  assert.deepEqual(G.sentFor(null, '2026-10-13'), { day: '2026-10-13', keys: {} });
  assert.equal(G.capFrom('10'), 10); assert.equal(G.capFrom(null), 10); assert.equal(G.capFrom('12'), 12);
  assert.equal(G.giftKey({ marchIdStr: 'M', luckyBagNum: 3 }, 1, 2), 'M:3');
  assert.equal(G.giftKey({}, 1, 2), '@1,2');
});

test('answers: claims, the next-gift query and the map view', () => {
  assert.deepEqual(G.classify({ s: 0, d: '{}' }), { kind: 'ok' });
  assert.deepEqual(G.classify({ s: 'timeout' }), { kind: 'silent' });
  assert.deepEqual(G.classify({ s: 3, d: 'itemdrop_error_1' }), { kind: 'refused', s: 3, key: 'itemdrop_error_1' });
  assert.deepEqual(G.classifyQuery({ pbAckV2: { header: { s: 0 }, data: { x: 442, y: 686 } } }), { kind: 'gift', x: 442, y: 686 });
  assert.deepEqual(G.classifyQuery({ pbAckV2: { header: { s: 0 }, data: {} } }), { kind: 'none' });
  assert.deepEqual(G.classifyQuery({ pbAckV2: { header: { s: 3, d: 'no_bag' } } }), { kind: 'none' });
  assert.deepEqual(G.classifyQuery({ s: 'timeout' }), { kind: 'silent' });
  assert.deepEqual(G.classifyView({ c: 901, d: JSON.stringify({ pointList: [{ x: 1 }] }) }), { kind: 'ok', points: [{ x: 1 }] });
  assert.deepEqual(G.classifyView({ s: 'timeout' }), { kind: 'silent', points: [] });
  assert.deepEqual(G.classifyView({ c: 901, d: 'nope' }), { kind: 'ok', points: [] });
  assert.deepEqual(G.classifyView({ c: 901, s: 3, d: 'view_too_fast' }), { kind: 'refused', s: 3, key: 'view_too_fast', points: [] }, 'a refused view is an unknown answer');
});

test('gate: at most 10 claims a minute (a runaway guard; the day allows 10)', () => {
  assert.equal(G.gate(Array.from({ length: 9 }, () => NOW_MS - 1000), NOW_MS).ok, true);
  const g = G.gate(Array.from({ length: 10 }, () => NOW_MS - 1000), NOW_MS);
  assert.equal(g.ok, false); assert.match(g.reason, /10 claims/);
});
