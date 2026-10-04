// ops-center.js — Ops Center: one in-game launcher for the 2864tw.com tools.
// Reads the tool list (ops-tools.json), checks S2864 membership from the in-game UID
// (hashed on the device, never sent), shows the menu, launches a tool's scripts and
// returns to the menu once the tool's own screen closes. Uses OpsKit + OpsCore.
(function () {
  'use strict';
  if (window.OpsCenter && window.OpsCenter.toggle) { window.OpsCenter.toggle(); return; }

  var BASE = window.__OPS_BASE || 'https://2864tw.com/';
  var LS = { recent: 'ops_recent_v1', seen: 'ops_seen_v1', unlock: 'ops_unlock_v1', member: 'ops_member_v1' };
  var MEMBER_TTL = 7 * 24 * 3600 * 1000;
  var S = {
    list: null, listErr: false, member: null, memberErr: 'wait', unlocked: false, recent: [], seen: {},
    view: null, toolId: null, query: '', root: null, modal: null, sub: null, grid: null, tiles: {},
    timer: null, waitTimer: null, tracker: null, tool: null, observer: null, tick: null, fab: null, fabHidden: false, keyHandler: null
  };

  // ---------------------------------------------------------------- small helpers
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.setAttribute('data-ops', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function K() { return window.OpsKit; }
  function C() { return window.OpsCore; }

  // ---------------------------------------------------------------- game reads (all guarded)
  function req(name) { try { return window.__require ? window.__require(name) : null; } catch (e) { return null; } }
  function UD() { var d = req('DataCenter'); return d && d.DATA ? d.DATA.UserData : null; }
  function uid() { try { var u = UD(), id = u && (u.StrUid || u._uid); return id ? String(id) : ''; } catch (e) { return ''; } }
  function playerName() { try { var u = UD(); return (u && u.Name) || ''; } catch (e) { return ''; } }
  function checks() {
    var out = { game: false, base: false, defender: false, r4: false };
    try { out.game = !!playerName(); } catch (e) {}
    try { var n = window.cc && cc.find('Canvas/HomeMap'), h = n && n.getComponent('HomeMap'); out.base = !!(h && h.armyInited && h._BuildingComplete); } catch (e) {}
    try { var p = window.cc && cc.find('UICanvas/PopLayer/prefabWorlddefenderMonsterFortress'); out.defender = !!(p && p.activeInHierarchy); } catch (e) {}
    out.r4 = !!(S.member && S.member.rank >= 4);
    return out;
  }

  // ---------------------------------------------------------------- data
  function loadList() {
    return fetch(BASE + 'ops-tools.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (raw) {
        S.list = C().validateTools(raw); S.listErr = false;
        S.seen = C().initSeen(S.seen, S.list.tools); lsSet(LS.seen, S.seen);
      }, function () { S.listErr = true; });
  }
  function checkMember() {
    var id = uid();
    if (!id) { S.member = null; S.memberErr = 'wait'; return Promise.resolve(); }
    return sha256Hex(id).then(function (h) {
      var sk = h.slice(0, 16), cached = lsGet(LS.member, null);
      if (cached && cached.sk === sk && Date.now() - cached.at < MEMBER_TTL && cached.row) { S.member = cached.row; S.memberErr = null; return; }
      return fetch(BASE + 'player-data.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (rows) {
          var row = (Array.isArray(rows) ? rows : []).filter(function (p) { return p && p.siteKey === sk; })[0];
          if (!row) { S.member = null; S.memberErr = 'not'; return; }
          S.member = { name: String(row.name || ''), rank: Number(row.rank) || 0 }; S.memberErr = null;
          lsSet(LS.member, { sk: sk, at: Date.now(), row: S.member });
        });
    }).catch(function () { S.member = null; S.memberErr = 'net'; });
  }
  function toolById(id) { return S.list ? S.list.tools.filter(function (t) { return t.id === id; })[0] : null; }
  function statusOf(tool, ck) { return C().tileStatus(tool, { member: !!S.member, unlocked: S.unlocked, checks: ck }); }

  // ---------------------------------------------------------------- shell
  function ensureRoot() { if (!S.root || !S.root.isConnected) S.root = K().root(); return S.root; }
  function stopTimers() { if (S.timer) clearInterval(S.timer); S.timer = null; }
  function closeCard() {
    stopTimers();
    if (S.modal) { S.modal.remove(); S.modal = null; }
    if (S.keyHandler) { document.removeEventListener('keydown', S.keyHandler, true); S.keyHandler = null; }
    S.view = null;
  }
  function close() {
    closeCard();
    if (S.waitTimer) { clearTimeout(S.waitTimer); S.waitTimer = null; }
    if (S.tracker) S.tracker = C().trackerReduce(S.tracker, { type: 'abandon', at: Date.now() });   // no late screens after a close
    if (!trackerBusy()) { stopObserver(); hideFab(); removeRoot(); }
  }
  function removeRoot() { if (S.root) { S.root.remove(); S.root = null; } }
  function openCard(title, sub, onBack) {
    closeCard(); ensureRoot();
    S.modal = K().modal(S.root, close);
    var h = K().header(S.modal.card, { title: title, sub: sub, onClose: close, onBack: onBack });
    S.sub = h.sub;
    S.keyHandler = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', S.keyHandler, true);
    return K().body(S.modal.card);
  }
  function subText() {
    if (S.member) return (playerName() || S.member.name) + ' · S2864 ✓';
    if (S.memberErr === 'wait') return 'Waiting for the game...';
    if (S.memberErr === 'net' || S.memberErr === 'not') return '';
    return 'Checking...';
  }

  // ---------------------------------------------------------------- menu
  function openMenu() {
    var b = openCard('Ops Center', subText());
    S.view = 'menu'; S.toolId = null;
    if (S.listErr) { K().toast(b, 'Couldn\'t load the tool list. Check your connection.', 'Retry', function () { start(); }); return; }
    if (!S.list) { K().note(b, 'Loading tools...'); return; }
    if (S.memberErr === 'net') { K().toast(b, 'Couldn\'t check your membership right now.', 'Retry', function () { refreshMember(); }); return; }
    if (S.memberErr === 'not') { K().note(b, 'This is for Server 2864 members.'); return; }
    if (S.memberErr === 'wait') { K().note(b, 'Waiting for the game to finish loading...'); waitForGame(); return; }
    var search = K().input({ placeholder: 'Search tools', label: 'Search tools' });
    search.value = S.query;
    search.addEventListener('input', function () { S.query = search.value; renderGrid(); });
    b.appendChild(search);
    S.grid = K().el('div', 'ops-grid'); b.appendChild(S.grid);
    renderGrid();
    S.timer = setInterval(updateTiles, 1000);
  }
  function renderGrid() {
    if (!S.grid) return;
    S.grid.textContent = ''; S.tiles = {};
    var tools = C().orderTools(C().filterTools(S.list.tools, S.query), S.recent);
    if (!tools.length) { S.grid.appendChild(K().el('div', 'ops-empty', 'No tools match "' + S.query.trim() + '".')); S.grid.style.display = 'block'; return; }
    S.grid.style.display = '';
    tools.forEach(function (t) {
      var tl = K().tile({ icon: t.icon, title: t.title, onClick: function () { openTool(t.id); } });
      S.tiles[t.id] = tl; S.grid.appendChild(tl.btn);
    });
    updateTiles();
  }
  var PILL = { ready: ['Ready', 'ok'], notready: ['Not ready', 'warn'], locked: ['Locked', 'mute'], blocked: ['Members only', 'mute'] };
  function updateTiles() {
    if (S.view !== 'menu' || !S.list) return;
    var ck = checks();
    Object.keys(S.tiles).forEach(function (id) {
      var t = toolById(id), tl = S.tiles[id], st = statusOf(t, ck), badge = C().badgeFor(t, S.seen);
      tl.pills.textContent = '';
      tl.pills.appendChild(K().pill(PILL[st.state][0], PILL[st.state][1]));
      if (badge) tl.pills.appendChild(K().pill(badge === 'new' ? 'New' : 'Updated', 'info'));
      tl.btn.classList.toggle('dim', st.state === 'locked' || st.state === 'blocked');
      tl.btn.setAttribute('aria-label', t.title + ', ' + PILL[st.state][0] + (badge ? ', ' + (badge === 'new' ? 'New' : 'Updated') : ''));
    });
    if (S.sub) S.sub.textContent = subText();
  }

  // ---------------------------------------------------------------- tool page
  function openTool(id) {
    var t = toolById(id); if (!t) { openMenu(); return; }
    var b = openCard(t.title, '', function () { openMenu(); });
    S.view = 'tool'; S.toolId = id;
    b.appendChild(K().el('div', 'ops-desc', t.desc));
    var box = K().el('div', 'ops-box'); b.appendChild(box);
    box.appendChild(K().el('div', 'ops-label', 'Before you start'));
    var rows = t.ready.map(function (r) {
      var row = K().el('div', 'ops-check'), dot = K().el('span', 'ops-dot'), txt = K().el('span');
      row.appendChild(dot); row.appendChild(txt); box.appendChild(row);
      return { id: r, dot: dot, txt: txt };
    });
    if (t.gate === 'code' && !S.unlocked) {
      var lock = K().el('div', 'ops-check');
      lock.appendChild(K().el('span', 'ops-dot warn', '!')); lock.appendChild(K().el('span', '', 'This tool needs the unlock code'));
      box.appendChild(lock);
      var code = K().input({ type: 'password', placeholder: 'Enter code', label: 'Unlock code' }); box.appendChild(code);
      var err = K().el('div', 'ops-note err'); box.appendChild(err);
      var unlock = K().button('Unlock', null, function () {
        if (!S.list.codeSha256) { err.textContent = 'Unlocking is not available right now.'; return; }
        sha256Hex(code.value.trim()).then(function (h) {
          if (h === S.list.codeSha256) { S.unlocked = true; lsSet(LS.unlock, '1'); openTool(id); }
          else { err.textContent = 'That code is not right.'; code.value = ''; code.focus(); }
        });
      });
      code.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock.click(); });
      box.appendChild(unlock);
    }
    var badge = C().badgeFor(t, S.seen);
    if (badge) b.appendChild(K().el('div', 'ops-meta', (badge === 'new' ? 'New' : 'Updated') + ' ' + t.version));
    var go = K().button('Launch', 'primary', function () { launch(t); });
    b.appendChild(go);
    function paint() {
      var ck = checks(), st = statusOf(t, ck);
      rows.forEach(function (r) {
        var ok = ck[r.id] === true, auto = !ok && C().isAutoFor(t, r.id);   // e.g. Troop Optimizer goes to your base itself
        r.dot.className = 'ops-dot ' + (ok ? 'ok' : auto ? 'info' : 'warn'); r.dot.textContent = ok ? '✓' : auto ? '→' : '!';
        r.txt.textContent = auto ? C().AUTO_TEXT[r.id] : C().READY_TEXT[r.id][ok ? 0 : 1];
      });
      go.textContent = st.launch || (st.state === 'locked' ? 'Launch' : 'Members only');
      go.disabled = !st.launch;
    }
    paint();
    S.timer = setInterval(paint, 1000);
  }

  // ---------------------------------------------------------------- launch + tracker
  var nodeIds = typeof WeakMap === 'function' ? new WeakMap() : null, nextNode = 1;
  function trackerBusy() { return !!(S.tracker && C().trackerWatching(S.tracker, Date.now())); }
  function launch(t) {
    S.recent = C().pushRecent(S.recent, t.id); lsSet(LS.recent, S.recent);
    S.seen[t.id] = t.version; lsSet(LS.seen, S.seen);
    closeCard();
    S.tool = t; S.fabHidden = false;
    S.tracker = C().trackerReduce(C().trackerInit(), { type: 'launch', at: Date.now() });
    showFab('Ops · starting ' + t.title);
    startObserver();
    var chain = Promise.resolve();
    t.scripts.forEach(function (f) { chain = chain.then(function () { return loadScript(BASE + f + '?v=' + encodeURIComponent(t.version)); }); });
    chain.then(function () { dispatch({ type: 'loaded', at: Date.now() }); }, function () { dispatch({ type: 'loadError', at: Date.now() }); });
  }
  function dispatch(ev) {
    if (!S.tracker) return;
    var prev = S.tracker.phase;
    S.tracker = C().trackerReduce(S.tracker, ev);
    var phase = S.tracker.phase;
    if (phase === 'running' && prev !== 'running') { closeCard(); showFab('Ops · ' + S.tool.title + ' running'); }
    if (phase === 'idle' && prev !== 'idle') {
      hideFab(); S.fabHidden = false;
      var failed = S.tracker.error, t = S.tool;
      if (!S.list) return;
      openMenu();
      if (failed && S.modal) {
        var b = S.modal.card.querySelector('.ops-body');
        if (b) K().toast(b, 'Couldn\'t load ' + t.title + '. Check your connection.', 'Retry', function () { launch(t); });
      }
    }
    if (!C().trackerWatching(S.tracker, Date.now())) {
      stopObserver();
      if (!S.modal && !S.fab) removeRoot();             // nothing left on screen: leave nothing behind
    }
  }
  function isOurs(n) { return !!(n.getAttribute && n.getAttribute('data-ops')); }
  function nodeInfo(n) {
    var cs = null; try { cs = getComputedStyle(n); } catch (e) {}
    var m = false; try { m = !!(S.tool && S.tool.overlay && n.matches && n.matches(S.tool.overlay)); } catch (e) {}
    return { ops: isOurs(n), matchesOverlay: m, position: cs ? cs.position : '', zIndex: cs ? parseInt(cs.zIndex, 10) || 0 : 0 };
  }
  function idOf(n) {
    if (!nodeIds) return null;
    if (!nodeIds.has(n)) nodeIds.set(n, nextNode++);
    return nodeIds.get(n);
  }
  function consider(n) {
    if (!n.isConnected || isOurs(n)) return false;
    if (!C().isToolNode(nodeInfo(n))) return false;
    dispatch({ type: 'nodeAdded', id: idOf(n), at: Date.now() });
    K().raise(S.root);
    return true;
  }
  function startObserver() {
    stopObserver();
    S.observer = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1 || isOurs(n)) return;
          if (!consider(n)) {
            // some tools style their overlay a moment after adding it: look again shortly
            setTimeout(function () { if (S.observer && !(nodeIds && nodeIds.has(n))) consider(n); }, 300);
            setTimeout(function () { if (S.observer && !(nodeIds && nodeIds.has(n))) consider(n); }, 1500);
          }
        });
        Array.prototype.forEach.call(m.removedNodes, function (n) {
          if (n.nodeType === 1 && nodeIds && nodeIds.has(n)) dispatch({ type: 'nodeRemoved', id: nodeIds.get(n), at: Date.now() });
        });
      });
    });
    S.observer.observe(document.body, { childList: true });
    S.observer.observe(document.documentElement, { childList: true });
    S.tick = setInterval(function () { dispatch({ type: 'tick', at: Date.now() }); }, 250);
  }
  function stopObserver() {
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    if (S.tick) { clearInterval(S.tick); S.tick = null; }
  }
  function runningNote() {
    var t = S.tool ? S.tool.title : 'The tool';
    return S.tracker && S.tracker.phase === 'running' ? t + ' is open. Close it from its own screen to come back here.' : 'Starting ' + t + '...';
  }
  function showFab(text) {
    if (S.fabHidden) return;                            // the player hid it: stays hidden until the tool closes
    ensureRoot();
    if (S.fab) { S.fab.setText(text); return; }
    S.fab = K().fab(S.root, text, showNote);
  }
  // the note above the pill, with a way to hide the pill in case it covers one of the tool's own buttons
  function showNote() {
    ensureRoot();
    if (S.fab) K().bubble(S.root, runningNote(), 6000, 'Hide this button', function () { S.fabHidden = true; hideFab(); });
    else K().bubble(S.root, runningNote());
  }
  function hideFab() { if (S.fab) { S.fab.remove(); S.fab = null; } }

  // ---------------------------------------------------------------- start
  function waitForGame() {
    if (S.waitTimer) return;
    S.waitTimer = setTimeout(function () {
      S.waitTimer = null;
      checkMember().then(function () { if (S.view === 'menu') openMenu(); });
    }, 2000);
  }
  function refreshMember() {
    try { localStorage.removeItem(LS.member); } catch (e) {}
    S.memberErr = 'wait'; openMenu();
    checkMember().then(function () { if (S.view === 'menu') openMenu(); });
  }
  function start() {
    S.listErr = false; S.list = null;
    openMenu();
    loadList().then(checkMember).then(function () { if (S.view === 'menu') openMenu(); });
  }
  function toggle() {
    if (S.tracker && S.tracker.phase !== 'idle') {
      showNote();
      return;
    }
    if (S.view) close(); else openMenu();
  }

  S.recent = lsGet(LS.recent, []); S.seen = lsGet(LS.seen, {}); S.unlocked = lsGet(LS.unlock, null) === '1';
  window.OpsCenter = { toggle: toggle, close: close, version: '1', _state: S };
  var deps = [];
  if (!window.OpsKit) deps.push(loadScript(BASE + 'ops-kit.js?_=' + Date.now()));
  if (!window.OpsCore) deps.push(loadScript(BASE + 'ops-core.js?_=' + Date.now()));
  Promise.all(deps).then(start, function () {
    window.OpsCenter = null;
    alert('Ops Center failed to load. Check your connection and try again.');
  });
})();
