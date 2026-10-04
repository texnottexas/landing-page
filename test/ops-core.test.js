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
  const auto = OC.validateTools({ tools: [tool({ id: 'a1', ready: ['game', 'base'], auto: ['base', 'moon', 'defender'] }), tool({ id: 'a2' })] }).tools;
  assert.deepEqual(auto[0].auto, ['base'], 'auto keeps only items the tool also lists as ready');
  assert.deepEqual(auto[1].auto, []);
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
  const t = tool({ gate: 'code', ready: ['game', 'base'], auto: ['base'] });
  assert.deepEqual(OC.tileStatus(t, { member: true, unlocked: false, checks: { game: true, base: true } }), { state: 'locked', launch: null });
  assert.deepEqual(OC.tileStatus(t, { member: true, unlocked: true, checks: { game: true, base: false } }), { state: 'ready', launch: 'Launch' }, 'the tool takes you to your base itself');
  assert.deepEqual(OC.tileStatus(tool({ ready: ['game', 'defender'] }), { member: true, unlocked: true, checks: { game: true, defender: false } }), { state: 'notready', launch: 'Launch anyway' });
  assert.deepEqual(OC.tileStatus(tool({ ready: ['game', 'base'] }), { member: true, unlocked: true, checks: { game: true, base: false } }), { state: 'notready', launch: 'Launch anyway' }, 'only a tool that says so handles the base itself');
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

test('tracker: an explicit close abandons the late-screen watch', () => {
  let s = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  s = OC.trackerReduce(s, { type: 'loaded', at: 0 });
  s = OC.trackerReduce(s, { type: 'tick', at: 10001 });
  assert.equal(OC.trackerWatching(s, 20000), true);
  s = OC.trackerReduce(s, { type: 'abandon', at: 20000 });
  assert.equal(OC.trackerWatching(s, 20001), false);
  assert.equal(OC.trackerReduce(s, { type: 'nodeAdded', id: 'x', at: 30000 }).phase, 'idle');
  let r = OC.trackerReduce(OC.trackerInit(), { type: 'launch', at: 0 });
  r = OC.trackerReduce(r, { type: 'nodeAdded', id: 1, at: 10 });
  r = OC.trackerReduce(r, { type: 'loaded', at: 15 });
  assert.equal(OC.trackerReduce(r, { type: 'abandon', at: 20 }).phase, 'running', 'a tool that is really open is not abandoned');
});

test('saved data of the wrong shape is treated as empty instead of breaking the menu', () => {
  const list = ['a', 'b'].map((id) => tool({ id }));
  assert.deepEqual(OC.orderTools(list, 'alpha').map((t) => t.id), ['a', 'b'], 'a string instead of a list');
  assert.deepEqual(OC.orderTools(list, { 0: 'b' }).map((t) => t.id), ['a', 'b']);
  assert.deepEqual(OC.pushRecent('alpha', 'b'), ['b']);
  assert.deepEqual(OC.initSeen('oops', list), OC.initSeen({}, list));
  assert.deepEqual(OC.initSeen(['x'], list), OC.initSeen({}, list));
  assert.equal(OC.badgeFor(list[0], 'oops'), null);
});

test('tool ids that match built-in object keys behave like any other id', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'constructor' }), tool({ id: 'tostring' }), tool({ id: 'constructor' })] });
  assert.deepEqual(r.tools.map((t) => t.id), ['constructor', 'tostring'], 'kept once, duplicate dropped');
  assert.equal(OC.badgeFor(tool({ id: 'constructor', version: '1' }), { other: '1' }), 'new');
  assert.equal(OC.badgeFor(tool({ id: 'constructor', version: '1' }), {}), null);
  assert.deepEqual(OC.orderTools(r.tools, ['constructor']).map((t) => t.id), ['constructor', 'tostring']);
});

test('validateTools warns about every entry it drops and caps the list at 50', () => {
  const warned = [];
  const orig = console.warn; console.warn = (...a) => warned.push(a.join(' '));
  try {
    OC.validateTools({ tools: [tool({ id: 'ok' }), tool({ id: 'bad', gate: 'admin' }), { id: 'bare' }, null] });
    assert.equal(warned.length, 3);
    assert.ok(warned.every((w) => /Ops Center: skipped a tool/.test(w)));
    warned.length = 0;
    const many = Array.from({ length: 60 }, (_, i) => tool({ id: 't' + i }));
    const r = OC.validateTools({ tools: many });
    assert.equal(r.tools.length, 50);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /only the first 50/);
  } finally { console.warn = orig; }
});

test('owners: kept when valid 16-hex keys, dropped otherwise; visibleTools shows owner-only tools only to owners', () => {
  const r = OC.validateTools({ tools: [
    tool({ id: 'pub' }),
    tool({ id: 'mine', owners: ['d847a198622a518d', 'BAD', 42] }),
    tool({ id: 'empty', owners: [] }),
    tool({ id: 'junk', owners: 'd847a198622a518d' })
  ] }).tools;
  const by = Object.fromEntries(r.map((t) => [t.id, t]));
  assert.deepEqual(by.pub.owners, []);
  assert.deepEqual(by.mine.owners, ['d847a198622a518d']);
  assert.deepEqual(by.empty.owners, []);
  assert.deepEqual(by.junk.owners, []);
  // fail closed (review #2): an owners key that isn't a good list hides the tool from everyone
  assert.deepEqual(OC.visibleTools(r, 'd847a198622a518d').map((t) => t.id), ['pub', 'mine']);
  assert.deepEqual(OC.visibleTools(r, '03c2cd3196b2f243').map((t) => t.id), ['pub']);
  assert.deepEqual(OC.visibleTools(r, null).map((t) => t.id), ['pub']);
});

test('owners: an entry whose owners are all invalid is hidden from everyone, never shown to all', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'x1', owners: ['nope'] })] }).tools;
  assert.equal(r.length, 1);
  assert.equal(r[0].ownerOnly, true);
  assert.deepEqual(OC.visibleTools(r, 'd847a198622a518d'), []);
});

test('map is a known icon', () => {
  assert.equal(OC.validateTools({ tools: [tool({ id: 'm', icon: 'map' })] }).tools[0].icon, 'map');
});

test('REVIEW #2: owners fail closed — present but empty, a string, or all-invalid hides the tool from everyone', () => {
  const r = OC.validateTools({ tools: [
    tool({ id: 'pub' }),
    tool({ id: 'empty', owners: [] }),
    tool({ id: 'str', owners: 'd847a198622a518d' }),
    tool({ id: 'bad', owners: ['D847A198622A518D'] }),
    tool({ id: 'mine', owners: ['d847a198622a518d'] })
  ] }).tools;
  assert.deepEqual(OC.visibleTools(r, 'd847a198622a518d').map((t) => t.id), ['pub', 'mine']);
  assert.deepEqual(OC.visibleTools(r, '03c2cd3196b2f243').map((t) => t.id), ['pub']);
});
