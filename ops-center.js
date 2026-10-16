// ops-center.js — Ops Center: one in-game launcher for the 2864tw.com tools.
// Reads the tool list (ops-tools.json), checks S2864 membership from the in-game UID
// (hashed on the device, never sent), shows the menu, launches a tool's scripts and
// returns to the menu once the tool's own screen closes. Uses OpsKit + OpsCore.
(function () {
  'use strict';
  if (window.OpsCenter && window.OpsCenter.toggle) { window.OpsCenter.toggle(); return; }

  var BASE = window.__OPS_BASE || 'https://2864tw.com/';
  var WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
  var LS = { recent: 'ops_recent_v1', seen: 'ops_seen_v1', unlock: 'ops_unlock_v1', member: 'ops_member_v1', reg: 'ops_reg_v1' };
  var HOME_SERVER = 2864;
  var MEMBER_TTL = 7 * 24 * 3600 * 1000;
  var S = {
    list: null, listErr: false, member: null, memberErr: 'wait', siteKey: null, unlocked: false, recent: [], seen: {},
    view: null, toolId: null, query: '', root: null, modal: null, sub: null, grid: null, tiles: {},
    timer: null, waitTimer: null, tracker: null, tool: null, observer: null, tick: null, fab: null, fabHidden: false, keyHandler: null,
    tuck: null, tuckOpen: false, offKey: '',        // the folded "Not running now" row
    reg: {}, regAsked: null,                         // registries the worker says this player is in ({mapcollector: true}); who was asked
    visitor: null, visitorLogged: null, rolling: false  // a player turned away: {sk, server, away}; logged this launch; Rickroll loading
  };

  // ---------------------------------------------------------------- small helpers
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.setAttribute('data-ops', '1');
      s.onload = function () { s.remove(); resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('load failed: ' + src)); };
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
    try {
      // the same rule as TroopGame.isReady: buildings loaded and every unit on the map placed
      var n = window.cc && cc.find('Canvas/HomeMap'), h = n && n.getComponent('HomeMap'), u = UD();
      out.base = !!(h && h.armyInited && h._BuildingComplete && (h._ArmyComplete ||
        ((u && u.Armys) || []).every(function (a) { return String(a.warehouseId) !== '0' || !!(h.ArmyItems || {})[a._id]; })));
    } catch (e) {}
    try { var p = window.cc && cc.find('UICanvas/PopLayer/prefabWorlddefenderMonsterFortress'); out.defender = !!(p && p.activeInHierarchy); } catch (e) {}
    out.r4 = !!(S.member && S.member.rank >= 4);
    out.events = events();
    return out;
  }
  // The game's activities, to tell whether a tool's event is running. null when they can't be read: then every tool
  // counts as running (a broken read never hides a tool).
  function events() {
    try {
      var m = req('ActivityController'), A = m && (m.ActivityController || m.default || m), I = A && (A.Instance || A.instance);
      if (!I || !Array.isArray(I._activityList)) return null;
      var acts = I._activityList.slice();
      if (I._activityMap && typeof I._activityMap === 'object') Object.keys(I._activityMap).forEach(function (k) { acts.push(I._activityMap[k]); });
      var d = req('DataCenter'), now = Number(d && d.DATA && d.DATA.ServerTime);
      return { acts: acts, now: now > 0 ? now : Math.floor(Date.now() / 1000) };
    } catch (e) { return null; }
  }
  // A tool goes under "Not running now" while its event is off, or always when the list says tucked (whatever the read).
  function eventOff(t, ev) { return !!t.tucked || !!(ev && t.event && t.event.length && !C().eventLive(t.event, ev.acts, ev.now)); }

  // ---------------------------------------------------------------- data
  function loadList() {
    return fetch(BASE + 'ops-tools.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (raw) {
        S.list = C().validateTools(raw); S.listErr = false;
        S.seen = C().initSeen(S.seen, S.list.tools); lsSet(LS.seen, S.seen);
      }, function () { S.listErr = true; });
  }
  // Home server from the game (OriginServerId stays the home server during cross-server events); 0 when unknown.
  // Membership (Tex 2026-10-16): home server 2864 = member, on the roster or not (the roster adds name and rank);
  // another server = turned away; unknown = the roster decides.
  function homeServer() { try { var u = UD(); return Number(u && (u.OriginServerId || u.ServerId)) || 0; } catch (e) { return 0; } }
  function checkMember() {
    var id = uid();
    if (!id) { S.member = null; S.memberErr = 'wait'; S.siteKey = null; return Promise.resolve(); }
    var home = homeServer();
    if (home && home !== HOME_SERVER) {                 // not on 2864, roster or not
      S.member = null; S.memberErr = 'not'; S.siteKey = null;
      return sha256Hex(id).then(function (h) { S.visitor = { sk: h.slice(0, 16), server: home, away: true }; }, function () {});
    }
    return sha256Hex(id).then(function (h) {
      var sk = h.slice(0, 16), cached = lsGet(LS.member, null);
      S.siteKey = sk;                                   // owner-only tiles are matched on this
      var fresh = cached && cached.sk === sk && Date.now() - cached.at < MEMBER_TTL && cached.row;
      var load = fetch(BASE + 'player-data.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (rows) {
          if (!Array.isArray(rows)) throw new Error('member list is not a list');
          var row = rows.filter(function (p) { return p && p.siteKey === sk; })[0];
          if (!row) return null;
          var m = { name: String(row.name || ''), rank: Number(row.rank) || 0 };
          lsSet(LS.member, { sk: sk, at: Date.now(), row: m });
          return m;
        });
      if (fresh) {
        // answer at once from the cache, then refresh name and rank in the background
        S.member = cached.row; S.memberErr = null;
        load.then(function (m) { if (m) S.member = m; }, function () {});
        return;
      }
      return load.then(function (m) {
        if (m) { S.member = m; S.memberErr = null; return; }
        if (home === HOME_SERVER) { S.member = gameMember(); S.memberErr = null; return; }   // on 2864: the server decides (Tex 2026-10-16)
        S.member = null; S.memberErr = 'not'; S.visitor = { sk: sk, server: home, away: false };
      }, function (e) {
        if (home === HOME_SERVER) { S.member = gameMember(); S.memberErr = null; return; }   // a roster we can't read never turns a 2864 player away
        throw e;
      });
    }).catch(function () { S.member = null; S.memberErr = 'net'; });
  }
  // A 2864 player who isn't on the roster: name and alliance rank from the game (the roster's rank wins for those on it).
  function gameMember() {
    var r = 0;
    try { r = Number(UD().Alliance.Rank) || 0; } catch (e) {}
    return { name: playerName(), rank: r };
  }
  // Tool usage (Tex, 2026-10-08): who opened which tool, for the Map Collector dashboard's Tool usage panel (Tex only). siteKey and in-game name only,
  // never the UID; plain text, so no preflight; fire and forget, so a failed report never touches the tool.
  function reportUse(t) {
    if (!S.siteKey) return;
    var name = String(playerName() || (S.member && S.member.name) || '').slice(0, 40);
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: t.id, version: String(t.version), open: true }) }).catch(function () {});
    } catch (e) {}
  }
  // Tools limited to a registry (Tex 2026-10-14: Map Collector) show only when the worker says this player is in it.
  // The worker is asked once per launch, with the siteKey only (never the UID). A yes is remembered on this device for
  // that siteKey for a week, so the tile shows at once next time; a no forgets it; no answer leaves only a remembered yes.
  function registries() {
    var names = {};
    (S.list ? S.list.tools : []).forEach(function (t) { if (t.registered) names[t.registered] = true; });
    return Object.keys(names);
  }
  function savedReg(sk) {
    var v = lsGet(LS.reg, null);
    return v && v.sk === sk && Date.now() - v.at < MEMBER_TTL && v.yes && typeof v.yes === 'object' ? v.yes : {};
  }
  function regFromStore() {
    var yes = savedReg(S.siteKey);
    S.reg = {};
    registries().forEach(function (n) { if (yes[n] === true) S.reg[n] = true; });
  }
  function askRegistered() {
    var sk = S.siteKey, names = registries();
    if (!sk || !S.member || !names.length || S.regAsked === sk) return;
    S.regAsked = sk;
    names.forEach(function (n) {
      fetch(WORKER + '/' + n + '/visible', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', body: JSON.stringify({ siteKey: sk }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || j.ok !== true || typeof j.show !== 'boolean' || S.siteKey !== sk) return;
          var yes = savedReg(sk);
          if (j.show) yes[n] = true; else delete yes[n];
          lsSet(LS.reg, { sk: sk, at: Date.now(), yes: yes });
          var was = S.reg[n] === true;
          if (j.show) S.reg[n] = true; else delete S.reg[n];
          if (was !== j.show && S.view === 'menu' && S.grid) renderGrid();
        }, function () {});
    });
  }
  // Players the Ops Center turns away (Tex 2026-10-15) are logged once per launch with their in-game name and home server:
  // tool 'outsider' from another server, 'not-on-roster' on 2864. siteKey from the UID as for members, never the UID.
  function reportVisitor() {
    var v = S.visitor;
    if (!v || S.visitorLogged === v.sk) return;
    S.visitorLogged = v.sk;
    var body = { siteKey: v.sk, name: String(playerName() || 'Unknown').slice(0, 40), tool: v.away ? 'outsider' : 'not-on-roster', version: '1', open: true };
    if (v.server >= 1 && v.server <= 99999 && v.server % 1 === 0) body.server = v.server;
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true, body: JSON.stringify(body) }).catch(function () {});
    } catch (e) {}
  }
  // ...and those from another server get Rickroll, loaded the way Jam loads it, while the restricted message stays up.
  // Nothing new loads while it plays; a failed load says nothing.
  function rollVisitor() {
    var t = S.visitor && S.visitor.away ? alongsideTool() : null;
    if (!t || S.rolling || alongsideOn(t)) return;
    S.rolling = true;
    function done() { S.rolling = false; }
    loadToolScripts(t).then(done, done);
  }
  function toolById(id) { return S.list ? S.list.tools.filter(function (t) { return t.id === id; })[0] : null; }
  function statusOf(tool, ck) { var g = groupSession(); return C().tileStatus(tool, { member: !!S.member, unlocked: S.unlocked, checks: ck, eventOff: eventOff(tool, ck.events), alongsideOn: !!tool.alongside && alongsideOn(tool), group: g, groupOn: g && groupOn(tool), stopped: g && groupStopped(tool) }); }

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
    S.tuckOpen = false;
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
  // Tex, 2026-10-08: the Ops Center is for Server 2864 only; everyone else gets this and the ways to transfer in.
  function restrictedNote(b) {
    var n = K().note(b, 'Due to an influx of demand, this tool has been restricted to fellow server members of the developer (Server 2864). You can apply to transfer at ');
    function link(text, href) {
      var a = document.createElement('a'); a.textContent = text; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.color = '#79c0ff'; return a;
    }
    n.appendChild(link('discord.gg/go-2864', 'https://discord.gg/go-2864'));
    n.appendChild(document.createTextNode(' or at '));
    n.appendChild(link('2864tw.com/transfer', 'https://2864tw.com/transfer.html'));
    n.appendChild(document.createTextNode('.'));
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
    if (S.memberErr === 'not') { restrictedNote(b); rollVisitor(); return; }
    if (S.memberErr === 'wait') { K().note(b, 'Waiting for the game to finish loading...'); waitForGame(); return; }
    var search = K().input({ placeholder: 'Search tools', label: 'Search tools' });
    search.value = S.query;
    search.addEventListener('input', function () { S.query = search.value; renderGrid(); });
    b.appendChild(search);
    S.grid = K().el('div', 'ops-grid'); b.appendChild(S.grid);
    renderGrid();
    S.timer = setInterval(updateTiles, 1000);
  }
  function addTile(grid) {
    return function (t) {
      var tl = K().tile({ icon: t.icon, title: t.title, onClick: function () { if (groupSession() && groupOn(t)) { closeCard(); return; } openTool(t.id); } });   // a running group tool: its card is up
      S.tiles[t.id] = tl; grid.appendChild(tl.btn);
    };
  }
  function chevron() {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ops-chev');
    p.setAttribute('d', 'M6 9l6 6 6-6'); svg.appendChild(p); return svg;
  }
  function menuTools() { return C().orderTools(C().filterTools(C().visibleTools(S.list.tools, S.siteKey, S.reg), S.query), S.recent); }
  function offIds(tools, ev) { return tools.filter(function (t) { return eventOff(t, ev); }).map(function (t) { return t.id; }).join(','); }
  // Tools whose event isn't running sit in a folded "Not running now" row under the grid (Tex: tucked, not hidden).
  function renderGrid() {
    if (!S.grid) return;
    S.grid.textContent = ''; S.tiles = {};
    if (S.tuck && S.tuck.parentNode) S.tuck.parentNode.removeChild(S.tuck);
    S.tuck = null;
    var ev = events(), all = menuTools();
    var on = all.filter(function (t) { return !eventOff(t, ev); }), off = all.filter(function (t) { return eventOff(t, ev); });
    S.offKey = offIds(all, ev);
    if (!all.length) { S.grid.appendChild(K().el('div', 'ops-empty', 'No tools match "' + S.query.trim() + '".')); S.grid.style.display = 'block'; return; }
    S.grid.style.display = on.length ? '' : 'none';
    on.forEach(addTile(S.grid));
    if (off.length) {
      var open = !!S.query.trim() || !!S.tuckOpen;
      var wrap = K().el('div', 'ops-tuck-wrap'), row = K().el('button', 'ops-tuck');
      row.type = 'button'; row.setAttribute('aria-expanded', String(open));
      row.disabled = !!S.query.trim();                     // a search holds it open: no tap that does nothing
      row.appendChild(K().el('span', 'ops-tuck-label', 'Not running now (' + off.length + ')')); row.appendChild(chevron());
      row.addEventListener('click', function () { S.tuckOpen = !open; renderGrid(); });
      wrap.appendChild(row);
      if (open) { var g = K().el('div', 'ops-grid ops-tucked'); off.forEach(addTile(g)); wrap.appendChild(g); }
      S.grid.parentNode.insertBefore(wrap, S.grid.nextSibling);
      S.tuck = wrap;
    }
    updateTiles();
  }
  var PILL = { ready: ['Ready', 'ok'], notready: ['Not ready', 'warn'], locked: ['Locked', 'mute'], blocked: ['Members only', 'mute'], off: ['Not running', 'mute'], playing: ['Playing', 'info'], running: ['Running', 'info'], stopped: ['Stopped', 'warn'], wait: ['Wait', 'mute'] };
  function updateTiles() {
    if (S.view !== 'menu' || !S.list) return;
    var ck = checks();
    if (S.grid && offIds(menuTools(), ck.events) !== S.offKey) { renderGrid(); return; }   // an event started or ended: its tile moves
    Object.keys(S.tiles).forEach(function (id) {
      var t = toolById(id), tl = S.tiles[id], st = statusOf(t, ck), badge = C().badgeFor(t, S.seen);
      tl.pills.textContent = '';
      tl.pills.appendChild(K().pill(PILL[st.state][0], PILL[st.state][1]));
      if (badge) tl.pills.appendChild(K().pill(badge === 'new' ? 'New' : 'Updated', 'info'));
      tl.btn.classList.toggle('dim', st.state === 'locked' || st.state === 'blocked' || st.state === 'off' || st.state === 'wait');
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
    var evRow = null;                                    // a tool tied to an event says whether it's running
    if (t.event && t.event.length) {
      evRow = { dot: K().el('span', 'ops-dot'), txt: K().el('span') };
      var er = K().el('div', 'ops-check'); er.appendChild(evRow.dot); er.appendChild(evRow.txt); box.appendChild(er);
    }
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
        }, function () { err.textContent = 'Unlocking is not available right now.'; });
      });
      code.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock.click(); });
      box.appendChild(unlock);
    }
    var badge = C().badgeFor(t, S.seen);
    if (badge) b.appendChild(K().el('div', 'ops-meta', (badge === 'new' ? 'New' : 'Updated') + ' ' + t.version));
    var waitNote = K().el('div', 'ops-note'); b.appendChild(waitNote);   // tools that run together are open (Tex 2026-10-16)
    var go = K().button('Launch', 'primary', function () { launch(t); });
    b.appendChild(go);
    function paint() {
      var ck = checks(), st = statusOf(t, ck);
      rows.forEach(function (r) {
        var ok = ck[r.id] === true, auto = !ok && C().isAutoFor(t, r.id);   // e.g. Troop Optimizer goes to your base itself
        r.dot.className = 'ops-dot ' + (ok ? 'ok' : auto ? 'info' : 'warn'); r.dot.textContent = ok ? '✓' : auto ? '→' : '!';
        r.txt.textContent = auto ? C().AUTO_TEXT[r.id] : C().READY_TEXT[r.id][ok ? 0 : 1];
      });
      if (evRow) {
        var off = eventOff(t, ck.events);
        evRow.dot.className = 'ops-dot ' + (off ? 'warn' : 'ok'); evRow.dot.textContent = off ? '!' : '✓';
        evRow.txt.textContent = C().EVENT_TEXT[off ? 1 : 0];
      }
      var waiting = st.state === 'wait';
      waitNote.textContent = waiting ? 'Close the tools that are running first: ' + (runningGroup().map(function (x) { return x.title; }).join(', ') || S.tool.title) + '.' : '';
      waitNote.style.display = waiting ? '' : 'none';
      go.textContent = st.launch || (st.state === 'locked' || waiting ? 'Launch' : 'Members only');
      go.disabled = !st.launch;
    }
    paint();
    S.timer = setInterval(paint, 1000);
  }

  // ---------------------------------------------------------------- launch + tracker
  var nodeIds = typeof WeakMap === 'function' ? new WeakMap() : null, nextNode = 1;
  function trackerBusy() { return !!(S.tracker && C().trackerWatching(S.tracker, Date.now())); }
  function launch(t) {
    if (t.alongside) { launchAlongside(t); return; }
    if (groupSession()) { if (t.together) launchTogether(t); return; }   // a tool outside the group waits
    S.recent = C().pushRecent(S.recent, t.id); lsSet(LS.recent, S.recent);
    S.seen[t.id] = t.version; lsSet(LS.seen, S.seen);
    reportUse(t);
    closeCard();
    S.tool = t; S.fabHidden = false;
    S.tracker = C().trackerReduce(C().trackerInit(), { type: 'launch', at: Date.now() });
    showFab('Ops · starting ' + t.title);
    startObserver();
    var chain = Promise.resolve();
    t.scripts.forEach(function (f) { chain = chain.then(function () { var p = loadScript(BASE + f + '?v=' + encodeURIComponent(t.version)); return /^ops-(drag|jam|stack)\.js$/.test(f) ? p.catch(function () {}) : p; }); });   // the drag, Jam and stack helpers are optional
    chain.then(function () { dispatch({ type: 'loaded', at: Date.now() }); }, function () {
      dispatch({ type: 'loadError', at: Date.now() });
      if (S.tracker && S.tracker.phase !== 'idle') { ensureRoot(); K().bubble(S.root, 'Couldn\'t load ' + t.title + '. Check your connection.'); }   // the tools beside it go on
    });
  }
  function dispatch(ev) {
    if (!S.tracker) return;
    var prev = S.tracker.phase;
    S.tracker = C().trackerReduce(S.tracker, ev);
    var phase = S.tracker.phase;
    if (phase === 'running' && prev !== 'running') { closeCard(); showFab(fabText()); }
    if (phase === 'running' && S.fab && (ev.type === 'nodeAdded' || ev.type === 'nodeRemoved' || (ev.type === 'tick' && groupSession()))) {   // a group card can stop without leaving
      var ft = fabText(); if (ft !== S.fabText) { S.fabText = ft; S.fab.setText(ft); }
    }
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
    return { ops: isOurs(n), matchesOverlay: m, alongside: isAlongsideNode(n), position: cs ? cs.position : '', zIndex: cs ? parseInt(cs.zIndex, 10) || 0 : 0 };
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
    if (groupSession()) {
      var on = runningGroup().map(function (x) { return x.title; });
      if (!on.length && stoppedGroup().length) return stoppedGroup().map(function (x) { return x.title; }).join(', ') + ' stopped. Close its card to come back here.';
      return (on.length ? on.join(', ') : t) + (on.length > 1 ? ' are' : ' is') + ' running.';
    }
    return S.tracker && S.tracker.phase === 'running' ? t + ' is open. Close it from its own screen to come back here.' : 'Starting ' + t + '...';
  }
  function showFab(text) {
    if (S.fabHidden) return;                            // the player hid it: stays hidden until the tool closes
    ensureRoot();
    if (S.fab) { S.fab.setText(text); S.fabText = text; return; }
    S.fab = K().fab(S.root, text, showNote); S.fabText = text;
  }
  // the note above the pill, with a way to hide the pill in case it covers one of the tool's own buttons
  function showNote() {
    ensureRoot();
    var al = alongsideTool(), extra = null;            // the song can start alongside whatever is open (Tex 2026-10-14)
    // the button is Jam Mode, as on the tool cards (Tex): Rickroll is what it plays
    if (al) extra = alongsideOn(al) ? { text: 'Jam Mode is on', disabled: true } : { text: 'Jam Mode \u266a', onClick: function () { launchAlongside(al); } };
    if (groupSession()) extra = { text: 'Open menu', onClick: function () { openMenu(); } };   // tools that run together: the menu starts the others (and Rickroll)
    if (S.fab) K().bubble(S.root, runningNote(), 6000, 'Hide this button', function () { S.fabHidden = true; hideFab(); }, extra);
    else K().bubble(S.root, runningNote(), undefined, null, null, extra);
  }
  // Tools that run together (Tex 2026-10-16): while one is open, the menu opens, the others start beside it, and
  // every other tool waits.
  function groupSession() { return !!(S.tool && S.tool.together && S.tracker && S.tracker.phase !== 'idle'); }
  function groupOn(t) { try { return !!(t && t.together && t.overlay && document.querySelector(t.overlay)); } catch (e) { return false; } }
  // A group tool that stopped keeps its card up with the reason (and Close) until the player closes it: the card says so.
  function groupStopped(t) { try { var e = t && t.together && t.overlay && document.querySelector(t.overlay); return !!(e && e.hasAttribute('data-ops-stopped')); } catch (x) { return false; } }
  function runningGroup() { return S.list ? S.list.tools.filter(function (t) { return groupOn(t) && !groupStopped(t); }) : []; }
  function stoppedGroup() { return S.list ? S.list.tools.filter(function (t) { return groupOn(t) && groupStopped(t); }) : []; }
  function fabText() {
    var on = groupSession() ? runningGroup() : [], off = groupSession() && !on.length ? stoppedGroup() : [];
    if (on.length > 1) return 'Ops · ' + on.length + ' tools running';
    if (off.length) return 'Ops · ' + (off.length > 1 ? off.length + ' tools' : off[0].title) + ' stopped';
    return 'Ops · ' + (on.length ? on[0].title : S.tool.title) + ' running';
  }
  function launchTogether(t) {
    S.recent = C().pushRecent(S.recent, t.id); lsSet(LS.recent, S.recent);
    S.seen[t.id] = t.version; lsSet(LS.seen, S.seen);
    reportUse(t);
    closeCard();
    dispatch({ type: 'join', at: Date.now() });         // the session can't end while it loads (review minor)
    loadToolScripts(t).then(function () { dispatch({ type: 'joined', at: Date.now() }); }, function () {
      dispatch({ type: 'joined', at: Date.now() });
      ensureRoot(); K().bubble(S.root, 'Couldn\'t load ' + t.title + '. Check your connection.');
    });
  }
  // Tools that run alongside the others (Rickroll, Tex 2026-10-14): never the running tool, never holding the menu.
  function alongsideTool() {
    if (!S.list) return null;
    return C().visibleTools(S.list.tools, S.siteKey, S.reg).filter(function (t) { return t.alongside && (t.gate !== 'code' || S.unlocked); })[0] || null;
  }
  function alongsideOn(t) { try { return !!(t && t.overlay && document.querySelector(t.overlay)); } catch (e) { return false; } }
  function isAlongsideNode(n) {
    return !!S.list && S.list.tools.some(function (t) { try { return t.alongside && t.overlay && n.matches && n.matches(t.overlay); } catch (e) { return false; } });
  }
  function launchAlongside(t) {
    var fresh = !alongsideOn(t);                        // already on: the script only brings its card forward, not a new start
    S.recent = C().pushRecent(S.recent, t.id); lsSet(LS.recent, S.recent);
    S.seen[t.id] = t.version; lsSet(LS.seen, S.seen);
    if (fresh) reportUse(t);
    if (S.view) { closeCard(); if (!trackerBusy()) { stopObserver(); hideFab(); removeRoot(); } }
    loadToolScripts(t).catch(function () { ensureRoot(); K().bubble(S.root, 'Couldn\'t load ' + t.title + '. Check your connection.'); });
  }
  function loadToolScripts(t) {
    var chain = Promise.resolve();
    t.scripts.forEach(function (f) { chain = chain.then(function () { var p = loadScript(BASE + f + '?v=' + encodeURIComponent(t.version)); return /^ops-(drag|jam|stack)\.js$/.test(f) ? p.catch(function () {}) : p; }); });   // the drag, Jam and stack helpers are optional
    return chain;
  }
  function hideFab() { if (S.fab) { S.fab.remove(); S.fab = null; } }

  // ---------------------------------------------------------------- start
  function waitForGame() {
    if (S.waitTimer) return;
    S.waitTimer = setTimeout(function () {
      S.waitTimer = null;
      checkMember().then(afterMember);
    }, 2000);
  }
  function refreshMember() {
    try { localStorage.removeItem(LS.member); } catch (e) {}
    S.memberErr = 'wait'; openMenu();
    checkMember().then(afterMember);
  }
  function start() {
    S.started = true;
    S.listErr = false; S.list = null;
    openMenu();
    loadList().then(checkMember).then(afterMember);
  }
  function afterMember() {
    regFromStore();
    if (S.view === 'menu') openMenu();
    askRegistered();
    if (S.memberErr === 'not') reportVisitor();
  }
  function toggle() {
    if (!S.started) return;                             // still loading: the first tap opens the menu
    if (S.tracker && S.tracker.phase !== 'idle') {
      if (groupSession()) { if (S.view) closeCard(); else openMenu(); return; }   // tools that run together: the menu
      showNote();
      return;
    }
    if (S.view) close(); else openMenu();
  }

  S.recent = lsGet(LS.recent, []); S.seen = lsGet(LS.seen, {}); S.unlocked = lsGet(LS.unlock, null) === '1';
  if (!Array.isArray(S.recent)) S.recent = [];
  if (!S.seen || typeof S.seen !== 'object' || Array.isArray(S.seen)) S.seen = {};
  window.OpsCenter = { toggle: toggle, close: close, version: '1', _state: S };
  var deps = [];
  if (!window.OpsKit) deps.push(loadScript(BASE + 'ops-kit.js?_=' + Date.now()));
  if (!window.OpsDrag) deps.push(loadScript(BASE + 'ops-drag.js?_=' + Date.now()).catch(function () {}));   // cards drag by the title (Tex); optional: never blocks the Ops Center
  if (!window.OpsCore) deps.push(loadScript(BASE + 'ops-core.js?_=' + Date.now()));
  Promise.all(deps).then(start, function () {
    window.OpsCenter = null;
    alert('Ops Center failed to load. Check your connection and try again.');
  });
})();
