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
