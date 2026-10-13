/* armory-coach.js: the "From your main march's last battle" card of the Armory v2 Overview (below Next moves), loaded after first
 * paint (armory-app.js coach()), never on the way to it. Of the player's 8 newest loaded battle reports it reads the one where their
 * own side had the highest Combat Power (their main march; a tie goes to the newer) with report-coach.js
 * (the same logic as the Battle Reports page), then adds what the player's Snapshot holds (ReportCoach.withSnapshot).
 * Same-origin script, no CSP change. Report and supplement strings reach the page only through textContent.
 * The rules sit in ArmoryCoachLogic (no DOM, node-testable); ArmoryCoach(H) is the view.
 *
 * Which side is the player: the report carries each player's uid; the player's siteKey is the first 16 hex of sha256(uid), so that
 * decides when it matches exactly one side. Only when it matches neither does the trimmed in-game name decide (the same
 * compare armory-data.js uses to read the player's march). The uid is hashed in place and never stored or shown.
 */
(function (root) {
'use strict';
var isNode = typeof module === 'object' && module.exports;

/* ---------- logic (no DOM) ---------- */
function num(v) { v = +v; return isFinite(v) ? v : 0; }

var MAX_READ = 8;   /* the newest reports read to find the main march */
/* the loaded reports [{id, extracted:{logtime}}] worth reading: usable ones, newest first, at most MAX_READ */
function recentReports(reports) {
  return (reports || []).filter(function (r) { return r && r.id && r.extracted; })
    .sort(function (a, b) { return num(b.extracted.logtime) - num(a.extracted.logtime); }).slice(0, MAX_READ);
}

/* the player's main march: of the analysed candidates [{id, logtime, cp}] (cp = the player's own side Combat Power in that report),
   the highest cp wins, a tie goes to the newest logtime, then to the first listed. null for no candidates. */
function pickMain(cands) {
  var best = null;
  (cands || []).forEach(function (c) {
    if (!c) return;
    if (!best || num(c.cp) > num(best.cp) || (num(c.cp) === num(best.cp) && num(c.logtime) > num(best.logtime))) best = c;
  });
  return best;
}

/* the player's side Combat Power in a raw report (the same field report-coach reads for side.cp), 0 when absent */
function sideCp(raw, key) {
  var fm = raw && raw.battle && raw.battle.fightMarches && raw.battle.fightMarches[0];
  return fm ? num(fm[(key === 'attacker' ? 'att' : 'def') + 'BattlePowerVal']) : 0;
}

/* one report as a main-march candidate {id, logtime, cp, raw, key}, or null when it can't be read or the player is on neither side.
   hashes = {attacker, defender}: the 16-hex sha256 prefix of each side's uid */
function candidate(rep, raw, hashes, sk, name) {
  if (!rep || !raw || !raw.battle) return null;
  var key = matchSide(hashes, sidePlayers(raw), sk, name);
  return key ? { id: rep.id, logtime: raw.logtime || (rep.extracted && rep.extracted.logtime), cp: sideCp(raw, key), raw: raw, key: key } : null;
}

/* "Your Vivian, Franziska and Jett march against J™ on Oct 10" as one string */
function marchLine(heroes, opp, date) {
  var list = (heroes || []).filter(Boolean), txt = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join('');
  return 'Your ' + (txt ? txt + ' march' : 'march') + ' against ' + opp + (date ? ' on ' + date : '');
}

/* each side's first player: {uid: String, name: trimmed username}, or null for a side with none */
function sidePlayers(raw) {
  var b = raw && raw.battle, out = {};
  ['attacker', 'defender'].forEach(function (k) {
    var ps = b && b[k] && b[k].players, p = ps && ps[0], pi = {};
    if (!p) { out[k] = null; return; }
    try { pi = JSON.parse(p.playerInfo || '{}'); } catch (e) { pi = {}; }
    out[k] = { uid: p.uid == null ? '' : String(p.uid), name: String(pi.username || '').trim() };
  });
  return out;
}

/* hashes: {attacker, defender} = the 16-hex sha256 prefix of each side's uid (or ''), sk = the player's siteKey (or null), name = the player's name.
   Returns 'attacker' | 'defender' | null. The name decides only when there is no siteKey or the uids could not be hashed:
   a siteKey that matches neither side means the player is not this report's march (a rally member, say), so no card. */
function matchSide(hashes, players, sk, name) {
  var hit = ['attacker', 'defender'].filter(function (k) { return players[k] && sk && hashes && hashes[k] === sk; });
  if (hit.length === 1) return hit[0];
  if (sk && hashes && (hashes.attacker || hashes.defender)) return null;
  var nm = String(name || '').trim().toLowerCase(), byName = ['attacker', 'defender'].filter(function (k) { return players[k] && nm && players[k].name.toLowerCase() === nm; });
  return byName.length === 1 ? byName[0] : null;
}

/* the one closeness line (the Battle Reports page words) */
function closenessText(fight, sides) {
  var c = fight && fight.closeness;
  if (!c) return '';
  var loser = fight.winner === 'attacker' ? 'defender' : 'attacker';
  var L = sides[loser].name, W = sides[fight.winner].name, pct = Math.round(c.loserProgress * 100), pt = pct < 1 ? 'under 1%' : pct + '%';
  return c.label === 'close' ? 'Close fight: ' + L + ' got ' + pt + ' of the way to winning.'
    : c.label === 'out-of-reach' ? 'Out of reach this time: ' + L + ' did ' + pt + ' of the damage needed to win.'
    : 'Clear win for ' + W + ': ' + L + ' got ' + pt + ' of the way to winning.';
}

var TIER = { free: 'Free', upgrade: 'Upgrade', long: 'Long term' };
var MAX_GAPS = 3, MAX_MOVES = 4;

/* what the card shows: {line, opp, date, gaps, moves, names, snap} from one analysed report and the player's side */
function cardModel(result, key, snapSide, logtime, hasSnap) {
  var me = snapSide || result.sides[key], other = result.sides[key === 'attacker' ? 'defender' : 'attacker'];
  /* the tier order stays (free, upgrade, long term); inside a tier a step the Snapshot can speak to comes first, so the four shown are the ones you can act on */
  var order = { free: 0, upgrade: 1, long: 2 };
  var moves = (me.moves || []).map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
    return (order[a.m.tier] - order[b.m.tier]) || ((b.m.extra ? 1 : 0) - (a.m.extra ? 1 : 0)) || (a.i - b.i);
  }).map(function (x) { return x.m; }).slice(0, MAX_MOVES);
  var names = [me.name, other.name].concat(me.heroes || [], other.heroes || []);
  moves.forEach(function (m) {
    (m.extraNames || []).forEach(function (n) { names.push(n); });
    var dd = m.data || {};
    [dd.weakest && dd.weakest.name, dd.theme, dd.missing, dd.buff].forEach(function (n) { if (n) names.push(n); });
  });
  return {
    heroes: (me.heroes || []).slice(), line: closenessText(result.fight, result.sides), opp: other.name, won: !!me.won, time: num(logtime),
    gaps: (me.gaps || []).slice(0, MAX_GAPS), moves: moves, names: names,
    snap: moves.some(function (m) { return !!m.extra; }), hasSnap: !!hasSnap
  };
}

var LOGIC = { recentReports: recentReports, candidate: candidate, MAX_READ: MAX_READ, pickMain: pickMain, sideCp: sideCp, marchLine: marchLine, sidePlayers: sidePlayers, matchSide: matchSide, closenessText: closenessText, cardModel: cardModel, TIER: TIER, MAX_GAPS: MAX_GAPS, MAX_MOVES: MAX_MOVES };
if (isNode) module.exports = LOGIC; else root.ArmoryCoachLogic = LOGIC;
if (isNode) return;

/* ---------- view ---------- */
root.ArmoryCoach = function (H) {
var S = H.S, d = H.d, core = H.core, $ = H.$;
var TABLES = ['all-heroes.json', 'supportive-skills.json', 'loot-quest-collectibles.json', 'formation-v2.json', 'enigma-platform-enhance.json', 'buff-group.json', 'enigma-platforms.json'];
var CARD = null;   /* {res, model} of the last run; a repaint of the Overview reuses it */
var runSeq = 0;

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
/* text with names and numbers in translate="no" spans, built as nodes */
function marked(parent, text, names) {
  var parts = (names || []).filter(function (n) { return n && String(n).length > 1; }).map(String).sort(function (a, b) { return b.length - a.length; })
    .map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  parts.push('\\d[\\d,.]*%?');
  var re = new RegExp('(' + parts.join('|') + ')', 'g'), last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    var sp = el('span', null, m[0]); sp.setAttribute('translate', 'no');
    parent.appendChild(sp);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  return parent;
}
function script(src) {
  return new Promise(function (res, rej) {
    if (window.ReportCoach) return res();
    var s = document.createElement('script'); s.src = src; s.onload = function () { window.ReportCoach ? res() : rej(new Error(src)); }; s.onerror = function () { rej(new Error(src)); };
    document.body.appendChild(s);
  });
}
function sha16(s) {
  if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve('');
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 16);
  }, function () { return ''; });
}
function dateText(sec) {
  if (!sec) return '';
  try { return new Date(sec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; }
}

/* what the Snapshot holds, from the supplements the page already loaded (a private or missing one is simply absent) */
function snapshot(res, wantRunes) {
  var g = res.supp || {}, snap = { inv: g.inv || null, enigma: g.enigma || null, bench: g.bench || null, heroes: g.heroes || null, decode: window.TWGameData && window.TWGameData.ebDecodeCfg };
  if (!wantRunes || !snap.inv) return Promise.resolve(snap);
  return d.loadItemTable().then(function (lk) {
    try {
      var bag = core._ar_extractRunePool(snap.inv, null, lk).bagCounts || {};
      snap.runeBag = bag;
    } catch (e) {}
    return snap;
  }, function () { return snap; });
}

/* one report's JSON, or null on failure or after 10 s (a hung CDN request must not hold the card back) */
function fetchRaw(id) {
  var got = d.fetchReportResponse(id).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
  return Promise.race([got, new Promise(function (res) { setTimeout(function () { res(null); }, 10000); })]);
}
/* the player's main march among the newest reports; resolves the pick {id, logtime, cp, raw, key} or null */
function pickReport(res, sk, name) {
  return Promise.all(LOGIC.recentReports(res.reports).map(function (rep) {
    return fetchRaw(rep.id).then(function (raw) {
      if (!raw || !raw.battle) return null;
      var players = LOGIC.sidePlayers(raw);
      return Promise.all([sha16(players.attacker ? players.attacker.uid : ''), sha16(players.defender ? players.defender.uid : '')]).then(function (h) {
        return LOGIC.candidate(rep, raw, { attacker: h[0], defender: h[1] }, sk, name);
      });
    });
  })).then(function (c) { return LOGIC.pickMain(c.filter(Boolean)); });
}

function analyse(res) {
  var sk = H.sk(), name = H.stateName();
  return Promise.all([
    script('report-coach.js'),
    Promise.all(TABLES.map(function (f) { return d.fetchJson('data/' + f).catch(function () { return null; }); })),
    pickReport(res, sk, name)
  ]).then(function (p) {
    var pk = p[2];
    if (!pk) return null;
    var t = p[1], tables = { heroes: t[0], supportive: t[1], collectibles: t[2], formation: t[3], enhance: t[4], buffGroup: t[5], platforms: t[6], game: window.TWGameData };
    if (!tables.heroes || !tables.supportive || !tables.buffGroup) return null;
    var key = pk.key, result = window.ReportCoach.analyze(pk.raw, tables), side = result.sides[key];
    if (!side || (!side.moves.length && !side.gaps.length)) return null;
    var wantRunes = side.moves.some(function (m) { return m.id === 'runes-stars'; });
    return snapshot(res, wantRunes).then(function (snap) {
      var hasSnap = !!(snap.inv || snap.enigma || snap.bench || snap.heroes);
      return LOGIC.cardModel(result, key, window.ReportCoach.withSnapshot(side, snap, tables), pk.logtime, hasSnap);
    });
  });
}

/* the stats behind one area: a small table, stat / you / them, built as nodes */
function fmtStat(v, unit) {
  var n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10).toFixed(1);
  return unit === 'troops' ? Math.round(v).toLocaleString('en-US') + ' troops' : n + '%';
}
function statsPanel(g, m) {
  var box = el('div', 'co-st');
  var rows = g.stats || [];
  if (!rows.length) { box.appendChild(el('p', 'co-note', 'No stat detail for this source.')); return box; }
  var t = el('table', 'co-stt'), cap = el('caption', 'co-cap', 'Stats from ' + g.label + ', each side for the troops it fielded');
  t.appendChild(cap);
  var hr = el('tr');
  [['Stat', 'th'], ['You', 'th'], [m.opp, 'th']].forEach(function (c, i) { var th = el('th', i ? 'num' : null); th.scope = 'col'; marked(th, c[0], m.names); hr.appendChild(th); });
  var hd = el('thead'); hd.appendChild(hr); t.appendChild(hd);
  var tb = el('tbody');
  rows.forEach(function (r) {
    var tr = el('tr'), behind = r.theirs > r.mine;
    tr.appendChild(el('th', 'sl', r.label)); tr.lastChild.scope = 'row';
    [r.mine, r.theirs].forEach(function (v, i) {
      var td = el('td', 'num' + (i === 1 && behind ? ' lead' : ''));
      var sp = el('span', null, fmtStat(v, r.unit)); sp.setAttribute('translate', 'no');
      td.appendChild(sp); tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb); box.appendChild(t);
  return box;
}

function paint() {
  var slot = $('#coachSlot');
  if (!slot) return;
  while (slot.firstChild) slot.removeChild(slot.firstChild);
  if (!CARD || CARD.res !== S.res || !CARD.model) { slot.hidden = true; return; }
  var m = CARD.model;
  slot.hidden = false;
  var card = el('section', 'card'); card.id = 'coachCard'; card.setAttribute('aria-labelledby', 'coT');
  var head = el('div', 'sechead'), h2 = el('h2', 'title', "From your main march's last battle"); h2.id = 'coT';
  head.appendChild(h2); card.appendChild(head);

  var sub = el('p', 'co-sub');
  marked(sub, LOGIC.marchLine(m.heroes, m.opp, dateText(m.time)), m.names.concat(dateText(m.time)));
  card.appendChild(sub);
  if (m.line) card.appendChild(marked(el('p', 'co-line'), m.line, m.names));

  if (m.gaps.length) {
    card.appendChild(el('h3', 'co-h', 'Where you are behind'));
    card.appendChild(el('p', 'co-note', 'Stat bonus from each source, in % points, each side for the troops it fielded. Tap a source to see the stats behind it.'));
    var max = Math.max.apply(null, m.gaps.map(function (g) { return Math.max(g.mine, g.theirs); })) || 1;
    var list = el('div', 'co-gaps'); list.setAttribute('role', 'list');
    m.gaps.forEach(function (g, gi) {
      var row = el('div', 'co-gap'); row.setAttribute('role', 'listitem');
      var btn = el('button', 'co-gb'); btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      var pid = 'coGapStats' + gi;
      btn.setAttribute('aria-controls', pid);
      var top = el('span', 'co-gt');
      top.appendChild(el('span', 'co-gl', g.label));
      var chev = el('span', 'co-chev', '\u25be'); chev.setAttribute('aria-hidden', 'true');   /* not part of the button's name */
      top.appendChild(chev);
      btn.appendChild(top);
      [['me', 'You', g.mine], ['them', m.opp, g.theirs]].forEach(function (b) {
        var line = el('span', 'co-bar ' + b[0]), meter = el('span', 'meter'), fill = el('i');
        fill.style.width = Math.max(1, Math.round(100 * b[2] / max)) + '%';
        meter.appendChild(fill); line.appendChild(meter);
        line.appendChild(marked(el('span', 'co-bn'), b[1] + ' ' + b[2].toLocaleString('en-US'), m.names));
        btn.appendChild(line);
      });
      row.appendChild(btn);
      var panel = statsPanel(g, m); panel.id = pid; panel.hidden = true;
      row.appendChild(panel);
      btn.addEventListener('click', function () {
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('open', open);
      });
      list.appendChild(row);
    });
    card.appendChild(list);
  }

  if (m.moves.length) {
    card.appendChild(el('h3', 'co-h', 'Next steps'));
    var ml = el('div', 'co-moves'); ml.setAttribute('role', 'list');
    m.moves.forEach(function (mv) {
      var row = el('div', 'co-move'); row.setAttribute('role', 'listitem');
      var top = el('div', 'co-mt');
      top.appendChild(el('span', 'pill p-eff co-pill', TIER[mv.tier] || mv.tier));
      top.appendChild(marked(el('span', 'co-mtt'), mv.title, m.names));
      row.appendChild(top);
      row.appendChild(marked(el('p', 'co-md'), mv.detail, m.names));
      if (mv.extra) row.appendChild(marked(el('p', 'co-mx'), mv.extra, m.names));
      ml.appendChild(row);
    });
    card.appendChild(ml);
  }
  var footText = m.snap ? 'Lines under a step come from your Snapshot.' : m.hasSnap ? '' : 'Import a Snapshot and the steps can say what you hold.';
  if (footText) card.appendChild(el('div', 'co-foot', footText));
  slot.appendChild(card);
}

/* start: read the newest report for the current load; a later load (Undo, switch) overtakes an earlier one */
function start() {
  var res = S.res, seq = ++runSeq;
  if (CARD && CARD.res === res) { paint(); return; }
  CARD = null;
  analyse(res).then(function (model) {
    if (seq !== runSeq || S.res !== res) return;
    CARD = { res: res, model: model };
    paint();
  }, function (e) { if (window.console) console.error(e); });
}
return { start: start, paint: paint };
};
})(typeof window !== 'undefined' ? window : globalThis);
