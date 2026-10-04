'use strict';
// troop-game.js runs inside the game page; these tests stub the browser globals it touches.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh(globals) {
  Object.assign(globalThis, { window: globalThis }, globals);
  const file = path.join(__dirname, '..', 'troop-game.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return globalThis.TroopGame;
}

test('runSteps stops cleanly when the base is not open', async () => {
  const TG = loadFresh({ cc: { find: () => null }, __require: () => { throw new Error('no game'); } });
  const res = await TG.runSteps([{ kind: 'moveUnit', id: 'u1', to: [1, 1] }], {});
  assert.equal(res.ok, false);
  assert.equal(res.done, 0);
  assert.match(res.error, /base closed/);
});

test('loadHighs refuses a solver file whose checksum does not match', async () => {
  const TG = loadFresh({ cc: { find: () => null }, __require: () => null,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('not the real file').buffer }) });
  await assert.rejects(TG.loadHighs(), /pinned checksum/);
});

test('loadHighs reports a failed download and allows a retry', async () => {
  let calls = 0;
  const TG = loadFresh({ cc: { find: () => null }, __require: () => null,
    fetch: async () => { calls++; return { ok: false, status: 503 }; } });
  await assert.rejects(TG.loadHighs(), /download failed \(503\)/);
  await assert.rejects(TG.loadHighs(), /download failed/);
  assert.ok(calls >= 3, 'second call fetched again instead of reusing a rejected promise');
});
