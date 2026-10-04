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

  // ---------------------------------------------------------------- LP
  function anchorsIn(set, w, h, noFloor, floor) {
    var out = [];
    Object.keys(set).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var xy = fromPosId(id), cs = footprint(xy[0], xy[1], w, h);
      for (var i = 0; i < cs.length; i++) {
        if (!set[cs[i]]) return;
        if (noFloor && floor[cs[i]]) return;
      }
      out.push(id);
    });
    return out;
  }

  function emitTerms(terms) {
    // terms: [[coef, name]]; CPLEX LP, wrapped every 20 terms (continuation lines start with a space)
    var parts = [], line = [];
    terms.forEach(function (t, i) {
      var c = t[0], s = (c < 0 ? '- ' : (i === 0 ? '' : '+ ')) + (Math.abs(c) === 1 ? '' : Math.abs(c) + ' ') + t[1];
      line.push(s);
      if (line.length === 20) { parts.push(line.join(' ')); line = []; }
    });
    if (line.length) parts.push(line.join(' '));
    return parts.join('\n ');
  }

  function lpText(objTerms, rows, binaries) {
    var out = ['Maximize', ' obj: ' + (objTerms.length ? emitTerms(objTerms) : '0 ' + binaries[0]), 'Subject To'];
    rows.forEach(function (r) { out.push(' ' + r.name + ': ' + emitTerms(r.terms) + ' ' + r.op + ' ' + r.rhs); });
    out.push('Binary');
    for (var i = 0; i < binaries.length; i += 20) out.push(' ' + binaries.slice(i, i + 20).join(' '));
    out.push('End');
    return out.join('\n');
  }

  // Land model. opts: { mode: 'planes'|'units'|'half', count?: number (exact 2x2 slot count), keepPlanes?: bool }
  function buildLandLP(region, opts) {
    opts = opts || {};
    var set = {}; region.landCells.forEach(function (id) { set[id] = true; });
    var slots = anchorsIn(set, 2, 2, false, region.floor);
    var bldOk = {}; anchorsIn(set, 2, 2, true, region.floor).forEach(function (id) { bldOk[id] = true; });
    // keep bonuses: a slot that already holds a 2x2 item scores +1; marking it as a building slot
    // scores +1 more when a building sits there and -1 when a plane does (so planes are not evicted)
    var keep = {}, bldHere = {}, planeHere = {};
    region.units.air.forEach(function (u) { var id = posId(u.x, u.y); keep[id] = true; planeHere[id] = true; });
    region.reqLand.forEach(function (b) { var id = posId(b.x, b.y); keep[id] = true; bldHere[id] = true; });
    var R = region.reqLand.length, F = region.landCells.length - 4 * R;
    var count = opts.count;
    if (count == null && opts.mode === 'units') count = R + (opts.keepPlanes === false ? 0 : region.units.air.length);
    if (count == null && opts.mode === 'half') count = R + Math.floor(F / 8);
    var cover = {}, obj = [], rows = [], bins = [], bTerms = [], cntTerms = [];
    slots.forEach(function (id, i) {
      var xy = fromPosId(id);
      footprint(xy[0], xy[1], 2, 2).forEach(function (c) { (cover[c] = cover[c] || []).push('s' + i); });
      var k = keep[id] ? 1 : 0;
      if (count == null) obj.push([CONST.KEEP_WEIGHT + k, 's' + i]);
      else if (k) obj.push([1, 's' + i]);
      bins.push('s' + i); cntTerms.push([1, 's' + i]);
      if (bldOk[id]) {
        bins.push('b' + i); bTerms.push([1, 'b' + i]);
        rows.push({ name: 'l' + i, terms: [[1, 'b' + i], [-1, 's' + i]], op: '<=', rhs: 0 });
        if (bldHere[id]) obj.push([1, 'b' + i]);
        if (planeHere[id]) obj.push([-1, 'b' + i]);
      }
    });
    Object.keys(cover).forEach(function (c) { if (cover[c].length > 1) rows.push({ name: 'c' + c, terms: cover[c].map(function (n) { return [1, n]; }), op: '<=', rhs: 1 }); });
    rows.push({ name: 'nb', terms: bTerms.length ? bTerms : [[1, 's0']], op: '=', rhs: bTerms.length ? R : 0 });
    if (count != null) rows.push({ name: 'cnt', terms: cntTerms, op: '=', rhs: count });
    return { kind: 'land', slots: slots, bldOk: bldOk, R: R, count: count, lp: lpText(obj, rows, bins) };
  }

  function buildSeaLP(region) {
    var set = {}; region.seaCells.forEach(function (id) { set[id] = true; });
    var nav = anchorsIn(set, 2, 3, false, region.floor);
    var bld = anchorsIn(set, 2, 2, true, region.floor);
    var keepN = {}, keepB = {};
    region.units.navy.forEach(function (u) { keepN[posId(u.x, u.y)] = true; });
    region.reqSea.forEach(function (b) { keepB[posId(b.x, b.y)] = true; });
    var cover = {}, obj = [], rows = [], bins = [], dTerms = [];
    nav.forEach(function (id, i) {
      var xy = fromPosId(id);
      footprint(xy[0], xy[1], 2, 3).forEach(function (c) { (cover[c] = cover[c] || []).push('n' + i); });
      obj.push([CONST.KEEP_WEIGHT + (keepN[id] ? 1 : 0), 'n' + i]); bins.push('n' + i);
    });
    bld.forEach(function (id, i) {
      var xy = fromPosId(id);
      footprint(xy[0], xy[1], 2, 2).forEach(function (c) { (cover[c] = cover[c] || []).push('d' + i); });
      if (keepB[id]) obj.push([1, 'd' + i]);
      bins.push('d' + i); dTerms.push([1, 'd' + i]);
    });
    Object.keys(cover).forEach(function (c) { if (cover[c].length > 1) rows.push({ name: 'c' + c, terms: cover[c].map(function (n) { return [1, n]; }), op: '<=', rhs: 1 }); });
    var R = region.reqSea.length;
    rows.push({ name: 'nd', terms: dTerms.length ? dTerms : [[1, bins[0]]], op: '=', rhs: dTerms.length ? R : 0 });
    return { kind: 'sea', nav: nav, bld: bld, R: R, lp: lpText(obj, rows, bins) };
  }

  function on(sol, name) { var c = sol && sol.Columns && sol.Columns[name]; return !!c && c.Primal > 0.5; }

  // Returns target: { slots: [{pos, role:'air'|'bld'}], armyCells: [posId], navy: [posId], seaBld: [posId] }
  function decodeLand(model, sol, region) {
    var slots = [], taken = {};
    model.slots.forEach(function (id, i) {
      if (!on(sol, 's' + i)) return;
      var role = model.bldOk[id] && on(sol, 'b' + i) ? 'bld' : 'air';
      slots.push({ pos: id, role: role });
      var xy = fromPosId(id); footprint(xy[0], xy[1], 2, 2).forEach(function (c) { taken[c] = true; });
    });
    var armyCells = region.landCells.filter(function (id) { return !taken[id]; });
    return { slots: slots, armyCells: armyCells };
  }

  function decodeSea(model, sol) {
    var navy = [], seaBld = [];
    model.nav.forEach(function (id, i) { if (on(sol, 'n' + i)) navy.push(id); });
    model.bld.forEach(function (id, i) { if (on(sol, 'd' + i)) seaBld.push(id); });
    return { navy: navy, seaBld: seaBld };
  }

  // Fallback when the solver cannot load: greedy 2x2 packing (labeled near-optimal in the UI).
  // Tries four scan orders, keeps the best, puts buildings on the first floor-free slots.
  function greedyLand(region, opts) {
    opts = opts || {};
    var set = {}; region.landCells.forEach(function (id) { set[id] = true; });
    var R = region.reqLand.length;
    var orders = [
      function (a, b) { return a - b; },
      function (a, b) { return b - a; },
      function (a, b) { var p = toUV.apply(null, fromPosId(a)), q = toUV.apply(null, fromPosId(b)); return p[1] - q[1] || p[0] - q[0]; },
      function (a, b) { var p = toUV.apply(null, fromPosId(a)), q = toUV.apply(null, fromPosId(b)); return p[0] - q[0] || p[1] - q[1]; }
    ];
    var best = null;
    orders.forEach(function (cmp) {
      var taken = {}, slots = [];
      region.landCells.slice().sort(cmp).forEach(function (id) {
        var xy = fromPosId(id), cs = footprint(xy[0], xy[1], 2, 2);
        if (cs.every(function (c) { return set[c] && !taken[c]; })) { cs.forEach(function (c) { taken[c] = true; }); slots.push(id); }
      });
      if (!best || slots.length > best.length) best = slots;
    });
    var limit = opts.count != null ? opts.count : best.length;
    var chosen = best.slice(0, limit), nb = 0, out = [], taken2 = {};
    chosen.forEach(function (id) {
      var xy = fromPosId(id), cs = footprint(xy[0], xy[1], 2, 2);
      var role = nb < R && !cs.some(function (c) { return region.floor[c]; }) ? 'bld' : 'air';
      if (role === 'bld') nb++;
      cs.forEach(function (c) { taken2[c] = true; });
      out.push({ pos: id, role: role });
    });
    if (nb < R) return null;                       // not enough floor-free slots for the buildings
    return { slots: out, armyCells: region.landCells.filter(function (id) { return !taken2[id]; }), approximate: true };
  }

  // ---------------------------------------------------------------- sequencer
  // target: { slots, armyCells, navy?, seaBld? }; opts: { mode, storeArmyFirst? }
  // Returns { steps, blocked, final: {itemId: [x,y]}, stats }
  function planSteps(snap, region, target, opts) {
    opts = opts || {};
    var steps = [], blocked = [];
    var hasSea = !!target.navy;
    // 1) park decorations out of the unit area (sea ones only when the navy pass is on)
    var parks = region.parked.filter(function (p) { return p.item.pt === 1 || hasSea; });
    parks.forEach(function (p) {
      steps.push({ kind: 'park', id: p.item.id, w: p.item.w, h: p.item.h, from: [p.item.x, p.item.y], to: p.to });
    });
    // targets
    var targets = [];
    target.slots.forEach(function (s) { targets.push({ role: s.role, pos: s.pos, w: 2, h: 2 }); });
    (target.armyCells || []).forEach(function (id) { targets.push({ role: 'army', pos: id, w: 1, h: 1 }); });
    (target.navy || []).forEach(function (id) { targets.push({ role: 'navy', pos: id, w: 2, h: 3 }); });
    (target.seaBld || []).forEach(function (id) { targets.push({ role: 'seabld', pos: id, w: 2, h: 2 }); });
    targets.forEach(function (t) { var xy = fromPosId(t.pos); t.cells = footprint(xy[0], xy[1], t.w, t.h); });
    // items that take part
    var items = [];
    region.units.air.forEach(function (u) { items.push(u); });
    region.units.army.forEach(function (u) { items.push(u); });
    region.reqLand.forEach(function (b) { items.push(b); });
    if (hasSea) { region.units.navy.forEach(function (u) { items.push(u); }); region.reqSea.forEach(function (b) { items.push(b); }); }
    var pos = {}, occ = {};
    items.forEach(function (it) { pos[it.id] = [it.x, it.y]; footprint(it.x, it.y, it.w, it.h).forEach(function (c) { occ[c] = it.id; }); });
    var byId = {}; items.forEach(function (it) { byId[it.id] = it; });
    var tAt = {}; targets.forEach(function (t) { tAt[t.role + ':' + t.pos] = t; });
    var armySet = {}; (target.armyCells || []).forEach(function (id) { armySet[id] = true; });
    function placed(it) {
      var p = pos[it.id];
      if (it.role === 'army') return !!armySet[posId(p[0], p[1])];
      return !!tAt[it.role + ':' + posId(p[0], p[1])];
    }
    function vacate(it) { footprint(pos[it.id][0], pos[it.id][1], it.w, it.h).forEach(function (c) { if (occ[c] === it.id) delete occ[c]; }); }
    function occupy(it, xy) { pos[it.id] = xy; footprint(xy[0], xy[1], it.w, it.h).forEach(function (c) { occ[c] = it.id; }); }
    // 2) excess units -> storage (misplaced first)
    var room = { army: 0, air: 0, navy: 0 };
    ['army', 'air', 'navy'].forEach(function (k) { var s = snap.storage && snap.storage[k]; room[k] = s ? Math.max(0, s.max - s.used) : 0; });
    ['air', 'army', 'navy'].forEach(function (role) {
      if (role === 'navy' && !hasSea) return;
      var mine = items.filter(function (it) { return it.role === role; });
      var cap = targets.filter(function (t) { return t.role === role; }).length;
      var mis = mine.filter(function (it) { return !placed(it); });
      var order = mis.concat(mine.filter(placed));
      var mustStore = Math.max(0, mine.length - cap);           // more units than target spots
      var wantStore = role === 'army' && opts.mode === 'planes' ? Math.max(mustStore, mis.length) : mustStore;
      for (var i = 0; i < order.length && i < wantStore; i++) {
        var it = order[i];
        if (room[role] > 0) {
          room[role]--;
          steps.push({ kind: 'store', id: it.id, role: role, from: pos[it.id].slice() });
          vacate(it); it.stored = true;
        } else if (i < mustStore) {
          it.stuck = true;                                      // no storage room and no spot: leave in place
        }
      }
      var stuck = order.filter(function (it) { return it.stuck; }).length;
      if (stuck) blocked.push({ role: role, reason: 'storage_full', remaining: stuck });
    });
    items = items.filter(function (it) { return !it.stored; });
    var movable = items.filter(function (it) { return !it.stuck; });
    // 3) fill loop
    var cellTargets = {};
    targets.forEach(function (t) { t.cells.forEach(function (c) { (cellTargets[c] = cellTargets[c] || []).push(t); }); });
    function filled(t) {
      if (t.role === 'army') { var o = occ[t.pos]; return !!o && byId[o].role === 'army'; }
      var o2 = occ[t.cells[0]];
      if (!o2) return false;
      var it = byId[o2], p = pos[o2];
      return it.role === t.role && posId(p[0], p[1]) === t.pos;
    }
    function free(t, ignore) { return t.cells.every(function (c) { return !occ[c] || occ[c] === ignore; }); }
    var temps = 0;
    for (var guard = 0; guard < 5000; guard++) {
      var mis = movable.filter(function (it) { return !placed(it); });
      if (!mis.length) break;
      var best = null;
      var freeTargets = targets.filter(function (t) { return !filled(t) && free(t, null); });
      var byRole = {};
      mis.forEach(function (it) { (byRole[it.role] = byRole[it.role] || []).push(it); });
      freeTargets.forEach(function (t) {
        (byRole[t.role] || []).forEach(function (it) {
          var p = pos[it.id], seen = {}, unblock = 0;
          footprint(p[0], p[1], it.w, it.h).forEach(function (c) {
            (cellTargets[c] || []).forEach(function (q) {
              var key = q.role + ':' + q.pos;
              if (seen[key] || q.role === 'army' || filled(q)) return;
              seen[key] = true;
              if (free(q, it.id)) unblock++;
            });
          });
          var tp = fromPosId(t.pos), dist = Math.abs(tp[0] - p[0]) + Math.abs(tp[1] - p[1]);
          var sc = unblock * 100000 - dist;
          if (!best || sc > best.sc) best = { sc: sc, it: it, t: t };
        });
      });
      if (!best) {
        // deadlock: shift the misplaced item that blocks most targets to any free legal non-target spot
        if (temps >= 50) { blocked.push({ reason: 'deadlock', misplaced: mis.map(function (it) { return it.id; }) }); break; }
        var cand = null;
        mis.forEach(function (it) {
          var p = pos[it.id], n = 0;
          footprint(p[0], p[1], it.w, it.h).forEach(function (c) { n += (cellTargets[c] || []).filter(function (q) { return !filled(q); }).length; });
          if (!cand || n > cand.n) cand = { it: it, n: n };
        });
        var it2 = cand.it, spot = null;
        var pool = it2.pt === 1 ? region.landCells : region.seaCells;
        for (var k = 0; k < pool.length && !spot; k++) {
          var a = fromPosId(pool[k]), cs = footprint(a[0], a[1], it2.w, it2.h);
          if (cs.every(function (c) { return region.unitLegal(c, it2.pt) && !region.fixed[c] && !occ[c] && !cellTargets[c]; })) spot = a;
        }
        if (!spot) { blocked.push({ reason: 'deadlock', misplaced: mis.map(function (it) { return it.id; }) }); break; }
        steps.push({ kind: it2.kind === 'unit' ? 'moveUnit' : 'moveBuilding', id: it2.id, role: it2.role, from: pos[it2.id].slice(), to: spot, temp: true });
        vacate(it2); occupy(it2, spot); temps++;
        continue;
      }
      var tp2 = fromPosId(best.t.pos);
      steps.push({ kind: best.it.kind === 'unit' ? 'moveUnit' : 'moveBuilding', id: best.it.id, role: best.it.role, from: pos[best.it.id].slice(), to: tp2 });
      vacate(best.it); occupy(best.it, tp2);
    }
    var final = {}; items.forEach(function (it) { final[it.id] = pos[it.id].slice(); });
    var stats = { parks: 0, stores: 0, moves: 0, temps: 0 };
    steps.forEach(function (s) { if (s.kind === 'park') stats.parks++; else if (s.kind === 'store') stats.stores++; else { stats.moves++; if (s.temp) stats.temps++; } });
    stats.emptyAirSlots = target.slots.filter(function (s) { return s.role === 'air' && !occ[s.pos]; }).length;
    return { steps: steps, blocked: blocked, final: final, stats: stats, parks: parks };
  }

  // ---------------------------------------------------------------- lock + render
  // Ordered target anchors the lock hands out for a unit footprint, or null if the plan does not cover it.
  function lockTargets(target, w, h, pt, opts) {
    opts = opts || {};
    if (w === 2 && h === 2 && pt === 1) return target.slots.filter(function (s) { return s.role === 'air'; }).map(function (s) { return s.pos; });
    if (w === 1 && h === 1 && pt === 1) return opts.mode === 'planes' && !opts.fillArmy ? [] : (target.armyCells || []).slice();
    if (w === 2 && h === 3 && pt === 0) return target.navy ? target.navy.slice() : null;
    return null;
  }

  // Cell categories for the Before / After mini-map.
  function renderModel(snap, region, target, result) {
    function paint(map, it, xy, cat) { footprint(xy[0], xy[1], it.w, it.h).forEach(function (c) { map[c] = cat; }); }
    var before = {}, after = {};
    Object.keys(region.cells).forEach(function (k) {
      var id = Number(k), c = region.cells[id];
      var cat = region.fixed[id] ? 'fixed' : (region.unitLegal(id, 1) ? 'land' : (region.unitLegal(id, 0) ? 'sea' : (c.ok ? (c.ground ? 'blockedLand' : 'blockedSea') : 'off')));
      before[id] = cat; after[id] = cat;
    });
    var parks = result ? result.parks : region.parked.filter(function (p) { return p.item.pt === 1; });
    parks.forEach(function (p) { paint(before, p.item, [p.item.x, p.item.y], 'decoMoving'); paint(after, p.item, p.to, 'deco'); });
    target.slots.forEach(function (s) { if (s.role === 'air') paint(after, { w: 2, h: 2 }, fromPosId(s.pos), 'airEmpty'); });
    var moved = {};
    (result ? result.steps : []).forEach(function (s) { moved[s.id] = s.kind; });
    var all = [].concat(region.units.air, region.units.army, region.units.navy, region.reqLand, region.reqSea);
    all.forEach(function (it) {
      var cat = it.kind === 'building' ? 'bld' : it.role;
      paint(before, it, [it.x, it.y], moved[it.id] ? cat + 'Moving' : cat);
      if (result && moved[it.id] === 'store') return;
      var xy = result && result.final[it.id] ? result.final[it.id] : [it.x, it.y];
      paint(after, it, xy, cat);
    });
    return { before: before, after: after };
  }

  var TroopCore = {
    CONST: CONST, posId: posId, fromPosId: fromPosId, footprint: footprint, toUV: toUV, unitClass: unitClass, buildRegion: buildRegion, buildLandLP: buildLandLP, buildSeaLP: buildSeaLP, decodeLand: decodeLand, decodeSea: decodeSea, greedyLand: greedyLand, planSteps: planSteps, lockTargets: lockTargets, renderModel: renderModel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TroopCore;
  else root.TroopCore = TroopCore;
})(typeof window !== 'undefined' ? window : globalThis);
