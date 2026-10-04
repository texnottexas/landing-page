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
    'Snapshot', 'Skill Dismantle', 'Treasure Guard Merge', 'Alliance Defense Skipper', 'Class Talent Reset', 'TC Squad Sync', 'Troop Optimizer', 'Map Collector'
  ]);
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

test('gates match today: Class Talent Reset and Troop Optimizer need the code, the rest are for members', () => {
  const code = list.tools.filter((t) => t.gate === 'code').map((t) => t.id).sort();
  assert.deepEqual(code, ['class-reset', 'troop']);
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
