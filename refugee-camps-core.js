// refugee-camps-core.js — Refugee Camps pure rules: the settings, Quick Deploy's picks for a rally (heroes, then
// troops; copied from the game's QuickArmyEnterBtn), the rally request, the VIT refill order, the march check, the
// runaway guard, the game's answers and the camp list. No DOM, no game access.
// window.RefugeeCampsCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var LETTER = 1700039, SMALL = 600001, LARGE = 600002, BUY_PRICE = 50;
  var GAP_MS = 1500;                                    // one request at a time, 1.5 s after the last one (Tex, 2026-10-13)
  var MAX_PER_MIN = 20;                                 // a runaway guard only: Tex sends up to 14 a minute by hand
  // A rally the game's march count didn't show within the settle counts as out on top of it for this long at most.
  // The game counts its own rallies within ~60 ms (live); a count that stays flat almost always means another march
  // came home at that moment, so a longer hold counted the rally twice (Tex: "6 of 6 out" with 5 out).
  var UNSHOWN_MS = 10000;
  var SLOT_POS = [1, 2, 3, 11, 12, 13, 21, 22, 23];     // troop slot -> pos in the rally request (9 slots)
  var MAP_MAX = 1200;
  var MAX_MARCHES = 10;                                 // the card's ceiling: a march count the game reads low for a moment
                                                        // (a buff's extra march) must not cap the player's choice

  var ET_FMT = null;
  function etParts(ms) {
    if (!ET_FMT) ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    var o = {}; ET_FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24 };
  }
  // The game day runs from reset (12:00 ET) to reset, named by the date it starts on.
  function gameDay(ms) { var p = etParts(ms); return new Date(Date.UTC(p.y, p.mo - 1, p.d - (p.h < 12 ? 1 : 0))).toISOString().slice(0, 10); }

  function int(v, d) { var n = Math.floor(Number(v)); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi, d) { return Math.min(hi, Math.max(lo, int(v, d))); }
  // The card's settings: marches 1..10 (more if the player has more; each step of a run uses no more than the player
  // has right then), camps 1..letters held.
  function clampSettings(s, lim) {
    s = s && typeof s === 'object' ? s : {};
    var mmax = Math.max(MAX_MARCHES, int(lim && lim.marchMax, 1)), lmax = Math.max(1, int(lim && lim.letters, 1));
    return { marches: clamp(s.marches, 1, mmax, 1), camps: clamp(s.camps, 1, lmax, Math.min(10, lmax)), buy: s.buy !== false,
      small: clamp(s.small, 0, 999, 0), large: clamp(s.large, 0, 999, 0) };
  }

  function heroCmp(a, b) { return a.quality !== b.quality ? a.quality - b.quality : a.star !== b.star ? a.star - b.star : a.level !== b.level ? a.level - b.level : a.power - b.power; }
  // Quick Deploy's heroes for a rally (pickHeroFieldScene, then pickHeroBattleScene). pool: the game's enabled
  // heroes in its order. o.first: data_config 2021116 (Diana, Amalia, ...); o.orange: HeroQuality.Orange;
  // o.pairThird: the extra-hero buff; o.exclude: the game checks excluded pairs; o.busy: heroes out on a march.
  function pickHeroes(pool, o) {
    var max = int(o.max, 3), picked = [], byId = {};
    var u = (Array.isArray(pool) ? pool : []).filter(function (h) { return h && typeof h === 'object'; });
    u.forEach(function (h) { byId[h.id] = h; });
    u = u.slice().sort(heroCmp);                          // weakest first: the game takes from the end
    var trial = u.filter(function (h) { return h.tryOut; }).length, keep = trial < max ? 0 : 1;
    u = u.filter(function (h) { return (h.tryOut ? 1 : 0) === keep; });
    function clash(h) {                                   // excluded with a hero already picked
      if (!o.exclude) return false;
      return picked.some(function (pid) { var p = byId[pid] || {}; return (p.exclude && p.exclude === h.id) || (h.exclude && h.exclude === p.id); });
    }
    var first = (o.first || []).map(Number);
    var cand = u.filter(function (h) { return first.indexOf(h.id) >= 0; }).sort(heroCmp);
    for (var r = cand.length - 1; r >= 0 && picked.length < max; r--) {
      var c = cand[r];
      if (o.exclude && ((c.exclude && o.busy && o.busy[c.exclude]) || clash(c))) continue;
      picked.push(c.id); u.splice(u.indexOf(c), 1);
    }
    // then the strongest; with 4+ orange heroes the 2nd is of the 1st's type, the 3rd of the 2nd's with the buff
    var orangeLeft = u.filter(function (h) { return h.quality === o.orange; }).length;
    function takeType(t) {
      for (var i = u.length - 1; i >= 0; i--) if (u[i].type === t) { var n = u[i]; u.splice(i, 1); if (!clash(n)) return n; }
      return null;
    }
    while (picked.length < max && u.length > 0) {
      if (clash(u[u.length - 1])) { u.pop(); continue; }
      var pairWith = orangeLeft >= 4 ? (picked.length === 1 ? picked[0] : picked.length === 2 && o.pairThird ? picked[1] : null) : null;
      var got = pairWith != null ? takeType(byId[pairWith].type) : null;
      if (!got) { if (!u.length) break; got = u.pop(); }
      picked.push(got.id);
    }
    return picked;
  }

  // Quick Deploy's troops (pickArmy, general branch). units: the game's free units, one entry each, in its order.
  // o.heroTypes: the picked heroes' types in pick order; o.slots: units per slot (getMaxCoutByPos for those heroes);
  // o.levelWindow: data_config 2021115; o.mechaOn; o.healing / o.mechaPower: by Heavy Trooper id.
  function pickTroops(units, o) {
    o = o || {};
    var heal = o.healing || {}, mpow = o.mechaPower || {};
    var F = (Array.isArray(units) ? units : []).filter(function (a) { return a && typeof a === 'object' && !(a.mecha && heal[a.mecha]); });
    var best = {};
    F.forEach(function (a) { if (!best[a.type] || best[a.type] < a.level) best[a.type] = a.level; });
    var mp = function (a) { return mpow[a.mecha] || 0; };
    F.sort(function (e, t) {                              // weakest first: the game takes from the end
      if (e.power !== t.power) return e.power - t.power;
      if (e.type !== t.type) return t.type - e.type;
      if (!o.mechaOn || e.mecha === t.mecha) return e.armyID - t.armyID;
      if (e.mecha && t.mecha) return mp(e) === mp(t) ? e.armyID - t.armyID : mp(e) - mp(t);
      return e.mecha - t.mecha;
    });
    var pref = [], win = int(o.levelWindow, 0);
    (o.heroTypes || []).forEach(function (ht) {
      var t = 100 * (ht + 1) + 1, l = F.filter(function (a) { return a.type === t && a.level >= best[t] - win; });
      if (l.length) pref.push(l);
    });
    function take(e, slot, cap) {                         // the game's fill: one unit kind per slot, strongest first
      if (e === F) e = F.slice();
      if (!e.length) return;
      if (!slot.length) { var a = e.pop(), k = F.indexOf(a); if (k >= 0) F.splice(k, 1); slot.push(a); }
      var id = slot[slot.length - 1].armyID;
      for (var n = e.length - 1; n >= 0 && slot.length < cap && e[n].armyID === id; n--) {
        slot.push(e[n]); var j = F.indexOf(e[n]); if (j >= 0) F.splice(j, 1); e.splice(n, 1);
      }
    }
    var slots = Array.isArray(o.slots) ? o.slots : [], x = [], mechaSlot = false;
    for (var y = 0; y < slots.length && y < SLOT_POS.length; y++) {
      x[y] = x[y] || [];
      if (F.length <= 0) break;
      var cap = int(slots[y], 0), slot = x[y];
      if (cap > 0) {
        pref.forEach(function (list) { if (slot.length < cap && list.length > 0) take(list, slot, cap); });
        if (slot.length < cap) take(F, slot, cap);
      }
      if (slot[0] && slot[0].battleMecha) { if (mechaSlot) { x[y] = []; y--; } else mechaSlot = true; }   // one Heavy Trooper slot
    }
    var out = [];
    x.forEach(function (s, i) { if (s && s.length) out.push({ pos: SLOT_POS[i], armyId: s[0].armyID, armyNum: s.length }); });
    return out;
  }

  function copy(a) { return { pos: a.pos, armyId: a.armyId, armyNum: a.armyNum }; }
  // The rally (1201) the game's start button sends for a camp, with the 3-minute timer.
  function rallyRequest(camp, heroes, army) {
    return { marchType: 8, x: camp.x, y: camp.y, time: 180, armyList: army.map(copy), armyListNew: army.map(copy), heroList: heroes.slice(), trapList: [], formation: 0, formationV2: 0 };
  }

  // The VIT buy's price today: data_config 5041 ("50|200|500|500|1000") by buys so far.
  function buyPrice(cfg, buys) {
    var list = String(cfg == null ? '' : cfg).split('|').map(Number).filter(function (n) { return n > 0; });
    return list.length ? list[Math.min(Math.max(0, int(buys, 0)), list.length - 1)] : null;
  }
  // What to do when VIT is short of the camp's cost: the 50-gem buy, then Small, then Large, then stop.
  function refill(st, set, used) {
    used = used || {};
    if (st.point >= st.cost) return { act: 'none' };
    if (set.buy && st.buys === 0 && st.price === BUY_PRICE && st.gems >= BUY_PRICE && st.point < st.max) return { act: 'buy' };
    if ((used.small || 0) < set.small && st.small > 0) return { act: 'small' };
    if ((used.large || 0) < set.large && st.large > 0) return { act: 'large' };
    return { act: 'stop', reason: 'out of VIT (your limits are used up)' };
  }

  // A march is free for a rally: all of the player's marches count (gatherers too), plus our own rallies the game
  // doesn't show in its count yet.
  function marchFree(used, max, want, own) { return int(used, 0) + int(own, 0) < Math.min(int(want, 1), int(max, 0)); }

  function gate(log, now) {
    var inMin = log.filter(function (t) { return t > now - 60000; });
    if (inMin.length >= MAX_PER_MIN) return { ok: false, until: inMin[0] + 60000, reason: MAX_PER_MIN + ' rallies in a minute' };
    return { ok: true };
  }

  // s 0: done. No answer, a timeout or a blocked send: silent. Anything else: a refusal.
  function classify(a) {
    if (!a || a.s === 'timeout' || a.s === 'blocked') return { kind: 'silent' };
    if (a.s === 0) return { kind: 'ok' };
    return { kind: 'refused', s: a.s, key: typeof a.d === 'string' ? a.d.slice(0, 80) : '' };
  }
  function lettersLeft(d) { return d && typeof d.amount === 'number' ? d.amount : null; }

  // The camps the game lists (GetRefugee 1021: {points: [{x, y}]}), whole tiles on the map only.
  function campPoints(d) {
    var list = d && Array.isArray(d.points) ? d.points : [], out = [];
    list.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var x = Number(p.x), y = Number(p.y);
      if (x % 1 === 0 && y % 1 === 0 && x >= 0 && y >= 0 && x <= MAP_MAX && y <= MAP_MAX) out.push({ x: x, y: y });
    });
    return out;
  }
  function key(p) { return p.x + ',' + p.y; }
  function newCamps(points, seen) { return points.filter(function (p) { return !seen[key(p)]; }); }
  function summary(n) { return 'Rallied ' + n + ' camp' + (n === 1 ? '' : 's') + '.'; }

  var RefugeeCampsCore = {
    LETTER: LETTER, SMALL: SMALL, LARGE: LARGE, BUY_PRICE: BUY_PRICE, GAP_MS: GAP_MS, MAX_PER_MIN: MAX_PER_MIN, UNSHOWN_MS: UNSHOWN_MS, SLOT_POS: SLOT_POS, MAP_MAX: MAP_MAX, MAX_MARCHES: MAX_MARCHES,
    gameDay: gameDay, clampSettings: clampSettings, pickHeroes: pickHeroes, pickTroops: pickTroops, rallyRequest: rallyRequest, buyPrice: buyPrice,
    refill: refill, marchFree: marchFree, gate: gate, classify: classify, lettersLeft: lettersLeft, campPoints: campPoints, key: key, newCamps: newCamps, summary: summary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RefugeeCampsCore;
  else root.RefugeeCampsCore = RefugeeCampsCore;
})(typeof window !== 'undefined' ? window : globalThis);
