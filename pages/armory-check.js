/* armory.html?check=1: the acceptance script from fable-redesign.md 5.5, run against the real page and real data.
 * Loaded only when the query has check=1 (never for regular visitors). Logs "[check] PASS|FAIL|INFO name :: detail"
 * to the console and sets window.__check = {done, pass, fail, results}. */
(function () {
'use strict';
var A = window.__arm, S = A.S, core = A.core, RES = [];
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function log(ok, name, detail) { RES.push({ ok: ok, name: name, detail: detail || '' }); console.log('[check] ' + (ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : '')); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* Google Translate's widget is third-party markup (.goog-te-*, .skiptranslate, iframe.goog-te-*): its text and controls are not ours to size, so the size and target checks skip them. Our own CSS still sizes its select (checked on its own below). */
var THIRD = '.goog-te-gadget, .goog-te-combo, [class*="goog-te-"], [class*="VIpgJd-"], .skiptranslate, iframe.goog-te-banner-frame, #google_translate_element, #goog-gt-tt';
/* [class*="VIpgJd-"] is the widget's current spinner / banner markup (its spinner runs an infinite animation after a translate) */
function third(el) { return !!(el && el.closest && el.closest(THIRD)); }
function vis(el) {
  if (!el.getClientRects().length) return false;
  for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; }
  return true;
}
function textNodes() {
  var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  for (var n; (n = w.nextNode());) { var p = n.parentElement; if (!p || /^(SCRIPT|STYLE)$/.test(p.tagName) || !n.nodeValue.trim() || p.closest('#fw-overlay, #fw-hdr-btn') || third(p)) continue; out.push(n); }
  return out;
}
function small() {
  var bad = [];
  textNodes().forEach(function (n) { var fs = parseFloat(getComputedStyle(n.parentElement).fontSize); if (fs < 12) bad.push(fs + 'px "' + n.nodeValue.trim().slice(0, 24) + '"'); });
  $$('input, textarea, select').forEach(function (el) { var fs = parseFloat(getComputedStyle(el).fontSize); if (vis(el) && !third(el) && fs < 12) bad.push(fs + 'px <' + el.tagName + '>'); });
  return bad;
}
var TARGETS = 'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
function targets() {
  var bad = [], n = 0;
  $$(TARGETS).forEach(function (el) {
    if (el.classList.contains('skip') || third(el) || !vis(el)) return;
    n++;
    var r = el.getBoundingClientRect(), min = el.matches('.move, .area, .hrow, .bar a, .segs button, .tab, .pick, summary') ? 44 : 40;
    if (r.width < min - 0.5 || r.height < min - 0.5) bad.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18) + '"');
  });
  return { n: n, bad: bad };
}
function overflow() {
  var bad = [], vw = window.innerWidth;
  if (document.documentElement.scrollWidth > vw + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
  $$('.view:not([hidden]) *').forEach(function (el) {
    if (!vis(el)) return;
    var r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1) && bad.length < 4) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  return bad;
}
var ROUTES = ['overview', 'heroes/battle', 'heroes/roster', 'heroes/gear', 'heroes/gear?view=runes', 'heroes/advice', 'base', 'beasts', 'ht/loadouts', 'ht/pool'];
function visit(r) { A.go(r); A.applyRoute(false); return sleep(/advice/.test(r) ? 700 : /^ht/.test(r) ? 400 : 70); }
function cyrb53(str) {
  var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/* Hand-derived for Rex's fixture data (siteKey c3c6f3200a4ec1fb), not read back from nextMoves().
   decor: March Size needs 1,440 shards (the bag has 683), so the next stat is All units Attack; Coastal Defence Lv.2 to 3 is +150 (1.5%)
          for 180 raw, 120 credited from spare pieces, 60 net; it ties Celebratory Firework on ROI and wins on cost.
   refine: the fixture has three heroes with gold gear, in power order Vivian 956,210, Hiccup 927,210, Jett 927,210. Vivian is the strongest and has
          pieces under 70%, so every refine pick is hers (hero rank is strict: a weaker hero's piece never beats hers, whatever its share of low stats).
          Her lowest under-70 stat per piece: Raysor Headset 56 (of 56/93/74), Assault Pistol 54 (72/54/91), Portable GPS 54 (75/89/54),
          Optical Add-on 52, Power Boots 51, Tactical Backarmor 50. Closest to 70% first: the Headset (56) is first; the Pistol and the GPS tie at 54
          and the key (slot 1 before slot 5) puts the Pistol second. A signal holds at most 2 picks, so the GPS is not shown.
   HT: Rex fights with Luminary Knight LP-4 (all chips Lv.25), so Doom Sawblade D-4 gives no chip move. */
var REX = 'c3c6f3200a4ec1fb';
var EXPECTED = [
  ['Uses what you have', 'Upgrade Coastal Defence to Lv.3: +1.5% All units Attack', '60 shards'],
  ['Costs resources', 'Refine Raysor Headset on Vivian', '1 stat under 70% (56%)'],
  ['Costs resources', 'Refine Assault Pistol on Vivian', '1 stat under 70% (54%)']
];

(async function () {
  await sleep(600);
  var t0 = Date.now();
  while (!S.vm && Date.now() - t0 < 30000) await sleep(200);
  await sleep(400);
  if (!S.vm) { log(false, 'the page reached a ready state', 'no view-model after 30 s'); window.__check = { done: true, pass: 0, fail: 1, results: RES }; return; }
  var mobile = window.innerWidth < 768, i;
  log(null, 'viewport', window.innerWidth + 'x' + window.innerHeight + (mobile ? ' (mobile layout)' : ' (desktop layout)') + ' ' + navigator.userAgent.replace(/\s+/g, ' ').slice(0, 90));
  var isRex = S.res.player.siteKey === REX;

  /* 1. content starts within 120 px (mobile) */
  var tops = [], badTop = [];
  for (i = 0; i < ROUTES.length; i++) {
    await visit(ROUTES[i]); window.scrollTo(0, 0);
    var first = $('.view:not([hidden]) .vb:not([hidden]) > *'), top = first ? Math.round(first.getBoundingClientRect().top + window.scrollY) : -1;
    tops.push(ROUTES[i] + '=' + top); if (top > 120 || top < 0) badTop.push(ROUTES[i]);
  }
  if (mobile) log(badTop.length === 0, 'content starts <= 120 px on every mobile view', tops.join(' ')); else log(null, 'content start (desktop, not part of the criterion)', tops.join(' '));

  /* 2-3. font floor and targets on every view, then every sheet */
  var smallAll = [], tgtBad = [], tgtN = 0;
  S.all = S.all || {}; S.all.gear = true; S.all.roster = true;
  for (i = 0; i < ROUTES.length; i++) {
    await visit(ROUTES[i]);
    var t = targets(); tgtN += t.n; t.bad.forEach(function (b) { tgtBad.push(ROUTES[i] + ': ' + b); });
    smallAll = smallAll.concat(small().map(function (x) { return ROUTES[i] + ': ' + x; }));
  }
  var sheets = 0;
  async function sheetTest(kind, arg, label) {
    A.openSheet(kind, arg); await sleep(220);
    small().forEach(function (x) { smallAll.push(label + ': ' + x); });
    var tt = targets(); tgtN += tt.n; tt.bad.forEach(function (b) { tgtBad.push(label + ': ' + b); });
    var ov = overflow(); if (ov.length) tgtBad.push(label + ' overflow ' + ov.join('; '));
    sheets++; A.closeSheet(true);
  }
  await visit('overview');
  await sheetTest('status', null, 'status'); await sheetTest('settings', null, 'settings'); await sheetTest('explain', 'gear', 'explain'); await sheetTest('bag', null, 'bag');
  await visit('heroes/battle'); await sheetTest('filter', null, 'filter');
  var dd = S.vm.decor.placed.filter(function (x) { return x.nx; })[0]; if (dd) await sheetTest('decor', dd.n, 'decor item');
  await visit('overview'); $('#pagesBtn').click(); await sleep(60);
  var tp = targets(); tgtN += tp.n; tp.bad.forEach(function (b) { tgtBad.push('pages: ' + b); }); smallAll = smallAll.concat(small()); $('#pagesBtn').click();
  log(smallAll.length === 0, 'no text under 12 px (all views and ' + sheets + ' sheets)', smallAll.length ? smallAll.slice(0, 4).join(' | ') : 'checked at ' + window.innerWidth + ' px');
  var combo = $('select.goog-te-combo');
  if (combo) { var cr = combo.getBoundingClientRect(), cf = parseFloat(getComputedStyle(combo).fontSize); log(cr.height >= 40 && cf >= 14, 'translate widget select is >= 40 px tall with 14 px+ text', Math.round(cr.width) + 'x' + Math.round(cr.height) + ', ' + cf + 'px'); }
  log(tgtBad.length === 0, 'interactive targets >= 40x40 (44 for bottom bar, tabs, segments and rows)', tgtBad.length ? tgtBad.slice(0, 5).join(' | ') : tgtN + ' elements measured');
  S.all.gear = false; S.all.roster = false;

  /* 4. numbers carry a label and a source word */
  await visit('overview');
  var nums = $$('#v-overview [data-num]'), badNum = [], SRC = /(battle reports?|in roster|placed|in bag|deployed|collected|equipped|in game data|alliance list)/;
  nums.forEach(function (n) { var w = n.closest('[data-numwrap]'), l = w && $('.lbl', w), s = w && $('.src', w); if (!w || !l || !s || !l.textContent.trim() || !SRC.test(s.textContent)) badNum.push(n.textContent.trim().slice(0, 12)); });
  log(nums.length > 0 && badNum.length === 0, 'every Overview number has a label and a source word', nums.length + ' numbers' + (badNum.length ? ', missing: ' + badNum.join(', ') : ''));

  /* 5. Next moves */
  var rows = $$('#v-overview .move'), VERBS = /^(Place|Merge|Refine|Upgrade|Swap|Fill|Raise|Save)\b/, mm = [], okMoves = rows.length > 0 && rows.length <= 3;
  rows.forEach(function (r, k) {
    var txt = $('.move-t', r).textContent, pill = $('.pill', r), meta = $('.move-m', r) ? $('.move-m', r).textContent : '';
    if (txt.length > 60) { okMoves = false; mm.push('too long: ' + txt); }
    if (!VERBS.test(txt)) { okMoves = false; mm.push('not verb first: ' + txt); }
    if (!pill || !/^(Free|Uses what you have|Costs resources)$/.test(pill.textContent)) { okMoves = false; mm.push('row ' + (k + 1) + ' pill'); }
    if (!$('.mico', r)) { okMoves = false; mm.push('row ' + (k + 1) + ' has no icon'); }
    if (isRex) { var e = EXPECTED[k]; if (!e || txt !== e[1] || pill.textContent !== e[0] || meta.indexOf(e[2]) < 0) { okMoves = false; mm.push('row ' + (k + 1) + ' is "' + pill.textContent + ' | ' + txt + ' | ' + meta + '"'); } }
    console.log('[moves] ' + (pill ? pill.textContent : '?') + ' | ' + txt + ' (' + txt.length + ') | ' + meta + ' | ' + r.getAttribute('href'));
  });
  if (isRex && rows.length !== EXPECTED.length) { okMoves = false; mm.push(rows.length + ' rows, expected ' + EXPECTED.length); }
  log(okMoves, 'Next moves: ' + (isRex ? 'the hand-computed list for this data, ' : '') + '<= 60 characters, verb first, pill, icon', mm.join('; ') || rows.length + ' rows');
  if (isRex) {
    var base = core.nextMoves(S.vm.movesInput, { max: 3 }).picks.map(function (m) { return m.text; });
    var mut = JSON.parse(JSON.stringify(S.vm.movesInput)); mut.decor.shards = 0;
    var mt = core.nextMoves(mut, { max: 3 }).picks.map(function (m) { return m.text; });
    log(mt.length > 0 && !mt.some(function (x) { return /Coastal Defence/.test(x); }) && mt.join('|') !== base.join('|'), 'mutation 1: with 0 shards the Coastal Defence move goes away', mt.join(' | '));
    var m2 = JSON.parse(JSON.stringify(S.vm.movesInput));
    m2.heroes.forEach(function (h) { if (h.name === 'Vivian') h.gear.forEach(function (g) { if (g.slot === 4) g.stats.forEach(function (x) { x.v = x.m; }); }); });
    var mt2 = core.nextMoves(m2, { max: 3 }).picks.map(function (x) { return x.text; });
    log(!mt2.some(function (x) { return /Raysor Headset on Vivian/.test(x); }) && mt2.join('|') !== base.join('|'), 'mutation 2: a fully rolled Raysor Headset on Vivian is no longer refined', mt2.join(' | '));
    var m3 = JSON.parse(JSON.stringify(S.vm.movesInput)); m3.ht.reportMechas = [1005];
    var mt3 = core.nextMoves(m3, { max: 3 }).picks.map(function (x) { return x.text; });
    log(mt3.some(function (x) { return /Doom Sawblade D-4/.test(x); }), 'mutation 3: when the report shows Doom Sawblade, its chip move appears', mt3.join(' | '));
  }

  /* 6. no emoji, no external stylesheet or font, CSP identical to the classic page */
  var em = [], re = /\p{Extended_Pictographic}/u;
  textNodes().forEach(function (n) { if (re.test(n.nodeValue)) em.push(n.nodeValue.trim().slice(0, 20)); });
  log(em.length === 0, 'no emoji code points in text nodes', em.slice(0, 3).join(' | '));
  var GOOG = /^https:\/\/[^/]*(google|gstatic|googleapis)\./;
  var ext = $$('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]').filter(function (l) { return !GOOG.test(l.href); }).length, ff = 0, imp = 0, nonInline = 0;
  Array.prototype.forEach.call(document.styleSheets, function (ss) { if (ss.href && GOOG.test(ss.href)) return; if (!ss.ownerNode || ss.ownerNode.tagName !== 'STYLE') nonInline++; var rules; try { rules = ss.cssRules; } catch (e) { return; } /* cross-origin sheet (the translate widget's): skipped */ Array.prototype.forEach.call(rules, function (r) { if (r.type === 5) ff++; if (r.type === 3) imp++; }); });
  log(ext === 0 && ff === 0 && imp === 0 && nonInline === 0, 'no external stylesheet or font', 'link tags ' + ext + ', @font-face ' + ff + ', @import ' + imp + ', non-inline sheets ' + nonInline);
  var mine = document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  try {
    var v1 = await fetch('armory-report.html', { cache: 'no-store' }).then(function (r) { return r.text(); });
    var m = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(v1);
    log(!!m && m[1] === mine, 'CSP identical to armory-report.html', 'hash ' + cyrb53(mine) + (m ? ' vs ' + cyrb53(m[1]) : ' (classic page not found)'));
  } catch (e) { log(false, 'CSP identical to armory-report.html', 'could not read the classic page: ' + e.message); }

  /* 7. display face */
  function meas(font, text) { var s = document.createElement('span'); s.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:48px;font-weight:700;font-family:' + font; s.textContent = text; document.body.appendChild(s); var w = s.getBoundingClientRect().width; s.remove(); return w; }
  var T = 'Gear score 12.9K Next moves 0123456789', stack = getComputedStyle(document.documentElement).getPropertyValue('--display');
  var wD = meas(stack, T), wS = meas('sans-serif', T), fams = stack.split(',').map(function (x) { return x.trim().replace(/^"|"$/g, ''); }), resolved = 'none';
  for (i = 0; i < fams.length; i++) {
    if (/^(sans-serif|serif|monospace)$/.test(fams[i])) continue;
    var q = '"' + fams[i] + '"'; if (meas(q + ',monospace', T) !== meas('monospace', T) && meas(q + ',serif', T) !== meas('serif', T)) { resolved = fams[i]; break; }
  }
  var apple = /Mac|iPhone|iPad/.test(navigator.userAgent);
  log(Math.abs(wD - wS) > 0.5, 'display face differs from sans-serif (width measure)', 'resolved: ' + resolved + '; stack width ' + wD.toFixed(1) + ' vs sans-serif ' + wS.toFixed(1) + (apple ? '' : ' (not an Apple platform: falling back is expected)'));
  var bodyFam = getComputedStyle(document.body).fontFamily, titleFam = getComputedStyle($('#v-overview .title')).fontFamily;
  log(bodyFam !== titleFam, 'display face is not the body face', 'body ' + bodyFam.slice(0, 30) + ' | title ' + titleFam.slice(0, 30));
  var ovAll = [];
  document.documentElement.style.setProperty('--display', 'Roboto,Arial,sans-serif');
  for (i = 0; i < ROUTES.length; i++) { await visit(ROUTES[i]); overflow().forEach(function (x) { ovAll.push(ROUTES[i] + ': ' + x); }); }
  document.documentElement.style.removeProperty('--display');
  var robotoHere = meas('Roboto,monospace', T) !== meas('monospace', T) && meas('Roboto,serif', T) !== meas('serif', T);
  log(ovAll.length === 0, 'layout survives the Roboto fallback without overflow', (ovAll.slice(0, 3).join(' | ') || ROUTES.length + ' views at ' + window.innerWidth + ' px') + (robotoHere ? ' (Roboto is installed here)' : ' (Roboto is not installed on this machine: this run measured the Arial fallback after it)'));
  var ovn = [];
  for (i = 0; i < ROUTES.length; i++) { await visit(ROUTES[i]); overflow().forEach(function (x) { ovn.push(ROUTES[i] + ': ' + x); }); }
  log(ovn.length === 0, 'no horizontal page scroll', ovn.slice(0, 3).join(' | ') || 'ok at ' + window.innerWidth + ' px');

  /* 8. light DOM, text in the DOM, translate="no" on numbers, codes and names */
  var sh = $$('*').filter(function (e) { return e.shadowRoot; }).length;
  log(sh === 0, 'light DOM only', 'shadow roots: ' + sh);
  log($$('canvas, svg text, object, embed').length === 0, 'all page text is in the DOM', 'no canvas, no text in images');
  function noTr(n) { for (var e = n.parentElement; e; e = e.parentElement) { var t = e.getAttribute('translate'); if (t === 'no') return true; if (t === 'yes') return false; } return false; }
  var names = {}, V = S.vm;
  V.heroes.list.forEach(function (h) { names[h.name] = 1; h.pieces.forEach(function (g) { names[g.slotName] = 1; if (g.rune) names[g.rune.name] = 1; }); });
  V.decor.placed.forEach(function (x) { names[x.n] = 1; }); names[V.header.name] = 1; V.ht.chips.forEach(function (c) { names[c.ht] = 1; });
  var nameList = Object.keys(names).filter(function (n) { return n && n.length > 3; }), trBad = [];
  $$('.view').forEach(function (v) { v.hidden = false; });
  S.all.gear = true; S.all.roster = true; A.applyRoute(false); $$('.view').forEach(function (v) { v.hidden = false; });
  textNodes().forEach(function (n) {
    var tx = n.nodeValue; if (noTr(n)) return;
    if (/\d/.test(tx)) trBad.push('digits "' + tx.trim().slice(0, 30) + '"');
    else for (var k = 0; k < nameList.length; k++) if (tx.indexOf(nameList[k]) >= 0) { trBad.push('name "' + nameList[k] + '"'); break; }
  });
  log(trBad.length === 0, 'numbers, codes and names carry translate="no"', trBad.length + ' text nodes without it' + (trBad.length ? ': ' + trBad.slice(0, 4).join(' | ') : ''));

  /* visual rules */
  var radBad = {}, shBad = 0, gradBad = [], loopBad = 0, loopNames = [], upBad = [];
  $$('body *').forEach(function (el) {
    if ((el.closest('svg') && el.tagName !== 'svg') || el.closest('#fw-overlay, #fw-hdr-btn') || third(el)) return;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].forEach(function (p) {
      var v = cs[p]; if (v === '0px' || v === '4px' || v === '6px' || v === '12px' || v === '50%') return;
      var px = parseFloat(v); if (r.width && px >= Math.min(r.width, r.height) / 2 - 0.5) return; radBad[v + ' ' + (el.className || el.tagName)] = 1;
    });
    if (cs.boxShadow !== 'none' || cs.textShadow !== 'none') shBad++;
    if (cs.backgroundImage.indexOf('gradient') >= 0 && !el.classList.contains('gcard')) gradBad.push(el.className);
    /* the fk boats loader orbits only while a load is pending (#main aria-busy); the check is about the ready page */
    if (cs.animationIterationCount.indexOf('infinite') >= 0 && !el.closest('[aria-busy="true"]')) { loopBad++; loopNames.push(String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || el.tagName)); }
    if (cs.textTransform === 'uppercase' && !el.closest('.title')) upBad.push(el.className || el.tagName);
    if (cs.letterSpacing !== 'normal' && cs.letterSpacing !== '0px' && !el.closest('.title')) upBad.push('tracking ' + (el.className || el.tagName));
  });
  log(Object.keys(radBad).length === 0, 'radii only 0 / 4 / 6 / 12 / circle', Object.keys(radBad).slice(0, 4).join(' | '));
  log(shBad === 0, 'no shadows', shBad + ' elements');
  log(gradBad.length === 0, 'no gradients except the gold gear tint', gradBad.slice(0, 3).join(' | '));
  log(loopBad === 0, 'nothing loops, glows or cycles', loopBad + ' infinite animations' + (loopNames.length ? ': ' + loopNames.slice(0, 3).join(' | ') : ''));
  log(upBad.length === 0, 'all caps and tracking only on display section titles', upBad.slice(0, 3).join(' | '));
  var rm = false; Array.prototype.forEach.call(document.styleSheets, function (ss) { var rules; try { rules = ss.cssRules; } catch (e) { return; } Array.prototype.forEach.call(rules, function (r) { if (r.type === 4 && /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText)) rm = true; }); });
  log(rm, 'prefers-reduced-motion turns transitions off', rm ? 'rule present' : 'missing');
  /* the Google Translate widget's own logo (gstatic) is third-party markup, same exclusion as the size checks; our images stay strict */
  var imgs = $$('img').filter(function (m) { return !third(m); }), imgBad = imgs.filter(function (m) { return !/^https:\/\/(raw\.githubusercontent\.com|h5\.topwargame\.com|knight-cdn\.akamaized\.net)\//.test(m.src); });
  log(imgBad.length === 0, 'images only from origins the live CSP allows', imgs.length + ' images' + (imgBad.length ? ', bad: ' + imgBad[0].src : ''));
  var scripts = $$('script[src]').map(function (s) { return s.getAttribute('src'); }), badSrc = scripts.filter(function (s) { return !/^(tw-game-data|armory-core|armory-data|armory-vm|armory-app|armory-more|armory-ht|armory-advice|armory-advice-flows|armory-check|feedback-widget)\.js$|^https:\/\/translate\.googleapis\.com\//.test(s); });
  log(badSrc.length === 0, 'scripts only from this site and Google Translate', scripts.length + ' script tags' + (badSrc.length ? ', unexpected: ' + badSrc.join(', ') : ''));
  S.all.gear = false; S.all.roster = false;
  A.applyRoute(false);

  /* 9. Advice (phase 4): the Advice segment expanded (a plan checklist, or the advisor composer with a step and the builder), and its sheets */
  var advSmall = [], advTgt = [], advN = 0, advStrict = [];
  function advMeasure(label) {
    small().forEach(function (x) { advSmall.push(label + ': ' + x); });
    var t = targets(); advN += t.n; t.bad.forEach(function (b) { advTgt.push(label + ': ' + b); });
    var ov = overflow(); if (ov.length) advTgt.push(label + ' overflow ' + ov.join('; '));
    $$('#adviceBody button, #adviceBody summary, #adviceBody a[href], #sheetB button').forEach(function (el) {
      if (!vis(el)) return; var r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) advStrict.push(label + ': ' + (el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
  }
  await visit('heroes/advice'); await sleep(400);
  var advMode = '';
  if (S.advise) {
    advMode = 'advisor composer';
    $$('#adviceBody .hrow').forEach(function (b) { b.click(); }); await sleep(300); advMeasure('composer');
    var tile = $('#adviceBody [data-a="slot"]');
    if (tile) {
      A.openSheet('advice-builder', { h: +tile.dataset.ah, s: +tile.dataset.as }); await sleep(250);
      var vb = $('#sheetB [data-a="verb"]'); if (vb) { vb.click(); await sleep(150); }
      advMeasure('step builder');
      var pk = $('#sheetB [data-a="pick"]'); if (pk) { pk.click(); await sleep(250); }
      if (S.sheet) A.closeSheet(true);
      advMeasure('composer with a step');
    }
    $('#adviceBody [data-a="save"]') && advMeasure('composer end');
  } else {
    advMode = 'plan checklist';
    var pb = $('#adviceBody .adv-pb'); if (pb && pb.getAttribute('aria-expanded') !== 'true') pb.click(); await sleep(700);
    advMeasure('plan expanded');
    if ($('#adviceBody [data-a="ask"]')) { A.openSheet('advice-ask'); await sleep(220); advMeasure('ask sheet'); A.closeSheet(true); }
  }
  log(advSmall.length === 0, 'Advice (' + advMode + '): no text under 12 px', advSmall.length ? advSmall.slice(0, 4).join(' | ') : 'checked at ' + window.innerWidth + ' px');
  log(advTgt.length === 0, 'Advice (' + advMode + '): interactive targets >= 40x40, no horizontal overflow', advTgt.length ? advTgt.slice(0, 5).join(' | ') : advN + ' elements measured');
  log(advStrict.length === 0, 'Advice (' + advMode + '): every button, summary and link is >= 44x44 (step arrows, ticks, verbs)', advStrict.length ? advStrict.slice(0, 5).join(' | ') : 'ok');
  var advRows = $$('#adviceBody .adv-step').length;
  log(advRows > 0 || !!$('#adviceBody .hero') || !!$('#adviceBody .empty'), 'Advice (' + advMode + '): rows rendered', advRows + ' step rows');
  await visit('overview'); window.scrollTo(0, 0);

  /* layout and polish */
  await visit('overview'); window.scrollTo(0, 0); await sleep(250);
  function Rc(id) { var e = document.getElementById(id); return e ? e.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 }; }
  var hc = Rc('hdrCard'), mc = Rc('movesCard'), ac = Rc('areasCard'), sc2 = Rc('shareCard'), bandEl = $('#bandCard'), hasBand = bandEl && !bandEl.hidden;
  var wide = window.innerWidth >= 1024, bc = hasBand ? Rc('bandCard') : null;
  var gapOk = !hasBand ? true : wide ? (bc.left >= hc.right - 0.5 && Math.abs(bc.top - hc.top) < 2 && hc.bottom + 8 <= mc.top + 0.5 && bc.bottom + 8 <= ac.top + 0.5)
    : (hc.bottom + 8 <= bc.top + 0.5 && bc.bottom + 8 <= mc.top + 0.5 && mc.bottom + 8 <= ac.top + 0.5 && (!document.getElementById('shareCard') || ac.bottom + 8 <= sc2.top + 0.5));
  log(gapOk, 'strength band sits beside (>=1024) or between (below) the header card and Next moves, 8 px+ apart', 'header ' + Math.round(hc.top) + '-' + Math.round(hc.bottom) + ', moves ' + Math.round(mc.top) + '-' + Math.round(mc.bottom) + ', areas ' + Math.round(ac.top) + '-' + Math.round(ac.bottom));
  if (window.innerWidth < 480) log(hc.height <= 190, 'header card height on a phone', Math.round(hc.height) + ' px (limit 190)');
  var sepEl = $('#hdrCard .sep'), sepHidden = sepEl && getComputedStyle(sepEl).display === 'none';
  if (sepEl) log(window.innerWidth < 480 ? sepHidden : !sepHidden, 'the separator has class sep: hidden below 480 px, shown above', 'display ' + getComputedStyle(sepEl).display);
  var warnEls = $$('#hdrCard .c-warn'), anyWarn = (V.header.reports && V.header.reports.warn) || (V.header.data && V.header.data.warn);
  log(!anyWarn || (warnEls.length >= 1 && warnEls.every(function (e) { return getComputedStyle(e).color === 'rgb(210, 153, 34)'; })), 'ages of 30 days or more are in the warn colour', warnEls.length + ' age labels');
  log($('#hdr').classList.contains('who-off'), 'top-bar name is hidden while the header card shows it', 'who-off=' + $('#hdr').classList.contains('who-off'));
  var pors = $$('#hdrCard .por').length, mico = $$('#movesCard .mico').length;
  log(pors === Math.min(3, V.heroes.list.length) && mico === rows.length, 'game art on the Overview: hero portraits and an icon on every move', pors + ' portraits, ' + mico + ' move icons');
  await visit('heroes/battle'); await sleep(250);
  log(!$('#hdr').classList.contains('who-off'), 'top-bar name is back on other views', 'who-off=' + $('#hdr').classList.contains('who-off'));
  var loose = [];
  function scanLoose(root, label) {
    $$('*', root).forEach(function (el) {
      if (!vis(el) || el.closest('svg')) return;
      var cs = getComputedStyle(el); if (!/flex|grid/.test(cs.display) || !(parseFloat(cs.columnGap) > 0)) return;
      var hasText = false, hasEl = false;
      for (var nn = el.firstChild; nn; nn = nn.nextSibling) {
        if (nn.nodeType === 3 && nn.nodeValue.trim()) hasText = true;
        else if (nn.nodeType === 1 && !/^(svg|style|script)$/i.test(nn.tagName) && nn.textContent.trim()) hasEl = true;
      }
      if (hasText && hasEl && loose.length < 6) loose.push(label + ':' + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"');
    });
  }
  for (i = 0; i < ROUTES.length; i++) { await visit(ROUTES[i]); scanLoose($('.view:not([hidden])'), ROUTES[i]); }
  A.openSheet('status'); await sleep(220); scanLoose($('#sheet'), 'status'); A.closeSheet(true);
  log(loose.length === 0, 'no loose text next to a sibling inside a gapped flex row (the double-space bug)', loose.join(' | ') || 'none found in ' + ROUTES.length + ' views and the status sheet');
  /* vocabulary: no internal stat abbreviations, no impossible "x of y stars", no two spans side by side without a separator */
  var vtext = [];
  for (i = 0; i < ROUTES.length; i++) { await visit(ROUTES[i]); vtext.push($('.view:not([hidden])').innerText); }
  var allText = vtext.join('\n');
  log(!/\bAF\b|DMG[+-]/.test(allText), 'no internal stat abbreviations (AF, DMG+, DMG-) in visible text', (allText.match(/\bAF\b|DMG[+-]/) || [''])[0]);
  var badStars = (allText.match(/(\d+) of (\d+) stars/g) || []).filter(function (t) { var m = /(\d+) of (\d+)/.exec(t); return +m[1] > +m[2]; });
  log(badStars.length === 0, 'no "x of y stars" with x above y', badStars.slice(0, 3).join(' | '));
  var sp = [];
  for (i = 0; i < ROUTES.length; i++) {
    await visit(ROUTES[i]);
    $$('.view:not([hidden]) *').forEach(function (el) {
      if (!vis(el) || el.closest('svg')) return;
      var cs = getComputedStyle(el); if (!/flex|grid/.test(cs.display) || !(parseFloat(cs.columnGap) > 0)) return;
      var kids = Array.prototype.filter.call(el.children, function (c) { return c.tagName === 'SPAN' && c.textContent.trim() && !c.hasAttribute('aria-hidden') && !c.classList.contains('dot'); });
      var oneLine = kids.length >= 2 && kids.every(function (c) { var r = c.getBoundingClientRect(); return r.height <= 26 && Math.abs(r.top - kids[0].getBoundingClientRect().top) < 4; });
      if (oneLine && Array.prototype.filter.call(el.children, function (c) { return c.hasAttribute('aria-hidden') && /\u00B7/.test(c.textContent); }).length === 0 && !el.matches('.bm-num, .irow, .hb-1, .sechead, .chips, .nb, .stars, .buffs li, .hc-pills') && sp.length < 5) sp.push(ROUTES[i] + ':' + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 30) + '"');
    });
  }
  log(sp.length === 0, 'no sibling text spans in a gapped flex row without a separator', sp.join(' | ') || 'none');
  /* 10. HT (phase 3): Loadouts and Chip pool */
  await visit('ht/loadouts'); await sleep(300);
  var hCards = $$('#v-ht [data-pane="loadouts"] .ht-card'), hFirst = $('#v-ht .ht-card.is-open') || hCards[0], hSlots = hFirst ? hFirst.querySelectorAll('.ht-slot').length : 0;
  log(hCards.length > 0 && hSlots === 7, 'HT Loadouts: a card per HT, the one in battle reports (or the only one) open with its 7 chip slots', hCards.length + ' cards, ' + hSlots + ' slot rows in the first');
  var hTog = $$('#v-ht [data-hto]')[1], hWas = hTog ? hTog.getAttribute('aria-expanded') : null;
  if (hTog) { hTog.click(); await sleep(60); }
  var hNow = hTog ? $$('#v-ht [data-hto]')[1].getAttribute('aria-expanded') : null;
  log(!hTog || hNow !== hWas, 'HT Loadouts: a card opens and closes from its header', hTog ? hWas + ' -> ' + hNow : 'one HT only');
  var hLv = $$('#v-ht [data-pane="loadouts"] .ht-slot:not(.ht-sel) .ht-sb').length, hMax = /at Lv\.25|of 25/.test($('#v-ht [data-pane="loadouts"]').textContent);
  log(hLv > 0 && hMax, 'HT Loadouts: each chip shows its level and the stat it gives', hLv + ' chip rows');
  var hEmoji = /\p{Extended_Pictographic}/u.test($('#v-ht').textContent.replace(/[\u00A9\u00AE\u2122]/g, ''));
  log(!hEmoji, 'HT: no emoji in the section', hEmoji ? 'found one' : 'none');
  log(/^Source: (game data|battle reports)/.test((hFirst && hFirst.querySelector('.foot') || { textContent: '' }).textContent.trim()), 'HT Loadouts: the card footer names its source', hFirst && hFirst.querySelector('.foot') ? hFirst.querySelector('.foot').textContent.trim() : 'no footer');
  await visit('ht/pool'); await sleep(200);
  var hHasPool = !!(S.res.supp.chips && S.res.supp.chips.chips && S.res.supp.chips.chips.length), hPc = $$('#v-ht .ht-pc').length, hOk, hWhat;
  if (!hHasPool) { hOk = !!$('#v-ht [data-pane="pool"] .empty'); hWhat = 'empty state'; }
  else if (mobile) {
    A.openSheet('htfilter'); await sleep(250);
    var hCh = $$('#sheetB [data-htc]'), hSel = $$('#sheetB select');
    hOk = hCh.length >= 14 && hSel.length === 3 && hPc > 0 && hPc <= 24 && hCh.concat(hSel).every(function (x) { return x.getBoundingClientRect().height >= 39.5; });
    hWhat = hCh.length + ' chips + ' + hSel.length + ' selects in the Filter sheet, ' + hPc + ' cards'; A.closeSheet(true);
  } else { var hS = $$('#v-ht select[data-htf]'); hOk = hS.length === 7 && hPc > 0 && hPc <= 24 && hS.every(function (x) { return x.getBoundingClientRect().height >= 39.5; }); hWhat = hS.length + ' inline filters, ' + hPc + ' cards'; }
  log(hOk, 'HT Chip pool: filters in the Filter sheet on a phone (inline on desktop) at 40 px+, and a first page of chips, or the empty state without an import', hWhat);
  /* a flex parent trims the edge spaces of a bare text node: "Slot " + <span>1</span> reads "Slot1". Flag any such node in the HT screens. */
  var lostSp = [];
  for (var hr = 0; hr < 2; hr++) {
    await visit(hr ? 'ht/pool' : 'ht/loadouts'); await sleep(150);
    $$('#v-ht *').forEach(function (el) { if (!/flex|grid/.test(getComputedStyle(el).display) || !el.children.length) return; Array.prototype.forEach.call(el.childNodes, function (n) { if (n.nodeType === 3 && /\S/.test(n.nodeValue) && (/^\s/.test(n.nodeValue) || /\s$/.test(n.nodeValue))) lostSp.push((el.className || el.tagName) + ' "' + n.nodeValue.trim().slice(0, 16) + '"'); }); });
  }
  log(lostSp.length === 0, 'HT: no text node with an edge space directly inside a flex or grid parent (the "Slot1" bug)', lostSp.slice(0, 3).join(' | ') || 'none');
  var hStat = $$('#v-ht').map(function (e) { return e.textContent; }).join(' ');
  log(!/DMG Taken-|\bATK\b|\bINV\b|\bInc\b|\bEnh\b|\bAF\b/.test(hStat), 'HT: chip stats are written out (no DMG Taken-, ATK, INV, Inc, Enh, AF)', (hStat.match(/DMG Taken-|\bATK\b|\bINV\b|\bInc\b|\bEnh\b|\bAF\b/) || [''])[0]);
  await visit('ht/loadouts');
  /* routes: the legacy #tab= ids resolve to a view */
  await visit('overview'); window.scrollTo(0, 0);
  var fails = RES.filter(function (r) { return r.ok === false; }).length, passes = RES.filter(function (r) { return r.ok === true; }).length;
  console.log('[check] SUMMARY pass=' + passes + ' fail=' + fails);
  window.__check = { done: true, pass: passes, fail: fails, results: RES };
})();
})();
