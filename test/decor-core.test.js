'use strict';
// Decor Optimizer rules (Tex 2026-10-17), on hand-built snapshots and the live Rеx fixture.
// Run: node --test test/decor-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../decor-core.js');
const REX = require('./fixtures/decor-rex.json');

const ALL = { army: true, navy: true, air: true };
const AIR = { army: false, navy: false, air: true };
const clone = (o) => JSON.parse(JSON.stringify(o));
const idOf = (snap, group, level) => Number(snap.levels[group][level]);

// A minimal snapshot: rows [id, group, level, cap, buffs, {w,h,pt,type,me}], plus sources.
function snap(o) {
  const s = { grid: { w: 10, h: 10, cells: [] }, placed: [], buildings: [], bag: [], showcase: [], collab: [], sets: [], upgrades: [], openLevel: 4,
    rows: {}, levels: {}, stats: {
      930000: { unit: 0, battle: 1, vt: 10000, name: 'All Units HP' },
      930101: { unit: 1, battle: 1, vt: 10000, name: 'Army ATK' },
      960012: { unit: 0, battle: 1, vt: 1, name: 'March Size' },
      920900: { unit: 0, battle: 0, vt: 10000, name: 'Gold Production Increase' },
      921002: { unit: 0, battle: 0, vt: 10000, name: 'Repair speed' }
    } };
  (o.rows || []).forEach(([id, group, level, cap, buffs, x]) => {
    x = x || {};
    s.rows[id] = { group, level, maxLevel: 15, type: x.type || 4, w: x.w || 1, h: x.h || 1, pt: x.pt == null ? 1 : x.pt, cap, me: x.me || [], buffs, name: x.name || 'G' + group, mp: x.type === 5 ? 5 : 4 };
    (s.levels[group] = s.levels[group] || {})[level] = id;
  });
  ['placed', 'bag', 'showcase', 'collab', 'sets', 'upgrades', 'buildings'].forEach((k) => { if (o[k]) s[k] = o[k]; });
  return s;
}

test('gold stats are unwanted', () => {
  const lucky = idOf(REX, 4070, 1);
  const i = C.copyInfo(REX, lucky, ALL);
  assert.equal(i.wanted, false); assert.equal(i.tier, 3);
  assert.deepEqual(C.GOLD, [920900, 921001, 970009]);
});

test('March Size is tier 0 and weighs 30 a point', () => {
  const s = snap({ rows: [[1, 10, 1, 1, [[960012, 2]]]] });
  const i = C.copyInfo(s, 1, ALL);
  assert.equal(i.tier, 0); assert.equal(i.points, 60); assert.equal(i.cells, 1);
});

test('a unit switched off makes a unit-only decor unwanted', () => {
  const s = snap({ rows: [[1, 10, 1, 1, [[930101, 300]]]] });
  assert.equal(C.copyInfo(s, 1, { army: false, navy: true, air: true }).wanted, false);
  const on = C.copyInfo(s, 1, ALL);
  assert.equal(on.wanted, true); assert.equal(on.tier, 1);
});

test('repair speed alone is tier 2 (Green Apple Tree ranks last, Tex)', () => {
  const tree = idOf(REX, 4010, 1);
  const i = C.copyInfo(REX, tree, ALL);
  assert.equal(i.wanted, true); assert.equal(i.tier, 2);
});

test('no stats means unwanted', () => {
  const cedar = idOf(REX, 4020, 1);
  assert.equal(C.copyInfo(REX, cedar, ALL).wanted, false);
});

test('points use the armory weights, and the copied weights match the armory', () => {
  const s = snap({ rows: [[1, 10, 1, 1, [[930000, 200]]]] });
  assert.ok(Math.abs(C.copyInfo(s, 1, ALL).points - 2.1) < 1e-9);
  const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tw-game-data.js'), 'utf8');
  const block = src.slice(src.indexOf('var BO_STAT_WEIGHTS'), src.indexOf('};', src.indexOf('var BO_STAT_WEIGHTS')));
  ['atk', 'hp', 'dmgInc', 'dmgDec', 'def', 'march'].forEach((k) => {
    const m = block.match(new RegExp('\\b' + k + ':\\s*([\\d.]+)'));
    assert.ok(m, k + ' in the armory weights');
    assert.equal(C.WEIGHTS[k], Number(m[1]), k);
  });
  const core = fs.readFileSync(path.join(__dirname, '..', 'pages', 'armory-core.js'), 'utf8');
  const a = core.indexOf('var DECOR_CLASS = {'), b = core.indexOf('};', a);
  const armory = Function('return ' + core.slice(a + 'var DECOR_CLASS = '.length, b + 1))();
  assert.deepEqual(C.CLASS, armory, 'the stat classes are the armory\'s');
});

test('counted on Rеx follows the game: the 3 wasted copies, and no group over its cap', () => {
  const r = C.counted(REX);
  const names = r.waste.filter((w) => w.where !== 'setbag').map((w) => w.where + ':' + REX.rows[w.id].name + ' L' + w.level).sort();
  assert.ok(names.includes('showcase:Rocking Horse L3'), names.join(', '));
  assert.ok(names.includes('collab:Statue: 6th Angel L2'), names.join(', '));
  assert.ok(names.includes('collab:Worker Zombie L3'), names.join(', '));
  Object.keys(r.byGroup).forEach((g) => {
    const n = r.byGroup[g].reduce((s, e) => s + e.n, 0);
    const cap = REX.rows[REX.levels[g][Object.keys(REX.levels[g])[0]]].cap;
    assert.ok(n <= cap, 'group ' + g + ' counts ' + n + ' over cap ' + cap);
  });
});

test('ME: a plain-bag variant never wins (Review Focus 5)', () => {
  const s = snap({ rows: [[1, 10, 2, 1, [[930000, 200]], { me: [11] }], [2, 11, 5, 1, [[930000, 900]], { me: [10] }]],
    placed: [{ uuid: 'a', id: 1, x: 0, y: 0 }], bag: [{ id: 2, n: 1 }] });
  const r = C.counted(s);
  assert.equal(r.byGroup[10].length, 1); assert.equal(r.byGroup[10][0].level, 2);
  assert.equal(r.byGroup[11], undefined);
  assert.equal(r.buffs[930000], 200);
});

test('ME: the higher counted variant wins and the lower one counts nothing', () => {
  const s = snap({ rows: [[1, 10, 2, 1, [[930000, 200]], { me: [11] }], [2, 11, 5, 1, [[930000, 900]], { me: [10] }]],
    placed: [{ uuid: 'a', id: 1, x: 0, y: 0 }, { uuid: 'b', id: 2, x: 2, y: 0 }] });
  const r = C.counted(s);
  assert.equal(r.byGroup[10], undefined);
  assert.equal(r.byGroup[11][0].level, 5);
  assert.ok(r.waste.some((w) => w.ref === 'a'));
});

test('a completed set counts its bag copies', () => {
  const s = snap({ rows: [[1, 10, 1, 5, [[930000, 100]]]], bag: [{ id: 1, n: 3 }], sets: [10] });
  const r = C.counted(s);
  assert.equal(r.byGroup[10][0].where, 'setbag'); assert.equal(r.byGroup[10][0].n, 3);
  assert.equal(r.buffs[930000], 300);
});
