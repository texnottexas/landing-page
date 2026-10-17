'use strict';
// Ops Center Feedback & requests (Tex 2026-10-17): what a submission sends. Run: node --test test/ops-feedback.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../ops-feedback.js');

test('a bug report goes to /feedback/bug with the tool, from the Ops Center, under the in-game name', () => {
  const p = F.payload({ type: 'bug', title: '  Card stuck ', details: ' It froze after Stop. ', tool: 'Mask Mystery Boxes', name: 'Pal' });
  assert.equal(p.path, '/feedback/bug');
  assert.deepEqual(p.body, { title: 'Card stuck', description: 'It froze after Stop.\n\nTool: Mask Mystery Boxes\nFrom: Ops Center', submitter: 'Pal', source: 'ops' });
});

test('a feature request goes to /feedback/feature; no tool picked = the Ops Center in general; no name = Anonymous', () => {
  const p = F.payload({ type: 'feature', title: 'Auto rally', details: 'Please.', tool: '', name: '' });
  assert.equal(p.path, '/feedback/feature');
  assert.equal(p.body.description, 'Please.\n\nTool: Ops Center (general)\nFrom: Ops Center');
  assert.equal(p.body.submitter, 'Anonymous');
});

test('empty title or details sends nothing; long text is cut so the tool line still fits the worker\'s 2000', () => {
  assert.equal(F.payload({ type: 'bug', title: ' ', details: 'x', name: 'Pal' }), null);
  assert.equal(F.payload({ type: 'bug', title: 'x', details: '  ', name: 'Pal' }), null);
  const p = F.payload({ type: 'bug', title: 't'.repeat(300), details: 'd'.repeat(3000), tool: 'Decor Optimizer', name: 'Pal' });
  assert.equal(p.body.title.length, 200);
  assert.ok(p.body.description.length <= 2000);
  assert.ok(p.body.description.endsWith('\n\nTool: Decor Optimizer\nFrom: Ops Center'));
});

test('a reserved name (the worker blocks it without a verified account) is spotted whatever its case', () => {
  assert.equal(F.reserved('Tex'), true);
  assert.equal(F.reserved(' tex '), true);
  assert.equal(F.reserved('Rеx'), false);
  assert.equal(F.reserved(''), false);
});
