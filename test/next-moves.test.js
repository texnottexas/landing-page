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
    'Costs resources: Refine Raysor Headset on Bravo',
  ]);
  const r = C.nextMoves(fresh());
  assert.deepStrictEqual(r.weights, { Alpha: 1, Bravo: 0.9, Charlie: 0.8 });
  assert.deepStrictEqual(r.picks.map((p) => p.cls), [1, 2, 3]);
  assert.equal(r.picks[1].meta, 'Uses 2 \u00B7 2 in bag');
  assert.equal(r.picks[0].meta, '2 in bag');
  assert.equal(r.picks[2].meta, '3 stats under 70% (30-50%)', 'the numbers live on the meta line');
  assert.ok(r.picks.every((p) => p.text.length <= 60), 'at most 60 characters');
  assert.ok(r.picks.every((p) => /^[A-Z]/.test(p.text)), 'verb first');
  assert.ok(r.pool.length >= 8, 'the pool lists every candidate');
});

test('decor is tried across all stats and picks the best affordable row (not March Size only)', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  assert.deepStrictEqual(texts(d), [
    'Uses what you have: Upgrade Coastal Defence to Lv.3: +1.5% All units Attack',
    'Costs resources: Refine Raysor Headset on Bravo',
    'Costs resources: Raise slot 4 chip on Luminary Knight LP-4',
  ]);
  const move = C.nextMoves(d).picks[0];
  assert.equal(move.meta, '60 shards \u00B7 100 in bag');
  assert.equal(move.route, 'base/decor?item=Coastal+Defence');
  assert.ok(move.gain > 0.83 && move.gain < 0.84, 'gain is relative to the best ROI: 0.833 / 1.0');
  // 300 shards: Big Gun (ROI 1.0, net 300) becomes affordable and wins
  d.decor.shards = 300;
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Big Gun to Lv.3: +3% All units Attack');
  assert.equal(C.nextMoves(d).picks[0].meta, '300 shards \u00B7 300 in bag');
  // an equal ROI goes to the cheaper net cost (Coastal 150/180 and Firework 200/240 tie): hide Big Gun, give 300 shards
  d.decor.placed = d.decor.placed.filter((x) => x.n !== 'Big Gun');
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Coastal Defence to Lv.3: +1.5% All units Attack', 'tie -> cheaper (60 against 200)');
  // March Size, when affordable, comes first (it is tried first)
  d.decor.shards = 400;
  assert.equal(C.nextMoves(d).picks[0].text, 'Upgrade Aircraft Carrier to Lv.4: +1 March Size');
  assert.equal(C.nextMoves(d).picks[0].meta, '400 shards \u00B7 400 in bag');
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
  assert.deepStrictEqual(texts(d), ['Costs resources: Save for Aircraft Carrier Lv.4']);
  assert.equal(C.nextMoves(d).picks[0].meta, '100 / 400 shards');
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
  assert.ok(all.includes('Refine Assault Pistol on Charlie'), all.join(' | '));
  assert.ok(C.nextMoves(d).pool.some((c) => c.key === 'cCharlie1' && c.meta === '1 stat under 70% (50%)'), 'one stat, exactly 70% is not under');
  // one hero, two pieces with the same count: (40,50) and (60,65) -> the one closer to 70% first
  const solo = {
    heroes: [{ name: 'Solo', gear: [
      { slot: 1, slotName: 'Assault Pistol', rune: { name: 'Impact', s: 2, sm: 2, icon: 'impact' }, stats: [{ v: 240, m: 600 }, { v: 300, m: 600 }, { v: 540, m: 600 }] },
      { slot: 4, slotName: 'Raysor Headset', rune: { name: 'Debilitate', s: 2, sm: 2, icon: 'debilitate' }, stats: [{ v: 360, m: 600 }, { v: 390, m: 600 }, { v: 540, m: 600 }] }] }],
    runeBag: {}, runeSlots: {}, runeCost: {}, decor: { shards: 0, placed: [] }, ht: { chips: [] }, beastMoves: [],
  };
  assert.deepStrictEqual(texts(solo), [
    'Costs resources: Refine Raysor Headset on Solo',
    'Costs resources: Refine Assault Pistol on Solo',
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
  assert.deepStrictEqual(chip(d), ['Raise slot 4 chip on Luminary Knight LP-4']);
  assert.equal(C.nextMoves(d).picks[0].meta, 'Lv.6 to Lv.25, All units Attack 10.2% now, 33.0% at Lv.25');
  assert.equal(C.nextMoves(d).picks[0].route, 'ht/loadouts?mecha=1006&slot=4');
  d.ht.reportMechas = [1005];
  assert.deepStrictEqual(chip(d), ['Raise slot 2 chip on Doom Sawblade D-4'], 'the other HT only when the report shows it');
  d.ht.reportMechas = [1006, 1005];
  assert.deepStrictEqual(chip(d), ['Raise slot 4 chip on Luminary Knight LP-4', 'Raise slot 2 chip on Doom Sawblade D-4'], 'nothing else is left, so the signal may take its second slot (cap 2)');
  d.ht.reportMechas = null;
  assert.equal(chip(d)[0], 'Raise slot 4 chip on Luminary Knight LP-4', 'no battle report (null): the whole HT list, best chip first');
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
    'Refine Raysor Headset on Bravo',
    'Refine Assault Pistol on Alpha',
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

test('Optimizer move (e): meta and icon pass through, entries without text parts or a finite gain are dropped, the route is the Optimizer segment', () => {
  const d = fresh();
  const ico = { u: 'beast-icons/Skynx_Fire_base.png', q: 'q5', fb: 'S' };
  d.beastMoves = [
    { gain: 7, parts: [{ s: 'Swap ' }, { s: 'Skynx', n: 1 }, { s: ' into ' }, { s: 'Offense', n: 1 }, { s: ' slot ' }, { s: '3', n: 1 }, { s: ': ' }, { s: '+2.5%', n: 1 }, { s: ' Attack' }], meta: 'From bench \u00B7 7 power score points today', ico },
    { gain: NaN, parts: [{ s: 'bad' }] }, { gain: 1 }, null, { gain: 1, parts: 'nope' }
  ];
  const e = C.nextMoves(d, { max: 8 }).pool.filter((p) => p.sig === 'e');
  assert.equal(e.length, 1, 'only the well-formed move is a candidate');
  assert.equal(e[0].full, 'Swap Skynx into Offense slot 3: +2.5% Attack'); assert.equal(e[0].meta, 'From bench \u00B7 7 power score points today');
  assert.deepStrictEqual(e[0].ico, ico); assert.equal(e[0].route, 'beasts/optimizer'); assert.equal(e[0].pill, 'Free');
  // it shares the Free class with the rune placement: the rune move ranks first, the swap second (one pick per class, so with 3 picks it waits)
  const pool = C.nextMoves(d, { max: 4 }).pool.filter((p) => p.cls === 1).map((p) => p.sig); assert.deepStrictEqual(pool.slice(0, 2), ['a', 'e']);
  assert.deepStrictEqual(C.nextMoves(d, { max: 4 }).picks.map((p) => p.sig), ['a', 'e', 'b', 'c']);
  // the move is optional: no beast moves leaves the list as before
  d.beastMoves = []; assert.ok(!C.nextMoves(d).pool.some((p) => p.sig === 'e'));
  delete d.beastMoves; assert.ok(!C.nextMoves(d).pool.some((p) => p.sig === 'e'));
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

test('wording: every move reads in at most 60 characters, long names are cut with an ellipsis, numbers go to the meta line', () => {
  const LONG = 'Statue: 9th Angel - the Corrupted Mecha (Supreme Edition)';
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.decor.shards = 400;
  d.decor.placed[0].n = LONG; // Aircraft Carrier -> the longest real decoration name (March Size, 400 raw)
  d.ht.chips.forEach((c) => { c.ht = 'Heavy Mothership HC-9999 Prototype'; });
  d.heroes[1].name = 'Bradley the Unbelievably Long Named';
  const all = C.nextMoves(d, { max: 12 });
  assert.ok(all.pool.length >= 6);
  for (const c of all.pool.concat(all.picks)) {
    assert.ok(c.text.length <= 60, c.text.length + ': ' + c.text);
    assert.ok(c.full.length >= c.text.length);
  }
  const up = all.pool.find((c) => c.sig === 'd');
  assert.match(up.text, /^Upgrade Statue: 9th Angel.*\u2026 to Lv\.4: \+\d+ March Size$/, up.text);
  assert.ok(up.full.startsWith('Upgrade ' + LONG + ' to Lv.4: +'));
  assert.ok(up.text.length <= 60 && /Lv\.4: /.test(up.text), 'the level and the gain are never cut');
  const refine = all.pool.find((c) => c.sig === 'c' && c.key.startsWith('cBradley'));
  assert.match(refine.text, /Bradley/);
  // nothing short is touched
  assert.equal(C.moves.fitText([{ s: 'Place ' }, { s: 'Impact', n: 1 }]).text, 'Place Impact');
});

test('chip gain follows the colour: more remaining value first, so a high-colour chip at the same level ranks above a low one', () => {
  const d = fresh();
  d.runeBag = { Impact: 0, Debilitate: 0, Searing: 0 };
  d.decor.placed = [];
  d.heroes.forEach((h) => h.gear.forEach((p) => p.stats.forEach((s) => { s.v = s.m; })));
  d.ht.reportMechas = null;
  const chip = (ht, slot, c, lv) => ({ ht, mecha: 1, slot, core: false, lv, empty: false, c });
  d.ht.chips = [chip('Low', 4, 9101, 10), chip('High', 4, 9501, 10), chip('Mid', 4, 9301, 10)];
  const f = C.nextMoves(d, { max: 3 }).pool.filter((c) => c.sig === 'f').sort((a, b) => b.gain - a.gain).map((c) => c.key);
  assert.deepStrictEqual(f, ['fHigh4', 'fMid4', 'fLow4']);
  // gain = remaining levels x the colour's per-level value, over 25 x the best colour's (200); slots 1-3 count half
  const g = (c) => C.nextMoves(Object.assign(fresh(), { ht: { reportMechas: null, chips: [c] }, runeBag: {}, decor: { shards: 0, placed: [] } })).pool.find((x) => x.sig === 'f').gain;
  assert.equal(g(chip('H', 4, 9501, 5)), (20 * 200) / 5000);
  assert.equal(g(chip('H', 4, 9101, 5)), (20 * 40) / 5000);
  assert.equal(g(chip('H', 2, 9501, 5)), ((20 * 200) / 5000) * 0.5);
  assert.equal(C.moves.CHIP_TOP, Math.max(...Object.values(C.moves.CHIP_COLOUR).map((x) => x[1])));
});

/* ---- Refine ranked by hero power (Snapshot players): strongest hero first, then closest to 70% ---- */
const gp = (slot, vals, name) => ({ slot, slotName: name || 'Piece' + slot, rune: null, stats: vals.map((v) => ({ label: 'stat', v: v * 6, m: 600 })) });
const only = (heroes) => ({ heroes, runeBag: {}, runeSlots: {}, runeCost: {}, decor: { shards: 0, placed: [] }, ht: { chips: [], reportMechas: null }, beastMoves: [] });
const hero = (name, power, gear) => ({ name, power, gear });
const refineOrder = (d) => C.nextMoves(d, { max: 20 }).pool.filter((x) => x.sig === 'c').sort((a, b) => (b.gain - a.gain) || ((b.tie || 0) - (a.tie || 0)) || (a.key < b.key ? -1 : 1)).map((x) => x.key);

test('power: a stronger hero\'s piece with 1 of 4 under 70% beats a weaker hero\'s 4 of 4', () => {
  const d = only([hero('Weak', 100, [gp(1, [10, 20, 30, 40])]), hero('Strong', 900, [gp(1, [65, 90, 90, 90])])]);
  assert.deepStrictEqual(refineOrder(d), ['cStrong1', 'cWeak1']);
  assert.ok(C.nextMoves(d).pool.some((x) => x.sig === 'c' && /Weak/.test(x.text)));
});

test('power: inside one hero the piece whose lowest under-70 stat is closest to 70% comes first', () => {
  const d = only([hero('Solo', 500, [gp(1, [20, 30, 30, 90], 'Far'), gp(2, [68, 90, 90, 90], 'Near')])]);
  const keys = refineOrder(d);
  // Far has more stats under 70% but Near's lowest (68) is closer to 70: Near first
  assert.deepStrictEqual(keys, ['cSolo2', 'cSolo1']);
});

test('power: the 7th and 8th heroes no longer tie (no 0.5 floor), power decides', () => {
  const hs = [];
  for (let i = 0; i < 8; i++) hs.push(hero('H' + i, 1000 - i, [gp(1, [50, 90, 90])]));
  const keys = refineOrder(only(hs));
  assert.deepStrictEqual(keys, hs.map((h) => 'c' + h.name + '1'));
  // reverse the power of the last two: the order follows
  hs[6].power = 1;
  assert.deepStrictEqual(refineOrder(only(hs)).slice(-2), ['cH7' + '1', 'cH6' + '1']);
});

test('power: place and merge follow the power order', () => {
  const mk = (name, power, gearScoreBoost) => hero(name, power, [{ slot: 1, slotName: 'P', rune: null, stats: [{ label: 'stat', v: gearScoreBoost, m: 600 }] }]);
  // Low has the better gear score but less power
  const d = only([mk('Low', 10, 600), mk('High', 99, 100)]);
  d.runeBag = { Impact: 2 }; d.runeSlots = { Impact: [1] };
  assert.deepStrictEqual(C.nextMoves(d, { max: 5 }).pool.filter((x) => x.sig === 'a').sort((a, b) => b.weight - a.weight).map((x) => x.key), ['aHigh1', 'aLow1']);
  assert.deepStrictEqual(C.moves.heroWeights(d.heroes), { High: 1, Low: 0.9 });
  assert.deepStrictEqual(C.moves.heroRank(d.heroes).rank, { High: 0, Low: 1 });
});

test('power missing on any hero: the old order (gear score, share of stats under 70%) is unchanged', () => {
  const d = fresh();
  d.heroes.forEach((h, i) => { h.power = i === 0 ? undefined : 1000 - i; });
  assert.deepStrictEqual(texts(d), texts(fresh()));
  d.heroes.forEach((h) => { h.power = 5; });
  d.heroes[1].power = 0;
  assert.deepStrictEqual(texts(d), texts(fresh()));
  assert.deepStrictEqual(C.nextMoves(d).weights, { Alpha: 1, Bravo: 0.9, Charlie: 0.8 });
  assert.equal(C.moves.heroRank(d.heroes).byPower, false);
});
