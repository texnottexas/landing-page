/* Homepage next-up card (Tex 2026-10-15): what the card above the wheel shows, and when.
 * A big card only for a Titan Canyon week; otherwise a slim strip for a calendar event in the next 24 hours,
 * otherwise nothing ("hidden or reduced in size if there is no event").
 * No DOM, no network. window.NextUp in the browser, module.exports for node tests. */
(function (root) {
  'use strict';

  var HOUR = 3600e3, DAY = 24 * HOUR;
  var TC_WINDOW = 7 * DAY;     // a battle Saturday this close counts as "this week"
  var LIVE_FOR = HOUR;         // "Battle in progress" for an hour after the slot starts
  var STRIP_WINDOW = DAY;      // the slim strip only for events starting within a day

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }

  function resetLabel(slot) {
    var n = parseInt(slot, 10);
    if (isNaN(n)) return 'reset';
    return 'reset ' + (n < 0 ? '-' : '+') + Math.abs(n);
  }

  // The battle Saturday (from `week`, an ISO date) at the noon reset, near enough to decide "this week".
  function weekAt(tc) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tc && tc.week || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 16) : null;
  }

  function pickTc(now, tc) {
    if (!tc || typeof tc !== 'object' || tc.ok === false) return null;
    var sat = weekAt(tc);
    if (sat == null || sat - now > TC_WINDOW || now - sat > DAY) return null;
    var battle = num(tc.battleAt);
    var closes = typeof tc.closesAt === 'string' ? Date.parse(tc.closesAt) : null;
    if (closes != null && isNaN(closes)) closes = null;

    if (battle != null) {
      if (now < battle) {
        return { kind: 'tc', eyebrow: 'Titan Canyon week · Saturday, ' + resetLabel(tc.slot), title: 'Your squad: ' + tc.squad,
          target: battle, link: '/titan', cta: 'See my squad' };
      }
      if (now < battle + LIVE_FOR) {
        return { kind: 'tc-live', eyebrow: 'Titan Canyon · ' + resetLabel(tc.slot), title: 'Battle in progress',
          sub: 'Your squad: ' + tc.squad, target: null, link: '/titan', cta: 'See my squad' };
      }
      return null;
    }
    if (tc.signedUp && closes != null && now < closes) {
      return { kind: 'tc-pending', eyebrow: 'Titan Canyon this Saturday', title: "You're signed up",
        sub: 'Squads are set when signups close', target: closes, link: '/titan', cta: 'Open Titan Canyon' };
    }
    if (!tc.signedUp && closes != null && now < closes) {
      return { kind: 'tc-nudge', eyebrow: 'Titan Canyon this Saturday', title: "You're not signed up yet",
        sub: 'Signups close soon', target: closes, link: '/titan-signup', cta: 'Sign up' };
    }
    return null;
  }

  function pickStrip(now, events) {
    var best = null;
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var start = num(e.start);
      if (start == null || start <= now || start - now > STRIP_WINDOW) return;
      if (!best || start < best.start) best = { title: String(e.title || ''), start: start };
    });
    return best ? { kind: 'strip', title: best.title, target: best.start, link: '#calendar' } : null;
  }

  function pick(input) {
    var o = input || {};
    var now = num(o.now);
    if (now == null) return null;
    return pickTc(now, o.tc) || pickStrip(now, o.events);
  }

  function parts(ms) {
    var t = Math.max(0, Math.floor((num(ms) || 0) / 1000));
    return { d: Math.floor(t / 86400), h: Math.floor(t % 86400 / 3600), m: Math.floor(t % 3600 / 60), s: t % 60 };
  }

  function short(ms) {
    var p = parts(ms);
    if (p.d) return 'in ' + p.d + 'd ' + p.h + 'h';
    if (p.h) return 'in ' + p.h + 'h ' + p.m + 'm';
    if (p.m) return 'in ' + p.m + 'm';
    return 'starting now';
  }

  var NextUp = { pick: pick, parts: parts, short: short, resetLabel: resetLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = NextUp;
  else root.NextUp = NextUp;
})(typeof window !== 'undefined' ? window : globalThis);
