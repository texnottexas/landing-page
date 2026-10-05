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
