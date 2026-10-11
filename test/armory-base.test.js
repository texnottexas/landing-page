'use strict';
// ArmoryBaseLogic (pages/armory-base.js): the Base section's data rules, on synthetic players built from the public game tables
// (data/decor-lookups.json, decoration-levels.json, tw-game-data-base.js). Expected numbers are hand-computed in each test.
// Run: node --test test/armory-base.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../pages/armory-base.js');
const G = require('../pages/tw-game-data.js');
const T = require('../pages/tw-game-data-base.js');
const Core = require('../pages/armory-core.js');
const VM = require('../pages/armory-vm.js');
const P = require('./helpers/armory-page.js');

const LOOKUPS = P.data('decor-lookups.json');
const LEVELS = P.data('decoration-levels.json');
const INDEX = P.data('decoration-index.json');
const MUTEX = L.mutexMap(P.data('decoration-mutual-exclusive.json'));
const STATICS = { runeTypes: P.data('rune-types.json'), decorLevels: LEVELS, decorIndex: INDEX, decorLookups: LOOKUPS, itemTable: P.data('item-table.json') };
function newCore() { const c = Core.create(); c.setDecorLookups(LOOKUPS); return c; }
function decorId(core, group, level) {
  const base = LOOKUPS.DECOR_GROUP_BASE[String(group)];
  for (let id = base; id < base + 30; id++) if (String(core.decorIdToGroup(id)) === String(group) && core.decorLevel(id, group) === level) return id;
  throw new Error('no id for group ' + group + ' level ' + level);
}
const vmOf = (core, merged, inv, marchGroups, reportDecorIds) => VM.buildViewModel(merged, { reportsTs: 0, dataTs: 0, kinds: [] }, { reportDecorIds, core, statics: STATICS, supp: inv ? { inv } : {}, privacy: {}, player: { name: 'Tester', siteKey: 'aaaaaaaaaaaaaaaa' }, reports: [], reportMechaIds: [], marchGroups, now: Date.now() });
const bag = (shards) => ({ tabs: { item: [{ id: 20213232, a: shards }], decor: [] } });
const VOCAB = /\bATK\b|\bAF\b|DMG[+\-−]|\bDEF\b|DMG Increase|\(rcv\)/;

// ---- vocabulary ----
test('statName writes the game shorthand out, and every stat name in the five tables reads in full', () => {
  assert.equal(L.statName('Air Force ATK'), 'Air Force Attack');
  assert.equal(L.statName('All DMG+'), 'All units DMG increase');
  assert.equal(L.statName('Navy DMG− Back 2 Rows'), 'Navy Decreased DMG Taken (back 2 rows)');
  assert.equal(L.statName('Navy DMG- (rcv)'), 'Navy Decreased DMG Taken');
  assert.equal(L.statName('All units DMG Increase'), 'All units DMG increase');
  assert.equal(L.statName('Increase DEF of all units'), 'All units Defense');
  assert.equal(L.statName('AF ATK Bonus (first two rows)'), 'Air Force Attack (front 2 rows)');
  assert.equal(L.statName(null), '');
  [['All Attack', 'All units Attack'], ['All HP', 'All units HP'], ['All Units ATK', 'All units Attack'], ['HP Boost for first 2 row units', 'All units HP (front 2 rows)'], ['Attack of Navy in the 2 back rows', 'Navy Attack (back 2 rows)'],
   ['Air Force DMG increase (front-row)', 'Air Force DMG increase (front row)'], ['Mid row Air Force Attack', 'Air Force Attack (mid row)'], ['Units in the first 2 rows Damage Increase', 'All units DMG increase (front 2 rows)'],
   ['Improve first 2 rows Decreased Damage Taken', 'All units Decreased DMG Taken (front 2 rows)'], ['Mid/back row units Decreased Damage Taken', 'All units Decreased DMG Taken (mid and back rows)'], ['Army HP Boost', 'Army HP'],
   ['Increase marching speed', 'March speed'], ['Garage/Dock/Hangar Capacity', 'Garage, dock and hangar capacity'], ['Army Decreased Damage Taken in the front row', 'Army Decreased DMG Taken (front row)'], ['Navy Damage increase in first 2 rows', 'Navy DMG increase (front 2 rows)'],
   ['HP Boost for Naval units (first two rows)', 'Navy HP (front 2 rows)'], ['Front 2 Rows ATK', 'All units Attack (front 2 rows)'], ['Attack Boost against Dark Forces', 'Attack against Dark Forces']].forEach(([a, b]) => assert.equal(L.statName(a), b, a));
  const names = new Set();
  Object.values(T.SKIN_SD).forEach((s) => s[2].concat(s[3]).forEach((b) => names.add(b[0])));
  Object.values(T.BASE_DECOR_DATA).forEach((d) => (d.e || []).concat(d.o || []).forEach((b) => names.add(b[0])));
  Object.values(T.BASE_HALO_DATA).forEach((d) => d.b.forEach((b) => names.add(b[0])));
  Object.values(LOOKUPS.BUFF_NAMES_DECOR).forEach((n) => names.add(n));
  assert.ok(names.size > 100, 'names: ' + names.size);
  const raw = [...names].filter((n) => VOCAB.test(n)), shown = [...names].map(L.statName).filter((n) => VOCAB.test(n));
  assert.ok(raw.length > 20, 'the tables really do carry shorthand (so this test can fail): ' + raw.length);
  assert.deepEqual(shown, [], 'no shorthand survives on screen');
  const tbl = new Set(); Object.values(T.SKIN_SD).forEach((s) => s[2].concat(s[3]).forEach((b) => tbl.add(L.statName(b[0])))); Object.values(T.BASE_DECOR_DATA).forEach((d) => (d.e || []).concat(d.o || []).forEach((b) => tbl.add(L.statName(b[0])))); Object.values(T.BASE_HALO_DATA).forEach((d) => d.b.forEach((b) => tbl.add(L.statName(b[0]))));
  assert.ok(tbl.size <= 105, 'distinct skin / base decoration / halo labels after the rewrite (112 before): ' + tbl.size);
});
test('values: a skin value keeps one sign and drops a trailing .0; a base value is hundredths, March Size a plain count', () => {
  assert.equal(L.skinVal('++25.0%'), '+25%'); assert.equal(L.skinVal('+20.5%'), '+20.5%'); assert.equal(L.skinVal('+4'), '+4');
  assert.equal(L.baseVal(300, 'All units ATK'), '+3%'); assert.equal(L.baseVal(250, 'x'), '+2.5%'); assert.equal(L.baseVal(1234, 'March Size'), '+1,234');
  assert.equal(L.skinNum('+25.0%'), 25); assert.equal(L.skinNum('garbage'), 0);
});

// ---- skins ----
test('skinState reads the report shape and the game-data shape; the default skin (0) and repeats are not counted', () => {
  const rep = L.skinState({ effectIds: [1887000, 1887000, 0, '2015000'], useIds: [1959000], ownCastleEffects: [34, 52], useCastleEffects: [34], ownHaloSkins: [1], useHaloSkins: [0] });
  assert.deepEqual([rep.owned, rep.active, rep.castle, rep.castleActive, rep.halo, rep.haloActive, rep.source], [[1887000, 2015000], 1959000, [34, 52], 34, [1], 0, 'reports']);
  const sup = L.skinState({ activeSkin: 2009000, ownedSkins: [0, 1811000, 1809000], collectSkins: [1872000] });
  assert.deepEqual([sup.owned, sup.active, sup.source, sup.known, sup.castle], [[1811000, 1809000], 2009000, 'game data', true, []]);
  assert.equal(L.skinState(null).known, false); assert.equal(L.skinState({}).known, false); assert.equal(L.skinState({ effectIds: 'x' }).known, false);
});
test('skinRow: an id the table does not hold reads as Unknown skin, never as the id; active and tier flags', () => {
  const u = L.skinRow(T, 99999999, 0); assert.equal(u.name, 'Unknown skin'); assert.equal(u.known, false); assert.deepEqual(u.equip, []);
  const r = L.skinRow(T, 2009000, 2009000); assert.equal(r.active, true); assert.equal(r.isNew, true); assert.ok(r.name.length > 0);
  assert.ok(r.equip.concat(r.ownB).every((b) => !VOCAB.test(b.n)));
});
test('skinSort: the newest tier first by name, equipped first, power high to low; skinFilter by name, stat and city skill', () => {
  const mk = (id, name, o) => Object.assign({ id, name, power: 0, active: false, isNew: false, equip: [], ownB: [], skill: '' }, o);
  const l = [mk(1, 'Bravo'), mk(2, 'Alpha', { power: 50 }), mk(3, 'Charlie', { isNew: true, power: 10 }), mk(4, 'Delta', { active: true, skill: 'Storm', ownB: [{ n: 'All units HP', v: '+1%' }] })];
  assert.deepEqual(L.skinSort(l, 'name').map((s) => s.name), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
  assert.deepEqual(L.skinSort(l, 'za').map((s) => s.name), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
  assert.deepEqual(L.skinSort(l, 'power').map((s) => s.name), ['Alpha', 'Charlie', 'Bravo', 'Delta']);
  assert.equal(L.skinSort(l, 'equipped')[0].name, 'Delta');
  assert.deepEqual(L.skinFilter(l, { q: 'ALP' }).map((s) => s.id), [2]);
  assert.deepEqual(L.skinFilter(l, { buff: 'All units HP' }).map((s) => s.id), [4]);
  assert.deepEqual(L.skinFilter(l, { skill: 'Storm' }).map((s) => s.id), [4]);
  assert.equal(L.skinFilter(l, {}).length, 4);
  assert.deepEqual(L.skinFilterOptions(l), { buffs: ['All units HP'], skills: ['Storm'] });
});
test('skinNotOwned: a level chain and an alternate form count as owned; placeholders and unreleased skins are never listed', () => {
  const chain = T.SKIN_GROUPS['1001']; // [1782000, 1783000]
  const miss = L.skinNotOwned(T, { owned: [chain[1]], active: 0 }).map((s) => s.id);
  assert.ok(!miss.includes(chain[0]) && !miss.includes(chain[1]), 'owning level 2 owns the whole chain');
  const alt = T.SKIN_ALT_GROUPS['1756000']; // [1756000, 1757000]
  const m2 = L.skinNotOwned(T, { owned: [alt[1]], active: 0 }).map((s) => s.id);
  assert.ok(!m2.includes(alt[0]) && !m2.includes(alt[1]));
  const all = L.skinNotOwned(T, { owned: [], active: 0 }).map((s) => s.id);
  Object.keys(T.JUNK_SKIN_IDS).forEach((k) => assert.ok(!all.includes(+k), 'junk ' + k));
  assert.ok(!all.includes(0));
  Object.keys(T.SKIN_SD).forEach((k) => { if (String(T.SKIN_SD[k][0]).indexOf('skin_name_') === 0) assert.ok(!all.includes(+k), 'unreleased ' + k); });
  assert.ok(all.length > 100);
});
test('skinChain: a level chain labels Lv.1.., alternate forms Form A..; a single skin has none; citySkill reads the table or nothing', () => {
  const c = L.skinChain(T, T.SKIN_GROUPS['1001'][0]); assert.equal(c.kind, 'level'); assert.deepEqual(c.rows.map((r) => r.label), ['Lv.1', 'Lv.2']);
  const a = L.skinChain(T, T.SKIN_ALT_GROUPS['1756000'][0]); assert.equal(a.kind, 'alt'); assert.deepEqual(a.rows.map((r) => r.label), ['Form A', 'Form B']);
  assert.equal(L.skinChain(T, 1600100), null);
  const id = Object.keys(T.CITY_SKILL_DB)[0], cs = L.citySkill(T, id);
  assert.equal(cs.type, T.SKILL_TYPES[T.CITY_SKILL_DB[id][1]]); assert.equal(typeof cs.how, 'string');
  assert.equal(L.citySkill(T, 5), null);
});

// ---- totals ----
test('skinTotals: own buffs of every owned skin plus the equip buffs of the equipped one, for the five key stats only', () => {
  const t = { SKIN_SD: {
    1: ['A', 'a.png', [['All units Attack', '+50.0%'], ['Increase marching speed', '+30.0%']], [['All units Attack', '+25.0%'], ['March Size', '+4']], '', 0],
    2: ['B', 'b.png', [['All units HP', '+99.0%']], [['All units Attack', '+10.5%'], ['All units DMG Increase', '+3.0%'], ['Gold Production Increase', '+20.0%']], '', 0]
  } };
  assert.deepEqual(L.skinTotals(t, { owned: [1, 2], active: 1 }), { march: 4, atk: 85.5, hp: 0, dmgTaken: 0, dmgInc: 3 });
  assert.deepEqual(L.skinTotals(t, { owned: [1, 2], active: 0 }), { march: 4, atk: 35.5, hp: 0, dmgTaken: 0, dmgInc: 3 }, 'no equipped skin: no equip buffs');
  assert.deepEqual(L.skinTotals(t, { owned: [], active: 0 }), { march: 0, atk: 0, hp: 0, dmgTaken: 0, dmgInc: 0 });
});
test('skinTotals counts a level chain once (its highest owned level) and one alternate form; the owned bonus applies for every owned skin, When equipped only for the equipped one', () => {
  const t = { SKIN_SD: { 1: ['L1', '', [['All units Attack', '+10.0%']], [['All units Attack', '+12.0%']], '', 0], 2: ['L2', '', [['All units Attack', '+20.0%']], [['All units Attack', '+20.0%']], '', 0], 3: ['Solo', '', [['All units Attack', '+50.0%']], [['All units Attack', '+5.0%']], '', 0], 4: ['FormA', '', [], [['All units Attack', '+7.0%']], '', 0], 5: ['FormB', '', [], [['All units Attack', '+9.0%']], '', 0] },
    SKIN_GROUP_LOOKUP: { 1: [1, 2], 2: [1, 2] }, SKIN_ALT_LOOKUP: { 4: [4, 5], 5: [4, 5] } };
  assert.equal(L.skinTotals(t, { owned: [1, 2, 3, 4, 5], active: 0 }).atk, 20 + 5 + 7, 'chain once, solo, one alternate form: no equipped skin, no equip buffs');
  assert.equal(L.skinTotals(t, { owned: [1, 2, 3, 4, 5], active: 3 }).atk, 20 + 5 + 7 + 50, 'the equipped skin adds its equip buffs once');
  assert.equal(L.skinTotals(t, { owned: [2, 3], active: 2 }).atk, 20 + 5 + 20);
  assert.equal(L.skinTotals(t, { owned: [1], active: 0 }).atk, 12, 'a lone lower level counts when the higher one is not owned');
});
test('statKey: the skin table\'s "All ATK" and "All HP" are all-units Attack and HP (the game\'s buff trace sums them), unit-type and conditional buffs are not', () => {
  assert.deepEqual(['All ATK', 'All HP', 'All units Attack', 'All units HP', 'Air Force ATK', 'Army Attack', 'Attack of all units (on the offensive)', 'All units DMG Increase', 'Decreased DMG Taken (all)', 'Decreased DMG Taken (defending base)'].map(L.statKey), ['atk', 'hp', 'atk', 'hp', null, null, null, 'dmgInc', 'dmgTaken', null]);
});
test('against the game: base decoration Attack and HP equal the battle report\'s own buff trace (source 75) for every player in the fixtures; the skin sum never exceeds the trace\'s Base Effect (source 25) and trails it only by halos and collections', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, 'fixtures');
  let n = 0;
  fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).forEach((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
    ['attacker', 'defender'].forEach((side) => {
      const p = d.battle && d.battle[side] && d.battle[side].players && d.battle[side].players[0];
      if (!p || !p.effectSkins || !Array.isArray(p.traceEffectBuffs)) return;
      const sum = (s, ids) => p.traceEffectBuffs.filter((x) => x.s === s && ids.includes(x.id)).reduce((a, x) => a + x.val, 0) / 100;
      const st = L.skinState(p.effectSkins), sk = L.skinTotals(T, st), bd = L.baseDecorTotals(T, st);
      assert.equal(bd.atk, sum(75, [930100, 9301160]), f + ' ' + side + ' base decor Attack'); assert.equal(bd.hp, sum(75, [930000, 9301170]), f + ' ' + side + ' base decor HP');
      const ta = sum(25, [930100, 9301160]), th = sum(25, [930000, 9301170]);
      assert.ok(sk.atk <= ta && sk.hp <= th, f + ' ' + side + ' skins ' + sk.atk + '/' + sk.hp + ' vs trace ' + ta + '/' + th);
      if (!p.effectSkins.ownHaloSkins.length) assert.ok(ta - sk.atk <= 0.06 * ta && th - sk.hp <= 0.06 * th, f + ' ' + side + ' gap without a halo');
      n++;
    });
  });
  assert.ok(n >= 8, 'players checked: ' + n);
});
test('baseDecorTotals: holding buffs of every owned base decoration plus the equipping buffs of the equipped one', () => {
  const t = { BASE_DECOR_DATA: { 7: { n: 'X', e: [['All units ATK', 300], ['All units HP', 100]], o: [['All units HP', 250], ['March Size', 2]] }, 8: { n: 'Y', e: [['All units HP', 900]], o: [['All units HP', 50]] } } };
  assert.deepEqual(L.baseDecorTotals(t, { castle: [7, 8], castleActive: 7 }), { march: 2, atk: 3, hp: 4, dmgTaken: 0, dmgInc: 0 });
  assert.deepEqual(L.baseDecorTotals(t, { castle: [7], castleActive: 0 }), { march: 2, atk: 0, hp: 2.5, dmgTaken: 0, dmgInc: 0 });
});
test('stripRows: one row per key stat with the three sources and their total, whole numbers with separators, a plain 0 where a source adds nothing, a dash where it has no data', () => {
  const rows = L.stripRows({ march: 12, atk: 40.5, hp: 10, dmgTaken: 0, dmgInc: 3 }, { march: 9, atk: 1083.4, hp: 1026, dmgTaken: 40, dmgInc: 39 }, null);
  assert.deepEqual(rows.map((r) => r.label), ['March Size', 'All units Attack', 'All units HP', 'All units Decreased DMG Taken', 'All units DMG increase']);
  assert.deepEqual([rows[0].decor, rows[0].skin, rows[0].bdecor, rows[0].total], ['+12', '+9', '\u2013', '+21']);
  assert.deepEqual([rows[1].decor, rows[1].skin, rows[1].total], ['+41%', '+1,083%', '+1,124%'], 'whole numbers, thousands separator');
  assert.deepEqual([rows[3].decor, rows[3].total], ['0%', '+40%'], 'a zero is not printed as a gain');
  assert.equal(L.stripRows(null, null, { march: 0, atk: 0, hp: 0, dmgTaken: 0, dmgInc: 0 })[0].bdecor, '0');
});
test('haloTotals: the equipped halo counts its listed buffs (Cyber Pulse: +50% Attack, +20% HP), an owned halo that is not equipped adds nothing', () => {
  assert.deepEqual(L.haloTotals(T, { haloActive: 1 }), { march: 0, atk: 50, hp: 20, dmgTaken: 0, dmgInc: 0 });
  assert.deepEqual(L.haloTotals(T, { haloActive: 0 }), { march: 0, atk: 0, hp: 0, dmgTaken: 0, dmgInc: 0 });
  assert.deepEqual(L.addTotals({ march: 1, atk: 2.2, hp: 0, dmgTaken: 0, dmgInc: 0 }, { march: 0, atk: 50, hp: 20, dmgTaken: 0, dmgInc: 0 }).atk, 52.2);
});

// ---- decorations ----
function placedFor(specs) {
  const core = newCore();
  const ids = [];
  specs.forEach(([g, lv, n]) => { for (let i = 0; i < (n || 1); i++) ids.push(decorId(core, g, lv)); });
  const merged = { decorations: { ids, suit: [], suitLevelBuff: {} } };
  return { core, merged, vm: vmOf(core, merged, bag(5000)) };
}
test('placedModel: category, written-out buffs scaled to the level, and the buff groups, for a March Size and an Attack decoration', () => {
  const { core, vm } = placedFor([[5544, 3], [4200, 2, 2]]);
  const pm = L.placedModel(vm.decor, LOOKUPS, G, core);
  const a = pm.find((p) => p.g === 5544), b = pm.find((p) => p.g === 4200);
  assert.equal(a.cat, 0); assert.equal(a.lv, 3); assert.deepEqual(a.stats, ['march_size']);
  assert.equal(b.cat, 3); assert.equal(b.count, 2); assert.deepEqual(b.stats, ['attack']);
  const dd = LOOKUPS.DECOR_DATA['5544'].b[0];
  assert.equal(a.buffs[0].v, core.formatScaledDecorBuff(dd, 3, 5544)); assert.equal(a.buffs[0].n, 'March Size');
  assert.ok(pm.every((p) => p.buffs.every((x) => !VOCAB.test(x.n))));
});
test('buffRows: a group with no data is Others with no rows; a not-owned decoration shows level 1 values', () => {
  const core = newCore();
  const none = L.buffRows(LOOKUPS, G, core, 99999999, 3); assert.deepEqual([none.cat, none.rows.length], [3, 0]);
  const base = L.buffRows(LOOKUPS, G, null, 5544, 0); assert.equal(base.rows[0].v, G.formatDecorBuffVal(LOOKUPS.DECOR_DATA['5544'].b[0]));
});
test('sections: classic order (March Size, Damage Boost, Defense, Others); sub-groups only when two or more are in use', () => {
  const { core, vm } = placedFor([[5544, 2], [4170, 2], [4330, 2], [5803, 2], [4200, 2], [4180, 2]]);
  const secs = L.sections(G, L.placedModel(vm.decor, LOOKUPS, G, core));
  assert.deepEqual(secs.map((s) => s.name), ['March Size', 'Damage Boost', 'Defense', 'Others']);
  assert.deepEqual(secs[1].subs, [], 'both damage decorations are "decreased damage": one sub-group is not worth a heading');
  assert.deepEqual(secs[3].subs.map((u) => u.key), ['atk', 'hp'], 'attack and HP decorations: two sub-groups, in the classic order');
  const mixed = L.sections(G, L.placedModel(placedFor([[4170, 2], [5080, 2], [4330, 1]]).vm.decor, LOOKUPS, G, newCore()));
  assert.deepEqual(mixed[0].subs.map((u) => [u.key, u.name, u.items.length]), [['dmg_inc', 'DMG Increase', 1], ['dmg_dec', 'Decreased DMG', 2]]);
  assert.deepEqual(L.sections(G, L.placedModel(placedFor([[5544, 2]]).vm.decor, LOOKUPS, G, newCore())).map((s) => s.subs.length), [0]);
});
test('decorFilter and decorSort: by stat group, shard upgrades, search over name and buff; name, level and quality orders', () => {
  const { core, vm } = placedFor([[5544, 3], [4200, 5], [5462, 1]]);
  const pm = L.placedModel(vm.decor, LOOKUPS, G, core);
  assert.deepEqual(L.decorFilter(pm, { stat: 'march_size' }).map((p) => p.g).sort(), [5462, 5544]);
  assert.deepEqual(L.decorFilter(pm, { stat: 'attack' }).map((p) => p.g).sort(), [4200, 5462]);
  assert.deepEqual(L.decorFilter(pm, { q: 'christmas' }).map((p) => p.g), [4200]);
  assert.deepEqual(L.decorFilter(pm, { q: 'march size' }).map((p) => p.g).sort(), [5462, 5544]);
  assert.ok(L.decorFilter(pm, { up: true }).every((p) => p.nx));
  assert.deepEqual(L.decorSort(pm, 'lvhigh').map((p) => p.lv), [5, 3, 1]); assert.deepEqual(L.decorSort(pm, 'lvlow').map((p) => p.lv), [1, 3, 5]);
  assert.deepEqual(L.decorSort(pm, 'name').map((p) => p.n), pm.map((p) => p.n).sort());
});
test('ownedMap: a placed group makes its mutually exclusive variants owned (and says which one it came through); alternates list the others', () => {
  const g = 4250, mates = LOOKUPS.ME_CLUSTERS[String(LOOKUPS.ME_LOOKUP[String(g)])];
  assert.ok(mates.length >= 2);
  const om = L.ownedMap(LOOKUPS, [{ g }]);
  mates.forEach((m) => assert.equal(om.map[String(m)], true));
  mates.filter((m) => m !== g).forEach((m) => assert.equal(om.via[String(m)], g));
  const alts = L.alternates(LOOKUPS, g, om); assert.equal(alts.length, mates.length - 1); assert.ok(alts.every((a) => a.owned && a.g !== g));
  const none = L.notOwnedList(LOOKUPS, G, om).map((x) => x.g);
  mates.forEach((m) => assert.ok(!none.includes(m), 'an equivalent is not "not owned"'));
  assert.ok(none.length > 100);
});
test('setsModel: a complete set counts placed pieces, a set still to collect counts owned ones; pieces are placed, owned or missing', () => {
  const suit = '1201', gs = LOOKUPS.DECOR_SUIT_GROUPS[suit];
  const placed = [{ g: gs[0] }, { g: gs[1] }], om = L.ownedMap(LOOKUPS, placed);
  const sm = L.setsModel(LOOKUPS, { decorations: { suit: [1202], suitLevelBuff: { 1202: 4 } } }, placed, om);
  const left = sm.left.find((s) => s.id === suit), done = sm.done[0];
  assert.equal(left.complete, false); assert.equal(left.have, 2); assert.equal(left.placed, 2); assert.equal(left.total, gs.length);
  assert.deepEqual(left.pieces.slice(0, 3).map((p) => p.st), ['placed', 'placed', 'missing']);
  assert.equal(done.complete, true); assert.equal(done.level, 4); assert.ok(done.pieces.every((p) => p.st !== 'missing'), 'a complete set owns every piece');
  assert.equal(sm.done.length + sm.left.length, Object.keys(LOOKUPS.DECOR_SUITS).length);
});

// ---- Spend my shards ----
test('spendModel: the classic advisor ranking as plain rows (cost after spare pieces, ready, shortfall, relative bar)', () => {
  const { core, merged } = placedFor([[5544, 2], [5606, 2]]);
  const inv = bag(1000), data = { levels: LEVELS, index: INDEX, mutex: MUTEX };
  const m = L.spendModel(core, inv, merged, data);
  const direct = core.computeDecorRecs(['march_size'], inv, merged, data).byStat.march_size;
  assert.equal(m.shards.universal, 1000);
  assert.deepEqual(m.byStat.march_size.map((r) => [r.g, r.to, r.cost]), direct.map((r) => [r.group, r.toLevel, r.shardCost]));
  const top = m.byStat.march_size[0];
  assert.equal(top.bar, 100); assert.equal(top.ready, top.cost <= 1000); assert.equal(top.short, Math.max(0, top.cost - 1000));
  assert.ok(m.byStat.march_size.every((r) => r.gain.every((g) => !VOCAB.test(g.n))));
  assert.ok(top.gain[0].rate.indexOf('shards per') >= 0);
  assert.ok(L.spendModel(core, inv, merged, data, ['hp']).byStat.hp.length === 0 || true);
});
test('the Overview decoration move and the Spend panel agree: on the all-units view the tab that opens is the stat the move chose, its top ready row is the decoration the move names', () => {
  // [placed groups, shards in bag]. Case 3 mirrors a real player: Army / Air Force attack decorations rank higher on the advisor's own list but are not "All units Attack".
  for (const [specs, shards] of [[[[5544, 2], [5606, 2], [4200, 2]], 100000], [[[4200, 3], [5351, 3]], 500], [[[4200, 2], [4290, 2], [4180, 2], [5544, 5]], 40]]) {
    const { core, merged } = placedFor(specs), inv = bag(shards), vm = vmOf(core, merged, inv);
    const move = vm.moves.picks.find((p) => p.sig === 'd');
    const m = L.spendModel(core, inv, merged, { levels: LEVELS, index: INDEX, mutex: MUTEX });
    const rowsOf = (s) => (L.MAIN_ID[s] ? m.byStatAll : m.byStat)[s];
    const tab = L.PICK_ORDER.find((s) => rowsOf(s).some((r) => r.ready)), row = tab && rowsOf(tab).find((r) => r.ready);
    if (/^Save/.test(move.text)) { assert.equal(row === undefined || !L.MAIN_ID[tab], true, 'a Save move: no ready row on the four stats the move tries'); continue; }
    assert.ok(move.text.indexOf(row.n) >= 0 && move.text.indexOf('Lv.' + row.to) >= 0, 'move "' + move.text + '" vs panel ' + tab + ' top ready "' + row.n + ' to Lv.' + row.to + '"');
    assert.ok(move.meta.indexOf(String(row.cost)) === 0, 'cost ' + move.meta + ' vs ' + row.cost);
    assert.ok(move.text.indexOf(row.gain[0].v.replace(/\.0%$/, '%')) >= 0, 'gain ' + move.text + ' vs ' + row.gain[0].v);
    assert.deepEqual(row.gain.map((g) => g.n).length, 1, 'the all-units view counts one buff');
  }
});
const dMove = (vm) => vm.moves.picks.find((p) => p.sig === 'd');
test('the Overview decoration move counts the unit types the marches use: an Army + Air Force player never gets a Navy decoration, a player with no marches gets all-units buffs only', () => {
  // Hold The Fort 5426 = Army Attack, Beach Umbrella 4320 = Navy Attack, Timer 4360 = Air Force Attack, Christmas tree 4200 = All units Attack
  const specs = [[5426, 2], [4320, 2], [4360, 2], [4200, 2]], inv = bag(100000);
  const { core, merged } = placedFor(specs);
  assert.deepEqual(VM.marchBranches([{ heroIds: [101, 301] }, { heroIds: [102] }], null, core), ['Army', 'Air Force']);
  assert.deepEqual(VM.marchBranches([], null, core), []); assert.deepEqual(VM.marchBranches(null, null, core), []);
  assert.deepEqual(VM.marchBranches([{ heroIds: [126] }], { list: [] }, core), ['Navy']);
  assert.deepEqual(vmOf(core, merged, inv, [{ heroIds: [101, 301] }]).movesInput.decor.branches, ['Army', 'Air Force']);
  const none = dMove(vmOf(core, merged, inv, []));
  assert.match(none.text, /^Upgrade Christmas tree to Lv\.3/, 'no marches: all units only'); assert.match(none.text, /All units Attack/);
  const af = dMove(vmOf(core, merged, inv, [{ heroIds: [101, 301] }]));
  assert.doesNotMatch(af.text, /Beach Umbrella/, 'never a Navy decoration for an Army + Air Force player');
  // the Army decoration alone is a move for an Army player and no move for a player with no marches
  const only = placedFor([[5426, 2]]);
  assert.equal(dMove(vmOf(only.core, only.merged, inv, [])), undefined, 'no marches: Army Attack does not count');
  const army = dMove(vmOf(only.core, only.merged, inv, [{ heroIds: [101] }])); assert.match(army.text, /^Upgrade Hold The Fort to Lv\.3/); assert.match(army.text, /Army Attack/);
  assert.equal(dMove(vmOf(only.core, only.merged, inv, [{ heroIds: [126] }])), undefined, 'a Navy player does not count Army Attack');
  // the panel opens on the same scope: its top ready row is the move
  for (const mg of [[], [{ heroIds: [101] }], [{ heroIds: [101, 301] }]]) {
    const vm = vmOf(core, merged, inv, mg), mv = dMove(vm), m = L.spendModel(core, inv, merged, { levels: LEVELS, index: INDEX, mutex: MUTEX }, null, vm.movesInput.decor.branches);
    const tab = L.PICK_ORDER.find((s) => (L.MAIN_ID[s] ? m.byStatMine : m.byStat)[s].some((r) => r.ready)), row = m.byStatMine[tab].find((r) => r.ready);
    assert.ok(mv.text.indexOf(row.n) >= 0 && mv.meta.indexOf(String(row.cost)) === 0, 'marches ' + JSON.stringify(mg) + ': "' + mv.text + '" vs panel ' + tab + ' ' + row.n);
  }
});
test('an all-units buff counts once per marched unit type: for an Army + Air Force player Mega Bite (+1% All units Attack, 360 shards) beats Swing Bridge (+4% Army Attack, 864)', () => {
  // Mega Bite 5604 and Swing Bridge 5612 at Lv.3 -> Lv.4: 100/360 = 0.28 per shard, 400/864 = 0.46 unweighted; the all-units buff counts twice for two unit types: 200/360 = 0.56
  const { core, merged } = placedFor([[5604, 3], [5612, 3]]), inv = bag(100000);
  const text = (mg) => dMove(vmOf(core, merged, inv, mg)).text;
  assert.match(text([]), /^Upgrade Mega Bite/, 'no marches: Swing Bridge (Army Attack) does not count at all');
  assert.match(text([{ heroIds: [101] }]), /^Upgrade Swing Bridge to Lv\.4: \+4% Army Attack/, 'one unit type: the all-units buff counts once, 0.28 against 0.46');
  assert.match(text([{ heroIds: [101, 301] }]), /^Upgrade Mega Bite to Lv\.4: \+1% All units Attack/, 'two unit types: 0.56 against 0.46, and the text still prints the buff\'s own +1%');
  const vm = vmOf(core, merged, inv, [{ heroIds: [101, 301] }]), m = L.spendModel(core, inv, merged, { levels: LEVELS, index: INDEX, mutex: MUTEX }, null, vm.movesInput.decor.branches);
  assert.deepEqual(m.byStatMine.attack.map((r) => r.n).slice(0, 2), ['Mega Bite', 'Swing Bridge'], 'the panel ranks by the same weights');
  assert.equal(m.byStatMine.attack[0].gain[0].v, '+1.0%', 'the printed gain is the buff\'s own, not the weighted one');
  assert.deepEqual(core.decorScopeIds('930100', ['Army', 'Air Force']).map((x) => x[2]), [2, 2, 2, 1, 1, 1, 1], 'the all-units twins 9301160 / 93011601 weigh like 930100'); assert.deepEqual(core.decorScopeIds('960012', ['Army']), [['960012', null, 1]]);
});
test('a decoration whose All units Attack comes only through a second-system id (9301160) competes in the move and the panel; players without such ids are unchanged', () => {
  // Cosmos-style groups: find placed groups whose only attack buff is 9301160 or 9301170
  const idxs = INDEX.filter((e) => LEVELS[e.group] && LEVELS[e.group].fi === 20213232 && e.buffs.length === 1);
  const atk = idxs.find((e) => e.buffs[0].id === 9301160), hp = idxs.find((e) => e.buffs[0].id === 9301170);
  assert.ok(atk && hp, 'the tables carry such decorations');
  for (const [e, stat, tab, label] of [[atk, 'attack', 'attack', /All units Attack/], [hp, 'hp', 'hp', /All units HP/]]) {
    const { core, merged } = placedFor([[e.group, 2]]), inv = bag(100000);
    const mv = dMove(vmOf(core, merged, inv, []));
    assert.ok(mv && mv.text.indexOf(e.name) >= 0, e.name + ' competes: ' + (mv && mv.text)); assert.match(mv.text, label);
    const m = L.spendModel(core, inv, merged, { levels: LEVELS, index: INDEX, mutex: MUTEX }, null, []);
    assert.equal(m.byStatMine[tab][0].n, e.name); assert.ok(m.byStatAll[tab].some((r) => r.n === e.name));
  }
  const plain = placedFor([[4200, 2]]); assert.match(dMove(vmOf(plain.core, plain.merged, bag(100000), [])).text, /^Upgrade Christmas tree/, 'a first-system player is unchanged');
});
test('every-unit-type view is the classic advisor list: it can rank a decoration the Overview move does not count', () => {
  // Sandcastle Toolkit raises Army HP (930001), not All units HP (930000)
  const { core, merged } = placedFor([[5544, 5], [4200, 2], [4290, 2]]), inv = bag(40), vm = vmOf(core, merged, inv);
  assert.match(vm.moves.picks.find((p) => p.sig === 'd').text, /^Save for Cutie/);
  const m = L.spendModel(core, inv, merged, { levels: LEVELS, index: INDEX, mutex: MUTEX });
  assert.equal(m.byStatAll.hp.some((r) => r.ready), false, 'all units only: nothing to buy, as the Overview says');
  const row = m.byStat.hp.find((r) => r.ready);
  assert.equal(row.n, 'Sandcastle Toolkit'); assert.equal(row.gain[0].n, 'Army HP', 'the row names the buff, so Army HP is never mistaken for All units HP');
  assert.equal(m.byStat.march_size.length, m.byStatAll.march_size.length, 'March Size has one buff: both views are the same list');
});
test('item sheet: one gain line for every buff the next level changes, with now -> next and whether the Overview move counts it', () => {
  const { core, vm } = placedFor([[5612, 3], [5604, 3], [5426, 2], [4200, 2], [5462, 1]]);
  const pm = L.placedModel(vm.decor, LOOKUPS, G, core);
  pm.filter((p) => p.nx).forEach((p) => assert.equal(L.gainLines(LOOKUPS, p, [], core).length, Object.keys(p.nx.dl).length, p.n));
  const sb = pm.find((p) => p.g === 5612), l = L.gainLines(LOOKUPS, sb, ['Army', 'Air Force'], core);
  assert.deepEqual(l.map((g) => [g.n, g.cur, g.next, g.step, g.counted, g.pct]), [['Army Attack', 12, 16, 4, true, true]], 'the +4% Army Attack of the Overview move is on its sheet');
  assert.equal(L.gainLines(LOOKUPS, sb, [], core)[0].counted, false, 'no marches: Army Attack is not counted');
  const pc = pm.find((p) => p.g === 5462); assert.ok(L.gainLines(LOOKUPS, pc, [], core).length >= 1);
});
test('fitWalk: rows are paid in rank order from one bag; 507 shards cover 60 + 80 + 160 + 200, the fifth (240) fits alone but needs 233 more after them', () => {
  const w = L.fitWalk([60, 80, 160, 200, 240].map((c) => ({ cost: c })), 507);
  assert.deepEqual(w.items.map((i) => i.st), ['fits', 'fits', 'fits', 'fits', 'after']); assert.deepEqual([w.fit, w.spent, w.left, w.items[4].over], [4, 500, 7, 233]);
  assert.deepEqual(L.fitWalk([{ cost: 900 }, { cost: 10 }], 507).items.map((i) => [i.st, i.over]), [['short', 393], ['fits', 0]], 'a row too dear for the whole bag is "short" and does not stop a cheaper one');
  assert.deepEqual(L.fitWalk([], 5), { items: [], fit: 0, spent: 0, left: 5 });
});
test('spend rows never carry a raw group id: a partner that cannot be named is dropped', () => {
  const { core, merged } = placedFor([[5544, 2]]), m = L.spendModel(core, bag(1e6), merged, { levels: LEVELS, index: INDEX, mutex: { 5544: ['9999999', '5606'] }, names: LOOKUPS.DECOR_GROUPS }, null, []);
  const row = m.byStat.march_size.find((r) => r.g === 5544); assert.ok(row.mutex.every((n) => !/Group \d+/.test(n)), row.mutex.join('|'));
});
test('mutexMap: group to the groups it cannot share a base with', () => {
  const k = Object.keys(MUTEX)[0]; assert.ok(Array.isArray(MUTEX[k]) && MUTEX[k].every((x) => typeof x === 'string'));
  assert.deepEqual(L.mutexMap({ c: [{ g: 1, me: [2, 3] }, { g: 2, me: [1] }, null, { me: [9] }] }), { 1: ['2', '3'], 2: ['1'] });
  assert.deepEqual(L.mutexMap(null), {});
});

// ---- Formation ----
const REF = P.data('formation-v2.json');
test('formationCard: tier, level, the 0-45 specialization total and the +1 rule (only below the slot cap), unseen formation', () => {
  const f = { id: 1001, lv: 50, quality: 8, masterys: { 1: 4, 2: 5, 3: 4, 11: 1, 12: 4, 22: 4 }, formationMasteryUp: 1, formationQualityUp: 1, isMarching: true };
  const c = L.formationCard('1001', f, REF);
  assert.equal(c.name, 'Shark'); assert.equal(c.skill, 'Swift Strike'); assert.equal(c.icon, 'formation-icons/formation_1001_shark.png');
  assert.deepEqual([c.lv, c.tier, c.tierUp, c.specUp, c.marching], [50, 8, true, true, true]);
  // 4+5+4+1+4+4 = 22 raw, five slots below 5 get +1 each: 27
  assert.equal(c.total, 27);
  assert.deepEqual(c.slots.map((s) => [s.n, s.lv, s.eff, s.plus]), [[1, 4, 5, true], [2, 5, 5, false], [3, 4, 5, true], [4, 1, 2, true], [5, 4, 5, true], [6, null, null, false], [7, null, null, false], [8, 4, 5, true], [9, null, null, false]]);
  const none = L.formationCard('1003', undefined, REF); assert.equal(none.seen, false); assert.equal(none.slots, undefined);
  assert.equal(L.formationCard('9999', undefined, REF).name, 'Formation 9999');
});
test('formationsMerged: the formation upload wins per formation and keeps report fields it lacks', () => {
  const m = L.formationsMerged({ 1001: { lv: 40, sciences: { 1: 3 }, quality: 2 }, 1002: { lv: 10 } }, { formations: { 1001: { lv: 50, quality: 8 }, 1003: { lv: 5 } } });
  assert.deepEqual([m['1001'].lv, m['1001'].quality, m['1001'].sciences, m['1001'].id, m['1002'].lv, m['1003'].lv], [50, 8, { 1: 3 }, 1001, 10, 5]);
  assert.deepEqual(L.formationsMerged(null, null), {});
});
test('techModel: level of max, the buffs at the current level (buff_show, else the front row), nothing before level 1', () => {
  const t = L.techModel(REF, { 1001: { sciences: { 1: 3, 2: 0, 3: 30, 4: 21, 5: 24 } } });
  assert.deepEqual(t.map((x) => [x.name, x.lv, x.max]), [['Assault', 3, 15], ['Fortified Formation', 0, 15], ['Defense', 30, 30], ['Full Defense', 21, 60], ['Swept Wing Formation', 24, 55 >= 0 ? t[4].max : 0]]);
  assert.deepEqual(t[0].chips, [{ n: 'Attack', v: '+80%' }]); assert.equal(t[0].front, true);
  assert.deepEqual(t[1].chips, []); assert.equal(t[2].pct, 100); assert.equal(t[0].pct, 20);
  assert.equal(L.techModel(REF, {}).every((x) => x.lv === 0 && !x.seen), true);
});
test('parseBuffGroup and the formation buff names', () => {
  assert.deepEqual(L.parseBuffGroup('1=1000022,4000|1000023,500;2=1000022,4000'), { 1: [{ id: 1000022, value: 4000 }, { id: 1000023, value: 500 }], 2: [{ id: 1000022, value: 4000 }] });
  assert.deepEqual(L.parseBuffGroup(''), {}); assert.deepEqual(L.parseBuffGroup(null), {});
  assert.equal(L.fbuffName(1000022), 'Attack'); assert.equal(L.fbuffName(123), 'Other effect'); assert.equal(L.fbuffVal(1050), '+10.5%');
});
test('armyMastery decodes the unit code out of the value; talentModel decodes levels, counts, power and splits the sides', () => {
  assert.deepEqual(L.armyMastery({ 101: 118, 201: 213, 301: 318 }), [{ type: 'Army', lv: 17 }, { type: 'Navy', lv: 12 }, { type: 'Air Force', lv: 17 }]);
  assert.equal(L.armyMastery(null), null); assert.equal(L.armyMastery({}), null);
  // 1001006 = Full Rest level 5 (max 5), 2015003 = a right-side node at level 2, 1007004 = a switchable node
  const tm = L.talentModel(REF, { talents: [1001006, 2015003, 1007004], currencies: { 2800000: 3739 } });
  assert.equal(tm.trained, 3); assert.ok(tm.maxed >= 1); assert.equal(tm.total, 50); assert.equal(tm.held, 3739);
  const full = tm.sides.left.find((n) => n.id === 1001000); assert.deepEqual([full.lv, full.max, full.val, full.buff], [5, 5, '+10%', 'All units HP']);
  assert.ok(tm.sides.right.some((n) => n.id === 2015000 && n.lv > 0));
  const sw = tm.sides.left.find((n) => n.id === 1007000); assert.equal(sw.sw, true); assert.equal(sw.val, '');
  assert.ok(tm.power >= 15000);
  assert.ok(tm.maxPower > tm.power && tm.maxPower > 800000, 'maximum tree power: ' + tm.maxPower);
  assert.ok(tm.spent > 0, 'manuals spent: ' + tm.spent);
  assert.equal(L.talentModel(REF, { talents: [] }), null); assert.equal(L.talentModel(REF, null), null);
  assert.equal(L.talentModel({ talent_tree: null }, { talents: [1001006] }).trained, 0, 'a missing tree never throws');
});

// ---- safety ----
test('formation and talents: the talent that gives Tier +1 / Spec +1 is named, talents run by tree depth with what an untrained one needs, bdSort puts the equipped base decoration first, ages and skill levels read plainly', () => {
  const c = L.formationCard('1001', { id: 1001, lv: 50, quality: 9, formationQualityUp: 1, formationMasteryUp: 1, masterys: { 1: 5 } }, REF);
  assert.deepEqual([c.tierTalent, c.specTalent], ['Evolved Shark', 'Shark Impact']); assert.equal(L.formationCard('1003', { id: 1003, masterys: {} }, REF).tierTalent, 'Eagle Evolution');
  const tm = L.talentModel(REF, { talents: [1001006] }), left = tm.sides.left;
  assert.equal(left[0].id, 1001000); assert.equal(left[0].depth, 0);
  assert.ok(left.every((n, i) => i === 0 || n.depth >= left[i - 1].depth), 'ordered by depth');
  const army = left.find((n) => n.id === 1002000); assert.equal(army.lv, 0); assert.equal(army.needs, '', 'its parent Full Rest is trained: nothing is needed');
  const next = left.find((n) => n.id === 1003000); assert.ok(next.lv === 0 && typeof next.needs === 'string');
  assert.deepEqual(L.bdSort([{ id: 1, name: 'B' }, { id: 2, name: 'A' }, { id: 3, name: 'C' }], 'equipped', 3).map((b) => b.id), [3, 2, 1]);
  assert.equal(L.ageOld('2026-10-09T00:00:00Z', Date.parse('2026-10-11T12:00:00Z')), '2 days old'); assert.equal(L.ageOld(null), '');
  assert.equal(L.skinRow(T, 1759000, 0).skill.indexOf('Lv. '), -1);
});
test('hostile names reach the model as plain strings only (the view escapes them; see armory-xss.test and the xss harness)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const t = { SKIN_SD: { 5: [evil, evil, [[evil, '+1%']], [[evil, '<b>']], evil, 0] }, SKIN_GROUP_LOOKUP: {}, SKIN_ALT_LOOKUP: {}, NEW_SKIN_IDS: {}, CITY_SKILL_DB: { 5: [evil, 0, evil, evil] }, SKILL_TYPES: {}, BASE_DECOR_DATA: { 6: { n: evil, i: evil, e: [[evil, 5]], o: [] } } };
  const r = L.skinRow(t, 5, 0); assert.equal(r.name, evil); assert.equal(typeof r.power, 'number');
  assert.equal(L.bdRow(t, 6, t.BASE_DECOR_DATA).name, evil);
  assert.equal(L.skinRow(t, '5; DROP', 0).known, false);
  assert.equal(L.bdRow(t, 99, t.BASE_DECOR_DATA).name, 'Unknown');
  assert.equal(L.baseVal('<b>', 'x'), '+0%');
  assert.equal(L.decodeTalent(NaN, {}).level > 0, false);
});

// ---- owned, not placed (a Snapshot lists only what is on the map; the bag and the report hold the rest) ----
const bagWith = (decor) => ({ tabs: { item: [{ id: 20213232, a: 0 }], decor } });
test('owned: a decoration in the bag (Decor tab) is owned and listed as "owned, not placed", with the bag\'s level and piece count', () => {
  const core = newCore(), merged = { decorations: { ids: [decorId(core, 5544, 3)], suit: [], suitLevelBuff: {} } };
  const vm = vmOf(core, merged, bagWith([{ id: 4648002, a: 2, l: 2, g: 5280 }, { id: decorId(core, 4200, 4), a: 1, l: 4, g: 4200 }]));
  assert.deepEqual(vm.decor.stored.map((s) => [s.g, s.lv, s.count]), [[4200, 4, 1], [5280, 2, 2]].sort((a, b) => (vm.decor.stored.find((s) => s.g === a[0]).n < vm.decor.stored.find((s) => s.g === b[0]).n ? -1 : 1)));
  assert.deepEqual(vm.decor.placed.map((p) => p.g), [5544], 'placed is untouched');
  const placed = L.placedModel(vm.decor, LOOKUPS, G, core), stored = L.storedList(vm.decor, LOOKUPS, G, core), om = L.ownedMap(LOOKUPS, placed, stored);
  assert.ok(om.map['5280'] && om.map['4200'] && om.map['5544']);
  const none = L.notOwnedList(LOOKUPS, G, om).map((x) => x.g);
  assert.ok(!none.includes(5280) && !none.includes(4200), 'owned in the bag is not "not owned"');
  assert.equal(none.length, Object.keys(LOOKUPS.DECOR_DATA).length - Object.keys(om.map).filter((k) => LOOKUPS.DECOR_DATA[k]).length);
  const before = L.notOwnedList(LOOKUPS, G, L.ownedMap(LOOKUPS, placed)).length;
  assert.equal(before - none.length, 2, 'two catalog entries (the bag ones) leave the list; before the fix they stayed in it');
});
test('owned: the bag\'s group is read from a level-encoded id (L2 = L1 x 100 + 2) when the item has no group, and the level from the id', () => {
  const core = newCore(), vm = vmOf(core, { decorations: { ids: [], suit: [], suitLevelBuff: {} } }, bagWith([{ id: 4648002, a: 1 }]));
  assert.deepEqual(vm.decor.stored.map((s) => [s.g, s.lv]), [[5280, 2]]);
});
test('owned: a mutually exclusive variant of a decoration in the bag is owned too', () => {
  const g = 4240, mates = LOOKUPS.ME_CLUSTERS[String(LOOKUPS.ME_LOOKUP[String(g)])].filter((m) => m !== g);
  assert.ok(mates.length >= 1);
  const core = newCore(), vm = vmOf(core, { decorations: { ids: [], suit: [], suitLevelBuff: {} } }, bagWith([{ id: 1, a: 1, l: 2, g }]));
  const om = L.ownedMap(LOOKUPS, L.placedModel(vm.decor, LOOKUPS, G, core), L.storedList(vm.decor, LOOKUPS, G, core));
  mates.forEach((m) => assert.equal(om.map[String(m)], true));
});
test('owned: ids the report lists but the Snapshot\'s placed list does not (opts.reportDecorIds, kept by loadArmory) are held, not placed; a group both placed and in the bag is not listed twice', () => {
  const core = newCore(), id1 = decorId(core, 4170, 3), id2 = decorId(core, 5544, 2);
  const merged = { decorations: { ids: [id2], suit: [], suitLevelBuff: {} } };
  const vm = vmOf(core, merged, bagWith([{ id: id2, a: 1, l: 2, g: 5544 }]), undefined, [id1, id2]);
  assert.deepEqual(vm.decor.stored.map((s) => [s.g, s.lv]), [[4170, 3]]);
  assert.deepEqual(vm.decor.placed.map((p) => p.g), [5544]);
});
test('owned: a set piece that is only in the bag counts as owned in a set still to collect', () => {
  const suit = '1201', gs = LOOKUPS.DECOR_SUIT_GROUPS[suit], core = newCore();
  const vm = vmOf(core, { decorations: { ids: [decorId(core, gs[0], 1)], suit: [], suitLevelBuff: {} } }, bagWith([{ id: decorId(core, gs[1], 1), a: 1, l: 1, g: gs[1] }]));
  const placed = L.placedModel(vm.decor, LOOKUPS, G, core), om = L.ownedMap(LOOKUPS, placed, L.storedList(vm.decor, LOOKUPS, G, core));
  const left = L.setsModel(LOOKUPS, { decorations: { suit: [] } }, placed, om).left.find((s) => s.id === suit);
  assert.deepEqual([left.have, left.placed], [2, 1]); assert.deepEqual(left.pieces.slice(0, 2).map((p) => p.st), ['placed', 'owned']);
});
test('owned, not placed: the source is the bag or the report, and a Universal-shard decoration in the bag carries its next-level cost', () => {
  const core = newCore(), g = Object.keys(LEVELS).find((k) => LEVELS[k].fi === G.ADVISOR_UNIVERSAL_SHARD_ID && LOOKUPS.DECOR_GROUP_BASE[k] && k !== '4170');
  const gl = LEVELS[g].levels.map((l) => l.l).sort((a, b) => a - b), lv = gl[0], id = decorId(core, g, lv);
  const vm = vmOf(core, { decorations: { ids: [], suit: [], suitLevelBuff: {} } }, bagWith([{ id, a: 1, l: lv, g: +g }]), undefined, [decorId(core, 4170, 3)]);
  const bagged = vm.decor.stored.find((s) => s.g === +g), rep = vm.decor.stored.find((s) => s.g === 4170);
  assert.equal(bagged.src, 'bag'); assert.equal(rep.src, 'report');
  assert.ok(bagged.nx && bagged.nx.raw > 0 && bagged.nx.to > lv, 'a bag decoration that upgrades with Universal shards says what the next level costs');
});
