'use strict';
// Parity: pages/armory-core.js against pages/armory-report.html (armory redesign, phase 1). Every function and state
// variable in section 1 of the module is a verbatim copy. This test pulls the same name out of the page and requires
// (1) the exact source text in the module file, and (2) identical outputs on synthetic fixtures
// (test/fixtures/armory-core/, no player data) for gear score + breakdown, rune pool, advisor validate / apply / merge
// cost, decor ranking, beast scoring, freshness and the march size calculation. The seams the page fills lazily
// (decor lookups, enigma platforms) are checked by running the PAGE's own loader and the module's setter on the same JSON.
// Run: node --test test/armory-core.parity.test.js
// ARMORY_FILE=<scratch copy of the page> proves it fails when the page changes (docs/armory-review-2026-10/v2-phase1.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./helpers/armory-page.js');

const C = require('../pages/armory-core.js');
const G = require('../pages/tw-game-data.js');
const B = require('../pages/tw-game-data-base.js');
const CORE_FILE = fs.readFileSync(path.join(P.ROOT, 'pages/armory-core.js'), 'utf8');

// Not in the page: seams + the new engine.
const GLUE = new Set(['setIdentity', 'setHeroCache', 'setDecorLookups', 'setPlatforms', 'setEnhance', 'setFieldConditions',
  'computeDecorRecs', 'nextMoves', 'moves']);
// State the page declares as `var NAME = ...;` and the copied functions read (declared verbatim in the module).
const STATE = ['DECOR_ID_TO_GROUP', 'DECOR_GROUP_BASE', 'DECOR_EXTRACTED_LVL', 'BUFF_NAMES_DECOR', 'MAX_LEVEL', 'LV_BY_ID',
  'DECOR_BASE_TO_GROUP', 'EB_PLATFORM_REQS', 'EB_HOLE_TO_ORDER', 'HERO_CACHE', 'HERO_TYPE_CACHE', 'boEnhData', 'boFieldConditions',
  'boPlatforms', 'boHoleIndex', 'BO_TG_DYNAMIC_OVERRIDES', 'BO_TG_HAS_GEAR_DATA'];
const fns = Object.keys(C).filter((k) => typeof C[k] === 'function' && !GLUE.has(k));

// ---- the page side: every function and table the core uses, loaded from the page's own text ----------------------------
const FIX = {
  levels: P.data('decoration-levels.json'), index: P.data('decoration-index.json'), mutexRaw: P.data('decoration-mutual-exclusive.json'),
  lookups: P.data('decor-lookups.json'), platforms: P.data('enigma-platforms.json'), enhance: P.data('enigma-platform-enhance.json'),
  conditions: P.data('enigma-field-conditions.json'), catalog: P.data('rune-types.json'),
};
const PAGE_JSON = {
  'data/decor-lookups.json': FIX.lookups, 'data/enigma-platforms.json': FIX.platforms,
  'data/enigma-platform-enhance.json': FIX.enhance, 'data/enigma-field-conditions.json': FIX.conditions,
  '../data/decoration-levels.json': FIX.levels, '../data/decoration-index.json': FIX.index, '../data/decoration-mutual-exclusive.json': FIX.mutexRaw,
};
const pageGlobals = {
  fetchJson: (p) => (PAGE_JSON[p] ? Promise.resolve(P.clone(PAGE_JSON[p])) : Promise.reject(new Error('no fixture for ' + p))),
  ArmoryIdentity: { getSupplement: () => null },
};
const names = fns.concat(STATE, Object.keys(G).filter((k) => k !== 'setSuppDecode'), Object.keys(B),
  ['DECOR_GROUPS', 'DECOR_ICON_FIX', 'DECOR_SUITS', 'DECOR_SUIT_GROUPS', 'DECOR_DATA', 'ME_CLUSTERS', 'ME_LOOKUP', 'PL', 'UT',
    '_ar_decorFetch', '_ar_decorEnsure', '_ar_decorPromise', '_ar_decorDone', 'ebLoadPlatformReqs', '_ebPlatformsPromise', 'boLoadOptimizerData',
    '_adv_computeRecommendations', '_adv_loadLevels', '_adv_loadIndex', '_adv_loadMutex', '_advisorLevelsCache', '_advisorIndexCache', '_advisorMutexCache']);
const ctx = P.loadPage(names, pageGlobals);

const same = (name, ...args) => {
  // inputs are shared, not cloned (the decor tables are 300 KB): none of these functions mutates its arguments; the one
  // that does (_ar_applyAdvisorStep) goes through sameMutating below. A mutation would show up as a mismatch.
  const a = ctx[name].apply(null, args);
  const b = C[name].apply(null, args);
  assert.deepStrictEqual(P.j(b), P.j(a), name + '(' + JSON.stringify(args).slice(0, 200) + ')');
  return b;
};
// For functions that mutate their first argument (applyAdvisorStep): compare the resulting state.
const sameMutating = (name, state, ...rest) => {
  const sa = P.clone(state), sb = P.clone(state);
  ctx[name].apply(null, [sa].concat(P.clone(rest)));
  C[name].apply(null, [sb].concat(P.clone(rest)));
  assert.deepStrictEqual(P.j(sb), P.j(sa), name + ' state after ' + JSON.stringify(rest[0]));
  return sb;
};

test('module exports what it claims (counts do not silently shrink)', () => {
  assert.ok(fns.length >= 60, 'functions: ' + fns.length);
  assert.equal(typeof C.nextMoves, 'function');
  assert.equal(C.nextMoves, C.moves.nextMoves);
});

test('armory-core.js: every function is a verbatim copy of the page (same source text)', () => {
  for (const n of fns) {
    const src = P.fnSource(n);
    assert.ok(src, n + ' is not in pages/armory-report.html any more');
    assert.ok(CORE_FILE.includes(src), n + ' differs from pages/armory-report.html (armory-core.js is no longer a verbatim copy)');
    assert.equal(C[n].toString(), src.trim(), n + ' exported function text');
  }
  for (const n of STATE) {
    const src = P.varSource(n);
    assert.ok(src, n + ' is not in pages/armory-report.html any more');
    assert.ok(CORE_FILE.includes(src), n + ' declaration differs from the page');
  }
});

test('the module reads the page tables it needs from tw-game-data.js (same values as the page declares)', () => {
  for (const n of ['GEAR_TEMPLATE', 'RUNE_MAP', 'EQUIP_BASE_BUFF', 'GEAR_SLOT_NAMES', 'ADVISOR_STAT_BUFFS', 'BO_STAT_WEIGHTS', 'MS_SKILL_ID', 'EB_FIELD_NAMES']) {
    assert.deepStrictEqual(P.j(G[n]), P.j(ctx[n]), n);
  }
  assert.ok(Object.keys(B).length > 5);
});

// ---- gear score, refinement, rune pool ---------------------------------------------------------------------------------
test('gear score + breakdown: identical on heroes with full, partial, empty and unresolvable gear', () => {
  const { heroes } = P.fixture('gear-heroes.json');
  let nonZero = 0;
  for (const h of heroes) {
    const total = same('heroGearScore', h);
    same('heroGearScoreBreakdown', h);
    if (total > 0) nonZero++;
  }
  assert.ok(nonZero >= 4, 'fixture exercises real scores: ' + nonZero);
});

test('gear score: hand-computed piece (400 refine + 600 rune per slot)', () => {
  // two 600-max rolls at 50% and 100% => mean 75% => 300 refine; a half-starred rune => 300 rune
  const t600 = Object.keys(G.GEAR_TEMPLATE).map(Number).find((k) => G.GEAR_TEMPLATE[k].m === 600);
  const half = Object.keys(G.RUNE_MAP).map(Number).find((k) => G.RUNE_MAP[k].sm === 2 && G.RUNE_MAP[k].s === 1);
  const hero = { heroEquips: [{ id: 1, infos: [{ type: 1, templateId: t600, buffValue: 300 }, { type: 1, templateId: t600, buffValue: 600 }, { type: 2, templateId: half }] }] };
  const out = C.heroGearScoreBreakdown(hero);
  assert.equal(out.refineTotal, 300);
  assert.equal(out.runeTotal, 300);
  assert.equal(out.total, 600);
  assert.equal(out.slots[0].avgRollPct, 75);
  assert.equal(C.heroGearScore(hero), 600);
  assert.equal(C.heroGearScore({}), 0);
});

test('rune pool derivation from inventory + gear supplements', () => {
  const f = P.fixture('runepool.json');
  const out = same('_ar_extractRunePool', f.inv, f.gear, f.lookups);
  assert.equal(out.pool.Impact[0], 4, 'bag Impact shards (hand check)');
  assert.equal(out.pool.Impact[1], 1, 'unequipped gold piece Impact s:1');
  assert.equal(out.bagCounts.Magnetize, 7);
  same('_ar_extractRunePool', null, null, null);
  same('_ar_extractRunePool', f.inv, null, {});
  same('_ar_extractRunePool', { tabs: {} }, f.gear, f.lookups);
  same('_ar_planViewBase', null, f.gear, f.lookups);
  same('_ar_planViewBase', f.inv, f.gear, f.lookups);
  same('_ar_planViewBase', f.inv, null, null);
});

// ---- advisor ---------------------------------------------------------------------------------------------------------
test('advisor: rune index + merge cost schedule (every rune, slot, from, to)', () => {
  const cat = FIX.catalog;
  const idxA = ctx._ar_advisorRuneTypeIndex(P.clone(cat)), idxB = C._ar_advisorRuneTypeIndex(P.clone(cat));
  assert.deepStrictEqual(P.j(idxB), P.j(idxA));
  same('_ar_advisorRuneTypeIndex', null);
  same('_ar_advisorRuneTypeIndex', {});
  let priced = 0;
  for (const r of cat.runes) for (let slot = 0; slot <= 7; slot++) for (let from = -1; from <= 7; from++) for (let to = 0; to <= 8; to++) {
    const a = ctx._ar_advisorMergeCost(cat, idxA, r.name, slot, from, to);
    const b = C._ar_advisorMergeCost(cat, idxB, r.name, slot, from, to);
    assert.deepStrictEqual(P.j(b), P.j(a), r.name + ' ' + slot + ' ' + from + '>' + to);
    if (b) priced++;
  }
  assert.ok(priced > 50);
  // hand check: Artillery Storm slot 1 has star_max 6, schedule 1,2,4,6,8,10; s2 -> s4 costs 4 + 6
  assert.deepStrictEqual(P.j(C._ar_advisorMergeCost(cat, idxB, 'Artillery Storm', 1, 2, 4)), { cost: 10, starMax: 6 });
  assert.equal(C._ar_advisorMergeCost(cat, idxB, 'Artillery Storm', 1, 4, 4), null);
  assert.equal(C._ar_advisorMergeCost(cat, idxB, 'Nonesuch', 1, 0, 1), null);
});

test('advisor: validate / apply / sequence / recompute agree on valid and invalid steps', () => {
  const f = P.fixture('advisor.json');
  const cat = FIX.catalog;
  const runeIdx = C._ar_advisorRuneTypeIndex(cat);
  const ctxA = { pool: f.pool, gearByHero: f.gearByHero, runeIdx, catalog: cat };
  let errorsSeen = 0, okSeen = 0;
  for (const step of f.steps.valid.concat(f.steps.invalid)) {
    const e = same('_ar_validateAdvisorStep', step, ctxA);
    if (e.length) errorsSeen++; else okSeen++;
    if (step && step.type) sameMutating('_ar_applyAdvisorStep', { pool: f.pool, gearByHero: f.gearByHero }, step, cat, runeIdx);
    same('_ar_advisorStepEnglish', step && step.type ? step : { type: 'place', runeName: 'Impact', dstHero: 1, dstSlot: 2 });
  }
  assert.ok(okSeen >= 4 && errorsSeen >= 20, 'valid ' + okSeen + ' / invalid ' + errorsSeen);
  // hand checks on the validator
  assert.deepStrictEqual(P.j(C._ar_validateAdvisorStep(f.steps.valid[0], ctxA)), []);
  assert.ok(C._ar_validateAdvisorStep({ type: 'place', runeName: 'Impact', dstHero: 101, dstSlot: 2 }, ctxA).length > 0, 'slot 2 already holds a rune');
  assert.deepStrictEqual(P.j(C._ar_validateAdvisorStep(null, ctxA)), ['Missing step type']);
  same('_ar_validateStepSequence', f.pool, f.gearByHero, f.steps.valid, cat, runeIdx);
  same('_ar_validateStepSequence', f.pool, f.gearByHero, f.steps.invalid.filter((s) => s && s.type), cat, runeIdx);
  same('_ar_validateStepSequence', null, null, null, cat, runeIdx);
  same('_ar_recomputeAdvisorState', f.pool, f.gearByHero, f.steps.valid, cat, runeIdx);
  same('_ar_recomputeAdvisorState', null, null, [], cat, runeIdx);
  for (const r of f.recoverable) same('_ar_isRecoverableRune', r);
  const seq = C._ar_validateStepSequence(f.pool, f.gearByHero, f.steps.valid, cat, runeIdx);
  assert.equal(seq.length, f.steps.valid.length);
  assert.ok(seq[0].ok && seq[1].ok, 'place and merge validate against the state the steps before them left');
});

test('advisor: base gear from battle-report equips + the gear supplement; hero names via the seam', () => {
  const s = P.fixture('gear-supp.json');
  const merged = { heroes: P.fixture('gear-heroes.json').heroes.concat([{ id: 101, heroEquips: [] }, null, {}]) };
  const identity = { getSupplement: (kind, sk) => (kind === 'gear' && sk === s.siteKey ? s.gearSupp : null) };
  ctx.ArmoryIdentity = identity;
  C.setIdentity(identity);
  const withSupp = same('_ar_advisorBuildBaseGear', merged, s.siteKey);
  assert.ok(Object.keys(withSupp).length >= 5);
  same('_ar_advisorBuildBaseGear', merged, null);
  same('_ar_advisorBuildBaseGear', null, s.siteKey);
  same('_ar_advisorBuildBaseGear', { heroes: [] }, 'ffffffffffffffff');
  // hero names: page reads HERO_CACHE; the module has setHeroCache
  assert.equal(C.heroName(101), 'Hero #101');
  ctx.HERO_CACHE = { 101: 'Alpha' };
  C.setHeroCache({ 101: 'Alpha' }, { 101: 'Army' });
  ctx.HERO_TYPE_CACHE = { 101: 'Army', 555: 'Navy' };
  C.setHeroCache({ 101: 'Alpha' }, { 101: 'Army', 555: 'Navy' });
  for (const id of [101, 555, 0, undefined]) { same('heroName', id); same('heroBranch', id); same('heroBranch', id, 0); same('heroBranch', id, 2); }
  for (const id of Object.keys(G.HERO_TYPE_MAP).slice(0, 20)) same('heroBranch', Number(id));
  for (const step of P.fixture('advisor.json').steps.valid) same('_ar_advisorStepEnglish', step);
  ctx.HERO_CACHE = null; ctx.HERO_TYPE_CACHE = null;
  C.setHeroCache(null, null);
});

// ---- decor ranking (D1-D3 behaviour as it is in the page today) -------------------------------------------------------
test('decor: setDecorLookups matches the page loader (decorIdToGroup, decorLevel, placed level)', async () => {
  await ctx._ar_decorFetch();
  C.setDecorLookups(P.clone(FIX.lookups));
  const f = P.fixture('decor.json');
  const ids = Object.keys(FIX.lookups.DECOR_ID_TO_GROUP).map(Number).concat(f.probeIds);
  assert.ok(ids.length > 1000, 'ids compared: ' + ids.length);
  for (const id of ids) {
    const g = same('decorIdToGroup', id);
    same('decorLevel', id, g);
    same('decorLevel', id, 5503);
  }
  const groups = Object.keys(FIX.lookups.DECOR_GROUP_BASE);
  for (const g of groups.slice(0, 120)) same('_adv_getPlacedLevel', g, f.merged);
  same('_adv_getPlacedLevel', 'nope', f.merged);
  same('_adv_getPlacedLevel', groups[0], null);
  for (const g of groups.slice(0, 60)) for (const lv of [0, 1, 3]) {
    same('formatScaledDecorBuff', { v: 400, t: 10000 }, lv, g);
    same('formatScaledDecorBuff', { v: 3, t: 1 }, lv, g);
    same('scaledBuffVal', { v: 1000, t: 10000 }, lv, g);
  }
});

test('decor: shard maths, buff maps, next upgrade, recommendation, per-stat view, ranking', () => {
  const f = P.fixture('decor.json');
  same('_adv_invAmount', { amount: 3 }); same('_adv_invAmount', { a: 4 }); same('_adv_invAmount', null);
  same('_adv_invLevel', { level: 3 }); same('_adv_invLevel', { l: 4 }); same('_adv_invLevel', {});
  same('_adv_invGroup', { group: 5 }); same('_adv_invGroup', { g: 6 }); same('_adv_invGroup', null);
  same('_adv_calcAvailableShards', f.inventory); same('_adv_calcAvailableShards', null); same('_adv_calcAvailableShards', f.shardsOnly);
  assert.equal(C._adv_calcAvailableShards(f.inventory).universal, 683 + 30, '683 shards + 3 boxes x 10');
  for (const s of ['930100|200', '980204|200,930100|200 960012|3', '', null, 'x|y', '1|2|3']) same('_adv_parseBuffMap', s);
  const groups = Object.keys(FIX.levels).slice(0, 80);
  let upgrades = 0;
  for (const g of groups) {
    const entry = FIX.levels[g];
    for (let lv = 0; lv <= 4; lv++) {
      same('_adv_pieceShardValue', lv, entry);
      if (same('_adv_getNextUpgrade', g, lv, FIX.levels)) upgrades++;
    }
    same('_adv_calcGroupSpecificShards', g, f.inventory, FIX.levels);
    for (const lv of entry.levels.slice(0, 3)) same('_adv_levelBuffMap', lv);
  }
  assert.ok(upgrades > 100);
  same('_adv_pieceShardValue', 2, null);
  same('_adv_getNextUpgrade', 'missing', 1, FIX.levels);
  let recs = 0;
  for (const entry of FIX.index.slice(0, 90)) {
    for (const lvl of [0, 1, 2, 5]) {
      const rec = same('_adv_buildRecommendation', entry, lvl, FIX.levels, 700, 683, 20);
      if (rec) {
        recs++;
        for (const sid of Object.keys(G.ADVISOR_STAT_BUFFS)) { same('_adv_statView', rec, sid); same('_adv_statMatchesEntry', sid, entry); }
      }
    }
  }
  assert.ok(recs > 20, 'recommendations built: ' + recs);
  const list = [{ roi: 2, shardCost: 5, name: 'b' }, { roi: 2, shardCost: 5, name: 'a' }, { roi: 2, shardCost: 3, name: 'z' }, { roi: 3, shardCost: 9, name: 'q' }, { roi: 1, shardCost: 1, name: 'c' }];
  const ranked = same('_adv_rankRecs', list);
  assert.deepStrictEqual(ranked.map((r) => r.name), ['q', 'z', 'a', 'b', 'c'], 'ROI first, then cheaper, then name (D3)');
});

test('decor: computeDecorRecs equals the page _adv_computeRecommendations for every stat group', async () => {
  const f = P.fixture('decor.json');
  const data = { levels: FIX.levels, index: FIX.index, mutex: await ctx._adv_loadMutex().then(P.j) };
  for (const inv of [f.inventory, f.shardsOnly, { tabs: {} }, null]) {
    for (const merged of [f.merged, { decorations: { ids: [] } }, null]) {
      const a = await ctx._adv_computeRecommendations(f.statIds, P.clone(inv), P.clone(merged));
      const b = C.computeDecorRecs(f.statIds, P.clone(inv), P.clone(merged), P.clone(data));
      assert.deepStrictEqual(P.j(b), P.j(a));
    }
  }
  const out = C.computeDecorRecs(f.statIds, f.inventory, f.merged, data);
  assert.equal(out.shardSummary.universal, 713);
  assert.ok(Object.values(out.byStat).reduce((n, r) => n + r.length, 0) > 50, 'recommendations across the stat groups');
  // ranking invariant of the page (D1-D3): sorted by ROI desc, ties cheaper first
  for (const sid of Object.keys(out.byStat)) {
    const r = out.byStat[sid];
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].roi > r[i].roi || (r[i - 1].roi === r[i].roi && r[i - 1].shardCost <= r[i].shardCost), sid + ' order');
  }
});

// ---- beasts ----------------------------------------------------------------------------------------------------------
test('beasts: platform + enhance + condition seams match the page loaders; resolve and scoring are identical', async () => {
  await ctx.ebLoadPlatformReqs();
  await ctx.boLoadOptimizerData();
  C.setPlatforms(P.clone(FIX.platforms));
  C.setEnhance(P.clone(FIX.enhance));
  C.setFieldConditions(P.clone(FIX.conditions));
  const f = P.fixture('beasts.json');
  for (const id of f.holeIds.concat([0, 999, '5', null])) same('ebHoleOrder', id);
  for (let field = 0; field <= 6; field++) for (let order = 0; order <= 10; order++) {
    same('ebPlatformReq', field, order);
    same('boLookupHole', field, order);
  }
  const resolved = same('ebResolveBeasts', f.enigmas);
  same('ebResolveBeasts', null);
  same('ebResolveBeasts', {});
  assert.ok(resolved.beasts.length === 9 && resolved.fields.length === 2);
  const slots = [];
  for (const h of FIX.platforms.holes) slots.push({ fieldType: h.fieldType, order: h.order, enhanceRowId: String(h.maxEnhanceValue).split('|')[0], enhanceLevel: (h.id % 4) * 5 });
  slots.push(null, { fieldType: 9, order: 9 });
  const beasts = resolved.beasts.map((b) => ({ id: b.id, type: b.type, fac: b.faction, q: b.quality, lv: b.level, st: b.star, pot: b.potential, mb: b.mainBuff, bb: b.baseBuff.map((x) => x.id) }))
    .concat(f.bench.beasts.map((b) => ({ id: b.id, type: b.type, fac: b.fac, q: b.q, lv: b.lv, st: b.st, pot: b.pot, mb: b.mb, bb: b.bb.map((x) => (x && x.id) || x) })));
  let scored = 0;
  for (const ps of f.playstyles) {
    for (const buff of [520000, 520010, 520020, 520030, 520040, 520100, 520110, 520130, 990100, 1, 0]) {
      same('boClassifyBuff', buff, true); same('boClassifyBuff', buff, false);
      for (const main of [true, false]) same('boScoreOneBuff', buff, main, 3, 40, 12000, ps);
    }
    for (const u of [0, 1, 2, 3, 4]) same('boPlaystyleMult', u, ps);
    same('boResolveWeights', ps);
    for (const beast of beasts) {
      same('boBeastTiebreak', beast);
      for (const at of ['now', 'maxOut']) for (const slot of slots) for (const gate of [undefined, true, false]) {
        const v = same('boBeastScore', beast, at, slot, ps, gate);
        if (v > 0) scored++;
      }
      for (const slot of slots.slice(0, 10)) { same('boComputeRarityBonus', beast, slot, 'now', ps); same('boRarityBonusBreakdown', beast, slot, 'maxOut', ps); }
    }
  }
  assert.ok(scored > 500, 'positive scores compared: ' + scored);
  for (const s of slots) { same('boResolveSlotWeights', s || { fieldType: 1, order: 1 }); }
  for (const f2 of [1, 2, 3, 4, 5]) for (const o of [1, 5, 7, 9]) { same('boGetTgLinkForSlot', f2, o); same('boIsRefinementDrivenSlot', f2, o); }
  for (const row of ['1', '2', 'x']) for (const lv of [0, 1, 20, 40, 99]) { same('boEnhanceAt', row, lv); same('boMaxEnhanceLevel', row); }
});

test('beasts: TG-linkage reader (and the overrides it leaves behind) and player enhance levels', () => {
  const s = P.fixture('gear-supp.json');
  const identity = { getSupplement: (kind, sk) => (kind === 'gear' && sk === s.siteKey ? s.gearSupp : null) };
  ctx.ArmoryIdentity = identity;
  C.setIdentity(identity);
  const a = same('boReadTgRefinement', s.tgMerged, s.siteKey);
  assert.ok(Object.keys(a).length > 0, 'linkage overrides produced');
  same('boReadTgRefinement', s.tgMerged, null);
  same('boReadTgRefinement', null, s.siteKey);
  same('boReadTgRefinement', { heroes: [] }, 'ffffffffffffffff');
  // the overrides of the last call are state both sides keep: scoring after it must still agree
  same('boReadTgRefinement', s.tgMerged, s.siteKey);
  const f = P.fixture('beasts.json');
  const beast = { id: '1', q: 5, lv: 50, st: 3, pot: 9000, mb: 520040, bb: [520010] };
  for (const slot of [{ fieldType: 4, order: 5 }, { fieldType: 5, order: 8 }, { fieldType: 1, order: 1 }]) {
    for (const ps of f.playstyles) same('boBeastScore', beast, 'now', slot, ps, true);
    same('boResolveSlotWeights', slot);
  }
  same('boReadPlayerEnhance', s.tgMerged, 'x');
  same('boReadPlayerEnhance', null, 'x');
  same('boReadPlayerEnhance', {}, 'x');
});

// ---- freshness, timestamps, report merge -------------------------------------------------------------------------------
test('freshness + timestamps + report merge', (t) => {
  const f = P.fixture('freshness.json');
  t.mock.method(Date, 'now', () => 1760100000000);
  for (const ts of f.ages) same('_ar_freshnessAge', ts);
  assert.equal(C._ar_freshnessAge(0), 'unknown');
  assert.equal(C._ar_freshnessAge(1760100000000 - 90000), '1m ago');
  assert.equal(C._ar_freshnessAge(1760100000000 - 3 * 3600000), '3h ago');
  assert.equal(C._ar_freshnessAge(1760100000000 - 2 * 86400000), '2d ago');
  for (const ts of f.relativeAges) same('_ar_advisorRelativeAge', ts);
  same('_ar_advisorRelativeAge', null);
  const per = same('_ar_perEntityReportTs', f.reports, f.srcKey, f.idKey);
  assert.equal(per['1006'].ts, 1760000000 * 1000, 'newest report wins per mecha');
  same('_ar_perEntityReportTs', null, 'mechas', 'mechaId');
  same('_ar_perEntityReportTs', f.reports, 'heroes', 'id');
  for (const suppTs of [0, 1759000000000, 1760000000000, 1761000000000]) {
    same('_ar_buildSourceFreshness', { suppTs, reports: f.reports, perEntityTs: per });
    same('_ar_buildSourceFreshness', { suppTs, reports: f.reports });
  }
  same('_ar_buildSourceFreshness', null);
  same('_ar_buildSourceFreshness', {});
  const merged = same('mergeReportData', f.reports);
  assert.equal(merged.heroes.length, 4, 'latest-wins per hero id (101 once)');
  assert.equal(merged.heroes.find((h) => h.id === 101).lv, 0 + 1760000000 % 100, 'newest report wins for a hero');
  same('mergeReportData', []);
  same('mergeReportData', f.reports.slice().reverse());
  const mechas = same('_ar_overlayMechasWithChips', merged.mechas, per, f.chipsSupp, 1761000000000);
  same('_ar_overlayMechasWithChips', merged.mechas, per, f.chipsSupp, 1000);
  same('_ar_overlayMechasWithChips', null, {}, null, 0);
  assert.ok(mechas.some((m) => m._source === 'supp'), 'a newer supplement wins');
  same('_ar_synthDecorationsFromSupp', f.decorSupp);
  same('_ar_synthDecorationsFromSupp', null);
  same('_ar_synthDecorationsFromSupp', {});
  same('_ar_synthSkinsFromSupp', f.skinSupp);
  same('_ar_synthSkinsFromSupp', null);
});

// ---- march size ------------------------------------------------------------------------------------------------------
test('march size calculation (bench, bag, chests, pool, target)', () => {
  const f = P.fixture('march.json');
  for (const slot of [null, {}, { id: 21116, lv: 8 }, { id: 20116, lv: 5 }, { id: 99999, lv: 3 }, { id: 21116, lv: 0 }]) same('msResolveMarchSize', slot);
  const hits = same('msEnumerateBenchSkills', f.heroesSupp);
  assert.equal(hits.length, 9, 'b[0] and every x slot of both presets, pre-dedup (hero 101: 2, 102: 2, 103: 4, 104: 1)');
  same('msEnumerateBenchSkills', null);
  same('msEnumerateBagSkills', f.invSupp);
  same('msEnumerateBagSkills', null);
  same('msEnumerateChests', f.invSupp);
  same('msEnumerateChests', { tabs: { item: [] } });
  const optsFor = (exclude, marched) => ({ heroesSupp: f.heroesSupp, invSupp: f.invSupp, excludedHeroIds: new Set(exclude), marchedHeroIds: new Set(marched) });
  for (const [ex, ma] of [[[], []], [[101], [103]], [[101, 102, 103, 104], []], [[], [101, 102]]]) {
    const a = ctx.msBuildPool(optsFor(ex, ma)), b = C.msBuildPool(optsFor(ex, ma));
    assert.deepStrictEqual(P.j(b), P.j(a), 'msBuildPool exclude ' + ex + ' marched ' + ma);
  }
  same('msBuildPool', { heroesSupp: null, invSupp: null });
  for (const t of f.targets) for (const pool of f.pools) same('msComputeTarget', t, pool);
  assert.equal(C.msComputeTarget({ rarity: 'rare', currentLevel: 99 }, { rare: { 99: 1 } }).maxedOut, true);
});
