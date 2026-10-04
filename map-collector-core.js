// map-collector-core.js — Map Collector pure rules: reading spawn notices, the claim queue,
// game answers, reward matching, march tracking, report batching and the status card.
// No DOM, no game access. window.MapCollectorCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var TOO_FAST = 'march_time_control_info001', LOCATION_ERROR = 'world_130511';
  var HOLD_MS = 10000, MAX_TOO_FAST = 3, BLOCK_MS = 1500, MAX_BLOCKED = 3;
  var MATCH_MS = 6000, MISS_AFTER_MS = 15000, NO_ARRIVAL_MISS_MS = 60000, ENDED_MISS_MS = 5000, PRIME_MS = 120000;
  var REPORT_MAX = 200, KEEP_MS = 24 * 3600e3, KEEP_MAX = 600;
  var FIRST_MIN_MS = 1500, FIRST_MAX_MS = 3500, SAME_SPOT_MS = 60000;
  var MAX_PER_MIN = 12, MAX_PER_10MIN = 40, FAIL_STREAK = 5, FAIL_PAUSE_MS = 300000;
  var NOTICE = /^([\s\S]*)'s Titan Gift Treasure Map appeared at server (\d+) \((\d+),\s*(\d+)\)\.?$/;

  function stripTags(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ''); }

  // "<color=#f77a0b>HELLFIRE</c>'s Titan Gift Treasure Map appeared at server 2864 (438, 690)."
  function parseNotice(text) {
    if (text == null) return null;
    var m = stripTags(text).trim().match(NOTICE);
    return m ? { spawner: m[1], server: +m[2], x: +m[3], y: +m[4] } : null;
  }

  // Alliance chat rows -> new spawn notices. Every unseen id is returned so the caller can mark it seen;
  // notices older than `since` (ms) are only marked seen, never claimed.
  function newNotices(rows, seen, since) {
    var notices = [], ids = [];
    (rows || []).forEach(function (r) {
      if (!r || r._msgId == null) return;
      var id = String(r._msgId);
      if (seen[id] !== undefined) return;
      ids.push(id);
      if (String(r._mt) !== '523') return;
      var p = parseNotice(r._msg), at = Number(r._time) * 1000;
      if (!p || (since && at < since)) return;
      notices.push({ id: id, noticedAt: at, spawner: p.spawner, server: p.server, x: p.x, y: p.y });
    });
    return { notices: notices, ids: ids };
  }

  function newMap(n, me, homeServer) {
    var m = { id: n.id, noticedAt: n.noticedAt, spawner: n.spawner, x: n.x, y: n.y, state: 'queued', reason: '',
      tries: 0, tooFast: 0, retryAt: 0, sentAt: 0, arriveAt: 0, marchId: '', collectedAt: 0, reward: '', rev: 0 };
    if (homeServer && n.server !== homeServer) { m.state = 'skipped'; m.reason = 'other server'; }
    else if (me && n.spawner === me) { m.state = 'skipped'; m.reason = 'your own map'; }
    return m;
  }

  // New notices -> new maps. A notice id already held is never queued again, nor a second notice at the
  // same spot within a minute; the first claim waits 1.5-3.5 s after the notice is seen (a person's pace).
  // (2026-10-04: a forgetful seen-list re-queued the same maps every few seconds and got the account
  // suspended; this is the second wall against that.)
  function admit(maps, notices, me, homeServer, now, delayFn) {
    var delay = delayFn || function () { return FIRST_MIN_MS + Math.floor(Math.random() * (FIRST_MAX_MS - FIRST_MIN_MS)); };
    var added = [];
    notices.forEach(function (n) {
      var dup = maps.some(function (m) { return m.id === n.id || (m.x === n.x && m.y === n.y && Math.abs(m.noticedAt - n.noticedAt) < SAME_SPOT_MS); });
      if (dup) return;
      var m = newMap(n, me, homeServer);
      if (m.state === 'queued') m.retryAt = now + delay();
      maps.push(m); added.push(m);
    });
    return added;
  }

  // Hard limits on claims, checked before every send: 12 a minute, 40 per 10 minutes, and five failed
  // answers in a row pause claiming for 5 minutes. sends = [{t, kind}] where kind is the answer kind.
  function gate(sends, now) {
    var inMin = sends.filter(function (x) { return x.t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0].t + 60000, reason: 'too many claims in a minute' };
    var inTen = sends.filter(function (x) { return x.t > now - 600000; });
    if (inTen.length >= MAX_PER_10MIN) return { ok: false, until: inTen[0].t + 600000, reason: 'too many claims in 10 minutes' };
    var last = sends.slice(-FAIL_STREAK);
    if (last.length === FAIL_STREAK && last.every(function (x) { return x.kind !== 'sent'; })) {
      var until = last[last.length - 1].t + FAIL_PAUSE_MS;
      if (now < until) return { ok: false, until: until, reason: 'five claims in a row failed' };
    }
    return { ok: true };
  }

  function touch(state, m) { state.rev = (state.rev || 0) + 1; m.rev = state.rev; }

  function pickNext(maps, now) {
    var wait = Infinity;
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      if (m.state !== 'queued') continue;
      if (!(m.retryAt > now)) return { map: m, wait: 0 };
      if (m.retryAt - now < wait) wait = m.retryAt - now;
    }
    return { map: null, wait: wait === Infinity ? -1 : wait };
  }

  function classifyAnswer(a) {
    if (!a || a.s === 'timeout') return { kind: 'failed', reason: 'No answer from the game' };
    if (a.s === 'blocked') return { kind: 'blocked' };
    if (a.s === 0) {
      var mi = null;
      try { mi = (typeof a.d === 'string' ? JSON.parse(a.d) : a.d).marchInfo; } catch (e) {}
      return { kind: 'sent', arriveAt: mi && mi.marchArrive ? Number(mi.marchArrive) * 1000 : 0, marchId: mi && mi.marchId != null ? String(mi.marchId) : '' };
    }
    if (a.d === TOO_FAST) return { kind: 'tooFast' };
    if (a.d === LOCATION_ERROR) return { kind: 'gone', reason: 'Location error' };
    return { kind: 'failed', reason: String(a.d || ('code ' + a.s)).slice(0, 80) };
  }

  function applyAnswer(m, c, now) {
    if (c.kind === 'sent') { m.state = 'sent'; m.arriveAt = c.arriveAt || 0; m.marchId = c.marchId || ''; return; }
    if (c.kind === 'tooFast') {
      m.tooFast = (m.tooFast || 0) + 1;
      if (m.tooFast > MAX_TOO_FAST) { m.state = 'failed'; m.reason = 'Too fast, gave up after ' + MAX_TOO_FAST + ' tries'; }
      else { m.state = 'queued'; m.retryAt = now + HOLD_MS; }
      return;
    }
    if (c.kind === 'blocked') {
      m.tries = (m.tries || 0) + 1;
      if (m.tries > MAX_BLOCKED) { m.state = 'failed'; m.reason = 'The game would not send the claim'; }
      else { m.state = 'queued'; m.retryAt = now + BLOCK_MS; }
      return;
    }
    m.state = c.kind; m.reason = c.reason || '';
  }

  // A reward names the map only by its game id; match it to the march whose arrival is closest
  // (ties: the earlier send). A reward well before every arrival means the player sped a march up:
  // give it to the earliest-scheduled march still en route.
  function matchReward(maps, at, label) {
    var best = null, bestD = Infinity, early = null;
    maps.forEach(function (m) {
      if ((m.state !== 'sent' && m.state !== 'missed') || !m.arriveAt) return;
      var d = Math.abs(m.arriveAt - at);
      if (d <= MATCH_MS && (d < bestD || (d === bestD && m.sentAt < best.sentAt))) { best = m; bestD = d; }
      if (m.state === 'sent' && m.arriveAt > at && (!early || m.arriveAt < early.arriveAt)) early = m;
    });
    var hit = best || early;
    if (!hit) return null;
    hit.state = 'collected'; hit.collectedAt = at; hit.reward = label || '';
    return hit;
  }

  // The game's own list of the player's marches ({marchId: {arriveAt}}, or null when it can't be read).
  // A listed march takes its live arrival (a speed-up moves it earlier); a march that was listed and is
  // gone has finished, and with no reward 5 s later it missed.
  function syncMarches(maps, live, now) {
    if (!live) return [];
    var changed = [];
    maps.forEach(function (m) {
      if (m.state !== 'sent' || !m.marchId) return;
      var l = live[m.marchId];
      if (l) {
        m.seenLive = true; m.endedAt = 0;
        if (l.arriveAt && l.arriveAt !== m.arriveAt) { m.arriveAt = l.arriveAt; changed.push(m); }
      } else if (m.seenLive) {
        if (!m.endedAt) m.endedAt = now;
        else if (now > m.endedAt + ENDED_MISS_MS) { m.state = 'missed'; changed.push(m); }
      }
    });
    return changed;
  }

  function sweepMissed(maps, now) {
    return maps.filter(function (m) {
      if (m.state !== 'sent') return false;
      var late = m.arriveAt ? now > m.arriveAt + MISS_AFTER_MS : now > m.sentAt + NO_ARRIVAL_MISS_MS;
      if (late) m.state = 'missed';
      return late;
    });
  }

  function toRow(m) {
    return { id: m.id, noticedAt: m.noticedAt, spawner: m.spawner, x: m.x, y: m.y, state: m.state, reason: m.reason || '',
      sentAt: m.sentAt || 0, arriveAt: m.arriveAt || 0, collectedAt: m.collectedAt || 0, reward: m.reward || '', tries: (m.tries || 0) + (m.tooFast || 0) };
  }

  function buildReport(maps, acked, max) {
    var changed = maps.filter(function (m) { return m.rev > (acked || 0); }).sort(function (a, b) { return a.rev - b.rev; }).slice(0, max || REPORT_MAX);
    return { rows: changed.map(toRow), upto: changed.length ? changed[changed.length - 1].rev : (acked || 0) };
  }
  function ackReport(state, upto) { if (upto > (state.acked || 0)) state.acked = upto; }

  function summarize(maps) {
    var s = { total: maps.length, collected: 0, missed: 0, enRoute: 0, notSent: 0, skipped: 0, queued: 0 };
    maps.forEach(function (m) {
      if (m.state === 'collected') s.collected++;
      else if (m.state === 'missed') s.missed++;
      else if (m.state === 'sent' || m.state === 'sending') s.enRoute++;
      else if (m.state === 'gone' || m.state === 'failed') s.notSent++;
      else if (m.state === 'skipped') s.skipped++;
      else if (m.state === 'queued') s.queued++;
    });
    return s;
  }

  function healthOf(h) {
    if (!h.connected) return 'disconnected';
    if (!h.visible) return 'hidden';
    return h.failing ? 'failing' : 'ok';
  }

  // The in-game status card: stats stacked one per row, a footer line and a tone for the border.
  var FOOT = { hidden: ['Tab hidden', 'warn'], failing: ['Dashboard not reachable', 'warn'], disconnected: ['Game disconnected', 'bad'] };
  function pillCard(s, left, ageS, health) {
    var f = FOOT[health], foot;
    if (f) foot = f[0];
    else if (ageS == null) foot = 'Starting...';
    else foot = ageS < 60 ? 'Reported ' + ageS + ' s ago' : 'Reported ' + Math.floor(ageS / 60) + ' min ago';
    return {
      rows: [['Collected', s.collected], ['Missed', s.missed], ['En route', s.enRoute], ['Claims left', left == null ? '?' : left]],
      foot: foot, tone: f ? f[1] : 'ok'
    };
  }

  function prune(maps, now, acked) {
    var kept = maps.filter(function (m) { return m.rev > acked || now - m.noticedAt <= KEEP_MS; });
    return kept.length > KEEP_MAX ? kept.slice(kept.length - KEEP_MAX) : kept;
  }

  var MapCollectorCore = {
    TOO_FAST: TOO_FAST, LOCATION_ERROR: LOCATION_ERROR, HOLD_MS: HOLD_MS, MISS_AFTER_MS: MISS_AFTER_MS, MATCH_MS: MATCH_MS,
    PRIME_MS: PRIME_MS, REPORT_MAX: REPORT_MAX,
    parseNotice: parseNotice, newNotices: newNotices, newMap: newMap, admit: admit, gate: gate, touch: touch, pickNext: pickNext,
    classifyAnswer: classifyAnswer, applyAnswer: applyAnswer, matchReward: matchReward, syncMarches: syncMarches,
    sweepMissed: sweepMissed, toRow: toRow, buildReport: buildReport, ackReport: ackReport, summarize: summarize,
    healthOf: healthOf, pillCard: pillCard, prune: prune
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MapCollectorCore;
  else root.MapCollectorCore = MapCollectorCore;
})(typeof window !== 'undefined' ? window : globalThis);
