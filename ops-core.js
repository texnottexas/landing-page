// ops-core.js — Ops Center pure rules: the tool list, search, order, badges, gates,
// tile status and the running tracker. No DOM, no game access. Exported for
// node tests and as window.OpsCore in the browser.
(function (root) {
  'use strict';

  var ICONS = ['list', 'x', 'clock', 'shield', 'refresh', 'users', 'grid', 'map', 'gift', 'smile', 'disco', 'target', 'tent', 'chest', 'gem'];
  var READY_IDS = ['game', 'base', 'defender', 'r4'];
  var GATES = ['member', 'code'];
  // registries a tool can be limited to: the worker answers whether a siteKey is in it (Tex 2026-10-14: Map Collector)
  var REGISTRIES = ['mapcollector'];
  var READY_TEXT = {
    game: ['Game loaded', 'Wait for the game to finish loading'],
    base: ['Your base is open', 'Open your base'],
    defender: ['The defender monster\'s panel is open', 'Tap the defender monster (you can also do this after launching)'],
    r4: ['You are R4 or leader', 'You need to be R4 or leader in your alliance']
  };
  // what a tool says when it sorts a readiness item out itself (its list entry has "auto": [ids])
  var AUTO_TEXT = { base: 'Takes you to your base first', defender: 'Opens the defender monster itself', game: 'Waits for the game itself', r4: 'Checks your rank itself' };
  function isAutoFor(tool, id) { return !!(tool.auto && tool.auto.indexOf(id) >= 0); }
  var WAIT_MS = 10000, GRACE_MS = 1000, WATCH_MS = 120000, RECENT_MAX = 3, MAX_TOOLS = 50;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function plainObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function warn(why, t) { try { console.warn('Ops Center: skipped a tool' + (t && t.id ? ' (' + String(t.id).slice(0, 40) + ')' : '') + ': ' + why); } catch (e) {} }

  function isStr(v) { return typeof v === 'string' && v.length > 0; }

  // Keep tools that are complete and safe; drop the rest (scripts may only be plain file names,
  // always loaded from 2864tw.com, so a bad list cannot pull code from anywhere else).
  function validateTools(raw) {
    var out = { codeSha256: null, tools: [] };
    if (!raw || typeof raw !== 'object') return out;
    if (/^[0-9a-f]{64}$/.test(raw.codeSha256 || '')) out.codeSha256 = raw.codeSha256;
    var seen = Object.create(null), list = Array.isArray(raw.tools) ? raw.tools : [], capped = false;
    list.forEach(function (t) {
      if (!t || typeof t !== 'object') return warn('not an object', null);
      if (!/^[a-z0-9-]+$/.test(t.id || '')) return warn('bad id', t);
      if (seen[t.id]) return warn('duplicate id', t);
      if (!isStr(t.title) || !isStr(t.desc) || !isStr(t.version)) return warn('missing title, desc or version', t);
      if (GATES.indexOf(t.gate) < 0) return warn('unknown gate', t);
      if (!Array.isArray(t.scripts) || !t.scripts.length || !t.scripts.every(function (s) { return /^[a-z0-9-]+\.js$/.test(s); })) return warn('bad script name', t);
      if (!Array.isArray(t.ready) || !t.ready.every(function (r) { return READY_IDS.indexOf(r) >= 0; })) return warn('unknown readiness item', t);
      if (out.tools.length >= MAX_TOOLS) { capped = true; return; }
      seen[t.id] = true;
      out.tools.push({
        id: t.id, title: t.title, desc: t.desc, version: t.version, gate: t.gate,
        scripts: t.scripts.slice(), ready: t.ready.slice(),
        icon: ICONS.indexOf(t.icon) >= 0 ? t.icon : 'grid',
        keywords: typeof t.keywords === 'string' ? t.keywords : '',
        overlay: /^#[A-Za-z0-9_-]+$/.test(t.overlay || '') ? t.overlay : null,
        auto: (Array.isArray(t.auto) ? t.auto : []).filter(function (r) { return t.ready.indexOf(r) >= 0; }),
        owners: (Array.isArray(t.owners) ? t.owners : []).filter(function (k) { return typeof k === 'string' && /^[0-9a-f]{16}$/.test(k); }),
        // a tool tied to events lists the game's activity types (whole numbers above 0); the rest is dropped
        event: (Array.isArray(t.event) ? t.event : []).filter(function (n) { return typeof n === 'number' && n > 0 && n % 1 === 0; }),
        tucked: t.tucked === true,                     // always under "Not running now" (Tex 2026-10-14: TC Squad Sync, Class Talent Reset (EL))
        alongside: t.alongside === true,               // runs alongside the others, never holding the Ops Center (Tex 2026-10-14: Rickroll)
        together: t.together === true,                 // runs together with the other "together" tools (Tex 2026-10-16)
        // shown only to players the named registry holds; a key that isn't a known registry hides the tool from everyone
        registered: t.registered === undefined ? null : (REGISTRIES.indexOf(t.registered) >= 0 ? t.registered : ''),
        ownerOnly: t.owners !== undefined          // fail closed: an owners key that isn't a good list hides the tool
      });
    });
    if (capped) { try { console.warn('Ops Center: the tool list has more than ' + MAX_TOOLS + ' tools; only the first 50 are shown'); } catch (e) {} }
    return out;
  }

  // Tools listing owners are shown only to those players (a list that held only bad keys hides the tool from everyone).
  // Tools limited to a registry are shown only when the worker said yes for this player (`registered` = {registry: true}).
  function visibleTools(tools, siteKey, registered) {
    return tools.filter(function (t) {
      if (t.ownerOnly && !(!!siteKey && t.owners.indexOf(siteKey) >= 0)) return false;
      if (t.registered != null && !(!!siteKey && !!t.registered && !!registered && registered[t.registered] === true)) return false;
      return true;
    });
  }

  function filterTools(tools, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return tools.slice();
    return tools.filter(function (t) { return (t.title + ' ' + t.desc + ' ' + t.keywords).toLowerCase().indexOf(q) >= 0; });
  }

  function orderTools(tools, recent) {
    var byId = Object.create(null), out = [], used = Object.create(null);
    tools.forEach(function (t) { byId[t.id] = t; });
    (Array.isArray(recent) ? recent : []).forEach(function (id) { if (typeof id === 'string' && byId[id] && !used[id]) { used[id] = true; out.push(byId[id]); } });
    tools.forEach(function (t) { if (!used[t.id]) out.push(t); });
    return out;
  }

  function pushRecent(recent, id) {
    return [id].concat((Array.isArray(recent) ? recent : []).filter(function (x) { return x !== id; })).slice(0, RECENT_MAX);
  }

  // First ever open: remember every current version, so nothing shows as Updated.
  function initSeen(seen, tools) {
    if (plainObj(seen) && Object.keys(seen).length) return seen;
    var out = {};
    tools.forEach(function (t) { out[t.id] = t.version; });
    return out;
  }

  function badgeFor(tool, seen) {
    if (!plainObj(seen)) return null;
    if (!own(seen, tool.id)) return Object.keys(seen).length ? 'new' : null;
    return seen[tool.id] !== tool.version ? 'updated' : null;
  }

  // ctx: { member, unlocked, checks: { readyId: true|false } }
  function tileStatus(tool, ctx) {
    if (!ctx.member) return { state: 'blocked', launch: null };
    if (tool.gate === 'code' && !ctx.unlocked) return { state: 'locked', launch: null };
    if (ctx.alongsideOn) return { state: 'playing', launch: 'Launch' };   // runs alongside (Rickroll) and is on now
    if (ctx.group) {                                    // tools that run together are open (Tex 2026-10-16)
      if (!tool.together && !tool.alongside) return { state: 'wait', launch: null };
      if (tool.together && ctx.groupOn) return { state: 'running', launch: null };
    }
    if (ctx.eventOff) return { state: 'off', launch: 'Launch anyway' };   // its event isn't running: it can still open
    var ok = tool.ready.every(function (r) { return isAutoFor(tool, r) || (ctx.checks && ctx.checks[r] === true); });
    return ok ? { state: 'ready', launch: 'Launch' } : { state: 'notready', launch: 'Launch anyway' };
  }

  var EVENT_TEXT = ['The event is running', 'The event isn\'t running now'];
  // A tool tied to events is running when any activity of its types is between its begin and end. No types: always.
  function eventLive(types, acts, nowSec) {
    if (!Array.isArray(types) || !types.length) return true;
    return (Array.isArray(acts) ? acts : []).some(function (a) {
      return !!a && typeof a === 'object' && types.indexOf(Number(a.type)) >= 0 && (Number(a.begintime) || 0) <= nowSec && nowSec < (Number(a.endtime) || 0);
    });
  }

  // info: { ops, matchesOverlay, position, zIndex } of an element added to the page after launch
  function isToolNode(info) {
    if (info.ops || info.alongside) return false;          // an alongside tool's screen (Rickroll) is never the running tool's
    if (info.matchesOverlay) return true;
    return info.position === 'fixed' && Number(info.zIndex) >= 1000;
  }

  // Running tracker. Phases: idle -> loading -> waiting -> running -> idle.
  function trackerInit() {
    return { phase: 'idle', nodes: [], launchedAt: null, loadedAt: null, emptySince: null, watchUntil: 0, error: false };
  }
  function trackerWatching(s, now) {
    return s.launchedAt != null && !s.error && (s.phase !== 'idle' || now <= s.watchUntil);
  }
  function trackerReduce(s, ev) {
    var n = Object.assign({}, s, { nodes: s.nodes.slice() });
    switch (ev.type) {
      case 'launch':
        return { phase: 'loading', nodes: [], launchedAt: ev.at, loadedAt: null, emptySince: null, watchUntil: ev.at + WATCH_MS, error: false };
      case 'loaded':
        if (n.phase === 'loading') { n.phase = n.nodes.length ? 'running' : 'waiting'; n.loadedAt = ev.at; }
        return n;
      case 'loadError':
        return Object.assign(trackerInit(), { error: true });
      case 'nodeAdded':
        if (!trackerWatching(s, ev.at)) return s;
        if (n.nodes.indexOf(ev.id) < 0) n.nodes.push(ev.id);
        if (n.phase !== 'loading') n.phase = 'running';
        n.emptySince = null;
        return n;
      case 'nodeRemoved':
        n.nodes = n.nodes.filter(function (x) { return x !== ev.id; });
        if (n.phase === 'running' && !n.nodes.length) n.emptySince = ev.at;
        return n;
      case 'abandon':                                   // the player closed the menu: stop waiting for a late screen
        if (n.phase === 'idle') n.watchUntil = 0;
        return n;
      case 'tick':
        if (n.phase === 'waiting' && ev.at - n.loadedAt > WAIT_MS) n.phase = 'idle';
        else if (n.phase === 'running' && !n.nodes.length && n.emptySince != null && ev.at - n.emptySince > GRACE_MS) {
          n.phase = 'idle'; n.watchUntil = 0;              // closed for real: stop watching
        }
        return n;
      default:
        return s;
    }
  }

  var OpsCore = {
    ICONS: ICONS, READY_IDS: READY_IDS, READY_TEXT: READY_TEXT,
    validateTools: validateTools, visibleTools: visibleTools, filterTools: filterTools, orderTools: orderTools, pushRecent: pushRecent,
    initSeen: initSeen, badgeFor: badgeFor, tileStatus: tileStatus, isToolNode: isToolNode, isAutoFor: isAutoFor, AUTO_TEXT: AUTO_TEXT,
    eventLive: eventLive, EVENT_TEXT: EVENT_TEXT, REGISTRIES: REGISTRIES,
    trackerInit: trackerInit, trackerReduce: trackerReduce, trackerWatching: trackerWatching
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = OpsCore;
  else root.OpsCore = OpsCore;
})(typeof window !== 'undefined' ? window : globalThis);
