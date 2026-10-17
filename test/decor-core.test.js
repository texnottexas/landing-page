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

// ---------------------------------------------------------------- Task 3: even merges
const copiesOf = (spec) => spec.flatMap(([level, where, n, ref]) => Array.from({ length: n || 1 }, (_, i) => ({ level, where, ref: ref ? ref + (n > 1 ? i : '') : null })));

test('makeCopies uses higher spares first', () => {
  assert.deepEqual(C.makeCopies({ 3: 1, 1: 9 }, 3, 2), { ok: true, use: { 3: 1, 1: 9 }, merges: { 1: 3, 2: 1 } });
});

test('makeCopies fails short', () => {
  assert.equal(C.makeCopies({ 1: 5 }, 3, 1).ok, false);
});

test('Bench evens out at Lv5 (Tex: 5 Lv4 beat 1 Lv5 + 2 Lv4)', () => {
  const copies = copiesOf([[5, 'base', 1, 'b1'], [5, 'base', 1, 'b2'], [4, 'base', 1, 'b3'], [4, 'showcase', 1, 's1'], [5, 'showcase', 1, 's2'],
    [1, 'bag', 128], [2, 'bag', 4], [3, 'bag', 1], [4, 'bag', 2]]);
  const r = C.evenFill(copies, 5, 15, Infinity);
  assert.deepEqual(r.targets.map((t) => t.level), [5, 5, 5, 5, 5]);
  assert.deepEqual(r.merges, { 1: 11, 2: 5, 3: 2, 4: 2 });
  assert.deepEqual(r.raised.map((x) => x.ref).sort(), ['b3', 's1']);
  assert.ok(r.raised.every((x) => x.fromLevel === 4 && x.toLevel === 5));
});

test('even beats tall: the copies spread over the cap within one level', () => {
  const r = C.evenFill(copiesOf([[1, 'bag', 81]]), 5, 15, Infinity);
  const lv = r.targets.map((t) => t.level);
  assert.equal(lv.length, 5);
  assert.ok(Math.max(...lv) - Math.min(...lv) <= 1, lv.join(','));
  assert.deepEqual(lv.slice().sort(), [3, 3, 3, 4, 4]);
});

test('a single-copy group in the upgrade list stops at the open level', () => {
  const r = C.evenFill(copiesOf([[3, 'showcase', 1, 's'], [1, 'bag', 60]]), 1, 15, 4);
  assert.deepEqual(r.targets.map((t) => t.level), [4]);
  assert.deepEqual(r.merges, { 1: 6, 2: 2, 3: 1 });
});

test('mergePlan on Rеx: gold never merges; Bench pulls its Lv4s and puts Lv5s back in the same spots', () => {
  const plan = C.mergePlan(REX, AIR);
  const groups = plan.map((p) => p.group);
  assert.ok(!groups.includes(4070) && !groups.includes(4040) && !groups.includes(4000) && !groups.includes(4030), 'no gold group');
  const bench = plan.find((p) => p.group === 4080);
  assert.ok(bench, 'Bench merges');
  assert.deepEqual(bench.merges.map((m) => REX.rows[m.id].level), [1, 2, 3, 4], 'ascending levels');
  bench.pulls.forEach((p) => assert.ok(p.where !== 'bag' && p.where !== 'setbag'));
  assert.equal(bench.putBacks.length, bench.pulls.length);
  bench.putBacks.forEach((b, i) => { assert.deepEqual(b.ref, bench.pulls[i].ref); assert.equal(REX.rows[b.id].level, 5); });
  plan.forEach((p) => p.merges.forEach((m) => assert.ok(m.num > 0 && REX.rows[m.id].group === p.group)));
});

// ---------------------------------------------------------------- Task 4: Advanced Upgrade steps
const upSnap = (state, extra) => snap(Object.assign({ rows: [[1, 10, 1, 1, [[930000, 200]]], [4, 10, 4, 1, [[930000, 800]]]],
  showcase: [{ labelId: 1, items: [{ uuid: 'w', id: 4, x: 0, y: 0 }] }], bag: [{ id: 1, n: 5 }],
  upgrades: [{ group: 10, state, buildId: 4, exp: 0, need: 54, perNumber: 1 }] }, extra || {}));

test('Advanced Upgrade follows the game\'s states', () => {
  assert.deepEqual(C.upgradeSteps(upSnap(2), {}), [{ kind: 'open', group: 10 }]);
  assert.deepEqual(C.upgradeSteps(upSnap(4), {}), [{ kind: 'feed', group: 10, num: 5 }]);
  assert.deepEqual(C.upgradeSteps(upSnap(6), {}), [{ kind: 'level', group: 10 }]);
  assert.deepEqual(C.upgradeSteps(upSnap(1), {}), []);
  assert.deepEqual(C.upgradeSteps(upSnap(3), {}), []);
});

test('Advanced Upgrade feeds only the Lv1 copies the merges don\'t use', () => {
  assert.deepEqual(C.upgradeSteps(upSnap(4), { 10: 3 }), [{ kind: 'feed', group: 10, num: 2 }]);
  assert.deepEqual(C.upgradeSteps(upSnap(4), { 10: 5 }), [], 'nothing spare: no step');
  const s = upSnap(4); s.upgrades[0].exp = 52;
  assert.deepEqual(C.upgradeSteps(s, {}), [{ kind: 'feed', group: 10, num: 2 }], 'never past the bar');
});

test('Advanced Upgrade splits only when the counted copy is not in the bag', () => {
  assert.deepEqual(C.upgradeSteps(upSnap(5), {}), [{ kind: 'split', group: 10 }], 'counted from the showcase');
  const s = upSnap(5, { showcase: [], bag: [{ id: 4, n: 1 }, { id: 1, n: 0 }], sets: [10] });
  assert.deepEqual(C.upgradeSteps(s, {}), [], 'counted from a completed set\'s bag copy');
});

test('Advanced Upgrade on Rеx after the live checks: Hardcore Shooter has nothing to feed; Weapon Box is not eligible', () => {
  const steps = C.upgradeSteps(REX, {});
  assert.equal(steps.filter((x) => x.group === 5494).length, 0);
  assert.equal(steps.filter((x) => x.group === 5355).length, 0);
  assert.equal(REX.upgrades.some((u) => u.group === 5355), false);
});

// ---------------------------------------------------------------- Task 5: collab box and pick-ups
test('collab on Rеx: Toothless and Light Fury are already in; a placed collab statue goes to its empty slot from the base', () => {
  const plan = C.collabPlan(REX);
  assert.equal(plan.filter((x) => x.slot === 79 || x.slot === 87).length, 0);
  const s = snap({ rows: [[53159, 5857, 1, 1, [[930000, 200]]]], placed: [{ uuid: 't', id: 53159, x: 5, y: 5 }], collab: [{ slot: 79, group: 5857, id: null }] });
  assert.deepEqual(C.collabPlan(s), [{ slot: 79, from: 'base', id: 53159, ref: 't' }]);
});

test('collab takes the best copy, the bag first at the same level', () => {
  const s = snap({ rows: [[1, 50, 1, 1, [[930000, 100]]], [2, 50, 2, 1, [[930000, 200]]]],
    placed: [{ uuid: 'p', id: 2, x: 0, y: 0 }], bag: [{ id: 2, n: 1 }], collab: [{ slot: 9, group: 50, id: 1 }] });
  assert.deepEqual(C.collabPlan(s), [{ slot: 9, from: 'bag', id: 2, ref: null }], 'a lower copy in the slot is replaced from the bag');
});

test('a mutually exclusive variant never goes to a collab slot', () => {
  const s = snap({ rows: [[57201, 5720, 2, 1, [[1001001, 500]], { me: [5557] }]], showcase: [{ labelId: 5, items: [{ uuid: 'sg', id: 57201, x: 0, y: 4 }] }],
    collab: [{ slot: 20, group: 5557, id: null }] });
  assert.deepEqual(C.collabPlan(s), []);
});

test('pick-ups on Rеx: the copies that don\'t count go to the bag; gold and no-stat decor stay', () => {
  const t = C.targets(REX, AIR);
  const ups = C.pickupPlan(REX, AIR, t).map((e) => e.where + ':' + REX.rows[e.id].name + ' L' + e.level);
  // equal levels: the showcase or collab copy stays and the base one comes up (it frees base space)
  ['base:Rocking Horse L3', 'base:Statue: 6th Angel L2', 'base:Worker Zombie L3', 'base:High-fat Cake L2', 'showcase:Flight Partners L1'].forEach((n) => assert.ok(ups.includes(n), n + ' in ' + ups.join(', ')));
  assert.ok(!ups.includes('showcase:Rocking Horse L3') && !ups.some((n) => n.startsWith('collab:')), 'the showcase and collab copies stay');
  ups.forEach((n) => assert.ok(!/Cedar|Lucky Fountain|Lantern/.test(n), n));
  C.pickupPlan(REX, AIR, t).forEach((e) => assert.ok(['base', 'showcase', 'collab'].includes(e.where)));
});

test('a plain-bag higher copy makes the placed lower one a pick-up', () => {
  const rows = [[40104, 4010, 5, 20, [[921002, 180]]], [40103, 4010, 4, 20, [[921002, 160]]], [40102, 4010, 3, 20, [[921002, 140]]]];
  const placed = Array.from({ length: 18 }, (_, i) => ({ uuid: 'g' + i, id: 40104, x: i, y: 0 })).concat([{ uuid: 'lo1', id: 40102, x: 0, y: 2 }, { uuid: 'lo2', id: 40102, x: 1, y: 2 }]);
  const s = snap({ rows, placed, bag: [{ id: 40103, n: 2 }] });
  const ups = C.pickupPlan(s, ALL, C.targets(s, ALL)).map((e) => e.ref).sort();
  assert.deepEqual(ups, ['lo1', 'lo2']);
});
