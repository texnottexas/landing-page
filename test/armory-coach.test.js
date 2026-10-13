'use strict';
// Armory v2 "From your last battle" card: the rules in pages/armory-coach.js (no DOM). Run: node --test test/armory-coach.test.js
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

test('newest picks the highest logtime, the first of equals, and skips unusable entries', () => {
  const a = { id: 'a', extracted: { logtime: 5 } }, b = { id: 'b', extracted: { logtime: 9 } }, c = { id: 'c', extracted: { logtime: 9 } };
  assert.equal(L.newest([a, b, c]).id, 'b');
  assert.equal(L.newest([{ id: 'x', extracted: null }, a]).id, 'a');
  assert.equal(L.newest([]), null);
  assert.equal(L.newest(null), null);
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
