// pages/report-render.js
// Self-contained single-player battle-report renderer for transfer-armory.html.
// Functions are copied/adapted from battle-report.html (which is NOT modified).
window.ReportRender = (function () {
  'use strict';

  var CDN_BASE = 'https://fight-report-va.oss-accelerate.aliyuncs.com/prod/';
  var CDN_BASE_CN = 'https://fight-report.oss-accelerate.aliyuncs.com/prod/';
  var ASSET_BASE = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/';

  // --- copied verbatim from battle-report.html (line refs in comments) ---
  // fetchReportResponse: battle-report.html:607-613
  function fetchReportResponse(id) {
    var suffix = id.substring(0, 4) + '/' + id + '.json';
    return fetch(CDN_BASE + suffix).then(function (r) {
      if (r.ok) return r;
      return fetch(CDN_BASE_CN + suffix).then(function (r2) { return r2.ok ? r2 : r; });
    }).catch(function () { return fetch(CDN_BASE_CN + suffix); });
  }

  var _awakeningRef = null;
  // loadAwakeningRef: battle-report.html:614-619
  function loadAwakeningRef() {
    if (_awakeningRef) return Promise.resolve(_awakeningRef);
    return fetch('data/hero-awakening-skills.json').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _awakeningRef = j; return j; }).catch(function () { return null; });
  }

  // NEW: SHA-256 hex of a string (matches worker sha256Hex + roster siteKeys).
  function sha256hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str))).then(function (buf) {
      var b = new Uint8Array(buf), h = '';
      for (var i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, '0');
      return h;
    });
  }

  /** Create a DOM element safely */
  // el: battle-report.html:2878-2897
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'onclick') node.addEventListener('click', attrs[k]);
        else if (k === 'style') node.style.cssText = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function(c) {
        if (c == null) return;
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  /** Get avatar URL from playerInfo */
  // resolveAvatar: battle-report.html:2913-2917
  function resolveAvatar(url) {
    if (!url) return null;
    if (url.indexOf('http') === 0) return url;
    return 'https://h5.topwargame.com/DynRes/images/headpic/' + url + '.png?t=21.jpg';
  }

  // getAvatar: battle-report.html:2919-2921
  function getAvatar(pi) {
    return resolveAvatar(pi.headimgurl_custom) || resolveAvatar(pi.avatarurl) || null;
  }

  /** UID stripping for raw JSON display — only strip the 'uid' field */
  // stripUIDs: battle-report.html:2924-2936
  function stripUIDs(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(function(item) { return stripUIDs(item); });
    }
    var result = {};
    for (var key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      if (key === 'uid') { result[key] = 0; continue; }
      result[key] = stripUIDs(obj[key]);
    }
    return result;
  }

  // formatPower: battle-report.html:2211-2236
  function formatPower(p) {
    if (p == null || p === 0) return '0';
    if (typeof p === 'string') p = parseFloat(p);
    if (isNaN(p)) return '0';
    var abs = Math.abs(p);
    // Game-style suffixes: K, M, B, T, then aa, bb, cc, dd, ee, ff, gg
    var tiers = [
      { thresh: 1e33, suffix: 'gg' },
      { thresh: 1e30, suffix: 'ff' },
      { thresh: 1e27, suffix: 'ee' },
      { thresh: 1e24, suffix: 'dd' },
      { thresh: 1e21, suffix: 'cc' },
      { thresh: 1e18, suffix: 'bb' },
      { thresh: 1e15, suffix: 'aa' },
      { thresh: 1e12, suffix: 'T' },
      { thresh: 1e9, suffix: 'B' },
      { thresh: 1e6, suffix: 'M' },
      { thresh: 1e3, suffix: 'K' }
    ];
    for (var i = 0; i < tiers.length; i++) {
      if (abs >= tiers[i].thresh) {
        return (p / tiers[i].thresh).toFixed(2) + tiers[i].suffix;
      }
    }
    return p.toFixed(0);
  }

  // NEW: single-player overview card (name / server / avatar / CP).
  // side is 'att' or 'def'; march is battle.fightMarches[0] (may be undefined).
  function renderOverview(player, side, march, nameOverride, serverOverride) {
    var pi = getPlayerInfo2(player);
    var name = nameOverride || pi.username || 'Unknown player';
    var cpRaw = march ? (side === 'att' ? march.attBattlePower : march.defBattlePower) : null;
    var card = el('div', { className: 'ta-overview' }, [
      el('img', { className: 'ta-ov-avatar', src: getAvatar(pi), alt: '', referrerpolicy: 'no-referrer' }),
      el('div', { className: 'ta-ov-main' }, [
        el('div', { className: 'ta-ov-name notranslate' }, name),
        el('div', { className: 'ta-ov-sub' }, serverOverride ? ('Server ' + serverOverride) : ''),
        el('div', { className: 'ta-ov-cp' }, cpRaw != null ? ('CP ' + formatPower(cpRaw)) : '')
      ])
    ]);
    return card;
  }
  // getPlayerInfo in battle-report takes (side, playerIndex); here we already have the
  // player object, so use a small adapter that parses player.playerInfo directly.
  function getPlayerInfo2(player) {
    try { return JSON.parse((player && player.playerInfo) || '{}'); } catch (e) { return {}; }
  }

  // --- copied verbatim from battle-report.html (Task 2: Heroes + Gear) ---
  // Lookup tables (free-var deps of resolveRune/runeIconUrl/buildHeroGearSide):
  var HERO_NAMES = {"335":"Hiccup","334":"Jett","332":"Vivian","330":"Tigress","329":"Storm Shadow","328":"Abad","326":"Cranston","325":"Brady","324":"Barbie","323":"Kum & Hazel","321":"Lancaster","318":"Maximo","315":"Villiers","313":"Tsuru","312":"Rockfield","310":"Arthur Harris","309":"Sauvage","308":"Hartman","307":"Tian Mu","306":"Lady Zizak","305":"Edward","304":"Nadia","231":"Jester","228":"Duke","226":"Stromoy","225":"Crimson Typhoon","224":"Layla","214":"Violet","212":"Lee Yewon","208":"Teresa","207":"Chloe","206":"Merida","205":"Ganso","204":"Sid","171":"Astrid","170":"Rohr","169":"Sara","168":"Chris Redfield","167":"Binary","166":"Leon S. Kennedy","165":"Marvingt","163":"Roadblock","162":"Quily","161":"Monkey","160":"Po","159":"Nelle","157":"Scarlett","156":"Snake Eyes","155":"Kaworu Nagisa","154":"Shikinami Asuka Langley","153":"Brynhildr","152":"Pop","151":"Striker Eureka","150":"Cherno Alpha","149":"Coyote Tango","148":"Gipsy Danger","147":"Polik","145":"Shinji Ikari","144":"Rei Ayanami","141":"Cromwell","140":"Ghost","135":"Mei","129":"Preycis","118":"Ben","117":"Amalia","116":"Kuruzo","115":"Diana","114":"Gira","112":"Friedman Hertz","110":"Bradley","109":"Katyusha","108":"Li Hongyu","106":"Sam","105":"Alex","104":"Tywin","1209":"Nimitz","213":"Bassel","164":"Shifu","158":"Mercury","211":"Bellevue","146":"Shaquille O'Neal","229":"Zhen","111":"Bell","322":"Serval","317":"Selina","142":"Springfield","123":"Scaramanga","219":"Nereid","327":"Kai","222":"Erinyes","316":"Aya","233":"Ada Wong","320":"Saker","314":"Dante","234":"Shen Suyu","120":"Fahed","227":"Maplelyn","220":"Nemo","119":"Silence","216":"Akatora","223":"Kotiya","218":"Yuu","217":"Bailos","215":"914","337":"Heid","336":"Joan Mature","333":"Carna","331":"Lin","238":"Valka","237":"Alvida","236":"Stoick","235":"Jill Valentine","232":"Lilia","230":"Meowzilla","210":"Katrina","107":"Wade","302":"Ricardo","113":"Kate Curry","102":"Reichstein","303":"Dr. Gero","203":"Simon","202":"Hammer","122":"Ishi Tarou","121":"Delhuyar","103":"Rambo","201":"Bob","301":"O'Neill","101":"Black Widow","319":"Starscream","221":"Seaspray","143":"Comedy Consortium","137":"Arcee","136":"Megatron","124":"Optimus Prime","125":"Bumblebee","172":"Nova","173":"Tannis","174":"Ella","239":"Lophy","240":"Sinope","241":"Margaretha","338":"Franziska"};
  var EXCL_SKILL={104:{id:20301,n:"Tywin Skill"},105:{id:20302,n:"Alex Skill"},106:{id:20303,n:"Sam Skill"},108:{id:20311,n:"Li Hongyu Skill"},109:{id:20315,n:"Katyusha Skill"},110:{id:20617,n:"Bradley Skill"},111:{id:20627,n:"Bell Skill"},114:{id:20626,n:"Gira Skill"},115:{id:20655,n:"Diana Skill"},116:{id:20630,n:"Kuruzo Skill"},117:{id:20632,n:"Amalia Skill"},118:{id:20637,n:"Ben Skill"},119:{id:20635,n:"Silence Skill"},120:{id:20640,n:"Fahed Skill"},123:{id:20642,n:"Scaramanga Skill"},129:{id:20648,n:"Preycis Skill"},135:{id:20654,n:"Mei Skill"},140:{id:20660,n:"Ghost Skill"},141:{id:20663,n:"Cromwell Skill"},142:{id:20666,n:"Springfield Skill"},144:{id:20700,n:"Rei Ayanami Skill"},145:{id:20701,n:"Shinji Ikari Skill"},146:{id:20702,n:"Shaquille O'Neal Skill"},147:{id:20705,n:"Polik Skill"},148:{id:20708,n:"Gipsy Danger Skill"},149:{id:20709,n:"Coyote Tango Skill"},150:{id:20711,n:"Cherno Alpha Skill"},151:{id:20712,n:"Striker Eureka Skill"},152:{id:20715,n:"Pop Skill"},153:{id:20716,n:"Brynhildr Skill"},154:{id:20717,n:"Asuka Skill"},155:{id:20718,n:"Kaworu Skill"},156:{id:20722,n:"Snake Eyes Skill"},157:{id:20723,n:"Scarlett Skill"},158:{id:20724,n:"Mercury Skill"},159:{id:20726,n:"Nelle Skill"},160:{id:20727,n:"Po Skill"},161:{id:20729,n:"Monkey Skill"},162:{id:20731,n:"Quily Skill"},163:{id:20734,n:"Roadblock Skill"},164:{id:20736,n:"Shifu Skill"},165:{id:20737,n:"Marvingt Skill"},166:{id:20741,n:"Leon Skill"},167:{id:20744,n:"Binary Skill"},168:{id:20747,n:"Chris Skill"},169:{id:20750,n:"Sara Skill"},170:{id:20753,n:"Rohr Skill"},171:{id:20756,n:"Astrid Skill"},204:{id:20304,n:"Sid Skill"},205:{id:20305,n:"Ganso Skill"},206:{id:20306,n:"Merida Skill"},207:{id:20307,n:"Chloe Skill"},208:{id:20313,n:"Teresa Skill"},210:{id:20618,n:"Katrina Skill"},211:{id:20620,n:"Bellevue Skill"},212:{id:20624,n:"Lee Yewon Skill"},213:{id:20628,n:"Bassel Skill"},214:{id:20633,n:"Violet Skill"},215:{id:20638,n:"914 Skill"},216:{id:20641,n:"Akatora Skill"},217:{id:20644,n:"Bailos Skill"},218:{id:20651,n:"Yuu Skill"},219:{id:20657,n:"Nereid Skill"},220:{id:20662,n:"Nemo Skill"},222:{id:20668,n:"Erinyes Skill"},223:{id:20703,n:"Kotiya Skill"},224:{id:20706,n:"Layla Skill"},225:{id:20707,n:"Crimson Typhoon Skill"},226:{id:20713,n:"Stromoy Skill"},227:{id:20719,n:"Maplelyn Skill"},228:{id:20721,n:"Duke Skill"},229:{id:20728,n:"Zhen Skill"},230:{id:20732,n:"Meowzilla Skill"},231:{id:20735,n:"Jester Skill"},232:{id:20739,n:"Lilia Skill"},233:{id:20742,n:"Ada Wong Skill"},234:{id:20745,n:"Shen Suyu Skill"},235:{id:20748,n:"Jill Valentine Skill"},236:{id:20752,n:"Stoick Skill"},237:{id:20754,n:"Alvida Skill"},238:{id:20757,n:"Valka Skill"},304:{id:20308,n:"Nadia Skill"},305:{id:20309,n:"Edward Skill"},306:{id:20310,n:"Lady Zizak Skill"},307:{id:20312,n:"Tian Mu Skill"},308:{id:20314,n:"Hartman Skill"},309:{id:20614,n:"Sauvage Skill"},310:{id:20621,n:"Harris Skill"},312:{id:20625,n:"Rockfield Skill"},313:{id:20629,n:"Tsuru Skill"},314:{id:20634,n:"Dante Skill"},315:{id:20639,n:"Villiers Skill"},316:{id:20643,n:"Aya Skill"},317:{id:20647,n:"Selina Skill"},318:{id:20653,n:"Maximo Skill"},320:{id:20661,n:"Saker Skill"},321:{id:20665,n:"Lancaster Skill"},322:{id:20669,n:"Serval Skill"},323:{id:20704,n:"Kum & Hazel Skill"},324:{id:20710,n:"Barbie Skill"},325:{id:20714,n:"Brady Skill"},326:{id:20720,n:"Cranston Skill"},327:{id:20725,n:"Kai Skill"},328:{id:20730,n:"Abad Skill"},329:{id:20733,n:"Storm Shadow Skill"},330:{id:20738,n:"Tigress Skill"},331:{id:20740,n:"Lin Skill"},332:{id:20743,n:"Vivian Skill"},333:{id:20746,n:"Carna Skill"},334:{id:20749,n:"Jett Skill"},335:{id:20751,n:"Hiccup Skill"},336:{id:20755,n:"Joan Mature Skill"},337:{id:20758,n:"Heid Skill"},1209:{id:20613,n:"Nimitz Skill"}};
  var GEAR_TEMPLATE={1:{n:"Army DMG+",m:600},2:{n:"Army DMG+",m:600},3:{n:"Army DMG+",m:600},4:{n:"Navy DMG+",m:600},5:{n:"Navy DMG+",m:600},6:{n:"Navy DMG+",m:600},7:{n:"AF DMG+",m:600},8:{n:"AF DMG+",m:600},9:{n:"AF DMG+",m:600},19:{n:"Army ATK",m:3000},20:{n:"Army ATK",m:3000},21:{n:"Army ATK",m:3000},22:{n:"Navy ATK",m:3000},23:{n:"Navy ATK",m:3000},24:{n:"Navy ATK",m:3000},25:{n:"AF ATK",m:3000},26:{n:"AF ATK",m:3000},27:{n:"AF ATK",m:3000},73:{n:"Army HP",m:3000},74:{n:"Army HP",m:3000},75:{n:"Army HP",m:3000},76:{n:"Navy HP",m:3000},77:{n:"Navy HP",m:3000},78:{n:"Navy HP",m:3000},79:{n:"AF HP",m:3000},80:{n:"AF HP",m:3000},81:{n:"AF HP",m:3000},82:{n:"Army DEF",m:300},83:{n:"Army DEF",m:300},84:{n:"Army DEF",m:300},85:{n:"Navy DEF",m:300},86:{n:"Navy DEF",m:300},87:{n:"Navy DEF",m:300},88:{n:"AF DEF",m:300},89:{n:"AF DEF",m:300},90:{n:"AF DEF",m:300},91:{n:"Army DMG+",m:600},92:{n:"Army DMG+",m:600},93:{n:"Army DMG+",m:600},94:{n:"Navy DMG+",m:600},95:{n:"Navy DMG+",m:600},96:{n:"Navy DMG+",m:600},97:{n:"AF DMG+",m:600},98:{n:"AF DMG+",m:600},99:{n:"AF DMG+",m:600},109:{n:"Army ATK",m:3000},110:{n:"Army ATK",m:3000},111:{n:"Army ATK",m:3000},112:{n:"Navy ATK",m:3000},113:{n:"Navy ATK",m:3000},114:{n:"Navy ATK",m:3000},115:{n:"AF ATK",m:3000},116:{n:"AF ATK",m:3000},117:{n:"AF ATK",m:3000},136:{n:"Army DMG+",m:600},137:{n:"Army DMG+",m:600},138:{n:"Army DMG+",m:600},139:{n:"Navy DMG+",m:600},140:{n:"Navy DMG+",m:600},141:{n:"Navy DMG+",m:600},142:{n:"AF DMG+",m:600},143:{n:"AF DMG+",m:600},144:{n:"AF DMG+",m:600},154:{n:"Army ATK",m:3000},155:{n:"Army ATK",m:3000},156:{n:"Army ATK",m:3000},157:{n:"Navy ATK",m:3000},158:{n:"Navy ATK",m:3000},159:{n:"Navy ATK",m:3000},160:{n:"AF ATK",m:3000},161:{n:"AF ATK",m:3000},162:{n:"AF ATK",m:3000},190:{n:"Army DMG−",m:600},191:{n:"Army DMG−",m:600},192:{n:"Army DMG−",m:600},193:{n:"Navy DMG−",m:600},194:{n:"Navy DMG−",m:600},195:{n:"Navy DMG−",m:600},196:{n:"AF DMG−",m:600},197:{n:"AF DMG−",m:600},198:{n:"AF DMG−",m:600},208:{n:"Army HP",m:3000},209:{n:"Army HP",m:3000},210:{n:"Army HP",m:3000},211:{n:"Navy HP",m:3000},212:{n:"Navy HP",m:3000},213:{n:"Navy HP",m:3000},214:{n:"AF HP",m:3000},215:{n:"AF HP",m:3000},216:{n:"AF HP",m:3000},235:{n:"Army DMG−",m:600},236:{n:"Army DMG−",m:600},237:{n:"Army DMG−",m:600},238:{n:"Navy DMG−",m:600},239:{n:"Navy DMG−",m:600},240:{n:"Navy DMG−",m:600},241:{n:"AF DMG−",m:600},242:{n:"AF DMG−",m:600},243:{n:"AF DMG−",m:600},253:{n:"Army HP",m:3000},254:{n:"Army HP",m:3000},255:{n:"Army HP",m:3000},256:{n:"Navy HP",m:3000},257:{n:"Navy HP",m:3000},258:{n:"Navy HP",m:3000},259:{n:"AF HP",m:3000},260:{n:"AF HP",m:3000},261:{n:"AF HP",m:3000},271:{n:"Army DMG+",m:600},272:{n:"Army DMG+",m:600},273:{n:"Army DMG+",m:600},274:{n:"Navy DMG+",m:600},275:{n:"Navy DMG+",m:600},276:{n:"Navy DMG+",m:600},277:{n:"AF DMG+",m:600},278:{n:"AF DMG+",m:600},279:{n:"AF DMG+",m:600},289:{n:"Army ATK",m:3000},290:{n:"Army ATK",m:3000},291:{n:"Army ATK",m:3000},292:{n:"Navy ATK",m:3000},293:{n:"Navy ATK",m:3000},294:{n:"Navy ATK",m:3000},295:{n:"AF ATK",m:3000},296:{n:"AF ATK",m:3000},297:{n:"AF ATK",m:3000},343:{n:"Army HP",m:3000},344:{n:"Army HP",m:3000},345:{n:"Army HP",m:3000},346:{n:"Navy HP",m:3000},347:{n:"Navy HP",m:3000},348:{n:"Navy HP",m:3000},349:{n:"AF HP",m:3000},350:{n:"AF HP",m:3000},351:{n:"AF HP",m:3000},352:{n:"Army DEF",m:300},353:{n:"Army DEF",m:300},354:{n:"Army DEF",m:300},355:{n:"Navy DEF",m:300},356:{n:"Navy DEF",m:300},357:{n:"Navy DEF",m:300},358:{n:"AF DEF",m:300},359:{n:"AF DEF",m:300},360:{n:"AF DEF",m:300},361:{n:"Army DMG+",m:600},362:{n:"Army DMG+",m:600},363:{n:"Army DMG+",m:600},364:{n:"Navy DMG+",m:600},365:{n:"Navy DMG+",m:600},366:{n:"Navy DMG+",m:600},367:{n:"AF DMG+",m:600},368:{n:"AF DMG+",m:600},369:{n:"AF DMG+",m:600},379:{n:"Army ATK",m:3000},380:{n:"Army ATK",m:3000},381:{n:"Army ATK",m:3000},382:{n:"Navy ATK",m:3000},383:{n:"Navy ATK",m:3000},384:{n:"Navy ATK",m:3000},385:{n:"AF ATK",m:3000},386:{n:"AF ATK",m:3000},387:{n:"AF ATK",m:3000},406:{n:"Army DMG+",m:600},407:{n:"Army DMG+",m:600},408:{n:"Army DMG+",m:600},409:{n:"Navy DMG+",m:600},410:{n:"Navy DMG+",m:600},411:{n:"Navy DMG+",m:600},412:{n:"AF DMG+",m:600},413:{n:"AF DMG+",m:600},414:{n:"AF DMG+",m:600},424:{n:"Army ATK",m:3000},425:{n:"Army ATK",m:3000},426:{n:"Army ATK",m:3000},427:{n:"Navy ATK",m:3000},428:{n:"Navy ATK",m:3000},429:{n:"Navy ATK",m:3000},430:{n:"AF ATK",m:3000},431:{n:"AF ATK",m:3000},432:{n:"AF ATK",m:3000},460:{n:"Army DMG−",m:600},461:{n:"Army DMG−",m:600},462:{n:"Army DMG−",m:600},463:{n:"Navy DMG−",m:600},464:{n:"Navy DMG−",m:600},465:{n:"Navy DMG−",m:600},466:{n:"AF DMG−",m:600},467:{n:"AF DMG−",m:600},468:{n:"AF DMG−",m:600},478:{n:"Army HP",m:3000},479:{n:"Army HP",m:3000},480:{n:"Army HP",m:3000},481:{n:"Navy HP",m:3000},482:{n:"Navy HP",m:3000},483:{n:"Navy HP",m:3000},484:{n:"AF HP",m:3000},485:{n:"AF HP",m:3000},486:{n:"AF HP",m:3000},505:{n:"Army DMG−",m:600},506:{n:"Army DMG−",m:600},507:{n:"Army DMG−",m:600},508:{n:"Navy DMG−",m:600},509:{n:"Navy DMG−",m:600},510:{n:"Navy DMG−",m:600},511:{n:"AF DMG−",m:600},512:{n:"AF DMG−",m:600},513:{n:"AF DMG−",m:600},523:{n:"Army HP",m:3000},524:{n:"Army HP",m:3000},525:{n:"Army HP",m:3000},526:{n:"Navy HP",m:3000},527:{n:"Navy HP",m:3000},528:{n:"Navy HP",m:3000},529:{n:"AF HP",m:3000},530:{n:"AF HP",m:3000},531:{n:"AF HP",m:3000},541:{n:"Army DMG+",m:600},542:{n:"Army DMG+",m:600},543:{n:"Army DMG+",m:600},544:{n:"Navy DMG+",m:600},545:{n:"Navy DMG+",m:600},546:{n:"Navy DMG+",m:600},547:{n:"AF DMG+",m:600},548:{n:"AF DMG+",m:600},549:{n:"AF DMG+",m:600},559:{n:"Army ATK",m:3000},560:{n:"Army ATK",m:3000},561:{n:"Army ATK",m:3000},562:{n:"Navy ATK",m:3000},563:{n:"Navy ATK",m:3000},564:{n:"Navy ATK",m:3000},565:{n:"AF ATK",m:3000},566:{n:"AF ATK",m:3000},567:{n:"AF ATK",m:3000},613:{n:"Army HP",m:3000},614:{n:"Army HP",m:3000},615:{n:"Army HP",m:3000},616:{n:"Navy HP",m:3000},617:{n:"Navy HP",m:3000},618:{n:"Navy HP",m:3000},619:{n:"AF HP",m:3000},620:{n:"AF HP",m:3000},621:{n:"AF HP",m:3000},622:{n:"Army DEF",m:300},623:{n:"Army DEF",m:300},624:{n:"Army DEF",m:300},625:{n:"Navy DEF",m:300},626:{n:"Navy DEF",m:300},627:{n:"Navy DEF",m:300},628:{n:"AF DEF",m:300},629:{n:"AF DEF",m:300},630:{n:"AF DEF",m:300},631:{n:"Army DMG+",m:600},632:{n:"Army DMG+",m:600},633:{n:"Army DMG+",m:600},634:{n:"Navy DMG+",m:600},635:{n:"Navy DMG+",m:600},636:{n:"Navy DMG+",m:600},637:{n:"AF DMG+",m:600},638:{n:"AF DMG+",m:600},639:{n:"AF DMG+",m:600},649:{n:"Army ATK",m:3000},650:{n:"Army ATK",m:3000},651:{n:"Army ATK",m:3000},652:{n:"Navy ATK",m:3000},653:{n:"Navy ATK",m:3000},654:{n:"Navy ATK",m:3000},655:{n:"AF ATK",m:3000},656:{n:"AF ATK",m:3000},657:{n:"AF ATK",m:3000},676:{n:"Army DMG+",m:600},677:{n:"Army DMG+",m:600},678:{n:"Army DMG+",m:600},679:{n:"Navy DMG+",m:600},680:{n:"Navy DMG+",m:600},681:{n:"Navy DMG+",m:600},682:{n:"AF DMG+",m:600},683:{n:"AF DMG+",m:600},684:{n:"AF DMG+",m:600},694:{n:"Army ATK",m:3000},695:{n:"Army ATK",m:3000},696:{n:"Army ATK",m:3000},697:{n:"Navy ATK",m:3000},698:{n:"Navy ATK",m:3000},699:{n:"Navy ATK",m:3000},700:{n:"AF ATK",m:3000},701:{n:"AF ATK",m:3000},702:{n:"AF ATK",m:3000},730:{n:"Army DMG−",m:600},731:{n:"Army DMG−",m:600},732:{n:"Army DMG−",m:600},733:{n:"Navy DMG−",m:600},734:{n:"Navy DMG−",m:600},735:{n:"Navy DMG−",m:600},736:{n:"AF DMG−",m:600},737:{n:"AF DMG−",m:600},738:{n:"AF DMG−",m:600},748:{n:"Army HP",m:3000},749:{n:"Army HP",m:3000},750:{n:"Army HP",m:3000},751:{n:"Navy HP",m:3000},752:{n:"Navy HP",m:3000},753:{n:"Navy HP",m:3000},754:{n:"AF HP",m:3000},755:{n:"AF HP",m:3000},756:{n:"AF HP",m:3000},775:{n:"Army DMG−",m:600},776:{n:"Army DMG−",m:600},777:{n:"Army DMG−",m:600},778:{n:"Navy DMG−",m:600},779:{n:"Navy DMG−",m:600},780:{n:"Navy DMG−",m:600},781:{n:"AF DMG−",m:600},782:{n:"AF DMG−",m:600},783:{n:"AF DMG−",m:600},793:{n:"Army HP",m:3000},794:{n:"Army HP",m:3000},795:{n:"Army HP",m:3000},796:{n:"Navy HP",m:3000},797:{n:"Navy HP",m:3000},798:{n:"Navy HP",m:3000},799:{n:"AF HP",m:3000},800:{n:"AF HP",m:3000},801:{n:"AF HP",m:3000},811:{n:"Army DMG+",m:600},812:{n:"Army DMG+",m:600},813:{n:"Army DMG+",m:600},814:{n:"Navy DMG+",m:600},815:{n:"Navy DMG+",m:600},816:{n:"Navy DMG+",m:600},817:{n:"AF DMG+",m:600},818:{n:"AF DMG+",m:600},819:{n:"AF DMG+",m:600},829:{n:"Army ATK",m:3000},830:{n:"Army ATK",m:3000},831:{n:"Army ATK",m:3000},832:{n:"Navy ATK",m:3000},833:{n:"Navy ATK",m:3000},834:{n:"Navy ATK",m:3000},835:{n:"AF ATK",m:3000},836:{n:"AF ATK",m:3000},837:{n:"AF ATK",m:3000},883:{n:"Army HP",m:3000},884:{n:"Army HP",m:3000},885:{n:"Army HP",m:3000},886:{n:"Navy HP",m:3000},887:{n:"Navy HP",m:3000},888:{n:"Navy HP",m:3000},889:{n:"AF HP",m:3000},890:{n:"AF HP",m:3000},891:{n:"AF HP",m:3000},892:{n:"Army DEF",m:300},893:{n:"Army DEF",m:300},894:{n:"Army DEF",m:300},895:{n:"Navy DEF",m:300},896:{n:"Navy DEF",m:300},897:{n:"Navy DEF",m:300},898:{n:"AF DEF",m:300},899:{n:"AF DEF",m:300},900:{n:"AF DEF",m:300},901:{n:"Army DMG+",m:600},902:{n:"Army DMG+",m:600},903:{n:"Army DMG+",m:600},904:{n:"Navy DMG+",m:600},905:{n:"Navy DMG+",m:600},906:{n:"Navy DMG+",m:600},907:{n:"AF DMG+",m:600},908:{n:"AF DMG+",m:600},909:{n:"AF DMG+",m:600},919:{n:"Army ATK",m:3000},920:{n:"Army ATK",m:3000},921:{n:"Army ATK",m:3000},922:{n:"Navy ATK",m:3000},923:{n:"Navy ATK",m:3000},924:{n:"Navy ATK",m:3000},925:{n:"AF ATK",m:3000},926:{n:"AF ATK",m:3000},927:{n:"AF ATK",m:3000},946:{n:"Army DMG+",m:600},947:{n:"Army DMG+",m:600},948:{n:"Army DMG+",m:600},949:{n:"Navy DMG+",m:600},950:{n:"Navy DMG+",m:600},951:{n:"Navy DMG+",m:600},952:{n:"AF DMG+",m:600},953:{n:"AF DMG+",m:600},954:{n:"AF DMG+",m:600},964:{n:"Army ATK",m:3000},965:{n:"Army ATK",m:3000},966:{n:"Army ATK",m:3000},967:{n:"Navy ATK",m:3000},968:{n:"Navy ATK",m:3000},969:{n:"Navy ATK",m:3000},970:{n:"AF ATK",m:3000},971:{n:"AF ATK",m:3000},972:{n:"AF ATK",m:3000},1000:{n:"Army DMG−",m:600},1001:{n:"Army DMG−",m:600},1002:{n:"Army DMG−",m:600},1003:{n:"Navy DMG−",m:600},1004:{n:"Navy DMG−",m:600},1005:{n:"Navy DMG−",m:600},1006:{n:"AF DMG−",m:600},1007:{n:"AF DMG−",m:600},1008:{n:"AF DMG−",m:600},1018:{n:"Army HP",m:3000},1019:{n:"Army HP",m:3000},1020:{n:"Army HP",m:3000},1021:{n:"Navy HP",m:3000},1022:{n:"Navy HP",m:3000},1023:{n:"Navy HP",m:3000},1024:{n:"AF HP",m:3000},1025:{n:"AF HP",m:3000},1026:{n:"AF HP",m:3000},1045:{n:"Army DMG−",m:600},1046:{n:"Army DMG−",m:600},1047:{n:"Army DMG−",m:600},1048:{n:"Navy DMG−",m:600},1049:{n:"Navy DMG−",m:600},1050:{n:"Navy DMG−",m:600},1051:{n:"AF DMG−",m:600},1052:{n:"AF DMG−",m:600},1053:{n:"AF DMG−",m:600},1063:{n:"Army HP",m:3000},1064:{n:"Army HP",m:3000},1065:{n:"Army HP",m:3000},1066:{n:"Navy HP",m:3000},1067:{n:"Navy HP",m:3000},1068:{n:"Navy HP",m:3000},1069:{n:"AF HP",m:3000},1070:{n:"AF HP",m:3000},1071:{n:"AF HP",m:3000},1072:{n:"Army DMG+",m:600},1073:{n:"Army DMG+",m:600},1074:{n:"Army DMG+",m:600},1075:{n:"Navy DMG+",m:600},1076:{n:"Navy DMG+",m:600},1077:{n:"Navy DMG+",m:600},1078:{n:"AF DMG+",m:600},1079:{n:"AF DMG+",m:600},1080:{n:"AF DMG+",m:600},1081:{n:"Army ATK",m:3000},1082:{n:"Army ATK",m:3000},1083:{n:"Army ATK",m:3000},1084:{n:"Navy ATK",m:3000},1085:{n:"Navy ATK",m:3000},1086:{n:"Navy ATK",m:3000},1087:{n:"AF ATK",m:3000},1088:{n:"AF ATK",m:3000},1089:{n:"AF ATK",m:3000},1090:{n:"Army HP",m:3000},1091:{n:"Army HP",m:3000},1092:{n:"Army HP",m:3000},1093:{n:"Navy HP",m:3000},1094:{n:"Navy HP",m:3000},1095:{n:"Navy HP",m:3000},1096:{n:"AF HP",m:3000},1097:{n:"AF HP",m:3000},1098:{n:"AF HP",m:3000},1099:{n:"Army DEF",m:300},1100:{n:"Army DEF",m:300},1101:{n:"Army DEF",m:300},1102:{n:"Navy DEF",m:300},1103:{n:"Navy DEF",m:300},1104:{n:"Navy DEF",m:300},1105:{n:"AF DEF",m:300},1106:{n:"AF DEF",m:300},1107:{n:"AF DEF",m:300},1108:{n:"Army DMG+",m:600},1109:{n:"Army DMG+",m:600},1110:{n:"Army DMG+",m:600},1111:{n:"Navy DMG+",m:600},1112:{n:"Navy DMG+",m:600},1113:{n:"Navy DMG+",m:600},1114:{n:"AF DMG+",m:600},1115:{n:"AF DMG+",m:600},1116:{n:"AF DMG+",m:600},1117:{n:"Army ATK",m:3000},1118:{n:"Army ATK",m:3000},1119:{n:"Army ATK",m:3000},1120:{n:"Navy ATK",m:3000},1121:{n:"Navy ATK",m:3000},1122:{n:"Navy ATK",m:3000},1123:{n:"AF ATK",m:3000},1124:{n:"AF ATK",m:3000},1125:{n:"AF ATK",m:3000},1126:{n:"Army DMG+",m:600},1127:{n:"Army DMG+",m:600},1128:{n:"Army DMG+",m:600},1129:{n:"Navy DMG+",m:600},1130:{n:"Navy DMG+",m:600},1131:{n:"Navy DMG+",m:600},1132:{n:"AF DMG+",m:600},1133:{n:"AF DMG+",m:600},1134:{n:"AF DMG+",m:600},1135:{n:"Army ATK",m:3000},1136:{n:"Army ATK",m:3000},1137:{n:"Army ATK",m:3000},1138:{n:"Navy ATK",m:3000},1139:{n:"Navy ATK",m:3000},1140:{n:"Navy ATK",m:3000},1141:{n:"AF ATK",m:3000},1142:{n:"AF ATK",m:3000},1143:{n:"AF ATK",m:3000},1144:{n:"Army DMG−",m:600},1145:{n:"Army DMG−",m:600},1146:{n:"Army DMG−",m:600},1147:{n:"Navy DMG−",m:600},1148:{n:"Navy DMG−",m:600},1149:{n:"Navy DMG−",m:600},1150:{n:"AF DMG−",m:600},1151:{n:"AF DMG−",m:600},1152:{n:"AF DMG−",m:600},1153:{n:"Army HP",m:3000},1154:{n:"Army HP",m:3000},1155:{n:"Army HP",m:3000},1156:{n:"Navy HP",m:3000},1157:{n:"Navy HP",m:3000},1158:{n:"Navy HP",m:3000},1159:{n:"AF HP",m:3000},1160:{n:"AF HP",m:3000},1161:{n:"AF HP",m:3000},1162:{n:"Army DMG−",m:600},1163:{n:"Army DMG−",m:600},1164:{n:"Army DMG−",m:600},1165:{n:"Navy DMG−",m:600},1166:{n:"Navy DMG−",m:600},1167:{n:"Navy DMG−",m:600},1168:{n:"AF DMG−",m:600},1169:{n:"AF DMG−",m:600},1170:{n:"AF DMG−",m:600},1171:{n:"Army HP",m:3000},1172:{n:"Army HP",m:3000},1173:{n:"Army HP",m:3000},1174:{n:"Navy HP",m:3000},1175:{n:"Navy HP",m:3000},1176:{n:"Navy HP",m:3000},1177:{n:"AF HP",m:3000},1178:{n:"AF HP",m:3000},1179:{n:"AF HP",m:3000}};
  var RUNE_MAP={10201:{n:"Artillery Storm",s:6,sm:6},10202:{n:"All-Out Surge",s:6,sm:6},10203:{n:"Tactical Awareness",s:2,sm:2},10204:{n:"Searing",s:2,sm:2},10205:{n:"Armor-Breaking",s:2,sm:2},10206:{n:"Impact",s:2,sm:2},10207:{n:"Magnetic Field",s:2,sm:2},10208:{n:"Tactical Awareness",s:0,sm:2},10209:{n:"Searing",s:0,sm:2},10210:{n:"Armor-Breaking",s:0,sm:2},10211:{n:"Impact",s:0,sm:2},10212:{n:"Magnetic Field",s:0,sm:2},20201:{n:"Steel Torrent",s:6,sm:6},20202:{n:"Unbreakable",s:6,sm:6},20203:{n:"Stealth Hologram",s:2,sm:2},20204:{n:"Flammable",s:2,sm:2},20205:{n:"Heavy Blow",s:2,sm:2},20206:{n:"Debilitate",s:2,sm:2},20207:{n:"Magnetize",s:2,sm:2},20208:{n:"Flammable",s:0,sm:2},20209:{n:"Heavy Blow",s:0,sm:2},20210:{n:"Debilitate",s:0,sm:2},20211:{n:"Magnetize",s:0,sm:2},20212:{n:"Stealth Hologram",s:0,sm:2},30201:{n:"Tactical Awareness",s:6,sm:6},30202:{n:"Tactical Awareness",s:2,sm:6},30203:{n:"Searing",s:2,sm:2},30204:{n:"Armor-Breaking",s:2,sm:2},30205:{n:"Impact",s:2,sm:2},30206:{n:"Magnetic Field",s:2,sm:2},30207:{n:"Tactical Awareness",s:0,sm:6},30208:{n:"Searing",s:0,sm:2},30209:{n:"Armor-Breaking",s:0,sm:2},30210:{n:"Impact",s:0,sm:2},30211:{n:"Magnetic Field",s:0,sm:2},40201:{n:"Stealth Hologram",s:6,sm:6},40202:{n:"Stealth Hologram",s:2,sm:6},40203:{n:"Flammable",s:2,sm:2},40204:{n:"Heavy Blow",s:2,sm:2},40205:{n:"Debilitate",s:2,sm:2},40206:{n:"Magnetize",s:2,sm:2},40207:{n:"Flammable",s:0,sm:2},40208:{n:"Heavy Blow",s:0,sm:2},40209:{n:"Debilitate",s:0,sm:2},40210:{n:"Magnetize",s:0,sm:2},40211:{n:"Stealth Hologram",s:0,sm:6},50103:{n:"Searing",s:2,sm:2},50201:{n:"Tactical Awareness",s:6,sm:6},50202:{n:"Tactical Awareness",s:2,sm:6},50203:{n:"Searing",s:2,sm:2},50204:{n:"Armor-Breaking",s:2,sm:2},50205:{n:"Impact",s:2,sm:2},50206:{n:"Magnetic Field",s:2,sm:2},50207:{n:"Tactical Awareness",s:0,sm:6},50208:{n:"Searing",s:0,sm:2},50209:{n:"Armor-Breaking",s:0,sm:2},50210:{n:"Impact",s:0,sm:2},50211:{n:"Magnetic Field",s:0,sm:2},60110:{n:"Magnetize",s:0,sm:2},60201:{n:"Stealth Hologram",s:6,sm:6},60202:{n:"Stealth Hologram",s:2,sm:6},60203:{n:"Flammable",s:2,sm:2},60204:{n:"Heavy Blow",s:2,sm:2},60205:{n:"Debilitate",s:2,sm:2},60206:{n:"Magnetize",s:2,sm:2},60207:{n:"Flammable",s:0,sm:2},60208:{n:"Heavy Blow",s:0,sm:2},60209:{n:"Debilitate",s:0,sm:2},60210:{n:"Magnetize",s:0,sm:2},60211:{n:"Stealth Hologram",s:0,sm:6}};
  function resolveRune(tid) {
    if (RUNE_MAP[tid]) return RUNE_MAP[tid];
    // 6-digit derivation: try base = tid / 10
    var base5 = Math.floor(tid / 10), star = tid % 10;
    var baseData = RUNE_MAP[base5];
    if (baseData) return {n: baseData.n, s: star, sm: baseData.sm};
    // Alternate prefix: {slot}01XX or {slot}03XX → {slot}02XX
    var s = String(tid), slot = s.charAt(0), prefix = s.substring(1, 3);
    if (s.length >= 5 && (prefix === '01' || prefix === '03')) {
      var alt = Number(slot + '02' + s.substring(3));
      if (RUNE_MAP[alt]) return {n: RUNE_MAP[alt].n, s: RUNE_MAP[alt].s, sm: RUNE_MAP[alt].sm};
      // Also try 6-digit derivation on the alternate
      var altBase = Math.floor(alt / 10), altStar = alt % 10;
      if (RUNE_MAP[altBase]) return {n: RUNE_MAP[altBase].n, s: altStar, sm: RUNE_MAP[altBase].sm};
    }
    return null;
  }
  var RUNE_ICON={"All-Out Surge":"all-out-surge","Artillery Storm":"artillery-storm","Unbreakable":"unbreakable","Steel Torrent":"steel-torrent","Tactical Awareness":"tactical-awareness","Stealth Hologram":"stealth-hologram","Searing":"searing","Armor-Breaking":"armor-breaking","Impact":"impact","Magnetic Field":"magnetic-field","Flammable":"flammable","Heavy Blow":"heavy-blow","Debilitate":"debilitate","Magnetize":"magnetize"};
  var ENHANCE_BUFF={"930100":"All ATK","930000":"All HP","930101":"Army ATK","930102":"Navy ATK","930103":"AF ATK","930001":"Army HP","930002":"Navy HP","930003":"AF HP"};
  var SLOT_NAMES={1:"Assault Pistol",2:"Tactical Backarmor",3:"Optical Add-on",4:"Raysor Headset",5:"Portable GPS",6:"Power Boots"};
  function gearSlotNum(equipId) { return Math.floor((equipId % 10000) / 100); }
  function rollColor(pct) { return pct >= 70 ? '#56d364' : pct >= 50 ? '#e3b341' : pct >= 25 ? '#a371f7' : '#6cb6ff'; }
  function runeStarSVG(star, starMax) {
    var maxStars = starMax === 6 ? 3 : 1;
    var fullStars = Math.floor(star / 2);
    var halfStar = star % 2 === 1 ? 1 : 0;
    var emptyStars = maxStars - fullStars - halfStar;
    var wrap = el('span', {style: 'display:inline-flex;gap:1px;vertical-align:middle;margin-left:3px;'});
    var gold = '#e3b341', grey = '#444c56';
    function starSVG(fill) {
      // fill: 'full','half','empty'
      var s = document.createElementNS('http://www.w3.org/2000/svg','svg');
      s.setAttribute('width','10'); s.setAttribute('height','10'); s.setAttribute('viewBox','0 0 24 24');
      if (fill === 'full') {
        var p = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        p.setAttribute('points','12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26');
        p.setAttribute('fill', gold); p.setAttribute('stroke', gold); p.setAttribute('stroke-width','1');
        s.appendChild(p);
      } else if (fill === 'half') {
        var bg = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        bg.setAttribute('points','12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26');
        bg.setAttribute('fill', grey); bg.setAttribute('stroke', gold); bg.setAttribute('stroke-width','1');
        s.appendChild(bg);
        var clip = document.createElementNS('http://www.w3.org/2000/svg','clipPath');
        clip.id = 'hc' + Math.random().toString(36).slice(2);
        var cr = document.createElementNS('http://www.w3.org/2000/svg','rect');
        cr.setAttribute('x','0'); cr.setAttribute('y','0'); cr.setAttribute('width','12'); cr.setAttribute('height','24');
        clip.appendChild(cr); s.appendChild(clip);
        var fp = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        fp.setAttribute('points','12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26');
        fp.setAttribute('fill', gold); fp.setAttribute('clip-path', 'url(#' + clip.id + ')');
        s.appendChild(fp);
      } else {
        var p = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        p.setAttribute('points','12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26');
        p.setAttribute('fill', grey); p.setAttribute('stroke', gold); p.setAttribute('stroke-width','1');
        s.appendChild(p);
      }
      return s;
    }
    for (var i=0;i<fullStars;i++) wrap.appendChild(starSVG('full'));
    for (var i=0;i<halfStar;i++) wrap.appendChild(starSVG('half'));
    for (var i=0;i<emptyStars;i++) wrap.appendChild(starSVG('empty'));
    return wrap;
  }
  function runeIconUrl(runeName) {
    var f = RUNE_ICON[runeName];
    return f ? (ASSET_BASE + 'assets/rune-icons/' + f + '.png') : null;
  }
  function brReportMissingIcon() {} // stub: no-op (see report-render.js header note)
  function exclSkillIconUrl(heroId) {
    return ASSET_BASE + 'assets/exclusive-skill-icons/exc-skill-' + heroId + '.png';
  }
  function skillIconUrl(skillId) {
    return ASSET_BASE + 'assets/skill-icons/skill_icon' + skillId + '.png';
  }
  function heroIconUrl(heroId, awakened) {
    var stem = awakened ? 'hero_awakeicon' : 'hero_icon';
    return 'https://h5.topwargame.com/DynRes/images/headpic/' + stem + heroId + '_global.png?t=22.jpg';
  }
  function heroIconImg(heroId, size, borderClass, awakened) {
    var img = el('img', {
      src: heroIconUrl(heroId, awakened),
      alt: 'Hero ' + heroId,
      width: String(size),
      height: String(size),
      className: borderClass || ''
    });
    if (awakened) {
      img.onerror = function() {
        this.onerror = function() { this.style.display = 'none'; };
        this.src = heroIconUrl(heroId, false);
      };
    } else {
      img.onerror = function() { this.style.display = 'none'; };
    }
    return img;
  }
  function buildSkillToHeroMap(attHeroes, defHeroes) {
    var map = {};
    var allHeroes = (attHeroes || []).concat(defHeroes || []);
    allHeroes.forEach(function(hero) {
      if (!hero || !hero.nonActiveSkills || hero.nonActiveSkills.length === 0) return;
      var skillId = String(hero.nonActiveSkills[0].skillId);
      if (skillId && hero.id) {
        map[skillId] = { heroId: hero.id, skillId: hero.nonActiveSkills[0].skillId };
      }
    });
    return map;
  }
  function skillIconImg(skillId, size) {
    var img = el('img', {
      src: ASSET_BASE + 'assets/skill-icons/skill_' + skillId + '.png',
      alt: 'Skill ' + skillId,
      width: String(size),
      height: String(size),
      className: 'skill-icon'
    });
    img.onerror = function() { this.style.display = 'none'; };
    return img;
  }
  function renderHeroAwakening(heroId, awakenLevel, fullAwaken, skillLevels, awakeRef, iconBase) {
    if (!awakeRef || !awakeRef.heroes) return null;
    var ref = awakeRef.heroes[String(heroId)];
    if (!ref) return null;
    if (!(awakenLevel > 0)) return null;
    var wrap = document.createElement('div');
    wrap.className = 'awaken-panel';
    var hdr = document.createElement('div');
    hdr.className = 'awaken-hdr';
    var lvl = document.createElement('span');
    lvl.className = 'awaken-lvl';
    lvl.textContent = 'Awaken Lv ' + awakenLevel + '/' + (ref.maxAwakenLevel || 40);
    hdr.appendChild(lvl);
    if (ref.awakenLabel) {
      var lab = document.createElement('span');
      lab.className = 'awaken-label';
      lab.textContent = ref.awakenLabel;
      hdr.appendChild(lab);
    }
    if (fullAwaken) {
      var fa = document.createElement('span');
      fa.className = 'awaken-full';
      fa.textContent = 'Full Awaken';
      hdr.appendChild(fa);
    }
    wrap.appendChild(hdr);
    (ref.skills || []).forEach(function (sk) {
      var lv = skillLevels ? (skillLevels[String(sk.awakeningSkillId)] || 0) : 0;
      var rowEl = document.createElement('div');
      rowEl.className = 'awaken-skill' + (lv > 0 ? '' : ' locked');
      var img = document.createElement('img');
      img.className = 'awaken-skill-icon';
      img.src = (iconBase || '') + sk.icon;
      img.alt = '';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      rowEl.appendChild(img);
      var txt = document.createElement('div');
      txt.className = 'awaken-skill-txt';
      var nm = document.createElement('div');
      nm.className = 'awaken-skill-name';
      nm.textContent = sk.name || '';
      if (sk.name) txt.appendChild(nm);
      var lvLine = document.createElement('div');
      lvLine.className = 'awaken-skill-lvl';
      lvLine.textContent = 'Lv ' + lv + '/' + (sk.maxLevel || 10);
      txt.appendChild(lvLine);
      var effLine = document.createElement('div');
      effLine.className = 'awaken-skill-eff';
      var entry = (sk.levels && lv > 0) ? sk.levels[lv - 1] : (sk.levels ? sk.levels[0] : null);
      effLine.textContent = entry ? entry.effect : '';
      txt.appendChild(effLine);
      rowEl.appendChild(txt);
      wrap.appendChild(rowEl);
    });
    return wrap;
  }
  function buildHeroGearSide(players, sideLabel, sideClass) {
    var col = el('div');
    var lbl = el('div', {className: 'attr-side-label'});
    lbl.textContent = sideLabel;
    col.appendChild(lbl);

    (players || []).forEach(function(player) {
      var heroes = player.heroList || [];
      heroes.forEach(function(hero) {
        if (!hero || !hero.id) return;
        var heroId = hero.id;
        var heroName = HERO_NAMES[String(heroId)] || ('#' + heroId);
        var exclInfo = EXCL_SKILL[heroId];
        var exclSkillId = exclInfo ? exclInfo.id : null;

        // Identify exclusive skill entry and equipped skills from nonActiveSkills
        var nonActive = hero.nonActiveSkills || [];
        var exclEntry = exclSkillId ? nonActive.find(function(s){ return s.skillId === exclSkillId; }) : null;
        var equippedSkills = nonActive.filter(function(s){ return s.skillId !== exclSkillId && s.skillId !== (10000 + heroId) && s.skillId !== (2010000 + heroId); });

        // Build card
        var card = el('div', {className: 'attr-hero-card'});
        var hdrDiv = el('div', {className: 'attr-hero-header'});

        var heroAwakened = hero.awakenLevel > 0;
        var heroImg = el('img', {src: heroIconUrl(heroId, heroAwakened), width:'28', height:'28', style:'border-radius:4px;border:1px solid var(--border);'});
        if (heroAwakened) {
          heroImg.onerror = function(){ this.onerror = function(){ this.style.display='none'; }; this.src = heroIconUrl(heroId, false); };
        } else {
          heroImg.onerror = function(){ this.style.display='none'; };
        }
        hdrDiv.appendChild(heroImg);

        var nameSpan = el('span', {className: 'attr-hero-hname'});
        nameSpan.textContent = heroName;
        hdrDiv.appendChild(nameSpan);

        var lvSpan = el('span', {className: 'attr-hero-lv'});
        lvSpan.textContent = 'Lv.' + (hero.level || '?') + (hero.star ? '  \u2605'.repeat(hero.star) : '');
        hdrDiv.appendChild(lvSpan);

        var toggle = el('span', {style:'color:var(--muted);font-size:.7rem;'}, '\u25BC');
        hdrDiv.appendChild(toggle);

        var bodyDiv = el('div', {className: 'attr-hero-body'});

        // Exclusive skill row
        if (exclInfo) {
          var exclRow = el('div', {className: 'attr-excl'});
          var exclImg = el('img', {src: exclSkillIconUrl(heroId), width:'22', height:'22'});
          exclImg.onerror = (function(hid, nm){ return function(){ this.style.display='none'; brReportMissingIcon('exclskill', hid, { name: nm, iconPath: 'assets/exclusive-skill-icons/exc-skill-' + hid + '.png' }); }; })(heroId, exclInfo.n);
          exclRow.appendChild(exclImg);
          var exclNameSpan = el('span', {className: 'attr-excl-name'});
          exclNameSpan.textContent = exclInfo.n;
          exclRow.appendChild(exclNameSpan);
          if (exclEntry) {
            var exclLvSpan = el('span', {className: 'attr-excl-lv'});
            exclLvSpan.textContent = 'Lv.' + exclEntry.level;
            exclRow.appendChild(exclLvSpan);
          }
          bodyDiv.appendChild(exclRow);
        }

        // Equipped skills row
        if (equippedSkills.length > 0) {
          var skillsRow = el('div', {className: 'attr-skills-row'});
          equippedSkills.forEach(function(s) {
            var chip = el('div', {className: 'attr-skill-chip'});
            var sImg = el('img', {src: skillIconUrl(s.skillId), width:'18', height:'18'});
            sImg.onerror = (function(sid){ return function(){ this.style.display='none'; brReportMissingIcon('skill', sid, { iconPath: 'assets/skill-icons/skill_icon' + sid + '.png' }); }; })(s.skillId);
            chip.appendChild(sImg);
            var sLv = el('span', {className: 'attr-skill-lv'});
            sLv.textContent = 'Lv' + s.level;
            chip.appendChild(sLv);
            skillsRow.appendChild(chip);
          });
          bodyDiv.appendChild(skillsRow);
        }

        // Titan gear slots
        var equips = (hero.heroEquips || []).slice().sort(function(a,b){ return gearSlotNum(a.equipId)-gearSlotNum(b.equipId); });
        equips.forEach(function(eq) {
          var slot = gearSlotNum(eq.equipId);
          var slotName = SLOT_NAMES[slot] || ('Slot ' + slot);

          var gearDiv = el('div', {className: 'attr-gear-slot'});
          var slotHead = el('div', {className: 'attr-slot-head'});
          var slotNameSpan = el('span', {className: 'attr-slot-name'});
          slotNameSpan.textContent = slotName + '  Lv.' + (eq.level || '?');
          slotHead.appendChild(slotNameSpan);
          gearDiv.appendChild(slotHead);

          // Rune
          var type2 = (eq.infos || []).find(function(i){ return i.type===2; });
          if (type2) {
            var runeData = resolveRune(type2.templateId);
            var runeName = runeData ? runeData.n : ('Rune #' + type2.templateId);
            var runeWrap = el('div', {className: 'attr-rune-wrap'});
            var iconUrl = runeIconUrl(runeName);
            if (iconUrl) {
              var rImg = el('img', {src: iconUrl, width:'16', height:'16'});
              rImg.onerror = function(){ this.style.display='none'; };
              runeWrap.appendChild(rImg);
            }
            var rNameSpan = el('span', {className: 'attr-rune-name'});
            rNameSpan.textContent = runeName;
            runeWrap.appendChild(rNameSpan);
            if (runeData) runeWrap.appendChild(runeStarSVG(runeData.s, runeData.sm));
            gearDiv.appendChild(runeWrap);
          }

          // Random stats (type=1)
          var type1 = (eq.infos || []).filter(function(i){ return i.type===1; });
          var statsDiv = el('div', {className: 'attr-stats'});
          type1.forEach(function(info) {
            var tmpl = GEAR_TEMPLATE[info.templateId];
            var statName = tmpl ? tmpl.n : ('Stat#' + info.templateId);
            var valPct = (info.buffValue / 100).toFixed(2).replace(/\.?0+$/,'') + '%';
            var rollPct = tmpl ? Math.round(info.buffValue / tmpl.m * 100) : 0;
            var color = rollColor(rollPct);

            var row = el('div', {className: 'attr-stat-row'});
            var nameEl = el('span', {className: 'attr-stat-name'});
            nameEl.textContent = statName;
            row.appendChild(nameEl);
            var valEl = el('span', {className: 'attr-stat-val', style: 'color:' + color});
            valEl.textContent = valPct;
            row.appendChild(valEl);

            // Random stat enhancement value
            if (info.enhanceValue != null && info.enhanceValue > 0) {
              var enhValPct = (info.enhanceValue / 100).toFixed(2).replace(/\.?0+$/,'') + '%';
              var isActive = info.enhanceShow === 2;
              var enhEl = el('span', {className: 'attr-stat-enh ' + (isActive ? 'active' : 'inactive')});
              enhEl.textContent = '+' + enhValPct;
              row.appendChild(enhEl);
              if (isActive) {
                var totalPct = ((info.buffValue + info.enhanceValue) / 100).toFixed(2).replace(/\.?0+$/,'') + '%';
                var totalEl = el('span', {className: 'attr-stat-total'});
                totalEl.textContent = '= ' + totalPct;
                row.appendChild(totalEl);
              }
            }

            var barWrap = el('div', {className: 'attr-stat-bar'});
            var fill = el('div', {className: 'attr-stat-fill', style: 'width:' + rollPct + '%;background:' + color});
            barWrap.appendChild(fill);
            row.appendChild(barWrap);
            var pctEl = el('span', {style: 'font-size:.65rem;color:var(--muted);min-width:28px;text-align:right;'});
            pctEl.textContent = rollPct + '%';
            row.appendChild(pctEl);
            statsDiv.appendChild(row);
          });
          gearDiv.appendChild(statsDiv);

          // Enhancement value
          var enh = eq.enhanceValue || {};
          var enhParts = Object.keys(enh).map(function(k){
            var bName = ENHANCE_BUFF[k] || ('Buff#'+k);
            return bName + ' +' + (enh[k]/100).toFixed(2).replace(/\.?0+$/,'') + '%';
          });
          if (enhParts.length > 0) {
            var enhEl = el('div', {className: 'attr-enh'});
            enhEl.appendChild(document.createTextNode('Enh: '));
            var enhSpan = el('span');
            enhSpan.textContent = enhParts.join('  ');
            enhEl.appendChild(enhSpan);
            gearDiv.appendChild(enhEl);
          }

          bodyDiv.appendChild(gearDiv);
        });

        hdrDiv.addEventListener('click', function(){
          bodyDiv.classList.toggle('open');
          toggle.textContent = bodyDiv.classList.contains('open') ? '\u25B2' : '\u25BC';
        });

        card.appendChild(hdrDiv);
        card.appendChild(bodyDiv);
        col.appendChild(card);
      });
    });
    return col;
  }

  return {
    el: el, fetchReportResponse: fetchReportResponse, loadAwakeningRef: loadAwakeningRef,
    sha256hex: sha256hex, getAvatar: getAvatar, getPlayerInfoRaw: getPlayerInfo2,
    formatPower: formatPower, stripUIDs: stripUIDs, renderOverview: renderOverview,
    buildHeroGearSide: buildHeroGearSide
  };
})();
