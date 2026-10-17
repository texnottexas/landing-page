// looter-locator.js — Looter Locator: during Loot Quest, finds the looters from other servers on our map and posts them
// to chat. One person per alliance runs it (the worker's runner slot, POST /looter/claim); anyone else in that alliance
// is sent back to the Ops Center. Of the runners, one posts to world chat and then its alliance chat 2 s later; the
// others post to their own alliance chat (Tex). It reads the game's own looter list (7575, the
// Defense panel) every minute and when the game says a looter crossed in, finds new looters with zoom-level-1 map views
// (901, 120 x 80 tiles each, the camera never moves), looks at each found looter's spot every 30 s and posts again only
// when they moved. Nothing goes to a chat that already has that spot from the last 5 minutes. Launched from the Ops
// Center. Rules live in looter-locator-core.js (window.LooterCore). Every request waits for the shared Ops clock.
(function () {
  'use strict';
  if (window.__LOOT && window.__LOOT.running) { window.__LOOT.flash(); return; }
  var C = window.LooterCore;
  if (!C) { try { alert('Looter Locator did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-17';
  var WORKER = window.__LOOT_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = window.__LOOT_GAP_MS != null, GAP_MS = window.__LOOT_GAP_MS || 1500;   // Tex: every 1.5 s is fine
  var LIST_MS = window.__LOOT_LIST_MS || C.LIST_MS, RECHECK_MS = window.__LOOT_RECHECK_MS || C.RECHECK_MS, PUSH_MS = window.__LOOT_PUSH_MS || C.PUSH_DELAY_MS;
  var BOUNCE_MS = window.__LOOT_BOUNCE_MS || C.BOUNCE_MS, TIMEOUT_MS = window.__LOOT_TIMEOUT_MS || 10000, PAUSE_MS = window.__LOOT_PAUSE_MS || C.PAUSE_MS;
  var MAX_MIN = window.__LOOT_MAX_PER_MIN || C.MAX_PER_MIN, MAX_10 = window.__LOOT_MAX_PER_10 || C.MAX_PER_10;   // tests only
  var SHARE_GAP_MS = window.__LOOT_SHARE_GAP_MS || C.SHARE_GAP_MS, RENEW_MS = window.__LOOT_RENEW_MS || 60000, LOST_MS = 150000, STUCK_MS = window.__LOOT_STUCK_MS || 180000;
  var EVENT = 'UPDATE_CS_HUNT_ASSEMBLY_TIPS';             // the game's event for the cross-in push (21380 {sid})
  var VIEW = 901, LIST = 7575, INFO = 7571;               // what the game used on 2026-10-16; read live when it names them
  var LS_SHARE = 'loot_share_v1', LS_MIN = 'loot_min_v1', LS_COUNT = 'loot_count_v1_';
  var TARGET = {};

  // ---------------------------------------------------------------- game
  // The game window: this page, or the game Map Collector runs in a frame in Unattended mode in this tab.
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return window;
  }
  function req(n) { return GW().__require(n); }
  function NET() { return req('NetMgr').NET; }
  function DATA() { return req('DataCenter').DATA; }
  function UD() { return DATA().UserData; }
  function connected() { try { var s = NET()._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function ready() { try { var U = UD(); return !!(U && U.Name) && connected(); } catch (e) { return false; } }
  function ids() {
    var o = { view: VIEW, list: LIST, info: INFO };
    try { var r = req('RequestId').RequestId.GET_WORLD_INFO; if (typeof r === 'number') o.view = r; } catch (e) {}
    try { var n = req('NRequestId').NRequestId; if (typeof n.CROSS_TREASURE_GET_CROSS_IN_INFOS === 'number') o.list = n.CROSS_TREASURE_GET_CROSS_IN_INFOS; if (typeof n.CROSS_TREASURE_POINT_INFO === 'number') o.info = n.CROSS_TREASURE_POINT_INFO; } catch (e) {}
    return o;
  }
  function hunt() { try { return req('CSHuntController').CSHuntController.getInstance(); } catch (e) { return null; } }
  function serverMs() { try { var t = Number(DATA().ServerTime); return t > 0 ? t * 1000 : Date.now(); } catch (e) { return Date.now(); } }
  function mapK() { try { return Number(UD().ServerId) || 0; } catch (e) { return 0; } }
  function homeServer() { try { var u = UD(); return Number(u.OriginServerId || u.ServerId) || 0; } catch (e) { return 0; } }
  function gameText(key, arg) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key, arg); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
  function displayName(info) {
    try { var P = req('PlayerInfo'), pi = new (P.default || P)(); pi.update(info); var n = pi.getDisplayName(); if (n) return String(n); } catch (e) {}
    try { return String(JSON.parse(info).username || ''); } catch (e) { return ''; }
  }
  function chatCtl() { return req('newChatController').newChatController._instance; }
  // A chat's messages: world rooms start with '0', the alliance room with '2'.
  function rows(first) {
    var out = [];
    try { var L = chatCtl()._userChatList || {}; Object.keys(L).forEach(function (k) { if (k.charAt(0) === first && Array.isArray(L[k])) out = out.concat(L[k]); }); } catch (e) {}
    return out;
  }
  function allianceId() { try { var A = UD().Alliance || {}; var a = Number(A._aid || A.Aid || 0); return a > 0 && a % 1 === 0 ? a : 0; } catch (e) { return 0; } }
  function bus() { try { var m = req('EventCenter'); return m && m.EVENT; } catch (e) { return null; } }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------------------------------------------------------------- state
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } }
  var S = { running: false, stopped: false, view: '', siteKey: '', name: '', share: lsGet(LS_SHARE) !== '0', min: lsGet(LS_MIN) === '1',
    list: [], listAt: 0, wantList: true, pushAt: 0, tracked: {}, holds: {}, log: [], fails: 0, pausedUntil: 0, pauseWhy: '', busySince: 0,
    passOn: false, passAt: 0, late: false, lateChecked: false, lastShareAt: 0, lastAllyAt: 0, world: false, worldHolder: '', infoAsked: {}, leaseOkAt: 0, renewAt: 0, count: null, foot: 'Starting...', tone: 'ok', bus: null };
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  function reportUsage() {
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: S.name, tool: 'looter-locator', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }

  // ---------------------------------------------------------------- the runner slot (worker)
  function slotBody() { return JSON.stringify({ siteKey: S.siteKey, name: S.name.slice(0, 40), server: homeServer(), aid: allianceId(), share: S.share }); }
  async function claim() {                                // text/plain keeps it a simple request: no preflight
    try {
      var r = await fetch(WORKER + '/looter/claim', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: slotBody(), cache: 'no-store' });
      var j = null; try { j = await r.json(); } catch (e) {}
      if (r.ok && j && j.ok) return { ok: true, world: j.world === true, worldHolder: String(j.worldHolder || '').slice(0, 40) };
      if (r.status === 409 && j) return { ok: false, holder: String(j.holder || 'Another player').slice(0, 40) };
      return { ok: false };
    } catch (e) { return { ok: false }; }
  }
  function release() {
    try { if (navigator.sendBeacon && navigator.sendBeacon(WORKER + '/looter/release', new Blob([slotBody()], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch(WORKER + '/looter/release', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: slotBody(), cache: 'no-store', keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function onHide() { if (S.running) release(); }
  async function renew() {
    if (Date.now() < S.renewAt) return true;
    S.renewAt = Date.now() + RENEW_MS;
    var r = await claim();
    if (r.ok) { S.leaseOkAt = Date.now(); setRole(r); return true; }
    if (r.holder) { stop(r.holder + ' is running it for your alliance now.'); return false; }
    if (Date.now() - S.leaseOkAt > LOST_MS) { stop("it lost contact with 2864tw.com, so it stepped aside. Open it again in a minute."); return false; }
    S.renewAt = Date.now() + Math.min(RENEW_MS, 15000);    // try again soon
    return true;
  }

  // ---------------------------------------------------------------- requests
  function call(send) {
    return new Promise(function (resolve) {
      var done = false, ok;
      var t = setTimeout(function () { if (!done) { done = true; resolve({ s: 'timeout' }); } }, TIMEOUT_MS);
      try { ok = send(function (r) { if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); }); } catch (e) { ok = false; }
      if (ok === false && !done) { done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  // One request clock for every Ops tool in this tab: this tool waits 1.5-1.8 s after the last request any of them sent.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 }), jitter = FAST ? 0 : Math.floor(Math.random() * 300);
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + GAP_MS + jitter - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  async function turn() { await pace(); return S.running && ready() && (live() || S.late); }   // late: Loot Quest ended, looters still listed
  function live() { return C.lootQuestLive(hunt(), serverMs()); }   // the game server's clock (review)
  function paused() { return Date.now() < S.pausedUntil; }
  function pause(why, ms) { S.pausedUntil = Date.now() + ms; S.pauseWhy = why; }

  // One map view at zoom level 1, centred on (x, y): the looters in it, or null when it didn't happen.
  async function view(x, y) {
    var g = C.gate(S.log, Date.now(), MAX_MIN, MAX_10);
    if (!g.ok) { pause(g.reason, g.until - Date.now()); return null; }
    if (!(await turn())) return null;
    var N = NET(), I = ids();
    var ours = S.lostAt && Date.now() - S.lostAt < STUCK_MS;   // the one still out is our own unanswered view: go on (two in a row pause)
    if (!ours && typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(I.view)) {   // another tool's map view is still out: wait, no strike
      if (!S.busySince) S.busySince = Date.now();
      setFoot('Waiting for the game to answer a map view...', 'ok');
      if (Date.now() - S.busySince > STUCK_MS) { S.busySince = 0; pause('the map stopped answering', PAUSE_MS); }
      return null;
    }
    S.busySince = 0;
    S.log.push(Date.now()); if (S.log.length > 200) S.log.shift();
    var r = await call(function (cb) { return N.send(I.view, { x: x, y: y, k: mapK(), rid: 0, width: 180, height: 120, marchInfo: true, viewLevel: 1 }, TARGET, cb); });
    var ok = r && typeof r.d === 'string' && (r.s == null || r.s === 0);
    if (!ok) {
      if (r && r.s === 'timeout') S.lostAt = Date.now();
      if (++S.fails >= C.FAILS_MAX) { S.fails = 0; S.lostAt = 0; pause('the map stopped answering', PAUSE_MS); }
      return null;
    }
    S.fails = 0; S.lostAt = 0;
    return C.points(r.d);
  }
  async function readList() {
    if (!(await turn())) return;
    var I = ids(), N = NET();
    S.listAt = Date.now(); S.wantList = false;            // asked again in a minute (or at the next crossing), never in a loop
    if (typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(I.list)) return;   // the last one is still out
    var r = await call(function (cb) { return N.sendPB(I.list, { header: {} }, TARGET, cb); });
    var list = C.crossIn(r && r.pbAck);
    if (!list && !live()) list = [];                      // outside Loot Quest a refusal ends it there: never a retry loop
    if (!list) { setFoot("Couldn't read the looter list. Trying again in a minute.", 'warn'); return; }
    S.list = list;
    var listed = {}; list.forEach(function (l) { listed[l.sid] = 1; });
    Object.keys(S.tracked).forEach(function (k) { if (!listed[S.tracked[k].fSid]) delete S.tracked[k]; });   // left
    Object.keys(S.holds).forEach(function (sid) { if (!listed[sid]) delete S.holds[sid]; });
    paint();
  }
  function listName(sid) { var l = S.list.filter(function (x) { return x.sid === sid; }); return l.length === 1 ? l[0].name : ''; }
  // Looters seen in a view: new ones are tracked, known ones updated (a new spot means they moved: post again).
  function absorb(pts) {
    var now = Date.now();
    pts.forEach(function (p) {
      var t = S.tracked[p.marchId];
      if (!t) {
        S.tracked[p.marchId] = { marchId: p.marchId, x: p.x, y: p.y, k: p.k || mapK(), fSid: p.fSid, name: listName(p.fSid), hideEndMs: p.hideEndMs, attack: p.attack, spId: p.spId, lastCheck: now, postedWorld: null, postedAlly: null, allyAt: 0, leader: '' };
        delete S.holds[p.fSid]; bump(); reportUsage();
        return;
      }
      t.x = p.x; t.y = p.y; t.hideEndMs = p.hideEndMs; t.attack = p.attack; t.lastCheck = now;
    });
    paint();
  }
  // One map step: the oldest due 30-second check, else the next view of a pass over the whole map for listed servers
  // with no tracked looter. A pass ends once nobody findable is missing; a full pass that misses someone holds their
  // server for 5 minutes. One view per step, so list reads, checks and posts never wait for a pass (review).
  async function mapStep() {
    var now = Date.now(), due = values().filter(function (t) { return now - t.lastCheck >= RECHECK_MS; }).sort(function (x, y) { return x.lastCheck - y.lastCheck; });
    if (due.length) { await recheck(due[0]); return true; }
    var miss = C.missing(S.list, S.tracked, S.holds, now), cells = C.passCells();
    if (!miss.length) { S.passOn = false; S.passAt = 0; return false; }
    if (!S.passOn) { S.passOn = true; S.passAt = 0; }
    if (!S.busySince) setFoot('Searching the map ' + (S.passAt + 1) + '/' + cells.length + '...', 'ok');
    var c = cells[S.passAt], pts = await view(c.x, c.y);
    if (pts === null) return true;                       // paused, waiting, or the game went away: pick up here later
    S.passAt++;
    absorb(pts);
    var left = C.missing(S.list, S.tracked, S.holds, Date.now());
    if (!left.length) { S.passOn = false; S.passAt = 0; }
    else if (S.passAt >= cells.length) { left.forEach(function (sid) { S.holds[sid] = Date.now() + C.HOLD_MS; }); S.passOn = false; S.passAt = 0; }
    return true;
  }
  function values() { return Object.keys(S.tracked).map(function (k) { return S.tracked[k]; }); }
  // The 30-second look at a found looter's spot; gone: the 8 windows around it, then (if still listed) a full pass.
  async function recheck(t) {
    var pts = await view(t.x, t.y);
    if (pts === null) return;
    var r = C.recheck(t, pts);
    absorb(pts);
    if (r.state !== 'gone') return;
    var listed = S.list.some(function (l) { return l.sid === t.fSid; });
    if (!listed) { delete S.tracked[t.marchId]; paint(); return; }
    var ring = C.ringCells(t.x, t.y);
    for (var i = 0; i < ring.length && S.running; i++) {
      setFoot('Looking around ' + t.x + ', ' + t.y + '...', 'ok');
      var near = await view(ring[i].x, ring[i].y);
      if (near === null) return;                         // try again at the next check
      absorb(near);
      if (near.some(function (p) { return p.marchId === t.marchId; })) return;
    }
    if (S.tracked[t.marchId] && S.tracked[t.marchId].x === t.x && S.tracked[t.marchId].y === t.y) delete S.tracked[t.marchId];   // not nearby: a full pass finds it
    paint();
  }

  // ---------------------------------------------------------------- sharing
  async function leaderOf(t) {
    if (t.leader || S.infoAsked[t.marchId]) return t.leader;
    S.infoAsked[t.marchId] = 1;
    if (!(await turn())) return '';
    var I = ids(), id = t.marchId;
    try { var L = req('Long64Bit'); if (L && L.Int64 && L.Int64.fromString) id = L.Int64.fromString(t.marchId); } catch (e) {}
    var r = await call(function (cb) { return NET().sendPB(I.info, { header: {}, crossTreasurePointInfo: { treasureId: id, sid: mapK() } }, TARGET, cb); });
    var a = r && r.pbAck, pi = a && a.header && a.header.s === 0 && a.crossTreasurePointInfo;
    if (pi) (pi.infos || []).forEach(function (p) { if (String(p.uid) === String(pi.mainUid)) t.leader = displayName(p.playerInfo); });
    return t.leader;
  }
  // The 5-minute rule, for one chat: world ('0') or alliance ('2'), each with its own gap since our last post there.
  function check(t, room) {
    var r = rows(room);
    if (!r.length) return { ok: false, reason: 'nochat' };   // history not loaded (just logged in, a frame reload): fail closed
    return C.shareCheck({ on: S.share, spots: C.chatSpots(r, Date.now()), x: t.x, y: t.y, k: t.k, now: Date.now(),
      lastShareAt: room === '0' ? S.lastShareAt : S.lastAllyAt, gapMs: SHARE_GAP_MS });
  }
  function iconName(t) { try { var row = req('TableManager').TABLE.getTableDataById('cross_treasure', String(t.spId || 1)); if (row && row.icon) return row.icon; } catch (e) {} return 'cross_treasure_share'; }
  function at(p, t) { return !!p && p.x === t.x && p.y === t.y; }
  async function cardFor(t) {
    var leader = await leaderOf(t), who = leader || ('S' + t.fSid);
    return C.card({ x: t.x, y: t.y, k: t.k }, gameText('cs_treasure53', who) || (who + "'s Loot Quest Team"), iconName(t));
  }
  function postAlly(t, card) {
    var chk = check(t, '2');
    if (!chk.ok) { if (chk.reason === 'shared') t.postedAlly = { x: t.x, y: t.y }; return chk.reason !== 'wait'; }
    S.lastAllyAt = Date.now();
    try { chatCtl().sendToAllianceChannel(card, '1'); } catch (e) { return true; }
    t.postedAlly = { x: t.x, y: t.y };
    S.last = 'Posted ' + (t.name || 'S' + t.fSid) + ' at ' + t.x + ', ' + t.y;
    paint();
    return true;
  }
  // World chat poster: world first, then the alliance 2 s later. Everyone else: their alliance chat only.
  async function shareDue() {
    if (!S.share) return;
    var due = values().filter(function (t) { return !at(t.postedAlly, t) || (S.world && !at(t.postedWorld, t)); });
    for (var i = 0; i < due.length && S.running; i++) {
      var t = due[i];
      if (S.world && !at(t.postedWorld, t)) {
        var chk = check(t, '0');
        if (chk.reason === 'wait') return;
        if (chk.reason === 'shared') t.postedWorld = { x: t.x, y: t.y };   // someone already posted this spot in world chat
        else if (chk.ok) {
          var card = await cardFor(t);
          if (!S.running || !S.tracked[t.marchId]) continue;
          if (!(await turn())) return;
          chk = check(t, '0');                            // the wait can be long: switched off, or shared meanwhile?
          if (chk.reason === 'shared') t.postedWorld = { x: t.x, y: t.y };
          if (!chk.ok) continue;
          var copy = JSON.parse(JSON.stringify(card)), pos = { x: t.x, y: t.y };
          S.lastShareAt = Date.now();
          try { chatCtl().sendToWorldChannel(card); }
          catch (e) { S.share = false; setFoot('The game refused a world chat post, so sharing is off for this run.', 'warn'); return; }
          t.postedWorld = pos; t.allyAt = Date.now() + C.ALLY_DELAY_MS;
          S.last = 'Posted ' + (t.name || 'S' + t.fSid) + ' at ' + t.x + ', ' + t.y;
          setTimeout(function () {                         // the runner's alliance chat, 2 s later (Tex)
            t.allyAt = 0;
            if (S.running && S.share && S.tracked[t.marchId] && at(pos, t)) postAlly(t, copy);
          }, C.ALLY_DELAY_MS);
          paint();
          continue;
        }
      }
      if (t.allyAt > Date.now() || at(t.postedAlly, t)) continue;
      if (check(t, '2').reason === 'wait') return;
      var c2 = await cardFor(t);
      if (!S.running || !S.tracked[t.marchId]) continue;
      if (!postAlly(t, c2)) return;
    }
  }
  function setRole(r) {
    var was = S.world + '|' + S.worldHolder;
    S.world = !!r.world; S.worldHolder = r.worldHolder || '';
    if (was !== S.world + '|' + S.worldHolder) paint();
  }
  function roleText() {
    if (!S.share) return 'Share is off: nothing is posted.';
    if (S.world) return 'You post to world chat and your alliance chat.';
    return 'You post to your alliance chat.' + (S.worldHolder ? ' ' + S.worldHolder + ' posts to world chat.' : '');
  }

  // ---------------------------------------------------------------- the loop
  function onCross(d) { S.pushAt = Date.now() + PUSH_MS; if (d && d.sid != null) delete S.holds[Number(d.sid)]; }
  function listen() {                                     // (again) on the game window the tool is reading
    var b = bus();
    if (b === S.bus) return;
    try { if (S.bus) S.bus.off(EVENT, onCross, TARGET); } catch (e) {}
    S.bus = null;
    try { if (b) { b.on(EVENT, onCross, TARGET); S.bus = b; } } catch (e) {}
  }
  function unlisten() { try { if (S.bus) S.bus.off(EVENT, onCross, TARGET); } catch (e) {} S.bus = null; }
  function hms(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2); }
  async function run() {
    while (S.running) {
      if (!(await renew())) return;
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(FAST ? 100 : 1000); continue; }
      listen();
      var cs = hunt(), now = serverMs();
      if (C.lootQuestLive(cs, now)) { S.late = false; S.lateChecked = false; }
      else {
        // Loot Quest ended (or the tool opened after it): looters who came in before stay on the map, so it carries on
        // while the list has anyone (Tex 2026-10-17). One look at the list first; an empty list means it waits.
        if (!S.lateChecked) { S.lateChecked = true; S.wantList = true; S.late = true; }
        else S.late = S.list.length > 0 || values().length > 0;
        if (!S.late) {
          var nx = C.nextWindow(cs, now);
          setFoot("Loot Quest isn't running now." + (nx ? ' Next one in ' + hms(nx - now) + '.' : ''), 'warn');
          S.passOn = false; S.passAt = 0;
          await delay(FAST ? 200 : 1000); continue;
        }
      }
      if (S.pushAt && Date.now() >= S.pushAt) { S.pushAt = 0; S.wantList = true; }
      if (S.wantList || Date.now() - S.listAt >= LIST_MS) await readList();
      var worked = !paused() && S.running ? await mapStep() : false;
      if (S.running) await shareDue();                    // sends no map views, so it runs during a cap pause too (review)
      if (paused()) setFoot('Paused: ' + S.pauseWhy + '. Back in ' + C.clock(S.pausedUntil - Date.now()) + '.', 'warn');
      else if (!S.passOn && !S.busySince) { var n = values().length; setFoot(S.late ? 'Loot Quest ended. Watching the looters still on the map.' : S.list.length ? 'Watching ' + n + ' of ' + S.list.length + ' looter' + (S.list.length === 1 ? '' : 's') + '.' : 'No looters on the map. Watching.', 'ok'); }
      await delay(worked ? (FAST ? 10 : 50) : (FAST ? 50 : 1000));
    }
  }

  // ---------------------------------------------------------------- start / stop
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; var was = S.running; S.running = false;
    window.__LOOT.running = false;
    unlisten(); clearInterval(S.tick);
    try { window.removeEventListener('pagehide', onHide); } catch (e) {}
    if (was) release();
    if (reason === 'stopped by you') { removeRoot(); return; }
    showMessage('Looter Locator stopped: ' + reason, true);
  }
  // Someone else is running it (or the site can't say): tell the player, then hand back to the Ops Center.
  function bounce(text) {
    S.stopped = true; S.running = false; window.__LOOT.running = false;
    var end = Date.now() + BOUNCE_MS;
    (function tick() {
      if (!root) return;
      var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      showMessage(text + ' Back to the Ops Center in ' + left + ' s.', false);
      if (Date.now() >= end) { removeRoot(); return; }
      setTimeout(tick, Math.min(1000, Math.max(50, end - Date.now())));
    })();
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#loot-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#loot-root .loot-card{width:236px;box-sizing:border-box;background:#161b22;border:1px solid #388bfd;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#loot-root .loot-card.warn{border-color:#d29922}#loot-root .loot-card.bad{border-color:#f85149}#loot-root .loot-card.flash{transform:scale(1.04)}',
    '#loot-root .loot-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#loot-root .loot-title{flex:1;white-space:nowrap}',
    '#loot-root .loot-dot{width:8px;height:8px;border-radius:50%;background:#388bfd}#loot-root .warn .loot-dot{background:#d29922}#loot-root .bad .loot-dot{background:#f85149}',
    '#loot-root .loot-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#loot-root .min .loot-mini{display:inline}',
    '#loot-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#loot-root button#loot-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#loot-root button#loot-min:hover{color:#e6edf3;background:#1c2128}#loot-root #loot-min svg{transition:transform .2s}#loot-root .min #loot-min svg{transform:rotate(180deg)}',
    '#loot-root .loot-card.min{width:auto;padding:0 4px 0 12px}#loot-root .min .loot-body{display:none}#loot-root .min .loot-head{margin:0;height:44px;cursor:pointer}',
    '#loot-root .loot-stat{font-variant-numeric:tabular-nums}#loot-root .loot-foot{color:#8b949e;font-size:12px;margin-top:4px;min-height:16px}',
    '#loot-root .loot-rows{margin-top:6px;max-height:200px;overflow-y:auto}#loot-root .loot-rows:empty{display:none}',
    '#loot-root .loot-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #30363d}',
    '#loot-root .loot-who{flex:1;min-width:0}#loot-root .loot-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#loot-root .loot-where{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}#loot-root .loot-where b{color:#79c0ff;font-weight:600}',
    '#loot-root button.loot-go{flex:none;min-width:44px;min-height:36px;border:1px solid #30363d;border-radius:8px;background:#1c2128;font-size:12px}',
    '#loot-root .loot-last{color:#79c0ff;font-size:12px;margin-top:4px}#loot-root .loot-last:empty{display:none}',
    '#loot-root .loot-note{color:#8b949e;font-size:11px;margin-top:6px}#loot-root .loot-role{color:#8b949e;font-size:12px;margin-top:2px}',
    '#loot-root .loot-msg{margin:4px 0 2px}#loot-root .loot-btns{display:flex;gap:6px;margin-top:8px}',
    '#loot-root .loot-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#loot-root .loot-btns button:hover{border-color:#79c0ff}',
    '#loot-root button#loot-share[aria-pressed="true"]{border-color:#3fb950;color:#3fb950}'
  ].join('\n');
  var NOTE = 'Only one person per alliance needs to run Looter Locator.';
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); if (id) b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('loot-style');
    if (!st) { st = el('style'); st.id = 'loot-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('loot-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'loot-root';
    card = el('div', 'loot-card');
    var head = el('div', 'loot-head');
    head.appendChild(el('span', 'loot-title', 'Looter Locator'));
    var mini = el('span', 'loot-mini'); mini.id = 'loot-mini'; mini.title = 'Looters found'; head.appendChild(mini);
    head.appendChild(el('span', 'loot-dot'));
    var mb = el('button'); mb.id = 'loot-min'; mb.type = 'button';
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'loot-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'looter-locator', handle: '.loot-head' });   // the player can drag the card by its title (Tex)
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; card = null; body = null; }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('loot-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Looter Locator' : 'Minimize Looter Locator'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  var FS = {};
  function foldOf(L) { var O = window.OpsStack; if (O && O.fold) return O.fold(FS, L, S.min); FS.last = !!L.fold; return !!(S.min || (L.fold && !FS.force)); }
  function foldTap() { var O = window.OpsStack; if (O && O.foldTap) return O.foldTap(FS, S.min); if (!S.min && FS.last) { FS.force = !FS.force; return true; } return false; }
  function toggleMin() { if (foldTap()) { paint(); return; } S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint(); }
  function where() { return window.OpsStack ? window.OpsStack.layout(root, 'looter-locator', !!(card && /\bmin\b/.test(card.className)), paint) : { placed: true, top: '', left: '', right: '', fold: false }; }
  function place(L) {
    if (!root || L.placed) return;
    if (root.style.top !== L.top) root.style.top = L.top;
    if (root.style.left !== L.left) root.style.left = L.left;
    if (root.style.right !== L.right) root.style.right = L.right;
  }
  function shareLabel() { return S.share ? 'Share on' : 'Share off'; }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    root.removeAttribute('data-ops-stopped');
    ['loot-stat', 'loot-foot'].forEach(function (id) { var e = el('div', id); e.id = id; body.appendChild(e); });
    var role = el('div', 'loot-role'); role.id = 'loot-role'; body.appendChild(role);
    var rows = el('div', 'loot-rows'); rows.id = 'loot-rows'; body.appendChild(rows);
    var last = el('div', 'loot-last'); last.id = 'loot-last'; body.appendChild(last);
    body.appendChild(el('div', 'loot-note', NOTE));
    var btns = el('div', 'loot-btns');
    var sh = button('loot-share', shareLabel(), function () {
      S.share = !S.share; lsSet(LS_SHARE, S.share ? '1' : '0'); sh.textContent = shareLabel(); sh.setAttribute('aria-pressed', String(S.share));
      S.renewAt = 0; if (!S.share) S.world = false;              // the next renewal takes or gives back the world chat slot
      paint();
    });
    sh.setAttribute('aria-pressed', String(S.share)); sh.title = 'Post looters to chat';
    btns.appendChild(sh);
    btns.appendChild(button('loot-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    S.rowsKey = '';
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    if (withClose) root.setAttribute('data-ops-stopped', '1'); else root.removeAttribute('data-ops-stopped');
    body.appendChild(el('div', 'loot-msg', text));
    if (withClose) { var btns = el('div', 'loot-btns'); btns.appendChild(button('loot-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'loot-card';
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  function jump(t) { try { var M = req('WorldMapMsgs'); M.send(M.Names.WorldMapJumpToTileClick, { x: t.x, y: t.y, z: t.k }); } catch (e) {} }   // the Defense panel's Go To
  function paintRows() {
    var box = document.getElementById('loot-rows');
    if (!box) return;
    var list = values().sort(function (a, b) { return a.fSid - b.fSid || a.x - b.x; }), now = serverMs();
    var key = list.map(function (t) { return t.marchId + '@' + t.x + ',' + t.y + ':' + (t.name || '') + ':' + C.looks(t, now); }).join('|');
    if (key === S.rowsKey) return;
    S.rowsKey = key; box.textContent = '';
    list.forEach(function (t) {
      var row = el('div', 'loot-row'), who = el('div', 'loot-who');
      who.appendChild(el('div', 'loot-name', (t.name || 'Looter') + ' · S' + t.fSid));
      var w = el('div', 'loot-where'), b = el('b', null, t.x + ', ' + t.y); w.appendChild(b); w.appendChild(document.createTextNode(' · ' + C.looks(t, now)));
      who.appendChild(w); row.appendChild(who);
      var go = button(null, 'Go', function () { jump(t); }); go.className = 'loot-go'; go.title = 'Show ' + t.x + ', ' + t.y + ' on the map';
      row.appendChild(go); box.appendChild(row);
    });
  }
  function paint() {
    if (!card || S.view !== 'run') return;
    var n = values().length;
    put('loot-stat', 'Looters ' + n + (S.list.length > n ? ' of ' + S.list.length : '') + ' · Found today ' + todayCount());
    put('loot-foot', S.foot); put('loot-role', roleText()); put('loot-last', S.last || ''); put('loot-mini', String(n));
    paintRows();
    var L = where(), folded = foldOf(L);
    var tt = card.querySelector('.loot-title'), tx = folded ? 'Looters' : 'Looter Locator';
    if (tt && tt.textContent !== tx) tt.textContent = tx;
    card.className = 'loot-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (folded ? ' min' : '');
    place(L);
  }

  // ---------------------------------------------------------------- start
  window.__LOOT = {
    running: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { view: S.view, running: S.running, tracked: values().length, listed: S.list.length, foot: S.foot, share: S.share, paused: paused() }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var uid = ''; try { var u = UD(); uid = String(u.StrUid || u._uid || ''); S.name = String(u.Name || '').slice(0, 40); } catch (e) {}
  if (!uid) { showMessage('Open the game and log in first.', true); window.__LOOT.running = false; return; }
  sha256Hex(uid).then(async function (h) {
    S.siteKey = h.slice(0, 16);
    S.count = lsJSON(LS_COUNT + S.siteKey);
    if (S.stopped) return;
    var r = await claim();
    if (S.stopped) return;
    if (!r.ok) {
      bounce(r.holder ? r.holder + ' is running Looter Locator for your alliance right now. Looters it finds go to your alliance chat, so you don\'t need it open.'
        : "Couldn't check who's running Looter Locator. Try again in a minute.");
      return;
    }
    S.leaseOkAt = Date.now(); S.renewAt = Date.now() + RENEW_MS; setRole(r);
    S.running = true;
    try { window.addEventListener('pagehide', onHide); } catch (e) {}
    showRun();
    reportUsage();
    S.tick = setInterval(function () { if (S.running && S.view === 'run') paint(); }, 1000);   // the "Invisible 0:42" countdowns
    run().catch(function (e) { stop('something went wrong (' + String((e && e.message) || e).slice(0, 60) + ')'); });
  });
})();
