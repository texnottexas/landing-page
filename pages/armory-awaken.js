/* armory-awaken.js: Hero Awakening for the Armory v2 page, loaded the first time an awakened hero opens, the Awakening card opens, or a
 * player can afford a step (armory-app.js awk()). First paint (badges, portraits, the summary line, the Awaken move) lives in armory-vm.js
 * and needs none of this; here are the skill names and effects (data/hero-awakening-skills.json, fetched once), the order Tex's rule gives,
 * the Raise / Save-for moves and the Awakening block of an expanded hero.
 * Same-origin script, no CSP change. Everything from a supplement or the catalog is coerced to a number or goes through esc / nd / textContent.
 * The rules sit in ArmoryAwakenLogic (no DOM, node-testable); ArmoryAwaken(H) is the view.
 *
 * The order (Tex, 2026-10-10): a set is the 3 heroes of one march; set power = the sum of their heroes' power; the main set is the strongest,
 * unless the runner-up is within 15% (second >= 0.85 x main) and holds MORE total awakening skill levels. Skills of the main set rise to Lv.6
 * first (skill 2, 3, 4, then 1, the site's Heroes Awakening page), then round-robin 6 -> 7 -> ... -> 10. When the main set is past Lv.6 and a
 * close second set still has skills under Lv.6, that is the "or".
 */
(function (root) {
'use strict';
var isNode = typeof module === 'object' && module.exports;
var VM = isNode ? require('./armory-vm.js') : root.ArmoryVM;
var AW = VM.AW;
var SLOT_PRI = { 2: 0, 3: 0, 4: 1, 1: 2 }; // skill 2 and 3 first, then 4, then 1 (heroes-awakening.html, Strategy)
var TRIOS = [[169, 174, 170], [172, 173, 165], [234, 241, 240], [239, 232, 237], [333, 336, 337], [334, 338, 332]]; // the game's awakening trios (heroes-awakening.json comboTrio)
var CLOSE = 0.85;

/* ---------- logic (no DOM) ---------- */
function num(v) { v = +v; return isFinite(v) ? v : 0; }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function fmtInt(n) { return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function step(lv) { return 5 * AW.CLICK[lv - 1]; } // stones to take a skill from lv to lv + 1 (5 clicks at the level's price)
function costTo(from, to) { var t = 0; for (var l = from; l < to; l++) t += step(l); return t; }
/* {slot: level} from the supplement's {skillId: level}; only this hero's own four ids count, a missing id is a locked skill */
function awSkills(id, aws) {
  var f = AW.FIRST[id], o = null, s, v;
  if (f && aws && typeof aws === 'object') for (s = 1; s <= 4; s++) { v = Math.floor(+aws[f + s - 1]); if (v >= 1) (o = o || {})[s] = Math.min(v, 10); }
  return o;
}
/* What the first-paint model leaves out, read from the supplement's hero rows: skill levels, the game's own awakening power, and how much is known
   (mode: full = the Snapshot has the skills; old = level only; report = a battle report's level; level = a hero whose skills are not live yet; none).
   fa:1 without aws means all four skills are 10. */
function enrich(A, list) {
  if (A.rich) return A;
  A.rich = true;
  var rec = {};
  (list || []).forEach(function (h) { if (h && isFinite(+h.id)) rec[+h.id] = h; });
  Object.keys(A.byId).forEach(function (k) {
    var a = A.byId[k], s = rec[k], aws = a.game && a.live ? awSkills(a.id, s.aws) : null;
    if (a.game && a.live && !aws && a.fa) aws = { 1: 10, 2: 10, 3: 10, 4: 10 };
    a.aws = aws; a.awp = a.game && isFinite(+s.awp) && +s.awp > 0 ? +s.awp : null;
    a.mode = !a.aw ? 'none' : !a.live ? 'level' : aws ? 'full' : a.game ? 'old' : 'report';
  });
  return A;
}
function workable(a) { return !!(a && a.live && (a.aw > 0 || VM.canAwaken(a))); }
function cleanSet(ids) {
  var out = [];
  (Array.isArray(ids) ? ids : []).forEach(function (v) { v = Math.floor(+v); if (v > 0 && out.indexOf(v) < 0) out.push(v); });
  return out.length === 3 ? out : null;
}
function safeName(s, fb) { s = String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40); return s || fb; }
function levels(byId, ids) { var t = 0; ids.forEach(function (id) { var a = byId[id]; if (a && a.aws) for (var s = 1; s <= 4; s++) t += a.aws[s] || 0; }); return t; }

/* ctx: { byId (vm.awaken.byId), pw: {id: power}, marches: [{name, ids}], presets: [[ids]], reports: [[ids]], stones: n | null } */
function pickSets(ctx) {
  var A = ctx.byId, pw = ctx.pw || {};
  function owned(id) { return has(pw, id) || !!(A[id] && (A[id].snap || A[id].aw > 0)); }
  var srcs = [
    ['march', (ctx.marches || []).map(function (m, i) { return [cleanSet(m && m.ids), safeName(m && m.name, 'March ' + (i + 1))]; })],
    ['preset', (ctx.presets || []).map(function (ids, i) { return [cleanSet(ids), 'Preset ' + (i + 1)]; })],
    ['report', (ctx.reports || []).map(function (ids, i) { return [cleanSet(ids), 'Battle report march ' + (i + 1)]; })],
    ['trio', TRIOS.filter(function (t) { return t.some(owned); }).map(function (t) { return [t.slice(), 'Awakening trio']; })]
  ];
  for (var i = 0; i < srcs.length; i++) {
    var seen = {}, sets = [];
    srcs[i][1].forEach(function (p) {
      if (!p[0]) return;
      var key = p[0].slice().sort(function (a, b) { return a - b; }).join('-');
      if (!seen[key]) { seen[key] = 1; sets.push({ key: key, name: p[1], src: srcs[i][0], ids: p[0] }); }
    });
    if (sets.some(function (s) { return s.ids.some(function (id) { return workable(A[id]); }); })) return sets;
  }
  return Object.keys(A).map(Number).filter(function (id) { return A[id].aw > 0; }).map(function (id) { return { key: 'solo' + id, name: A[id].name, src: 'solo', ids: [id] }; });
}

/* The skills one set plans: each hero belongs to the strongest set that holds it, so a step is never listed twice */
function skillsOf(ctx, set) {
  var out = [];
  set.own.forEach(function (id) {
    var a = ctx.byId[id];
    if (!a || !a.live || !(a.aw > 0) || !a.aws) return;
    for (var s = 1; s <= 4; s++) { var lv = a.aws[s]; if (lv >= 1 && lv < 10) out.push({ id: id, slot: s, lv: lv, pw: num(ctx.pw[id]), set: set.key }); }
  });
  return out;
}
function nextOf(ctx, set) {
  var sk = skillsOf(ctx, set), A = sk.filter(function (s) { return s.lv < 6; }), pool = A.length ? A : sk, phase = A.length ? 'A' : 'B';
  if (!pool.length) return null;
  pool.sort(function (a, b) {
    if (phase === 'A') return (SLOT_PRI[a.slot] - SLOT_PRI[b.slot]) || (a.lv - b.lv) || (b.pw - a.pw) || (a.slot - b.slot);
    return (a.lv - b.lv) || (b.pw - a.pw) || (SLOT_PRI[a.slot] - SLOT_PRI[b.slot]) || (a.slot - b.slot);
  });
  var s = pool[0];
  return { id: s.id, slot: s.slot, lv: s.lv, to: s.lv + 1, cost: step(s.lv), phase: phase, set: set.key };
}

function plan(ctx) {
  var A = ctx.byId, pw = ctx.pw || {};
  var sets = pickSets(ctx).map(function (s) {
    s.power = s.ids.reduce(function (t, id) { return t + num(pw[id]); }, 0);
    s.levels = levels(A, s.ids); s.own = []; return s;
  });
  var byPower = sets.slice().sort(function (a, b) { return b.power - a.power; }); // stable: the source order breaks a tie
  var home = {};
  byPower.forEach(function (s) { s.ids.forEach(function (id) { if (!has(home, id)) home[id] = s; }); });
  byPower.forEach(function (s) { s.own = s.ids.filter(function (id) { return home[id] === s; }); });
  var loose = Object.keys(A).map(Number).filter(function (id) { return A[id].aw > 0 && A[id].aws && !has(home, id); })
    .sort(function (a, b) { return num(pw[b]) - num(pw[a]); })
    .map(function (id) { return { key: 'loose' + id, name: A[id].name, src: 'loose', ids: [id], own: [id], power: num(pw[id]), levels: levels(A, [id]) }; });
  var top = byPower[0] || null, main = top;
  if (top && top.power > 0 && byPower[1] && byPower[1].power * 100 >= top.power * 85 && byPower[1].levels > top.levels) main = byPower[1];
  var seconds = main && main.power > 0 ? byPower.filter(function (s) { return s !== main && s.power * 100 >= main.power * 85; }) : [];
  var rest = byPower.filter(function (s) { return s !== main && seconds.indexOf(s) < 0; });
  var order = (main ? [main] : []).concat(seconds, rest, loose);
  var P = { sets: order, main: main, seconds: seconds, loose: loose, m: null, alt: null, move: null, saving: null, close: {} };
  seconds.forEach(function (s) { P.close[s.key] = main.power ? Math.round(s.power / main.power * 100) : 0; });
  order.forEach(function (s) { s.next = nextOf(ctx, s); s.done = !s.next; });
  var m = main ? main.next : null, alt = null;
  if (m && m.phase === 'B') for (var i = 0; i < seconds.length; i++) { var n = seconds[i].next; if (n && n.phase === 'A') { alt = n; break; } }
  if (!m) for (var j = 1; j < order.length && !m; j++) m = order[j].next;
  P.m = m; P.alt = alt;
  var st = ctx.stones;
  if (st != null && m) {
    if (st >= m.cost) { P.move = { step: m, or: alt && st >= alt.cost ? alt : null }; }
    else if (alt && st >= alt.cost) P.move = { step: alt, second: true, or: null };
    else P.saving = m;
  }
  return P;
}

/* The moves nextMoves reads (kind raise / save). nameOf(id, slot) -> the catalog's skill name; heroName(id) */
function moves(P, stones, nameOf, heroName, segOf) {
  function route(id) { return 'heroes/' + (segOf ? segOf(id) : 'roster') + '?awk=1&hero=' + encodeURIComponent(heroName(id)); }
  function line(s, lead, tail) { return [{ s: lead }, { s: nameOf(s.id, s.slot), n: 1 }, { s: ' on ' }, { s: heroName(s.id), n: 1 }, { s: tail || ' to ' }, { s: 'Lv.' + s.to, n: 1 }]; }
  function ico(s) { return { u: 'hero-awake-skills/hero_awake' + (+s.id) + '_' + (+s.slot) + '.png', q: 'q5', fb: String(nameOf(s.id, s.slot)).charAt(0) }; }
  var out = [];
  if (P.move) {
    var s = P.move.step, o = P.move.or;
    out.push({
      kind: 'raise', gain: 1, parts: line(s, 'Raise '), alt: o ? line(o, 'or ').concat([{ s: ' (2nd march)' }]) : null,
      meta: (P.move.second ? '2nd march · ' : '') + 'Up to ' + fmtInt(s.cost) + ' stones' + (o ? ' (or ' + fmtInt(o.cost) + ')' : '') + ' · ' + fmtInt(stones) + ' in bag',
      ico: ico(s), route: route(s.id)
    });
  } else if (P.saving) {
    var v = P.saving;
    out.push({
      kind: 'save', parts: [{ s: 'Save for ' }, { s: nameOf(v.id, v.slot), n: 1 }, { s: ' on ' }, { s: heroName(v.id), n: 1 }, { s: ' Lv.' + v.to, n: 1 }],
      meta: fmtInt(stones) + ' / ' + fmtInt(v.cost) + ' Awakening Stones', ico: ico(v), route: route(v.id)
    });
  }
  return out;
}

/* One effect row: the part after "Unlocks at Lv. 6:" is left out when its numbers did not come through ("{1}", "60%,7.5%,3") */
function effectText(e) {
  e = String(e == null ? '' : e);
  var m = /^([\s\S]*?)\s*Unlocks at Lv\. ?6:([\s\S]*)$/.exec(e);
  if (!m) return e;
  if (/[{}]|\d%?,\d/.test(m[2])) return (m[1] + ' More effect at Lv.6.').trim();
  return e;
}
/* What a not-yet-awakened hero still needs: [{ok, text}] */
function needs(a, hasCard) {
  return [
    { ok: a.star >= 5, text: '5 stars (now ' + a.star + ')' },
    { ok: a.lv >= 120, text: 'Level 120 (now ' + a.lv + ')' },
    { ok: a.ex >= 5, text: 'Exclusive Skill Lv.5 (now ' + a.ex + ')' },
    { ok: hasCard === true, unknown: hasCard == null, text: hasCard == null ? 'Awakening Card (bag not in game data)' : hasCard ? 'Awakening Card in bag' : 'Awakening Card not in bag' }
  ];
}
/* The card's lines about cards and who can be awakened */
function cardLines(vmA, nameOf) {
  var out = [];
  Object.keys(AW.CARD).forEach(function (k) {
    var a = vmA.byId[k]; if (!a || a.aw || !a.snap) return;
    var card = vmA.stones == null ? null : !!vmA.cards[k], can = a.star >= 5 && a.lv >= 120 && a.ex >= 5;
    if (card) out.push(a.name + ' Awakening Card in bag · ' + (can ? 'ready to awaken' : 'needs ' + needs(a, true).filter(function (x) { return !x.ok; }).map(function (x) { return x.text; }).join(', ')));
    else if (can) out.push(a.name + ' can be awakened' + (card === false ? ' · needs the Awakening Card' : ''));
  });
  return out;
}
var Logic = { awSkills: awSkills, enrich: enrich, SLOT_PRI: SLOT_PRI, TRIOS: TRIOS, CLOSE: CLOSE, step: step, costTo: costTo, workable: workable, cleanSet: cleanSet, pickSets: pickSets, skillsOf: skillsOf, nextOf: nextOf, plan: plan, moves: moves, effectText: effectText, needs: needs, cardLines: cardLines, fmtInt: fmtInt };
if (isNode) module.exports = { Logic: Logic };
if (!isNode) root.ArmoryAwakenLogic = Logic;

/* ---------- view ---------- */
if (isNode) return;
root.ArmoryAwaken = function (H) {
var S = H.S, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, readOnly = H.readOnly;
var cat = null, catQ = null, catBad = false, pcache = null, wired = false;

var CSS =
  '.awk-body{margin-top:8px;padding-top:12px;border-top:1px solid var(--rule);display:flex;flex-direction:column;gap:12px}' +
  '.awk-strip{display:flex;flex-wrap:wrap;gap:8px}.awk-pt{position:relative;display:inline-flex}.awk-pt .por{width:44px;height:44px}' +
  '.awk-ord{display:flex;flex-direction:column;gap:8px}.awk-ordh{display:flex;align-items:center;justify-content:space-between}' +
  '.awk-set{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid var(--rule)}.awk-set:first-of-type{border-top:0}' +
  '.awk-sh{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;font-size:var(--fs-15)}.awk-sh b{font-weight:700}.awk-sm{font-size:var(--fs-13);color:var(--muted)}' +
  '.awk-next{font-size:var(--fs-15);padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-chip)}.awk-next.awk-hl{border-color:var(--accent)}' +
  '.awk-ln{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:var(--fs-14);color:var(--muted)}' +
  '.awk-bh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.awk-bt{font:700 var(--fs-15)/1.3 var(--display)}' +
  '.awk-pw{font-size:var(--fs-13);color:var(--muted);margin-left:auto}.awk-lab{font-size:var(--fs-13);color:var(--muted)}.awk-pill{color:var(--q5)}' +
  '.awk-sk{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:8px}' +
  '.awk-c{display:flex;gap:12px;padding:12px;background:var(--card-hi);border:1px solid var(--border);border-radius:var(--r-card);min-width:0}.awk-c.awk-hl{border-color:var(--accent)}.awk-c.awk-lock{opacity:.8}' +
  '.awk-c .ico,.awk-c .fb{width:40px;height:40px;flex:none}.awk-cb{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}' +
  '.awk-cn{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 8px;font-size:var(--fs-15);font-weight:600}.awk-lv{font-size:var(--fs-13);color:var(--muted);font-weight:400}' +
  '.awk-eff{margin:0;font-size:var(--fs-13);color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.awk-eff.all{display:block}' +
  '.awk-more{align-self:flex-start;padding:0}.awk-nx{font-size:var(--fs-13)}.awk-nx.dim{color:var(--muted)}' +
  '.awk-req{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:var(--fs-14)}.awk-req li{display:flex;align-items:center;gap:8px;color:var(--muted)}.awk-req li.ok{color:var(--text)}' +
  '.awk-req .i{width:16px;height:16px;color:var(--ok);flex:none}.awk-req .awk-nil{width:16px;height:16px;flex:none;border:1.5px solid var(--border);border-radius:50%}' +
  '@media (min-width:768px){.awk-sk{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}';
function injectCss() { if (document.getElementById('awk-style')) return; var s = document.createElement('style'); s.id = 'awk-style'; s.textContent = CSS; document.head.appendChild(s); }

function sp(t, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + nd(t) + '</span>'; }
function vmA() { var A = S.vm && S.vm.awaken; return A && enrich(A, S.res && S.res.supp && S.res.supp.heroes && S.res.supp.heroes.list); }
function heroName(id) { var a = vmA() && vmA().byId[id]; return a ? a.name : core.heroName(+id); }
function catHero(id) { return cat && cat.heroes && cat.heroes[String(id)] || null; }
function catSkill(id, slot) { var h = catHero(id), r = null; ((h && h.skills) || []).forEach(function (s) { if (+s.slot === +slot) r = s; }); return r; }
function nameOf(id, slot) { var s = catSkill(id, slot); return s && s.name ? String(s.name) : 'Skill ' + (+slot); }
function loadCat(cb) {
  if (cat) return cb(true);
  if (catBad) return cb(false);
  if (catQ) { catQ.push(cb); return; }
  catQ = [cb];
  var done = function (ok) { var q = catQ; catQ = null; q.forEach(function (f) { f(ok); }); };
  fetch('data/hero-awakening-skills.json').then(function (r) { if (!r.ok) throw new Error('catalog'); return r.json(); }).then(function (j) {
    if (!j || typeof j !== 'object' || !j.heroes) throw new Error('catalog'); cat = j; done(true);
  }).catch(function () { catBad = true; done(false); });
}

/* the context the logic reads, from what the page already holds (nothing is fetched for it) */
function context() {
  var res = S.res, A = vmA(), priv = res.privacy || {}, supp = res.supp || {}, pw = {};
  ((!priv.heroes && supp.heroes && supp.heroes.list) || []).forEach(function (h) { if (h && isFinite(+h.id) && +h.pw > 0) pw[+h.id] = +h.pw; });
  var fm = !priv.formation && supp.formation && Array.isArray(supp.formation.presets) ? supp.formation.presets : [];
  return {
    byId: A.byId, pw: pw, stones: A.stones,
    marches: Array.isArray(res.marchGroups) ? res.marchGroups.map(function (g) { return g && { name: g.name, ids: g.heroIds }; }) : [],
    presets: fm.map(function (p) { return p && p.heroIds; }),
    reports: (res.reports || []).map(function (r) { return r && r.extracted && Array.isArray(r.extracted.heroes) ? r.extracted.heroes.map(function (h) { return h && h.id; }) : null; })
  };
}
function planNow() {
  if (!pcache || pcache.vm !== S.vm) pcache = { vm: S.vm, p: plan(context()) };
  return pcache.p;
}
function segOf(id) { return S.vm.heroes.list.some(function (h) { return h.id === id; }) ? 'battle' : 'roster'; }
function inPlan(id, slot) { var P = planNow(), r = false; [P.m, P.alt].forEach(function (x) { if (x && x.id === id && x.slot === slot) r = true; }); return r; }

/* ---------- the block of one hero ---------- */
function skillCard(a, id, slot, hl) {
  var cs = catSkill(id, slot), lv = a.aws ? a.aws[slot] || 0 : 0, A = vmA(), gate = AW.GATE[slot - 1], name = cs && cs.name ? cs.name : 'Skill ' + slot;
  var icon = art(BASE + 'hero-awake-skills/hero_awake' + (+id) + '_' + (+slot) + '.png', 'ico q5', name.charAt(0), '');
  var eff = lv > 0 && cs && cs.levels && cs.levels[lv - 1] ? effectText(cs.levels[lv - 1].effect) : '';
  var nx;
  if (a.mode !== 'full') nx = '<span class="awk-nx dim">Level not in game data yet</span>';
  else if (!lv) nx = '<span class="awk-nx dim">' + (a.aw >= gate ? 'Level not in game data yet' : 'Unlocks at ' + nd('Awakening Lv.' + gate)) + '</span>';
  else if (lv >= 10) nx = '<span class="awk-nx dim">Max level</span>';
  else nx = '<span class="awk-nx">Next ' + nd('Lv.' + (lv + 1)) + ': up to ' + nd(fmtInt(step(lv))) + ' Awakening Stones' + (A.stones != null ? ' · ' + nd(fmtInt(A.stones)) + ' in bag' : '') + '</span>';
  return '<div class="awk-c' + (lv ? '' : ' awk-lock') + (hl ? ' awk-hl' : '') + '" data-awks="' + (+slot) + '">' + icon + '<div class="awk-cb"><div class="awk-cn"><span translate="no">' + esc(name) + '</span>' +
    (a.mode === 'full' ? '<span class="awk-lv" translate="no">' + (lv ? 'Lv.' + lv + ' of 10' : 'Locked') + '</span>' : '') + '</div>' +
    (lv ? '<div class="meter" role="img" aria-label="Skill level ' + lv + ' of 10"><i style="width:' + (lv * 10) + '%"></i></div>' : '') +
    (eff ? '<p class="awk-eff">' + esc(eff) + '</p>' + (eff.length > 120 ? '<button class="tb link awk-more" type="button" data-awkmore aria-expanded="false">Show all</button>' : '') : '') + nx + '</div></div>';
}
function block(id) {
  var A = vmA(), a = A && A.byId[id]; if (!a) return '';
  var h = '<div class="awk-bh"><span class="awk-bt">Awakening</span>';
  if (a.aw > 0) {
    var lab = a.live && catHero(id) && catHero(id).awakenLabel ? String(catHero(id).awakenLabel) : '';
    h += '<span class="pill awk-pill"><span translate="no">Lv.' + a.aw + ' of 40</span></span>' + (a.fa ? '<span class="pill awk-pill">Full</span>' : '') + (lab ? '<span class="awk-lab" translate="no">' + esc(lab) + '</span>' : '');
    if (a.awp) h += '<span class="awk-pw">' + nd(fmtInt(a.awp)) + ' power · game data</span>';
    h += '</div>';
    if (a.mode === 'level') return h + '<p class="awk-note">Skill details arrive with the next site update.</p>';
    if (a.mode === 'report') return h + '<p class="awk-note">Skill levels need game data.' + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</p>';
    var cs = '';
    for (var s = 1; s <= 4; s++) cs += skillCard(a, id, s, S.awkHl && inPlan(id, s));
    return h + (a.mode === 'old' ? '<p class="awk-note">Skill levels are not in your game data yet.' + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</p>' : '') + '<div class="awk-sk">' + cs + '</div>';
  }
  h += '<span class="pill">Not awakened</span></div>';
  if (!a.live) return h + '<p class="awk-note">Skill details arrive with the next site update.</p>';
  var card = A.stones == null ? null : !!A.cards[id];
  return h + '<ul class="awk-req">' + needs(a, card).map(function (x) {
    return '<li class="' + (x.ok ? 'ok' : '') + '">' + (x.ok ? ic('check') : '<span class="awk-nil" aria-hidden="true"></span>') + '<span>' + nd(x.text) + '</span></li>';
  }).join('') + '</ul>';
}
function needsCat(id) { var a = vmA().byId[id]; return !!(a && a.aw > 0 && a.mode === 'full'); }
function fill(id) {
  injectCss();
  var slots = $$('.awk-slot[data-awk="' + (+id) + '"]');
  if (!slots.length) return;
  loadCat(function (ok) {
    slots.forEach(function (el) {
      try { el.innerHTML = ok || !needsCat(id) ? block(id) : '<p class="awk-note">Could not load the awakening details. Reload the page to try again.</p>'; } catch (e) { if (window.console) console.error(e); el.innerHTML = '<p class="awk-note">Could not show the awakening details.</p>'; }
      el.classList.add('awk-bk');
    });
    setTimeout(trim, 300);
  });
}
/* a "Show all" button only where the effect is really cut off (measured once the panel has opened) */
function trim() {
  $$('.awk-eff').forEach(function (p) {
    var b = p.nextElementSibling;
    if (b && b.hasAttribute('data-awkmore') && p.clientWidth > 0 && !p.classList.contains('all') && p.scrollHeight <= p.clientHeight + 1) b.remove();
  });
}

/* ---------- the card ---------- */
function m3(p) { return p >= 1e6 ? (p / 1e6).toFixed(2) + 'M' : H.fmtK(p); }
function setLine(s, role, P) {
  var names = s.ids.map(function (id) { return nm(heroName(id)); }).join(', ');
  var st;
  if (!s.next) {
    var any = s.own.some(function (id) { var a = vmA().byId[id]; return a && a.aws; });
    st = any ? 'All awakening skills at Lv.10' : 'No awakened heroes with skill data';
  } else {
    var n = s.next;
    st = 'Next: raise ' + nm(nameOf(n.id, n.slot)) + ' on ' + nm(heroName(n.id)) + ' to ' + nd('Lv.' + n.to) + ' · up to ' + nd(fmtInt(n.cost)) + ' stones';
  }
  return '<div class="awk-set"><div class="awk-sh"><b>' + esc(role) + '</b><span>' + nm(s.name) + '</span></div><div class="awk-sm">' + names + ' · ' + nd(m3(s.power)) + (P.close[s.key] ? ' (' + nd(P.close[s.key] + '%') + ')' : '') + '</div><div class="awk-sm">' + st + '</div></div>';
}
function cardBody() {
  var A = vmA(), P = planNow(), inBattle = {};
  S.vm.heroes.list.forEach(function (h) { inBattle[h.id] = 1; });
  var heroes = Object.keys(A.byId).map(function (k) { return A.byId[k]; }).filter(function (a) { return a.aw > 0; }).sort(function (a, b) { return b.pw - a.pw; });
  var strip = heroes.map(function (a) {
    return '<a class="plink awk-pt" href="#heroes/' + (inBattle[a.id] ? 'battle' : 'roster') + '?awk=1&hero=' + encodeURIComponent(a.name) + '" aria-label="' + esc(a.name + ', Awakening Lv.' + a.aw) + '">' + H.awPor(a) + '</a>';
  }).join('');
  var o = '<div class="awk-strip">' + strip + '</div>';
  if (P.sets.length) {
    var rows = '';
    if (P.main) rows += setLine(P.main, 'Main march', P);
    P.seconds.forEach(function (s) { rows += setLine(s, '2nd march', P); });
    var nx = '';
    if (P.move) {
      var mv = moves(P, A.stones, nameOf, heroName, segOf)[0];
      nx = 'Next: ' + mv.parts.map(function (x) { return x.n ? nm(x.s) : esc(x.s); }).join('') + (mv.alt ? '<br>' + mv.alt.map(function (x) { return x.n ? nm(x.s) : esc(x.s); }).join('') : '');
    } else if (P.saving) nx = 'Saving for: ' + nm(nameOf(P.saving.id, P.saving.slot)) + ' on ' + nm(heroName(P.saving.id)) + ' ' + nd('Lv.' + P.saving.to) + ' · ' + nd(fmtInt(A.stones) + ' / ' + fmtInt(P.saving.cost) + ' stones');
    else if (P.m) nx = 'Next: ' + nm(nameOf(P.m.id, P.m.slot)) + ' on ' + nm(heroName(P.m.id)) + ' to ' + nd('Lv.' + P.m.to) + ' · up to ' + nd(fmtInt(P.m.cost) + ' stones') + ' (Awakening Stones not in game data)';
    else nx = 'Every awakening skill that can be raised is at Lv.10.';
    o += '<div class="awk-ord"><div class="awk-ordh"><span class="lbl">Order</span><button class="info" type="button" data-open="awkorder" aria-label="How the order is chosen">' + ic('info', 'sm') + '</button></div>' + rows + '<div class="awk-next' + (S.awkHl ? ' awk-hl' : '') + '">' + nx + '</div></div>';
  }
  var cl = cardLines(A, nameOf);
  if (cl.length) o += '<ul class="awk-ln">' + cl.map(function (t) { return '<li>' + nd(t) + '</li>'; }).join('') + '</ul>';
  return o;
}
function paintCard() {
  injectCss();
  var open = !!S.awkOpen;
  $$('.awk-top .awk-hd').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  var hosts = $$('.awk-top .awk-body');
  if (!open) { hosts.forEach(function (h) { h.hidden = true; h.innerHTML = ''; }); return; }
  loadCat(function (ok) {
    var html;
    try { html = cardBody(); } catch (e) { if (window.console) console.error(e); html = '<p class="awk-note">Could not show the awakening plan.</p>'; }
    hosts.forEach(function (h) { h.hidden = false; h.innerHTML = html; });
  });
}

/* ---------- moves ---------- */
function nextMove() {
  var vm = S.vm; if (!vm || !vm.awaken) return;
  loadCat(function (ok) {
    if (S.vm !== vm || !ok) return;
    var mv = [];
    try { mv = moves(planNow(), vm.awaken.stones, nameOf, heroName, segOf); } catch (e) { if (window.console) console.error(e); }
    var before = JSON.stringify(vm.moves.picks);
    vm.movesInput.awakenMoves = vm.awaken.cand.concat(mv);
    vm.moves.picks = window.ArmoryVM.movePicks(core.nextMoves(vm.movesInput, { max: 3 }));
    if (JSON.stringify(vm.moves.picks) !== before) H.renderOverview();
  });
}

/* ---------- sheet, wiring, entry points ---------- */
function sheet(kind) {
  if (kind !== 'awkorder') return null;
  return ['How the order is chosen', '<p>A set is the three heroes of one march. Its power is the sum of those heroes’ power in your game data. The strongest set is the main march. If the runner-up is within 15% of it and holds more awakening skill levels in total, the runner-up is the main march instead.</p>' +
    '<p>Skills of the main march rise to Lv.6 first: skill 2, then 3, then 4, then 1 (the Heroes Awakening page’s order). Then every skill of the main march goes to Lv.7, then Lv.8, up to Lv.10, lowest level first.</p>' +
    '<p>When the main march is past Lv.6 and a close second march still has skills under Lv.6, the move shows both: raise the main march’s next skill, or bring the second march up to Lv.6.</p>' +
    '<p>Costs are the most it can take: Awakening Stones already spent on the current level are not in your game data, so the real cost can only be lower. Heroes that are not in a march come after the marches.</p>'];
}
function wire() {
  if (wired) return; wired = true;
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-awkmore]') : null; if (!t) return;
    var p = t.previousElementSibling; if (!p) return;
    var on = !p.classList.contains('all'); p.classList.toggle('all', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); t.textContent = on ? 'Show less' : 'Show all';
  });
}
function refresh() {
  wire(); paintCard();
  $$('.awk-slot').forEach(function (el) { var id = +el.dataset.awk, art_ = el.closest('.hero'); if (art_ && art_.classList.contains('open')) fill(id); });
}
function focus(q) {
  S.awkHl = !!q.awk; S.awkOpen = true; wire(); paintCard();
  $$('.awk-slot').forEach(function (el) { var a = el.closest('.hero'); if (a && a.classList.contains('open')) fill(+el.dataset.awk); });
  var t = $('.awk-top'); if (t && !q.hero) setTimeout(function () { t.scrollIntoView({ block: 'center' }); }, 30);
}
wire();
return { fill: fill, paintCard: paintCard, refresh: refresh, nextMove: nextMove, sheet: sheet, focus: focus, plan: planNow };
};
})(typeof window !== 'undefined' ? window : globalThis);
