'use strict';
// Solver integration tests. Needs the `highs` npm package, which the repo does not vendor:
//   mkdir -p /tmp/hnode && (cd /tmp/hnode && npm i highs@1.8.0)
//   NODE_PATH=/tmp/hnode/node_modules node --test test/troop-solver.test.js
// Skips cleanly when highs is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const TC = require('../troop-core.js');

let highsLoader = null;
try { highsLoader = require('highs'); } catch (e) { /* not installed */ }
const fx = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const OPTS = { time_limit: 60, mip_rel_gap: 0 };

test('solver: Rex and Tex max-planes, sea, units and half modes', { skip: !highsLoader && 'highs not installed' }, async () => {
  const highs = await highsLoader();
  const solve = (model) => { const t0 = Date.now(); const sol = highs.solve(model.lp, OPTS); return { sol, ms: Date.now() - t0 }; };

  const rex = TC.buildRegion(fx('troop-rex-before.json'));
  const rexMax = TC.buildLandLP(rex, { mode: 'planes' });
  const a = solve(rexMax);
  assert.equal(a.sol.Status, 'Optimal');
  const rexT = TC.decodeLand(rexMax, a.sol, rex);
  assert.equal(rexT.slots.length, 178);
  assert.equal(rexT.slots.filter((s) => s.role === 'bld').length, 6);
  console.log('rex planes solve ms', a.ms);

  const tex = TC.buildRegion(fx('troop-tex.json'));
  const texMax = TC.buildLandLP(tex, { mode: 'planes' });
  const b = solve(texMax);
  const texT = TC.decodeLand(texMax, b.sol, tex);
  assert.equal(texT.slots.filter((s) => s.role === 'air').length, 168);
  console.log('tex planes solve ms', b.ms);

  const sea = TC.buildSeaLP(tex);
  const c = solve(sea);
  const texSea = TC.decodeSea(sea, c.sol);
  assert.equal(texSea.navy.length, 93);
  assert.equal(texSea.seaBld.length, 3);
  console.log('tex sea solve ms', c.ms);

  const half = TC.buildLandLP(rex, { mode: 'half' });
  const d = solve(half);
  const halfT = TC.decodeLand(half, d.sol, rex);
  assert.equal(halfT.slots.length, half.count);
  assert.equal(halfT.armyCells.length, 762 - 4 * half.count);
  console.log('rex half solve ms', d.ms);

  // Pareto: exactly K slots, maximise items already in place; the plan's move count falls as K drops
  const rows = [];
  for (const K of [178, 175, 170]) {
    const m = TC.buildLandLP(rex, { mode: 'planes', count: K });
    const r = solve(m);
    const tgt = TC.decodeLand(m, r.sol, rex);
    const plan = TC.planSteps(fx('troop-rex-before.json'), rex, tgt, { mode: 'planes' });
    rows.push({ K, moves: plan.stats.moves, ms: r.ms });
  }
  console.log('pareto', JSON.stringify(rows));
  assert.ok(rows[0].moves >= rows[1].moves && rows[1].moves >= rows[2].moves);
});

// Dense, messy full bases: Rex's optimal plane layout shifted, then the gaps filled nearest-first
// (the generator the final review used to find the deadlocks and the solver abort).
function messyBase(dx, dy) {
  const REX = fx('troop-rex-before.json'), TGT = fx('troop-rex-target-178.json');
  const base = TC.buildRegion(REX), land = new Set(base.landCells), bcells = new Set(), occ = new Set(), units = [];
  REX.buildings.forEach((b) => { if (b.type === 5) return; const [x, y] = TC.fromPosId(b.pos); TC.footprint(x, y, b.w, b.h).forEach((c) => bcells.add(c)); });
  const add = (nx, ny) => { const cs = TC.footprint(nx, ny, 2, 2); if (!cs.every((c) => land.has(c) && !bcells.has(c) && !occ.has(c))) return; cs.forEach((c) => occ.add(c)); units.push({ id: 'p' + units.length, armyId: 30100, type: 301, level: 100, w: 2, h: 2, pt: 1, pos: TC.posId(nx, ny), state: 0 }); };
  TGT.slots.filter((s) => s.role === 'air').forEach((s) => { const [x, y] = TC.fromPosId(s.pos); add(x + dx, y + dy); });
  base.landCells.forEach((id) => { const [x, y] = TC.fromPosId(id); add(x, y); });
  const snap = JSON.parse(JSON.stringify(REX)); snap.units = units; snap.storage.air = { max: 1000, used: 1000 };
  return snap;
}

test('solver: messy full bases plan every Max planes row without a deadlock', { skip: !highsLoader && 'highs not installed' }, async () => {
  for (const [dx, dy] of [[-1, 1], [1, 3], [0, 4]]) {
    const snap = messyBase(dx, dy), r = TC.buildRegion(snap);
    const out = await TC.planRows(snap, r, { mode: 'planes' }, async (lp) => (await highsLoader()).solve(lp, OPTS));
    assert.ok(out.exact, 'shift ' + dx + ',' + dy);
    out.rows.forEach((row) => assert.deepEqual(row.result.blocked.filter((b) => b.reason === 'deadlock'), [], 'deadlock at shift ' + dx + ',' + dy + ' row ' + row.planes));
  }
});

test('solver: a solver failure part-way keeps the rows already planned', { skip: !highsLoader && 'highs not installed' }, async () => {
  const snap = messyBase(1, 1), r = TC.buildRegion(snap);
  let calls = 0;
  const out = await TC.planRows(snap, r, { mode: 'planes' }, async (lp) => { if (++calls === 3) throw new Error('RuntimeError: Aborted()'); return (await highsLoader()).solve(lp, OPTS); });
  assert.equal(out.rows.length, 2);
  assert.equal(out.exact, false);
});

test('solver: TroopGame.solve survives the base that aborted a shared HiGHS instance', { skip: !highsLoader && 'highs not installed' }, async () => {
  // load troop-game.js the way the browser does: verified bytes from "the CDN" (here the local npm copy)
  const build = path.dirname(require.resolve('highs'));
  const files = { 'highs.js': fs.readFileSync(path.join(build, 'highs.js')), 'highs.wasm': fs.readFileSync(path.join(build, 'highs.wasm')) };
  Object.assign(globalThis, { window: globalThis, cc: { find: () => null }, __require: () => null, require, __dirname: build, __filename: path.join(build, 'highs.js'),
    fetch: async (url) => { const b = files[url.split('/').pop()]; return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; } });
  const file = path.join(__dirname, '..', 'troop-game.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const TG = globalThis.TroopGame;
  const snap = messyBase(0, 2), r = TC.buildRegion(snap);
  const out = await TC.planRows(snap, r, { mode: 'planes' }, (lp) => TG.solve(lp, 60));
  assert.deepEqual(out.notes, []);
  assert.equal(out.exact, true);
  assert.ok(out.rows.length >= 7, 'rows ' + out.rows.length);
});
