// ops-stack.js — Ops tools that run together keep their cards apart (Tex 2026-10-16). A card the player hasn't
// dragged goes to the first free spot below or beside the group cards opened before it; with no room it folds to its
// bar at the right edge (a fold made for room isn't the player's choice). The first card keeps the tool's own spot.
// Optional: a tool without it places its card as before. window.OpsStack in the browser; spot() for node tests.
(function (root) {
  'use strict';
  var M = 8, TOP = 84, GAP = 8, BAR = { w: 150, h: 44 };
  function hit(a, b) { return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }
  function num(a, b) { return a - b; }
  function uniq(v, i, a) { return a.indexOf(v) === i; }
  // others: the cards opened before this one, and Map Collector's; me: {w, h}; view: {w, h}.
  // -> {left, top} for the card, or {fold: true, top} for its bar at the right edge.
  function spot(others, me, view) {
    function free(x, y, w, h) {
      var r = { left: x, top: y, right: x + w, bottom: y + h };
      return r.right <= view.w - M && r.bottom <= view.h - M && !others.some(function (o) { return hit(r, o); });
    }
    var xs = [M].concat(others.map(function (o) { return Math.round(o.right + GAP); })).filter(uniq).sort(num);
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i];
      var ys = [TOP].concat(others.filter(function (o) { return o.left < x + me.w && x < o.right; })
        .map(function (o) { return Math.round(o.bottom + GAP); })).filter(uniq).sort(num);
      for (var j = 0; j < ys.length; j++) if (free(x, ys[j], me.w, me.h)) return { left: x, top: ys[j] };
    }
    var bx = view.w - M - BAR.w;
    var bys = [TOP].concat(others.filter(function (o) { return o.right > bx; }).map(function (o) { return Math.round(o.bottom + GAP); })).filter(uniq).sort(num);
    for (var k = 0; k < bys.length; k++) if (free(bx, bys[k], BAR.w, BAR.h)) return { fold: true, top: bys[k] };
    return { fold: true, top: TOP };
  }

  var DEFAULT = { top: '', left: '', right: '', fold: false };
  // Shared by every copy of this file the tools load: who opened first, last full sizes, one repaint timer.
  var reg = root.__opsStack || (root.__opsStack = { order: [], size: {}, timer: null });
  function rectOf(el) {
    var c = el && el.isConnected ? (el.firstElementChild || el) : null;
    if (!c) return null;
    var r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }
  function tick() {
    reg.order = reg.order.filter(function (e) { return e.el.isConnected; });
    if (!reg.order.length) { clearInterval(reg.timer); reg.timer = null; return; }
    reg.order.forEach(function (e) { if (e.repaint) try { e.repaint(); } catch (x) {} });
  }
  // Where this card goes: {placed: true} when the player dragged it; else CSS values ('' = the tool's own spot).
  function layout(el, key, folded, repaint) {
    if (root.OpsDrag && root.OpsDrag.placed && root.OpsDrag.placed(key)) return { placed: true, top: '', left: '', right: '', fold: false };
    reg.order = reg.order.filter(function (e) { return e.el.isConnected; });
    var i = -1;
    reg.order.forEach(function (e, n) { if (e.key === key && e.el === el) i = n; });
    if (i < 0) {
      reg.order = reg.order.filter(function (e) { return e.key !== key; });
      reg.order.push({ key: key, el: el, repaint: repaint });
      i = reg.order.length - 1;
    }
    if (!reg.timer && root.setInterval) { reg.timer = root.setInterval(tick, 1000); root.addEventListener('resize', tick); }
    if (!folded) { var r = rectOf(el); if (r) reg.size[key] = { w: r.right - r.left, h: r.bottom - r.top }; }
    var others = reg.order.slice(0, i).map(function (e) { return rectOf(e.el); }).filter(Boolean);
    if (!others.length) return DEFAULT;                  // the first card keeps the tool's own spot
    var mc = rectOf(root.document && root.document.getElementById('mapc-root'));
    if (mc) others.push(mc);
    var s = spot(others, reg.size[key] || { w: 190, h: 200 }, { w: root.innerWidth, h: root.innerHeight });
    if (s.fold) return { top: s.top + 'px', left: 'auto', right: 'calc(8px + env(safe-area-inset-right))', fold: true };
    return { top: s.top + 'px', left: s.left + 'px', right: '', fold: false };
  }
  var api = { spot: spot, layout: layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpsStack = api;
})(typeof window !== 'undefined' ? window : this);
