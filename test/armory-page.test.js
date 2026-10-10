'use strict';
// Armory v2 page (pages/armory.html) static guards that run with no browser: the CSP is the classic page's, every script it loads
// exists, parses and is deployed by pages.yml, the beta switch and the ?advise= / ?plan= hand-off behave, the classic page shows
// its "Try the new Armory" link only behind the flag, and the new files carry no emoji, em dash or personal name.
// The browser behaviour (tabs, sheets, share, 12 px floor, tap targets) is covered by docs/armory-review-2026-10/harness/tour-v2.js
// and the in-page acceptance script (armory.html?check=1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const V2 = read('pages/armory.html'), V1 = read('pages/armory-report.html'), YML = read('.github/workflows/pages.yml');
// the owner's personal name (never allowed in this public repo), kept base64-encoded so the test file itself does not contain it
const NAMES = new RegExp(['U2hpdmE=', 'QmV6d2FkYQ=='].map((b) => Buffer.from(b, 'base64').toString()).join('|'));
const csp = (h) => (/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(h) || [])[1];

test('the new page carries the classic page CSP byte for byte', () => {
  assert.ok(csp(V1), 'classic CSP found');
  assert.equal(csp(V2), csp(V1));
});

test('every local script the page loads exists, parses, and is copied by pages.yml', () => {
  const srcs = [...V2.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  assert.ok(srcs.includes('armory-app.js') && srcs.includes('armory-vm.js'));
  const cp = YML.split('\n').find((l) => /cp pages\/index\.html/.test(l));
  for (const s of srcs) {
    const f = s === 'feedback-widget.js' ? s : 'pages/' + s;
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
    new vm.Script(read(f), { filename: f });
    if (s !== 'feedback-widget.js') assert.ok(cp.includes(f), f + ' is in the pages.yml cp line');
  }
  for (const lazy of ['pages/armory.html', 'pages/armory-more.js', 'pages/armory-ht.js', 'pages/armory-advice.js', 'pages/armory-advice-flows.js', 'pages/armory-check.js']) assert.ok(cp.includes(lazy), lazy + ' is in the pages.yml cp line');
  for (const m of V2.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1], { filename: 'inline' });
});

test('no emoji, em dash or personal name in the new files', () => {
  for (const f of ['pages/armory.html', 'pages/armory-app.js', 'pages/armory-more.js', 'pages/armory-ht.js', 'pages/armory-advice.js', 'pages/armory-advice-flows.js', 'pages/armory-check.js']) {
    const t = read(f);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t.replace(/[©®™]/g, '')), f + ' has an emoji');
    assert.ok(!/—/.test(t), f + ' has an em dash');
    assert.ok(!NAMES.test(t), f + ' has a personal name');
  }
});

function headScript() { return /<script>\s*\/\* Beta switch[\s\S]*?<\/script>/.exec(V2)[0].replace(/^<script>|<\/script>$/g, ''); }
function runHead(search, hash) {
  const store = {}, calls = { replace: [] };
  const ctx = { location: { search, hash: hash || '', replace: (u) => calls.replace.push(u) }, localStorage: { setItem: (k, v) => { store[k] = v; } } };
  vm.runInNewContext(headScript(), ctx);
  return { store, replace: calls.replace };
}
test('?beta=1 turns the switch on; ?advise= and ?plan= stay on the new page (they no longer hand off to classic)', () => {
  assert.deepEqual(runHead('?beta=1').store, { armory_v2_beta: '1' });
  assert.deepEqual(runHead('').store, {}); assert.deepEqual(runHead('?code=ABCD').replace, []);
  assert.deepEqual(runHead('?advise=ABC123').replace, []);
  assert.deepEqual(runHead('?plan=ABC123&beta=1', '#x').replace, []);
  assert.deepEqual(runHead('?beta=1&advise=ABC123').replace, []);
  assert.deepEqual(runHead('?beta=1&advise=ABC123').store, { armory_v2_beta: '1' });
});

test('Advice: the advisor tabs map to #heroes/advice (no classic redirect), boot reads ?advise= and ?plan= from the worker, the module loads lazily', () => {
  const app = read('pages/armory-app.js');
  const legacy = /var LEGACY = \{([^}]*)\}/.exec(app)[1];
  assert.match(legacy, /myadvisorplans: 'heroes\/advice'/); assert.match(legacy, /advisorplan: 'heroes\/advice'/);
  assert.ok(!/classic/.test(legacy), 'no classic hand-off left in LEGACY');
  assert.ok(!/location\.replace\('armory-report\.html/.test(app), 'the shim no longer redirects');
  assert.match(app, /\/advisor\/request\//); assert.match(app, /\/advisor\/index\//);
  assert.match(app, /\['advice', 'Advice'\]/);
  assert.match(app, /sc\.src = 'armory-advice\.js'/, 'loaded on first use');
  assert.ok(!/armory-advice-flows/.test(app) && /armory-advice-flows\.js/.test(read('pages/armory-advice.js')), 'the Ask and Advise-a-player sheets load only when one of their buttons is tapped');
  assert.ok(!/armory-advice\.js/.test(V2), 'not a first-paint script');
  assert.ok(!/advise|plan|replace\(/.test(headScript()), 'the head script has no advise/plan redirect');
});

function v1Snippet() { return /<script>\s*\/\* Armory v2 beta: one small link[\s\S]*?<\/script>/.exec(V1)[0].replace(/^<script>|<\/script>$/g, ''); }
function runV1(flag, search, hash) {
  const made = [];
  const doc = { createElement: () => { const el = { style: {}, set href(v) { this._h = v; }, get href() { return this._h; } }; made.push(el); return el; }, body: { appendChild: () => {}, style: {} } };
  vm.runInNewContext(v1Snippet(), { window: { innerWidth: 390 }, document: doc, location: { search, hash: hash || '' }, localStorage: { getItem: (k) => (k === 'armory_v2_beta' ? flag : null) }, RegExp });
  return made;
}
test('the classic page shows "Try the new Armory" only behind the flag, carries code, advise and plan over, and the only edit is that snippet', () => {
  assert.equal(runV1(null, '').length, 0);
  assert.equal(runV1('0', '').length, 0);
  const a = runV1('1', '?code=abcd', '#tab=heroes');
  assert.equal(a.length, 1); assert.equal(a[0].href, 'armory.html?code=abcd#tab=heroes'); assert.equal(a[0].id, 'try-new-armory');
  assert.equal(runV1('1', '?advise=ABC123')[0].href, 'armory.html?advise=ABC123');
  assert.equal(runV1('1', '?plan=abc123&beta=1')[0].href, 'armory.html?plan=abc123', 'beta is stripped');
  assert.equal(runV1('1', '?beta=1&code=ABCD&plan=zzz999', '#x')[0].href, 'armory.html?code=ABCD&plan=zzz999#x');
  assert.equal(runV1('1', '?beta=1')[0].href, 'armory.html', 'no dangling ?');
  assert.equal(runV1('1', '')[0].href, 'armory.html');
  assert.equal(runV1('1', '?advise=abc<b>&plan=a%20b&check=1&code=toolong')[0].href, 'armory.html', 'only well-formed code, advise and plan values are carried');
  assert.ok(/z-index:\d{7,}/.test(v1Snippet()), 'above the Welcome Back dialog (z-index 1000)');
  assert.ok(/paddingBottom/.test(v1Snippet()), 'phones keep the end of the page reachable');
  assert.equal(V1.split('armory_v2_beta').length - 1, 1, 'one mention in the classic page');
});
