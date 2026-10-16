// enigma-veins.js — Enigma Veins: during the Enigma Field Hunt, sends one mining march to every vein on the player's
// server they haven't mined, with the game's own Collect request (902, marchType DOMAIN_TREASURE, no troops, no march
// slot). Reads the vein list the way the event panel does (8623, Global Veins). Launched from the Ops Center.
// Rules live in enigma-veins-core.js (window.EnigmaVeinsCore). Every request waits for the shared Ops request clock.
(function () {
  'use strict';
  if (window.__VEIN && window.__VEIN.running) { window.__VEIN.flash(); return; }
  var C = window.EnigmaVeinsCore;
  if (!C) { try { alert('Enigma Veins did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-16.2';
  var WORKER = window.__VEIN_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = !!window.__VEIN_FAST, CHECK_MS = window.__VEIN_CHECK_MS || 120000, IDLE_MS = window.__VEIN_IDLE_MS || 600000, TIMEOUT_MS = window.__VEIN_TIMEOUT_MS || 10000;
  var UNSHOWN_MS = window.__VEIN_UNSHOWN_MS || 10000;     // how long a send counts as out before the game's march list shows it
  var LIST = 8623, MARCH = 902, VEIN_MARCH = 180;          // what the game used on 2026-10-14; read live when it names them
  var LS_SENT = 'vein_sent_v1_', LS_COUNT = 'vein_count_v1_', LS_MIN = 'vein_min_v1';
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
    var o = { list: LIST, march: MARCH, type: VEIN_MARCH };
    try { var v = req('NRequestIdV2').NRequestIdV2.ENIGMA_BEAST_TREASURE_GET_KUANG_LIST; if (typeof v === 'number') o.list = v; } catch (e) {}
    try { var r = req('RequestId').RequestId.MARCH_WORLD_POINT; if (typeof r === 'number') o.march = r; } catch (e) {}
    try { var t = req('NWorldMapMarchCommon').NMarchType.DOMAIN_TREASURE; if (typeof t === 'number') o.type = t; } catch (e) {}
    return o;
  }
  function serverSec() { try { var t = Number(DATA().ServerTime); return t > 0 ? t : Math.floor(Date.now() / 1000); } catch (e) { return Math.floor(Date.now() / 1000); } }
  function nowMs() { return serverSec() * 1000; }          // vein ends are in the game's time
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
  // Tiles our own vein marches are at or headed to right now (a march stays listed while it mines).
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
  var S = { running: false, stopped: false, siteKey: '', sent: { eventId: '', keys: {} }, count: null, log: [], eventId: '', max: C.MAX_OUT,
    recent: [], up: 0, mined: 0, onWay: 0, sentRun: 0, skipped: 0, foot: 'Starting...', tone: 'ok', last: '', note: '', noteTone: 'ok', min: lsGet(LS_MIN) === '1', view: '' };
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  // Our sent list follows the event: a new round starts it empty, and ended veins drop out.
  function syncSent(eventId) { if (S.sent.eventId !== String(eventId)) S.sent = C.sentFor(lsJSON(LS_SENT + S.siteKey), eventId, nowMs()); }
  function remember(key) { S.sent = C.addSent(S.sent, key, nowMs(), Date.now()); lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent)); }
  function reportUsage() {
    var name = '';
    try { name = String(UD().Name || '').slice(0, 40); } catch (e) {}
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: 'enigma-veins', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  // Our vein marches out: the game's march list, plus our sends of the last few seconds it doesn't show yet (a send
  // counts once: when the list has shown its tile, the list alone counts it). Review 2026-10-14.
  function outNow() {
    var tiles = marchTiles(ids().type), n = Object.keys(tiles).length, now = Date.now();
    S.recent = S.recent.filter(function (r) { return r.at > now - UNSHOWN_MS; });
    S.recent.forEach(function (r) { if (tiles[r.tile]) r.seen = true; else if (!r.seen) n++; });
    return n;
  }
  function refreshCounts() { S.onWay = outNow(); }

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
  // One request clock for every Ops tool in this tab: 1.5-2.5 s after the last request any of them sent.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 }), gap = window.__VEIN_GAP_MS || 1500;
    var jitter = FAST ? 0 : Math.floor(Math.random() * 1000);
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + gap + jitter - Date.now();
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
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(FAST ? 100 : 1000); continue; }
      var ev = liveEvent();
      if (!ev) { S.eventId = ''; await waitUntil(Date.now() + IDLE_MS, "The Enigma Field Hunt isn't on right now. Looking again in", 'warn'); continue; }
      S.eventId = String(ev.id); S.max = C.maxOut(ev); syncSent(ev.id);
      await check(ev);
      // the check's result stays in view ahead of the countdown ("2 marches on the way. ... Next check in 1:52")
      if (S.running) await waitUntil(Date.now() + CHECK_MS, (S.note ? S.note + ' ' : '') + 'Next check in', S.noteTone);
    }
  }
  function note(text, tone) { S.note = text; S.noteTone = tone || 'ok'; setFoot(text, S.noteTone); }
  function full() { return outNow() >= S.max; }
  async function check(ev) {
    S.note = ''; S.noteTone = 'ok';
    setFoot('Checking the vein list...', 'ok');
    if (!(await turn())) return;
    var I = ids();
    var a = await call(function (cb) { return NET().sendPBV2(I.list, { activityId: ev.id, type: 2 }, TARGET, cb); });
    var h = a && a.pbAckV2 && a.pbAckV2.header;
    if (!h || h.s !== 0) { note("Couldn't read the vein list.", 'warn'); return; }
    var veins = (a.pbAckV2.data && a.pbAckV2.data.otherKuangList) || [];
    var c = C.counts(veins, nowMs()); S.up = c.up; S.mined = c.mined;
    var ctx = function () { return { sent: S.sent.keys, marchTiles: marchTiles(I.type), now: nowMs() }; };
    var targets = C.pickVeins(veins, ctx()), sent = 0;
    for (var i = 0; i < targets.length && S.running; i++) {
      var g = C.gate(S.log, Date.now());
      if (!g.ok) { note('Paused: ' + g.reason + '.', 'warn'); return; }
      if (full()) { refreshCounts(); note(S.max + ' marches on the way. The rest when they come back.', 'ok'); return; }
      setFoot('Sending ' + (i + 1) + ' of ' + targets.length + '...', 'ok');
      if (!(await turn())) return;
      var ev2 = liveEvent();                                  // the waits can be long: same live event?
      if (!ev2 || String(ev2.id) !== String(ev.id)) return;
      var t = targets[i];
      if (C.pickVeins([veins[t.at]], ctx()).length !== 1) continue;      // past 5 minutes now, or ours already
      if (full()) { refreshCounts(); note(S.max + ' marches on the way. The rest when they come back.', 'ok'); return; }
      var N = NET();
      if (typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(I.march)) { note('The game is busy with a march.', 'warn'); return; }
      remember(t.key);                                        // before the request: a lost answer never brings a second march
      S.log.push(Date.now()); if (S.log.length > 100) S.log.shift();
      var raw = await call(function (cb) { return N.send(I.march, { marchType: I.type, x: t.x, y: t.y, armyList: [], armyListNew: [], heroList: [], trapList: [], ext: {} }, TARGET, cb); });
      var r = C.classify(raw, raw && typeof raw.d === 'string' ? gameText(raw.d) : '');
      if (r.kind === 'ok') {
        S.sentRun++; sent++; bump();
        S.recent.push({ tile: t.x + ',' + t.y, at: Date.now() });
        S.last = 'Sent to ' + t.x + ', ' + t.y;
        reportUsage(); refreshCounts(); paint();
        continue;
      }
      if (r.kind === 'time') { S.skipped++; continue; }
      if (r.kind === 'silent') { stop('the game stopped answering'); return; }
      stop(gameText(r.key) || ('the game answered ' + r.s + (r.key ? ' (' + r.key + ')' : '')));
      return;
    }
    refreshCounts();
    note(sent ? 'Sent ' + sent + '.' : 'Checked ' + veins.length + ' veins, nothing new.', 'ok');
  }

  // ---------------------------------------------------------------- start / stop
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; S.running = false;
    window.__VEIN.running = false;
    if (reason === 'stopped by you') { removeRoot(); return; }
    showMessage('Enigma Veins stopped: ' + reason, true);
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#vein-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#vein-root .vein-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #388bfd;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#vein-root .vein-card.warn{border-color:#d29922}#vein-root .vein-card.bad{border-color:#f85149}#vein-root .vein-card.flash{transform:scale(1.04)}',
    '#vein-root .vein-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#vein-root .vein-title{flex:1;white-space:nowrap}',
    '#vein-root .vein-dot{width:8px;height:8px;border-radius:50%;background:#388bfd}#vein-root .warn .vein-dot{background:#d29922}#vein-root .bad .vein-dot{background:#f85149}',
    '#vein-root .vein-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#vein-root .min .vein-mini{display:inline}',
    '#vein-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#vein-root button#vein-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#vein-root button#vein-min:hover{color:#e6edf3;background:#1c2128}#vein-root #vein-min svg{transition:transform .2s}#vein-root .min #vein-min svg{transform:rotate(180deg)}',
    '#vein-root .vein-card.min{width:auto;padding:0 4px 0 12px}#vein-root .min .vein-body{display:none}#vein-root .min .vein-head{margin:0;height:44px;cursor:pointer}',
    '#vein-root .vein-stat{font-variant-numeric:tabular-nums}#vein-root .vein-sub{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}',
    '#vein-root .vein-stat,#vein-root .vein-last,#vein-root .vein-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#vein-root .vein-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#vein-root .vein-last{color:#79c0ff;font-size:12px;margin-top:2px}#vein-root .vein-last:empty{display:none}',
    '#vein-root .vein-msg{margin:4px 0 2px}#vein-root .vein-btns{display:flex;gap:6px;margin-top:8px}',
    '#vein-root .vein-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#vein-root .vein-btns button:hover{border-color:#79c0ff}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('vein-style');
    if (!st) { st = el('style'); st.id = 'vein-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('vein-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'vein-root';
    card = el('div', 'vein-card');
    var head = el('div', 'vein-head');
    head.appendChild(el('span', 'vein-title', 'Enigma Veins'));
    var mini = el('span', 'vein-mini'); mini.id = 'vein-mini'; mini.title = 'Sent today'; head.appendChild(mini);
    head.appendChild(el('span', 'vein-dot'));
    var mb = el('button'); mb.id = 'vein-min'; mb.type = 'button';
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    if (window.OpsJam) head.insertBefore(window.OpsJam.button(), mb);   // Jam: play Rickroll alongside, from the title row (Tex 2026-10-14)
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'vein-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'enigma-veins', handle: '.vein-head' });   // the player can drag the card by its title (Tex)
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; card = null; body = null; }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('vein-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Enigma Veins' : 'Minimize Enigma Veins'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() {
    if (!S.min && lastFold) { forceOpen = !forceOpen; paint(); return; }   // a fold made for room: not the player's choice
    S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint();
  }
  // Tools that run together keep their cards apart (Tex 2026-10-16): ops-stack.js finds this card a free spot, or folds
  // it for room; without the helper the card stays at its own spot.
  var forceOpen = false, lastFold = false;
  function where() { return window.OpsStack ? window.OpsStack.layout(root, 'enigma-veins', !!(card && /\bmin\b/.test(card.className)), paint) : { placed: true, top: '', left: '', right: '', fold: false }; }   // no helper: leave the card where it is
  function place(L) {
    if (!root || L.placed) return;
    if (root.style.top !== L.top) root.style.top = L.top;
    if (root.style.left !== L.left) root.style.left = L.left;
    if (root.style.right !== L.right) root.style.right = L.right;
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    var st = el('div', 'vein-stat'); st.id = 'vein-stat'; body.appendChild(st);
    var sub = el('div', 'vein-sub'); sub.id = 'vein-sub'; body.appendChild(sub);
    var foot = el('div', 'vein-foot'); foot.id = 'vein-foot'; body.appendChild(foot);
    var last = el('div', 'vein-last'); last.id = 'vein-last'; body.appendChild(last);
    var btns = el('div', 'vein-btns');
    btns.appendChild(button('vein-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'vein-msg', text));
    if (withClose) { var btns = el('div', 'vein-btns'); btns.appendChild(button('vein-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'vein-card';
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  function paint() {
    if (!card || S.view !== 'run') return;
    // the game drops a vein from your list once you've mined it (live 2026-10-14), so the card counts sends, not mined veins
    put('vein-stat', S.eventId ? 'Sent ' + todayCount() + ' today · Open ' + S.up : 'Enigma Veins');
    put('vein-sub', 'On the way ' + S.onWay + ' / ' + S.max);
    put('vein-foot', S.foot);
    put('vein-last', S.last);
    put('vein-mini', String(todayCount()));
    var L = where(), folded = S.min || (L.fold && !forceOpen); lastFold = !!L.fold;
    var tt = card.querySelector('.vein-title'), tx = folded ? 'Veins' : 'Enigma Veins';
    if (tt && tt.textContent !== tx) tt.textContent = tx;
    card.className = 'vein-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (folded ? ' min' : '');
    place(L);
  }

  // ---------------------------------------------------------------- start
  window.__VEIN = {
    running: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { up: S.up, mined: S.mined, onWay: S.onWay, sentRun: S.sentRun, skipped: S.skipped, foot: S.foot, last: S.last, eventId: S.eventId, sent: Object.keys(S.sent.keys).length }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var id = ''; try { var u = UD(); id = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!id) { showMessage('Open the game and log in first.', true); window.__VEIN.running = false; return; }
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
