/* armory-core.js: pure logic for the Armory (v2 and later). Depends only on tw-game-data.js.
 *
 * Section 1 is copied VERBATIM from pages/armory-report.html (origin/main c8e695d) and proven identical by
 * test/armory-core.parity.test.js. Section 2 is the small set of seams (setters for data the page loads lazily)
 * and the synchronous decor ranking. Section 3 is the new Next moves engine (test/next-moves.test.js).
 * No DOM, no fetch, no storage, no globals beyond window.ArmoryCore (or module.exports in node). v1 is frozen and
 * keeps its inline copies; a fix to a function here must go to the page first (or the parity test fails).
 */
(function (window) {
  var G = (typeof module === 'object' && module.exports) ? require('./tw-game-data.js') : window.TWGameData;
  var ADVISOR_STAT_BUFFS = G.ADVISOR_STAT_BUFFS,
      ADVISOR_UNIVERSAL_SHARD_ID = G.ADVISOR_UNIVERSAL_SHARD_ID,
      BO_ATKHP_MAP = G.BO_ATKHP_MAP,
      BO_ENHANCE_BUFF_CLASS = G.BO_ENHANCE_BUFF_CLASS,
      BO_RARITY_BUFF_TABLE = G.BO_RARITY_BUFF_TABLE,
      BO_RARITY_DEFAULT_WEIGHTS = G.BO_RARITY_DEFAULT_WEIGHTS,
      BO_SCOPE_MULT = G.BO_SCOPE_MULT,
      BO_STAT_WEIGHTS = G.BO_STAT_WEIGHTS,
      BO_TG_REFINEMENT_LINK = G.BO_TG_REFINEMENT_LINK,
      EB_ELEMENTS = G.EB_ELEMENTS,
      EB_FIELD_NAMES = G.EB_FIELD_NAMES,
      EB_FIELD_SLOT_COUNTS = G.EB_FIELD_SLOT_COUNTS,
      GEAR_SLOT_NAMES = G.GEAR_SLOT_NAMES,
      GEAR_TEMPLATE = G.GEAR_TEMPLATE,
      HERO_TYPE_MAP = G.HERO_TYPE_MAP,
      HERO_TYPE_NAMES = G.HERO_TYPE_NAMES,
      MS_BAG_ITEM_ID = G.MS_BAG_ITEM_ID,
      MS_CHEST_PREMIUM = G.MS_CHEST_PREMIUM,
      MS_CHEST_RARE = G.MS_CHEST_RARE,
      MS_MAX_LEVEL = G.MS_MAX_LEVEL,
      MS_SKILL_ID = G.MS_SKILL_ID,
      boGearTemplateClassify = G.boGearTemplateClassify,
      boMaxLevelFor = G.boMaxLevelFor,
      boMaxStarFor = G.boMaxStarFor,
      ebBeastName = G.ebBeastName,
      ebBuffName = G.ebBuffName,
      ebComputeBuffValue = G.ebComputeBuffValue,
      ebDecodeCfg = G.ebDecodeCfg,
      ebMaxPotential = G.ebMaxPotential,
      resolveRune = G.resolveRune;

  /* One instance per player view: every piece of state below (decor/platform lookups, hero cache, TG overrides,
     identity) lives in this closure, so two players rendered in one session cannot share it. */
  function create() {
  /* ---- copied verbatim from pages/armory-report.html (c8e695d) ---- */
  function _ar_extractRunePool(inv, gear, lookups) {
    var pool = {};
    var bagCounts = {};
    var gearCounts = {};
    function bumpPool(name, star, qty) {
      if (!name || qty <= 0) return;
      if (!pool[name]) pool[name] = {0:0,1:0,2:0,3:0,4:0,5:0,6:0};
      pool[name][star] = (pool[name][star] || 0) + qty;
    }
    if (inv && inv.tabs && Array.isArray(inv.tabs.item) && lookups && lookups.item) {
      for (var i = 0; i < inv.tabs.item.length; i++) {
        var it = inv.tabs.item[i];
        var cfg = lookups.item[String(it.id)];
        if (!cfg || cfg.t !== 153) continue;
        var name = String(cfg.n || '').replace(/\s*Rune(\s+Shard)?\s*$/i, '').trim();
        if (!name) continue;
        var qty = it.a || 1;
        bumpPool(name, 0, qty);
        bagCounts[name] = (bagCounts[name] || 0) + qty;
      }
    }
    if (gear && Array.isArray(gear.goldGear)) {
      for (var j = 0; j < gear.goldGear.length; j++) {
        var p = gear.goldGear[j];
        if (p && p.heroId && p.heroId > 0) continue; // equipped, skip
        var rune = ((p && p.buffs) || []).find(function(b) { return b && b.type === 'rune'; });
        if (!rune) continue;
        var rname = rune.name;
        var rstar = (rune.star != null) ? rune.star : 0;
        if (!rname && rune.templateId != null && typeof resolveRune === 'function') {
          var rr = resolveRune(+rune.templateId);
          if (rr) { rname = rr.n; if (rune.star == null) rstar = rr.s; }
        }
        if (!rname) continue;
        bumpPool(rname, rstar, 1);
        gearCounts[rname] = (gearCounts[rname] || 0) + 1;
      }
    }
    return { pool: pool, bagCounts: bagCounts, gearCounts: gearCounts };
  }

  var DECOR_ID_TO_GROUP = {};

  var DECOR_GROUP_BASE = {};

  var DECOR_EXTRACTED_LVL = {};

  var BUFF_NAMES_DECOR = {};

  var MAX_LEVEL = {};

  var LV_BY_ID = {};

  var DECOR_BASE_TO_GROUP = {};

  function decorIdToGroup(id) {
    var direct = DECOR_ID_TO_GROUP[String(id)];
    if (direct) return direct;
    for (var off = 0; off < 15; off++) {
      var candidate = id - off;
      if (DECOR_BASE_TO_GROUP[candidate]) return DECOR_BASE_TO_GROUP[candidate];
    }
    return null;
  }

  var EB_PLATFORM_REQS = null;

  var EB_HOLE_TO_ORDER = null;

  function ebPlatformReq(fieldId, slotOrder) {
    if (!EB_PLATFORM_REQS) return null;
    var f = EB_PLATFORM_REQS[fieldId];
    return f ? (f[slotOrder] || null) : null;
  }

  function ebHoleOrder(holeId) {
    if (!EB_HOLE_TO_ORDER) return null;
    var n = Number(holeId);
    return EB_HOLE_TO_ORDER[n] || null;
  }

  function ebResolveBeasts(enigmas) {
    if (!enigmas || !enigmas.beastDatas) return { beasts: [], fields: [] };
    var beastMap = {};
    var beasts = enigmas.beastDatas.map(function(b) {
      var info = ebDecodeCfg(b.cfg);
      var resolved = {
        id: b.id, cfg: b.cfg, type: info.type, faction: info.faction,
        quality: info.quality, element: EB_ELEMENTS[info.faction] || 'Unknown',
        name: ebBeastName(info.type, b.star), star: b.star, level: b.level,
        potential: b.potential, maxPotential: ebMaxPotential(info.quality),
        power: b.power, mainBuff: b.mainBuff, mainBuffName: ebBuffName(b.mainBuff),
        baseBuff: (b.baseBuff || []).map(function(id) { return { id: id, name: ebBuffName(id) }; }),
        fieldCfg: null, fieldName: null, slotId: null, fieldSlotNum: null, slotLevel: null, slotBuffs: []
      };
      beastMap[b.id] = resolved;
      return resolved;
    });

    var fields = (enigmas.fields || []).map(function(f) {
      var slots = (f.slots || []).map(function(s, idx) {
        // Prefer the platform table's `order` for this hole id when the
        // platforms JSON has loaded — that's the player's true in-game slot
        // number. Fall back to array index + 1 only before the JSON loads
        // (renderEnigmaTab re-renders once it's available).
        var fieldSlotNum = ebHoleOrder(s.id) || (idx + 1);
        var beast = beastMap[s.beastId];
        if (beast && s.beastId !== '0') {
          beast.fieldCfg = f.cfg;
          beast.fieldName = EB_FIELD_NAMES[f.cfg] || ('Field ' + f.cfg);
          beast.slotId = s.id;
          beast.fieldSlotNum = fieldSlotNum;
          beast.slotLevel = s.level;
          beast.slotBuffs = (s.buffs || []).map(function(sb) {
            return { id: sb.id, name: ebBuffName(sb.id), val: sb.val };
          });
        }
        return {
          id: s.id, fieldSlotNum: fieldSlotNum, beastId: s.beastId, level: s.level, potential: s.potential,
          buffs: (s.buffs || []).map(function(sb) { return { id: sb.id, name: ebBuffName(sb.id), val: sb.val }; }),
          beast: (s.beastId !== '0' && beast) ? beast : null
        };
      });
      // Sort by the (now hole-id-corrected) slot number so cards render in
      // visual order. Field 5 (Offense) ships slots in a rotated array order
      // in the battle JSON; without this, cards display correct slot labels
      // but in the wrong sequence on the grid.
      slots.sort(function(a, b) { return a.fieldSlotNum - b.fieldSlotNum; });
      return {
        cfg: f.cfg, name: EB_FIELD_NAMES[f.cfg] || ('Field ' + f.cfg), active: f.active,
        expectedSlots: EB_FIELD_SLOT_COUNTS[f.cfg] || slots.length,
        slots: slots, deployedCount: slots.filter(function(s) { return s.beast; }).length
      };
    });

    return { beasts: beasts, fields: fields };
  }

  var HERO_CACHE = null;

  var HERO_TYPE_CACHE = null;

  function heroName(id) {
    return (HERO_CACHE && HERO_CACHE[id]) || ('Hero #' + id);
  }

  function heroBranch(id, suppHt) {
    // Primary: inline map (always available, no fetch dependency)
    var code = HERO_TYPE_MAP[id];
    if (code) return HERO_TYPE_NAMES[code];
    // The player's own hero supplement carries the game's hero_type (0 Army, 1 Navy, 2 Air Force)
    if (typeof suppHt === 'number' && HERO_TYPE_NAMES[suppHt + 1]) return HERO_TYPE_NAMES[suppHt + 1];
    // Fallback: fetched cache from all-heroes.json
    if (HERO_TYPE_CACHE && HERO_TYPE_CACHE[id]) return HERO_TYPE_CACHE[id];
    return 'Unknown';
  }

  function heroGearScore(hero) {
    return heroGearScoreBreakdown(hero).total;
  }

  function heroGearScoreBreakdown(hero) {
    var slotScores = [];
    var totalRefine = 0, totalRune = 0;
    (hero.heroEquips || []).forEach(function(equip) {
      var infos = equip.infos || [];
      // Refine: average rollPct across the random-stat (type=1) slots
      var type1 = [];
      var type2 = null;
      infos.forEach(function(info) {
        if (info.type === 1) type1.push(info);
        else if (info.type === 2) type2 = info;
      });
      var rollSum = 0;
      var rollSlots = 0;
      type1.forEach(function(info) {
        var tmpl = GEAR_TEMPLATE[info.templateId];
        if (!tmpl || !tmpl.m) return;
        var pct = Math.min(100, (info.buffValue || 0) / tmpl.m * 100);
        rollSum += pct;
        rollSlots++;
      });
      var refineScore = rollSlots > 0 ? (rollSum / (rollSlots * 100)) * 400 : 0;

      // Rune: normalize star/starMax → 0-600
      var runeScore = 0;
      var runeData = null;
      if (type2 && type2.templateId) {
        runeData = resolveRune(type2.templateId);
        if (runeData && runeData.sm > 0) {
          runeScore = (runeData.s / runeData.sm) * 600;
        }
      }
      totalRefine += refineScore;
      totalRune += runeScore;
      slotScores.push({
        equipId: equip.id,
        refine: Math.round(refineScore),
        rune: Math.round(runeScore),
        total: Math.round(refineScore + runeScore),
        runeName: runeData ? runeData.n : null,
        runeStar: runeData ? runeData.s : 0,
        runeStarMax: runeData ? runeData.sm : 0,
        rollSlots: rollSlots,
        avgRollPct: rollSlots > 0 ? Math.round(rollSum / rollSlots) : 0
      });
    });
    return {
      total: Math.round(totalRefine + totalRune),
      refineTotal: Math.round(totalRefine),
      runeTotal: Math.round(totalRune),
      slots: slotScores
    };
  }

  function msResolveMarchSize(slot) {
    if (!slot || !slot.id || !slot.lv) return null;
    if (slot.id === MS_SKILL_ID.rare) return { rarity: 'rare', level: slot.lv };
    if (slot.id === MS_SKILL_ID.normal) return { rarity: 'normal', level: slot.lv };
    return null;
  }

  function msEnumerateBenchSkills(heroesSupp) {
    if (!heroesSupp || !Array.isArray(heroesSupp.list)) return [];
    var out = [];
    for (var i = 0; i < heroesSupp.list.length; i++) {
      var h = heroesSupp.list[i];
      if (!h || !h.id) continue;
      var presets = [
        { idx: 1, p: h.p1 },
        { idx: 2, p: h.p2 },
      ];
      for (var k = 0; k < presets.length; k++) {
        var p = presets[k].p;
        if (!p) continue;
        // Buff slot b[0]
        if (Array.isArray(p.b)) {
          var r = msResolveMarchSize(p.b[0]);
          if (r) out.push({
            heroId: h.id, presetIdx: presets[k].idx,
            slotKind: 'b', slotIdx: 0,
            rarity: r.rarity, level: r.level,
          });
        }
        // Supportive slots x[0..3]
        if (Array.isArray(p.x)) {
          for (var xi = 0; xi < p.x.length; xi++) {
            var rx = msResolveMarchSize(p.x[xi]);
            if (rx) out.push({
              heroId: h.id, presetIdx: presets[k].idx,
              slotKind: 'x', slotIdx: xi,
              rarity: rx.rarity, level: rx.level,
            });
          }
        }
      }
    }
    return out;
  }

  function msEnumerateBagSkills(invSupp) {
    var out = { rare: {}, normal: {} };
    if (!invSupp || !invSupp.tabs || !Array.isArray(invSupp.tabs.hero)) return out;
    var heroTab = invSupp.tabs.hero;
    for (var i = 0; i < heroTab.length; i++) {
      var it = heroTab[i];
      if (!it || !it.id || !it.a) continue;
      var matched = null;
      var matchedLevel = null;
      for (var lvR in MS_BAG_ITEM_ID.rare) {
        if (MS_BAG_ITEM_ID.rare[lvR] === it.id) { matched = 'rare'; matchedLevel = Number(lvR); break; }
      }
      if (!matched) {
        for (var lvN in MS_BAG_ITEM_ID.normal) {
          if (MS_BAG_ITEM_ID.normal[lvN] === it.id) { matched = 'normal'; matchedLevel = Number(lvN); break; }
        }
      }
      if (!matched || !matchedLevel) continue;
      out[matched][matchedLevel] = (out[matched][matchedLevel] || 0) + it.a;
    }
    return out;
  }

  function msEnumerateChests(invSupp) {
    var out = { directRare: {}, premiumRareLv5: 0 };
    if (!invSupp || !invSupp.tabs || !Array.isArray(invSupp.tabs.item)) return out;
    var itemTab = invSupp.tabs.item;
    for (var i = 0; i < itemTab.length; i++) {
      var it = itemTab[i];
      if (!it || !it.id || !it.a) continue;
      var direct = MS_CHEST_RARE[String(it.id)];
      if (direct) {
        out.directRare[direct.level] = (out.directRare[direct.level] || 0) + it.a;
        continue;
      }
      if (MS_CHEST_PREMIUM[String(it.id)]) {
        out.premiumRareLv5 += it.a;
      }
    }
    return out;
  }

  function msBuildPool(opts) {
    var heroesSupp = opts.heroesSupp;
    var invSupp = opts.invSupp;
    var excluded = opts.excludedHeroIds || new Set();
    var marched = opts.marchedHeroIds || new Set();

    var pool = { rare: {}, normal: {} };

    var bag = msEnumerateBagSkills(invSupp);
    Object.keys(bag.rare).forEach(function (lv) {
      pool.rare[lv] = (pool.rare[lv] || 0) + bag.rare[lv];
    });
    Object.keys(bag.normal).forEach(function (lv) {
      pool.normal[lv] = (pool.normal[lv] || 0) + bag.normal[lv];
    });

    // Bench equipped — only from heroes NOT excluded and NOT in the march.
    // Dedupe per slot, NOT per (rarity, level): the same slot across both
    // presets is the same physical card, but different slots (e.g. b[0] +
    // x[2]) on the same hero hold different cards even if levels match.
    var allBench = msEnumerateBenchSkills(heroesSupp);
    var benchEquipped = [];
    var dedupeKey = {};
    for (var i = 0; i < allBench.length; i++) {
      var b = allBench[i];
      if (excluded.has(b.heroId)) continue;
      if (marched.has(b.heroId)) continue;
      var key = b.heroId + '|' + b.slotKind + '|' + b.slotIdx + '|' + b.rarity + '|' + b.level;
      if (dedupeKey[key]) continue;
      dedupeKey[key] = true;
      benchEquipped.push(b);
      pool[b.rarity][b.level] = (pool[b.rarity][b.level] || 0) + 1;
    }

    var chests = msEnumerateChests(invSupp);
    Object.keys(chests.directRare).forEach(function (lv) {
      pool.rare[lv] = (pool.rare[lv] || 0) + chests.directRare[lv];
    });
    if (chests.premiumRareLv5) {
      pool.rare[5] = (pool.rare[5] || 0) + chests.premiumRareLv5;
    }

    return {
      pool: pool,
      breakdown: {
        bag: bag,
        benchEquipped: benchEquipped,
        directChests: chests.directRare,
        premiumPotential: { rareLv5: chests.premiumRareLv5 },
      },
    };
  }

  function msComputeTarget(target, pool) {
    var rarity = target.rarity;
    var levelPool = (pool[rarity] || {});
    var startLevel = target.currentLevel;
    var maxLv = MS_MAX_LEVEL[rarity];

    if (startLevel >= maxLv) {
      return {
        targetLevel: startLevel,
        goalLevel: null,
        maxedOut: true,
        status: 'ready',
        walkDown: [],
        bottomShortage: 0,
      };
    }

    var have = function (lv) { return levelPool[lv] || 0; };
    var needed = 2;
    var walkDown = [];

    var shortage = Math.max(0, needed - have(startLevel));
    walkDown.push({
      level: startLevel,
      need: needed,
      have: have(startLevel),
      shortage: shortage,
    });
    if (shortage === 0) {
      return {
        targetLevel: startLevel,
        goalLevel: startLevel + 1,
        maxedOut: false,
        status: 'ready',
        walkDown: walkDown,
        bottomShortage: 0,
      };
    }

    for (var L = startLevel - 1; L >= 1; L--) {
      var needHere = shortage * 3;
      var haveHere = have(L);
      var shortHere = Math.max(0, needHere - haveHere);
      walkDown.push({ level: L, need: needHere, have: haveHere, shortage: shortHere });
      if (shortHere === 0) {
        shortage = 0;
        break;
      }
      shortage = shortHere;
    }

    return {
      targetLevel: startLevel,
      goalLevel: startLevel + 1,
      maxedOut: false,
      status: shortage === 0 ? 'almost' : 'short',
      walkDown: walkDown,
      bottomShortage: shortage,
    };
  }

  function decorLevel(id, groupId) {
    // Prefer the authoritative id -> level map from the game's building TABLE.
    // Old decoration groups use a non-contiguous id encoding (Cracked Coffin
    // L1=46400, L2=4640002) that breaks the linear "id - baseId + 1" formula.
    if (LV_BY_ID && LV_BY_ID[id] != null) return LV_BY_ID[id];
    if (LV_BY_ID && LV_BY_ID[String(id)] != null) return LV_BY_ID[String(id)];
    var baseId = DECOR_GROUP_BASE[String(groupId)];
    if (!baseId) return 1; // default to level 1 if no base found
    var delta = id - baseId + 1;
    // Guard against absurd results from the linear fallback so a stray
    // non-contiguous id can't blow up the modal arithmetic (we cap at the
    // group's known max level, defaulting to 15).
    var cap = (MAX_LEVEL && MAX_LEVEL[String(groupId)]) || 15;
    return Math.max(1, Math.min(cap, delta));
  }

  function scaledBuffVal(buff, level, groupId) {
    var extractedLvl = DECOR_EXTRACTED_LVL[String(groupId)] || 1;
    if (!level || level === extractedLvl) return buff.v;
    // Scale from extracted level to target level
    return Math.round(buff.v / extractedLvl * level);
  }

  function formatScaledDecorBuff(buff, level, groupId) {
    var v = scaledBuffVal(buff, level, groupId);
    if (buff.t === 1) return '+' + v;
    var pct = v / 100;
    return '+' + (pct === Math.floor(pct) ? pct.toFixed(0) : pct.toFixed(1)) + '%';
  }

  function _adv_invAmount(it) {
    return Number(it && (it.amount != null ? it.amount : it.a)) || 0;
  }

  function _adv_invLevel(it) {
    return Number(it && (it.level != null ? it.level : it.l)) || 1;
  }

  function _adv_invGroup(it) {
    return it && (it.group != null ? it.group : it.g);
  }

  function _adv_calcAvailableShards(inventory) {
    var inv = inventory || {};
    var items = (inv.tabs && inv.tabs.item) || [];
    var directShards = 0, boxShards = 0, luckyChests = 0;
    items.forEach(function(it) {
      var id = Number(it.id);
      var amt = _adv_invAmount(it);
      if (id === 20213232) directShards += amt;
      else if (id === 10000196) boxShards += 10 * amt;
      else if (id === 10000096) luckyChests += amt;
    });
    return {
      universal: directShards + boxShards,
      directShards: directShards,
      boxShards: boxShards,
      luckyChests: luckyChests
    };
  }

  function _adv_pieceShardValue(level, levelsEntry) {
    if (!levelsEntry || !Array.isArray(levelsEntry.levels) || level <= 0) return 0;
    if (level === 1) {
      var lv2 = null;
      for (var i = 0; i < levelsEntry.levels.length; i++) {
        if (levelsEntry.levels[i].l === 2) { lv2 = levelsEntry.levels[i]; break; }
      }
      return lv2 ? Math.round((lv2.fu || 0) / 3) : 0;
    }
    for (var j = 0; j < levelsEntry.levels.length; j++) {
      if (levelsEntry.levels[j].l === level) return levelsEntry.levels[j].fu || 0;
    }
    return 0;
  }

  function _adv_calcGroupSpecificShards(group, inventory, levelsData) {
    var decor = (inventory && inventory.tabs && inventory.tabs.decor) || [];
    var levelsEntry = levelsData ? levelsData[String(group)] : null;
    var total = 0;
    decor.forEach(function(d) {
      if (String(_adv_invGroup(d)) === String(group)) {
        var lv = _adv_invLevel(d);
        var amt = _adv_invAmount(d);
        total += amt * _adv_pieceShardValue(lv, levelsEntry);
      }
    });
    return total;
  }

  function _adv_getPlacedLevel(group, merged) {
    var ids = (merged && merged.decorations && merged.decorations.ids) || [];
    var baseId = DECOR_GROUP_BASE[String(group)];
    if (!baseId) return 0;
    // Level from the game's id -> level map (decorLevel); some groups use a non-unit id stride
    // (Travel Trunk 54708 = L1, 54718 = L2), so "maxId - baseId + 1" is only the fallback.
    var maxLv = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var g = decorIdToGroup(id);
      if (String(g) === String(group)) {
        var lv = decorLevel(id, group);
        if (lv > maxLv) maxLv = lv;
      }
    }
    return maxLv;
  }

  function _adv_parseBuffMap(s) {
    var out = {};
    if (!s) return out;
    String(s).split(/[\s,]+/).filter(Boolean).forEach(function(p) {
      var bits = p.split('|');
      if (bits.length >= 2) {
        var n = parseFloat(bits[1]);
        if (!isNaN(n)) out[bits[0]] = n;
      }
    });
    return out;
  }

  function _adv_levelBuffMap(lv) {
    var m = _adv_parseBuffMap(lv && lv.bi);
    var be = _adv_parseBuffMap(lv && lv.be);
    Object.keys(be).forEach(function(k) { m[k] = be[k]; });
    return m;
  }

  function _adv_getNextUpgrade(group, currentLevel, levelsData) {
    var entry = levelsData[String(group)];
    if (!entry || !entry.levels) return null;
    var nextLv = null, curLv = null;
    for (var i = 0; i < entry.levels.length; i++) {
      var lv = entry.levels[i];
      if (lv.l === currentLevel) curLv = lv;
      if (lv.l === currentLevel + 1) nextLv = lv;
    }
    if (!nextLv) return null;
    var nextMap = _adv_levelBuffMap(nextLv);
    var curMap = curLv ? _adv_levelBuffMap(curLv) : {};
    var deltas = {};  // buffId -> raw delta (units depend on valueType)
    Object.keys(nextMap).forEach(function(k) {
      var d = nextMap[k] - (curMap[k] || 0);
      if (d !== 0) deltas[k] = d;
    });
    // The `fu` field is the target level's full shard value, but in-game the
    // existing piece being consumed is credited as 1/3 of that value (decor
    // shard progression scales 3× per level). Net upgrade cost = fu * 2/3.
    // Verified: Osmanthus Moon L1→L2 advisor was 720, game shows 480; ratio
    // holds across every shard-upgradeable decor. Only apply the discount
    // when there's a piece to consume (currentLevel >= 1) — minting from
    // scratch (currentLevel = 0 → L1 piece) has fu = 0 anyway.
    var rawFu = nextLv.fu || 0;
    var shardCost = (currentLevel >= 1 && rawFu > 0) ? Math.round(rawFu * 2 / 3) : rawFu;
    return {
      fromLevel: currentLevel,
      toLevel: currentLevel + 1,
      shardCost: shardCost,
      buffDeltas: deltas
    };
  }

  function _adv_statMatchesEntry(statId, entry) {
    var allow = ADVISOR_STAT_BUFFS[statId];
    if (!allow || !entry || !entry.buffs) return false;
    for (var i = 0; i < entry.buffs.length; i++) {
      if (allow.indexOf(String(entry.buffs[i].id)) >= 0) return true;
    }
    return false;
  }

  function _adv_buildRecommendation(entry, currentLevel, levelsData, availableForGroup, universalShards, groupShards) {
    var levelsEntry = levelsData[String(entry.group)];
    if (!levelsEntry || levelsEntry.fi !== ADVISOR_UNIVERSAL_SHARD_ID) return null;
    var upg = _adv_getNextUpgrade(entry.group, currentLevel, levelsData);
    if (!upg || upg.shardCost <= 0) return null;

    // Build per-buff display rows: { id, label, valueType, rawDelta, formattedDelta, perShard }
    var buffMeta = {};
    (entry.buffs || []).forEach(function(b) {
      buffMeta[String(b.id)] = b;
    });
    var rows = [];
    var roiScalar = 0;
    Object.keys(upg.buffDeltas).forEach(function(bid) {
      var meta = buffMeta[bid] || { id: bid, valueType: 1 };
      var raw = upg.buffDeltas[bid];
      var displayDelta, normalizedScalar;
      if (meta.valueType === 10000) {
        // basis-point percent: 400 -> 4.0%
        var pct = raw / 100;
        displayDelta = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
        normalizedScalar = pct;  // percent points contribute most directly to ROI
      } else {
        // raw additive integer
        displayDelta = (raw >= 0 ? '+' : '') + raw;
        normalizedScalar = raw;
      }
      var perShard = upg.shardCost > 0 ? (normalizedScalar / upg.shardCost) : 0;
      // Display the inverse — "shards per +1 unit" — since players think in
      // terms of unit cost ("how many shards to gain 1 more"). The raw rate
      // (0.002/shard) was technically correct but unintuitive. ROI math
      // unchanged: higher stat-per-shard still ranks better.
      var shardsPerUnit = (normalizedScalar > 0) ? (upg.shardCost / normalizedScalar) : 0;
      function fmtShards(n) {
        if (!isFinite(n) || n <= 0) return '-';
        return n >= 100 ? Math.round(n).toLocaleString()
             : n >= 10  ? n.toFixed(1)
             : n.toFixed(2);
      }
      rows.push({
        id: bid,
        label: (typeof BUFF_NAMES_DECOR !== 'undefined' && BUFF_NAMES_DECOR[bid]) ? BUFF_NAMES_DECOR[bid] : ('Buff ' + bid),
        valueType: meta.valueType,
        rawDelta: raw,
        displayDelta: displayDelta,
        scalar: normalizedScalar,
        perShard: perShard,
        perShardLabel: meta.valueType === 10000
          ? (fmtShards(shardsPerUnit) + ' shards per +1%')
          : (fmtShards(shardsPerUnit) + ' shards per +1')
      });
      roiScalar += normalizedScalar;
    });
    // Apply group-spare credit to the displayed cost rather than inflating
    // "Have". Have stays anchored to universal shards (the player's actual
    // resource); the spare unplaced pieces in this group reduce the upgrade
    // cost since they get sacrificed-in during the upgrade. Net effect on
    // "ready" check is identical.
    var rawCost = upg.shardCost;
    var groupCredit = groupShards || 0;
    var netCost = Math.max(0, rawCost - groupCredit);
    return {
      group: entry.group,
      name: entry.name,
      iconPath: entry.iconPath,
      fromLevel: upg.fromLevel,
      toLevel: upg.toLevel,
      shardCost: netCost,
      rawShardCost: rawCost,
      groupCredit: groupCredit,
      buffRows: rows,
      available: availableForGroup,
      universalShards: universalShards != null ? universalShards : availableForGroup,
      groupShards: groupCredit,
      ready: availableForGroup >= rawCost,
      roi: roiScalar / Math.max(rawCost, 1),
      category: entry.category
    };
  }

  function _adv_statView(rec, statId) {
    var allow = ADVISOR_STAT_BUFFS[statId] || [];
    var mine = [], other = [], sum = 0;
    (rec.buffRows || []).forEach(function(row) {
      if (allow.indexOf(String(row.id)) >= 0) { mine.push(row); sum += row.scalar || 0; }
      else other.push(row);
    });
    var v = {};
    Object.keys(rec).forEach(function(k) { v[k] = rec[k]; });
    v.buffRows = mine;
    v.alsoRows = other;
    v.roi = sum / Math.max(rec.rawShardCost, 1);
    return v;
  }

  function _adv_rankRecs(list) {
    return list.slice().sort(function(a, b) {
      if (b.roi !== a.roi) return b.roi - a.roi;
      if (a.shardCost !== b.shardCost) return a.shardCost - b.shardCost;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function boResolveWeights(playstyle) {
    if (playstyle.weights && playstyle.weights.length === (playstyle.units || []).length) {
      return playstyle.weights;
    }
    var n = (playstyle.units || []).length;
    if (playstyle.mode === 'mono') return [1.0];
    if (playstyle.mode === 'triple') return [1.0, 1.0, 1.0].slice(0, n || 3);
    if (playstyle.balance === 'primarySecondary') return [1.0, 0.75];
    return [1.0, 1.0];
  }

  function boPlaystyleMult(targetUnit, playstyle) {
    var weights = boResolveWeights(playstyle);
    if (targetUnit === 0) {
      if (playstyle.mode === 'mono') return 1.5;
      var sum = 0;
      for (var i = 0; i < weights.length; i++) sum += weights[i];
      return sum;
    }
    var units = playstyle.units || [];
    for (var j = 0; j < units.length; j++) {
      if (units[j] === targetUnit) return weights[j] || 0;
    }
    return 0;
  }

  function boClassifyBuff(buffId, isMain) {
    var id = Number(buffId);
    var lastDigit = id % 10;
    var targetUnit = lastDigit;

    if (id === 520000) return { statKey: 'march', scope: 'always', targetUnit: 0 };
    if (id >= 520010 && id <= 520013) return { statKey: 'dmgInc', scope: 'always', targetUnit: targetUnit };
    if (id >= 520020 && id <= 520023) return { statKey: 'dmgDec', scope: 'always', targetUnit: targetUnit };
    if (id >= 520030 && id <= 520033) return { statKey: 'def', scope: 'always', targetUnit: targetUnit };

    // ATK/HP main buffs 520040-073 are the "(off)" and "(def)" labeled
    // variants in EB_BUFF_NAMES. Per Tex 2026-05-18: anything labeled
    // "(on the offensive)" or "(on the defensive)" only fires in one
    // direction so it gets the 0.5 scope multiplier.
    //   520040-053 → (off) → offensive scope (half)
    //   520060-073 → (def) → defensive scope (half)
    if (id >= 520040 && id <= 520053) {
      return { statKey: BO_ATKHP_MAP[id] || 'atk', scope: 'offensive', targetUnit: targetUnit };
    }
    if (id >= 520060 && id <= 520073) {
      return { statKey: BO_ATKHP_MAP[id] || 'atk', scope: 'defensive', targetUnit: targetUnit };
    }

    // 520100-103 = Suppression DEF: cross-faction DEF that benefits the
    // DEFENDING unit type. The trailing digit does NOT follow the usual
    // 1=Army/2=Navy/3=Air pattern; the buff names are explicit:
    //   520100 = All Forces Suppression DEF Bonus  → all units
    //   520101 = Navy DEF vs Army                  → Navy (targetUnit 2)
    //   520102 = Air DEF vs Navy                   → Air  (targetUnit 3)
    //   520103 = Army DEF vs Air                   → Army (targetUnit 1)
    // Weighted as DEF per Tex's stat equivalencies.
    if (id === 520100) return { statKey: 'def', scope: 'always', targetUnit: 0 };
    if (id === 520101) return { statKey: 'def', scope: 'always', targetUnit: 2 };
    if (id === 520102) return { statKey: 'def', scope: 'always', targetUnit: 3 };
    if (id === 520103) return { statKey: 'def', scope: 'always', targetUnit: 1 };

    // 520110-113 = "All/Army/Navy/Air ATK" (no qualifier in EB_BUFF_NAMES)
    // and 520120-123 = "All/Army/Navy/Air HP Boost" (no qualifier). These
    // are the normal always-on variants — full weight. Previous version
    // had them as offensive scope, which inverted Tex's intent.
    if (id >= 520110 && id <= 520113) return { statKey: 'atk', scope: 'always', targetUnit: targetUnit };
    if (id >= 520120 && id <= 520123) return { statKey: 'hp',  scope: 'always', targetUnit: targetUnit };

    // 520130-143 = Elemental Enhance / Elemental RES. Per Tex's stat
    // equivalencies, elemental stats are useless in the optimizer (weight 0).
    if (id >= 520130 && id <= 520143) return { statKey: 'elemental', scope: 'always', targetUnit: targetUnit };

    return null;
  }

  function boBeastScore(beast, atState, slot, playstyle, conditionMet) {
    if (!beast) return 0;
    var star = atState === 'maxOut' ? boMaxStarFor(beast) : (beast.st || 0);
    var level = atState === 'maxOut' ? boMaxLevelFor(beast) : (beast.lv || 0);
    var pot = beast.pot || 0;
    var gated = conditionMet === false; // undefined / true / non-false → not gated

    var total = 0;
    if (beast.mb) total += boScoreOneBuff(beast.mb, true, star, level, pot, playstyle);
    (beast.bb || []).forEach(function(buffId) {
      total += boScoreOneBuff(buffId, false, star, level, pot, playstyle);
    });

    // Slot-level rarity bonus: every slot scales the deployed beast's potential
    // into a "rarity boost %" that becomes effective ATK / HP / DEF / etc. via
    // the slot's stat-package weights. Formula proven against game UI:
    //   rarityBoostPct = ceil(potential/16) * slot.maxEnhanceCap / 100000
    // Skipped entirely when the slot's unlock condition is unmet (gated).
    if (!gated) {
      total += boComputeRarityBonus(beast, slot, atState, playstyle);
    }

    if (slot && slot.enhanceRowId) {
      var enhLevel = atState === 'maxOut' ? boMaxEnhanceLevel(slot.enhanceRowId) : (slot.enhanceLevel || 0);
      if (enhLevel > 0) {
        var enh = boEnhanceAt(slot.enhanceRowId, enhLevel);
        if (enh && enh.buffId) {
          var cls = boClassifyBuff(enh.buffId, true);
          if (cls && cls.statKey !== 'elemental') {
            total += enh.buffValue
              * BO_STAT_WEIGHTS[cls.statKey]
              * BO_SCOPE_MULT[cls.scope]
              * boPlaystyleMult(cls.targetUnit, playstyle);
          }
        }
      }
    }

    return total;
  }

  function boGetTgLinkForSlot(fieldType, order) {
    var f = BO_TG_REFINEMENT_LINK[fieldType];
    return f ? f[order] || null : null;
  }

  function boIsRefinementDrivenSlot(fieldType, order) {
    return (fieldType === 4 || fieldType === 5) && order >= 7 && order <= 9;
  }

  function boResolveSlotWeights(slot) {
    var key = slot.fieldType + ':' + slot.order;
    var dyn = BO_TG_DYNAMIC_OVERRIDES && BO_TG_DYNAMIC_OVERRIDES[key];
    if (dyn) return dyn;
    // Refinement-driven slots (fields 4-5, slots 7-9) have no meaningful default:
    // with no refined gear on this player they contribute nothing.
    if (boIsRefinementDrivenSlot(slot.fieldType, slot.order)) return [];
    return (BO_RARITY_BUFF_TABLE[slot.fieldType] && BO_RARITY_BUFF_TABLE[slot.fieldType][slot.order])
           || BO_RARITY_DEFAULT_WEIGHTS;
  }

  function boComputeRarityBonus(beast, slot, atState, playstyle) {
    if (!beast || !slot) return 0;
    var pot = atState === 'maxOut' ? Math.max(beast.pot || 0, 16000) : (beast.pot || 0);
    if (pot <= 0) return 0;
    var hole = boLookupHole(slot.fieldType, slot.order);
    if (!hole || !hole.maxEnhanceValue) return 0;
    var cap = parseInt(String(hole.maxEnhanceValue).split('|')[1], 10);
    if (!cap) return 0;

    var rarityBoostPct = Math.ceil(pot / 16) * cap / 100000;
    var weights = boResolveSlotWeights(slot);

    var total = 0;
    weights.forEach(function(w) {
      var psm = boPlaystyleMult(w.targetUnit, playstyle);
      total += rarityBoostPct * w.weightRatio * (BO_STAT_WEIGHTS[w.statKey] || 0) * psm;
    });
    return total;
  }

  function boRarityBonusBreakdown(beast, slot, atState, playstyle) {
    var out = { atk: 0, hp: 0, def: 0, dmgInc: 0, dmgDec: 0, march: 0 };
    if (!beast || !slot) return out;
    var pot = atState === 'maxOut' ? Math.max(beast.pot || 0, 16000) : (beast.pot || 0);
    if (pot <= 0) return out;
    var hole = boLookupHole(slot.fieldType, slot.order);
    if (!hole || !hole.maxEnhanceValue) return out;
    var cap = parseInt(String(hole.maxEnhanceValue).split('|')[1], 10);
    if (!cap) return out;
    var rarityBoostPct = Math.ceil(pot / 16) * cap / 100000;
    var weights = boResolveSlotWeights(slot);
    weights.forEach(function(w) {
      var psm = boPlaystyleMult(w.targetUnit, playstyle);
      if (out[w.statKey] != null) {
        out[w.statKey] += rarityBoostPct * w.weightRatio * psm;
      }
    });
    return out;
  }

  function boScoreOneBuff(buffId, isMain, star, level, pot, playstyle) {
    var cls = boClassifyBuff(buffId, isMain);
    if (!cls) return 0;
    if (cls.statKey === 'elemental') return 0;
    var raw = ebComputeBuffValue(buffId, star, level, pot, isMain);
    if (raw == null) return 0;
    return raw
      * BO_STAT_WEIGHTS[cls.statKey]
      * BO_SCOPE_MULT[cls.scope]
      * boPlaystyleMult(cls.targetUnit, playstyle);
  }

  function boBeastTiebreak(b) {
    if (!b) return 0;
    var pot = Number(b.pot) || 0;
    var q   = Number(b.q)   || 0;
    var st  = Number(b.st)  || 0;
    var lv  = Number(b.lv)  || 0;
    return pot * 1000 + q * 1e5 + st * 100 + lv;
  }

  var boEnhData = null;

  var boFieldConditions = null;

  var boPlatforms = null;

  var boHoleIndex = null;

  function boEnhanceAt(rowId, level) {
    if (!boEnhData) return null;
    var entry = boEnhData[String(rowId)] || boEnhData[rowId];
    if (!entry) return null;
    var rows = entry.levels || entry; // tolerate either shape
    if (!rows.find) return null;
    return rows.find(function(r) { return r.level === level; }) || null;
  }

  function boMaxEnhanceLevel(rowId) {
    if (!boEnhData) return 0;
    var entry = boEnhData[String(rowId)] || boEnhData[rowId];
    if (!entry) return 0;
    var rows = entry.levels || entry;
    if (!rows.length) return 0;
    return rows[rows.length - 1].level;
  }

  function boLookupHole(fieldType, order) {
    if (!boHoleIndex && boPlatforms) {
      boHoleIndex = {};
      (boPlatforms.holes || []).forEach(function(h) {
        boHoleIndex[h.fieldType + ':' + h.order] = h;
      });
    }
    return boHoleIndex ? boHoleIndex[fieldType + ':' + order] : null;
  }

  function boReadPlayerEnhance(merged, siteKey) {
    var out = {};
    var resolved = ebResolveBeasts((merged && merged.enigmas) || {});
    (resolved.fields || []).forEach(function(f) {
      var fid = f.cfg;
      if (!fid) return;
      (f.slots || []).forEach(function(s) {
        var lv = s.level || 0;
        if (lv > 0) out[fid + ':' + s.fieldSlotNum] = lv;
      });
    });
    return out;
  }

  var BO_TG_DYNAMIC_OVERRIDES = null;

  var BO_TG_HAS_GEAR_DATA = false;

  function boReadTgRefinement(merged, siteKey) {
    BO_TG_DYNAMIC_OVERRIDES = null;
    BO_TG_HAS_GEAR_DATA = false;
    if (!merged) return {};

    // Per-tgSlot aggregators. Keyed by "statKey|targetUnit" -> { value, heroId }.
    // Tracking the contributing hero id alongside the winning value lets the
    // TG Linkage row in the optimizer modal name the gear's source ("+15%
    // atk via Sasha") so players can see why a slot is active and what to
    // refine next.
    var aggrType11 = {};  // refined random attributes 70%+
    var aggrType10 = {};  // base attributes from equip.enhanceValue

    (merged.heroes || []).forEach(function(h) {
      var equips = h.heroEquips || [];
      if (equips.length > 0) BO_TG_HAS_GEAR_DATA = true;
      equips.forEach(function(equip, idx) {
        var tgSlot = equip._slot || (idx + 1);

        // Type 11: random attrs refined to 70%+. The 70% gate is on the
        // random attribute's roll quality (info.buffValue / cls.max), but
        // the value that actually flows into the linked enigma slot is the
        // ENHANCEMENT CHIP — info.enhanceValue, which activates (enhanceShow
        // === 2) once the roll crosses 70%. Previous code stored buffValue
        // (the base random-attribute roll) and over-reported the linkage
        // contribution by 5-10x. enhanceValue matches the "+X%" chip the
        // gear card displays alongside each random stat in the armory.
        var infos = equip.infos || [];
        infos.forEach(function(info) {
          if (info.type !== 1) return;
          var cls = boGearTemplateClassify(info.templateId);
          if (!cls || !cls.statKey || !cls.max) return;
          var pct = (info.buffValue || 0) / cls.max * 100;
          if (pct < 70) return;
          // Defensive: enhanceShow === 2 is the explicit "chip active" flag.
          // pct >= 70 implies it, but the game can clear enhanceShow if the
          // gear was just rerolled and the chip hasn't been (re)applied.
          if (info.enhanceShow != null && info.enhanceShow !== 2) return;
          var val11 = info.enhanceValue || 0;
          if (val11 <= 0) return;
          var key = cls.statKey + '|' + cls.targetUnit;
          aggrType11[tgSlot] = aggrType11[tgSlot] || {};
          var prev11 = aggrType11[tgSlot][key];
          if (!prev11 || val11 > prev11.value) {
            aggrType11[tgSlot][key] = { value: val11, heroId: h.id };
          }
        });

        // Type 10: base attributes from gear's enhanceValue map.
        var enh = equip.enhanceValue || {};
        Object.keys(enh).forEach(function(buffGroupId) {
          var cls = BO_ENHANCE_BUFF_CLASS[buffGroupId];
          if (!cls) return;
          var val = enh[buffGroupId];
          if (!val) return;
          var key = cls.statKey + '|' + cls.targetUnit;
          aggrType10[tgSlot] = aggrType10[tgSlot] || {};
          var prev10 = aggrType10[tgSlot][key];
          if (!prev10 || val > prev10.value) {
            aggrType10[tgSlot][key] = { value: val, heroId: h.id };
          }
        });
      });
    });

    // Second source: gear supplement (from bookmarklet). Battle-report
    // heroEquips can be sparse — only the marching heroes carry full equip
    // data — so cross-device shared views often have a full gear supp but
    // empty heroEquips. The supp shape per piece is documented in
    // all-bookmarklet.js (~L463-490): { slot, heroId, buffs: [{ type:'stat',
    // templateId, rawValue, rawEnhance, enhanceShow, max, rollPercent }, ...],
    // enhance: { buffGroupId: { rawValue, percent, statName } } }.
    var gearSupp = null;
    try { gearSupp = siteKey ? ArmoryIdentity.getSupplement('gear', siteKey) : null; } catch (e) {}
    if (gearSupp) {
      var pieces = (gearSupp.goldGear || [])
        .concat(gearSupp.equippedNonGold || [])
        .concat(gearSupp.presetOnly || []);
      if (pieces.length > 0) BO_TG_HAS_GEAR_DATA = true;
      pieces.forEach(function(p) {
        if (!p || p.slot == null) return;
        var tgSlot = p.slot;
        var hid = p.heroId || p.directHeroId || 0;

        // Type 11: random attrs refined to 70%+, contribution = rawEnhance.
        (p.buffs || []).forEach(function(b) {
          if (!b || b.type !== 'stat') return;
          if (b.rollPercent == null || b.rollPercent < 70) return;
          if (b.enhanceShow != null && b.enhanceShow !== 2) return;
          var enhVal = Number(b.rawEnhance) || 0;
          if (enhVal <= 0) return;
          var cls = boGearTemplateClassify(b.templateId);
          if (!cls || !cls.statKey) return;
          var key = cls.statKey + '|' + cls.targetUnit;
          aggrType11[tgSlot] = aggrType11[tgSlot] || {};
          var prev = aggrType11[tgSlot][key];
          if (!prev || enhVal > prev.value) {
            aggrType11[tgSlot][key] = { value: enhVal, heroId: hid };
          }
        });

        // Type 10: piece.enhance map (parsed into objects on the supp side).
        var enhMap = p.enhance || {};
        Object.keys(enhMap).forEach(function(buffGroupId) {
          var cls = BO_ENHANCE_BUFF_CLASS[buffGroupId];
          if (!cls) return;
          var rawEntry = enhMap[buffGroupId];
          var val = (rawEntry && typeof rawEntry === 'object')
            ? Number(rawEntry.rawValue) || 0
            : Number(rawEntry) || 0;
          if (val <= 0) return;
          var key = cls.statKey + '|' + cls.targetUnit;
          aggrType10[tgSlot] = aggrType10[tgSlot] || {};
          var prev10 = aggrType10[tgSlot][key];
          if (!prev10 || val > prev10.value) {
            aggrType10[tgSlot][key] = { value: val, heroId: hid };
          }
        });
      });
    }

    // Project to enigma slots via the linkage table. Each weight carries the
    // statKey, targetUnit, weightRatio (used by the scoring path), AND the
    // contributing hero id so the UI can attribute "+X% atk via <hero>".
    var overrides = {};
    Object.keys(BO_TG_REFINEMENT_LINK).forEach(function(fid) {
      var fieldLink = BO_TG_REFINEMENT_LINK[fid];
      Object.keys(fieldLink).forEach(function(order) {
        var link = fieldLink[order];
        var tgSlot = link.tgSlot;
        var aggr = link.type === 11 ? aggrType11[tgSlot] : aggrType10[tgSlot];
        if (!aggr) return;
        var weights = Object.keys(aggr).map(function(k) {
          var parts = k.split('|');
          return {
            statKey: parts[0],
            targetUnit: parseInt(parts[1], 10),
            weightRatio: aggr[k].value / 10000,
            heroId: aggr[k].heroId
          };
        });
        if (weights.length) {
          overrides[fid + ':' + order] = weights;
        }
      });
    });

    BO_TG_DYNAMIC_OVERRIDES = overrides;
    return overrides;
  }

  function _ar_advisorBuildBaseGear(merged, siteKey) {
    // gearByHero[heroId][slot] = { runeName, star, equipId } | undefined
    // Sources, in priority order:
    //   1. merged.heroes[].heroEquips — battle report (when a report ID resolves)
    //   2. gear supplement (goldGear / equippedNonGold / presetOnly) — falls back
    //      to bookmarklet-extracted gear so heroes/slots show even when no battle
    //      report has been loaded for the player.
    // Slots filled from source 1 take precedence; source 2 fills the gaps.
    // Rune names from source 2 are re-resolved via templateId so a locale-
    // mismatched extraction (e.g. Russian client) renders in canonical English.
    var gearByHero = {};
    if (merged && Array.isArray(merged.heroes)) {
      merged.heroes.forEach(function(h) {
        if (!h || !h.id) return;
        gearByHero[h.id] = gearByHero[h.id] || {};
        var equips = h.heroEquips || [];
        equips.forEach(function(eq, idx) {
          if (!eq) return;
          // Only gold (quality 5) can socket a rune; supplement-synthesized
          // equips know their quality, battle-report ones do not.
          if (eq._slot && eq.quality != null && eq.quality < 5) return;
          // Battle-report equips are in slot order; supplement-synthesized
          // ones carry their real slot in _slot (a hero may own only slots 2+4).
          var slot = eq._slot || (idx + 1); // heroEquips array index 0-5 → slot 1-6
          if (slot > 6) return;
          var rd = null;
          (eq.infos || []).forEach(function(info) {
            if (info.type === 2 && info.templateId) {
              rd = resolveRune(info.templateId);
            }
          });
          if (rd) {
            gearByHero[h.id][slot] = { runeName: rd.n, star: rd.s, starMax: rd.sm, equipId: eq.id };
          } else {
            gearByHero[h.id][slot] = null; // gear piece without a rune
          }
        });
      });
    }
    if (siteKey) {
      var gearSupp = null;
      try { gearSupp = ArmoryIdentity.getSupplement('gear', siteKey); } catch (e) {}
      if (gearSupp) {
        var pieces = (gearSupp.goldGear || [])
          .concat(gearSupp.equippedNonGold || [])
          .concat(gearSupp.presetOnly || []);
        pieces.forEach(function(p) {
          if (!p || !p.heroId || p.heroId <= 0) return;
          // Only GOLD gear (quality 5) can socket a Titan Rune. Non-gold
          // pieces (Purple+ = quality 4 and below) would render as
          // permanently-empty, un-adviseable slots, so a hero whose only gear
          // is non-gold would clutter the rune advisor with nothing to act on.
          // Skip them here. (The battle-report path — source 1 above — is left
          // intact, so a hero the player actually fielded stays visible.)
          if (p.quality != null && p.quality < 5) return;
          var slot = p.slot;
          if (!slot || slot < 1 || slot > 6) return;
          var hid = p.heroId;
          gearByHero[hid] = gearByHero[hid] || {};
          // Already filled from battle report? Don't overwrite — de-dupe by slot.
          if (Object.prototype.hasOwnProperty.call(gearByHero[hid], slot)) return;
          var rune = (p.buffs || []).find(function(b) { return b && b.type === 'rune'; });
          if (!rune) { gearByHero[hid][slot] = null; return; }
          // Prefer templateId-based resolution (locale-agnostic).
          var rd = null;
          if (rune.templateId != null && typeof resolveRune === 'function') {
            rd = resolveRune(+rune.templateId);
          }
          if (rd) {
            gearByHero[hid][slot] = { runeName: rd.n, star: rd.s, starMax: rd.sm, equipId: p.uid || null };
          } else if (rune.name) {
            gearByHero[hid][slot] = {
              runeName: rune.name,
              star: rune.star != null ? rune.star : 0,
              starMax: rune.starMax != null ? rune.starMax : null,
              equipId: p.uid || null
            };
          } else {
            gearByHero[hid][slot] = null;
          }
        });
      }
    }
    return gearByHero;
  }

  function _ar_advisorRuneTypeIndex(catalog) {
    // Index by name for O(1) slot/star_max lookup.
    var idx = {};
    if (!catalog || !Array.isArray(catalog.runes)) return idx;
    catalog.runes.forEach(function(r) {
      idx[r.name] = r;
    });
    return idx;
  }

  function _ar_advisorMergeCost(catalog, runeIdx, runeName, slot, fromStar, toStar) {
    var meta = runeIdx[runeName];
    if (!meta) return null;
    var slotEntry = (meta.slots || []).filter(function(s) { return s.slot === slot; })[0];
    if (!slotEntry) return null;
    var starMax = slotEntry.star_max;
    var schedule = (catalog.mechanics && catalog.mechanics.merge_cost_per_star && catalog.mechanics.merge_cost_per_star[String(starMax)]) || [];
    if (toStar > starMax || fromStar < 0 || toStar <= fromStar) return null;
    var cost = 0;
    for (var i = fromStar; i < toStar && i < schedule.length; i++) cost += schedule[i];
    return { cost: cost, starMax: starMax };
  }

  function _ar_validateAdvisorStep(step, ctx) {
    var errors = [];
    if (!step || !step.type) return ['Missing step type'];
    var pool = ctx.pool || {};
    var gear = ctx.gearByHero || {};
    var runeIdx = ctx.runeIdx || {};
    var catalog = ctx.catalog || {};

    function poolHas(name, star) {
      return (pool[name] && pool[name][star]) || 0;
    }

    switch (step.type) {
      case 'place': {
        if (!step.dstHero) errors.push('Pick destination hero');
        if (!step.dstSlot || step.dstSlot < 1 || step.dstSlot > 6) errors.push('Pick destination slot');
        if (!step.runeName) errors.push('Pick a rune');
        if (errors.length) break;
        var meta = runeIdx[step.runeName];
        if (!meta) { errors.push('Unknown rune ' + step.runeName); break; }
        var slotEntry = (meta.slots || []).filter(function(s) { return s.slot === step.dstSlot; })[0];
        if (!slotEntry) errors.push(step.runeName + ' cannot go in slot ' + step.dstSlot);
        if (poolHas(step.runeName, 0) < 1) errors.push('No ' + step.runeName + ' s:0 in pool');
        // The destination must be a gear piece the hero owns (an empty slot
        // is recorded as null; a missing key means no piece there at all).
        var dstGear = gear[step.dstHero];
        if (!dstGear || !Object.prototype.hasOwnProperty.call(dstGear, step.dstSlot)) {
          errors.push('Destination hero has no gear piece in that slot');
        }
        var dstCurr = dstGear && dstGear[step.dstSlot];
        if (dstCurr && dstCurr.runeName) errors.push('Slot already has a rune (recycle or inherit first)');
        break;
      }
      case 'merge': {
        if (!step.dstHero) errors.push('Pick hero');
        if (!step.dstSlot || step.dstSlot < 1 || step.dstSlot > 6) errors.push('Pick slot');
        if (!step.runeName) errors.push('Pick a rune (locked to slot rune)');
        if (step.fromStar == null) errors.push('Pick from star');
        if (step.toStar == null) errors.push('Pick target star');
        if (errors.length) break;
        var costInfo = _ar_advisorMergeCost(catalog, runeIdx, step.runeName, step.dstSlot, step.fromStar, step.toStar);
        if (!costInfo) { errors.push('Merge invalid (slot/rune/star mismatch)'); break; }
        if (step.toStar > costInfo.starMax) errors.push('Exceeds star_max ' + costInfo.starMax);
        var avail = poolHas(step.runeName, 0);
        if (avail < costInfo.cost) errors.push('Need ' + costInfo.cost + ' ' + step.runeName + ' s:0 in pool, have ' + avail);
        var curr = gear[step.dstHero] && gear[step.dstHero][step.dstSlot];
        if (!curr || !curr.runeName) errors.push('Slot has no rune to merge into');
        else {
          if (curr.runeName !== step.runeName) errors.push('Slot rune is ' + curr.runeName + ', not ' + step.runeName);
          if (curr.star !== step.fromStar) errors.push('Slot star is ' + curr.star + ', not ' + step.fromStar);
        }
        break;
      }
      case 'inherit': {
        if (!step.srcHero) errors.push('Pick source hero');
        if (!step.srcSlot) errors.push('Pick source slot');
        if (!step.dstHero) errors.push('Pick destination hero');
        if (!step.dstSlot) errors.push('Pick destination slot');
        if (errors.length) break;
        if (step.srcSlot !== step.dstSlot) errors.push('Inherit must be between same slot number');
        if (step.srcHero === step.dstHero && step.srcSlot === step.dstSlot) errors.push('Source and destination must differ');
        var src = gear[step.srcHero] && gear[step.srcHero][step.srcSlot];
        if (!src || !src.runeName) errors.push('Source slot has no rune');
        // Destination must own a gear piece in that slot — Inherit is a swap,
        // not a teleport. Park is the verb for moving onto a not-yet-owned
        // empty piece (advises the player to craft one).
        var dg = gear[step.dstHero];
        if (!dg || !Object.prototype.hasOwnProperty.call(dg, step.dstSlot)) {
          errors.push('Destination hero has no gear piece in that slot. Use Park instead to inherit onto an empty piece.');
        }
        break;
      }
      case 'park': {
        // Park: move a rune off a hero onto an "open" empty piece of the
        // same slot type. Player crafts one if they don't have a spare.
        // No destination hero — the rune leaves the hero's setup entirely.
        if (!step.srcHero) errors.push('Pick source hero');
        if (!step.srcSlot) errors.push('Pick source slot');
        if (errors.length) break;
        var psrc = gear[step.srcHero] && gear[step.srcHero][step.srcSlot];
        if (!psrc || !psrc.runeName) errors.push('Source slot has no rune to park');
        break;
      }
      case 'recycle': {
        // srcHero: > 0 = equipped on a hero (verify slot still holds the rune);
        // 0 = unequipped piece from the legendary gear pool (rune name is
        // stamped on the step at compose time, gear state doesn't track it).
        if (step.srcHero == null) errors.push('Pick source hero');
        if (!step.srcSlot) errors.push('Pick source slot');
        if (errors.length) break;
        if (step.srcHero > 0) {
          var rcurr = gear[step.srcHero] && gear[step.srcHero][step.srcSlot];
          if (!rcurr || !rcurr.runeName) errors.push('Source slot has no rune');
          else if (rcurr.star !== 0) errors.push('Cannot recover upgraded rune (s:' + rcurr.star + '). The inherit-to-junk macro only works on 0★ runes.');
        } else if (step.srcHero === 0) {
          // Unequipped source. Validator can't look up a hero slot, so rely on
          // the stamped rune name + the player-side legendary pool view for
          // staleness checks at apply time.
          if (!step.srcRuneName) errors.push('Source piece has no rune to recover');
        } else {
          errors.push('Pick source hero');
        }
        break;
      }
      default:
        errors.push('Unknown step type: ' + step.type);
    }
    return errors;
  }

  function _ar_applyAdvisorStep(state, step, catalog, runeIdx) {
    state.pool = state.pool || {};
    state.gearByHero = state.gearByHero || {};
    function ensurePool(name) {
      if (!state.pool[name]) state.pool[name] = {0:0,1:0,2:0,3:0,4:0,5:0,6:0};
      return state.pool[name];
    }
    function ensureGear(hid) {
      if (!state.gearByHero[hid]) state.gearByHero[hid] = {};
      return state.gearByHero[hid];
    }
    switch (step.type) {
      case 'place': {
        var p = ensurePool(step.runeName);
        p[0] = (p[0] || 0) - 1;
        var g = ensureGear(step.dstHero);
        g[step.dstSlot] = { runeName: step.runeName, star: 0 };
        break;
      }
      case 'merge': {
        var ci = _ar_advisorMergeCost(catalog, runeIdx, step.runeName, step.dstSlot, step.fromStar, step.toStar);
        if (ci) {
          var p2 = ensurePool(step.runeName);
          p2[0] = (p2[0] || 0) - ci.cost;
        }
        var g2 = ensureGear(step.dstHero);
        g2[step.dstSlot] = { runeName: step.runeName, star: step.toStar };
        break;
      }
      case 'inherit': {
        var sg = ensureGear(step.srcHero);
        var dg = ensureGear(step.dstHero);
        var srcRune = sg[step.srcSlot] || null;
        var dstRune = dg[step.dstSlot] || null;
        dg[step.dstSlot] = srcRune;
        sg[step.srcSlot] = dstRune;
        break;
      }
      case 'park': {
        // Source's rune moves onto an empty open gear piece (off-hero).
        // We don't track parked runes in state — the rune leaves the hero's
        // slot and lives on whatever empty piece the player crafts/uses.
        // After-state shows the source slot as empty.
        var pg = ensureGear(step.srcHero);
        pg[step.srcSlot] = null;
        break;
      }
      case 'recycle': {
        var rg = ensureGear(step.srcHero);
        var rsrc = rg[step.srcSlot];
        if (rsrc && rsrc.runeName && rsrc.star === 0) {
          var rp = ensurePool(rsrc.runeName);
          rp[0] = (rp[0] || 0) + 1;
          rg[step.srcSlot] = null;
        }
        break;
      }
    }
  }

  function _ar_validateStepSequence(basePool, baseGear, steps, catalog, runeIdx) {
    var st = {
      pool: JSON.parse(JSON.stringify(basePool || {})),
      gearByHero: JSON.parse(JSON.stringify(baseGear || {}))
    };
    return (steps || []).map(function(step) {
      var errors = _ar_validateAdvisorStep(step, { pool: st.pool, gearByHero: st.gearByHero, runeIdx: runeIdx, catalog: catalog }) || [];
      try { _ar_applyAdvisorStep(st, step, catalog, runeIdx); } catch (e) {}
      return { ok: errors.length === 0, errors: errors };
    });
  }

  function _ar_isRecoverableRune(r) {
    return !!(r && r.runeName && r.star === 0);
  }

  function _ar_planViewBase(inv, gear, lookups) {
    // Loose bag runes only come from the inventory, so without it (missing, or
    // private and wiped by the 403) the pool can't be judged.
    if (!inv) return { pool: {}, known: false };
    var pool = {};
    try { pool = _ar_extractRunePool(inv, gear, lookups || {}).pool || {}; } catch (e) {}
    return { pool: pool, known: true };
  }

  function _ar_recomputeAdvisorState(basePool, baseGear, steps, catalog, runeIdx) {
    var state = {
      pool: JSON.parse(JSON.stringify(basePool || {})),
      gearByHero: JSON.parse(JSON.stringify(baseGear || {}))
    };
    (steps || []).forEach(function(step) {
      _ar_applyAdvisorStep(state, step, catalog, runeIdx);
    });
    return state;
  }

  function _ar_advisorStepEnglish(step) {
    function hn(id) { return (typeof heroName === 'function') ? heroName(id) : ('Hero #' + id); }
    // Resolve slot 1..6 to the in-game gear-piece name (Assault Pistol etc.)
    // so plan steps read like inventory actions instead of indexed array entries.
    function sn(s) {
      if (typeof GEAR_SLOT_NAMES === 'object' && GEAR_SLOT_NAMES && GEAR_SLOT_NAMES[s]) return GEAR_SLOT_NAMES[s];
      return 'slot ' + s;
    }
    switch (step.type) {
      case 'place':
        return 'Place ' + step.runeName + ' on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot) + ' (1 ' + step.runeName + ' 0★)';
      case 'merge':
        return 'Merge ' + step.runeName + ' on ' + hn(step.dstHero) + "'s " + sn(step.dstSlot) + ' from ' + step.fromStar + '★ to ' + step.toStar + '★';
      case 'inherit':
        return 'Inherit ' + hn(step.srcHero) + "'s " + sn(step.srcSlot) + ' ↔ ' + hn(step.dstHero) + "'s " + sn(step.dstSlot);
      case 'park': {
        var pSlot = sn(step.srcSlot);
        var pRune = step.srcRuneName
          ? (step.srcRuneName + (step.srcRuneStar ? ' ' + step.srcRuneStar + '★' : '') + ' rune')
          : 'the rune';
        return 'Park ' + pRune + ' off ' + hn(step.srcHero) + "'s " + pSlot + ' (inherit it to an empty ' + pSlot + ', craft one if you do not have a spare)';
      }
      case 'recycle': {
        // Spell out the macro instead of saying "Recycle <hero>'s <gear>" —
        // the game-mechanic "recycle" destroys the gear, which is the wrong
        // mental model for the player. The advisor's intent is to RECOVER
        // the rune (back to bag), which only works by inheriting the rune
        // onto a throwaway junk piece and recycling THAT junk piece.
        // srcRuneName / srcGearName / dstGearName are stamped at compose
        // time when known; fall back to neutral phrasing for legacy steps
        // saved before this schema change.
        var slotN = sn(step.srcSlot);
        var srcGear = step.srcGearName || slotN;
        var runeLabel = step.srcRuneName ? (step.srcRuneName + ' rune') : 'the rune';
        var srcLoc = (step.srcHero > 0)
          ? (hn(step.srcHero) + "'s " + srcGear)
          : ('unequipped ' + srcGear);
        var dstClause = step.dstGearName
          ? ('inherit to junk ' + step.dstGearName)
          : ('inherit to a junk ' + slotN);
        return 'Recover ' + runeLabel + ' from ' + srcLoc +
               ' (' + dstClause + ', then recycle the junk gear)';
      }
      default:
        return JSON.stringify(step);
    }
  }

  function _ar_advisorRelativeAge(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function _ar_perEntityReportTs(reports, srcKey, idKey) {
    var out = {};
    (reports || []).forEach(function(r) {
      var ex = r && r.extracted;
      if (!ex) return;
      var tsMs = ex.logtime ? ex.logtime * 1000 : 0;
      if (!tsMs) return;
      var arr = ex[srcKey];
      if (!Array.isArray(arr)) return;
      arr.forEach(function(e) {
        if (!e) return;
        var id = e[idKey];
        if (id == null) return;
        if (!out[id] || tsMs > out[id].ts) out[id] = { ts: tsMs, reportId: r.id, entry: e };
      });
    });
    return out;
  }

  function _ar_buildSourceFreshness(opts) {
    var suppTs = (opts && opts.suppTs) || 0;
    var reports = opts && opts.reports;
    var perEntity = opts && opts.perEntityTs; // object from _ar_perEntityReportTs
    var latestReportTs = 0, latestReportId = null;
    (reports || []).forEach(function(r) {
      var t = (r && r.extracted && r.extracted.logtime) ? r.extracted.logtime * 1000 : 0;
      if (t > latestReportTs) { latestReportTs = t; latestReportId = r.id; }
    });
    var staleEntityCount = 0;
    if (perEntity && suppTs > 0) {
      Object.keys(perEntity).forEach(function(id) {
        if (perEntity[id].ts > suppTs) staleEntityCount++;
      });
    }
    return {
      suppTs: suppTs,
      latestReportTs: latestReportTs,
      latestReportId: latestReportId,
      suppIsNewer: suppTs >= latestReportTs,
      staleEntityCount: staleEntityCount
    };
  }

  function _ar_freshnessAge(tsMs) {
    if (!tsMs) return 'unknown';
    var diff = Date.now() - tsMs;
    if (diff < 60000) return 'just now';
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(tsMs).toLocaleDateString();
  }

  function _ar_overlayMechasWithChips(mergedMechas, perMechaReportTs, chipsSupp, suppTs) {
    var byId = {};
    (mergedMechas || []).forEach(function(m) {
      if (!m || m.mechaId == null) return;
      var t = (perMechaReportTs[m.mechaId] && perMechaReportTs[m.mechaId].ts) || 0;
      byId[m.mechaId] = { mechaId: m.mechaId, chips: m.chips || [], _sourceTs: t, _source: 'report' };
    });
    if (chipsSupp && Array.isArray(chipsSupp.chips) && suppTs > 0) {
      // Bucket supp chips by mechaId; chip.m === 0 means bag pool (not bound).
      var suppByMecha = {};
      chipsSupp.chips.forEach(function(c) {
        if (!c || !c.m) return;
        if (!suppByMecha[c.m]) suppByMecha[c.m] = [];
        suppByMecha[c.m].push(c);
      });
      Object.keys(suppByMecha).forEach(function(midStr) {
        var mid = Number(midStr);
        var existing = byId[mid];
        if (!existing || suppTs > existing._sourceTs) {
          // Supp wins. Reshape supp chip rows into the battle-report shape.
          var chips = suppByMecha[mid].map(function(c) {
            return {
              chipId: c.c, level: c.lv || 0,
              rndAttrs: c.r || '', otherRndAttrs: c.o || null,
              refineTimes: c.rt || 0, reservation: c.rs || 0
            };
          });
          byId[mid] = { mechaId: mid, chips: chips, _sourceTs: suppTs, _source: 'supp' };
        }
      });
    }
    // Preserve the battle-report ordering where possible; new supp-only mechas
    // append at the end sorted by mechaId.
    var seen = {};
    var ordered = [];
    (mergedMechas || []).forEach(function(m) {
      if (!m || m.mechaId == null || seen[m.mechaId]) return;
      seen[m.mechaId] = true;
      if (byId[m.mechaId]) ordered.push(byId[m.mechaId]);
    });
    Object.keys(byId).map(Number).sort(function(a, b) { return a - b; }).forEach(function(mid) {
      if (!seen[mid]) ordered.push(byId[mid]);
    });
    return ordered;
  }

  function _ar_synthDecorationsFromSupp(supp) {
    if (!supp || !Array.isArray(supp.active)) return null;
    var ids = supp.active.map(function(d) { return d.id; });
    var suitArr = Array.isArray(supp.suits) ? supp.suits : [];
    var suit = [];
    var suitLevelBuff = {};
    suitArr.forEach(function(s) {
      if (!s || s.suitId == null) return;
      if (s.rewarded) suit.push(s.suitId);
      if (s.rewardedLevel != null) suitLevelBuff[String(s.suitId)] = s.rewardedLevel;
    });
    return { ids: ids, suit: suit, suitLevelBuff: suitLevelBuff };
  }

  function _ar_synthSkinsFromSupp(supp) {
    if (!supp) return null;
    return {
      activeSkin: supp.activeSkinId || 0,
      ownedSkins: supp.ownedSkins || [],
      collectSkins: supp.collectSkins || [],
      activeNameplate: 0,
      ownedNameplates: supp.ownedNameplates || [],
      activeEffect: 0,
      ownedEffects: supp.ownedEffects || []
    };
  }

  function mergeReportData(reports) {
    var merged = {
      heroes: {},        // keyed by heroId, latest wins
      decorations: null, skins: null, ctcs: null, enigmas: null,
      mechas: {},        // keyed by mechaId
      effectBuffs: null, traceEffectBuffs: null,
      // Formation accumulator: each battle report exposes only the marching formation
      // for that side, so as the player marches different formations across reports,
      // we collect each one's state under its formation_id (1001/1002/1003).
      formations: {},
      armyMastery: null,
      elementLevels: null,
      career: null
    };

    // Sort by logtime ascending so newest battles iterate last. Top War's
    // battle report JSON carries a `logtime` Unix-seconds timestamp on the
    // root object — captured into ex.logtime at extract time. Falling back
    // to report-id lex compare only kicks in when logtime is missing (older
    // cached extractions that predate the field), since report-ids are
    // already known to drift over time when the in-game battle log rolls.
    var sortedReports = reports.slice().sort(function(a, b) {
      var at = (a.extracted && a.extracted.logtime) || 0;
      var bt = (b.extracted && b.extracted.logtime) || 0;
      if (at !== bt) return at - bt;
      var ai = String(a.id || ''), bi = String(b.id || '');
      if (ai.length !== bi.length) return ai.length - bi.length;
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });

    sortedReports.forEach(function(report) {
      var ex = report.extracted;
      if (!ex) return;

      // Per-march: latest-added wins for same hero/mecha
      (ex.heroes || []).forEach(function(h) { merged.heroes[h.id] = h; });
      (ex.mechas || []).forEach(function(m) {
        if (m.chips && m.chips.length) merged.mechas[m.mechaId] = m;
      });

      // Account-level: latest report wins (chrono-sorted above).
      if (ex.decorations) merged.decorations = ex.decorations;
      if (ex.skins) merged.skins = ex.skins;
      if (ex.ctcs) merged.ctcs = ex.ctcs;
      // Battle reports always carry the player's full enigmas snapshot
      // regardless of which side they fought on, so the latest report wins
      // wholesale here. Earlier per-field merging caused stale data to leak
      // forward when an older report's field happened to outlive the newer
      // snapshot it should have been replaced by.
      if (ex.enigmas) merged.enigmas = ex.enigmas;
      if (ex.effectBuffs) merged.effectBuffs = ex.effectBuffs;
      if (ex.traceEffectBuffs) merged.traceEffectBuffs = ex.traceEffectBuffs;
      if (ex.armyMastery) merged.armyMastery = ex.armyMastery;
      if (ex.elementLevels) merged.elementLevels = ex.elementLevels;
      if (ex.career) merged.career = ex.career;

      // Formation accumulator — store latest per formation_id so re-running a report
      // refreshes that formation's lv/quality/masterys without losing the others.
      if (ex.formationV2 && ex.formationV2.id) {
        merged.formations[String(ex.formationV2.id)] = ex.formationV2;
      }
    });

    return {
      heroes: Object.values(merged.heroes),
      decorations: merged.decorations,
      skins: merged.skins,
      ctcs: merged.ctcs,
      enigmas: merged.enigmas,
      mechas: Object.values(merged.mechas),
      effectBuffs: merged.effectBuffs,
      traceEffectBuffs: merged.traceEffectBuffs,
      formations: merged.formations,
      armyMastery: merged.armyMastery,
      elementLevels: merged.elementLevels,
      career: merged.career
    };
  }

  /* ---------------------------------------------------------------------------------------------
   * NOT copied from the page: seams for the data the page loads lazily, so the copied functions above run
   * unchanged. Each setter holds the same assignment logic as the page's loader (parity-tested with the
   * page's own loader fed the same JSON).
   * ------------------------------------------------------------------------------------------- */
  var ArmoryIdentity = { getSupplement: function () { return null; } };
  function setIdentity(identity) { ArmoryIdentity = identity || { getSupplement: function () { return null; } }; }
  function setHeroCache(heroNames, heroTypes) { HERO_CACHE = heroNames || null; HERO_TYPE_CACHE = heroTypes || null; }

  // data/decor-lookups.json (page: _ar_decorFetch)
  function setDecorLookups(j) {
    function fill(target, src) {
      if (!src) return;
      for (var k in src) target[k] = src[k];
    }
    fill(DECOR_ID_TO_GROUP, j.DECOR_ID_TO_GROUP);
    fill(DECOR_GROUP_BASE, j.DECOR_GROUP_BASE);
    fill(DECOR_EXTRACTED_LVL, j.DECOR_EXTRACTED_LVL);
    fill(BUFF_NAMES_DECOR, j.BUFF_NAMES_DECOR);
    fill(MAX_LEVEL, j.MAX_LEVEL);
    fill(LV_BY_ID, j.LV_BY_ID);
    for (var _gbk in DECOR_GROUP_BASE) {
      DECOR_BASE_TO_GROUP[DECOR_GROUP_BASE[_gbk]] = parseInt(_gbk);
    }
  }

  // data/enigma-platforms.json (page: ebLoadPlatformReqs + boLoadOptimizerData)
  function setPlatforms(j) {
    boPlatforms = j;
    boHoleIndex = null;
    if (!j || !Array.isArray(j.holes)) return;
    var idx = {};
    var holeIdx = {};
    j.holes.forEach(function(h) {
      if (!idx[h.fieldType]) idx[h.fieldType] = {};
      var typeIds = Array.isArray(h.beastTypeIds) ? h.beastTypeIds : (h.beastTypeId ? [h.beastTypeId] : []);
      var typeNames = Array.isArray(h.beastTypeNames) ? h.beastTypeNames : (h.beastTypeName && h.beastTypeId ? [h.beastTypeName] : []);
      var label = h.beastTypeLabel || (typeNames.length === 0 ? 'Any beast type' : typeNames.join(' / '));
      idx[h.fieldType][h.order] = {
        rarity: h.minQualityName,
        element: h.factionName,
        elementId: h.faction,
        beastTypeIds: typeIds,
        beastTypeNames: typeNames,
        beastTypeLabel: label,
        qualityCap: h.qualityCap || h.beastTypeCap,
        isUniversal: h.faction === 0 && typeIds.length === 0 && h.minQuality === 1
      };
      holeIdx[h.id] = h.order;
    });
    EB_PLATFORM_REQS = idx;
    EB_HOLE_TO_ORDER = holeIdx;
  }

  // data/enigma-platform-enhance.json (page: boLoadOptimizerData)
  function setEnhance(j) {
    var byHole = j.platforms || j.enhance || j;
    boEnhData = {};
    Object.keys(byHole).forEach(function(k) {
      var entry = byHole[k];
      if (entry && entry.enhanceRowId != null) {
        boEnhData[String(entry.enhanceRowId)] = entry;
      }
    });
  }

  // data/enigma-field-conditions.json (page: boLoadOptimizerData)
  function setFieldConditions(j) { boFieldConditions = j.conditions || j; }

  // Synchronous form of the page's _adv_computeRecommendations: the page awaits three loaders and then runs the
  // loop below, which is copied from it. data = { levels: decoration-levels.json, index: decoration-index.json
  // (array), mutex: the mutex map }; inventory/merged as in the page.
  function computeDecorRecs(statIds, inventory, merged, data) {
      var levelsData = data.levels, idx = data.index, mutex = data.mutex;
      var shardSummary = _adv_calcAvailableShards(inventory);
      var byStat = {};
      statIds.forEach(function(s) { byStat[s] = []; });
      var groupNames = {};
      idx.forEach(function(e) { groupNames[String(e.group)] = e.name; });
      var seenGroups = {};
      idx.forEach(function(entry) {
        // The index can list a group more than once; one card per group.
        if (seenGroups[String(entry.group)]) return;
        seenGroups[String(entry.group)] = true;
        var placed = _adv_getPlacedLevel(entry.group, merged);
        var groupOnly = _adv_calcGroupSpecificShards(entry.group, inventory, levelsData);
        var totalShards = groupOnly + shardSummary.universal;
        var rec = _adv_buildRecommendation(entry, placed, levelsData, totalShards, shardSummary.universal, groupOnly);
        if (!rec) return;
        var partners = mutex[String(rec.group)] || [];
        rec.mutexPartners = partners.map(function(g) {
          return groupNames[String(g)] || ('Group ' + g);
        });
        statIds.forEach(function(s) {
          if (_adv_statMatchesEntry(s, entry)) byStat[s].push(_adv_statView(rec, s));
        });
      });
      Object.keys(byStat).forEach(function(s) {
        byStat[s] = _adv_rankRecs(byStat[s]);
      });
      return { byStat: byStat, shardSummary: shardSummary };
  }

  /* ---------------------------------------------------------------------------------------------
   * Next moves (NEW; ported from sample/armory-v2-sample.html "ARM", with the critique fixes: per-signal pick,
   * class order then fixed signal order, caps 1/1/2, refine by stats under 70%, decor across four stats, chips for
   * the HT the player fights with). Works on the v2 view-model (see test/fixtures/armory-core/), not on the raw
   * merged report. nextMoves(data, opts): opts.max = number of moves (default 3).
   * ------------------------------------------------------------------------------------------- */
  var moves = (function () {

  function rollPct(v, m) { return Math.min(100, (v / m) * 100); }

  /* Gear score: per piece 400 for refine (mean roll) + 600 for the rune (star / star max). */
  function gearScore(hero) {
    var refine = 0, rune = 0;
    hero.gear.forEach(function (p) {
      var sum = 0;
      p.stats.forEach(function (s) { sum += rollPct(s.v, s.m); });
      refine += p.stats.length ? (sum / (p.stats.length * 100)) * 400 : 0;
      rune += p.rune && p.rune.sm ? (p.rune.s / p.rune.sm) * 600 : 0;
    });
    return { refine: Math.round(refine), rune: Math.round(rune), total: Math.round(refine + rune) };
  }

  /* Weight by gear score rank: 1.0, 0.9, 0.8 ... never below 0.5. */
  function heroWeights(heroes) {
    var order = heroes.slice().sort(function (a, b) { return gearScore(b).total - gearScore(a).total; });
    var w = {};
    order.forEach(function (h, i) { w[h.name] = Math.max(0.5, 1 - 0.1 * i); });
    return w;
  }

  /* Same formula as the current page: a placed rune scores (star + 1) / (star max + 1), an empty slot scores 0 of 7. */
  function runeStats(heroes) {
    var n = 0, got = 0, max = 0;
    heroes.forEach(function (h) {
      h.gear.forEach(function (p) {
        if (p.rune) { n++; got += p.rune.s + 1; max += p.rune.sm + 1; } else { max += 7; }
      });
    });
    return { equipped: n, pct: max ? Math.round((got / max) * 100) : 0 };
  }

  /* Inside one signal: bigger gain first, then the stat closest to its goal (tie), then the hero weight, then the key.
     Across signals the raw gains are never compared: the class decides, then a fixed signal order. */
  var SIGRANK = { a: 0, e: 1, b: 2, d: 3, c: 4, f: 5 };
  function cmpIn(a, b) {
    return (b.gain - a.gain) || ((b.tie || 0) - (a.tie || 0)) || (b.weight - a.weight) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  function cmp(a, b) {
    return (a.cls - b.cls) || (SIGRANK[a.sig] - SIGRANK[b.sig]) || cmpIn(a, b);
  }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function slug(n) { return String(n).toLowerCase().replace(/ /g, '-'); }

  /* Decor stats a player can raise, in the order they are tried. Each is ranked on its own gain per shard. */
  var DECOR_STATS = [['960012', 'March Size', true], ['930100', 'All units Attack', false], ['930000', 'All units HP', false], ['1001001', 'All units DMG increase', false]];
  /* HT chip tables (Mecha_chip, same numbers as the live HT Chips page): value = base + per * level. */
  var CHIP_COLOUR = { 1: [100, 40], 2: [150, 60], 3: [200, 80], 4: [300, 120], 5: [500, 200] };
  var CHIP_STAT = { 1: ['932001', 'Heavy Trooper Attack'], 2: ['932002', 'Heavy Trooper HP'], 3: ['932002', 'Heavy Trooper HP'], 4: ['930100', 'All units Attack'], 5: ['930000', 'All units HP'], 6: ['930000', 'All units HP'] };

  function chipInfo(c) {
    if (!c.c) return null;
    var col = Math.floor(c.c / 100) % 10, tab = CHIP_COLOUR[col], st = CHIP_STAT[c.slot];
    if (!tab || !st) return null;
    return { col: col, stat: st[1], now: (tab[0] + tab[1] * c.lv) / 100, max: (tab[0] + tab[1] * 25) / 100 };
  }

  function nextMoves(D, opts) {
    var MAX = (opts && opts.max) || 3;
    /* Missing sections count as empty (a heroes-only input must not throw). */
    D = D || {};
    D = {
      heroes: D.heroes || [], runeBag: D.runeBag || {}, runeSlots: D.runeSlots || {}, runeCost: D.runeCost || {},
      decor: { shards: (D.decor && D.decor.shards) || 0, placed: (D.decor && D.decor.placed) || [] },
      ht: { chips: (D.ht && D.ht.chips) || [], reportMechas: D.ht ? D.ht.reportMechas : null },
      beastMoves: D.beastMoves || []
    };
    var cand = [];
    var W = heroWeights(D.heroes);

    /* a: place a bag rune into an empty rune slot (equipped gold gear). Free. */
    D.heroes.forEach(function (h) {
      h.gear.forEach(function (p) {
        if (!p.rune) {
          var avail = Object.keys(D.runeBag).filter(function (n) { return D.runeBag[n] > 0 && (D.runeSlots[n] || []).indexOf(p.slot) >= 0; })
            .sort();
          if (avail.length) {
            cand.push({
              sig: 'a', cls: 1, gain: 1, weight: W[h.name], key: 'a' + h.name + p.slot,
              parts: [{ s: 'Place ' }, { s: avail[0], n: 1 }, { s: ' on ' }, { s: h.name, n: 1 }, { s: ' slot ' }, { s: String(p.slot), n: 1 }],
              meta: '', ico: { u: 'rune-icons/' + slug(avail[0]) + '.png', q: 'q5', fb: avail[0].charAt(0) },
              route: 'heroes/battle?hero=' + encodeURIComponent(h.name) + '&slot=' + p.slot
            });
          }
        }
      });
    });

    /* b: merge an equipped rune to the next star when the bag holds the fodder. Uses what you have. */
    D.heroes.forEach(function (h) {
      h.gear.forEach(function (p) {
        var r = p.rune;
        if (!r || r.s >= r.sm) return;
        var costRow = D.runeCost[String(r.sm)];
        var cost = costRow ? costRow[r.s] : null;
        if (cost == null) return; // unknown merge cost: no move
        var have = D.runeBag[r.name] || 0;
        if (have >= cost) {
          cand.push({
            sig: 'b', cls: 2, gain: (1 / r.sm) * W[h.name], weight: W[h.name], key: 'b' + h.name + p.slot,
            parts: [{ s: 'Merge ' }, { s: r.name, n: 1 }, { s: ' on ' }, { s: h.name, n: 1 }, { s: ' slot ' }, { s: String(p.slot), n: 1 },
              { s: ' to ' }, { s: String(r.s + 1), n: 1 }, { s: (r.s + 1 === 1 ? ' star' : ' stars') }],
            meta: have + ' in bag, uses ' + cost, ico: { u: 'rune-icons/' + r.icon + '.png', q: 'q5', fb: r.name.charAt(0) },
            route: 'heroes/battle?hero=' + encodeURIComponent(h.name) + '&slot=' + p.slot
          });
        }
      });
    });

    /* c: refine an equipped gold piece with random stats under 70 percent. Costs resources.
       Each stat is judged against 70% on its own: the piece with the most stats under 70% comes first,
       and among equals the one whose lowest stat is closest to 70%. No averaging. */
    D.heroes.forEach(function (h) {
      h.gear.forEach(function (p) {
        var low = p.stats.map(function (s) { return rollPct(s.v, s.m); }).filter(function (x) { return x < 70; });
        if (!low.length) return;
        var lo = Math.round(Math.min.apply(null, low)), hi = Math.round(Math.max.apply(null, low));
        cand.push({
          sig: 'c', cls: 3, gain: (low.length / p.stats.length) * W[h.name], tie: Math.min.apply(null, low), weight: W[h.name], key: 'c' + h.name + p.slot,
          parts: [{ s: 'Refine ' }, { s: p.slotName, n: 1 }, { s: ' on ' }, { s: h.name, n: 1 }, { s: ': ' },
            { s: String(low.length), n: 1 }, { s: low.length === 1 ? ' stat under ' : ' stats under ' }, { s: '70%', n: 1 },
            { s: ' (' }, { s: lo === hi ? lo + '%' : lo + '-' + hi + '%', n: 1 }, { s: ')' }],
          meta: 'Each stat that reaches 70% turns on its bonus',
          ico: { u: 'titan-slot-icons/gear_' + p.slot + '.png', q: 'q5', fb: String(p.slot) },
          route: 'heroes/battle?hero=' + encodeURIComponent(h.name) + '&slot=' + p.slot
        });
      });
    });

    /* d: upgrade a placed decoration one level. The first stat in DECOR_STATS that has an affordable
       upgrade wins. Inside that stat: ROI = the stat's own gain per raw shard (D1), one row per group (D2),
       ties cheapest first, then name (D3). */
    var have = D.decor.shards, dChosen = null, dShort = null;
    DECOR_STATS.some(function (st) {
      var rows = [], seen = {};
      D.decor.placed.forEach(function (d) {
        if (!d.nx || seen[d.g]) return;
        var delta = d.nx.dl[st[0]] || 0;
        if (delta <= 0) return;
        seen[d.g] = 1;
        var net = Math.max(0, d.nx.raw - d.nx.credit);
        rows.push({ d: d, delta: delta, raw: d.nx.raw, net: net, roi: delta / Math.max(d.nx.raw, 1), stat: st });
      });
      rows.sort(function (a, b) { return (b.roi - a.roi) || (a.net - b.net) || (a.d.n < b.d.n ? -1 : 1); });
      rows.forEach(function (r) { r.afford = have >= r.net; });
      var aff = rows.filter(function (r) { return r.afford; })[0];
      if (aff) { dChosen = { r: aff, best: rows[0].roi }; return true; }
      if (st[2] && rows.length) dShort = { r: rows[0], ties: rows.filter(function (x) { return x.roi === rows[0].roi && x.net === rows[0].net; }).length };
      return false;
    });
    if (dChosen) {
      var r = dChosen.r;
      var vtxt = r.stat[2] ? '+' + r.delta : '+' + (r.delta / 100) + '%';
      cand.push({
        sig: 'd', cls: 2, gain: r.roi / dChosen.best, weight: 0, key: 'd' + r.d.n,
        parts: [{ s: 'Upgrade ' }, { s: r.d.n, n: 1 }, { s: ' to ' }, { s: 'Lv.' + r.d.nx.to, n: 1 }, { s: ': ' },
          { s: vtxt, n: 1 }, { s: ' ' + r.stat[1] }],
        meta: r.net + ' shards, ' + have + ' in bag',
        ico: { u: 'decor-icons/' + r.d.ic, q: r.d.q >= 6 ? 'q6' : r.d.q === 5 ? 'q5' : r.d.q === 4 ? 'q4' : r.d.q === 3 ? 'q3' : '', fb: r.d.n.charAt(0) },
        route: 'base/decor?item=' + encodeURIComponent(r.d.n).replace(/%20/g, '+')
      });
    }

    /* e: first Optimizer move from saved preferences. Needs saved prefs (none in the sample data). */
    (D.beastMoves || []).forEach(function (m, i) {
      cand.push({
        sig: 'e', cls: 1, gain: m.gain, weight: 0, key: 'e' + i,
        parts: m.parts, meta: '', route: 'beasts/optimizer'
      });
    });

    /* f: HT chips. Only the HT the player fights with (from the battle reports) is considered;
       with no battle report the whole HT list is used. A chip is raised only below Lv25 and needs its
       chip table row. Chip EXP is not in the data, so the move is never "uses what you have". */
    var fighting = D.ht.reportMechas; // null/undefined = no report (all HTs); [] = a report where no HT fought (none)
    D.ht.chips.forEach(function (c) {
      if (c.core || c.empty || c.lv >= 25 || !c.c) return;
      if (fighting && fighting.indexOf(c.mecha) < 0) return;
      var col = Math.floor(c.c / 100) % 10, tab = CHIP_COLOUR[col], stat = CHIP_STAT[c.slot];
      if (!tab || !stat) return;
      var now = (tab[0] + tab[1] * c.lv) / 100, max = (tab[0] + tab[1] * 25) / 100;
      cand.push({
        sig: 'f', cls: 3, gain: ((25 - c.lv) / 25) * (c.slot >= 4 ? 1 : 0.5), weight: 0, key: 'f' + c.ht + c.slot,
        parts: [{ s: 'Raise slot ' }, { s: String(c.slot), n: 1 }, { s: ' chip on ' }, { s: c.ht, n: 1 }, { s: ' from ' }, { s: 'Lv.' + c.lv, n: 1 }, { s: ' to ' }, { s: 'Lv.25', n: 1 }],
        meta: stat[1] + ' ' + now.toFixed(1) + '% now, ' + max.toFixed(1) + '% at Lv.25',
        ico: { u: c.ic ? 'ht-chip-icons/' + c.ic + '.png' : '', q: 'q' + col, fb: String(c.slot) },
        route: 'ht/loadouts?mecha=' + c.mecha + '&slot=' + c.slot
      });
    });

    /* Selection, per spec 3.3: the best candidate inside each signal comes first (cmp never compares raw gains
       across signals). Pass 1: one pick per class, one per signal. Pass 2: fill with other signals.
       Pass 3: a signal gets a second slot only when no other signal has a candidate left. */
    cand.sort(cmp);
    var picks = [];
    var perSig = {};
    function take(c, cap) {
      if (picks.length >= MAX || picks.indexOf(c) >= 0 || (perSig[c.sig] || 0) >= cap) return false;
      picks.push(c); perSig[c.sig] = (perSig[c.sig] || 0) + 1; return true;
    }
    [1, 2, 3].forEach(function (cl) {
      for (var i = 0; i < cand.length; i++) { if (cand[i].cls === cl) { if (take(cand[i], 1)) break; } }
    });
    for (var i = 0; i < cand.length && picks.length < MAX; i++) take(cand[i], 1);
    for (i = 0; i < cand.length && picks.length < MAX; i++) take(cand[i], 2);

    /* "Save for": only when no decor move is affordable and there is room. */
    if (!dChosen && dShort && picks.length < MAX) {
      var s = dShort.r;
      picks.push({
        sig: 'd', cls: 3, gain: 0, weight: 0, key: 'dsave',
        parts: dShort.ties > 1
          ? [{ s: 'Save ' }, { s: fmtInt(s.net), n: 1 }, { s: ' shards for ' }, { s: '+' + s.delta, n: 1 }, { s: ' March Size (' }, { s: String(dShort.ties), n: 1 }, { s: ' choices)' }]
          : [{ s: 'Save for ' }, { s: s.d.n, n: 1 }, { s: ' Lv.' + s.d.nx.to + ': ' }, { s: fmtInt(have) + ' / ' + fmtInt(s.net), n: 1 }, { s: ' shards' }],
        meta: '', ico: { u: 'decor-icons/' + s.d.ic, q: '', fb: s.d.n.charAt(0) },
        route: 'base/decor?item=' + encodeURIComponent(s.d.n).replace(/%20/g, '+')
      });
    }
    picks.sort(cmp);
    var classNames = { 1: 'Free', 2: 'Uses what you have', 3: 'Costs resources' };
    picks.forEach(function (p) {
      p.text = p.parts.map(function (x) { return x.s; }).join('');
      p.pill = classNames[p.cls];
    });
    return { picks: picks, pool: cand, weights: W };
  }

    return { gearScore: gearScore, heroWeights: heroWeights, runeStats: runeStats, nextMoves: nextMoves, computeMoves: nextMoves, rollPct: rollPct, chipInfo: chipInfo, CHIP_COLOUR: CHIP_COLOUR, CHIP_STAT: CHIP_STAT, DECOR_STATS: DECOR_STATS };
  })();

  var api = {
    heroName: heroName,
    heroBranch: heroBranch,
    heroGearScore: heroGearScore,
    heroGearScoreBreakdown: heroGearScoreBreakdown,
    _ar_extractRunePool: _ar_extractRunePool,
    _ar_advisorBuildBaseGear: _ar_advisorBuildBaseGear,
    _ar_advisorRuneTypeIndex: _ar_advisorRuneTypeIndex,
    _ar_advisorMergeCost: _ar_advisorMergeCost,
    _ar_validateAdvisorStep: _ar_validateAdvisorStep,
    _ar_applyAdvisorStep: _ar_applyAdvisorStep,
    _ar_validateStepSequence: _ar_validateStepSequence,
    _ar_isRecoverableRune: _ar_isRecoverableRune,
    _ar_planViewBase: _ar_planViewBase,
    _ar_recomputeAdvisorState: _ar_recomputeAdvisorState,
    _ar_advisorStepEnglish: _ar_advisorStepEnglish,
    decorIdToGroup: decorIdToGroup,
    decorLevel: decorLevel,
    scaledBuffVal: scaledBuffVal,
    formatScaledDecorBuff: formatScaledDecorBuff,
    _adv_invAmount: _adv_invAmount,
    _adv_invLevel: _adv_invLevel,
    _adv_invGroup: _adv_invGroup,
    _adv_calcAvailableShards: _adv_calcAvailableShards,
    _adv_pieceShardValue: _adv_pieceShardValue,
    _adv_calcGroupSpecificShards: _adv_calcGroupSpecificShards,
    _adv_getPlacedLevel: _adv_getPlacedLevel,
    _adv_parseBuffMap: _adv_parseBuffMap,
    _adv_levelBuffMap: _adv_levelBuffMap,
    _adv_getNextUpgrade: _adv_getNextUpgrade,
    _adv_statMatchesEntry: _adv_statMatchesEntry,
    _adv_buildRecommendation: _adv_buildRecommendation,
    _adv_statView: _adv_statView,
    _adv_rankRecs: _adv_rankRecs,
    ebHoleOrder: ebHoleOrder,
    ebPlatformReq: ebPlatformReq,
    ebResolveBeasts: ebResolveBeasts,
    boResolveWeights: boResolveWeights,
    boPlaystyleMult: boPlaystyleMult,
    boClassifyBuff: boClassifyBuff,
    boBeastScore: boBeastScore,
    boGetTgLinkForSlot: boGetTgLinkForSlot,
    boIsRefinementDrivenSlot: boIsRefinementDrivenSlot,
    boResolveSlotWeights: boResolveSlotWeights,
    boComputeRarityBonus: boComputeRarityBonus,
    boRarityBonusBreakdown: boRarityBonusBreakdown,
    boScoreOneBuff: boScoreOneBuff,
    boBeastTiebreak: boBeastTiebreak,
    boEnhanceAt: boEnhanceAt,
    boMaxEnhanceLevel: boMaxEnhanceLevel,
    boLookupHole: boLookupHole,
    boReadTgRefinement: boReadTgRefinement,
    boReadPlayerEnhance: boReadPlayerEnhance,
    _ar_buildSourceFreshness: _ar_buildSourceFreshness,
    _ar_freshnessAge: _ar_freshnessAge,
    _ar_advisorRelativeAge: _ar_advisorRelativeAge,
    _ar_perEntityReportTs: _ar_perEntityReportTs,
    mergeReportData: mergeReportData,
    _ar_overlayMechasWithChips: _ar_overlayMechasWithChips,
    _ar_synthDecorationsFromSupp: _ar_synthDecorationsFromSupp,
    _ar_synthSkinsFromSupp: _ar_synthSkinsFromSupp,
    msResolveMarchSize: msResolveMarchSize,
    msEnumerateBenchSkills: msEnumerateBenchSkills,
    msEnumerateBagSkills: msEnumerateBagSkills,
    msEnumerateChests: msEnumerateChests,
    msBuildPool: msBuildPool,
    msComputeTarget: msComputeTarget,
    setIdentity: setIdentity,
    setHeroCache: setHeroCache,
    setDecorLookups: setDecorLookups,
    setPlatforms: setPlatforms,
    setEnhance: setEnhance,
    setFieldConditions: setFieldConditions,
    computeDecorRecs: computeDecorRecs,
    moves: moves,
    nextMoves: moves.nextMoves
  };

  return api;
  }
  var api = create();
  api.create = create;
  window.ArmoryCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
