/* Class Talent (Profession) Reset + Retrain bookmarklet — Combat Elite & Mechanical Master
 * Every command verified live 2026-07-23 on both a CE and an MM account (both fully restored).
 *
 * Flow: read + BACKUP (all talent branches + base defense + CE hero extra skill slots)
 *   -> confirm gate -> buy voucher if needed (5000 gems) -> reset
 *   -> retrain EVERY branch back to backup (5-min ITEMS only) -> reapply base defense
 *   -> reapply hero extra skill slots (CE only) -> verify.
 *
 * HARD RULE: never spend gems on speedups. Speedup = item 550001 via cmd 1316 isUseGold:0 ONLY.
 *            Learn = useGold:0 ONLY. The only intentional gem spend is the 5000-gem voucher,
 *            and only after you press Confirm.
 */
(function () {
  'use strict';
  var C = {
    VOUCHER: 1600031, SPEEDUP: 550001, VOUCHER_SHOP: 100014, VOUCHER_COST: 5000,
    RESET_TAB: 1,
    CMD: { READ: 1318, LEARN: 1314, RESET: 1315, SPEED: 1316, SAVE_DEF: 1321, EQUIP: 897, BUY: 818, SWITCH_PRESET: 1345 }
  };
  var req = window.__require, NET, PC, ud, HC, DATA;
  function resolve() {
    NET = req('NetMgr').NET; DATA = req('DataCenter').DATA; ud = DATA.UserData;
    PC = req('ProfessionController').default.Instance; HC = req('HeroController').HeroController.getInstance();
  }
  var groupOf = id => Math.floor(id / 1000) * 1000, offOf = id => id - groupOf(id);
  var clone = o => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } };
  var delay = ms => new Promise(f => setTimeout(f, ms));
  function send(cmd, p) { return new Promise(res => { var d = false; NET.send(cmd, p, {}, function (t) { if (d) return; d = true; var o; try { o = JSON.parse(t.d); } catch (e) { o = (t && typeof t.d === 'object') ? t.d : t; } res(o); }); setTimeout(() => { if (!d) { d = true; res(null); } }, 6000); }); }
  function refresh() { return new Promise(res => { var done = false; var fin = function () { if (done) return; done = true; res(); }; try { PC.initLearnTalentData(fin); } catch (e) { fin(); } setTimeout(fin, 4500); }); }
  function profName() { return PC._professionFocusTalentId === 72002 ? 'Mechanical Master' : 'Combat Elite'; }
  function playerName() { try { return ud._playerInfoData._playerInfo._data.username || ''; } catch (e) { return ''; } }

  // ---- resume (localStorage on the game origin; survives a crash mid-run) ----
  var RESUME_KEY = 'cr_resume_v1';
  function saveResume(o) { try { localStorage.setItem(RESUME_KEY, JSON.stringify(o)); } catch (e) {} }
  function loadResume() { try { return JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch (e) { return null; } }
  function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch (e) {} }

  // ---- reads ----
  function readState() {
    var extra = [];
    HC.getHaveHeroList().forEach(function (h) {
      [[h._firstBuffList, 1], [h._secondBuffList, 2]].forEach(function (pr) {
        var slot = (pr[0] || [])[0];
        if (slot && slot.skillId) { var itemId = null; try { itemId = HC.getItemIdByHeroSkill(slot.skillId, slot.level); } catch (e) {} extra.push({ heroId: h._id, activePreset: h._skillsIndex, skillsIndex: pr[1], skillId: slot.skillId, level: slot.level, itemId: itemId }); }
      });
    });
    return {
      ts: new Date().toISOString(), uid: ud._uid, name: playerName(), sid: ud._serverId, profession: profName(),
      voucher: ud.getItemAmount(C.VOUCHER), speedup: ud.getItemAmount(C.SPEEDUP), gems: ud._resourceData._gold,
      tree: clone(PC._serverTalentData), defense: clone(ud.DefenseArmyCandidateInfo), extraSkills: extra
    };
  }
  function targetComplete(s) {
    var m = [];
    if (!s.tree || !s.tree.some(b => b && b.length)) m.push('tree');
    if (!s.defense || !s.defense.heroes || !s.defense.heroes.length) m.push('defense');
    return m;
  }
  // union of all branches' groups -> highest target node
  function buildTargets(tree) { var t = {}; (tree || []).forEach(function (br) { (br || []).forEach(function (id) { var g = groupOf(id); if (!t[g] || offOf(id) > offOf(t[g])) t[g] = id; }); }); return t; }
  function learnedOff(g) { var m = 0; (PC._serverTalentData || []).forEach(function (br) { (br || []).forEach(function (id) { if (groupOf(id) === g) m = Math.max(m, offOf(id)); }); }); return m; }
  function studying(g) { var s = PC._learningTalentData[0]; return (s && groupOf(s.id) === g) ? s : null; }

  // ---- steps ----
  async function buyVoucher() { await send(C.CMD.BUY, { shopId: C.VOUCHER_SHOP, amount: 1 }); await delay(400); }
  async function doReset() { await send(C.CMD.RESET, { index: C.RESET_TAB }); await refresh(); }

  async function retrain(ui, backupTree) {
    var targets = buildTargets(backupTree);
    var groups = Object.keys(targets).map(Number).filter(g => learnedOff(g) < offOf(targets[g])).sort((a, b) => a - b);
    var totalToDo = groups.length, done = [];
    // Response-driven: sync local state from each learn/speedup response (PC.updateServerData)
    // instead of a full 1318 refetch every step. Falls back to refresh() only when a response
    // lacks the expected data or a learn appears blocked (prereq).
    function sync(r) { if (r && (r.endowments || r.endowmentStudy)) { try { PC.updateServerData(r); return true; } catch (e) {} } return false; }
    async function completeGroup(g, targetId) {
      var toff = offOf(targetId);
      for (var i = 0; i < 30; i++) {
        var st = studying(g);
        if (st) {
          var rem = st.time - DATA.ServerTime;
          if (rem > 0) { var amt = Math.min(50000, Math.ceil(rem / 300) + 2); var sr = await send(C.CMD.SPEED, { isUseGold: 0, items: [{ itemid: C.SPEEDUP, amount: amt }], id: g }); if (!sync(sr)) await refresh(); continue; }
          else { await refresh(); continue; }
        }
        if (learnedOff(g) >= toff) return true;
        var before = learnedOff(g);
        var lr = await send(C.CMD.LEARN, { id: g, useGold: 0 });
        if (!sync(lr)) await refresh();
        if (!studying(g) && learnedOff(g) <= before) { await refresh(); if (!studying(g) && learnedOff(g) <= before) return false; }
      }
      return learnedOff(g) >= toff;
    }
    for (var pass = 0; pass < 8; pass++) {
      var progressed = false;
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi]; if (done.indexOf(g) >= 0) continue;
        if (await completeGroup(g, targets[g])) { done.push(g); progressed = true; }
        ui.sub.textContent = 'Retraining ' + done.length + '/' + totalToDo + ' groups  (speedups left ' + ud.getItemAmount(C.SPEEDUP) + ')';
      }
      if (done.length === totalToDo) break;
      if (!progressed) break;
    }
    return { total: totalToDo, done: done.length };
  }

  async function reapplyDefense(backupDef) {
    var cur = ud.DefenseArmyCandidateInfo.heroes.map(h => h.heroIds.length);
    var bk = backupDef.heroes.map(h => h.heroIds.length);
    if (JSON.stringify(cur) === JSON.stringify(bk)) return true;
    await send(C.CMD.SAVE_DEF, { armyTypes: backupDef.armyTypes, heroes: backupDef.heroes });
    try { ud.updateDefenseArmyCandidateInfo({ armyTypes: backupDef.armyTypes, heroes: backupDef.heroes }); } catch (e) {}
    await delay(400); return true;
  }

  function heroById(id) { return HC.getHaveHeroList().find(function (x) { return x._id === id; }); }
  function buffSkill(id, p) { var h = heroById(id); var s = h ? ((p === 2 ? h._secondBuffList : h._firstBuffList) || [])[0] : null; return (s && s.skillId) ? s.skillId : 0; }
  // Switch a hero's active preset and POLL until it actually lands (1345 is a server round-trip).
  async function switchPreset(id, p) {
    await send(C.CMD.SWITCH_PRESET, { heroId: id, skillsIndex: p });
    for (var i = 0; i < 20; i++) { var h = heroById(id); if (h && h._skillsIndex === p) return true; await delay(70); }
    var h2 = heroById(id); return !!(h2 && h2._skillsIndex === p);
  }
  async function reapplyExtra(ui, extra) {
    // Buff-slot equip (897) only works on the ACTIVE preset. Switch (1345) + poll until it
    // lands, equip, verify, retry up to 3x; then restore each hero's original active preset.
    var done = 0, failed = [];
    var origActive = {};
    extra.forEach(function (e) { if (origActive[e.heroId] === undefined) origActive[e.heroId] = (e.activePreset || 1); });
    var list = extra.slice().sort(function (a, b) { return (a.heroId - b.heroId) || (a.skillsIndex - b.skillsIndex); });
    for (var i = 0; i < list.length; i++) {
      var e = list[i], itemId = e.itemId; if (!itemId) { try { itemId = HC.getItemIdByHeroSkill(e.skillId, e.level); } catch (_) {} }
      if (!itemId) { failed.push(e); continue; }
      var ok = false;
      for (var attempt = 0; attempt < 3 && !ok; attempt++) {
        await switchPreset(e.heroId, e.skillsIndex);
        await send(C.CMD.EQUIP, { heroId: e.heroId, index: 0, itemId: itemId, isBuffSlot: true, skillsIndex: e.skillsIndex });
        await delay(280);
        if (buffSkill(e.heroId, e.skillsIndex) === e.skillId) ok = true;
      }
      if (ok) done++; else failed.push(e);
      ui.sub.textContent = 'Reapplying extra skills ' + done + '/' + list.length;
    }
    for (var hid in origActive) { await switchPreset(+hid, origActive[hid]); }
    return { done: done, failed: failed };
  }

  async function verify(backup) {
    await refresh();
    var sortN = a => (a || []).slice().sort((x, y) => x - y);
    var treeOk = (PC._serverTalentData || []).every((br, i) => JSON.stringify(sortN(br)) === JSON.stringify(sortN(backup.tree[i])));
    var defOk = JSON.stringify(ud.DefenseArmyCandidateInfo.heroes.map(h => h.heroIds.length)) === JSON.stringify(backup.defense.heroes.map(h => h.heroIds.length));
    var extraMissing = 0;
    backup.extraSkills.forEach(function (e) { var h = HC.getHaveHeroList().find(x => x._id === e.heroId); var slot = h ? ((e.skillsIndex === 2 ? h._secondBuffList : h._firstBuffList) || [])[0] : null; if (!slot || slot.skillId !== e.skillId) extraMissing++; });
    return { treeOk: treeOk, defOk: defOk, extraMissing: extraMissing, extraTotal: backup.extraSkills.length };
  }

  // ---- overlay ----
  function overlay() {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(13,17,23,.97);color:#e6edf3;font:19px/1.65 -apple-system,system-ui,sans-serif;padding:22px;overflow:auto;-webkit-text-size-adjust:100%';
    var hdr = document.createElement('div'); hdr.style.cssText = 'font-size:28px;font-weight:800;color:#79c0ff;margin-bottom:14px'; hdr.textContent = 'Class Talent Reset';
    var sub = document.createElement('div'); sub.style.cssText = 'font-size:18px;color:#8b949e;margin-bottom:14px';
    var body = document.createElement('div'); body.style.cssText = 'white-space:pre-wrap;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-bottom:16px;font-size:19px;line-height:1.7;font-family:ui-monospace,Menlo,monospace';
    var btns = document.createElement('div');
    bg.appendChild(hdr); bg.appendChild(sub); bg.appendChild(body); bg.appendChild(btns); document.body.appendChild(bg);
    return { bg: bg, hdr: hdr, sub: sub, body: body, btns: btns };
  }
  function line(ui, s) { ui.body.textContent += s + '\n'; ui.body.scrollTop = ui.body.scrollHeight; }
  function mkBtn(label, color, fn) { var b = document.createElement('button'); b.textContent = label; b.style.cssText = 'margin:8px 10px 0 0;padding:16px 26px;border:0;border-radius:10px;font-size:19px;font-weight:800;color:#0d1117;background:' + color + ';cursor:pointer'; b.onclick = fn; return b; }

  // Shared post-reset sequence (used by a fresh run AND by resume). Idempotent:
  // retrain skips already-learned groups, reapply skips already-correct slots.
  // Clears the saved resume point only on full success.
  async function runFromReset(ui, backup) {
    var rt = await retrain(ui, backup.tree); line(ui, 'Retrain: ' + rt.done + '/' + rt.total + ' groups.');
    line(ui, 'Reapplying base defense...'); await reapplyDefense(backup.defense);
    if (backup.extraSkills && backup.extraSkills.length) {
      var rx = await reapplyExtra(ui, backup.extraSkills);
      line(ui, 'Extra skills: ' + rx.done + '/' + backup.extraSkills.length + ' reapplied.');
      if (rx.failed.length) line(ui, 'Could NOT reapply (equip manually): ' + rx.failed.map(function (f) { return 'hero ' + f.heroId + ' preset ' + f.skillsIndex + ' skill ' + f.skillId; }).join('; '));
    }
    var v = await verify(backup); ui.sub.textContent = '';
    if (v.treeOk && v.defOk && v.extraMissing === 0) { clearResume(); ui.hdr.style.color = '#3fb950'; line(ui, '\nDONE. Tree, defense' + (v.extraTotal ? ', and ' + v.extraTotal + ' extra skills' : '') + ' restored.'); }
    else { ui.hdr.style.color = '#d29922'; line(ui, '\nPARTIAL. tree=' + v.treeOk + ' defense=' + v.defOk + ' extraMissing=' + v.extraMissing + '/' + v.extraTotal + '. Re-run this bookmarklet to resume, or use the clipboard backup.'); }
    ui.btns.appendChild(mkBtn('Close', '#30363d', function () { document.body.removeChild(ui.bg); }));
  }

  function summarize(ui, s) {
    var nodes = (s.tree || []).reduce(function (a, b) { return a + (b ? b.length : 0); }, 0);
    line(ui, 'Profession: ' + s.profession + (s.name ? ('    Player: ' + s.name) : '') + '    Server: ' + s.sid);
    line(ui, 'Voucher: ' + s.voucher + (s.voucher < 1 ? '  (will buy for ' + C.VOUCHER_COST + ' gems)' : '') + '   Gems: ' + s.gems);
    line(ui, '5-min speedups: ' + s.speedup);
    line(ui, 'Talent nodes to preserve/restore: ' + nodes + '  (branches ' + s.tree.map(function (b) { return b ? b.length : 0; }).join('/') + ')');
    line(ui, 'Base defense: ' + s.defense.heroes.map(function (h) { return h.heroIds.length; }).join('/') + ' heroes/troop');
    line(ui, 'Hero extra skill slots: ' + s.extraSkills.length + (s.extraSkills.length ? '' : ' (none - CE only)'));
  }

  async function run() {
    try { resolve(); } catch (e) { alert('Class Talent modules not found: ' + e); return; }
    var ui = overlay();

    // Resume path: an interrupted run for THIS account (e.g. a crash mid-retrain).
    // Skips buy + reset entirely and finishes retrain + reapply against the saved target.
    var pending = loadResume();
    if (pending && pending.tree && pending.uid === ud._uid) {
      ui.hdr.textContent = 'Class Talent Reset (resume)';
      line(ui, 'Interrupted run found for this account.');
      try { line(ui, 'Started: ' + new Date(pending.ts).toLocaleString()); } catch (e) {}
      var pn = (pending.tree || []).reduce(function (a, b) { return a + (b ? b.length : 0); }, 0);
      line(ui, 'Target: ' + pn + ' talent nodes, defense ' + pending.defense.heroes.map(function (h) { return h.heroIds.length; }).join('/') + ', ' + (pending.extraSkills ? pending.extraSkills.length : 0) + ' extra skills.');
      line(ui, '\nResume finishes retraining + reapply. It will NOT buy or reset again.');
      ui.btns.appendChild(mkBtn('Resume', '#3fb950', async function () {
        ui.btns.textContent = ''; ui.body.textContent = ''; ui.hdr.style.color = '#79c0ff';
        line(ui, 'Resuming (no buy, no reset)...');
        try { await runFromReset(ui, pending); }
        catch (err) { ui.hdr.style.color = '#f85149'; line(ui, '\nERROR: ' + err); ui.btns.appendChild(mkBtn('Close', '#30363d', function () { document.body.removeChild(ui.bg); })); }
      }));
      ui.btns.appendChild(mkBtn('Start over', '#d29922', function () { clearResume(); document.body.removeChild(ui.bg); run(); }));
      ui.btns.appendChild(mkBtn('Discard', '#30363d', function () { clearResume(); document.body.removeChild(ui.bg); }));
      return;
    }

    line(ui, 'Reading state...'); await refresh();
    var s = readState(); window.__crRunBackup = s;
    ui.body.textContent = '';
    summarize(ui, s);
    var miss = targetComplete(s);
    if (miss.length) { ui.hdr.style.color = '#f85149'; line(ui, '\nINCOMPLETE restore target: ' + miss.join(', ') + ' -> blocked.'); ui.btns.appendChild(mkBtn('Close', '#30363d', function () { document.body.removeChild(ui.bg); })); return; }
    if (s.voucher < 1 && s.gems < C.VOUCHER_COST) { ui.hdr.style.color = '#d29922'; line(ui, '\nNo voucher and only ' + s.gems + ' gems (< ' + C.VOUCHER_COST + '). Get gems or a voucher, then re-run.'); ui.btns.appendChild(mkBtn('Close', '#30363d', function () { document.body.removeChild(ui.bg); })); return; }

    ui.btns.appendChild(mkBtn(s.voucher < 1 ? ('Confirm (buy ' + C.VOUCHER_COST + ' gems + run)') : 'Confirm & run', '#3fb950', async function () {
      ui.btns.textContent = '';
      try { await navigator.clipboard.writeText(JSON.stringify(s)); line(ui, 'Backup copied to clipboard.'); } catch (e) { line(ui, 'Clipboard failed; backup in window.__crRunBackup + console.'); }
      console.log('CR_BACKUP', JSON.stringify(s));
      // Persist a resume point BEFORE the irreversible reset, so a crash mid-retrain
      // can be finished later without buying/resetting again.
      saveResume({ v: 1, ts: Date.now(), uid: s.uid, profession: s.profession, tree: s.tree, defense: s.defense, extraSkills: s.extraSkills });
      try {
        if (s.voucher < 1) { line(ui, 'Buying voucher (' + C.VOUCHER_COST + ' gems)...'); await buyVoucher(); }
        line(ui, 'Resetting...'); await doReset();
        await runFromReset(ui, s);
      } catch (err) { ui.hdr.style.color = '#f85149'; line(ui, '\nERROR: ' + err + '\nBackup is on your clipboard. Re-run this bookmarklet to resume.'); ui.btns.appendChild(mkBtn('Close', '#30363d', function () { document.body.removeChild(ui.bg); })); }
    }));
    ui.btns.appendChild(mkBtn('Cancel', '#30363d', function () { document.body.removeChild(ui.bg); }));
  }
  window.__crRun = run; run();
})();
