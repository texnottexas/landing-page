'use strict';
// Learning Lounge search + answer renderer. Run: node --test test/lounge-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lounge-core.js');

const CATS = [
  { id: 'getting-started', name: 'Getting started on 2864tw.com' },
  { id: 'armory', name: 'Armory & your report' },
  { id: 'events', name: 'Events & signups' },
  { id: 'words', name: 'Words & abbreviations' },
  { id: 'joining', name: 'Joining Server 2864' },
  { id: 'ops-center', name: 'Ops Center tools' },
];
const SYN = [['ht', 'heavy trooper', 'mecha'], ['tc', 'titan canyon'], ['armory', 'armoury'], ['ops center', 'ops centre'],
  ['notification', 'push', 'alert'], ['vit', 'energy', 'vitality']];
const E = (id, category_id, question, answer, alternates, keywords) => ({ id, category_id, question, answer, alternates: alternates || [], keywords: keywords || [] });
const ENTRIES = [
  E('arm-get', 'armory', 'How do I get my armory report?', 'Run the **Snapshot** from the Ops Center, then open [your armory](/armory-report.html).', ['armory not working', 'where is my report'], ['snapshot']),
  E('w-ht', 'words', 'What is HT?', 'HT means Heavy Trooper, also called Mecha in some menus.', [], ['abbreviation']),
  E('ev-tc-signup', 'events', 'How do I sign up for Titan Canyon?', 'Open the Titan Canyon hub and press Register.', ['tc registration'], ['register', 'squad']),
  E('ev-tc-cancel', 'events', 'How do I cancel my Titan Canyon signup?', 'Open the hub and press Cancel before signups close.', [], ['withdraw']),
  E('jn-transfer', 'joining', 'How do I transfer to Server 2864?', 'Use the transfer page and join our Discord.', ['how to join 2864', 'move to your server'], ['transfer', 'migrate']),
  E('ops-what', 'ops-center', 'What is the Ops Center?', 'A bookmark that opens a menu of helper tools inside the game.', ['ops centre'], ['bookmarklet', 'tools']),
  E('gs-name', 'getting-started', 'How do I set my name on the site?', 'Pick your name from the roster when the site asks.', [], ['identity', 'player']),
  E('nt-iphone', 'getting-started', 'Why do notifications not work on my iPhone?', 'Add the site to your Home Screen first, then allow notifications.', [], ['ios', 'safari']),
  E('w-vit', 'words', 'How do I get more VIT?', 'VIT refills over time and from capsules.', [], []),
];
const IDX = L.buildIndex(ENTRIES, { synonyms: SYN, categories: CATS });
const top = (q, opts) => { const r = L.search(IDX, q, opts); return r.results.map((x) => x.entry.id); };

test('normalize: case, accents kept as letters, curly quotes, punctuation, plus signs kept inside tokens', () => {
  assert.equal(L.normalize('  How’s  THE  Armory?? '), 'how the armory');
  assert.equal(L.normalize('Cat+ slot +2!'), 'cat+ slot +2');
  assert.equal(L.normalize('R4/R5'), 'r4 r5');
  assert.equal(L.normalize(null), '');
});

test('stem: same root for plural / -ing / -ed, short game words untouched', () => {
  assert.equal(L.stem('reports'), 'report');
  assert.equal(L.stem('boxes'), 'box');
  assert.equal(L.stem('heroes'), 'hero');
  assert.equal(L.stem('signing'), 'sign');
  assert.equal(L.stem('running'), 'run');
  assert.equal(L.stem('ops'), 'ops');
  assert.equal(L.stem('vit'), 'vit');
  assert.equal(L.stem('r4'), 'r4');
  assert.equal(L.stem('class'), 'class');
});

test('editDistance: Damerau (a swap costs 1), early exit past the cap', () => {
  assert.equal(L.editDistance('armory', 'armoury', 2), 1);
  assert.equal(L.editDistance('titen', 'titan', 2), 1);
  assert.equal(L.editDistance('form', 'from', 2), 1);
  assert.equal(L.editDistance('abc', 'xyz12345', 2), 3);
});

test('tokenize: phrase synonyms become one token; chat-speak and stopwords handled', () => {
  const syn = L.buildSynonyms(SYN);
  assert.deepEqual(L.tokenize('What is a heavy trooper?', syn), ['heavy_trooper']);
  assert.deepEqual(L.tokenize('wat is ht', syn), ['ht']);
  assert.deepEqual(L.tokenize('how 2 join', syn), ['join']);
  // a query of only stopwords keeps them, so "what is it" still searches
  assert.deepEqual(L.tokenize('what is it', syn), ['what', 'is', 'it']);
});

test('search: exact question wins', () => {
  assert.equal(top('How do I get my armory report?')[0], 'arm-get');
});

test('search: misspellings land on the right question', () => {
  assert.equal(top('how do i get my armoury')[0], 'arm-get');
  assert.equal(top('armroy report')[0], 'arm-get');
  assert.equal(top('titen canyon sign up')[0], 'ev-tc-signup');
  assert.equal(top('notifcations iphone')[0], 'nt-iphone');
});

test('search: synonyms work both ways, single and multi word', () => {
  assert.equal(top('wat is ht')[0], 'w-ht');
  assert.equal(top('what is a heavy trooper')[0], 'w-ht');
  assert.equal(top('mecha')[0], 'w-ht');
  assert.equal(top('tc signup')[0], 'ev-tc-signup');
  assert.equal(top('push not working on iphone')[0], 'nt-iphone');
  assert.equal(top('energy')[0], 'w-vit');
});

test('search: alternates and keywords count', () => {
  assert.equal(top('how 2 join 2864')[0], 'jn-transfer');
  assert.equal(top('migrate')[0], 'jn-transfer');
  assert.equal(top('withdraw from canyon')[0], 'ev-tc-cancel');
});

test('search: last word is a prefix while typing, not when submitted', () => {
  assert.equal(top('arm', { typing: true })[0], 'arm-get');
  assert.equal(top('titan cancel', { typing: true })[0], 'ev-tc-cancel');
  assert.deepEqual(top('arm', { typing: false }), []);
});

test('search: nonsense and empty queries find nothing', () => {
  assert.deepEqual(top('zzqx flurb'), []);
  assert.deepEqual(top(''), []);
  assert.deepEqual(top('   ?? '), []);
});

test('search: a two-word query needs most of its words to match', () => {
  // "iphone" matches; "dragon" matches nothing: half coverage is not enough for a confident hit
  assert.deepEqual(top('dragon spaceship iphone pizza'), []);
});

test('search: synonym expansion does not stack (a doc with ht AND mecha is not double counted)', () => {
  const idx = L.buildIndex([
    E('a', 'words', 'ht mecha heavy trooper', 'x'),
    E('b', 'words', 'What is HT?', 'y'),
  ], { synonyms: SYN, categories: CATS });
  const r = L.search(idx, 'ht').results;
  assert.ok(r.length === 2);
  assert.ok(r[0].score < r[1].score * 3, 'scores stay comparable');
});

test('search: why lines explain typo and synonym matches', () => {
  const r = L.search(IDX, 'armoury report').results[0];
  assert.ok(r.why.some((w) => w.kind === 'syn' || w.kind === 'fuzzy'));
  const s = L.search(IDX, 'mecha').results[0];
  assert.ok(s.why.some((w) => w.kind === 'syn' && w.query === 'mecha'));
});

test('suggest: did-you-mean for words nothing matched', () => {
  const r = L.search(IDX, 'snapshoot');
  assert.equal(r.results[0] && r.results[0].entry.id, 'arm-get');
  const r2 = L.search(IDX, 'tranfser sevrer');
  assert.ok(r2.suggestion === null || /transfer/.test(r2.suggestion));
  const r3 = L.search(IDX, 'squod');
  assert.equal(r3.suggestion, 'squad');
});

test('similar: finds near-duplicate questions for the mentor page', () => {
  const s = L.similar(IDX, 'how can i sign up for titan canyon');
  assert.equal(s[0].entry.id, 'ev-tc-signup');
  assert.deepEqual(L.similar(IDX, 'what is the best hero for air'), []);
  assert.deepEqual(L.similar(IDX, 'how do i get my armory report', { excludeId: 'arm-get' }).map((x) => x.entry.id).indexOf('arm-get'), -1);
});

test('related: same chapter / shared keywords, never itself', () => {
  const rel = L.related(IDX, 'ev-tc-signup', 3).map((e) => e.id);
  assert.equal(rel[0], 'ev-tc-cancel');
  assert.equal(rel.indexOf('ev-tc-signup'), -1);
});

test('highlight: escapes text and marks matched words', () => {
  const h = L.highlight('What is <b>HT</b>?', ['ht']);
  assert.equal(h, 'What is &lt;b&gt;<mark>HT</mark>&lt;/b&gt;?');
  assert.equal(L.highlight('Armory reports', ['armory', 'report']), '<mark>Armory</mark> <mark>reports</mark>');
});

test('renderAnswer: formatting subset', () => {
  assert.equal(L.renderAnswer('Hello **bold** and *it* and `code`'), '<p>Hello <strong>bold</strong> and <em>it</em> and <code>code</code></p>');
  assert.equal(L.renderAnswer('## Steps\n1. One\n2. Two\n\n- a\n- b'), '<h3>Steps</h3><ol><li>One</li><li>Two</li></ol><ul><li>a</li><li>b</li></ul>');
  assert.equal(L.renderAnswer('line one\nline two\n\nnext para'), '<p>line one<br>line two</p><p>next para</p>');
});

test('renderAnswer: links (https, site paths, question links); everything else is text', () => {
  assert.equal(L.renderAnswer('[Armory](/armory-report.html)'), '<p><a href="https://2864tw.com/armory-report.html">Armory</a></p>');
  assert.equal(L.renderAnswer('[x](#q-arm-get)'), '<p><a href="#q-arm-get">x</a></p>');
  assert.equal(L.renderAnswer('[Discord](https://discord.gg/go-2864)'), '<p><a href="https://discord.gg/go-2864" target="_blank" rel="noopener noreferrer nofollow">Discord</a></p>');
  assert.equal(L.renderAnswer('see https://2864tw.com/roadmap.html.'), '<p>see <a href="https://2864tw.com/roadmap.html">https://2864tw.com/roadmap.html</a>.</p>');
  assert.equal(L.renderAnswer('[bad](javascript:alert(1))'), '<p>bad</p>');
  assert.equal(L.renderAnswer('[bad](http://example.com)'), '<p>bad</p>');
  assert.equal(L.renderAnswer('[bad](//evil.com/x)'), '<p>bad</p>');
  assert.equal(L.renderAnswer('[bad](https://user:pw@evil.com)'), '<p>bad</p>');
});

test('renderAnswer: XSS payloads come out as inert text', () => {
  const evil = [
    '<img src=x onerror=alert(1)>',
    '[a](https://x.com/"onmouseover="alert(1))',
    '[<script>alert(1)</script>](https://x.com)',
    '**<svg onload=alert(1)>**',
    '`<iframe src=javascript:alert(1)>`',
    '## <img src=x onerror=1>',
    '- <a href="javascript:1">x</a>',
    'https://x.com/<script>',
    '\u0000LL0\u0000 placeholder forgery',
  ];
  for (const s of evil) {
    const h = L.renderAnswer(s);
    assert.ok(!/<(img|script|svg|iframe)\b/i.test(h), s + ' -> ' + h);
    assert.ok(!/\son\w+=/i.test(h.replace(/&[a-z]+;|&#\d+;/g, '')) || !/<[^>]*\son\w+=/i.test(h), s + ' -> ' + h);
    assert.ok(!/href="javascript:/i.test(h), s + ' -> ' + h);
    assert.ok(!/\u0000/.test(h), 'no raw placeholder: ' + h);
  }
  // the only tags that can appear
  const all = L.renderAnswer(evil.join('\n\n'));
  const tags = (all.match(/<\/?([a-z0-9]+)/gi) || []).map((t) => t.replace(/[<\/]/g, '').toLowerCase());
  for (const t of tags) assert.ok(['p', 'br', 'strong', 'em', 'code', 'h3', 'h4', 'ul', 'ol', 'li', 'a'].includes(t), 'tag ' + t);
});

test('stripMarkdown: plain text for previews and indexing', () => {
  assert.equal(L.stripMarkdown('Run the **Snapshot**, then [open it](/a.html).\n- one'), 'Run the Snapshot, then open it. one');
});

// ── Review cases (Fable, 2026-10-15) ─────────────────────────────────────────
test('typos: 4-letter words keep their first letter (gear is not year, base is not case)', () => {
  const idx = L.buildIndex([
    E('y', 'words', 'When does the new year event start?', 'Soon.'),
    E('c', 'words', 'How do I open a case?', 'Tap it.'),
  ], { synonyms: SYN, categories: CATS });
  assert.deepEqual(L.search(idx, 'gear').results, []);
  assert.deepEqual(L.search(idx, 'base').results, []);
  assert.equal(L.search(idx, 'yaer event').results[0].entry.id, 'y');
});

test('typos and prefixes only reach words a question is asked with, never answer-only words', () => {
  const idx = L.buildIndex([E('a', 'words', 'How do I move my base?', 'Use a relocation item from the shop.')], { synonyms: SYN, categories: CATS });
  assert.deepEqual(L.search(idx, 'relocaton').results, []);
  assert.deepEqual(L.search(idx, 'reloc', { typing: true }).results, []);
  assert.equal(L.search(idx, 'relocation item').results[0].entry.id, 'a', 'two exact answer words are enough');
});

test('one exact word found only in an answer body is not a hit; two are', () => {
  assert.deepEqual(top('capsules'), []);
  assert.equal(top('refills capsules')[0], 'w-vit');
});

test('a synonym seen only in an answer body counts less than in the question', () => {
  const idx = L.buildIndex([
    E('vitq', 'words', 'How do I get more VIT?', 'From capsules.'),
    E('other', 'words', 'What should I spend gems on?', 'Energy refills and vit capsules are fine.'),
  ], { synonyms: SYN, categories: CATS });
  assert.equal(L.search(idx, 'energy').results[0].entry.id, 'vitq');
});

test('two-letter prefixes find nothing; three letters do', () => {
  assert.deepEqual(top('ar', { typing: true }), []);
  assert.equal(top('arm', { typing: true })[0], 'arm-get');
});

test('phrase synonyms fold after stemming: plurals and spaced or joined spellings', () => {
  assert.equal(top('heavy troopers')[0], 'w-ht');
  assert.equal(top('titan canyon signup')[0], 'ev-tc-signup');
  assert.equal(top('sign-up for tc')[0], 'ev-tc-signup');
});

test('did-you-mean is only offered when the corrected words would find something', () => {
  assert.equal(L.search(IDX, 'squod').suggestion, 'squad');
  assert.equal(L.search(IDX, 'blorpz').suggestion, null);
});

test('an exact word is highlighted and needs no why-line, even when a synonym elsewhere in the entry scores more', () => {
  const idx = L.buildIndex([
    E('a', 'armory', 'How do I get my own armory?', 'Run the Snapshot.', ['armoury setup', 'my armoury', 'armoury help'], ['armoury']),
    E('b', 'words', 'What is HT?', 'y'),
  ], { synonyms: SYN, categories: CATS });
  const r = L.search(idx, 'how do i get my own armory').results[0];
  assert.equal(r.entry.id, 'a');
  assert.ok(r.matched.includes('armory'), JSON.stringify(r.matched));
  assert.deepEqual(r.why, []);
  assert.match(L.highlight(r.entry.question, r.matched), /<mark>armory<\/mark>/);
});

test('words that are names of built-in object properties are just words (constructor, __proto__, toString)', () => {
  const idx = L.buildIndex([
    E('c', 'words', 'What is a constructor in the toString hasOwnProperty guide?', 'The __proto__ answer.', ['valueOf wording'], ['constructor']),
    E('o', 'words', 'What is HT?', 'Heavy Trooper.'),
  ], { synonyms: SYN.concat([['constructor', 'builder']]), categories: CATS });
  for (const q of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'constructor tostring', 'builder']) {
    const r = L.search(idx, q, { typing: true });
    assert.ok(Array.isArray(r.results), q);
    L.search(idx, q, { typing: false });
  }
  assert.equal(L.search(idx, 'constructor').results[0].entry.id, 'c');
  assert.equal(L.search(idx, 'builder').results[0].entry.id, 'c');
  assert.deepEqual(L.search(IDX, 'constructor').results, []);
  assert.equal(L.search(IDX, '__proto__').suggestion, null);
  assert.deepEqual(L.similar(IDX, 'constructor toString'), []);
  assert.equal(L.highlight('a constructor', ['constructor']), 'a <mark>constructor</mark>');
  assert.equal(L.highlight('toString x', []), 'toString x');
});
