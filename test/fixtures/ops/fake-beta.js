// A stand-in tool whose screen is not fixed or layered: only its declared overlay id gives it away.
(function () {
  var ov = document.createElement('div');
  ov.id = 'fake-beta';
  ov.textContent = 'Beta tool screen';
  document.body.appendChild(ov);
})();
