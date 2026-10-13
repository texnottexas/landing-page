// angel-attacks.js — Angel Attacks: during the Heavy Mothership (and Blade Angel) Treasure events, sends one carrier
// attack at each Angel in the player's match group with the game's own Attack request (902, isAirCraftCarrier), so
// no normal march is used. Reads the Angel list the way the event panel does (8802). Launched from the Ops Center
// or from the Angels switch on the Mask Boxes card.
// Rules live in angel-attacks-core.js (window.AngelAttacksCore). Every request waits for the shared Ops request
// clock, so no two requests from any Ops tool go under 1.1 s apart.
(function () {
  'use strict';
  if (window.__ANG && window.__ANG.running) { window.__ANG.flash(); return; }
  var C = window.AngelAttacksCore;
  if (!C) { try { alert('Angel Attacks did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-13';
  var WORKER = window.__ANG_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = !!window.__ANG_FAST, CHECK_MS = window.__ANG_CHECK_MS || 180000, IDLE_MS = window.__ANG_IDLE_MS || 600000, TIMEOUT_MS = window.__ANG_TIMEOUT_MS || 10000;
  var LIST = 8802, MARCH = 902, BOSS_MARCH = 189;          // what the game used on 2026-10-13; read live when it names them
  var LS_SENT = 'ang_sent_v1_', LS_COUNT = 'ang_count_v1_', LS_MIN = 'ang_min_v1';
  var TARGET = {};                                         // NET.send wants a target; a plain object is always valid

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
    var o = { list: LIST, march: MARCH, type: BOSS_MARCH };
    try { var v = req('NRequestIdV2').NRequestIdV2.PINK_MECHA_MONSTER_LIST; if (typeof v === 'number') o.list = v; } catch (e) {}
    try { var r = req('RequestId').RequestId.MARCH_WORLD_POINT; if (typeof r === 'number') o.march = r; } catch (e) {}
    try { var t = req('NWorldMapMarchCommon').NMarchType.MECHA_TREASURE_BOSS; if (typeof t === 'number') o.type = t; } catch (e) {}
    return o;
  }
  function serverSec() { try { var t = Number(DATA().ServerTime); return t > 0 ? t : Math.floor(Date.now() / 1000); } catch (e) { return Math.floor(Date.now() / 1000); } }
  // The live game keeps activities in a list and a map: read both.
  function activities() {
    try {
      var A = req('ActivityController').ActivityController.Instance, out = [];
      if (Array.isArray(A._activityList)) out = out.concat(A._activityList);
      if (A._activityMap && typeof A._activityMap === 'object') Object.keys(A._activityMap).forEach(function (k) { out.push(A._activityMap[k]); });
      return out;
    } catch (e) { return []; }
  }
  function liveEvent() { return C.findEvent(activities(), serverSec()); }
  function myUid() { try { var u = UD(); return String(u.UID != null ? u.UID : (u.StrUid || u._uid || '')); } catch (e) { return ''; } }
  // Tiles our own Angel marches are headed to right now.
  function marchTiles(type) {
    var out = {}, me = myUid();
    try {
      var ms = req('NWorldMapData').default.instance.marches || {};
      Object.keys(ms).forEach(function (k) { var m = ms[k]; if (m && m.marchType === type && String(m.realUid) === me) out[m.target_tx + ',' + m.target_ty] = 1; });
    } catch (e) {}
    return out;
  }
  function gameText(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
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
  var S = { noteTone: 'ok', running: false, stopped: false, siteKey: '', sent: { eventId: '', uuids: {} }, count: null, log: [], silent: 0,
    eventId: '', attackedRound: 0, onWay: 0, sentRun: 0, listed: 0, foot: 'Starting...', tone: 'ok', last: '', note: '', min: lsGet(LS_MIN) === '1', view: '' };
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  // Our sent list follows the event: a new round starts it empty.
  function syncSent(eventId) { if (S.sent.eventId !== String(eventId)) { S.sent = C.sentFor(lsJSON(LS_SENT + S.siteKey), eventId); } }
  function remember(uuid) { S.sent.uuids[uuid] = Date.now(); lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent)); }
  function reportUsage() {
    var name = '';
    try { name = String(UD().Name || '').slice(0, 40); } catch (e) {}
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: 'angels', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  function refreshCounts() {
    var ev = liveEvent();
    S.attackedRound = ev ? ev.extra.attackMonsterIds.length : 0;
    var t = marchTiles(ids().type); S.onWay = Object.keys(t).length;
  }

  // ---------------------------------------------------------------- requests
  var flight = null;
  function call(send) {
    return new Promise(function (resolve) {
      var done = false, ok, mine = { at: Date.now() };
      flight = mine;
      var land = function () { if (flight === mine) flight = null; };
      var t = setTimeout(function () { if (!done) { done = true; land(); resolve({ s: 'timeout' }); } }, TIMEOUT_MS);
      try { ok = send(function (r) { land(); if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); }); } catch (e) { ok = false; }
      if (ok === false && !done) { land(); done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  // One request clock for every Ops tool in this tab.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + 1100 + Math.floor(Math.random() * 200) - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  // Wait for the shared clock, then check again: the wait can be long, and the game can drop meanwhile.
  async function turn() { await pace(); return S.running && ready() && !flight; }

  // ---------------------------------------------------------------- the loop
  function mmss(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  async function waitUntil(at, text, tone) {
    while (S.running && Date.now() < at) {
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(1000); continue; }
      refreshCounts();
      setFoot(text + ' ' + mmss(Math.max(1, Math.ceil((at - Date.now()) / 1000))), tone);
      await delay(FAST ? 100 : 1000);
    }
  }
  async function run() {
    while (S.running) {
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(1000); continue; }
      var ev = liveEvent();
      if (!ev) { S.eventId = ''; S.attackedRound = 0; await waitUntil(Date.now() + IDLE_MS, 'No Angel event right now. Looking again in', 'warn'); continue; }
      S.eventId = String(ev.id); syncSent(ev.id);
      await check(ev);
      // the check's result stays in view ahead of the countdown ("Paused: 10 attacks in a minute. Next check in 0:41")
      if (S.running) await waitUntil(Date.now() + CHECK_MS, (S.note ? S.note + ' ' : '') + 'Next check in', S.noteTone);
    }
  }
  function note(text, tone) { S.note = text; S.noteTone = tone || 'ok'; setFoot(text, S.noteTone); }
  async function check(ev) {
    S.note = ''; S.noteTone = 'ok';
    setFoot('Checking the Angel list...', 'ok');
    if (!(await turn())) return;
    var I = ids();
    var a = await call(function (cb) { return NET().sendPBV2(I.list, { aid: ev.id, type: 2 }, TARGET, cb); });
    var h = a && a.pbAckV2 && a.pbAckV2.header;
    if (!h || h.s !== 0) { note("Couldn't read the Angel list.", 'warn'); return; }
    var monsters = (a.pbAckV2.data && a.pbAckV2.data.worldMonsters) || [];
    S.listed = monsters.length;
    var ctx = function () { var e = liveEvent(); return { attacked: e ? e.extra.attackMonsterIds : [], sent: S.sent.uuids, me: myUid(), marchTiles: marchTiles(I.type), now: Date.now() }; };
    var targets = C.pickTargets(monsters, ctx());
    var sent = 0;
    for (var i = 0; i < targets.length && S.running; i++) {
      var g = C.gate(S.log, Date.now());
      if (!g.ok) { note('Paused: ' + g.reason + '.', 'warn'); return; }
      setFoot('Attacking ' + (i + 1) + ' of ' + targets.length + '...', 'ok');
      await delay(FAST ? 0 : 3000 + Math.floor(Math.random() * 2000));
      if (!(await turn())) return;
      var ev2 = liveEvent();                                  // the waits are long: same live event, Angel still a target?
      if (!ev2 || String(ev2.id) !== String(ev.id)) return;
      var t = targets[i];
      if (C.pickTargets([monsters[t.at]], ctx()).length !== 1) continue;
      var N = NET();
      if (typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(I.march)) { note('The game is busy with a march.', 'warn'); return; }
      remember(t.uuid);                                       // before the request: a lost answer never brings a second attack
      S.log.push(Date.now()); if (S.log.length > 100) S.log.shift();
      var r = C.classifyAttack(await call(function (cb) { return N.send(I.march, { isAirCraftCarrier: true, marchType: I.type, x: t.x, y: t.y }, TARGET, cb); }));
      if (r.kind === 'ok') {
        S.silent = 0; S.sentRun++; sent++; bump();
        S.last = 'Attacked ' + t.x + ', ' + t.y + ' · S' + t.serverId;   // short: the card is 190 px wide
        reportUsage(); refreshCounts(); paint();
        continue;
      }
      if (r.kind === 'silent') {
        S.silent++;
        if (S.silent >= C.SILENT_STOP) { stop('the game did not answer 3 attacks in a row'); return; }
        continue;
      }
      stop(gameText(r.key) || ('the game answered ' + r.s + (r.key ? ' (' + r.key + ')' : '')));
      return;
    }
    refreshCounts();
    note(sent ? 'Sent ' + sent + '.' : 'Checked ' + monsters.length + ' Angels, nothing new.', 'ok');
  }

  // ---------------------------------------------------------------- start / stop
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; S.running = false;
    window.__ANG.running = false;
    if (reason === 'stopped by you') { removeRoot(); return; }
    showMessage('Angel Attacks stopped: ' + reason, true);
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#ang-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#ang-root .ang-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #388bfd;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#ang-root .ang-card.warn{border-color:#d29922}#ang-root .ang-card.bad{border-color:#f85149}#ang-root .ang-card.flash{transform:scale(1.04)}',
    '#ang-root .ang-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#ang-root .ang-title{flex:1;white-space:nowrap}',
    '#ang-root .ang-dot{width:8px;height:8px;border-radius:50%;background:#388bfd}#ang-root .warn .ang-dot{background:#d29922}#ang-root .bad .ang-dot{background:#f85149}',
    '#ang-root .ang-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#ang-root .min .ang-mini{display:inline}',
    '#ang-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#ang-root button#ang-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#ang-root button#ang-min:hover{color:#e6edf3;background:#1c2128}#ang-root #ang-min svg{transition:transform .2s}#ang-root .min #ang-min svg{transform:rotate(180deg)}',
    '#ang-root .ang-card.min{width:auto;padding:0 4px 0 12px}#ang-root .min .ang-body{display:none}#ang-root .min .ang-head{margin:0;height:44px;cursor:pointer}',
    '#ang-root .ang-stat{font-variant-numeric:tabular-nums}#ang-root .ang-sub{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}',
    '#ang-root .ang-last,#ang-root .ang-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',   // the foot wraps: it carries why a check paused
    '#ang-root .ang-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#ang-root .ang-last{color:#79c0ff;font-size:12px;margin-top:2px}#ang-root .ang-last:empty{display:none}',
    '#ang-root .ang-msg{margin:4px 0 2px}#ang-root .ang-btns{display:flex;gap:6px;margin-top:8px}',
    '#ang-root .ang-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#ang-root .ang-btns button:hover{border-color:#79c0ff}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('ang-style');
    if (!st) { st = el('style'); st.id = 'ang-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('ang-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'ang-root';
    card = el('div', 'ang-card');
    var head = el('div', 'ang-head');
    head.appendChild(el('span', 'ang-title', 'Angel Attacks'));
    var mini = el('span', 'ang-mini'); mini.id = 'ang-mini'; mini.title = 'Attacked this round'; head.appendChild(mini);
    head.appendChild(el('span', 'ang-dot'));
    var mb = el('button'); mb.id = 'ang-min'; mb.type = 'button';
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'ang-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('ang-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Angel Attacks' : 'Minimize Angel Attacks'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() {
    if (!S.min && layout().fold) { forceOpen = !forceOpen; paint(); return; }   // a fold made for room: not the player's choice
    S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint();
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    var st = el('div', 'ang-stat'); st.id = 'ang-stat'; body.appendChild(st);
    var sub = el('div', 'ang-sub'); sub.id = 'ang-sub'; body.appendChild(sub);
    var foot = el('div', 'ang-foot'); foot.id = 'ang-foot'; body.appendChild(foot);
    var last = el('div', 'ang-last'); last.id = 'ang-last'; body.appendChild(last);
    var btns = el('div', 'ang-btns');
    btns.appendChild(button('ang-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'ang-msg', text));
    if (withClose) { var btns = el('div', 'ang-btns'); btns.appendChild(button('ang-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'ang-card';
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  // Where the card goes, so it never covers the Mask Boxes or Map Collector card: under the Mask Boxes card when the
  // full card fits there; else to its right; else (a phone) folded to its bar at the right edge. A fold made for
  // room isn't saved as the player's choice, and tapping the bar opens the card anyway.
  var fullH = 200, forceOpen = false;
  function rectOf(id) { var e = document.getElementById(id); if (!e || !e.isConnected) return null; var r = (e.firstElementChild || e).getBoundingClientRect(); return r.height > 0 ? r : null; }
  function layout() {
    var m = rectOf('mbx-root'), mc = rectOf('mapc-root'), vw = window.innerWidth, vh = window.innerHeight;
    if (!m) return { top: '', left: '', right: '', fold: false };
    var below = Math.round(m.bottom + 8), limit = (mc && mc.top > m.top ? mc.top : vh) - 8;
    if (below + fullH <= limit) return { top: below + 'px', left: '', right: '', fold: false };
    if (m.right + 16 + 190 <= vw - 8) return { top: Math.round(m.top) + 'px', left: Math.round(m.right + 8) + 'px', right: '', fold: false };
    return { top: Math.round(m.top) + 'px', left: 'auto', right: 'calc(8px + env(safe-area-inset-right))', fold: true };
  }
  function place(L) {
    if (!root) return;
    if (root.style.top !== L.top) root.style.top = L.top;
    if (root.style.left !== L.left) root.style.left = L.left;
    if (root.style.right !== L.right) root.style.right = L.right;
  }
  function paint() {
    if (!card || S.view !== 'run') return;
    put('ang-stat', S.eventId ? 'Attacked ' + S.attackedRound + ' this round' : 'Angel Attacks');
    put('ang-sub', 'On the way ' + S.onWay + ' · Sent ' + S.sentRun);
    put('ang-foot', S.foot);
    put('ang-last', S.last);
    put('ang-mini', String(S.attackedRound));
    var L = layout(), folded = S.min || (L.fold && !forceOpen);
    var tt = card.querySelector('.ang-title'), tx = folded ? 'Angels' : 'Angel Attacks';
    if (tt && tt.textContent !== tx) tt.textContent = tx;
    card.className = 'ang-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (folded ? ' min' : '');
    if (!folded) fullH = Math.max(120, Math.round(card.getBoundingClientRect().height));
    var mb = document.getElementById('ang-min');
    if (mb) { mb.setAttribute('aria-label', folded ? 'Show Angel Attacks' : 'Minimize Angel Attacks'); mb.setAttribute('aria-expanded', String(!folded)); }
    place(L);
  }

  // ---------------------------------------------------------------- start
  window.__ANG = {
    running: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { attackedRound: S.attackedRound, onWay: S.onWay, sentRun: S.sentRun, listed: S.listed, foot: S.foot, last: S.last, eventId: S.eventId, sent: Object.keys(S.sent.uuids).length }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var id = ''; try { var u = UD(); id = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!id) { showMessage('Open the game and log in first.', true); window.__ANG.running = false; return; }
  sha256Hex(id).then(function (h) {
    S.siteKey = h.slice(0, 16);
    S.count = lsJSON(LS_COUNT + S.siteKey);
    if (S.stopped) return;
    S.running = true;
    showRun();
    reportUsage();
    run().catch(function (e) { stop('something went wrong (' + String((e && e.message) || e).slice(0, 60) + ')'); });
  });
})();
