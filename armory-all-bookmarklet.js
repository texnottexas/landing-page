(function(){
  var cc = window.cc;
  function findByPath(p){ return cc.find(p); }
  function findAllComps(name){var out=[];function walk(n,d){if(!n||d>25)return;var cs=n._components||[];for(var i=0;i<cs.length;i++){var c=cs[i];var nm=(c&&(c.__classname__||(c.constructor&&c.constructor.name)))||'';if(nm===name)out.push(c);}for(var j=0;j<(n._children||[]).length;j++)walk(n._children[j],d+1);}walk(cc.find('UICanvas'),0);return out;}
  function findComp(n){var a=findAllComps(n);return a[0];}
  function clickBtnNode(node){
    if (!node) return false;
    var btn = node.getComponent(cc.Button);
    if (!btn || !btn.clickEvents || !btn.clickEvents.length) return false;
    btn.clickEvents.forEach(function(e){ try { e.emit([btn.node]); } catch(_){} });
    return true;
  }
  function delay(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // Inventory capture — patches UserData prototype to capture instance, then
  // dumps tabs by cycling getItemListByBagType.
  function captureInv(){
    var bagPanel = findByPath('UICanvas/PopLayer/UIFrameScreen/CONTENT/BagPanel') ||
                   findByPath('UICanvas/PopLayer/UIFrameScreenWithBottom/CONTENT/BagPanel');
    if (!bagPanel) return { _err: 'BagPanel not open. Tap Bag icon first or run with auto-open path.' };
    var req = window.__require;
    if (!req) return { _err: 'Game not loaded' };
    try {
      var UD = req('UserData').default;
      if (!UD.prototype.__patched) {
        var orig = UD.prototype.getItemListByBagType;
        UD.prototype.getItemListByBagType = function(t){ window.__capturedUD = this; return orig.call(this, t); };
        UD.prototype.__patched = true;
      }
      // Force a re-render so the patched method fires
      var bp = bagPanel.getComponent('BagPanel');
      if (bp) { try { bp.UpdateView(); } catch(_) {} }
    } catch(e) { return { _err: 'UD patch failed: ' + e.message }; }
    var ud = window.__capturedUD;
    if (!ud) return { _err: 'UD not captured (open any Bag tab once)' };
    var TYPES = [['item',1],['unit',2],['decor',3],['hero',4],['cpnt',5]];
    var tabs = {};
    TYPES.forEach(function(t){
      try {
        var list = ud.getItemListByBagType(t[1]) || [];
        tabs[t[0]] = list.map(function(it){
          var o = { id: it._itemId, a: it._amount };
          if (it._level != null && it._level > 0) o.l = it._level;
          if (it._GroupId && it._GroupId !== it._itemId) o.g = it._GroupId;
          return o;
        });
      } catch(e) { tabs[t[0]] = []; }
    });
    var heros = {};
    if (ud._heros) {
      Object.keys(ud._heros).forEach(function(k){
        var h = ud._heros[k];
        if (!h || !h._id) return;
        heros[h._id] = { lv: h._level, ml: h._maxLevel, st: h._star, q: h._quality, t: h._type, x: h._exp };
      });
    }
    var res = {};
    if (ud._resourceData) {
      ['_gold','_oila','_soil','_coin','_thor','_bountyMilitary','_adventureCoin','_csbRes','_kvkTaskCoin','_kvkMerit','_honor','_voucher','_freegold','_paidgold'].forEach(function(rk){
        var v = ud._resourceData[rk];
        if (v != null) res[rk] = v;
      });
    }
    return {
      v: 1,
      meta: { uid: ud._uid, lvl: ud._level, sid: ud._serverId, pwr: String(ud._armyPower), ts: new Date().toISOString() },
      resources: res, tabs: tabs, heros: heros
    };
  }

  // Bench beast capture — requires EnigmaBeastListPanel open.
  function captureBench(){
    var panel = findComp('EnigmaBeastListPanel');
    if (!panel) return { _err: 'EnigmaBeastListPanel not open. Open Enigma → Beast list.' };
    var arr = panel._data;
    if (!Array.isArray(arr)) return { _err: 'Beast list empty (still loading)' };
    var req = window.__require;
    var ItemDef = req('EnigmaBeastItem').default;
    var origUI = ItemDef.prototype.updateUI;
    var deployed = {};
    ItemDef.prototype.updateUI = function(e){ if (e && e.deploy && e.strId) deployed[e.strId] = true; };
    try {
      var fakeParent = new cc.Node('beastProbe');
      var rows = Math.ceil(arr.length / 4);
      for (var i = 0; i < rows; i++) {
        try { panel.tableCellAtIndex(fakeParent, i); } catch(_) {}
      }
      if (fakeParent.destroy) fakeParent.destroy();
    } finally {
      ItemDef.prototype.updateUI = origUI;
    }
    var minQ = 3;
    var out = [], skippedDeployed = 0;
    for (var i = 0; i < arr.length; i++) {
      var w = arr[i];
      if (!w || !w.data || !w._cfg) continue;
      var cfg = w._cfg;
      if ((cfg.quality || 0) < minQ) continue;
      if (deployed[w.strId]) { skippedDeployed++; continue; }
      var b = w.data;
      out.push({
        id: b.id != null ? String(b.id) : null,
        cfgId: b.cfgId, lv: b.level, st: b.star,
        pot: b.potential != null ? String(b.potential) : null,
        mb: b.mainBuff, bb: b.baseBuff || null,
        q: cfg.quality, type: cfg.type, fac: cfg.faction
      });
    }
    return {
      v: 1, ts: new Date().toISOString(),
      src: 'EnigmaBeastListPanel._data',
      total: arr.length, kept: out.length, skippedDeployed: skippedDeployed,
      beasts: out
    };
  }

  // Chip pool + HC-9999 equipped — requires MechaChipPanel open.
  async function captureChips(){
    var comp = findComp('MechaChipPanel');
    if (!comp) return { _err: 'MechaChipPanel not open. Open Mecha → any HT → Chip.' };
    var byId = {};
    for (var i = 0; i < 7; i++) {
      try { if (typeof comp.setBagTab === 'function') comp.setBagTab(i); } catch(_) {}
      await delay(220);
      var bag = comp._bagChip || [];
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
    var equipItems = findAllComps('MechaChipEquipItem');
    var msChips = [], seenMs = {};
    equipItems.forEach(function(ei){
      var d = ei._itemData;
      if (!d || d.mechaId !== 1008 || !d.id || seenMs[d.id]) return;
      seenMs[d.id] = true;
      var o = { c: d.chipId };
      o.iid = String(d.id);
      if (d.level) o.lv = d.level;
      o.m = 1008;
      if (d.rndAttrs) o.r = d.rndAttrs;
      if (d.otherRndAttrs && d.otherRndAttrs !== '{}') o.o = d.otherRndAttrs;
      if (d.refineTimes) o.rt = d.refineTimes;
      if (d.reservation) o.rs = d.reservation;
      o.slot = ei._pos != null ? ei._pos : 0;
      msChips.push(o);
    });
    var mp = findComp('MechaMainPanel');
    var msSrc = null;
    if (mp && mp._mechaList) {
      for (var k = 0; k < mp._mechaList.length; k++) {
        var m = mp._mechaList[k];
        if (m && m.mechaId === 1008) { msSrc = m; break; }
      }
    }
    var panelMs = comp._mechaDataId === 1008 ? comp._curSelectMechaInfo : null;
    var src = msSrc || panelMs;
    var arr = Object.keys(byId).map(function(k){ return byId[k]; });
    var out = {
      v: 1, ts: new Date().toISOString(),
      src: 'auto-bookmarklet',
      total: arr.length, chips: arr
    };
    if (src || msChips.length) {
      out.mothership = {};
      if (src) {
        out.mothership.p = src.power || 0;
        if (src.mechaServerData && src.mechaServerData.level) out.mothership.l = src.mechaServerData.level;
      }
      out.mothership.ep = msChips.length;
      if (msChips.length) out.mothership.chips = msChips;
    }
    return out;
  }

  function copy(text, summary){
    function done(prefix){ try { alert((prefix || 'Captured') + ' — ' + summary); } catch(_){} }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ done('Copied'); }).catch(function(){ showOverlay(text, summary); });
    } else { showOverlay(text, summary); }
  }
  function showOverlay(text, summary){
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'color:#fff;font-size:14px;margin-bottom:8px;';
    hdr.textContent = 'Armory dump ready — ' + summary + '. Tap Copy then paste at 2864tw.com';
    bg.appendChild(hdr);
    var ta = document.createElement('textarea');
    ta.value = text; ta.readOnly = true;
    ta.style.cssText = 'flex:1;width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;min-height:200px;box-sizing:border-box;';
    bg.appendChild(ta);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'flex:1;padding:12px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    copyBtn.onclick = function(){
      function ok(){ copyBtn.textContent = 'Copied!'; setTimeout(function(){ try { document.body.removeChild(bg); } catch(_) {} }, 600); }
      function fail(){ copyBtn.textContent = 'Long-press text + Copy'; }
      function fb(){ try { ta.readOnly = false; ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); var did = document.execCommand('copy'); ta.readOnly = true; if (did) ok(); else fail(); } catch(_) { fail(); } }
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok).catch(fb); } else { fb(); }
    };
    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding:12px 18px;background:transparent;color:#fff;border:1px solid #30363d;border-radius:6px;font-size:14px;';
    closeBtn.onclick = function(){ document.body.removeChild(bg); };
    row.appendChild(copyBtn); row.appendChild(closeBtn);
    bg.appendChild(row);
    document.body.appendChild(bg);
  }

  // Auto-nav stage 1: Inventory (try to auto-open BagPanel via btnBag)
  async function autoInv(){
    var bagPanel = findByPath('UICanvas/PopLayer/UIFrameScreen/CONTENT/BagPanel') ||
                   findByPath('UICanvas/PopLayer/UIFrameScreenWithBottom/CONTENT/BagPanel');
    var openedHere = false;
    if (!bagPanel) {
      var btn = findByPath('UICanvas/MainUIWrapper/NMainUI/RightBottom/btnBag');
      if (btn && clickBtnNode(btn)) {
        openedHere = true;
        await delay(1000);
      }
    }
    var inv = captureInv();
    return { inv: inv, openedHere: openedHere };
  }

  (async function(){
    try {
      var result = { v: 1, ts: new Date().toISOString(), src: 'armory-all-bookmarklet' };
      var sections = [];

      // 1. Inventory (with auto-open Bag)
      var invRes = await autoInv();
      if (invRes.inv && !invRes.inv._err) {
        result.inv = invRes.inv;
        sections.push('inv:' + Object.keys(invRes.inv.tabs || {}).length + 'tabs');
      } else {
        result.invError = invRes.inv && invRes.inv._err || 'unknown';
      }

      // 2. Bench beasts (only if list panel currently in scene)
      var bench = captureBench();
      if (bench && !bench._err) {
        result.bench = bench;
        sections.push('bench:' + bench.kept);
      } else {
        result.benchError = bench && bench._err;
      }

      // 3. Chips + HC-9999 (only if chip panel in scene)
      var chips = await captureChips();
      if (chips && !chips._err) {
        result.chips = chips;
        var msTip = chips.mothership ? (' HC-9999:' + (chips.mothership.ep || 0)) : '';
        sections.push('chips:' + chips.total + msTip);
      } else {
        result.chipsError = chips && chips._err;
      }

      var json = JSON.stringify(result);
      var summary = (sections.length ? sections.join(' · ') : 'NOTHING captured') + ' — ' + json.length + ' bytes';
      copy(json, summary);
    } catch (e) {
      try { alert('Armory dump failed: ' + e.message); } catch(_) {}
    }
  })();
})();
