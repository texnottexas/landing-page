'use strict';
// Armory v2 "From your main march's last battle" card: the rules in pages/armory-coach.js (no DOM). Run: node --test test/armory-coach.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('../pages/armory-coach.js');
const Coach = require('../pages/report-coach.js');

const ROOT = path.join(__dirname, '..');
const fixture = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'report-coach', id + '.json'), 'utf8'));
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const REX = '4879270942306885632';

test('recentReports: usable entries only, newest first, at most MAX_READ', () => {
  const r = (id, t) => ({ id, extracted: { logtime: t } });
  const list = Array.from({ length: 12 }, (_, i) => r('r' + i, i));
  const got = L.recentReports(list.concat([{ id: 'x', extracted: null }, null]));
  assert.equal(L.MAX_READ, 8);
  assert.deepEqual(got.map((x) => x.id), ['r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4']);
  assert.deepEqual(L.recentReports(null), []);
});

const mk = (aUid, aName, dUid, dName) => ({ battle: {
  attacker: { players: [{ uid: aUid, playerInfo: JSON.stringify({ username: aName }) }] },
  defender: { players: [{ uid: dUid, playerInfo: JSON.stringify({ username: dName }) }] } } });

test('matchSide: the siteKey decides, the name only when no key matches', () => {
  const sha = (u) => crypto.createHash('sha256').update(String(u)).digest('hex').slice(0, 16);
  const raw = mk(111, 'Alpha', 222, 'Beta'), pl = L.sidePlayers(raw);
  const h = { attacker: sha(111), defender: sha(222) };
  assert.equal(L.matchSide(h, pl, sha(222), 'Alpha'), 'defender', 'key beats a name that points the other way');
  assert.equal(L.matchSide(h, pl, sha(111), 'Nobody'), 'attacker');
  assert.equal(L.matchSide(h, pl, sha(999), 'Beta'), null, 'a siteKey that matches neither side: not this report, whatever the name');
  assert.equal(L.matchSide({ attacker: '', defender: '' }, pl, sha(999), ' beta '), 'defender', 'uids not hashed: trimmed, case-insensitive name');
  assert.equal(L.matchSide(h, pl, null, 'Alpha'), 'attacker');
  assert.equal(L.matchSide(h, pl, sha(999), 'Gamma'), null);
  assert.equal(L.matchSide({ attacker: '', defender: '' }, pl, sha(111), ''), null);
});

test('matchSide: two sides with the same name give no answer', () => {
  const pl = L.sidePlayers(mk(1, 'Same', 2, 'Same'));
  assert.equal(L.matchSide({}, pl, null, 'Same'), null);
});

test('sidePlayers survives missing players and broken playerInfo', () => {
  const pl = L.sidePlayers({ battle: { attacker: { players: [{ uid: 5, playerInfo: '{bad' }] }, defender: { players: [] } } });
  assert.deepEqual(pl, { attacker: { uid: '5', name: '' }, defender: null });
  assert.deepEqual(L.sidePlayers(null), { attacker: null, defender: null });
});

test('cardModel: closeness line, top 3 gaps, at most 4 steps, names for translate="no"', () => {
  const tables = { buffGroup: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'buff-group.json'), 'utf8')), heroes: data('all-heroes.json'),
    supportive: data('supportive-skills.json'), collectibles: data('loot-quest-collectibles.json'), formation: data('formation-v2.json'), enhance: data('enigma-platform-enhance.json') };
  const result = Coach.analyze(fixture(REX), tables);
  const snap = Coach.withSnapshot(result.sides.attacker, { enigma: { beasts: [{ id: 'a' }], fields: [], beast2field: {} }, runeBag: { 'All-Out Surge': 2 } }, tables);
  const m = L.cardModel(result, 'attacker', snap, 1791652817);
  assert.match(m.line, /^Out of reach this time: .+ did 9% of the damage needed to win\.$/);
  assert.equal(m.gaps.length, 3);
  assert.equal(m.moves.length, 4);
  assert.equal(m.won, false);
  assert.equal(m.snap, true);
  assert.equal(m.opp, result.sides.defender.name);
  assert.ok(m.names.indexOf(result.sides.attacker.heroes[0]) >= 0);
  const plain = L.cardModel(result, 'attacker', null, 0);
  assert.equal(plain.snap, false);
  assert.equal(plain.hasSnap, false, 'no Snapshot: the card asks for one');
  assert.equal(plain.moves.length, 4);
  // a Snapshot that has nothing to say about the steps shown is still a Snapshot: no "import one" line
  const held = L.cardModel(result, 'attacker', result.sides.attacker, 0, true);
  assert.deepEqual([held.snap, held.hasSnap], [false, true]);
});

test('cardModel: inside a tier the steps the Snapshot speaks to come first; tiers keep their order', () => {
  const mv = (id, tier, extra) => ({ id, tier, title: id, detail: '', extra });
  const res = { fight: { winner: 'attacker', closeness: null }, sides: { attacker: { name: 'A', heroes: [], gaps: [], moves: [
    mv('a', 'free'), mv('b', 'upgrade'), mv('c', 'upgrade', 'x'), mv('d', 'upgrade', 'y'), mv('e', 'long', 'z'), mv('f', 'free', 'w')] }, defender: { name: 'D', heroes: [] } } };
  const m = L.cardModel(res, 'attacker', res.sides.attacker, 0);
  assert.deepEqual(m.moves.map((x) => x.id), ['f', 'a', 'c', 'd']);
});

test('closenessText: none without a closeness, three wordings otherwise', () => {
  const sides = { attacker: { name: 'A' }, defender: { name: 'D' } };
  assert.equal(L.closenessText({ winner: 'attacker', closeness: null }, sides), '');
  assert.equal(L.closenessText({ winner: 'attacker', closeness: { loserProgress: 0.35, label: 'close' } }, sides), 'Close fight: D got 35% of the way to winning.');
  assert.equal(L.closenessText({ winner: 'defender', closeness: { loserProgress: 0.2, label: 'clear' } }, sides), 'Clear win for D: A got 20% of the way to winning.');
  assert.equal(L.closenessText({ winner: 'defender', closeness: { loserProgress: 0.004, label: 'out-of-reach' } }, sides), 'Out of reach this time: A did under 1% of the damage needed to win.');
});

test('the view never puts report or supplement text into innerHTML, and the copy has no em dashes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages', 'armory-coach.js'), 'utf8');
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src), false);
  assert.equal(/[—–]/.test(src), false);
});

test('the pages workflow ships the card, its tables and its tests', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  for (const f of ['pages/armory-coach.js', 'pages/report-coach.js', 'data/buff-group.json', 'test/armory-coach.test.js']) assert.ok(y.includes(f), f + ' missing from pages.yml');
});

test('pickMain: the highest own Combat Power wins over the newest report; a tie goes to the newest', () => {
  const c = (id, logtime, cp) => ({ id, logtime, cp });
  assert.equal(L.pickMain([c('new-weak', 90, 100), c('old-main', 10, 300), c('mid', 50, 200)]).id, 'old-main');
  assert.equal(L.pickMain([c('a', 10, 300), c('b', 90, 300), c('c', 50, 300)]).id, 'b', 'tie: newest');
  assert.equal(L.pickMain([c('a', 10, 300), c('b', 10, 300)]).id, 'a', 'full tie: the first');
  assert.equal(L.pickMain([c('a', 10, 0), c('b', 90, 0)]).id, 'b', 'no Combat Power anywhere: newest');
  assert.equal(L.pickMain([null, c('a', 1, 1)]).id, 'a');
  assert.equal(L.pickMain([]), null);
  assert.equal(L.pickMain(null), null);
});

test('sideCp reads the player side Combat Power from the first march', () => {
  const rex = fixture(REX);
  assert.equal(L.sideCp(rex, 'attacker'), Coach.analyze(rex, { buffGroup: {} }).sides.attacker.cp);
  assert.equal(L.sideCp(rex, 'defender'), Coach.analyze(rex, { buffGroup: {} }).sides.defender.cp);
  assert.ok(L.sideCp(rex, 'defender') > L.sideCp(rex, 'attacker'));
  assert.equal(L.sideCp({ battle: {} }, 'attacker'), 0);
  assert.equal(L.sideCp(null, 'attacker'), 0);
});

test('marchLine says which march the card is about', () => {
  assert.equal(L.marchLine(['Vivian', 'Franziska', 'Jett'], 'J™', 'Oct 10, 2026'), 'Your Vivian, Franziska and Jett march against J™ on Oct 10, 2026');
  assert.equal(L.marchLine(['Heid', 'Joan Mature'], 'X', ''), 'Your Heid and Joan Mature march against X');
  assert.equal(L.marchLine([], 'X', ''), 'Your march against X');
});

test('cardModel carries the march heroes and every area keeps its stats for the tap-to-open table', () => {
  const tables = { buffGroup: data('buff-group.json'), heroes: data('all-heroes.json'), supportive: data('supportive-skills.json'), collectibles: data('loot-quest-collectibles.json'), formation: data('formation-v2.json'), enhance: data('enigma-platform-enhance.json') };
  const result = Coach.analyze(fixture(REX), tables);
  const m = L.cardModel(result, 'attacker', result.sides.attacker, 1791652817);
  assert.deepEqual(m.heroes, ['Vivian', 'Franziska', 'Jett']);
  assert.ok(m.gaps.every((g) => g.stats && g.stats.length));
});

test('the view makes each area a button that opens a table, and no DOM string building', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages', 'armory-coach.js'), 'utf8');
  assert.match(src, /aria-expanded/);
  assert.match(src, /Tap a source to see the stats behind it/);
});

// The card follows the player's main march: an older report with a stronger own side beats the newest one.
test('candidate + pickMain: an older main-march report wins; unreadable reports and ones the player is not in drop out', () => {
  const sha = (u) => crypto.createHash('sha256').update(String(u)).digest('hex').slice(0, 16);
  const raw = (cp, t, aUid) => { const x = mk(aUid, 'Alpha', 222, 'Beta'); x.logtime = t; x.battle.fightMarches = [{ attBattlePowerVal: cp, defBattlePowerVal: 1 }]; return x; };
  const me = sha(111), hashesOf = (x) => ({ attacker: sha(x.battle.attacker.players[0].uid), defender: sha(222) });
  const reps = [{ id: 'new-weak', extracted: { logtime: 90 } }, { id: 'old-main', extracted: { logtime: 10 } }, { id: 'not-mine', extracted: { logtime: 95 } }, { id: 'broken', extracted: { logtime: 99 } }];
  const raws = { 'new-weak': raw(72, 90, 111), 'old-main': raw(112, 10, 111), 'not-mine': raw(500, 95, 999), broken: null };
  const cands = L.recentReports(reps).map((r) => L.candidate(r, raws[r.id], raws[r.id] ? hashesOf(raws[r.id]) : {}, me, 'Alpha'));
  assert.equal(cands.filter(Boolean).length, 2, 'the broken report and the one the player is not in are dropped');
  const pick = L.pickMain(cands.filter(Boolean));
  assert.equal(pick.id, 'old-main');
  assert.deepEqual([pick.key, pick.cp], ['attacker', 112]);
});
