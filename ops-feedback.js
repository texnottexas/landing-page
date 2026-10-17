// ops-feedback.js — Feedback & requests for the Ops Center (Tex 2026-10-17): a row pinned above the tiles, half a tile
// tall, so players find it easily. It opens a page that sends a bug report or a feature request to the worker, the
// way the site's feedback form does (bugs become GitHub issues, requests ADO items), under the player's in-game name.
// window.OpsFeedback = { row, page, payload, reserved } in the browser; the rules as module.exports for node tests.
(function () {
  'use strict';
  // The worker's RESERVED_SUBMITTER_NAMES: one sent without a verified account blocks the sender's IP for a week.
  var RESERVED = ['tex'];
  var TITLE_MAX = 200, DESC_MAX = 2000, GENERAL = 'Ops Center (general)';

  function reserved(name) { return RESERVED.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
  // What one submission sends: the worker cuts the description at 2000, so the details are cut first and the tool
  // line always fits. null = nothing to send.
  function payload(o) {
    var title = String(o.title || '').trim(), details = String(o.details || '').trim();
    if (!title || !details) return null;
    var suffix = '\n\nTool: ' + (String(o.tool || '').trim() || GENERAL) + '\nFrom: Ops Center';
    return {
      path: o.type === 'feature' ? '/feedback/feature' : '/feedback/bug',
      body: { title: title.slice(0, TITLE_MAX), description: details.slice(0, DESC_MAX - suffix.length) + suffix,
        submitter: String(o.name || '').trim().slice(0, 50) || 'Anonymous', source: 'ops' }
    };
  }
  var rules = { payload: payload, reserved: reserved, GENERAL: GENERAL };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }
  if (window.OpsFeedback) return;

  var CSS = [
    'button.opsf-row{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;height:56px;padding:0 12px;background:#1c2128;border:1px solid #388bfd;border-radius:12px;color:#e6edf3;font:inherit;text-align:left;cursor:pointer}',
    'button.opsf-row:hover{border-color:#79c0ff}button.opsf-row:focus-visible{outline:2px solid #79c0ff;outline-offset:2px}',
    '.opsf-row svg{flex:0 0 22px;width:22px;height:22px;stroke:#79c0ff;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.opsf-row-text{display:flex;flex-direction:column;min-width:0}',
    '.opsf-row-title{font-size:14px;font-weight:600}.opsf-row-sub{font-size:12px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.opsf-types{display:flex;gap:8px}',
    '.opsf-types button{flex:1;min-height:44px;border:1px solid #30363d;border-radius:10px;background:#0d1117;color:#8b949e;font:inherit;font-size:14px;font-weight:600;cursor:pointer}',
    '.opsf-types button[aria-pressed="true"]{border-color:#388bfd;color:#e6edf3;background:#1c2128}',
    'textarea.opsf-details{min-height:110px;resize:vertical;line-height:1.4}',
    '.opsf-who{font-size:12px;color:#8b949e}',
    '.opsf-error{font-size:14px;color:#f85149}',
    '.opsf-done{font-size:15px;color:#3fb950}'
  ].join('\n');
  function style() {
    var st = document.getElementById('opsf-style');
    if (!st) { st = document.createElement('style'); st.id = 'opsf-style'; document.head.appendChild(st); }
    if (st.textContent !== CSS) st.textContent = CSS;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function chatIcon() {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    p.setAttribute('d', 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5');
    svg.appendChild(p); return svg;
  }

  // The pinned row in the menu.
  function row(onClick) {
    style();
    var b = el('button', 'opsf-row'); b.id = 'opsf-btn'; b.type = 'button';
    b.appendChild(chatIcon());
    var t = el('span', 'opsf-row-text');
    t.appendChild(el('span', 'opsf-row-title', 'Feedback & requests'));
    t.appendChild(el('span', 'opsf-row-sub', 'Report a bug or ask for a feature'));
    b.appendChild(t);
    b.addEventListener('click', onClick);
    return b;
  }

  function readJson(r) { return r.json().catch(function () { return {}; }); }
  // A verified account (the game's own UID, the way the Snapshot signs in): the worker trusts the name it sends.
  function token(ctx) {
    if (!/^[0-9]{5,20}$/.test(String(ctx.uid || ''))) return Promise.resolve(null);
    return fetch(ctx.worker + '/supplement/handshake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: String(ctx.uid) }) })
      .then(function (r) { return r.ok ? readJson(r).then(function (j) { return (j && typeof j.token === 'string' && j.token) || null; }) : null; }, function () { return null; });
  }

  // ctx = { worker, uid, name, tools: [title], onDone }
  function page(body, ctx) {
    style();
    var type = 'bug';
    var types = el('div', 'opsf-types');
    var bugB = el('button', null, 'Bug report'), featB = el('button', null, 'Feature request');
    bugB.id = 'opsf-bug'; featB.id = 'opsf-feature'; bugB.type = featB.type = 'button';
    types.appendChild(bugB); types.appendChild(featB); body.appendChild(types);

    body.appendChild(el('div', 'ops-label', 'Which tool?'));
    var tool = el('select', 'ops-input'); tool.id = 'opsf-tool'; tool.setAttribute('aria-label', 'Which tool?');
    [GENERAL].concat(ctx.tools || []).forEach(function (t, i) { var o = el('option', null, t); o.value = i ? t : ''; tool.appendChild(o); });
    body.appendChild(tool);
    var title = el('input', 'ops-input'); title.id = 'opsf-title'; title.type = 'text'; title.maxLength = TITLE_MAX; title.placeholder = 'Short title';
    title.setAttribute('aria-label', 'Title'); body.appendChild(title);
    var details = el('textarea', 'ops-input opsf-details'); details.id = 'opsf-details'; details.maxLength = DESC_MAX;
    details.setAttribute('aria-label', 'Details'); body.appendChild(details);
    var name = String(ctx.name || '').trim();
    body.appendChild(el('div', 'opsf-who', name ? 'Sending as ' + name : 'Sending without a name'));
    var err = el('div', 'opsf-error'); err.hidden = true; body.appendChild(err);
    var send = el('button', 'ops-btn primary', 'Send'); send.id = 'opsf-send'; send.type = 'button'; body.appendChild(send);

    function setType(t) {
      type = t;
      bugB.setAttribute('aria-pressed', String(t === 'bug')); featB.setAttribute('aria-pressed', String(t === 'feature'));
      details.placeholder = t === 'bug' ? 'What happened, and what did you expect?' : 'What would you like it to do?';
    }
    function canSend() { send.disabled = !title.value.trim() || !details.value.trim(); }
    function fail(text) { err.textContent = text; err.hidden = false; send.textContent = 'Send'; canSend(); }
    bugB.addEventListener('click', function () { setType('bug'); });
    featB.addEventListener('click', function () { setType('feature'); });
    title.addEventListener('input', canSend); details.addEventListener('input', canSend);
    setType('bug'); canSend();

    send.addEventListener('click', function () {
      var p = payload({ type: type, title: title.value, details: details.value, tool: tool.value, name: name });
      if (!p || send.disabled) return;
      send.disabled = true; send.textContent = 'Sending...'; err.hidden = true;
      token(ctx).then(function (tok) {
        if (!tok && reserved(name)) { fail('Couldn\'t verify your account, so this can\'t be sent under the name ' + name + '. Try again in a minute.'); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (tok) headers.Authorization = 'Bearer ' + tok;
        return fetch(ctx.worker + p.path, { method: 'POST', headers: headers, body: JSON.stringify(p.body) }).then(function (r) {
          return readJson(r).then(function (j) {
            if (r.ok && j && j.ok) { done(p.path === '/feedback/bug' ? 'Thanks! Bug report sent' + (j.issueNumber ? ' (#' + String(j.issueNumber).replace(/\D/g, '') + ')' : '') + '.' : 'Thanks! Request sent.'); return; }
            var said = j && typeof j.message === 'string' && j.message.length < 120 ? j.message : '';
            fail(said || 'Couldn\'t send right now. Try again later.');
          });
        }, function () { fail('Couldn\'t send. Check your connection and try again.'); });
      });
    });
    function done(text) {
      body.textContent = '';
      body.appendChild(el('div', 'opsf-done', text));
      var back = el('button', 'ops-btn', 'Back to tools'); back.type = 'button';
      back.addEventListener('click', function () { if (ctx.onDone) ctx.onDone(); });
      body.appendChild(back);
    }
    setTimeout(function () { try { title.focus(); } catch (e) {} }, 50);
  }

  window.OpsFeedback = { row: row, page: page, payload: payload, reserved: reserved };
})();
