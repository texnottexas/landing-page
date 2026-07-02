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
    var avatarUrl = getAvatar(pi);
    var avatar = el('img', { className: 'ta-ov-avatar', alt: '', referrerpolicy: 'no-referrer' });
    if (avatarUrl) avatar.src = avatarUrl;
    avatar.onerror = function () { this.style.visibility = 'hidden'; };
    var card = el('div', { className: 'ta-overview' }, [
      avatar,
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

  // --- copied verbatim from battle-report.html (Task 3: Enigma Beasts) ---
  // Lookup tables (free-var deps of ebBeastName/ebBuffName/ebBeastIconUrl/ebResolveBeasts/buildEnigmaSide):
  // battle-report.html:2457-2463
  var EB_TYPES = {1:'Gleamdeer',2:'Dreadray',3:'Tornadeagle',4:'Grizzroar',5:'Fluffynx',6:'Bounceroo',7:'Swiftsteed',8:'Dusklion',9:'Crestegret'};
  var EB_TYPES_5STAR = {1:'Lumideer',2:'Doomray',3:'Stormpeagle',4:'Ironclaw',5:'Shadowlynx',6:'Thunderoo',7:'Blazesteed',8:'Dawnlion',9:'Royalegret'};
  var EB_ELEMENTS = {1:'Fire',2:'Water',3:'Wind',4:'Ground'};
  var EB_FIELD_NAMES = {1:'CPNT Mastery',2:'Formation',3:'Equip',4:'Defense',5:'Offense'};
  var EB_FIELD_SLOT_COUNTS = {1:5,2:7,3:6,4:9,5:9};
  var EB_ICON_BASE = 'https://raw.githubusercontent.com/texnottexas/landing-page/main/assets/beast-icons/';
  var EB_ELEM_CHARS = {1:'\uD83D\uDD25',2:'\uD83C\uDF2C\uFE0F',3:'\uD83D\uDCA7',4:'\u26F0\uFE0F'};

  // battle-report.html:2465-2489
  var EB_BUFF_NAMES = {
    520000:'March Size',
    520010:'All DMG Increase',520011:'Army DMG Increase',520012:'Navy DMG Increase',520013:'Air DMG Increase',
    520020:'All Decreased DMG Taken',520021:'Army Decreased DMG Taken',520022:'Navy Decreased DMG Taken',520023:'Air Decreased DMG Taken',
    520030:'All DEF Increase',520031:'Army DEF Increase',520032:'Navy DEF Increase',520033:'Air DEF Increase',
    520040:'All ATK (off)',520041:'Army ATK (off)',520042:'Navy ATK (off)',520043:'Air ATK (off)',
    520050:'All HP (off)',520051:'Army HP (off)',520052:'Navy HP (off)',520053:'Air HP (off)',
    520060:'All ATK (def)',520061:'Army ATK (def)',520062:'Navy ATK (def)',520063:'Air ATK (def)',
    520070:'All HP (def)',520071:'Army HP (def)',520072:'Navy HP (def)',520073:'Air HP (def)',
    520100:'Suppression DEF',520101:'Navy DEF vs Army',520102:'Air DEF vs Navy',520103:'Army DEF vs Air',
    520110:'All ATK (off)',520111:'Army ATK (off)',520112:'Navy ATK (off)',520113:'Air ATK (off)',
    520120:'All HP (off)',520121:'Army HP (off)',520122:'Navy HP (off)',520123:'Air HP (off)',
    520130:'All ATK (def)',520131:'Army ATK (def)',520132:'Navy ATK (def)',520133:'Air ATK (def)',
    520140:'All HP (def)',520141:'Army HP (def)',520142:'Navy HP (def)',520143:'Air HP (def)'
  };
  var EB_FIELD_BUFF_NAMES = {
    9301160:'All ATK (field)',9301161:'Army ATK (field)',9301162:'Navy ATK (field)',9301163:'Air ATK (field)',
    9301170:'All HP (field)',9301171:'Army HP (field)',9301172:'Navy HP (field)',9301173:'Air HP (field)',
    1131001:'All Units DMG Increase',1131002:'All Units Decreased DMG Taken',
    980101:'Army DMG Increase',980102:'Navy DMG Increase',980103:'Air Force DMG Increase',
    990203:'Army DEF Increase',990204:'Navy DEF Increase',990205:'Air Force DEF Increase',
    1101015:'Army Decreased DMG Taken',1101016:'Navy Decreased DMG Taken',1101017:'Air Force Decreased DMG Taken',
    1000021:'Formation Bonus',1000022:'Formation Bonus',
    990202:'Combat Bonus'
  };

  // ebDecodeCfg: battle-report.html:2491-2501
  function ebDecodeCfg(cfg) {
    for (var t = 1; t <= 9; t++) {
      for (var f = 1; f <= 4; f++) {
        var q5 = (t - 1) * 20 + f * 5;
        if (q5 === cfg) return { type: t, faction: f, quality: 5 };
        if (q5 - 1 === cfg) return { type: t, faction: f, quality: 4 };
      }
    }
    return { type: 0, faction: 0, quality: 5 };
  }

  // ebBeastName: battle-report.html:2502-2506
  function ebBeastName(type, star) {
    if (star >= 5 && EB_TYPES_5STAR[type]) return EB_TYPES_5STAR[type];
    return EB_TYPES[type] || ('Beast #' + type);
  }

  // ebBuffName: battle-report.html:2507-2508
  function ebBuffName(id) { return EB_BUFF_NAMES[id] || EB_FIELD_BUFF_NAMES[id] || ('Buff #' + id); }

  // ebBeastIconUrl: battle-report.html:2509-2515
  function ebBeastIconUrl(type, faction, star) {
    var name = EB_TYPES[type] || 'Unknown';
    var elem = EB_ELEMENTS[faction] || 'Unknown';
    var tier = star >= 5 ? 'evolved' : 'base';
    return EB_ICON_BASE + name + '_' + elem + '_' + tier + '.png';
  }

  // ebStarStr: battle-report.html:2516-2522
  function ebStarStr(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '\u2605';
    for (var j = n; j < 5; j++) s += '\u2606';
    return s;
  }

  // ebResolveBeasts: battle-report.html:2523-2570
  function ebResolveBeasts(enigmas) {
    if (!enigmas || !enigmas.beastDatas) return { beasts: [], fields: [] };
    var beastMap = {};
    var beasts = enigmas.beastDatas.map(function(b) {
      var info = ebDecodeCfg(b.cfg);
      var resolved = {
        id: b.id, cfg: b.cfg, type: info.type, faction: info.faction,
        quality: info.quality, element: EB_ELEMENTS[info.faction] || 'Unknown',
        name: ebBeastName(info.type, b.star), star: b.star, level: b.level,
        potential: b.potential, maxPotential: info.quality === 4 ? 8000 : 16000,
        power: b.power, mainBuff: b.mainBuff, mainBuffName: ebBuffName(b.mainBuff),
        baseBuff: (b.baseBuff || []).map(function(id) { return { id: id, name: ebBuffName(id) }; }),
        fieldCfg: null, fieldName: null, slotId: null, fieldSlotNum: null, slotLevel: null, slotBuffs: []
      };
      beastMap[b.id] = resolved;
      return resolved;
    });

    var fields = (enigmas.fields || []).map(function(f) {
      var slots = (f.slots || []).map(function(s, idx) {
        var fieldSlotNum = idx + 1;
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
      return {
        cfg: f.cfg, name: EB_FIELD_NAMES[f.cfg] || ('Field ' + f.cfg), active: f.active,
        expectedSlots: EB_FIELD_SLOT_COUNTS[f.cfg] || slots.length,
        slots: slots, deployedCount: slots.filter(function(s) { return s.beast; }).length
      };
    });

    return { beasts: beasts, fields: fields };
  }

  // buildEnigmaSide: battle-report.html:2585-2736 (lifted out of buildEnigmaModal to module top-level).
  function buildEnigmaSide(players, sideLabel) {
    var col = el('div');
    var lbl = el('div', {className: 'enigma-side-label'});
    lbl.textContent = sideLabel;
    col.appendChild(lbl);

    // Gather all enigma data across rally players
    var allResolved = [];
    (players || []).forEach(function(player) {
      if (player.enigmas && player.enigmas.beastDatas && player.enigmas.beastDatas.length > 0) {
        allResolved.push(ebResolveBeasts(player.enigmas));
      }
    });

    if (allResolved.length === 0) {
      col.appendChild(el('div', {className: 'enigma-no-data'}, 'No enigma data'));
      return col;
    }

    // Summary stats across all players
    var totalBeasts = 0, fiveStarCount = 0, activeFields = 0, totalPower = 0;
    allResolved.forEach(function(r) {
      r.beasts.forEach(function(b) {
        totalBeasts++;
        if (b.star >= 5) fiveStarCount++;
        totalPower += (b.power || 0);
      });
      r.fields.forEach(function(f) {
        if (f.active) activeFields++;
      });
    });

    var summaryDiv = el('div', {className: 'enigma-summary'});
    var mkStat = function(label, val) {
      var item = el('div', {className: 'enigma-summary-item'});
      item.appendChild(document.createTextNode(label + ' '));
      var s = el('strong');
      s.textContent = val;
      item.appendChild(s);
      return item;
    };
    summaryDiv.appendChild(mkStat('Beasts:', String(totalBeasts)));
    summaryDiv.appendChild(mkStat('5\u2605:', String(fiveStarCount)));
    summaryDiv.appendChild(mkStat('Active Fields:', String(activeFields)));
    if (totalPower > 0) summaryDiv.appendChild(mkStat('Power:', totalPower.toLocaleString()));
    col.appendChild(summaryDiv);

    // Render fields
    allResolved.forEach(function(resolved) {
      resolved.fields.forEach(function(field) {
        var fieldDiv = el('div', {className: 'enigma-field'});
        var fieldHdr = el('div', {className: 'enigma-field-hdr'});
        var fieldName = el('span', {className: 'enigma-field-name'});
        fieldName.textContent = field.name;
        fieldHdr.appendChild(fieldName);

        var badge = el('span', {className: 'enigma-field-badge ' + (field.active ? 'active' : 'inactive')});
        badge.textContent = field.active ? 'Active' : 'Inactive';
        fieldHdr.appendChild(badge);

        var countSpan = el('span', {style: 'font-size:.65rem;color:var(--muted);'});
        countSpan.textContent = field.deployedCount + '/' + field.expectedSlots;
        fieldHdr.appendChild(countSpan);

        var toggle = el('span', {className: 'enigma-field-toggle'}, '\u25BC');
        fieldHdr.appendChild(toggle);

        var fieldBody = el('div', {className: 'enigma-field-body'});

        // Click to expand/collapse
        fieldHdr.addEventListener('click', function() {
          var isOpen = fieldBody.classList.contains('open');
          fieldBody.classList.toggle('open');
          toggle.textContent = isOpen ? '\u25BC' : '\u25B2';
        });

        // Render each slot
        field.slots.forEach(function(slot) {
          var slotDiv = el('div', {className: 'enigma-slot'});
          var numSpan = el('span', {className: 'enigma-slot-num'});
          numSpan.textContent = '#' + slot.fieldSlotNum;
          slotDiv.appendChild(numSpan);

          if (slot.beast) {
            var b = slot.beast;
            // Icon wrapper
            var iconWrap = el('div', {className: 'enigma-beast-icon-wrap'});
            var img = el('img', {
              className: 'enigma-beast-icon ' + (b.quality >= 5 ? 'q5' : 'q4'),
              src: ebBeastIconUrl(b.type, b.faction, b.star),
              width: '28', height: '28'
            });
            img.onerror = function() { this.style.display = 'none'; };
            iconWrap.appendChild(img);

            // Element overlay
            var elemOverlay = el('span', {className: 'enigma-elem-overlay'});
            elemOverlay.textContent = EB_ELEM_CHARS[b.faction] || '?';
            iconWrap.appendChild(elemOverlay);
            slotDiv.appendChild(iconWrap);

            // Beast info
            var infoDiv = el('div', {className: 'enigma-beast-info'});
            var nameSpan = el('span', {className: 'enigma-beast-name'});
            nameSpan.textContent = b.name;
            infoDiv.appendChild(nameSpan);

            var metaLine = el('div', {style: 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;'});
            var starsSpan = el('span', {className: 'enigma-beast-stars'});
            starsSpan.textContent = ebStarStr(b.star);
            metaLine.appendChild(starsSpan);
            var lvSpan = el('span', {className: 'enigma-beast-lv'});
            lvSpan.textContent = 'Lv.' + b.level;
            metaLine.appendChild(lvSpan);
            var potPct = Math.round((b.potential / b.maxPotential) * 100);
            var potSpan = el('span', {style: 'font-size:.62rem;color:' + (potPct >= 85 ? 'var(--green)' : potPct >= 65 ? 'var(--yellow)' : 'var(--red)') + ';'});
            potSpan.textContent = potPct + '%';
            metaLine.appendChild(potSpan);
            infoDiv.appendChild(metaLine);

            // Main buff
            var mainDiv = el('div', {className: 'enigma-beast-main'});
            mainDiv.textContent = b.mainBuffName;
            infoDiv.appendChild(mainDiv);

            // Slot buffs
            if (slot.buffs && slot.buffs.length > 0) {
              var buffsDiv = el('div', {className: 'enigma-slot-buffs'});
              slot.buffs.forEach(function(sb) {
                var chip = el('span', {className: 'enigma-slot-buff'});
                var valStr = Number(sb.id) === 520000 ? ('+' + Math.round(sb.val)) : ('+' + (Number(sb.val) / 100).toFixed(2) + '%');
                chip.textContent = sb.name + ' ' + valStr;
                buffsDiv.appendChild(chip);
              });
              infoDiv.appendChild(buffsDiv);
            }

            slotDiv.appendChild(infoDiv);
          } else {
            slotDiv.appendChild(el('span', {className: 'enigma-empty-slot'}, '- empty'));
          }
          fieldBody.appendChild(slotDiv);
        });

        fieldDiv.appendChild(fieldHdr);
        fieldDiv.appendChild(fieldBody);
        col.appendChild(fieldDiv);
      });
    });

    return col;
  }

  // --- copied verbatim from battle-report.html (Task 4: Decorations) ---

  // Lookup tables + helpers (deps of buildDecorationSide), factored from

  // buildDecorationModal's att column (battle-report.html is NOT modified).

  var DECOR_ID_TO_GROUP = {"5000":50000,"41703":4170,"41802":4180,"42004":4200,"42104":4210,"42905":4290,"43000":4300,"43101":4310,"43200":4320,"43302":4330,"43402":4340,"43502":4350,"43605":4360,"43702":4370,"46263":5080,"46282":5090,"46563":5321,"46863":5341,"46949":5345,"46980":5347,"46993":5348,"47063":5351,"47079":5352,"47093":5353,"47129":5355,"47146":5356,"47160":5357,"47201":5370,"47250":5383,"47320":5385,"47349":5387,"47374":5398,"47389":5399,"47404":5401,"47459":5425,"47594":5426,"47619":5440,"47634":5441,"47649":5442,"47665":5443,"47678":5444,"47708":5446,"47736":5460,"47753":5461,"47782":5462,"47798":5463,"47834":5480,"47848":5481,"47862":5482,"47879":5484,"47895":5485,"47909":5486,"48206":5493,"48221":5494,"48236":5495,"48250":5498,"48266":5499,"48281":5500,"48311":5502,"48326":5503,"48445":5511,"48462":5512,"48476":5513,"48505":5514,"48520":5515,"48535":5516,"48580":5519,"48616":5522,"48629":5523,"48647":5524,"48675":5526,"48690":5527,"48707":5528,"48721":5529,"48736":5530,"49760":5541,"49806":5544,"49821":5545,"49836":5546,"49851":5547,"49866":5548,"49881":5549,"49895":5550,"49909":5551,"49924":5552,"49941":5553,"49957":5554,"49972":5555,"49986":5556,"50001":5557,"50016":5558,"50046":5560,"50061":5561,"50075":5562,"50091":5564,"50117":5576,"50133":5577,"50148":5578,"50162":5579,"50178":5580,"50193":5581,"50207":5582,"50222":5583,"50253":5585,"50268":5586,"50281":5587,"50297":5588,"50312":5589,"50328":5590,"50342":5591,"50357":5592,"50372":5593,"50402":5595,"50432":5597,"50462":5599,"50477":5600,"50522":5603,"50537":5604,"50552":5605,"50568":5606,"50582":5607,"50597":5614,"50613":5608,"50629":5609,"50640":5610,"50657":5611,"50672":5612,"50688":5613,"50702":5615,"50718":5616,"50733":5617,"50749":5618,"50765":5619,"50779":5620,"50794":5621,"50809":5622,"50825":5624,"50838":5623,"50853":5626,"50868":5627,"50898":5629,"50913":5630,"50928":5631,"50954":5642,"50968":5644,"50984":5645,"50999":5646,"51015":5647,"51029":5648,"51074":5651,"51090":5652,"51104":5653,"51119":5654,"51134":5655,"51149":5656,"51164":5657,"51178":5658,"51194":5659,"51210":5660,"51223":5661,"51238":5662,"51303":5712,"51372":5716,"51388":5711,"51403":5717,"51418":5718,"51433":5719,"51629":5732,"51644":5733,"51659":5734,"51674":5735,"51689":5736,"51703":5737,"51717":5738,"51770":5742,"51785":5743,"51800":5744,"51814":5745,"51829":5746,"51845":5747,"51874":5749,"51889":5750,"51919":5752,"51934":5753,"51949":5754,"51965":5755,"51980":5756,"52003":5761,"52019":5762,"52034":5763,"52049":5764,"52063":5765,"52079":5766,"52289":5781,"52304":5782,"52320":5783,"52335":5784,"52349":5785,"52384":5796,"52399":5797,"52414":5798,"52429":5799,"52445":5800,"52461":5801,"52475":5802,"52491":5803,"52506":5804,"52521":5805,"52536":5806,"52550":5807,"52564":5808,"52585":5809,"52600":5810,"52615":5811,"52650":5822,"52666":5823,"52680":5824,"52695":5825,"52711":5826,"52725":5827,"52906":5839,"52920":5840,"52935":5841,"52950":5842,"52965":5843,"52980":5844,"52995":5845,"53013":5847,"53027":5848,"53042":5849,"53058":5850,"53072":5851,"53088":5852,"53102":5853,"53116":5854,"53131":5855,"53146":5856,"53160":5857,"53176":5858,"53191":5859,"53205":5860,"53222":5861,"53237":5862,"53251":5863,"53267":5864,"53282":5865,"53297":5866,"53312":5867,"53346":5878,"53361":5879,"53376":5880,"53391":5881,"53409":5882,"53630":5896,"53645":5897,"53660":5898,"53675":5899,"53690":5900,"53725":5911,"53739":5912,"53755":5913,"53773":5917,"53788":5918,"53818":5920,"53833":5921,"53849":5922,"53863":5923,"53879":5924,"53894":5925,"53909":5926,"53923":5927,"53938":5928,"53953":5929,"53998":5940,"54014":5941,"54030":5942,"54044":5943,"54060":5944,"54073":5945,"54088":5946,"54103":5947,"54119":5948,"54133":5949,"54149":5950,"54198":5962,"54213":5963,"54228":5964,"54244":5965,"54482":5982,"54497":5983,"54512":5984,"54525":5985,"54542":5986,"54571":5989,"54572":5989,"54573":5989,"54574":5989,"54575":5989,"54576":5989,"54577":5989,"54578":5989,"54579":5989,"54580":5989,"54581":5989,"54582":5989,"54583":5989,"54584":5989,"54585":5989,"54586":5990,"54587":5990,"54588":5990,"54589":5990,"54590":5990,"54591":5990,"54592":5990,"54593":5990,"54594":5990,"54595":5990,"54596":5990,"54597":5990,"54598":5990,"54599":5990,"54600":5990,"54601":5991,"54602":5991,"54603":5991,"54604":5991,"54605":5991,"54606":5991,"54607":5991,"54608":5991,"54609":5991,"54610":5991,"54611":5991,"54612":5991,"54613":5991,"54614":5991,"54615":5991,"101173":5643,"47034":5349,"50031":5559,"47048":5350,"46964":5346,"48341":5504,"46103":5020,"46203":5050,"46043":4800,"47549":5411,"47474":5406,"47504":5408,"47519":5409,"47579":5413,"47564":5412,"47534":5410,"47489":5407,"43903":4390,"48551":5517,"48566":5518,"47334":5386,"50388":5594,"50418":5596,"50493":5601,"50448":5598,"1501":1500,"1502":1501,"1503":1502,"1602":1600,"1601":1601,"40000":4000,"40100":4010,"40200":4020,"40300":4030,"40400":4040,"40500":4050,"40600":4060,"40700":4070,"40800":4080,"40900":4090,"41000":4100,"41100":4110,"41200":4120,"41300":4130,"41400":4140,"41500":4150,"41600":4160,"42300":4230,"42400":4240,"42800":4280,"44000":4400,"45000":4500,"47810":4781,"47820":4782,"46060":4810,"47001":5001,"47002":5002,"47003":5003,"47004":5004,"47005":5005,"47006":5006,"46220":5060,"46875":5342,"46890":5343,"46906":5344,"47182":5369,"47301":5372,"47612":5436,"47691":5445,"47731":5457,"47732":5458,"47733":5459,"47779":5479,"47875":5483,"47921":5487,"47936":5488,"47951":5489,"475011":5490,"48353":5505,"48383":5507,"48398":5508,"48413":5509,"48428":5510,"48593":5520,"48603":5521,"48658":5525,"50105":5566,"50106":5567,"50107":5568,"50108":5569,"50109":5570,"50110":5571,"50111":5572,"50112":5573,"50113":5574,"50235":5584,"50505":5602,"50881":5628,"51041":5649,"51056":5650,"51252":5664,"51446":5720,"51461":5721,"51476":5722,"51491":5723,"51506":5724,"51521":5725,"51536":5726,"51551":5727,"51566":5728,"51581":5729,"51596":5730,"51611":5731,"51731":5739,"51746":5740,"51761":5741,"52091":5767,"52137":5771,"52272":5780,"52738":5828,"52753":5829,"52768":5830,"52783":5831,"52798":5832,"52813":5833,"52828":5834,"52843":5835,"52858":5836,"52873":5837,"52888":5838,"53433":5883,"53448":5884,"53463":5885,"53478":5886,"53493":5887,"53508":5888,"53523":5889,"53538":5890,"53553":5891,"53568":5892,"53583":5893,"53598":5894,"53613":5895,"53768":5914,"53769":5915,"53770":5916,"54161":5951,"54162":5951,"54163":5951,"54164":5951,"54165":5951,"54166":5951,"54167":5951,"54168":5951,"54169":5951,"54170":5951,"54171":5951,"54172":5951,"54173":5951,"54174":5951,"54175":5951,"54300":5970,"54315":5971,"54330":5972,"54345":5973,"54360":5974,"54375":5975,"54390":5976,"54405":5977,"54420":5978,"54435":5979,"54450":5980,"54465":5981,"70001":7000,"20001":7100,"20002":7101,"54706":6001,"54716":6001,"54707":6002,"54717":6002,"54708":6003,"54718":6003,"54709":6004,"54719":6004,"54710":6005,"54720":6005,"54711":6006,"54721":6006,"54712":6007,"54722":6007,"54713":6008,"54723":6008,"54714":6009,"54724":6009,"54715":6010,"54725":6010,"54731":6011,"54732":6012,"54733":6013};

  var DECOR_GROUP_BASE = {"4170":41700,"4180":41800,"4200":42001,"4210":42101,"4290":42900,"4300":43000,"4310":43100,"4320":43200,"4330":43300,"4340":43400,"4350":43500,"4360":43600,"4370":43700,"5080":46260,"5090":46280,"5321":46560,"5341":46860,"5345":46946,"5347":46976,"5348":46991,"5351":47060,"5352":47075,"5353":47090,"5355":47126,"5356":47141,"5357":47156,"5370":47197,"5383":47246,"5385":47316,"5387":47346,"5398":47371,"5399":47386,"5401":47401,"5425":47456,"5426":47591,"5440":47616,"5441":47631,"5442":47646,"5443":47661,"5444":47676,"5446":47706,"5460":47734,"5461":47749,"5462":47780,"5463":47795,"5480":47830,"5481":47845,"5482":47860,"5484":47876,"5485":47891,"5486":47906,"5493":48202,"5494":48217,"5495":48232,"5498":48248,"5499":48263,"5500":48278,"5502":48308,"5503":48323,"5511":48443,"5512":48458,"5513":48473,"5514":48503,"5515":48518,"5516":48533,"5519":48578,"5522":48613,"5523":48628,"5524":48643,"5526":48673,"5527":48688,"5528":48703,"5529":48718,"5530":48733,"5541":49758,"5544":49803,"5545":49818,"5546":49833,"5547":49848,"5548":49863,"5549":49878,"5550":49893,"5551":49908,"5552":49923,"5553":49938,"5554":49953,"5555":49968,"5556":49983,"5557":49998,"5558":50013,"5560":50043,"5561":50058,"5562":50073,"5564":50089,"5576":50115,"5577":50130,"5578":50145,"5579":50160,"5580":50175,"5581":50190,"5582":50205,"5583":50220,"5585":50250,"5586":50265,"5587":50280,"5588":50295,"5589":50310,"5590":50325,"5591":50340,"5592":50355,"5593":50370,"5595":50400,"5597":50430,"5599":50460,"5600":50475,"5603":50520,"5604":50535,"5605":50550,"5606":50565,"5607":50580,"5608":50610,"5609":50625,"5610":50640,"5611":50655,"5612":50670,"5613":50685,"5614":50595,"5615":50700,"5616":50716,"5617":50731,"5618":50746,"5619":50761,"5620":50776,"5621":50791,"5622":50806,"5623":50836,"5624":50821,"5626":50851,"5627":50866,"5629":50896,"5630":50911,"5631":50926,"5642":50951,"5643":101173,"5644":50966,"5645":50981,"5646":50996,"5647":51011,"5648":51026,"5651":51071,"5652":51086,"5653":51101,"5654":51116,"5655":51131,"5656":51146,"5657":51161,"5658":51176,"5659":51191,"5660":51206,"5661":51221,"5662":51236,"5711":51386,"5712":51300,"5716":51370,"5717":51401,"5718":51416,"5719":51431,"5732":51626,"5733":51641,"5734":51656,"5735":51671,"5736":51686,"5737":51701,"5738":51716,"5742":51767,"5743":51782,"5744":51797,"5745":51812,"5746":51827,"5747":51842,"5749":51872,"5750":51887,"5752":51917,"5753":51932,"5754":51947,"5755":51962,"5756":51977,"5761":52001,"5762":52016,"5763":52031,"5764":52046,"5765":52061,"5766":52076,"5781":52287,"5782":52302,"5783":52317,"5784":52332,"5785":52347,"5796":52382,"5797":52397,"5798":52412,"5799":52427,"5800":52442,"5801":52457,"5802":52472,"5803":52487,"5804":52502,"5805":52517,"5806":52532,"5807":52547,"5808":52562,"5809":52583,"5810":52598,"5811":52613,"5822":52648,"5823":52663,"5824":52678,"5825":52693,"5826":52708,"5827":52723,"5839":52903,"5840":52918,"5841":52933,"5842":52948,"5843":52963,"5844":52978,"5845":52993,"5847":53009,"5848":53024,"5849":53039,"5850":53054,"5851":53069,"5852":53084,"5853":53099,"5854":53114,"5855":53129,"5856":53144,"5857":53159,"5858":53174,"5859":53189,"5860":53204,"5861":53219,"5862":53234,"5863":53249,"5864":53264,"5865":53279,"5866":53294,"5867":53309,"5878":53344,"5879":53359,"5880":53374,"5881":53389,"5882":53407,"5896":53628,"5897":53643,"5898":53658,"5899":53673,"5900":53688,"5911":53723,"5912":53738,"5913":53753,"5917":53771,"5918":53786,"5920":53816,"5921":53831,"5922":53846,"5923":53861,"5924":53876,"5925":53891,"5926":53906,"5927":53921,"5928":53936,"5929":53951,"5940":53996,"5941":54011,"5942":54026,"5943":54041,"5944":54056,"5945":54071,"5946":54086,"5947":54101,"5948":54116,"5949":54131,"5950":54146,"5962":54196,"5963":54211,"5964":54226,"5965":54241,"5982":54480,"5983":54495,"5984":54510,"5985":54525,"5986":54540,"5989":54571,"5990":54586,"5991":54601,"50000":5000,"5349":47030,"5559":50028,"5350":47045,"5346":46961,"5504":48338,"5020":46100,"5050":46200,"4800":46040,"5411":47546,"5406":47471,"5408":47501,"5409":47516,"5413":47576,"5412":47561,"5410":47531,"5407":47486,"4390":43900,"5517":48548,"5518":48563,"5386":47331,"5594":50385,"5596":50415,"5601":50490,"5598":50445,"1500":1501,"1501":1502,"1502":1503,"1600":1602,"1601":1601,"4000":40000,"4010":40100,"4020":40200,"4030":40300,"4040":40400,"4050":40500,"4060":40600,"4070":40700,"4080":40800,"4090":40900,"4100":41000,"4110":41100,"4120":41200,"4130":41300,"4140":41400,"4150":41500,"4160":41600,"4230":42300,"4240":42400,"4280":42800,"4400":44000,"4500":45000,"4781":47810,"4782":47820,"4810":46060,"5001":47001,"5002":47002,"5003":47003,"5004":47004,"5005":47005,"5006":47006,"5060":46220,"5342":46875,"5343":46890,"5344":46906,"5369":47182,"5372":47301,"5436":47612,"5445":47691,"5457":47731,"5458":47732,"5459":47733,"5479":47779,"5483":47875,"5487":47921,"5488":47936,"5489":47951,"5490":475011,"5505":48353,"5507":48383,"5508":48398,"5509":48413,"5510":48428,"5520":48593,"5521":48603,"5525":48658,"5566":50105,"5567":50106,"5568":50107,"5569":50108,"5570":50109,"5571":50110,"5572":50111,"5573":50112,"5574":50113,"5584":50235,"5602":50505,"5628":50881,"5649":51041,"5650":51056,"5664":51252,"5720":51446,"5721":51461,"5722":51476,"5723":51491,"5724":51506,"5725":51521,"5726":51536,"5727":51551,"5728":51566,"5729":51581,"5730":51596,"5731":51611,"5739":51731,"5740":51746,"5741":51761,"5767":52091,"5771":52137,"5780":52272,"5828":52738,"5829":52753,"5830":52768,"5831":52783,"5832":52798,"5833":52813,"5834":52828,"5835":52843,"5836":52858,"5837":52873,"5838":52888,"5883":53433,"5884":53448,"5885":53463,"5886":53478,"5887":53493,"5888":53508,"5889":53523,"5890":53538,"5891":53553,"5892":53568,"5893":53583,"5894":53598,"5895":53613,"5914":53768,"5915":53769,"5916":53770,"5951":54161,"5970":54300,"5971":54315,"5972":54330,"5973":54345,"5974":54360,"5975":54375,"5976":54390,"5977":54405,"5978":54420,"5979":54435,"5980":54450,"5981":54465,"7000":70001,"7100":20001,"7101":20002};

  // Build reverse baseId -> group lookup for level-agnostic matching (battle-report.html:1172-1175)

  var DECOR_BASE_TO_GROUP = {};

  for (var _gbk in DECOR_GROUP_BASE) {

    DECOR_BASE_TO_GROUP[DECOR_GROUP_BASE[_gbk]] = parseInt(_gbk);

  }

  var DECOR_GROUPS = {"4170":"Sandbag Fort","4180":"Thanksgiving Turkey","4200":"Christmas tree","4210":"Snowman","4290":"Sandcastle Toolkit","4300":"Food","4310":"Recliner","4320":"Beach Umbrella","4330":"Ammo Box","4340":"F-1","4350":"Artillery shell","4360":"Timer","4370":"Cherry Tree","5080":"Spotlight Tower","5090":"Giant Killer","5321":"Hunter of the Deep","5341":"The Peaceful Bamboo","5345":"New Year Bonfire","5347":"Mermaid","5348":"KEEP OUT","5351":"Celebratory Firework","5352":"Sentry Post","5353":"Fire Hydrant","5355":"Weapon Box","5356":"Burning Feather","5357":"The Emerging Phoenix","5370":"Easter Eggs","5383":"Auto-retractable Gate","5385":"Torii Gate","5387":"Moss Lantern","5398":"Royal Dragon Boat","5399":"Restricted Zone","5401":"Military camp","5425":"Floating Dock","5426":"Hold The Fort","5440":"Lucky \"Wheel\"","5441":"BH-2000","5442":"Coastal Defence","5443":"Royal Parade","5444":"Asian Archway","5446":"Anpu Altar Statue","5460":"Cheers, mate","5461":"Olive Wreath","5462":"Pretty Chill 2022","5463":"Green Energy","5480":"War Chariot","5481":"War Galley","5482":"Spring Festival Float","5484":"Unicorn Starlight","5485":"Unicorn Sparky","5486":"Chemistry in the Air","5493":"Nightmare Cannon","5494":"Hardcore Shooter","5495":"Ancient Drum","5498":"Dragon Kite","5499":"Blue Dandelion","5500":"Goddess of Light","5502":"Landing on Water","5503":"\"Go for it\" Rubber Boat","5511":"Guardian Lion","5512":"Ancient Brazier","5513":"The Messenger","5514":"Statue: 4th Angel","5515":"Statue: 5th Angel","5516":"Statue: 6th Angel","5519":"Statue: EVA Unit-00","5522":"Four-Legged Fighter","5523":"Naval Mine","5524":"Flying Messenger","5526":"Shoe Phone","5527":"Truly Amazing","5528":"Let's Dance, Babe","5529":"GOAL!!","5530":"Thanksgiving Feast","5541":"Hippie Dragon","5544":"Cutie & Fluffy","5545":"Lucky & Lovely","5546":"Lovable & Huggable","5547":"Blossom With Love","5548":"When Love Sprouts","5549":"Hidden Fire","5550":"Gas Station","5551":"Water Tower","5552":"Communication Cable","5553":"Oil Storage Tank","5554":"Camouflage Truck","5555":"Cargo Port","5556":"Seafarer's Beacon","5557":"Gipsy Danger Statue","5558":"Knifehead Statue","5560":"Leatherback Statue","5561":"Crimson Typhoon Statue","5562":"Otachi Statue","5564":"Choco Indulgence","5576":"Ethereal Gold Pavilion","5577":"Cherno Alpha Statue","5578":"Shrikethorn Statue","5579":"Striker Eureka Statue","5580":"Raiju Statue","5581":"Slattern Statue","5582":"Ripper Statue","5583":"Rice Rider","5585":"Timber Titan","5586":"Elite Punching bag","5587":"Combat Dummy","5588":"Statue: EVA Unit-02","5589":"Statue: 7th Angel","5590":"Statue: 8th Angel","5591":"Statue: 9th Angel - the Corrupted Mecha","5592":"Statue: 10th Angel","5593":"Statue: EVA Mark.06","5595":"Volt Wraith","5597":"Howl Wing","5599":"Radburst","5600":"One Horn","5603":"Rosy Alpha","5604":"Mega Bite","5605":"Sky Surfer","5606":"Lunar Fairy","5607":"Serene Moments","5608":"Boxing Ring","5609":"Shooting Range","5610":"Wire Sandpit","5611":"Boulder Structure","5612":"Swing Bridge","5613":"Huge Log","5614":"Combat Simulation","5615":"Giant Tire","5616":"Mischief Master","5617":"Sorcery Box","5618":"Duke Statue","5619":"Scarlett Statue","5620":"Snake Eyes Statue","5621":"Baroness Statue","5622":"Storm Shadow Statue","5623":"Cobra Commander Statue","5624":"Cobra Viper Statue","5626":"Bountiful Harvest","5627":"Score!","5629":"Knight Statue","5630":"Brawler Statue","5631":"Smiles on Hold","5642":"New Year, Fresh Start","5643":"The Grand Array","5644":"Dragon of Wealth","5645":"Eternity Love","5646":"Meowjesty","5647":"Happy Cat","5648":"Dragon Lantern Delight","5651":"Po's Statue","5652":"Monkey's Statue","5653":"Zhen's Statue","5654":"Tai Lung's Statue","5655":"Lord Shen's Statue","5656":"General Kai's Statue","5657":"The Chameleon's Statue","5658":"Mr. Ping's Statue","5659":"Kung Fu Soldier - Blue Statue","5660":"Kung Fu Soldier - Red Statue","5661":"Set Sail","5662":"Blade of Illusion","5711":"That's the Vibe","5712":"Food Camp","5716":"Airdrop Joy","5717":"Triumph Tunnel","5718":"Training Turret","5719":"Mountain Barrier","5732":"Zartan Statue","5733":"Dr. Mindbender Statue","5734":"Serpentor Statue","5735":"Roadblock Statue","5736":"Perilla Warrior","5737":"Shattered Sky","5738":"Linked Bridge","5742":"Cranes in Clouds","5743":"Noble Mansion","5744":"Refreshing Water Bar","5745":"Wave Riders","5746":"Chiran Loong","5747":"Lion Dance Decoration","5749":"Training Barrier Walls","5750":"Tire Wall","5752":"Obstacle Course","5753":"Helicopter Sim Pod","5754":"Crawl Cage","5755":"Destroyer","5756":"Aircraft Carrier","5761":"Crane Statue","5762":"Viper Statue","5763":"Mantis Statue","5764":"Tigress Statue","5765":"Shifu Statue","5766":"Dark Leader Statue","5781":"Shape of Wind","5782":"Shape of Water","5783":"Shape of Fire","5784":"Enigma Surge","5785":"Moonlit Toast","5796":"Prank Specialist","5797":"Mischief Pumpkin","5798":"Tree of Glory","5799":"Friendship Hall","5800":"Mirror of Truth","5801":"Leon S. Kennedy Statue","5802":"Claire Redfield Statue","5803":"Ada Wong Statue","5804":"Soldier Zombie","5805":"Worker Zombie","5806":"Tyrant Statue","5807":"William Birkin Statue","5808":"Green Herb Statue","5809":"Picnic Time","5810":"Penguin Home","5811":"Holiday Hat","5822":"Festive Gifts","5823":"Spring Festival Sparks","5824":"Festival Lion Dance","5825":"Big Glowy Bitey","5826":"Eternal Ice","5827":"Crystal of Power","5839":"Ruby Feather","5840":"Blazing Feather","5841":"Flamingo Heart","5842":"Coconut Hammock","5843":"Prosperity & Harmony","5844":"Stormwings","5845":"Warcharger","5847":"Jill Valentine Statue","5848":"Chris Redfield Statue","5849":"Cerberus Statue","5850":"Hunter Statue","5851":"Supreme Zombie Statue","5852":"Typewriter Statue","5853":"Umbrella Statue","5854":"Dignified","5855":"Focusing Prism","5856":"Volatile Goods","5857":"Toothless Statue (Supreme)","5858":"Gate of Heroes","5859":"Magnetic Storm Array","5860":"Light Fury Statue (Supreme)","5861":"Skullcrusher Statue","5862":"Stoick Statue","5863":"Baby Meatlug Statue","5864":"Baby Scuttleclaws Statue","5865":"Meatlug Statue","5866":"Hookfang Statue","5867":"Hiccup Statue","5878":"Deep Space Telescope","5879":"Space Energy Wing","5880":"Heavy Gunner","5881":"Micro-Scout","5882":"Quack Attack!","5896":"Crystalline Particle Lens","5897":"Dynamic Database","5898":"Pint-Sized Fortress","5899":"Leviathan Sub","5900":"Cargo Dock","5911":"Osmanthus Moon","5912":"Galactic Station","5913":"Gravitic Wave Radar","5917":"Sweetdream Moon","5918":"Phantom Mage","5920":"Annular Gun Pit","5921":"Stormfly Statue","5922":"Valka Statue","5923":"Bewilderbeast Statue","5924":"Barf and Belch Statue","5925":"Terrible Terror Statue","5926":"Cloudjumper Statue","5927":"Astrid Statue","5928":"Muffin Santa","5929":"Cherry Reindeer","5940":"Warship Dockyard","5941":"Frostfiend Yeti","5942":"Crystalline Tank","5943":"Glacial Dreadnought","5944":"Azure Frostjet","5945":"Grand Debut","5946":"Navigation Lighthouse","5947":"Rockin' Coffee Cup","5948":"Swirling Cone","5949":"Vibrant Balloon","5950":"Aqua Bumper Cars","5962":"Spring Splendor","5963":"Everlasting Fortune","5964":"Joyful Harmony","5965":"Dream Pegasus","5982":"Luminous Moon","5983":"Invincible Chariot","5984":"Amphibious Rover","5985":"Seal Stone Heart","5986":"Cosmic Star Chart","5989":"Magic Egg Hat","5990":"Bunny Eggshell House","5991":"Bunny Colossus","50000":"Purifying Turbine","4820":"Holiday Hotel","4821":"Holiday Hammock","4822":"Holiday Dock","4823":"Holiday Picnic Spot","4824":"Holiday Tower","4825":"Holiday Redchair","4826":"Holiday Bluechair","4827":"Holiday Island","4828":"Holiday Coconut","4829":"Holiday Coconut Forest","4830":"Holiday Yacht","4831":"Beached Ship","4832":"Goddess of Victory","4833":"Hanging Boat","4834":"Roaring Cannon","4835":"Captain's Log","4836":"Dirty Rope","4837":"Captain's Chest","4838":"Lost Treasure","4839":"Red Rum","4840":"Money Bag","5100":"Black Cat","5101":"Home, Sweet Home","5102":"Wishing Star Tree","5103":"Joyful Train","5104":"Colorful Light Bulbs","5105":"Mr. Frosty","5106":"Warm Socks","5107":"Pine Trees","5108":"Golden Sleigh","5109":"Gifts Are All Around","5110":"Lightning-fast Reindeers","5120":"Cooking Pot","5140":"Scary Pumpkin","5160":"Light Candle","5180":"Exquisite Coffin","5200":"Cracked Coffin","5220":"Lonely Cemetery","5240":"Bizarre Tree","5260":"The Screamer","5280":"Giggling Castle","5322":"Dinner Table","5323":"Tasty Turkey","5324":"Fiery Oven","5325":"Fine Wine","5326":"Homemade Baguette","5327":"Flower Basket","5328":"Pumpkin Pie","5329":"Cranberry Jam","5330":"Straw Man","5331":"Straw Woman","5358":"Fairy Carousel","5359":"Gimme-a-hug","5360":"TW-4K Pro","5361":"Caramel Donuts","5362":"True Beauty","5363":"Dark Chocolate","5364":"Cat Ear Headphones","5365":"Crystal Ball","5366":"Stylist Flower Box","5367":"Gaming Controller","5373":"Tent Room","5374":"Fest and Feast","5375":"Nighty-night Lantern","5376":"Desert Palm","5377":"Coffee & Dates","5378":"Load-it-up","5379":"Lights on Palms","5380":"Star and Crescent","5381":"Salute Cannon","5382":"Golden Burner","5388":"Roller Coaster","5389":"Grand Circus","5390":"Musical Carousel","5391":"Clown Tent","5392":"Real Dino","5393":"Musical Fountain","5394":"Bumper Cars","5395":"Floating Balloon","5396":"Ice-cream Truck","5397":"Big Toy Plane","5415":"Abandoned Supplies","5416":"Spare Tires","5417":"Battle Flag","5418":"Guard Post","5419":"Anti Crash Barrier","5420":"Razor Wire Barrier","5421":"Support Trench","5422":"Field Trench","5423":"Low-Altitude Radar","5424":"Elaborate Fort","5430":"Large Factory","5431":"Pipe & Smoke","5432":"Steam Locomotive","5433":"First Car 1886","5434":"150 Gal. Oil Tank","5435":"Rusty Iron Tank","5437":"Junk Gears","5438":"Blast Furnace","5439":"Conveyor Belt","5447":"Pumpkin Cottage","5448":"Pipe Slime","5449":"High-fat Cake","5450":"Pumpkin LED Lamp","5451":"Flight Partners","5452":"Spicy Onion","5453":"Precious Headstone","5454":"Happy Pilot","5455":"Eyeball Cake","5456":"The Pleeease Face","5470":"Holiday Bonfire","5471":"Mr. & Mrs. Ice","5472":"Lucky Cedar","5473":"Xmas Kitten House","5474":"Ice Reindeer","5475":"Ice Star","5476":"Ice Jingle","5477":"Sweet Street Light","5478":"Magic Grass","5531":"Joyful Tricycle","5532":"MC White Beard","5533":"Sweetheart Dancer","5534":"Mr. Reindeer","5535":"Holiday Snowman","5536":"Chocobean Box","5537":"Unexpected Gift","5538":"DJ Cedar","5539":"Couple Bottles","5540":"Christmas Balloons","5565":"Snooze Pad","5632":"Launch Path","5633":"Zip Line","5634":"Trio Sled","5635":"Snowboard Pro","5636":"Snow Racer","5637":"Snowscape Hotel","5638":"Gift Nook","5639":"Disguised Deer","5640":"Lucky & Joyful","5641":"Lights Sign","5701":"Showtime","5702":"Rhythm Master","5703":"Melodic Pause","5704":"Saxophone Music","5705":"Music Fever","5706":"Lead Tune","5707":"Immersive Audio","5708":"Echo Blend","5709":"Bass Quake","5710":"Sonic Boom","5786":"Formation of the Five","5787":"Plum Blossom Pillars","5788":"Martial Altar","5789":"Weapon Stand","5790":"Rock Lifter","5791":"Rock Barbell","5792":"Golden Sword","5793":"Curved Bow","5794":"Dynasty Chair","5795":"Iron Palm Pot","5812":"Soothing Hot Springs","5813":"Ice Hockey Clash","5814":"Seal's Snuggle","5815":"Luxury VIP Seats","5816":"Snowy Piste","5817":"Red Hat Defender","5818":"Frozen Lounger","5819":"Bear Hug","5820":"Penguin Striker","5821":"Chief Penguin","5868":"Galactic Surf","5869":"Holo-Fence","5870":"Friendship I","5871":"Celestial Simulator","5872":"Homeward Beacon","5873":"Stone from Beyond","5874":"The Giant Leap","5875":"Xeno-Saucer","5876":"Spacewalk Set","5877":"Stargazer","5901":"Life Unending","5902":"Warrior's Spring","5903":"Draconic Chiller","5904":"A New Hope","5905":"Twin-Horned Warship","5906":"Draconic Toxin Emitter","5907":"Magical Crossbow","5908":"Hammer of Zeal","5909":"Draconic Dryer","5910":"Draconic Flamethrower","5930":"Strawberry Jam Shack","5931":"Waffle Mill","5932":"Milky Cauldron","5933":"Cookie Gate","5934":"Cotton Candy Cedar","5935":"Frosted Watermelon Tree","5936":"Syrup Workshop","5937":"Waffle Cone Gazebo","5938":"Pudding Well","5939":"Candy Cart","5952":"Boundless Vitality","5953":"Calculated Angle","5954":"Hot Streak","5955":"Rapid Fire","5956":"Fadeaway Drift","5957":"Peak Performance","5958":"Ace Serve","5959":"Speed Hurdles","5960":"Galloping Lead","5961":"One Shot, One Goal","5349":"Jumpy","5559":"Coyote Tango Statue","5350":"Skippy","5346":"New Year Clock Tower","5504":"Armor Breaker","5020":"Mini Balloon","5050":"The Pond – Moonlight","4800":"Kiosk","5411":"Soundwave Statue","5406":"Optimus Prime Statue","5408":"Bumblebee Statue","5409":"Starscream Statue","5413":"Laserbeak Statue","5412":"Ramhorn Statue","5410":"Blaster Statue","5407":"Megatron Statue","4390":"Holiday Fishing","5517":"Statue: Pen Pen","5518":"Statue: EVA Unit-01","5386":"Florist Lantern","5594":"Cosmos Guardian","5596":"Aureus Warrior","5601":"Wind Lash","5598":"Amplifier","1500":"Tile","1501":"Red Tile","1502":"Beige Tile","1600":"Flag","1601":"Ornamental Tree","4000":"City Wall","4010":"Green Apple Tree","4020":"Cedar","4030":"Battlement","4040":"Lantern","4050":"Purple Tile","4060":"Freeway","4070":"Lucky Fountain","4080":"Bench","4090":"Gift Box","4100":"Commander Statue","4110":"Twins Rocking Horse","4120":"Golden Tank","4130":"Rocking Horse","4140":"Dragon Boat","4150":"Tank Monument","4160":"Scenic Flower","4230":"Golden Plane","4240":"Cupid","4280":"Navy monument","4400":"Holiday Sailboat","4500":"Slide","4781":"Onyx Gate","4782":"Excalibur","4810":"Life Buoy","5001":"Fort","5002":"Lighthouse","5003":"Carrier wreckage","5004":"Broadcasting station","5005":"Tank wreckage","5006":"Giant fish wreckage","5060":"Green Vine Fence","5342":"Super Ammo Workshop","5343":"Super Gun Turret","5344":"Golden Warship","5369":"Clown Box","5372":"Medal Stand","5436":"Hydraulic Crane","5445":"Bring That Fire","5457":"Great Commander","5458":"Legendary Commander","5459":"Marvelous Commander","5479":"Russian Blue","5483":"CVS-36","5487":"Unicron Statue","5488":"Arcee Statue","5489":"Sharkticon Statue","5490":"Striker Eureka Statue","5505":"Seaspray Statue","5507":"Del Toro Statue","5508":"Diamanto Statue","5509":"Sasso Statue","5510":"You May Laugh Now","5520":"Maglev Cabin","5521":"Floating Cannon","5525":"Slam Dunk","5566":"Dreamcatcher","5567":"Nonchalant Rebel","5568":"Sunbather","5569":"Fish Hunter","5570":"Pawsome Interaction","5571":"Purrfect Companion","5572":"Leap of Faith","5573":"Paw-sitive Feedback","5574":"Skyscape Observer","5584":"Air Force Monument","5602":"Cosmic Oracle","5628":"Warrior Statue","5649":"Fortune Sticks","5650":"Gashapon Machine","5664":"Ritual Site","5720":"Safety Guard","5721":"The Claw","5722":"Street Dancer","5723":"Minotaur","5724":"Dark Storm","5725":"Bat Beast","5726":"Sierra Delta","5727":"Scorpion Man","5728":"Archimedes' Revenge","5729":"Speedy Cat","5730":"Shapeshifter","5731":"The Biter","5739":"Endless Glory","5740":"Infinite Energy","5741":"Relentless Spirit","5767":"Eternal Spring","5771":"Penqueen","5780":"Shape of Earth","5828":"Sunlit Captain","5829":"Redfire Gatling","5830":"Midnight Blade","5831":"Lady of Shadows","5832":"Frost Whisper","5833":"Shadow Masks","5834":"Shadow Commander","5835":"Haze Slicer","5836":"Dr. Flash","5837":"The Viper","5838":"Pathbreaker","5883":"Ironbelly","5884":"Gilt-fur","5885":"Fox Sentinel","5886":"Frost-Claw","5887":"Azure Prince","5888":"Ironhorn","5889":"Chromatic Mystic","5890":"Master Bao","5891":"Sage Crane","5892":"Viper Rhapsodist","5893":"Gold Wasp","5894":"Lion Warrior","5895":"Chronicler","5914":"Aether Star","5915":"Zenith Star","5916":"Nascent Star","5951":"Floating Beacon","5970":"Rookie Officer","5971":"Rookie Detective","5972":"Alluring Agent","5973":"The Avenger","5974":"White-Clad Enforcer","5975":"Green Herb","5976":"Dual-Gunner","5977":"Stoic Veteran","5978":"Lost Hound","5979":"Stalker","5980":"Typewriter","5981":"Guardian Shield","7000":"Mini Atmospheric Manipulator","7100":"Desert Tile","7101":"White Snow Tile","6001":"Cozy Home","6002":"Mobile Camp","6003":"Travel Trunk","6004":"Wilderness Express","6005":"Exotic Souvenir","6006":"Compass","6007":"Camp Nightlight","6008":"Global Route","6009":"Afternoon Memories","6010":"Quick Record","6011":"Cherished Affection","6012":"Two Decades Together","6013":"Women's Power"};

  var DECOR_ICON_FIX = {"5377":"5377_Coffee_Dates.png","5431":"5431_Pipe_Smoke.png","5471":"5471_Mr_Mrs_Ice.png","5640":"5640_Lucky_Joyful.png"};

  var ME_MAP = {"4250":4240,"5491":5488,"5603":5488,"5492":5489,"5604":5489,"5496":5487,"5602":5487,"5506":5505,"5605":5505,"5594":5406,"5595":5407,"5596":5408,"5597":5409,"5598":5410,"5599":5411,"5600":5412,"5601":5413,"5627":5525,"5628":5507,"5629":5508,"5630":5509,"5631":5510,"5720":5557,"5721":5558,"5722":5559,"5723":5560,"5724":5561,"5725":5562,"5726":5577,"5727":5578,"5728":5579,"5729":5580,"5730":5581,"5731":5582,"5768":5514,"5769":5515,"5770":5516,"5771":5517,"5772":5518,"5773":5519,"5774":5588,"5775":5589,"5776":5590,"5777":5591,"5778":5592,"5779":5593,"5828":5618,"5829":5619,"5830":5620,"5831":5621,"5832":5622,"5833":5624,"5834":5623,"5835":5732,"5836":5733,"5837":5734,"5838":5735,"5883":5651,"5884":5652,"5885":5653,"5886":5654,"5887":5655,"5888":5656,"5889":5657,"5890":5658,"5891":5761,"5892":5762,"5893":5763,"5894":5764,"5895":5765,"5970":5801,"5971":5802,"5972":5803,"5973":5806,"5974":5807,"5975":5808,"5976":5847,"5977":5848,"5978":5849,"5979":5850,"5980":5852,"5981":5853};

  function meCanonical(g) { return ME_MAP[String(g)] || g; }

  var DECOR_DATA = {"4170":{"c":2,"b":[{"i":98020501,"v":350,"t":10000}]},"4180":{"c":3,"b":[{"i":93011701,"v":700,"t":10000}]},"4200":{"c":3,"b":[{"i":930100,"v":350,"t":10000}]},"4210":{"c":2,"b":[{"i":10030201,"v":350,"t":10000}]},"4290":{"c":3,"b":[{"i":930001,"v":450,"t":10000}]},"4300":{"c":3,"b":[{"i":930002,"v":200,"t":10000}]},"4310":{"c":3,"b":[{"i":930003,"v":250,"t":10000}]},"4320":{"c":3,"b":[{"i":930102,"v":200,"t":10000}]},"4330":{"c":2,"b":[{"i":1003020,"v":300,"t":10000}]},"4340":{"c":2,"b":[{"i":1003021,"v":300,"t":10000}]},"4350":{"c":2,"b":[{"i":1003022,"v":300,"t":10000}]},"4360":{"c":3,"b":[{"i":930103,"v":450,"t":10000}]},"4370":{"c":2,"b":[{"i":1003020,"v":300,"t":10000}]},"5080":{"c":2,"b":[{"i":29801011,"v":400,"t":10000}]},"5090":{"c":3,"b":[{"i":990001,"v":1500,"t":10000},{"i":930000,"v":100,"t":10000}]},"5321":{"c":2,"b":[{"i":29801021,"v":400,"t":10000}]},"5341":{"c":2,"b":[{"i":21010161,"v":400,"t":10000}]},"5345":{"c":2,"b":[{"i":1001001,"v":400,"t":10000}]},"5347":{"c":3,"b":[{"i":930002,"v":500,"t":10000}]},"5348":{"c":2,"b":[{"i":29901301,"v":300,"t":10000}]},"5351":{"c":3,"b":[{"i":930100,"v":800,"t":10000}]},"5352":{"c":3,"b":[{"i":930001,"v":750,"t":10000}]},"5353":{"c":3,"b":[{"i":990143,"v":9500,"t":10000},{"i":930000,"v":150,"t":10000}]},"5355":{"c":3,"b":[{"i":93011601,"v":400,"t":10000}]},"5356":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5357":{"c":3,"b":[{"i":930100,"v":1100,"t":10000}]},"5370":{"c":2,"b":[{"i":20030201,"v":500,"t":10000}]},"5383":{"c":3,"b":[{"i":930000,"v":500,"t":10000}]},"5385":{"c":2,"b":[{"i":1001001,"v":500,"t":10000}]},"5387":{"c":2,"b":[{"i":29902211,"v":400,"t":10000}]},"5398":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5399":{"c":3,"b":[{"i":1131006,"v":40,"t":1}]},"5401":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5425":{"c":3,"b":[{"i":930002,"v":600,"t":10000}]},"5426":{"c":3,"b":[{"i":930101,"v":800,"t":10000}]},"5440":{"c":3,"b":[{"i":930102,"v":600,"t":10000}]},"5441":{"c":3,"b":[{"i":930001,"v":800,"t":10000}]},"5442":{"c":3,"b":[{"i":930100,"v":600,"t":10000}]},"5443":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5444":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5446":{"c":0,"b":[{"i":1130010,"v":1500,"t":1},{"i":960012,"v":3,"t":1}]},"5460":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5461":{"c":3,"b":[{"i":930000,"v":1000,"t":10000}]},"5462":{"c":0,"b":[{"i":960012,"v":3,"t":1},{"i":930100,"v":300,"t":10000}]},"5463":{"c":3,"b":[{"i":930100,"v":800,"t":10000}]},"5480":{"c":3,"b":[{"i":930101,"v":1000,"t":10000}]},"5481":{"c":3,"b":[{"i":930002,"v":800,"t":10000}]},"5482":{"c":2,"b":[{"i":1001001,"v":600,"t":10000}]},"5484":{"c":3,"b":[{"i":930102,"v":800,"t":10000}]},"5485":{"c":3,"b":[{"i":930101,"v":1000,"t":10000}]},"5486":{"c":2,"b":[{"i":980204,"v":400,"t":10000}]},"5493":{"c":3,"b":[{"i":930103,"v":1000,"t":10000}]},"5494":{"c":3,"b":[{"i":930100,"v":1000,"t":10000}]},"5495":{"c":3,"b":[{"i":930000,"v":1000,"t":10000}]},"5498":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5499":{"c":3,"b":[{"i":930001,"v":1200,"t":10000}]},"5500":{"c":2,"b":[{"i":1001001,"v":600,"t":10000}]},"5502":{"c":3,"b":[{"i":930100,"v":800,"t":10000}]},"5503":{"c":3,"b":[{"i":930002,"v":800,"t":10000}]},"5511":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5512":{"c":3,"b":[{"i":930100,"v":1000,"t":10000}]},"5513":{"c":3,"b":[{"i":930001,"v":1200,"t":10000}]},"5514":{"c":3,"b":[{"i":930100,"v":600,"t":10000}]},"5515":{"c":2,"b":[{"i":1001001,"v":600,"t":10000}]},"5516":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5519":{"c":2,"b":[{"i":980204,"v":600,"t":10000}]},"5522":{"c":3,"b":[{"i":930101,"v":1200,"t":10000}]},"5523":{"c":3,"b":[{"i":930102,"v":600,"t":10000}]},"5524":{"c":3,"b":[{"i":930103,"v":1500,"t":10000}]},"5526":{"c":3,"b":[{"i":1131006,"v":6,"t":1}]},"5527":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5528":{"c":3,"b":[{"i":930100,"v":1000,"t":10000}]},"5529":{"c":3,"b":[{"i":930100,"v":800,"t":10000}]},"5530":{"c":2,"b":[{"i":980204,"v":600,"t":10000}]},"5541":{"c":2,"b":[{"i":1001001,"v":600,"t":10000},{"i":980204,"v":300,"t":10000}]},"5544":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5545":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5546":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5547":{"c":3,"b":[{"i":930100,"v":800,"t":10000}]},"5548":{"c":3,"b":[{"i":930000,"v":800,"t":10000}]},"5549":{"c":3,"b":[{"i":930101,"v":1600,"t":10000}]},"5550":{"c":3,"b":[{"i":930100,"v":900,"t":10000}]},"5551":{"c":3,"b":[{"i":930002,"v":600,"t":10000}]},"5552":{"c":3,"b":[{"i":930102,"v":800,"t":10000}]},"5553":{"c":3,"b":[{"i":930000,"v":1000,"t":10000}]},"5554":{"c":3,"b":[{"i":930001,"v":1500,"t":10000}]},"5555":{"c":3,"b":[{"i":930003,"v":1500,"t":10000}]},"5556":{"c":2,"b":[{"i":1001001,"v":800,"t":10000},{"i":980204,"v":800,"t":10000},{"i":930100,"v":800,"t":10000}]},"5557":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5558":{"c":3,"b":[{"i":930100,"v":1200,"t":10000}]},"5560":{"c":3,"b":[{"i":930000,"v":1200,"t":10000}]},"5561":{"c":3,"b":[{"i":9990769,"v":2000,"t":10000}]},"5562":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5564":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5576":{"c":1,"b":[{"i":1001001,"v":600,"t":10000},{"i":980204,"v":600,"t":10000},{"i":990202,"v":600,"t":10000}]},"5577":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5578":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5579":{"c":2,"b":[{"i":980204,"v":900,"t":10000}]},"5580":{"c":3,"b":[{"i":930100,"v":1200,"t":10000}]},"5581":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5582":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5583":{"c":3,"b":[{"i":990100,"v":1500,"t":10000}]},"5585":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5586":{"c":3,"b":[{"i":930103,"v":1600,"t":10000}]},"5587":{"c":3,"b":[{"i":9301162,"v":800,"t":10000}]},"5588":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5589":{"c":3,"b":[{"i":930100,"v":900,"t":10000}]},"5590":{"c":2,"b":[{"i":1001001,"v":1200,"t":10000}]},"5591":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5592":{"c":3,"b":[{"i":930000,"v":900,"t":10000}]},"5593":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5595":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5597":{"c":3,"b":[{"i":930100,"v":600,"t":10000}]},"5599":{"c":3,"b":[{"i":1131006,"v":15,"t":1}]},"5600":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5603":{"c":3,"b":[{"i":930000,"v":750,"t":10000}]},"5604":{"c":3,"b":[{"i":930100,"v":300,"t":10000}]},"5605":{"c":2,"b":[{"i":980204,"v":600,"t":10000}]},"5606":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5607":{"c":3,"b":[{"i":930100,"v":600,"t":10000},{"i":930000,"v":600,"t":10000}]},"5608":{"c":3,"b":[{"i":930000,"v":1200,"t":10000}]},"5609":{"c":3,"b":[{"i":930001,"v":1500,"t":10000}]},"5610":{"c":3,"b":[{"i":9301172,"v":400,"t":10000}]},"5611":{"c":3,"b":[{"i":9301173,"v":1200,"t":10000}]},"5612":{"c":3,"b":[{"i":9301161,"v":1200,"t":10000}]},"5613":{"c":3,"b":[{"i":9301163,"v":1600,"t":10000}]},"5614":{"c":3,"b":[{"i":9301160,"v":600,"t":10000},{"i":9301170,"v":600,"t":10000}]},"5615":{"c":3,"b":[{"i":9301160,"v":900,"t":10000}]},"5616":{"c":3,"b":[{"i":930100,"v":600,"t":10000},{"i":930000,"v":600,"t":10000}]},"5617":{"c":3,"b":[{"i":990100,"v":1500,"t":10000}]},"5618":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5619":{"c":3,"b":[{"i":930000,"v":1500,"t":10000}]},"5620":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5621":{"c":3,"b":[{"i":930100,"v":1200,"t":10000}]},"5622":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5623":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5624":{"c":3,"b":[{"i":930000,"v":1000,"t":10000}]},"5626":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5627":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5629":{"c":3,"b":[{"i":930000,"v":600,"t":10000}]},"5630":{"c":3,"b":[{"i":930100,"v":600,"t":10000}]},"5631":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5642":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5643":{"c":3,"b":[{"i":9301160,"v":200,"t":10000},{"i":9301170,"v":200,"t":10000}]},"5644":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5645":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5646":{"c":3,"b":[{"i":9301160,"v":1200,"t":10000}]},"5647":{"c":3,"b":[{"i":9301170,"v":1500,"t":10000}]},"5648":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5651":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5652":{"c":3,"b":[{"i":9301170,"v":1500,"t":10000}]},"5653":{"c":3,"b":[{"i":9301160,"v":1600,"t":10000}]},"5654":{"c":3,"b":[{"i":9301160,"v":1200,"t":10000}]},"5655":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5656":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5657":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5658":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5659":{"c":3,"b":[{"i":9301160,"v":800,"t":10000}]},"5660":{"c":3,"b":[{"i":9301170,"v":1000,"t":10000}]},"5661":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5662":{"c":3,"b":[{"i":9301160,"v":600,"t":10000},{"i":9301170,"v":600,"t":10000}]},"5711":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5712":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5716":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5717":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5718":{"c":3,"b":[{"i":9301171,"v":1200,"t":10000}]},"5719":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5732":{"c":3,"b":[{"i":9301160,"v":2000,"t":10000}]},"5733":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5734":{"c":3,"b":[{"i":1131006,"v":40,"t":1}]},"5735":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5736":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5737":{"c":2,"b":[{"i":1001001,"v":900,"t":10000},{"i":9301160,"v":900,"t":10000},{"i":9301170,"v":900,"t":10000}]},"5738":{"c":1,"b":[{"i":980204,"v":600,"t":10000},{"i":990202,"v":400,"t":10000}]},"5742":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5743":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5744":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5745":{"c":3,"b":[{"i":9301170,"v":1200,"t":10000}]},"5746":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5747":{"c":3,"b":[{"i":1131006,"v":40,"t":1}]},"5749":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5750":{"c":3,"b":[{"i":9301174,"v":1500,"t":10000}]},"5752":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5753":{"c":3,"b":[{"i":9301174,"v":1500,"t":10000}]},"5754":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5755":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5756":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5761":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5762":{"c":3,"b":[{"i":9301160,"v":1200,"t":10000}]},"5763":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5764":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5765":{"c":3,"b":[{"i":9301170,"v":900,"t":10000}]},"5766":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5781":{"c":3,"b":[{"i":1131006,"v":45,"t":1}]},"5782":{"c":3,"b":[{"i":9301160,"v":600,"t":10000},{"i":9301170,"v":600,"t":10000}]},"5783":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5784":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5785":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5796":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5797":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5798":{"c":2,"b":[{"i":1001001,"v":600,"t":10000},{"i":9301170,"v":900,"t":10000}]},"5799":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5800":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5801":{"c":2,"b":[{"i":1001001,"v":1250,"t":10000}]},"5802":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5803":{"c":1,"b":[{"i":990202,"v":500,"t":10000}]},"5804":{"c":3,"b":[{"i":9301170,"v":1500,"t":10000}]},"5805":{"c":3,"b":[{"i":9301160,"v":1500,"t":10000}]},"5806":{"c":2,"b":[{"i":980204,"v":1250,"t":10000}]},"5807":{"c":2,"b":[{"i":980204,"v":1200,"t":10000}]},"5808":{"c":3,"b":[{"i":9301164,"v":1500,"t":10000}]},"5809":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5810":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5811":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5822":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5823":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5824":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5825":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5826":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5827":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5839":{"c":3,"b":[{"i":1131006,"v":40,"t":1}]},"5840":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5841":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5842":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5843":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5844":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5845":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5847":{"c":1,"b":[{"i":990202,"v":500,"t":10000}]},"5848":{"c":3,"b":[{"i":1131006,"v":40,"t":1}]},"5849":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5850":{"c":3,"b":[{"i":9301160,"v":1500,"t":10000}]},"5851":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5852":{"c":3,"b":[{"i":9301170,"v":1500,"t":10000}]},"5853":{"c":2,"b":[{"i":980204,"v":1000,"t":10000}]},"5854":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5855":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5856":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5857":{"c":0,"b":[{"i":960012,"v":2,"t":1},{"i":1001001,"v":800,"t":10000}]},"5858":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5859":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5860":{"c":0,"b":[{"i":960012,"v":2,"t":1},{"i":980204,"v":800,"t":10000}]},"5861":{"c":3,"b":[{"i":9301160,"v":2000,"t":10000}]},"5862":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5863":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5864":{"c":3,"b":[{"i":9301170,"v":1200,"t":10000}]},"5865":{"c":3,"b":[{"i":9301160,"v":1200,"t":10000}]},"5866":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5867":{"c":2,"b":[{"i":1001001,"v":1000,"t":10000}]},"5878":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5879":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5880":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5881":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5882":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5896":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5897":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5898":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5899":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5900":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5911":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5912":{"c":1,"b":[{"i":1001001,"v":600,"t":10000},{"i":990202,"v":400,"t":10000}]},"5913":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5917":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5918":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5920":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5921":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5922":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5923":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5924":{"c":3,"b":[{"i":1131006,"v":20,"t":1}]},"5925":{"c":3,"b":[{"i":9301160,"v":1200,"t":10000}]},"5926":{"c":3,"b":[{"i":9301170,"v":1200,"t":10000}]},"5927":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5928":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5929":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5940":{"c":0,"b":[{"i":960012,"v":3,"t":1}]},"5941":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5942":{"c":3,"b":[{"i":9301160,"v":1500,"t":10000}]},"5943":{"c":3,"b":[{"i":1131006,"v":20,"t":1}]},"5944":{"c":3,"b":[{"i":9301170,"v":1500,"t":10000}]},"5945":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5946":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5947":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5948":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5949":{"c":1,"b":[{"i":990202,"v":300,"t":10000}]},"5950":{"c":1,"b":[{"i":990202,"v":400,"t":10000}]},"5962":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5963":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5964":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5965":{"c":0,"b":[{"i":960012,"v":4,"t":1}]},"5982":{"c":2,"b":[{"i":1001001,"v":750,"t":10000}]},"5983":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5984":{"c":3,"b":[{"i":1131006,"v":30,"t":1}]},"5985":{"c":1,"b":[{"i":990202,"v":100,"t":10000}]},"5986":{"c":2,"b":[{"i":980204,"v":750,"t":10000}]},"5989":{"c":2,"b":[{"i":1001001,"v":250,"t":10000}]},"5990":{"c":1,"b":[{"i":990202,"v":100,"t":10000}]},"5991":{"c":3,"b":[{"i":9301160,"v":500,"t":10000}]},"5951":{"c":2,"b":[{"i":980204,"v":250,"t":10000}]},"50000":{"c":3,"b":[{"i":930000,"v":1000,"t":10000},{"i":960002,"v":500,"t":10000}]}};

  var DECOR_CAT_NAMES = ['March Size', 'Defense', 'Damage Boost', 'Others'];

  var BUFF_NAMES = {"930001":"Army HP Boost","930002":"Navy HP Boost","930003":"Air Force HP Boost","930101":"Army Attack","930102":"Navy Attack","930103":"Air Force ATK","930107":"Navy - Army DMG Bonus","930108":"Air Force - Navy DMG Bonus","930109":"Army - Air DMG Bonus","930201":"Army Crit. Rate","930202":"Navy Crit. Rate","930203":"Air Force Crit. Rate","930301":"Army Dodge Buff","930302":"Navy Dodge Buff","930303":"Air Force Dodge Buff","930401":"Army ATK Speed Bonus","930402":"Navy ATK Speed Bonus","930403":"Air Force ATK Speed Bonus","930504":"Navy DEF against Army","930505":"Air Force DEF against Navy","930506":"Army DEF against Air Force","980101":"Army DMG Increase","980102":"Navy DMG Increase","980103":"Air Force DMG Increase","980201":"Army Decreased DMG Taken","980202":"Navy Decreased DMG Taken","980203":"Air Force Decreased DMG Taken","980301":"Army Crit. DMG","980302":"Navy Crit. DMG","980303":"Air Force Crit. DMG","980501":"Army Hit","980502":"Navy Hit","980503":"Air Force Hit","960012":"March Size","990202":"Increase DEF of all units","990203":"Increase DEF of Army","990204":"Increase DEF of Navy","990205":"Increase DEF of Air Force","990208":"DEF increase when attacking","990209":"DEF increase when defending","990221":"Decreased DMG Taken (offensive)","1010001":"Army Starting Shield","1010002":"Navy Starting Shield","1010003":"Air Force Starting Shield","1131009":"Starting Shield of All Units","1101064":"Extra Troop Morale","1130010":"All heroes War increase","1201003":"Total battle rounds +1","29901301":"Decreased DMG Taken (defensive)","941300":"Hall Of Valhalla ATK","941301":"Hall Of Valhalla HP","941303":"Hall Of Valhalla Crit Damage","941304":"Hall Of Valhalla INV","990001":"Attack Boost vs World Boss","970003":"Attack Boost vs Dark Forces","990137":"All units DMG Increase (Silence)","921006":"Golden Tank","981021":"Golden Plane","1002001":"Attack inside Fort","1002002":"HP inside Fort","1150":"Ultra Valhalla AF Offense DMG","1156":"Ultra Valhalla AF Offense HP","1162":"Ultra Valhalla AF Offense ATK","930000":"All Units HP","930100":"All Units ATK","980204":"All Units Decreased DMG Taken","1001001":"All Units DMG Increase","990100":"All Units ATK","1003020":"Army Decreased DMG Taken","1003021":"Navy Decreased DMG Taken","1003022":"Air Force Decreased DMG Taken","1131006":"Garage/Dock/Hangar Capacity","960002":"All Units ATK Speed","9301160":"All Units ATK","9301161":"Army Attack","9301162":"Navy Attack","9301163":"Air Force ATK","9301164":"All Units ATK","9301170":"All Units HP","9301171":"Army HP Boost","9301172":"Navy HP Boost","9301173":"Air Force HP Boost","9301174":"All Units HP","93011601":"All Units ATK","93011701":"All Units HP","9990769":"All Units HP","990143":"Decreased DMG Taken (def)","990563":"All Units HP","29801011":"Army DMG Increase","29801021":"Navy DMG Increase","29902211":"Decreased DMG Taken (offensive)","10030201":"Army Decreased DMG Taken","20030201":"Army Decreased DMG Taken","21010161":"Navy Decreased DMG Taken","98020501":"Army Decreased DMG Taken"};

  var RAW_VALUE_BUFFS = {960012:1, 1131006:1, 1130010:1, 1201003:1, 1101064:1};

  // decorIconUrl: battle-report.html:1150-1159
  function decorIconUrl(group) {
    var g = String(group);
    var name = DECOR_GROUPS[g];
    if (!name) return null;
    // Check filename override first
    if (DECOR_ICON_FIX[g]) return ASSET_BASE + 'assets/decor-icons/' + DECOR_ICON_FIX[g];
    // Standard: group_SanitizedName.png (non-alphanum-non-space removed, each space->underscore)
    var sanitized = name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '_');
    return ASSET_BASE + 'assets/decor-icons/' + g + '_' + sanitized + '.png';
  }

  // decorIconImg: battle-report.html:1162-1168
  function decorIconImg(group) {
    var url = decorIconUrl(group);
    if (!url) return null;
    var img = el('img', { src: url, className: 'decor-icon', alt: DECOR_GROUPS[String(group)] || '', width: '36', height: '36' });
    img.onerror = function() { this.style.display = 'none'; };
    return img;
  }

  // decorIdToGroup: battle-report.html:1177-1187
  function decorIdToGroup(id) {
    // Direct lookup first (fastest)
    var direct = DECOR_ID_TO_GROUP[id];
    if (direct) return direct;
    // Try base ID offsets: id could be baseId + (level-1) for levels 1-15
    for (var off = 0; off < 15; off++) {
      var candidate = id - off;
      if (DECOR_BASE_TO_GROUP[candidate]) return DECOR_BASE_TO_GROUP[candidate];
    }
    return null;
  }

  // idsToGroups: battle-report.html:1349-1362 (lifted out of buildDecorationModal to module top-level).
  function idsToGroups(ids) {
    var groups = {};   // canonical group -> placedId
    var variants = {}; // canonical group -> actual group (for display)
    var unmapped = 0;
    for (var i = 0; i < ids.length; i++) {
      var g = decorIdToGroup(ids[i]);
      if (g) {
        var canon = meCanonical(g);
        groups[canon] = ids[i];
        variants[canon] = g;
      } else { unmapped++; }
    }
    return { groups: groups, variants: variants, unmapped: unmapped };
  }

  // decorLevel: battle-report.html:1365-1369 (lifted out of buildDecorationModal to module top-level).
  function decorLevel(group, placedId) {
    var base = DECOR_GROUP_BASE[String(group)];
    if (!base || !placedId) return 0;
    return placedId - base + 1;
  }

  // formatBuffVal: battle-report.html:1876-1884
  function formatBuffVal(val, buffId) {
    if (!val || val === 0) return buffId && RAW_VALUE_BUFFS[buffId] ? '0' : '0%';
    if (buffId && RAW_VALUE_BUFFS[buffId]) {
      return String(val);
    }
    var pct = val / 100;
    if (pct === Math.floor(pct)) return pct.toFixed(0) + '%';
    return pct.toFixed(1) + '%';
  }

  // formatDecoVal: battle-report.html:1849-1857
  function formatDecoVal(value, valueType) {
    if (valueType === 1) return '+' + value;
    if (valueType === 10000) {
      var pct = value / 100;
      if (pct === Math.floor(pct)) return pct.toFixed(0) + '%';
      return pct.toFixed(1) + '%';
    }
    return formatBuffVal(value);
  }

  // decorBuffDesc: battle-report.html:1860-1870
  function decorBuffDesc(buffs) {
    if (!buffs || buffs.length === 0) return '';
    var parts = [];
    for (var i = 0; i < buffs.length; i++) {
      var b = buffs[i];
      var name = BUFF_NAMES[String(b.i)] || '';
      var val = formatDecoVal(b.v, b.t);
      parts.push(name ? (name + ' ' + val) : val);
    }
    return parts.join(', ');
  }

  // NEW: single-player placed-decorations list, factored from buildDecorationModal's att column.
  // One row per placed decoration group: icon + name + level + buff description.
  function buildDecorationSide(player) {
    var decos = (player && player.effectDecorations) || null;
    var ids = (decos && decos.ids) || [];
    if (!ids.length) return null;                 // page shows the empty state
    var placed = idsToGroups(ids);                // {groups, variants, unmapped}
    var canonKeys = Object.keys(placed.groups);
    if (!canonKeys.length) return null;
    var wrap = el('div', { className: 'ta-decor' });
    canonKeys.forEach(function (canonStr) {
      var grp = parseInt(canonStr);
      var placedId = placed.groups[canonStr];
      var variant = placed.variants[canonStr] || grp;
      var name = DECOR_GROUPS[String(variant)] || DECOR_GROUPS[String(grp)] || ('Decor #' + grp);
      var dd = DECOR_DATA[String(grp)] || DECOR_DATA[String(variant)];
      var buffDesc = dd ? decorBuffDesc(dd.b) : '';
      var lvl = decorLevel(variant, placedId);
      wrap.appendChild(el('div', { className: 'ta-decor-row' }, [
        decorIconImg(variant),                     // may be null; el() skips null children
        el('span', { className: 'ta-decor-name notranslate' }, name),
        el('span', { className: 'ta-decor-lvl' }, lvl > 0 ? ('Lv.' + lvl) : ''),
        el('span', { className: 'ta-decor-buff' }, buffDesc)
      ]));
    });
    return wrap;
  }

  // --- Task 5: Base skins (copied from battle-report.html) ---
  // BASE_SKIN_NAMES @943, BASE_SKIN_ICONS @945, baseSkinIconUrl @946 (verbatim).
  var BASE_SKIN_NAMES={'0':'Default','1600100':'Leader\'s Demeanor','1600200':'Art Of War','1600300':'Incredible Leader (Army)','1600400':'Incredible Leader (Navy)','1600500':'Incredible Leader (Air Force)','1600600':'Solid Support','1600700':'Financial Expert','1600800':'Craftsman\'s Spirit','1600900':'Roses & Thorns','1710200':'Base 1','1710300':'Booster Project','1710400':'Base 2','1710500':'Base 1','1710600':'Foggy Mushroom','1710700':'Super Miner','1710800':'Pop Star','1710900':'Super Fan','1711000':'Supreme Dragon City','1712000':'Leader\'s Demeanor','1713000':'Theme Park','1714000':'Golden Dragon Boat','1715000':'Ice Cream','1716000':'Frost Kirin','1717000':'Airship','1718000':'Romantic Skin','1719000':'Autumn Breeze','1720000':'Moonrabbit','1721000':'Battleship Fortress','1722000':'skin_name_1722000','1723000':'skin_name_1723000','1724000':'skin_name_1724000','1725000':'Holy Dragon Fortress','1726000':'skin_name_1726000','1727000':'Merry Christmas','1728000':'Recruit Trial','1729000':'Frost City','1730000':'Lucky Dragon Castle','1731000':'Super Garage','1732000':'Sweetest Words','1733000':'Eternal Love','1736000':'skin_name_1736000','1739000':'Gus Cannon','1740000':'CVN-68','1741000':'Hercules','1743000':'skin_name_1743000','1744000':'Metropolis','1747000':'The Predator','1749000':'Hyperion','1750000':'Cetus','1752000':'Amazing Holiday','1753000':'Neotopia','1756000':'VN-1 Forerunner','1757000':'VN-1 Guardian','1760000':'ZH-2 Wavebreaker','1761000':'ZH-2 Conqueror','1762000':'Shrieking Castle','1763000':'WB-3 Beta','1764000':'WB-3 Alpha','1765000':'Shadow Dragon','1767000':'Home, Sweet Home','1768000':'Phantom Ship','1769000':'The Labyrinth','1770000':'Temple of Glory','1771000':'Out of Blue','1772000':'Pretty in Pink','1773000':'Rise Above The Flames','1774000':'Flying Castle','1775000':'Atlantis','1776000':'Golden Pavilion','1777000':'Pantheon','1778000':'Acadia','1779000':'Tropical City','1780000':'Ark','1781000':'Storm Factory','1782000':'Rumbling Plant','1783000':'Sizzling Factory','1784000':'Midnight Castle','1787000':'Aquaturbine','1788000':'Hydropower','1789000':'Glaring Cabin','1790000':'Crystal Cabin','1791000':'Training Field','1792000':'Training Camp','1793000':'Training Station','1794000':'Training Hall','1795000':'Training Base','1796000':'Hall of Honor','1797000':'Hall of Glory','1798000':'Brezzy House','1799000':'Frezzy Castle','1800000':'Immortal Mountain','1801000':'Mountain Academy','1802000':'Ironberg','1803000':'Ironfort','1804000':'Nemesis','1805000':'Azure Knight','1806000':'Azure Castle','1807000':'Stone Circle','1808000':'Stonehenge','1809000':'Void Matrix','1810000':'Formaggio Ranch','1811000':'Formaggio Manor','1812000':'Seaplane','1813000':'Aerosub','1814000':'Dune Smasher','1815000':'Sandstorm Battleship','1816000':'Sky Arena','1817000':'Floating Colosseum','1818000':'Hidden Dragon','1819000':'Dragon\'s Maw','1820000':'Open Stage','1821000':'Grand Stage','1822000':'Fun Club Stage','1823000':'Whistle Bay','1824000':'Whale Harbor','1825000':'Air Bunker','1826000':'Air Fortress','1827000':'Undead Town','1828000':'Necropolis Castle','1829000':'Tokyo-3 (Fortress)','1830000':'Tokyo-3 (Emergency)','1831000':'Midnight Shuttle','1832000':'Stargazer Spacecruiser','1833000':'Phantom Battleship','1834000':'Snowmount','1835000':'Happy Yeti','1836000':'Clock Tower','1837000':'Time Palace','1838000':'Magnificent Land','1839000':'Gorgeous View','1840000':'Bear Of Love','1841000':'Bear Of Hearts','1842000':'Frozen Shipwreck','1843000':'Frozen Miracle','1844000':'Shatterdome','1845000':'Lunar Citadel','1846000':'Nightfall Citadel','1847000':'Fading Wings','1848000':'Radiant Wings','1849000':'Choco-Maker\'s Studio','1850000':'Chocolate Wonderland','1851000':'Distorted Gravity','1852000':'Gravity Flux','1853000':'Shatterdome','1854000':'Trojan Impulse','1855000':'Trojan Prime','1856000':'Glorious Citadel','1858000':'Palm Breeze Villa','1859000':'Coastal Bliss Villa','1860000':'Whisperwind Hideout','1861000':'Whisperwind Base','1862000':'Radiant Power Tower','1871000':'Astro Arc','1872000':'Nebula Circle','1873000':'Galaxy Ring','1874000':'Vein Village','1875000':'Saddle City','1876000':'Ghostly Gala Ground','1877000':'Grand Ghoul Gathering','1878000':'Cloudtop Palace','1879000':'Cobra Island','1880000':'G.I. Joe Headquarters','1881000':'Starlight Bastion','1882000':'Sparkling Utopia','1883000':'Infinity Utopia','1884000':'Mystic Pyramid','1885000':'Cloud Pyramid','1886000':'Winter Resort','1887000':'Icy Snow Town','1888000':'Wraithfire Bastion','1889000':'Wraithfire Fortress','1890000':'Outdoor Gathering','1891000':'Street Party','1892000':'Lake Lerna: Rock','1893000':'Lake Lerna: Marsh','1894000':'Blossom Retreat','1895000':'Spring Breeze','1896000':'Byte Cube','1897000':'Digital Matrix','1898000':'The Jade Palace','1899000':'Illusion City','1900000':'Enigma Island','1901000':'The Platonic Solid','1902000':'Cloud Data Harbor','1903000':'Infinite Quantum Island','1904000':'Desert Castle','1905000':'Oasis City','1906000':'Fun Baking House','1907000':'Auto Bakery','1908000':'Fountain of Youth','1909000':'Treasure Island','1910000':'Star Follower','1911000':'Emerging Star','1912000':'Kuiper Belt','1913000':'Kung Fu Feast','1914000':'Land of Glory','1915000':'Castle of Glory','1916000':'Iglooville','1917000':'Igloo Heights','1918000':'Enigma Turret','1919000':'Steamship','1920000':'Titan Warship','1921000':'Cloudfort City','1922000':'Boltfort City','1923000':'Glamour Sphere','1925000':'Midnight Serenade','1926000':'Crescent Serenade','1927000':'R.P.D.','1928000':'Nebula Observatory','1929000':'Cosmic Observatory','1930000':'Etherial Peaks','1931000':'Etherial Portal','1932000':'Heart of Realms','1933000':'Core of the Void','1934000':'Starborn Glow','1935000':'Lotus Pavilion','1936000':'Grand Lotus Library','1937000':'Soul to Soul','1938000':'Heart to Heart','1939000':'Ironclad Hovercraft','1940000':'Sunfire Stormrider','1941000':'Moonlit Bay','1942000':'Torrent City','1943000':'Arklay Mansion','1944000':'Sky Party Ship','1945000':'Hovering Funland','1946000':'Moonlit Shadow','1947000':'Obsidian Shadow','1948000':'Galecreek Valley','1949000':'Snowshade Mount','1950000':'Fog City','1951000':'Alchemy City','1952000':'Isle of Berk','1953000':'Maglev Relay','1954000':'Astral Camp','1955000':'Stellar Base','1956000':'Electro-Tide','1957000':'Thunderstorm Valley','1958000':'Cloudveil Vista','1959000':'Aeonwind Scroll','1960000':'Gravitic Post','1961000':'Starwind Spire','1963000':'Starwave Scanner','1964000':'Starshine Spacestation','1965000':'Ion Satellite Atoll','1966000':'Darkdream Whisper','1967000':'Phantom Whisper','1968000':'Iceberg Isle','1969000':'Honeyfrost Reindeer Lodge','1970000':'Sugarfrost Christmas Village','1971000':'Multiplex Tower','1972000':'Annular Tower','1974000':'Vortex Citadel','1975000':'Sky-Gale Isle','1976000':'Firestone Foundry','1977000':'Magma Siphon','1978000':'Energy Circle','1979000':'Gate of Passage','1980000':'Spacetime Tunnel','1981000':'Glass Conservatory','1982000':'Crystal Garden','1983000':'Gala Rhythm','1984000':'Grand Parade','1985000':'Clockwork Treehouse','1986000':'Flying Tree City','1987000':'Clockwork Music Box','1988000':'Steam Phonograph','1989000':'Crescent Veil','1990000':'Sunset Haze','1991000':'Astral Dome','1992000':'War Fortress','1993000':'Juggernaut','1994000':'Snowfall Bay','1995000':'Ice Port','1996000':'Easter Egg House','1997000':'Bunny House','1998000':'Mobile Bastion','1999000':'Skywing Isle','2000000':'Mirage Isle','2001000':'Green Frontline','2002000':'Blossom Bastion','3000000':'Snowman','3000002':'Glaring Cabin','3000004':'Crystal Cabin','3000006':'Merry Christmas','3000007':'Snowmount','3000008':'Happy Yeti','3000009':'Winter Resort','3000010':'Icy Snow Town','3000011':'Iglooville','3000012':'Igloo Heights','3000013':'Honeyfrost Reindeer Lodge','3000014':'Sugarfrost Christmas Village','2003000':'Ironrail Peak','2004000':'Roaring Cliff','2005000':'Destruction Park','2006000':'Flaming Throne','2007000':'Starcrown Palace','2008000':'Hendo\'s Meow Time','2009000':'Victory Arena','2010000':'Glorious Eleven'};
  var BASE_SKIN_ICONS={"0":"0_Default.png","1600100":"1600100_Leaders_Demeanor.png","1600200":"1600200_Art_Of_War.png","1600300":"1600300_Incredible_Leader_Army.png","1600400":"1600400_Incredible_Leader_Navy.png","1600500":"1600500_Incredible_Leader_Air_Force.png","1600600":"1600600_Solid_Support.png","1600700":"1600700_Financial_Expert.png","1600800":"1600800_Craftsmans_Spirit.png","1600900":"1600900_Roses__Thorns.png","1710200":"1710200_skinname002.png","1710300":"1710300_Booster_Project.png","1710400":"1710400_skinname004.png","1710500":"1710500_Base_1.png","1710600":"1710600_Foggy_Mushroom.png","1710700":"1710700_Super_Miner.png","1710800":"1710800_Pop_Star.png","1710900":"1710900_Super_Fan.png","1711000":"1711000_Supreme_Dragon_City.png","1712000":"1712000_Leaders_Demeanor.png","1713000":"1713000_Theme_Park.png","1714000":"1714000_Golden_Dragon_Boat.png","1715000":"1715000_Ice_Cream.png","1716000":"1716000_Frost_Kirin.png","1717000":"1717000_Airship.png","1718000":"1718000_Romantic_Skin.png","1719000":"1719000_Autumn_Breeze.png","1720000":"1720000_Moonrabbit.png","1721000":"1721000_Battleship_Fortress.png","1725000":"1725000_Holy_Dragon_Fortress.png","1727000":"1727000_Merry_Christmas.png","1728000":"1728000_Recruit_Trial.png","1729000":"1729000_Frost_City.png","1730000":"1730000_Lucky_Dragon_Castle.png","1731000":"1731000_Super_Garage.png","1732000":"1732000_Sweetest_Words.png","1733000":"1733000_Eternal_Love.png","1739000":"1739000_Gus_Cannon.png","1740000":"1740000_CVN68.png","1741000":"1741000_Hercules.png","1744000":"1744000_Metropolis.png","1747000":"1747000_The_Predator.png","1749000":"1749000_Hyperion.png","1750000":"1750000_Cetus.png","1752000":"1752000_Amazing_Holiday.png","1753000":"1753000_Neotopia.png","1756000":"1756000_VN1_Forerunner.png","1757000":"1757000_VN1_Guardian.png","1760000":"1760000_ZH2_Wavebreaker.png","1761000":"1761000_ZH2_Conqueror.png","1762000":"1762000_Shrieking_Castle.png","1763000":"1763000_WB3_Beta.png","1764000":"1764000_WB3_Alpha.png","1765000":"1765000_Shadow_Dragon.png","1767000":"1767000_Home_Sweet_Home.png","1768000":"1768000_Phantom_Ship.png","1769000":"1769000_The_Labyrinth.png","1770000":"1770000_Temple_of_Glory.png","1771000":"1771000_Out_of_Blue.png","1772000":"1772000_Pretty_in_Pink.png","1773000":"1773000_Rise_Above_The_Flames.png","1774000":"1774000_Flying_Castle.png","1775000":"1775000_Atlantis.png","1776000":"1776000_Golden_Pavilion.png","1777000":"1777000_Pantheon.png","1778000":"1778000_Acadia.png","1779000":"1779000_Tropical_City.png","1780000":"1780000_Ark.png","1781000":"1781000_Storm_Factory.png","1782000":"1782000_Rumbling_Plant.png","1783000":"1783000_Sizzling_Factory.png","1784000":"1784000_Midnight_Castle.png","1787000":"1787000_Aquaturbine.png","1788000":"1788000_Hydropower.png","1789000":"1789000_Glaring_Cabin.png","1790000":"1790000_Crystal_Cabin.png","1791000":"1791000_Training_Field.png","1792000":"1792000_Training_Camp.png","1793000":"1793000_Training_Station.png","1794000":"1794000_Training_Hall.png","1795000":"1795000_Training_Base.png","1796000":"1796000_Hall_of_Honor.png","1797000":"1797000_Hall_of_Glory.png","1798000":"1798000_Brezzy_House.png","1799000":"1799000_Frezzy_Castle.png","1800000":"1800000_Immortal_Mountain.png","1801000":"1801000_Mountain_Academy.png","1802000":"1802000_Ironberg.png","1803000":"1803000_Ironfort.png","1804000":"1804000_Nemesis.png","1805000":"1805000_Azure_Knight.png","1806000":"1806000_Azure_Castle.png","1807000":"1807000_Stone_Circle.png","1808000":"1808000_Stonehenge.png","1809000":"1809000_Void_Matrix.png","1810000":"1810000_Formaggio_Ranch.png","1811000":"1811000_Formaggio_Manor.png","1812000":"1812000_Seaplane.png","1813000":"1813000_Aerosub.png","1814000":"1814000_Dune_Smasher.png","1815000":"1815000_Sandstorm_Battleship.png","1816000":"1816000_Sky_Arena.png","1817000":"1817000_Floating_Colosseum.png","1818000":"1818000_Hidden_Dragon.png","1819000":"1819000_Dragons_Maw.png","1820000":"1820000_Open_Stage.png","1821000":"1821000_Grand_Stage.png","1822000":"1822000_Fun_Club_Stage.png","1823000":"1823000_Whistle_Bay.png","1824000":"1824000_Whale_Harbor.png","1825000":"1825000_Air_Bunker.png","1826000":"1826000_Air_Fortress.png","1827000":"1827000_Undead_Town.png","1828000":"1828000_Necropolis_Castle.png","1829000":"1829000_Tokyo3_Fortress.png","1830000":"1830000_Tokyo3_Emergency.png","1831000":"1831000_Midnight_Shuttle.png","1832000":"1832000_Stargazer_Spacecruiser.png","1833000":"1833000_Phantom_Battleship.png","1834000":"1834000_Snowmount.png","1835000":"1835000_Happy_Yeti.png","1836000":"1836000_Clock_Tower.png","1837000":"1837000_Time_Palace.png","1838000":"1838000_Magnificent_Land.png","1839000":"1839000_Gorgeous_View.png","1840000":"1840000_Bear_Of_Love.png","1841000":"1841000_Bear_Of_Hearts.png","1842000":"1842000_Frozen_Shipwreck.png","1843000":"1843000_Frozen_Miracle.png","1844000":"1844000_Shatterdome.png","1845000":"1845000_Lunar_Citadel.png","1846000":"1846000_Nightfall_Citadel.png","1847000":"1847000_Fading_Wings.png","1848000":"1848000_Radiant_Wings.png","1849000":"1849000_ChocoMakers_Studio.png","1850000":"1850000_Chocolate_Wonderland.png","1851000":"1851000_Distorted_Gravity.png","1852000":"1852000_Gravity_Flux.png","1853000":"1853000_Shatterdome.png","1854000":"1854000_Trojan_Impulse.png","1855000":"1855000_Trojan_Prime.png","1856000":"1856000_Glorious_Citadel.png","1858000":"1858000_Palm_Breeze_Villa.png","1859000":"1859000_Coastal_Bliss_Villa.png","1860000":"1860000_Whisperwind_Hideout.png","1861000":"1861000_Whisperwind_Base.png","1862000":"1862000_Radiant_Power_Tower.png","1871000":"1871000_Astro_Arc.png","1872000":"1872000_Nebula_Circle.png","1873000":"1873000_Galaxy_Ring.png","1874000":"1874000_Vein_Village.png","1875000":"1875000_Saddle_City.png","1876000":"1876000_Ghostly_Gala_Ground.png","1877000":"1877000_Grand_Ghoul_Gathering.png","1878000":"1878000_Cloudtop_Palace.png","1879000":"1879000_Cobra_Island.png","1880000":"1880000_GI_Joe_Headquarters.png","1881000":"1881000_Starlight_Bastion.png","1882000":"1882000_Sparkling_Utopia.png","1883000":"1883000_Infinity_Utopia.png","1884000":"1884000_Mystic_Pyramid.png","1885000":"1885000_Cloud_Pyramid.png","1886000":"1886000_Winter_Resort.png","1887000":"1887000_Icy_Snow_Town.png","1888000":"1888000_Wraithfire_Bastion.png","1889000":"1889000_Wraithfire_Fortress.png","1890000":"1890000_Outdoor_Gathering.png","1891000":"1891000_Street_Party.png","1892000":"1892000_Lake_Lerna_Rock.png","1893000":"1893000_Lake_Lerna_Marsh.png","1894000":"1894000_Blossom_Retreat.png","1895000":"1895000_Spring_Breeze.png","1896000":"1896000_Byte_Cube.png","1897000":"1897000_Digital_Matrix.png","1898000":"1898000_The_Jade_Palace.png","1899000":"1899000_Illusion_City.png","1900000":"1900000_Enigma_Island.png","1901000":"1901000_The_Platonic_Solid.png","1902000":"1902000_Cloud_Data_Harbor.png","1903000":"1903000_Infinite_Quantum_Island.png","1904000":"1904000_Desert_Castle.png","1905000":"1905000_Oasis_City.png","1906000":"1906000_Fun_Baking_House.png","1907000":"1907000_Auto_Bakery.png","1908000":"1908000_Fountain_of_Youth.png","1909000":"1909000_Treasure_Island.png","1910000":"1910000_Star_Follower.png","1911000":"1911000_Emerging_Star.png","1912000":"1912000_Kuiper_Belt.png","1913000":"1913000_Kung_Fu_Feast.png","1914000":"1914000_Land_of_Glory.png","1915000":"1915000_Castle_of_Glory.png","1916000":"1916000_Iglooville.png","1917000":"1917000_Igloo_Heights.png","1918000":"1918000_Enigma_Turret.png","1919000":"1919000_Steamship.png","1920000":"1920000_Titan_Warship.png","1921000":"1921000_Cloudfort_City.png","1922000":"1922000_Boltfort_City.png","1923000":"1923000_Glamour_Sphere.png","1925000":"1925000_Midnight_Serenade.png","1926000":"1926000_Crescent_Serenade.png","1927000":"1927000_RPD.png","1928000":"1928000_Nebula_Observatory.png","1929000":"1929000_Cosmic_Observatory.png","1930000":"1930000_Etherial_Peaks.png","1931000":"1931000_Etherial_Portal.png","1932000":"1932000_Heart_of_Realms.png","1933000":"1933000_Core_of_the_Void.png","1934000":"1934000_Starborn_Glow.png","1935000":"1935000_Lotus_Pavilion.png","1936000":"1936000_Grand_Lotus_Library.png","1937000":"1937000_Soul_to_Soul.png","1938000":"1938000_Heart_to_Heart.png","1939000":"1939000_Ironclad_Hovercraft.png","1940000":"1940000_Sunfire_Stormrider.png","1941000":"1941000_Moonlit_Bay.png","1942000":"1942000_Torrent_City.png","1943000":"1943000_Arklay_Mansion.png","1944000":"1944000_Sky_Party_Ship.png","1945000":"1945000_Hovering_Funland.png","1946000":"1946000_Moonlit_Shadow.png","1947000":"1947000_Obsidian_Shadow.png","1948000":"1948000_Galecreek_Valley.png","1949000":"1949000_Snowshade_Mount.png","1950000":"1950000_Fog_City.png","1951000":"1951000_Alchemy_City.png","1952000":"1952000_Isle_of_Berk.png","1953000":"1953000_Maglev_Relay.png","1954000":"1954000_Astral_Camp.png","1955000":"1955000_Stellar_Base.png","1956000":"1956000_ElectroTide.png","1957000":"1957000_Thunderstorm_Valley.png","1958000":"1958000_Cloudveil_Vista.png","1959000":"1959000_Aeonwind_Scroll.png","1960000":"1960000_Gravitic_Post.png","1961000":"1961000_Starwind_Spire.png","1963000":"1963000_Starwave_Scanner.png","1964000":"1964000_Starshine_Spacestation.png","1965000":"1965000_Ion_Satellite_Atoll.png","1966000":"1966000_Darkdream_Whisper.png","1967000":"1967000_Phantom_Whisper.png","1968000":"1968000_Iceberg_Isle.png","1969000":"1969000_Honeyfrost_Reindeer_Lodge.png","1970000":"1970000_Sugarfrost_Christmas_Village.png","1971000":"1971000_Multiplex_Tower.png","1972000":"1972000_Annular_Tower.png","1974000":"1974000_Vortex_Citadel.png","1975000":"1975000_SkyGale_Isle.png","1976000":"1976000_Firestone_Foundry.png","1977000":"1977000_Magma_Siphon.png","1978000":"1978000_Energy_Circle.png","1979000":"1979000_Gate_of_Passage.png","1980000":"1980000_Spacetime_Tunnel.png","1981000":"1981000_Glass_Conservatory.png","1982000":"1982000_Crystal_Garden.png","1983000":"1983000_Gala_Rhythm.png","1984000":"1984000_Grand_Parade.png","1985000":"1985000_Clockwork_Treehouse.png","1986000":"1986000_Flying_Tree_City.png","1987000":"1987000_Clockwork_Music_Box.png","1988000":"1988000_Steam_Phonograph.png","1989000":"1989000_Crescent_Veil.png","1990000":"1990000_Sunset_Haze.png","1991000":"1991000_Astral_Dome.png","1992000":"1992000_War_Fortress.png","1993000":"1993000_Juggernaut.png","1994000":"1994000_Snowfall_Bay.png","1995000":"1995000_Ice_Port.png","3000000":"3000000_Snowman.png","3000002":"3000002_Glaring_Cabin.png","3000004":"3000004_Crystal_Cabin.png","3000006":"3000006_Merry_Christmas.png","3000007":"3000007_Snowmount.png","3000008":"3000008_Happy_Yeti.png","3000009":"3000009_Winter_Resort.png","3000010":"3000010_Icy_Snow_Town.png","3000011":"3000011_Iglooville.png","3000012":"3000012_Igloo_Heights.png","3000013":"3000013_Honeyfrost_Reindeer_Lodge.png","3000014":"3000014_Sugarfrost_Christmas_Village.png","1996000":"1996000_Easter_Egg_House.png","1997000":"1997000_Bunny_House.png","1998000":"1998000_Mobile_Bastion.png","1999000":"1999000_Skywing_Isle.png","2000000":"2000000_Mirage_Isle.png","2001000":"2001000_Green_Frontline.png","2002000":"2002000_Blossom_Bastion.png","2003000":"2003000_Ironrail_Peak.png","2004000":"2004000_Roaring_Cliff.png","2005000":"2005000_Destruction_Park.png","2006000":"2006000_Flaming_Throne.png","2007000":"2007000_Starcrown_Palace.png","2008000":"2008000_Hendos_Meow_Time.png","2009000":"2009000_Victory_Arena.png","2010000":"2010000_Glorious_Eleven.png"};
  function baseSkinIconUrl(sid) { var fn = BASE_SKIN_ICONS[String(sid)]; return fn ? ASSET_BASE + 'assets/base-icons/' + fn : null; }
  // skinIcon @2768 + skinCell @2781 lifted verbatim from buildBaseSkinModal.
  function skinIcon(sid, isEquipped) {
    var url = baseSkinIconUrl(sid);
    if (url) {
      var img = el('img', { className: 'bskin-icon' + (isEquipped ? ' equipped' : ''), src: url, alt: '', loading: 'lazy' });
      img.onerror = function() { this.style.display = 'none'; };
      return img;
    }
    var ph = el('div', { className: 'bskin-placeholder' });
    ph.textContent = '\uD83C\uDFF0';
    return ph;
  }
  function skinCell(sid, isOwned, isEquipped, side) {
    var cell = el('div', { className: 'bskin-cell' + (side === 'right' ? ' right' : '') + (!isOwned ? ' empty' : '') });
    cell.appendChild(skinIcon(sid, isEquipped));
    var info = el('div', { className: 'bskin-info' });
    var name = BASE_SKIN_NAMES[sid] || 'Skin #' + sid;
    info.appendChild(el('div', { className: 'bskin-name' }, name));
    var badge = el('div', { className: 'bskin-badge' });
    if (isEquipped) { badge.className += ' equipped'; badge.textContent = '\u2605 Equipped'; }
    else if (isOwned) { badge.className += ' owned'; badge.textContent = '\u2713 Owned'; }
    else { badge.className += ' notowned'; badge.textContent = '- Not owned'; }
    info.appendChild(badge);
    cell.appendChild(info);
    return cell;
  }
  // NEW: single-player base skins, factored from buildBaseSkinModal (att side only).
  function buildBaseSkinSide(player) {
    var skins = (player && player.effectSkins) || {};
    var owned = skins.effectIds || [];
    var equipped = (skins.useIds || [])[0] || null;
    if (!equipped && !owned.length) return null;
    var wrap = el('div', { className: 'ta-bases' });
    if (equipped) {
      wrap.appendChild(el('div', { className: 'ta-section-title' }, 'Equipped'));
      var eqGrid = el('div', { className: 'ta-bases-grid' });
      eqGrid.appendChild(skinCell(equipped, true, true, 'left'));
      wrap.appendChild(eqGrid);
    }
    if (owned.length) {
      wrap.appendChild(el('div', { className: 'ta-section-title' }, 'Owned (' + owned.length + ')'));
      var grid = el('div', { className: 'ta-bases-grid' });
      var sorted = owned.slice().map(Number).sort(function (a, b) {
        return (BASE_SKIN_NAMES[a] || '').localeCompare(BASE_SKIN_NAMES[b] || '');
      });
      sorted.forEach(function (sid) { grid.appendChild(skinCell(sid, true, sid == equipped, 'left')); });
      wrap.appendChild(grid);
    }
    return wrap;
  }

  return {
    el: el, fetchReportResponse: fetchReportResponse, loadAwakeningRef: loadAwakeningRef,
    sha256hex: sha256hex, getAvatar: getAvatar, getPlayerInfoRaw: getPlayerInfo2,
    formatPower: formatPower, stripUIDs: stripUIDs, renderOverview: renderOverview,
    buildHeroGearSide: buildHeroGearSide, buildEnigmaSide: buildEnigmaSide,
    buildDecorationSide: buildDecorationSide,
    buildBaseSkinSide: buildBaseSkinSide
  };
})();
