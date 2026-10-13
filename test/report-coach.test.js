'use strict';
// "What to work on next": pages/report-coach.js on three sanitized real reports (test/fixtures/report-coach/).
// Run: node --test test/report-coach.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const Coach = require('../pages/report-coach.js');
const FIX = path.join(__dirname, 'fixtures', 'report-coach');

const REX = '4879270942306885632';   // Rеx (Cyrillic e) vs J™, same three heroes, a clear loss
const LIVV = '4734976034042437638';  // Livv close win
const SHORTY = '4760169710502699010'; // Shorty stomp

const fixture = (id) => JSON.parse(fs.readFileSync(path.join(FIX, id + '.json'), 'utf8'));
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

// BUFF_GROUP is read from the page itself, so the test follows the table the viewer uses.
const page = fs.readFileSync(path.join(ROOT, 'pages', 'battle-report.html'), 'utf8');
const bg = /var BUFF_GROUP = (\{.*?\});/.exec(page);
const tables = {
  buffGroup: vm.runInNewContext('(' + bg[1] + ')'),
  heroes: data('all-heroes.json'), supportive: data('supportive-skills.json'), talents: data('hero-talents.json'),
  runes: data('rune-types.json'), collectibles: data('loot-quest-collectibles.json'), formation: data('formation-v2.json')
};
const run = (id, t) => Coach.analyze(fixture(id), t || tables);
const find = (side, id) => side.moves.find((m) => m.id === id);

test('fixtures carry no player uid', () => {
  for (const id of [REX, LIVV, SHORTY]) {
    const bad = [];
    (function walk(o, p) {
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, p + '[' + i + ']'));
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          if ((k === 'uid' || k === 'uidStr' || /Uid$/.test(k)) && o[k] !== '0' && o[k] !== 0) bad.push(p + '.' + k);
          if (/^headimgurl/.test(k) || k === 'moreHeadImgs') bad.push(p + '.' + k);
          walk(o[k], p + '.' + k);
        }
      } else if (typeof o === 'string' && o[0] === '{' && /"uid"/.test(o)) {
        walk(JSON.parse(o), p + '(json)');
      }
    })(fixture(id), id);
    assert.deepEqual(bad, []);
  }
});

test('Rex loses by a wide margin: closeness about 9% and out of reach', () => {
  const r = run(REX);
  assert.equal(r.fight.winner, 'defender');
  assert.equal(r.fight.rounds, 26);
  assert.equal(Math.round(r.fight.closeness.loserProgress * 100), 9);
  assert.equal(r.fight.closeness.label, 'out-of-reach');
  assert.equal(r.sides.attacker.won, false);
  assert.equal(r.sides.defender.won, true);
  assert.equal(r.sides.attacker.name, 'Реx'.replace('Р', 'R'), 'name keeps the Cyrillic e');
});

test('Rex: Air Force Protection is free; the Offense field is locked (79 of 150 field levels)', () => {
  const rex = run(REX).sides.attacker;
  assert.deepEqual(rex.errors, []);
  const prot = find(rex, 'protection');
  assert.ok(prot, 'protection move');
  assert.equal(prot.tier, 'free');
  assert.match(prot.title, /Air Force Protection/);
  assert.deepEqual([prot.data.mine, prot.data.theirs], [0, 3]);
  const field = find(rex, 'beast-field-5');
  assert.ok(field, 'offense field move');
  assert.equal(field.tier, 'upgrade');
  assert.equal(field.title, 'Unlock your Offense field');
  assert.deepEqual([field.data.locked, field.data.have, field.data.need], [true, 79, 150]);
  assert.match(field.detail, /71 more/);
  assert.equal(find(rex, 'beast-field-levels'), undefined, 'the unlock move already covers raising field levels');
});

test('Rex: upgrade move for the two All-Out Surge runes at 0 of 6 stars', () => {
  const m = find(run(REX).sides.attacker, 'runes-stars');
  assert.ok(m, 'rune move');
  assert.equal(m.tier, 'upgrade');
  assert.match(m.title, /All-Out Surge/);
  assert.deepEqual([m.data.weakest.count, m.data.weakest.star, m.data.weakest.starMax], [2, 0, 6]);
  assert.match(m.evidence, /2 All-Out Surge runes at 0 of 6 stars/);
});

test('Rex: gaps point at beasts, skins, unit equipment and formation, behind J™', () => {
  const g = run(REX).sides.attacker.gaps;
  assert.ok(g.length >= 3 && g.length <= 4);
  const areas = g.map((x) => x.area);
  for (const a of ['base-skins', 'beast-fields', 'unit-equip']) assert.ok(areas.includes(a), a);
  g.forEach((x) => { assert.ok(x.theirs > x.mine); assert.ok(x.share > 0 && x.share <= 1); });
  assert.deepEqual(g.map((x) => x.share), g.map((x) => x.share).slice().sort((a, b) => b - a), 'biggest first');
});

test('moves come free first, then upgrades, then long term, at most 6', () => {
  const rank = { free: 0, upgrade: 1, long: 2 };
  for (const id of [REX, LIVV, SHORTY]) {
    const r = run(id);
    for (const k of ['attacker', 'defender']) {
      const mv = r.sides[k].moves;
      assert.ok(mv.length <= 6, id + ' ' + k);
      for (let i = 1; i < mv.length; i++) assert.ok(rank[mv[i - 1].tier] <= rank[mv[i].tier], id + ' order');
      mv.forEach((m) => { assert.ok(m.title && m.detail && m.evidence && m.area); });
    }
  }
});

test('Livv wins a close fight', () => {
  const r = run(LIVV);
  assert.equal(r.fight.winner, 'attacker');
  assert.equal(r.fight.closeness.label, 'close');
  assert.ok(r.fight.closeness.loserProgress > 0.4 && r.fight.closeness.loserProgress < 0.5);
  // the loser ran no Protection skill while Livv ran it on all three heroes
  const loser = r.sides.defender;
  assert.equal(loser.won, false);
  assert.match(find(loser, 'protection').title, /Air Force Protection/);
});

test('Shorty: top moves include unlearned talents and no runes', () => {
  const r = run(SHORTY);
  assert.equal(r.fight.closeness.label, 'out-of-reach');
  const s = r.sides.attacker;
  const ids = s.moves.map((m) => m.id);
  assert.ok(ids.includes('talents'), ids.join());
  assert.ok(ids.includes('runes-empty'), ids.join());
  assert.equal(find(s, 'runes-empty').data.empty, 17);
  assert.equal(find(s, 'talents').data.notMaxed, 9);
  // wrong-branch skills and empty slots are free moves
  assert.equal(find(s, 'wrong-branch-skills').tier, 'free');
  assert.equal(find(s, 'empty-skill-slots').tier, 'free');
  // the opponent's march fields Valhalla troops, Shorty's is all base grade
  assert.equal(s.troops.basePct, 100);
});

test('anything already maxed is skipped', () => {
  const rep = fixture(SHORTY);
  rep.battle.attacker.players[0].heroList.forEach((h) => {
    (h.talents || []).forEach((t) => { t.ttsr = 10000; });
  });
  const s = Coach.analyze(rep, tables).sides.attacker;
  assert.equal(find(s, 'talents'), undefined);
});

test('missing tables skip their levers instead of failing', () => {
  const r = run(REX, { buffGroup: tables.buffGroup });
  assert.deepEqual(r.sides.attacker.errors, []);
  assert.equal(find(r.sides.attacker, 'collectible-theme'), undefined);
  const bare = run(REX, {});
  assert.deepEqual(bare.sides.attacker.gaps, []);
  assert.ok(bare.sides.attacker.moves.length > 0);
});

test('player-facing copy has no em dashes', () => {
  for (const id of [REX, LIVV, SHORTY]) {
    const r = run(id);
    for (const k of ['attacker', 'defender']) {
      r.sides[k].moves.forEach((m) => {
        for (const f of ['title', 'detail', 'evidence']) assert.doesNotMatch(m[f], /[–—]/, m.id + ' ' + f);
      });
    }
  }
});

test('armyType decodes Valhalla, base and mecha ids', () => {
  assert.equal(Coach.armyType(905103), 'af');
  assert.equal(Coach.armyType(30102), 'af');
  assert.equal(Coach.armyType(10101), 'army');
  assert.equal(Coach.armyType(506371), null);
});

// ---- edge cases (synthetic, derived from the fixtures) ----
const FIXTURES = [REX, LIVV, SHORTY];
const clean = (r, label) => {
  for (const k of ['attacker', 'defender']) assert.deepEqual(r.sides[k].errors, [], label + ' ' + k);
  if (r.fight.closeness) assert.ok(r.fight.closeness.loserProgress < 1, label + ' progress');
};
const falseClaims = (r, label) => {
  for (const k of ['attacker', 'defender']) {
    r.sides[k].moves.forEach((m) => {
      if (m.id === 'protection' && m.data.theirBranch !== m.data.branch) assert.doesNotMatch(m.detail, / runs it /, label);
    });
  }
};

test('every fixture side reads without errors', () => {
  FIXTURES.forEach((id) => clean(run(id), id));
});

// Fields open by the total level of all beast field slots (game table enigma_field.unlock_condition):
// Defense at 40, Offense at 150. A field with no beasts is missing from the report, locked or not.
test('beast fields: locked below their unlock level; once open, filling needs qualifying beasts (an upgrade)', () => {
  // Shorty is under the Defense unlock level; his move may fall below the six-move cap, but must never be Free
  const shorty = find(run(SHORTY).sides.attacker, 'beast-field-4');
  if (shorty) assert.deepEqual([shorty.tier, shorty.data.locked], ['upgrade', true]);
  // Rex with every slot at level 1 and no Defense field: 27 levels, under 40, so Defense is locked too
  const low = fixture(REX);
  const lp = low.battle.attacker.players[0];
  lp.enigmas.fields = lp.enigmas.fields.filter((f) => f.cfg !== 4);
  lp.enigmas.fields.forEach((f) => f.slots.forEach((s) => { s.level = 1; }));
  const def = find(Coach.analyze(low, tables).sides.attacker, 'beast-field-4');
  assert.equal(def.tier, 'upgrade');
  assert.deepEqual([def.data.locked, def.data.need], [true, 40]);
  assert.ok(def.data.have < 40);
  // Rex with his slots raised past 150 total levels: now the Offense field is open and filling it is free
  const rep = fixture(REX);
  rep.battle.attacker.players[0].enigmas.fields.forEach((f) => f.slots.forEach((s) => { s.level = 6; }));
  const open = find(Coach.analyze(rep, tables).sides.attacker, 'beast-field-5');
  assert.equal(open.tier, 'upgrade'); // each slot needs an Epic or better beast of a set type; a report can't see spare beasts
  assert.equal(open.title, 'Fill your Offense field');
  assert.match(open.detail, /Epic or better/);
  assert.equal(open.data.locked, false);
  // fields 1-3 have no level rule we can read from a report: never claimed free
  const rep2 = fixture(REX);
  const ps = rep2.battle.attacker.players[0];
  ps.enigmas.fields = ps.enigmas.fields.filter((f) => f.cfg !== 3);
  const m3 = find(Coach.analyze(rep2, tables).sides.attacker, 'beast-field-3');
  assert.equal(m3.tier, 'upgrade');
  assert.match(m3.title, /^Unlock and fill/);
});

test('edge: defender with no players', () => {
  const rep = fixture(REX);
  rep.battle.defender.players = [];
  const r = Coach.analyze(rep, tables);
  clean(r, 'no players');
  falseClaims(r, 'no players');
});

test('edge: no enigmas, formation or skins makes no claims about them', () => {
  const rep = fixture(REX);
  const p = rep.battle.attacker.players[0];
  delete p.enigmas; delete p.formationV2; delete p.effectSkins;
  const r = Coach.analyze(rep, tables);
  clean(r, 'stripped');
  const ids = r.sides.attacker.moves.map((m) => m.id);
  assert.ok(!ids.some((i) => /^beast-|formation|castle|base-skins/.test(i)), ids.join());
});

test('edge: several marches or a rally give no closeness', () => {
  const rep = fixture(REX);
  rep.battle.fightMarches.push(JSON.parse(JSON.stringify(rep.battle.fightMarches[0])));
  rep.battle.result = 2;
  const r = Coach.analyze(rep, tables);
  clean(r, 'two marches');
  assert.equal(r.fight.closeness, null);
  const rally = fixture(REX);
  rally.battle.defender.players.push(JSON.parse(JSON.stringify(rally.battle.defender.players[0])));
  assert.equal(Coach.analyze(rally, tables).fight.closeness, null);
});

test('edge: progress is clamped below 100%', () => {
  const rep = fixture(REX);
  rep.battle.fightMarches[0].attSkillHurts.total_hurt = '1E30';
  rep.battle.result = 2;
  const c = Coach.analyze(rep, tables).fight.closeness;
  assert.ok(c.loserProgress <= 0.99);
});

test('edge: different troop types do not say the opponent runs the same skill', () => {
  const rep = fixture(REX);
  rep.battle.fightMarches[0].defPutArmyV2.forEach((a) => { if (String(a.armyId).startsWith('906')) a.armyId = 901103; });
  const r = Coach.analyze(rep, tables);
  clean(r, 'mixed troops');
  // the opponent now marches Army: its Air Force Protection no longer counts, so no "runs it" claim is made
  const m = find(r.sides.attacker, 'protection');
  if (m) assert.doesNotMatch(m.detail, / runs it /);
  assert.equal(m, undefined);
});

test('edge: slot levels compare the fields both sides have', () => {
  const m = find(run(REX).sides.attacker, 'beast-field-levels');
  if (m) assert.match(m.detail, /fields you both have/);
});

test('protection: a Protection skill for another branch reads as a swap', () => {
  const rep = fixture(REX);
  const h = rep.battle.attacker.players[0].heroList[0];
  const sk = h.nonActiveSkills.find((x) => x.skillId === 21116);
  sk.skillId = 21120; // Army Protection on an Air Force march
  const m = find(Coach.analyze(rep, tables).sides.attacker, 'protection');
  assert.equal(m.tier, 'free');
  assert.equal(m.title, 'Swap to Air Force Protection');
  assert.match(m.detail, /Army Protection/);
  assert.equal(m.data.otherBranch, 1);
});


// ---- withSnapshot: the armory adds what the player holds (synthetic snapshots, no player data) ----
const enhance = data('enigma-platform-enhance.json');
const heroList = data('all-heroes.json');
const PLATFORMS = { holes: [
  { fieldType: 4, minQuality: 4, faction: 0, beastTypeIds: [2, 3] },
  { fieldType: 4, minQuality: 4, faction: 1, beastTypeIds: [1, 2, 9] }] };
const T2 = Object.assign({}, tables, { enhance: enhance, platforms: PLATFORMS });
const mkSnap = (o) => Object.assign({
  inv: { tabs: { item: [{ id: 47007002, a: 43 }, { id: 20213232, a: 507 }] } },
  enigma: { fields: [{ fid: 1, holes: [{ hid: 1, lv: 8, beastId: 'a' }, { hid: 2, lv: 5, beastId: 'b' }] }, { fid: 2, holes: [{ hid: 6, lv: 1, beastId: 'c' }] }],
    beasts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', q: 5, type: 2, fac: 1 }, { id: 'e', q: 3, type: 1, fac: 1 }], beast2field: { a: { fid: 1, hid: 1 }, b: { fid: 1, hid: 2 } } },
  heroes: { list: [{ id: heroList[0].heroId, p1: { x: [{ id: 0, lv: 0 }], b: [] }, p2: { x: [{ id: 21122, lv: 7 }], b: [] } }] },
  runeBag: { 'All-Out Surge': 3 }
}, o || {});
// Rex's real moves, plus two the fixture no longer produces: filling an open field, and raising field levels
const rexSide = () => {
  const side = run(REX, T2).sides.attacker;
  return Object.assign({}, side, { moves: side.moves.concat([
    { tier: 'upgrade', id: 'beast-field-4', data: { field: 4, locked: false } },
    { tier: 'upgrade', id: 'beast-field-levels', data: {} }]) });
};

test('withSnapshot leaves analyze alone and does not mutate its input', () => {
  const side = rexSide(), before = JSON.stringify(side);
  const out = Coach.withSnapshot(side, mkSnap(), T2);
  assert.equal(JSON.stringify(side), before);
  assert.equal(out.moves.length, side.moves.length);
  assert.deepEqual(out.moves.map((m) => m.id), side.moves.map((m) => m.id));
  assert.deepEqual(out.gaps, side.gaps);
});

test('withSnapshot: a locked field gets no spare-beast line and keeps its tier', () => {
  const out = Coach.withSnapshot(rexSide(), mkSnap(), T2), locked = find(out, 'beast-field-5');
  assert.equal(locked.extra, undefined);
  assert.equal(locked.tier, 'upgrade');
});

test('withSnapshot: spare beasts, runes, repeaters and the Protection copy', () => {
  const out = Coach.withSnapshot(rexSide(), mkSnap(), T2);
  const x = (id) => find(out, id).extra;
  assert.equal(x('beast-field-4'), 'Your spare beasts fit 1 of its 2 slots.');
  assert.equal(find(out, 'beast-field-4').tier, 'upgrade', 'a part fit does not promote');
  assert.equal(x('runes-stars'), 'You have 3 All-Out Surge runes in the bag.');
  assert.match(x('protection'), /^One copy is on .+'s second preset\.$/);
  assert.equal(find(out, 'protection').extraNames[0], heroList[0].displayName || heroList[0].name);
  assert.match(x('beast-field-levels'), /^43 repeaters: enough for about \d+ levels?\.$/);
});

test('withSnapshot: repeater levels spend the cheapest next level first', () => {
  const snap = mkSnap({ inv: { tabs: { item: [{ id: 47007002, a: 12 }] } }, enigma: { fields: [{ holes: [{ hid: 1, lv: 0 }] }] } });
  const out = Coach.withSnapshot(rexSide(), snap, T2);
  const lv = enhance.platforms[1].levels;   // costs 5, 10, ...
  assert.equal(lv[0].cost.count + lv[1].cost.count > 12, true);
  assert.equal(find(out, 'beast-field-levels').extra, '12 repeaters: enough for about 1 level.');
  const few = Coach.withSnapshot(rexSide(), mkSnap({ inv: { tabs: { item: [{ id: 47007002, a: 2 }] } }, enigma: { fields: [{ holes: [{ hid: 1, lv: 0 }] }] } }), T2);
  assert.equal(find(few, 'beast-field-levels').extra, 'You have 2 repeaters. The cheapest next level costs 5.');
});

test('withSnapshot: an open field turns Free only when the spare beasts fill every slot', () => {
  const full = mkSnap(); full.enigma.beasts.push({ id: 'f', q: 4, type: 3, fac: 2 });
  const out = Coach.withSnapshot(rexSide(), full, T2);
  assert.equal(find(out, 'beast-field-4').extra, 'Your spare beasts fill all 2 of its slots.');
  assert.equal(find(out, 'beast-field-4').tier, 'free');
  assert.equal(find(out, 'beast-field-5').tier, 'upgrade', 'a locked field never changes tier');
  // a beast with no attributes of its own is read from the bench entry, then the decoder
  const viaBench = mkSnap({ bench: { beasts: [{ id: 'g', q: 5, type: 3, fac: 2 }] } }); viaBench.enigma.beasts.push({ id: 'g', cfgId: 7 }, { id: 'h', cfgId: 8 });
  viaBench.decode = (c) => (c === 8 ? { type: 2, faction: 1, quality: 5 } : null);
  assert.equal(find(Coach.withSnapshot(rexSide(), viaBench, T2), 'beast-field-4').tier, 'free');
  const unknown = mkSnap(); unknown.enigma.beasts = [{ id: 'z', cfgId: 9 }];
  assert.equal(find(Coach.withSnapshot(rexSide(), unknown, T2), 'beast-field-4').extra, 'Your spare beasts fit none of its 2 slots.');
});

test('withSnapshot: no spare beasts, no copy elsewhere, a lower quality copy', () => {
  const none = Coach.withSnapshot(rexSide(), mkSnap({ enigma: { fields: [], beasts: [{ id: 'a' }], beast2field: { a: { fid: 1, hid: 1 } } }, heroes: { list: [] } }), T2);
  assert.equal(find(none, 'beast-field-4').extra, 'Your spare beasts fit none of its 2 slots.');
  assert.equal(find(none, 'protection').extra, undefined, 'no copy found: nothing said');
  const low = Coach.withSnapshot(rexSide(), mkSnap({ heroes: { list: [{ id: heroList[0].heroId, p1: { x: [{ id: 20122, lv: 3 }] }, p2: { x: [] } }] } }), T2);
  assert.match(find(low, 'protection').extra, /^A lower quality copy is on .+'s first preset\.$/);
});

test('withSnapshot: missing or private supplements say nothing', () => {
  for (const snap of [null, undefined, {}, { inv: null, enigma: null, heroes: null }]) {
    const out = Coach.withSnapshot(rexSide(), snap, T2);
    assert.equal(out.moves.every((m) => m.extra === undefined), true);
  }
  const noEnh = Coach.withSnapshot(rexSide(), mkSnap(), tables);
  assert.equal(find(noEnh, 'beast-field-levels').extra, undefined, 'no repeater table: nothing said');
  assert.equal(find(noEnh, 'beast-field-4').extra, undefined, 'no slot rules: nothing said');
  const noBag = Coach.withSnapshot(rexSide(), mkSnap({ inv: null }), T2);
  assert.equal(find(noBag, 'beast-field-levels').extra, undefined);
});

test('withSnapshot: decoration suits move reads the universal shards', () => {
  const side = { moves: [{ tier: 'long', id: 'decoration-suits', data: {} }] };
  assert.equal(Coach.withSnapshot(side, mkSnap(), T2).moves[0].extra, 'You have 507 universal decor shards in the bag.');
  assert.equal(Coach.withSnapshot(side, mkSnap({ inv: { tabs: { item: [] } } }), T2).moves[0].extra, 'You have 0 universal decor shards in the bag.');
});

test('withSnapshot copy has no em dashes', () => {
  const out = Coach.withSnapshot(rexSide(), mkSnap(), T2);
  out.moves.forEach((m) => assert.equal(/[—–]/.test(m.extra || ''), false));
});

test('data/buff-group.json is the table battle-report.html uses', () => {
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'buff-group.json'), 'utf8'))), JSON.stringify(tables.buffGroup));
});

// Slots the spare beasts DO fit in fields 3, 4 and 5, so the tier rules are exercised, not skipped for lack of holes.
const PLATFORMS_ALL = { holes: [
  { fieldType: 3, minQuality: 4, faction: 0, beastTypeIds: [2, 3] },
  { fieldType: 4, minQuality: 4, faction: 0, beastTypeIds: [2, 3] }, { fieldType: 4, minQuality: 4, faction: 1, beastTypeIds: [1, 2, 9] },
  { fieldType: 5, minQuality: 4, faction: 0, beastTypeIds: [2, 3] }, { fieldType: 5, minQuality: 4, faction: 1, beastTypeIds: [1, 2, 9] }] };
const T3 = Object.assign({}, T2, { platforms: PLATFORMS_ALL });
const fullSnap = () => { const s = mkSnap(); s.enigma.beasts.push({ id: 'f', q: 4, type: 3, fac: 2 }); return s; };

test('withSnapshot: a locked field and a fields 1-3 move never turn Free, even when spare beasts fit their slots', () => {
  const side = run(REX, T3).sides.attacker;
  const locked = side.moves.find((m) => m.id === 'beast-field-5');
  assert.equal(locked.data.locked, true);
  const withThree = Object.assign({}, side, { moves: side.moves.concat([{ tier: 'upgrade', id: 'beast-field-3', data: { field: 3, unlocked: false } }]) });
  const out = Coach.withSnapshot(withThree, fullSnap(), T3);
  for (const id of ['beast-field-5', 'beast-field-3']) {
    assert.equal(find(out, id).tier, 'upgrade', id);
    assert.equal(find(out, id).extra, undefined, id);
  }
});

test('withSnapshot: two open fields cannot both be filled with the same spare beasts', () => {
  const side = run(REX, T3).sides.attacker;
  const two = Object.assign({}, side, { moves: side.moves.filter((m) => !/^beast-field/.test(m.id)).concat([
    { tier: 'upgrade', id: 'beast-field-4', data: { field: 4, locked: false } },
    { tier: 'upgrade', id: 'beast-field-5', data: { field: 5, locked: false } }]) });
  const out = Coach.withSnapshot(two, fullSnap(), T3);   // two spares fit either field, not both
  assert.equal(find(out, 'beast-field-4').tier, 'free');
  assert.equal(find(out, 'beast-field-5').tier, 'upgrade');
  assert.equal(find(out, 'beast-field-5').extra, 'Your spare beasts fit none of its 2 slots.');
});
