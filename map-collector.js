// map-collector.js — Map Collector: claims every Titan Blessing treasure map your alliance spawns the
// moment its notice appears in alliance chat, follows each march, and reports to your dashboard
// (2864tw.com/map-collector.html). Launched from the Ops Center, where only listed accounts see it.
// Rules live in map-collector-core.js (window.MapCollectorCore); this file talks to the game and the page.
// It only ever sends the game's own Claim request, one at a time, 1.1-1.3 s apart (verified live 2026-10-04), and,
// when speed-ups are switched on, the game's own speed-up use (920) and VIP-shop purchase (818) at the same pace.
(function () {
  'use strict';
  if (window.__MAPC && window.__MAPC.running) { window.__MAPC.flash(); return; }
  var C = window.MapCollectorCore;
  if (!C) { try { alert('Map Collector did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-04.9';
  var WORKER = window.__MAPC_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var DASH = 'https://2864tw.com/map-collector.html';
  var HOME_SERVER = 2864, CLAIM = 902, MARCH_TYPE = 143;   // RequestId.MARCH_WORLD_POINT, MarchType.Titan_Blessing_Gift
  var BUY = 818, USE = 920;                                 // VIP shop purchase, use an item on a march (captured live 2026-10-04)
  var REPORT_BUSY_MS = window.__MAPC_REPORT_MS || 15000, REPORT_IDLE_MS = 60000, REPORT_DOWN_MS = window.__MAPC_DOWN_REPORT_MS || 20000, RETRY_MS = 60000, TICK_MS = 2000, SCAN_MS = 700;
  var ATTACH_LIMIT_MS = window.__MAPC_ATTACH_MS || 90000, KICK_BOX = 'New Node/New Node/MsgBoxComponent', GONE_MS = window.__MAPC_GONE_MS || 60000;
  var AUTO_MS = window.__MAPC_AUTO_MS || C.AUTO_RECONNECT_MS;   // Unattended mode reconnects by itself 65 min after going down
  var LS_PW = 'mapc_pw_v1', LS_STATE = 'mapc_state_v1', LS_SPEND = 'mapc_spend_v1', LS_MIN = 'mapc_min_v1', SEEN_SAVE = 2000;
  // The game window: this page, or in Unattended mode the game running in a frame under the card, which
  // can be reloaded to log back in while this script keeps running (a full page reload would end it).
  var GW = window, frame = null;
  function req(n) { return GW.__require(n); }
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
  // Another device logged in: the game shows its "Multiple active logins" box and drops the connection.
  function kickedNow() {
    try {
      var n = GW.cc && GW.cc.find(KICK_BOX), c = n && n.activeInHierarchy && n._components.filter(function (x) { return x && x.ownerCaller; })[0];
      return !!(c && /active logins|logged in|another device/i.test(String(c.ownerCaller.options && c.ownerCaller.options.content)));
    } catch (e) { return false; }
  }
  function gameReady() {
    try { var U = req('DataCenter').DATA.UserData; return !!(U && U.Name) && connected() && !!req('newChatController').newChatController._instance; }
    catch (e) { return false; }
  }
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
  // Speed-ups: gems, the bag's Advanced March Speed-ups, VIP level and the VIP shop row (price, VIP needed).
  function gems() { try { var g = Number(UD()._resourceData._gold); return isFinite(g) ? g : null; } catch (e) { return null; } }
  function bagCount() { try { var n = Number(UD().getItemAmount(C.SPEED_ITEM)); return isFinite(n) ? n : 0; } catch (e) { return 0; } }
  function vipLevel() { try { var v = Number(UD().VipLevel); return isFinite(v) ? v : 0; } catch (e) { return 0; } }
  function shopRow() { try { return req('TableManager').TABLE.getTableDataById('vip_shop', C.SPEED_SHOP) || null; } catch (e) { return null; } }
  function netBusy() { try { var n = NET(); return !!(n.checkRequestIdNoRes(CLAIM) || n.checkRequestIdNoRes(BUY) || n.checkRequestIdNoRes(USE)); } catch (e) { return false; } }
  // a claim waits only for an unanswered claim: a speed-up request the game never answers must not stall every claim after it
  function claimBusy() { try { return !!NET().checkRequestIdNoRes(CLAIM); } catch (e) { return false; } }
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
  function sendReq(rid, params) {
    return new Promise(function (resolve) {
      var done = false, ok;
      var t = setTimeout(function () { if (!done) { done = true; resolve({ s: 'timeout' }); } }, 8000);
      try {
        ok = NET().send(rid, params, TARGET, function (r) { if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); });
      } catch (e) { ok = false; }
      if (ok === false && !done) { done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  // One request clock for every Ops tool in this tab (Mask Mystery Boxes too): never two game requests, from any
  // of them, under 1.1-1.3 s apart.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + 1100 + Math.floor(Math.random() * 200) - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  function sendClaim(m) { return sendReq(CLAIM, { marchType: MARCH_TYPE, x: m.x, y: m.y, armyList: [], armyListNew: [], heroList: [], trapList: [], ext: {} }); }
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
    sends: [], paused: null, attached: false, attachAt: 0, ec: null, note: '', noteUntil: 0, reconnecting: 0,
    // speed-ups: the stored settings (off until a report answer brings them), a card change not yet sent, and this run's state
    min: lsGet(LS_MIN) === '1', view: '',
    speed: { on: false, reserve: 10000, cap: 1500, known: false }, speedDirty: null, speedFails: 0, speedOff: '', speedNote: '',
    spend: { day: '', gems: 0 }, spentServer: { day: '', gems: 0 }, reportSoon: false, speedDirtyAt: 0, skew: null
  };
  // Never forget an id during a run: the game's own chat list is the bound. (A 500-id cap here let ids
  // fall out while still in a 658-row list, so the same maps were re-queued every few seconds and the
  // account was suspended, 2026-10-04.) Only the last 2000 are saved for a restart.
  function markSeen(id) { if (S.seen[id] === undefined) { S.seen[id] = 1; S.seenOrder.push(id); } }
  function restore() {
    try { var sp = JSON.parse(lsGet(spendKey())); if (sp && typeof sp.day === 'string' && typeof sp.gems === 'number') S.spend = { day: sp.day, gems: sp.gems }; } catch (e) {}
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

  // gems spent today, per account (two accounts in one browser keep separate counts)
  function spendKey() { return LS_SPEND + '_' + S.siteKey; }
  function saveSpend() { lsSet(spendKey(), JSON.stringify({ day: S.spend.day, gems: S.spend.gems })); }

  // ---------------------------------------------------------------- speed-ups
  function speedReady() { return S.speed.on && S.speed.known && !S.speedOff; }
  function speedPending() { return S.maps.some(function (m) { return m.state === 'sent' && (m.speedWant || 0) > (m.speedDone || 0); }); }
  // Gems spent today (game day from noon ET): this collector's own count or the worker's, whichever is higher.
  function spentToday() {
    var day = C.gameDay(Date.now());
    if (S.spend.day !== day) S.spend = { day: day, gems: 0 };
    return Math.max(S.spend.gems, S.spentServer.day === day ? S.spentServer.gems : 0);
  }
  function until(fn, ms) {
    var t0 = Date.now();
    return new Promise(function (r) { (function poll() { if (fn()) return r(true); if (Date.now() - t0 >= ms) return r(false); setTimeout(poll, 100); })(); });
  }
  function speedOff(why) { S.speedOff = why; S.speedNote = 'Speed-ups off: ' + why + '. Relaunch to resume.'; paint(); report(''); }
  // gems that left for a speed-up are counted on the map and in today's total at once, whatever happens next
  function spend(m, g) { spentToday(); S.spend.gems += g; saveSpend(); m.gems = (m.gems || 0) + g; m.speedBought = (m.speedBought || 0) + 1; C.touch(S, m); save(); }
  function dropSpeed(m) { m.speedWant = m.speedDone || 0; C.touch(S, m); save(); paint(); }
  function speedFail() { S.speedFails++; if (S.speedFails >= 3) speedOff('3 speed-ups in a row failed'); }
  // One Advanced March Speed-up on this march: from the bag, or bought at the VIP shop's price within the
  // gem reserve and daily cap. A purchase must add exactly one and cost exactly the price, or speed-ups stop.
  async function speedUp(m) {
    var row = shopRow(), price = row ? Number(row.price_shop) || 0 : 0;
    var chk = C.buyCheck({ bag: bagCount(), gems: gems(), price: price, item: row ? Number(row.item_id) : 0, vip: vipLevel(), needVip: row ? Number(row.need_vip_level) || 0 : 0,
      reserve: S.speed.reserve, spent: spentToday(), cap: S.speed.cap });
    if (!chk.ok) { m.speedWant = m.speedDone || 0; m.speedNote = chk.reason; S.speedNote = chk.reason; C.touch(S, m); save(); paint(); return; }
    if (chk.source === 'buy') {
      var bag0 = bagCount(), gems0 = gems();
      await pace();
      var b = await sendReq(BUY, { shopId: C.SPEED_SHOP, amount: 1, isVip: 1 }), sold = !!b && b.s === 0;
      // it must add exactly one speed-up for exactly the price. A lost answer can still have bought one: the bag says.
      if (!(await until(function () { return bagCount() === bag0 + 1 && gems() === gems0 - price; }, sold ? 3000 : 1000))) {
        var now = gems(), gone = gems0 != null && now != null ? gems0 - now : 0;
        if (gone > 0 || sold) { spend(m, Math.max(gone, sold ? price : 0)); speedOff('a purchase did not add up'); return; }
        dropSpeed(m); speedFail(); return;                  // nothing bought: this march gets no more tries
      }
      spend(m, price);
      await delay(1100 + Math.floor(Math.random() * 200));
      // still wanted, still on, still attached, still en route with time to gain? Otherwise it stays in the bag.
      if (!speedReady() || !S.active || !S.attached || !connected() || m.state !== 'sent' || !(m.arriveAt - Date.now() > C.SPEED_MIN_LEFT_MS)) return;
    }
    await pace();
    var bagBefore = bagCount();
    var u = await sendReq(USE, { marchId: m.marchId, itemId: C.SPEED_ITEM });
    if (!u || u.s !== 0) {
      // a lost answer can still have used it: one fewer in the bag means it worked
      if (!(await until(function () { return bagCount() === bagBefore - 1; }, 1000))) { dropSpeed(m); speedFail(); return; }
    }
    S.speedFails = 0;
    C.applySpeed(m, Date.now(), false, 0); C.touch(S, m); save(); paint();
  }
  // A report answer brings the stored settings. A card change made while that report was out is kept and sent next.
  function applySettings(st, sentDirty) {
    var r = Number(st.gemReserve), c = Number(st.gemCap);
    if (isFinite(r)) S.speed.reserve = r;
    if (isFinite(c)) S.speed.cap = c;
    S.speed.known = true;
    if (S.speedDirty === null || S.speedDirty === sentDirty) { S.speed.on = !!st.speedOn; if (S.speedDirty === sentDirty) S.speedDirty = null; }
    paint();
  }
  function toggleSpeed() {
    S.speedDirty = !S.speed.on; S.speed.on = S.speedDirty; S.speedDirtyAt = Date.now(); paint();
    if (S.reporting) S.reportSoon = true; else report('');
  }

  // ---------------------------------------------------------------- watch, claim, follow
  function scan() {
    if (!S.active || !S.attached) return;
    var rows = chatRows();
    if (rows.length) { var t = Number(rows[rows.length - 1]._time) * 1000; if (t > S.lastChatAt) S.lastChatAt = t; }
    var res = C.newNotices(rows, S.seen, S.attachAt - C.PRIME_MS);
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
        if (!S.attached) { await delay(1000); continue; }
        // never send into a closed connection: a game that buffers would flush them in a burst on reconnect
        if (!connected()) { await delay(1000); continue; }
        var pick = C.pickNext(S.maps, Date.now());
        if (!pick.map) {
          // claims first: speed-ups only go out while no claim is due
          var sp = speedReady() ? C.pickSpeed(S.maps, Date.now()) : { map: null, skipped: [] };
          if (sp.map) {
            if (netBusy()) { await delay(1000); continue; }
            // a purchase takes a few seconds: never start one with a claim about to come due
            if (pick.wait >= 0 && pick.wait < 4000 && bagCount() === 0) { await delay(Math.max(100, Math.min(pick.wait, 1000))); continue; }
            await speedUp(sp.map);
            await delay(1100 + Math.floor(Math.random() * 200));
            continue;
          }
          if (pick.wait < 0 && !(speedReady() && speedPending())) break;
          await delay(pick.wait < 0 ? 1000 : Math.min(pick.wait, 1000)); continue;
        }
        var left = claimsLeft(activity());
        if (left != null) S.left = left;
        if (left != null && left <= 0) { stop('out of claims'); break; }
        if (claimBusy()) { await delay(1000); continue; }
        var g = C.gate(S.sends, Date.now());
        if (!g.ok) { if (!S.paused || S.paused.until !== g.until) { S.paused = g; paint(); report(''); } await delay(Math.min(5000, Math.max(250, g.until - Date.now()))); continue; }
        if (S.paused) { S.paused = null; paint(); }
        var m = pick.map;
        await pace();
        if (!S.active || !connected() || m.state !== 'queued') continue;
        m.state = 'sending'; m.sentAt = Date.now(); C.touch(S, m); paint();
        var ans = await sendClaim(m), cls = C.classifyAnswer(ans);
        S.sends.push({ t: m.sentAt, kind: cls.kind }); if (S.sends.length > 100) S.sends.shift();
        C.applyAnswer(m, cls, Date.now()); C.planSpeed(m, speedReady(), Date.now()); C.touch(S, m); save(); paint();
        await delay(1100 + Math.floor(Math.random() * 200));
      }
      S.pumping = false;
      if (S.active && (C.pickNext(S.maps, Date.now()).map || (speedReady() && speedPending()))) pump();   // work that landed as the loop ended
    })();
  }
  function onReward(e) {
    if (!S.active || !S.attached) return;
    try {
      var items = e && e.reward && e.reward.items;
      var m = C.matchReward(S.maps, Date.now(), itemLabel(items), C.rewardItemsOf(items));
      if (m) { C.touch(S, m); save(); paint(); }
    } catch (x) {}
  }
  function onChat() { setTimeout(scan, 0); }
  function tick() {
    if (!S.active) return;
    var now0 = Date.now();
    // Unattended mode: 65 minutes after the game went down (another login, a lost connection, a failed
    // reconnect), reload the frame by itself, exactly as the dashboard's Reconnect does; again 65 min later.
    if (frame) {
      if (!S.attached || !connected()) {
        if (!S.downSince) S.downSince = now0;
        var ar = C.autoReconnect(S.downSince, S.autoTryAt, now0, AUTO_MS);
        S.autoAt = ar.at;
        if (ar.due && !S.reconnecting) { S.autoTryAt = now0; reconnect(); }
      } else { S.downSince = 0; S.autoTryAt = 0; S.autoAt = 0; }
    }
    if (!S.attached) {                                     // reconnecting: keep reporting so the dashboard sees it
      if (now0 - S.lastAttemptAt >= REPORT_DOWN_MS) report('');
      paint(); return;
    }
    var a = activity();
    if (!a) {
      // the event list can be briefly empty while a reloaded game settles: only a minute without it ends the run
      if (connected()) { if (!S.goneSince) S.goneSince = now0; if (now0 - S.goneSince >= GONE_MS) { stop('event ended'); return; } }
      paint(); return;
    }
    S.goneSince = 0;
    var left = claimsLeft(a);
    if (left != null) S.left = left;
    if (left != null && left <= 0 && !S.maps.some(function (m) { return m.state === 'sending'; })) { stop('out of claims'); return; }
    var now = Date.now();
    C.syncMarches(S.maps, liveMarches(), now).concat(C.sweepMissed(S.maps, now)).forEach(function (m) { C.touch(S, m); });
    if (C.pickNext(S.maps, now).map || (speedReady() && speedPending())) pump();
    var h = health();
    var due = h !== S.lastHealth || now - S.lastAttemptAt >= (S.failing ? RETRY_MS : !connected() ? REPORT_DOWN_MS : C.buildReport(S.maps, S.acked).rows.length ? REPORT_BUSY_MS : REPORT_IDLE_MS);
    S.lastHealth = h;
    if (due) report('');
    save(); paint();
  }
  function health() { return C.healthOf({ connected: connected(), visible: visible(), failing: S.failing }); }

  // ---------------------------------------------------------------- report
  function report(stopReason) {
    if (S.reporting && !stopReason) return Promise.resolve(0);
    S.reporting = true; S.lastAttemptAt = Date.now();
    var b = C.buildReport(S.maps, S.acked), sentDirty = S.speedDirty;
    var body = { runId: S.runId, siteKey: S.siteKey, version: VERSION, startedAt: S.startedAt,
      status: { state: stopReason ? 'stopped' : 'running', stopReason: stopReason || '', left: S.left, connected: S.attached && connected(), visible: visible(),
        kicked: !connected() && kickedNow(), lastChatAt: Math.round(S.lastChatAt),
        speedOn: speedReady(), speedNote: S.speedNote || '', autoReconnectAt: S.autoAt || 0 },
      maps: b.rows };
    // when the switch was flipped, in the worker's clock: an older flip never beats a newer dashboard change
    if (sentDirty !== null) body.settings = S.skew === null ? { speedOn: sentDirty } : { speedOn: sentDirty, at: Math.round(S.speedDirtyAt + S.skew) };
    return fetch(WORKER + '/mapcollector/report', { method: 'POST', keepalive: !!stopReason,
      headers: { 'Content-Type': 'application/json', 'X-Map-Collector-Password': S.pw }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (j) { return { code: res.status, j: j || {} }; }, function () { return { code: res.status, j: {} }; }); },
        function () { return { code: 0, j: {} }; })
      .then(function (r) {
        var code = r.code;
        S.reporting = false;
        if (code === 200) {
          C.ackReport(S, b.upto); S.failing = false; S.lastReportAt = Date.now(); save();
          if (typeof r.j.now === 'number') S.skew = r.j.now - Date.now();
          if (r.j.settings && typeof r.j.settings === 'object') applySettings(r.j.settings, sentDirty);
          if (typeof r.j.spentToday === 'number') S.spentServer = { day: C.gameDay(Date.now()), gems: r.j.spentToday };
          if (r.j.command === 'reconnect' && !stopReason) reconnect();
        }
        else if (!stopReason) {
          if (code === 400 || code === 413) { C.ackReport(S, b.upto); S.failing = false; save(); }   // a rejected batch is dropped, never resent
          else if (code === 401) { lsSet(LS_PW, null); halt(); askPassword('That password didn\'t work.'); }
          else if (code === 403) stop('not registered');
          else if (code === 409) stop('superseded');
          else S.failing = true;
        }
        paint();
        if (S.reportSoon && !stopReason && S.active && !S.stopped) { S.reportSoon = false; setTimeout(function () { report(''); }, 0); }
        return code;
      });
  }

  // ---------------------------------------------------------------- run
  function begin() {
    if (S.starting || S.active) return;                    // one password check at a time (a second tap does nothing)
    var a = activity();
    if (!a) { stop('event ended'); return; }
    S.left = claimsLeft(a);
    if (S.left != null && S.left <= 0) { stop('out of claims'); return; }
    S.starting = true;
    showStats();
    // check the password and the account before claiming anything. A saved password was accepted before, so a
    // network failure still lets it collect; a typed one runs only once the server has accepted it.
    report('').then(function (code) {
      S.starting = false;
      if (S.stopped || S.active) return;
      var down = code === 0 || code >= 500;
      if (code === 200) { if (S.pwTyped) { lsSet(LS_PW, S.pw); S.pwTyped = false; } }
      else if (!down) return;
      else if (S.pwTyped) { askPassword('Can\'t reach the Map Collector server. Try again in a minute.'); return; }
      S.active = true;
      S.timers.push(setInterval(scan, SCAN_MS), setInterval(tick, TICK_MS));
      attachNow('page');
    });
  }
  function subscribe() {
    unsubscribe();
    try { S.ec = EC(); S.ec.on('TitanBlessWorldRewardGet', onReward, TARGET); S.ec.on('newChatPush', onChat, TARGET); } catch (e) { S.ec = null; }
  }
  function unsubscribe() {
    try { if (S.ec) { S.ec.off('TitanBlessWorldRewardGet', onReward, TARGET); S.ec.off('newChatPush', onChat, TARGET); } } catch (e) {}
    S.ec = null;
  }
  // Start working against the current game window: fresh event subscriptions, and only notices from the last
  // 2 minutes count as new (seen ids are kept, so nothing is ever claimed twice across a reconnect).
  function attachNow(where) {
    subscribe();
    S.attachAt = Date.now(); S.attached = true; S.reconnecting = 0;
    window.__MAPC.attached = where;
    scan(); paint();
  }
  function waitForGame(limitMs) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        if (S.stopped) return resolve(false);
        if (gameReady()) return resolve(true);
        if (Date.now() - t0 > limitMs) return resolve(false);
        setTimeout(poll, 1000);
      })();
    });
  }
  function note(text, ms) { S.note = text; S.noteUntil = Date.now() + (ms || 60000); paint(); }
  // Unattended mode: pause this page's game and close its connection (only one session ever), then run the
  // same game URL in a frame under the card and attach to it once it has logged in.
  function goUnattended() {
    if (frame) return;
    S.attached = false; window.__MAPC.attached = ''; unsubscribe();
    try { window.cc.game.pause(); } catch (e) {}
    try { window.__require('NetMgr').NET.dispose(true); } catch (e) {}
    frame = document.createElement('iframe');
    frame.id = 'mapc-frame';
    frame.src = location.href;
    frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write');
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147482000;background:#000';
    document.body.appendChild(frame);
    GW = frame.contentWindow;
    showStats(); note('Starting the game in Unattended mode...', 120000);
    S.reconnecting = Date.now();
    waitForGame(ATTACH_LIMIT_MS).then(function (ok) {
      if (!ok) { S.reconnecting = 0; note('The game did not start. Stop and launch again.', 600000); report(''); return; }
      note('Unattended mode: the dashboard can reconnect this game.', 15000);
      attachNow('frame');
    });
  }
  // A reconnect from the dashboard: reload only the game frame (it logs back in), then attach again.
  function reconnect() {
    if (!frame) { note('Reconnect needs Unattended mode', 120000); return; }
    if (S.reconnecting) return;
    S.reconnecting = Date.now(); S.attached = false; window.__MAPC.attached = ''; unsubscribe();
    S.autoTryAt = S.reconnecting;                          // any reconnect restarts the 65-minute auto-reconnect clock
    note('Reconnecting...', ATTACH_LIMIT_MS);
    try { frame.contentWindow.location.reload(); } catch (e) {}
    setTimeout(function () {
      waitForGame(ATTACH_LIMIT_MS).then(function (ok) {
        if (S.stopped) return;
        if (!ok) { S.reconnecting = 0; note('Reconnect failed', 600000); report(''); return; }
        note('Reconnected', 15000);
        attachNow('frame');
      });
    }, 1500);
  }
  function halt() {
    S.active = false; S.attached = false;
    S.timers.forEach(clearInterval); S.timers = [];
    unsubscribe();
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
    if (reason === 'stopped by you') { removeRoot(); if (frame && frame.parentNode) frame.parentNode.removeChild(frame); return; }
    showMessage(STOP_TEXT[reason] || 'Map Collector stopped.', true);
    if (reason === 'out of claims' || reason === 'event ended' || reason === 'superseded') setTimeout(removeRoot, 10000);
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#mapc-root{position:fixed;left:calc(8px + env(safe-area-inset-left));bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#mapc-root .mapc-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #3fb950;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#mapc-root .mapc-card.warn{border-color:#d29922}#mapc-root .mapc-card.bad{border-color:#f85149}#mapc-root .mapc-card.flash{transform:scale(1.04)}',
    '#mapc-root .mapc-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#mapc-root .mapc-title{flex:1;white-space:nowrap}',
    '#mapc-root .mapc-mini{display:none;font-variant-numeric:tabular-nums;color:#3fb950}#mapc-root .min .mapc-mini{display:inline}',
    '#mapc-root button#mapc-min{flex:none;width:36px;min-height:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#mapc-root button#mapc-min:hover{color:#e6edf3;background:#1c2128}#mapc-root #mapc-min svg{transition:transform .2s}#mapc-root .min #mapc-min svg{transform:rotate(180deg)}',
    // folded: one 44 px bar (dot, title, collected count, unfold), the warning colour still on its border
    '#mapc-root .mapc-card.min{width:auto;padding:0 4px 0 12px}#mapc-root .min .mapc-body{display:none}#mapc-root .min .mapc-head{margin:0;height:44px;cursor:pointer}',
    '#mapc-root .mapc-dot{width:8px;height:8px;border-radius:50%;background:#3fb950}#mapc-root .warn .mapc-dot{background:#d29922}#mapc-root .bad .mapc-dot{background:#f85149}',
    '#mapc-root .mapc-row{display:flex;justify-content:space-between;padding:2px 0}#mapc-root .mapc-k{color:#8b949e}#mapc-root .mapc-v{font-variant-numeric:tabular-nums;font-weight:600}',
    '#mapc-root .mapc-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#mapc-root .mapc-msg{margin:4px 0 2px}',
    '#mapc-root .mapc-btns{display:flex;gap:6px;margin-top:8px}',
    '#mapc-root button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128;color:#e6edf3;font:inherit;cursor:pointer}',
    '#mapc-root button[aria-pressed="true"]{border-color:#3fb950;color:#3fb950}#mapc-root button:disabled{opacity:.55;cursor:default}',
    '#mapc-root button:hover{border-color:#79c0ff}#mapc-root input{width:100%;box-sizing:border-box;min-height:44px;margin:6px 0 0;padding:0 10px;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#e6edf3;font:inherit}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    // always this version's styles: an update launched in the same tab must not keep the old ones
    var st = document.getElementById('mapc-style');
    if (!st) { st = el('style'); st.id = 'mapc-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    root = el('div'); root.id = 'mapc-root';
    card = el('div', 'mapc-card');
    var head = el('div', 'mapc-head'); head.appendChild(el('span', 'mapc-title', 'Map Collector'));
    var mini = el('span', 'mapc-mini'); mini.id = 'mapc-mini'; mini.title = 'Collected'; head.appendChild(mini);
    head.appendChild(el('span', 'mapc-dot'));
    var mb = button('mapc-min', '', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });   // the whole bar unfolds
    body = el('div', 'mapc-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }
  // Fold the stats card to one bar (so it does not cover the game) and back; remembered on this browser.
  // Only the stats view folds: password prompts and messages always show in full.
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('mapc-min');
    if (mb) { mb.hidden = v !== 'stats'; mb.setAttribute('aria-label', S.min ? 'Show Map Collector' : 'Minimize Map Collector'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() { S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint(); }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function showStats() {
    ensureRoot(); body.textContent = ''; setView('stats');
    [['Collected', 'mapc-collected'], ['Missed', 'mapc-missed'], ['En route', 'mapc-enroute'], ['Claims left', 'mapc-left'], ['Speed-ups', 'mapc-speed']].forEach(function (r) {
      var row = el('div', 'mapc-row'); row.appendChild(el('span', 'mapc-k', r[0])); var v = el('span', 'mapc-v', '0'); v.id = r[1]; row.appendChild(v); body.appendChild(row);
    });
    var foot = el('div', 'mapc-foot', 'Starting...'); foot.id = 'mapc-foot'; body.appendChild(foot);
    var btns = el('div', 'mapc-btns');
    btns.appendChild(button('mapc-dash', 'Dashboard', function () { window.open(DASH, '_blank', 'noopener'); }));
    btns.appendChild(button('mapc-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    var sb = el('div', 'mapc-btns');
    sb.appendChild(button('mapc-speed-toggle', 'Speed-ups off', toggleSpeed));
    body.appendChild(sb);
    if (!frame) {
      var ub = el('div', 'mapc-btns');
      ub.appendChild(button('mapc-unattended', 'Unattended mode', confirmUnattended));
      body.appendChild(ub);
    }
    paint();
  }
  function confirmUnattended() {
    ensureRoot(); body.textContent = ''; setView('confirm');
    body.appendChild(el('div', 'mapc-msg', 'Unattended mode restarts the game inside this tab so the dashboard can reconnect it after another login. Leave this tab open.'));
    var btns = el('div', 'mapc-btns');
    btns.appendChild(button('mapc-unattended-go', 'Start', goUnattended));
    btns.appendChild(button('mapc-unattended-cancel', 'Cancel', showStats));
    body.appendChild(btns);
    card.className = 'mapc-card';
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'mapc-msg', text));
    if (withClose) { var btns = el('div', 'mapc-btns'); btns.appendChild(button('mapc-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'mapc-card';
  }
  function askPassword(note) {
    ensureRoot(); body.textContent = ''; setView('password');
    body.appendChild(el('div', 'mapc-msg', note || 'Enter your Map Collector password.'));
    var input = el('input'); input.id = 'mapc-pw'; input.type = 'password'; input.autocomplete = 'current-password'; input.setAttribute('aria-label', 'Map Collector password');
    body.appendChild(input);
    var btns = el('div', 'mapc-btns');
    var go = function () { var v = input.value.trim(); if (!v) return; S.pw = v; S.pwTyped = true; begin(); };
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
    var c = C.pillCard(C.summarize(S.maps), S.left, age, health(), { on: S.speed.on, off: !!S.speedOff });
    if (S.paused && Date.now() < S.paused.until && c.tone === 'ok') { c.foot = 'Paused: ' + S.paused.reason; c.tone = 'warn'; }
    if (frame && S.autoAt && !(S.attached && connected()) && !S.reconnecting) {
      c.foot = 'Reconnects by itself at ' + new Date(S.autoAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); c.tone = 'bad';
    }
    else if (S.note && Date.now() < S.noteUntil) { c.foot = S.note; if (c.tone === 'ok' && !/^(Reconnected|Unattended mode:)/.test(S.note)) c.tone = 'warn'; }
    else if (S.speedOff) { c.foot = S.speedNote; if (c.tone === 'ok') c.tone = 'warn'; }
    var ids = ['mapc-collected', 'mapc-missed', 'mapc-enroute', 'mapc-left', 'mapc-speed'];
    c.rows.forEach(function (r, i) { var e = document.getElementById(ids[i]), v = String(r[1]); if (e && e.textContent !== v) e.textContent = v; });
    var f = document.getElementById('mapc-foot'); if (f && f.textContent !== c.foot) f.textContent = c.foot;
    var tg = document.getElementById('mapc-speed-toggle');
    if (tg) {
      var on = String(!!S.speed.on && !S.speedOff), label = S.speedOff ? 'Speed-ups stopped' : S.speed.on ? 'Speed-ups on' : 'Speed-ups off';
      if (tg.getAttribute('aria-pressed') !== on) tg.setAttribute('aria-pressed', on);
      if (tg.textContent !== label) tg.textContent = label;
      tg.disabled = !!S.speedOff;                          // shut off for this run: a relaunch brings them back
    }
    card.className = 'mapc-card' + (c.tone === 'ok' ? '' : ' ' + c.tone) + (S.min && S.view === 'stats' ? ' min' : '');
    var mini = document.getElementById('mapc-mini'), got = String(c.rows[0][1]);
    if (mini && mini.textContent !== got) mini.textContent = got;
  }

  // ---------------------------------------------------------------- start
  window.__MAPC = {
    running: true, attached: '',
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    speed: function () { return { on: S.speed.on, known: S.speed.known, off: S.speedOff, note: S.speedNote }; }
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
