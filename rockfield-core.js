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

  function fmtLvl(l) { return l == null ? '?' : (Math.round(l * 10) / 10); }

  function buildAdvice(o, checks) {
    var advice = [];
    var air = checks[0], level = checks[1], march = checks[2];
    if (!air.ok) {
      advice.push({ kind: 'fix', text: 'This march was not 100% air force, so Punisher did nothing. Send only air force units (no Heavy Troopers).' });
    }
    if (!level.ok) {
      var deficit = Math.ceil((o.enemyLvl || 0) - (o.yourLvl || 0));
      advice.push({ kind: 'fix', text: 'Your units are ' + deficit + ' level(s) below the enemy, which halves damage per level. Use L103 (Valhalla or free +2 unit cards) instead of L101 Heavy Troopers.' });
    }
    if (!march.ok) {
      var pct = o.enemyTroops ? Math.round((1 - o.yourTroops / o.enemyTroops) * 100) : 0;
      advice.push({ kind: 'fix', text: 'Your march is ' + pct + '% smaller than the enemy\'s, which is the whole march penalty. It scales 1 for 1, so any gain helps. Grow march size over time with Kuruzo as your 2nd hero at 5 stars and March Size skills (Rare + Normal) equipped.' });
    }
    var es = o.esLevel | 0;
    if (es < 5) {
      advice.push({ kind: 'upside', text: 'Get Rockfield to ES5, your baseline target. Shards are free from the Island Store.' });
    } else if (es < 7) {
      advice.push({ kind: 'upside', text: 'You are at the ES5 baseline. Aim for ES7 over time (free Island Store shards) for a bit more.' });
    } else {
      advice.push({ kind: 'upside', text: 'Your exclusive skill is strong.' });
    }
    return advice;
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

    var checks = [
      { key: 'air', ok: !!o.allAir, label: 'All Air Force',
        detail: o.allAir ? 'skill fires' : 'non-air units present', mult: airMult },
      { key: 'level', ok: (o.yourLvl == null || o.enemyLvl == null) ? true : (o.yourLvl >= o.enemyLvl), label: 'Your level ≥ enemy',
        detail: fmtLvl(o.yourLvl) + ' vs ' + fmtLvl(o.enemyLvl), mult: levelPenalty },
      { key: 'march', ok: (o.yourTroops >= o.enemyTroops), label: 'Your march ≥ enemy',
        detail: o.yourTroops + ' vs ' + o.enemyTroops +
          (o.yourTroops < o.enemyTroops ? ' (' + Math.round((o.yourTroops / o.enemyTroops - 1) * 100) + '%)' : ''),
        mult: marchPenalty }
    ];

    var result = {
      basePct: basePct, esMult: mult, levelPenalty: levelPenalty, marchPenalty: marchPenalty,
      effectivePct: effectivePct, ceilingPct: ceilingPct,
      unitsNow: unitsNow, unitsCeiling: unitsCeiling, efficiency: efficiency,
      checks: checks, advice: buildAdvice(o, checks)
    };
    return result;
  }

  var RockfieldCore = {
    CONST: CONST, basePctFromWar: basePctFromWar, esMult: esMult,
    decodeArmy: decodeArmy, summarizeArmy: summarizeArmy, compute: compute, buildAdvice: buildAdvice
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RockfieldCore;
  else root.RockfieldCore = RockfieldCore;
})(typeof window !== 'undefined' ? window : globalThis);
