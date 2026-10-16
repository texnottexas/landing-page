// odin-gather-core.js — Odinium Gatherer (Tex 2026-10-16): pure rules. The facilities come from the game's Alliance
// Log (its Lv. 3 Refine Center entries) and its map view; a march takes the game's own gathering hero and troop picks
// (QuickArmyEnterBtn), trimmed so it fills at, or up to an hour after, the facility's time left. The load and time
// math is the deploy screen's own (NBattleEmPanelNew.checkPower). window.OdinGatherCore in the browser,
// module.exports for node tests.
(function (root) {
  'use strict';

  var BID = 71003;                                        // map_building: Lv. 3 Refine Center (Odinium)
  var DURATION = 36000;                                   // a facility lasts 10 h after it's completed
  var LOG_TYPE = 10;                                      // Alliance Log record type of a Refine Center
  var SLOT_POS = [1, 2, 3, 11, 12, 13, 21, 22, 23];
  var MAX_OVER = 3600;                                    // a march may fill up to an hour after the facility ends (Tex)
  var CAPS = {                                            // per kind: [count, window ms, words]
    march: [[10, 60000, '10 marches a minute'], [20, 600000, '20 marches per 10 minutes']],   // never below a player's march count (Tex: 7 out of 7)
    view: [[10, 600000, '10 map looks per 10 minutes']],
    info: [[20, 600000, '20 facility checks per 10 minutes']],
    skin: [[6, 3600000, '6 skin changes an hour']]   // a base skin change shows on the map: never a flicker (review C2)
  };

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // The log's message template ("Well done! The Lv. {4} {5} ({2},{3}) built by {0} - {1} is completed.") as a regex.
  function templateRe(tmpl) {
    var parts = { '0': '(.*?)', '1': '(.*?)', '2': '(\\d+)', '3': '(\\d+)', '4': '(\\d+)', '5': '(.+?)' }, order = [];
    var src = esc(tmpl || '').replace(/\\\{(\d)\\\}/g, function (m, d) { order.push(d); return parts[d] || '(.*?)'; });
    return { re: new RegExp('^' + src + '$'), order: order };
  }
  // The Alliance Log's Refine Center entries: the wanted level (3), under 10 h old, newest first, one per tile.
  function logFacilities(records, tmpl, nowSec, o) {
    o = o || {};
    var want = num(o.level, 3), t = templateRe(tmpl), seen = {}, out = [];
    (Array.isArray(records) ? records.slice() : [])
      .filter(function (r) { return r && Number(r.type) === LOG_TYPE && Array.isArray(r.targetPosArr) && r.targetPosArr[0]; })
      .sort(function (a, b) { return num(b.tampTime, 0) - num(a.tampTime, 0); })
      .forEach(function (r) {
        var at = num(r.tampTime, 0), p = r.targetPosArr[0], x = num(p.x, -1), y = num(p.y, -1), k = x + ',' + y;
        if (seen[k] || x < 0 || y < 0 || !(nowSec - at < DURATION)) return;
        var m = t.re.exec(String(r.msg || '').trim());
        if (!m) return;
        var f = {}; t.order.forEach(function (d, i) { f[d] = m[i + 1]; });
        if (num(f['4'], 0) !== want) return;
        seen[k] = 1;
        out.push({ x: x, y: y, level: want, builder: String(f['1'] || '').trim(), at: at });
      });
    return out;
  }

  // The map view's own-alliance, completed Lv. 3 Refine Centers. Player ids in the answer are never kept.
  function towersInView(answer, aid) {
    var d = answer && answer.d;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    var list = d && Array.isArray(d.pointList) ? d.pointList : [];
    return list.filter(function (p) {
      var b = p && p.b;
      return b && Number(p.pointType) === 24 && Number(b.bid) === BID && Number(b.st) === 3 && Number(b.aid) === Number(aid);
    }).map(function (p) { return { x: num(p.x, 0), y: num(p.y, 0), id: String(p.b.id), bid: BID, st: 3 }; });
  }

  function timeLeft(btime, nowSec, duration) { return Math.max(0, num(duration, DURATION) - (num(nowSec, 0) - num(btime, 0))); }

  // Odinium per second: (resource speed x the facility's coefficient + flat buffs) x (1 + buffs % + heroes %).
  function speedOf(o) {
    var base = num(o.gatherSpeed, 0) * num(o.coefficient, 1) + num(o.addFlat, 0);
    return base > 0 ? base * (1 + num(o.pct, 0) + num(o.heroPct, 0)) : 0;
  }
  // The deploy screen's "Current load" and "Predicted gathering time".
  function predict(o) {
    var sum = (o.unitLoads || []).reduce(function (s, v) { return s + num(v, 0); }, 0) + num(o.loadAdd, 0) * (1 + num(o.u, 0));
    var load = Math.floor(sum / num(o.loadFactor, 40000)), sp = num(o.speed, 0);
    return { load: load, seconds: sp > 0 ? Math.ceil(load / sp) : 0 };
  }

  // The game's gathering troop pick (QuickArmyEnterBtn.pickArmy, gathering branch), stopped as soon as the march would
  // gather for the facility's time left. units: [{armyID, power, type, mecha, thor, battleMecha, load}].
  function planTroops(units, o) {
    o = o || {};
    var heal = o.healing || {}, cat = function (a) { return a.thor > 0 ? 1 : a.mecha > 0 ? 2 : 0; };
    var F = (Array.isArray(units) ? units : []).filter(function (a) { return a && typeof a === 'object' && !(a.mecha && heal[a.mecha]); });
    F.sort(function (e, t) {                              // weakest first: the game takes from the end
      if (e.power !== t.power) return e.power - t.power;
      if (e.type !== t.type) return t.type - e.type;
      return e.armyID - t.armyID;
    });
    if (o.oneKey) F.sort(function (e, t) { var a = cat(e), b = cat(t); return a !== b ? b - a : 0; });   // normal, then Valhalla, then HT
    var slots = Array.isArray(o.slots) ? o.slots : [], W = num(o.free, 0), target = num(o.target, 0), x = [], H = 0, q = 0, mechaSlot = false, done = false;
    function secs() { return predict({ unitLoads: [H], loadAdd: o.loadAdd, u: o.u, loadFactor: o.loadFactor, speed: o.speed }).seconds; }
    function add(slot, a) { slot.push(a); H += num(a.load, 0); q++; if (target > 0 && secs() >= target) done = true; }
    for (var S = 0; S < slots.length && S < SLOT_POS.length && F.length > 0 && !(W && q >= W) && !done; S++) {
      x[S] = x[S] || [];
      var cap = num(slots[S], 0), slot = x[S];
      if (cap <= 0) continue;
      if (!slot.length) add(slot, F.pop());
      var id = slot[slot.length - 1].armyID;
      for (var B = F.length - 1; B >= 0 && !(slot.length >= cap || (W && q >= W) || done); B--) {
        if (F[B].armyID === id) { add(slot, F[B]); F.splice(B, 1); }
        else {
          if (F[B].power !== slot[0].power) break;
          slot.forEach(function (a) { H -= num(a.load, 0); q--; });   // same power, another kind: the game starts the slot over with it
          x[S] = slot = [];
          done = false;
          add(slot, F[B]); id = F[B].armyID; F.splice(B, 1);
        }
      }
      if (slot[0] && slot[0].battleMecha) {               // one Heavy Trooper slot
        if (mechaSlot) { slot.forEach(function (a) { H -= num(a.load, 0); q--; }); x[S] = []; done = false; S--; }
        else mechaSlot = true;
      }
    }
    var army = [];
    x.forEach(function (s, i) { if (s && s.length) army.push({ pos: SLOT_POS[i], armyId: s[0].armyID, armyNum: s.length }); });
    var p = predict({ unitLoads: [H], loadAdd: o.loadAdd, u: o.u, loadFactor: o.loadFactor, speed: o.speed });
    return { army: army, units: q, load: p.load, seconds: p.seconds };
  }

  // The game's gathering hero pick: the best gatherers by the summed gathering buffs.
  function pickHeroes(pool, o) {
    var max = num(o && o.max, 3);
    return (Array.isArray(pool) ? pool.slice() : []).sort(function (a, b) { return num(b.score, 0) - num(a.score, 0); })
      .slice(0, max).map(function (h) { return h.id; });
  }

  // The most time left first, then down (Tex 2026-10-16): the first march takes the best gatherers, so the strongest
  // march gets the longest facility. Ties: more room first.
  function rank(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      var la = num(a.left, 0), lb = num(b.left, 0);
      return lb !== la ? lb - la : num(b.free, 0) - num(a.free, 0);
    });
  }

  function gate(log, now, kind) {
    var caps = CAPS[kind] || [];
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i], inWin = (log || []).filter(function (e) { return e && e.kind === kind && now - e.t < c[1]; });
      if (inWin.length >= c[0]) {
        var oldest = Math.min.apply(null, inWin.map(function (e) { return e.t; }));
        return { ok: false, reason: c[2], until: oldest + c[1] };
      }
    }
    return { ok: true };
  }

  function classify(a) {
    if (!a || a.timeout) return 'silent';
    return a.s === 0 ? 'ok' : 'refused';
  }

  // The owned skin with the biggest gathering bonus, when it beats the one worn. owned: [{id, pct}].
  function bestSkin(owned, current) {
    var list = (Array.isArray(owned) ? owned : []).filter(function (s) { return s && num(s.pct, 0) > 0; });
    if (!list.length) return null;
    var best = list.slice().sort(function (a, b) { return num(b.pct, 0) - num(a.pct, 0); })[0];
    var worn = list.filter(function (s) { return Number(s.id) === Number(current); })[0];
    if (worn && num(worn.pct, 0) >= num(best.pct, 0)) return null;
    return { id: best.id, pct: best.pct };
  }

  var OdinGatherCore = {
    BID: BID, DURATION: DURATION, LOG_TYPE: LOG_TYPE, SLOT_POS: SLOT_POS, MAX_OVER: MAX_OVER, CAPS: CAPS,
    logFacilities: logFacilities, towersInView: towersInView, timeLeft: timeLeft, speedOf: speedOf, predict: predict,
    planTroops: planTroops, pickHeroes: pickHeroes, rank: rank, gate: gate, classify: classify, bestSkin: bestSkin, gameDay: gameDay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = OdinGatherCore;
  else root.OdinGatherCore = OdinGatherCore;
})(typeof window !== 'undefined' ? window : this);
