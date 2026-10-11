/* armory-base.js: the Base section of the Armory v2 page (phase 3), loaded the first time the Base route opens.
 * Four segments: Decor (placed decorations, sets, the Spend my shards panel), Skins (with the halos), Base decor, Formation.
 * Same-origin script, no CSP change. Everything that comes from a table, the worker or a supplement is coerced to a number or goes
 * through esc / nd / nm. The data rules sit in ArmoryBaseLogic (no DOM, node-testable); ArmoryBase(H) is the view.
 * The big skin / base decor / halo tables live in tw-game-data-base.js (window.TWGameDataBase), loaded the first time a segment
 * that needs them opens (Decor lists its decorations at once and fills the strip when the table arrives). data/decoration-mutual-exclusive.json (Spend panel) and data/formation-v2.json
 * (Formation) are fetched when their part opens.
 */
(function (root) {
'use strict';

/* ---------- logic (no DOM) ---------- */
var has = Object.prototype.hasOwnProperty;
function num(v) { v = +v; return isFinite(v) ? v : 0; }
function fmtInt(n) { return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function round1(n) { return Math.round(n * 10) / 10; }
function pctText(n) { return String(round1(num(n))).replace(/\.0$/, '') + '%'; }
function arr(v) { return Array.isArray(v) ? v : []; }
function own(o, k) { return o && typeof o === 'object' && has.call(o, k) ? o[k] : undefined; }

/* The game tables name the same stat in a dozen shorthands ("Air Force ATK", "All DMG+", "Increase DEF of all units").
   Written out, the way the Heroes screen writes them. Render only: nothing is matched on the result except statKey(). */
function statName(n) {
  var t = String(n == null ? '' : n);
  if (/^Increase DEF of all units$/i.test(t)) return 'All units Defense';
  t = t.replace(/\s*\(rcv\)/g, '').replace(/DMG[-−]/g, 'Decreased DMG Taken').replace(/DMG\+/g, 'DMG increase')
    .replace(/\bDMG Increase\b/g, 'DMG increase').replace(/\bATK\b/g, 'Attack').replace(/\bAF\b/g, 'Air Force').replace(/\bDEF\b/g, 'Defense');
  return t.replace(/\s{2,}/g, ' ').trim();
}
/* a skin table value ("++25.0%", "+4", "+20.0%"): the sign once, no trailing .0 */
function skinVal(s) { return String(s == null ? '' : s).replace(/\+\+/g, '+').replace(/(\d)\.0%/, '$1%'); }
function skinNum(s) { var m = /[-+]?\d+(?:\.\d+)?/.exec(String(s == null ? '' : s)); return m ? parseFloat(m[0]) : 0; }
/* a base decoration / halo value: hundredths of a percent, March Size is a plain count (the classic formatBaseBuffVal) */
function baseVal(val, name) {
  if (name === 'March Size') return '+' + fmtInt(val);
  var p = num(val) / 100;
  return '+' + (p === Math.floor(p) ? p.toFixed(0) : p.toFixed(1)) + '%';
}

/* the five stats the strip sums: one key per stat, matched on the written-out name */
var KEY_STATS = [['march', 'March Size'], ['atk', 'All units Attack'], ['hp', 'All units HP'], ['dmgTaken', 'All units Decreased DMG Taken'], ['dmgInc', 'All units DMG increase']];
function statKey(name) {
  var n = statName(name);
  if (n === 'March Size') return 'march';
  if (n === 'All units Attack' || n === 'All Attack') return 'atk'; /* the skin table's "All ATK" / "All HP" are the all-units buffs: the game's own buff trace sums them with the rest (checked on a battle report) */
  if (n === 'All units HP' || n === 'All HP') return 'hp';
  if (n === 'All units Decreased DMG Taken' || n === 'Decreased DMG Taken (all)') return 'dmgTaken';
  if (n === 'All units DMG increase') return 'dmgInc';
  return null;
}
function emptyTotals() { return { march: 0, atk: 0, hp: 0, dmgTaken: 0, dmgInc: 0 }; }
function roundTotals(t) { Object.keys(t).forEach(function (k) { t[k] = k === 'march' ? Math.round(t[k]) : round1(t[k]); }); return t; }

/* ---- skins ---- */
/* The player's skins in one shape, from either source: a battle report (effectIds / useIds / ownCastleEffects / useCastleEffects /
   ownHaloSkins / useHaloSkins) or the game-data upload (ownedSkins / activeSkin). The classic page reads the report shape only, so a
   player with game data and no report saw "0 owned" there. Id 0 is the default skin: not counted. */
function skinState(sk) {
  var o = { known: false, owned: [], active: 0, castle: [], castleActive: 0, halo: [], haloActive: 0, source: '' };
  if (!sk || typeof sk !== 'object') return o;
  function ids(a) { var seen = {}, out = []; arr(a).forEach(function (x) { var n = Math.floor(num(x)); if (n > 0 && !seen[n]) { seen[n] = 1; out.push(n); } }); return out; }
  if (Array.isArray(sk.effectIds)) { o.owned = ids(sk.effectIds); o.active = Math.floor(num(arr(sk.useIds)[0])); o.source = 'reports'; o.known = true; }
  else if (Array.isArray(sk.ownedSkins)) { o.owned = ids(sk.ownedSkins); o.active = Math.floor(num(sk.activeSkin)); o.source = 'game data'; o.known = true; }
  o.castle = ids(sk.ownCastleEffects); o.castleActive = Math.floor(num(arr(sk.useCastleEffects)[0]));
  o.halo = ids(sk.ownHaloSkins); o.haloActive = Math.floor(num(arr(sk.useHaloSkins)[0]));
  return o;
}
function skinRow(T, id, active) {
  var sd = own(T.SKIN_SD, String(id)), ok = Array.isArray(sd);
  var fix = function (l) { return arr(l).map(function (b) { return { n: statName(b && b[0]), v: skinVal(b && b[1]) }; }); };
  var key = String(id);
  return {
    id: id, name: ok && typeof sd[0] === 'string' && sd[0] ? sd[0] : 'Unknown skin', known: ok,
    icon: ok && typeof sd[1] === 'string' ? sd[1] : '', equip: ok ? fix(sd[2]) : [], ownB: ok ? fix(sd[3]) : [],
    skill: ok && typeof sd[4] === 'string' ? sd[4] : '', power: ok ? num(sd[5]) : 0,
    active: id === active, isNew: !!own(T.NEW_SKIN_IDS, key), chain: own(T.SKIN_GROUP_LOOKUP, key) ? true : false, alt: own(T.SKIN_ALT_LOOKUP, key) ? true : false
  };
}
function skinList(T, st) { return st.owned.map(function (id) { return skinRow(T, id, st.active); }); }
function skinSort(list, mode) {
  var by = function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id; };
  return list.slice().sort(function (a, b) {
    if (mode === 'za') return -by(a, b);
    if (mode === 'power') return (b.power - a.power) || by(a, b);
    if (mode === 'equipped') return (b.active - a.active) || by(a, b);
    return (b.isNew - a.isNew) || by(a, b); /* name: the newest tier first, as classic pins it */
  });
}
function skinFilter(list, f) {
  var q = String(f.q || '').toLowerCase().trim();
  return list.filter(function (s) {
    if (q && s.name.toLowerCase().indexOf(q) < 0) return false;
    if (f.buff && !s.equip.concat(s.ownB).some(function (b) { return b.n === f.buff; })) return false;
    if (f.skill && s.skill !== f.skill) return false;
    return true;
  });
}
/* skins the player does not own: every released, non-placeholder skin; owning a level of a chain or one alternate form counts as owning the group */
function skinNotOwned(T, st) {
  var have = {};
  st.owned.concat(st.active ? [st.active] : []).forEach(function (id) {
    var k = String(id); have[k] = 1;
    arr(own(T.SKIN_GROUP_LOOKUP, k)).forEach(function (m) { have[String(m)] = 1; });
    arr(own(T.SKIN_ALT_LOOKUP, k)).forEach(function (m) { have[String(m)] = 1; });
  });
  return Object.keys(T.SKIN_SD || {}).filter(function (k) {
    if (have[k] || k === '0' || own(T.JUNK_SKIN_IDS, k)) return false;
    var sd = T.SKIN_SD[k];
    return Array.isArray(sd) && !(typeof sd[0] === 'string' && sd[0].indexOf('skin_name_') === 0);
  }).map(function (k) { return skinRow(T, +k, 0); }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}
/* the level chain or the alternate forms of a skin, for its sheet */
function skinChain(T, id) {
  var k = String(id), alt = own(T.SKIN_ALT_LOOKUP, k), lv = own(T.SKIN_GROUP_LOOKUP, k), m = alt || lv;
  if (!m || m.length < 2) return null;
  return { kind: alt ? 'alt' : 'level', rows: m.map(function (x, i) { var r = skinRow(T, +x, 0); r.label = alt ? 'Form ' + String.fromCharCode(65 + i) : 'Lv.' + (i + 1); return r; }) };
}
function citySkill(T, id) {
  var cs = own(T.CITY_SKILL_DB, String(id));
  if (!Array.isArray(cs)) return null;
  return { type: own(T.SKILL_TYPES, cs[1]) || '', desc: typeof cs[2] === 'string' ? cs[2] : '', how: typeof cs[3] === 'string' ? cs[3] : '' };
}
function skinFilterOptions(list) {
  var b = {}, s = {};
  list.forEach(function (x) { x.equip.concat(x.ownB).forEach(function (y) { if (y.n) b[y.n] = 1; }); if (x.skill) s[x.skill] = 1; });
  return { buffs: Object.keys(b).sort(), skills: Object.keys(s).sort() };
}

/* ---- base decorations and halos ---- */
function bdRow(T, id, table) {
  var d = own(table, String(id)), ok = d && typeof d === 'object';
  var fix = function (l) { return arr(l).map(function (b) { var nm = b && b[0]; return { n: statName(nm), v: baseVal(b && b[1], nm) }; }); };
  return { id: id, name: ok && typeof d.n === 'string' && d.n ? d.n : 'Unknown', known: !!ok, icon: ok && typeof d.i === 'string' ? d.i : '', equip: ok ? fix(d.e) : [], hold: ok ? fix(d.o) : [], buffs: ok ? fix(d.b) : [] };
}
function bdSort(list, mode) {
  return list.slice().sort(function (a, b) {
    if (mode === 'newest') return b.id - a.id;
    if (mode === 'oldest') return a.id - b.id;
    var c = a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id;
    return mode === 'za' ? -c : c;
  });
}
function bdNotOwned(table, ownedIds) {
  var have = {}; ownedIds.forEach(function (id) { have[String(id)] = 1; });
  return Object.keys(table || {}).filter(function (k) { return !have[k]; });
}

/* ---- the strip: what the base adds, per source ---- */
function skinTotals(T, st) {
  var t = emptyTotals();
  /* A level chain's later skin carries the chain's whole bonus (Lv.2 own = 20%, not 12% + 20%): only the highest owned level counts. One of a set of alternate forms counts (the equipped one, else the first). */
  var ownedSet = {}, altDone = {};
  st.owned.forEach(function (id) { ownedSet[id] = 1; });
  var counted = st.owned.filter(function (id) {
    var k = String(id), ch = own(T.SKIN_GROUP_LOOKUP, k), alt = own(T.SKIN_ALT_LOOKUP, k);
    if (ch && ch.some(function (m) { return m > id && ownedSet[m]; })) return false;
    if (alt) { var ak = alt.join(','); if (altDone[ak] && !(id === st.active)) return false; if (id === st.active || !altDone[ak]) altDone[ak] = id; }
    return true;
  }).filter(function (id) { var alt = own(T.SKIN_ALT_LOOKUP, String(id)); return !alt || altDone[alt.join(',')] === id; });
  counted.forEach(function (id) { var sd = own(T.SKIN_SD, String(id)); if (Array.isArray(sd)) arr(sd[3]).forEach(function (b) { var k = statKey(b && b[0]); if (k) t[k] += skinNum(b[1]); }); });
  var act = st.active ? own(T.SKIN_SD, String(st.active)) : null;
  if (Array.isArray(act)) arr(act[2]).forEach(function (b) { var k = statKey(b && b[0]); if (k) t[k] += skinNum(b[1]); });
  return roundTotals(t);
}
function baseDecorTotals(T, st) {
  var t = emptyTotals();
  st.castle.forEach(function (id) { var d = own(T.BASE_DECOR_DATA, String(id)); if (d) arr(d.o).forEach(function (b) { var k = statKey(b && b[0]); if (k) t[k] += k === 'march' ? num(b[1]) : num(b[1]) / 100; }); });
  var act = st.castleActive ? own(T.BASE_DECOR_DATA, String(st.castleActive)) : null;
  if (act) arr(act.e).forEach(function (b) { var k = statKey(b && b[0]); if (k) t[k] += k === 'march' ? num(b[1]) : num(b[1]) / 100; });
  return roundTotals(t);
}
function stripRows(decor, skin, bd) {
  return KEY_STATS.map(function (k) {
    var f = function (t) { return t ? (k[0] === 'march' ? '+' + fmtInt(t[k[0]]) : '+' + pctText(t[k[0]])) : '–'; };
    return { key: k[0], label: k[1], decor: f(decor), skin: f(skin), bdecor: f(bd) };
  });
}

/* ---- decorations ---- */
var CAT_ORDER = [0, 2, 1, 3]; /* March Size, Damage Boost, Defense, Others (classic's order) */
function dataFor(L, g) { /* the page's own lookup order: the group, then its mutually exclusive cluster mates */
  var D = L.DECOR_DATA || {}, k = String(g);
  if (own(D, k)) return { dd: D[k], bg: +g };
  var ck = own(L.ME_LOOKUP, k), vars = ck != null ? own(L.ME_CLUSTERS, String(ck)) : null;
  for (var i = 0; vars && i < vars.length; i++) if (own(D, String(vars[i]))) return { dd: D[String(vars[i])], bg: +vars[i] };
  return { dd: null, bg: +g };
}
function subCat(G, dd) {
  if (!dd || !dd.b || !dd.b.length) return null;
  var pid = dd.b[0].i;
  if (dd.c === 2) return G.DMG_INC_IDS[pid] ? 'dmg_inc' : G.DMG_DEC_IDS[pid] ? 'dmg_dec' : 'dmg_other';
  if (dd.c === 3) return G.HP_BUFF_IDS[pid] ? 'hp' : G.ATK_BUFF_IDS[pid] ? 'atk' : G.CAP_BUFF_IDS[pid] ? 'capacity' : 'others_misc';
  return null;
}
function buffRows(L, G, core, g, lv) {
  var f = dataFor(L, g);
  if (!f.dd) return { cat: 3, sub: null, rows: [], stats: [] };
  var names = L.BUFF_NAMES_DECOR || {};
  var rows = arr(f.dd.b).map(function (b) {
    return { n: statName(names[String(b.i)] || 'Other effect'), v: lv > 0 ? core.formatScaledDecorBuff(b, lv, f.bg) : G.formatDecorBuffVal(b), id: String(b.i) };
  });
  var cat = f.dd.c >= 0 && f.dd.c <= 3 ? f.dd.c : 3;
  return { cat: cat, sub: subCat(G, f.dd), rows: rows, stats: statGroups(G, rows) };
}
/* the advisor's stat groups a decoration's buffs fall in (the Decor filter) */
function statGroups(G, rows) {
  return Object.keys(G.ADVISOR_STAT_BUFFS).filter(function (s) { return rows.some(function (r) { return G.ADVISOR_STAT_BUFFS[s].indexOf(r.id) >= 0; }); });
}
function iconFile(g, name) { return g + '_' + String(name).replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_') + '.png'; }
/* the placed list the view-model already holds (one row per group at its highest level), plus categories, written-out buffs and the alternates */
function placedModel(vmDecor, L, G, core) {
  var list = arr(vmDecor && vmDecor.placed).map(function (p) {
    var b = buffRows(L, G, core, p.g, p.lv);
    return { g: p.g, n: p.n, q: p.q, lv: p.lv, mx: p.mx, count: p.count, ic: p.ic, nx: p.nx, cat: b.cat, sub: b.sub, buffs: b.rows, stats: b.stats };
  });
  return list;
}
/* groups the player holds by equivalence: a placed group makes every mutually exclusive variant owned (feedback: ME expansion) */
function ownedMap(L, placed) {
  var map = {}, via = {};
  placed.forEach(function (p) { map[String(p.g)] = true; });
  placed.forEach(function (p) {
    var ck = own(L.ME_LOOKUP, String(p.g)), vars = ck != null ? own(L.ME_CLUSTERS, String(ck)) : null;
    arr(vars).forEach(function (v) { var k = String(v); if (!map[k]) { map[k] = true; via[k] = p.g; } });
  });
  return { map: map, via: via };
}
function alternates(L, g, om) {
  var ck = own(L.ME_LOOKUP, String(g)), vars = ck != null ? own(L.ME_CLUSTERS, String(ck)) : null, names = L.DECOR_GROUPS || {};
  return arr(vars).filter(function (v) { return +v !== +g; }).map(function (v) { return { g: +v, n: own(names, String(v)) || 'Decoration', owned: !!om.map[String(v)] }; });
}
function notOwnedList(L, G, om) {
  var names = L.DECOR_GROUPS || {};
  return Object.keys(L.DECOR_DATA || {}).filter(function (k) { return !om.map[k]; }).map(function (k) {
    var n = own(names, k) || 'Decoration', b = buffRows(L, G, null, +k, 0);
    return { g: +k, n: n, q: 0, lv: 0, ic: iconFile(k, n), cat: b.cat, sub: b.sub, buffs: b.rows, stats: b.stats };
  }).sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : a.g - b.g; });
}
function decorSort(list, mode) {
  return list.slice().sort(function (a, b) {
    var nm = a.n < b.n ? -1 : a.n > b.n ? 1 : a.g - b.g;
    if (mode === 'za') return -nm;
    if (mode === 'lvhigh') return (b.lv - a.lv) || nm;
    if (mode === 'lvlow') return (a.lv - b.lv) || nm;
    if (mode === 'quality') return (b.q - a.q) || (b.lv - a.lv) || nm;
    return nm;
  });
}
function decorFilter(list, f) {
  var q = String(f.q || '').toLowerCase().trim();
  return list.filter(function (d) {
    if (f.stat && d.stats.indexOf(f.stat) < 0) return false;
    if (f.up && !d.nx) return false;
    if (q && d.n.toLowerCase().indexOf(q) < 0 && !d.buffs.some(function (b) { return b.n.toLowerCase().indexOf(q) >= 0; })) return false;
    return true;
  });
}
/* category sections: [{cat, name, items, subs:[{key, name, items}]}] in classic's order; subs only when two or more are non-empty */
function sections(G, list) {
  var by = {};
  list.forEach(function (d) { (by[d.cat] = by[d.cat] || []).push(d); });
  return CAT_ORDER.filter(function (c) { return by[c] && by[c].length; }).map(function (c) {
    var items = by[c], subs = [], order = G.SUB_CAT_ORDER[c];
    if (order) {
      var b = {}; items.forEach(function (d) { var k = d.sub || 'others_misc'; (b[k] = b[k] || []).push(d); });
      var ne = order.filter(function (k) { return b[k] && b[k].length; });
      if (ne.length > 1) subs = ne.map(function (k) { return { key: k, name: G.SUB_CAT_NAMES[k], items: b[k] }; });
    }
    return { cat: c, name: G.DECO_CAT_NAMES[c], items: items, subs: subs };
  });
}
/* sets: the complete ones (merged.decorations.suit) and the rest, each piece placed / owned / missing */
function setsModel(L, merged, placed, om) {
  var D = (merged && merged.decorations) || {}, suit = arr(D.suit).map(String), lvl = D.suitLevelBuff || {}, SU = L.DECOR_SUITS || {}, SG = L.DECOR_SUIT_GROUPS || {}, names = L.DECOR_GROUPS || {};
  var placedSet = {}; placed.forEach(function (p) { placedSet[String(p.g)] = true; });
  function pieces(sid, complete) {
    return arr(own(SG, sid)).map(function (g) {
      var k = String(g), st = placedSet[k] ? 'placed' : om.map[k] || complete ? 'owned' : 'missing';
      return { g: +g, n: own(names, k) || 'Decoration', ic: iconFile(k, own(names, k) || 'x'), st: st };
    });
  }
  function one(sid, complete) {
    var su = own(SU, sid), ps = pieces(sid, complete), have = ps.filter(function (p) { return p.st !== 'missing'; }).length;
    return { id: sid, name: su && typeof su.n === 'string' ? su.n : 'Decoration set', level: complete ? num(lvl[sid]) : 0, complete: complete, pieces: ps, have: have, placed: ps.filter(function (p) { return p.st === 'placed'; }).length, total: ps.length || (su ? num(su.c) : 0) };
  }
  var have = {}; suit.forEach(function (s) { have[s] = 1; });
  var done = suit.map(function (s) { return one(s, true); });
  var left = Object.keys(SU).filter(function (s) { return !have[s]; }).sort(function (a, b) { return a - b; }).map(function (s) { return one(s, false); });
  return { done: done, left: left };
}

/* ---- the Spend my shards panel ---- */
/* the order the Overview's decoration move tries the stats in (armory-core DECOR_STATS), then the rest: the tab that opens is the stat that move picks */
var PICK_ORDER = ['march_size', 'attack', 'hp', 'damage_boost', 'def', 'damage_red', 'capacity'];
var STAT_TABS = [['march_size', 'March Size'], ['attack', 'Attack'], ['hp', 'HP'], ['def', 'All units Defense'], ['damage_boost', 'DMG increase'], ['damage_red', 'Decreased DMG Taken'], ['capacity', 'Garage, dock and hangar capacity']];
function statTabLabel(id) { return (STAT_TABS.filter(function (t) { return t[0] === id; })[0] || [id, id])[1]; }
/* The all-units buff each of the four stats the Overview move tries is built on (armory-core DECOR_STATS); the move also counts the unit types the player marches with. */
var MAIN_ID = { march_size: '960012', attack: '930100', hp: '930000', damage_boost: '1001001' };
/* the classic advisor's ranking (core.computeDecorRecs, parity-tested), as plain rows (cost after spare pieces, ready, shortfall, relative bar).
   Views of the four main stats, all ranked by the Overview move's rule (gain per raw shard, then cost, then name), so the Overview's decoration
   move is always the top ready row of its stat in `byStatMine`:
     byStat      every buff the advisor lists for the stat (the classic list)
     byStatAll   the all-units buff only
     byStatMine  the all-units buff plus the unit types of `branches` (the Overview move's scope; equals byStatAll with no marches)
   data = { levels, index, mutex } */
function spendModel(core, inv, merged, data, statIds, branches) {
  var ids = statIds || STAT_TABS.map(function (t) { return t[0]; });
  var res = core.computeDecorRecs(ids, inv, merged, data), out = { shards: res.shardSummary, byStat: {}, byStatAll: {}, byStatMine: {}, order: ids, branches: arr(branches) };
  function plain(r, gainRows, roi) {
    return {
      g: r.group, n: String(r.name), ic: iconFile(r.group, r.name), from: r.fromLevel, to: r.toLevel, cost: r.shardCost, raw: r.rawShardCost, credit: r.groupCredit,
      have: r.universalShards, ready: !!r.ready, short: Math.max(0, r.shardCost - r.universalShards), roi: roi, bar: 0,
      gain: gainRows.map(function (b) { return { n: statName(b.label), v: b.displayDelta, rate: String(b.perShardLabel || '') }; }),
      also: arr(r.buffRows).filter(function (b) { return gainRows.indexOf(b) < 0; }).concat(arr(r.alsoRows)).map(function (b) { return { n: statName(b.label), v: b.displayDelta }; }), mutex: arr(r.mutexPartners).map(String)
    };
  }
  function bars(list) { var max = 0; list.forEach(function (r) { if (r.roi > max) max = r.roi; }); list.forEach(function (r) { r.bar = max > 0 && r.roi > 0 ? Math.min(100, Math.max(8, Math.round(r.roi / max * 100))) : 0; }); return list; }
  function scoped(rows, main, br) {
    var counted = {}; core.decorScopeIds(main, br).forEach(function (x) { counted[x[0]] = x[2]; });
    return bars(rows.map(function (r) {
      var m = arr(r.buffRows).filter(function (b) { return counted[String(b.id)]; }); if (!m.length) return null;
      return plain(r, m, m.reduce(function (a, b) { return a + b.rawDelta * counted[String(b.id)]; }, 0) / Math.max(r.rawShardCost, 1));
    }).filter(Boolean).sort(function (a, b) { return (b.roi - a.roi) || (a.cost - b.cost) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0); }));
  }
  ids.forEach(function (s) {
    var rows = arr(res.byStat[s]);
    out.byStat[s] = bars(rows.map(function (r) { return plain(r, arr(r.buffRows), r.roi); }));
    var main = MAIN_ID[s];
    if (main) { out.byStatAll[s] = scoped(rows, main, []); out.byStatMine[s] = scoped(rows, main, branches); }
  });
  return out;
}
/* mutual-exclusive file: { cluster: [{g, me:[groups]}] } -> group -> partner groups (the classic _adv_loadMutex) */
function mutexMap(data) {
  var m = {};
  Object.keys(data || {}).forEach(function (k) { arr(data[k]).forEach(function (mem) { if (mem && mem.g != null) m[String(mem.g)] = arr(mem.me).map(String); }); });
  return m;
}

/* ---- Formation ---- */
var SLOT_ORDER = [1, 2, 3, 11, 12, 13, 21, 22, 23];
var SLOT_DISPLAY = { 1: 1, 2: 2, 3: 3, 11: 4, 12: 5, 13: 6, 21: 7, 22: 8, 23: 9 };
var ARMY_LABELS = { '101': 'Army', '201': 'Navy', '301': 'Air Force' };
var TECH_NAMES = { '3': 'Defense', '4': 'Full Defense', '5': 'Swept Wing Formation' };
var FBUFF = {
  1000021: 'Unit HP', 1000022: 'Unit Attack', 1000023: 'DMG increase', 1000024: 'Decreased DMG Taken', 990202: 'All units Defense', 990208: 'Defense (attacking buildings)', 990209: 'Defense (defending buildings)',
  1001001: 'All units DMG increase', 1101040: 'All units Decreased DMG Taken', 9301160: 'All units Attack', 9301161: 'Army Attack', 9301162: 'Navy Attack', 9301163: 'Air Force Attack', 9301170: 'All units HP',
  9301201: 'Navy to Army DMG bonus', 9301202: 'Air Force to Navy DMG bonus', 9301203: 'Army to Air Force DMG bonus', 100017: 'Shark tier +1', 100018: 'Scorpion tier +1',
  100019: 'Shark specialization +1 (all slots)', 100020: 'Scorpion specialization +1 (all slots)', 100021: 'Shark deploys in an extra march', 100022: 'Scorpion deploys in an extra march', 100023: 'Eagle tier +1', 100024: 'Eagle specialization +1 (all slots)'
};
function fbuffName(id) { return own(FBUFF, id) || 'Other effect'; }
function fbuffVal(raw) { return '+' + (num(raw) / 100).toFixed(2).replace(/\.?0+$/, '') + '%'; }
/* "1=1000022,4000|1000023,500;2=1000022,4000" -> { slot: [{id, value}] } */
function parseBuffGroup(str) {
  var out = {};
  if (!str || typeof str !== 'string') return out;
  str.split(';').forEach(function (chunk) {
    var eq = chunk.indexOf('='); if (eq < 0) return;
    var rest = chunk.slice(eq + 1); if (!rest) return;
    out[chunk.slice(0, eq)] = rest.split('|').map(function (p) { var q = p.split(','); return { id: Number(q[0]), value: Number(q[1]) }; }).filter(function (b) { return b.id; });
  });
  return out;
}
/* the formations: the formation upload wins per formation over the battle reports, as classic overlays it */
function formationsMerged(reportF, supp) {
  var out = {}; Object.keys(reportF || {}).forEach(function (k) { out[k] = reportF[k]; });
  var sf = supp && supp.formations;
  if (sf && typeof sf === 'object') Object.keys(sf).forEach(function (k) { if (sf[k] && typeof sf[k] === 'object') out[k] = Object.assign({}, out[k] || {}, sf[k], { id: Number(k) }); });
  return out;
}
function formationCard(fid, f, ref) {
  var fm = ref && ref.formations && own(ref.formations, fid), sk = ref && ref.mastery_skill_per_formation && own(ref.mastery_skill_per_formation, fid);
  var o = { id: fid, name: fm && typeof fm.name === 'string' ? fm.name.replace(/^Formation:\s*/, '') : 'Formation ' + fid, icon: fm && typeof fm.icon === 'string' ? fm.icon.replace(/^assets\//, '') : '', skill: sk && typeof sk.name === 'string' ? sk.name : '', seen: !!f };
  if (!f) return o;
  var m = f.masterys && typeof f.masterys === 'object' ? f.masterys : {}, up = !!f.formationMasteryUp, total = 0, boost = 0;
  o.lv = num(f.lv); o.lvUp = !!f.formationLvUp; o.tier = num(f.quality); o.tierUp = !!f.formationQualityUp; o.specUp = up;
  o.slots = SLOT_ORDER.map(function (s) {
    var raw = m[s]; if (raw == null) return { n: SLOT_DISPLAY[s], lv: null, eff: null, plus: false };
    var lv = num(raw), plus = up && lv < 5; total += lv; if (plus) boost++;
    return { n: SLOT_DISPLAY[s], lv: lv, eff: lv + (plus ? 1 : 0), plus: plus };
  });
  o.total = total + boost; o.marching = !!f.isMarching;
  return o;
}
function techModel(ref, formations) {
  var src = null; ['1001', '1002', '1003'].forEach(function (k) { if (!src && formations[k] && formations[k].sciences) src = formations[k]; });
  var lv = (src && src.sciences) || {};
  return ['1', '2', '3', '4', '5'].map(function (sid) {
    var sci = ref && ref.sciences && own(ref.sciences, sid), max = sci ? Math.max(1, num(sci.max_level)) : 1, cur = Math.min(max, Math.max(0, num(lv[sid])));
    var row = cur > 0 && sci && Array.isArray(sci.levels) ? sci.levels[cur - 1] : null, chips = [], front = false;
    if (row && typeof row.buff_show === 'string' && row.buff_show) chips = row.buff_show.split('|').map(function (p) { var q = p.split(','); return { n: fbuffName(Number(q[0])), v: fbuffVal(q[1]) }; });
    else if (row && row.buff_group) { var pg = parseBuffGroup(row.buff_group), k0 = Object.keys(pg)[0]; chips = arr(pg[k0]).map(function (b) { return { n: fbuffName(b.id), v: fbuffVal(b.value) }; }); front = chips.length > 0; }
    return { sid: sid, name: own(TECH_NAMES, sid) || (sci && typeof sci.name === 'string' ? sci.name : 'Tech ' + sid), lv: cur, max: max, chips: chips, front: front, pct: Math.round(cur / max * 100), seen: !!src };
  });
}
function armyMastery(am) {
  if (!am || typeof am !== 'object') return null;
  var out = ['101', '201', '301'].filter(function (k) { return am[k] != null; }).map(function (k) { return { type: ARMY_LABELS[k], lv: Math.max(0, Math.min(20, num(am[k]) - Number(k))) }; });
  return out.length ? out : null;
}
/* talent info ids -> { levels: {group: level}, variants } (the classic decode: switchable nodes carry two variants in one levels list) */
function decodeTalent(infoId, tree) {
  var g = Math.floor(infoId / 1000) * 1000, node = tree && (tree[g] || tree[String(g)]);
  if (node && Array.isArray(node.levels)) for (var i = 0; i < node.levels.length; i++) if (node.levels[i].id === infoId) return { g: g, level: num(node.levels[i].level) };
  return { g: g, level: (infoId % 1000) - 1 };
}
function talentModel(ref, supp) {
  var tree = ref && ref.talent_tree && typeof ref.talent_tree === 'object' ? ref.talent_tree : {}, ids = supp && Array.isArray(supp.talents) ? supp.talents : null;
  if (!ids || !ids.length) return null;
  var levels = {};
  ids.forEach(function (id) { var x = decodeTalent(Math.floor(num(id)), tree); if (x.g && x.level > 0) levels[x.g] = x.level; });
  var sides = { left: [], right: [] }, power = 0, trained = 0, maxed = 0, maxPower = 0, spent = 0;
  Object.keys(tree).forEach(function (k) {
    var n = tree[k]; if (!n || typeof n !== 'object') return;
    var lv = num(levels[k]), max = num(n.max_lv), row = Array.isArray(n.levels) ? n.levels[lv] : null;
    var top = Array.isArray(n.levels) ? n.levels[max] : null; if (top && typeof top.power === 'number') maxPower += top.power;
    if (lv > 0 && Array.isArray(n.levels)) for (var ci = 0; ci <= lv && ci < n.levels.length; ci++) spent += num(n.levels[ci] && n.levels[ci].cost);
    if (lv > 0) { trained++; if (lv >= max) maxed++; if (row && typeof row.power === 'number') power += row.power; }
    var side = n.side === 'right' ? 'right' : 'left';
    sides[side].push({ id: Number(k), name: typeof n.name === 'string' ? n.name : 'Talent', desc: typeof n.desc === 'string' ? n.desc : '', icon: typeof n.icon_name === 'string' ? n.icon_name : '', lv: lv, max: max, sw: !!n.is_switch,
      val: lv > 0 && row && !n.is_switch && num(row.effect_value) > 0 ? fbuffVal(row.effect_value) : '', buff: row && row.effect_id ? fbuffName(Number(row.effect_id)) : '' });
  });
  ['left', 'right'].forEach(function (s) { sides[s].sort(function (a, b) { return a.id - b.id; }); });
  return { sides: sides, total: Object.keys(tree).length, trained: trained, maxed: maxed, power: power, maxPower: maxPower, spent: spent, held: supp && supp.currencies ? num(supp.currencies['2800000']) : null };
}

var Logic = {
  num: num, fmtInt: fmtInt, pctText: pctText, statName: statName, skinVal: skinVal, skinNum: skinNum, baseVal: baseVal, statKey: statKey, KEY_STATS: KEY_STATS,
  skinState: skinState, skinRow: skinRow, skinList: skinList, skinSort: skinSort, skinFilter: skinFilter, skinNotOwned: skinNotOwned, skinChain: skinChain, citySkill: citySkill, skinFilterOptions: skinFilterOptions,
  bdRow: bdRow, bdSort: bdSort, bdNotOwned: bdNotOwned, skinTotals: skinTotals, baseDecorTotals: baseDecorTotals, stripRows: stripRows,
  dataFor: dataFor, buffRows: buffRows, placedModel: placedModel, ownedMap: ownedMap, alternates: alternates, notOwnedList: notOwnedList, decorSort: decorSort, decorFilter: decorFilter, sections: sections, setsModel: setsModel, iconFile: iconFile, statGroups: statGroups,
  STAT_TABS: STAT_TABS, PICK_ORDER: PICK_ORDER, MAIN_ID: MAIN_ID, statTabLabel: statTabLabel, spendModel: spendModel, mutexMap: mutexMap,
  parseBuffGroup: parseBuffGroup, formationsMerged: formationsMerged, formationCard: formationCard, techModel: techModel, armyMastery: armyMastery, talentModel: talentModel, decodeTalent: decodeTalent, fbuffName: fbuffName, fbuffVal: fbuffVal
};
root.ArmoryBaseLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryBase = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, qCls = H.qCls, classicUrl = H.classicUrl, readOnly = H.readOnly;
var SEGS = [['decor', 'Decor'], ['skins', 'Skins'], ['base-decor', 'Base decor'], ['formation', 'Formation']];
var PAGE = 24, STEP = 48, TOP = 5, OPEN_MAX = 12;
var cur = { seg: 'decor', q: {} }, wired = false;
var DF = { q: '', stat: '', up: false, sort: 'name' }, D = Object.assign({}, DF), open = {}, pageN = {};
var SF = { q: '', buff: '', skill: '', sort: 'equipped' }, K = Object.assign({}, SF), skinN = PAGE, notN = {};
var BF = { q: '', sort: 'name' }, B = Object.assign({}, BF), bdN = PAGE;
var T = null, TFail = false, TQ = null, MUT = null, REF = null, REFFail = false, spend = { open: false, tab: 'march_size', all: false, units: 'mine', err: false };

var CSS =
  '.bse-sum{padding:0}@media (min-width:768px){.bse-sum .bse-t{max-width:680px}}.bse-t{margin:0;width:100%;border-collapse:collapse;font-size:var(--fs-14)}.bse-t th{font-weight:400;font-size:var(--fs-13);color:var(--muted);text-align:right;padding:0 0 4px 8px}.bse-t th:first-child,.bse-t td:first-child{text-align:left;padding-left:0}' +
  '.bse-t td{padding:6px 0 6px 8px;text-align:right;border-top:1px solid var(--rule);font-weight:600}.bse-t td:first-child{font-weight:400;color:var(--text)}.bse-t td.z{color:var(--dim);font-weight:400}' +
  '.bse-note{margin-top:8px;font-size:var(--fs-12);color:var(--muted)}' +
  '.bse-sec{padding:0}.bse-hd{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--row);padding:8px 12px;text-align:left;color:inherit}.bse-hd:active{background:var(--card-hi)}' +
  '@media (min-width:768px){.bse-hd{padding:8px 16px}}.bse-hn{font:700 var(--fs-17)/1.25 var(--display)}.bse-ht{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.bse-hm{font-size:var(--fs-13);color:var(--muted)}' +
  '.bse-chev{transition:transform var(--t);flex:none;color:var(--muted)}.bse-hd[aria-expanded="true"] .bse-chev{transform:rotate(180deg)}' +
  '.bse-strip{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 12px}.bse-strip .ico,.bse-strip .fb{width:32px;height:32px}' +
  '.bse-body{padding:0 12px 12px;border-top:1px solid var(--rule);padding-top:12px}@media (min-width:768px){.bse-body{padding:16px}.bse-strip{padding:0 16px 16px}}' +
  '.bse-sub{margin:12px 0 8px;font-size:var(--fs-13);color:var(--muted);font-weight:700}.bse-sub:first-child{margin-top:0}' +
  '.bse-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}' +
  '.bse-c{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0;text-align:left;color:inherit;width:100%}button.bse-c:active{background:var(--card-hi)}' +
  '.bse-c.q3{border-color:var(--q3)}.bse-c.q4{border-color:var(--q4)}.bse-c.q5{border-color:var(--q5)}.bse-c.q6{border-color:var(--q6)}.bse-c.off{opacity:.7;border-style:dashed}' +
  '.bse-ch{display:flex;align-items:center;gap:8px}.bse-ch .ico,.bse-ch .fb{width:40px;height:40px}.bse-ct{flex:1;min-width:0}.bse-cn{font-size:var(--fs-14);font-weight:600;line-height:1.25;overflow-wrap:anywhere}.bse-cs{font-size:var(--fs-12);color:var(--muted)}' +
  '.bse-bf{margin:0;padding:0;list-style:none}.bse-bf li{display:flex;justify-content:space-between;font-size:var(--fs-13);color:var(--muted)}.bse-bf li > span:last-child{margin-left:8px;color:var(--text);white-space:nowrap;font-weight:600}' +
  '.bse-bl{font-size:var(--fs-12);color:var(--muted);font-weight:700;margin-top:2px}' +
  '.bse-skin .ico,.bse-skin .fb{width:56px;height:56px}.bse-pills{display:flex;flex-wrap:wrap;gap:4px}' +
  '.bse-sk{display:flex;align-items:center;gap:4px;font-size:var(--fs-13);color:var(--accent);font-weight:600;min-height:40px;text-align:left}' +
  '.bse-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.bse-f .sel,.bse-f .fld{min-width:0;width:100%}' +
  '.bse-fs{display:none}.bse-cb{min-height:40px;padding:0 14px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--surface);font-size:var(--fs-14);font-weight:600;color:var(--muted)}.bse-cb[aria-pressed="true"]{color:var(--text);background:var(--card-hi);border-color:var(--muted)}' +
  '.bse-tab{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}' +
  '.bse-rk{display:flex;flex-direction:column;gap:8px}.bse-r{border:1px solid var(--border);border-radius:var(--r-card);padding:12px;background:var(--surface);display:flex;flex-direction:column;gap:8px}' +
  '.bse-r .bse-ch .ico,.bse-r .bse-ch .fb{width:40px;height:40px}.bse-n{font:700 var(--fs-15)/1 var(--display);color:var(--muted);min-width:24px}' +
  '.bse-gl{display:flex;justify-content:space-between;font-size:var(--fs-14)}.bse-gl > span:last-child{margin-left:12px;font-weight:700;white-space:nowrap}.bse-rate{font-size:var(--fs-12);color:var(--muted)}' +
  '.bse-cost{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:var(--fs-13);color:var(--muted)}.bse-cost b{color:var(--text)}' +
  '.bse-dot{color:var(--muted)}.bse-ok{color:var(--ok);font-weight:700}.bse-me{font-size:var(--fs-12);color:var(--muted)}' +
  '.bse-set{display:flex;flex-direction:column;gap:8px;width:100%;min-height:var(--row);padding:8px 0;border-top:1px solid var(--rule);text-align:left;color:inherit}.bse-set:first-child{border-top:0}' +
  '.bse-sr{display:flex;align-items:center;gap:8px;justify-content:space-between}.bse-sn{font-size:var(--fs-15);font-weight:600}.bse-comp{display:flex;flex-wrap:wrap;gap:4px}.bse-comp .ico,.bse-comp .fb{width:32px;height:32px}.bse-comp .gone{opacity:.35}' +
  '.bse-ft{display:grid;grid-template-columns:1fr;gap:12px}.bse-fc .bse-ch .ico,.bse-fc .bse-ch .fb{width:64px;height:80px}.bse-spec{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:8px}' +
  '.bse-sl{aspect-ratio:1/1;border:1px solid var(--border);border-radius:var(--r-chip);display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);font-size:var(--fs-12);color:var(--muted)}.bse-sl b{font-size:var(--fs-17);color:var(--text)}' +
  '.bse-sl.s5{border-color:var(--ok);color:var(--ok)}.bse-sl.s5 b{color:var(--ok)}.bse-sl.s4{border-color:var(--rule)}.bse-sl.s0{opacity:.6}' +
  '.bse-tch{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.bse-tch > span{font-size:var(--fs-12);border:1px solid var(--border);border-radius:var(--r-chip);padding:2px 6px;background:var(--bg)}' +
  '.bse-tl{margin:0;padding:0;list-style:none}.bse-tl li{display:flex;align-items:center;gap:12px;min-height:var(--row);padding:8px 0;border-top:1px solid var(--rule)}.bse-tl li:first-child{border-top:0}.bse-tl .ico,.bse-tl .fb{width:40px;height:40px}' +
  '.bse-tl .off{opacity:.55}.bse-tt{flex:1;min-width:0}.bse-tv{white-space:nowrap;font-size:var(--fs-13);color:var(--muted);text-align:right}' +
  '.bse-line{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:var(--fs-14);color:var(--muted)}.bse-line span b{color:var(--text)}' +
  '@media (min-width:768px){.bse-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.bse-fbtn{display:none}.bse-fs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}.bse-ft{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
  '@media (min-width:1024px){.bse-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.bse-rk{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.bse-tl.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px}.bse-tl.two li:nth-child(2){border-top:0}}' +
  '@media (min-width:1200px){.bse-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}';

function injectCss() {
  if (document.getElementById('bse-style')) return;
  var s = document.createElement('style'); s.id = 'bse-style'; s.textContent = CSS; document.head.appendChild(s);
}
function sp(t, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + nd(t) + '</span>'; }
function dots(a) { return a.filter(Boolean).join('<span class="bse-dot" aria-hidden="true">\u00B7</span>'); }
function icon(file, cls, fb, alt) { return art(BASE + file, 'ico ' + cls, fb, alt || ''); }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }
function classicLink(tab, text) { return '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl(tab)) + '">' + ic('ext', 'sm') + '<span>' + esc(text) + '</span></a></div>'; }
function noHy(t) { return String(t).replace(/-/g, '‑'); }
function more(shown, total, key, step) { return total > shown ? '<button class="btn more" type="button" data-bsemore="' + key + '"><span>Show ' + nd(fmtInt(Math.min(step || STEP, total - shown))) + ' more</span></button>' : ''; }
function supp() { var s = S.res && S.res.supp || {}; return s; }
function priv() { return (S.res && S.res.privacy) || {}; }
function dl() { return S.res && S.res.statics && S.res.statics.decorLookups; }
function bump(map, k, base) { map[k] = (map[k] || base) + STEP; }

/* ---- the big tables ---- */
function tables(cb) {
  if (T) return cb(T);
  if (TFail) return cb(null);
  if (TQ) { TQ.push(cb); return; }
  TQ = [cb];
  var sc = document.createElement('script'); sc.src = 'tw-game-data-base.js';
  sc.onload = function () { T = window.TWGameDataBase || null; TFail = !T; var q = TQ; TQ = null; q.forEach(function (f) { f(T); }); };
  sc.onerror = function () { TFail = true; var q = TQ; TQ = null; q.forEach(function (f) { f(null); }); };
  document.body.appendChild(sc);
}
function getJson(path) { return fetch(path).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
function fail(e) {
  if (window.console) console.error(e);
  var v = $('#v-base'); if (v) v.innerHTML = '<div class="vb"><div class="empty">Could not show the Base section. Reload the page to try again.</div></div>';
}
function partFail(what) { return '<div class="empty">Could not load ' + esc(what) + '. Check your connection and reload the page.</div>'; }

/* ---- the strip ---- */
function stripHtml() {
  var vm = S.vm, dec = vm.decor && vm.decor.placedKinds ? vm.decor.totals : null;
  if (!T && !TFail && !TQ) return '';
  var st = Logic.skinState(S.res.merged && S.res.merged.skins), skin = T && st.known ? Logic.skinTotals(T, st) : null, bd = T && st.castle.length ? Logic.baseDecorTotals(T, st) : null;
  if (!dec && !skin && !bd) return '';
  var rows = Logic.stripRows(dec, skin, bd);
  var body = rows.map(function (r) {
    var c = function (v) { return '<td' + (v === '–' ? ' class="z"' : '') + '>' + (v === '–' ? '<span aria-hidden="true">–</span><span class="sr">none</span>' : '<span translate="no">' + esc(v) + '</span>') + '</td>'; };
    return '<tr><td>' + esc(r.label) + '</td>' + c(r.decor) + c(r.skin) + c(r.bdecor) + '</tr>';
  }).join('');
  return '<section class="card bse-sum" aria-label="What your base adds" style="padding:12px"><h2 class="sub" style="margin-bottom:8px">What your base adds</h2><table class="bse-t"><thead><tr><th scope="col"><span class="sr">Stat</span></th><th scope="col">Decor</th><th scope="col">Skins</th><th scope="col">Base decor</th></tr></thead><tbody>' + body + '</tbody></table>' +
    '<p class="bse-note">' + esc('Adds up the figures on the cards: placed decorations; the Owned bonus of every owned skin (the highest level of each chain) plus the When equipped buffs of the equipped skin; the same for base decorations. Halos and the other collections are not included, so a battle report that lists them can show more.') + '</p>' + (TFail ? '<p class="bse-note">' + esc('Skin and base decoration figures could not load.') + '</p>' : '') + '</section>';
}

/* ---- Decor ---- */
function buffList(b, max) { return b.length ? '<ul class="bse-bf">' + b.slice(0, max || 6).map(function (x) { return '<li><span>' + nd(x.n) + '</span><span translate="no">' + esc(x.v) + '</span></li>'; }).join('') + '</ul>' : ''; }
function decorCard(x, off) {
  var sub = off ? '' : sp('Lv.' + x.lv + ' · ' + x.count + (x.count === 1 ? ' piece' : ' pieces'));
  var inner = '<span class="bse-ch">' + icon('decor-icons/' + x.ic, qCls(x.q), x.n.charAt(0)) + '<span class="bse-ct"><span class="bse-cn" translate="no" style="display:block">' + esc(noHy(x.n)) + '</span>' + (sub ? '<span class="bse-cs" style="display:block">' + sub + '</span>' : '') + '</span></span>' + buffList(x.buffs);
  return '<button class="bse-c ' + qCls(x.q) + (off ? ' off' : '') + '" type="button" data-bseitem="' + (off ? 'g' + x.g : esc(x.n)) + '">' + inner + '</button>';
}
function decorModel() {
  var vm = S.vm, L = dl();
  if (!L) return null;
  var placed = Logic.placedModel(vm.decor, L, G, core), om = Logic.ownedMap(L, placed);
  return { placed: placed, om: om, L: L };
}
var DM = null, DMFor = null;
function decorData() { var L = dl(); if (!DM || DMFor !== S.vm) { DM = decorModel(); DMFor = S.vm; } return DM; }
function decorSections() {
  var dm = decorData(), f = Logic.decorSort(Logic.decorFilter(dm.placed, D), D.sort), secs = Logic.sections(G, f), html = '';
  var anyOpen = false, want = +cur.q.cat;
  secs.forEach(function (s, i) {
    var k = 'c' + s.cat, isOpen = open[k] != null ? open[k] : (s.items.length <= OPEN_MAX || i === 0);
    if (isOpen) anyOpen = true;
    var shown = pageN[k] || PAGE, strip = s.items.slice(0, 8).map(function (x) { return icon('decor-icons/' + x.ic, qCls(x.q), x.n.charAt(0)); }).join('');
    var body = '';
    if (isOpen) {
      var take = shown, items = s.items, pieces = function (list) { var o = list.slice(0, take); take -= o.length; return o; };
      if (s.subs.length) body = s.subs.map(function (u) { var part = pieces(u.items); return part.length ? '<h3 class="bse-sub">' + nd(u.name + ' (' + u.items.length + ')') + '</h3><div class="bse-grid">' + part.map(function (x) { return decorCard(x, false); }).join('') + '</div>' : ''; }).join('');
      else body = '<div class="bse-grid">' + pieces(items).map(function (x) { return decorCard(x, false); }).join('') + '</div>';
      body = '<div class="bse-body">' + body + more(Math.min(shown, items.length), items.length, k) + '</div>';
    }
    html += '<section class="card bse-sec" id="bsec-' + s.cat + '"><button class="bse-hd" type="button" data-bseopen="' + k + '" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">' + esc(s.name) + '</span><span class="bse-hm">' + nd(s.items.length + (s.items.length === 1 ? ' decoration' : ' decorations') + ' placed') + '</span></span>' + ic('down', 'bse-chev') + '</button>' +
      (isOpen ? '' : '<div class="bse-strip">' + strip + '</div>') + body + '</section>';
  });
  return { html: html, n: f.length, secs: secs };
}
function setsHtml() {
  var dm = decorData(), sm = Logic.setsModel(dm.L, S.res.merged, dm.placed, dm.om);
  if (!sm.done.length && !sm.left.length) return '';
  function row(s) {
    var st = s.complete ? sp('Complete · ' + s.placed + ' of ' + s.total + ' placed' + (s.level ? ' · Lv.' + s.level : '')) : sp(s.have + ' of ' + s.total + ' owned');
    return '<button class="bse-set" type="button" data-bseset="' + esc(s.id) + '"><span class="bse-sr"><span class="bse-sn" translate="no">' + esc(s.name) + '</span>' + ic('chev', 'sm') + '</span><span class="t13 muted">' + st + '</span><span class="bse-comp">' + s.pieces.slice(0, 12).map(function (p) { return icon('decor-icons/' + p.ic, p.st === 'missing' ? 'gone' : p.st === 'owned' ? '' : 'q5', p.n.charAt(0)); }).join('') + '</span></button>';
  }
  function part(key, title, list) {
    if (!list.length) return '';
    var isOpen = !!open[key];
    return '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="' + key + '" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">' + esc(title) + '</span><span class="bse-hm">' + nd(list.length + (list.length === 1 ? ' set' : ' sets')) + '</span></span>' + ic('down', 'bse-chev') + '</button>' + (isOpen ? '<div class="bse-body">' + list.map(row).join('') + '</div>' : '') + '</section>';
  }
  return part('setsDone', 'Complete decoration sets', sm.done) + part('setsLeft', 'Sets still to collect', sm.left);
}
function notOwnedHtml() {
  var dm = decorData(), f = Logic.decorSort(Logic.decorFilter(Logic.notOwnedList(dm.L, G, dm.om), Object.assign({}, D, { up: false })), 'name');
  if (!f.length) return '';
  var isOpen = !!open.notOwned, shown = pageN.notOwned || PAGE;
  return '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="notOwned" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">Not owned</span><span class="bse-hm">' + nd(f.length + ' decorations, level 1 buffs') + '</span></span>' + ic('down', 'bse-chev') + '</button>' +
    (isOpen ? '<div class="bse-body"><div class="bse-grid">' + f.slice(0, shown).map(function (x) { return decorCard(x, true); }).join('') + '</div>' + more(Math.min(shown, f.length), f.length, 'notOwned') + '</div>' : '') + '</section>';
}
function dDirty() { return (D.stat ? 1 : 0) + (D.up ? 1 : 0) + (D.sort !== 'name' ? 1 : 0); }
function dBtn() { var n = dDirty(); return 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }
var D_STATS = [['', 'All stats']].concat(Logic.STAT_TABS.map(function (t) { return [t[0], t[1]]; }));
var D_SORT = [['name', 'Name A to Z'], ['za', 'Name Z to A'], ['lvhigh', 'Level, high to low'], ['lvlow', 'Level, low to high'], ['quality', 'Quality']];
function sel(id, lab, list, val, attr) { return '<label class="bse-f"><span>' + esc(lab) + '</span><select class="sel" ' + attr + '="' + id + '">' + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (/\d/.test(o[1]) ? ' translate="no"' : '') + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
function decorControls() {
  return '<div class="fbar"><div class="grow"><input class="fld" type="search" data-bsedq placeholder="Search name or stat" aria-label="Search decorations" value="' + esc(D.q) + '"></div><button class="btn bse-fbtn" type="button" data-open="bsedfilter">' + ic('sliders', 'sm') + '<span>' + esc(dBtn()) + '</span></button></div>' +
    '<div class="bse-fs">' + sel('stat', 'Stat', D_STATS, D.stat, 'data-bsed') + sel('sort', 'Sort', D_SORT, D.sort, 'data-bsed') + '<label class="bse-f"><span>Shards</span><select class="sel" data-bsed="up"><option value=""' + (D.up ? '' : ' selected') + '>All</option><option value="1"' + (D.up ? ' selected' : '') + '>Can upgrade with shards</option></select></label></div>';
}
function decorPane() {
  var L = dl(), vm = S.vm;
  if (!vm.decor || !vm.decor.placedKinds) return needData('No decoration data yet.');
  if (!L) return partFail('the decoration list');
  var ss = decorSections(), tally = '<p class="t13 muted" id="bseTally" role="status">' + nd(vm.decor.placedKinds + ' kinds placed (' + vm.decor.placedPieces + ' pieces)' + (ss.n !== vm.decor.placedKinds ? ' · showing ' + ss.n : '')) + '</p>';
  return spendHtml() + decorControls() + tally + '<div id="bseSecs" class="bse-secs" style="display:flex;flex-direction:column;gap:12px">' + (ss.html || '<div class="empty">No decorations match. <button class="tb link" type="button" data-bseclear="d">Clear filters</button></div>') + '</div>' + setsHtml() + notOwnedHtml() + classicLink('decorations', 'See the decoration cards on the classic page');
}
function dRefresh() {
  var s = $('#bseSecs'); if (!s) return;
  var ss = decorSections(); s.innerHTML = ss.html || '<div class="empty">No decorations match. <button class="tb link" type="button" data-bseclear="d">Clear filters</button></div>';
  var t = $('#bseTally'); if (t) t.innerHTML = nd(S.vm.decor.placedKinds + ' kinds placed (' + S.vm.decor.placedPieces + ' pieces)' + (ss.n !== S.vm.decor.placedKinds ? ' · showing ' + ss.n : ''));
  $$('.bse-fbtn span').forEach(function (b) { b.textContent = dBtn(); });
  $$('[data-bsed]').forEach(function (x) { var k = x.dataset.bsed, v = k === 'up' ? (D.up ? '1' : '') : D[k]; if (x.value !== String(v)) x.value = String(v); });
  var q = $('[data-bsedq]'); if (q && q.value !== D.q && document.activeElement !== q) q.value = D.q;
}
function paneRefreshAll() { var v = $('#v-base [data-pane="decor"]'); if (v) v.innerHTML = decorPane(); }

/* ---- Spend my shards ---- */
function spendOwner() { return !readOnly() && S.res.identity && S.res.identity.unlocked && S.vm.decor && S.vm.decor.known; }
function spendHtml() {
  if (!spendOwner()) return '';
  var sh = S.vm.decor.shards, isOpen = spend.open;
  var head = '<button class="bse-hd" type="button" data-bsespend aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">Spend my shards</span><span class="bse-hm">' + nd(fmtInt(sh) + ' Universal Decor Shards in bag') + '</span></span>' + ic('down', 'bse-chev') + '</button>';
  var body = '';
  if (isOpen) {
    if (spend.err) body = '<div class="bse-body">' + partFail('the upgrade costs') + '</div>';
    else if (!spend.model) body = '<div class="bse-body"><p class="muted t13">Working out the best upgrades…</p></div>';
    else {
      var m = spend.model, main = !!Logic.MAIN_ID[spend.tab], mode = spend.units === 'mine' && !m.branches.length ? 'all' : spend.units, rows = (main ? (mode === 'every' ? m.byStat : mode === 'all' ? m.byStatAll : m.byStatMine) : m.byStat)[spend.tab] || [], shown = spend.all ? rows : rows.slice(0, TOP), s = m.shards;
      var tabs = '<div class="bse-tab" role="group" aria-label="Stat to raise">' + Logic.STAT_TABS.map(function (t) { return '<button class="bse-cb" type="button" data-bsetab="' + t[0] + '" aria-pressed="' + (spend.tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>';
      body = '<div class="bse-body"><p class="bse-line">' + dots([sp(fmtInt(s.universal) + ' shards in bag'), sp(fmtInt(s.directShards) + ' as shards and ' + fmtInt(s.boxShards) + ' from boxes')]) + '</p>' +
        (s.luckyChests > 0 ? '<p class="bse-note">' + nd(s.luckyChests + ' Lucky Decor Shard Chests in the bag are not counted: each opens for 10 to 1,000 shards.') + '</p>' : '') + tabs +
        (main && spend.tab !== 'march_size' ? '<div class="bse-tab" role="group" aria-label="Which buffs count">' + (m.branches.length ? [['mine', 'My ' + m.branches.join(' and ') + ' marches'], ['all', 'All units only'], ['every', 'Every unit type']] : [['all', 'All units only'], ['every', 'Every unit type']]).map(function (o) { return '<button class="bse-cb" type="button" data-bseunits="' + o[0] + '" aria-pressed="' + (mode === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>' : '') +
        '<p class="t13 muted" style="margin-bottom:8px">' + esc('Best first: the most ' + Logic.statTabLabel(spend.tab).toLowerCase() + ' for each shard spent.' + (main && spend.tab !== 'march_size' ? (mode === 'mine' ? ' Counts all-units buffs and the ' + m.branches.join(' and ') + ' buffs, the way the Overview move does.' : mode === 'all' ? ' Only the buff that applies to all units counts.' : ' Army, Navy and Air Force buffs count too.') : '')) + '</p>' +
        (rows.length ? '<div class="bse-rk">' + shown.map(function (r, i) { return spendRow(r, i + 1); }).join('') + '</div>' + (rows.length > TOP ? '<button class="btn more" type="button" data-bsespendall><span>' + (spend.all ? 'Show the top ' + nd(String(TOP)) + ' only' : 'Show all ' + nd(String(rows.length))) + '</span></button>' : '') : '<div class="empty">No upgrades for this stat right now.</div>') + '</div>';
    }
  }
  return '<section class="card bse-sec" id="bseSpend">' + head + body + '</section>';
}
function spendRow(r, rank) {
  var gain = r.gain.map(function (g) { return '<div><div class="bse-gl"><span>' + nd(g.n) + '</span><span translate="no">' + esc(g.v) + '</span></div>' + (g.rate ? '<div class="bse-rate">' + esc(g.rate) + '</div>' : '') + '</div>'; }).join('');
  var cost = '<div class="bse-cost">' + dots([sp(fmtInt(r.cost) + ' shards'), r.credit > 0 && r.cost < r.raw ? sp('after ' + fmtInt(r.credit) + ' from spare pieces') : '', r.ready ? '<span class="bse-ok">Ready to upgrade</span>' : sp(fmtInt(r.short) + ' more needed')]) + '</div>';
  var me = r.mutex.length ? '<p class="bse-me">' + esc('Only one of this and ' + r.mutex.slice(0, 2).join(', ') + (r.mutex.length > 2 ? ' and ' + (r.mutex.length - 2) + ' more' : '') + ' can be placed.') + '</p>' : '';
  var also = r.also.length ? '<p class="bse-me">' + esc('Also gives ' + r.also.map(function (a) { return a.n + ' ' + a.v; }).join(', ')) + '</p>' : '';
  return '<div class="bse-r"><div class="bse-ch"><span class="bse-n" translate="no">' + rank + '</span>' + icon('decor-icons/' + r.ic, '', r.n.charAt(0)) + '<span class="bse-ct"><button class="bse-cn tb link" type="button" data-bseitem="' + esc(r.n) + '" translate="no" style="justify-content:flex-start;min-height:24px;padding:0;font-size:var(--fs-15)">' + esc(noHy(r.n)) + '</button><span class="bse-cs" style="display:block">' + sp('Lv.' + r.from + ' to Lv.' + r.to) + '</span></span></div>' +
    (r.bar ? '<div class="meter r-' + H.ramp(r.bar) + '" role="img" aria-label="' + r.bar + ' percent of the best value for this stat"><i style="width:' + r.bar + '%"></i></div>' : '') + gain + also + cost + me + '</div>';
}
function loadSpend() {
  if (spend.model || spend.loading) return;
  spend.loading = true;
  var st = S.res.statics || {};
  var inv = priv().inv ? null : (supp().inv || null);
  getJson('data/decoration-mutual-exclusive.json').catch(function () { return null; }).then(function (mut) {
    spend.loading = false;
    try {
      if (!st.decorLevels || !st.decorIndex) throw new Error('decoration tables missing');
      spend.model = Logic.spendModel(core, inv, S.res.merged, { levels: st.decorLevels, index: st.decorIndex, mutex: mut ? Logic.mutexMap(mut) : {} }, null, S.vm.decor.branches || (S.vm.movesInput && S.vm.movesInput.decor.branches));
      /* the best stat first: the first tab with a row the bag can afford, else the first with any row */
      var ord = Logic.PICK_ORDER, pick = ord.filter(function (s) { return ((Logic.MAIN_ID[s] ? spend.model.byStatMine : spend.model.byStat)[s] || []).some(function (r) { return r.ready; }); })[0] || ord.filter(function (s) { return (spend.model.byStat[s] || []).length; })[0];
      if (!spend.touched && pick) spend.tab = pick;
    } catch (e) { if (window.console) console.error(e); spend.err = true; }
    var sec = $('#bseSpend'); if (sec) sec.outerHTML = spendHtml();
  });
}

/* ---- item and set sheets ---- */
function itemSheet(arg) {
  var L = dl(); if (!L || !S.vm) return null;
  var dm = decorData(), key = String(arg), x = null, off = /^g\d+$/.test(key);
  if (off) { var g = +key.slice(1); x = Logic.notOwnedList(L, G, dm.om).filter(function (p) { return p.g === g; })[0] || null; }
  else x = dm.placed.filter(function (p) { return p.n === key; })[0] || null;
  if (!x) return null;
  var head = '<div class="sh-hero">' + icon('decor-icons/' + x.ic, qCls(x.q), x.n.charAt(0)) + '<div><span class="pill p-lv" translate="no">' + (off ? 'Not owned' : 'Lv.' + x.lv) + '</span><div class="t13 muted" style="margin-top:4px">' + (off ? nd(G.DECO_CAT_NAMES[x.cat]) : nd(G.DECO_CAT_NAMES[x.cat] + ' · ' + x.count + (x.count === 1 ? ' piece' : ' pieces') + ' placed')) + '</div></div></div>';
  var o = head + (x.buffs.length ? '<section class="card"><h3 class="disp" style="font-size:var(--fs-17)">' + (off ? 'Buffs at level 1' : nd('Buffs at Lv.' + x.lv)) + '</h3>' + buffList(x.buffs, 12) + '</section>' : '');
  var have = S.vm.decor.shards, nx = x.nx;
  if (!off && nx) {
    var net = Math.max(0, nx.raw - nx.credit), pct = Math.min(100, Math.round(have / Math.max(net, 1) * 100));
    var STATS = { '960012': ['March Size', true], '930100': ['All units Attack', false], '930000': ['All units HP', false], '1001001': ['All units DMG increase', false] };
    var gain = Object.keys(nx.dl).filter(function (k) { return STATS[k]; }).map(function (k) { var v = nx.dl[k]; return esc(STATS[k][0]) + ' ' + nm(STATS[k][1] ? '+' + v : '+' + (v / 100) + '%'); });
    o += '<section class="card"><h3 class="disp" style="font-size:var(--fs-20)">Next level: ' + nm('Lv.' + nx.to) + '</h3>' + (gain.length ? '<p style="margin-top:8px">' + gain.join(', ') + '</p>' : '') +
      '<div class="nb" style="margin-top:12px" data-numwrap><div class="n" data-num translate="no">' + fmtInt(net) + '</div><div class="l lbl">Shards to upgrade</div><div class="s src"><span translate="no">' + fmtInt(have) + '</span> in bag</div></div>' +
      '<div class="meter lg r-' + H.ramp(pct) + '" style="margin-top:12px" role="img" aria-label="' + pct + ' percent of the shards needed"><i style="width:' + Math.max(2, pct) + '%"></i></div>' +
      '<p class="t13 muted" style="margin-top:8px">' + (have >= net ? 'Your bag covers this upgrade.' : 'You need <span translate="no">' + fmtInt(net - have) + '</span> more shards.') + '</p></section>';
  } else if (!off) o += '<section class="card"><p class="muted">' + (x.lv >= x.mx ? 'This decoration is at its top level.' : 'This decoration upgrades with its own item, not Universal Decor Shards.') + '</p></section>';
  var alt = Logic.alternates(L, x.g, dm.om);
  if (alt.length) o += '<section class="card"><h3 class="disp" style="font-size:var(--fs-17)">Same buffs, other look</h3><p class="t13 muted" style="margin:4px 0 8px">Only one of these can be placed at a time. Owning one counts as owning them all.</p><div class="bse-comp">' + alt.map(function (a) { return icon('decor-icons/' + Logic.iconFile(a.g, a.n), a.owned ? '' : 'gone', a.n.charAt(0), a.n); }).join('') + '</div><ul class="bse-bf" style="margin-top:8px">' + alt.map(function (a) { return '<li><span translate="no">' + esc(noHy(a.n)) + '</span><span>' + (a.owned ? 'Owned' : 'Not owned') + '</span></li>'; }).join('') + '</ul></section>';
  return [x.n, o, true];
}
function setSheet(arg) {
  var L = dl(); if (!L || !S.vm) return null;
  var dm = decorData(), sm = Logic.setsModel(L, S.res.merged, dm.placed, dm.om), s = sm.done.concat(sm.left).filter(function (z) { return String(z.id) === String(arg); })[0];
  if (!s) return null;
  var lab = { placed: 'Placed', owned: s.complete ? 'In your bag' : 'Owned', missing: 'Not owned' };
  return [s.name, '<p class="t13 muted">' + (s.complete ? nd('Complete · ' + s.placed + ' of ' + s.total + ' placed' + (s.level ? ' · Lv.' + s.level : '')) : nd(s.have + ' of ' + s.total + ' pieces owned')) + '</p><ul class="bse-tl" style="margin-top:8px">' + s.pieces.map(function (p) {
    return '<li>' + icon('decor-icons/' + p.ic, p.st === 'placed' ? 'q5' : '', p.n.charAt(0)) + '<span class="bse-tt" translate="no">' + esc(noHy(p.n)) + '</span><span class="bse-tv">' + esc(lab[p.st]) + '</span></li>';
  }).join('') + '</ul>', true];
}

/* ---- Skins ---- */
function skinCard(s, off) {
  var eq = s.equip.length ? '<div class="bse-bl">When equipped</div>' + buffList(s.equip, 4) : '', ow = s.ownB.length ? '<div class="bse-bl">Owned bonus</div>' + buffList(s.ownB, 4) : '';
  var pills = (s.active ? '<span class="pill p-eff">Equipped</span>' : '') + (s.isNew ? '<span class="pill p-eff">New</span>' : '');
  var skill = s.skill ? '<span class="bse-sk" data-bseskill="' + s.id + '">' + ic('bolt', 'sm') + '<span translate="no">' + esc(s.skill) + '</span></span>' : '';
  return '<div class="bse-c bse-skin' + (s.isNew ? ' q5' : '') + (off ? ' off' : '') + '"><button class="bse-ch" type="button" data-bseskin="' + s.id + '" style="text-align:left;color:inherit;width:100%">' + (s.icon ? icon('base-icons/' + s.icon, s.isNew ? 'q5' : '', s.name.charAt(0), s.name) : '<span class="ico fb" translate="no">' + esc(s.name.charAt(0)) + '</span>') + '<span class="bse-ct"><span class="bse-cn" translate="no" style="display:block">' + esc(noHy(s.name)) + '</span>' + (pills ? '<span class="bse-pills">' + pills + '</span>' : '') + '</span></button>' + eq + ow + skill + '</div>';
}
var S_SORT = [['equipped', 'Equipped first'], ['name', 'Name A to Z'], ['za', 'Name Z to A'], ['power', 'Power, high to low']];
function skinsData() {
  var st = Logic.skinState(S.res.merged && S.res.merged.skins);
  return { st: st, list: T && st.known ? Logic.skinList(T, st) : [] };
}
function skinControls(opt) {
  var buffs = [['', 'All stats']].concat(opt.buffs.map(function (b) { return [b, b]; })), skills = [['', 'All skills']].concat(opt.skills.map(function (b) { return [b, b]; }));
  var n = (K.buff ? 1 : 0) + (K.skill ? 1 : 0) + (K.sort !== 'equipped' ? 1 : 0);
  return '<div class="fbar"><div class="grow"><input class="fld" type="search" data-bsekq placeholder="Search skins" aria-label="Search skins" value="' + esc(K.q) + '"></div><button class="btn bse-fbtn" type="button" data-open="bsesfilter">' + ic('sliders', 'sm') + '<span>Filter · Sort' + (n ? ' (' + n + ')' : '') + '</span></button></div>' +
    '<div class="bse-fs">' + sel('sort', 'Sort', S_SORT, K.sort, 'data-bsek') + sel('buff', 'Stat', buffs, K.buff, 'data-bsek') + (opt.skills.length ? sel('skill', 'City skill', skills, K.skill, 'data-bsek') : '') + '</div>';
}
function skinGridHtml(list) {
  var f = Logic.skinSort(Logic.skinFilter(list, K), K.sort), shown = f.slice(0, skinN);
  return (shown.length ? '<div class="bse-grid">' + shown.map(function (s) { return skinCard(s, false); }).join('') + '</div>' : '<div class="empty">No skins match. <button class="tb link" type="button" data-bseclear="k">Clear filters</button></div>') + more(shown.length, f.length, 'skins');
}
function haloHtml(st) {
  if (!T) return '';
  var tbl = T.BASE_HALO_DATA || {}, have = Logic.bdNotOwned(tbl, st.halo), owned = st.halo.map(function (id) { return Logic.bdRow(T, id, tbl); });
  var card = function (h, off) { return '<div class="bse-c' + (off ? ' off' : '') + '"><div class="bse-ch">' + (h.icon ? icon('base-halo-icons/' + h.icon, '', h.name.charAt(0), h.name) : '<span class="ico fb" translate="no">' + esc(h.name.charAt(0)) + '</span>') + '<span class="bse-ct"><span class="bse-cn" translate="no">' + esc(noHy(h.name)) + '</span>' + (h.id === st.haloActive && !off ? '<span class="bse-pills"><span class="pill p-eff">Equipped</span></span>' : '') + '</span></div>' + buffList(h.buffs, 6) + '</div>'; };
  var left = have.map(function (k) { return Logic.bdRow(T, +k, tbl); });
  var o = '<h2 class="sub" style="margin-top:8px">Halos</h2>';
  o += owned.length ? '<div class="bse-grid">' + owned.map(function (h) { return card(h, false); }).join('') + '</div>' : '<p class="t13 muted">No halos owned.</p>';
  if (left.length) o += '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="haloLeft" aria-expanded="' + !!open.haloLeft + '"><span class="bse-ht"><span class="bse-hn">Halos not owned</span><span class="bse-hm">' + nd(String(left.length)) + '</span></span>' + ic('down', 'bse-chev') + '</button>' + (open.haloLeft ? '<div class="bse-body"><div class="bse-grid">' + left.map(function (h) { return card(h, true); }).join('') + '</div></div>' : '') + '</section>';
  return o;
}
function skinsPane() {
  var m = S.res.merged && S.res.merged.skins, st = Logic.skinState(m);
  if (!st.known && !st.halo.length) return needData('No skin data yet.');
  if (TFail) return partFail('the skin list');
  if (!T) return '<p class="muted t13" role="status">Loading the skin list…</p>';
  var list = Logic.skinList(T, st), opt = Logic.skinFilterOptions(list), act = list.filter(function (s) { return s.active; })[0];
  var head = '<p class="t13 muted">' + nd(list.length + ' skins owned' + (act ? ' · equipped: ' : '')) + (act ? nm(act.name) : '') + (st.source ? nd(' · from ' + st.source) : '') + '</p>';
  var left = Logic.skinNotOwned(T, st), isOpen = !!open.skinLeft, sn = notN.skins || PAGE;
  var notOwned = left.length ? '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="skinLeft" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">Skins not owned</span><span class="bse-hm">' + nd(String(left.length)) + '</span></span>' + ic('down', 'bse-chev') + '</button>' + (isOpen ? '<div class="bse-body"><div class="bse-grid">' + left.slice(0, sn).map(function (s) { return skinCard(s, true); }).join('') + '</div>' + more(Math.min(sn, left.length), left.length, 'skinLeft') + '</div>' : '') + '</section>' : '';
  return head + (list.length ? skinControls(opt) + '<div id="bseSkins">' + skinGridHtml(list) + '</div>' : '<div class="empty">No skins owned yet.</div>') + haloHtml(st) + notOwned + classicLink('bases', 'See skins and halos on the classic page');
}
function skinRefresh() { var g = $('#bseSkins'); if (!g) return; g.innerHTML = skinGridHtml(skinsData().list); var n = (K.buff ? 1 : 0) + (K.skill ? 1 : 0) + (K.sort !== 'equipped' ? 1 : 0); $$('.bse-fbtn span').forEach(function (b) { if (b.closest('[data-pane="skins"]')) b.textContent = 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }); $$('[data-bsek]').forEach(function (x) { if (x.value !== String(K[x.dataset.bsek])) x.value = String(K[x.dataset.bsek]); }); }
function skinSheet(arg) {
  if (!T) return null;
  var id = +arg, s = Logic.skinRow(T, id, 0); if (!s.known) return null;
  var st = Logic.skinState(S.res.merged && S.res.merged.skins); s.active = id === st.active;
  var ch = Logic.skinChain(T, id), o = '<div class="sh-hero">' + (s.icon ? icon('base-icons/' + s.icon, s.isNew ? 'q5' : '', s.name.charAt(0), s.name) : '') + '<div>' + (s.active ? '<span class="pill p-eff">Equipped</span> ' : '') + (s.isNew ? '<span class="pill p-eff">New</span>' : '') + (s.power > 0 ? '<div class="t13 muted" style="margin-top:4px">' + nd('Power ' + fmtInt(s.power)) + '</div>' : '') + '</div></div>';
  function block(t, list) { return list.length ? '<section class="card"><h3 class="disp" style="font-size:var(--fs-17)">' + esc(t) + '</h3>' + buffList(list, 12) + '</section>' : ''; }
  if (ch) {
    o += '<section class="card"><h3 class="disp" style="font-size:var(--fs-17)">' + esc(ch.kind === 'alt' ? 'Alternate forms' : 'Level progression') + '</h3>' + (ch.kind === 'alt' ? '<p class="t13 muted" style="margin:4px 0 8px">Only one form is equipped at a time. Transform to switch.</p>' : '') + ch.rows.map(function (r) {
      return '<div style="padding:8px 0;border-top:1px solid var(--rule)"><div class="bse-ch">' + (r.icon ? icon('base-icons/' + r.icon, '', r.name.charAt(0), r.name) : '') + '<span class="bse-ct"><span class="bse-cn" translate="no">' + esc(noHy(r.name)) + '</span><span class="bse-cs" style="display:block">' + nd(r.label) + '</span></span></div>' + (r.equip.length ? '<div class="bse-bl">When equipped</div>' + buffList(r.equip, 8) : '') + (r.ownB.length ? '<div class="bse-bl">Owned bonus</div>' + buffList(r.ownB, 8) : '') + '</div>';
    }).join('') + '</section>';
  } else o += block('When equipped', s.equip) + block('Owned bonus', s.ownB);
  if (s.skill) o += '<button class="btn" type="button" data-bseskill="' + s.id + '" style="margin-top:12px">' + ic('bolt', 'sm') + '<span translate="no">' + esc(s.skill) + '</span></button>';
  return [s.name, o, true];
}
function skillSheet(arg) {
  if (!T) return null;
  var id = +arg, s = Logic.skinRow(T, id, 0), cs = Logic.citySkill(T, id); if (!s.known || !s.skill) return null;
  var o = '<p class="t13 muted">' + esc('From ') + nm(s.name) + (cs && cs.type ? ' · ' + esc(cs.type) : '') + '</p>';
  if (cs && cs.desc) o += '<section class="card" style="margin-top:12px"><h3 class="disp" style="font-size:var(--fs-17)">What it does</h3><p style="margin-top:8px">' + esc(cs.desc) + '</p></section>';
  if (cs && cs.how) o += '<section class="card" style="margin-top:12px"><h3 class="disp" style="font-size:var(--fs-17)">How to use it</h3><p class="t13 muted" style="margin-top:8px;white-space:pre-line">' + esc(cs.how) + '</p></section>';
  if (!cs || (!cs.desc && !cs.how)) o += '<p class="muted" style="margin-top:12px">No more details for this skill.</p>';
  return [s.skill, o, true];
}

/* ---- Base decor ---- */
var BD_SORT = [['name', 'Name A to Z'], ['za', 'Name Z to A'], ['newest', 'Newest first'], ['oldest', 'Oldest first']];
function bdCard(b, off, active) {
  var eq = b.equip.length ? '<div class="bse-bl">Equipping</div>' + buffList(b.equip, 6) : '', ho = b.hold.length ? '<div class="bse-bl">Holding in stock</div>' + buffList(b.hold, 6) : '';
  return '<div class="bse-c' + (off ? ' off' : '') + '"><div class="bse-ch">' + (b.icon ? icon('base-decor-icons/' + b.icon, '', b.name.charAt(0), b.name) : '<span class="ico fb" translate="no">' + esc(b.name.charAt(0)) + '</span>') + '<span class="bse-ct"><span class="bse-cn" translate="no">' + esc(noHy(b.name)) + '</span>' + (active ? '<span class="bse-pills"><span class="pill p-eff">Equipped</span></span>' : '') + '</span></div>' + eq + ho + '</div>';
}
function bdList() {
  var st = Logic.skinState(S.res.merged && S.res.merged.skins), tbl = T.BASE_DECOR_DATA || {};
  var rows = Logic.bdSort(st.castle.map(function (id) { return Logic.bdRow(T, id, tbl); }), B.sort), q = B.q.toLowerCase().trim();
  if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0; });
  return { st: st, rows: rows, tbl: tbl };
}
function bdGrid() {
  var x = bdList(), shown = x.rows.slice(0, bdN);
  return (shown.length ? '<div class="bse-grid">' + shown.map(function (b) { return bdCard(b, false, b.id === x.st.castleActive); }).join('') + '</div>' : '<div class="empty">No base decorations match. <button class="tb link" type="button" data-bseclear="b">Clear search</button></div>') + more(shown.length, x.rows.length, 'bd');
}
function bdPane() {
  var st = Logic.skinState(S.res.merged && S.res.merged.skins);
  if (!st.castle.length) return needData('No base decoration data yet. It comes from your battle reports.');
  if (TFail) return partFail('the base decoration list');
  if (!T) return '<p class="muted t13" role="status">Loading the base decoration list…</p>';
  var tbl = T.BASE_DECOR_DATA || {}, left = Logic.bdNotOwned(tbl, st.castle).map(function (k) { return Logic.bdRow(T, +k, tbl); }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }), isOpen = !!open.bdLeft, sn = notN.bd || PAGE;
  var act = st.castleActive ? Logic.bdRow(T, st.castleActive, tbl) : null;
  return '<p class="t13 muted">' + nd(st.castle.length + ' base decorations owned') + (act ? ' · equipped: ' + nm(act.name) : '') + '</p>' +
    '<div class="fbar"><div class="grow"><input class="fld" type="search" data-bsebq placeholder="Search base decorations" aria-label="Search base decorations" value="' + esc(B.q) + '"></div><label class="bse-f" style="flex-direction:row;align-items:center;gap:8px"><span>Sort</span><select class="sel" data-bseb="sort">' + BD_SORT.map(function (o) { return '<option value="' + o[0] + '"' + (B.sort === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label></div>' +
    '<div id="bseBd">' + bdGrid() + '</div>' +
    (left.length ? '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="bdLeft" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">Not owned</span><span class="bse-hm">' + nd(String(left.length)) + '</span></span>' + ic('down', 'bse-chev') + '</button>' + (isOpen ? '<div class="bse-body"><div class="bse-grid">' + left.slice(0, sn).map(function (b) { return bdCard(b, true, false); }).join('') + '</div>' + more(Math.min(sn, left.length), left.length, 'bdLeft') + '</div>' : '') + '</section>' : '') + classicLink('bases', 'See base decorations on the classic page');
}
function bdRefresh() { var g = $('#bseBd'); if (g) g.innerHTML = bdGrid(); }

/* ---- Formation ---- */
function formationPane() {
  var s = supp().formation, mg = S.res.merged || {}, fs = Logic.formationsMerged(mg.formations, s && !priv().formation ? s : null), am = Logic.armyMastery(mg.armyMastery), tal = s && !priv().formation && Array.isArray(s.talents) && s.talents.length;
  if (!Object.keys(fs).length && !am && !tal) return needData('No formation data yet.');
  if (REFFail) return partFail('the formation list');
  if (!REF) return '<p class="muted t13" role="status">Loading the formation list…</p>';
  var cards = ['1001', '1002', '1003'].map(function (id) { return formationCard(Logic.formationCard(id, fs[id], REF)); }).join('');
  var techs = Logic.techModel(REF, fs), tech = (techs.some(function (t) { return t.seen; }) || (s && s.formations)) ? techHtml(techs) : '';
  var mast = am ? '<section class="card"><h2 class="sub">Component mastery</h2><div class="bse-line" style="margin-top:8px">' + dots(am.map(function (a) { return '<span>' + esc(a.type) + ' <b>' + nd('Lv.' + a.lv + ' of 20') + '</b></span>'; })) + '</div></section>' : '';
  var tm = tal ? Logic.talentModel(REF, s) : null;
  var age = s && s.ts ? '<p class="t13 muted">' + nd('Game data from ' + new Date(s.ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })) + '</p>' : '';
  return age + '<div class="bse-ft">' + cards + '</div>' + tech + mast + (tm ? talentHtml(tm) : '<div class="empty">The talent tree is not in your game data yet. Send game data from the game to see it here.</div>') + classicLink('formation', 'Plan talent changes in the classic page');
}
function formationCard(c) {
  var head = '<div class="bse-ch">' + (c.icon ? icon(c.icon, '', c.name.charAt(0), c.name) : '<span class="ico fb" translate="no">' + esc(c.name.charAt(0)) + '</span>') + '<span class="bse-ct"><span class="bse-cn" translate="no" style="font-size:var(--fs-17)">' + esc(c.name) + '</span>' +
    (c.seen ? '<span class="bse-cs" style="display:block">' + nd('Level ' + c.lv + (c.lvUp ? ' +1' : '') + ' · Tier ' + c.tier + (c.tierUp ? ' +1' : '') + ' of 10') + '</span>' : '<span class="bse-cs" style="display:block">No battle seen with this formation yet.</span>') + '</span></div>';
  if (!c.seen) return '<section class="card bse-fc">' + head + '</section>';
  var cells = c.slots.map(function (s) { return '<div class="bse-sl s' + (s.eff == null ? 0 : s.eff >= 5 ? 5 : s.eff >= 4 ? 4 : 3) + '"><span>' + nd('Slot ' + s.n) + '</span><b translate="no">' + (s.lv == null ? '–' : s.lv + (s.plus ? '+1' : '')) + '</b>' + (s.lv == null ? '<span class="sr">locked</span>' : '') + '</div>'; }).join('');
  return '<section class="card bse-fc">' + head + '<p class="t13 muted" style="margin-top:12px">' + nd('Specialization' + (c.skill ? ' (' + c.skill + ')' : '') + ' · ' + c.total + ' of 45') + '</p><div class="bse-spec">' + cells + '</div></section>';
}
function techHtml(techs) {
  return '<section class="card"><h2 class="sub">Formation tech</h2><p class="t13 muted" style="margin:4px 0 8px">Shared by all three formations.</p><ul class="bse-tl two">' + techs.map(function (t) {
    return '<li><span class="bse-tt"><span style="display:block;font-weight:600">' + esc(t.name) + '</span>' + (t.lv === 0 ? '<span class="t13 muted">Not researched yet.</span>' : '<span class="bse-tch">' + t.chips.map(function (c) { return '<span>' + nd(c.v + ' ' + c.n) + '</span>'; }).join('') + '</span>' + (t.front ? '<span class="t12 muted" style="display:block;margin-top:4px">Front row shown.</span>' : '')) + '<span class="meter" style="margin-top:8px" role="img" aria-label="' + t.pct + ' percent researched"><i style="width:' + Math.max(t.lv ? 2 : 0, t.pct) + '%"></i></span></span><span class="bse-tv">' + nd('Lv.' + t.lv + ' of ' + t.max) + '</span></li>';
  }).join('') + '</ul></section>';
}
function talentHtml(tm) {
  function side(key, title) {
    var list = tm.sides[key]; if (!list.length) return '';
    var k = 'tal' + key, isOpen = open[k] != null ? open[k] : false, tr = list.filter(function (n) { return n.lv > 0; }).length;
    return '<section class="card bse-sec"><button class="bse-hd" type="button" data-bseopen="' + k + '" aria-expanded="' + isOpen + '"><span class="bse-ht"><span class="bse-hn">' + esc(title) + '</span><span class="bse-hm">' + nd(tr + ' of ' + list.length + ' talents trained') + '</span></span>' + ic('down', 'bse-chev') + '</button>' +
      (isOpen ? '<div class="bse-body"><ul class="bse-tl two">' + list.map(function (n) {
        return '<li class="' + (n.lv ? '' : 'off') + '">' + (n.icon ? icon('formation-icons/image_professionTalent_' + n.icon + '.png', n.lv >= n.max ? 'q5' : '', n.name.charAt(0), n.name) : '<span class="ico fb" translate="no">' + esc(n.name.charAt(0)) + '</span>') + '<span class="bse-tt"><span style="display:block;font-weight:600" translate="no">' + esc(n.name) + '</span><span class="t13 muted">' + esc(n.desc) + '</span></span><span class="bse-tv"><span style="display:block">' + nd(n.sw ? (n.lv ? 'Chosen' : 'Not chosen') : 'Lv.' + n.lv + ' of ' + n.max) + '</span>' + (n.val ? '<span style="display:block;color:var(--text)" translate="no">' + esc(n.val) + '</span>' : '') + '</span></li>';
      }).join('') + '</ul></div>' : '') + '</section>';
  }
  return '<section class="card"><h2 class="sub">Talent tree</h2><p class="bse-line" style="margin-top:8px">' + dots([sp(tm.trained + ' of ' + tm.total + ' talents trained'), sp(tm.maxed + ' at top level'), tm.power ? sp(fmtInt(tm.power) + (tm.maxPower ? ' of ' + fmtInt(tm.maxPower) : '') + ' talent power') : '', tm.held != null ? sp(fmtInt(tm.held) + ' Formation 101 manuals held') : '', tm.spent ? sp(fmtInt(tm.spent) + ' manuals spent on the tree') : '']) + '</p></section>' + side('left', 'Shark and Scorpion talents') + side('right', 'Eagle talents');
}
function loadRef(cb) {
  if (REF || REFFail) return cb();
  if (loadRef.q) { loadRef.q.push(cb); return; }
  loadRef.q = [cb];
  getJson('data/formation-v2.json').then(function (j) { REF = j; }, function () { REFFail = true; }).then(function () { var q = loadRef.q; loadRef.q = null; q.forEach(function (f) { f(); }); });
}

/* ---- sheets (the filter and sort sheets are for the phone) ---- */
function chipGroup(key, lab, list, val, attr) {
  return '<div><span class="lab" style="margin-bottom:4px">' + esc(lab) + '</span><div class="chips">' + list.map(function (o) { return '<button class="bse-cb" type="button" ' + attr + '="' + esc(key) + ':' + esc(o[0]) + '" aria-pressed="' + (String(val) === String(o[0])) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>';
}
function dSheet() {
  return ['Filter and sort', '<div class="ctrls">' + chipGroup('sort', 'Sort by', D_SORT, D.sort, 'data-bsedc') + chipGroup('up', 'Shards', [['', 'All'], ['1', 'Can upgrade']], D.up ? '1' : '', 'data-bsedc') + sel('stat', 'Stat', D_STATS, D.stat, 'data-bsed') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>'];
}
function kSheet() {
  if (!T) return null;
  var opt = Logic.skinFilterOptions(skinsData().list);
  return ['Filter and sort', '<div class="ctrls">' + chipGroup('sort', 'Sort by', S_SORT, K.sort, 'data-bsekc') + sel('buff', 'Stat', [['', 'All stats']].concat(opt.buffs.map(function (b) { return [b, b]; })), K.buff, 'data-bsek') + (opt.skills.length ? sel('skill', 'City skill', [['', 'All skills']].concat(opt.skills.map(function (b) { return [b, b]; })), K.skill, 'data-bsek') : '') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>'];
}
function sheet(kind, arg) {
  try {
    if (kind === 'decor') return itemSheet(arg);
    if (kind === 'bseset') return setSheet(arg);
    if (kind === 'bsedfilter') return dSheet();
    if (kind === 'bsesfilter') return kSheet();
    if (kind === 'skin') return skinSheet(arg);
    if (kind === 'skill') return skillSheet(arg);
  } catch (e) { if (window.console) console.error(e); }
  return null;
}

/* ---- painting ---- */
function show() {
  var v = $('#v-base'); if (!v) return;
  $$('.segs button', v).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.seg === cur.seg ? 'true' : 'false'); });
  $$('[data-pane]', v).forEach(function (p) { p.hidden = p.dataset.pane !== cur.seg; });
  var sm = $('#bseSum'); if (sm) sm.hidden = cur.seg === 'formation';
}
function paint() {
  var v = $('#v-base'); if (!v || !S.vm || !S.res) return;
  injectCss();
  var segs = '<div class="segs"><div class="segs-in" role="tablist">' + SEGS.map(function (s) { return '<button type="button" role="tab" data-seg="' + s[0] + '" aria-selected="false" data-go="base/' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></div>';
  v.innerHTML = segs + '<div class="vb" id="bseSum"></div><div class="vb" data-pane="decor"></div><div class="vb" data-pane="skins"></div><div class="vb" data-pane="base-decor"></div><div class="vb" data-pane="formation"></div>';
  paneAll(); show();
}
function paneAll() {
  var v = $('#v-base'); if (!v) return;
  var set = function (seg, html) { var p = $('[data-pane="' + seg + '"]', v); if (p) p.innerHTML = html; };
  set('decor', decorPane()); set('skins', cur.seg === 'skins' || T ? skinsPane() : ''); set('base-decor', cur.seg === 'base-decor' || T ? bdPane() : ''); set('formation', cur.seg === 'formation' || REF ? formationPane() : '');
  var sm = $('#bseSum'); if (sm) sm.innerHTML = stripHtml();
}
function wire() {
  if (wired) return; wired = true;
  var v = $('#v-base');
  v.addEventListener('click', function (e) {
    var t = e.target.closest('button, [data-bseskill]'); if (!t) return;
    var ds = t.dataset;
    if (ds.bseopen) { var k = ds.bseopen, was = t.getAttribute('aria-expanded') === 'true'; open[k] = !was; reflow(k); return; }
    if (ds.bsemore) { var m = ds.bsemore; if (m === 'skins') skinN += STEP; else if (m === 'bd') bdN += STEP; else if (m === 'skinLeft') bump(notN, 'skins', PAGE); else if (m === 'bdLeft') bump(notN, 'bd', PAGE); else bump(pageN, m, PAGE); reflow(m); return; }
    if (ds.bseitem) { H.openSheet('decor', ds.bseitem); return; }
    if (ds.bseset) { H.openSheet('bseset', ds.bseset); return; }
    if (ds.bseskin) { H.openSheet('skin', ds.bseskin); return; }
    if (ds.bseskill) { e.stopPropagation(); H.openSheet('skill', ds.bseskill); return; }
    if ('bsespend' in ds) { spend.open = !spend.open; var sec = $('#bseSpend'); if (sec) sec.outerHTML = spendHtml(); if (spend.open) loadSpend(); return; }
    if (ds.bsetab) { spend.tab = ds.bsetab; spend.touched = true; spend.all = false; var s2 = $('#bseSpend'); if (s2) s2.outerHTML = spendHtml(); var nb = $('[data-bsetab="' + ds.bsetab + '"]', v); if (nb) nb.focus({ preventScroll: true }); return; }
    if (ds.bseunits) { spend.units = ds.bseunits; spend.all = false; var s4 = $('#bseSpend'); if (s4) s4.outerHTML = spendHtml(); var ub = $('[data-bseunits="' + ds.bseunits + '"]', v); if (ub) ub.focus({ preventScroll: true }); return; }
    if ('bsespendall' in ds) { spend.all = !spend.all; var s3 = $('#bseSpend'); if (s3) s3.outerHTML = spendHtml(); return; }
    if (ds.bseclear) { if (ds.bseclear === 'd') D = Object.assign({}, DF); else if (ds.bseclear === 'k') { K = Object.assign({}, SF); skinN = PAGE; } else { B = Object.assign({}, BF); bdN = PAGE; } paneAll(); show(); }
  });
  v.addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset) return;
    if ('bsedq' in t.dataset) { D.q = t.value; pageN = {}; dRefresh(); }
    else if ('bsekq' in t.dataset) { K.q = t.value; skinN = PAGE; skinRefresh(); }
    else if ('bsebq' in t.dataset) { B.q = t.value; bdN = PAGE; bdRefresh(); }
  });
  v.addEventListener('change', function (e) { onChange(e.target); });
  document.addEventListener('change', function (e) { var t = e.target; if (t.closest && t.closest('#sheetB')) onChange(t); });
  document.addEventListener('click', function (e) {
    var sk = e.target.closest ? e.target.closest('#sheetB [data-bseskill]') : null;
    if (sk) { H.openSheet('skill', sk.dataset.bseskill); return; }
    var t = e.target.closest ? e.target.closest('#sheetB [data-bsedc], #sheetB [data-bsekc]') : null; if (!t) return;
    var raw = t.dataset.bsedc || t.dataset.bsekc, i = raw.indexOf(':'), k = raw.slice(0, i), val = raw.slice(i + 1);
    if (t.dataset.bsedc) { if (k === 'up') D.up = val === '1'; else D[k] = val; pageN = {}; dRefresh(); var h = dSheet(); $('#sheetB').innerHTML = h[1]; }
    else { K[k] = val; skinN = PAGE; skinRefresh(); var h2 = kSheet(); if (h2) $('#sheetB').innerHTML = h2[1]; }
    var again = $('#sheetB [data-' + (t.dataset.bsedc ? 'bsedc' : 'bsekc') + '="' + raw.replace(/"/g, '\\"') + '"]'); if (again) again.focus({ preventScroll: true });
  });
}
function onChange(t) {
  if (!t || !t.dataset) return;
  if (t.dataset.bsed) { var k = t.dataset.bsed; if (k === 'up') D.up = t.value === '1'; else D[k] = t.value; pageN = {}; dRefresh(); }
  else if (t.dataset.bsek) { K[t.dataset.bsek] = t.value; skinN = PAGE; skinRefresh(); }
  else if (t.dataset.bseb) { B.sort = t.value; bdN = PAGE; bdRefresh(); }
}
function reflow(key) {
  var v = $('#v-base'), y = window.scrollY;
  if (/^c\d$/.test(key) || key === 'notOwned' || /^sets/.test(key)) { paneRefreshAll(); }
  else if (key === 'skins' || key === 'skinLeft' || key === 'haloLeft') { var p = $('[data-pane="skins"]', v); if (p) p.innerHTML = skinsPane(); }
  else if (key === 'bd' || key === 'bdLeft') { var b = $('[data-pane="base-decor"]', v); if (b) b.innerHTML = bdPane(); }
  else if (/^tal/.test(key)) { var f = $('[data-pane="formation"]', v); if (f) f.innerHTML = formationPane(); }
  window.scrollTo(0, y);
  var nb = $('[data-bseopen="' + key + '"]', v); if (nb) nb.focus({ preventScroll: true });
}
function render(r) {
  try {
    var seg = r && SEGS.some(function (s) { return s[0] === r.seg; }) ? r.seg : 'decor';
    cur = { seg: seg, q: (r && r.q) || {} };
    if (!S.vm || !S.res) return;
    if (DMFor !== S.vm) { spend.model = null; spend.loading = false; spend.err = false; DM = null; DMFor = null; } /* the game data arrived (a second pass): rebuild from it */
    if (cur.q.item && seg === 'decor') { /* a link from Next moves: the section that holds the item opens, the item sheet follows */ var dm = dl() && decorData(), it = dm && dm.placed.filter(function (p) { return p.n === cur.q.item; })[0]; if (it) { open['c' + it.cat] = true; } }
    paint(); wire();
    if (seg === 'decor' || !T) tablesFor(seg);
    if (seg === 'formation' && !REF) loadRef(function () { var f = $('#v-base [data-pane="formation"]'); if (f && cur.seg === 'formation') f.innerHTML = formationPane(); });
    if (spend.open && !spend.model && spendOwner()) loadSpend();
    if (seg === 'decor' && cur.q.spend) { spend.open = true; var sec = $('#bseSpend'); if (sec) sec.outerHTML = spendHtml(); loadSpend(); }
  } catch (e) { fail(e); }
}
/* the table loads when a segment that needs it opens (and for the strip on Decor); Decor itself never waits for it */
function tablesFor(seg) {
  tables(function () {
    var v = $('#v-base'); if (!v) return;
    var sm = $('#bseSum'); if (sm) sm.innerHTML = stripHtml();
    var set = function (s, html) { var p = $('[data-pane="' + s + '"]', v); if (p) p.innerHTML = html; };
    set('skins', skinsPane()); set('base-decor', bdPane());
  });
}
return { render: render, sheet: sheet };
};
})(typeof window !== 'undefined' ? window : globalThis);
