'use strict';
// Alliance Defense Skipper pure rules. Run: node --test test/defense-skip.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../defense-skip-bookmarklet.js');

const NOW = 1791425980;
const siege = (o) => Object.assign({ round: 12, nextTime: NOW + 60, winTimes: 12, loseTimes: 0, isEnd: 0, maxRound: 80 }, o);
const ctx = (o) => Object.assign({ now: NOW, target: 65, startLose: 0, rank: 5, sent: {} }, o);

test('skips in the window: a real next-attack time with 2 s or more left, this wave not skipped yet', () => {
  assert.deepEqual(R.decide(siege(), ctx()), { act: 'skip', round: 12 });
  assert.deepEqual(R.decide(siege({ nextTime: NOW + 2 }), ctx()), { act: 'skip', round: 12 });
});

test('never while the boss is marching or about to', () => {
  assert.equal(R.MARCHING, 2147483647);
  assert.deepEqual(R.decide(siege({ nextTime: R.MARCHING }), ctx()), { act: 'wait', why: 'marching' });
  assert.deepEqual(R.decide(siege({ nextTime: NOW + 1 }), ctx()), { act: 'wait', why: 'too late' });
  assert.deepEqual(R.decide(siege({ nextTime: NOW }), ctx()), { act: 'wait', why: 'too late' });
});

test('at most one skip per wave', () => {
  assert.deepEqual(R.decide(siege(), ctx({ sent: { 12: 1 } })), { act: 'wait', why: 'sent' });
  assert.deepEqual(R.decide(siege({ round: 13 }), ctx({ sent: { 12: 1 } })), { act: 'skip', round: 13 });
});

test('stops at the target wave, the last wave, the event end, a lost wave, or without the rank', () => {
  assert.equal(R.decide(siege({ round: 65 }), ctx()).act, 'stop');
  assert.match(R.decide(siege({ round: 65 }), ctx()).why, /wave 65/);
  assert.equal(R.decide(siege({ round: 64 }), ctx()).act, 'skip');
  assert.match(R.decide(siege({ round: 80, maxRound: 80 }), ctx({ target: 90 })).why, /last wave/);
  assert.match(R.decide(siege({ isEnd: 1 }), ctx()).why, /ended/);
  assert.match(R.decide(siege({ loseTimes: 1 }), ctx()).why, /lost/);
  assert.equal(R.decide(siege({ loseTimes: 1 }), ctx({ startLose: 1 })).act, 'skip', 'losses before the start do not count');
  assert.match(R.decide(siege(), ctx({ rank: 4 })).why, /rank/);
  assert.match(R.decide(null, ctx()).why, /not running/);
});

test('a lost wave stops even while marching', () => {
  assert.equal(R.decide(siege({ loseTimes: 1, nextTime: R.MARCHING }), ctx()).act, 'stop');
});

test('readSiege: the fields that matter from the activity, null when absent or malformed', () => {
  const a = { alMonsterSiege: { round: 12, nextTime: NOW + 60, winTimes: 12, loseTimes: 0, isEnd: 0, maxRound: 80, aid: 1, pointId: 2 } };
  assert.deepEqual(R.readSiege(a), { round: 12, nextTime: NOW + 60, winTimes: 12, loseTimes: 0, isEnd: 0, maxRound: 80 });
  assert.equal(R.readSiege(null), null);
  assert.equal(R.readSiege({}), null);
  assert.equal(R.readSiege({ alMonsterSiege: { round: 'x', nextTime: 1 } }), null);
});

test('caps: 15 skips a minute, 3 refusals in a row', () => {
  assert.equal(R.MAX_PER_MIN, 15);
  const at = Array.from({ length: 15 }, (_, i) => 1000 + i);
  assert.equal(R.underCap(at, 30000), false);
  assert.equal(R.underCap(at, 61001), true);
  assert.equal(R.underCap([], 0), true);
  assert.equal(R.REFUSE_STREAK, 3);
});
