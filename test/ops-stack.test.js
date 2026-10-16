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
test('a folded bar wider than the default: it goes lower rather than over a card', () => {
  const a = R(8, 84, 190, 250);
  assert.deepEqual(spot([a], { w: 240, h: 700 }, PHONE, { w: 150, h: 44 }), { fold: true, top: 84 });
  assert.deepEqual(spot([a], { w: 240, h: 700 }, PHONE, { w: 185, h: 44 }), { fold: true, top: 342 }, '367 - 185 = 182 < 198: below the card instead');
});

// Folds made for room (review minor, 2026-10-16): the player's "open anyway" ends once the card has room again, and a
// bar the player drags stays a bar until they open it.
const { fold, foldTap } = require('../ops-stack.js');
test('fold: a fold for room; the chevron opens it anyway; room again ends that, so the next lack of room folds it', () => {
  const fs = {};
  assert.equal(fold(fs, { fold: true }, false), true);
  assert.equal(foldTap(fs, false), true);                 // the chevron on a bar folded for room: open anyway
  assert.equal(fold(fs, { fold: true }, false), false);
  assert.equal(fold(fs, { fold: false }, false), false);  // room again
  assert.equal(fold(fs, { fold: true }, false), true, 'no room again: folds again');
});
test('fold: a bar folded for room that the player drags stays a bar; the chevron opens it', () => {
  const fs = {};
  assert.equal(fold(fs, { fold: true }, false), true);
  assert.equal(fold(fs, { placed: true, fold: false }, false), true, 'dragged: still a bar');
  assert.equal(fold(fs, { placed: true, fold: false }, false), true);
  assert.equal(foldTap(fs, false), true);
  assert.equal(fold(fs, { placed: true, fold: false }, false), false, 'opened by the player');
  assert.equal(foldTap(fs, false), false, 'next tap is the player\'s own fold');
});
test('fold: an opened-anyway card that is dragged stays open; the player\'s own fold always wins', () => {
  const fs = {};
  fold(fs, { fold: true }, false); foldTap(fs, false);
  assert.equal(fold(fs, { fold: true }, false), false);
  assert.equal(fold(fs, { placed: true, fold: false }, false), false);
  assert.equal(fold({}, { fold: false }, true), true);
  assert.equal(foldTap({}, true), false);
});

// One resize listener for every copy of the helper the tools load (review minor, 2026-10-16).
test('layout: loading the helper again and restarting its timer adds no second resize listener', () => {
  const path = require.resolve('../ops-stack.js');
  let resize = 0, tickFn = null;
  const prev = global.window;
  global.window = { innerWidth: 400, innerHeight: 700, document: { getElementById: () => null },
    setInterval: (f) => { tickFn = f; return 1; }, clearInterval: () => {}, addEventListener: (t) => { if (t === 'resize') resize++; } };
  try {
    const card = () => ({ isConnected: true, firstElementChild: null, getBoundingClientRect: () => ({ left: 8, top: 84, right: 198, bottom: 284, width: 190, height: 200 }) });
    delete require.cache[path];
    const a = require(path), c1 = card();
    a.layout(c1, 'mask-boxes', false, () => {});
    c1.isConnected = false; tickFn();                     // its card closed: the timer stops
    delete require.cache[path];
    const b = require(path);                              // another tool loads its own copy
    b.layout(card(), 'enigma-veins', false, () => {});
    assert.equal(resize, 1);
  } finally { delete require.cache[path]; if (prev === undefined) delete global.window; else global.window = prev; }
});
