'use strict';
// ArmoryBeastsLogic (pages/armory-beasts.js): the Beasts section's data rules, on synthetic beasts (test/fixtures/armory-core/beasts.json
// and test/helpers/beasts-synth.js; no player data). Expected numbers are hand-computed from the game's buff tables, the way the classic
// Enigma tab computes them: main = (starMax[star] / 100) * (potential / 16000), base = (level * lvMax / 100 + starMax[star] / 100) * (potential / 16000).
// Run: node --test test/armory-beasts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../pages/armory-beasts.js');
const Core = require('../pages/armory-core.js');
const Opt = require('../pages/armory-beasts-opt.js');
const VM = require('../pages/armory-vm.js');
const G = require('../pages/tw-game-data.js');
const P = require('./helpers/armory-page.js');
const { synth } = require('./helpers/beasts-synth.js');

function mkCore(load) {
  const core = Core.create();
  if (load !== false) { core.setPlatforms(P.data('enigma-platforms.json')); core.setEnhance(P.data('enigma-platform-enhance.json')); core.setFieldConditions(P.data('enigma-field-conditions.json')); }
  return core;
}
const FX = P.fixture('beasts.json');
const MONO = { mode: 'mono', units: [1] };

test('label: the game\'s short buff names are written out (render only)', () => {
  assert.equal(L.label('All ATK (off)'), 'All Attack (offense)');
  assert.equal(L.label('Army ATK (def)'), 'Army Attack (defense)');
  assert.equal(L.label('Navy DEF vs Army'), 'Navy Defense vs Army');
  assert.equal(L.label('All Elemental RES'), 'All Elemental Resistance');
  assert.equal(L.label('March Size'), 'March Size');
  assert.equal(L.label('<b>x</b>'), 'bx/b', 'markup characters are dropped');
});

test('model: summary, fields and slots of the fixture roster (hand-computed)', () => {
  const core = mkCore(); core.setSuppDecode(FX.suppDecode);
  const m = L.model(core, G, { enigmas: P.clone(FX.enigmas) }, P.clone(FX.bench));
  // 9 beasts on 2 fields (7 deployed: beasts 8 and 9 are in the data but on no slot), 2 bench beasts from the bench supplement
  assert.equal(m.placed, 7); assert.equal(m.bench, 4); assert.equal(m.all.length, 11);
  assert.deepEqual(m.summary, { beasts: 7, fiveStar: 1, active: '2/2', avgPot: 48, power: 35000, bench: 4 });
  // potential: deployed (1500 + 3200 + 4900 + 6600 + 8300 + 10000 + 11700) = 46200 of (5 x 16000 + 2 x 8000 ... by quality) -> classic rounding
  assert.deepEqual(m.fields.map((f) => [f.cfg, f.name, f.active, f.expected, f.deployed, f.slots.length]), [[1, 'CPNT Mastery', true, 5, 4, 5], [5, 'Offense', true, 9, 3, 4]]);
  const b2 = m.byId['2'];
  assert.equal(b2.name, 'Dreadray'); assert.equal(b2.q, 4); assert.equal(b2.maxPot, 8000); assert.equal(b2.potPct, 40);
  // main 520010 at star 2: mainStarMax 400 -> 4.00 x (3200 / 16000) = 0.8
  assert.equal(b2.main.txt, '+0.800%'); assert.equal(b2.main.name, 'All DMG Increase');
  // base 520011 at star 2, level 19: (19 x 2 / 100 + 75 / 100) x 0.2 = 0.226
  assert.equal(b2.base[0].txt, '+0.226%');
  assert.equal(m.byId['1'].main.txt, '+1', 'March Size is a flat count');
  assert.equal(m.byId['9'].main.txt, '+2');
  assert.equal(m.byId['78'].potPct, 0);
  // the beast sheet's slot buffs are the classic detail modal's: basis points / 100, two decimals (the fixture slot 1 buff is 100)
  assert.deepEqual(m.byId['1'].slotBuffs, [{ name: 'March Size', txt: '+1.00%' }]);
  assert.equal(m.byId['1'].fieldName, 'CPNT Mastery'); assert.ok(m.byId['8'].fieldCfg === 0 && m.byId['8'].slot === 0);
  assert.equal(m.byId['5'].icon, 'Fluffynx_Fire_evolved.png', 'the icon file name rule (EB_ICON_NAMES) differs from the display name for type 5'); assert.equal(m.byId['1'].icon, 'Dreadray_Fire_base.png');
  // the bench supplement is deduped by id: a bench beast that is already deployed is not listed twice
  const dup = L.model(core, G, { enigmas: P.clone(FX.enigmas) }, { beasts: [{ id: '1', cfgId: 25, type: 2, fac: 1, q: 5, lv: 10, st: 1, pot: 1500, mb: 520000, bb: [] }] });
  assert.equal(dup.all.length, 9);
  // string potentials from the bench supplement ("14046") count as numbers
  const str = L.model(core, G, { enigmas: P.clone(FX.enigmas) }, { beasts: [{ id: 'x1', cfgId: 25, type: 2, fac: 1, q: 5, lv: 10, st: 1, pot: '8000', mb: 520000, bb: [] }] });
  assert.equal(str.byId.x1.pot, 8000); assert.equal(str.byId.x1.potPct, 50);
});

test('model: platform rules and unlock conditions per slot, slot order from the hole ids, empty slots', () => {
  const core = mkCore(); core.setSuppDecode(FX.suppDecode);
  const m = L.model(core, G, { enigmas: P.clone(FX.enigmas) }, null);
  const f1 = m.fields[0];
  assert.deepEqual(f1.slots.map((s) => s.num), [1, 2, 3, 4, 5]);
  assert.deepEqual(f1.slots[0].req, { universal: true }, 'field 1 slot 1 takes any beast');
  assert.equal(f1.slots[0].cond, 'Fill All Slots'); assert.equal(f1.slots[1].cond, 'Deploy 1 Legendary');
  assert.equal(f1.slots[4].beast, null, 'the hole with beastId 0 is empty');
  assert.equal(f1.slots[0].platformLv, 1); assert.equal(f1.slots[0].beast.id, '1');
  assert.deepEqual(f1.slots[0].buffs, [{ name: 'March Size', txt: '+1.00%' }], 'slot buffs are basis points / 100 with two decimals');
  // without the platform tables the slot numbers fall back to the array position and there are no rules
  const bare = L.model(mkCore(false), G, { enigmas: P.clone(FX.enigmas) }, null);
  assert.ok(bare.fields[0].slots.every((s) => s.req === null));
});

test('model: no enigma data at all is null (the empty state), not an empty model', () => {
  const core = mkCore();
  for (const merged of [null, {}, { enigmas: null }, { enigmas: {} }, { enigmas: { beastDatas: [], fields: [] } }]) assert.equal(L.model(core, G, merged, null), null);
  // bench-only data (no deployments) still shows the collection
  const b = L.model(core, G, { enigmas: { beastDatas: [], fields: [{ cfg: 1, active: true, slots: [] }] } }, P.clone(FX.bench));
  assert.equal(b.bench, 2);
});

test('hostile supplement strings are cleaned or coerced (names, ids, buffs, numbers)', () => {
  const core = mkCore();
  const m = L.model(core, G, { enigmas: { beastDatas: [], fields: [{ cfg: 1, active: true, slots: [] }] } }, { beasts: [
    { id: '<img src=x onerror=alert(1)>', cfgId: 25, type: '<b>', fac: '"x"', q: '5', lv: '<i>9</i>', st: 'NaN', pot: '<script>', mb: '<svg/onload=1>', bb: ['<u>', { id: '"><a>' }] }] });
  const b = m.all[0];
  for (const v of [b.name, b.element, b.main.name, b.base[0].name, b.base[1].name]) assert.ok(!/[<>"'&]/.test(v), 'no markup characters in ' + v);
  for (const k of ['type', 'faction', 'q', 'star', 'lv', 'pot', 'maxPot', 'potPct', 'power']) assert.ok(typeof b[k] === 'number' && isFinite(b[k]), k + ' is a finite number');
  assert.match(b.icon, /^[A-Za-z0-9_. -]+$/);
});

test('collection filter and sort (the classic ebFilterBeasts / ebSortBeasts) and the option lists', () => {
  const core = mkCore(); core.setSuppDecode(FX.suppDecode);
  const m = L.model(core, G, { enigmas: P.clone(FX.enigmas) }, P.clone(FX.bench));
  const st = (o) => Object.assign({ elems: [], where: '', primary: '', secondary: '', sort: 'star' }, o || {});
  const ids = (l) => l.map((b) => b.id);
  assert.deepEqual(ids(L.collFilter(m.all, st())).slice(0, 3), ['5', '9', '4'], 'stars 5, then the two 4-star beasts by potential (15100 before 6600)');
  assert.deepEqual(ids(L.collFilter(m.all, st({ sort: 'level' }))).slice(0, 3), ['9', '8', '7'], 'level, high first');
  assert.deepEqual(ids(L.collFilter(m.all, st({ sort: 'potential' }))).slice(0, 2), ['9', '8']);
  assert.deepEqual(ids(L.collFilter(m.all, st({ where: 'bench' }))).sort(), ['77', '78', '8', '9'].sort(), 'bench: no field');
  assert.deepEqual(ids(L.collFilter(m.all, st({ where: '5' }))).sort(), ['5', '6', '7'], 'Offense field');
  assert.deepEqual(ids(L.collFilter(m.all, st({ elems: ['Ground'] }))).sort(), ['6', '78', '8'].sort());
  assert.deepEqual(ids(L.collFilter(m.all, st({ elems: ['Ground', 'Fire'], where: 'bench' }))).sort(), ['77', '78', '8', '9'].sort(), 'elements OR together, then AND with where');
  assert.deepEqual(ids(L.collFilter(m.all, st({ type: '2' }))).sort(), ['1', '2', '77'], 'beast type 2 (Dreadray)');
  assert.deepEqual(ids(L.collFilter(m.all, st({ type: '2', where: 'bench' }))), ['77'], 'type AND where');
  assert.deepEqual(ids(L.collFilter(m.all, st({ primary: '520000' }))).sort(), ['1', '78', '9']);
  assert.deepEqual(ids(L.collFilter(m.all, st({ secondary: '520012' }))).sort(), ['2', '3', '78']);
  assert.deepEqual(L.collFilter(m.all, st({ elems: ['Nope'] })), []);
  assert.equal(L.collFilter(m.all, st({ sort: 'name' }))[0].name, 'Dreadray');
  const o = L.collOptions(G, m);
  assert.deepEqual(o.where.map((x) => x[0]), ['', '1', '5', 'bench']); assert.equal(o.where[3][1], 'Bench (4)');
  assert.ok(o.primary.length > 2 && o.primary[0][1] === 'Any');
  assert.ok(o.primary.every((x) => !/\bATK\b|\(off\)/.test(x[1])), 'option names are written out');
  assert.equal(o.sort.length, 5);
  assert.deepEqual(o.type.map((x) => x[1]), ['Any beast', 'Dreadray (3)', 'Gleamdeer (1)', 'Grizzroar (1)', 'Skynx (3)', 'Tornadeagle (3)'], 'types present, named and counted, A to Z');
});

test('preferences: only a well-formed {mode, units, weights} is accepted (localStorage is not trusted)', () => {
  assert.deepEqual(L.validPrefs({ mode: 'dual', units: [1, 3], balance: 'primarySecondary', weights: [1, 0.5] }), { mode: 'dual', units: [1, 3], balance: 'primarySecondary', weights: [1, 0.5] });
  assert.deepEqual(L.validPrefs({ mode: 'mono', units: [2], weights: [5] }), { mode: 'mono', units: [2], balance: 'even', weights: null });
  assert.equal(L.validPrefs({ mode: 'triple', units: [1, 2, 3] }).weights, null);
  for (const bad of [null, 'x', {}, { mode: 'quad', units: [1] }, { mode: 'quad', units: [1, 2, 3] }, { mode: '__proto__', units: [1, 2, 3] }, { mode: 'mono', units: [] }, { mode: 'mono', units: [1, 2] }, { mode: 'dual', units: [1, 1] }, { mode: 'dual', units: [1, 4] },
    { mode: 'dual', units: [1, 2], weights: [1, 0] }, { mode: 'dual', units: [1, 2], weights: [1, 99] }, { mode: 'triple', units: [1, 2, 3, 3] }, { mode: 'mono', units: ['<x>'] }]) assert.equal(L.validPrefs(bad), null, JSON.stringify(bad));
  assert.equal(L.readPrefs('not json'), null); assert.equal(L.readPrefs(null), null);
  assert.deepEqual(L.readPrefs(JSON.stringify({ mode: 'mono', units: [1], savedAt: 'x', extra: 1 })), { mode: 'mono', units: [1], balance: 'even', weights: null });
});

// the helpers the classic page keeps next to its DOM: pulled by name and compared
test('labels and number formats equal the page\'s (boPlaystyleLabel, boFmtStat, boFmtStatDelta, boReasoning with the written-out stat names)', async () => {
  const names = ['boPlaystyleLabel', 'boFmtStat', 'boFmtStatDelta', 'boReasoning', 'boResolveWeights', 'boPlaystyleMult', 'boClassifyBuff'].concat(Object.keys(G).filter((k) => k !== 'setSuppDecode'));
  const ctx = P.loadPage(names.concat(['BO_STAT_LABELS']), {});
  const core = mkCore();
  for (const ps of [MONO, { mode: 'dual', units: [1, 3] }, { mode: 'dual', units: [2, 1], balance: 'primarySecondary' }, { mode: 'dual', units: [1, 2], weights: [1, 0.5] }, { mode: 'triple', units: [1, 2, 3] }, { mode: 'triple', units: [1, 2, 3], weights: [1, 0.75, 0.25] }]) {
    assert.equal(L.playstyleLabel(core, ps), ctx.boPlaystyleLabel(ps), JSON.stringify(ps));
  }
  for (const k of ['atk', 'march', 'def']) for (const v of [0, 0.004, 0.5, 12.3456, 100]) { assert.equal(L.fmtStat(k, v), ctx.boFmtStat(k, v)); for (const d of [v, -v]) assert.equal(L.fmtDelta(k, d), ctx.boFmtStatDelta(k, d)); }
  const rec = { to: { mb: 520000, pot: 16000, q: 5, bb: [520010, 520111, 520130] } };
  for (const ps of [MONO, { mode: 'dual', units: [1, 3] }]) {
    const want = ctx.boReasoning(rec, ps).replace(/^Top contributions: /, 'Biggest gains: ').replace(/ \+ /g, ' and ').replace('DMG Increase', 'DMG increase').replace('DMG Decrease', 'Decreased DMG taken').replace('ATK', 'Attack').replace('DEF', 'Defense');
    assert.equal(L.reasoning(G, core, rec, ps), want);
  }
  assert.equal(L.reasoning(G, core, { to: null }, MONO), '');
});

function bench1(over) { return { beasts: [Object.assign({ id: '2', cfgId: 25, type: 2, fac: 1, q: 5, lv: 50, st: 3, pot: 16000, mb: 520040, bb: [] }, over || {})] }; }
function field1(beast) { return { beastDatas: beast ? [beast] : [], fields: [{ cfg: 1, active: true, slots: [{ id: 1, beastId: beast ? beast.id : '0', level: 1, potential: 0, buffs: [] }, { id: 2, beastId: '0', level: 1, potential: 0, buffs: [] }] }] }; }
const WEAK = { id: '1', cfg: 25, star: 3, level: 50, potential: 4000, power: 1, mainBuff: 520040, baseBuff: [] };

test('plan model: totals, groups by field, swap records, notes; the bench beast with the same buff but more potential wins field 1 slot 1', () => {
  const core = mkCore(), opt = Opt.create(core);
  const merged = { enigmas: field1(WEAK) };
  const pm = L.planModel(G, core, opt, merged, bench1(), MONO, 'x');
  assert.equal(pm.swaps.length, 1); assert.equal(pm.groups.length, 1); assert.equal(pm.groups[0].name, 'CPNT Mastery');
  const s = pm.swaps[0], raw = pm.raw.recommendations[0];
  assert.equal(s.order, 1); assert.equal(s.source, 'bench'); assert.equal(s.from.name, 'Dreadray'); assert.equal(s.to.id, '2'); assert.equal(s.to.rarity, 'Legendary');
  assert.equal(s.gainToday, Math.round(raw.gainToday)); assert.equal(s.gainMax, Math.round(raw.gainAtMax));
  assert.equal(pm.totalToday, Math.round(pm.raw.totalGainToday)); assert.equal(pm.totalMax, Math.round(pm.raw.totalGainAtMax));
  // same buff, potential 4000 -> 16000 at 3 stars: main 18.00 x 0.25 = 4.5 becomes 18.00 x 1 = 18 (before the Attack scope weighting)
  const atk = s.stats.find((r) => r.key === 'atk');
  assert.ok(atk && atk.dir === 1 && /^\+/.test(atk.net) && /%$/.test(atk.net)); assert.equal(atk.label, 'Attack');
  assert.ok(s.chain === null && s.threshold === null && s.broke.length === 0);
  assert.equal(pm.label, 'Mono Army'); assert.deepEqual(pm.notes, []);
  // notes: an old bench snapshot, and reports covering fewer deployed beasts than the game says
  const old = L.planModel(G, core, opt, merged, Object.assign(bench1(), { ts: new Date(Date.now() - 20 * 864e5).toISOString(), skippedDeployed: 5 }), MONO, 'x');
  assert.equal(old.notes.length, 2); assert.match(old.notes[0], /^Your bench snapshot is 20 days old/); assert.match(old.notes[1], /only 1 of 5 deployed beasts/);
  // nothing to improve: the bench beast is the same as the deployed one
  const same = L.planModel(G, core, opt, { enigmas: field1(Object.assign({}, WEAK, { potential: 16000 })) }, bench1(), MONO, 'x');
  assert.equal(same.swaps.length, 0); assert.deepEqual(same.groups, []);
});

test('best move for Next moves: a bench swap that gains today, needs no upgrade and is not part of a chain', () => {
  const core = mkCore(), opt = Opt.create(core);
  const mv = L.bestMove(G, core, opt, { enigmas: field1(WEAK) }, bench1(), MONO, 'x');
  assert.ok(mv.gain > 0);
  assert.deepEqual(mv.parts.slice(0, 6).map((p) => p.s), ['Swap ', 'Dreadray', ' into ', 'CPNT Mastery', ' slot ', '1']);
  assert.deepEqual(mv.parts.slice(0, 6).map((p) => !!p.n), [false, true, false, true, false, true]);
  assert.equal(mv.parts[6].s, ': '); assert.match(mv.parts[7].s, /^\+\d+(\.\d+)?%$/); assert.equal(mv.parts[8].s, ' Attack');
  // the gain is the optimizer's own score difference today
  const raw = opt.plan({ enigmas: field1(WEAK) }, bench1(), MONO, 'x').result.recommendations[0];
  assert.equal(mv.gain, raw.gainToday);
  assert.deepEqual(mv.ico, { u: 'beast-icons/Dreadray_Fire_base.png', q: 'q5', fb: 'D' });
  assert.match(mv.meta, /^From bench · \d+ power score points today$/);
  // the Overview text reads "Swap Dreadray into CPNT Mastery slot 1: +14.17% Attack" and stays within the 60 character rule
  const n = Core.nextMoves({ heroes: [], beastMoves: [mv] });
  const pick = n.picks.find((p) => p.sig === 'e');
  assert.ok(pick, 'signal e is picked'); assert.ok(pick.full.length <= 60 || pick.text.length <= 60); assert.equal(pick.route, 'beasts/optimizer'); assert.equal(pick.pill, 'Free');
  assert.deepEqual(pick.ico, mv.ico); assert.equal(pick.meta, mv.meta); assert.match(pick.full, /^Swap Dreadray into CPNT Mastery slot 1: \+[\d.]+% Attack$/);
  // nothing to do: null
  assert.equal(L.bestMove(G, core, opt, { enigmas: field1(Object.assign({}, WEAK, { potential: 16000 })) }, bench1(), MONO, 'x'), null);
  assert.equal(L.bestMove(G, core, opt, { enigmas: field1(WEAK) }, { beasts: [] }, MONO, 'x'), null);
  // a better beast that must be levelled first (a threshold) is not offered as a "do it now" move
  const noThr = L.bestMove(G, core, opt, { enigmas: field1(Object.assign({}, WEAK, { star: 5, level: 100, potential: 16000, mainBuff: 520040 })) }, bench1({ st: 1, lv: 1, pot: 16000 }), MONO, 'x');
  assert.equal(noThr, null);
});

test('best move: chains and backfills are never offered on their own; the move is the largest single gain', () => {
  const core = mkCore(), opt = Opt.create(core);
  let singles = 0, nulls = 0;
  for (const seed of [1, 7, 23, 42, 99]) {
    const s = synth(seed, 70);
    for (const ps of [MONO, { mode: 'triple', units: [1, 2, 3] }]) {
      const merged = { enigmas: s.enigmas }, recs = opt.plan(merged, s.bench, ps, 'x').result.recommendations;
      const ok = recs.filter((r) => r.chainSize === 1 && !r.threshold && r.gainToday > 0.5), mv = L.bestMove(G, core, opt, merged, s.bench, ps, 'x');
      if (!ok.length) { assert.equal(mv, null); nulls++; continue; }
      singles++;
      assert.equal(mv.gain, Math.max.apply(null, ok.map((r) => r.gainToday)));
      assert.ok(recs.filter((r) => r.chainSize > 1).every((r) => r.gainToday !== mv.gain || ok.some((o) => o.gainToday === mv.gain)));
    }
  }
  assert.ok(singles > 0, 'at least one roster has a single swap');
  void nulls;
});

test('swap record: chain note, upgrade threshold with fodder counts, broken-condition labels (written out), and the checklist text', () => {
  const core = mkCore(), opt = Opt.create(core);
  const sw = []; let chain = null, thr = null, brk = null;
  for (const seed of [1, 7, 23, 5, 11]) {
    const s = synth(seed, 70), pm = L.planModel(G, core, opt, { enigmas: s.enigmas }, s.bench, { mode: 'triple', units: [1, 2, 3] }, 'x');
    pm.swaps.forEach((x) => { sw.push(x); if (x.chain && !chain) chain = x; if (x.threshold && !thr) thr = x; if (x.broke.length && !brk) brk = x; });
    if (seed === 1) assert.ok(L.checklist(G, pm.groups).split('\n').length === pm.swaps.length);
  }
  assert.ok(sw.length > 10);
  assert.ok(chain && chain.chain.size > 1 && typeof chain.chain.netMax === 'number');
  assert.ok(thr && thr.threshold.star >= 1 && thr.threshold.maxStar >= thr.threshold.star && /^(Epic|Legendary)$/.test(thr.threshold.rarity));
  assert.ok(thr.threshold.fodderNeeded == null || thr.threshold.fodderHave >= 0);
  if (brk) brk.broke.forEach((b) => assert.match(b.label, /^[A-Za-z ]+ slot \d+$/));
  sw.forEach((x) => { assert.ok(Number.isInteger(x.gainToday) && Number.isInteger(x.gainMax)); x.stats.forEach((r) => assert.ok(!/\bATK\b|\bDEF\b/.test(r.label))); });
  const line = L.checklist(G, [{ name: 'Offense', swaps: [{ order: 3, from: null, to: { name: 'Skynx', rarity: 'Legendary', star: 5, lv: 80 }, threshold: { star: 4, level: 20 }, chain: { id: 2, backfill: true, netMax: 9 } }] }]);
  assert.equal(line, '1. Offense slot 3: empty -> Skynx (Legendary, 5 stars, Lv 80) [raise to 4 stars, Lv 20 first] [backfill, move 2]');
});

test('the logic never touches the DOM, storage or the network (pure, node-testable)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../pages/armory-beasts.js'), 'utf8').split('/* ---------- view ---------- */')[0];
  assert.ok(!/document\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|innerHTML/.test(src), 'no DOM, storage or network in the logic half');
  assert.ok(!/—/.test(require('node:fs').readFileSync(require.resolve('../pages/armory-beasts.js'), 'utf8')), 'no em dash');
});

test('first-load view model keeps the Next moves signal empty until the optimizer has run (nothing heavy on the Overview path)', () => {
  const mv = VM.movePicks({ picks: [{ text: 't', full: 'f', fparts: [{ s: 'f' }], meta: 'm', pill: 'Free', cls: 1, sig: 'e', route: 'beasts/optimizer', ico: { u: 'x', q: '', fb: 'x' } }] });
  assert.deepEqual(mv, [{ text: 't', full: 'f', parts: [{ s: 'f' }], meta: 'm', pill: 'Free', cls: 1, sig: 'e', route: 'beasts/optimizer', ico: { u: 'x', q: '', fb: 'x' } }]);
  const src = require('node:fs').readFileSync(require.resolve('../pages/armory-vm.js'), 'utf8');
  assert.ok(!/armory-beasts/.test(src), 'the view model does not load the beasts modules');
});
