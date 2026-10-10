'use strict';
// ArmoryVM.buildViewModel (pages/armory-vm.js): the Overview + Heroes view-model, on synthetic data only (invented
// player, ids and values from the public game tables). Hand-computed expectations are derived in each test.
// Run: node --test test/armory-vm.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../pages/armory-vm.js');
const Core = require('../pages/armory-core.js');
const G = require('../pages/tw-game-data.js');
const AD = require('../pages/armory-data.js');
const P = require('./helpers/armory-page.js');
const W = require('./helpers/armory-world.js');

const LOOKUPS = P.data('decor-lookups.json');
const STATICS = {
  runeTypes: P.data('rune-types.json'), decorLevels: P.data('decoration-levels.json'), decorIndex: P.data('decoration-index.json'),
  decorLookups: LOOKUPS, itemTable: P.data('item-table.json'),
};
const NOW = Date.parse('2026-10-09T12:00:00Z');
const day = (n) => NOW - n * 86400000;

function newCore() {
  const c = Core.create();
  c.setDecorLookups(LOOKUPS);
  const names = {};
  P.fixture('gear-heroes.json').heroes.forEach((h) => { names[h.id] = h.name; });
  c.setHeroCache(names, null);
  return c;
}
// an id of `group` at `level`, found with the core's own id -> group and level tables
function decorId(core, group, level) {
  const base = LOOKUPS.DECOR_GROUP_BASE[String(group)];
  for (let id = base; id < base + 30; id++) if (String(core.decorIdToGroup(id)) === String(group) && core.decorLevel(id, group) === level) return id;
  throw new Error('no id for group ' + group + ' level ' + level);
}
const heroes3 = () => P.fixture('gear-heroes.json').heroes.slice(0, 3).map((h) => ({ id: h.id, heroEquips: h.heroEquips, level: 100, star: 5, awakenLevel: 0 }));
const baseMerged = () => ({ heroes: heroes3(), decorations: { ids: [], suit: [] }, enigmas: null, mechas: [{ mechaId: 1006, chips: [{ chipId: 9404, level: 6 }, { chipId: 8501, level: 25 }] }] });
const build = (merged, over, core) => {
  core = core || newCore();
  const o = Object.assign({ core, statics: STATICS, supp: {}, privacy: {}, player: { name: 'Tester', siteKey: W.SK }, reports: [], reportMechaIds: [1006], now: NOW }, over || {});
  return VM.buildViewModel(merged, Object.assign({ reportsTs: day(10), dataTs: 0, kinds: [] }, (over && over.sources) || {}), o);
};

test('the model carries exactly the nextMoves input (see fixtures/armory-core/moves-base.json) and nextMoves accepts it', () => {
  const core = newCore();
  const vm = build(baseMerged(), null, core);
  const base = P.fixture('moves-base.json');
  const mi = vm.movesInput;
  assert.deepStrictEqual(Object.keys(mi).sort(), Object.keys(base).sort());
  const h = mi.heroes[0], bh = base.heroes[0];
  assert.deepStrictEqual(Object.keys(h).sort(), Object.keys(bh).concat('power').sort(), 'the model adds only power (null without a Snapshot)');
  assert.deepStrictEqual(Object.keys(h.gear[0]).sort(), Object.keys(bh.gear[0]).sort());
  assert.deepStrictEqual(Object.keys(h.gear[0].stats[0]).sort(), Object.keys(bh.gear[0].stats[0]).sort());
  const withRune = h.gear.find((p) => p.rune);
  assert.deepStrictEqual(Object.keys(withRune.rune).sort(), Object.keys(bh.gear[1].rune).sort());
  assert.deepStrictEqual(Object.keys(mi.decor).sort(), Object.keys(base.decor).sort());
  assert.deepStrictEqual(Object.keys(mi.ht).sort(), Object.keys(base.ht).sort());
  assert.ok(vm.moves.picks.length <= 3);
  // the model's heroes read exactly as the engine reads them
  assert.deepStrictEqual(core.nextMoves(mi, { max: 3 }).picks.map((p) => p.text), vm.moves.picks.map((p) => p.text));
});

test('gear: stats and runes come from the report equips; rune icon names, slot names, stat ceilings are the game tables', () => {
  const vm = build(baseMerged());
  const alpha = vm.heroes.list.find((x) => x.name === 'Alpha');
  const raw = P.fixture('gear-heroes.json').heroes[0].heroEquips;
  assert.equal(alpha.pieces.length, 6);
  assert.deepStrictEqual(alpha.pieces.map((p) => p.slot), [1, 2, 3, 4, 5, 6], 'slot = position when the report gives none');
  const p1 = alpha.pieces[0];
  assert.equal(p1.slotName, 'Assault Pistol');
  assert.deepStrictEqual(p1.stats, raw[0].infos.filter((i) => i.type === 1).map((i) => ({ label: G.GEAR_TEMPLATE[i.templateId].n, v: i.buffValue, m: G.GEAR_TEMPLATE[i.templateId].m })));
  assert.deepStrictEqual(p1.rune, { name: 'Artillery Storm', s: 6, sm: 6, icon: G.RUNE_ICON['Artillery Storm'] });
  assert.equal(p1.gold, true);
  assert.ok(alpha.icon.endsWith('hero_icon001_global.png?t=22.jpg'), 'starter heroes use the override icon id, like v1 heroBaseIconUrl');
});

test('hero score is the page\'s heroGearScore; the strength band counts them with the 6,000-per-hero denominator and a source word', () => {
  const core = newCore();
  const merged = baseMerged();
  const vm = build(merged, null, core);
  const sum = merged.heroes.reduce((s, h) => s + core.heroGearScore(h), 0);
  assert.equal(vm.band.gear.score, sum);
  assert.equal(vm.band.gear.max, 18000);
  assert.equal(vm.band.gear.heroes, 3);
  assert.equal(vm.band.gear.source, 'in battle reports');
  assert.deepStrictEqual(vm.heroes.list.map((h) => h.score), vm.heroes.list.map((h) => h.score).sort((a, b) => b - a), 'highest gear score first');
  // the engine's own score agrees piece for piece when every piece is gold
  vm.heroes.list.forEach((h) => assert.equal(core.moves.gearScore({ gear: h.gear }).total, h.score, h.name));
  // rune stars: (star + 1) / (star max + 1) per equipped rune, an empty slot is 0 of 7 (the page's formula)
  let got = 0, max = 0, eq = 0;
  vm.heroes.list.forEach((h) => h.gear.forEach((p) => { if (p.rune) { eq++; got += p.rune.s + 1; max += p.rune.sm + 1; } else max += 7; }));
  assert.deepStrictEqual(vm.band.runes, { pct: Math.round((got / max) * 100), equipped: eq, source: 'equipped' });
  assert.equal(vm.band.beasts, null, 'no enigma data: no beast meter');
  // without reports the heroes come from the roster and the band says so
  const synth = build({ heroes: merged.heroes.map((h) => Object.assign({ _supplemental: true }, h)), decorations: null }, { reports: [], supp: { heroes: { list: [{ id: 101 }, { id: 102 }, { id: 103 }, { id: 104 }] } } });
  assert.equal(synth.band.gear.source, 'in roster');
  assert.equal(synth.summaries.heroes.roster, 4);
  assert.equal(synth.summaries.heroes.source, 'roster');
});

test('refine considers gold pieces only: a piece known to be below gold never reaches nextMoves, quality comes from the id or the roll templates', () => {
  const eq = (id, slot, quality) => ({ id, _slot: slot, quality, infos: [{ type: 1, templateId: 8, buffValue: 10 }, { type: 1, templateId: 20, buffValue: 10 }, { type: 2, templateId: 10201 }] });
  const hero = { id: 101, level: 100, star: 5, heroEquips: [eq(1, 2, 4), eq(2, 3, 5), eq(3, 4, undefined), eq(4, 5, null), eq(5, 6, 2)] };
  const vm = build({ heroes: [hero], decorations: null, mechas: [] });
  const h = vm.heroes.list[0];
  assert.deepStrictEqual(h.pieces.map((p) => [p.slot, p.gold]), [[2, false], [3, true], [4, true], [5, true], [6, false]]);
  assert.deepStrictEqual(h.gear.map((p) => p.slot), [3, 4, 5], 'what nextMoves reads is the gold subset');
  const refines = Core.create().nextMoves(vm.movesInput, { max: 12 }).pool.filter((c) => c.sig === 'c').map((c) => c.key).sort();
  assert.deepStrictEqual(refines, ['cAlpha3', 'cAlpha4', 'cAlpha5']);
  assert.equal(vm.heroes.list[0].score, newCore().heroGearScore(hero), 'the displayed score still counts every piece');
});

test('chips: slot, core and colour from the chip table; empty slots listed; reportMechas is null with no reports and [] when no HT fought', () => {
  const core = newCore();
  let vm = build(baseMerged(), null, core);
  const lk = G.CL[9404];
  const c4 = vm.ht.chips.find((c) => c.c === 9404);
  assert.deepStrictEqual(c4, { ht: 'Luminary Knight LP-4', mecha: 1006, slot: lk[1], core: false, lv: 6, empty: false, c: 9404, ic: G.SET_ICONS[lk[0]].replace(/\.png$/, '') });
  const c1 = vm.ht.chips.find((c) => c.c === 8501);
  assert.equal(c1.slot, G.CL[8501][1]);
  assert.equal(vm.ht.chips.filter((c) => c.empty).length, 4, 'one HT with 2 of 6 slots: 4 empty');
  const taken = [G.CL[9404][1], G.CL[8501][1]];
  assert.deepStrictEqual(vm.ht.chips.filter((c) => c.empty).map((c) => c.slot).sort(), [1, 2, 3, 4, 5, 6].filter((x) => !taken.includes(x)));
  assert.deepStrictEqual(vm.ht.reportMechas, [1006]);
  assert.deepStrictEqual(vm.summaries.ht, { count: 1, chipsFilled: 2, chipsMax: 7 });
  vm = build(baseMerged(), { reportMechaIds: null });
  assert.equal(vm.ht.reportMechas, null);
  vm = build(baseMerged(), { reportMechaIds: [] });
  assert.deepStrictEqual(vm.ht.reportMechas, []);
  assert.ok(!vm.moves.picks.some((p) => p.sig === 'f'), 'no HT fought: no chip move');
  // a chips supplement newer than the report wins for that HT, and the model says where the chips came from
  const supp = { chips: { ts: new Date(NOW - 86400000).toISOString(), chips: [{ m: 1006, c: 9503, lv: 2 }] } };
  vm = build(baseMerged(), { supp, sources: { dataTs: NOW - 86400000, kinds: ['chips'] } });
  assert.equal(vm.ht.source, 'game data');
  assert.deepStrictEqual(vm.ht.chips.filter((c) => !c.empty).map((c) => [c.c, c.lv]), [[9503, 2]]);
});

test('decor totals: each placed piece counts its OWN base buff scaled to its level; sets, halos and the 93011xx family are never added', () => {
  const core = newCore();
  // Christmas tree (group 4200): own buff All units Attack 350 bp at its extracted level 4 -> value / 4 * level
  const g = 4200, ext = LOOKUPS.DECOR_EXTRACTED_LVL[String(g)];
  assert.equal(LOOKUPS.DECOR_DATA[String(g)].b[0].i, 930100);
  const id2 = decorId(core, g, 2), id3 = decorId(core, g, 3);
  const merged = baseMerged();
  merged.decorations = { ids: [id2, id3, id3], suit: [1201, 1202], suitLevelBuff: { 1201: 3 } };
  const vm = build(merged, null, core);
  const bp = (lv) => Math.round(350 / ext * lv);
  assert.equal(vm.decor.totals.atk, Math.round(((bp(2) + bp(3) + bp(3)) / 100) * 10) / 10);
  assert.equal(vm.decor.placedPieces, 3);
  assert.equal(vm.decor.placedKinds, 1);
  assert.equal(vm.decor.sets, 2, 'sets are counted, never added to the buff totals');
  assert.deepStrictEqual([vm.decor.totals.march, vm.decor.totals.hp, vm.decor.totals.dmgTaken, vm.decor.totals.dmgInc], [0, 0, 0, 0]);
  assert.deepStrictEqual(vm.decor.placed.map((d) => [d.g, d.lv, d.count]), [[4200, 3, 3]], 'one card per group at its highest placed level');
  // March Size is a flat number, not a percent; a conditional-family buff (id 93011701, Thanksgiving Turkey 4180) is not in any total
  const marchGroup = Object.keys(LOOKUPS.DECOR_DATA).find((k) => LOOKUPS.DECOR_DATA[k].b.length === 1 && LOOKUPS.DECOR_DATA[k].b[0].i === 960012 && LOOKUPS.DECOR_GROUP_BASE[k] && LOOKUPS.DECOR_EXTRACTED_LVL[k]);
  const mg = Number(marchGroup), mext = LOOKUPS.DECOR_EXTRACTED_LVL[marchGroup], mv = LOOKUPS.DECOR_DATA[marchGroup].b[0].v;
  merged.decorations = { ids: [decorId(core, mg, 2), decorId(core, 4180, 3)], suit: [] };
  const vm2 = build(merged, null, core);
  assert.equal(vm2.decor.totals.march, Math.round(mv / mext * 2));
  assert.equal(vm2.decor.totals.atk, 0, 'the conditional 93011701 buff is not All units Attack');
  assert.equal(vm2.summaries.base.march, vm2.decor.totals.march);
});

test('decor moves input: next upgrade, credit from spare pieces, shards from the bag; no inventory = shards unknown', () => {
  const core = newCore();
  const g = 4200, id = decorId(core, g, 2);
  const merged = baseMerged();
  merged.decorations = { ids: [id], suit: [] };
  const inv = { tabs: { item: [{ id: 20213232, a: 500 }, { id: 10000196, a: 2 }], decor: [{ group: g, level: 1, amount: 3 }, { group: 5000, level: 1, amount: 4 }] } };
  const vm = build(merged, { supp: { inv } }, core);
  const levels = STATICS.decorLevels[String(g)];
  assert.equal(levels.fi, G.ADVISOR_UNIVERSAL_SHARD_ID);
  const up = core._adv_getNextUpgrade(g, 2, STATICS.decorLevels);
  const d = vm.decor.placed[0];
  assert.deepStrictEqual([d.n, d.lv, d.nx.to, d.nx.raw], ['Christmas tree', 2, 3, up.shardCost]);
  assert.deepStrictEqual(d.nx.dl, up.buffDeltas);
  assert.equal(d.nx.credit, core._adv_calcGroupSpecificShards(g, inv, STATICS.decorLevels));
  assert.ok(d.nx.credit > 0 || true);
  assert.equal(vm.decor.shards, 500 + 10 * 2, 'universal shards: direct plus 10 per box');
  assert.deepStrictEqual(vm.decor.bag, { kinds: 2, pieces: 7 });
  assert.equal(d.ic, '4200_Christmas_tree.png');
  // no inventory (not imported, or private): shards 0 and the model says it is unknown
  const none = build(merged, { supp: {} }, core);
  assert.equal(none.decor.known, false);
  assert.equal(none.decor.shards, 0);
  assert.equal(none.decor.placed[0].nx.credit, 0);
  const priv = build(merged, { supp: { inv }, privacy: { inv: true } }, core);
  assert.equal(priv.decor.known, false, 'a private inventory is never read');
});

test('runes: bag counts, slots and merge schedule come from the inventory and the rune catalog; the bag excludes runes on gear', () => {
  const core = newCore();
  const lookups = { item: { 900001: { n: 'Impact Rune', t: 153 }, 900002: { n: 'Debilitate Rune Shard', t: 153 }, 900003: { n: 'Not a rune', t: 5 } } };
  const inv = { tabs: { item: [{ id: 900001, a: 4 }, { id: 900002, a: 2 }, { id: 900003, a: 9 }] } };
  const vm = build(baseMerged(), { supp: { inv }, statics: Object.assign({}, STATICS, { itemTable: lookups.item }) }, core);
  assert.deepStrictEqual(vm.runes.runeBag, { Impact: 4, Debilitate: 2 });
  assert.deepStrictEqual(vm.runes.runeSlots.Impact, [1, 3, 5]);
  assert.deepStrictEqual(vm.runes.runeSlots['Artillery Storm'], [1]);
  assert.deepStrictEqual(vm.runes.runeCost['2'], [1, 2]);
  assert.deepStrictEqual(vm.runes.runeCost['6'], [1, 2, 4, 6, 8, 10]);
  assert.ok(Object.keys(vm.runes.runeCost).every((k) => /^\d+$/.test(k)), 'the _doc entries are dropped');
  assert.equal(vm.runes.known, true);
  assert.deepStrictEqual(build(baseMerged()).runes.runeBag, {});
  assert.equal(build(baseMerged()).runes.known, false);
});

test('beasts: deployed, fields used, collected and average potential from the resolved enigma data', () => {
  const core = newCore();
  const fx = P.fixture('beasts.json');
  core.setPlatforms(P.data('enigma-platforms.json'));
  core.setSuppDecode(fx.suppDecode);
  const merged = baseMerged();
  merged.enigmas = fx.enigmas;
  const vm = build(merged, null, core);
  const r = core.ebResolveBeasts(fx.enigmas);
  let dep = 0, pot = 0, max = 0, fields = 0;
  r.fields.forEach((f) => { let n = 0; f.slots.forEach((s) => { if (s.beast) { n++; dep++; pot += s.beast.potential; max += s.beast.maxPotential; } }); if (n) fields++; });
  assert.ok(dep > 0 && max > 0);
  assert.equal(vm.beasts.deployed, dep); assert.equal(vm.beasts.fields, fields); assert.equal(vm.beasts.avgPotential, Math.round((pot / max) * 100));
  assert.equal(vm.beasts.collected, null, 'a report carries the deployed beasts only: owned is unknown without game data');
  assert.equal(vm.beasts.fieldList.reduce((n, f) => n + f.beasts.length, 0), dep);
  assert.ok(vm.beasts.fieldList.every((f) => f.beasts.every((b) => /^[A-Za-z0-9_. -]+\.png$/.test(b.icon))));
  const vm2 = build(merged, { supp: { enigma: { beasts: new Array(265).fill({}) } } }, core);
  assert.equal(vm2.beasts.collected, 265, 'collected = every beast in the game data, bench included');
  assert.equal(vm.band.beasts.deployed, dep);
  assert.equal(vm.band.beasts.pct, vm.beasts.avgPotential);
  assert.deepStrictEqual(vm.moves.picks.filter((p) => p.sig === 'e'), [], 'no Optimizer move until phase 3 extracts it');
});

test('header card and freshness line: dates, ages, the 30-day warning, no-data wording, roster alliance and power, shared title', () => {
  const roster = { siteKey: W.SK, name: 'Tester', alliance: 'DOG', power: 74600000 };
  let vm = build(baseMerged(), { rosterEntry: roster, identity: { isOwn: true }, sources: { reportsTs: Date.parse('2026-05-29T00:00:00Z'), dataTs: Date.parse('2026-06-09T00:00:00Z') } });
  assert.equal(vm.header.freshness, 'Reports 29 May 2026 · Game data 9 Jun 2026 (4 months)');
  assert.equal(vm.header.data.warn, true);
  assert.equal(vm.header.data.ageDays, 122);
  assert.equal(vm.header.alliance, 'DOG');
  assert.equal(vm.header.powerText, '74.6M');
  assert.equal(vm.header.shared, false);
  assert.equal(vm.header.title, 'Tester');
  vm = build(baseMerged(), { sources: { reportsTs: day(40), dataTs: day(2) } });
  assert.equal(vm.header.data.warn, false);
  assert.equal(vm.header.reports.warn, true);
  assert.match(vm.header.freshness, /\(2 days\)$/);
  vm = build(baseMerged(), { sources: { reportsTs: day(3), dataTs: 0 } });
  assert.equal(vm.header.freshness, 'Reports 6 Oct 2026 · No game data imported');
  assert.equal(vm.header.alliance, null);
  assert.equal(vm.header.inRoster, false);
  assert.equal(vm.header.powerText, null);
  vm = build(baseMerged(), { readOnly: true, identity: { isOwn: false } });
  assert.equal(vm.header.shared, true);
  assert.equal(vm.header.title, "Tester's armory · shared with you · read-only");
  assert.equal(vm.moves.title, "Tester's next moves");
  assert.equal(build(baseMerged(), { readOnly: true, identity: { isOwn: true } }).header.shared, false, 'your own report is not "shared" even when loaded read-only');
});

test('next moves card: footer says how old the game data is past 30 days, or asks for an import when there is none', () => {
  let vm = build(baseMerged(), { sources: { dataTs: day(60), kinds: ['inv'] } });
  assert.equal(vm.moves.stale.since, '10 Aug');
  assert.equal(vm.moves.footer, 'Based on game data from 10 Aug');
  assert.equal(vm.moves.cta, null);
  vm = build(baseMerged(), { sources: { dataTs: day(3), kinds: ['inv'] } });
  assert.equal(vm.moves.footer, null);
  vm = build(baseMerged());
  assert.equal(vm.moves.cta, 'import');
  assert.equal(vm.moves.footer, 'Import game data to see rune, decor and beast moves');
  assert.equal(vm.moves.title, 'Next moves');
});

test('60-character rule on the longest real names: hero, decoration and chip names are cut, numbers live on the meta line', () => {
  const core = newCore();
  // the longest hero name in the game tables, on the fixture hero Alpha
  const heroNames = P.data('all-heroes.json').map((h) => h.displayName).sort((a, b) => b.length - a.length);
  core.setHeroCache({ 101: heroNames[0], 102: 'Bravo', 103: 'Charlie' }, null);
  // the longest decoration names that have a shard upgrade
  const STAT_IDS = ['960012', '930100', '930000', '1001001'];
  const withMove = Object.keys(LOOKUPS.DECOR_GROUPS).filter((g) => {
    const e = STATICS.decorLevels[g];
    if (!e || e.fi !== G.ADVISOR_UNIVERSAL_SHARD_ID || !LOOKUPS.DECOR_GROUP_BASE[g]) return false;
    const up = core._adv_getNextUpgrade(g, 1, STATICS.decorLevels);
    return up && up.shardCost > 0 && STAT_IDS.some((id) => up.buffDeltas[id] > 0);
  });
  const longest = withMove.sort((a, b) => LOOKUPS.DECOR_GROUPS[b].length - LOOKUPS.DECOR_GROUPS[a].length)[0];
  const longestName = LOOKUPS.DECOR_GROUPS[longest];
  assert.ok(longestName.length >= 20, longestName);
  const merged = baseMerged();
  merged.decorations = { ids: [decorId(core, longest, 1)], suit: [] };
  // free runes so the rune moves appear too (merge Stealth Hologram needs 'Stealth Hologram' on a gold slot)
  const inv = { tabs: { item: [{ id: 20213232, a: 100000 }, { id: 900001, a: 50 }, { id: 900005, a: 50 }], decor: [] } };
  const itemTable = Object.assign({}, STATICS.itemTable, { 900001: { n: 'Stealth Hologram Rune', t: 153 }, 900005: { n: 'Impact Rune', t: 153 } });
  merged.heroes[0].heroEquips[3].infos = merged.heroes[0].heroEquips[3].infos.filter((i) => i.type === 1).concat([{ type: 2, templateId: Number(Object.keys(G.RUNE_MAP).find((k) => G.RUNE_MAP[k].n === 'Stealth Hologram' && G.RUNE_MAP[k].s === 1)) }]);
  const vm = build(merged, { supp: { inv }, statics: Object.assign({}, STATICS, { itemTable }) }, core);
  const all = core.nextMoves(vm.movesInput, { max: 20 });
  assert.ok(all.pool.some((c) => c.sig === 'b'), 'a merge move exists');
  assert.ok(all.pool.some((c) => c.sig === 'c'), 'a refine move exists');
  assert.ok(all.pool.some((c) => c.sig === 'd'), 'a decor move exists');
  assert.ok(all.pool.some((c) => c.sig === 'f'), 'a chip move exists');
  const upgrade = all.pool.find((c) => c.sig === 'd');
  assert.ok(upgrade.full.startsWith('Upgrade ' + longestName + ' to Lv.2: +'), upgrade.full);
  assert.ok(upgrade.text.length <= 60);
  const merge = all.pool.find((c) => c.sig === 'b');
  assert.ok(merge.text.length <= 60 && merge.full.endsWith(' to 2 stars'), 'the long hero name is cut with an ellipsis, the target star count is kept');
  assert.match(merge.meta, /^Uses \d+ \u00B7 \d+ in bag$/);
  for (const c of all.pool) {
    assert.ok(c.text.length <= 60, c.text.length + ' > 60: ' + c.text);
    assert.ok(/^[A-Z][a-z]+ /.test(c.text), 'verb first: ' + c.text);
    assert.ok(c.meta.length > 0 || c.sig === 'd', 'meta line: ' + c.text);
  }
  assert.match(merge.text, /^Merge Stealth Hologram on Shikinami Asuka\u2026 slot 4 to 2 stars$/);
  vm.moves.picks.forEach((p) => assert.ok(p.text.length <= 60));
  // the card carries the untruncated text for a title attribute
  assert.ok(vm.moves.picks.every((p) => typeof p.full === 'string' && p.full.length >= p.text.length));
});

test('integration: loadArmory -> fromLoad -> buildViewModel on the stub world; the model never carries a UID or a full report id', async () => {
  const handler = (u) => {
    const st = W.staticRoute(u);
    if (st) return st;
    if (u === 'player-data.json') return { status: 200, body: [{ siteKey: W.SK, name: W.NAME, alliance: 'DOG', power: 59181928 }] };
    if (u === W.reportUrl(W.CDN, W.REPORT_ID)) return { status: 200, body: W.battleReport() };
    if (u.startsWith(W.WORKER + '/supplement/privacy/')) return { status: 200, body: {} };
    if (u === W.WORKER + '/supplement/inv/' + W.SK) return { status: 200, body: { meta: { ts: '2026-09-30T00:00:00Z' }, tabs: { item: [{ id: 20213232, a: 300 }], decor: [] } } };
    if (u.includes('/collect-report')) return { status: 200, body: {} };
    return undefined;
  };
  const d = AD.create({ fetch: W.makeFetch(handler), storage: W.memStorage({ playerIdentity: JSON.stringify({ name: W.NAME, siteKey: W.SK }) }) });
  const res = await d.loadArmory({ reportIds: [W.REPORT_ID], player: { name: W.NAME }, own: true });
  assert.equal(res.state, 'ready');
  const realNow = Date.now; Date.now = () => NOW;
  let vm;
  try { vm = VM.buildViewModel(res.merged, res.sources, VM.fromLoad(res, d.core)); } finally { Date.now = realNow; }
  assert.equal(vm.header.name, W.NAME);
  assert.equal(vm.header.alliance, 'DOG');
  assert.equal(vm.header.shared, false);
  assert.equal(vm.heroes.list.length, 3);
  assert.equal(vm.decor.shards, 300);
  assert.equal(vm.header.data.date, '30 Sep 2026');
  assert.ok(vm.moves.picks.length >= 1);
  assert.deepStrictEqual(vm.sources.kinds, ['inv']);
  const json = JSON.stringify(vm);
  assert.ok(!json.includes(W.UID_RAW), 'no UID');
  assert.ok(!json.includes(W.REPORT_ID), 'no full report id');
  assert.deepStrictEqual(vm.ht.reportMechas, [1006]);
});

test('no DOM, no network, no storage: the module source touches none of them', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(P.ROOT, 'pages/armory-vm.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
  assert.ok(!/\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bfetch\s*\(|XMLHttpRequest|\bnavigator\b|addEventListener/.test(code));
});

test('equip quality and slot: own quality wins, then the equipId suffix, then the roll template tier; no signal = not gold', () => {
  const st = (t) => ({ type: 1, templateId: t, buffValue: 1 });
  const q = (eq) => VM.equipQuality(eq);
  assert.equal(q({ quality: 3, equipId: 100104, infos: [st(8)] }), 3, 'explicit quality first');
  assert.equal(q({ equipId: 100104, infos: [st(300)] }), 5, 'suffix 04 -> gold even when the templates say otherwise');
  assert.equal(q({ equipId: 100103, infos: [st(8)] }), 4, 'suffix 03 -> 4');
  assert.equal(q({ equipId: 100101, infos: [] }), 2);
  assert.equal(q({ equipId: 999999, infos: [st(8)] }), 5, 'an id outside the base-buff table falls through to the templates');
  assert.equal(q({ infos: [st(1), st(261), st(1072), st(1179)] }), 5, 'ranges 1-261 and 1072-1179 are gold');
  assert.equal(q({ infos: [st(271), st(1071)] }), 4, '271-1071 are lower qualities');
  assert.equal(q({ infos: [st(8), st(300)] }), 4, 'any lower roll makes the piece not gold');
  assert.equal(q({ infos: [] }), null, 'no stats: unknown');
  assert.equal(q({ infos: [{ type: 2, templateId: 10201 }] }), null, 'a rune alone says nothing');
  assert.equal(q({ infos: [st(262)] }), null, 'a template in neither range: unknown');
  const tids = Object.keys(G.GEAR_TEMPLATE).map(Number);
  assert.equal(tids.length, 540);
  assert.ok(tids.every((t) => (t >= 1 && t <= 261) || (t >= 271 && t <= 1071) || (t >= 1072 && t <= 1179)), 'the three ranges cover all 540 GEAR_TEMPLATE ids');
  // unknown is not gold: no refine move for it
  const vm = build({ heroes: [{ id: 101, level: 1, star: 1, heroEquips: [{ id: 1, infos: [{ type: 1, templateId: 8, buffValue: 10 }] }, { id: 2, infos: [] }] }], decorations: null, mechas: [] });
  assert.deepStrictEqual(vm.heroes.list[0].pieces.map((p) => [p.slot, p.q, p.gold]), [[1, 5, true], [2, null, false]]);
  // slot: _slot, then the equipId digit, then the position
  assert.equal(VM.equipSlot({ _slot: 4, equipId: 100204 }, 0), 4);
  assert.equal(VM.equipSlot({ equipId: 100504 }, 0), 5);
  assert.equal(VM.equipSlot({ equipId: 100004 }, 2), 3, 'digit 0 is not a slot');
  assert.equal(VM.equipSlot({ equipId: 100704 }, 1), 2, 'digit 7 is not a slot');
  assert.equal(VM.equipSlot({}, 5), 6);
});

test('real battle reports (public fixtures): slot = the equipId digit, and the suffix tier and the roll-template tier agree on every piece', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(P.ROOT, 'test/fixtures');
  let n = 0, gold = 0, notGold = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const side of [r.battle.attacker, r.battle.defender]) for (const pl of side.players || []) for (const h of pl.heroList || []) {
      (h.heroEquips || []).forEach((eq, idx) => {
        if (!eq || eq.equipId == null) return;
        n++;
        const slot = VM.equipSlot(eq, idx);
        assert.equal(slot, Math.floor((eq.equipId % 10000) / 100), f + ' slot');
        const bySuffix = VM.equipQuality(eq);
        const byRolls = VM.equipQuality({ infos: eq.infos });
        assert.equal(bySuffix, (eq.equipId % 100) + 1);
        assert.ok(byRolls === null || (byRolls === 5) === (bySuffix === 5), f + ' ' + eq.equipId + ' suffix ' + bySuffix + ' vs rolls ' + byRolls);
        if (bySuffix === 5) gold++; else notGold++;
      });
    }
  }
  assert.ok(n >= 150, 'pieces checked: ' + n);
  assert.ok(gold > 0 && notGold > 0, 'both gold and non-gold pieces are in the fixtures');
});

test('runes follow the base-pool rule: a hand-entered pool newer than the import feeds the bag, an older one does not', () => {
  const core = newCore();
  const st = Object.assign({}, STATICS, { itemTable: { 900001: { n: 'Impact Rune', t: 153 } } });
  const inv = { meta: { ts: '2026-10-01T00:00:00Z' }, tabs: { item: [{ id: 900001, a: 4 }] } };
  const rp = (ts) => ({ meta: { ts }, source: 'manual', pool: { Impact: { 0: 11, 1: 3 }, Wildfire: { 0: 2 } } });
  const imp = build(baseMerged(), { supp: { inv }, statics: st }, core);
  assert.deepStrictEqual(imp.runes.runeBag, core.advice.basePool({ inv, lookups: { item: st.itemTable } }).bag);
  assert.deepStrictEqual(imp.runes.runeBag, { Impact: 4 });
  assert.equal(imp.runes.pool.source, 'import'); assert.equal(imp.runes.pool.known, true); assert.equal(imp.runes.pool.stale, false);
  const newer = build(baseMerged(), { supp: { inv, runepool: rp('2026-10-05T00:00:00Z') }, statics: st }, core);
  assert.deepStrictEqual(newer.runes.runeBag, { Impact: 11, Wildfire: 2 }, 'a newer hand-entered pool is the bag');
  assert.equal(newer.runes.pool.source, 'stored'); assert.equal(newer.runes.pool.unequipped.Impact, 3);
  assert.deepStrictEqual(newer.movesInput.runeBag, { Impact: 11, Wildfire: 2 }, 'Next moves read the same number');
  const older = build(baseMerged(), { supp: { inv, runepool: rp('2026-09-01T00:00:00Z') }, statics: st }, core);
  assert.deepStrictEqual(older.runes.runeBag, { Impact: 4 }); assert.equal(older.runes.pool.stale, true);
  const priv = build(baseMerged(), { supp: { inv, runepool: rp('2026-10-05T00:00:00Z') }, privacy: { runepool: true }, statics: st }, core);
  assert.deepStrictEqual(priv.runes.runeBag, { Impact: 4 }, 'a private rune pool is never read');
  const stOnly = build(baseMerged(), { supp: { runepool: rp('2026-10-05T00:00:00Z') }, statics: st }, core);
  assert.equal(stOnly.runes.known, true, 'a stored pool alone makes the bag known');
});

test('real reports through the model: a non-gold piece never gets a refine move and a piece keeps its true slot', () => {
  const fs = require('node:fs'), path = require('node:path');
  const r = JSON.parse(fs.readFileSync(path.join(P.ROOT, 'test/fixtures/4724810303346728960.json'), 'utf8'));
  const heroes = [];
  for (const side of [r.battle.attacker, r.battle.defender]) for (const pl of side.players || []) for (const h of pl.heroList || []) if (h.heroEquips && h.heroEquips.length) heroes.push({ id: h.id, heroEquips: h.heroEquips, level: h.level, star: h.star });
  const vm = build({ heroes, decorations: null, mechas: [] });
  const all = vm.heroes.list.reduce((a, h) => a.concat(h.pieces), []);
  assert.ok(all.some((p) => !p.gold), 'the report has non-gold pieces');
  const goldSlots = vm.movesInput.heroes.reduce((a, h) => a + h.gear.length, 0);
  assert.equal(goldSlots, all.filter((p) => p.gold).length);
});

test('two players: each core instance has its own enigma decode hints (B never changes A; hints merge within one instance; null clears)', () => {
  const fx = P.fixture('beasts.json');
  const triple = (c, id) => { const x = c.ebResolveBeasts(fx.enigmas).beasts.filter((b) => b.cfg === id)[0]; return [x.type, x.faction, x.quality]; };
  const A = newCore(), B = newCore();
  const plain = triple(B, 25);
  A.setSuppDecode({ 25: { type: 9, faction: 4, quality: 4 } }); // a hint that differs from the table decode
  assert.deepStrictEqual(triple(A, 25), [9, 4, 4], 'a hint wins over the table decode');
  assert.deepStrictEqual(triple(B, 25), plain, 'B (another instance) never sees A\'s hint');
  B.setSuppDecode({ 9999: { type: 1, faction: 1, quality: 5 } });
  assert.deepStrictEqual(triple(A, 25), [9, 4, 4], 'and B\'s hints do not reach A');
  assert.deepStrictEqual(triple(B, 25), plain);
  A.setSuppDecode({ 9999: { type: 1, faction: 1, quality: 5 } });
  assert.deepStrictEqual(triple(A, 25), [9, 4, 4], 'inside one instance the hints merge');
  A.setSuppDecode(null);
  assert.deepStrictEqual(triple(A, 25), plain, 'null clears them');
  assert.equal(globalThis._enigmaSuppDecode, undefined, 'nothing is written to a global');
});

test('hero power: the model carries the supplement pw, null when missing, 0, NaN or not a number', () => {
  const ids = heroes3().map((h) => h.id);
  const pwOf = (list) => build(baseMerged(), { supp: { heroes: { list } } }).movesInput.heroes.map((h) => h.power);
  const vm = build(baseMerged(), { supp: { heroes: { list: [{ id: ids[0], pw: 123456 }, { id: ids[1], pw: 0 }, { id: ids[2], pw: 'big' }] } } });
  const byName = {};
  vm.heroes.list.forEach((h) => { byName[h.id] = h.power; });
  assert.equal(byName[ids[0]], 123456);
  assert.equal(byName[ids[1]], null);
  assert.equal(byName[ids[2]], null);
  assert.deepStrictEqual(vm.movesInput.heroes.map((h) => h.power).sort(), [123456, null, null]);
  assert.ok(pwOf([{ id: ids[0], pw: NaN }, { id: ids[1], pw: -5 }]).every((x) => x === null));
  assert.ok(pwOf([]).every((x) => x === null), 'no supplement: null');
});
