// rickroll-audio.js: the Ops Center "Rickroll" tile (Tex, 2026-10-09). Plays the site's rickroll clip as sound in
// the game tab, on repeat until Stop: no new tab. "Video" folds the clip open in the card (same playback, no restart). The game's own sound is paused while the song plays
// and resumed when it stops. The clip is the one passwords.html uses (texnottexas/rickroll@v2 on jsDelivr).
(function () {
  'use strict';
  var SRC = window.__RR_SRC || 'https://cdn.jsdelivr.net/gh/texnottexas/rickroll@v2/rickandroll.mp4';
  var T = { surface: '#161b22', card: '#1c2128', border: '#30363d', text: '#e6edf3', muted: '#8b949e', accent: '#79c0ff', green: '#238636', red: '#f85149' };

  // Already playing: bring the card forward instead of starting a second song.
  if (window.__RR && document.getElementById('rr-root')) { window.__RR.flash(); return; }

  var S = { audio: null, root: null, gamePaused: false, playing: false };

  function engine() { try { return window.cc && window.cc.audioEngine; } catch (e) { return null; } }
  // pauseAll() pauses only what is playing and resumeAll() resumes only what it paused.
  function pauseGame() {
    var a = engine();
    if (S.gamePaused || !a || typeof a.pauseAll !== 'function') return;
    try { a.pauseAll(); S.gamePaused = true; } catch (e) {}
  }
  function resumeGame() {
    var a = engine();
    if (S.gamePaused && a && typeof a.resumeAll === 'function') { try { a.resumeAll(); } catch (e) {} }
    S.gamePaused = false;
  }

  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  var BTN = 'min-height:44px;padding:0 16px;border-radius:8px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;';
  var SMALL = 'min(340px,calc(100vw - 24px))', WIDE = 'min(560px,calc(100vw - 24px))';
  var root = el('div', 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;width:' + SMALL + ';' +
    'box-sizing:border-box;padding:12px 14px;background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:12px;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.5);color:' + T.text + ';font:14px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:10px;transition:box-shadow .2s');
  var row = el('div', 'display:flex;align-items:center;gap:12px');
  root.id = 'rr-root';
  var NS = 'http://www.w3.org/2000/svg', ico = document.createElementNS(NS, 'svg');
  ico.setAttribute('viewBox', '0 0 24 24'); ico.setAttribute('width', '22'); ico.setAttribute('height', '22'); ico.setAttribute('aria-hidden', 'true');
  ico.setAttribute('fill', 'none'); ico.setAttribute('stroke', T.accent); ico.setAttribute('stroke-width', '2');
  ico.setAttribute('stroke-linecap', 'round'); ico.setAttribute('stroke-linejoin', 'round');
  [['path', { d: 'M9 18V5l12-2v13' }], ['circle', { cx: 6, cy: 18, r: 3 }], ['circle', { cx: 18, cy: 16, r: 3 }]].forEach(function (s) {
    var n = document.createElementNS(NS, s[0]);
    Object.keys(s[1]).forEach(function (k) { n.setAttribute(k, String(s[1][k])); });
    ico.appendChild(n);
  });
  var words = el('div', 'flex:1;min-width:0');
  var title = el('div', 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', 'Never Gonna Give You Up');
  var sub = el('div', 'color:' + T.muted + ';font-size:12px', 'Loading...');
  sub.setAttribute('role', 'status'); sub.setAttribute('aria-live', 'polite');
  words.appendChild(title); words.appendChild(sub);
  var play = el('button', BTN + 'background:' + T.green + ';color:#fff;border:none;display:none', 'Play');
  play.id = 'rr-play'; play.type = 'button';
  var stopBtn = el('button', BTN + 'background:transparent;color:' + T.text + ';border:1px solid ' + T.border, 'Stop');
  stopBtn.id = 'rr-stop'; stopBtn.type = 'button';
  function svg(paths, size) {
    var n = document.createElementNS(NS, 'svg');
    n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('width', String(size)); n.setAttribute('height', String(size)); n.setAttribute('aria-hidden', 'true');
    n.setAttribute('fill', 'none'); n.setAttribute('stroke', 'currentColor'); n.setAttribute('stroke-width', '2'); n.setAttribute('stroke-linecap', 'round'); n.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { var x = document.createElementNS(NS, 'path'); x.setAttribute('d', d); n.appendChild(x); });
    return n;
  }
  // Minimize: the card shrinks to a small pill so players can keep the song on while they play (Tex).
  var minBtn = el('button', 'width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:8px;cursor:pointer;background:transparent;color:' + T.muted + ';border:1px solid ' + T.border);
  minBtn.id = 'rr-min'; minBtn.type = 'button'; minBtn.setAttribute('aria-label', 'Minimize'); minBtn.title = 'Minimize';
  minBtn.appendChild(svg(['M6 15l6-6 6 6'], 18));
  row.appendChild(ico); row.appendChild(words); row.appendChild(play); row.appendChild(minBtn); row.appendChild(stopBtn);
  var pill = el('button', 'display:none;min-height:44px;padding:0 14px;align-items:center;gap:8px;border-radius:22px;cursor:pointer;background:transparent;border:none;color:' + T.text + ';font:600 13px/1 system-ui,sans-serif');
  pill.id = 'rr-pill'; pill.type = 'button'; pill.setAttribute('aria-label', 'Show the player');
  var pillIco = svg(['M9 18V5l12-2v13', 'M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6', 'M18 13a3 3 0 1 0 0 6a3 3 0 1 0 0-6'], 18); pillIco.style.color = T.accent;
  pill.appendChild(pillIco); pill.appendChild(el('span', null, 'Now playing')); pill.appendChild(svg(['M6 9l6 6 6-6'], 16));
  // The clip itself, folded away until Video: the same element plays the song either way.
  var media = el('div', 'height:0;overflow:hidden;border-radius:8px;background:#000');
  media.id = 'rr-media';
  var videoBtn = el('button', 'align-self:flex-end;min-height:36px;padding:0 12px;border-radius:8px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;' +
    'background:transparent;color:' + T.accent + ';border:1px solid ' + T.border, 'Video');
  videoBtn.id = 'rr-video'; videoBtn.type = 'button';
  root.appendChild(row); root.appendChild(media); root.appendChild(videoBtn); root.appendChild(pill);
  document.body.appendChild(root);
  S.root = root;

  function stop() {
    if (S.audio) { try { S.audio.pause(); S.audio.removeAttribute('src'); S.audio.load(); } catch (e) {} }
    S.playing = false;
    resumeGame();
    if (S.root) { S.root.remove(); S.root = null; }
    window.removeEventListener('pagehide', stop);
    window.__RR = null;
  }
  function start() {
    var p;
    try { p = S.audio.play(); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function () {
      if (!S.root) { try { S.audio.pause(); } catch (e) {} return; }   // stopped while it was starting
      S.playing = true; pauseGame();
      sub.textContent = 'Rick Astley'; play.style.display = 'none'; stopBtn.textContent = 'Stop';
    }, function (e) {
      if (!S.root) return;
      if (e && e.name === 'NotAllowedError') { sub.textContent = 'Tap Play to start.'; play.style.display = ''; return; }
      failed();
    });
  }
  function failed() {
    S.playing = false; resumeGame();
    sub.textContent = "Couldn't load the song. Check your connection."; sub.style.color = T.red;
    play.style.display = 'none'; stopBtn.textContent = 'Close';
  }

  S.audio = document.createElement('video');                // a video element plays the sound the same as an audio one
  S.audio.playsInline = true; S.audio.setAttribute('playsinline', ''); S.audio.setAttribute('webkit-playsinline', '');
  S.audio.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#000';
  media.appendChild(S.audio);
  S.audio.loop = true;
  S.audio.preload = 'auto';
  S.audio.addEventListener('error', function () { if (S.root) failed(); });
  S.audio.src = SRC;
  play.onclick = function () { play.style.display = 'none'; sub.textContent = 'Loading...'; start(); };
  stopBtn.onclick = stop;
  function showVideo(open) {
    media.style.height = open ? 'auto' : '0'; media.style.aspectRatio = open ? '16 / 9' : '';
    root.style.width = open ? WIDE : SMALL; videoBtn.textContent = open ? 'Hide video' : 'Video';
  }
  videoBtn.onclick = function () { showVideo(media.style.height === '0px' || media.style.height === '0'); };
  function minimize(min) {
    if (min) showVideo(false);
    row.style.display = min ? 'none' : 'flex'; videoBtn.style.display = min ? 'none' : '';
    pill.style.display = min ? 'inline-flex' : 'none';
    root.style.width = min ? 'auto' : SMALL; root.style.padding = min ? '0' : '12px 14px'; root.style.borderRadius = min ? '22px' : '12px';
    // the folded video stays in the page (some browsers pause a hidden video) but takes no room
    media.style.width = min ? '0' : ''; root.style.gap = min ? '0' : '10px';
  }
  minBtn.onclick = function () { minimize(true); };
  pill.onclick = function () { minimize(false); };
  window.addEventListener('pagehide', stop);

  window.__RR = {
    audio: S.audio,
    stop: stop,
    flash: function () { if (!S.root) return; S.root.style.boxShadow = '0 0 0 2px ' + T.accent + ',0 8px 28px rgba(0,0,0,.5)'; setTimeout(function () { if (S.root) S.root.style.boxShadow = '0 8px 28px rgba(0,0,0,.5)'; }, 600); },
    state: function () { return { playing: S.playing, loop: S.audio.loop, src: S.audio.currentSrc || S.audio.src, gamePaused: S.gamePaused }; }
  };
  start();
})();
