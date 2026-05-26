// 2864tw.com — Skill Dismantle bookmarklet (testing build).
// Standalone. Does NOT do full inventory extraction (that lives in
// all-bookmarklet.js). Drop-in for testing the dismantle UI + WS flow
// before we fold this into the prod bookmarklet.
//
// What it does:
//   1. Briefly opens BagPanel to capture the UserData reference (same
//      patch trick the prod bookmarklet uses) and then closes it.
//   2. Enumerates the player's hero-skill bag items by skill family
//      (type=42 ITEM rows).
//   3. Renders an overlay listing every owned skill family with a
//      checkbox + projected chip yield.
//   4. On confirm, fires the WS sequence:
//        - sendPB(4189, levelDownHeroSkill) per Lv>1 entry — turns into
//          3^(N-1) Lv 1 copies of the same skill.
//        - send(886, DECOMPOSE_HERO_SKILL) for Lv 1 — turns into
//          decomposition[1] chips per item.
//   5. 400-800ms jitter between calls. Aborts on any non-zero status.
//   6. After completion, re-enumerates the bag and shows the deltas.
//
// Protocol payloads (verified live):
//   Lv 1 -> chips:  NET.send(886, {itemId, num}, this, cb)            (JSON)
//   Lv N -> Lv 1:   NET.sendPB(4189, {header:{}, levelDownHeroSkill: {itemId, num}}, this, cb)  (protobuf)

(function () {
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

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Mirror of the prod bookmarklet's openPanel — opens the bag, waits for
  // mount, falls back to clicking the bag icon. We only need the BagPanel
  // briefly to trigger UpdateView -> getItemListByBagType -> capture
  // UserData. Then we close it.
  async function openBagPanel(req) {
    var UIMgr = getUIMgr(req);
    var UIDataInfo = getUIDataInfo(req);
    var cc = window.cc;
    var bagPath = 'UICanvas/PopLayer/UIFrameScreen/CONTENT/BagPanel';
    try { UIMgr.OpenUI(UIDataInfo.BagPanel); } catch (e) {}
    var t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      var node = cc.find(bagPath);
      if (node && node.active) return node;
      await delay(80);
    }
    // Fallback — tap the bag icon programmatically
    var btn = cc.find('UICanvas/MainUIWrapper/NMainUI/RightBottom/btnBag');
    if (btn) {
      try { btn.getComponent(cc.Button).clickEvents.forEach(function (e) { e.emit([btn]); }); } catch (_) {}
    }
    var t1 = Date.now();
    while (Date.now() - t1 < 5000) {
      var n2 = cc.find(bagPath);
      if (n2 && n2.active) return n2;
      await delay(80);
    }
    throw new Error('BagPanel did not mount within 10s');
  }

  async function closeBagPanel(req) {
    var UIMgr = getUIMgr(req);
    var UIDataInfo = getUIDataInfo(req);
    var cc = window.cc;
    try { UIMgr.CloseUI(UIDataInfo.BagPanel); } catch (e) {}
    var t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      var n = cc.find('UICanvas/PopLayer/UIFrameScreen/CONTENT/BagPanel');
      if (!n || !n.active) return;
      await delay(80);
    }
  }

  // Patch UserData.prototype.getItemListByBagType once so we capture the
  // live UserData reference into window.__capturedUD when the bag refreshes.
  function patchUserData(req) {
    var UD = req('UserData').default;
    if (UD.prototype.__udPatched) return;
    var orig = UD.prototype.getItemListByBagType;
    UD.prototype.getItemListByBagType = function (t) {
      window.__capturedUD = this;
      return orig.call(this, t);
    };
    UD.prototype.__udPatched = true;
  }

  async function captureUserData(req) {
    patchUserData(req);
    if (window.__capturedUD) return window.__capturedUD;
    var bagNode = await openBagPanel(req);
    var bp = bagNode.getComponent('BagPanel');
    if (bp && bp.UpdateView) { try { bp.UpdateView(); } catch (_) {} }
    await delay(220);
    await closeBagPanel(req);
    if (!window.__capturedUD) throw new Error('UserData reference not captured (UpdateView did not fire)');
    return window.__capturedUD;
  }

  // ─── Family enumeration ───────────────────────────────────────────────
  // Group by skill NAME so Rare + Normal of the same skill (e.g. Army HP
  // skillId 20104 + 21104) collapse into one row. Each family carries a
  // `variants` map keyed by quality with that tier's skillId + decomp +
  // per-level inventory. Dismantle plans iterate variants independently
  // since each tier has its own item IDs and chip yields.
  //
  // Family shape:
  // {
  //   familyKey: <string>,       // grouping key (name)
  //   name: <string>,            // localized display
  //   heroBound: <bool>,         // true if any variant is hero-exclusive
  //   skillTypes: [<num>...],    // distinct skill_type values across variants
  //   maxQuality: <num>,         // highest tier owned (drives sorting + filtering)
  //   variants: {
  //     [quality]: {
  //       skillId, decompChipId, decompPerLv1,
  //       levels: { [lvl]: { itemId, amount } },
  //     }
  //   }
  // }
  // Skill IDs we never want a player to dismantle even if the bag has them.
  // Currently just March Size (20116 Normal, 21116 Rare) — the table also
  // calls these "March size" but losing them is irrecoverable + nobody
  // wants to chip them.
  var SKILL_BLACKLIST = { 20116: true, 21116: true };

  function enumerateFamilies(req, ud) {
    var TABLE = req('TableManager').TABLE;
    var LOCAL = req('LocalManager').LOCAL;
    var list = ud.getItemListByBagType(4) || [];
    var groups = {};
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it._itemId || !it._amount) continue;
      var row;
      try { row = TABLE.getTableDataById('item', String(it._itemId)); } catch (e) { row = null; }
      if (!row || row.type !== 42) continue;
      var skillId = Number(row.para1);
      if (!skillId) continue;
      if (SKILL_BLACKLIST[skillId]) continue;
      var level = Number(row.level) || 1;
      var skillRow;
      try { skillRow = TABLE.getTableDataById('hero_skill', String(skillId)); } catch (e) { skillRow = null; }
      if (!skillRow) continue;
      // Skip skills that have no decomposition rule (exclusive / non-decomposable)
      if (!skillRow.decomposition || skillRow.decomposition === '') continue;
      var decompParts = String(skillRow.decomposition).split('|');
      var chipId = Number(decompParts[0]);
      var perLv1 = Number(decompParts[1]) || 1;
      var rawName;
      try { rawName = LOCAL.getText(skillRow.name) || skillRow.name; } catch (e) { rawName = skillRow.name; }
      var name = displayName(rawName);
      var quality = Number(skillRow.quality) || 1;
      var skillType = Number(skillRow.skill_type) || 0;
      var heroBound = (skillType === 3) || (Number(skillRow.hero_id) > 0);
      // Use skill_type + heroBound as a soft disambiguator so two skills
      // that happen to share an English name don't accidentally merge.
      var familyKey = name + '|' + skillType + '|' + (heroBound ? '1' : '0');

      if (!groups[familyKey]) {
        groups[familyKey] = {
          familyKey: familyKey,
          name: name,
          heroBound: heroBound,
          skillTypes: [skillType],
          maxQuality: quality,
          variants: {},
        };
      } else {
        if (groups[familyKey].skillTypes.indexOf(skillType) < 0) groups[familyKey].skillTypes.push(skillType);
        if (quality > groups[familyKey].maxQuality) groups[familyKey].maxQuality = quality;
        if (heroBound) groups[familyKey].heroBound = true;
      }
      if (!groups[familyKey].variants[quality]) {
        groups[familyKey].variants[quality] = {
          skillId: skillId, quality: quality,
          decompChipId: chipId, decompPerLv1: perLv1,
          levels: {},
        };
      }
      groups[familyKey].variants[quality].levels[level] = { itemId: Number(it._itemId), amount: Number(it._amount) };
    }
    return Object.values(groups);
  }

  // Lookup the Lv 1 itemId for a given skill family (needed when player
  // has only Lv>1 entries — the level-down step creates Lv 1 stacks we
  // then need to chip-dismantle).
  function lookupLv1ItemId(req, skillId) {
    try {
      var TABLE = req('TableManager').TABLE;
      var rows = TABLE.getTableByKey('item', 'para1', skillId, 'level', 1, 'type', 42);
      if (rows && rows.length) return Number(rows[0].id);
    } catch (e) {}
    return null;
  }

  // Build a dismantle plan for one family. Each variant (quality tier) is
  // resolved independently — its level-downs roll into its own Lv 1 stack,
  // and its chip step uses its own itemId + per-Lv1 decomp ratio. Steps are
  // emitted variant-by-variant in descending quality order so the dismantle
  // log shows Rare progress before Normal.
  function buildPlan(req, family) {
    var qualities = Object.keys(family.variants).map(Number).sort(function (a, b) { return b - a; });
    if (!qualities.length) return null;
    var steps = [];
    var totalChips = 0;

    for (var q = 0; q < qualities.length; q++) {
      var quality = qualities[q];
      var variant = family.variants[quality];
      var lvKeys = Object.keys(variant.levels).map(Number).sort(function (a, b) { return a - b; });
      if (!lvKeys.length) continue;
      var lv1Existing = (variant.levels[1] && variant.levels[1].amount) || 0;
      var lv1ItemId = (variant.levels[1] && variant.levels[1].itemId) || lookupLv1ItemId(req, variant.skillId);
      var totalLv1Equiv = lv1Existing;

      for (var i = 0; i < lvKeys.length; i++) {
        var lvl = lvKeys[i];
        if (lvl === 1) continue;
        var entry = variant.levels[lvl];
        if (!entry || !entry.amount) continue;
        var yieldLv1 = entry.amount * Math.pow(3, lvl - 1);
        steps.push({
          kind: 'levelDown', level: lvl, quality: quality,
          itemId: entry.itemId, num: entry.amount,
          yieldsLv1: yieldLv1,
        });
        totalLv1Equiv += yieldLv1;
      }

      if (totalLv1Equiv > 0) {
        if (!lv1ItemId) continue; // can't chip without Lv 1 itemId — skip this tier
        steps.push({
          kind: 'chip', quality: quality,
          itemId: lv1ItemId, num: totalLv1Equiv,
          chipsYielded: totalLv1Equiv * variant.decompPerLv1,
        });
        totalChips += totalLv1Equiv * variant.decompPerLv1;
      }
    }

    if (!steps.length) return null;
    return { family: family, steps: steps, totalChips: totalChips };
  }

  // ─── WS execution ─────────────────────────────────────────────────────
  function sendStep(NET, step) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(ok, info) { if (!settled) { settled = true; resolve({ ok: ok, info: info }); } }
      // Hard timeout so a dropped response doesn't hang the chain forever
      setTimeout(function () { done(false, { reason: 'timeout' }); }, 8000);
      try {
        if (step.kind === 'chip') {
          NET.send(886, { itemId: step.itemId, num: step.num }, null, function (resp) {
            done(!!(resp && resp.s === 0), { resp: resp });
          });
        } else if (step.kind === 'levelDown') {
          NET.sendPB(4189, { header: {}, levelDownHeroSkill: { itemId: step.itemId, num: step.num } }, null, function (resp) {
            var ack = resp && resp.pbAck;
            done(!!(ack && ack.header && ack.header.s === 0), { resp: resp });
          });
        } else {
          done(false, { reason: 'unknown-step' });
        }
      } catch (e) { done(false, { reason: 'throw', message: e && e.message }); }
    });
  }

  function jitterMs() {
    // 400-800ms uniform. Anti-cheat prefers human-like cadence.
    return 400 + Math.floor(Math.random() * 400);
  }

  async function executePlans(req, plans, opts) {
    var NET = req('NetMgr').NET;
    var totalSteps = 0;
    for (var i = 0; i < plans.length; i++) totalSteps += plans[i].steps.length;
    var done = 0, errored = null;

    for (var f = 0; f < plans.length; f++) {
      var plan = plans[f];
      if (opts.abort && opts.abort.aborted) return { aborted: true, done: done, total: totalSteps };
      for (var s = 0; s < plan.steps.length; s++) {
        if (opts.abort && opts.abort.aborted) return { aborted: true, done: done, total: totalSteps };
        var step = plan.steps[s];
        if (opts.onStep) opts.onStep({ family: plan.family, step: step, doneSoFar: done, total: totalSteps });
        var res = await sendStep(NET, step);
        done++;
        if (opts.onStepResult) opts.onStepResult({ family: plan.family, step: step, ok: res.ok, info: res.info, doneSoFar: done, total: totalSteps });
        if (!res.ok) {
          errored = { family: plan.family, step: step, info: res.info };
          return { errored: errored, done: done, total: totalSteps };
        }
        // Gap before the next call so the server has time to reflect state
        // and we don't burst the socket. Skip jitter after the very last step.
        if (!(f === plans.length - 1 && s === plan.steps.length - 1)) {
          await delay(jitterMs());
        }
      }
    }
    return { done: done, total: totalSteps };
  }

  // ─── UI ────────────────────────────────────────────────────────────────
  var QUALITY_LABEL = { 1: 'Normal', 2: 'Rare', 3: 'Epic', 4: 'Legendary', 5: 'Mythic' };
  var QUALITY_COLOR = { 1: '#8b949e', 2: '#79c0ff', 3: '#bc8cff', 4: '#d29922', 5: '#ff7b72' };

  // The localized table calls Army/Navy/Air Force defensive skills
  // "Protection", but every player in chat calls them "Damage Decrease".
  // Display only — the underlying skill IDs stay the same.
  function displayName(name) {
    if (!name) return name;
    return name.replace(/\bProtection\b/gi, 'Damage Decrease');
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildOverlay() {
    var bg = el('div', 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');
    var hdr = el('div', 'color:#79c0ff;font-size:15px;font-weight:600;text-align:center;', 'Skill Dismantle');
    var sub = el('div', 'color:#8b949e;font-size:12px;margin:4px 0 10px;text-align:center;', 'Loading bag…');
    bg.appendChild(hdr);
    bg.appendChild(sub);
    var body = el('div', 'flex:1;display:flex;flex-direction:column;min-height:0;');
    bg.appendChild(body);
    document.body.appendChild(bg);
    return {
      root: bg, hdr: hdr, sub: sub, body: body,
      setHeader: function (t, color) { hdr.textContent = t; if (color) hdr.style.color = color; },
      setSub: function (t, color) { sub.textContent = t; if (color) sub.style.color = color; },
      remove: function () { try { document.body.removeChild(bg); } catch (_) {} },
    };
  }

  // Per-variant level breakdown ("Rare: Lv1×1 · Normal: Lv2×3 Lv4×1"). Skips
  // variants with empty inventory + collapses to "Lv N×X" when only one tier.
  function fmtLevels(family) {
    var qs = Object.keys(family.variants).map(Number).sort(function (a, b) { return b - a; });
    var sections = [];
    for (var qi = 0; qi < qs.length; qi++) {
      var q = qs[qi];
      var v = family.variants[q];
      var keys = Object.keys(v.levels).map(Number).sort(function (a, b) { return a - b; });
      if (!keys.length) continue;
      var inner = [];
      for (var i = 0; i < keys.length; i++) {
        inner.push('Lv ' + keys[i] + '×' + v.levels[keys[i]].amount);
      }
      var prefix = qs.length > 1 ? (QUALITY_LABEL[q] || ('Q' + q)) + ': ' : '';
      sections.push(prefix + inner.join(' '));
    }
    return sections.join(' · ');
  }

  function totalItemsInFamily(family) {
    var n = 0;
    var qs = Object.keys(family.variants);
    for (var qi = 0; qi < qs.length; qi++) {
      var v = family.variants[qs[qi]];
      var keys = Object.keys(v.levels);
      for (var i = 0; i < keys.length; i++) n += v.levels[keys[i]].amount;
    }
    return n;
  }

  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function renderFamilyList(req, container, families, opts) {
    clearChildren(container);
    // Defaults Tex requested: show Rare + Normal in one combined view by
    // default; hide hero-specific (awakening etc.) skills by default.
    var state = { rareOnly: false, showHeroBound: false, selected: {} };

    function isVisible(f) {
      if (state.rareOnly && f.maxQuality < 2) return false;
      if (!state.showHeroBound && f.heroBound) return false;
      return true;
    }

    // Filter toggle row
    var toggleRow = el('div', 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px;color:#e6edf3;font-size:12px;');

    var rareOnlyCb = el('input');
    rareOnlyCb.type = 'checkbox';
    var rareLbl = el('label', 'display:flex;align-items:center;gap:6px;cursor:pointer;');
    rareLbl.appendChild(rareOnlyCb);
    rareLbl.appendChild(el('span', '', 'Rare only'));
    rareOnlyCb.addEventListener('change', function () { state.rareOnly = rareOnlyCb.checked; render(); });
    toggleRow.appendChild(rareLbl);

    var heroCb = el('input');
    heroCb.type = 'checkbox';
    var heroLbl = el('label', 'display:flex;align-items:center;gap:6px;cursor:pointer;');
    heroLbl.appendChild(heroCb);
    heroLbl.appendChild(el('span', '', 'Show hero-specific skills'));
    heroCb.addEventListener('change', function () { state.showHeroBound = heroCb.checked; render(); });
    toggleRow.appendChild(heroLbl);

    var selectAllBtn = el('button', 'background:transparent;color:#79c0ff;border:1px solid #30363d;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;', 'Select all visible');
    selectAllBtn.addEventListener('click', function () {
      var visible = families.filter(isVisible);
      var allSelected = visible.every(function (f) { return state.selected[f.familyKey]; });
      visible.forEach(function (f) { state.selected[f.familyKey] = !allSelected; });
      render();
    });
    toggleRow.appendChild(selectAllBtn);

    var clearBtn = el('button', 'background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;', 'Clear');
    clearBtn.addEventListener('click', function () { state.selected = {}; render(); });
    toggleRow.appendChild(clearBtn);

    container.appendChild(toggleRow);

    // Scrollable family list
    var list = el('div', 'flex:1;overflow-y:auto;border:1px solid #30363d;border-radius:6px;background:#0d1117;');
    container.appendChild(list);

    // Footer with run button + summary
    var footer = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:10px;');
    var summaryText = el('div', 'color:#8b949e;font-size:12px;text-align:center;', '');
    var runBtn = el('button', 'padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Dismantle selected');
    runBtn.disabled = true;
    runBtn.style.opacity = '.5';
    var closeBtn = el('button', 'padding:12px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;', 'Close');
    closeBtn.addEventListener('click', function () { opts.onClose(); });

    footer.appendChild(summaryText);
    footer.appendChild(runBtn);
    footer.appendChild(closeBtn);
    container.appendChild(footer);

    function selectedFamilies() {
      return families.filter(function (f) { return state.selected[f.familyKey]; });
    }

    function plansForSelected() {
      var plans = [];
      var sel = selectedFamilies();
      for (var i = 0; i < sel.length; i++) {
        var p = buildPlan(req, sel[i]);
        if (p && p.steps.length) plans.push(p);
      }
      return plans;
    }

    function refreshSummary() {
      var plans = plansForSelected();
      var totalChips = plans.reduce(function (s, p) { return s + p.totalChips; }, 0);
      var totalSteps = plans.reduce(function (s, p) { return s + p.steps.length; }, 0);
      if (plans.length === 0) {
        summaryText.textContent = '';
        runBtn.disabled = true;
        runBtn.style.opacity = '.5';
        runBtn.textContent = 'Dismantle selected';
      } else {
        summaryText.textContent = plans.length + ' famil' + (plans.length === 1 ? 'y' : 'ies') + ' · ' + totalSteps + ' WS call' + (totalSteps === 1 ? '' : 's') + ' · +' + totalChips + ' chip' + (totalChips === 1 ? '' : 's');
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.textContent = 'Dismantle selected (' + plans.length + ')';
      }
    }

    runBtn.addEventListener('click', function () {
      var plans = plansForSelected();
      if (!plans.length) return;
      opts.onRun(plans);
    });

    function render() {
      clearChildren(list);
      var visible = families.filter(isVisible);
      // Sort: highest max quality first, then by name
      visible.sort(function (a, b) {
        if (a.maxQuality !== b.maxQuality) return b.maxQuality - a.maxQuality;
        return (a.name || '').localeCompare(b.name || '');
      });
      if (!visible.length) {
        list.appendChild(el('div', 'color:#8b949e;font-size:12px;padding:12px;text-align:center;', 'No dismantleable skill items in bag.'));
        refreshSummary();
        return;
      }
      for (var i = 0; i < visible.length; i++) {
        (function (family) {
          var plan = buildPlan(req, family);
          var row = el('div', 'display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #21262d;cursor:pointer;');
          var cb = el('input');
          cb.type = 'checkbox';
          cb.checked = !!state.selected[family.familyKey];
          cb.style.flex = '0 0 auto';
          cb.style.transform = 'scale(1.2)';
          cb.addEventListener('click', function (e) { e.stopPropagation(); });
          cb.addEventListener('change', function () {
            state.selected[family.familyKey] = cb.checked;
            refreshSummary();
          });
          row.appendChild(cb);
          row.addEventListener('click', function () {
            state.selected[family.familyKey] = !state.selected[family.familyKey];
            cb.checked = !!state.selected[family.familyKey];
            refreshSummary();
          });

          var info = el('div', 'flex:1;min-width:0;');
          var line1 = el('div', 'display:flex;align-items:center;gap:6px;font-size:13px;color:#e6edf3;flex-wrap:wrap;');
          // Tier pills — one per owned variant, highest quality first
          var qs = Object.keys(family.variants).map(Number).sort(function (a, b) { return b - a; });
          for (var qi = 0; qi < qs.length; qi++) {
            var q = qs[qi];
            line1.appendChild(el('span', 'display:inline-block;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:600;background:' + (QUALITY_COLOR[q] || '#30363d') + ';color:#0d1117;', QUALITY_LABEL[q] || ('Q' + q)));
          }
          line1.appendChild(el('span', 'font-weight:600;', family.name));
          info.appendChild(line1);

          var line2 = el('div', 'color:#8b949e;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', fmtLevels(family));
          info.appendChild(line2);
          row.appendChild(info);

          var yieldBox = el('div', 'color:' + (plan && plan.totalChips > 0 ? '#3fb950' : '#6e7681') + ';font-size:12px;font-weight:600;text-align:right;flex:0 0 auto;', plan ? ('+' + plan.totalChips + ' chip' + (plan.totalChips === 1 ? '' : 's')) : '—');
          row.appendChild(yieldBox);

          list.appendChild(row);
        })(visible[i]);
      }
      refreshSummary();
    }

    render();
    return { state: state, refresh: render };
  }

  function showConfirm(overlay, plans, onProceed, onCancel) {
    // Build inline confirm — replaces overlay body
    clearChildren(overlay.body);
    overlay.setHeader('Confirm dismantle', '#d29922');
    overlay.setSub('Review and tap Proceed to fire WS calls', '#8b949e');

    var summary = el('div', 'flex:1;overflow-y:auto;border:1px solid #30363d;border-radius:6px;background:#0d1117;padding:10px;color:#e6edf3;font-size:12px;');
    var totalChips = 0;
    var totalSteps = 0;
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      totalChips += p.totalChips;
      totalSteps += p.steps.length;
      var famRow = el('div', 'margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #21262d;');
      var head = el('div', 'display:flex;justify-content:space-between;font-weight:600;');
      var qs = Object.keys(p.family.variants).map(Number).sort(function (a, b) { return b - a; });
      var tierLabel = qs.map(function (q) { return QUALITY_LABEL[q] || ('Q' + q); }).join(' + ');
      head.appendChild(el('span', '', p.family.name + ' (' + tierLabel + ')'));
      head.appendChild(el('span', 'color:#3fb950;', '+' + p.totalChips + ' chip' + (p.totalChips === 1 ? '' : 's')));
      famRow.appendChild(head);
      for (var s = 0; s < p.steps.length; s++) {
        var step = p.steps[s];
        var qPrefix = (step.quality && qs.length > 1) ? ((QUALITY_LABEL[step.quality] || ('Q' + step.quality)) + ' ') : '';
        var stepLine;
        if (step.kind === 'levelDown') {
          stepLine = el('div', 'color:#8b949e;font-size:11px;padding-left:8px;', '· ' + qPrefix + 'Lv ' + step.level + ' × ' + step.num + ' → ' + step.yieldsLv1 + ' Lv 1');
        } else {
          stepLine = el('div', 'color:#8b949e;font-size:11px;padding-left:8px;', '· ' + qPrefix + 'Lv 1 × ' + step.num + ' → ' + step.chipsYielded + ' chips');
        }
        famRow.appendChild(stepLine);
      }
      summary.appendChild(famRow);
    }
    overlay.body.appendChild(summary);

    var totalsLine = el('div', 'color:#79c0ff;font-size:12px;text-align:center;margin:8px 0 6px;', 'Total: ' + totalSteps + ' WS call' + (totalSteps === 1 ? '' : 's') + ' · +' + totalChips + ' chip' + (totalChips === 1 ? '' : 's'));
    overlay.body.appendChild(totalsLine);

    var row = el('div', 'display:flex;gap:8px;');
    var proceed = el('button', 'flex:1;padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Proceed');
    var cancel = el('button', 'padding:14px 18px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;', 'Cancel');
    proceed.addEventListener('click', onProceed);
    cancel.addEventListener('click', onCancel);
    row.appendChild(proceed);
    row.appendChild(cancel);
    overlay.body.appendChild(row);
  }

  function showProgress(overlay, totalSteps) {
    clearChildren(overlay.body);
    overlay.setHeader('Dismantling…', '#d29922');
    overlay.setSub('0 / ' + totalSteps + ' calls', '#8b949e');

    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;margin-bottom:10px;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .2s;');
    barWrap.appendChild(bar);
    overlay.body.appendChild(barWrap);

    var current = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6edf3;font-size:11px;font-family:monospace;');
    overlay.body.appendChild(current);

    var abortBtn = el('button', 'padding:12px;background:transparent;color:#f85149;border:1px solid #f85149;border-radius:6px;font-size:13px;margin-top:10px;', 'Abort after current call');
    overlay.body.appendChild(abortBtn);

    var abort = { aborted: false };
    abortBtn.addEventListener('click', function () {
      abort.aborted = true;
      abortBtn.disabled = true;
      abortBtn.textContent = 'Aborting after current call…';
    });

    return {
      abort: abort,
      onStep: function (info) {
        var qLabel = info.step.quality ? (QUALITY_LABEL[info.step.quality] || ('Q' + info.step.quality)) + ' ' : '';
        var desc = info.step.kind === 'chip'
          ? 'chip ' + qLabel + 'Lv 1 ×' + info.step.num
          : 'levelDown ' + qLabel + 'Lv ' + info.step.level + ' ×' + info.step.num;
        var line = el('div', 'color:#8b949e;', info.family.name + ' · ' + desc);
        current.appendChild(line);
        current.scrollTop = current.scrollHeight;
      },
      onResult: function (info) {
        var pct = Math.round((info.doneSoFar / info.total) * 100);
        bar.style.width = pct + '%';
        overlay.setSub(info.doneSoFar + ' / ' + info.total + ' calls' + (info.ok ? '' : ' — last failed'), info.ok ? '#8b949e' : '#f85149');
        if (!info.ok) {
          var line = el('div', 'color:#f85149;', '  → FAILED: ' + JSON.stringify(info.info && info.info.resp && info.info.resp.s));
          current.appendChild(line);
        }
      },
    };
  }

  function showSummary(overlay, req, beforeFamilies, runResult, plans) {
    clearChildren(overlay.body);
    var headerText = runResult.errored ? 'Stopped on error' : runResult.aborted ? 'Aborted' : 'Done';
    var headerColor = runResult.errored ? '#f85149' : runResult.aborted ? '#d29922' : '#3fb950';
    overlay.setHeader(headerText, headerColor);
    overlay.setSub(runResult.done + ' of ' + runResult.total + ' calls completed', '#8b949e');

    // Re-enumerate to compute deltas
    var ud = window.__capturedUD;
    var afterFamilies = enumerateFamilies(req, ud);
    var beforeByKey = {}; beforeFamilies.forEach(function (f) { beforeByKey[f.familyKey] = f; });
    var afterByKey = {}; afterFamilies.forEach(function (f) { afterByKey[f.familyKey] = f; });

    // Find chip count delta — chip ID is on family.decompChipId (typically 2550001)
    var itemList = ud.getItemListByBagType(1) || [];
    var chipCounts = {};
    for (var i = 0; i < itemList.length; i++) {
      var it = itemList[i];
      if (!it || !it._itemId) continue;
      chipCounts[it._itemId] = it._amount;
    }

    var body = el('div', 'flex:1;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6edf3;font-size:12px;');

    if (runResult.errored && runResult.errored.step) {
      var errBlock = el('div', 'margin-bottom:10px;padding:8px;background:#3f1818;border:1px solid #f85149;border-radius:4px;color:#ff7b72;font-size:11px;');
      errBlock.appendChild(el('div', 'font-weight:600;margin-bottom:4px;', 'Error on:'));
      errBlock.appendChild(el('div', '', runResult.errored.family.name + ' · ' + (runResult.errored.step.kind === 'chip' ? 'chip ×' + runResult.errored.step.num : 'levelDown Lv ' + runResult.errored.step.level + ' ×' + runResult.errored.step.num)));
      body.appendChild(errBlock);
    }

    body.appendChild(el('div', 'font-weight:600;margin-bottom:6px;color:#79c0ff;', 'Per-family deltas:'));
    var anyChange = false;
    for (var i = 0; i < plans.length; i++) {
      var plan = plans[i];
      var fam = plan.family;
      var before = beforeByKey[fam.familyKey];
      var after = afterByKey[fam.familyKey];
      var beforeTotal = before ? totalItemsInFamily(before) : 0;
      var afterTotal = after ? totalItemsInFamily(after) : 0;
      if (beforeTotal === afterTotal && beforeTotal === 0) continue;
      anyChange = true;
      var qs = Object.keys(fam.variants).map(Number).sort(function (a, b) { return b - a; });
      var tierLabel = qs.map(function (q) { return QUALITY_LABEL[q] || ('Q' + q); }).join(' + ');
      var line = el('div', 'padding:4px 0;border-bottom:1px solid #21262d;display:flex;justify-content:space-between;');
      line.appendChild(el('span', '', fam.name + ' (' + tierLabel + ')'));
      line.appendChild(el('span', (afterTotal < beforeTotal ? 'color:#3fb950' : 'color:#8b949e') + ';', beforeTotal + ' → ' + afterTotal));
      body.appendChild(line);
    }
    if (!anyChange) body.appendChild(el('div', 'color:#8b949e;', '(no bag changes detected)'));

    // Chip totals — best-effort: walk variants of first plan for chip ID
    var chipId = 2550001;
    if (plans[0]) {
      var firstQ = Object.keys(plans[0].family.variants)[0];
      if (firstQ && plans[0].family.variants[firstQ]) chipId = plans[0].family.variants[firstQ].decompChipId || chipId;
    }
    var chipNow = chipCounts[chipId] != null ? chipCounts[chipId] : null;
    if (chipNow != null) {
      body.appendChild(el('div', 'margin-top:10px;color:#3fb950;font-weight:600;text-align:center;font-size:13px;', 'Skill Chip total now: ' + chipNow));
    }

    overlay.body.appendChild(body);

    var row = el('div', 'display:flex;gap:8px;margin-top:10px;');
    var doneBtn = el('button', 'flex:1;padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;', 'Close');
    doneBtn.addEventListener('click', function () { overlay.remove(); });
    row.appendChild(doneBtn);
    overlay.body.appendChild(row);
  }

  function showError(overlay, message) {
    clearChildren(overlay.body);
    overlay.setHeader('Failed', '#f85149');
    overlay.setSub(message, '#f85149');
    var row = el('div', 'display:flex;justify-content:center;margin-top:10px;');
    var btn = el('button', 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;', 'Close');
    btn.addEventListener('click', function () { overlay.remove(); });
    row.appendChild(btn);
    overlay.body.appendChild(row);
  }

  // ─── Entry ────────────────────────────────────────────────────────────
  var overlay = null;
  try { overlay = buildOverlay(); } catch (_) {}

  (async function main() {
    try {
      var req = getRequire();
      if (overlay) overlay.setSub('Opening bag…');
      var ud = await captureUserData(req);
      if (overlay) overlay.setSub('Reading bag…');
      var families = enumerateFamilies(req, ud);
      // Filter to families with at least one dismantleable step
      families = families.filter(function (f) {
        var p = buildPlan(req, f);
        return p && p.steps.length > 0;
      });
      if (overlay) {
        function showList() {
          clearChildren(overlay.body);
          overlay.setHeader('Skill Dismantle', '#79c0ff');
          overlay.setSub(families.length + ' famil' + (families.length === 1 ? 'y' : 'ies') + ' in bag · pick which to dismantle', '#8b949e');
          renderFamilyList(req, overlay.body, families, {
            onClose: function () { overlay.remove(); },
            onRun: function (plans) {
              showConfirm(overlay, plans,
                async function () {
                  var totalSteps = plans.reduce(function (s, p) { return s + p.steps.length; }, 0);
                  var progress = showProgress(overlay, totalSteps);
                  var beforeFamilies = families.map(function (f) { return JSON.parse(JSON.stringify(f)); });
                  try {
                    var result = await executePlans(req, plans, {
                      abort: progress.abort,
                      onStep: progress.onStep,
                      onStepResult: progress.onResult,
                    });
                    showSummary(overlay, req, beforeFamilies, result, plans);
                  } catch (e) {
                    showError(overlay, e && e.message ? e.message : String(e));
                  }
                },
                showList
              );
            },
          });
        }
        showList();
      }
    } catch (err) {
      if (overlay) showError(overlay, err && err.message ? err.message : String(err));
      else { try { alert('Skill Dismantle failed: ' + (err && err.message || err)); } catch (_) {} }
    }
  })();
})();
