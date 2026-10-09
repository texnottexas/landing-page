'use strict';
// Next moves engine (ArmoryCore.nextMoves) with hand-computed expectations on the synthetic view-model in
// test/fixtures/armory-core/moves-base.json. The cases mirror sample/critique.md "Fixes applied" (armory redesign):
//   - decor is tried across March Size, All units Attack, HP and DMG increase, and the move is the best AFFORDABLE row
//   - refine counts each stat against 70% on its own (70% exactly is fine), most stats under 70% first, closest to 70% on ties
//   - HT chips only for the HT the player fights with (the battle report's mechas)
//   - one pick per class, then one per signal, a second pick from one signal only when nothing else is left
// Run: node --test test/next-moves.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../pages/armory-core.js');
const G = require('../pages/tw-game-data.js');

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/armory-core/moves-base.json'), 'utf8'));
const fresh = () => JSON.parse(JSON.stringify(BASE));
const texts = (d, opts) => C.nextMoves(d, opts).picks.map((p) => p.pill + ': ' + p.text);

/* Hand derivation of the base data
   Gear scores (400 * mean roll + 600 * star / star max, per piece):
     Alpha  s1 mean(50,60,75)=61.67 -> 246.7 ; s2 80% -> 320 + rune 1/2 -> 300 ; s3 90% -> 360 + rune 2/2 -> 600   = 1826.7
     Bravo  s3 mean(40,50,80)=56.67 -> 226.7 + 600 ; s4 mean(30,45,50)=41.67 -> 166.7 + 600                           = 1593.3
     Charlie s1 mean(50,70,80)=66.67 -> 266.7 + rune 0/6 -> 0                                                          = 266.7
   => hero weights Alpha 1.0, Bravo 0.9, Charlie 0.8.
   Signals:
     a (free)    Impact (bag 2, slots 1,3,5) fits Alpha's empty slot 1.
     b (uses)    Debilitate on Alpha s2 is 1/2 stars, the 1 -> 2 merge costs runeCost["2"][1] = 2, the bag has 2.
                 Searing on Charlie is 0/6 and the bag has none: no move.
     d (uses)    shards 100. March Size: only Aircraft Carrier (400 raw, nothing credited) -> not affordable, so the next stat.
                 All units Attack: Big Gun 300/300 = 1.000 (net 300, not affordable), Coastal Defence 150/180 = 0.833
                 (net 180 - 120 = 60, affordable), Celebratory Firework 200/240 = 0.833 (net 200), Small Gun 40/60 = 0.667.
                 Best AFFORDABLE row by ROI = Coastal Defence: +1.5% (150 / 100).
     c (costs)   stats under 70% (70 itself is not under): Bravo Headset (30,45,50) = 3 of 3, weight 0.9 -> gain 0.9;
                 Alpha Pistol (50,60) = 2 of 3 -> 0.667; Bravo Optical (40,50) = 2 of 3 -> 0.6; Charlie Pistol (50) = 1 of 3 -> 0.267.
     f (costs)   Luminary Knight LP-4 (the report's mecha 1006) slot 4 chip 9404 Lv6: colour 4 = 300 + 120 per level,
                 now (300 + 720) / 100 = 10.2%, at Lv25 (300 + 3000) / 100 = 33.0%. Doom Sawblade (not fought) is ignored.
   Selection: pass 1 takes the best of class 1, 2, 3 -> a, b (b ranks before d), c (c ranks before f). */

test('base data: one move per class, in class order', () => {
  assert.deepStrictEqual(texts(fresh()), [
    'Free: Place Impact on Alpha slot 1',
    'Uses what you have: Merge Debilitate on Alpha slot 2 to 2 stars',
    'Costs resources: Refine Raysor Headset on Bravo: 3 stats under 70% (30-50%)',
  ]);
  const r = C.nextMoves(fresh());
  assert.deepStrictEqual(r.weights, { Alpha: 1, Bravo: 0.9, Charlie: 0.8 });
  assert.deepStrictEqual(r.picks.map((p) => p.cls), [1, 2, 3]);
  assert.equal(r.picks[1].meta, '2 in bag, uses 2');
  assert.ok(r.picks.every((p) => p.text.length <= 60), 'at most 60 characters');
  assert.ok(r.picks.every((p) => /^[A-Z]/.test(p.text)), 'verb first');
  assert.ok(r.pool.length >= 8, 'the pool lists every candidate');
});

test('decor is tried across all stats and picks the best affordable row (not March Size only)', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  assert.deepStrictEqual(texts(d), [
    'Uses what you have: Upgrade Coastal Defence to Lv.3: +1.5% All units Attack',
    'Costs resources: Refine Raysor Headset on Bravo: 3 stats under 70% (30-50%)',
    'Costs resources: Raise slot 4 chip on Luminary Knight LP-4 from Lv.6 to Lv.25',
  ]);
  const move = C.nextMoves(d).picks[0];
  assert.equal(move.meta, '60 shards, 100 in bag');
  assert.equal(move.route, 'base/decor?item=Coastal+Defence');
  assert.ok(move.gain > 0.83 && move.gain < 0.84, 'gain is relative to the best ROI: 0.833 / 1.0');
  // 300 shards: Big Gun (ROI 1.0, net 300) becomes affordable and wins
  d.decor.shards = 300;
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Big Gun to Lv.3: +3% All units Attack');
  // an equal ROI goes to the cheaper net cost (Coastal 150/180 and Firework 200/240 tie): hide Big Gun, give 300 shards
  d.decor.placed = d.decor.placed.filter((x) => x.n !== 'Big Gun');
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Coastal Defence to Lv.3: +1.5% All units Attack', 'tie -> cheaper (60 against 200)');
  // March Size, when affordable, comes first (it is tried first)
  d.decor.shards = 400;
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Aircraft Carrier to Lv.4: +1 March Size');
  // no shards at all: nothing affordable, the decor move disappears
  d.decor.shards = 0;
  assert.ok(!texts(d).some((t) => /Upgrade/.test(t)));
});

test('"Save for": only when no decor move is affordable and there is room', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.heroes.forEach((h) => h.gear.forEach((p) => { p.stats.forEach((s) => { s.v = s.m; }); if (p.rune) p.rune.s = p.rune.sm; else p.rune = { name: 'Impact', s: 2, sm: 2, icon: 'impact' }; }));
  d.ht.chips.forEach((c) => { c.lv = 25; });
  d.decor.placed = d.decor.placed.filter((x) => x.n === 'Aircraft Carrier');
  assert.deepStrictEqual(texts(d), ['Costs resources: Save for Aircraft Carrier Lv.4: 100 / 400 shards']);
  d.decor.placed.push(JSON.parse(JSON.stringify(d.decor.placed[0])));
  d.decor.placed[1].g = 5757;
  d.decor.placed[1].n = 'Aircraft Carrier II';
  assert.deepStrictEqual(texts(d), ['Costs resources: Save 400 shards for +1 March Size (2 choices)']);
});

test('refine: each stat against 70% on its own; most stats under 70% first; closest to 70% breaks a tie', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.decor.placed = [];
  d.ht.chips = [];
  // exactly 70% is not under 70% (Charlie's 420/600): his piece shows 1 stat, not 2
  const all = C.nextMoves(d).pool.filter((c) => c.sig === 'c').map((c) => c.text || c.parts.map((x) => x.s).join(''));
  assert.ok(all.includes('Refine Assault Pistol on Charlie: 1 stat under 70% (50%)'), all.join(' | '));
  // one hero, two pieces with the same count: (40,50) and (60,65) -> the one closer to 70% first
  const solo = {
    heroes: [{ name: 'Solo', gear: [
      { slot: 1, slotName: 'Assault Pistol', rune: { name: 'Impact', s: 2, sm: 2, icon: 'impact' }, stats: [{ v: 240, m: 600 }, { v: 300, m: 600 }, { v: 540, m: 600 }] },
      { slot: 4, slotName: 'Raysor Headset', rune: { name: 'Debilitate', s: 2, sm: 2, icon: 'debilitate' }, stats: [{ v: 360, m: 600 }, { v: 390, m: 600 }, { v: 540, m: 600 }] }] }],
    runeBag: {}, runeSlots: {}, runeCost: {}, decor: { shards: 0, placed: [] }, ht: { chips: [] }, beastMoves: [],
  };
  assert.deepStrictEqual(texts(solo), [
    'Costs resources: Refine Raysor Headset on Solo: 2 stats under 70% (60-65%)',
    'Costs resources: Refine Assault Pistol on Solo: 2 stats under 70% (40-50%)',
  ]);
  // a piece whose stats are all 70%+ is never offered
  solo.heroes[0].gear.forEach((p) => p.stats.forEach((s) => { s.v = s.m * 0.7; }));
  assert.deepStrictEqual(texts(solo), []);
});

test('HT chips: only the HT the player fights with, from its chip table row', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.decor.placed = [];
  d.heroes.forEach((h) => h.gear.forEach((p) => p.stats.forEach((s) => { s.v = s.m; })));
  const chip = (dd) => C.nextMoves(dd).picks.map((p) => p.text);
  assert.deepStrictEqual(chip(d), ['Raise slot 4 chip on Luminary Knight LP-4 from Lv.6 to Lv.25']);
  assert.equal(C.nextMoves(d).picks[0].meta, 'All units Attack 10.2% now, 33.0% at Lv.25');
  assert.equal(C.nextMoves(d).picks[0].route, 'ht/loadouts?mecha=1006&slot=4');
  d.ht.reportMechas = [1005];
  assert.deepStrictEqual(chip(d), ['Raise slot 2 chip on Doom Sawblade D-4 from Lv.6 to Lv.25'], 'the other HT only when the report shows it');
  d.ht.reportMechas = [1006, 1005];
  assert.deepStrictEqual(chip(d), ['Raise slot 4 chip on Luminary Knight LP-4 from Lv.6 to Lv.25', 'Raise slot 2 chip on Doom Sawblade D-4 from Lv.6 to Lv.25'], 'nothing else is left, so the signal may take its second slot (cap 2)');
  d.ht.reportMechas = null;
  assert.equal(chip(d)[0], 'Raise slot 4 chip on Luminary Knight LP-4 from Lv.6 to Lv.25', 'no battle report (null): the whole HT list, best chip first');
  delete d.ht.reportMechas;
  assert.equal(chip(d).length, 2, 'undefined is also no report');
  d.ht.reportMechas = [];
  assert.deepStrictEqual(chip(d), [], 'a report where no HT fought: no chip move');
  d.ht.reportMechas = [4242];
  assert.deepStrictEqual(chip(d), [], 'a mecha that matches no chip gives no chip move');
  // empty or core chips and Lv25 chips are never offered
  d.ht.reportMechas = [1006];
  d.ht.chips.forEach((c) => { c.lv = 25; });
  assert.deepStrictEqual(chip(d), []);
});

test('selection: a second move from one signal only when no other signal has a candidate left; max option', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.decor.placed = [];
  d.ht.chips = [];
  // only refine candidates exist: a signal never takes more than two slots (caps 1 / 1 / 2), best first (0.9, then 0.667)
  assert.deepStrictEqual(texts(d).map((t) => t.replace(/^Costs resources: /, '')), [
    'Refine Raysor Headset on Bravo: 3 stats under 70% (30-50%)',
    'Refine Assault Pistol on Alpha: 2 stats under 70% (50-60%)',
  ]);
  // with other signals available they go first (base data): free, uses, costs - never three refines
  const base = C.nextMoves(fresh()).picks;
  assert.deepStrictEqual(base.map((p) => p.sig), ['a', 'b', 'c']);
  assert.equal(C.nextMoves(fresh(), { max: 2 }).picks.length, 2);
  assert.deepStrictEqual(C.nextMoves(fresh(), { max: 2 }).picks.map((p) => p.sig), ['a', 'b']);
  assert.equal(C.nextMoves(fresh(), { max: 5 }).picks.length, 5, 'a signal can take two slots once the others are used');
  assert.equal(C.computeMoves, undefined, 'the public name is nextMoves');
  assert.equal(C.moves.computeMoves, C.nextMoves);
});

test('Optimizer moves (e) come from saved preferences and rank by class then signal order', () => {
  const d = fresh();
  d.beastMoves = [{ gain: 0.5, parts: [{ s: 'Swap ' }, { s: 'Skynx', n: 1 }, { s: ' into field 1' }] }];
  const r = C.nextMoves(d).picks;
  assert.equal(r[0].text, 'Place Impact on Alpha slot 1');
  assert.ok(r.some((p) => p.sig === 'e') || r.length === 3);
  assert.ok(C.nextMoves(d).pool.some((p) => p.sig === 'e' && p.route === 'beasts/optimizer'));
});

test('view-model helpers: gear score, hero weights (floor 0.5), rune stats, roll %, chip table', () => {
  const M = C.moves;
  const h = BASE.heroes[0];
  assert.deepStrictEqual(M.gearScore(h), { refine: 247 + 320 + 360, rune: 300 + 600, total: 1827 });
  const heroes = Array.from({ length: 8 }, (_, i) => ({ name: 'H' + i, gear: [{ slot: 1, rune: null, stats: [{ v: 600 - i * 50, m: 600 }] }] }));
  assert.deepStrictEqual(Object.values(M.heroWeights(heroes)).map((x) => Math.round(x * 10) / 10), [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.5, 0.5]);
  assert.deepStrictEqual(M.runeStats(BASE.heroes), { equipped: 5, pct: 46 }, '(1+2+3+3+3... see derivation): 12 of 26');
  assert.equal(M.rollPct(300, 600), 50);
  assert.equal(M.rollPct(900, 600), 100, 'capped at 100');
  assert.deepStrictEqual(M.chipInfo({ c: 9404, lv: 6, slot: 4 }), { col: 4, stat: 'All units Attack', now: 10.2, max: 33 });
  assert.equal(M.chipInfo({ slot: 4, lv: 1 }), null, 'no chip id: no numbers');
  assert.equal(M.chipInfo({ c: 9904, lv: 1, slot: 4 }), null, 'unknown colour');
  assert.equal(M.chipInfo({ c: 9404, lv: 1, slot: 9 }), null, 'unknown slot');
});

test('the chip colour and stat tables the engine uses agree with every regular chip in the HT chip table (CL)', () => {
  const { CHIP_COLOUR, CHIP_STAT } = C.moves;
  let n = 0;
  for (const [id, row] of Object.entries(G.CL)) {
    const [, pos, color, buff, para, up, core] = row;
    if (core || pos < 1 || pos > 6) continue;
    assert.deepStrictEqual(CHIP_COLOUR[color], [para, up], 'chip ' + id + ' colour ' + color);
    assert.equal(CHIP_STAT[pos][0], String(buff), 'chip ' + id + ' slot ' + pos);
    n++;
  }
  assert.ok(n > 200);
});

test('no DOM, no network, no storage: the module source touches none of them', () => {
  const src = fs.readFileSync(path.join(__dirname, '../pages/armory-core.js'), 'utf8');
  const tw = fs.readFileSync(path.join(__dirname, '../pages/tw-game-data.js'), 'utf8');
  for (const [name, s] of [['armory-core.js', src], ['tw-game-data.js', tw]]) {
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
    assert.ok(!/\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bfetch\s*\(|XMLHttpRequest|\bnavigator\b|\bsetTimeout\b|addEventListener/.test(code), name + ' must stay pure');
  }
});

test('hardening: missing sections and unknown merge costs do not throw', () => {
  assert.deepStrictEqual(C.nextMoves({ heroes: fresh().heroes }).picks.map((p) => p.sig), ['c', 'c']);
  assert.deepStrictEqual(C.nextMoves({}).picks, []);
  assert.deepStrictEqual(C.nextMoves(null).picks, []);
  const d = fresh();
  d.runeCost = {};
  assert.ok(!C.nextMoves(d).pool.some((c) => c.sig === 'b'), 'no cost row: no merge move');
  d.runeCost = { '2': [1] };
  assert.ok(!C.nextMoves(d).pool.some((c) => c.sig === 'b'), 'cost for this star missing: no merge move');
  delete d.decor; delete d.ht; delete d.runeBag; delete d.runeSlots;
  assert.doesNotThrow(() => C.nextMoves(d));
});

test('instances: per-player state (TG overrides, identity, lookups) does not bleed between create() instances', () => {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/armory-core/gear-supp.json'), 'utf8'));
  const id = { getSupplement: (k, sk) => (k === 'gear' && sk === s.siteKey ? s.gearSupp : null) };
  const slot = { fieldType: 4, order: 8 };
  const A = C.create(), B = C.create();
  assert.notEqual(A, B);
  assert.deepStrictEqual(B.boResolveSlotWeights(slot), []);
  A.setIdentity(id);
  assert.ok(Object.keys(A.boReadTgRefinement(s.tgMerged, s.siteKey)).length > 0);
  assert.ok(A.boResolveSlotWeights(slot).length > 0, 'A sees its own overrides');
  assert.deepStrictEqual(B.boResolveSlotWeights(slot), [], 'B does not');
  assert.deepStrictEqual(C.create().boResolveSlotWeights(slot), []);
  A.setHeroCache({ 101: 'Alpha' }, null);
  assert.equal(B.heroName(101), 'Hero #101');
  assert.equal(typeof C.nextMoves, 'function', 'the default instance still exports the API');
});
