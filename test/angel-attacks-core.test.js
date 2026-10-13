'use strict';
// Angel Attacks rules (Tex, 2026-10-13): which Angels to attack, the limits, the game's answers, the sent list.
// Run: node --test test/angel-attacks-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../angel-attacks-core.js');

const NOW = Date.UTC(2026, 9, 13, 18, 0, 0);
const long = (v) => ({ toString: () => String(v), toNumber: () => Number(v) });
const ev = (o) => Object.assign({ id: 83000151, type: 292, endtime: NOW / 1000 + 3600, extra: { attackMonsterIds: [], groupId: 5 } }, o);

test('findEvent: the live activity holding attackMonsterIds and a match group, found by shape, not id', () => {
  const titan = { id: 1, endtime: NOW / 1000 + 9999, extra: { left: 3 } };
  assert.equal(A.findEvent([titan, ev()], NOW / 1000).id, 83000151);
  assert.equal(A.findEvent([ev({ id: 99 })], NOW / 1000).id, 99, 'a later round has another id');
  assert.equal(A.findEvent([ev({ endtime: NOW / 1000 - 1 })], NOW / 1000), null, 'ended');
  assert.equal(A.findEvent([ev({ extra: { attackMonsterIds: [] } })], NOW / 1000), null, 'no match group');
  assert.equal(A.findEvent([titan, null, 5], NOW / 1000), null);
  assert.equal(A.findEvent(null, NOW / 1000), null);
});

test('pickTargets: every Angel not yet attacked, not ours, not on the way, with 2+ minutes left, in the game\'s order', () => {
  const m = (uuid, o) => Object.assign({ uuid: long(uuid), uid: 'other', x: 100, y: 200, serverId: 2691, expireMilli: long(NOW + 3600000), hasMarch: false }, o);
  const list = [
    m('1', { x: 1, y: 1 }),
    m('2', { x: 2, y: 2 }),                                  // attacked already
    m('3', { x: 3, y: 3, uid: 'me' }),                       // ours
    m('4', { x: 4, y: 4, hasMarch: true }),
    m('5', { x: 5, y: 5 }),                                  // our march to this tile is out
    m('6', { x: 6, y: 6, expireMilli: long(NOW + 119000) }), // under 2 minutes
    m('7', { x: 7, y: 7 }),                                  // in our own sent list
    m('8', { x: 8, y: 8 }),
    m('1', { x: 1, y: 1 })                                   // the same Angel twice
  ];
  const out = A.pickTargets(list, { attacked: ['2'], sent: { 7: NOW - 1000 }, me: 'me', marchTiles: { '5,5': 1 }, now: NOW });
  assert.deepEqual(out.map((t) => t.uuid), ['1', '8']);
  assert.deepEqual(out[0], { at: 0, uuid: '1', x: 1, y: 1, serverId: 2691, leftMs: 3600000 });
  assert.equal(out[1].at, 7);
  assert.deepEqual(A.pickTargets(null, { now: NOW }), []);
  assert.deepEqual(A.pickTargets([m('9', { x: -1 }), m('10', { x: 1.5 }), m('', {})], { now: NOW }), [], 'bad tiles and empty uuids');
  assert.equal(A.MIN_LEFT_MS, 120000);
});

test('gate: 10 attacks a minute, 40 in 10 minutes', () => {
  assert.equal(A.MAX_PER_MIN, 10);
  assert.equal(A.MAX_PER_10MIN, 40);
  assert.deepEqual(A.gate([], NOW), { ok: true });
  const min = Array.from({ length: 10 }, (_, i) => NOW - 50000 + i * 1000);
  assert.deepEqual(A.gate(min, NOW), { ok: false, until: min[0] + 60000, reason: '10 attacks in a minute' });
  assert.deepEqual(A.gate(min.slice(1), NOW), { ok: true });
  const ten = Array.from({ length: 40 }, (_, i) => NOW - 590000 + i * 12000);
  const g = A.gate(ten, NOW);
  assert.equal(g.ok, false);
  assert.equal(g.reason, '40 attacks in 10 minutes');
});

test('classifyAttack: s 0 is sent; no answer, a timeout or a blocked send is silent; anything else is a refusal', () => {
  assert.deepEqual(A.classifyAttack({ s: 0, d: '{}' }), { kind: 'ok' });
  assert.deepEqual(A.classifyAttack(null), { kind: 'silent' });
  assert.deepEqual(A.classifyAttack({ s: 'timeout' }), { kind: 'silent' });
  assert.deepEqual(A.classifyAttack({ s: 'blocked' }), { kind: 'silent' });
  assert.deepEqual(A.classifyAttack({ s: 3, d: 'backup_mecha_lottery_21' }), { kind: 'refused', s: 3, key: 'backup_mecha_lottery_21' });
  assert.deepEqual(A.classifyAttack({ s: 7 }), { kind: 'refused', s: 7, key: '' });
  assert.equal(A.SILENT_STOP, 3);
});

test('sentFor: the same event keeps its sent list; a new round starts empty', () => {
  assert.deepEqual(A.sentFor({ eventId: '83000151', uuids: { 1: 5 } }, 83000151), { eventId: '83000151', uuids: { 1: 5 } });
  assert.deepEqual(A.sentFor({ eventId: '83000151', uuids: { 1: 5 } }, 99), { eventId: '99', uuids: {} });
  assert.deepEqual(A.sentFor(null, 99), { eventId: '99', uuids: {} });
  assert.deepEqual(A.sentFor({ eventId: '99', uuids: 'bad' }, 99), { eventId: '99', uuids: {} });
});

test('num and gameDay: protobuf Longs, and the game day from reset (12:00 PM ET)', () => {
  assert.equal(A.num(long('1791993599000')), 1791993599000);
  assert.equal(A.num('12'), 12);
  assert.equal(A.num(undefined), 0);
  assert.equal(A.gameDay(Date.UTC(2026, 9, 13, 15, 59)), '2026-10-12');
  assert.equal(A.gameDay(Date.UTC(2026, 9, 13, 16, 0)), '2026-10-13');
});
