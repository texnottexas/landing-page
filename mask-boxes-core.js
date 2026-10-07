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
      if (o.spots && spotBlocked(o.spots, cityKey(b), o.now)) return;
      if (!o.types[b.type]) return;
      if ((o.counts[b.type] || 0) >= DAILY_CAP) return;
      if (!(b.endMs - o.now >= MIN_LEFT_MS)) return;
      out.push(b);
    });
    return out.sort(function (a, c) { return a.endMs - c.endMs; });
  }

  // The box hangs off its owner's city in the 901 world view: a city point on server k with a cityReward. Its type
  // comes from the box's own item, not the report. A reported spot can be any tile of the city rather than its
  // anchor (live: reported 785,535, city at 783,535), so: the box whose end time is the reported one, anywhere in
  // the view; else the city at exactly (x, y); else the one nearest box within 3 tiles (two equally near: leave it).
  var NEAR = 3;
  function boxOf(p) {
    var r = p.p.cityReward, t = Number(r.itemId) - ITEM_BASE;
    return { state: 'box', pid: String(p.p.pid), instanceId: String(r.instanceId), type: TYPES[t] ? t : 0 };
  }
  function hasBox(p) { return !!(p.p.cityReward && p.p.cityReward.itemId != null); }
  // A numeric s other than 0 is the game refusing: stop on it (its message key is in d). A timeout or a blocked
  // send ('timeout' / 'blocked') is an error toward the breaker.
  function findBox(answer, x, y, k, endMs) {
    if (!answer) return { state: 'error' };
    if (answer.s != null && answer.s !== 0) return typeof answer.s === 'number' ? { state: 'stop', key: typeof answer.d === 'string' ? answer.d.slice(0, 80) : '' } : { state: 'error' };
    var d;
    try { d = typeof answer.d === 'string' ? JSON.parse(answer.d) : answer.d; } catch (e) { return { state: 'error' }; }
    if (!d || !Array.isArray(d.pointList)) return { state: 'error' };
    var pts = d.pointList.filter(function (p) { return p && p.p && p.k === k; }), i, p;
    if (endMs != null) for (i = 0; i < pts.length; i++) { p = pts[i]; if (hasBox(p) && Number(p.p.cityReward.endTimeMilli) === endMs) return boxOf(p); }
    for (i = 0; i < pts.length; i++) { p = pts[i]; if (p.x === x && p.y === y) return hasBox(p) ? boxOf(p) : { state: 'gone' }; }
    var best = null, bestD = NEAR + 1, tie = false;
    pts.forEach(function (q) {
      if (!hasBox(q)) return;
      var dist = Math.max(Math.abs(q.x - x), Math.abs(q.y - y));
      if (dist < bestD) { best = q; bestD = dist; tie = false; } else if (dist === bestD) tie = true;
    });
    return best && !tie ? boxOf(best) : { state: 'gone' };
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

  // The game's own count of boxes collected today, per box item (UserData.itemCityRewardReceivedNum, pushed after
  // login and after every collect). It is trusted for the game day the tool saw it arrive or change in, so a count
  // from before reset never blocks the new day. tracker = {day, key, num}.
  function trackServer(prev, num, day) {
    var clean = null;
    if (num && typeof num === 'object' && !Array.isArray(num)) {
      [1, 2, 3].forEach(function (t) { var n = Number(num[ITEM_BASE + t]); if (isFinite(n) && n > 0) (clean = clean || {})[t] = Math.floor(n); });
    }
    if (!clean) return prev && prev.num ? prev : { day: '', key: '', num: null };
    var key = JSON.stringify(clean);
    return prev && prev.key === key ? prev : { day: day, key: key, num: clean };
  }
  function countsWith(local, tracker, day) {
    var c = { 1: local[1] || 0, 2: local[2] || 0, 3: local[3] || 0 };
    if (tracker && tracker.num && tracker.day === day) [1, 2, 3].forEach(function (t) { if ((tracker.num[t] || 0) > c[t]) c[t] = tracker.num[t]; });
    return c;
  }

  function cardRows(counts, types) {
    return [1, 2, 3].map(function (t) { return [TYPES[t], (counts[t] || 0) + '/' + DAILY_CAP, !!types[t]]; });
  }

  // ---------------------------------------------------------------- chat (spiked on Rеx 2026-10-07)
  var CARD_T = 48, POSITION_T = 0, PLAYER_ST = 4, BASE_MAX_AGE_MS = 600000, BASE_PER_10MIN = 3, SPOT_NO_BOX_MS = 1800000;
  function whole(v, lo, hi) { return typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi; }
  function cardType(d) {
    var t = Number(d.actt) - 62;
    if (TYPES[t]) return t;
    var m = /^JMR_bs_00([123])$/.exec(String(d.s || ''));
    return m ? Number(m[1]) : 0;
  }
  function ownerText(v) { return Array.from(String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 40).join(''); }
  function cityKey(b) { return b.server + ':' + b.x + ':' + b.y; }
  // The game's box cards ("X's Base has transformed into a Treasure Map!"), from any chat room.
  function chatBoxes(rows, now) {
    var out = [];
    (rows || []).forEach(function (m) {
      var d = m && m._chatShareLinkData;
      if (!d || d.t !== CARD_T || !d.p || !d.extra) return;
      var type = cardType(d), x = d.p.x, y = d.p.y, server = Number(d.extra.jumpServerId), endMs = Math.round(Number(d.extra.expireTime) * 1000);
      if (!type || !whole(x, 0, 1200) || !whole(y, 0, 1200) || !whole(server, 1, 99999) || !(endMs > now && endMs <= now + 864e5)) return;
      out.push({ server: server, x: x, y: y, type: type, endMs: endMs, owner: ownerText((d.extra.contentParams || [])[0]), src: 'chat' });
    });
    return out;
  }
  // Plain base shares (t:0 st:4): a spot that may have a box. Only fresh ones; p.z is the server.
  function baseShares(rows, now) {
    var out = [];
    (rows || []).forEach(function (m) {
      var d = m && m._chatShareLinkData;
      if (!d || d.t !== POSITION_T || d.st !== PLAYER_ST || !d.p) return;
      var at = Number(m._time) * 1000;
      if (!(at > now - BASE_MAX_AGE_MS && at <= now + 60000)) return;
      var server = Number(d.p.z);
      if (!whole(server, 1, 99999)) server = Number(m._worldId);
      if (!whole(server, 1, 99999) || !whole(d.p.x, 0, 1200) || !whole(d.p.y, 0, 1200)) return;
      out.push({ server: server, x: d.p.x, y: d.p.y, at: at, src: 'base' });
    });
    return out;
  }
  function mergeBoxes(lists) {
    var best = {}, order = [];
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (b) { var k = cityKey(b); if (!best[k]) order.push(k); if (!best[k] || b.endMs > best[k].endMs) best[k] = b; });
    });
    return order.map(function (k) { return best[k]; });
  }
  // Spot memory: {'server:x:y': until}. A spot is never viewed again before its time, whoever re-reports it.
  function spotBlocked(spots, key, now) { return !!(spots && Number(spots[key]) > now); }
  function rememberSpot(spots, key, until) { var o = {}, k; for (k in spots) o[k] = spots[k]; if (!(Number(o[key]) >= until)) o[key] = until; return o; }
  function pruneSpots(spots, now) { var o = {}; Object.keys(spots || {}).forEach(function (k) { var u = Number(spots[k]); if (u > now) o[k] = u; }); return o; }
  // A base share is a maybe: newest untried, unremembered one, at most 3 views per 10 minutes.
  function baseCandidate(shares, o) {
    var recent = (o.baseLog || []).filter(function (t) { return t > o.now - 600000; });
    if (recent.length >= BASE_PER_10MIN) return null;
    var list = (shares || []).filter(function (s) { var k = cityKey(s); return !(o.tried && o.tried[k]) && !spotBlocked(o.spots, k, o.now); });
    list.sort(function (a, c) { return c.at - a.at; });
    return list[0] || null;
  }
  // The city holding the box we found: its anchor, server (p.w), end, item and player info (for the share card).
  function boxPoint(answer, pid) {
    var d;
    try { d = typeof answer.d === 'string' ? JSON.parse(answer.d) : answer.d; } catch (e) { return null; }
    var pts = d && Array.isArray(d.pointList) ? d.pointList : [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p && p.p && p.p.cityReward && String(p.p.pid) === String(pid)) {
        return { x: p.x, y: p.y, w: Number(p.p.w) || Number(p.k) || 0, endMs: Number(p.p.cityReward.endTimeMilli) || 0, itemId: Number(p.p.cityReward.itemId) || 0, info: p.p.playerInfo || '' };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- sharing (proven live on Rеx 2026-10-07)
  var SHARE_GAP_MS = 10000, SHARE_MIN_LEFT_MS = 300000;
  var PARTY = { 1: { banner: 'shareIcon2', key: 'JMR_bs_001', msgType: 63 }, 2: { banner: 'shareIcon3', key: 'JMR_bs_002', msgType: 64 }, 3: { banner: 'shareIcon4', key: 'JMR_bs_003', msgType: 65 } };
  function shareCheck(o) {
    if (!o.on) return { ok: false, reason: 'off' };
    if (!o.typeOn) return { ok: false, reason: 'type off' };
    if (!(o.endMs - o.now >= SHARE_MIN_LEFT_MS)) return { ok: false, reason: 'ending' };
    if ((o.sharedIds || []).indexOf(o.instanceId) >= 0) return { ok: false, reason: 'shared' };
    if (o.worldOk === false) return { ok: false, reason: 'no world chat' };   // can't check it: fail closed
    var dup = (o.worldCards || []).some(function (c) { return c.server === o.server && c.x === o.x && c.y === o.y && (!c.endMs || !o.endMs || c.endMs === o.endMs); });
    if (dup) return { ok: false, reason: 'in world chat' };
    if (o.lastShareAt && o.now - o.lastShareAt < SHARE_GAP_MS) return { ok: false, reason: 'wait', at: o.lastShareAt + SHARE_GAP_MS };
    return { ok: true };
  }
  // The game's own card (UserItemCityReward panel → sendChatLinkActCommon2), key order kept.
  function shareLink(type, pt, host, row) {
    var cfg = row && row.msg_banner && row.share_msg_key && row.msg_type ? { banner: row.msg_banner, key: row.share_msg_key, msgType: Number(row.msg_type) } : PARTY[type];
    if (!cfg || !pt) return null;
    return { t: CARD_T, icon: 'm/UserItemCityReward/images/' + cfg.banner, s: cfg.key, p: { x: pt.x, y: pt.y },
      extra: { btnKey: '102385', aid: 0, shareBgPath: 'image/NChat/chat_v3_share_bg11', shareIconPath: 'image/NChat/chat_v3_share_icon_pos5', shareTitleColor: '#5674d2',
        expireTime: pt.endMs / 1000, contentParams: [String(host || '')], jumpServerId: pt.w }, actt: cfg.msgType };
  }

  var MaskBoxesCore = {
    TYPES: TYPES, DAILY_CAP: DAILY_CAP, MIN_LEFT_MS: MIN_LEFT_MS, CLAIMED: CLAIMED, ITEM_BASE: ITEM_BASE,
    gameDay: gameDay, boxKey: boxKey, candidates: candidates, findBox: findBox, classifyCollect: classifyCollect,
    gate: gate, countsFor: countsFor, cardRows: cardRows, trackServer: trackServer, countsWith: countsWith,
    SPOT_NO_BOX_MS: SPOT_NO_BOX_MS, BASE_MAX_AGE_MS: BASE_MAX_AGE_MS, cityKey: cityKey, chatBoxes: chatBoxes, baseShares: baseShares,
    mergeBoxes: mergeBoxes, spotBlocked: spotBlocked, rememberSpot: rememberSpot, pruneSpots: pruneSpots, baseCandidate: baseCandidate, boxPoint: boxPoint,
    SHARE_GAP_MS: SHARE_GAP_MS, SHARE_MIN_LEFT_MS: SHARE_MIN_LEFT_MS, shareCheck: shareCheck, shareLink: shareLink
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MaskBoxesCore;
  else root.MaskBoxesCore = MaskBoxesCore;
})(typeof window !== 'undefined' ? window : globalThis);
