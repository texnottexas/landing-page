/* Titan Canyon CAB-sync bookmarklet (leader-only).
 *
 * Runs in the leader's own logged-in Top War game tab. Pulls the live squad
 * lists from the 2864tw.com titan system (editor-password gated), then drives
 * the game's own NEW_CAB protocol: register the squad's timeslot, replace the
 * member list with the site squad, verify. Multi-squad alliances are handled
 * SEQUENTIALLY (register+assign squad A fully before registering squad B) so
 * the second registration's auto-seeded defaults can't consume squad-A players.
 *
 * The member-list write requires alliance R4+/leader in-game; the password
 * only gates reading the squad lists from the worker.
 */
(function () {
  'use strict';
  var WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
  var PW_KEY = 'titanCabPw';
  var RESET_UTC_HOUR = 16; // noon ET (EDT). Slot match tolerates +/-2h for DST.

  if (location.hostname !== 'h5.topwargame.com') { alert('Run this in the Top War game tab.'); return; }
  if (window.__tcCabRunning) { alert('TC sync already running.'); return; }
  window.__tcCabRunning = true;

  /* ---------- tiny overlay UI ---------- */
  // Full-screen takeover panel, same convention as the other 2864tw bookmarklets.
  var bg = document.createElement('div');
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(13,17,23,.94);z-index:2147483647;display:flex;' +
    'align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif';
  var ui = document.createElement('div');
  ui.style.cssText = 'width:min(680px,96vw);max-height:88vh;overflow:auto;background:#0d1117;color:#e6edf3;' +
    'border:1px solid #30363d;border-radius:14px;padding:24px;font-size:16px;line-height:1.5;box-shadow:0 12px 48px rgba(0,0,0,.7)';
  ui.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #30363d">' +
    '<b style="color:#79c0ff;font-size:21px">⚔ TC Squad Sync</b>' +
    '<button id="tcx" style="cursor:pointer;color:#e6edf3;background:#21262d;border:1px solid #30363d;border-radius:8px;font-size:15px;padding:7px 16px">Exit ✕</button></div>' +
    '<div id="tclog"></div><div id="tcact" style="margin-top:14px"></div>';
  bg.appendChild(ui);
  document.body.appendChild(bg);
  var logEl = ui.querySelector('#tclog'), actEl = ui.querySelector('#tcact');
  ui.querySelector('#tcx').onclick = function () { window.__tcCabRunning = false; bg.remove(); };
  function log(msg, color) {
    var d = document.createElement('div');
    d.style.cssText = 'margin:2px 0;color:' + (color || '#e6edf3');
    d.textContent = msg;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  }
  function buttons(defs) { // [{label, primary, fn}]
    actEl.innerHTML = '';
    defs.forEach(function (b) {
      var el = document.createElement('button');
      el.textContent = b.label;
      el.style.cssText = 'margin:0 10px 10px 0;padding:11px 20px;border-radius:9px;cursor:pointer;border:1px solid #30363d;font-size:16px;' +
        (b.primary ? 'background:#238636;color:#fff;font-weight:600' : 'background:#21262d;color:#e6edf3');
      el.onclick = function () { actEl.innerHTML = ''; b.fn(); };
      actEl.appendChild(el);
    });
  }
  // sha256 hex prefix (16) of a string — the site's siteKey derivation from a UID.
  function sha16(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))).then(function (buf) {
      var out = '';
      new Uint8Array(buf).forEach(function (b) { out += b.toString(16).padStart(2, '0'); });
      return out.slice(0, 16);
    });
  }
  function done() { window.__tcCabRunning = false; }

  /* ---------- game protocol helpers ---------- */
  function net(rid, payload) {
    return new Promise(function (resolve, reject) {
      var NET, RID;
      try { NET = __require('NetMgr').NET; RID = __require('RequestId').RequestId; }
      catch (e) { reject(new Error('game not ready (NetMgr missing)')); return; }
      var to = setTimeout(function () { reject(new Error('timeout: ' + rid)); }, 12000);
      NET.send(RID[rid], payload, {}, function (x) {
        clearTimeout(to);
        try { resolve(x && x.d ? JSON.parse(x.d) : null); }
        catch (e) { reject(new Error('bad response: ' + rid)); }
      });
    });
  }
  function nrm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
  function poolName(m) {
    var nm = m.name;
    try { nm = JSON.parse(m.playerInfo || '{}').username || m.name; } catch (e) {}
    return nm;
  }

  /* ---------- worker data ---------- */
  function fetchCabPlan(pw) {
    return fetch(WORKER + '/titan/cab-plan', { headers: { 'X-Titan-Edit-Password': pw } })
      .then(function (r) {
        if (r.status === 401) throw new Error('bad_password');
        if (!r.ok) throw new Error('worker http ' + r.status);
        return r.json();
      });
  }

  // Expected unix seconds for a slot id ("-6") on the battle Saturday (week ISO).
  function slotUnix(weekISO, slotId) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekISO || ''));
    var off = parseInt(slotId, 10);
    if (!m || isNaN(off)) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], RESET_UTC_HOUR) / 1000) + off * 3600;
  }
  function slotIndexFor(base, weekISO, slotId) {
    var want = slotUnix(weekISO, slotId);
    if (want == null) return -1;
    var best = -1, bestDiff = 7201; // within +/-2h (DST safety)
    (base.battleTimeArray || []).forEach(function (s, i) {
      var diff = Math.abs((s.time || 0) - want);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    return best;
  }

  /* ---------- main flow ---------- */
  var plan = null;

  function askPassword(prevFailed) {
    var stored = null;
    try { stored = localStorage.getItem(PW_KEY); } catch (e) {}
    if (stored && !prevFailed) return Promise.resolve(stored);
    var pw = prompt(prevFailed ? 'Password rejected. Titan editor password:' : 'Titan editor password:');
    if (!pw) return Promise.reject(new Error('cancelled'));
    try { localStorage.setItem(PW_KEY, pw); } catch (e) {}
    return Promise.resolve(pw);
  }

  function start(prevFailed) {
    askPassword(prevFailed).then(function (pw) {
      log('Fetching squad lists from 2864tw.com…', '#8b949e');
      return fetchCabPlan(pw);
    }).then(function (p) {
      if (!p || !p.ok) throw new Error('bad plan payload');
      plan = p;
      log('Week ' + p.week + ' · ' + Object.keys(p.squads).length + ' squads loaded', '#3fb950');
      pickAlliance();
    }).catch(function (e) {
      if (e.message === 'bad_password') { try { localStorage.removeItem(PW_KEY); } catch (x) {} start(true); return; }
      if (e.message === 'cancelled') { log('Cancelled.', '#8b949e'); done(); return; }
      log('Error: ' + e.message, '#f85149'); done();
    });
  }

  function pickAlliance() {
    var byAlliance = {};
    Object.keys(plan.squads).forEach(function (sq) {
      var al = plan.alliances[sq] || '?';
      (byAlliance[al] = byAlliance[al] || []).push(sq);
    });
    log('Pick YOUR alliance (you must be its R4+/leader):');
    buttons(Object.keys(byAlliance).map(function (al) {
      return { label: al + ' (' + byAlliance[al].length + ' squad' + (byAlliance[al].length > 1 ? 's' : '') + ')', primary: true, fn: function () {
        // Squad A before Squad B always (sequential rule).
        runSquads(byAlliance[al].sort(), 0, []);
      } };
    }).concat([{ label: 'Cancel', fn: function () { log('Cancelled.', '#8b949e'); done(); } }]));
  }

  function runSquads(squadNames, i, summary) {
    if (i >= squadNames.length) {
      log('All done.', '#79c0ff');
      summary.forEach(function (s) { log(s, '#3fb950'); });
      log('Skipped players are not in your alliance yet (transfers pending).', '#8b949e');
      buttons([{ label: 'Close', primary: true, fn: function () { done(); bg.remove(); } }]);
      return;
    }
    var sq = squadNames[i];
    var members = plan.squads[sq] || [];
    var slotId = plan.slots[sq];
    log('» ' + sq + ' (slot ' + slotId + ', ' + members.length + ' on site)', '#79c0ff');

    net('NEW_CAB_GET_BASE_DATA', {}).then(function (base) {
      var idx = slotIndexFor(base, plan.week, slotId);
      if (idx < 0) throw new Error('no matching timeslot for ' + slotId);
      var alreadySigned = (base.signedList || []).length > i; // corps i registered?
      var t = new Date((base.battleTimeArray[idx].time || 0) * 1000);
      var doSign = alreadySigned
        ? Promise.resolve({ ret: 0, skipped: true })
        : net('NEW_CAB_SIGN', { selectTime: idx, corps: i });
      return doSign.then(function (signRes) {
        if (signRes && signRes.ret !== 0 && !signRes.skipped) throw new Error('register failed ret=' + signRes.ret);
        log((alreadySigned ? 'Already registered' : 'Registered') + ' slot idx ' + idx + ' (' + t.toUTCString().slice(0, 22) + ')');
        return net('NEW_CAB_GET_ALLIANCE_LIST', {});
      });
    }).then(function (poolRes) {
      var pool = (poolRes.members || []).map(function (m) { return { uid: String(m.uid), name: poolName(m) }; });
      // Hash every pool UID so site siteKeys match players even after a rename.
      return Promise.all(pool.map(function (m) { return sha16(m.uid); })).then(function (hashes) {
        var bySk = {}, byName = {};
        pool.forEach(function (m, k) { bySk[hashes[k]] = m; byName[nrm(m.name)] = m; });
        return { bySk: bySk, byName: byName };
      });
    }).then(function (idx) {
      var sks = plan.siteKeys || {};
      var matched = [], skipped = [], used = {};
      members.forEach(function (n) {
        var m = (sks[n] && idx.bySk[sks[n]]) || idx.byName[nrm(n)];
        if (m && !used[m.uid]) {
          used[m.uid] = true;
          var renamed = nrm(m.name) !== nrm(n);
          matched.push({ name: n + (renamed ? ' (now ' + m.name + ')' : ''), uid: m.uid });
        } else if (!m) skipped.push(n);
      });
      if (!matched.length) { log('No members matched in-alliance; skipping squad.', '#f85149'); runSquads(squadNames, i + 1, summary); return; }
      log('Matched ' + matched.length + ': ' + matched.map(function (m) { return m.name; }).join(', '));
      if (skipped.length) log('Skipped ' + skipped.length + ' (not in alliance): ' + skipped.join(', '), '#d29922');
      buttons([
        { label: 'Set ' + sq + ' (' + matched.length + ')', primary: true, fn: function () {
          net('NEW_CAB_CHANGE_MEMBER_LIST', { formalUids: matched.map(function (m) { return m.uid; }), candidateUids: [], corps: i })
            .then(function (chg) {
              if (!chg || chg.ret !== 0) throw new Error('set failed ret=' + (chg && chg.ret));
              return net('NEW_CAB_GET_BASE_DATA', {});
            })
            .then(function (v) {
              var info = ((v.signedList || [])[i] || {}).myAllianceInfo || {};
              var got = (info.officailPlayersUid || []).map(String);
              var want = matched.map(function (m) { return m.uid; });
              var ok = want.length === got.length && want.every(function (u) { return got.indexOf(u) !== -1; });
              log(ok ? '✓ Verified: squad set (' + got.length + ' formal)' : '⚠ Set sent but verify mismatch (formal=' + got.length + ')', ok ? '#3fb950' : '#d29922');
              summary.push(sq + ': ' + matched.length + ' set' + (skipped.length ? ', ' + skipped.length + ' skipped' : ''));
              runSquads(squadNames, i + 1, summary);
            })
            .catch(function (e) { log('Error: ' + e.message, '#f85149'); buttons([{ label: 'Close', fn: function () { done(); bg.remove(); } }]); });
        } },
        { label: 'Skip squad', fn: function () { summary.push(sq + ': skipped by user'); runSquads(squadNames, i + 1, summary); } }
      ]);
    }).catch(function (e) {
      log('Error: ' + e.message, '#f85149');
      buttons([{ label: 'Close', fn: function () { done(); bg.remove(); } }]);
    });
  }

  start(false);
})();
