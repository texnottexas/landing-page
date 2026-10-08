// mask-boxes.js — Mask Mystery Boxes: collects the boxes players report on the FunCC intel list
// (game.funcc.xyz/mask-intel, merged with the Top War Fandom Reward Finder by the worker) and the game's own box
// cards and base shares in chat, on any server, with the game's own world view and collect requests: look at the
// owner's city (901), then collect its box (2503). No march, no camera move. Launched from the Ops Center.
// A checked spot is remembered until its box ends (30 min when there was none), whoever shares it again.
// Sharing mode (off by default): after a collect, the game's own box card goes to world chat unless world chat
// already has it, at least 10 s after the last share, through the chat controller's sendToWorldChannel.
// Rules live in mask-boxes-core.js (window.MaskBoxesCore); this file talks to the game, the worker and the page.
// Every request waits for the shared Ops request clock, so no two requests from any Ops tool go under 1.1 s apart.
(function () {
  'use strict';
  if (window.__MBX && window.__MBX.running) { window.__MBX.flash(); return; }
  var C = window.MaskBoxesCore;
  if (!C) { try { alert('Mask Mystery Boxes did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-08';
  var WORKER = window.__MBX_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = !!window.__MBX_FAST, FEED_MS = window.__MBX_FEED_MS || 60000, TIMEOUT_MS = window.__MBX_TIMEOUT_MS || 8000;
  var LATE_MS = window.__MBX_LATE_MS || 30000;            // an unanswered request counts as in flight this long
  var VIEW = 901, COLLECT = 2503;                          // RequestId world view, Mask Mystery box collect (PB v2)
  var LS_TYPES = 'mbx_types_v1', LS_COUNT = 'mbx_count_v1_', LS_DONE = 'mbx_done_v1_', LS_MIN = 'mbx_min_v1', LS_SPOTS = 'mbx_spots_v1_';
  var LS_SHARE = 'mbx_share_v1', LS_SHARED = 'mbx_shared_v1_', LS_RATE = 'mbx_rate_v1_';
  // Share mode is one player per home server, held through the worker; renewals every 60 s, and we let go after
  // 2.5 min without a good one (the worker frees a hold after 3), so two players never both think they hold it.
  var SHARE_BEAT_MS = window.__MBX_SHARE_BEAT_MS || 60000, SHARE_LOST_MS = window.__MBX_SHARE_LOST_MS || 150000;
  var TARGET = {};                                         // NET.send wants a target; a plain object is always valid

  // ---------------------------------------------------------------- game
  // The game window: this page, or the game Map Collector runs in a frame in Unattended mode in this tab.
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return window;
  }
  function req(n) { return GW().__require(n); }
  function NET() { return req('NetMgr').NET; }
  function UD() { return req('DataCenter').DATA.UserData; }
  function connected() { try { var s = NET()._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  // connected and logged in (a reloading frame can have an open socket before the player is in)
  function ready() { try { var U = UD(); return !!(U && U.Name) && connected(); } catch (e) { return false; } }
  // Chat the game already holds: every room's messages, and world chat (room keys starting with 0) on its own.
  // Read through GW() each time, so a reconnect or an Unattended frame reload never leaves us on stale lists.
  function chatCtl() { return req('newChatController').newChatController._instance; }
  function chatLists() {
    var out = { all: [], world: [], worldOk: false };       // worldOk: a world room with messages was found
    try {
      var L = chatCtl()._userChatList || {};
      Object.keys(L).forEach(function (k) {
        var l = L[k]; if (!Array.isArray(l) || !l.length) return;
        out.all = out.all.concat(l);
        if (k.charAt(0) === '0') { out.world = out.world.concat(l); out.worldOk = true; }
      });
    } catch (e) {}
    return out;
  }
  function gameText(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
  function itemLabel(items) {
    return (Array.isArray(items) ? items : []).filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
      var name = '';
      try {
        var row = req('TableManager').TABLE.getTableDataById('item', it.itemId), L = req('LocalManager');
        if (row && row.name) name = (L.LOCAL || L.default).getText(row.name);
      } catch (e) {}
      return (name && name !== row.name ? name : 'item ' + it.itemId) + ' ×' + (it.itemCount || 1);
    }).join(', ');
  }
  // Never two requests in flight: one that timed out still counts until its answer arrives or LATE_MS pass.
  var flight = null, flightSeq = 0;
  function call(send) {
    return new Promise(function (resolve) {
      var done = false, ok, mine = { seq: ++flightSeq, at: Date.now() };
      flight = mine;
      var land = function () { if (flight === mine) flight = null; };
      var t = setTimeout(function () { if (!done) { done = true; resolve({ s: 'timeout' }); } }, TIMEOUT_MS);
      try { ok = send(function (r) { land(); if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); }); } catch (e) { ok = false; }
      if (ok === false && !done) { land(); done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  async function idle() {
    while (S.running && flight && Date.now() - flight.at < LATE_MS) { setFoot('Waiting for the game to answer...', 'warn'); await delay(250); }
    flight = null;
  }
  function sendView(b) {
    return call(function (cb) { return NET().send(VIEW, { x: b.x, y: b.y, k: b.server, rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 }, TARGET, cb); });
  }
  function sendCollect(pid) { return call(function (cb) { return NET().sendPBV2(COLLECT, { targetUidStr: pid }, TARGET, cb); }); }
  // One request clock for every Ops tool in this tab (Map Collector too).
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + 1100 + Math.floor(Math.random() * 200) - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------------------------------------------------------------- state
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(n) { return Math.floor(Math.random() * n); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } }

  var S = {
    running: false, stopped: false, siteKey: '', boxes: [], feedOk: true, nextFetch: 0, tried: {}, log: [],
    chat: [], bases: [], worldCards: [], spots: {}, baseLog: [], wake: false, nextIn: 0,
    share: false, shareWant: lsGet(LS_SHARE) === '1', shareMsg: '', shareBusy: false, shareOkAt: 0, beat: null,
    shareQ: [], lastShareAt: 0, shared: null, lastShare: '', worldOk: false, shareStopped: '',
    types: { 1: true, 2: true, 3: true }, count: null, done: null, last: '', foot: 'Starting...', tone: 'ok',
    min: lsGet(LS_MIN) === '1', view: ''
  };
  function today() { return C.gameDay(Date.now()); }
  // ours, raised to the game's own count (UserData.itemCityRewardReceivedNum) when the game has sent one today
  var server = null;
  function readServer() { try { server = C.trackServer(server, UD().itemCityRewardReceivedNum, today()); } catch (e) {} }
  function serverIds() { try { var a = UD().itemCityRewardReceivedInstIds; return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
  function counts() { return C.countsWith(C.countsFor(S.count, today()), server, today()); }
  function bump(type) {
    var c = counts(); c[type] = (c[type] || 0) + 1;
    S.count = { day: today(), counts: c }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count));
  }
  function doneIds() { return S.done && S.done.day === today() && Array.isArray(S.done.ids) ? S.done.ids : []; }
  function markDone(id) {
    var ids = doneIds().slice(-400); ids.push(id);
    S.done = { day: today(), ids: ids }; lsSet(LS_DONE + S.siteKey, JSON.stringify(S.done));
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  function readChat() {
    var now = Date.now(), L = chatLists();
    S.chat = C.chatBoxes(L.all, now); S.bases = C.baseShares(L.world, now); S.worldCards = C.chatBoxes(L.world, now); S.worldOk = L.worldOk;
  }
  // A checked spot is remembered until its box ends (30 min with no box), at the reported spot and the city anchor.
  function remember(b, pt) {
    var now = Date.now(), until = pt && pt.endMs > now ? pt.endMs : now + C.SPOT_NO_BOX_MS;
    S.spots = C.rememberSpot(S.spots, C.cityKey(b), until);
    if (pt && pt.w) S.spots = C.rememberSpot(S.spots, pt.w + ':' + pt.x + ':' + pt.y, until);
    var s = C.pruneSpots(S.spots, now), keys = Object.keys(s);
    if (keys.length > 3000) keys.sort(function (a, c) { return s[a] - s[c]; }).slice(0, keys.length - 3000).forEach(function (k) { delete s[k]; });
    S.spots = s; lsSet(LS_SPOTS + S.siteKey, JSON.stringify(s));
  }
  // ---------------------------------------------------------------- sharing
  function sharedIds() { return S.shared && S.shared.day === today() && Array.isArray(S.shared.ids) ? S.shared.ids : []; }
  function markShared(id) {
    var ids = sharedIds().slice(-400); ids.push(id);
    S.shared = { day: today(), ids: ids }; lsSet(LS_SHARED + S.siteKey, JSON.stringify(S.shared));
  }
  // The host's name as the game shows it (PlayerInfo.getDisplayName), else the raw username.
  function hostName(info) {
    try { var P = req('PlayerInfo'), pi = new (P.default || P)(); pi.update(info); var n = pi.getDisplayName(); if (n) return String(n); } catch (e) {}
    try { return String(JSON.parse(info).username || ''); } catch (e) { return ''; }
  }
  function partyRow(itemId) {
    try { var T = req('TableManager').TABLE; for (var i = 1; i <= 8; i++) { var r = T.getTableDataById('mask_mystery_party', i); if (r && Number(r.item_id) === Number(itemId)) return r; } } catch (e) {}
    return null;
  }
  // The share gap and the base-share ration hold across a relaunch, like the daily counts and spot memory.
  function saveRate() { lsSet(LS_RATE + S.siteKey, JSON.stringify({ lastShareAt: S.lastShareAt, baseLog: S.baseLog.filter(function (t) { return t > Date.now() - 600000; }) })); }
  function shareCheckFor(q) {
    return C.shareCheck({ on: shareFresh() && !S.shareStopped, typeOn: !!S.types[q.type], endMs: q.pt.endMs, now: Date.now(), sharedIds: sharedIds(), instanceId: q.instanceId,
      worldCards: S.worldCards, worldOk: S.worldOk, server: q.pt.w, x: q.pt.x, y: q.pt.y, lastShareAt: S.lastShareAt });
  }
  // Shares wait in a short queue: until the game lists the box as collected (15 s at most), then until 10 s after
  // the last share; each is checked again (world chat, 5 minutes left) just before it goes out.
  async function sharePending() {
    while (S.running && S.shareQ.length) {
      var q = S.shareQ[0], now = Date.now();
      if (serverIds().indexOf(q.instanceId) < 0) { if (now - q.at > 15000) { S.shareQ.shift(); continue; } return; }
      readChat();
      var chk = shareCheckFor(q);
      if (!chk.ok && chk.reason === 'wait') return;
      S.shareQ.shift();
      if (!chk.ok) continue;
      var link = C.shareLink(q.type, q.pt, q.host, partyRow(q.pt.itemId));
      if (!link) continue;
      if (!(await turn())) { S.shareQ.unshift(q); return; }   // the shared clock, and still connected
      readChat();                                             // the wait can be long: switched off, type off, or shared meanwhile?
      chk = shareCheckFor(q);
      if (!chk.ok) continue;
      try { var g = GW(); if (g.cc && typeof g.cc.v2 === 'function') link.p = g.cc.v2(q.pt.x, q.pt.y); } catch (e) {}
      S.lastShareAt = Date.now(); saveRate();                // the gap counts even if the call throws after sending
      try { chatCtl().sendToWorldChannel(link); }
      catch (e) { S.shareStopped = 'the game refused a share'; S.shareQ = []; paint(); return; }   // unknown: stop sharing for this run
      markShared(q.instanceId);
      S.lastShare = C.TYPES[q.type] + ' S' + q.pt.w + ' (' + q.pt.x + ', ' + q.pt.y + ')';
      paint();
    }
  }
  // ---- share mode: one sharer per home server (POST /maskshare/claim | release on the worker)
  function homeServer() { try { var u = UD(); return Number(u.OriginServerId || u.ServerId) || 0; } catch (e) { return 0; } }
  function shareBody() { var n = ''; try { n = String(UD().Name || ''); } catch (e) {} return JSON.stringify({ siteKey: S.siteKey, name: n.slice(0, 40), server: homeServer() }); }
  async function shareCall(path) {                          // text/plain keeps it a simple request: no preflight
    try {
      var r = await fetch(WORKER + '/maskshare/' + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: shareBody(), cache: 'no-store', keepalive: true });
      var j = null; try { j = await r.json(); } catch (e) {}
      if (r.ok && j && j.ok) return { ok: true };
      if (r.status === 409 && j) return { ok: false, holder: String(j.holder || 'Another player').slice(0, 40) };
      return { ok: false };
    } catch (e) { return { ok: false }; }
  }
  function takenText(holder) { return holder + ' already has share mode on.'; }
  function shareFresh() { return S.share && Date.now() - S.shareOkAt <= SHARE_LOST_MS; }
  // Off by choice or because the hold is gone: forget the choice; release only what we still hold.
  function shareOff(msg, stillHeld) {
    S.share = false; S.shareQ = []; S.shareMsg = msg || ''; lsSet(LS_SHARE, null);
    if (stillHeld) shareCall('release');
    paint();
  }
  async function shareOn() {
    if (S.shareBusy || S.share) return;
    S.shareBusy = true; S.shareMsg = 'Checking who is sharing...'; paint();
    var r = await shareCall('claim');
    S.shareBusy = false;
    if (S.stopped) { if (r.ok) shareCall('release'); return; }
    if (r.ok) { S.share = true; S.shareOkAt = Date.now(); S.shareMsg = ''; lsSet(LS_SHARE, '1'); paint(); return; }
    shareOff(r.holder ? takenText(r.holder) : "Couldn't check who's sharing. Share stays off.", false);
  }
  async function shareBeat() {
    if (!S.running || !S.share || S.shareBusy) return;
    var r = await shareCall('claim');
    if (!S.share) return;                                   // switched off meanwhile
    if (r.ok) { S.shareOkAt = Date.now(); return; }
    if (r.holder) { shareOff(takenText(r.holder), false); return; }
    if (Date.now() - S.shareOkAt > SHARE_LOST_MS) shareOff('Lost contact with the share check, so Share turned off.', true);
  }
  function onPageHide() {                                   // the tab closing: free share mode for the next player
    if (!S.share) return;
    try { navigator.sendBeacon(WORKER + '/maskshare/release', new Blob([shareBody()], { type: 'text/plain' })); } catch (e) {}
  }
  function toggleShare() { if (S.shareBusy) return; if (S.share) shareOff('', true); else shareOn(); }
  // The new-chat event only wakes the loop early; the lists themselves are read every turn.
  var ecSub = null;
  function onChat() { S.wake = true; }
  function subscribe() { try { ecSub = req('EventCenter').EventCenter.getInst(); ecSub.on('newChatPush', onChat, TARGET); } catch (e) { ecSub = null; } }
  function unsubscribe() { try { if (ecSub) ecSub.off('newChatPush', onChat, TARGET); } catch (e) {} ecSub = null; }

  // ---------------------------------------------------------------- the loop
  async function fetchFeed() {
    S.nextFetch = Date.now() + FEED_MS;
    try {
      var r = await fetch(WORKER + '/maskintel', { cache: 'no-store' }), j = await r.json();
      if (!r.ok || !j || !j.ok || !Array.isArray(j.boxes)) throw new Error('feed');
      S.boxes = j.boxes; S.feedOk = true;
    } catch (e) { S.feedOk = false; }
  }
  // Wait for the next feed check, leaving early when chat brings something to try.
  async function untilNextFetch(text, tone) {
    while (S.running && Date.now() < S.nextFetch) {
      S.nextIn = Math.max(1, Math.ceil((S.nextFetch - Date.now()) / 1000));
      setFoot(text, tone);
      await delay(FAST ? 250 : 1000);
      S.wake = false;
      if (S.shareQ.length && ready()) await sharePending();
      readChat();
      if (nextWork()) return;
    }
  }
  function allBoxes() { return C.mergeBoxes([S.feedOk ? S.boxes : [], S.chat]); }
  // Known boxes (feed and cards) first, soonest-ending; a base share only when none is due.
  function nextWork() {
    var o = { now: Date.now(), types: S.types, tried: S.tried, counts: counts(), spots: S.spots };
    var list = C.candidates(allBoxes(), o);
    if (list.length) return list[0];
    // a base share is only worth a view while some type is on and under its 20
    var c = counts(), any = [1, 2, 3].some(function (t) { return S.types[t] && (c[t] || 0) < C.DAILY_CAP; });
    if (!any) return null;
    o.baseLog = S.baseLog;
    return C.baseCandidate(S.bases, o);
  }
  function waitingText() { return S.feedOk ? 'Waiting for new boxes' : S.chat.length || S.bases.length ? 'Box list unavailable · using chat (' + S.chat.length + ')' : 'Box list unavailable'; }
  async function loop() {
    try { await run(); }
    catch (e) { stop('something went wrong (' + String((e && e.message) || e).slice(0, 60) + ')'); }
  }
  async function run() {
    while (S.running) {
      if (Date.now() >= S.nextFetch) await fetchFeed();
      if (!S.running) break;
      readChat();
      if (!S.feedOk && !S.chat.length && !S.bases.length) { await untilNextFetch('Box list unavailable', 'warn'); continue; }
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(1000); continue; }
      readServer();
      if (S.shareQ.length) await sharePending();
      if (!S.running) break;
      var next = nextWork();
      if (!next) { await untilNextFetch(waitingText(), S.feedOk ? 'ok' : 'warn'); continue; }
      var g = C.gate(S.log, Date.now());
      if (!g.ok) { setFoot('Paused: ' + g.reason, 'warn'); await delay(Math.min(5000, Math.max(250, g.until - Date.now()))); continue; }
      S.nextIn = 0;
      await tryBox(next);
      if (S.running) await delay(FAST ? 0 : 3000 + rand(2000));
    }
  }
  function note(kind) { S.log.push({ t: Date.now(), kind: kind }); if (S.log.length > 200) S.log.shift(); }
  // One box: look at the owner's city, and if the box is still there and new to us, collect it.
  function stopText(key, fallback) { return key ? gameText(key) || 'The game answered ' + key + '.' : fallback; }
  // Wait for the shared clock, then check again: the wait can be long, and the game can drop meanwhile.
  async function turn() { await idle(); await pace(); return S.running && ready() && !flight; }
  async function tryBox(b) {
    var isBase = b.src === 'base', where = 'S' + b.server + ' (' + b.x + ', ' + b.y + ')';
    setFoot(isBase ? 'Checking a shared base at ' + where : 'Checking ' + C.TYPES[b.type] + ' at ' + where, 'ok');
    if (!(await turn())) return;                            // nothing sent: the box stays untried
    S.tried[isBase ? C.cityKey(b) : C.boxKey(b)] = 1;
    if (isBase) { S.baseLog.push(Date.now()); saveRate(); }
    var answer = await sendView(b);
    var found = C.findBox(answer, b.x, b.y, b.server, isBase ? undefined : b.endMs);
    if (found.state === 'stop') { note('failed'); stop(stopText(found.key, 'the game refused to show that city.')); return; }
    if (found.state !== 'box') { if (found.state === 'gone') remember(b, null); note(found.state === 'gone' ? 'gone' : 'failed'); return; }
    found.pt = C.boxPoint(answer, found.pid);
    remember(b, found.pt);
    readServer();
    if (doneIds().indexOf(found.instanceId) >= 0 || serverIds().indexOf(found.instanceId) >= 0) { note('claimed'); return; }
    var type = found.type;                                  // from the box's own item; 0 = not a Mask Mystery box
    if (!type || !S.types[type] || counts()[type] >= C.DAILY_CAP) { note('gone'); return; }   // unknown, off or full
    await delay(FAST ? 0 : 1500 + rand(1500));             // a person's pause between looking and tapping
    if (!S.running) return;
    if (!(await turn())) { note('aborted'); return; }       // the view went out, the collect never did
    var c = C.classifyCollect(await sendCollect(found.pid));
    note(c.kind === 'ok' || c.kind === 'claimed' ? c.kind : 'failed');
    if (c.kind === 'ok') {
      bump(type); markDone(found.instanceId); S.last = itemLabel(c.items) + ' from ' + where;
      if (S.share && !S.shareStopped && found.pt) S.shareQ.push({ instanceId: found.instanceId, type: type, pt: found.pt, host: hostName(found.pt.info), at: Date.now() });
    }
    else if (c.kind === 'claimed') markDone(found.instanceId);
    else if (c.kind === 'stop') { stop(stopText(c.key, 'a collect came back without a reward.')); return; }
    paint();
  }

  // ---------------------------------------------------------------- start / stop
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; S.running = false;
    window.__MBX.running = false;
    unsubscribe();
    if (S.beat) { clearInterval(S.beat); S.beat = null; }
    window.removeEventListener('pagehide', onPageHide);
    if (S.share) { S.share = false; shareCall('release'); }   // the choice stays remembered for the next launch
    if (reason === 'stopped by you') { removeRoot(); return; }
    showMessage('Mask Mystery Boxes stopped: ' + reason, true);
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#mbx-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#mbx-root .mbx-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #3fb950;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#mbx-root .mbx-card.warn{border-color:#d29922}#mbx-root .mbx-card.bad{border-color:#f85149}#mbx-root .mbx-card.flash{transform:scale(1.04)}',
    '#mbx-root .mbx-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#mbx-root .mbx-title{flex:1;white-space:nowrap}',
    '#mbx-root .mbx-dot{width:8px;height:8px;border-radius:50%;background:#3fb950}#mbx-root .warn .mbx-dot{background:#d29922}#mbx-root .bad .mbx-dot{background:#f85149}',
    '#mbx-root .mbx-mini{display:none;font-variant-numeric:tabular-nums;color:#3fb950}#mbx-root .min .mbx-mini{display:inline}',
    '#mbx-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#mbx-root button#mbx-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#mbx-root button#mbx-min:hover{color:#e6edf3;background:#1c2128}#mbx-root #mbx-min svg{transition:transform .2s}#mbx-root .min #mbx-min svg{transform:rotate(180deg)}',
    '#mbx-root .mbx-card.min{width:auto;padding:0 4px 0 12px}#mbx-root .min .mbx-body{display:none}#mbx-root .min .mbx-head{margin:0;height:44px;cursor:pointer}',
    '#mbx-root .mbx-types{display:flex;gap:4px}',
    '#mbx-root .mbx-type{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:44px;padding:2px 4px;border:1px solid #30363d;border-radius:8px;background:#1c2128;line-height:1.2}',
    '#mbx-root .mbx-type span{font-size:11px}',
    '#mbx-root .mbx-type[aria-pressed="true"]{border-color:#3fb950}#mbx-root .mbx-type[aria-pressed="false"]{color:#8b949e;background:transparent}',
    '#mbx-root .mbx-type b{font-variant-numeric:tabular-nums}',
    '#mbx-root .mbx-src{color:#8b949e;font-size:11px;margin-top:2px;font-variant-numeric:tabular-nums}',
    '#mbx-root .mbx-foot,#mbx-root .mbx-src,#mbx-root .mbx-last,#mbx-root .mbx-shared{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mbx-root .mbx-shared{color:#79c0ff;font-size:12px;margin-top:2px}#mbx-root .mbx-shared:empty{display:none}',
    '#mbx-root .mbx-btns button#mbx-share[aria-pressed="true"]{border-color:#3fb950;color:#3fb950}',
    '#mbx-root .mbx-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#mbx-root .mbx-last{color:#3fb950;font-size:12px;margin-top:2px}#mbx-root .mbx-last:empty{display:none}',
    '#mbx-root .mbx-msg{margin:4px 0 2px}#mbx-root .mbx-btns{display:flex;gap:6px;margin-top:8px}',
    '#mbx-root .mbx-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#mbx-root .mbx-btns button:hover{border-color:#79c0ff}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('mbx-style');           // always this version's styles (an update in the same tab)
    if (!st) { st = el('style'); st.id = 'mbx-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('mbx-root');        // a stopped run's message card, never closed
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'mbx-root';
    card = el('div', 'mbx-card');
    var head = el('div', 'mbx-head');
    head.appendChild(el('span', 'mbx-title', 'Mask Boxes'));
    var mini = el('span', 'mbx-mini'); mini.id = 'mbx-mini'; mini.title = 'Collected today'; head.appendChild(mini);
    head.appendChild(el('span', 'mbx-dot'));
    var mb = el('button'); mb.id = 'mbx-min'; mb.type = 'button';
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'mbx-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }
  // Fold the card to one bar and back (remembered); only the running view folds, messages always show in full.
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('mbx-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Mask Boxes' : 'Minimize Mask Boxes'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() { S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint(); }
  function button(id, label, fn, cls) { var b = el('button', cls || null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    var row = el('div', 'mbx-types');                       // one row of three, so the card stays short beside Map Collector's
    [1, 2, 3].forEach(function (t) {
      var b = button('mbx-t' + t, '', function () { S.types[t] = !S.types[t]; lsSet(LS_TYPES, JSON.stringify(S.types)); paint(); }, 'mbx-type');
      b.appendChild(el('span', null, C.TYPES[t])); b.appendChild(el('b', null, '0/' + C.DAILY_CAP));
      row.appendChild(b);
    });
    body.appendChild(row);
    var foot = el('div', 'mbx-foot'); foot.id = 'mbx-foot'; body.appendChild(foot);
    var src = el('div', 'mbx-src'); src.id = 'mbx-src'; body.appendChild(src);
    var last = el('div', 'mbx-last'); last.id = 'mbx-last'; body.appendChild(last);
    var sh = el('div', 'mbx-shared'); sh.id = 'mbx-shared'; body.appendChild(sh);
    var btns = el('div', 'mbx-btns');
    btns.appendChild(button('mbx-share', 'Share: off', toggleShare));
    btns.appendChild(button('mbx-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'mbx-msg', text));
    if (withClose) { var btns = el('div', 'mbx-btns'); btns.appendChild(button('mbx-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'mbx-card';
  }
  function paint() {
    if (!root || S.view !== 'run') return;
    readServer();
    var c = counts(), rows = C.cardRows(c, S.types), total = c[1] + c[2] + c[3];
    rows.forEach(function (r, i) {
      var b = document.getElementById('mbx-t' + (i + 1)); if (!b) return;
      var on = String(r[2]); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
      var n = b.querySelector('b'); if (n && n.textContent !== r[1]) n.textContent = r[1];
      var al = r[0] + ' ' + r[1] + ' since reset'; if (b.getAttribute('aria-label') !== al) b.setAttribute('aria-label', al);
    });
    var f = document.getElementById('mbx-foot'); if (f && f.textContent !== S.foot) { f.textContent = S.foot; f.title = S.foot; }
    var srcText = (S.feedOk ? 'List ' + S.boxes.length : 'List down') + ' · Chat ' + S.chat.length + (S.bases.length ? ' · Bases ' + S.bases.length : '') +
      (S.nextIn ? ' · next ' + S.nextIn + ' s' : '');
    var sl = document.getElementById('mbx-src'); if (sl && sl.textContent !== srcText) { sl.textContent = srcText; sl.title = srcText; }
    var lt = S.last ? 'Last: ' + S.last : '';
    var l = document.getElementById('mbx-last'); if (l && l.textContent !== lt) { l.textContent = lt; l.title = lt; }
    var m = document.getElementById('mbx-mini'); if (m && m.textContent !== String(total)) m.textContent = String(total);
    var n = sharedIds().length, shText = S.shareMsg ? S.shareMsg : S.shareStopped ? 'Sharing stopped: ' + S.shareStopped : n || S.share ? 'Shared ' + n + (S.lastShare ? ' · last ' + S.lastShare : '') : '';
    var shl = document.getElementById('mbx-shared'); if (shl && shl.textContent !== shText) { shl.textContent = shText; shl.title = shText; }
    var sb = document.getElementById('mbx-share');
    if (sb) { var on = String(!!S.share); if (sb.getAttribute('aria-pressed') !== on) sb.setAttribute('aria-pressed', on); var st = S.shareBusy ? 'Share: ...' : S.share ? 'Share: on' : 'Share: off'; if (sb.textContent !== st) sb.textContent = st; sb.title = 'Share collected boxes to world chat'; }
    card.className = 'mbx-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (S.min ? ' min' : '');
  }

  // ---------------------------------------------------------------- start
  window.__MBX = {
    running: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { counts: counts(), tried: Object.keys(S.tried).length, last: S.last, foot: S.foot, types: S.types, chat: S.chat.length, bases: S.bases.length, spots: Object.keys(S.spots).length, share: S.share, shared: sharedIds().length, queued: S.shareQ.length }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var id = ''; try { var u = UD(); id = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!id) { showMessage('Open the game and log in first.', true); window.__MBX.running = false; return; }
  sha256Hex(id).then(function (h) {
    S.siteKey = h.slice(0, 16);
    var t = lsJSON(LS_TYPES); if (t && typeof t === 'object') [1, 2, 3].forEach(function (k) { if (typeof t[k] === 'boolean') S.types[k] = t[k]; });
    S.count = lsJSON(LS_COUNT + S.siteKey); S.done = lsJSON(LS_DONE + S.siteKey);
    var sp = lsJSON(LS_SPOTS + S.siteKey); S.spots = C.pruneSpots(sp && typeof sp === 'object' ? sp : {}, Date.now());
    S.shared = lsJSON(LS_SHARED + S.siteKey);
    var rt = lsJSON(LS_RATE + S.siteKey);
    if (rt && typeof rt === 'object') {
      if (Number(rt.lastShareAt) > 0) S.lastShareAt = Number(rt.lastShareAt);
      if (Array.isArray(rt.baseLog)) S.baseLog = rt.baseLog.map(Number).filter(function (t) { return t > Date.now() - 600000; });
    }
    if (S.stopped) return;
    S.running = true;
    subscribe();
    showRun();
    S.beat = setInterval(shareBeat, SHARE_BEAT_MS);
    window.addEventListener('pagehide', onPageHide);
    if (S.shareWant) shareOn();                             // remembered on: claim share mode before any share
    loop();
  });
})();
