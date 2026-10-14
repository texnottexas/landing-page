// ops-drag.js — lets the player drag an Ops tool's card (or its folded bar) by its title row and keeps the spot per
// tool on this browser; a double-tap on the title puts it back (Tex, 2026-10-14). The card always stays on screen.
// window.OpsDrag in the browser; the pure parts (clampPos, readPos, isDoubleTap) as module.exports for node tests.
(function (root) {
  'use strict';
  var KEY = 'ops_pos_v1_', THRESHOLD = 6, MARGIN = 8, DOUBLE_MS = 350;

  // A card of size {w, h} inside a {vw, vh} viewport with a margin; one bigger than the screen keeps its top-left
  // corner (its title row) in view.
  function clampPos(p, size, view, margin) {
    var m = margin == null ? MARGIN : margin;
    var x = Math.min(Math.max(p.x, m), Math.max(m, view.vw - size.w - m));
    var y = Math.min(Math.max(p.y, m), Math.max(m, view.vh - size.h - m));
    return { x: Math.round(x), y: Math.round(y) };
  }
  function readPos(raw) {
    var o = null;
    try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    return o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number' && isFinite(o.x) && isFinite(o.y) ? { x: o.x, y: o.y } : null;
  }
  function isDoubleTap(prev, now) { return prev > 0 && now - prev <= DOUBLE_MS; }
  var pure = { clampPos: clampPos, readPos: readPos, isDoubleTap: isDoubleTap, KEY: KEY, THRESHOLD: THRESHOLD, MARGIN: MARGIN, DOUBLE_MS: DOUBLE_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
  if (root.OpsDrag && root.OpsDrag.attach) return;          // one copy per page

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var NOT_HANDLE = 'button, input, select, textarea, a, video, label', live = [];

  // el: the card to move (fixed, or absolute in a full-screen layer). o.key: the tool id. o.handle: a selector inside el
  // for the title row (none: the whole card). o.dragButtons: buttons a drag may start on (a folded pill that is a
  // button). o.active: while it returns false the card isn't movable and no saved spot is applied. o.css: the selector
  // for the title row's touch-action rule when el has no id.
  function attach(el, o) {
    if (!el) return null;
    if (el.__opsDrag) return el.__opsDrag;
    var key = KEY + o.key, orig = null, down = null, lastTap = 0, dragEnd = 0, ro = null;
    var active = function () { try { return !o.active || !!o.active(); } catch (e) { return false; } };
    var view = function () { return { vw: window.innerWidth, vh: window.innerHeight }; };
    function apply(p) {
      if (!orig) orig = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom, transform: el.style.transform };
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
    }
    function reclamp() {
      if (!el.isConnected) { detach(); return; }
      var p = readPos(lsGet(key));
      if (!p || !active()) return;
      var r = el.getBoundingClientRect();
      apply(clampPos(p, { w: r.width, h: r.height }, view()));
    }
    function reset() {
      lsSet(key, null);
      if (orig) { el.style.left = orig.left; el.style.top = orig.top; el.style.right = orig.right; el.style.bottom = orig.bottom; el.style.transform = orig.transform; orig = null; }
      if (o.onChange) o.onChange(false);
    }
    function inHandle(t) {
      if (!t || !t.closest || !el.contains(t)) return false;
      if (o.handle && !t.closest(o.handle)) return false;
      var b = t.closest(NOT_HANDLE);
      if (b && el.contains(b) && !(o.dragButtons && b.matches(o.dragButtons))) return false;
      return true;
    }
    function onDown(e) {
      if ((e.button != null && e.button > 0) || !active() || !inHandle(e.target)) return;
      var r = el.getBoundingClientRect();
      dragEnd = 0;                                            // a new press: any click after it is a real one
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: r.left, oy: r.top, moved: false };
    }
    function onMove(e) {
      if (!down || e.pointerId !== down.id) return;
      if (!el.isConnected) { detach(); return; }
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      down.moved = true;
      var r = el.getBoundingClientRect();
      apply(clampPos({ x: down.ox + dx, y: down.oy + dy }, { w: r.width, h: r.height }, view()));
      if (e.cancelable) e.preventDefault();
    }
    function onUp(e) {
      if (!down || e.pointerId !== down.id) return;
      var d = down; down = null;
      if (d.moved) {
        var r = el.getBoundingClientRect();
        lsSet(key, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
        dragEnd = Date.now();                                 // the click this release makes, if any, comes a moment later
        lastTap = 0;
        if (o.onChange) o.onChange(true);
        return;
      }
      if (e.type === 'pointercancel') return;
      var now = Date.now();
      if (isDoubleTap(lastTap, now)) { lastTap = 0; reset(); } else lastTap = now;
    }
    function onClick(e) { if (dragEnd && Date.now() - dragEnd < 400) { dragEnd = 0; e.stopPropagation(); e.preventDefault(); } }
    function onResize() { reclamp(); }
    function detach() {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp); window.removeEventListener('resize', onResize);
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      live = live.filter(function (x) { return x !== el; });
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    try { ro = new ResizeObserver(function () { reclamp(); }); ro.observe(el); } catch (e) {}
    live.forEach(function (x) { if (!x.isConnected && x.__opsDrag) x.__opsDrag.detach(); });
    live.push(el);
    var sel = o.css || (el.id ? '#' + el.id + (o.handle ? ' ' + o.handle : '') : '');
    if (sel && !document.querySelector('style[data-ops-drag="' + o.key + '"]')) {
      var st = document.createElement('style'); st.setAttribute('data-ops-drag', o.key);
      var still = 'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';   // no text selection or long-press loupe (Safari)
      st.textContent = sel + '{' + still + ';cursor:grab}' + (o.dragButtons ? (el.id ? '#' + el.id + ' ' : '') + o.dragButtons + '{' + still + '}' : '');
      document.head.appendChild(st);
    }
    var ctl = { placed: function () { return !!readPos(lsGet(key)); }, reset: reset, reclamp: reclamp, detach: detach };
    el.__opsDrag = ctl;
    reclamp();
    return ctl;
  }

  root.OpsDrag = {
    attach: attach, clampPos: clampPos, readPos: readPos,
    placed: function (k) { return !!readPos(lsGet(KEY + k)); },
    live: function () { return live.filter(function (x) { return x.isConnected; }).length; },
    attached: function () { return live.length; }            // cards still holding window listeners
  };
})(typeof window !== 'undefined' ? window : globalThis);
