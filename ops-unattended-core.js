// ops-unattended-core.js — Ops Center Unattended mode (Tex 2026-10-16): the rules the tab (ops-unattended.js) and the
// Map Collector dashboard share. A command is signed with a key made from the Map Collector password (PBKDF2, salted
// with the account), so the worker that relays it can neither make nor change one. window.OpsUnattendedCore in the
// browser, module.exports for node tests.
(function (root) {
  'use strict';
  var TOOLS = { 'mask-boxes': '__MBX', 'enigma-veins': '__VEIN', 'ht-gifts': '__HTG', 'angels': '__ANG', 'odin-gather': '__ODIN', 'map-collector': '__MAPC' };
  var ORDER = ['mask-boxes', 'enigma-veins', 'ht-gifts', 'angels', 'odin-gather', 'map-collector'];
  var NEEDS_PW = { 'map-collector': 'mapc_pw_v1', 'ht-gifts': 'htg_pw_v1' };   // started only when saved on that computer
  var KINDS = ['start', 'stop', 'stopall', 'reconnect'];
  var TTL_MS = 120000, SEEN_MS = 600000, ITER = 210000, BAD_SIG_MAX = 3, SILENT_MS = 300000, OLD_LOGIN_MS = 20 * 3600000;
  var NONCE = /^[0-9a-f]{32}$/, HEX64 = /^[0-9a-f]{64}$/;

  function cryptoObj() { return typeof crypto !== 'undefined' ? crypto : root && root.crypto; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function unhex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function utf8(s) { return new TextEncoder().encode(String(s)); }
  function canon(c) { return ['v1', c.sk, c.kind, c.tool, c.at, c.nonce].join('|'); }

  // The command key: the same 32 bytes on the dashboard and on the tab, from the password and the account.
  function deriveKey(password, siteKey) {
    var s = cryptoObj().subtle;
    return s.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8('ops-unattended-v1|' + siteKey), iterations: ITER }, k, 256); })
      .then(hex);
  }
  function sign(keyHex, cmd) {
    var s = cryptoObj().subtle;
    return s.importKey('raw', unhex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return s.sign('HMAC', k, utf8(canon(cmd))); }).then(hex);
  }
  function same(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
  function makeCommand(siteKey, kind, tool, at) {
    var r = new Uint8Array(16); cryptoObj().getRandomValues(r);
    return { v: 1, sk: siteKey, kind: kind, tool: tool || '', at: Math.round(at), nonce: hex(r) };
  }

  // Everything about a command but its signature. ctx: {siteKey, now (the worker's clock), seen {nonce: at}, tools [published ids]}.
  function checkShape(cmd, ctx) {
    if (!cmd || typeof cmd !== 'object' || cmd.v !== 1 || typeof cmd.kind !== 'string' || typeof cmd.tool !== 'string' || !NONCE.test(cmd.nonce || '') || !isFinite(cmd.at)) return 'bad command';
    if (cmd.sk !== ctx.siteKey) return 'wrong account';
    if (Math.abs(cmd.at - ctx.now) >= TTL_MS) return 'too old';
    if (ctx.seen && Object.prototype.hasOwnProperty.call(ctx.seen, cmd.nonce)) return 'seen before';
    if (KINDS.indexOf(cmd.kind) < 0) return 'unknown kind';
    if (cmd.kind === 'start' || cmd.kind === 'stop') {
      if (!Object.prototype.hasOwnProperty.call(TOOLS, cmd.tool) || (ctx.tools || []).indexOf(cmd.tool) < 0) return 'unknown tool';
    } else if (cmd.tool !== '') return 'bad command';
    return '';
  }
  // The tab's whole check: the signature first (a bad one counts toward the 3-strike stop), then the rest.
  function check(keyHex, cmd, sig, ctx) {
    if (!cmd || typeof cmd !== 'object' || typeof sig !== 'string' || !HEX64.test(sig) || !HEX64.test(keyHex || '')) return Promise.resolve({ ok: false, why: 'bad signature', badSig: true });
    return sign(keyHex, cmd).then(function (want) {
      if (!same(want, sig)) return { ok: false, why: 'bad signature', badSig: true };
      var why = checkShape(cmd, ctx);
      return why ? { ok: false, why: why } : { ok: true };
    }, function () { return { ok: false, why: 'bad signature', badSig: true }; });
  }
  function pruneSeen(seen, now) {
    var o = {};
    Object.keys(seen && typeof seen === 'object' ? seen : {}).forEach(function (n) { if (now - seen[n] < SEEN_MS) o[n] = seen[n]; });
    return o;
  }

  // The dashboard's words for one account (acc from /opsremote/state; now = the worker's clock).
  function mins(ms) { var m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
  function header(acc, now) {
    if (!acc || !acc.on) return { text: 'Off', tone: 'mute' };
    if (!acc.seenAt || now - acc.seenAt >= SILENT_MS) return { text: 'No check-in for ' + mins(now - (acc.seenAt || now)), tone: 'warn' };
    var st = acc.status || {};
    if (st.connected) return { text: 'On, connected', tone: 'ok' };
    return { text: 'On, down ' + mins(now - (acc.downSince || st.downSince || now)), tone: 'bad' };
  }
  function loginAge(acc, now) {
    var l = acc && acc.status && acc.status.loadedAt;
    if (!l) return { text: '', warn: false };
    var age = now - l, h = Math.floor(age / 3600000);
    return { text: 'login link ' + (h >= 1 ? h + 'h' : mins(age)) + ' old', warn: age > OLD_LOGIN_MS };
  }
  function toolRow(acc, id) {
    var t = acc && acc.status && acc.status.tools && acc.status.tools[id];
    var st = t && (t.state === 'running' || t.state === 'stopped') ? t.state : 'off';
    return { id: id, state: st, label: st === 'running' ? 'Running' : st === 'stopped' ? 'Stopped' + (t.why ? ': ' + t.why : '') : 'Not open', action: st === 'running' ? 'stop' : 'start' };
  }

  var OpsUnattendedCore = {
    TOOLS: TOOLS, ORDER: ORDER, NEEDS_PW: NEEDS_PW, KINDS: KINDS, TTL_MS: TTL_MS, SEEN_MS: SEEN_MS, ITER: ITER, BAD_SIG_MAX: BAD_SIG_MAX, OLD_LOGIN_MS: OLD_LOGIN_MS,
    canon: canon, deriveKey: deriveKey, sign: sign, makeCommand: makeCommand, checkShape: checkShape, check: check, pruneSeen: pruneSeen,
    mins: mins, header: header, loginAge: loginAge, toolRow: toolRow
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = OpsUnattendedCore;
  else root.OpsUnattendedCore = OpsUnattendedCore;
})(typeof window !== 'undefined' ? window : this);
