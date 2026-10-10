'use strict';
// ArmoryHtLogic (pages/armory-ht.js): the HT section's data rules, on synthetic chips (ids from the public Mecha_chip table in tw-game-data).
// Expected numbers are hand-computed from the table rows quoted in each test, the way the classic HT tab computes them.
// Run: node --test test/armory-ht.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../pages/armory-ht.js');
const G = require('../pages/tw-game-data.js');
const Core = require('../pages/armory-core.js');

const core = Core.create();
const NOW = Date.now();

test('fmtPct is the classic one: basis points to a trimmed percent', () => {
  assert.equal(L.fmtPct(0), '0%');
  assert.equal(L.fmtPct(1000), '10%');
  assert.equal(L.fmtPct(1050), '10.5%');
  assert.equal(L.fmtPct(10000), '100%');
  assert.equal(L.fmtPct(3606), '36.06%');
  assert.equal(L.fmtPct('<img>'), '0%');
});

test('loadout: seven positions, values = base + per x level, max at Lv.25, set bonuses from the core set', () => {
  // CL 9400 = [110, 0, 4, 0, 0, 0, 301010] core Ring of Cosmos Epic; 9404 = [110, 4, 4, 930100, 300, 120, 0]; 9405 = slot 5 same set; 9401 = slot 1
  const l = L.loadout(G, 1006, [{ chipId: 9400, level: 3 }, { chipId: 9404, level: 6, rndAttrs: '0;1000' }, { chipId: 9405, level: 25 }, { chipId: 9401 }]);
  assert.equal(l.name, 'Luminary Knight LP-4');
  assert.deepEqual(l.slots.map((s) => [s.slot, s.empty]), [[0, false], [1, false], [2, true], [3, true], [4, false], [5, false], [6, true]]);
  assert.equal(l.count, 4); assert.equal(l.filled, 4);
  const s4 = l.slots[4];
  assert.equal(s4.now, 300 + 120 * 6); assert.equal(s4.max, 300 + 120 * 25); assert.equal(s4.stat, 'All units Attack');
  assert.equal(l.slots[5].now, 300 + 120 * 25, 'Lv.25 is its own max');
  assert.equal(l.slots[1].lv, 0); assert.equal(l.slots[1].now, 300, 'no level reads as Lv.0');
  assert.equal(l.slots[0].now, null, 'the core has no base stat'); assert.equal(l.slots[0].coreSkill, 'Cosmos Ring: HT ATK + DMG');
  assert.equal(l.coreSetName, 'Ring of Cosmos'); assert.equal(l.rarity, 'Epic'); assert.equal(l.match, 3);
  // 3 matching chips: the 2pc tier is on (HT ATK +36%), 4pc and 6pc are not
  assert.deepEqual(l.bonuses.map((b) => [b.count, b.on, b.base]), [[2, true, 3600], [4, false, 3600], [6, false, 1800]]);
  assert.deepEqual(l.cumul, [{ desc: 'HT ATK', val: 3600 }]);
  assert.equal(l.mixed, null);
  assert.deepEqual(s4.rnd, [{ buff: 932001, name: 'HT Attack', val: 1000 }].map((r) => Object.assign({}, r, { buff: G.RND_GLO[0], name: G.BUFF_NAMES_CHIP[G.RND_GLO[0]] })));
});

test('loadout: a second set shows as Mixed; no core means no set, no rarity and no bonuses; unknown ids are skipped', () => {
  const l = L.loadout(G, 1005, [{ chipId: 9401, level: 1 }, { chipId: 8402, level: 1 }, { chipId: 99999999 }, null, 'x']);
  assert.equal(l.coreSet, null); assert.equal(l.rarity, ''); assert.deepEqual(l.bonuses, []); assert.deepEqual(l.cumul, []);
  assert.equal(l.mixed.length, 2); assert.equal(l.count, 5, 'classic counts the list length');
  assert.equal(l.filled, 2);
});

test('loadout: values that are not numbers or ids never reach the page as text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const l = L.loadout(G, evil, [{ chipId: evil, level: evil, rndAttrs: evil }, { chipId: '__proto__' }, { chipId: 'constructor' }, { chipId: 9404, level: evil, rndAttrs: evil + ';' + evil }]);
  assert.equal(l.mecha, 0); assert.equal(l.name, 'HT 0');
  const s = l.slots[4];
  assert.equal(s.lv, 0); assert.deepEqual(s.rnd, []);
  assert.ok(!JSON.stringify(l).includes('<'), 'no payload text survives in the model');
});

test('decodeRnd: pool by position (core / slots 1-3 / slots 4-6), unknown index reads as an unknown buff, broken tokens are dropped', () => {
  assert.deepEqual(L.decodeRnd(G, '0;1000', 0), [{ buff: G.RND_CORE[0], name: G.BUFF_NAMES_CHIP[G.RND_CORE[0]], val: 1000 }]);
  assert.equal(L.decodeRnd(G, '0;50', 2)[0].buff, G.RND_REG[0]);
  assert.equal(L.decodeRnd(G, '1;50', 5)[0].buff, G.RND_GLO[1]);
  assert.deepEqual(L.decodeRnd(G, '9999;5', 2), [{ buff: 0, name: 'Buff #0', val: 5 }]);
  assert.deepEqual(L.decodeRnd(G, 'x;y|;|3', 1), []);
  assert.deepEqual(L.decodeRnd(G, null, 1), []);
});

const merged = { mechas: [{ mechaId: 1006, chips: [{ chipId: 9404, level: 6 }] }, { mechaId: 1005, chips: [{ chipId: 8402, level: 2 }] }, { mechaId: 1008, chips: [{ chipId: 9400, level: 1 }] }, { mechaId: 1003, chips: [] }] };
test('loadouts: HTs the player fights with come first, 1008 and empty HTs are left out, the source is named', () => {
  const ls = L.loadouts(core, G, merged, {}, [], [1005]);
  assert.deepEqual(ls.map((l) => [l.mecha, l.fights, l.source]), [[1005, true, 'battle reports'], [1006, false, 'battle reports']]);
  assert.deepEqual(L.loadouts(core, G, merged, {}, [], null).map((l) => l.mecha), [1006, 1005], 'no report info: the report order');
  assert.deepEqual(L.loadouts(core, G, { mechas: [] }, {}, [], null), []);
});
test('loadouts: a chips supplement newer than the report wins for that HT and says so', () => {
  const supp = { chips: { ts: new Date(NOW).toISOString(), chips: [{ m: 1006, c: 9503, lv: 2 }, { m: 1007, c: 9401, lv: 9, r: '0;7' }, { c: 9402, lv: 5 }] } };
  const ls = L.loadouts(core, G, merged, supp, [], [1006]);
  const l6 = ls.find((l) => l.mecha === 1006), l7 = ls.find((l) => l.mecha === 1007);
  assert.equal(l6.source, 'game data'); assert.equal(l6.slots[3].lv, 2); assert.equal(l6.slots[4].empty, true, 'the report chip is replaced, not merged');
  assert.equal(l7.slots[1].lv, 9); assert.equal(l7.source, 'game data');
  assert.ok(ls.find((l) => l.mecha === 1005).source === 'battle reports');
});

test('mothership: pieces from the bag, equipped / level / power from the supplement, its chips as a loadout; null when there is nothing', () => {
  assert.equal(L.mothership(G, {}, null), null);
  const inv = { tabs: { item: [{ id: 51071, amount: 3 }, { i: 51079, n: 2 }, { id: 5, amount: 99 }, { id: 51072, amt: 1 }] } };
  const supp = { chips: { chips: [{ m: 1008, c: 9401, lv: 4 }, { c: 9402 }], mothership: { ep: 4, l: 7, p: 123456 } } };
  const m = L.mothership(G, supp, inv);
  assert.equal(m.pieces, 6); assert.equal(m.equipped, 4); assert.equal(m.level, 7); assert.equal(m.power, 123456);
  assert.equal(m.loadout.slots[1].lv, 4);
  assert.equal(L.mothership(G, {}, { tabs: { item: [] } }), null, 'no pieces, no chips, no supplement entry');
  const e = '<b>x</b>';
  const h = L.mothership(G, { chips: { chips: [], mothership: { ep: e, l: e, p: e, chips: [{ c: e, lv: e, r: e }] } } }, { tabs: { item: [{ id: 51071, amount: e }] } });
  assert.equal(h.equipped, 0); assert.equal(h.level, 0); assert.equal(h.power, 0); assert.equal(h.pieces, 0);
  assert.ok(!JSON.stringify(h).includes('<'));
});

const raw = [
  { c: 9404, lv: 6, m: 1006, r: '0;1000|1;500', rt: 2, rs: 3 }, { c: 9401, lv: 25 }, { c: 8500, lv: 1, m: 1005 }, { c: 9503, lv: 10, r: '0;300' }, { c: 424242 }, null, 'x', { c: 9402, lv: 3, m: 1006 }
];
test('pool: every chip is a row with its set, slot, colour and decoded stats; an unknown id still shows', () => {
  const rows = L.poolRows(G, raw);
  assert.equal(rows.length, 6, 'null and a string are dropped, the unknown id stays');
  const a = rows[0];
  assert.deepEqual([a.chipId, a.lv, a.mecha, a.refine, a.locked, a.set, a.slot, a.col, a.setName, a.rar], [9404, 6, 1006, 2, true, 110, 4, 4, 'Ring of Cosmos', 'Epic']);
  assert.deepEqual(a.rnd.map((r) => r.val), [1000, 500]);
  const u = rows.find((r) => r.chipId === 424242);
  assert.deepEqual([u.set, u.slot, u.col, u.setName, u.rnd], [null, null, 1, 'Unknown chip', []]);
  assert.deepEqual(L.poolRows(G, 'nope'), []);
});
test('pool options count what is there, and the filters narrow it like classic: set / slot / rarity / bound HT / stat / lock', () => {
  const rows = L.poolRows(G, raw), o = L.poolOptions(G, rows);
  assert.deepEqual(o.set[0], ['', 'All sets']); assert.ok(o.set.some((x) => x[0] === '110' && /Ring of Cosmos \(4\)/.test(x[1])));
  assert.deepEqual(o.slot.map((x) => x[0]), ['', '0', '1', '2', '3', '4']);
  assert.deepEqual(o.rar.map((x) => x[1]), ['All rarities', 'Legendary (2)', 'Epic (3)', 'Common (1)']);
  assert.ok(o.mecha.some((x) => x[0] === '0' && /^Universal \(3\)$/.test(x[1])));
  const base = { set: '', slot: '', rar: '', mecha: '', stat: '', sort: 'rarity', lock: 'all' };
  const f = (st) => L.poolFilter(rows, Object.assign({}, base, st)).map((r) => r.chipId);
  assert.deepEqual(f({ set: '109' }), [8500]);
  assert.deepEqual(f({ slot: '0' }), [8500]);
  assert.deepEqual(f({ rar: '5' }), [9503, 8500]);
  assert.deepEqual(f({ mecha: '1006' }).sort(), [9402, 9404]);
  assert.deepEqual(f({ mecha: '0' }).sort((a, b) => a - b), [9401, 9503, 424242]);
  assert.deepEqual(f({ lock: 'locked' }), [9404]);
  assert.equal(f({ lock: 'unlocked' }).length, 5);
  const bid = String(G.RND_GLO[0]);
  assert.deepEqual(f({ stat: String(G.RND_REG[0]) }), [9503], 'slot 3 (regular pool) idx 0');
  assert.deepEqual(f({ stat: bid }), [9404], 'slot 4 (global pool) idx 0');
  assert.notEqual(bid, String(G.RND_REG[0]));
});
test('pool sort: rarity (then level, slot), level, set, slot, refines', () => {
  const rows = L.poolRows(G, raw), base = { set: '', slot: '', rar: '', mecha: '', stat: '', lock: 'all' };
  const s = (k) => L.poolFilter(rows, Object.assign({}, base, { sort: k })).map((r) => r.chipId);
  assert.deepEqual(s('rarity'), [9503, 8500, 9401, 9404, 9402, 424242]);
  assert.deepEqual(s('level'), [9401, 9503, 9404, 9402, 8500, 424242]);
  assert.deepEqual(s('slot'), [8500, 9401, 9402, 9503, 9404, 424242], 'an unknown slot sorts last');
  assert.equal(s('refine')[0], 9404);
  assert.equal(s('set')[0], 8500);
  assert.deepEqual(s('bogus'), s('rarity'), 'an unknown sort falls back to rarity');
});

test('a chips supplement whose bound-HT field is not a number is skipped, not fatal (the whole page used to fall to its error screen)', () => {
  const VM = require('../pages/armory-vm.js');
  const supp = { chips: { ts: new Date(NOW).toISOString(), chips: [{ m: '<img src=x onerror=alert(1)>', c: 9401, lv: 2 }, { m: 'NaN', c: 9402 }, { m: 1006, c: 9401, lv: 3 }] } };
  const mg = { heroes: [], decorations: { ids: [], suit: [] }, enigmas: null, mechas: [] };
  assert.doesNotThrow(() => L.loadouts(core, G, mg, supp, [], null));
  assert.deepEqual(L.loadouts(core, G, mg, supp, [], null).map((l) => l.mecha), [1006]);
  const vm = VM.buildViewModel(mg, { reportsTs: 0, dataTs: NOW, kinds: ['chips'] }, { core, supp, statics: {}, reports: [], reportMechaIds: null });
  assert.equal(vm.ht.count, 1);
});
test('cleanChips keeps whole-number bound-HT fields only (numbers and digit strings), drops the rest, and leaves a missing list alone', () => {
  const VM = require('../pages/armory-vm.js');
  const cs = { ts: 't', chips: [{ m: 1006 }, { m: '1005' }, { m: 0 }, {}, { m: true }, { m: [1] }, { m: {} }, { m: -3 }, { m: 1.5 }, null, 'x'] };
  assert.deepEqual(VM.cleanChips(cs).chips.length, 5, '1006, "1005", 0, no field, and [1] (it reads as 1 and is harmless)');
  assert.equal(VM.cleanChips(cs).ts, 't'); assert.equal(cs.chips.length, 11, 'the input is not changed');
  assert.equal(VM.cleanChips(null), null); assert.deepEqual(VM.cleanChips({ ts: 1 }), { ts: 1 });
});
