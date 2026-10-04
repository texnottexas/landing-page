// map-collector.js — Map Collector: claims every Titan Blessing treasure map your alliance spawns the
// moment its notice appears in alliance chat, follows each march, and reports to your dashboard
// (2864tw.com/map-collector.html). Launched from the Ops Center, where only listed accounts see it.
// Rules live in map-collector-core.js (window.MapCollectorCore); this file talks to the game and the page.
// It only ever sends the game's own Claim request, one at a time, 1.1-1.3 s apart (verified live 2026-10-04).
(function () {
  'use strict';
  if (window.__MAPC && window.__MAPC.running) { window.__MAPC.flash(); return; }
  var C = window.MapCollectorCore;
  if (!C) { try { alert('Map Collector did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-04.2';
  var WORKER = window.__MAPC_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var DASH = 'https://2864tw.com/map-collector.html';
  var HOME_SERVER = 2864, CLAIM = 902, MARCH_TYPE = 143;   // RequestId.MARCH_WORLD_POINT, MarchType.Titan_Blessing_Gift
  var REPORT_BUSY_MS = window.__MAPC_REPORT_MS || 15000, REPORT_IDLE_MS = 60000, RETRY_MS = 60000, TICK_MS = 2000, SCAN_MS = 700;
  var LS_PW = 'mapc_pw_v1', LS_STATE = 'mapc_state_v1', SEEN_SAVE = 2000;
  var req = window.__require;
  var TARGET = {};                                         // NET.send wants a target; a plain object is always valid

  // ---------------------------------------------------------------- game
  function UD() { return req('DataCenter').DATA.UserData; }
  function NET() { return req('NetMgr').NET; }
  function EC() { return req('EventCenter').EventCenter.getInst(); }
  function chatRows() {
    try { var c = req('newChatController').newChatController._instance; return (c._userChatList && c._userChatList['2' + c._allianceRoomId]) || []; }
    catch (e) { return []; }
  }
  function activity() {
    try {
      var A = req('ActivityController'), inst = (A.ActivityController || A.default || A).Instance, l = inst && inst._activityList;
      var arr = Array.isArray(l) ? l : l ? Object.keys(l).map(function (k) { return l[k]; }) : [];
      for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].showUiType === 'ActivityTitanBlessing') return arr[i];
    } catch (e) {}
    return null;
  }
  function claimsLeft(a) { var n = a && a.extra ? Number(a.extra.left) : NaN; return isFinite(n) ? n : null; }
  function connected() { try { var s = NET()._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function visible() { return document.visibilityState === 'visible'; }
  // The player's own marches as the game lists them: {marchId: {arriveAt ms}}; null when unreadable.
  // The new world map keeps them in NWorldMapMarchModel.instance._myMarch (older clients: WorldMapController.myMarch).
  function myMarchList() {
    try { var M = req('NWorldMapMarchModel'), mi = M && (M.default || M).instance; if (mi && mi._myMarch && typeof mi._myMarch === 'object') return mi._myMarch; } catch (e) {}
    try { var W = req('WorldMapController'), K = W && (W.WorldMapController || W.default || W), wi = K && (K.Instance || K._instance); if (wi && wi.myMarch && typeof wi.myMarch === 'object') return wi.myMarch; } catch (e) {}
    return null;
  }
  function liveMarches() {
    try {
      var mm = myMarchList();
      if (!mm) return null;
      var out = {};
      Object.keys(mm).forEach(function (k) {
        var v = mm[k] || {}, mi = v.marchInfo || v._marchInfo || v._data || v;
        var id = String(mi.marchId || mi._marchId || k), at = Number(mi.marchArrive || mi._marchArrive || 0);
        out[id] = { arriveAt: at > 0 ? at * 1000 : 0 };
      });
      return out;
    } catch (e) { return null; }
  }
  function itemLabel(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      var name = '';
      try {
        var row = req('TableManager').TABLE.getTableDataById('item', it.itemId), L = req('LocalManager');
        if (row && row.name) name = (L.LOCAL || L.default).getText(row.name);
      } catch (e) {}
      return (name && name !== (it && it.itemId) ? name : 'item ' + it.itemId) + ' ×' + it.itemCount;
    }).join(', ');
  }
  function sendClaim(m) {
    return new Promise(function (resolve) {
      var done = false, ok;
      var t = setTimeout(function () { if (!done) { done = true; resolve({ s: 'timeout' }); } }, 8000);
      try {
        ok = NET().send(CLAIM, { marchType: MARCH_TYPE, x: m.x, y: m.y, armyList: [], armyListNew: [], heroList: [], trapList: [], ext: {} }, TARGET,
          function (r) { if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); });
      } catch (e) { ok = false; }
      if (ok === false && !done) { done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------------------------------------------------------------- state
  function rand(n) { var s = '', a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  var S = {
    runId: 'run_' + rand(12), startedAt: Date.now(), rev: 0, acked: 0, maps: [], seen: {}, seenOrder: [],
    siteKey: '', pw: '', left: null, failing: false, lastReportAt: 0, lastAttemptAt: 0, lastChatAt: 0,
    active: false, stopped: false, pumping: false, reporting: false, lastHealth: '', timers: [], saveTimer: null,
    sends: [], paused: null
  };
  // Never forget an id during a run: the game's own chat list is the bound. (A 500-id cap here let ids
  // fall out while still in a 658-row list, so the same maps were re-queued every few seconds and the
  // account was suspended, 2026-10-04.) Only the last 2000 are saved for a restart.
  function markSeen(id) { if (S.seen[id] === undefined) { S.seen[id] = 1; S.seenOrder.push(id); } }
  function restore() {
    var raw = lsGet(LS_STATE), saved = null;
    try { saved = JSON.parse(raw); } catch (e) {}
    if (!saved || saved.siteKey !== S.siteKey || !Array.isArray(saved.maps)) return;
    (Array.isArray(saved.seen) ? saved.seen : []).forEach(markSeen);
    S.maps = saved.maps.filter(function (m) { return m && typeof m.id === 'string'; });
    S.maps.forEach(function (m) {
      markSeen(m.id);
      if (m.state === 'queued' || m.state === 'sending') { m.state = 'failed'; m.reason = 'Collector restarted'; }
      C.touch(S, m);                                        // resend everything once to the new run
    });
  }
  function save() {
    if (S.saveTimer) return;
    S.saveTimer = setTimeout(function () {
      S.saveTimer = null;
      S.maps = C.prune(S.maps, Date.now(), S.acked);
      lsSet(LS_STATE, JSON.stringify({ siteKey: S.siteKey, maps: S.maps, seen: S.seenOrder.slice(-SEEN_SAVE) }));
    }, 1000);
  }

  // ---------------------------------------------------------------- watch, claim, follow
  function scan() {
    if (!S.active) return;
    var rows = chatRows();
    if (rows.length) { var t = Number(rows[rows.length - 1]._time) * 1000; if (t > S.lastChatAt) S.lastChatAt = t; }
    var res = C.newNotices(rows, S.seen, S.startedAt - C.PRIME_MS);
    res.ids.forEach(markSeen);
    if (!res.notices.length) return;
    var me = ''; try { me = String(UD().Name || ''); } catch (e) {}
    var added = C.admit(S.maps, res.notices, me, HOME_SERVER, Date.now());
    if (!added.length) return;
    added.forEach(function (m) { C.touch(S, m); });
    save(); paint(); pump();
  }
  function pump() {
    if (S.pumping || !S.active) return;
    S.pumping = true;
    (async function () {
      while (S.active) {
        var pick = C.pickNext(S.maps, Date.now());
        if (!pick.map) { if (pick.wait < 0) break; await delay(Math.min(pick.wait, 1000)); continue; }
        var left = claimsLeft(activity());
        if (left != null) S.left = left;
        if (left != null && left <= 0) { stop('out of claims'); break; }
        try { if (NET().checkRequestIdNoRes(CLAIM)) { await delay(1000); continue; } } catch (e) {}
        var g = C.gate(S.sends, Date.now());
        if (!g.ok) { if (!S.paused || S.paused.until !== g.until) { S.paused = g; paint(); report(''); } await delay(Math.min(5000, Math.max(250, g.until - Date.now()))); continue; }
        if (S.paused) { S.paused = null; paint(); }
        var m = pick.map;
        m.state = 'sending'; m.sentAt = Date.now(); C.touch(S, m); paint();
        var ans = await sendClaim(m), cls = C.classifyAnswer(ans);
        S.sends.push({ t: m.sentAt, kind: cls.kind }); if (S.sends.length > 100) S.sends.shift();
        C.applyAnswer(m, cls, Date.now()); C.touch(S, m); save(); paint();
        await delay(1100 + Math.floor(Math.random() * 200));
      }
      S.pumping = false;
      if (S.active && C.pickNext(S.maps, Date.now()).map) pump();   // a notice that landed as the loop ended
    })();
  }
  function onReward(e) {
    if (!S.active) return;
    try {
      var m = C.matchReward(S.maps, Date.now(), itemLabel(e && e.reward && e.reward.items));
      if (m) { C.touch(S, m); save(); paint(); }
    } catch (x) {}
  }
  function onChat() { setTimeout(scan, 0); }
  function tick() {
    if (!S.active) return;
    var a = activity();
    if (!a) { stop('event ended'); return; }
    var left = claimsLeft(a);
    if (left != null) S.left = left;
    if (left != null && left <= 0 && !S.maps.some(function (m) { return m.state === 'sending'; })) { stop('out of claims'); return; }
    var now = Date.now();
    C.syncMarches(S.maps, liveMarches(), now).concat(C.sweepMissed(S.maps, now)).forEach(function (m) { C.touch(S, m); });
    if (C.pickNext(S.maps, now).map) pump();
    var h = health();
    var due = h !== S.lastHealth || now - S.lastAttemptAt >= (S.failing ? RETRY_MS : C.buildReport(S.maps, S.acked).rows.length ? REPORT_BUSY_MS : REPORT_IDLE_MS);
    S.lastHealth = h;
    if (due) report('');
    save(); paint();
  }
  function health() { return C.healthOf({ connected: connected(), visible: visible(), failing: S.failing }); }

  // ---------------------------------------------------------------- report
  function report(stopReason) {
    if (S.reporting && !stopReason) return Promise.resolve(0);
    S.reporting = true; S.lastAttemptAt = Date.now();
    var b = C.buildReport(S.maps, S.acked);
    var body = { runId: S.runId, siteKey: S.siteKey, version: VERSION, startedAt: S.startedAt,
      status: { state: stopReason ? 'stopped' : 'running', stopReason: stopReason || '', left: S.left, connected: connected(), visible: visible(), lastChatAt: Math.round(S.lastChatAt) },
      maps: b.rows };
    return fetch(WORKER + '/mapcollector/report', { method: 'POST', keepalive: !!stopReason,
      headers: { 'Content-Type': 'application/json', 'X-Map-Collector-Password': S.pw }, body: JSON.stringify(body) })
      .then(function (res) { return res.status; }, function () { return 0; })
      .then(function (code) {
        S.reporting = false;
        if (code === 200) { C.ackReport(S, b.upto); S.failing = false; S.lastReportAt = Date.now(); save(); }
        else if (!stopReason) {
          if (code === 401) { lsSet(LS_PW, null); halt(); askPassword('That password didn\'t work.'); }
          else if (code === 403) stop('not registered');
          else if (code === 409) stop('superseded');
          else S.failing = true;
        }
        paint();
        return code;
      });
  }

  // ---------------------------------------------------------------- run
  function begin() {
    var a = activity();
    if (!a) { stop('event ended'); return; }
    S.left = claimsLeft(a);
    if (S.left != null && S.left <= 0) { stop('out of claims'); return; }
    showStats();
    // check the password and the account before claiming anything; a network failure still lets it collect
    report('').then(function (code) {
      if (S.stopped || (code !== 200 && code !== 0 && code < 500)) return;
      if (S.active) return;
      S.active = true;
      EC().on('TitanBlessWorldRewardGet', onReward, TARGET);
      EC().on('newChatPush', onChat, TARGET);
      S.timers.push(setInterval(scan, SCAN_MS), setInterval(tick, TICK_MS));
      scan(); paint();
    });
  }
  function halt() {
    S.active = false;
    S.timers.forEach(clearInterval); S.timers = [];
    try { EC().off('TitanBlessWorldRewardGet', onReward, TARGET); EC().off('newChatPush', onChat, TARGET); } catch (e) {}
  }
  var STOP_TEXT = {
    'out of claims': 'Map Collector stopped: no claims left.',
    'event ended': 'Map Collector stopped: the event ended.',
    'superseded': 'Another Map Collector took over. This one stopped.',
    'not registered': 'This account isn\'t set up for Map Collector.'
  };
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; halt();
    if (reason !== 'superseded' && reason !== 'not registered' && S.siteKey) report(reason);
    lsSet(LS_STATE, JSON.stringify({ siteKey: S.siteKey, maps: C.prune(S.maps, Date.now(), S.acked), seen: S.seenOrder.slice(-SEEN_SAVE) }));
    window.__MAPC.running = false;
    if (reason === 'stopped by you') { removeRoot(); return; }
    showMessage(STOP_TEXT[reason] || 'Map Collector stopped.', true);
    if (reason === 'out of claims' || reason === 'event ended' || reason === 'superseded') setTimeout(removeRoot, 10000);
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#mapc-root{position:fixed;left:calc(8px + env(safe-area-inset-left));bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#mapc-root .mapc-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #3fb950;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#mapc-root .mapc-card.warn{border-color:#d29922}#mapc-root .mapc-card.bad{border-color:#f85149}#mapc-root .mapc-card.flash{transform:scale(1.04)}',
    '#mapc-root .mapc-head{display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:6px}',
    '#mapc-root .mapc-dot{width:8px;height:8px;border-radius:50%;background:#3fb950}#mapc-root .warn .mapc-dot{background:#d29922}#mapc-root .bad .mapc-dot{background:#f85149}',
    '#mapc-root .mapc-row{display:flex;justify-content:space-between;padding:2px 0}#mapc-root .mapc-k{color:#8b949e}#mapc-root .mapc-v{font-variant-numeric:tabular-nums;font-weight:600}',
    '#mapc-root .mapc-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#mapc-root .mapc-msg{margin:4px 0 2px}',
    '#mapc-root .mapc-btns{display:flex;gap:6px;margin-top:8px}',
    '#mapc-root button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128;color:#e6edf3;font:inherit;cursor:pointer}',
    '#mapc-root button:hover{border-color:#79c0ff}#mapc-root input{width:100%;box-sizing:border-box;min-height:44px;margin:6px 0 0;padding:0 10px;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#e6edf3;font:inherit}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    if (!document.getElementById('mapc-style')) { var st = el('style'); st.id = 'mapc-style'; st.textContent = CSS; document.head.appendChild(st); }
    root = el('div'); root.id = 'mapc-root';
    card = el('div', 'mapc-card');
    var head = el('div', 'mapc-head'); head.appendChild(el('span', 'mapc-title', 'Map Collector')); head.appendChild(el('span', 'mapc-dot'));
    body = el('div', 'mapc-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function showStats() {
    ensureRoot(); body.textContent = '';
    [['Collected', 'mapc-collected'], ['Missed', 'mapc-missed'], ['En route', 'mapc-enroute'], ['Claims left', 'mapc-left']].forEach(function (r) {
      var row = el('div', 'mapc-row'); row.appendChild(el('span', 'mapc-k', r[0])); var v = el('span', 'mapc-v', '0'); v.id = r[1]; row.appendChild(v); body.appendChild(row);
    });
    var foot = el('div', 'mapc-foot', 'Starting...'); foot.id = 'mapc-foot'; body.appendChild(foot);
    var btns = el('div', 'mapc-btns');
    btns.appendChild(button('mapc-dash', 'Dashboard', function () { window.open(DASH, '_blank', 'noopener'); }));
    btns.appendChild(button('mapc-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = '';
    body.appendChild(el('div', 'mapc-msg', text));
    if (withClose) { var btns = el('div', 'mapc-btns'); btns.appendChild(button('mapc-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'mapc-card';
  }
  function askPassword(note) {
    ensureRoot(); body.textContent = '';
    body.appendChild(el('div', 'mapc-msg', note || 'Enter your Map Collector password.'));
    var input = el('input'); input.id = 'mapc-pw'; input.type = 'password'; input.autocomplete = 'current-password'; input.setAttribute('aria-label', 'Map Collector password');
    body.appendChild(input);
    var btns = el('div', 'mapc-btns');
    var go = function () { var v = input.value.trim(); if (!v) return; S.pw = v; lsSet(LS_PW, v); begin(); };
    btns.appendChild(button('mapc-pw-go', 'Start', go));
    btns.appendChild(button('mapc-close', 'Close', function () { window.__MAPC.running = false; S.stopped = true; removeRoot(); }));
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    body.appendChild(btns);
    card.className = 'mapc-card';
    try { input.focus(); } catch (e) {}
  }
  function paint() {
    if (!root || !document.getElementById('mapc-enroute')) return;
    var age = S.lastReportAt ? Math.round((Date.now() - S.lastReportAt) / 1000) : null;
    var c = C.pillCard(C.summarize(S.maps), S.left, age, health());
    if (S.paused && Date.now() < S.paused.until && c.tone === 'ok') { c.foot = 'Paused: ' + S.paused.reason; c.tone = 'warn'; }
    var ids = ['mapc-collected', 'mapc-missed', 'mapc-enroute', 'mapc-left'];
    c.rows.forEach(function (r, i) { var e = document.getElementById(ids[i]), v = String(r[1]); if (e && e.textContent !== v) e.textContent = v; });
    var f = document.getElementById('mapc-foot'); if (f && f.textContent !== c.foot) f.textContent = c.foot;
    card.className = 'mapc-card' + (c.tone === 'ok' ? '' : ' ' + c.tone);
  }

  // ---------------------------------------------------------------- start
  window.__MAPC = {
    running: true,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); }
  };
  ensureRoot();
  showMessage('Starting...');
  var id = ''; try { var u = UD(); id = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!id) { showMessage('Open the game and log in first.', true); window.__MAPC.running = false; return; }
  sha256Hex(id).then(function (h) {
    S.siteKey = h.slice(0, 16);
    restore();
    S.pw = lsGet(LS_PW) || '';
    if (S.pw) begin(); else askPassword();
  });
})();
