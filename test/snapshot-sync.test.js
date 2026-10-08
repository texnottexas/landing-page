'use strict';
// Snapshot → armory direct sync (Tex, 2026-10-08): the bookmarklet signs in with the worker using the game's own UID
// and uploads every section the armory's paste-import would. Run: node --test test/snapshot-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../all-bookmarklet.js');

const W = 'https://worker.test';
function dump(o) {
  return Object.assign({
    v: 3, ts: '2026-10-08T10:00:00.000Z', meta: { uid: '1234567890', lvl: 100, sid: 2864 },
    inventory: { v: 1, meta: { uid: '1234567890', lvl: 100, sid: 2864, ts: '2026-10-08T10:00:00.000Z' }, resources: { gold: 5, _paidgold: 9, _payCNYTotal: 8 }, tabs: {} },
    beasts: { v: 1, ts: '2026-10-08T10:00:00.000Z', beasts: [] },
    chips: { v: 1, chips: [] },
    gear: { v: 1, meta: { ts: '2026-10-08T10:00:00.000Z' }, summary: {} },
    heroes: null, formation: null, enigmaState: { v: 1, fields: [] }, decorations: null, baseSkin: null, errors: []
  }, o || {});
}
// A fake worker: records calls; handshake answers per `hs`, uploads per `up(kind)`.
function fakeFetch(opts) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (opts.down) throw new Error('network');
    if (url === W + '/supplement/handshake') {
      const st = opts.hs || 200;
      return { ok: st === 200, status: st, json: async () => (st === 200 ? { token: 'tok123', siteKey: 'abcd' } : { error: 'x' }) };
    }
    const kind = JSON.parse(init.body).kind, st = (opts.up && opts.up(kind)) || 200;
    return { ok: st === 200, status: st, json: async () => (st === 200 ? { ok: true } : { error: 'schema: bad ' + kind }) };
  };
  f.calls = calls;
  return f;
}

test('the section list matches the armory\'s paste import (field → kind)', () => {
  assert.deepEqual(S.SECTIONS.map((s) => s.field + ':' + s.kind),
    ['inventory:inv', 'beasts:bench', 'chips:chips', 'gear:gear', 'heroes:heroes', 'formation:formation', 'enigmaState:enigma', 'decorations:decor', 'baseSkin:skin']);
});

test('sends: one handshake with the game UID, then each present section with the Bearer token', async () => {
  const f = fakeFetch({});
  const r = await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '1234567890', now: '2026-10-08T11:00:00.000Z' });
  assert.equal(r.state, 'done');
  assert.deepEqual(r.results.map((x) => x.kind + ':' + x.status), ['inv:ok', 'bench:ok', 'chips:ok', 'gear:ok', 'enigma:ok']);
  assert.equal(f.calls[0].url, W + '/supplement/handshake');
  assert.deepEqual(f.calls[0].body, { uid: '1234567890' });
  const ups = f.calls.slice(1);
  assert.equal(ups.length, 5);
  ups.forEach((c) => { assert.equal(c.url, W + '/supplement/upload'); assert.equal(c.init.headers.Authorization, 'Bearer tok123'); });
});

test('uploads never carry the UID or the spending fields, and a missing time is stamped where the armory reads it', async () => {
  const f = fakeFetch({});
  const d = dump();
  await S.sendToArmory(d, { fetch: f, worker: W, uid: '1234567890', now: '2026-10-08T11:00:00.000Z' });
  const byKind = {}; f.calls.slice(1).forEach((c) => { byKind[c.body.kind] = c.body.json; });
  assert.equal(byKind.inv.meta.uid, undefined);
  assert.equal(byKind.inv.resources._paidgold, undefined);
  assert.equal(byKind.inv.resources._payCNYTotal, undefined);
  assert.equal(byKind.inv.resources.gold, 5);
  assert.equal(byKind.chips.ts, '2026-10-08T11:00:00.000Z', 'ts stamped');
  assert.equal(byKind.bench.ts, '2026-10-08T10:00:00.000Z', 'existing ts kept');
  assert.equal(d.inventory.meta.uid, '1234567890', 'the dump itself (for Copy) is untouched');
  assert.ok(!JSON.stringify(f.calls.slice(1).map((c) => c.body)).includes('1234567890'), 'the UID appears in no upload');
});

test('not on the roster: one handshake, no uploads', async () => {
  const f = fakeFetch({ hs: 403 });
  const r = await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '1234567890' });
  assert.equal(r.state, 'not-member');
  assert.equal(f.calls.length, 1);
});

test('worker unreachable or no UID: an error, nothing uploaded', async () => {
  assert.equal((await S.sendToArmory(dump(), { fetch: fakeFetch({ down: true }), worker: W, uid: '1234567890' })).state, 'error');
  assert.equal((await S.sendToArmory(dump(), { fetch: fakeFetch({ hs: 429 }), worker: W, uid: '1234567890' })).state, 'error');
  const f = fakeFetch({});
  assert.equal((await S.sendToArmory(dump(), { fetch: f, worker: W, uid: '' })).state, 'no-uid');
  assert.equal(f.calls.length, 0);
});

test('one section refused or too large does not stop the others', async () => {
  const big = { v: 1, ts: 't', chips: [{ x: 'y'.repeat(1100000) }] };
  const f = fakeFetch({ up: (k) => (k === 'gear' ? 400 : 200) });
  const r = await S.sendToArmory(dump({ chips: big }), { fetch: f, worker: W, uid: '1234567890' });
  const st = {}; r.results.forEach((x) => { st[x.kind] = x.status; });
  assert.deepEqual(st, { inv: 'ok', bench: 'ok', chips: 'too-large', gear: 'failed', enigma: 'ok' });
  assert.match(r.results.find((x) => x.kind === 'gear').error, /schema: bad gear/);
  assert.ok(!f.calls.some((c) => c.body && c.body.kind === 'chips'), 'the too-large section is not sent');
});

test('summary text for the card', () => {
  const ok = (k, l) => ({ kind: k, label: l, status: 'ok' });
  assert.equal(S.syncText({ state: 'done', results: [ok('inv', 'Inventory'), ok('bench', 'Beasts')] }).text, 'Armory updated: Inventory, Beasts.');
  const part = S.syncText({ state: 'done', results: [ok('inv', 'Inventory'), { kind: 'gear', label: 'Titan gear', status: 'failed' }] });
  assert.equal(part.text, 'Armory updated: Inventory. Not saved: Titan gear.');
  assert.equal(part.tone, 'warn');
  assert.match(S.syncText({ state: 'not-member' }).text, /isn't on the Server 2864 roster/);
  assert.match(S.syncText({ state: 'error' }).text, /Couldn't reach your armory/);
  [ok('inv', 'Inventory')].concat([S.syncText({ state: 'error' }), S.syncText({ state: 'not-member' })]).forEach((x) => assert.ok(!/—/.test(JSON.stringify(x)), 'no em dash'));
});
