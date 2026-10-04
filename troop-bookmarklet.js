// 2864tw.com — Troop Placement Optimizer bookmarklet (v1).
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
    deco: '#8b949e', odd: '#6e7681',
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
  head.appendChild(el('div', 'font-size:16px;font-weight:600;flex:1;', 'Troop Placement'));
  var HEAD_BTN = 'background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;';
  var minBtn = el('button', HEAD_BTN, 'Minimise');
  var closeBtn = el('button', HEAD_BTN, 'Close');
  head.appendChild(minBtn); head.appendChild(closeBtn);
  root.appendChild(head);
  var body = el('div', 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;max-width:760px;width:100%;margin:0 auto;');
  root.appendChild(body);
  var pill = el('div', 'display:none;align-items:center;gap:10px;background:#161b22;border:1px solid #30363d;border-radius:20px;padding:6px 8px 6px 14px;box-shadow:0 4px 14px rgba(0,0,0,.5);font-size:13px;white-space:nowrap;');
  var pillText = el('span', '', 'Troop Placement');
  var openBtn = el('button', 'background:#1f6feb;color:#fff;border:none;border-radius:14px;padding:5px 12px;font-size:12px;cursor:pointer;', 'Open');
  pill.appendChild(pillText); pill.appendChild(openBtn);
  root.appendChild(pill);
  document.body.appendChild(root);
  function updatePill() {
    var TG = window.TroopGame;
    pillText.textContent = 'Troop Placement: lock ' + (TG && TG.lockActive() ? 'on' : 'off') + (state.progress ? ', ' + state.progress : '');
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

  var state = { snap: null, region: null, mode: 'units', navy: false, fillArmy: false, keepPlanes: true, rows: [], row: null, running: false, busy: false, progress: '', controls: [] };
  // nothing that changes the plan can be tapped while planning or running
  function setBusy(flag) {
    state.busy = flag;
    state.controls.concat(state.rows.map(function (r) { return r.button; })).forEach(function (c) {
      if (!c) return;
      c.disabled = flag; c.style.opacity = flag ? '.5' : '1'; c.style.pointerEvents = flag ? 'none' : '';
    });
  }

  // ---------------------------------------------------------------- scan
  function scanCard() {
    var c = card('Your base');
    var s = state.snap, r = state.region;
    var tbl = el('div', 'display:grid;grid-template-columns:auto auto auto auto;gap:4px 14px;font-size:12px;');
    ['Storage', 'Used', 'Max', 'Free'].forEach(function (h) { tbl.appendChild(el('div', 'color:#8b949e;', h)); });
    [['army', 'Garage (army)'], ['air', 'Hangar (planes)'], ['navy', 'Dock (navy)']].forEach(function (k) {
      var st = s.storage[k[0]];
      [k[1], st.used, st.max, Math.max(0, st.max - st.used)].forEach(function (v) { tbl.appendChild(el('div', '', String(v))); });
    });
    c.appendChild(tbl);
    var onMap = r.units.air.length + ' planes, ' + r.units.army.length + ' army, ' + r.units.navy.length + ' navy on the base';
    note(c, onMap + '. Usable land: ' + r.landCells.length + ' tiles. Usable sea: ' + r.seaCells.length + ' tiles.', '#e6edf3');
    if (r.landCells.length < 762) note(c, 'Some areas are still locked, so the plan covers the land you have open today.');
    if (r.units.odd.length) note(c, r.units.odd.length + ' unit(s) are busy or have an unusual size. They stay where they are.');
    if (r.unparked.length) note(c, r.unparked.length + ' decoration(s) have no free spot in the no-units zone, so they stay put.');
    note(c, 'Storage fills first. Units only land on the base once that storage is full.');
    var adv = s.slotAdvice, lines = [];
    Object.keys(adv.byType).forEach(function (k) {
      var name = k === 'army' ? 'Garage' : k === 'navy' ? 'Dock' : 'Hangar';
      var next = adv.byType[k].map(function (w) { return w.nextPrice; }).filter(function (p) { return p != null; });
      if (next.length) lines.push(name + ' next slot: ' + Math.min.apply(null, next) + ' slot items');
    });
    note(c, 'Advisory: you hold ' + adv.held + ' storage slot items. ' + (lines.length ? lines.join('. ') + '.' : 'Every storage building is at its slot limit.'));
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
    check('Also optimise the sea for navy', 'navy');
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
      var out = await window.TroopCore.planRows(state.snap, state.region, { mode: state.mode, keepPlanes: state.keepPlanes, navy: state.navy }, solver);
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

  // ---------------------------------------------------------------- boot
  var boot = card();
  var bootMsg = note(boot, 'Loading...', '#e6edf3');
  ensureDeps().then(function () {
    if (!window.TroopGame.isReady()) throw new Error('Open your base and wait for it to finish loading, then tap the bookmark again.');
    state.snap = window.TroopGame.readSnapshot();
    state.region = window.TroopCore.buildRegion(state.snap);
    boot.remove();
    scanCard();
    modeCard();
  }).catch(function (e) {
    bootMsg.textContent = e.message;
    bootMsg.style.color = '#f85149';
  });
})();
