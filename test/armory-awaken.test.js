'use strict';
// Hero Awakening in the Armory v2: the first-paint data rules (pages/armory-vm.js buildAwaken) and the order Tex's rule gives
// (pages/armory-awaken.js, ArmoryAwakenLogic). Worked examples are two real players' awakening data cut down to what the rules read
// (test/fixtures/awaken/*.json: hero id, stars, level, power, Exclusive Skill, awakening, skills; stones and cards; marches).
// Run: node --test test/armory-awaken.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VM = require('../pages/armory-vm.js');
const Core = require('../pages/armory-core.js');
const { Logic: L } = require('../pages/armory-awaken.js');
const G = require('../pages/tw-game-data.js');
const P = require('./helpers/armory-page.js');

const ROOT = path.join(__dirname, '..');
const readJ = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const CAT = readJ('data/hero-awakening-skills.json'), HA = readJ('data/heroes-awakening.json'), ALL = readJ('data/all-heroes.json');
const AW = VM.AW;
const NAMES = {}; ALL.forEach((h) => { NAMES[h.heroId] = h.displayName; });
const core = Core.create(); core.setHeroCache(NAMES, null);
const fx = (n) => readJ('test/fixtures/awaken/' + n + '.json');
const TEX = fx('tex'), REX = fx('rex');
const JETT = 334, NOVA = 172, SARA = 169, LOPHY = 239, SHEN = 234, CARNA = 333, VIVIAN = 332, FRANZ = 338, HEID = 337, JOAN = 336;

// ---- a small world builder: heroes by id with the fields the rules read
function H(id, o) { return Object.assign({ id, star: 5, lv: 120, pw: 1000000, p1: { x: [{ id: G.EXCL_SKILL_ID[id], lv: 7 }], b: [] } }, o); }
function aws(id, lvs) { const o = {}; lvs.forEach((lv, i) => { if (lv) o[AW.FIRST[id] + i] = lv; }); return o; }
function awk(id, aw, lvs, o) { return H(id, Object.assign({ aw, aws: aws(id, lvs), awp: 1 }, o || {})); }
function build(list, inv, merged) { return L.enrich(VM.buildAwaken(merged || { heroes: [] }, { list }, inv === undefined ? { tabs: { item: [{ id: AW.STONE, a: 100 }] } } : inv, core), list); }
function ctxOf(A, list, extra) {
  const pw = {}; list.forEach((h) => { pw[h.id] = h.pw; });
  return Object.assign({ byId: A.byId, pw, stones: A.stones, marches: [], presets: [], reports: [] }, extra || {});
}
const trio = (a, b, c, name) => ({ name: name || 'March', heroIds: [a, b, c] });
const marches = (...m) => m.map((g, i) => ({ name: 'March ' + (i + 1), ids: g }));
function world(list, stones, extra) {
  const A = build(list, { tabs: { item: [{ id: AW.STONE, a: stones }] } });
  return { A, ctx: ctxOf(A, list, Object.assign({ stones }, extra || {})) };
}
function fromFixture(f) {
  const A = L.enrich(VM.buildAwaken({ heroes: [] }, f.heroes, f.inv, core), f.heroes.list);
  return { A, ctx: ctxOf(A, f.heroes.list, { marches: (f.marchGroups || []).map((g) => ({ name: g.name, ids: g.heroIds })), presets: f.formation.presets.map((p) => p.heroIds) }) };
}
const nameOf = (id, slot) => 'S' + slot, heroName = (id) => NAMES[id];

// ---- constants
test('constants equal the game data they were copied from', () => {
  const live = Object.keys(CAT.heroes).filter((k) => CAT.heroes[k].live).map(Number).sort();
  assert.deepEqual(Object.keys(AW.FIRST).map(Number).sort(), live, 'the live heroes');
  live.forEach((id) => {
    const sk = CAT.heroes[id].skills;
    assert.equal(sk.length, 4);
    sk.forEach((s) => { assert.equal(s.awakeningSkillId, AW.FIRST[id] + s.slot - 1, id + ' slot ' + s.slot); assert.equal(s.maxLevel, 10); s.levels.slice(0, 9).forEach((l, i) => assert.equal(l.stoneCost, AW.CLICK[i], 'click price at level ' + (i + 1))); });
  });
  const ph = HA.hyperAwakening.phases[0].heroes;
  ph.forEach((h) => assert.equal(AW.CARD[h.id], h.cardItemId, h.name));
  assert.deepEqual(Object.keys(AW.CARD).map(Number).sort(), ph.map((h) => h.id).sort());
  const gating = JSON.stringify(HA).match(/"skill1_unlocks_at":"Awakening Lv\. (\d+)[^"]*","skill2_unlocks_at":"Awakening Lv\. (\d+)[^"]*","skill3_unlocks_at":"Awakening Lv\. (\d+)[^"]*","skill4_unlocks_at":"Awakening Lv\. (\d+)/);
  assert.deepEqual(AW.GATE, gating.slice(1).map(Number));
  assert.equal(AW.STONE, 44301001);
  const idOf = {}; ALL.forEach((h) => { idOf[h.displayName] = h.heroId; });
  const trios = JSON.stringify(HA).match(/"comboTrio":\{"partners":\[[^\]]*\]/g).map((m) => JSON.parse(m.replace(/^"comboTrio":\{"partners":/, '')).map((n) => idOf[n]));
  assert.deepEqual(L.TRIOS.map((t) => t.slice().sort()).sort(), trios.map((t) => t.slice().sort()).sort());
});
test('costs: 5 clicks a level, 675 stones to Lv.6 and 2,250 to Lv.10 (the Heroes Awakening page)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(L.step), [75, 75, 150, 150, 225, 225, 300, 400, 650]);
  assert.equal(L.costTo(1, 6), 675); assert.equal(L.costTo(1, 10), 2250); assert.equal(L.costTo(7, 8), 300);
});

// ---- eligibility
test('awakening needs 5 stars, Lv.120 and Exclusive Skill Lv.5, in a live, not yet awakened hero', () => {
  const can = (o) => VM.canAwaken(build([H(LOPHY, o)]).byId[LOPHY]);
  const ex = (lv) => ({ p1: { x: [{ id: G.EXCL_SKILL_ID[LOPHY], lv }], b: [] } });
  assert.equal(can(ex(5)), true);
  assert.equal(can(ex(4)), false, 'Exclusive Skill 4');
  assert.equal(can(Object.assign(ex(5), { star: 4 })), false, '4 stars');
  assert.equal(can(Object.assign(ex(5), { lv: 119 })), false, 'Lv.119');
  assert.equal(can(Object.assign(ex(5), { aw: 1, aws: aws(LOPHY, [1]) })), false, 'already awakened');
  assert.equal(can({ p1: { x: [{ id: 1, lv: 9 }], b: [] } }), false, "another skill's level is not the Exclusive Skill");
  assert.equal(can({ p1: { x: [], b: [] } }), false);
  assert.equal(can({ p2: { x: [{ id: G.EXCL_SKILL_ID[LOPHY], lv: 6 }] }, p1: { x: [], b: [] } }), true, 'the higher of preset 1 and 2');
  assert.equal(build([H(165, ex(5))]).byId[165], undefined, 'a hero that is not live is not even tracked');
});

// ---- the data rules
test('skill levels: only this hero\'s four ids, whole numbers 1-10; a missing id is a locked skill', () => {
  assert.deepEqual(L.awSkills(SARA, { 10005: 3, 10006: 1 }), { 1: 3, 2: 1 });
  assert.deepEqual(L.awSkills(SARA, { 10005: 3, 10001: 9, 10009: 4, 10004: 7 }), { 1: 3 }, "ids of other heroes are ignored");
  assert.deepEqual(L.awSkills(SARA, { 10005: 99, 10006: 2.9, 10007: -3, 10008: 'x', ' 10005': 1 }), { 1: 10, 2: 2 });
  assert.equal(L.awSkills(SARA, {}), null); assert.equal(L.awSkills(SARA, null), null); assert.equal(L.awSkills(165, { 10005: 3 }), null, 'a hero that is not live has none');
  assert.equal(L.awSkills(SARA, ['<b>']), null);
});
test('modes: full game data, an old Snapshot (level only), report only, not live, not awakened', () => {
  const A = build([awk(SARA, 10, [1, 1]), H(JETT, { aw: 35 }), H(NOVA, { aw: 40, fa: 1 }), H(165, { aw: 3 }), H(SHEN)], undefined, { heroes: [{ id: LOPHY, awakenLevel: 7, fullAwaken: false }] });
  assert.equal(A.byId[SARA].mode, 'full'); assert.deepEqual(A.byId[SARA].aws, { 1: 1, 2: 1 });
  assert.equal(A.byId[JETT].mode, 'old', 'aw without aws'); assert.equal(A.byId[JETT].aws, null);
  assert.equal(A.byId[NOVA].mode, 'full', 'fa without aws means all four skills are 10'); assert.deepEqual(A.byId[NOVA].aws, { 1: 10, 2: 10, 3: 10, 4: 10 });
  assert.equal(A.byId[165].mode, 'level', 'a hero that is not live: the level only');
  assert.equal(A.byId[SHEN].mode, 'none'); assert.equal(A.byId[SHEN].aw, 0);
  assert.equal(A.byId[LOPHY].mode, 'report', 'only a report says so');
  assert.equal(A.byId[LOPHY].snap, false); assert.equal(A.byId[LOPHY].aw, 7);
  assert.equal(A.n, 5);
});
test('the Snapshot wins over a report; a report only fills a hero the Snapshot lacks', () => {
  const A = build([awk(SARA, 10, [1, 1], { awp: 26000 })], undefined, { heroes: [{ id: SARA, awakenLevel: 40, fullAwaken: true }] });
  assert.equal(A.byId[SARA].aw, 10); assert.equal(A.byId[SARA].fa, false); assert.equal(A.byId[SARA].awp, 26000);
  const B = build([H(SARA)], undefined, { heroes: [{ id: SARA, awakenLevel: 12, fullAwaken: false }] });
  assert.equal(B.byId[SARA].aw, 12, 'the Snapshot has no awakening for her: the report\'s level fills in'); assert.equal(B.byId[SARA].mode, 'report'); assert.equal(B.byId[SARA].awp, null, 'no game power from a report');
});
test('the game\'s own awakening power is shown; a bad value is no power', () => {
  const A = build([awk(SARA, 10, [1, 1], { awp: '26000' }), awk(JETT, 35, [10, 10, 10, 10], { awp: -5 }), awk(NOVA, 40, [10, 10, 10, 10], { awp: 'x' })]);
  assert.equal(A.byId[SARA].awp, 26000); assert.equal(A.byId[JETT].awp, null); assert.equal(A.byId[NOVA].awp, null);
});
test('stones and cards come from the bag; no bag (private or missing) means no number and no card', () => {
  const list = [H(SHEN)];
  const a = build(list, { tabs: { item: [{ id: AW.STONE, a: 46 }, { id: AW.STONE, a: 4 }, { id: 44300005, a: 1 }, { id: 44300001, a: 0 }, { id: 99, a: 9 }] } });
  assert.equal(a.stones, 50, 'amounts add up'); assert.deepEqual(Object.keys(a.cards), ['234'], 'a card with amount 0 is not in the bag');
  assert.equal(build(list, null).stones, null); assert.equal(build(list, null).cards && Object.keys(build(list, null).cards).length, 0);
  assert.equal(build(list, { tabs: {} }).stones, null);
  assert.equal(build(list, { tabs: { item: [] } }).stones, 0, 'a bag with no stones is 0, not unknown');
  assert.equal(build(list, null).cand.length, 0, 'no bag, no Awaken move');
});
test('Awaken: a card in the bag and a hero that qualifies; a card held by a hero who does not is a line, not a move', () => {
  const inv = { tabs: { item: [{ id: 44300005, a: 1 }, { id: 44300002, a: 1 }] } };
  const A = build([H(SHEN), H(LOPHY, { p1: { x: [{ id: G.EXCL_SKILL_ID[LOPHY], lv: 1 }], b: [] } })], inv);
  assert.deepEqual(A.cand.map((c) => c.parts.map((p) => p.s).join('')), ['Awaken Shen Suyu']);
  const c = A.cand[0]; assert.equal(c.kind, 'awaken'); assert.equal(c.meta, 'Awakening Card in bag'); assert.equal(c.ico.u, 'hero-awake-items/item_44300005.png'); assert.equal(c.route, 'heroes/roster?hero=Shen%20Suyu&awk=hero');
  assert.deepEqual(L.cardLines(A, nameOf).map((c) => c.text), ['Shen Suyu Awakening Card in bag · ready to awaken', 'Lophy Awakening Card in bag · needs Exclusive Skill Lv.5 (now 1)']);
  assert.equal(build([H(SHEN, { aw: 1, aws: aws(SHEN, [1]) })], inv).cand.length, 0, 'already awakened');
});
test('card lines: who can be awakened and what is missing', () => {
  const A = build([H(SHEN), H(LOPHY, { star: 4 }), H(NOVA)], { tabs: { item: [] } });
  assert.deepEqual(L.cardLines(A, nameOf).map((c) => c.text), ['Nova can be awakened · needs the Awakening Card', 'Shen Suyu can be awakened · needs the Awakening Card']);
  assert.deepEqual(L.cardLines(build([H(SHEN)], null), nameOf).map((c) => c.text), ['Shen Suyu can be awakened'], 'bag unknown: no claim about the card');
  const n = L.needs(build([H(LOPHY, { star: 4, lv: 100, p1: { x: [{ id: G.EXCL_SKILL_ID[LOPHY], lv: 2 }], b: [] } })]).byId[LOPHY], false);
  assert.deepEqual(n.map((x) => [x.ok, x.text]), [[false, '5 stars (now 4)'], [false, 'Level 120 (now 100)'], [false, 'Exclusive Skill Lv.5 (now 2)'], [false, 'Awakening Card not in bag']]);
});
test('summary: how many are fully awakened and who is part way (the page words it from these three)', () => {
  const A = build([awk(JETT, 40, [10, 10, 10, 10], { fa: 1 }), awk(NOVA, 40, [10, 10, 10, 10]), awk(SHEN, 30, [7, 7, 7, 7]), awk(CARNA, 11, [3, 6]), awk(SARA, 10, [1, 1])]);
  assert.deepEqual([A.n, A.full, A.part.map((a) => a.name + ' ' + a.aw)], [5, 2, ['Shen Suyu 30', 'Carna 11', 'Sara 10']], 'strongest progress first');
  assert.equal(build([H(SHEN)]).n, 0, 'nothing awakened, nothing to summarise');
});
test('the card is shown when there is something to say: an awakened hero, a card, or a hero that can be awakened', () => {
  assert.equal(build([H(SHEN)]).show, true); assert.equal(build([H(SHEN, { star: 4 })]).show, false); assert.equal(build([awk(SARA, 10, [1, 1])]).show, true);
  assert.equal(build([H(NOVA, { p1: { x: [{ id: 1, lv: 1 }], b: [] } })], { tabs: { item: [] } }).show, false);
});

// ---- sets
test('a set is exactly 3 distinct hero ids above 0', () => {
  assert.deepEqual(L.cleanSet([1, 2, 3]), [1, 2, 3]); assert.deepEqual(L.cleanSet([3, 3, 1, 2]), [3, 1, 2], 'a repeat merges');
  assert.equal(L.cleanSet([1, 2]), null); assert.equal(L.cleanSet([1, 2, 3, 4]), null);
  assert.deepEqual(L.cleanSet([0, 1, 2, 3]), [1, 2, 3], 'zero is an empty slot'); assert.equal(L.cleanSet('x'), null); assert.equal(L.cleanSet([NaN, 1, 2]), null);
});
test('sets: the first source that holds a hero who is awakened or can be awakened; saved marches, then presets, then reports; heroes in none of them get their core march', () => {
  const list = [awk(SARA, 10, [1, 1]), H(170), H(174), awk(JETT, 35, [10, 10, 10, 10]), H(VIVIAN), H(FRANZ)];
  const A = build(list), base = ctxOf(A, list);
  const names = (ctx) => L.pickSets(ctx).map((s) => s.src + ':' + s.name + ':' + s.ids.join('-'));
  assert.deepEqual(names(Object.assign({}, base, { marches: [{ name: 'Mine', ids: [SARA, 170, 174] }, { name: 'x', ids: [1, 2] }], presets: [[JETT, VIVIAN, FRANZ]] })), ['march:Mine:169-170-174', 'preset:Preset 1:334-332-338'], 'saved marches win; Jett is in none, so the preset that holds him is added under its real name; a 2-hero march is not a set');
  assert.deepEqual(names(Object.assign({}, base, { marches: [{ name: 'Other', ids: [1, 2, 3] }], presets: [[JETT, VIVIAN, FRANZ], [JETT, FRANZ, VIVIAN], [SARA, 170, 174]] })), ['preset:Preset 1:334-332-338', 'preset:Preset 3:169-170-174'], 'no awakened hero in the marches: the presets; the same three in another order are one set');
  assert.deepEqual(names(Object.assign({}, base, { reports: [[SARA, 170, 174], null, [1, 2]] })), ['report:Battle report march 1:169-170-174', 'core:Air Force Ignition:332-338-334'], 'in no source: the core march');
  const mine = names(Object.assign({}, base, { marches: [{ name: 'Mine', ids: [SARA, 170, 174] }] }));
  assert.deepEqual(mine, ['march:Mine:169-170-174', 'core:Air Force Ignition:332-338-334'], 'Jett is in no saved march, preset or report: his core march rides along');
  const trios = names(base); assert.ok(trios.every((t) => /^core:(Army Dynamic Attack|Air Force Ignition):/.test(t)) && trios.length === 2, 'the core marches that hold a hero the player owns: ' + trios.join());
  assert.equal(names(Object.assign({}, base, { byId: { 169: A.byId[169] }, pw: { 169: 1 }, marches: [], presets: [] })).length, 1, 'only Sara\'s trio: a trio is kept when the player owns one of its heroes');
});
test('set power is the sum of the three heroes\' power (a missing hero counts 0); main is the strongest', () => {
  const list = [awk(SARA, 10, [10, 10, 10, 10], { pw: 300 }), H(170, { pw: 200 }), H(174, { pw: 100 }), awk(JETT, 35, [10, 10, 10, 10], { pw: 200 }), H(VIVIAN, { pw: 90 })];
  const p = L.plan(world(list, 100, { marches: marches([SARA, 170, 174], [JETT, VIVIAN, 999]) }).ctx);
  assert.deepEqual(p.sets.filter((s) => s.src === 'march').map((s) => [s.name, s.power]), [['March 1', 600], ['March 2', 290]], 'Hero 999 is not in the data: it counts 0');
  assert.equal(p.main.name, 'March 1'); assert.deepEqual(p.seconds, [], '290 is far below 85% of 600');
});
test('close second: within 15% (second >= 0.85 x main), exactly 0.85 is in and 0.849 is out', () => {
  const mk = (second) => {
    const list = [awk(SARA, 10, [10, 10, 10, 10], { pw: 1000 }), H(170, { pw: 0 }), H(174, { pw: 0 }), awk(JETT, 35, [10, 10, 10, 10], { pw: second }), H(VIVIAN, { pw: 0 }), H(FRANZ, { pw: 0 })];
    return L.plan(world(list, 0, { marches: marches([SARA, 170, 174], [JETT, VIVIAN, FRANZ]) }).ctx);
  };
  assert.equal(mk(850).seconds.length, 1); assert.equal(mk(849).seconds.length, 0); assert.equal(mk(850).close[mk(850).seconds[0].key], 85);
});
test('two sets within 15%: the one with MORE total awakening skill levels is the main march, even if weaker (Tex 2026-10-10)', () => {
  const list = [awk(SARA, 10, [3, 3], { pw: 1000 }), H(170, { pw: 0 }), H(174, { pw: 0 }), awk(JETT, 35, [8, 8, 8, 8], { pw: 900 }), H(VIVIAN, { pw: 0 }), H(FRANZ, { pw: 0 })];
  const ms = marches([SARA, 170, 174], [JETT, VIVIAN, FRANZ]);
  let p = L.plan(world(list, 0, { marches: ms }).ctx);
  assert.equal(p.main.ids[0], JETT, 'levels 32 against 6: the weaker set is main'); assert.equal(p.seconds.length, 1); assert.equal(p.seconds[0].ids[0], SARA);
  list[3].pw = 849; p = L.plan(world(list, 0, { marches: ms }).ctx);
  assert.equal(p.main.ids[0], SARA, 'outside 15%: power decides'); assert.equal(p.seconds.length, 0);
  list[3].pw = 900; list[0].aws = aws(SARA, [8, 8, 8, 8]); p = L.plan(world(list, 0, { marches: ms }).ctx);
  assert.equal(p.main.ids[0], SARA, 'equal levels: the stronger set stays main');
});
test('a hero in two sets counts toward both sets\' power but is planned only under the stronger one; heroes in no set come after the sets', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170, { pw: 400 }), H(174, { pw: 300 }), H(VIVIAN, { pw: 10 }), H(FRANZ, { pw: 10 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 }), awk(CARNA, 11, [3, 6], { pw: 800 })];
  const { ctx } = world(list, 1000, { marches: marches([SARA, 170, 174], [SARA, VIVIAN, FRANZ]) });
  const p = L.plan(ctx);
  assert.deepEqual(p.sets.map((s) => s.name), ['March 1', 'March 2', 'Air Force Regular Attack', 'Navy Control Tactic'], 'Carna and Shen Suyu are in no march: their core marches');
  assert.equal(p.sets[0].power, 1200); assert.equal(p.sets[1].power, 520, 'Sara counts in both');
  assert.deepEqual(p.sets[0].own, [SARA, 170, 174]); assert.deepEqual(p.sets[1].own, [VIVIAN, FRANZ], 'her skills are planned once, under March 1');
  assert.deepEqual(p.sets.slice(2).map((s) => s.src), ['core', 'core'], 'no source holds Carna or Shen Suyu: their core marches, by power (Carna 800 before Shen 100)');
});
test('no set holds a hero who can be raised: every awakened hero is its own set, strongest first', () => {
  const A = build([H(165, { aw: 3, pw: 5 }), H(HEID, { aw: 0, pw: 9 })]); // Marvingt is awakened but not live; Heid is not live either
  const s = L.pickSets({ byId: A.byId, pw: { 165: 5 }, marches: [], presets: [], reports: [] });
  assert.deepEqual(s.map((x) => [x.src, x.ids]), [['solo', [165]]]);
  const p = L.plan({ byId: A.byId, pw: { 165: 5 }, stones: 50, marches: [], presets: [], reports: [] });
  assert.equal(p.m, null); assert.equal(p.move, null); assert.equal(p.saving, null, 'a hero with no skill data is never planned');
});

// ---- the order
test('phase A: every skill to Lv.6 first, skill 2 and 3, then 4, then 1; lowest level first inside a slot group; stronger hero first', () => {
  const list = [awk(JETT, 30, [1, 1, 1, 1], { pw: 500 }), H(VIVIAN, { pw: 0 }), H(FRANZ, { pw: 0 })];
  const get = (l) => { const w = world(l, 9999, { marches: marches([JETT, VIVIAN, FRANZ]) }); return L.plan(w.ctx).sets[0].next; };
  let n = get(list); assert.deepEqual([n.slot, n.lv, n.phase, n.cost], [2, 1, 'A', 75], 'skill 2 first');
  list[0].aws = aws(JETT, [1, 1, 1, 1].map((x, i) => (i === 1 ? 6 : x))); n = get(list); assert.equal(n.slot, 3, 'skill 2 is at 6: skill 3');
  list[0].aws = aws(JETT, [1, 6, 6, 1]); n = get(list); assert.equal(n.slot, 4, 'then skill 4');
  list[0].aws = aws(JETT, [1, 6, 6, 6]); n = get(list); assert.equal(n.slot, 1, 'then skill 1');
  list[0].aws = aws(JETT, [6, 6, 6, 6]); n = get(list); assert.equal(n.phase, 'B');
  list[0].aws = aws(JETT, [2, 1, 1, 1]); n = get(list); assert.deepEqual([n.slot, n.lv], [2, 1], 'the slot order comes before the level');
  list[0].aws = aws(JETT, [1, 3, 2, 1]); n = get(list); assert.deepEqual([n.slot, n.lv], [3, 2], 'skill 2 and 3 share a rank: the lower level of the two');
  list[0].aws = aws(JETT, [1, 2, 2, 1]); n = get(list); assert.equal(n.slot, 2, 'a full tie: the lower slot');
});
test('phase A across heroes of a set: the stronger hero\'s skill first at the same rank', () => {
  const list = [awk(JETT, 35, [6, 3, 6, 6], { pw: 100 }), awk(VIVIAN, 1, [], { pw: 0 }), awk(NOVA, 40, [6, 3, 6, 6], { pw: 900 })];
  list[1] = H(VIVIAN, { pw: 0 });
  const w = world(list, 9999, { marches: marches([JETT, NOVA, VIVIAN]) });
  const n = L.plan(w.ctx).sets[0].next; assert.deepEqual([n.id, n.slot, n.lv], [NOVA, 2, 3]);
});
test('phase B: round-robin, everything to 7 before anything to 8; lowest level, then stronger hero, then 2/3/4/1', () => {
  const list = [awk(JETT, 35, [7, 7, 6, 8], { pw: 100 }), awk(NOVA, 40, [7, 7, 7, 7], { pw: 900 }), H(VIVIAN)];
  const w = (l) => L.plan(world(l, 9999, { marches: marches([JETT, NOVA, VIVIAN]) }).ctx).sets[0].next;
  let n = w(list); assert.deepEqual([n.id, n.slot, n.lv, n.phase, n.cost], [JETT, 3, 6, 'B', 225], 'the lowest level first: Lv.6, not yet 7');
  list[0].aws = aws(JETT, [7, 7, 5, 8]); n = w(list); assert.deepEqual([n.slot, n.lv, n.phase, n.cost], [3, 5, 'A', 225], 'under Lv.6 it is phase A');
  list[0].aws = aws(JETT, [7, 7, 6, 8]);
  list[0].aws = aws(JETT, [7, 7, 7, 8]); n = w(list); assert.deepEqual([n.id, n.slot, n.lv, n.phase], [NOVA, 2, 7, 'B'], 'all at 7: the stronger hero, skill 2');
  list[1].aws = aws(NOVA, [8, 8, 8, 8]); n = w(list); assert.deepEqual([n.id, n.slot, n.lv], [JETT, 2, 7]);
  list[0].aws = aws(JETT, [10, 10, 10, 10]); list[1].aws = aws(NOVA, [10, 10, 10, 10]); assert.equal(w(list), null, 'all at 10: nothing to raise');
  list[0].aws = aws(JETT, [9, 10, 10, 10]); n = w(list); assert.deepEqual([n.slot, n.lv, n.cost], [1, 9, 650]);
});
test('the "or": only when the main march is in phase B and a close second still has skills under Lv.6', () => {
  const base = (jett, carna, stones) => {
    const list = [awk(JETT, 35, jett, { pw: 1000 }), H(VIVIAN, { pw: 1000 }), H(FRANZ, { pw: 1000 }), awk(CARNA, 11, carna, { pw: 900 }), H(HEID, { pw: 1000 }), H(JOAN, { pw: 1000 })];
    return L.plan(world(list, stones, { marches: marches([JETT, VIVIAN, FRANZ], [CARNA, HEID, JOAN]) }).ctx);
  };
  const p = base([6, 6, 6, 6], [3, 6], 400);
  assert.equal(p.main.ids[0], JETT); assert.equal(p.seconds.length, 1);
  assert.deepEqual([p.m.id, p.m.slot, p.m.to, p.m.cost], [JETT, 2, 7, 225]); assert.deepEqual([p.alt.id, p.alt.slot, p.alt.to, p.alt.cost], [CARNA, 1, 4, 150]);
  assert.equal(p.move.step, p.m); assert.equal(p.move.or, p.alt);
  assert.equal(base([5, 6, 6, 6], [3, 6], 400).alt, null, 'main still in phase A: no "or"');
  assert.equal(base([6, 6, 6, 6], [6, 6], 400).alt, null, 'the second march is at Lv.6: no "or"');
  assert.equal(base([10, 10, 10, 10], [3, 6], 400).alt, null, 'main done: the second march is simply next');
  const done = base([10, 10, 10, 10], [3, 6], 400); assert.deepEqual([done.m.id, done.m.slot], [CARNA, 1]);
});
test('what the card shows: affordability decides Raise, Raise with an "or", the 2nd march alone, or Saving for', () => {
  const list = [awk(JETT, 35, [6, 6, 6, 6], { pw: 1000 }), H(VIVIAN, { pw: 1000 }), H(FRANZ, { pw: 1000 }), awk(CARNA, 11, [3, 6], { pw: 900 }), H(HEID, { pw: 1000 }), H(JOAN, { pw: 1000 })];
  const at = (stones) => L.plan(world(list, stones, { marches: marches([JETT, VIVIAN, FRANZ], [CARNA, HEID, JOAN]) }).ctx);
  let p = at(400); assert.equal(p.move.step.id, JETT); assert.equal(p.move.or.id, CARNA);
  p = at(200); assert.equal(p.move.step.id, CARNA, 'main (225) is out of reach, the 2nd march (150) is not'); assert.equal(p.move.second, true); assert.equal(p.move.or, null);
  p = at(225); assert.equal(p.move.step.id, JETT); assert.equal(p.move.or.id, CARNA, '225 covers both (225 and 150 are alternatives, not a sum)');
  p = at(149); assert.equal(p.move, null); assert.deepEqual([p.saving.id, p.saving.slot, p.saving.cost], [JETT, 2, 225], 'saving for the main march\'s step');
  p = L.plan(world(list, null, { marches: marches([JETT, VIVIAN, FRANZ], [CARNA, HEID, JOAN]), stones: null }).ctx); assert.equal(p.move, null); assert.equal(p.saving, null, 'no bag: no move and no saving');
});
test('moves: the Raise row, its "or" line, the Save-for row; each line is 60 characters or fewer', () => {
  const list = [awk(JETT, 35, [6, 6, 6, 6], { pw: 1000 }), H(VIVIAN, { pw: 1000 }), H(FRANZ, { pw: 1000 }), awk(CARNA, 11, [3, 6], { pw: 900 }), H(HEID, { pw: 1000 }), H(JOAN, { pw: 1000 })];
  const at = (stones) => { const w = world(list, stones, { marches: marches([JETT, VIVIAN, FRANZ], [CARNA, HEID, JOAN]) }); return L.moves(L.plan(w.ctx), stones, (id, s) => (id === JETT ? 'Superheat' : 'Energize'), heroName, () => 'roster'); };
  const txt = (ps) => ps.map((x) => x.s).join('');
  let m = at(412)[0];
  assert.equal(txt(m.parts), 'Raise Superheat on Jett to Lv.7'); assert.equal(txt(m.alt).replace(/\u00A0/g, ' '), 'or Energize on Carna to Lv.4 (close second)'); assert.equal(m.meta, 'Up to 225 stones (or 150) · 412 in bag'); assert.equal(m.kind, 'raise');
  assert.equal(m.route, 'heroes/roster?hero=Jett&awk=1&skill=2'); assert.equal(m.ico.u, 'hero-awake-skills/hero_awake334_2.png');
  m = at(200)[0]; assert.equal(txt(m.parts), 'Raise Energize on Carna to Lv.4'); assert.equal(m.alt, null); assert.equal(m.meta, 'Close second · Up to 150 stones · 200 in bag');
  m = at(46)[0]; assert.equal(m.kind, 'save'); assert.equal(txt(m.parts), 'Save for Superheat Lv.7 on Jett'); assert.equal(m.meta, '46 / 225 Awakening Stones');
  [at(412)[0], at(200)[0], at(46)[0]].forEach((x) => { assert.ok(txt(x.parts).length <= 60); if (x.alt) assert.ok(txt(x.alt).length <= 60); });
});

// ---- worked examples (real data, 2026-10-10)
test('Tex: 46 stones, Shen Suyu 30 with 7/7/7/7 -> no Raise or Awaken move; saving 46/300 for her skill 2 (Lv.8); the Lophy card is a line ("now 1")', () => {
  const { A, ctx } = fromFixture(TEX);
  assert.equal(A.stones, 46); assert.equal(A.byId[SHEN].aw, 30); assert.deepEqual(A.byId[SHEN].aws, { 1: 7, 2: 7, 3: 7, 4: 7 }); assert.equal(A.byId[SHEN].awp, 145200);
  assert.deepEqual(A.cand, [], 'no Awaken move: Lophy holds a card but his Exclusive Skill is Lv.1');
  assert.equal(A.byId[LOPHY].ex, 1);
  assert.deepEqual(L.cardLines(A, nameOf).map((c) => c.text), ['Lophy Awakening Card in bag · needs Exclusive Skill Lv.5 (now 1)']);
  assert.deepEqual([A.n, A.full, A.part.map((a) => a.name + ' ' + a.aw)], [5, 4, ['Shen Suyu 30']]);
  const p = L.plan(ctx);
  assert.deepEqual(p.sets.slice(0, 3).map((s) => [s.name, s.power]), [['March 3', 3310430], ['March 2', 2953030], ['March 1', 2921830]]);
  assert.deepEqual(p.sets.slice(0, 3).map((s) => p.close[s.key] || null), [null, 89, 88]);
  assert.equal(p.main.name, 'March 3', 'Sara, Rohr, Ella; equal skill levels, so the strongest set is main'); assert.deepEqual(p.seconds.map((s) => s.name), ['March 2', 'March 1', 'Preset 4'], 'Carna is in no saved march but in Preset 4 (Heid, Joan Mature, Carna, 88%): that preset is a close second, not an assumed core march');
  assert.equal(p.sets[0].next, null, 'Sara is at 10/10/10/10');
  assert.deepEqual(p.sets.slice(4).map((s) => [s.name, s.core, s.power, s.own]), [['Navy Control Tactic', true, 540677, [240, 241, SHEN]]], 'Shen Suyu is in no saved march, preset or report: Navy Control Tactic with Sinope and Margaretha (core march)');
  assert.equal(p.move, null);
  assert.deepEqual([p.saving.id, p.saving.slot, p.saving.lv, p.saving.to, p.saving.cost, p.saving.phase], [SHEN, 2, 7, 8, 300, 'B']);
  const mv = L.moves(p, A.stones, (id, s) => 'Phoenix Blaze', heroName)[0];
  assert.equal(mv.kind, 'save'); assert.equal(mv.parts.map((x) => x.s).join(''), 'Save for Phoenix Blaze Lv.8 on Shen Suyu'); assert.equal(mv.meta, '46 / 300 Awakening Stones');
});
test('Rex: main = the Jett set, 2nd = the Carna set (89%); saving 62/150 for Energize on Carna Lv.4; Shen Suyu qualifies but has no card', () => {
  const { A, ctx } = fromFixture(REX);
  assert.equal(A.stones, 62); assert.deepEqual(A.cand, []); assert.equal(A.byId[SHEN].mode, 'none'); assert.equal(VM.canAwaken(A.byId[SHEN]), true);
  assert.deepEqual([JETT, CARNA, SARA].map((id) => [A.byId[id].aw, A.byId[id].awp]), [[35, 190200], [11, 51800], [10, 26000]]);
  const p = L.plan(ctx);
  assert.equal(p.main.ids.includes(JETT), true); assert.equal(p.main.power, 2907830);
  assert.equal(p.seconds.length, 1); assert.equal(p.seconds[0].ids.includes(CARNA), true); assert.equal(p.seconds[0].power, 2593430); assert.equal(p.close[p.seconds[0].key], 89);
  assert.equal(p.main.next, null, 'Jett is at 10/10/10/10');
  assert.deepEqual([p.m.id, p.m.slot, p.m.lv, p.m.to, p.m.cost, p.m.phase], [CARNA, 1, 3, 4, 150, 'A'], 'Energize (skill 1) 3 -> 4; skill 2 is already at 6');
  assert.equal(p.move, null); assert.equal(p.saving, p.m);
  assert.equal(L.moves(p, 62, nameOf, heroName)[0].meta, '62 / 150 Awakening Stones');
  assert.deepEqual(L.cardLines(A, nameOf).map((c) => c.text), ['Shen Suyu can be awakened · needs the Awakening Card']);
  assert.deepEqual([A.n, A.full, A.part.map((a) => a.name + ' ' + a.aw)], [3, 0, ['Jett 35', 'Carna 11', 'Sara 10']]);
  const loose = p.sets.find((s) => s.ids.includes(SARA)); assert.ok(loose, 'Sara is planned too'); assert.deepEqual([loose.next.id, loose.next.slot, loose.next.cost], [SARA, 2, 75]);
});
test('Rex with 400 stones and Jett at 6/6/6/6: "Raise Superheat on Jett to Lv.7" or "Energize on Carna to Lv.4"', () => {
  const f = JSON.parse(JSON.stringify(REX)); f.heroes.list.find((h) => h.id === JETT).aws = aws(JETT, [6, 6, 6, 6]); f.inv.tabs.item.find((i) => i.id === AW.STONE).a = 400;
  const { A, ctx } = fromFixture(f); const p = L.plan(ctx);
  const nm = (id, slot) => (id === JETT ? { 1: 'Overload', 2: 'Superheat' }[slot] : { 1: 'Energize' }[slot]);
  const m = L.moves(p, A.stones, nm, heroName)[0];
  assert.equal(m.parts.map((x) => x.s).join(''), 'Raise Superheat on Jett to Lv.7'); assert.equal(m.alt.map((x) => x.s).join('').replace(/\u00A0/g, ' '), 'or Energize on Carna to Lv.4 (close second)');
  assert.equal(CAT.heroes[JETT].skills.find((s) => s.slot === 2).name, 'Superheat', 'the catalog agrees that skill 2 is Superheat');
});

// ---- the model
const LOOK = P.data('decor-lookups.json');
const STATICS = { runeTypes: P.data('rune-types.json'), decorLevels: P.data('decoration-levels.json'), decorIndex: P.data('decoration-index.json'), decorLookups: LOOK, itemTable: P.data('item-table.json') };
function model(f, over) {
  const c = Core.create(); c.setDecorLookups(LOOK); c.setHeroCache(NAMES, null);
  const supp = Object.assign({ heroes: f.heroes, inv: f.inv }, over && over.supp);
  return VM.buildViewModel({ heroes: [] }, { reportsTs: 0, dataTs: Date.parse('2026-10-09T12:00:00Z'), kinds: [] }, { core: c, statics: STATICS, supp, privacy: (over && over.privacy) || {}, player: { name: 'T', siteKey: 'a'.repeat(16) }, reports: [], now: Date.parse('2026-10-10T12:00:00Z') });
}
test('the model: first paint needs no catalog; it holds the Awaken move in the moves input and flags when the module is worth loading', () => {
  const f = JSON.parse(JSON.stringify(TEX)); f.inv.tabs.item.push({ id: 44300005, a: 1 });
  f.heroes.list.find((h) => h.id === SHEN).aw = 0; delete f.heroes.list.find((h) => h.id === SHEN).aws; delete f.heroes.list.find((h) => h.id === SHEN).awp; delete f.heroes.list.find((h) => h.id === SHEN).fa;
  const vm = model(f);
  assert.deepEqual(vm.movesInput.awakenMoves.map((m) => m.kind), ['awaken']);
  assert.equal(vm.moves.picks.length, 1); assert.equal(vm.moves.picks[0].text, 'Awaken Shen Suyu'); assert.equal(vm.moves.picks[0].pill, 'Uses what you have'); assert.equal(vm.moves.picks[0].sig, 'h');
  assert.equal(vm.awaken.eligible, false, 'one card, and every awakened skill is at Lv.10: nothing for the module to add');
  assert.equal(model(TEX).awaken.eligible, true, 'room on the card and an unfinished skill (Shen Suyu): the module may add a Saving for row');
  assert.equal(model(REX).awaken.eligible, true);
  assert.ok(!('names' in vm.awaken), 'no catalog data in the first-paint model');
  assert.deepEqual(Object.keys(model(REX).awaken.byId).map(Number).sort((a, b) => a - b), [169, 172, 234, 239, 333, 334]);
});
test('privacy: a private bag gives no stones, no cards and no Awaken move; private heroes keep only what a report says', () => {
  const vm = model(TEX, { privacy: { inv: true } });
  assert.equal(vm.awaken.stones, null); assert.deepEqual(vm.movesInput.awakenMoves, []); assert.equal(vm.awaken.eligible, false);
  const ph = model(TEX, { privacy: { heroes: true } });
  assert.equal(ph.awaken.n, 0); assert.equal(ph.awaken.show, false);
});

// ---- effect text
test('effect text: a clause whose numbers did not come through becomes "More effect at Lv.6." (50 of the 240 live rows)', () => {
  let bad = 0, total = 0;
  Object.keys(CAT.heroes).filter((k) => CAT.heroes[k].live).forEach((k) => CAT.heroes[k].skills.forEach((s) => s.levels.forEach((l) => {
    total++; const t = L.effectText(l.effect);
    assert.ok(!/[{}]/.test(t) && !/\d%?,\d/.test(t.split(/Unlocks at Lv\. ?6:/)[1] || ''), 'a broken clause is left: ' + t.slice(0, 120));
    if (t !== l.effect) { bad++; assert.match(t, /More effect at Lv\.6\.$/); assert.ok(t.length < l.effect.length); }
  })));
  assert.equal(total, 240); assert.equal(bad, 50);
  assert.equal(L.effectText('Plain effect. Unlocks at Lv. 6: Raises damage by 3.8%.'), 'Plain effect. Unlocks at Lv. 6: Raises damage by 3.8%.');
  assert.equal(L.effectText('Only. Unlocks at Lv. 6: chance {1}'), 'Only. More effect at Lv.6.');
  assert.equal(L.effectText(null), '');
});

// ---- review round: close marches (all of them), fully awakened, checklist, roles, effects
test('close marches: main is the set with the MOST skill levels among ALL sets within 15%, not only the runner-up (Tex-like 100 / 89 / 88)', () => {
  const list = [awk(SARA, 10, [10, 10, 10, 10], { pw: 1000 }), H(170, { pw: 2000 }), H(174, { pw: 1000 }), // March 3: 4000
    awk(JETT, 35, [10, 10, 10, 10], { pw: 1000 }), H(VIVIAN, { pw: 1500 }), H(FRANZ, { pw: 1060 }), // March 2: 3560 (89%), levels 40
    awk(NOVA, 40, [10, 10, 10, 10], { pw: 1000 }), H(173, { pw: 1500 }), H(165, { pw: 1000 }), awk(CARNA, 11, [10, 10, 10, 10], { pw: 10 })];
  list[0].aws = aws(SARA, [1, 1]); // March 3 holds the least skill levels
  list[6].aws = aws(NOVA, [10, 10, 10, 10]); list[9].aws = aws(CARNA, [10, 10, 10, 10]);
  const ms = marches([SARA, 170, 174], [JETT, VIVIAN, FRANZ], [NOVA, 173, 165, 0].slice(0, 3));
  const p = L.plan(world(list, 0, { marches: ms }).ctx);
  assert.deepEqual(p.sets.slice(0, 3).map((s) => Math.round(s.power / 40)).sort((a, b) => b - a), [100, 89, 88], 'the three sets are within 15% of March 3');
  assert.equal(p.top.name, 'March 1');
  const q = (lv) => { const l2 = JSON.parse(JSON.stringify(list)); l2[6].aws = aws(NOVA, lv); l2[3].aws = aws(JETT, [1, 1, 1, 1]); return L.plan(world(l2, 0, { marches: ms }).ctx); };
  const r = q([10, 10, 10, 10]); assert.equal(r.main.name, 'March 3', 'the 88% set holds the most levels (40 against 4 and 2): it is main although it is the weakest'); assert.deepEqual(r.seconds.map((s) => s.name), ['March 1', 'March 2']);
  assert.equal(r.top.name, 'March 1');
});
test('a hero in two sets is planned under the FINAL main march', () => {
  const list = [awk(SARA, 10, [1, 1, 1, 1], { pw: 600 }), H(170, { pw: 500 }), H(174, { pw: 500 }), awk(JETT, 35, [5, 5, 5, 5], { pw: 100 }), H(VIVIAN, { pw: 100 }), awk(NOVA, 40, [9, 9, 9, 9], { pw: 900 })];
  // March 1: Sara/170/174 = 1600 (levels 4); March 2: Nova/Sara/Vivian = 1600 + 100... Sara is in both; March 2 holds more levels
  const ms = marches([SARA, 170, 174], [NOVA, SARA, VIVIAN]);
  const p = L.plan(world(list, 0, { marches: ms }).ctx);
  assert.equal(p.main.name, 'March 2'); assert.ok(p.main.own.includes(SARA), 'Sara is planned under the main march although March 1 alone is not stronger');
  assert.ok(!p.sets.find((s) => s.name === 'March 1').own.includes(SARA));
});
test('Lv.40 is not fully awakened: all four skills must be 10 (or the game says fa)', () => {
  const A = build([awk(JETT, 40, [10, 10, 10, 6]), awk(NOVA, 40, [10, 10, 10, 10]), awk(SARA, 40, [10, 10, 10, 10], { fa: 1 }), awk(SHEN, 35, [10, 10, 10, 10]), H(CARNA, { aw: 40, fa: 1 })]);
  assert.deepEqual([JETT, NOVA, SARA, SHEN, CARNA].map((id) => A.byId[id].full), [false, true, true, false, true]);
  assert.equal(A.full, 3); assert.deepEqual(A.part.map((a) => a.name), ['Jett', 'Shen Suyu']);
});
test('everyone at Lv.40 with one skill at 6 and enough stones: Raise appears and the module is worth loading', () => {
  const list = [awk(JETT, 40, [10, 10, 10, 6], { pw: 100 }), awk(NOVA, 40, [10, 10, 10, 10], { pw: 90 }), awk(SARA, 40, [10, 10, 10, 10], { pw: 80 })];
  const { A, ctx } = world(list, 600, { marches: marches([JETT, NOVA, SARA]) });
  const p = L.plan(ctx); assert.deepEqual([p.m.id, p.m.slot, p.m.lv, p.m.to, p.m.cost, p.m.phase], [JETT, 4, 6, 7, 225, 'B']);
  assert.equal(L.moves(p, 600, nameOf, heroName)[0].kind, 'raise');
  const vmA = model({ heroes: { list }, inv: { tabs: { item: [{ id: AW.STONE, a: 600 }] } } }); assert.equal(vmA.awaken.eligible, true);
});
test('the checklist: "(now N)" only against a rule that is not met, and a conclusion', () => {
  const a = build([H(SHEN)]).byId[SHEN];
  assert.deepEqual(L.needs(a, true).map((x) => x.text), ['5 stars', 'Level 120', 'Exclusive Skill Lv.5', 'Awakening Card in bag']);
  assert.equal(L.verdict(a, true), 'Ready to awaken. Use the Awakening Card on Shen Suyu in the game.');
  assert.equal(L.verdict(a, false), 'Still needs: Awakening Card not in bag.');
  const b = build([H(LOPHY, { p1: { x: [{ id: G.EXCL_SKILL_ID[LOPHY], lv: 1 }], b: [] } })]).byId[LOPHY];
  assert.equal(L.verdict(b, true), 'Still needs: Exclusive Skill Lv.5 (now 1).'); assert.match(L.verdict(a, null), /cannot be checked without bag data/);
});
test('march rows: heroes with the same state share a clause; a hero that cannot be awakened yet is named as such', () => {
  const A = build([awk(SARA, 10, [10, 10, 10, 10]), H(170), H(174), awk(CARNA, 11, [3, 6]), H(LOPHY)]);
  const t = L.statusLine(A.byId, [SARA, 170, 174], (id) => NAMES[id]);
  assert.deepEqual(t, [{ names: ['Sara'], text: 'all skills Lv.10' }, { names: ['Rohr', 'Ella'], text: "can't be awakened yet" }]);
  assert.equal(L.heroStatus(A.byId[CARNA]), '1 of 2 unlocked skills under Lv.6'); assert.equal(L.heroStatus(A.byId[LOPHY]), 'not awakened');
});
test('effects: below Lv.6 the Lv.6 clause is its own line, nothing is cut, no [brackets] remain', () => {
  let n = 0;
  Object.keys(CAT.heroes).filter((k) => CAT.heroes[k].live).forEach((k) => CAT.heroes[k].skills.forEach((sk) => sk.levels.forEach((l) => {
    const r = L.splitEffect(l.effect, l.level); assert.ok(!/[\[\]]/.test(r.now + r.six), 'bracket left: ' + (r.now + r.six).slice(0, 80));
    if (l.level < 6 && /Unlocks at Lv\. ?6:/.test(l.effect)) { n++; assert.ok(r.six.length > 0 && !/Unlocks at/.test(r.now)); } else assert.equal(r.six, '');
  })));
  assert.ok(n >= 100, 'rows below Lv.6 with the clause: ' + n);
  assert.equal(L.splitEffect('Hits [Combo Attack]. Unlocks at Lv. 6: Adds [Ignition].', 3).six, 'Adds Ignition.'); assert.equal(L.splitEffect('Hits [Combo Attack]. Unlocks at Lv. 6: Adds [Ignition].', 6).six, '');
});
test('Awaken moves: heroes of the main march rank first (the module re-ranks them), the move carries the hero', () => {
  const inv = { tabs: { item: [{ id: 44300005, a: 1 }, { id: 44300002, a: 1 }] } };
  const A = build([H(SHEN, { pw: 100 }), H(LOPHY, { pw: 900 })], inv);
  assert.deepEqual(A.cand.map((c) => c.hero).sort(), [LOPHY, SHEN].sort());
});

// ---- re-review round
test('fully awakened is decided from the skill levels when the game sent them; fa only stands in when they are missing', () => {
  const A = build([awk(JETT, 35, [10, 10, 10, 10]), awk(NOVA, 40, [10, 10, 10, 6], { fa: 1 }), awk(SARA, 40, [10, 10, 10, 10]), H(CARNA, { aw: 40, fa: 1 }), H(SHEN, { aw: 40 })]);
  assert.deepEqual([JETT, NOVA, SARA, CARNA, SHEN].map((id) => A.byId[id].full), [false, false, true, true, false]);
});
test('when the main march is only out of reach (not done), its next step is still there to name', () => {
  const list = [awk(JETT, 35, [6, 6, 6, 6], { pw: 1000 }), H(VIVIAN, { pw: 1000 }), H(FRANZ, { pw: 1000 }), awk(CARNA, 11, [3, 6], { pw: 900 }), H(HEID, { pw: 1000 }), H(JOAN, { pw: 1000 })];
  const p = L.plan(world(list, 200, { marches: marches([JETT, VIVIAN, FRANZ], [CARNA, HEID, JOAN]) }).ctx);
  assert.equal(p.move.second, true); assert.notEqual(p.main.next, null); assert.equal(p.main.next.cost, 225);
});

// ---- core-march fallback (owner's rule 2026-10-11)
const sm = (P) => P.sets.map((s) => s.name + (s.core ? '*' : ''));
test('core marches: the six sets, by hero id, equal the data files', () => {
  const idOf = {}; ALL.forEach((h) => { idOf[h.displayName] = h.heroId; });
  const want = { 'Army Dynamic Attack': ['Sara', 'Ella', 'Rohr'], 'Army Counter-Attack': ['Marvingt', 'Tannis', 'Nova'], 'Navy Control Tactic': ['Sinope', 'Margaretha', 'Shen Suyu'], 'Navy Defense Tactic': ['Alvida', 'Lilia', 'Lophy'], 'Air Force Regular Attack': ['Heid', 'Joan Mature', 'Carna'], 'Air Force Ignition': ['Vivian', 'Franziska', 'Jett'] };
  assert.deepEqual(L.CORE.map((c) => c.name), Object.keys(want));
  L.CORE.forEach((c) => assert.deepEqual(c.ids, want[c.name].map((n) => { assert.ok(idOf[n], n); return idOf[n]; }), c.name));
  const cl = {}; HA.coreLineup.heroes.forEach((h) => { cl[h.name] = h.id; });
  L.CORE.forEach((c) => c.ids.forEach((id) => assert.equal(NAMES[id] && cl[NAMES[id]], id, 'coreLineup agrees on ' + NAMES[id])));
});
test('core marches: Shen Suyu, in no march, preset or report, lands in Navy Control Tactic with Sinope and Margaretha even though the player has other marches', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170, { pw: 400 }), H(174, { pw: 300 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 }), H(240, { pw: 50 }), H(241, { pw: 50 })];
  const p = L.plan(world(list, 1000, { marches: marches([SARA, 170, 174]) }).ctx);
  assert.deepEqual(sm(p), ['March 1', 'Navy Control Tactic*']);
  const n = p.sets[1]; assert.deepEqual(n.ids.slice().sort(), [SHEN, 240, 241].sort()); assert.equal(n.power, 200); assert.equal(n.src, 'core');
  assert.equal(p.loose.length, 0, 'not under "Not in a march" any more');
});
test('core marches: a hero already in a player march is not pulled into a fallback, and a core march equal to a player march is not duplicated', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170, { pw: 400 }), H(174, { pw: 300 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 }), awk(240, 5, [1], { pw: 50 }), H(241, { pw: 50 })];
  let p = L.plan(world(list, 1000, { marches: marches([SARA, 170, 174], [SHEN, 240, 241]) }).ctx);
  assert.deepEqual(sm(p), ['March 1', 'March 2'], 'Shen is in a march: no fallback');
  p = L.plan(world(list, 1000, { marches: marches([SARA, 170, 174], [241, 240, SHEN]) }).ctx);
  assert.deepEqual(sm(p), ['March 1', 'March 2'], 'the same three in another order is the same march');
  p = L.plan(world(list, 1000, { marches: marches([SARA, 170, 174], [SHEN, 240, 999]) }).ctx);
  assert.deepEqual(sm(p), ['March 1', 'March 2'], 'Shen and Sinope are in a march; Margaretha is not workable: no fallback');
  const l2 = list.concat([awk(239, 5, [1], { pw: 10 })]), q = L.plan(world(l2, 1000, { marches: marches([SARA, 170, 174], [SHEN, 240, 999]) }).ctx);
  assert.deepEqual(sm(q), ['March 1', 'March 2', 'Navy Defense Tactic*'], 'Lophy is in no march: only his own core march');
});
test('core marches: a fallback only plans heroes who are in no player march', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170, { pw: 400 }), H(174, { pw: 300 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 }), awk(240, 20, [3, 3, 3, 3], { pw: 50 })];
  const p = L.plan(world(list, 1000, { marches: marches([SARA, 170, 174], [240, 241, 999]) }).ctx);
  const f = p.sets.filter((s) => s.core)[0];
  assert.deepEqual(f.own, [SHEN], 'Sinope and Margaretha are in a player march: the core march plans only Shen Suyu');
});
test('core marches: fallback sets take part in main / close-second selection by the same 15% rule', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 100 }), H(170, { pw: 100 }), H(174, { pw: 100 }), awk(JETT, 35, [10, 10, 10, 10], { pw: 100 }), H(VIVIAN, { pw: 100 }), H(FRANZ, { pw: 90 })];
  const p = L.plan(world(list, 0, { marches: marches([SARA, 170, 174]) }).ctx);
  assert.equal(p.main.core, true, 'within 15% (290 vs 300) and more awakening levels: the core march is main');
  assert.deepEqual(p.seconds.map((s) => s.name), ['March 1']);
});
test('core marches: decor scope is identical with and without fallback sets; inputs are never changed', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170), H(174), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 })];
  const { ctx } = world(list, 1000, { marches: marches([SARA, 170, 174]) }), before = JSON.stringify([ctx.marches, ctx.presets, ctx.reports]);
  const br = ['army', 'navy', 'air'], scope = () => JSON.stringify(['960012', '930100', '1001001'].map((m) => Core.create().decorScopeIds(m, br)));
  const s0 = scope(), p = L.plan(ctx);
  assert.ok(p.sets.some((s) => s.core), 'a fallback set exists');
  assert.equal(scope(), s0); assert.equal(JSON.stringify([ctx.marches, ctx.presets, ctx.reports]), before, 'the player\'s marches are what they were');
});
test('core marches: a preset that holds the hero wins over the core march; the core march counts all three heroes for power', () => {
  const list = [awk(SARA, 10, [1, 1], { pw: 500 }), H(170, { pw: 400 }), H(174, { pw: 300 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 100 }), H(240, { pw: 50 }), H(241, { pw: 60 }), awk(CARNA, 11, [3, 6], { pw: 80 }), H(HEID, { pw: 1 }), H(JOAN, { pw: 2 })];
  const w = world(list, 1000, { marches: marches([SARA, 170, 174]), presets: [[225, 241, 240], [HEID, JOAN, CARNA]] }), p = L.plan(w.ctx);
  assert.deepEqual(sm(p), ['March 1', 'Preset 2', 'Navy Control Tactic*'], 'Carna: her preset; Shen Suyu: in no preset, so the core march');
  const n = p.sets[2]; assert.equal(n.power, 210, 'Shen 100 + Margaretha 60 + Sinope 50, though those two are in a preset'); assert.deepEqual(L.skillsOf(w.ctx, n).map((x) => x.id), [SHEN, SHEN, SHEN, SHEN], 'only Shen Suyu has skills to plan');
});
test('core marches: Save for and the "or" row work when the main march is a core-march fallback', () => {
  const list = [awk(SARA, 10, [10, 10, 10, 10], { pw: 100 }), H(170, { pw: 10 }), H(174, { pw: 10 }), awk(SHEN, 30, [7, 7, 7, 7], { pw: 900 }), H(240, { pw: 900 }), H(241, { pw: 900 }), awk(JETT, 35, [3, 3, 3, 3], { pw: 800 }), H(VIVIAN, { pw: 800 }), H(FRANZ, { pw: 800 })];
  let w = world(list, 10, { marches: marches([SARA, 170, 174], [JETT, VIVIAN, FRANZ]) }), p = L.plan(w.ctx);
  assert.equal(p.main.name, 'Navy Control Tactic'); assert.equal(p.main.core, true);
  assert.equal(p.saving.id, SHEN, 'saving for the core-march main'); assert.equal(p.move, null);
  assert.equal(L.moves(p, 10, nameOf, heroName, () => 'roster')[0].kind, 'save');
  w = world(list, 1000, { marches: marches([SARA, 170, 174], [JETT, VIVIAN, FRANZ]) }); p = L.plan(w.ctx);
  assert.equal(p.main.next.phase, 'B'); assert.ok(p.alt && p.alt.id === JETT, 'the close second still under Lv.6: the or row');
  assert.equal(p.move.or.id, JETT);
});
