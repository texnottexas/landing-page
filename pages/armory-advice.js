/* armory-advice.js: Heroes > Advice on the Armory v2 page (phase 4). Loaded on first use (never on the first paint).
 * Top half: pure rules (no DOM, no fetch), shared with node tests: the step walk, plain reasons, step text, ticks, links.
 * Bottom half: ArmoryAdvice.mount(H), the screens (player checklist, advisor composer, Advise a player).
 * A plan is the classic page's plan: same five step shapes, same worker records. The A5 "return to bag" step is a
 * `recycle` with srcHero 0, which classic already reads. Nothing here writes the player's rune pool.
 */
(function (root) {
'use strict';
var isNode = typeof module === 'object' && module.exports;
var G = isNode ? require('./tw-game-data.js') : root.TWGameData;

function clone(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function ensure(pool, n) { return pool[n] || (pool[n] = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }); }

/* ---------- plain reasons ---------- */
function plainReason(msg) {
  msg = String(msg == null ? '' : msg);
  var m;
  if ((m = /^No (.+) s:0 in pool$/.exec(msg))) return 'No ' + m[1] + ' in your bag';
  if ((m = /^Need (\d+) (.+) s:0 in pool, have (\d+)$/.exec(msg))) return 'Needs ' + m[1] + ' ' + m[2] + ' in your bag, you have ' + m[3];
  if ((m = /^Exceeds star_max (\d+)$/.exec(msg))) return 'Past the ' + m[1] + '-star limit for this slot';
  if ((m = /^Cannot recover upgraded rune \(s:(\d+)\)/.exec(msg))) return 'Only a 0-star rune can go back to the bag (this one is ' + m[1] + '-star)';
  if (msg === 'Slot already has a rune (recycle or inherit first)') return 'That slot already has a rune (return or swap it first)';
  if (/^Destination hero has no gear piece in that slot/.test(msg)) return 'That hero has no gold piece in that slot';
  if ((m = /^Slot rune is (.+), not (.+)$/.exec(msg))) return 'That slot holds ' + m[1] + ', not ' + m[2];
  if ((m = /^Slot star is (\d+), not (\d+)$/.exec(msg))) return 'That rune is ' + m[1] + '-star now, not ' + m[2] + '-star';
  if (/^Unknown step type/.test(msg)) return 'This step needs the classic page';
  return msg.replace(/s:(\d+)/g, '$1-star').replace(/star_max/g, 'star limit');
}

/* ---------- does the import already show the step's result? ---------- */
function looksDone(step, baseGear, pre) {
  if (!step || typeof step !== 'object') return false;
  function at(g, h, s) { return g && g[h] && g[h][s] || null; }
  var t = step.type, c;
  if (t === 'place') { c = at(baseGear, step.dstHero, step.dstSlot); return !!(c && c.runeName === step.runeName); }
  if (t === 'merge') { c = at(baseGear, step.dstHero, step.dstSlot); return !!(c && c.runeName === step.runeName && (+c.star || 0) >= (+step.toStar || 0)); }
  if (t === 'park' || (t === 'recycle' && step.srcHero > 0)) {
    c = at(baseGear, step.srcHero, step.srcSlot);
    return !c || !c.runeName || !!(step.srcRuneName && c.runeName !== step.srcRuneName);
  }
  if (t === 'inherit') {
    var s0 = at(pre || baseGear, step.srcHero, step.srcSlot), d = at(baseGear, step.dstHero, step.dstSlot), n = step.srcRuneName || (s0 && s0.runeName);
    return !!(n && d && d.runeName === n);
  }
  return false;
}

/* ---------- step text (verb first, plain words, no "s:0", no "Park") ----------
 * ctx.mark(name) wraps every name the sentence carries (hero, slot, rune); the screens use it to put translate="no" on them. */
function stepText(step, ctx) {
  ctx = ctx || {};
  var m = ctx.mark || function (x) { return x; };
  var hn = function (id) { return m(ctx.heroName ? ctx.heroName(id) : 'Hero ' + id); }, sn = function (s) { return m(ctx.slotName ? ctx.slotName(s) : 'slot ' + s); };
  if (!step || typeof step !== 'object') return 'Unknown step';
  var rune = m(step.runeName || step.srcRuneName || ctx.srcRune || 'the rune');
  switch (step.type) {
    case 'place': return 'Place ' + rune + ' from your bag on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot);
    case 'merge': return 'Merge ' + rune + ' on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot) + ' to ' + plural(+step.toStar || 0, 'star') + (ctx.mergeCost != null ? ' (uses ' + ctx.mergeCost + ' from your bag)' : '');
    case 'inherit':
      return ctx.dstEmpty ? 'Move ' + rune + ' from ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' to ' + hn(step.dstHero) + "'s empty " + sn(step.dstSlot)
        : 'Swap runes: ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' and ' + hn(step.dstHero) + "'s " + sn(step.dstSlot);
    case 'park': return 'Move ' + rune + ' off ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' onto a spare ' + sn(step.srcSlot);
    case 'recycle':
      return step.srcHero > 0 ? 'Return ' + rune + ' to your bag from ' + hn(step.srcHero) + "'s " + (step.srcGearName ? m(step.srcGearName) : sn(step.srcSlot))
        : 'Return ' + rune + ' to your bag from an unequipped ' + (step.srcGearName ? m(step.srcGearName) : sn(step.srcSlot));
  }
  return 'Unknown step';
}
/* the how-to line under a step that needs one */
function stepNote(step, ctx) {
  ctx = ctx || {};
  var m = ctx.mark || function (x) { return x; };
  var sn = function (s) { return m(ctx.slotName ? ctx.slotName(s) : 'slot ' + s); };
  if (!step || typeof step !== 'object') return '';
  if (step.type === 'park') return 'Craft a spare ' + sn(step.srcSlot) + ' if you have none.';
  if (step.type === 'recycle') return 'Inherit the rune onto a junk ' + (step.srcGearName ? m(step.srcGearName) : sn(step.srcSlot)) + ', then recycle that junk piece.';
  return '';
}

/* ---------- walk every step in order from the base pool and base gear (ticks are ignored) ---------- */
function walk(base, baseGear, steps, catalog, runeIdx, core, mark) {
  base = base || {};
  var st = { pool: clone(base.pool), gearByHero: clone(baseGear) }, un = clone(base.unequipped), rows = [];
  var slotName = function (s) { s = +s || 0; return G && G.GEAR_SLOT_NAMES && G.GEAR_SLOT_NAMES[s] || 'slot ' + s; };
  var heroName = function (id) { id = +id || 0; return String(core && core.heroName ? core.heroName(id) : 'Hero ' + id); };
  function at(h, s) { return st.gearByHero[h] && st.gearByHero[h][s] || null; }
  (steps || []).forEach(function (step) {
    var raw, cost = null, ctx = { heroName: heroName, slotName: slotName, mergeCost: null, dstEmpty: false, srcRune: null, mark: mark }, done = false;
    var isStep = step && typeof step === 'object';
    if (isStep && step.type === 'recycle' && step.srcHero === 0) {
      var n = step.srcRuneName;
      raw = !n ? ['Pick a rune'] : (un[n] || 0) < 1 ? ['No unequipped 0-star ' + n + ' left to return'] : [];
      if (!raw.length) { un[n]--; ensure(st.pool, n)[0]++; }
    } else {
      if (isStep && step.type === 'merge') { var ci = core._ar_advisorMergeCost(catalog, runeIdx, step.runeName, step.dstSlot, step.fromStar, step.toStar); cost = ci ? ci.cost : null; ctx.mergeCost = cost; }
      if (isStep && step.type === 'inherit') { var s0 = at(step.srcHero, step.srcSlot), d0 = at(step.dstHero, step.dstSlot); ctx.srcRune = s0 && s0.runeName || null; ctx.dstEmpty = !(d0 && d0.runeName); }
      if (isStep && (step.type === 'park' || step.type === 'recycle')) { var p0 = at(step.srcHero, step.srcSlot); ctx.srcRune = p0 && p0.runeName || null; }
      raw = core._ar_validateAdvisorStep(step, { pool: st.pool, gearByHero: st.gearByHero, runeIdx: runeIdx, catalog: catalog }) || [];
      done = looksDone(step, baseGear, st.gearByHero);
      try { core._ar_applyAdvisorStep(st, step, catalog, runeIdx); } catch (e) {}
    }
    var reasons = raw.map(function (m) {
      var r = plainReason(m), mm = /^Need (\d+) (.+) s:0 in pool, have (\d+)$/.exec(m);
      if (mm && (un[mm[2]] || 0) > 0) {
        var more = Math.min(un[mm[2]], +mm[1] - +mm[3]);
        r += more === 1 ? ' (1 more is on an unequipped piece)' : ' (' + more + ' more are on unequipped pieces)';
      }
      return r;
    });
    rows.push({ ok: raw.length === 0, reasons: reasons, raw: raw, looksDone: raw.length > 0 && done, text: stepText(step, ctx), note: stepNote(step, ctx), cost: cost });
  });
  return { rows: rows, end: { pool: st.pool, unequipped: un, gearByHero: st.gearByHero } };
}

/* ---------- ticks (per device) ---------- */
function ticks(storage, code, advisorId) {
  var key = 'armory_advice_ticks_' + code + '_' + advisorId;
  function clean(a) { var seen = {}; return (Array.isArray(a) ? a : []).filter(function (n) { return Number.isInteger(n) && n >= 0 && n < 1000 && !seen[n] && (seen[n] = 1); }).sort(function (x, y) { return x - y; }); }
  return {
    key: key,
    get: function () { try { var o = JSON.parse(storage.getItem(key)); if (o && o.v === 1) return clean(o.done); } catch (e) {} return []; },
    set: function (arr) { try { storage.setItem(key, JSON.stringify({ v: 1, done: clean(arr), ts: Date.now() })); } catch (e) {} }
  };
}

/* ---------- pre-flight line for "Ask for rune help" ---------- */
function ago(ts, now) {
  if (!ts) return '';
  var d = Math.max(0, Math.floor(((now || Date.now()) - ts) / 864e5));
  return d < 1 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago';
}
function preflight(o) {
  o = o || {};
  var pool = o.pool || {}, priv = o.privacy || {}, ts = o.supTs || {}, now = o.now;
  var parts = [ts.inv ? 'Inventory imported ' + ago(ts.inv, now) : 'No inventory imported', ts.gear ? 'gear imported ' + ago(ts.gear, now) : 'no gear imported'];
  parts.push(pool.source === 'stored' ? (pool.storedSource === 'manual' ? 'rune pool: hand-entered ' : 'rune pool: saved ') + ago(pool.poolTs, now) : pool.source === 'import' ? 'rune pool: from your import' : 'rune pool: none');
  return {
    line: parts.join(', '),
    warn: priv.inv ? 'Your bag is private: an advisor cannot check it. Change that in Status.' : '',
    stale: !!pool.stale,
    canAsk: !!pool.known
  };
}

/* ---------- links and codes ---------- */
function links(code, shortcode) {
  var c = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''), s = String(shortcode || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return { advise: 'https://2864tw.com/armory-report.html?advise=' + c, player: 'https://2864tw.com/armory-report.html?code=' + s + '&plan=' + c };
}
function normCode(s) { s = String(s == null ? '' : s).trim().toLowerCase(); return /^[a-z0-9]{6}$/.test(s) ? s : ''; }
function isCode(s) { return !!normCode(s); }

/* ========== the screens ========== */
function mount(H) {
var S = H.S, d = H.d, core = H.core, G2 = H.G, BASE = H.BASE, WORKER = H.WORKER, SK_RE = H.SK_RE;
var $ = H.$, $$ = H.$$, esc = H.esc, nm = H.nm, nd = H.nd, ic = H.ic, stars = H.stars, art = H.art, ls = H.ls, toast = H.toast, slug = H.slug;
var A = { steps: [], note: '', savedTs: 0, seeded: null, heroOpen: {}, bld: null, entries: null, rec: {}, open: {}, zero: {}, del: {}, busy: {}, allowed: null, allowedP: null, showAll: false, seenLive: null, ask: null, pick: null, msg: {}, scrolled: false };
var RUNE_ID = /^[A-Za-z0-9:_-]{8,128}$/;
var ST = { open: ['Waiting for an advisor', ''], planned: ['Plan ready', 'pl-go'], applied: ['Done', 'pl-ok'] };

/* ---------- small helpers ---------- */
function rich(text) { /* escaped text; \u0001..\u0002 mark names, numbers get translate="no" */
  return esc(text).replace(/\u0001/g, '<span translate="no">').replace(/\u0002/g, '</span>').replace(/(\d[\d,.]*)/g, '<span translate="no">$1</span>');
}
function mark(x) { return '\u0001' + String(x).replace(/[\u0001\u0002]/g, '') + '\u0002'; }
function ageOf(ts) { ts = +ts; return ts > 0 ? core._ar_advisorRelativeAge(ts) : ''; }
function dayOf(ts) { ts = +ts; if (!(ts > 0)) return ''; var x = new Date(ts); return x.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
function api(path, o) {
  o = o || {};
  var init = { cache: 'no-store', method: o.method || 'GET', headers: {} };
  if (o.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
  if (o.auth) init.headers.Authorization = o.auth;
  return fetch(WORKER + path, init).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); }, function () { return { ok: false, status: 0, j: null }; });
}
function fail(r, what) {
  var e = r.j && r.j.error;
  if (r.status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (e === 'not_allowlisted') return 'You are not on the advisor list.';
  if (e === 'target_not_in_roster') return 'That player is not in the roster.';
  if (e === 'token_required') return 'Verify your UID, then save again.';
  if (e === 'rate_limited' || r.status === 429) return 'Too many tries. Wait a minute, then try again.';
  return d.plainError(r.status, JSON.stringify(r.j || ''), what);
}
function ownAuth(key) { return d.ensureToken(key).then(function () { var t = d.token(); return t ? 'Bearer ' + t : null; }, function () { return null; }); }
function copy(text) {
  function fb() { var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); toast(ok ? 'Link copied' : 'Select the link and copy it by hand'); }
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }, fb); else fb(); } catch (e) { fb(); }
}
function advisorId() {
  var id = d.getStoredIdentity();
  if (id && id.siteKey && !id.guest && SK_RE.test(String(id.siteKey))) return 'sk:' + id.siteKey;
  var cur = ls('armory_advisor_local_id');
  if (cur && RUNE_ID.test(cur)) return cur;
  var a = new Uint8Array(20), al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = ''; crypto.getRandomValues(a);
  for (var i = 0; i < a.length; i++) r += al[a[i] % al.length];
  ls('armory_advisor_local_id', 'a:' + r); return 'a:' + r;
}
function me() { var id = d.getStoredIdentity(); return id && id.siteKey && !id.guest && SK_RE.test(String(id.siteKey)) ? { sk: id.siteKey, name: String(id.name || '').slice(0, 64) } : null; }
function seenLoad() { try { var o = JSON.parse(ls('advisorSeen')); if (o && Array.isArray(o.entries)) return o; } catch (e) {} return { v: 1, entries: [] }; }
function seenSave(o) { ls('advisorSeen', JSON.stringify(o)); }
function seenAdd(e) { var o = seenLoad(); o.entries = o.entries.filter(function (x) { return x.code !== e.code; }); o.entries.unshift(e); if (o.entries.length > 50) o.entries = o.entries.slice(0, 50); seenSave(o); }
function seenDrop(code) { var o = seenLoad(); o.entries = o.entries.filter(function (x) { return x.code !== code; }); seenSave(o); }

/* ---------- data the screens read ---------- */
var CT = null;
function ctx() {
  var st = S.res.statics || {}, cat = st.runeTypes;
  if (!CT || CT.cat !== cat || CT.key !== sk() || CT.merged !== S.res.merged) {
    CT = { cat: cat, key: sk(), merged: S.res.merged, idx: core._ar_advisorRuneTypeIndex(cat), gear: core._ar_advisorBuildBaseGear(S.res.merged, sk()), pieces: null };
  }
  CT.base = S.vm.runes.pool;
  return CT;
}
function sk() { return H.sk(); }
function hname(id) { return String(core.heroName(+id || 0)); }
function sname(s) { return G2.GEAR_SLOT_NAMES[+s] || 'slot ' + s; }
function walkSteps(steps) { var c = ctx(); return walk(c.base, c.gear, steps, c.cat, c.idx, core, mark); }
function runeIcon(n, cls) { return art(BASE + 'rune-icons/' + (G2.RUNE_ICON[n] || slug(n)) + '.png', cls || 'ico q5 ricon', String(n).charAt(0), ''); }
function starMaxFor(name, slot) { var m = ctx().idx[name], se = m && (m.slots || []).filter(function (x) { return x.slot === slot; })[0]; return se ? se.star_max : 0; }
/* unequipped 0-star pieces from the gear supplement: which slot a "return to bag" step points at */
function unequipped() {
  var c = ctx();
  if (c.pieces) return c.pieces;
  var g = S.res.supp && S.res.supp.gear, out = {};
  ((g && g.goldGear) || []).forEach(function (p) {
    if (!p || (p.heroId && p.heroId > 0)) return;
    var r = (p.buffs || []).filter(function (b) { return b && b.type === 'rune'; })[0];
    if (!r) return;
    var rd = r.templateId != null ? G2.resolveRune(+r.templateId) : null, n = rd ? rd.n : r.name, star = r.star != null ? +r.star : rd ? rd.s : 0;
    if (!n || star !== 0 || !(+p.slot >= 1 && +p.slot <= 6)) return;
    (out[n] = out[n] || []).push({ slot: +p.slot, gear: sname(+p.slot) });
  });
  c.pieces = out; return out;
}
function returnStep(name) {
  var used = {}, pcs = unequipped()[name] || [];
  A.steps.forEach(function (s) { if (s && s.type === 'recycle' && s.srcHero === 0 && s.srcRuneName === name) used[s.srcSlot] = (used[s.srcSlot] || 0) + 1; });
  var pick = null;
  pcs.forEach(function (p) { if (!pick && !(used[p.slot] > 0)) pick = p; else if (!pick) used[p.slot]--; });
  if (!pick) { var m = ctx().idx[name], sl = m && m.slots && m.slots[0]; pick = { slot: sl ? sl.slot : 1, gear: sname(sl ? sl.slot : 1) }; }
  return { type: 'recycle', srcHero: 0, srcSlot: pick.slot, srcRuneName: name, srcGearName: pick.gear };
}

/* ---------- one step row ---------- */
function pillHtml(r, i, ticked) {
  if (r.ok || ticked) return '';
  return '<details class="why"><summary><span class="pill">' + (r.looksDone ? 'Looks done' : 'Check') + '</span></summary><p class="t13 muted">' + r.reasons.map(function (x) { return rich(x); }).join('<br>') + '</p></details>';
}
function noteHtml(r) { return r.note ? '<div class="t13 muted">' + rich(r.note) + '</div>' : ''; }
function checkSvg() { return ic('check', 'sm'); }

/* =================================================================== player side */
function loadRec(code) {
  var c = A.rec[code];
  if (c && (c.state === 'ok' || c.state === 'loading')) return;
  A.rec[code] = { state: 'loading' };
  api('/advisor/plan/' + code).then(function (r) {
    A.rec[code] = r.ok && r.j && Array.isArray(r.j.plans) ? { state: 'ok', rec: r.j } : { state: 'err' };
    if (A.rec[code].state === 'ok' && normCode(S.planCode) === code) A.rec[code].rec.plans.forEach(function (p) { if (p && RUNE_ID.test(String(p.advisorId || ''))) A.open[code + '|' + p.advisorId] = true; });
    paintReqs();
  });
}
function planOf(code, aid) {
  var c = A.rec[code]; if (!c || c.state !== 'ok') return null;
  var ps = c.rec.plans.filter(function (p) { return p && (aid == null || p.advisorId === aid); });
  return ps[0] || null;
}
function entryPlans(e) {
  var out = [];
  (Array.isArray(e.plans) ? e.plans : []).forEach(function (p) { if (p && RUNE_ID.test(String(p.advisorId || ''))) out.push({ advisorId: p.advisorId, advisorName: String(p.advisorName || 'An advisor'), stepCount: +p.stepCount || 0, applied: !!p.applied, appliedTs: +p.appliedTs || 0, acceptedCount: +p.acceptedCount || 0 }); });
  if (!out.length) { var c = A.rec[e.code]; if (c && c.state === 'ok') c.rec.plans.forEach(function (p) { if (p && RUNE_ID.test(String(p.advisorId || ''))) out.push({ advisorId: p.advisorId, advisorName: String(p.advisorName || 'An advisor'), stepCount: Array.isArray(p.steps) ? p.steps.length : 0, applied: !!p.applied, appliedTs: +p.appliedTs || 0, acceptedCount: +p.acceptedCount || 0 }); }); }
  return out;
}
function owner() { return !!(S.res.identity && S.res.identity.isOwn && S.res.identity.unlocked && !S.res.readOnly && sk()); }
function checklistHtml(code, pl, ro) {
  var rp = planOf(code, pl.advisorId), c = A.rec[code];
  if (!c || c.state === 'loading') return '<p class="t13 muted">Loading the steps</p>';
  if (!rp) return '<p class="t13 muted">Could not load this plan. Try again in a moment.</p>';
  var steps = Array.isArray(rp.steps) ? rp.steps.slice(0, 100) : [], w = walkSteps(steps), known = ctx().base.known;
  var tk = ticks(localStorage, code, pl.advisorId), done = tk.get().filter(function (i) { return i < steps.length; }), key = code + '|' + pl.advisorId;
  var rows = w.rows.map(function (r, i) {
    var on = done.indexOf(i) >= 0;
    return '<li class="step"><button class="ab tick" type="button" role="checkbox" aria-checked="' + on + '" aria-label="Step ' + (i + 1) + ' done" data-a="tick" data-rc="' + code + '" data-ap="' + esc(pl.advisorId) + '" data-ai="' + i + '">' + (on ? checkSvg() : '') + '</button>' +
      '<div class="step-b"><div class="adv-t' + (on ? ' dn' : '') + '">' + rich(r.text) + '</div>' + noteHtml(r) + (known ? pillHtml(r, i, on) : '') + '</div></li>';
  }).join('');
  var foot = '';
  if (rp.applied) foot = '<p class="t13 muted">Done on ' + nm(dayOf(rp.appliedTs)) + ' (' + nm(String(+rp.acceptedCount || 0)) + ' of ' + nm(String(steps.length)) + ' steps)</p>';
  else if (!ro && owner()) foot = A.zero[key] ? '<p class="t13">You have not ticked any steps. Mark it done anyway?</p><div class="adv-row"><button class="ab" type="button" data-a="zerono" data-rc="' + code + '" data-ap="' + esc(pl.advisorId) + '">Keep checking</button><button class="ab pri" type="button" data-a="done" data-rc="' + code + '" data-ap="' + esc(pl.advisorId) + '" data-az="1">Mark it done</button></div>'
    : '<button class="ab pri wide" type="button" data-a="done" data-rc="' + code + '" data-ap="' + esc(pl.advisorId) + '"' + (A.busy[key] ? ' disabled' : '') + '>Mark plan done</button>' + (A.msg[key] ? '<div class="err" role="alert">' + esc(A.msg[key]) + '</div>' : '');
  else if (!ro) foot = '<button class="ab wide" type="button" data-a="verify">Verify your UID to mark this plan done</button>';
  return (rp.planNote ? '<p class="adv-pnote">' + esc(String(rp.planNote).slice(0, 1000)) + '</p>' : '') + (known ? '' : '<p class="t13 muted">Import your game data, or enter your rune pool, to check these steps against your bag.</p>') + '<ol class="steps">' + (rows || '<li class="muted">This plan has no steps.</li>') + '</ol>' + foot;
}
function reqCard(e, ro) {
  var code = normCode(e.code); if (!code) return '';
  var st = ST[e.status] || ST.open, plans = entryPlans(e), l = links(code, H.currentCode());
  var h = '<section class="card adv-card" data-rc="' + code + '"><div class="adv-h"><span class="pill ' + st[1] + '">' + st[0] + '</span><span class="t12 muted" translate="no">' + esc(ageOf(e.createdTs)) + '</span></div>';
  if (e.onBehalfBy) h += '<div class="t13 muted">Set up by ' + nm(String(e.onBehalfBy).slice(0, 64)) + '</div>';
  if (e.note) h += '<p class="adv-note">' + esc(String(e.note).slice(0, 500)) + '</p>';
  if (!ro) {
    h += '<div class="adv-link"><span class="code" translate="no">' + esc(l.advise) + '</span><button class="ab" type="button" data-a="copy" data-av="' + esc(l.advise) + '">' + ic('copy', 'sm') + 'Copy link</button></div>';
  }
  h += plans.map(function (pl) {
    var key = code + '|' + pl.advisorId, on = !!A.open[key];
    return '<div class="adv-plan"><button class="ab adv-pb" type="button" aria-expanded="' + on + '" data-a="plan" data-rc="' + code + '" data-ap="' + esc(pl.advisorId) + '"><span class="grow"><span translate="no">' + esc(pl.advisorName) + '</span><span class="t13 muted"> ' + nd(plural(pl.stepCount, 'step')) + (pl.applied ? ', done' : '') + '</span></span>' + ic('down', 'sm chev') + '</button>' + (on ? '<div class="adv-open">' + checklistHtml(code, pl, ro) + '</div>' : '') + '</div>';
  }).join('');
  if (!ro) {
    h += A.del[code] ? '<div class="adv-row"><span class="t13 grow">Delete this request and its plans?</span><button class="ab" type="button" data-a="delno" data-rc="' + code + '">Keep</button><button class="ab" type="button" data-a="delyes" data-rc="' + code + '">Delete</button></div>'
      : '<div class="adv-row"><button class="ab" type="button" data-a="del" data-rc="' + code + '">Delete request</button>' + (A.msg[code] ? '<span class="err t13" role="alert">' + esc(A.msg[code]) + '</span>' : '') + '</div>';
  }
  return h + '</section>';
}
function paintReqs() {
  var el = $('#advReqs'); if (!el || !A.entries) return;
  var ro = !!S.res.readOnly || !(S.res.identity && S.res.identity.isOwn);
  var list = A.entries.slice().sort(function (a, b) { return (+b.createdTs || 0) - (+a.createdTs || 0); });
  el.innerHTML = list.length ? list.map(function (e) { return reqCard(e, ro); }).join('') : '<div class="empty">' + (ro ? 'No rune advice requests yet.' : 'No requests yet. Tap Ask for rune help to start one.') + '</div>';
}
function loadEntries(fresh) {
  return H.advIndex(fresh).then(function (r) {
    A.entries = r && r.entries ? r.entries : [];
    var want = normCode(S.planCode);
    if (want && !A.entries.some(function (e) { return normCode(e.code) === want; })) A.entries.unshift({ code: want, status: 'planned', createdTs: 0, plans: [] });
    paintReqs();
    A.entries.forEach(function (e) {
      var code = normCode(e.code); if (!code) return;
      if (want && code === want) { entryPlans(e).forEach(function (pl) { A.open[code + '|' + pl.advisorId] = true; }); if (!entryPlans(e).length) loadRec(code); }
      entryPlans(e).forEach(function (pl) { if (A.open[code + '|' + pl.advisorId]) loadRec(code); });
    });
    if (want) { paintReqs(); var c = $('.adv-card[data-rc="' + want + '"]'); if (c && c.scrollIntoView && !A.scrolled) { A.scrolled = true; setTimeout(function () { c.scrollIntoView({ block: 'start' }); }, 60); } }
  });
}
function askCardHtml() {
  var key = sk(), c = ctx(), g = S.res.supp || {};
  var pf = preflight({ pool: c.base, privacy: S.res.privacy, supTs: { inv: core.advice.tsOf(g.inv), gear: core.advice.tsOf(g.gear) } });
  var btn = !key ? '<p class="t13 muted">Rune advice needs your account. Verify your UID in Status.</p><button class="ab" type="button" data-a="verify">Open Status</button>'
    : !pf.canAsk ? '<p class="t13">Import your game data first, so an advisor can check your bag.</p><button class="ab" type="button" data-a="verify">Open Status</button>'
    : owner() ? '<button class="ab pri" type="button" data-a="ask">Ask for rune help</button>' : '<button class="ab" type="button" data-a="verify">Verify your UID to ask for help</button>';
  return '<section class="card"><h2 class="hd">Rune advice</h2><p class="t13 muted">' + rich(pf.line) + '</p>' + (pf.stale ? '<p class="t13 muted">Your saved rune pool is older than your last import, so it is ignored.</p>' : '') + (pf.warn ? '<p class="t13 c-warn">' + esc(pf.warn) + '</p>' : '') + '<div class="adv-row">' + btn + '</div></section>';
}
function advisorSectionHtml() {
  var seen = seenLoad().entries;
  if (!A.allowed && !seen.length) return '';
  var h = '<section class="card"><h2 class="hd">Advise a player</h2>';
  if (A.allowed) h += '<p class="t13 muted">Build a rune plan for another player from their report and game data.</p><div class="adv-row"><button class="ab pri" type="button" data-a="advise">Advise a player</button></div>';
  h += '<div id="advSeen"></div></section>';
  return h;
}
function paintSeen() {
  var el = $('#advSeen'); if (!el) return;
  var seen = seenLoad().entries;
  if (!seen.length) { el.innerHTML = ''; return; }
  var list = A.showAll ? seen : seen.slice(0, 10);
  var rows = list.map(function (s) {
    var code = normCode(s.code), live = A.seenLive && A.seenLive[code]; if (!code) return '';
    var st = live ? ST[live.status] || ST.open : null;
    return '<a class="adv-seen" href="armory.html?advise=' + code + '"><span class="grow"><span translate="no">' + esc(String(s.playerName || (live && live.playerName) || 'A player').slice(0, 64)) + '</span><span class="t13 muted"> ' + esc(ageOf(s.openedTs)) + '</span></span>' + (st ? '<span class="pill ' + st[1] + '">' + (live.status === 'planned' ? 'Plan saved' : live.status === 'applied' ? 'Applied' : 'No plan yet') + '</span>' : '') + ic('chev', 'sm') + '</a>';
  }).join('');
  el.innerHTML = '<h3 class="sub" style="margin-top:16px">Requests I’ve opened</h3><div>' + rows + '</div>' + (seen.length > 10 && !A.showAll ? '<button class="ab wide" type="button" data-a="showall">Show all <span translate="no">' + seen.length + '</span></button>' : '');
}
function loadSeen() {
  var seen = seenLoad().entries.slice(0, A.showAll ? 50 : 10);
  A.seenLive = A.seenLive || {};
  paintSeen();
  Promise.all(seen.map(function (s) {
    var code = normCode(s.code); if (!code) return null;
    return api('/advisor/request/' + code).then(function (r) { if (r.status === 404) { seenDrop(code); delete A.seenLive[code]; } else if (r.ok && r.j) A.seenLive[code] = { status: String(r.j.status || 'open'), playerName: r.j.playerName }; });
  })).then(paintSeen);
}
function checkAllowed() {
  if (A.allowed !== null || A.allowedP) return A.allowedP || Promise.resolve();
  var m = me();
  if (!m || !(S.res.identity && S.res.identity.unlocked)) { A.allowed = false; return Promise.resolve(); }
  A.allowedP = ownAuth(m.sk).then(function (au) { return au ? api('/advisor/allowlist/check', { auth: au }) : { ok: false }; }).then(function (r) { A.allowed = !!(r.ok && r.j && r.j.allowed); A.allowedP = null; });
  return A.allowedP;
}
function renderPlayer(root, q) {
  var ro = !!S.res.readOnly || !(S.res.identity && S.res.identity.isOwn), key = sk();
  if (!key) { root.innerHTML = '<div class="vb-in"><section class="card"><h2 class="hd">Rune advice</h2>' + (ro ? '<p class="muted">Advice is not available for this player.</p>' : '<p class="muted">Rune advice needs a verified account. Open Status to verify your UID.</p><div class="adv-row"><button class="ab" type="button" data-a="verify">Open Status</button></div>') + '</section></div>'; return; }
  var left = ro ? '<section class="card"><h2 class="hd"><span translate="no">' + esc(H.stateName()) + '</span>’s rune advice</h2><p class="t13 muted">Read-only. Steps are checked against this player’s bag.</p></section>' : askCardHtml();
  root.innerHTML = '<div class="ov"><div class="ov-col">' + left + '<h2 class="sub">' + (ro ? 'Requests' : 'My requests') + '</h2><div id="advReqs"><div class="skel" style="width:60%"></div></div></div><div class="ov-col">' + (ro ? '' : '<div id="advSec"></div>') + '</div></div>';
  if (A.entries) paintReqs();
  loadEntries(!!A.entries);
  if (!ro) checkAllowed().then(function () { var el = $('#advSec'); if (el) { el.innerHTML = advisorSectionHtml(); if (el.innerHTML) loadSeen(); } });
}

/* =================================================================== advisor side */
function advBase() { return ctx().base; }
function repaintAdvise() {
  var root = $('#adviceBody'); if (!root || !S.advise) return;
  var c = ctx(), w = walkSteps(A.steps), end = w.end, bad = w.rows.filter(function (r) { return !r.ok; }).length, req = S.advise.req || {}, name = H.stateName() || 'this player';
  var pf = S.res.privacy && S.res.privacy.inv, known = c.base.known;
  /* pool card */
  var bagChips = Object.keys(end.pool).filter(function (n) { return end.pool[n][0] > 0; }).sort().map(function (n) { return '<span class="pchip">' + runeIcon(n) + '<span translate="no">' + esc(n) + '</span><b translate="no">' + (+end.pool[n][0]) + '</b></span>'; }).join('');
  var uneq = Object.keys(end.unequipped).filter(function (n) { return end.unequipped[n] > 0; }).sort().map(function (n) { return '<button class="ab pchip" type="button" data-a="ret" data-an="' + esc(n) + '">' + runeIcon(n) + '<span translate="no">' + esc(n) + '</span><b translate="no">' + (+end.unequipped[n]) + '</b><span class="t12 muted">Return to bag</span></button>'; }).join('');
  var upg = []; Object.keys(c.base.upgraded).sort().forEach(function (n) { Object.keys(c.base.upgraded[n]).forEach(function (s) { upg.push('<span class="pchip muted">' + runeIcon(n) + '<span translate="no">' + esc(n) + '</span><span translate="no">' + (+s) + '-star x ' + (+c.base.upgraded[n][s]) + '</span></span>'); }); });
  var warn = !known ? '<p class="t13 c-warn">' + (pf ? nm(name) + '’s bag is private, so place and merge steps cannot be checked.' : nm(name) + ' has not sent a bag yet, so place and merge steps cannot be checked.') + '</p>' : '';
  var pool = '<section class="card" style="order:1"><h2 class="hd">Rune pool</h2>' + warn + '<div class="lab">In the bag</div><div class="pchips">' + (bagChips || '<span class="t13 muted">Nothing in the bag</span>') + '</div><div class="lab" style="margin-top:12px">On unequipped gear</div><div class="pchips">' + (uneq || '<span class="t13 muted">None you can return</span>') + '</div>' + (upg.length ? '<div class="lab" style="margin-top:12px">Upgraded, cannot be returned</div><div class="pchips">' + upg.join('') + '</div>' : '') + '</section>';
  /* steps */
  var rows = w.rows.map(function (r, i) {
    return '<li class="step"><span class="step-n" translate="no">' + (i + 1) + '</span><div class="step-b"><div class="adv-t">' + rich(r.text) + '</div>' + noteHtml(r) + (known ? pillHtml(r, i, false) : '') +
      '<div class="step-ctl"><button class="ab" type="button" data-a="up" data-ai="' + i + '" aria-label="Move step ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ic('down', 'sm rot') + '</button><button class="ab" type="button" data-a="dn" data-ai="' + i + '" aria-label="Move step ' + (i + 1) + ' down"' + (i === w.rows.length - 1 ? ' disabled' : '') + '>' + ic('down', 'sm') + '</button><button class="ab" type="button" data-a="rm" data-ai="' + i + '" aria-label="Remove step ' + (i + 1) + '">' + ic('x', 'sm') + '</button></div></div></li>';
  }).join('');
  var link = links(S.advise.code, S.code), savedBox = A.savedTs ? '<div class="adv-saved"><div class="t13" role="status">Saved <span translate="no">' + esc(new Date(A.savedTs).toLocaleTimeString()) + '</span></div><div class="t13 muted">Send this link to ' + nm(name) + ':</div><div class="adv-link"><span class="code" translate="no">' + esc(link.player) + '</span><button class="ab" type="button" data-a="copy" data-av="' + esc(link.player) + '">' + ic('copy', 'sm') + 'Copy link</button></div></div>' : '';
  var steps = '<section class="card" style="order:3"><h2 class="hd">Plan steps</h2>' + (rows ? '<ol class="steps">' + rows + '</ol>' : '<p class="t13 muted">No steps yet. Tap a piece in the list to add the first one.</p>') + '</section>';
  var note = '<section class="card" style="order:4"><label class="lab" for="advNote">Note for ' + nm(name) + ' (optional)</label><textarea class="fld" id="advNote" data-a="note" maxlength="1000" rows="3" style="font-family:var(--sans);font-size:var(--fs-14)">' + esc(A.note) + '</textarea>' +
    (bad ? '<p class="t13 c-warn" style="margin-top:8px">' + nm(String(bad)) + (bad === 1 ? ' step cannot be done as written.' : ' steps cannot be done as written.') + ' You can still save.</p>' : '') +
    '<div class="adv-row" style="margin-top:12px"><button class="ab pri wide" type="button" data-a="save"' + (A.busy.save ? ' disabled' : '') + '>Save plan</button></div>' + (A.msg.save ? '<div class="err" role="alert">' + esc(A.msg.save) + '</div>' : '') + savedBox + '</section>';
  var head = '<section class="card"><h2 class="hd">Advising <span translate="no">' + esc(name) + '</span></h2>' + (req.note ? '<p class="adv-note">' + esc(String(req.note).slice(0, 500)) + '</p>' : '') + '<p class="t13 muted">Asked <span translate="no">' + esc(ageOf(req.createdTs) || 'recently') + '</span></p></section>';
  var sc = $('#adviceBody') ? window.scrollY : 0;
  root.innerHTML = '<div class="ov"><div class="ov-col">' + head + pool + steps + note + '</div><div class="ov-col">' + galleryHtml(end) + '</div></div>';
  window.scrollTo(0, sc);
}
function slotTile(h, s, cur, base) {
  var was = base && base[h] && base[h][s], chg = (cur && cur.runeName) !== (was && was.runeName) || (cur && was && cur.star !== was.star);
  var n = cur && cur.runeName, mx = n ? starMaxFor(n, s) : 0;
  var label = hname(h) + ', ' + sname(s) + ': ' + (n ? n + ', ' + (+cur.star || 0) + ' stars' : 'empty');
  return '<button class="tile' + (chg ? ' chg' : '') + '" type="button" data-a="slot" data-ah="' + (+h) + '" data-as="' + (+s) + '" aria-label="' + esc(label) + '">' + (n ? runeIcon(n, 'ico q5 tico') : art(BASE + 'titan-slot-icons/gear_' + (+s) + '.png', 'ico tico', String(s), '')) +
    '<span class="tt"><span class="tn" translate="no">' + esc(sname(s)) + '</span>' + (n ? '<span class="tr" translate="no">' + esc(n) + '</span>' + (mx ? stars(+cur.star || 0, mx) : '') : '<span class="tr muted">Empty</span>') + '</span></button>';
}
function galleryHtml(end) {
  var c = ctx(), base = c.gear, groups = S.res.marchGroups, ids = Object.keys(base).filter(function (h) { return +h > 0 && Object.keys(base[h] || {}).length; }).map(Number);
  var used = {}, out = '';
  function hero(h) {
    var g = end.gearByHero[h] || {}, slots = Object.keys(base[h] || {}).map(Number).sort(), nm2 = hname(h), open = !!A.heroOpen[h];
    var chg = slots.filter(function (s) { var a = g[s], b = base[h][s]; return (a && a.runeName) !== (b && b.runeName) || (a && b && a.star !== b.star); }).length;
    return '<article class="hero' + (open ? ' open' : '') + '"><button class="hrow" type="button" aria-expanded="' + open + '" data-a="hero" data-ah="' + h + '">' + art(ArmoryVM.heroIcon(h), 'por', nm2.charAt(0), '') + '<span class="hb"><span class="hb-1"><span class="hb-n" translate="no">' + esc(nm2) + '</span></span><span class="hb-2" style="display:block">' + nd(slots.length + ' gold pieces') + (chg ? ' · ' + nd(chg + ' changed') : '') + '</span></span>' + ic('down', 'chev') + '</button><div class="panel"><div><div class="slot-tiles">' + slots.map(function (s) { return slotTile(h, s, g[s] || null, base); }).join('') + '</div></div></div></article>';
  }
  if (Array.isArray(groups)) groups.slice(0, 12).forEach(function (m) {
    var hs = (m && Array.isArray(m.heroIds) ? m.heroIds : []).map(Number).filter(function (h) { return ids.indexOf(h) >= 0 && !used[h]; });
    if (!hs.length) return;
    hs.forEach(function (h) { used[h] = 1; });
    out += '<h3 class="sub" translate="no">' + esc(String(m.name || 'March').slice(0, 40)) + '</h3>' + hs.map(hero).join('');
  });
  var rest = ids.filter(function (h) { return !used[h]; }).sort(function (a, b) { return hname(a) < hname(b) ? -1 : 1; });
  if (rest.length) out += (out ? '<h3 class="sub">Other heroes</h3>' : '') + rest.map(hero).join('');
  return '<section style="order:2"><h2 class="hd">Heroes</h2>' + (out || '<div class="empty">No gold gear found for this player.</div>') + '</section>';
}
function seed() {
  if (A.seeded === S.advise.code) return Promise.resolve();
  A.seeded = S.advise.code;
  var req = S.advise.req || {};
  seenAdd({ code: S.advise.code, openedTs: Date.now(), playerName: H.stateName() || req.playerName || '', hidden: false });
  return api('/advisor/plan/' + S.advise.code + '?advisorId=' + encodeURIComponent(advisorId())).then(function (r) {
    var p = r.ok && r.j && Array.isArray(r.j.plans) ? r.j.plans[0] : null;
    if (p && Array.isArray(p.steps)) { A.steps = p.steps.filter(function (s) { return s && typeof s === 'object' && typeof s.type === 'string'; }).slice(0, 100); A.note = typeof p.planNote === 'string' ? p.planNote.slice(0, 1000) : ''; A.savedTs = +p.ts || 0; }
  });
}
function addStep(step) { A.steps.push(step); A.savedTs = 0; A.msg.save = ''; H.closeSheet(); repaintAdvise(); toast('Step added'); }
function save() {
  if (A.busy.save) return;
  var m = me(), code = S.advise.code;
  var body = { advisorId: advisorId(), advisorName: m && m.name ? m.name : 'An advisor', planNote: A.note.slice(0, 1000), steps: A.steps, wantEditKey: true };
  var ek = ls('advisor_editkey_' + code); if (ek && /^[0-9a-f]{32}$/.test(ek)) body.editKey = ek;
  A.busy.save = true; A.msg.save = ''; repaintAdvise();
  (m ? ownAuth(m.sk) : Promise.resolve(null)).then(function (au) { return api('/advisor/plan/' + code, { method: 'POST', body: body, auth: au }); }).then(function (r) {
    A.busy.save = false;
    if (r.ok) { if (r.j && typeof r.j.editKey === 'string' && /^[0-9a-f]{32}$/.test(r.j.editKey)) ls('advisor_editkey_' + code, r.j.editKey); A.savedTs = +(r.j && r.j.ts) || Date.now(); A.msg.save = ''; }
    else A.msg.save = r.status === 403 && !(r.j && r.j.error === 'token_required') ? 'This plan was saved by someone else, so it cannot be changed from here.' : fail(r, 'save plan');
    repaintAdvise();
  });
}
function renderAdvise(root, soft) {
  if (!soft || !$('#advNote')) seed().then(repaintAdvise); else repaintAdvise();
}

/* ---------- the step builder sheet ---------- */
function gearEnd() { return walkSteps(A.steps).end.gearByHero; }
function builderBody() {
  var b = A.bld, g = gearEnd(), cur = g[b.h] && g[b.h][b.s] || null, n = cur && cur.runeName, star = cur ? +cur.star || 0 : 0, mx = n ? starMaxFor(n, b.s) : 0;
  var end = walkSteps(A.steps).end, base = ctx().gear;
  var head = '<p class="t13 muted">' + (n ? 'Holds ' + nm(n) + ', ' + nd(star + (mx ? ' of ' + mx + ' stars' : star === 1 ? ' star' : ' stars')) : 'This piece is empty.') + '</p>';
  var verbs = n ? [['merge', 'Merge to more stars', star < mx], ['swap', 'Swap with another hero', true], ['park', 'Move to a spare piece', true], ['ret', 'Return to bag', star === 0]] : [['place', 'Place from bag', true], ['swapin', 'Swap in from another hero', true]];
  var h = head + '<div class="vlist">' + verbs.filter(function (v) { return v[2]; }).map(function (v) {
    var on = b.verb === v[0];
    return '<button class="ab vrow" type="button" aria-expanded="' + on + '" data-a="verb" data-av="' + v[0] + '"><span class="grow">' + v[1] + '</span>' + ic('chev', 'sm') + '</button>' + (on ? '<div class="vopts">' + verbOpts(v[0], g, end, cur, base) + '</div>' : '');
  }).join('') + '</div>';
  return h;
}
function verbOpts(v, g, end, cur, base) {
  var b = A.bld, c = ctx(), o = '';
  if (v === 'place') {
    var list = (c.cat && c.cat.runes || []).filter(function (r) { return (r.slots || []).some(function (x) { return x.slot === b.s; }); });
    o = list.map(function (r) { var have = end.pool[r.name] ? +end.pool[r.name][0] || 0 : 0; return '<button class="ab vrow" type="button" data-a="pick" data-an="' + esc(r.name) + '">' + runeIcon(r.name, 'ico q5 ricon') + '<span class="grow" translate="no">' + esc(r.name) + '</span><span class="t13 muted" translate="no">' + have + ' in bag</span></button>'; }).join('');
  } else if (v === 'merge') {
    var mx = starMaxFor(cur.runeName, b.s), have = end.pool[cur.runeName] ? +end.pool[cur.runeName][0] || 0 : 0;
    for (var t = (+cur.star || 0) + 1; t <= mx; t++) {
      var ci = core._ar_advisorMergeCost(c.cat, c.idx, cur.runeName, b.s, +cur.star || 0, t);
      o += '<button class="ab vrow" type="button" data-a="pick" data-at="' + t + '"><span class="grow">To ' + nd(plural(t, 'star')) + '</span><span class="t13 ' + (ci && have >= ci.cost ? 'muted' : 'c-warn') + '">' + nd('uses ' + (ci ? ci.cost : '?') + ', you have ' + have) + '</span></button>';
    }
  } else if (v === 'swap' || v === 'swapin') {
    Object.keys(base).map(Number).filter(function (x) { return x !== b.h && Object.prototype.hasOwnProperty.call(base[x], b.s); }).sort(function (x, y) { return hname(x) < hname(y) ? -1 : 1; }).forEach(function (x) {
      var r = g[x] && g[x][b.s];
      if (v === 'swapin' && !(r && r.runeName)) return;
      o += '<button class="ab vrow" type="button" data-a="pick" data-ao="' + x + '"><span class="grow" translate="no">' + esc(hname(x)) + '</span><span class="t13 muted" translate="no">' + esc(r && r.runeName ? r.runeName : 'empty') + '</span></button>';
    });
  }
  return o || '<p class="t13 muted">Nothing to pick here.</p>';
}
function sheet(kind, arg) {
  if (kind === 'advice-builder') {
    arg = arg || {}; var h = +arg.h, s = +arg.s;
    if (!(h > 0) || !(s >= 1 && s <= 6) || !ctx().gear[h] || !Object.prototype.hasOwnProperty.call(ctx().gear[h], s)) return null;
    A.bld = { h: h, s: s, verb: '' };
    return [hname(h) + '’s ' + sname(s), builderBody(), true];
  }
  if (kind === 'advice-pick') { A.pick = { q: '', busy: false, err: '', step: 'pick' }; return ['Advise a player', pickBody()]; }
  if (kind === 'advice-ask') { A.ask = A.ask && A.ask.code ? A.ask : { note: '', busy: false, err: '' }; return ['Ask for rune help', askBody()]; }
  return null;
}
function pickVerb(v) {
  var b = A.bld, g = gearEnd(), cur = g[b.h] && g[b.h][b.s] || null, n = cur && cur.runeName;
  if (v === 'park') { addStep({ type: 'park', srcHero: b.h, srcSlot: b.s, srcRuneName: n, srcRuneStar: +cur.star || 0, srcGearName: sname(b.s) }); return; }
  if (v === 'ret') { addStep({ type: 'recycle', srcHero: b.h, srcSlot: b.s, srcRuneName: n, srcGearName: sname(b.s) }); return; }
  b.verb = b.verb === v ? '' : v; $('#sheetB').innerHTML = builderBody();
}
function pickOpt(t) {
  var b = A.bld, g = gearEnd(), cur = g[b.h] && g[b.h][b.s] || null, ds = t.dataset;
  if (b.verb === 'place' && ds.an && ctx().idx[ds.an]) addStep({ type: 'place', runeName: ds.an, dstHero: b.h, dstSlot: b.s });
  else if (b.verb === 'merge' && ds.at && cur) addStep({ type: 'merge', runeName: cur.runeName, dstHero: b.h, dstSlot: b.s, fromStar: +cur.star || 0, toStar: +ds.at });
  else if (b.verb === 'swap' && ds.ao) addStep({ type: 'inherit', srcHero: b.h, srcSlot: b.s, dstHero: +ds.ao, dstSlot: b.s });
  else if (b.verb === 'swapin' && ds.ao) addStep({ type: 'inherit', srcHero: +ds.ao, srcSlot: b.s, dstHero: b.h, dstSlot: b.s });
}

/* ---------- Advise a player ---------- */
function pickBody() {
  var p = A.pick;
  if (p.step === 'report') return '<p>' + nm(p.name) + ' has no saved report yet. Enter a Battle Report ID that includes ' + nm(p.name) + '.</p><div class="irow"><input class="fld" id="advRid" type="text" inputmode="numeric" autocomplete="off" placeholder="Battle Report ID" aria-label="Battle Report ID"><button class="ab pri" type="button" data-a="pickrid">Use report</button></div><div class="err" role="alert">' + esc(p.err) + '</div>';
  if (p.busy) return '<p class="muted" role="status">' + esc(p.status || 'Working') + '</p>';
  var q = p.q.trim().toLowerCase(), me2 = me(), rows = '';
  if (q.length >= 2 && !p.roster) rows = '<p class="t13 muted">Loading the roster</p>';
  if (q.length >= 2 && p.roster) {
    var n = 0;
    Object.keys(p.roster).forEach(function (k) { var r = p.roster[k]; if (n >= 30 || !SK_RE.test(k) || (me2 && k === me2.sk) || !r || String(r.name || '').toLowerCase().indexOf(q) < 0) return; n++; rows += '<button class="ab vrow" type="button" data-a="target" data-sk="' + k + '"><span class="grow" translate="no">' + esc(String(r.name || '')) + '</span><span class="t13 muted" translate="no">' + esc(String(r.alliance || '')) + '</span></button>'; });
    if (!rows) rows = '<p class="t13 muted">No player matches that name.</p>';
  }
  return '<label class="lab" for="advQ">Search the roster</label><input class="fld" id="advQ" type="search" autocomplete="off" placeholder="Type 2 or more letters" aria-label="Search the roster" value="' + esc(p.q) + '"><div class="vlist" id="advRows">' + (q.length >= 2 ? rows : '<p class="t13 muted">Type at least 2 letters.</p>') + '</div>' + (p.err ? '<div class="err" role="alert">' + esc(p.err) + '</div><button class="ab" type="button" data-a="again">Start again</button>' : '');
}
function setPick(upd) { Object.keys(upd).forEach(function (k) { A.pick[k] = upd[k]; }); var el = $('#sheetB'); if (el && S.sheet === 'advice-pick') el.innerHTML = pickBody(); }
function startAdvise(targetSk) {
  var m = me(), p = A.pick; if (!m || p.busy) return;
  setPick({ busy: true, status: 'Opening the player’s armory', err: '' });
  ownAuth(m.sk).then(function (au) { if (!au) throw { msg: 'Verify your UID, then try again.' }; return api('/advisor/delegate', { method: 'POST', body: { targetSiteKey: targetSk }, auth: au }); }).then(function (r) {
    if (!r.ok || !r.j || typeof r.j.token !== 'string') throw { msg: fail(r, 'start advising') };
    p.d1 = r.j.token; p.target = targetSk; p.name = String(r.j.targetName || (p.roster[targetSk] && p.roster[targetSk].name) || 'this player').slice(0, 64);
    return api('/report-configs', { method: 'POST', body: { siteKey: targetSk } });
  }).then(function (r) {
    var cf = r.ok && r.j && Array.isArray(r.j.configs) ? r.j.configs.filter(function (c) { return c && /^[0-9A-Za-z]{4}$/.test(String(c.shortcode || '')); }) : [];
    cf.sort(function (a, b) { return new Date(b.updatedAt || b.date || 0).getTime() - new Date(a.updatedAt || a.date || 0).getTime(); });
    if (cf.length) return String(cf[0].shortcode).toUpperCase();
    setPick({ busy: false, step: 'report', err: '' }); return null;
  }).then(function (sc) { if (sc) return finishAdvise(sc); }, function (e) { setPick({ busy: false, step: 'pick', err: e && e.msg ? e.msg : 'Could not start. Check your connection and try again.' }); });
}
function finishAdvise(sc) {
  var p = A.pick, m = me();
  setPick({ busy: true, status: 'Creating the advice link', err: '' });
  return api('/advisor/request', { method: 'POST', body: { reportShortcode: sc, note: 'Set up by ' + (m && m.name ? m.name : 'an advisor') }, auth: 'Bearer ' + p.d1 }).then(function (r) {
    if (!r.ok || !r.j || !normCode(r.j.code)) throw { msg: fail(r, 'advice request') };
    p.d1 = null;
    location.href = 'armory.html?advise=' + normCode(r.j.code);
  }, function () { throw { msg: 'Could not reach the server. Check your connection and try again.' }; }).catch(function (e) { setPick({ busy: false, step: 'pick', err: e && e.msg ? e.msg : 'Could not start.' }); });
}
function useReport() {
  var p = A.pick, id = (($('#advRid') || {}).value || '').trim();
  if (!/^\d{10,25}$/.test(id)) { setPick({ err: 'Enter a valid numeric report ID (10 to 25 digits).' }); return; }
  setPick({ busy: true, status: 'Checking the report', err: '' });
  d.fetchReportResponse(id).then(function (r) { if (!r || !r.ok) throw { msg: 'Report not found. Check the ID and try again.' }; return r.json(); }).then(function (data) {
    var ex = data && data.battle && d.extractPlayerData(data, p.name);
    if (!ex) throw { msg: 'That report does not include ' + p.name + '.' };
    return api('/report-config', { method: 'POST', auth: 'Bearer ' + p.d1, body: { siteKey: p.target, playerName: p.name, deviceId: H.deviceId(), reportIds: id, marchGroups: [] } });
  }).then(function (r) {
    if (!r.ok || !r.j || !/^[0-9A-Za-z]{4}$/.test(String(r.j.shortcode || ''))) throw { msg: fail(r, 'save report') };
    return finishAdvise(String(r.j.shortcode).toUpperCase());
  }).catch(function (e) { setPick({ busy: false, step: 'report', err: e && e.msg ? e.msg : 'Could not read that report. Check your connection and try again.' }); });
}

/* ---------- Ask for rune help ---------- */
function askBody() {
  var a = A.ask, c = ctx(), g = S.res.supp || {}, pf = preflight({ pool: c.base, privacy: S.res.privacy, supTs: { inv: core.advice.tsOf(g.inv), gear: core.advice.tsOf(g.gear) } });
  if (a.code) {
    var l = links(a.code, a.shortcode);
    return '<p>Your request is ready. Send this link to your advisor:</p><div class="adv-link"><span class="code" translate="no">' + esc(l.advise) + '</span><button class="ab" type="button" data-a="copy" data-av="' + esc(l.advise) + '">' + ic('copy', 'sm') + 'Copy link</button></div><button class="ab wide" type="button" data-close>Done</button>';
  }
  return '<p class="t13 muted">' + rich(pf.line) + '</p>' + (pf.warn ? '<p class="t13 c-warn">' + esc(pf.warn) + '</p>' : '') + '<label class="lab" for="advAskNote">What do you want help with? (optional)</label><textarea class="fld" id="advAskNote" data-a="asknote" maxlength="500" rows="3" style="font-family:var(--sans);font-size:var(--fs-14)">' + esc(a.note) + '</textarea>' +
    '<button class="ab pri wide" type="button" data-a="askgo"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Sending' : 'Send request') + '</button>' + (a.err ? '<div class="err" role="alert">' + esc(a.err) + '</div>' : '');
}
function setAsk(upd) { Object.keys(upd).forEach(function (k) { A.ask[k] = upd[k]; }); var el = $('#sheetB'); if (el && S.sheet === 'advice-ask') el.innerHTML = askBody(); }
function askGo() {
  var a = A.ask, key = sk(); if (a.busy || !key) return;
  var note = (($('#advAskNote') || {}).value || a.note || '').slice(0, 500);
  setAsk({ busy: true, err: '', note: note });
  var shortcode = H.currentCode();
  var need = shortcode ? Promise.resolve(shortcode) : new Promise(function (res, rej) {
    if (!H.savedReport()) { rej({ msg: 'Build your armory from a battle report first, so your advisor has a report to open.' }); return; }
    H.more(function (mm) { mm.saveConfig().then(res, function (e) { rej({ msg: e && e.message ? e.message : 'Could not save your report link.' }); }); });
  });
  need.then(function (sc) { shortcode = sc; return ownAuth(key); }).then(function (au) {
    if (!au) throw { msg: 'Verify your UID, then try again.' };
    return api('/advisor/request', { method: 'POST', body: { reportShortcode: shortcode, note: note }, auth: au });
  }).then(function (r) {
    if (!r.ok || !r.j || !normCode(r.j.code)) throw { msg: fail(r, 'advice request') };
    setAsk({ busy: false, code: normCode(r.j.code), shortcode: shortcode });
    loadEntries(true);
  }).catch(function (e) { setAsk({ busy: false, err: e && e.msg ? e.msg : 'Could not send the request. Check your connection and try again.' }); });
}
function markDone(code, aid, force) {
  var key = code + '|' + aid, done = ticks(localStorage, code, aid).get();
  if (A.busy[key]) return;
  if (!done.length && !force) { A.zero[key] = true; paintReqs(); return; }
  A.zero[key] = false; A.busy[key] = true; A.msg[key] = ''; paintReqs();
  ownAuth(sk()).then(function (au) { if (!au) throw { msg: 'Verify your UID, then try again.' }; return api('/advisor/plan/' + code + '/apply', { method: 'POST', body: { advisorId: aid, acceptedCount: done.length }, auth: au }); }).then(function (r) {
    if (!r.ok) throw { msg: fail(r, 'apply plan') };
    A.busy[key] = false; A.rec[code] = null; toast('Marked done'); loadRec(code); return loadEntries(true);
  }).catch(function (e) { A.busy[key] = false; A.msg[key] = e && e.msg ? e.msg : 'Could not mark it done.'; paintReqs(); });
}
function delReq(code) {
  var key = sk(); A.msg[code] = '';
  ownAuth(key).then(function (au) { if (!au) throw { msg: 'Verify your UID, then try again.' }; return api('/advisor/request/' + code, { method: 'DELETE', auth: au }); }).then(function (r) {
    if (!r.ok && r.status !== 404) throw { msg: fail(r, 'delete request') };
    A.del[code] = false; toast('Request deleted'); return loadEntries(true);
  }).catch(function (e) { A.del[code] = false; A.msg[code] = e && e.msg ? e.msg : 'Could not delete it.'; paintReqs(); });
}

/* ---------- events ---------- */
function onClick(e) {
  var t = e.target.closest('[data-a]'); if (!t) return;
  var a = t.dataset.a, ds = t.dataset;
  if (a === 'tick') { var code = normCode(ds.rc), tk = ticks(localStorage, code, ds.ap), cur = tk.get(), i = +ds.ai, ix = cur.indexOf(i); if (ix >= 0) cur.splice(ix, 1); else cur.push(i); tk.set(cur); A.zero[code + '|' + ds.ap] = false; paintReqs(); return; }
  if (a === 'plan') { var c2 = normCode(ds.rc), k = c2 + '|' + ds.ap; A.open[k] = !A.open[k]; if (A.open[k]) loadRec(c2); paintReqs(); return; }
  if (a === 'copy') { copy(ds.av); return; }
  if (a === 'verify') { H.openSheet('status'); return; }
  if (a === 'ask') { A.ask = { note: '', busy: false, err: '' }; H.openSheet('advice-ask'); return; }
  if (a === 'done') { markDone(normCode(ds.rc), ds.ap, !!ds.az); return; }
  if (a === 'zerono') { A.zero[normCode(ds.rc) + '|' + ds.ap] = false; paintReqs(); return; }
  if (a === 'del') { A.del[normCode(ds.rc)] = true; paintReqs(); return; }
  if (a === 'delno') { A.del[normCode(ds.rc)] = false; paintReqs(); return; }
  if (a === 'delyes') { delReq(normCode(ds.rc)); return; }
  if (a === 'advise') { H.openSheet('advice-pick'); d.getRosterMap().then(function (m) { if (A.pick) { setPick({ roster: m }); var q = $('#advQ'); if (q) q.focus(); } }, function () { setPick({ err: 'Could not load the roster. Try again.' }); }); return; }
  if (a === 'showall') { A.showAll = true; loadSeen(); return; }
  if (a === 'hero') { var h = +ds.ah; A.heroOpen[h] = !A.heroOpen[h]; var art2 = t.closest('.hero'); art2.classList.toggle('open', !!A.heroOpen[h]); t.setAttribute('aria-expanded', A.heroOpen[h] ? 'true' : 'false'); return; }
  if (a === 'slot') { H.openSheet('advice-builder', { h: +ds.ah, s: +ds.as }); return; }
  if (a === 'ret') { var n = ds.an; if (ctx().idx[n]) { A.steps.push(returnStep(n)); A.savedTs = 0; repaintAdvise(); toast('Step added'); } return; }
  if (a === 'up' || a === 'dn' || a === 'rm') {
    var j = +ds.ai, st = A.steps;
    if (a === 'rm') st.splice(j, 1); else { var k2 = a === 'up' ? j - 1 : j + 1; if (k2 < 0 || k2 >= st.length) return; var x = st[j]; st[j] = st[k2]; st[k2] = x; }
    A.savedTs = 0; repaintAdvise();
    if (a !== 'rm') { var nb = $('#adviceBody [data-a="' + a + '"][data-ai="' + (a === 'up' ? j - 1 : j + 1) + '"]'); if (nb && !nb.disabled) nb.focus({ preventScroll: true }); }
    return;
  }
  if (a === 'save') { save(); return; }
  if (a === 'verb') { pickVerb(ds.av); return; }
  if (a === 'pick') { pickOpt(t); return; }
  if (a === 'target') { if (SK_RE.test(ds.sk || '')) startAdvise(ds.sk); return; }
  if (a === 'again') { setPick({ err: '', busy: false, step: 'pick' }); return; }
  if (a === 'pickrid') { useReport(); return; }
  if (a === 'askgo') { askGo(); return; }
}
function onInput(e) {
  var t = e.target;
  if (t.id === 'advNote') A.note = t.value.slice(0, 1000);
  else if (t.id === 'advAskNote' && A.ask) A.ask.note = t.value.slice(0, 500);
  else if (t.id === 'advQ' && A.pick) { A.pick.q = t.value; var rows = $('#advRows'); if (rows) { var div = document.createElement('div'); div.innerHTML = pickBody(); var nr = div.querySelector('#advRows'); if (nr) rows.innerHTML = nr.innerHTML; } }
}
function onKey(e) { if (e.key === 'Enter' && e.target.id === 'advRid') { e.preventDefault(); useReport(); } }

/* ---------- entry ---------- */
function injectStyle() {
  if ($('#advice-style')) return;
  var st = document.createElement('style'); st.id = 'advice-style';
  st.textContent = STYLE; document.head.appendChild(st);
}
function render(q, soft) {
  var root = $('#adviceBody'); if (!root || !S.res) return;
  q = q || {};
  if (q.plan && !S.planCode && normCode(q.plan)) S.planCode = normCode(q.plan);
  if (!soft || !root.firstChild) root.innerHTML = '<div class="skel" style="width:50%"></div>';
  if (S.advise) { renderAdvise(root, soft); return; }
  renderPlayer(root, q);
}
injectStyle();
var pane = $('#v-heroes'); if (pane) { pane.addEventListener('click', onClick); pane.addEventListener('input', onInput); pane.addEventListener('keydown', onKey); }
var sb = $('#sheetB'); if (sb) { sb.addEventListener('click', onClick); sb.addEventListener('input', onInput); sb.addEventListener('keydown', onKey); }
return { render: render, sheet: sheet };
}

var STYLE = [
'.vb-in{display:flex;flex-direction:column;gap:16px}',
'.ab{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--card);font-size:var(--fs-14);font-weight:600;color:var(--text);text-decoration:none;text-align:center;transition:background var(--t)}',
'.ab:hover,.ab:active{background:var(--card-hi)}.ab[disabled]{opacity:.45;cursor:default}',
'.ab.pri{background:var(--card-hi);border-color:var(--accent);color:var(--accent)}.ab.wide{width:100%}',
'.grow{flex:1;min-width:0;text-align:left}',
'.adv-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}',
'.adv-card > * + *{margin-top:12px}.adv-h{display:flex;align-items:center;justify-content:space-between;gap:8px}',
'.adv-note,.adv-pnote{font-size:var(--fs-14);overflow-wrap:anywhere;white-space:pre-wrap}',
'.adv-link{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.adv-link .code{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--muted)}',
'.pill.pl-go{color:var(--accent);background:rgba(121,192,255,.12)}.pill.pl-ok{color:var(--ok);background:rgba(63,185,80,.12)}',
'.adv-plan{border-top:1px solid var(--rule);padding-top:12px}.adv-pb{width:100%;justify-content:flex-start;background:var(--surface)}',
'.adv-pb .chev{transition:transform var(--t)}.adv-pb[aria-expanded="true"] .chev{transform:rotate(180deg)}',
'.adv-open{margin-top:12px}.adv-open > * + *{margin-top:12px}',
'.steps{list-style:none;margin:0;padding:0}.steps li.step{padding:12px 0;border-top:1px solid var(--rule);align-items:flex-start}.steps li.step:first-child{border-top:0}',
'.steps .step-b{display:flex;flex-direction:column;gap:6px}.adv-t{font-size:var(--fs-15);overflow-wrap:anywhere}.adv-t.dn{color:var(--muted)}',
'.tick{flex:none;padding:0;color:var(--ok)}.tick[aria-checked="true"]{border-color:var(--ok);background:rgba(63,185,80,.12)}',
'.why summary{display:flex;align-items:center;min-height:44px;min-width:44px;cursor:pointer;list-style:none}.why summary::-webkit-details-marker{display:none}.why p{padding-bottom:4px}',
'.step-ctl{display:flex;gap:8px;margin-top:4px}',
'.rot{transform:rotate(180deg)}',
'.pchips{display:flex;flex-wrap:wrap;gap:8px}.pchip{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--surface);font-size:var(--fs-13)}',
'button.pchip{min-height:44px;background:var(--card)}.pchip .ricon{width:24px;height:24px}.pchip.muted{color:var(--muted)}',
'.slot-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px;border-top:1px solid var(--rule)}',
'@media (min-width:600px){.slot-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}',
'.tile{display:flex;align-items:center;gap:8px;min-height:64px;padding:8px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--card-hi);text-align:left;min-width:0}',
'.tile.chg{border-color:var(--accent)}.tile .tico{width:36px;height:36px}.tile .tt{display:flex;flex-direction:column;gap:2px;min-width:0}',
'.tile .tn{font-size:var(--fs-12);color:var(--muted)}.tile .tr{font-size:var(--fs-13);overflow-wrap:anywhere}',
'.vlist{display:flex;flex-direction:column;gap:8px}.vrow{width:100%;justify-content:flex-start;background:var(--card)}.vrow .ricon{width:28px;height:28px}',
'.vopts{display:flex;flex-direction:column;gap:8px;padding:0 0 8px 12px;border-left:2px solid var(--rule)}',
'.adv-seen{display:flex;align-items:center;gap:8px;min-height:56px;border-top:1px solid var(--rule);color:var(--text);text-decoration:none}.adv-seen svg{color:var(--muted)}',
'.adv-saved{margin-top:12px;display:flex;flex-direction:column;gap:8px}'
].join('\n');

var API = { walk: walk, plainReason: plainReason, looksDone: looksDone, stepText: stepText, stepNote: stepNote, ticks: ticks, preflight: preflight, links: links, isCode: isCode, normCode: normCode, ago: ago, mount: mount };
root.ArmoryAdvice = API;
if (isNode) module.exports = API;

})(typeof window !== 'undefined' ? window : {});
