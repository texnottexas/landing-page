// A stand-in tool whose screen appears two seconds after it loads (still "starting" until then).
(function () {
  setTimeout(function () {
    var ov = document.createElement('div');
    ov.id = 'fake-late';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#231;color:#fff;padding:40px;font:16px sans-serif';
    ov.textContent = 'Late tool screen';
    document.body.appendChild(ov);
  }, 2000);
})();
