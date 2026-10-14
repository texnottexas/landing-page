'use strict';
// Refugee Camps rules (Tex, 2026-10-13): Quick Deploy's picks for a rally, the request, the VIT refill order,
// marches, the runaway guard, answers, the camp list. Hero and unit shapes follow Tex's hand rallies; numbers changed.
// Run: node --test test/refugee-camps-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../refugee-camps-core.js');

const H = (id, power, type, o) => Object.assign({ id, quality: 5, star: 5, level: 120, power, type, exclude: 0, tryOut: 0 }, o);
// the game's order (getAllEnabledHero); Rohr (170) and Ella (174) tie on every key
const POOL = [H(338, 9852, 2), H(115, 4794, 0), H(117, 4875, 0), H(169, 12820, 0), H(174, 10142, 0), H(170, 10142, 0), H(172, 11414, 0), H(333, 11214, 2), H(334, 10840, 2)];
const O = { first: [115, 117, 1117], max: 3, orange: 5, pairThird: true, exclude: false, busy: {} };
const without = (ids) => POOL.filter((h) => !ids.includes(h.id));

test('pickHeroes: Amalia and Diana first (strongest first), then the strongest of Diana\'s type (Tex\'s 1st rally)', () => {
  assert.deepEqual(R.pickHeroes(POOL, O), [117, 115, 169]);
});

test('pickHeroes: with those three out, the strongest, then two of its type; a tie goes by the game\'s order (2nd and 3rd rallies)', () => {
  assert.deepEqual(R.pickHeroes(without([115, 117, 169]), O), [172, 170, 174]);
  assert.deepEqual(R.pickHeroes(without([115, 117, 169, 172, 170, 174]), O), [333, 334, 338]);
});

test('pickHeroes: without the extra-hero buff the 3rd is the strongest of any type', () => {
  const pool = POOL.concat([H(999, 20000, 2)]);
  assert.deepEqual(R.pickHeroes(pool, O), [117, 115, 169]);
  assert.deepEqual(R.pickHeroes(pool, Object.assign({}, O, { pairThird: false })), [117, 115, 999]);
});

test('pickHeroes: with fewer than 4 orange heroes there is no type pairing', () => {
  const four = [H(1, 400, 0), H(2, 300, 2), H(3, 200, 0), H(4, 100, 2)];
  const none = { first: [], max: 3, orange: 5, pairThird: true, exclude: false, busy: {} };
  assert.deepEqual(R.pickHeroes(four, none), [1, 3, 2], '4 orange: 2nd of the 1st\'s type, 3rd of the 2nd\'s (none left: strongest)');
  const purple = four.map((h) => Object.assign({}, h, { quality: 4 }));
  assert.deepEqual(R.pickHeroes(purple, none), [1, 2, 3], 'no pairing');
});

test('pickHeroes: trial heroes are skipped while there are fewer of them than the march holds', () => {
  const pool = POOL.concat([H(500, 99999, 0, { tryOut: 1 })]);
  assert.ok(!R.pickHeroes(pool, O).includes(500));
});

test('pickHeroes: excluded pairs (when the game checks them) and a rally hero whose pair is out are skipped', () => {
  const pool = without([117]).concat([H(117, 4875, 0, { exclude: 1117 }), H(1117, 6000, 0, { exclude: 117 })]);
  const ex = Object.assign({}, O, { exclude: true });
  assert.deepEqual(R.pickHeroes(pool, ex).slice(0, 2), [1117, 115], 'Amalia skipped beside her other form');
  const amaliaOut = pool.filter((h) => h.id !== 117);       // a hero out on a march is not in the game's free list
  assert.deepEqual(R.pickHeroes(amaliaOut, Object.assign({}, ex, { busy: { 117: 1 } })).slice(0, 1), [115], '1117 skipped: its pair is out');
  assert.deepEqual(R.pickHeroes(pool, O).slice(0, 2), [1117, 117], 'the game does not check pairs: both');
  assert.deepEqual(R.pickHeroes([], O), []);
  assert.deepEqual(R.pickHeroes(null, O), []);
});

const U = (armyID, type, level, power, n, o) => Array.from({ length: n }, () => Object.assign({ armyID, type, level, power, mecha: 0, battleMecha: false }, o));

test('pickTroops: units of the heroes\' type first, one unit kind per slot, a slot left short when that kind runs out', () => {
  const units = [].concat(U(901103, 101, 103, 300, 10), U(905103, 301, 103, 300, 10), U(10102, 101, 102, 200, 10));
  const o = { heroTypes: [0], slots: [4, 4, 3], levelWindow: 3, mechaOn: true };
  assert.deepEqual(R.pickTroops(units, o), [
    { pos: 1, armyId: 901103, armyNum: 4 }, { pos: 2, armyId: 901103, armyNum: 4 }, { pos: 3, armyId: 901103, armyNum: 2 }
  ]);
});

test('pickTroops: once the heroes\' type runs out, the strongest of any type fills the next slot', () => {
  const units = [].concat(U(901103, 101, 103, 300, 10), U(905103, 301, 103, 300, 10));
  const o = { heroTypes: [2], slots: [4, 4, 4, 4], levelWindow: 3, mechaOn: true };
  assert.deepEqual(R.pickTroops(units, o), [
    { pos: 1, armyId: 905103, armyNum: 4 }, { pos: 2, armyId: 905103, armyNum: 4 }, { pos: 3, armyId: 905103, armyNum: 2 }, { pos: 11, armyId: 901103, armyNum: 4 }
  ]);
});

test('pickTroops: the heroes\' type counts only within the level window of its best unit', () => {
  const units = [].concat(U(30101, 301, 100, 500, 2), U(30099, 301, 99, 600, 2), U(905103, 301, 103, 300, 1));
  const out = R.pickTroops(units, { heroTypes: [2], slots: [5, 5], levelWindow: 3, mechaOn: true });
  assert.deepEqual(out[0], { pos: 1, armyId: 30101, armyNum: 2 }, 'level 100 is in (103 - 3), level 99 is not, despite more power');
});

test('pickTroops: Heavy Troopers fill one slot at most; a second is dropped; healing ones are left out', () => {
  const units = [].concat(U(901103, 101, 103, 300, 10), U(503431, 101, 101, 500, 1, { mecha: 1002, battleMecha: true }), U(504401, 101, 101, 500, 1, { mecha: 1004, battleMecha: true }));
  const o = { heroTypes: [0], slots: [4, 4, 4], levelWindow: 3, mechaOn: true, mechaPower: { 1002: 10, 1004: 20 } };
  assert.deepEqual(R.pickTroops(units, o), [
    { pos: 1, armyId: 504401, armyNum: 1 }, { pos: 2, armyId: 901103, armyNum: 4 }, { pos: 3, armyId: 901103, armyNum: 4 }
  ]);
  assert.deepEqual(R.pickTroops(units, Object.assign({}, o, { healing: { 1004: 1 } }))[0], { pos: 1, armyId: 503431, armyNum: 1 });
  assert.deepEqual(R.pickTroops([], o), []);
  assert.deepEqual(R.pickTroops(units, Object.assign({}, o, { slots: [] })), []);
});

test('rallyRequest: the 3-minute rally the game\'s start button sends', () => {
  const army = [{ pos: 1, armyId: 901103, armyNum: 4 }];
  const r = R.rallyRequest({ x: 425, y: 643 }, [117, 115, 169], army);
  assert.deepEqual(r, { marchType: 8, x: 425, y: 643, time: 180, armyList: army, armyListNew: army, heroList: [117, 115, 169], trapList: [], formation: 0, formationV2: 0 });
  assert.notEqual(r.armyList, r.armyListNew, 'two copies, like the game');
});

test('buyPrice and refill: the 50-gem buy first (first buy of the day only), then Small, then Large, then stop', () => {
  const P = '50|200|500|500|1000';
  assert.equal(R.buyPrice(P, 0), 50); assert.equal(R.buyPrice(P, 1), 200); assert.equal(R.buyPrice(P, 9), 1000); assert.equal(R.buyPrice(null, 0), null);
  const st = (o) => Object.assign({ point: 3, max: 327, buys: 0, cost: 5, gems: 1000, price: 50, small: 5, large: 5 }, o);
  const set = { buy: true, small: 2, large: 1 };
  assert.equal(R.refill(st({ point: 5 }), set, {}).act, 'none');
  assert.equal(R.refill(st(), set, {}).act, 'buy');
  assert.equal(R.refill(st({ buys: 1, price: 200 }), set, {}).act, 'small', 'already bought today');
  assert.equal(R.refill(st({ gems: 49 }), set, {}).act, 'small', 'not enough gems');
  assert.equal(R.refill(st(), { buy: false, small: 2, large: 1 }, {}).act, 'small', 'buy off');
  assert.equal(R.refill(st({ buys: 1 }), set, { small: 2 }).act, 'large', 'Small limit used');
  assert.equal(R.refill(st({ buys: 1, small: 0 }), set, {}).act, 'large', 'no Small held');
  const end = R.refill(st({ buys: 1 }), set, { small: 2, large: 1 });
  assert.equal(end.act, 'stop'); assert.match(end.reason, /out of VIT/);
});

test('marchFree: all of the player\'s marches count, plus our own rallies the game does not show yet', () => {
  assert.equal(R.marchFree(0, 7, 1, 0), true);
  assert.equal(R.marchFree(1, 7, 1, 0), false);
  assert.equal(R.marchFree(0, 7, 1, 1), false, 'the game has not counted our rally yet');
  assert.equal(R.marchFree(2, 7, 3, 1), false, 'two gatherers out + our rally the game does not show yet = 3');
  assert.equal(R.marchFree(1, 7, 3, 1), true);
  assert.equal(R.marchFree(3, 3, 7, 0), false, 'never past the player\'s max');
});

test('gate: at most 20 rallies a minute (a runaway guard: Tex sends up to 14 by hand)', () => {
  const now = 1e9;
  assert.equal(R.gate(Array.from({ length: 19 }, (_, i) => now - i * 1000), now).ok, true);
  const g = R.gate(Array.from({ length: 20 }, (_, i) => now - 59000 + i), now);
  assert.equal(g.ok, false); assert.equal(g.until, now - 59000 + 60000); assert.match(g.reason, /20 rallies/);
  assert.equal(R.gate(Array.from({ length: 20 }, () => now - 61000), now).ok, true);
});

test('classify: s 0 ok; no answer silent; anything else a refusal with its text key', () => {
  assert.deepEqual(R.classify({ s: 0, d: '{}' }), { kind: 'ok' });
  assert.deepEqual(R.classify({ s: 'timeout' }), { kind: 'silent' });
  assert.deepEqual(R.classify(null), { kind: 'silent' });
  assert.deepEqual(R.classify({ s: 3, d: 'assembly_error_1' }), { kind: 'refused', s: 3, key: 'assembly_error_1' });
});

test('camp list: points as whole tiles on the map; new = not seen this run', () => {
  const pts = R.campPoints({ points: [{ x: 425, y: 643 }, { x: -1, y: 5 }, { x: 1.5, y: 2 }, { x: 1201, y: 0 }, null, { x: '426', y: '644' }] });
  assert.deepEqual(pts, [{ x: 425, y: 643 }, { x: 426, y: 644 }]);
  assert.deepEqual(R.campPoints(null), []);
  assert.deepEqual(R.newCamps(pts, { '425,643': 1 }), [{ x: 426, y: 644 }]);
  assert.equal(R.key({ x: 1, y: 2 }), '1,2');
});

test('settings: marches 1..10 (or more if the player has more; default 1), camps up to the letters held (default 10), buy on by default', () => {
  assert.deepEqual(R.clampSettings(null, { marchMax: 7, letters: 346 }), { marches: 1, camps: 10, buy: true, small: 0, large: 0 });
  assert.deepEqual(R.clampSettings({ marches: 9, camps: 400, buy: false, small: -2, large: '3' }, { marchMax: 7, letters: 346 }), { marches: 9, camps: 346, buy: false, small: 0, large: 3 }, 'the run uses what the player has at each step');
  assert.equal(R.clampSettings({ marches: 7 }, { marchMax: 6, letters: 9 }).marches, 7, 'a march count the game reads low for a moment (a buff\'s 7th march) does not cap the choice');
  assert.equal(R.clampSettings({ marches: 50 }, { marchMax: 6, letters: 9 }).marches, R.MAX_MARCHES);
  assert.equal(R.clampSettings({ marches: 12 }, { marchMax: 12, letters: 9 }).marches, 12, 'never below what the player really has');
  assert.deepEqual(R.clampSettings({ camps: 14 }, { marchMax: 7, letters: 5 }).camps, 5);
  assert.equal(R.clampSettings({}, { marchMax: 7, letters: 4 }).camps, 4);
});

test('lettersLeft, summary, gameDay', () => {
  assert.equal(R.lettersLeft({ itemId: 1700039, amount: 345 }), 345);
  assert.equal(R.lettersLeft({}), null);
  assert.equal(R.summary(1), 'Rallied 1 camp.'); assert.equal(R.summary(3), 'Rallied 3 camps.');
  assert.equal(R.gameDay(Date.UTC(2026, 9, 13, 15, 59)), '2026-10-12', '11:59 AM ET: still the day before reset');
  assert.equal(R.gameDay(Date.UTC(2026, 9, 13, 16, 1)), '2026-10-13');
});
