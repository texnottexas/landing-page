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

  var api = { GOLD: GOLD, REPAIR: REPAIR, MARCH: MARCH, WEIGHTS: WEIGHTS, SCOPE: SCOPE, CLASS: CLASS,
    copyInfo: copyInfo, pool: pool, counted: counted };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DecorCore = api;
})();
