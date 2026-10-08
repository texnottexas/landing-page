// 2864tw.com — Alliance Defense Skipper (Ops Center tile and standalone bookmarklet).
// Skips the Alliance Defense wave timer the moment each wave's wait opens, with the game's own skip request
// (AL_MONSTER_SIEGE_SKIP_WAIT 3700, the request behind Skip + Confirm; it takes no arguments). No boss click and no
// panel: it reads the event state the server pushes (activity type 26, alMonsterSiege) and sends at most one skip
// per wave, never while the boss is marching. Stops at the target wave, on a lost wave, at the event's end, or after
// 3 refusals in a row. Every request waits on the shared Ops request clock.
// The rules below are plain functions; node tests require this file for them (module.exports).
(function (root) {
  'use strict';
  var MARCHING = 2147483647;            // alMonsterSiege.nextTime while the boss marches (a skip is refused)
  var MIN_LEFT_S = 2, MAX_PER_MIN = 15, REFUSE_STREAK = 3;

  // The fields that matter from the activity; null when absent or malformed.
  function readSiege(act) {
    var s = act && act.alMonsterSiege;
    if (!s) return null;
    var o = { round: Number(s.round), nextTime: Number(s.nextTime), winTimes: Number(s.winTimes) || 0, loseTimes: Number(s.loseTimes) || 0,
      isEnd: Number(s.isEnd) || 0, maxRound: Number(s.maxRound) || 80 };
    return isFinite(o.round) && isFinite(o.nextTime) ? o : null;
  }

  // What to do now: {act:'skip', round} | {act:'wait', why} | {act:'stop', why}.
  // c = {now (server seconds), target, startLose, rank, sent: {round: 1}}
  function decide(s, c) {
    if (!s) return { act: 'stop', why: 'Alliance Defense is not running.' };
    if (s.isEnd) return { act: 'stop', why: 'The event has ended.' };
    if (s.loseTimes > c.startLose) return { act: 'stop', why: 'A wave was lost, so skipping stopped.' };
    if (s.round >= c.target) return { act: 'stop', why: 'Reached wave ' + s.round + '.' };
    if (s.round >= s.maxRound) return { act: 'stop', why: 'That was the last wave.' };
    if (!(c.rank >= 5)) return { act: 'stop', why: 'Skipping needs alliance rank 5 (leader or officer).' };
    if (s.nextTime >= MARCHING) return { act: 'wait', why: 'marching' };
    if (s.nextTime - c.now < MIN_LEFT_S) return { act: 'wait', why: 'too late' };
    if (c.sent[s.round]) return { act: 'wait', why: 'sent' };
    return { act: 'skip', round: s.round };
  }

  function underCap(at, now) {
    return at.filter(function (t) { return now - t < 60000; }).length < MAX_PER_MIN;
  }

  var Rules = { MARCHING: MARCHING, MIN_LEFT_S: MIN_LEFT_S, MAX_PER_MIN: MAX_PER_MIN, REFUSE_STREAK: REFUSE_STREAK, readSiege: readSiege, decide: decide, underCap: underCap };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Rules; return; }

  // ================================================================ browser
  if (root.__ADS && root.__ADS.open && document.getElementById('ads-root')) { root.__ADS.flash(); return; }
  var VERSION = '2026-10-08';
  var SKIP_RID = 3700, SIEGE_TYPE = 26, TARGET = {};       // NET wants a target; a plain object is always valid
  var JITTER = root.__ADS_JITTER || [200, 500];             // ms after the window opens, before the clock wait

  // The game window: this page, or the game Map Collector runs in a frame in Unattended mode in this tab.
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return root;
  }
  function req(n) { return GW().__require(n); }
  function D() { return req('DataCenter').DATA; }
  function siegeNow() { try { return readSiege(req('ActivityController').ActivityController.Instance.getActivityByActivitytype(SIEGE_TYPE)); } catch (e) { return null; } }
  function serverNow() { try { return Number(D().ServerTime) || Math.floor(Date.now() / 1000); } catch (e) { return Math.floor(Date.now() / 1000); } }
  function rank() { try { return Number(D().UserData.Alliance.Rank) || 0; } catch (e) { return 0; } }
  function ready() {
    try { var s = req('NetMgr').NET._socket; return !!(D().UserData.Name && s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; }
  }
  function ec() { try { return req('EventCenter').EventCenter.getInst(); } catch (e) { return null; } }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // One request clock for every Ops tool in this tab.
  function pace() {
    var P = root.__opsPace || (root.__opsPace = { at: 0 });
    var gap = 1100 + Math.floor(Math.random() * 200);
    return new Promise(function (resolve) {
      (function check() {
        var wait = P.at + gap - Date.now();
        if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000));
      })();
    });
  }
  function sendSkip() {
    return new Promise(function (resolve) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; resolve({ timeout: true }); } }, 8000);
      try {
        req('NetMgr').NET.sendPB(SKIP_RID, { header: {}, alMonsterSiegeSkipWait: {} }, TARGET, function (e) {
          if (done) return; done = true; clearTimeout(to); resolve(e || {});
        });
      } catch (err) { done = true; clearTimeout(to); resolve({ thrown: String((err && err.message) || err) }); }
    });
  }

  // ---------------------------------------------------------------- run
  var S = { running: false, busy: false, target: 0, startLose: 0, startRound: 0, sent: {}, at: [], skips: 0, refused: 0, opened: {},
    status: '', why: '', timer: null };

  function ctx() { return { now: serverNow(), target: S.target, startLose: S.startLose, rank: rank(), sent: S.sent }; }
  async function tick() {
    if (!S.running || S.busy) return;
    var s = siegeNow(), d = decide(s, ctx());
    if (d.act === 'stop') return finish(d.why);
    if (s.nextTime < MARCHING && !S.opened[s.round]) S.opened[s.round] = Date.now();
    if (d.act !== 'skip') { setStatus(d.why === 'marching' ? 'Wave ' + s.round + ': the boss is attacking' : 'Wave ' + s.round + ': waiting'); return; }
    S.busy = true;
    try {
      await delay(JITTER[0] + Math.floor(Math.random() * (JITTER[1] - JITTER[0])));
      await pace();
      if (!S.running) return;
      if (!ready()) { setStatus('The game is not connected. Waiting.'); return; }
      s = siegeNow(); d = decide(s, ctx());                 // re-check after the waits: another officer may have skipped
      if (d.act === 'stop') return finish(d.why);
      if (d.act !== 'skip') return;
      var now = Date.now();
      if (!underCap(S.at, now)) { setStatus('Pausing: ' + MAX_PER_MIN + ' skips this minute'); return; }
      S.sent[d.round] = 1; S.at.push(now);
      var ans = await sendSkip(), h = ans && ans.pbAck && ans.pbAck.header, after = siegeNow();
      var moved = after && (after.nextTime >= MARCHING || after.round > d.round);
      if ((h && h.s === 0) || (ans.timeout && moved)) {
        S.skips++; S.refused = 0;
        setStatus('Skipped wave ' + d.round + ' ' + ((now - (S.opened[d.round] || now)) / 1000).toFixed(1) + ' s after it opened');
      } else {
        S.refused++;
        setStatus('Wave ' + d.round + ': the game refused the skip (' + (ans.thrown || (h && h.d) || (ans.timeout ? 'no answer' : 'error')) + ')');
        if (S.refused >= REFUSE_STREAK) finish('The game refused ' + REFUSE_STREAK + ' skips in a row.');
      }
    } finally { S.busy = false; paint(); }
  }
  function onPush() { tick(); }
  function start(target) {
    var s = siegeNow();
    S.running = true; S.target = target; S.startLose = s ? s.loseTimes : 0; S.startRound = s ? s.round : 0;
    S.sent = {}; S.at = []; S.skips = 0; S.refused = 0; S.opened = {};
    var E = ec(); if (E) try { E.on('ACTIVITY_STATE_UPDATE', onPush, S); } catch (e) {}
    S.timer = setInterval(tick, 200);                         // backup for a missed push
    showRun(); tick();
  }
  function finish(why) {
    if (!S.running) return;
    S.running = false; S.why = why;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    var E = ec(); if (E) try { E.off('ACTIVITY_STATE_UPDATE', onPush, S); } catch (e) {}
    showDone();
  }

  // ---------------------------------------------------------------- card
  var CSS = [
    '#ads-root{position:fixed;right:calc(8px + env(safe-area-inset-right));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#ads-root .ads-card{width:min(250px,calc(100vw - 16px));box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#ads-root .ads-card.run{border-color:#3fb950}#ads-root .ads-card.flash{transform:scale(1.03)}',
    '#ads-root .ads-title{font-weight:600;margin-bottom:6px}',
    '#ads-root .ads-big{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}#ads-root .ads-muted{color:#8b949e;font-size:12px}',
    '#ads-root .ads-status{color:#8b949e;font-size:12px;margin-top:4px;min-height:32px}',
    '#ads-root .ads-row{display:flex;align-items:center;gap:8px;margin:8px 0}',
    '#ads-root input{flex:1;min-width:0;min-height:40px;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font:inherit;font-size:15px}',
    '#ads-root input.bad{border-color:#f85149}',
    '#ads-root .ads-btns{display:flex;gap:6px;margin-top:8px}',
    '#ads-root button{flex:1;min-height:44px;font:inherit;color:#e6edf3;border:1px solid #30363d;border-radius:8px;background:#1c2128;cursor:pointer}',
    '#ads-root button:hover{border-color:#79c0ff}#ads-root button.go{background:#238636;border-color:#238636;font-weight:600}',
    '#ads-root .ads-warn{color:#d29922;font-size:11px;margin-top:6px}'
  ].join('\n');
  var rootEl = null, card = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn, cls) { var b = el('button', cls || null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    var st = document.getElementById('ads-style');          // always this version's styles (an update in the same tab)
    if (!st) { st = el('style'); st.id = 'ads-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('ads-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    rootEl = el('div'); rootEl.id = 'ads-root';
    card = el('div', 'ads-card'); rootEl.appendChild(card);
    document.body.appendChild(rootEl);
  }
  function close() {
    if (S.running) finish('Stopped by you.');
    if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    rootEl = null; root.__ADS.open = false;
  }
  function setStatus(t) { S.status = t; var n = document.getElementById('ads-status'); if (n && n.textContent !== t) n.textContent = t; }
  function message(text) {
    card.className = 'ads-card'; card.textContent = '';
    card.appendChild(el('div', 'ads-title', 'Alliance Defense Skipper'));
    card.appendChild(el('div', 'ads-msg', text));
    var b = el('div', 'ads-btns'); b.appendChild(button('ads-close', 'Close', close)); card.appendChild(b);
  }
  function showConfig() {
    var s = siegeNow();
    if (!s || s.isEnd) return message('Alliance Defense is not running right now.');
    if (!(rank() >= 5)) return message('Skipping needs alliance rank 5 (leader or officer).');
    card.className = 'ads-card'; card.textContent = '';
    card.appendChild(el('div', 'ads-title', 'Alliance Defense Skipper'));
    card.appendChild(el('div', 'ads-big', 'Wave ' + s.round));
    card.appendChild(el('div', 'ads-muted', 'of ' + s.maxRound + (s.nextTime >= MARCHING ? ' · the boss is attacking' : '')));
    var row = el('div', 'ads-row'); row.appendChild(el('span', null, 'Skip to wave'));
    var input = el('input'); input.id = 'ads-target'; input.type = 'number'; input.inputMode = 'numeric';
    input.min = String(s.round + 1); input.max = String(s.maxRound); input.value = String(Math.min(s.round + 10, s.maxRound));
    row.appendChild(input); card.appendChild(row);
    var b = el('div', 'ads-btns');
    b.appendChild(button('ads-start', 'Start', function () {
      var n = parseInt(input.value, 10), cur = siegeNow();
      if (!cur || !(n > cur.round) || n > cur.maxRound) { input.classList.add('bad'); return; }
      start(n);
    }, 'go'));
    b.appendChild(button('ads-close', 'Close', close));
    card.appendChild(b);
    card.appendChild(el('div', 'ads-warn', 'Skips the moment each wave opens, one per wave. Stops if a wave is lost.'));
  }
  function showRun() {
    card.className = 'ads-card run'; card.textContent = '';
    card.appendChild(el('div', 'ads-title', 'Alliance Defense Skipper'));
    var big = el('div', 'ads-big'); big.id = 'ads-wave'; card.appendChild(big);
    var count = el('div', 'ads-muted'); count.id = 'ads-count'; card.appendChild(count);
    var st = el('div', 'ads-status'); st.id = 'ads-status'; st.setAttribute('aria-live', 'polite'); card.appendChild(st);
    var b = el('div', 'ads-btns'); b.appendChild(button('ads-stop', 'Stop', function () { finish('Stopped by you.'); })); card.appendChild(b);
    paint();
  }
  function paint() {
    if (!S.running) return;
    var s = siegeNow(), w = document.getElementById('ads-wave'), c = document.getElementById('ads-count');
    if (w && s) { var t = 'Wave ' + s.round + ' → ' + S.target; if (w.textContent !== t) w.textContent = t; }
    if (c) { var ct = 'Skipped ' + S.skips; if (c.textContent !== ct) c.textContent = ct; }
    var st = document.getElementById('ads-status'); if (st && st.textContent !== S.status) st.textContent = S.status;
  }
  function showDone() {
    if (!card) return;
    var s = siegeNow();
    card.className = 'ads-card'; card.textContent = '';
    card.appendChild(el('div', 'ads-title', 'Alliance Defense Skipper'));
    var why = el('div', 'ads-msg', S.why); why.id = 'ads-why'; card.appendChild(why);
    card.appendChild(el('div', 'ads-muted', 'Skipped ' + S.skips + (S.skips === 1 ? ' wave' : ' waves') + ', wave ' + S.startRound + ' to ' + (s ? s.round : '?') + '.'));
    var b = el('div', 'ads-btns'); b.appendChild(button('ads-close', 'Close', close)); card.appendChild(b);
  }

  // ---------------------------------------------------------------- start
  root.__ADS = {
    open: true, version: VERSION, close: close,
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { running: S.running, skips: S.skips, refused: S.refused, why: S.why, status: S.status, sent: Object.keys(S.sent).map(Number) }; }
  };
  root.__defSkipStop = function () { finish('Stopped by you.'); };   // console escape hatch, as before
  ensureRoot();
  if (!root.__require || !root.cc) message('Open the game and let it finish loading first.');
  else showConfig();
})(typeof window !== 'undefined' ? window : globalThis);
