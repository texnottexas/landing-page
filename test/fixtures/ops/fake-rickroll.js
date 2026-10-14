// A stand-in for rickroll-audio.js in the fake game: its card and window.__RR, no sound. Counts its loads.
(function () {
  window.__rrLoads = (window.__rrLoads || 0) + 1;
  window.__rrSrc = (document.currentScript && document.currentScript.src) || '';
  if (window.__RR && document.getElementById('rr-root')) { window.__RR.flash(); return; }
  var r = document.createElement('div'); r.id = 'rr-root';
  r.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483000;width:340px;height:90px;background:#123;color:#fff';
  var b = document.createElement('button'); b.id = 'rr-stop'; b.textContent = 'Stop'; r.appendChild(b);
  document.body.appendChild(r);
  function stop() { r.remove(); window.__RR = null; }
  b.onclick = stop;
  window.__RR = { stop: stop, flash: function () { window.__rrFlashes = (window.__rrFlashes || 0) + 1; } };
})();
