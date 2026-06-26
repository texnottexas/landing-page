const test = require('node:test');
const assert = require('node:assert');
const RC = require('../rockfield-core.js');

const close = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ~= ${b}`);

test('basePctFromWar matches game renderer', () => {
  close(RC.basePctFromWar(0), 14.0);
  close(RC.basePctFromWar(30000), 23.0);
  close(RC.basePctFromWar(33214), 23.9642);
});

test('esMult from ES_TABLE', () => {
  close(RC.esMult(0), 1.0);
  close(RC.esMult(5), 1.11);
  close(RC.esMult(6), 1.16);   // NOT 1.18
  close(RC.esMult(10), 1.46);
  close(RC.esMult(99), 1.46);  // clamps to 10
});

test('decodeArmy: branch, level, air, mecha', () => {
  assert.deepStrictEqual(RC.decodeArmy(905103), { branch: '905', level: 103, isAir: true, isMecha: false });
  assert.deepStrictEqual(RC.decodeArmy(902103), { branch: '902', level: 103, isAir: false, isMecha: false });
  assert.strictEqual(RC.decodeArmy(507241).isMecha, true);
});

test('summarizeArmy excludes mecha from troops + level', () => {
  const s = RC.summarizeArmy([{ armyId: 905103, s0: 100, s1: 80 }, { armyId: 507241, s0: 25 }]);
  assert.strictEqual(s.troops, 180);
  assert.strictEqual(s.mecha, 25);
  assert.strictEqual(s.avgLvl, 103);
  assert.strictEqual(s.allAir, false);
});

test('summarizeArmy not allAir when mecha present in own march', () => {
  const s = RC.summarizeArmy([{ armyId: 905103, s0: 100 }, { armyId: 507241, s0: 25 }]);
  assert.strictEqual(s.allAir, false);
});

test('compute core math (march deficit, no level deficit)', () => {
  const r = RC.compute({ basePct: 23.9642, esLevel: 5, yourLvl: 103, enemyLvl: 103, yourTroops: 280, enemyTroops: 382, allAir: true });
  close(r.effectivePct, 19.50, 0.1);
  close(r.ceilingPct, 26.60, 0.1);
  assert.strictEqual(r.unitsNow, 74);
  assert.strictEqual(r.unitsCeiling, 102);
  close(r.efficiency, 0.733, 0.01);
});

test('compute: not allAir => zero', () => {
  const r = RC.compute({ basePct: 23, esLevel: 5, yourLvl: 103, enemyLvl: 103, yourTroops: 300, enemyTroops: 300, allAir: false });
  assert.strictEqual(r.effectivePct, 0);
  assert.strictEqual(r.unitsNow, 0);
});

test('summarizeArmy ignores non-stack s-prefixed keys', () => {
  const s = RC.summarizeArmy([{ armyId: 905103, s0: 100, s1: 80, speed: 999 }]);
  assert.strictEqual(s.troops, 180);
});

test('checks reflect each condition', () => {
  const r = RC.compute({ basePct: 24, esLevel: 5, yourLvl: 103, enemyLvl: 103, yourTroops: 280, enemyTroops: 382, allAir: true });
  const byKey = Object.fromEntries(r.checks.map(c => [c.key, c]));
  assert.strictEqual(byKey.air.ok, true);
  assert.strictEqual(byKey.level.ok, true);
  assert.strictEqual(byKey.march.ok, false);
  close(byKey.march.mult, 0.733, 0.01);
});

test('advice: march deficit fix + ES5 baseline upside', () => {
  const r = RC.compute({ basePct: 24, esLevel: 5, yourLvl: 103, enemyLvl: 103, yourTroops: 280, enemyTroops: 382, allAir: true });
  const texts = r.advice.map(a => a.text).join(' | ');
  assert.match(texts, /march is 27% smaller/);
  assert.match(texts, /Kuruzo/);
  assert.match(texts, /March Size skills/);
  assert.match(texts, /ES5 baseline/);
  assert.match(texts, /ES7/);
  assert.ok(!/—/.test(texts), 'no em dashes in advice');
});

test('advice: sub-ES5 pushes to ES5; air fail message', () => {
  const r = RC.compute({ basePct: 24, esLevel: 2, yourLvl: 101, enemyLvl: 103, yourTroops: 300, enemyTroops: 300, allAir: false });
  const texts = r.advice.map(a => a.text).join(' | ');
  assert.match(texts, /not 100% air force/);
  assert.match(texts, /below the enemy/);
  assert.match(texts, /Get Rockfield to ES5/);
  assert.match(texts, /Island Store/);
});

test('null levels do not trigger a false level deficit', () => {
  const r = RC.compute({ basePct: 24, esLevel: 5, yourLvl: null, enemyLvl: null, yourTroops: 300, enemyTroops: 300, allAir: true });
  const level = r.checks.find(c => c.key === 'level');
  assert.strictEqual(level.ok, true);
  assert.ok(!r.advice.some(a => /level\(s\) below/.test(a.text)), 'no bogus level-deficit advice');
});

test('march advice pct is sane when enemyTroops is 0', () => {
  const r = RC.compute({ basePct: 24, esLevel: 5, yourLvl: 103, enemyLvl: 103, yourTroops: 0, enemyTroops: 0, allAir: true });
  const texts = r.advice.map(a => a.text).join(' ');
  assert.ok(!/NaN|Infinity/.test(texts), 'no NaN/Infinity in advice');
});

const fs = require('node:fs');
const path = require('node:path');
function fixture(id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', id + '.json'), 'utf8'));
}

test('parseReport: march-deficit report', () => {
  const p = RC.parseReport(fixture('4724763863828291593'));
  assert.strictEqual(p.found, true);
  assert.strictEqual(p.side, 'attacker');
  assert.strictEqual(p.you.war, 33214);
  assert.strictEqual(p.you.esLevel, 5);
  assert.strictEqual(p.you.troops, 280);
  assert.strictEqual(Math.round(p.you.avgLvl), 103);
  assert.strictEqual(p.you.allAir, true);
  assert.strictEqual(p.enemy.troops, 382);
  assert.strictEqual(Math.round(p.enemy.avgLvl), 103);
  assert.ok(p.actualPunisherDamage > 0);

  const r = RC.compute({
    basePct: p.you.basePct, esLevel: p.you.esLevel,
    yourLvl: p.you.avgLvl, enemyLvl: p.enemy.avgLvl,
    yourTroops: p.you.troops, enemyTroops: p.enemy.troops, allAir: p.you.allAir
  });
  assert.strictEqual(r.unitsNow, 74);
  assert.strictEqual(r.unitsCeiling, 102);
});

test('parseReport: ES4 full-march report', () => {
  const p = RC.parseReport(fixture('4724810303346728960'));
  assert.strictEqual(p.you.war, 24395);
  assert.strictEqual(p.you.esLevel, 4);
  assert.strictEqual(p.you.troops, 215);
  assert.strictEqual(p.enemy.troops, 174);
  const r = RC.compute({ basePct: p.you.basePct, esLevel: p.you.esLevel, yourLvl: p.you.avgLvl, enemyLvl: p.enemy.avgLvl, yourTroops: p.you.troops, enemyTroops: p.enemy.troops, allAir: p.you.allAir });
  assert.strictEqual(r.unitsNow, 40);
});

test('parseReport: ES0 report', () => {
  const p = RC.parseReport(fixture('4725121119006646276'));
  assert.strictEqual(p.you.esLevel, 0);
  assert.strictEqual(p.you.war, 40392);
  const r = RC.compute({ basePct: p.you.basePct, esLevel: p.you.esLevel, yourLvl: p.you.avgLvl, enemyLvl: p.enemy.avgLvl, yourTroops: p.you.troops, enemyTroops: p.enemy.troops, allAir: p.you.allAir });
  assert.strictEqual(r.unitsNow, 63);
});

test('parseReport: missing Rockfield', () => {
  assert.strictEqual(RC.parseReport({ battle: { fightMarches: [{}], attacker: { players: [{ heroList: [{ id: 999 }] }] }, defender: { players: [{ heroList: [] }] } } }).found, false);
});
