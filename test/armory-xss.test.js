'use strict';
// Stored-XSS guard for the Armory v2 view-model. Everything the page renders as HTML comes out of ArmoryVM.buildViewModel, and
// its inputs (worker supplements, report JSON) are attacker-controlled: the worker only validates the first few entries and
// scrubs "<script" and "javascript:". This test replaces EVERY leaf of a realistic input (heroes, equips, stats, chips,
// decorations, beasts, roster, inventory) with an <img onerror> payload, one leaf at a time, builds the model and asserts that
// the only strings that can carry markup are the ones the page escapes: the player's own name. Every other value must have been
// coerced to a number or replaced by a table value. The rendering side (every sink escapes or coerces) is covered by the browser
// test docs/armory-review-2026-10/harness/xss-v2.js.
// Run: node --test test/armory-xss.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../pages/armory-vm.js');
const Core = require('../pages/armory-core.js');
const G = require('../pages/tw-game-data.js');
const P = require('./helpers/armory-page.js');

const PAY = '<img src=x onerror=window.__xss=1>';
const LOOK = P.data('decor-lookups.json');
const STATICS = { runeTypes: P.data('rune-types.json'), decorLevels: P.data('decoration-levels.json'), decorIndex: P.data('decoration-index.json'), decorLookups: LOOK, itemTable: P.data('item-table.json') };
const ESCAPED = /^vm\.header\.(name|title)$/; // the player name: the page escapes it everywhere (esc / nm / textContent)

function world() {
  const fx = P.fixture('gear-heroes.json').heroes.slice(0, 3);
  const beasts = P.fixture('beasts.json');
  const groups = Object.keys(LOOK.DECOR_GROUP_BASE).slice(0, 6).map((g) => LOOK.DECOR_GROUP_BASE[g]);
  return {
    merged: {
      heroes: fx.map((h) => ({ id: h.id, heroEquips: h.heroEquips, level: 100, star: 5, awakenLevel: 1 })),
      decorations: { ids: groups, suit: [] }, enigmas: beasts.enigmas,
      mechas: [{ mechaId: 1006, chips: [{ chipId: 9404, level: 6 }, { chipId: 8501, level: 25 }] }]
    },
    supp: {
      heroes: { list: fx.map((h, i) => ({ id: h.id, lv: 100, star: 5, pw: 12345 + i, t: 1 })) },
      inv: { tabs: { item: [{ id: Number(Object.keys(STATICS.itemTable)[0]), a: 5 }], decor: [{ id: groups[0], a: 2 }] } },
      enigma: { beasts: [{ id: 1 }, { id: 2 }] },
      gear: { meta: { ts: '2026-10-01T00:00:00Z' }, goldGear: [{ heroId: 0, buffs: [{ type: 'rune', name: 'Impact', star: 0 }] }, { heroId: 0, buffs: [{ type: 'rune', name: 'Searing', star: 2 }] }] },
      runepool: { meta: { ts: '2026-10-08T00:00:00Z' }, source: 'manual', pool: { Impact: { 0: 4, 1: 2, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 }, Wildfire: { 0: 1, 1: 0, 2: 0, 3: 3, 4: 0, 5: 0, 6: 0 } } }
    }
  };
}
function build(w) {
  const core = Core.create(); core.setDecorLookups(LOOK);
  const names = {}; P.fixture('gear-heroes.json').heroes.forEach((h) => { names[h.id] = h.name; });
  core.setHeroCache(names, null);
  G.setSuppDecode(P.fixture('beasts.json').suppDecode);
  core.setPlatforms(P.data('enigma-platforms.json'));
  return VM.buildViewModel(w.merged, { reportsTs: 1e12, dataTs: 1e12, kinds: [] }, { core, statics: STATICS, supp: w.supp, privacy: {}, player: { name: 'Tester', siteKey: 'a'.repeat(16) }, reports: [], reportMechaIds: [1006], now: 1.1e12 });
}
function leaves(o, path, out) {
  if (Array.isArray(o)) o.forEach((v, i) => leaves(v, path.concat(i), out));
  else if (o && typeof o === 'object') Object.keys(o).forEach((k) => leaves(o[k], path.concat(k), out));
  else out.push(path);
  return out;
}
function setAt(o, path, v) { let t = o; for (let i = 0; i < path.length - 1; i++) t = t[path[i]]; t[path[path.length - 1]] = v; }
function dirty(vm) {
  const bad = [];
  (function walk(o, p) {
    if (typeof o === 'string') { if (/[<>"]/.test(o) && !ESCAPED.test(p)) bad.push(p); }
    else if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], p + '.' + (Array.isArray(o) ? '[]' : k)));
  })(vm, 'vm');
  return bad;
}

test('the unmodified world builds and carries no markup characters', () => {
  assert.deepEqual(dirty(build(world())), []);
});

test('a payload in any single leaf of the report or the supplements never reaches the model as a string', () => {
  const base = world(), paths = [];
  leaves(base.merged, ['merged'], paths); leaves(base.supp, ['supp'], paths);
  assert.ok(paths.length > 300, 'enough leaves to matter: ' + paths.length);
  const leaks = {}; let threw = 0;
  for (const path of paths) {
    const w = JSON.parse(JSON.stringify(base));
    setAt(w, path, PAY);
    let vm; try { vm = build(w); } catch (e) { threw++; continue; } // an error state is safe: the page catches it
    dirty(vm).forEach((p) => { (leaks[p] = leaks[p] || []).push(path.join('.')); });
  }
  assert.deepEqual(leaks, {}, 'model strings that carried a payload: ' + JSON.stringify(leaks).slice(0, 600));
  assert.ok(threw < paths.length * 0.2, 'most payloads are handled, not thrown (' + threw + ' threw)');
});

test('every payload in a NUMBER position becomes a finite number or is dropped', () => {
  const w = world();
  w.merged.heroes[0].id = PAY; w.merged.heroes[1].level = PAY; w.merged.heroes[1].star = PAY;
  w.merged.heroes[2].heroEquips[0]._slot = PAY; w.merged.heroes[2].heroEquips[1].level = PAY; w.merged.heroes[2].heroEquips[1].quality = PAY;
  w.merged.mechas[0].mechaId = PAY; w.merged.mechas[0].chips[0].level = PAY;
  w.supp.heroes.list[0].pw = PAY; w.supp.heroes.list[1].lv = PAY;
  const vm = build(w);
  assert.deepEqual(dirty(vm), []);
  vm.heroes.list.forEach((h) => { assert.ok(Number.isFinite(h.id)); assert.ok(Number.isFinite(h.lv) && Number.isFinite(h.star)); h.pieces.forEach((p) => { assert.ok(p.slot >= 1 && p.slot <= 6 && Number.isInteger(p.slot)); }); });
  assert.ok(vm.ht.chips.every((c) => Number.isFinite(c.mecha) && Number.isFinite(c.lv)));
});

test('the Advice pool (vm.runes.pool): a stored pool with a payload in any value, count or name is coerced or kept only as a key', () => {
  const w = world();
  assert.deepEqual(dirty(build(w)), [], 'the unmodified pool carries no markup');
  const pv = build(w).runes.pool; assert.equal(pv.source, 'stored'); assert.equal(pv.storedSource, 'manual');
  const leakPaths = {};
  const rp = w.supp.runepool, paths = leaves(rp, ['runepool'], []);
  for (const path of paths) {
    const x = JSON.parse(JSON.stringify(w)); setAt(x, ['supp'].concat(path), PAY);
    const vm = build(x);
    dirty(vm).forEach((p) => { (leakPaths[p] = leakPaths[p] || []).push(path.join('.')); });
    const pool = vm.runes.pool;
    ['bag', 'unequipped'].forEach((k) => Object.keys(pool[k]).forEach((n) => assert.ok(Number.isFinite(pool[k][n]), k + ' count is a number')));
    Object.keys(pool.upgraded).forEach((n) => Object.keys(pool.upgraded[n]).forEach((s) => assert.ok(Number.isFinite(pool.upgraded[n][s]))));
  }
  assert.deepEqual(leakPaths, {});
  const hostile = JSON.parse(JSON.stringify(w)); hostile.supp.runepool.pool[PAY] = { 0: PAY, 1: PAY };
  const vm = build(hostile);
  assert.deepEqual(dirty(vm), [], 'a payload rune NAME is only a key; the page escapes names (xss-v2 checks the render)');
  assert.equal(vm.runes.runeBag[PAY], undefined, 'a payload count is dropped');
});
