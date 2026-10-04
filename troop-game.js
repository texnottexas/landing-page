// troop-game.js — Top War client adapter for the 2864tw.com Troop Optimizer.
// Browser only; runs inside h5.topwargame.com. Exposes window.TroopGame.
// Every request goes through the game's own NET layer with the same payloads the
// client sends when a player drags a unit or building (verified live 2026-10-03).
(function () {
  'use strict';
  var req = window.__require;
  var RID = { BUILD_MOVE: 104, ARMY_MOVE: 110, ARMY_STORE_SINGLE: 226, GET_WAREHOUSE_INFO: 137,
    BUILD_BUILDING: 100, DELETE_BUILDING: 111, DELETE_ARMY: 112, WAREHOUSE_DELETE_ARMYS: 139, BATCH_BUILD_ORDER: 180,
    ARMY_WAREHOUSE_BATCH_MERGE: 219, ARMY_OUT_WAREHOUSE_BATCH_MERGE: 224, USE_CASTLE_FACE: 855 };
  var GROUP = { army: 1040, air: 1050, navy: 1100 };          // Barracks, Air Base, Shipyard
  var MPT_ARMY = 20181001, BIT_ARMY = 2;                    // MapPointType.Army, BaseItemType.Army
  var WH_TYPE = { army: 16, navy: 17, air: 18 }, ARMY_TYPE = { army: 101, navy: 201, air: 301 };
  var HIGHS_VER = '1.8.0';
  var config = {
    paceMs: [500, 400],            // 0.5 to 0.9 s after each server answer: quick, but never several a second
    responseTimeoutMs: 6000,       // per request
    storeConfirmMs: 3000,          // wait for the server push that moves a stored unit off the map
    skinConfirmMs: 30000,          // the player may have to confirm removing a temporary cosmetic first
    solverTimeoutMs: 20000         // per solver file download
  };

  function hm() { var n = window.cc && cc.find('Canvas/HomeMap'); return n ? n.getComponent('HomeMap') : null; }
  function UD() { return req('DataCenter').DATA.UserData; }
  function TABLE() { return req('TableManager').TABLE; }
  function NET() { return req('NetMgr').NET; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter() { return config.paceMs[0] + Math.floor(Math.random() * config.paceMs[1]); }

  function parseD(r) { try { return typeof r.d === 'string' ? JSON.parse(r.d) : r.d; } catch (e) { return null; } }
  function text(key) { try { var L = req('LocalManager'); return (L.LOCAL || L.default).getText(key); } catch (e) { return key; } }
  function warehouseIds(role) {
    var U = UD();
    return (U._wareHouseList || []).map(function (w) { return w.id; }).filter(function (id) {
      var b = U.getBuildingById(id); return b && b.Data && b.Data.type === WH_TYPE[role];
    });
  }

  // The game's own player id (StrUid getter, _uid behind it); '' when not logged in.
  function accountId() { var U = UD(); var id = U && (U.StrUid || U._uid); return id ? String(id) : ''; }

  // _ArmyComplete only flips when the last unit lands on the map, so a base whose units are all in
  // storage never sets it: count the base as loaded once every on-map unit has its map item.
  // endTime is -1 for a permanent skin, otherwise its expiry in server seconds (0 = no expiry).
  function ownedSkinIds(faces, now) {
    return Object.keys(faces || {}).map(Number).filter(function (id) {
      var e = (faces[id] || {}).endTime;
      return id > 0 && !(e > 0 && e < now);
    }).sort(function (a, b) { return a - b; });
  }

  function isReady() {
    var h = hm();
    if (!(h && h.armyInited && h._BuildingComplete)) return false;
    if (h._ArmyComplete) return true;
    var onMap = (UD().Armys || []).filter(function (a) { return String(a.warehouseId) === '0'; });
    return onMap.every(function (a) { return !!(h.ArmyItems || {})[a._id]; });
  }

  // ---------------------------------------------------------------- read
  function readSnapshot() {
    var h = hm();
    if (!h) throw new Error('Open your base first, then run this again.');
    var U = UD(), HMC = req('HomeMapCommon'), Tmx = req('NHomeMapTmx').default, GT = req('GameTools').default;
    var W = HMC.HomeMapCommon.WidthCount, H = HMC.HomeMapCommon.HeightCount, BT = HMC.HomeMapTileBlockTypeTable;
    var free = U.HomeFreePoints, hip = U.HomeItemPoints, hop = U.HomeObstaclePoints || {}, gp = U.GroundPoints || {};
    var cells = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if ((x + y) % 2) continue;
      var id = 1000 * x + y, tp = Tmx.getTilePos(x, y), it = hip[id];
      cells.push([x, y, Tmx.getTileValue(tp.x, tp.y, 0), Tmx.isBlocked(tp.x, tp.y) ? 1 : 0, free[id] ? 1 : 0,
        it ? it.itemType : 0, gp[id] ? 1 : 0, BT[id] == null ? -1 : BT[id], hop[id] ? 1 : 0]);
    }
    var buildings = [];
    h.BuildingItems.forEach(function (i) {
      var bd = i.BuildingData, d = bd && bd.Data;
      if (!d) return;
      buildings.push({ id: String(bd._id), pos: bd._pos, w: d.width, h: d.height, group: d.group, type: d.type, pt: d.point_type, unmovable: d.unmovable ? 1 : 0,
        level: d.level, busy: (bd._curProductNum || 0) > 0 ? 1 : 0, queued: bd._curProductNum || 0 });
    });
    var units = [], stored = [];
    U.Armys.forEach(function (a) {
      if (!a._data) return;
      var d = a._data;
      if (String(a.warehouseId) !== '0') {
        stored.push({ id: String(a._id), armyId: a._armyId, type: d.type, level: d.level, w: d.width, h: d.height, pt: d.point_type, state: a._state || 0, wh: String(a.warehouseId) });
        return;
      }
      units.push({ id: String(a._id), armyId: a._armyId, type: d.type, level: d.level, w: d.width, h: d.height, pt: d.point_type, pos: a._pos, state: a._state || 0 });
    });
    var T = TABLE(), faces = U._MyCastleFace || {}, now = req('DataCenter').DATA.ServerTime, owned = [];
    ownedSkinIds(faces, now).forEach(function (id) {
      var row = T.getTableDataById('skin', String(id));
      if (row) owned.push({ id: id, equip_buff: row.equip_buff || '', name: text(row.name) });
    });
    var buildable = {};
    [GROUP.army, GROUP.air, GROUP.navy].forEach(function (g) {
      var b = U.getBuildBuildingWithScience(g);
      if (b) buildable[g] = { id: b.id, level: b.level, build_coin: Number(b.build_coin) || 0, produce_coin: Number(b.produce_coin) || 0, pt: b.point_type };
    });
    var warehouses = {}; Object.keys(ARMY_TYPE).forEach(function (k) { warehouses[k] = warehouseIds(k); });
    GT.wareHouseDirty();
    var storage = {};
    Object.keys(ARMY_TYPE).forEach(function (k) {
      if (GT.wareHouseSpaceCache) delete GT.wareHouseSpaceCache[ARMY_TYPE[k]];
      var max = GT.getWarehouseMaxSpace(WH_TYPE[k]) || 0, empty = GT.getWareHouseEmptySpace(ARMY_TYPE[k]) || 0;
      storage[k] = { max: max, used: Math.max(0, max - empty) };
    });
    var mergeCap = {};
    Object.keys(ARMY_TYPE).forEach(function (k) { mergeCap[k] = U.getMergeArmyMaxLevel(ARMY_TYPE[k]); });
    return {
      v: 1, W: W, H: H, cellFields: 'x,y,terrain,tmxBlocked,free,itemType,floor,block,obstacle',
      cells: cells, buildings: buildings, units: units, storage: storage, mergeCap: mergeCap,
      instantPool: U.getFreeArmyBuildAmt(), slotAdvice: slotAdvice(),
      stored: stored, skins: { owned: owned, current: U._UsingCastleFace }, gold: U.Resource.getResource(1),
      buildable: buildable, warehouses: warehouses, uid: accountId()
    };
  }

  // Advisory only: slot items held and the next slot price per storage building.
  function slotAdvice() {
    var U = UD(), GT = req('GameTools').default, T = TABLE();
    var itemId = Number(GT.getDataConfigData(23131));
    var held = U.getItemAmount(itemId) || 0, out = { held: held, byType: {} };
    (U._wareHouseList || []).forEach(function (w) {
      var b = U.getBuildingById(w.id); if (!b || !b.Data) return;
      var row = T.getTableDataById('player_level', String(w.addLatticeNum + 1));
      var key = b.Data.type === 16 ? 'army' : b.Data.type === 17 ? 'navy' : 'air';
      (out.byType[key] = out.byType[key] || []).push({ added: w.addLatticeNum, nextPrice: row ? row.lattice_price : null });
    });
    return out;
  }

  // ---------------------------------------------------------------- solver
  // Pinned solver build. Both files are hash-checked before anything runs, so a changed or
  // tampered CDN copy is refused (same guarantee as <script integrity>, which a bookmarklet can't use here).
  var HIGHS_SHA384 = {
    js: 'TuRRrTGgc1fvxkUfyHE5NU0JOtUfCV9LzQ6nLhIGaGFtv37yuaq6d9SGfWDnZEYC',
    wasm: 'GUtADNG050fidOckKDIbEOun85rmjmpp7gSdTubD9r+4fIpiWzRHcm/aTJGWQaI/'
  };
  function sha384b64(buf) {
    return crypto.subtle.digest('SHA-384', buf).then(function (d) {
      var s = '', b = new Uint8Array(d);
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s);
    });
  }
  function fetchVerified(url, hash) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, config.solverTimeoutMs) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      if (!r.ok) throw new Error('solver download failed (' + r.status + ')');
      return r.arrayBuffer();
    }, function (e) {
      throw (e && e.name === 'AbortError') ? new Error('solver download timed out') : e;
    }).then(function (buf) {
      if (timer) clearTimeout(timer);
      return sha384b64(buf).then(function (h) {
        if (h !== hash) throw new Error('solver file did not match its pinned checksum');
        return buf;
      });
    });
  }
  var highsPromise = null;
  function loadHighs() {
    if (highsPromise) return highsPromise;
    var base = 'https://cdn.jsdelivr.net/npm/highs@' + HIGHS_VER + '/build/';
    highsPromise = Promise.all([fetchVerified(base + 'highs.js', HIGHS_SHA384.js), fetchVerified(base + 'highs.wasm', HIGHS_SHA384.wasm)])
      .then(function (bufs) {
        var src = new TextDecoder().decode(bufs[0]);
        // Verified library source only (no interpolation). Private scope: the build declares
        // `var Module`, which must not leak into the game page.
        var module = { exports: {} };
        (new Function('module', 'exports', src))(module, module.exports);
        var factory = module.exports;
        // Compile once, but give every solve a fresh instance: an instance that aborts on one
        // model fails every later solve, so it must never be reused.
        return WebAssembly.compile(bufs[1]).then(function (wasmModule) {
          return {
            solve: function (lp, opts) {
              return factory({
                instantiateWasm: function (imports, receive) {
                  WebAssembly.instantiate(wasmModule, imports).then(function (inst) { receive(inst, wasmModule); });
                  return {};
                }
              }).then(function (hs) { return hs.solve(lp, opts); });
            }
          };
        });
      });
    highsPromise.catch(function () { highsPromise = null; });
    return highsPromise;
  }
  function solve(lp, timeLimitSec) {
    return loadHighs().then(function (hs) { return hs.solve(lp, { time_limit: timeLimitSec || 20, mip_rel_gap: 0 }); });
  }

  // ---------------------------------------------------------------- execute
  function send(rid, payload) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve({ s: -1, d: 'timeout' }); } }, config.responseTimeoutMs);
      NET().send(rid, payload, hm(), function (e) { if (done) return; done = true; clearTimeout(t); resolve(e || { s: -1 }); });
    });
  }

  function validateUnit(item, x, y) {
    var A = item.ArmyData && item.ArmyData.Data;
    return !!A && hm().checkNearByPos(cc.v2(x, y), 0, 0, -1, A.width, A.height, A.point_type, MPT_ARMY, BIT_ARMY, A.id, -1, []) !== -1;
  }
  function validateBuilding(item, x, y) {
    var d = item.BuildingData && item.BuildingData.Data;
    return !!d && !d.unmovable && hm().checkNearByPos(cc.v2(x, y), 0, 0, -1, d.width, d.height, d.point_type, item.ItemMPType, item.ItemType, d.id, -1, []) !== -1;
  }

  async function storeUnit(item, role) {
    var U = UD(), h = hm();
    var ids = (U._wareHouseList || []).map(function (w) { return w.id; }).filter(function (id) {
      var b = U.getBuildingById(id); return b && b.Data && b.Data.type === WH_TYPE[role];
    });
    for (var i = 0; i < ids.length; i++) {
      var r = await send(RID.ARMY_STORE_SINGLE, { buildId: String(ids[i]), armyId: String(item.ID) });
      if (r.s !== 0) continue;
      if (await storedConfirmed(item.ID)) return r;
      return { s: -3, msg: 'The game did not confirm the unit went to storage.' };
    }
    return { s: -2, msg: 'No storage building accepted the unit.' };
  }
  // the server pushes the unit's new warehouse; until then it still counts as on the base
  async function storedConfirmed(id) {
    var t0 = Date.now();
    while (Date.now() - t0 <= config.storeConfirmMs) {
      var rec = UD().Armys.filter(function (a) { return String(a._id) === String(id); })[0];
      if (!rec || String(rec.warehouseId) !== '0') return true;
      await delay(100);
    }
    return false;
  }

  // steps from TroopCore.planSteps. hooks: { onStep(i, step, result), shouldStop() }
  // One run at a time; stop() ends the run in progress after its current step.
  var running = false, stopRequested = false;
  function stop() { if (running) stopRequested = true; }
  function isRunning() { return running; }
  async function runSteps(steps, hooks) {
    if (running) return { ok: false, done: 0, error: 'A run is already in progress.' };
    running = true; stopRequested = false;
    try { return await runAll(steps, hooks || {}); } finally { running = false; stopRequested = false; }
  }
  async function runAll(steps, hooks) {
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i], h = hm(), r;
      if (!h || !isReady()) return { ok: false, done: i, error: 'Your base closed. Open it again and resume.' };
      if (stopRequested || (hooks.shouldStop && hooks.shouldStop())) return { ok: false, done: i, error: 'Stopped.' };
      try {
        r = await runOne(st, h);
      } catch (e) {
        return { ok: false, done: i, error: 'Something went wrong on step ' + (i + 1) + '. Tap Run to resume.' };
      }
      if (r && r.error) return { ok: false, done: i, error: r.error };
      if (hooks.onStep) hooks.onStep(i, st, r);
      if ((!r || r.s !== 0) && !st.tolerant) return { ok: false, done: i, error: (r && r.msg ? r.msg + ' ' : '') + 'The server declined step ' + (i + 1) + ' (code ' + (r ? r.s : '?') + ').' };
      if (i < steps.length - 1) await delay(jitter());
    }
    return { ok: true, done: steps.length };
  }
  async function runOne(st, h) {
    if (st.kind === 'store') {
      var u = h.ArmyItems[st.id];
      if (!u) return { error: 'A unit in the plan is no longer on the base. Plan again.' };
      return storeUnit(u, st.role);
    }
    if (st.kind === 'moveUnit') {
      var a = h.ArmyItems[st.id];
      if (!a) return { error: 'A unit in the plan is no longer on the base. Plan again.' };
      if (!validateUnit(a, st.to[0], st.to[1])) return { error: 'The game would not accept a unit at ' + st.to.join(',') + '. Plan again.' };
      var r1 = await send(RID.ARMY_MOVE, { x: st.to[0], y: st.to[1], id: String(st.id) });
      if (r1.s === 0) h.MoveArmyCallBack(r1);
      return r1;
    }
    if (st.kind === 'mergeStorage') {
      var wids = warehouseIds(st.role);
      return wids.length ? send(RID.ARMY_WAREHOUSE_BATCH_MERGE, { buildId: wids.join(',') }) : { s: 0 };
    }
    if (st.kind === 'mergeBase') return send(RID.ARMY_OUT_WAREHOUSE_BATCH_MERGE, { type: ARMY_TYPE[st.role] });
    if (st.kind === 'deleteStored' || st.kind === 'deleteUnit') {
      var ids = st.kind === 'deleteStored' ? st.ids : [st.id];
      if (!safeToDelete(ids)) return { error: 'Refused to delete: a unit is outside Lv10 to Lv99, busy, or gone. Plan again.' };
      return st.kind === 'deleteStored' ? send(RID.WAREHOUSE_DELETE_ARMYS, { ids: ids.map(String) }) : send(RID.DELETE_ARMY, { id: String(st.id) });
    }
    if (st.kind === 'equipSkin') return equipSkin(st.id);
    if (st.kind === 'build') {
      var row = TABLE().getTableDataById('building', String(st.buildingId));
      if (!row || h.checkNearByPos(cc.v2(st.to[0], st.to[1]), 0, 0, -1, row.width, row.height, row.point_type, 1, 1, row.id, -1, []) === -1) {
        return { error: 'The game would not accept a building at ' + st.to.join(',') + '. Plan again.' };
      }
      return send(RID.BUILD_BUILDING, { x: st.to[0], y: st.to[1], buildingId: row.id });
    }
    if (st.kind === 'train') return bulkTrain(st.role);
    if (st.kind === 'deleteBuilding') {
      var bi = h.getBuildingItemById(st.id);
      if (!bi || !bi.BuildingData) return { error: 'A building in the plan was not found. Plan again.' };
      if ((bi.BuildingData._curProductNum || 0) > 0) return { error: 'A training building is still training, so it was kept. Plan again.' };
      var r3 = await send(RID.DELETE_BUILDING, { id: String(st.id) });
      if (r3.s === 0) {
        var d3 = parseD(r3);
        if (d3 && d3.building) UD().DeleteBuilding(d3.building);
        h.removeBuildingFromMap(String(st.id));
      }
      return r3;
    }
    var b = h.getBuildingItemById(st.id);                  // park or moveBuilding
    if (!b) return { error: 'A building in the plan was not found. Plan again.' };
    if (!validateBuilding(b, st.to[0], st.to[1])) return { error: 'The game would not accept a building at ' + st.to.join(',') + '. Plan again.' };
    var r2 = await send(RID.BUILD_MOVE, { x: st.to[0], y: st.to[1], id: String(st.id) });
    if (r2.s === 0) h.MoveBuildingCallBack(r2);
    return r2;
  }

  // Defence in depth: whatever the plan says, only demoted Lv10-99 units that are idle can be deleted.
  function safeToDelete(ids) {
    var byId = {};
    UD().Armys.forEach(function (a) { byId[String(a._id)] = a; });
    return ids.length > 0 && ids.every(function (id) {
      var a = byId[String(id)];
      return !!a && !!a._data && a._data.level >= 10 && a._data.level <= 99 && !a._state;
    });
  }

  function equipSkin(id) {
    return new Promise(function (resolve) {
      var settled = false, timer = null;
      function done(r) { if (settled) return; settled = true; clearTimeout(timer); resolve(r); }
      function go() {
        if (settled) return;        // confirmed after we already reported a failure: change nothing
        send(RID.USE_CASTLE_FACE, { skinId: id, special: 0 }).then(function (r) {
          var d = parseD(r);
          if (r.s === 0 && d && d.ret === 0) { UD().UsingCastleFace = id; done({ s: 0 }); }
          else done({ s: r.s || -4, msg: 'The game would not switch to that skin here.' });
        });
      }
      timer = setTimeout(function () { done({ s: -1, msg: 'The skin change was not confirmed.' }); }, config.skinConfirmMs);
      try { req('ActivityController').ActivityController.Instance.tryOffCastleCos(go); } catch (e) { go(); }
    });
  }

  // The game's own Bulk Training for one type; its request carries no callback, so tap NET.send for the answer.
  function bulkTrain(role) {
    var U = UD(), blds = U.getBuildingArrayByBuildingGroup(GROUP[role]) || [];
    if (!blds.length) return Promise.resolve({ s: 0, skipped: true });
    var GT = req('GameTools').default;
    GT.wareHouseDirty();
    if (GT.wareHouseSpaceCache) delete GT.wareHouseSpaceCache[ARMY_TYPE[role]];
    var empty = GT.getWareHouseEmptySpace(ARMY_TYPE[role]) || 0;
    // The game's Bulk Training fills only the buildings at the level of the row it is given, so
    // hand it the highest level: older, lower-level buildings would train lower-level units.
    var T = TABLE(), row = null;
    blds.forEach(function (b) {
      var r = T.getTableDataById('building', String(b.BuildingId));
      if (r && (!row || (r.level || 0) > (row.level || 0))) row = r;
    });
    if (!row) return Promise.resolve({ s: -5, msg: 'Bulk Training could not start.' });
    var net = NET(), orig = net.send, sent = false;
    return new Promise(function (resolve) {
      var settled = false, timer = null;
      function done(r) { if (settled) return; settled = true; clearTimeout(timer); net.send = orig; resolve(r); }
      net.send = function (rid, payload, ctx, cb) {
        if (rid !== RID.BATCH_BUILD_ORDER) return orig.apply(this, arguments);
        sent = true;
        // With every queue full the game still sends an empty batch, which the server rejects
        // ("The parameter is incorrect."): that means nothing to queue, not a failure.
        var noIds = !(payload && payload.ids && payload.ids.length);
        return orig.call(this, rid, payload, ctx, function (e) { try { if (cb) cb.apply(this, arguments); } catch (x) {} done(noIds ? { s: 0, skipped: true } : (e || { s: -1 })); });
      };
      timer = setTimeout(function () { done(sent ? { s: -1, msg: 'No answer from Bulk Training.' } : { s: 0, skipped: true }); }, config.responseTimeoutMs);
      try { req('MainUiShortcutUtils').MainUiShortcutUtils._instance.batchTraining(row, empty); }
      catch (e) { done({ s: -5, msg: 'Bulk Training could not start.' }); }
      if (!sent && !settled) { clearTimeout(timer); done({ s: 0, skipped: true }); }     // nothing to train: queues full or no space
    });
  }

  // ---------------------------------------------------------------- lock
  var lock = null;
  function installLock(target, opts) {
    removeLock();
    var h = hm(); if (!h) return false;
    var T = TABLE(), TC = window.TroopCore;
    var origA = h.GetFreePosForArmy, origS = h.getFreePosFromScreenCenter;
    function pick(armyId, excl) {
      var A = T.getTableDataById('army', String(armyId));
      if (!A) return null;
      var list = TC.lockTargets(target, A.width, A.height, A.point_type, opts);
      if (!list) return null;                                  // not covered by the plan
      excl = excl || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (excl.indexOf(p) >= 0) continue;
        if (h.checkNearByPos(cc.v2(Math.floor(p / 1000), p % 1000), 0, 0, -1, A.width, A.height, A.point_type, MPT_ARMY, BIT_ARMY, A.id, -1, excl) !== -1) return p;
      }
      return -1;
    }
    h.GetFreePosForArmy = function (e, t, o) { var p = pick(t, o); return p === null ? origA.apply(this, arguments) : p; };
    h.getFreePosFromScreenCenter = function (e, t) { var p = pick(e, t); return p === null ? origS.apply(this, arguments) : p; };
    lock = { h: h, origA: origA, origS: origS };
    return true;
  }
  function removeLock() {
    if (!lock) return;
    lock.h.GetFreePosForArmy = lock.origA;
    lock.h.getFreePosFromScreenCenter = lock.origS;
    lock = null;
  }
  function lockActive() { return !!lock && lock.h === hm(); }

  window.TroopGame = {
    isReady: isReady, accountId: accountId, ownedSkinIds: ownedSkinIds, readSnapshot: readSnapshot, loadHighs: loadHighs, solve: solve,
    runSteps: runSteps, stop: stop, isRunning: isRunning, installLock: installLock, removeLock: removeLock, lockActive: lockActive,
    config: config
  };
})();
