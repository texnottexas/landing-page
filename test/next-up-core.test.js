'use strict';
// Homepage next-up card: what it shows and when (Tex 2026-10-15). Run: node --test test/next-up-core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../next-up-core.js');

const H = 3600e3, D = 24 * H;
const SAT = Date.parse('2026-10-24T18:00:00Z');          // Dog Squad A, +2
const CLOSES = '2026-10-22T20:00:00.000Z';
const tc = (o) => Object.assign({ ok: true, week: '2026-10-24', closesAt: CLOSES, signedUp: true, squad: 'Dog Squad A', slot: '+2', battleAt: SAT }, o);

test('TC week, placed: the big card counts down to the battle', () => {
  const r = N.pick({ now: SAT - 30 * H, tc: tc(), events: [] });
  assert.equal(r.kind, 'tc');
  assert.equal(r.title, 'Your squad: Dog Squad A');
  assert.equal(r.eyebrow, 'Titan Canyon week · Saturday, reset +2');
  assert.equal(r.target, SAT);
  assert.equal(r.link, '/titan');
  assert.equal(r.cta, 'See my squad');
});

test('during the battle hour it says so, then hands back to the calendar', () => {
  assert.equal(N.pick({ now: SAT + 10 * 60e3, tc: tc(), events: [] }).kind, 'tc-live');
  assert.equal(N.pick({ now: SAT + H - 1, tc: tc(), events: [] }).kind, 'tc-live');
  assert.equal(N.pick({ now: SAT + H, tc: tc(), events: [] }), null);
  const ev = [{ title: 'Group buff window', start: SAT + 2 * H, end: SAT + 3 * H }];
  assert.equal(N.pick({ now: SAT + H + 1, tc: tc(), events: ev }).kind, 'strip');
});

test('not signed up before signups close: a nudge to sign up, counting down to the close', () => {
  const now = Date.parse(CLOSES) - 5 * H;
  const r = N.pick({ now, tc: tc({ signedUp: false, squad: null, slot: null, battleAt: null }), events: [] });
  assert.deepEqual([r.kind, r.title, r.link, r.cta, r.target], ['tc-nudge', "You're not signed up yet", '/titan-signup', 'Sign up', Date.parse(CLOSES)]);
});

test('not signed up after signups close: no Titan Canyon card at all', () => {
  const r = N.pick({ now: Date.parse(CLOSES) + 1, tc: tc({ signedUp: false, squad: null, slot: null, battleAt: null }), events: [] });
  assert.equal(r, null);
});

test('signed up, squads not set yet: says so and counts to the close', () => {
  const r = N.pick({ now: Date.parse(CLOSES) - 2 * D, tc: tc({ squad: null, slot: null, battleAt: null }), events: [] });
  assert.deepEqual([r.kind, r.target, r.link], ['tc-pending', Date.parse(CLOSES), '/titan']);
});

test('a Titan Canyon week more than 7 days out is not this week', () => {
  const r = N.pick({ now: SAT - 8 * D, tc: tc({ signedUp: false, squad: null, slot: null, battleAt: null, closesAt: new Date(SAT - D).toISOString() }), events: [] });
  assert.equal(r, null);
});

test('no Titan Canyon card: the slim strip for an event in the next 24 hours, else nothing', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const events = [
    { title: 'Later thing', start: now + 30 * H },
    { title: 'Soon thing', start: now + 3 * H },
    { title: 'Already started', start: now - H },
  ];
  const r = N.pick({ now, tc: null, events });
  assert.deepEqual([r.kind, r.title, r.target], ['strip', 'Soon thing', now + 3 * H]);
  assert.equal(N.pick({ now, tc: null, events: [{ title: 'x', start: now + 24 * H + 1 }] }), null);
  assert.equal(N.pick({ now, tc: null, events: [{ title: 'x', start: now + 24 * H }] }).kind, 'strip');
  assert.equal(N.pick({ now, tc: null, events: [] }), null);
});

test('bad input never throws', () => {
  for (const tcIn of [null, undefined, {}, { ok: false }, { week: 'nope' }, tc({ battleAt: 'soon' })]) {
    N.pick({ now: SAT - D, tc: tcIn, events: null });
  }
  assert.equal(N.pick({}), null);
  assert.equal(N.pick({ now: SAT, tc: null, events: [{ title: 'no start' }, null, 'x'] }), null);
});

test('countdown parts and short wording', () => {
  assert.deepEqual(N.parts(D + 4 * H + 12 * 60e3 + 30e3), { d: 1, h: 4, m: 12, s: 30 });
  assert.deepEqual(N.parts(-5), { d: 0, h: 0, m: 0, s: 0 });
  assert.equal(N.short(2 * D + 4 * H), 'in 2d 4h');
  assert.equal(N.short(3 * H + 12 * 60e3), 'in 3h 12m');
  assert.equal(N.short(45 * 60e3), 'in 45m');
  assert.equal(N.short(20e3), 'starting now');
  assert.equal(N.resetLabel('+2'), 'reset +2');
  assert.equal(N.resetLabel('-6'), 'reset -6');
  assert.equal(N.resetLabel('0'), 'reset +0');
});
