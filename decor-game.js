// decor-game.js — the game side of the Decor Optimizer (Tex 2026-10-17). Browser only; runs inside the game page.
// read() takes one snapshot of every place decor can be (base, bag, showcase, collab box, completed sets, Advanced
// Upgrades) plus the base grid; decor-core.js plans from it. exec() (added later) runs one planned action with the
// game's own request. Exposes window.DecorGame.
(function () {
  'use strict';
  var BUFF_IN_BAG = 406;                                    // BuffType.DecorationActiveInBag (a set whose bag copies count)
  var UNIT = { 101: 1, 201: 2, 301: 3 };                    // effect_buff ArmyType -> 1 Army, 2 Navy, 3 Air Force
  // A stat tied to one unit's buildings: Barracks / Shipyard / Air Base groups, Garage / Dock / Hangar types.
  var UNIT_GROUP = { 1040: 1, 1100: 2, 1050: 3 }, UNIT_BTYPE = { 16: 1, 17: 2, 18: 3 };
  var HOME_BUTTON = 'UICanvas/WorldMapUIWrapper/NWorldMapUI/bottomNode/btn_Home';

  function req(n) { return window.__require(n); }
  function UD() { return req('DataCenter').DATA.UserData; }
  function TABLE() { return req('TableManager').TABLE; }
  function hm() { try { var n = window.cc && cc.find('Canvas/HomeMap'); return n ? n.getComponent('HomeMap') : null; } catch (e) { return null; } }
  function row(t, id) { try { return TABLE().getTableDataById(t, String(id)); } catch (e) { return null; } }
  function text(key) { try { var L = req('LocalManager'), t = (L.LOCAL || L.default).getText(key); return t ? String(t) : String(key); } catch (e) { return String(key); } }
  function cfg(id) { try { return req('GameTools').default.getDataConfigData(id); } catch (e) { return null; } }
  function pick(o, a, b) { return o[a] != null ? o[a] : o[b]; }    // the game's getters, or the fields behind them
  // Every row of a table, decoded (entries stay compressed strings until getTableDataById decodes them).
  function rowsOf(name) {
    var T = TABLE(), m = T._tableMap && T._tableMap[name];
    if (!m) { try { T.getTableGroup(name, true); } catch (e) {} m = T._tableMap && T._tableMap[name]; }
    if (!m) return [];
    return Object.keys(m).map(function (k) { var v = m[k]; return typeof v === 'string' || !v ? row(name, k) : v; })
      .filter(function (r) { return r && typeof r === 'object'; });
  }
  // group -> {level: id} for decor (types 4 and 5), built once per page: one pass over the building table.
  function levelIndex() {
    if (window.__dpoLevels) return window.__dpoLevels;
    var out = {};
    rowsOf('building').forEach(function (r) {
      if (r.type !== 4 && r.type !== 5) return;
      (out[r.group] = out[r.group] || {})[r.level] = r.id;
    });
    window.__dpoLevels = out;
    return out;
  }
  function buffs(r) {
    var out = [];
    [r.buff_id, r.buff_ext].forEach(function (s) {
      String(s || '').split(',').forEach(function (p) {
        var a = p.split('|'), id = Number(a[0]), v = Number(a[1]);
        if (id && v) out.push([id, v]);
      });
    });
    return out;
  }
  function rowInfo(r) {
    return { group: r.group, level: r.level, maxLevel: r.max_level, type: r.type, w: r.width, h: r.height, pt: r.point_type,
      cap: Number(r.buff_max_num) || 0, me: String(r.mutually_exclusive || '').split(',').map(Number).filter(Boolean),
      buffs: buffs(r), name: text(r.name), mp: r.type === 5 ? 5 : 4 };
  }
  function statInfo(e) {
    var unit = 0;
    [1, 2, 3, 4].forEach(function (i) {
      var k = e['paraType' + i], v = Number(e['para' + i]);
      if (k === 'ArmyType') unit = UNIT[v] || unit;
      else if (k === 'BuildingGroup') unit = UNIT_GROUP[v] || unit;
      else if (k === 'BuildingType') unit = UNIT_BTYPE[v] || unit;
    });
    return { unit: unit, battle: Number(e.battle_type) || 0, vt: Number(e.value_type) || 1, name: text(e.string) };
  }
  function bagType() { try { var v = req('GameDefine').BuffType.DecorationActiveInBag; return v != null ? v : BUFF_IN_BAG; } catch (e) { return BUFF_IN_BAG; } }

  // ---------------------------------------------------------------- the snapshot
  function read() {
    var U = UD(), HMC = req('HomeMapCommon'), Tmx = req('NHomeMapTmx').default;
    var W = HMC.HomeMapCommon.WidthCount, H = HMC.HomeMapCommon.HeightCount, BT = HMC.HomeMapTileBlockTypeTable;
    var free = U.HomeFreePoints || {}, occ = U.HomeItemPoints || {}, floor = U.GroundPoints || {};
    var cells = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if ((x + y) % 2) continue;
      var id = 1000 * x + y, zone = BT[id] == null ? -1 : Number(BT[id]), tp = Tmx.getTilePos(x, y);
      if (zone >= 0 && Tmx.isBlocked(tp.x, tp.y)) zone = -1;
      if (zone < 0) continue;
      cells.push([x, y, zone, Tmx.getTileValue(tp.x, tp.y, 0) === 15 ? 1 : 0, free[id] ? 1 : 0, occ[id] ? 1 : 0, floor[id] ? 1 : 0]);
    }
    var ids = {};
    function seen(id) { var r = row('building', id); if (r) ids[r.id] = r; return r; }
    var placed = [], buildings = [];
    (U.Buildings || []).forEach(function (b) {
      var d = pick(b, 'Data', '_data'), pos = Number(pick(b, 'Pos', '_pos'));
      if (!d) return;
      var x0 = Math.floor(pos / 1000), y0 = pos % 1000;
      if (d.type === 4 || d.type === 5) { seen(d.id); placed.push({ uuid: String(pick(b, 'Id', '_id')), id: d.id, x: x0, y: y0 }); }
      else buildings.push({ x: x0, y: y0, w: d.width, h: d.height });
    });
    var bag = [];
    (U.BuildBoxs || []).forEach(function (bx) {
      var n = Number(pick(bx, 'Amount', '_amount')) || 0, id = Number(pick(bx, 'ItemId', '_itemId')), d = pick(bx, 'Data', '_data') || row('building', id);
      if (n > 0 && d && (d.type === 4 || d.type === 5)) { seen(id); bag.push({ id: id, n: n }); }
    });
    var showcase = (U._museumData || U.MuseumData || []).map(function (l) {
      return { labelId: l.labelId, items: (l.labelStoreData || []).map(function (e) { seen(e.decorationId); return { uuid: String(e.uuid), id: Number(e.decorationId), x: e.x, y: e.y }; }) };
    });
    var box = U.collabDecorateBox || {};
    var collab = rowsOf('museum_linkage_box').map(function (r) {
      var have = box[r.ID] && box[r.ID].decorationId ? Number(box[r.ID].decorationId) : null;
      if (have) seen(have);
      return { slot: r.ID, group: r.groupID, id: have };
    });
    var sets = [], inBag = bagType();
    (U.DecorationSuits || U._DecorationSuits || []).forEach(function (s) {
      var c = row('decoration_contents', pick(s, 'SuitId', '_suitId'));
      if (!c || Number(c.buff_isopen) !== 1 || !c.buff) return;
      var e = row('effect_buff', String(c.buff).split('|')[0]);
      if (!e || Number(e.type) !== inBag) return;
      String(c.content || '').split('|').forEach(function (id) { var r = row('building', id); if (r && sets.indexOf(r.group) < 0) sets.push(r.group); });
    });
    var upgrades = [], E = U.DecorationExpandData;
    try {
      var dm = (E && E._dataMap) || {};
      (E && E.getStateList ? E.getStateList() : []).forEach(function (s) {
        var c = s.buildCfg || s.buildCfgLv1, sc = s.sublimationCfg || {};
        if (!c) return;
        var rec = dm[c.group] || {};
        upgrades.push({ group: c.group, state: Number(s.state), buildId: rec.buildId != null ? Number(rec.buildId) : null,
          exp: Number(s.exp != null ? s.exp : rec.sublime_exp) || 0, need: Number(sc.building_number) || 0, perNumber: Number(sc.per_number) || 1 });
      });
    } catch (e) {}
    // The level rows a plan can need: every owned group, up to the highest level its copies could reach by merging
    // (3 copies make the next level, so n Lv1-equivalents reach Lv 1 + log3(n)), and never below its highest copy.
    var all = levelIndex(), levels = {}, rows = {}, chips = {}, top = {};
    function own(id, n) { var r = ids[id]; if (!r) return; chips[r.group] = (chips[r.group] || 0) + n * Math.pow(3, r.level - 1); top[r.group] = Math.max(top[r.group] || 0, r.level); }
    placed.forEach(function (p) { own(p.id, 1); });
    bag.forEach(function (b) { own(b.id, b.n); });
    showcase.forEach(function (l) { l.items.forEach(function (e) { own(e.id, 1); }); });
    collab.forEach(function (c) { if (c.id) own(c.id, 1); });
    Object.keys(chips).forEach(function (g) {
      if (!all[g]) return;
      levels[g] = all[g];
      var reach = Math.max(top[g], 1 + Math.floor(Math.log(chips[g]) / Math.log(3) + 1e-9));
      Object.keys(all[g]).forEach(function (lv) { if (Number(lv) <= reach + 1) seen(all[g][lv]); });
    });
    var stats = {};
    Object.keys(ids).forEach(function (id) {
      var info = rowInfo(ids[id]);
      rows[id] = info;
      info.buffs.forEach(function (b) { if (!stats[b[0]]) { var e = row('effect_buff', b[0]); if (e) stats[b[0]] = statInfo(e); } });
    });
    return { grid: { w: W, h: H, cells: cells }, placed: placed, buildings: buildings, bag: bag, showcase: showcase, collab: collab,
      sets: sets, upgrades: upgrades, openLevel: Number(cfg(79010)) || 4, rows: rows, levels: levels, stats: stats };
  }

  // ---------------------------------------------------------------- the base
  function inBase() { var h = hm(); return !!(h && h._BuildingComplete); }
  function ready() {
    try { var U = UD(), s = req('NetMgr').NET._socket; return !!(U && U.Name) && !!(s && s._webSocket && s._webSocket.readyState === 1); } catch (e) { return false; }
  }
  // From the world map, press the game's own home button and wait until the base has finished loading.
  function goHome(timeoutMs) {
    if (inBase()) return Promise.resolve(true);
    var t0 = Date.now(), limit = timeoutMs || 20000;
    function wait() {
      return new Promise(function (resolve) {
        (function poll() {
          if (inBase()) { resolve(true); return; }
          if (Date.now() - t0 > limit) { resolve(false); return; }
          setTimeout(poll, 300);
        })();
      });
    }
    if (hm()) return wait();                                // already home, still loading: nothing to press
    var node = null, btn = null;
    try { node = window.cc && cc.find(HOME_BUTTON); btn = node && node.getComponent(cc.Button); } catch (e) {}
    if (!btn || !btn.clickEvents || node.activeInHierarchy === false || btn.interactable === false) return Promise.resolve(false);
    try { btn.clickEvents.forEach(function (e) { e.emit([node]); }); } catch (e) { return Promise.resolve(false); }
    return wait();
  }
  // The site's player key: the first 16 hex of sha256(the game's own UID). The UID itself never leaves this function.
  function siteKey() {
    var U = UD(), id = U && (U.StrUid || U._uid);
    if (!id) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(id))).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 16);
    });
  }

  window.DecorGame = { read: read, inBase: inBase, ready: ready, goHome: goHome, siteKey: siteKey };
})();
