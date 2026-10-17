// ops-potato.js — Potato mode for the Ops Center (Tex, 2026-10-17): a switch in the menu, remembered on the device, for
// phones that run hot or lose the browser tab. While it's on: the game draws at most 29 frames a second (30 and 60 are
// tied to the screen's refresh rate in this engine, so a 120 Hz phone drew 120 with chat open), at 1x resolution, and
// not at all behind a full-screen window (chat, menus) on a phone held upright. It also saves the game's own
// low-quality setting (half-size artwork, lighter models), which the game reads when it starts, so that part needs a
// reload. It sends nothing to the server. Optional: the Ops Center works without it.
// window.OpsPotato in the browser, the rules as module.exports for node tests.
(function () {
  'use strict';
  var FPS = 29, TICK_MS = 200, WATCH_MS = 2000;
  var LS_ON = 'ops_potato_v1', LS_PREV = 'ops_potato_prev_v1', LOW_KEY = 'topwar_LOW_EFFECT_MODE';
  var WORLD_CAMS = ['Main Camera', '3DCamera'];               // the base/map and 3D cameras; the menus and chat have their own

  // ---------------------------------------------------------------- rules
  function cap(asked, on) { return on ? FPS : asked; }
  // A full-screen window (PopLayer's UIFrameScreen*) on a screen taller than it is wide: nothing of the base shows.
  function freeze(openNames, w, h) { return h > w && (openNames || []).some(function (n) { return /^UIFrameScreen/.test(String(n)); }); }
  function isLow(v) { try { return !!JSON.parse(v); } catch (e) { return false; } }
  // The game's low-quality setting: on saves "1" and remembers the player's own value (once); off restores it.
  // reload: the running game was started the other way.
  function lowPlan(o) {
    var store, prev;
    if (o.on) { prev = o.prev || { v: o.stored }; store = '1'; }
    else { prev = null; store = o.prev && o.stored === '1' ? o.prev.v : o.stored; }   // the player changed it meanwhile: keep their choice (review)
    return { store: store, prev: prev, reload: isLow(store) !== !!o.running };
  }
  var rules = { FPS: FPS, cap: cap, freeze: freeze, isLow: isLow, lowPlan: lowPlan };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }

  // ---------------------------------------------------------------- the game
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var mem = null;                                            // this page's switch, even if storage can't be written (review)
  function isOn() { return mem !== null ? mem : lsGet(LS_ON) === '1'; }
  // The live game in this tab: the one Unattended mode runs in its same-origin frame when that's up (the page's own game
  // is paused then and must stay paused: review), else the page's.
  function games() {
    try { var f = document.getElementById('mapc-frame'), w = f && f.contentWindow; if (w && w.cc && w.cc.game && w.__require) return [w]; } catch (e) {}
    return window.cc && window.cc.game ? [window] : [];
  }
  // The engine's setFrameRate restarts the main loop, which wakes a paused game: put the pause back (review).
  function rate(g, orig, n) { var paused = !!(g.isPaused && g.isPaused()); orig.call(g, n); if (paused && g.pause) g.pause(); }
  function running(W) { try { return !!W.__require('GlobalData').GLOBAL.LowQuality; } catch (e) { return false; } }
  function resize(W) { try { if (W.cc.view._resizeEvent) W.cc.view._resizeEvent(true); else W.cc.view.emit('canvas-resize'); } catch (e) {} }
  function tick(W, st) {
    try {
      var pop = W.cc.find('UICanvas/PopLayer'), names = [];
      if (pop && pop.children) pop.children.forEach(function (c) { if (c && c.active) names.push(c.name); });
      var size = W.cc.view.getFrameSize(), cams = (W.cc.Camera && W.cc.Camera.cameras) || [];
      if (st.on && freeze(names, size.width, size.height)) {
        cams.forEach(function (c) { if (c && c.enabled && c.node && WORLD_CAMS.indexOf(c.node.name) >= 0) { c.enabled = false; st.off.push(c); } });
      } else thaw(W, st);
    } catch (e) {}
  }
  // Only the cameras this switched off come back (the game may turn its own cameras off).
  function thaw(W, st) { st.off.forEach(function (c) { try { if (W.cc.isValid(c) && !c.enabled) c.enabled = true; } catch (e) {} }); st.off = []; }
  function apply(W) {
    var st = W.__opsPotato || (W.__opsPotato = { on: false, off: [] });
    if (st.on) return;
    st.on = true;
    var g = W.cc.game;
    if (!st.orig) {                                         // the game keeps asking for its own rate (60 for chat): hold the cap
      var orig = g.setFrameRate;                            // kept here, so the wrapper can never end up calling itself (review)
      st.orig = orig; st.wanted = g.getFrameRate();
      g.setFrameRate = function (n) { st.wanted = n; return orig.call(this, cap(n, st.on)); };
    }
    rate(g, st.orig, FPS);
    st.retina = W.cc.view.isRetinaEnabled();
    if (st.retina) { W.cc.view.enableRetina(false); resize(W); }
    st.timer = W.setInterval(function () { tick(W, st); }, TICK_MS);
    tick(W, st);
  }
  function undo(W) {
    var st = W.__opsPotato;
    if (!st || !st.on) return;
    st.on = false;
    W.clearInterval(st.timer);
    thaw(W, st);
    var g = W.cc.game;
    if (st.orig) { g.setFrameRate = st.orig; rate(g, st.orig, st.wanted || 30); st.orig = null; }
    if (st.retina) { W.cc.view.enableRetina(true); resize(W); }
  }
  // The game's own low-quality setting; true when a reload is needed to see the change.
  function setLow(on) {
    var prev = null;
    try { prev = JSON.parse(lsGet(LS_PREV)); } catch (e) {}
    var g = games()[0], plan = lowPlan({ on: on, stored: lsGet(LOW_KEY), prev: prev && typeof prev === 'object' ? prev : null, running: g ? running(g) : false });
    lsSet(LOW_KEY, plan.store);
    lsSet(LS_PREV, plan.prev ? JSON.stringify(plan.prev) : null);
    return plan.reload;
  }
  function needsReload() { var g = games()[0]; return isOn() && !!g && !running(g) && isLow(lsGet(LOW_KEY)); }
  // While on, a game that starts later (Unattended mode's frame, a reconnect reloading it) gets it too, once it's ready.
  var watch = null;
  function ensure() {
    games().forEach(function (W) {
      try { var st = W.__opsPotato; if ((!st || !st.on) && W.cc.game._prepared !== false) apply(W); } catch (e) {}
    });
  }
  function watchOn() { if (!watch) watch = setInterval(ensure, WATCH_MS); }
  function watchOff() { if (watch) { clearInterval(watch); watch = null; } }
  function set(on) {
    mem = !!on; lsSet(LS_ON, on ? '1' : '0');
    if (on) { ensure(); watchOn(); }
    else {
      watchOff();
      var ws = [window];
      try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.cc) ws.push(f.contentWindow); } catch (e) {}
      ws.forEach(function (W) { try { undo(W); } catch (e) {} });   // wherever it was applied
    }
    return setLow(on);
  }
  // At every Ops Center load: a remembered switch applies at once, and keeps applying to games that start later.
  function boot() { if (isOn()) { ensure(); watchOn(); } }

  // ---------------------------------------------------------------- the switch (the menu header, right of "Ops Center")
  // Tex 2026-10-17: in the header, so players see it without scrolling. The reload note goes at the top of the menu,
  // only when it's needed.
  var CSS = [
    '.ops-title .opsp-mini{display:inline-flex;align-items:center;gap:6px;margin-left:10px;vertical-align:middle}',
    '.opsp-mini-label{font-size:12px;font-weight:600;color:#8b949e}',
    '.opsp-mini button.opsp-switch{flex:none;position:relative;width:40px;height:24px;border-radius:12px;border:1px solid #30363d;background:#0d1117;cursor:pointer;padding:0}',
    '.opsp-mini button.opsp-switch::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#8b949e;transition:transform .2s}',
    '.opsp-mini button.opsp-switch[aria-checked="true"]{background:#238636;border-color:#2ea043}',
    '.opsp-mini button.opsp-switch[aria-checked="true"]::after{transform:translateX(16px);background:#e6edf3}',
    '.opsp-hint{margin:-4px 0 10px;color:#8b949e;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.opsp-note{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;border:1px solid #30363d;border-radius:8px;color:#d29922;font-size:12px}.opsp-note span{flex:1}',
    '.opsp-note button#opsp-reload{flex:none;min-height:36px;padding:0 12px;border:1px solid #30363d;border-radius:8px;background:#1c2128;color:#e6edf3;font:inherit;cursor:pointer}'
  ].join('\n');
  var HINT = 'Potato mode: cooler phone, fewer tab restarts. Lower frame rate and sharpness; the base pauses behind chat.';
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // head: the menu's header (the switch goes on the title line); body: the menu (the reload note goes at its top).
  function mount(head, body) {
    var st = document.getElementById('opsp-style');
    if (!st) { st = el('style'); st.id = 'opsp-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var title = head && head.querySelector('.ops-title');
    if (!title || !body) return;
    var mini = el('span', 'opsp-mini');
    mini.appendChild(el('span', 'opsp-mini-label', 'Potato'));
    var sw = el('button', 'opsp-switch'); sw.id = 'opsp-switch'; sw.type = 'button'; sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', HINT); sw.title = HINT;
    mini.appendChild(sw); title.appendChild(mini);
    var hint = el('div', 'opsp-hint', 'Potato mode: cooler phone, fewer tab restarts.');   // what "Potato" means, one line (Tex)
    body.insertBefore(hint, body.firstChild);
    var note = null;
    function paint(reload) {
      sw.setAttribute('aria-checked', String(isOn()));
      if (note) { note.remove(); note = null; }
      if (!reload) return;
      note = el('div', 'opsp-note');
      note.appendChild(el('span', null, 'Reload the game to finish (Potato mode changes the artwork quality when the game starts).'));
      if (!document.getElementById('mapc-frame')) {         // Unattended mode's frame: it takes effect at that game's next load
        var b = el('button', null, 'Reload now'); b.id = 'opsp-reload'; b.type = 'button';
        b.addEventListener('click', function () { try { location.reload(); } catch (e) {} });
        note.appendChild(b);
      }
      body.insertBefore(note, hint.nextSibling);           // under the hint
    }
    sw.addEventListener('click', function (e) { e.stopPropagation(); paint(set(!isOn())); });
    paint(needsReload());
  }

  window.OpsPotato = { FPS: FPS, isOn: isOn, set: set, boot: boot, mount: mount, rules: rules };
})();
