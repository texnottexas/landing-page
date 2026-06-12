// 2864tw.com — Alliance Defense Wave Skipper bookmarklet.
// Standalone. Drives the Skip / Confirm loop on the Alliance Defender
// Monster Fortress event panel (prefabWorlddefenderMonsterFortress) until
// the wave counter reaches a target you pick.
//
// Purely scene-graph driven: it finds the same Skip and Confirm buttons the
// game shows you and triggers their click handlers. No network packets are
// crafted or intercepted.
//
// How it re-opens the panel between waves: the open fortress panel keeps its
// own open arguments on the panel component (_para = [tileData, vec3, 1, eventId]).
// The bookmarklet reads those once at startup and replays them through
// UIManager.OpenUI whenever the panel closes mid-loop. That is why the panel
// must be open (click the defender monster) when you run it.
//
// Each skip spends the event's normal skip cost. This tool does not check
// or limit cost — set your target wave accordingly. Stop any time.

(function () {
  'use strict';
  var cc = window.cc;

  var PANEL = 'UICanvas/PopLayer/prefabWorlddefenderMonsterFortress';
  var SKIP_HANDLER = 'onAllianceStartNowClick'; // alliance skip (btnSkipSelf uses onSelfStartNowClick)
  var CONFIRM_ROOT = 'UICanvas/TipsLayer/ConfirmPanel';
  var CONFIRM_HANDLER = 'OnSureClick';

  // ─── re-run guard ─────────────────────────────────────────────────────
  if (window.__defSkipActive) { try { alert('Wave Skipper is already running. Use its Stop button first.'); } catch (_) {} return; }
  window.__defSkipActive = true;
  function release() { window.__defSkipActive = false; }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ─── game wiring ──────────────────────────────────────────────────────
  function getRequire() { var r = window.__require; if (!r) throw new Error('Game not loaded yet. Wait for it to finish loading, then retry.'); return r; }

  function getPanel() {
    var p = cc.find(PANEL);
    return (p && p.active) ? p : null;
  }

  // The fortress panel component carries the args it was opened with (_para).
  // Reading them lets the loop re-open the panel after each wave without any
  // click-capture hooks.
  function captureOpenArgs(req) {
    var panel = getPanel();
    if (!panel) return null;
    var comp = null;
    var comps = panel._components || [];
    for (var i = 0; i < comps.length; i++) {
      if (comps[i] && comps[i].UIName === 'prefabWorlddefenderMonsterFortress') { comp = comps[i]; break; }
    }
    if (!comp || !comp._para || !comp._para.length) return null;
    var uiData = null;
    try { uiData = req('UIDataInfo').UIDataInfo['prefabWorlddefenderMonsterFortress']; } catch (e) {}
    if (!uiData) return null;
    return { uiData: uiData, args: comp._para.slice() };
  }

  function reopenPanel(req, openArgs) {
    var UM = req('UIManager').default.Instance();
    UM.OpenUI.apply(UM, [openArgs.uiData].concat(openArgs.args));
  }

  // Find a cc.Button inside rootPath whose clickEvents include the handler.
  // Inactive branches hold stale copies of the same button, so only active
  // nodes count.
  function findBtnByHandler(rootPath, handler) {
    var root = cc.find(rootPath);
    if (!root || !root.active) return null;
    var found = null;
    (function walk(n, d) {
      if (found || !n || d > 18 || !n.active) return;
      var btn = n.getComponent(cc.Button);
      if (btn && btn.clickEvents && btn.interactable !== false) {
        for (var i = 0; i < btn.clickEvents.length; i++) {
          if (btn.clickEvents[i].handler === handler) { found = { node: n, btn: btn }; return; }
        }
      }
      var ch = n.children || [];
      for (var j = 0; j < ch.length; j++) walk(ch[j], d + 1);
    })(root, 0);
    return found;
  }

  // The skip button blinks in and out while the wave state machine settles.
  // Clicking on first sighting gets swallowed, so require it present on
  // several consecutive polls before treating it as clickable.
  async function waitForStableBtn(rootPath, handler, timeoutMs, abort) {
    var stable = 0, found = null;
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(abort && abort.aborted)) {
      var f = findBtnByHandler(rootPath, handler);
      if (f) { found = f; stable++; if (stable >= 5) return found; }
      else { found = null; stable = 0; }
      await delay(150);
    }
    return null;
  }

  function emitBtn(found) { found.btn.clickEvents.forEach(function (e) { e.emit([found.node]); }); }

  // Wave label is "Waves:N" on levelLabel. The game label class is a custom
  // CCClass, not cc.Label, so duck-type on .string.
  function readWave() {
    var panel = getPanel();
    if (!panel) return null;
    var val = null;
    (function walk(n, d) {
      if (val !== null || !n || d > 22) return;
      if (n.name === 'levelLabel') {
        var comps = n._components || [];
        for (var i = 0; i < comps.length; i++) {
          var c = comps[i];
          if (c && typeof c.string === 'string') {
            var m = c.string.match(/(\d+)/);
            if (m) { val = parseInt(m[1], 10); return; }
          }
        }
      }
      var ch = n.children || [];
      for (var j = 0; j < ch.length; j++) walk(ch[j], d + 1);
    })(panel, 0);
    return val;
  }

  // ─── skip loop ────────────────────────────────────────────────────────
  async function runSkips(req, opts) {
    var openArgs = opts.openArgs;
    var stats = { startWave: readWave(), lastWave: null, advanced: 0, friction: { noSkip: 0, skipVanished: 0, noConfirm: 0, noAdvance: 0, reclicks: 0 }, lastError: null };
    var lastWave = stats.startWave;
    stats.lastWave = lastWave;
    var maxCycles = Math.max(20, (opts.target - (lastWave || 0)) * 3 + 20);

    for (var i = 0; i < maxCycles && (lastWave === null || lastWave < opts.target); i++) {
      if (opts.abort.aborted) { stats.aborted = true; break; }

      // Re-open panel if a wave transition closed it
      if (!getPanel()) {
        try { reopenPanel(req, openArgs); } catch (e) { stats.lastError = 'Could not reopen the fortress panel'; break; }
        var pd = Date.now() + 3000;
        while (Date.now() < pd && !getPanel()) await delay(50);
        if (!getPanel()) { stats.lastError = 'Fortress panel did not reopen'; break; }
      }

      // Wait for the Skip button to be present AND stable (covers the wave
      // transition animation plus the blink-in window)
      var skip = await waitForStableBtn(PANEL, SKIP_HANDLER, 20000, opts.abort);
      if (opts.abort.aborted) { stats.aborted = true; break; }
      if (!skip) { stats.friction.noSkip++; opts.onProgress(stats, 'waiting on skip button'); continue; }

      // Re-find right before clicking so the emitted node is fresh
      var fresh = findBtnByHandler(PANEL, SKIP_HANDLER);
      if (!fresh) { stats.friction.skipVanished++; opts.onProgress(stats, 'skip button not settled'); continue; }
      emitBtn(fresh);

      // Confirm dialog; if the click was swallowed, re-click once
      var cf = null;
      for (var attempt = 0; attempt < 2 && !cf; attempt++) {
        var cd = Date.now() + 3000;
        while (Date.now() < cd) {
          cf = findBtnByHandler(CONFIRM_ROOT, CONFIRM_HANDLER);
          if (cf) break;
          await delay(50);
        }
        if (!cf && attempt === 0) {
          var again = findBtnByHandler(PANEL, SKIP_HANDLER);
          if (again) { stats.friction.reclicks++; emitBtn(again); } else break;
        }
      }
      if (!cf) { stats.friction.noConfirm++; opts.onProgress(stats, 'no confirm dialog'); await delay(1200); continue; }
      emitBtn(cf);

      // Wait for the wave label to actually advance (authoritative). The
      // live transition animation can run well past 8s, so give it room.
      var adl = Date.now() + 15000;
      var newWave = lastWave;
      while (Date.now() < adl) {
        var w = readWave();
        if (w !== null && w !== lastWave) { newWave = w; break; }
        await delay(100);
      }
      if (newWave !== lastWave) {
        lastWave = newWave;
        stats.lastWave = newWave;
        stats.advanced++;
        opts.onProgress(stats, 'wave ' + newWave);
        // small breather so the next cycle starts after the new wave settles
        await delay(500);
      } else {
        stats.friction.noAdvance++;
        opts.onProgress(stats, 'wave did not advance yet');
      }
    }
    if (!stats.aborted && stats.lastWave < opts.target && !stats.lastError) stats.lastError = 'Stopped at the safety cycle limit';
    return stats;
  }

  // ─── UI ───────────────────────────────────────────────────────────────
  function el(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function buildOverlay() {
    var bg = el('div', 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');
    var hdr = el('div', 'color:#79c0ff;font-size:15px;font-weight:600;text-align:center;', 'Alliance Defense Wave Skipper');
    var sub = el('div', 'color:#8b949e;font-size:12px;margin:4px 0 10px;text-align:center;', 'Loading…');
    var body = el('div', 'flex:1;display:flex;flex-direction:column;min-height:0;');
    bg.appendChild(hdr); bg.appendChild(sub); bg.appendChild(body);
    document.body.appendChild(bg);
    return {
      root: bg, body: body,
      setHeader: function (t, c) { hdr.textContent = t; if (c) hdr.style.color = c; },
      setSub: function (t, c) { sub.textContent = t; if (c) sub.style.color = c; },
      remove: function () { try { document.body.removeChild(bg); } catch (_) {} release(); },
    };
  }

  function showConfig(overlay, currentWave, onStart) {
    clearChildren(overlay.body);
    overlay.setHeader('Alliance Defense Wave Skipper', '#79c0ff');
    overlay.setSub('Currently on wave ' + currentWave, '#8b949e');
    var card = el('div', 'background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:14px;color:#e6edf3;font-size:13px;display:flex;flex-direction:column;gap:14px;');
    var row = el('div', 'display:flex;align-items:center;gap:10px;');
    row.appendChild(el('span', 'flex:0 0 auto;', 'Skip to wave:'));
    var input = el('input', 'flex:1;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px;font-size:14px;');
    input.type = 'number'; input.min = String(currentWave + 1); input.value = String(currentWave + 10);
    row.appendChild(input); card.appendChild(row);
    overlay.body.appendChild(card);
    overlay.body.appendChild(el('div', 'color:#d29922;font-size:11px;line-height:1.4;margin-top:10px;', 'Each skip spends the normal in-game skip cost. This tool does not check or limit cost. You can stop at any time.'));
    var footer = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:auto;padding-top:12px;');
    var startBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Start skipping');
    startBtn.addEventListener('click', function () {
      var n = parseInt(input.value, 10);
      if (!n || n <= currentWave) { input.style.borderColor = '#f85149'; return; }
      onStart(n);
    });
    var closeBtn = el('button', 'padding:12px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;', 'Close');
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    footer.appendChild(startBtn); footer.appendChild(closeBtn); overlay.body.appendChild(footer);
  }

  function showProgress(overlay, startWave, target) {
    clearChildren(overlay.body);
    overlay.setHeader('Skipping…', '#d29922');
    overlay.setSub('Wave ' + startWave + ' of ' + target, '#8b949e');
    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;margin-bottom:10px;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .15s;'); barWrap.appendChild(bar); overlay.body.appendChild(barWrap);
    var log = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6edf3;font-size:11px;font-family:monospace;'); overlay.body.appendChild(log);
    var abortBtn = el('button', 'padding:12px;background:transparent;color:#f85149;border:1px solid #f85149;border-radius:6px;font-size:13px;margin-top:10px;', 'Stop after current wave'); overlay.body.appendChild(abortBtn);
    var abort = { aborted: false };
    abortBtn.addEventListener('click', function () { abort.aborted = true; abortBtn.disabled = true; abortBtn.textContent = 'Stopping…'; });
    var span = Math.max(1, target - startWave);
    return {
      abort: abort,
      update: function (stats, note) {
        var done = (stats.lastWave || startWave) - startWave;
        bar.style.width = Math.min(100, Math.round((done / span) * 100)) + '%';
        overlay.setSub('Wave ' + (stats.lastWave || startWave) + ' of ' + target, '#8b949e');
        log.appendChild(el('div', 'color:' + (note.indexOf('wave ') === 0 ? '#3fb950' : '#8b949e') + ';', note));
        log.scrollTop = log.scrollHeight;
      },
    };
  }

  function showSummary(overlay, stats, target) {
    clearChildren(overlay.body);
    overlay.setHeader(stats.aborted ? 'Stopped' : stats.lastError ? 'Stopped early' : 'Done', (stats.aborted || stats.lastError) ? '#d29922' : '#3fb950');
    overlay.setSub('Skipped from wave ' + stats.startWave + ' to wave ' + stats.lastWave, '#8b949e');
    var body = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;color:#e6edf3;font-size:13px;');
    if (stats.lastError) body.appendChild(el('div', 'color:#f85149;margin-bottom:10px;', stats.lastError));
    body.appendChild(el('div', 'margin-bottom:4px;', 'Waves advanced: ' + stats.advanced));
    body.appendChild(el('div', 'margin-bottom:4px;', 'Target: ' + target));
    var f = stats.friction;
    var fTotal = f.noSkip + f.skipVanished + f.noConfirm + f.noAdvance;
    if (fTotal) body.appendChild(el('div', 'color:#8b949e;font-size:12px;margin-top:8px;', 'Retried cycles: ' + fTotal + ' (the loop recovers from these on its own)'));
    body.appendChild(el('div', 'color:#30363d;font-size:11px;margin-top:14px;', '#fkboats'));
    overlay.body.appendChild(body);
    var doneBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;margin-top:10px;', 'Close');
    doneBtn.addEventListener('click', function () { overlay.remove(); }); overlay.body.appendChild(doneBtn);
  }

  function showError(overlay, message) {
    clearChildren(overlay.body);
    overlay.setHeader('Failed', '#f85149'); overlay.setSub(message, '#f85149');
    var btn = el('button', 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;margin-top:10px;align-self:center;', 'Close');
    btn.addEventListener('click', function () { overlay.remove(); }); overlay.body.appendChild(btn);
  }

  // ─── entry ────────────────────────────────────────────────────────────
  var overlay = null;
  try { overlay = buildOverlay(); } catch (_) {}
  (async function main() {
    try {
      var req = getRequire();
      if (!cc) throw new Error('Game engine not ready. Wait for the game to load, then retry.');

      // Need the fortress panel open to read its open args. If it is not,
      // give the player a window to click the defender monster.
      if (!getPanel()) {
        if (overlay) overlay.setSub('Click the alliance defender monster on the world map to open its panel…', '#d29922');
        var wd = Date.now() + 60000;
        while (Date.now() < wd && !getPanel()) await delay(400);
        if (!getPanel()) throw new Error('Fortress panel not opened. Click the defender monster, then run this again.');
      }

      var openArgs = captureOpenArgs(req);
      if (!openArgs) throw new Error('Could not read the panel open data. Close the panel, click the defender monster again, then rerun.');

      var currentWave = readWave();
      if (currentWave === null) throw new Error('Could not read the current wave from the panel.');
      if (!overlay) { try { alert('Wave Skipper: overlay failed to build.'); } catch (_) {} release(); return; }

      showConfig(overlay, currentWave, function (target) {
        var progress = showProgress(overlay, currentWave, target);
        runSkips(req, { target: target, openArgs: openArgs, abort: progress.abort, onProgress: progress.update })
          .then(function (stats) { showSummary(overlay, stats, target); })
          .catch(function (e) { showError(overlay, e && e.message ? e.message : String(e)); });
      });
    } catch (err) {
      if (overlay) showError(overlay, err && err.message ? err.message : String(err));
      else { try { alert('Wave Skipper failed: ' + (err && err.message || err)); } catch (_) {} release(); }
    }
  })();
})();
