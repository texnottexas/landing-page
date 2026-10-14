// ht-gifts-core.js — HT Gift Boxes pure rules: the password, which Chip Blessing gift boxes to claim, our gift
// marches out, the daily cap, the sent list, the game's answers. No DOM, no game access.
// window.HtGiftsCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var PW_HASH = 'e4ba5cbd251c98e6cd1c23f126a3b81d8d8328abc95387229850952b3ef9f904';   // sha256("bananas")
  var MAX_OUT = 5;                                      // Tex: at most 5 gift marches out at once
  var BAG_DEFAULT = 20, MIN_LEFT_SEC = 90, XY_TTL_MS = 35 * 60000;
  var GAP_MS = 1500, MAX_PER_MIN = 10, TYPE = 259, DROP = 256, CLAIM = 257, CAP_CFG = 250908001, CAP_DEFAULT = 10;

  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }
  function int(v, d) { var n = Math.floor(Number(v)); return isFinite(n) ? n : d; }

  function checkPassword(hex) { return typeof hex === 'string' && hex === PW_HASH; }
  function capFrom(cfg) { var n = int(cfg, 0); return n > 0 ? n : CAP_DEFAULT; }
  // One gift box = one lucky bag of one blessing's drop march; a bare tile when the game gives no ids.
  function giftKey(m, x, y) { return m && m.marchIdStr != null && m.luckyBagNum != null ? String(m.marchIdStr) + ':' + m.luckyBagNum : '@' + x + ',' + y; }

  // The gift boxes in a map view worth a claim, best first: fewest claims left (they fill soonest), then soonest ending.
  // The game's own pick (8852, o.anchor) is added last when the view didn't show that tile at all.
  function pickGifts(points, o) {
    var out = [], seen = {}, sent = o.sent || {}, anchorSeen = false;
    var recentTile = function (x, y) { var t = sent['@' + x + ',' + y]; return t && o.nowMs - t < XY_TTL_MS; };
    (Array.isArray(points) ? points : []).forEach(function (p) {
      if (!p || p.pointType !== TYPE) return;
      var x = Number(p.x), y = Number(p.y), m = p.m || {};
      if (!(x % 1 === 0 && y % 1 === 0 && x >= 0 && y >= 0)) return;
      if (o.anchor && o.anchor.x === x && o.anchor.y === y) anchorSeen = true;
      if (o.k != null && p.k != null && Number(p.k) !== Number(o.k)) return;
      var key = giftKey(m, x, y);
      if (seen[key] || sent[key] || recentTile(x, y)) return;
      seen[key] = 1;
      var list = Array.isArray(m.receiveBagUidList) ? m.receiveBagUidList.map(String) : [];
      if (o.me && list.indexOf(String(o.me)) >= 0) return;
      var left = ((o.bagCap && int(o.bagCap(m.floatParadeId), 0)) || BAG_DEFAULT) - list.length;
      if (left <= 0) return;
      var end = Number(m.endSecsTime) || 0;
      if (end - o.now < (o.minLeft == null ? MIN_LEFT_SEC : o.minLeft)) return;
      out.push({ x: x, y: y, key: key, claimsLeft: left, end: end });
    });
    out.sort(function (a, b) { return a.claimsLeft !== b.claimsLeft ? a.claimsLeft - b.claimsLeft : a.end - b.end; });
    var A = o.anchor;
    if (A && !anchorSeen && !recentTile(A.x, A.y) && !sent['@' + A.x + ',' + A.y]) out.push({ x: A.x, y: A.y, key: '@' + A.x + ',' + A.y, claimsLeft: BAG_DEFAULT, end: 0 });
    return out;
  }

  // A claim's march from the game's answer (server seconds): when it lands and when it is home again.
  function ownFromAnswer(d, now) {
    var mi = d && d.marchInfo, start = mi && Number(mi.marchStartTime), arrive = mi && Number(mi.marchArrive);
    if (!(arrive > 0 && start > 0)) return { arrive: now + 60, ret: now + 120 };
    return { arrive: arrive, ret: arrive + Math.max(arrive - start, 1) };
  }
  function outCount(own, worldCount, now) { var n = (own || []).filter(function (c) { return c.ret > now; }).length; return Math.max(n, int(worldCount, 0)); }
  // Claims not yet in the game's day count: until a few seconds after they land.
  function inFlight(own, now) { return (own || []).filter(function (c) { return c.arrive > now - 3; }).length; }
  function room(o) { return Math.max(0, Math.min(MAX_OUT - o.out, o.cap - o.received - o.inflight)); }

  function sentFor(store, day) {
    var ok = store && typeof store === 'object' && store.day === day && store.keys && typeof store.keys === 'object';
    return { day: day, keys: ok ? Object.assign({}, store.keys) : {} };
  }

  function classify(a) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent' };
    if (a.s === 0) return { kind: 'ok' };
    return { kind: 'refused', s: a.s, key: typeof a.d === 'string' ? a.d.slice(0, 80) : '' };
  }
  // 8852: the next gift the player can claim, or none.
  function classifyQuery(a) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent' };
    var h = a.pbAckV2 && a.pbAckV2.header, d = a.pbAckV2 && a.pbAckV2.data;
    var x = d && Number(d.x), y = d && Number(d.y);
    if (h && h.s === 0 && x % 1 === 0 && y % 1 === 0 && x > 0 && y > 0) return { kind: 'gift', x: x, y: y };
    return { kind: 'none' };
  }
  // 901: the map view's points (it has no s).
  function classifyView(a) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent', points: [] };
    var d = null; try { d = typeof a.d === 'string' ? JSON.parse(a.d) : a.d; } catch (e) { d = null; }
    return { kind: 'ok', points: d && Array.isArray(d.pointList) ? d.pointList : [] };
  }
  function gate(log, now) {
    var inMin = log.filter(function (t) { return t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0] + 60000, reason: MAX_PER_MIN + ' claims in a minute' };
    return { ok: true };
  }

  var HtGiftsCore = {
    PW_HASH: PW_HASH, MAX_OUT: MAX_OUT, BAG_DEFAULT: BAG_DEFAULT, MIN_LEFT_SEC: MIN_LEFT_SEC, XY_TTL_MS: XY_TTL_MS, GAP_MS: GAP_MS, MAX_PER_MIN: MAX_PER_MIN,
    TYPE: TYPE, DROP: DROP, CLAIM: CLAIM, CAP_CFG: CAP_CFG, CAP_DEFAULT: CAP_DEFAULT,
    gameDay: gameDay, checkPassword: checkPassword, capFrom: capFrom, giftKey: giftKey, pickGifts: pickGifts, ownFromAnswer: ownFromAnswer,
    outCount: outCount, inFlight: inFlight, room: room, sentFor: sentFor, classify: classify, classifyQuery: classifyQuery, classifyView: classifyView, gate: gate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HtGiftsCore;
  else root.HtGiftsCore = HtGiftsCore;
})(typeof window !== 'undefined' ? window : globalThis);
