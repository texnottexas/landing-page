// 2864tw.com — Troop Optimizer bookmarklet (placement + rebuild).
// Reads your base, works out the best layout for the chosen mode, shows Before / After,
// runs the moves at a human pace, and can lock new units onto the plan for this session.
// Loads troop-core.js (logic) and troop-game.js (game adapter) from 2864tw.com.
(function () {
  'use strict';
  var BASE = 'https://2864tw.com/';
  var MODES = [
    { key: 'units', label: 'Max units', hint: 'All army on the land. Holds the most units.' },
    { key: 'planes', label: 'Max planes', hint: 'Fit as many planes as the land allows.' },
    { key: 'half', label: '50 / 50', hint: 'Half the free land for planes, half for army.' }
  ];
  var COLORS = {
    fixed: '#30363d', land: '#1d3324', sea: '#0c2d4a', blockedLand: '#141a14', blockedSea: '#0b1622',
    air: '#d29922', airEmpty: '#5c4a1a', army: '#3fb950', navy: '#388bfd', bld: '#a371f7', seabld: '#a371f7',
    deco: '#8b949e', odd: '#6e7681', newBld: '#56d4dd',
    airMoving: '#f0883e', armyMoving: '#f0883e', navyMoving: '#f0883e', bldMoving: '#f0883e', decoMoving: '#f0883e'
  };
  var LEGEND = [['air', 'Planes'], ['airEmpty', 'Planned empty plane spot'], ['army', 'Army'], ['navy', 'Navy'], ['bld', 'Required building'], ['deco', 'Decoration'], ['fixed', 'Other buildings'], ['airMoving', 'Will move (Before)']];

  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url + '?_=' + Date.now();
      s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + url)); };
      document.body.appendChild(s);
    });
  }
  function ensureDeps() {
    var p = Promise.resolve();
    if (!window.TroopCore) p = p.then(function () { return loadScript(BASE + 'troop-core.js'); });
    if (!window.TroopGame) p = p.then(function () { return loadScript(BASE + 'troop-game.js'); });
    return p;
  }

  // ---------------------------------------------------------------- overlay shell
  var old = document.getElementById('tp-overlay'); if (old) old.remove();
  if (window.TroopGame) { window.TroopGame.stop(); window.TroopGame.removeLock(); }   // an earlier panel's run and lock never outlive it
  var FONT = 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e6edf3;text-align:left;line-height:1.35;';
  var FULL = 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;padding:14px;' + FONT;
  // minimised: only a small pill at the top, so the game underneath stays fully usable (train, Kuruzo, bulk add)
  var MINI = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483647;' + FONT;
  var root = el('div', FULL);
  root.id = 'tp-overlay';
  var head = el('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
  head.appendChild(el('div', 'font-size:16px;font-weight:600;flex:1;', 'Troop Optimizer'));
  var HEAD_BTN = 'background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;';
  var minBtn = el('button', HEAD_BTN, 'Minimise');
  var closeBtn = el('button', HEAD_BTN, 'Close');
  head.appendChild(minBtn); head.appendChild(closeBtn);
  root.appendChild(head);
  var body = el('div', 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;max-width:760px;width:100%;margin:0 auto;');
  root.appendChild(body);
  var pill = el('div', 'display:none;align-items:center;gap:10px;background:#161b22;border:1px solid #30363d;border-radius:20px;padding:6px 8px 6px 14px;box-shadow:0 4px 14px rgba(0,0,0,.5);font-size:13px;white-space:nowrap;');
  var pillText = el('span', '', 'Troop Optimizer');
  var openBtn = el('button', 'background:#1f6feb;color:#fff;border:none;border-radius:14px;padding:5px 12px;font-size:12px;cursor:pointer;', 'Open');
  pill.appendChild(pillText); pill.appendChild(openBtn);
  root.appendChild(pill);
  document.body.appendChild(root);
  function updatePill() {
    var TG = window.TroopGame;
    pillText.textContent = 'Troop Optimizer: lock ' + (TG && TG.lockActive() ? 'on' : 'off') + (state.progress ? ', ' + state.progress : '');
  }
  minBtn.onclick = function () { root.style.cssText = MINI; head.style.display = 'none'; body.style.display = 'none'; pill.style.display = 'flex'; updatePill(); };
  openBtn.onclick = function () { root.style.cssText = FULL; head.style.display = 'flex'; body.style.display = 'flex'; pill.style.display = 'none'; };
  closeBtn.onclick = function () { if (window.TroopGame) { window.TroopGame.stop(); window.TroopGame.removeLock(); } root.remove(); };

  function card(title) {
    var c = el('div', 'background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;');
    if (title) c.appendChild(el('div', 'font-weight:600;color:#79c0ff;', title));
    body.appendChild(c);
    return c;
  }
  function btn(label, primary) {
    return el('button', primary
      ? 'padding:12px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-weight:600;font-size:14px;cursor:pointer;'
      : 'padding:10px;background:transparent;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:13px;cursor:pointer;', label);
  }
  function note(parent, text, color) { var n = el('div', 'color:' + (color || '#8b949e') + ';font-size:12px;line-height:1.4;', text); parent.appendChild(n); return n; }

  var state = { snap: null, region: null, mode: 'units', navy: false, fkboats: (function () { try { return localStorage.getItem('tp_fkboats_v1') === '1'; } catch (e) { return false; } })(), fillArmy: false, keepPlanes: true, rows: [], row: null, running: false, busy: false, progress: '', controls: [], painters: [] };
  // nothing that changes the plan can be tapped while planning or running
  function setBusy(flag) {
    state.busy = flag;
    state.controls.concat(state.rows.map(function (r) { return r.button; })).forEach(function (c) {
      if (!c) return;
      c.disabled = flag; c.style.opacity = flag ? '.5' : '1'; c.style.pointerEvents = flag ? 'none' : '';
    });
    if (!flag) syncFkLayout();
  }
  // fkboats mode: the Layout card's sea option is off and says why
  function syncFkLayout() {
    var r = state.navyRow; if (!r) return;
    r.input.disabled = state.fkboats; r.input.style.opacity = state.fkboats ? '.5' : '1';
    r.text.textContent = 'Also optimise the sea for navy' + (state.fkboats ? ' (off in fkboats mode)' : '');
  }

  // ---------------------------------------------------------------- scan
  function scanCard() {
    var c = card('Your base'), body = el('div', 'display:flex;flex-direction:column;gap:8px;'); c.appendChild(body);
    function paintScan() {
    body.textContent = '';
    var s = state.snap, r = state.region;
    var tbl = el('div', 'display:grid;grid-template-columns:auto auto auto auto;gap:4px 14px;font-size:12px;');
    ['Storage', 'Used', 'Max', 'Free'].forEach(function (h) { tbl.appendChild(el('div', 'color:#8b949e;', h)); });
    [['army', 'Garage (army)'], ['air', 'Hangar (planes)'], ['navy', 'Dock (navy)']].forEach(function (k) {
      var st = s.storage[k[0]];
      [k[1], st.used, st.max, Math.max(0, st.max - st.used)].forEach(function (v) { tbl.appendChild(el('div', '', String(v))); });
    });
    body.appendChild(tbl);
    var onMap = r.units.air.length + ' planes, ' + r.units.army.length + ' army, ' + r.units.navy.length + ' navy on the base';
    note(body, onMap + '. Usable land: ' + r.landCells.length + ' tiles. Usable sea: ' + r.seaCells.length + ' tiles.', '#e6edf3');
    if (r.landCells.length < 762) note(body, 'Some areas are still locked, so the plan covers the land you have open today.');
    if (r.units.odd.length) note(body, r.units.odd.length + ' unit(s) are busy or have an unusual size. They stay where they are.');
    if (r.unparked.length) note(body, r.unparked.length + ' decoration(s) have no free spot in the no-units zone, so they stay put.');
    note(body, 'Storage fills first. Units only land on the base once that storage is full.');
    var adv = s.slotAdvice, lines = [];
    Object.keys(adv.byType).forEach(function (k) {
      var name = k === 'army' ? 'Garage' : k === 'navy' ? 'Dock' : 'Hangar';
      var next = adv.byType[k].map(function (w) { return w.nextPrice; }).filter(function (p) { return p != null; });
      if (next.length) lines.push(name + ' next slot: ' + Math.min.apply(null, next) + ' slot items');
    });
    note(body, 'Advisory: you hold ' + adv.held + ' storage slot items. ' + (lines.length ? lines.join('. ') + '.' : 'Every storage building is at its slot limit.'));
      }
    paintScan(); state.painters.push(paintScan);     // storage counts change with every run
  }

  // ---------------------------------------------------------------- mode + plan
  var planCard, planOut;
  function modeCard() {
    var c = card('Layout');
    var row = el('div', 'display:flex;gap:6px;flex-wrap:wrap;');
    var hint = note(c, '');
    MODES.forEach(function (m) {
      var b = btn(m.label);
      b.dataset.mode = m.key;
      b.onclick = function () { state.mode = m.key; paint(); };
      row.appendChild(b); state.controls.push(b);
    });
    c.insertBefore(row, hint);
    function check(label, key) {
      var w = el('label', 'display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;');
      var i = el('input'); i.type = 'checkbox'; i.checked = state[key];
      i.onchange = function () { state[key] = i.checked; };
      w.appendChild(i); w.appendChild(document.createTextNode(label)); c.appendChild(w);
      state.controls.push(i);
      return w;
    }
    var fill = check('Fill leftover tiles with army', 'fillArmy');
    var keep = check('Keep planes already on the base', 'keepPlanes');
    var seaRow = check('Also optimise the sea for navy', 'navy');
    state.navyRow = { input: seaRow.querySelector('input'), text: seaRow.lastChild };
    syncFkLayout();
    var go = btn('Plan my base', true);
    go.onclick = function () { plan(); };
    c.appendChild(go); state.controls.push(go);
    function paint() {
      Array.prototype.forEach.call(row.children, function (b) {
        var on = b.dataset.mode === state.mode;
        b.style.background = on ? '#1f6feb' : 'transparent'; b.style.borderColor = on ? '#1f6feb' : '#30363d';
      });
      hint.textContent = MODES.filter(function (m) { return m.key === state.mode; })[0].hint;
      fill.style.display = state.mode === 'planes' ? 'flex' : 'none';
      keep.style.display = state.mode === 'units' ? 'flex' : 'none';
    }
    paint();
    planCard = card('Plan');
    planOut = el('div', 'display:flex;flex-direction:column;gap:8px;');
    planCard.appendChild(planOut);
    note(planOut, 'Pick a layout and tap Plan my base. Nothing changes until you tap Run.');
    lockCard();
  }

  async function plan() {
    if (state.busy || state.running) return;
    setBusy(true);
    try {
      planOut.textContent = '';
      var status = note(planOut, 'Loading the solver...', '#e6edf3');
      var solver = null;
      try { await window.TroopGame.loadHighs(); solver = function (lp) { return window.TroopGame.solve(lp, 20); }; } catch (e) { solver = null; }
      status.textContent = state.mode === 'planes' ? 'Finding the most planes your land can hold, plus cheaper options...' : 'Working out the layout...';
      var out = await window.TroopCore.planRows(state.snap, state.region, { mode: state.mode, keepPlanes: state.keepPlanes, navy: state.navy && !state.fkboats }, solver);
      status.remove();
      state.rows = out.rows;
      if (!out.exact) note(planOut, solver ? 'The exact solver hit a problem, so this plan is near-optimal (within about 3%).' : 'The exact solver could not load, so this plan is near-optimal (within about 3%).', '#d29922');
      if (state.navy && out.notes.indexOf('navy pass skipped') >= 0) note(planOut, 'The sea could not be planned this time, so navy stays where it is.', '#d29922');
      if (!out.rows.length) { note(planOut, 'There is not enough open land to seat your required buildings off the floor tiles, so this layout cannot be planned.', '#f85149'); return; }
      renderRows();
    } catch (e) {
      planOut.textContent = '';
      note(planOut, 'Planning failed. Close this panel and try again.', '#f85149');
    } finally {
      setBusy(false);
    }
  }

  function renderRows() {
    var TC = window.TroopCore;
    var list = el('div', 'display:flex;flex-direction:column;gap:6px;');
    planOut.appendChild(list);
    var planesNow = state.region.units.air.length;
    state.rows.forEach(function (row, i) {
      var st = row.result.stats;
      var label = state.mode === 'planes'
        ? 'Room for ' + row.planes + ' planes (' + (row.planes - planesNow >= 0 ? '+' : '') + (row.planes - planesNow) + '), ' + row.result.steps.length + ' steps'
        : row.target.armyCells.length + ' army tiles, ' + row.planes + ' plane spots, ' + row.result.steps.length + ' steps';
      if (row.result.blocked.some(function (x) { return x.reason === 'deadlock'; })) label += ' (cannot fully finish)';
      var b = btn(label);
      b.style.textAlign = 'left';
      b.onclick = function () { choose(i); };
      row.button = b;
      list.appendChild(b);
      if (st.temps) note(list, 'This option needs ' + st.temps + ' temporary shuffle(s).');
    });
    var maps = el('div', 'display:flex;gap:10px;flex-wrap:wrap;');
    planOut.appendChild(maps);
    var cv = {};
    ['Before', 'After'].forEach(function (lbl) {
      var w = el('div', 'flex:1;min-width:260px;display:flex;flex-direction:column;gap:4px;');
      w.appendChild(el('div', 'font-size:12px;color:#8b949e;', lbl));
      var c = el('canvas', 'width:100%;background:#0d1117;border:1px solid #30363d;border-radius:4px;');
      c.width = 680; w.appendChild(c); maps.appendChild(w); cv[lbl] = c;
    });
    var legend = el('div', 'display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#8b949e;');
    LEGEND.forEach(function (l) {
      var s = el('span', 'display:flex;gap:4px;align-items:center;');
      s.appendChild(el('span', 'width:10px;height:10px;border-radius:2px;background:' + COLORS[l[0]] + ';'));
      s.appendChild(document.createTextNode(l[1]));
      legend.appendChild(s);
    });
    planOut.appendChild(legend);
    var summary = note(planOut, '', '#e6edf3');
    var blocked = note(planOut, '', '#f85149');
    var run = btn('Run', true);
    planOut.appendChild(run);
    var progress = el('div', 'display:none;flex-direction:column;gap:6px;');
    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .15s;');
    barWrap.appendChild(bar); progress.appendChild(barWrap);
    var progText = note(progress, '', '#e6edf3');
    var stopBtn = btn('Stop after this step');
    stopBtn.style.color = '#f85149'; stopBtn.style.borderColor = '#f85149';
    stopBtn.onclick = function () { window.TroopGame.stop(); stopBtn.textContent = 'Stopping...'; };
    progress.appendChild(stopBtn);
    planOut.appendChild(progress);

    var armed = false;
    function choose(i) {
      state.row = state.rows[i];
      state.rows.forEach(function (r, j) { r.button.style.borderColor = j === i ? '#1f6feb' : '#30363d'; r.button.style.background = j === i ? 'rgba(31,111,235,.15)' : 'transparent'; });
      if (window.TroopGame.lockActive()) window.TroopGame.installLock(state.row.target, { mode: state.mode, fillArmy: state.fillArmy });
      var m = TC.renderModel(state.snap, state.region, state.row.target, state.row.result);
      drawMap(cv.Before, m.before, m.outlines.before); drawMap(cv.After, m.after, m.outlines.after);
      var st = state.row.result.stats;
      summary.textContent = st.parks + ' decoration move(s), ' + st.stores + ' unit(s) to storage, ' + st.moves + ' move(s). ' +
        (st.emptyAirSlots ? st.emptyAirSlots + ' planned plane spot(s) stay empty for new planes.' : '');
      blocked.textContent = state.row.result.blocked.map(function (b) {
        return b.reason === 'storage_full' ? b.remaining + ' ' + b.role + ' unit(s) need storage space first, so they stay put.' : 'With this option some units cannot reach their spot, so the run ends early.';
      }).join(' ');
      armed = false;
      var nSteps = state.row.result.steps.length, status = TC.planStatus(state.row.result);
      run.textContent = status === 'done' ? 'Already optimal' : status === 'blocked' ? 'Nothing to run until storage frees up' : 'Run ' + nSteps + ' steps';
      run.disabled = !nSteps;
      run.style.opacity = run.disabled ? '.5' : '1';
    }
    run.onclick = function () {
      if (state.running || state.busy || !state.row || window.TroopGame.isRunning()) return;
      var n = state.row.result.steps.length;
      if (!armed) { armed = true; run.textContent = 'Tap again to start ' + n + ' steps (about ' + Math.ceil(n * 2.5 / 60) + ' min)'; setTimeout(function () { if (armed && !state.running) { armed = false; run.textContent = 'Run ' + n + ' steps'; } }, 4000); return; }
      armed = false;
      execute(state.row, run, progress, bar, progText, stopBtn, function () { choose(state.rows.indexOf(state.row)); });
    };
    choose(0);
  }

  async function execute(row, run, progress, bar, progText, stopBtn, repaint) {
    var TC = window.TroopCore, TG = window.TroopGame, res = { ok: false, error: 'The run did not start.' };
    state.running = true; setBusy(true);
    run.style.display = 'none'; progress.style.display = 'flex';
    stopBtn.textContent = 'Stop after this step';
    var steps = row.result.steps;
    try {
      res = await TG.runSteps(steps, {
        onStep: function (i) {
          bar.style.width = Math.round((i + 1) / steps.length * 100) + '%';
          state.progress = 'step ' + (i + 1) + ' of ' + steps.length;
          progText.textContent = 'Step ' + (i + 1) + ' of ' + steps.length; updatePill();
        }
      });
      // verify against the server-backed client state and re-plan whatever is left
      state.snap = TG.readSnapshot();
      state.region = TC.buildRegion(state.snap);
      row.result = TC.planSteps(state.snap, state.region, row.target, { mode: state.mode });
    } catch (e) {
      res = { ok: false, error: 'Something went wrong. Open your base and tap Run to resume.' };
    } finally {
      state.running = false; state.progress = ''; setBusy(false); updatePill();
      progress.style.display = 'none'; run.style.display = 'block';
    }
    repaint();
    var status = TC.planStatus(row.result), left = row.result.steps.length;
    if (status === 'done') note(planOut, 'Done and verified. Your base now matches the plan. Reload the game any time to double check.', '#3fb950');
    else if (status === 'blocked') note(planOut, 'Finished everything that can move today. The rest needs storage space first.', '#d29922');
    else note(planOut, (res.error ? res.error + ' ' : '') + left + ' step(s) left. Tap Run to resume.', '#d29922');
  }

  function lockCard() {
    var c = card('Lock new units to this plan');
    note(c, 'While this is on, new units from training, Kuruzo, Bulk Training or bulk add go into the planned spots instead of the nearest gap. Minimise this panel to keep playing with the lock on. It ends when you close the panel or reload the game.');
    var b = btn('Turn lock on');
    var st = note(c, 'Lock is off.');
    b.onclick = function () {
      var TG = window.TroopGame;
      if (TG.lockActive()) { TG.removeLock(); b.textContent = 'Turn lock on'; st.textContent = 'Lock is off.'; updatePill(); return; }
      if (!state.row) { st.textContent = 'Plan your base first, then turn the lock on.'; return; }
      TG.installLock(state.row.target, { mode: state.mode, fillArmy: state.fillArmy });
      b.textContent = 'Turn lock off';
      st.textContent = 'Lock is on. Tap Minimise to use the game while it stays on. It only matters once that unit type\'s storage is full.';
      updatePill();
    };
    c.appendChild(b);
  }

  // ---------------------------------------------------------------- mini-map
  function drawMap(canvas, cats, outlines) {
    var TC = window.TroopCore, W = TC.CONST.W, H = TC.CONST.H;
    var cw = 2 * canvas.width / (W + 1), ch = cw * 98 / 136;
    canvas.height = Math.ceil(ch * (H + 1) / 2);
    var g = canvas.getContext('2d');
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, canvas.width, canvas.height);
    Object.keys(cats).forEach(function (k) {
      var color = COLORS[cats[k]]; if (!color) return;
      var xy = TC.fromPosId(Number(k)), cx = cw / 2 + xy[0] * cw / 2, cy = ch / 2 + xy[1] * ch / 2;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(cx, cy - ch / 2); g.lineTo(cx + cw / 2, cy); g.lineTo(cx, cy + ch / 2); g.lineTo(cx - cw / 2, cy);
      g.closePath(); g.fill();
    });
    // one outline per unit / building so each 2x2 plane reads as its own diamond
    var C = function (x, y) { return [cw / 2 + x * cw / 2, ch / 2 + y * ch / 2]; };
    g.strokeStyle = '#0d1117'; g.lineWidth = Math.max(1, cw / 8);
    (outlines || []).forEach(function (o) {
      var t = C(o.x, o.y), r = C(o.x + o.w - 1, o.y + o.w - 1), b = C(o.x - o.h + o.w, o.y + o.h + o.w - 2), l = C(o.x - o.h + 1, o.y + o.h - 1);
      g.beginPath();
      g.moveTo(t[0], t[1] - ch / 2); g.lineTo(r[0] + cw / 2, r[1]); g.lineTo(b[0], b[1] + ch / 2); g.lineTo(l[0] - cw / 2, l[1]);
      g.closePath(); g.stroke();
    });
  }

  // ---------------------------------------------------------------- rebuild after a battle (v2)
  var ROLE_NAME = { army: 'army', air: 'plane', navy: 'navy' }, TYPE_ROLE = { 101: 'army', 201: 'navy', 301: 'air' };
  var GROUP_ROLE = { 1040: 'army', 1050: 'air', 1100: 'navy' };
  function bld(group, n) { return n + ' ' + ({ 1040: 'Barracks', 1050: n === 1 ? 'Air Base' : 'Air Bases', 1100: n === 1 ? 'Shipyard' : 'Shipyards' })[group]; }
  function refreshSnapshot() { state.snap = window.TroopGame.readSnapshot(); state.region = window.TroopCore.buildRegion(state.snap); }
  function sub(parent, title) {
    var s = el('div', 'display:flex;flex-direction:column;gap:6px;border-top:1px solid #30363d;padding-top:8px;');
    s.appendChild(el('div', 'font-weight:600;', title)); parent.appendChild(s); return s;
  }
  // a status line that replaces its previous message instead of piling up
  function statusLine(parent) {
    var cur = null;
    return function (text, color) { if (cur) cur.remove(); cur = text ? note(parent, text, color) : null; };
  }
  function fmt(n) {   // game-style big numbers: K, M, B, T, then aa, bb, cc ...
    var u = ['', 'K', 'M', 'B', 'T', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj'], i = 0;
    while (Math.abs(n) >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (Math.round(n * 10) / 10) + u[i];
  }
  // second tap within 4 s confirms; anything destructive or costly goes through this
  function confirmTap(b, armedText, onGo) {
    b.onclick = function () {
      if (state.busy || state.running || window.TroopGame.isRunning()) return;
      if (!b._armed) {
        b._armed = true; b._label = b.textContent; b.textContent = typeof armedText === 'function' ? armedText() : armedText;
        setTimeout(function () { if (b._armed) { b._armed = false; b.textContent = b._label; } }, 4000);
        return;
      }
      b._armed = false; b.textContent = b._label; onGo();
    };
  }
  // runs game steps with a progress bar and Stop; done(result, responses) after a fresh read of the base
  function runWithProgress(container, steps, label, done) {
    var TG = window.TroopGame;
    if (!steps.length) { done({ ok: true, done: 0 }, []); return; }
    var box = el('div', 'display:flex;flex-direction:column;gap:6px;');
    var barWrap = el('div', 'height:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;overflow:hidden;');
    var bar = el('div', 'height:100%;background:#3fb950;width:0%;transition:width .15s;');
    barWrap.appendChild(bar); box.appendChild(barWrap);
    var txt = note(box, label + '...', '#e6edf3');
    var stopB = btn('Stop after this step'); stopB.style.color = '#f85149'; stopB.style.borderColor = '#f85149';
    stopB.onclick = function () { TG.stop(); stopB.textContent = 'Stopping...'; };
    box.appendChild(stopB); container.appendChild(box);
    state.running = true; setBusy(true);
    var responses = [];
    TG.runSteps(steps, {
      onStep: function (i, st, r) {
        responses.push(r);
        bar.style.width = Math.round((i + 1) / steps.length * 100) + '%';
        txt.textContent = label + ': step ' + (i + 1) + ' of ' + steps.length;
        state.progress = label.toLowerCase() + ' ' + (i + 1) + '/' + steps.length; updatePill();
      }
    }).catch(function () { return { ok: false, error: 'Something went wrong. Open your base and try again.' }; }).then(function (res) {
      txt.textContent = label + ': updating...';
      // give the server's updates a moment to land, then re-read once and repaint every card
      setTimeout(function () {
        state.running = false; state.progress = ''; setBusy(false); updatePill();
        box.remove();
        try { refreshSnapshot(); } catch (e) { res = { ok: false, error: 'Your base closed. Open it again and run this again.' }; done(res, responses); return; }
        state.painters.forEach(function (p) { try { p(); } catch (e) {} });
        done(res, responses);
      }, 1500);
    });
  }
  function totalUnits() { return state.snap.stored.length + state.snap.units.length; }
  // Repeats until a round merges nothing (max 5). `start` is the count before round 1, so the
  // report covers every round, not just the last one.
  function mergePasses(container, done, pass, before, start, splitDone) {
    if (!pass) { try { refreshSnapshot(); } catch (e) { done({ ok: false, error: 'Open your base first.' }); return; } }
    pass = pass || 1; before = before == null ? totalUnits() : before; start = start == null ? before : start;
    var steps = window.TroopCore.mergeSteps(state.snap.stored, state.snap.units, state.snap.mergeCap);   // only where a pair sits
    runWithProgress(container, steps, 'Merging (round ' + pass + ')', function (res) {
      if (!res.ok) { done(res); return; }
      (function () {
        var after = totalUnits();
        if (after < before && pass < 5) { mergePasses(container, done, pass + 1, after, start, splitDone); return; }
        // Merge All never pairs a stored unit with one on the base: store the base half once, then merge again
        var snap = state.snap, free = {};
        ['army', 'air', 'navy'].forEach(function (k) { free[k] = Math.max(0, snap.storage[k].max - snap.storage[k].used); });
        var moves = splitDone || pass >= 5 ? [] : window.TroopCore.crossLocationStores(snap.stored, snap.units, snap.mergeCap, free);
        if (!moves.length) { done({ ok: true, merged: start - after }); return; }
        runWithProgress(container, moves, 'Moving ' + moves.length + ' unit(s) into storage to pair up', function (r2) {
          if (!r2.ok) { done(r2); return; }
          mergePasses(container, done, pass + 1, after, start, true);
        });
      })();
    });
  }

  function rebuildCard() {
    var TC = window.TroopCore, c = card('Rebuild after a battle');
    note(c, 'Merge demoted units, delete the ones that can never merge again, wear your best training skin, fill spare spots with training buildings and fill every training queue. Every step waits for a second tap. No speed-ups or gems are ever used.');

    // fkboats mode: leave navy out of everything (no Shipyards, no navy training, no sea planning)
    var fkRow = el('label', 'display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;');
    var fkBox = el('input'); fkBox.type = 'checkbox'; fkBox.checked = state.fkboats;
    fkRow.appendChild(fkBox); fkRow.appendChild(document.createTextNode('fkboats mode: skip navy'));
    c.appendChild(fkRow); state.controls.push(fkBox);
    var fkNote = note(c, '', '#8b949e');
    function paintFk() { fkNote.textContent = state.fkboats ? 'No Shipyards, no navy training and no sea planning. Your navy stays in the Dock.' : ''; fkNote.style.display = state.fkboats ? '' : 'none'; }
    fkBox.onchange = function () {
      state.fkboats = fkBox.checked;
      try { localStorage.setItem('tp_fkboats_v1', state.fkboats ? '1' : '0'); } catch (e) {}
      paintFk(); paintBuild(); syncFkLayout();
    };
    paintFk();

    // 1. merge and clean up
    var s1 = sub(c, '1. Merge and clean up'), s1info = note(s1, ''), mergeB = btn('Merge everything (free)'), delBox = el('div', 'display:flex;flex-direction:column;gap:6px;');
    var s1say = statusLine(s1);
    s1.appendChild(mergeB); s1.appendChild(delBox); state.controls.push(mergeB);
    function paintCleanup() {
      var all = state.snap.stored.concat(state.snap.units), caps = state.snap.mergeCap;
      var pairs = TC.mergeablePairs(all, caps), split = TC.splitDeletable(all), cand = split.singles;
      s1info.textContent = pairs + ' pair(s) can merge right now (free, up to Lv' + caps.army + '). ' + (split.singles.length + split.paired.length) + ' demoted unit(s) at Lv10 to Lv99.';
      delBox.textContent = '';
      if (split.paired.length) note(delBox, split.paired.length + ' demoted unit(s) still have a partner at the same level, so they are kept. Merge everything pairs them; if some stay, one of each pair is on the base and that storage is full, so merge those by hand.', '#d29922');
      if (!cand.length) { if (!split.paired.length) note(delBox, 'Nothing to delete: no units at Lv10 to Lv99.', '#3fb950'); return; }
      var by = {};
      cand.forEach(function (u) { var k = ROLE_NAME[TYPE_ROLE[u.type]] + ' Lv' + u.level; by[k] = (by[k] || 0) + 1; });
      note(delBox, 'These can never merge again: ' + Object.keys(by).sort().map(function (k) { return by[k] + ' x ' + k; }).join(', ') + '. Lv1 to Lv9 and Lv100+ are never deleted.', '#e6edf3');
      var delB = btn('Delete ' + cand.length + ' demoted unit(s)'); delB.style.color = '#f85149'; delB.style.borderColor = '#f85149';
      delBox.appendChild(delB); state.controls.push(delB);
      // re-read on the first tap so the confirm names exactly what the second tap deletes
      var pending = cand;
      confirmTap(delB, function () {
        try { refreshSnapshot(); } catch (e) { return 'Open your base first'; }
        pending = TC.splitDeletable(state.snap.stored.concat(state.snap.units)).singles;
        return pending.length ? 'Tap again to permanently delete ' + pending.length + ' unit(s)' : 'Nothing to delete any more';
      }, function () {
        if (!pending.length) { paintCleanup(); return; }
        var stored = pending.filter(function (u) { return u.wh; }), onBase = pending.filter(function (u) { return !u.wh; }), steps = [];
        for (var i = 0; i < stored.length; i += 100) steps.push({ kind: 'deleteStored', ids: stored.slice(i, i + 100).map(function (u) { return u.id; }) });
        onBase.forEach(function (u) { steps.push({ kind: 'deleteUnit', id: u.id }); });
        delBox.textContent = '';
        runWithProgress(delBox, steps, 'Deleting', function (res) { paintCleanup(); note(delBox, res.ok ? 'Done.' : res.error, res.ok ? '#3fb950' : '#d29922'); });
      });
    }
    confirmTap(mergeB, 'Tap again to merge everything that can merge', function () {
      s1say('');
      mergePasses(s1, function (res) { paintCleanup(); s1say(res.ok ? (res.merged > 0 ? 'Merging finished: ' + res.merged + ' fewer units, more free storage.' : 'Nothing left to merge.') : res.error, res.ok ? '#3fb950' : '#d29922'); paintBuild(); });
    });
    paintCleanup(); state.painters.push(paintCleanup);

    // 2. training skin
    var s2 = sub(c, '2. Training skin'), s2out = el('div', 'display:flex;flex-direction:column;gap:6px;'); s2.appendChild(s2out);
    function paintSkin() {
      s2out.textContent = '';
      var best = TC.bestTrainingSkin(state.snap.skins.owned, state.snap.skins.current);
      if (!best.change && !best.value) { note(s2out, 'None of your base skins add training speed, so your skin stays as it is.', '#8b949e'); return; }
      if (!best.change) { note(s2out, 'Your current skin already has the best training speed you own (+' + best.value / 100 + '%).', '#3fb950'); return; }
      var name = (state.snap.skins.owned.filter(function (s) { return s.id === best.id; })[0] || {}).name || ('skin ' + best.id);
      var b = btn('Wear ' + name + ' (+' + best.value / 100 + '% training speed, now +' + best.currentValue / 100 + '%)');
      s2out.appendChild(b); state.controls.push(b);
      confirmTap(b, 'Tap again to switch your base skin', function () {
        // remember the skin worn before the first switch; saved first so every card can offer it at once
        if (state.snap.uid) { try { var key = 'tp_prevSkin_' + state.snap.uid; if (!localStorage.getItem(key)) localStorage.setItem(key, String(state.snap.skins.current)); } catch (e) {} }
        runWithProgress(s2out, [{ kind: 'equipSkin', id: best.id }], 'Switching skin', function (res) {
          paintSkin(); note(s2out, res.ok ? 'Done. "When your base is full" can put your old skin back.' : res.error, res.ok ? '#3fb950' : '#d29922');
        });
      });
    }
    paintSkin(); state.painters.push(paintSkin);

    // 3. training buildings
    var s3 = sub(c, '3. Training buildings'), findB = btn('Find spare spots'), s3out = el('div', 'display:flex;flex-direction:column;gap:6px;');
    s3.appendChild(findB); s3.appendChild(s3out); state.controls.push(findB);
    function paintBuild() { s3out.textContent = ''; }      // a plan from an older read is stale
    state.painters.push(paintBuild);
    findB.onclick = async function () {
      if (state.busy || state.running) return;
      setBusy(true); s3out.textContent = '';
      var status = note(s3out, 'Finding spare spots...', '#e6edf3');
      try {
        refreshSnapshot();                    // the panel may have been open for hours
        var r = state.region, snap = state.snap, TG = window.TroopGame, solver = true, land, seaSlots = [];
        try { await TG.loadHighs(); } catch (e) { solver = false; }
        if (solver) {
          try {
            var lm = TC.buildLandLP(r, { mode: 'planes' });
            land = TC.decodeLand(lm, await TG.solve(lm.lp, 20), r);
            var sm = TC.buildSeaSlotsLP(r, TC.occupiedCells(r));
            if (sm.lp) seaSlots = TC.decodeSeaSlots(sm, await TG.solve(sm.lp, 20));
          } catch (e) { solver = false; }
        }
        if (!solver || !land) { land = TC.greedyLand(r, {}) || { slots: [] }; seaSlots = []; }
        var sites = { land: TC.freeSites(r, land.slots.map(function (s) { return s.pos; }), 1), sea: TC.freeSites(r, seaSlots, 0) };
        // plus free holes off the ideal grid (a full base's gaps rarely line up with it)
        var gridCells = {};
        sites.land.forEach(function (p) { var xy = TC.fromPosId(p); TC.footprint(xy[0], xy[1], 2, 2).forEach(function (c2) { gridCells[c2] = true; }); });
        sites.land = sites.land.concat(TC.holeSites(r, 1, gridCells));
        if (!solver) sites.sea = TC.holeSites(r, 0, {});      // no solver: free 2x2 sea spots, so Shipyards still get places
        var existing = { army: [], air: [], navy: [] };
        snap.buildings.forEach(function (b) { var role = GROUP_ROLE[b.group]; if (role) existing[role].push(b.pos); });
        var free = {};
        ['army', 'air', 'navy'].forEach(function (k) { free[k] = Math.max(0, snap.storage[k].max - snap.storage[k].used); });
        var per = 0;
        [1040, 1050, 1100].forEach(function (g) { var b = snap.buildable[g]; if (b) per = Math.max(per, b.build_coin + 5 * b.produce_coin); });
        // size by storage plus the free base space the new units can land on
        var occ = TC.occupiedCells(r), openQ = TC.trainEstimate(snap.buildings, snap.buildable, { skipNavy: state.fkboats });
        var fit = TC.navyFit(r), seaUnits = fit.greedy;          // how many navy really fit on the sea now
        if (solver && fit.lp) {
          try {
            var fs = await TG.solve(fit.lp, 20), cols = (fs && fs.Columns) || {};
            seaUnits = Math.max(seaUnits, fit.vars.filter(function (v) { return cols[v] && cols[v].Primal > 0.5; }).length);
          } catch (e) {}
        }
        var counts = TC.buildingCounts({
          seaUnits: seaUnits, skipNavy: state.fkboats,
          landSites: sites.land.length, seaSites: sites.sea.length,
          landCells: r.landCells.filter(function (c) { return !occ[c]; }).length,
          seaCells: r.seaCells.filter(function (c) { return !occ[c]; }).length,
          free: free, open: { army: openQ.army.units, air: openQ.air.units, navy: openQ.navy.units }
        });
        var plan = TC.buildingSites(sites, free, existing, counts);
        ['army', 'air', 'navy'].forEach(function (k) { if (!snap.buildable[{ army: 1040, air: 1050, navy: 1100 }[k]]) plan[k] = []; });
        var want = plan.army.length + plan.air.length + plan.navy.length;
        plan = TC.fitToGold(plan, per, snap.gold);
        var n = plan.army.length + plan.air.length + plan.navy.length;
        status.remove();
        note(s3out, sites.land.length + ' spare land spot(s) and ' + sites.sea.length + ' spare sea spot(s). Free storage: ' + free.army + ' army, ' + free.air + ' planes, ' + free.navy + ' navy.', '#e6edf3');
        if (state.fkboats) note(s3out, 'fkboats mode is on, so no Shipyards are planned.', '#8b949e');
        if (!solver) note(s3out, 'The exact solver could not load, so these spots come from the near-optimal plan.', '#d29922');
        if (n < want) note(s3out, 'Your gold covers ' + n + ' of the ' + want + ' buildings that would fit.', '#d29922');
        var floorOnly = r.landCells.filter(function (c) { return !occ[c] && r.floor[c]; }).length;
        if (!sites.land.length && floorOnly) note(s3out, floorOnly + ' free land tile(s) are covered by floor tiles. Units can stand there, but the game does not allow buildings on floors.', '#8b949e');
        if (!n) { note(s3out, 'Nothing to build: no spare spots, or no room left for the units more buildings would train.', '#d29922'); return; }
        note(s3out, 'Each building queues 5 units. The count is sized so those units fit in your storage or on the free base space that is left.', '#8b949e');
        note(s3out, TC.buildSummary(plan, snap.buildable) + ' for about ' + fmt(n * per) + ' gold, including one full queue each.', '#e6edf3');
        var cv = el('canvas', 'width:100%;max-width:520px;background:#0d1117;border:1px solid #30363d;border-radius:4px;'); cv.width = 680; s3out.appendChild(cv);
        var cats = TC.renderModel(snap, r, { slots: [], armyCells: [] }, null).before, outl = [];
        Object.keys(cats).forEach(function (k) { if (cats[k] === 'decoMoving') cats[k] = 'deco'; });
        ['army', 'air', 'navy'].forEach(function (k) { plan[k].forEach(function (p) { var xy = TC.fromPosId(p); TC.footprint(xy[0], xy[1], 2, 2).forEach(function (c2) { cats[c2] = 'newBld'; }); outl.push({ x: xy[0], y: xy[1], w: 2, h: 2 }); }); });
        drawMap(cv, cats, outl);
        var go = btn('Build ' + n + ' training building' + (n === 1 ? '' : 's'), true); s3out.appendChild(go); state.controls.push(go);
        confirmTap(go, 'Tap again to spend about ' + fmt(n * per) + ' gold', function () {
          var steps = [];
          ['army', 'air', 'navy'].forEach(function (k) {
            var id = snap.buildable[{ army: 1040, air: 1050, navy: 1100 }[k]].id;
            plan[k].forEach(function (p) { steps.push({ kind: 'build', buildingId: id, to: TC.fromPosId(p) }); });
          });
          runWithProgress(s3out, steps, 'Building', function (res) {
            go.remove();      // the plan is spent (or partly built): Find spare spots makes a fresh one
            note(s3out, res.ok ? 'Built ' + steps.length + ' training building' + (steps.length === 1 ? '' : 's') + '. Next: fill every training queue.' : res.error + ' Tap Find spare spots for a fresh plan.', res.ok ? '#3fb950' : '#d29922');
          });
        });
      } catch (e) {
        s3out.textContent = ''; note(s3out, 'Could not find spots. Close this panel and try again.', '#f85149');
      } finally { setBusy(false); }
    };

    // 4. train and refill
    var s4 = sub(c, '4. Train');
    note(s4, 'Fills every training queue (5 per building, one unit at a time). The game also spends your free instant trainings, and those units arrive at once. Refill merges them and trains again, round after round, until no room is left. Storage fills first; if it is full, plan a layout below and turn the lock on first so new units land in planned spots.');
    var trainB = btn('Fill every training queue', true), refillB = btn('Refill: merge, train, repeat until full'), s4out = el('div', 'display:flex;flex-direction:column;gap:6px;');
    var s4say = statusLine(s4out);
    s4.appendChild(trainB); s4.appendChild(refillB); s4.appendChild(s4out); state.controls.push(trainB, refillB);
    function trainSteps() {
      var have = {};
      state.snap.buildings.forEach(function (b) { if (GROUP_ROLE[b.group]) have[GROUP_ROLE[b.group]] = true; });
      return ['army', 'air', 'navy'].filter(function (k) { return have[k] && !(k === 'navy' && state.fkboats); }).map(function (k) { return { kind: 'train', role: k, tolerant: true }; });
    }
    // one Bulk Training round; done(ok, summary, text)
    function trainOnce(label, done) {
      var steps = trainSteps();
      if (!steps.length) { done(true, { ordered: 0, instant: 0, roles: {} }, 'No training buildings yet.'); return; }
      runWithProgress(s4out, steps, label, function (res, resp) {
        var sum = TC.summariseTraining(steps.map(function (st, i) { return { role: st.role, r: resp[i] }; }));
        var lines = steps.filter(function (st) { return sum.roles[st.role]; }).map(function (st) {
          var x = sum.roles[st.role], name = ROLE_NAME[st.role] + ': ';
          if (x.skipped) return name + 'nothing to queue (queues full or no space)';
          if (x.error != null) return name + 'declined by the game (code ' + x.error + ')';
          return name + x.num + ' ordered, ' + x.instant + ' done instantly';
        });
        done(res.ok, sum, (res.ok ? '' : res.error + ' ') + lines.join('. ') + '.');
      });
    }
    // storage full and the lock off: new units land on the game's nearest free tiles, not planned spots
    function lockHint(sum) {
      if (window.TroopGame.lockActive && window.TroopGame.lockActive()) return '';
      var STORE = { army: 'Garage', air: 'Hangar', navy: 'Dock' }, full = [];
      Object.keys(sum.roles || {}).forEach(function (k) {
        var x = sum.roles[k], st = state.snap.storage[k];
        if (x && x.num > 0 && st && st.used >= st.max) full.push(STORE[k]);
      });
      return full.length ? ' Your ' + full.join(' and ') + (full.length > 1 ? ' are' : ' is') + ' full, so new units land on the nearest free tiles. To place them neatly, plan a layout below and turn the lock on before training.' : '';
    }
    function train() {
      s4say('');
      trainOnce('Training', function (ok, sum, text) { s4say(text + lockHint(sum), ok ? '#3fb950' : '#d29922'); });
    }
    // Refill: merge, train, and go round again while units arrive instantly, so no room is left empty
    var MAX_ROUNDS = 8;
    function refill(round, tot) {
      mergePasses(s4out, function (res) {
        paintCleanup();
        if (!res.ok) { s4say(res.error, '#d29922'); return; }
        tot.merged += res.merged || 0;
        trainOnce('Training (round ' + round + ')', function (ok, sum, text) {
          tot.ordered += sum.ordered; tot.instant += sum.instant;
          if (ok && TC.refillAgain(sum, round, MAX_ROUNDS)) {
            s4say('Round ' + round + ': ' + sum.instant + ' unit(s) arrived instantly. Merging them and training again...', '#e6edf3');
            refill(round + 1, tot); return;
          }
          var occ = TC.occupiedCells(state.region), open = TC.trainEstimate(state.snap.buildings, state.snap.buildable, { skipNavy: state.fkboats }).total.units;
          var land = state.region.landCells.filter(function (c) { return !occ[c]; }).length, ships = state.fkboats ? 0 : TC.navyFit(state.region).greedy;   // fkboats: no sea talk
          var room;
          if (!open) room = ' Every training queue is full. Run Refill again once they finish to keep filling the base.';
          else if (land || ships) room = ' Nothing more fits right now: ' + land + ' land tile(s) are free' + (ships ? ' and ' + ships + ' ship(s) would fit on the sea' : '') + ', but in pieces. Use Layout below to pack them, then Refill again.';
          else room = ' No free spots left on the base.';
          s4say((ok ? 'Done after ' + round + ' round(s): ' : '') + text + ' In total ' + tot.ordered + ' ordered (' + tot.instant + ' instantly), ' + tot.merged + ' fewer units from merging.' + room + lockHint(sum), ok ? '#3fb950' : '#d29922');
        });
      });
    }
    // the confirm names the spend, worked out from a fresh read of the queues
    function trainCost(prefix) {
      return function () {
        try { refreshSnapshot(); } catch (e) { return 'Open your base first'; }
        var e = TC.trainEstimate(state.snap.buildings, state.snap.buildable, { skipNavy: state.fkboats }).total;
        return e.units ? prefix + 'queue up to ' + e.units + ' units for about ' + fmt(e.gold) + ' gold' : prefix + 'train (every queue looks full)';
      };
    }
    confirmTap(trainB, trainCost('Tap again to '), train);
    confirmTap(refillB, trainCost('Tap again to merge, repeat while units arrive instantly, and '), function () {
      s4say(''); refill(1, { ordered: 0, instant: 0, merged: 0 });
    });
  }

  // ---------------------------------------------------------------- when the base is full (v2)
  function fullCard() {
    var TC = window.TroopCore, c = card('When your base is full');
    note(c, 'Clear the extra training buildings so planes and army can use those spots, then use Layout below to pack everything.');
    var out = el('div', 'display:flex;flex-direction:column;gap:6px;'); c.appendChild(out);
    // a building whose footprint touches unit tiles: deleting it frees space, so on a tie keep another one
    function inUnitArea(b) {
      var r = state.region, cells = {}; r.landCells.concat(r.seaCells).forEach(function (c2) { cells[c2] = true; });
      var xy = TC.fromPosId(b.pos);
      return TC.footprint(xy[0], xy[1], b.w || 2, b.h || 2).some(function (c2) { return cells[c2]; });
    }
    function extrasNow() {
      return TC.extrasToClear(state.snap.buildings.filter(function (b) { return GROUP_ROLE[b.group]; }), state.snap.storage, { skipNavy: state.fkboats, inUnitArea: inUnitArea });
    }
    function paint() {
      out.textContent = '';
      var now = extrasNow(), extras = now.extras;
      var STORE = { army: 'Garage', air: 'Hangar', navy: 'Dock' }, waiting = Object.keys(now.waiting);
      if (waiting.length) note(out, 'Kept for now while storage has room: ' + waiting.map(function (k) { return STORE[k] + ' ' + now.waiting[k] + ' free'; }).join(', ') + '. Those buildings keep training until it fills.', '#8b949e');
      var busy = state.snap.buildings.filter(function (b) { return GROUP_ROLE[b.group] && b.busy; }).length;
      var total = state.snap.buildings.filter(function (b) { return GROUP_ROLE[b.group]; }).length;
      if (!extras.length && busy && total > 3) note(out, busy + ' of your ' + total + ' training buildings are still training. Buildings that are training are never deleted, so come back once their queues finish.', '#d29922');
      else if (!extras.length && !waiting.length) note(out, 'No extra training buildings. You have at most one of each type.', '#3fb950');
      else {
        var by = {}; extras.forEach(function (b) { by[b.group] = (by[b.group] || 0) + 1; });
        note(out, 'Extra training buildings: ' + Object.keys(by).map(function (g) { return bld(Number(g), by[g]); }).join(', ') + '. One of each type is kept' + (busy ? ', and buildings still training are kept until they finish' : '') + '.', '#e6edf3');
        var del = btn('Delete ' + extras.length + ' extra training building' + (extras.length === 1 ? '' : 's')); del.style.color = '#f85149'; del.style.borderColor = '#f85149';
        out.appendChild(del); state.controls.push(del);
        var pendingB = extras;
        confirmTap(del, function () {
          try { refreshSnapshot(); } catch (e) { return 'Open your base first'; }
          pendingB = extrasNow().extras;
          return pendingB.length ? 'Tap again to permanently delete ' + pendingB.length + ' building' + (pendingB.length === 1 ? '' : 's') : 'Nothing to delete any more';
        }, function () {
          if (!pendingB.length) { paint(); return; }
          runWithProgress(out, pendingB.map(function (b) { return { kind: 'deleteBuilding', id: b.id }; }), 'Deleting buildings', function (res) { paint(); note(out, res.ok ? 'Done.' : res.error, res.ok ? '#3fb950' : '#d29922'); });
        });
      }
      var prev = null; try { if (state.snap.uid) prev = Number(localStorage.getItem('tp_prevSkin_' + state.snap.uid)); } catch (e) {}
      var owned = state.snap.skins.owned.filter(function (s) { return s.id === prev; })[0];
      if (prev && owned && prev !== state.snap.skins.current) {
        var rs = btn('Put back ' + (owned.name || 'your previous skin')); out.appendChild(rs); state.controls.push(rs);
        confirmTap(rs, 'Tap again to switch your base skin back', function () {
          runWithProgress(out, [{ kind: 'equipSkin', id: prev }], 'Switching skin', function (res) {
            if (res.ok) { try { localStorage.removeItem('tp_prevSkin_' + state.snap.uid); } catch (e) {} }
            paint(); note(out, res.ok ? 'Your previous skin is back.' : res.error, res.ok ? '#3fb950' : '#d29922');
          });
        });
      }
    }
    paint(); state.painters.push(paint);
  }

  // ---------------------------------------------------------------- boot
  var boot = card();
  var bootMsg = note(boot, 'Loading...', '#e6edf3');
  ensureDeps().then(function () {
    if (window.TroopGame.isReady()) return true;
    bootMsg.textContent = 'Taking you to your base...';          // from the world map, go home first
    return window.TroopGame.goHome ? window.TroopGame.goHome(45000) : false;
  }).then(function (atHome) {
    if (!atHome) throw new Error('Open your base and wait for it to finish loading, then tap the bookmark again.');
    state.snap = window.TroopGame.readSnapshot();
    state.region = window.TroopCore.buildRegion(state.snap);
    boot.remove();
    scanCard();
    rebuildCard();
    fullCard();
    modeCard();
  }).catch(function (e) {
    bootMsg.textContent = e.message;
    bootMsg.style.color = '#f85149';
  });
})();
