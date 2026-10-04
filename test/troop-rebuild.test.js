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

test('trainEstimate counts open queue places in the highest-level set and prices them', () => {
  const buildings = [
    { group: 1040, level: 100, queued: 2 }, { group: 1040, level: 100, queued: 0 }, { group: 1040, level: 95, queued: 0 },
    { group: 1050, level: 100, queued: 5 }, { group: 2, level: 30 }
  ];
  const buildable = { 1040: { produce_coin: 10 }, 1050: { produce_coin: 20 }, 1100: { produce_coin: 30 } };
  const e = TC.trainEstimate(buildings, buildable);
  assert.deepEqual(e.army, { units: 8, gold: 80 });
  assert.deepEqual(e.air, { units: 0, gold: 0 });
  assert.deepEqual(e.navy, { units: 0, gold: 0 });
  assert.deepEqual(e.total, { units: 8, gold: 80 });
});

test('buildingCounts sizes buildings by storage and the base space their units can land on', () => {
  const zero = { army: 0, air: 0, navy: 0 };
  // storage only: matches the old rule (1 idle Shipyard already queues 5, 181 free -> 36 more)
  assert.equal(TC.buildingCounts({ landSites: 0, seaSites: 144, landCells: 0, seaCells: 0, free: { army: 0, air: 0, navy: 181 }, open: { army: 0, air: 0, navy: 5 } }).navy, 36);
  // Dock full, open sea: keep adding Shipyards while their navy still fits on the sea that is left
  const sea = TC.buildingCounts({ landSites: 0, seaSites: 108, landCells: 0, seaCells: 519, free: zero, open: zero });
  assert.equal(sea.navy, 12);                       // 0.74 packing: measured on Tex (507 free sea cells hold at most 63 navy)
  assert.equal(TC.buildingCounts({ landSites: 0, seaSites: 5, landCells: 0, seaCells: 519, free: zero, open: zero }).navy, 5, 'never more than the sites');
  // land with storage room splits by free storage, as before
  const land = TC.buildingCounts({ landSites: 30, seaSites: 0, landCells: 0, seaCells: 0, free: { army: 100, air: 200, navy: 0 }, open: zero });
  assert.deepEqual([land.army, land.air], [10, 20]);
  // storage full: land buildings stop while their units still have room on the land
  const map = TC.buildingCounts({ landSites: 30, seaSites: 0, landCells: 100, seaCells: 0, free: zero, open: zero });
  assert.deepEqual([map.army, map.air], [3, 3]);
  // nothing to train into: no buildings
  assert.deepEqual(TC.buildingCounts({ landSites: 30, seaSites: 30, landCells: 0, seaCells: 0, free: zero, open: zero }), { army: 0, air: 0, navy: 0 });
});

test('buildingSites takes explicit counts and still never uses a site twice', () => {
  const land = Array.from({ length: 30 }, (_, i) => 1000 * (2 * i) + 10);
  const sea = [40050, 42050, 44050, 46050];
  const s = TC.buildingSites({ land, sea }, { army: 0, air: 0, navy: 0 }, { army: [], air: [], navy: [] }, { army: 4, air: 40, navy: 3 });
  assert.equal(s.army.length, 4);
  assert.equal(s.air.length, 26);
  assert.equal(s.navy.length, 3);
  assert.equal(new Set([...s.army, ...s.air]).size, 30);
});

test('crossLocationStores stores the base half of a pair split between storage and the base', () => {
  const caps = { army: 102, air: 102, navy: 102 };
  const stored = [{ id: 's1', armyId: 10050, type: 101, level: 50 }, { id: 's2', armyId: 10102, type: 101, level: 102 }];
  const units = [
    { id: 'b1', armyId: 10050, type: 101, level: 50, pos: 12028 },       // partner s1 is in storage
    { id: 'b2', armyId: 10060, type: 101, level: 60, pos: 14028 },       // no partner anywhere
    { id: 'b3', armyId: 10102, type: 101, level: 102, pos: 16028 },      // at the cap: never merges
    { id: 'b4', armyId: 10050, type: 101, level: 50, pos: 18028, state: 2 }  // busy
  ];
  assert.deepEqual(TC.crossLocationStores(stored, units, caps, { army: 5, air: 0, navy: 0 }),
    [{ kind: 'store', id: 'b1', role: 'army', from: [12, 28] }]);
  assert.deepEqual(TC.crossLocationStores(stored, units, caps, { army: 0, air: 0, navy: 0 }), [], 'full garage: nothing to store');
});

test('splitDeletable offers only true singles and holds back units that still have a partner', () => {
  const all = [
    { id: 's1', armyId: 10050, type: 101, level: 50, wh: 'w1' }, { id: 'b1', armyId: 10050, type: 101, level: 50 },
    { id: 'b2', armyId: 10060, type: 101, level: 60 }, { id: 'b3', armyId: 10005, type: 101, level: 5 },
    { id: 'b4', armyId: 30070, type: 301, level: 70 }, { id: 'b5', armyId: 30070, type: 301, level: 70, state: 2 }
  ];
  const r = TC.splitDeletable(all);
  assert.deepEqual(r.singles.map((u) => u.id), ['b2']);
  assert.deepEqual(r.paired.map((u) => u.id).sort(), ['b1', 'b4', 's1'], 'a busy partner still counts');
});

test('navyFit counts how many 2x3 navy really fit in the free sea, not just free cells', () => {
  const blank = { units: { army: [], air: [], navy: [], odd: [] }, reqLand: [], reqSea: [], parked: [], floor: {} };
  const one = TC.footprint(20, 40, 2, 3);
  const r1 = Object.assign({}, blank, { seaCells: one });
  const f1 = TC.navyFit(r1);
  assert.equal(f1.greedy, 1);
  assert.match(f1.lp, /^Maximize/);
  const frag = Object.assign({}, blank, { seaCells: one.slice(0, 5).concat(TC.footprint(40, 40, 2, 3).slice(1)) });
  const f2 = TC.navyFit(frag);
  assert.equal(f2.greedy, 0, '11 free cells in two broken pieces hold no navy');
  assert.equal(f2.lp, null);
  const busy = Object.assign({}, r1, { units: { army: [], air: [], navy: [{ cells: [one[0]] }], odd: [] } });
  assert.equal(TC.navyFit(busy).greedy, 0, 'occupied cells are not free');
});

test('buildingCounts uses a measured navy fit when it has one (each Shipyard costs about one navy spot)', () => {
  const zero = { army: 0, air: 0, navy: 0 };
  assert.equal(TC.buildingCounts({ landSites: 0, seaSites: 9, landCells: 0, seaCells: 90, seaUnits: 0, free: zero, open: { army: 0, air: 0, navy: 9 } }).navy, 0,
    'fragmented sea: the cell count says room, the measured fit says none');
  assert.equal(TC.buildingCounts({ landSites: 0, seaSites: 108, landCells: 0, seaCells: 507, seaUnits: 63, free: zero, open: zero }).navy, 11);
});

test('holeSites finds free 2x2 holes anywhere on the land, not just on the ideal grid', () => {
  const r0 = TC.buildRegion(REX);
  const before = TC.holeSites(r0, 1, {});
  const cellsOf = (u) => { const [x, y] = TC.fromPosId(u.pos); return TC.footprint(x, y, 2, 2); };
  const gone = REX.units.filter((u) => u.w === 2 && u.h === 2 && cellsOf(u).every((c) => !r0.floor[c])).slice(0, 2);
  assert.equal(gone.length, 2);
  const snap = JSON.parse(JSON.stringify(REX));
  snap.units = snap.units.filter((u) => !gone.some((g) => g.id === u.id));
  const r = TC.buildRegion(snap), occ = TC.occupiedCells(r);
  const holes = TC.holeSites(r, 1, {});
  assert.ok(holes.length >= before.length + 2, 'two freed plane spots become building spots');
  const seen = new Set();
  holes.forEach((id) => {
    const [x, y] = TC.fromPosId(id);
    TC.footprint(x, y, 2, 2).forEach((c) => {
      assert.ok(r.unitLegal(c, 1) && !r.floor[c] && !occ[c], 'cell ' + c + ' must be free, legal land, off floors');
      assert.ok(!seen.has(c), 'holes never overlap'); seen.add(c);
    });
  });
  const avoid = {}; holes.forEach((id) => { const [x, y] = TC.fromPosId(id); TC.footprint(x, y, 2, 2).forEach((c) => { avoid[c] = true; }); });
  assert.equal(TC.holeSites(r, 1, avoid).length, 0, 'cells to avoid are never used');
});

test('summariseTraining reads Bulk Training answers per type', () => {
  const sum = TC.summariseTraining([
    { role: 'army', r: { s: 0, d: '{"num":9,"finishNowNum":9,"trainingNum":0}' } },
    { role: 'navy', r: { s: 0, skipped: true } },
    { role: 'air', r: { s: 3, d: 'common_1' } }
  ]);
  assert.deepEqual(sum, {
    ordered: 9, instant: 9,
    roles: { army: { num: 9, instant: 9 }, navy: { skipped: true }, air: { error: 3 } }
  });
});

test('refillAgain repeats only while units keep arriving instantly, and never past the round limit', () => {
  assert.equal(TC.refillAgain({ ordered: 9, instant: 9 }, 1, 8), true);
  assert.equal(TC.refillAgain({ ordered: 20, instant: 0 }, 1, 8), false, 'normal queues take hours: stop');
  assert.equal(TC.refillAgain({ ordered: 0, instant: 0 }, 1, 8), false, 'no room: stop');
  assert.equal(TC.refillAgain({ ordered: 5, instant: 5 }, 8, 8), false, 'round limit');
});
