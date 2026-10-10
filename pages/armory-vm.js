/* armory-vm.js: the view-model for the Armory v2 Overview and Heroes screens (NOT copied from the page).
 * buildViewModel(merged, sources, opts) turns ArmoryData.loadArmory's merged report + supplements into one plain
 * object: the exact input ArmoryCore.nextMoves reads (heroes[].gear, runeBag/runeSlots/runeCost, decor, ht,
 * beastMoves) plus what the screens show (header card, strength band, area summaries, heroes list, the Next moves).
 * Pure: no DOM, no fetch, no storage. Depends on tw-game-data.js and an ArmoryCore instance (opts.core).
 *
 * Numbers are labelled with their source word (fable-redesign 2.4): "in battle reports", "in roster", "placed",
 * "in bag", "deployed", "collected", "equipped". Decor buff totals count each placed decoration's OWN base buff
 * only (never set bonuses, halos, or the 93011xx conditional family), in the game's own words.
 */
(function (window) {
  var isNode = typeof module === 'object' && module.exports;
  var G = isNode ? require('./tw-game-data.js') : window.TWGameData;
  var CoreLib = isNode ? require('./armory-core.js') : window.ArmoryCore;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = 86400000;
  var STALE_DAYS = 30;
  var GEAR_MAX = 6000; // 400 refine + 600 rune per slot, 6 slots
  // Buff ids the decor totals are made of, in the game's own words (ids not listed are never totalled).
  var TOTAL_IDS = { '960012': 'march', '930100': 'atk', '930000': 'hp', '980204': 'dmgTaken', '1001001': 'dmgInc' };

  // one portrait URL rule for every hero (v1 heroBaseIconUrl): a few starter heroes use another icon id
  function heroIcon(id) { return 'https://h5.topwargame.com/DynRes/images/headpic/hero_icon' + (G.HERO_ICON_OVERRIDE[id] || id) + '_global.png?t=22.jpg'; }
  function slug(n) { return String(n).toLowerCase().replace(/ /g, '-'); }
  function dateText(ts) { var d = new Date(ts); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function shortDate(ts) { var d = new Date(ts); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function ageText(days) {
    if (days < 1) return 'today';
    if (days < 30) return days + (days === 1 ? ' day' : ' days');
    var m = Math.floor(days / 30);
    return m < 12 ? m + (m === 1 ? ' month' : ' months') : Math.floor(m / 12) + (Math.floor(m / 12) === 1 ? ' year' : ' years');
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  // ---- gear -------------------------------------------------------------------------------------------------------
  // Slot: the supplement's own slot, else the digit in the equipId (100104 -> slot 1), else the array position.
  function equipSlot(eq, idx) {
    var s0 = +eq._slot;
    if (s0 >= 1 && s0 <= 6) return s0 | 0;
    var d = Math.floor((Number(eq.equipId) % 10000) / 100);
    return d >= 1 && d <= 6 ? d : idx + 1;
  }
  // Quality (5 = gold): the piece's own quality (supplement), else the equipId suffix (100104 -> tier 04 -> 5) when the
  // id is in the base-buff table, else the tier of its random-stat template ids (GEAR_TEMPLATE: 1-261 and 1072-1179
  // are gold rolls, 271-1071 are lower qualities). No usable signal = null, which counts as NOT gold.
  function equipQuality(eq) {
    if (eq.quality != null) return +eq.quality || null;
    if (eq.equipId != null && G.EQUIP_BASE_BUFF[eq.equipId]) return (Number(eq.equipId) % 100) + 1;
    var ids = (eq.infos || []).filter(function (i) { return i.type === 1 && i.templateId != null; }).map(function (i) { return Number(i.templateId); });
    if (!ids.length) return null;
    if (ids.some(function (t) { return t >= 271 && t <= 1071; })) return 4;
    if (ids.every(function (t) { return (t >= 1 && t <= 261) || (t >= 1072 && t <= 1179); })) return 5;
    return null;
  }
  // One equipped piece in the shape nextMoves reads. gold: only gold gear is refined or socketed.
  function pieceOf(eq, idx) {
    if (!eq) return null;
    var slot = equipSlot(eq, idx);
    if (slot < 1 || slot > 6) return null;
    var stats = [], rd = null;
    (eq.infos || []).forEach(function (info) {
      if (info.type === 1) {
        var t = G.GEAR_TEMPLATE[info.templateId];
        if (t && t.m) stats.push({ label: t.n, v: +info.buffValue || 0, m: t.m });
      } else if (info.type === 2 && info.templateId) {
        rd = G.resolveRune(info.templateId);
      }
    });
    var q = equipQuality(eq);
    return {
      slot: slot, slotName: G.GEAR_SLOT_NAMES[slot], level: eq.level == null ? null : (+eq.level || 0),
      q: q, gold: q === 5,
      rune: rd ? { name: rd.n, s: rd.s, sm: rd.sm, icon: G.RUNE_ICON[rd.n] || slug(rd.n) } : null,
      stats: stats
    };
  }

  function buildHeroes(merged, core, suppHeroes) {
    var byId = {};
    ((suppHeroes && suppHeroes.list) || []).forEach(function (h) { if (h && h.id != null) byId[h.id] = h; });
    var all = (merged && merged.heroes) || [];
    var fromReports = all.length > 0 && !all.every(function (h) { return h._supplemental; });
    var list = all.filter(function (h) { return (h.heroEquips || []).length > 0 && isFinite(+h.id); }).map(function (h) {
      var pieces = [];
      (h.heroEquips || []).forEach(function (eq, i) { var p = pieceOf(eq, i); if (p) pieces.push(p); });
      pieces.sort(function (a, b) { return a.slot - b.slot; });
      var s = byId[h.id];
      return {
        id: +h.id, name: core.heroName(+h.id), branch: core.heroBranch(+h.id, s && s.t),
        lv: +(h.level || h._level) || 0, star: +(h.star || h._star) || 0, awaken: +h.awakenLevel || 0,
        icon: heroIcon(+h.id),
        score: core.heroGearScore(h), power: (s && isFinite(s.pw) && typeof s.pw === 'number' && s.pw > 0) ? s.pw : null, pieces: pieces,
        gear: pieces.filter(function (p) { return p.gold; }).map(function (p) {
          return { slot: p.slot, slotName: p.slotName, rune: p.rune, stats: p.stats };
        })
      };
    });
    list.sort(function (a, b) { return (b.score - a.score) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return { list: list, source: fromReports ? 'reports' : 'roster', rosterCount: suppHeroes && suppHeroes.list ? suppHeroes.list.length : null };
  }

  // ---- runes ------------------------------------------------------------------------------------------------------
  // The bag comes from the ONE base-pool rule (core.advice.basePool): a hand-entered pool newer than the import feeds it.
  function buildRunes(inv, gear, runepool, statics, core) {
    var cat = statics.runeTypes, out = { runeBag: {}, runeSlots: {}, runeCost: {}, known: false, pool: null };
    if (cat && Array.isArray(cat.runes)) {
      cat.runes.forEach(function (r) { out.runeSlots[r.name] = (r.slots || []).map(function (s) { return s.slot; }); });
      var sched = (cat.mechanics && cat.mechanics.merge_cost_per_star) || {};
      Object.keys(sched).forEach(function (k) { if (/^\d+$/.test(k) && Array.isArray(sched[k])) out.runeCost[k] = sched[k].slice(); });
    }
    var bp = core.advice.basePool({ inv: inv, gear: gear, runepool: runepool, lookups: { item: statics.itemTable } });
    Object.keys(bp.bag).forEach(function (k) { out.runeBag[k] = +bp.bag[k] || 0; });
    out.known = bp.known; out.pool = bp;
    return out;
  }

  // ---- decor ------------------------------------------------------------------------------------------------------
  function buildDecor(merged, inv, statics, core) {
    var L = statics.decorLookups || {};
    var data = L.DECOR_DATA || {}, meLookup = L.ME_LOOKUP || {}, meClusters = L.ME_CLUSTERS || {}, names = L.DECOR_GROUPS || {};
    var levels = statics.decorLevels || null;
    var qByGroup = {};
    (statics.decorIndex || []).forEach(function (e) { if (e && e.group != null && qByGroup[e.group] == null) qByGroup[e.group] = e.quality; });
    var ids = (merged && merged.decorations && merged.decorations.ids) || [];
    var totals = { march: 0, atk: 0, hp: 0, dmgTaken: 0, dmgInc: 0 };
    var groups = {}, pieces = 0, unknown = 0;
    function dataFor(g) { // the page's own lookup order: the group, then its mutual-exclusive cluster mates
      if (data[String(g)]) return data[String(g)];
      var ck = meLookup[String(g)], vars = ck ? meClusters[String(ck)] : null;
      for (var i = 0; vars && i < vars.length; i++) if (data[String(vars[i])]) return data[String(vars[i])];
      return null;
    }
    ids.forEach(function (id) {
      var g = core.decorIdToGroup(id);
      if (g == null) { unknown++; return; }
      pieces++;
      var lv = core.decorLevel(id, g);
      var gr = groups[g] || (groups[g] = { g: g, lv: 0, count: 0 });
      gr.count++;
      if (lv > gr.lv) gr.lv = lv;
      var dd = dataFor(g);
      (dd ? dd.b : []).forEach(function (b) {
        var key = TOTAL_IDS[String(b.i)];
        if (!key) return;
        var v = core.scaledBuffVal({ v: b.v, t: b.t }, lv, g);
        totals[key] += b.t === 1 ? v : v / 100;
      });
    });
    Object.keys(totals).forEach(function (k) { totals[k] = k === 'march' ? Math.round(totals[k]) : round1(totals[k]); });
    var shards = inv ? core._adv_calcAvailableShards(inv).universal : 0;
    var placed = Object.keys(groups).map(function (k) {
      var gr = groups[k], name = names[k] || ('Decoration ' + k), entry = levels && levels[k];
      var nx = null;
      if (entry && entry.fi === G.ADVISOR_UNIVERSAL_SHARD_ID) {
        var up = core._adv_getNextUpgrade(gr.g, gr.lv, levels);
        if (up && up.shardCost > 0) nx = { to: up.toLevel, raw: up.shardCost, credit: inv ? core._adv_calcGroupSpecificShards(gr.g, inv, levels) : 0, dl: up.buffDeltas };
      }
      var mx = 0;
      ((entry && entry.levels) || []).forEach(function (l) { if (l.l > mx) mx = l.l; });
      return {
        g: gr.g, n: name, q: qByGroup[gr.g] || 0, lv: gr.lv, mx: mx, count: gr.count,
        ic: gr.g + '_' + name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_') + '.png', nx: nx
      };
    });
    placed.sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; });
    var bag = { kinds: 0, pieces: 0 };
    if (inv && inv.tabs && Array.isArray(inv.tabs.decor)) {
      bag.kinds = inv.tabs.decor.length;
      inv.tabs.decor.forEach(function (d) { bag.pieces += core._adv_invAmount(d); });
    }
    return {
      shards: shards, known: !!inv, placed: placed, totals: totals, placedPieces: pieces, placedKinds: placed.length,
      bag: bag, sets: ((merged && merged.decorations && merged.decorations.suit) || []).length, unresolved: unknown
    };
  }

  // ---- beasts -----------------------------------------------------------------------------------------------------
  function buildBeasts(merged, core, suppEnigma) {
    if (!merged || !merged.enigmas) return null;
    var r = core.ebResolveBeasts(merged.enigmas);
    var deployed = 0, fields = 0, pot = 0, potMax = 0;
    r.fields.forEach(function (f) {
      if (f.deployedCount > 0) fields++;
      f.slots.forEach(function (s) { if (s.beast) { deployed++; pot += s.beast.potential || 0; potMax += s.beast.maxPotential || 0; } });
    });
    // owned (bench included) is only known from the game data: a battle report carries the deployed beasts alone
  var collected = suppEnigma && Array.isArray(suppEnigma.beasts) ? suppEnigma.beasts.length : null;
  var fieldList = r.fields.map(function (f) {
    return {
      name: String(f.name).replace(/[<>"'&]/g, ''), deployed: +f.deployedCount || 0,
      beasts: f.slots.filter(function (s) { return s.beast; }).map(function (s) {
        var b = s.beast, base = String(G.EB_ICON_NAMES[b.type] || G.EB_TYPES[b.type] || 'Unknown');
        return { name: String(b.name).replace(/[<>"'&]/g, ''), icon: (base + '_' + String(b.element) + '_' + (+b.star >= 5 ? 'evolved' : 'base') + '.png').replace(/[^A-Za-z0-9_. -]/g, ''), lv: +b.level || 0 };
      })
    };
  });
  return { deployed: deployed, fields: fields, collected: collected, fieldList: fieldList, avgPotential: potMax ? Math.round((pot / potMax) * 100) : null };
  }

  // ---- HT chips ---------------------------------------------------------------------------------------------------
  function buildHt(merged, supp, reports, reportMechaIds, core) {
    var chipsSupp = supp.chips || null;
    var chipsTs = chipsSupp && chipsSupp.ts ? new Date(chipsSupp.ts).getTime() : 0;
    var perMecha = core._ar_perEntityReportTs(reports || [], 'mechas', 'mechaId');
    var mechas = core._ar_overlayMechasWithChips((merged && merged.mechas) || [], perMecha, chipsSupp, chipsTs)
      .filter(function (m) { return m && m.mechaId !== 1008 && m.chips && m.chips.length; });
    var chips = [], filled = 0;
    mechas.forEach(function (m) {
      var mid = +m.mechaId || 0, name = G.MECHA_NAMES[mid] || ('HT ' + mid), seen = {};
      m.chips.forEach(function (c) {
        var row = G.CL[c.chipId];
        if (!row) return;
        var core_ = !!row[6], slot = core_ ? 0 : row[1];
        seen[core_ ? 'core' : slot] = 1; filled++;
        var o = { ht: name, mecha: mid, slot: slot, core: core_, lv: +c.level || 0, empty: false, c: +c.chipId };
        var icon = G.SET_ICONS[row[0]];
        if (icon) o.ic = icon.replace(/\.png$/, '');
        chips.push(o);
      });
      for (var s = 1; s <= 6; s++) if (!seen[s]) chips.push({ ht: name, mecha: mid, slot: s, core: false, lv: 0, empty: true });
    });
    return {
      count: mechas.length, chipsFilled: filled, chipsMax: mechas.length * 7, chips: chips,
      reportMechas: reportMechaIds == null ? null : reportMechaIds.slice(), source: mechas.some(function (m) { return m._source === 'supp'; }) ? 'game data' : 'battle reports'
    };
  }

  // ---- header + freshness -----------------------------------------------------------------------------------------
  function buildHeader(opts, sources, now) {
    var p = opts.player || {}, ro = opts.rosterEntry || null;
    function line(ts) {
      if (!ts) return null;
      var days = Math.max(0, Math.floor((now - ts) / DAY));
      return { ts: ts, date: dateText(ts), short: shortDate(ts), ageDays: days, age: ageText(days), warn: days > STALE_DAYS };
    }
    var reports = line(sources.reportsTs), data = line(sources.dataTs);
    var text = [];
    if (reports) text.push('Reports ' + reports.date);
    if (data) text.push('Game data ' + data.date + (data.ageDays >= 1 ? ' (' + data.age + ')' : ''));
    else text.push('No game data imported');
    var power = ro && typeof ro.power === 'number' ? ro.power : null;
    return {
      name: p.name || null, avatar: p.avatar || null, siteKey: p.siteKey || null,
      alliance: ro ? ro.alliance || null : null, inRoster: !!ro,
      power: power, powerText: power ? round1(power / 1e6) + 'M' : null,
      shared: !!opts.readOnly && !(opts.identity && opts.identity.isOwn), readOnly: !!opts.readOnly,
      reports: reports, data: data, freshness: text.join(' · '),
      title: opts.readOnly && !(opts.identity && opts.identity.isOwn) ? (p.name || 'Player') + "'s armory · shared with you · read-only" : (p.name || 'Armory')
    };
  }

  // ---- the model --------------------------------------------------------------------------------------------------
  function buildViewModel(merged, sources, opts) {
    opts = opts || {};
    sources = sources || { reportsTs: 0, dataTs: 0, kinds: [] };
    var core = opts.core || CoreLib;
    var statics = opts.statics || {};
    var supp = opts.supp || {};
    var priv = opts.privacy || {};
    var now = opts.now || Date.now();
    var inv = priv.inv ? null : (supp.inv || null);

    var heroes = buildHeroes(merged, core, supp.heroes);
    var runes = buildRunes(inv, priv.gear ? null : supp.gear, priv.runepool ? null : supp.runepool, statics, core);
    var decor = buildDecor(merged, inv, statics, core);
    var beasts = buildBeasts(merged, core, priv.enigma ? null : supp.enigma);
    var ht = buildHt(merged, supp, opts.reports, opts.reportMechaIds, core);
    var header = buildHeader(opts, sources, now);

    var movesInput = {
      asOf: dateText(now),
      heroes: heroes.list.map(function (h) { return { name: h.name, gear: h.gear, power: h.power }; }),
      runeBag: runes.runeBag, runeSlots: runes.runeSlots, runeCost: runes.runeCost,
      decor: { shards: decor.shards, placed: decor.placed }, ht: { chips: ht.chips, reportMechas: ht.reportMechas },
      beastMoves: [] // the Optimizer (boOptimize) is a phase 3 module; its first move joins here once it is extracted
    };
    var mv = core.nextMoves(movesInput, { max: 3 });
    var stale = sources.dataTs && (now - sources.dataTs) / DAY > STALE_DAYS ? { ts: sources.dataTs, since: shortDate(sources.dataTs) } : null;
    var moves = {
      title: header.shared ? (header.name || 'Player') + "'s next moves" : 'Next moves',
      picks: mv.picks.map(function (p) { return { text: p.text, full: p.full, parts: p.fparts, meta: p.meta, pill: p.pill, cls: p.cls, sig: p.sig, route: p.route, ico: p.ico || null }; }),
      stale: stale, cta: !sources.dataTs ? 'import' : null,
      footer: stale ? 'Based on game data from ' + stale.since : (!sources.dataTs ? 'Import game data to see rune, decor and beast moves' : null)
    };

    var totalScore = 0;
    heroes.list.forEach(function (h) { totalScore += h.score; });
    var rs = core.moves.runeStats(movesInput.heroes);
    var band = {
      gear: { score: totalScore, max: GEAR_MAX * heroes.list.length, heroes: heroes.list.length, source: heroes.source === 'reports' ? 'in battle reports' : 'in roster' },
      runes: { pct: rs.pct, equipped: rs.equipped, source: 'equipped' },
      beasts: beasts ? { pct: beasts.avgPotential, deployed: beasts.deployed, source: 'deployed' } : null
    };
    var summaries = {
      heroes: { battle: heroes.list.length, roster: heroes.rosterCount, source: heroes.source },
      base: { placedPieces: decor.placedPieces, placedKinds: decor.placedKinds, march: decor.totals.march, atk: decor.totals.atk, hp: decor.totals.hp, dmgTaken: decor.totals.dmgTaken, dmgInc: decor.totals.dmgInc, sets: decor.sets },
      beasts: beasts,
      ht: { count: ht.count, chipsFilled: ht.chipsFilled, chipsMax: ht.chipsMax }
    };
    return {
      header: header, band: band, moves: moves, summaries: summaries,
      heroes: heroes, runes: runes, decor: decor, beasts: beasts, ht: ht,
      movesInput: movesInput, sources: sources, kinds: (sources.kinds || []).slice()
    };
  }

  // A loadArmory result -> the opts buildViewModel wants.
  function fromLoad(res, core) {
    return {
      core: core, supp: res.supp, privacy: res.privacy, statics: res.statics, player: res.player, rosterEntry: res.rosterEntry,
      reports: res.reports, reportMechaIds: res.reports && res.reports.length ? res.reportMechaIds : null,
      readOnly: res.readOnly, identity: res.identity
    };
  }

  var api = { heroIcon: heroIcon, buildViewModel: buildViewModel, fromLoad: fromLoad, equipSlot: equipSlot, equipQuality: equipQuality, TOTAL_IDS: TOTAL_IDS };
  window.ArmoryVM = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
