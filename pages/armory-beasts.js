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
var has = Object.prototype.hasOwnProperty;
var RARITY = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' };
var ELEMENTS = ['Fire', 'Wind', 'Water', 'Ground'];
var UNITS = { 1: 'Army', 2: 'Navy', 3: 'Air Force' };
/* the optimizer's six stats, written out the way the Heroes screen writes them */
var STAT = { atk: 'Attack', hp: 'HP', def: 'Defense', dmgInc: 'DMG increase', dmgDec: 'Decreased DMG taken', march: 'March Size' };
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

/* The game's short buff names, written out like the rest of the Armory ("All ATK (off)" is "All Attack (offense)"). Render only: filters work on the buff id. */
function label(n) {
  return clean(n).replace(/\bATK\b/g, 'Attack').replace(/\bDEF\b/g, 'Defense').replace(/\bRES\b/g, 'Resistance').replace(/\(off\)/, '(offense)').replace(/\(def\)/, '(defense)');
}
function buffLine(G, id, star, level, pot, isMain) {
  var v = G.ebComputeBuffValue(id, star, level, pot, isMain);
  return { id: num(id), name: label(G.ebBuffName(id)), txt: v == null ? '' : G.ebFormatBuffValue(v, id), val: v };
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
    fieldCfg: b.fieldCfg ? num(b.fieldCfg) : 0, fieldName: b.fieldName ? clean(b.fieldName) : '', slot: num(b.fieldSlotNum), platformLv: num(b.slotLevel),
    slotBuffs: (b.slotBuffs || []).map(function (sb) { return { name: label(sb.name), txt: sb.val ? '+' + (num(sb.val) / 100).toFixed(1) + '%' : '' }; })
  };
}

/* Deployed beasts from the report/enigma supplement plus the bench supplement's beasts (deduped by id), as the classic tab merges them. */
function resolveAll(core, G, merged, bench) {
  var res = core.ebResolveBeasts((merged && merged.enigmas) || {});
  var seen = {};
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
  var active = 0;
  var fields = res.fields.map(function (f) {
    if (f.active) active++;
    var conds = G.EB_FIELD_CONDITIONS[f.cfg] || [];
    return {
      cfg: num(f.cfg), name: clean(f.name), active: !!f.active, expected: num(f.expectedSlots), deployed: num(f.deployedCount),
      slots: f.slots.slice().sort(function (a, b) { return a.fieldSlotNum - b.fieldSlotNum; }).map(function (s) {
        var req = core.ebPlatformReq(f.cfg, s.fieldSlotNum), n = num(s.fieldSlotNum), bv = s.beast ? byId[String(s.beast.id)] : null;
        return {
          num: n, platformLv: s.level == null ? null : num(s.level), beast: bv || null,
          req: req ? (req.isUniversal ? { universal: true } : {
            universal: false, rarity: clean(req.rarity), element: clean(req.element || 'Any'), elementId: num(req.elementId),
            types: (req.beastTypeIds && req.beastTypeIds.length) ? clean(req.beastTypeLabel) : 'Any type',
            cap: req.qualityCap && num(req.qualityCap) < 5 ? num(req.qualityCap) : 0
          }) : null,
          buffs: (s.buffs || []).map(function (sb) { return { name: label(G.ebBuffName(sb.id)), txt: sb.val ? '+' + (num(sb.val) / 100).toFixed(2) + '%' : '' }; }),
          cond: n >= 1 && n <= conds.length ? clean(conds[n - 1]) : ''
        };
      })
    };
  });
  return {
    fields: fields, all: all, byId: byId, placed: placed.length, bench: benchN,
    summary: { beasts: placed.length, fiveStar: five, active: active + '/' + fields.length, avgPot: maxPot > 0 ? Math.round(pot / maxPot * 100) : 0, power: power, bench: benchN },
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
  return {
    where: [['', 'All fields and bench']].concat(m.fields.map(function (f) { return [String(f.cfg), f.name]; }), [['bench', 'Bench (' + fmtInt(m.bench) + ')']]),
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
  return { id: String(b.id), name: clean(G.ebBeastName(b.type, st)), element: clean(G.EB_ELEMENTS[b.fac] || 'Unknown'), q: num(b.q), rarity: RARITY[num(b.q)] || '', star: st, lv: num(b.lv), pot: num(b.pot),
    icon: iconFile(G, b.type, b.fac, st), where: b.placement ? { cfg: num(b.placement.fieldType), slot: num(b.placement.slot) } : null };
}
function fieldName(G, cfg) { return clean(G.EB_FIELD_NAMES[cfg] || ('Field ' + num(cfg))); }

/* the classic swap card's stat table: rows where either beast contributes, the biggest weighted stat first */
function statRows(G, opt, rec, prefs) {
  var slot = rec.slot, fromMax = opt.statProfile(rec.from, 'maxOut', prefs, slot), toMax = opt.statProfile(rec.to, 'maxOut', prefs, slot);
  var keys = Object.keys(STAT).filter(function (k) { return Math.abs(fromMax[k] || 0) > 0.005 || Math.abs(toMax[k] || 0) > 0.005; });
  keys.sort(function (a, b) {
    return Math.max(toMax[b] || 0, fromMax[b] || 0) * (G.BO_STAT_WEIGHTS[b] || 0) - Math.max(toMax[a] || 0, fromMax[a] || 0) * (G.BO_STAT_WEIGHTS[a] || 0);
  });
  var fromNow = opt.statProfile(rec.from, 'current', prefs, slot), toNow = opt.statProfile(rec.to, 'current', prefs, slot);
  return keys.map(function (k) {
    var f = fromMax[k] || 0, t = toMax[k] || 0, fN = fromNow[k] || 0, tN = toNow[k] || 0;
    return { key: k, label: STAT[k], from: fmtStat(k, f) + (Math.abs(fN - f) > 0.005 ? ' (' + fmtStat(k, fN) + ')' : ''), to: fmtStat(k, t) + (Math.abs(tN - t) > 0.005 ? ' (' + fmtStat(k, tN) + ')' : ''),
      net: fmtDelta(k, t - f), dir: t - f > 0.005 ? 1 : t - f < -0.005 ? -1 : 0 };
  });
}

/* One recommendation as a view record. */
function swapView(G, core, opt, rec, prefs) {
  var cfg = num(rec.slot.fieldType), th = rec.threshold, to = liteBeast(G, rec.to);
  return {
    cfg: cfg, fieldName: fieldName(G, cfg), order: num(rec.slot.order), from: liteBeast(G, rec.from), to: to,
    source: to && to.where ? fieldName(G, to.where.cfg) + ' slot ' + to.where.slot : 'bench',
    gainToday: Math.round(rec.gainToday), gainMax: Math.round(rec.gainAtMax),
    chain: rec.chainSize > 1 ? { id: num(rec.chainId), size: num(rec.chainSize), netMax: Math.round(rec.chainNetMax), backfill: !!rec.isBackfill } : null,
    stats: statRows(G, opt, rec, prefs),
    threshold: th ? {
      star: num(th.star), level: num(th.level), maxStar: G.boMaxStarFor(rec.to), maxLv: G.boMaxLevelFor(rec.to), rarity: RARITY[num(rec.to.q)] || '',
      fodderNeeded: th.fodderNeeded == null ? null : num(th.fodderNeeded), fodderHave: num(th.fodderHave), feasible: th.fodderFeasible !== false
    } : null,
    broke: (rec.brokeConditions || []).reduce(function (a, e) {
      var l = typeof e === 'string' ? { fieldId: 0, slotOrder: 0, slotLabel: e, reqText: '' } : e, label = l.fieldId ? fieldName(G, l.fieldId) + ' slot ' + num(l.slotOrder) : clean(l.slotLabel);
      if (!a.some(function (x) { return x.label === label; })) a.push({ label: label, req: clean(l.reqText) });
      return a;
    }, []),
    why: reasoning(G, core, rec, prefs)
  };
}

/* The whole plan: totals, swaps grouped by field, notes. `opt` is the ArmoryBeastsOpt instance of this player. */
function planModel(G, core, opt, merged, bench, prefs, siteKey) {
  var p = opt.plan(merged, bench, prefs, siteKey), r = p.result;
  var swaps = r.recommendations.map(function (rec) { return swapView(G, core, opt, rec, prefs); });
  var groups = [1, 2, 3, 4, 5].map(function (cfg) {
    return { cfg: cfg, name: fieldName(G, cfg), swaps: swaps.filter(function (s) { return s.cfg === cfg; }).sort(function (a, b) { return a.order - b.order; }) };
  }).filter(function (g) { return g.swaps.length; });
  var notes = [];
  if (bench && bench.ts) { var days = (Date.now() - new Date(bench.ts).getTime()) / 86400000; if (days > 7) notes.push('Your bench snapshot is ' + Math.round(days) + ' days old. Run the Snapshot again for fresh placements.'); }
  if (bench && typeof bench.skippedDeployed === 'number') {
    var dep = p.owned.filter(function (b) { return b.placement; }).length;
    if (bench.skippedDeployed > dep) notes.push('Your reports and game data cover only ' + dep + ' of ' + bench.skippedDeployed + ' deployed beasts, so the plan may be incomplete.');
  }
  return {
    swaps: swaps, groups: groups, totalToday: Math.round(r.totalGainToday), totalMax: Math.round(r.totalGainAtMax), warnings: r.conditionWarnings.length,
    label: playstyleLabel(core, prefs), notes: notes, owned: p.owned.length, raw: r
  };
}

/* Next moves signal e: the best single swap a bench beast makes today (a swap that is not part of a chain and needs no upgrade first),
   as the move the Overview lists. null when there is none. */
function bestMove(G, core, opt, merged, bench, prefs, siteKey) {
  var p = opt.plan(merged, bench, prefs, siteKey), best = null;
  p.result.recommendations.forEach(function (rec) {
    if (rec.chainSize > 1 || rec.threshold || !rec.to || !(rec.gainToday > 0.5)) return;
    if (!best || rec.gainToday > best.gainToday) best = rec;
  });
  if (!best) return null;
  var slot = best.slot, to = liteBeast(G, best.to), a = opt.statProfile(best.from, 'current', prefs, slot), b = opt.statProfile(best.to, 'current', prefs, slot);
  var key = null, top = 0;
  Object.keys(STAT).forEach(function (k) { var d = ((b[k] || 0) - (a[k] || 0)) * (G.BO_STAT_WEIGHTS[k] || 0); if (d > top) { top = d; key = k; } });
  var delta = key ? (b[key] || 0) - (a[key] || 0) : 0;
  var txt = key ? (key === 'march' ? '+' + trim(delta, 2) : '+' + trim(delta, 2) + '%') : '';
  var parts = [{ s: 'Swap ' }, { s: to.name, n: 1 }, { s: ' into ' }, { s: fieldName(G, slot.fieldType), n: 1 }, { s: ' slot ' }, { s: String(num(slot.order)), n: 1 }];
  if (txt) parts.push({ s: ': ' }, { s: txt, n: 1 }, { s: ' ' + STAT[key] });
  var q = to.q >= 5 ? 'q5' : to.q === 4 ? 'q4' : '';
  return { gain: best.gainToday, parts: parts, meta: 'From bench · ' + fmtInt(best.gainToday) + ' power score points today', ico: { u: 'beast-icons/' + to.icon, q: q, fb: to.name.charAt(0) } };
}

/* the checklist the Copy button puts on the clipboard */
function checklist(G, groups) {
  var out = [], i = 0;
  groups.forEach(function (g) {
    g.swaps.forEach(function (s) {
      var d = function (b) { return b ? b.name + ' (' + b.rarity + ', ' + b.star + ' stars, Lv ' + b.lv + ')' : 'empty'; };
      i++;
      out.push(i + '. ' + g.name + ' slot ' + s.order + ': ' + d(s.from) + ' -> ' + d(s.to) + (s.threshold ? ' [raise to ' + s.threshold.star + ' stars, Lv ' + s.threshold.level + ' first]' : '') +
        (s.chain ? (s.chain.backfill ? ' [backfill, move ' + s.chain.id + ']' : ' [move ' + s.chain.id + ', net ' + (s.chain.netMax >= 0 ? '+' : '') + s.chain.netMax + ' at max-out]') : ''));
    });
  });
  return out.join('\n');
}

var Logic = {
  label: label, num: num, fmtInt: fmtInt, ageOld: ageOld, iconFile: iconFile, beastView: beastView, resolveAll: resolveAll, model: model, collFilter: collFilter, collOptions: collOptions,
  validPrefs: validPrefs, readPrefs: readPrefs, playstyleLabel: playstyleLabel, fmtStat: fmtStat, fmtDelta: fmtDelta, reasoning: reasoning, liteBeast: liteBeast,
  statRows: statRows, swapView: swapView, planModel: planModel, bestMove: bestMove, checklist: checklist, SORTS: SORTS, STAT: STAT, RARITY: RARITY, PREFS_KEY: PREFS_KEY
};
root.ArmoryBeastsLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryBeasts = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, classicUrl = H.classicUrl, readOnly = H.readOnly;
var DEF = { elems: [], where: '', primary: '', secondary: '', sort: 'star', n: 24 }, F = Object.assign({}, DEF), PAGE = 24, STEP = 48;
var cur = { seg: 'field', q: {} }, M = null, mFor = null, opts = null, open = {}, wired = false, platOk = null;
var opt = null, optQ = null, plan = null, W = { step: 1, mode: '', units: [], weights: [] }, editing = false;

var CSS =
  '.bst-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.bst-sum > div{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:8px 12px;min-width:0}' +
  '.bst-sum .n{font:700 var(--fs-20)/1.25 var(--display)}.bst-sum .l{font-size:var(--fs-12);color:var(--muted)}' +
  '.bst-fs{display:flex;flex-direction:column;gap:12px}' +
  '.bst-hd{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--row);text-align:left;color:inherit}.bst-hd:active{background:var(--card-hi)}' +
  '.bst-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.bst-n{font-size:var(--fs-17);font-weight:700}.bst-m{font-size:var(--fs-13);color:var(--muted);display:flex;flex-wrap:wrap;gap:0 8px}.bst-nw{white-space:nowrap}' +
  '.bst-chev{transition:transform var(--t);flex:none}.bst-hd[aria-expanded="true"] .bst-chev{transform:rotate(180deg)}' +
  '.bst-card.is-open > .bst-hd{position:sticky;top:calc(var(--hdr) + 44px);z-index:1;background:var(--card)}' +
  '.bst-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}.bst-strip .ico,.bst-strip .fb{width:32px;height:32px}' +
  '.bst-ok{color:var(--ok)}.bst-bad{color:var(--bad)}' +
  '.bst-slots{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:12px}' +
  '.bst-slot{display:flex;flex-direction:column;gap:6px;background:var(--card-hi);border:1px solid var(--rule);border-radius:var(--r-card);padding:12px;min-width:0}' +
  '.bst-st{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-13);color:var(--muted)}.bst-st b{color:var(--text);font-weight:700}' +
  '.bst-reqs{display:flex;flex-wrap:wrap;gap:4px}' +
  '.bst-beast{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--tap);text-align:left;color:inherit;border-radius:var(--r-chip)}.bst-beast:active{background:var(--card)}' +
  '.bst-ib{position:relative;flex:none;width:48px;height:48px}.bst-ib .ico,.bst-ib .fb{width:48px;height:48px}.bst-ib .bst-el{position:absolute;top:-3px;right:-3px;width:18px;height:18px;border:0;background:none}' +
  '.bst-bt{flex:1;min-width:0}.bst-bn{font-weight:700;font-size:var(--fs-15)}.bst-bm{font-size:var(--fs-13);color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;gap:0 8px}' +
  '.bst-gap{width:48px;height:48px;border:1.5px dashed var(--border);border-radius:var(--r-chip);flex:none}' +
  '.bst-ln{display:flex;justify-content:space-between;gap:12px;font-size:var(--fs-13);color:var(--muted)}.bst-ln > span:last-child{white-space:nowrap;color:var(--text);font-weight:600}.bst-ln.bst-main{font-size:var(--fs-14);color:var(--text)}' +
  '.bst-pot{display:flex;align-items:center;gap:8px;font-size:var(--fs-13);color:var(--muted)}.bst-pot .meter{flex:1}.bst-pot .v{min-width:44px;text-align:right;color:var(--text);font-weight:600}' +
  '.bst-cond{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:6px}' +
  '.bst-fb{display:flex;flex-direction:column;gap:12px}.bst-fbtn{}.bst-fs2{display:none}' +
  '.bst-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.bst-f .sel{min-width:0;width:100%}' +
  '.bst-cb{min-height:40px;padding:0 14px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--surface);font-size:var(--fs-14);font-weight:600;color:var(--muted)}.bst-cb[aria-pressed="true"]{color:var(--text);background:var(--card-hi);border-color:var(--muted)}' +
  '.bst-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}' +
  '.bst-c{display:flex;flex-direction:column;gap:6px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:12px;min-width:0}' +
  '.bst-c.q4{border-color:var(--q4)}.bst-c.q5{border-color:var(--q5)}' +
  '.bst-cf{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:6px;display:flex;justify-content:space-between;gap:8px}' +
  '.bst-tally{font-size:var(--fs-13);color:var(--muted)}.bst-sh{display:flex;flex-direction:column;gap:12px}.bst-sh h4{font:700 var(--fs-13)/1.3 var(--sans);color:var(--muted);margin:0 0 4px}' +
  '.bst-wiz{display:flex;flex-direction:column;gap:12px}.bst-opt{display:flex;flex-direction:column;gap:4px;width:100%;min-height:var(--row);padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--card);text-align:left;color:inherit}' +
  '.bst-opt b{font-size:var(--fs-15)}.bst-opt span{font-size:var(--fs-13);color:var(--muted)}.bst-wr{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--tap)}' +
  '.bst-tot{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}.bst-tot .n{font:700 var(--fs-24)/1.2 var(--display)}.bst-tot .pos{color:var(--ok)}.bst-tot .neg{color:var(--warn)}' +
  '.bst-acts{display:flex;flex-wrap:wrap;gap:8px}.bst-note{border-left:3px solid var(--warn);padding:8px 12px;background:var(--card);border-radius:0 var(--r-chip) var(--r-chip) 0;font-size:var(--fs-14)}' +
  '.bst-grp{display:flex;flex-direction:column;gap:8px}.bst-opts{display:flex;flex-direction:column;gap:8px}.bst-gh{display:flex;align-items:baseline;gap:8px;padding-bottom:4px;border-bottom:1px solid var(--rule)}.bst-gh b{font-size:var(--fs-15)}' +
  '.bst-sw{display:flex;flex-direction:column;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:12px}' +
  '.bst-swh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:var(--fs-13);color:var(--muted)}.bst-swh b{color:var(--text);font-size:var(--fs-15)}' +
  '.bst-ft{display:flex;flex-direction:column;gap:8px}.bst-arrow{display:flex;justify-content:center;color:var(--muted)}.bst-gain{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:var(--fs-14)}.bst-gain b.pos{color:var(--ok)}.bst-gain b.neg{color:var(--warn)}' +
  '.bst-tb{width:100%;border-collapse:collapse;font-size:var(--fs-13)}.bst-tb th{text-align:right;color:var(--muted);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--rule)}.bst-tb th:first-child,.bst-tb td:first-child{text-align:left}' +
  '.bst-tb td{padding:4px 6px;text-align:right}.bst-tb td.pos{color:var(--ok);font-weight:700}.bst-tb td.neg{color:var(--bad);font-weight:700}' +
  '.bst-call{font-size:var(--fs-13);padding:8px 12px;border-left:3px solid var(--accent);background:var(--surface);border-radius:0 var(--r-chip) var(--r-chip) 0}.bst-call.warn{border-left-color:var(--warn)}.bst-call.bad{border-left-color:var(--bad)}' +
  '.bst-why{font-size:var(--fs-13);color:var(--muted)}' +
  '.bst-q4{border-color:var(--q4)}.bst-q5{border-color:var(--q5)}' +
  '.bst-ban{height:40px;border-radius:var(--r-card);background:var(--card);border:1px solid var(--border)}' +
  '@media (min-width:600px){.bst-sum{grid-template-columns:repeat(6,minmax(0,1fr))}.bst-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bst-slots{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
  '@media (min-width:768px){.bst-fbtn{display:none}.bst-fs2{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}.bst-card.is-open > .bst-hd{position:static}.bst-grid{grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '.bst-ft{flex-direction:row;align-items:stretch}.bst-ft > .bst-sb{flex:1;min-width:0}.bst-arrow{align-items:center}}' +
  '@media (min-width:1024px){.bst-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.bst-slots{grid-template-columns:repeat(3,minmax(0,1fr))}.bst-tabs{}' +
  '#v-beasts [data-pane="optimizer"] .bst-opts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}}';

function injectCss() {
  if (document.getElementById('bst-style')) return;
  var s = document.createElement('style'); s.id = 'bst-style'; s.textContent = CSS; document.head.appendChild(s);
}
var DOT = '<span aria-hidden="true">\u00B7</span>';
function sp(t, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + nd(t) + '</span>'; }
function joinDots(a) { return a.filter(Boolean).map(function (t) { return sp(t); }).join('<span aria-hidden="true">·</span>'); }
function qb(q) { return q >= 5 ? ' q5' : q === 4 ? ' q4' : ''; }
function priv() { return (S.res && S.res.privacy) || {}; }
function benchSupp() { var s = S.res && S.res.supp || {}; return priv().bench ? null : (s.bench || null); }
function enigSupp() { var s = S.res && S.res.supp || {}; return priv().enigma ? null : (s.enigma || null); }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }
function classicLink() { return '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl('enigma')) + '">' + ic('ext', 'sm') + '<span>Open in classic</span></a></div>'; }
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
  b.base.forEach(function (x) { r += line(x.name, x.txt); });
  return r;
}
function wherePart(b) { return b.fieldCfg ? esc(b.fieldName) + ', slot ' + nd(String(b.slot)) : 'Bench'; }

/* ---- Field ---- */
function slotCard(f, s) {
  var req = '';
  if (s.req) {
    req = '<div class="bst-reqs"><span class="t12 muted">Takes</span>' + (s.req.universal ? '<span class="pill"><span>Any beast</span></span>' :
      '<span class="pill"><span>' + nd(s.req.rarity + ' or better') + '</span></span><span class="pill"><span>' + esc(s.req.elementId ? s.req.element : 'Any element') + '</span></span><span class="pill"><span>' + nd(s.req.types + (s.req.cap ? ' (rarity cap ' + (RARITY[s.req.cap] || '') + ')' : '')) + '</span></span>') + '</div>';
  }
  var head = '<div class="bst-st"><b>' + nd('Slot ' + s.num) + '</b>' + (s.platformLv != null ? '<span class="pill"><span>' + nd('Platform Lv.' + s.platformLv) + '</span></span>' : '') + '</div>';
  var cond = s.cond ? '<div class="bst-cond">' + nd('Unlocks with: ' + s.cond) + '</div>' : '';
  if (!s.beast) return '<div class="bst-slot" id="bsl-' + f.cfg + '-' + s.num + '">' + head + req + '<div class="bst-beast"><span class="bst-gap" aria-hidden="true"></span><div class="bst-bt"><div class="bst-bn muted">Empty</div></div></div>' + cond + '</div>';
  var b = s.beast;
  return '<div class="bst-slot" id="bsl-' + f.cfg + '-' + s.num + '">' + head + req +
    '<button class="bst-beast" type="button" data-bst="' + esc(b.id) + '" aria-label="' + esc(b.name) + ' details">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no">' + esc(b.name) + '</span><span class="bst-bm">' + stars5(b.star) +
    sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span></span></span></button>' +
    s.buffs.map(function (x) { return line(x.name, x.txt); }).join('') + potBar(b) + cond + '</div>';
}
function fieldCard(f, isOpen) {
  var meta = [f.deployed + ' of ' + f.expected + ' slots'];
  var strip = !isOpen ? '<div class="bst-strip">' + f.slots.filter(function (s) { return s.beast; }).map(function (s) { return art(BASE + 'beast-icons/' + s.beast.icon, 'ico' + qb(s.beast.q), s.beast.name.charAt(0), s.beast.name); }).join('') + '</div>' : '';
  var body = isOpen ? '<div class="bst-slots">' + f.slots.map(function (s) { return slotCard(f, s); }).join('') + '</div>' : '';
  return '<section class="card bst-card' + (isOpen ? ' is-open' : '') + '" id="bsf-' + f.cfg + '"><button class="bst-hd" type="button" data-bsto="' + f.cfg + '" aria-expanded="' + isOpen + '"><span class="bst-t"><span class="bst-n" translate="no">' + esc(f.name) + '</span>' +
    '<span class="bst-m"><span class="' + (f.active ? 'bst-ok' : 'bst-bad') + '">' + (f.active ? 'Active' : 'Inactive') + '</span>' + meta.map(function (t) { return '<span aria-hidden="true">\u00B7</span><span class="bst-nw">' + nd(t) + '</span>'; }).join('') + '</span></span>' + ic('down', 'bst-chev') + '</button>' + strip + body + '</section>';
}
function summary() {
  var z = M.summary;
  function cell(n, l) { return '<div><div class="n" translate="no">' + esc(n) + '</div><div class="l">' + esc(l) + '</div></div>'; }
  return '<div class="bst-sum">' + cell(fmtInt(z.beasts), 'Deployed') + cell(fmtInt(z.fiveStar), 'Five-star') + cell(z.active, 'Active fields') + cell(z.avgPot + '%', 'Avg potential') + cell(fmtInt(z.power), 'Total power') + cell(fmtInt(z.bench), 'On bench') + '</div>';
}
function srcLine() {
  var e = enigSupp(), t = e && e.ts ? Logic.ageOld(e.ts) : '';
  return '<p class="foot">' + nd('Source: ' + (e ? 'game data' + (t ? ', imported ' + t : '') : 'battle reports')) + '</p>';
}
function fieldPane() {
  if (!M) return needData('No beast data yet.');
  if (platOk === false) return '<div class="empty">Could not load the beast platform data. Check your connection and reload the page.</div>';
  var top = '<p class="t13 muted">' + nd(M.summary.beasts + ' beasts deployed in ' + M.fields.filter(function (f) { return f.deployed > 0; }).length + ' fields') + '</p>';
  var most = 0; M.fields.forEach(function (f, i) { if (f.deployed > M.fields[most].deployed) most = i; });
  var wantCfg = +cur.q.field || 0, html = '';
  M.fields.forEach(function (f, i) {
    var k = String(f.cfg), isOpen = open[k] != null ? open[k] : (wantCfg === f.cfg || (!wantCfg && i === most));
    html += fieldCard(f, isOpen);
  });
  return '<div class="sechead"><h2 class="title">Beast fields</h2></div>' + summary() + top + '<div class="bst-fs">' + html + '</div>' + srcLine() + classicLink();
}

/* ---- Collection ---- */
function dirty() { return F.elems.length + (F.where ? 1 : 0) + (F.primary ? 1 : 0) + (F.secondary ? 1 : 0); }
function collCard(b) {
  return '<div class="bst-c' + qb(b.q) + '"><button class="bst-beast" type="button" data-bst="' + esc(b.id) + '" aria-label="' + esc(b.name) + ' details">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no">' + esc(b.name) + '</span><span class="bst-bm">' + stars5(b.star) +
    sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span></span></span></button>' + buffRows(b) + potBar(b) + '<div class="bst-cf"><span>' + wherePart(b) + '</span><span>' + nd('Power ' + fmtInt(b.power)) + '</span></div></div>';
}
function collList() {
  var f = Logic.collFilter(M.all, F), shown = f.slice(0, F.n), total = fmtInt(M.all.length);
  var tally = !f.length ? '' : '<p class="bst-tally" role="status">' + nd('Showing ' + fmtInt(shown.length) + ' of ' + fmtInt(f.length) + (f.length === M.all.length ? '' : ' · ' + total + ' owned')) + '</p>';
  return (shown.length ? '<div class="bst-grid">' + shown.map(collCard).join('') + '</div>' : '<div class="empty">' + (F.where === 'bench' && !F.elems.length && !F.primary && !F.secondary ? 'No beasts on the bench.' : 'No beasts match these filters.') + ' <button class="tb link" type="button" data-bstclear>Clear filters</button></div>') + tally +
    (f.length > shown.length ? '<button class="btn more" type="button" data-bstmore><span>Show ' + nd(fmtInt(Math.min(STEP, f.length - shown.length))) + ' more</span></button>' : '');
}
function selectHtml(k, lab) {
  return '<label class="bst-f"><span>' + esc(lab) + '</span><select class="sel" data-bsf="' + k + '">' + opts[k].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (/\d/.test(o[1]) ? ' translate="no"' : '') + (String(F[k]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
}
function elemChips() {
  return ELEMENTS.map(function (e) { return '<button class="bst-cb" type="button" data-bse="' + e + '" aria-pressed="' + (F.elems.indexOf(e) >= 0) + '">' + esc(e) + '</button>'; }).join('');
}
function btnText() { var n = dirty(); return 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }
function collPane() {
  if (!M) return needData('No beast data yet.');
  var age = Logic.ageOld(M.benchTs);
  return '<div class="sechead"><h2 class="title">Beast collection</h2></div><div class="fbar"><div class="grow t13 muted">' + nd(fmtInt(M.all.length) + ' beasts' + (M.bench ? ' · ' + fmtInt(M.bench) + ' on the bench' : '') + (age ? ' · bench snapshot ' + age : '')) + '</div>' +
    '<button class="btn bst-fbtn" type="button" data-open="bstfilter">' + ic('sliders', 'sm') + btnText() + '</button></div>' +
    '<div class="bst-fs2"><div class="bst-f" style="grid-column:1/-1"><span>Element</span><div class="chips">' + elemChips() + '</div></div>' + selectHtml('where', 'Where') + selectHtml('primary', 'Main buff') + selectHtml('secondary', 'Base buff') + selectHtml('sort', 'Sort') + '</div>' +
    '<div id="bstList" style="display:flex;flex-direction:column;gap:12px">' + collList() + '</div>' + classicLink();
}
function chipGroup(k, lab, list) {
  return '<div><h4>' + esc(lab) + '</h4><div class="chips">' + list.map(function (o) { return '<button class="bst-cb" type="button" data-bsc="' + k + ':' + esc(o[0]) + '" aria-pressed="' + (String(F[k]) === String(o[0])) + '">' + nd(o[1]) + '</button>'; }).join('') + '</div></div>';
}
function filterSheet() {
  if (!M) return null;
  var body = '<div class="ctrls bst-sh">' + chipGroup('sort', 'Sort by', opts.sort) + '<div><h4>Element</h4><div class="chips">' + elemChips() + '</div></div>' +
    selectHtml('where', 'Where') + selectHtml('primary', 'Main buff') + selectHtml('secondary', 'Base buff') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>';
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
  var dep = b.fieldCfg ? joinDots([b.fieldName, 'Slot ' + b.slot, b.platformLv ? 'Platform Lv.' + b.platformLv : '']) : 'Not deployed (bench)';
  var base = b.base.length ? '<h4 class="lab">Base buffs</h4>' + b.base.map(function (x) { return line(x.name, x.txt); }).join('') : '';
  var slotB = b.slotBuffs.length ? '<h4 class="lab">Slot buffs</h4>' + b.slotBuffs.map(function (x) { return line(x.name, x.txt); }).join('') : '';
  var body = '<div class="bst-sh"><div class="bst-beast" style="cursor:default">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bm">' + stars5(b.star) + sp('Lv.' + b.lv) + DOT + '<span translate="no">' + esc(b.element) + '</span>' + (RARITY[b.q] ? '<span class="pill"><span>' + esc(RARITY[b.q]) + '</span></span>' : '') + '</span>' +
    '<span class="bst-bm" style="margin-top:4px">' + dep + '</span></span></div>' +
    '<h4 class="lab">Main buff</h4><div class="bst-ln bst-main"><span>' + esc(b.main.name) + '</span><span translate="no">' + esc(b.main.txt) + '</span></div>' + base + slotB +
    '<div class="bst-pot"><span>Potential</span><div class="meter r-' + H.ramp(b.potPct) + '"><i style="width:' + Math.max(2, Math.min(100, b.potPct)) + '%"></i></div><span class="v" translate="no">' + esc(fmtInt(b.pot) + ' / ' + fmtInt(b.maxPot)) + '</span></div>' +
    '<div class="bst-ln"><span>Power</span><span translate="no">' + esc(fmtInt(b.power)) + '</span></div></div>' +
    '<button class="btn" type="button" data-close style="width:100%;margin-top:12px">Close</button>';
  return [b.name, body, true];
}

/* ---- Optimizer ---- */
function prefsKey() { var k = H.sk(); return k ? PREFS_KEY + k : null; }
function savedPrefs() { var k = prefsKey(); return k ? Logic.readPrefs(H.ls(k)) : null; }
var curPrefs = null;
function activePrefs() { if (curPrefs) return curPrefs; var p = editing ? null : savedPrefs(); return p; }
function wizPane() {
  var UN = [[1, 'Army'], [2, 'Navy'], [3, 'Air Force']], cap = W.mode === 'mono' ? 1 : W.mode === 'dual' ? 2 : 3;
  if (W.step === 1) {
    return '<div class="sechead"><h2 class="title">Beast optimizer</h2></div><p class="muted">How many unit types do you fight with?</p><div class="bst-wiz">' +
      [['mono', 'One unit', 'I specialise in one branch and always march it.'], ['dual', 'Two units', 'I main two branches.'], ['triple', 'Three units', 'I use all three branches about evenly.']].map(function (o) {
        return '<button class="bst-opt" type="button" data-bsw="mode:' + o[0] + '"><b>' + esc(o[1]) + '</b><span>' + esc(o[2]) + '</span></button>';
      }).join('') + '</div>' + classicLink();
  }
  var chips = UN.map(function (u) { return '<button class="bst-cb" type="button" data-bsw="unit:' + u[0] + '" aria-pressed="' + (W.units.indexOf(u[0]) >= 0) + '">' + esc(u[1]) + '</button>'; }).join('');
  var wRows = '';
  if (W.mode !== 'mono' && W.units.length === cap) {
    wRows = '<div class="card"><p class="t13 muted" style="margin-bottom:8px">How much each unit counts (higher means the optimizer favours buffs for it).</p>' + W.units.map(function (u, i) {
      return '<div class="bst-wr"><span>' + esc(UNITS[u]) + '</span><select class="sel" data-bsws="' + i + '" aria-label="' + esc(UNITS[u]) + ' weight">' + [1, 0.75, 0.5, 0.25].map(function (w) { return '<option value="' + w + '"' + (Math.abs(w - W.weights[i]) < 1e-6 ? ' selected' : '') + '>' + w.toFixed(2) + 'x</option>'; }).join('') + '</select></div>';
    }).join('') + '<div class="chips" style="margin-top:8px">' + (W.mode === 'dual' ? [['Even', [1, 1]], ['1.0 and 0.75', [1, 0.75]], ['1.0 and 0.5', [1, 0.5]], ['1.0 and 0.25', [1, 0.25]]] :
      [['Even', [1, 1, 1]], ['1.0, 0.75, 0.75', [1, 0.75, 0.75]], ['1.0, 0.5, 0.5', [1, 0.5, 0.5]], ['1.0, 0.75, 0.5', [1, 0.75, 0.5]], ['1.0, 0.5, 0.25', [1, 0.5, 0.25]]]).map(function (p) {
      return '<button class="bst-cb" type="button" data-bsw="preset:' + p[1].join(',') + '">' + nd(p[0]) + '</button>'; }).join('') + '</div></div>';
  }
  return '<div class="sechead"><h2 class="title">' + (W.mode === 'mono' ? 'Which unit?' : W.mode === 'dual' ? 'Which two units?' : 'Weigh your units') + '</h2></div><div class="bst-wiz"><div class="chips">' + chips + '</div>' + wRows +
    '<p class="t13" role="alert" id="bstWerr" hidden>' + nd('Pick ' + cap + ' unit' + (cap > 1 ? 's' : '') + ' first.') + '</p>' +
    '<div class="bst-acts"><button class="btn" type="button" data-bsw="back">Back</button><button class="btn" type="button" data-bsw="go">Optimize</button></div></div>' + classicLink();
}
function beastChip(b, label) {
  if (!b) return '<div class="bst-sb card" style="padding:12px"><div class="t12 muted">' + esc(label) + '</div><div class="bst-beast" style="cursor:default"><span class="bst-gap" aria-hidden="true"></span><span class="bst-bt"><span class="bst-bn muted">Empty slot</span></span></div></div>';
  return '<button class="bst-sb card" type="button" data-bst="' + esc(b.id) + '" style="padding:12px;text-align:left;color:inherit;display:block" aria-label="' + esc(label + ': ' + b.name) + '"><span class="t12 muted" style="display:block;margin-bottom:4px">' + esc(label) + '</span><span class="bst-beast" style="min-height:0">' + icoBeast(b) + '<span class="bst-bt"><span class="bst-bn" translate="no" style="display:block">' + esc(b.name) + '</span><span class="bst-bm">' +
    stars5(b.star) + sp('Lv.' + b.lv) + '</span><span class="bst-bm">' + sp('Potential ' + fmtInt(b.pot)) + DOT + '<span translate="no">' + esc(b.element) + '</span>' + (b.rarity ? '<span class="pill"><span>' + esc(b.rarity) + '</span></span>' : '') + '</span></span></span></button>';
}
function gainTxt(n) { return (n >= 0 ? '+' : '') + fmtInt(n); }
function swapCard(s) {
  var chain = s.chain ? '<div class="bst-call"><b>' + (s.chain.backfill ? 'Backfill step' : 'Linked move') + ' ' + nd(String(s.chain.id)) + '</b> ' + nd('One of ' + s.chain.size + ' linked moves that together gain ' + gainTxt(s.chain.netMax) + ' at max-out. ' + (s.chain.backfill ?
    'On its own this step is flat or negative, but it keeps this slot filled after a beast moves out. Do the whole chain.' : 'Do every step of move ' + s.chain.id + ' together so no slot is left empty.')) + '</div>' : '';
  var table = s.stats.length ? '<table class="bst-tb"><caption class="sr">Stat by stat at max-out, today in brackets</caption><thead><tr><th scope="col">Stat</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Net</th></tr></thead><tbody>' +
    s.stats.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td translate="no">' + esc(r.from) + '</td><td translate="no">' + esc(r.to) + '</td><td class="' + (r.dir > 0 ? 'pos' : r.dir < 0 ? 'neg' : '') + '" translate="no">' + esc(r.net) + '</td></tr>'; }).join('') + '</tbody></table>' : '';
  var th = '';
  if (s.threshold) {
    var t = s.threshold;
    th = '<div class="bst-call warn">' + nd('Needs ' + t.star + ' stars and Lv.' + t.level + ' (' + t.rarity + ' tops out at ' + t.maxStar + ' stars, Lv.' + t.maxLv + ') before this beats your current placement.' +
      (t.fodderNeeded != null ? ' A star-up costs ' + t.fodderNeeded + ' one-star beast' + (t.fodderNeeded === 1 ? '' : 's') + ' of the same type and rarity as fodder; you have ' + t.fodderHave + ' free on the bench.' + (t.feasible ? '' : ' Not enough fodder yet.') : '')) + '</div>';
  }
  var broke = s.broke.length ? '<div class="bst-call bad"><b>' + nd('Switches off the rarity bonus on ' + s.broke.map(function (x) { return x.label; }).join(', ') + '.') + '</b>' + s.broke.filter(function (x) { return x.req; }).map(function (x) { return '<div class="t12">' + nd(x.label + ': ' + x.req) + '</div>'; }).join('') +
    '<div class="t12">The beast in that slot stays put; only the slot bonus drops until you meet its unlock condition again.</div></div>' : '';
  return '<article class="bst-sw"><div class="bst-swh"><b>' + nd(s.fieldName + ', slot ' + s.order) + '</b><span>' + nd('From ' + s.source) + '</span></div>' +
    '<div class="bst-ft">' + beastChip(s.from, 'Now') + '<div class="bst-arrow" aria-hidden="true">' + ic('chev') + '</div>' + beastChip(s.to, 'Swap in') + '</div>' +
    '<div class="bst-gain"><span>' + nd('Power score today: ') + '<b class="' + (s.gainToday >= 0 ? 'pos' : 'neg') + '" translate="no">' + esc(gainTxt(s.gainToday)) + '</b></span><span>' + nd('At max-out: ') + '<b class="' + (s.gainMax >= 0 ? 'pos' : 'neg') + '" translate="no">' + esc(gainTxt(s.gainMax)) + '</b></span></div>' +
    chain + table + th + broke + (s.why ? '<p class="bst-why">' + esc(s.why) + '</p>' : '') + '</article>';
}
function planPane() {
  var P = plan;
  var tot = '<div class="card"><div class="bst-tot"><span class="t13 muted">Total power score gain</span><span class="n" translate="no"><span class="' + (P.totalToday >= 0 ? 'pos' : 'neg') + '">' + esc(gainTxt(P.totalToday)) + '</span> today, <span class="' + (P.totalMax >= 0 ? 'pos' : 'neg') + '">' + esc(gainTxt(P.totalMax)) + '</span> at max-out</span></div>' +
    '<p class="t13 muted" style="margin-top:4px">' + nd(P.swaps.length + (P.swaps.length === 1 ? ' swap' : ' swaps') + (P.warnings ? ', ' + P.warnings + ' unlock condition' + (P.warnings === 1 ? '' : 's') + ' would switch off' : '') + ' · ' + P.label) + '</p>' +
    '<p class="t13 muted" style="margin-top:8px">' + nd('One point is one percent of Attack for your playstyle. Worth in points: +1 March Size ' + G.BO_STAT_WEIGHTS.march + ', 1% Defense ' + G.BO_STAT_WEIGHTS.def + ', 1% DMG ' + G.BO_STAT_WEIGHTS.dmgInc + ', 1% HP ' + G.BO_STAT_WEIGHTS.hp + ', 1% Attack ' + G.BO_STAT_WEIGHTS.atk + '. Today compares current stars and levels; at max-out both beasts are compared fully levelled. March Size never drops at a slot.') + '</p>' +
    '<div class="bst-acts" style="margin-top:12px">' + (P.swaps.length ? '<button class="btn" type="button" data-bsa="copy">Copy as checklist</button>' : '') + '<button class="btn" type="button" data-bsa="edit">Edit preferences</button></div></div>';
  var notes = P.notes.map(function (n) { return '<div class="bst-note">' + nd(n) + '</div>'; }).join('');
  var body = !P.swaps.length ? '<div class="card"><p>' + nd('Your current placements are already the best for ' + P.label + '. Pick another playstyle to compare.') + '</p></div>' :
    P.groups.map(function (g) {
      return '<section class="bst-grp" aria-label="' + esc(g.name) + '"><div class="bst-gh"><b translate="no">' + esc(g.name) + '</b><span class="t13 muted">' + nd(g.swaps.length + (g.swaps.length === 1 ? ' change' : ' changes')) + '</span></div><div class="bst-opts">' + g.swaps.map(swapCard).join('') + '</div></section>';
    }).join('');
  return '<div class="sechead"><h2 class="title">Beast optimizer</h2></div>' + tot + '<p class="t13 muted">The optimizer is a guide. Check each swap before you spend stars on it.</p>' + notes + body + classicLink();
}
function optHost() { return $('#v-beasts [data-pane="optimizer"]'); }
function optShow(html) { var h = optHost(); if (h) h.innerHTML = html; }
function loadOpt(cb, bad) {
  if (opt) return cb(opt);
  if (optQ) { optQ.push(cb); return; }
  optQ = [cb];
  var sc = document.createElement('script'); sc.src = 'armory-beasts-opt.js';
  sc.onload = function () { opt = window.ArmoryBeastsOpt.create(core); var q = optQ; optQ = null; q.forEach(function (f) { f(opt); }); };
  sc.onerror = function () { optQ = null; bad(); };
  document.body.appendChild(sc);
}
function optFail() { optShow('<div class="empty">Could not load the optimizer. Check your connection and reload the page.</div>'); }
var planFor = null;
function renderOptimizer() {
  if (!M) { optShow(needData('No beast data yet.')); return; }
  if (!H.sk()) { optShow('<div class="empty">The optimizer needs a verified player. Open your own armory to use it.</div>'); return; }
  if (platOk === false) { optShow('<div class="empty">Could not load the beast platform data. Check your connection and reload the page.</div>'); return; }
  var ps = activePrefs();
  if (!ps) { optShow(wizPane()); return; }
  var key = JSON.stringify(ps);
  if (plan && planFor && planFor.key === key && planFor.merged === S.res.merged) { optShow(planPane()); return; }
  optShow('<div class="sechead"><h2 class="title">Beast optimizer</h2></div><div class="bst-ban" aria-hidden="true"></div><p class="t13 muted" role="status">Working out the best placements...</p>');
  loadOpt(function (o) {
    setTimeout(function () {
      try {
        plan = Logic.planModel(G, core, o, S.res.merged, benchSupp(), ps, H.sk()); planFor = { key: key, merged: S.res.merged };
        optShow(planPane());
      } catch (e) { if (window.console) console.error(e); optShow('<div class="empty">Could not work out the plan. Reload the page to try again.</div>'); }
    }, 20);
  }, optFail);
}
function wizClick(v) {
  var kv = v.split(':'), a = kv[0], val = kv.slice(1).join(':');
  if (a === 'mode') { W = { step: 2, mode: val, units: val === 'triple' ? [1, 2, 3] : [], weights: val === 'triple' ? [1, 1, 1] : [] }; }
  else if (a === 'unit') {
    var u = +val, i = W.units.indexOf(u), cap = W.mode === 'mono' ? 1 : W.mode === 'dual' ? 2 : 3;
    if (i >= 0) { W.units.splice(i, 1); W.weights.splice(i, 1); } else { if (W.units.length >= cap) { W.units.shift(); W.weights.shift(); } W.units.push(u); W.weights.push(1); }
  } else if (a === 'preset') W.weights = val.split(',').map(Number);
  else if (a === 'back') W.step = 1;
  else if (a === 'go') {
    var cp = W.mode === 'mono' ? 1 : W.mode === 'dual' ? 2 : 3;
    if (W.units.length !== cp) { var er = $('#bstWerr'); if (er) er.hidden = false; return; }
    var p = Logic.validPrefs({ mode: W.mode, units: W.units.slice(), balance: W.mode === 'dual' && W.weights[0] !== W.weights[1] ? 'primarySecondary' : 'even', weights: W.mode === 'mono' ? null : W.weights.slice() });
    if (!p) return;
    curPrefs = p; editing = false;
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
    if (ds.bsa === 'edit') { editing = true; curPrefs = null; var sp0 = savedPrefs(); W = sp0 ? { step: 2, mode: sp0.mode, units: sp0.units.slice(), weights: sp0.weights ? sp0.weights.slice() : sp0.units.map(function () { return 1; }) } : { step: 1, mode: '', units: [], weights: [] }; optShow(wizPane()); return; }
    if (ds.bsa === 'copy' && plan) {
      var text = Logic.checklist(G, plan.groups), flash = function (m) { t.textContent = m; setTimeout(function () { t.textContent = 'Copy as checklist'; }, 2000); };
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash('Copied'); }, function () { flash('Copy failed'); }); else flash('Copy failed'); } catch (er) { flash('Copy failed'); }
    }
  });
  v.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset) return;
    if (t.dataset.bsf) { F[t.dataset.bsf] = t.value; F.n = PAGE; collRefresh(); return; }
    if (t.dataset.bsws !== undefined) { W.weights[+t.dataset.bsws] = parseFloat(t.value); }
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
      var mv = null;
      try { mv = Logic.bestMove(G, core, o, S.res.merged, benchSupp(), ps, H.sk()); } catch (e) { if (window.console) console.error(e); }
      if (S.vm !== vm) return;
      var before = JSON.stringify(vm.moves.picks);
      vm.movesInput.beastMoves = mv ? [mv] : [];
      vm.moves.picks = window.ArmoryVM.movePicks(core.nextMoves(vm.movesInput, { max: 3 }));
      if (JSON.stringify(vm.moves.picks) !== before) H.renderOverview();
    }, function () {});
  };
  if (H.d && H.d.ensurePlatforms) H.d.ensurePlatforms().then(go, function () {}); else go();
}
return { render: render, sheet: function (kind, arg) { return kind === 'beast' ? beastSheet(arg) : filterSheet(); }, nextMove: nextMove, model: function () { return M; } };
};
})(typeof window !== 'undefined' ? window : globalThis);
