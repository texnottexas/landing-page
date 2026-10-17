'use strict';
// decor-game.js runs inside the game page; these tests stub the game modules it reads.
// Run: node --test test/decor-game.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const UID = 'secret-uid-4242';

// A tiny fake game: o overrides UserData fields; tables are {name: {id: row}}.
function stubGame(o) {
  o = o || {};
  const tables = Object.assign({
    building: {
      40800: { id: 40800, group: 4080, level: 1, max_level: 15, type: 4, width: 1, height: 2, point_type: 1, buff_max_num: 5, mutually_exclusive: '', buff_id: '910300|200', buff_ext: '', name: 'Bench' },
      40801: { id: 40801, group: 4080, level: 2, max_level: 15, type: 4, width: 1, height: 2, point_type: 1, buff_max_num: 5, mutually_exclusive: '', buff_id: '910300|240', buff_ext: '', name: 'Bench' },
      40503: { id: 40503, group: 4050, level: 4, max_level: 15, type: 5, width: 1, height: 1, point_type: 1, buff_max_num: 100, mutually_exclusive: '', buff_id: '920800|80', buff_ext: '', name: 'Purple Tile' },
      3501: { id: 3501, group: 3500, level: 1, max_level: 1, type: 23, width: 2, height: 1, point_type: 1, buff_max_num: 0, mutually_exclusive: '', buff_id: '', buff_ext: '', name: 'Noticeboard' },
      47128: { id: 47128, group: 5355, level: 3, max_level: 15, type: 4, width: 1, height: 1, point_type: 1, buff_max_num: 1, mutually_exclusive: '', buff_id: '93011601|300', buff_ext: '', name: 'Weapon Box' },
      51289: { id: 51289, group: 5701, level: 1, max_level: 15, type: 5, width: 4, height: 4, point_type: 1, buff_max_num: 1, mutually_exclusive: '', buff_id: '960012|2', buff_ext: '', name: 'Showtime' },
      44000: { id: 44000, group: 4400, level: 1, max_level: 15, type: 4, width: 1, height: 1, point_type: 1, buff_max_num: 1, mutually_exclusive: '', buff_id: '920802|2500', buff_ext: '981061|10,920803|100', name: 'Holiday Sailboat' },
      46300: { id: 46300, group: 5100, level: 1, max_level: 15, type: 4, width: 1, height: 1, point_type: 1, buff_max_num: 1, mutually_exclusive: '', buff_id: '990101|500', buff_ext: '', name: 'Black Cat' }
    },
    effect_buff: {
      910300: { id: 910300, string: 'march_speed', type: 103, value_type: 10000, battle_type: 0 },
      920800: { id: 920800, string: 'train_speed', type: 108, value_type: 10000, battle_type: 0 },
      93011601: { id: 93011601, string: 'all_atk', type: 323, value_type: 10000, battle_type: 1 },
      960012: { id: 960012, string: 'march_size', type: 153, value_type: 1, battle_type: 1 },
      990101: { id: 990101, string: 'vit', type: 192, value_type: 10000, battle_type: 0 },
      930101: { id: 930101, string: 'army_atk', type: 112, value_type: 10000, battle_type: 1, paraType1: 'ArmyType', para1: '101' },
      123014: { id: 123014, string: 'set_in_bag', type: 406, value_type: 1, battle_type: 0 },
      920802: { id: 920802, string: 'navy_train', type: 108, value_type: 10000, battle_type: 0, paraType1: 'BuildingGroup', para1: '1100' },
      981061: { id: 981061, string: 'garage_cap', type: 190, value_type: 1, battle_type: 0, paraType1: 'BuildingType', para1: '16' },
      920803: { id: 920803, string: 'air_train', type: 108, value_type: 10000, battle_type: 0, paraType1: 'BuildingGroup', para1: '1050' }
    },
    decoration_contents: {
      1216: { id: 1216, buff_isopen: 1, buff: '123014|1', content: '51289' },
      1202: { id: 1202, buff_isopen: 0, buff: '123014|1', content: '46300' }
    },
    museum_linkage_box: {
      79: { ID: 79, groupID: 5857, sheet: 7 }
    }
  }, o.tables || {});
  const TABLE = {
    _tableMap: tables,
    getTableGroup(n) { return tables[n]; },
    getTableDataById(n, id) { return (tables[n] || {})[String(id)] || null; }
  };
  const map = o.map || { w: 4, h: 4, bt: { 0: 1, 1001: 0, 2000: 2 }, ground: { '0,0': 1 } };   // posId 1000x + y
  const U = Object.assign({
    StrUid: UID, Name: 'Tex',
    Buildings: [
      { Id: 'b1', Pos: 0, Data: tables.building[40801] },
      { Id: 'b2', Pos: 1001, Data: tables.building[40503] },
      { Id: 'b3', Pos: 2000, Data: tables.building[3501] }
    ],
    BuildBoxs: [
      { _itemId: 40800, _amount: 3, _data: tables.building[40800] },
      { _itemId: 47128, _amount: 0, _data: tables.building[47128] },
      { _itemId: 44000, _amount: 1, _data: tables.building[44000] }
    ],
    _museumData: [{ labelId: 1, labelStoreData: [] }],
    collabDecorateBox: {},
    DecorationSuits: [{ _suitId: 1216 }, { _suitId: 1202 }],
    DecorationExpandData: { _dataMap: {}, getStateList() { return []; } },
    HomeFreePoints: { 0: true, 1001: true, 2000: true },
    HomeItemPoints: { 0: { itemType: 1 } },
    GroundPoints: { 1001: true }
  }, o.user || {});
  const mods = {
    DataCenter: { DATA: { UserData: U, ServerTime: 1800000000 } },
    TableManager: { TABLE },
    HomeMapCommon: { HomeMapCommon: { WidthCount: map.w, HeightCount: map.h }, HomeMapTileBlockTypeTable: map.bt },
    NHomeMapTmx: { default: {
      getTilePos(x, y) { return { x, y }; },
      getTileValue(x, y) { return map.ground[x + ',' + y] ? 15 : 0; },
      isBlocked() { return false; }
    } },
    GameTools: { default: { getDataConfigData(k) { return k === 79010 ? '4' : ''; } } },
    GameDefine: { BuffType: { DecorationActiveInBag: 406 } },
    LocalManager: { LOCAL: { getText(k) { return 'T:' + k; }, getNetMsgText(d) { return 'NET:' + d; } } },
    RequestId: { RequestId: { BUILD_MOVE: 104, Build_ByBox: 129, Build_Box_MERGE: 130, Build_In_Box: 131 } },
    NRequestId: { NRequestId: { PUT_LINKAGE_BOX: 4760, MOVE_OUT_LINKAGE_BOX: 4754, MUSEUM_MOVE_IN_DECORATION: 4755, MUSEUM_MOVE_AND_OUT_DECORATION: 4757,
      OPEN_DECORATION_SUBLIME: 4792, DECORATION_SUBLIME: 4793, DECORATION_SUBLIME_SPLIT: 4798, DECORATION_SUBLIME_UP_LEVEL: 4800 } }
  };
  // The network: o.net[rid] = (payload, U) => answer ({s, d} for JSON, {s, ack} for PB); the answer arrives 5 ms later.
  const sent = [];
  const answer = (rid, p, cb, pb) => {
    sent.push([rid, pb ? p[Object.keys(p).filter((k) => k !== 'header')[0]] : p]);
    const h = (o.net || {})[rid];
    setTimeout(() => {
      if (!h) return;                                           // no handler: no answer
      const a = h(pb ? p[Object.keys(p).filter((k) => k !== 'header')[0]] : p, U);
      if (!a) return;
      if (pb) { const key = Object.keys(p).filter((k) => k !== 'header')[0], ack = { header: { s: a.s } }; ack[key] = a.ack || {}; cb({ pbAck: ack }); }
      else cb(Object.assign({ c: rid }, a));
    }, 5);
    return true;
  };
  mods.NetMgr = { NET: { _socket: { _webSocket: { readyState: 1 } },
    send(rid, p, t, cb) { return answer(rid, p, cb, false); },
    sendPB(rid, p, t, cb) { return answer(rid, p, cb, true); } } };
  const hmap = Object.assign({ _BuildingComplete: true, calls: [],
    checkNearByPos() { return 1; },
    removeBuildingFromMap(id) { this.calls.push(['remove', id]); },
    MoveBuildingCallBack(r) { this.calls.push(['move', r.c]); const d = JSON.parse(r.d); const b = U.Buildings.find((x) => x.Id === d.building.id); if (b) b.Pos = 1000 * d.building.x + d.building.y; } }, o.hm || {});
  U.DeleteBuilding = U.DeleteBuilding || function (x) { hmap.calls.push(['delete', x.id]); U.Buildings = U.Buildings.filter((b) => b.Id !== x.id); };
  U.updateMuseumOneData = U.updateMuseumOneData || function (ack) { hmap.calls.push(['museum', ack.labelId]); U._museumData = U._museumData.map((l) => (l.labelId === ack.labelId ? ack : l)); };
  return {
    __require(n) { if (!mods[n]) throw new Error('no module ' + n); return mods[n]; },
    cc: { find: (path) => (path === 'Canvas/HomeMap' ? { getComponent: () => hmap } : null), v2: (x, y) => ({ x, y }) },
    sent, hmap, U
  };
}

function loadFresh(globals) {
  Object.assign(globalThis, { window: globalThis, __dpoLevels: undefined }, globals);
  const file = path.join(__dirname, '..', 'decor-game.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return globalThis.DecorGame;
}

test('read() reports zones, ground and occupancy per cell', () => {
  const G = loadFresh(stubGame());
  const s = G.read();
  const at = (x, y) => s.grid.cells.find((c) => c[0] === x && c[1] === y);
  assert.deepEqual(at(0, 0), [0, 0, 1, 1, 1, 1, 0], 'south, ground, free, occupied, no floor');
  assert.deepEqual(at(1, 1), [1, 1, 0, 0, 1, 0, 1], 'troop area, water, floor tile');
  assert.equal(at(2, 0)[2], 2, 'Enigma zone');
  assert.equal(at(3, 3), undefined, 'off the map');
  assert.equal(s.grid.w, 4); assert.equal(s.grid.h, 4);
});

test('read() splits base decor from buildings and keeps the bag above zero only', () => {
  const G = loadFresh(stubGame());
  const s = G.read();
  assert.equal(s.placed.length, 2);
  assert.deepEqual(s.placed[0], { uuid: 'b1', id: 40801, x: 0, y: 0 });
  assert.equal(s.buildings.length, 1);
  assert.deepEqual(s.buildings[0], { x: 2, y: 0, w: 2, h: 1 });
  assert.deepEqual(s.bag, [{ id: 40800, n: 3 }, { id: 44000, n: 1 }]);
  assert.equal(s.rows[40801].group, 4080);
  assert.deepEqual(s.levels[4080], { 1: 40800, 2: 40801 });
  assert.deepEqual(s.rows[40801].buffs, [[910300, 240]]);
  assert.equal(s.rows[40503].mp, 5); assert.equal(s.rows[40801].mp, 4);
  assert.equal(s.openLevel, 4);
});

test('read() lists active sets with the game\'s rule', () => {
  const G = loadFresh(stubGame());
  const s = G.read();
  assert.deepEqual(s.sets, [5701], 'set 1216 is active in the bag; set 1202 has buff_isopen 0');
});

test('read() never includes a UID', () => {
  const G = loadFresh(stubGame());
  assert.equal(JSON.stringify(G.read()).indexOf(UID), -1);
});

test('read() gives a unit to stats tied to a unit\'s buildings (Shipyard, Garage, Air Base...), not only ArmyType', () => {
  const G = loadFresh(stubGame());
  const s = G.read();
  assert.equal(s.stats[920802].unit, 2, 'Navy training speed: Shipyard group 1100');
  assert.equal(s.stats[981061].unit, 1, 'first Garage capacity: building type 16');
  assert.equal(s.stats[920803].unit, 3, 'Air Force training speed: Air Base group 1050');
  assert.equal(s.stats[910300].unit, 0, 'march speed is every unit');
});

// ---------------------------------------------------------------- Task 8: executors
const bagOf = (U, id) => { const b = U.BuildBoxs.find((x) => x._itemId === id); return b ? b._amount : 0; };
const bump = (U, id, n) => { const b = U.BuildBoxs.find((x) => x._itemId === id); if (b) b._amount += n; else U.BuildBoxs.push({ _itemId: id, _amount: n }); };

test('merge sends 130 once and confirms by the bag', async () => {
  const g = stubGame({ net: { 130: (p, U) => { bump(U, p.buildId, -3 * p.num); bump(U, p.buildId + 1, p.num); return { s: 0, d: '{}' }; } } });
  g.U.BuildBoxs.push({ _itemId: 40100, _amount: 504 }, { _itemId: 40101, _amount: 3 });
  g.U.Buildings.push({ Id: 'gat', Pos: 3000, Data: { id: 40101, group: 4010, level: 2, type: 4, width: 1, height: 1, point_type: 1 } });
  const t = { building: { 40100: { id: 40100, group: 4010, level: 1, type: 4, width: 1, height: 1, point_type: 1, buff_id: '921002|100' }, 40101: { id: 40101, group: 4010, level: 2, type: 4, width: 1, height: 1, point_type: 1, buff_id: '921002|120' } } };
  const G = loadFresh(g);
  const T = g.__require('TableManager').TABLE; Object.assign(T._tableMap.building, t.building);
  const r = await G.exec({ kind: 'merge', id: 40100, num: 1 }, { settleMs: 500 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(g.sent, [[130, { buildId: 40100, num: 1 }]]);
  assert.equal(bagOf(g.U, 40100), 501); assert.equal(bagOf(g.U, 40101), 4);
});

test('showcase out applies the answer\'s tab (no push comes)', async () => {
  const ack = { labelId: 1, labelName: 'Tab 1', labelStoreData: [] };
  const g = stubGame({ net: { 4757: (p, U) => { bump(U, 47128, 1); return { s: 0, ack }; } },
    user: { _museumData: [{ labelId: 1, labelStoreData: [{ uuid: 'w1', decorationId: 47128, x: 4, y: 3 }] }] } });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'toBag', where: 'showcase', ref: { labelId: 1, uuid: 'w1', x: 4, y: 3 }, id: 47128 }, { settleMs: 500 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(g.sent, [[4757, { labelId: 1, uuid: 'w1' }]]);
  assert.deepEqual(g.hmap.calls, [['museum', 1]]);
});

test('to bag from the base updates the map as the game\'s button does', async () => {
  const g = stubGame({ net: { 131: (p, U) => { bump(U, 40801, 1); return { s: 0, d: '{"ret":0}' }; } } });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'toBag', where: 'base', ref: 'b1', id: 40801 }, { settleMs: 500 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(g.sent, [[131, { id: 'b1' }]]);
  assert.deepEqual(g.hmap.calls, [['delete', 'b1'], ['remove', 'b1']]);
});

test('move calls MoveBuildingCallBack and confirms by the position', async () => {
  const g = stubGame({ net: { 104: (p) => ({ s: 0, d: JSON.stringify({ x: 0, y: 0, building: { id: p.id, x: p.x, y: p.y } }) }) } });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'move', uuid: 'b1', x: 2, y: 2 }, { settleMs: 500 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(g.sent, [[104, { x: 2, y: 2, id: 'b1' }]]);
  assert.deepEqual(g.hmap.calls, [['move', 104]]);
});

test('a stale piece sends nothing', async () => {
  const g = stubGame({ net: { 131: () => ({ s: 0, d: '{}' }) } });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'toBag', where: 'base', ref: 'gone', id: 40801 }, { settleMs: 200 });
  assert.deepEqual(r, { ok: false, why: 'stale' });
  assert.equal(g.sent.length, 0);
});

test('a spot the game refuses is stale too, and nothing is sent', async () => {
  const g = stubGame({ net: { 129: () => ({ s: 0, d: '{}' }) }, hm: { checkNearByPos() { return -1; } } });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'place', id: 40800, x: 1, y: 1 }, { settleMs: 200 });
  assert.deepEqual(r, { ok: false, why: 'stale' });
  assert.equal(g.sent.length, 0);
});

test('a silent state stops: the answer says yes but nothing changes', async () => {
  const g = stubGame({ net: { 130: () => ({ s: 0, d: '{}' }) } });
  g.U.BuildBoxs.push({ _itemId: 40100, _amount: 504 });
  const G = loadFresh(g);
  Object.assign(g.__require('TableManager').TABLE._tableMap.building, { 40100: { id: 40100, group: 4010, level: 1, type: 4, width: 1, height: 1, point_type: 1, buff_id: '921002|100' }, 40101: { id: 40101, group: 4010, level: 2, type: 4, width: 1, height: 1, point_type: 1, buff_id: '921002|120' } });
  const r = await G.exec({ kind: 'merge', id: 40100, num: 1 }, { settleMs: 300 });
  assert.equal(r.ok, false); assert.match(r.why, /didn't confirm/);
});

test('a refusal gives the game\'s own text; no answer gives "no answer"', async () => {
  const g = stubGame({ net: { 129: () => ({ s: 3, d: '"build_err"' }) } });
  g.U.BuildBoxs.push({ _itemId: 40801, _amount: 1 });
  const G = loadFresh(g);
  const r = await G.exec({ kind: 'place', id: 40801, x: 1, y: 1 }, { settleMs: 200 });
  assert.deepEqual(r, { ok: false, why: 'NET:"build_err"' });
  const g2 = stubGame({});
  g2.U.BuildBoxs.push({ _itemId: 40801, _amount: 1 });
  const G2 = loadFresh(g2);
  const r2 = await G2.exec({ kind: 'place', id: 40801, x: 1, y: 1 }, { settleMs: 200, timeoutMs: 100 });
  assert.deepEqual(r2, { ok: false, why: 'no answer' });
});
