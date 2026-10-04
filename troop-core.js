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
    // opts.keep: keep the 2x2 items that already sit on legal anchors (buildings first) and fill
    // around them, so the fallback never shuffles a tidy base; without it, pack for the most slots
    var seed = [], seeded = {};
    (opts.keep ? region.reqLand.concat(region.units.air) : []).forEach(function (it) {
      var cs = footprint(it.x, it.y, 2, 2);
      if (cs.every(function (c) { return set[c] && !seeded[c]; })) { cs.forEach(function (c) { seeded[c] = true; }); seed.push(posId(it.x, it.y)); }
    });
    var best = null;
    orders.forEach(function (cmp) {
      var taken = Object.assign({}, seeded), slots = seed.slice();
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
        var it2 = cand.it, spot = null, anySpot = null;
        var pool = it2.pt === 1 ? region.landCells : region.seaCells;
        for (var k = 0; k < pool.length && !spot; k++) {
          var a = fromPosId(pool[k]), cs = footprint(a[0], a[1], it2.w, it2.h);
          if (!cs.every(function (c) { return region.unitLegal(c, it2.pt) && !region.fixed[c] && !occ[c] && (it2.kind === 'unit' || !region.floor[c]); })) continue;
          if (cs.every(function (c) { return !(cellTargets[c] || []).some(function (q) { return !filled(q); }); })) spot = a;
          else if (!anySpot) anySpot = a;
        }
        spot = spot || anySpot;
        if (!spot && it2.kind === 'building') {
          // make room: a building cannot sit on floors, so move a plane off a floor-free 2x2
          // into any free spot (planes may sit on floors) and use the spot it leaves
          var planes = movable.filter(function (q) { return q.role === 'air' && q.w === it2.w && q.h === it2.h; });
          for (var pi = 0; pi < planes.length && !spot; pi++) {
            var pl = planes[pi], pp = pos[pl.id];
            if (footprint(pp[0], pp[1], pl.w, pl.h).some(function (c) { return region.floor[c]; })) continue;
            for (var k2 = 0; k2 < pool.length; k2++) {
              var a2 = fromPosId(pool[k2]), cs2 = footprint(a2[0], a2[1], pl.w, pl.h);
              if (!cs2.every(function (c) { return region.unitLegal(c, pl.pt) && !region.fixed[c] && !occ[c]; })) continue;
              var onTarget = !!tAt['air:' + pool[k2]];
              steps.push({ kind: 'moveUnit', id: pl.id, role: pl.role, from: pp.slice(), to: a2, temp: !onTarget });
              vacate(pl); occupy(pl, a2); if (!onTarget) temps++;
              spot = pp.slice();
              break;
            }
          }
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

  // 'ready': steps to run; 'partial': steps to run but something can never be placed;
  // 'done': the base matches the plan; 'blocked': nothing runnable and something is stuck.
  function planStatus(result) {
    if (result.steps.length) return result.blocked.length ? 'partial' : 'ready';
    return result.blocked.length ? 'blocked' : 'done';
  }

  // ---------------------------------------------------------------- plan rows
  // The options the UI offers. solve(lp) -> Promise<HiGHS solution>, or null when the solver is
  // unavailable. Any solver failure or unusable answer falls back to greedyLand (approximate) and
  // keeps the rows already planned. opts: { mode, keepPlanes, navy }.
  // Returns Promise<{ rows: [{ target, result, planes }], exact: bool, notes: [string] }>.
  function planRows(snap, region, opts, solve) {
    opts = opts || {};
    var R = region.reqLand.length, planesNow = region.units.air.length;
    var out = { rows: [], exact: !!solve, notes: [] }, sea = null;
    function attempt(fn) {
      if (!solve) return Promise.resolve(null);
      return Promise.resolve().then(fn).catch(function (e) { out.exact = false; out.notes.push(String((e && e.message) || e)); return null; });
    }
    function solveLand(o) {
      var m = buildLandLP(region, o);
      return solve(m.lp).then(function (sol) {
        var ok = sol && (sol.Status === 'Optimal' || sol.Status === 'Time limit reached');
        var t = ok ? decodeLand(m, sol, region) : null;
        var nb = t ? t.slots.filter(function (x) { return x.role === 'bld'; }).length : -1;
        if (!t || nb !== m.R || (m.count != null && t.slots.length !== m.count)) throw new Error('no usable solution (' + (sol && sol.Status) + ')');
        if (sol.Status !== 'Optimal') t.approximate = true;
        return t;
      });
    }
    function addRow(t) {
      if (!t) return;
      if (sea) { t.navy = sea.navy; t.seaBld = sea.seaBld; }
      out.rows.push({ target: t, result: planSteps(snap, region, t, { mode: opts.mode }), planes: t.slots.filter(function (x) { return x.role === 'air'; }).length });
    }
    var p = Promise.resolve();
    if (opts.navy) {
      p = p.then(function () {
        return attempt(function () {
          var m = buildSeaLP(region);
          return solve(m.lp).then(function (sol) {
            var s2 = sol && sol.Status === 'Optimal' ? decodeSea(m, sol) : null;
            if (!s2 || s2.seaBld.length !== m.R) throw new Error('sea: no usable solution');
            sea = s2;
          });
        });
      });
    }
    if (opts.mode === 'planes') {
      p = p.then(function () { return attempt(function () { return solveLand({ mode: 'planes' }); }); }).then(function (best) {
        if (!best) {
          // no solver: offer the most-planes greedy plan, plus a keep-what-is-there plan when it is cheaper
          var most = greedyLand(region, {}), kept = greedyLand(region, { keep: true });
          addRow(most);
          if (kept && (!most || kept.slots.length >= most.slots.length || planSteps(snap, region, kept, { mode: opts.mode }).stats.moves < out.rows[0].result.stats.moves)) {
            if (most && kept.slots.length >= most.slots.length) out.rows.pop();
            addRow(kept);
          }
          return null;
        }
        addRow(best);
        var kMax = best.slots.length, ks = [];
        [1, 2, 3, 5, 8, 12, 17].forEach(function (d) { if (kMax - d - R > planesNow) ks.push(kMax - d); });
        return ks.reduce(function (chain, k) {
          return chain.then(function (stop) {
            if (stop || out.rows[out.rows.length - 1].result.stats.moves === 0) return true;
            return attempt(function () { return solveLand({ mode: 'planes', count: k }); }).then(function (t) { if (!t) return true; addRow(t); return false; });
          });
        }, Promise.resolve(false));
      });
    } else {
      var count = opts.mode === 'half' ? R + Math.floor((region.landCells.length - 4 * R) / 8) : R + (opts.keepPlanes === false ? 0 : planesNow);
      p = p.then(function () { return attempt(function () { return solveLand({ mode: opts.mode, keepPlanes: opts.keepPlanes }); }); })
        .then(function (t) { addRow(t || greedyLand(region, { count: count, keep: true })); });
    }
    return p.then(function () {
      if (opts.navy && !sea) out.notes.push('navy pass skipped');
      return out;
    });
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
    var before = {}, after = {}, outlines = { before: [], after: [] };
    function outline(list, it, xy, cat) { list.push({ x: xy[0], y: xy[1], w: it.w, h: it.h, cat: cat }); }
    Object.keys(region.cells).forEach(function (k) {
      var id = Number(k), c = region.cells[id];
      var cat = region.fixed[id] ? 'fixed' : (region.unitLegal(id, 1) ? 'land' : (region.unitLegal(id, 0) ? 'sea' : (c.ok ? (c.ground ? 'blockedLand' : 'blockedSea') : 'off')));
      before[id] = cat; after[id] = cat;
    });
    var parks = result ? result.parks : region.parked.filter(function (p) { return p.item.pt === 1; });
    parks.forEach(function (p) {
      paint(before, p.item, [p.item.x, p.item.y], 'decoMoving'); outline(outlines.before, p.item, [p.item.x, p.item.y], 'decoMoving');
      paint(after, p.item, p.to, 'deco'); outline(outlines.after, p.item, p.to, 'deco');
    });
    target.slots.forEach(function (s) { if (s.role === 'air') paint(after, { w: 2, h: 2 }, fromPosId(s.pos), 'airEmpty'); });
    var moved = {};
    (result ? result.steps : []).forEach(function (s) { moved[s.id] = s.kind; });
    var all = [].concat(region.units.air, region.units.army, region.units.navy, region.reqLand, region.reqSea);
    all.forEach(function (it) {
      var cat = it.kind === 'building' ? 'bld' : it.role;
      var bcat = moved[it.id] ? cat + 'Moving' : cat;
      paint(before, it, [it.x, it.y], bcat); outline(outlines.before, it, [it.x, it.y], bcat);
      if (result && moved[it.id] === 'store') return;
      var xy = result && result.final[it.id] ? result.final[it.id] : [it.x, it.y];
      paint(after, it, xy, cat); outline(outlines.after, it, xy, cat);
    });
    return { before: before, after: after, outlines: outlines };
  }

  // ---------------------------------------------------------------- rebuild (v2)
  var GROUP = { army: 1040, air: 1050, navy: 1100 };          // Barracks, Air Base, Shipyard
  var ROLE_OF_GROUP = { 1040: 'army', 1050: 'air', 1100: 'navy' };
  var ROLE_OF_TYPE = { 101: 'army', 201: 'navy', 301: 'air' };
  var TRAIN_SPEED_BUFF = 920800;                               // "Training speed bonus (all forces)", value / 10000

  // Demoted leftovers the cleanup may delete: Lv10-99 only, never a unit that is busy.
  function deleteCandidates(units) {
    return (units || []).filter(function (u) { return u.level >= 10 && u.level <= 99 && !u.state; });
  }

  // "buffId,value|buffId,value" -> value of buffId (0 when absent)
  function buffValue(spec, buffId) {
    var parts = String(spec || '').split('|');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(',');
      if (Number(kv[0]) === buffId) return Number(kv[1]) || 0;
    }
    return 0;
  }

  // skins: [{ id, equip_buff }] owned by the player. Ties keep the skin being worn.
  function bestTrainingSkin(skins, currentId) {
    var cur = 0, best = null;
    (skins || []).forEach(function (s) {
      var v = buffValue(s.equip_buff, TRAIN_SPEED_BUFF);
      if (s.id === currentId) cur = v;
      if (!best || v > best.value) best = { id: s.id, value: v };
    });
    if (!best || best.value <= cur) return { id: currentId, value: cur, currentValue: cur, change: false };
    return { id: best.id, value: best.value, currentValue: cur, change: true };
  }

  // Cells something stands on right now (units, required buildings, decorations still in the unit area).
  function occupiedCells(region) {
    var occ = {};
    function mark(cells) { cells.forEach(function (c) { occ[c] = true; }); }
    ['army', 'air', 'navy', 'odd'].forEach(function (k) { region.units[k].forEach(function (u) { mark(u.cells); }); });
    region.reqLand.concat(region.reqSea).forEach(function (b) { mark(b.cells); });
    region.parked.forEach(function (p) { mark(p.item.cells); });
    return occ;
  }

  // Anchors (posIds) where a 2x2 training building fits right now: legal for the terrain, off floors, empty.
  function freeSites(region, anchors, pt) {
    var legal = {}; (pt === 1 ? region.landCells : region.seaCells).forEach(function (id) { legal[id] = true; });
    var occ = occupiedCells(region);
    return anchors.filter(function (id) {
      var xy = fromPosId(id);
      return footprint(xy[0], xy[1], 2, 2).every(function (c) { return legal[c] && !region.floor[c] && !occ[c]; });
    });
  }

  // 2x2 packing of the sea (for Shipyards). exclude: optional { posId: true } of cells to leave out.
  function buildSeaSlotsLP(region, exclude) {
    var set = {};
    region.seaCells.forEach(function (id) { if (!exclude || !exclude[id]) set[id] = true; });
    var slots = anchorsIn(set, 2, 2, true, region.floor);
    if (!slots.length) return { kind: 'seaSlots', slots: [], lp: null };
    var cover = {}, obj = [], rows = [], bins = [];
    slots.forEach(function (id, i) {
      var xy = fromPosId(id);
      footprint(xy[0], xy[1], 2, 2).forEach(function (c) { (cover[c] = cover[c] || []).push('q' + i); });
      obj.push([1, 'q' + i]); bins.push('q' + i);
    });
    Object.keys(cover).forEach(function (c) { if (cover[c].length > 1) rows.push({ name: 'c' + c, terms: cover[c].map(function (n) { return [1, n]; }), op: '<=', rhs: 1 }); });
    if (!rows.length) rows.push({ name: 'z', terms: [[1, bins[0]]], op: '<=', rhs: 1 });
    return { kind: 'seaSlots', slots: slots, lp: lpText(obj, rows, bins) };
  }
  function decodeSeaSlots(model, sol) {
    if (!model.lp) return [];
    return model.slots.filter(function (id, i) { return on(sol, 'q' + i); });
  }

  // sites: { land: posId[], sea: posId[] }; free: storage free slots per role;
  // existing: { army: posId[], air: posId[], navy: posId[] } current training buildings.
  // Land is split Barracks : Air Bases by free Garage : Hangar space (largest remainder); no type gets
  // more new buildings than its free storage can keep busy: ceil(free / 5) minus what already exists.
  function buildingSites(sites, free, existing) {
    var cap = {};
    ['army', 'air', 'navy'].forEach(function (t) { cap[t] = Math.max(0, Math.ceil((free[t] || 0) / 5) - (existing[t] || []).length); });
    var L = sites.land.length, fa = cap.army > 0 ? (free.army || 0) : 0, fr = cap.air > 0 ? (free.air || 0) : 0, nA = 0, nR = 0;
    if (fa + fr > 0 && L > 0) {
      var exA = L * fa / (fa + fr), exR = L - exA;
      nA = Math.floor(exA); nR = Math.floor(exR);
      if (nA + nR < L) { if (exA - nA >= exR - nR) nA++; else nR++; }
      if (nA > cap.army) { nR = Math.min(cap.air, nR + nA - cap.army); nA = cap.army; }
      if (nR > cap.air) { nA = Math.min(cap.army, nA + nR - cap.air); nR = cap.air; }
    }
    function nearest(list, to) {
      return list.slice().sort(function (a, b) {
        function d(p) {
          if (!to.length) return p;
          var xy = fromPosId(p);
          return Math.min.apply(null, to.map(function (q) { var t = fromPosId(q); return Math.abs(t[0] - xy[0]) + Math.abs(t[1] - xy[1]); }));
        }
        return d(a) - d(b) || a - b;
      });
    }
    var army = nearest(sites.land, existing.army || []).slice(0, nA);
    var taken = {}; army.forEach(function (p) { taken[p] = true; });
    var air = nearest(sites.land.filter(function (p) { return !taken[p]; }), existing.air || []).slice(0, nR);
    var navy = nearest(sites.sea, existing.navy || []).slice(0, Math.min(sites.sea.length, cap.navy));
    return { army: army, air: air, navy: navy };
  }

  // Trim a building plan to what the gold covers (perBuilding = build cost + one full queue), keeping proportions.
  function fitToGold(plan, perBuilding, gold) {
    var keys = ['army', 'air', 'navy'], total = 0;
    keys.forEach(function (k) { total += plan[k].length; });
    var maxN = perBuilding > 0 ? Math.floor(gold / perBuilding) : total;
    if (total <= maxN) return plan;
    var take = {}, rem = [], used = 0;
    keys.forEach(function (k) { var ex = plan[k].length * maxN / total; take[k] = Math.floor(ex); used += take[k]; rem.push([ex - take[k], k]); });
    rem.sort(function (a, b) { return b[0] - a[0]; });
    for (var i = 0; used < maxN && i < rem.length; i++) { take[rem[i][1]]++; used++; }
    var out = {}; keys.forEach(function (k) { out[k] = plan[k].slice(0, take[k]); });
    return out;
  }

  // Training buildings to delete when the base is full: keep one per type (highest level, lowest posId),
  // never one that is still training. buildings: [{ id, group, level, pos, busy }]
  function extraTrainingBuildings(buildings) {
    var keep = {};
    buildings.forEach(function (b) {
      if (!ROLE_OF_GROUP[b.group]) return;
      var k = keep[b.group];
      if (!k || b.level > k.level || (b.level === k.level && b.pos < k.pos)) keep[b.group] = b;
    });
    return buildings.filter(function (b) { return ROLE_OF_GROUP[b.group] && keep[b.group] !== b && !b.busy; });
  }

  // First round of free merges available below the cap (pairs of the same unit id), for the preview.
  function mergeablePairs(units, caps) {
    var groups = {};
    (units || []).forEach(function (u) {
      if (u.state) return;
      var cap = caps[ROLE_OF_TYPE[u.type]];
      if (cap == null || u.level >= cap) return;
      groups[u.armyId] = (groups[u.armyId] || 0) + 1;
    });
    var n = 0; Object.keys(groups).forEach(function (k) { n += Math.floor(groups[k] / 2); });
    return n;
  }

  // Gold a Bulk Training fill would cost: open queue places (5 per building) in each type's
  // highest-level set, which is the set the game trains, priced at the buildable unit cost.
  var QUEUE = 5;
  function trainEstimate(buildings, buildable) {
    var out = { total: { units: 0, gold: 0 } };
    ['army', 'air', 'navy'].forEach(function (role) {
      var g = GROUP[role], set = (buildings || []).filter(function (b) { return b.group === g; });
      var top = set.reduce(function (m, b) { return Math.max(m, b.level || 0); }, 0), units = 0;
      set.forEach(function (b) { if ((b.level || 0) === top) units += Math.max(0, QUEUE - (b.queued || 0)); });
      var gold = units * (((buildable || {})[g] || {}).produce_coin || 0);
      out[role] = { units: units, gold: gold };
      out.total.units += units; out.total.gold += gold;
    });
    return out;
  }

  var TroopCore = {
    CONST: CONST, posId: posId, fromPosId: fromPosId, footprint: footprint, toUV: toUV, unitClass: unitClass, buildRegion: buildRegion, buildLandLP: buildLandLP, buildSeaLP: buildSeaLP, decodeLand: decodeLand, decodeSea: decodeSea, greedyLand: greedyLand, planSteps: planSteps, planStatus: planStatus, planRows: planRows, lockTargets: lockTargets, renderModel: renderModel,
    GROUP: GROUP, deleteCandidates: deleteCandidates, buffValue: buffValue, bestTrainingSkin: bestTrainingSkin, occupiedCells: occupiedCells, freeSites: freeSites,
    buildSeaSlotsLP: buildSeaSlotsLP, decodeSeaSlots: decodeSeaSlots, buildingSites: buildingSites, fitToGold: fitToGold,
    extraTrainingBuildings: extraTrainingBuildings, mergeablePairs: mergeablePairs, trainEstimate: trainEstimate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TroopCore;
  else root.TroopCore = TroopCore;
})(typeof window !== 'undefined' ? window : globalThis);
