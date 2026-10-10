/* armory.html: the Armory v2 screens (phase 2b). First paint: boot, routing, Overview, Heroes > Battle.
 * armory-more.js (loaded on first use): Start, Status, Settings, Share, Roster, Gear, Base, Beasts. armory-ht.js: the HT section.
 * Data comes from ArmoryData (loaders, identity) and ArmoryVM (view-model); nothing here re-computes game rules.
 * v2 never writes `playerReport` for a ?code= link or on its own initiative; it writes it only when the player builds
 * their own armory on the Start screen, edits their own report list, or mints a share code (all v1 behaviour).
 */
(function () {
'use strict';
var WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
var BASE = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/';
var SK_RE = /^[0-9a-f]{16}$/;
var G = window.TWGameData;
var d = ArmoryData.create(), core = d.core;
var S = { res: null, vm: null, code: null, cur: null, open: {}, f: { q: '', br: {}, sort: 'score' }, gview: 'gear', gslot: 0, all: {}, sheet: null, lastFocus: null, saved: false, confirm: '', advise: null, planCode: null, advDot: false, idxP: null, idxKey: null };
var VIEWS = {
  overview: { label: 'Overview', icon: 'overview' },
  heroes: { label: 'Heroes', icon: 'heroes', segs: [['battle', 'Battle'], ['roster', 'Roster'], ['gear', 'Gear'], ['advice', 'Advice']] },
  base: { label: 'Base', icon: 'base' }, beasts: { label: 'Beasts', icon: 'beasts', segs: [['field', 'Field'], ['collection', 'Collection'], ['optimizer', 'Optimizer']] }, ht: { label: 'HT', icon: 'ht', segs: [['loadouts', 'Loadouts'], ['pool', 'Chip pool']] }
};
var TABS = ['overview', 'heroes', 'base', 'beasts', 'ht'];
var PAGES = [['armory-report.html', 'Armory Report'], ['bases.html', 'Bases'], ['battle-report.html', 'Battle Reports'], ['chaos-crafting.html', 'Chaos Crafting'], ['decor-index.html', 'Decor Index'], ['enigma-viewer.html', 'Enigma Beasts'], ['eternal-land-calendar.html', 'Eternal Land'], ['heroes.html', 'Heroes'], ['heroes-awakening.html', 'Heroes Awakening'], ['ht-chips.html', 'HT Chips'], ['roadmap.html', 'Roadmap'], ['rockfield-optimizer.html', 'Rockfield Optimizer'], ['titan.html', 'Titan Canyon']];

/* ---------- helpers ---------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function nd(s) { return esc(s).replace(/(\d[\d,.]*)/g, '<span translate="no">$1</span>'); }
function nm(s, cls) { return '<span translate="no"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(s) + '</span>'; }
function ic(id, cls) { return '<svg class="i ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
function fmtK(n) { n = +n || 0; return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); }
function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function ramp(p) { return p >= 70 ? 'max' : p >= 50 ? 'hi' : p >= 25 ? 'mid' : 'lo'; }
function qCls(q) { return q >= 6 ? 'q6' : q === 5 ? 'q5' : q === 4 ? 'q4' : q === 3 ? 'q3' : ''; }
function slug(n) { return String(n).toLowerCase().replace(/ /g, '-'); }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
function stars(s, sm) {
  var o = '';
  for (var i = 0; i < sm; i++) o += '<svg class="star' + (i < s ? '' : ' off') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>';
  return '<span class="stars" role="img" aria-label="' + s + ' of ' + sm + ' stars">' + o + '</span>';
}
function art(url, cls, fb, alt) { return '<img class="' + cls + '" src="' + esc(url) + '" alt="' + esc(alt || '') + '" data-fb="' + esc(fb) + '" decoding="async">'; }
function lbl(label, num, src, cls) { return '<div class="nb" data-numwrap><div class="n disp ' + (cls || '') + '" data-num translate="no">' + esc(num) + '</div><div class="l lbl">' + esc(label) + '</div><div class="s src">' + src + '</div></div>'; }
function stateName() { return S.res && S.res.player && S.res.player.name || ''; }
function sk() { var k = S.res && S.res.player && S.res.player.siteKey; return SK_RE.test(String(k || '')) ? k : null; }
function readOnly() { return !S.res || !!S.res.readOnly; }
function classicUrl(tab) { if (S.advise) return 'armory-report.html?advise=' + S.advise.code; return 'armory-report.html' + (S.code ? '?code=' + encodeURIComponent(S.code) : '') + (tab ? '#tab=' + tab : ''); }
function savedReport() { var s = null; try { s = JSON.parse(ls('playerReport')); } catch (e) {} return s && s.player && Array.isArray(s.reportIds) ? s : null; }
function deviceId() {
  var id = ls('reportDeviceId');
  if (id && SK_RE.test(id)) return id;
  var a = new Uint8Array(8); crypto.getRandomValues(a);
  id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  ls('reportDeviceId', id); return id;
}
var toastT;
function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }

/* ---------- the lazy half ---------- */
var M = null, moreQ = null, H = null, Av = null, advQ = null, HT = {}, BT = {};
function more(cb) {
  if (M) return cb(M);
  if (moreQ) { moreQ.push(cb); return; }
  moreQ = [cb];
  var sc = document.createElement('script');
  sc.src = 'armory-more.js';
  sc.onload = function () { M = window.ArmoryMore(H); var q = moreQ; moreQ = null; if (S.vm) M.renderSections(); q.forEach(function (f) { f(M); }); };
  sc.onerror = function () { moreQ = null; fkDrop(); $('#v-start').hidden = false; $('#v-start').innerHTML = '<div class="vb"><div class="start"><h1 class="disp" style="font-size:var(--fs-24)">Could not load this part</h1><p class="muted">Check your connection and reload the page.</p></div></div>'; };
  document.body.appendChild(sc);
}
/* a section module loaded on first use: o = {m: the module, q: waiting callbacks} */
function lz(o, src, make, view, cb) {
  if (o.m) return cb(o.m);
  if (o.q) { o.q.push(cb); return; }
  o.q = [cb];
  var sc = document.createElement('script');
  sc.src = src;
  sc.onload = function () { o.m = make(); var q = o.q; o.q = null; q.forEach(function (f) { f(o.m); }); };
  sc.onerror = function () { o.q = null; var v = S.cur && S.cur.view === view && $('#v-' + view); if (v) v.innerHTML = '<div class="vb"><div class="empty">Could not load this part. Check your connection and reload the page.</div></div>'; };
  document.body.appendChild(sc);
}
function ht(cb) { lz(HT, 'armory-ht.js', function () { return window.ArmoryHt(H); }, 'ht', cb); }
function bst(cb) { lz(BT, 'armory-beasts.js', function () { return window.ArmoryBeasts(H); }, 'beasts', cb); }
function advice(cb) {
  if (Av) return cb(Av);
  if (advQ) { advQ.push(cb); return; }
  advQ = [cb];
  var sc = document.createElement('script');
  sc.src = 'armory-advice.js';
  sc.onload = function () { Av = window.ArmoryAdvice.mount(H); var q = advQ; advQ = null; q.forEach(function (f) { f(Av); }); };
  sc.onerror = function () { advQ = null; var b = $('#adviceBody'); if (b) b.innerHTML = '<div class="empty">Could not load this part. Check your connection and reload the page.</div>'; };
  document.body.appendChild(sc);
}
function renderStart(kind, extra) { fkSettle(function () { more(function (m) { fkDrop(); m.renderStart(kind, extra); }); }, true, true); }
function share() { more(function (m) { m.share(); }); }

/* ---------- routing ---------- */
var LEGACY = { overview: 'overview', heroes: 'heroes/battle', decorations: 'base', bases: 'base', enigma: 'beasts/field', chips: 'ht/loadouts', formation: 'base', inventory: 'bag', runepool: 'heroes/gear?view=runes', myadvisorplans: 'heroes/advice', advisorplan: 'heroes/advice' };
function shim() {
  var m = /^#tab=([a-z0-9_-]+)/i.exec(location.hash || '');
  if (!m) return false;
  var to = LEGACY[m[1].toLowerCase()] || 'overview';
  history.replaceState(null, '', location.pathname + location.search + '#' + to);
  return false;
}
function parseHash() {
  var h = (location.hash || '').replace(/^#/, ''), q = {}, path = h, i = h.indexOf('?');
  if (i >= 0) { path = h.slice(0, i); h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) { try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) {} } }); }
  var parts = path.split('/');
  if (parts[0] === 'heroes' && parts[1] === 'runes') { parts[1] = 'gear'; q.view = 'runes'; } /* #heroes/runes is the Runes view of the Gear pane */
  var bag = parts[0] === 'bag', v = VIEWS[parts[0]] ? parts[0] : 'overview';
  var seg = parts[1] || (VIEWS[v].segs ? VIEWS[v].segs[0][0] : '');
  if (VIEWS[v].segs && !VIEWS[v].segs.some(function (s) { return s[0] === seg; })) seg = VIEWS[v].segs[0][0];
  return { view: v, seg: seg, q: q, bag: bag };
}
function go(p) { location.hash = '#' + p; }
function applyRoute(first, soft) {
  if (!S.vm) return;
  var r = parseHash(), changed = !S.cur || S.cur.view !== r.view;
  if (!M && (r.bag || r.q.item || r.view === 'base' || (r.view === 'heroes' && r.seg !== 'battle' && r.seg !== 'advice'))) { more(function () { applyRoute(first, soft); }); return; }
  if (!soft) closeSheet(true);
  S.cur = r;
  $$('.view').forEach(function (s) {
    var on = s.dataset.view === r.view;
    s.hidden = !on;
    if (on && changed && !first && !soft) { s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); }
  });
  $$('#tabsIn .tab, #bar a').forEach(function (a) { if (a.dataset.v === r.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  var view = $('#v-' + r.view);
  $$('.segs button', view).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.seg === r.seg ? 'true' : 'false'); });
  $$('[data-pane]', view).forEach(function (p) { p.hidden = p.dataset.pane !== r.seg; });
  document.title = 'Armory | ' + VIEWS[r.view].label;
  if (!soft && (!first || (location.hash && location.hash !== '#overview'))) window.scrollTo(0, 0);
  if (r.view === 'heroes' && r.seg === 'advice') advice(function (a) { a.render(r.q, soft); });
  if (r.view === 'ht' && !soft) ht(function (h) { h.render(r); });
  if (r.view === 'beasts' && !soft) bst(function (b) { b.render(r); });
  if (soft) return;
  if (r.view === 'heroes' && r.seg === 'battle' && r.q.hero) {
    var h = S.vm.heroes.list.filter(function (x) { return x.name === r.q.hero; })[0];
    if (h) {
      S.open[h.id] = true; setHeroOpen(h.id, true);
      var g = document.getElementById('g-' + h.id + '-' + r.q.slot);
      if (g) { $$('.gcard.sel').forEach(function (x) { x.classList.remove('sel'); }); g.classList.add('sel'); setTimeout(function () { g.scrollIntoView({ block: 'center' }); }, 30); }
    }
  }
  if (r.view === 'heroes' && r.seg === 'gear' && r.q.view === 'runes' && S.gview !== 'runes') { S.gview = 'runes'; M.renderGear(); }
  if (r.view === 'base' && r.q.item) openSheet('decor', r.q.item);
  if (r.bag) openSheet('bag');
}

/* ---------- loading ---------- */
/* ---------- fk boats loader (styles: .fkl in armory.html) ---------- */
var FK_OUTER = 'M91.06,19.11a1.36,1.36,0,0,0-1-1.48Q70.47,9,50.9.22a2.12,2.12,0,0,0-1.9,0Q29.49,8.92,9.95,17.57a1.52,1.52,0,0,0-1,1.66q0,7.21,0,14.42V45.19a57.47,57.47,0,0,0,12.5,36A52.12,52.12,0,0,0,48.11,99.7a6.23,6.23,0,0,0,3.82,0c11.51-3.46,20.58-10.31,27.68-19.87A57.3,57.3,0,0,0,90.3,54.54,59,59,0,0,0,91,45.83C91.1,36.93,91,28,91.06,19.11Zm-6.92,27.4a48.62,48.62,0,0,1-.59,7.23,47.62,47.62,0,0,1-8.88,21,43.87,43.87,0,0,1-23,16.5,5.2,5.2,0,0,1-3.17,0A43.36,43.36,0,0,1,26.38,75.88,47.61,47.61,0,0,1,15.89,46V36.4c0-4,0-8,0-11.95H16a1.25,1.25,0,0,1,.86-1.38Q33.05,15.89,49.25,8.65a1.74,1.74,0,0,1,1.57,0Q67.07,15.9,83.33,23.1a1.13,1.13,0,0,1,.81,1.23V46.51Z', FK_INNER = 'M78.14,50c-0.08,1-.18,2.09-0.37,3.13a39.5,39.5,0,0,1-7.38,17.45,36.49,36.49,0,0,1-19.1,13.71,4.32,4.32,0,0,1-2.66,0,36.49,36.49,0,0,1-19.1-13.71,39.5,39.5,0,0,1-7.38-17.45C22,52.07,21.87,51,21.79,50h0c-0.09-1.09-.13-2.19-0.14-3.3v-18a1,1,0,0,1,.71-1.07l27-12a1.26,1.26,0,0,1,.39-0.12,0.5,0.5,0,0,1,.28,0,1.26,1.26,0,0,1,.39.12l27,12a1,1,0,0,1,.71,1.07v18c0,1.11-.05,2.21-0.14,3.3h0.17Z';
var FK_DELAY = 120, FK_FORM = 1050, FK_SETTLE = 350;
function fkReduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
function fkMarkup(role) {
  var o = ''; for (var i = 0; i < 8; i++) o += '<span class="o"><i></i></span>';
  return '<div class="fkl' + (role ? '' : ' intro') + '"' + (role ? '' : ' aria-hidden="true"') + '>' +
    '<div class="fkl-st" aria-hidden="true">' + o + '<p class="fk" translate="no">fk<br> boats</p>' +
    '<svg class="sh" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="' + FK_OUTER + '"/><path d="' + FK_INNER + '"/></svg></div>' + (role ? '<p class="fkl-cap">Building your armory</p>' : '') + '</div>';
}
/* a loader stays up while a load is pending; a load under 120 ms never shows it (no flash) */
function fkShow(host) {
  fkDrop();
  host.innerHTML = '<div class="vb fkl-vb">' + fkMarkup(true) + '</div>';
  var el = host.querySelector('.fkl'); el.setAttribute('data-run', '');
  $('#main').setAttribute('aria-busy', 'true');
  $('#fkLive').textContent = 'Loading your armory\u2026';   /* announced from outside #main, which is aria-busy */
  S.fk = { el: el, t: setTimeout(function () { el.classList.add('on'); S.fk.on = true; }, FK_DELAY), on: false };
}
function fkBusyOff() { $('#main').removeAttribute('aria-busy'); $('#fkLive').textContent = ''; }
function fkDrop() { if (S.fk) { clearTimeout(S.fk.t); var p = S.fk.el.parentNode; if (p) p.removeChild(S.fk.el); S.fk = null; } fkBusyOff(); }
/* fn(shown) runs when the loader is done: after one formation + shield reveal (1050 ms: the shield stays up 300 ms), at once if it never showed or motion is reduced,
   after a short settle on a failed load. */
function fkSettle(fn, failed, keep) {
  var f = S.fk, end = function () { if (keep) fkBusyOff(); else if (S.fk === f) fkDrop(); };   /* keep: the caller drops the loader once its screen is ready */
  if (!f || !f.on || fkReduced()) { if (f) clearTimeout(f.t); if (keep) fkBusyOff(); else fkDrop(); fn(false); return; }   /* a load done inside 120 ms never fades the loader in */
  f.t = setTimeout(function () { end(); fn(true); }, failed ? FK_SETTLE : FK_FORM);
  f.el.classList.add(failed ? 'settle' : 'form');
}
/* Start-screen hero: plays the formation once, nothing loops */
function fkHero(host) {
  host.insertAdjacentHTML('afterbegin', fkMarkup(false));
  var el = host.querySelector('.fkl'); el.setAttribute('data-run', '');
  if (fkReduced()) { el.removeAttribute('data-run'); return; }
  requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('form'); }); });
  setTimeout(function () { el.removeAttribute('data-run'); }, FK_FORM + 200);
}
function showSkeleton() {
  document.body.classList.add('st-start');
  $$('.view').forEach(function (s) { s.hidden = s.id !== 'v-start'; });
  fkShow($('#v-start'));
}
/* Next moves signal e: with saved optimizer preferences the Beasts module adds the best swap after first paint (nothing loads for anyone else) */
function beastMove() {
  var k = sk();
  if (!k || S.advise || S.res.readOnly || !S.vm.beasts || !ls('beast_optimizer_prefs_' + k)) return;
  (window.requestIdleCallback || setTimeout)(function () { bst(function (b) { b.nextMove(); }); });
}
function setReady(res) {
  S.res = res;
  S.vm = ArmoryVM.buildViewModel(res.merged, res.sources, ArmoryVM.fromLoad(res, core));
  document.body.classList.remove('st-start');
  var again = !!S.cur;
  renderAll();
  applyRoute(!again, again);
  if (again) refreshSheet();
  beastMove();
  if (!S.advise && sk() && res.identity && res.identity.isOwn && !res.readOnly) advIndex();
}
function run(arg, then) {
  return d.loadArmory(arg).then(function (res) {
    if (res.state !== 'ready') return res;
    return new Promise(function (resolve) {
      fkSettle(function (shown) {
        try { setReady(res); } catch (e) { console.error(e); renderStart('error'); return resolve(res); }
        if (shown) $$('.view:not([hidden])').forEach(function (s) { s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); });
        if (then) then(res);
        resolve(res);
      });
    });
  });
}
/* "empty" caused only by network errors is a connection problem (try again), not a broken report */
function startKind(res) {
  if (res.state === 'empty' && (res.errors || []).some(function (e) { return e.kind === 'report' && (!e.status || e.status >= 500); })) return 'error';
  return res.state;
}
function normCode(x) { x = String(x == null ? '' : x).trim().toLowerCase(); return /^[a-z0-9]{6}$/.test(x) ? x : ''; }
function toStart() { renderStart('start', S.planCode ? { note: 'Open your armory first to see your advice.' } : null); }
/* the advise link: the request names the player's report; the player's armory opens read-only under THEIR keys */
function bootAdvise(raw) {
  var ac = normCode(raw);
  if (!ac) { renderStart('expired', { advice: true }); return; }
  showSkeleton();
  fetch(WORKER + '/advisor/request/' + ac, { cache: 'no-store' }).then(function (r) {
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error('net');
    return r.json();
  }).then(function (req) {
    var sc = req && String(req.reportShortcode || '').toUpperCase();
    if (!sc || !/^[0-9A-Z]{4}$/.test(sc)) { renderStart('expired', { advice: true }); return; }
    S.advise = { code: ac, req: req }; S.code = sc;
    history.replaceState(null, '', location.pathname + '?advise=' + ac + '#heroes/advice');
    return run({ code: sc }).then(function (res) { if (res.state !== 'ready') renderStart(startKind(res)); });
  }).catch(function () { renderStart('error'); });
}
function boot() {
  if (shim()) return;
  var qs = new URLSearchParams(location.search), adv = qs.get('advise'), plan = normCode(qs.get('plan'));
  if (adv != null) { S.advise = null; renderChrome(); bootAdvise(adv); return; }
  if (qs.get('plan') != null) {
    if (!plan) { renderChrome(); renderStart('expired', { advice: true }); return; }
    S.planCode = plan;
    if (!/^#heroes\/advice/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#heroes/advice?plan=' + plan);
  }
  renderChrome();
  var code = (qs.get('code') || '').trim().toUpperCase();
  showSkeleton();
  if (code) {
    S.code = /^[0-9A-Z]{4}$/.test(code) ? code : null;
    run({ code: code }).then(function (res) { if (res.state !== 'ready') renderStart(startKind(res)); }, function () { renderStart('error'); });
    return;
  }
  /* first paint from what this device already holds, then the worker's newer game data */
  run({ saved: true, noHydrate: true }).then(function (res) {
    if (res.state === 'ready') { S.saved = true; run({ saved: true }); return; }
    if (res.state === 'none' && ls('armory_v2_switched') === '1') { toStart(); return; }
    if (res.state === 'none') {
      run({ dataOnly: true, noHydrate: true }).then(function (r2) {
        if (r2.state === 'ready') { run({ dataOnly: true }); return; }
        run({ dataOnly: true }).then(function (r3) { if (r3.state !== 'ready') toStart(); });
      });
      return;
    }
    renderStart(startKind(res));
  }, function () { renderStart('error'); });
}

/* ---------- chrome ---------- */
function chipState() {
  var r = S.res;
  if (!r) return ['', 'Armory'];
  if (S.advise) return ['', 'Advising'];
  if (r.readOnly) return ['', 'Read-only'];
  if (sk() && !(r.identity && r.identity.unlocked)) return ['bad', 'Verify'];
  var h = S.vm.header;
  if (!h.data) return ['warn', 'No game data'];
  return h.data.warn ? ['warn', h.data.age + ' old'] : ['ok', 'Synced'];
}
function renderChrome() {
  $('#whoN').textContent = stateName() || 'Armory';
  $$('[data-share]', $('#hdr')).forEach(function (b) { b.hidden = !!S.advise; });
  var c = chipState();
  $('#chipTxt').innerHTML = nd(c[1]);
  $('#chipDot').className = 'dot ' + c[0];
  $('#tabsIn').innerHTML = TABS.map(function (v) { return '<a class="tab' + (v === 'heroes' && S.advDot ? ' has-new' : '') + '" href="#' + v + '" data-v="' + v + '">' + ic(VIEWS[v].icon, 'sm') + VIEWS[v].label + '</a>'; }).join('');
  $('#bar').innerHTML = TABS.map(function (v) { return '<a' + (v === 'heroes' && S.advDot ? ' class="has-new"' : '') + ' href="#' + v + '" data-v="' + v + '">' + ic(VIEWS[v].icon) + '<span>' + VIEWS[v].label + '</span></a>'; }).join('');
  $('#pagesPop').innerHTML = '<div class="pop-h">All pages</div>' + PAGES.map(function (p) { return '<a class="pop-a" role="menuitem" href="' + p[0] + '">' + esc(p[1]) + '</a>'; }).join('');
  $('#footNote').innerHTML = '<span>This is the new Armory.</span><a class="tb link" href="' + esc(classicUrl('')) + '">Back to classic</a><button class="tb link" type="button" data-fb>Send feedback</button>';
}
function renderAll() {
  renderChrome(); renderOverview(); renderHeroes();
  if (M) M.renderSections();
  if (HT.m) { try { HT.m.render(S.cur); } catch (e) { console.error(e); } }
  if (BT.m) { try { BT.m.render(S.cur); } catch (e) { console.error(e); } }
  watchName();
}

/* ---------- Start, expired, error ---------- */

/* ---------- Overview ---------- */
function ageSpan(l) { return '<span class="' + (l.warn ? 'c-warn' : '') + '">(' + (l.ageDays < 1 ? 'today' : nm(l.age) + ' old') + ')</span>'; }
function meterBlock(o) {
  return '<div class="bm" data-numwrap><div class="bm-top"><span class="l lbl">' + esc(o.label) + '</span><button class="info" type="button" data-explain="' + o.key + '" aria-label="How ' + esc(o.label.toLowerCase()) + ' is worked out">' + ic('info', 'sm') + '</button></div>' +
    '<div class="bm-num"><span class="n disp" data-num translate="no">' + esc(o.num) + '</span>' + (o.of ? '<span class="t13 muted">' + nd(o.of) + '</span>' : '') + '</div>' +
    '<div class="bm-row"><div class="meter lg r-' + ramp(o.pct) + '" role="img" aria-label="' + esc(o.label) + ' ' + o.pct + ' percent of the maximum"><i style="width:' + Math.max(2, o.pct) + '%"></i></div>' + (o.showPct ? '<span class="bm-pct c-' + ramp(o.pct) + '" translate="no">' + o.pct + '%</span>' : '') + '</div>' +
    '<div class="s src t12 muted">' + o.src + '</div></div>';
}
function moveIco(i) {
  if (!i) return '';
  if (!i.u) return '<span class="ico mico fb ' + esc(i.q) + '" translate="no">' + esc(i.fb) + '</span>';
  return art(BASE + i.u, 'ico mico ' + esc(i.q), i.fb, '');
}
function alliancePill(a) {
  var k = { DOG: 'dog', MSS: 'mss', DGEN: 'dgen', 'CAT+': 'dgen', CAT: 'dgen', PRU: 'pru' }[String(a || '').toUpperCase()];
  return k ? '<span class="pill p-' + k + '" translate="no">' + esc(a) + '</span>' : '<span class="pill">No alliance on file</span>';
}
function renderOverview() {
  var vm = S.vm, h = vm.header, ro = readOnly(), shared = h.shared;
  var por = vm.heroes.list.slice(0, 3).map(function (x) { return '<a class="plink" href="#heroes/battle?hero=' + encodeURIComponent(x.name) + '" aria-label="' + esc(x.name) + ' in battle reports">' + art(x.icon, 'por', x.name.charAt(0), '') + '</a>'; }).join('');
  var fresh = '';
  var rep = h.reports ? '<span>Reports ' + nm(h.reports.date) + ' ' + ageSpan(h.reports) + '</span>' : '';
  var dat = h.data ? '<span>Game data ' + nm(h.data.date) + (h.data.ageDays >= 1 ? ' ' + ageSpan(h.data) : '') + '</span>' : '<span>No game data imported</span>';
  var act = ro ? '' : '<button class="tb link" type="button" data-open="status">' + (h.data ? 'Update' : 'Import') + '</button>';
  fresh = (rep ? rep + '<span class="sep" aria-hidden="true">&middot;</span>' : '') + '<span class="fl">' + dat + act + '</span>';
  var power = h.powerText ? '<div class="nb" data-numwrap><span class="n disp" data-num translate="no">' + esc(h.powerText) + '</span><span class="l lbl">Power</span><span class="s src">alliance list</span></div>' : '';
  var header = '<section class="card hcard" id="hdrCard" aria-label="Player"><div class="hc-top">' +
    (h.avatar ? art(h.avatar, 'ava', (h.name || '?').charAt(0), '') : '<span class="ava fb" translate="no">' + esc((h.name || '?').charAt(0)) + '</span>') +
    '<div style="min-width:0"><div class="hc-name"><span translate="no">' + esc(h.name || 'Armory') + '</span>' + (shared ? '’s armory' : '') + '</div><div class="hc-pills">' + alliancePill(h.alliance) + (shared ? '<span class="pill">Shared with you</span><span class="pill">Read-only</span>' : '') + '</div></div></div>' +
    '<div class="hc-meta"><div class="hc-por">' + por + '</div>' + power + '</div><div class="fresh">' + fresh + '</div></section>';

  var m = vm.moves, rows = m.picks.map(function (p, i) {
    var seg = (p.parts || [{ s: p.text }]).map(function (x) { return x.n ? nm(x.s) : esc(x.s); }).join('');
    return '<a class="move" role="listitem" href="#' + esc(p.route.replace(/ /g, '+')) + '" data-move="' + i + '" title="' + esc(p.full) + '" aria-label="' + esc(p.pill + ': ' + p.full + (p.meta ? '. ' + p.meta : '')) + '">' + moveIco(p.ico) +
      '<div class="move-b"><span class="pill p-eff">' + esc(p.pill) + '</span><span class="move-t">' + seg + '</span>' + (p.meta ? '<span class="move-m">' + nd(p.meta) + '</span>' : '') + '</div>' + ic('chev') + '</a>';
  }).join('');
  var mfoot = m.cta === 'import' && !ro ? '<button class="tb link" type="button" data-open="status">' + nd(m.footer) + '</button>' : m.footer ? nd(m.footer) : '';
  var moves = '<section class="card" id="movesCard" aria-labelledby="mvT"><div class="sechead"><h2 class="title" id="mvT">' + (shared ? nm(h.name || 'Player') + '’s next moves' : 'Next moves') + '</h2><button class="info" type="button" data-explain="moves" aria-label="How next moves are chosen">' + ic('info', 'sm') + '</button></div>' +
    (rows ? '<div class="moves" role="list">' + rows + '</div>' : '<p class="muted" style="margin-top:8px">No moves right now.</p>') + (mfoot ? '<div class="foot cardfoot">' + mfoot + '</div>' : '') + '</section>';

  var B = vm.band, bl = '';
  if (B.gear.heroes) bl += meterBlock({ label: 'Gear score', key: 'gear', num: fmtK(B.gear.score), of: 'of ' + fmtK(B.gear.max), pct: Math.round(B.gear.score / B.gear.max * 100), showPct: true, src: nm(String(B.gear.heroes)) + (B.gear.source === 'in battle reports' ? ' heroes in battle reports' : ' heroes with gear in game data') });
  if (B.gear.heroes) bl += meterBlock({ label: 'Rune stars', key: 'rune', num: B.runes.pct + '%', of: 'of max', pct: B.runes.pct, showPct: false, src: nm(String(B.runes.equipped)) + ' runes equipped' });
  if (B.beasts && B.beasts.pct != null) bl += meterBlock({ label: 'Beast potential', key: 'beast', num: B.beasts.pct + '%', of: 'average', pct: B.beasts.pct, showPct: false, src: nm(String(B.beasts.deployed)) + ' beasts deployed' });
  var band = bl ? '<section class="card" id="bandCard" aria-labelledby="stT"><h2 class="hd" id="stT">Strength</h2><div class="band">' + bl + '</div></section>' : '<span id="bandCard" hidden></span>';

  var Z = vm.summaries;
  function area(href, n, label, src, dataOpen) {
    return '<a class="area" href="' + href + '"' + (dataOpen ? ' data-open="' + dataOpen + '"' : '') + ' data-numwrap><span class="area-n" data-num translate="no">' + esc(n) + '</span><div class="area-b"><div class="l lbl">' + esc(label) + '</div><div class="s src">' + src + '</div></div>' + ic('chev') + '</a>';
  }
  var areas = '<section id="areasCard" aria-label="Areas"><div class="alist">' +
    area('#heroes/battle', String(Z.heroes.battle), 'Heroes', (Z.heroes.source === 'reports' ? 'in battle reports' : 'with gear in game data') + (Z.heroes.roster != null ? ' &middot; ' + nm(String(Z.heroes.roster)) + ' in roster' : '')) +
    area('#base', String(Z.base.placedKinds), 'Decorations', Z.base.placedKinds ? 'kinds placed (' + nm(String(Z.base.placedPieces)) + ' pieces) &middot; March Size ' + nm('+' + Z.base.march) : 'placed &middot; not in game data yet') +
    area('#beasts', Z.beasts ? String(Z.beasts.deployed) : '0', 'Beasts', Z.beasts ? 'deployed in ' + nm(String(Z.beasts.fields)) + ' fields' + (Z.beasts.collected != null ? ' &middot; ' + nm(String(Z.beasts.collected)) + ' collected' : '') : 'deployed &middot; not in game data yet') +
    area('#ht', String(vm.ht.reportMechas ? vm.ht.reportMechas.length : Z.ht.count), 'Heavy Troopers (HT)', vm.ht.reportMechas ? 'in battle reports &middot; ' + nm(String(Z.ht.count)) + ' in game data &middot; ' + nm(Z.ht.chipsFilled + ' of ' + Z.ht.chipsMax) + ' chips equipped' : 'in game data &middot; ' + nm(Z.ht.chipsFilled + ' of ' + Z.ht.chipsMax) + ' chips equipped') +
    '<a class="area bagrow" href="#bag" data-open="bag" data-numwrap><span class="area-n" data-num translate="no">' + fmtInt(vm.decor.shards) + '</span><div class="area-b"><div class="l lbl">Bag</div><div class="s src">decor shards in bag</div></div>' + ic('chev') + '</a>' +
    '</div></section>';

  $('#v-overview').innerHTML = '<div class="vb"><div class="ov"><div class="ov-col">' + header + moves + shareRow() + '</div><div class="ov-col">' + band + areas + '</div></div></div>';
}
function shareRow() {
  if (S.advise) return '';
  var code = currentCode();
  return '<section class="sharerow" id="shareCard" aria-label="Share"><div><div class="t15" style="font-weight:600">Share this report</div><div class="t13 muted">Anyone with the link sees this page read-only.</div></div>' +
    '<div class="irow" style="align-items:center">' + (code ? '<span class="code muted" translate="no" id="shareCode">' + esc(code) + '</span>' : '') + '<button class="btn" type="button" data-share>' + ic('copy', 'sm') + (code ? 'Copy link' : 'Create link') + '</button></div></section>';
}
var nameIO = null;
function watchName() {
  var el = $('.hc-name', $('#v-overview'));
  if (nameIO) { nameIO.disconnect(); nameIO = null; }
  if (!el || !('IntersectionObserver' in window)) return;
  nameIO = new IntersectionObserver(function (e) { $('#hdr').classList.toggle('who-off', e[e.length - 1].isIntersecting && S.cur && S.cur.view === 'overview'); }, { rootMargin: '-52px 0px 0px 0px' });
  nameIO.observe(el);
}

/* ---------- Heroes ---------- */
function segs(v) {
  return '<div class="segs"><div class="segs-in" role="tablist">' + VIEWS[v].segs.map(function (s) { return '<button type="button" role="tab" data-seg="' + s[0] + '"' + (s[0] === 'advice' && S.advDot ? ' class="has-new"' : '') + ' aria-selected="false" data-go="' + v + '/' + s[0] + '">' + esc(s[1]) + '</button>'; }).join('') + '</div></div>';
}
function branchPill(b) { var c = b === 'Army' ? 'army' : b === 'Navy' ? 'navy' : 'air'; return '<span class="pill p-' + c + '">' + esc(b) + '</span>'; }
function ctrls(cls) {
  var f = S.f;
  return '<div class="ctrls ' + cls + '"><input class="fld" type="search" data-q placeholder="Search heroes" aria-label="Search heroes" value="' + esc(f.q) + '">' +
    '<div><span class="lab" style="margin-bottom:4px">Branch</span><div class="chips">' + ['Army', 'Navy', 'Air Force'].map(function (b) { return '<button class="chipbtn" type="button" data-br="' + b + '" aria-pressed="' + !!f.br[b] + '">' + b + '</button>'; }).join('') + '</div></div>' +
    '<div><span class="lab" style="margin-bottom:4px">Sort by</span><div class="chips">' + [['score', 'Strength'], ['lv', 'Level'], ['name', 'Name']].map(function (s) { return '<button class="chipbtn" type="button" data-sort="' + s[0] + '" aria-pressed="' + (f.sort === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div></div></div>';
}
/* the game table's short stat names, written out: "AF DMG+" reads "Air Force DMG increase" */
function statLabel(n) {
  var x = /^(Army|Navy|AF) (DMG\+|DMG-|ATK|HP|DEF)$/.exec(n);
  if (!x) return n;
  return (x[1] === 'AF' ? 'Air Force' : x[1]) + ' ' + { 'DMG+': 'DMG increase', 'DMG-': 'Decreased DMG Taken', ATK: 'Attack', HP: 'HP', DEF: 'Defense' }[x[2]];
}
function gearCard(h, p, showHero) {
  var r = p.rune;
  var rune = r ? '<div class="g-rune">' + art(BASE + 'rune-icons/' + r.icon + '.png', 'ico q5', r.name.charAt(0), '') + '<div><div class="rn">' + nm(r.name) + '</div>' + stars(r.s, r.sm) + '</div></div>' : '<div class="g-rune muted t13">No rune</div>';
  var stats = p.stats.map(function (s) {
    var pct = Math.round(core.moves.rollPct(s.v, s.m)), val = (s.v / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
    return '<div class="st"><div class="st-1">' + esc(statLabel(s.label)) + '</div><div class="st-2"><div class="meter r-' + ramp(pct) + '"><i style="width:' + pct + '%"></i></div><span class="sv" translate="no">' + val + '</span><span class="pc c-' + ramp(pct) + '" translate="no">' + pct + '%</span></div></div>';
  }).join('');
  var q = qCls(p.q);
  return '<div class="gcard ' + q + '" id="g-' + esc(h.id) + '-' + esc(p.slot) + '">' + (showHero ? '<div class="g-hero" translate="no">' + esc(h.name) + '</div>' : '') + '<div class="g-top">' + art(BASE + 'titan-slot-icons/gear_' + esc(p.slot) + '.png', 'ico g-ico ' + q, String(p.slot), '') +
    '<div><div class="g-n" translate="no">' + esc(p.slotName).replace(/([^\s]+-[^\s]+)/g, function (m) { return m.replace(/-/g, '‑'); }) + '</div>' + (p.level != null ? '<div class="g-s">Level ' + nm(String(p.level)) + '</div>' : '') + '</div></div>' + rune + stats + '</div>';
}
function heroRow(h) {
  var open = !!S.open[h.id];
  return '<article class="hero' + (open ? ' open' : '') + '" id="h-' + esc(h.id) + '"><button class="hrow" type="button" aria-expanded="' + open + '" aria-controls="hp-' + esc(h.id) + '" data-hero="' + esc(h.id) + '">' + art(h.icon, 'por', h.name.charAt(0), '') +
    '<span class="hb"><span class="hb-1"><span class="hb-n" translate="no">' + esc(h.name) + '</span>' + branchPill(h.branch) + '</span><span class="hb-2" style="display:block">Level ' + nm(String(h.lv)) + ' &middot; ' + nm(String(h.pieces.length)) + ' of ' + nm('6') + ' gear equipped</span></span>' +
    '<span class="hr-score"><span class="n disp" style="display:block" translate="no">' + fmtK(h.score) + '</span><span class="l" style="display:block">gear score</span></span>' + ic('down', 'chev') + '</button>' +
    '<div class="panel" id="hp-' + esc(h.id) + '"><div><div class="gears">' + h.pieces.map(function (p) { return gearCard(h, p); }).join('') + '</div></div></div></article>';
}
function setHeroOpen(id, on) {
  var a = document.getElementById('h-' + id); if (!a) return;
  a.classList.toggle('open', on); $('.hrow', a).setAttribute('aria-expanded', on ? 'true' : 'false');
}
function filt(list, get) {
  var f = S.f, q = f.q.trim().toLowerCase(), any = Object.keys(f.br).some(function (k) { return f.br[k]; });
  return list.filter(function (x) { return (!q || get(x).name.toLowerCase().indexOf(q) >= 0) && (!any || f.br[get(x).branch]); });
}
function sortBy(list, get) {
  var k = S.f.sort;
  return list.slice().sort(function (a, b) {
    a = get(a); b = get(b);
    if (k === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    return (b[k] - a[k]) || (a.name < b.name ? -1 : 1);
  });
}
function battleList() {
  var l = sortBy(filt(S.vm.heroes.list, function (x) { return x; }), function (x) { return x; });
  var el = $('#heroList'); if (!el) return;
  el.innerHTML = l.length ? l.map(heroRow).join('') : '<div class="empty">' + (S.vm.heroes.list.length ? 'No heroes match. <button class="tb link" type="button" data-clearf>Clear filters</button>' : 'No heroes with gear in these battle reports.') + '</div>';
  var nf = (S.f.q.trim() ? 1 : 0) + Object.keys(S.f.br).filter(function (k) { return S.f.br[k]; }).length;
  $$('.fbtn').forEach(function (b) { b.lastChild.textContent = 'Filter \u00B7 Sort' + (nf ? ' (' + nf + ')' : ''); });
  var c = $('#heroCount'); if (c) c.innerHTML = nd(l.length + ' heroes');
}
function renderHeroes() {
  var n = S.vm.heroes.list.length;
  $('#v-heroes').innerHTML = segs('heroes') +
    '<div class="vb" data-pane="battle"><div class="sechead"><h2 class="title">Heroes in battle reports</h2></div><div class="fbar"><div class="grow t13 muted" id="heroCount">' + nd(n + ' heroes') + '</div><button class="btn fbtn" type="button" data-open="filter">' + ic('sliders', 'sm') + 'Filter \u00B7 Sort</button>' + ctrls('inl') + '</div><div id="heroList"></div></div>' +
    '<div class="vb" data-pane="roster" hidden><div class="fbar"><div class="grow t13 muted" id="rosterCount"></div><button class="btn fbtn" type="button" data-open="filter">' + ic('sliders', 'sm') + 'Filter \u00B7 Sort</button>' + ctrls('inl') + '</div><div id="rosterList"></div></div>' +
    '<div class="vb" data-pane="gear" hidden><div id="gearTop"></div><div id="gearBody"></div></div>' +
    '<div class="vb" data-pane="advice" hidden><div id="adviceBody"></div></div>';
  battleList();
}

/* ---------- Base, Beasts, HT ---------- */

/* ---------- the advice index: one GET per load, shared by the segment dot and the Advice screen ---------- */
function paintDot() { $$('#v-heroes .segs button[data-seg="advice"], #bar a[data-v="heroes"], #tabsIn a[data-v="heroes"]').forEach(function (b) { b.classList.toggle('has-new', !!S.advDot); }); }
function advIndex(fresh) {
  var key = sk();
  if (!key) return Promise.resolve(null);
  if (!fresh && S.idxP && S.idxKey === key) return S.idxP;
  S.idxKey = key;
  S.idxP = fetch(WORKER + '/advisor/index/' + key, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
    var e = j && Array.isArray(j.entries) ? j.entries : [];
    if (S.res && S.res.identity && S.res.identity.isOwn && !S.res.readOnly && !S.advise) {
      S.advDot = e.some(function (x) { return Array.isArray(x.plans) && x.plans.length ? x.plans.some(function (p) { return !p.applied; }) : x.status === 'planned'; });
      paintDot();
    }
    return { entries: e, ok: !!j };
  });
  return S.idxP;
}

/* ---------- sheets ---------- */
function openSheet(kind, arg) {
  var title = '', body = '', isName = false;
  if (kind === 'filter') { title = 'Filter and sort'; body = ctrls('') + '<button class="btn" type="button" data-close style="width:100%">Done</button>'; }
  else if (kind === 'htfilter') {
    if (!HT.m) { ht(function () { openSheet(kind, arg); }); return; }
    var rh = HT.m.sheet(); if (!rh) return;
    title = rh[0]; body = rh[1];
  } else if (kind === 'bstfilter' || kind === 'beast') {
    if (!BT.m) { bst(function () { openSheet(kind, arg); }); return; }
    var rb = BT.m.sheet(kind, arg); if (!rb) return;
    title = rb[0]; body = rb[1]; isName = !!rb[2];
  } else if (/^advice/.test(kind)) {
    if (!Av) { advice(function () { openSheet(kind, arg); }); return; }
    var ra = Av.sheet(kind, arg); if (!ra) return;
    title = ra[0]; body = ra[1]; isName = !!ra[2];
  } else {
    if (!M) { more(function () { openSheet(kind, arg); }); return; }
    var r = M.sheet(kind, arg); if (!r) return;
    title = r[0]; body = r[1]; isName = !!r[2];
  }
  S.lastFocus = document.activeElement;
  $('#sheetT').innerHTML = isName ? nm(title) : esc(title);
  $('#sheetB').innerHTML = body;
  var sc = $('#scrim'), sh = $('#sheet');
  sc.hidden = false; sh.hidden = false; S.sheet = kind;
  void sh.offsetWidth;
  sc.classList.add('open'); sh.classList.add('open');
  $('#sheetB').scrollTop = 0;
  var f = $('#sheetT'); f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true });
}
function closeSheet(instant) {
  if (!S.sheet) return;
  var sc = $('#scrim'), sh = $('#sheet');
  sc.classList.remove('open'); sh.classList.remove('open');
  S.sheet = null; S.confirm = '';
  var fin = function () { if (!S.sheet) { sc.hidden = true; sh.hidden = true; } };
  if (instant) fin(); else setTimeout(fin, 170);
  if (S.lastFocus && S.lastFocus.focus) { try { S.lastFocus.focus({ preventScroll: true }); } catch (e) {} }
}
function refreshSheet() { if (M && (S.sheet === 'status' || S.sheet === 'settings')) $('#sheetB').innerHTML = M.sheet(S.sheet)[1]; }

/* ---------- Share ---------- */
function currentCode() {
  if (S.code) return S.code;
  var s = savedReport(); return s && s.shortcode ? s.shortcode : null;
}

/* ---------- Status actions ---------- */

/* ---------- events ---------- */
document.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.fb != null) {
    var s = document.createElement('span'); s.className = t.className + ' fb'; s.textContent = t.dataset.fb;
    if (t.getAttribute('style')) s.setAttribute('style', t.getAttribute('style'));
    s.setAttribute('translate', 'no'); t.replaceWith(s);
  }
}, true);
document.addEventListener('click', function (e) {
  var t = e.target.closest('button, a, [data-close]');
  var pp = $('#pagesPop');
  if (!e.target.closest('.pop-wrap') && pp && !pp.hidden) { pp.hidden = true; $('#pagesBtn').setAttribute('aria-expanded', 'false'); }
  if (e.target.closest('#scrim')) { closeSheet(); return; }
  if (!t) return;
  var ds = t.dataset;
  if (t.id === 'pagesBtn') { pp.hidden = !pp.hidden; t.setAttribute('aria-expanded', pp.hidden ? 'false' : 'true'); return; }
  if (t.hasAttribute('data-close')) { closeSheet(); return; }
  if (t.hasAttribute('data-share')) { share(); return; }
  if (t.hasAttribute('data-fb')) { var fb = document.getElementById('fw-hdr-btn'); if (fb) { closeSheet(true); fb.click(); } else toast('Feedback is not available right now'); return; }
  if (ds.open) { e.preventDefault(); if (ds.open === 'bag' && t.tagName === 'A') { go('bag'); return; } openSheet(ds.open); return; }
  if (ds.explain) { openSheet('explain', ds.explain); return; }
  if (ds.go) { go(ds.go); return; }
  if (ds.hero) { var id = +ds.hero, on = !S.open[id]; S.open[id] = on; setHeroOpen(id, on); return; }
  if (ds.showall) { S.all[ds.showall] = true; if (M) { if (ds.showall === 'roster') M.rosterList(); else if (ds.showall === 'decor') M.renderBase(); else M.gearBody(); } return; }
  if (ds.br !== undefined) { S.f.br[ds.br] = !S.f.br[ds.br]; $$('[data-br="' + ds.br + '"]').forEach(function (b) { b.setAttribute('aria-pressed', S.f.br[ds.br] ? 'true' : 'false'); }); battleList(); if (M) M.rosterList(); return; }
  if (ds.sort) { S.f.sort = ds.sort; $$('[data-sort]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.sort === ds.sort ? 'true' : 'false'); }); battleList(); if (M) M.rosterList(); return; }
  if ('clearf' in ds) { S.f = { q: '', br: {}, sort: S.f.sort }; renderHeroes(); if (M) M.rosterList(); return; }
  if (ds.gview) { S.gview = ds.gview; if (M) M.renderGear(); return; }
  if (ds.gslot !== undefined) { S.gslot = +ds.gslot; if (M) M.renderGear(); return; }
  if (M ? M.owns(t) : ['load', 'pick', 'code', 'verify', 'addrep', 'rm', 'rmno', 'rmyes', 'sw', 'swno', 'swyes', 'mine', 'reload'].some(function (k) { return k in ds; })) { more(function (m) { m.click(t); }); return; }
  if (t.classList.contains('chipbtn') && !ds.br && !ds.sort) { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); }
});
document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.hasAttribute && t.hasAttribute('data-q')) { S.f.q = t.value; $$('[data-q]').forEach(function (x) { if (x !== t) x.value = t.value; }); battleList(); if (M) M.rosterList(); }
});
document.addEventListener('change', function (e) {
  if (e.target.hasAttribute && e.target.hasAttribute('data-gslotsel')) { S.gslot = +e.target.value || 0; if (M) M.gearBody(); return; }
  if (e.target.id === 'langSel') { var c = e.target.value; ls('langOverride', c); if (window.applyLangToCombo) window.applyLangToCombo(c, 200); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && M && /^(rid|uidIn|repIn)$/.test(e.target.id)) { M.enter(e.target.id); return; }
  if (e.key === 'Escape') {
    if (S.sheet) { closeSheet(); return; }
    var pp = $('#pagesPop'); if (pp && !pp.hidden) { pp.hidden = true; $('#pagesBtn').setAttribute('aria-expanded', 'false'); $('#pagesBtn').focus(); }
  }
  if (e.key === 'Tab' && S.sheet) {
    var f = $$('button, input, select, textarea, a[href]', $('#sheet')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#sheetT'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
window.addEventListener('hashchange', function () { if (!shim()) applyRoute(false); });

H = { renderOverview: renderOverview, beastMove: beastMove, S: S, d: d, core: core, G: G, BASE: BASE, statLabel: statLabel, WORKER: WORKER, SK_RE: SK_RE, $: $, $$: $$, esc: esc, nd: nd, nm: nm, ic: ic, fmtK: fmtK, fmtInt: fmtInt, ramp: ramp, qCls: qCls, slug: slug, ls: ls, stars: stars, art: art, lbl: lbl, stateName: stateName, sk: sk, readOnly: readOnly, classicUrl: classicUrl, savedReport: savedReport, deviceId: deviceId, toast: toast, go: go, run: run, showSkeleton: showSkeleton, fkHero: fkHero, refreshSheet: refreshSheet, currentCode: currentCode, gearCard: gearCard, branchPill: branchPill, filt: filt, sortBy: sortBy, openSheet: openSheet, closeSheet: closeSheet, advice: advice, more: more, advIndex: advIndex, paintDot: paintDot };
window.__arm = { S: S, d: d, core: core, go: go, openSheet: openSheet, closeSheet: closeSheet, applyRoute: applyRoute, parseHash: parseHash, VIEWS: VIEWS, ready: false };
boot();
if (/[?&]check=1/.test(location.search)) { var cs = document.createElement('script'); cs.src = 'armory-check.js'; document.body.appendChild(cs); }
})();
