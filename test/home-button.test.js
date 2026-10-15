'use strict';
// The Learning Lounge, its mentor page and the Leadership page share one home button (Tex 2026-10-15).
// Run: node --test test/home-button.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGES = ['learn.html', 'learn-admin.html', 'leadership.html'];
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'pages', f), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

test('one home button: same link, icon and style on all three pages', () => {
  const links = PAGES.map((f) => {
    const m = read(f).match(/<a class="home-btn"[\s\S]*?<\/a>/);
    assert.ok(m, f + ' has a .home-btn link');
    return squash(m[0]);
  });
  for (const l of links) assert.equal(l, links[0]);
  assert.match(links[0], /href="https:\/\/2864tw\.com"/);
  assert.match(links[0], /aria-label="Home"/);
  const css = PAGES.map((f) => (read(f).match(/^\.home-btn \{[^\n]*\n\.home-btn:hover[^\n]*\n/m) || [null])[0]);
  css.forEach((c, i) => assert.ok(c, PAGES[i] + ' has the shared .home-btn rules'));
  for (const c of css) assert.equal(c, css[0]);
  assert.match(css[0], /min-height: 44px/);
});
