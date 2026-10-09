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

/* ---------- step text (verb first, plain words, no "s:0", no "Park") ---------- */
function stepText(step, ctx) {
  ctx = ctx || {};
  var hn = ctx.heroName || function (id) { return 'Hero ' + id; }, sn = ctx.slotName || function (s) { return 'slot ' + s; };
  if (!step || typeof step !== 'object') return 'Unknown step';
  var rune = step.runeName || step.srcRuneName || ctx.srcRune || 'the rune';
  switch (step.type) {
    case 'place': return 'Place ' + step.runeName + ' from your bag on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot);
    case 'merge': return 'Merge ' + step.runeName + ' on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot) + ' to ' + plural(+step.toStar || 0, 'star') + (ctx.mergeCost != null ? ' (uses ' + ctx.mergeCost + ' from your bag)' : '');
    case 'inherit':
      return ctx.dstEmpty ? 'Move ' + rune + ' from ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' to ' + hn(step.dstHero) + "'s empty " + sn(step.dstSlot)
        : 'Swap runes: ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' and ' + hn(step.dstHero) + "'s " + sn(step.dstSlot);
    case 'park': return 'Move ' + rune + ' off ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' onto a spare ' + sn(step.srcSlot);
    case 'recycle':
      return step.srcHero > 0 ? 'Return ' + rune + ' to your bag from ' + hn(step.srcHero) + "'s " + (step.srcGearName || sn(step.srcSlot))
        : 'Return ' + rune + ' to your bag from an unequipped ' + (step.srcGearName || sn(step.srcSlot));
  }
  return 'Unknown step';
}
/* the how-to line under a step that needs one */
function stepNote(step, ctx) {
  ctx = ctx || {};
  var sn = ctx.slotName || function (s) { return 'slot ' + s; };
  if (!step || typeof step !== 'object') return '';
  if (step.type === 'park') return 'Craft a spare ' + sn(step.srcSlot) + ' if you have none.';
  if (step.type === 'recycle') return 'Inherit the rune onto a junk ' + (step.srcGearName || sn(step.srcSlot)) + ', then recycle that junk piece.';
  return '';
}

/* ---------- walk every step in order from the base pool and base gear (ticks are ignored) ---------- */
function walk(base, baseGear, steps, catalog, runeIdx, core) {
  base = base || {};
  var st = { pool: clone(base.pool), gearByHero: clone(baseGear) }, un = clone(base.unequipped), rows = [];
  var slotName = function (s) { return G && G.GEAR_SLOT_NAMES && G.GEAR_SLOT_NAMES[s] || 'slot ' + s; };
  var heroName = function (id) { return core && core.heroName ? core.heroName(id) : 'Hero ' + id; };
  function at(h, s) { return st.gearByHero[h] && st.gearByHero[h][s] || null; }
  (steps || []).forEach(function (step) {
    var raw, cost = null, ctx = { heroName: heroName, slotName: slotName, mergeCost: null, dstEmpty: false, srcRune: null }, done = false;
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

var pure = { walk: walk, plainReason: plainReason, looksDone: looksDone, stepText: stepText, stepNote: stepNote, ticks: ticks, preflight: preflight, links: links, isCode: isCode, normCode: normCode, ago: ago };
var API = pure;
root.ArmoryAdvice = API;
if (isNode) module.exports = API;

})(typeof window !== 'undefined' ? window : {});
