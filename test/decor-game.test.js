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
    LocalManager: { LOCAL: { getText(k) { return 'T:' + k; } } }
  };
  return {
    __require(n) { if (!mods[n]) throw new Error('no module ' + n); return mods[n]; },
    cc: { find: () => null }
  };
}

function loadFresh(globals) {
  Object.assign(globalThis, { window: globalThis }, globals);
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
