(function () {
  function buildDump() {
    var req = window.__require;
    if (!req) throw new Error('Game not loaded — wait for the game to finish loading, then retry');
    var HC;
    try { HC = req('HeroEquipController').HeroEquipController.getInstance(); }
    catch (e) { throw new Error('HeroEquipController not available — open the Titan Gear screen once, then retry'); }
    if (!HC || !HC._heroEquipsMap || !HC._heroEquipSchemes) throw new Error('Hero equip data not loaded yet');

    var T, getText, equipTable, buffRdTable, skillRdTable, heroTable, effectBuff;
    try {
      T = req('TableManager').TABLE._tableMap;
      getText = req('LocalManager').LOCAL.getText.bind(req('LocalManager').LOCAL);
      equipTable = T['hero_equip'];
      buffRdTable = T['hero_equip_buff_rd'];
      skillRdTable = T['hero_equip_skill_rd_library'];
      heroTable = T['hero'];
      effectBuff = T['effect_buff'];
    } catch (e) { throw new Error('Table manager not ready — wait a moment and retry'); }
    if (!equipTable) throw new Error('hero_equip table missing — game still warming up');

    var heroNameById = {};
    for (var hk in heroTable) {
      var h = heroTable[hk];
      if (h && typeof h === 'object' && h.name) heroNameById[h.id || +hk] = getText(h.name);
    }
    function resolveBuffName(buff_id) {
      if (!buff_id) return null;
      var e = effectBuff && effectBuff[buff_id];
      if (e && e.string) return getText(e.string);
      return 'buff_id:' + buff_id;
    }
    function getMaxFromBuffRd(rd) {
      if (!rd || !rd.buff_value_green1) return null;
      var parts = String(rd.buff_value_green1).split('|');
      var v = +parts[parts.length - 1].split(',')[1];
      return isFinite(v) ? v : null;
    }
    var SLOT_NAMES = { 1: 'Weapon', 2: 'Armor', 3: 'Accessory', 4: 'Helmet', 5: 'Device', 6: 'Boots' };
    var QUALITY_NAMES = { 2: 'Blue', 3: 'Purple', 4: 'Purple+', 5: 'Gold' };

    function processInfo(info) {
      if (info.type === 1) {
        var rd = buffRdTable && buffRdTable[info.templateId];
        var buff_id = rd ? rd.buff_id : null;
        var max = getMaxFromBuffRd(rd);
        return { type: 'stat', templateId: info.templateId, buff_id: buff_id, name: resolveBuffName(buff_id),
          rawValue: info.buffValue, rawEnhance: info.enhanceValue || 0,
          valuePercent: info.buffValue / 100, enhancePercent: (info.enhanceValue || 0) / 100,
          max: max != null ? max / 100 : null, rollPercent: max ? Math.round((info.buffValue / max) * 100) : null,
          enhanceShow: info.enhanceShow };
      } else if (info.type === 2) {
        var sk = skillRdTable && skillRdTable[info.templateId];
        // Compute star (0-indexed level) + starMax (3 for 1★ runes, 7 for 3★ runes)
        // by counting templateIds sharing the same `group` field and locating ours within them.
        var star = null, starMax = null;
        if (sk && sk.group != null) {
          var groupTemplates = [];
          for (var skKey in skillRdTable) {
            var entry = skillRdTable[skKey];
            if (entry && entry.group === sk.group) groupTemplates.push(+skKey);
          }
          groupTemplates.sort(function (a, b) { return a - b; });
          starMax = groupTemplates.length;
          var idx = groupTemplates.indexOf(info.templateId);
          if (idx >= 0) star = idx;
        }
        return { type: 'rune', templateId: info.templateId, skillId: sk ? sk.skill_id : null,
          name: sk && sk.name ? getText(sk.name) : null, desc: sk && sk.desc ? getText(sk.desc) : null,
          group: sk ? sk.group : null, buffValue: sk ? sk.buff_value : null,
          star: star, starMax: starMax,
          skillIcon: sk ? sk.skill_icon : null, smallIcon: sk ? sk.small_skill_icon : null };
      }
      return { type: 'unknown', templateId: info.templateId };
    }
    function computeRefinement(p) {
      var stats = p.filter(function (i) { return i.type === 'stat' && i.max != null; });
      var tv = stats.reduce(function (s, i) { return s + i.valuePercent; }, 0);
      var tm2 = stats.reduce(function (s, i) { return s + i.max; }, 0);
      return { totalValue: +tv.toFixed(2), totalMax: +tm2.toFixed(2), threshold70: +(tm2 * 0.7).toFixed(2),
        percent: tm2 > 0 ? Math.round((tv / tm2) * 100) : null, meetsThreshold: tv >= tm2 * 0.7 };
    }

    var schemes = [];
    HC._heroEquipSchemes.forEach(function (s, idx) {
      var resolved = s.rateSchemeId > 0 && s.name ? getText(s.name) : s.name;
      schemes.push({
        idx: s.idx != null ? s.idx : idx, name: resolved, rawName: s.name,
        heroId: s.heroId, heroName: s.heroId ? heroNameById[s.heroId] : null,
        uids: (s.ids || []).slice(),
        rateSchemeId: s.rateSchemeId, rateEndTime: s.rateEndTime,
        isEmpty: !s.ids || s.ids.length === 0
      });
    });
    schemes.sort(function (a, b) { return a.idx - b.idx; });

    var uidToSchemes = {};
    for (var si = 0; si < schemes.length; si++) {
      var sc = schemes[si];
      for (var ui = 0; ui < sc.uids.length; ui++) {
        var uid = sc.uids[ui];
        if (!uid || uid === '0') continue;
        (uidToSchemes[uid] = uidToSchemes[uid] || []).push({ idx: sc.idx, name: sc.name, heroId: sc.heroId, heroName: sc.heroName, posInScheme: ui });
      }
    }

    var allEquips = [];
    HC._heroEquipsMap.forEach(function (eq) { if (eq && eq.equipId) allEquips.push(eq); });

    var goldGear = [], equippedNonGold = [], presetOnly = [];
    var qHist = {};
    for (var ei = 0; ei < allEquips.length; ei++) {
      var e = allEquips[ei];
      var cfg = equipTable[e.equipId]; if (!cfg) continue;
      qHist[cfg.quality] = (qHist[cfg.quality] || 0) + 1;
      var isEquipped = !!(e.heroId && e.heroId > 0);
      var isGold = cfg.quality === 5;
      var inSchemes = uidToSchemes[e.id] || [];
      // Keep every gold piece, every equipped non-gold piece, plus any non-gold
      // unequipped piece that lives inside at least one preset. The third group
      // (presetOnly) covers swap-in candidates: a player who configured a
      // preset with purple gear should still see those pieces in the pool.
      if (!isGold && !isEquipped && inSchemes.length === 0) continue;

      var processed = (e.infos || []).map(processInfo);
      var enhanceParsed = {};
      for (var ek in (e.enhanceValue || {})) {
        enhanceParsed[ek] = { rawValue: e.enhanceValue[ek], percent: e.enhanceValue[ek] / 100, statName: resolveBuffName(+ek) };
      }
      var resolvedHeroId = e.heroId || (inSchemes[0] && inSchemes[0].heroId) || 0;
      var piece = {
        uid: e.id, equipId: e.equipId,
        slot: cfg.type, slotName: SLOT_NAMES[cfg.type],
        quality: cfg.quality, qualityName: QUALITY_NAMES[cfg.quality],
        level: e.level,
        heroId: resolvedHeroId,
        heroName: resolvedHeroId ? (heroNameById[resolvedHeroId] || ('Hero' + resolvedHeroId)) : null,
        directHeroId: e.heroId || 0,
        gearName: getText(cfg.name), icon: cfg.icon, bigIcon: cfg.big_icon,
        power: cfg.power, effectGroup: cfg.effect_group, skillLibrary: cfg.skill_library,
        scores: { land: e.landScore, navy: e.navyScore, air: e.airScore },
        baseBuff: cfg.equip_buff,
        buffs: processed,
        enhance: enhanceParsed, enhanceShow: e.enhanceShow,
        refinement: computeRefinement(processed),
        locked: e.state === 1, state: e.state, exp: e.exp,
        rateEquipId: e.rateEquipId, rateEndTime: e.rateEndTime,
        schemes: inSchemes
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
      distinctHeroes: (function () {
        var ids = {};
        for (var i = 0; i < goldGear.length; i++) if (goldGear[i].heroId) ids[goldGear[i].heroId] = 1;
        for (var j = 0; j < equippedNonGold.length; j++) if (equippedNonGold[j].heroId) ids[equippedNonGold[j].heroId] = 1;
        for (var k = 0; k < presetOnly.length; k++) if (presetOnly[k].heroId) ids[presetOnly[k].heroId] = 1;
        return Object.keys(ids).length;
      })(),
      qualityHistogram: qHist,
      goldBySlot: goldGear.reduce(function (acc, g) { acc[g.slotName] = (acc[g.slotName] || 0) + 1; return acc; }, {}),
      schemesCount: schemes.length,
      schemesActive: schemes.filter(function (s) { return !s.isEmpty; }).length,
      lockedCount: goldGear.filter(function (g) { return g.locked; }).length
        + equippedNonGold.filter(function (g) { return g.locked; }).length
        + presetOnly.filter(function (g) { return g.locked; }).length
    };

    var meta = { v: 1, ts: new Date().toISOString() };
    try {
      var UD = req('UserData').default;
      if (UD && UD.prototype && UD.prototype.__capturedUD) { /* not used */ }
    } catch (_) {}

    return { v: 1, meta: meta, summary: summary, schemes: schemes, goldGear: goldGear, equippedNonGold: equippedNonGold, presetOnly: presetOnly };
  }

  function copyAndReport(json) {
    var size = json.length;
    function done(prefix) {
      try { alert((prefix || 'Gear pool copied') + ' — ' + size + ' bytes\nPaste at 2864tw.com/armory-report-beta → Heroes & Gear → Titan Gear Pool → Update'); } catch (_) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(function () { done('Gear pool copied'); }).catch(function () { showOverlay(json, size, 'Gear pool'); });
    } else {
      showOverlay(json, size, 'Gear pool');
    }
  }

  function showOverlay(text, size, label) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'color:#fff;font-size:14px;margin-bottom:8px;';
    hdr.textContent = label + ' ready — ' + size + ' bytes. Tap Copy then paste at 2864tw.com';
    bg.appendChild(hdr);
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.cssText = 'flex:1;width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;min-height:200px;box-sizing:border-box;';
    bg.appendChild(ta);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'flex:1;padding:12px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    copyBtn.onclick = function () {
      function ok() { copyBtn.textContent = 'Copied!'; setTimeout(function () { try { document.body.removeChild(bg); } catch (_) {} }, 600); }
      function fail() { copyBtn.textContent = 'Long-press text + Copy'; }
      function execFallback() {
        try {
          ta.readOnly = false; ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
          var did = document.execCommand('copy'); ta.readOnly = true;
          if (did) ok(); else fail();
        } catch (_) { fail(); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(execFallback);
      } else { execFallback(); }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;';
    closeBtn.onclick = function () { document.body.removeChild(bg); };
    row.appendChild(copyBtn); row.appendChild(closeBtn); bg.appendChild(row);
    document.body.appendChild(bg);
  }

  function buildDiagnostic(err) {
    function safeKeys(o) { try { return o ? Object.keys(o).slice(0, 60) : null; } catch (_) { return null; } }
    var req = window.__require, hcOk = false, schemesLen = null, equipsSize = null;
    try {
      var HC = req('HeroEquipController').HeroEquipController.getInstance();
      hcOk = !!HC;
      if (HC && HC._heroEquipSchemes) schemesLen = HC._heroEquipSchemes.size;
      if (HC && HC._heroEquipsMap) equipsSize = HC._heroEquipsMap.size;
    } catch (_) {}
    return {
      kind: 'gear-pool-bookmarklet-diag', v: 1, ts: new Date().toISOString(),
      error: err && (err.message || String(err)),
      userAgent: navigator.userAgent.slice(0, 200),
      gameLoaded: !!window.__require,
      hcReady: hcOk,
      schemesLen: schemesLen,
      equipsSize: equipsSize
    };
  }

  function showDiagOverlay(diagText, summary) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'color:#f85149;font-size:14px;margin-bottom:6px;font-weight:600;';
    hdr.textContent = 'Gear pool dump failed: ' + summary;
    bg.appendChild(hdr);
    var sub = document.createElement('div');
    sub.style.cssText = 'color:#8b949e;font-size:12px;margin-bottom:8px;';
    sub.textContent = 'Tap Copy and paste in chat so we can debug. No personal info inside.';
    bg.appendChild(sub);
    var ta = document.createElement('textarea');
    ta.value = diagText; ta.readOnly = true;
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
        navigator.clipboard.writeText(diagText).then(ok).catch(function () { ta.readOnly = false; ta.focus(); ta.select(); try { document.execCommand('copy'); ok(); } catch (_) {} ta.readOnly = true; });
      } else { ta.readOnly = false; ta.focus(); ta.select(); try { document.execCommand('copy'); ok(); } catch (_) {} ta.readOnly = true; }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;';
    closeBtn.onclick = function () { document.body.removeChild(bg); };
    row.appendChild(copyBtn); row.appendChild(closeBtn); bg.appendChild(row);
    document.body.appendChild(bg);
  }

  try {
    var dump = buildDump();
    var json = JSON.stringify(dump);
    copyAndReport(json);
  } catch (e) {
    try { showDiagOverlay(JSON.stringify(buildDiagnostic(e), null, 2), e.message); }
    catch (e2) { try { alert('Dump failed: ' + e.message); } catch (_) {} }
  }
})();
