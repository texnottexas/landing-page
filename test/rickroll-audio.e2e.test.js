'use strict';
// Ops Center "Rickroll" (Tex, 2026-10-09): plays the site's rickroll clip as sound in the game tab, on repeat until
// Stop, and pauses the game's own sound while it plays. Fake game page (a stand-in cc.audioEngine) and a 1 s
// silent clip; no game, no network.
// Run: NODE_PATH="$(npm root -g)/@playwright/cli/node_modules" node --test test/rickroll-audio.e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
// 1 s of 8 kHz mono 16-bit silence
function wav() {
  const n = 8000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#0d1117">
<script>
  // the game's sound engine, as far as the tool uses it: pauseAll() pauses what is playing, resumeAll() resumes it
  window.__game = { playing: true, pauses: 0, resumes: 0 };
  window.cc = { audioEngine: {
    pauseAll: function () { __game.pauses++; __game.playing = false; },
    resumeAll: function () { __game.resumes++; __game.playing = true; }
  } };
</script></body></html>`;

let server, base, browser;
test.before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.split('?')[0];
    if (name === '/rickroll-audio.js') { let js; try { js = fs.readFileSync(path.join(ROOT, 'rickroll-audio.js')); } catch (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(js); return; }
    if (name === '/clip.wav') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(wav()); return; }
    if (name === '/missing.wav') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => { await browser.close(); server.close(); });

async function open(o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base);
  await page.evaluate((x) => {
    window.__RR_SRC = location.origin + '/' + (x.src || 'clip.wav');
    if (x.refuseOnce) {   // the browser wants a tap first: the first play() is refused
      const real = HTMLMediaElement.prototype.play; let refused = false;
      HTMLMediaElement.prototype.play = function () { if (!refused) { refused = true; return Promise.reject(new DOMException('needs a tap', 'NotAllowedError')); } return real.call(this); };
    }
  }, o || {});
  return { ctx, page, errs };
}
const launch = (page) => page.addScriptTag({ url: base + 'rickroll-audio.js' });
const st = (page) => page.evaluate(() => ({ game: Object.assign({}, __game), rr: window.__RR ? window.__RR.state() : null, cards: document.querySelectorAll('#rr-root').length,
  audios: document.querySelectorAll('audio').length, text: (document.getElementById('rr-root') || {}).innerText || '' }));

test('launch: the song plays on repeat in this tab, the game\'s sound is paused, and a small card says what is playing', async () => {
  const { ctx, page, errs } = await open();
  await launch(page);
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing);
  const s = await st(page);
  assert.equal(s.rr.src, base + 'clip.wav');
  assert.equal(s.rr.loop, true, 'on repeat');
  assert.deepEqual(s.game, { playing: false, pauses: 1, resumes: 0 });
  assert.match(s.text, /Never Gonna Give You Up/);
  assert.match(s.text, /Stop/);
  assert.ok(!/—/.test(s.text), 'no em dash');
  const box = await page.$eval('#rr-root', (e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect();
    return { parentIsBody: e.parentNode === document.body, position: c.position, z: Number(c.zIndex), left: r.left, right: r.right, stop: document.getElementById('rr-stop').getBoundingClientRect().height }; });
  assert.ok(box.parentIsBody && box.position === 'fixed' && box.z >= 1000, 'an Ops overlay: direct child of body, fixed, z-index 1000+');
  assert.ok(box.left >= 0 && box.right <= 390, 'fits a phone');
  assert.ok(box.stop >= 44, 'Stop is a 44 px tap target');
  await page.waitForTimeout(1500);
  assert.equal((await st(page)).rr.playing, true, 'still playing after the 1 s clip ended once: it loops');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('Stop: the song stops, the card goes, and the game\'s sound comes back', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing);
  const audio = await page.evaluateHandle(() => window.__RR.audio);
  await page.click('#rr-stop');
  const s = await st(page);
  assert.equal(s.cards, 0);
  assert.equal(s.rr, null);
  assert.equal(await audio.evaluate((a) => a.paused), true);
  assert.deepEqual(s.game, { playing: true, pauses: 1, resumes: 1 });
  await ctx.close();
});

test('launching again while it plays brings the card forward instead of starting a second song', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing);
  await launch(page);
  await page.waitForTimeout(300);
  const s = await st(page);
  assert.equal(s.cards, 1);
  assert.equal(s.game.pauses, 1);
  assert.equal(await page.evaluate(() => [window.__RR.audio].length), 1);
  await ctx.close();
});

test('the browser wants a tap first: the card offers Play, the game keeps its sound until the song starts', async () => {
  const { ctx, page } = await open({ refuseOnce: true });
  await launch(page);
  await page.waitForSelector('#rr-play');
  let s = await st(page);
  assert.match(s.text, /Tap Play to start/);
  assert.deepEqual(s.game, { playing: true, pauses: 0, resumes: 0 });
  await page.click('#rr-play');
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing);
  s = await st(page);
  assert.deepEqual(s.game, { playing: false, pauses: 1, resumes: 0 });
  await ctx.close();
});

test('the clip cannot load: the card says so and offers Close; the game\'s sound was never paused', async () => {
  const { ctx, page } = await open({ src: 'missing.wav' });
  await launch(page);
  await page.waitForFunction(() => /Couldn't load the song/.test((document.getElementById('rr-root') || {}).innerText || ''));
  assert.deepEqual((await st(page)).game, { playing: true, pauses: 0, resumes: 0 });
  assert.ok((await page.$eval('#rr-media', (e) => e.getBoundingClientRect().height)) <= 1, 'no empty video box');
  assert.equal(await page.$eval('#rr-video', (e) => e.offsetParent), null, 'no Video button for a clip that will not load');
  await page.click('#rr-stop');
  assert.equal((await st(page)).cards, 0);
  await ctx.close();
});

test('the video shows by default (Tex); Hide video folds it away and Video brings it back, the song never restarting', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing);
  const media = await page.$eval('#rr-root video', (v) => ({ inline: v.playsInline, loop: v.loop }));
  assert.deepEqual(media, { inline: true, loop: true }, 'plays inside the card on phones, on repeat');
  const box = () => page.$eval('#rr-media', (e) => { const r = e.getBoundingClientRect(); return { h: r.height, left: r.left, right: r.right }; });
  const b = await box();
  assert.ok(b.h > 100, 'the video is on screen from the start');
  assert.ok(b.left >= 0 && b.right <= 390, 'fits a phone');
  assert.equal(await page.textContent('#rr-video'), 'Hide video');
  await page.waitForTimeout(400);
  const t0 = await page.evaluate(() => window.__RR.audio.currentTime);
  await page.click('#rr-video');
  await page.waitForFunction(() => document.getElementById('rr-media').getBoundingClientRect().height <= 1);
  assert.equal(await page.textContent('#rr-video'), 'Video');
  assert.ok(await page.evaluate((t) => window.__RR.audio.currentTime >= t && !window.__RR.audio.paused, t0), 'the same song kept playing');
  await page.click('#rr-video');
  await page.waitForFunction(() => document.getElementById('rr-media').getBoundingClientRect().height > 100);
  assert.equal(await page.textContent('#rr-video'), 'Hide video');
  assert.equal(await page.evaluate(() => window.__RR.state().playing), true);
  await ctx.close();
});

test('minimize: the card shrinks to a small pill and the song keeps going (video folded away); the pill brings it back', async () => {
  const { ctx, page } = await open();
  await launch(page);
  await page.waitForFunction(() => window.__RR && window.__RR.state().playing && document.getElementById('rr-media').getBoundingClientRect().height > 100);
  const big = await page.$eval('#rr-root', (e) => e.getBoundingClientRect().width);
  assert.ok((await page.$eval('#rr-min', (e) => e.getBoundingClientRect().height)) >= 44, 'Minimize is a 44 px tap target');
  await page.click('#rr-min');
  const small = await page.evaluate(() => {
    const r = document.getElementById('rr-root').getBoundingClientRect(), pill = document.getElementById('rr-pill');
    return { w: r.width, h: r.height, pill: !!pill && pill.offsetParent !== null, pillH: pill.getBoundingClientRect().height, text: document.getElementById('rr-root').innerText,
      stopShown: document.getElementById('rr-stop').offsetParent !== null, media: document.getElementById('rr-media').getBoundingClientRect().height, playing: window.__RR.state().playing };
  });
  assert.ok(small.pill && small.pillH >= 44, 'a 44 px pill');
  assert.ok(small.w < big / 2 && small.h <= 60, 'much smaller than the card: ' + JSON.stringify(small));
  assert.match(small.text, /Now playing/);
  assert.equal(small.stopShown, false);
  assert.ok(small.media <= 1, 'the video folded away');
  assert.equal(small.playing, true, 'the song keeps going');
  await page.click('#rr-pill');
  const back = await page.evaluate(() => ({ stop: document.getElementById('rr-stop').offsetParent !== null, pill: document.getElementById('rr-pill').offsetParent !== null, playing: window.__RR.state().playing,
    video: document.getElementById('rr-media').getBoundingClientRect().height > 100 }));
  assert.deepEqual(back, { stop: true, pill: false, playing: true, video: true }, 'back as it was, video showing');
  await page.click('#rr-stop');
  assert.equal(await page.$('#rr-root'), null);
  await ctx.close();
});
