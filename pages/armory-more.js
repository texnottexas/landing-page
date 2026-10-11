/* armory-more.js: the parts of the Armory v2 page that load on first use (not on the first paint).
 * Start / expired / error screens, the Status, Settings and Bag sheets, Share, UID verify and the report list,
 * and the Roster and Gear sections. armory-app.js loads it with one script tag the first time a
 * route, sheet or button needs it, then calls ArmoryMore(helpers). Same-origin script: no CSP change.
 */
window.ArmoryMore = function (H) {
'use strict';
var S = H.S, d = H.d, core = H.core, G = H.G, BASE = H.BASE, WORKER = H.WORKER, SK_RE = H.SK_RE;
var $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, fmtK = H.fmtK, fmtInt = H.fmtInt, ramp = H.ramp, qCls = H.qCls, slug = H.slug;
var ls = H.ls, stars = H.stars, art = H.art, lbl = H.lbl, stateName = H.stateName, sk = H.sk, readOnly = H.readOnly, classicUrl = H.classicUrl;
var savedReport = H.savedReport, deviceId = H.deviceId, toast = H.toast, go = H.go, run = H.run, showSkeleton = H.showSkeleton, refreshSheet = H.refreshSheet;
var portrait = H.portrait, awLevel = H.awLevel, currentCode = H.currentCode, gearCard = H.gearCard, branchPill = H.branchPill, filt = H.filt, sortBy = H.sortBy;

function renderStart(kind, extra) {
  document.body.classList.add('st-start');
  S.cur = null;
  $$('.view').forEach(function (s) { s.hidden = s.id !== 'v-start'; });
  var beta = ls('armory_v2_beta') === '1' ? '?beta=1' : '';
  var h;
  if (kind === 'expired' && (S.advise || (extra && extra.advice))) {
    h = '<h1 class="disp" style="font-size:var(--fs-24)">Advice link not found</h1><p class="muted">It may have expired or been mistyped. Ask the player for a new one.</p><div><a class="btn" href="armory.html' + beta + '">Open my own armory</a></div>';
  } else if (kind === 'expired') {
    h = '<h1 class="disp" style="font-size:var(--fs-24)">This share link has expired</h1><p class="muted">Ask the person who shared it for a new link, or build your own.</p><div><a class="btn" href="armory.html' + beta + '">Build my own</a></div>';
  } else if (kind === 'error') {
    h = '<h1 class="disp" style="font-size:var(--fs-24)">Could not reach the server</h1><p class="muted">Check your connection and try again.</p><div><button class="btn" type="button" data-reload>Try again</button></div>';
  } else {
    var pick = '';
    if (extra && extra.pending) {
      pick = '<h2 class="disp" style="font-size:var(--fs-20)">Which one is you?</h2><div class="picks">' + extra.pending.players.map(function (p, i) {
        return '<button class="pick" type="button" data-pick="' + i + '">' + (p.avatar ? art(p.avatar, 'ava', (p.name || '?').charAt(0), '') : '<span class="ava fb" translate="no">' + esc((p.name || '?').charAt(0)) + '</span>') + '<span translate="no" style="font-weight:600">' + esc(p.name) + '</span><span class="t13 muted">' + esc(p.side) + '</span></button>';
      }).join('') + '</div><div class="err" id="stErr" role="alert"></div>';
    } else {
      pick = '<div class="irow"><input class="fld" id="rid" data-clarity-mask="true" type="text" inputmode="numeric" autocomplete="off" placeholder="Battle Report ID" aria-label="Battle Report ID"><button class="btn" type="button" data-load>Load</button></div><div class="err" id="stErr" role="alert">' + esc(extra && extra.err || '') + '</div>' +
        '<details class="help" open><summary>Where do I find a Battle Report ID?</summary><ol><li>In the game, open a battle report from a fight against another player (Time Clash Arena works).</li><li>Tap the VS icon.</li><li>Tap the copy icon next to Report No., then paste it in the box above.</li></ol><p>On Server 2864, Snapshot can do this for you: run it in the game and tap Set up.</p></details>' +
        mineBtn() + '<h2 class="disp" style="font-size:var(--fs-20)">Or open a share link</h2><div class="irow"><input class="fld" id="scode" data-clarity-mask="true" type="text" maxlength="4" autocomplete="off" placeholder="4-letter code" aria-label="Share code"><button class="btn" type="button" data-code>Open</button></div>';
    }
    h = '<h1 class="disp" style="font-size:var(--fs-24)">Build your armory</h1>' + (extra && extra.note ? '<p>' + esc(extra.note) + '</p>' : '') + '<p class="muted">' + (extra && extra.pending ? 'Pick your player card to build your armory.' : 'Enter a Battle Report ID to build your armory.') + '</p>' + pick;
  }
  $('#v-start').hidden = false;
  $('#v-start').innerHTML = '<div class="vb"><div class="start">' + h + '</div></div>';
  if (kind !== 'expired' && kind !== 'error') H.fkHero($('#v-start .start'));
  document.title = 'Armory | Server 2864';
  $('#whoN').textContent = 'Armory'; $('#chipTxt').textContent = '';
}
function mineBtn() {
  var id = d.getStoredIdentity(), k = id && id.siteKey;
  if (!SK_RE.test(String(k || '')) || ls('armory_v2_switched') !== '1') return '';
  return '<h2 class="disp" style="font-size:var(--fs-20)">Or open your own</h2><div><button class="btn" type="button" data-mine>Open ' + nm(id.name || 'my armory') + '\u2019s armory</button></div>';
}
function loadReportId() {
  var id = ($('#rid').value || '').trim(), err = $('#stErr');
  if (!/^\d{10,25}$/.test(id)) { err.textContent = 'Enter a valid numeric report ID (10 to 25 digits).'; return; }
  var b = $('[data-load]'); b.disabled = true; b.textContent = 'Loading';
  d.fetchReportResponse(id).then(function (r) {
    if (!r || !r.ok) throw new Error(r && r.status === 404 ? 'nf' : 'net');
    return r.json();
  }).then(function (data) {
    if (!data || !data.battle) throw new Error('bad');
    var players = [];
    [['Attacker', data.battle.attacker], ['Defender', data.battle.defender]].forEach(function (s) {
      var pl = s[1] && s[1].players && s[1].players[0]; if (!pl) return;
      var pi = {}; try { pi = JSON.parse(pl.playerInfo || '{}'); } catch (e) {}
      if (pi.username) players.push({ name: pi.username, avatar: avatarOf(pi), side: s[0] });
    });
    if (!players.length) throw new Error('bad');
    renderStart('start', { pending: { id: id, players: players } });
    S.pending = { id: id, players: players };
  }).catch(function (e) {
    renderStart('start', { err: e && e.message === 'nf' ? 'Report not found. Check the ID and try again.' : e && e.message === 'bad' ? 'That is not a battle report.' : 'Could not get the report. Check your connection and try again.' });
  });
}
function avatarOf(pi) {
  var u = pi.headimgurl_custom || pi.avatarurl || null;
  if (!u) return null;
  return u.indexOf('http') === 0 ? u : 'https://h5.topwargame.com/DynRes/images/headpic/' + u + '.png?t=21.jpg';
}
function pickPlayer(i) {
  var p = S.pending && S.pending.players[i]; if (!p) return;
  var id = S.pending.id;
  showSkeleton();
  run({ reportIds: [id], player: { name: p.name }, own: true }, function (res) {
    /* v1 "Generate report": the player's own saved report, so the next visit opens straight to it */
    var cache = {}; res.reports.forEach(function (r) { cache[r.id] = r.extracted; });
    var pl = JSON.parse(JSON.stringify(res.player)); if (!pl.avatar && p.avatar) pl.avatar = p.avatar;
    var prev = savedReport(), same = prev && prev.player && prev.player.name === pl.name;   /* v1 saveAndRenderReport: marches and the share code survive a rebuild */
    var keep = { player: pl, reportIds: [id], marchGroups: same && Array.isArray(prev.marchGroups) ? prev.marchGroups : [] };
    if (same && prev.shortcode) keep.shortcode = prev.shortcode;
    ls('playerReport', JSON.stringify(keep));
    ls('playerReportData', JSON.stringify(cache));
    ls('armory_v2_switched', null); S.saved = true; S.pending = null; go('overview');
  }).then(function (res) {
    if (res && res.state !== 'ready') renderStart('start', { err: res.state === 'empty' ? 'That report could not be read for ' + p.name + '.' : 'Could not load the report.' });
  }, function () { renderStart('error'); });
}
function rosterItems() {
  var s = S.res.supp && S.res.supp.heroes, list = s && s.list || [];
  return list.filter(function (x) { return x && isFinite(+x.id); }).map(function (x) { var id = +x.id; return { id: id, name: core.heroName(id), branch: core.heroBranch(id, x.t), lv: +x.lv || 0, star: +x.star || 0, score: +x.pw || 0 }; });
}
function rosterList() {
  var el = $('#rosterList'); if (!el) return;
  var all = rosterItems();
  if (S.res.privacy && S.res.privacy.heroes) { el.innerHTML = '<div class="empty">The roster is private.</div>'; return; }
  if (!all.length) { el.innerHTML = '<div class="empty">' + 'No roster yet.' + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; return; }
  var l = sortBy(filt(all, function (x) { return x; }), function (x) { return x; }), shown = l.filter(function (x, i) { return S.all.roster || i < 12 || S.open[x.id]; }), AWV = S.vm.awaken.byId;
  el.innerHTML = shown.map(function (x) {
    var a = AWV[x.id], por = portrait(x.id, x.name, ArmoryVM.heroIcon(x.id), a), open = !!S.open[x.id];
    var sub = (a && a.aw ? nd(awLevel(a)) : 'Level ' + nm(String(x.lv))) + ' &middot; ' + nm(String(x.star)) + ' stars';
    var head = '<span class="hb"><span class="hb-1"><span class="hb-n" translate="no">' + esc(x.name) + '</span>' + branchPill(x.branch) + '</span><span class="hb-2" style="display:block">' + sub + '</span>' + (a ? H.awSkLine(a) : '') + '</span>' +
      '<span class="hr-score"><span class="n disp" style="display:block" translate="no">' + fmtK(x.score) + '</span><span class="l" style="display:block">power</span></span>';
    /* an awakened hero, or one of the six that can be, opens to its Awakening block */
    if (!a) return '<article class="hero"><div class="hrow" style="cursor:default">' + por + head + '</div></article>';
    return '<article class="hero' + (open ? ' open' : '') + '" id="rh-' + esc(x.id) + '"><button class="hrow" type="button" aria-expanded="' + open + '" aria-controls="rhp-' + esc(x.id) + '" data-hero="' + esc(x.id) + '">' + por + head + ic('down', 'chev') + '</button>' +
      '<div class="panel" id="rhp-' + esc(x.id) + '"><div><div class="awk-slot" data-awk="' + (+x.id) + '"></div></div></div></article>';
  }).join('') + (l.length > shown.length ? '<button class="btn more" type="button" data-showall="roster"><span>Show all <span translate="no">' + l.length + '</span></span></button>' : '');
  var c = $('#rosterCount'); if (c) c.innerHTML = nd(l.length + ' heroes in roster');
  H.awkSync();
}
/* #heroes/roster?hero=Name: open that hero's row (true when done or not asked, false while the roster is not loaded yet) */
function deepRoster(r) {
  if (!r || r.view !== 'heroes' || r.seg !== 'roster' || !r.q.hero) return true;
  var rh = ((S.res && S.res.supp && S.res.supp.heroes && S.res.supp.heroes.list) || []).filter(function (x) { return x && isFinite(+x.id) && core.heroName(+x.id) === r.q.hero; })[0];
  if (!rh) return false;
  S.open[+rh.id] = true; rosterList(); H.setHeroOpen(+rh.id, true); H.awkOpenHero(+rh.id);
  setTimeout(function () { var el = document.getElementById('rh-' + rh.id); if (el) el.scrollIntoView({ block: 'center' }); }, 30);
  return true;
}
function gearBody() {
  var vm = S.vm, el = $('#gearBody'); if (!el) return;
  if (S.gview === 'runes') {
    var eq = {};
    vm.heroes.list.forEach(function (h) { h.pieces.forEach(function (p) { if (p.rune) { var e = eq[p.rune.name] || (eq[p.rune.name] = { n: 0, s: 0, sm: 0, icon: p.rune.icon }); e.n++; e.s += p.rune.s; e.sm += p.rune.sm; } }); });
    var bag = vm.runes.runeBag || {}, names = {};
    Object.keys(eq).forEach(function (k) { names[k] = 1; }); Object.keys(bag).forEach(function (k) { if (bag[k] > 0) names[k] = 1; });
    var rows = Object.keys(names).sort().map(function (n) {
      var e = eq[n], inbag = +bag[n] || 0, icon = e ? e.icon : (G.RUNE_ICON[n] || slug(n));
      return '<div class="rt">' + art(BASE + 'rune-icons/' + icon + '.png', 'ico q5', n.charAt(0), '') + '<div class="rb"><div class="ra" translate="no">' + esc(n) + '</div><div class="rs">' + nd((e ? e.n + ' equipped' : '0 equipped')) + (e ? ' &middot; ' + nd(e.s + ' of ' + e.sm + ' stars') : '') + '</div></div><div class="rn"><span translate="no">' + inbag + '</span><div class="rs" style="font-family:var(--sans);font-weight:400">in bag</div></div></div>';
    }).join('');
    el.innerHTML = '<section class="card">' + (rows || '<p class="muted">No runes found in battle reports or the bag.</p>') + (vm.runes.known ? '' : '<p class="foot" style="margin-top:12px">' + nd('The bag is not in your game data, so runes in bag read 0.') + '</p>') + '</section>';
    return;
  }
  var slots = {};
  vm.heroes.list.forEach(function (h) { h.pieces.forEach(function (p) { slots[p.slot] = p.slotName; }); });
  var cards = [];
  vm.heroes.list.forEach(function (h) { h.pieces.forEach(function (p) { if (!S.gslot || S.gslot === p.slot) cards.push([h, p]); }); });
  var shown = S.all.gear ? cards : cards.slice(0, 12);
  el.innerHTML = '<select class="sel" data-gslotsel aria-label="Gear slot" style="margin-bottom:12px"><option value="0">All slots</option>' + Object.keys(slots).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (S.gslot === +k ? ' selected' : '') + ' translate="no">' + esc(slots[k]) + '</option>'; }).join('') + '</select>' +
    (shown.length ? '<div class="gears" style="padding:0">' + shown.map(function (c) { return gearCard(c[0], c[1], true); }).join('') + '</div>' : '<div class="empty">No gear in these battle reports.</div>') +
    (cards.length > 12 && !S.all.gear ? '<button class="btn more" type="button" data-showall="gear"><span>Show all <span translate="no">' + cards.length + '</span></span></button>' : '');
}
function renderGear() {
  var el = $('#gearTop'); if (!el) return;
  el.innerHTML = '<div class="segs2" role="group" aria-label="Gear view"><button type="button" data-gview="gear" aria-pressed="' + (S.gview === 'gear') + '">Pieces</button><button type="button" data-gview="runes" aria-pressed="' + (S.gview === 'runes') + '">Runes</button></div>';
  gearBody();
}
function classicLink(tab, text, from) { return '<div class="lnkrow" style="margin-top:12px"><a class="tb link" href="' + esc(classicUrl(tab, from)) + '">' + ic('ext', 'sm') + '<span>' + nd(text) + '</span></a></div>'; }
function needData(what) { return '<div class="empty">' + esc(what) + (readOnly() ? '' : ' <button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>'; }
function priv(k) { return S.res.privacy && S.res.privacy[k] ? 'Private' : 'Visible to people with the link'; }
function repLabel(id) { return '…' + String(id).slice(-6); }
/* a report opened by its share link whose player is on the roster: the player can claim it by verifying their UID (the classic page's Verify pill) */
function claimable() { var r = S.res; return !!(r && r.readOnly && S.code && !S.advise && sk() && r.rosterEntry); }
function claimIdentity() {
  var re = S.res.rosterEntry, k = sk(); if (!re || !k) return;
  var id = d.getStoredIdentity() || {};
  if (id.siteKey === k) return;
  id.name = re.name; id.alliance = re.alliance; id.rank = re.rank; id.profession = re.profession; id.siteKey = k;
  d.identity.set(id);
}
function mountGuide() {
  var det = $('#guideDet'); if (!det || det.dataset.mounted) return;
  det.dataset.mounted = '1';
  /* guide-videos.js (the film IDs live there, shared with the classic page) loads the first time the card is opened, so nothing is added to the first paint */
  det.addEventListener('toggle', function () {
    var slot = $('#guideSlot'); if (!det.open || !slot || slot.firstChild) return;
    var put = function () { if (window.GuideVideos && !slot.firstChild) slot.appendChild(window.GuideVideos.buildCard('armory')); };
    if (window.GuideVideos) { put(); return; }
    var sc = document.createElement('script'); sc.src = 'guide-videos.js'; sc.onload = put;
    sc.onerror = function () { slot.innerHTML = '<p class="t13 muted">The film could not load. Check your connection.</p>'; };
    document.body.appendChild(sc);
  });
}
function statusBody() {
  var res = S.res, vm = S.vm, ro = readOnly(), key = sk(), unlocked = !!(res.identity && res.identity.unlocked), h = vm.header, o = '';
  if (ro && claimable()) o += '<div class="step"><span class="step-n" translate="no">1</span><div class="step-b"><h3>Is this your armory?</h3><p>It belongs to ' + nm(h.name || 'another player') + '. If that is you, verify your UID and it becomes yours. Your UID only proves this report is yours.</p><div class="irow" style="margin-top:8px"><input class="fld" id="uidIn" data-clarity-mask="true" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Your UID" placeholder="e.g. 000000000000"><button class="btn" type="button" data-verify>Verify</button></div><div class="err" id="uidErr" role="alert"></div></div></div>';
  else if (ro) o += '<div class="step"><span class="step-n" translate="no">1</span><div class="step-b"><h3>This armory is read-only</h3><p>It belongs to ' + nm(h.name || 'another player') + '. You can look, but not change anything.</p></div></div>';
  else if (!key) o += '<div class="step"><span class="step-n" translate="no">1</span><div class="step-b"><h3>Verify your UID</h3><p>This player is not in the roster, so game data cannot be linked yet.</p></div></div>';
  else if (unlocked) o += '<div class="step"><span class="step-n" translate="no">1</span><div class="step-b"><h3>Verify your UID</h3><p>Verified on this device.</p><div style="margin-top:8px"><span class="pill" style="color:var(--ok);background:rgba(63,185,80,.12)">Done</span></div></div></div>';
  else o += '<div class="step"><span class="step-n" translate="no">1</span><div class="step-b"><h3>Verify your UID</h3><p>Your UID is in your in-game profile. It only proves this report is yours.</p><div class="irow" style="margin-top:8px"><input class="fld" id="uidIn" data-clarity-mask="true" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Your UID" placeholder="e.g. 000000000000"><button class="btn" type="button" data-verify>Verify</button></div><div class="err" id="uidErr" role="alert"></div></div></div>';
  if (!ro && key) {
    o += '<div class="step"><span class="step-n" translate="no">2</span><div class="step-b"><h3>Send your game data</h3>' + (unlocked ? '<ol><li>Open the game.</li><li>Run Snapshot from the Ops Center. It sends your game data here.</li></ol>' : '<p>Verify your UID first.</p>') +
      '<p class="t13 muted" style="margin-top:8px">' + (h.data ? 'Last sync ' + nm(h.data.date) : 'No game data yet') + '</p>' +
      (h.data ? '' : '<p class="t13" style="margin-top:8px">No Ops Center yet? <a class="tb link" href="rickroll.html">Set up the Ops Center</a>. Snapshot, the tool that sends your game data, is in it.</p><details class="help" id="guideDet"><summary>Watch the setup film</summary><div id="guideSlot"></div></details>') +
      '<div class="lnkrow"><a class="tb link" href="' + esc(classicUrl('', 'v2-paste')) + '">Or paste game data on the classic page</a></div></div></div>';
  }
  o += '<div><h3 class="disp" style="font-size:var(--fs-20)">Sources</h3><div style="margin-top:8px">' +
    '<div class="srow"><div class="sb"><div class="a">Battle reports</div><div class="b">' + (h.reports ? '<span class="dot ' + (h.reports.warn ? 'warn' : 'ok') + '"></span><span>' + nm(h.reports.date) + ' &middot; ' + nd(h.reports.age + (h.reports.ageDays >= 1 ? ' old' : '')) + '</span>' : '<span>None</span>') + '</div></div></div>' +
    '<div class="srow"><div class="sb"><div class="a">Game data</div><div class="b">' + (h.data ? '<span class="dot ' + (h.data.warn ? 'warn' : 'ok') + '"></span><span>' + nm(h.data.date) + ' &middot; ' + nd(h.data.age + (h.data.ageDays >= 1 ? ' old' : '')) + '</span>' : '<span>None yet</span>') + '</div></div></div>' +
    '<div class="srow"><div class="sb"><div class="a">Bag</div><div class="b">' + priv('inv') + '</div></div></div>' +
    '<div class="srow"><div class="sb"><div class="a">Rune pool</div><div class="b">' + priv('runepool') + '</div></div></div>' +
    (ro ? '' : '<div class="t13 muted" style="padding-top:8px">Change who can see the bag and rune pool <a class="tb link" href="' + esc(classicUrl('', 'v2-privacy')) + '">on the classic page</a>.</div>') + '</div></div>';
  var sv = !ro && S.saved ? savedReport() : null, ids = sv ? sv.reportIds : (res.reports || []).map(function (r) { return r.id; });
  o += '<div><h3 class="disp" style="font-size:var(--fs-20)">Battle reports</h3><div style="margin-top:8px">' + (ids.length ? ids.map(function (id) {
    var conf = S.confirm === id;
    return '<div class="srow"><div class="sb"><div class="a code" translate="no" style="font-family:var(--mono);font-size:var(--fs-14)">' + esc(repLabel(id)) + '</div>' + (conf ? '<div class="b">' + (ids.length === 1 ? 'This is your only report. Removing it opens the start screen.' : 'Remove this report?') + '</div>' : '') + '</div>' +
      (sv ? (conf ? '<button class="btn" type="button" data-rmno>Keep</button><button class="btn" type="button" data-rmyes="' + esc(id) + '">Remove</button>' : '<button class="btn" type="button" data-rm="' + esc(id) + '">Remove</button>') : '') + '</div>';
  }).join('') : '<p class="muted">No battle reports. The armory is built from game data only.</p>') +
    (sv ? '<div class="irow" style="margin-top:8px"><input class="fld" id="repIn" data-clarity-mask="true" type="text" inputmode="numeric" autocomplete="off" aria-label="Battle Report ID" placeholder="Add a battle report ID"><button class="btn" type="button" data-addrep>Add</button></div><div class="err" id="repErr" role="alert"></div>' : '') + '</div></div>';
  if (!ro) o += '<div><h3 class="disp" style="font-size:var(--fs-20)">More, on the classic page</h3><p class="t13 muted" style="margin-top:8px">These are not in the new Armory yet. Each link opens the classic page; its settings gear holds them.</p>' +
    classicLink('', 'Add or edit marches', 'v2-marches') + classicLink('', 'Revoke a share link', 'v2-sharecodes') + classicLink('', 'Clear my imported game data', 'v2-cleardata') + '</div>';
  return o;
}
function settingsBody() {
  var lo = ls('langOverride') || 'en', sw = '';
  if (S.saved) sw = S.confirm === 'switch' ?
    '<p>Switch player? The saved report is removed from this device. Your sign-in and game data stay.</p><div class="kitrow" style="display:flex;gap:8px;margin-top:8px"><button class="btn" type="button" data-swno>Keep</button><button class="btn" type="button" data-swyes>Switch player</button></div>' :
    '<button class="btn" type="button" data-sw>Switch player</button>';
  else if (S.code) sw = '<a class="btn" href="armory.html' + (ls('armory_v2_beta') === '1' ? '?beta=1' : '') + '">Build my own armory</a>';
  return '<div><label class="lab" for="langSel">Language</label><select class="sel" id="langSel" aria-label="Language">' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lo ? ' selected' : '') + ' translate="no">' + esc(l[1]) + '</option>'; }).join('') + '</select></div>' +
    (sw ? '<div>' + sw + '</div>' : '') +
    '<div class="lnkrow"><button class="tb link" type="button" data-fb>Send feedback</button><a class="tb link" data-back href="' + esc(classicUrl('', 'v2')) + '">Back to classic</a></div>';
}
function marches() { var s = savedReport(); return s && Array.isArray(s.marchGroups) ? s.marchGroups : []; }
function sig() { var s = savedReport(); return (s ? s.reportIds : []).join(',') + '|' + JSON.stringify(marches()); }
function saveConfig() {
  var key = sk(), s = savedReport();
  if (!key) return Promise.reject(new Error('Verify your UID before you share. A link without it cannot carry your game data.'));
  var body = { siteKey: key, playerName: stateName(), deviceId: deviceId(), reportIds: s.reportIds.join(','), marchGroups: marches() };
  return d.ensureToken(key).catch(function () {}).then(function () {
    var hd = { 'Content-Type': 'application/json' }, t = d.token(); if (t) hd.Authorization = 'Bearer ' + t;
    return fetch(WORKER + '/report-config', { method: 'POST', headers: hd, body: JSON.stringify(body) });
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || !j.ok) throw new Error((j && j.error) || 'Save failed');
    var cur = savedReport() || s; cur.shortcode = j.shortcode; ls('playerReport', JSON.stringify(cur)); ls('ar_saved_sig_v1', sig());
    return j.shortcode;
  });
}
function copyText(text, code) {
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); toast(ok ? 'Link copied' : 'Copy the code ' + code + ' by hand');
  }
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
}
function share() {
  if (!S.res) return;
  var done = function (code) { var el = $('#shareCode'); if (el) { el.textContent = code; el.className = 'code muted'; el.setAttribute('translate', 'no'); } copyText('https://2864tw.com/armory-report.html?code=' + code, code); };
  if (S.code) { done(S.code); return; }
  var s = savedReport();
  if (!s || readOnly()) { toast('Nothing to share yet'); return; }
  /* first press mints the code; a changed report or march list saves again, so the link is never stale (v1 behaviour) */
  if (s.shortcode && ls('ar_saved_sig_v1') === sig()) { done(s.shortcode); return; }
  saveConfig().then(done, function (e) { toast(e && e.message ? e.message : 'Could not save the link'); });
}
function verify() {
  var raw = ($('#uidIn') || {}).value || '', err = $('#uidErr'); if (!raw.trim()) return;
  var btn = $('[data-verify]'); btn.disabled = true;
  d.verifyUid(sk(), raw).then(function (r) {
    if (r.ok && claimable() && r.healed && r.siteKey !== sk()) { err.textContent = 'That UID belongs to ' + r.name + ', not ' + stateName() + '. You are now verified as ' + r.name + '.'; setTimeout(function () { location.reload(); }, 1800); return; }
    if (r.ok) { if (claimable()) claimIdentity(); toast(r.healed ? 'Verified. Reloading.' : 'Verified'); setTimeout(function () { location.reload(); }, r.healed ? 400 : 700); return; }
    var digits = raw.replace(/\D/g, ''), trimmed = raw.trim(), hint;
    if (!digits) hint = 'A UID is digits only. Copy it from your in-game profile.';
    else if (digits.length < 10 || digits.length > 14) hint = 'That looks too ' + (digits.length < 10 ? 'short' : 'long') + ' (' + digits.length + ' digits). UIDs are 12 or 13 digits.';
    else if (trimmed !== digits) hint = 'UID does not match this player. Use the digits only, with no spaces or prefix.';
    else hint = 'UID does not match this player. Check you picked the right name and copied the UID exactly.';
    err.textContent = hint; btn.disabled = false;
  });
}
function addReport() {
  var id = (($('#repIn') || {}).value || '').trim(), err = $('#repErr'), s = savedReport();
  if (!s) return;
  if (!/^\d{10,25}$/.test(id)) { err.textContent = 'Enter a valid numeric report ID (10 to 25 digits).'; return; }
  if (s.reportIds.indexOf(id) >= 0) { err.textContent = 'This report is already added.'; return; }
  var cap = S.res.identity && S.res.identity.unlocked ? 9 : 6;
  if (s.reportIds.length >= cap) { err.textContent = 'Maximum ' + cap + ' reports reached.'; return; }
  err.textContent = '';
  d.fetchReportResponse(id).then(function (r) { if (!r || !r.ok) throw new Error('Report not found. Check the ID and try again.'); return r.json(); }).then(function (data) {
    var ex = data && data.battle && d.extractPlayerData(data, s.player.name);
    if (!ex) throw new Error('Your player (' + s.player.name + ') was not found in this report.');
    var cache = {}; try { cache = JSON.parse(ls('playerReportData')) || {}; } catch (e) {}
    cache[id] = ex; s.reportIds.push(id);
    ls('playerReportData', JSON.stringify(cache)); ls('playerReport', JSON.stringify(s));
    location.reload();
  }).catch(function (e) { err.textContent = e.message || 'Could not get the report.'; });
}
function removeReport(id) {
  var s = savedReport(); if (!s) return;
  if (s.reportIds.length <= 1) { ls('playerReport', null); ls('playerReportData', null); ls('armory_v2_switched', '1'); location.href = 'armory.html'; return; }
  s.reportIds = s.reportIds.filter(function (x) { return x !== id; });
  var cache = {}; try { cache = JSON.parse(ls('playerReportData')) || {}; } catch (e) {} delete cache[id];
  ls('playerReport', JSON.stringify(s)); ls('playerReportData', JSON.stringify(cache)); location.reload();
}

var LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文'], ['ar', 'العربية'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['hi', 'हिन्दी'], ['pl', 'Polski'], ['uk', 'Українська'], ['id', 'Indonesia']];
var EXPLAIN = {
  gear: ['How gear score works', 'Each gear piece scores up to 1,000. Up to 400 comes from its random stats: the average roll of its stats. Up to 600 comes from its rune: stars divided by the most stars that slot allows. A hero has 6 pieces, so the most is 6,000 per hero. The maximum shown is 6,000 times the heroes counted.'],
  rune: ['How rune stars work', 'A placed rune scores its stars plus 1, divided by its most stars plus 1. An empty slot scores 0. The number is the total score divided by the best possible score across every gear slot counted.'],
  beast: ['How beast potential works', 'Each deployed beast has a potential value. It is divided by the top value for its rarity. The number is the average of the beasts deployed on a field.'],
  moves: ['How next moves are chosen', 'Each move uses only data in this report. Free moves come first, then moves that use what you already have, then moves that cost resources. Inside one kind of move, the biggest gain comes first, then the hero with the best gear score. A decor move names the stat it raises and shows only when your shards cover the cost. An awakening move raises one skill and says the most Awakening Stones it can take; it shows only when your stones cover it. A refine move picks the piece with the most stats under 70%. HT moves count the HT in your battle reports first.']
};

function renderSections() { rosterList(); renderGear(); }
/* [title, html, titleIsAName] for the sheets that live here */
function sheet(kind, arg) {
  if (kind === 'explain') return [EXPLAIN[arg][0], '<p>' + nd(EXPLAIN[arg][1]) + '</p>'];
  if (kind === 'status') return ['Status', statusBody()];
  if (kind === 'settings') return ['Settings', settingsBody()];
  return null;
}
var KEYS = ['load', 'pick', 'code', 'verify', 'addrep', 'rm', 'rmno', 'rmyes', 'sw', 'swno', 'swyes', 'mine', 'reload'];
function owns(t) { return KEYS.some(function (k) { return k in t.dataset; }); }
function click(t) {
  var ds = t.dataset;
  if ('load' in ds) { loadReportId(); return true; }
  if ('pick' in ds) { pickPlayer(+ds.pick); return true; }
  if ('code' in ds) { var c = (($('#scode') || {}).value || '').trim().toUpperCase(); if (/^[0-9A-Z]{4}$/.test(c)) location.search = '?code=' + c + (ls('armory_v2_beta') === '1' ? '&beta=1' : ''); else if ($('#stErr')) $('#stErr').textContent = 'A share code is 4 letters or numbers.'; return true; }
  if ('reload' in ds) { location.reload(); return true; }
  if ('verify' in ds) { verify(); return true; }
  if ('addrep' in ds) { addReport(); return true; }
  if ('rm' in ds) { S.confirm = ds.rm; refreshSheet(); return true; }
  if ('rmno' in ds) { S.confirm = ''; refreshSheet(); return true; }
  if ('rmyes' in ds) { removeReport(ds.rmyes); return true; }
  if ('sw' in ds) { S.confirm = 'switch'; refreshSheet(); return true; }
  if ('swno' in ds) { S.confirm = ''; refreshSheet(); return true; }
  if ('swyes' in ds) { ls('playerReport', null); ls('playerReportData', null); ls('armory_v2_switched', '1'); location.href = 'armory.html'; return true; }
  if ('mine' in ds) { ls('armory_v2_switched', null); location.reload(); return true; }
  return false;
}
function enter(id) { if (id === 'rid') loadReportId(); else if (id === 'uidIn') verify(); else if (id === 'repIn') addReport(); }

return { deepRoster: deepRoster, renderStart: renderStart, renderSections: renderSections, rosterList: rosterList, gearBody: gearBody, renderGear: renderGear, sheet: sheet, mountGuide: mountGuide, claimable: claimable, share: share, owns: owns, click: click, enter: enter, saveConfig: saveConfig };
};
