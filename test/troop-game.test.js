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
    checkNearByPos: () => 1, MoveArmyCallBack: o.moveCb || (() => {}), MoveBuildingCallBack: () => {},
    removed: [], removeBuildingFromMap(id) { this.removed.push(id); }
  };
  const UD = { Armys: o.armys || [], _wareHouseList: o.whList || [], getBuildingById: (id) => (o.whBuildings || {})[id] || null,
    deleted: [], DeleteBuilding(b) { this.deleted.push(b); }, getBuildingArrayByBuildingGroup: (g) => (o.groups || {})[g] || [] };
  const NET = { send: (rid, payload, ctx, cb) => { sent.push([rid, payload]); const r = o.respond ? o.respond(rid, payload) : { s: 0, d: '{}' }; if (r !== 'never') setTimeout(() => cb(r), o.netDelay || 0); } };
  const mods = Object.assign({ DataCenter: { DATA: { UserData: UD } }, NetMgr: { NET }, TableManager: { TABLE: { getTableDataById: (t, id) => ((o.tables || {})[t] || {})[id] || null } } }, o.mods || {});
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

// ---------------------------------------------------------------- v2 rebuild executors
const army = (id, level, state = 0, wh = 'w1') => ({ _id: id, _data: { level }, _state: state, warehouseId: wh });

test('deleting refuses anything outside Lv10-99, busy, or unknown, and sends nothing', async () => {
  for (const a of [army('x', 100), army('x', 9), army('x', 50, 2)]) {
    const g = fakeGame({ armys: [a] });
    const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
    const r = await TG.runSteps([{ kind: 'deleteStored', ids: ['x'] }], {});
    assert.equal(r.ok, false);
    assert.match(r.error, /Refused/);
    assert.deepEqual(g.sent, []);
  }
  const g2 = fakeGame({ armys: [] });
  const TG2 = loadFresh(g2.globals); TG2.config.paceMs = [0, 0];
  assert.equal((await TG2.runSteps([{ kind: 'deleteUnit', id: 'ghost' }], {})).ok, false);
});

test('demoted units in storage go out in one batch request, base units one by one', async () => {
  const g = fakeGame({ armys: [army('a', 50), army('b', 77), army('m', 20, 0, '0')] });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  const r = await TG.runSteps([{ kind: 'deleteStored', ids: ['a', 'b'] }, { kind: 'deleteUnit', id: 'm' }], {});
  assert.equal(r.ok, true);
  assert.deepEqual(g.sent, [[139, { ids: ['a', 'b'] }], [112, { id: 'm' }]]);
});

test('merge steps marked tolerant carry on when the game has nothing to merge', async () => {
  const g = fakeGame({ whList: [{ id: 'h1' }, { id: 'h2' }, { id: 'g1' }], whBuildings: { h1: { Data: { type: 18 } }, h2: { Data: { type: 18 } }, g1: { Data: { type: 16 } } },
    respond: () => ({ s: 3, d: 'nothing to merge' }) });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  const r = await TG.runSteps([{ kind: 'mergeStorage', role: 'air', tolerant: true }, { kind: 'mergeBase', role: 'air', tolerant: true }], {});
  assert.equal(r.ok, true);
  assert.deepEqual(g.sent, [[219, { buildId: 'h1,h2' }], [224, { type: 301 }]]);
});

test('a training building is placed only where the game accepts it', async () => {
  const tables = { building: { 105100: { id: 105100, width: 2, height: 2, point_type: 1 } } };
  const g = fakeGame({ tables });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  assert.equal((await TG.runSteps([{ kind: 'build', buildingId: 105100, to: [8, 28] }], {})).ok, true);
  assert.deepEqual(g.sent, [[100, { x: 8, y: 28, buildingId: 105100 }]]);
  const g2 = fakeGame({ tables }); g2.hm.checkNearByPos = () => -1;
  const TG2 = loadFresh(g2.globals); TG2.config.paceMs = [0, 0];
  const r2 = await TG2.runSteps([{ kind: 'build', buildingId: 105100, to: [8, 28] }], {});
  assert.equal(r2.ok, false);
  assert.deepEqual(g2.sent, []);
});

test('deleting a training building updates the client, and a busy one is kept', async () => {
  const idle = { BuildingData: { _curProductNum: 0 } }, busy = { BuildingData: { _curProductNum: 2 } };
  const g = fakeGame({ buildings: { b9: idle, b8: busy }, respond: () => ({ s: 0, d: JSON.stringify({ building: { id: 'b9' } }) }) });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  assert.equal((await TG.runSteps([{ kind: 'deleteBuilding', id: 'b9' }], {})).ok, true);
  assert.deepEqual(g.UD.deleted, [{ id: 'b9' }]);
  assert.deepEqual(g.hm.removed, ['b9']);
  const r = await TG.runSteps([{ kind: 'deleteBuilding', id: 'b8' }], {});
  assert.equal(r.ok, false);
  assert.match(r.error, /still training/);
});

test('Bulk Training runs through the game and its answer is reported', async () => {
  let net;
  const shortcut = { MainUiShortcutUtils: { _instance: { batchTraining: (row, empty) => net.send(180, { ids: ['a1'], posList: [], row: row.id, empty }) } } };
  const gameTools = { default: { wareHouseDirty() {}, wareHouseSpaceCache: {}, getWareHouseEmptySpace: () => 7 } };
  const g = fakeGame({ groups: { 1050: [{ BuildingId: 105100 }] }, tables: { building: { 105100: { id: 105100 } } },
    mods: { MainUiShortcutUtils: shortcut, GameTools: gameTools }, respond: () => ({ s: 0, d: '{"finishNowNum":3,"num":5,"trainingNum":2}' }) });
  net = g.globals.__require('NetMgr').NET;
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  const seen = [];
  const r = await TG.runSteps([{ kind: 'train', role: 'air' }], { onStep: (i, st, resp) => seen.push(resp) });
  assert.equal(r.ok, true);
  assert.deepEqual(g.sent, [[180, { ids: ['a1'], posList: [], row: 105100, empty: 7 }]]);
  assert.equal(JSON.parse(seen[0].d).num, 5);
});

test('equipping a skin goes through the game and records it only on success', async () => {
  const ac = { ActivityController: { Instance: { tryOffCastleCos: (cb) => cb() } } };
  const g = fakeGame({ mods: { ActivityController: ac }, respond: () => ({ s: 0, d: '{"ret":0}' }) });
  const TG = loadFresh(g.globals); TG.config.paceMs = [0, 0];
  assert.equal((await TG.runSteps([{ kind: 'equipSkin', id: 1795000 }], {})).ok, true);
  assert.equal(g.UD.UsingCastleFace, 1795000);
  const g2 = fakeGame({ mods: { ActivityController: ac }, respond: () => ({ s: 0, d: '{"ret":7}' }) });
  const TG2 = loadFresh(g2.globals); TG2.config.paceMs = [0, 0];
  const r2 = await TG2.runSteps([{ kind: 'equipSkin', id: 1795000 }], {});
  assert.equal(r2.ok, false);
  assert.match(r2.error, /would not switch/);
  assert.equal(g2.UD.UsingCastleFace, undefined);
});

test('the account id comes from the game, so a saved skin never crosses accounts', () => {
  const g = fakeGame();
  Object.defineProperty(g.UD, 'StrUid', { get: () => '7000000000001' });
  const TG = loadFresh(g.globals);
  assert.equal(TG.accountId(), '7000000000001');
  const g2 = fakeGame(); g2.UD._uid = 7000000000002;
  assert.equal(loadFresh(g2.globals).accountId(), '7000000000002');
  assert.equal(loadFresh(fakeGame().globals).accountId(), '');
});
