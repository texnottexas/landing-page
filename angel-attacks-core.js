// angel-attacks-core.js — Angel Attacks pure rules: find the Angel event, pick the Angels to attack, the limits,
// read the game's answer to an attack, keep the sent list per event. No DOM, no game access.
// window.AngelAttacksCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var MIN_LEFT_MS = 120000, MAX_PER_MIN = 10, MAX_PER_10MIN = 40, SILENT_STOP = 3;
  var MAX_ON_WAY = 8;                                   // carrier attacks out at once: the game took 8 live (2026-10-13), more is untried

  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }
  // Protobuf Longs (uuid, expireMilli) have toNumber(); plain numbers and strings pass through.
  function num(v) { if (v && typeof v.toNumber === 'function') return v.toNumber(); var n = Number(v); return isFinite(n) ? n : 0; }

  // The Angel event (Heavy Mothership Treasure, Blade Angel's Treasure): the live activity whose extra holds the
  // Angels this player has attacked and a match group. Found by that shape, so a later round needs no change.
  function findEvent(acts, serverSec) {
    var list = Array.isArray(acts) ? acts : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && typeof a === 'object' && a.id != null && a.extra && Array.isArray(a.extra.attackMonsterIds) && a.extra.groupId != null && num(a.endtime) > serverSec) return a;
    }
    return null;
  }

  // The Angels worth an attack now, in the game's order: not attacked yet (the game's list or ours), not ours,
  // none of our marches on the way, 2+ minutes left. Each Angel once.
  function pickTargets(monsters, o) {
    var att = {}, seen = {}, out = [];
    (o.attacked || []).forEach(function (u) { att[String(u)] = 1; });
    (Array.isArray(monsters) ? monsters : []).forEach(function (m, i) {
      if (!m || typeof m !== 'object') return;
      var uuid = m.uuid == null ? '' : String(m.uuid), x = num(m.x), y = num(m.y), left = num(m.expireMilli) - o.now;
      if (!uuid || seen[uuid]) return;
      seen[uuid] = 1;
      if (!(x >= 0 && y >= 0 && x % 1 === 0 && y % 1 === 0)) return;
      if (att[uuid] || (o.sent && o.sent[uuid])) return;
      if (o.me && String(m.uid) === o.me) return;
      if (m.hasMarch) return;
      if (o.marchTiles && o.marchTiles[x + ',' + y]) return;
      if (left < MIN_LEFT_MS) return;
      out.push({ at: i, uuid: uuid, x: x, y: y, serverId: num(m.serverId), leftMs: left });
    });
    return out;
  }

  // Attacks sent (times): at most 10 a minute and 40 in 10 minutes.
  function gate(log, now) {
    var inMin = log.filter(function (t) { return t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0] + 60000, reason: '10 attacks in a minute' };
    var inTen = log.filter(function (t) { return t > now - 600000; });
    if (inTen.length >= MAX_PER_10MIN) return { ok: false, until: inTen[0] + 600000, reason: '40 attacks in 10 minutes' };
    return { ok: true };
  }

  // s 0: the attack is on its way. No answer, a timeout or a blocked send: silent. Anything else: a refusal.
  function classifyAttack(a) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent' };
    if (a.s === 0) return { kind: 'ok' };
    return { kind: 'refused', s: a.s, key: typeof a.d === 'string' ? a.d.slice(0, 80) : '' };
  }

  // Our sent list belongs to one event: a new round starts it empty.
  function sentFor(store, eventId) {
    var id = String(eventId), ok = store && typeof store === 'object' && String(store.eventId) === id && store.uuids && typeof store.uuids === 'object';
    return { eventId: id, uuids: ok ? Object.assign({}, store.uuids) : {} };
  }

  var AngelAttacksCore = {
    MIN_LEFT_MS: MIN_LEFT_MS, MAX_PER_MIN: MAX_PER_MIN, MAX_PER_10MIN: MAX_PER_10MIN, SILENT_STOP: SILENT_STOP, MAX_ON_WAY: MAX_ON_WAY,
    num: num, gameDay: gameDay, findEvent: findEvent, pickTargets: pickTargets, gate: gate, classifyAttack: classifyAttack, sentFor: sentFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = AngelAttacksCore;
  else root.AngelAttacksCore = AngelAttacksCore;
})(typeof window !== 'undefined' ? window : globalThis);
