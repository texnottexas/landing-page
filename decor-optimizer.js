// decor-optimizer.js — Decor Optimizer (Tex 2026-10-17): arranges the player's decor for the most stats. It shows a
// preview first (nothing sent); on Run it carries the plan out one request at a time on the shared Ops clock, re-reading
// the game and planning again before each of the six phases (collab box, pick-ups, merges, Advanced Upgrade, placing,
// tidying sea decor). Any refusal, silence or change in the base stops the run. Rules in decor-core.js
// (window.DecorCore), the game side in decor-game.js (window.DecorGame).
(function () {
  'use strict';
  if (window.__DPO && window.__DPO.running) { window.__DPO.flash(); return; }
  var C = window.DecorCore, G = window.DecorGame;
  if (!C || !G) { try { alert('Decor Optimizer did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-17.3';
  var WORKER = window.__DPO_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = !!window.__DPO_FAST;
  var GAP_MS = window.__DPO_GAP_MS || 1500, JITTER_MS = FAST ? 0 : 300;     // 1.5 to 1.8 s after the last Ops request
  var TIMEOUT_MS = window.__DPO_TIMEOUT_MS || 10000, SETTLE_MS = window.__DPO_SETTLE_MS || 5000;
  var RUN_CAP = window.__DPO_RUN_CAP || 600, MIN_CAP = 40, TEN_CAP = 400;
  var WAIT_MS = FAST ? 100 : 2000;
  var LS_UNITS = 'dpo_units_v1_', LS_MIN = 'dpo_min_v1';
  var UNITS = [['army', 'Army'], ['navy', 'Navy'], ['air', 'Air Force']];
  var WHY = { 'no room': 'no room', off: 'unit switched off', gold: 'gold' };
  var PHASE = { collab: 'Collab box', pickup: 'Picking up', merge: 'Merging', upgrade: 'Advanced Upgrade', place: 'Placing', tidy: 'Tidying sea decor' };

  var S = { running: false, stopped: false, siteKey: '', settings: { army: true, navy: true, air: true }, done: 0, by: {}, sent: [],
    view: '', foot: '', tone: 'ok', min: false, names: {} };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function gameName() { try { return String(window.__require('DataCenter').DATA.UserData.Name || '').slice(0, 40); } catch (e) { return ''; } }

  // ---------------------------------------------------------------- pace and caps
  // One request clock for every Ops tool in this tab, then this tool's own caps (40 a minute, 400 in 10 minutes).
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 }), jitter = Math.floor(Math.random() * (JITTER_MS + 1));
    return new Promise(function (resolve) {
      (function check() { var wait = P.at + GAP_MS + jitter - Date.now(); if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000)); })();
    });
  }
  async function capsWait() {
    for (;;) {
      var now = Date.now();
      S.sent = S.sent.filter(function (t) { return t > now - 600000; });
      var minute = S.sent.filter(function (t) { return t > now - 60000; }).length;
      if (minute < MIN_CAP && S.sent.length < TEN_CAP) return;
      setFoot('Pausing a moment (request limit)...', 'warn');
      await delay(FAST ? 50 : 1000);
      if (!S.running) return;
    }
  }
  // The game connected and the base open; false when the run was stopped meanwhile.
  async function waitReady() {
    while (S.running && !(G.ready() && G.inBase())) {
      if (G.ready() && !G.inBase()) { setFoot('Going back to your base...', 'warn'); if (!(await G.goHome())) { stop('your base did not open'); return false; } continue; }
      setFoot('Game disconnected. Waiting...', 'warn');
      await delay(WAIT_MS);
    }
    return S.running;
  }

  // ---------------------------------------------------------------- the run
  function nameOf(snap, a) {
    var id = a.id != null ? a.id : null;
    if (id == null && a.uuid) snap.placed.forEach(function (p) { if (p.uuid === a.uuid) id = p.id; });
    if (id == null && a.group != null && snap.levels[a.group]) id = Number(snap.levels[a.group][Object.keys(snap.levels[a.group])[0]]);
    return id != null && snap.rows[id] ? snap.rows[id].name : '';
  }
  async function run() {
    S.running = true; S.stopped = false; S.done = 0; S.by = {};
    window.__DPO.running = true;
    showRun();
    for (var i = 0; i < C.phaseOrder.length; i++) {
      var phase = C.phaseOrder[i];
      if (!(await waitReady())) return;
      var snap;
      try { snap = G.read(); } catch (e) { stop('could not read your base (' + (e && e.message ? e.message : e) + ')'); return; }
      var list = C.plan(snap, S.settings).phases[phase];
      for (var j = 0; j < list.length; j++) {
        var a = list[j];
        if (S.done >= RUN_CAP) { stop('reached the run limit (' + RUN_CAP + ' changes). Run it again.'); return; }
        await pace();
        await capsWait();
        if (!S.running || !(await waitReady())) return;
        var nm = nameOf(snap, a);
        setFoot(PHASE[phase] + (nm ? ': ' + nm : '') + ' (' + (j + 1) + '/' + list.length + ')', 'ok');
        S.sent.push(Date.now());
        var r = await G.exec(a, { settleMs: SETTLE_MS, timeoutMs: TIMEOUT_MS });
        if (!S.running) return;
        if (!r.ok) { stop(r.why === 'stale' ? 'The base changed. Run again.' : r.why); return; }
        S.done++; S.by[phase] = (S.by[phase] || 0) + 1;
        paint();
      }
    }
    finish();
  }
  function doneText() {
    var parts = [];
    C.phaseOrder.forEach(function (p) { if (S.by[p]) parts.push(PHASE[p] + ' ' + S.by[p]); });
    return S.done + (S.done === 1 ? ' change' : ' changes') + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '.';
  }
  function reportUsage() {
    if (!S.done || !S.siteKey) return;
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: gameName(), tool: 'decor-optimizer', version: VERSION, count: S.done, day: new Date().toISOString().slice(0, 10) }) }).catch(function () {});
    } catch (e) {}
  }
  function finish() {
    S.running = false; window.__DPO.running = false;
    reportUsage();
    showMessage('Done. ' + doneText(), true, 'ok');
  }
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; S.running = false; window.__DPO.running = false;
    reportUsage();
    if (reason === 'stopped by you') showMessage('Stopped. ' + doneText(), true, 'ok');
    else showMessage('Decor Optimizer stopped: ' + reason + ' ' + doneText(), true, 'bad');
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#dpo-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#dpo-root .dpo-card{width:min(300px,calc(100vw - 16px));box-sizing:border-box;background:#161b22;border:1px solid #3fb950;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#dpo-root .dpo-card.warn{border-color:#d29922}#dpo-root .dpo-card.bad{border-color:#f85149}#dpo-root .dpo-card.flash{transform:scale(1.03)}',
    '#dpo-root .dpo-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#dpo-root .dpo-title{flex:1;white-space:nowrap}',
    '#dpo-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#dpo-root button#dpo-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#dpo-root button#dpo-min:hover{color:#e6edf3;background:#1c2128}#dpo-root .min #dpo-min svg{transform:rotate(180deg)}',
    '#dpo-root .min .dpo-body{display:none}#dpo-root .min .dpo-head{margin:0}',
    '#dpo-root .dpo-units{display:flex;gap:6px;margin:2px 0 8px}',
    '#dpo-root .dpo-units button{flex:1;min-height:36px;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#8b949e}',
    '#dpo-root .dpo-units button[aria-pressed="true"]{border-color:#3fb950;color:#e6edf3;background:#1c2128}',
    '#dpo-root #dpo-preview{max-height:min(46vh,340px);overflow:auto;padding-right:2px}',
    '#dpo-root .dpo-h{color:#8b949e;font-size:12px;margin:8px 0 2px}#dpo-root .dpo-line{margin:1px 0}#dpo-root .dpo-gain{color:#3fb950;font-variant-numeric:tabular-nums}#dpo-root .dpo-loss{color:#f85149;font-variant-numeric:tabular-nums}',
    '#dpo-root .dpo-left{color:#8b949e;font-size:12px}',
    '#dpo-root .dpo-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}',
    '#dpo-root .dpo-msg{margin:4px 0 2px}#dpo-root .dpo-btns{display:flex;gap:6px;margin-top:8px}',
    '#dpo-root .dpo-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#dpo-root .dpo-btns button:hover{border-color:#79c0ff}',
    '#dpo-root .dpo-btns button#dpo-run{border-color:#3fb950}#dpo-root .dpo-btns button:disabled{opacity:.5;cursor:default}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('dpo-style');
    if (!st) { st = el('style'); st.id = 'dpo-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('dpo-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'dpo-root';
    card = el('div', 'dpo-card');
    var head = el('div', 'dpo-head');
    head.appendChild(el('span', 'dpo-title', 'Decor Optimizer'));
    var mb = el('button'); mb.id = 'dpo-min'; mb.type = 'button'; mb.setAttribute('aria-label', 'Fold Decor Optimizer');
    mb.addEventListener('click', function (e) { e.stopPropagation(); S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); paint(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    body = el('div', 'dpo-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'decor-optimizer', handle: '.dpo-head' });
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; card = null; body = null; }
  function paint() {
    if (!card) return;
    card.className = 'dpo-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (S.min ? ' min' : '');
    var f = document.getElementById('dpo-foot');
    if (f && f.textContent !== S.foot) f.textContent = S.foot;
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  function showMessage(text, withClose, tone) {
    ensureRoot(); body.textContent = ''; S.view = 'message'; S.tone = tone || 'ok';
    if (withClose) root.setAttribute('data-ops-stopped', '1'); else root.removeAttribute('data-ops-stopped');
    body.appendChild(el('div', 'dpo-msg', text));
    if (withClose) { var btns = el('div', 'dpo-btns'); btns.appendChild(button('dpo-close', 'Close', removeRoot)); body.appendChild(btns); }
    paint();
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; S.view = 'run';
    root.removeAttribute('data-ops-stopped');
    var foot = el('div', 'dpo-foot'); foot.id = 'dpo-foot'; body.appendChild(foot);
    var btns = el('div', 'dpo-btns'); btns.appendChild(button('dpo-stop', 'Stop', function () { stop('stopped by you'); })); body.appendChild(btns);
    setFoot('Starting...', 'ok');
  }
  // What the run will do, the stats it gains (the game's own counting before and after) and what stays in the bag.
  function previewLines(p) {
    var box = el('div'); box.id = 'dpo-preview';
    var c = p.summary.counts, any = false;
    function line(n, text) { if (!n) return; any = true; box.appendChild(el('div', 'dpo-line', text)); }
    box.appendChild(el('div', 'dpo-h', 'The plan'));
    line(c.collab, 'Collab box: ' + c.collab + ' in');
    line(c.toBag, 'To the bag: ' + c.toBag + ' that don\'t count');
    line(c.showcased, 'Base decor into the showcase: ' + c.showcased + ' (biggest first)');
    line(c.evicted, 'To make room: ' + c.evicted + ' moved to the bag (lower ranked)');
    line(c.merges, 'Level up spare copies: ' + c.merges + ' merges');
    line(c.upgrades, 'Advanced Upgrade: ' + c.upgrades + (c.upgrades === 1 ? ' step' : ' steps') +
      (c.opens ? ' (opens ' + c.opens + ': as the game warns, an opened decor\'s top copy can\'t be disassembled)' : ''));
    line(c.placed, 'Place: ' + c.placed + ' (the showcase first)');
    line(c.tidied, 'Sea decor moved south: ' + c.tidied);
    if (!any) box.appendChild(el('div', 'dpo-line', 'Your decor is already in order.'));
    if (p.summary.gains.length) {
      box.appendChild(el('div', 'dpo-h', 'Stats'));
      p.summary.gains.forEach(function (g) { var d = el('div', 'dpo-line'); d.appendChild(document.createTextNode(g.name + ' ')); d.appendChild(el('span', 'dpo-gain', g.text)); box.appendChild(d); });
    }
    if (p.summary.losses.length) {
      box.appendChild(el('div', 'dpo-h', 'Losses'));
      p.summary.losses.forEach(function (g) { var d = el('div', 'dpo-line'); d.appendChild(document.createTextNode(g.name + (g.gold ? ' (gold) ' : ' '))); d.appendChild(el('span', 'dpo-loss', g.text)); box.appendChild(d); });
    }
    var by = {};
    p.summary.left.forEach(function (l) { (by[l.why] = by[l.why] || []).push(l.name); });
    Object.keys(by).forEach(function (w) {
      var names = by[w], shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ' and ' + (names.length - 6) + ' more' : '');
      box.appendChild(el('div', 'dpo-left', 'Left in the bag (' + (WHY[w] || w) + '): ' + shown));
    });
    return { box: box, any: any };
  }
  function showPreview() {
    if (!S.siteKey) return;
    var p;
    try { p = C.plan(G.read(), S.settings); } catch (e) { showMessage('Could not read your base: ' + (e && e.message ? e.message : e), true, 'bad'); return; }
    ensureRoot(); body.textContent = ''; S.view = 'preview'; S.tone = 'ok';
    root.removeAttribute('data-ops-stopped');
    var units = el('div', 'dpo-units');
    UNITS.forEach(function (u) {
      var b = button('dpo-' + u[0], u[1], function () {
        S.settings[u[0]] = !S.settings[u[0]];
        lsSet(LS_UNITS + S.siteKey, JSON.stringify(S.settings));
        showPreview();
      });
      b.setAttribute('aria-pressed', String(S.settings[u[0]] !== false));
      b.title = (S.settings[u[0]] !== false ? 'Counting ' : 'Skipping ') + u[1] + ' decor';
      units.appendChild(b);
    });
    body.appendChild(units);
    var pv = previewLines(p);
    body.appendChild(pv.box);
    var btns = el('div', 'dpo-btns');
    var runB = button('dpo-run', 'Run', function () { run().catch(function (e) { stop('something went wrong: ' + (e && e.message ? e.message : e)); }); });
    runB.disabled = !pv.any;
    btns.appendChild(runB);
    btns.appendChild(button('dpo-close', 'Close', removeRoot));
    body.appendChild(btns);
    paint();
  }

  // ---------------------------------------------------------------- start
  window.__DPO = {
    running: false, version: VERSION,
    stop: function (reason) { if (S.running) stop(reason || 'stopped by you'); else removeRoot(); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { view: S.view, done: S.done, foot: S.foot, settings: S.settings, running: S.running }; }
  };
  S.min = lsGet(LS_MIN) === '1';
  ensureRoot();
  showMessage('Starting...');
  (async function start() {
    if (!G.ready()) { showMessage('Open the game and log in first, then try again.', true); return; }
    S.siteKey = await G.siteKey().catch(function () { return ''; });
    if (!S.siteKey) { showMessage('This browser cannot run Decor Optimizer.', true); return; }
    try { var saved = JSON.parse(lsGet(LS_UNITS + S.siteKey) || 'null'); if (saved && typeof saved === 'object') UNITS.forEach(function (u) { if (typeof saved[u[0]] === 'boolean') S.settings[u[0]] = saved[u[0]]; }); } catch (e) {}
    if (!G.inBase()) {
      showMessage('Going to your base...');
      if (!(await G.goHome())) { showMessage('Open your base first, then try again.', true); return; }
    }
    showPreview();
  })().catch(function (e) { showMessage('Something went wrong: ' + (e && e.message ? e.message : e), true, 'bad'); });
})();
