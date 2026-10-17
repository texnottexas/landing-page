// decor-core.js — the Decor Optimizer's rules (Tex 2026-10-17): what a decor copy is worth, how the game counts decor,
// and (in later sections) the merge plan, Advanced Upgrades, homes and the full plan. Pure: it reads a snapshot from
// decor-game.js and sends nothing. window.DecorCore in the browser, module.exports in node.
(function () {
  'use strict';
  var GOLD = [920900, 921001, 970009];                      // gold production, gold protection, Gold Harvester quick collect (Tex: not needed)
  var REPAIR = 921002;                                      // repair speed: Green Apple Trees, ranked last (Tex)
  var MARCH = 960012;
  var UNIT_KEY = { 1: 'army', 2: 'navy', 3: 'air' };
  // The armory's decor weights and stat classes (pages/tw-game-data.js BO_STAT_WEIGHTS / BO_SCOPE_MULT and
  // pages/armory-core.js DECOR_CLASS), so decor advice on the site keeps one score. A parity test guards the copy.
  var WEIGHTS = { atk: 1, hp: 1.05, dmgInc: 9, dmgDec: 9, def: 20, march: 30 };
  var SCOPE = { always: 1, offensive: 0.5, defensive: 0.5 };
  var CLASS = {
    '930000': ['hp', 0, 'always', 'All units HP'],
    '930001': ['hp', 1, 'always', 'Army HP'],
    '930002': ['hp', 2, 'always', 'Navy HP'],
    '930003': ['hp', 3, 'always', 'Air Force HP'],
    '930100': ['atk', 0, 'always', 'All units Attack'],
    '930101': ['atk', 1, 'always', 'Army Attack'],
    '930102': ['atk', 2, 'always', 'Navy Attack'],
    '930103': ['atk', 3, 'always', 'Air Force Attack'],
    '960012': ['march', 0, 'always', 'March Size'],
    '980204': ['dmgDec', 0, 'always', 'Decreased DMG Taken'],
    '990100': ['atk', 0, 'offensive', 'All units Attack (offense)'],
    '990202': ['def', 0, 'always', 'All units Defense'],
    '1001001': ['dmgInc', 0, 'always', 'All units DMG increase'],
    '1003020': ['dmgDec', 1, 'always', 'Army Decreased DMG Taken'],
    '1003021': ['dmgDec', 2, 'always', 'Navy Decreased DMG Taken'],
    '1003022': ['dmgDec', 3, 'always', 'Air Decreased DMG Taken'],
    '9301160': ['atk', 0, 'always', 'All units Attack'],
    '9301161': ['atk', 1, 'always', 'Army Attack'],
    '9301162': ['atk', 2, 'always', 'Navy Attack'],
    '9301163': ['atk', 3, 'always', 'Air Force Attack'],
    '9301164': ['atk', 0, 'offensive', 'All units Attack (offense)'],
    '9301170': ['hp', 0, 'always', 'All units HP'],
    '9301171': ['hp', 1, 'always', 'Army HP'],
    '9301172': ['hp', 2, 'always', 'Navy HP'],
    '9301173': ['hp', 3, 'always', 'Air Force HP'],
    '9301174': ['hp', 0, 'defensive', 'All units HP (defense)'],
    '9990769': ['hp', 0, 'offensive', 'All units HP (offense)'],
    '10030201': ['dmgDec', 1, 'always', 'Army Decreased DMG Taken'],
    '20030201': ['dmgDec', 1, 'always', 'Army Decreased DMG Taken'],
    '21010161': ['dmgDec', 2, 'always', 'Navy Decreased DMG Taken'],
    '29801011': ['dmgInc', 1, 'always', 'Army DMG increase'],
    '29801021': ['dmgInc', 2, 'always', 'Navy DMG increase'],
    '29901301': ['dmgDec', 0, 'defensive', 'Decreased DMG Taken (def.)'],
    '29902211': ['dmgDec', 0, 'offensive', 'Decreased DMG Taken (off.)'],
    '93011601': ['atk', 0, 'always', 'All units Attack'],
    '93011701': ['hp', 0, 'always', 'All units HP'],
    '98020501': ['dmgDec', 0, 'defensive', 'Decreased DMG Taken (def.)']
  };

  // ---------------------------------------------------------------- what a copy is worth
  function unitOn(snap, buffId, settings) {
    var s = snap.stats[buffId], k = s && UNIT_KEY[s.unit];
    return !k || !settings || settings[k] !== false;
  }
  // tier 0 March Size, 1 every other wanted stat (Tex: as important as battle stats), 2 repair speed only, 3 not wanted
  // (gold, a unit type switched off, or no stats at all). points: the armory's battle score, the tie-break.
  function copyInfo(snap, id, settings) {
    var r = snap.rows[id];
    if (!r) return { wanted: false, tier: 3, cells: 1, points: 0 };
    var want = r.buffs.filter(function (b) { return GOLD.indexOf(b[0]) < 0 && unitOn(snap, b[0], settings); });
    var points = 0;
    want.forEach(function (b) {
      var c = CLASS[String(b[0])];
      if (c) points += (c[0] === 'march' ? b[1] : b[1] / 100) * WEIGHTS[c[0]] * SCOPE[c[2]];
    });
    var tier = !want.length ? 3 : want.some(function (b) { return b[0] === MARCH; }) ? 0 : want.every(function (b) { return b[0] === REPAIR; }) ? 2 : 1;
    return { wanted: want.length > 0, tier: tier, cells: r.w * r.h, points: points };
  }

  // ---------------------------------------------------------------- how the game counts (updateBuildBuffInfo)
  // The copies the game pools, in its order: base, completed-set bag copies, showcase, collab box.
  function pool(snap) {
    var out = [], sets = {};
    (snap.sets || []).forEach(function (g) { sets[g] = 1; });
    function add(id, n, where, ref) { var r = snap.rows[id]; if (r) out.push({ id: id, group: r.group, level: r.level, n: n, where: where, ref: ref }); }
    snap.placed.forEach(function (p) { add(p.id, 1, 'base', p.uuid); });
    snap.bag.forEach(function (b) { var r = snap.rows[b.id]; if (r && sets[r.group]) add(b.id, b.n, 'setbag', null); });
    snap.showcase.forEach(function (l) { l.items.forEach(function (e) { add(e.id, 1, 'showcase', { labelId: l.labelId, uuid: e.uuid, x: e.x, y: e.y }); }); });
    snap.collab.forEach(function (c) { if (c.id) add(c.id, 1, 'collab', c.slot); });
    return out;
  }
  // The game's exclusivity pool: per group the highest level seen; a mutually exclusive partner at or below it loses.
  function exclusive(snap, entries) {
    var ex = {};
    entries.forEach(function (e) {
      var me = snap.rows[e.id].me;
      if (!me.length) return;
      if (ex[e.group] && ex[e.group].level >= e.level) return;
      ex[e.group] = { level: e.level, exclusived: false };
      me.forEach(function (g) { if (ex[g]) { if (ex[g].level <= e.level) ex[g].exclusived = true; else ex[e.group].exclusived = true; } });
    });
    return ex;
  }
  function counted(snap) {
    var entries = pool(snap), ex = exclusive(snap, entries);
    var sorted = entries.slice().sort(function (a, b) { return a.group !== b.group ? a.group - b.group : b.level - a.level; });
    var k = {}, byGroup = {}, waste = [], buffs = {};
    sorted.forEach(function (e) {
      var r = snap.rows[e.id], have = k[e.group] || 0;
      var v = ex[e.group] && ex[e.group].exclusived ? 0 : Math.max(0, Math.min(e.n, r.cap - have));
      if (v > 0) {
        k[e.group] = have + v;
        (byGroup[e.group] = byGroup[e.group] || []).push({ id: e.id, level: e.level, where: e.where, ref: e.ref, n: v });
        r.buffs.forEach(function (b) { buffs[b[0]] = (buffs[b[0]] || 0) + b[1] * v; });
      }
      if (v < e.n) waste.push({ id: e.id, group: e.group, level: e.level, n: e.n - v, where: e.where, ref: e.ref });
    });
    return { byGroup: byGroup, waste: waste, buffs: buffs };
  }

  // ---------------------------------------------------------------- even merges (copies only, never shards: Tex)
  // k copies of a level from spare copies {lv: n}: spares of that level first, the rest made from 3 each of the level
  // below, recursively. merges {lv: n} = merges done at lv (3 x lv -> 1 x lv+1). Nothing changes when it can't.
  function makeCopies(spare, level, k) {
    var use = {}, merges = {}, need = k;
    for (var lv = level; lv >= 1; lv--) {
      var take = Math.min(spare[lv] || 0, need);
      if (take) use[lv] = take;
      need -= take;
      if (!need) return { ok: true, use: use, merges: merges };
      if (lv === 1) break;
      merges[lv - 1] = need;
      need *= 3;
    }
    return { ok: false, use: {}, merges: {} };
  }
  // At equal levels the copy that stays is the one taking no base space: collab box, then showcase, then base.
  var WHERE_RANK = { collab: 0, showcase: 1, base: 2, bag: 3, setbag: 3 };
  // The top `cap` copies, raised evenly: while spare copies can pay, the lowest target goes up one level
  // (it plus 2 copies of its level). stopAt: the level where Advanced Upgrade takes over.
  function evenFill(copies, cap, maxLevel, stopAt) {
    var sorted = copies.slice().sort(function (a, b) { return b.level - a.level || WHERE_RANK[a.where] - WHERE_RANK[b.where]; });
    var targets = sorted.slice(0, cap).map(function (c) { return { level: c.level, from: c.where, ref: c.ref, start: c.level }; });
    var spare = {}, merges = {}, top = Math.min(maxLevel, stopAt);
    sorted.slice(cap).forEach(function (c) { spare[c.level] = (spare[c.level] || 0) + 1; });
    for (;;) {
      var t = null;
      targets.forEach(function (x) {                        // the lowest; a bag one first (it needs no pull)
        if (!t || x.level < t.level || (x.level === t.level && WHERE_RANK[x.from] > WHERE_RANK[t.from])) t = x;
      });
      if (!t || t.level >= top) break;
      var r = makeCopies(spare, t.level, 2);
      if (!r.ok) break;
      Object.keys(r.use).forEach(function (lv) { spare[lv] -= r.use[lv]; });
      Object.keys(r.merges).forEach(function (lv) { merges[lv] = (merges[lv] || 0) + r.merges[lv]; });
      merges[t.level] = (merges[t.level] || 0) + 1;
      t.level++;
    }
    var raised = targets.filter(function (x) { return x.level > x.start; }).map(function (x) { return { ref: x.ref, from: x.from, fromLevel: x.start, toLevel: x.level }; });
    return { targets: targets.map(function (x) { return { level: x.level, from: x.from, ref: x.ref }; }), merges: merges, raised: raised, spare: spare };
  }
  function sameRef(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  // Per group with wanted stats (not a losing mutually exclusive variant): what to pull into the bag, the bag merges
  // (ascending levels) and where each raised piece goes back. useLv1: the Lv1 bag copies these merges consume.
  function mergePlan(snap, settings) {
    var entries = pool(snap), ex = exclusive(snap, entries), up = {}, out = [];
    (snap.upgrades || []).forEach(function (u) { up[u.group] = 1; });
    Object.keys(snap.levels).forEach(function (gk) {
      var g = Number(gk), lv = snap.levels[gk], ids = Object.keys(lv).map(function (k) { return Number(lv[k]); }).filter(function (id) { return snap.rows[id]; });
      if (!ids.length || (ex[g] && ex[g].exclusived)) return;
      var r0 = snap.rows[ids[0]];
      if (!(r0.cap > 0) || copyInfo(snap, ids[0], settings).tier >= 3) return;
      var copies = [];
      entries.forEach(function (e) {
        if (e.group !== g) return;
        if (e.where === 'setbag') { for (var i = 0; i < e.n; i++) copies.push({ level: e.level, where: 'bag', ref: null, id: e.id }); }
        else copies.push({ level: e.level, where: e.where, ref: e.ref, id: e.id });
      });
      var sets = (snap.sets || []).indexOf(g) >= 0;
      if (!sets) snap.bag.forEach(function (b) { var r = snap.rows[b.id]; if (r && r.group === g) for (var i = 0; i < b.n; i++) copies.push({ level: r.level, where: 'bag', ref: null, id: b.id }); });
      if (!copies.length) return;
      var maxLevel = Math.min(r0.maxLevel, Math.max.apply(null, Object.keys(lv).map(Number)));
      var f = evenFill(copies, r0.cap, maxLevel, r0.cap === 1 && up[g] ? snap.openLevel : Infinity);
      var levels = Object.keys(f.merges).map(Number).sort(function (a, b) { return a - b; });
      if (!levels.length) return;
      var pulls = [], putBacks = [], pulledL1 = 0;
      f.raised.forEach(function (x) {
        if (x.from === 'bag') return;
        var e = entries.filter(function (en) { return en.group === g && en.where === x.from && sameRef(en.ref, x.ref); })[0];
        if (!e) return;
        pulls.push(e);
        putBacks.push({ ref: x.ref, where: x.from, id: Number(lv[x.toLevel]) });
        if (x.fromLevel === 1) pulledL1++;
      });
      out.push({ group: g, pulls: pulls, merges: levels.map(function (l) { return { id: Number(lv[l]), num: f.merges[l] }; }), putBacks: putBacks,
        useLv1: Math.max(0, (f.merges[1] || 0) * 3 - pulledL1), targets: f.targets });
    });
    return out;
  }

  // ---------------------------------------------------------------- Advanced Upgrade (the game's own list)
  // States from DecorationExpandData.getStateList(): 2 can open, 4 can feed (bag Lv1 copies), 5 can split higher bag
  // copies into Lv1, 6 can level up. Feeds use only the Lv1 copies the merges leave (reservedLv1 {group: n}), never past
  // the bar. A split is sent only when the counted copy isn't in the bag (a split could otherwise take it). Never shards.
  var UP = { OPEN: 2, FEED: 4, SPLIT: 5, LEVEL: 6 };
  function upgradeSteps(snap, reservedLv1) {
    var out = [], c = null;
    (snap.upgrades || []).forEach(function (u) {
      var g = u.group;
      if (u.state === UP.OPEN) out.push({ kind: 'open', group: g });
      else if (u.state === UP.LEVEL) out.push({ kind: 'level', group: g });
      else if (u.state === UP.FEED) {
        var lv1 = snap.levels[g] && Number(snap.levels[g][1]), have = 0;
        snap.bag.forEach(function (b) { if (b.id === lv1) have += b.n; });
        var avail = have - ((reservedLv1 || {})[g] || 0), num = Math.floor(Math.min(avail, u.need - u.exp) / (u.perNumber || 1));
        if (num > 0) out.push({ kind: 'feed', group: g, num: num });
      } else if (u.state === UP.SPLIT) {
        c = c || counted(snap);
        var inBag = (c.byGroup[g] || []).some(function (e) { return e.where === 'setbag'; });
        if (!inBag) out.push({ kind: 'split', group: g });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- collab box and pick-ups
  // Every copy of a group, with where it is (plain bag copies too: they can be placed or merged).
  function groupCopies(snap, g, entries) {
    var copies = [], sets = (snap.sets || []).indexOf(g) >= 0;
    (entries || pool(snap)).forEach(function (e) {
      if (e.group !== g) return;
      if (e.where === 'setbag') { for (var i = 0; i < e.n; i++) copies.push({ id: e.id, level: e.level, where: 'bag', ref: null }); }
      else copies.push({ id: e.id, level: e.level, where: e.where, ref: e.ref });
    });
    if (!sets) snap.bag.forEach(function (b) { var r = snap.rows[b.id]; if (r && r.group === g) for (var i = 0; i < b.n; i++) copies.push({ id: b.id, level: r.level, where: 'bag', ref: null }); });
    return copies;
  }
  var COLLAB_FROM = { bag: 0, base: 1, showcase: 2 };       // the game's own panel: the best copy, from the bag first
  function collabPlan(snap) {
    var entries = pool(snap), out = [];
    snap.collab.forEach(function (c) {
      var best = null;
      groupCopies(snap, c.group, entries).forEach(function (x) {
        if (x.where === 'collab') return;
        if (!best || x.level > best.level || (x.level === best.level && COLLAB_FROM[x.where] < COLLAB_FROM[best.where])) best = x;
      });
      if (!best) return;
      var cur = c.id && snap.rows[c.id];
      if (cur && cur.level >= best.level) return;
      out.push({ slot: c.slot, from: best.where, id: best.id, ref: best.ref });
    });
    return out;
  }
  // The copies that should count, per group: the even-fill targets (refs; bag targets have ref null).
  function targets(snap, settings) {
    var entries = pool(snap), out = {};
    Object.keys(snap.levels).forEach(function (gk) {
      var g = Number(gk), ids = Object.keys(snap.levels[gk]).map(function (k) { return Number(snap.levels[gk][k]); }).filter(function (id) { return snap.rows[id]; });
      if (!ids.length) return;
      var cap = snap.rows[ids[0]].cap;
      if (!(cap > 0)) return;
      out[g] = evenFill(groupCopies(snap, g, entries), cap, 0, 0).targets.map(function (t) { return t.ref; });
    });
    return out;
  }
  // Placed, showcase and collab copies that don't count once the plan is done: over the cap, the losing variant of a
  // mutually exclusive pair, members of a completed set (their bag copies count), merge spares. Never decor without
  // stats or decor nobody wants (those move only when their space is needed).
  function pickupPlan(snap, settings, tg) {
    var entries = pool(snap), ex = exclusive(snap, entries), sets = {}, out = [];
    (snap.sets || []).forEach(function (g) { sets[g] = 1; });
    entries.forEach(function (e) {
      if (e.where === 'setbag') return;
      var r = snap.rows[e.id];
      if (!r.buffs.length || !(r.cap > 0) || copyInfo(snap, e.id, settings).tier >= 3) return;
      var keep;
      if (ex[e.group] && ex[e.group].exclusived) keep = false;
      else if (sets[e.group]) keep = e.where === 'collab';
      else keep = (tg[e.group] || []).some(function (ref) { return sameRef(ref, e.ref); });
      if (!keep) out.push(e);
    });
    return out;
  }

  // The copies that will count once merged, per group: {level, from, ref, id}. Unwanted groups aren't raised.
  function finalTargets(snap, settings) {
    var entries = pool(snap), ex = exclusive(snap, entries), up = {}, out = {};
    (snap.upgrades || []).forEach(function (u) { up[u.group] = 1; });
    Object.keys(snap.levels).forEach(function (gk) {
      var g = Number(gk), lv = snap.levels[gk], ids = Object.keys(lv).map(function (k) { return Number(lv[k]); }).filter(function (id) { return snap.rows[id]; });
      if (!ids.length || (ex[g] && ex[g].exclusived)) return;
      var r0 = snap.rows[ids[0]];
      if (!(r0.cap > 0) || !r0.buffs.length) return;
      var copies = groupCopies(snap, g, entries);
      if (!copies.length) return;
      var wanted = copyInfo(snap, ids[0], settings).tier < 3;
      var maxLevel = Math.min(r0.maxLevel, Math.max.apply(null, Object.keys(lv).map(Number)));
      var f = evenFill(copies, r0.cap, wanted ? maxLevel : 0, wanted ? (r0.cap === 1 && up[g] ? snap.openLevel : Infinity) : 0);
      out[g] = f.targets.map(function (t) { return { level: t.level, from: t.from, ref: t.ref, id: Number(lv[t.level]) }; });
    });
    return out;
  }

  // ---------------------------------------------------------------- homes: showcase, south land, far-corner water, floors
  // A decor's cells on the base map run diagonally (the game's getMapPosList).
  function footprint(x, y, w, h) {
    var out = [];
    for (var r = 0; r < h; r++) for (var s = 0; s < w; s++) out.push([x - r + s, y + r + s]);
    return out;
  }
  function size(snap, id) { var r = snap.rows[id]; return r ? [r.w, r.h] : [1, 1]; }
  // Each unlocked showcase tab's 5x5 cells (index 5x + y), true = free. A decor covers w x h from (x, y), not rotated.
  function showcaseFree(snap) {
    var out = {};
    snap.showcase.forEach(function (l) {
      var f = []; for (var i = 0; i < 25; i++) f.push(true);
      l.items.forEach(function (e) { mark5(f, e.x, e.y, size(snap, e.id)[0], size(snap, e.id)[1], false); });
      out[l.labelId] = f;
    });
    return out;
  }
  function mark5(f, x, y, w, h, v) { for (var n = 0; n < w; n++) for (var s = 0; s < h; s++) if (x + n < 5 && y + s < 5) f[5 * (x + n) + y + s] = v; }
  function fits5(f, x, y, w, h) {
    if (x + w > 5 || y + h > 5) return false;
    for (var n = 0; n < w; n++) for (var s = 0; s < h; s++) if (!f[5 * (x + n) + y + s]) return false;
    return true;
  }
  // The game's own scan (getFreePosForBuildId): x 0..4 outside, y 0..4 inside; tabs in order.
  function packShowcase(free, w, h) {
    var tabs = Object.keys(free).map(Number).sort(function (a, b) { return a - b; });
    for (var t = 0; t < tabs.length; t++) for (var x = 0; x < 5; x++) for (var y = 0; y < 5; y++) {
      if (fits5(free[tabs[t]], x, y, w, h)) return { labelId: tabs[t], x: x, y: y };
    }
    return null;
  }
  function centroid(snap) {
    var b = snap.buildings || [];
    if (!b.length) return [snap.grid.w / 2, snap.grid.h / 2];
    var x = 0, y = 0;
    b.forEach(function (p) { x += p.x; y += p.y; });
    return [x / b.length, y / b.length];
  }
  // Screen distance from the buildings' centre: a staggered grid draws a row half as tall as a column is wide.
  function byDistance(snap, keep) {
    var c = centroid(snap);
    return snap.grid.cells.filter(keep).map(function (k) { return [k[0], k[1], Math.sqrt(Math.pow(k[0] - c[0], 2) + Math.pow((k[1] - c[1]) / 2, 2))]; })
      .sort(function (a, b) { return b[2] - a[2] || b[1] - a[1] || a[0] - b[0]; });
  }
  function seaCells(snap) { return byDistance(snap, function (k) { return k[2] === 1 && !k[3]; }); }
  function landCells(snap) { return byDistance(snap, function (k) { return k[2] === 1 && k[3] === 1; }); }
  // The base as the plan sees it: cells by position, what's occupied and where floor tiles are.
  function model(snap) {
    var m = { cell: {}, occ: {}, floor: {} };
    snap.grid.cells.forEach(function (k) { var p = k[0] * 1000 + k[1]; m.cell[p] = k; if (k[5]) m.occ[p] = 1; if (k[6]) m.floor[p] = 1; });
    return m;
  }
  function cellsAt(fp) { return fp.map(function (c) { return c[0] * 1000 + c[1]; }); }
  function fitsDecor(m, x, y, w, h, pt) {
    return cellsAt(footprint(x, y, w, h)).every(function (p) { var k = m.cell[p]; return k && k[2] === 1 && k[3] === (pt === 1 ? 1 : 0) && k[4] && !m.occ[p]; });
  }
  function fitsFloor(m, x, y, w, h) {
    return cellsAt(footprint(x, y, w, h)).every(function (p) { var k = m.cell[p]; return k && (k[2] === 0 || k[2] === 1) && k[3] === 1 && k[4] && !m.floor[p]; });
  }
  function setCells(m, key, x, y, w, h, v) { cellsAt(footprint(x, y, w, h)).forEach(function (p) { if (v) m[key][p] = 1; else delete m[key][p]; }); }
  function rankCmp(a, b) { return a.info.tier - b.info.tier || a.info.cells - b.info.cells || b.info.points - a.info.points || b.level - a.level; }
  function whyNot(snap, id) { return snap.rows[id].buffs.some(function (b) { return GOLD.indexOf(b[0]) >= 0; }) ? 'gold' : 'off'; }
  // Where each wanted bag piece goes: land decor to the showcase first, then the south land; sea decor to the far
  // corners; floor tiles under decor, then under units. A placed piece nobody wants (then a Green Apple Tree) gives way
  // only to a piece ranked above it.
  function placePlan(snap, settings, final) {
    var sets = {}, cands = [], left = [], seen = {};
    (snap.sets || []).forEach(function (g) { sets[g] = 1; });
    function leave(id, why) { if (!seen[id + why]) { seen[id + why] = 1; left.push({ id: id, why: why }); } }
    Object.keys(final).forEach(function (g) {
      if (sets[g]) return;
      final[g].forEach(function (t) {
        if (t.from !== 'bag') return;
        var info = copyInfo(snap, t.id, settings);
        if (info.tier >= 3) { leave(t.id, whyNot(snap, t.id)); return; }
        cands.push({ id: t.id, level: t.level, info: info, row: snap.rows[t.id] });
      });
    });
    cands.sort(rankCmp);
    var m = model(snap), free = showcaseFree(snap), sea = seaCells(snap), land = landCells(snap);
    var floorOrder = byDistance(snap, function (k) { return k[3] === 1 && (k[2] === 1 || k[2] === 0); })
      .sort(function (a, b) { var ka = m.cell[a[0] * 1000 + a[1]], kb = m.cell[b[0] * 1000 + b[1]]; return (kb[2] - ka[2]) || (kb[5] - ka[5]) || b[2] - a[2]; });
    var evictable = [], at = {};
    snap.placed.forEach(function (p) { at[p.uuid] = p; });
    pool(snap).forEach(function (e) {
      if (e.where !== 'base' && e.where !== 'showcase') return;
      var r = snap.rows[e.id];
      if (r.type !== 4 || r.pt !== 1 || !r.buffs.length) return;
      var info = copyInfo(snap, e.id, settings), p = e.where === 'base' ? at[e.ref] : e.ref;
      if (info.tier >= 2) evictable.push({ e: e, info: info, r: r, x: p.x, y: p.y });
    });
    evictable.sort(function (a, b) { return b.info.tier - a.info.tier || a.info.points - b.info.points; });
    var place = [], evict = [];
    function landSpot(w, h) {
      var s = packShowcase(free, w, h);
      if (s) return s;
      for (var i = 0; i < land.length; i++) if (fitsDecor(m, land[i][0], land[i][1], w, h, 1)) return { x: land[i][0], y: land[i][1] };
      return null;
    }
    function free1(v, on) {                                 // put back or clear an evictable piece's space
      var e = v.e;
      if (e.where === 'showcase') mark5(free[e.ref.labelId], v.x, v.y, v.r.w, v.r.h, on);
      else setCells(m, 'occ', v.x, v.y, v.r.w, v.r.h, !on);
    }
    cands.forEach(function (c) {
      var w = c.row.w, h = c.row.h, spot = null;
      if (c.row.type === 5) {
        for (var i = 0; i < floorOrder.length && !spot; i++) if (fitsFloor(m, floorOrder[i][0], floorOrder[i][1], w, h)) spot = { x: floorOrder[i][0], y: floorOrder[i][1] };
        if (spot) setCells(m, 'floor', spot.x, spot.y, w, h, true);
      } else if (c.row.pt === 0) {
        for (var j = 0; j < sea.length && !spot; j++) if (fitsDecor(m, sea[j][0], sea[j][1], w, h, 0)) spot = { x: sea[j][0], y: sea[j][1] };
        if (spot) setCells(m, 'occ', spot.x, spot.y, w, h, true);
      } else {
        spot = landSpot(w, h);
        if (!spot) {                                        // make room: lowest-ranked pieces first, only below this one
          var tried = [];
          for (var k = 0; k < evictable.length && !spot; k++) {
            var v = evictable[k];
            if (v.used || v.info.tier <= c.info.tier) continue;
            v.used = true; tried.push(v); free1(v, true);
            spot = landSpot(w, h);
          }
          tried.forEach(function (v) {                      // keep only the evictions under the new spot
            var need = spot && (spot.labelId != null
              ? v.e.where === 'showcase' && v.e.ref.labelId === spot.labelId && overlap5(v.x, v.y, v.r.w, v.r.h, spot.x, spot.y, w, h)
              : v.e.where === 'base' && overlapMap(v.x, v.y, v.r.w, v.r.h, spot.x, spot.y, w, h));
            if (need) evict.push(v.e); else { v.used = false; free1(v, false); }
          });
        }
        if (spot) { if (spot.labelId != null) mark5(free[spot.labelId], spot.x, spot.y, w, h, false); else setCells(m, 'occ', spot.x, spot.y, w, h, true); }
      }
      if (spot) place.push({ id: c.id, to: spot }); else leave(c.id, 'no room');
    });
    return { place: place, evict: evict, left: left };
  }
  function overlap5(ax, ay, aw, ah, bx, by, bw, bh) { return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah; }
  function overlapMap(ax, ay, aw, ah, bx, by, bw, bh) {
    var a = {}; cellsAt(footprint(ax, ay, aw, ah)).forEach(function (p) { a[p] = 1; });
    return cellsAt(footprint(bx, by, bw, bh)).some(function (p) { return a[p]; });
  }
  // Sea decor to the far corners (Tex: all of it, not only new pieces). Pack every sea piece farthest first: the d of
  // the last spot used is the line; a piece in the south water at or beyond it stays, the rest move out to the farthest
  // free spots. Land decor in the troop area moves to the showcase or the south land when there's room.
  function tidyPlan(snap) {
    var c = centroid(snap), sea = seaCells(snap), out = [];
    function dist(x, y) { return Math.sqrt(Math.pow(x - c[0], 2) + Math.pow((y - c[1]) / 2, 2)); }
    var m = model(snap), zone = function (x, y) { var k = m.cell[x * 1000 + y]; return k ? k[2] : -1; };
    var pieces = snap.placed.filter(function (p) { var r = snap.rows[p.id]; return r && r.type === 4 && r.pt === 0; })
      .map(function (p) { var r = snap.rows[p.id]; return { p: p, w: r.w, h: r.h, d: dist(p.x, p.y) }; })
      .sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    var m2 = model(snap), line = Infinity;
    pieces.forEach(function (q) { setCells(m2, 'occ', q.p.x, q.p.y, q.w, q.h, false); });
    pieces.forEach(function (q) {
      for (var i = 0; i < sea.length; i++) if (fitsDecor(m2, sea[i][0], sea[i][1], q.w, q.h, 0)) { setCells(m2, 'occ', sea[i][0], sea[i][1], q.w, q.h, true); line = Math.min(line, sea[i][2]); return; }
    });
    pieces.forEach(function (q) {
      var z = zone(q.p.x, q.p.y);
      if (z === 1 && q.d >= line - 1e-9) return;
      for (var i = 0; i < sea.length; i++) {
        if (z === 1 && sea[i][2] <= q.d) break;
        if (fitsDecor(m, sea[i][0], sea[i][1], q.w, q.h, 0)) {
          setCells(m, 'occ', sea[i][0], sea[i][1], q.w, q.h, true);
          setCells(m, 'occ', q.p.x, q.p.y, q.w, q.h, false);
          out.push({ uuid: q.p.uuid, to: [sea[i][0], sea[i][1]] });
          return;
        }
      }
    });
    var free = showcaseFree(snap), land = landCells(snap);
    snap.placed.forEach(function (p) {
      var r = snap.rows[p.id];
      if (!r || r.type !== 4 || r.pt !== 1 || zone(p.x, p.y) !== 0) return;
      var s = packShowcase(free, r.w, r.h);
      if (s) { mark5(free[s.labelId], s.x, s.y, r.w, r.h, false); out.push({ uuid: p.uuid, to: s }); return; }
      for (var i = 0; i < land.length; i++) if (fitsDecor(m, land[i][0], land[i][1], r.w, r.h, 1)) {
        setCells(m, 'occ', land[i][0], land[i][1], r.w, r.h, true);
        setCells(m, 'occ', p.x, p.y, r.w, r.h, false);
        out.push({ uuid: p.uuid, to: [land[i][0], land[i][1]] });
        return;
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- the whole plan
  // Each phase is planned on a copy of the snapshot that already has the earlier phases done, so the preview's gains
  // are the game's own counting rule before and after. The run re-reads the game before each phase and plans again.
  var phaseOrder = ['collab', 'pickup', 'merge', 'upgrade', 'place', 'tidy'];
  function sim(snap) {
    var s = JSON.parse(JSON.stringify(snap)), idx = {}, seq = 0;
    s.grid.cells.forEach(function (k) { idx[k[0] * 1000 + k[1]] = k; });
    function mark(id, x, y, on) {
      var r = s.rows[id];
      footprint(x, y, r.w, r.h).forEach(function (c) { var k = idx[c[0] * 1000 + c[1]]; if (k) k[r.type === 5 ? 6 : 5] = on ? 1 : 0; });
    }
    function bag(id, n) {
      var b = s.bag.filter(function (x) { return x.id === id; })[0];
      if (b) b.n += n; else s.bag.push({ id: id, n: n });
      s.bag = s.bag.filter(function (x) { return x.n > 0; });
    }
    return {
      s: s, bag: bag,
      spot: function (where, ref) {                        // where a piece is, to put a raised one back there
        if (where === 'base') { var p = s.placed.filter(function (q) { return q.uuid === ref; })[0]; return { x: p.x, y: p.y }; }
        if (where === 'showcase') return { labelId: ref.labelId, x: ref.x, y: ref.y };
        return { slot: ref };
      },
      take: function (where, ref, id) {                    // a piece to the bag
        if (where === 'base') {
          var i = s.placed.map(function (q) { return q.uuid; }).indexOf(ref), p = s.placed[i];
          mark(p.id, p.x, p.y, false); s.placed.splice(i, 1);
        } else if (where === 'showcase') {
          var l = s.showcase.filter(function (t) { return t.labelId === ref.labelId; })[0];
          l.items = l.items.filter(function (e) { return e.uuid !== ref.uuid; });
        } else if (where === 'collab') {
          s.collab.filter(function (c) { return c.slot === ref; })[0].id = null;
        }
        bag(id, 1);
      },
      put: function (where, to, id) {                      // a bag piece to the base, a showcase tab or a collab slot
        bag(id, -1);
        if (where === 'base') { s.placed.push({ uuid: 'new' + (++seq), id: id, x: to.x, y: to.y }); mark(id, to.x, to.y, true); }
        else if (where === 'showcase') s.showcase.filter(function (t) { return t.labelId === to.labelId; })[0].items.push({ uuid: 'new' + (++seq), id: id, x: to.x, y: to.y });
        else { var c = s.collab.filter(function (k) { return k.slot === to.slot; })[0]; if (c.id) bag(c.id, 1); c.id = id; }
      }
    };
  }
  function plan(snap, settings) {
    var S = sim(snap), s = S.s, ph = {};
    phaseOrder.forEach(function (p) { ph[p] = []; });
    function toBag(list, where, ref, id) { list.push({ kind: 'toBag', where: where, ref: ref, id: id }); S.take(where, ref, id); }
    collabPlan(s).forEach(function (c) {
      var slot = s.collab.filter(function (k) { return k.slot === c.slot; })[0];
      if (slot.id && c.from !== 'bag') { toBag(ph.collab, c.from, c.ref, c.id); c = { slot: c.slot, from: 'bag', id: c.id, ref: null }; }   // replace from the bag, as the game does
      ph.collab.push({ kind: 'collabIn', slot: c.slot, from: c.from, id: c.id, ref: c.ref });
      if (c.from !== 'bag') S.take(c.from, c.ref, c.id);
      S.put('collab', { slot: c.slot }, c.id);
    });
    pickupPlan(s, settings, targets(s, settings)).forEach(function (e) { toBag(ph.pickup, e.where, e.ref, e.id); });
    mergePlan(s, settings).forEach(function (g) {
      var spots = g.pulls.map(function (e) { var to = S.spot(e.where, e.ref); toBag(ph.merge, e.where, e.ref, e.id); return to; });
      g.merges.forEach(function (m) {
        var r = s.rows[m.id];
        ph.merge.push({ kind: 'merge', id: m.id, num: m.num });
        S.bag(m.id, -3 * m.num); S.bag(Number(s.levels[r.group][r.level + 1]), m.num);
      });
      g.putBacks.forEach(function (b, i) { ph.merge.push({ kind: 'putBack', id: b.id, where: b.where, to: spots[i] }); S.put(b.where, spots[i], b.id); });
    });
    upgradeSteps(s, {}).forEach(function (u) {
      ph.upgrade.push(u.num != null ? { kind: u.kind, group: u.group, num: u.num } : { kind: u.kind, group: u.group });
      if (u.kind === 'feed') {
        var up = s.upgrades.filter(function (x) { return x.group === u.group; })[0];
        S.bag(Number(s.levels[u.group][1]), -u.num * ((up && up.perNumber) || 1));
      }
    });
    var pp = placePlan(s, settings, finalTargets(s, settings));
    pp.evict.forEach(function (e) { toBag(ph.place, e.where, e.ref, e.id); });
    pp.place.forEach(function (x) {
      if (x.to.labelId != null) { ph.place.push({ kind: 'showcaseIn', id: x.id, labelId: x.to.labelId, x: x.to.x, y: x.to.y }); S.put('showcase', x.to, x.id); }
      else { ph.place.push({ kind: 'place', id: x.id, x: x.to.x, y: x.to.y }); S.put('base', x.to, x.id); }
    });
    tidyPlan(s).forEach(function (m) {
      if (/^new/.test(m.uuid)) return;                     // placed this run: the tidy phase re-plans with its real id
      var p = s.placed.filter(function (q) { return q.uuid === m.uuid; })[0];
      if (Array.isArray(m.to)) ph.tidy.push({ kind: 'move', uuid: m.uuid, x: m.to[0], y: m.to[1] });
      else { ph.tidy.push({ kind: 'toBag', where: 'base', ref: m.uuid, id: p.id }); ph.tidy.push({ kind: 'showcaseIn', id: p.id, labelId: m.to.labelId, x: m.to.x, y: m.to.y }); }
    });
    return { phases: ph, summary: summary(snap, s, ph, pp.left) };
  }
  function statText(stat, delta) {
    var a = Math.abs(delta);
    return (delta > 0 ? '+' : '-') + (stat && stat.vt === 10000 ? (a / 100).toFixed(2) + '%' : String(a));
  }
  function summary(before, after, ph, left) {
    var b = counted(before).buffs, a = counted(after).buffs, gains = [], seen = {}, out = [];
    Object.keys(b).concat(Object.keys(a)).forEach(function (k) {
      if (seen[k]) return; seen[k] = 1;
      var d = (a[k] || 0) - (b[k] || 0), stat = before.stats[k];
      if (!d || GOLD.indexOf(Number(k)) >= 0) return;
      gains.push({ buffId: Number(k), name: stat ? stat.name : String(k), before: b[k] || 0, after: a[k] || 0, text: statText(stat, d) });
    });
    gains.sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : x.buffId - y.buffId; });
    var names = {};
    (left || []).forEach(function (l) { var n = before.rows[l.id].name, k = n + '|' + l.why; if (!names[k]) { names[k] = 1; out.push({ name: n, why: l.why }); } });
    function count(list, kinds) { return list.filter(function (x) { return kinds.indexOf(x.kind) >= 0; }).length; }
    return {
      counts: { collab: count(ph.collab, ['collabIn']), toBag: count(ph.pickup, ['toBag']) + count(ph.place, ['toBag']), merges: count(ph.merge, ['merge']),
        upgrades: ph.upgrade.length, placed: count(ph.place, ['place', 'showcaseIn']), tidied: count(ph.tidy, ['move', 'showcaseIn']) },
      gains: gains, left: out
    };
  }

  var api = { GOLD: GOLD, REPAIR: REPAIR, MARCH: MARCH, WEIGHTS: WEIGHTS, SCOPE: SCOPE, CLASS: CLASS, phaseOrder: phaseOrder, plan: plan,
    copyInfo: copyInfo, pool: pool, counted: counted, makeCopies: makeCopies, evenFill: evenFill, mergePlan: mergePlan,
    upgradeSteps: upgradeSteps, collabPlan: collabPlan, targets: targets, pickupPlan: pickupPlan, finalTargets: finalTargets,
    footprint: footprint, showcaseFree: showcaseFree, packShowcase: packShowcase, centroid: centroid, seaCells: seaCells,
    landCells: landCells, placePlan: placePlan, tidyPlan: tidyPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DecorCore = api;
})();
