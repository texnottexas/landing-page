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
  if (window.TroopGame) window.TroopGame.removeLock();   // a lock from an earlier panel never outlives it
  var root = el('div', 'position:fixed;inset:0;background:rgba(13,17,23,.92);z-index:2147483647;display:flex;flex-direction:column;padding:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e6edf3;text-align:left;line-height:1.35;');
  root.id = 'tp-overlay';
  var head = el('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
  head.appendChild(el('div', 'font-size:16px;font-weight:600;flex:1;', 'Troop Placement'));
  var closeBtn = el('button', 'background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;', 'Close');
  head.appendChild(closeBtn);
  root.appendChild(head);
  var body = el('div', 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;max-width:760px;width:100%;margin:0 auto;');
  root.appendChild(body);
  document.body.appendChild(root);
  closeBtn.onclick = function () { if (window.TroopGame) window.TroopGame.removeLock(); state.stop = true; root.remove(); };

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

  var state = { snap: null, region: null, mode: 'units', navy: false, fillArmy: false, keepPlanes: true, rows: [], row: null, stop: false, running: false };

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
      row.appendChild(b);
    });
    c.insertBefore(row, hint);
    function check(label, key) {
      var w = el('label', 'display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;');
      var i = el('input'); i.type = 'checkbox'; i.checked = state[key];
      i.onchange = function () { state[key] = i.checked; };
      w.appendChild(i); w.appendChild(document.createTextNode(label)); c.appendChild(w);
      return w;
    }
    var fill = check('Fill leftover tiles with army', 'fillArmy');
    var keep = check('Keep planes already on the base', 'keepPlanes');
    check('Also optimise the sea for navy', 'navy');
    var go = btn('Plan my base', true);
    go.onclick = function () { plan(); };
    c.appendChild(go);
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

  function solveLand(opts) {
    var TC = window.TroopCore, model = TC.buildLandLP(state.region, opts);
    return window.TroopGame.solve(model.lp, 20).then(function (sol) {
      if (!sol || (sol.Status !== 'Optimal' && sol.Status !== 'Time limit reached')) throw new Error('solver: ' + (sol && sol.Status));
      var t = TC.decodeLand(model, sol, state.region);
      if (sol.Status !== 'Optimal') t.approximate = true;
      return t;
    });
  }

  async function plan() {
    var TC = window.TroopCore;
    planOut.textContent = '';
    var status = note(planOut, 'Loading the solver...', '#e6edf3');
    state.rows = [];
    var exact = true;
    try { await window.TroopGame.loadHighs(); } catch (e) { exact = false; }
    var sea = null;
    try {
      if (state.navy && exact) {
        var sm = TC.buildSeaLP(state.region);
        var ssol = await window.TroopGame.solve(sm.lp, 20);
        sea = TC.decodeSea(sm, ssol);
      }
      var R = state.region.reqLand.length, planesNow = state.region.units.air.length;
      var ks = [];
      if (state.mode === 'planes') {
        status.textContent = 'Finding the most planes your land can hold...';
        var best = exact ? await solveLand({ mode: 'planes' }) : TC.greedyLand(state.region, {});
        var kMax = best.slots.length;
        addRow(best, sea);
        if (exact) {
          [1, 2, 3, 5, 8, 12, 17].forEach(function (d) { if (kMax - d - R > planesNow) ks.push(kMax - d); });
          for (var i = 0; i < ks.length; i++) {
            status.textContent = 'Checking cheaper options (' + (i + 1) + ' of ' + ks.length + ')...';
            var last = state.rows[state.rows.length - 1];
            if (last && last.result.stats.moves === 0) break;
            addRow(await solveLand({ mode: 'planes', count: ks[i] }), sea);
          }
        }
      } else {
        status.textContent = 'Working out the layout...';
        var t = exact ? await solveLand({ mode: state.mode, keepPlanes: state.keepPlanes }) : TC.greedyLand(state.region, { count: state.mode === 'half' ? R + Math.floor((state.region.landCells.length - 4 * R) / 8) : R + (state.keepPlanes ? planesNow : 0) });
        addRow(t, sea);
      }
    } catch (e) {
      status.textContent = 'Planning failed: ' + e.message;
      status.style.color = '#f85149';
      return;
    }
    status.remove();
    if (!exact) note(planOut, 'The exact solver could not load, so this plan is near-optimal (within about 3%).', '#d29922');
    renderRows();
  }

  function addRow(target, sea) {
    var TC = window.TroopCore;
    if (!target) return;
    if (sea) { target.navy = sea.navy; target.seaBld = sea.seaBld; }
    var result = TC.planSteps(state.snap, state.region, target, { mode: state.mode });
    var planes = target.slots.filter(function (s) { return s.role === 'air'; }).length;
    state.rows.push({ target: target, result: result, planes: planes });
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
    stopBtn.onclick = function () { state.stop = true; stopBtn.textContent = 'Stopping...'; };
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
        return b.reason === 'storage_full' ? b.remaining + ' ' + b.role + ' unit(s) need storage space first, so they stay put.' : 'Some units could not be placed. Try a cheaper option.';
      }).join(' ');
      armed = false;
      var nSteps = state.row.result.steps.length, isBlocked = state.row.result.blocked.length > 0;
      run.textContent = nSteps ? 'Run ' + nSteps + ' steps' : (isBlocked ? 'Nothing to run until storage frees up' : 'Already optimal');
      run.disabled = !state.row.result.steps.length;
      run.style.opacity = run.disabled ? '.5' : '1';
    }
    run.onclick = function () {
      if (state.running || !state.row) return;
      var n = state.row.result.steps.length;
      if (!armed) { armed = true; run.textContent = 'Tap again to start ' + n + ' steps (about ' + Math.ceil(n * 2.5 / 60) + ' min)'; setTimeout(function () { if (armed && !state.running) { armed = false; run.textContent = 'Run ' + n + ' steps'; } }, 4000); return; }
      armed = false;
      execute(state.row, run, progress, bar, progText, stopBtn, function () { choose(state.rows.indexOf(state.row)); });
    };
    choose(0);
  }

  async function execute(row, run, progress, bar, progText, stopBtn, repaint) {
    var TC = window.TroopCore, TG = window.TroopGame;
    state.running = true; state.stop = false;
    run.style.display = 'none'; progress.style.display = 'flex';
    stopBtn.textContent = 'Stop after this step';
    var steps = row.result.steps;
    var res = await TG.runSteps(steps, {
      shouldStop: function () { return state.stop; },
      onStep: function (i) { bar.style.width = Math.round((i + 1) / steps.length * 100) + '%'; progText.textContent = 'Step ' + (i + 1) + ' of ' + steps.length; }
    });
    // verify against the server-backed client state and re-plan whatever is left
    try {
      state.snap = TG.readSnapshot();
      state.region = TC.buildRegion(state.snap);
      row.result = TC.planSteps(state.snap, state.region, row.target, { mode: state.mode });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    state.running = false;
    progress.style.display = 'none'; run.style.display = 'block';
    repaint();
    var left = row.result.steps.length;
    if (res.ok && !left) note(planOut, 'Done and verified. Your base now matches the plan. Reload the game any time to double check.', '#3fb950');
    else note(planOut, (res.error ? res.error + ' ' : '') + left + ' step(s) left. Tap Run to resume.', '#d29922');
  }

  function lockCard() {
    var c = card('Lock new units to this plan');
    note(c, 'While this is on, new units from training, Kuruzo, Bulk Training or bulk add go into the planned spots instead of the nearest gap. It lasts until you close this panel or reload the game.');
    var b = btn('Turn lock on');
    var st = note(c, 'Lock is off.');
    b.onclick = function () {
      var TG = window.TroopGame;
      if (TG.lockActive()) { TG.removeLock(); b.textContent = 'Turn lock on'; st.textContent = 'Lock is off.'; return; }
      if (!state.row) return;
      TG.installLock(state.row.target, { mode: state.mode, fillArmy: state.fillArmy });
      b.textContent = 'Turn lock off';
      st.textContent = 'Lock is on. It only matters once that unit type\'s storage is full.';
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
