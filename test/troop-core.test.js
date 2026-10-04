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
