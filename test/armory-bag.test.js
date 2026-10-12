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
const NAMES = ['_ar_sanitizeName', '_ar_resolveItemIcon', '_ar_heroSubtab', '_AR_BUCKET_ORDER', '_AR_BUCKET_INDEX', '_ar_isSpeedup', '_ar_isHTChip', '_ar_isFormation', '_ar_isEnigma', '_AR_SKILL_UNIVERSAL_IDS', '_ar_isSkillOrUniversal', '_ar_isCombatBuff', '_ar_isChoiceChest', '_AR_UNIT_CHOICE_IDS', '_ar_isUnitChoice', '_ar_resourceKind', '_ar_parseSuffixed', '_ar_packQuantity', '_ar_compactNumber', '_ar_classifyItemBucket', '_ar_classifyTitanGear', '_ar_boxedGemsPerOpen', '_ar_boxedOdiniumPerOpen', '_ar_vitYieldFromCfg', '_ar_boxedVitPerOpen', '_ar_gemValueFromCfg', '_ar_rehydrateInv', '_AR_EFFECT_NAMES', '_ar_resolveEffectTags'];

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
const KNOWN = { 44301001: { n: 'Awakening Stone', f: 'item_44301001.png', d: 'x' }, 44300003: { n: 'Hero Awakening Card', f: 'item_44300003.png', d: 'y' } };
const raw = L.rehydrate(P.clone(inv), lk);
const data = L.prepare(P.clone(raw), KNOWN);

test('resources: what the player holds first (account + packs), the best case inside choice boxes apart, shards with the shard rule', () => {
  const rows = L.resources(data, inv, core), by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.gems.value, 1000 + data.gemTotal, 'the Gems headline does not add box contents');
  assert.equal(by.odinium.value, 5 + data.aggTotals.odinium);
  if (data.boxedGemTotal > 0) assert.equal(by.gems_boxes.value, data.boxedGemTotal);
  if (data.boxedOdiniumTotal > 0) assert.equal(by.odinium_boxes.value, data.boxedOdiniumTotal);
  assert.equal(by.shards.value, 7 + 10 * 2); assert.equal(by.stones.value, 62);
  assert.equal(by.shards.link, 'spend'); assert.equal(by.stones.link, 'stones');
  assert.deepEqual(rows.filter((r) => r.main).map((r) => r.key), ['shards', 'stones', 'gems'], 'shards, stones, gems lead');
  const none = L.resources(L.prepare(L.rehydrate({ v: 1, resources: {}, tabs: { item: [] } }, lk)), { tabs: { item: [] } }, core);
  assert.deepEqual(none, [], 'an empty bag has no rows');
});

test('untranslated keys and ids never reach players: names and descriptions', () => {
  for (const k of ['item_name41104', 'building_name_4190', 'itemName10000031', 'item_name_68000', '107027', '#123', 'Decor #5', 'Hero #9', '']) assert.equal(L.displayName({ name: k }, 'item'), 'Unknown item', k);
  assert.equal(L.displayName({ name: 'Lv 5', type: 201 }, 'unit'), 'Navy unit'); assert.equal(L.displayName({ name: 'Lv 5', type: 301 }, 'unit'), 'Air Force unit'); assert.equal(L.displayName({ name: 'Lv 5' }, 'unit'), 'Unit');
  assert.equal(L.displayName({ name: 'Magnetize Rune' }, 'item'), 'Magnetize Rune');
  assert.equal(L.cleanDesc('item_desc41104'), ''); assert.equal(L.cleanDesc('building_desc_4190'), '');
  const d = L.prepare(L.rehydrate({ v: 1, resources: {}, tabs: { item: [{ id: 41104, a: 2 }], decor: [{ id: 48141, a: 1, l: 1, g: 4827 }, { id: 99999998, a: 1 }] } }, Object.assign({}, lk, { item: Object.assign({}, item, { 41104: { n: 'item_name41104', d: 'item_desc41104', t: 1, q: 1, g: 41104, i: 'image/item/item_41104' } }), building: Object.assign({}, building, { 48141: { n: 'building_name_4190', d: 'building_desc_4190', g: 4827, q: 3, lv: 1, ml: 3 } }) })));
  assert.equal(d.tabs.item[0].label, 'Unknown item'); assert.equal(d.tabs.item[0].text, ''); assert.ok(d.tabs.item[0].unknown);
  assert.equal(d.tabs.decor[0].label, 'Unknown item', 'building_name_4190');
  assert.equal(L.view(d, { tab: 'item', q: 'item_name' }).cells.length, 0, 'search runs on the display name, not the key');
  assert.equal(L.view(d, { tab: 'item', q: 'unknown' }).cells.length, 3, 'unknown rows are findable as unknown');
});

test('descriptions: placeholders read X, nothing glued, no [markup], over the whole item table', () => {
  assert.equal(L.cleanDesc('Increases all marching time of this target by {0} minute(s) for {1} minute(s)'), 'Increases all marching time of this target by X minute(s) for X minute(s)');
  assert.equal(L.cleanDesc('the damage equals to {0}% of the total damage'), 'the damage equals to X% of the total damage');
  assert.equal(L.cleanDesc('Army DEF against Air Force +{0}%'), 'Army DEF against Air Force +X%');
  assert.equal(L.cleanDesc('Boost the [Field of Battle Force] skill'), 'Boost the Field of Battle Force skill');
  assert.equal(L.cleanDesc('item_des_Godzilla'), ''); assert.equal(L.cleanDesc('item_name_68000_auto'), '');
  const words = (t) => new Set(String(t).toLowerCase().replace(/[{}\[\]]|\d+/g, ' ').split(/[^a-z']+/).filter(Boolean));
  let n = 0;
  for (const k of Object.keys(item)) {
    const o = String(item[k].d == null ? '' : item[k].d), t = L.cleanDesc(o); n++;
    assert.ok(!/[{}\[\]]/.test(t) && !/ {2}/.test(t), k + ': ' + t);
    const ow = words(L.resolveEffectTags(o)); for (const w of words(t)) assert.ok(w === 'x' || ow.has(w), k + ' glued or invented "' + w + '": ' + t); // every word of the output was a word of the input
    if (/\{\d\}/.test(o)) assert.ok(/X/.test(t) || /^\s*$/.test(t), k);
  }
  assert.ok(n > 10000);
});

test('names: any single token with an underscore is a key; {n} is stripped from names; rarity counts match the grid', () => {
  for (const k of ['item_name_Godzilla_skill', 'item_name_Sins_hero', 'item_des_x', 'item_name_68000_auto', 'item_name_Godzilla_building']) assert.equal(L.displayName({ name: k }, 'item'), 'Unknown item', k);
  assert.equal(L.displayName({ name: 'Prajna Mask Clue {0}' }, 'item'), 'Prajna Mask Clue');
  assert.equal(L.displayName({ name: 'Rust_Free Paint' }, 'item'), 'Rust_Free Paint', 'a name with spaces is a name');
  const r = L.rarities(data, 'item');
  for (const x of r.slice(1)) assert.equal(x[2], L.view(data, { tab: 'item', quality: x[0] }).cells.length, 'rarity ' + x[0] + ' opens exactly the cells it counts');
  assert.ok(r.reduce((a, x) => a + (x[0] ? x[2] : 0), 0) < data.tabs.item.length, 'folded packs are not counted');
});

test('the Awakening Stone and Cards come from the item table (the game\'s names and art); the armory\'s own names are only a fallback', () => {
  const ASSETS = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/';
  assert.equal(raw.tabs.item.find((x) => x.id === 44301001).name, 'Awakening Stone', 'the table names it');
  const st = data.tabs.item.find((x) => x.id === 44301001);
  assert.equal(st.label, 'Awakening Stone'); assert.ok(!st.unknown); assert.equal(st.icon, 'image__item__item_44301001.png'); assert.equal(Bag.iconUrl(st), ASSETS + 'inventory-icons/image__item__item_44301001.png');
  for (const id of [44301001, 44300001, 44300002, 44300003, 44300004, 44300005, 44300006]) assert.ok(fs.existsSync(path.join(P.ROOT, 'assets/inventory-icons/image__item__item_' + id + '.png')), id + ' art');
  const dd = L.prepare(L.rehydrate({ v: 1, resources: {}, tabs: { item: [{ id: 44300003, a: 1 }] } }, lk), KNOWN);
  assert.equal(dd.tabs.item[0].label, 'Jett Awakening Card', 'the table wins over the overlay'); assert.ok(dd.tabs.item[0].text);
  const lkNoRow = Object.assign({}, lk, { item: Object.assign({}, item) }); delete lkNoRow.item['44301001'];
  const fb = L.prepare(L.rehydrate({ v: 1, resources: {}, tabs: { item: [{ id: 44301001, a: 1 }] } }, lkNoRow), KNOWN).tabs.item[0];
  assert.equal(fb.label, 'Awakening Stone', 'a table without the row falls back to the overlay'); assert.equal(Bag.iconUrl(fb), ASSETS + 'hero-awake-items/item_44301001.png');
  assert.equal(L.prepare(L.rehydrate({ v: 1, resources: {}, tabs: { item: [{ id: 44301001, a: 1 }] } }, lkNoRow), {}).tabs.item[0].label, 'Unknown item', 'without the row or the overlay it stays unknown');
});

test('view: default sort is by type (headed), "Rarity, high first" really sorts by rarity, search crosses every tab', () => {
  const all = L.view(data, { tab: 'item', cat: 'all' });
  assert.ok(all.cells.some((c) => c.agg === 'gem'), 'the gem total cell');
  assert.ok(all.groups.length > 3 && all.groups.every((g) => g.title), 'headed by type');
  const bi = (c) => L.bucketOrder.indexOf(c.it ? c.it.bucket : c.agg === 'gem' ? 'gem' : 'resource');
  const ix = all.cells.map(bi); for (let i = 1; i < ix.length; i++) assert.ok(ix[i] >= ix[i - 1], 'by-type order follows the bucket priority');
  const rar = L.view(data, { tab: 'item', cat: 'all', sort: 'quality' }).cells.filter((c) => c.it && !c.it.unknown).map((c) => c.it.quality);
  assert.deepEqual(rar, rar.slice().sort((a, b) => b - a), 'rarity, high first, across All items');
  assert.ok(new Set(rar).size > 1);
  const q5 = L.view(data, { tab: 'item', cat: 'all', quality: '5' }).cells;
  assert.ok(q5.length && q5.every((c) => c.it && c.it.quality === 5), 'a rarity filter leaves out the totals cells');
  const byAmt = L.view(data, { tab: 'item', cat: 'all', sort: 'amount' }).cells.filter((c) => c.it && !c.it.unknown).map((c) => c.it.amount);
  assert.deepEqual(byAmt, byAmt.slice().sort((a, b) => b - a));
  const last = L.view(data, { tab: 'item', cat: 'all', sort: 'name' }).cells.filter((c) => c.it); assert.ok(last[last.length - 1].it.unknown || !last.some((c) => c.it.unknown), 'unknown rows last');
  assert.equal(L.view(data, { tab: 'item', cat: 'all', q: String(data.tabs.item[0].id) }).cells.length, 0, 'an id is not a search term');
  const nm = data.tabs.decor.find((x) => !x.unknown).label, s = L.view(data, { tab: 'item', q: nm });
  assert.ok(s.search && s.cells.some((c) => c.it && c.it.label === nm && c.tab === 'decor'), 'a decor name typed on Items is found, tagged with its tab');
  assert.ok(s.groups.every((g) => /^t:/.test(g.key)));
  assert.ok(L.view(data, { tab: 'hero', cat: 'skills', q: 'odinium' }).cells.some((c) => c.agg === 'odinium'), 'Odinium finds its totals cell from any tab and category');
  assert.ok(L.view(data, { tab: 'item', q: 'gems' }).cells.some((c) => c.agg === 'gem'));
  const g = L.view(data, { tab: 'decor' });
  assert.ok(g.groups && g.groups.length && g.cells.length === data.tabs.decor.length, 'decor opens on All, grouped');
  assert.ok(g.groups.every((x) => !/Uncategorized/.test(x.title)));
  const h = L.view(data, { tab: 'hero' }); assert.equal(h.cells.length, data.tabs.hero.length, 'heroes open on All'); assert.ok(h.groups.length >= 1);
  assert.equal(L.view(data, { tab: 'nope' }).cells.length > 0, true, 'an unknown tab reads as Items');
});

test('categories count what view() shows; rarities are names; units are named by branch', () => {
  for (const tab of ['item', 'hero', 'decor']) for (const c of L.categories(data, tab)) assert.equal(c[2], L.view(data, { tab, cat: c[0] }).cells.length, tab + ' ' + c[0]);
  const cats = L.categories(data, 'item'); assert.equal(cats[0][0], 'all'); assert.equal(cats[0][2], L.total(data, 'item'));
  assert.ok(cats.every((c) => c[0] === 'all' || c[2] > 0), 'empty categories are hidden');
  const r = L.rarities(data, 'item'); assert.equal(r[0][1], 'All rarities'); assert.ok(r.slice(1).every((x) => /^(Legendary|Epic|Rare|Uncommon|Common|Rarity \d)$/.test(x[1])));
  assert.ok(data.tabs.unit.every((u) => /^(Army|Navy|Air Force) unit$/.test(u.label)));
});

test('an unknown id keeps its row, and the sheet model finds items by tab and id', () => {
  const unk = data.tabs.item.find((x) => x.id === 99999999);
  assert.equal(unk.label, 'Unknown item');
  const f = L.findItem(data, 'item:44301001'); assert.equal(f.it.amount, 62);
  assert.equal(L.findItem(data, 'item:abc'), null); assert.equal(L.findItem(data, '__proto__:1'), null);
  const agg = L.aggModel('gem', data); assert.equal(agg.total, data.aggTotals.gem + data.boxedGemTotal); assert.equal(agg.direct, data.aggTotals.gem); assert.equal(L.aggModel('constructor', data), null); assert.equal(L.findItem(data, 'constructor:1'), null);
});

test('the stone id matches the view-model\'s', () => {
  assert.equal(L.STONE_ID, require('../pages/armory-vm.js').AW.STONE);
});

test('no item description shows a raw <id=N> tag (v2 cleanDesc and the page helper agree)', () => {
  const pageFn = P.fnSource('_ar_resolveEffectTags');
  assert.ok(pageFn, 'page helper missing');
  const bag = L;
  let tagged = 0;
  for (const k of Object.keys(item)) {
    const d = item[k].d == null ? '' : String(item[k].d);
    const out = bag.cleanDesc(d);
    if (d.indexOf('<id=') >= 0) tagged++;
    assert.ok(out.indexOf('<id=') < 0, k + ' still shows a tag: ' + out);
    assert.ok(!/ {2}|\bby\s*[.,;)]|\bby$|\band\s*[.,;)]/.test(out), k + ' reads badly: ' + out);
  }
  assert.ok(tagged > 0);
  const f = bag.resolveEffectTags;
  assert.equal(f('Improve by <id=200> (number of <id=9> and <id=12> units).'), 'Improve (number of Silence and Debilitation units).');
  assert.equal(f("hero X's <id=90> and <id=91> effects."), "hero X's effects.");
});
