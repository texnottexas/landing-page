(function (root) {
  'use strict';

  var CONST = {
    HERO_ID: 312, SKILL_ID: 10312, ES_SKILL_ID: 20625, KURUZO_ID: 116,
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

  // armyId encoding (matches battle-report.html resolveUnitIcon):
  //   6-digit '50x'  = Mecha / Heavy Trooper (a type id, not branch+level)
  //   6-digit '90x'  = Valhalla merged; 905/906 = Air Force, others Army/Navy
  //   5-digit        = base troop; first digit 1=Army, 2=Navy, 3=Air Force
  // For non-mecha units, level is always the last 3 digits.
  function decodeArmy(armyId) {
    var s = String(armyId);
    if (s.length === 6 && s.slice(0, 2) === '50') {
      return { branch: null, level: null, isAir: false, isMecha: true };
    }
    if (s.length === 6 && s.slice(0, 2) === '90') {
      var tc = s.slice(0, 3);
      return { branch: tc, level: parseInt(s.slice(-3), 10), isAir: tc === '905' || tc === '906', isMecha: false };
    }
    if (s.length === 5) {
      var fd = s.charAt(0);
      return { branch: fd, level: parseInt(s.slice(-3), 10), isAir: fd === '3', isMecha: false };
    }
    return { branch: null, level: null, isAir: false, isMecha: false };
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
      var base = 'Your march is ' + pct + '% smaller than the enemy\'s, which is the whole march penalty. It scales 1 for 1, so any gain helps.';
      // If they already run Kuruzo, do not re-pitch it here (a congrats line
      // handles that below); the remaining lever is the March Size skills.
      var lever = (o.kuruzoStar != null)
        ? ' Keep growing march size with March Size skills (Rare + Normal) equipped.'
        : ' Grow march size over time with Kuruzo as your 2nd hero at 5 stars and March Size skills (Rare + Normal) equipped.';
      advice.push({ kind: 'fix', text: base + lever });
    }
    // Positive acknowledgement: they are already running Kuruzo, the march-size hero.
    if (o.kuruzoStar != null && o.kuruzoStar >= 5) {
      advice.push({ kind: 'good', text: 'You already run Kuruzo at 5 stars as your second hero, the right pick for march size. Nice work.' });
    } else if (o.kuruzoStar != null) {
      advice.push({ kind: 'good', text: 'Good call running Kuruzo for march size. Take it to 5 stars as your second hero for the full bonus.' });
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

  function parseReport(json) {
    var b = (json && json.battle) ? json.battle : json;
    if (!b || !b.fightMarches || !b.fightMarches[0]) return { found: false };
    var fm = b.fightMarches[0];
    var sides = ['attacker', 'defender'], side = null, hero = null;
    for (var i = 0; i < sides.length; i++) {
      var pl = b[sides[i]] && b[sides[i]].players && b[sides[i]].players[0];
      if (pl && pl.heroList) {
        for (var j = 0; j < pl.heroList.length; j++) {
          if (pl.heroList[j].id === CONST.HERO_ID) { side = sides[i]; hero = pl.heroList[j]; break; }
        }
      }
      if (side) break;
    }
    if (!side) return { found: false };

    var es = 0, nas = hero.nonActiveSkills || [];
    for (var k = 0; k < nas.length; k++) {
      if (nas[k].skillId === CONST.ES_SKILL_ID) { es = nas[k].level || 0; break; }
    }

    // Is Kuruzo (the march-size hero) in this march, and at what star?
    var kuruzoStar = null, hl = (b[side].players[0].heroList) || [];
    for (var h = 0; h < hl.length; h++) {
      if (hl[h].id === CONST.KURUZO_ID) { kuruzoStar = hl[h].star != null ? hl[h].star : 0; break; }
    }

    var youKey = side === 'attacker' ? 'attPutArmyV2' : 'defPutArmyV2';
    var enemyKey = side === 'attacker' ? 'defPutArmyV2' : 'attPutArmyV2';
    var youLegacy = side === 'attacker' ? 'attPutArmy' : 'defPutArmy';
    var enemyLegacy = side === 'attacker' ? 'defPutArmy' : 'attPutArmy';
    var you = summarizeArmy(fm[youKey] || fm[youLegacy]);
    var enemy = summarizeArmy(fm[enemyKey] || fm[enemyLegacy]);

    var dmg = 0, proc = b.process || [];
    for (var p = 0; p < proc.length; p++) {
      if (proc[p].t === 10 && String(proc[p].skill) === String(CONST.SKILL_ID)) dmg += (proc[p].val || 0);
    }

    var attackerWon = b.result === 2;
    return {
      found: true, side: side,
      reportId: (json && json.reportId) || b.reportId || null,
      result: b.result, won: side === 'attacker' ? attackerWon : !attackerWon,
      fightType: b.fightType,
      you: { war: hero.war || 0, esLevel: es, avgLvl: you.avgLvl, troops: you.troops, allAir: you.allAir, units: you.units, kuruzoStar: kuruzoStar, basePct: basePctFromWar(hero.war || 0) },
      enemy: { avgLvl: enemy.avgLvl, troops: enemy.troops, hasMecha: enemy.mecha > 0, units: enemy.units },
      actualPunisherDamage: dmg || null
    };
  }

  var RockfieldCore = {
    CONST: CONST, basePctFromWar: basePctFromWar, esMult: esMult,
    decodeArmy: decodeArmy, summarizeArmy: summarizeArmy, compute: compute, buildAdvice: buildAdvice, parseReport: parseReport
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RockfieldCore;
  else root.RockfieldCore = RockfieldCore;
})(typeof window !== 'undefined' ? window : globalThis);
