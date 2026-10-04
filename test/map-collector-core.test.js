'use strict';
// Map Collector pure rules. Run: node --test test/map-collector-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../map-collector-core.js');

const N = (name, x, y, srv) => "<color=#f77a0b>" + name + "</c>'s Titan Gift Treasure Map appeared at server " + (srv || 2864) + ' (' + x + ', ' + y + ').';

test('parseNotice reads name, server and coordinates through color tags', () => {
  assert.deepEqual(M.parseNotice(N('HELLFIRE', 438, 690)), { spawner: 'HELLFIRE', server: 2864, x: 438, y: 690 });
  assert.equal(M.parseNotice(N('Mesi🥨🍺', 436, 664)).spawner, 'Mesi🥨🍺');
  assert.equal(M.parseNotice(N('Rеx', 1, 2)).spawner, 'Rеx');             // Cyrillic е kept as-is
  assert.equal(M.parseNotice(N("Tex's alt", 5, 6)).spawner, "Tex's alt");  // a name with 's
  assert.equal(M.parseNotice(N('<img src=x onerror=alert(1)>', 5, 6)).spawner, '');  // tags stripped; empty name allowed
  assert.equal(M.parseNotice("#2864's kom claimed iknowwho's Gift Treasure Map and received a rare reward Blessing Key*1"), null);
  assert.equal(M.parseNotice(null), null);
  assert.equal(M.parseNotice(N('A', 1, 2, 3051)).server, 3051);
});

test('newNotices: only unseen 523 rows newer than since; every unseen id is reported', () => {
  const rows = [
    { _msgId: 'a', _mt: '523', _time: 1000, _msg: N('Old', 1, 1) },
    { _msgId: 'b', _mt: '523', _time: 2000, _msg: N('New', 2, 2) },
    { _msgId: 'c', _mt: '', _time: 2001, _msg: 'hello' },
    { _msgId: 'd', _mt: '521', _time: 2002, _msg: 'claimed' },
    { _msgId: 'e', _mt: '523', _time: 2003, _msg: 'garbled' },
    { _mt: '523' }
  ];
  const r = M.newNotices(rows, {}, 1500 * 1000);
  assert.deepEqual(r.notices.map((n) => n.id), ['b']);
  assert.deepEqual(r.ids, ['a', 'b', 'c', 'd', 'e']);
  const r2 = M.newNotices(rows, { b: 1 }, 0);
  assert.deepEqual(r2.notices.map((n) => n.id), ['a']);
  assert.equal(r2.notices[0].noticedAt, 1000000);
  assert.ok(!r2.ids.includes('b'), 'seen ids are skipped');
});

test('newMap skips own maps and other servers', () => {
  const n = { id: '1', noticedAt: 5, spawner: 'Tex', server: 2864, x: 1, y: 2 };
  assert.equal(M.newMap(n, 'Tex', 2864).state, 'skipped');
  assert.equal(M.newMap(n, 'Tex', 2864).reason, 'your own map');
  assert.equal(M.newMap(Object.assign({}, n, { spawner: 'B', server: 1 }), 'Tex', 2864).reason, 'other server');
  const m = M.newMap(Object.assign({}, n, { spawner: 'B' }), 'Tex', 2864);
  assert.equal(m.state, 'queued');
  assert.equal(m.tooFast, 0);
  assert.equal(m.marchId, '');
});

test('pickNext: oldest queued map that is due; otherwise how long to wait', () => {
  const maps = [
    { id: 'a', state: 'sent' },
    { id: 'b', state: 'queued', retryAt: 5000 },
    { id: 'c', state: 'queued', retryAt: 0 },
    { id: 'd', state: 'queued' }
  ];
  assert.equal(M.pickNext(maps, 1000).map.id, 'c');
  assert.equal(M.pickNext(maps.slice(0, 2), 1000).wait, 4000);
  assert.equal(M.pickNext(maps.slice(0, 2), 6000).map.id, 'b');
  assert.deepEqual(M.pickNext([{ state: 'sent' }], 1), { map: null, wait: -1 });
});

test('classifyAnswer and applyAnswer cover every answer the game gives', () => {
  const sent = M.classifyAnswer({ s: 0, d: JSON.stringify({ marchInfo: { marchArrive: 1791134744, marchId: '48' } }) });
  assert.deepEqual(sent, { kind: 'sent', arriveAt: 1791134744000, startAt: 0, marchId: '48' });
  assert.deepEqual(M.classifyAnswer({ s: 0, d: 'not json' }), { kind: 'sent', arriveAt: 0, startAt: 0, marchId: '' });
  assert.equal(M.classifyAnswer({ s: 3, d: M.TOO_FAST }).kind, 'tooFast');
  assert.deepEqual(M.classifyAnswer({ s: 3, d: M.LOCATION_ERROR }), { kind: 'gone', reason: 'Location error' });
  assert.deepEqual(M.classifyAnswer({ s: 7, d: 'some_key' }), { kind: 'failed', reason: 'some_key' });
  assert.deepEqual(M.classifyAnswer({ s: 'timeout' }), { kind: 'failed', reason: 'No answer from the game' });
  assert.equal(M.classifyAnswer({ s: 'blocked' }).kind, 'blocked');

  const m = { state: 'sending', tooFast: 0, tries: 0 };
  M.applyAnswer(m, { kind: 'tooFast' }, 1000);
  assert.equal(m.state, 'queued'); assert.equal(m.retryAt, 11000); assert.equal(m.tooFast, 1);
  M.applyAnswer(m, { kind: 'tooFast' }, 1000); M.applyAnswer(m, { kind: 'tooFast' }, 1000);
  assert.equal(m.state, 'queued');
  M.applyAnswer(m, { kind: 'tooFast' }, 1000);
  assert.equal(m.state, 'failed'); assert.equal(m.reason, 'Too fast, gave up after 3 tries');

  const b = { state: 'sending', tooFast: 0, tries: 0 };
  M.applyAnswer(b, { kind: 'blocked' }, 0); M.applyAnswer(b, { kind: 'blocked' }, 0); M.applyAnswer(b, { kind: 'blocked' }, 0);
  assert.equal(b.state, 'queued'); assert.equal(b.retryAt, 1500);
  M.applyAnswer(b, { kind: 'blocked' }, 0);
  assert.equal(b.state, 'failed');

  const s = { state: 'sending', sentAt: 10 };
  M.applyAnswer(s, sent, 20);
  assert.equal(s.state, 'sent'); assert.equal(s.arriveAt, 1791134744000); assert.equal(s.marchId, '48');
  const g = { state: 'sending' }; M.applyAnswer(g, { kind: 'gone', reason: 'Location error' }, 0);
  assert.equal(g.state, 'gone'); assert.equal(g.reason, 'Location error');
});

test('matchReward: closest arrival within 6 s, tie to the earlier send, late reward upgrades missed', () => {
  const maps = [
    { id: 'a', state: 'sent', sentAt: 1, arriveAt: 10000 },
    { id: 'b', state: 'sent', sentAt: 2, arriveAt: 10000 },
    { id: 'c', state: 'missed', sentAt: 3, arriveAt: 30000 },
    { id: 'd', state: 'collected', sentAt: 4, arriveAt: 10000 }
  ];
  assert.equal(M.matchReward(maps, 10500, 'Blessing Key ×1').id, 'a');
  assert.equal(maps[0].state, 'collected'); assert.equal(maps[0].reward, 'Blessing Key ×1'); assert.equal(maps[0].collectedAt, 10500);
  assert.equal(M.matchReward(maps, 9000, 'x').id, 'b');
  assert.equal(M.matchReward(maps, 31000, 'y').id, 'c');
  assert.equal(M.matchReward(maps, 99999, 'z'), null);
});

test('matchReward: a sped-up march (reward well before its arrival) matches the earliest en-route march', () => {
  const maps = [
    { id: 'farther', state: 'sent', sentAt: 2, arriveAt: 420000 },
    { id: 'far', state: 'sent', sentAt: 1, arriveAt: 400000 }
  ];
  assert.equal(M.matchReward(maps, 60000, 'k').id, 'far');
});

test('syncMarches: live list moves arrivals and ends marches; unreadable list changes nothing', () => {
  const maps = [
    { id: 'a', state: 'sent', marchId: 'm1', arriveAt: 400000 },
    { id: 'b', state: 'sent', marchId: 'm2', arriveAt: 50000 },
    { id: 'c', state: 'sent', marchId: 'm3', arriveAt: 60000 },
    { id: 'd', state: 'collected', marchId: 'm4', arriveAt: 1 }
  ];
  // m1 sped up, m2 still marching, m3 never listed (not yet known to the game)
  let ch = M.syncMarches(maps, { m1: { arriveAt: 70000 }, m2: { arriveAt: 50000 } }, 1000);
  assert.deepEqual(ch.map((m) => m.id), ['a']);
  assert.equal(maps[0].arriveAt, 70000);
  assert.equal(maps[0].seenLive, true);
  // m2 disappears without a reward: ended now, missed 5 s later
  ch = M.syncMarches(maps, { m1: { arriveAt: 70000 } }, 2000);
  assert.deepEqual(ch, []);
  assert.equal(maps[1].endedAt, 2000);
  assert.equal(M.syncMarches(maps, { m1: { arriveAt: 70000 } }, 7000).length, 0);
  ch = M.syncMarches(maps, { m1: { arriveAt: 70000 } }, 7001);
  assert.deepEqual(ch.map((m) => m.id), ['b']);
  assert.equal(maps[1].state, 'missed');
  // never seen live and absent: left to the arrival sweep
  assert.equal(maps[2].state, 'sent');
  // an unreadable list (null) is a no-op
  assert.deepEqual(M.syncMarches(maps, null, 999999), []);
  assert.equal(maps[0].state, 'sent');
});

test('sweepMissed: 15 s after arrival, or 60 s after sending when the arrival is unknown', () => {
  const maps = [
    { id: 'a', state: 'sent', sentAt: 0, arriveAt: 10000 },
    { id: 'b', state: 'sent', sentAt: 0, arriveAt: 0 },
    { id: 'c', state: 'collected', arriveAt: 1 }
  ];
  assert.deepEqual(M.sweepMissed(maps, 25000).map((m) => m.id), []);
  assert.deepEqual(M.sweepMissed(maps, 25001).map((m) => m.id), ['a']);
  assert.deepEqual(M.sweepMissed(maps, 60001).map((m) => m.id), ['b']);
  assert.equal(maps[0].state, 'missed');
});

test('buildReport sends changed rows oldest first, capped at 50, and ackReport advances', () => {
  const st = { rev: 0, acked: 0 };
  const maps = [];
  const T0 = 1791134744000;
  for (let i = 0; i < 55; i++) { const m = { id: String(i), noticedAt: T0 + i, spawner: 'S', x: 1, y: 2, state: 'queued' }; M.touch(st, m); maps.push(m); }
  const r1 = M.buildReport(maps, st.acked, M.REPORT_MAX);
  assert.equal(r1.rows.length, 50); assert.equal(r1.rows[0].id, '0'); assert.equal(r1.upto, 50);
  assert.deepEqual(Object.keys(r1.rows[0]).sort(), ['arriveAt', 'collectedAt', 'gems', 'id', 'noticedAt', 'reason', 'reward', 'rewardItems', 'sentAt', 'spawner', 'speedups', 'state', 'tries', 'x', 'y']);
  M.ackReport(st, r1.upto);
  const r2 = M.buildReport(maps, st.acked, M.REPORT_MAX);
  assert.deepEqual(r2.rows.map((r) => r.id), ['50', '51', '52', '53', '54']);
  M.touch(st, maps[0]);
  assert.deepEqual(M.buildReport(maps, st.acked, M.REPORT_MAX).rows.map((r) => r.id), ['50', '51', '52', '53', '54', '0']);
  M.ackReport(st, 3);
  assert.equal(st.acked, 50, 'an old ack never moves backwards');
});

test('summarize, healthOf and pillCard', () => {
  const st = (s) => ({ state: s });
  const sum = M.summarize([st('collected'), st('collected'), st('missed'), st('sent'), st('sending'), st('gone'), st('failed'), st('skipped'), st('queued')]);
  assert.deepEqual(sum, { total: 9, collected: 2, missed: 1, enRoute: 2, notSent: 2, skipped: 1, queued: 1, speedups: 0 });
  assert.equal(M.healthOf({ connected: true, visible: true, failing: false }), 'ok');
  assert.equal(M.healthOf({ connected: false, visible: true }), 'disconnected');
  assert.equal(M.healthOf({ connected: true, visible: false }), 'hidden');
  assert.equal(M.healthOf({ connected: true, visible: true, failing: true }), 'failing');
  const ok = M.pillCard(sum, 477, 8, 'ok');
  assert.deepEqual(ok.rows, [['Collected', 2], ['Missed', 1], ['En route', 2], ['Claims left', 477], ['Speed-ups', 'Off']]);
  assert.equal(ok.foot, 'Reported 8 s ago'); assert.equal(ok.tone, 'ok');
  assert.equal(M.pillCard(sum, 477, 75, 'ok').foot, 'Reported 1 min ago');
  assert.equal(M.pillCard(sum, 477, null, 'ok').foot, 'Starting...');
  assert.deepEqual(M.pillCard(sum, 477, 3, 'hidden'), Object.assign({}, ok, { foot: 'Tab hidden', tone: 'warn' }));
  assert.deepEqual(M.pillCard(sum, 477, 3, 'failing'), Object.assign({}, ok, { foot: 'Dashboard not reachable', tone: 'warn' }));
  assert.deepEqual(M.pillCard(sum, 477, 3, 'disconnected'), Object.assign({}, ok, { foot: 'Game disconnected', tone: 'bad' }));
  assert.equal(M.pillCard(sum, null, 3, 'ok').rows[3][1], '?');
  assert.ok(!/—/.test(JSON.stringify([ok, M.pillCard(sum, 1, 1, 'hidden'), M.pillCard(sum, 1, 1, 'failing'), M.pillCard(sum, 1, 1, 'disconnected')])));
});

test('prune keeps unacked rows and the last 24 h, at most 600', () => {
  const now = 100 * 3600e3;
  const maps = [
    { id: 'old', noticedAt: now - 25 * 3600e3, rev: 1 },
    { id: 'oldUnacked', noticedAt: now - 25 * 3600e3, rev: 9 },
    { id: 'new', noticedAt: now - 3600e3, rev: 2 }
  ];
  assert.deepEqual(M.prune(maps, now, 5).map((m) => m.id), ['oldUnacked', 'new']);
  const many = Array.from({ length: 700 }, (_, i) => ({ id: String(i), noticedAt: now, rev: 1 }));
  assert.equal(M.prune(many, now, 5).length, 600);
  assert.equal(M.prune(many, now, 5)[0].id, '100');
});

test('admit: one map per notice id, no repeat of the same coordinates within 60 s, first claim waits 1.5-3.5 s', () => {
  const maps = [];
  const n = (id, x, y, at) => ({ id, noticedAt: at, spawner: 'A', server: 2864, x, y });
  const fixed = () => 2000;
  let added = M.admit(maps, [n('1', 10, 10, 1000), n('2', 11, 11, 1000)], 'Tex', 2864, 5000, fixed);
  assert.deepEqual(added.map((m) => m.id), ['1', '2']);
  assert.equal(maps[0].retryAt, 7000, 'first claim no sooner than 1.5 s after the notice is seen');
  added = M.admit(maps, [n('1', 10, 10, 1000)], 'Tex', 2864, 6000, fixed);
  assert.deepEqual(added, [], 'the same notice id is never queued twice');
  added = M.admit(maps, [n('3', 10, 10, 50000)], 'Tex', 2864, 51000, fixed);
  assert.deepEqual(added, [], 'a second notice at the same spot within 60 s is a duplicate');
  added = M.admit(maps, [n('4', 10, 10, 70000)], 'Tex', 2864, 71000, fixed);
  assert.deepEqual(added.map((m) => m.id), ['4'], 'a new map at the same spot later is real');
  assert.equal(maps.length, 3);
  const r = M.admit([], [n('9', 1, 1, 0)], 'Tex', 2864, 0);
  assert.ok(r[0].retryAt >= 1500 && r[0].retryAt <= 3500, 'default delay is 1.5-3.5 s');
});

test('gate: at most 12 claims a minute and 40 per 10 minutes, and 5 failures in a row pause claiming', () => {
  const sends = (times, kind) => times.map((t) => ({ t, kind: kind || 'sent' }));
  assert.deepEqual(M.gate([], 0), { ok: true });
  const eleven = sends(Array.from({ length: 11 }, (_, i) => i * 1000));
  assert.deepEqual(M.gate(eleven, 11000), { ok: true });
  const twelve = sends(Array.from({ length: 12 }, (_, i) => i * 1000));
  assert.deepEqual(M.gate(twelve, 12000), { ok: false, until: 60000, reason: 'too many claims in a minute' });
  assert.deepEqual(M.gate(twelve, 60001), { ok: true });
  const forty = sends(Array.from({ length: 40 }, (_, i) => i * 6000));
  assert.deepEqual(M.gate(forty, 240000), { ok: false, until: 600000, reason: 'too many claims in 10 minutes' });
  const fails = sends([0, 2000, 4000, 6000, 8000], 'gone');
  assert.deepEqual(M.gate(fails, 9000), { ok: false, until: 308000, reason: 'five claims in a row failed' });
  assert.deepEqual(M.gate(fails.concat(sends([9000])), 10000), { ok: true }, 'a success resets the streak');
  assert.deepEqual(M.gate(fails, 308001), { ok: true });
});

test('admit: maps from one batch share one first delay, so they are claimed in notice order', () => {
  const maps = [];
  let calls = 0;
  const delays = () => { calls++; return calls === 1 ? 3400 : 1600; };
  const n = (id, x) => ({ id, noticedAt: 0, spawner: 'A', server: 2864, x, y: 1 });
  M.admit(maps, [n('a', 1), n('b', 2), n('c', 3)], 'Tex', 2864, 1000, delays);
  assert.deepEqual(maps.map((m) => m.retryAt), [4400, 4400, 4400]);
  assert.equal(M.pickNext(maps, 4400).map.id, 'a');
});

test('matchReward keeps the reward item ids for the dashboard icons', () => {
  const maps = [{ id: 'a', state: 'sent', sentAt: 1, arriveAt: 10000 }];
  M.matchReward(maps, 10000, 'Blessing Key ×1, Titan Gear Random Material Chest ×2', '79200004x1,62908x2');
  assert.equal(maps[0].rewardItems, '79200004x1,62908x2');
  assert.equal(M.toRow(maps[0]).rewardItems, '79200004x1,62908x2');
  const b = [{ id: 'b', state: 'sent', sentAt: 1, arriveAt: 10000 }];
  M.matchReward(b, 10000, 'x');
  assert.equal(M.toRow(b[0]).rewardItems, '');
});

test('rewardItemsOf turns the game reward into the compact id list (max 10, bad entries skipped)', () => {
  assert.equal(M.rewardItemsOf([{ itemId: 79200004, itemCount: 1 }, { itemId: 62908, itemCount: 2 }]), '79200004x1,62908x2');
  assert.equal(M.rewardItemsOf([{ itemId: 'x', itemCount: 1 }, { itemId: 5, itemCount: 0 }, null]), '');
  assert.equal(M.rewardItemsOf(Array.from({ length: 12 }, (_, i) => ({ itemId: i + 1, itemCount: 1 }))).split(',').length, 10);
  assert.equal(M.rewardItemsOf(undefined), '');
});

test('REVIEW #4: a notice without a usable time is never claimed', () => {
  const r = M.newNotices([{ _msgId: 'x1', _mt: '523', _msg: N('A', 1, 1) }, { _msgId: 'x2', _mt: '523', _time: 'soon', _msg: N('B', 2, 2) }], {}, 0);
  assert.deepEqual(r.notices, []);
  assert.deepEqual(r.ids, ['x1', 'x2'], 'both are still marked seen');
});

test('REVIEW #4: rows the worker would reject are dropped from the report but acked, so they can never block it', () => {
  const st = { rev: 0, acked: 0 };
  const good = { id: 'g1', noticedAt: 1791134744000, spawner: 'A', x: 10, y: 20, state: 'collected' };
  const badX = { id: 'b1', noticedAt: 1791134744000, spawner: 'A', x: 5000, y: 20, state: 'collected' };
  const badT = { id: 'b2', noticedAt: NaN, spawner: 'A', x: 1, y: 1, state: 'collected' };
  const badId = { id: '../x', noticedAt: 1791134744000, spawner: 'A', x: 1, y: 1, state: 'collected' };
  [good, badX, badT, badId].forEach((m) => M.touch(st, m));
  const r = M.buildReport([good, badX, badT, badId], 0, M.REPORT_MAX);
  assert.deepEqual(r.rows.map((x) => x.id), ['g1']);
  assert.equal(r.upto, 4, 'the bad rows are acked with the good one');
  assert.equal(M.REPORT_MAX, 50, 'at most 50 rows per report');
});

test('speedPlan: 2 over 30 s, 1 over 20 s, 1 over 15 s only from noon to 2 PM ET (DST-safe)', () => {
  const edtNoon30 = Date.UTC(2026, 9, 4, 16, 30), edtTwo30 = Date.UTC(2026, 9, 4, 18, 30), estNoon30 = Date.UTC(2026, 10, 2, 17, 30), est1130 = Date.UTC(2026, 10, 2, 16, 30);
  assert.equal(M.speedPlan(31, edtTwo30), 2); assert.equal(M.speedPlan(30, edtTwo30), 1); assert.equal(M.speedPlan(21, edtTwo30), 1);
  assert.equal(M.speedPlan(20, edtTwo30), 0); assert.equal(M.speedPlan(16, edtTwo30), 0); assert.equal(M.speedPlan(16, edtNoon30), 1);
  assert.equal(M.speedPlan(15, edtNoon30), 0); assert.equal(M.speedPlan(16, estNoon30), 1); assert.equal(M.speedPlan(16, est1130), 0);
  assert.equal(M.speedPlan(NaN, edtNoon30), 0); assert.equal(M.speedPlan(-4, edtNoon30), 0);
  assert.equal(M.inBoostWindow(Date.UTC(2026, 9, 4, 17, 59)), true); assert.equal(M.inBoostWindow(Date.UTC(2026, 9, 4, 18, 0)), false);
});
test('gameDay: the noon-ET day a moment belongs to', () => {
  assert.equal(M.gameDay(Date.UTC(2026, 9, 4, 15, 59)), '2026-10-03');
  assert.equal(M.gameDay(Date.UTC(2026, 9, 4, 16, 0)), '2026-10-04');
  assert.equal(M.gameDay(Date.UTC(2026, 9, 5, 3, 0)), '2026-10-04');
  assert.equal(M.gameDay(Date.UTC(2026, 10, 1, 0, 0)), '2026-10-31');   // month boundary
});
test('buyCheck: bag first, then each buy rule with its reason; exact boundaries allowed', () => {
  const base = { bag: 0, gems: 10037, price: 37, vip: 15, needVip: 2, reserve: 10000, spent: 1463, cap: 1500 };
  assert.deepEqual(M.buyCheck({ ...base, bag: 2, gems: 0 }), { ok: true, source: 'bag' });
  assert.deepEqual(M.buyCheck(base), { ok: true, source: 'buy' });                       // gems-price == reserve, spent+price == cap
  assert.deepEqual(M.buyCheck({ ...base, gems: 10036 }), { ok: false, reason: 'gem reserve reached' });
  assert.deepEqual(M.buyCheck({ ...base, spent: 1464 }), { ok: false, reason: 'daily gem cap reached' });
  assert.deepEqual(M.buyCheck({ ...base, vip: 1 }), { ok: false, reason: 'VIP too low to buy' });
  assert.deepEqual(M.buyCheck({ ...base, price: 0 }), { ok: false, reason: 'no shop price' });
  assert.deepEqual(M.buyCheck({ ...base, gems: null }), { ok: false, reason: 'gem reserve reached' });
});
test('planSpeed, pickSpeed and applySpeed: earliest claimed first, skips under 5 s or past arrival, halves the time left', () => {
  const now = Date.UTC(2026, 9, 4, 20, 0);
  const a = { id: 'a', state: 'sent', marchId: 'm1', sentAt: now - 3000, startAt: now - 3000, arriveAt: now + 37000, speedDone: 0 };
  const b = { id: 'b', state: 'sent', marchId: 'm2', sentAt: now - 4000, startAt: now - 4000, arriveAt: now + 21000, speedDone: 0 };
  const c = { id: 'c', state: 'sent', marchId: 'm3', sentAt: now - 9000, startAt: now - 30000, arriveAt: now + 4000, speedDone: 0 };
  assert.equal(M.planSpeed(a, true, now), 2); assert.equal(M.planSpeed(b, true, now), 1); assert.equal(M.planSpeed(c, true, now), 2);
  assert.equal(M.planSpeed({ ...a }, false, now), 0);
  const p = M.pickSpeed([a, b, c], now);
  assert.equal(p.map.id, 'b');                               // b was claimed before a
  assert.deepEqual(p.skipped.map((m) => m.id), ['c']);       // 4 s left
  assert.equal(c.speedWant, 0);
  M.applySpeed(b, now, true, 37);
  assert.equal(b.speedDone, 1); assert.equal(b.speedBought, 1); assert.equal(b.gems, 37); assert.equal(b.arriveAt, now + 10500);
  assert.equal(M.pickSpeed([a, b], now).map.id, 'a');        // b has its one
  M.applySpeed(a, now, false, 37);
  assert.equal(a.gems || 0, 0); assert.equal(a.arriveAt, now + 18500);
  const restored = { id: 'r', state: 'sent', marchId: 'm9', sentAt: now - 900000, arriveAt: now - 800000, speedWant: 2, speedDone: 0 };
  assert.equal(M.pickSpeed([restored], now).map, null);
});
test('classifyAnswer keeps the march start; toRow, summarize and pillCard carry speed-ups', () => {
  const c = M.classifyAnswer({ s: 0, d: JSON.stringify({ marchInfo: { marchId: '4870912922023780420', marchStartTime: 1791154634, marchArrive: 1791154653 } }) });
  assert.deepEqual(c, { kind: 'sent', arriveAt: 1791154653000, startAt: 1791154634000, marchId: '4870912922023780420' });
  const m = M.newMap({ id: '1', noticedAt: 1.79e12, spawner: 'A', server: 2864, x: 1, y: 1 }, 'Me', 2864);
  M.applyAnswer(m, c, 0);
  assert.equal(m.startAt, 1791154634000);
  m.speedDone = 2; m.gems = 37;
  assert.equal(M.toRow(m).speedups, 2); assert.equal(M.toRow(m).gems, 37);
  const s = M.summarize([m]);
  assert.equal(s.speedups, 2);
  assert.deepEqual(M.pillCard(s, 10, 5, 'ok', { on: true }).rows[4], ['Speed-ups', 'On · 2']);
  assert.deepEqual(M.pillCard(s, 10, 5, 'ok', { on: false }).rows[4], ['Speed-ups', 'Off']);
});
test('autoReconnect: 65 minutes after going down, then 65 minutes after each attempt', () => {
  const t = 1.79e12;
  assert.deepEqual(M.autoReconnect(0, 0, t), { due: false, at: 0 });
  assert.deepEqual(M.autoReconnect(t, 0, t + 3899999), { due: false, at: t + 3900000 });
  assert.deepEqual(M.autoReconnect(t, 0, t + 3900000), { due: true, at: t + 3900000 });
  assert.deepEqual(M.autoReconnect(t, t + 3900000, t + 3900000 + 60000), { due: false, at: t + 7800000 });
  assert.deepEqual(M.autoReconnect(t, 0, t + 3000, 3000), { due: true, at: t + 3000 });
});
