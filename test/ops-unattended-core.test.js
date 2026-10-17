'use strict';
// Ops Center Unattended mode (Tex 2026-10-16): the rules the tab and the dashboard share.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../ops-unattended-core.js');

const TEX = 'd847a198622a518d', REX = 'c3c6f3200a4ec1fb', PW = 'amber falcon river';
const NOW = 1792190000000;
let KT, KR;
test.before(async () => { KT = await U.deriveKey(PW, TEX); KR = await U.deriveKey(PW, REX); });
const ctx = (o) => Object.assign({ siteKey: TEX, now: NOW, seen: {}, tools: U.ORDER.slice() }, o);

test('the command key: 32 bytes as hex, the same each time, different per account and password', async () => {
  assert.match(KT, /^[0-9a-f]{64}$/);
  assert.equal(await U.deriveKey(PW, TEX), KT);
  assert.notEqual(KR, KT);
  assert.notEqual(await U.deriveKey('another phrase', TEX), KT);
  assert.equal(U.ITER, 210000);
});

test('signed the dashboard\'s way, checked the tab\'s way', async () => {
  const c = U.makeCommand(TEX, 'start', 'odin-gather', NOW);
  assert.match(c.nonce, /^[0-9a-f]{32}$/);
  assert.equal(U.canon(c), 'v1|' + TEX + '|start|odin-gather|' + NOW + '|' + c.nonce);
  const sig = await U.sign(KT, c);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.deepEqual(await U.check(KT, c, sig, ctx()), { ok: true });
  assert.deepEqual(await U.check(KT, Object.assign({}, c, { tool: 'mask-boxes' }), sig, ctx()), { ok: false, why: 'bad signature', badSig: true }, 'changed after signing');
  assert.deepEqual(await U.check(KT, c, 'f'.repeat(64), ctx()), { ok: false, why: 'bad signature', badSig: true });
  assert.deepEqual(await U.check(KT, c, 'nope', ctx()), { ok: false, why: 'bad signature', badSig: true });
});

test('a command for Rеx doesn\'t pass on Tex\'s tab (Review Focus 5)', async () => {
  const c = U.makeCommand(REX, 'start', 'mask-boxes', NOW);
  assert.deepEqual(await U.check(KT, c, await U.sign(KR, c), ctx()), { ok: false, why: 'bad signature', badSig: true }, 'signed with Rеx\'s key');
  assert.deepEqual(await U.check(KT, c, await U.sign(KT, c), ctx()), { ok: false, why: 'wrong account' }, 'even signed with Tex\'s key');
});

test('fresh, unseen, a known kind and tool', async () => {
  const sigd = async (o) => { const c = Object.assign(U.makeCommand(TEX, 'start', 'mask-boxes', NOW), o); return [c, await U.sign(KT, c)]; };
  let [c, s] = await sigd({ at: NOW - U.TTL_MS });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: false, why: 'too old' });
  [c, s] = await sigd({ at: NOW + U.TTL_MS - 1 });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: true }, 'the tab\'s clock behind the worker\'s: still fresh');
  [c, s] = await sigd({});
  assert.deepEqual(await U.check(KT, c, s, ctx({ seen: { [c.nonce]: NOW - 1000 } })), { ok: false, why: 'seen before' });
  [c, s] = await sigd({ kind: 'eval' });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: false, why: 'unknown kind' });
  [c, s] = await sigd({ tool: 'troop' });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: false, why: 'unknown tool' });
  [c, s] = await sigd({ tool: 'angels' });
  assert.deepEqual(await U.check(KT, c, s, ctx({ tools: ['mask-boxes'] })), { ok: false, why: 'unknown tool' }, 'not in the published list');
  [c, s] = await sigd({ kind: 'reconnect', tool: 'mask-boxes' });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: false, why: 'bad command' });
  [c, s] = await sigd({ kind: 'stopall', tool: '' });
  assert.deepEqual(await U.check(KT, c, s, ctx()), { ok: true });
});

test('seen numbers are kept 10 minutes', () => {
  assert.deepEqual(U.pruneSeen({ a: NOW - U.SEEN_MS + 1, b: NOW - U.SEEN_MS }, NOW), { a: NOW - U.SEEN_MS + 1 });
  assert.deepEqual(U.pruneSeen(null, NOW), {});
  assert.equal(U.BAD_SIG_MAX, 3);
});

test('the six tools, their globals and the one that needs a saved password (HT Gift Boxes has none since 2026-10-16)', () => {
  assert.deepEqual(U.ORDER, ['mask-boxes', 'enigma-veins', 'ht-gifts', 'angels', 'odin-gather', 'map-collector']);
  assert.deepEqual(U.TOOLS, { 'mask-boxes': '__MBX', 'enigma-veins': '__VEIN', 'ht-gifts': '__HTG', angels: '__ANG', 'odin-gather': '__ODIN', 'map-collector': '__MAPC' });
  assert.deepEqual(U.NEEDS_PW, { 'map-collector': 'mapc_pw_v1' });
});

test('dashboard words: header, login link age, a tool row', () => {
  const acc = (o) => Object.assign({ on: true, seenAt: NOW - 8000, downSince: 0, status: { connected: true, loadedAt: NOW - 3 * 3600e3, tools: {} } }, o);
  assert.deepEqual(U.header(acc(), NOW), { text: 'On, connected', tone: 'ok' });
  assert.deepEqual(U.header(acc({ downSince: NOW - 12 * 60e3, status: { connected: false } }), NOW), { text: 'On, down 12m', tone: 'bad' });
  assert.deepEqual(U.header(acc({ seenAt: NOW - 6 * 60e3 }), NOW), { text: 'No check-in for 6m', tone: 'warn' });
  assert.deepEqual(U.header(acc({ on: false }), NOW), { text: 'Off', tone: 'mute' });
  assert.deepEqual(U.loginAge(acc(), NOW), { text: 'login link 3h old', warn: false });
  assert.deepEqual(U.loginAge(acc({ status: { loadedAt: NOW - 21 * 3600e3 } }), NOW), { text: 'login link 21h old', warn: true });
  assert.equal(U.mins(65 * 60e3), '1h 5m');
  const a = acc({ status: { connected: true, tools: { 'odin-gather': { state: 'running' }, angels: { state: 'stopped', why: 'The event ended.' } } } });
  assert.deepEqual(U.toolRow(a, 'odin-gather'), { id: 'odin-gather', state: 'running', label: 'Running', action: 'stop' });
  assert.deepEqual(U.toolRow(a, 'angels'), { id: 'angels', state: 'stopped', label: 'Stopped: The event ended.', action: 'start' });
  assert.deepEqual(U.toolRow(a, 'mask-boxes'), { id: 'mask-boxes', state: 'off', label: 'Not open', action: 'start' });
});
