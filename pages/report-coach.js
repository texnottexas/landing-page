/* report-coach.js: "What to work on next" logic for one battle report.
 *
 * Pure logic: no DOM, no fetch, no storage. Works as window.ReportCoach in a browser and via module.exports in node.
 * Every table is passed in, never fetched here.
 *
 *   ReportCoach.analyze(report, tables) ->
 *     { fight: { rounds, winner: 'attacker'|'defender',
 *                closeness: { loserProgress, label: 'close'|'clear'|'out-of-reach' } | null },
 *       sides: { attacker: Side, defender: Side } }
 *   Side = { name, won, cp, troops, heroes, gaps: [{area, label, mine, theirs, share, stats}],
 *            moves: [{tier: 'free'|'upgrade'|'long', id, area, title, detail, evidence, data}], errors }
 *
 *   gaps[].stats = [{key, label, unit: '%'|'troops', mine, theirs}] for that source: Attack, HP, Damage increase, Damage taken reduction, Crit rate,
 *   Crit damage, Hit, Dodge, Defense (percent points, 1 decimal) and March size (a troop count, last). Non-zero for either side, biggest gap first.
 *   ATK + HP + Damage increase + Damage taken add up to the area's mine / theirs (within rounding).
 *   Gear moves judge gold gear only (equipId % 100 === 4, the only gear that takes a rune) and name the heroes involved, worst first.
 *
 *   closeness.loserProgress = loser total_hurt / (2.7 x winner maxPower), as a fraction (0.09 = 9%).
 *   2.7 is the median of winner damage / loser maxPower over 21 wiped-out duels (docs 04-outcome S2).
 *   'close' >= 0.30, 'out-of-reach' < 0.12, otherwise 'clear'.
 *
 * tables (all optional except buffGroup; a lever whose table is missing is skipped):
 *   buffGroup    the viewer's BUFF_GROUP (raw buff id -> display id or ids)               [pages/battle-report.html]
 *   heroes       data/all-heroes.json            (names, branch, exclusive skill)
 *   supportive   data/supportive-skills.json     (skill id -> name)
 *   talents      data/hero-talents.json          (kept for callers; levels come from ttsr)
 *   runes        data/rune-types.json            (merge costs, not required for the text)
 *   collectibles data/loot-quest-collectibles.json (themes and their items)
 *   formation    data/formation-v2.json          (science maxima, army mastery rows)
 *   enhance      data/enigma-platform-enhance.json (slot level caps; default 20 for fields 1-3, 40 for 4-5)
 *   decorLookups data/decor-lookups.json         (only DECOR_SUITS is read; default 23 suits)
 *   game         pages/tw-game-data.js exports: resolveRune, GEAR_TEMPLATE, EXCL_SKILL_ID, EB_FIELD_NAMES.
 *                Defaults to window.TWGameData, or require('./tw-game-data.js') in node.
 *
 * Source numbers come from the trace of each buff (traceEffectBuffs[].s). See docs 02-buff-sources.md.
 */
(function () {
  'use strict';

  var KILL_FACTOR = 2.7;
  var CLOSE_AT = 0.30, OUT_OF_REACH_BELOW = 0.12;
  var MAX_MOVES = 6, MAX_FREE = 3, MAX_LONG = 1;

  // ---- troop / army ids -------------------------------------------------------------------------------------------
  var BRANCH_LABEL = { army: 'Army', navy: 'Navy', af: 'Air Force' };
  var MASTERY_CODE = { army: 101, navy: 201, af: 301 };

  // armyId -> troop type. 901/902 Army, 903/904 Navy, 905/906 Air Force; 5-digit base ids lead with 1/2/3; 50xxxx = mecha.
  function armyType(id) {
    var s = String(id);
    if (s.length === 6 && s.indexOf('90') === 0) return { 1: 'army', 2: 'army', 3: 'navy', 4: 'navy', 5: 'af', 6: 'af' }[s[2]] || null;
    if (s.length === 5) return { 1: 'army', 2: 'navy', 3: 'af' }[s[0]] || null;
    return null;
  }
  function armyKind(id) {
    var s = String(id);
    if (s.length === 6 && s.indexOf('90') === 0) return 'valhalla';
    if (s.length === 6 && s.indexOf('50') === 0) return 'mecha';
    if (s.length === 5) return 'base';
    return 'other';
  }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  function fielded(list) {
    var w = { army: 0, navy: 0, af: 0 };
    (list || []).forEach(function (a) {
      var t = armyType(a.armyId);
      if (t) w[t] += num(a.s0) + num(a.s1) + num(a.s0Extra) + num(a.s1Extra);
    });
    var n = w.army + w.navy + w.af;
    if (!n) return null;
    return { army: w.army / n, navy: w.navy / n, af: w.af / n };
  }
  function mainBranch(w, heroBranches) {
    if (w) {
      var best = null;
      ['army', 'navy', 'af'].forEach(function (t) { if (w[t] > 0 && (best === null || w[t] > w[best])) best = t; });
      if (best) return best;
    }
    var c = { army: 0, navy: 0, af: 0 };
    (heroBranches || []).forEach(function (b) { if (c[b] != null) c[b]++; });
    var top = null;
    ['army', 'navy', 'af'].forEach(function (t) { if (c[t] > 0 && (top === null || c[t] > c[top])) top = t; });
    return top;
  }

  // ---- buff trace: sources and stats ------------------------------------------------------------------------------
  // ids the game skips (same list the viewer uses)
  function skippedId(id) {
    return [520130, 520131, 520132, 520133, 520141, 520142, 520143, 933007, 933008, 934001, 934004, 950011].indexOf(id) >= 0 ||
      (id >= 932001 && id <= 932043) || (id >= 936007 && id <= 936013);
  }
  // "all units" display ids -> per-branch display ids (only the four stats the gap uses)
  var ALL_UNITS = {
    930000: [930001, 930002, 930003], 930100: [930101, 930102, 930103], 980100: [980101, 980102, 980103],
    980200: [980201, 980202, 980203], 1001001: [980101, 980102, 980103], 1101040: [980201, 980202, 980203],
    990563: [930001, 930002, 930003]
  };
  var STAT = {};
  [['HP', 930001], ['ATK', 930101], ['DMGInc', 980101], ['DMGTaken', 980201],
   ['CritRate', 930201], ['CritDmg', 980301], ['Hit', 980501], ['Dodge', 930301], ['Defense', 990203]].forEach(function (f) {
    ['army', 'navy', 'af'].forEach(function (t, i) { STAT[f[1] + i] = [f[0], t]; });
  });
  STAT[960012] = ['March', 'all'];
  ALL_UNITS[990202] = [990203, 990204, 990205];
  // the four stats whose sum is the area total, and the table the tap-to-see breakdown reads (label, unit)
  var CORE = { HP: 1, ATK: 1, DMGInc: 1, DMGTaken: 1 };
  var STAT_INFO = [
    ['ATK', 'Attack', '%'], ['HP', 'HP', '%'], ['DMGInc', 'Damage increase', '%'], ['DMGTaken', 'Damage taken reduction', '%'],
    ['CritRate', 'Crit rate', '%'], ['CritDmg', 'Crit damage', '%'], ['Hit', 'Hit', '%'], ['Dodge', 'Dodge', '%'],
    ['Defense', 'Defense', '%'], ['March', 'March size', 'troops']
  ];

  // trace source (type_small) -> area. Names follow the lead's checks of the trace against the game's own tables.
  var AREAS = {
    106: { id: 'beast-skills', label: 'Beast skills' },
    107: { id: 'beast-fields', label: 'Beast fields' },
    25: { id: 'base-skins', label: 'Base skins' },
    134: { id: 'base-skins-other', label: 'Base skins (other)' },
    88: { id: 'base-skins-other', label: 'Base skins (other)' },
    75: { id: 'castle', label: 'Castle effects' },
    76: { id: 'march-skins', label: 'March skins' },
    7: { id: 'decor', label: 'Decorations' },
    26: { id: 'unit-equip', label: 'Unit equipment' },
    32: { id: 'formation', label: 'Formation' },
    41: { id: 'formation', label: 'Formation' },
    17: { id: 'army-mastery', label: 'Army mastery' },
    44: { id: 'collections', label: 'Collections' }
  };
  // These follow the heroes in the march, so they only count when both sides field the same heroes.
  var HERO_AREAS = {
    2: { id: 'hero-skills', label: 'Hero skills' },
    3: { id: 'hero-perk', label: 'Hero perk' },
    16: { id: 'hero-bond', label: 'Hero bond' },
    37: { id: 'titan-gear', label: 'Titan gear' },
    27: { id: 'heavy-trooper', label: 'Heavy trooper' },
    104: { id: 'hero-prebattle', label: 'Hero pre-battle skill' },
    114: { id: 'hero-awakening', label: 'Hero awakening' },
    116: { id: 'hero-awakening', label: 'Hero awakening' },
    139: { id: 'hero-skin', label: 'Hero skin' }
  };
  // Mode-only sources (wasteland, ruin bonus) and temporary items are left out of the comparison.
  // 64 = temporary boost items. 111/112/135 = wasteland airship, wasteland, warzone guardian (fight_report_from_show).
  var DROPPED = { 111: 1, 112: 1, 135: 1, 95: 1, 64: 1 };

  function expand(buffGroup, id, val) {
    if (skippedId(id)) return [];
    var disp = buffGroup[id];
    disp = disp === undefined ? [id] : (Array.isArray(disp) ? disp : [disp]);
    var out = [];
    disp.forEach(function (d) {
      (ALL_UNITS[d] || [d]).forEach(function (x) {
        var c = STAT[x];
        if (c) out.push({ stat: c[0], troop: c[1], val: val });
      });
    });
    return out;
  }

  // core points (ATK + HP + DMG increase + DMG taken, 100 raw = 1 point) per area, weighted by the troops fielded
  function sourcePoints(player, w, withHeroAreas, buffGroup) {
    var wt = w || { army: 1 / 3, navy: 1 / 3, af: 1 / 3 };
    var byArea = {}, total = 0;
    (player.traceEffectBuffs || []).forEach(function (t) {
      if (DROPPED[t.s]) return;
      var area = AREAS[t.s] || (HERO_AREAS[t.s] && withHeroAreas ? HERO_AREAS[t.s] : null);
      if (!area && HERO_AREAS[t.s]) return;
      expand(buffGroup, t.id, num(t.val)).forEach(function (e) {
        // March size is a troop count (raw value), every other stat is a percentage (raw 100 = 1%) weighted by the troops fielded
        var pts = e.stat === 'March' ? e.val : e.val * wt[e.troop] / 100;
        if (CORE[e.stat]) total += pts;
        if (area) {
          var a = byArea[area.id] || (byArea[area.id] = { id: area.id, label: area.label, pts: 0, stats: {} });
          if (CORE[e.stat]) a.pts += pts;
          a.stats[e.stat] = (a.stats[e.stat] || 0) + pts;
        }
      });
    });
    return { byArea: byArea, total: total };
  }

  // ---- reading one side -------------------------------------------------------------------------------------------
  function playerName(p) {
    try { var i = JSON.parse(p.playerInfo); return i.nickname || i.username || '?'; } catch (e) { return '?'; }
  }
  function sideBranchOfHero(heroTable, id) {
    var h = heroTable && heroTable[id];
    if (!h) return null;
    return { 'Army': 'army', 'Navy': 'navy', 'Air Force': 'af' }[h.typeName] || null;
  }
  function indexBy(list, key) {
    var m = {};
    (list || []).forEach(function (x) { m[x[key]] = x; });
    return m;
  }

  function readSide(report, key, tables, G) {
    var b = report.battle, side = b[key], fm = (b.fightMarches || [])[0] || {};
    var pre = key === 'attacker' ? 'att' : 'def';
    var p = (side.players || [])[0] || {};
    var put = fm[pre + 'PutArmyV2'] || [];
    var heroTable = indexBy(tables.heroes, 'heroId');
    var supp = indexBy(tables.supportive, 'id');
    var heroes = (p.heroList || []).map(function (h) {
      var info = heroTable[h.id] || {};
      var ns = h.nonActiveSkills || [];
      var exclId = (G.EXCL_SKILL_ID && G.EXCL_SKILL_ID[h.id]) || (info.exclusiveSkill && info.exclusiveSkill.id) || null;
      var excl = exclId ? ns.filter(function (s) { return s.skillId === exclId; })[0] : null;
      var equipped = [], empty = 0;
      ns.forEach(function (s, i) {
        if (i === 0) return;
        if (s.skillId === 0) { empty++; return; }
        if (s.skillId === exclId || !supp[s.skillId]) return;
        var name = supp[s.skillId].name, m = /^(Army|Navy|Air Force) /.exec(name);
        equipped.push({ id: s.skillId, name: name, level: s.level, branch: m ? { 'Army': 'army', 'Navy': 'navy', 'Air Force': 'af' }[m[1]] : null,
          protection: /Protection$/.test(name) });
      });
      return {
        id: h.id, name: info.displayName || ('Hero ' + h.id), branch: sideBranchOfHero(heroTable, h.id), raw: h,
        exclusive: excl ? excl.level : null, equipped: equipped, empty: empty
      };
    });
    var w = fielded(put);
    var branch = mainBranch(w, heroes.map(function (h) { return h.branch; }));
    var brought = 0, lost = 0, base = 0, mecha = 0, valhalla = 0;
    put.forEach(function (a) {
      var n = num(a.s0) + num(a.s1);
      brought += n; lost += num(a.s1);
      var k = armyKind(a.armyId);
      if (k === 'base') base += n; else if (k === 'mecha') mecha += n; else if (k === 'valhalla') valhalla += n;
    });
    var per = (side.units || []).map(function (u) { return (u.uuids || [1]).length; });
    return {
      key: key, name: playerName(p), player: p, heroes: heroes, weights: w, branch: branch,
      cp: num(fm[pre + 'BattlePowerVal']), maxPower: num(fm[pre + 'MaxPower']),
      hurt: num((fm[pre + 'SkillHurts'] || {}).total_hurt),
      troops: {
        brought: brought || num(fm[pre + 'ArmyNum']), lost: lost,
        lostPct: brought ? Math.round(1000 * lost / brought) / 10 : null,
        perSlot: per.length ? [Math.min.apply(null, per), Math.max.apply(null, per)] : null,
        basePct: brought ? Math.round(100 * base / brought) : null, mechaPct: brought ? Math.round(100 * mecha / brought) : null,
        valhallaPct: brought ? Math.round(100 * valhalla / brought) : null
      }
    };
  }

  // ---- levers (each returns zero or more moves for ONE side, given the opponent) ----------------------------------
  var RUNE_EFFECT = { // effect by star, % (game table hero_equip_skill_rd_library, docs 03-levers G4)
    'Artillery Storm': [4, 7, 11, 15, 20, 25, 30], 'Steel Torrent': [4, 7, 11, 15, 20, 25, 30],
    'All-Out Surge': [15, 18, 22, 27, 33, 40, 50], 'Unbreakable': [15, 18, 22, 27, 33, 40, 50],
    'Tactical Awareness': [10, 15, 20, 25, 30, 35, 40], 'Stealth Hologram': [10, 15, 20, 25, 30, 35, 40]
  };

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameList(a) {
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  function move(tier, id, area, score, title, detail, evidence, data) {
    return { tier: tier, id: id, area: area, title: title, detail: detail, evidence: evidence, data: data || {}, _score: score };
  }
  function countProtection(me) { return me.heroes.filter(function (h) { return h.equipped.some(function (s) { return s.protection && s.branch === me.branch; }); }).length; }

  function skillMoves(me, them) {
    var out = [], br = BRANCH_LABEL[me.branch];
    if (!me.heroes.length) return out;
    if (me.branch) {
      var mine = countProtection(me), theirs = countProtection(them);
      if (mine === 0 && theirs > 0) {
        var sameBr = them.branch === me.branch;
        var theirBr = BRANCH_LABEL[them.branch] || '';
        var other = {}, otherN = 0;
        me.heroes.forEach(function (h) {
          var hit = h.equipped.filter(function (s) { return s.protection && s.branch && s.branch !== me.branch; });
          if (hit.length) { otherN++; hit.forEach(function (s) { other[BRANCH_LABEL[s.branch]] = 1; }); }
        });
        var otherNames = Object.keys(other);
        var theirPart = them.name + ' runs ' + (sameBr ? br : theirBr) + ' Protection on ' + theirs + ' of ' + them.heroes.length + ' heroes.';
        out.push(move('free', 'protection', 'Hero skills', 100, otherN ? 'Swap to ' + br + ' Protection' : 'Equip ' + br + ' Protection skills',
          otherN
            ? otherN + (otherN === 1 ? ' of your heroes carries ' : ' of your heroes carry ') + nameList(otherNames.map(function (n) { return n + ' Protection'; })) +
              ', but your march is ' + br + '. ' + theirPart
            : 'None of your heroes carries ' + br + ' Protection. ' + them.name + ' runs ' + (sameBr ? 'it' : theirBr + ' Protection') + ' on ' + theirs + ' of ' + them.heroes.length + ' heroes.',
          '0 of ' + me.heroes.length + ' heroes, against ' + theirs + ' of ' + them.heroes.length,
          { mine: mine, theirs: theirs, branch: me.branch, theirBranch: them.branch, otherBranch: otherN }));
      }
      var wrong = [];
      me.heroes.forEach(function (h) { h.equipped.forEach(function (s) { if (s.branch && s.branch !== me.branch) wrong.push({ hero: h.name, skill: s.name }); }); });
      if (wrong.length) {
        var total = me.heroes.reduce(function (a, h) { return a + h.equipped.length; }, 0);
        out.push(move('free', 'wrong-branch-skills', 'Hero skills', 95, 'Swap skills made for another branch',
          'Your march is ' + br + ', but ' + plural(wrong.length, 'equipped skill is', 'equipped skills are') + ' for a different branch: ' +
            nameList(wrong.slice(0, 3).map(function (x) { return x.skill + ' on ' + x.hero; })) + '.',
          wrong.length + ' of ' + total + ' skills', { wrong: wrong }));
      }
    }
    var emptyHeroes = me.heroes.filter(function (h) { return h.empty > 0; });
    if (emptyHeroes.length) {
      var n = emptyHeroes.reduce(function (a, h) { return a + h.empty; }, 0);
      out.push(move('free', 'empty-skill-slots', 'Hero skills', 90, 'Fill ' + plural(n, 'empty skill slot'),
        'Open skill slots on ' + nameList(emptyHeroes.map(function (h) { return h.name; })) + '. A filled slot is a free stat boost.',
        n + ' empty skill ' + (n === 1 ? 'slot' : 'slots'), { slots: n, heroes: emptyHeroes.map(function (h) { return h.name; }) }));
    }
    // exclusive skill below the opponent's on the same hero
    var theirEx = {};
    them.heroes.forEach(function (h) { if (h.exclusive != null) theirEx[h.id] = h.exclusive; });
    var behind = me.heroes.filter(function (h) { return h.exclusive != null && theirEx[h.id] != null && h.exclusive < theirEx[h.id]; });
    if (behind.length) {
      out.push(move('upgrade', 'exclusive-skills', 'Hero skills', 65, 'Raise exclusive skill levels',
        behind.map(function (h) { return h.name + ' is at level ' + h.exclusive + ', ' + them.name + "'s is " + theirEx[h.id]; }).join('. ') + '.',
        behind.map(function (h) { return h.name + ' ' + h.exclusive + ' vs ' + theirEx[h.id]; }).join(', '),
        { heroes: behind.map(function (h) { return { hero: h.name, mine: h.exclusive, theirs: theirEx[h.id] }; }) }));
    }
    return out;
  }

  function awakeningMoves(me) {
    var aw = me.heroes.filter(function (h) { return num(h.raw.awakenLevel) > 0 && num(h.raw.awakenLevel) < 40; });
    if (!aw.length) return [];
    var left = aw.reduce(function (a, h) { return a + 40 - num(h.raw.awakenLevel); }, 0);
    return [move('upgrade', 'awakening', 'Hero awakening', 48, 'Keep awakening ' + nameList(aw.map(function (h) { return h.name; })),
      aw.map(function (h) { return h.name + ' is at awakening ' + h.raw.awakenLevel + ' of 40'; }).join('. ') + '.',
      left + ' awakening levels left', { heroes: aw.map(function (h) { return { hero: h.name, level: h.raw.awakenLevel }; }) })];
  }

  function talentMoves(me) {
    var all = [];
    me.heroes.forEach(function (h) { (h.raw.talents || []).forEach(function (t) { all.push(num(t.ttsr)); }); });
    if (!all.length) return [];
    var below = all.filter(function (v) { return v < 10000; });
    if (!below.length) return [];
    var learned = Math.round(100 * all.reduce(function (a, v) { return a + v; }, 0) / (all.length * 10000));
    return [move('upgrade', 'talents', 'Hero talents', 40 + 55 * (1 - learned / 100), 'Learn your hero talents',
      below.length + ' of ' + all.length + ' talents are not fully learned. They are on average ' + learned + '% learned.',
      below.length + ' of ' + all.length + ' talents under 100%', { notMaxed: below.length, total: all.length, learnedPct: learned })];
  }

  // Only legendary (gold) gear takes a rune: in a report a gold piece has equipId % 100 === 4 (suffix 3 is purple, 1-2 lower).
  // Checked on 560 reports: runes sit on suffix-4 pieces only. So runes, rune stars and refining are judged on gold pieces.
  function isGold(e) { return num(e && e.equipId) % 100 === 4; }
  // "A, B and C's" for a list of hero names; the heroes with the biggest number come first
  function possessive(names) { return nameList(names) + "'s"; }
  function topNames(list, key) {   // list of {name, <key>}: worst (largest) first, only those above 0
    return list.filter(function (x) { return x[key] > 0; }).sort(function (a, b) { return b[key] - a[key]; }).map(function (x) { return x.name; });
  }

  function gearMoves(me, them, G) {
    var out = [], heroCount = me.heroes.length;
    if (!heroCount) return out;
    // per hero: gold pieces, pieces that are not gold, empty slots
    var hs = me.heroes.map(function (h) {
      var all = h.raw.heroEquips || [], gold = all.filter(isGold);
      return { name: h.name, gold: gold, nonGold: all.length - gold.length, missing: Math.max(0, 6 - all.length), pieces: all.length };
    });
    var gold = [];
    hs.forEach(function (h) { h.gold.forEach(function (e) { gold.push({ e: e, h: h }); }); });
    hs.forEach(function (h) { h.low = h.gold.filter(function (e) { return num(e.level) < 20; }).length; });
    var low = hs.reduce(function (a, h) { return a + h.low; }, 0);
    var nonGold = hs.reduce(function (a, h) { return a + h.nonGold; }, 0);
    var missing = hs.reduce(function (a, h) { return a + h.missing; }, 0);
    if (low || missing > 0 || nonGold > 0) {
      var parts = [];
      if (low) { parts.push(plural(low, 'gold piece') + ' below level 20'); }
      if (nonGold) { parts.push(plural(nonGold, 'slot') + ' ' + (nonGold === 1 ? 'holds' : 'hold') + " non-gold gear, which can't take a rune") }
      if (missing > 0) parts.push(plural(missing, 'gear slot') + ' empty');
      var who = function (key) { return ' (on ' + nameList(topNames(hs, key)) + ')'; };
      var texts = [];
      if (low) texts.push(plural(low, 'gold piece') + ' below level 20' + who('low'));
      if (nonGold) texts.push(plural(nonGold, 'slot') + ' ' + (nonGold === 1 ? 'holds' : 'hold') + " non-gold gear, which can't take a rune" + who('nonGold'));
      if (missing > 0) texts.push(plural(missing, 'gear slot') + ' empty' + who('missing'));
      out.push(move('upgrade', 'gear-levels', 'Titan gear', 80, 'Finish your Titan gear',
        'Every slot should hold a gold piece, the only gear that takes a rune, and base stats rise with level: ' + texts.join(', ') + '.',
        parts.join(', '), { below20: low, missing: missing, nonGold: nonGold, heroes: topNames(hs.map(function (h) { return { name: h.name, n: h.low + h.nonGold + h.missing }; }), 'n') }));
    }
    // runes (gold pieces only)
    var runes = [], noRune = 0;
    hs.forEach(function (h) { h.noRune = 0; h.runes = []; });
    gold.forEach(function (x) {
      var r = null;
      (x.e.infos || []).forEach(function (i) { if (i.type === 2 && G.resolveRune) { var y = G.resolveRune(i.templateId); if (y) r = y; } });
      if (r) { runes.push(r); x.h.runes.push(r); } else { noRune++; x.h.noRune++; }
    });
    if (gold.length && noRune > 0) {
      var rn = topNames(hs, 'noRune');
      out.push(move('upgrade', 'runes-empty', 'Titan gear runes', 85, 'Put runes on your gear',
        noRune + ' of ' + gold.length + ' gold gear pieces have no rune (on ' + nameList(rn) + '). A rune adds a percentage to the gear effect it boosts.',
        (gold.length - noRune) + ' of ' + gold.length + ' gold pieces hold a rune', { empty: noRune, pieces: gold.length, heroes: rn }));
    }
    var belowMax = runes.filter(function (r) { return r.s < r.sm; });
    if (belowMax.length) {
      var groups = {};
      belowMax.forEach(function (r) {
        var k = r.n + '|' + r.s + '|' + r.sm;
        (groups[k] = groups[k] || { name: r.n, star: r.s, starMax: r.sm, count: 0 }).count++;
      });
      var weakest = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
        return (a.star / a.starMax) - (b.star / b.starMax) || b.count - a.count;
      })[0];
      var starsNow = runes.reduce(function (a, r) { return a + r.s; }, 0), starsMax = runes.reduce(function (a, r) { return a + r.sm; }, 0);
      var eff = RUNE_EFFECT[weakest.name];
      var effText = eff && weakest.starMax === 6 ? ' Its effect goes from ' + eff[weakest.star] + '% at star ' + weakest.star + ' to ' + eff[6] + '% at star 6.' : '';
      var wh = hs.map(function (h) {
        return { name: h.name, n: h.runes.filter(function (r) { return r.n === weakest.name && r.s === weakest.star && r.sm === weakest.starMax; }).length };
      });
      var wn = topNames(wh, 'n');
      out.push(move('upgrade', 'runes-stars', 'Titan gear runes', 70 - 20 * (starsNow / starsMax),
        'Raise your ' + weakest.name + ' ' + (weakest.count === 1 ? 'rune' : 'runes'),
        plural(weakest.count, 'rune') + ' ' + (weakest.count === 1 ? 'is' : 'are') + ' at ' + weakest.star + ' of ' + weakest.starMax + ' stars (on ' + nameList(wn) + ').' + effText +
          ' Overall ' + starsNow + ' of ' + starsMax + ' rune stars are filled.',
        weakest.count + ' ' + weakest.name + (weakest.count === 1 ? ' rune' : ' runes') + ' at ' + weakest.star + ' of ' + weakest.starMax + ' stars',
        { weakest: weakest, starsNow: starsNow, starsMax: starsMax, runesBelowMax: belowMax.length, heroes: wn }));
    }
    // refinement: every random stat of a gold piece should reach 70% of its roll maximum
    var stats = 0, under = 0, rollSum = 0;
    hs.forEach(function (h) { h.under = 0; h.stats = 0; });
    gold.forEach(function (x) {
      (x.e.infos || []).forEach(function (i) {
        if (i.type !== 1 || !G.GEAR_TEMPLATE) return;
        var t = G.GEAR_TEMPLATE[i.templateId];
        if (!t) return;
        var pct = num(i.buffValue) / t.m * 100;
        stats++; rollSum += pct; x.h.stats++;
        if (pct < 70) { under++; x.h.under++; }
      });
    });
    if (stats && (under >= 3 || under / stats >= 0.15)) {
      var un = hs.filter(function (h) { return h.under > 0; }).sort(function (a, b) { return b.under - a.under || (b.under / b.stats) - (a.under / a.stats); })
        .map(function (h) { return h.name; });
      out.push(move('upgrade', 'gear-refine', 'Titan gear', 30 + 40 * (under / stats), 'Refine the weak gear stats',
        'On ' + possessive(un) + ' gold gear, ' + under + ' of ' + stats + ' random stats are under 70% of their maximum roll. Raise each stat to at least 70%.',
        under + ' of ' + stats + ' gold gear stats under 70%', { under70: under, stats: stats, meanRollPct: Math.round(rollSum / stats), heroes: un }));
    }
    return out;
  }

  function fieldBeasts(player) {
    var res = {};
    var f = (player.enigmas && player.enigmas.fields) || [];
    f.forEach(function (fl) {
      res[fl.cfg] = (fl.slots || []).filter(function (s) { return s.beastId && String(s.beastId) !== '0'; }).length;
    });
    return res;
  }
  // Beast fields 4 and 5 open by the total level of all beast field slots (game table enigma_field.unlock_condition):
  // Defense at 40, Offense at 150. It splits every player in a 23-report study. Fields 1-3 are gated by something a
  // report does not show. A field with no beasts is missing from the report whether it is locked or not.
  var FIELD_UNLOCK_AT = { 4: 40, 5: 150 };
  function totalFieldLevels(player) {
    var t = 0;
    ((player.enigmas && player.enigmas.fields) || []).forEach(function (f) {
      (f.slots || []).forEach(function (s) { t += num(s.level); });
    });
    return t;
  }
  function enigmaMoves(me, them, tables, G) {
    var out = [];
    if (!me.player.enigmas) return out;
    var mine = fieldBeasts(me.player), theirs = fieldBeasts(them.player);
    var names = G.EB_FIELD_NAMES || {};
    var have = totalFieldLevels(me.player), lockedByLevels = false;
    Object.keys(theirs).map(Number).sort(function (a, b) { return b - a; }).forEach(function (cfg) {
      if (theirs[cfg] > 0 && !(mine[cfg] > 0)) {
        var fname = names[cfg] || ('field ' + cfg), need = FIELD_UNLOCK_AT[cfg];
        if (need && have < need) {
          lockedByLevels = true;
          out.push(move('upgrade', 'beast-field-' + cfg, 'Beast fields', 60, 'Unlock your ' + fname + ' field',
            'Your ' + fname + ' field opens at ' + need + ' total beast field levels. You have ' + have + ', so ' + (need - have) +
              ' more levels open it. ' + them.name + ' has ' + theirs[cfg] + ' beasts there. The early levels cost the fewest Field Repeaters.',
            have + ' of ' + need + ' field levels', { field: cfg, fieldName: fname, theirs: theirs[cfg], locked: true, have: have, need: need }));
        } else if (need) {
          // Open, but every slot takes an Epic or better beast of a set type and element (data/enigma-platforms.json),
          // and a report doesn't show spare beasts, so this is not a sure free move. The armory checks the bench.
          out.push(move('upgrade', 'beast-field-' + cfg, 'Beast fields', 62, 'Fill your ' + fname + ' field',
            'You have ' + have + ' field levels, past the ' + need + ' it needs to open, but no beasts in it. Each of its slots takes an Epic or better beast of a set type and element. ' +
              them.name + ' has ' + theirs[cfg] + ' there.',
            '0 beasts, against ' + theirs[cfg], { field: cfg, fieldName: fname, theirs: theirs[cfg], locked: false, have: have, need: need }));
        } else {
          out.push(move('upgrade', 'beast-field-' + cfg, 'Beast fields', 58, 'Unlock and fill your ' + fname + ' field',
            'No beasts in your ' + fname + ' field, and the report cannot show whether it is unlocked. ' + them.name + ' has ' + theirs[cfg] + ' there.',
            '0 beasts, against ' + theirs[cfg], { field: cfg, fieldName: fname, theirs: theirs[cfg], unlocked: false }));
        }
      }
    });
    var enh = (tables.enhance && tables.enhance.platforms) || {};
    var shared = {};
    ((me.player.enigmas && me.player.enigmas.fields) || []).forEach(function (f) { shared[f.cfg] = 1; });
    ((them.player.enigmas && them.player.enigmas.fields) || []).forEach(function (f) { shared[f.cfg] = (shared[f.cfg] || 0) + 1; });
    function slotStats(player) {
      var lv = 0, cap = 0;
      ((player.enigmas && player.enigmas.fields) || []).forEach(function (f) {
        if (shared[f.cfg] !== 2) return; // same basis: only fields both sides have
        (f.slots || []).forEach(function (s) {
          var plat = enh[s.id];
          lv += num(s.level);
          cap += plat && plat.maxLevel ? plat.maxLevel : (f.cfg <= 3 ? 20 : 40);
        });
      });
      return { lv: lv, cap: cap };
    }
    var m = slotStats(me.player), t = slotStats(them.player);
    if (!lockedByLevels && m.cap > 0 && t.cap > 0) {
      var mp = Math.round(100 * m.lv / m.cap), tp = Math.round(100 * t.lv / t.cap);
      if (mp < 40 && (tp === null || mp < tp || mp < 25)) {
        out.push(move('upgrade', 'beast-field-levels', 'Beast fields', 55, 'Raise your beast field levels',
          'Your field slots are at ' + mp + '% of their level cap' + (tp !== null ? ', ' + them.name + "'s are at " + tp + '%' : '') +
            ' on the fields you both have. The early levels cost the fewest Field Repeaters.',
          m.lv + ' of ' + m.cap + ' levels' + (tp !== null ? ', against ' + t.lv + ' of ' + t.cap : ''), { levels: m.lv, cap: m.cap, theirs: t.lv, theirCap: t.cap }));
      }
    }
    var beasts = (me.player.enigmas && me.player.enigmas.beastDatas) || [];
    if (beasts.length) {
      var lowStar = beasts.filter(function (x) { return x.star < 5; }).length;
      var pot = Math.round(beasts.reduce(function (a, x) { return a + num(x.potential); }, 0) / beasts.length / 160);
      if (lowStar >= 3 || pot < 85) {
        var tb = (them.player.enigmas && them.player.enigmas.beastDatas) || [];
        var tpot = tb.length ? Math.round(tb.reduce(function (a, x) { return a + num(x.potential); }, 0) / tb.length / 160) : null;
        out.push(move('upgrade', 'beast-stars', 'Beast fields', 50, 'Raise beast stars and potential',
          lowStar + ' of ' + beasts.length + ' beasts are below 5 stars, and their potential averages ' + pot + '%' + (tpot !== null ? ' (' + them.name + ': ' + tpot + '%)' : '') + '.',
          lowStar + ' of ' + beasts.length + ' beasts under 5 stars', { below5: lowStar, beasts: beasts.length, potentialPct: pot, theirPotentialPct: tpot }));
      }
    }
    return out;
  }

  function collectibleMoves(me, tables) {
    var c = me.player.CTCs, th = tables.collectibles && tables.collectibles.themes;
    if (!c || !th) return [];
    var have = {};
    (c.collects || []).forEach(function (x) { have[x.id] = x.lv; });
    var out = [];
    th.forEach(function (t) {
      var miss = t.items.filter(function (i) { return !have[i.id]; });
      if (miss.length === 1) {
        out.push(move('upgrade', 'collectible-theme', 'Collections', 62, 'Finish the "' + t.label + '" collection',
          'You are one item short: ' + miss[0].label + '. Completing the set gives +' + t.complete_buff.percent + '% ' + t.complete_buff.name + '.',
          '1 item missing', { theme: t.label, missing: miss[0].label, buff: t.complete_buff.name, percent: t.complete_buff.percent }));
      }
    });
    return out;
  }

  function formationMoves(me, tables) {
    var out = [], f = me.player.formationV2;
    if (!f || !f.id || !tables.formation) return out;
    var sc = tables.formation.sciences;
    if (sc && f.sciences) {
      var cur = 0, max = 0;
      Object.keys(sc).forEach(function (k) { cur += num(f.sciences[k]); max += sc[k].max_level; });
      var pct = max ? Math.round(100 * cur / max) : 100;
      if (max && pct < 70) {
        out.push(move('upgrade', 'formation-sciences', 'Formation', 45, 'Raise your formation sciences',
          'Your formation sciences are at ' + pct + '% of their maximum.', cur + ' of ' + max + ' science levels', { levels: cur, max: max, pct: pct }));
      }
    }
    return out;
  }

  function masteryMoves(me, them, tables) {
    var am = me.player.armyMastery, rows = tables.formation && tables.formation.army_mastery && tables.formation.army_mastery.levels;
    if (!am || !rows || !me.branch) return [];
    var code = MASTERY_CODE[me.branch];
    if (am[code] == null || !rows[code]) return [];
    // the last table row is a placeholder with no buffs (cost 9999), so the real cap is the last row that has buffs
    var real = rows[code].filter(function (r) { return r.buffs && r.buffs.length; });
    var lvl = am[code] - code, max = real.length ? real[real.length - 1].level : rows[code].length;
    if (lvl >= max) return [];
    var tl = them.player.armyMastery && them.player.armyMastery[code] != null ? them.player.armyMastery[code] - code : null;
    if (lvl >= max - 1 && (tl === null || tl <= lvl)) return [];
    return [move('upgrade', 'army-mastery', 'Army mastery', 40, 'Raise ' + BRANCH_LABEL[me.branch] + ' army mastery',
      BRANCH_LABEL[me.branch] + ' mastery is at level ' + lvl + ' of ' + max + (tl !== null ? ', against ' + tl + ' for ' + them.name : '') + '.',
      'level ' + lvl + ' of ' + max, { level: lvl, max: max, theirs: tl })];
  }

  function longMoves(me, them, gaps, tables) {
    var gapPts = {};
    gaps.all.forEach(function (g) { gapPts[g.area] = g.theirs - g.mine; });
    var cands = [];
    var ms = ((me.player.effectSkins || {}).effectIds || []).length, ts = ((them.player.effectSkins || {}).effectIds || []).length;
    var mx = ((me.player.effectSkins || {}).exhibitions || []).length, tx = ((them.player.effectSkins || {}).exhibitions || []).length;
    if (me.player.effectSkins && ts > ms) {
      cands.push(move('long', 'base-skins', 'Base skins', gapPts['base-skins'] || 0, 'Collect more base skins',
        plural(ms, 'base skin') + ' give you an ownership bonus (' + plural(mx, 'skin exhibition') + '). ' + them.name + ' has ' + ts + ' (' + tx + ' exhibitions). Skins are a long collection goal.',
        ms + ' skins, against ' + ts, { mine: ms, theirs: ts, exhibitions: mx, theirExhibitions: tx }));
    }
    var mc = ((me.player.effectSkins || {}).ownCastleEffects || []).length, tc = ((them.player.effectSkins || {}).ownCastleEffects || []).length;
    if (me.player.effectSkins && tc > mc) {
      cands.push(move('long', 'castle-effects', 'Castle effects', gapPts.castle || 0, 'Collect more castle effects',
        'You own ' + mc + ' castle effects. ' + them.name + ' owns ' + tc + '.', mc + ' castle effects, against ' + tc, { mine: mc, theirs: tc }));
    }
    var total = (tables.decorLookups && tables.decorLookups.DECOR_SUITS && Object.keys(tables.decorLookups.DECOR_SUITS).length) || 23;
    var md = ((me.player.effectDecorations || {}).suit || []).length, td = ((them.player.effectDecorations || {}).suit || []).length;
    if (me.player.effectDecorations && md < total && td > md) {
      cands.push(move('long', 'decoration-suits', 'Decorations', gapPts.decor || 0, 'Complete decoration suits',
        md + ' of ' + total + ' decoration suits are active. ' + them.name + ' has ' + td + '.', md + ' of ' + total + ' suits', { mine: md, theirs: td, total: total }));
    }
    return cands;
  }

  // the stats behind one area: [{key, label, unit, mine, theirs}], non-zero for either side, biggest gap first (March size, a troop
  // count, comes last). Percent values have one decimal; the four core stats add up to the area's mine / theirs.
  function statRows(mine, theirs) {
    mine = mine || {}; theirs = theirs || {};
    var rows = [];
    STAT_INFO.forEach(function (f) {
      var m = num(mine[f[0]]), t = num(theirs[f[0]]);
      if (Math.abs(m) < 0.05 && Math.abs(t) < 0.05 && (f[2] === '%' || (!m && !t))) return;
      rows.push({ key: f[0], label: f[1], unit: f[2], mine: Math.round(m * 10) / 10, theirs: Math.round(t * 10) / 10 });
    });
    return rows.sort(function (x, y) {
      if ((x.unit === 'troops') !== (y.unit === 'troops')) return x.unit === 'troops' ? 1 : -1;
      return Math.abs(y.theirs - y.mine) - Math.abs(x.theirs - x.mine);
    });
  }

  // ---- gaps -------------------------------------------------------------------------------------------------------
  function buildGaps(me, them, sameHeroes, tables) {
    var group = tables.buffGroup;
    if (!group || !(me.player.traceEffectBuffs || []).length || !(them.player.traceEffectBuffs || []).length) return { shown: [], all: [] };
    var a = sourcePoints(me.player, me.weights, sameHeroes, group), b = sourcePoints(them.player, them.weights, sameHeroes, group);
    var ids = {};
    Object.keys(a.byArea).concat(Object.keys(b.byArea)).forEach(function (k) { ids[k] = 1; });
    var all = Object.keys(ids).map(function (k) {
      var x = a.byArea[k] || { pts: 0 }, y = b.byArea[k] || { pts: 0 }, label = (a.byArea[k] || b.byArea[k]).label;
      return { area: k, label: label, mine: Math.round(x.pts), theirs: Math.round(y.pts), _gap: y.pts - x.pts, stats: statRows(x.stats, y.stats) };
    });
    var behind = all.filter(function (g) { return g._gap > 0; });
    // share of the total behind: the sum of the areas where this side trails (areas where it leads are not netted off)
    var denom = behind.reduce(function (s, g) { return s + g._gap; }, 0);
    all.forEach(function (g) { g.share = denom > 0 ? Math.round(100 * g._gap / denom) / 100 : 0; });
    var shown = behind.filter(function (g) { return g.share >= 0.05 && g._gap >= 200; })
      .sort(function (x, y) { return y._gap - x._gap; }).slice(0, 4)
      .map(function (g) { return { area: g.area, label: g.label, mine: g.mine, theirs: g.theirs, share: g.share, stats: g.stats }; });
    return { shown: shown, all: all };
  }

  // ---- picking and ordering the moves -----------------------------------------------------------------------------
  function pick(cands) {
    function top(tier, n) {
      return cands.filter(function (m) { return m.tier === tier; }).sort(function (x, y) { return y._score - x._score; }).slice(0, n);
    }
    var free = top('free', MAX_FREE), long = top('long', MAX_LONG);
    var upgrades = top('upgrade', MAX_MOVES - free.length - long.length);
    return free.concat(upgrades, long).map(function (m) {
      delete m._score;
      return m;
    });
  }

  function sideResult(me, them, won, tables, G, sameHeroes) {
    var errors = [], cands = [];
    var gaps = { shown: [], all: [] };
    function run(label, fn) {
      try { var r = fn(); if (r) cands = cands.concat(r); } catch (e) { errors.push(label + ': ' + (e && e.message || e)); }
    }
    try { gaps = buildGaps(me, them, sameHeroes, tables); } catch (e) { errors.push('gaps: ' + (e && e.message || e)); }
    run('skills', function () { return skillMoves(me, them); });
    run('talents', function () { return talentMoves(me); });
    run('awakening', function () { return awakeningMoves(me); });
    run('gear', function () { return gearMoves(me, them, G); });
    run('enigma', function () { return enigmaMoves(me, them, tables, G); });
    run('collectibles', function () { return collectibleMoves(me, tables); });
    run('formation', function () { return formationMoves(me, tables); });
    run('mastery', function () { return masteryMoves(me, them, tables); });
    run('long', function () { return longMoves(me, them, gaps, tables); });
    return {
      name: me.name, won: won, cp: me.cp, troops: me.troops,
      heroes: me.heroes.map(function (h) { return h.name; }),
      gaps: gaps.shown, moves: pick(cands), errors: errors
    };
  }

  function lastTl(battle) {
    var tl = 0;
    (battle.process || []).forEach(function (e) { if (e && e.tl > tl) tl = e.tl; });
    return tl;
  }

  function analyze(report, tables) {
    tables = tables || {};
    var G = tables.game || (typeof window !== 'undefined' && window.TWGameData) ||
      (typeof require === 'function' ? require('./tw-game-data.js') : {});
    var b = report.battle;
    var att = readSide(report, 'attacker', tables, G), def = readSide(report, 'defender', tables, G);
    var winner = b.result === 1 ? 'attacker' : 'defender';
    var W = winner === 'attacker' ? att : def, L = winner === 'attacker' ? def : att;
    var closeness = null;
    var multi = (b.fightMarches || []).length !== 1 || (b.attacker.players || []).length > 1 || (b.defender.players || []).length > 1;
    if (!multi && W.maxPower > 0) {
      var prog = Math.min(0.99, L.hurt / (KILL_FACTOR * W.maxPower));
      closeness = { loserProgress: Math.round(prog * 1000) / 1000, label: prog >= CLOSE_AT ? 'close' : (prog < OUT_OF_REACH_BELOW ? 'out-of-reach' : 'clear') };
    }
    var tl = lastTl(b);
    var ids = function (s) { return s.heroes.map(function (h) { return h.id; }).sort().join(','); };
    var same = att.heroes.length > 0 && ids(att) === ids(def);
    return {
      fight: { rounds: tl < 1800 ? 0 : Math.round((tl - 600) / 1200), winner: winner, closeness: closeness },
      sides: {
        attacker: sideResult(att, def, winner === 'attacker', tables, G, same),
        defender: sideResult(def, att, winner === 'defender', tables, G, same)
      }
    };
  }

  // ---- Snapshot enrichment ----------------------------------------------------------------------------------------
  // withSnapshot(side, snap, tables) -> a copy of one side whose moves may carry `extra` (one short sentence about what the player
  // holds) and `extraNames` (the hero names in it, for the caller to mark translate="no"). `analyze` is not touched and a move
  // that the snapshot says nothing about is copied as it is. snap = the supplements the armory already holds, all optional:
  //   inv      Snapshot inventory ({tabs:{item:[{id,a}]}})        enigma  {fields:[{holes:[{hid,lv,beastId}]}], beasts:[{id}], beast2field}
  //   bench    bench beasts ({kept, beasts})                      heroes  {list:[{id, p1:{x,b}, p2:{x,b}}]} (skill slots by preset)
  //   runeBag  {family name: loose runes in the bag}, worked out by the caller from inv + the item table
  // tables: heroes (names), enhance (data/enigma-platform-enhance.json) as for analyze, platforms (data/enigma-platforms.json, the slot rules).
  // snap.decode(cfgId) -> {type, faction, quality} is the game-data decoder, for beasts that carry no attributes of their own.
  // A move about filling an OPEN field turns Free only when the spare beasts fill every slot; a locked field never changes tier.
  var REPEATER_ID = 47007002, UNIVERSAL_SHARD_ID = 20213232;
  var PROTECTION = { army: [21120, 20120], navy: [21121, 20121], af: [21122, 20122] };
  function bagCount(inv, id) {
    var list = inv && inv.tabs && inv.tabs.item;
    if (!Array.isArray(list)) return null;
    var n = 0;
    list.forEach(function (it) { if (it && num(it.id) === id) n += num(it.a); });
    return n;
  }
  // The beasts not deployed, each with the quality / type / faction the slot rules read: the beast's own q, type, fac,
  // else the bench entry of the same id, else snap.decode(cfgId) (the game-data decoder). A beast whose attributes are unknown is left out.
  function spareBeasts(snap) {
    var e = snap.enigma, bench = {};
    ((snap.bench && snap.bench.beasts) || []).forEach(function (b) { if (b && b.id != null) bench[b.id] = b; });
    function attrs(b) {
      var o = bench[b.id] || {}, dc = null;
      function pick(k, alt) { return b[k] != null ? num(b[k]) : (o[k] != null ? num(o[k]) : null); }
      var q = pick('q'), t = pick('type'), f = pick('fac');
      if ((q === null || t === null || f === null) && typeof snap.decode === 'function' && b.cfgId != null) {
        try { dc = snap.decode(b.cfgId); } catch (err) { dc = null; }
        if (dc) { if (q === null && dc.quality != null) q = num(dc.quality); if (t === null && dc.type != null) t = num(dc.type); if (f === null && dc.faction != null) f = num(dc.faction); }
      }
      return { q: q, type: t, fac: f };
    }
    var list = null;
    if (e && Array.isArray(e.beasts)) {
      var used = {};
      Object.keys(e.beast2field || {}).forEach(function (k) { used[k] = 1; });
      (e.fields || []).forEach(function (f) { (f.holes || []).forEach(function (h) { if (h && h.beastId) used[h.beastId] = 1; }); });
      list = e.beasts.filter(function (b) { return b && !used[b.id]; });
    } else if (snap.bench && Array.isArray(snap.bench.beasts)) list = snap.bench.beasts.filter(function (b) { return b; });
    if (!list) return null;
    return list.map(attrs);
  }
  // how many of a field's slots the spare beasts can fill (a largest matching, slots against beasts)
  function slotsFilled(field, spare, platforms) {
    var holes = ((platforms && platforms.holes) || []).filter(function (h) { return h.fieldType === field; });
    if (!holes.length) return null;
    function fits(h, b) {
      return b.q !== null && b.type !== null && b.fac !== null && b.q >= num(h.minQuality) && (!h.faction || h.faction === b.fac) &&
        (!(h.beastTypeIds && h.beastTypeIds.length) || h.beastTypeIds.indexOf(b.type) >= 0);
    }
    var owner = {};
    function place(hi, seen) {
      for (var bi = 0; bi < spare.length; bi++) {
        if (seen[bi] || !fits(holes[hi], spare[bi])) continue;
        seen[bi] = 1;
        if (owner[bi] === undefined || place(owner[bi], seen)) { owner[bi] = hi; return true; }
      }
      return false;
    }
    var n = 0;
    for (var hi = 0; hi < holes.length; hi++) if (place(hi, {})) n++;
    return { filled: n, slots: holes.length, used: Object.keys(owner).map(Number) };
  }
  // levels the repeaters buy: always the cheapest next level of any slot first
  function repeaterLevels(enigma, enhance, have) {
    var plats = enhance && enhance.platforms;
    if (!plats || !enigma || !Array.isArray(enigma.fields)) return null;
    var heads = [];
    enigma.fields.forEach(function (f) {
      (f.holes || []).forEach(function (h) {
        var pl = plats[h.hid];
        if (pl && Array.isArray(pl.levels)) heads.push({ lv: num(h.lv), levels: pl.levels, max: num(pl.maxLevel) || pl.levels.length });
      });
    });
    if (!heads.length) return null;
    function cost(x) {
      if (x.lv >= x.max) return Infinity;
      var row = x.levels[x.lv];
      return row && row.cost ? num(row.cost.count) : Infinity;
    }
    var left = have, n = 0, guard = 0;
    for (;;) {
      var best = null, bc = Infinity;
      heads.forEach(function (x) { var c = cost(x); if (c < bc) { bc = c; best = x; } });
      if (!best || bc > left || ++guard > 5000) return { levels: n, next: bc === Infinity ? null : bc };
      left -= bc; n++; best.lv++;
    }
  }
  function heroNameOf(tables, id) {
    var list = (tables && tables.heroes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].heroId === id) return list[i].displayName || list[i].name || null;
    return null;
  }
  function protectionExtra(mv, snap, tables) {
    var ids = PROTECTION[mv.data && mv.data.branch];
    var list = snap.heroes && snap.heroes.list;
    if (!ids || !Array.isArray(list)) return null;
    var found = [];
    list.forEach(function (h) {
      [['p1', 'first'], ['p2', 'second']].forEach(function (pp) {
        var slots = (h[pp[0]] && ((h[pp[0]].x || []).concat(h[pp[0]].b || []))) || [];
        var hit = slots.filter(function (s) { return s && (num(s.id) === ids[0] || num(s.id) === ids[1]); })[0];
        var nm = heroNameOf(tables, h.id);
        if (hit && nm) found.push({ name: nm, preset: pp[1], low: num(hit.id) === ids[1] });
      });
    });
    if (!found.length) return null;
    found.sort(function (a, b) { return (a.low ? 1 : 0) - (b.low ? 1 : 0); });
    var top = found.slice(0, 2), names = top.map(function (f) { return f.name; });
    var parts = top.map(function (f) { return f.name + "'s " + f.preset + ' preset'; });
    var low = top.every(function (f) { return f.low; });
    var text = found.length === 1 ? (low ? 'A lower quality copy is on ' : 'One copy is on ') + parts[0] + '.'
      : (low ? 'Lower quality copies are on ' : found.length + ' copies are on ') + parts.join(' and ') + (found.length > 2 ? ' and ' + (found.length - 2) + ' more' : '') + '.';
    return { text: text, names: names };
  }
  function extraFor(mv, snap, tables, ctx) {
    var d = mv.data || {}, n;
    if (mv.id === 'protection') return protectionExtra(mv, snap, tables);
    if (/^beast-field-\d+$/.test(mv.id) && d.field != null && d.locked === false) {   // only a move about filling a field that is open
      if (ctx.spare === undefined) ctx.spare = spareBeasts(snap);
      // beasts a field already filled are taken, so two open fields can't both be filled with the same spares
      var spare = ctx.spare ? ctx.spare.filter(function (b) { return !b.taken; }) : null;
      var fit = spare ? slotsFilled(d.field, spare, tables && tables.platforms) : null;
      if (!fit) return null;
      var all = fit.filled === fit.slots;
      if (all) fit.used.forEach(function (i) { spare[i].taken = true; });
      return { text: all ? 'Your spare beasts fill all ' + fit.slots + ' of its slots.' : fit.filled > 0 ? 'Your spare beasts fit ' + fit.filled + ' of its ' + fit.slots + ' slots.' : 'Your spare beasts fit none of its ' + fit.slots + ' slots.',
        tier: all ? 'free' : null };
    }
    if (mv.id === 'runes-stars' && d.weakest && snap.runeBag && typeof snap.runeBag === 'object') {
      n = num(snap.runeBag[d.weakest.name]);
      return { text: n > 0 ? 'You have ' + n + ' ' + d.weakest.name + (n === 1 ? ' rune' : ' runes') + ' in the bag.' : 'You have no ' + d.weakest.name + ' runes in the bag.' };
    }
    if (mv.id === 'beast-field-levels') {
      n = bagCount(snap.inv, REPEATER_ID);
      if (n === null) return null;
      var r = repeaterLevels(snap.enigma, tables && tables.enhance, n);
      if (!r) return null;
      if (r.levels > 0) return { text: plural(n, 'repeater') + ': enough for about ' + plural(r.levels, 'level') + '.' };
      return { text: 'You have ' + plural(n, 'repeater') + (r.next ? '. The cheapest next level costs ' + r.next + '.' : '.') };
    }
    if (mv.id === 'decoration-suits') {
      n = bagCount(snap.inv, UNIVERSAL_SHARD_ID);
      if (n === null) return null;
      return { text: 'You have ' + plural(n, 'universal decor shard') + ' in the bag.' };
    }
    return null;
  }
  function withSnapshot(side, snap, tables) {
    var out = {};
    Object.keys(side || {}).forEach(function (k) { out[k] = side[k]; });
    var ctx = {};
    out.moves = ((side && side.moves) || []).map(function (mv) {
      var copy = {};
      Object.keys(mv).forEach(function (k) { copy[k] = mv[k]; });
      var x = null;
      try { x = snap && typeof snap === 'object' ? extraFor(mv, snap, tables || {}, ctx) : null; } catch (e) { x = null; }
      if (x && x.text) { copy.extra = x.text; copy.extraNames = x.names || []; if (x.tier) copy.tier = x.tier; }
      return copy;
    });
    return out;
  }

  var api = { analyze: analyze, withSnapshot: withSnapshot, armyType: armyType, KILL_FACTOR: KILL_FACTOR };
  if (typeof window !== 'undefined') window.ReportCoach = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
