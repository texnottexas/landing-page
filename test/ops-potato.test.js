'use strict';
// Potato mode rules (Tex, 2026-10-17): the frame cap, which windows freeze the base, and the game's low-quality setting.
// Run: node --test test/ops-potato.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../ops-potato.js');

test('the cap is 29 frames a second (Tex): not 30 or 60, which the engine ties to the screen refresh rate', () => {
  assert.equal(P.FPS, 29);
  assert.equal(P.cap(60, true), 29);
  assert.equal(P.cap(30, true), 29);
  assert.equal(P.cap(60, false), 60, 'off: whatever the game asks');
});

test('the base freezes only behind a full-screen window, and only on a screen taller than it is wide (a phone held upright)', () => {
  assert.equal(P.freeze(['UIFrameNone', 'UIFrameScreenV1'], 390, 844), true, 'chat on a phone');
  assert.equal(P.freeze(['UIFrameScreen'], 390, 844), true, 'the bag on a phone');
  assert.equal(P.freeze(['UIFrameNone', 'UIFramePop'], 390, 844), false, 'a small pop-up leaves the base drawn');
  assert.equal(P.freeze([], 390, 844), false);
  assert.equal(P.freeze(['UIFrameScreenV1'], 1512, 661), false, 'wide screens would show black sides: never');
  assert.equal(P.freeze(['UIFrameScreenV1'], 800, 800), false, 'square: never');
});

test('low-quality setting: on saves "1" and remembers what the player had; off puts it back; a reload is needed only when the game runs the other way', () => {
  // never set before, the game running normal quality
  assert.deepEqual(P.lowPlan({ on: true, stored: null, prev: null, running: false }), { store: '1', prev: { v: null }, reload: true });
  // off again: the player's old setting (none) comes back
  assert.deepEqual(P.lowPlan({ on: false, stored: '1', prev: { v: null }, running: true }), { store: null, prev: null, reload: true });
  // the player already had low quality on: nothing to change, no reload either way
  assert.deepEqual(P.lowPlan({ on: true, stored: '1', prev: null, running: true }), { store: '1', prev: { v: '1' }, reload: false });
  assert.deepEqual(P.lowPlan({ on: false, stored: '1', prev: { v: '1' }, running: true }), { store: '1', prev: null, reload: false });
  // the player had it explicitly off ('0'): on asks a reload, off restores '0'
  assert.deepEqual(P.lowPlan({ on: true, stored: '0', prev: null, running: false }), { store: '1', prev: { v: '0' }, reload: true });
  assert.deepEqual(P.lowPlan({ on: false, stored: '1', prev: { v: '0' }, running: true }), { store: '0', prev: null, reload: true });
  // switched on twice: the first remembered setting is kept, not the "1" we wrote
  assert.deepEqual(P.lowPlan({ on: true, stored: '1', prev: { v: null }, running: true }), { store: '1', prev: { v: null }, reload: false });
  // off with nothing remembered (someone cleared it): leave the game's setting alone
  assert.deepEqual(P.lowPlan({ on: false, stored: '1', prev: null, running: true }), { store: '1', prev: null, reload: false });
  // the player changed the game's own setting while potato was on: off keeps their newer choice (review)
  assert.deepEqual(P.lowPlan({ on: false, stored: '0', prev: { v: '1' }, running: false }), { store: '0', prev: null, reload: false });
  assert.deepEqual(P.lowPlan({ on: false, stored: null, prev: { v: '1' }, running: false }), { store: null, prev: null, reload: false });
});

test('a stored value counts as low quality the way the game reads it (JSON, truthy)', () => {
  assert.equal(P.isLow('1'), true);
  assert.equal(P.isLow('true'), true);
  assert.equal(P.isLow('0'), false);
  assert.equal(P.isLow(null), false);
  assert.equal(P.isLow('not json'), false);
});
