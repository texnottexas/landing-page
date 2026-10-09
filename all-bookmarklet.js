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
// ─── Armory sync (Tex, 2026-10-08) ───────────────────────────────────────
// After a snapshot, sign in with the worker using the game's own UID and upload every section the armory's paste
// import would (same kinds, same clean-up, same 1 MB cap), so the armory updates without copy and paste. The worker
// checks everything again (roster, schema, UID strip). Plain functions: node tests require this file for them.
var __snapSync = (function () {
  var SECTIONS = [
    { field: 'inventory', kind: 'inv', ts: 'meta', label: 'Inventory' },
    { field: 'beasts', kind: 'bench', ts: 'top', label: 'Beasts' },
    { field: 'chips', kind: 'chips', ts: 'top', label: 'Chips' },
    { field: 'gear', kind: 'gear', ts: 'meta', label: 'Titan gear' },
    { field: 'heroes', kind: 'heroes', ts: 'top', label: 'Heroes' },
    { field: 'formation', kind: 'formation', ts: 'top', label: 'Formation' },
    { field: 'enigmaState', kind: 'enigma', ts: 'top', label: 'Beast fields' },
    { field: 'decorations', kind: 'decor', ts: 'top', label: 'Decorations' },
    { field: 'baseSkin', kind: 'skin', ts: 'top', label: 'Base skin' }
  ];
  var MAX_BYTES = 1024 * 1024;
  // A copy of one section, cleaned the way the armory cleans a pasted one (the dump itself stays whole for Copy).
  function prepare(spec, section, nowIso) {
    var p = JSON.parse(JSON.stringify(section));
    if (p && p.meta && p.meta.uid != null) delete p.meta.uid;
    if (spec.kind === 'inv' && p && p.resources && typeof p.resources === 'object') { delete p.resources._paidgold; delete p.resources._payCNYTotal; }
    if (spec.ts === 'meta') { if (!p.meta) p.meta = {}; if (!p.meta.ts) p.meta.ts = nowIso; }
    else if (!p.ts) p.ts = nowIso;
    return p;
  }
  async function readJson(r) { try { return await r.json(); } catch (e) { return null; } }
  // Signs in with the game's UID; → { token } | { notMember:true } | { token:null }
  async function getToken(uid, o) {
    try {
      var hs = await o.fetch(o.worker + '/supplement/handshake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: uid }) });
      if (hs.status === 403) return { notMember: true, token: null };
      var hj = hs.ok ? await readJson(hs) : null;
      return { token: (hj && hj.token) || null };
    } catch (e) { return { token: null }; }
  }
  // o = { fetch, worker, uid, now? } → { state: 'done', results:[{kind,label,status,error?}] } | { state: 'not-member'|'error'|'no-uid' }
  async function sendToArmory(dump, o) {
    var uid = String(o.uid || '').trim();
    if (!/^[0-9]{5,20}$/.test(uid)) return { state: 'no-uid' };
    var nowIso = o.now || new Date().toISOString(), token = null;
    var hsr = await getToken(uid, o);
    if (hsr.notMember) return { state: 'not-member' };
    token = hsr.token;
    if (!token) return { state: 'error' };
    var results = [];
    for (var i = 0; i < SECTIONS.length; i++) {
      var spec = SECTIONS[i], section = dump && dump[spec.field];
      if (!section) continue;
      var res = { kind: spec.kind, label: spec.label };
      var body = JSON.stringify({ kind: spec.kind, json: prepare(spec, section, nowIso) });
      if (body.length > MAX_BYTES) { res.status = 'too-large'; results.push(res); continue; }
      try {
        var r = await o.fetch(o.worker + '/supplement/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: body });
        if (r.ok) res.status = 'ok';
        else { var ej = await readJson(r); res.status = 'failed'; res.error = (ej && ej.error) || ('HTTP ' + r.status); }
      } catch (e) { res.status = 'failed'; res.error = 'network'; }
      results.push(res);
    }
    return { state: 'done', results: results };
  }
  function syncText(r) {
    if (r.state === 'not-member') return { tone: 'mute', text: "Not sent: this account isn't on the Server 2864 roster. Copy JSON still works." };
    if (r.state === 'no-uid') return { tone: 'bad', text: "Couldn't read your account ID. Use Copy JSON below instead." };
    if (r.state !== 'done') return { tone: 'bad', text: "Couldn't reach your armory. Use Copy JSON below instead." };
    var ok = r.results.filter(function (x) { return x.status === 'ok'; }).map(function (x) { return x.label; });
    var bad = r.results.filter(function (x) { return x.status !== 'ok'; }).map(function (x) { return x.label; });
    if (!ok.length && !bad.length) return { tone: 'mute', text: 'Nothing to send to your armory.' };
    if (!ok.length) return { tone: 'bad', text: 'Armory not updated. Not saved: ' + bad.join(', ') + '.' };
    return { tone: bad.length ? 'warn' : 'ok', text: 'Armory updated: ' + ok.join(', ') + '.' + (bad.length ? ' Not saved: ' + bad.join(', ') + '.' : '') };
  }
  // ── "Set up my armory report" from the latest Time Clash attacks (Tex, 2026-10-08) ──
  // Only our attacks count: a defense report can't exist without an attack first. The newest report for each
  // different march (3-hero set) is kept, up to the chosen number (max 6); at most 20 attacks are read.
  var SETUP_MAX = 6, SETUP_SCAN = 20, SETUP_DEVICE = 'ops-snapshot';
  function attackLogs(logs) {
    return (Array.isArray(logs) ? logs : []).filter(function (l) { return l && l.isAttacker && l.reportId; })
      .sort(function (a, b) { return (Number(b.time) || 0) - (Number(a.time) || 0); });
  }
  function reportUrl(id) { id = String(id); return 'https://fight-report-va.oss-accelerate.aliyuncs.com/prod/' + id.slice(0, 4) + '/' + id + '.json'; }
  function heroSetOf(report, uid) {
    var b = report && (report.battle || report), hit = null;
    ['attacker', 'defender'].forEach(function (side) {
      ((b && b[side] && b[side].players) || []).forEach(function (p) {
        if (!hit && p && String(p.uid) === String(uid)) {
          hit = (p.heroList || []).map(function (h) { return Number(h && (h.heroId || h.id)); }).filter(Boolean).sort(function (x, y) { return x - y; });
        }
      });
    });
    return hit && hit.length ? hit : null;
  }
  // o = { fetchReport(id) → report json, uid, max } → { picked:[{reportId, heroes, time}], attacks, scanned }
  async function pickReports(logs, o) {
    var max = Math.max(1, Math.min(SETUP_MAX, Number(o.max) || SETUP_MAX)), list = attackLogs(logs), seen = {}, picked = [], scanned = 0;
    for (var i = 0; i < list.length && picked.length < max && scanned < SETUP_SCAN; i++) {
      scanned++;
      var rep = null;
      try { rep = await o.fetchReport(String(list[i].reportId)); } catch (e) { rep = null; }
      var set = heroSetOf(rep, o.uid);
      if (!set || seen[set.join('-')]) continue;
      seen[set.join('-')] = 1;
      picked.push({ reportId: String(list[i].reportId), heroes: set, time: Number(list[i].time) || 0 });
    }
    return { picked: picked, attacks: list.length, scanned: scanned };
  }
  function parseLogAnswer(e) {
    if (!e || e.s !== 0) return null;
    try { var d = typeof e.d === 'string' ? JSON.parse(e.d) : e.d; return d && Array.isArray(d.logs) ? d.logs : null; } catch (x) { return null; }
  }
  // Saves the picked reports as this player's armory setup (one per Snapshot device, so reruns update the same code).
  async function saveReportSetup(picked, o) {
    var body = { siteKey: o.siteKey, playerName: o.name, deviceId: SETUP_DEVICE, reportIds: picked.map(function (p) { return p.reportId; }).join(','),
      marchGroups: picked.map(function (p, i) { return { name: 'March ' + (i + 1), heroIds: p.heroes }; }) };
    var headers = { 'Content-Type': 'application/json' };
    if (o.token) headers.Authorization = 'Bearer ' + o.token;   // owner save: listed with the player's other reports
    try {
      var r = await o.fetch(o.worker + '/report-config', { method: 'POST', headers: headers, body: JSON.stringify(body) });
      var j = await readJson(r);
      return r.ok && j && j.ok && j.shortcode ? { ok: true, code: String(j.shortcode) } : { ok: false, error: (j && j.error) || ('HTTP ' + r.status) };
    } catch (e) { return { ok: false, error: 'network' }; }
  }
  // Does this player already have an armory report? (Tex, 2026-10-09) The armory only shows synced data once a
  // report exists, so a new player is led to Set up first. → { ok:true, configs:[...] } | { ok:false }: a look-up
  // that fails is "unknown", never "no report".
  async function listReports(siteKey, o) {
    if (!/^[0-9a-f]{16}$/.test(String(siteKey || ''))) return { ok: false };
    try {
      var r = await o.fetch(o.worker + '/report-configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteKey: siteKey, deviceId: SETUP_DEVICE }) });
      var j = r.ok ? await readJson(r) : null;
      return j && j.ok && Array.isArray(j.configs) ? { ok: true, configs: j.configs } : { ok: false };
    } catch (e) { return { ok: false }; }
  }
  function cardMode(lookup) { return !lookup || !lookup.ok ? 'unknown' : lookup.configs.length ? 'existing' : 'new'; }
  function latestCode(configs) {
    var best = '', bestT = -1;
    (configs || []).forEach(function (c) {
      var t = Date.parse((c && (c.updatedAt || c.date)) || '') || 0;
      if (c && c.shortcode && t > bestT) { bestT = t; best = String(c.shortcode); }
    });
    return best;
  }
  function newPlayerText(r) {
    var ok = r.results.filter(function (x) { return x.status === 'ok'; }).map(function (x) { return x.label; });
    var bad = r.results.filter(function (x) { return x.status !== 'ok'; }).map(function (x) { return x.label; });
    if (!ok.length) return syncText(r);
    return { tone: bad.length ? 'warn' : 'ok', text: 'Snapshot saved (' + ok.join(', ') + ').' + (bad.length ? ' Not saved: ' + bad.join(', ') + '.' : '') + ' Set up your armory report below to see it.' };
  }
  function setupText(r, refresh) {
    if (r.state === 'done') {
      var n = r.picked.length, verb = refresh ? 'refreshed' : 'set up';
      var text = n === 1 ? 'Armory report ' + verb + ' with your latest march.' : 'Armory report ' + verb + ' with your latest ' + n + ' different marches.';
      if (r.asked > n) text += ' You asked for ' + r.asked + ', but your recent Time Clash attacks only had ' + n + (n === 1 ? ' march.' : ' different marches.');
      return { tone: 'ok', text: text };
    }
    if (r.state === 'no-attacks') return { tone: 'warn', text: 'No Time Clash attacks found. Fight at least one Time Clash battle first.' };
    if (r.state === 'unreadable') return { tone: 'bad', text: "Couldn't read your Time Clash reports. Try again later." };
    if (r.state === 'no-log') return { tone: 'bad', text: "Couldn't get your Time Clash reports from the game. Try again." };
    return { tone: 'bad', text: "Couldn't save the report setup. Try again later." };
  }
  return { SECTIONS: SECTIONS, MAX_BYTES: MAX_BYTES, prepare: prepare, sendToArmory: sendToArmory, syncText: syncText,
    SETUP_MAX: SETUP_MAX, attackLogs: attackLogs, reportUrl: reportUrl, heroSetOf: heroSetOf, pickReports: pickReports,
    parseLogAnswer: parseLogAnswer, saveReportSetup: saveReportSetup, getToken: getToken, setupText: setupText,
    listReports: listReports, cardMode: cardMode, latestCode: latestCode, newPlayerText: newPlayerText };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = __snapSync;

(function () {
  if (typeof window === 'undefined') return;           // node tests load this file for __snapSync only
  function buildDump(stepHook) {
    var req = window.__require;
    if (!req) throw new Error('Game not loaded. Wait for the game to finish loading, then retry');
    var cc = window.cc;
    var UIMgr;
    try { UIMgr = req('UIManager').default.Instance(); }
    catch (e) { throw new Error('UIManager not ready. Wait a moment and retry'); }
    var UIDataInfo;
    try { UIDataInfo = req('UIDataInfo').UIDataInfo; }
    catch (e) { throw new Error('UIDataInfo not ready. Wait a moment and retry'); }

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

    // ─── Bench beasts (Q4+ purple/gold unplaced) ─────────────────────────
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
        // Purple (Q4) + Gold (Q5) only. Q3 (blue) and below were dropped
        // because heavy spenders carry 1000-1400+ Q3+ bench beasts, which
        // overflowed the receiver's 800-beast cap on the enigmaState section
        // and bloated localStorage / KV payloads. Lower-quality beasts are
        // not real platform candidates anyway, so the optimizer doesn't miss
        // anything by ignoring them.
        if ((w._cfg.quality || 0) < 4) continue;
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
        throw new Error('Hero equip data did not load. Try opening Heroes once in game, then run it again');
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
        // buff_value_rd is the roll range "min,max" the game rolls within (gold 600/3000/300,
        // lower tiers 0.6/0.4/0.2x). The last segment of buff_value_green1 is half of that.
        if (!rd) return null;
        var src = rd.buff_value_rd != null ? String(rd.buff_value_rd) : null;
        if (src) {
          var rp = src.split('|');
          var rv = +rp[rp.length - 1].split(',')[1];
          if (isFinite(rv) && rv > 0) return rv;
        }
        return null; // the report then falls back to its own per-template maximum
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
          // The table carries the real star and star_max on each row; `group` is the 36-entry
          // slot catalogue, so counting siblings in it gives nonsense (stars 0..11 of 8..17).
          if (sk && isFinite(+sk.star_max) && sk.star != null && isFinite(+sk.star)) {
            star = +sk.star; starMax = +sk.star_max;
          } else if (sk && sk.group != null) {
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
        if (h._awakenSkills && typeof h._awakenSkills === 'object') {
          var aws = {};
          Object.keys(h._awakenSkills).forEach(function (k) {
            var lv = h._awakenSkills[k] && h._awakenSkills[k].level;
            if (lv) aws[k] = lv;            // level only; drop exp
          });
          if (Object.keys(aws).length) o.aws = aws;
        }
        if (h._awakenPower)   o.awp = h._awakenPower;
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
        // Keep only purple (Q4) + gold (Q5), matching extractBeasts. Blue
        // and below would bloat the supplement payload for no real optimizer
        // value (the receiver caps the array at the in-game max of 5000).
        var q = (w._cfg && w._cfg.quality != null) ? w._cfg.quality : (w.data && w.data.quality);
        if (q != null && q < 4) continue;
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
      // The receiver validates totalExp with Number.isInteger and 400s on
      // anything else. A plain null-check let a float / NaN / string through
      // on some accounts, which surfaced as "schema: totalExp bad" on an
      // otherwise-clean import (GH #123), so coerce to a whole number here.
      var rawExp = Math.round(Number(ud._decorationTotalExp));
      return {
        v: 1, ts: new Date().toISOString(),
        active: active,
        suits: suits,
        totalExp: isFinite(rawExp) ? rawExp : 0
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

  // Builds the human-readable "summary" line (Y inv · N chips · …) from a dump + JSON byte size.
  function summarizeDump(dump, jsonLength) {
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
    var summary = sections.join(' · ') + ' · ' + fmtBytes(jsonLength);
    if (dump.errors && dump.errors.length) summary += ' · ' + dump.errors.length + ' section(s) failed';
    return summary;
  }

  // The finished card: summary, armory sync (filled in by syncToArmory), report setup, and Copy JSON as a backup.
  // The JSON only appears on screen when the clipboard refuses it, pre-selected for a manual copy.
  function attachCopyUI(overlay, dump) {
    var bg = overlay.root;
    var currentText = JSON.stringify(dump);
    bg.style.alignItems = 'center';
    var card = document.createElement('div');
    card.id = 'snap-card';
    card.style.cssText = 'width:100%;max-width:440px;box-sizing:border-box;max-height:100%;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:16px;';
    bg.appendChild(card);
    card.appendChild(overlay.hdr);
    card.appendChild(overlay.sub);
    overlay.sub.textContent = summarizeDump(dump, currentText.length);
    var slot = document.createElement('div');
    slot.id = 'snap-slot';
    card.appendChild(slot);
    var status = document.createElement('div');
    status.id = 'snap-status';
    status.style.cssText = 'color:#8b949e;font-size:12px;margin-top:8px;text-align:center;min-height:0;';
    card.appendChild(status);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    var copyBtn = document.createElement('button');
    copyBtn.id = 'snap-copy';
    copyBtn.textContent = 'Copy JSON (backup)';
    copyBtn.style.cssText = 'flex:1;min-height:44px;padding:0 12px;background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;font-size:13px;';
    var closeBtn = document.createElement('button');
    closeBtn.id = 'snap-close';
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'flex:1;min-height:44px;padding:0 12px;background:#238636;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    closeBtn.onclick = function () { try { bg.parentNode.removeChild(bg); } catch (_) {} };
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    card.appendChild(row);
    var shownTa = null;
    function showJson() {                                   // only when the clipboard refused it
      if (!shownTa) {
        shownTa = document.createElement('textarea');
        shownTa.readOnly = true;
        shownTa.value = currentText;
        shownTa.style.cssText = 'width:100%;box-sizing:border-box;margin-top:10px;min-height:120px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;';
        card.insertBefore(shownTa, row);
      }
      try { shownTa.focus(); shownTa.select(); shownTa.setSelectionRange(0, currentText.length); } catch (_) {}
    }
    function ok() {
      copyBtn.textContent = 'Copied';
      copyBtn.style.color = '#3fb950'; copyBtn.style.borderColor = '#3fb950';
      status.style.color = '#8b949e';
      status.textContent = 'Copied. You only need this if the armory did not update.';
    }
    function fail(reason) {
      copyBtn.textContent = 'Copy failed';
      copyBtn.style.color = '#f85149'; copyBtn.style.borderColor = '#f85149';
      status.style.color = '#f85149';
      status.textContent = "Couldn't copy" + (reason ? ' (' + reason + ')' : '') + '. Long-press the box below, Select All, then Copy.';
      showJson();
    }
    function execFallback() {
      var ta = document.createElement('textarea');
      ta.value = currentText;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      try {
        ta.focus(); ta.select(); ta.setSelectionRange(0, currentText.length);
        var did = document.execCommand('copy');
        if (did) ok(); else fail('blocked');
      } catch (e) { fail(e && e.message); }
      try { document.body.removeChild(ta); } catch (_) {}
    }
    copyBtn.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(currentText).then(ok).catch(execFallback);
      else execFallback();
    };
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

  // Sends the snapshot straight to the player's armory (see __snapSync at the top), shown above the JSON box.
  var SNAP_WORKER = window.__SNAP_WORKER || 'https://push-worker.27tb8s6fct.workers.dev';
  function gameUid() { try { var u = window.__require('DataCenter').DATA.UserData; return String(u.StrUid || u._uid || ''); } catch (e) { return ''; } }
  function syncToArmory(overlay, dump) {
    var box = document.createElement('div');
    box.id = 'snap-sync';
    box.style.cssText = 'margin:0 0 10px;padding:10px 12px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#8b949e;font-size:13px;line-height:1.4;';
    box.textContent = 'Sending to your armory...';
    var slot = document.getElementById('snap-slot');
    if (slot) slot.appendChild(box); else overlay.root.appendChild(box);
    var uid = (dump.meta && dump.meta.uid) || gameUid();
    function paint(t) {
      var color = { ok: '#3fb950', warn: '#d29922', bad: '#f85149', mute: '#8b949e' }[t.tone] || '#8b949e';
      box.textContent = t.text; box.style.color = color; box.style.borderColor = t.tone === 'mute' ? '#30363d' : color;
    }
    __snapSync.sendToArmory(dump, { fetch: window.fetch.bind(window), worker: SNAP_WORKER, uid: uid }).then(function (r) {
      var t = __snapSync.syncText(r);
      if (t.tone !== 'ok' && t.tone !== 'warn') { paint(t); return; }
      // Does the player have an armory report yet? A new player is led to Set up: the armory shows the snapshot
      // only once a report exists (Tex, 2026-10-09). If the list can't be read, the card stays as it was.
      return siteKeyOf(uid).then(function (sk) { return __snapSync.listReports(sk, { fetch: window.fetch.bind(window), worker: SNAP_WORKER }); })
        .catch(function () { return { ok: false }; })
        .then(function (lookup) {
          var mode = __snapSync.cardMode(lookup);
          if (mode === 'new') { paint(__snapSync.newPlayerText(r)); addReportSetup(box, uid, 'setup'); return; }
          paint(t);
          var a = document.createElement('a');
          a.id = 'snap-open';
          a.textContent = 'Open my armory'; a.href = armoryLink(mode === 'existing' ? __snapSync.latestCode(lookup.configs) : savedCode(uid));
          a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.style.cssText = 'display:inline-block;margin-left:8px;color:#79c0ff;font-weight:600;';
          box.appendChild(a);
          addReportSetup(box, uid, mode === 'existing' ? 'refresh' : 'setup');
        });
    }, function () { box.textContent = "Couldn't reach your armory. Use Copy JSON below instead."; box.style.color = '#f85149'; });
  }

  // "Set up my armory report": the newest report for each different march among the player's latest Time Clash
  // attacks, saved as their armory setup (/report-config). The log is the game's own request (the one its report
  // list sends), on the shared Ops request clock.
  function armoryLink(code) { return 'https://2864tw.com/armory-report.html' + (code ? '?code=' + encodeURIComponent(code) : ''); }
  function savedCode(uid) { try { return localStorage.getItem('snap_report_code_v1_' + uid) || ''; } catch (e) { return ''; } }
  function opsPace() {
    var P = window.__opsPace || (window.__opsPace = { at: 0 }), gap = 1100 + Math.floor(Math.random() * 200);
    return new Promise(function (resolve) {
      (function check() { var w = P.at + gap - Date.now(); if (w <= 0) { P.at = Date.now(); resolve(); } else setTimeout(check, Math.min(w, 1000)); })();
    });
  }
  function readTimeClashLog() {
    return new Promise(function (resolve) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 8000);
      try {
        var R = window.__require('RequestId').RequestId, rid = (R && R.Get_Colosseum_Self_Log) || 6413;
        window.__require('NetMgr').NET.send(rid, {}, {}, function (e) { if (done) return; done = true; clearTimeout(to); resolve(__snapSync.parseLogAnswer(e)); });
      } catch (e) { done = true; clearTimeout(to); resolve(null); }
    });
  }
  function siteKeyOf(uid) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(uid))).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 16);
    });
  }
  // mode 'setup': the main step (green); 'refresh': the player has a report, so a smaller outlined option.
  function addReportSetup(after, uid, mode) {
    var refresh = mode === 'refresh';
    var row = document.createElement('div');
    row.id = 'snap-setup';
    row.style.cssText = 'margin:0 0 10px;padding:10px 12px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#e6edf3;font-size:13px;line-height:1.5;';
    var lead = document.createElement('div');
    lead.textContent = (refresh ? 'Refresh' : 'Set up') + ' my armory report from my latest Time Clash attacks:';
    row.appendChild(lead);
    var line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;';
    var sel = document.createElement('select');
    sel.id = 'snap-setup-n';
    sel.setAttribute('aria-label', 'How many different marches');
    sel.style.cssText = 'min-height:40px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-size:14px;';
    for (var n = 1; n <= __snapSync.SETUP_MAX; n++) { var op = document.createElement('option'); op.value = String(n); op.textContent = n === 1 ? '1 march' : 'up to ' + n + ' marches'; sel.appendChild(op); }
    sel.value = String(__snapSync.SETUP_MAX);
    var go = document.createElement('button');
    go.id = 'snap-setup-go'; go.type = 'button'; go.textContent = refresh ? 'Refresh' : 'Set up';
    go.style.cssText = refresh
      ? 'min-height:40px;padding:0 16px;background:transparent;color:#79c0ff;border:1px solid #30363d;border-radius:6px;font-weight:600;font-size:14px;'
      : 'min-height:40px;padding:0 16px;background:#238636;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:14px;';
    line.appendChild(sel); line.appendChild(go); row.appendChild(line);
    var msg = document.createElement('div');
    msg.id = 'snap-setup-msg';
    msg.style.cssText = 'margin-top:6px;color:#8b949e;font-size:12px;';
    row.appendChild(msg);
    after.parentNode.insertBefore(row, after.nextSibling);
    go.onclick = function () {
      go.disabled = true; sel.disabled = true; msg.style.color = '#8b949e'; msg.textContent = 'Reading your Time Clash reports...';
      runReportSetup(uid, Number(sel.value)).then(function (r) {
        var t = __snapSync.setupText(r, refresh), color = { ok: '#3fb950', warn: '#d29922', bad: '#f85149' }[t.tone] || '#8b949e';
        msg.textContent = t.text; msg.style.color = color;
        if (r.state === 'done') {
          var a = document.createElement('a');
          a.textContent = 'Open my armory'; a.href = armoryLink(r.code); a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.style.cssText = 'display:inline-block;margin-left:8px;color:#79c0ff;font-weight:600;';
          msg.appendChild(a);
          var top = document.getElementById('snap-open'); if (top) top.href = armoryLink(r.code);
        } else { go.disabled = false; sel.disabled = false; }
      });
    };
  }
  async function runReportSetup(uid, max) {
    uid = gameUid() || String(uid);                       // the game's own string UID: what report players carry
    await opsPace();
    var logs = await readTimeClashLog();
    if (!logs) return { state: 'no-log' };
    if (!__snapSync.attackLogs(logs).length) return { state: 'no-attacks' };
    var pick = await __snapSync.pickReports(logs, { uid: uid, max: max, fetchReport: function (id) {
      return fetch(__snapSync.reportUrl(id)).then(function (r) { return r.ok ? r.json() : null; });
    } });
    if (!pick.picked.length) return { state: 'unreadable' };
    var name = ''; try { name = String(window.__require('DataCenter').DATA.UserData.Name || ''); } catch (e) {}
    var sk = await siteKeyOf(uid);
    var tk = await __snapSync.getToken(uid, { fetch: window.fetch.bind(window), worker: SNAP_WORKER });
    var saved = await __snapSync.saveReportSetup(pick.picked, { fetch: window.fetch.bind(window), worker: SNAP_WORKER, siteKey: sk, name: name, token: tk.token });
    if (!saved.ok) return { state: 'save-failed', error: saved.error };
    try { localStorage.setItem('snap_report_code_v1_' + uid, saved.code); } catch (e) {}
    return { state: 'done', picked: pick.picked, code: saved.code, asked: max };
  }

  // ─── Entry point ────────────────────────────────────────────────────────
  var overlay;
  try {
    overlay = buildOverlay();
  } catch (_) { /* DOM somehow not ready; bail without overlay */ }

  // __SNAP_TEST_DUMP: browser tests hand in a finished snapshot instead of reading a game (test/snapshot-card.e2e.test.js)
  (window.__SNAP_TEST_DUMP ? Promise.resolve(window.__SNAP_TEST_DUMP) : buildDump(overlay && overlay.setStep)).then(function (dump) {
    // Wrap the success-path UI work in its own try so any rendering glitch
    // doesn't fall through to .catch() (which removes the overlay — the
    // bug behind the iOS "popup vanished after ~1s" report). Even if the
    // UI fails to render, the snapshot itself is already in `dump`, so we
    // fall back to alert with the JSON exposed via window.__snapshot.
    try {
      if (overlay) {
        overlay.setHeader(dump.errors && dump.errors.length ? 'Partial snapshot' : 'Snapshot ready');
        overlay.setHeaderColor(dump.errors && dump.errors.length ? '#d29922' : '#3fb950');
        attachCopyUI(overlay, dump);
        syncToArmory(overlay, dump);
      } else {
        var jsonAlt = JSON.stringify(dump);
        try { alert('Snapshot: ' + summarizeDump(dump, jsonAlt.length)); } catch (_) {}
      }
    } catch (uiErr) {
      // Last-ditch surface — still expose the JSON so the run isn't wasted
      try { window.__snapshot = JSON.stringify(dump); } catch (_) {}
      try {
        if (overlay) overlay.setHeader('UI render failed. JSON at window.__snapshot');
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
