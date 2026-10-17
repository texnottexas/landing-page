// looter-locator-core.js — Looter Locator pure rules: during Loot Quest, the looters from other servers on our map.
// The map pass (zoom-level-1 map views, 120 x 80 tiles each), looter points (type 133), the cross-in list, Loot Quest
// windows, tracking, the 5-minute world chat rule, the share card, the request caps. No DOM, no game access.
// window.LooterCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var COLS = 7, ROWS = 12, X0 = 60, Y0 = 40, DX = 120, DY = 80, HALF_W = 60, HALF_H = 40;   // measured live 2026-10-16
  var TYPE = 133;                                       // WorldMapEntityType.CROSS_TREASURE
  var LIST_MS = 60000, RECHECK_MS = 30000, PUSH_DELAY_MS = 2000, HOLD_MS = 60000;   // a pass that misses someone: again in 1 minute (Tex)
  var MAX_PER_MIN = 40, MAX_PER_10 = 300, FAILS_MAX = 2, PAUSE_MS = 300000;   // Tex: a lookup every 1.5 s is fine
  var SHARE_WINDOW_MS = 300000, NEAR = 3, SHARE_GAP_MS = 10000, ALLY_DELAY_MS = 2000, BOUNCE_MS = 10000;
  var POSITION_T = 0, BOSS_ST = 1;                     // ChatShareLinkType.POSITION, ChatShareLinkSubType.BOSS
  var DELAY_DEFAULT = 2, DELAY_MIN = 1, DELAY_MAX = 5;  // Tex 2026-10-17: wait before sharing (minutes), the sharer picks

  function num(v) { var n = Number(v != null && typeof v === 'object' && v.toString ? v.toString() : v); return isFinite(n) ? n : NaN; }
  function whole(v, lo, hi) { return typeof v === 'number' && v % 1 === 0 && v >= lo && v <= hi; }
  function clampX(x) { return Math.min(X0 + DX * (COLS - 1), Math.max(X0, x)); }
  function clampY(y) { return Math.min(Y0 + DY * (ROWS - 1), Math.max(Y0, y)); }

  // The whole server in serpentine order, so each view is next door to the last one (like a person panning).
  function passCells() {
    var out = [];
    for (var j = 0; j < ROWS; j++) {
      var row = [];
      for (var i = 0; i < COLS; i++) row.push({ x: X0 + DX * i, y: Y0 + DY * j });
      if (j % 2) row.reverse();
      out = out.concat(row);
    }
    return out;
  }
  function inWindow(cx, cy, x, y) { return x >= cx - HALF_W && x <= cx + HALF_W - 1 && y >= cy - HALF_H && y <= cy + HALF_H - 1; }
  // The 8 windows around a looter's old spot (the spot itself is the 30-second check), kept on the map.
  function ringCells(x, y) {
    var c = { x: clampX(x), y: clampY(y) }, seen = {}, out = [];
    [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].forEach(function (d) {
      var w = { x: clampX(x + d[0] * DX), y: clampY(y + d[1] * DY) }, k = w.x + ',' + w.y;
      if (seen[k] || (w.x === c.x && w.y === c.y)) return;
      seen[k] = 1; out.push(w);
    });
    return out;
  }

  // Looter points in a map answer (901; the game sends it as a JSON string).
  function points(d) {
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    var out = [];
    ((d && d.pointList) || []).forEach(function (p) {
      if (!p || p.pointType !== TYPE) return;
      var m = p.m || p.extData || {}, fSid = num(m.fSid);
      if (!whole(p.x, 0, 1200) || !whole(p.y, 0, 1200) || !whole(fSid, 1, 99999) || m.marchId == null) return;
      out.push({ x: p.x, y: p.y, k: num(p.k) || 0, fSid: fSid, marchId: String(m.marchId), hideEndMs: num(m.hideEndTime) || 0, attack: num(m.attack) === 1 ? 1 : 0, spId: num(m.spId) || 1 });
    });
    return out;
  }
  // The game's looter list (7575, the Defense panel): null on a refusal, so a refusal never reads as "nobody".
  function crossIn(ack) {
    if (!ack || !ack.header || ack.header.s !== 0) return null;
    var list = (ack.crossTreasureGetCrossInInfos && ack.crossTreasureGetCrossInInfos.crossInInfos) || [];
    return list.map(function (r) {
      var name = ''; try { name = String(JSON.parse(r.playerInfo || '{}').username || ''); } catch (e) {}
      var x = num(r.x), y = num(r.y);
      return { sid: num(r.sid), name: name.slice(0, 40), level: num(r.level) || 0, grail: num(r.grailSpecId) || 0, x: isFinite(x) ? x : null, y: isFinite(y) ? y : null };
    }).filter(function (r) { return whole(r.sid, 1, 99999); });
  }

  // Loot Quest is on while the hunt is open and now is inside one of its windows (CSHuntController.timeInfo.openTime).
  function windows(cs) {
    if (!cs || !cs.open || !cs.timeInfo || !Array.isArray(cs.timeInfo.openTime)) return [];
    return cs.timeInfo.openTime.map(function (w) { return { b: num(w && w.beginMill), e: num(w && w.endMill) }; }).filter(function (w) { return w.b > 0 && w.e > w.b; });
  }
  function lootQuestLive(cs, nowMs) { return windows(cs).some(function (w) { return w.b <= nowMs && nowMs < w.e; }); }
  function nextWindow(cs, nowMs) { var n = 0; windows(cs).forEach(function (w) { if (w.b > nowMs && (!n || w.b < n)) n = w.b; }); return n; }

  // Listed servers with no tracked looter, minus servers on hold after a pass that didn't find them.
  function missing(list, tracked, holds, now) {
    var have = {}, out = [];
    Object.keys(tracked || {}).forEach(function (k) { if (tracked[k]) have[tracked[k].fSid] = 1; });
    (list || []).forEach(function (r) { if (!have[r.sid] && out.indexOf(r.sid) < 0 && !(holds && holds[r.sid] > now)) out.push(r.sid); });
    return out;
  }
  function allFound(list, found) {
    return (list || []).every(function (r) { return (found || []).some(function (p) { return p.fSid === r.sid; }); });
  }
  // The 30-second look at a tracked looter's spot.
  function recheck(tr, pts) {
    var p = (pts || []).filter(function (q) { return q.marchId === tr.marchId; })[0];
    if (!p) return { state: 'gone', pt: null };
    return { state: p.x === tr.x && p.y === tr.y ? 'here' : 'moved', pt: p };
  }

  // Spots shared in world chat in the last 5 minutes: any position card, and coordinates typed as text.
  var SEP = /^\s*(?:[,:;\/]|\s)\s*(?:y\s*[:=]?\s*)?$/i;
  function textSpots(text) {
    var out = [], nums = [], re = /\d{1,4}/g, m;
    text = String(text || '');
    while ((m = re.exec(text))) nums.push({ v: Number(m[0]), s: m.index, e: m.index + m[0].length });
    for (var i = 0; i + 1 < nums.length; i++) {
      var a = nums[i], b = nums[i + 1];
      if (a.v <= 1200 && b.v <= 1200 && SEP.test(text.slice(a.e, b.s))) { out.push({ x: a.v, y: b.v }); i++; }
    }
    return out;
  }
  function chatSpots(rows, now) {
    var out = [];
    (rows || []).forEach(function (m) {
      if (!m) return;
      var at = Number(m._time) * 1000;
      if (!(at > now - SHARE_WINDOW_MS && at <= now + 60000)) return;
      var d = m._chatShareLinkData;
      if (d && d.t === POSITION_T && d.p && whole(d.p.x, 0, 1200) && whole(d.p.y, 0, 1200)) { var k = num(d.p.z); out.push({ x: d.p.x, y: d.p.y, k: whole(k, 1, 99999) ? k : null, at: at }); return; }
      if (typeof m._msg === 'string' && m._msg) textSpots(m._msg).forEach(function (s) { out.push({ x: s.x, y: s.y, k: null, at: at }); });
    });
    return out;
  }
  // Post only with Share on, when nobody shared that spot (3 tiles) in the last 5 minutes, 10 s after our last post.
  function shareCheck(o) {
    if (!o.on) return { ok: false, reason: 'off' };
    var near = (o.spots || []).some(function (s) {
      return s.at > o.now - SHARE_WINDOW_MS && Math.abs(s.x - o.x) <= NEAR && Math.abs(s.y - o.y) <= NEAR && (s.k == null || s.k === o.k);
    });
    if (near) return { ok: false, reason: 'shared' };
    var gap = o.gapMs || SHARE_GAP_MS;
    if (o.lastShareAt && o.now - o.lastShareAt < gap) return { ok: false, reason: 'wait', until: o.lastShareAt + gap };
    return { ok: true };
  }
  // The game's own looter share (NWorldMapCrossTreasure -> sendChatLinkBoss): title "NAME's Loot Quest Team".
  function card(pt, title, icon) {
    return { t: POSITION_T, st: BOSS_ST, p: { x: pt.x, y: pt.y, z: pt.k }, s: '', sk: String(title || ''), icon: 'image/world_unit/' + String(icon || 'cross_treasure_share') };
  }

  // Hard caps on map views, checked before every one.
  function gate(log, now, perMin, per10) {
    var a = perMin || MAX_PER_MIN, b = per10 || MAX_PER_10;
    var inMin = (log || []).filter(function (t) { return t > now - 60000; }), in10 = (log || []).filter(function (t) { return t > now - 600000; });
    if (inMin.length >= a) return { ok: false, until: inMin[0] + 60000, reason: a + ' lookups in a minute' };
    if (in10.length >= b) return { ok: false, until: in10[0] + 600000, reason: b + ' lookups in 10 minutes' };
    return { ok: true };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on (for the usage report).
  var ET_FMT = null;
  function gameDay(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return new Date(Date.UTC(+o.year, +o.month - 1, +o.day - ((+o.hour % 24) < 12 ? 1 : 0))).toISOString().slice(0, 10);
  }
  // The share delay the sharer picked (stored text or a number): whole minutes 1-5, else the default.
  function delayMinutes(v) {
    var n = Number(v);
    if (v == null || v === '' || !isFinite(n)) return DELAY_DEFAULT;
    return Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.floor(n)));
  }
  // When a tracked looter may be shared: its delay counted from `since` (found, or moved after it was shared).
  function shareAt(t, minutes, minuteMs) { return (Number(t && t.since) || 0) + minutes * minuteMs; }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function looks(p, now) {
    if (p.hideEndMs > now) return 'Invisible ' + clock(p.hideEndMs - now);
    return p.attack ? 'Attacking' : 'Visible';
  }

  var LooterCore = {
    COLS: COLS, ROWS: ROWS, TYPE: TYPE, LIST_MS: LIST_MS, RECHECK_MS: RECHECK_MS, PUSH_DELAY_MS: PUSH_DELAY_MS, HOLD_MS: HOLD_MS,
    MAX_PER_MIN: MAX_PER_MIN, MAX_PER_10: MAX_PER_10, FAILS_MAX: FAILS_MAX, PAUSE_MS: PAUSE_MS,
    SHARE_WINDOW_MS: SHARE_WINDOW_MS, NEAR: NEAR, SHARE_GAP_MS: SHARE_GAP_MS, ALLY_DELAY_MS: ALLY_DELAY_MS, BOUNCE_MS: BOUNCE_MS,
    DELAY_DEFAULT: DELAY_DEFAULT, DELAY_MIN: DELAY_MIN, DELAY_MAX: DELAY_MAX, delayMinutes: delayMinutes, shareAt: shareAt,
    passCells: passCells, inWindow: inWindow, ringCells: ringCells, points: points, crossIn: crossIn,
    lootQuestLive: lootQuestLive, nextWindow: nextWindow, missing: missing, allFound: allFound, recheck: recheck,
    textSpots: textSpots, chatSpots: chatSpots, shareCheck: shareCheck, card: card, gate: gate, gameDay: gameDay, clock: clock, looks: looks
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LooterCore;
  if (root) root.LooterCore = LooterCore;
})(typeof window !== 'undefined' ? window : null);
