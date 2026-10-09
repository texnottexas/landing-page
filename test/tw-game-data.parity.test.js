'use strict';
// Parity: pages/tw-game-data.js and pages/tw-game-data-base.js against pages/armory-report.html (armory redesign,
// phase 1). Every table and function in the modules is a verbatim copy; this test pulls the same name out of the page
// and requires (1) the exact source text to appear in the module file, (2) deep-equal table values, and (3) identical
// outputs for the functions on fixtures. v1 is frozen, so a change to the page that is not mirrored here fails.
// Run: node --test test/tw-game-data.parity.test.js
// ARMORY_FILE=<scratch copy of the page> proves it fails when the page changes (see docs/armory-review-2026-10/v2-phase1.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./helpers/armory-page.js');

const G = require('../pages/tw-game-data.js');
const B = require('../pages/tw-game-data-base.js');
const G_FILE = fs.readFileSync(path.join(P.ROOT, 'pages/tw-game-data.js'), 'utf8');
const B_FILE = fs.readFileSync(path.join(P.ROOT, 'pages/tw-game-data-base.js'), 'utf8');
const GLUE = new Set(['setSuppDecode']); // not in the page: the seam for window._enigmaSuppDecode

const gNames = Object.keys(G).filter((k) => !GLUE.has(k));
const bNames = Object.keys(B);
const gFns = gNames.filter((k) => typeof G[k] === 'function');
const gTables = gNames.filter((k) => typeof G[k] !== 'function');

const ctx = P.loadPage(gNames.concat(bNames));

test('the modules export what they claim (sanity: counts do not silently shrink)', () => {
  assert.ok(gTables.length >= 60, 'tables in tw-game-data.js: ' + gTables.length);
  assert.ok(gFns.length >= 20, 'functions in tw-game-data.js: ' + gFns.length);
  assert.ok(bNames.length >= 10, 'tables in tw-game-data-base.js: ' + bNames.length);
});

for (const [label, names, file, mod] of [['tw-game-data.js', gNames, G_FILE, G], ['tw-game-data-base.js', bNames, B_FILE, B]]) {
  test(label + ': every export is a verbatim copy of the page (same source text)', () => {
    for (const n of names) {
      const src = P.fnSource(n) || P.varSource(n);
      assert.ok(src, n + ' is not in pages/armory-report.html any more');
      assert.ok(file.includes(src), n + ' differs from pages/armory-report.html (' + label + ' is no longer a verbatim copy)');
      if (typeof mod[n] === 'function') assert.equal(mod[n].toString(), src.trim(), n + ' exported function text');
    }
  });
}

test('tables are deep-equal to the page (tw-game-data.js and tw-game-data-base.js)', () => {
  for (const n of gTables) assert.deepStrictEqual(P.j(G[n]), P.j(ctx[n]), n);
  for (const n of bNames) assert.deepStrictEqual(P.j(B[n]), P.j(ctx[n]), n);
});

const same = (name, ...args) => {
  const a = ctx[name].apply(null, P.clone(args));
  const b = G[name].apply(null, P.clone(args));
  assert.deepStrictEqual(P.j(b), P.j(a), name + '(' + JSON.stringify(args) + ')');
  return b;
};

test('resolveRune: identical on every table id, the derived 6-digit ids, the alternate prefixes and a wide sweep', () => {
  const ids = [];
  for (const k of Object.keys(G.RUNE_MAP).map(Number)) {
    ids.push(k, k * 10, k * 10 + 1, k * 10 + 6, k + 1, k - 1);
    const s = String(k);
    ids.push(Number(s[0] + '01' + s.slice(3)), Number(s[0] + '03' + s.slice(3)), Number(s[0] + '02' + s.slice(3)));
  }
  for (let i = 0; i < 3000000; i += 7919) ids.push(i);
  ids.push(0, 1, 424242, 99999999);
  let resolved = 0;
  for (const id of ids) if (same('resolveRune', id)) resolved++;
  assert.ok(resolved > Object.keys(G.RUNE_MAP).length, 'resolves the table plus derived ids (' + resolved + ')');
});

test('resolveRune: hand-checked values (fallbacks)', () => {
  const k = Object.keys(G.RUNE_MAP).map(Number).find((x) => x >= 10000 && x < 100000);
  const base = G.RUNE_MAP[k];
  assert.deepStrictEqual(P.j(G.resolveRune(k)), P.j(base), 'table hit');
  assert.deepStrictEqual(P.j(G.resolveRune(k * 10 + 3)), { n: base.n, s: 3, sm: base.sm }, '6-digit = base5 * 10 + star');
  assert.equal(G.resolveRune(424242), null);
});

test('rollColor: thresholds 25 / 50 / 70 and the colours', () => {
  for (let p = -5; p <= 130; p++) same('rollColor', p);
  assert.equal(G.rollColor(70), '#56d364');
  assert.equal(G.rollColor(69.9), '#e3b341');
  assert.equal(G.rollColor(50), '#e3b341');
  assert.equal(G.rollColor(49.9), '#a371f7');
  assert.equal(G.rollColor(25), '#a371f7');
  assert.equal(G.rollColor(24.9), '#6cb6ff');
});

test('chip, gear and decor formatters', () => {
  for (const sid of Object.keys(G.CHIP_SETS).concat(['999', 'x'])) for (const c of [undefined, 0, 1, 2, 3, 4, 5, 9]) same('getBonuses', sid, c);
  for (const b of ['Army', 'Navy', 'Air Force', 'army hero', 'NAVY', 'Unknown', '', undefined]) same('branchClass', b);
  for (const b of [{ t: 1, v: 5 }, { t: 10000, v: 400 }, { t: 10000, v: 450 }, { t: 10000, v: 0 }]) same('formatDecorBuffVal', b);
  for (const [v, n] of [[3, 'March Size'], [400, 'All units ATK'], [450, 'x'], [0, 'x']]) same('formatBaseBuffVal', v, n);
  for (const v of [null, undefined, 0, 1.5, 12.345, 100, 33.3333]) same('_gp_fmtPct', v);
  for (const p of [0, 24, 25, 49, 50, 69, 70, 100]) same('_gp_rollColor', p);
  const tids = Object.keys(G.GEAR_TEMPLATE).map(Number);
  for (const t of tids) for (const b of [{ templateId: t, rawValue: 300 }, { templateId: t, valuePercent: 0.5 }, { templateId: t }]) same('_gp_rollPct', b);
  same('_gp_rollPct', { templateId: 99999999, rawValue: 5 });
  const equipIds = Object.keys(G.EQUIP_BASE_BUFF);
  for (const id of equipIds) for (const lvl of [0, 1, 20, 50]) same('_gp_resolveBaseStats', { equipId: Number(id), level: lvl, enhance: {} });
  same('_gp_resolveBaseStats', null);
  same('_gp_resolveBaseStats', { equipId: null });
});

test('Enigma Beast tables: config decode, names, buff values, potential caps', () => {
  for (let cfg = -1; cfg <= 200; cfg++) same('ebDecodeCfg', cfg);
  same('ebDecodeCfg', null);
  same('ebDecodeCfg', undefined);
  // the supplement sidecar path (window._enigmaSuppDecode): the page reads its window, the module its own
  const sidecar = P.fixture('beasts.json').suppDecode;
  ctx.window._enigmaSuppDecode = sidecar;
  G.setSuppDecode(sidecar);
  for (const cfg of Object.keys(sidecar).map(Number).concat([25, 81, 1])) same('ebDecodeCfg', cfg);
  ctx.window._enigmaSuppDecode = null;
  G.setSuppDecode(null);
  for (let t = 0; t <= 11; t++) same('ebBeastName', t, 3);
  const buffIds = Object.keys(G.EB_BUFF_NAMES).concat(Object.keys(G.EB_FIELD_BUFF_NAMES), ['1', 'abc']);
  for (const id of buffIds) same('ebBuffName', id);
  for (let q = 0; q <= 6; q++) same('ebMaxPotential', q);
  const allBuffs = [520000, 520010, 520013, 520020, 520030, 520040, 520073, 520100, 520110, 520123, 520130, 520143, 999999, 0];
  for (const id of allBuffs) {
    same('ebGetBuffCategory', id);
    for (const star of [0, 1, 3, 5]) for (const lvl of [0, 10, 60, 100]) for (const pot of [0, 4000, 16000]) for (const main of [true, false]) {
      same('ebComputeBuffValue', id, star, lvl, pot, main);
    }
    same('ebFormatBuffValue', 12.3456, id);
  }
  for (let n = 0; n <= 5; n++) same('ebStarStr', n);
  for (const p of [0, 50, 64.9, 65, 84.9, 85, 100]) same('ebPotColor', p);
});

test('Beast Optimizer constants and gear template classification', () => {
  for (const t of Object.keys(G.GEAR_TEMPLATE).concat(['99999999', '0'])) same('boGearTemplateClassify', Number(t));
  for (const q of [undefined, 0, 1, 2, 3, 4, 5, 6]) { same('boMaxStarFor', { q }); same('boMaxLevelFor', { q }); }
  for (let a = 0; a <= 5; a++) for (let b = 0; b <= 6; b++) same('boFodderForStarUp', a, b);
});

test('chip tables agree with the HT chip family rules the redesign relies on (Next moves uses colour = id/100 % 10)', () => {
  // every regular chip in CL: position 1-6, colour digit in the id, value = base + per * level
  let n = 0;
  for (const [id, row] of Object.entries(G.CL)) {
    const [, pos, color, , para, up, core] = row;
    if (core || pos < 1 || pos > 6) continue;
    assert.equal(Math.floor(Number(id) / 100) % 10, color, 'chip ' + id + ' colour digit');
    assert.ok(para > 0 && up > 0, 'chip ' + id + ' values');
    n++;
  }
  assert.ok(n > 200, 'regular chips checked: ' + n);
});
