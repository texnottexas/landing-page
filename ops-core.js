// ops-core.js — Ops Center pure rules: the tool list, search, order, badges, gates,
// tile status and the running tracker. No DOM, no game access. Exported for
// node tests and as window.OpsCore in the browser.
(function (root) {
  'use strict';

  var ICONS = ['list', 'x', 'clock', 'shield', 'refresh', 'users', 'grid'];
  var READY_IDS = ['game', 'base', 'defender', 'r4'];
  var GATES = ['member', 'code'];
  var READY_TEXT = {
    game: ['Game loaded', 'Wait for the game to finish loading'],
    base: ['Your base is open', 'Takes you to your base first'],
    defender: ['The defender monster\'s panel is open', 'Tap the defender monster (you can also do this after launching)'],
    r4: ['You are R4 or leader', 'You need to be R4 or leader in your alliance']
  };
  // readiness items the tool sorts out by itself (Troop Optimizer goes to your base): never a blocker
  var AUTO = { base: true };
  function isAuto(id) { return AUTO[id] === true; }
  var WAIT_MS = 10000, GRACE_MS = 1000, WATCH_MS = 120000, RECENT_MAX = 3;

  function isStr(v) { return typeof v === 'string' && v.length > 0; }

  // Keep tools that are complete and safe; drop the rest (scripts may only be plain file names,
  // always loaded from 2864tw.com, so a bad list cannot pull code from anywhere else).
  function validateTools(raw) {
    var out = { codeSha256: null, tools: [] };
    if (!raw || typeof raw !== 'object') return out;
    if (/^[0-9a-f]{64}$/.test(raw.codeSha256 || '')) out.codeSha256 = raw.codeSha256;
    var seen = {};
    (Array.isArray(raw.tools) ? raw.tools : []).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      if (!/^[a-z0-9-]+$/.test(t.id || '') || seen[t.id]) return;
      if (!isStr(t.title) || !isStr(t.desc) || !isStr(t.version)) return;
      if (GATES.indexOf(t.gate) < 0) return;
      if (!Array.isArray(t.scripts) || !t.scripts.length || !t.scripts.every(function (s) { return /^[a-z0-9-]+\.js$/.test(s); })) return;
      if (!Array.isArray(t.ready) || !t.ready.every(function (r) { return READY_IDS.indexOf(r) >= 0; })) return;
      seen[t.id] = true;
      out.tools.push({
        id: t.id, title: t.title, desc: t.desc, version: t.version, gate: t.gate,
        scripts: t.scripts.slice(), ready: t.ready.slice(),
        icon: ICONS.indexOf(t.icon) >= 0 ? t.icon : 'grid',
        keywords: typeof t.keywords === 'string' ? t.keywords : '',
        overlay: /^#[A-Za-z0-9_-]+$/.test(t.overlay || '') ? t.overlay : null
      });
    });
    return out;
  }

  function filterTools(tools, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return tools.slice();
    return tools.filter(function (t) { return (t.title + ' ' + t.desc + ' ' + t.keywords).toLowerCase().indexOf(q) >= 0; });
  }

  function orderTools(tools, recent) {
    var byId = {}, out = [], used = {};
    tools.forEach(function (t) { byId[t.id] = t; });
    (recent || []).forEach(function (id) { if (byId[id] && !used[id]) { used[id] = true; out.push(byId[id]); } });
    tools.forEach(function (t) { if (!used[t.id]) out.push(t); });
    return out;
  }

  function pushRecent(recent, id) {
    return [id].concat((recent || []).filter(function (x) { return x !== id; })).slice(0, RECENT_MAX);
  }

  // First ever open: remember every current version, so nothing shows as Updated.
  function initSeen(seen, tools) {
    if (seen && Object.keys(seen).length) return seen;
    var out = {};
    tools.forEach(function (t) { out[t.id] = t.version; });
    return out;
  }

  function badgeFor(tool, seen) {
    seen = seen || {};
    if (seen[tool.id] == null) return Object.keys(seen).length ? 'new' : null;
    return seen[tool.id] !== tool.version ? 'updated' : null;
  }

  // ctx: { member, unlocked, checks: { readyId: true|false } }
  function tileStatus(tool, ctx) {
    if (!ctx.member) return { state: 'blocked', launch: null };
    if (tool.gate === 'code' && !ctx.unlocked) return { state: 'locked', launch: null };
    var ok = tool.ready.every(function (r) { return isAuto(r) || (ctx.checks && ctx.checks[r] === true); });
    return ok ? { state: 'ready', launch: 'Launch' } : { state: 'notready', launch: 'Launch anyway' };
  }

  // info: { ops, matchesOverlay, position, zIndex } of an element added to the page after launch
  function isToolNode(info) {
    if (info.ops) return false;
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
    validateTools: validateTools, filterTools: filterTools, orderTools: orderTools, pushRecent: pushRecent,
    initSeen: initSeen, badgeFor: badgeFor, tileStatus: tileStatus, isToolNode: isToolNode, isAuto: isAuto,
    trackerInit: trackerInit, trackerReduce: trackerReduce, trackerWatching: trackerWatching
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = OpsCore;
  else root.OpsCore = OpsCore;
})(typeof window !== 'undefined' ? window : globalThis);
