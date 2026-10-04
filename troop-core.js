// troop-core.js — DOM-free logic for the 2864tw.com Troop Placement Optimizer.
// Dual CommonJS / browser global (window.TroopCore), same pattern as rockfield-core.js.
// Coordinates: game map positions (x, y) with x+y even; posId = 1000*x + y.
// A w x h footprint anchored at (x, y) covers (x - r + s, y + r + s), r < h, s < w.
(function (root) {
  'use strict';

  var CONST = {
    W: 84, H: 100, GROUND: 15,
    TYPE: { army: 101, navy: 201, air: 301 },
    FOOT: { army: { w: 1, h: 1, pt: 1 }, air: { w: 2, h: 2, pt: 1 }, navy: { w: 2, h: 3, pt: 0 } },
    REQUIRED_TYPES: [2, 6, 7, 10, 16, 17, 18],
    FLOOR_TYPE: 5, DECO_TYPE: 4,
    ENIGMA_TYPES: [48, 49, 50, 51],
    KEEP_WEIGHT: 1000,
    CELL_FIELDS: 'x,y,terrain,tmxBlocked,free,itemType,floor,block,obstacle'
  };

  function posId(x, y) { return 1000 * x + y; }
  function fromPosId(id) { return [Math.floor(id / 1000), ((id % 1000) + 1000) % 1000]; }
  function footprint(x, y, w, h) {
    var out = [];
    for (var r = 0; r < h; r++) for (var s = 0; s < w; s++) out.push(posId(x - r + s, y + r + s));
    return out;
  }
  function toUV(x, y) { return [(x + y) / 2, (y - x) / 2]; }

  // ---------------------------------------------------------------- region
  function unitClass(u) {
    if (u.type === CONST.TYPE.army && u.w === 1 && u.h === 1) return 'army';
    if (u.type === CONST.TYPE.air && u.w === 2 && u.h === 2) return 'air';
    if (u.type === CONST.TYPE.navy && u.w === 2 && u.h === 3) return 'navy';
    return 'odd';
  }

  function buildRegion(snap) {
    var F = (snap.cellFields || CONST.CELL_FIELDS).split(',');
    var ix = {}; F.forEach(function (k, i) { ix[k] = i; });
    var cells = {};
    snap.cells.forEach(function (c) {
      cells[posId(c[ix.x], c[ix.y])] = {
        x: c[ix.x], y: c[ix.y], ground: c[ix.terrain] === CONST.GROUND,
        ok: !!c[ix.free] && !c[ix.tmxBlocked] && !c[ix.obstacle], block: c[ix.block]
      };
    });
    function unitLegal(id, pt) {
      var c = cells[id];
      return !!c && c.ok && c.block === 0 && (c.ground ? 1 : 0) === pt;
    }
    var floor = {}, fixed = {}, reqLand = [], reqSea = [], parkable = [], lifted = {};
    snap.buildings.forEach(function (b) {
      var xy = fromPosId(b.pos), cs = footprint(xy[0], xy[1], b.w, b.h);
      if (b.type === CONST.FLOOR_TYPE) { cs.forEach(function (id) { floor[id] = true; }); return; }
      var touches = cs.some(function (id) { return cells[id] && cells[id].ok && cells[id].block === 0; });
      var item = { id: b.id, kind: 'building', type: b.type, group: b.group, x: xy[0], y: xy[1], w: b.w, h: b.h, pt: b.pt, cells: cs };
      var required = CONST.REQUIRED_TYPES.indexOf(b.type) >= 0;
      if (touches && !b.unmovable && required && b.w === 2 && b.h === 2) {
        item.role = b.pt === 1 ? 'bld' : 'seabld';
        (b.pt === 1 ? reqLand : reqSea).push(item);
        cs.forEach(function (id) { lifted[id] = true; });
        return;
      }
      if (touches && !b.unmovable && !required && CONST.ENIGMA_TYPES.indexOf(b.type) < 0) {
        parkable.push(item);
        cs.forEach(function (id) { lifted[id] = true; });
        return;
      }
      cs.forEach(function (id) { fixed[id] = b.id; });
    });
    // odd-footprint units stay where they are
    var units = { army: [], air: [], navy: [], odd: [] };
    (snap.units || []).forEach(function (u) {
      var xy = fromPosId(u.pos), cls = u.state ? 'odd' : unitClass(u);   // producing/busy units stay put
      var item = { id: u.id, kind: 'unit', role: cls, armyId: u.armyId, level: u.level, x: xy[0], y: xy[1], w: u.w, h: u.h, pt: u.pt, cells: footprint(xy[0], xy[1], u.w, u.h) };
      units[cls].push(item);
      if (cls === 'odd') item.cells.forEach(function (id) { fixed[id] = u.id; });
    });
    // parking: block-1 cells of the item's terrain, free of fixed/lifted items;
    // only decorations may sit on floor tiles
    var parked = [], used = {};
    var parkCells = Object.keys(cells).map(Number).filter(function (id) {
      var c = cells[id];
      return c.ok && c.block === 1 && !fixed[id] && !lifted[id];
    }).sort(function (a, b) { return a - b; });
    parkable.slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; }).forEach(function (it) {
      for (var i = 0; i < parkCells.length; i++) {
        var a = fromPosId(parkCells[i]), cs = footprint(a[0], a[1], it.w, it.h);
        var fits = cs.every(function (id) {
          var c = cells[id];
          return c && c.ok && c.block === 1 && (c.ground ? 1 : 0) === it.pt && !fixed[id] && !lifted[id] && !used[id] &&
            (it.type === CONST.DECO_TYPE || !floor[id]);
        });
        if (fits) {
          cs.forEach(function (id) { used[id] = true; });
          parked.push({ item: it, to: [a[0], a[1]] });
          return;
        }
      }
      it.cells.forEach(function (id) { fixed[id] = it.id; });   // nowhere to park: stays put
    });
    var parkedIds = {}; parked.forEach(function (p) { parkedIds[p.item.id] = true; });
    var landCells = [], seaCells = [];
    Object.keys(cells).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      if (fixed[id]) return;
      if (unitLegal(id, 1)) landCells.push(id);
      else if (unitLegal(id, 0)) seaCells.push(id);
    });
    return {
      cells: cells, floor: floor, fixed: fixed, unitLegal: unitLegal,
      reqLand: reqLand, reqSea: reqSea, parked: parked,
      unparked: parkable.filter(function (p) { return !parkedIds[p.id]; }),
      units: units, landCells: landCells, seaCells: seaCells
    };
  }

  var TroopCore = {
    CONST: CONST, posId: posId, fromPosId: fromPosId, footprint: footprint, toUV: toUV, unitClass: unitClass, buildRegion: buildRegion
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TroopCore;
  else root.TroopCore = TroopCore;
})(typeof window !== 'undefined' ? window : globalThis);
