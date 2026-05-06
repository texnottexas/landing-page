'use strict';
window.WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
window.ALLIANCES = ['DOG', 'MSS', 'Cat+'];

function mk(tag, opts) {
  var el = document.createElement(tag);
  if (opts) {
    if (opts.cls) el.className = opts.cls;
    if (opts.text != null) el.textContent = String(opts.text);
    if (opts.attrs) Object.keys(opts.attrs).forEach(function(k) { el.setAttribute(k, String(opts.attrs[k])); });
    if (opts.props) Object.keys(opts.props).forEach(function(k) { el[k] = opts.props[k]; });
    if (opts.style) Object.keys(opts.style).forEach(function(k) { el.style[k] = opts.style[k]; });
    if (opts.dataset) Object.keys(opts.dataset).forEach(function(k) { el.dataset[k] = String(opts.dataset[k]); });
    if (opts.on) Object.keys(opts.on).forEach(function(k) { el.addEventListener(k, opts.on[k]); });
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null) continue;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}
function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// Resolve an avatar value (CDN URL, in-game asset key, or null) to a usable
// <img src>. Asset keys like "hero_icon330_global" or "icon_man02_1" route
// through the topwargame headpic CDN. Pattern lifted from treasury.html.
function resolveAvatar(v) {
  if (!v || typeof v !== 'string') return null;
  if (v.indexOf('http') === 0) return v;
  return 'https://h5.topwargame.com/DynRes/images/headpic/' + v + '.png?t=21.jpg';
}

// Build an avatar <img> with onerror fallback to the default placeholder div.
function avatarImg(p, size) {
  var src = resolveAvatar(p && (p.avatar || p.avatarRef || p.avatarurl));
  var sz = size || 48;
  if (!src) return placeholderAvatar(sz);
  var img = mk('img', { attrs: { src: src, alt: '', loading: 'lazy' } });
  img.addEventListener('error', function() {
    if (img.parentNode) img.parentNode.replaceChild(placeholderAvatar(sz), img);
  });
  return img;
}

function placeholderAvatar(size) {
  var sz = (size || 48) + 'px';
  return mk('div', { style: { width: sz, height: sz, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '50%' } });
}
function svgIcon(id, cls) {
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icon ' + (cls || ''));
  var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#' + id);
  s.appendChild(u);
  return s;
}

// Roster has "DOG*" / "MSS*" / "Cat+" / "DEV*". Strip the trailing asterisk
// to get the canonical alliance form used for tabs, KV writes, and matching.
function canonAlliance(s) {
  if (typeof s !== 'string') return null;
  var t = s.replace(/\*+$/, '');
  return ['DOG','MSS','Cat+'].indexOf(t) >= 0 ? t : null;
}

// ── Identity ────────────────────────────────────────────
function getIdentity() {
  try {
    var raw = localStorage.getItem('playerIdentity');
    if (!raw) return null;
    var v = JSON.parse(raw);
    if (!v.siteKey) return null;
    return v;
  } catch (e) { return null; }
}

async function loadRoster() {
  var r = await fetch('/player-data.json', { cache: 'no-store' });
  if (!r.ok) return [];
  return await r.json();
}

// ── Local-time helpers ──────────────────────────────────
function slotLocalLabel(slot) {
  var now = new Date();
  var resetUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 0, 0);
  if (now.getTime() > resetUtc) resetUtc += 86400 * 1000;
  var slotUtc = resetUtc + slot * 3600 * 1000;
  return new Date(slotUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── App state ───────────────────────────────────────────
var state = { alliance: 'DOG', identity: null, roster: null, status: null };

// ── Render ──────────────────────────────────────────────
function render() {
  var root = document.getElementById('root');
  clearChildren(root);
  if (state.status && state.status.eventOver) {
    root.appendChild(mk('div', { cls: 'banner-end', text: 'Event ended — thanks for riding the train this season.' }));
  }

  var tabs = mk('div', { cls: 'alliance-tabs' });
  window.ALLIANCES.forEach(function(a) {
    tabs.appendChild(mk('button', {
      cls: a === state.alliance ? 'active' : '',
      text: a,
      on: { click: function() { state.alliance = a; render(); } }
    }));
  });
  root.appendChild(tabs);

  if (!state.status) { root.appendChild(mk('p', { cls: 'card', text: 'Loading status…' })); return; }
  var info = state.status.alliances[state.alliance];
  if (!info) { root.appendChild(mk('p', { cls: 'card', text: 'No data for ' + state.alliance })); return; }

  // Next train card + forecast
  var todayCard = mk('div', { cls: 'card' });
  todayCard.appendChild(mk('h2', null, svgIcon('i-train'), 'Next train — ' + state.alliance));
  if (info.pending && info.pending.cap && info.pending.vip) {
    var slotDate = new Date(info.pending.slotUtc * 1000);
    var slotStr = slotDate.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    todayCard.appendChild(mk('p', null,
      mk('strong', { text: 'Captain: ' }),
      info.pending.cap.name + ' (slot +' + info.pending.cap.slot + ' → ' + slotStr + ')'
    ));
    todayCard.appendChild(mk('p', null, mk('strong', { text: 'VIP: ' }), info.pending.vip.name));
    var me = state.status.me;
    if (me && info.pending.cap.sitekey === me.sitekey) {
      todayCard.appendChild(mk('button', { cls: 'primary', text: 'Swap VIP', on: { click: openSwapVipModal } }));
    }
  } else {
    todayCard.appendChild(mk('p', {
      text: info.signupCount < 2 ? 'Need at least 2 signups before train can run.' : 'Awaiting next pick (15:45 UTC).'
    }));
  }
  // 5-day forecast
  var forecast = info.forecast || [];
  if (forecast.length) {
    var fcWrap = mk('details', { style: { marginTop: '12px' } });
    fcWrap.appendChild(mk('summary', { style: { cursor: 'pointer', color: 'var(--muted)' }, text: 'Upcoming days (forecast →)' }));
    var fcList = mk('div', { style: { marginTop: '8px', display: 'grid', gap: '6px' } });
    forecast.forEach(function(f) {
      var dt = new Date(f.slotUtc * 1000);
      var label = dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' +
                  dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var row = mk('div', { style: { padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' } });
      row.appendChild(mk('div', { style: { color: 'var(--muted)', fontSize: '11px' }, text: label + ' · slot +' + f.cap.slot + 'h' }));
      row.appendChild(mk('div', null, mk('strong', { text: 'Cap: ' }), f.cap.name, '  ', mk('strong', { text: 'VIP: ' }), f.vip.name));
      fcList.appendChild(row);
    });
    fcWrap.appendChild(fcList);
    todayCard.appendChild(fcWrap);
    todayCard.appendChild(mk('p', { style: { fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }, text: 'Forecast is informational — actual picks fire daily at 15:45 UTC and may shift if signups change.' }));
  }
  root.appendChild(todayCard);

  // My signup card
  var meCard = mk('div', { cls: 'card' });
  meCard.appendChild(mk('h2', null, svgIcon('i-shield'), 'My signup'));
  if (!state.identity) {
    meCard.appendChild(mk('p', { text: 'Set up your identity on the home page first to sign up.' }));
    var goHome = mk('a', { attrs: { href: '/index.html' }, text: 'Go to home →' });
    goHome.style.color = 'var(--accent)';
    meCard.appendChild(goHome);
  } else if (state.status.me && !state.status.me.optedOut) {
    var me2 = state.status.me;
    meCard.appendChild(mk('p', null,
      svgIcon('i-check'),
      ' Signed up · Slot +' + me2.preferredSlot +
      ' · Cap rides: ' + me2.capRideCount +
      ' · VIP rides: ' + me2.vipRideCount
    ));
    meCard.appendChild(mk('button', { cls: 'danger', on: { click: cancelSignup } },
      svgIcon('i-x-circle'), ' Cancel signup'));
    var hist = (state.status.me && state.status.me.history) || [];
    if (hist.length) {
      var histWrap = mk('details', { style: { marginTop: '12px' } });
      histWrap.appendChild(mk('summary', { style: { cursor: 'pointer', color: 'var(--muted)' }, text: 'My ride history (' + hist.length + ')' }));
      var histList = mk('div', { style: { marginTop: '8px', display: 'grid', gap: '4px' } });
      hist.forEach(function(h) {
        var d = h.date ? (h.date.slice(0,4) + '-' + h.date.slice(4,6) + '-' + h.date.slice(6,8)) : '?';
        var row = mk('div', { style: { padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '12px' } });
        row.appendChild(mk('span', { text: d }));
        row.appendChild(mk('span', { style: { marginLeft: '12px', color: 'var(--accent)', fontWeight: '600' }, text: h.role.toUpperCase() }));
        row.appendChild(mk('span', { style: { marginLeft: '12px', color: 'var(--muted)' }, text: h.alliance }));
        histList.appendChild(row);
      });
      histWrap.appendChild(histList);
      meCard.appendChild(histWrap);
    }
  } else if (!state.status.eventOver) {
    meCard.appendChild(mk('button', { cls: 'primary', text: 'Sign me up', on: { click: openSignupModal } }));
  }
  root.appendChild(meCard);

  // Not-signed-up roster grid (collapsible, default closed)
  var gapCard = mk('div', { cls: 'card' });
  var allianceRoster = (state.roster || []).filter(function(p) { return canonAlliance(p.alliance) === state.alliance; });
  var signedSitekeys = {};
  (info.signups || []).forEach(function(s) { signedSitekeys[s.sitekey] = true; });
  var missing = allianceRoster.filter(function(p) { return !p.siteKey || !signedSitekeys[p.siteKey]; });
  // Use plain h2 + onclick toggle — iOS Safari has historical issues with
  // <summary display:flex> not toggling. This is a reliable manual toggle.
  var hdr = mk('h2', { style: { cursor: 'pointer', userSelect: 'none', margin: '0' } });
  var chev = svgIcon('i-chev-down');
  chev.style.transition = 'transform .15s';
  chev.style.transform = 'rotate(-90deg)';
  hdr.appendChild(chev);
  hdr.appendChild(document.createTextNode('Not signed up — ' + state.alliance + ': ' + missing.length + '/' + allianceRoster.length));
  var grid = mk('div', { cls: 'roster-grid', style: { marginTop: '12px', display: 'none' } });
  missing.forEach(function(p) {
    var cell = mk('div', { cls: 'roster-cell' });
    cell.appendChild(avatarImg(p));
    cell.appendChild(mk('span', { text: (p.name || '?').slice(0, 12) }));
    grid.appendChild(cell);
  });
  hdr.addEventListener('click', function() {
    var open = grid.style.display !== 'none';
    grid.style.display = open ? 'none' : 'grid';
    chev.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
  });
  gapCard.appendChild(hdr);
  gapCard.appendChild(grid);
  root.appendChild(gapCard);
}

// ── Platform detection ──────────────────────────────────
function detectPlatform() {
  var ua = navigator.userAgent;
  var isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  return { isMobile: isMobile, isStandalone: isStandalone, isMobileBrowser: isMobile && !isStandalone, isDesktop: !isMobile };
}

// ── Signup modal ────────────────────────────────────────
async function openSignupModal() {
  if (!state.identity) {
    alert('Identity required. Visit the home page first to set your siteKey.');
    return;
  }
  var modalBg = mk('div', { cls: 'modal-bg show' });
  var modal = mk('div', { cls: 'modal' });
  modal.appendChild(mk('h2', { text: 'Sign up for the Train' }));
  modal.appendChild(mk('p', null,
    mk('strong', null, 'Name: '), state.identity.name || '?',
    ' · ',
    mk('strong', null, 'Alliance: '), state.identity.alliance || '?'
  ));
  modal.appendChild(mk('p', { text: 'Pick your preferred slot. Train runs from Reset to Reset +4 (16:00–20:00 UTC).' }));

  var picked = 0;
  var slotPicker = mk('div', { cls: 'slot-picker' });
  [0, 1, 2, 3, 4].forEach(function(s) {
    var btn = mk('button', null,
      mk('span', { text: '+' + s + 'h' }),
      mk('span', { cls: 'slot-time', text: slotLocalLabel(s) + ' local' })
    );
    if (s === picked) btn.classList.add('selected');
    btn.addEventListener('click', function() {
      Array.prototype.forEach.call(slotPicker.children, function(c) { c.classList.remove('selected'); });
      btn.classList.add('selected');
      picked = s;
    });
    slotPicker.appendChild(btn);
  });
  modal.appendChild(slotPicker);

  // PWA / notification advisory (non-blocking)
  var p = detectPlatform();
  var notifyOK = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
  var advisory = mk('div', { style: { marginTop: '12px' } });
  if (p.isMobileBrowser) {
    advisory.appendChild(mk('div', { cls: 'banner-warn' },
      svgIcon('i-phone'),
      mk('span', null,
        ' Mobile browsers can\'t reliably receive push. ',
        mk('strong', null, 'Install as PWA'),
        ' first: tap Share → Add to Home Screen. You can sign up either way.'
      )
    ));
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    advisory.appendChild(mk('div', { cls: 'banner-warn' },
      svgIcon('i-bell-slash'),
      mk('span', { text: ' Notifications blocked. Sign up still works; you just won\'t get the 15-min reminder.' })
    ));
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    var enableBtn = mk('button', { cls: 'primary', text: 'Enable notifications', style: { marginTop: '8px' } });
    enableBtn.addEventListener('click', async function() {
      var perm = await Notification.requestPermission();
      if (perm === 'granted') {
        notifyOK = true;
        clearChildren(enableBtn);
        enableBtn.appendChild(svgIcon('i-check'));
        enableBtn.appendChild(document.createTextNode(' Notifications enabled'));
        enableBtn.disabled = true;
      }
    });
    advisory.appendChild(enableBtn);
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    advisory.appendChild(mk('p', null, svgIcon('i-check'), ' Notifications ready'));
  }
  modal.appendChild(advisory);

  var btnRow = mk('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' } });
  btnRow.appendChild(mk('button', { cls: 'danger', text: 'Cancel', on: { click: function() { document.body.removeChild(modalBg); } } }));
  var submit = mk('button', { cls: 'primary', text: 'Confirm signup' });
  submit.addEventListener('click', async function() {
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      var r = await fetch(window.WORKER + '/train/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sitekey: state.identity.siteKey,
          name: state.identity.name,
          alliance: canonAlliance(state.identity.alliance) || state.alliance,
          preferredSlot: picked,
          notifyOK: !!notifyOK,
        })
      });
      var data = await r.json();
      if (!r.ok) {
        alert('Signup failed: ' + (data.error || r.status));
        submit.disabled = false;
        submit.textContent = 'Confirm signup';
        return;
      }
    } catch (e) {
      alert('Signup error: ' + (e && e.message || 'unknown'));
      submit.disabled = false;
      submit.textContent = 'Confirm signup';
      return;
    }
    document.body.removeChild(modalBg);
    await refresh();
  });
  btnRow.appendChild(submit);
  modal.appendChild(btnRow);
  modalBg.appendChild(modal);
  document.body.appendChild(modalBg);
}

// ── Captain VIP-swap modal ──────────────────────────────
async function openSwapVipModal() {
  var info = state.status.alliances[state.alliance];
  if (!info || !info.pending || !info.pending.cap) return;

  var modalBg = mk('div', { cls: 'modal-bg show' });
  var modal = mk('div', { cls: 'modal' });
  modal.appendChild(mk('h2', { text: 'Swap VIP — ' + state.alliance }));
  modal.appendChild(mk('p', { text: 'Current VIP: ' + info.pending.vip.name + '. Pick a replacement (one swap per ride).' }));

  var grid = mk('div', { cls: 'roster-grid' });
  var eligible = (info.signups || [])
    .filter(function(s) { return s.sitekey !== info.pending.cap.sitekey; })
    .sort(function(a, b) { return (a.vipRideCount || 0) - (b.vipRideCount || 0); });
  var rosterMap = {};
  (state.roster || []).forEach(function(p) { if (p.siteKey) rosterMap[p.siteKey] = p; });

  eligible.forEach(function(s) {
    var p = rosterMap[s.sitekey] || {};
    var cell = mk('div', {
      cls: 'roster-cell',
      style: { cursor: 'pointer' },
      on: {
        click: async function() {
          if (!confirm('Swap VIP to ' + s.name + '?')) return;
          try {
            var r = await fetch(window.WORKER + '/train/swap-vip', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sitekey: state.identity.siteKey, targetSitekey: s.sitekey })
            });
            var data = await r.json();
            if (!r.ok) { alert('Swap failed: ' + (data.error || r.status)); return; }
          } catch (e) {
            alert('Swap error: ' + (e && e.message || 'unknown'));
            return;
          }
          document.body.removeChild(modalBg);
          await refresh();
        }
      }
    });
    cell.appendChild(avatarImg(p));
    cell.appendChild(mk('span', { text: (s.name || '?').slice(0, 12) }));
    cell.appendChild(mk('span', { cls: 'slot-time', text: 'VIP rides: ' + (s.vipRideCount || 0) }));
    grid.appendChild(cell);
  });
  modal.appendChild(grid);
  modal.appendChild(mk('button', {
    cls: 'danger',
    text: 'Cancel',
    style: { marginTop: '12px' },
    on: { click: function() { document.body.removeChild(modalBg); } }
  }));
  modalBg.appendChild(modal);
  document.body.appendChild(modalBg);
}

// ── Cancel ──────────────────────────────────────────────
async function cancelSignup() {
  if (!state.identity) return;
  if (!confirm('Cancel your signup? Your ride history is preserved.')) return;
  try {
    await fetch(window.WORKER + '/train/cancel-signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sitekey: state.identity.siteKey })
    });
  } catch (e) {}
  await refresh();
}

// ── Settings modal ──────────────────────────────────────
async function hardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < regs.length; i++) { try { await regs[i].unregister(); } catch (e) {} }
    }
    if ('caches' in window) {
      var keys = await caches.keys();
      for (var j = 0; j < keys.length; j++) { try { await caches.delete(keys[j]); } catch (e) {} }
    }
  } catch (e) {}
  // Cache-bust query param + reload
  var u = new URL(window.location.href);
  u.searchParams.set('_t', String(Date.now()));
  window.location.replace(u.toString());
}

window.openSettingsModal = function openSettingsModal() {
  var modalBg = mk('div', { cls: 'modal-bg show' });
  function close() { if (modalBg.parentNode) modalBg.parentNode.removeChild(modalBg); }
  // Click outside modal closes it
  modalBg.addEventListener('click', function(e) { if (e.target === modalBg) close(); });

  var modal = mk('div', { cls: 'modal' });
  // Title row
  var titleRow = mk('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } });
  titleRow.appendChild(svgIcon('i-gear'));
  titleRow.appendChild(mk('h2', { style: { margin: '0' }, text: 'Settings' }));
  var closeX = mk('button', {
    style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex' },
    attrs: { 'aria-label': 'Close' },
    on: { click: close }
  });
  closeX.appendChild(svgIcon('i-x-circle'));
  titleRow.appendChild(closeX);
  modal.appendChild(titleRow);

  // Identity section
  modal.appendChild(mk('div', { style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }, text: 'Identity' }));
  if (state.identity) {
    var idBox = mk('div', { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', marginTop: '6px', fontSize: '13px' } });
    idBox.appendChild(mk('div', null, mk('strong', null, 'Name: '), state.identity.name || '?'));
    idBox.appendChild(mk('div', null, mk('strong', null, 'Alliance: '), state.identity.alliance || '?'));
    idBox.appendChild(mk('div', { style: { fontFamily: 'monospace', fontSize: '11px', color: 'var(--muted)', marginTop: '4px', wordBreak: 'break-all' } }, mk('strong', null, 'siteKey: '), state.identity.siteKey || '?'));
    modal.appendChild(idBox);
    modal.appendChild(mk('p', { style: { fontSize: '11px', color: 'var(--muted)', margin: '8px 0' }, text: 'If your name/alliance is wrong, re-verify your in-game UID on the home page.' }));
    modal.appendChild(mk('button', {
      cls: 'primary',
      text: 'Open home to re-verify UID',
      on: { click: function() { window.location.href = '/index.html'; } }
    }));
  } else {
    modal.appendChild(mk('p', { style: { color: 'var(--muted)', fontSize: '13px', margin: '6px 0' }, text: 'No identity set. Visit the home page to verify your UID.' }));
  }

  // Hard refresh section
  modal.appendChild(mk('div', { style: { marginTop: '20px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }, text: 'Cache' }));
  modal.appendChild(mk('p', { style: { fontSize: '12px', color: 'var(--muted)', margin: '6px 0' }, text: 'If something looks stuck or stale, clear the page cache + service worker and reload.' }));
  modal.appendChild(mk('button', { cls: 'primary', text: 'Hard refresh', on: { click: hardRefresh } }));

  // Full ride history
  modal.appendChild(mk('div', { style: { marginTop: '20px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }, text: 'My ride history' }));
  var hist = (state.status && state.status.me && state.status.me.history) || [];
  if (hist.length === 0) {
    modal.appendChild(mk('p', { style: { color: 'var(--muted)', fontSize: '13px', margin: '6px 0' }, text: 'No rides yet.' }));
  } else {
    var histList = mk('div', { style: { marginTop: '6px', display: 'grid', gap: '4px', maxHeight: '300px', overflow: 'auto' } });
    hist.forEach(function(h) {
      var d = h.date ? (h.date.slice(0,4) + '-' + h.date.slice(4,6) + '-' + h.date.slice(6,8)) : '?';
      var row = mk('div', { style: { padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '12px' } });
      row.appendChild(mk('span', { text: d }));
      row.appendChild(mk('span', { style: { color: 'var(--accent)', fontWeight: '600' }, text: (h.role || '?').toUpperCase() }));
      row.appendChild(mk('span', { style: { color: 'var(--muted)' }, text: h.alliance || '' }));
      if (h.slotUtc) {
        var dt = new Date(h.slotUtc * 1000);
        row.appendChild(mk('span', { style: { color: 'var(--muted)', marginLeft: 'auto', fontSize: '11px' }, text: dt.toLocaleString([], { hour: '2-digit', minute: '2-digit' }) + ' UTC' }));
      }
      histList.appendChild(row);
    });
    modal.appendChild(histList);
  }

  // Close (footer)
  modal.appendChild(mk('button', { cls: 'danger', text: 'Close', style: { marginTop: '20px' }, on: { click: close } }));
  modalBg.appendChild(modal);
  document.body.appendChild(modalBg);
};

// ── Refresh + init ──────────────────────────────────────
async function refresh() {
  var sitekey = state.identity ? state.identity.siteKey : '';
  var url = window.WORKER + '/train/status' + (sitekey ? '?sitekey=' + encodeURIComponent(sitekey) : '');
  try {
    var r = await fetch(url);
    state.status = await r.json();
  } catch (e) {
    state.status = { error: String(e), alliances: {} };
  }
  render();
}

(async function init() {
  state.identity = getIdentity();
  // Default the active tab to the player's alliance (DOG*/MSS* → DOG/MSS).
  if (state.identity) {
    var canon = canonAlliance(state.identity.alliance);
    if (canon) state.alliance = canon;
  }
  state.roster = await loadRoster().catch(function() { return []; });
  await refresh();
})();
