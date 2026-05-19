// 2864tw.com consolidated armory bookmarklet (v1).
// One click on h5.topwargame.com → snapshots inventory + bench beasts + HT chips
// + titan gear pool, then surfaces a single combined JSON to copy.
//
// Open path: UIManager.default.Instance().OpenUI(UIDataInfo.UIDataInfo.<panel>)
// — the canonical Cocos panel-open API. Falls back to button-event clicks if
// OpenUI silently fails (no error but panel never mounts within timeout).
//
// Output envelope: { v: 2, ts, inventory, beasts, chips, gear, heroes, errors }
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
      // The mount path is the canonical "first frame in PopLayer" location for
      // this panel; cc.find('a/b/UIFrameNone/c/X') only matches the FIRST
      // UIFrameNone child, so when multiple UIFrameNone frames are stacked
      // (e.g. chip panel + gear panel both use UIFrameNone) the panel can
      // mount inside the second frame and the direct find returns null.
      // Walk PopLayer for any active frame whose CONTENT holds our panel.
      var panelName = mountPath.split('/').pop();
      function findPanel() {
        // Direct path first (fastest, covers the typical single-frame case)
        var node = cc.find(mountPath);
        if (node && node.active) return node;
        // Walk fallback for stacked-frame case
        var pop = cc.find('UICanvas/PopLayer');
        if (!pop) return null;
        for (var i = 0; i < pop.children.length; i++) {
          var frame = pop.children[i];
          if (!frame.active) continue;
          var content = (frame.children || []).find(function (c) { return c.name === 'CONTENT'; });
          if (!content) continue;
          var found = (content.children || []).find(function (c) { return c.name === panelName && c.active; });
          if (found) return found;
        }
        return null;
      }
      var t0 = Date.now();
      try { UIMgr.OpenUI(uiData); } catch (e) { /* fall through to fallback */ }
      while (Date.now() - t0 < (timeoutMs || 5000)) {
        var n = findPanel();
        if (n) return n;
        await delay(80);
      }
      // Fallback: button-event style click on the documented entry point
      if (fallbackClick) {
        try { fallbackClick(); } catch (e) { /* swallow */ }
        var t1 = Date.now();
        while (Date.now() - t1 < 5000) {
          var n2 = findPanel();
          if (n2) return n2;
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
      stepHook && stepHook('Titan gear (loading)…');
      var HC;
      try { HC = req('HeroEquipController').HeroEquipController.getInstance(); }
      catch (e) { throw new Error('HeroEquipController not available'); }
      if (!HC) throw new Error('HeroEquipController not available');

      // Cold-session warm-up. HeroEquipController._heroEquipsMap is populated
      // by the bulk WS responses to ALL_HERO_EQUIPS + HERO_EQUIP_SCHEMES.
      // Those requests are normally triggered when the player first taps the
      // Hero icon (NMainUI.onHeroClick → HeroListPopup2023 → fetch). Opening
      // HeroEquipWearPanel directly skips that step, so on a cold cache the
      // controller would still be empty when we tried to read it.
      //
      // Call the bulk load directly (same internal API the panel chain uses)
      // and wait for the response. Fast on warm sessions (no-op + immediate),
      // 1–3s on cold sessions (one WS round-trip). Skips needing to mount any
      // gear UI at all — purely a data fetch.
      if (!HC._heroEquipsMap || HC._heroEquipsMap.size === 0) {
        if (typeof HC.requestAllHeroEquipData === 'function') {
          try { HC.requestAllHeroEquipData(); } catch (e) { /* fall through to panel fallback */ }
        }
        var t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          if (HC._heroEquipsMap && HC._heroEquipsMap.size > 0) break;
          await delay(150);
        }
      }

      // Panel-open fallback. If the direct WS path didn't populate the
      // controller (older client, unknown network state, function gating),
      // fall back to opening the gear panel which used to be the canonical
      // path. Closes itself afterwards so the player ends back at main.
      if (!HC._heroEquipsMap || HC._heroEquipsMap.size === 0) {
        var gearPath = 'UICanvas/PopLayer/UIFrameNone/CONTENT/HeroEquipWearPanel';
        var node = await openPanel(UIDataInfo.HeroEquipWearPanel, gearPath);
        if (node) {
          var t1 = Date.now();
          while (Date.now() - t1 < 5000) {
            if (HC._heroEquipsMap && HC._heroEquipsMap.size > 0) break;
            await delay(150);
          }
          await closePanel(UIDataInfo.HeroEquipWearPanel, gearPath);
        }
      }

      if (!HC._heroEquipsMap || HC._heroEquipsMap.size === 0) {
        throw new Error('Hero equip data did not load — try opening Heroes once in-game, then re-run');
      }
      if (!HC._heroEquipSchemes) throw new Error('Hero equip schemes map missing');

      var TM, T, getText, equipTable, buffRdTable, skillRdTable, heroTable, effectBuff;
      try {
        TM = req('TableManager').TABLE;
        T = TM._tableMap;
        getText = req('LocalManager').LOCAL.getText.bind(req('LocalManager').LOCAL);
      } catch (e) { throw new Error('Table manager not ready'); }

      // Cold-session table warm-up.
      //
      // Two layers of laziness in TableManager:
      //   1. Group level: _tableMap[name] is null until getTableGroup loads it.
      //   2. Entry level: even after the group is loaded, individual entries
      //      are stored as compressed backtick-delimited strings (e.g.
      //      "100501`5`2`5`^#5`^#11`...") and only get decoded into objects
      //      on first call to getTableDataById(name, id) — which mutates the
      //      cache in-place, replacing the string with the parsed object.
      //
      // For gear extraction we iterate `for k in skillRdTable` to find sibling
      // group members, and read fields like cfg.quality directly. Both require
      // every entry in those tables to be in DECODED form. So after loading
      // the group, walk every cached id and call getTableDataById to decode it.
      //
      // hero (206) and effect_buff (2577) appear to be loaded eagerly with
      // entries pre-decoded at game boot, but we run them through the same
      // pipeline to be defensive.
      ['hero_equip', 'hero_equip_buff_rd', 'hero_equip_skill_rd_library', 'hero', 'effect_buff'].forEach(function (name) {
        try { TM.getTableGroup(name, true); } catch (_) {}
        var t = T[name];
        if (t) {
          var keys = Object.keys(t);
          for (var i = 0; i < keys.length; i++) {
            try { TM.getTableDataById(name, keys[i]); } catch (_) {}
          }
        }
      });
      equipTable = T['hero_equip'] || {};
      buffRdTable = T['hero_equip_buff_rd'] || {};
      skillRdTable = T['hero_equip_skill_rd_library'] || {};
      heroTable = T['hero'] || {};
      effectBuff = T['effect_buff'] || {};

      // Cached lookup with on-demand decode fallback for ids that aren't in
      // the cache yet (e.g. an equipId the player owns whose entry getTableGroup
      // didn't pull). getTableDataById both returns the decoded object and
      // populates the cache for future iterations.
      function lookup(name, id) {
        var t = T[name];
        var v = t && t[id];
        if (v && typeof v === 'object') return v;
        try { return TM.getTableDataById(name, id); } catch (_) { return null; }
      }

      var heroNameById = {};
      for (var hk in heroTable) {
        var h = heroTable[hk];
        if (h && typeof h === 'object' && h.name) heroNameById[h.id || +hk] = getText(h.name);
      }
      function resolveBuffName(buff_id) {
        if (!buff_id) return null;
        var e = lookup('effect_buff', buff_id);
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
          var rd = lookup('hero_equip_buff_rd', info.templateId);
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
          var sk = lookup('hero_equip_skill_rd_library', info.templateId);
          var star = null, starMax = null;
          // Sibling-group iteration relies on the loaded cache. After
          // getTableGroup the skillRdTable has 404 entries which covers
          // every rune family, so this works on cold sessions.
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
        var cfg = lookup('hero_equip', e.equipId);
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
      // No panel close needed here — the WS-direct path doesn't open a panel,
      // and the fallback path already closed HeroEquipWearPanel inline before
      // reaching this point.
      return { v: 1, meta: { ts: new Date().toISOString() }, summary: summary, schemes: schemes, goldGear: goldGear, equippedNonGold: equippedNonGold, presetOnly: presetOnly };
    }

    // ─── Owned heroes (roster + skill loadouts) ───────────────────────────
    // Read straight from HeroController.getHaveHeroList() — no UI mount, no
    // scrolling, no WS round-trip needed (the player's roster is hydrated
    // at login). Captures both skill presets so the armory-report can show
    // p1 vs p2 side-by-side and downstream features can compare loadouts.
    async function extractHeroes() {
      stepHook && stepHook('Hero roster…');
      var HC;
      try { HC = req('HeroController').HeroController.getInstance(); }
      catch (e) { throw new Error('HeroController not available'); }
      if (!HC || typeof HC.getHaveHeroList !== 'function') throw new Error('HeroController.getHaveHeroList not available');
      var have = HC.getHaveHeroList();
      if (!Array.isArray(have)) throw new Error('getHaveHeroList returned non-array');
      function trimSlots(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map(function (s) { return { id: (s && s.skillId) || 0, lv: (s && s.level) || 0 }; });
      }
      function trimTalents(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map(function (t) {
          var o = { id: t && t.talentId || 0 };
          if (t && t.tmpTalentId) o.tmp = t.tmpTalentId;
          if (t && t.ttsr != null && t.ttsr !== 10000) o.ttsr = t.ttsr;
          if (t && t.randomNum) o.rn = t.randomNum;
          return o;
        });
      }
      var list = have.map(function (h) {
        var o = {
          id: h._id,
          star: h._star,
          lv: h._level,
          mlv: h._maxLevel,
          q: h._quality,
          t: h._type,
          ht: h._hero_type,
          pw: h._power,
          ns: h._skill,
          ap: h._skillsIndex || 0,
          p1: { x: trimSlots(h._firstSkillList),  b: trimSlots(h._firstBuffList)  },
          p2: { x: trimSlots(h._secondSkillList), b: trimSlots(h._secondBuffList) }
        };
        if (h._skinId)        o.sk = h._skinId;
        if (h._dressId)       o.dr = h._dressId;
        if (h._awakenLevel)   o.aw = h._awakenLevel;
        if (h._fullAwaken)    o.fa = 1;
        // Frontend derives the equipped-exclusive state by checking
        // p1.x[0]/p2.x[0] against the hero's predefined exclusive skillId
        // (in landing-page/data/all-heroes.json). No TABLE walk here — the
        // hero_skill table can be lazily decompressed at the moment the
        // bookmarklet runs, and we'd silently miss every hero if it isn't.
        var tl = trimTalents(h._talents);
        if (tl.length) o.tal = tl;
        return o;
      });
      return { v: 1, ts: new Date().toISOString(), list: list };
    }

    // ─── Formation V2 (3 formations + 50-node talent tree) ──────────────
    // ─── Enigma platform deployment + full beast roster (Phase 3a) ──────
    // Reads EnigmaBeastController.getInstance() directly — the controller
    // is populated at login and exposes both the deployed field/hole map
    // and the player's complete owned beast roster (deployed + bench).
    // No panel-open needed. Produces a self-contained snapshot the armory
    // can use to render the enigma tab and run the beast optimizer
    // without any battle report present.
    async function extractEnigmaState() {
      stepHook && stepHook('Enigma state…');
      var EC;
      try {
        var emod = req('EnigmaBeastController');
        EC = emod && emod.default;
      } catch (e) { throw new Error('EnigmaBeastController not available'); }
      var inst = EC && (typeof EC.getInstance === 'function' ? EC.getInstance() : EC._instance);
      if (!inst) throw new Error('EnigmaBeastController.getInstance returned null');

      // Field deployment: 5 fields, each with N holes carrying enhancement
      // level + deployed beast id (null when empty).
      var fields = [];
      var fdArr = inst._fieldData || [];
      for (var fi = 0; fi < fdArr.length; fi++) {
        var f = fdArr[fi];
        if (!f) continue;
        var fid = (f._data && f._data.fid) || (f.cfg && (f.cfg.id || f.cfg)) || (fi + 1);
        var holes = [];
        var hArr = f.holes || [];
        for (var hi = 0; hi < hArr.length; hi++) {
          var h = hArr[hi];
          if (!h) continue;
          holes.push({
            hid: h.id != null ? h.id : (hi + 1),
            lv: h.lv != null ? h.lv : 0,
            beastId: h.beastId != null ? String(h.beastId) : null
          });
        }
        fields.push({ fid: Number(fid), holes: holes });
      }

      // Full beast roster (deployed + bench). Each beast carries the same
      // compact shape the bench supplement uses today so downstream
      // consumers can ingest either source identically.
      var beasts = [];
      var bArr = inst._beastData || [];
      for (var bi = 0; bi < bArr.length; bi++) {
        var w = bArr[bi];
        if (!w || !w.data) continue;
        // Skip very-low-quality beasts (matches existing extractBeasts threshold).
        var q = (w._cfg && w._cfg.quality != null) ? w._cfg.quality : (w.data && w.data.quality);
        if (q != null && q < 3) continue;
        var d = w.data;
        beasts.push({
          id: w.strId != null ? String(w.strId) : (d.id != null ? String(d.id) : null),
          cfgId: d.cfgId, lv: d.level, st: d.star,
          pot: d.potential != null ? String(d.potential) : null,
          mb: d.mainBuff, bb: d.baseBuff || null,
          q: (w._cfg && w._cfg.quality) || null,
          type: (w._cfg && w._cfg.type) || null,
          fac: (w._cfg && w._cfg.faction) || null
        });
      }

      // beast id → field placement (just the {fid,hid} pair — saves the
      // armory walking every field when only one beast's placement is
      // needed).
      var beast2field = {};
      if (inst._beast2filed && typeof inst._beast2filed.forEach === 'function') {
        inst._beast2filed.forEach(function (v, k) {
          if (!v) return;
          beast2field[String(k)] = { fid: v.fid, hid: v.hid };
        });
      }

      return {
        v: 1, ts: new Date().toISOString(),
        src: 'EnigmaBeastController._instance',
        fields: fields,
        beasts: beasts,
        beast2field: beast2field
      };
    }

    // ─── Active decorations + suits (Phase 3b) ──────────────────────────
    // Reads from the live UserData reference captured during extractInventory().
    // Filters _buildings to type 4/5 (the decoration types per the building
    // TABLE) and surfaces the same shape battle reports embed as
    // effectDecorations, so the armory decor tab can render without one.
    async function extractDecor() {
      stepHook && stepHook('Decorations…');
      var ud = window.__capturedUD;
      if (!ud) throw new Error('UserData reference not captured (run inventory first)');
      var src = ud._buildings;
      if (!Array.isArray(src)) throw new Error('UserData._buildings missing');
      var active = [];
      for (var i = 0; i < src.length; i++) {
        var b = src[i];
        if (!b || !b._Data) continue;
        var d = b._Data;
        // Only decoration-class buildings — type 4 (regular decor) and type 5
        // (path / boundary tiles that also contribute buffs).
        if (d.type !== 4 && d.type !== 5) continue;
        active.push({
          id: d.id,                      // building TABLE id (group * 100 + level effectively)
          group: d.group,
          level: d.level,
          type: d.type,
          quality: d.quality != null ? d.quality : 0,
          buff_id: d.buff_id || '',
          pos: b._pos != null ? b._pos : 0
        });
      }
      var suits = [];
      if (Array.isArray(ud._DecorationSuits)) {
        for (var s = 0; s < ud._DecorationSuits.length; s++) {
          var ds = ud._DecorationSuits[s];
          if (!ds) continue;
          suits.push({
            suitId: ds._suitId,
            rewarded: ds._rewarded ? 1 : 0,
            rewardedLevel: ds.rewardedLevel || 0
          });
        }
      }
      return {
        v: 1, ts: new Date().toISOString(),
        active: active,
        suits: suits,
        totalExp: ud._decorationTotalExp != null ? ud._decorationTotalExp : 0
      };
    }

    // ─── Active base skin + collection arrays (Phase 3c) ────────────────
    // Tiny payload — just the active castle skin id plus the owned + collect
    // arrays so the armory bases page can render the right skin without a
    // battle report. Nameplate / castle effect arrays are included when the
    // player has any.
    async function extractBaseSkin() {
      stepHook && stepHook('Base skin…');
      var ud = window.__capturedUD;
      if (!ud) throw new Error('UserData reference not captured (run inventory first)');
      function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return Number.isInteger(x); }) : []; }
      return {
        v: 1, ts: new Date().toISOString(),
        activeSkinId: Number.isInteger(ud._hSkinId) ? ud._hSkinId : null,
        ownedSkins: arr(ud._myCastleSkinShowArray),
        collectSkins: arr(ud._myCastleSkinCollectArray),
        ownedNameplates: arr(ud._myCastleNameShowArray),
        collectNameplates: arr(ud._myCastleNameCollectArray),
        ownedEffects: arr(ud._myCastleEffectShowArray),
        collectEffects: arr(ud._myCastleEffectCollectArray)
      };
    }

    // Read-only snapshot. Pulls the controller singleton via the static
    // `Instance` GETTER (capital I, non-enumerable — `_instance` stays null
    // until something touches the getter, hence "controller missing"
    // failures earlier). Calls requestFormationTalentInfo() to populate the
    // server-side talent array, then dumps per-formation state from
    // _advFormation. NEVER invokes sendLevelUpFormationTalent /
    // sendResetFormationTalent / sendChangeFormationTalent — the player
    // executes any reset/relevel in-game themselves; this extractor is
    // purely a snapshot for the planner.
    async function extractFormation() {
      stepHook && stepHook('Formation…');
      var FC;
      try {
        var mod = req('FightFormationAdvController');
        FC = mod && mod.default && mod.default.Instance;  // static getter, lazy-creates singleton
      } catch (e) { throw new Error('FightFormationAdvController not available'); }
      if (!FC) throw new Error('FightFormationAdvController.Instance returned null');

      if (!Array.isArray(FC.serverFormationV2Talent) || FC.serverFormationV2Talent.length === 0) {
        if (typeof FC.requestFormationTalentInfo === 'function') {
          try { FC.requestFormationTalentInfo(); } catch (e) {}
        }
        var t0 = Date.now();
        while (Date.now() - t0 < 6000) {
          if (Array.isArray(FC.serverFormationV2Talent) && FC.serverFormationV2Talent.length > 0) break;
          await delay(200);
        }
      }
      var talents = Array.isArray(FC.serverFormationV2Talent) ? FC.serverFormationV2Talent.slice() : [];

      // Per-formation snapshot. Real field names on _advFormation are:
      // level (not lv/_level), quality, masteryLevel (not masterys),
      // formationId, isMarching, canMarchNum, maxCanMarchNum. Sciences +
      // boost flags do NOT live here — they come from battle reports.
      var perF = {};
      var adv = FC._advFormation || {};
      ['1001', '1002', '1003'].forEach(function (fid) {
        var s = adv[fid] || adv[Number(fid)];
        if (!s) return;
        perF[fid] = {
          id: Number(fid),
          lv: s.level != null ? s.level : 0,
          quality: s.quality != null ? s.quality : 0,
          masterys: s.masteryLevel || null,
          isMarching: !!s.isMarching,
          canMarchNum: s.canMarchNum || 0,
          maxCanMarchNum: s.maxCanMarchNum || 0,
        };
      });

      // Formation 101 currency (item 2800000) for the planner's pool view.
      // Lives in UserData._items (flat array, ~1000 entries). The patched
      // UserData reference from extractInventory is the primary path; falls
      // back to a fresh UserData ref if formation runs without inventory.
      var f101 = null;
      try {
        var ud2 = window.__capturedUD;
        if (!ud2) {
          try {
            var UDC = req('UserData');
            ud2 = UDC && UDC.default && (UDC.default.Instance || (UDC.default.getInstance && UDC.default.getInstance()));
          } catch (e) {}
        }
        if (ud2 && Array.isArray(ud2._items)) {
          for (var ii = 0; ii < ud2._items.length; ii++) {
            var it = ud2._items[ii];
            if (it && it._itemId === 2800000) { f101 = it._amount; break; }
          }
        }
      } catch (e) {}

      var pwrCur = null, pwrMax = null;
      try { if (typeof FC.getAllFormationTalentPower === 'function')    pwrCur = FC.getAllFormationTalentPower(); }    catch (e) {}
      try { if (typeof FC.getAllFormationTalentPowerMax === 'function') pwrMax = FC.getAllFormationTalentPowerMax(); } catch (e) {}

      // Phase 3d: capture the 8 march presets (slot positions + heroes +
      // formation V2 choice) so the armory can render every deployment the
      // player has saved, not just the one the most recent battle report
      // happens to carry. Reads from UserData._PresetMarchData which the
      // BagPanel UpdateView path already warms up.
      var presets = [];
      var defenceFormationV2 = 0;
      try {
        var ud3 = window.__capturedUD;
        if (!ud3) {
          try {
            var UDC3 = req('UserData');
            ud3 = UDC3 && UDC3.default && (UDC3.default.Instance || (UDC3.default.getInstance && UDC3.default.getInstance()));
          } catch (e) {}
        }
        if (ud3) {
          var pmd = ud3._PresetMarchData;
          var mList = pmd && pmd._MarchList;
          var fv2List = pmd && pmd._formationV2List;
          var fv1List = pmd && pmd._formationList;
          if (Array.isArray(mList)) {
            for (var pi = 0; pi < mList.length; pi++) {
              var pp = mList[pi];
              if (!pp) { presets.push(null); continue; }
              var slots = [];
              var aArr = pp._Armys || [];
              for (var si = 0; si < aArr.length; si++) {
                var a = aArr[si];
                if (!a) continue;
                var slot = {
                  pos: a.Pos != null ? a.Pos : si,
                  armyId: a.ArmyId || 0,
                  num: a.Num || 0,
                  heroCap: a.heroCap || 0
                };
                if (a.isMecha) { slot.isMecha = true; slot.mechaId = a.mechaId; }
                slots.push(slot);
              }
              var extraArmy = [];
              if (Array.isArray(pp._extraArmy)) {
                for (var ei = 0; ei < pp._extraArmy.length; ei++) {
                  var ea = pp._extraArmy[ei];
                  if (!ea) continue;
                  extraArmy.push({ pos: ea.Pos, armyId: ea.ArmyId, num: ea.Num });
                }
              }
              presets.push({
                icon: pp.icon || 0,
                slots: slots,
                heroIds: Array.isArray(pp._HeroIds) ? pp._HeroIds.slice() : [],
                extraArmy: extraArmy,
                formationV1: Array.isArray(fv1List) ? (fv1List[pi] || 0) : 0,
                formationV2: Array.isArray(fv2List) ? (fv2List[pi] || 0) : 0
              });
            }
          }
          defenceFormationV2 = Number(ud3._defenceFormationV2) || 0;
        }
      } catch (e) {}

      return {
        v: 1,
        ts: new Date().toISOString(),
        talents: talents,
        formations: perF,
        currencies: { '2800000': f101 },
        power: { cur: pwrCur, max: pwrMax },
        presets: presets,
        defenceFormationV2: defenceFormationV2,
      };
    }

    return (async function () {
      var errors = [];
      var inv = null, beasts = null, chips = null, gear = null, heroes = null, formation = null;
      var enigmaState = null, decorations = null, baseSkin = null;
      // inventory FIRST — its BagPanel UpdateView is what captures the live
      // UserData reference into window.__capturedUD, which decor/skin/formation
      // presets all read from. If inventory fails, those downstream
      // extractors will surface their own error rather than silently
      // crashing.
      try { inv = await extractInventory(); } catch (e) { errors.push({ section: 'inventory', message: e.message }); }
      try { enigmaState = await extractEnigmaState(); } catch (e) { errors.push({ section: 'enigmaState', message: e.message }); }
      try { beasts = await extractBeasts(); } catch (e) { errors.push({ section: 'beasts', message: e.message }); }
      try { chips = await extractChips(); } catch (e) { errors.push({ section: 'chips', message: e.message }); }
      try { gear = await extractGear(); } catch (e) { errors.push({ section: 'gear', message: e.message }); }
      try { heroes = await extractHeroes(); } catch (e) { errors.push({ section: 'heroes', message: e.message }); }
      try { decorations = await extractDecor(); } catch (e) { errors.push({ section: 'decorations', message: e.message }); }
      try { baseSkin = await extractBaseSkin(); } catch (e) { errors.push({ section: 'baseSkin', message: e.message }); }
      try { formation = await extractFormation(); } catch (e) { errors.push({ section: 'formation', message: e.message }); }
      return {
        // Envelope v3 — adds enigmaState, decorations, baseSkin top-level
        // sections plus formation.presets[]. The receiver in armory-report.html
        // accepts both v2 and v3 so users mid-rollout don't lose imports.
        v: 3,
        ts: new Date().toISOString(),
        meta: inv ? inv.meta : null,  // mirror the meta block to the envelope so the receiver doesn't need to dig into inventory just for {uid, lvl, sid, pwr}
        inventory: inv,
        beasts: beasts,
        chips: chips,
        gear: gear,
        heroes: heroes,
        formation: formation,
        enigmaState: enigmaState,
        decorations: decorations,
        baseSkin: baseSkin,
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
    sub.textContent = 'Inventory · Enigma · Beasts · HT chips · Titan gear · Heroes · Decor · Skin · Formation';
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
      if (dump.enigmaState) {
        var deployedHoles = (dump.enigmaState.fields || []).reduce(function (s, f) {
          return s + ((f && f.holes) || []).filter(function (h) { return h && h.beastId; }).length;
        }, 0);
        sections.push(deployedHoles + ' deployed / ' + (dump.enigmaState.beasts ? dump.enigmaState.beasts.length : 0) + ' beasts');
      } else if (dump.beasts) {
        sections.push(dump.beasts.kept + ' beasts');
      }
      if (dump.chips) sections.push(dump.chips.total + ' chips');
      if (dump.gear) sections.push(dump.gear.summary.goldCount + ' gold gear');
      if (dump.heroes) sections.push(dump.heroes.list.length + ' heroes');
      if (dump.decorations) sections.push((dump.decorations.active ? dump.decorations.active.length : 0) + ' decor');
      if (dump.baseSkin && dump.baseSkin.activeSkinId) sections.push('skin ' + dump.baseSkin.activeSkinId);
      if (dump.formation) {
        sections.push((dump.formation.talents ? dump.formation.talents.length : 0) + ' formation talents');
        var presetCount = (dump.formation.presets || []).filter(function (p) { return p && p.slots && p.slots.some(function (s) { return s.armyId; }); }).length;
        if (presetCount) sections.push(presetCount + ' march presets');
      }
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
