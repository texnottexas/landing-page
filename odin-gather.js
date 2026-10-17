// odin-gather.js — Odinium Gatherer (Tex 2026-10-16): sends the player's free marches to their own alliance's Lv. 3
// Refine Centers, each with the game's own gathering hero and troop picks, trimmed so the march fills at, or up to an
// hour after, the facility's time left. The facilities come from the game's Alliance Log (the chat's Building
// messages); a facility is checked with the game's own map view (901) and facility info (1034), and the march is the
// game's "Garrison gathering" (902, marchType ATTACK_TOWER). When the player owns a base skin with a gathering-speed
// bonus, it wears it until that batch of marches has arrived, then puts the old skin back. Runs together with the
// other collectors (ops-tools.json "together"). Rules in odin-gather-core.js (window.OdinGatherCore).
(function () {
  'use strict';
  if (window.__ODIN && window.__ODIN.running) { window.__ODIN.flash(); return; }
  var C = window.OdinGatherCore;
  if (!C) { try { alert('Odinium Gatherer did not load fully. Try again.'); } catch (e) {} return; }

  var VERSION = '2026-10-17';
  var WORKER = window.__ODIN_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  var FAST = !!window.__ODIN_FAST, TIMEOUT_MS = window.__ODIN_TIMEOUT_MS || 10000;
  var WAIT_MS = window.__ODIN_WAIT_MS || 30000;            // no free march, or nothing to send to: look again after this
  var UNSHOWN_MS = window.__ODIN_UNSHOWN_MS || 10000;      // a send counts as out until the game's march list shows it
  var SHOW_MS = window.__ODIN_SHOW_MS || 5000;             // after a send, wait this long at most for the game to list it
  var SKIN_MS = window.__ODIN_SKIN_MS || 30000;            // a skin switch not confirmed by then counts as unknown
  var HOLD_MS = 600000, CHECK_MS = window.__ODIN_CHECK_MS || 600000;   // an empty skin hold; a checked facility that got no march
  var MIN_FREE = 50, MIN_LEFT = 1800;                      // skip a facility with less room or time than this
  var GATHER_BUFF = 960002;                                // equip_buff "Gathering Speed-up" (WorldGatherSpeed)
  var LS_SET = 'odin_settings_v1', LS_SENT = 'odin_sent_v1_', LS_COUNT = 'odin_count_v1_', LS_SKIN = 'odin_skin_v1_', LS_MIN = 'odin_min_v1';
  var TARGET = {};

  // ---------------------------------------------------------------- game
  function GW() {
    try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {}
    return window;
  }
  function req(n) { return GW().__require(n); }
  function NET() { return req('NetMgr').NET; }
  function DATA() { return req('DataCenter').DATA; }
  function UD() { return DATA().UserData; }
  function TABLE() { return req('TableManager').TABLE; }
  function table(t, id) { try { return TABLE().getTableDataById(t, String(id)); } catch (e) { return null; } }
  function cfg(id) { try { return req('GameTools').default.getDataConfigData(id); } catch (e) { return null; } }
  function connected() { try { var s = NET()._socket; return !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; } }
  function ready() { try { var U = UD(); return !!(U && U.Name) && connected(); } catch (e) { return false; } }
  function serverSec() { try { var t = Number(DATA().ServerTime); return t > 0 ? t : Math.floor(Date.now() / 1000); } catch (e) { return Math.floor(Date.now() / 1000); } }
  function myUid() { try { var u = UD(); return String(u.UID != null ? u.UID : (u.StrUid || u._uid || '')); } catch (e) { return ''; } }
  function myAid() { try { return Number(UD().Alliance.Aid) || 0; } catch (e) { return 0; } }
  function homeServer() { try { var u = UD(); return Number(u.ServerId || u.OriginServerId) || 0; } catch (e) { return 0; } }
  function gameText(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t && t !== key ? String(t) : ''; } catch (e) { return ''; } }
  function ids() {
    var o = { view: 901, info: 1034, march: 902, skin: 855, type: 26 };
    try { var R = req('RequestId').RequestId; if (typeof R.GET_WORLD_INFO === 'number') o.view = R.GET_WORLD_INFO; if (typeof R.GET_TOWERINFO === 'number') o.info = R.GET_TOWERINFO; if (typeof R.MARCH_WORLD_POINT === 'number') o.march = R.MARCH_WORLD_POINT; if (typeof R.USE_CASTLE_FACE === 'number') o.skin = R.USE_CASTLE_FACE; } catch (e) {}
    try { var t = req('NWorldMapMarchCommon').NMarchType.ATTACK_TOWER; if (typeof t === 'number') o.type = t; } catch (e) {}
    return o;
  }
  function buffType(name, d) { try { var v = req('GameDefine').BuffType[name]; return v != null ? v : d; } catch (e) { return d; } }
  function funcOn(k) { try { return !!UD().FunctionOn(k); } catch (e) { return false; } }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  // The Alliance Log's Lv. 3 Refine Centers (the chat's Building messages), as the game holds them.
  function logList() {
    try {
      var R = req('AllianceRecordController').default._inst, cat = R && R._categoryData && R._categoryData['3'];
      var recs = Array.isArray(cat) ? cat : cat && typeof cat === 'object' ? Object.keys(cat).map(function (k) { return cat[k]; }) : [];
      return C.logFacilities(recs, gameText('alliance_records_027') || 'Well done! The Lv. {4} {5} ({2},{3}) built by {0} - {1} is completed.', serverSec());
    } catch (e) { return []; }
  }
  // Our gathering marches on the map: tile -> {arrive, gathering}.
  function ourMarches() {
    var out = {}, me = myUid(), type = ids().type;
    try {
      var ms = req('NWorldMapData').default.instance.marches || {};
      Object.keys(ms).forEach(function (k) {
        var m = ms[k];
        if (m && m.marchType === type && String(m.realUid != null ? m.realUid : m.uid) === me) out[m.target_tx + ',' + m.target_ty] = { arrive: Number(m.marchArrive) || 0, gathering: Number(m.gatherStartTime) > 0 };   // a gathering march names its owner in uid (live)
      });
    } catch (e) {}
    return out;
  }
  function marches() { try { var u = UD(); return { used: Number(u.myMarchNum) || 0, max: Number(u.myMarchNumMAX) || 0 }; } catch (e) { return { used: 0, max: 0 }; } }

  // The game's gathering picks. Heroes: the free ones (minus any we just sent), scored by the gathering buffs
  // (data_config 6000037: group 0 plus the Odinium group). Units: those at home, each with the game's own load.
  function buffIds(resType) {
    var g = String(cfg(6000037) || '').split('|').map(function (s) { return s.split(',').map(Number).filter(Boolean); });
    var pick = { 2: 1, 3: 2, 1: 3, 20: 4 }[resType];     // Soil, Oil, Coin, Odinium (QuickArmyEnterBtn's groups)
    return (g[0] || []).concat(pick != null && g[pick] ? g[pick] : []);
  }
  function HC() { return req('HeroController').HeroController.getInstance(); }
  function heroPool(resType) {
    var used = [], held = justSentHeroes(), ids0 = buffIds(resType), H = HC();
    try { used = req('NBattleModel').NBattleModel.instance.getOtherStageUsedHeros() || []; } catch (e) {}
    return (H.getHaveHeroCanMarchList() || []).filter(function (h) { return h && used.indexOf(h.Id) < 0 && !held[h.Id]; }).map(function (h) {
      var score = 0;
      ids0.forEach(function (b) { try { score += Number(H.getHeroSkillTalantBuffAddWithBuffId(h.Id, b)) || 0; } catch (e) {} });
      return { id: Number(h.Id), score: score };
    });
  }
  function heroMax() { try { return Number(req('NBattleModel').NBattleModel.instance.getMarchHeroNumMax()) || 3; } catch (e) { return 3; } }
  function slotCaps(heroes) {
    var M = req('MarchStorageController').MarchStorageController.getInstance(), out = [], n = C.SLOT_POS.length;
    // The positions this player has opened: the game's world marches use the count for their level (initWorldSite);
    // NBattleModel.myMaxArmysNum keeps the last battle screen's count (live: 5 for a Lv. 100 player with 9).
    var k = 0;
    try { k = Number(req('NBattlePositionBiz').NBattlePositionBiz.getPositionCount(UD().Level)) || 0; } catch (e) {}
    if (!(k > 0)) try { k = Number(req('NBattleModel').NBattleModel.instance.myMaxArmysNum) || 0; } catch (e) {}
    if (k > 0) n = Math.min(n, k);
    for (var y = 0; y < n; y++) out.push(Number(M.getMaxCoutByPos(y, 0, heroes)) || 0);
    return out;
  }
  function healing() {
    var out = {}, now = serverSec();
    try { (req('MechaController').MechaController.getInstance().getMyMechaList() || []).forEach(function (m) { if (m.mechaServerData && Number(m.mechaServerData.cureCd) > now) out[m.mechaId] = 1; }); } catch (e) {}
    return out;
  }
  // The deploy screen's load and speed inputs for these heroes at this facility (NBattleEmPanelNew.checkPower).
  function rates(res, heroes) {
    var B = UD().Buff, H = HC(), m = Number(res.resource_type), SPEED = buffType('WorldGatherSpeed', 143), LOAD = buffType('ArmyGatherLoad', 159);
    var heroPct = 0, heroLoad = 0;
    heroes.forEach(function (h) {
      try { heroPct += Number(H.getHeroSkillTalantBuffAdd(h, SPEED, m)) || 0; } catch (e) {}
      try { heroLoad += Number(H.getHeroSkillTalantBuffAdd(h, LOAD)) || 0; } catch (e) {}
    });
    var noLoad = String(cfg(930086) || '').split('|').indexOf(String(m)) >= 0;
    var u = noLoad ? 0 : (Number(B.getBuffPercentValue(LOAD)) || 0) + heroLoad;
    return {
      u: u, loadAdd: Number(B.getBuffAddValue(LOAD)) || 0, Q: m === 1 ? 1 : 0, loadFactor: Number(res.load_factor) || 40000,
      speed: C.speedOf({ gatherSpeed: res.gather_speed, coefficient: (table('map_building', C.BID) || {}).gather_coefficient || 1,
        addFlat: B.getBuffAddValue(SPEED, 'Resource', m), pct: B.getBuffPercentValue(SPEED, 'Resource', m), heroPct: heroPct })
    };
  }
  function unitPool(u, Q) {
    var NU = null; try { NU = req('NBattleUtil').NBattleUtil; } catch (e) {}
    return (req('GameTools').default.getAttackerMyArmys() || []).map(function (a) {
      var d = a.ArmyData || {}, id = d.id != null ? d.id : a.armyID, load = 0;
      try { load = Number(NU.getArmyLoad(id, u, Q)) || 0; } catch (e) {}
      return { armyID: Number(a.armyID), type: Number(d.type) || 0, power: Number(d.power) || 0, mecha: Number(d.mecha_id) || 0, thor: Number(d.thor_group) || 0, battleMecha: !!a.battleMechaData, load: load };
    });
  }
  function unitsHome() { try { return (req('GameTools').default.getAttackerMyArmys() || []).length > 0; } catch (e) { return true; } }
  // One march's plan for a facility: heroes, the deploy screen's rates for them, and troops trimmed to its time left.
  function plan(f) {
    var res = table('resource', f.itemId);
    if (!res) return null;
    var heroes = C.pickHeroes(heroPool(Number(res.resource_type)), { max: heroMax() });
    var r = rates(res, heroes);
    var p = C.planTroops(unitPool(r.u, r.Q), { slots: slotCaps(heroes), free: f.free, target: f.left, oneKey: funcOn('one_key_to_mining'),
      speed: r.speed, loadFactor: r.loadFactor, loadAdd: r.loadAdd, u: r.u, healing: healing() });
    p.heroes = heroes; p.speed = r.speed;
    return p;
  }

  // ---------------------------------------------------------------- base skins with a gathering-speed bonus
  function ownedGatherSkins() {
    var U = UD(), faces = U._MyCastleFace || {}, now = serverSec(), out = [];
    Object.keys(faces).map(Number).forEach(function (id) {
      var e = (faces[id] || {}).endTime;
      if (!(id > 0) || (e > 0 && e < now)) return;
      var row = table('skin', id), pct = 0;
      String((row && row.equip_buff) || '').split('|').forEach(function (kv) { var p = kv.split(','); if (Number(p[0]) === GATHER_BUFF) pct = (Number(p[1]) || 0) / 10000; });
      if (pct > 0) out.push({ id: id, pct: pct });
    });
    return out;
  }
  function currentSkin() { try { var U = UD(); return Number(U._UsingCastleFace != null ? U._UsingCastleFace : U.UsingCastleFace) || 0; } catch (e) { return 0; } }
  function skinTerrainOk() {
    try {
      var m = req('WorldMapController'), c = UD().WorldCoord;
      if (!m || !m.model || typeof m.model.checkIsPlainTile4 !== 'function' || !c) return null;
      return !!m.model.checkIsPlainTile4(c.x, c.y, true);
    } catch (e) { return null; }
  }
  // The game's own switch (USE_CASTLE_FACE), after its own checks: the 4 tiles around the base, temporary cosmetics off.
  // {ok} once the game confirms; {ok: false, refused} when it says no; {ok: false} with neither when the answer is
  // unknown (the game may still have switched). force: also while stopping (the switch back on Stop).
  function wearSkin(id, force) {
    if (skinTerrainOk() === false) return Promise.resolve({ ok: false, refused: true, why: gameText('skin_013') || 'the tiles around your base are not free' });
    return new Promise(function (resolve) {
      var settled = false, timer = setTimeout(function () { done({ ok: false, why: 'the skin change was not confirmed' }); }, SKIN_MS);
      function done(r) { if (settled) return; settled = true; clearTimeout(timer); resolve(r); }
      function go() {
        if (settled) return;                                   // the game's cosmetics step answered after we gave up: send nothing
        pace().then(function () {
          if (settled) return;
          if (!((force || S.running) && ready() && !flight)) { done({ ok: false, refused: true, why: 'not connected' }); return; }
          S.log.push({ t: Date.now(), kind: 'skin' }); if (S.log.length > 200) S.log.shift();
          call(function (cb) { return NET().send(ids().skin, { skinId: id, special: 0 }, TARGET, cb); }).then(function (r) {
            if (r.timeout) { done({ ok: false, why: 'the skin change was not confirmed' }); return; }
            var d = parseD(r);
            if (r.s === 0 && (!d || d.ret == null || d.ret === 0)) { try { UD().UsingCastleFace = id; } catch (e) {} done({ ok: true }); }
            else done({ ok: false, refused: true, why: 'the game would not switch skins (' + (d && d.ret != null ? d.ret : r.s) + ')' });
          });
        });
      }
      try { req('ActivityController').ActivityController.Instance.tryOffCastleCos(go); } catch (e) { go(); }
    });
  }
  // One skin change at a time (Stop waits for the one under way).
  async function skinOp(fn) {
    while (S.skinBusy) await delay(50);
    S.skinBusy = true;
    try { return await fn(); } finally { S.skinBusy = false; }
  }
  // The skin we hold: {id, prev, tiles: {"x,y": arriveSec}, at}. Saved before the switch goes out, so a Stop or a
  // relaunch can always put the old skin back.
  function skinState() { return lsJSON(LS_SKIN + S.siteKey); }
  function saveSkin(v) { lsSet(LS_SKIN + S.siteKey, v ? JSON.stringify(v) : null); }
  // Right before a march that will go: wear the best gathering skin, when one is owned, beats the one worn and the
  // skin cap allows. A failed switch is not tried again this run. Returns true when a skin went on.
  function wearForMarch() {
    if (skinState() || S.skinFailed) return Promise.resolve(false);
    var best = C.bestSkin(ownedGatherSkins(), currentSkin());
    if (!best || !C.gate(S.log, Date.now(), 'skin').ok) return Promise.resolve(false);
    return skinOp(async function () {
      setFoot('Switching to your gathering skin...', 'ok');
      saveSkin({ id: best.id, prev: currentSkin(), tiles: {}, at: Date.now() });
      S.skinTries = 0;
      var r = await wearSkin(best.id);
      if (r.ok) { S.skinNote = ''; return true; }
      S.skinFailed = true;
      if (r.refused) saveSkin(null);                          // unknown: kept, the game may have switched
      S.skinNote = "Couldn't switch to your gathering skin: " + r.why + '. Sending without it.';
      return false;
    });
  }
  function holdTile(tile, arrive) { var h = skinState(); if (!h) return; h.tiles[tile] = arrive || 0; saveSkin(h); }
  // Every march of the batch has arrived (it is gathering, its arrival time has passed, or it is gone): skin back.
  // A hold with no march yet is kept 10 minutes. force (Stop): back now; a failure is told on the card.
  function returnSkin(force) {
    var h0 = skinState();
    if (!h0) return Promise.resolve();
    return skinOp(async function () {
      var h = skinState();
      if (!h) return;
      var mine = ourMarches(), now = serverSec(), tiles = Object.keys(h.tiles || {});
      var waiting = tiles.filter(function (t) { var m = mine[t]; return m && !m.gathering && !(m.arrive && now >= m.arrive + 2); });
      if (!force && (waiting.length || (!tiles.length && Date.now() - (h.at || 0) < HOLD_MS))) return;
      if (currentSkin() !== Number(h.id)) { saveSkin(null); return; }   // the player changed it (or it never went on): leave it
      setFoot('Putting your base skin back...', 'ok');
      var r = await wearSkin(Number(h.prev), force);
      if (r.ok) { saveSkin(null); S.skinTries = 0; S.skinNote = ''; return; }
      S.skinTries = (S.skinTries || 0) + 1;
      if (force) { S.skinNote = 'Switch your base skin back: ' + r.why + '.'; return; }   // kept: the next launch tries again
      if (S.skinTries >= 3) { saveSkin(null); S.skinFailed = true; S.skinNote = 'Switch your base skin back: ' + r.why + '.'; }
    });
  }

  // ---------------------------------------------------------------- state
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch (e) { return null; } }
  var S = { running: false, stopped: false, siteKey: '', sent: {}, gone: {}, checked: {}, skinBusy: false, skinFailed: false, count: null, log: [], recent: [], held: [], facilities: 0, out: 0, cap: 0,
    sentRun: 0, foot: 'Starting...', tone: 'ok', last: '', note: '', noteTone: 'ok', skinNote: '', skinTries: 0, min: lsGet(LS_MIN) === '1', view: '',
    marches: Math.max(0, Number((lsJSON(LS_SET) || {}).marches) || 0) };       // 0 = all free
  function today() { return C.gameDay(Date.now()); }
  function todayCount() { return S.count && S.count.day === today() ? S.count.n || 0 : 0; }
  function bump() { S.count = { day: today(), n: todayCount() + 1 }; lsSet(LS_COUNT + S.siteKey, JSON.stringify(S.count)); }
  // Tiles we sent a march to, until the facility ends (one march per facility, the game's rule).
  function pruneSent() { var now = serverSec(); Object.keys(S.sent).forEach(function (k) { if (!(S.sent[k] > now)) delete S.sent[k]; }); }
  function remember(tile, untilSec) { S.sent[tile] = untilSec; lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent)); }
  function justSentHeroes() { var out = {}, now = Date.now(); S.held = S.held.filter(function (h) { return h.at > now - 30000; }); S.held.forEach(function (h) { h.heroes.forEach(function (id) { out[id] = 1; }); }); return out; }
  function reportUsage() {
    var name = '';
    try { name = String(UD().Name || '').slice(0, 40); } catch (e) {}
    try {
      fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: S.siteKey, name: name, tool: 'odin-gather', version: VERSION, count: todayCount(), day: today() }) }).catch(function () {});
    } catch (e) {}
  }
  function setFoot(text, tone) { S.foot = text; S.tone = tone || 'ok'; paint(); }
  function note(text, tone) { S.note = text; S.noteTone = tone || 'ok'; setFoot(text, S.noteTone); }
  // Our gathering marches out (the game's list plus our sends it doesn't show yet), and how many more we may send.
  function counts() {
    var mine = ourMarches(), n = Object.keys(mine).length, now = Date.now();
    S.recent = S.recent.filter(function (r) { return r.at > now - UNSHOWN_MS; });
    var unshown = 0;
    S.recent.forEach(function (r) { if (mine[r.tile]) r.seen = true; else if (!r.seen) { n++; unshown++; } });
    var m = marches(), cap = S.marches > 0 ? Math.min(S.marches, m.max) : m.max;
    S.out = n; S.cap = cap;
    return { out: n, cap: cap, free: Math.max(0, Math.min(cap - n, m.max - m.used - unshown)), mine: mine };
  }

  // ---------------------------------------------------------------- requests
  var flight = null;
  function call(send) {
    return new Promise(function (resolve) {
      var done = false, ok, mine = { at: Date.now() };
      flight = mine;
      var land = function () { if (flight === mine) flight = null; };
      var t = setTimeout(function () { if (!done) { done = true; land(); resolve({ timeout: true }); } }, TIMEOUT_MS);
      try { ok = send(function (r) { land(); if (done) return; done = true; clearTimeout(t); resolve(r || { s: -1 }); }); } catch (e) { ok = false; }
      if (ok === false && !done) { land(); done = true; clearTimeout(t); resolve({ s: 'blocked' }); }
    });
  }
  // One request clock for every Ops tool in this tab: 1.5-2.5 s after the last request any of them sent.
  function pace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 }), gap = window.__ODIN_GAP_MS || 1500;
    var jitter = FAST ? 0 : Math.floor(Math.random() * 1000);
    return new Promise(function (resolve) {
      (function check() { var wait = P.at + gap + jitter - Date.now(); if (wait <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(wait, 1000)); })();
    });
  }
  async function turn() { await pace(); return S.running && ready() && !flight; }
  // Another tool's request of the same kind still waiting for the game: a wait, never a strike and never a resend.
  function busy(rid) { try { var N = NET(); return typeof N.checkRequestIdNoRes === 'function' && !!N.checkRequestIdNoRes(rid); } catch (e) { return false; } }
  function answerText(a) { var k = a && typeof a.d === 'string' && /^[a-z0-9_]+$/i.test(a.d) ? a.d : ''; return gameText(k) || ('the game answered ' + (a && a.s) + (k ? ' (' + k + ')' : '')); }
  function parseD(a) { var d = a && a.d; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } } return d; }
  // A capped request: the clock, a fresh check, then the send. Returns the answer, or {skip: reason} when not sent.
  async function ask(kind, rid, payload) {
    var g = C.gate(S.log, Date.now(), kind);
    if (!g.ok) return { skip: 'cap', gate: g };
    if (!(await turn())) return { skip: 'offline' };
    if (busy(rid)) return { skip: 'busy' };
    S.log.push({ t: Date.now(), kind: kind }); if (S.log.length > 200) S.log.shift();
    return call(function (cb) { return NET().send(rid, payload, TARGET, cb); });
  }

  // ---------------------------------------------------------------- the loop
  function mmss(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  async function waitFor(ms, text, tone) {
    var at = Date.now() + ms;
    while (S.running && Date.now() < at) {
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(1000); continue; }
      await returnSkin(false);
      counts();
      setFoot(text + (FAST ? '' : ' ' + mmss(Math.max(1, Math.ceil((at - Date.now()) / 1000)))), tone);
      await delay(FAST ? 50 : 1000);
    }
  }
  async function run() {
    while (S.running) {
      if (!ready()) { setFoot('Game disconnected. Waiting...', 'bad'); await delay(FAST ? 100 : 1000); continue; }
      await returnSkin(false);
      if (!S.running) return;
      var c = counts();
      if (c.free <= 0) { await waitFor(WAIT_MS, c.out ? c.out + ' marches gathering. Next look in' : 'No free march. Next look in', 'ok'); continue; }
      var sent = await round(c);
      if (!S.running) return;
      if (S.paused) { var p = S.paused; S.paused = null; await waitFor(Math.max(1000, p.until - Date.now()), 'Paused: ' + p.reason + '. Goes on in', 'warn'); continue; }
      await waitFor(sent ? (FAST ? 200 : 3000) : WAIT_MS, (S.note ? S.note + ' ' : '') + 'Next look in', S.noteTone);
    }
  }
  // One round: open facilities from the log, the map views and facility infos they need, then the marches.
  async function round(c) {
    S.note = ''; S.noteTone = 'ok';
    pruneSent();
    var aid = myAid(), now = serverSec(), mine = c.mine;
    var since = Date.now() - CHECK_MS;
    Object.keys(S.checked).forEach(function (k) { if (S.checked[k] < since) delete S.checked[k]; });
    var open0 = logList().filter(function (f) { var t = f.x + ',' + f.y; return !mine[t] && !S.sent[t] && !(S.gone[t] && S.gone[t] >= f.at); });
    var cands = open0.filter(function (f) { return !S.checked[f.x + ',' + f.y]; });   // checked lately and got no march: later
    S.facilities = open0.length;
    if (!aid) { note("You're not in an alliance.", 'warn'); return 0; }
    if (!cands.length) { note(open0.length ? 'Waiting to check the Refine Centers again.' : 'No open Refine Centers to send to.', 'ok'); return 0; }
    if (!unitsHome()) { note('No units at home to send.', 'ok'); return 0; }
    var I = ids(), open = [];
    // map views: one per cluster (a view shows 25 x 30 tiles around its centre)
    var left = cands.slice();
    while (left.length && open.length < c.free * 2 && S.running) {
      var ctr = left[0];
      setFoot('Looking at Refine Centers near ' + ctr.x + ', ' + ctr.y + '...', 'ok');
      var v = await ask('view', I.view, { x: ctr.x, y: ctr.y, k: homeServer(), rid: 0, width: 25, height: 30, marchInfo: true, viewLevel: 0 });
      if (v.skip) return skipped(v);
      if (v.timeout) { note("The map didn't answer. Looking again shortly.", 'warn'); return 0; }
      if (v.s != null && v.s !== 0) { stop(answerText(v)); return 0; }
      var towers = C.towersInView(v, aid), byTile = {};
      towers.forEach(function (t) { byTile[t.x + ',' + t.y] = t; });
      var inView = left.filter(function (f) { return Math.abs(f.x - ctr.x) <= 12 && Math.abs(f.y - ctr.y) <= 15; });
      inView.forEach(function (f) { var t = byTile[f.x + ',' + f.y]; if (t) open.push({ f: f, tower: t }); else S.gone[f.x + ',' + f.y] = f.at; });
      left = left.filter(function (f) { return inView.indexOf(f) < 0; });
    }
    // facility infos: room and time left, best (longest time) first, only as many as the free marches need
    open.sort(function (a, b) { return b.f.at - a.f.at; });
    var ready2 = [];
    for (var i = 0; i < open.length && ready2.length < c.free && S.running; i++) {
      var o = open[i], tile = o.f.x + ',' + o.f.y;
      setFoot('Checking the Refine Center at ' + tile + '...', 'ok');
      var a = await ask('info', I.info, { id: o.tower.id });
      if (a.skip) return skipped(a);
      if (a.timeout) { note("A facility didn't answer. Looking again shortly.", 'warn'); return 0; }
      if (a.s !== 0) { stop(answerText(a)); return 0; }
      var d = parseD(a) || {}, fc = Number((table('map_building', C.BID) || {}).force_capacity) || 2500;
      var f = { x: o.f.x, y: o.f.y, tile: tile, itemId: d.ext && d.ext.itemId, free: fc - (Number(d.army_size) || 0), left: C.timeLeft(d.btime, serverSec(), Number((table('map_building', C.BID) || {}).duration) || C.DURATION) };
      var res = table('resource', f.itemId);
      f.speed = res ? Number(res.gather_speed) || 0 : 0;
      if (f.free < MIN_FREE || f.left < MIN_LEFT || !res || Number(d.aid) !== aid) { S.gone[tile] = o.f.at; continue; }
      ready2.push(f);
    }
    var list = C.rank(ready2), sent = 0;
    if (!list.length) { note('No Refine Center has room right now.', 'ok'); return 0; }
    for (var j = 0; j < list.length && S.running; j++) {
      var cn = counts();
      if (cn.free <= 0) break;
      var fac = list[j];
      if (cn.mine[fac.tile] || S.sent[fac.tile]) continue;
      var p = plan(fac);
      if (!p || !p.units) { noMarch(list.slice(j), p); break; }
      var g = C.gate(S.log, Date.now(), 'march');
      if (!g.ok) { S.paused = { until: g.until, reason: g.reason }; break; }
      if (busy(I.march)) { note('The game is busy with a march. Trying again shortly.', 'warn'); break; }
      if (await wearForMarch()) {                                  // the skin's bonus changes the speed: plan again
        if (!S.running) break;
        p = plan(fac);
        if (!p || !p.units) { noMarch(list.slice(j), p); break; }
      }
      if (!S.running) break;
      setFoot('Sending ' + p.units + ' units to ' + fac.tile + '...', 'ok');
      if (!(await turn())) break;
      if (busy(I.march)) { note('The game is busy with a march. Trying again shortly.', 'warn'); break; }
      if (ourMarches()[fac.tile]) continue;                       // the wait can be long: ours by now?
      remember(fac.tile, serverSec() + fac.left);                  // before the request: a lost answer never brings a second march
      S.log.push({ t: Date.now(), kind: 'march' }); if (S.log.length > 200) S.log.shift();
      var army = p.army.map(function (x) { return { pos: x.pos, armyId: x.armyId, armyNum: x.armyNum }; });
      var r = await call(function (cb) { return NET().send(I.march, { marchType: I.type, x: fac.x, y: fac.y, armyList: army, armyListNew: army.map(function (x) { return { pos: x.pos, armyId: x.armyId, armyNum: x.armyNum }; }),
        heroList: p.heroes, trapList: [], break: 0, formation: 0, formationV2: 0, extraArmy: {} }, TARGET, cb); });
      var k = C.classify(r);
      if (k === 'silent') { stop("the game didn't answer a march"); return sent; }
      if (k === 'slow') {                                          // the server's "Too fast!": wait and try that march again (Tex)
        S.slow = (S.slow || 0) + 1;
        if (S.slow >= C.SLOW_MAX) { stop(answerText(r)); return sent; }
        delete S.sent[fac.tile]; lsSet(LS_SENT + S.siteKey, JSON.stringify(S.sent));   // it didn't go: the facility is free again
        S.paused = { until: Date.now() + (window.__ODIN_SLOW_MS || C.SLOW_MS), reason: 'the game asked to slow down' };
        break;
      }
      if (k === 'refused') { stop(answerText(r)); return sent; }
      S.slow = 0;
      var md = parseD(r) || {}, mi = md.marchInfo || {};
      sent++; S.sentRun++; bump();
      S.recent.push({ tile: fac.tile, at: Date.now() });
      S.held.push({ at: Date.now(), heroes: p.heroes.slice() });
      holdTile(fac.tile, Number(mi.marchArrive) || 0);
      S.last = 'Sent ' + p.units + ' units to ' + fac.tile + ' · fills in ' + mmss(p.seconds);
      reportUsage(); paint();
      var t0 = Date.now();                                          // let the game list the march (and free the heroes and units) first
      while (S.running && Date.now() - t0 < SHOW_MS && !ourMarches()[fac.tile]) await delay(FAST ? 20 : 200);
    }
    if (sent) note('Sent ' + sent + '.', 'ok');
    return sent;
  }
  // Checked, but no march can go (no units free, or the facility's Odinium unknown): not checked again for 10 minutes.
  // A wait for the game or a cap is not this: those facilities are checked again next round.
  function noMarch(rest, p) {
    var at = Date.now();
    (p ? rest : rest.slice(0, 1)).forEach(function (f) { S.checked[f.tile] = at; });
    note(p ? 'No units free to send.' : "Couldn't read this facility's Odinium.", 'warn');
  }
  function skipped(r) {
    if (r.skip === 'cap') S.paused = { until: r.gate.until, reason: r.gate.reason };
    else if (r.skip === 'busy') note('The game is busy. Trying again shortly.', 'warn');
    return 0;
  }

  // ---------------------------------------------------------------- start / stop
  // Stop sends nothing more. When a gathering skin is held, it waits for a skin change under way, then puts the old skin
  // back; until then the tool still counts as running, so a second copy can't start meanwhile.
  function stop(reason) {
    if (S.stopped) return;
    S.stopped = true; S.running = false;
    var finish = function () {
      window.__ODIN.running = false;
      if (reason === 'stopped by you' && !S.skinNote) { removeRoot(); return; }
      showMessage((reason === 'stopped by you' ? 'Stopped.' : 'Odinium Gatherer stopped: ' + reason) + (S.skinNote ? ' ' + S.skinNote : ''), true);
    };
    if (!S.skinBusy && !(S.siteKey && skinState())) { finish(); return; }
    if (card && S.view === 'run') setFoot('Stopping: putting your base skin back...', 'ok');
    returnSkin(true).then(finish, function (e) { S.skinNote = S.skinNote || 'Switch your base skin back: ' + (e && e.message ? e.message : e) + '.'; finish(); });
  }

  // ---------------------------------------------------------------- the card
  var CSS = [
    '#odin-root{position:fixed;left:calc(8px + env(safe-area-inset-left));top:calc(84px + env(safe-area-inset-top));z-index:2147483000;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6edf3}',
    '#odin-root .odin-card{width:190px;box-sizing:border-box;background:#161b22;border:1px solid #a371f7;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:transform .2s}',
    '#odin-root .odin-card.warn{border-color:#d29922}#odin-root .odin-card.bad{border-color:#f85149}#odin-root .odin-card.flash{transform:scale(1.04)}',
    '#odin-root .odin-head{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}#odin-root .odin-title{flex:1;white-space:nowrap}',
    '#odin-root .odin-dot{width:8px;height:8px;border-radius:50%;background:#a371f7}#odin-root .warn .odin-dot{background:#d29922}#odin-root .bad .odin-dot{background:#f85149}',
    '#odin-root .odin-mini{display:none;font-variant-numeric:tabular-nums;color:#79c0ff}#odin-root .min .odin-mini{display:inline}',
    '#odin-root button,#odin-root select{font:inherit;color:#e6edf3;cursor:pointer}',
    '#odin-root button#odin-min{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#8b949e;display:grid;place-items:center}',
    '#odin-root button#odin-min:hover{color:#e6edf3;background:#1c2128}#odin-root #odin-min svg{transition:transform .2s}#odin-root .min #odin-min svg{transform:rotate(180deg)}',
    '#odin-root .odin-card.min{width:auto;padding:0 4px 0 12px}#odin-root .min .odin-body{display:none}#odin-root .min .odin-head{margin:0;height:44px;cursor:pointer}',
    '#odin-root .odin-stat{font-variant-numeric:tabular-nums}#odin-root .odin-sub{color:#8b949e;font-size:12px;font-variant-numeric:tabular-nums}',
    '#odin-root .odin-stat,#odin-root .odin-last,#odin-root .odin-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#odin-root .odin-skin{color:#d29922;font-size:12px;margin-top:4px}#odin-root .odin-skin:empty{display:none}',
    '#odin-root .odin-foot{color:#8b949e;font-size:12px;margin-top:6px;min-height:16px}#odin-root .odin-last{color:#79c0ff;font-size:12px;margin-top:2px}#odin-root .odin-last:empty{display:none}',
    '#odin-root .odin-set{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px;font-size:12px;color:#8b949e}',
    '#odin-root .odin-set select{min-height:32px;border:1px solid #30363d;border-radius:6px;background:#1c2128;padding:0 6px}',
    '#odin-root .odin-msg{margin:4px 0 2px}#odin-root .odin-btns{display:flex;gap:6px;margin-top:8px}',
    '#odin-root .odin-btns button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:8px;background:#1c2128}#odin-root .odin-btns button:hover{border-color:#79c0ff}'
  ].join('\n');
  var root = null, card = null, body = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function button(id, label, fn) { var b = el('button', null, label); b.id = id; b.type = 'button'; b.addEventListener('click', fn); return b; }
  function ensureRoot() {
    if (root && root.isConnected) return;
    var st = document.getElementById('odin-style');
    if (!st) { st = el('style'); st.id = 'odin-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
    var old = document.getElementById('odin-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    root = el('div'); root.id = 'odin-root';
    card = el('div', 'odin-card');
    var head = el('div', 'odin-head');
    head.appendChild(el('span', 'odin-title', 'Odinium Gatherer'));
    var mini = el('span', 'odin-mini'); mini.id = 'odin-mini'; mini.title = 'Marches out'; head.appendChild(mini);
    head.appendChild(el('span', 'odin-dot'));
    var mb = el('button'); mb.id = 'odin-min'; mb.type = 'button';
    mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMin(); });
    var NS = 'http://www.w3.org/2000/svg', ic = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
    ic.setAttribute('width', '18'); ic.setAttribute('height', '18'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
    pa.setAttribute('d', 'M6 9l6 6 6-6'); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '2.2'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
    ic.appendChild(pa); mb.appendChild(ic); head.appendChild(mb);
    head.addEventListener('click', function () { if (card.classList.contains('min')) toggleMin(); });
    body = el('div', 'odin-body');
    card.appendChild(head); card.appendChild(body); root.appendChild(card);
    document.body.appendChild(root);
    if (window.OpsDrag) window.OpsDrag.attach(root, { key: 'odin-gather', handle: '.odin-head' });
  }
  function removeRoot() { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; card = null; body = null; }
  function setView(v) {
    S.view = v;
    var mb = document.getElementById('odin-min');
    if (mb) { mb.hidden = v !== 'run'; mb.setAttribute('aria-label', S.min ? 'Show Odinium Gatherer' : 'Minimize Odinium Gatherer'); mb.setAttribute('aria-expanded', String(!S.min)); }
  }
  function toggleMin() {
    if (foldTap()) { paint(); return; }                // a fold made for room or by a drag: not the player's choice
    S.min = !S.min; lsSet(LS_MIN, S.min ? '1' : null); setView(S.view); paint();
  }
  // Tools that run together keep their cards apart (ops-stack.js); without the helper the card stays at its own spot.
  // The card's fold (review minor, 2026-10-16): the shared ops-stack.js rule (a fold made for room opens anyway until
  // the card has room again; a dragged bar stays a bar until opened), or the old rule when the helper didn't load.
  var FS = {};
  function foldOf(L) { var O = window.OpsStack; if (O && O.fold) return O.fold(FS, L, S.min); FS.last = !!L.fold; return !!(S.min || (L.fold && !FS.force)); }
  function foldTap() { var O = window.OpsStack; if (O && O.foldTap) return O.foldTap(FS, S.min); if (!S.min && FS.last) { FS.force = !FS.force; return true; } return false; }
  function where() { return window.OpsStack ? window.OpsStack.layout(root, 'odin-gather', !!(card && /\bmin\b/.test(card.className)), paint) : { placed: true, top: '', left: '', right: '', fold: false }; }
  function place(L) {
    if (!root || L.placed) return;
    if (root.style.top !== L.top) root.style.top = L.top;
    if (root.style.left !== L.left) root.style.left = L.left;
    if (root.style.right !== L.right) root.style.right = L.right;
  }
  function marchOptions(sel) {
    var max = Math.max(1, marches().max), want = S.marches;
    sel.textContent = '';
    var all = el('option', null, 'All free'); all.value = '0'; sel.appendChild(all);
    for (var n = 1; n <= max; n++) { var o = el('option', null, String(n)); o.value = String(n); sel.appendChild(o); }
    sel.value = String(want > max ? max : want);
  }
  function showRun() {
    ensureRoot(); body.textContent = ''; setView('run');
    root.removeAttribute('data-ops-stopped');
    var st = el('div', 'odin-stat'); st.id = 'odin-stat'; body.appendChild(st);
    var sub = el('div', 'odin-sub'); sub.id = 'odin-sub'; body.appendChild(sub);
    var foot = el('div', 'odin-foot'); foot.id = 'odin-foot'; body.appendChild(foot);
    var last = el('div', 'odin-last'); last.id = 'odin-last'; body.appendChild(last);
    var skn = el('div', 'odin-skin'); skn.id = 'odin-skin'; body.appendChild(skn);   // a skin problem stays in view (its own line)
    var set = el('label', 'odin-set'); set.appendChild(el('span', null, 'Marches'));
    var sel = el('select'); sel.id = 'odin-marches'; marchOptions(sel);
    sel.addEventListener('change', function () { S.marches = Math.max(0, Number(sel.value) || 0); lsSet(LS_SET, JSON.stringify({ marches: S.marches })); counts(); paint(); });
    set.appendChild(sel); body.appendChild(set);
    var btns = el('div', 'odin-btns');
    btns.appendChild(button('odin-stop', 'Stop', function () { stop('stopped by you'); }));
    body.appendChild(btns);
    paint();
  }
  function showMessage(text, withClose) {
    ensureRoot(); body.textContent = ''; setView('message');
    if (withClose) root.setAttribute('data-ops-stopped', '1'); else root.removeAttribute('data-ops-stopped');   // stopped: the Ops Center's tile says so (review minor)
    body.appendChild(el('div', 'odin-msg', text));
    if (withClose) { var btns = el('div', 'odin-btns'); btns.appendChild(button('odin-close', 'Close', removeRoot)); body.appendChild(btns); }
    card.className = 'odin-card';
  }
  function put(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) { e.textContent = text; e.title = text; } }
  function paint() {
    if (!card || S.view !== 'run') return;
    put('odin-stat', 'Out ' + S.out + ' / ' + S.cap + ' · Sent ' + todayCount() + ' today');
    put('odin-sub', 'Refine Centers open: ' + S.facilities);
    put('odin-foot', S.foot);
    put('odin-last', S.last);
    put('odin-skin', S.skinNote);
    put('odin-mini', S.out + '/' + S.cap);
    var L = where(), folded = foldOf(L);
    var tt = card.querySelector('.odin-title'), tx = folded ? 'Odinium' : 'Odinium Gatherer';
    if (tt && tt.textContent !== tx) tt.textContent = tx;
    card.className = 'odin-card' + (S.tone === 'ok' ? '' : ' ' + S.tone) + (folded ? ' min' : '');
    place(L);
  }

  // ---------------------------------------------------------------- start
  window.__ODIN = {
    running: true, version: VERSION,
    stop: function (reason) { stop(reason || 'stopped by you'); },
    flash: function () { if (!card) return; card.classList.add('flash'); setTimeout(function () { if (card) card.classList.remove('flash'); }, 600); },
    state: function () { return { out: S.out, cap: S.cap, sentRun: S.sentRun, facilities: S.facilities, foot: S.foot, last: S.last, sent: Object.keys(S.sent).length, skin: skinState() }; },
    plan: function (x, y) { return plan({ x: x, y: y, itemId: arguments[2], free: arguments[3] || 2500, left: arguments[4] || 36000 }); }   // a preview for live checks; sends nothing
  };
  ensureRoot();
  showMessage('Starting...');
  var id = ''; try { var u = UD(); id = String(u.StrUid || u._uid || ''); } catch (e) {}
  if (!id) { showMessage('Open the game and log in first, then try again.', true); window.__ODIN.running = false; return; }
  sha256Hex(id).then(function (h) {
    S.siteKey = h.slice(0, 16);
    S.count = lsJSON(LS_COUNT + S.siteKey);
    S.sent = lsJSON(LS_SENT + S.siteKey) || {};
    if (typeof S.sent !== 'object' || Array.isArray(S.sent)) S.sent = {};
    S.running = true;
    showRun();
    reportUsage();
    run().catch(function (e) { stop('something went wrong: ' + (e && e.message ? e.message : e)); });
  }, function () { showMessage('This browser cannot run Odinium Gatherer.', true); window.__ODIN.running = false; });
})();
