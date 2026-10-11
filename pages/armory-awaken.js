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
var awSkills = VM.awSkills; /* one parse for the hero rows (first paint) and the block */
/* What the first-paint model leaves out, read from the supplement's hero rows: skill levels, the game's own awakening power, and how much is known
   (mode: full = the Snapshot has the skills; old = level only; report = a battle report's level; level = a hero whose skills are not live yet; none).
   fa:1 without aws means all four skills are 10. */
function enrich(A, list) {
  if (A.rich) return A;
  A.rich = true;
  var rec = {};
  (list || []).forEach(function (h) { if (h && isFinite(+h.id)) rec[+h.id] = h; });
  Object.keys(A.byId).forEach(function (k) {
    var a = A.byId[k], s = rec[k], aws = a.sk || null;
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
  /* main: among every set within 15% of the strongest, the one with the most total skill levels (the stronger set wins a tie) */
  var top = byPower[0] || null, main = top;
  if (top && top.power > 0) byPower.forEach(function (s) { if (s.power * 100 >= top.power * 85 && s.levels > main.levels) main = s; });
  /* a hero in two sets is planned under the main march when it is in it, else under the strongest set that holds it */
  var home = {};
  (main ? [main] : []).concat(byPower.filter(function (s) { return s !== main; })).forEach(function (s) { s.ids.forEach(function (id) { if (!has(home, id)) home[id] = s; }); });
  byPower.forEach(function (s) { s.own = s.ids.filter(function (id) { return home[id] === s; }); });
  var loose = Object.keys(A).map(Number).filter(function (id) { return A[id].aw > 0 && A[id].aws && !has(home, id); })
    .sort(function (a, b) { return num(pw[b]) - num(pw[a]); })
    .map(function (id) { return { key: 'loose' + id, name: A[id].name, src: 'loose', ids: [id], own: [id], power: num(pw[id]), levels: levels(A, [id]) }; });
  var seconds = main && main.power > 0 ? byPower.filter(function (s) { return s !== main && s.power * 100 >= main.power * 85; }) : [];
  var rest = byPower.filter(function (s) { return s !== main && seconds.indexOf(s) < 0; });
  var order = (main ? [main] : []).concat(seconds, rest, loose);
  var P = { sets: order, main: main, top: top, seconds: seconds, loose: loose, m: null, alt: null, move: null, saving: null, close: {} };
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
  function route(x) { return 'heroes/' + (segOf ? segOf(x.id) : 'roster') + '?hero=' + encodeURIComponent(heroName(x.id)) + '&awk=1&skill=' + (+x.slot); }
  function line(s, lead, tail) { return [{ s: lead }, { s: nameOf(s.id, s.slot), n: 1 }, { s: ' on ' }, { s: heroName(s.id), n: 1 }, { s: tail || ' to ' }, { s: 'Lv.' + s.to, n: 1 }]; }
  function ico(s) { return { u: 'hero-awake-skills/hero_awake' + (+s.id) + '_' + (+s.slot) + '.png', q: 'q5', fb: String(nameOf(s.id, s.slot)).charAt(0) }; }
  var out = [];
  if (P.move) {
    var s = P.move.step, o = P.move.or;
    out.push({
      kind: 'raise', gain: 1, parts: line(s, 'Raise '), alt: o ? line(o, 'or ').concat([{ s: ' (close\u00A0second)' }]) : null,
      meta: (P.move.second ? 'Close second · ' : '') + 'Up to ' + fmtInt(s.cost) + ' stones' + (o ? ' (or ' + fmtInt(o.cost) + ')' : '') + ' · ' + fmtInt(stones) + ' in bag',
      ico: ico(s), route: route(s)
    });
  } else if (P.saving) {
    var v = P.saving;
    out.push({
      kind: 'save', parts: [{ s: 'Save for ' }, { s: nameOf(v.id, v.slot), n: 1 }, { s: ' ' }, { s: 'Lv.' + v.to, n: 1 }, { s: ' on ' }, { s: heroName(v.id), n: 1 }],
      meta: fmtInt(stones) + ' / ' + fmtInt(v.cost) + ' Awakening Stones', ico: ico(v), route: route(v)
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
/* game markup out of a catalog string: "[Combo Attack]" reads "Combo Attack" */
function clean(t) { return String(t).replace(/\[([^\]]{1,40})\]/g, '$1'); }
/* below Lv.6 the "Unlocks at Lv. 6" clause is its own line: it is what the order works towards */
function splitEffect(e, lv) {
  var raw = effectText(e), m = lv < 6 && /^([\s\S]*?)\s*Unlocks at Lv\. ?6:\s*([\s\S]*)$/.exec(raw);
  var b = !m && lv < 6 && /^([\s\S]*?)\s*(More effect at Lv\.6\.)$/.exec(raw); /* a clause whose numbers did not come through */
  if (b) m = b;
  return { now: clean(m ? m[1] : raw), six: m ? clean(m[2]) : '' };
}
/* What a not-yet-awakened hero needs: [{ok, text}]; "(now N)" only against a rule that is not met */
function needs(a, hasCard) {
  return [
    { ok: a.star >= 5, text: a.star >= 5 ? '5 stars' : '5 stars (now ' + a.star + ')' },
    { ok: a.lv >= 120, text: a.lv >= 120 ? 'Level 120' : 'Level 120 (now ' + a.lv + ')' },
    { ok: a.ex >= 5, text: a.ex >= 5 ? 'Exclusive Skill Lv.5' : 'Exclusive Skill Lv.5 (now ' + a.ex + ')' },
    { ok: hasCard === true, unknown: hasCard == null, text: hasCard == null ? 'Awakening Card (the bag is not in game data)' : hasCard ? 'Awakening Card in bag' : 'Awakening Card not in bag' }
  ];
}
/* the checklist's conclusion */
function verdict(a, hasCard) {
  var n = needs(a, hasCard), miss = n.filter(function (x) { return !x.ok; });
  if (!miss.length) return 'Ready to awaken. Use the Awakening Card on ' + a.name + ' in the game.';
  if (miss.length === 1 && miss[0].unknown) return 'Meets every requirement except the card, which cannot be checked without bag data.';
  return 'Still needs: ' + miss.map(function (x) { return x.text; }).join(', ') + '.';
}
/* The card's lines about cards and who can be awakened: {id, text} */
function cardLines(vmA, nameOf) {
  var out = [];
  Object.keys(AW.CARD).forEach(function (k) {
    var a = vmA.byId[k]; if (!a || a.aw || !a.snap) return;
    var card = vmA.stones == null ? null : !!vmA.cards[k], can = a.star >= 5 && a.lv >= 120 && a.ex >= 5;
    if (card) out.push({ id: +k, text: a.name + ' Awakening Card in bag · ' + (can ? 'ready to awaken' : 'needs ' + needs(a, true).filter(function (x) { return !x.ok; }).map(function (x) { return x.text; }).join(', ')) });
    else if (can) out.push({ id: +k, text: a.name + ' can be awakened' + (card === false ? ' · needs the Awakening Card' : '') });
  });
  return out;
}
/* one hero's state in words, for the march rows */
function heroStatus(a) {
  if (!a || !a.live) return "can't be awakened yet";
  if (!a.aw) return 'not awakened';
  if (a.full || (a.aws && a.aws[1] + a.aws[2] + a.aws[3] + a.aws[4] === 40)) return 'all skills Lv.10';
  if (!a.aws) return 'Awakening Lv.' + a.aw + ', skills not in game data';
  var u = [1, 2, 3, 4].filter(function (i) { return a.aws[i]; }), low = u.filter(function (i) { return a.aws[i] < 6; }).length;
  return low ? low + ' of ' + u.length + ' unlocked skills under Lv.6' : 'skills Lv.6 or higher';
}
/* "Sara: all skills Lv.10 · Rohr, Ella: can't be awakened yet": heroes with the same state share a clause */
function statusLine(byId, ids, nameOf) {
  var order = [], by = {};
  ids.forEach(function (id) { var t = heroStatus(byId[id]); if (!by[t]) { by[t] = []; order.push(t); } by[t].push(nameOf(id)); });
  return order.map(function (t) { return { names: by[t], text: t }; });
}
var Logic = { awSkills: awSkills, enrich: enrich, SLOT_PRI: SLOT_PRI, TRIOS: TRIOS, CLOSE: CLOSE, step: step, costTo: costTo, workable: workable, cleanSet: cleanSet, pickSets: pickSets, skillsOf: skillsOf, nextOf: nextOf, plan: plan, moves: moves, effectText: effectText, splitEffect: splitEffect, clean: clean, needs: needs, verdict: verdict, heroStatus: heroStatus, statusLine: statusLine, cardLines: cardLines, fmtInt: fmtInt };
if (isNode) module.exports = { Logic: Logic };
if (!isNode) root.ArmoryAwakenLogic = Logic;

/* ---------- view ---------- */
if (isNode) return;
root.ArmoryAwaken = function (H) {
var S = H.S, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, readOnly = H.readOnly;
var cat = null, catQ = null, catBad = false, pcache = null, wired = false;

var CSS =
  '.awk-body{margin-top:8px;padding-top:12px;border-top:1px solid var(--rule);display:flex;flex-direction:column;gap:12px}' +
  '.awk-sets{display:flex;flex-direction:column;gap:12px}.awk-set{display:flex;flex-direction:column;gap:4px;padding-top:12px;border-top:1px solid var(--rule)}.awk-set:first-child{border-top:0;padding-top:0}' +
  '.awk-sh{display:flex;flex-wrap:wrap;gap:0 8px;align-items:baseline}.awk-role{font:700 var(--fs-15)/1.3 var(--sans,inherit);margin:0;color:var(--text)}.awk-sm{font-size:var(--fs-13);color:var(--muted)}.awk-sm b{color:var(--text);font-weight:600}' +
  '.awk-pts{display:flex;gap:8px;margin:4px 0}.awk-pt{position:relative;display:inline-flex}.awk-pt .por{width:44px;height:44px}' +
  '.awk-step{display:flex;gap:12px;padding:12px;background:var(--card-hi);border:1px solid var(--border);border-radius:var(--r-card)}.awk-step.awk-hl{border-color:var(--accent)}' +
  '.awk-step .ico,.awk-step .fb{width:40px;height:40px;flex:none}.awk-stb{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;align-items:flex-start}.awk-stl{font-size:var(--fs-15)}.awk-stl a{color:var(--accent);text-decoration:underline}' +
  '.awk-ln{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}.awk-ln a{display:flex;align-items:center;gap:12px;min-height:var(--tap-min);padding:4px 0;color:var(--text);text-decoration:none;font-size:var(--fs-14)}.awk-ln .por{width:36px;height:36px}' +
  '.awk-bh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.awk-bt{font:700 var(--fs-17)/1.25 var(--display)}' +
  '.awk-pw,.awk-lab,.awk-bag{font-size:var(--fs-13);color:var(--muted)}.awk-bh .info{margin:-8px 0}.awk-src{margin:8px 0 0;font-size:var(--fs-12);color:var(--muted)}' +
  '.awk-sk{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:8px}' +
  '.awk-c{display:flex;gap:12px;padding:12px;background:var(--card-hi);border:1px solid var(--border);border-radius:var(--r-card);min-width:0}.awk-c.awk-hl{border-color:var(--accent)}.awk-c.awk-lock{color:var(--muted)}' +
  '.awk-c .ico,.awk-c .fb{width:40px;height:40px;flex:none}.awk-cb{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;align-self:stretch}' +
  '.awk-cn{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 8px;font-size:var(--fs-15);font-weight:600}.awk-lv{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-13);color:var(--muted);font-weight:400}' +
  '.awk-m{position:relative}.awk-m::after{content:"";position:absolute;left:60%;top:0;bottom:0;width:1px;background:var(--muted)}' +
  '.awk-eff{margin:0;font-size:var(--fs-13);color:var(--muted)}.awk-six{margin:0;display:flex;gap:6px;align-items:flex-start;font-size:var(--fs-13);color:var(--text)}.awk-six .i{width:14px;height:14px;flex:none;margin-top:2px;color:var(--muted)}' +
  '.awk-more{align-self:flex-start;padding:0}.awk-nx{font-size:var(--fs-13);margin-top:auto}.awk-nx.dim{color:var(--muted)}.awk-tag{font-size:var(--fs-12);color:var(--accent);border:1px solid var(--accent);border-radius:var(--r-chip);padding:0 6px;align-self:flex-start}' +
  '.awk-fold .awk-eff,.awk-fold .awk-six,.awk-fold .awk-more{display:none}.awk-fold.awk-effopen .awk-eff,.awk-fold.awk-effopen .awk-six{display:block}.awk-fold.awk-effopen .awk-six{display:flex}' +
  '.awk-req{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:var(--fs-14)}.awk-req li{display:flex;align-items:center;gap:8px;color:var(--muted)}.awk-req li.ok{color:var(--text)}' +
  '.awk-req .i{width:16px;height:16px;color:var(--ok);flex:none}.awk-req .awk-nil{width:16px;height:16px;flex:none;border:1.5px solid var(--border);border-radius:50%}' +
  '.awk-vd{margin:8px 0 0;font-size:var(--fs-14)}.awk-selreq{padding:8px;border:1px solid var(--accent);border-radius:var(--r-card)}' +
  '@media (max-width:767px){.awk-eff:not(.all){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}' +
  '@media (min-width:768px){.awk-sk{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}' +
  '@media (min-width:1024px){.awk-sets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}.awk-set{border:1px solid var(--rule);border-radius:var(--r-card);padding:12px}.awk-set:first-child{padding-top:12px;border-top:1px solid var(--rule)}.awk-step{max-width:720px}}';
function injectCss() { if (document.getElementById('awk-style')) return; var s = document.createElement('style'); s.id = 'awk-style'; s.textContent = CSS; document.head.appendChild(s); }

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
function href(id, extra) { return '#heroes/' + segOf(id) + '?hero=' + encodeURIComponent(heroName(id)) + (extra || ''); }
function ageDays(ts) { var t = new Date(ts).getTime(); if (!isFinite(t)) return ''; var d = Math.max(0, Math.floor((Date.now() - t) / 864e5)); return d < 1 ? 'today' : d + (d === 1 ? ' day old' : ' days old'); }

/* ---------- the block of one hero ---------- */
function skillCard(a, id, slot, hl) {
  var cs = catSkill(id, slot), lv = a.aws ? a.aws[slot] || 0 : 0, A = vmA(), gate = AW.GATE[slot - 1], name = cs && cs.name ? cs.name : 'Skill ' + slot;
  var icon = art(BASE + 'hero-awake-skills/hero_awake' + (+id) + '_' + (+slot) + '.png', 'ico', name.charAt(0), '');
  /* below Lv.6 the "Unlocks at Lv. 6" clause is its own line: it is what the order is working towards */
  var sp = lv > 0 && cs && cs.levels && cs.levels[lv - 1] ? splitEffect(cs.levels[lv - 1].effect, lv) : { now: '', six: '' }, eff = sp.now, six = sp.six;
  var nx;
  if (a.mode !== 'full') nx = '';
  else if (!lv) nx = a.aw >= gate ? 'Level not in game data yet' : 'Unlocks at ' + nd('Awakening Lv.' + gate + ' (' + (gate - a.aw) + ' levels to go)');
  else if (lv >= 10) nx = '';
  else nx = 'Next ' + nd('Lv.' + (lv + 1)) + ': up to ' + nd(fmtInt(step(lv))) + ' stones';
  var meter = lv ? '<div class="awk-m"><div class="meter ' + (lv >= 10 ? 'r-max' : lv >= 6 ? 'r-hi' : 'r-lo') + '" role="img" aria-label="Skill level ' + lv + ' of 10, Lv.6 switches on the second effect"><i style="width:' + (lv * 10) + '%"></i></div></div>' : '';
  return '<div class="awk-c' + (lv ? '' : ' awk-lock') + (hl ? ' awk-hl' : '') + '" data-awks="' + (+slot) + '">' + icon + '<div class="awk-cb"><div class="awk-cn"><span translate="no">' + esc(name) + '</span>' +
    (a.mode === 'full' ? '<span class="awk-lv" translate="no">' + (lv ? 'Lv.' + lv + ' of 10' : ic('lock', 'sm') + 'Locked') + '</span>' : '') + '</div>' +
    (hl ? '<span class="awk-tag">Next step</span>' : '') + meter +
    (eff ? '<p class="awk-eff">' + esc(eff) + '</p>' + (eff.length > 90 ? '<button class="tb link awk-more" type="button" data-awkmore aria-expanded="false">Show all</button>' : '') : '') +
    (six ? '<p class="awk-six">' + ic('lock', 'sm') + '<span><b>At Lv.6:</b> ' + esc(six) + '</span></p>' : '') +
    (nx ? '<span class="awk-nx' + (lv ? '' : ' dim') + '">' + nx + '</span>' : '') + '</div></div>';
}
function needsData(id) { var a = vmA().byId[id]; return !!(a && a.aw > 0 && (a.mode === 'full' || a.mode === 'old')); }
function block(id) {
  var A = vmA(), a = A && A.byId[id]; if (!a) return '';
  var action = readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>';
  var h = '<div class="awk-bh"><span class="awk-bt">Awakening</span>';
  if (a.aw > 0) {
    var lab = a.live && catHero(id) && catHero(id).awakenLabel ? String(catHero(id).awakenLabel) : '';
    h += '<span class="pill p-lv"><span translate="no">Lv.' + a.aw + ' of 40</span></span>' + (a.full ? '<span class="pill p-lv">Full</span>' : '') + (lab ? '<span class="awk-lab" translate="no">' + esc(lab) + '</span>' : '');
    if (a.awp) h += '<span class="awk-pw">' + nd('Awakening power ' + fmtInt(a.awp)) + '</span><button class="info" type="button" data-open="awkpower" aria-label="What awakening power is">' + ic('info', 'sm') + '</button>';
    if (A.stones != null && a.mode === 'full' && !a.full) h += '<span class="awk-bag">' + nd(fmtInt(A.stones) + ' Awakening Stones in bag') + '</span>';
    h += '</div>';
    if (a.mode === 'level') return h + '<p class="awk-note">Skill details arrive with the next site update.</p>';
    if (a.mode === 'report') return h + '<p class="awk-note">Skill levels need game data.' + action + '</p>';
    var cs = '', fold = a.full && a.aws[1] + a.aws[2] + a.aws[3] + a.aws[4] === 40;
    if (a.mode === 'old') {
      for (var o = 1; o <= 4; o++) cs += '<span class="awk-nx dim">' + esc(nameOf(id, o)) + '</span>';
      return h + '<p class="awk-note">Skill levels are not in your game data yet.' + action + '</p><div class="awk-sk">' + cs + '</div>';
    }
    for (var s = 1; s <= 4; s++) cs += skillCard(a, id, s, S.awkHl && inPlan(id, s));
    var ts = S.res.supp && S.res.supp.heroes && S.res.supp.heroes.ts;
    return h + (fold ? '<button class="tb link" type="button" data-awkeffects aria-expanded="false">Show effects</button>' : '') + '<div class="awk-sk' + (fold ? ' awk-fold' : '') + '">' + cs + '</div>' + (ts && ageDays(ts) ? '<p class="awk-src">Source: game data, ' + esc(ageDays(ts)) + '.</p>' : '');
  }
  h += '<span class="pill">Not awakened</span></div>';
  if (!a.live) return h + '<p class="awk-note">Skill details arrive with the next site update.</p>';
  if (!a.snap) return h + '<p class="awk-note">Awakening needs game data.' + action + '</p>';
  var card = A.stones == null ? null : !!A.cards[id];
  return h + '<div' + (S.awkSel === id ? ' class="awk-selreq"' : '') + '><ul class="awk-req">' + needs(a, card).map(function (x) {
    return '<li class="' + (x.ok ? 'ok' : '') + '">' + (x.ok ? ic('check') : '<span class="awk-nil" aria-hidden="true"></span>') + '<span>' + nd(x.text) + '</span></li>';
  }).join('') + '</ul><p class="awk-vd">' + nd(verdict(a, card)) + '</p></div>';
}
function fill(id) {
  injectCss();
  var slots = $$('.awk-slot[data-awk="' + (+id) + '"]');
  if (!slots.length) return;
  var paint = function (ok) {
    slots.forEach(function (el) {
      try { el.innerHTML = ok || !needsData(id) ? block(id) : '<p class="awk-note">Could not load the awakening details. Reload the page to try again.</p>'; } catch (e) { if (window.console) console.error(e); el.innerHTML = '<p class="awk-note">Could not show the awakening details.</p>'; }
      el.classList.add('awk-bk');
    });
    setTimeout(trim, 300);
    var hl = S.awkScroll && $('.awk-slot[data-awk="' + (+id) + '"] .awk-c.awk-hl'); if (hl) { S.awkScroll = false; setTimeout(function () { hl.scrollIntoView({ block: 'center' }); }, 60); }
    var sel = S.awkSel === id && $('.awk-slot[data-awk="' + (+id) + '"] .awk-selreq'); if (sel) { S.awkSel = 0; setTimeout(function () { sel.scrollIntoView({ block: 'center' }); }, 60); } /* once: a later redraw does not jump back */
  };
  if (needsData(id)) loadCat(paint); else paint(true); /* a hero that is not awakened needs no catalog */
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
function ptsOf(ids) { return '<div class="awk-pts">' + ids.map(function (id) { var a = vmA().byId[id], n = heroName(id); return '<a class="plink awk-pt" href="' + href(id, '&awk=1') + '" aria-label="' + esc(n) + '">' + (a ? H.awPor(a) : H.portrait(id, n, window.ArmoryVM.heroIcon(id), null)) + '</a>'; }).join('') + '</div>'; }
function statusHtml(ids) {
  return statusLine(vmA().byId, ids, heroName).map(function (g) { return '<b translate="no">' + g.names.map(esc).join(', ') + '</b>: ' + nd(g.text); }).join(' · ');
}
function setHtml(s, role, P) {
  var why = '';
  if (s === P.main && P.top !== P.main) why = '<div class="awk-sm">Main march because it has more awakening skill levels (' + nd(s.levels + ' against ' + P.top.levels) + ') and is within 15% of ' + nm(P.top.name) + '’s power.</div>';
  var pct = P.close[s.key] ? '<div class="awk-sm">' + nd(P.close[s.key] + '% of main march power') + '</div>' : '';
  return '<div class="awk-set"><div class="awk-sh"><h3 class="awk-role">' + esc(role) + '</h3><span class="awk-sm" translate="no">' + esc(s.name) + '</span></div>' + ptsOf(s.ids) +
    '<div class="awk-sm">' + nd(m3(s.power) + ' combined power') + '</div>' + pct + '<div class="awk-sm">' + statusHtml(s.ids) + '</div>' + why + '</div>';
}
/* the one step the card recommends, in the Next moves row's anatomy, with its reason */
function stepHtml(P, A) {
  var m = P.move ? P.move.step : P.saving || P.m; if (!m) return allKnown(A) ? '<p class="awk-sm">Every awakening skill that can be raised is at Lv.10.</p>' : needData();
  var sv = !P.move && !!P.saving, nmS = nameOf(m.id, m.slot), link = '<a href="' + href(m.id, '&awk=1&skill=' + m.slot) + '">' + esc(nmS) + '</a>';
  var line = (sv ? 'Save for ' : 'Raise ') + link + ' ' + nd('(Lv.' + m.lv + ' → ' + m.to + ')') + ' on <span translate="no">' + esc(heroName(m.id)) + '</span>';
  var or = P.move && P.move.or ? '<div class="awk-stl awk-sm">or raise <span translate="no">' + esc(nameOf(P.move.or.id, P.move.or.slot)) + '</span> ' + nd('(Lv.' + P.move.or.lv + ' → ' + P.move.or.to + ')') + ' on <span translate="no">' + esc(heroName(P.move.or.id)) + '</span></div>' : '';
  var meta = A.stones == null ? 'Up to ' + nd(fmtInt(m.cost) + ' stones') + ' (the bag is not in game data)' : sv ? nd(fmtInt(A.stones) + ' / ' + fmtInt(m.cost) + ' Awakening Stones') : 'Up to ' + nd(fmtInt(m.cost) + ' stones' + (P.move.or ? ' (or ' + fmtInt(P.move.or.cost) + ')' : '') + ' · you have ' + fmtInt(A.stones));
  var bar = sv ? '<div class="meter" style="width:100%" role="img" aria-label="' + Math.round(A.stones / m.cost * 100) + ' percent of the stones needed"><i style="width:' + Math.min(100, Math.round(A.stones / m.cost * 100)) + '%"></i></div>' : '';
  var set = P.sets.filter(function (x) { return x.key === m.set; })[0], why;
  if (P.move && P.move.second) why = 'Not enough stones for ' + nm(heroName(P.m.id)) + '\u2019s next step (' + nd(fmtInt(P.m.cost) + ', you have ' + fmtInt(A.stones)) + '); this step on the close second march costs ' + nd(fmtInt(m.cost)) + '.';
  else if (P.move && P.move.or) why = nm(heroName(P.m.id)) + '’s skills are all at Lv.6 or higher; ' + (P.alt ? nm(heroName(P.alt.id)) + '’s march' : 'the close second') + ' still has skills under Lv.6.';
  else if (set && set.src === 'loose') why = nm(heroName(m.id)) + ' is in no march; every march is done.';
  else if (set && set !== P.main) why = 'The main march is done; the ' + (P.seconds.indexOf(set) === 0 ? 'close second' : 'next march') + ' is next.';
  else why = '';
  var q = nameOf(m.id, m.slot);
  return '<div class="awk-step' + (S.awkHl ? ' awk-hl' : '') + '">' + art(BASE + 'hero-awake-skills/hero_awake' + (+m.id) + '_' + (+m.slot) + '.png', 'ico', q.charAt(0), '') + '<div class="awk-stb"><span class="pill p-eff">' + (sv ? 'Save for' : 'Uses what you have') + '</span><div class="awk-stl">' + line + '</div>' + or + '<div class="awk-sm">' + meta + '</div>' + bar + (why ? '<div class="awk-sm">' + why + '</div>' : '') + '</div></div>';
}
/* true when every awakened live hero has skill levels, so a claim about skills at Lv.10 is backed by data */
function allKnown(A) { return Object.keys(A.byId).every(function (k) { var a = A.byId[k]; return !a.aw || !a.live || !!a.aws; }); }
function needData() { return '<p class="awk-note">Skill levels need game data.' + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</p>'; }
function cardBody() {
  var A = vmA(), P = planNow(), o = '';
  if (A.n && !Object.keys(A.byId).some(function (k) { return A.byId[k].aws; })) o += needData();
  else if (A.n && P.sets.length) {
    var rows = '';
    if (P.main) rows += setHtml(P.main, 'Main march', P);
    P.seconds.forEach(function (s, i) { rows += setHtml(s, i ? 'Also within 15%' : 'Close second', P); });
    if (P.loose.length) rows += '<div class="awk-set"><div class="awk-sh"><h3 class="awk-role">Not in a march</h3></div>' + ptsOf(P.loose.map(function (l) { return l.ids[0]; })) + '<div class="awk-sm">' + statusHtml(P.loose.map(function (l) { return l.ids[0]; })) + '</div></div>';
    o += '<div class="awk-ordh sechead"><h3 class="lab" style="margin:0;flex:1">Raise order</h3><button class="info" type="button" data-open="awkorder" aria-label="How the order is chosen">' + ic('info', 'sm') + '</button></div><div class="awk-sets">' + rows + '</div>' + stepHtml(P, A);
  }
  var cl = cardLines(A, nameOf);
  if (cl.length) o += '<div class="awk-ln">' + cl.map(function (c) { var a = A.byId[c.id]; return '<a href="' + href(c.id, '&awk=hero') + '">' + H.awPor(a) + '<span>' + nd(c.text) + '</span></a>'; }).join('') + '</div>';
  return o;
}
/* the collapsed card's one line: what to do next */
function verdictLine() {
  var P = planNow(), A = vmA(), m = P.move ? P.move.step : P.saving || P.m;
  if (!m) return allKnown(A) ? 'All awakening skills that can be raised are at Lv.10' : 'Skill levels need game data';
  if (P.saving) return 'Save for ' + nameOf(m.id, m.slot) + ' Lv.' + m.to + ' on ' + heroName(m.id) + ' · ' + fmtInt(A.stones) + ' / ' + fmtInt(m.cost);
  return 'Next: Raise ' + nameOf(m.id, m.slot) + ' on ' + heroName(m.id) + ' to Lv.' + m.to;
}
function paintCard() {
  injectCss();
  var open = !!S.awkOpen;
  $$('.awk-top .awk-hd').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  var hosts = $$('.awk-top .awk-body');
  loadCat(function (ok) {
    try { var v = ok && vmA().n ? verdictLine() : ''; $$('.awk-top .awk-hv').forEach(function (x) { x.textContent = v; }); } catch (e) { if (window.console) console.error(e); }
    if (!open) { hosts.forEach(function (h) { h.hidden = true; h.innerHTML = ''; }); return; }
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
    var mv = [], P = null;
    try { P = planNow(); mv = moves(P, vm.awaken.stones, nameOf, heroName, segOf); } catch (e) { if (window.console) console.error(e); }
    /* Awaken: heroes of the main march first, then hero power */
    vm.awaken.cand.forEach(function (c) { c.gain = (P && P.main && P.main.ids.indexOf(c.hero) >= 0 ? 1e12 : 0) + (vm.awaken.byId[c.hero] ? vm.awaken.byId[c.hero].pw : 0); });
    var before = JSON.stringify(vm.moves.picks);
    vm.movesInput.awakenMoves = vm.awaken.cand.concat(mv);
    vm.moves.picks = window.ArmoryVM.movePicks(core.nextMoves(vm.movesInput, { max: 3 }));
    if (JSON.stringify(vm.moves.picks) !== before) H.renderOverview();
  });
}

/* ---------- sheets, wiring, entry points ---------- */
function sheet(kind) {
  if (kind === 'awkpower') return ['What awakening power is', '<p>Awakening power is the game’s own number for this hero’s awakening level and skills, as your last game data recorded it.</p><p>It is not on the gear score scale. Gear score is this site’s 0 to 6,000 score for gear and runes. The game can add more awakening power later (the Honor Wall), so the Armory shows no maximum.</p>'];
  if (kind !== 'awkorder') return null;
  return ['How the order is chosen', '<p>A set is the three heroes of one march. Its power is the sum of those heroes’ power in your game data. The strongest set is the main march, unless another set within 15% of it holds more awakening skill levels in total: then that set is the main march.</p>' +
    '<p>Skills of the main march rise to Lv.6 first, because Lv.6 switches on each skill’s second effect (the Heroes Awakening guide calls it Tier 6). Skills 2 and 3 go first (the lower level of the two), then skill 4, then skill 1. Then every skill of the main march goes to Lv.7, then Lv.8, up to Lv.10, lowest level first.</p>' +
    '<p>When the main march is past Lv.6 and a close second march still has skills under Lv.6, the move shows both: raise the main march’s next skill, or bring the second march up to Lv.6.</p>' +
    '<p>Costs are the most a step can take: stones already spent on the current level are not in your game data, so the real cost can only be lower. Heroes in no march come after the marches.</p>'];
}
function wire() {
  if (wired) return; wired = true;
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-awkmore], [data-awkeffects]') : null; if (!t) return;
    if (t.hasAttribute('data-awkeffects')) { var g = t.nextElementSibling, on2 = !g.classList.contains('awk-effopen'); g.classList.toggle('awk-effopen', on2); t.setAttribute('aria-expanded', on2 ? 'true' : 'false'); t.textContent = on2 ? 'Hide effects' : 'Show effects'; return; }
    var p = t.previousElementSibling; if (!p) return;
    var on = !p.classList.contains('all'); p.classList.toggle('all', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); t.textContent = on ? 'Show less' : 'Show all';
  });
}
function refresh() {
  wire(); paintCard();
  $$('.awk-slot').forEach(function (el) { var id = +el.dataset.awk, art_ = el.closest('.hero'); if (art_ && art_.classList.contains('open')) fill(id); });
}
/* #heroes/..?awk=1 lights the planned step; awk=hero marks that hero's checklist instead; skill= scrolls to the lit skill */
function focus(q) {
  S.awkHl = q.awk === '1'; S.awkScroll = !!q.skill; S.awkOpen = true; S.awkSel = 0;
  if (q.awk === 'hero' && q.hero) { var A = vmA(); Object.keys(A.byId).forEach(function (k) { if (A.byId[k].name === q.hero) S.awkSel = +k; }); }
  wire(); paintCard();
  $$('.awk-slot').forEach(function (el) { var a = el.closest('.hero'); if (a && a.classList.contains('open')) fill(+el.dataset.awk); });
  var t = $('.awk-top'); if (t && !q.hero) setTimeout(function () { t.scrollIntoView({ block: 'center' }); }, 30);
}
wire();
return { fill: fill, paintCard: paintCard, refresh: refresh, nextMove: nextMove, sheet: sheet, focus: focus, plan: planNow };
};
})(typeof window !== 'undefined' ? window : globalThis);
