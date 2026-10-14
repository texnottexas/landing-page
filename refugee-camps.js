// refugee-camps.js — Refugee Camps: uses the player's "Help Me" Letters and rallies each camp a letter brings, with
// the heroes and troops Quick Deploy would pick and a 3-minute rally. VIT comes from current VIT, then the 50-gem
// VIT buy, then the VIT capsules the player allows. Direct game requests only (815 item use, 801 VIT buy, 1021 camp
// list, 1201 rally); it never opens a game screen. Launched from the Ops Center.
// Rules live in refugee-camps-core.js (window.RefugeeCampsCore). One request at a time, each at least 1.5 s after
// the last one any Ops tool sent (Tex, 2026-10-13).
(function () {
  'use strict';
  if (window.__RFC && window.__RFC.open) { window.__RFC.flash(); return; }
  var C = window.RefugeeCampsCore;
  if (!C) { try { alert('Refugee Camps did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-13.3';
  var WORKER = window.__RFC_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var GAP_MS = window.__RFC_GAP_MS || C.GAP_MS, TIMEOUT_MS = window.__RFC_TIMEOUT_MS || 10000, CAMP_WAIT_MS = window.__RFC_CAMP_WAIT_MS || 10000;
  var POLL_MS = window.__RFC_POLL_MS || 1000, SETTLE_MS = window.__RFC_SETTLE_MS || 3000, RALLY_MS = window.__RFC_RALLY_MS || C.RALLY_MS;
  var LS_SET = 'rfc_settings_v1', LS_COUNT = 'rfc_count_v1_', LS_MIN = 'rfc_min_v1';
  var TARGET = {};                                         // NET.send wants a target; a plain object is always valid
  var IDS = { use: ['ITEM_USE', 815], buy: ['BuyEnergry', 801], camps: ['GetRefugee', 1021], rally: ['ALLIANCE_Assembly_Create', 1201] };

  // ---------------------------------------------------------------- game
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return window;
  }
  function req(n) { return GW().__require(n); }
  function NET() { return req('NetMgr').NET; }
  function DATA() { return req('DataCenter').DATA; }
  function UD() { return DATA().UserData; }
  function connected() { try { var s = NET()._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function ready() { try { var U = UD(); return !!(U && U.Name) && connected(); } catch (e) { return false; } }
  function rid(k) { var d = IDS[k]; try { var v = req('RequestId').RequestId[d[0]]; if (typeof v === 'number') return v; } catch (e) {} return d[1]; }
  function cfg(n) { try { return req('GameTools').default.getDataConfigData(n); } catch (e) { return null; } }
  function table(name, key) { try { return req('TableManager').TABLE.getTableDataById(name, String(key)); } catch (e) { return null; } }
  function gd() { try { return req('GameDefine') || {}; } catch (e) { return {}; } }
  function funcOn(k) { try { var v = gd().FunctionKey[k]; return v != null && !!UD().FunctionOn(v); } catch (e) { return false; } }
  function buff(k) { try { return Number(UD().Buff.getBuffAddValue(gd().BuffType[k])) || 0; } catch (e) { return 0; } }
  function vit() { try { var e = UD().getEnergy(1); return { point: Number(e.Point) || 0, max: Number(e.PointMax) || 0, buys: Number(e.BuyTimes) || 0 }; } catch (e) { return { point: 0, max: 0, buys: 0 }; } }
  function gems() { try { return Number(UD()._resourceData._gold) || 0; } catch (e) { return 0; } }
  function held(item) { try { return Number(UD().getItemAmount(item)) || 0; } catch (e) { return 0; } }
  function marches() { try { var u = UD(); return { used: Number(u.myMarchNum) || 0, max: Number(u.myMarchNumMAX) || 0 }; } catch (e) { return { used: 0, max: 0 }; } }
  function positions() {
    try { if (funcOn('monster_battle_replace')) return Number(req('NBattlePositionBiz').NBattlePositionBiz.getPositionCount(UD().Level)) || 0; } catch (e) {}
    return 0;
  }
  // The VIT a camp costs before Diana's cut: the letter's monster group (5 for group 12). The game asks for it in full.
  function campCost() {
    var it = table('item', C.LETTER), g = it && table('monster_group', funcOn('refugee_v2') ? it.para2 : it.para1), n = g && Number(g.cost_energy);
    return n > 0 ? n : 5;
  }
  // A letter's camp comes with a push (PUSH_FIND_REFUGEECAMP {x, y}) whose only job is to jump the map to the camp,
  // and that jump closes every open screen, chat included. While one of our letters waits for its camp, the push's
  // handler only notes where the camp is (that names our camp exactly); letters used by hand jump as always
  // (Tex, 2026-10-13). Put back when the run ends.
  function quiet(ms) { window.__RFC_QUIET_UNTIL = ms ? Date.now() + ms : 0; }
  function hush(on) {
    try {
      var P = req('PushResponse').PUSH_FIND_REFUGEECAMP, proto = P && P.prototype;
      if (!proto) return;
      if (on && !proto.__rfcOrig) {
        var orig = proto.Handler;
        proto.__rfcOrig = orig;
        proto.Handler = function (e) {
          if (Date.now() >= (window.__RFC_QUIET_UNTIL || 0)) return orig.apply(this, arguments);
          try { var t = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (t && t.x != null && t.y != null) window.__RFC_CAMP_PUSH = { x: Number(t.x), y: Number(t.y), at: Date.now() }; } catch (x) {}
        };
      } else if (!on && proto.__rfcOrig) { proto.Handler = proto.__rfcOrig; delete proto.__rfcOrig; }
    } catch (e) {}
  }
  function gameText(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
  function parse(a) { var d = a && a.d; if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return null; } } return d && typeof d === 'object' ? d : null; }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // Quick Deploy's inputs, read the way the game reads them.
  // A rally's heroes: the branch of the game's HeroTools.getAllEnabledHero a rally takes (the heroes who can march,
  // less any held by another stage). getAllEnabledHero itself reads the current battle's type, which the game only
  // sets once a battle screen has opened, so it throws in base right after login.
  function heroPool() {
    var used = [];
    try { used = req('NBattleModel').NBattleModel.instance.getOtherStageUsedHeros() || []; } catch (e) {}
    return (req('HeroController').HeroController.getInstance().getHaveHeroCanMarchList() || []).filter(function (h) { return h && used.indexOf(h.Id) < 0; }).map(function (h) {
      var t = table('hero', h.Id) || {};
      return { id: Number(h.Id), quality: Number(h.Quality) || 0, star: Number(h.Star) || 0, level: Number(h.Level) || 0, power: Number(h.Power) || 0, type: Number(h.HeroType) || 0, exclude: Number(t.exclude) || 0, tryOut: h.TryOut ? 1 : 0 };
    });
  }
  function busyHeroes() {
    var out = {};
    try { var M = req('HeroController').HeroState.March, hs = UD().Heros || {}; Object.keys(hs).forEach(function (k) { if (hs[k] && hs[k].State === M) out[Number(k)] = 1; }); } catch (e) {}
    return out;
  }
  function unitPool() {
    return (req('GameTools').default.getAttackerMyArmys() || []).map(function (a) {
      var d = a.ArmyData || {};
      return { armyID: Number(a.armyID), type: Number(d.type) || 0, level: Number(d.level) || 0, power: Number(d.power) || 0, mecha: Number(d.mecha_id) || 0, battleMecha: !!a.battleMechaData };
    });
  }
  function mechas() {
    var out = { power: {}, healing: {} }, now = Number(DATA().ServerTime) || Math.floor(Date.now() / 1000);
    try { (req('MechaController').MechaController.getInstance().getMyMechaList() || []).forEach(function (m) { out.power[m.mechaId] = Number(m.power) || 0; if (m.mechaServerData && Number(m.mechaServerData.cureCd) > now) out.healing[m.mechaId] = 1; }); } catch (e) {}
    return out;
  }
  function heroMax() { try { return Number(req('NBattleModel').NBattleModel.instance.getMarchHeroNumMax()) || 3; } catch (e) { return 3; } }
  function orange() { try { return Number(req('HeroData').HeroQuality.Orange) || 5; } catch (e) { return 5; } }
  function excludeOn() { try { return !!req('HeroController').HeroController.getInstance().checkHeroExclude(); } catch (e) { return false; } }
  // Units per slot for these heroes: the game's own sum (march-size buff + what the heroes add).
  function slotCaps(heroes) {
    var M = req('MarchStorageController').MarchStorageController.getInstance(), out = [];
    for (var y = 0; y < C.SLOT_POS.length; y++) out.push(Number(M.getMaxCoutByPos(y, 0, heroes)) || 0);
    return out;
  }
  // Quick Deploy's picks for one rally right now: heroes first, then troops for those heroes' slot sizes.
  function deploy() {
    var pool = heroPool();
    var heroes = C.pickHeroes(pool, { first: String(cfg(2021116) || '').split('|').map(Number).filter(Boolean), max: heroMax(), orange: orange(), pairThird: buff('BattleHeroAddNum') > 0, exclude: excludeOn(), busy: busyHeroes() });
    var types = [];
    heroes.forEach(function (id) { var h = pool.filter(function (x) { return x.id === id; })[0]; if (h && types.indexOf(h.type) < 0) types.push(h.type); });
    var m = mechas();
    var army = C.pickTroops(unitPool(), { heroTypes: types, slots: slotCaps(heroes), levelWindow: Number(cfg(2021115)) || 0, mechaOn: funcOn('mecha'), healing: m.healing, mechaPower: m.power });
    return { heroes: heroes, army: army };
  }

  // ---------------------------------------------------------------- state
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } }
  var S = { running: false, stopped: false, siteKey: '', set: null, camp: null, done: 0, log: [], unshown: [], used: { small: 0, large: 0, buy: 0 },
    gemsSpent: 0, noBuy: false, count: null, foot: '', tone: 'ok', last: '', min: lsGet(LS_MIN) === '1', view: '' };
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  function reportUsage() {
    var name = '';
    try { name = String(UD().Name || '').slice(0, 40); } catch (e) {}
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: 'refugee-camps', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }

  // ---------------------------------------------------------------- requests
  var flight = null;
  function call(send) {
    return new Promise(function (resolve) {
      var done = false, ok, mine = { at: Date.now() };
      flight = mine;
      var land = function () { if (flight === mine) flight = null; };
      var t = setTimeout(function () { if (!done) { done = true; land(); resolve({ s: 'timeout' }); } }, TIMEOUT_MS);
      try { ok = send(function (r) { land(); if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); }); } catch (e) { ok = false; }
      if (ok === false && !done) { land(); done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  // One request clock for every Ops tool in this tab: 1.5 s after the last request any of them sent.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 });
    return new Promise(function (resolve) {
      (function check() { var wait = P.at + GAP_MS - Date.now(); if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000)); })();
    });
  }
  // One request: wait for the clock, check again (running, connected), then send. 'stopped' / 'offline': not sent.
  async function ask(k, p) {
    await pace();
    if (!S.running) return { s: 'stopped' };
    if (!ready() || flight) return { s: 'offline' };
    var id = rid(k);
    return call(function (cb) { return NET().send(id, p, TARGET, cb); });
  }
  function unsent(a) { return a.s === 'stopped' || a.s === 'offline'; }
  async function settle(fn, ms) { var end = Date.now() + (ms || SETTLE_MS); while (Date.now() < end) { if (fn()) return true; await delay(100); } return !!fn(); }
  function refused(r) { stop(gameText(r.key) || ('the game answered ' + r.s + (r.key ? ' (' + r.key + ')' : ''))); }
  function waitDown() { setFoot('Game disconnected. Waiting...', 'bad'); return delay(POLL_MS); }

  // ---------------------------------------------------------------- the steps
  // The camps the game lists for this player (the event panel's request). null: stopped.
  async function campList() {
    while (S.running) {
      var a = await ask('camps', {});
      if (a.s === 'stopped') return null;
      if (a.s === 'offline') { await waitDown(); continue; }
      var r = C.classify(a);
      if (r.kind === 'silent') { stop("the game didn't answer the camp list"); return null; }
      if (r.kind !== 'ok') { refused(r); return null; }
      return C.campPoints(parse(a));
    }
    return null;
  }
  // VIT up to the camp's cost: the 50-gem buy, then Small, then Large capsules, within the player's limits.
  async function ensureVit() {
    var cost = campCost(), tries = 0;
    while (S.running) {
      var v = vit();
      if (v.point >= cost) return true;
      if (!ready()) { await waitDown(); continue; }
      if (++tries > 30) { stop("VIT didn't go up"); return false; }
      var act = C.refill({ point: v.point, max: v.max, buys: v.buys, cost: cost, gems: gems(), price: C.buyPrice(cfg(5041), v.buys), small: held(C.SMALL), large: held(C.LARGE) },
        { buy: S.set.buy && !S.noBuy, small: S.set.small, large: S.set.large }, S.used);
      if (act.act === 'stop') { stop(act.reason); return false; }
      if (!(await (act.act === 'buy' ? buyVit(v) : capsule(act.act, v)))) return false;
    }
    return false;
  }
  async function buyVit(v) {
    var g0 = gems();
    setFoot('Buying VIT for 50 gems...', 'ok');
    var a = await ask('buy', {});
    if (unsent(a)) return S.running;
    var r = C.classify(a);
    if (r.kind === 'silent') { stop("the game didn't answer the VIT buy"); return false; }
    if (r.kind !== 'ok') { refused(r); return false; }
    var ok = await settle(function () { var w = vit(); return w.buys === v.buys + 1 && w.point > v.point && g0 - gems() === C.BUY_PRICE; });
    if (ok) { S.used.buy++; S.gemsSpent += C.BUY_PRICE; setFoot('Bought VIT for 50 gems.', 'ok'); }
    else { S.noBuy = true; S.gemsSpent += Math.max(0, g0 - gems()); setFoot("The VIT buy didn't add up. No more buys this run.", 'warn'); }
    return true;
  }
  async function capsule(kind, v) {
    var item = kind === 'small' ? C.SMALL : C.LARGE;
    setFoot('Using a ' + (kind === 'small' ? 'Small' : 'Large') + ' VIT Capsule...', 'ok');
    var a = await ask('use', { itemid: item, amount: 1 });
    if (unsent(a)) return S.running;
    var r = C.classify(a);
    if (r.kind === 'silent') { stop("the game didn't answer the VIT Capsule"); return false; }
    if (r.kind !== 'ok') { refused(r); return false; }
    S.used[kind]++; paint();
    if (!(await settle(function () { return vit().point > v.point; }))) { stop("VIT didn't go up after a VIT Capsule"); return false; }
    return true;
  }
  // The camp list right before a letter, the letter, then the camp it brought: the one the game's "camp found" push
  // names, else one that wasn't in that list. Camps come back on tiles earlier camps used, even one whose rally ends
  // just as the letter goes out, so the push comes first. 'retry': no letter sent.
  async function useLetter() {
    var before = await campList();
    if (!before) return null;
    var had = {}; before.forEach(function (p) { had[C.key(p)] = 1; });   // camps already there are left alone
    var n0 = held(C.LETTER);
    setFoot('Using a "Help Me" Letter...', 'ok');
    hush(true); quiet(GAP_MS + TIMEOUT_MS + CAMP_WAIT_MS + 3000);   // no map jump for our own letter
    var sentAt = Date.now();
    var pushed = function () { var p = window.__RFC_CAMP_PUSH; return p && p.at >= sentAt ? C.campPoints({ points: [p] })[0] || null : null; };
    var a = await ask('use', { itemid: C.LETTER, amount: 1 });
    if (unsent(a)) return S.running ? 'retry' : null;
    var r = C.classify(a);
    if (r.kind === 'silent') { stop("the game didn't answer the letter"); return null; }
    if (r.kind !== 'ok') { refused(r); return null; }
    var left = C.lettersLeft(parse(a));
    var counted = left != null ? left === n0 - 1 : await settle(function () { return held(C.LETTER) === n0 - 1; });
    if (!counted) { stop("the letter count didn't add up"); return null; }
    setFoot('Looking for the camp...', 'ok');
    if (await settle(function () { return !!pushed(); }, Math.min(SETTLE_MS, 1500))) { quiet(3000); return pushed(); }
    var end = Date.now() + CAMP_WAIT_MS;
    while (S.running) {
      var pts = await campList();
      if (!pts) return null;
      if (pushed()) { quiet(3000); return pushed(); }
      var fresh = C.newCamps(pts, had);
      if (fresh.length) { quiet(3000); return fresh[0]; }  // others that came at once are left alone
      if (Date.now() >= end) { stop('a letter showed no camp, so no more letters were used'); return null; }
    }
    return null;
  }
  // Rally one camp with Quick Deploy's picks and the 3-minute timer. 'retry': nothing sent, the camp is kept.
  async function rally(camp) {
    var plan;
    try { plan = deploy(); } catch (e) { stop("couldn't read your heroes and troops"); return false; }
    if (!plan.heroes.length || !plan.army.length) { stop('no free heroes or troops for a rally'); return false; }
    var m0 = marches().used;
    setFoot('Rallying the camp at ' + camp.x + ', ' + camp.y + '...', 'ok');
    var a = await ask('rally', C.rallyRequest(camp, plan.heroes, plan.army));
    if (a.s === 'stopped') return false;
    if (a.s === 'offline') return 'retry';
    S.log.push(Date.now()); if (S.log.length > 100) S.log.shift();
    var r = C.classify(a);
    if (r.kind === 'silent') { stop("the game didn't answer the rally"); return false; }
    if (r.kind !== 'ok') { refused(r); return false; }
    S.done++; bump();
    S.last = 'Rallied ' + camp.x + ', ' + camp.y;
    reportUsage(); paint();
    // until the game's march count shows this rally, it counts as out on top of that count
    if (!(await settle(function () { return marches().used > m0; }))) S.unshown.push(Date.now());
    return true;
  }

  // ---------------------------------------------------------------- the loop
  async function run() {
    while (S.running) {
      if (S.done >= S.set.camps) { finish(); return; }
      if (!ready()) { await waitDown(); continue; }
      var now = Date.now(), m = marches(), own = S.unshown.filter(function (t) { return t > now - RALLY_MS; }).length;
      if (!C.marchFree(m.used, m.max, S.set.marches, own)) {
        setFoot('Waiting for a march (' + (m.used + own) + ' of ' + Math.min(S.set.marches, m.max) + ' out)', 'ok');
        await delay(POLL_MS); continue;
      }
      var g = C.gate(S.log, now);
      if (!g.ok) { setFoot('Paused: ' + g.reason + '.', 'warn'); await delay(POLL_MS); continue; }
      if (!S.camp) {                                       // no letter unless a rally can follow it
        var p0;
        try { p0 = deploy(); } catch (e) { stop("couldn't read your heroes and troops"); return; }
        if (!p0.heroes.length || !p0.army.length) { stop('no free heroes or troops for a rally'); return; }
      }
      if (!(await ensureVit())) return;
      if (!S.camp) {
        if (held(C.LETTER) < 1) { finish('Out of "Help Me" Letters.'); return; }
        var c = await useLetter();
        if (c === 'retry') continue;
        if (!c) return;
        S.camp = c;
      }
      var res = await rally(S.camp);
      if (res === 'retry') continue;
      if (!res) return;
      S.camp = null;
    }
  }

  // ---------------------------------------------------------------- start / stop
  function end(text) {
    if (S.stopped) return;
    S.stopped = true; S.running = false;
    quiet(0); hush(false);
    showMessage(text, true);
  }
  function stop(reason) {
    var r = String(reason).replace(/[.!\s]+$/, '');        // the game's own words often end in a period
    end(r === 'stopped by you' ? 'Stopped. ' + C.summary(S.done) : 'Refugee Camps stopped: ' + r + '. ' + C.summary(S.done));
  }
  function finish(prefix) { end((prefix ? prefix + ' ' : 'Done. ') + C.summary(S.done)); }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#rfc-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#rfc-root .rfc-card{width:min(272px,calc(100vw - 16px));box-sizing:border-box;background:#161b22;border:1px solid #388bfd;border-radius:10px;padding:8px 12px 10px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#rfc-root .rfc-card.warn{border-color:#d29922}#rfc-root .rfc-card.bad{border-color:#f85149}#rfc-root .rfc-card.flash{transform:scale(1.04)}',
    '#rfc-root .rfc-head{display:flex;align-items:center;gap:8px;font-weight:600;min-height:44px}#rfc-root .rfc-title{flex:1;white-space:nowrap}',
    '#rfc-root .rfc-dot{width:8px;height:8px;border-radius:50%;background:#388bfd}#rfc-root .warn .rfc-dot{background:#d29922}#rfc-root .bad .rfc-dot{background:#f85149}',
    '#rfc-root .rfc-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#rfc-root .min .rfc-mini{display:inline}',
    '#rfc-root button{font:inherit;color:#e6edf3;cursor:pointer}',
    '#rfc-root button#rfc-min{flex:none;width:44px;height:44px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#rfc-root button#rfc-min:hover{color:#e6edf3;background:#1c2128}#rfc-root #rfc-min svg{transition:transform .2s}#rfc-root .min #rfc-min svg{transform:rotate(180deg)}',
    '#rfc-root .rfc-card.min{width:auto;padding:0 4px 0 12px}#rfc-root .min .rfc-body{display:none}#rfc-root .min .rfc-head{cursor:pointer}',
    '#rfc-root .rfc-row{display:flex;align-items:center;gap:4px;margin:4px 0}#rfc-root .rfc-lab{flex:1;min-width:0}#rfc-root .rfc-hint{display:block;color:#8b949e;font-size:11px}',
    '#rfc-root .rfc-row button{flex:none;width:44px;height:44px;padding:0;border:1px solid #30363d;border-radius:8px;background:#1c2128;font-size:18px}',
    '#rfc-root .rfc-row input{width:52px;height:44px;box-sizing:border-box;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#e6edf3;text-align:center;font-family:inherit;font-size:16px;-moz-appearance:textfield}',
    '#rfc-root .rfc-row input::-webkit-inner-spin-button,#rfc-root .rfc-row input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}',
    '#rfc-root .rfc-row button.rfc-toggle{width:96px}#rfc-root .rfc-row button.rfc-toggle[aria-pressed="true"]{border-color:#3fb950;color:#3fb950}',
    '#rfc-root .rfc-stat{font-variant-numeric:tabular-nums;font-weight:600}#rfc-root .rfc-sub{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}',
    '#rfc-root .rfc-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#rfc-root .rfc-last{color:#79c0ff;font-size:12px;margin-top:2px}#rfc-root .rfc-last:empty{display:none}',
    '#rfc-root .rfc-msg{margin:4px 0 2px}#rfc-root .rfc-btns{display:flex;gap:6px;margin-top:8px}',
    '#rfc-root .rfc-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#rfc-root .rfc-btns button:hover{border-color:#79c0ff}',
    '#rfc-root .rfc-btns button.rfc-go{border-color:#3fb950;color:#3fb950}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('rfc-style');
    if (!st) { st = el('style'); st.id = 'rfc-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('rfc-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'rfc-root';
    card = el('div', 'rfc-card');
    var head = el('div', 'rfc-head');
    head.appendChild(el('span', 'rfc-title', 'Refugee Camps'));
    var mini = el('span', 'rfc-mini'); mini.id = 'rfc-mini'; head.appendChild(mini);
    head.appendChild(el('span', 'rfc-dot'));
    var mb = el('button'); mb.id = 'rfc-min'; mb.type = 'button'; mb.hidden = true;
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'rfc-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; window.__RFC.open = false; quiet(0); hush(false); }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('rfc-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Refugee Camps' : 'Minimize Refugee Camps'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() { S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint(); }
  function stepper(label, key, value, min, max, hint) {
    var row = el('div', 'rfc-row'), lab = el('label', 'rfc-lab', label);
    lab.htmlFor = 'rfc-' + key;
    if (hint) lab.appendChild(el('span', 'rfc-hint', hint));
    var inp = el('input'); inp.id = 'rfc-' + key; inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = String(min); inp.max = String(max); inp.value = String(value);
    var fix = function (v) { var n = Math.floor(Number(v)); inp.value = String(Math.min(max, Math.max(min, isFinite(n) ? n : min))); };
    inp.addEventListener('change', function () { fix(inp.value); });
    var minus = button('rfc-minus-' + key, '−', function () { fix(Number(inp.value) - 1); });
    var plus = button('rfc-plus-' + key, '+', function () { fix(Number(inp.value) + 1); });
    minus.setAttribute('aria-label', 'Fewer'); plus.setAttribute('aria-label', 'More');
    row.appendChild(lab); row.appendChild(minus); row.appendChild(inp); row.appendChild(plus);
    return row;
  }
  function showSetup() {
    ensureRoot(); body.textContent = ''; setView('setup'); card.className = 'rfc-card';
    var m = marches(), letters = held(C.LETTER);
    var set = C.clampSettings(lsJSON(LS_SET), { marchMax: m.max, letters: letters });
    body.appendChild(stepper('Marches', 'marches', set.marches, 1, Math.max(1, m.max), 'of ' + m.max));
    body.appendChild(stepper('Camps', 'camps', set.camps, 1, Math.max(1, letters), letters + ' letters'));
    var row = el('div', 'rfc-row'), lab = el('span', 'rfc-lab', '50-gem VIT buy');
    lab.appendChild(el('span', 'rfc-hint', 'first buy of the day only'));
    var tg = button('rfc-buy', set.buy ? 'On' : 'Off', function () { var on = tg.getAttribute('aria-pressed') !== 'true'; tg.setAttribute('aria-pressed', String(on)); tg.textContent = on ? 'On' : 'Off'; });
    tg.className = 'rfc-toggle'; tg.setAttribute('aria-pressed', String(set.buy));
    row.appendChild(lab); row.appendChild(tg); body.appendChild(row);
    body.appendChild(stepper('Small VIT capsules', 'small', set.small, 0, 999, held(C.SMALL) + ' in bag'));
    body.appendChild(stepper('Large VIT capsules', 'large', set.large, 0, 999, held(C.LARGE) + ' in bag'));
    body.appendChild(el('div', 'rfc-sub', 'With 1 march, every rally gets Diana if you have her.'));
    var btns = el('div', 'rfc-btns');
    var go = button('rfc-start', 'Start', begin); go.className = 'rfc-go';
    btns.appendChild(go); btns.appendChild(button('rfc-close', 'Close', removeRoot));
    body.appendChild(btns);
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : null; }
  function begin() {
    var m = marches(), letters = held(C.LETTER);
    if (letters < 1) { showMessage('You have no "Help Me" Letters.', true); return; }
    var b = document.getElementById('rfc-buy');
    S.set = C.clampSettings({ marches: val('rfc-marches'), camps: val('rfc-camps'), buy: !!b && b.getAttribute('aria-pressed') === 'true', small: val('rfc-small'), large: val('rfc-large') }, { marchMax: m.max, letters: letters });
    lsSet(LS_SET, JSON.stringify(S.set));
    S.running = true;
    showRun();
    run().catch(function (e) { stop('something went wrong (' + String((e && e.message) || e).slice(0, 60) + ')'); });
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    ['rfc-stat', 'rfc-sub', 'rfc-sub2', 'rfc-foot', 'rfc-last'].forEach(function (id) {
      var e = el('div', id === 'rfc-sub2' ? 'rfc-sub' : id); e.id = id; body.appendChild(e);
    });
    var btns = el('div', 'rfc-btns');
    btns.appendChild(button('rfc-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    body.appendChild(el('div', 'rfc-msg', text));
    if (withClose) { var btns = el('div', 'rfc-btns'); btns.appendChild(button('rfc-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'rfc-card' + (/stopped:/.test(text) ? ' warn' : '');
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  function paint() {
    if (!card || S.view !== 'run' || !S.set) return;
    var v = vit(), m = marches();
    put('rfc-stat', 'Camps ' + S.done + '/' + S.set.camps);
    put('rfc-sub', 'VIT ' + v.point + ' · Marches ' + m.used + '/' + m.max);
    put('rfc-sub2', 'Gems ' + S.gemsSpent + ' · Small ' + S.used.small + ' · Large ' + S.used.large);
    put('rfc-foot', S.foot); put('rfc-last', S.last); put('rfc-mini', S.done + '/' + S.set.camps);
    card.className = 'rfc-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (S.min ? ' min' : '');
  }

  // ---------------------------------------------------------------- start
  window.__RFC = {
    open: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { view: S.view, running: S.running, done: S.done, foot: S.foot, used: Object.assign({}, S.used), gemsSpent: S.gemsSpent, noBuy: S.noBuy, set: S.set }; },
    preview: function () { return deploy(); }
  };
  ensureRoot();
  showMessage('Starting...');
  var uid = ''; try { var u = UD(); uid = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!uid) { showMessage('Open the game and log in first.', true); return; }
  if (positions() !== C.SLOT_POS.length) { showMessage('Refugee Camps works with 9 troop slots for now.', true); return; }
  sha256Hex(uid).then(function (h) {
    S.siteKey = h.slice(0, 16);
    S.count = lsJSON(LS_COUNT + S.siteKey);
    reportUsage();
    showSetup();
  });
})();
