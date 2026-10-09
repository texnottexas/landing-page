'use strict';
// ArmoryCore.advice.basePool (decision 2 of the Armory v2 phase 4 plan): the ONE rune base-pool rule. Newest wins between a
// hand-entered / advice-applied rune pool and the game-data import; tier 0 of `pool` is the bag only. Synthetic data only
// (fixtures/armory-core/runepool.json has the bag items, gear and item table; no player ids).
// Run: node --test test/advice-pool.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../pages/armory-core.js');
const P = require('./helpers/armory-page.js');

const F = P.fixture('runepool.json');
const GS = P.fixture('gear-supp.json');
const LK = F.lookups;
const T1 = '2026-10-01T00:00:00.000Z', T2 = '2026-10-05T00:00:00.000Z', T3 = '2026-10-08T00:00:00.000Z';
const inv = (ts) => Object.assign({ meta: ts ? { ts } : undefined }, JSON.parse(JSON.stringify(F.inv)));
// the fixture gear plus one unequipped 0-star Impact and one unequipped 3-star Searing
const gear = (ts) => ({ meta: ts ? { ts } : undefined, goldGear: F.gear.goldGear.concat([
  { heroId: 0, buffs: [{ type: 'rune', name: 'Impact', star: 0 }] }, { heroId: 0, buffs: [{ type: 'rune', name: 'Searing', star: 3 }] }]) });
const stored = (ts, source, pool) => ({ meta: ts ? { ts } : undefined, source, pool: pool || { Impact: { 0: 9, 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, Wildfire: { 0: 1, 1: 0, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0 } } });
const bp = (o) => Core.advice.basePool(Object.assign({ lookups: LK }, o));

function shapeOk(r) {
  assert.deepStrictEqual(Object.keys(r).sort(), ['bag', 'importTs', 'known', 'pool', 'poolTs', 'source', 'stale', 'storedSource', 'unequipped', 'upgraded']);
  Object.keys(r.pool).forEach((n) => {
    assert.equal(r.pool[n][0], r.bag[n], 'tier 0 is the bag: ' + n);
    for (let s = 1; s <= 6; s++) assert.equal(r.pool[n][s], 0, 'tier ' + s + ' is 0: ' + n);
  });
  Object.keys(r.bag).forEach((n) => assert.ok(r.pool[n], 'every bag rune has a pool row'));
}

test('nothing at all: not known, source none', () => {
  const r = bp({});
  shapeOk(r);
  assert.equal(r.known, false); assert.equal(r.source, 'none'); assert.equal(r.stale, false); assert.equal(r.storedSource, null);
  assert.deepStrictEqual(r.bag, {}); assert.deepStrictEqual(r.pool, {});
  shapeOk(Core.advice.basePool()); shapeOk(Core.advice.basePool(null));
});

test('import only: bag from the inventory item table, unequipped = pool tier 0 minus bag, upgraded from the other tiers', () => {
  const r = bp({ inv: inv(T1), gear: gear(T1) });
  shapeOk(r);
  assert.equal(r.known, true); assert.equal(r.source, 'import'); assert.equal(r.stale, false); assert.equal(r.storedSource, null);
  assert.equal(r.bag.Impact, 4); assert.equal(r.bag.Magnetize, 7); assert.equal(r.bag.Searing, 1);
  assert.equal(r.unequipped.Impact, 1, 'the unequipped 0-star Impact piece (hand check)');
  assert.equal(r.unequipped.Searing, undefined, 'a 3-star rune is not returnable');
  assert.deepStrictEqual(r.upgraded.Impact, { 1: 1 }); assert.deepStrictEqual(r.upgraded.Searing, { 3: 1 });
  assert.deepStrictEqual(r.upgraded['Artillery Storm'], { 6: 1 });
  assert.equal(r.importTs, Date.parse(T1)); assert.equal(r.poolTs, 0);
  const noGear = bp({ inv: inv(T1) });
  assert.deepStrictEqual(noGear.unequipped, {}); assert.equal(noGear.bag.Impact, 4);
});

test('a stored pool newer than the import wins: tier 0 = bag, tier 1 = returnable, tiers 2-6 = upgraded', () => {
  const r = bp({ inv: inv(T1), gear: gear(T1), runepool: stored(T2, 'manual') });
  shapeOk(r);
  assert.equal(r.source, 'stored'); assert.equal(r.storedSource, 'manual'); assert.equal(r.stale, false); assert.equal(r.known, true);
  assert.equal(r.bag.Impact, 9); assert.equal(r.bag.Wildfire, 1); assert.equal(r.bag.Magnetize, undefined, 'the import is ignored wholesale');
  assert.equal(r.unequipped.Impact, 2); assert.deepStrictEqual(r.upgraded.Wildfire, { 3: 4 });
  assert.equal(r.poolTs, Date.parse(T2)); assert.equal(r.importTs, Date.parse(T1));
});

test('a stored pool older than the import is ignored and flagged stale', () => {
  const r = bp({ inv: inv(T2), gear: gear(T2), runepool: stored(T1, 'manual') });
  shapeOk(r);
  assert.equal(r.source, 'import'); assert.equal(r.stale, true); assert.equal(r.bag.Impact, 4); assert.equal(r.storedSource, null);
});

test('equal timestamps: the import wins', () => {
  const r = bp({ inv: inv(T2), gear: gear(T2), runepool: stored(T2, 'manual') });
  assert.equal(r.source, 'import'); assert.equal(r.stale, true);
});

test('a stored pool with no import at all always counts, even without a timestamp', () => {
  let r = bp({ runepool: stored(T1, 'manual') });
  shapeOk(r);
  assert.equal(r.source, 'stored'); assert.equal(r.known, true); assert.equal(r.bag.Impact, 9);
  r = bp({ runepool: stored(null, 'manual') });
  assert.equal(r.source, 'stored'); assert.equal(r.known, true);
  r = bp({ gear: gear(null), runepool: stored(null, 'manual') });
  assert.equal(r.source, 'stored', 'no timestamps anywhere: the stored pool counts');
});

test('advisor-applied and advisor-onbehalf snapshots follow the same rule and nothing else', () => {
  for (const src of ['advisor-applied', 'advisor-onbehalf']) {
    const newer = bp({ inv: inv(T1), runepool: stored(T3, src) });
    assert.equal(newer.source, 'stored'); assert.equal(newer.storedSource, src);
    const older = bp({ inv: inv(T3), runepool: stored(T1, src) });
    assert.equal(older.source, 'import'); assert.equal(older.stale, true, src + ' stops masking once the player imports again');
  }
  assert.equal(bp({ runepool: stored(T1, 'something else') }).storedSource, 'manual', 'an unknown source reads as manual');
  assert.equal(bp({ runepool: stored(T1, '<img src=x onerror=1>') }).storedSource, 'manual');
});

test('timestamps: ISO strings, epoch numbers and ts / meta.ts all compare', () => {
  assert.equal(Core.advice.tsOf({ meta: { ts: T1 } }), Date.parse(T1));
  assert.equal(Core.advice.tsOf({ ts: T1 }), Date.parse(T1));
  assert.equal(Core.advice.tsOf({ ts: Date.parse(T2) }), Date.parse(T2));
  assert.equal(Core.advice.tsOf({ meta: { ts: T1 }, ts: T3 }), Date.parse(T1), 'meta.ts first');
  assert.equal(Core.advice.tsOf({ ts: 'not a date' }), 0); assert.equal(Core.advice.tsOf(null), 0); assert.equal(Core.advice.tsOf({}), 0);
  const mixed = bp({ inv: inv(T1), runepool: { ts: Date.parse(T3), source: 'manual', pool: { Impact: { 0: 5 } } } });
  assert.equal(mixed.source, 'stored'); assert.equal(mixed.bag.Impact, 5);
  const mixed2 = bp({ inv: { ts: Date.parse(T3), tabs: F.inv.tabs }, runepool: stored(T1, 'manual') });
  assert.equal(mixed2.source, 'import');
});

test('a private inventory (null) with gear present: not known, but the unequipped pieces are still listed', () => {
  const r = bp({ inv: null, gear: gear(T1) });
  shapeOk(r);
  assert.equal(r.known, false); assert.equal(r.source, 'import');
  assert.deepStrictEqual(r.bag, {}); assert.equal(r.unequipped.Impact, 1, 'with no bag the whole tier 0 is the unequipped 0-star piece');
});

test('the gear-supp fixture (real shape, synthetic ids) does not break the rule', () => {
  const r = bp({ inv: inv(T1), gear: Object.assign({ meta: { ts: T1 } }, GS.gearSupp) });
  shapeOk(r);
  assert.equal(r.known, true);
});

test('a stored pool is attacker-controlled: counts are coerced, names are only keys, markup in values never survives', () => {
  const PAY = '<img src=x onerror=window.__xss=1>';
  const hostile = { meta: { ts: T2 }, source: PAY, pool: { Impact: { 0: PAY, 1: -5, 2: 1e99, 3: NaN, 4: 2.7, 5: null, 6: { a: 1 } }, [PAY]: { 0: 3 }, __proto__x: 7, Junk: 'x', Nope: null } };
  const r = bp({ runepool: hostile });
  shapeOk(r);
  assert.equal(r.storedSource, 'manual');
  assert.equal(r.bag.Impact, undefined); assert.equal(r.unequipped.Impact, undefined);
  assert.deepStrictEqual(r.upgraded.Impact, { 2: 1e9, 4: 2 });
  const strings = [];
  (function walk(o) { if (typeof o === 'string') strings.push(o); else if (o && typeof o === 'object') Object.keys(o).forEach((k) => { if (k !== PAY) walk(o[k]); }); })(r);
  assert.deepStrictEqual(strings.filter((s) => /[<>"]/.test(s)), [], 'no value string carries markup');
  assert.equal(Object.getPrototypeOf(r.bag), Object.prototype);
  const evil = JSON.parse('{"__proto__": {"0": 5}, "Heavy Blow": {"0": 2}}');
  const e = bp({ runepool: { source: 'manual', pool: evil } });
  assert.equal(e.bag['Heavy Blow'], 2); assert.equal(Object.keys(e.bag).indexOf('__proto__'), -1);
  assert.equal(({}).polluted, undefined);
});
