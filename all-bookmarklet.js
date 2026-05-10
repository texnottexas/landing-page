// 2864tw.com consolidated armory bookmarklet (v1).
// One click on h5.topwargame.com → snapshots inventory + bench beasts + HT chips
// + titan gear pool, then surfaces a single combined JSON to copy.
//
// Open path: UIManager.default.Instance().OpenUI(UIDataInfo.UIDataInfo.<panel>)
// — the canonical Cocos panel-open API. Falls back to button-event clicks if
// OpenUI silently fails (no error but panel never mounts within timeout).
//
// Output envelope: { v: 2, ts, inventory, beasts, chips, gear, errors }
// Each section preserves the v=1 shape produced by the existing single-purpose
// bookmarklets so the wizard's existing handlers can route them unchanged.
(function () {
  function buildDump(stepHook) {
    var req = window.__require;
    if (!req) throw new Error('Game not loaded — wait for the game to finish loading, then retry');
    var cc = window.cc;
    var UIMgr;
    try { UIMgr = req('UIManager').default.Instance(); }
    catch (e) { throw new Error('UIManager not ready — wait a moment and retry'); }
    var UIDataInfo;
    try { UIDataInfo = req('UIDataInfo').UIDataInfo; }
    catch (e) { throw new Error('UIDataInfo not ready — wait a moment and retry'); }

    function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function findComp(name) {
      var found = null;
      function walk(n, d) {
        if (!n || d > 22 || found) return;
        var cs = n._components || [];
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          var nm = (c && (c.__classname__ || (c.constructor && c.constructor.name))) || '';
          if (nm === name) { found = c; return; }
        }
        for (var j = 0; j < (n._children || []).length; j++) walk(n._children[j], d + 1);
      }
      walk(cc.find('UICanvas'), 0);
      return found;
    }

    async function openPanel(uiData, mountPath, fallbackClick, timeoutMs) {
      var t0 = Date.now();
      try { UIMgr.OpenUI(uiData); } catch (e) { /* fall through to fallback */ }
      while (Date.now() - t0 < (timeoutMs || 5000)) {
        var node = cc.find(mountPath);
        if (node && node.active) return node;
        await delay(80);
      }
      // Fallback: button-event style click on the documented entry point
      if (fallbackClick) {
        try { fallbackClick(); } catch (e) { /* swallow */ }
        var t1 = Date.now();
        while (Date.now() - t1 < 5000) {
          var n2 = cc.find(mountPath);
          if (n2 && n2.active) return n2;
          await delay(80);
        }
      }
      return null;
    }

    async function closePanel(uiData, mountPath) {
      try { UIMgr.CloseUI(uiData); } catch (e) {}
      var t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        var node = cc.find(mountPath);
        if (!node || !node.active) return true;
        await delay(80);
      }
      return false;
    }

    // ─── Inventory ────────────────────────────────────────────────────────
    async function extractInventory() {
      stepHook && stepHook('Inventory…');
      var UD = req('UserData').default;
      if (!UD.prototype.__patched) {
        var orig = UD.prototype.getItemListByBagType;
        UD.prototype.getItemListByBagType = function (t) { window.__capturedUD = this; return orig.call(this, t); };
        UD.prototype.__patched = true;
      }
      var bagPath = 'UICanvas/PopLayer/UIFrameScreen/CONTENT/BagPanel';
      var node = await openPanel(UIDataInfo.BagPanel, bagPath, function () {
        var btn = cc.find('UICanvas/MainUIWrapper/NMainUI/RightBottom/btnBag');
        if (btn) btn.getComponent(cc.Button).clickEvents.forEach(function (e) { e.emit([btn]); });
      });
      if (!node) throw new Error('BagPanel did not mount');
      var bp = node.getComponent('BagPanel');
      if (bp && bp.UpdateView) { try { bp.UpdateView(); } catch (e) {} }
      await delay(220);
      var ud = window.__capturedUD;
      if (!ud) throw new Error('UserData reference not captured (UpdateView did not fire patch)');
      var TYPES = [['item', 1], ['unit', 2], ['decor', 3], ['hero', 4], ['cpnt', 5]];
      var tabs = {};
      for (var i = 0; i < TYPES.length; i++) {
        var key = TYPES[i][0], type = TYPES[i][1];
        try {
          var list = ud.getItemListByBagType(type);
          tabs[key] = list.map(function (it) {
            var o = { id: it._itemId, a: it._amount };
            if (it._level != null && it._level > 0) o.l = it._level;
            if (it._GroupId && it._GroupId !== it._itemId) o.g = it._GroupId;
            return o;
          });
        } catch (e) { tabs[key] = []; }
      }
      var heros = {};
      if (ud._heros) {
        var keys = Object.keys(ud._heros);
        for (var j = 0; j < keys.length; j++) {
          var h = ud._heros[keys[j]];
          if (!h || !h._id) continue;
          heros[h._id] = { lv: h._level, ml: h._maxLevel, st: h._star, q: h._quality, t: h._type, x: h._exp };
        }
      }
      var res = {};
      var rk = ['_gold', '_oila', '_soil', '_coin', '_thor', '_bountyMilitary', '_adventureCoin', '_csbRes', '_kvkTaskCoin', '_kvkMerit', '_honor', '_voucher', '_freegold', '_paidgold'];
      for (var k = 0; k < rk.length; k++) {
        var v = ud._resourceData && ud._resourceData[rk[k]];
        if (v != null) res[rk[k]] = v;
      }
      var dump = {
        v: 1,
        meta: { uid: ud._uid, lvl: ud._level, sid: ud._serverId, pwr: String(ud._armyPower), ts: new Date().toISOString() },
        resources: res,
        tabs: tabs,
        heros: heros,
      };
      await closePanel(UIDataInfo.BagPanel, bagPath);
      return dump;
    }

    // ─── Bench beasts (Q3+ unplaced) ──────────────────────────────────────
    async function extractBeasts() {
      stepHook && stepHook('Beasts…');
      var beastPath = 'UICanvas/PopLayer/UIFrameScreenWithBottom/CONTENT/EnigmaBeastListPanel';
      var node = await openPanel(UIDataInfo.EnigmaBeastListPanel, beastPath, function () {
        var btn = cc.find('Canvas/HomeMap/BuildingUINode/EnigmaBeastList');
        if (btn) btn.getComponent(cc.Button).clickEvents.forEach(function (e) { e.emit([btn]); });
      });
      if (!node) throw new Error('EnigmaBeastListPanel did not mount');
      var panel = node.getComponent('EnigmaBeastListPanel');
      if (!panel || !Array.isArray(panel._data)) throw new Error('Beast list empty');
      var arr = panel._data;
      // Compute deployed map by transient ItemDef.updateUI patch (matches bench-bookmarklet)
      var ItemDef = req('EnigmaBeastItem').default;
      var origUpdateUI = ItemDef.prototype.updateUI;
      var deployed = {};
      ItemDef.prototype.updateUI = function (e) { if (e && e.deploy && e.strId) deployed[e.strId] = true; };
      try {
        var fakeParent = new cc.Node('beastProbe');
        var rows = Math.ceil(arr.length / 4);
        for (var i = 0; i < rows; i++) {
          try { panel.tableCellAtIndex(fakeParent, i); } catch (e) {}
        }
        if (fakeParent.destroy) fakeParent.destroy();
      } finally { ItemDef.prototype.updateUI = origUpdateUI; }
      var out = [];
      var skipped = 0;
      for (var k = 0; k < arr.length; k++) {
        var w = arr[k];
        if (!w || !w.data || !w._cfg) continue;
        if ((w._cfg.quality || 0) < 3) continue;
        if (deployed[w.strId]) { skipped++; continue; }
        var b = w.data;
        out.push({
          id: b.id != null ? String(b.id) : null,
          cfgId: b.cfgId, lv: b.level, st: b.star,
          pot: b.potential != null ? String(b.potential) : null,
          mb: b.mainBuff, bb: b.baseBuff || null,
          q: w._cfg.quality, type: w._cfg.type, fac: w._cfg.faction,
        });
      }
      var dump = {
        v: 1, ts: new Date().toISOString(), src: 'EnigmaBeastListPanel._data',
        total: arr.length, kept: out.length, skippedDeployed: skipped, beasts: out,
      };
      await closePanel(UIDataInfo.EnigmaBeastListPanel, beastPath);
      return dump;
    }

    // ─── HT chips (full pool, includes equipped via mechaId) ─────────────
    async function extractChips() {
      stepHook && stepHook('HT chips (cycling 7 tabs)…');
      var chipPath = 'UICanvas/PopLayer/UIFrameNone/CONTENT/MechaChipPanel';
      // No fallback click here — chip panel has no single-step entry from main UI;
      // OpenUI is the only documented direct route. If it fails the user can run
      // the standalone chips bookmarklet from the Mecha → Chip pool screen.
      var node = await openPanel(UIDataInfo.MechaChipPanel, chipPath);
      if (!node) throw new Error('MechaChipPanel did not mount');
      var comp = node.getComponent('MechaChipPanel');
      var byId = {};
      for (var i = 0; i < 7; i++) {
        try { if (typeof comp.setBagTab === 'function') comp.setBagTab(i); } catch (e) {}
        await delay(220);
        var bag = Array.isArray(comp._bagChip) ? comp._bagChip : [];
        for (var j = 0; j < bag.length; j++) {
          var c = bag[j];
          if (!c || !c.id || byId[c.id]) continue;
          var o = { c: c.chipId };
          if (c.id != null) o.iid = String(c.id);
          if (c.level) o.lv = c.level;
          if (c.mechaId) o.m = c.mechaId;
          if (c.rndAttrs) o.r = c.rndAttrs;
          if (c.otherRndAttrs && c.otherRndAttrs !== '{}') o.o = c.otherRndAttrs;
          if (c.refineTimes) o.rt = c.refineTimes;
          if (c.reservation) o.rs = c.reservation;
          byId[c.id] = o;
        }
      }
      var arr = Object.keys(byId).map(function (k) { return byId[k]; });
      var dump = {
        v: 1, ts: new Date().toISOString(),
        src: 'MechaChipPanel._bagChip (cycled 7 tabs; mechaId field identifies ownership)',
        total: arr.length, chips: arr,
      };
      await closePanel(UIDataInfo.MechaChipPanel, chipPath);
      return dump;
    }

    // ─── Titan gear pool ──────────────────────────────────────────────────
    async function extractGear() {
      stepHook && stepHook('Titan gear…');
      var gearPath = 'UICanvas/PopLayer/UIFrameNone/CONTENT/HeroEquipWearPanel';
      // Open the gear screen so HeroEquipController is guaranteed populated for
      // cold sessions. (For warm sessions the controller is already loaded; the
      // open is fast either way.)
      var node = await openPanel(UIDataInfo.HeroEquipWearPanel, gearPath);
      if (!node) throw new Error('HeroEquipWearPanel did not mount');
      var HC;
      try { HC = req('HeroEquipController').HeroEquipController.getInstance(); }
      catch (e) { throw new Error('HeroEquipController not available'); }
      if (!HC || !HC._heroEquipsMap || !HC._heroEquipSchemes) throw new Error('Hero equip data not loaded');

      var T, getText, equipTable, buffRdTable, skillRdTable, heroTable, effectBuff;
      try {
        T = req('TableManager').TABLE._tableMap;
        getText = req('LocalManager').LOCAL.getText.bind(req('LocalManager').LOCAL);
        equipTable = T['hero_equip'];
        buffRdTable = T['hero_equip_buff_rd'];
        skillRdTable = T['hero_equip_skill_rd_library'];
        heroTable = T['hero'];
        effectBuff = T['effect_buff'];
      } catch (e) { throw new Error('Table manager not ready'); }
      if (!equipTable) throw new Error('hero_equip table missing');

      var heroNameById = {};
      for (var hk in heroTable) {
        var h = heroTable[hk];
        if (h && typeof h === 'object' && h.name) heroNameById[h.id || +hk] = getText(h.name);
      }
      function resolveBuffName(buff_id) {
        if (!buff_id) return null;
        var e = effectBuff && effectBuff[buff_id];
        return e && e.string ? getText(e.string) : 'buff_id:' + buff_id;
      }
      function getMax(rd) {
        if (!rd || !rd.buff_value_green1) return null;
        var parts = String(rd.buff_value_green1).split('|');
        var v = +parts[parts.length - 1].split(',')[1];
        return isFinite(v) ? v : null;
      }
      var SLOT = { 1: 'Weapon', 2: 'Armor', 3: 'Accessory', 4: 'Helmet', 5: 'Device', 6: 'Boots' };
      var QUAL = { 2: 'Blue', 3: 'Purple', 4: 'Purple+', 5: 'Gold' };
      function processInfo(info) {
        if (info.type === 1) {
          var rd = buffRdTable && buffRdTable[info.templateId];
          var buff_id = rd ? rd.buff_id : null;
          var max = getMax(rd);
          return {
            type: 'stat', templateId: info.templateId, buff_id: buff_id, name: resolveBuffName(buff_id),
            rawValue: info.buffValue, rawEnhance: info.enhanceValue || 0,
            valuePercent: info.buffValue / 100, enhancePercent: (info.enhanceValue || 0) / 100,
            max: max != null ? max / 100 : null,
            rollPercent: max ? Math.round((info.buffValue / max) * 100) : null,
            enhanceShow: info.enhanceShow,
          };
        } else if (info.type === 2) {
          var sk = skillRdTable && skillRdTable[info.templateId];
          var star = null, starMax = null;
          if (sk && sk.group != null) {
            var g = [];
            for (var skKey in skillRdTable) {
              var entry = skillRdTable[skKey];
              if (entry && entry.group === sk.group) g.push(+skKey);
            }
            g.sort(function (a, b) { return a - b; });
            starMax = g.length;
            var idx = g.indexOf(info.templateId);
            if (idx >= 0) star = idx;
          }
          return {
            type: 'rune', templateId: info.templateId, skillId: sk ? sk.skill_id : null,
            name: sk && sk.name ? getText(sk.name) : null, desc: sk && sk.desc ? getText(sk.desc) : null,
            group: sk ? sk.group : null, buffValue: sk ? sk.buff_value : null,
            star: star, starMax: starMax,
            skillIcon: sk ? sk.skill_icon : null, smallIcon: sk ? sk.small_skill_icon : null,
          };
        }
        return { type: 'unknown', templateId: info.templateId };
      }
      function refinement(p) {
        var stats = p.filter(function (i) { return i.type === 'stat' && i.max != null; });
        var tv = stats.reduce(function (s, i) { return s + i.valuePercent; }, 0);
        var tm = stats.reduce(function (s, i) { return s + i.max; }, 0);
        return {
          totalValue: +tv.toFixed(2), totalMax: +tm.toFixed(2),
          threshold70: +(tm * 0.7).toFixed(2),
          percent: tm > 0 ? Math.round((tv / tm) * 100) : null,
          meetsThreshold: tv >= tm * 0.7,
        };
      }

      var schemes = [];
      HC._heroEquipSchemes.forEach(function (s, idx) {
        schemes.push({
          idx: s.idx != null ? s.idx : idx,
          name: s.rateSchemeId > 0 && s.name ? getText(s.name) : s.name,
          rawName: s.name, heroId: s.heroId,
          heroName: s.heroId ? heroNameById[s.heroId] : null,
          uids: (s.ids || []).slice(),
          rateSchemeId: s.rateSchemeId, rateEndTime: s.rateEndTime,
          isEmpty: !s.ids || s.ids.length === 0,
        });
      });
      schemes.sort(function (a, b) { return a.idx - b.idx; });

      var uidToSchemes = {};
      for (var si = 0; si < schemes.length; si++) {
        var sc = schemes[si];
        for (var ui = 0; ui < sc.uids.length; ui++) {
          var uid = sc.uids[ui];
          if (!uid || uid === '0') continue;
          (uidToSchemes[uid] = uidToSchemes[uid] || []).push({
            idx: sc.idx, name: sc.name, heroId: sc.heroId, heroName: sc.heroName, posInScheme: ui,
          });
        }
      }

      var allEquips = [];
      HC._heroEquipsMap.forEach(function (eq) { if (eq && eq.equipId) allEquips.push(eq); });
      var goldGear = [], equippedNonGold = [], presetOnly = [];
      var qHist = {};
      for (var ei = 0; ei < allEquips.length; ei++) {
        var e = allEquips[ei];
        var cfg = equipTable[e.equipId];
        if (!cfg) continue;
        qHist[cfg.quality] = (qHist[cfg.quality] || 0) + 1;
        var isEquipped = !!(e.heroId && e.heroId > 0);
        var isGold = cfg.quality === 5;
        var inSchemes = uidToSchemes[e.id] || [];
        // Keep gold, equipped non-gold, and any non-gold piece that's slotted
        // into at least one preset (swap-in candidates the player intentionally
        // configured). Drops everything else. Mirrors gear-pool-bookmarklet.js
        // 4119abf so the consolidated bookmarklet matches the standalone shape.
        if (!isGold && !isEquipped && inSchemes.length === 0) continue;
        var processed = (e.infos || []).map(processInfo);
        var enhanceParsed = {};
        for (var ek in (e.enhanceValue || {})) {
          enhanceParsed[ek] = {
            rawValue: e.enhanceValue[ek],
            percent: e.enhanceValue[ek] / 100,
            statName: resolveBuffName(+ek),
          };
        }
        var resolvedHeroId = e.heroId || (inSchemes[0] && inSchemes[0].heroId) || 0;
        var piece = {
          uid: e.id, equipId: e.equipId,
          slot: cfg.type, slotName: SLOT[cfg.type],
          quality: cfg.quality, qualityName: QUAL[cfg.quality], level: e.level,
          heroId: resolvedHeroId,
          heroName: resolvedHeroId ? (heroNameById[resolvedHeroId] || ('Hero' + resolvedHeroId)) : null,
          directHeroId: e.heroId || 0,
          gearName: getText(cfg.name), icon: cfg.icon, bigIcon: cfg.big_icon,
          power: cfg.power, effectGroup: cfg.effect_group, skillLibrary: cfg.skill_library,
          scores: { land: e.landScore, navy: e.navyScore, air: e.airScore },
          baseBuff: cfg.equip_buff, buffs: processed,
          enhance: enhanceParsed, enhanceShow: e.enhanceShow,
          refinement: refinement(processed),
          locked: e.state === 1, state: e.state, exp: e.exp,
          rateEquipId: e.rateEquipId, rateEndTime: e.rateEndTime,
          schemes: inSchemes,
        };
        if (isGold) goldGear.push(piece);
        else if (isEquipped) equippedNonGold.push(piece);
        else presetOnly.push(piece);
      }
      goldGear.sort(function (a, b) { return (b.heroId - a.heroId) || (a.slot - b.slot); });

      var summary = {
        totalEquipsCount: allEquips.length,
        goldCount: goldGear.length,
        goldEquipped: goldGear.filter(function (g) { return g.heroId > 0; }).length,
        goldUnequipped: goldGear.filter(function (g) { return g.heroId === 0; }).length,
        equippedNonGoldCount: equippedNonGold.length,
        presetOnlyCount: presetOnly.length,
        qualityHistogram: qHist,
        schemesCount: schemes.length,
        schemesActive: schemes.filter(function (s) { return !s.isEmpty; }).length,
        lockedCount: goldGear.filter(function (g) { return g.locked; }).length
                   + equippedNonGold.filter(function (g) { return g.locked; }).length
                   + presetOnly.filter(function (g) { return g.locked; }).length,
      };
      var dump = { v: 1, meta: { ts: new Date().toISOString() }, summary: summary, schemes: schemes, goldGear: goldGear, equippedNonGold: equippedNonGold, presetOnly: presetOnly };
      await closePanel(UIDataInfo.HeroEquipWearPanel, gearPath);
      return dump;
    }

    return (async function () {
      var errors = [];
      var inv = null, beasts = null, chips = null, gear = null;
      try { inv = await extractInventory(); } catch (e) { errors.push({ section: 'inventory', message: e.message }); }
      try { beasts = await extractBeasts(); } catch (e) { errors.push({ section: 'beasts', message: e.message }); }
      try { chips = await extractChips(); } catch (e) { errors.push({ section: 'chips', message: e.message }); }
      try { gear = await extractGear(); } catch (e) { errors.push({ section: 'gear', message: e.message }); }
      return {
        v: 2,
        ts: new Date().toISOString(),
        meta: inv ? inv.meta : null,  // mirror the meta block to the envelope so the receiver doesn't need to dig into inventory just for {uid, lvl, sid, pwr}
        inventory: inv,
        beasts: beasts,
        chips: chips,
        gear: gear,
        errors: errors,
      };
    })();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Status overlay — shown during the 2–4s extraction so the user sees
  // progress, then converts to a Copy button + status hint on completion.
  // iOS clipboard requires a fresh user gesture; that's why the Copy
  // button waits for the player to tap rather than firing automatically.
  // Element refs are cached at construction so attachCopyUI can mutate them
  // directly — querying via `bg.querySelector('div + div')` was fragile on
  // iOS Safari and caused the success overlay to throw + auto-close (the
  // .then() handler rejecting fell into .catch which removed the overlay).
  // ───────────────────────────────────────────────────────────────────────
  function buildOverlay() {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'color:#79c0ff;font-size:15px;font-weight:600;margin-bottom:6px;text-align:center;';
    hdr.textContent = 'Snapshotting…';
    bg.appendChild(hdr);
    var sub = document.createElement('div');
    sub.style.cssText = 'color:#8b949e;font-size:12px;margin-bottom:10px;text-align:center;';
    sub.textContent = 'Inventory · Beasts · HT chips · Titan gear';
    bg.appendChild(sub);
    document.body.appendChild(bg);
    return {
      root: bg,
      hdr: hdr,
      sub: sub,
      setStep: function (text) { sub.textContent = text; },
      setHeader: function (text) { hdr.textContent = text; },
      setHeaderColor: function (c) { hdr.style.color = c; },
    };
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function attachCopyUI(overlay, text, summary) {
    var bg = overlay.root;
    overlay.sub.textContent = summary;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.cssText = 'flex:1;width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;min-height:160px;box-sizing:border-box;';
    bg.appendChild(ta);
    var status = document.createElement('div');
    status.style.cssText = 'color:#8b949e;font-size:12px;margin-top:10px;text-align:center;min-height:1.4em;';
    status.textContent = 'Tap Copy. Then paste at 2864tw.com → armory-report.';
    bg.appendChild(status);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy combined JSON';
    copyBtn.style.cssText = 'flex:1;padding:14px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    copyBtn.onclick = function () {
      function ok() {
        copyBtn.textContent = '✓ Copied to clipboard';
        copyBtn.style.background = '#2ea043';
        copyBtn.disabled = true;
        status.style.color = '#3fb950';
        status.textContent = 'Done. Paste at 2864tw.com → armory-report → use this snapshot. Tap Close to dismiss.';
        closeBtn.textContent = 'Close';
        closeBtn.style.background = '#3fb950';
        closeBtn.style.color = '#0d1117';
        closeBtn.style.borderColor = '#3fb950';
        // Intentionally NO auto-close — players need to read the confirmation
        // and we don't want to look like the bookmarklet failed silently.
      }
      function fail(reason) {
        copyBtn.textContent = '✗ Copy failed';
        copyBtn.style.background = '#f85149';
        copyBtn.style.color = '#fff';
        status.style.color = '#f85149';
        status.textContent = 'Couldn’t auto-copy' + (reason ? ' (' + reason + ')' : '') + '. Long-press the JSON above → Select All → Copy.';
        // Pre-select so manual copy is one tap easier
        try { ta.readOnly = false; ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); ta.readOnly = true; } catch (_) {}
      }
      function execFallback() {
        try {
          ta.readOnly = false;
          ta.focus();
          ta.select();
          ta.setSelectionRange(0, text.length);
          var did = document.execCommand('copy');
          ta.readOnly = true;
          if (did) ok(); else fail('execCommand returned false');
        } catch (e) { fail(e && e.message); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(ok)
          .catch(function (e) {
            // Fall back to execCommand path on permission/secure-context refusal
            execFallback();
          });
      } else {
        execFallback();
      }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close without copying';
    closeBtn.style.cssText = 'padding:14px 18px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;';
    closeBtn.onclick = function () { try { document.body.removeChild(bg); } catch (_) {} };
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    bg.appendChild(row);
  }

  function showError(message, diagText) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(13,17,23,.95);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'color:#f85149;font-size:14px;font-weight:600;margin-bottom:6px;';
    hdr.textContent = 'Snapshot failed: ' + message;
    bg.appendChild(hdr);
    var sub = document.createElement('div');
    sub.style.cssText = 'color:#8b949e;font-size:12px;margin-bottom:8px;';
    sub.textContent = 'Tap Copy and paste in chat so we can debug. No personal info inside.';
    bg.appendChild(sub);
    var ta = document.createElement('textarea');
    ta.value = diagText;
    ta.readOnly = true;
    ta.style.cssText = 'flex:1;width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;min-height:200px;box-sizing:border-box;';
    bg.appendChild(ta);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy diagnostic';
    copyBtn.style.cssText = 'flex:1;padding:12px;background:#388bfd;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    copyBtn.onclick = function () {
      function ok() { copyBtn.textContent = 'Copied!'; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(diagText).then(ok).catch(function () {
          ta.readOnly = false; ta.focus(); ta.select();
          try { document.execCommand('copy'); ok(); } catch (_) {}
          ta.readOnly = true;
        });
      } else {
        ta.readOnly = false; ta.focus(); ta.select();
        try { document.execCommand('copy'); ok(); } catch (_) {}
        ta.readOnly = true;
      }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;';
    closeBtn.onclick = function () { try { document.body.removeChild(bg); } catch (_) {} };
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    bg.appendChild(row);
    document.body.appendChild(bg);
  }

  function buildDiagnostic(err) {
    var req = window.__require;
    var cc = window.cc;
    var diag = {
      kind: 'all-bookmarklet-diag', v: 1, ts: new Date().toISOString(),
      error: err && (err.message || String(err)),
      userAgent: (navigator.userAgent || '').slice(0, 200),
      gameLoaded: !!req,
      ccPresent: !!cc,
    };
    try { diag.uiManagerReady = !!req('UIManager').default.Instance(); } catch (_) { diag.uiManagerReady = false; }
    try { diag.uiDataInfoReady = !!req('UIDataInfo').UIDataInfo.BagPanel; } catch (_) { diag.uiDataInfoReady = false; }
    try { diag.heroEquipReady = !!req('HeroEquipController').HeroEquipController.getInstance(); } catch (_) { diag.heroEquipReady = false; }
    return diag;
  }

  // ─── Entry point ────────────────────────────────────────────────────────
  var overlay;
  try {
    overlay = buildOverlay();
  } catch (_) { /* DOM somehow not ready; bail without overlay */ }

  buildDump(overlay && overlay.setStep).then(function (dump) {
    // Wrap the success-path UI work in its own try so any rendering glitch
    // doesn't fall through to .catch() (which removes the overlay — the
    // bug behind the iOS "popup vanished after ~1s" report). Even if the
    // UI fails to render, the snapshot itself is already in `dump`, so we
    // fall back to alert with the JSON exposed via window.__snapshot.
    try {
      var json = JSON.stringify(dump);
      var sections = [];
      if (dump.inventory) sections.push((dump.inventory.tabs ? Object.keys(dump.inventory.tabs).reduce(function (s, k) { return s + (dump.inventory.tabs[k] || []).length; }, 0) : 0) + ' inv');
      if (dump.beasts) sections.push(dump.beasts.kept + ' beasts');
      if (dump.chips) sections.push(dump.chips.total + ' chips');
      if (dump.gear) sections.push(dump.gear.summary.goldCount + ' gold gear');
      var summary = sections.join(' · ') + ' — ' + fmtBytes(json.length);
      if (dump.errors && dump.errors.length) {
        summary += ' · ' + dump.errors.length + ' section(s) failed';
      }
      if (overlay) {
        overlay.setHeader(dump.errors && dump.errors.length ? 'Partial snapshot' : 'Snapshot ready');
        overlay.setHeaderColor(dump.errors && dump.errors.length ? '#d29922' : '#3fb950');
        attachCopyUI(overlay, json, summary);
      } else {
        try { alert('Snapshot: ' + summary); } catch (_) {}
      }
    } catch (uiErr) {
      // Last-ditch surface — still expose the JSON so the run isn't wasted
      try { window.__snapshot = JSON.stringify(dump); } catch (_) {}
      try {
        if (overlay) overlay.setHeader('UI render failed — JSON at window.__snapshot');
        if (overlay) overlay.setHeaderColor('#d29922');
      } catch (_) {}
      try { alert('Snapshot ready but UI failed: ' + uiErr.message + '\nJSON saved to window.__snapshot'); } catch (_) {}
    }
  }).catch(function (err) {
    if (overlay) { try { document.body.removeChild(overlay.root); } catch (_) {} }
    try {
      showError(err.message || String(err), JSON.stringify(buildDiagnostic(err), null, 2));
    } catch (e2) {
      try { alert('Snapshot failed: ' + (err && err.message ? err.message : err)); } catch (_) {}
    }
  });
})();
