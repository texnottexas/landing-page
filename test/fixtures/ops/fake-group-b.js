// A stand-in group tool: a small fixed card, closed by its own button.
(function () {
  if (document.getElementById('fake-gb')) return;
  var c = document.createElement('div'); c.id = 'fake-gb';
  c.style.cssText = 'position:fixed;left:220px;top:84px;width:190px;height:120px;z-index:2147483000;background:#123;color:#fff';
  var b = document.createElement('button'); b.id = 'fake-gb-close'; b.textContent = 'Close B'; b.onclick = function () { c.remove(); };
  c.appendChild(b); document.body.appendChild(c);
  window.__gbRuns = (window.__gbRuns || 0) + 1;
})();
