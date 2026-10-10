/* armory-ht.js: the Heavy Trooper (HT) section of the Armory v2 page (phase 3), loaded the first time the HT route opens.
 * Two segments: Loadouts (one card per HT: its 7 chip slots, set bonuses) and Chip pool (the chips the player owns, filterable).
 * Same-origin script, no CSP change. Everything from the worker or a supplement is coerced to a number or goes through esc / nd.
 * The data rules sit in ArmoryHtLogic (no DOM, node-testable); ArmoryHt(H) is the view. The numbers are the classic HT tab's:
 * chip value = base + per * level from the game's Mecha_chip table (tw-game-data CL), set bonuses from CHIP_SETS.
 */
(function (root) {
'use strict';

/* ---------- logic (no DOM) ---------- */
var SLOTS = [0, 1, 2, 3, 4, 5, 6];
var SLOT_LABEL = { 0: 'Core', 1: 'Slot 1', 2: 'Slot 2', 3: 'Slot 3', 4: 'Slot 4', 5: 'Slot 5', 6: 'Slot 6' };
var RARITY = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' };
var MS_ITEMS = [51071, 51072, 51073, 51074, 51075, 51076, 51077, 51078, 51079];
var has = Object.prototype.hasOwnProperty;

function fmtInt(n) { return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function num(v) { v = +v; return isFinite(v) ? v : 0; }
/* basis points -> percent text, the classic HT tab's fmtPct */
function fmtPct(v) { return (num(v) / 100).toFixed(2).replace(/\.?0+$/, '') + '%'; }
/* "4 months old", the header chip's wording (ts: ISO string or ms); '' for nothing, the future or garbage */
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
/* The game's short chip stat names, written out the way the Heroes screen writes them ("DMG Taken-" is "Decreased DMG Taken", "ATK" is "Attack",
   "DEF all units" is "All units Defense"; INV and Enh are the game's own "Invulnerability" and "Enhance"). Render only: the filter value is the buff id. */
function statName(n) {
  var t = String(n).replace(/\bAF\b/g, 'Air Force').replace(/\bATK SPD\b/, 'Attack Speed').replace(/\bATK\b/g, 'Attack').replace(/DMG Taken-/, 'Decreased DMG Taken')
    .replace(/DMG Inc\b/, 'DMG increase').replace(/\bEnh\b/, 'Enhance').replace(/\bINV\b/, 'Invulnerability');
  var m = /^DEF (.+)$/.exec(t);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' Defense' : t.replace(/\bDEF\b/, 'Defense');
}
function lookup(G, id) { var k = String(id); var lk = has.call(G.CL, k) ? G.CL[k] : null; return Array.isArray(lk) ? lk : null; }
function pool(G, pos) { return pos === 0 ? G.RND_CORE : pos <= 3 ? G.RND_REG : G.RND_GLO; }
/* "idx;value|idx;value" -> [{name, val}]; an index outside the pool reads as an unknown buff, a broken token is dropped */
function decodeRnd(G, str, pos) {
  if (!str || typeof str !== 'string') return [];
  var pl = pool(G, pos) || [], out = [];
  str.split('|').forEach(function (p) {
    var pts = p.split(';'), idx = parseInt(pts[0], 10), val = parseInt(pts[1], 10);
    if (isNaN(idx) || isNaN(val)) return;
    var bid = idx >= 0 && idx < pl.length ? pl[idx] : 0;
    out.push({ buff: bid, name: statName(G.BUFF_NAMES_CHIP[bid] || ('Buff #' + bid)), val: val });
  });
  return out;
}

function chipRow(G, lk, c, slot) {
  var lv = num(c.level != null ? c.level : c.lv);
  var base = lk[3] && lk[4] ? lk[4] + lk[5] * lv : null;
  return {
    slot: slot, empty: false, chipId: num(c.chipId != null ? c.chipId : c.c), lv: lv, set: lk[0], setName: G.SET_NAMES[lk[0]] || 'Unknown', icon: G.SET_ICONS[lk[0]] || '',
    col: lk[2], rar: RARITY[lk[2]] || '', stat: lk[3] ? statName(G.BUFF_NAMES_CHIP[lk[3]] || ('Buff #' + lk[3])) : '',
    now: base, max: base == null ? null : lk[4] + lk[5] * 25,
    rnd: decodeRnd(G, typeof c.rndAttrs === 'string' ? c.rndAttrs : (typeof c.r === 'string' ? c.r : ''), slot),
    coreSkill: slot === 0 && lk[6] && G.CORE_SKILL_DESCS[lk[6]] ? statName(G.CORE_SKILL_DESCS[lk[6]]) : ''
  };
}

/* One HT's loadout from its chip list [{chipId, level, rndAttrs}]: the seven positions, the set it wears and its set bonuses. */
function loadout(G, mechaId, chips, extra) {
  var byPos = {}, setCounts = {}, coreSet = null, color = null, list = Array.isArray(chips) ? chips : [];
  list.forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    var lk = lookup(G, c.chipId != null ? c.chipId : c.c);
    if (!lk) return;
    var pos = lk[1];
    byPos[pos] = chipRow(G, lk, c, pos);
    if (pos === 0) { color = lk[2]; coreSet = lk[0]; }
    if (pos > 0) setCounts[lk[0]] = (setCounts[lk[0]] || 0) + 1;
  });
  var slots = SLOTS.map(function (s) { return byPos[s] || { slot: s, empty: true }; });
  var match = coreSet ? (setCounts[coreSet] || 0) : 0, keys = Object.keys(setCounts);
  var bonuses = [], cumul = [];
  if (coreSet) {
    var cm = {};
    G.getBonuses(coreSet, color).forEach(function (b) {
      var on = match >= b.count;
      bonuses.push({ count: b.count, desc: statName(b.desc), base: b.base, on: on });
      if (on && b.base) { var dn = statName(b.desc); if (!(dn in cm)) { cm[dn] = 0; cumul.push(dn); } cm[dn] += b.base; }
    });
    cumul = cumul.map(function (d) { return { desc: d, val: cm[d] }; });
  }
  var o = {
    mecha: num(mechaId), name: G.MECHA_NAMES[num(mechaId)] || ('HT ' + num(mechaId)), slots: slots,
    count: list.length, filled: slots.filter(function (s) { return !s.empty; }).length,
    coreCol: color, low: slots.filter(function (x) { return !x.empty && x.slot > 0 && x.lv < 25; }).length,
    coreSet: coreSet, coreSetName: coreSet ? (G.SET_NAMES[coreSet] || 'Unknown') : '', coreIcon: coreSet ? (G.SET_ICONS[coreSet] || '') : '',
    rarity: coreSet ? (RARITY[color] || '') : '', match: match,
    mixed: keys.length > 1 ? keys.map(function (k) { return { n: setCounts[k], name: G.SET_NAMES[k] || '' }; }) : null,
    bonuses: bonuses, cumul: cumul
  };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

/* A bound-HT field that is not a whole number would throw inside the overlay (core): the view-model's rule, shared. */
function cleanChips(cs) {
  var V = root.ArmoryVM || (typeof require === 'function' ? require('./armory-vm.js') : null);
  return V ? V.cleanChips(cs) : cs;
}

/* Every HT with chips (battle reports overlaid by a newer chips supplement, as classic does), the ones the player fights with first. */
function loadouts(core, G, merged, supp, reports, reportMechaIds) {
  var cs = cleanChips(supp && supp.chips || null), ts = cs && cs.ts ? new Date(cs.ts).getTime() : 0;
  var per = core._ar_perEntityReportTs(reports || [], 'mechas', 'mechaId');
  var fights = Array.isArray(reportMechaIds) ? reportMechaIds : [];
  var list = core._ar_overlayMechasWithChips((merged && merged.mechas) || [], per, cs, ts)
    .filter(function (m) { return m && m.mechaId !== 1008 && m.chips && m.chips.length; })
    .map(function (m, i) { var l = loadout(G, m.mechaId, m.chips, { fights: fights.indexOf(m.mechaId) >= 0, source: m._source === 'supp' ? 'game data' : 'battle reports', ts: m._source === 'supp' ? ts : 0, order: i }); return l; });
  list.sort(function (a, b) { return (b.fights - a.fights) || (a.order - b.order); });
  return list;
}

/* Heavy Mothership HC-9999: pieces owned (bag), equipped count and level from the chips supplement, its chips as a loadout. */
function mothership(G, supp, inv) {
  var cs = supp && supp.chips || null, ms = cs && cs.mothership && typeof cs.mothership === 'object' ? cs.mothership : null, items = inv && inv.tabs && inv.tabs.item;
  var pieces = null;
  if (Array.isArray(items)) {
    pieces = 0;
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var id = parseInt(it.id != null ? it.id : it.i, 10);
      if (MS_ITEMS.indexOf(id) >= 0) pieces += num(it.amount != null ? it.amount : (it.amt != null ? it.amt : it.n));
    });
  }
  var chips = ms && Array.isArray(ms.chips) && ms.chips.length ? ms.chips.map(function (c) { return c && { chipId: c.c, level: c.lv, rndAttrs: c.r }; })
    : (cs && Array.isArray(cs.chips) ? cs.chips.filter(function (c) { return c && c.m === 1008; }).map(function (c) { return { chipId: c.c, level: c.lv, rndAttrs: c.r }; }) : []);
  if (!ms && !chips.length && !pieces) return null;
  return { name: G.MECHA_NAMES[1008], pieces: pieces, equipped: ms ? num(ms.ep) : null, level: ms ? num(ms.l) : 0, power: ms ? num(ms.p) : 0, loadout: chips.length ? loadout(G, 1008, chips) : null };
}

/* The chip pool: every chip in the chips supplement, with the fields the filters need. */
function poolRows(G, chips) {
  return (Array.isArray(chips) ? chips : []).filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
    var lk = lookup(G, c.c), r = typeof c.r === 'string' ? c.r : '';
    var pos = lk ? lk[1] : null;
    return {
      chipId: num(c.c), lv: num(c.lv), mecha: num(c.m), refine: num(c.rt), locked: !!num(c.rs), set: lk ? lk[0] : null, slot: pos, col: lk ? lk[2] : 1,
      setName: lk ? (G.SET_NAMES[lk[0]] || ('Set ' + lk[0])) : 'Unknown chip', rar: RARITY[lk ? lk[2] : 1] || '', icon: lk ? (G.SET_ICONS[lk[0]] || '') : '',
      stat: lk && lk[3] && lk[4] ? statName(G.BUFF_NAMES_CHIP[lk[3]] || ('Buff #' + lk[3])) : '', now: lk && lk[3] && lk[4] ? lk[4] + lk[5] * num(c.lv) : null,
      rnd: pos == null ? [] : decodeRnd(G, r, pos)
    };
  });
}
function countBy(rows, f) { var m = {}; rows.forEach(function (e) { var k = f(e); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; }
function poolOptions(G, rows) {
  var sets = countBy(rows, function (e) { return e.set; }), slots = countBy(rows, function (e) { return e.slot; }), rars = countBy(rows, function (e) { return e.col; });
  var mech = countBy(rows, function (e) { return e.mecha; }), stats = {};
  rows.forEach(function (e) { var seen = {}; e.rnd.forEach(function (r) { if (!seen[r.buff]) { seen[r.buff] = 1; stats[r.buff] = (stats[r.buff] || 0) + 1; } }); });
  var byCount = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }); };
  return {
    set: [['', 'All sets']].concat(byCount(sets).map(function (k) { return [k, (G.SET_NAMES[k] || ('Set ' + k)) + ' (' + fmtInt(sets[k]) + ')']; })),
    slot: [['', 'All slots']].concat(SLOTS.filter(function (s) { return slots[s]; }).map(function (s) { return [String(s), SLOT_LABEL[s] + ' (' + fmtInt(slots[s]) + ')']; })),
    rar: [['', 'All rarities']].concat([5, 4, 3, 2, 1].filter(function (r) { return rars[r]; }).map(function (r) { return [String(r), RARITY[r] + ' (' + fmtInt(rars[r]) + ')']; })),
    mecha: [['', 'Any']].concat(byCount(mech).map(function (k) { return [k, (k === '0' ? 'Not equipped' : (G.MECHA_NAMES[k] || ('HT #' + k))) + ' (' + fmtInt(mech[k]) + ')']; })),
    stat: [['', 'Any stat']].concat(byCount(stats).map(function (k) { return [k, statName(G.BUFF_NAMES_CHIP[k] || ('Buff #' + k)) + ' (' + fmtInt(stats[k]) + ')']; })),
    sort: [['rarity', 'Rarity'], ['level', 'Level'], ['set', 'Set'], ['slot', 'Slot'], ['refine', 'Refines']],
    lock: [['all', 'All'], ['locked', 'Locked only'], ['unlocked', 'Unlocked only']]
  };
}
function poolFilter(rows, st) {
  var out = rows.filter(function (e) {
    if (st.set && String(e.set) !== st.set) return false;
    if (st.slot !== '' && st.slot != null && String(e.slot) !== st.slot) return false;
    if (st.rar && String(e.col) !== st.rar) return false;
    if (st.mecha !== '' && st.mecha != null && String(e.mecha) !== st.mecha) return false;
    if (st.lock === 'locked' && !e.locked) return false;
    if (st.lock === 'unlocked' && e.locked) return false;
    if (st.stat && !e.rnd.some(function (r) { return String(r.buff) === st.stat; })) return false;
    return true;
  });
  var sl = function (e) { return e.slot == null ? 99 : e.slot; };
  var sorts = {
    rarity: function (a, b) { return (b.col - a.col) || (b.lv - a.lv) || (sl(a) - sl(b)); },
    level: function (a, b) { return (b.lv - a.lv) || (b.col - a.col); },
    set: function (a, b) { return ((a.set == null ? 9999 : a.set) - (b.set == null ? 9999 : b.set)) || (sl(a) - sl(b)) || (b.col - a.col); },
    slot: function (a, b) { return (sl(a) - sl(b)) || (b.col - a.col) || (b.lv - a.lv); },
    refine: function (a, b) { return (b.refine - a.refine) || (b.col - a.col); }
  };
  return out.slice().sort(sorts[st.sort] || sorts.rarity);
}

var Logic = { fmtInt: fmtInt, ageOld: ageOld, statName: statName, fmtPct: fmtPct, decodeRnd: decodeRnd, loadout: loadout, loadouts: loadouts, mothership: mothership, poolRows: poolRows, poolOptions: poolOptions, poolFilter: poolFilter, SLOT_LABEL: SLOT_LABEL, RARITY: RARITY };
root.ArmoryHtLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryHt = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, classicUrl = H.classicUrl, readOnly = H.readOnly;
var DEF = { set: '', slot: '', rar: '', mecha: '', stat: '', sort: 'rarity', lock: 'all', n: 24 };
var P = Object.assign({}, DEF);
var PAGE = 24, STEP = 48, open = {}, cur = { seg: 'loadouts', q: {} }, rows = null, rowsFor = null, opts = null, wired = false;

var CSS =
  '.ht-hd{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--row);text-align:left;color:inherit}.ht-hd:active{background:var(--card-hi)}' +
  '.ht-hd .ico,.ht-hd .fb{width:64px;height:64px}.ht-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
  '.ht-n{font-size:var(--fs-17);font-weight:700}.ht-m{font-size:var(--fs-13);color:var(--muted)}.ht-nw{white-space:nowrap}' +
  '.ht-chev{transition:transform var(--t);flex:none}.ht-hd[aria-expanded="true"] .ht-chev{transform:rotate(180deg)}' +
  '.ht-pills{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}' +
  '.ht-card.is-open > .ht-hd{position:sticky;top:calc(var(--hdr) + 44px);z-index:1;background:var(--card)}' +
  '.ht-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}.ht-strip .ico,.ht-strip .fb{width:32px;height:32px}' +
  '.ht-body{margin-top:8px}.ht-slots,.ht-corel{margin:0;padding:0;list-style:none}' +
  '.ht-slot{display:flex;align-items:flex-start;gap:12px;min-height:var(--row);padding:8px 0;border-top:1px solid var(--rule)}' +
  '.ht-slots > .ht-slot:first-child,.ht-corel > .ht-slot:first-child{border-top:0}.ht-slot .ico,.ht-slot .fb{width:40px;height:40px}.ht-slot .ht-gap{width:40px;height:40px;border:1.5px dashed var(--border);border-radius:var(--r-chip);flex:none}' +
  '.ht-sb{flex:1;min-width:0}.ht-sa{font-size:var(--fs-13);color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}' +
  '.ht-ln{display:flex;justify-content:space-between;max-width:340px;font-size:var(--fs-13);color:var(--muted)}.ht-ln > span:last-child{margin-left:12px;white-space:nowrap;color:var(--text)}' +
  '.ht-ln.ht-main{font-size:var(--fs-15);font-weight:600;color:var(--text);margin-top:2px}.ht-ln.ht-main > span:first-child{color:var(--text)}.ht-ln.ht-max > span:last-child{color:var(--muted)}' +
  '.ht-rnd{margin-top:4px}.ht-skill{font-size:var(--fs-15);font-weight:600;margin-top:2px}' +
  '.ht-slot.ht-sel{margin:0 -12px;padding:8px 12px;background:var(--card-hi);box-shadow:inset 2px 0 0 var(--accent)}' +
  '.ht-q1{border-color:var(--dim)}.ht-q2{border-color:var(--ok)}.ht-q3{border-color:var(--q3)}.ht-q4{border-color:var(--q4)}.ht-q5{border-color:var(--q5)}' +
  '.ht-set{margin-top:12px;padding-top:12px;border-top:1px solid var(--rule)}.ht-set h3{display:flex;align-items:center;gap:8px;font:700 var(--fs-15)/1.3 var(--display)}' +
  '.ht-bon{margin:8px 0 0;padding:0;list-style:none}.ht-bon li{display:flex;align-items:center;gap:8px;min-height:32px;font-size:var(--fs-14);color:var(--muted)}' +
  '.ht-bon li.on{color:var(--text)}.ht-bon .i{width:16px;height:16px;color:var(--ok);flex:none}.ht-bon .ht-nil{width:16px;height:16px;flex:none}' +
  '.ht-tier{font-weight:700;min-width:28px}.ht-cum{margin-top:8px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-chip)}' +
  '.ht-cum div{display:flex;justify-content:space-between;font-size:var(--fs-14);padding:2px 0}.ht-cum .ht-ct{font-size:var(--fs-13);color:var(--muted);font-weight:700;display:block}' +
  '.ht-cum .v{margin-left:12px;color:var(--text);font-weight:700}.ht-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
  '.ht-ms{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:var(--fs-14);color:var(--muted);margin-top:4px}' +
  '.ht-dot{color:var(--muted)}.ht-pill .ht-i,.pill .ht-i{display:inline}' +
  '.ht-fs{display:none}.ht-fbtn{}.ht-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.ht-f .sel{min-width:0;width:100%}' +
  '.ht-cb{min-height:40px;padding:0 14px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--surface);font-size:var(--fs-14);font-weight:600;color:var(--muted)}.ht-cb[aria-pressed="true"]{color:var(--text);background:var(--card-hi);border-color:var(--muted)}' +
  '.ht-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}' +
  '.ht-pc{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0}' +
  '.ht-pc.ht-q1{border-color:var(--dim)}.ht-pc.ht-q2{border-color:var(--ok)}.ht-pc.ht-q3{border-color:var(--q3)}.ht-pc.ht-q4{border-color:var(--q4)}.ht-pc.ht-q5{border-color:var(--q5)}' +
  '.ht-ph{display:flex;align-items:center;gap:8px}.ht-ph .ico,.ht-ph .fb{width:40px;height:40px}.ht-pt{flex:1;min-width:0}.ht-pn{font-size:var(--fs-14);font-weight:600;line-height:1.25}.ht-ps{font-size:var(--fs-12);color:var(--muted)}' +
  '.ht-lock{color:var(--muted)}.ht-pc .ht-ln.ht-main{font-size:var(--fs-13)}.ht-pc .ht-ln{max-width:none}' +
  '.ht-pf{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:6px}.ht-tally{font-size:var(--fs-13);color:var(--muted)}' +
  '@media (min-width:768px){.ht-hd .ico,.ht-hd .fb{width:96px;height:96px}.ht-card.is-open > .ht-hd{position:static}.ht-fbtn{display:none}.ht-fs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}.ht-grid{grid-template-columns:repeat(3,minmax(0,1fr))}' +
  '.ht-card.is-open .ht-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ht-slot.ht-sel{margin:0 -16px;padding:8px 16px}}' +
  '@media (min-width:1024px){.ht-fs{grid-template-columns:repeat(7,1fr)}.ht-grid{grid-template-columns:repeat(4,minmax(0,1fr))}' +
  '#v-ht [data-pane="loadouts"]:not([hidden]){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}#v-ht [data-pane="loadouts"] > *{grid-column:1/-1;margin-top:0}#v-ht [data-pane="loadouts"] > .ht-card:not(.is-open){grid-column:auto}' +
  '.ht-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);grid-template-areas:"slots core" "slots set";grid-template-rows:auto 1fr;gap:16px}.ht-corel{grid-area:core}.ht-body .ht-slots{grid-area:slots;grid-template-columns:repeat(3,minmax(0,1fr))}.ht-set{grid-area:set;margin:0;border-top:0;padding-top:0}' +
  '.ht-card.is-open .ht-slot{border:1px solid var(--rule);border-radius:var(--r-card);padding:12px;background:var(--card-hi)}.ht-card.is-open .ht-slot.ht-sel{margin:0;box-shadow:inset 2px 0 0 var(--accent)}}';

function injectCss() {
  if (document.getElementById('ht-style')) return;
  var s = document.createElement('style'); s.id = 'ht-style'; s.textContent = CSS; document.head.appendChild(s);
}
function icon(file, cls, fb, alt) { return file ? art(BASE + 'ht-chip-icons/' + file, 'ico ' + cls, fb, alt) : '<span class="ico fb ' + cls + '" translate="no">' + esc(fb) + '</span>'; }
function mIcon(id) { return art(BASE + 'mecha-icons/mecha_' + (+id || 0) + '.png', 'ico', 'H', ''); }
function priv() { return (S.res && S.res.privacy) || {}; }
function supp() { var s = S.res && S.res.supp || {}; return priv().chips ? { inv: s.inv, chips: null } : s; }
function invData() { var s = S.res && S.res.supp || {}; return priv().inv ? null : (s.inv || null); }
function classicLink() { return '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl('chips')) + '">' + ic('ext', 'sm') + '<span>See the hex layout on the classic page</span></a></div>'; }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }
/* a flex parent trims a bare text node's edge spaces: keep every nd() string inside its own span there */
function sp(t, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + nd(t) + '</span>'; }
function joinDots(a) { return a.filter(Boolean).map(function (t) { return sp(t); }).join('<span class="ht-dot" aria-hidden="true">·</span>'); }
function ln(label, val, cls) { return '<div class="ht-ln ' + (cls || '') + '"><span>' + esc(label) + '</span><span translate="no">' + esc(val) + '</span></div>'; }
function noHy(t) { return String(t).replace(/-/g, '‑'); }

function slotRow(l, s) {
  var id = 'hts-' + l.mecha + '-' + s.slot;
  if (s.empty) return '<li class="ht-slot" id="' + id + '"><span class="ht-gap" aria-hidden="true"></span><div class="ht-sb"><div class="ht-sa">' + joinDots([SLOT_LABEL[s.slot], 'Empty']) + '</div></div></li>';
  var bits = [SLOT_LABEL[s.slot]];
  if (s.slot > 0) bits.push(s.lv >= 25 ? 'Lv.' + s.lv : 'Lv.' + s.lv + ' of 25');
  var head = joinDots(bits) + (s.slot > 0 && s.col !== l.coreCol && s.rar ? '<span class="pill"><span>' + esc(s.rar) + '</span></span>' : '') + (s.set !== l.coreSet ? sp(s.setName) : '');
  var main = s.now != null ? ln(s.stat, '+' + fmtPct(s.now), 'ht-main') + (s.lv < 25 ? ln('At Lv.25', '+' + fmtPct(s.max), 'ht-max') : '') : (s.coreSkill ? '<div class="ht-skill">' + esc(s.coreSkill) + '</div>' : '');
  var rnd = s.rnd.length ? '<div class="ht-rnd">' + s.rnd.map(function (r) { return ln(r.name, '+' + fmtPct(r.val)); }).join('') + '</div>' : '';
  return '<li class="ht-slot" id="' + id + '">' + icon(s.icon, 'ht-q' + s.col, String(s.slot), s.setName + (s.rar ? ', ' + s.rar : '')) + '<div class="ht-sb"><div class="ht-sa">' + head + '</div>' + main + rnd + '</div></li>';
}
function setBlock(l) {
  if (!l.coreSet || !l.bonuses.length) return '';
  var bon = l.bonuses.map(function (b) {
    return '<li class="' + (b.on ? 'on' : '') + '">' + (b.on ? ic('check') : '<span class="ht-nil" aria-hidden="true"></span>') + '<span class="ht-vh">' + (b.on ? 'Active' : 'Not active') + '</span><span class="ht-tier">' + nd(b.count + 'pc') + '</span><span>' + nd(b.desc + (b.base ? ' +' + fmtPct(b.base) : '')) + '</span></li>';
  }).join('');
  var cum = l.cumul.length ? '<div class="ht-cum"><span class="ht-ct">Cumulative bonuses</span>' + l.cumul.map(function (c) { return '<div><span>' + esc(c.desc) + '</span><span class="v" translate="no">+' + esc(fmtPct(c.val)) + '</span></div>'; }).join('') + '</div>' : '';
  return '<div class="ht-set"><h3>' + icon(l.coreIcon, 'cico', l.coreSetName.charAt(0), '') + '<span>' + nm(l.coreSetName) + ' ' + nd('(' + l.match + '/6)') + '</span></h3><ul class="ht-bon">' + bon + '</ul>' + cum + '</div>';
}
function card(l, key, isOpen, extra) {
  var meta = [];
  if (l.coreSet) { meta.push(l.coreSetName + ' ' + l.match + '/6'); if (l.rarity) meta.push(l.rarity); }
  meta.push(l.count + ' of 7 chips');
  if (l.filled > 1) meta.push(l.low ? l.low + ' below Lv.25' : 'all Lv.25');
  var metaH = meta.map(function (t, i) { return '<span class="ht-nw">' + nd(t + (i < meta.length - 1 ? ' \u00B7' : '')) + '</span>'; }).join(' ');
  var pills = (l.fights ? '<span class="pill"><span>In battle reports</span></span>' : '') + (l.mixed ? '<span class="pill"><span>' + nd('Mixed: ' + l.mixed.map(function (m) { return m.n + ' ' + m.name; }).join(' + ')) + '</span></span>' : '');
  var strip = !isOpen ? '<div class="ht-strip">' + l.slots.filter(function (s) { return !s.empty; }).map(function (s) { return icon(s.icon, 'ht-q' + s.col, String(s.slot), ''); }).join('') + '</div>' : '';
  var body = isOpen ? '<div class="ht-body"><ul class="ht-corel">' + slotRow(l, l.slots[0]) + '</ul><ul class="ht-slots">' + l.slots.slice(1).map(function (s) { return slotRow(l, s); }).join('') + '</ul>' + setBlock(l) + '</div>' : '';
  var src = l.source ? '<p class="foot" style="margin-top:12px">' + nd('Source: ' + l.source + (l.ts ? ', ' + Logic.ageOld(l.ts) : '')) + '</p>' : '';
  return '<section class="card ht-card' + (isOpen ? ' is-open' : '') + '" id="htc-' + key + '"><button class="ht-hd" type="button" data-hto="' + key + '" aria-expanded="' + isOpen + '">' + mIcon(l.mecha) + '<span class="ht-t"><span class="ht-n" translate="no">' + esc(noHy(l.name)) + '</span><span class="ht-m">' + metaH + '</span>' + (pills ? '<span class="ht-pills">' + pills + '</span>' : '') + '</span>' + ic('down', 'ht-chev') + '</button>' + (extra || '') + strip + body + (isOpen ? src : '') + '</section>';
}
var TITLE = '<div class="sechead"><h2 class="title">Heavy Troopers (HT)</h2></div>';

function loadoutsPane() {
  var vm = S.vm.ht, s = supp(), ls = Logic.loadouts(core, G, S.res.merged, s, S.res.reports, vm.reportMechas);
  var ms = Logic.mothership(G, s, invData());
  if (!ls.length && !ms) return needData('No chip data yet.');
  var want = +cur.q.mecha || 0, html = '';
  var top = '<p class="t13 muted">' + nd(ls.length + (ls.length === 1 ? ' HT' : ' HTs') + ' with chips · ' + vm.chipsFilled + ' of ' + vm.chipsMax + ' chips equipped' + (ms ? ' · plus the Heavy Mothership, counted on its own' : '') + (vm.reportMechas ? ' · ' + vm.reportMechas.length + ' in battle reports' : '')) + '</p>';
  var anyFights = ls.some(function (x) { return x.fights; });
  ls.forEach(function (l, i) {
    var k = String(l.mecha), isOpen = open[k] != null ? open[k] : (ls.length === 1 || l.fights || (!anyFights && i === 0));
    html += card(l, k, isOpen);
  });
  if (ms) {
    var meta = [];
    if (ms.pieces != null) meta.push('Pieces owned ' + ms.pieces);
    if (ms.equipped != null) meta.push('Equipped ' + ms.equipped + '/9');
    if (ms.level) meta.push('Lv.' + ms.level);
    if (ms.power) meta.push(Math.round(ms.power).toLocaleString('en-US') + ' power');
    var msH = '<div class="ht-ms">' + joinDots(meta.length ? meta : ['Equipped: none']) + '</div>';
    if (ms.loadout) { ms.loadout.name = ms.name; ms.loadout.source = ''; var k8 = '1008'; html += card(ms.loadout, k8, open[k8] != null ? open[k8] : want === 1008, msH); }
    else html += '<section class="card ht-card"><div class="ht-hd">' + mIcon(1008) + '<span class="ht-t"><span class="ht-n" translate="no">' + esc(noHy(ms.name)) + '</span>' + msH + '</span></div></section>';
  }
  return TITLE + top + html + classicLink();
}

function dirty() { return ['set', 'slot', 'rar', 'mecha', 'stat'].filter(function (k) { return P[k] !== ''; }).length + (P.lock !== 'all' ? 1 : 0); }
function ensurePool() {
  var c = supp().chips, raw = c && Array.isArray(c.chips) ? c.chips : null;
  if (!raw) { rows = null; rowsFor = null; return; }
  if (rowsFor !== raw) { rows = Logic.poolRows(G, raw); opts = Logic.poolOptions(G, rows); rowsFor = raw; P = Object.assign({}, DEF); }
}
function lockIcon() { return '<svg class="i sm ht-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span class="sr">Locked</span>'; }
function poolCard(e) {
  var bits = [e.rar, e.slot == null ? 'Slot ?' : SLOT_LABEL[e.slot]];
  if (e.lv > 0) bits.push('Lv.' + e.lv);
  if (e.refine > 0) bits.push('Refine ' + e.refine);
  var foot = e.mecha > 0 ? '<div class="ht-pf">Equipped on ' + nm(noHy(G.MECHA_NAMES[e.mecha] || ('HT #' + e.mecha))) + '</div>' : '';
  return '<div class="ht-pc ht-q' + e.col + '"><div class="ht-ph">' + icon(e.icon, 'ht-q' + e.col, String(e.slot == null ? '?' : e.slot), e.setName) + '<div class="ht-pt"><div class="ht-pn" translate="no">' + esc(e.setName) + '</div><div class="ht-ps">' + nd(bits.join(' · ')) + '</div></div>' + (e.locked ? lockIcon() : '') + '</div>' +
    (e.now != null ? ln(e.stat, '+' + fmtPct(e.now), 'ht-main') : '') + (e.rnd.length ? '<div class="ht-rnd">' + e.rnd.map(function (r) { return ln(r.name, '+' + fmtPct(r.val)); }).join('') + '</div>' : '') + foot + '</div>';
}
function poolList() {
  var f = Logic.poolFilter(rows, P), shown = f.slice(0, P.n), total = fmtInt(rows.length);
  var tally = !f.length ? '' : '<p class="ht-tally" role="status">' + nd('Showing ' + fmtInt(shown.length) + ' of ' + fmtInt(f.length) + (f.length === rows.length ? '' : ' · ' + total + ' in pool')) + '</p>';
  return (shown.length ? '<div class="ht-grid">' + shown.map(poolCard).join('') + '</div>' : '<div class="empty">No chips match these filters. <button class="tb link" type="button" data-htclear>Clear filters</button></div>') + tally +
    (f.length > shown.length ? '<button class="btn more" type="button" data-htmore><span>Show ' + nd(fmtInt(Math.min(STEP, f.length - shown.length))) + ' more</span></button>' : '');
}
var FIELDS = [['set', 'Set'], ['slot', 'Slot'], ['rar', 'Rarity'], ['mecha', 'Equipped on'], ['stat', 'Stat'], ['sort', 'Sort'], ['lock', 'Lock']];
function selectHtml(k, lab) {
  return '<label class="ht-f"><span>' + esc(lab) + '</span><select class="sel" data-htf="' + k + '">' + opts[k].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (/\d/.test(o[1]) ? ' translate="no"' : '') + (String(P[k]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
}
function btnText() { var n = dirty(); return 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }
function poolPane() {
  ensurePool();
  if (!rows || !rows.length) return TITLE + needData(readOnly() ? 'Chip pool not provided by this player.' : 'No chip pool imported yet.');
  var c = supp().chips, age = Logic.ageOld(c.ts);
  return TITLE + '<div class="fbar"><div class="grow t13 muted">' + nd(fmtInt(rows.length) + ' chips' + (age ? ' · game data ' + age : '')) + '</div><button class="btn ht-fbtn" type="button" data-open="htfilter">' + ic('sliders', 'sm') + btnText() + '</button></div>' +
    '<div class="ht-fs">' + FIELDS.map(function (f) { return selectHtml(f[0], f[1]); }).join('') + '</div><div id="htPoolList" style="display:flex;flex-direction:column;gap:12px">' + poolList() + '</div>' + classicLink();
}
/* the phone's Filter and Sort sheet: chips for the short lists, selects for the long ones (opened with data-open="htfilter") */
function chipGroup(k, lab, list) {
  return '<div><span class="lab" style="margin-bottom:4px">' + esc(lab) + '</span><div class="chips">' + list.map(function (o) { return '<button class="ht-cb" type="button" data-htc="' + k + ':' + esc(o[0]) + '" aria-pressed="' + (String(P[k]) === String(o[0])) + '">' + nd(o[1].replace(/ \([\d,]+\)$/, '')) + '</button>'; }).join('') + '</div></div>';
}
function sheet() {
  ensurePool(); if (!rows) return null;
  var rest = function (k) { return opts[k].slice(1); };
  var body = '<div class="ctrls">' + chipGroup('sort', 'Sort by', opts.sort) + chipGroup('slot', 'Slot', rest('slot')) + chipGroup('rar', 'Rarity', rest('rar')) + chipGroup('lock', 'Lock', opts.lock) +
    selectHtml('set', 'Set') + selectHtml('mecha', 'Equipped on') + selectHtml('stat', 'Stat') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>';
  return ['Filter and sort', body];
}
function poolRefresh() {
  var l = $('#htPoolList'); if (l) l.innerHTML = poolList();
  $$('.ht-fbtn').forEach(function (b) { b.lastChild.textContent = btnText(); });
  $$('select[data-htf]').forEach(function (x) { if (P[x.dataset.htf] !== undefined && x.value !== String(P[x.dataset.htf])) x.value = String(P[x.dataset.htf]); });
}

function paint() {
  var v = $('#v-ht'); if (!v || !S.vm || !S.res) return;
  injectCss();
  var segs = '<div class="segs"><div class="segs-in" role="tablist">' + [['loadouts', 'Loadouts'], ['pool', 'Chip pool']].map(function (s) { return '<button type="button" role="tab" data-seg="' + s[0] + '" aria-selected="false" data-go="ht/' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></div>';
  v.innerHTML = segs + '<div class="vb" data-pane="loadouts">' + loadoutsPane() + '</div><div class="vb" data-pane="pool">' + poolPane() + '</div>';
  show();
}
function show() {
  var v = $('#v-ht'); if (!v) return;
  $$('.segs button', v).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.seg === cur.seg ? 'true' : 'false'); });
  $$('[data-pane]', v).forEach(function (p) { p.hidden = p.dataset.pane !== cur.seg; });
}
function wire() {
  if (wired) return; wired = true;
  var v = $('#v-ht');
  v.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.hto) { var k = t.dataset.hto, was = t.getAttribute('aria-expanded') === 'true'; open[k] = !was; var pane = $('[data-pane="loadouts"]', v); pane.innerHTML = loadoutsPane(); var nb = $('[data-hto="' + k + '"]', v); if (nb) nb.focus({ preventScroll: true }); return; }
    if (t.hasAttribute('data-htmore')) { P.n += STEP; poolRefresh(); return; }
    if (t.hasAttribute('data-htclear')) { var so = P.sort; P = Object.assign({}, DEF, { sort: so }); poolRefresh(); }
  });
  v.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.htf) return;
    P[t.dataset.htf] = t.value; P.n = PAGE; poolRefresh();
  });
  /* the sheet lives outside #v-ht */
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('#sheetB') || !t.dataset || !t.dataset.htf) return;
    P[t.dataset.htf] = t.value; P.n = PAGE; poolRefresh();
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('#sheetB [data-htc]') : null; if (!t) return;
    var kv = t.dataset.htc.split(':'), k = kv[0], val = kv.slice(1).join(':');
    P[k] = (String(P[k]) === val && k !== 'sort' && k !== 'lock') ? '' : val; if (k === 'lock' && val === '') P.lock = 'all'; P.n = PAGE;
    var h = sheet(); if (h) { $('#sheetB').innerHTML = h[1]; var again = $('#sheetB [data-htc="' + t.dataset.htc + '"]'); if (again) again.focus({ preventScroll: true }); }
    poolRefresh();
  });
}
function fail(e) {
  if (window.console) console.error(e);
  var v = $('#v-ht'); if (v) v.innerHTML = '<div class="vb"><div class="empty">Could not show the HT section. Reload the page to try again.</div></div>';
}
function render(r) {
  try {
    cur = { seg: r && r.seg === 'pool' ? 'pool' : 'loadouts', q: (r && r.q) || {} };
    if (!S.vm || !S.res) return;
    var mid = +cur.q.mecha || 0;
    if (mid) open[String(mid)] = true;
    paint(); wire();
    if (cur.seg === 'loadouts' && mid) {
      var el = document.getElementById('htc-' + mid), sl = +cur.q.slot, row = cur.q.slot != null && sl >= 0 ? document.getElementById('hts-' + mid + '-' + sl) : null;
      if (row) row.classList.add('ht-sel');
      var tgt = row || el; if (tgt) setTimeout(function () { tgt.scrollIntoView({ block: 'center' }); }, 30);
    }
  } catch (e) { fail(e); }
}
return { render: render, sheet: sheet };
};
})(typeof window !== 'undefined' ? window : globalThis);
