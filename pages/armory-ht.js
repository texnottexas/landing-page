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

function num(v) { v = +v; return isFinite(v) ? v : 0; }
/* basis points -> percent text, the classic HT tab's fmtPct */
function fmtPct(v) { return (num(v) / 100).toFixed(2).replace(/\.?0+$/, '') + '%'; }
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
    out.push({ buff: bid, name: G.BUFF_NAMES_CHIP[bid] || ('Buff #' + bid), val: val });
  });
  return out;
}

function chipRow(G, lk, c, slot) {
  var lv = num(c.level != null ? c.level : c.lv);
  var base = lk[3] && lk[4] ? lk[4] + lk[5] * lv : null;
  return {
    slot: slot, empty: false, chipId: num(c.chipId != null ? c.chipId : c.c), lv: lv, set: lk[0], setName: G.SET_NAMES[lk[0]] || 'Unknown', icon: G.SET_ICONS[lk[0]] || '',
    col: lk[2], rar: RARITY[lk[2]] || '', stat: lk[3] ? (G.BUFF_NAMES_CHIP[lk[3]] || ('Buff #' + lk[3])) : '',
    now: base, max: base == null ? null : lk[4] + lk[5] * 25,
    rnd: decodeRnd(G, typeof c.rndAttrs === 'string' ? c.rndAttrs : (typeof c.r === 'string' ? c.r : ''), slot),
    coreSkill: slot === 0 && lk[6] && G.CORE_SKILL_DESCS[lk[6]] ? G.CORE_SKILL_DESCS[lk[6]] : ''
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
      bonuses.push({ count: b.count, desc: b.desc, base: b.base, on: on });
      if (on && b.base) { if (!(b.desc in cm)) { cm[b.desc] = 0; cumul.push(b.desc); } cm[b.desc] += b.base; }
    });
    cumul = cumul.map(function (d) { return { desc: d, val: cm[d] }; });
  }
  var o = {
    mecha: num(mechaId), name: G.MECHA_NAMES[num(mechaId)] || ('HT ' + num(mechaId)), slots: slots,
    count: list.length, filled: slots.filter(function (s) { return !s.empty; }).length,
    coreSet: coreSet, coreSetName: coreSet ? (G.SET_NAMES[coreSet] || 'Unknown') : '', coreIcon: coreSet ? (G.SET_ICONS[coreSet] || '') : '',
    rarity: coreSet ? (RARITY[color] || '') : '', match: match,
    mixed: keys.length > 1 ? keys.map(function (k) { return { n: setCounts[k], name: G.SET_NAMES[k] || '' }; }) : null,
    bonuses: bonuses, cumul: cumul
  };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

/* A bound-HT field that is not a whole number would throw inside the overlay (core): leave that chip out. Same rule as armory-vm.js. */
function cleanChips(cs) {
  if (!cs || !Array.isArray(cs.chips)) return cs;
  var o = {}, k;
  for (k in cs) o[k] = cs[k];
  o.chips = cs.chips.filter(function (c) { return c && typeof c === 'object' && (!c.m || /^\d+$/.test(String(c.m))); });
  return o;
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
    set: [['', 'All sets']].concat(byCount(sets).map(function (k) { return [k, (G.SET_NAMES[k] || ('Set ' + k)) + ' (' + sets[k] + ')']; })),
    slot: [['', 'All slots']].concat(SLOTS.filter(function (s) { return slots[s]; }).map(function (s) { return [String(s), SLOT_LABEL[s] + ' (' + slots[s] + ')']; })),
    rar: [['', 'All rarities']].concat([5, 4, 3, 2, 1].filter(function (r) { return rars[r]; }).map(function (r) { return [String(r), RARITY[r] + ' (' + rars[r] + ')']; })),
    mecha: [['', 'All HTs']].concat(byCount(mech).map(function (k) { return [k, (k === '0' ? 'Universal' : (G.MECHA_NAMES[k] || ('HT #' + k))) + ' (' + mech[k] + ')']; })),
    stat: [['', 'Any stat']].concat(byCount(stats).map(function (k) { return [k, (G.BUFF_NAMES_CHIP[k] || ('Buff #' + k)) + ' (' + stats[k] + ')']; })),
    sort: [['rarity', 'Rarity, high first'], ['level', 'Level, high first'], ['set', 'Set'], ['slot', 'Slot'], ['refine', 'Refines, most first']],
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

var Logic = { fmtPct: fmtPct, decodeRnd: decodeRnd, loadout: loadout, loadouts: loadouts, mothership: mothership, poolRows: poolRows, poolOptions: poolOptions, poolFilter: poolFilter, SLOT_LABEL: SLOT_LABEL, RARITY: RARITY };
root.ArmoryHtLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryHt = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, classicUrl = H.classicUrl, readOnly = H.readOnly;
var P = { set: '', slot: '', rar: '', mecha: '', stat: '', sort: 'rarity', lock: 'all', n: 24 };
var PAGE = 24, STEP = 48, open = {}, cur = { seg: 'loadouts', q: {} }, rows = null, rowsFor = null, opts = null, wired = false;

var CSS = '.ht-title{padding:16px var(--gutter) 0}.ht-title h1{font:700 var(--fs-24)/1.2 var(--display)}' +
  '.ht-hd{display:flex;align-items:center;gap:12px;width:100%;min-height:var(--row);text-align:left;color:inherit}' +
  '.ht-hd .ico,.ht-hd .fb{width:48px;height:48px}.ht-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
  '.ht-n{font-size:var(--fs-17);font-weight:700}.ht-m{font-size:var(--fs-13);color:var(--muted)}' +
  '.ht-chev{transition:transform var(--t);flex:none}.ht-hd[aria-expanded="true"] .ht-chev{transform:rotate(90deg)}' +
  '.ht-pills{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.ht-pill{color:var(--accent)}' +
  '.ht-strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}.ht-strip .ico,.ht-strip .fb{width:32px;height:32px}' +
  '.ht-slots{margin-top:8px}.ht-slot{display:flex;align-items:flex-start;gap:12px;min-height:var(--row);padding:8px 0;border-top:1px solid var(--rule)}' +
  '.ht-slot:first-child{border-top:0}.ht-slot .ico,.ht-slot .fb{width:40px;height:40px}.ht-slot .ht-gap{width:40px;height:40px;border:1.5px dashed var(--border);border-radius:var(--r-chip);flex:none}' +
  '.ht-sb{flex:1;min-width:0}.ht-sa{font-size:var(--fs-15);font-weight:600;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}' +
  '.ht-sa .ht-lv{font-weight:400;color:var(--muted);font-size:var(--fs-13)}.ht-sl{font-size:var(--fs-13);color:var(--muted);margin-top:2px}.ht-sl.ht-main{color:var(--text)}' +
  '.ht-rnd{display:flex;flex-direction:column;gap:2px;margin-top:4px;font-size:var(--fs-13);color:var(--muted)}' +
  '.ht-slot.ht-sel{background:var(--card-hi)}' +
  '.ht-q1{border-color:var(--dim)}.ht-q2{border-color:var(--ok)}.ht-q3{border-color:var(--q3)}.ht-q4{border-color:var(--q4)}.ht-q5{border-color:var(--q5)}' +
  '.ht-set{margin-top:12px;padding-top:12px;border-top:1px solid var(--rule)}.ht-set h3{font:700 var(--fs-15)/1.3 var(--display)}' +
  '.ht-bon{margin-top:8px}.ht-bon li{display:flex;align-items:center;gap:8px;min-height:32px;font-size:var(--fs-14);color:var(--muted)}' +
  '.ht-bon li.on{color:var(--text)}.ht-bon .i{width:16px;height:16px;color:var(--ok);flex:none}.ht-bon .ht-nil{width:16px;height:16px;flex:none}' +
  '.ht-tier{font-weight:700;min-width:28px}.ht-cum{margin-top:8px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-chip)}' +
  '.ht-cum div{display:flex;justify-content:space-between;gap:12px;font-size:var(--fs-14);padding:2px 0}.ht-cum .ht-ct{font-size:var(--fs-12);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:700;display:block}' +
  '.ht-cum .v{color:var(--ok);font-weight:700}.ht-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
  '.ht-ms{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:var(--fs-14);color:var(--muted);margin-top:4px}' +
  '.ht-fs{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}@media (min-width:768px){.ht-fs{grid-template-columns:repeat(4,1fr)}}' +
  '.ht-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.ht-f .sel{min-width:0;width:100%}' +
  '.ht-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}' +
  '.ht-pc{background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);padding:8px;display:flex;flex-direction:column;gap:4px;min-width:0}' +
  '.ht-pc.bound{border-width:2px}.ht-ph{display:flex;align-items:center;gap:8px}.ht-ph .ico,.ht-ph .fb{width:32px;height:32px}' +
  '.ht-pn{font-size:var(--fs-13);font-weight:700;line-height:1.25}.ht-pm{font-size:var(--fs-12);color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 8px}' +
  '.ht-pr{font-size:var(--fs-12);color:var(--muted);border-top:1px solid var(--rule);padding-top:4px}.ht-tally{font-size:var(--fs-13);color:var(--muted)}';

function injectCss() {
  if (document.getElementById('ht-style')) return;
  var s = document.createElement('style'); s.id = 'ht-style'; s.textContent = CSS; document.head.appendChild(s);
}
function icon(file, cls, fb, alt) { return file ? art(BASE + 'ht-chip-icons/' + file, 'ico ' + cls, fb, alt) : '<span class="ico fb ' + cls + '" translate="no">' + esc(fb) + '</span>'; }
function mIcon(id) { return art(BASE + 'mecha-icons/mecha_' + (+id || 0) + '.png', 'ico q5', 'H', ''); }
function priv() { return (S.res && S.res.privacy) || {}; }
function supp() { var s = S.res && S.res.supp || {}; return priv().chips ? { inv: s.inv, chips: null } : s; }
function invData() { var s = S.res && S.res.supp || {}; return priv().inv ? null : (s.inv || null); }
function classicLink() { return '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl('chips')) + '">' + ic('ext', 'sm') + '<span>Open in classic</span></a></div>'; }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }

function slotRow(l, s) {
  var id = 'hts-' + l.mecha + '-' + s.slot;
  if (s.empty) return '<li class="ht-slot" id="' + id + '"><span class="ht-gap" aria-hidden="true"></span><div class="ht-sb"><div class="ht-sa"><span>' + nd(SLOT_LABEL[s.slot]) + '</span><span class="ht-lv">Empty</span></div></div></li>';
  var stat = s.now == null ? '' : '<div class="ht-sl ht-main">' + nd(s.stat + ' +' + fmtPct(s.now) + (s.lv < 25 ? ', +' + fmtPct(s.max) + ' at Lv.25' : '')) + '</div>';
  var core_ = s.coreSkill ? '<div class="ht-sl ht-main">' + esc(s.coreSkill) + '</div>' : '';
  var rnd = s.rnd.length ? '<div class="ht-rnd">' + s.rnd.map(function (r) { return '<span>' + nd(r.name + ' +' + fmtPct(r.val)) + '</span>'; }).join('') + '</div>' : '';
  return '<li class="ht-slot" id="' + id + '">' + icon(s.icon, 'ht-q' + s.col, String(s.slot), s.setName) + '<div class="ht-sb"><div class="ht-sa"><span>' + nd(SLOT_LABEL[s.slot]) + '</span><span class="ht-lv">' + nd([s.rar, s.lv > 0 ? 'Lv.' + s.lv + ' of 25' : (s.slot === 0 ? '' : 'Lv.0 of 25')].filter(Boolean).join(' \u00B7 ')) + '</span></div>' +
    '<div class="ht-sl">' + nm(s.setName) + '</div>' + stat + core_ + rnd + '</div></li>';
}
function setBlock(l) {
  if (!l.coreSet || !l.bonuses.length) return '';
  var bon = l.bonuses.map(function (b) {
    return '<li class="' + (b.on ? 'on' : '') + '">' + (b.on ? ic('check') : '<span class="ht-nil" aria-hidden="true"></span>') + '<span class="ht-vh">' + (b.on ? 'Active' : 'Not active') + '</span><span class="ht-tier">' + nd(b.count + 'pc') + '</span><span>' + nd(b.desc + (b.base ? ' +' + fmtPct(b.base) : '')) + '</span></li>';
  }).join('');
  var cum = l.cumul.length ? '<div class="ht-cum"><span class="ht-ct">Cumulative bonuses</span>' + l.cumul.map(function (c) { return '<div><span>' + esc(c.desc) + '</span><span class="v" translate="no">+' + esc(fmtPct(c.val)) + '</span></div>'; }).join('') + '</div>' : '';
  return '<div class="ht-set"><h3>' + icon(l.coreIcon, 'cico', l.coreSetName.charAt(0), '') + ' ' + esc(l.coreSetName) + ' ' + nd('(' + l.match + '/6)') + '</h3><ul class="ht-bon">' + bon + '</ul>' + cum + '</div>';
}
function card(l, key, isOpen, extra) {
  var meta = [];
  if (l.coreSet) { meta.push(l.coreSetName); if (l.rarity) meta.push(l.rarity); }
  meta.push(l.count + '/7 chips');
  var pills = (l.fights ? '<span class="pill ht-pill">Fights with</span>' : '') + (l.mixed ? '<span class="pill">' + nd('Mixed: ' + l.mixed.map(function (m) { return m.n + ' ' + m.name; }).join(' + ')) + '</span>' : '');
  var strip = !isOpen ? '<div class="ht-strip">' + l.slots.filter(function (s) { return !s.empty; }).map(function (s) { return icon(s.icon, 'ht-q' + s.col, String(s.slot), ''); }).join('') + '</div>' : '';
  var body = isOpen ? '<ul class="ht-slots">' + l.slots.map(function (s) { return slotRow(l, s); }).join('') + '</ul>' + setBlock(l) : '';
  var src = l.source ? '<p class="foot" style="margin-top:12px">' + nd('Source: ' + l.source + (l.ts ? ', imported ' + core._ar_freshnessAge(l.ts) : '')) + '</p>' : '';
  return '<section class="card ht-card" id="htc-' + key + '"><button class="ht-hd" type="button" data-hto="' + key + '" aria-expanded="' + isOpen + '">' + mIcon(l.mecha) + '<span class="ht-t"><span class="ht-n" translate="no">' + esc(l.name) + '</span><span class="ht-m">' + nd(meta.join(' · ')) + '</span>' + (pills ? '<span class="ht-pills">' + pills + '</span>' : '') + '</span>' + ic('chev', 'ht-chev') + '</button>' + (extra || '') + strip + body + (isOpen ? src : '') + '</section>';
}

function loadoutsPane() {
  var vm = S.vm.ht, s = supp(), ls = Logic.loadouts(core, G, S.res.merged, s, S.res.reports, vm.reportMechas);
  var ms = Logic.mothership(G, s, invData());
  if (!ls.length && !ms) return needData('No chip data yet.') + classicLink();
  var want = +cur.q.mecha || 0, html = '';
  var top = '<p class="t13 muted">' + nd(ls.length + (ls.length === 1 ? ' Heavy Trooper' : ' Heavy Troopers') + ' · ' + vm.chipsFilled + ' of ' + vm.chipsMax + ' chips equipped' + (vm.reportMechas ? ' · ' + vm.reportMechas.length + ' in battle reports' : '')) + '</p>';
  ls.forEach(function (l, i) {
    var k = String(l.mecha), isOpen = open[k] != null ? open[k] : (want ? want === l.mecha : i === 0);
    html += card(l, k, isOpen);
  });
  if (ms) {
    var meta = [];
    if (ms.pieces != null) meta.push('Pieces owned ' + ms.pieces);
    if (ms.equipped != null) meta.push('Equipped ' + ms.equipped + '/9');
    if (ms.level) meta.push('Lv.' + ms.level);
    if (ms.power) meta.push(Math.round(ms.power).toLocaleString('en-US') + ' power');
    if (ms.loadout) { ms.loadout.name = ms.name; ms.loadout.source = ''; var k8 = '1008', o8 = open[k8] != null ? open[k8] : want === 1008; html += card(ms.loadout, k8, o8, '<div class="ht-ms">' + nd(meta.join(' \u00B7 ')) + '</div>'); }
    else html += '<section class="card ht-card"><div class="ht-hd">' + mIcon(1008) + '<span class="ht-t"><span class="ht-n" translate="no">' + esc(ms.name) + '</span><span class="ht-m">' + nd(meta.join(' · ') || 'Equipped: none') + '</span></span></div></section>';
  }
  return top + html + classicLink();
}

function ensurePool() {
  var c = supp().chips, raw = c && Array.isArray(c.chips) ? c.chips : null;
  if (!raw) { rows = null; return; }
  if (rowsFor !== raw) { rows = Logic.poolRows(G, raw); opts = Logic.poolOptions(G, rows); rowsFor = raw; }
}
function poolCard(e) {
  var bound = e.mecha > 0, meta = [e.rar];
  if (e.lv > 0) meta.push('Lv.' + e.lv);
  if (e.refine > 0) meta.push('Refine ' + e.refine);
  var bn = bound ? (G.MECHA_NAMES[e.mecha] || ('HT #' + e.mecha)) : '';
  return '<div class="ht-pc ht-q' + e.col + (bound ? ' bound' : '') + '"><div class="ht-ph">' + icon(e.icon, 'ht-q' + e.col, String(e.slot == null ? '?' : e.slot), '') + '<span class="pill">' + nd(e.slot == null ? 'Slot ?' : SLOT_LABEL[e.slot]) + '</span>' + (e.locked ? '<span class="pill c-warn">Locked</span>' : '') + '</div>' +
    '<div class="ht-pn" translate="no">' + esc(e.setName) + '</div>' + (bound ? '<div class="ht-pm"><span>Bound to ' + nm(bn) + '</span></div>' : '') +
    '<div class="ht-pm"><span>' + nd(meta.join(' · ')) + '</span></div>' + (e.rnd.length ? '<div class="ht-pr">' + e.rnd.map(function (r) { return '<div>' + nd(r.name + ' +' + fmtPct(r.val)) + '</div>'; }).join('') + '</div>' : '') + '</div>';
}
function poolList() {
  var f = Logic.poolFilter(rows, P), shown = f.slice(0, P.n);
  return (shown.length ? '<div class="ht-grid">' + shown.map(poolCard).join('') + '</div>' : '<div class="empty">No chips match these filters.</div>') +
    '<p class="ht-tally" role="status">' + nd('Showing ' + shown.length + ' of ' + f.length + ' filtered (' + rows.length + ' total)') + '</p>' +
    (f.length > shown.length ? '<button class="btn more" type="button" data-htmore><span>Show ' + nd(String(Math.min(STEP, f.length - shown.length))) + ' more</span></button>' : '');
}
function poolPane() {
  ensurePool();
  if (!rows || !rows.length) return needData(readOnly() ? 'Chip pool not provided by this player.' : 'No chip pool imported yet.') + classicLink();
  var c = supp().chips, F = [['set', 'Set'], ['slot', 'Slot'], ['rar', 'Rarity'], ['mecha', 'Bound to'], ['stat', 'Stat'], ['sort', 'Sort'], ['lock', 'Lock']];
  var sels = F.map(function (f) {
    return '<label class="ht-f"><span>' + esc(f[1]) + '</span><select class="sel" data-htf="' + f[0] + '">' + opts[f[0]].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (/\d/.test(o[1]) ? ' translate="no"' : '') + (String(P[f[0]]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }).join('');
  var age = c.ts ? ' · updated ' + core._ar_freshnessAge(new Date(c.ts).getTime()) : '';
  return '<p class="t13 muted">' + nd(rows.length + ' chips' + age) + '</p><div class="ht-fs">' + sels + '</div><div id="htPoolList" style="display:flex;flex-direction:column;gap:12px">' + poolList() + '</div>' +
    '<p class="foot">Chips in your game data. A chip bound to an HT is equipped on it. Source: game data.</p>' + classicLink();
}

function paint() {
  var v = $('#v-ht'); if (!v || !S.vm || !S.res) return;
  injectCss();
  var segs = '<div class="segs"><div class="segs-in" role="tablist">' + [['loadouts', 'Loadouts'], ['pool', 'Chip pool']].map(function (s) { return '<button type="button" role="tab" data-seg="' + s[0] + '" aria-selected="false" data-go="ht/' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></div>';
  v.innerHTML = '<div class="ht-title"><h1>Heavy Troopers (HT)</h1></div>' + segs + '<div class="vb" data-pane="loadouts">' + loadoutsPane() + '</div><div class="vb" data-pane="pool">' + poolPane() + '</div>';
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
    if (t.hasAttribute('data-htmore')) { P.n += STEP; $('#htPoolList').innerHTML = poolList(); var m = $$('.ht-pc'); if (m.length > PAGE) m[Math.min(m.length - 1, P.n - STEP)].scrollIntoView({ block: 'nearest' }); }
  });
  v.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.htf) return;
    P[t.dataset.htf] = t.value; P.n = PAGE; $('#htPoolList').innerHTML = poolList();
  });
}
function render(r) {
  cur = { seg: r && r.seg === 'pool' ? 'pool' : 'loadouts', q: (r && r.q) || {} };
  if (!S.vm || !S.res) return;
  paint(); wire();
  var mid = +cur.q.mecha || 0;
  if (cur.seg === 'loadouts' && mid) {
    var el = document.getElementById('htc-' + mid), sl = +cur.q.slot, row = sl >= 0 && cur.q.slot != null ? document.getElementById('hts-' + mid + '-' + sl) : null;
    if (row) row.classList.add('ht-sel');
    var tgt = row || el; if (tgt) setTimeout(function () { tgt.scrollIntoView({ block: 'center' }); }, 30);
  }
}
return { render: render };
};
})(typeof window !== 'undefined' ? window : globalThis);
