/* armory-advice-flows.js: the two sheets behind Advice buttons, loaded when one is tapped (armory-advice.js loads it).
 * "Ask for rune help" (a player asks for a plan) and "Advise a player" (an allowlisted advisor opens another player's armory).
 * Same-origin script, no CSP change. Everything it shows from the worker goes through esc / nm.
 */
window.ArmoryAdviceFlows = function (X) {
'use strict';
var S = X.S, d = X.d, H = X.H, core = X.core, SK_RE = X.SK_RE, $ = X.$, esc = X.esc, nm = X.nm, rich = X.rich, api = X.api, fail = X.fail, ownAuth = X.ownAuth, me = X.me, ctx = X.ctx, sk = X.sk;
var links = X.links, preflight = X.preflight, normCode = X.normCode, loadEntries = X.loadEntries;
var seenLoad = X.seenLoad, seenDrop = X.seenDrop, ageOf = X.ageOf, ST = X.ST, ic = X.ic;
var A = { pick: null, ask: null, showAll: false, seenLive: null };

/* ---------- Advise a player ---------- */
function pickBody() {
  var p = A.pick;
  if (p.step === 'report') return '<p>' + nm(p.name) + ' has no saved report yet. Enter a Battle Report ID that includes ' + nm(p.name) + '.</p><div class="irow"><input class="fld" id="advRid" type="text" inputmode="numeric" autocomplete="off" placeholder="Battle Report ID" aria-label="Battle Report ID"><button class="ab pri" type="button" data-a="pickrid">Use report</button></div><div class="err" role="alert">' + esc(p.err) + '</div>';
  if (p.busy) return '<p class="muted" role="status">' + esc(p.status || 'Working') + '</p>';
  var q = p.q.trim().toLowerCase(), me2 = me(), rows = '';
  if (q.length >= 2 && !p.roster) rows = '<p class="t13 muted">Loading the roster</p>';
  if (q.length >= 2 && p.roster) {
    var n = 0;
    Object.keys(p.roster).forEach(function (k) { var r = p.roster[k]; if (n >= 30 || !SK_RE.test(k) || (me2 && k === me2.sk) || !r || String(r.name || '').toLowerCase().indexOf(q) < 0) return; n++; rows += '<button class="ab vrow" type="button" data-a="target" data-sk="' + k + '"><span class="grow" translate="no">' + esc(String(r.name || '')) + '</span><span class="t13 muted" translate="no">' + esc(String(r.alliance || '')) + '</span></button>'; });
    if (!rows) rows = '<p class="t13 muted">No player matches that name.</p>';
  }
  return '<label class="lab" for="advQ">Search the roster</label><input class="fld" id="advQ" type="search" autocomplete="off" placeholder="Type 2 or more letters" aria-label="Search the roster" value="' + esc(p.q) + '"><div class="vlist" id="advRows">' + (q.length >= 2 ? rows : '<p class="t13 muted">Type at least 2 letters.</p>') + '</div>' + (p.err ? '<div class="err" role="alert">' + esc(p.err) + '</div><button class="ab" type="button" data-a="again">Start again</button>' : '');
}
function setPick(upd) { Object.keys(upd).forEach(function (k) { A.pick[k] = upd[k]; }); var el = $('#sheetB'); if (el && S.sheet === 'advice-pick') el.innerHTML = pickBody(); }
function startAdvise(targetSk) {
  var m = me(), p = A.pick; if (!m || p.busy) return;
  setPick({ busy: true, status: 'Opening the player’s armory', err: '' });
  ownAuth(m.sk).then(function (au) { if (!au) throw { msg: 'Verify your UID, then try again.' }; return api('/advisor/delegate', { method: 'POST', body: { targetSiteKey: targetSk }, auth: au }); }).then(function (r) {
    if (!r.ok || !r.j || typeof r.j.token !== 'string') throw { msg: fail(r, 'start advising') };
    p.d1 = r.j.token; p.target = targetSk; p.name = String(r.j.targetName || (p.roster[targetSk] && p.roster[targetSk].name) || 'this player').slice(0, 64);
    return api('/report-configs', { method: 'POST', body: { siteKey: targetSk } });
  }).then(function (r) {
    var cf = r.ok && r.j && Array.isArray(r.j.configs) ? r.j.configs.filter(function (c) { return c && /^[0-9A-Za-z]{4}$/.test(String(c.shortcode || '')); }) : [];
    cf.sort(function (a, b) { return new Date(b.updatedAt || b.date || 0).getTime() - new Date(a.updatedAt || a.date || 0).getTime(); });
    if (cf.length) return String(cf[0].shortcode).toUpperCase();
    setPick({ busy: false, step: 'report', err: '' }); return null;
  }).then(function (sc) { if (sc) return finishAdvise(sc); }, function (e) { setPick({ busy: false, step: 'pick', err: e && e.msg ? e.msg : 'Could not start. Check your connection and try again.' }); });
}
function finishAdvise(sc) {
  var p = A.pick, m = me();
  setPick({ busy: true, status: 'Creating the advice link', err: '' });
  return api('/advisor/request', { method: 'POST', body: { reportShortcode: sc, note: 'Set up by ' + (m && m.name ? m.name : 'an advisor') }, auth: 'Bearer ' + p.d1 }).then(function (r) {
    if (!r.ok || !r.j || !normCode(r.j.code)) throw { msg: fail(r, 'advice request') };
    p.d1 = null;
    location.href = 'armory.html?advise=' + normCode(r.j.code);
  }, function () { throw { msg: 'Could not reach the server. Check your connection and try again.' }; }).catch(function (e) { setPick({ busy: false, step: 'pick', err: e && e.msg ? e.msg : 'Could not start.' }); });
}
function useReport() {
  var p = A.pick, id = (($('#advRid') || {}).value || '').trim();
  if (!/^\d{10,25}$/.test(id)) { setPick({ err: 'Enter a valid numeric report ID (10 to 25 digits).' }); return; }
  setPick({ busy: true, status: 'Checking the report', err: '' });
  d.fetchReportResponse(id).then(function (r) { if (!r || !r.ok) throw { msg: 'Report not found. Check the ID and try again.' }; return r.json(); }).then(function (data) {
    var ex = data && data.battle && d.extractPlayerData(data, p.name);
    if (!ex) throw { msg: 'That report does not include ' + p.name + '.' };
    return api('/report-config', { method: 'POST', auth: 'Bearer ' + p.d1, body: { siteKey: p.target, playerName: p.name, deviceId: H.deviceId(), reportIds: id, marchGroups: [] } });
  }).then(function (r) {
    if (!r.ok || !r.j || !/^[0-9A-Za-z]{4}$/.test(String(r.j.shortcode || ''))) throw { msg: fail(r, 'save report') };
    return finishAdvise(String(r.j.shortcode).toUpperCase());
  }).catch(function (e) { setPick({ busy: false, step: 'report', err: e && e.msg ? e.msg : 'Could not read that report. Check your connection and try again.' }); });
}

/* ---------- Ask for rune help ---------- */
function askBody() {
  var a = A.ask, c = ctx(), g = S.res.supp || {}, pf = preflight({ pool: c.base, privacy: S.res.privacy, supTs: { inv: core.advice.tsOf(g.inv), gear: core.advice.tsOf(g.gear) } });
  if (a.code) {
    var l = links(a.code, a.shortcode);
    return '<p>Your request is ready. Send this link to your advisor:</p><div class="adv-link"><span class="code" translate="no">' + esc(l.advise) + '</span><button class="ab" type="button" data-a="copy" data-av="' + esc(l.advise) + '">' + ic('copy', 'sm') + 'Copy link</button></div><button class="ab wide" type="button" data-close>Done</button>';
  }
  return '<p class="t13 muted">' + rich(pf.line) + '</p>' + (pf.warn ? '<p class="t13 c-warn">' + esc(pf.warn) + '</p>' : '') + '<label class="lab" for="advAskNote">What do you want help with? (optional)</label><textarea class="fld" id="advAskNote" data-a="asknote" maxlength="500" rows="3" style="font-family:var(--sans);font-size:var(--fs-14)">' + esc(a.note) + '</textarea>' +
    '<button class="ab pri wide" type="button" data-a="askgo"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Sending' : 'Send request') + '</button>' + (a.err ? '<div class="err" role="alert">' + esc(a.err) + '</div>' : '');
}
function setAsk(upd) { Object.keys(upd).forEach(function (k) { A.ask[k] = upd[k]; }); var el = $('#sheetB'); if (el && S.sheet === 'advice-ask') el.innerHTML = askBody(); }
function askGo() {
  var a = A.ask, key = sk(); if (a.busy || !key) return;
  var note = (($('#advAskNote') || {}).value || a.note || '').slice(0, 500);
  setAsk({ busy: true, err: '', note: note });
  var shortcode = H.currentCode();
  var need = shortcode ? Promise.resolve(shortcode) : new Promise(function (res, rej) {
    if (!H.savedReport()) { rej({ msg: 'Build your armory from a battle report first, so your advisor has a report to open.' }); return; }
    H.more(function (mm) { mm.saveConfig().then(res, function (e) { rej({ msg: e && e.message ? e.message : 'Could not save your report link.' }); }); });
  });
  need.then(function (sc) { shortcode = sc; return ownAuth(key); }).then(function (au) {
    if (!au) throw { msg: 'Verify your UID, then try again.' };
    return api('/advisor/request', { method: 'POST', body: { reportShortcode: shortcode, note: note }, auth: au });
  }).then(function (r) {
    if (!r.ok || !r.j || !normCode(r.j.code)) throw { msg: fail(r, 'advice request') };
    setAsk({ busy: false, code: normCode(r.j.code), shortcode: shortcode });
    loadEntries(true);
  }).catch(function (e) { setAsk({ busy: false, err: e && e.msg ? e.msg : 'Could not send the request. Check your connection and try again.' }); });
}

function advisorSectionHtml() {
  var seen = seenLoad().entries;
  if (!X.allowed() && !seen.length) return '';
  var h = '<section class="card"><h2 class="hd">Advise a player</h2>';
  if (X.allowed()) h += '<p class="t13 muted">Build a rune plan for another player from their report and game data.</p><div class="adv-row"><button class="ab pri" type="button" data-a="advise">Advise a player</button></div>';
  h += '<div id="advSeen"></div></section>';
  return h;
}
function paintSeen() {
  var el = $('#advSeen'); if (!el) return;
  var seen = seenLoad().entries;
  if (!seen.length) { el.innerHTML = ''; return; }
  var list = A.showAll ? seen : seen.slice(0, 10);
  var rows = list.map(function (s) {
    var code = normCode(s.code), live = A.seenLive && A.seenLive[code]; if (!code) return '';
    var st = live ? ST[live.status] || ST.open : null;
    return '<a class="adv-seen" href="armory.html?advise=' + code + '"><span class="grow"><span translate="no">' + esc(String(s.playerName || (live && live.playerName) || 'A player').slice(0, 64)) + '</span><span class="t13 muted"> ' + esc(ageOf(s.openedTs)) + '</span></span>' + (st ? '<span class="pill ' + st[1] + '">' + (live.status === 'planned' ? 'Plan saved' : live.status === 'applied' ? 'Applied' : 'No plan yet') + '</span>' : '') + ic('chev', 'sm') + '</a>';
  }).join('');
  el.innerHTML = '<h3 class="sub" style="margin-top:16px">Requests I’ve opened</h3><div>' + rows + '</div>' + (seen.length > 10 && !A.showAll ? '<button class="ab wide" type="button" data-a="showall">Show all <span translate="no">' + seen.length + '</span></button>' : '');
}
function loadSeen() {
  var seen = seenLoad().entries.slice(0, A.showAll ? 50 : 10);
  A.seenLive = A.seenLive || {};
  paintSeen();
  Promise.all(seen.map(function (s) {
    var code = normCode(s.code); if (!code) return null;
    return api('/advisor/request/' + code).then(function (r) { if (r.status === 404) { seenDrop(code); delete A.seenLive[code]; } else if (r.ok && r.j) A.seenLive[code] = { status: String(r.j.status || 'open'), playerName: r.j.playerName }; });
  })).then(paintSeen);
}
function section() {
  var el = $('#advSec'); if (!el) return;
  el.innerHTML = advisorSectionHtml();
  if (el.innerHTML) loadSeen();
}
function open(kind) {
  if (kind === 'advice-ask') { A.ask = { note: '', busy: false, err: '' }; H.openSheet(kind); return; }
  H.openSheet(kind);
  d.getRosterMap().then(function (m) { if (A.pick) { setPick({ roster: m }); var q = $('#advQ'); if (q) q.focus(); } }, function () { setPick({ err: 'Could not load the roster. Try again.' }); });
}
function sheet(kind) {
  if (kind === 'advice-pick') { A.pick = { q: '', busy: false, err: '', step: 'pick' }; return ['Advise a player', pickBody()]; }
  if (kind === 'advice-ask') { A.ask = A.ask && A.ask.code ? A.ask : { note: '', busy: false, err: '' }; return ['Ask for rune help', askBody()]; }
  return null;
}
function click(a, t) {
  if (a === 'showall') { A.showAll = true; loadSeen(); }
  else if (a === 'target') { if (SK_RE.test(t.dataset.sk || '')) startAdvise(t.dataset.sk); }
  else if (a === 'again') setPick({ err: '', busy: false, step: 'pick' });
  else if (a === 'pickrid') useReport();
  else if (a === 'askgo') askGo();
}
function input(t) {
  if (t.id === 'advAskNote' && A.ask) A.ask.note = t.value.slice(0, 500);
  else if (t.id === 'advQ' && A.pick) { A.pick.q = t.value; var rows = $('#advRows'); if (rows) { var div = document.createElement('div'); div.innerHTML = pickBody(); var nr = div.querySelector('#advRows'); if (nr) rows.innerHTML = nr.innerHTML; } }
}
function key(e) { if (e.key === 'Enter' && e.target.id === 'advRid') { e.preventDefault(); useReport(); } }
return { section: section, open: open, sheet: sheet, click: click, input: input, key: key };
};
