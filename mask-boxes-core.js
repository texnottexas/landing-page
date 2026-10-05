// mask-boxes-core.js — Mask Mystery Boxes pure rules: which reported boxes to try, reading the game's view and
// collect answers, the hard limits and the daily counts. No DOM, no game access.
// window.MaskBoxesCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var TYPES = { 1: 'Treasure', 2: 'HT', 3: 'RSS' }, DAILY_CAP = 20, MIN_LEFT_MS = 45000;
  var CLAIMED = 'pubilc911', ITEM_BASE = 260617001;     // "Reward claimed"; a box's item is 260617001 + its type
  var MAX_PER_MIN = 10, MAX_PER_10MIN = 50, FAIL_STREAK = 3, FAIL_PAUSE_MS = 300000;

  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }

  // The feed reports one box per city; the same report twice (two players) shares server, spot and end time.
  function boxKey(b) { return b.server + ':' + b.x + ':' + b.y + ':' + b.endMs; }

  // Boxes worth trying now: a type that is switched on and under today's 20, at least 45 s left (a view and a
  // collect take a few seconds), not tried this run; soonest-ending first so the ones about to vanish go first.
  function candidates(boxes, o) {
    var seen = {}, out = [];
    (boxes || []).forEach(function (b) {
      var k = boxKey(b);
      if (seen[k] || (o.tried && o.tried[k])) return;
      seen[k] = 1;
      if (!o.types[b.type]) return;
      if ((o.counts[b.type] || 0) >= DAILY_CAP) return;
      if (!(b.endMs - o.now >= MIN_LEFT_MS)) return;
      out.push(b);
    });
    return out.sort(function (a, c) { return a.endMs - c.endMs; });
  }

  // The box hangs off its owner's city in the 901 world view: the city point at exactly (x, y) on server k with a
  // cityReward. Its type comes from the box's own item, not the report.
  // The live 901 answer is {c, o, d} with no s; a timeout, a blocked send or a game error carries one.
  // A numeric s other than 0 is the game refusing: stop on it (its message key is in d). A timeout or a blocked
  // send ('timeout' / 'blocked') is an error toward the breaker.
  function findBox(answer, x, y, k) {
    if (!answer) return { state: 'error' };
    if (answer.s != null && answer.s !== 0) return typeof answer.s === 'number' ? { state: 'stop', key: typeof answer.d === 'string' ? answer.d.slice(0, 80) : '' } : { state: 'error' };
    var d;
    try { d = typeof answer.d === 'string' ? JSON.parse(answer.d) : answer.d; } catch (e) { return { state: 'error' }; }
    if (!d || !Array.isArray(d.pointList)) return { state: 'error' };
    var pts = d.pointList;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p || !p.p || p.x !== x || p.y !== y || p.k !== k) continue;
      var r = p.p.cityReward;
      if (!r || r.itemId == null) return { state: 'gone' };
      var t = Number(r.itemId) - ITEM_BASE;
      return { state: 'box', pid: String(p.p.pid), instanceId: String(r.instanceId), type: TYPES[t] ? t : 0 };
    }
    return { state: 'gone' };
  }

  // Items: collected. "Reward claimed": recorded. Anything else the game answers (a refusal, or a success without
  // a reward) is an answer we have never seen: stop. Only a timeout or a blocked send is a plain failure.
  function classifyCollect(a) {
    if (!a || typeof a.s !== 'number') return { kind: 'failed' };
    var h = (a.pbAckV2 && a.pbAckV2.header) || {};
    if (a.s === 0) {
      var items = a.pbAckV2 && a.pbAckV2.data && a.pbAckV2.data.rewardResult && a.pbAckV2.data.rewardResult.items;
      return Array.isArray(items) && items.length ? { kind: 'ok', items: items } : { kind: 'stop', key: '' };
    }
    if (h.d === CLAIMED) return { kind: 'claimed' };
    return { kind: 'stop', key: h.d ? String(h.d).slice(0, 80) : '' };
  }

  // Hard limits, checked before every box: 10 a minute, 50 per 10 minutes, and three failed tries in a row pause
  // for 5 minutes. log = [{t, kind}], one entry per box tried.
  function gate(log, now) {
    var inMin = log.filter(function (e) { return e.t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0].t + 60000, reason: 'too many boxes in a minute' };
    var inTen = log.filter(function (e) { return e.t > now - 600000; });
    if (inTen.length >= MAX_PER_10MIN) return { ok: false, until: inTen[0].t + 600000, reason: 'too many boxes in 10 minutes' };
    var last = log.slice(-FAIL_STREAK);
    if (last.length === FAIL_STREAK && last.every(function (e) { return e.kind === 'failed'; })) {
      var until = last[last.length - 1].t + FAIL_PAUSE_MS;
      if (now < until) return { ok: false, until: until, reason: 'three tries in a row failed' };
    }
    return { ok: true };
  }

  function countsFor(store, day) {
    var c = (store && store.day === day && store.counts) || {};
    return { 1: c[1] || 0, 2: c[2] || 0, 3: c[3] || 0 };
  }

  function cardRows(counts, types) {
    return [1, 2, 3].map(function (t) { return [TYPES[t], (counts[t] || 0) + '/' + DAILY_CAP, !!types[t]]; });
  }

  var MaskBoxesCore = {
    TYPES: TYPES, DAILY_CAP: DAILY_CAP, MIN_LEFT_MS: MIN_LEFT_MS, CLAIMED: CLAIMED, ITEM_BASE: ITEM_BASE,
    gameDay: gameDay, boxKey: boxKey, candidates: candidates, findBox: findBox, classifyCollect: classifyCollect,
    gate: gate, countsFor: countsFor, cardRows: cardRows
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MaskBoxesCore;
  else root.MaskBoxesCore = MaskBoxesCore;
})(typeof window !== 'undefined' ? window : globalThis);
