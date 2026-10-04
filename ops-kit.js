// ops-kit.js — the shared look for 2864tw.com in-game tools (window.OpsKit).
// Plain DOM, text via textContent only, every node tagged data-ops so a launcher can
// tell its own elements from a tool's. Classes are prefixed ops- to avoid clashes.
(function () {
  'use strict';
  if (window.OpsKit) return;

  var T = {
    bg: '#0d1117', surface: '#161b22', card: '#1c2128', border: '#30363d', text: '#e6edf3', soft: '#c9d1d9',
    muted: '#8b949e', accent: '#79c0ff', green: '#3fb950', amber: '#d29922', blue: '#388bfd', red: '#f85149',
    primary: '#238636', primaryBorder: '#2ea043', z: 2147483647
  };
  var FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  var CSS = [
    '.ops-root{position:fixed;inset:0;z-index:' + T.z + ';pointer-events:none;font-family:' + FONT + ';color:' + T.text + ';line-height:1.35;-webkit-text-size-adjust:100%;text-align:left}',
    '.ops-root *{box-sizing:border-box}',
    '.ops-dim{position:absolute;inset:0;background:rgba(1,4,9,.55);pointer-events:auto}',
    '.ops-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,calc(100vw - 20px));max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.55);pointer-events:auto;overflow:hidden}',
    '@media (min-width:600px){.ops-card{width:min(680px,calc(100vw - 40px))}}',
    '.ops-head{display:flex;align-items:center;gap:6px;padding:10px 8px 6px 14px}',
    '.ops-titles{flex:1;min-width:0}',
    '.ops-title{font-size:17px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ops-sub{font-size:12px;color:' + T.muted + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ops-icon-btn{min-width:44px;min-height:44px;background:none;border:0;color:' + T.muted + ';font:inherit;font-size:22px;line-height:1;cursor:pointer;border-radius:10px;padding:0}',
    '.ops-icon-btn:hover{color:' + T.text + ';background:' + T.card + '}',
    '.ops-body{padding:4px 14px 14px;overflow:auto;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}',
    '.ops-input{width:100%;background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:10px;color:' + T.text + ';font:inherit;font-size:16px;padding:10px 12px;min-height:44px;outline:none}',
    '.ops-input:focus{border-color:' + T.accent + '}',
    '.ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (min-width:600px){.ops-grid{grid-template-columns:repeat(4,1fr)}}',
    '.ops-tile{display:flex;flex-direction:column;gap:8px;align-items:flex-start;text-align:left;background:' + T.card + ';border:1px solid ' + T.border + ';border-radius:12px;padding:12px;min-height:112px;color:' + T.text + ';font:inherit;cursor:pointer;transition:border-color .15s,transform .15s}',
    '.ops-tile:hover{border-color:' + T.muted + '}',
    '.ops-tile:active{transform:scale(.98)}',
    '.ops-tile.dim{opacity:.72}',
    '.ops-tname{font-size:14px;font-weight:600;line-height:1.25}',
    '.ops-ico{width:34px;height:34px;border-radius:9px;background:' + T.bg + ';border:1px solid ' + T.border + ';display:flex;align-items:center;justify-content:center;flex:0 0 34px}',
    '.ops-ico svg{width:18px;height:18px;stroke:' + T.accent + ';fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.ops-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}',
    '.ops-pill{display:inline-block;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;border:1px solid;white-space:nowrap}',
    '.ops-pill.ok{color:' + T.green + ';background:rgba(63,185,80,.14);border-color:rgba(63,185,80,.4)}',
    '.ops-pill.warn{color:' + T.amber + ';background:rgba(210,153,34,.14);border-color:rgba(210,153,34,.4)}',
    '.ops-pill.info{color:' + T.accent + ';background:rgba(121,192,255,.12);border-color:rgba(121,192,255,.4)}',
    '.ops-pill.mute{color:' + T.muted + ';background:rgba(139,148,158,.12);border-color:' + T.border + '}',
    '.ops-desc{font-size:14px;color:' + T.soft + '}',
    '.ops-box{background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:9px}',
    '.ops-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:' + T.muted + '}',
    '.ops-check{display:flex;gap:9px;align-items:flex-start;font-size:14px}',
    '.ops-dot{width:20px;height:20px;border-radius:50%;flex:0 0 20px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
    '.ops-dot.ok{background:rgba(63,185,80,.18);color:' + T.green + '}',
    '.ops-dot.warn{background:rgba(210,153,34,.18);color:' + T.amber + '}',
    '.ops-dot.info{background:rgba(121,192,255,.16);color:' + T.accent + '}',
    '.ops-btn{display:block;width:100%;min-height:46px;border-radius:10px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;border:1px solid ' + T.border + ';background:#21262d;color:' + T.text + ';padding:0 16px}',
    '.ops-btn.primary{background:' + T.primary + ';border-color:' + T.primaryBorder + ';color:#fff}',
    '.ops-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.ops-btn.small{width:auto;min-height:44px;font-size:13px;padding:0 14px}',
    '.ops-note{font-size:14px;color:' + T.muted + '}',
    '.ops-note.err{color:' + T.red + '}',
    '.ops-meta{font-size:12px;color:' + T.muted + '}',
    '.ops-empty{font-size:14px;color:' + T.muted + ';text-align:center;padding:18px 8px}',
    '.ops-toast{display:flex;gap:10px;align-items:center;justify-content:space-between;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.4);border-radius:10px;padding:8px 10px;font-size:13px}',
    '.ops-fab{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));pointer-events:auto;display:flex;align-items:center;gap:8px;background:' + T.surface + ';border:1px solid ' + T.blue + ';border-radius:999px;padding:0 16px;min-height:44px;color:' + T.accent + ';font:inherit;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer;max-width:calc(100vw - 24px)}',
    '.ops-fab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ops-fab i{width:8px;height:8px;border-radius:50%;background:' + T.green + ';flex:0 0 8px;animation:ops-pulse 2s ease-in-out infinite}',
    '.ops-bubble{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:calc(max(12px,env(safe-area-inset-bottom)) + 50px);max-width:min(320px,calc(100vw - 24px));background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:12px;padding:10px 12px;font-size:13px;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '.ops-tile:focus-visible,.ops-btn:focus-visible,.ops-icon-btn:focus-visible,.ops-fab:focus-visible{outline:2px solid ' + T.accent + ';outline-offset:2px}',
    '@keyframes ops-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '@media (prefers-reduced-motion:reduce){.ops-fab i{animation:none}.ops-tile{transition:none}}'
  ].join('\n');

  var PATHS = {
    list: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
    x: ['M6 6l12 12', 'M18 6L6 18'],
    clock: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16', 'M12 8v4l3 2'],
    shield: ['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
    users: ['M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7', 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M21 20c0-2.6-1.6-4.8-4-5.6'],
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z']
  };

  function ensureStyle() {
    if (document.getElementById('ops-kit-style')) return;
    var s = document.createElement('style');
    s.id = 'ops-kit-style'; s.setAttribute('data-ops', '1'); s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.setAttribute('data-ops', '1');
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    (PATHS[name] || PATHS.grid).forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    var box = el('span', 'ops-ico'); box.appendChild(svg); return box;
  }
  function root() { ensureStyle(); var r = el('div', 'ops-root'); document.body.appendChild(r); return r; }
  function raise(r) { if (r && r.parentNode && r !== r.parentNode.lastElementChild) r.parentNode.appendChild(r); }
  function modal(r, onDismiss) {
    var dim = el('div', 'ops-dim'), card = el('div', 'ops-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    dim.addEventListener('click', function () { if (onDismiss) onDismiss(); });
    r.appendChild(dim); r.appendChild(card);
    return { dim: dim, card: card, remove: function () { dim.remove(); card.remove(); } };
  }
  function header(card, o) {
    var h = el('div', 'ops-head');
    if (o.onBack) { var b = el('button', 'ops-icon-btn', '‹'); b.type = 'button'; b.setAttribute('aria-label', 'Back'); b.addEventListener('click', o.onBack); h.appendChild(b); }
    var t = el('div', 'ops-titles'), title = el('div', 'ops-title', o.title), sub = el('div', 'ops-sub', o.sub || '');
    t.appendChild(title); t.appendChild(sub); h.appendChild(t);
    if (o.onClose) { var x = el('button', 'ops-icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', o.onClose); h.appendChild(x); }
    card.appendChild(h);
    return { title: title, sub: sub };
  }
  function body(card) { var b = el('div', 'ops-body'); card.appendChild(b); return b; }
  function pill(text, kind) { return el('span', 'ops-pill ' + (kind || 'mute'), text); }
  function tile(o) {
    var b = el('button', 'ops-tile'); b.type = 'button';
    b.appendChild(icon(o.icon)); b.appendChild(el('span', 'ops-tname', o.title));
    var pills = el('span', 'ops-pills'); b.appendChild(pills);
    b.addEventListener('click', o.onClick);
    return { btn: b, pills: pills };
  }
  function button(text, kind, onClick) {
    var b = el('button', 'ops-btn' + (kind ? ' ' + kind : ''), text); b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function input(o) {
    var i = el('input', 'ops-input'); i.type = o.type || 'text';
    if (o.placeholder) i.placeholder = o.placeholder;
    if (o.label) i.setAttribute('aria-label', o.label);
    i.autocomplete = 'off'; i.spellcheck = false;
    return i;
  }
  function note(parent, text, kind) { var n = el('div', 'ops-note' + (kind ? ' ' + kind : ''), text); parent.appendChild(n); return n; }
  function toast(parent, text, actionText, onAction) {
    var t = el('div', 'ops-toast'); t.appendChild(el('span', '', text));
    if (actionText) t.appendChild(button(actionText, 'small', onAction));
    parent.insertBefore(t, parent.firstChild); return t;
  }
  function fab(r, text, onClick) {
    var f = el('button', 'ops-fab'); f.type = 'button';
    f.appendChild(el('i')); var s = el('span', '', text); f.appendChild(s);
    f.addEventListener('click', onClick); r.appendChild(f);
    return { el: f, setText: function (t) { s.textContent = t; }, remove: function () { f.remove(); } };
  }
  function bubble(r, text, ms, actionText, onAction) {
    var old = r.querySelector('.ops-bubble'); if (old) old.remove();
    var b = el('div', 'ops-bubble'); b.appendChild(el('div', '', text));
    if (actionText) {
      var a = button(actionText, 'small', function () { b.remove(); if (onAction) onAction(); });
      a.style.marginTop = '8px'; b.appendChild(a);
    }
    r.appendChild(b);
    setTimeout(function () { b.remove(); }, ms || 5000);
    return b;
  }

  window.OpsKit = {
    T: T, el: el, icon: icon, root: root, raise: raise, modal: modal, header: header, body: body,
    pill: pill, tile: tile, button: button, input: input, note: note, toast: toast, fab: fab, bubble: bubble
  };
})();
