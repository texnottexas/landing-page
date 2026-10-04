// A stand-in tool: a fixed full-screen panel at the top layer, closed by its own button.
(function () {
  var ov = document.createElement('div');
  ov.id = 'fake-alpha';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#123;color:#fff;padding:40px;font:16px sans-serif';
  ov.textContent = 'Alpha tool screen ';
  var b = document.createElement('button');
  b.id = 'fake-alpha-close'; b.textContent = 'Close alpha';
  b.onclick = function () { ov.remove(); };
  ov.appendChild(b);
  document.body.appendChild(ov);
  window.__alphaRuns = (window.__alphaRuns || 0) + 1;
})();
