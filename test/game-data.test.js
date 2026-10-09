'use strict';
// Game-data corrections for the armory report, checked against values read from the live game tables (2026-10-02).
// The page is a single HTML file with its tables inline, so each test lifts the literal it needs out of the source.
// Run: node --test test/game-data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ARMORY = read('pages/armory-report.html');
const COPIES = ['pages/armory-report.html', 'pages/battle-report.html', 'pages/report-render.js'];

// Evaluate the right-hand side of `var NAME = <literal>;` from a source string.
function literal(src, name) {
  const m = src.match(new RegExp('var ' + name + '\\s*=\\s*(\\{.*?\\});', 's'));
  assert.ok(m, name + ' not found');
  return JSON.parse(JSON.stringify(vm.runInNewContext('(' + m[1] + ')')));
}

for (const f of COPIES) {
  test(f + ': Titan Gear random-stat max rolls follow the game (gold full, lower tiers 0.6/0.4/0.2x)', () => {
    const T = literal(read(f), 'GEAR_TEMPLATE');
    assert.equal(Object.keys(T).length, 540);
    // gold, unchanged
    assert.equal(T[1].m, 600); assert.equal(T[19].m, 3000); assert.equal(T[82].m, 300);
    // purple (0.6x)
    assert.equal(T[271].m, 360); assert.equal(T[289].m, 1800); assert.equal(T[352].m, 180);
    // blue (0.4x)
    assert.equal(T[541].m, 240); assert.equal(T[559].m, 1200); assert.equal(T[622].m, 120);
    // green (0.2x)
    assert.equal(T[811].m, 120); assert.equal(T[829].m, 600); assert.equal(T[892].m, 60);
    // template 278 rolled 201: 56%, not 33%
    assert.equal(Math.round(201 / T[278].m * 100), 56);
  });
  test(f + ': rune template 2030351 is Stealth Hologram, 1 of 2 stars', () => {
    const R = literal(read(f), 'RUNE_MAP');
    assert.deepEqual(R[2030351], { n: 'Stealth Hologram', s: 1, sm: 2 });
  });
}

// ---- Enigma beasts ----
// Pull a named top-level function out of the page source and evaluate it with the given globals.
function fn(src, name, globals) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' not found');
  const body = src.slice(i);
  const end = body.search(/\n  \}\n/);
  const ctx = vm.createContext(Object.assign({ window: {} }, globals));
  vm.runInContext(body.slice(0, end + 4) + '\nthis.__f = ' + name + ';', ctx);
  return ctx.__f;
}
const objLit = (name) => literal(ARMORY, name);

test('Lynx beasts (cfg 81-84) decode as type 5, gold, faction 1-4', () => {
  const dec = fn(ARMORY, 'ebDecodeCfg', {});
  for (const cfg of [81, 82, 83, 84]) assert.deepEqual(JSON.parse(JSON.stringify(dec(cfg))), { type: 5, faction: cfg - 80, quality: 5 });
  // other types still decode
  assert.deepEqual(JSON.parse(JSON.stringify(dec(20))), { type: 1, faction: 4, quality: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(dec(105))), { type: 6, faction: 1, quality: 5 });
});

test('max potential per quality is 3200/4800/6400/8000/16000', () => {
  assert.deepEqual(objLit('EB_MAX_POTENTIAL'), { 1: 3200, 2: 4800, 3: 6400, 4: 8000, 5: 16000 });
  assert.ok(!/maxPotential:\s*[^,\n]*\?\s*8000\s*:\s*16000/.test(ARMORY), 'no quality===4 shortcut left');
});

test('field buff names follow the game (990202 DEF, 1000021 HP, 1000022 ATK) and the extra ids are named', () => {
  const N = objLit('EB_FIELD_BUFF_NAMES');
  assert.equal(N[990202], 'All Units DEF Increase');
  assert.equal(N[1000021], 'Unit HP');
  assert.equal(N[1000022], 'Unit ATK');
  assert.equal(N[1000023], 'DMG Increase');
  assert.equal(N[1000024], 'Decreased DMG Taken');
  assert.equal(N[9301201], 'Navy - Army DMG Bonus');
});

test('field 3 (Equip) has six unlock conditions, one per slot', () => {
  const C = objLit('EB_FIELD_CONDITIONS');
  assert.equal(C[3].length, 6);
  assert.equal(C[3][5], 'Deploy 5 at 2+ stars');
  assert.deepEqual([C[1].length, C[2].length, C[4].length, C[5].length], [5, 7, 9, 9]);
});

test('talent buffs 9301201-3 weigh as ATK (game effect type 323)', () => {
  const m = ARMORY.match(/var BO_TALENT_BUFF_CLASS = (\{[\s\S]*?\n  \});/);
  const C = vm.runInNewContext('(' + m[1] + ')');
  for (const id of [9301201, 9301202, 9301203]) assert.equal(C[id].statKey, 'atk');
  assert.equal(C[1000023].statKey, 'dmgInc');
});

// ---- Heroes ----
test('the seven newest heroes have a branch in HERO_TYPE_MAP (game hero table)', () => {
  const m = ARMORY.match(/var HERO_TYPE_MAP\s*=\s*(\{.*?\});/);
  const M = JSON.parse(JSON.stringify(vm.runInNewContext('(' + m[1] + ')')));
  const want = { 172: 1, 173: 1, 174: 1, 239: 2, 240: 2, 241: 2, 338: 3 };
  for (const [id, t] of Object.entries(want)) assert.equal(M[id], t, 'hero ' + id);
  assert.equal(M[101], 1);
});

test('heroBranch falls back to the supplement hero_type for a hero the map lacks', () => {
  const m = ARMORY.match(/var HERO_TYPE_MAP\s*=\s*(\{.*?\});/);
  const heroBranch = fn(ARMORY, 'heroBranch', {
    HERO_TYPE_MAP: vm.runInNewContext('(' + m[1] + ')'),
    HERO_TYPE_NAMES: { 1: 'Army', 2: 'Navy', 3: 'Air Force' },
    HERO_TYPE_CACHE: null
  });
  assert.equal(heroBranch(239), 'Navy');
  assert.equal(heroBranch(99999, 2), 'Air Force');
  assert.equal(heroBranch(99999), 'Unknown');
});

test('hero 1209 native skill is 10209 (and 209 is 11209), every other hero is 10000 + id', () => {
  const f = fn(ARMORY, '_heroNativeSkillId', {});
  assert.equal(f(1209), 10209);
  assert.equal(f(209), 11209);
  assert.equal(f(101), 10101);
});
