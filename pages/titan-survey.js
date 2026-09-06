/* Titan Canyon one-off availability survey — shared widget.
 *
 * Used by titan-signup.html (before registering) and titan.html (the dashboard,
 * which is where players who ALREADY signed up actually go). It lives in one
 * file on purpose: the first version of this was hand-rolled per page, and the
 * duplicated identity logic shipped a bug where every guest device answered
 * under one shared name. The host page owns identity and passes it in.
 *
 * Usage:
 *   TitanSurvey.maybeShow({
 *     api:      'https://push-worker.27tb8s6fct.workers.dev',
 *     week:     '2026-09-12',          // the survey week; must equal cfg.week
 *     cfg:      slotConfigObject,      // { week, closesAt, slots:[{id,alliances}] }
 *     identity: { name, siteKey, alliance },   // ALREADY guest-filtered by the host
 *     force:    false,                 // ?survey=1 reopens it for someone who skipped
 *     onDone:   function(){}           // optional, after a successful save
 *   });
 *
 * Safe to call more than once; it shows at most one modal per page load.
 */
(function (w, d) {
  'use strict';

  var DONE_KEY = 'titanAvailSurveyDone';
  var shown = false;
  var cssDone = false;

  /* Class names are all `tsv-` prefixed: this widget mounts into two very
     different stylesheets, and a bare name like `.slot-card` means something
     else on each of them. */
  var CSS = [
    '.tsv-ov{position:fixed;inset:0;background:rgba(1,4,9,.82);z-index:9999;display:none;',
      'align-items:flex-start;justify-content:center;padding:1.1rem;overflow-y:auto;-webkit-overflow-scrolling:touch}',
    '.tsv-ov.tsv-on{display:flex}',
    '.tsv-box{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:1.1rem;',
      'max-width:520px;width:100%;margin:auto;color:#e6edf3;',
      'font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '.tsv-head{display:flex;align-items:center;justify-content:space-between;gap:.6rem}',
    '.tsv-title{font-size:1.05rem;font-weight:700}',
    '.tsv-x{background:none;border:0;color:#8b949e;font-size:1.1rem;cursor:pointer;padding:.2rem .35rem;line-height:1}',
    '.tsv-x:hover{color:#e6edf3}',
    '.tsv-why{margin:.9rem 0 .95rem;padding:.75rem .85rem;border-radius:10px;font-size:.86rem;line-height:1.5;',
      'background:rgba(121,192,255,.08);border:1px solid rgba(121,192,255,.28)}',
    '.tsv-opt{display:flex;align-items:flex-start;gap:.65rem;padding:.6rem .7rem;margin-bottom:.45rem;',
      'border:1px solid #30363d;border-radius:11px;background:#1c2128;cursor:pointer}',
    '.tsv-opt:hover{border-color:#8b949e}',
    '.tsv-opt.tsv-sel{border-color:#3fb950;background:rgba(63,185,80,.09)}',
    '.tsv-cb{margin:.15rem 0 0;width:17px;height:17px;flex:0 0 auto;accent-color:#3fb950;cursor:pointer}',
    '.tsv-when{font-weight:600;font-size:.92rem}',
    '.tsv-when i{font-style:normal;color:#79c0ff}',
    '.tsv-game{display:block;color:#8b949e;font-size:.76rem;margin-top:.15rem;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}',
    '.tsv-save{display:block;width:100%;margin-top:.8rem;padding:.7rem 1rem;border-radius:10px;border:0;',
      'background:#3fb950;color:#06140a;font-weight:700;font-size:.92rem;cursor:pointer;font-family:inherit}',
    '.tsv-save:disabled{opacity:.6;cursor:default}',
    '.tsv-skip{display:block;width:100%;margin-top:.5rem;padding:.55rem 1rem;border-radius:10px;',
      'background:transparent;border:1px solid #30363d;color:#8b949e;font-weight:600;font-size:.84rem;',
      'cursor:pointer;font-family:inherit}',
    '.tsv-skip:hover{color:#e6edf3;border-color:#8b949e}',
    '.tsv-status{margin-top:.55rem;font-size:.83rem;min-height:1.1em;color:#8b949e}',
    '.tsv-status.tsv-err{color:#f85149}'
  ].join('');

  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var el = d.createElement('style');
    el.textContent = CSS;
    d.head.appendChild(el);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Eastern wall-clock -> real UTC instant, DST-safe, no library. Both host
     pages have their own copy of this, but a shared widget must not reach into
     either page's internals. */
  function etWallToUTC(y, mo, dy, hh) {
    var guess = Date.UTC(y, mo - 1, dy, hh, 0, 0);
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    var p = {};
    dtf.formatToParts(new Date(guess)).forEach(function (x) { p[x.type] = x.value; });
    var asET = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute);
    return guess - (asET - guess);
  }

  var RESET_HOUR_ET = 12;   // slot id is the hour offset from the 12PM ET reset

  function fmt(instant, tz, opts) {
    var o = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    if (tz) o.timeZone = tz;
    return new Intl.DateTimeFormat([], o).format(instant);
  }

  /* Both renderings of one battle time: the viewer's own local day+time (the
     only form they can check against a calendar) and the game form (offset +
     ET), which is how it gets announced. */
  function slotTimes(weekISO, slotId) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekISO || ''));
    var off = parseInt(slotId, 10);
    if (!m || isNaN(off)) return null;
    var inst = new Date(etWallToUTC(+m[1], +m[2], +m[3], RESET_HOUR_ET + off));
    return {
      localDow: fmt(inst, null, { weekday: 'short' }),
      localTime: fmt(inst, null, { hour: 'numeric', minute: '2-digit' }),
      etTime: fmt(inst, 'America/New_York', { hour: 'numeric', minute: '2-digit' }),
      ba: off < 0 ? 'before reset' : 'after reset'
    };
  }

  function doneKeyFor(week, identity) {
    var id = identity.siteKey || ('n:' + String(identity.name || '').toLowerCase().trim());
    return week + '|' + id;
  }
  function isDone(week, identity) {
    try {
      var all = JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {};
      return all[doneKeyFor(week, identity)] === true;
    } catch (e) { return false; }
  }
  function markDone(week, identity) {
    try {
      var all = JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {};
      all[doneKeyFor(week, identity)] = true;
      localStorage.setItem(DONE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function build(opts) {
    injectCss();
    var week = opts.week;
    var slots = (opts.cfg && opts.cfg.slots) || [];

    var ov = d.createElement('div');
    ov.className = 'tsv-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    /* Every configured time is offered, not just the player's alliance: the
       point is to learn true availability so the timings themselves can move. */
    var rows = slots.map(function (s) {
      var t = slotTimes(week, s.id);
      var when = t
        ? '<i>' + esc(t.localDow + ' ' + t.localTime) + '</i> your time'
        : esc(s.label || s.id);
      var game = t
        ? 'game time ' + esc(s.id) + ' · ' + esc(t.etTime) + ' ET · ' + esc(t.ba)
        : 'game time ' + esc(s.id);
      return '<label class="tsv-opt"><input type="checkbox" class="tsv-cb tsv-slot" value="' + esc(s.id) + '">' +
        '<span><span class="tsv-when">' + when + '</span>' +
        '<span class="tsv-game" translate="no">' + game + '</span></span></label>';
    }).join('');

    ov.innerHTML =
      '<div class="tsv-box">' +
        '<div class="tsv-head"><span class="tsv-title">Titan Canyon Availability Survey</span>' +
          '<button type="button" class="tsv-x" aria-label="Close">✕</button></div>' +
        '<div class="tsv-why">This is to help re-balance the Titan Canyon squad times between ' +
          'alliances, so we can make progress towards improving matchmaking. This is not the signup, ' +
          'but a one time survey. Check the box for every time you would really be available to ' +
          'fight (actually).</div>' +
        rows +
        '<label class="tsv-opt"><input type="checkbox" class="tsv-cb tsv-none">' +
          '<span><span class="tsv-when">None of these work for me</span>' +
          '<span class="tsv-game">tell us that too, it counts as an answer</span></span></label>' +
        '<button type="button" class="tsv-save">Save my real availability</button>' +
        '<button type="button" class="tsv-skip">Not now</button>' +
        '<div class="tsv-status"></div>' +
      '</div>';

    d.body.appendChild(ov);

    var slotCbs = [].slice.call(ov.querySelectorAll('.tsv-slot'));
    var noneCb = ov.querySelector('.tsv-none');
    var statusEl = ov.querySelector('.tsv-status');
    var saveBtn = ov.querySelector('.tsv-save');

    function paint() {
      slotCbs.concat([noneCb]).forEach(function (cb) {
        cb.closest('.tsv-opt').classList.toggle('tsv-sel', cb.checked);
      });
    }
    /* "None" and the times are mutually exclusive in BOTH directions. */
    slotCbs.forEach(function (cb) {
      cb.addEventListener('change', function () { if (cb.checked) noneCb.checked = false; paint(); });
    });
    noneCb.addEventListener('change', function () {
      if (noneCb.checked) slotCbs.forEach(function (c) { c.checked = false; });
      paint();
    });

    function close() { ov.classList.remove('tsv-on'); }
    ov.querySelector('.tsv-x').addEventListener('click', close);
    ov.querySelector('.tsv-skip').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    saveBtn.addEventListener('click', function () {
      var picked = slotCbs.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      statusEl.className = 'tsv-status';
      if (!picked.length && !noneCb.checked) {
        statusEl.className = 'tsv-status tsv-err';
        statusEl.textContent = 'Tick at least one time, or tick "None of these work for me".';
        return;
      }
      saveBtn.disabled = true;
      statusEl.textContent = 'Saving…';
      var tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
      fetch(opts.api + '/titan/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week: week,
          name: opts.identity.name || '',
          siteKey: opts.identity.siteKey || '',
          alliance: opts.identity.alliance || '',
          slots: picked,
          none: !picked.length,
          tz: tz
        })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (!res.ok || !res.j || res.j.ok !== true) {
          saveBtn.disabled = false;
          statusEl.className = 'tsv-status tsv-err';
          statusEl.textContent = (res.j && res.j.message) ||
            (res.j && res.j.error === 'rate_limited'
              ? 'Just a moment, then try again.'
              : 'Could not save that. Please try again.');
          return;
        }
        markDone(week, opts.identity);
        statusEl.textContent = 'Thank you, that is recorded.';
        if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) {} }
        setTimeout(close, 900);
      }).catch(function () {
        saveBtn.disabled = false;
        statusEl.className = 'tsv-status tsv-err';
        statusEl.textContent = 'Network problem. Please try again.';
      });
    });

    paint();
    ov.classList.add('tsv-on');
  }

  w.TitanSurvey = {
    maybeShow: function (opts) {
      if (shown) return;
      if (!opts || !opts.api || !opts.week || !opts.cfg) return;
      if (opts.cfg.week !== opts.week) return;                 // this week only
      if (!(opts.cfg.slots || []).length) return;
      var who = opts.identity;
      if (!who || (!who.siteKey && !who.name)) return;          // need to know who is answering
      if (isDone(opts.week, who) && !opts.force) return;

      /* Ask the worker too, so someone who answered on another device is not
         asked again here. Returns a boolean only, never the record. */
      var qs = '?week=' + encodeURIComponent(opts.week) +
               '&siteKey=' + encodeURIComponent(who.siteKey || '') +
               '&name=' + encodeURIComponent(who.name || '');
      fetch(opts.api + '/titan/my-availability' + qs)
        .then(function (r) { return r.json(); })
        .catch(function () { return null; })
        .then(function (j) {
          if (j && j.answered && !opts.force) { markDone(opts.week, who); return; }
          if (shown) return;
          shown = true;
          build(opts);
        });
    },
    /* Exposed for the host pages' own bookkeeping and for tests. */
    isDone: isDone,
    markDone: markDone
  };
})(window, document);
