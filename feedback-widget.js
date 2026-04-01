(function () {
  'use strict';

  var PUSH_WORKER = 'https://push-worker.27tb8s6fct.workers.dev';

  var PAGE_LIST = [
    { label: 'Home',             path: '/' },
    { label: 'Bases',            path: '/bases.html' },
    { label: 'Battle Report',    path: '/battle-report.html' },
    { label: 'Heroes',           path: '/heroes.html' },
    { label: 'Decoration Index', path: '/decor-index.html' },
    { label: 'Armory Report',    path: '/armory-report.html' },
    { label: 'Roadmap',          path: '/roadmap.html' },
    { label: 'UD Sector Map',    path: '/ssc-map.html' },
    { label: 'UD Treasury',      path: '/treasury.html' },
  ];

  // --- SVG helpers (safe DOM-based creation, no innerHTML) ---
  var NS = 'http://www.w3.org/2000/svg';
  function makeSvg(w, h, defs) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.style.verticalAlign = '-2px';
    defs.forEach(function (d) {
      var el = document.createElementNS(NS, d.tag || 'path');
      Object.keys(d).forEach(function (k) { if (k !== 'tag') el.setAttribute(k, d[k]); });
      svg.appendChild(el);
    });
    return svg;
  }

  var CHAT_DEFS = [{ d: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' }];
  var BUG_DEFS  = [{ tag: 'circle', cx: '12', cy: '12', r: '10' }, { tag: 'line', x1: '12', y1: '8', x2: '12', y2: '12' }, { tag: 'line', x1: '12', y1: '16', x2: '12.01', y2: '16' }];
  var STAR_DEFS = [{ tag: 'polygon', points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }];

  // --- Helpers ---
  function getIdentity() {
    try {
      var raw = localStorage.getItem('playerIdentity');
      if (!raw || raw === 'anonymous') return null;
      var id = JSON.parse(raw);
      return (id && id.name && !id.guest) ? id : null;
    } catch (e) { return null; }
  }

  function currentPagePath() {
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    var file = '/' + path.split('/').pop();
    return (file === '/') ? '/' : file;
  }

  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'cls') { e.className = attrs[k]; }
      else if (k === 'text') { e.textContent = attrs[k]; }
      else if (k === 'css') { e.style.cssText = attrs[k]; }
      else { e.setAttribute(k, attrs[k]); }
    });
    return e;
  }

  // --- Styles ---
  function injectStyles() {
    if (document.getElementById('fw-styles')) return;
    var s = document.createElement('style');
    s.id = 'fw-styles';
    s.textContent = [
      // Header trigger button — matches .home-btn style used across all pages
      '#fw-hdr-btn{display:flex;align-items:center;gap:.3rem;background:var(--card,#1c2128);border:1px solid var(--border,#30363d);color:var(--muted,#8b949e);border-radius:8px;padding:.4rem .55rem;cursor:pointer;font-family:inherit;font-size:.72rem;transition:all .15s;white-space:nowrap;margin-left:auto;}',
      '#fw-hdr-btn:hover{border-color:var(--accent,#79c0ff);color:var(--accent,#79c0ff);}',
      // Overlay + modal
      '#fw-overlay{display:none;position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.6);align-items:center;justify-content:center;}',
      '#fw-overlay.fw-open{display:flex;}',
      '#fw-modal{background:var(--surface,#161b22);border:1px solid var(--border,#30363d);border-radius:10px;padding:1.25rem;width:90vw;max-width:400px;max-height:85vh;overflow-y:auto;position:relative;}',
      '#fw-modal-title{margin:0 0 .85rem;font-size:.92rem;color:var(--text,#e6edf3);display:flex;align-items:center;gap:.4rem;}',
      '#fw-close-btn{position:absolute;top:.5rem;right:.75rem;background:none;border:none;color:var(--muted,#8b949e);font-size:1.1rem;cursor:pointer;line-height:1;padding:0;}',
      '.fw-type-row{display:flex;border:1px solid var(--border,#30363d);border-radius:6px;overflow:hidden;margin-bottom:.85rem;}',
      '.fw-type-btn{flex:1;padding:.4rem;font-size:.72rem;border:none;background:transparent;color:var(--muted,#8b949e);cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:.25rem;}',
      '.fw-type-btn.fw-active{background:var(--accent,#79c0ff);color:#0d1117;}',
      '.fw-input{width:100%;margin-bottom:.65rem;padding:.45rem .6rem;background:var(--bg2,#0d1117);border:1px solid var(--border,#30363d);border-radius:6px;color:var(--text,#e6edf3);font-family:inherit;font-size:.78rem;box-sizing:border-box;}',
      '.fw-input:focus{outline:none;border-color:var(--accent,#79c0ff);}',
      'textarea.fw-input{min-height:90px;resize:vertical;}',
      '.fw-page-lbl{font-size:.68rem;color:var(--muted,#8b949e);margin-bottom:.25rem;}',
      '.fw-footer{display:flex;justify-content:space-between;align-items:center;margin-top:.75rem;}',
      '.fw-who{font-size:.63rem;color:var(--muted,#8b949e);}',
      '.fw-submit-btn{background:var(--accent,#79c0ff);color:#0d1117;border:none;border-radius:6px;padding:.45rem 1.1rem;font-size:.78rem;cursor:pointer;font-family:inherit;font-weight:600;}',
      '.fw-submit-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.fw-result{text-align:center;padding:.75rem 0;}',
      '.fw-result-icon{font-size:1.8rem;margin-bottom:.35rem;}',
      '.fw-result-msg{font-size:.82rem;color:var(--text,#e6edf3);}',
      '.fw-result-sub{font-size:.68rem;color:var(--muted,#8b949e);margin-top:.2rem;}',
      '.fw-result-sub a{color:var(--accent,#79c0ff);}',
    ].join('');
    document.head.appendChild(s);
  }

  // --- Build ---
  function buildWidget() {
    // Inject a Feedback button into the page header (.header class or bare <header> tag)
    var hdr = document.querySelector('.header') || document.querySelector('header');
    var triggerBtn = el('button', { id: 'fw-hdr-btn', title: 'Submit Feedback', 'aria-label': 'Submit Feedback' });
    triggerBtn.appendChild(makeSvg(13, 13, CHAT_DEFS));
    triggerBtn.appendChild(document.createTextNode(' Feedback'));
    if (hdr) {
      hdr.appendChild(triggerBtn);
    } else {
      // Fallback: fixed position if no header found
      triggerBtn.style.cssText = 'position:fixed;bottom:1.25rem;right:1.25rem;z-index:9000;';
      document.body.appendChild(triggerBtn);
    }

    // Overlay
    var overlay = el('div', { id: 'fw-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Submit Feedback' });
    var modal = el('div', { id: 'fw-modal' });

    var closeBtn = el('button', { id: 'fw-close-btn', 'aria-label': 'Close', text: '\u00D7' });
    modal.appendChild(closeBtn);

    var titleEl = document.createElement('h3');
    titleEl.id = 'fw-modal-title';
    titleEl.appendChild(makeSvg(14, 14, CHAT_DEFS));
    titleEl.appendChild(document.createTextNode(' Submit Feedback'));
    modal.appendChild(titleEl);

    // Bug / Feature toggle
    var typeRow = el('div', { cls: 'fw-type-row' });
    var bugBtn = el('button', { cls: 'fw-type-btn fw-active', 'data-type': 'bug' });
    bugBtn.appendChild(makeSvg(11, 11, BUG_DEFS));
    bugBtn.appendChild(document.createTextNode(' Bug Report'));
    var featBtn = el('button', { cls: 'fw-type-btn', 'data-type': 'feature' });
    featBtn.appendChild(makeSvg(11, 11, STAR_DEFS));
    featBtn.appendChild(document.createTextNode(' Feature Request'));
    typeRow.appendChild(bugBtn); typeRow.appendChild(featBtn);
    modal.appendChild(typeRow);

    // Form
    var form = el('div', { id: 'fw-form' });
    var titleInput = el('input', { cls: 'fw-input', type: 'text', placeholder: 'Brief title...', maxlength: '200' });
    form.appendChild(titleInput);
    var descInput = el('textarea', { cls: 'fw-input', placeholder: 'Describe the bug \u2014 what happened and what you expected...', maxlength: '2000' });
    form.appendChild(descInput);

    // Page selector
    form.appendChild(el('div', { cls: 'fw-page-lbl', text: 'Reporting from:' }));
    var pageSelect = el('select', { cls: 'fw-input', css: 'margin-bottom:0' });
    var curPath = currentPagePath();
    PAGE_LIST.forEach(function (p) {
      var opt = el('option', { value: p.label, text: p.label });
      if (p.path === curPath) opt.selected = true;
      pageSelect.appendChild(opt);
    });
    form.appendChild(pageSelect);

    var notifNote = el('div', { css: 'font-size:.63rem;color:#8b949e;line-height:1.5;margin-bottom:.5rem;' });
    notifNote.appendChild(document.createTextNode('\uD83D\uDCAC Want a notification when resolved? '));
    var notifLink = el('a', { css: 'color:#79c0ff;', target: '_blank', rel: 'noopener noreferrer' });
    notifLink.href = 'https://2864tw.com';
    notifLink.textContent = 'Install the PWA or enable push notifications';
    notifNote.appendChild(notifLink);
    notifNote.appendChild(document.createTextNode(' on the home page first.'));
    form.appendChild(notifNote);

    var footer = el('div', { cls: 'fw-footer' });
    var whoEl = el('span', { cls: 'fw-who' });
    var sendBtn = el('button', { cls: 'fw-submit-btn', text: 'Submit' });
    footer.appendChild(whoEl); footer.appendChild(sendBtn);
    form.appendChild(footer);
    modal.appendChild(form);

    var resultDiv = el('div', { cls: 'fw-result', css: 'display:none' });
    modal.appendChild(resultDiv);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // --- Behavior ---
    var feedbackType = 'bug';

    function openModal() {
      var identity = getIdentity();
      whoEl.textContent = identity ? 'Submitting as ' + identity.name : '';
      titleInput.value = ''; descInput.value = '';
      form.style.display = ''; resultDiv.style.display = 'none';
      sendBtn.disabled = false; sendBtn.textContent = 'Submit';
      [bugBtn, featBtn].forEach(function (b) { b.classList.remove('fw-active'); });
      bugBtn.classList.add('fw-active');
      feedbackType = 'bug';
      descInput.placeholder = 'Describe the bug \u2014 what happened and what you expected...';
      // Reset page select to current page
      var cp = currentPagePath();
      for (var i = 0; i < pageSelect.options.length; i++) {
        var pl = PAGE_LIST.find(function (p) { return p.label === pageSelect.options[i].value && p.path === cp; });
        if (pl) { pageSelect.selectedIndex = i; break; }
      }
      overlay.classList.add('fw-open');
      setTimeout(function () { titleInput.focus(); }, 50);
    }

    function closeModal() { overlay.classList.remove('fw-open'); }

    triggerBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    [bugBtn, featBtn].forEach(function (b) {
      b.addEventListener('click', function () {
        [bugBtn, featBtn].forEach(function (x) { x.classList.remove('fw-active'); });
        b.classList.add('fw-active');
        feedbackType = b.dataset.type;
        descInput.placeholder = feedbackType === 'bug'
          ? 'Describe the bug \u2014 what happened and what you expected...'
          : 'Describe the feature you would like to see...';
      });
    });

    sendBtn.addEventListener('click', function () {
      var t = titleInput.value.trim();
      var d = descInput.value.trim();
      if (!t || !d) return;
      sendBtn.disabled = true; sendBtn.textContent = 'Sending...';

      var identity = getIdentity();
      var submitter = identity ? identity.name : 'Anonymous';
      var pageName = pageSelect.value;
      var endpoint = feedbackType === 'bug' ? '/feedback/bug' : '/feedback/feature';

      fetch(PUSH_WORKER + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, description: d + '\n\nPage: ' + pageName, submitter: submitter }),
      }).then(function (r) { return r.json(); }).then(function (resp) {
        form.style.display = 'none'; resultDiv.style.display = '';
        while (resultDiv.firstChild) resultDiv.removeChild(resultDiv.firstChild);

        var icon = el('div', { cls: 'fw-result-icon' });
        var msg  = el('div', { cls: 'fw-result-msg' });
        var sub  = el('div', { cls: 'fw-result-sub' });
        resultDiv.appendChild(icon); resultDiv.appendChild(msg); resultDiv.appendChild(sub);

        if (resp.ok) {
          icon.textContent = '\u2705';
          if (feedbackType === 'bug' && resp.url && resp.issueNumber) {
            msg.textContent = 'Bug report submitted!';
            var link = document.createElement('a');
            // Sanitize URL — only allow safe URL characters
            link.href = String(resp.url).replace(/[^a-zA-Z0-9:/.#?=&_-]/g, '');
            link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.textContent = 'View GitHub issue #' + String(resp.issueNumber).replace(/\D/g, '');
            sub.appendChild(link);
          } else {
            msg.textContent = 'Feature request submitted!';
            sub.textContent = 'Thank you for your feedback!';
          }
        } else {
          icon.textContent = '\u274C';
          msg.textContent = String(resp.message || resp.error || 'Something went wrong.').slice(0, 200);
        }
        sendBtn.disabled = false; sendBtn.textContent = 'Submit';
      }).catch(function () {
        form.style.display = 'none'; resultDiv.style.display = '';
        while (resultDiv.firstChild) resultDiv.removeChild(resultDiv.firstChild);
        resultDiv.appendChild(el('div', { cls: 'fw-result-icon', text: '\u274C' }));
        resultDiv.appendChild(el('div', { cls: 'fw-result-msg', text: 'Network error \u2014 please try again.' }));
        sendBtn.disabled = false; sendBtn.textContent = 'Submit';
      });
    });
  }

  function init() {
    injectStyles();
    buildWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // (No re-check needed — button always visible)
})();
