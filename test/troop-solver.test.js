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
