'use strict';
// pages/armory-advice.js, the pure half (Armory v2 phase 4): the step walk with the A5 "return to bag" hook, plain reasons,
// looks-done, step text, per-device ticks, pre-flight, links; plus cross-compat with the CLASSIC page's own functions (a plan
// written on one page must open on the other). Synthetic data only (fixtures/armory-core/advisor.json).
// Run: node --test test/advice-rules.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../pages/armory-advice.js');
const Core = require('../pages/armory-core.js');
const G = require('../pages/tw-game-data.js');
const P = require('./helpers/armory-page.js');

const F = P.fixture('advisor.json');
const CAT = P.data('rune-types.json');
const IDX = Core._ar_advisorRuneTypeIndex(CAT);
const HEROES = JSON.parse(fs.readFileSync(path.join(P.ROOT, 'data/all-heroes.json'), 'utf8'));
const NAMES = {}; HEROES.forEach((h) => { NAMES[h.heroId] = h.displayName; });
// small hero ids used by the fixture get readable names
Object.assign(NAMES, { 101: 'Alpha', 102: 'Bravo', 103: 'Charlie' });
function newCore() { const c = Core.create(); c.setHeroCache(NAMES, null); return c; }
const core = newCore();
const base = (over) => Object.assign({ pool: P.clone(F.pool), unequipped: {} }, over || {});
const walk = (steps, b, gear) => A.walk(b || base(), gear || P.clone(F.gearByHero), steps, CAT, IDX, core);

test('walk reproduces _ar_validateStepSequence for every non-A5 step (parity), singly and as a sequence', () => {
  const steps = F.steps.valid.concat(F.steps.invalid).filter((s) => !(s && s.type === 'recycle' && s.srcHero === 0));
  assert.ok(steps.length > 25);
  for (const s of steps) {
    const want = core._ar_validateStepSequence(F.pool, F.gearByHero, [s], CAT, IDX)[0];
    const got = walk([s]).rows[0];
    assert.equal(got.ok, want.ok, JSON.stringify(s));
    assert.deepStrictEqual(got.raw, want.errors, JSON.stringify(s));
    assert.equal(got.reasons.length, want.errors.length);
  }
  const seq = steps.slice(0, 22);
  const want = core._ar_validateStepSequence(F.pool, F.gearByHero, seq, CAT, IDX), got = walk(seq).rows;
  assert.deepStrictEqual(got.map((r) => r.ok), want.map((r) => r.ok));
  assert.deepStrictEqual(got.map((r) => r.raw), want.map((r) => r.errors));
  const end = core._ar_recomputeAdvisorState(F.pool, F.gearByHero, F.steps.valid, CAT, IDX), w2 = walk(F.steps.valid);
  assert.deepStrictEqual(P.j(w2.end.pool), P.j(end.pool)); assert.deepStrictEqual(P.j(w2.end.gearByHero), P.j(end.gearByHero));
  assert.ok(w2.rows.every((r) => r.text && !/^[{\[]/.test(r.text)));
});

test('A5: one unequipped 0-star Heavy Blow + 2 in the bag: a merge that needs 3 fails with the hint, return-to-bag first makes it pass', () => {
  const rune = 'Impact', slot = 1;
  const meta = IDX[rune], se = meta.slots.find((s) => s.slot === slot);
  assert.ok(se, 'Impact fits slot 1 in the catalog');
  // a one-star merge costs the first entry of the schedule; build the shortfall from the real schedule
  const cost = Core._ar_advisorMergeCost(CAT, IDX, rune, slot, 0, 1).cost;
  const gear = { 101: { [slot]: { runeName: rune, star: 0, starMax: se.star_max } }, 102: {} };
  const b = { pool: { [rune]: { 0: cost - 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } }, unequipped: { [rune]: 1 } };
  const merge = { type: 'merge', runeName: rune, dstHero: 101, dstSlot: slot, fromStar: 0, toStar: 1 };
  const ret = { type: 'recycle', srcHero: 0, srcSlot: slot, srcRuneName: rune, srcGearName: G.GEAR_SLOT_NAMES[slot] };
  let w = A.walk(b, gear, [merge], CAT, IDX, core);
  assert.equal(w.rows[0].ok, false);
  assert.equal(w.rows[0].reasons[0], 'Needs ' + cost + ' ' + rune + ' in your bag, you have ' + (cost - 1) + ' (1 more is on an unequipped piece)');
  w = A.walk(b, gear, [ret, merge], CAT, IDX, core);
  assert.deepStrictEqual(w.rows.map((r) => r.ok), [true, true], 'the return puts it in the bag first');
  assert.equal(w.end.pool[rune][0], 0); assert.equal(w.end.unequipped[rune], 0);
  assert.equal(w.rows[0].text, 'Return Impact to your bag from an unequipped ' + G.GEAR_SLOT_NAMES[slot]);
  // two returns of one piece: the second has nothing left
  w = A.walk(b, gear, [ret, ret, merge], CAT, IDX, core);
  assert.deepStrictEqual(w.rows.map((r) => r.ok), [true, false, true]);
  assert.equal(w.rows[1].reasons[0], 'No unequipped 0-star Impact left to return');
  assert.deepStrictEqual(A.walk(b, gear, [{ type: 'recycle', srcHero: 0, srcSlot: 1 }], CAT, IDX, core).rows[0].reasons, ['Pick a rune']);
  // a hint of 3 more when the bag is far short but only 1 piece is returnable
  const far = A.walk({ pool: {}, unequipped: { [rune]: 2 } }, gear, [merge], CAT, IDX, core).rows[0].reasons[0];
  assert.ok(/^No Impact in your bag$|^Needs/.test(far));
});

test('reorder and remove re-walk from the base (R6): the verdicts follow the new order', () => {
  const rune = 'Impact', slot = 1, cost = Core._ar_advisorMergeCost(CAT, IDX, rune, slot, 0, 1).cost;
  const gear = { 101: { [slot]: { runeName: rune, star: 0 } } };
  const b = { pool: { [rune]: { 0: cost - 1 } }, unequipped: { [rune]: 1 } };
  const merge = { type: 'merge', runeName: rune, dstHero: 101, dstSlot: slot, fromStar: 0, toStar: 1 };
  const ret = { type: 'recycle', srcHero: 0, srcSlot: slot, srcRuneName: rune };
  assert.deepStrictEqual(A.walk(b, gear, [ret, merge], CAT, IDX, core).rows.map((r) => r.ok), [true, true]);
  assert.deepStrictEqual(A.walk(b, gear, [merge, ret], CAT, IDX, core).rows.map((r) => r.ok), [false, true], 'moved down: the merge now runs first');
  assert.deepStrictEqual(A.walk(b, gear, [merge], CAT, IDX, core).rows.map((r) => r.ok), [false], 'removed return');
  assert.deepStrictEqual(A.walk(b, gear, [], CAT, IDX, core).rows, []);
  assert.deepStrictEqual(A.walk(b, gear, null, CAT, IDX, core).rows, []);
});

test('walk never mutates its inputs and survives junk steps', () => {
  const b = base(), g = P.clone(F.gearByHero), b0 = JSON.stringify(b), g0 = JSON.stringify(g);
  const r = A.walk(b, g, [null, {}, 5, 'x', { type: 'warp' }, { type: 'recycle', srcHero: 0 }].concat(F.steps.valid), CAT, IDX, core);
  assert.equal(JSON.stringify(b), b0); assert.equal(JSON.stringify(g), g0);
  assert.equal(r.rows.length, 11); assert.equal(r.rows[0].ok, false); assert.equal(r.rows[4].reasons[0], 'This step needs the classic page');
  assert.equal(A.walk(null, null, [{ type: 'place' }], CAT, IDX, core).rows[0].ok, false);
});

test('plainReason: the table, in order, and the passthrough', () => {
  const t = [
    ['No Impact s:0 in pool', 'No Impact in your bag'],
    ['Need 3 Heavy Blow s:0 in pool, have 2', 'Needs 3 Heavy Blow in your bag, you have 2'],
    ['Exceeds star_max 4', 'Past the 4-star limit for this slot'],
    ['Cannot recover upgraded rune (s:2). The inherit-to-junk macro only works on 0★ runes.', 'Only a 0-star rune can go back to the bag (this one is 2-star)'],
    ['Slot already has a rune (recycle or inherit first)', 'That slot already has a rune (return or swap it first)'],
    ['Destination hero has no gear piece in that slot. Use Park instead to inherit onto an empty piece.', 'That hero has no gold piece in that slot'],
    ['Slot rune is Impact, not Searing', 'That slot holds Impact, not Searing'],
    ['Slot star is 3, not 2', 'That rune is 3-star now, not 2-star'],
    ['Unknown step type: warp', 'This step needs the classic page'],
    ['Pick a rune', 'Pick a rune'],
    ['Merge invalid (slot/rune/star mismatch)', 'Merge invalid (slot/rune/star mismatch)'],
    ['Weird s:4 and star_max thing', 'Weird 4-star and star limit thing'],
    [undefined, ''], [null, '']
  ];
  for (const [i, o] of t) assert.equal(A.plainReason(i), o, String(i));
  for (const m of [].concat(...F.steps.invalid.map((s) => core._ar_validateStepSequence(F.pool, F.gearByHero, [s], CAT, IDX)[0].errors))) {
    const r = A.plainReason(m);
    assert.ok(!/\bs:\d|Park|pool\b|star_max/.test(r), 'plain words: ' + m + ' -> ' + r);
  }
});

test('looksDone per verb (the import already shows the result)', () => {
  const g = { 101: { 1: { runeName: 'Impact', star: 2 }, 2: null, 3: { runeName: 'Searing', star: 0 } }, 102: { 1: null, 3: { runeName: 'Impact', star: 1 } } };
  assert.equal(A.looksDone({ type: 'place', runeName: 'Impact', dstHero: 101, dstSlot: 1 }, g), true);
  assert.equal(A.looksDone({ type: 'place', runeName: 'Searing', dstHero: 101, dstSlot: 1 }, g), false);
  assert.equal(A.looksDone({ type: 'merge', runeName: 'Impact', dstHero: 101, dstSlot: 1, fromStar: 1, toStar: 2 }, g), true);
  assert.equal(A.looksDone({ type: 'merge', runeName: 'Impact', dstHero: 101, dstSlot: 1, fromStar: 1, toStar: 3 }, g), false);
  assert.equal(A.looksDone({ type: 'park', srcHero: 101, srcSlot: 2 }, g), true, 'slot empty');
  assert.equal(A.looksDone({ type: 'park', srcHero: 101, srcSlot: 3, srcRuneName: 'Searing' }, g), false);
  assert.equal(A.looksDone({ type: 'park', srcHero: 101, srcSlot: 3, srcRuneName: 'Impact' }, g), true, 'a different rune sits there');
  assert.equal(A.looksDone({ type: 'recycle', srcHero: 101, srcSlot: 2, srcRuneName: 'Impact' }, g), true);
  assert.equal(A.looksDone({ type: 'inherit', srcHero: 101, srcSlot: 1, dstHero: 102, dstSlot: 1 }, g, { 101: { 1: { runeName: 'Impact' } } }), false, 'destination empty');
  assert.equal(A.looksDone({ type: 'inherit', srcHero: 101, srcSlot: 3, dstHero: 102, dstSlot: 3 }, g, g), false, 'the source rune is not at the destination');
  assert.equal(A.looksDone({ type: 'inherit', srcHero: 101, srcSlot: 3, dstHero: 102, dstSlot: 3 }, { 102: { 3: { runeName: 'Searing' } } }, g), true, 'the destination holds the source rune');
  assert.equal(A.looksDone({ type: 'recycle', srcHero: 0, srcSlot: 1, srcRuneName: 'Impact' }, g), false);
  assert.equal(A.looksDone(null, g), false); assert.equal(A.looksDone({ type: 'warp' }, g), false);
  // walk wires it: a failing place that the import already shows reads "looks done"
  const w = A.walk(base(), g, [{ type: 'place', runeName: 'Impact', dstHero: 101, dstSlot: 1 }], CAT, IDX, core).rows[0];
  assert.equal(w.ok, false); assert.equal(w.looksDone, true);
  assert.equal(A.walk(base(), g, [F.steps.valid[0]], CAT, IDX, core).rows[0].looksDone, false, 'a passing step is never "looks done"');
});

test('stepText: every shape, verb first, no s:0, no Park, <= 100 characters with the longest real names', () => {
  const longHero = HEROES.map((h) => h.displayName).sort((a, b) => b.length - a.length)[0];
  const longSlot = G.GEAR_SLOT_NAMES[1];
  const hn = (id) => (id === 1 ? 'Alpha' : id === 2 ? 'Bravo' : longHero), sn = (s) => (s === 7 ? longSlot : G.GEAR_SLOT_NAMES[s]);
  const mk = (name, long) => {
    const h = (id) => (long && id === 1 ? longHero : hn(id)), s = (n) => sn(n), r = 'Heavy Blow'; // the longest real hero name with a typical rune and the real slot names
    return { ctx: { heroName: h, slotName: s }, r, steps: [
      [{ type: 'place', runeName: r, dstHero: 1, dstSlot: 1 }, {}],
      [{ type: 'merge', runeName: r, dstHero: 1, dstSlot: 1, fromStar: 1, toStar: 2 }, { mergeCost: 3 }],
      [{ type: 'inherit', srcHero: 1, srcSlot: 1, dstHero: 2, dstSlot: 1 }, { dstEmpty: false }],
      [{ type: 'inherit', srcHero: 1, srcSlot: 1, dstHero: 2, dstSlot: 1 }, { dstEmpty: true, srcRune: r }],
      [{ type: 'park', srcHero: 1, srcSlot: 1, srcRuneName: r }, {}],
      [{ type: 'recycle', srcHero: 1, srcSlot: 1, srcRuneName: r }, {}],
      [{ type: 'recycle', srcHero: 0, srcSlot: 1, srcRuneName: r, srcGearName: s(1) }, {}]
    ] };
  };
  const plain = mk('plain', false), want = [
    "Place Heavy Blow from your bag on Alpha's Assault Pistol",
    "Merge Heavy Blow on Alpha's Assault Pistol to 2 stars (uses 3 from your bag)",
    "Swap runes: Alpha's Assault Pistol and Alpha's Assault Pistol",
    "Move Heavy Blow from Alpha's Assault Pistol to Alpha's empty Assault Pistol",
    "Move Heavy Blow off Alpha's Assault Pistol onto a spare Assault Pistol",
    "Return Heavy Blow to your bag from Alpha's Assault Pistol",
    'Return Heavy Blow to your bag from an unequipped Assault Pistol'
  ];
  const all = [];
  plain.steps.forEach(([st, extra], i) => {
    const t = A.stepText(st, Object.assign({}, plain.ctx, extra));
    assert.ok(t.length > 0); all.push(t);
    assert.equal(t.replace(/Bravo/g, 'Alpha'), want[i].replace(/Bravo/g, 'Alpha'));
  });
  const lg = mk('long', true);
  lg.steps.forEach(([st, extra]) => {
    const t = A.stepText(st, Object.assign({}, lg.ctx, extra));
    assert.ok(t.length <= 100, t.length + ': ' + t);
    all.push(t);
  });
  for (const t of all) {
    assert.ok(!/s:0|Park|Hypothetical|—/.test(t), t);
    assert.ok(/^(Place|Merge|Swap|Move|Return)\b/.test(t), 'verb first: ' + t);
  }
  assert.equal(A.stepText({ type: 'merge', runeName: 'Impact', dstHero: 1, dstSlot: 1, toStar: 1 }, { heroName: hn, slotName: sn }), "Merge Impact on Alpha's Assault Pistol to 1 star");
  assert.equal(A.stepText({ type: 'warp' }), 'Unknown step'); assert.equal(A.stepText(null), 'Unknown step');
  assert.match(A.stepNote({ type: 'recycle', srcHero: 1, srcSlot: 3 }, { slotName: sn }), /^Inherit the rune onto a junk Optical Add-on, then recycle that junk piece\.$/);
  assert.match(A.stepNote({ type: 'park', srcHero: 1, srcSlot: 3 }, { slotName: sn }), /^Craft a spare Optical Add-on if you have none\.$/);
  assert.equal(A.stepNote({ type: 'place' }), '');
});

test('ticks: round trip per code and advisor, sorted unique integers, bad JSON reads as none', () => {
  const store = {}, st = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const t = A.ticks(st, 'abc123', 'sk:c3c6f3200a4ec1fb');
  assert.equal(t.key, 'armory_advice_ticks_abc123_sk:c3c6f3200a4ec1fb');
  assert.deepStrictEqual(t.get(), []);
  t.set([3, 1, 1, 2, -4, 1.5, 'x', 99999]);
  assert.deepStrictEqual(t.get(), [1, 2, 3]);
  const o = JSON.parse(store[t.key]); assert.equal(o.v, 1); assert.ok(o.ts > 0); assert.deepStrictEqual(o.done, [1, 2, 3]);
  assert.deepStrictEqual(A.ticks(st, 'abc123', 'other0000').get(), [], 'another advisor');
  store[t.key] = '{not json'; assert.deepStrictEqual(t.get(), []);
  store[t.key] = JSON.stringify({ v: 2, done: [1] }); assert.deepStrictEqual(t.get(), []);
  store[t.key] = JSON.stringify({ v: 1, done: 'x' }); assert.deepStrictEqual(t.get(), []);
  const bad = A.ticks({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, 'abc123', 'x');
  assert.deepStrictEqual(bad.get(), []); assert.doesNotThrow(() => bad.set([1]));
});

test('preflight, links, codes', () => {
  const NOW = Date.parse('2026-10-09T12:00:00Z'), D = (n) => NOW - n * 864e5;
  let p = A.preflight({ pool: { known: true, source: 'import' }, privacy: {}, supTs: { inv: D(2), gear: D(2) }, now: NOW });
  assert.equal(p.line, 'Inventory imported 2 days ago, gear imported 2 days ago, rune pool: from your import');
  assert.equal(p.warn, ''); assert.equal(p.canAsk, true);
  p = A.preflight({ pool: { known: true, source: 'stored', storedSource: 'manual', poolTs: D(1) }, privacy: { inv: true }, supTs: { inv: D(0), gear: 0 }, now: NOW });
  assert.equal(p.line, 'Inventory imported today, no gear imported, rune pool: hand-entered 1 day ago');
  assert.match(p.warn, /^Your bag is private: an advisor cannot check it\. Change that in Status\.$/);
  p = A.preflight({ pool: { known: false, source: 'none' }, privacy: {}, supTs: {}, now: NOW });
  assert.equal(p.canAsk, false); assert.equal(p.line, 'No inventory imported, no gear imported, rune pool: none');
  assert.equal(A.preflight({ pool: { known: true, source: 'import', stale: true } }).stale, true);
  assert.equal(A.preflight().canAsk, false);
  assert.deepStrictEqual(A.links('abc123', 'rexc'), { advise: 'https://2864tw.com/armory-report.html?advise=abc123', player: 'https://2864tw.com/armory-report.html?code=REXC&plan=abc123' });
  assert.deepStrictEqual(A.links('a<b>c"1', 'R&X'), { advise: 'https://2864tw.com/armory-report.html?advise=abc1', player: 'https://2864tw.com/armory-report.html?code=RX&plan=abc1' }, 'links never carry markup');
  for (const [s, ok] of [['abc123', true], ['ABC123', true], [' abc123 ', true], ['abc12', false], ['abc1234', false], ['abc 12', false], ['<b>123', false], ['', false], [null, false], [undefined, false]]) assert.equal(A.isCode(s), ok, String(s));
  assert.equal(A.normCode('ABC123'), 'abc123'); assert.equal(A.normCode('zz'), '');
});

// ---- cross-compat with the CLASSIC page's own functions ---------------------------------------------------------------
const classic = P.loadPage(['_ar_validateAdvisorStep', '_ar_applyAdvisorStep', '_ar_validateStepSequence', '_ar_advisorStepEnglish', '_ar_advisorMergeCost', '_ar_advisorRuneTypeIndex', 'heroName', 'HERO_CACHE', 'GEAR_SLOT_NAMES']);
test('cross-compat (a): a v2 plan with the A5 step validates on classic (no "Unknown step type") and reads as English, not JSON', () => {
  const steps = [
    { type: 'place', runeName: 'Impact', dstHero: 102, dstSlot: 1 },
    { type: 'merge', runeName: 'Artillery Storm', dstHero: 101, dstSlot: 1, fromStar: 2, toStar: 4 },
    { type: 'inherit', srcHero: 101, srcSlot: 2, dstHero: 102, dstSlot: 3 },
    { type: 'park', srcHero: 103, srcSlot: 5, srcRuneName: 'Searing', srcRuneStar: 0, srcGearName: 'Portable GPS' },
    { type: 'recycle', srcHero: 101, srcSlot: 2, srcRuneName: 'Debilitate', srcGearName: 'Tactical Backarmor' },
    { type: 'recycle', srcHero: 0, srcSlot: 3, srcRuneName: 'Heavy Blow', srcGearName: 'Optical Add-on' }
  ];
  const cidx = classic._ar_advisorRuneTypeIndex(P.clone(CAT));
  const res = classic._ar_validateStepSequence(P.j(F.pool), P.j(F.gearByHero), P.clone(steps), P.clone(CAT), cidx);
  for (const r of res) assert.ok(!r.errors.some((e) => /Unknown step type/.test(e)), JSON.stringify(r.errors));
  const a5 = res[5]; assert.equal(a5.ok, true, 'classic validates the A5 step when the rune name is stamped');
  for (const s of steps) { const en = classic._ar_advisorStepEnglish(P.clone(s)); assert.ok(en && !/^\s*[{\[]/.test(en), en); }
  assert.match(classic._ar_advisorStepEnglish(P.clone(steps[5])), /^Recover Heavy Blow rune from unequipped Optical Add-on \(inherit to junk .*, then recycle the junk gear\)$|^Recover Heavy Blow rune from unequipped Optical Add-on/);
  // classic applying the A5 step is a no-op and does not throw
  const st = { pool: P.clone(F.pool), gearByHero: P.clone(F.gearByHero) };
  assert.doesNotThrow(() => classic._ar_applyAdvisorStep(st, P.clone(steps[5]), P.clone(CAT), cidx));
  assert.deepStrictEqual(P.j(st.pool), P.j(F.pool), 'no change to the pool on classic');
});

test('cross-compat (b): a classic-shaped plan (dstEquipId, dstIsJunk, srcRuneStar) walks on v2 without throwing and keeps its readings', () => {
  const steps = [
    { type: 'recycle', srcHero: 101, srcSlot: 2, srcRuneName: 'Debilitate', srcGearName: 'Tactical Backarmor', dstEquipId: 'e1', dstGearName: 'Tactical Backarmor', dstIsJunk: true },
    { type: 'recycle', srcHero: 0, srcSlot: 3, srcRuneName: 'Impact', srcGearName: 'Optical Add-on', dstEquipId: 'e2', dstIsJunk: true },
    { type: 'park', srcHero: 103, srcSlot: 5, srcRuneName: 'Searing', srcRuneStar: 0, srcGearName: 'Portable GPS' },
    { type: 'inherit', srcHero: 101, srcSlot: 2, dstHero: 102, dstSlot: 3 }
  ];
  let w;
  assert.doesNotThrow(() => { w = A.walk({ pool: F.pool, unequipped: { Impact: 1 } }, F.gearByHero, steps, CAT, IDX, core); });
  assert.equal(w.rows.length, 4);
  assert.equal(w.rows[1].ok, true, 'the classic recover step for an unequipped piece passes with one unequipped Impact');
  assert.equal(w.rows[0].text, 'Return Debilitate to your bag from Alpha\'s Tactical Backarmor');
  assert.ok(w.rows.every((r) => typeof r.text === 'string' && !/\bundefined\b|\[object/.test(r.text + r.note)));
  // classic and v2 agree on whether each shared step is valid (the A5 step excepted, which only v2 counts exactly)
  const cidx = classic._ar_advisorRuneTypeIndex(P.clone(CAT));
  const c = classic._ar_validateStepSequence(P.j(F.pool), P.j(F.gearByHero), P.clone(steps), P.clone(CAT), cidx);
  assert.deepStrictEqual(w.rows.map((r) => r.ok), c.map((r) => r.ok));
});
