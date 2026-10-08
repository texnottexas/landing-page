'use strict';
// Fun Stuff pure rules. Run: node --test test/fun-stuff-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fun-stuff-core.js');

const CAT = {
  version: '2026-10-07',
  packs: [{ id: 23, name: 'Heroes', icon: 'packs/23.png' }, { id: 32, name: 'Critters', icon: 'static/303.png' }],
  emojis: [
    { id: 192, kind: 'static', pack: 23, name: 'Tywin: Cheer up', file: 'static/192.png' },
    { id: 303, kind: 'static', pack: 32, name: 'Above the Stars', file: 'static/303.png' },
    { id: 10005, kind: 'gif', pack: 'gif', name: 'Sara: Cyber Thumbs-Up', file: 'gif/10005.gif', thumb: 'gif-thumb/10005.png' }
  ]
};

test('parseCatalog: keeps good rows, packs and the version', () => {
  const c = F.parseCatalog(CAT);
  assert.equal(c.version, '2026-10-07');
  assert.deepEqual(c.packs.map((p) => p.id), [23, 32]);
  assert.deepEqual(c.emojis.map((e) => F.emojiKey(e)), ['static:192', 'static:303', 'gif:10005']);
  assert.equal(c.emojis[2].thumb, 'gif-thumb/10005.png');
});

test('parseCatalog: drops rows without an id, a known kind or a safe file path; null for junk', () => {
  const bad = { version: 'x', packs: [{ id: 1, name: 'P', icon: '../evil.png' }, { id: 23, name: 'Heroes', icon: 'packs/23.png' }], emojis: [
    { kind: 'static', pack: 23, name: 'no id', file: 'static/1.png' },
    { id: 0, kind: 'static', pack: 23, name: 'zero', file: 'static/0.png' },
    { id: 5, kind: 'sticker', pack: 23, name: 'kind', file: 'static/5.png' },
    { id: 6, kind: 'static', pack: 23, name: 'path', file: 'https://evil.example/6.png' },
    { id: 7, kind: 'static', pack: 23, name: 'quote', file: 'static/7.png" onerror="x' },
    { id: 8, kind: 'gif', pack: 'gif', name: 'thumb', file: 'gif/8.gif', thumb: 'javascript:alert(1)' },
    { id: 9, kind: 'static', pack: 23, name: 'ok', file: 'static/9.png' }
  ] };
  const c = F.parseCatalog(bad);
  assert.deepEqual(c.packs.map((p) => p.id), [23]);
  assert.deepEqual(c.emojis.map((e) => e.id), [8, 9]);
  assert.equal(c.emojis[0].thumb, undefined);
  assert.equal(F.parseCatalog(null), null);
  assert.equal(F.parseCatalog({ packs: 'x', emojis: [] }), null);
  assert.equal(F.parseCatalog('{"packs":[]}'), null);
});

test('target: like the game\'s own picker, the open chat\'s channel and Id with no name, for every kind of chat', () => {
  // the game opens its picker with init(NowChoiceKey.Channel, NowChoiceKey.Id) and sends (channel, emoji, Id, '')
  assert.deepEqual(F.target(null, '42'), { channel: 0, uid: '', name: '', label: 'World' });
  assert.deepEqual(F.target({ _channel: 0, _id: '102_1_2864g123' }, '42'), { channel: 0, uid: '102_1_2864g123', name: '', label: 'World' });
  assert.deepEqual(F.target({ _channel: 2, _id: '102_2_2864_500273604', _name: 'Alliance' }, '42'), { channel: 2, uid: '102_2_2864_500273604', name: '', label: 'Alliance' });
  assert.deepEqual(F.target({ _channel: 5, _id: '102_5_994194adfcb944938909c1c8e9f662c9', _name: 'Husky Homies' }, '42'),
    { channel: 5, uid: '102_5_994194adfcb944938909c1c8e9f662c9', name: '', label: 'Husky Homies' }, 'group chat');
  assert.deepEqual(F.target({ _channel: 1, _id: 217160163552, _name: 'Tex' }, '42'), { channel: 1, uid: '217160163552', name: '', label: 'Tex' });
  assert.deepEqual(F.target({ _channel: 202, _id: '7550807444272', _name: 'Tex' }, '42'), { channel: 202, uid: '7550807444272', name: '', label: 'Tex' }, 'temporary private chat');
  assert.deepEqual(F.target({ _channel: 9, _id: '9102_9_157_en_55', _name: 'English' }, '42'), { channel: 9, uid: '9102_9_157_en_55', name: '', label: 'English' }, 'language chat');
  assert.deepEqual(F.target({ Channel: 5, Id: 'g1', _channel: 5, _id: 'g1', _name: 'G' }, '42'), { channel: 5, uid: 'g1', name: '', label: 'G' }, 'the game\'s getters');
  assert.deepEqual(F.target({ _channel: 1, _id: '7' }, '42'), { channel: 1, uid: '7', name: '', label: 'Private chat' });
  assert.deepEqual(F.target({ _channel: 5, _id: 'g2' }, '42'), { channel: 5, uid: 'g2', name: '', label: 'This chat' });
});

test('target: a chat with no Id, or a private chat with yourself, goes to world', () => {
  assert.deepEqual(F.target({ _channel: 1, _name: 'Nobody' }, '42'), { channel: 0, uid: '', name: '', label: 'World' });
  assert.deepEqual(F.target({ _channel: 5, _id: '' }, '42'), { channel: 0, uid: '', name: '', label: 'World' });
  assert.deepEqual(F.target({ _channel: 1, _id: '42', _name: 'Me' }, '42'), { channel: 0, uid: '', name: '', label: 'World' });
  assert.deepEqual(F.target({ _channel: 202, _id: '42', _name: 'Me' }, '42'), { channel: 0, uid: '', name: '', label: 'World' });
});

test('cooldown: one send every 3 s', () => {
  assert.equal(F.GAP_MS, 3000);
  assert.deepEqual(F.cooldown(0, 1000), { ok: true, waitMs: 0 });
  assert.deepEqual(F.cooldown(10000, 11000), { ok: false, waitMs: 2000 });
  assert.deepEqual(F.cooldown(10000, 13000), { ok: true, waitMs: 0 });
});

test('iconUrl: the thumb when there is one, else the file, under the pinned base', () => {
  const B = 'https://cdn.jsdelivr.net/gh/texnottexas/tw-emoji-assets@abc';
  assert.equal(F.iconUrl(B, CAT.emojis[0]), B + '/static/192.png');
  assert.equal(F.iconUrl(B, CAT.emojis[2]), B + '/gif-thumb/10005.png');
  assert.equal(F.iconUrl(B + '/', { file: 'packs/23.png' }), B + '/packs/23.png');
});

test('recent: newest first, unique, at most 16', () => {
  let r = [];
  for (let i = 1; i <= 20; i++) r = F.recent(r, 'static:' + i);
  assert.equal(r.length, 16);
  assert.equal(r[0], 'static:20');
  r = F.recent(r, 'static:10');
  assert.equal(r[0], 'static:10');
  assert.equal(r.filter((k) => k === 'static:10').length, 1);
  assert.deepEqual(F.recent(null, 'gif:10005'), ['gif:10005']);
});

test('gifLocked: animated needs the game level floor (default 20)', () => {
  assert.equal(F.gifLocked(19, 20), true);
  assert.equal(F.gifLocked(20, 20), false);
  assert.equal(F.gifLocked(5, undefined), true);
  assert.equal(F.gifLocked(25, undefined), false);
});
