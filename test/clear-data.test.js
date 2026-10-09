// Clear imported data must stick across devices: the rules for dropping or keeping a local
// supplement copy once the worker reports a clear. Run: node --test test/clear-data.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'armory-report.html'), 'utf8');

// Pull a top-level (two-space indent) function out of the page by name.
function grab(name) {
  const start = src.indexOf('\n  function ' + name + '(');
  assert.ok(start >= 0, 'missing helper ' + name);
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end + 5);
}
const labels = src.match(/\n  var _AR_KIND_LABELS = \{[\s\S]*?\};\n/)[0];
const h = new Function(
  labels + grab('_ar_supTsMs') + grab('_ar_clearedTsFrom') + grab('_ar_shouldDropForClear') + grab('_ar_kindLabels') +
  'return { _ar_supTsMs, _ar_clearedTsFrom, _ar_shouldDropForClear, _ar_kindLabels };'
)();

const T = '2026-10-01T12:00:00.000Z';
const ms = Date.parse(T);

test('supplement time lives at meta.ts for inv/gear/runepool, top-level ts otherwise', () => {
  assert.equal(h._ar_supTsMs('inv', { meta: { ts: T } }), ms);
  assert.equal(h._ar_supTsMs('gear', { meta: { ts: T } }), ms);
  assert.equal(h._ar_supTsMs('runepool', { meta: { ts: T } }), ms);
  assert.equal(h._ar_supTsMs('heroes', { ts: T }), ms);
  assert.equal(h._ar_supTsMs('bench', { ts: T }), ms);
  assert.equal(h._ar_supTsMs('inv', { ts: T }), 0);
  assert.equal(h._ar_supTsMs('heroes', null), 0);
  assert.equal(h._ar_supTsMs('heroes', { ts: 'garbage' }), 0);
});

test('cleared time is read from the header first, then the body', () => {
  assert.equal(h._ar_clearedTsFrom('1700000000000', null), 1700000000000);
  assert.equal(h._ar_clearedTsFrom(null, { error: 'not_found', cleared: 1700000000001 }), 1700000000001);
  assert.equal(h._ar_clearedTsFrom(null, { error: 'cleared', clearedTs: 1700000000002 }), 1700000000002);
  assert.equal(h._ar_clearedTsFrom(null, { error: 'not_found' }), 0);
  assert.equal(h._ar_clearedTsFrom(null, null), 0);
  assert.equal(h._ar_clearedTsFrom('abc', null), 0);
});

test('local copy is dropped when not newer than the clear, kept when newer', () => {
  assert.equal(h._ar_shouldDropForClear(ms - 1, ms), true);
  assert.equal(h._ar_shouldDropForClear(ms, ms), true);      // equal: the clear was of this very payload
  assert.equal(h._ar_shouldDropForClear(ms + 1, ms), false); // newer local data is never dropped
  assert.equal(h._ar_shouldDropForClear(0, ms), true);       // missing ts can never be proven newer
});

test('no clear means nothing is dropped', () => {
  assert.equal(h._ar_shouldDropForClear(ms, 0), false);
  assert.equal(h._ar_shouldDropForClear(0, 0), false);
  assert.equal(h._ar_shouldDropForClear(ms, undefined), false);
});

test('failure text uses tab names, not kind ids', () => {
  const t = h._ar_kindLabels(['inv', 'bench', 'chips']);
  assert.equal(t, 'Inventory, Bench Beasts, HT Chips');
  assert.ok(!/\b(inv|bench|chips|siteKey)\b/.test(t));
});
