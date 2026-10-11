/* armory-bag.js: the Bag (inventory) screen of the Armory v2 page (phase 3), loaded the first time #bag opens.
 * One view with the game's five bag tabs (Items, Units, Decor, Heroes, Strengthen), a resources list, search, filter and sort, a paged
 * grid, and an item sheet without developer fields. Same-origin script, no CSP change. Everything from the worker, a supplement or a
 * game table is coerced to a number or goes through esc / nd; icon file names are checked before they reach an <img src>.
 * The data rules sit in ArmoryBagLogic (no DOM, node-testable). The classifier, the gem / Odinium / VIT parsers and the rehydrate step are
 * copied VERBATIM from pages/armory-report.html (the classic Inventory tab); test/armory-bag.test.js runs the page's own functions and
 * these copies on the same fixture and requires the same source text. ArmoryBag(H) is the view.
 */
(function (root) {
'use strict';

/* ---------- logic (no DOM) ---------- */
var has = Object.prototype.hasOwnProperty;
var RAW_ICON = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/', GAME_ICON = 'https://h5.topwargame.com/DynRes/images/';
function num(v) { v = +v; return isFinite(v) ? v : 0; }
var TIERS = [[1e33, 'gg'], [1e30, 'ff'], [1e27, 'ee'], [1e24, 'dd'], [1e21, 'cc'], [1e18, 'bb'], [1e15, 'aa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function trimZ(s) { return s.replace(/\.?0+$/, ''); }
function withCommas(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
/* the game's way of writing a big number: K, M, B, T, then aa, bb, cc, dd, ee, ff, gg (CLAUDE.md "Number formatting") */
function suffixed(n, digits) {
  n = num(n); var a = Math.abs(n);
  if (a >= 1e36) return n.toExponential(2).replace(/\.?0+e/, 'e').replace('e+', 'e'); /* past gg the game's letters stop: 1.23e45 */
  for (var i = 0; i < TIERS.length; i++) if (a >= TIERS[i][0]) return trimZ((n / TIERS[i][0]).toFixed(digits == null ? 2 : digits)) + TIERS[i][1];
  return withCommas(n);
}
/* a figure in a list row: every digit up to a quadrillion, the game's letters beyond (a double that big has no exact digits anyway) */
function fmtBig(n) { n = num(n); return Math.abs(n) < 1e15 ? withCommas(n) : suffixed(n, 2); }
/* a figure in a grid cell: every digit under a million, letters from there */
function fmtCell(n) { n = num(n); return Math.abs(n) < 1e6 ? withCommas(n) : suffixed(n, 1); }
/* "4 months old" (ts: ISO string or ms); '' for nothing, the future or garbage */
function ageOld(ts, now) {
  if (!ts) return '';
  var ms = (now == null ? Date.now() : now) - (typeof ts === 'string' ? new Date(ts) : new Date(+ts)).getTime();
  if (isNaN(ms) || ms < 0) return '';
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  function u(n, w) { return n + ' ' + w + (n === 1 ? '' : 's') + ' old'; }
  var m = Math.floor(sec / 60); if (m < 60) return u(m, 'minute');
  var h = Math.floor(m / 60); if (h < 24) return u(h, 'hour');
  var d = Math.floor(h / 24); if (d < 30) return u(d, 'day');
  var mo = Math.floor(d / 30); if (mo < 12) return u(mo, 'month');
  return u(Math.floor(mo / 12), 'year');
}
/* the icon of a rehydrated entry as one URL, or '' (the file name has no slash; the folder is one of the two the classic page uses) */
function iconUrl(it) {
  if (!it || typeof it.icon !== 'string' || !/^[A-Za-z0-9_.\-]+$/.test(it.icon) || /^\.+$/.test(it.icon)) return '';
  var dir = String(it.iconDir || '');
  if (dir.indexOf(RAW_ICON) !== 0 && dir.indexOf(GAME_ICON) !== 0) return '';
  if (/\.\./.test(dir) || /[^A-Za-z0-9_.\-\/:]/.test(dir)) return '';
  return dir + '/' + it.icon;
}

var TABS = [['item', 'Items'], ['unit', 'Units'], ['decor', 'Decor'], ['hero', 'Heroes'], ['cpnt', 'Strengthen']];
function tabKnown(t) { return TABS.some(function (x) { return x[0] === t; }); }

/* the lookups and tables the classic page reads as globals arrive here: env = { RUNE_ICON, DECOR_SUIT_GROUPS, DECOR_SUITS } */
function create(env) {
  env = env || {};
  var RUNE_ICON = env.RUNE_ICON, DECOR_SUIT_GROUPS = env.DECOR_SUIT_GROUPS, DECOR_SUITS = env.DECOR_SUITS;
  function _ar_reportMissingLookup() {} /* classic files a report with the worker; v2 writes nothing */

/* ---- verbatim from armory-report.html (parity: test/armory-bag.test.js) ---- */
  function _ar_sanitizeName(n) {
    return String(n || '').replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_');
  }

  function _ar_resolveItemIcon(i) {
    if (!i) return null;
    if (i.startsWith('image/')) {
      var s = i.slice(6).replace(/\//g, '__');
      if (!s.endsWith('.png')) s += '.png';
      return { file: 'image__' + s, dirSuffix: 'inventory-icons' };
    }
    if (i.startsWith('res:items/')) {
      // res:items/* resolves to the public game CDN. Auction-icons folder
      // doesn't carry these files (only the auction page extracted a subset);
      // the DynRes URL works for every res:items entry observed so far.
      var fn = i.slice('res:items/'.length);
      if (!fn.endsWith('.png')) fn += '.png';
      return { file: fn, dirSuffix: 'auction-icons', absDir: 'https://h5.topwargame.com/DynRes/images/items' };
    }
    return null;
  }

  function _ar_heroSubtab(type) {
    if (type === 31) return 'shards';
    if (type === 32 || type === 42 || type === 46) return 'skills';
    return 'shards';
  }

  var _AR_BUCKET_ORDER = [
    'skill_universal', // 1 — Exclusive Skill Shards / Universal Decor Shard / Remould (+ chests)
    'titan',           // 2 — Titan Gear
    'ht_chip',         // 3 — Raw HT chips + chip chests
    'enigma',          // 4 — Enigma + Beast + Repeater
    'gem',             // 5 — Gem packs (aggregate)
    'formation',       // 6 — Shark / Scorpion / Eagle holograms / resonators / shards
    'units',           // 7 — Unit Choice Chests + Airdrop Support
    'chest',           // 8 — Other Choice / Random Chests
    'speedup',         // 9 — Speed-ups (march/repair/shield/training/tech)
    'combat_buff',     // 10 — Combat consumables (oil/energy/coating/traps/raw % buffs)
    'resource',        // 11 — Odinium / Food / Oil raw packs (aggregate per resource)
    'other'            // 12 — Everything else
  ];

  var _AR_BUCKET_INDEX = (function() { var m = {}; _AR_BUCKET_ORDER.forEach(function(k,i){m[k]=i;}); return m; })();

  function _ar_isSpeedup(cfg) {
    var t = cfg.t;
    if (t === 28 || t === 12 || t === 11 || t === 5 || t === 79 || t === 65 || t === 111 || t === 89 || t === 110) return true;
    return false;
  }

  function _ar_isHTChip(cfg) {
    if (cfg.t === 128) return true;
    var n = String(cfg.n || '').toLowerCase();
    var d = String(cfg.d || '').toLowerCase();
    if (/heavy trooper/.test(d) && /\bchip\b/.test(n)) return true;
    if (/(amazing|epic|legendary|advanced|premium|core|sub).*chip\b/.test(n) && /heavy trooper|mecha/.test(d)) return true;
    if (/\bmecha chip\b/.test(n)) return true;
    return false;
  }

  function _ar_isFormation(cfg) {
    var n = String(cfg.n || '').toLowerCase();
    if (/\b(shark|scorpion|eagle)\b/.test(n) && /(hologram|resonator|shard|teeth|fang|specialization)/.test(n)) return true;
    return false;
  }

  function _ar_isEnigma(cfg) {
    var n = String(cfg.n || '').toLowerCase();
    var d = String(cfg.d || '').toLowerCase();
    if (/\benigma\b/.test(n) || /\benigma\b/.test(d)) return true;
    if (/\bbeast\b/.test(n) && /(crystal|spawn|shard|chest|certificate|barrier|relic|repeater|bait|bounty)/.test(n + ' ' + d)) return true;
    if (/\brepeater\b/.test(n)) return true;
    return false;
  }

  var _AR_SKILL_UNIVERSAL_IDS = {
    20213231: 1, // Universal Exclusive Skill Shard
    20213232: 1, // Universal Decor Shard
    10000074: 1, // Toolkit for Skills (gift box, lower priority but related)
    260119001: 1 // Supreme Crystal (universal Supreme Deco upgrade material)
  };

  function _ar_isSkillOrUniversal(cfg, id) {
    if (id != null && _AR_SKILL_UNIVERSAL_IDS[id]) return true;
    var n = String(cfg.n || '');
    var nl = n.toLowerCase();
    var dl = String(cfg.d || '').toLowerCase();
    // Exclusive skill shards (t46 with "skill shard" in name)
    if (cfg.t === 46 && /skill shard/i.test(n)) return true;
    // Universal Decor Shard / Universal Exclusive Skill Shard (raw + boxes)
    if (/universal (decor|exclusive skill) shard/.test(nl)) return true;
    if (/universal (decor|exclusive skill) shard/.test(dl) && /(box|chest|bag|lucky)/.test(nl)) return true;
    // Remould Blueprint + chests
    if (/remould blueprint|remold blueprint/.test(nl)) return true;
    if (/remould blueprint/.test(dl) && /(box|chest|bag)/.test(nl)) return true;
    // Skill shard chests / lucky boxes — match name OR desc
    if (/skill shard/.test(nl) && /(box|chest|bag|lucky)/.test(nl)) return true;
    if (/skill shard/.test(dl) && /(box|chest|bag|lucky)/.test(nl)) return true;
    // Decor shard lucky boxes (catch "Decor Shard Lucky Chest")
    if (/decor shard/.test(nl) && /(box|chest|bag|lucky)/.test(nl)) return true;
    // Supreme Crystal / Supreme Deco upgrade materials
    if (/supreme crystal/.test(nl) || /supreme deco/.test(dl)) return true;
    return false;
  }

  function _ar_isCombatBuff(cfg) {
    var t = cfg.t;
    if (t === 72 || t === 73 || t === 75 || t === 50) return true;
    return false;
  }

  function _ar_isChoiceChest(cfg) {
    var t = cfg.t;
    if (t === 100 || t === 67 || t === 56 || t === 4035 || t === 90) return true;
    return false;
  }

  var _AR_UNIT_CHOICE_IDS = { 55200002: 1 };

  function _ar_isUnitChoice(cfg, id) {
    if (id != null && _AR_UNIT_CHOICE_IDS[id]) return true;
    var n = String(cfg.n || '').toLowerCase();
    if (/unit choice|unit \+\d|optional unit \+\d|choice unit \+\d/.test(n)) return true;
    if (/^airdrop support/.test(n)) return true;
    return false;
  }

  function _ar_resourceKind(cfg) {
    if (cfg.g === 1000000) return 'gem';
    if (cfg.t === 27 && cfg.g === 910000) return 'food';
    if (cfg.t === 25 && cfg.g === 920000) return 'oil';
    if (cfg.t === 106 && cfg.g === 940001) return 'odinium';
    return null;
  }

  function _ar_parseSuffixed(s) {
    if (s == null) return 0;
    var str = String(s).trim();
    if (!str) return 0;
    var m = str.match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?$/i);
    if (!m) {
      // Fallback: first numeric-with-suffix anywhere
      m = str.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?/i);
      if (!m) return 0;
    }
    var num = parseFloat(m[1].replace(/,/g, ''));
    var suf = (m[2] || '').toUpperCase();
    if (suf === 'K') num *= 1000;
    else if (suf === 'M') num *= 1000000;
    else if (suf === 'B') num *= 1000000000;
    return Math.round(num) || 0;
  }

  function _ar_packQuantity(cfg) {
    if (!cfg) return 0;
    if (cfg.ix != null && cfg.ix !== '') {
      var v = _ar_parseSuffixed(cfg.ix);
      if (v > 0) return v;
    }
    var n = String(cfg.n || '');
    if (/itemName\d+/i.test(n)) return 0;
    return _ar_parseSuffixed(n);
  }

  function _ar_compactNumber(n) {
    if (n == null || isNaN(n)) return '0';
    n = Number(n);
    if (n < 1000) return n.toLocaleString();
    var units = [['B',1e9],['M',1e6],['K',1e3]];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][1]) {
        var v = n / units[i][1];
        var rounded = (v >= 100) ? Math.round(v) : Math.round(v * 10) / 10;
        var s = rounded.toString();
        return s + units[i][0];
      }
    }
    return n.toLocaleString();
  }

  function _ar_classifyItemBucket(cfg, id) {
    if (!cfg || cfg.t == null) return 'other';
    if (_ar_isSkillOrUniversal(cfg, id)) return 'skill_universal';
    if (_ar_classifyTitanGear(cfg)) return 'titan';
    if (_ar_isHTChip(cfg)) return 'ht_chip';
    if (_ar_isEnigma(cfg)) return 'enigma';
    if (_ar_resourceKind(cfg) === 'gem') return 'gem';
    if (_ar_isFormation(cfg)) return 'formation';
    if (_ar_isUnitChoice(cfg, id)) return 'units';
    if (_ar_isChoiceChest(cfg)) return 'chest';
    if (_ar_isSpeedup(cfg)) return 'speedup';
    if (_ar_isCombatBuff(cfg)) return 'combat_buff';
    var rk = _ar_resourceKind(cfg);
    if (rk) return 'resource';
    return 'other';
  }

  function _ar_classifyTitanGear(cfg) {
    if (!cfg) return null;
    var t = cfg.t;
    if (t === 153) return 'rune';
    if (t === 140) return 'material';
    if (t === 142) return 'catalyst';
    if (t === 141) return 'blueprint';
    if (t === 148) return 'booster';
    if (t === 211) return 'gearchest';
    var n = String(cfg.n || '');
    if (/^Titan Gear (Random Material|Material Choice)/i.test(n)) return 'material';
    if (/^Beginner Titan Gear Random Material/i.test(n)) return 'material';
    if (/^Titan Rune (Choice|Random) Chest/i.test(n)) return 'rune';
    return null;
  }

  function _ar_boxedGemsPerOpen(cfg) {
    if (!cfg || cfg.g === 1000000) return 0;
    var d = String(cfg.d || '');
    if (!/gem/i.test(d)) return 0;
    var max = 0;
    var patterns = [
      /(\d{1,3}(?:,\d{3})+|\d+)\s*Gems?\b/gi,
      /\bGems?\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+)/gi
    ];
    for (var i = 0; i < patterns.length; i++) {
      var re = patterns[i];
      var m;
      while ((m = re.exec(d)) !== null) {
        var v = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(v) && v > max) max = v;
      }
    }
    return max;
  }

  function _ar_boxedOdiniumPerOpen(cfg) {
    if (!cfg) return 0;
    if (cfg.t === 106 && cfg.g === 940001) return 0;
    var d = String(cfg.d || '');
    if (!/odinium/i.test(d)) return 0;
    // Negative lookahead skips "Odinium Chip(s)" / "Odinium Tech" / similar
    // — those are unrelated items, not the Odinium currency.
    // Three observed shapes:
    //   "100 Odinium x7"             — amount before, multiplier after
    //   "Odinium (1k) x2"            — paren amount, multiplier after
    //   "Odinium x2000"              — only multiplier, treated as absolute
    var re = /(?:(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?\s+)?Odinium(?!\s*(?:Chip|Tech))(?:\s*\((\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?\))?(?:\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?)?/gi;
    function applySuffix(n, suf) {
      var s = (suf || '').toUpperCase();
      if (s === 'K') return n * 1000;
      if (s === 'M') return n * 1000000;
      if (s === 'B') return n * 1000000000;
      return n;
    }
    var max = 0;
    var m;
    while ((m = re.exec(d)) !== null) {
      var amount = 0;
      if (m[1]) {
        amount = applySuffix(parseFloat(m[1].replace(/,/g, '')), m[2]);
        if (m[5]) amount *= applySuffix(parseFloat(m[5].replace(/,/g, '')), m[6]);
      } else if (m[3]) {
        amount = applySuffix(parseFloat(m[3].replace(/,/g, '')), m[4]);
        if (m[5]) amount *= applySuffix(parseFloat(m[5].replace(/,/g, '')), m[6]);
      } else if (m[5]) {
        // Lone "Odinium xN" — N is the absolute amount, not a multiplier.
        amount = applySuffix(parseFloat(m[5].replace(/,/g, '')), m[6]);
      } else {
        continue;
      }
      var v = Math.round(amount);
      if (!isNaN(v) && v > max) max = v;
    }
    return max;
  }

  function _ar_vitYieldFromCfg(cfg) {
    if (!cfg) return 0;
    var n = String(cfg.n || '');
    var d = String(cfg.d || '');
    if (/\b(invitation|invite)/i.test(n)) return 0;
    var nameHasVit = /\bVIT\b/i.test(n);
    var m;
    m = n.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*VIT\b/i);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    if (nameHasVit) {
      m = d.match(/VIT\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+)/i);
      if (m) return parseInt(m[1].replace(/,/g, ''), 10);
      m = d.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*VIT\b/i);
      if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    }
    if (!nameHasVit) {
      m = d.match(/\b(?:gain|restore|get|grants?|gives?)\s+(\d{1,3}(?:,\d{3})+|\d+)\s*VIT\b/i);
      if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    }
    return 0;
  }

  function _ar_boxedVitPerOpen(cfg) {
    if (!cfg) return 0;
    var n = String(cfg.n || '');
    var d = String(cfg.d || '');
    if (/\b(invitation|invite)/i.test(n) || /\b(invitation|invite)/i.test(d)) return 0;
    if (/\bVIT\b/i.test(n)) return 0;
    if (!/\bVIT\b/i.test(d)) return 0;
    var max = 0;
    var re = /(\d{1,3}(?:,\d{3})+|\d+)\s*VIT\b/gi;
    var m;
    while ((m = re.exec(d)) !== null) {
      var v = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(v) && v > max) max = v;
    }
    return max;
  }

  function _ar_gemValueFromCfg(cfg) {
    if (!cfg || cfg.g !== 1000000) return 0;
    if (cfg.ix != null && cfg.ix !== '') {
      var n = parseInt(String(cfg.ix).replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) return n;
    }
    var name = String(cfg.n || '');
    if (/itemName\d+/i.test(name)) return 0; // unlocalized — skip
    var m = name.match(/(\d{1,3}(?:,\d{3})+|\d+)/);
    if (!m) return 0;
    var v = parseInt(m[1].replace(/,/g, ''), 10);
    return (!isNaN(v) && v > 0) ? v : 0;
  }

  function _ar_rehydrateInv(raw, lk) {
    var ASSET = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/';
    var out = {
      meta: raw.meta || {}, resources: raw.resources || {},
      tabs: { item: [], unit: [], decor: [], hero: [], cpnt: [] },
      gemTotal: 0,
      // Gems hidden inside non-pack boxes (parsed from desc). Counts the
      // best-case branch since "ONE of the following" boxes let the player
      // pick. Tracked separately so the top bar can show direct vs. boxed.
      boxedGemTotal: 0,
      boxedGemDetails: [],
      // Same pattern for Odinium hidden inside non-pack boxes.
      boxedOdiniumTotal: 0,
      boxedOdiniumDetails: [],
      // VIT (Vitality) totals — direct yield from named items + boxed yield
      // from non-VIT-named chests.
      vitTotal: 0,
      vitDetails: [],
      boxedVitTotal: 0,
      boxedVitDetails: [],
      // Aggregate-bucket detail: every contributing pack rolled into the
      // synthetic gem/odinium/food/oil cells. Drives the click-modal.
      aggDetails: { gem: [], odinium: [], food: [], oil: [] },
      aggTotals:  { gem: 0,  odinium: 0,  food: 0,  oil: 0 }
    };
    var tabs = raw.tabs || {};
    ['item', 'cpnt'].forEach(function(tabKey) {
      (tabs[tabKey] || []).forEach(function(it) {
        var cfgRaw = lk.item[String(it.id)];
        var cfg = cfgRaw || {};
        // Silent-fallback detection: data/item-table.json has no row for
        // this id. The cell will render "#<id>" with no icon. Queue the id
        // to KV so the next extraction pass can pull it from the live game
        // (TableManager + LocalManager.getText) and patch item-table.json.
        if (!cfgRaw) {
          _ar_reportMissingLookup('item', it.id, 'armory-report/inventory/' + tabKey, {
            tab: tabKey, level: it.l || null, group: it.g || null, amount: it.a || 0
          });
        }
        var icoInfo = _ar_resolveItemIcon(cfg.i);
        // Type 153 = unequipped Titan rune. Inventory atlas doesn't include
        // them — redirect to the existing assets/rune-icons/ files keyed by
        // rune name. Strip the trailing " Rune" / " Rune Shard" suffix to
        // match RUNE_ICON keys ("All-Out Surge Rune" → "All-Out Surge").
        if (tabKey === 'item' && cfg.t === 153) {
          var rname = String(cfg.n || '').replace(/\s*Rune(\s+Shard)?\s*$/i, '').trim();
          var rfn = (typeof RUNE_ICON !== 'undefined') ? RUNE_ICON[rname] : null;
          if (rfn) {
            icoInfo = { file: rfn + '.png', dirSuffix: 'rune-icons' };
          }
        }
        // Type 31 = hero shard. Skip the missing inventory atlas image and
        // redirect to the public hero portrait CDN. cfg.i carries the hero id
        // as "image/hero_icon/hero_icon{N}" which maps 1:1 to the global
        // headpic URL pattern.
        var iconAbsUrl = null;
        if (tabKey === 'item' && cfg.t === 31) {
          var hm = String(cfg.i || '').match(/hero_icon(\d+)/i);
          if (hm) {
            iconAbsUrl = 'https://h5.topwargame.com/DynRes/images/headpic/hero_icon' + hm[1] + '_global.png';
            icoInfo = { file: 'hero_icon' + hm[1] + '_global.png', dirSuffix: null };
          }
        }
        var amount = it.a || 0;
        // Sum gem packs from the item tab into a running total. Player-
        // facing chests labeled "20 Gems", "Gem x5,000" etc. all live in
        // group 1000000; the table's `ix` field carries the per-pack value
        // for ~83% of them and the rest fall back to a name-parse.
        if (tabKey === 'item' && cfg.g === 1000000 && amount > 0) {
          var gemsPer = _ar_gemValueFromCfg(cfg);
          if (gemsPer > 0) {
            out.gemTotal += gemsPer * amount;
            out.aggTotals.gem += gemsPer * amount;
            out.aggDetails.gem.push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perPack: gemsPer, total: gemsPer * amount });
          }
        }
        // Raw resource aggregates (Odinium/Food/Oil). Pack items have a
        // parseable per-pack value ("1K Odinium", "Food 500K"); raw-currency
        // entries (51000000 "Odinium" with no number in name) yield 0 from
        // the parser — fall back to per=1 so amount counts directly.
        if (tabKey === 'item' && amount > 0) {
          var rk = _ar_resourceKind(cfg);
          if (rk && rk !== 'gem') {
            var per = _ar_packQuantity(cfg) || 1;
            out.aggTotals[rk] += per * amount;
            out.aggDetails[rk].push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perPack: per, total: per * amount });
          }
        }
        // Boxed gems (gems hidden inside non-pack boxes — "ONE of the following: 100 Gems x1, ...")
        var boxed = 0;
        if (tabKey === 'item' && amount > 0) {
          boxed = _ar_boxedGemsPerOpen(cfg);
          if (boxed > 0) {
            out.boxedGemTotal += boxed * amount;
            out.boxedGemDetails.push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perOpen: boxed, total: boxed * amount });
          }
        }
        // Boxed Odinium (Odinium hidden inside non-pack boxes — "1M Odinium x1" etc.)
        if (tabKey === 'item' && amount > 0) {
          var boxedO = _ar_boxedOdiniumPerOpen(cfg);
          if (boxedO > 0) {
            out.boxedOdiniumTotal += boxedO * amount;
            out.boxedOdiniumDetails.push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perOpen: boxedO, total: boxedO * amount });
          }
        }
        // VIT (Vitality) — direct yield from VIT-named items + per-flower
        // VIT items (Virtuous Flower / Loving Heart). Falls through to the
        // boxed branch when name lacks VIT but desc still mentions it.
        if (tabKey === 'item' && amount > 0) {
          var vitPer = _ar_vitYieldFromCfg(cfg);
          if (vitPer > 0) {
            out.vitTotal += vitPer * amount;
            out.vitDetails.push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perPack: vitPer, total: vitPer * amount });
          } else {
            var boxedV = _ar_boxedVitPerOpen(cfg);
            if (boxedV > 0) {
              out.boxedVitTotal += boxedV * amount;
              out.boxedVitDetails.push({ id: it.id, name: cfg.n || ('#'+it.id), amount: amount, perOpen: boxedV, total: boxedV * amount });
            }
          }
        }
        var titanCat = (tabKey === 'item') ? _ar_classifyTitanGear(cfg) : null;
        var bucket = tabKey === 'item' ? _ar_classifyItemBucket(cfg, it.id) : null;
        out.tabs[tabKey].push({
          id: it.id, amount: amount, level: it.l || null, group: it.g || cfg.g || it.id,
          type: cfg.t, quality: cfg.q || 1, name: cfg.n || ('#' + it.id), desc: cfg.d || '',
          icon: icoInfo ? icoInfo.file : null,
          // Resolution priority for iconDir:
          //   1. iconAbsUrl (hero shards) — strip filename, reuse the URL stem
          //   2. icoInfo.absDir (res:items routed to game CDN)
          //   3. ASSET + dirSuffix (default — standard repo asset folder)
          iconDir: iconAbsUrl
            ? iconAbsUrl.replace(/\/[^\/]*$/, '')
            : (icoInfo && icoInfo.absDir)
              ? icoInfo.absDir
              : ASSET + (icoInfo ? icoInfo.dirSuffix : 'inventory-icons'),
          subtab: tabKey === 'item' ? (titanCat ? 'titan' : 'all') : undefined,
          titanCat: titanCat,
          bucket: bucket,
          boxedGems: boxed
        });
      });
    });
    (tabs.unit || []).forEach(function(it) {
      var cfgRaw = lk.army[String(it.id)];
      var itemCfgRaw = lk.item[String(it.id)];
      var cfg = cfgRaw || {};
      var itemCfg = itemCfgRaw || {};
      // Silent-fallback detection: army-icon-map.json doesn't know this
      // unit id. Cell falls back to "Unit #<id>" with no icon. Patch path
      // is to rerun the army-icon extraction pass after the game adds the
      // unit prefab and re-publish army-icon-map.json + the icon PNG.
      if (!cfgRaw) {
        _ar_reportMissingLookup('army', it.id, 'armory-report/inventory/unit', {
          tab: 'unit', level: it.l || null, group: it.g || null, amount: it.a || 0
        });
      }
      // Unit display names from the game are Chinese-derived asset keys (e.g.
      // "army_baseV6_name04") and don't translate cleanly. Show level only.
      var lv = cfg.level || it.l;
      var displayName = lv ? ('Lv ' + lv) : ('Unit #' + it.id);
      out.tabs.unit.push({
        id: it.id, amount: it.a || 0, level: it.l || cfg.level || null, group: it.g || it.id,
        type: cfg.type, quality: itemCfg.q || 1, name: displayName,
        desc: itemCfg.d || '', icon: cfg.icon_file || null, iconDir: ASSET + 'unit-icons',
        armyLevel: cfg.level,
        rawName: itemCfg.n || cfg.name || ''
      });
    });
    // Reverse map of suit group ids → suit id, so each decor knows whether it belongs to a set
    var suitGroupSet = {};
    if (typeof DECOR_SUIT_GROUPS !== 'undefined') {
      for (var sid in DECOR_SUIT_GROUPS) {
        DECOR_SUIT_GROUPS[sid].forEach(function(g) { suitGroupSet[String(g)] = sid; });
      }
    }
    (tabs.decor || []).forEach(function(it) {
      var cfgRaw = lk.building[String(it.id)];
      var cfg = cfgRaw || {};
      // Silent-fallback detection: building-table.json is stale for this
      // decor id. Cell falls back to "Decor #<id>" with no icon. Patch
      // path is the building TABLE extract — group/level hint helps
      // narrow the in-game lookup (groups cluster by suit / category).
      if (!cfgRaw) {
        _ar_reportMissingLookup('building', it.id, 'armory-report/inventory/decor', {
          tab: 'decor', level: it.l || null, group: it.g || null, amount: it.a || 0
        });
      }
      var grp = cfg.g || it.g;
      var icon = (grp && cfg.n) ? grp + '_' + _ar_sanitizeName(cfg.n) + '.png' : null;
      var inSuit = grp && suitGroupSet[String(grp)];
      var category = (lk.decorCat && grp) ? (lk.decorCat[String(grp)] || null) : null;
      out.tabs.decor.push({
        id: it.id, amount: it.a || 0, level: it.l || cfg.lv || null, maxLevel: cfg.ml,
        group: grp || it.id, type: cfg.t, quality: cfg.q || 1, name: cfg.n || ('Decor #' + it.id),
        desc: cfg.d || '', icon: icon, iconDir: ASSET + 'decor-icons',
        subtab: inSuit ? 'set' : 'other',
        suitId: inSuit || null,
        category: category
      });
    });
    (tabs.hero || []).forEach(function(it) {
      var cfgRaw = lk.item[String(it.id)];
      var cfg = cfgRaw || {};
      // Silent-fallback detection. Hero-tab cells route through the item
      // table (hero shards / skill cards live there too). Missing row
      // means item-table.json is stale — same patch path as the item tab.
      if (!cfgRaw) {
        _ar_reportMissingLookup('item', it.id, 'armory-report/inventory/hero', {
          tab: 'hero', level: it.l || null, group: it.g || null, amount: it.a || 0
        });
      }
      var icoInfo = _ar_resolveItemIcon(cfg.i);
      // Type 31 hero shards: same CDN-redirect rule as the Item tab. The
      // inventory atlas doesn't ship hero portraits, but the public game
      // headpic CDN does — pluck the hero id out of cfg.i and rewrite the
      // resolved icon to the global headpic URL. Without this, every hero
      // shard (Katrina, Abad, Storm Shadow, …) renders the placeholder and
      // hits /feedback/missing-icon for an asset the repo will never have.
      var iconAbsUrl = null;
      if (cfg.t === 31) {
        var hm = String(cfg.i || '').match(/hero_icon(\d+)/i);
        if (hm) {
          iconAbsUrl = 'https://h5.topwargame.com/DynRes/images/headpic/hero_icon' + hm[1] + '_global.png';
          icoInfo = { file: 'hero_icon' + hm[1] + '_global.png', dirSuffix: null };
        }
      }
      out.tabs.hero.push({
        id: it.id, amount: it.a || 0, level: it.l || null, group: it.g || it.id,
        type: cfg.t, quality: cfg.q || 1, name: cfg.n || ('Hero #' + it.id), desc: cfg.d || '',
        icon: icoInfo ? icoInfo.file : null,
        iconDir: iconAbsUrl
          ? iconAbsUrl.replace(/\/[^\/]*$/, '')
          : (icoInfo && icoInfo.absDir)
            ? icoInfo.absDir
            : (ASSET + (icoInfo ? icoInfo.dirSuffix : 'inventory-icons')),
        subtab: _ar_heroSubtab(cfg.t)
      });
    });
    return out;
  }


/* ---- v2 rules (new) ---- */
var CATS = {
  item: [['all', 'All items'], ['skill_universal', 'Skills'], ['titan', 'Titan Gear'], ['enigma', 'Enigma'], ['gem', 'Gems'], ['formation', 'Formation'], ['units', 'Unit chests'], ['chest', 'Chests'], ['speedup', 'Speed-ups'], ['combat_buff', 'Combat buffs'], ['ht_chip', 'HT items']],
  hero: [['all', 'All'], ['shards', 'Hero shards'], ['skills', 'Hero skills']],
  decor: [['all', 'All'], ['other', 'Not in a set'], ['set', 'In a set']]
};
var BUCKET_LABEL = { skill_universal: 'Skills', titan: 'Titan Gear', ht_chip: 'HT items', enigma: 'Enigma', gem: 'Gems', formation: 'Formation', units: 'Unit chests', chest: 'Chests', speedup: 'Speed-ups', combat_buff: 'Combat buffs', resource: 'Resources', other: 'Other' };
var SUB_LABEL = { shards: 'Hero shards', skills: 'Hero skills' };
var TITAN = [['all', 'All'], ['rune', 'Runes'], ['material', 'Materials'], ['catalyst', 'Catalysts'], ['blueprint', 'Blueprints'], ['booster', 'Boosters'], ['gearchest', 'Gear chests']];
var SORTS = [['type', 'By type'], ['quality', 'Rarity, high first'], ['quality_asc', 'Rarity, low first'], ['amount', 'Amount, most first'], ['amount_asc', 'Amount, fewest first'], ['name', 'Name, A to Z'], ['name_desc', 'Name, Z to A']];
var RARITY = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' };
function rarityName(q) { return RARITY[q] || ('Rarity ' + q); }
var AGG = { gem: { name: 'Gems', file: 'inventory-icons/image__item__item_1000000.png', q: 0 }, odinium: { name: 'Odinium', file: 'treasury-icons/odinium.png', q: 0 }, food: { name: 'Food', file: 'treasury-icons/food.png', q: 0 }, oil: { name: 'Oil', file: 'treasury-icons/oil.png', q: 0 } };
var DECOR_CAT_ORDER = ['March Size', 'Defense', 'Damage Boost', 'Others', 'Uncategorized'];
var STONE_ID = 44301001, EXCL_SHARD_ID = 20213231, UNIVERSAL_DECOR_ID = 20213232, DECOR_BOX_ID = 10000196;
function isKey(t) { return KEY_NAME.test(t) || /^\d+$/.test(t) || (/^\S+$/.test(t) && t.indexOf('_') >= 0); } /* one token with an underscore is an untranslated key, with or without digits */
var KEY_NAME = /^[a-z]+(_[a-z]+)*_?\d+$/i; /* the game's untranslated keys: item_name41104, building_name_4190, itemName10000031 */
var BRANCH = { 1: 'Army', 2: 'Navy', 3: 'Air Force' };

/* what a player reads for a row: a game key or an id never reaches the screen */
function displayName(it, tab) {
  if (tab === 'unit') { var b = BRANCH[Math.floor(num(it.type) / 100)]; return b ? b + ' unit' : 'Unit'; }
  var n = String(it.name == null ? '' : it.name).replace(/\s*\{\d+\}/g, '').trim();
  if (!n || isKey(n) || /^(Decor |Hero |Unit )?#\d+$/.test(n)) return 'Unknown item';
  return n;
}
/* descriptions: template placeholders ({0}), [bracket] markup and untranslated keys are dropped; the value of {0} is not in the table */
function cleanDesc(s) {
  var t = String(s == null ? '' : s).trim();
  if (isKey(t)) return '';
  /* a {n} placeholder reads X (its value is not in the table); no neighbouring word is touched */
  return t.replace(/([A-Za-z])\{\d+\}/g, '$1 X').replace(/\{\d+\}(?=[A-Za-z])/g, 'X ').replace(/\{\d+\}/g, 'X').replace(/\[([^\]]+)\]/g, '$1').replace(/[{}\[\]]/g, '').replace(/\s+([.,;)])/g, '$1').replace(/ {2,}/g, ' ').trim();
}
/* the rehydrated bag + the labels a screen shows. known: { itemId: { n, f, d } } for ids the armory knows but the item table does not (Awakening Stone and Cards) */
function prepare(data, known) {
  known = known || {};
  TABS.forEach(function (t) {
    (data.tabs[t[0]] || []).forEach(function (it) {
      it.tab = t[0];
      var k = has.call(known, it.id) && (t[0] === 'item' || t[0] === 'hero') ? known[it.id] : null;
      if (k && displayName(it, t[0]) === 'Unknown item') { it.name = k.n; it.icon = k.f; it.iconDir = RAW_ICON + 'hero-awake-items'; it.quality = 5; if (!cleanDesc(it.desc)) it.desc = k.d || ''; }
      it.label = displayName(it, t[0]); it.unknown = it.label === 'Unknown item'; it.text = cleanDesc(it.desc);
    });
  });
  return data;
}

function catList(tab) { return CATS[tab] || null; }
function catDefault(tab) { var l = catList(tab); return l ? l[0][0] : ''; }
function bucketIx(b) { return _AR_BUCKET_INDEX[b] != null ? _AR_BUCKET_INDEX[b] : 99; }
function byQuality(a, b) { return (b.quality || 0) - (a.quality || 0) || (b.level || 0) - (a.level || 0) || (b.amount || 0) - (a.amount || 0); }
function lvNum(x) { return num(x.armyLevel || x.level); }
function cmpName(a, b) { return String(a.label).localeCompare(String(b.label)) || lvNum(a) - lvNum(b); }
function aggKindFor(it) {
  if (it.bucket === 'gem') return 'gem';
  if (it.bucket !== 'resource') return null;
  return it.group === 940001 ? 'odinium' : it.group === 910000 ? 'food' : it.group === 920000 ? 'oil' : null;
}
/* held, not best case: what the cell and the sheet header count */
function aggHeld(kind, data) { return data.aggTotals[kind] || 0; }
function aggTotal(kind, data) {
  return kind === 'gem' ? data.aggTotals.gem + (data.boxedGemTotal || 0) : kind === 'odinium' ? (data.aggTotals.odinium || 0) + (data.boxedOdiniumTotal || 0) : (data.aggTotals[kind] || 0);
}
function comparator(sort, typeFirst) {
  return function (a, b) {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1; /* unknown rows last in every order */
    if (typeFirst) {
      var c = bucketIx(a.bucket) - bucketIx(b.bucket);
      if (c) return c;
      if (a.bucket === 'other') { c = (a.group || 0) - (b.group || 0); if (c) return c; }
      return byQuality(a, b);
    }
    if (sort === 'amount') return (b.amount || 0) - (a.amount || 0);
    if (sort === 'amount_asc') return (a.amount || 0) - (b.amount || 0);
    if (sort === 'name') return cmpName(a, b);
    if (sort === 'name_desc') return -cmpName(a, b);
    if (sort === 'quality_asc') return -byQuality(a, b);
    return byQuality(a, b); /* quality, and "by type" on a tab without categories */
  };
}
function matches(x, q) { return String(x.label).toLowerCase().indexOf(q) >= 0 || String(x.text || '').toLowerCase().indexOf(q) >= 0; }
function groupBy(cells, keyOf, titleOf, subOf) {
  var by = {}, order = [];
  cells.forEach(function (c) { var k = keyOf(c); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(c); });
  return { order: order, by: by, groups: order.map(function (k) { return { key: k, title: titleOf(k, by[k]), sub: subOf(k, by[k]) }; }) };
}
function flat(g) { var out = []; g.order.forEach(function (k) { g.by[k].forEach(function (c) { c.g = k; out.push(c); }); }); return out; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
/* decor pieces in the bag grouped: sets by suit (largest first, then suit id: the classic order), the rest by buff type */
function decorGroups(cells, which, suits) {
  var parts = [], out = [], groups = [];
  ['other', 'set'].forEach(function (w) {
    if (which !== 'all' && which !== w) return;
    var sub = cells.filter(function (c) { return w === 'set' ? !!c.it.suitId : !c.it.suitId; });
    if (!sub.length) return;
    var g = groupBy(sub, function (c) { return w === 'set' ? 'set:' + String(c.it.suitId) : 'cat:' + (c.it.category || 'Uncategorized'); },
      function (k, cs) { var info = w === 'set' && suits ? suits[k.slice(4)] : null; return w === 'set' ? (info && info.n ? String(info.n) : 'Another set') : (k.slice(4) === 'Uncategorized' ? 'Other' : k.slice(4)); },
      function (k, cs) { var pieces = cs.reduce(function (a, c) { return a + num(c.it.amount); }, 0), info = w === 'set' && suits ? suits[k.slice(4)] : null;
        return w === 'set' ? cs.length + ' of ' + (info && info.c ? num(info.c) : '?') + ' in bag' : plural(cs.length, 'kind', 'kinds') + ' (' + plural(pieces, 'piece', 'pieces') + ')'; });
    if (w === 'set') {
      var idn = function (k) { var x = k.slice(4); return /^\d+$/.test(x) ? +x : Infinity; };
      g.order.sort(function (a, b) { return idn(a) - idn(b); });
      g.order.sort(function (a, b) { return g.by[b].length - g.by[a].length; });
    } else g.order.sort(function (a, b) { var ai = DECOR_CAT_ORDER.indexOf(a.slice(4)), bi = DECOR_CAT_ORDER.indexOf(b.slice(4)); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi); });
    var byKey = {}; g.groups.forEach(function (x) { byKey[x.key] = x; });
    g.order.forEach(function (k) { groups.push(byKey[k]); });
    out = out.concat(flat(g));
  });
  return { cells: out, groups: groups };
}
/* every tab at once for a query: the hits grouped by tab */
function search(data, st, q) {
  var cells = [], groups = [];
  TABS.forEach(function (t) {
    var tab = t[0], list = ((data.tabs && data.tabs[tab]) || []).filter(function (x) { return matches(x, q) && (!st.quality || String(x.quality) === String(st.quality)) && !(tab === 'item' && aggKindFor(x)); });
    list.sort(comparator(st.sort === 'type' ? 'quality' : st.sort, false));
    var cs = list.map(function (it) { return { it: it, tab: tab }; });
    if (tab === 'item' && !st.quality) Object.keys(AGG).forEach(function (k) { if (AGG[k].name.toLowerCase().indexOf(q) >= 0 && aggHeld(k, data) + (k === 'gem' ? data.boxedGemTotal || 0 : k === 'odinium' ? data.boxedOdiniumTotal || 0 : 0) > 0) cs.unshift({ agg: k, tab: 'item' }); });
    if (!cs.length) return;
    groups.push({ key: 't:' + tab, title: t[1], sub: plural(cs.length, 'match', 'matches') });
    cs.forEach(function (c) { c.g = 't:' + tab; cells.push(c); });
  });
  return { cells: cells, groups: groups, search: true };
}
/* The cells of one tab under a state { tab, cat, titan, q, quality, sort }: the classic rerender, as data. With a query: every tab, every category.
   Returns { cells: [{ it } | { agg }], groups: null | [{ key, title, sub }] }; each cell of a grouped result carries .g (its group key). */
function view(data, st) {
  var q = String(st.q || '').toLowerCase().trim();
  if (q) return search(data, st, q);
  var tab = tabKnown(st.tab) ? st.tab : 'item', isItem = tab === 'item', cat = st.cat || catDefault(tab), sort = st.sort || 'type';
  var list = ((data.tabs && data.tabs[tab]) || []).slice();
  if (isItem) {
    if (cat && cat !== 'all') {
      if (cat === 'gem') list = list.filter(function (x) { return x.bucket === 'gem' || x.boxedGems > 0; });
      else list = list.filter(function (x) { return x.bucket === cat; });
    }
    list = list.filter(function (x) { return !aggKindFor(x); }); /* raw packs are folded into one cell each */
    if (cat === 'titan' && st.titan && st.titan !== 'all') list = list.filter(function (x) { return x.titanCat === st.titan; });
  } else if (catList(tab) && cat !== 'all') list = list.filter(function (x) { return x.subtab === cat; });
  if (st.quality) list = list.filter(function (x) { return String(x.quality) === String(st.quality); });
  var typeSort = sort === 'type', bucketSort = isItem && cat === 'all' && typeSort;
  list.sort(comparator(sort, bucketSort));
  var cells = list.map(function (it) { return { it: it, tab: tab }; });
  if (isItem && (cat === 'all' || cat === 'gem') && !st.quality) {
    var aggs = [];
    if (data.aggTotals.gem > 0 || data.boxedGemTotal > 0) aggs.push({ agg: 'gem', b: 'gem', tab: 'item' });
    if (cat === 'all') {
      if (data.aggTotals.odinium > 0) aggs.push({ agg: 'odinium', b: 'resource', tab: 'item' });
      if (data.aggTotals.food > 0) aggs.push({ agg: 'food', b: 'resource', tab: 'item' });
      if (data.aggTotals.oil > 0) aggs.push({ agg: 'oil', b: 'resource', tab: 'item' });
    }
    if (cat === 'gem' || !bucketSort) cells = aggs.concat(cells);
    else {
      var comb = cells.map(function (c) { return { c: c, b: bucketIx(c.it.bucket), n: 1 }; }).concat(aggs.map(function (a) { return { c: a, b: bucketIx(a.b), n: 0 }; }));
      comb.forEach(function (x, i) { x.i = i; });
      comb.sort(function (a, b) { return a.b - b.b || a.n - b.n || a.i - b.i; });
      cells = comb.map(function (x) { return x.c; });
    }
  }
  if (tab === 'decor' && cells.length) {
    var dg = decorGroups(cells, cat, DECOR_SUITS);
    return { cells: dg.cells, groups: dg.groups };
  }
  if (bucketSort && cells.length) {
    var g = groupBy(cells, function (c) { return 'b:' + (c.it ? c.it.bucket : c.b); }, function (k) { return BUCKET_LABEL[k.slice(2)] || 'Other'; }, function (k, cs) { return plural(cs.length, 'kind', 'kinds'); });
    return { cells: flat(g), groups: g.groups };
  }
  if (tab === 'hero' && cat === 'all' && cells.length) {
    var h = groupBy(cells, function (c) { return 'h:' + c.it.subtab; }, function (k) { return SUB_LABEL[k.slice(2)] || 'Hero items'; }, function (k, cs) { return plural(cs.length, 'kind', 'kinds'); });
    return { cells: flat(h), groups: h.groups };
  }
  return { cells: cells, groups: null };
}
/* the category chips of a tab, each with what view() would show for it: an empty item category is hidden, "all" never */
function categories(data, tab) {
  var l = catList(tab);
  if (!l) return [];
  return l.map(function (c) { return [c[0], c[1], view(data, { tab: tab, cat: c[0] }).cells.length]; }).filter(function (c) { return !(c[0] !== 'all' && c[2] === 0); });
}
function total(data, tab) { return view(data, { tab: tab, cat: catDefault(tab) }).cells.length; }
function titanCats(data) {
  var t = ((data.tabs && data.tabs.item) || []).filter(function (x) { return x.bucket === 'titan'; });
  return TITAN.map(function (c) { return [c[0], c[1], c[0] === 'all' ? t.length : t.filter(function (x) { return x.titanCat === c[0]; }).length]; }).filter(function (c) { return c[0] === 'all' || c[2] > 0; });
}
/* the rarity filter of a tab: the tiers present, highest first, with counts */
function rarities(data, tab) {
  var n = {}; view(data, { tab: tab, cat: catDefault(tab) }).cells.forEach(function (c) { if (!c.it) return; var q = Math.round(num(c.it.quality)) || 1; n[q] = (n[q] || 0) + 1; }); /* what the grid shows: folded packs are not counted */
  return [['', 'All rarities']].concat(Object.keys(n).map(Number).sort(function (a, b) { return b - a; }).map(function (q) { return [String(q), rarityName(q), n[q]]; }));
}
/* the labelled numbers above the grid: what the player HOLDS first (account + packs), the best case inside choice boxes apart. VIT as classic's bar. */
function resources(data, inv, core) {
  var r = data.resources || {}, out = [], gold = num(r._gold), thor = num(r._thor);
  function parts(a) { return a.filter(function (x) { return x; }); }
  var sh = inv && core && core._adv_calcAvailableShards ? core._adv_calcAvailableShards(inv) : null;
  function amount(id) { var n = 0; ((data.tabs && data.tabs.item) || []).forEach(function (x) { if (x.id === id) n += num(x.amount); }); return n; }
  var ex = amount(EXCL_SHARD_ID), st = amount(STONE_ID), od = data.aggTotals.odinium || 0;
  if (sh && sh.universal > 0) out.push({ key: 'shards', label: 'Universal Decor Shards', value: sh.universal, parts: parts([sh.directShards > 0 && sh.boxShards > 0 ? fmtBig(sh.directShards) + ' as shards' : '', sh.boxShards > 0 ? fmtBig(sh.boxShards) + ' from boxes' : '']), link: 'spend', main: true });
  if (st > 0) out.push({ key: 'stones', label: 'Awakening Stones', value: st, parts: [], link: 'stones', main: true });
  if (data.gemTotal > 0 || gold > 0) out.push({ key: 'gems', label: 'Gems', value: gold + data.gemTotal, parts: parts([gold > 0 ? fmtBig(gold) + ' in your account' : '', data.gemTotal > 0 ? fmtBig(data.gemTotal) + ' in gem packs' : '']), main: true });
  if (ex > 0) out.push({ key: 'excl', label: 'Universal Exclusive Skill Shards', value: ex, parts: [] });
  if (od > 0 || thor > 0) out.push({ key: 'odinium', label: 'Odinium', value: thor + od, parts: parts([thor > 0 ? fmtBig(thor) + ' in your account' : '', od > 0 ? fmtBig(od) + ' in packs' : '']) });
  if (data.vitTotal > 0) out.push({ key: 'vit', label: 'VIT', value: data.vitTotal, parts: [] });
  if (data.boxedGemTotal > 0) out.push({ key: 'gems_boxes', label: 'Gems in choice boxes', value: data.boxedGemTotal, parts: ['best case, one reward per box'] });
  if (data.boxedOdiniumTotal > 0) out.push({ key: 'odinium_boxes', label: 'Odinium in choice boxes', value: data.boxedOdiniumTotal, parts: ['best case, one reward per box'] });
  if (data.boxedVitTotal > 0) out.push({ key: 'vit_boxes', label: 'VIT in choice boxes', value: data.boxedVitTotal, parts: ['best case, one reward per box'] });
  return out;
}
/* the sheet of a Gems / Odinium / Food / Oil cell: the packs behind the total, as classic's modal */
function aggModel(kind, data) {
  var m = has.call(AGG, kind) ? AGG[kind] : null; if (!m) return null;
  var det = (data.aggDetails[kind] || []).slice().sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
  var boxed = kind === 'gem' ? data.boxedGemDetails : kind === 'odinium' ? data.boxedOdiniumDetails : [];
  var bx = kind === 'gem' ? data.boxedGemTotal || 0 : kind === 'odinium' ? data.boxedOdiniumTotal || 0 : 0;
  return { kind: kind, name: m.name, file: m.file, direct: aggHeld(kind, data), boxed: bx, total: aggTotal(kind, data), packs: det, boxes: (boxed || []).slice().sort(function (a, b) { return (b.total || 0) - (a.total || 0); }) };
}
function findItem(data, key) {
  var m = /^([a-z]+):(\d+)$/.exec(String(key));
  if (!m || !has.call(data.tabs, m[1]) || !Array.isArray(data.tabs[m[1]])) return null;
  var id = +m[2], list = data.tabs[m[1]];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return { tab: m[1], it: list[i] };
  return null;
}
/* the pieces of the set an owned decoration belongs to (how many kinds the bag holds of that set) */
function setOwned(data, it) {
  if (!it.suitId) return null;
  var n = 0; (data.tabs.decor || []).forEach(function (d) { if (d.suitId === it.suitId) n++; });
  var info = DECOR_SUITS ? DECOR_SUITS[it.suitId] : null;
  return { name: info && info.n ? String(info.n) : 'Another set', owned: n, total: info && info.c ? num(info.c) : 0 };
}

var api = {
  rehydrate: _ar_rehydrateInv, prepare: prepare, categories: categories, total: total, titanCats: titanCats, rarities: rarities, view: view, resources: resources, aggModel: aggModel, findItem: findItem, setOwned: setOwned,
  classify: _ar_classifyItemBucket, titanGear: _ar_classifyTitanGear, boxedGems: _ar_boxedGemsPerOpen, boxedOdinium: _ar_boxedOdiniumPerOpen, vitYield: _ar_vitYieldFromCfg, boxedVit: _ar_boxedVitPerOpen, gemValue: _ar_gemValueFromCfg,
  resolveIcon: _ar_resolveItemIcon, compactNumber: _ar_compactNumber, packQuantity: _ar_packQuantity, resourceKind: _ar_resourceKind, bucketOrder: _AR_BUCKET_ORDER.slice(),
  displayName: displayName, cleanDesc: cleanDesc, rarityName: rarityName,
  TABS: TABS, CATS: CATS, SORTS: SORTS, AGG: AGG, BUCKET_LABEL: BUCKET_LABEL, STONE_ID: STONE_ID, UNIVERSAL_DECOR_ID: UNIVERSAL_DECOR_ID, DECOR_BOX_ID: DECOR_BOX_ID, EXCL_SHARD_ID: EXCL_SHARD_ID
};
return api;
}

var Logic = { create: create, tabKnown: tabKnown, num: num, fmtBig: fmtBig, fmtCell: fmtCell, suffixed: suffixed, ageOld: ageOld, iconUrl: iconUrl, TABS: TABS };
root.ArmoryBagLogic = Logic;
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ---------- view ---------- */
root.ArmoryBag = function (H) {
var S = H.S, G = H.G, core = H.core, BASE = H.BASE, $ = H.$, $$ = H.$$, esc = H.esc, nd = H.nd, nm = H.nm, ic = H.ic, art = H.art, readOnly = H.readOnly;
var DEF = { tab: 'item', cat: '', titan: 'all', q: '', quality: '', sort: 'type', n: 48 };
var T = Object.assign({}, DEF), PAGE = 48, STEP = 48;
var D = null, DFor = null, L = null, loading = false, bad = false, wired = false, cur = { q: {} };

var CSS =
  '.bag-sub{font-size:var(--fs-13);color:var(--muted)}.bag-pt{font-size:var(--fs-13);color:var(--muted)}' +
  '.bag-res .area-n{min-width:9ch}.bag-res .area:first-child{border-top:0}.bag-res .hd{margin-bottom:4px}.bag-res div.area:hover,.bag-res div.area:active{background:none}' +
  '.bag-res .alist{border-top:0}.bag-restbtn{display:flex;align-items:center;width:100%;min-height:var(--tap);color:var(--accent);font-size:var(--fs-14);font-weight:600;border-top:1px solid var(--rule)}' +
  '.bag-res .bag-pt{display:none}.bag-rest:not([hidden]) .bag-pt{display:block}.bag-src{margin-top:8px}' +
  '.bag-segs .segs-in button{flex:1 1 auto;font-size:var(--fs-13);padding:0 8px;white-space:nowrap}' +
  '.bag-ctl{display:flex;flex-direction:column;gap:12px}.bag-bar{display:flex;align-items:center;gap:8px}.bag-bar .fld{flex:1;min-width:0;width:auto}.bag-bar .btn{flex:none}' +
  '.bag-fs{display:none}.bag-f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-12);color:var(--muted);min-width:0}.bag-f .sel{min-width:0;width:100%}' +
  '.bag-cb{min-height:40px;padding:0 14px;border:1px solid var(--border);border-radius:var(--r-chip);background:var(--surface);font-size:var(--fs-14);font-weight:600;color:var(--muted)}.bag-cb[aria-pressed="true"]{color:var(--text);background:var(--card-hi);border-color:var(--muted)}' +
  '.bag-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
  '.bag-gh{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 12px;padding-top:8px;border-top:1px solid var(--rule)}.bag-gh:first-child{border-top:0;padding-top:0}' +
  '.bag-gh h3{font:700 var(--fs-15)/1.3 var(--display)}.bag-gh span{font-size:var(--fs-13);color:var(--muted)}' +
  '.bag-c{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:6px;min-width:0;min-height:var(--row);padding:8px 4px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-card);color:var(--text);text-align:center}' +
  '.bag-c:active{background:var(--card-hi)}.bag-c .ico,.bag-c .fb{width:48px;height:48px}.bag-unk .i{width:24px;height:24px}' +
  '.bag-q1{border-color:var(--dim)}.bag-q2{border-color:var(--ok)}.bag-q3{border-color:var(--q3)}.bag-q4{border-color:var(--q4)}.bag-q5{border-color:var(--q5)}.bag-q6{border-color:var(--q6)}' +
  '.bag-nm{width:100%;font-size:var(--fs-13);line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}' +
  '.bag-ft{display:block;max-width:100%;text-align:center}.bag-a{font-size:var(--fs-14);font-weight:700}' +
  '.bag-tally{font-size:var(--fs-13);color:var(--muted)}' +
  '.bag-d{white-space:pre-line;overflow-wrap:anywhere;font-size:var(--fs-15)}.bag-facts{margin-top:4px}.bag-facts .srow .a{font-size:var(--fs-14);font-weight:400;color:var(--muted)}.bag-facts .srow .v{font-weight:700;text-align:right;overflow-wrap:anywhere}' +
  '.bag-big{display:flex;flex-direction:column}.bag-big .n{font:700 var(--fs-32)/1.1 var(--display)}' +
  '@media (min-width:600px){.bag-g{grid-template-columns:repeat(4,minmax(0,1fr))}}' +
  '@media (min-width:768px){.bag-fbtn{display:none}.bag-ctl{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:8px 12px;align-items:end}.bag-fs{display:contents}.bag-g{grid-template-columns:repeat(5,minmax(0,1fr))}.bag-segs .segs-in{max-width:520px}.bag-restbtn{display:none}.bag-res .bag-rest[hidden]{display:contents !important}.bag-res .bag-pt{display:block}.bag-res .alist{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:24px}.bag-res .bag-rest{display:contents}.bag-res .area{border-top:0}}' +
  '@media (min-width:1024px){.bag-g{grid-template-columns:repeat(7,minmax(0,1fr))}}';
function injectCss() {
  if (document.getElementById('bag-style')) return;
  var s = document.createElement('style'); s.id = 'bag-style'; s.textContent = CSS; document.head.appendChild(s);
}
function num(v) { return Logic.num(v); }
function priv() { return (S.res && S.res.privacy) || {}; }
function rawInv() { var s = S.res && S.res.supp || {}; return s.inv && typeof s.inv === 'object' ? s.inv : null; }
function dl() { return (S.res && S.res.statics && S.res.statics.decorLookups) || {}; }
function mk() { var d = dl(); return Logic.create({ RUNE_ICON: G.RUNE_ICON, DECOR_SUIT_GROUPS: d.DECOR_SUIT_GROUPS, DECOR_SUITS: d.DECOR_SUITS }); }
/* ids the armory knows but the item table does not: the Awakening Stone and the six Awakening Cards (art in assets/hero-awake-items) */
function knownItems() {
  var AW = (root.ArmoryVM && root.ArmoryVM.AW) || {}, K = {};
  if (AW.STONE) K[AW.STONE] = { n: 'Awakening Stone', f: 'item_' + AW.STONE + '.png', d: 'Spent to raise a hero’s awakening skills.' };
  Object.keys(AW.CARD || {}).forEach(function (h) { var nmH = core.heroName(+h); K[AW.CARD[h]] = { n: nmH + ' Awakening Card', f: 'item_' + AW.CARD[h] + '.png', d: 'Needed to awaken ' + nmH + '.' }; });
  return K;
}
function spendOwner() { return !readOnly() && S.res.identity && S.res.identity.unlocked && S.vm && S.vm.decor && S.vm.decor.known; }
function segOf(id) { return S.vm.heroes.list.some(function (h) { return h.id === id; }) ? 'battle' : 'roster'; }
function heroOfCard(itemId) { var C = (root.ArmoryVM && root.ArmoryVM.AW && root.ArmoryVM.AW.CARD) || {}; for (var h in C) if (C[h] === itemId) return +h; return 0; }
function qOf(it) { var q = Math.round(num(it.quality)); return q >= 1 && q <= 6 ? q : 1; }
function noHy(t) { return String(t).replace(/-/g, '‑'); }
function icon(it, cls) {
  var u = Logic.iconUrl(it);
  if (u) return art(u, 'ico ' + (cls || ''), it.label.charAt(0), '');
  return it.unknown ? '<span class="ico fb bag-unk ' + (cls || '') + '">' + ic('bag') + '</span>' : '<span class="ico fb ' + (cls || '') + '" translate="no">' + esc(it.label.charAt(0)) + '</span>';
}
function aggIcon(kind) { var m = L.AGG[kind]; return art(BASE + m.file, 'ico', m.name.charAt(0), ''); }
function fail(e) {
  if (window.console) console.error(e);
  var v = $('#v-bag'); if (v) v.innerHTML = '<div class="vb"><div class="empty">Could not show the bag. Reload the page to try again.</div></div>';
}
function lvText(it) {
  var lv = it.armyLevel || (it.level && it.level > 1 ? it.level : 0); if (!lv) return '';
  return 'Lv.' + Math.round(num(lv)) + (it.tab === 'decor' && it.maxLevel ? ' of ' + Math.round(num(it.maxLevel)) : '');
}

/* ---- the parts of the screen ---- */
function resRow(r) {
  var link = '', tag = 'div';
  if (r.link === 'spend' && spendOwner()) { link = ' href="#base/decor?spend=1"'; tag = 'a'; }
  else if (r.link === 'stones' && S.vm && S.vm.awaken && S.vm.awaken.show) { link = ' href="#heroes/battle?awk=open"'; tag = 'a'; }
  return '<' + tag + ' class="area"' + link + ' data-numwrap><span class="area-n" data-num translate="no">' + esc(Logic.fmtBig(r.value)) + '</span><div class="area-b"><div class="l lbl">' + nm(r.label) + '</div>' + (r.parts.length ? '<div class="s bag-pt">' + nd(r.parts.join(' · ')) + '</div>' : '') + '</div>' + (tag === 'a' ? ic('chev') : '') + '</' + tag + '>';
}
function resHtml(rows) {
  if (!rows.length) return '';
  var main = rows.filter(function (r) { return r.main; }), rest = rows.filter(function (r) { return !r.main; }), ts = rawInv() && rawInv().meta && rawInv().meta.ts, age = Logic.ageOld(ts);
  return '<section class="card bag-res"><h2 class="hd">Resources</h2><div class="alist">' + main.map(resRow).join('') +
    (rest.length ? '<button class="bag-restbtn" type="button" data-bagrest aria-expanded="false" aria-controls="bagRest">' + nd('All resources (' + rows.length + ')') + '</button><div class="bag-rest" id="bagRest" hidden>' + rest.map(resRow).join('') + '</div>' : '') + '</div>' +
    '<p class="foot bag-src">' + nd('Source: game data' + (age ? ', ' + age : '')) + '</p></section>';
}
function cellHtml(c) {
  if (c.agg) {
    var m = L.AGG[c.agg], held = L.aggModel(c.agg, D).direct;
    return '<button class="bag-c" type="button" data-bagagg="' + c.agg + '">' + aggIcon(c.agg) + '<span class="bag-nm" translate="no">' + esc(m.name) + '</span><span class="bag-ft"><span class="bag-a" translate="no">×' + esc(Logic.fmtCell(held)) + '</span> <span class="pill p-lv">Total</span></span></button>';
  }
  var it = c.it, lv = lvText(it), q = qOf(it), key = (c.tab || T.tab) + ':' + it.id;
  return '<button class="bag-c bag-q' + q + '" type="button" data-bagi="' + esc(key) + '">' + icon(it, 'bag-q' + q) + '<span class="bag-nm" translate="no">' + esc(noHy(it.label)) + '</span><span class="bag-ft"><span class="bag-a" translate="no">×' + esc(Logic.fmtCell(it.amount)) + '</span>' + (lv ? ' <span class="pill p-lv" translate="no">' + esc(lv) + '</span>' : '') + '</span></button>';
}
function catDefault() { var c = L.CATS[T.tab]; return c ? c[0][0] : ''; }
function dirty() { return (T.quality ? 1 : 0) + (T.sort !== 'type' ? 1 : 0) + (T.cat && T.cat !== catDefault() ? 1 : 0) + (T.titan !== 'all' ? 1 : 0); }
function btnText() { var n = dirty(); return 'Filter · Sort' + (n ? ' (' + n + ')' : ''); }
function selectHtml(k, lab, list) {
  var val = k === 'cat' ? (T.cat || catDefault()) : T[k];
  return '<label class="bag-f"><span>' + esc(lab) + '</span><select class="sel" data-bagf="' + k + '">' + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o.length > 2 || /\d/.test(o[1]) ? ' translate="no"' : '') + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1] + (o.length > 2 && o[0] !== '' ? ' (' + Logic.fmtCell(o[2]) + ')' : '')) + '</option>'; }).join('') + '</select></label>';
}
function fieldList() {
  var out = [], cats = L.categories(D, T.tab);
  if (cats.length) out.push(['cat', 'Category', cats]);
  if (T.tab === 'item' && (T.cat || catDefault()) === 'titan') { var tc = L.titanCats(D); if (tc.length > 1) out.push(['titan', 'Titan Gear type', tc]); }
  out.push(['quality', 'Rarity', L.rarities(D, T.tab)], ['sort', 'Sort', L.SORTS]);
  return out;
}
function listHtml() {
  var st = Object.assign({}, T, { cat: T.cat || catDefault() }), v = L.view(D, st), shown = v.cells.slice(0, T.n), all = v.cells.length, held = L.total(D, T.tab);
  if (!all) return '<div class="empty">' + (T.q ? 'Nothing in the bag matches “' + esc(T.q) + '”. <button class="tb link" type="button" data-bagclear>Clear search</button>' : D.tabs[T.tab] && D.tabs[T.tab].length ? 'Nothing in the bag matches this. <button class="tb link" type="button" data-bagclear>Clear filters</button>' : 'Nothing in this tab.') + '</div>';
  var html = '', last = null, g = {};
  (v.groups || []).forEach(function (x) { g[x.key] = x; });
  shown.forEach(function (c) {
    if (v.groups && c.g !== last) { var x = g[c.g]; html += '<div class="bag-gh"><h3 translate="no">' + esc(x.title) + '</h3><span>' + nd(x.sub) + '</span></div>'; last = c.g; }
    html += cellHtml(c);
  });
  var rest = all - shown.length, filtered = T.q || dirty();
  return '<div class="bag-g">' + html + '</div><p class="bag-tally" role="status">' + nd('Showing ' + Logic.fmtCell(shown.length) + ' of ' + Logic.fmtCell(all) + (filtered ? ' · ' + (T.q ? 'across the whole bag' : Logic.fmtCell(held) + ' in bag') : '')) + '</p>' +
    (rest > 0 ? '<button class="btn more" type="button" data-bagmore><span>Show ' + nd(Logic.fmtCell(Math.min(STEP, rest))) + ' more</span></button>' : '');
}
function emptyBody(kind) {
  if (kind === 'private') return '<div class="empty">' + (readOnly() ? 'The player keeps this bag private.' : 'Your bag is set to private, so it is hidden here. Change who can see it on the classic page.') + '</div>' + (readOnly() ? '' : classicLink());
  return '<div class="empty">' + (readOnly() ? 'No bag data from this player yet.' : 'No bag data yet. ') + (readOnly() ? '' : '<button class="tb link" type="button" data-open="status">Send game data</button>') + '</div>';
}
function classicLink() { return '<div class="lnkrow"><a class="tb link" href="' + esc(H.classicUrl('inventory')) + '">' + ic('ext', 'sm') + '<span>Open the bag on the classic page</span></a></div>'; }
function segsHtml() {
  return '<div class="segs bag-segs"><div class="segs-in" role="tablist">' + Logic.TABS.map(function (t) { return '<button type="button" role="tab" data-go="bag?tab=' + t[0] + '" aria-selected="' + (T.tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div></div>';
}
function topHtml(kind) {
  return '<div class="sechead"><h2 class="title">Bag</h2></div>' + (kind === 'ok' && D ? '<p class="bag-sub" id="bagCount">' + nd(Logic.fmtCell(L.total(D, T.tab)) + ' items in bag') + '</p>' : '');
}
function paint() {
  var v = $('#v-bag'); if (!v || !S.vm || !S.res) return;
  injectCss();
  var kind = priv().inv ? 'private' : (rawInv() ? 'ok' : 'none');
  if (kind !== 'ok') { v.innerHTML = '<div class="vb">' + topHtml(kind) + emptyBody(kind) + '</div>'; return; }
  if (bad) { v.innerHTML = '<div class="vb">' + topHtml('none') + '<div class="empty">Could not load the item names. <button class="tb link" type="button" data-bagretry>Try again</button></div></div>'; return; }
  if (!D) { v.innerHTML = '<div class="vb">' + topHtml('none') + '<p class="muted" role="status">Opening your bag…</p></div>'; load(); return; }
  var rows = L.resources(D, rawInv(), core), q = $('[data-bagq]', v), had = q && document.activeElement === q;
  v.innerHTML = segsHtml() + '<div class="vb">' + topHtml('ok') + resHtml(rows) +
    '<div class="bag-ctl"><div class="bag-bar"><input class="fld" type="search" data-bagq autocomplete="off" spellcheck="false" aria-label="Search the bag" placeholder="Search the bag" value="' + esc(T.q) + '"><button class="btn bag-fbtn" type="button" data-open="bagfilter">' + ic('sliders', 'sm') + btnText() + '</button></div>' +
    '<div class="bag-fs">' + fieldList().map(function (f) { return selectHtml(f[0], f[1], f[2]); }).join('') + '</div></div>' +
    '<div id="bagList" style="display:flex;flex-direction:column;gap:12px">' + listHtml() + '</div></div>';
  if (had) { var q2 = $('[data-bagq]', v); if (q2) { q2.focus({ preventScroll: true }); try { q2.setSelectionRange(q2.value.length, q2.value.length); } catch (e) {} } }
}
function refresh() {
  var l = $('#bagList'); if (l) l.innerHTML = listHtml();
  $$('.bag-fbtn').forEach(function (b) { b.lastChild.textContent = btnText(); });
  $$('select[data-bagf]').forEach(function (x) { var k = x.dataset.bagf, want = String(k === 'cat' ? (T.cat || catDefault()) : T[k]); if (x.value !== want) x.value = want; });
}
function load() {
  if (loading || D) return;
  loading = true; bad = false;
  var inv = rawInv(), key = inv;
  H.d.loadInvLookups().then(function (lk) {
    loading = false;
    if (rawInv() !== key) { paint(); return; }
    try { L = mk(); D = L.prepare(L.rehydrate(JSON.parse(JSON.stringify(inv)), lk), knownItems()); DFor = inv; } catch (e) { bad = true; if (window.console) console.error(e); }
    paint();
  }, function () { loading = false; bad = true; paint(); }); /* a network failure is a state the screen explains, not an error */
}
function ensure() {
  var inv = rawInv();
  if (D && DFor !== inv) { D = null; DFor = null; }
  if (!L) L = mk();
}

/* ---- sheets ---- */
function chipGroup(k, lab, list) {
  return '<div><span class="lab" style="margin-bottom:4px">' + esc(lab) + '</span><div class="chips">' + list.map(function (o) {
    var on = k === 'cat' ? String(T.cat || catDefault()) === String(o[0]) : String(T[k]) === String(o[0]);
    return '<button class="bag-cb" type="button" data-bagc="' + k + ':' + esc(o[0]) + '" aria-pressed="' + on + '">' + nd(o[1] + (o.length > 2 && o[0] !== '' ? ' (' + Logic.fmtCell(o[2]) + ')' : '')) + '</button>';
  }).join('') + '</div></div>';
}
function filterSheet() {
  if (!D) return null;
  var body = '<div class="ctrls">' + fieldList().map(function (f) { return chipGroup(f[0], f[1], f[2]); }).join('') + '</div><button class="btn" type="button" data-close style="width:100%;margin-top:12px">Done</button>';
  return ['Filter and sort', body];
}
function fact(a, v) { return '<div class="srow"><div class="sb"><div class="a">' + esc(a) + '</div></div><div class="v">' + v + '</div></div>'; }
function usedLinks(f) {
  var it = f.it, out = '', hid = f.tab === 'item' ? heroOfCard(it.id) : 0;
  function a(href, t) { out += '<a class="tb link" href="' + href + '">' + t + '</a>'; }
  if (f.tab === 'decor') {
    var pl = (S.vm.decor.placed || []).filter(function (p) { return p.g === it.group; })[0];
    if (pl) a('#base/decor?item=' + encodeURIComponent(pl.n), nd('See it in Base · placed at Lv.' + pl.lv));
  }
  if (it.id === L.UNIVERSAL_DECOR_ID || it.id === L.DECOR_BOX_ID) { if (spendOwner()) a('#base/decor?spend=1', 'Spend my shards'); }
  if (it.id === L.STONE_ID && S.vm.awaken && S.vm.awaken.show) a('#heroes/battle?awk=open', 'Open the Awakening card');
  if (hid && S.vm.awaken && S.vm.awaken.byId && S.vm.awaken.byId[hid]) a('#heroes/' + segOf(hid) + '?hero=' + encodeURIComponent(core.heroName(hid)) + '&awk=hero', nd('See ' + core.heroName(hid) + ' awakening'));
  if (f.tab === 'item') {
    if (it.type === 153) a('#heroes/gear?view=runes', 'See your runes');
    else if (it.bucket === 'titan') a('#heroes/gear', 'See your Titan Gear');
    else if (it.bucket === 'enigma') a('#beasts/collection', 'See your beasts');
    else if (it.bucket === 'ht_chip') a('#ht/pool', 'See your chip pool');
    else if (it.bucket === 'formation') a('#base/formation', 'See your formation');
  }
  return out;
}
function itemSheet(key) {
  if (!D) return null;
  var f = L.findItem(D, key); if (!f) return null;
  var it = f.it, lv = lvText(it), q = qOf(it), facts = '';
  var head = '<div class="sh-hero">' + icon(it, 'bag-q' + q) + '<div class="bag-big"><span class="n" translate="no">' + esc(Logic.fmtBig(it.amount)) + '</span><span class="t12 muted">' + nd('in bag · ' + L.rarityName(q) + (lv ? ' · ' + lv : '')) + '</span></div></div>';
  var desc = it.text ? '<p class="bag-d">' + esc(it.text) + '</p>' : (it.unknown ? '<p class="bag-d muted">The armory’s item list does not have this one yet. The count is from your game data.</p>' : '');
  if (f.tab === 'decor') {
    var so = L.setOwned(D, it);
    if (so) facts += fact('Set', nm(so.name) + (so.total ? ' ' + nd('· ' + so.owned + ' of ' + so.total + ' in bag') : ''));
    if (it.category) facts += fact('Buff type', nm(it.category === 'Uncategorized' ? 'Other' : it.category));
  }
  if (f.tab === 'item' && it.boxedGems > 0) facts += fact('Gems inside', nd('up to ' + Logic.fmtBig(it.boxedGems) + ' per box'));
  var links = usedLinks(f);
  return [noHy(it.label), head + desc + (facts ? '<div class="bag-facts">' + facts + '</div>' : '') + (links ? '<div class="lnkrow">' + links + '</div>' : ''), true];
}
function aggSheet(kind) {
  if (!D) return null;
  var m = L.aggModel(kind, D); if (!m) return null;
  var head = '<div class="sh-hero">' + aggIcon(kind) + '<div class="bag-big"><span class="n" translate="no">' + esc(Logic.fmtBig(m.direct)) + '</span><span class="t12 muted">in bag, in packs</span></div></div>';
  var sum = m.boxed > 0 ? '<p class="t13 muted">' + nd('Up to ' + Logic.fmtBig(m.boxed) + ' more inside choice boxes, best case: you pick one reward per box.') + '</p>' : '';
  function rows(list, per) { return list.map(function (r) { return '<div class="srow"><div class="sb"><div class="a" translate="no" style="font-weight:600;color:var(--text)">' + esc(noHy(r.name)) + '</div><div class="b">' + nd('×' + Logic.fmtBig(r.amount) + ' · ' + Logic.fmtBig(r[per]) + ' each') + '</div></div><div class="v" translate="no" style="font-weight:700;overflow-wrap:anywhere">' + esc(Logic.fmtBig(r.total)) + '</div></div>'; }).join(''); }
  var body = head + sum + (m.packs.length ? '<div><h3 class="disp" style="font-size:var(--fs-15)">Packs</h3>' + rows(m.packs, 'perPack') + '</div>' : '') +
    (m.boxes.length ? '<div><h3 class="disp" style="font-size:var(--fs-15)">Choice boxes (best case per box)</h3>' + rows(m.boxes, 'perOpen') + '</div>' : '');
  return [m.name, body, true];
}
function sheet(kind, arg) {
  try {
    if (kind === 'bagfilter') return filterSheet();
    if (kind === 'bagitem') return itemSheet(arg);
    if (kind === 'bagagg') return aggSheet(arg);
  } catch (e) { if (window.console) console.error(e); }
  return null;
}

/* ---- events ---- */
function wire() {
  if (wired) return; wired = true;
  var v = $('#v-bag');
  v.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.bagi) { H.openSheet('bagitem', t.dataset.bagi); return; }
    if (t.dataset.bagagg) { H.openSheet('bagagg', t.dataset.bagagg); return; }
    if (t.hasAttribute('data-bagrest')) { var r = $('#bagRest'), open = r.hidden; r.hidden = !open; t.setAttribute('aria-expanded', open ? 'true' : 'false'); return; }
    if (t.hasAttribute('data-bagmore')) { T.n += STEP; refresh(); return; }
    if (t.hasAttribute('data-bagclear')) { T.q = ''; T.quality = ''; T.titan = 'all'; T.cat = ''; T.n = PAGE; var inp = $('[data-bagq]', v); if (inp) inp.value = ''; refresh(); return; }
    if (t.hasAttribute('data-bagretry')) { bad = false; D = null; paint(); }
  });
  v.addEventListener('input', function (e) {
    var t = e.target; if (!t.hasAttribute || !t.hasAttribute('data-bagq')) return;
    T.q = t.value; T.n = PAGE; refresh();
  });
  v.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.bagf) return;
    setField(t.dataset.bagf, t.value);
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('#sheetB [data-bagc]') : null; if (!t) return;
    var kv = t.dataset.bagc.split(':'), k = kv[0], val = kv.slice(1).join(':');
    setField(k, val);
    var h = filterSheet(); if (h) { $('#sheetB').innerHTML = h[1]; var again = $('#sheetB [data-bagc="' + t.dataset.bagc + '"]'); if (again) again.focus({ preventScroll: true }); }
  });
}
function setField(k, val) {
  if (k === 'cat') { T.cat = val; T.titan = 'all'; }
  else if (k === 'quality') T.quality = val;
  else if (k === 'titan') T.titan = val;
  else if (k === 'sort') T.sort = val;
  T.n = PAGE; if (k === 'cat') paint(); else refresh();
}
function render(r) {
  try {
    cur = { q: (r && r.q) || {} };
    var tab = Logic.tabKnown(cur.q.tab) ? cur.q.tab : T.tab;
    if (tab !== T.tab) { T = Object.assign({}, DEF, { tab: tab, q: T.q, quality: T.quality, sort: T.sort }); }
    if (!S.vm || !S.res) return;
    ensure(); paint(); wire();
    var v = $('#v-bag'); if (v) $$('.segs button', v).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.go === 'bag?tab=' + T.tab ? 'true' : 'false'); });
  } catch (e) { fail(e); }
}
return { render: render, sheet: sheet };
};
})(typeof window !== 'undefined' ? window : globalThis);
