// ops-jam.js — Jam mode (Tex, 2026-10-14): a music-note button for an Ops tool card's title row that plays or stops
// the Rickroll tool alongside the tool. It loads Rickroll from the tool list the way the Angels switch loads Angel
// Attacks. Optional, like ops-drag.js: a card without it is as before. Sends nothing to the game.
// window.OpsJam in the browser; the pure part for node tests.
(function (root) {
  'use strict';
  // The Rickroll entry's scripts and version from the tool list, or null (plain file names only: our own site).
  function jamScripts(reg) {
    var t = (reg && Array.isArray(reg.tools) ? reg.tools : []).filter(function (x) { return x && x.id === 'rickroll'; })[0];
    if (!t || typeof t.version !== 'string' || !t.version || !Array.isArray(t.scripts) || !t.scripts.length) return null;
    if (!t.scripts.every(function (s) { return typeof s === 'string' && /^[a-z0-9-]+\.js$/.test(s); })) return null;
    return { version: t.version, scripts: t.scripts.slice() };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { jamScripts: jamScripts }; return; }
  if (root.OpsJam) return;                                  // one helper per page; the cards share it

  var buttons = [], timer = null, loading = false, failedUntil = 0;
  var LOAD_MS = root.__JAM_LOAD_MS || 15000;               // a load that never answers gives up, so the note isn't stuck
  var MUTED = '#8b949e', ON = '#79c0ff', WARN = '#d29922';
  function playing() { return !!(root.__RR && document.getElementById('rr-root')); }
  var WORKER = root.__JAM_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  // The game: this page, or the game Map Collector runs in a frame in Unattended mode.
  function gameWindow() { try { var f = document.getElementById('mapc-frame'); if (f && f.contentWindow && f.contentWindow.__require) return f.contentWindow; } catch (e) {} return root; }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  // A Jam start counts on the Tool usage panel like an Ops Center launch (Tex 2026-10-14): siteKey (a hash of the game's
  // UID, never the UID), in-game name, tool, version, open. A failed report never touches the song.
  function report(version) {
    var u = null; try { u = gameWindow().__require('DataCenter').DATA.UserData; } catch (e) { return; }
    var id = u ? String(u.StrUid || u._uid || '') : ''; if (!id) return;
    var name = String(u.Name || '').slice(0, 40);
    sha256Hex(id).then(function (h) {
      return fetch(WORKER + '/ops/usage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', keepalive: true,
        body: JSON.stringify({ siteKey: h.slice(0, 16), name: name, tool: 'rickroll', version: String(version), open: true }) });
    }).catch(function () {});
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { s.remove(); resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('load failed: ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function start() {
    if (loading) return;
    loading = true; paintAll();
    var base = root.__OPS_BASE || 'https://2864tw.com/', ver = '';
    var load = fetch(base + 'ops-tools.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (reg) {
        var j = jamScripts(reg);
        if (!j) throw new Error('not listed');
        ver = j.version;
        return j.scripts.reduce(function (p, f) {
          return p.then(function () { var q = loadScript(base + f + '?v=' + encodeURIComponent(j.version)); return /^ops-(drag|jam)\.js$/.test(f) ? q.catch(function () {}) : q; });   // the helpers are optional
        }, Promise.resolve());
      });
    Promise.race([load, new Promise(function (ok, no) { setTimeout(function () { no(new Error('timed out')); }, LOAD_MS); })])
      .then(function () { loading = false; if (playing()) report(ver); paintAll(); }, function () { loading = false; failedUntil = Date.now() + 4000; paintAll(); });
  }
  function toggle(e) {
    e.stopPropagation(); e.preventDefault();                // a folded card's title opens it on a click: not this one
    if (playing()) { try { root.__RR.stop(); } catch (x) {} paintAll(); return; }
    start();
  }
  function paint(b) {
    var on = playing(), bad = !on && Date.now() < failedUntil;
    var label = bad ? 'Couldn\'t load Rickroll' : on ? 'Jam: stop Rickroll' : 'Jam: play Rickroll';
    b.style.color = on ? ON : bad ? WARN : MUTED;            // inline: each card's own button colour rule would win otherwise
    b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-busy', String(loading));
    if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
  }
  function paintAll() {
    var now = Date.now();
    buttons = buttons.filter(function (x) { return x.b.isConnected || now - x.at < 5000; });   // a card that closed drops its button
    buttons.forEach(function (x) { paint(x.b); });
    if (!buttons.length && timer) { clearInterval(timer); timer = null; }
  }
  function button() {
    var NS = 'http://www.w3.org/2000/svg', b = document.createElement('button'), svg = document.createElementNS(NS, 'svg');
    b.type = 'button'; b.className = 'ops-jam';
    b.style.cssText = 'flex:none;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;display:grid;place-items:center;cursor:pointer;color:' + MUTED;
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    ['M9 18V5l11-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'].forEach(function (d) {
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); svg.appendChild(p);
    });
    b.appendChild(svg);
    b.addEventListener('click', toggle);
    buttons.push({ b: b, at: Date.now() }); paint(b);
    if (!timer) timer = setInterval(paintAll, 1000);         // a song stopped from its own card dims every button
    return b;
  }
  root.OpsJam = { button: button, jamScripts: jamScripts, playing: playing };
})(typeof window !== 'undefined' ? window : globalThis);
