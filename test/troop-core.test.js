'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const TC = require('../troop-core.js');

const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const REX = fx('troop-rex-before.json');
const TEX = fx('troop-tex.json');
const REX_TARGET = fx('troop-rex-target-178.json');

function withArmyCells(region, slots) {
  const taken = new Set();
  slots.forEach((s) => { const [x, y] = TC.fromPosId(s.pos); TC.footprint(x, y, 2, 2).forEach((c) => taken.add(c)); });
  return { slots, armyCells: region.landCells.filter((id) => !taken.has(id)) };
}

test('posId / fromPosId / footprint / toUV', () => {
  assert.equal(TC.posId(12, 28), 12028);
  assert.deepEqual(TC.fromPosId(12028), [12, 28]);
  assert.deepEqual(TC.footprint(8, 50, 2, 2), [8050, 9051, 7051, 8052]);
  assert.deepEqual(TC.footprint(10, 10, 2, 3).length, 6);
  assert.deepEqual(TC.toUV(8, 50), [29, 21]);
});

test('unitClass uses footprint as well as type', () => {
  assert.equal(TC.unitClass({ type: 101, w: 1, h: 1 }), 'army');
  assert.equal(TC.unitClass({ type: 301, w: 2, h: 2 }), 'air');
  assert.equal(TC.unitClass({ type: 201, w: 2, h: 3 }), 'navy');
  assert.equal(TC.unitClass({ type: 101, w: 2, h: 2 }), 'odd');
});

test('Rex region: identical 762-cell land area, 6 required land buildings, 10 land decorations parked', () => {
  const r = TC.buildRegion(REX);
  assert.equal(r.landCells.length, 762);
  assert.equal(r.reqLand.length, 6);
  const landParks = r.parked.filter((p) => p.item.pt === 1);
  assert.equal(landParks.length, 10);
  // parking spots match the run executed on 2026-10-03 (keyed by original position)
  const expected = { 2044: [0, 62], 10046: [0, 64], 12044: [4, 66], 5049: [0, 56], 1043: [0, 60], 9051: [0, 68], 8052: [4, 56], 7051: [4, 68], 8050: [4, 70], 3049: [5, 55] };
  landParks.forEach((p) => assert.deepEqual(p.to, expected[TC.posId(p.item.x, p.item.y)]));
});

test('every unit on Rex\'s map sits on cells the model calls legal', () => {
  const r = TC.buildRegion(REX);
  assert.equal(REX.units.length, 158);
  REX.units.forEach((u) => {
    const [x, y] = TC.fromPosId(u.pos);
    TC.footprint(x, y, u.w, u.h).forEach((c) => assert.ok(r.unitLegal(c, u.pt), 'illegal cell ' + c + ' for unit ' + u.id));
  });
});

test('Tex region matches Rex geometry (fully unlocked bases share one unit area)', () => {
  const t = TC.buildRegion(TEX), r = TC.buildRegion(REX);
  assert.equal(t.landCells.length, 762);
  assert.equal(t.reqLand.length, 10);
  const legal = (reg, pt) => Object.keys(reg.cells).map(Number).filter((id) => reg.unitLegal(id, pt)).sort((a, b) => a - b);
  assert.deepEqual(legal(t, 1), legal(r, 1));
  assert.deepEqual(legal(t, 0), legal(r, 0));
});

test('units that are still producing are left where they are', () => {
  const snap = JSON.parse(JSON.stringify(REX));
  snap.units[0].state = 2;
  const r = TC.buildRegion(snap);
  assert.equal(r.units.odd.length, 1);
  const [x, y] = TC.fromPosId(snap.units[0].pos);
  TC.footprint(x, y, 2, 2).forEach((c) => assert.ok(r.fixed[c]));
});

test('buildLandLP emits a well-formed CPLEX LP with the building and count rows', () => {
  const m = TC.buildLandLP(TC.buildRegion(REX), { mode: 'planes' });
  assert.match(m.lp, /^Maximize\n obj: /);
  assert.match(m.lp, /\n nb: [\s\S]*? = 6\n/);
  assert.match(m.lp, /\nBinary\n/);
  assert.match(m.lp, /\nEnd$/);
  assert.equal(m.count, undefined);
  const h = TC.buildLandLP(TC.buildRegion(REX), { mode: 'half' });
  assert.equal(h.count, 6 + Math.floor((762 - 24) / 8));
  const u = TC.buildLandLP(TC.buildRegion(REX), { mode: 'units', keepPlanes: true });
  assert.equal(u.count, 6 + 157);
});

test('greedyLand fallback gets within 3% of the optimum and seats every building', () => {
  const r = TC.buildRegion(REX);
  const g = TC.greedyLand(r, {});
  assert.ok(g.approximate);
  assert.ok(g.slots.length >= 173, 'greedy slots ' + g.slots.length);
  assert.equal(g.slots.filter((s) => s.role === 'bld').length, 6);
});

test('planSteps replays Rex max-planes: 10 parks, 1 army stored, all slots reached, no deadlock', () => {
  const r = TC.buildRegion(REX);
  const res = TC.planSteps(REX, r, withArmyCells(r, REX_TARGET.slots), { mode: 'planes' });
  assert.deepEqual(res.blocked, []);
  assert.equal(res.stats.parks, 10);
  assert.equal(res.stats.stores, 1);
  assert.equal(res.stats.temps, 0);
  assert.ok(res.stats.moves <= 80, 'moves ' + res.stats.moves);
  assert.equal(res.stats.emptyAirSlots, 15);
  // parks come first, then the store, then moves
  const kinds = res.steps.map((s) => s.kind);
  assert.equal(kinds.lastIndexOf('park'), 9);
  assert.equal(kinds.indexOf('store'), 10);
  // the final layout puts every plane on an air slot and every building on a building slot
  const slotRole = new Map(REX_TARGET.slots.map((s) => [s.pos, s.role]));
  r.units.air.forEach((u) => assert.equal(slotRole.get(TC.posId(...res.final[u.id])), 'air'));
  r.reqLand.forEach((b) => assert.equal(slotRole.get(TC.posId(...res.final[b.id])), 'bld'));
});

test('planSteps never moves an item onto cells it still occupies, and every move lands on free cells', () => {
  const r = TC.buildRegion(REX);
  const res = TC.planSteps(REX, r, withArmyCells(r, REX_TARGET.slots), { mode: 'planes' });
  const occ = new Map();
  const sizes = new Map();
  [...r.units.air, ...r.units.army, ...r.reqLand].forEach((it) => { sizes.set(it.id, [it.w, it.h]); TC.footprint(it.x, it.y, it.w, it.h).forEach((c) => occ.set(c, it.id)); });
  res.steps.forEach((s) => {
    if (s.kind === 'park') return;
    const [w, h] = sizes.get(s.id);
    TC.footprint(s.from[0], s.from[1], w, h).forEach((c) => { if (occ.get(c) === s.id) occ.delete(c); });
    if (s.kind === 'store') return;
    TC.footprint(s.to[0], s.to[1], w, h).forEach((c) => { assert.ok(!occ.has(c), 'step onto occupied cell ' + c); occ.set(c, s.id); });
  });
});

test('an already optimal layout plans zero moves (idempotent resume)', () => {
  const r = TC.buildRegion(REX);
  const first = TC.planSteps(REX, r, withArmyCells(r, REX_TARGET.slots), { mode: 'planes' });
  const after = JSON.parse(JSON.stringify(REX));
  const moved = new Map(Object.entries(first.final));
  const parkTo = new Map(first.parks.map((p) => [p.item.id, p.to]));
  const stored = new Set(first.steps.filter((s) => s.kind === 'store').map((s) => s.id));
  after.units = after.units.filter((u) => !stored.has(u.id)).map((u) => moved.has(u.id) ? { ...u, pos: TC.posId(...moved.get(u.id)) } : u);
  after.buildings = after.buildings.map((b) => moved.has(b.id) ? { ...b, pos: TC.posId(...moved.get(b.id)) } : (parkTo.has(b.id) ? { ...b, pos: TC.posId(...parkTo.get(b.id)) } : b));
  after.storage = { ...after.storage, army: { max: 686, used: 31 } };
  const r2 = TC.buildRegion(after);
  const again = TC.planSteps(after, r2, withArmyCells(r2, REX_TARGET.slots), { mode: 'planes' });
  assert.equal(again.steps.length, 0);
});

test('storage_full is reported when excess units have nowhere to go', () => {
  const snap = JSON.parse(JSON.stringify(REX));
  snap.storage.army = { max: 686, used: 686 };
  const r = TC.buildRegion(snap);
  const target = withArmyCells(r, REX_TARGET.slots);
  target.armyCells = [];                         // no leftover cells: the army unit must be stored
  const res = TC.planSteps(snap, r, target, { mode: 'planes' });
  assert.deepEqual(res.blocked.map((b) => b.reason), ['storage_full']);
});

test('greedy fallback plans without deadlock', () => {
  const r = TC.buildRegion(REX);
  const res = TC.planSteps(REX, r, TC.greedyLand(r, {}), { mode: 'planes' });
  assert.equal(res.blocked.filter((b) => b.reason === 'deadlock').length, 0);
});

test('a partly unlocked base still plans cleanly', () => {
  const snap = JSON.parse(JSON.stringify(REX));
  const F = snap.cellFields.split(','), ix = F.indexOf('free'), xi = F.indexOf('x');
  snap.cells.forEach((c) => { if (c[xi] >= 40) c[ix] = 0; });      // lock the eastern half
  snap.units = snap.units.filter((u) => Math.floor(u.pos / 1000) < 38);
  snap.buildings = snap.buildings.filter((b) => Math.floor(b.pos / 1000) < 38);
  const r = TC.buildRegion(snap);
  assert.ok(r.landCells.length > 0 && r.landCells.length < 762);
  const m = TC.buildLandLP(r, { mode: 'planes' });
  assert.match(m.lp, /\nEnd$/);
  const g = TC.greedyLand(r, {});
  const res = TC.planSteps(snap, r, g, { mode: 'planes' });
  assert.equal(res.blocked.filter((b) => b.reason === 'deadlock').length, 0);
});

test('lockTargets: planes get air slots, army only when allowed, navy only when planned', () => {
  const t = { slots: [{ pos: 8050, role: 'air' }, { pos: 2018, role: 'bld' }], armyCells: [11019, 12020] };
  assert.deepEqual(TC.lockTargets(t, 2, 2, 1, {}), [8050]);
  assert.deepEqual(TC.lockTargets(t, 1, 1, 1, { mode: 'planes' }), []);
  assert.deepEqual(TC.lockTargets(t, 1, 1, 1, { mode: 'planes', fillArmy: true }), [11019, 12020]);
  assert.deepEqual(TC.lockTargets(t, 1, 1, 1, { mode: 'units' }), [11019, 12020]);
  assert.equal(TC.lockTargets(t, 2, 3, 0, {}), null);
  assert.deepEqual(TC.lockTargets({ ...t, navy: [35037] }, 2, 3, 0, {}), [35037]);
});

test('renderModel marks movers in Before and empty planned slots in After', () => {
  const r = TC.buildRegion(REX);
  const target = withArmyCells(r, REX_TARGET.slots);
  const res = TC.planSteps(REX, r, target, { mode: 'planes' });
  const m = TC.renderModel(REX, r, target, res);
  const count = (map, cat) => Object.values(map).filter((c) => c === cat).length;
  assert.equal(count(m.after, 'airEmpty'), 15 * 4);
  assert.ok(count(m.before, 'airMoving') > 0);
  assert.equal(count(m.after, 'deco'), count(m.before, 'decoMoving'));
});

test('renderModel outlines each unit, building and parked decoration once per map', () => {
  const r = TC.buildRegion(REX);
  const target = withArmyCells(r, REX_TARGET.slots);
  const res = TC.planSteps(REX, r, target, { mode: 'planes' });
  const m = TC.renderModel(REX, r, target, res);
  assert.equal(m.outlines.before.length, r.units.air.length + r.units.army.length + r.reqLand.length + r.reqSea.length + res.parks.length);
  assert.equal(m.outlines.after.length, r.units.air.length + r.reqLand.length + r.reqSea.length + res.parks.length);   // the stored army unit leaves the map
  const o = m.outlines.after.find((q) => q.w === 2 && q.h === 2);
  assert.deepEqual(Object.keys(o).sort(), ['cat', 'h', 'w', 'x', 'y']);
});
