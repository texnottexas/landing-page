'use strict';
// Jam mode's pure part: which scripts and version play Rickroll. Run: node --test test/ops-jam.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../ops-jam.js');

test('jamScripts: the rickroll entry\'s scripts and version from the tool list; anything odd is null', () => {
  const reg = { tools: [{ id: 'angels', scripts: ['a.js'], version: '1' }, { id: 'rickroll', scripts: ['ops-drag.js', 'rickroll-audio.js'], version: '2026-10-14' }] };
  assert.deepEqual(J.jamScripts(reg), { version: '2026-10-14', scripts: ['ops-drag.js', 'rickroll-audio.js'] });
  assert.equal(J.jamScripts({ tools: [{ id: 'rickroll', scripts: ['https://evil.example/x.js'], version: '1' }] }), null, 'plain file names only');
  assert.equal(J.jamScripts({ tools: [{ id: 'rickroll', scripts: [], version: '1' }] }), null);
  assert.equal(J.jamScripts({ tools: [{ id: 'rickroll', scripts: ['r.js'] }] }), null, 'no version');
  assert.equal(J.jamScripts({ tools: [] }), null);
  assert.equal(J.jamScripts(null), null);
});

test('the real tool list has a rickroll entry Jam can play', () => {
  const reg = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ops-tools.json'), 'utf8'));
  const j = J.jamScripts(reg);
  assert.ok(j && j.scripts.includes('rickroll-audio.js'));
});
