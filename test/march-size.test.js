'use strict';
// March Size checker pure logic (ms* functions in pages/armory-report.html). This replaces the in-page
// `?msSelfTest=1` console assertions: the functions are pulled out of the page by name and run in a vm sandbox.
// Run: node --test test/march-size.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(process.env.ARMORY_FILE || path.join(ROOT, 'pages/armory-report.html'), 'utf8');

// Index of the `}` that closes the `{` at `open`, skipping strings, template literals and comments.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces at ' + open);
}
function fnSource(name) {
  const m = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  const open = SRC.indexOf('{', SRC.indexOf(')', m.index));
  return SRC.slice(m.index, matchBrace(SRC, open) + 1);
}
function varSource(name) { // `var NAME = {...};` (possibly multi-line)
  const m = new RegExp('^  var ' + name + '\\s*=', 'm').exec(SRC);
  if (!m) throw new Error('var not found: ' + name);
  const open = SRC.indexOf('{', m.index);
  return SRC.slice(m.index, SRC.indexOf(';', matchBrace(SRC, open)) + 1);
}

const ctx = vm.createContext({ console, Set });
vm.runInContext([
  ...['MS_SKILL_ID', 'MS_MAX_LEVEL', 'MS_BAG_ITEM_ID', 'MS_CHEST_RARE', 'MS_CHEST_PREMIUM'].map(varSource),
  ...['msResolveMarchSize', 'msEnumerateBenchSkills', 'msEnumerateBagSkills', 'msEnumerateChests', 'msBuildPool',
    'msComputeTarget'].map(fnSource),
].join('\n'), ctx);
const j = (o) => JSON.parse(JSON.stringify(o)); // vm objects have a foreign prototype; normalize for deepEqual

test('msResolveMarchSize', () => {
  assert.equal(ctx.msResolveMarchSize(null), null);
  assert.equal(ctx.msResolveMarchSize({}), null);
  assert.deepEqual(j(ctx.msResolveMarchSize({ id: 21116, lv: 8 })), { rarity: 'rare', level: 8 });
  assert.deepEqual(j(ctx.msResolveMarchSize({ id: 20116, lv: 5 })), { rarity: 'normal', level: 5 });
  assert.equal(ctx.msResolveMarchSize({ id: 99999, lv: 3 }), null);
});

const heroesFixture = {
  list: [
    // Hero 101: P1 b[0] = Rare Lv 8, P2 b[0] = Normal Lv 5: 2 hits
    { id: 101, p1: { b: [{ id: 21116, lv: 8 }], x: [] }, p2: { b: [{ id: 20116, lv: 5 }], x: [] } },
    // Hero 102: P1+P2 b[0] same Rare Lv 6: 2 raw hits, dedupes to 1 card in the pool
    { id: 102, p1: { b: [{ id: 21116, lv: 6 }], x: [] }, p2: { b: [{ id: 21116, lv: 6 }], x: [] } },
    // Hero 103: unrelated skill in b[0], march-size in x[2] + x[3]: 2 raw hits per preset
    { id: 103,
      p1: { b: [{ id: 99, lv: 1 }], x: [{ id: 0, lv: 0 }, { id: 0, lv: 0 }, { id: 20116, lv: 4 }, { id: 21116, lv: 4 }] },
      p2: { b: [], x: [{ id: 0, lv: 0 }, { id: 0, lv: 0 }, { id: 20116, lv: 4 }, { id: 21116, lv: 4 }] } },
  ],
};

test('msEnumerateBenchSkills counts b[0] and every x slot (8 raw hits, pre-dedup)', () => {
  assert.equal(ctx.msEnumerateBenchSkills(heroesFixture).length, 8);
});

test('M1: a march-size card in x[0] is counted', () => {
  const hits = ctx.msEnumerateBenchSkills({
    list: [{ id: 104, p1: { b: [], x: [{ id: 21116, lv: 2 }] }, p2: null }],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].slotKind, 'x');
  assert.equal(hits[0].slotIdx, 0);
});

test('msBuildPool: bag + chests + bench dedup, exclusions and marched heroes', () => {
  const invFixture = {
    tabs: {
      hero: [{ id: ctx.MS_BAG_ITEM_ID.rare[5], l: 5, a: 7 }],
      item: [{ id: 20220307, a: 4 }, { id: 39200159, a: 2 }, { id: 39200250, a: 1 }],
    },
  };
  const built = ctx.msBuildPool({
    heroesSupp: heroesFixture, invSupp: invFixture,
    excludedHeroIds: new Set([101]), marchedHeroIds: new Set([103]),
  });
  assert.equal(built.pool.rare[6], 1, 'rare[6] = 1 from hero 102 b-slot dedup');
  assert.equal(built.pool.rare[5], 10, 'rare[5] = 7 bag + 2 chest + 1 premium');
  assert.equal(built.pool.rare[1], 4, 'rare[1] = 4 from Lv 1 chests');
  assert.equal(built.breakdown.benchEquipped.length, 1, 'only hero 102 (101 excluded, 103 marched)');

  const benchPool = ctx.msBuildPool({
    heroesSupp: heroesFixture, invSupp: { tabs: { hero: [], item: [] } },
    excludedHeroIds: new Set(), marchedHeroIds: new Set(),
  });
  assert.equal(benchPool.pool.rare[4], 1, 'x[3] Rare Lv 4 dedups across presets');
  assert.equal(benchPool.pool.normal[4], 1, 'x[2] Normal Lv 4 dedups across presets');
  assert.equal(benchPool.breakdown.benchEquipped.length, 5, '2 (101) + 1 (102) + 2 (103) cards');
});

test('msComputeTarget: ready, almost, short, maxed out', () => {
  const t1 = ctx.msComputeTarget({ rarity: 'rare', currentLevel: 5 }, { rare: { 5: 4 } });
  assert.equal(t1.status, 'ready');
  assert.equal(t1.bottomShortage, 0);

  const t2 = ctx.msComputeTarget({ rarity: 'rare', currentLevel: 6 }, { rare: { 6: 1, 5: 5 } });
  assert.equal(t2.status, 'almost');
  assert.equal(t2.bottomShortage, 0);
  assert.equal(t2.walkDown.length, 2);

  const t3 = ctx.msComputeTarget({ rarity: 'rare', currentLevel: 3 }, { rare: {} });
  assert.equal(t3.status, 'short');
  assert.equal(t3.bottomShortage, 18);

  const t4 = ctx.msComputeTarget({ rarity: 'rare', currentLevel: ctx.MS_MAX_LEVEL.rare }, { rare: { 99: 1 } });
  assert.equal(t4.maxedOut, true);
});
