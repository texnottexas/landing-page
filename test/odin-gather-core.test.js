'use strict';
// Odinium Gatherer (Tex 2026-10-16): the pure rules. Facts from the live game on Rеx (2026-10-16): the Alliance Log's
// Refine Center entries, the map view's facility tiles, the facility info, and the deploy screen's load and time formula.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../odin-gather-core.js');

const TMPL = 'Well done! The Lv. {4} {5} ({2},{3}) built by {0} - {1} is completed.';
const rec = (x, y, at, o) => Object.assign({ type: 10, tampTime: at, targetPosArr: [{ x, y }], msg: 'Well done! The Lv. 3 Refine Center (' + x + ',' + y + ') built by  - Agnes💭 is completed.' }, o || {});

test('logFacilities: Lv. 3 Refine Centers from the Alliance Log, newest first, under 10 h old, one per tile', () => {
  const now = 100000;
  const list = O.logFacilities([
    rec(402, 690, now - 600),
    rec(433, 705, now - 3600, { msg: 'Well done! The Lv. 3 Refine Center (433,705) built by  - Mox is completed.' }),
    rec(1, 1, now - 100, { type: 1 }),                                         // a Gold facility
    rec(2, 2, now - 100, { msg: 'Well done! The Lv. 2 Refine Center (2,2) built by  - Lo is completed.' }),
    rec(3, 3, now - 36001),                                                    // ended
    rec(402, 690, now - 7200)                                                  // the same tile, older: dropped
  ], TMPL, now);
  assert.deepEqual(list, [
    { x: 402, y: 690, level: 3, builder: 'Agnes💭', at: now - 600 },
    { x: 433, y: 705, level: 3, builder: 'Mox', at: now - 3600 }
  ]);
  assert.deepEqual(O.logFacilities(null, TMPL, now), []);
  assert.deepEqual(O.logFacilities([rec(5, 5, now - 10, { msg: 'garbled' })], TMPL, now), [], 'a message that does not match the template is left out');
});

test('towersInView: own alliance, Lv. 3 Refine Center (bid 71003), completed (st 3); no player ids kept', () => {
  const ans = { s: 0, d: { pointList: [
    { x: 387, y: 593, pointType: 24, b: { id: '4887970461680820224', bid: 71003, st: 3, aid: 500274461, pid: 'secret', playerInfo: '{"uid":"x"}' } },
    { x: 388, y: 594, pointType: 24, b: { id: '4888051048085086216', bid: 71003, st: 3, aid: 500273604, pid: 'secret', playerInfo: '{"uid":"y"}' } },
    { x: 388, y: 592, pointType: 24, b: { id: '1', bid: 71003, st: 2, aid: 500273604 } },
    { x: 380, y: 590, pointType: 24, b: { id: '2', bid: 71002, st: 3, aid: 500273604 } },
    { x: 381, y: 591, pointType: 1 }
  ] } };
  const t = O.towersInView(ans, 500273604);
  assert.deepEqual(t, [{ x: 388, y: 594, id: '4888051048085086216', bid: 71003, st: 3 }]);
  assert.ok(!JSON.stringify(t).includes('secret'));
  assert.deepEqual(O.towersInView({ s: 0, d: JSON.stringify(ans.d) }, 500273604).length, 1, 'a string body is parsed');
  assert.deepEqual(O.towersInView({ timeout: true }, 1), []);
});

test('timeLeft: 10 h after completion, never below 0', () => {
  assert.equal(O.timeLeft(1000, 1000 + 3600, 36000), 32400);
  assert.equal(O.timeLeft(1000, 1000 + 40000, 36000), 0);
  assert.equal(O.timeLeft(1000, 1000 + 3600), 32400, 'default duration 36000');
});

test('speedOf: (base x coefficient + flat) x (1 + buffs % + heroes %)', () => {
  assert.ok(Math.abs(O.speedOf({ gatherSpeed: 0.005, coefficient: 1.2, addFlat: 0, pct: 2.375, heroPct: 0 }) - 0.02025) < 1e-12);
  assert.ok(Math.abs(O.speedOf({ gatherSpeed: 0.005, coefficient: 1.2, addFlat: 0.001, pct: 1, heroPct: 0.5 }) - 0.007 * 2.5) < 1e-12);
  assert.equal(O.speedOf({ gatherSpeed: 0, coefficient: 1.2 }), 0);
});

test('predict: load = floor((sum of unit loads + flat x (1 + u)) / load factor); seconds = ceil(load / speed)', () => {
  const loads = Array(226).fill(294600);
  const p = O.predict({ unitLoads: loads, loadAdd: 0, u: 0, loadFactor: 40000, speed: 0.02025 });
  assert.equal(p.load, 1664);
  assert.equal(p.seconds, Math.ceil(1664 / 0.02025));
  assert.equal(O.predict({ unitLoads: [40000], loadAdd: 40000, u: 1, loadFactor: 40000, speed: 1 }).load, 3);
  assert.equal(O.predict({ unitLoads: [], loadAdd: 0, u: 0, loadFactor: 40000, speed: 0 }).seconds, 0, 'no speed: no time');
});

// Units in the shape the wiring builds: power, type, mecha (HT), thor (Valhalla), and each unit's own load.
const U = (armyID, power, o) => Object.assign({ armyID, power, type: 101, mecha: 0, thor: 0, battleMecha: false, load: 294600 }, o || {});
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const base = { slots: [200, 200, 200, 200, 200, 200, 200, 200, 200], free: 2500, target: 1e9, oneKey: true, speed: 0.02025, loadFactor: 40000, loadAdd: 0, u: 0 };

test('planTroops: the game\'s gathering order: normal units first, then Valhalla, then HT; one unit kind per slot; pos mapping', () => {
  const units = [].concat(many(3, () => U(9, 900, { mecha: 5, battleMecha: true, load: 131000 * 2.455 })), many(3, () => U(8, 800, { thor: 2 })), many(3, () => U(7, 50)));
  const p = O.planTroops(units, Object.assign({}, base, { slots: [2, 2, 2, 2, 2] }));
  assert.deepEqual(p.army, [{ pos: 1, armyId: 7, armyNum: 2 }, { pos: 2, armyId: 7, armyNum: 1 }, { pos: 3, armyId: 8, armyNum: 2 }, { pos: 11, armyId: 8, armyNum: 1 }, { pos: 12, armyId: 9, armyNum: 2 }]);
  assert.equal(p.units, 8);
});

test('planTroops: stops at the facility\'s free capacity', () => {
  const p = O.planTroops(many(500, () => U(7, 50)), Object.assign({}, base, { free: 100 }));
  assert.equal(p.units, 100);
});

test('planTroops: stops at the first unit count that gathers for at least the time left, never more than an hour over', () => {
  const perUnit = Math.ceil(Math.floor(294600 / 40000) / 0.02025);   // about 346 s a unit
  const target = 7200;
  const p = O.planTroops(many(2000, () => U(7, 50)), Object.assign({}, base, { target }));
  assert.ok(p.seconds >= target, 'fills at or after the time left: ' + p.seconds);
  assert.ok(p.seconds <= target + 3600, 'not more than an hour over: ' + p.seconds);
  const fewer = O.predict({ unitLoads: Array(p.units - 1).fill(294600), loadAdd: 0, u: 0, loadFactor: 40000, speed: 0.02025 });
  assert.ok(fewer.seconds < target, 'one unit fewer would end early');
  assert.ok(perUnit < 3600);
});

test('planTroops: when every free unit still ends early, it takes them all; no units, no march', () => {
  const p = O.planTroops(many(5, () => U(7, 50)), Object.assign({}, base, { target: 36000 }));
  assert.equal(p.units, 5);
  assert.ok(p.seconds < 36000);
  assert.deepEqual(O.planTroops([], base).army, []);
  assert.equal(O.planTroops([], base).units, 0);
});

test('planTroops: one Heavy Trooper slot only; healing HT left out', () => {
  const units = [].concat(many(2, () => U(9, 900, { mecha: 5, battleMecha: true })), many(2, () => U(10, 950, { mecha: 6, battleMecha: true })));
  const p = O.planTroops(units, Object.assign({}, base, { slots: [1, 1, 1] }));
  assert.equal(p.army.length, 1, 'one HT slot: ' + JSON.stringify(p.army));
  const q = O.planTroops(many(2, () => U(9, 900, { mecha: 5, battleMecha: true })), Object.assign({}, base, { healing: { 5: 1 } }));
  assert.equal(q.units, 0);
});

test('planTroops: without the one-tap gathering setting, strongest first (no category order)', () => {
  const units = [].concat(many(2, () => U(8, 800, { thor: 2 })), many(2, () => U(7, 50)));
  const p = O.planTroops(units, Object.assign({}, base, { oneKey: false, slots: [2] }));
  assert.deepEqual(p.army, [{ pos: 1, armyId: 8, armyNum: 2 }]);
});

test('pickHeroes: the top gatherers by their buff score', () => {
  assert.deepEqual(O.pickHeroes([{ id: 1, score: 0.1 }, { id: 2, score: 0.755 }, { id: 3, score: 0.683 }, { id: 4, score: 0.65 }], { max: 3 }), [2, 3, 4]);
  assert.deepEqual(O.pickHeroes([], { max: 3 }), []);
});

test('rank: the most Odinium first: more time to gather, then a faster tier', () => {
  const r = O.rank([{ k: 'short', left: 3600, free: 2500, speed: 0.02 }, { k: 'long', left: 30000, free: 2500, speed: 0.02 }, { k: 'fast', left: 30000, free: 2500, speed: 0.04 }]);
  assert.deepEqual(r.map((f) => f.k), ['fast', 'long', 'short']);
});

test('gate: marches 6 a minute and 20 per 10 minutes; views 10 and infos 20 per 10 minutes', () => {
  const now = 1e7, m = (t) => ({ t, kind: 'march' });
  assert.equal(O.gate(many(6, (i) => m(now - 1000 * i)), now, 'march').ok, false);
  assert.equal(O.gate(many(5, (i) => m(now - 1000 * i)), now, 'march').ok, true);
  assert.equal(O.gate(many(20, (i) => m(now - 61000 - 20000 * i)), now, 'march').ok, false);
  const g = O.gate(many(6, (i) => m(now - 1000 * i)), now, 'march');
  assert.ok(g.until > now && /6 marches a minute/.test(g.reason));
  assert.equal(O.gate(many(10, (i) => ({ t: now - i * 1000, kind: 'view' })), now, 'view').ok, false);
  assert.equal(O.gate(many(10, (i) => ({ t: now - i * 1000, kind: 'view' })), now, 'info').ok, true, 'caps are per kind');
  assert.equal(O.gate(many(20, (i) => ({ t: now - i * 1000, kind: 'info' })), now, 'info').ok, false);
});

test('classify: ok, silent or refused', () => {
  assert.equal(O.classify({ s: 0 }), 'ok');
  assert.equal(O.classify({ timeout: true }), 'silent');
  assert.equal(O.classify({ s: 3, key: 'x' }), 'refused');
  assert.equal(O.classify(null), 'silent');
});

test('bestSkin: the owned skin with the biggest gathering bonus, if it beats the one worn', () => {
  assert.equal(O.bestSkin([], 1), null);
  assert.deepEqual(O.bestSkin([{ id: 1752000, pct: 0.1 }, { id: 1712000, pct: 0.2 }], 1719000), { id: 1712000, pct: 0.2 });
  assert.equal(O.bestSkin([{ id: 1752000, pct: 0.1 }], 1752000), null, 'already wearing it');
  assert.equal(O.bestSkin([{ id: 1752000, pct: 0.1 }, { id: 1894000, pct: 0.05 }], 1894000).id, 1752000);
});

test('constants: Lv. 3 Refine Center, 10 h, slot positions', () => {
  assert.equal(O.BID, 71003);
  assert.equal(O.DURATION, 36000);
  assert.deepEqual(O.SLOT_POS, [1, 2, 3, 11, 12, 13, 21, 22, 23]);
});

test('gameDay: the game day runs from reset (12:00 ET), named by the date it starts on', () => {
  assert.equal(O.gameDay(Date.UTC(2026, 9, 16, 15, 59)), '2026-10-15');   // 11:59 ET
  assert.equal(O.gameDay(Date.UTC(2026, 9, 16, 16, 0)), '2026-10-16');    // 12:00 ET
});

test('gate: skin changes 6 an hour (review C2)', () => {
  const now = 1e8;
  assert.equal(O.gate(Array.from({ length: 6 }, (_, i) => ({ t: now - i * 60000, kind: 'skin' })), now, 'skin').ok, false);
  assert.equal(O.gate(Array.from({ length: 5 }, (_, i) => ({ t: now - i * 60000, kind: 'skin' })), now, 'skin').ok, true);
  assert.match(O.gate(Array.from({ length: 6 }, (_, i) => ({ t: now - i * 60000, kind: 'skin' })), now, 'skin').reason, /6 skin changes an hour/);
});
