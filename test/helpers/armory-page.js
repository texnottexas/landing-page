'use strict';
// Shared by test/tw-game-data.parity.test.js and test/armory-core.parity.test.js: pulls functions and `var` tables out
// of pages/armory-report.html by name (string/comment-aware brace matching, like test/advisor-logic.test.js) and runs
// them in a vm sandbox, so the parity tests read the code that actually ships in the page.
// ARMORY_FILE points a run at a scratch copy of the page (used to prove a parity test fails when the page changes).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const PAGE_FILE = process.env.ARMORY_FILE || path.join(ROOT, 'pages/armory-report.html');
const SRC = fs.readFileSync(PAGE_FILE, 'utf8');

// Index of the `}` that closes the `{` at `open`, skipping strings, template literals and comments.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces at ' + open);
}
// Index of the `;` that ends the statement starting at `start` (depth 0 across braces, brackets and parens).
function stmtEnd(src, start) {
  let d = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if ('{[('.includes(c)) d++;
    else if ('}])'.includes(c)) d--;
    else if (c === ';' && d === 0) return i;
  }
  throw new Error('no statement end at ' + start);
}
function fnMatch(name) { return new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(SRC); }
function varMatch(name) { return new RegExp('^  var ' + name + '\\s*=', 'm').exec(SRC); }
function fnSource(name) {
  const m = fnMatch(name);
  if (!m) return null;
  const open = SRC.indexOf('{', SRC.indexOf(')', m.index));
  return SRC.slice(m.index, matchBrace(SRC, open) + 1);
}
function varSource(name) { // `var NAME = ...;` (possibly multi-line)
  const m = varMatch(name);
  return m ? SRC.slice(m.index, stmtEnd(SRC, m.index) + 1) : null;
}
function positionOf(name) {
  const m = fnMatch(name) || varMatch(name);
  return m ? m.index : -1;
}

// A sandbox holding the named functions/vars, in the order they appear in the page. A name the page does not have
// is simply absent (a test that needs it then fails with a ReferenceError instead of the whole file failing to load).
// The sandbox shares this realm's Date (so a test can mock Date.now once for both sides) and gets a stub `window`.
function loadPage(names, globals) {
  const ctx = vm.createContext(Object.assign({ console, Date, window: {} }, globals || {}));
  const found = names.map((n) => ({ n, at: positionOf(n) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  vm.runInContext(found.map((x) => fnSource(x.n) || varSource(x.n)).join('\n'), ctx);
  return ctx;
}

const j = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o)); // normalizes vm-realm objects; drops undefined
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/armory-core', name), 'utf8'));
const data = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));

module.exports = { ROOT, PAGE_FILE, SRC, matchBrace, stmtEnd, fnSource, varSource, positionOf, loadPage, j, clone, fixture, data };
