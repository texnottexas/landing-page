(function (root) {
  'use strict';

  var CONST = {
    HERO_ID: 312, SKILL_ID: 10312, ES_SKILL_ID: 20625,
    BASE_FLAT: 1400, WAR_FACTOR: 3, VALUE_TYPE: 10000,
    ES_TABLE: [0, 200, 400, 600, 800, 1100, 1600, 2200, 2900, 3700, 4600]
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function basePctFromWar(war) {
    return (CONST.BASE_FLAT + (war / 100) * CONST.WAR_FACTOR) / 100;
  }

  function esMult(esLevel) {
    return 1 + CONST.ES_TABLE[clamp(esLevel | 0, 0, 10)] / CONST.VALUE_TYPE;
  }

  function decodeArmy(armyId) {
    var s = String(armyId);
    if (s.length !== 6 || s[0] === '5') {
      return { branch: null, level: null, isAir: false, isMecha: true };
    }
    var branch = s.slice(0, 3);
    var level = parseInt(s.slice(3), 10);
    var isAir = branch === '905' || branch === '906' || branch[0] === '3';
    return { branch: branch, level: level, isAir: isAir, isMecha: false };
  }

  function sumStacks(unit) {
    var t = 0;
    for (var k in unit) {
      if (/^s\d+$/.test(k) && typeof unit[k] === 'number') t += unit[k];
    }
    return t;
  }

  function summarizeArmy(arr) {
    arr = arr || [];
    var troops = 0, mecha = 0, air = 0, lvlSum = 0, lvlCount = 0, units = [];
    for (var i = 0; i < arr.length; i++) {
      var d = decodeArmy(arr[i].armyId);
      var cnt = sumStacks(arr[i]);
      units.push({ armyId: arr[i].armyId, level: d.level, isAir: d.isAir, isMecha: d.isMecha, count: cnt });
      if (d.isMecha) { mecha += cnt; continue; }
      troops += cnt;
      if (d.isAir) air += cnt;
      if (d.level) { lvlSum += d.level * cnt; lvlCount += cnt; }
    }
    return {
      troops: troops, mecha: mecha, air: air,
      avgLvl: lvlCount ? lvlSum / lvlCount : null,
      allAir: mecha === 0 && troops > 0 && air === troops,
      units: units
    };
  }

  function compute(o) {
    var basePct = o.basePct;
    var mult = esMult(o.esLevel);
    var levelDeficit = (o.yourLvl == null || o.enemyLvl == null) ? 0 : Math.max(0, o.enemyLvl - o.yourLvl);
    var levelPenalty = Math.pow(0.5, levelDeficit);
    var marchPenalty = o.enemyTroops ? Math.min(1, o.yourTroops / o.enemyTroops) : 1;
    var airMult = o.allAir ? 1 : 0;

    var effectivePct = basePct * mult * levelPenalty * marchPenalty * airMult;
    var ceilingPct = basePct * mult;
    var unitsNow = Math.round(effectivePct / 100 * (o.enemyTroops || 0));
    var unitsCeiling = Math.round(ceilingPct / 100 * (o.enemyTroops || 0));
    var efficiency = ceilingPct > 0 ? effectivePct / ceilingPct : 0;

    var result = {
      basePct: basePct, esMult: mult, levelPenalty: levelPenalty, marchPenalty: marchPenalty,
      effectivePct: effectivePct, ceilingPct: ceilingPct,
      unitsNow: unitsNow, unitsCeiling: unitsCeiling, efficiency: efficiency,
      checks: null, advice: null
    };
    return result;
  }

  var RockfieldCore = {
    CONST: CONST, basePctFromWar: basePctFromWar, esMult: esMult,
    decodeArmy: decodeArmy, summarizeArmy: summarizeArmy, compute: compute
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RockfieldCore;
  else root.RockfieldCore = RockfieldCore;
})(typeof window !== 'undefined' ? window : globalThis);
