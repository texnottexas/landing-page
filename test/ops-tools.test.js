'use strict';
// The real tool list and its deployment: every tool valid, every script shipped, gates as agreed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OC = require('../ops-core.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const raw = JSON.parse(read('ops-tools.json'));
const list = OC.validateTools(raw);
const cpLine = read('.github/workflows/pages.yml').split('\n').find((l) => l.includes('all-bookmarklet.js') && l.includes('_site/'));

test('every tool in ops-tools.json passes validation', () => {
  assert.equal(list.tools.length, raw.tools.length);
  assert.deepEqual(list.tools.map((t) => t.title), [
    'Snapshot', 'Skill Dismantle', 'Treasure Guard Merge', 'Alliance Defense Skipper', 'Class Talent Reset', 'TC Squad Sync', 'Troop Optimizer', 'Map Collector', 'Mask Mystery Boxes', 'Emoji Sender', 'Rickroll'
  ]);
  const ads = list.tools.find((t) => t.id === 'alliance-defense');
  assert.deepEqual(ads.ready, ['game'], 'no defender panel needed: it reads the event state itself');
  assert.equal(ads.overlay, '#ads-root');
  const fun = list.tools.find((t) => t.id === 'fun-stuff');
  assert.equal(fun.gate, 'member', 'any member can launch Emoji Sender');
  assert.equal(fun.title, 'Emoji Sender', 'renamed from Fun Stuff (Tex, 2026-10-09)');
  assert.equal(fun.desc, 'Send any chat emoji, locked packs and animated ones too, to the chat you have open.');
  assert.equal(fun.overlay, '#fun-root');
  assert.equal(fun.icon, 'smile');
  assert.deepEqual(fun.scripts, ['fun-stuff-core.js', 'fun-stuff.js']);
  const mbx = list.tools.find((t) => t.id === 'mask-boxes');
  assert.equal(mbx.gate, 'member', 'any member can launch Mask Mystery Boxes');
  assert.equal(mbx.overlay, '#mbx-root');
  assert.equal(mbx.icon, 'gift');
  const mc = list.tools.find((t) => t.id === 'map-collector');
  assert.equal(raw.tools.find((t) => t.id === 'map-collector').owners, undefined, 'Map Collector is gated by its own password, not an owners list');
  assert.equal(mc.ownerOnly, false, 'every member sees the Map Collector tile');
  assert.equal(mc.overlay, '#mapc-root');
});

test('the public registry names no player: no siteKey from player-data.json appears in a tool entry', () => {
  const text = JSON.stringify(raw.tools);   // codeSha256 left out: dev test player Artu's siteKey is deliberately its prefix
  const roster = JSON.parse(read('player-data.json'));
  const players = Array.isArray(roster) ? roster : (roster.players || []);
  const keys = players.map((p) => p.siteKey).filter((k) => /^[0-9a-f]{16}$/.test(k || ''));
  assert.ok(keys.length > 100, 'read the roster siteKeys');
  keys.forEach((k) => assert.ok(!text.includes(k), 'siteKey ' + k + ' is not published in a tool entry'));
  assert.ok(!/"owners"/.test(text), 'no owners list in the public registry');
});

test('gates match today: only Class Talent Reset needs the code, the rest are for members (Troop Optimizer opened 2026-10-08)', () => {
  const code = list.tools.filter((t) => t.gate === 'code').map((t) => t.id).sort();
  assert.deepEqual(code, ['class-reset']);
  assert.equal(list.tools.find((t) => t.id === 'troop').gate, 'member');
  assert.match(read('pages/rickroll.html'), /Class Talent Reset asks for this page\\'s code once per device\./);
  const page = read('pages/rickroll.html');
  const m = page.match(/PASS_SHA256 = '([0-9a-f]{64})'/);
  assert.ok(m, 'rickroll.html publishes its code hash');
  assert.equal(list.codeSha256, m[1], 'same unlock code as rickroll.html');
});

test('every script exists in the repo and is deployed by pages.yml', () => {
  assert.ok(cpLine, 'found the root-files cp line in pages.yml');
  const shipped = new Set(cpLine.trim().split(/\s+/));
  list.tools.forEach((t) => t.scripts.forEach((s) => {
    assert.ok(fs.existsSync(path.join(ROOT, s)), s + ' exists');
    assert.ok(shipped.has(s), s + ' is copied to the site');
  }));
  ['ops-center.js', 'ops-core.js', 'ops-kit.js', 'ops-tools.json', 'ops-center.txt'].forEach((f) => assert.ok(shipped.has(f), f + ' is copied to the site'));
});

test('player-facing text has no em dashes', () => {
  list.tools.forEach((t) => {
    assert.ok(!/—/.test(t.title + t.desc), t.id);
  });
  ['ops-center.js', 'ops-kit.js', 'ops-core.js'].forEach((f) => {
    const strings = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/—/.test(strings), f + ' (outside comments)');
  });
});

test('the bookmarklet is the standard loader for ops-center.js', () => {
  assert.equal(read('ops-center.txt').trim(),
    "javascript:(function(){var s=document.createElement('script');s.src='https://2864tw.com/ops-center.js?_='+Date.now();s.onerror=function(){alert('Ops Center failed to load. Check your connection and try again.');};document.body.appendChild(s);})();");
});

test('rickroll.html lists the Ops Center first', () => {
  const page = read('pages/rickroll.html');
  const first = page.slice(page.indexOf('var TOOLS = ['));
  assert.match(first.slice(0, 400), /file: 'ops-center'/);
});

test('tools carry the names players know, on their own screens and on rickroll.html', () => {
  const page = read('pages/rickroll.html');
  assert.match(page, /title: 'Troop Optimizer'/);
  assert.match(page, /title: 'Treasure Guard Merge \(standalone\)'/);
  assert.ok(!/Troop Placement/.test(page), 'rickroll.html');
  assert.ok(!/'Troop Placement/.test(read('troop-bookmarklet.js')), 'troop tool header and pill');
  assert.ok(!/Hunting Guild \u2014 Bulk Merge/.test(read('merge-bookmarklet.js')), 'merge tool header');
  assert.match(read('merge-bookmarklet.js'), /'Treasure Guard Merge'/);
});

test('only Troop Optimizer handles the base itself', () => {
  const auto = list.tools.filter((t) => t.auto.length).map((t) => t.id + ':' + t.auto.join(','));
  assert.deepEqual(auto, ['troop:base']);
});

test('rickroll.html shows only the Ops Center; the other tools are kept but hidden (Tex, 2026-10-08)', () => {
  const page = read('pages/rickroll.html');
  const list = page.slice(page.indexOf('var TOOLS = ['), page.indexOf('];', page.indexOf('var TOOLS = [')));
  const entries = list.split(/\n\s*\{ title: /).slice(1);
  assert.ok(entries.length >= 6, 'read the tool entries');
  entries.forEach((e) => {
    const isOps = /file: 'ops-center'/.test(e);
    assert.equal(/hidden: true/.test(e), !isOps, (isOps ? 'Ops Center shows: ' : 'hidden: ') + e.slice(0, 40));
  });
  assert.match(page, /TOOLS\.filter\(function\s*\(t\)\s*\{\s*return !t\.hidden;\s*\}\)\.forEach/, 'the page skips hidden tools');
  assert.match(page, /Copy the Ops Center link below/);
});

// Rickroll (Tex, 2026-10-09): the tile says "Rickroll" truthfully; the description stays generic.
test('Rickroll tile: titled Rickroll, a generic description, for members, its own overlay, script deployed', () => {
  const t = list.tools.find((x) => x.id === 'rickroll');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Rickroll');
  assert.equal(t.desc, 'A little something for the grind.');
  assert.ok(!/rick|roll|astley|never gonna|song|music|audio/i.test(t.desc + ' ' + t.keywords), 'the description gives nothing away');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.scripts, ['rickroll-audio.js']);
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#rr-root');
  assert.equal(t.icon, 'smile');
});
