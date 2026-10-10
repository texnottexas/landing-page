'use strict';
// Parity: pages/armory-beasts-opt.js (the Beast Optimizer engine for Armory v2) against pages/armory-report.html.
// The eleven functions in the module's "verbatim" block are copies of the page's boOptimize and its data-prep helpers. This test
//  (1) requires each function's exact source text in the module file,
//  (2) runs the PAGE's functions (pulled by name, with the page's own boLoadOptimizerData fed the repo JSON) and the module's on the
//      same inputs and requires deep-equal outputs: the synthetic fixture, two seeded 60-80 beast rosters, edge cases (nothing deployed,
//      nothing on the bench, no platform data, a one-beast roster) under four playstyles,
//  (3) with REX_DIR=<dir holding enigma.json + bench.json supplements> repeats it on a real player's data (not in the repo; run by hand).
// Run: node --test test/armory-beasts-opt.parity.test.js
// ARMORY_FILE=<scratch copy of the page> proves it fails when the page changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./helpers/armory-page.js');
const { synth } = require('./helpers/beasts-synth.js');

const C = require('../pages/armory-core.js');
const Opt = require('../pages/armory-beasts-opt.js');
const G = require('../pages/tw-game-data.js');
const B = require('../pages/tw-game-data-base.js');
const OPT_FILE = fs.readFileSync(path.join(P.ROOT, 'pages/armory-beasts-opt.js'), 'utf8');

const VERBATIM = ['boBuildOwnedBeasts', 'boBuildCurrentPlan', 'boConditionIdForSlot', 'boConditionMatches', 'boBuildConditionMetMap', 'boComputeActiveConditions',
  'boBeastEligibleForSlot', 'boSlotDescriptor', 'boOptimize', 'boUpgradeThreshold', 'boBeastStatProfile'];
const FIX = { platforms: P.data('enigma-platforms.json'), enhance: P.data('enigma-platform-enhance.json'), conditions: P.data('enigma-field-conditions.json') };
const PAGE_JSON = { 'data/enigma-platforms.json': FIX.platforms, 'data/enigma-platform-enhance.json': FIX.enhance, 'data/enigma-field-conditions.json': FIX.conditions };
const coreFns = Object.keys(C).filter((k) => typeof C[k] === 'function' && !['setIdentity', 'setHeroCache', 'setDecorLookups', 'setPlatforms', 'setEnhance', 'setFieldConditions',
  'getFieldConditions', 'setSuppDecode', 'computeDecorRecs', 'nextMoves', 'moves', 'create'].includes(k));
const STATE = ['EB_PLATFORM_REQS', 'EB_HOLE_TO_ORDER', 'boEnhData', 'boFieldConditions', 'boPlatforms', 'boHoleIndex', 'BO_TG_DYNAMIC_OVERRIDES', 'BO_TG_HAS_GEAR_DATA',
  'HERO_CACHE', 'HERO_TYPE_CACHE'];
const NAMES = VERBATIM.concat(coreFns, STATE, Object.keys(G).filter((k) => k !== 'setSuppDecode'), Object.keys(B), ['ebLoadPlatformReqs', '_ebPlatformsPromise', 'boLoadOptimizerData', '_ar_synthEnigmasFromSupp']);

// one side each: the page's sandbox, and the module bound to a fresh core instance
async function pageSide(load, hints) {
  const ctx = P.loadPage(NAMES, { fetchJson: (p) => (PAGE_JSON[p] ? Promise.resolve(P.clone(PAGE_JSON[p])) : Promise.reject(new Error('no fixture ' + p))), ArmoryIdentity: { getSupplement: () => null } });
  if (hints) ctx.window._enigmaSuppDecode = P.clone(hints);
  if (load) { await ctx.ebLoadPlatformReqs(); await ctx.boLoadOptimizerData(); }
  return ctx;
}
function moduleSide(load, hints) {
  const core = C.create();
  if (load) { core.setPlatforms(P.clone(FIX.platforms)); core.setEnhance(P.clone(FIX.enhance)); core.setFieldConditions(P.clone(FIX.conditions)); }
  if (hints) core.setSuppDecode(P.clone(hints));
  return { core, opt: Opt.create(core) };
}
const PLAYSTYLES = [{ mode: 'mono', units: [1] }, { mode: 'dual', units: [1, 3], balance: 'primarySecondary', weights: [1, 0.5] }, { mode: 'dual', units: [2, 3] },
  { mode: 'triple', units: [1, 2, 3], weights: [1, 0.75, 0.25] }];

test('the eleven functions are in the module verbatim (exact source text from the page)', () => {
  for (const n of VERBATIM) {
    const src = P.fnSource(n);
    assert.ok(src && src.length > 80, n + ' is in the page');
    assert.ok(OPT_FILE.includes(src), n + ' is copied unchanged into pages/armory-beasts-opt.js');
  }
  // and the module copies nothing else from the page: every top-level `  function bo...` in the verbatim block is one of the eleven
  const block = OPT_FILE.slice(OPT_FILE.indexOf('/* ---- verbatim'), OPT_FILE.indexOf('/* ---- not from the page'));
  const found = (block.match(/^  function (\w+)\(/gm) || []).map((s) => s.replace(/^  function |\($/g, ''));
  assert.deepStrictEqual(found.sort(), VERBATIM.slice().sort());
});

function sameCalls(pg, m, bench, merged, label) {
  // helpers, step by step, then the whole plan
  const pageResolved = pg.ebResolveBeasts(merged.enigmas);
  const modResolved = m.core.ebResolveBeasts(merged.enigmas);
  assert.deepStrictEqual(P.j(modResolved), P.j(pageResolved), label + ': resolve');
  const owned = pg.boBuildOwnedBeasts(merged, bench, pageResolved);
  assert.deepStrictEqual(P.j(m.opt.boBuildOwnedBeasts(merged, bench, modResolved)), P.j(owned), label + ': owned');
  const plan = pg.boBuildCurrentPlan(pageResolved);
  assert.deepStrictEqual(P.j(m.opt.boBuildCurrentPlan(modResolved)), P.j(plan), label + ': plan');
  assert.deepStrictEqual(P.j(m.opt.boBuildConditionMetMap(plan, owned)), P.j(pg.boBuildConditionMetMap(plan, owned)), label + ': condition map');
  const active = pg.boComputeActiveConditions(plan, owned);
  assert.deepStrictEqual(P.j(m.opt.boComputeActiveConditions(plan, owned)), P.j(active), label + ': active conditions');
  for (const f of [0, 1, 2, 3, 4, 5, 6]) for (const o of [0, 1, 4, 9, 10]) {
    assert.equal(m.opt.boConditionIdForSlot(f, o), pg.boConditionIdForSlot(f, o));
    for (const lv of [0, 6]) for (const tg of [false, true]) assert.deepStrictEqual(P.j(m.opt.boSlotDescriptor(f, o, lv, tg)), P.j(pg.boSlotDescriptor(f, o, lv, tg)), label + ': slot descriptor ' + f + ':' + o);
  }
  return { owned, plan, active };
}

async function scenario(label, merged, bench, hints, load) {
  const pg = await pageSide(load, hints), m = moduleSide(load, hints);
  const { owned, plan, active } = sameCalls(pg, m, bench, merged, label);
  let recs = 0, chains = 0, thresholds = 0, broke = 0;
  const enhance = pg.boReadPlayerEnhance(merged, 'x');
  assert.deepStrictEqual(P.j(m.core.boReadPlayerEnhance(merged, 'x')), P.j(enhance));
  for (const ps of PLAYSTYLES) {
    const want = pg.boOptimize(owned, plan, active, ps, enhance, { 3: true, 10: true });
    const got = m.opt.boOptimize(P.clone(owned), plan, active, ps, enhance, { 3: true, 10: true });
    assert.deepStrictEqual(P.j(got), P.j(want), label + ': boOptimize ' + ps.mode);
    recs += want.recommendations.length;
    want.recommendations.forEach((r) => { if (r.chainSize > 1) chains++; if (r.threshold) thresholds++; if (r.brokeConditions.length) broke++; });
    // the same inputs the page's boRenderPlan would use, composed in the module's plan()
    const viaPlan = m.opt.plan(merged, bench, ps, 'x');
    const emptyPrefs = {};
    assert.deepStrictEqual(P.j(viaPlan.result), P.j(want), label + ': plan() result ' + ps.mode);
    for (const rec of want.recommendations.slice(0, 12)) {
      for (const at of ['current', 'maxOut']) {
        for (const who of [rec.from, rec.to]) {
          const slotArg = { fieldType: rec.slot.fieldType, order: rec.slot.order, enhanceRowId: null };
          assert.deepStrictEqual(P.j(m.opt.boBeastStatProfile(who, at, ps, slotArg)), P.j(pg.boBeastStatProfile(who, at, ps, slotArg)), label + ': stat profile');
          assert.deepStrictEqual(P.j(m.opt.boBeastStatProfile(who, at, ps)), P.j(pg.boBeastStatProfile(who, at, ps)));
        }
      }
      const desc = pg.boSlotDescriptor(rec.slot.fieldType, rec.slot.order, 0, false);
      if (rec.to) for (const target of [0, 50, 5000, 99999]) assert.deepStrictEqual(P.j(m.opt.boUpgradeThreshold(rec.to, target, desc, ps)), P.j(pg.boUpgradeThreshold(rec.to, target, desc, ps)), label + ': upgrade threshold');
    }
    void emptyPrefs;
  }
  // eligibility over every beast x every slot, strict and max-out
  for (const h of FIX.platforms.holes) {
    const d = pg.boSlotDescriptor(h.fieldType, h.order, 0, false);
    for (const b of owned.slice(0, 40)) for (const mo of [false, true]) assert.equal(m.opt.boBeastEligibleForSlot(b, d, { maxOut: mo }), pg.boBeastEligibleForSlot(b, d, { maxOut: mo }));
  }
  return { recs, chains, thresholds, broke, owned: owned.length };
}

test('fixture roster: every helper and the full optimizer agree with the page on 4 playstyles', async () => {
  const f = P.fixture('beasts.json');
  const merged = { enigmas: P.clone(f.enigmas) };
  const r = await scenario('fixture', merged, P.clone(f.bench), f.suppDecode, true);
  assert.ok(r.owned >= 9);
});

test('seeded rosters (70 and 80 beasts): same recommendations, chains, upgrade thresholds and broken conditions as the page', async () => {
  const tot = { recs: 0, chains: 0, thresholds: 0, broke: 0 };
  for (const [seed, n, o] of [[1, 70, {}], [7, 80, { empty: 5 }], [23, 60, { deploy: 12 }]]) {
    const s = synth(seed, n, o);
    const r = await scenario('seed' + seed, { enigmas: s.enigmas }, s.bench, s.suppDecode, true);
    for (const k of Object.keys(tot)) tot[k] += r[k];
  }
  assert.ok(tot.recs > 20, 'recommendations compared: ' + tot.recs);
  assert.ok(tot.chains > 0, 'multi-leg move chains compared: ' + tot.chains);
  assert.ok(tot.thresholds > 0, 'upgrade thresholds compared: ' + tot.thresholds);
});

test('edge cases: nothing deployed, an empty bench, one beast, no platform data, no enigma data', async () => {
  const s = synth(5, 50);
  await scenario('nothing deployed', { enigmas: { beastDatas: [], fields: synth(5, 50, { deploy: 0 }).enigmas.fields } }, s.bench, s.suppDecode, true);
  await scenario('empty bench', { enigmas: s.enigmas }, { beasts: [] }, s.suppDecode, true);
  await scenario('no bench supplement', { enigmas: s.enigmas }, null, s.suppDecode, true);
  const one = synth(9, 1, { deploy: 1 });
  await scenario('one beast', { enigmas: one.enigmas }, one.bench, one.suppDecode, true);
  await scenario('no platform data', { enigmas: s.enigmas }, s.bench, s.suppDecode, false);
  await scenario('no enigma data', { enigmas: null }, s.bench, null, true);
  await scenario('no merged enigmas', {}, null, null, true);
});

test('a same-type, same-rarity swap carries no threshold or broken-condition warning, and a worse-today better-at-max beast gets both a threshold and fodder counts', async () => {
  const s = synth(1, 70), pg = await pageSide(true, s.suppDecode), m = moduleSide(true, s.suppDecode);
  const merged = { enigmas: s.enigmas };
  const o = m.opt.plan(merged, s.bench, PLAYSTYLES[3], 'x'), w = pg.boOptimize(pg.boBuildOwnedBeasts(merged, s.bench, pg.ebResolveBeasts(merged.enigmas)),
    pg.boBuildCurrentPlan(pg.ebResolveBeasts(merged.enigmas)), pg.boComputeActiveConditions(pg.boBuildCurrentPlan(pg.ebResolveBeasts(merged.enigmas)), pg.boBuildOwnedBeasts(merged, s.bench, pg.ebResolveBeasts(merged.enigmas))), PLAYSTYLES[3], pg.boReadPlayerEnhance(merged, 'x'), pg.boReadTgRefinement(merged, 'x'));
  assert.deepStrictEqual(P.j(o.result), P.j(w));
  const withThr = o.result.recommendations.filter((r) => r.threshold);
  assert.ok(withThr.length > 0 && withThr.every((r) => typeof r.threshold.fodderNeeded === 'number' || r.threshold.starsFromCurrent === 0));
  const same = o.result.recommendations.filter((r) => r.from && r.to.type === r.from.type && r.to.q === r.from.q);
  assert.ok(same.every((r) => r.threshold === null && r.brokeConditions.length === 0), 'interchangeable swaps are silent');
});

test('per-player state: two optimizer instances on two cores never share platforms or field conditions', () => {
  const a = moduleSide(true), b = moduleSide(false);
  const s = synth(3, 60);
  const ra = a.opt.plan({ enigmas: s.enigmas }, s.bench, PLAYSTYLES[0], 'x');
  const rb = b.opt.plan({ enigmas: s.enigmas }, s.bench, PLAYSTYLES[0], 'x');
  assert.ok(ra.result.recommendations.length > 0, 'the loaded instance finds swaps');
  assert.equal(rb.result.recommendations.length, 0, 'the instance with no platform data finds none (and did not borrow A\'s)');
  assert.equal(Object.keys(globalThis).includes('_enigmaSuppDecode'), false);
});

// A real player's data (not in the repo): REX_DIR=<dir with enigma.json and bench.json supplement bodies>
test('REX_DIR: a real player\'s enigma + bench supplements agree with the page (skipped unless REX_DIR is set)', { skip: !process.env.REX_DIR }, async () => {
  const dir = process.env.REX_DIR, rd = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
  const supp = rd('enigma.json'), bench = rd('bench.json');
  const pg = await pageSide(true, null);
  const synthd = pg._ar_synthEnigmasFromSupp(supp);
  assert.ok(synthd && synthd.beastDatas.length > 100, 'enigma supplement synthesised: ' + (synthd && synthd.beastDatas.length));
  const hints = pg.window._enigmaSuppDecode;
  const merged = { enigmas: synthd };
  const m = moduleSide(true, hints);
  const { owned, plan, active } = sameCalls(pg, m, bench, merged, 'rex');
  let recs = 0;
  for (const ps of PLAYSTYLES) {
    const enhance = pg.boReadPlayerEnhance(merged, 'x');
    const want = pg.boOptimize(owned, plan, active, ps, enhance, {});
    assert.deepStrictEqual(P.j(m.opt.boOptimize(P.clone(owned), plan, active, ps, enhance, {})), P.j(want), 'rex boOptimize ' + ps.mode);
    recs += want.recommendations.length;
  }
  console.log('REX parity: ' + owned.length + ' beasts, ' + recs + ' recommendations over ' + PLAYSTYLES.length + ' playstyles, identical');
});

// Engine fix (both pages): the upgrade threshold scores the projected beast with the SAME slot condition map as the "today" score. Before, it scored
// it ungated, so a beast whose slot bonus is off could be told to reach a star/level it already had.
test('an upgrade threshold is never a requirement the beast already meets (the threshold uses the slot condition map)', async () => {
  let thresholds = 0, bad = [];
  for (const seed of [1, 5, 7, 11, 23, 42, 99, 123, 7777]) {
    const s = synth(seed, 70), pg = await pageSide(true, s.suppDecode), m = moduleSide(true, s.suppDecode);
    for (const ps of PLAYSTYLES) {
      const merged = { enigmas: s.enigmas };
      for (const r of m.opt.plan(merged, s.bench, ps, 'x').result.recommendations) {
        if (!r.threshold) continue;
        thresholds++;
        if (r.threshold.star <= (r.to.st || 0) && r.threshold.level <= (r.to.lv || 0)) bad.push(seed + ':' + r.to.id + ' needs ' + r.threshold.star + '/' + r.threshold.level + ' has ' + r.to.st + '/' + r.to.lv);
      }
      // and the page copy answers the same
      const owned = pg.boBuildOwnedBeasts(merged, s.bench, pg.ebResolveBeasts(merged.enigmas)), plan = pg.boBuildCurrentPlan(pg.ebResolveBeasts(merged.enigmas));
      const want = pg.boOptimize(owned, plan, pg.boComputeActiveConditions(plan, owned), ps, pg.boReadPlayerEnhance(merged, 'x'), pg.boReadTgRefinement(merged, 'x'));
      assert.deepStrictEqual(P.j(m.opt.plan(merged, s.bench, ps, 'x').result), P.j(want));
    }
  }
  assert.ok(thresholds > 20, 'thresholds checked: ' + thresholds);
  assert.deepStrictEqual(bad, []);
});
