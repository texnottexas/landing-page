'use strict';
// Ops Center: pure rules (tool list, search, order, badges, gates, tile status, running tracker).
const test = require('node:test');
const assert = require('node:assert/strict');
const OC = require('../ops-core.js');

const tool = (o) => Object.assign({ id: 'x', title: 'X', icon: 'grid', gate: 'member', ready: ['game'], scripts: ['x-bookmarklet.js'], version: '2026-10-04', desc: 'Does x.', keywords: '' }, o);

test('validateTools keeps good tools and drops or defaults bad ones', () => {
  const r = OC.validateTools({
    schema: 1, codeSha256: 'ab'.repeat(32),
    tools: [
      tool({ id: 'ok' }),
      tool({ id: 'cdn', scripts: ['https://evil.example/x.js'] }),
      tool({ id: 'path', scripts: ['../x.js'] }),
      tool({ id: 'gate', gate: 'admin' }),
      tool({ id: 'ready', ready: ['game', 'moon'] }),
      tool({ id: 'icon', icon: 'rocket' }),
      tool({ id: 'ok' }),
      { id: 'bare' },
      null
    ]
  });
  assert.equal(r.codeSha256, 'ab'.repeat(32));
  assert.deepEqual(r.tools.map((t) => t.id), ['ok', 'icon']);
  assert.equal(r.tools[1].icon, 'grid', 'unknown icon falls back to grid');
  assert.deepEqual(OC.validateTools(null).tools, []);
  assert.equal(OC.validateTools({ tools: [], codeSha256: 'nope' }).codeSha256, null);
});

test('filterTools matches title, description and keywords, case-insensitively', () => {
  const list = [tool({ id: 'a', title: 'Troop Placement', keywords: 'base layout' }), tool({ id: 'b', title: 'Snapshot', desc: 'Copies your heroes.' })];
  assert.deepEqual(OC.filterTools(list, '').map((t) => t.id), ['a', 'b']);
  assert.deepEqual(OC.filterTools(list, '  ').map((t) => t.id), ['a', 'b']);
  assert.deepEqual(OC.filterTools(list, 'troop').map((t) => t.id), ['a']);
  assert.deepEqual(OC.filterTools(list, 'LAYOUT').map((t) => t.id), ['a']);
  assert.deepEqual(OC.filterTools(list, 'heroes').map((t) => t.id), ['b']);
  assert.deepEqual(OC.filterTools(list, 'zzz'), []);
});

test('orderTools puts recent tools first (newest first), then list order', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => tool({ id }));
  assert.deepEqual(OC.orderTools(list, ['c', 'a']).map((t) => t.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(OC.orderTools(list, ['gone', 'd']).map((t) => t.id), ['d', 'a', 'b', 'c']);
  assert.deepEqual(OC.orderTools(list, null).map((t) => t.id), ['a', 'b', 'c', 'd']);
});

test('pushRecent keeps the 3 newest distinct ids', () => {
  assert.deepEqual(OC.pushRecent([], 'a'), ['a']);
  assert.deepEqual(OC.pushRecent(['a', 'b', 'c'], 'd'), ['d', 'a', 'b']);
  assert.deepEqual(OC.pushRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(OC.pushRecent(null, 'a'), ['a']);
});

test('badges: none on first use, Updated on a new version, New for a newly listed tool', () => {
  const list = [tool({ id: 'a', version: '2' }), tool({ id: 'b', version: '1' })];
  const first = OC.initSeen({}, list);
  assert.deepEqual(first, { a: '2', b: '1' });
  assert.equal(OC.badgeFor(list[0], first), null);
  assert.equal(OC.badgeFor(tool({ id: 'a', version: '3' }), first), 'updated');
  assert.equal(OC.badgeFor(tool({ id: 'c', version: '1' }), first), 'new');
  assert.deepEqual(OC.initSeen({ a: '1' }, list), { a: '1' }, 'an existing map is left alone');
});

test('tileStatus: Locked blocks, unmet checks give Launch anyway, all met gives Launch', () => {
  const t = tool({ gate: 'code', ready: ['game', 'base'] });
  assert.deepEqual(OC.tileStatus(t, { member: true, unlocked: false, checks: { game: true, base: true } }), { state: 'locked', launch: null });
  assert.deepEqual(OC.tileStatus(t, { member: true, unlocked: true, checks: { game: true, base: false } }), { state: 'ready', launch: 'Launch' }, 'the tool takes you to your base itself');
  assert.deepEqual(OC.tileStatus(tool({ ready: ['game', 'defender'] }), { member: true, unlocked: true, checks: { game: true, defender: false } }), { state: 'notready', launch: 'Launch anyway' });
  assert.equal(OC.isAuto('base'), true);
  assert.equal(OC.isAuto('defender'), false);
  assert.deepEqual(OC.tileStatus(t, { member: true, unlocked: true, checks: { game: true, base: true } }), { state: 'ready', launch: 'Launch' });
  assert.deepEqual(OC.tileStatus(tool(), { member: false, unlocked: true, checks: { game: true } }), { state: 'blocked', launch: null });
  assert.deepEqual(OC.tileStatus(tool(), { member: true, unlocked: false, checks: {} }), { state: 'notready', launch: 'Launch anyway' }, 'a check that has not run counts as not met');
});

test('isToolNode: a new fixed, high layer that is not ours, or the declared overlay', () => {
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: false, position: 'fixed', zIndex: 2147483647 }), true);
  assert.equal(OC.isToolNode({ ops: true, matchesOverlay: false, position: 'fixed', zIndex: 2147483647 }), false);
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: false, position: 'fixed', zIndex: 5 }), false);
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: false, position: 'static', zIndex: 99999 }), false);
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: true, position: 'static', zIndex: 0 }), true);
});

test('tracker: launch, load, a tool screen, then back to idle 1 s after it closes', () => {
  let s = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  assert.equal(s.phase, 'loading');
  s = OC.trackerReduce(s, { type: 'loaded', at: 500 });
  assert.equal(s.phase, 'waiting');
  s = OC.trackerReduce(s, { type: 'nodeAdded', id: 1, at: 900 });
  assert.equal(s.phase, 'running');
  s = OC.trackerReduce(s, { type: 'nodeAdded', id: 2, at: 1000 });
  s = OC.trackerReduce(s, { type: 'nodeRemoved', id: 1, at: 5000 });
  assert.equal(s.phase, 'running', 'still one screen open');
  s = OC.trackerReduce(s, { type: 'nodeRemoved', id: 2, at: 6000 });
  s = OC.trackerReduce(s, { type: 'tick', at: 6500 });
  assert.equal(s.phase, 'running', 'grace period');
  s = OC.trackerReduce(s, { type: 'tick', at: 7001 });
  assert.equal(s.phase, 'idle');
});

test('tracker: a tool that swaps screens inside the grace period keeps running', () => {
  let s = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  s = OC.trackerReduce(s, { type: 'loaded', at: 100 });
  s = OC.trackerReduce(s, { type: 'nodeAdded', id: 'snap', at: 200 });
  s = OC.trackerReduce(s, { type: 'nodeRemoved', id: 'snap', at: 9000 });
  s = OC.trackerReduce(s, { type: 'nodeAdded', id: 'dismantle', at: 9400 });
  s = OC.trackerReduce(s, { type: 'tick', at: 10500 });
  assert.equal(s.phase, 'running');
  assert.deepEqual(s.nodes, ['dismantle']);
});

test('tracker: no screen within 10 s goes idle, but a late screen within 120 s still counts', () => {
  let s = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  s = OC.trackerReduce(s, { type: 'loaded', at: 300 });
  s = OC.trackerReduce(s, { type: 'tick', at: 10299 });
  assert.equal(s.phase, 'waiting');
  s = OC.trackerReduce(s, { type: 'tick', at: 10301 });
  assert.equal(s.phase, 'idle');
  assert.equal(OC.trackerWatching(s, 60000), true, 'still watching for a late screen');
  s = OC.trackerReduce(s, { type: 'nodeAdded', id: 'late', at: 60000 });
  assert.equal(s.phase, 'running', 'a password prompt held the tool up');
  assert.equal(OC.trackerWatching(OC.trackerReduce(OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 }), { type: 'loadError', at: 10 }), 20), false);
  let t = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  t = OC.trackerReduce(t, { type: 'loaded', at: 0 });
  t = OC.trackerReduce(t, { type: 'tick', at: 10001 });
  assert.equal(OC.trackerWatching(t, 120001), false, 'stops watching after 120 s');
  assert.equal(OC.trackerReduce(t, { type: 'nodeAdded', id: 'x', at: 130000 }).phase, 'idle');
});

test('tracker: a load error goes straight back to idle', () => {
  let s = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  s = OC.trackerReduce(s, { type: 'loadError', at: 50 });
  assert.equal(s.phase, 'idle');
  assert.equal(s.error, true);
});
