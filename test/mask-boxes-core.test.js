'use strict';
// Mask Mystery Boxes pure rules. Run: node --test test/mask-boxes-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../mask-boxes-core.js');

const NOW = Date.UTC(2026, 9, 5, 17, 0);
const b = (o) => Object.assign({ server: 619, x: 404, y: 612, owner: 'A', type: 1, endMs: NOW + 600000 }, o);

test('candidates: types on, under the daily cap, 45 s or more left, untried, deduped, soonest first', () => {
  const list = [b({ endMs: NOW + 900000 }), b({ server: 2, endMs: NOW + 300000 }), b({ server: 2, endMs: NOW + 300000 }), b({ server: 3, endMs: NOW + 44000 }),
    b({ server: 4, type: 2 }), b({ server: 5, type: 3 }), b({ server: 6 })];
  const tried = {}; tried[M.boxKey(b({ server: 6 }))] = 1;
  const out = M.candidates(list, { now: NOW, types: { 1: true, 2: false, 3: true }, tried, counts: { 1: 0, 2: 0, 3: 20 } });
  assert.deepEqual(out.map((x) => x.server), [2, 619]);
});

test('findBox: the city at exactly x,y,k with a cityReward; type from its item, not the feed', () => {
  const ans = { s: 0, d: JSON.stringify({ pointList: [
    { x: 404, y: 612, k: 619, pointType: 1, p: { pid: 217160163552, cityReward: { itemId: 260617003, instanceId: '4871' } } },
    { x: 405, y: 612, k: 619, pointType: 1, p: { pid: 1, cityReward: { itemId: 260617002, instanceId: '1' } } }] }) };
  assert.deepEqual(M.findBox(ans, 404, 612, 619), { state: 'box', pid: '217160163552', instanceId: '4871', type: 2 });
  assert.deepEqual(M.findBox({ s: 0, d: JSON.stringify({ pointList: [{ x: 404, y: 612, k: 619, p: { pid: 5 } }] }) }, 404, 612, 619), { state: 'gone' });
  assert.deepEqual(M.findBox({ s: 0, d: JSON.stringify({ pointList: [] }) }, 404, 612, 619), { state: 'gone' });
  assert.deepEqual(M.findBox({ s: 3, d: 'x' }, 404, 612, 619), { state: 'stop', key: 'x' });   // a game error: stop
  assert.deepEqual(M.findBox({ s: 'timeout' }, 404, 612, 619), { state: 'error' });
});

test('classifyCollect: items, Reward claimed, a stop key, or failed', () => {
  const ok = { s: 0, pbAckV2: { header: { s: 0 }, data: { rewardResult: { items: [{ itemId: 260604017, itemCount: 1 }] } } } };
  assert.deepEqual(M.classifyCollect(ok), { kind: 'ok', items: [{ itemId: 260604017, itemCount: 1 }] });
  assert.deepEqual(M.classifyCollect({ s: 3, pbAckV2: { header: { s: 3, d: 'pubilc911' } } }), { kind: 'claimed' });
  assert.deepEqual(M.classifyCollect({ s: 3, pbAckV2: { header: { s: 3, d: 'mask_limit_1' } } }), { kind: 'stop', key: 'mask_limit_1' });
  assert.deepEqual(M.classifyCollect({ s: 'timeout' }), { kind: 'failed' });
});

test('gate: 10 boxes a minute, 50 per 10 minutes, 3 failures in a row pause 5 minutes', () => {
  const at = (n, step, kind) => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i) * step, kind: kind || 'ok' }));
  assert.equal(M.gate(at(9, 5000), NOW).ok, true);
  assert.equal(M.gate(at(10, 5000), NOW).ok, false);
  assert.equal(M.gate(at(50, 11000), NOW).ok, false);
  const f = at(3, 1000, 'failed');
  assert.equal(M.gate(f, NOW).ok, false);
  assert.equal(M.gate(f, NOW + 300000).ok, true);
  assert.equal(M.gate(at(3, 1000, 'gone'), NOW).ok, true);
});

test('countsFor and gameDay: counts belong to the game day that starts at reset (noon ET)', () => {
  assert.equal(M.gameDay(Date.UTC(2026, 9, 5, 15, 59)), '2026-10-04');
  assert.equal(M.gameDay(Date.UTC(2026, 9, 5, 16, 0)), '2026-10-05');
  assert.deepEqual(M.countsFor({ day: '2026-10-05', counts: { 1: 3, 2: 0, 3: 1 } }, '2026-10-05'), { 1: 3, 2: 0, 3: 1 });
  assert.deepEqual(M.countsFor({ day: '2026-10-04', counts: { 1: 20, 2: 20, 3: 20 } }, '2026-10-05'), { 1: 0, 2: 0, 3: 0 });
  assert.deepEqual(M.countsFor(null, '2026-10-05'), { 1: 0, 2: 0, 3: 0 });
});

test('cardRows', () => {
  assert.deepEqual(M.cardRows({ 1: 3, 2: 0, 3: 20 }, { 1: true, 2: false, 3: true }), [['Treasure', '3/20', true], ['HT', '0/20', false], ['RSS', '20/20', true]]);
});

test('findBox: a view answer without s (as the game sends 901 live: {c, o, d}) still finds the box', () => {
  const ans = { c: 901, o: '148', d: JSON.stringify({ rtype: 2, pointList: [
    { v: 9, x: 404, y: 612, k: 619, pointType: 1, p: { pid: '217160163552', cityReward: { itemId: 260617002, instanceId: 77 } } }] }) };
  assert.deepEqual(M.findBox(ans, 404, 612, 619), { state: 'box', pid: '217160163552', instanceId: '77', type: 1 });
  assert.deepEqual(M.findBox({ c: 901, d: 'not json' }, 404, 612, 619), { state: 'error' });
  assert.deepEqual(M.findBox({ c: 901 }, 404, 612, 619), { state: 'error' });
});

test('REVIEW #3: classifyCollect stops on a success without a reward; timeouts and blocked sends are failures', () => {
  assert.deepEqual(M.classifyCollect({ s: 0, pbAckV2: { header: { s: 0 }, data: {} } }), { kind: 'stop', key: '' });
  assert.deepEqual(M.classifyCollect({ s: 'timeout' }), { kind: 'failed' });
  assert.deepEqual(M.classifyCollect({ s: 'blocked' }), { kind: 'failed' });
  assert.deepEqual(M.findBox({ s: 'timeout' }, 1, 1, 1), { state: 'error' });
  assert.deepEqual(M.findBox({ s: 'blocked' }, 1, 1, 1), { state: 'error' });
  assert.deepEqual(M.findBox({ s: 7 }, 1, 1, 1), { state: 'stop', key: '' });
  assert.deepEqual(M.classifyCollect({ s: 3 }), { kind: 'stop', key: '' });
});

test('LIVE: a reported spot can be a tile of the city, not its anchor: match by end time, else the one nearest box within 3 tiles', () => {
  const pt = (x, y, o) => ({ x, y, k: 2864, pointType: 1, p: Object.assign({ pid: 'p' + x + '_' + y }, o) });
  const box = (end, item) => ({ cityReward: { itemId: item || 260617003, instanceId: 'i' + end, endTimeMilli: end } });
  const view = (pts) => ({ s: 0, d: JSON.stringify({ pointList: pts }) });
  // live 2026-10-05: reported 785,535; the city (and its box) sits at 783,535
  const live = view([pt(783, 535, box(1791224240106)), pt(790, 540, {})]);
  assert.deepEqual(M.findBox(live, 785, 535, 2864, 1791224240106), { state: 'box', pid: 'p783_535', instanceId: 'i1791224240106', type: 2 });
  assert.equal(M.findBox(live, 785, 535, 2864, 1).state, 'box', 'no end-time match: the one box within 3 tiles');
  assert.equal(M.findBox(live, 785, 535, 2864).state, 'box');
  // the end time wins anywhere in the view
  assert.equal(M.findBox(view([pt(770, 520, box(5)), pt(785, 535, box(6))]), 785, 535, 2864, 5).pid, 'p770_520');
  // two boxes equally near and no end-time match: ambiguous, leave it
  assert.deepEqual(M.findBox(view([pt(783, 535, box(7)), pt(787, 535, box(8))]), 785, 535, 2864, 1), { state: 'gone' });
  // nothing within 3 tiles: gone
  assert.deepEqual(M.findBox(view([pt(780, 535, box(9))]), 785, 535, 2864, 1), { state: 'gone' });
  // the exact city without a box: gone, even with a box next door
  assert.deepEqual(M.findBox(view([pt(785, 535, {}), pt(784, 535, box(10))]), 785, 535, 2864, 1), { state: 'gone' });
  // another server's points never match
  assert.deepEqual(M.findBox(view([Object.assign(pt(785, 535, box(11)), { k: 1 })]), 785, 535, 2864, 11), { state: 'gone' });
});

test('LIVE: the game\'s own count (UserData.itemCityRewardReceivedNum) raises the card and the cap, for the game day it was seen in', () => {
  const NUM = { 260617002: 6, 260617003: 8, 260617004: 1 };   // Rеx, 2026-10-05 13:58 ET
  let tr = M.trackServer(null, {}, '2026-10-05');               // empty at login, before the push
  assert.equal(tr.num, null);
  tr = M.trackServer(tr, NUM, '2026-10-05');
  assert.deepEqual(M.countsWith({ 1: 1, 2: 1, 3: 0 }, tr, '2026-10-05'), { 1: 6, 2: 8, 3: 1 });
  assert.deepEqual(M.countsWith({ 1: 7, 2: 0, 3: 0 }, tr, '2026-10-05'), { 1: 7, 2: 8, 3: 1 }, 'the higher of ours and the game\'s');
  // reset passes and the game has not pushed since: yesterday's count must not block today
  assert.deepEqual(M.countsWith({ 1: 0, 2: 0, 3: 0 }, M.trackServer(tr, NUM, '2026-10-06'), '2026-10-06'), { 1: 0, 2: 0, 3: 0 });
  // a new push after reset counts again
  tr = M.trackServer(M.trackServer(tr, NUM, '2026-10-06'), { 260617002: 1 }, '2026-10-06');
  assert.deepEqual(M.countsWith({ 1: 0, 2: 0, 3: 0 }, tr, '2026-10-06'), { 1: 1, 2: 0, 3: 0 });
  // junk never counts
  assert.deepEqual(M.countsWith({ 1: 2, 2: 0, 3: 0 }, M.trackServer(null, { 260617002: 'x', 260617003: -4 }, 'd'), 'd'), { 1: 2, 2: 0, 3: 0 });
  assert.equal(M.trackServer(null, 'nope', 'd').num, null);
});

const NOW2 = Date.UTC(2026, 9, 7, 16, 30);
const card = (o) => ({ _msgId: 'm1', _time: NOW2 / 1000 - 60, _chatShareLinkData: Object.assign({ t: 48, s: 'JMR_bs_001', actt: 63, p: { x: 402, y: 562, z: 0 },
  icon: 'm/UserItemCityReward/images/shareIcon2', extra: { jumpServerId: 3396, expireTime: (NOW2 + 600000) / 1000, contentParams: ['Host'], btnKey: '102385', aid: 0 } }, o) });
const base = (o, m) => Object.assign({ _msgId: 'b1', _time: NOW2 / 1000 - 120, _worldId: '2864', _chatShareLinkData: Object.assign({ t: 0, st: 4, p: { x: 450, y: 610, z: 2864 }, s: 'Lv.30[DOG]Someone', pid: '1' }, o) }, m);

test('chatBoxes: box cards (actt 63/64/65, else s JMR_bs_00N) become boxes; junk, expired and far-future cards are dropped', () => {
  const rows = [card(), card({ actt: 64, s: 'JMR_bs_002', p: { x: 1, y: 2, z: 0 } }), card({ actt: undefined, s: 'JMR_bs_003', p: { x: 3, y: 4, z: 0 } }),
    card({ t: 0 }), card({ actt: 70, s: 'x' }), card({ p: { x: 5000, y: 1, z: 0 } }), { _chatShareLinkData: null }, null,
    card({ extra: { jumpServerId: 3396, expireTime: (NOW2 - 1000) / 1000, contentParams: ['Old'] } }),
    card({ extra: { jumpServerId: 3396, expireTime: (NOW2 + 2 * 864e5) / 1000, contentParams: ['Far'] } }),
    card({ extra: { jumpServerId: 'x', expireTime: (NOW2 + 600000) / 1000, contentParams: [] } })];
  assert.deepEqual(M.chatBoxes(rows, NOW2), [
    { server: 3396, x: 402, y: 562, type: 1, endMs: NOW2 + 600000, owner: 'Host', src: 'chat' },
    { server: 3396, x: 1, y: 2, type: 2, endMs: NOW2 + 600000, owner: 'Host', src: 'chat' },
    { server: 3396, x: 3, y: 4, type: 3, endMs: NOW2 + 600000, owner: 'Host', src: 'chat' }]);
});

test('baseShares: base shares (t:0 st:4) of the last 10 minutes; p.z is the server, else the message\'s world; others dropped', () => {
  const rows = [base(), base({ p: { x: 451, y: 611, z: 0 } }), base({ st: 2 }), base({}, { _time: NOW2 / 1000 - 601 }), card(),
    base({ p: { x: 1, y: 1, z: 0 } }, { _worldId: 'x' }), base({ p: { x: 9999, y: 1, z: 2864 } })];
  assert.deepEqual(M.baseShares(rows, NOW2), [
    { server: 2864, x: 450, y: 610, at: NOW2 - 120000, src: 'base' },
    { server: 2864, x: 451, y: 611, at: NOW2 - 120000, src: 'base' }]);
});

test('mergeBoxes: one box per city across sources, keeping the later end', () => {
  const a = { server: 1, x: 2, y: 3, type: 1, endMs: 10 }, b = { server: 1, x: 2, y: 3, type: 1, endMs: 20 }, c = { server: 9, x: 9, y: 9, type: 2, endMs: 5 };
  assert.deepEqual(M.mergeBoxes([[a, c], [b]]), [b, c]);
  assert.equal(M.cityKey(a), '1:2:3');
});

test('spot memory: blocked until its time; remembering keeps the later time; pruning drops past spots', () => {
  let s = M.rememberSpot({}, '1:2:3', NOW2 + 1000);
  s = M.rememberSpot(s, '1:2:3', NOW2 + 500);
  assert.equal(s['1:2:3'], NOW2 + 1000);
  assert.equal(M.spotBlocked(s, '1:2:3', NOW2), true);
  assert.equal(M.spotBlocked(s, '1:2:3', NOW2 + 1000), false);
  assert.deepEqual(M.pruneSpots({ a: NOW2 - 1, b: NOW2 + 1, c: 'x' }, NOW2), { b: NOW2 + 1 });
  const list = [{ server: 1, x: 2, y: 3, type: 1, endMs: NOW2 + 600000 }, { server: 4, x: 5, y: 6, type: 1, endMs: NOW2 + 700000 }];
  const out = M.candidates(list, { now: NOW2, types: { 1: true, 2: true, 3: true }, tried: {}, counts: { 1: 0, 2: 0, 3: 0 }, spots: s });
  assert.deepEqual(out.map((b) => b.server), [4]);
});

test('baseCandidate: newest untried, unblocked share; none once 3 were viewed in 10 minutes', () => {
  const shares = [{ server: 1, x: 1, y: 1, at: NOW2 - 300000, src: 'base' }, { server: 2, x: 2, y: 2, at: NOW2 - 60000, src: 'base' }, { server: 3, x: 3, y: 3, at: NOW2 - 30000, src: 'base' }];
  const o = { now: NOW2, tried: { '3:3:3': 1 }, spots: {}, baseLog: [] };
  assert.equal(M.baseCandidate(shares, o).server, 2);
  assert.equal(M.baseCandidate(shares, Object.assign({}, o, { spots: { '2:2:2': NOW2 + 1 } })).server, 1);
  assert.equal(M.baseCandidate(shares, Object.assign({}, o, { baseLog: [NOW2 - 1000, NOW2 - 2000, NOW2 - 3000] })), null);
  assert.equal(M.baseCandidate(shares, Object.assign({}, o, { baseLog: [NOW2 - 700000, NOW2 - 2000, NOW2 - 3000] })).server, 2);
});

test('boxPoint: the city with that owner in the view: anchor, server, end, item and player info', () => {
  const ans = { s: 0, d: JSON.stringify({ pointList: [{ x: 783, y: 535, k: 2864, pointType: 1, p: { pid: 9, w: 2864, playerInfo: '{"username":"Boat"}', cityReward: { itemId: 260617003, instanceId: '7', endTimeMilli: NOW2 + 5 } } }] }) };
  assert.deepEqual(M.boxPoint(ans, '9'), { x: 783, y: 535, w: 2864, endMs: NOW2 + 5, itemId: 260617003, info: '{"username":"Boat"}' });
  assert.equal(M.boxPoint(ans, '8'), null);
  assert.equal(M.boxPoint({ s: 0, d: 'junk' }, '9'), null);
});
