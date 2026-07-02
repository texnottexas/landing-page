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

  return {
    el: el, fetchReportResponse: fetchReportResponse, loadAwakeningRef: loadAwakeningRef,
    sha256hex: sha256hex, getAvatar: getAvatar, getPlayerInfoRaw: getPlayerInfo2,
    formatPower: formatPower, stripUIDs: stripUIDs, renderOverview: renderOverview
  };
})();
