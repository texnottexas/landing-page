// 2864tw.com — Hunting Guild Bulk Merge bookmarklet (full-API turbo build).
// Standalone. Spends Hunting Guild merge stars and resolves every treasure
// scenario through the game's OWN network API — no panels, no animations.
//
// Each merge = NET.send(CREATE_TREASURE_MAP_DATA) which returns the new
// treasure {id, type, ...}. We then resolve it by type via the same request
// the game's own handlers use:
//   type 1  Repair Equipment → DONATE_TREASURE_MAP_ITEM (1683) {id,itemId,num:100}
//                              then AWARD_DONATE_ITEM_TREASURE_MAP (1684) {id}
//   type 2  Treasure Guard   → TreasureMapChooseBoss (1686) {id,quality}
//                              quality 2 = Rare, 0 = Common (or Skip = leave it)
//   type 3  Treasure Wheel   → LOTTERY_TURN_TABLE_TREASURE_MAP (1685) {id}
//   type 4  Treasure Store   → nothing to collect (shop), skipped
//
// These are the EXACT request IDs + payloads the in-game buttons fire (captured
// live), called through NET.send — NOT hand-crafted binary packets. Boss summon
// via API does NOT navigate to the world map, so the loop never leaves the guild.
//
// Light jitter between calls keeps a human-ish cadence. Abort any time.
//
// Treasure Guard summons (Rare/Common) still spawn a guard on the world map that
// must be fought within 1 hour or it expires.

(function () {
  'use strict';
  var cc = window.cc;

  // ─── request IDs (verified live) ──────────────────────────────────────
  var RID = { create: 1682, donate: 1683, claim: 1684, lottery: 1685, summonBoss: 1686 };
  // Acceptable Repair-Equipment contribute items, tried in order until one works.
  var DONATE_ITEMS = [300001, 301001, 302001, 303001, 310001, 311001, 312001, 313001, 320001, 321001, 322001, 323001];
  var DONATE_NUM = 100;
  // type → scenario
  var TYPE = { 1: 'donate', 2: 'boss', 3: 'wheel', 4: 'store' };

  // ─── tuning ───────────────────────────────────────────────────────────
  var T = { subCall: [120, 100], betweenMerge: [300, 200] };
  function jit(p) { return p[0] + Math.floor(Math.random() * p[1]); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ─── game wiring ──────────────────────────────────────────────────────
  function getRequire() { var r = window.__require; if (!r) throw new Error('Game not loaded — wait for it to finish loading, then retry'); return r; }
  function getNET(req) { try { return req('NetMgr').NET; } catch (e) { throw new Error('Network layer not ready — wait a moment and retry'); } }
  function getUIMgr(req) { try { return req('UIManager').default.Instance(); } catch (e) { return null; } }
  function getUIDataInfo(req) { try { return req('UIDataInfo').UIDataInfo; } catch (e) { return null; } }

  // one request → resolves {s, t} where t is the parsed JSON response data (or null)
  function netCall(NET, req, data) {
    return new Promise(function (resolve) {
      var done = false;
      setTimeout(function () { if (!done) { done = true; resolve({ s: -1, timeout: true }); } }, 8000);
      try {
        NET.send(req, data, null, function (e) {
          if (done) return; done = true;
          var t = null;
          try { t = (e && typeof e.d === 'string') ? JSON.parse(e.d) : (e && e.d) || null; } catch (_) { t = null; }
          resolve({ s: e ? e.s : -1, t: t, rawD: e && e.d });
        });
      } catch (err) { if (!done) { done = true; resolve({ s: -1, err: err && err.message }); } }
    });
  }

  // read the Merge button star count "X/9" (for the available-merge estimate)
  function readMergeCount() {
    var m = cc.find('UICanvas/PopLayer/TreasureMapTaskNode/CONTENT/TreasureMapTaskNode/bottom/button');
    if (!m) return null;
    var s = null;
    (function fn(n) { if (s) return; var comps = n._components || []; for (var i = 0; i < comps.length; i++) { if (comps[i] instanceof cc.Label && /\d/.test(comps[i].string || '')) { s = comps[i].string; return; } } var ch = n.children || []; for (var j = 0; j < ch.length; j++) fn(ch[j]); })(m);
    if (!s) return null;
    var parts = String(s).split('/').map(function (x) { return parseInt(x, 10); });
    return { stars: parts[0] || 0, per: parts[1] || 9 };
  }

  async function ensureGuild(req) {
    if (readMergeCount()) return true;
    var UM = getUIMgr(req), D = getUIDataInfo(req);
    if (UM && D) { try { UM.OpenUI(D.TreasureMapTaskNode); } catch (e) {} }
    for (var i = 0; i < 12; i++) { await delay(250); if (readMergeCount()) return true; }
    return !!readMergeCount();
  }

  // ─── per-treasure resolvers (all via NET API) ─────────────────────────
  async function resolveDonate(NET, t) {
    var need = DONATE_NUM;
    try { var dd = JSON.parse(t.data); if (dd && typeof dd.num === 'number') need = Math.max(1, DONATE_NUM - dd.num); } catch (_) {}
    var donatedOk = false;
    for (var i = 0; i < DONATE_ITEMS.length; i++) {
      var r = await netCall(NET, RID.donate, { id: t.id, itemId: DONATE_ITEMS[i], num: need });
      if (r.s === 0) { donatedOk = true; break; }
      await delay(jit(T.subCall));
    }
    if (!donatedOk) return { ok: false, reason: 'no-donate-item' };
    await delay(jit(T.subCall));
    var c = await netCall(NET, RID.claim, { id: t.id });
    return { ok: c.s === 0, claimS: c.s };
  }
  async function resolveBoss(NET, t, policy) {
    if (policy === 'skip') return { ok: true, skipped: true };
    var quality = policy === 'common' ? 0 : 2;
    var r = await netCall(NET, RID.summonBoss, { id: t.id, quality: quality });
    return { ok: r.s === 0, summoned: r.s === 0 };
  }
  async function resolveWheel(NET, t) {
    var r = await netCall(NET, RID.lottery, { id: t.id });
    return { ok: true, spinS: r.s }; // best-effort; lottery returns a result code
  }

  // ─── main loop ────────────────────────────────────────────────────────
  async function runTurbo(req, opts) {
    var NET = getNET(req);
    var stats = { done: 0, byScenario: { donate: 0, wheel: 0, store: 0, boss: 0, unknown: 0 }, bossSummoned: 0, lastError: null };
    for (var cyc = 1; cyc <= opts.count; cyc++) {
      if (opts.abort.aborted) { stats.aborted = true; break; }
      var resp = await netCall(NET, RID.create, null);
      if (resp.s !== 0 || !resp.t) {
        stats.lastError = resp.timeout ? 'create timed out' : ('create failed (status ' + resp.s + ') — likely out of stars');
        break;
      }
      var t = resp.t;
      var scen = TYPE[t.type] || 'unknown';
      try {
        if (scen === 'donate') await resolveDonate(NET, t);
        else if (scen === 'boss') { var b = await resolveBoss(NET, t, opts.bossPolicy); if (b.summoned) stats.bossSummoned++; }
        else if (scen === 'wheel') await resolveWheel(NET, t);
        // store / unknown: nothing to collect
      } catch (e) { stats.lastError = 'resolve ' + scen + ': ' + (e && e.message); }
      stats.byScenario[scen] = (stats.byScenario[scen] || 0) + 1;
      stats.done++;
      if (opts.onProgress) opts.onProgress({ stats: stats, cycle: cyc, scenario: scen });
      if (cyc !== opts.count) await delay(jit(T.betweenMerge));
    }
    return stats;
  }

  // ─── UI ───────────────────────────────────────────────────────────────
  var SCEN_COLOR = { donate: '#3fb950', wheel: '#3fb950', store: '#3fb950', boss: '#3fb950', unknown: '#6e7681' };
  var SCEN_LABEL = { donate: 'Repair Equipment', wheel: 'Treasure Wheel', store: 'Treasure Store', boss: 'Treasure Guard', unknown: '(unknown)' };
  function el(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function buildOverlay() {
    var bg = el('div', 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');
    var hdr = el('div', 'color:#79c0ff;font-size:15px;font-weight:600;text-align:center;', 'Hunting Guild — Bulk Merge (Turbo)');
    var sub = el('div', 'color:#8b949e;font-size:12px;margin:4px 0 10px;text-align:center;', 'Loading…');
    var body = el('div', 'flex:1;display:flex;flex-direction:column;min-height:0;');
    bg.appendChild(hdr); bg.appendChild(sub); bg.appendChild(body);
    document.body.appendChild(bg);
    return { root: bg, body: body, setHeader: function (t, c) { hdr.textContent = t; if (c) hdr.style.color = c; }, setSub: function (t, c) { sub.textContent = t; if (c) sub.style.color = c; }, remove: function () { try { document.body.removeChild(bg); } catch (_) {} } };
  }

  function showConfig(overlay, count, max, onStart) {
    clearChildren(overlay.body);
    overlay.setHeader('Hunting Guild — Bulk Merge (Turbo)', '#79c0ff');
    overlay.setSub('Each merge costs 9 stars · about ' + max + ' merges available', '#8b949e');
    var card = el('div', 'background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:14px;color:#e6edf3;font-size:13px;display:flex;flex-direction:column;gap:14px;');
    var cRow = el('div', 'display:flex;align-items:center;gap:10px;');
    cRow.appendChild(el('span', 'flex:0 0 auto;', 'Merges to run:'));
    var input = el('input', 'flex:1;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px;font-size:14px;');
    input.type = 'number'; input.min = '1'; input.max = String(max); input.value = String(Math.min(count, max));
    cRow.appendChild(input); card.appendChild(cRow);
    var maxBtn = el('button', 'align-self:flex-start;background:transparent;color:#79c0ff;border:1px solid #30363d;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;', 'Max (' + max + ')');
    maxBtn.addEventListener('click', function () { input.value = String(max); });
    card.appendChild(maxBtn);
    card.appendChild(el('div', 'color:#8b949e;font-size:12px;margin-top:4px;', 'When a Treasure Guard rolls:'));
    var policy = 'rare';
    var polRow = el('div', 'display:flex;flex-direction:column;gap:6px;');
    [['rare', 'Summon Rare (200B coin, best reward — spawns a guard to fight)'], ['common', 'Summon Common (free — spawns a guard to fight)'], ['skip', 'Skip (leave it, no summon)']].forEach(function (opt) {
      var lbl = el('label', 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;');
      var rb = el('input'); rb.type = 'radio'; rb.name = 'bp'; if (opt[0] === 'rare') rb.checked = true;
      rb.addEventListener('change', function () { if (rb.checked) policy = opt[0]; });
      lbl.appendChild(rb); lbl.appendChild(el('span', '', opt[1])); polRow.appendChild(lbl);
    });
    card.appendChild(polRow);
    overlay.body.appendChild(card);
    overlay.body.appendChild(el('div', 'color:#d29922;font-size:11px;line-height:1.4;margin-top:10px;', 'Note: Rare/Common summons spawn a guard on the world map that must be fought within 1 hour. Donate scenarios auto-spend your repair items.'));
    var footer = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:auto;padding-top:12px;');
    var startBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Start merging');
    startBtn.addEventListener('click', function () { var n = parseInt(input.value, 10); if (!n || n < 1) return; if (n > max) n = max; onStart(n, policy); });
    var closeBtn = el('button', 'padding:12px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;', 'Close');
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    footer.appendChild(startBtn); footer.appendChild(closeBtn); overlay.body.appendChild(footer);
  }

  function showProgress(overlay, total) {
    clearChildren(overlay.body);
    overlay.setHeader('Merging…', '#d29922');
    overlay.setSub('0 / ' + total + ' merges', '#8b949e');
    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;margin-bottom:10px;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .15s;'); barWrap.appendChild(bar); overlay.body.appendChild(barWrap);
    var counts = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:11px;'); overlay.body.appendChild(counts);
    var log = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6edf3;font-size:11px;font-family:monospace;'); overlay.body.appendChild(log);
    var abortBtn = el('button', 'padding:12px;background:transparent;color:#f85149;border:1px solid #f85149;border-radius:6px;font-size:13px;margin-top:10px;', 'Stop after current merge'); overlay.body.appendChild(abortBtn);
    var abort = { aborted: false };
    abortBtn.addEventListener('click', function () { abort.aborted = true; abortBtn.disabled = true; abortBtn.textContent = 'Stopping…'; });
    return {
      abort: abort,
      update: function (info) {
        bar.style.width = Math.round((info.cycle / total) * 100) + '%';
        overlay.setSub(info.cycle + ' / ' + total + ' merges' + (info.stats.bossSummoned ? ' · ' + info.stats.bossSummoned + ' guards summoned' : ''), '#8b949e');
        clearChildren(counts);
        Object.keys(SCEN_LABEL).forEach(function (k) { if (k === 'unknown') return; var v = info.stats.byScenario[k] || 0; if (!v) return; counts.appendChild(el('span', 'padding:2px 7px;border-radius:9px;background:' + SCEN_COLOR[k] + ';color:#0d1117;font-weight:600;', SCEN_LABEL[k] + ' ' + v)); });
        log.appendChild(el('div', 'color:' + (SCEN_COLOR[info.scenario] || '#8b949e') + ';', '#' + info.cycle + ' → ' + (SCEN_LABEL[info.scenario] || info.scenario)));
        log.scrollTop = log.scrollHeight;
      },
    };
  }

  function showSummary(overlay, stats, total) {
    clearChildren(overlay.body);
    overlay.setHeader(stats.aborted ? 'Stopped' : stats.lastError ? 'Stopped early' : 'Done', (stats.aborted || stats.lastError) ? '#d29922' : '#3fb950');
    overlay.setSub(stats.done + ' / ' + total + ' merges completed', '#8b949e');
    var body = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;color:#e6edf3;font-size:13px;');
    if (stats.lastError) body.appendChild(el('div', 'color:#f85149;margin-bottom:10px;', 'Stopped: ' + stats.lastError));
    body.appendChild(el('div', 'margin-bottom:8px;', 'Stars spent: ' + (stats.done * 9)));
    body.appendChild(el('div', 'font-weight:600;color:#79c0ff;margin:8px 0 4px;', 'Scenarios handled:'));
    Object.keys(SCEN_LABEL).forEach(function (k) { if (k === 'unknown') return; var v = stats.byScenario[k] || 0; if (!v) return; var row = el('div', 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #21262d;'); row.appendChild(el('span', 'color:' + SCEN_COLOR[k] + ';', SCEN_LABEL[k])); row.appendChild(el('span', '', String(v))); body.appendChild(row); });
    if (stats.bossSummoned) body.appendChild(el('div', 'margin-top:10px;color:#3fb950;font-weight:600;', '⚔ ' + stats.bossSummoned + ' Treasure Guard' + (stats.bossSummoned === 1 ? '' : 's') + ' summoned on the world map (fight within 1 hour).'));
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
      getNET(req); // throws early if net not ready
      if (overlay) overlay.setSub('Opening Hunting Guild…');
      await ensureGuild(req);
      var cnt = readMergeCount();
      if (!cnt) throw new Error('Could not read the Hunting Guild — open it and retry');
      var max = Math.floor(cnt.stars / cnt.per);
      if (max < 1) throw new Error('Not enough stars to merge (' + cnt.stars + '/' + cnt.per + ')');
      if (!overlay) { alert('Hunting Guild: ' + max + ' merges available (overlay failed to build)'); return; }
      showConfig(overlay, Math.min(10, max), max, function (n, policy) {
        var progress = showProgress(overlay, n);
        runTurbo(req, { count: n, bossPolicy: policy, abort: progress.abort, onProgress: progress.update })
          .then(function (stats) { showSummary(overlay, stats, n); })
          .catch(function (e) { showError(overlay, e && e.message ? e.message : String(e)); });
      });
    } catch (err) {
      if (overlay) showError(overlay, err && err.message ? err.message : String(err));
      else { try { alert('Bulk Merge failed: ' + (err && err.message || err)); } catch (_) {} }
    }
  })();
})();
