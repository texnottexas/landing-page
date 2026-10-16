// A stand-in group tool: a small fixed card, closed by its own button.
(function () {
  if (document.getElementById('fake-ga')) return;
  var c = document.createElement('div'); c.id = 'fake-ga';
  c.style.cssText = 'position:fixed;left:8px;top:84px;width:190px;height:120px;z-index:2147483000;background:#123;color:#fff';
  var b = document.createElement('button'); b.id = 'fake-ga-close'; b.textContent = 'Close A'; b.onclick = function () { c.remove(); };
  c.appendChild(b); document.body.appendChild(c);
  window.__gaRuns = (window.__gaRuns || 0) + 1;
})();
