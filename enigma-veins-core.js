// enigma-veins-core.js — Enigma Veins pure rules: find the Enigma Field Hunt, pick the veins to mine, the limits,
// read the game's answer to a march, keep the sent list per event. No DOM, no game access.
// window.EnigmaVeinsCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var TYPE = 279, UI_TYPE = 'domainTreasure';            // the event's activity type and screen (2026-10-14)
  var MIN_LEFT_MS = 300000, MAX_PER_MIN = 10, MAX_PER_10MIN = 40, MAX_OUT = 6;
  var TIME_KEY = 'field_lottery_37';                     // "Not enough time remaining on the Vein to start a march."

  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }
  // Protobuf Longs (expireTimeMilli) have toNumber(); plain numbers and strings pass through.
  function num(v) { if (v && typeof v.toNumber === 'function') return v.toNumber(); var n = Number(v); return isFinite(n) ? n : 0; }

  // The Enigma Field Hunt running now: activity type 279 (screen domainTreasure), between its begin and end.
  function findEvent(acts, serverSec) {
    var list = Array.isArray(acts) ? acts : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a !== 'object' || a.id == null) continue;
      if (num(a.type) !== TYPE && a.showUiType !== UI_TYPE) continue;
      if (num(a.begintime) <= serverSec && serverSec < num(a.endtime)) return a;
    }
    return null;
  }
  // The most of the player's own vein marches out at once: the event's para6 (6 live), else 6.
  function maxOut(ev) { var n = Number(ev && ev.para6); return ev && ev.para6 !== '' && ev.para6 != null && n >= 1 && n <= 20 && n % 1 === 0 ? n : MAX_OUT; }
  // A vein is its tile and its end: a new vein can come up on an ended one's tile.
  function veinKey(v) { return num(v.x) + ',' + num(v.y) + ',' + Math.floor(num(v.expireTimeMilli) / 1000); }

  // The veins worth a march now, least time left first: the game says this player hasn't mined or marched to it
  // (gatherStatus 0), more than 5 minutes left (Tex), not in our sent list, no march of ours to that tile.
  function pickVeins(list, o) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (v, i) {
      if (!v || typeof v !== 'object') return;
      var x = num(v.x), y = num(v.y), key = veinKey(v), left = num(v.expireTimeMilli) - o.now;
      if (seen[key]) return;
      seen[key] = 1;
      if (!(x >= 0 && y >= 0 && x % 1 === 0 && y % 1 === 0)) return;
      if (v.gatherStatus == null || num(v.gatherStatus) !== 0) return;
      if (!(left > MIN_LEFT_MS)) return;
      if (o.sent && o.sent[key]) return;
      if (o.marchTiles && o.marchTiles[x + ',' + y]) return;
      out.push({ at: i, key: key, x: x, y: y, leftMs: left });
    });
    return out.sort(function (a, b) { return a.leftMs - b.leftMs; });
  }

  // What the card shows: veins up, mined by this player, on the way or mining.
  function counts(list, now) {
    var c = { up: 0, mined: 0, busy: 0 };
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (!v || typeof v !== 'object' || num(v.expireTimeMilli) <= now) return;
      c.up++;
      var s = num(v.gatherStatus);
      if (s === 2) c.mined++; else if (s === 1 || s === 3) c.busy++;
    });
    return c;
  }

  // Marches sent (times): at most 10 a minute and 40 in 10 minutes.
  function gate(log, now) {
    var inMin = log.filter(function (t) { return t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0] + 60000, reason: '10 marches in a minute' };
    var inTen = log.filter(function (t) { return t > now - 600000; });
    if (inTen.length >= MAX_PER_10MIN) return { ok: false, until: inTen[0] + 600000, reason: '40 marches in 10 minutes' };
    return { ok: true };
  }

  // s 0: the march is on its way. No answer, a timeout or a blocked send: silent. The game's "not enough time on the
  // vein" (its key, or its words): time, skip that vein. Anything else: a refusal. text: the game's words for d.
  function classify(a, text) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent' };
    if (a.s === 0) return { kind: 'ok' };
    var key = typeof a.d === 'string' ? a.d.slice(0, 80) : '';
    if (key === TIME_KEY || /not enough time/i.test(String(text || ''))) return { kind: 'time', s: a.s, key: key };
    return { kind: 'refused', s: a.s, key: key };
  }

  // Our sent list belongs to one event; a vein's entry goes once the vein has ended.
  function sentFor(store, eventId, now) {
    var id = String(eventId), keys = {};
    if (store && typeof store === 'object' && String(store.eventId) === id && store.keys && typeof store.keys === 'object') {
      Object.keys(store.keys).forEach(function (k) { if (Number(k.split(',')[2]) * 1000 > now) keys[k] = store.keys[k]; });
    }
    return { eventId: id, keys: keys };
  }

  var EnigmaVeinsCore = {
    TYPE: TYPE, UI_TYPE: UI_TYPE, MIN_LEFT_MS: MIN_LEFT_MS, MAX_PER_MIN: MAX_PER_MIN, MAX_PER_10MIN: MAX_PER_10MIN, MAX_OUT: MAX_OUT, TIME_KEY: TIME_KEY,
    num: num, gameDay: gameDay, findEvent: findEvent, maxOut: maxOut, veinKey: veinKey, pickVeins: pickVeins, counts: counts,
    gate: gate, classify: classify, sentFor: sentFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = EnigmaVeinsCore;
  else root.EnigmaVeinsCore = EnigmaVeinsCore;
})(typeof window !== 'undefined' ? window : globalThis);
