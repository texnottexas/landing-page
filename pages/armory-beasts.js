/* armory-beasts.js: the Enigma Beasts section of the Armory v2 page (phase 3), loaded the first time the Beasts route opens.
 * Three segments: Field (the five fields and their slots), Collection (every owned beast, filterable) and Optimizer (the plan from
 * armory-beasts-opt.js, loaded only when that segment opens). Same-origin script, no CSP change. Everything from the worker or a
 * supplement is coerced to a number or goes through esc / nd; the game's own names come from TWGameData tables.
 * The data rules sit in ArmoryBeastsLogic (no DOM, node-testable); ArmoryBeasts(H) is the view. The numbers are the classic Enigma
 * tab's: ebResolveBeasts, ebComputeBuffValue / ebFormatBuffValue, the slot buffs and the optimizer's own output.
 */
(function (root) {
'use strict';

/* ---------- logic (no DOM) ---------- */
var RARITY = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' };
var ELEMENTS = ['Fire', 'Wind', 'Water', 'Ground'];
var UNITS = { 1: 'Army', 2: 'Navy', 3: 'Air Force' };
/* the optimizer's six stats, written out the way the Heroes screen writes them */
var STAT = { atk: 'Attack', hp: 'HP', def: 'Defense', dmgInc: 'DMG increase', dmgDec: 'Decreased DMG Taken', march: 'March Size' };
var PREFS_KEY = 'beast_optimizer_prefs_';

function num(v) { v = +v; return isFinite(v) ? v : 0; }
function fmtInt(n) { return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function trim(n, d) { return num(n).toFixed(d).replace(/\.?0+$/, ''); }
function clean(s) { return String(s == null ? '' : s).replace(/[<>"'&]/g, ''); }
/* "4 months old" (ts: ISO string or ms); '' for nothing, the future or garbage */
function ageOld(ts, now) {
  if (!ts) return '';
  var ms = (now == null ? Date.now() : now) - (typeof ts === 'string' ? new Date(ts) : new Date(+ts)).getTime();
  if (isNaN(ms) || ms < 0) return '';
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  function u(n, w) { return n + ' ' + w + (n === 1 ? '' : 's') + ' old'; }
  var m = Math.floor(sec / 60); if (m < 60) return u(m, 'minute');
  var h = Math.floor(m / 60); if (h < 24) return u(h, 'hour');
  var d = Math.floor(h / 24); if (d < 30) return u(d, 'day');
  var mo = Math.floor(d / 30); if (mo < 12) return u(mo, 'month');
  return u(Math.floor(mo / 12), 'year');
}

/* beast icon file in assets/beast-icons (the same name rule as the classic ebBeastIconUrl) */
function iconFile(G, type, faction, star) {
  var name = G.EB_ICON_NAMES[type] || G.EB_TYPES[type] || 'Unknown', elem = G.EB_ELEMENTS[faction] || 'Unknown';
  return (name + '_' + elem + '_' + (num(star) >= 5 ? 'evolved' : 'base') + '.png').replace(/[^A-Za-z0-9_. -]/g, '');
}
function potColor(pct) { return pct >= 85 ? 'max' : pct >= 65 ? 'hi' : 'lo'; }

/* The game's short buff names, written out like HT and Heroes write them ("All ATK (off)" is "All units Attack (offense)", "Air DMG Increase" is "Air Force DMG increase").
   Render only: filters work on the buff id. */
function label(n) {
  return clean(n).replace(/\bATK\b/g, 'Attack').replace(/\bDEF\b/g, 'Defense').replace(/\bRES\b/g, 'Resistance').replace(/\(off\)/, '(offense)').replace(/\(def\)/, '(defense)')
    .replace(/^All Units\b/, 'All units').replace(/^All (?!units\b|Forces\b)/, 'All units ').replace(/^Air (?!Force\b)/, 'Air Force ')
    .replace(/\bDMG Increase\b/, 'DMG increase').replace(/\bDefense Increase\b/, 'Defense increase').replace(/\bHP Boost\b/, 'HP');
}
/* the game's field name for field 1 is an internal abbreviation: players call it Component Mastery */
function fname(n) { return n === 'CPNT Mastery' ? 'Component Mastery' : n; }
function fmtBuff(v, id, dp) { return num(id) === 520000 ? '+' + Math.round(v) : '+' + v.toFixed(dp) + '%'; }
function buffLine(G, id, star, level, pot, isMain) {
  var v = G.ebComputeBuffValue(id, star, level, pot, isMain);
  return { id: num(id), name: label(G.ebBuffName(id)), txt: v == null ? '' : fmtBuff(v, id, 2), txt3: v == null ? '' : fmtBuff(v, id, 3), val: v };
}

/* The classic boConditionMatches (copied; the engine's own copy lives in armory-beasts-opt.js and a test keeps them equal): does this slot's bonus
   condition hold for the beasts in its field? */
function condMatches(c, fieldBeasts, allFilled) {
  if (!c) return false;
  if (c.conditionType === 0) return allFilled;
  if (c.conditionType === 1) {
    var need = Number(c.conditionPara1 || 0), rar = Number(c.conditionPara2 || 0);
    return fieldBeasts.filter(function (b) { return b.q >= rar; }).length >= need;
  }
  if (c.conditionType === 6) {
    var need6 = Number(c.conditionPara1 || 0), star6 = Number(c.conditionPara2 || 0), rar6 = Number(c.conditionPara3 || 0);
    return fieldBeasts.filter(function (b) { return b.q >= rar6 && b.st >= star6; }).length >= need6;
  }
  return false;
}

/* One resolved beast (ebResolveBeasts shape) as a plain view record, numbers coerced, strings cleaned. */
function beastView(G, b) {
  var star = num(b.star), lv = num(b.level), pot = num(b.potential), maxPot = num(b.maxPotential) || 16000;
  return {
    id: String(b.id), name: clean(b.name), type: num(b.type), element: clean(b.element), faction: num(b.faction), q: num(b.quality), star: star, lv: lv,
    pot: pot, maxPot: maxPot, potPct: Math.round(pot / maxPot * 100), power: num(b.power),
    icon: iconFile(G, b.type, b.faction, star),
    main: buffLine(G, b.mainBuff, star, lv, pot, true),
    base: (b.baseBuff || []).map(function (x) { return buffLine(G, x && x.id, star, lv, pot, false); }),
    fieldCfg: b.fieldCfg ? num(b.fieldCfg) : 0, fieldName: b.fieldName ? fname(clean(b.fieldName)) : '', slot: num(b.fieldSlotNum), platformLv: num(b.slotLevel),
    slotBuffs: (b.slotBuffs || []).map(function (sb) { return { name: label(sb.name), txt: sb.val ? '+' + (num(sb.val) / 100).toFixed(2) + '%' : '' }; })
  };
}

/* Deployed beasts from the report/enigma supplement plus the bench supplement's beasts (deduped by id), as the classic tab merges them. */
function resolveAll(core, G, merged, bench) {
  var res = core.ebResolveBeasts((merged && merged.enigmas) || {});
  var seen = Object.create(null);
  res.beasts.forEach(function (b) { if (b.id) seen[String(b.id)] = true; });
  if (bench && Array.isArray(bench.beasts)) {
    bench.beasts.forEach(function (sb) {
      if (!sb || typeof sb !== 'object' || seen[String(sb.id)]) return;
      res.beasts.push({
        id: sb.id, cfg: sb.cfgId, type: sb.type, faction: sb.fac, quality: sb.q, element: G.EB_ELEMENTS[sb.fac] || 'Unknown',
        name: G.ebBeastName(sb.type, sb.st), star: sb.st, level: sb.lv, potential: Number(sb.pot) || 0, maxPotential: G.ebMaxPotential(sb.q), power: 0,
        mainBuff: sb.mb, mainBuffName: G.ebBuffName(sb.mb),
        baseBuff: (sb.bb || []).map(function (id) { var i = (id && typeof id === 'object') ? id.id : id; return { id: i, name: G.ebBuffName(i) }; }),
        fieldCfg: null, fieldName: null, slotId: null, fieldSlotNum: null, slotLevel: null, slotBuffs: [], _supplemental: true
      });
    });
  }
  return res;
}

/* The five fields with their slots, the summary strip and every owned beast. */
function model(core, G, merged, bench) {
  var en = merged && merged.enigmas;
  if (!en || (!en.beastDatas && !en.fields)) return null;
  var res = resolveAll(core, G, merged, bench);
  if (!res.beasts.length && !res.fields.length) return null;
  var all = res.beasts.map(function (b) { return beastView(G, b); }), byId = {};
  all.forEach(function (b) { byId[b.id] = b; });
  var placed = all.filter(function (b) { return b.fieldCfg; }), benchN = all.length - placed.length;
  var pot = 0, maxPot = 0, power = 0, five = 0;
  placed.forEach(function (b) { power += b.power; pot += b.pot; maxPot += b.maxPot; if (b.star >= 5) five++; });
  var active = 0, conds = core.getFieldConditions();
  var fields = res.fields.map(function (f) {
    if (f.active) active++;
    var texts = G.EB_FIELD_CONDITIONS[f.cfg] || [], off = G.BO_FIELD_CONDITION_OFFSETS[f.cfg];
    var sorted = f.slots.slice().sort(function (a, b) { return a.fieldSlotNum - b.fieldSlotNum; });
    var fbs = sorted.filter(function (s) { return s.beast && byId[String(s.beast.id)]; }).map(function (s) { var v = byId[String(s.beast.id)]; return { q: v.q, st: v.star }; });
    var allFilled = sorted.length > 0 && fbs.length === sorted.length;
    var slots = sorted.map(function (s) {
      var req = core.ebPlatformReq(f.cfg, s.fieldSlotNum), n = num(s.fieldSlotNum), bv = s.beast ? byId[String(s.beast.id)] : null;
      var c = conds && off != null ? conds[off + n] : null;
      return {
        num: n, platformLv: s.level == null ? null : num(s.level), beast: bv || null,
        req: req ? (req.isUniversal ? { universal: true } : {
          universal: false, rarity: clean(req.rarity), element: clean(req.element || 'Any'), elementId: num(req.elementId),
          types: (req.beastTypeIds && req.beastTypeIds.length) ? clean(req.beastTypeLabel) : 'Any type',
          cap: req.qualityCap && num(req.qualityCap) < 5 ? num(req.qualityCap) : 0
        }) : null,
        buffs: (s.buffs || []).map(function (sb) { return { name: label(G.ebBuffName(sb.id)), txt: sb.val ? '+' + (num(sb.val) / 100).toFixed(2) + '%' : '' }; }),
        cond: n >= 1 && n <= texts.length ? clean(texts[n - 1]) : '',
        on: c ? condMatches(c, fbs, allFilled) : null
      };
    });
    return {
      cfg: num(f.cfg), name: fname(clean(f.name)), active: !!f.active, expected: num(f.expectedSlots), deployed: num(f.deployedCount), slots: slots,
      legendary: fbs.filter(function (b) { return b.q >= 5; }).length,
      bonusOn: slots.filter(function (s) { return s.on === true; }).length, bonusKnown: slots.every(function (s) { return s.on !== null; })
    };
  });
  return {
    fields: fields, all: all, byId: byId, placed: placed.length, bench: benchN,
    summary: { beasts: placed.length, fiveStar: five, active: active + '/' + fields.length, inFields: fields.filter(function (f) { return f.deployed > 0; }).length, avgPot: maxPot > 0 ? Math.round(pot / maxPot * 100) : 0, power: power, bench: benchN },
    benchTs: bench && bench.ts ? bench.ts : null
  };
}

/* ---- collection filter / sort / options (the classic ebFilterBeasts / ebSortBeasts) ---- */
var SORTS = [['star', 'Stars, high first'], ['level', 'Level, high first'], ['potential', 'Potential, high first'], ['power', 'Power, high first'], ['name', 'Name, A to Z']];
function collFilter(list, st) {
  return list.filter(function (b) {
    if (st.elems.length && st.elems.indexOf(b.element) < 0) return false;
    if (st.where === 'bench' && b.fieldCfg) return false;
    if (st.where !== '' && st.where !== 'bench' && String(b.fieldCfg) !== st.where) return false;
    if (st.type && String(b.type) !== st.type) return false;
    if (st.primary && String(b.main.id) !== st.primary) return false;
    if (st.secondary && !b.base.some(function (x) { return String(x.id) === st.secondary; })) return false;
    return true;
  }).sort(function (a, b) {
    switch (st.sort) {
      case 'level': return (b.lv - a.lv) || (b.star - a.star);
      case 'potential': return (b.pot - a.pot) || (b.star - a.star);
      case 'power': return (b.power - a.power) || (b.star - a.star);
      case 'name': return a.name.localeCompare(b.name);
      default: return (b.star - a.star) || (b.pot - a.pot) || (b.lv - a.lv);
    }
  });
}
function collOptions(G, m) {
  var prim = {}, sec = {};
  m.all.forEach(function (b) {
    if (G.EB_BUFF_NAMES[b.main.id]) prim[b.main.id] = label(G.EB_BUFF_NAMES[b.main.id]);
    b.base.forEach(function (x) { if (G.EB_BUFF_NAMES[x.id]) sec[x.id] = label(G.EB_BUFF_NAMES[x.id]); });
  });
  var byId = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return a[0] - b[0]; }); };
  var types = {};
  m.all.forEach(function (b) { if (G.EB_TYPES[b.type]) types[b.type] = (types[b.type] || 0) + 1; });
  return {
    type: [['', 'Any beast']].concat(Object.keys(types).map(function (k) { return [k, clean(G.EB_TYPES[k]) + ' (' + fmtInt(types[k]) + ')']; }).sort(function (a, b) { return a[1].localeCompare(b[1]); })),
    where: [['', 'Fields and bench']].concat(m.fields.map(function (f) { return [String(f.cfg), f.name]; }), [['bench', 'Bench (' + fmtInt(m.bench) + ')']]),
    primary: [['', 'Any']].concat(byId(prim)), secondary: [['', 'Any']].concat(byId(sec)), sort: SORTS
  };
}

/* ---- optimizer: preferences, labels, swap view records ---- */
function validPrefs(p) {
  if (!p || typeof p !== 'object' || ['mono', 'dual', 'triple'].indexOf(p.mode) < 0) return null;
  var cap = p.mode === 'mono' ? 1 : p.mode === 'dual' ? 2 : 3;
  if (!Array.isArray(p.units) || p.units.length !== cap) return null;
  var units = p.units.map(function (u) { return Math.round(num(u)); });
  if (units.some(function (u) { return u < 1 || u > 3; }) || units.filter(function (u, i, a) { return a.indexOf(u) === i; }).length !== cap) return null;
  var w = null;
  if (p.mode !== 'mono' && Array.isArray(p.weights) && p.weights.length === cap) {
    w = p.weights.map(function (x) { return num(x); });
    if (w.some(function (x) { return x <= 0 || x > 2; })) return null;
  }
  return { mode: p.mode, units: units, balance: p.balance === 'primarySecondary' ? 'primarySecondary' : 'even', weights: p.mode === 'mono' ? null : w };
}
/* The saved choice from the one-screen chooser, in the shape classic reads and writes: the count of units picked is the mode */
function prefsFrom(units, weights) {
  var n = units.length;
  if (n < 1 || n > 3) return null;
  var mode = ['mono', 'dual', 'triple'][n - 1], w = n === 1 ? null : weights.slice(0, n);
  return validPrefs({ mode: mode, units: units.slice(), balance: mode === 'dual' && w[0] !== w[1] ? 'primarySecondary' : 'even', weights: w });
}
function readPrefs(raw) { var j = null; try { j = JSON.parse(raw); } catch (e) {} return validPrefs(j); }

/* the classic boPlaystyleLabel */
function playstyleLabel(core, prefs) {
  if (prefs.mode === 'mono') return 'Mono ' + ({ 1: 'Army', 2: 'Navy', 3: 'Air' })[prefs.units[0]];
  var U = { 1: 'Army', 2: 'Navy', 3: 'Air' };
  var weights = core.boResolveWeights(prefs), allEqual = weights.every(function (w) { return w === weights[0]; });
  var wStr = function (w) { return w === Math.floor(w) ? w.toFixed(1) : w.toString(); };
  var prefix = prefs.mode === 'triple' ? 'Triple' : 'Dual';
  if (allEqual) return prefix + ' ' + prefs.units.map(function (u) { return U[u]; }).join(' + ') + ' (even, ' + wStr(weights[0]) + 'x each)';
  return prefix + ' ' + prefs.units.map(function (u, i) { return U[u] + ' ' + wStr(weights[i]) + 'x'; }).join(' + ');
}
/* boFmtStat / boFmtStatDelta */
function fmtStat(key, val) { if (!val) return '0'; return key === 'march' ? val.toFixed(2) : val.toFixed(2) + '%'; }
function fmtDelta(key, d) {
  if (Math.abs(d) < 0.005) return '0';
  var sign = d > 0 ? '+' : '';
  return key === 'march' ? sign + d.toFixed(2) : sign + d.toFixed(2) + '%';
}
/* the classic boReasoning, with the written-out stat names */
function reasoning(G, core, rec, prefs) {
  if (!rec.to) return '';
  var contribs = {};
  function add(buffId, val) {
    var cls = core.boClassifyBuff(buffId, true);
    if (!cls) return;
    var v = val * G.BO_STAT_WEIGHTS[cls.statKey] * G.BO_SCOPE_MULT[cls.scope] * core.boPlaystyleMult(cls.targetUnit, prefs);
    if (v <= 0) return;
    contribs[cls.statKey] = (contribs[cls.statKey] || 0) + v;
  }
  if (rec.to.mb) { var raw = G.ebComputeBuffValue(rec.to.mb, G.boMaxStarFor(rec.to), G.boMaxLevelFor(rec.to), rec.to.pot, true); if (raw != null) add(rec.to.mb, raw); }
  (rec.to.bb || []).forEach(function (bid) { var r2 = G.ebComputeBuffValue(bid, G.boMaxStarFor(rec.to), G.boMaxLevelFor(rec.to), rec.to.pot, false); if (r2 != null) add(bid, r2); });
  var top = Object.keys(contribs).sort(function (a, b) { return contribs[b] - contribs[a]; }).slice(0, 2);
  return top.length ? 'Biggest gains: ' + top.map(function (k) { return STAT[k] || k; }).join(' and ') + '.' : '';
}

/* an optimizer beast (flat shape from boBuildOwnedBeasts) as a card record */
function liteBeast(G, b) {
  if (!b) return null;
  var st = num(b.st);
  return { id: String(b.id), type: num(b.type), name: clean(G.ebBeastName(b.type, st)), element: clean(G.EB_ELEMENTS[b.fac] || 'Unknown'), q: num(b.q), rarity: RARITY[num(b.q)] || '', star: st, lv: num(b.lv), pot: num(b.pot),
    maxPot: G.ebMaxPotential(num(b.q)), icon: iconFile(G, b.type, b.fac, st), where: b.placement ? { cfg: num(b.placement.fieldType), slot: num(b.placement.slot) } : null };
}
function fieldName(G, cfg) { return fname(clean(G.EB_FIELD_NAMES[cfg] || ('Field ' + num(cfg)))); }
function slotName(G, cfg, order) { return fieldName(G, cfg) + ' slot ' + num(order); }
function minus(t) { return String(t).replace(/^-/, '−'); }
function signed(n) { n = Math.round(num(n)); return (n >= 0 ? '+' : '−') + fmtInt(Math.abs(n)); }
function starsTxt(n) { return n + (n === 1 ? ' star' : ' stars'); }
/* "Army only", "Army and Air Force, equal weight", "Army (main) and Air Force (0.75)" */
function unitsPlain(core, prefs) {
  var w = core.boResolveWeights(prefs), names = prefs.units.map(function (u) { return UNITS[u]; });
  var join = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
  if (prefs.mode === 'mono') return names[0] + ' only';
  if (w.every(function (x) { return x === w[0]; })) return join(names) + ', equal weight';
  var main = w.indexOf(Math.max.apply(null, w));
  return join(names.map(function (n, i) { return n + ' (' + (i === main ? 'main' : trim(w[i], 2)) + ')'; }));
}
/* what a swap gains right now, in the one stat that moves the score most: shared by the card and the Next move so both quote the same number */
function topStat(G, opt, rec, prefs) {
  var a = opt.statProfile(rec.from, 'current', prefs, rec.slot), b = opt.statProfile(rec.to, 'current', prefs, rec.slot), key = null, top = 0;
  Object.keys(STAT).forEach(function (k) { var d = ((b[k] || 0) - (a[k] || 0)) * (G.BO_STAT_WEIGHTS[k] || 0); if (d > top) { top = d; key = k; } });
  if (!key) return null;
  var delta = (b[key] || 0) - (a[key] || 0);
  return { key: key, txt: key === 'march' ? '+' + trim(delta, 2) : '+' + trim(delta, 2) + '%', label: STAT[key] };
}

/* the classic swap card's stat table: rows where either beast contributes, the biggest weighted stat first */
function statRows(G, opt, rec, prefs) {
  var slot = rec.slot, fromMax = opt.statProfile(rec.from, 'maxOut', prefs, slot), toMax = opt.statProfile(rec.to, 'maxOut', prefs, slot);
  var keys = Object.keys(STAT).filter(function (k) { return Math.abs(fromMax[k] || 0) > 0.005 || Math.abs(toMax[k] || 0) > 0.005; });
  keys.sort(function (a, b) {
    return Math.max(toMax[b] || 0, fromMax[b] || 0) * (G.BO_STAT_WEIGHTS[b] || 0) - Math.max(toMax[a] || 0, fromMax[a] || 0) * (G.BO_STAT_WEIGHTS[a] || 0);
  });
  var fromNow = opt.statProfile(rec.from, 'current', prefs, slot), toNow = opt.statProfile(rec.to, 'current', prefs, slot);
  var z = function (k, t) { return t === '0' && k !== 'march' ? '0%' : t; };
  return keys.map(function (k) {
    var f = fromMax[k] || 0, t = toMax[k] || 0, fN = fromNow[k] || 0, tN = toNow[k] || 0;
    return { key: k, label: STAT[k], from: z(k, fmtStat(k, f)) + (Math.abs(fN - f) > 0.005 ? ' (' + z(k, fmtStat(k, fN)) + ')' : ''), to: z(k, fmtStat(k, t)) + (Math.abs(tN - t) > 0.005 ? ' (' + z(k, fmtStat(k, tN)) + ')' : ''),
      net: minus(z(k, fmtDelta(k, t - f))), dir: t - f > 0.005 ? 1 : t - f < -0.005 ? -1 : 0, loss: k !== 'march' && t - f < -5 ? Math.abs(t - f) : 0 };
  });
}
/* "Level it to 3 stars first" / "Level it to 3 stars and Lv.40 first" (level 0 or 1 at a new star means any level) */
function levelText(t) { return 'Level it to ' + starsTxt(t.star) + (t.level > 1 ? ' and Lv.' + t.level : '') + ' first'; }
function headline(from, to) {
  if (!to) return '';
  if (!from) return 'Put ' + to.name + ' in the empty slot';
  if (from.name === to.name) return 'Swap in ' + to.name + ' (' + to.rarity + ', Lv.' + to.lv + ') for ' + from.name + ' (' + from.rarity + ', Lv.' + from.lv + ')';
  return 'Swap in ' + to.name + ' for ' + from.name;
}
function reasonLine(from, to) {
  if (!from || !to || from.name !== to.name) return '';
  if (from.q !== to.q) return to.rarity + ' instead of ' + from.rarity;
  if (to.pot !== from.pot) return 'Same beast, ' + (to.pot > from.pot ? 'higher' : 'lower') + ' potential: ' + fmtInt(to.pot) + ' vs ' + fmtInt(from.pot) + ' of ' + fmtInt(to.maxPot);
  return 'Same beast, different stars and level';
}

/* One recommendation as a view record. A threshold the beast already meets is not shown (display safety net; the engine no longer produces one). */
function swapView(G, core, opt, rec, prefs) {
  var cfg = num(rec.slot.fieldType), order = num(rec.slot.order), to = liteBeast(G, rec.to), from = liteBeast(G, rec.from), th = rec.threshold;
  if (th && to && th.star <= to.star && th.level <= to.lv) th = null;
  var free = rec.gainToday > 0 && !th;
  return {
    id: cfg + '-' + order, cfg: cfg, fieldName: fieldName(G, cfg), order: order, from: from, to: to, free: free, top: free ? topStat(G, opt, rec, prefs) : null,
    headline: headline(from, to), reason: reasonLine(from, to),
    source: to && to.where ? slotName(G, to.where.cfg, to.where.slot) : 'bench',
    gainToday: Math.round(rec.gainToday), gainMax: Math.round(rec.gainAtMax), movesTo: null,
    chain: rec.chainSize > 1 ? { id: num(rec.chainId), size: num(rec.chainSize), netMax: Math.round(rec.chainNetMax), netToday: Math.round(rec.chainNetToday), backfill: !!rec.isBackfill, step: 0, partners: [] } : null,
    stats: statRows(G, opt, rec, prefs),
    threshold: th ? {
      star: num(th.star), level: num(th.level), maxStar: G.boMaxStarFor(rec.to), maxLv: G.boMaxLevelFor(rec.to), rarity: RARITY[num(rec.to.q)] || '', typeName: to.name,
      fodderNeeded: th.fodderNeeded == null ? null : num(th.fodderNeeded), fodderHave: num(th.fodderHave), feasible: th.fodderFeasible !== false
    } : null,
    broke: (rec.brokeConditions || []).reduce(function (a, e) {
      var l = typeof e === 'string' ? { fieldId: 0, slotOrder: 0, slotLabel: e, reqText: '' } : e, label = l.fieldId ? slotName(G, l.fieldId, l.slotOrder) : clean(l.slotLabel);
      var short = l.fieldId && l.slotOrder ? (G.EB_FIELD_CONDITIONS[l.fieldId] || [])[l.slotOrder - 1] : ''; /* the short text the Field pane shows */
      if (!a.some(function (x) { return x.label === label; })) a.push({ label: label, req: clean(short || l.reqText) });
      return a;
    }, []),
    why: reasoning(G, core, rec, prefs)
  };
}

/* FREE NOW (gain today above 0, no upgrade first) and AFTER LEVELLING (the rest). A linked move stays together, in the section of its best leg
   (the one with the largest fully levelled gain); sections list the biggest gain first (today for Free now, fully levelled for After levelling). */
function sectionsOf(swaps, byChain) {
  var units = [], seen = {};
  swaps.forEach(function (s) {
    if (!s.chain) { units.push({ legs: [s], free: !!s.free, today: s.gainToday, max: s.gainMax }); return; }
    if (seen[s.chain.id]) return;
    seen[s.chain.id] = 1;
    var legs = byChain[s.chain.id].slice().sort(function (a, b) { return a.chain.step - b.chain.step; });
    var today = legs.reduce(function (n, l) { return n + l.gainToday; }, 0);
    /* a linked move is free now only when NO step needs levelling and the steps together gain today */
    units.push({ legs: legs, free: legs.every(function (l) { return !l.threshold; }) && today > 0, today: today, max: Math.max.apply(null, legs.map(function (l) { return l.gainMax; })) });
  });
  var mk = function (key, title, hint, free) {
    var u = units.filter(function (x) { return x.free === free; }).sort(function (a, b) { return free ? b.today - a.today : b.max - a.max; });
    var out = []; u.forEach(function (x) { x.legs.forEach(function (l) { out.push(l); }); });
    return { key: key, title: title, hint: hint, swaps: out };
  };
  return [mk('now', 'Free now', 'Better today, no levelling needed', true), mk('later', 'After levelling', 'Level the new beast first, biggest gain first', false)].filter(function (x) { return x.swaps.length; });
}

/* The whole plan: totals, swaps in two sections, notes. `opt` is the ArmoryBeastsOpt instance of this player. */
function planModel(G, core, opt, merged, bench, prefs, siteKey) {
  var p = opt.plan(merged, bench, prefs, siteKey), r = p.result;
  var swaps = r.recommendations.map(function (rec) { return swapView(G, core, opt, rec, prefs); });
  var byTo = {}, byChain = {}, key = function (s) { return s.cfg * 100 + s.order; };
  swaps.forEach(function (s) { if (s.to) byTo[s.to.id] = s; if (s.chain) (byChain[s.chain.id] = byChain[s.chain.id] || []).push(s); });
  swaps.forEach(function (s) { if (s.from) { var o = byTo[s.from.id]; s.movesTo = o && o !== s ? slotName(G, o.cfg, o.order) : null; } });
  Object.keys(byChain).forEach(function (id) {
    var legs = byChain[id].sort(function (a, b) { return key(a) - key(b); });
    legs.forEach(function (s, i) { s.chain.step = i + 1; s.chain.partners = legs.filter(function (o) { return o !== s; }).map(function (o) { return { id: o.id, label: slotName(G, o.cfg, o.order) }; }); });
  });
  var sections = sectionsOf(swaps, byChain);
  var notes = [];
  if (bench && bench.ts) { var days = (Date.now() - new Date(bench.ts).getTime()) / 86400000; if (days > 7) notes.push({ t: 'Your bench data is ' + ageOld(bench.ts) + '.', update: true }); }
  if (bench && typeof bench.skippedDeployed === 'number') {
    var dep = p.owned.filter(function (b) { return b.placement; }).length;
    if (bench.skippedDeployed > dep) notes.push({ t: 'Your reports and game data cover only ' + dep + ' of ' + bench.skippedDeployed + ' deployed beasts, so the plan may be incomplete.', update: false });
  }
  return {
    swaps: swaps, sections: sections, totalToday: Math.round(r.totalGainToday), totalMax: Math.round(r.totalGainAtMax), warnings: r.conditionWarnings.length,
    nowN: (sections.filter(function (x) { return x.key === 'now'; })[0] || { swaps: [] }).swaps.length,
    units: unitsPlain(core, prefs), label: playstyleLabel(core, prefs), notes: notes, owned: p.owned.length, raw: r
  };
}

/* Next moves signal e: the best single swap a bench beast makes today (a swap that is not part of a chain and needs no upgrade first),
   as the move the Overview lists, routed to its card. null when there is none. */
function bestMove(G, core, opt, merged, bench, prefs, siteKey) {
  var p = opt.plan(merged, bench, prefs, siteKey), best = null;
  p.result.recommendations.forEach(function (rec) {
    if (rec.chainSize > 1 || rec.threshold || !rec.to || !(rec.gainToday > 0.5)) return;
    if (!best || rec.gainToday > best.gainToday) best = rec;
  });
  if (!best) return null;
  var slot = best.slot, to = liteBeast(G, best.to), from = liteBeast(G, best.from), top = topStat(G, opt, best, prefs);
  var same = from && from.name === to.name;
  var parts = [{ s: 'Swap ' }, { s: to.name + (same ? ' Lv.' + to.lv : ''), n: 1 }, { s: ' into ' }, { s: fieldName(G, slot.fieldType), n: 1 }, { s: ' slot ' }, { s: String(num(slot.order)), n: 1 }];
  if (top) parts.push({ s: ': ' }, { s: top.txt, n: 1 }, { s: ' ' + top.label });
  var q = to.q >= 5 ? 'q5' : to.q === 4 ? 'q4' : '';
  return { gain: best.gainToday, parts: parts, route: 'beasts/optimizer?swap=' + num(slot.fieldType) + '-' + num(slot.order),
    meta: (from ? 'Replaces your ' + from.name + ' Lv.' + from.lv : 'Fills an empty slot') + ' · from bench · no levelling needed', ico: { u: 'beast-icons/' + to.icon, q: q, fb: to.name.charAt(0) } };
}

/* the swap list the Copy button puts on the clipboard */
function checklist(plan) {
  var order = [];
  plan.sections.forEach(function (g) { g.swaps.forEach(function (s) { order.push(s); }); });
  var step = {}; order.forEach(function (s, i) { step[s.id] = i + 1; });
  var d = function (b) { return b.name + ' (' + b.rarity + ', ' + starsTxt(b.star) + ', Lv.' + b.lv + ')'; };
  var out = ['Beast swaps for ' + plan.units + ' (2864tw.com)'];
  order.forEach(function (s, i) {
    var line = (i + 1) + '. ' + fname(s.fieldName) + ' slot ' + s.order + ': put in ' + d(s.to) + (s.from ? ', take out ' + d(s.from) : '') + '.';
    if (s.threshold) line += ' ' + levelText(s.threshold) + '.';
    if (s.chain) line += ' Do with step ' + s.chain.partners.map(function (p) { return step[p.id]; }).join(' and ') + '.';
    out.push(line);
  });
  return out.join('\n');
}

var Logic = {
  label: label, num: num, fmtInt: fmtInt, ageOld: ageOld, iconFile: iconFile, beastView: beastView, resolveAll: resolveAll, model: model, collFilter: collFilter, collOptions: collOptions,
  validPrefs: validPrefs, prefsFrom: prefsFrom, readPrefs: readPrefs, playstyleLabel: playstyleLabel, fmtStat: fmtStat, fmtDelta: fmtDelta, reasoning: reasoning, liteBeast: liteBeast,
  statRows: statRows, swapView: swapView, planModel: planModel, sectionsOf: sectionsOf, bestMove: bestMove, checklist: checklist, unitsPlain: unitsPlain, topStat: topStat, levelText: levelText, signed: signed, fname: fname, condMatches: condMatches, headline: headline, reasonLine: reasonLine, SORTS: SORTS, STAT: STAT, RARITY: RARITY, PREFS_KEY: PREFS_KEY
};
root.ArmoryBeastsLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryBeasts = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, classicUrl = H.classicUrl, readOnly = H.readOnly;
var DEF = { elems: [], where: '', type: '', primary: '', secondary: '', sort: 'star', n: 24 }, F = Object.assign({}, DEF), PAGE = 24, STEP = 48;
var cur = { seg: 'field', q: {} }, M = null, mFor = null, opts = null, open = {}, wired = false, platOk = null;
var opt = null, optQ = null, plan = null, W = { units: [], weights: [] }, editing = false;

var CSS =
  '.bst-line{display:flex;flex-wrap:wrap;gap:0 8px}.bst-line > span{white-space:nowrap}' +
  '.bst-fs{display:flex;flex-direction:column;gap:12px}' +
  '.bst-hd{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--row);text-align:left;color:inherit}.bst-hd:active{background:var(--card-hi)}' +
  '.bst-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.bst-n{font-size:var(--fs-17);font-weight:700}.bst-m{font-size:var(--fs-13);color:var(--muted);display:flex;flex-wrap:wrap;gap:0 8px}.bst-nw{white-space:nowrap}' +
  '.bst-chev{transition:transform var(--t);flex:none}.bst-hd[aria-expanded="true"] .bst-chev{transform:rotate(180deg)}' +
  '.bst-card.is-open > .bst-hd{position:sticky;top:calc(var(--hdr) + 44px);z-index:1;background:var(--card)}' +
  '.bst-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}.bst-strip .ico,.bst-strip .fb{width:32px;height:32px}' +
  '.bst-bad{color:var(--bad)}' +
  '.bst-slots{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:12px}' +
  '.bst-slot{display:flex;flex-direction:column;gap:6px;background:var(--card-hi);border:1px solid var(--rule);border-radius:var(--r-card);padding:12px;min-width:0}' +
  '.bst-st{display:flex;align-items:center;justify-content:space-between;font-size:var(--fs-13);color:var(--muted)}.bst-st b{color:var(--text);font-weight:700}.bst-off{font-size:var(--fs-12)}' +
  '.bst-beast{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--tap);text-align:left;color:inherit;border-radius:var(--r-chip)}.bst-beast:active{background:var(--card)}' +
  '.bst-ib{position:relative;flex:none;width:48px;height:48px}.bst-ib .ico,.bst-ib .fb{width:48px;height:48px}.bst-ib .bst-el{position:absolute;top:-3px;right:-3px;width:18px;height:18px;border:0;background:none}' +
  '.bst-bt{flex:1;min-width:0}.bst-bn{font-weight:700;font-size:var(--fs-15)}.bst-bm{font-size:var(--fs-13);color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;gap:0 8px}' +
  '.bst-gap{width:48px;height:48px;border:1.5px dashed var(--border);border-radius:var(--r-chip);flex:none}.bst-take{font-size:var(--fs-15);font-weight:600}' +
  '.bst-ln{display:flex;justify-content:space-between;font-size:var(--fs-13);color:var(--muted)}.bst-ln > span:last-child{margin-left:12px;white-space:nowrap;color:var(--text);font-weight:600}.bst-ln.bst-main{font-size:var(--fs-14);color:var(--text)}' +
  '.bst-ln.hit{color:var(--text);font-weight:600}' +
  '.bst-pot{display:flex;align-items:center;gap:8px;font-size:var(--fs-13);color:var(--muted)}.bst-pot .meter{flex:1}.bst-pot .v{min-width:44px;text-align:right;color:var(--text);font-weight:600}' +
  '.bst-foot{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:6px;display:flex;flex-direction:column;gap:2px}' +
  '.bst-fs2{display:none}' +
  '.bst-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.bst-f .sel{min-width:0;width:100%}' +
  '.bst-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}' +
  '.bst-c{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:12px;min-width:0}' +
  '.bst-c .bst-beast::after{content:"";position:absolute;inset:0}' +
  '.bst-c.bst-q1{border-color:var(--dim)}.bst-c.bst-q2{border-color:var(--ok)}.bst-c.bst-q3{border-color:var(--q3)}.bst-c.bst-q4{border-color:var(--q4)}.bst-c.bst-q5{border-color:var(--q5)}' +
  '.bst-cf{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:6px;display:flex;justify-content:space-between}.bst-cf > span:last-child{margin-left:8px}' +
  '.bst-tally{font-size:var(--fs-13);color:var(--muted)}.bst-sh{display:flex;flex-direction:column;gap:12px}.bst-sh h4{font:700 var(--fs-13)/1.3 var(--sans);color:var(--muted);margin:0 0 4px}' +
  '.bst-wiz{display:flex;flex-direction:column;gap:12px;max-width:560px}.bst-wr{display:flex;align-items:center;justify-content:space-between;min-height:var(--tap)}.bst-wr .sel{margin-left:12px}' +
  '.bst-hl{font:600 var(--fs-17)/1.3 var(--sans)}.bst-q{font:700 var(--fs-17)/1.3 var(--sans);margin:0}' +
  '.bst-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bst-note{border-left:3px solid var(--warn);padding:8px 12px;background:var(--card);border-radius:0 var(--r-chip) var(--r-chip) 0;font-size:var(--fs-14)}' +
  '.bst-grp{display:flex;flex-direction:column;gap:8px}.bst-gh{display:flex;align-items:baseline;gap:8px;padding-bottom:4px;border-bottom:1px solid var(--rule)}.bst-gh b{font-size:var(--fs-15)}.bst-opts{display:flex;flex-direction:column;gap:8px}' +
  '.bst-sw{display:flex;flex-direction:column;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:12px}.bst-sw.is-sel{box-shadow:inset 2px 0 0 var(--accent)}' +
  '.bst-swh{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:var(--fs-13);color:var(--muted)}.bst-swh b{color:var(--text);font-size:var(--fs-15)}' +
  '.bst-sl{font:600 var(--fs-15)/1.3 var(--sans);margin:0}' +
  '.bst-io{display:flex;flex-direction:column;gap:4px}.bst-row{display:flex;align-items:flex-start;gap:12px;width:100%;min-height:var(--tap);padding:4px 0;text-align:left;color:inherit}.bst-row .bst-ib,.bst-row .ico,.bst-row .fb{width:40px;height:40px}.bst-rl{flex:none;width:32px;font-size:var(--fs-12);font-weight:500;color:var(--muted);padding-top:10px}.bst-row .bst-gap{width:40px;height:40px}.bst-gain{font-size:var(--fs-14)}'+
  '.bst-more summary{display:flex;align-items:center;min-height:44px;font-size:var(--fs-14);font-weight:600;cursor:pointer}.bst-more[open] summary{margin-bottom:4px}' +
  '.bst-tb{width:100%;border-collapse:collapse;font-size:var(--fs-13)}.bst-tb caption{caption-side:top;text-align:left;padding:0 0 4px;font-size:var(--fs-12);color:var(--muted)}.bst-tb th{text-align:right;color:var(--muted);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--rule)}.bst-tb th:first-child,.bst-tb td:first-child{text-align:left}' +
  '.bst-tb td{padding:4px 6px;text-align:right}.bst-tb td.chg{font-weight:700}' +
  '.bst-call{font-size:var(--fs-13);padding:8px 12px;border-left:3px solid var(--border);background:var(--surface);border-radius:0 var(--r-chip) var(--r-chip) 0}.bst-call.warn{border-left-color:var(--warn)}.bst-call.bad{border-left-color:var(--bad)}' +
  '.bst-why{font-size:var(--fs-13);color:var(--muted)}.bst-ban{height:40px;border-radius:var(--r-card);background:var(--card);border:1px solid var(--border)}' +
  '@media (max-width:599px){.bst-c .bst-ln:not(.bst-main):not(.hit){display:none}}' +
  '@media (min-width:600px){.bst-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bst-slots{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
  '@media (min-width:768px){.bst-fbtn{display:none}.bst-fs2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 12px}.bst-card.is-open > .bst-hd{position:static}.bst-grid{grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '}' +
  '@media (min-width:1024px){.bst-fs2{grid-template-columns:repeat(5,1fr)}.bst-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.bst-slots{grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '#v-beasts .bst-fs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}#v-beasts .bst-card.is-open{grid-column:1/-1}.bst-strip .ico,.bst-strip .fb{width:40px;height:40px}' +
  '#v-beasts [data-pane="optimizer"] .bst-opts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}}';

function injectCss() {
  if (document.getElementById('bst-style')) return;
  var s = document.createElement('style'); s.id = 'bst-style'; s.textContent = CSS; document.head.appendChild(s);
}
var DOT = '<span aria-hidden="true">\u00B7</span>';
function sp(t, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + nd(t) + '</span>'; }
function joinDots(a) { return a.filter(Boolean).map(function (t) { return sp(t); }).join('<span aria-hidden="true">·</span>'); }
function qb(q) { return q >= 3 ? ' ' + H.qCls(q) : ''; }
function priv() { return (S.res && S.res.privacy) || {}; }
function benchSupp() { var s = S.res && S.res.supp || {}; return priv().bench ? null : (s.bench || null); }
function enigSupp() { var s = S.res && S.res.supp || {}; return priv().enigma ? null : (s.enigma || null); }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }
function classicLink(text) { return '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl('enigma')) + '">' + ic('ext', 'sm') + '<span>' + esc(text) + '</span></a></div>'; }
function icoBeast(b, cls) {
  return '<span class="bst-ib">' + art(BASE + 'beast-icons/' + b.icon, 'ico' + qb(b.q) + (cls ? ' ' + cls : ''), b.name.charAt(0), b.name) +
    (b.element && ELEMENTS.indexOf(b.element) >= 0 ? art(BASE + 'beast-icons/element_' + b.element + '.png', 'bst-el', '', b.element) : '') + '</span>';
}
function stars5(n) { return H.stars(Math.max(0, Math.min(5, n)), 5); }
function line(label, val, cls) { return '<div class="bst-ln ' + (cls || '') + '"><span>' + esc(label) + '</span><span translate="no">' + esc(val) + '</span></div>'; }
function potBar(b) {
  return '<div class="bst-pot"><span>Potential</span><div class="meter r-' + H.ramp(b.potPct) + '" role="img" aria-label="Potential ' + b.potPct + ' percent"><i style="width:' + Math.max(2, Math.min(100, b.potPct)) + '%"></i></div><span class="v" translate="no">' + b.potPct + '%</span></div>';
}
function buffRows(b) {
  var r = '<div class="bst-ln bst-main"><span>' + esc(b.main.name) + '</span><span translate="no">' + esc(b.main.txt) + '</span></div>';
  b.base.forEach(function (x) { r += '<div class="bst-ln' + (F.secondary && String(x.id) === F.secondary ? ' hit' : '') + '"><span>' + esc(x.name) + '</span><span translate="no">' + esc(x.txt) + '</span></div>'; });
  return r;
}
function wherePart(b) { return b.fieldCfg ? esc(b.fieldName) + ' slot ' + nd(String(b.slot)) : 'Bench'; }

/* ---- Field ---- */
/* "Takes Epic or better · Water · Eagle, Bear or Kangaroo": only the real constraints */
function takes(s) {
  var r = s.req;
  if (!r) return '';
  if (r.universal) return 'Takes any beast';
  var parts = [r.rarity + ' or better'];
  if (r.elementId) parts.push(r.element);
  if (r.types !== 'Any type') parts.push(r.types.replace(/ \/ /g, ', ').replace(/, ([^,]*)$/, ' or $1'));
  return 'Takes ' + parts.join(' · ');
}
function slotCard(f, s) {
  var tk = takes(s), plv = s.platformLv != null ? 'Platform Lv.' + s.platformLv : '';
  var head = '<div class="bst-st"><b>' + nd('Slot ' + s.num) + '</b>' + (s.on === false ? '<span class="bst-off">Slot bonus off</span>' : '') + '</div>';
  var need = s.cond ? '<span>' + nd('Slot bonus needs: ' + s.cond) + '</span>' : '';
  if (!s.beast) {
    return '<div class="bst-slot" id="bsl-' + f.cfg + '-' + s.num + '">' + head + '<div class="bst-beast" style="cursor:default"><span class="bst-gap" aria-hidden="true"></span><div class="bst-bt"><div class="bst-take">' + nd('Empty' + (tk ? ' · ' + tk.replace(/^Takes/, 'takes') : '')) + '</div>' +
      (plv ? '<div class="bst-bm">' + nd(plv) + '</div>' : '') + '</div></div>' + (need ? '<div class="bst-foot">' + need + '</div>' : '') + '</div>';
  }
  var b = s.beast;
  return '<div class="bst-slot" id="bsl-' + f.cfg + '-' + s.num + '">' + head +
    '<button class="bst-beast" type="button" data-bst="' + esc(b.id) + '" aria-label="' + esc(b.name) + ' details">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no">' + esc(b.name) + '</span><span class="bst-bm">' + stars5(b.star) +
    sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span></span></span></button>' +
    (s.buffs.length ? s.buffs.map(function (x) { return line(x.name, x.txt); }).join('') : '<div class="t13 muted">No slot buffs</div>') + potBar(b) +
    '<div class="bst-foot"><span>' + nd([plv, tk].filter(Boolean).join(' · ')) + '</span>' + need + '</div></div>';
}
function fieldCard(f, isOpen) {
  var meta = [f.deployed + ' of ' + f.expected + ' slots'];
  if (f.legendary) meta.push(f.legendary + ' Legendary');
  if (f.bonusKnown && f.slots.length) meta.push(f.bonusOn + ' of ' + f.slots.length + ' slot bonuses on');
  var strip = !isOpen ? '<div class="bst-strip">' + f.slots.filter(function (s) { return s.beast; }).map(function (s) { return art(BASE + 'beast-icons/' + s.beast.icon, 'ico' + qb(s.beast.q), s.beast.name.charAt(0), s.beast.name); }).join('') + '</div>' : '';
  var body = isOpen ? '<div class="bst-slots">' + f.slots.map(function (s) { return slotCard(f, s); }).join('') + '</div>' : '';
  var inactive = f.active ? '' : '<span class="bst-bad">Inactive</span>';
  return '<section class="card bst-card' + (isOpen ? ' is-open' : '') + '" id="bsf-' + f.cfg + '"><button class="bst-hd" type="button" data-bsto="' + f.cfg + '" aria-expanded="' + isOpen + '"><span class="bst-t"><span class="bst-n" translate="no">' + esc(f.name) + '</span>' +
    '<span class="bst-m">' + inactive + meta.map(function (t, i) { return (i || inactive ? '<span aria-hidden="true">·</span>' : '') + '<span class="bst-nw">' + nd(t) + '</span>'; }).join('') + '</span></span>' + ic('down', 'bst-chev') + '</button>' + strip + body + '</section>';
}
function summary() {
  var z = M.summary;
  return '<p class="t13 muted bst-line">' + joinDots([fmtInt(z.beasts) + ' deployed in ' + z.inFields + ' of ' + M.fields.length + ' fields', fmtInt(z.fiveStar) + ' at 5 stars', z.avgPot + '% average potential', 'Power ' + fmtInt(z.power)]) + '</p>';
}
function srcLine() {
  var e = enigSupp(), t = e && e.ts ? Logic.ageOld(e.ts) : '';
  return '<p class="foot">' + nd('Source: ' + (e ? 'game data' + (t ? ', ' + t : '') : 'battle reports')) + '</p>';
}
function fieldPane() {
  if (!M) return needData('No beast data yet.');
  if (platOk === false) return '<div class="empty">Could not load the beast platform data. Check your connection and reload the page.</div>';
  if (!M.fields.length) return '<div class="sechead"><h2 class="title">Beast fields</h2></div>' + summary() + '<div class="empty">No field data in these reports or game data yet. The collection has your beasts.</div>';
  var wantCfg = +cur.q.field || 0, html = '';
  M.fields.forEach(function (f) { var k = String(f.cfg); html += fieldCard(f, open[k] != null ? open[k] : wantCfg === f.cfg); });
  return '<div class="sechead"><h2 class="title">Beast fields</h2></div>' + summary() + '<div class="bst-fs">' + html + '</div>' + srcLine();
}

/* ---- Collection ---- */
function dirty() { return F.elems.length + (F.where ? 1 : 0) + (F.type ? 1 : 0) + (F.primary ? 1 : 0) + (F.secondary ? 1 : 0); }
function collCard(b) {
  return '<div class="bst-c bst-q' + Math.max(1, Math.min(5, b.q)) + '"><button class="bst-beast" type="button" data-bst="' + esc(b.id) + '" aria-label="' + esc(b.name) + ' details">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no">' + esc(b.name) + '</span><span class="bst-bm">' + stars5(b.star) +
    sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span></span></span></button>' + buffRows(b) + potBar(b) + '<div class="bst-cf"><span>' + wherePart(b) + '</span><span>' + nd('Power ' + fmtInt(b.power)) + '</span></div></div>';
}
function collList() {
  var f = Logic.collFilter(M.all, F), shown = f.slice(0, F.n), total = fmtInt(M.all.length);
  var tally = !f.length ? '' : '<p class="bst-tally" role="status">' + nd('Showing ' + fmtInt(shown.length) + ' of ' + fmtInt(f.length) + (f.length === M.all.length ? '' : ' · ' + total + ' collected')) + '</p>';
  return (shown.length ? '<div class="bst-grid">' + shown.map(collCard).join('') + '</div>' : '<div class="empty">' + (F.where === 'bench' && !F.elems.length && !F.type && !F.primary && !F.secondary ? 'No beasts on the bench.' : 'No beasts match these filters.') + ' <button class="tb link" type="button" data-bstclear>Clear filters</button></div>') + tally +
    (f.length > shown.length ? '<button class="btn more" type="button" data-bstmore><span>Show ' + nd(fmtInt(Math.min(STEP, f.length - shown.length))) + ' more</span></button>' : '');
}
function selectHtml(k, lab) {
  return '<label class="bst-f"><span>' + esc(lab) + '</span><select class="sel" data-bsf="' + k + '">' + opts[k].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (/\d/.test(o[1]) ? ' translate="no"' : '') + (String(F[k]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
}
function elemChips() {
  return ELEMENTS.map(function (e) { return '<button class="chipbtn" type="button" data-bse="' + e + '" aria-pressed="' + (F.elems.indexOf(e) >= 0) + '">' + esc(e) + '</button>'; }).join('');
}
function btnText() { var n = dirty(); return 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }
function collPane() {
  if (!M) return needData('No beast data yet.');
  var age = Logic.ageOld(M.benchTs);
  return '<div class="sechead"><h2 class="title">Beast collection</h2></div><div class="fbar"><div class="grow t13 muted">' + nd(fmtInt(M.all.length) + ' collected' + (M.bench ? ' · ' + fmtInt(M.bench) + ' on bench' : '')) + '</div>' +
    '<button class="btn bst-fbtn" type="button" data-open="bstfilter">' + ic('sliders', 'sm') + btnText() + '</button></div>' +
    '<div class="bst-fs2"><div class="bst-f" style="grid-column:1/-1"><span>Element</span><div class="chips">' + elemChips() + '</div></div>' + selectHtml('where', 'Where') + selectHtml('type', 'Beast') + selectHtml('primary', 'Main buff') + selectHtml('secondary', 'Base buff') + selectHtml('sort', 'Sort') + '</div>' +
    '<div id="bstList" style="display:flex;flex-direction:column;gap:12px">' + collList() + '</div>' + (age ? '<p class="foot">' + nd('Source: bench data, ' + age) + '</p>' : '');
}
function chipGroup(k, lab, list) {
  return '<div><h4>' + esc(lab) + '</h4><div class="chips">' + list.map(function (o) { return '<button class="chipbtn" type="button" data-bsc="' + k + ':' + esc(o[0]) + '" aria-pressed="' + (String(F[k]) === String(o[0])) + '">' + nd(o[1]) + '</button>'; }).join('') + '</div></div>';
}
function filterSheet() {
  if (!M) return null;
  var body = '<div class="ctrls bst-sh">' + chipGroup('sort', 'Sort by', opts.sort) + '<div><h4>Element</h4><div class="chips">' + elemChips() + '</div></div>' +
    selectHtml('where', 'Where') + selectHtml('type', 'Beast') + selectHtml('primary', 'Main buff') + selectHtml('secondary', 'Base buff') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>';
  return ['Filter and sort', body];
}
function collRefresh() {
  var l = $('#bstList'); if (l) l.innerHTML = collList();
  $$('.bst-fbtn').forEach(function (b) { b.lastChild.textContent = btnText(); });
  $$('select[data-bsf]').forEach(function (x) { if (F[x.dataset.bsf] !== undefined && x.value !== String(F[x.dataset.bsf])) x.value = String(F[x.dataset.bsf]); });
  $$('[data-bse]').forEach(function (x) { x.setAttribute('aria-pressed', F.elems.indexOf(x.dataset.bse) >= 0 ? 'true' : 'false'); });
}

/* ---- the beast sheet ---- */
function beastSheet(id) {
  var b = M && M.byId[String(id)]; if (!b) return null;
  var dep = b.fieldCfg ? joinDots([b.fieldName + ' slot ' + b.slot, b.platformLv ? 'Platform Lv.' + b.platformLv : '']) : 'Not deployed (bench)';
  var base = b.base.length ? '<h4 class="lab">Base buffs</h4>' + b.base.map(function (x) { return line(x.name, x.txt3); }).join('') : '';
  var slotB = b.slotBuffs.length ? '<h4 class="lab">Slot buffs</h4>' + b.slotBuffs.map(function (x) { return line(x.name, x.txt); }).join('') : '';
  var body = '<div class="bst-sh"><div class="bst-beast" style="cursor:default">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bm">' + stars5(b.star) + sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span>' + (RARITY[b.q] ? '<span class="pill"><span>' + esc(RARITY[b.q]) + '</span></span>' : '') + '</span>' +
    '<span class="bst-bm" style="margin-top:4px">' + dep + '</span></span></div>' +
    '<h4 class="lab">Main buff</h4><div class="bst-ln bst-main"><span>' + esc(b.main.name) + '</span><span translate="no">' + esc(b.main.txt3) + '</span></div>' + base + slotB +
    '<div class="bst-pot"><span>Potential</span><div class="meter r-' + H.ramp(b.potPct) + '"><i style="width:' + Math.max(2, Math.min(100, b.potPct)) + '%"></i></div><span class="v" translate="no">' + esc(fmtInt(b.pot) + ' / ' + fmtInt(b.maxPot)) + '</span></div>' +
    '<div class="bst-ln"><span>Power</span><span translate="no">' + esc(fmtInt(b.power)) + '</span></div></div>' +
    '<button class="btn" type="button" data-close style="width:100%;margin-top:12px">Close</button>';
  return [b.name, body, true];
}

/* ---- Optimizer ---- */
function prefsKey() { var k = H.sk(); return k ? PREFS_KEY + k : null; }
function savedPrefs() { var k = prefsKey(); return k ? Logic.readPrefs(H.ls(k)) : null; }
var curPrefs = null; /* {sk, p}: this session's choice for ONE player (never reused for another) */
function activePrefs() { if (curPrefs && curPrefs.sk === H.sk()) return curPrefs.p; return editing ? null : savedPrefs(); }
function wizPane() {
  var UN = [[1, 'Army'], [2, 'Navy'], [3, 'Air Force']], n = W.units.length;
  var chips = UN.map(function (u) { var on = W.units.indexOf(u[0]) >= 0; return '<button class="chipbtn" type="button" data-bsw="unit:' + u[0] + '" aria-pressed="' + on + '">' + (on ? ic('check', 'sm') : '') + '<span>' + esc(u[1]) + '</span></button>'; }).join('');
  var wRows = '';
  if (n >= 2) {
    var presets = n === 2 ? [[1, 1], [1, 0.75], [1, 0.5], [1, 0.25]] : [[1, 1, 1], [1, 0.75, 0.75], [1, 0.5, 0.5], [1, 0.75, 0.5], [1, 0.5, 0.25]];
    wRows = '<div class="card"><p class="t13 muted" style="margin-bottom:8px">How much each unit counts. A higher number means the optimizer favours buffs for that unit. The first one you tapped comes first.</p>' + W.units.map(function (u, i) {
      return '<div class="bst-wr"><span>' + esc(UNITS[u]) + '</span><select class="sel" data-bsws="' + i + '" aria-label="' + esc(UNITS[u]) + ' weight">' + [1, 0.75, 0.5, 0.25].map(function (w) { return '<option value="' + w + '"' + (Math.abs(w - W.weights[i]) < 1e-6 ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select></div>';
    }).join('') + '<div class="chips" style="margin-top:8px">' + presets.map(function (p) {
      var on = p.every(function (w, i) { return Math.abs(w - W.weights[i]) < 1e-6; });
      return '<button class="chipbtn" type="button" data-bsw="preset:' + p.join(',') + '" aria-pressed="' + on + '">' + (on ? ic('check', 'sm') : '') + '<span>' + nd(p.every(function (w) { return w === 1; }) ? 'Equal weight' : p.map(function (w, i) { return UNITS[W.units[i]] + ' ' + w; }).join(' · ')) + '</span></button>';
    }).join('') + '</div></div>';
  }
  return '<div class="sechead"><h2 class="title">Beast optimizer</h2></div><p class="muted">Finds beast swaps from your collection that raise your field buffs for the units you march.</p><div class="bst-wiz"><h3 class="bst-q">Which units do you march with?</h3>' +
    '<div class="chips">' + chips + '</div>' + wRows + '<p class="t13" role="alert" id="bstWerr" hidden>Pick at least one unit first.</p>' +
    '<div class="bst-acts"><button class="btn bst-go" type="button" data-bsw="go">Optimize</button>' + (savedPrefs() ? '<button class="tb link" type="button" data-bsw="cancel">Keep my choice</button>' : '') + '</div></div>';
}
function swapLinks(c) { return c.partners.map(function (p) { return '<a href="#beasts/optimizer?swap=' + esc(p.id) + '" translate="no">' + esc(p.label) + '</a>'; }).join(' and '); }
/* one compact row: Out / In, icon, name, stars, level, potential with its cap */
function beastRow(b, label, note) {
  if (!b) return '<div class="bst-row"><b class="bst-rl">' + esc(label) + '</b><span class="bst-gap" aria-hidden="true"></span><span class="bst-bt"><span class="bst-bn muted">Empty slot</span></span></div>';
  return '<button class="bst-row" type="button" data-bst="' + esc(b.id) + '" aria-label="' + esc(label + ': ' + b.name) + '"><b class="bst-rl">' + esc(label) + '</b>' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no">' + esc(b.name) + '</span><span class="bst-bm">' + stars5(b.star) + sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span>' +
    (b.rarity ? '<span class="pill"><span>' + esc(b.rarity) + '</span></span>' : '') + '</span><span class="bst-bm">' + sp('Potential ' + fmtInt(b.pot) + ' / ' + fmtInt(b.maxPot)) + '</span>' + (note ? '<span class="bst-bm">' + sp(note) + '</span>' : '') + '</span></button>';
}
function swapCard(s) {
  var c = s.chain, chain = '';
  if (c) {
    chain = '<div class="bst-call">' + nd('Step ' + c.step + ' of ' + c.size + '. Do it together with ') + swapLinks(c) + nd(': together ' + Logic.signed(c.netToday) + ' today, ' + Logic.signed(c.netMax) + ' fully levelled.') + '</div>';
  }
  var table = s.stats.length ? '<details class="bst-more"><summary>Stat by stat</summary><table class="bst-tb"><caption>Both beasts fully levelled. Today in brackets.</caption><thead><tr><th scope="col">Stat</th><th scope="col">Out</th><th scope="col">In</th><th scope="col">Change</th></tr></thead><tbody>' +
    s.stats.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td translate="no">' + esc(r.from) + '</td><td translate="no">' + esc(r.to) + '</td><td class="chg" translate="no">' + esc(r.net) + '</td></tr>'; }).join('') + '</tbody></table></details>' : '';
  var th = '';
  if (s.threshold) {
    var t = s.threshold;
    th = '<div class="bst-call warn">' + nd(Logic.levelText(t) + '.' + (t.fodderNeeded != null ? ' It uses ' + t.fodderNeeded + ' one-star ' + t.rarity + ' ' + t.typeName + (t.fodderNeeded === 1 ? '' : 's') + '; you have ' + t.fodderHave + ' on the bench.' + (t.feasible ? '' : ' Not enough yet.') : '')) + '</div>';
  }
  var broke = s.broke.length ? '<div class="bst-call bad"><b>' + nd('Turns off the slot bonus on ' + s.broke.map(function (x) { return x.label; }).join(', ') + '.') + '</b>' + s.broke.filter(function (x) { return x.req; }).map(function (x) { return '<div class="t12">' + nd(x.label + ' needs: ' + x.req) + '</div>'; }).join('') +
    '<div class="t12">The beast in that slot stays put; only the slot bonus drops until you meet its condition again.</div></div>' : '';
  return '<article class="bst-sw" id="bsw-' + esc(s.id) + '"><div class="bst-swh"><b>' + nd(s.fieldName + ' slot ' + s.order) + '</b><span>' + nd('From ' + s.source) + '</span></div>' +
    '<p class="bst-sl">' + nd(s.headline) + '</p>' + (s.reason ? '<p class="t13 muted">' + nd(s.reason) + '</p>' : '') +
    '<div class="bst-io">' + beastRow(s.from, 'Out', s.from ? (s.movesTo ? 'Moves to ' + s.movesTo : 'Goes to the bench') : '') + beastRow(s.to, 'In') + '</div>' +
    '<p class="bst-gain">' + nd('Buff score: ' + Logic.signed(s.gainToday) + ' today, ' + Logic.signed(s.gainMax) + ' fully levelled' + (s.top ? '. Right now: ' + s.top.txt + ' ' + s.top.label : '')) + '</p>' +
    chain + th + broke + table + (s.why ? '<p class="bst-why">' + esc(s.why) + '</p>' : '') + '</article>';
}
function copyBtn() { return '<button class="btn" type="button" data-bsa="copy">' + ic('copy', 'sm') + '<span>Copy swap list</span></button>'; }
function planPane() {
  var P = plan, laterN = P.swaps.length - P.nowN;
  var top = '<div class="card bst-top" style="display:flex;flex-direction:column;gap:8px"><p class="t13 muted">' + nd('For ' + P.units) + ' · <button class="tb link" type="button" data-bsa="edit">Change</button></p>' +
    '<p class="bst-hl">' + nd(P.swaps.length + (P.swaps.length === 1 ? ' swap' : ' swaps') + ': ' + P.nowN + ' free now, ' + laterN + ' after levelling') + '</p>' +
    '<p class="t13 muted">' + nd('In total: ' + Logic.signed(P.totalToday) + ' buff score today, ' + Logic.signed(P.totalMax) + ' when every new beast is fully levelled.') + ' <button class="info" type="button" data-open="bstscore" aria-label="How the buff score works">' + ic('info', 'sm') + '</button></p>' +
    (P.swaps.length ? '<div class="bst-acts">' + copyBtn() + '</div>' : '') + '</div>';
  var notes = P.notes.map(function (n) { return '<div class="bst-note">' + nd(n.t) + (n.update && !readOnly() ? ' <button class="tb link" type="button" data-open="status">Update</button>' : '') + '</div>'; }).join('');
  var body = !P.swaps.length ? '<div class="card"><p>' + nd('Your current placements are already the best for ' + P.units + '. Change the units to compare.') + '</p></div>' :
    P.sections.map(function (g) {
      return '<section class="bst-grp" aria-label="' + esc(g.title) + '"><div class="bst-gh"><h3 class="bst-q">' + esc(g.title) + '</h3><span class="t13 muted">' + nd(g.swaps.length + (g.swaps.length === 1 ? ' swap' : ' swaps') + ' \u00B7 ' + g.hint) + '</span></div><div class="bst-opts">' + g.swaps.map(swapCard).join('') + '</div></section>';
    }).join('') + '<div class="bst-acts">' + copyBtn() + '</div>';
  return '<div class="sechead"><h2 class="title">Beast optimizer</h2></div>' + top + notes + body + classicLink('Breeding priorities are on the classic page');
}
function scoreSheet() {
  var W = G.BO_STAT_WEIGHTS;
  return ['How the buff score works', '<div class="bst-sh"><p>Buff score: 1 point = 1% Attack for the units you picked.</p><p>' + nd('1% DMG increase or 1% Decreased DMG Taken = ' + W.dmgInc + ' points, 1% Defense = ' + W.def + ', +1 March Size = ' + W.march + ', 1% HP = ' + W.hp + ', Elemental buffs = 0.') + '</p>' +
    '<p>"Today" uses each beast\'s current stars and level. "Fully levelled" assumes both beasts at the top stars and level for their rarity. March Size never drops at a slot.</p></div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>'];
}
function optHost() { return $('#v-beasts [data-pane="optimizer"]'); }
function optShow(html) { var h = optHost(); if (h) h.innerHTML = html; }
function loadOpt(cb, bad) {
  if (opt) return cb(opt);
  if (optQ) { optQ.push([cb, bad]); return; }
  optQ = [[cb, bad]];
  var sc = document.createElement('script'); sc.src = 'armory-beasts-opt.js';
  sc.onload = function () {
    var q = optQ; optQ = null;
    try { opt = window.ArmoryBeastsOpt.create(core); } catch (e) { if (window.console) console.warn(e); q.forEach(function (p) { p[1](); }); return; } /* a script that loads but cannot start is a failed load */
    q.forEach(function (p) { p[0](opt); });
  };
  sc.onerror = function () { var q = optQ; optQ = null; q.forEach(function (p) { p[1](); }); }; /* every waiter hears about the failure */
  document.body.appendChild(sc);
}
function optFail() { optShow('<div class="empty">Could not load the optimizer. Check your connection and reload the page.</div>'); }
var planFor = null;
/* ?swap=<field>-<slot>: the card a Next move points at gets the selection mark and scrolls into view */
function selSwap() {
  var id = cur.q && cur.q.swap; if (!id || !/^\d+-\d+$/.test(id)) return;
  var el = document.getElementById('bsw-' + id); if (!el) return;
  $$('.bst-sw.is-sel').forEach(function (x) { x.classList.remove('is-sel'); }); el.classList.add('is-sel');
  setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 30);
}
function renderOptimizer() {
  if (!M) { optShow(needData('No beast data yet.')); return; }
  if (!H.sk()) { optShow('<div class="empty">The optimizer needs a verified player. Open your own armory to use it.</div>'); return; }
  if (platOk === false) { optShow('<div class="empty">Could not load the beast platform data. Check your connection and reload the page.</div>'); return; }
  var ps = activePrefs();
  if (!ps) { optShow(wizPane()); return; }
  var key = JSON.stringify(ps);
  if (plan && planFor && planFor.key === key && planFor.merged === S.res.merged) { optShow(planPane()); selSwap(); return; }
  optShow('<div class="sechead"><h2 class="title">Beast optimizer</h2></div><div class="bst-ban" aria-hidden="true"></div><p class="t13 muted" role="status">Working out the best placements...</p>');
  loadOpt(function (o) {
    setTimeout(function () {
      try {
        plan = Logic.planModel(G, core, o, S.res.merged, benchSupp(), ps, H.sk()); planFor = { key: key, merged: S.res.merged };
        optShow(planPane()); selSwap();
      } catch (e) { if (window.console) console.error(e); optShow('<div class="empty">Could not work out the plan. Reload the page to try again.</div>'); }
    }, 20);
  }, optFail);
}
/* Copy with the kit toast and a textarea fallback (Share does the same) */
function copyText(text) {
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); H.toast(ok ? 'Swap list copied' : 'Could not copy. Select the list by hand');
  }
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { H.toast('Swap list copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
}
function wizClick(v) {
  var kv = v.split(':'), a = kv[0], val = kv.slice(1).join(':');
  if (a === 'unit') {
    var u = +val, i = W.units.indexOf(u);
    if (i >= 0) { W.units.splice(i, 1); W.weights.splice(i, 1); } else { W.units.push(u); W.weights.push(1); }
  } else if (a === 'preset') W.weights = val.split(',').map(Number);
  else if (a === 'cancel') { editing = false; renderOptimizer(); return; }
  else if (a === 'go') {
    var p = Logic.prefsFrom(W.units, W.weights);
    if (!p) { var er = $('#bstWerr'); if (er) er.hidden = false; return; }
    curPrefs = { sk: H.sk(), p: p }; editing = false;
    if (!readOnly() && prefsKey()) H.ls(prefsKey(), JSON.stringify(Object.assign({}, p, { savedAt: new Date().toISOString() })));
    H.beastMove();
    renderOptimizer(); return;
  }
  optShow(wizPane());
}

/* ---- paint / routing ---- */
function paint() {
  var v = $('#v-beasts'); if (!v || !S.vm || !S.res) return;
  injectCss();
  M = Logic.model(core, G, S.res.merged, benchSupp());
  if (mFor !== M && M) { opts = Logic.collOptions(G, M); }
  mFor = M;
  var segs = '<div class="segs"><div class="segs-in" role="tablist">' + [['field', 'Field'], ['collection', 'Collection'], ['optimizer', 'Optimizer']].map(function (s) { return '<button type="button" role="tab" data-seg="' + s[0] + '" aria-selected="false" data-go="beasts/' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></div>';
  v.innerHTML = segs + '<div class="vb" data-pane="field">' + fieldPane() + '</div><div class="vb" data-pane="collection">' + collPane() + '</div><div class="vb" data-pane="optimizer"></div>';
  show();
}
function show() {
  var v = $('#v-beasts'); if (!v) return;
  $$('.segs button', v).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.seg === cur.seg ? 'true' : 'false'); });
  $$('[data-pane]', v).forEach(function (p) { p.hidden = p.dataset.pane !== cur.seg; });
}
function wire() {
  if (wired) return; wired = true;
  var v = $('#v-beasts');
  v.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    var ds = t.dataset;
    if (ds.bsto) { var k = ds.bsto, was = t.getAttribute('aria-expanded') === 'true'; open[k] = !was; var pane = $('[data-pane="field"]', v); pane.innerHTML = fieldPane(); var nb = $('[data-bsto="' + k + '"]', v); if (nb) nb.focus({ preventScroll: true }); return; }
    if (ds.bst) { H.openSheet('beast', ds.bst); return; }
    if (ds.bse) { var i = F.elems.indexOf(ds.bse); if (i >= 0) F.elems.splice(i, 1); else F.elems.push(ds.bse); F.n = PAGE; collRefresh(); return; }
    if ('bstmore' in ds) { F.n += STEP; collRefresh(); return; }
    if ('bstclear' in ds) { var so = F.sort; F = Object.assign({}, DEF, { elems: [], sort: so }); collRefresh(); return; }
    if (ds.bsw) { wizClick(ds.bsw); return; }
    if (ds.bsa === 'edit') { editing = true; curPrefs = null; var sp0 = savedPrefs(); W = sp0 ? { units: sp0.units.slice(), weights: sp0.weights ? sp0.weights.slice() : sp0.units.map(function () { return 1; }) } : { units: [], weights: [] }; optShow(wizPane()); return; }
    if (ds.bsa === 'copy' && plan) { copyText(Logic.checklist(plan)); }
  });
  v.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset) return;
    if (t.dataset.bsf) { F[t.dataset.bsf] = t.value; F.n = PAGE; collRefresh(); return; }
    if (t.dataset.bsws !== undefined) { var wi = +t.dataset.bsws; W.weights[wi] = parseFloat(t.value); optShow(wizPane()); var again = $('[data-bsws="' + wi + '"]'); if (again) again.focus({ preventScroll: true }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('#sheetB') || !t.dataset || !t.dataset.bsf) return;
    F[t.dataset.bsf] = t.value; F.n = PAGE; collRefresh();
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('#sheetB [data-bsc], #sheetB [data-bse]') : null; if (!t) return;
    if (t.dataset.bse) { var i = F.elems.indexOf(t.dataset.bse); if (i >= 0) F.elems.splice(i, 1); else F.elems.push(t.dataset.bse); F.n = PAGE; var h0 = filterSheet(); if (h0) { $('#sheetB').innerHTML = h0[1]; var a0 = $('#sheetB [data-bse="' + t.dataset.bse + '"]'); if (a0) a0.focus({ preventScroll: true }); } collRefresh(); return; }
    var kv = t.dataset.bsc.split(':'), k = kv[0], val = kv.slice(1).join(':');
    F[k] = val; F.n = PAGE;
    var h = filterSheet(); if (h) { $('#sheetB').innerHTML = h[1]; var again = $('#sheetB [data-bsc="' + t.dataset.bsc + '"]'); if (again) again.focus({ preventScroll: true }); }
    collRefresh();
  });
}
function fail(e) {
  if (window.console) console.error(e);
  var v = $('#v-beasts'); if (v) v.innerHTML = '<div class="vb"><div class="empty">Could not show the Beasts section. Reload the page to try again.</div></div>';
}
function start(r) {
  try {
    cur = { seg: r && (r.seg === 'collection' || r.seg === 'optimizer') ? r.seg : 'field', q: (r && r.q) || {} };
    if (!S.vm || !S.res) return;
    var cfg = +cur.q.field || 0; if (cfg) open[String(cfg)] = true;
    paint(); wire();
    if (cur.seg === 'optimizer') renderOptimizer();
    if (cur.seg === 'field' && cfg) { var el = document.getElementById('bsf-' + cfg); if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 30); }
  } catch (e) { fail(e); }
}
function render(r) {
  /* the Field view needs the platform tables (slot numbers and the "takes" rules): wait for them once */
  if (platOk === null && H.d && H.d.ensurePlatforms) {
    H.d.ensurePlatforms().then(function () { platOk = true; start(r); }, function () { platOk = false; start(r); });
    return;
  }
  start(r);
}
/* Next moves signal e: with saved preferences, the best single swap joins the Overview's list (armory-app.js calls this after first paint) */
function nextMove() {
  var ps = savedPrefs(), vm = S.vm;
  if (!ps || readOnly() || !H.sk() || !S.res || !vm || !vm.beasts) return;
  var go = function () {
    loadOpt(function (o) {
      var mv = null, t0 = window.performance ? performance.now() : 0;
      try { mv = Logic.bestMove(G, core, o, S.res.merged, benchSupp(), ps, H.sk()); } catch (e) { if (window.console) console.error(e); }
      window.__bstMs = window.performance ? Math.round(performance.now() - t0) : 0; /* the optimizer's run time, read by the acceptance script */
      if (S.vm !== vm) return;
      var before = JSON.stringify(vm.moves.picks);
      vm.movesInput.beastMoves = mv ? [mv] : [];
      vm.moves.picks = window.ArmoryVM.movePicks(core.nextMoves(vm.movesInput, { max: 3 }));
      if (JSON.stringify(vm.moves.picks) !== before) H.renderOverview();
    }, function () {});
  };
  if (H.d && H.d.ensurePlatforms) H.d.ensurePlatforms().then(go, function () {}); else go();
}
return { render: render, sheet: function (kind, arg) { return kind === 'beast' ? beastSheet(arg) : kind === 'bstscore' ? scoreSheet() : filterSheet(); }, nextMove: nextMove, model: function () { return M; } };
};
})(typeof window !== 'undefined' ? window : globalThis);
