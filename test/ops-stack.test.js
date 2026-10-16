'use strict';
// Ops tools that run together keep their cards apart (Tex 2026-10-16): the pure placement rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spot } = require('../ops-stack.js');

const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const DESK = { w: 1280, h: 800 }, PHONE = { w: 375, h: 740 };

test('nothing before it: the top-left spot', () => {
  assert.deepEqual(spot([], { w: 190, h: 200 }, DESK), { left: 8, top: 84 });
});
test('below the card before it when it fits', () => {
  assert.deepEqual(spot([R(8, 84, 190, 250)], { w: 190, h: 200 }, DESK), { left: 8, top: 342 });
});
test('else a new column to the right', () => {
  assert.deepEqual(spot([R(8, 84, 190, 600)], { w: 190, h: 200 }, DESK), { left: 206, top: 84 });
});
test('no room: folds to a bar at the right edge, below any card there', () => {
  assert.deepEqual(spot([R(8, 84, 190, 600)], { w: 240, h: 300 }, PHONE), { fold: true, top: 84 });
  assert.deepEqual(spot([R(8, 84, 190, 600), R(200, 84, 167, 44)], { w: 240, h: 300 }, PHONE), { fold: true, top: 136 });
});
test("Map Collector's card is an obstacle", () => {
  const mapc = R(8, 500, 300, 230);
  assert.deepEqual(spot([R(8, 84, 190, 250), mapc], { w: 190, h: 200 }, DESK), { left: 206, top: 84 });
});
test('an earlier card grows: the later card moves, never on top of it', () => {
  assert.deepEqual(spot([R(8, 84, 190, 200)], { w: 190, h: 200 }, DESK), { left: 8, top: 292 });
  assert.deepEqual(spot([R(8, 84, 190, 320)], { w: 190, h: 200 }, DESK), { left: 8, top: 412 });
});
test('three cards on a phone: the first two stack, the third folds', () => {
  const a = R(8, 84, 190, 250), b = spot([a], { w: 190, h: 180 }, PHONE);
  assert.deepEqual(b, { left: 8, top: 342 });
  assert.deepEqual(spot([a, R(b.left, b.top, 190, 180)], { w: 240, h: 220 }, PHONE), { fold: true, top: 84 });
  assert.deepEqual(spot([a, R(b.left, b.top, 190, 180)], { w: 240, h: 200 }, PHONE), { left: 8, top: 530 }, 'one that just fits stacks');
});
