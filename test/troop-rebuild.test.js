'use strict';
// v2 Troop Rebuild: pure rules (cleanup, skin, training-building sites, extras).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const TC = require('../troop-core.js');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const TEX = fx('troop-tex.json');
const REX = fx('troop-rex-before.json');

test('deleteCandidates keeps Lv1-9 and Lv100+, and never touches busy units', () => {
  const u = (id, level, state = 0) => ({ id, level, state, type: 101 });
  const got = TC.deleteCandidates([u('a', 9), u('b', 10), u('c', 55), u('d', 99), u('e', 100), u('f', 102), u('g', 50, 2)]).map((x) => x.id);
  assert.deepEqual(got, ['b', 'c', 'd']);
});

test('bestTrainingSkin keeps the current skin on a tie and switches only for a stronger one', () => {
  const skins = [
    { id: 1853000, equip_buff: '990632,5000|990686,7000|930100,3000|920800,2000' },   // Shatterdome
    { id: 1795000, equip_buff: '920800,2000|930100,1500|930000,1500' },               // Training Base
    { id: 1794000, equip_buff: '920800,1600|930100,1200|930000,1200' },
    { id: 1710500, equip_buff: '930100,500' }
  ];
  assert.deepEqual(TC.bestTrainingSkin(skins, 1853000), { id: 1853000, value: 2000, currentValue: 2000, change: false });
  assert.deepEqual(TC.bestTrainingSkin(skins, 1710500), { id: 1853000, value: 2000, currentValue: 0, change: true });
  assert.equal(TC.bestTrainingSkin([], 5).change, false);
});

test('freeSites only offers empty, floor-free, legal 2x2 spots', () => {
  const r = TC.buildRegion(REX);
  const anchors = [8050, 43007, 11019];            // (8,50) under decorations, (43,7) under a plane, (11,19) partly under the army unit
  assert.deepEqual(TC.freeSites(r, anchors, 1), []);
  const t = TC.buildRegion(TEX);
  const sites = TC.freeSites(t, t.landCells, 1);
  assert.ok(sites.length > 100);
  sites.forEach((id) => { const [x, y] = TC.fromPosId(id); TC.footprint(x, y, 2, 2).forEach((c) => { assert.ok(!t.floor[c]); assert.ok(t.unitLegal(c, 1)); }); });
});

test('buildSeaSlotsLP has nothing to solve on an empty sea and real slots on a full base', () => {
  const t = TC.buildRegion(TEX);
  const m = TC.buildSeaSlotsLP(t);
  assert.ok(m.slots.length > 0);
  assert.match(m.lp, /\nEnd$/);
  const empty = TC.buildSeaSlotsLP({ seaCells: [], floor: {} });
  assert.equal(empty.lp, null);
  assert.deepEqual(TC.decodeSeaSlots(empty, null), []);
});

test('buildingSites splits land by free storage, caps by what storage can absorb, skips full storage', () => {
  const land = Array.from({ length: 30 }, (_, i) => 1000 * (2 * i) + 10);
  const sea = [40050, 42050, 44050, 46050];
  const s1 = TC.buildingSites({ land, sea }, { army: 100, air: 200, navy: 40 }, { army: [], air: [], navy: [] });
  assert.equal(s1.army.length, 10);                 // 30 land sites, 1:2 split -> 10 army, 20 air
  assert.equal(s1.air.length, 20);
  assert.equal(s1.navy.length, 4);
  const s2 = TC.buildingSites({ land, sea }, { army: 12, air: 200, navy: 0 }, { army: [2018], air: [], navy: [] });
  assert.equal(s2.army.length, 2);                  // ceil(12/5)=3 minus 1 existing barracks
  assert.equal(s2.air.length, 28);                  // the rest of the land goes to air bases
  assert.equal(s2.navy.length, 0);                  // full dock: no shipyards
  const all = new Set([...s2.army, ...s2.air]);
  assert.equal(all.size, s2.army.length + s2.air.length, 'no site is used twice');
});

test('fitToGold trims the building plan to what the gold covers', () => {
  const plan = { army: [1, 2, 3, 4], air: [5, 6, 7, 8, 9, 10], navy: [11, 12] };
  const fit = TC.fitToGold(plan, 10, 55);           // 10 gold per building -> 5 buildings
  assert.equal(fit.army.length + fit.air.length + fit.navy.length, 5);
  assert.deepEqual(TC.fitToGold(plan, 10, 1e9), plan);
});

test('extraTrainingBuildings keeps one of each type (highest level, lowest posId) and spares busy ones', () => {
  const b = (id, group, level, pos, busy = 0) => ({ id, group, level, pos, busy });
  const list = [b('a1', 1050, 100, 12028), b('a2', 1050, 100, 8028), b('a3', 1050, 99, 4000), b('a4', 1050, 100, 30000, 1),
    b('k1', 1040, 100, 8024), b('s1', 1100, 100, 35037), b('g1', 2700, 1, 6030)];
  assert.deepEqual(TC.extraTrainingBuildings(list).map((x) => x.id).sort(), ['a1', 'a3']);
});

test('mergeablePairs counts the first round of free merges below the cap', () => {
  const u = (armyId, type, level) => ({ armyId, type, level, state: 0 });
  const units = [u(10100, 101, 100), u(10100, 101, 100), u(10100, 101, 100), u(30102, 301, 102), u(30102, 301, 102), u(20050, 201, 50), u(20050, 201, 50)];
  assert.equal(TC.mergeablePairs(units, { army: 102, air: 102, navy: 102 }), 2);   // 1 army pair + 1 navy pair; Lv102 planes are at the cap
});
