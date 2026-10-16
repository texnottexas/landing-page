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

test('gift is a known icon', () => {
  assert.equal(OC.validateTools({ tools: [tool({ id: 'g', icon: 'gift' })] }).tools[0].icon, 'gift');
});

test('gem is a known icon', () => {
  assert.equal(OC.validateTools({ tools: [tool({ id: 'v', icon: 'gem' })] }).tools[0].icon, 'gem');
});

test('smile is a known icon', () => {
  assert.equal(OC.validateTools({ tools: [tool({ id: 's', icon: 'smile' })] }).tools[0].icon, 'smile');
});

test('event: kept as positive whole activity types, anything else dropped; the tool stays', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'e1', event: [279] }), tool({ id: 'e2', event: [292, 'x', -1, 2.5, 0, 26] }), tool({ id: 'e3', event: 'nope' }), tool({ id: 'e4' })] }).tools;
  assert.deepEqual(r.map((t) => [t.id, t.event]), [['e1', [279]], ['e2', [292, 26]], ['e3', []], ['e4', []]]);
});

test('eventLive: any activity of the tool\'s types between its begin and end; no types means always', () => {
  const s = 1792000000, acts = [{ type: 292, begintime: s - 10, endtime: s + 10 }, { type: 279, begintime: s + 100, endtime: s + 200 }, null];
  assert.equal(OC.eventLive([292], acts, s), true);
  assert.equal(OC.eventLive([279], acts, s), false, 'not begun');
  assert.equal(OC.eventLive([279], acts, s + 200), false, 'ended');
  assert.equal(OC.eventLive([26], acts, s), false);
  assert.equal(OC.eventLive([26, 292], acts, s), true);
  assert.equal(OC.eventLive([], acts, s), true);
  assert.equal(OC.eventLive([279], [{ type: 279, endtime: s + 5 }], s), true, 'no begintime counts as begun');
  assert.equal(OC.eventLive([279], null, s), false);
});

test('tileStatus: a member\'s tool whose event is off shows Not running and Launch anyway; blocked and locked still win', () => {
  assert.deepEqual(OC.tileStatus(tool(), { member: true, unlocked: true, checks: { game: true }, eventOff: true }), { state: 'off', launch: 'Launch anyway' });
  assert.deepEqual(OC.tileStatus(tool(), { member: false, unlocked: true, checks: { game: true }, eventOff: true }), { state: 'blocked', launch: null });
  assert.deepEqual(OC.tileStatus(tool({ gate: 'code' }), { member: true, unlocked: false, checks: { game: true }, eventOff: true }), { state: 'locked', launch: null });
  assert.deepEqual(OC.EVENT_TEXT, ['The event is running', "The event isn't running now"]);
});

test('tucked: kept only as true; a tucked tool always sits under "Not running now" (Tex 2026-10-14)', () => {
  const r = OC.validateTools({ tools: [tool({ id: 't1', tucked: true }), tool({ id: 't2', tucked: 'yes' }), tool({ id: 't3' })] }).tools;
  assert.deepEqual(r.map((t) => [t.id, t.tucked]), [['t1', true], ['t2', false], ['t3', false]]);
});

test('alongside (Tex 2026-10-14): kept only as true; its screen is never the running tool\'s; its tile says Playing while it is on', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'a1', alongside: true }), tool({ id: 'a2', alongside: 1 }), tool({ id: 'a3' })] }).tools;
  assert.deepEqual(r.map((t) => [t.id, t.alongside]), [['a1', true], ['a2', false], ['a3', false]]);
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: false, position: 'fixed', zIndex: 2147483000, alongside: true }), false);
  assert.equal(OC.isToolNode({ ops: false, matchesOverlay: false, position: 'fixed', zIndex: 2147483000 }), true);
  assert.deepEqual(OC.tileStatus(tool(), { member: true, unlocked: true, checks: { game: true }, alongsideOn: true }), { state: 'playing', launch: 'Launch' });
  assert.deepEqual(OC.tileStatus(tool(), { member: false, unlocked: true, checks: { game: true }, alongsideOn: true }), { state: 'blocked', launch: null });
});

// Tex 2026-10-14: the Map Collector tile shows only to players its registry holds. The list names which registry
// ("registered": "mapcollector"); the Ops Center asks the worker and passes the answers to visibleTools.
test('registered: kept only for a known registry; anything else hides the tool from everyone (fail closed)', () => {
  const r = OC.validateTools({ tools: [
    tool({ id: 'pub' }),
    tool({ id: 'mapc', registered: 'mapcollector' }),
    tool({ id: 'other', registered: 'elsewhere' }),
    tool({ id: 'path', registered: '../admin' }),
    tool({ id: 'yes', registered: true })
  ] }).tools;
  const by = Object.fromEntries(r.map((t) => [t.id, t]));
  assert.equal(by.pub.registered, null);
  assert.equal(by.mapc.registered, 'mapcollector');
  assert.equal(by.other.registered, '');
  assert.equal(by.path.registered, '');
  assert.equal(by.yes.registered, '');
  assert.deepEqual(OC.REGISTRIES, ['mapcollector']);
  const sk = 'd847a198622a518d';
  assert.deepEqual(OC.visibleTools(r, sk).map((t) => t.id), ['pub'], 'no answers yet: hidden');
  assert.deepEqual(OC.visibleTools(r, sk, {}).map((t) => t.id), ['pub']);
  assert.deepEqual(OC.visibleTools(r, sk, { mapcollector: false }).map((t) => t.id), ['pub']);
  assert.deepEqual(OC.visibleTools(r, sk, { mapcollector: 'yes' }).map((t) => t.id), ['pub'], 'only a real true counts');
  assert.deepEqual(OC.visibleTools(r, sk, { mapcollector: true }).map((t) => t.id), ['pub', 'mapc']);
  assert.deepEqual(OC.visibleTools(r, null, { mapcollector: true }).map((t) => t.id), ['pub'], 'no siteKey: hidden');
  assert.deepEqual(OC.visibleTools(r, sk, { mapcollector: true, '': true, elsewhere: true }).map((t) => t.id), ['pub', 'mapc'], 'a bad registry never shows');
});

test('registered and owners together: both must allow the tool', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'both', registered: 'mapcollector', owners: ['d847a198622a518d'] })] }).tools;
  assert.deepEqual(OC.visibleTools(r, 'd847a198622a518d', { mapcollector: true }).map((t) => t.id), ['both']);
  assert.deepEqual(OC.visibleTools(r, '03c2cd3196b2f243', { mapcollector: true }), []);
  assert.deepEqual(OC.visibleTools(r, 'd847a198622a518d', {}), []);
});

// Tex 2026-10-16: Mask Boxes, Enigma Veins, HT Gift Boxes and Angel Attacks run together, started from the Ops Center.
test('together: kept only as true', () => {
  const r = OC.validateTools({ tools: [tool({ id: 'a', together: true }), tool({ id: 'b', together: 'yes' }), tool({ id: 'c' })] }).tools;
  assert.deepEqual(r.map((t) => t.together), [true, false, false]);
});

test('a group session: group tools say Running when their card is up, else their usual status; others Wait; Rickroll is unchanged', () => {
  const [g, other, rr] = OC.validateTools({ tools: [tool({ id: 'g', together: true }), tool({ id: 'o' }), tool({ id: 'rr', alongside: true })] }).tools;
  const ck = { game: true };
  const base = { member: true, unlocked: false, checks: ck, eventOff: false, alongsideOn: false };
  assert.deepEqual(OC.tileStatus(g, Object.assign({}, base, { group: true, groupOn: true })), { state: 'running', launch: null });
  assert.deepEqual(OC.tileStatus(g, Object.assign({}, base, { group: true, groupOn: false })), { state: 'ready', launch: 'Launch' });
  assert.deepEqual(OC.tileStatus(g, Object.assign({}, base, { group: true, groupOn: false, eventOff: true })), { state: 'off', launch: 'Launch anyway' });
  assert.deepEqual(OC.tileStatus(other, Object.assign({}, base, { group: true })), { state: 'wait', launch: null });
  assert.deepEqual(OC.tileStatus(rr, Object.assign({}, base, { group: true })), { state: 'ready', launch: 'Launch' });
  assert.deepEqual(OC.tileStatus(other, Object.assign({}, base, { group: false })), { state: 'ready', launch: 'Launch' }, 'no session: as before');
  assert.deepEqual(OC.tileStatus(other, Object.assign({}, base, { member: false, group: true })), { state: 'blocked', launch: null }, 'members only still first');
});

test('ore is a known icon (Odinium Gatherer)', () => {
  assert.equal(OC.validateTools({ tools: [tool({ id: 'o', icon: 'ore' })] }).tools[0].icon, 'ore');
});
