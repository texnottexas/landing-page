'use strict';
// Looter Locator rules (Tex, 2026-10-16): the map pass, looter points, the cross-in list, Loot Quest windows,
// tracking, the 5-minute world chat rule, the share card, the request caps.
// Run: node --test test/looter-locator-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../looter-locator-core.js');

const NOW = 1792207452000;

test('the pass: 84 zoom-level-1 windows (120 x 80), serpentine, covering x 0-839 and y 0-959', () => {
  const c = L.passCells();
  assert.equal(c.length, 84);
  assert.deepEqual(c.slice(0, 3), [{ x: 60, y: 40 }, { x: 180, y: 40 }, { x: 300, y: 40 }]);
  assert.deepEqual(c[6], { x: 780, y: 40 });
  assert.deepEqual(c[7], { x: 780, y: 120 }, 'the second row runs back');
  assert.deepEqual(c[83], { x: 60, y: 920 });
  for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i].x - c[i - 1].x) + Math.abs(c[i].y - c[i - 1].y) <= 120, 'each step is next door');
  // every tile of the map is in some window (spot-check the corners and the looter seen at 659, 929)
  for (const [x, y] of [[0, 0], [839, 0], [0, 959], [839, 959], [659, 929], [480, 804]]) assert.ok(c.some((w) => L.inWindow(w.x, w.y, x, y)), x + ',' + y);
});

test('a window is x-60..x+59 and y-40..y+39 (measured live)', () => {
  assert.equal(L.inWindow(400, 450, 340, 410), true);
  assert.equal(L.inWindow(400, 450, 459, 489), true);
  assert.equal(L.inWindow(400, 450, 460, 450), false);
  assert.equal(L.inWindow(400, 450, 400, 490), false);
});

test('the ring around a lost looter: up to 8 windows next to the old spot, kept on the map', () => {
  const r = L.ringCells(480, 804);
  assert.equal(r.length, 8);
  assert.ok(r.every((w) => !(w.x === 480 && w.y === 804)), 'the old spot itself is the 30-second check, not the ring');
  assert.ok(r.some((w) => L.inWindow(w.x, w.y, 600, 804)) && r.some((w) => L.inWindow(w.x, w.y, 480, 724)));
  const corner = L.ringCells(10, 10);
  assert.ok(corner.length >= 3 && corner.every((w) => w.x >= 60 && w.y >= 40), 'no window off the map');
  assert.equal(new Set(corner.map((w) => w.x + ',' + w.y)).size, corner.length, 'no repeats');
});

test('looter points from a map answer: type 133 only, with server, march id, invisible until, attacking', () => {
  const d = { pointList: [
    { x: 480, y: 804, k: 2864, pointType: 133, m: { hideEndTime: NOW + 42000, attack: 1, fSid: 4419, viewState: 1, marchSize: 1, marchId: '4888553843884983816', spId: 1 } },
    { x: 659, y: 929, k: 2864, pointType: 133, m: { hideEndTime: 0, attack: 0, fSid: 2937, viewState: 2, marchId: '4888562190968615425', spId: 1 } },
    { x: 1, y: 2, k: 2864, pointType: 2, p: {} },
    { x: 5, y: 5, pointType: 133, m: {} },
  ] };
  assert.deepEqual(L.points(d), [
    { x: 480, y: 804, k: 2864, fSid: 4419, marchId: '4888553843884983816', hideEndMs: NOW + 42000, attack: 1, spId: 1 },
    { x: 659, y: 929, k: 2864, fSid: 2937, marchId: '4888562190968615425', hideEndMs: 0, attack: 0, spId: 1 },
  ]);
  assert.deepEqual(L.points(JSON.stringify(d)).length, 2, 'the game sends 901 as a string');
  assert.deepEqual(L.points(null), []);
});

test('the cross-in list: server, name, level, super weapon, and x/y only when the game gives them', () => {
  const ack = { header: { s: 0 }, crossTreasureGetCrossInInfos: { crossInInfos: [
    { sid: 4419, playerInfo: '{"username":"Aakash","nationalflag":233}', power: 9e35, level: 100, grailSpecId: 0 },
    { sid: 2937, playerInfo: 'not json', level: 100, grailSpecId: 3, x: 10, y: 20 },
  ] } };
  assert.deepEqual(L.crossIn(ack), [
    { sid: 4419, name: 'Aakash', level: 100, grail: 0, x: null, y: null },
    { sid: 2937, name: '', level: 100, grail: 3, x: 10, y: 20 },
  ]);
  assert.equal(L.crossIn({ header: { s: 3 } }), null, 'a refusal is not an empty list');
  assert.deepEqual(L.crossIn({ header: { s: 0 } }), []);
});

test('Loot Quest is on inside an open window (open flag set); windows come as strings or numbers', () => {
  const cs = { open: 1, timeInfo: { openTime: [{ beginMill: '1792177200000', endMill: '1792184400000' }, { beginMill: 1792206000000, endMill: '1792213200000' }] } };
  assert.equal(L.lootQuestLive(cs, NOW), true);
  assert.equal(L.lootQuestLive(cs, 1792213200000), false, 'the end is not inside');
  assert.equal(L.lootQuestLive(Object.assign({}, cs, { open: 0 }), NOW), false);
  assert.equal(L.lootQuestLive(null, NOW), false);
  assert.equal(L.nextWindow(cs, 1792190000000), 1792206000000);
  assert.equal(L.nextWindow(cs, 1792213300000), 0);
});

test('who still needs finding: a listed server with no tracked looter, unless it is on hold', () => {
  const list = [{ sid: 4419 }, { sid: 2937 }, { sid: 1000 }];
  const tracked = { m1: { fSid: 4419 } };
  assert.deepEqual(L.missing(list, tracked, {}, NOW), [2937, 1000]);
  assert.deepEqual(L.missing(list, tracked, { 2937: NOW + 1000 }, NOW), [1000]);
  assert.deepEqual(L.missing(list, tracked, { 2937: NOW - 1 }, NOW), [2937, 1000], 'a hold runs out');
  assert.equal(L.allFound(list, [{ fSid: 4419 }, { fSid: 2937 }, { fSid: 1000 }]), true);
  assert.equal(L.allFound(list, [{ fSid: 4419 }]), false);
  assert.equal(L.allFound([], []), true);
});

test('the 30-second check: still there, moved, or gone', () => {
  const tr = { marchId: 'm1', x: 480, y: 804, fSid: 4419 };
  assert.deepEqual(L.recheck(tr, [{ marchId: 'm1', x: 480, y: 804 }]), { state: 'here', pt: { marchId: 'm1', x: 480, y: 804 } });
  assert.deepEqual(L.recheck(tr, [{ marchId: 'm2', x: 480, y: 804 }, { marchId: 'm1', x: 500, y: 790 }]).state, 'moved');
  assert.deepEqual(L.recheck(tr, [{ marchId: 'm2', x: 480, y: 804 }]), { state: 'gone', pt: null });
  assert.deepEqual(L.recheck(tr, []), { state: 'gone', pt: null });
});

test('world chat spots in the last 5 minutes: any position card, and typed coordinates', () => {
  const t = Math.floor(NOW / 1000);
  const rows = [
    { _time: t - 100, _chatShareLinkData: { t: 0, st: 1, p: { x: 480, y: 804, z: 2864 }, sk: "Aakash's Loot Quest Team" } },
    { _time: t - 30, _chatShareLinkData: { t: 0, st: 4, p: { x: 100, y: 200, z: 2864 } } },
    { _time: t - 400, _chatShareLinkData: { t: 0, st: 1, p: { x: 659, y: 929, z: 2864 } } },          // too old
    { _time: t - 10, _msg: 'looter at X:659 Y:929 go go' },
    { _time: t - 10, _msg: 'hit 300,301 and 302 : 303' },
    { _time: t - 10, _msg: 'lol 12' },
    { _time: t - 10, _chatShareLinkData: { t: 48, p: { x: 1, y: 1 } } },
  ];
  assert.deepEqual(L.chatSpots(rows, NOW).map((s) => [s.x, s.y]), [[480, 804], [100, 200], [659, 929], [300, 301], [302, 303]]);
});

test('share rule: on, nobody shared it within 3 tiles in 5 minutes, 10 s since our last post', () => {
  const spots = [{ x: 480, y: 804, k: 2864, at: NOW - 100000 }];
  const base = { on: true, spots, x: 659, y: 929, k: 2864, now: NOW, lastShareAt: 0 };
  assert.deepEqual(L.shareCheck(base), { ok: true });
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { on: false })), { ok: false, reason: 'off' });
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { x: 482, y: 801 })), { ok: false, reason: 'shared' }, 'within 3 tiles');
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { x: 484, y: 804 })), { ok: true }, '4 tiles away is another spot');
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { x: 480, y: 804, spots: [{ x: 480, y: 804, k: 619, at: NOW }] })), { ok: true }, 'another server');
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { lastShareAt: NOW - 5000 })), { ok: false, reason: 'wait', until: NOW + 5000 });
  assert.deepEqual(L.shareCheck(Object.assign({}, base, { lastShareAt: NOW - 5000, gapMs: 1000 })), { ok: true }, 'the gap the caller gives');
});

test('the share card is the game\'s own looter share, and the alliance copy follows 2 s later', () => {
  assert.deepEqual(L.card({ x: 480, y: 804, k: 2864 }, "Aakash's Loot Quest Team", 'cross_treasure_share'),
    { t: 0, st: 1, p: { x: 480, y: 804, z: 2864 }, s: '', sk: "Aakash's Loot Quest Team", icon: 'image/world_unit/cross_treasure_share' });
  assert.equal(L.ALLY_DELAY_MS, 2000);
  assert.equal(L.SHARE_WINDOW_MS, 300000);
});

test('caps (Tex: every 1.5 s is fine): 40 views a minute, 300 in 10 minutes; a pass that misses waits 1 minute', () => {
  assert.equal(L.MAX_PER_MIN, 40); assert.equal(L.MAX_PER_10, 300); assert.equal(L.HOLD_MS, 60000);
  assert.deepEqual(L.gate([], NOW), { ok: true });
  const m = Array.from({ length: 40 }, (_, i) => NOW - 50000 + i * 100);
  assert.equal(L.gate(m, NOW).ok, false);
  assert.equal(L.gate(m, NOW).until, NOW - 50000 + 60000);
  const ten = Array.from({ length: 300 }, (_, i) => NOW - 599000 + i * 1750);   // 300 in 10 minutes, none in the last one
  assert.ok(ten.every((t) => t < NOW - 60000));
  assert.deepEqual(L.gate(ten, NOW), { ok: false, until: NOW - 599000 + 600000, reason: '300 lookups in 10 minutes' });
  assert.equal(L.gate(ten.slice(1), NOW).ok, true);
});

test('the gate takes raised caps only when given them (a test), and the game day starts at reset (12:00 ET)', () => {
  const m = Array.from({ length: 40 }, (_, i) => NOW - 50000 + i * 100);
  assert.equal(L.gate(m, NOW, 1000, 1000).ok, true);
  assert.equal(L.gameDay(Date.UTC(2026, 9, 17, 3, 30)), '2026-10-16', '23:30 ET on the 16th');
  assert.equal(L.gameDay(Date.UTC(2026, 9, 17, 16, 30)), '2026-10-17', '12:30 ET on the 17th');
});

test('how a looter shows: invisible with time left, attacking, or visible', () => {
  assert.equal(L.looks({ hideEndMs: NOW + 42000, attack: 1 }, NOW), 'Invisible 0:42');
  assert.equal(L.looks({ hideEndMs: NOW - 1, attack: 1 }, NOW), 'Attacking');
  assert.equal(L.looks({ hideEndMs: 0, attack: 0 }, NOW), 'Visible');
});

// Tex 2026-10-17: "before sharing to world chat and alliance chat, let us add a 2 minute delay ... configurable from
// the sharer's menu, default 2 minutes, up to 5".
test('share delay: 1 to 5 whole minutes, 2 by default; anything else falls back or is clamped', () => {
  assert.equal(L.DELAY_DEFAULT, 2); assert.equal(L.DELAY_MIN, 1); assert.equal(L.DELAY_MAX, 5);
  assert.equal(L.delayMinutes(null), 2);
  assert.equal(L.delayMinutes('x'), 2);
  assert.equal(L.delayMinutes('3'), 3);
  assert.equal(L.delayMinutes(5), 5);
  assert.equal(L.delayMinutes('0'), 1);
  assert.equal(L.delayMinutes('9'), 5);
  assert.equal(L.delayMinutes('2.5'), 2);
});

test('share delay: a looter may be shared once its delay has run from when the clock started', () => {
  assert.equal(L.shareAt({ since: NOW }, 2, 60000), NOW + 120000);
  assert.equal(L.shareAt({ since: NOW }, 5, 60000), NOW + 300000);
  assert.equal(L.shareAt({}, 2, 60000), 120000, 'no start time: counts from 0, never NaN');
});
