/* Learning Lounge core: search, did-you-mean, similar questions, safe answer rendering.
 * No DOM, no network. window.LoungeCore in the browser, module.exports for node tests.
 * Shared by learning-lounge.html (players) and learning-lounge-mentors.html (mentors). */
(function (root) {
  'use strict';

  var SITE = 'https://2864tw.com';

  // Every lookup table keyed by user text is prototype-free, so words like "constructor" or "__proto__" are just words.
  function dict(src) {
    var d = Object.create(null);
    if (src) Object.keys(src).forEach(function (k) { d[k] = src[k]; });
    return d;
  }

  // Field weights: a hit in the question counts most, the answer body least.
  var FIELD_W = { q: 3, alt: 2.5, kw: 2, cat: 1, ans: 1 };
  var FIELDS = ['q', 'alt', 'kw', 'cat', 'ans'];
  var K1 = 1.2, B = 0.75;
  // How much a looser match is worth next to the word itself.
  var SYN_W = 0.9, PREFIX_W = 0.75, FUZZY1_W = 0.7, FUZZY2_W = 0.55, BIGRAM_W = 0.85;
  // A synonym found only in an answer's body is weak evidence ("energy" in passing is not a VIT question).
  var SYN_IN_ANSWER_W = 0.5;
  // A result must match at least MIN_COVER of the query's words and score at least REL_CUT of the best result.
  // It also needs one solid hit (STRONG_W or better) outside the answer body, or two words in the answer.
  var MIN_COVER = 0.5, REL_CUT = 0.35, STRONG_W = 0.7;

  var STOP = dict();
  ('a an the is are am was were be been being to of in on at for and or but i me my mine we our us you your yours it its ' +
   'this that these those do does did doing done how what whats where when why who whom which can could should would will ' +
   'shall may might must please with there here any some about have has had need want so if then than just also very really ' +
   'not dont doesnt didnt cant cannot wont isnt arent im ive id youre theres hey hi hello thanks thank anyone someone tell ' +
   'from into by as like know').split(' ').forEach(function (w) { STOP[w] = 1; });

  // Chat-speak players type, mapped to the word they mean (most then drop as stopwords).
  var CHAT = dict({ wat: 'what', wut: 'what', wht: 'what', hw: 'how', u: 'you', ur: 'your', y: 'why', pls: 'please', plz: 'please',
    '2': 'to', '4': 'for', thx: 'thanks', ty: 'thanks', cuz: 'because', bc: 'because', abt: 'about', wanna: 'want', gonna: 'going' });

  function normalize(s) {
    if (s == null) return '';
    s = String(s).normalize('NFKC').toLowerCase();
    s = s.replace(/[\u2018\u2019ʼ`´]/g, "'").replace(/[\u201c\u201d]/g, '"');
    s = s.replace(/'s\b/g, '').replace(/'/g, '');
    s = s.replace(/[^\p{L}\p{N}+]+/gu, ' ');
    // a + only counts inside a word or before a number (cat+, +2); a lone + goes
    s = s.replace(/(^|\s)\++(?=\s|$)/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  // Light stemming, the same on both sides. Short words, numbers and joined phrases are left alone,
  // so game words like ops, ht, vit, r4 never change.
  function stem(t) {
    if (t.length <= 3 || /[\d_+]/.test(t)) return t;
    var b;
    if (/ies$/.test(t) && t.length > 4) return t.slice(0, -3) + 'y';
    if (/oes$/.test(t)) return t.slice(0, -2);
    if (/(ss|sh|ch|x|z)es$/.test(t)) return t.slice(0, -2);
    if (/ing$/.test(t) && t.length > 5) { b = t.slice(0, -3); return /([^aeiouls])\1$/.test(b) ? b.slice(0, -1) : b; }
    if (/ed$/.test(t) && t.length > 5) { b = t.slice(0, -2); return /([^aeiouls])\1$/.test(b) ? b.slice(0, -1) : b; }
    if (/s$/.test(t) && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
    return t;
  }

  // Damerau (optimal string alignment) distance; returns max + 1 as soon as it can't be within max.
  function editDistance(a, b, max) {
    if (max == null) max = 2;
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb] > max ? max + 1 : prev[lb];
  }

  function wordsOf(text) {
    var n = normalize(text);
    return n ? n.split(' ') : [];
  }

  // Synonym groups: each term becomes a key (one stemmed word, or stemmed words joined with _).
  function buildSynonyms(groups) {
    var syn = { phrases: [], groupsOf: dict(), members: [] };
    (groups || []).forEach(function (g, gi) {
      var keys = [];
      (Array.isArray(g) ? g : []).forEach(function (term) {
        var parts = wordsOf(term).map(stem);
        if (!parts.length) return;
        var key = parts.join('_');
        if (parts.length > 1) syn.phrases.push({ parts: parts, key: key });
        if (keys.indexOf(key) === -1) keys.push(key);
        (syn.groupsOf[key] = syn.groupsOf[key] || []);
        if (syn.groupsOf[key].indexOf(gi) === -1) syn.groupsOf[key].push(gi);
      });
      syn.members[gi] = keys;
    });
    syn.phrases.sort(function (a, b) { return b.parts.length - a.parts.length; });
    return syn;
  }

  function synonymsOf(syn, key) {
    var out = [];
    (syn.groupsOf[key] || []).forEach(function (gi) {
      syn.members[gi].forEach(function (k) { if (k !== key && out.indexOf(k) === -1) out.push(k); });
    });
    return out;
  }

  // Text -> token objects {t, raw, parts}. Phrase synonyms merge into one token ("heavy trooper" -> heavy_trooper);
  // stopwords drop unless the text is nothing but stopwords.
  function analyze(text, syn) {
    var words = wordsOf(text);
    var toks = words.map(function (w) {
      var c = CHAT[w] || w;
      return { t: stem(c), raw: w, stop: !!STOP[c] };
    });
    if (syn && syn.phrases.length) {
      var merged = [];
      for (var i = 0; i < toks.length; i++) {
        var hit = null;
        for (var p = 0; p < syn.phrases.length && !hit; p++) {
          var ph = syn.phrases[p], n = ph.parts.length, ok = i + n <= toks.length;
          for (var k = 0; ok && k < n; k++) if (toks[i + k].t !== ph.parts[k]) ok = false;
          if (ok) hit = ph;
        }
        if (hit) {
          var span = toks.slice(i, i + hit.parts.length);
          merged.push({ t: hit.key, raw: span.map(function (x) { return x.raw; }).join(' '), stop: false, parts: hit.parts.slice() });
          i += hit.parts.length - 1;
        } else merged.push(toks[i]);
      }
      toks = merged;
    }
    var kept = toks.filter(function (x) { return !x.stop; });
    return kept.length ? kept : toks;
  }

  function tokenize(text, syn) {
    return analyze(text, syn).map(function (x) { return x.t; });
  }

  function stripMarkdown(md) {
    return String(md == null ? '' : md)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '$1')
      .replace(/^\s*(#{1,6}|[-*]|\d{1,3}[.)])\s+/gm, '')
      .replace(/\*\*|\*/g, '')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isWordy(t) { return /^[\p{L}]+$/u.test(t); }

  // ── Index ────────────────────────────────────────────────────────────────
  function buildIndex(entries, opts) {
    opts = opts || {};
    var syn = buildSynonyms(opts.synonyms);
    var catName = dict();
    (opts.categories || []).forEach(function (c) { if (c && c.id) catName[c.id] = c.name || ''; });
    var docs = [], byId = dict(), df = dict(), real = dict(), near = dict(), surfaceCount = dict(), lenSum = {};
    FIELDS.forEach(function (f) { lenSum[f] = 0; });

    function seeSurface(term, raw) {
      var m = surfaceCount[term] || (surfaceCount[term] = dict());
      m[raw] = (m[raw] || 0) + 1;
    }

    (entries || []).forEach(function (e) {
      if (!e || !e.id) return;
      var d = { entry: e, tf: {}, len: {}, terms: dict(), qSet: dict(), altSets: [], kwSet: dict(),
        qNorm: normalize(e.question), altNorm: (e.alternates || []).map(normalize) };
      var texts = { q: [e.question], alt: e.alternates || [], kw: e.keywords || [], cat: [catName[e.category_id] || ''], ans: [stripMarkdown(e.answer)] };
      FIELDS.forEach(function (f) {
        var tf = dict(), n = 0;
        texts[f].forEach(function (text, ti) {
          var toks = analyze(text, syn).filter(function (x) { return !x.stop; });
          var set = dict();
          toks.forEach(function (x, xi) {
            tf[x.t] = (tf[x.t] || 0) + 1; n++; real[x.t] = 1; set[x.t] = 1; d.terms[x.t] = 1;
            if (f !== 'ans') near[x.t] = 1;
            seeSurface(x.t, x.raw);
            if (x.parts) {
              // the words of a merged phrase still count on their own ("canyon" finds Titan Canyon)
              var raws = x.raw.split(' ');
              x.parts.forEach(function (p, pi) {
                tf[p] = (tf[p] || 0) + 1; real[p] = 1; d.terms[p] = 1; seeSurface(p, raws[pi] || p);
                if (f !== 'ans') near[p] = 1;
              });
            }
            var nx = toks[xi + 1];
            if (nx && !x.parts && !nx.parts && isWordy(x.t) && isWordy(nx.t)) {
              // "sign up" also answers "signup"
              var bg = x.raw + nx.raw;
              tf[bg] = (tf[bg] || 0) + BIGRAM_W; d.terms[bg] = 1;
              if (f !== 'ans') near[bg] = 1;
            }
          });
          if (f === 'q') d.qSet = set;
          if (f === 'alt') d.altSets.push(set);
          if (f === 'kw') Object.keys(set).forEach(function (k) { d.kwSet[k] = 1; });
        });
        d.tf[f] = tf; d.len[f] = n; lenSum[f] += n;
      });
      Object.keys(d.terms).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      docs.push(d); byId[e.id] = d;
    });

    var avg = {};
    FIELDS.forEach(function (f) { avg[f] = docs.length ? Math.max(1, lenSum[f] / docs.length) : 1; });
    var surface = dict();
    Object.keys(surfaceCount).forEach(function (t) {
      var best = null, bc = -1, m = surfaceCount[t];
      Object.keys(m).forEach(function (r) { if (m[r] > bc) { bc = m[r]; best = r; } });
      surface[t] = best;
    });
    // Typo, prefix and did-you-mean candidates come only from the words a question is asked with, never from
    // answer bodies: a 4-letter typo matched against every answer word finds base/case, hero/here, gear/year.
    syn.members.forEach(function (keys) { keys.forEach(function (k) { if (df[k]) near[k] = 1; }); });
    var vocab = Object.keys(near).filter(function (t) { return df[t]; }).sort();
    return { docs: docs, byId: byId, df: df, real: real, vocab: vocab, avg: avg, syn: syn, surface: surface, N: docs.length };
  }

  function idf(index, term) {
    var n = index.df[term] || 0;
    return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
  }

  function fieldScore(index, d, f, term) {
    var tf = d.tf[f][term];
    if (!tf) return 0;
    var norm = 1 - B + B * (d.len[f] / index.avg[f]);
    return idf(index, term) * (tf * (K1 + 1)) / (tf + K1 * norm);
  }

  // Every index term a query word could mean, with how much each is worth.
  function expand(index, t, typing) {
    var out = dict();
    function add(term, w, kind) {
      if (!index.df[term]) return;
      if (!out[term] || out[term].w < w) out[term] = { term: term, w: w, kind: kind };
    }
    add(t, 1, 'exact');
    synonymsOf(index.syn, t).forEach(function (s) { add(s, SYN_W, 'syn'); });
    var known = Object.keys(out).length > 0;
    if (typing && !index.df[t] && t.length >= 3 && t.indexOf('_') === -1) {
      index.vocab.forEach(function (v) { if (v.lastIndexOf(t, 0) === 0) add(v, PREFIX_W, 'prefix'); });
    }
    if (!known && t.length >= 4 && t.indexOf('_') === -1) {
      var max = t.length >= 8 ? 2 : 1;
      index.vocab.forEach(function (v) {
        if (v.indexOf('_') !== -1 || Math.abs(v.length - t.length) > max) return;
        if (t.length === 4 && v.charAt(0) !== t.charAt(0)) return;
        var dist = editDistance(t, v, max);
        if (dist < 1 || dist > max) return;
        var w = dist === 1 ? FUZZY1_W : FUZZY2_W;
        add(v, w, 'fuzzy');
        synonymsOf(index.syn, v).forEach(function (s) { add(s, w * SYN_W, 'fuzzy'); });
      });
    }
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  // The closest real word for a word nothing matched exactly.
  function closestWord(index, t) {
    if (t.length < 3 || t.indexOf('_') !== -1 || /\d/.test(t)) return null;
    var max = t.length >= 8 ? 2 : (t.length >= 4 ? 2 : 1);
    var best = null, bd = max + 1, bdf = -1;
    index.vocab.forEach(function (v) {
      if (!index.real[v] || v.indexOf('_') !== -1 || Math.abs(v.length - t.length) > max) return;
      if (t.length <= 4 && v.charAt(0) !== t.charAt(0)) return;
      var dist = editDistance(t, v, max);
      if (dist < 1 || dist > max) return;
      var vdf = index.df[v] || 0;
      if (dist < bd || (dist === bd && vdf > bdf)) { best = v; bd = dist; bdf = vdf; }
    });
    return best;
  }

  function queryTokens(index, query) {
    var toks = analyze(query, index.syn).filter(function (x) { return x.t; });
    // "sign up" typed as two words where the answers say "signup"
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var a = toks[i], b = toks[i + 1];
      if (b && !a.parts && !b.parts && index.real[a.raw + b.raw] && !(index.df[a.t] && index.df[b.t])) {
        out.push({ t: a.raw + b.raw, raw: a.raw + ' ' + b.raw });
        i++;
      } else out.push(a);
    }
    return out;
  }

  function search(index, query, opts) {
    opts = opts || {};
    var limit = opts.limit || 10;
    var empty = { results: [], suggestion: null, tokens: [] };
    if (!index || !index.N) return empty;
    var toks = queryTokens(index, query);
    if (!toks.length) return empty;
    var cands = toks.map(function (x, i) { return expand(index, x.t, !!opts.typing && i === toks.length - 1); });
    var qn = normalize(query);

    var results = [];
    index.docs.forEach(function (d) {
      var total = 0, matched = 0, strong = 0, inAnswer = 0, why = [], terms = [];
      for (var qi = 0; qi < toks.length; qi++) {
        var tokScore = 0, best = null, bestPart = 0, solid = false, exact = false, hits = [];
        // per field, the best of this word's meanings; summed over fields (a question that also has the word
        // in a wording ranks above one that has it once), but never two meanings in one field
        for (var fi = 0; fi < FIELDS.length; fi++) {
          var f = FIELDS[fi], fBest = 0, fC = null;
          for (var ci = 0; ci < cands[qi].length; ci++) {
            var c = cands[qi][ci];
            var w = (f === 'ans' && c.kind !== 'exact' && c.kind !== 'prefix') ? Math.min(c.w, SYN_IN_ANSWER_W) : c.w;
            var s = w * fieldScore(index, d, f, c.term);
            if (s > fBest) { fBest = s; fC = c; }
          }
          if (fBest > 0) {
            var part = FIELD_W[f] * fBest;
            tokScore += part;
            if (f !== 'ans' && fC.w >= STRONG_W) solid = true;
            if (fC.kind === 'exact' && f !== 'ans') exact = true;
            if (hits.indexOf(fC.term) === -1) hits.push(fC.term);
            if (part > bestPart) { best = fC; bestPart = part; }
          }
        }
        if (tokScore > 0) {
          total += tokScore; matched++;
          if (solid) strong++; else inAnswer++;
          // every word that matched gets highlighted; a why-line only when the word itself matched nowhere but the answer body
          hits.forEach(function (h) { if (terms.indexOf(h) === -1) terms.push(h); });
          if (!exact) why.push({ query: toks[qi].raw, match: index.surface[best.term] || best.term.replace(/_/g, ' '), kind: best.kind });
        }
      }
      if (!matched || (!strong && inAnswer < 2)) return;
      var cover = matched / toks.length;
      var score = total * cover;
      if (qn && (d.qNorm === qn || d.altNorm.indexOf(qn) !== -1)) score += 4;
      else if (qn.length >= 6 && (d.qNorm.indexOf(qn) !== -1 || d.altNorm.some(function (a) { return a.indexOf(qn) !== -1; }))) score += 1.5;
      results.push({ entry: d.entry, score: score, cover: cover, why: why, matched: terms });
    });

    results.sort(function (a, b) { return b.score - a.score; });
    var topScore = results.length ? results[0].score : 0;
    results = results.filter(function (r) {
      return r.cover >= (toks.length > 1 ? MIN_COVER : 1) && r.score >= topScore * REL_CUT;
    }).slice(0, limit);

    var suggestion = opts.noSuggest ? null : suggest(index, query, toks);
    // only offer a correction that would actually find something
    if (suggestion && !search(index, suggestion, { noSuggest: true, limit: 1 }).results.length) suggestion = null;
    return { results: results, suggestion: suggestion, tokens: toks.map(function (x) { return x.t; }) };
  }

  // Did you mean: swap each word that only matched loosely (or not at all) for the nearest real word.
  function suggest(index, query, toks) {
    var swaps = dict(), changed = false;
    toks.forEach(function (x) {
      if (index.df[x.t] || x.t.indexOf('_') !== -1) return;
      if (synonymsOf(index.syn, x.t).some(function (s) { return index.df[s]; })) return;
      var w = closestWord(index, x.t);
      if (w) { swaps[x.raw] = index.surface[w] || w; changed = true; }
    });
    if (!changed) return null;
    var out = wordsOf(query).map(function (w) { return swaps[w] || w; }).join(' ');
    return out === normalize(query) ? null : out;
  }

  function jaccard(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    ka.forEach(function (k) { if (b[k]) inter++; });
    return inter / (ka.length + kb.length - inter);
  }

  // Existing questions close to a new one (mentor page: duplicate warning, "add as another wording").
  function similar(index, text, opts) {
    opts = opts || {};
    var set = dict();
    tokenize(text, index.syn).forEach(function (t) { if (!STOP[t]) set[t] = 1; });
    if (!Object.keys(set).length) return [];
    var out = [];
    index.docs.forEach(function (d) {
      if (opts.excludeId && d.entry.id === opts.excludeId) return;
      var best = jaccard(set, d.qSet);
      d.altSets.forEach(function (s) { var j = jaccard(set, s); if (j > best) best = j; });
      if (best >= (opts.min || 0.5)) out.push({ entry: d.entry, score: best });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, opts.limit || 5);
  }

  function related(index, id, n) {
    var d0 = index.byId[id];
    if (!d0) return [];
    var out = [];
    index.docs.forEach(function (d) {
      if (d === d0) return;
      var shared = 0;
      Object.keys(d0.kwSet).forEach(function (k) { if (d.kwSet[k]) shared++; });
      var s = (d.entry.category_id === d0.entry.category_id ? 1 : 0) + 2 * shared + 2 * jaccard(d0.qSet, d.qSet);
      if (s > 0) out.push({ entry: d.entry, s: s });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, n || 3).map(function (x) { return x.entry; });
  }

  // ── Output helpers ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Escaped text with matched words wrapped in <mark>.
  function highlight(text, terms) {
    var want = dict();
    (terms || []).forEach(function (t) {
      want[t] = 1;
      if (t.indexOf('_') !== -1) t.split('_').forEach(function (p) { want[p] = 1; });
    });
    var s = String(text == null ? '' : text), out = '', last = 0, m;
    var rx = /[\p{L}\p{N}+']+/gu;
    while ((m = rx.exec(s))) {
      out += esc(s.slice(last, m.index));
      var w = normalize(m[0]);
      var hit = w && w.indexOf(' ') === -1 && (want[stem(CHAT[w] || w)] || want[w]);
      out += hit ? '<mark>' + esc(m[0]) + '</mark>' : esc(m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  // Only https, site paths and links to another question. Anything else is not a link.
  function safeHref(u) {
    u = String(u).trim();
    if (/^#q-[a-z0-9-]{3,40}$/.test(u)) return { url: u, external: false };
    if (/^\/(?!\/)[A-Za-z0-9._~\-\/]*(\?[A-Za-z0-9=&._~%\-+]*)?(#[A-Za-z0-9_\-]*)?$/.test(u)) return { url: SITE + u, external: false };
    var x;
    try { x = new URL(u); } catch (e) { return null; }
    if (x.protocol !== 'https:' || x.username || x.password) return null;
    var own = x.hostname === '2864tw.com' || x.hostname === 'www.2864tw.com';
    return { url: x.href, external: !own };
  }

  function anchor(href, innerHtml) {
    return '<a href="' + esc(href.url) + '"' + (href.external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '') + '>' + innerHtml + '</a>';
  }

  function emphasis(h) {
    return h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  }

  // Inline markdown on one line. Code, links and bare URLs are cut out into slots first, the rest is escaped,
  // then the slots go back in. NUL can't be in the text (renderAnswer strips control characters), so a slot
  // marker can't be forged.
  function inline(s) {
    var slots = [];
    function slot(html) { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; }
    s = s.replace(/`([^`]+)`/g, function (_, c) { return slot('<code>' + esc(c) + '</code>'); });
    s = s.replace(/\[([^\]\n]{1,200})\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, function (_, label, url) {
      var href = safeHref(url);
      var inner = emphasis(esc(label));
      return slot(href ? anchor(href, inner) : inner);
    });
    s = s.replace(/https:\/\/[^\s<>"'`\u0000]+/g, function (u) {
      var m = /[.,;:!?)\]]+$/.exec(u), trail = m ? m[0] : '';
      if (trail) u = u.slice(0, -trail.length);
      var href = safeHref(u);
      return (href ? slot(anchor(href, esc(u))) : u) + trail;
    });
    s = emphasis(esc(s));
    for (var pass = 0; pass < 3 && s.indexOf('\u0000') !== -1; pass++) {
      s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return slots[+i] || ''; });
    }
    return s.replace(/\u0000/g, '');
  }

  function renderAnswer(md) {
    var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    var out = [], para = [], list = null;
    function flushPara() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function flushList() {
      if (!list) return;
      out.push('<' + list.type + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.type + '>');
      list = null;
    }
    src.split('\n').forEach(function (line) {
      var t = line.trim(), m;
      if (!t) { flushPara(); flushList(); return; }
      if ((m = /^(#{2,3})\s+(.+)$/.exec(t))) {
        flushPara(); flushList();
        var tag = m[1].length === 2 ? 'h3' : 'h4';
        out.push('<' + tag + '>' + inline(m[2]) + '</' + tag + '>');
        return;
      }
      if ((m = /^[-*]\s+(.+)$/.exec(t))) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if ((m = /^\d{1,3}[.)]\s+(.+)$/.exec(t))) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      flushList();
      para.push(t);
    });
    flushPara(); flushList();
    return out.join('');
  }

  var LoungeCore = {
    normalize: normalize, stem: stem, editDistance: editDistance, buildSynonyms: buildSynonyms, tokenize: tokenize,
    stripMarkdown: stripMarkdown, buildIndex: buildIndex, search: search, similar: similar, related: related,
    highlight: highlight, renderAnswer: renderAnswer, escapeHtml: esc, safeHref: safeHref,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LoungeCore;
  else root.LoungeCore = LoungeCore;
})(typeof window !== 'undefined' ? window : globalThis);
