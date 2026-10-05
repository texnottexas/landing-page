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
  assert.deepEqual(M.findBox({ s: 3, d: 'x' }, 404, 612, 619), { state: 'error' });
  assert.deepEqual(M.findBox({ s: 'timeout' }, 404, 612, 619), { state: 'error' });
});

test('classifyCollect: items, Reward claimed, a stop key, or failed', () => {
  const ok = { s: 0, pbAckV2: { header: { s: 0 }, data: { rewardResult: { items: [{ itemId: 260604017, itemCount: 1 }] } } } };
  assert.deepEqual(M.classifyCollect(ok), { kind: 'ok', items: [{ itemId: 260604017, itemCount: 1 }] });
  assert.deepEqual(M.classifyCollect({ s: 3, pbAckV2: { header: { s: 3, d: 'pubilc911' } } }), { kind: 'claimed' });
  assert.deepEqual(M.classifyCollect({ s: 3, pbAckV2: { header: { s: 3, d: 'mask_limit_1' } } }), { kind: 'stop', key: 'mask_limit_1' });
  assert.deepEqual(M.classifyCollect({ s: 'timeout' }), { kind: 'failed' });
  assert.deepEqual(M.classifyCollect({ s: 0, pbAckV2: { header: { s: 0 }, data: {} } }), { kind: 'failed' });
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
