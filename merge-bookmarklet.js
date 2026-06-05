// 2864tw.com — Hunting Guild Bulk Merge bookmarklet (testing build).
// Standalone. Drives the Hunting Guild "Merge" button in a loop and
// auto-handles whichever of the 4 treasure scenarios it rolls.
//
// What it does:
//   1. Opens the Hunting Guild (TreasureMapTaskNode) if not already up.
//   2. Reads the merge currency (stars) — each Merge costs 9.
//   3. On confirm, loops N times:
//        - emit the Merge button (onTreasureMapClick) — costs 9 stars,
//          rolls one random scenario.
//        - detect + handle the scenario:
//            donate (TreasureMapContributePanel): set 100 → onContributeClick
//                    → wait for Claim to unlock → onGetRewardClick.
//            wheel  (TreasureMapTurnTablePanel):  free spin (onTurnClick)
//                    → dismiss reward → close.
//            store  (TreasureMapShopPanel):        close (no buy).
//            boss   (TreasureMapChooseBossPanel):  per policy —
//                    Rare (bossType 2) / Common (bossType 0) / Skip+close.
//                    Summoning jumps to the world map → reopen guild via
//                    UIManager.OpenUI(UIDataInfo.TreasureMapTaskNode).
//        - dismiss any reward overlays + close the Info Board.
//   4. Light human-like jitter between actions. Abort at any time.
//
// Everything is driven through the game's own button handlers / panel
// methods (clickEvents.emit, onContributeClick, onGetRewardClick,
// onTurnClick, onSelectClick) — NO hand-crafted WS packets.
//
// Boss = Rare summons a Rare Treasure Guard onto the world map (200B
// coin each) that someone must fight within 1 hour or it expires.

(function () {
  'use strict';
  var cc = window.cc;

  // ─── Delay tuning (ms) ────────────────────────────────────────────────
  // Lower = faster. Functional waits (wheel spin, map jump, server
  // round-trips) keep safe minimums; everything else is trimmed close to
  // ~0.5s. [base, jitterSpread] → base + rand(0..spread).
  var T = {
    afterMerge:      [450, 250],   // merge emit → scenario panel appears
    detectPoll:      300,          // poll interval while waiting for a scenario
    storeClose:      [300, 200],
    wheelAnim:       [1400, 400],  // spin animation must finish before dismiss
    dismissGap:      [300, 200],
    donateClaimPoll: 350,          // poll interval for Claim unlock (server round-trip)
    donatePreClaim:  [300, 150],
    donatePostClaim: [600, 300],   // reward fly-in after claim
    donatePreClose:  [220, 150],
    bossSummon:      [1200, 400],  // summon + world-map jump
    ensureGuild:     [900, 350],
    cleanup:         [250, 150],
    postRead:        [300, 150],
    interCycle:      [400, 350],   // gap between merges
  };
  function jit(p) { return p[0] + Math.floor(Math.random() * p[1]); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ─── Game-side wiring ─────────────────────────────────────────────────
  function getRequire() {
    var req = window.__require;
    if (!req) throw new Error('Game not loaded — wait for the game to finish loading, then retry');
    return req;
  }
  function getUIMgr(req) {
    try { return req('UIManager').default.Instance(); }
    catch (e) { throw new Error('UIManager not ready — wait a moment and retry'); }
  }
  function getUIDataInfo(req) {
    try { return req('UIDataInfo').UIDataInfo; }
    catch (e) { throw new Error('UIDataInfo not ready — wait a moment and retry'); }
  }

  // ─── Scene-graph helpers ──────────────────────────────────────────────
  var GUILD_MERGE = 'UICanvas/PopLayer/TreasureMapTaskNode/CONTENT/TreasureMapTaskNode/bottom/button';
  function classOf(c) { return c.__classname__ || (c.constructor && c.constructor.name) || ''; }
  function mergeBtnNode() { return cc.find(GUILD_MERGE); }

  function findPanel(cls) {
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      var comps = n._components || [];
      for (var i = 0; i < comps.length; i++) { if (classOf(comps[i]) === cls) { found = n; return; } }
      var ch = n.children || []; for (var j = 0; j < ch.length; j++) walk(ch[j]);
    })(cc.find('UICanvas'));
    return found;
  }
  function findNodeByName(name, mustActive) {
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.name === name && (!mustActive || n.activeInHierarchy)) { found = n; return; }
      var ch = n.children || []; for (var j = 0; j < ch.length; j++) walk(ch[j]);
    })(cc.find('UICanvas'));
    return found;
  }
  function emitBtn(node) {
    if (!node) return false;
    try {
      var b = node.getComponent(cc.Button);
      if (b && b.clickEvents && b.clickEvents.length) { b.clickEvents.forEach(function (e) { e.emit([node]); }); return true; }
    } catch (e) {}
    return false;
  }
  function closePanelByClass(cls) {
    var panel = findPanel(cls);
    if (!panel) return 'gone';
    var frame = panel;
    while (frame && !/^UIFrame/.test(frame.name)) frame = frame.parent;
    if (frame) {
      var fc = (frame._components || []).find(function (c) { return typeof c.close === 'function'; });
      if (fc) { try { fc.close(); return 'closed'; } catch (e) { return 'err'; } }
    }
    return 'no-frame';
  }

  // Read "2061/9" → {stars:2061, per:9}
  function readMergeCount() {
    var m = mergeBtnNode();
    if (!m) return null;
    var s = null;
    (function fn(n) {
      if (s) return;
      var comps = n._components || [];
      for (var i = 0; i < comps.length; i++) { if (comps[i] instanceof cc.Label && /\d/.test(comps[i].string || '')) { s = comps[i].string; return; } }
      var ch = n.children || []; for (var j = 0; j < ch.length; j++) fn(ch[j]);
    })(m);
    if (!s) return null;
    var parts = String(s).split('/').map(function (x) { return parseInt(x, 10); });
    return { stars: parts[0] || 0, per: parts[1] || 9, raw: s };
  }

  function detectScenario() {
    var map = { TreasureMapContributePanel: 'donate', TreasureMapTurnTablePanel: 'wheel', TreasureMapShopPanel: 'store', TreasureMapChooseBossPanel: 'boss', TreasureMapBossRewardPanel: 'bossreward' };
    var found = 'none';
    (function walk(n) {
      if (!n || found !== 'none') return;
      var comps = n._components || [];
      for (var i = 0; i < comps.length; i++) { var cn = classOf(comps[i]); if (map[cn] && n.activeInHierarchy) { found = map[cn]; return; } }
      var ch = n.children || []; for (var j = 0; j < ch.length; j++) walk(ch[j]);
    })(cc.find('UICanvas'));
    return found;
  }

  async function dismissRewards() {
    for (var i = 0; i < 4; i++) {
      var did = false;
      (function walk(n) {
        if (!n) return;
        if (/prefabRewardCommonPanel/.test(n.name) && n.activeInHierarchy) {
          var c = (n._components || []).find(function (x) { return /RewardComponentNew/.test(classOf(x)); });
          if (c) { try { c.onMaskCloseClick(); did = true; } catch (e) {} }
        }
        (n.children || []).forEach(walk);
      })(cc.find('UICanvas'));
      var pop = cc.find('UICanvas/PopLayer');
      (pop ? pop.children : []).forEach(function (ch) {
        if (!ch.active || ch.name !== 'UIFrameNone') return;
        var has = false;
        (function s(n) { if (!n) return; if (/rewardOutPanel/.test(n.name)) has = true; (n.children || []).forEach(s); })(ch);
        if (has) { var fc = (ch._components || []).find(function (c) { return typeof c.close === 'function'; }); if (fc) { try { fc.close(); did = true; } catch (e) {} } }
      });
      if (!did) break;
      await delay(jit(T.dismissGap));
    }
  }

  async function ensureGuild(req) {
    for (var i = 0; i < 3; i++) {
      if (mergeBtnNode()) return true;
      try { getUIMgr(req).OpenUI(getUIDataInfo(req).TreasureMapTaskNode); } catch (e) {}
      await delay(jit(T.ensureGuild));
    }
    return !!mergeBtnNode();
  }

  // ─── Scenario handlers ────────────────────────────────────────────────
  async function handleStore() {
    await delay(jit(T.storeClose));
    return closePanelByClass('TreasureMapShopPanel');
  }

  async function handleWheel() {
    var spun = emitBtn(findNodeByName('drawone', true));
    await delay(jit(T.wheelAnim)); // wheel animation
    await dismissRewards();
    await delay(jit(T.dismissGap));
    closePanelByClass('TreasureMapTurnTablePanel');
    return spun;
  }

  async function handleDonate() {
    var panel = findPanel('TreasureMapContributePanel');
    if (!panel) return { err: 'gone' };
    var comp = (panel._components || []).find(function (c) { return classOf(c) === 'TreasureMapContributePanel'; });
    // set amount to a big number; numEditBoxChange clamps to the remaining need
    try { if (comp.numEditBox) { comp.numEditBox.string = '99999'; comp.numEditBoxChange(); } } catch (e) {}
    try { comp.onContributeClick(); } catch (e) { return { err: 'donate:' + (e && e.message) }; }
    // wait for the Claim (decomposeButton) to unlock
    var claimReady = false;
    for (var i = 0; i < 16; i++) {
      await delay(T.donateClaimPoll);
      var b = findNodeByName('decomposeButton', true);
      if (b) { var bc = b.getComponent(cc.Button); if (bc && bc.interactable) { claimReady = true; break; } }
    }
    var claimed = false;
    if (claimReady) {
      await delay(jit(T.donatePreClaim));
      var node = findNodeByName('decomposeButton', true);
      if (node) { var nb = node.getComponent(cc.Button); if (nb && nb.interactable) { claimed = emitBtn(node); } }
      await delay(jit(T.donatePostClaim));
      await dismissRewards();
    }
    await delay(jit(T.donatePreClose));
    closePanelByClass('TreasureMapContributePanel');
    return { claimReady: claimReady, claimed: claimed };
  }

  // policy: 'rare' (bossType 2) | 'common' (bossType 0) | 'skip'
  async function handleBoss(req, policy) {
    if (policy === 'skip') { closePanelByClass('TreasureMapChooseBossPanel'); await delay(jit(T.storeClose)); return 'skipped'; }
    var wantType = policy === 'common' ? 0 : 2;
    var panel = findPanel('TreasureMapChooseBossPanel');
    if (!panel) return 'panel-gone';
    var content = null;
    (function f(n) { if (!n || content) return; if (n.name === 'content' && n.parent && n.parent.name === 'view') { content = n; return; } (n.children || []).forEach(f); })(panel);
    var cell = (content ? content.children : []).find(function (c) {
      var comp = (c._components || []).find(function (x) { return typeof x.onSelectClick === 'function'; });
      return comp && comp._bossType === wantType;
    });
    if (!cell) return 'no-cell';
    var buyBtn = null;
    (function bf(n) { if (!n || buyBtn) return; if (n.name === 'buyButton' && n.activeInHierarchy) { buyBtn = n; return; } (n.children || []).forEach(bf); })(cell);
    var ok = emitBtn(buyBtn);
    await delay(jit(T.bossSummon)); // summon + map jump
    await ensureGuild(req); // summoning kicks us to the map — reopen the guild
    return ok ? 'summoned' : 'no-btn';
  }

  // ─── Main loop ────────────────────────────────────────────────────────
  async function runMerges(req, opts) {
    var stats = { done: 0, byScenario: { donate: 0, wheel: 0, store: 0, boss: 0, none: 0 }, bossSummoned: 0, startStars: null, endStars: null, lastError: null };
    for (var cyc = 1; cyc <= opts.count; cyc++) {
      if (opts.abort.aborted) { stats.aborted = true; break; }
      await ensureGuild(req);
      await dismissRewards();
      closePanelByClass('TreasureMapMsgListPanel');
      await delay(jit(T.cleanup));

      var pre = readMergeCount();
      if (!pre) { stats.lastError = 'Hunting Guild not open'; break; }
      if (cyc === 1) stats.startStars = pre.stars;
      if (pre.stars < pre.per) { stats.lastError = 'Out of stars (' + pre.stars + '/' + pre.per + ')'; break; }

      emitBtn(mergeBtnNode());
      await delay(jit(T.afterMerge));

      var scenario = 'none';
      for (var i = 0; i < 14; i++) { scenario = detectScenario(); if (scenario !== 'none') break; await delay(T.detectPoll); }

      try {
        if (scenario === 'store') await handleStore();
        else if (scenario === 'wheel') await handleWheel();
        else if (scenario === 'donate') await handleDonate();
        else if (scenario === 'boss') { var r = await handleBoss(req, opts.bossPolicy); if (r === 'summoned') stats.bossSummoned++; }
        else if (scenario === 'bossreward') { closePanelByClass('TreasureMapBossRewardPanel'); }
      } catch (e) { stats.lastError = 'handler ' + scenario + ': ' + (e && e.message); }

      var key = (scenario === 'bossreward') ? 'boss' : scenario;
      stats.byScenario[key] = (stats.byScenario[key] || 0) + 1;

      closePanelByClass('TreasureMapMsgListPanel');
      await delay(jit(T.postRead));

      var post = readMergeCount();
      if (post) stats.endStars = post.stars;
      stats.done++;
      if (opts.onProgress) opts.onProgress({ stats: stats, cycle: cyc, scenario: scenario, post: post });

      if (cyc !== opts.count) await delay(jit(T.interCycle));
    }
    return stats;
  }

  // ─── UI ───────────────────────────────────────────────────────────────
  // Every handled scenario reads as a success (green); only "no scenario" is grey.
  var SCEN_COLOR = { donate: '#3fb950', wheel: '#3fb950', store: '#3fb950', boss: '#3fb950', none: '#6e7681', bossreward: '#3fb950' };
  var SCEN_LABEL = { donate: 'Repair Equipment', wheel: 'Treasure Wheel', store: 'Treasure Store', boss: 'Treasure Guard', none: '(no scenario)', bossreward: 'Boss Reward' };

  function el(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function buildOverlay() {
    var bg = el('div', 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');
    var hdr = el('div', 'color:#79c0ff;font-size:15px;font-weight:600;text-align:center;', 'Hunting Guild — Bulk Merge');
    var sub = el('div', 'color:#8b949e;font-size:12px;margin:4px 0 10px;text-align:center;', 'Loading…');
    var body = el('div', 'flex:1;display:flex;flex-direction:column;min-height:0;');
    bg.appendChild(hdr); bg.appendChild(sub); bg.appendChild(body);
    document.body.appendChild(bg);
    return {
      root: bg, hdr: hdr, sub: sub, body: body,
      setHeader: function (t, c) { hdr.textContent = t; if (c) hdr.style.color = c; },
      setSub: function (t, c) { sub.textContent = t; if (c) sub.style.color = c; },
      remove: function () { try { document.body.removeChild(bg); } catch (_) {} },
    };
  }

  function showConfig(overlay, count, max, onStart) {
    clearChildren(overlay.body);
    overlay.setHeader('Hunting Guild — Bulk Merge', '#79c0ff');
    overlay.setSub('Each merge costs 9 stars · max ' + max + ' merges available', '#8b949e');

    var card = el('div', 'background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:14px;color:#e6edf3;font-size:13px;display:flex;flex-direction:column;gap:14px;');

    // count
    var cRow = el('div', 'display:flex;align-items:center;gap:10px;');
    cRow.appendChild(el('span', 'flex:0 0 auto;', 'Merges to run:'));
    var input = el('input', 'flex:1;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px;font-size:14px;');
    input.type = 'number'; input.min = '1'; input.max = String(max); input.value = String(Math.min(count, max));
    cRow.appendChild(input);
    card.appendChild(cRow);
    var maxBtn = el('button', 'align-self:flex-start;background:transparent;color:#79c0ff;border:1px solid #30363d;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;', 'Max (' + max + ')');
    maxBtn.addEventListener('click', function () { input.value = String(max); });
    card.appendChild(maxBtn);

    // boss policy
    card.appendChild(el('div', 'color:#8b949e;font-size:12px;margin-top:4px;', 'When a Treasure Guard rolls:'));
    var policy = 'rare';
    var polRow = el('div', 'display:flex;flex-direction:column;gap:6px;');
    [['rare', 'Summon Rare (200B coin, best reward — spawns a guard to fight)'], ['common', 'Summon Common (free — spawns a guard to fight)'], ['skip', 'Skip (close it, no summon)']].forEach(function (opt) {
      var lbl = el('label', 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;');
      var rb = el('input'); rb.type = 'radio'; rb.name = 'bosspol'; rb.value = opt[0]; if (opt[0] === 'rare') rb.checked = true;
      rb.addEventListener('change', function () { if (rb.checked) policy = opt[0]; });
      lbl.appendChild(rb); lbl.appendChild(el('span', '', opt[1]));
      polRow.appendChild(lbl);
    });
    card.appendChild(polRow);

    overlay.body.appendChild(card);

    var warn = el('div', 'color:#d29922;font-size:11px;line-height:1.4;margin-top:10px;', 'Note: Rare/Common summons spawn a guard on the world map that must be fought within 1 hour or it expires. Donate scenarios auto-spend your repair items.');
    overlay.body.appendChild(warn);

    var footer = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:auto;padding-top:12px;');
    var startBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Start merging');
    startBtn.addEventListener('click', function () {
      var n = parseInt(input.value, 10);
      if (!n || n < 1) return;
      if (n > max) n = max;
      onStart(n, policy);
    });
    var closeBtn = el('button', 'padding:12px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;', 'Close');
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    footer.appendChild(startBtn); footer.appendChild(closeBtn);
    overlay.body.appendChild(footer);
  }

  function showProgress(overlay, total) {
    clearChildren(overlay.body);
    overlay.setHeader('Merging…', '#d29922');
    overlay.setSub('0 / ' + total + ' merges', '#8b949e');

    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;margin-bottom:10px;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .2s;');
    barWrap.appendChild(bar);
    overlay.body.appendChild(barWrap);

    var counts = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:11px;');
    overlay.body.appendChild(counts);

    var log = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6edf3;font-size:11px;font-family:monospace;');
    overlay.body.appendChild(log);

    var abortBtn = el('button', 'padding:12px;background:transparent;color:#f85149;border:1px solid #f85149;border-radius:6px;font-size:13px;margin-top:10px;', 'Stop after current merge');
    overlay.body.appendChild(abortBtn);
    var abort = { aborted: false };
    abortBtn.addEventListener('click', function () { abort.aborted = true; abortBtn.disabled = true; abortBtn.textContent = 'Stopping…'; });

    return {
      abort: abort,
      update: function (info) {
        var pct = Math.round((info.cycle / total) * 100);
        bar.style.width = pct + '%';
        overlay.setSub(info.cycle + ' / ' + total + ' merges' + (info.stats.bossSummoned ? ' · ' + info.stats.bossSummoned + ' guards summoned' : ''), '#8b949e');
        clearChildren(counts);
        Object.keys(SCEN_LABEL).forEach(function (k) {
          if (k === 'bossreward' || k === 'none') return;
          var v = info.stats.byScenario[k] || 0;
          if (!v) return;
          counts.appendChild(el('span', 'padding:2px 7px;border-radius:9px;background:' + (SCEN_COLOR[k] || '#30363d') + ';color:#0d1117;font-weight:600;', SCEN_LABEL[k] + ' ' + v));
        });
        var line = el('div', 'color:' + (SCEN_COLOR[info.scenario] || '#8b949e') + ';', '#' + info.cycle + ' → ' + (SCEN_LABEL[info.scenario] || info.scenario) + (info.post ? '  (' + info.post.raw + ')' : ''));
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
      },
    };
  }

  function showSummary(overlay, stats, total) {
    clearChildren(overlay.body);
    var stopped = stats.lastError || stats.aborted;
    overlay.setHeader(stats.aborted ? 'Stopped' : stats.lastError ? 'Stopped early' : 'Done', stopped ? '#d29922' : '#3fb950');
    overlay.setSub(stats.done + ' / ' + total + ' merges completed', '#8b949e');

    var body = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;color:#e6edf3;font-size:13px;');
    if (stats.lastError) body.appendChild(el('div', 'color:#f85149;margin-bottom:10px;', 'Stopped: ' + stats.lastError));

    var spent = (stats.startStars != null && stats.endStars != null) ? (stats.startStars - stats.endStars) : (stats.done * 9);
    body.appendChild(el('div', 'margin-bottom:8px;', 'Stars spent: ' + spent + (stats.startStars != null ? '  (' + stats.startStars + ' → ' + stats.endStars + ')' : '')));

    body.appendChild(el('div', 'font-weight:600;color:#79c0ff;margin:8px 0 4px;', 'Scenarios handled:'));
    Object.keys(SCEN_LABEL).forEach(function (k) {
      if (k === 'bossreward' || k === 'none') return;
      var v = stats.byScenario[k] || 0;
      if (!v) return;
      var row = el('div', 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #21262d;');
      row.appendChild(el('span', 'color:' + (SCEN_COLOR[k] || '#e6edf3') + ';', SCEN_LABEL[k]));
      row.appendChild(el('span', '', String(v)));
      body.appendChild(row);
    });

    if (stats.bossSummoned) {
      body.appendChild(el('div', 'margin-top:10px;color:#3fb950;font-weight:600;', '⚔ ' + stats.bossSummoned + ' Treasure Guard' + (stats.bossSummoned === 1 ? '' : 's') + ' summoned on the world map (fight within 1 hour).'));
    }
    overlay.body.appendChild(body);

    var doneBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;margin-top:10px;', 'Close');
    doneBtn.addEventListener('click', function () { overlay.remove(); });
    overlay.body.appendChild(doneBtn);
  }

  function showError(overlay, message) {
    clearChildren(overlay.body);
    overlay.setHeader('Failed', '#f85149');
    overlay.setSub(message, '#f85149');
    var btn = el('button', 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;margin-top:10px;align-self:center;', 'Close');
    btn.addEventListener('click', function () { overlay.remove(); });
    overlay.body.appendChild(btn);
  }

  // ─── Entry ────────────────────────────────────────────────────────────
  var overlay = null;
  try { overlay = buildOverlay(); } catch (_) {}

  (async function main() {
    try {
      var req = getRequire();
      if (overlay) overlay.setSub('Opening Hunting Guild…');
      await ensureGuild(req);
      var cnt = readMergeCount();
      if (!cnt) throw new Error('Could not read the Merge button — open the Hunting Guild and retry');
      var max = Math.floor(cnt.stars / cnt.per);
      if (max < 1) throw new Error('Not enough stars to merge (' + cnt.stars + '/' + cnt.per + ')');
      if (!overlay) { alert('Hunting Guild merge: ' + max + ' merges available. (overlay failed to build)'); return; }
      showConfig(overlay, Math.min(10, max), max, function (n, policy) {
        var progress = showProgress(overlay, n);
        runMerges(req, {
          count: n, bossPolicy: policy, abort: progress.abort,
          onProgress: progress.update,
        }).then(function (stats) {
          showSummary(overlay, stats, n);
        }).catch(function (e) {
          showError(overlay, e && e.message ? e.message : String(e));
        });
      });
    } catch (err) {
      if (overlay) showError(overlay, err && err.message ? err.message : String(err));
      else { try { alert('Bulk Merge failed: ' + (err && err.message || err)); } catch (_) {} }
    }
  })();
})();
