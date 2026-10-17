// ops-unattended.js — Ops Center Unattended mode (Tex 2026-10-16). Tex's (or Rеx's) game runs in a frame on this tab
// (#mapc-frame, so every frame-aware tool drives it), and the Map Collector dashboard starts and stops the six
// hands-off collectors here and reconnects the game. The tab checks in with the worker every 15 s; commands come back
// signed with a key made from the Map Collector password and are checked here (ops-unattended-core.js), so the worker
// can't make one. Only allowed accounts see the tile (worker /opsremote/visible).
(function () {
  'use strict';
  if (window.__OPSU && window.__OPSU.running) { window.__OPSU.flash(); return; }
  var C = window.OpsUnattendedCore;
  if (!C) { try { alert('Unattended mode did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-16';
  var WORKER = window.__OPSU_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var BASE = window.__OPSU_BASE || 'https://2864tw.com/';
  var SYNC_MS = window.__OPSU_SYNC_MS || 15000, READY_MS = window.__OPSU_READY_MS || 180000, CARD_MS = window.__OPSU_CARD_MS || 20000, STOP_MS = 60000;
  var LS_KEY = 'opsu_v1_', LS_SEEN = 'opsu_seen_v1_', LS_MIN = 'opsu_min_v1';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------------------------------------------------------------- the game: this page until the frame is up, then the frame
  var frame = null;
  function GW() { return frame && frame.contentWindow ? frame.contentWindow : window; }
  function req(n) { return GW().__require(n); }
  function connected() { try { var s = req('NetMgr').NET._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function ready() { try { var u = req('DataCenter').DATA.UserData; return !!(u && u.Name) && connected(); } catch (e) { return false; } }

  var S = { running: false, ending: false, halted: false, siteKey: '', pass: '', key: '', skew: 0, seen: {}, badSigs: 0, downSince: 0,
    queue: [], acks: [], last: null, note: '', failing: false, reconnecting: null, reconnects: 0, timer: null, ticker: null, syncing: false,
    draining: false, lastSyncAt: 0, tools: {}, min: lsGet(LS_MIN) === '1', view: '' };
  function wnow() { return Date.now() + S.skew; }                   // the worker's clock: commands are stamped with it

  // The game in a frame, so a reconnect reloads only the frame. Map Collector's own Unattended frame is used as is.
  function goFrame() {
    var f = document.getElementById('mapc-frame');
    if (f) { frame = f; return; }
    try { window.cc.game.pause(); } catch (e) {}
    try { window.__require('NetMgr').NET.dispose(true); } catch (e) {}
    frame = document.createElement('iframe');
    frame.id = 'mapc-frame';
    frame.src = location.href;
    frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write');
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147482000;background:#000';
    document.body.appendChild(frame);
  }
  function waitReady(ms) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() { if (!S.running || S.ending) return resolve(false); if (ready()) return resolve(true); if (Date.now() - t0 > ms) return resolve(false); setTimeout(poll, 500); })();
    });
  }

  // ---------------------------------------------------------------- the six tools, from the published list
  var REG = {};
  function loadRegistry() {
    return fetch(BASE + 'ops-tools.json?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var out = {};
      (j && Array.isArray(j.tools) ? j.tools : []).forEach(function (t) {
        if (!t || !Object.prototype.hasOwnProperty.call(C.TOOLS, t.id) || !Array.isArray(t.scripts) || typeof t.version !== 'string' || typeof t.overlay !== 'string') return;
        if (!t.scripts.every(function (f) { return /^[a-z0-9-]+\.js$/.test(f); })) return;
        out[t.id] = { scripts: t.scripts, version: t.version, overlay: t.overlay, title: String(t.title || t.id) };
      });
      REG = out;
    });
  }
  function toolRoot(id) { var t = REG[id]; try { return t ? document.querySelector(t.overlay) : null; } catch (e) { return null; } }
  function toolState(id) {
    var r = toolRoot(id);
    if (!r) return { state: 'off', why: '' };
    if (r.hasAttribute('data-ops-stopped')) { var m = r.querySelector('[class$="-msg"]'); return { state: 'stopped', why: m ? m.textContent.trim().slice(0, 160) : '' }; }
    return { state: 'running', why: '' };
  }
  // A tool's card goes the way its own Close button takes it, so the tool clears what guards a relaunch
  // (HT Gift Boxes keeps __HTG.open until then: review C2).
  function closeCard(id) {
    var r = toolRoot(id);
    if (!r) return;
    var b = r.querySelector('button[id$="-close"]');
    if (b) { try { b.click(); } catch (e) {} }
    r = toolRoot(id);
    if (r && r.parentNode) r.parentNode.removeChild(r);
  }
  function toolsNow() { var o = {}; C.ORDER.forEach(function (id) { o[id] = toolState(id); }); return o; }
  function api(id) { return window[C.TOOLS[id]]; }
  function isRunning(id) {
    var g = api(id);
    if (!g) return false;
    if (typeof g.running === 'boolean') return g.running;
    try { return !!(g.state && g.state().running); } catch (e) { return false; }
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('load')); };
      document.body.appendChild(s);
    });
  }
  function startTool(id) {
    var t = REG[id];
    if (!t) return Promise.resolve('unknown tool');
    if (toolState(id).state === 'running') return Promise.resolve('Already running');
    var need = C.NEEDS_PW[id];
    if (need && !lsGet(need)) return Promise.resolve('needs its password on that computer');
    if (!ready()) return Promise.resolve('the game is down: reconnect first');
    closeCard(id);                                                   // its last stop message
    var chain = Promise.resolve();
    t.scripts.forEach(function (f) {
      chain = chain.then(function () {
        var p = loadScript(BASE + f + '?v=' + encodeURIComponent(t.version));
        return /^ops-(drag|jam|stack)\.js$/.test(f) ? p.catch(function () {}) : p;   // the helpers are optional
      });
    });
    return chain.then(function () {
      if (S.ending) return stopTool(id).then(function () { return 'refused: stopping'; });   // Stop came while it loaded (review I3)
      var t0 = Date.now();
      return new Promise(function (resolve) {
        (function poll() {
          if (toolState(id).state === 'running') return resolve('Started');
          if (Date.now() - t0 > CARD_MS) return resolve("Started, but its card didn't show");
          setTimeout(poll, 200);
        })();
      });
    }, function () { return "Didn't load"; });
  }
  function stopTool(id) {
    var st = toolState(id);
    if (st.state === 'off') return Promise.resolve('Not running');
    var g = api(id);
    if (st.state === 'running' && g && typeof g.stop === 'function') { try { g.stop(); } catch (e) {} }
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        if (!isRunning(id) || Date.now() - t0 > STOP_MS) {         // the Gatherer may first put a base skin back
          var why = toolState(id).why;
          closeCard(id);
          return resolve('Stopped' + (why && !/^Stopped/.test(why) ? ': ' + why : ''));
        }
        setTimeout(poll, 200);
      })();
    });
  }
  function stopAll() {
    var ids = C.ORDER.filter(function (id) { return toolState(id).state !== 'off'; });
    if (!ids.length) return Promise.resolve('Nothing running');
    return ids.reduce(function (p, id) { return p.then(function () { return stopTool(id); }); }, Promise.resolve()).then(function () { return 'Stopped ' + ids.length; });
  }
  function reconnect() {
    if (S.reconnecting) return S.reconnecting;
    S.reconnects++;
    try { frame.contentWindow.location.reload(); } catch (e) {}
    paint();
    S.reconnecting = delay(1500).then(function () { return waitReady(READY_MS); }).then(function (ok) {
      S.reconnecting = null;
      if (ok) { S.downSince = 0; paint(); return 'Reconnected'; }
      paint();
      var old = Date.now() - performance.timeOrigin > C.OLD_LOGIN_MS;
      return 'Reconnect failed' + (old ? ': the login link may have expired, open the game again on that computer' : '');
    });
    return S.reconnecting;
  }

  // ---------------------------------------------------------------- commands
  function runCommand(c) {
    var cmd = c && c.cmd;
    var listed = Object.keys(REG).length ? Promise.resolve() : loadRegistry().catch(function () {});   // a failed fetch at turn-on (review I5)
    return listed.then(function () { return C.check(S.key, cmd, c && c.sig, { siteKey: S.siteKey, now: wnow(), seen: S.seen, tools: Object.keys(REG) }).then(function (r) {
      var nonce = cmd && typeof cmd.nonce === 'string' && /^[0-9a-f]{32}$/.test(cmd.nonce) ? cmd.nonce : null;
      if (!r.ok) {
        S.badSigs = r.badSig ? S.badSigs + 1 : 0;
        if (nonce) S.acks.push({ nonce: nonce, result: 'refused: ' + r.why });
        if (S.badSigs >= C.BAD_SIG_MAX) halt("The dashboard's key doesn't match this tab: turn Unattended mode off and on again.");
        return;
      }
      S.badSigs = 0;
      S.seen = C.pruneSeen(S.seen, wnow()); S.seen[cmd.nonce] = cmd.at;
      lsSet(LS_SEEN + S.siteKey, JSON.stringify(S.seen));
      var p = cmd.kind === 'start' ? startTool(cmd.tool) : cmd.kind === 'stop' ? stopTool(cmd.tool) : cmd.kind === 'stopall' ? stopAll() : reconnect();
      return p.then(function (result) {
        S.acks.push({ nonce: cmd.nonce, result: result });
        S.last = { kind: cmd.kind, tool: cmd.tool, result: result, at: wnow() };
        paint();
      });
    }); });
  }
  // One command at a time; check-ins go on meanwhile (a reconnect can take minutes).
  function drain() {
    if (S.draining || !S.queue.length || !S.running || S.halted || S.ending) return;
    S.draining = true;
    var c = S.queue.shift();
    runCommand(c).catch(function () {}).then(function () {
      S.draining = false;
      if (Date.now() - S.lastSyncAt > 1000) sync();                  // report the result soon
      drain();
    });
  }

  // ---------------------------------------------------------------- check-ins
  function status() {
    var up = ready();
    if (up) S.downSince = 0; else if (!S.downSince) S.downSince = wnow();
    S.tools = toolsNow();
    return { on: true, version: VERSION, connected: up, downSince: up ? 0 : S.downSince, loadedAt: Math.round(performance.timeOrigin + S.skew),
      note: S.note, tools: S.tools, last: S.last };
  }
  function sync() {
    if (!S.running || S.ending || S.halted || S.syncing) return Promise.resolve();
    S.syncing = true; S.lastSyncAt = Date.now();
    if (!Object.keys(REG).length) loadRegistry().catch(function () {});
    var acks = S.acks.splice(0, 20);
    return fetch(WORKER + '/opsremote/sync', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Authorization': 'Bearer ' + S.pass }, cache: 'no-store',
      body: JSON.stringify({ status: status(), acks: acks }) })
      .then(function (r) { return r.json().then(function (j) { return { code: r.status, j: j || {} }; }, function () { return { code: r.status, j: {} }; }); },
        function () { return { code: 0, j: {} }; })
      .then(function (r) {
        S.syncing = false;
        if (r.code === 200) {
          S.failing = false;
          if (typeof r.j.now === 'number') S.skew = r.j.now - Date.now();
          (Array.isArray(r.j.commands) ? r.j.commands : []).forEach(function (c) { S.queue.push(c); });
          drain();
        } else {
          S.acks = acks.concat(S.acks);                              // not delivered: they go with the next check-in
          if (r.code === 401 || r.code === 403) { forgetPass(); end('Unattended mode was turned off for this account.'); return; }
          if (r.code === 409) { forgetPass(); end(r.j.error === 'off' ? 'Unattended mode was turned off.' : 'Another tab took over Unattended mode.'); return; }
          S.failing = true;
        }
        paint();
      });
  }
  // Stopping: what waits is refused, the command in progress ends first (a reconnect ends at once), then stop all.
  function wind() {
    S.queue.splice(0).forEach(function (c) { var n = c && c.cmd && c.cmd.nonce; if (typeof n === 'string' && /^[0-9a-f]{32}$/.test(n)) S.acks.push({ nonce: n, result: 'refused: stopping' }); });
    var t0 = Date.now();
    return new Promise(function (resolve) { (function poll() { if (!S.draining || Date.now() - t0 > 15000) return resolve(); setTimeout(poll, 100); })(); }).then(stopAll);
  }
  function forgetPass() {
    var saved = lsJSON(LS_KEY + S.siteKey) || {};
    lsSet(LS_KEY + S.siteKey, saved.key ? JSON.stringify({ key: saved.key }) : null);
  }
  // The worker refused this tab: stop everything it started, say why.
  function end(reason) {
    if (S.ending) return;
    S.ending = true;
    clearInterval(S.timer); S.timer = null;
    wind().then(function () {
      S.running = false; window.__OPSU.running = false; clearInterval(S.ticker);
      showMessage(reason + ' Everything it started here has stopped.', true);
    });
  }
  // Commands that don't add up: no more check-ins; what runs keeps running until Stop.
  function halt(msg) {
    S.halted = true; S.note = msg;
    clearInterval(S.timer); S.timer = null;
    paint();
  }
  function stopByYou() {
    if (S.ending) return;
    S.ending = true;
    clearInterval(S.timer); S.timer = null;
    S.note = 'Stopping...'; paint();
    wind().then(function () {
      return fetch(WORKER + '/opsremote/off', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Authorization': 'Bearer ' + S.pass }, cache: 'no-store', body: '{}' })
        .catch(function () {});
    }).then(function () {
      forgetPass();
      S.running = false; window.__OPSU.running = false; clearInterval(S.ticker);
      showMessage('Unattended mode is off. The game stays open here.', true);
    });
  }

  // ---------------------------------------------------------------- turning on
  function enable(pw) {
    showMessage('Checking...');
    fetch(WORKER + '/opsremote/enable', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Map-Collector-Password': pw }, cache: 'no-store',
      body: JSON.stringify({ siteKey: S.siteKey }) })
      .then(function (r) { return r.json().then(function (j) { return { code: r.status, j: j || {} }; }, function () { return { code: r.status, j: {} }; }); },
        function () { return { code: 0, j: {} }; })
      .then(function (r) {
        if (r.code === 401) return askPassword("That password didn't work.");
        if (r.code === 403) { window.__OPSU.running = false; return showMessage('Unattended mode is not available for this account.', true); }
        if (r.code === 429) return askPassword('Too many tries. Wait 15 minutes and try again.');
        if (r.code !== 200 || typeof r.j.pass !== 'string') return askPassword("Can't reach the server. Try again in a minute.");
        S.pass = r.j.pass;
        if (typeof r.j.now === 'number') S.skew = r.j.now - Date.now();
        return C.deriveKey(pw, S.siteKey).then(function (k) {
          S.key = k;
          lsSet(LS_KEY + S.siteKey, JSON.stringify({ pass: S.pass, exp: r.j.exp, key: k }));
          begin();
        });
      });
  }
  // A launch with a remembered pass claims the account: the worker swaps the pass, so another tab holding the old one
  // stops at its next check-in (review I4). No answer: go on with the old pass (check-ins will say so).
  function resume(saved) {
    showMessage('Checking...');
    fetch(WORKER + '/opsremote/resume', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Authorization': 'Bearer ' + saved.pass }, cache: 'no-store', body: '{}' })
      .then(function (r) { return r.json().then(function (j) { return { code: r.status, j: j || {} }; }, function () { return { code: r.status, j: {} }; }); },
        function () { return { code: 0, j: {} }; })
      .then(function (r) {
        S.key = saved.key;
        if (r.code === 200 && typeof r.j.pass === 'string') {
          S.pass = r.j.pass;
          if (typeof r.j.now === 'number') S.skew = r.j.now - Date.now();
          lsSet(LS_KEY + S.siteKey, JSON.stringify({ pass: S.pass, exp: r.j.exp, key: saved.key }));
          return begin();
        }
        if (r.code === 0 || r.code >= 500 || r.code === 429) { S.pass = saved.pass; return begin(); }
        forgetPass();
        askPassword(r.code === 409 && r.j.error !== 'off' ? 'Another tab took over Unattended mode. Turn it on again here to take it back.' : 'Unattended mode was turned off. Turn it on again with your password.');
      });
  }
  function begin() {
    S.running = true;
    showRun();
    S.note = 'Starting the game here...'; paint();
    loadRegistry().catch(function () {}).then(function () {
      goFrame(); window.__OPSU.frame = frame;
      return waitReady(READY_MS);
    }).then(function (ok) {
      S.note = ok ? '' : "The game didn't start. Reconnect from the dashboard.";
      sync();
      S.timer = setInterval(sync, SYNC_MS);
      S.ticker = setInterval(paint, 1000);
      paint();
    });
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#opsu-root{position:fixed;right:calc(8px + env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#opsu-root .opsu-card{width:240px;max-width:calc(100vw - 16px);box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:8px 12px 12px;box-shadow:0 8px 24px rgba(1,4,9,.5)}',
    '#opsu-root .opsu-card.flash{border-color:#79c0ff}#opsu-root .opsu-card.min{width:auto;padding:0 4px 0 12px}',
    '#opsu-root .opsu-head{display:flex;align-items:center;gap:8px;min-height:44px;cursor:grab}',
    '#opsu-root .opsu-title{flex:1;font-weight:600;font-size:14px}',
    '#opsu-root button#opsu-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center;cursor:pointer}',
    '#opsu-root button#opsu-min:hover{color:#e6edf3;background:#1c2128}#opsu-root .min button#opsu-min svg{transform:rotate(180deg)}',
    '#opsu-root .min .opsu-body{display:none}',
    '#opsu-root .opsu-line{margin:4px 0;color:#8b949e;overflow-wrap:anywhere}#opsu-root #opsu-stat{color:#3fb950}',
    '#opsu-root .warn #opsu-stat{color:#d29922}#opsu-root .bad #opsu-stat{color:#f85149}',
    '#opsu-root input{width:100%;box-sizing:border-box;margin:6px 0;padding:8px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font:inherit}',
    '#opsu-root .opsu-btns{display:flex;gap:6px;margin-top:8px}',
    '#opsu-root .opsu-btns button{flex:1;min-height:40px;border-radius:8px;border:1px solid #30363d;background:#1c2128;color:#e6edf3;font:inherit;cursor:pointer}',
    '#opsu-root .opsu-msg{margin:4px 0 2px}'
  ].join('');
  var root = null, card = null, body = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('opsu-style');
    if (!st) { st = document.createElement('style'); st.id = 'opsu-style'; document.head.appendChild(st); }
    st.textContent = CSS;
    root = el('div'); root.id = 'opsu-root';
    card = el('div', 'opsu-card');
    var head = el('div', 'opsu-head');
    head.appendChild(el('span', 'opsu-title', 'Unattended mode'));
    var mb = el('button'); mb.id = 'opsu-min'; mb.type = 'button'; mb.setAttribute('aria-label', 'Minimize Unattended mode');
    mb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    mb.addEventListener('click', function () { S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); paint(); if (S.view !== 'run') card.className = 'opsu-card' + (S.min ? ' min' : ''); });
    head.appendChild(mb);
    body = el('div', 'opsu-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'ops-unattended', handle: '.opsu-head' });
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; card = null; body = null; }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; S.view = 'message'; card.className = 'opsu-card';
    body.appendChild(el('div', 'opsu-msg', text));
    if (withClose) { var b = el('div', 'opsu-btns'); b.appendChild(button('opsu-close', 'Close', function () { window.__OPSU.running = false; removeRoot(); })); body.appendChild(b); }
  }
  function askPassword(msg) {
    ensureRoot(); body.textContent = ''; S.view = 'password'; card.className = 'opsu-card';
    body.appendChild(el('div', 'opsu-msg', 'Enter your Map Collector password. Your dashboard can then start and stop collectors here and reconnect this game. Leave this tab open.'));
    var inp = el('input'); inp.id = 'opsu-pw'; inp.type = 'password'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Map Collector password');
    body.appendChild(inp);
    if (msg) body.appendChild(el('div', 'opsu-msg', msg));
    var go = function () { var v = String(inp.value || ''); if (v) enable(v); };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    var b = el('div', 'opsu-btns');
    b.appendChild(button('opsu-go', 'Turn on', go));
    b.appendChild(button('opsu-close', 'Close', function () { window.__OPSU.running = false; removeRoot(); }));
    body.appendChild(b);
    try { inp.focus(); } catch (e) {}
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; S.view = 'run';
    ['opsu-stat', 'opsu-tools', 'opsu-last', 'opsu-note'].forEach(function (id) { var e = el('div', 'opsu-line'); e.id = id; body.appendChild(e); });
    var b = el('div', 'opsu-btns'); b.appendChild(button('opsu-stop', 'Stop', stopByYou)); body.appendChild(b);
    paint();
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) e.textContent = text; }
  function titles(ids) { return ids.map(function (id) { return (REG[id] && REG[id].title) || id; }).join(', '); }
  function paint() {
    if (!card || S.view !== 'run') return;
    var stat, tone;
    if (S.halted) { stat = S.note; tone = 'bad'; }
    else if (S.reconnecting) { stat = 'Reconnecting...'; tone = 'warn'; }
    else if (frame && !ready()) { stat = 'Game down ' + C.mins(wnow() - (S.downSince || wnow())) + ': reconnect from the dashboard'; tone = 'bad'; }
    else if (S.failing) { stat = 'Check-ins failing, retrying'; tone = 'warn'; }
    else if (!frame) { stat = S.note || 'Starting...'; tone = 'ok'; }
    else { stat = 'Connected · checking in'; tone = 'ok'; }
    put('opsu-stat', stat);
    var on = C.ORDER.filter(function (id) { return S.tools[id] && S.tools[id].state === 'running'; });
    put('opsu-tools', on.length ? 'Running: ' + titles(on) : 'Nothing running');
    var l = S.last;
    put('opsu-last', l ? (l.kind === 'start' ? 'Start ' + titles([l.tool]) : l.kind === 'stop' ? 'Stop ' + titles([l.tool]) : l.kind === 'stopall' ? 'Stop all' : 'Reconnect') + ': ' + l.result : '');
    put('opsu-note', !S.halted && frame ? S.note : '');
    card.className = 'opsu-card' + (tone === 'ok' ? '' : ' ' + tone) + (S.min ? ' min' : '');
  }

  // ---------------------------------------------------------------- start
  window.__OPSU = {
    running: true, version: VERSION, frame: null,
    reconnect: function () { return reconnect(); },
    stop: function () { stopByYou(); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { siteKey: S.siteKey, view: S.view, halted: S.halted, failing: S.failing, reconnects: S.reconnects, queue: S.queue.length, tools: S.tools, last: S.last }; }
  };
  ensureRoot();
  showMessage('Starting...');
  var uid = ''; try { var u = window.__require('DataCenter').DATA.UserData; uid = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!uid) { showMessage('Open the game and log in first, then try again.', true); window.__OPSU.running = false; return; }
  sha256Hex(uid).then(function (h) {
    S.siteKey = h.slice(0, 16);
    S.seen = C.pruneSeen(lsJSON(LS_SEEN + S.siteKey) || {}, Date.now());
    var saved = lsJSON(LS_KEY + S.siteKey);
    if (saved && typeof saved.pass === 'string' && saved.exp > Date.now() + 86400000 && /^[0-9a-f]{64}$/.test(saved.key || '')) resume(saved);
    else askPassword('');
  }, function () { showMessage('This browser cannot run Unattended mode.', true); window.__OPSU.running = false; });
})();
