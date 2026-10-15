// ht-gifts.js — HT Gift Boxes: during Chip Blessing, claims the HT Treasure gift boxes that players' blessings drop on
// the map, with the game's own requests: the next claimable gift (8852), the map view around it (901), the box's Claim
// (902, a march with no troops). At most 5 gift marches out, up to the game's daily cap. Behind the password
// "bananas" (Tex). Rules live in ht-gifts-core.js (window.HtGiftsCore). One request at a time, each at least 1.5 s
// after the last one any Ops tool sent.
(function () {
  'use strict';
  if (window.__HTG && window.__HTG.open) { window.__HTG.flash(); return; }
  var C = window.HtGiftsCore;
  if (!C) { try { alert('HT Gift Boxes did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-15';
  var WORKER = window.__HTG_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var GAP_MS = window.__HTG_GAP_MS || C.GAP_MS, TIMEOUT_MS = window.__HTG_TIMEOUT_MS || 10000, POLL_MS = window.__HTG_POLL_MS || 1000;
  var BUSY_MS = window.__HTG_BUSY_MS || 10000, IDLE_MS = window.__HTG_IDLE_MS || 30000;
  var LS_PW = 'htg_pw_v1', LS_SENT = 'htg_sent_v1_', LS_OWN = 'htg_own_v1_', LS_COUNT = 'htg_count_v1_', LS_MIN = 'htg_min_v1';
  var TARGET = {};

  // ---------------------------------------------------------------- game
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
  function serverSec() { try { var t = Number(DATA().ServerTime); return t > 0 ? t : Math.floor(Date.now() / 1000); } catch (e) { return Math.floor(Date.now() / 1000); } }
  function ids() {
    var o = { query: 8852, view: 901, march: 902, drop: C.DROP, claim: C.CLAIM, type: C.TYPE };
    try { var v = req('NRequestIdV2').NRequestIdV2.FLOAT_PARADE_QUERY_CAN_REWARD_BAG; if (typeof v === 'number') o.query = v; } catch (e) {}
    try { var R = req('RequestId').RequestId; if (typeof R.GET_WORLD_INFO === 'number') o.view = R.GET_WORLD_INFO; if (typeof R.MARCH_WORLD_POINT === 'number') o.march = R.MARCH_WORLD_POINT; } catch (e) {}
    try { var W = req('WorldMapCommon'); if (typeof W.MarchType.CHIP_BLESSING_ITEM_DROP === 'number') o.drop = W.MarchType.CHIP_BLESSING_ITEM_DROP; if (typeof W.MarchType.CHIP_BLESSING_GET_ITEM_DROP_REWARD === 'number') o.claim = W.MarchType.CHIP_BLESSING_GET_ITEM_DROP_REWARD; if (typeof W.WorldMapEntityType.CHIP_BLESSING_ITEMDROP_BUILD === 'number') o.type = W.WorldMapEntityType.CHIP_BLESSING_ITEMDROP_BUILD; } catch (e) {}
    return o;
  }
  function cfg(n) { try { return req('GameTools').default.getDataConfigData(n); } catch (e) { return null; } }
  function table(name, key) { try { return req('TableManager').TABLE.getTableDataById(name, String(key)); } catch (e) { return null; } }
  function paradeTable() { try { return req('TableName').TableName.alliance_parade || 'alliance_parade'; } catch (e) { return 'alliance_parade'; } }
  function bagCap(id) { var t = table(paradeTable(), id); return t ? Number(t.bag_reward_num) || 0 : 0; }
  function me() { try { return String(UD().StrUid || ''); } catch (e) { return ''; } }
  function myUid() { try { var u = UD(); return String(u.UID != null ? u.UID : (u.StrUid || '')); } catch (e) { return ''; } }
  function homeK() { try { return Number(UD().ServerId) || 0; } catch (e) { return 0; } }
  function received(type) { try { return Number((UD().getItemDropReceivedNumData() || {})[type]) || 0; } catch (e) { return 0; } }
  function capNow() { return C.capFrom(cfg(C.CAP_CFG)); }
  // Our gift marches the game's march list shows.
  function worldOut(type) {
    var n = 0, uid = myUid();
    try { var ms = req('NWorldMapData').default.instance.marches || {}; Object.keys(ms).forEach(function (k) { var m = ms[k]; if (m && m.marchType === type && String(m.realUid) === uid) n++; }); } catch (e) {}
    return n;
  }
  function gameText(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
  function parse(a) { var d = a && a.d; if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return null; } } return d && typeof d === 'object' ? d : null; }
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
  var S = { running: false, stopped: false, siteKey: '', sent: { day: '', keys: {} }, own: [], log: [], claimedRun: 0, count: null,
    out: 0, today: 0, cap: 10, foot: '', tone: 'ok', last: '', min: lsGet(LS_MIN) === '1', view: '' };
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  function syncSent() { if (S.sent.day !== today()) S.sent = C.sentFor(lsJSON(LS_SENT + S.siteKey), today()); }
  function remember(g) { syncSent(); S.sent.keys[g.key] = Date.now(); S.sent.keys['@' + g.x + ',' + g.y] = Date.now(); lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent)); }
  // Our gift marches survive a relaunch: the game's march list may not show them.
  function loadOwn() { var st = lsJSON(LS_OWN + S.siteKey), now = serverSec(); S.own = st && st.day === today() && Array.isArray(st.own) ? st.own.filter(function (c) { return c && c.ret > now; }) : []; }
  function saveOwn() { var now = serverSec(); S.own = S.own.filter(function (c) { return c.ret > now; }); lsSet(LS_OWN + S.siteKey, JSON.stringify({ day: today(), own: S.own })); }
  function forget(g) { delete S.sent.keys[g.key]; delete S.sent.keys['@' + g.x + ',' + g.y]; lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent)); }
  function reportUsage() {
    var name = '';
    try { name = String(UD().Name || '').slice(0, 40); } catch (e) {}
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: 'ht-gifts', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  function counts(I) {
    var now = serverSec(), rec = received(I.type), infl = C.inFlight(S.own, now);
    S.cap = capNow(); S.out = C.outCount(S.own, worldOut(I.claim), now); S.today = rec + infl;
    return { out: S.out, received: rec, inflight: infl, cap: S.cap };
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
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() { var wait = P.at + GAP_MS - Date.now(); if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000)); })();
    });
  }
  // One request: the shared clock, a fresh check (running, connected, and for a march no other march request still
  // waiting), then send. 'stopped' / 'offline' / 'busy': not sent.
  async function ask(fn, id, p, march) {
    await pace();
    if (!S.running) return { s: 'stopped' };
    if (!ready() || flight) return { s: 'offline' };
    if (march) { var N = NET(); if (typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(id)) return { s: 'busy' }; }
    return call(function (cb) { return NET()[fn](id, p, TARGET, cb); });
  }
  function refused(r) { stop(gameText(r.key) || ('the game answered ' + r.s + (r.key ? ' (' + r.key + ')' : ''))); }

  // ---------------------------------------------------------------- the loop
  function mmss(sec) { var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  async function idle(ms, text) {
    var end = Date.now() + ms;
    while (S.running && Date.now() < end) { setFoot(text + ' ' + mmss(Math.max(1, Math.ceil((end - Date.now()) / 1000))), 'ok'); await delay(Math.min(POLL_MS, 1000)); }
  }
  async function run() {
    while (S.running) {
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(POLL_MS); continue; }
      syncSent();
      var I = ids(), c = counts(I);
      if (c.received + c.inflight >= c.cap) {
        if (c.inflight > 0) { setFoot('Last claims on the way...', 'ok'); await delay(POLL_MS); continue; }
        finish('Done for today: ' + c.received + ' of ' + c.cap + '.'); return;
      }
      if (c.out >= C.MAX_OUT) { setFoot(C.MAX_OUT + ' out. Waiting for one to return.', 'ok'); await delay(POLL_MS); continue; }
      var g = C.gate(S.log, Date.now());
      if (!g.ok) { setFoot('Paused: ' + g.reason + '.', 'warn'); await delay(POLL_MS); continue; }
      setFoot('Looking for gift boxes...', 'ok');
      var q = await ask('sendPBV2', I.query, { queryType: 1, marchType: I.drop });
      if (q.s === 'stopped') return;
      if (q.s === 'offline') { await delay(POLL_MS); continue; }
      var Q = C.classifyQuery(q);
      if (Q.kind === 'silent') { await idle(IDLE_MS, "The game didn't answer. Looking again in"); continue; }
      if (Q.kind === 'none') { await idle(IDLE_MS, 'No gift boxes right now. Looking again in'); continue; }
      var v = await ask('send', I.view, { x: Q.x, y: Q.y, k: homeK(), rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 });
      if (v.s === 'stopped') return;
      if (v.s === 'offline') { await delay(POLL_MS); continue; }
      var V = C.classifyView(v);
      if (V.kind === 'silent') { await idle(IDLE_MS, "The game didn't answer. Looking again in"); continue; }
      if (V.kind === 'refused') { refused(V); return; }          // an unknown answer: never claim right after it
      var cands = C.pickGifts(V.points.map(function (p) { return p && p.pointType === I.type ? Object.assign({}, p, { pointType: C.TYPE }) : p; }),
        { me: me(), sent: S.sent.keys, bagCap: bagCap, now: serverSec(), k: homeK(), anchor: { x: Q.x, y: Q.y }, nowMs: Date.now() });
      var busy = false;
      for (var i = 0; i < cands.length && S.running; i++) {
        if (C.room(counts(I)) < 1) break;
        var r = await claim(cands[i], I);
        if (r === false) return;
        if (r === 'busy') { busy = true; break; }
      }
      if (S.running) await idle(cands.length ? BUSY_MS : IDLE_MS, busy ? 'The game is busy with a march. Looking again in' : cands.length ? 'Looking again in' : 'No new gift boxes here. Looking again in');
    }
  }
  // Claim one gift box. true: on its way. 'busy': another tool's march request is still waiting. false: stopped.
  async function claim(gi, I) {
    var N = NET();
    if (typeof N.checkRequestIdNoRes === 'function' && N.checkRequestIdNoRes(I.march)) { setFoot('The game is busy with a march. Trying again shortly.', 'warn'); return 'busy'; }
    remember(gi);                                          // before the request: a lost answer never brings a second claim
    setFoot('Claiming the gift box at ' + gi.x + ', ' + gi.y + '...', 'ok');
    var a = await ask('send', I.march, { marchType: I.claim, x: gi.x, y: gi.y }, true);
    if (a.s === 'stopped') return false;
    if (a.s === 'busy') { forget(gi); setFoot('The game is busy with a march. Trying again shortly.', 'warn'); return 'busy'; }
    if (a.s === 'offline') { forget(gi); return 'busy'; }
    S.log.push(Date.now()); if (S.log.length > 100) S.log.shift();
    var r = C.classify(a);
    if (r.kind === 'silent') { stop("the game didn't answer a claim"); return false; }
    if (r.kind !== 'ok') { refused(r); return false; }
    S.own.push(C.ownFromAnswer(parse(a), serverSec())); saveOwn();
    S.claimedRun++; bump();
    S.last = 'Claimed ' + gi.x + ', ' + gi.y;
    reportUsage(); counts(I); paint();
    return true;
  }

  // ---------------------------------------------------------------- start / stop
  function end(text) { if (S.stopped) return; S.stopped = true; S.running = false; showMessage(text, true); }
  function stop(reason) {
    var r = String(reason).replace(/[.!\s]+$/, '');
    end(r === 'stopped by you' ? 'Stopped. Claimed ' + S.claimedRun + ' this run.' : 'HT Gift Boxes stopped: ' + r + '. Claimed ' + S.claimedRun + ' this run.');
  }
  function finish(text) { end(text + ' Claimed ' + S.claimedRun + ' this run.'); }
  function begin() {
    S.running = true; S.stopped = false;
    showRun(); reportUsage();
    run().catch(function (e) { stop('something went wrong (' + String((e && e.message) || e).slice(0, 60) + ')'); });
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#htg-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#htg-root .htg-card{width:min(240px,calc(100vw - 16px));box-sizing:border-box;background:#161b22;border:1px solid #388bfd;border-radius:10px;padding:8px 12px 10px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#htg-root .htg-card.warn{border-color:#d29922}#htg-root .htg-card.bad{border-color:#f85149}#htg-root .htg-card.flash{transform:scale(1.04)}',
    '#htg-root .htg-head{display:flex;align-items:center;gap:8px;font-weight:600;min-height:44px}#htg-root .htg-title{flex:1;white-space:nowrap}',
    '#htg-root .htg-dot{width:8px;height:8px;border-radius:50%;background:#388bfd}#htg-root .warn .htg-dot{background:#d29922}#htg-root .bad .htg-dot{background:#f85149}',
    '#htg-root .htg-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#htg-root .min .htg-mini{display:inline}',
    '#htg-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#htg-root button#htg-min{flex:none;width:44px;height:44px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#htg-root button#htg-min:hover{color:#e6edf3;background:#1c2128}#htg-root #htg-min svg{transition:transform .2s}#htg-root .min #htg-min svg{transform:rotate(180deg)}',
    '#htg-root .htg-card.min{width:auto;padding:0 4px 0 12px}#htg-root .min .htg-body{display:none}#htg-root .min .htg-head{cursor:pointer}',
    '#htg-root .htg-stat{font-variant-numeric:tabular-nums;font-weight:600}#htg-root .htg-sub{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}',
    '#htg-root .htg-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#htg-root .htg-last{color:#79c0ff;font-size:12px;margin-top:2px}#htg-root .htg-last:empty{display:none}',
    '#htg-root .htg-hint{color:#8b949e;font-size:12px;margin-top:6px}#htg-root .htg-msg{margin:4px 0 2px}#htg-root .htg-btns{display:flex;gap:6px;margin-top:8px}',
    '#htg-root .htg-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#htg-root .htg-btns button:hover{border-color:#79c0ff}',
    '#htg-root input#htg-pw{width:100%;height:44px;box-sizing:border-box;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#e6edf3;padding:0 10px;font-family:inherit;font-size:16px}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('htg-style');
    if (!st) { st = el('style'); st.id = 'htg-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('htg-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'htg-root';
    card = el('div', 'htg-card');
    var head = el('div', 'htg-head');
    head.appendChild(el('span', 'htg-title', 'HT Gift Boxes'));
    var mini = el('span', 'htg-mini'); mini.id = 'htg-mini'; head.appendChild(mini);
    head.appendChild(el('span', 'htg-dot'));
    var mb = el('button'); mb.id = 'htg-min'; mb.type = 'button'; mb.hidden = true;
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'htg-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'ht-gifts', handle: '.htg-head' });   // the player can drag the card by its title (Tex)
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; window.__HTG.open = false; }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('htg-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show HT Gift Boxes' : 'Minimize HT Gift Boxes'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() { S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint(); }
  function showPassword(bad) {
    ensureRoot(); body.textContent = ''; setView('password'); card.className = 'htg-card' + (bad ? ' warn' : '');
    var lab = el('label', 'htg-sub', 'Password'); lab.htmlFor = 'htg-pw'; body.appendChild(lab);
    var inp = el('input'); inp.id = 'htg-pw'; inp.type = 'password'; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize', 'off'); inp.spellcheck = false;
    body.appendChild(inp);
    body.appendChild(el('div', 'htg-hint', 'Contact [DOG] MONKEY\uD83D\uDC12 for the password.'));   // who hands it out (Tex 2026-10-15)
    if (bad) body.appendChild(el('div', 'htg-msg', "That's not the password."));
    var go = function () {
      sha256Hex(String(inp.value || '').trim().toLowerCase()).then(function (h) {
        if (C.checkPassword(h)) { lsSet(LS_PW, h); begin(); } else showPassword(true);
      });
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    var btns = el('div', 'htg-btns');
    btns.appendChild(button('htg-unlock', 'Unlock', go)); btns.appendChild(button('htg-close', 'Close', removeRoot));
    body.appendChild(btns);
    try { inp.focus(); } catch (e) {}
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    ['htg-stat', 'htg-sub', 'htg-foot', 'htg-last'].forEach(function (id) { var e = el('div', id); e.id = id; body.appendChild(e); });
    var btns = el('div', 'htg-btns');
    btns.appendChild(button('htg-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'htg-msg', text));
    if (withClose) { var btns = el('div', 'htg-btns'); btns.appendChild(button('htg-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'htg-card' + (/stopped:/.test(text) ? ' warn' : '');
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  function paint() {
    if (!card || S.view !== 'run') return;
    put('htg-stat', 'Claimed today ' + S.today + '/' + S.cap);
    put('htg-sub', 'Out ' + S.out + '/' + C.MAX_OUT);
    put('htg-foot', S.foot); put('htg-last', S.last); put('htg-mini', S.today + '/' + S.cap);
    card.className = 'htg-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (S.min ? ' min' : '');
  }

  // ---------------------------------------------------------------- start
  window.__HTG = {
    open: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { view: S.view, running: S.running, claimedRun: S.claimedRun, out: S.out, today: S.today, foot: S.foot, sent: Object.keys(S.sent.keys).length }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var uid = ''; try { var u = UD(); uid = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!uid) { showMessage('Open the game and log in first.', true); return; }
  sha256Hex(uid).then(function (h) {
    S.siteKey = h.slice(0, 16);
    S.count = lsJSON(LS_COUNT + S.siteKey);
    syncSent(); loadOwn();
    if (C.checkPassword(lsGet(LS_PW))) begin(); else showPassword(false);
  });
})();
