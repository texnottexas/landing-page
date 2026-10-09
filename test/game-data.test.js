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

// ---- Decorations ----
const LEVELS = JSON.parse(read('data/decoration-levels.json'));
const LOOKUPS = JSON.parse(read('data/decor-lookups.json'));

test('Crimson Warrior Statue (6044) shard costs follow the game: 180, 540, 1620 ... in both data files', () => {
  const fu = [0, 180, 540, 1620, 4860, 14580, 43740, 131220, 393660, 1180980, 3542940, 10628820, 31886460, 95659380, 286978140];
  assert.deepEqual(LEVELS['6044'].levels.map((l) => l.fu), fu);
  assert.deepEqual(LOOKUPS.PL['6044'].sc, fu);
});

test('Valkyrie Warrior, Signal Tower and Crimson Warrior Statue take Universal Decor Shards (fi 20213232, 15 levels)', () => {
  for (const g of ['6033', '6036', '6044']) {
    assert.equal(LEVELS[g].fi, 20213232, g);
    assert.equal(LEVELS[g].ml, 15, g);
  }
});

test('advisor buff strings split on commas as well as spaces (group 5556 keeps both buffs)', () => {
  const parse = fn(ARMORY, '_adv_parseBuffMap', {});
  assert.deepEqual(JSON.parse(JSON.stringify(parse('980204|200,930100|200'))), { 980204: 200, 930100: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(parse('980204|200 930100|200'))), { 980204: 200, 930100: 200 });
  assert.deepEqual(JSON.parse(JSON.stringify(parse('1001001|250'))), { 1001001: 250 });
  assert.equal(LEVELS['5556'].levels[0].be, '980204|200,930100|200');
});

test('advisor placed level uses the game id -> level map (Travel Trunk stride 10)', () => {
  const ctx = {
    DECOR_GROUP_BASE: LOOKUPS.DECOR_GROUP_BASE, LV_BY_ID: LOOKUPS.LV_BY_ID,
    decorIdToGroup: (id) => LOOKUPS.DECOR_ID_TO_GROUP[String(id)],
  };
  ctx.decorLevel = fn(ARMORY, 'decorLevel', ctx);
  const placed = fn(ARMORY, '_adv_getPlacedLevel', ctx);
  assert.equal(placed('6003', { decorations: { ids: [54708, 54718] } }), 2);
  assert.equal(placed('6003', { decorations: { ids: [54708] } }), 1);
  assert.equal(placed('6003', { decorations: { ids: [] } }), 0);
});

test('city skill for skin 1844000 is named Kaiju Slayer', () => {
  assert.match(ARMORY, /"1844000":\["Kaiju Slayer"/);
});

// ---- Decor advisor ranking ----
const advisorFns = () => {
  const ctx = vm.createContext({
    ADVISOR_STAT_BUFFS: { march_size: ['960012'], attack: ['930100'] },
  });
  vm.runInContext(['_adv_statView', '_adv_rankRecs'].map((n) => {
    const i = ARMORY.indexOf('function ' + n + '(');
    assert.ok(i >= 0, n);
    const b = ARMORY.slice(i);
    return b.slice(0, b.search(/\n  \}\n/) + 4);
  }).join('\n') + '\nthis.view = _adv_statView; this.rank = _adv_rankRecs;', ctx);
  return ctx;
};
const rec = (name, group, cost, rows) => ({ name, group, shardCost: cost, rawShardCost: cost, buffRows: rows });
const row = (id, scalar) => ({ id: String(id), scalar, label: 'b' + id, displayDelta: '+' + scalar });

test('advisor ranks on the selected stat only and lists the other buffs as "also gives"', () => {
  const { view } = advisorFns();
  // Pretty Chill gives a big non-march buff plus a small march buff; Plain gives more march per shard.
  const pretty = view(rec('Pretty Chill 2022', 1, 100, [row(930100, 5000), row(960012, 10)]), 'march_size');
  const plain = view(rec('Plain Decor', 2, 100, [row(960012, 40)]), 'march_size');
  assert.equal(pretty.roi, 0.1);
  assert.equal(plain.roi, 0.4);
  const J = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(J(pretty.buffRows.map((r) => r.id)), ['960012']);
  assert.deepEqual(J(pretty.alsoRows.map((r) => r.id)), ['930100']);
  const { rank } = advisorFns();
  assert.deepEqual(J(rank([pretty, plain]).map((r) => r.name)), ['Plain Decor', 'Pretty Chill 2022']);
});

test('advisor ties go to the cheaper upgrade, then the name', () => {
  const { rank } = advisorFns();
  const a = { name: 'Zed', shardCost: 50, roi: 1 }, b = { name: 'Amy', shardCost: 100, roi: 1 },
        c = { name: 'Bob', shardCost: 50, roi: 1 }, d = { name: 'Top', shardCost: 500, roi: 2 };
  assert.deepEqual(JSON.parse(JSON.stringify(rank([a, b, c, d]).map((r) => r.name))), ['Top', 'Bob', 'Zed', 'Amy']);
  assert.deepEqual(JSON.parse(JSON.stringify(rank([d, c, b, a]).map((r) => r.name))), ['Top', 'Bob', 'Zed', 'Amy']);
});

test('advisor lists each decor group once even if the index repeats it', () => {
  assert.match(ARMORY, /seenGroups\[String\(entry\.group\)\]/);
});

// ---- Beast optimizer ----
test('the optimizer no longer fetches the missing enigma-tg-refinement-link.json', () => {
  assert.ok(!ARMORY.includes('enigma-tg-refinement-link'));
  assert.ok(!ARMORY.includes('boTgLinkData'));
  assert.ok(!fs.existsSync(path.join(ROOT, 'data/enigma-tg-refinement-link.json')));
});

test('refinement-driven slots (fields 4-5, slots 7-9) score 0 without the player\'s own gear', () => {
  const ctx = vm.createContext({
    BO_TG_DYNAMIC_OVERRIDES: null,
    BO_RARITY_BUFF_TABLE: literal(ARMORY.slice(ARMORY.indexOf('var BO_RARITY_BUFF_TABLE')).replace('var BO_RARITY_BUFF_TABLE =', 'var BO_RARITY_BUFF_TABLE ='), 'BO_RARITY_BUFF_TABLE'),
    BO_RARITY_DEFAULT_WEIGHTS: [{ statKey: 'atk', targetUnit: 0, weightRatio: 0.15 }],
  });
  const src = ['boIsRefinementDrivenSlot', 'boResolveSlotWeights'].map((n) => {
    const i = ARMORY.indexOf('function ' + n + '(');
    const b = ARMORY.slice(i);
    return b.slice(0, b.search(/\n  \}\n/) + 4);
  }).join('\n') + '\nthis.w = boResolveSlotWeights;';
  vm.runInContext(src, ctx);
  for (const o of [7, 8, 9]) for (const f of [4, 5]) assert.equal(ctx.w({ fieldType: f, order: o }).length, 0);
  assert.ok(ctx.w({ fieldType: 4, order: 6 }).length > 0);
  ctx.BO_TG_DYNAMIC_OVERRIDES = { '4:7': [{ statKey: 'def', targetUnit: 1, weightRatio: 0.2 }] };
  assert.equal(ctx.w({ fieldType: 4, order: 7 }).length, 1);
});
