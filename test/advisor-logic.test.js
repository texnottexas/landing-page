'use strict';
// Advisor correctness in pages/armory-report.html (LP-3 of the armory review, 2026-10-09). The advisor's pure
// functions are pulled out of the page by name (string/comment-aware brace matching) and run in a vm sandbox, so the
// page stays one self-contained file and these tests read the code that actually ships.
//   R1  the player-side "still valid" check ran against an empty pool (merged.inv/gear never exist)
//   R2  heroes synthesized from the supplements had raw gear pieces as heroEquips (buffs, not infos; pool order, not
//       slot order), which wiped real runes from the advisor and zeroed the gear score
//   R6  no re-validation after a reorder or removal
//   R7  Place did not require a gear piece at the destination
//   R9  "Recover all" queued runes the validator rejects (null star)
//   M1  the March Size checker skipped x[0], so a march-size card there was never counted
// Run: node --test test/advisor-logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
// ARMORY_FILE lets a run point at a scratch copy of the original page, to prove the tests fail before the fix.
const SRC = fs.readFileSync(process.env.ARMORY_FILE || path.join(ROOT, 'pages/armory-report.html'), 'utf8');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rune-types.json'), 'utf8'));

// Index of the `}` that closes the `{` at `open`, skipping strings, template literals and comments.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces at ' + open);
}
function fnSource(name) {
  const m = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) return null;
  const open = SRC.indexOf('{', SRC.indexOf(')', m.index));
  return SRC.slice(m.index, matchBrace(SRC, open) + 1);
}
function varSource(name) { // single-line `var NAME = ...;` (data tables)
  const m = new RegExp('^  var ' + name + '\\s*=.*;\\s*$', 'm').exec(SRC);
  return m ? m[0] : null;
}

// Builds a sandbox holding the named functions/vars (missing ones are simply absent, so a test that needs a function
// the original page lacks fails with a ReferenceError instead of the whole file failing to load).
function load(names, globals) {
  const ctx = vm.createContext(Object.assign({ console }, globals || {}));
  const parts = [];
  for (const n of names) {
    const s = fnSource(n) || varSource(n);
    if (s) parts.push(s);
  }
  vm.runInContext(parts.join('\n'), ctx);
  return ctx;
}

const RUNE_IDX = (() => {
  const ctx = load(['_ar_advisorRuneTypeIndex']);
  return ctx._ar_advisorRuneTypeIndex(CATALOG);
})();
const CORE = ['_ar_advisorMergeCost', '_ar_validateAdvisorStep', '_ar_applyAdvisorStep', '_ar_validateStepSequence',
  '_ar_isRecoverableRune', '_ar_extractRunePool', '_ar_planViewBase'];
const core = () => load(CORE);
const j = (o) => JSON.parse(JSON.stringify(o)); // vm objects have a foreign prototype; normalize for deepEqual

// ---- R1 --------------------------------------------------------------------------------------------------------
test('R1: the plan view derives its base pool from the inv + gear supplements, not from merged.inv/gear', () => {
  const c = core();
  const inv = { tabs: { item: [{ id: 7, a: 3 }] } };
  const lookups = { item: { 7: { t: 153, n: 'Heavy Blow Rune' } } };
  const base = c._ar_planViewBase(inv, null, lookups);
  assert.equal(base.known, true);
  assert.equal(base.pool['Heavy Blow'][0], 3);
  assert.equal(c._ar_planViewBase(null, null, lookups).known, false, 'no data at all must read as unknown, not as an empty pool');
});
test('R1: a plan that was valid when composed shows no stale steps against the real pool', () => {
  const c = core();
  const base = c._ar_planViewBase({ tabs: { item: [{ id: 7, a: 1 }, { id: 8, a: 3 }] } }, null,
    { item: { 7: { t: 153, n: 'Heavy Blow Rune' }, 8: { t: 153, n: 'Artillery Storm Rune' } } });
  const gear = { 101: { 1: { runeName: 'Artillery Storm', star: 0 }, 4: null } };
  const steps = [
    { type: 'place', dstHero: 101, dstSlot: 4, runeName: 'Heavy Blow' },
    { type: 'merge', dstHero: 101, dstSlot: 1, runeName: 'Artillery Storm', fromStar: 0, toStar: 2 }
  ];
  const v = j(c._ar_validateStepSequence(base.pool, gear, steps, CATALOG, RUNE_IDX));
  assert.deepEqual(v.map((x) => x.ok), [true, true], JSON.stringify(v));
});
test('R1: the step list no longer reads inv/gear from the merged object', () => {
  const src = fnSource('_ar_renderPlanStepList');
  assert.ok(src, '_ar_renderPlanStepList not found');
  assert.ok(!/merged\.inv|merged\.gear/.test(src));
});

// ---- R2 --------------------------------------------------------------------------------------------------------
const TA2 = 102030, AS3 = 102013; // Tactical Awareness s0 (sm 2), Artillery Storm s3 (sm 6)
const piece = (slot, buffs, extra) => Object.assign({ uid: 'u' + slot, slot, heroId: 101, quality: 5, equipId: 1000 + slot * 100 + 1, buffs }, extra);
const GEAR_SUPP = {
  // listed in pool order, not slot order (as the bookmarklet writes them), with a phantom unrelated hero piece
  goldGear: [
    piece(4, [{ type: 'rune', templateId: TA2 }, { type: 'stat', templateId: 1, rawValue: 540, rawEnhance: 0, enhanceShow: 1 }]),
    piece(2, [{ type: 'rune', templateId: AS3 }]),
    piece(3, [{ type: 'stat', templateId: 1, rawValue: 300, rawEnhance: 20, enhanceShow: 2 }]),
    piece(1, [], { heroId: 202 })
  ],
  equippedNonGold: [], presetOnly: []
};
const HEROES_SUPP = { list: [{ id: 101, lv: 100, st: 5, q: 5 }, { id: 202, lv: 90, st: 3, q: 4 }] };
const GEARNAMES = ['_ar_gearPieceToEquip', '_ar_synthHeroesFromSupp', '_ar_advisorBuildBaseGear', 'resolveRune', 'RUNE_MAP',
  'GEAR_TEMPLATE', 'heroGearScoreBreakdown', 'heroGearScore'];
const gearCtx = () => load(GEARNAMES, { ArmoryIdentity: { getSupplement: (k) => (k === 'gear' ? GEAR_SUPP : null) } });

test('R2: supplement-synthesized heroes keep their runes in the advisor base gear', () => {
  const c = gearCtx();
  const heroes = c._ar_synthHeroesFromSupp(HEROES_SUPP, GEAR_SUPP);
  const base = j(c._ar_advisorBuildBaseGear({ heroes }, 'sk'));
  assert.equal(base[101][2].runeName, 'Artillery Storm');
  assert.equal(base[101][2].star, 3);
  assert.equal(base[101][4].runeName, 'Tactical Awareness');
  assert.equal(base[101][4].star, 0);
  assert.ok(Object.prototype.hasOwnProperty.call(base[101], 3) && base[101][3] === null, 'a piece without a rune is an empty slot');
  assert.ok(!Object.prototype.hasOwnProperty.call(base[101], 1), 'no phantom slot 1: hero 101 owns no slot-1 piece');
});
test('R2: supplement-synthesized equips are infos-shaped, one per slot, in slot order', () => {
  const c = gearCtx();
  const h = c._ar_synthHeroesFromSupp(HEROES_SUPP, GEAR_SUPP).find((x) => x.id === 101);
  assert.deepEqual(j(h.heroEquips.map((e) => e._slot)), [2, 3, 4]);
  for (const e of h.heroEquips) assert.ok(Array.isArray(e.infos));
  assert.deepEqual(j(h.heroEquips[0].infos), [{ type: 2, templateId: AS3 }]);
});
test('R2: the gear score is non-zero for a bookmarklet-only hero', () => {
  const c = gearCtx();
  const h = c._ar_synthHeroesFromSupp(HEROES_SUPP, GEAR_SUPP).find((x) => x.id === 101);
  const bd = c.heroGearScoreBreakdown(h);
  assert.ok(bd.total > 0, 'total ' + bd.total);
  assert.ok(bd.runeTotal > 0 && bd.refineTotal > 0, JSON.stringify(j(bd)));
});

// ---- R6 --------------------------------------------------------------------------------------------------------
const POOL3 = { 'Artillery Storm': { 0: 3, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
const GEAR_AS0 = { 101: { 1: { runeName: 'Artillery Storm', star: 0 } } };
const MERGE02 = { type: 'merge', dstHero: 101, dstSlot: 1, runeName: 'Artillery Storm', fromStar: 0, toStar: 2 };
const RECOVER = { type: 'recycle', srcHero: 101, srcSlot: 1, srcRuneName: 'Artillery Storm' };
test('R6: the step sequence is validated step by step', () => {
  const c = core();
  const v = (steps) => j(c._ar_validateStepSequence(POOL3, GEAR_AS0, steps, CATALOG, RUNE_IDX));
  assert.deepEqual(v([MERGE02]).map((x) => x.ok), [true]);
  // recover then merge: the merge now has nothing to merge into
  const reordered = v([RECOVER, MERGE02]);
  assert.deepEqual(reordered.map((x) => x.ok), [true, false]);
  assert.ok(reordered[1].errors.some((e) => /no rune to merge/i.test(e)), reordered[1].errors.join('|'));
  // merge then recover: the rune is no longer 0 stars
  const other = v([MERGE02, RECOVER]);
  assert.deepEqual(other.map((x) => x.ok), [true, false]);
});
test('R6: a duplicate place that would drive the pool negative is flagged', () => {
  const c = core();
  const pool = { 'Heavy Blow': { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
  const gear = { 101: { 4: null }, 202: { 4: null } };
  const place = (h) => ({ type: 'place', dstHero: h, dstSlot: 4, runeName: 'Heavy Blow' });
  const v = j(c._ar_validateStepSequence(pool, gear, [place(101), place(202)], CATALOG, RUNE_IDX));
  assert.deepEqual(v.map((x) => x.ok), [true, false]);
});
test('R6: removing a step is just a shorter sequence and re-validates clean', () => {
  const c = core();
  const v = j(c._ar_validateStepSequence(POOL3, GEAR_AS0, [MERGE02], CATALOG, RUNE_IDX));
  assert.deepEqual(v.map((x) => x.ok), [true]);
});

// ---- R7 --------------------------------------------------------------------------------------------------------
test('R7: Place needs a gear piece at the destination', () => {
  const c = core();
  const pool = { 'Heavy Blow': { 0: 2, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
  const ctx = (gear) => ({ pool, gearByHero: gear, runeIdx: RUNE_IDX, catalog: CATALOG });
  const step = { type: 'place', dstHero: 303, dstSlot: 2, runeName: 'Heavy Blow' };
  assert.ok(j(c._ar_validateAdvisorStep(step, ctx({ 303: { 3: null } }))).some((e) => /no gear piece/i.test(e)), 'hero owns no slot-2 piece');
  assert.ok(j(c._ar_validateAdvisorStep(step, ctx({}))).some((e) => /no gear piece/i.test(e)), 'unknown hero');
  assert.deepEqual(j(c._ar_validateAdvisorStep(step, ctx({ 303: { 2: null } }))), [], 'an owned empty slot is fine');
});

// ---- R9 --------------------------------------------------------------------------------------------------------
test('R9: Recover all queues only what the validator accepts', () => {
  const c = core();
  const runes = [{ runeName: 'Artillery Storm', star: 0 }, { runeName: 'Artillery Storm', star: null },
    { runeName: 'Artillery Storm', star: undefined }, { runeName: 'Artillery Storm', star: 3 }, { runeName: '', star: 0 }, null];
  for (const r of runes) {
    const queued = c._ar_isRecoverableRune(r);
    const accepted = !!r && !!r.runeName && j(c._ar_validateAdvisorStep(
      { type: 'recycle', srcHero: 101, srcSlot: 1, srcRuneName: r.runeName },
      { pool: {}, gearByHero: { 101: { 1: r } }, runeIdx: RUNE_IDX, catalog: CATALOG })).length === 0;
    assert.equal(queued, accepted, JSON.stringify(r));
  }
});

// ---- M1 --------------------------------------------------------------------------------------------------------
test('M1: a march-size card in x[0] is counted', () => {
  const c = load(['MS_SKILL_ID', 'msResolveMarchSize', 'msEnumerateBenchSkills']);
  const hs = { list: [{ id: 5, p1: { b: [null], x: [{ id: 21116, lv: 4 }, { id: 20116, lv: 2 }, null, null] }, p2: null }] };
  const out = j(c.msEnumerateBenchSkills(hs));
  assert.deepEqual(out.map((o) => [o.slotKind, o.slotIdx, o.rarity, o.level]), [['x', 0, 'rare', 4], ['x', 1, 'normal', 2]]);
});
test('M1: the exclusive skill in x[0] is still not mistaken for march size', () => {
  const c = load(['MS_SKILL_ID', 'msResolveMarchSize', 'msEnumerateBenchSkills']);
  const hs = { list: [{ id: 5, p1: { b: [{ id: 21116, lv: 3 }], x: [{ id: 20760, lv: 5 }, null, null, null] } }] };
  assert.deepEqual(j(c.msEnumerateBenchSkills(hs)).map((o) => o.slotKind), ['b']);
});

// ---- stale-pool warning ----------------------------------------------------------------------------------------
test('stale-pool warning: a numeric import timestamp does not throw and shows the age', () => {
  const fakeEl = () => ({ style: {}, children: [], appendChild(c) { this.children.push(c); }, textContent: '' });
  const c = load(['_ar_relativeAge', '_ar_supplementTs', '_ar_stalePoolInfo', '_ar_buildStalePoolWarning'],
    { document: { createElement: fakeEl }, svgIcon: () => fakeEl() });
  const now = Date.now();
  const warn = c._ar_buildStalePoolWarning({ meta: { ts: now - 5 * 86400000 } }, { meta: { ts: now - 3600000 } }, null, false);
  assert.ok(warn, 'warning built');
  assert.match(warn.children[1].textContent, /imported 1h ago/);
});

// ---- applied plan step list ------------------------------------------------------------------------------------
// 32bbd14 declared a second `var accepted` (a number) inside _ar_renderPlanStepList; var hoisting made it overwrite the
// per-step array, so updateApplySummary threw `accepted.filter is not a function` on every applied plan.
test('plan step list: `accepted` is declared once, so an applied plan does not overwrite the per-step array', () => {
  const body = fnSource('_ar_renderPlanStepList');
  assert.equal((body.match(/\bvar accepted\b/g) || []).length, 1);
});
