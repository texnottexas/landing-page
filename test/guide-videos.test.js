// test/guide-videos.test.js — run: node --test test/guide-videos.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../guide-videos.js');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0';

test('platform: iPhone, iPad in desktop mode, Android phone and tablet, desktop', () => {
  assert.equal(G.platform(IPHONE, 5), 'ios');
  assert.equal(G.platform(IPAD_AS_MAC, 5), 'ios');            // review focus 1
  assert.equal(G.platform(IPAD_AS_MAC, 0), 'desktop');
  assert.equal(G.platform(ANDROID, 5), 'android');
  assert.equal(G.platform(ANDROID_TABLET, 5), 'android');
  assert.equal(G.platform(MAC_FIREFOX, 0), 'desktop');
  assert.equal(G.platform('', 0), 'desktop');
});

test('defaults: Armory is Chrome on Android, Firefox elsewhere; Ops follows the device', () => {
  assert.deepEqual(['ios', 'android', 'desktop'].map((p) => G.defaultFilm('armory', p)), ['armoryFirefox', 'armoryChrome', 'armoryFirefox']);
  assert.deepEqual(['ios', 'android', 'desktop'].map((p) => G.defaultFilm('ops', p)), ['opsFirefox', 'opsChrome', 'opsDesktop']);
});

test('every film has a real-looking, distinct YouTube id, and the old ones are gone', () => {
  const ids = Object.values(G.FILMS).map((f) => f.id);
  ids.forEach((id) => assert.match(id, /^[A-Za-z0-9_-]{11}$/));
  // Placeholders stay red until the real unlisted IDs are in, so pages.yml can't deploy them.
  ids.forEach((id) => assert.doesNotMatch(id, /^PENDING/, 'video ID still a placeholder'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('uoAbjuFlIJ8') && !ids.includes('zK-jdYCSss4'));
});

test('sets only point at known films; skip points are whole seconds', () => {
  for (const set of Object.values(G.SETS)) {
    set.films.forEach((k) => assert.ok(G.FILMS[k], k));
    Object.values(set.pick).forEach((k) => assert.ok(set.films.includes(k), k));
    if (set.link) assert.ok(G.FILMS[set.link.film]);
    if (set.skip) for (const [k, s] of Object.entries(set.skip.at)) { assert.ok(set.films.includes(k)); assert.ok(Number.isInteger(s) && s > 0); }
  }
});

test('embed and watch URLs', () => {
  assert.equal(G.embedSrc('abcdefghijk', 0), 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0');
  assert.equal(G.embedSrc('abcdefghijk', 56.7), 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&start=56');
  assert.equal(G.watchUrl('abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('player-facing text has no em or en dashes', () => {
  const texts = [];
  for (const f of Object.values(G.FILMS)) texts.push(f.label);
  for (const s of Object.values(G.SETS)) texts.push(s.title, s.sub, s.skip && s.skip.label, s.skip && s.skip.hint, s.link && s.link.text);
  texts.filter(Boolean).forEach((t) => assert.doesNotMatch(t, /[—–]/, t));
});

test('both pages load guide-videos.js; the Ops page CSP allows the embed', () => {
  const ar = fs.readFileSync(path.join(__dirname, '..', 'pages', 'armory-report.html'), 'utf8');
  const rr = fs.readFileSync(path.join(__dirname, '..', 'pages', 'rickroll.html'), 'utf8');
  assert.match(ar, /<script src="guide-videos\.js"><\/script>/);
  assert.match(ar, /GuideVideos\.buildCard\('armory'\)/);
  assert.doesNotMatch(ar, /uoAbjuFlIJ8|zK-jdYCSss4|iOS Safari setup/);
  assert.match(rr, /<script src="guide-videos\.js"><\/script>/);
  assert.match(rr, /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.match(rr, /GuideVideos\.buildCard\('ops'\)/);
});
