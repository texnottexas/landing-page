'use strict';
// Movable Ops cards (Tex, 2026-10-14): where a card may sit, the saved spot, the double-tap.
// Run: node --test test/ops-drag.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../ops-drag.js');

test('clampPos: the whole card stays on screen with an 8 px margin', () => {
  const v = { vw: 375, vh: 740 }, s = { w: 200, h: 100 };
  assert.deepEqual(D.clampPos({ x: 50, y: 60 }, s, v), { x: 50, y: 60 });
  assert.deepEqual(D.clampPos({ x: -40, y: -9 }, s, v), { x: 8, y: 8 });
  assert.deepEqual(D.clampPos({ x: 500, y: 900 }, s, v), { x: 167, y: 632 });
  assert.deepEqual(D.clampPos({ x: 10.6, y: 20.2 }, s, v), { x: 11, y: 20 });
});

test('clampPos: a card bigger than the screen keeps its top-left (its title row) in view', () => {
  assert.deepEqual(D.clampPos({ x: 300, y: 600 }, { w: 500, h: 900 }, { vw: 375, vh: 740 }), { x: 8, y: 8 });
});

test('readPos: only a stored {x, y} of numbers counts', () => {
  assert.deepEqual(D.readPos('{"x":10,"y":20}'), { x: 10, y: 20 });
  assert.equal(D.readPos(null), null);
  assert.equal(D.readPos('nope'), null);
  assert.equal(D.readPos('{"x":"10","y":20}'), null);
  assert.equal(D.readPos('{"x":10}'), null);
  assert.equal(D.readPos('{"x":1e999,"y":0}'), null);
});

test('isDoubleTap: two taps within 350 ms', () => {
  assert.equal(D.isDoubleTap(1000, 1300), true);
  assert.equal(D.isDoubleTap(1000, 1400), false);
  assert.equal(D.isDoubleTap(0, 100), false);
  assert.equal(D.KEY, 'ops_pos_v1_'); assert.equal(D.THRESHOLD, 6); assert.equal(D.MARGIN, 8);
});
