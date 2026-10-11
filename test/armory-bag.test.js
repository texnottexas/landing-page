'use strict';
// ArmoryBagLogic (pages/armory-bag.js): the Bag screen's data rules. The classifier, the gem / Odinium / VIT parsers and the rehydrate step are verbatim
// copies of the classic Inventory tab; this test (1) requires the page's exact source text for each in the module, (2) runs the PAGE's own functions and the
// copies on the same synthetic bag (real ids from the public item / building / army tables, no player data) and requires identical output, and (3) checks the
// v2 rules (resources, view, formatting, icon whitelist) with hand-computed numbers.
// Run: node --test test/armory-bag.test.js     ARMORY_FILE=<scratch copy of the page> proves (1) and (2) fail when the page changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./helpers/armory-page.js');
const Bag = require('../pages/armory-bag.js');
const G = require('../pages/tw-game-data.js');
const Core = require('../pages/armory-core.js');

const SRC = fs.readFileSync(path.join(P.ROOT, 'pages/armory-bag.js'), 'utf8');
const NAMES = ['_ar_sanitizeName', '_ar_resolveItemIcon', '_ar_heroSubtab', '_AR_BUCKET_ORDER', '_AR_BUCKET_INDEX', '_ar_isSpeedup', '_ar_isHTChip', '_ar_isFormation', '_ar_isEnigma', '_AR_SKILL_UNIVERSAL_IDS', '_ar_isSkillOrUniversal', '_ar_isCombatBuff', '_ar_isChoiceChest', '_AR_UNIT_CHOICE_IDS', '_ar_isUnitChoice', '_ar_resourceKind', '_ar_parseSuffixed', '_ar_packQuantity', '_ar_compactNumber', '_ar_classifyItemBucket', '_ar_classifyTitanGear', '_ar_boxedGemsPerOpen', '_ar_boxedOdiniumPerOpen', '_ar_vitYieldFromCfg', '_ar_boxedVitPerOpen', '_ar_gemValueFromCfg', '_ar_rehydrateInv'];

test('every copied function is the page\'s exact text', () => {
  for (const n of NAMES) {
    const s = P.fnSource(n) || P.varSource(n);
    assert.ok(s, n + ' is not in the page');
    assert.ok(SRC.includes(s), n + ' differs from the page');
  }
});

const item = P.data('item-table.json'), building = P.data('building-table.json'), army = P.data('army-icon-map.json'), heroes = P.data('all-heroes.json'), cat = P.data('decor-category-map.json');
const lk = { item, building, army, heroById: Object.fromEntries(heroes.map((h) => [h.heroId, h])), decorCat: cat };
const decor = P.data('decor-lookups.json');
const env = { RUNE_ICON: G.RUNE_ICON, DECOR_SUIT_GROUPS: decor.DECOR_SUIT_GROUPS, DECOR_SUITS: decor.DECOR_SUITS };
// a synthetic bag: the first few ids of each kind the classifier cares about, so every bucket and aggregate is exercised
function pick(f, n) { return Object.keys(item).filter((k) => f(item[k])).slice(0, n).map((k) => ({ id: +k, a: 3 })); }
const bagItems = [].concat(
  pick((c) => c.g === 1000000, 4), pick((c) => c.t === 106 && c.g === 940001, 2), pick((c) => c.t === 27 && c.g === 910000, 2), pick((c) => c.t === 25 && c.g === 920000, 2),
  pick((c) => c.t === 153, 3), pick((c) => c.t === 140 || c.t === 141 || c.t === 142, 3), pick((c) => c.t === 28, 2), pick((c) => c.t === 31, 2), pick((c) => c.t === 100, 2),
  pick((c) => /VIT/.test(c.n || ''), 3), pick((c) => /Odinium/.test(c.d || '') && c.g !== 940001, 3), pick((c) => /Gems/.test(c.d || '') && c.g !== 1000000, 3), [{ id: 20213232, a: 7 }, { id: 10000196, a: 2 }, { id: 44301001, a: 62 }, { id: 99999999, a: 1 }]);
const decorIds = Object.keys(building).filter((k) => building[k].g).slice(0, 30).map((k) => ({ id: +k, a: 2, l: 1, g: building[k].g }));
const inv = { v: 1, meta: { ts: '2026-10-10T00:00:00Z' }, resources: { _gold: 1000, _thor: 5 }, tabs: { item: bagItems, unit: Object.keys(army).slice(0, 5).map((k) => ({ id: +k, a: 4 })), decor: decorIds, hero: pick((c) => c.t === 42 || c.t === 31 || c.t === 46, 6), cpnt: [{ id: 403502, a: 3 }] } };

test('rehydrate and the classifier give the page\'s output on the same bag', () => {
  const ctx = P.loadPage(NAMES.concat(['RUNE_ICON']), Object.assign({ DECOR_SUIT_GROUPS: env.DECOR_SUIT_GROUPS, DECOR_SUITS: env.DECOR_SUITS, _ar_reportMissingLookup() {}, RUNE_ICON: G.RUNE_ICON }));
  const page = P.j(ctx._ar_rehydrateInv(P.clone(inv), lk));
  const mine = P.j(Bag.create(env).rehydrate(P.clone(inv), lk));
  assert.deepEqual(mine, page);
  assert.ok(page.tabs.item.length > 20 && page.gemTotal > 0, 'the fixture reaches the gem path');
  const b = new Set(page.tabs.item.map((x) => x.bucket));
  assert.ok(b.size >= 5, 'several buckets: ' + [...b]);
});

test('formatting: digits to a quadrillion, the game\'s letters beyond, no exponent below gg', () => {
  assert.equal(Bag.fmtBig(23429), '23,429');
  assert.equal(Bag.fmtBig(3027807924), '3,027,807,924');
  assert.equal(Bag.fmtBig(1e15), '1aa');
  assert.match(Bag.fmtBig(5.8230638e35), /^582\.31?gg$|^582\.3gg$/);
  assert.equal(Bag.fmtBig(1e300), '1e300');
  assert.equal(Bag.fmtBig('<img>'), '0'); assert.equal(Bag.fmtBig(NaN), '0'); assert.equal(Bag.fmtBig(Infinity), '0');
  assert.equal(Bag.fmtCell(999999), '999,999'); assert.equal(Bag.fmtCell(1234567), '1.2M'); assert.equal(Bag.fmtCell(2.5e12), '2.5T');
});

test('icon urls: a bare file name in one of the two known folders, nothing else', () => {
  const raw = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/inventory-icons';
  assert.equal(Bag.iconUrl({ icon: 'a.png', iconDir: raw }), raw + '/a.png');
  assert.equal(Bag.iconUrl({ icon: 'x.png', iconDir: 'https://h5.topwargame.com/DynRes/images/items' }), 'https://h5.topwargame.com/DynRes/images/items/x.png');
  for (const bad of ['../a.png', 'a/b.png', '..', 'a"onerror=1', 'javascript:1', '', null, 5]) assert.equal(Bag.iconUrl({ icon: bad, iconDir: raw }), '', String(bad));
  assert.equal(Bag.iconUrl({ icon: 'a.png', iconDir: 'https://evil.example/x' }), '');
  assert.equal(Bag.iconUrl({ icon: 'a.png', iconDir: raw + '/../../x' }), '');
});

const core = Core.create();
const L = Bag.create(env);
const data = L.rehydrate(P.clone(inv), lk);

test('resources: the classic bars\' sums, plus the shards and stones with the shard rule (direct + 10 per box)', () => {
  const rows = L.resources(data, inv, core), by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.gems.value, 1000 + data.gemTotal + data.boxedGemTotal);
  assert.equal(by.odinium.value, 5 + data.aggTotals.odinium + data.boxedOdiniumTotal);
  assert.equal(by.shards.value, 7 + 10 * 2); assert.equal(by.stones.value, 62);
  assert.equal(by.shards.link, 'spend'); assert.equal(by.stones.link, 'stones');
  const none = L.resources(L.rehydrate({ v: 1, resources: {}, tabs: { item: [] } }, lk), { tabs: { item: [] } }, core);
  assert.deepEqual(none, [], 'an empty bag has no rows');
});

test('view: tabs, categories, search (name and description, not ids), quality, sort, aggregate cells', () => {
  const all = L.view(data, { tab: 'item', cat: 'all' });
  assert.ok(all.cells.some((c) => c.agg === 'gem'), 'the gem total cell');
  assert.ok(!all.cells.some((c) => c.it && (c.it.group === 940001)), 'raw Odinium packs are folded');
  const bi = (c) => L.bucketOrder.indexOf(c.it ? c.it.bucket : c.agg === 'gem' ? 'gem' : 'resource');
  const ix = all.cells.map(bi); for (let i = 1; i < ix.length; i++) assert.ok(ix[i] >= ix[i - 1], 'default order follows the bucket priority');
  const q5 = L.view(data, { tab: 'item', cat: 'all', quality: '5' }).cells.filter((c) => c.it);
  assert.ok(q5.length && q5.every((c) => c.it.quality === 5));
  const byAmt = L.view(data, { tab: 'item', cat: 'all', sort: 'amount' }).cells.filter((c) => c.it).map((c) => c.it.amount);
  assert.deepEqual(byAmt, byAmt.slice().sort((a, b) => b - a));
  assert.equal(L.view(data, { tab: 'item', cat: 'all', q: String(data.tabs.item[0].id) }).cells.length, 0, 'an id is not a search term');
  const nm = all.cells.find((c) => c.it && c.it.name).it.name;
  assert.ok(L.view(data, { tab: 'item', cat: 'all', q: nm.toUpperCase() }).cells.some((c) => c.it && c.it.name === nm));
  const g = L.view(data, { tab: 'decor', cat: 'other' });
  assert.ok(g.groups && g.groups.length, 'decor is grouped');
  assert.equal(L.view(data, { tab: 'nope' }).cells.length > 0, true, 'an unknown tab reads as Items');
  const cats = L.categories(data, 'item'); assert.equal(cats[0][0], 'all'); assert.equal(cats[0][2], data.tabs.item.length);
  assert.ok(cats.every((c) => c[0] === 'all' || c[2] > 0), 'empty categories are hidden');
});

test('an unknown id keeps its row with a safe name, and the sheet model finds items by tab and id', () => {
  const unk = data.tabs.item.find((x) => x.id === 99999999);
  assert.ok(unk && /^#/.test(unk.name));
  const f = L.findItem(data, 'item:44301001'); assert.equal(f.it.amount, 62);
  assert.equal(L.findItem(data, 'item:abc'), null); assert.equal(L.findItem(data, '__proto__:1'), null);
  const agg = L.aggModel('gem', data); assert.equal(agg.total, data.aggTotals.gem + data.boxedGemTotal); assert.equal(L.aggModel('constructor', data), null); assert.equal(L.findItem(data, 'constructor:1'), null);
});

test('the stone id matches the view-model\'s', () => {
  assert.equal(L.STONE_ID, require('../pages/armory-vm.js').AW.STONE);
});
