// fun-stuff.js — Fun Stuff: a small menu of fun extras, launched from the Ops Center. Its one option for now is the
// Emoji sender: any built-in or animated chat emoji (locked packs too) to the chat that's open, through the game's
// own send functions (newChatController sendEmotionGroup / sendGIFGroup). Nothing goes out without a tap; at most
// one every 3 s, each on the shared Ops request clock. Art and IDs come from texnottexas/tw-emoji-assets on
// jsDelivr, pinned to a commit. Rules live in fun-stuff-core.js (window.FunStuffCore); this file talks to the game
// and the page.
(function () {
  'use strict';
  if (window.__FUN && window.__FUN.open && document.getElementById('fun-root')) { window.__FUN.flash(); return; }
  var C = window.FunStuffCore;
  if (!C) { try { alert('Fun Stuff did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-07';
  var CDN = window.__FUN_CDN || 'https://cdn.jsdelivr.net/gh/texnottexas/tw-emoji-assets@44aa813c42e1d8d5ebf57453f69c8762642da5de';
  var LS_RECENT = 'fun_recent_v1', GIF_FLOOR_CFG = 630051;  // GameTools config: the level animated emojis need

  // ---------------------------------------------------------------- game
  // The game window: this page, or the game Map Collector runs in a frame in Unattended mode in this tab.
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return window;
  }
  function req(n) { return GW().__require(n); }
  function UD() { return req('DataCenter').DATA.UserData; }
  function connected() { try { var s = req('NetMgr').NET._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function ready() { try { var U = UD(); return !!(U && U.Name) && connected(); } catch (e) { return false; } }
  function chatCtl() { try { return req('newChatController').newChatController._instance; } catch (e) { return null; } }
  function myUid() { try { var U = UD(); return String(U.StrUid || U._uid || ''); } catch (e) { return ''; } }
  function level() { try { return Number(UD().Level) || 0; } catch (e) { return 0; } }
  function gifFloor() { try { return Number(req('GameTools').default.getDataConfigData(GIF_FLOOR_CFG)) || C.GIF_LEVEL; } catch (e) { return C.GIF_LEVEL; } }
  function openChat() { var ctl = chatCtl(); return C.target(ctl ? ctl.NowChoiceKey : null, myUid()); }
  // One request clock for every Ops tool in this tab (Map Collector and Mask Boxes too).
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + 1100 + Math.floor(Math.random() * 200) - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------------------------------------------------------------- state
  var recentRaw = lsGet(LS_RECENT);
  var S = { view: 'menu', cat: null, catErr: '', loading: false, tab: null, lastAt: 0, busy: false, stopped: '',
    recent: Array.isArray(recentRaw) ? recentRaw.filter(function (k) { return typeof k === 'string'; }).slice(0, C.RECENT_MAX) : [] };
  var byKey = {};

  // ---------------------------------------------------------------- send
  async function send(e) {
    if (S.stopped) { status('Sending stopped: ' + S.stopped); return; }
    if (e.kind === 'gif' && C.gifLocked(level(), gifFloor())) { status('Animated emojis unlock at level ' + gifFloor() + '.'); return; }
    if (S.busy) return;
    var cd = C.cooldown(S.lastAt, Date.now());
    if (!cd.ok) { status('Wait ' + Math.ceil(cd.waitMs / 1000) + ' s'); return; }
    S.busy = true; S.lastAt = Date.now();
    status('Sending ' + (e.name || 'emoji') + '...');
    try {
      await pace();
      if (!ready()) { status('The game is not connected. Nothing was sent.'); return; }
      var ctl = chatCtl(), fn = e.kind === 'gif' ? 'sendGIFGroup' : 'sendEmotionGroup';
      if (!ctl || typeof ctl[fn] !== 'function') throw new Error('the game chat is not ready');
      var t = C.target(ctl.NowChoiceKey, myUid());        // the chat open right now, not when the picker opened
      ctl[fn](t.channel, e.id, t.uid, t.name);
      S.lastAt = Date.now();
      S.recent = C.recent(S.recent, C.emojiKey(e)); lsSet(LS_RECENT, S.recent);
      status('Sent ' + (e.name || 'emoji') + ' to ' + t.label);
    } catch (err) {
      S.stopped = String((err && err.message) || err || 'unknown error').slice(0, 80);
      status('Sending stopped: ' + S.stopped);
    } finally { S.busy = false; }
  }

  function loadCatalog() {
    if (S.cat || S.loading) return;
    S.loading = true; S.catErr = '';
    fetch(CDN + '/catalog.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (raw) {
      var cat = C.parseCatalog(raw);
      if (!cat || !cat.emojis.length) throw new Error('bad list');
      S.cat = cat; byKey = {};
      cat.emojis.forEach(function (x) { byKey[C.emojiKey(x)] = x; });
    }).catch(function () {
      S.catErr = 'Emoji list unavailable. Try again later.';
    }).then(function () { S.loading = false; if (S.view === 'emoji') showEmoji(); });
  }

  // ---------------------------------------------------------------- card
  var CSS = [
    '#fun-root{position:fixed;right:calc(8px + env(safe-area-inset-right));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#fun-root .fun-card{width:min(300px,calc(100vw - 16px));box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:8px 10px 10px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#fun-root .fun-card.flash{transform:scale(1.03)}',
    '#fun-root .fun-head{display:flex;align-items:center;gap:4px;font-weight:600;margin-bottom:6px}#fun-root .fun-title{flex:1;white-space:nowrap;padding-left:2px}',
    '#fun-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#fun-root .fun-icon{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#fun-root .fun-icon:hover{color:#e6edf3;background:#1c2128}',
    '#fun-root .fun-opt{display:block;width:100%;min-height:44px;margin-top:4px;border:1px solid #30363d;border-radius:8px;background:#1c2128;text-align:left;padding:8px 12px}',
    '#fun-root .fun-opt:hover{border-color:#79c0ff}#fun-root .fun-opt small{display:block;color:#8b949e;font-size:12px;font-weight:400}',
    '#fun-root .fun-to{color:#79c0ff;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}',
    '#fun-root .fun-tabs{display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}#fun-root .fun-tabs::-webkit-scrollbar{display:none}',
    '#fun-root .fun-tab{flex:none;min-width:44px;height:44px;padding:0 8px;border:1px solid #30363d;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center;font-size:12px;font-weight:600}',
    '#fun-root .fun-tab img{width:30px;height:30px;object-fit:contain}',
    '#fun-root .fun-tab[aria-selected="true"]{border-color:#3fb950;background:#1c2128;color:#e6edf3}',
    '#fun-root .fun-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;max-height:min(40vh,300px);overflow-y:auto;margin-top:4px;overscroll-behavior:contain}',
    '#fun-root .fun-emo{aspect-ratio:1;min-height:44px;padding:3px;border:1px solid transparent;border-radius:8px;background:#1c2128;display:grid;place-items:center}',
    '#fun-root .fun-emo:hover{border-color:#79c0ff}#fun-root .fun-emo img{width:100%;height:100%;object-fit:contain}',
    '#fun-root .fun-emo[aria-disabled="true"]{opacity:.35;cursor:not-allowed}',
    '#fun-root .fun-empty{grid-column:1/-1;color:#8b949e;padding:12px 4px;text-align:center}',
    '#fun-root .fun-status{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  ].join('\n');
  var root = null, card = null, timer = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function svgIcon(d) {
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', d); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); return ic;
  }
  function iconButton(id, label, d, fn) { var b = el('button', 'fun-icon'); b.id = id; b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.appendChild(svgIcon(d)); b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    var st = document.getElementById('fun-style');             // always this version's styles (an update in the same tab)
    if (!st) { st = el('style'); st.id = 'fun-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('fun-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'fun-root';
    card = el('div', 'fun-card'); root.appendChild(card);
    document.body.appendChild(root);
  }
  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; window.__FUN.open = false;
  }
  function head(title, back) {
    card.textContent = '';
    var h = el('div', 'fun-head');
    if (back) h.appendChild(iconButton('fun-back', 'Back', 'M15 6l-6 6 6 6', showMenu));
    h.appendChild(el('span', 'fun-title', title));
    h.appendChild(iconButton('fun-close', 'Close', 'M6 6l12 12M18 6L6 18', close));
    card.appendChild(h);
  }
  function status(text) { var s = document.getElementById('fun-status'); if (s && s.textContent !== text) { s.textContent = text; s.title = text; } }

  function showMenu() {
    S.view = 'menu';
    if (timer) { clearInterval(timer); timer = null; }
    head('Fun Stuff', false);
    var b = el('button', 'fun-opt'); b.id = 'fun-emoji'; b.type = 'button';
    b.appendChild(el('span', null, 'Emoji sender'));
    b.appendChild(el('small', null, 'Any emoji, locked packs too, to the chat you have open'));
    b.addEventListener('click', function () { S.view = 'emoji'; loadCatalog(); showEmoji(); });
    card.appendChild(b);
  }

  function tabs() {
    var out = [{ id: 'recent', label: 'Recent' }];
    S.cat.packs.forEach(function (p) {
      if (S.cat.emojis.some(function (e) { return e.pack === p.id; })) out.push({ id: String(p.id), label: p.name, icon: C.iconUrl(CDN, { file: p.icon }) });
    });
    if (S.cat.emojis.some(function (e) { return e.kind === 'gif'; })) out.push({ id: 'gif', label: 'GIF' });
    return out;
  }
  function itemsFor(tab) {
    if (tab === 'recent') return S.recent.map(function (k) { return byKey[k]; }).filter(Boolean);
    if (tab === 'gif') return S.cat.emojis.filter(function (e) { return e.kind === 'gif'; });
    return S.cat.emojis.filter(function (e) { return e.kind === 'static' && String(e.pack) === tab; });
  }
  function showEmoji() {
    head('Emoji sender', true);
    var to = el('div', 'fun-to'); to.id = 'fun-to'; to.setAttribute('translate', 'no'); card.appendChild(to);
    var tb = el('div', 'fun-tabs'); tb.id = 'fun-tabs'; tb.setAttribute('role', 'tablist'); card.appendChild(tb);
    var grid = el('div', 'fun-grid'); grid.id = 'fun-grid'; card.appendChild(grid);
    var st = el('div', 'fun-status'); st.id = 'fun-status'; st.setAttribute('aria-live', 'polite'); card.appendChild(st);
    paintTo();
    if (!timer) timer = setInterval(paintTo, 1000);          // the open chat can change while the picker is up
    if (S.stopped) status('Sending stopped: ' + S.stopped);
    if (!S.cat) { grid.appendChild(el('div', 'fun-empty', S.catErr || 'Loading emojis...')); return; }
    var list = tabs();
    if (!S.tab || !list.some(function (t) { return t.id === S.tab; })) S.tab = itemsFor('recent').length || !list[1] ? 'recent' : list[1].id;
    list.forEach(function (t) {
      var b = el('button', 'fun-tab'); b.type = 'button'; b.dataset.tab = t.id; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === S.tab)); b.setAttribute('aria-label', t.label); b.title = t.label;
      if (t.icon) { var im = el('img'); im.src = t.icon; im.alt = ''; im.decoding = 'async'; b.appendChild(im); } else b.textContent = t.label;
      b.addEventListener('click', function () { S.tab = t.id; showEmoji(); });
      tb.appendChild(b);
    });
    var locked = C.gifLocked(level(), gifFloor()), items = itemsFor(S.tab);
    if (!items.length) grid.appendChild(el('div', 'fun-empty', S.tab === 'recent' ? 'Emojis you send show up here.' : 'Nothing here.'));
    items.forEach(function (e) {
      var b = el('button', 'fun-emo'); b.type = 'button'; b.dataset.key = C.emojiKey(e);
      b.setAttribute('aria-label', e.name || 'Emoji ' + e.id); b.title = e.name || '';
      if (e.kind === 'gif' && locked) b.setAttribute('aria-disabled', 'true');
      var im = el('img'); im.src = C.iconUrl(CDN, e); im.alt = e.name || ''; im.loading = 'lazy'; im.decoding = 'async'; b.appendChild(im);
      b.addEventListener('click', function () { send(e); });
      grid.appendChild(b);
    });
  }
  function paintTo() {
    var to = document.getElementById('fun-to'); if (!to) return;
    var text = 'Sending to: ' + openChat().label;
    if (to.textContent !== text) { to.textContent = text; to.title = text; }
  }

  // ---------------------------------------------------------------- start
  window.__FUN = {
    open: true, version: VERSION,
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    close: close
  };
  ensureRoot();
  showMenu();
})();
