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

// ---------------------------------------------------------------- Task 6: homes, far corners, ranking
// grid cells [x, y, zone, ground, free, occ, floor]
const cellsOf = (list, zone, ground, occ) => list.map(([x, y]) => [x, y, zone, ground, 1, occ ? 1 : 0, 0]);
const rect = (labelId, items) => ({ labelId, items });

test('footprint is diagonal, as the game\'s getMapPosList', () => {
  assert.deepEqual(C.footprint(10, 20, 2, 2), [[10, 20], [11, 21], [9, 21], [10, 22]]);
});

test('packShowcase fills in the game\'s order (x, then y) and never overlaps (Review Focus 4)', () => {
  const s = snap({ rows: [[1, 10, 1, 1, [[960012, 2]]], [2, 11, 1, 1, [[930000, 200]]]] });
  s.rows[1].w = 4; s.rows[1].h = 4;
  s.showcase = [rect(1, [{ uuid: 'a', id: 1, x: 0, y: 0 }]), rect(12, []), rect(13, [])];
  let free = C.showcaseFree(s);
  assert.deepEqual(C.packShowcase(free, 1, 1), { labelId: 1, x: 0, y: 4 });
  s.showcase[0].items = Array.from({ length: 25 }, (_, i) => ({ uuid: 'f' + i, id: 2, x: Math.floor(i / 5), y: i % 5 }));
  free = C.showcaseFree(s);
  assert.deepEqual(C.packShowcase(free, 4, 4), { labelId: 12, x: 0, y: 0 });
  s.showcase = [rect(1, [{ uuid: 'c', id: 2, x: 2, y: 2 }]), rect(2, [{ uuid: 'd', id: 2, x: 1, y: 1 }, { uuid: 'e', id: 2, x: 3, y: 3 }])];
  free = C.showcaseFree(s);
  assert.equal(C.packShowcase(free, 4, 4), null);
});

test('far corners on Rеx are at the bottom of the map', () => {
  const sea = C.seaCells(REX);
  assert.ok(sea[0][1] >= 95 && sea[0][2] > 35, JSON.stringify(sea[0]));
  for (let i = 1; i < sea.length; i++) assert.ok(sea[i - 1][2] >= sea[i][2]);
});

test('the land ranking: March Size first, other stats next, Green Apple Trees last; a lower piece may use space a bigger one could not', () => {
  const rows = [[1, 10, 1, 1, [[960012, 2]]], [2, 11, 1, 1, [[930000, 200]]], [3, 12, 1, 1, [[921002, 100]]]];
  const s = snap({ rows, bag: [{ id: 3, n: 1 }, { id: 2, n: 1 }, { id: 1, n: 1 }] });
  s.grid.cells = cellsOf([[2, 2], [6, 6]], 1, 1);
  const p = C.placePlan(s, ALL, C.finalTargets(s, ALL));
  assert.deepEqual(p.place.map((x) => x.id).sort(), [1, 2]);
  assert.deepEqual(p.left, [{ id: 3, why: 'no room' }]);
  const rows2 = [[1, 10, 1, 1, [[960012, 2]]], [4, 13, 1, 1, [[930100, 600]], { w: 2, h: 2 }], [3, 12, 1, 1, [[921002, 100]]]];
  const s2 = snap({ rows: rows2, bag: [{ id: 1, n: 1 }, { id: 4, n: 1 }, { id: 3, n: 1 }] });
  s2.grid.cells = cellsOf(C.footprint(4, 4, 2, 2), 1, 1);
  const p2 = C.placePlan(s2, ALL, C.finalTargets(s2, ALL));
  assert.deepEqual(p2.place.map((x) => x.id).sort(), [1, 3], 'the 2x2 no longer fits once March Size took a cell');
  assert.deepEqual(p2.left, [{ id: 4, why: 'no room' }]);
});

test('placements on Rеx never put decor in the troop area or the Enigma zone', () => {
  const p = C.placePlan(REX, AIR, C.finalTargets(REX, AIR));
  const zone = {}; REX.grid.cells.forEach((c) => { zone[c[0] * 1000 + c[1]] = c[2]; });
  p.place.forEach((x) => {
    if (x.to.labelId) return;
    const r = REX.rows[x.id];
    C.footprint(x.to.x, x.to.y, r.w, r.h).forEach(([cx, cy]) => {
      if (r.type === 5) assert.ok(zone[cx * 1000 + cy] === 0 || zone[cx * 1000 + cy] === 1);
      else assert.equal(zone[cx * 1000 + cy], 1, r.name + ' at ' + cx + ',' + cy);
    });
  });
  assert.ok(p.left.some((l) => l.why === 'off'), 'Army and Navy decor left in the bag');
  assert.ok(p.left.some((l) => l.why === 'gold'), 'gold decor left in the bag');
});

test('eviction only upward: a placed gold piece gives way to a wanted one, never a wanted one to its equal', () => {
  const rows = [[40700, 4070, 3, 5, [[920900, 140]], { w: 2, h: 2 }], [7, 20, 1, 1, [[930000, 300]], { w: 2, h: 2 }], [8, 21, 1, 1, [[930000, 200]], { w: 2, h: 2 }]];
  const fp = C.footprint(4, 4, 2, 2);
  const s = snap({ rows, placed: [{ uuid: 'lf', id: 40700, x: 4, y: 4 }], bag: [{ id: 7, n: 1 }] });
  s.grid.cells = cellsOf(fp, 1, 1, true);
  const p = C.placePlan(s, ALL, C.finalTargets(s, ALL));
  assert.deepEqual(p.evict.map((e) => e.ref), ['lf']);
  assert.deepEqual(p.place, [{ id: 7, to: { x: 4, y: 4 } }]);
  const s2 = snap({ rows, placed: [{ uuid: 'hp', id: 8, x: 4, y: 4 }], bag: [{ id: 7, n: 1 }] });
  s2.grid.cells = cellsOf(fp, 1, 1, true);
  const p2 = C.placePlan(s2, ALL, C.finalTargets(s2, ALL));
  assert.deepEqual(p2.evict, []);
  assert.deepEqual(p2.left, [{ id: 7, why: 'no room' }]);
});

test('tidy on Rеx: the two pieces already at the bottom stay; the sea decor in the troop area\'s water moves to the far south water', () => {
  const t = C.tidyPlan(REX);
  const byId = {}; REX.placed.forEach((p) => { byId[p.uuid] = p; });
  const at = (x, y) => REX.placed.find((p) => p.x === x && p.y === y);
  assert.ok(!t.some((m) => m.uuid === at(53, 97).uuid), 'Rematch stays');
  assert.ok(!t.some((m) => m.uuid === at(55, 99).uuid), 'Blazing Feather stays');
  const zone = {}; REX.grid.cells.forEach((c) => { zone[c[0] * 1000 + c[1]] = c[2]; });
  const sea0 = REX.placed.filter((p) => REX.rows[p.id].type === 4 && REX.rows[p.id].pt === 0 && zone[p.x * 1000 + p.y] === 0);
  assert.equal(sea0.length, 3);
  sea0.forEach((p) => {
    const m = t.find((x) => x.uuid === p.uuid);
    assert.ok(m, REX.rows[p.id].name + ' moves');
    assert.equal(zone[m.to[0] * 1000 + m.to[1]], 1);
  });
});

// ---------------------------------------------------------------- Task 7: the whole plan and the preview
const KINDS = ['collabIn', 'toBag', 'merge', 'putBack', 'open', 'feed', 'split', 'level', 'showcaseIn', 'place', 'move'];

test('plan on Rеx is complete and safe', () => {
  const p = C.plan(REX, AIR);
  assert.deepEqual(Object.keys(p.phases), C.phaseOrder);
  assert.deepEqual(C.phaseOrder, ['collab', 'pickup', 'merge', 'upgrade', 'place', 'tidy']);
  const uuids = new Set(REX.placed.map((x) => x.uuid));
  const zone = {}; REX.grid.cells.forEach((c) => { zone[c[0] * 1000 + c[1]] = c[2]; });
  C.phaseOrder.forEach((ph) => p.phases[ph].forEach((a) => {
    assert.ok(KINDS.includes(a.kind), a.kind);
    if (a.kind === 'move') assert.ok(uuids.has(a.uuid), 'moves only placed decor');
    if (a.kind === 'toBag' && a.where === 'base') assert.ok(uuids.has(a.ref), 'picks up only placed decor');
    if (a.kind === 'merge') assert.ok(![4000, 4030, 4040, 4070].includes(REX.rows[a.id].group), 'no gold merges');
    if (a.kind === 'place' || a.kind === 'move') {
      const id = a.kind === 'place' ? a.id : REX.placed.find((x) => x.uuid === a.uuid).id, r = REX.rows[id];
      if (r.type === 4) C.footprint(a.x, a.y, r.w, r.h).forEach(([x, y]) => assert.equal(zone[x * 1000 + y], 1, r.name));
    }
  }));
  assert.ok(p.summary.counts.toBag >= 5 && p.summary.counts.merges > 0 && p.summary.counts.tidied > 0, JSON.stringify(p.summary.counts));
  assert.ok(p.summary.gains.length > 0);
});

test('nothing to do is empty', () => {
  const s = snap({ rows: [[1, 10, 2, 1, [[930000, 200]]]], placed: [{ uuid: 'a', id: 1, x: 2, y: 2 }] });
  s.grid.cells = [[2, 2, 1, 1, 1, 1, 0], [4, 4, 1, 1, 1, 0, 0]];
  const p = C.plan(s, ALL);
  C.phaseOrder.forEach((ph) => assert.deepEqual(p.phases[ph], [], ph));
  assert.deepEqual(p.summary.counts, { collab: 0, toBag: 0, evicted: 0, merges: 0, upgrades: 0, opens: 0, placed: 0, tidied: 0 });
  assert.deepEqual(p.summary.gains, []); assert.deepEqual(p.summary.losses, []);
});

test('gains are the counting difference', () => {
  const s = snap({ rows: [[1, 10, 2, 1, [[930000, 200]]]], bag: [{ id: 1, n: 1 }] });
  s.grid.cells = [[4, 4, 1, 1, 1, 0, 0]];
  const p = C.plan(s, ALL);
  assert.deepEqual(p.phases.place, [{ kind: 'place', id: 1, x: 4, y: 4 }]);
  assert.deepEqual(p.summary.gains.map((g) => ({ buffId: g.buffId, text: g.text })), [{ buffId: 930000, text: '+2.00%' }]);
  assert.equal(p.summary.gains[0].name, 'All Units HP');
});

test('the preview never mentions gold as a gain', () => {
  const p = C.plan(REX, ALL);
  p.summary.gains.forEach((g) => assert.ok(!C.GOLD.includes(g.buffId), g.name));
  assert.ok(p.summary.left.some((l) => l.why === 'gold'));
});

test('tidy never moves sea decor with no stats (Tex: only decor with stats matters)', () => {
  const s = snap({ rows: [[1, 10, 1, 1, []], [2, 11, 1, 1, [[930000, 100]]]], placed: [{ uuid: 'buoy', id: 1, x: 20, y: 4 }, { uuid: 'dock', id: 2, x: 22, y: 4 }] });
  s.rows[1].pt = 0; s.rows[2].pt = 0;
  s.grid.w = 30; s.grid.h = 30;
  s.grid.cells = [[20, 4, 0, 0, 1, 1, 0], [22, 4, 0, 0, 1, 1, 0], [20, 20, 1, 0, 1, 0, 0], [22, 24, 1, 0, 1, 0, 0]];
  const t = C.tidyPlan(s);
  assert.deepEqual(t.map((m) => m.uuid), ['dock']);
});

// ---------------------------------------------------------------- final review fixes
test('review C1: no split while the group\'s copy to place sits in the bag (a split could take it)', () => {
  const rows = [[1, 10, 1, 1, [[930000, 100]]], [4, 10, 4, 1, [[930000, 400]]], [5, 10, 5, 1, [[930000, 500]]]];
  const s = snap({ rows, placed: [{ uuid: 'p4', id: 4, x: 4, y: 4 }], bag: [{ id: 5, n: 1 }],
    upgrades: [{ group: 10, state: 5, buildId: 4, exp: 0, need: 54, perNumber: 1 }] });
  s.grid.cells = [[4, 4, 1, 1, 1, 1, 0], [6, 6, 1, 1, 1, 0, 0]];
  const p = C.plan(s, ALL);
  assert.deepEqual(p.phases.upgrade, [], 'no split');
  assert.deepEqual(p.phases.place.map((a) => a.id), [5], 'the Lv5 is placed');
  assert.deepEqual(C.upgradeSteps(s, {}, ALL), [], 'upgradeSteps alone: the plain-bag Lv5 is a target');
});

test('review I3: the preview counts room-making evictions on their own line and lists losses apart from gains', () => {
  const rows = [[40700, 4070, 3, 5, [[920900, 140]], { w: 2, h: 2 }], [7, 20, 1, 1, [[930000, 300]], { w: 2, h: 2 }], [8, 21, 1, 1, [[921002, 160]], { w: 2, h: 2 }]];
  const fp = C.footprint(4, 4, 2, 2);
  const s = snap({ rows, placed: [{ uuid: 'gat', id: 8, x: 4, y: 4 }], bag: [{ id: 7, n: 1 }] });
  s.grid.cells = fp.map(([x, y]) => [x, y, 1, 1, 1, 1, 0]);
  const p = C.plan(s, ALL);
  assert.equal(p.summary.counts.toBag, 0, 'nothing that "doesn\'t count"');
  assert.equal(p.summary.counts.evicted, 1, 'one moved out to make room');
  assert.deepEqual(p.summary.gains.map((g) => g.buffId), [930000]);
  assert.deepEqual(p.summary.losses.map((g) => g.buffId + ' ' + g.text), ['921002 -1.60%']);
});

test('review I4: a collab variant that would lose to its placed partner stays out of the collab box', () => {
  const rows = [[57201, 5720, 3, 1, [[1001001, 750]], { me: [5557] }], [55571, 5557, 1, 1, [[1001001, 250]], { me: [5720] }]];
  const s = snap({ rows, placed: [{ uuid: 'sg', id: 57201, x: 4, y: 4 }], bag: [{ id: 55571, n: 1 }], collab: [{ slot: 20, group: 5557, id: null }] });
  assert.deepEqual(C.collabPlan(s), []);
  const s2 = snap({ rows: [[57201, 5720, 1, 1, [[1001001, 250]], { me: [5557] }], [55571, 5557, 3, 1, [[1001001, 750]], { me: [5720] }]],
    placed: [{ uuid: 'sg', id: 57201, x: 4, y: 4 }], bag: [{ id: 55571, n: 1 }], collab: [{ slot: 20, group: 5557, id: null }] });
  assert.deepEqual(C.collabPlan(s2).map((c) => c.slot), [20], 'a higher collab variant still goes in');
});
