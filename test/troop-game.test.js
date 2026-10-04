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

// ---------------------------------------------------------------- final-review fixes
// A minimal stand-in for the game: HomeMap, UserData, NET and TABLE, enough for runSteps.
function fakeGame(o = {}) {
  const sent = [];
  const hm = {
    armyInited: true, _ArmyComplete: true, _BuildingComplete: true,
    ArmyItems: o.armyItems || {}, getBuildingItemById: (id) => (o.buildings || {})[id] || null,
    checkNearByPos: () => 1, MoveArmyCallBack: o.moveCb || (() => {}), MoveBuildingCallBack: () => {}
  };
  const UD = { Armys: o.armys || [], _wareHouseList: o.whList || [], getBuildingById: (id) => (o.whBuildings || {})[id] || null };
  const NET = { send: (rid, payload, ctx, cb) => { sent.push([rid, payload]); const r = o.respond ? o.respond(rid, payload) : { s: 0, d: '{}' }; if (r !== 'never') setTimeout(() => cb(r), o.netDelay || 0); } };
  const mods = { DataCenter: { DATA: { UserData: UD } }, NetMgr: { NET }, TableManager: { TABLE: { getTableDataById: () => null } } };
  return { globals: { cc: { find: () => ({ getComponent: () => hm }), v2: (x, y) => ({ x, y }) }, __require: (n) => mods[n] }, sent, hm, UD };
}
const unitItem = (id) => ({ ID: id, ArmyData: { Data: { id: 30100, width: 2, height: 2, point_type: 1 } } });

test('a game callback that throws ends the run with an error instead of hanging', async () => {
  const g = fakeGame({ armyItems: { u1: unitItem('u1') }, moveCb: () => { throw new Error('boom'); } });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  const res = await TG.runSteps([{ kind: 'moveUnit', id: 'u1', to: [1, 1] }], {});
  assert.equal(res.ok, false);
  assert.match(res.error, /step 1/);
});

test('a store counts only once the unit is really in storage', async () => {
  const rec = { _id: 'u1', warehouseId: '0' };
  const base = { armyItems: { u1: unitItem('u1') }, armys: [rec], whList: [{ id: 'w1' }], whBuildings: { w1: { Data: { type: 18 } } } };
  const g1 = fakeGame(base);
  const TG1 = loadFresh(g1.globals); TG1.config.paceMs = [0, 0]; TG1.config.storeConfirmMs = 60;
  const r1 = await TG1.runSteps([{ kind: 'store', id: 'u1', role: 'air' }], {});
  assert.equal(r1.ok, false);
  assert.match(r1.error, /storage/);
  const g2 = fakeGame({ ...base, respond: (rid) => { if (rid === 226) rec.warehouseId = 'w1'; return { s: 0, d: '{}' }; } });
  const TG2 = loadFresh(g2.globals); TG2.config.paceMs = [0, 0]; TG2.config.storeConfirmMs = 60;
  const r2 = await TG2.runSteps([{ kind: 'store', id: 'u1', role: 'air' }], {});
  assert.equal(r2.ok, true);
});

test('only one run at a time, and stop() ends the run in progress', async () => {
  const g = fakeGame({ armyItems: { u1: unitItem('u1'), u2: unitItem('u2'), u3: unitItem('u3') }, netDelay: 30 });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  const steps = ['u1', 'u2', 'u3'].map((id) => ({ kind: 'moveUnit', id, to: [1, 1] }));
  const first = TG.runSteps(steps, {});
  const second = await TG.runSteps(steps, {});
  assert.equal(second.ok, false);
  assert.match(second.error, /already/);
  TG.stop();
  const r = await first;
  assert.equal(r.ok, false);
  assert.match(r.error, /Stopped/);
  assert.ok(r.done < 3);
  const again = await TG.runSteps([steps[0]], {});
  assert.equal(again.ok, true, 'a new run starts after the old one stopped');
});

test('the solver download gives up after the timeout', async () => {
  const TG = loadFresh({ cc: { find: () => null }, __require: () => null,
    fetch: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  TG.config.solverTimeoutMs = 30;
  await assert.rejects(TG.loadHighs(), /timed out/);
});
