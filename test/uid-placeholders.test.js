// No real UID as an example: a UID is private (and signs a player in), so every
// "e.g." UID in the pages is the all-zero sample. Run: node --test test/uid-placeholders.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = path.join(__dirname, '..', 'pages');

test('UID examples in the pages are the all-zero sample', () => {
  const found = [];
  for (const name of fs.readdirSync(PAGES).filter((n) => /\.(html|js)$/.test(n))) {
    const src = fs.readFileSync(path.join(PAGES, name), 'utf8');
    for (const m of src.matchAll(/e\.g\.\s*([0-9]{12,13})(?![0-9])/g)) {
      if (!/^0+$/.test(m[1])) found.push(`${name}: e.g. ${m[1].slice(0, 3)}…`);
    }
  }
  assert.deepEqual(found, []);
});
