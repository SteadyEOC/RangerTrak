// SPDX-License-Identifier: AGPL-3.0-or-later
// The /board/ page's checklist and computer picker. A file of its own: the site's CSP allows no inline script.
(function () {
  var KEY = 'rtBoardGuide';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* not kept: fine */ } }

  // Which computer's steps to show: the visitor's own, unless they picked another.
  var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
  var guess = /mac/i.test(ua) ? 'mac' : /linux|x11|cros/i.test(ua) && !/android/i.test(ua) ? 'linux' : 'windows';
  function setOs(os) {
    document.body.className = 'os-' + os;
    document.querySelectorAll('[data-pick]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.pick === os)); });
  }
  setOs(saved.os || guess);
  document.querySelectorAll('[data-pick]').forEach(function (b) {
    b.addEventListener('click', function () { saved.os = b.dataset.pick; save(); setOs(b.dataset.pick); });
  });

  var steps = Array.prototype.slice.call(document.querySelectorAll('details.step'));
  var done = saved.done || {};
  function update() {
    var n = steps.filter(function (s) { return done[s.dataset.step]; }).length;
    document.getElementById('barFill').style.width = (100 * n / steps.length) + '%';
    document.querySelector('.bar').setAttribute('aria-valuenow', String(n));
    document.getElementById('gaugeText').textContent = n === steps.length ? 'Ready' : n + ' of ' + steps.length + ' done';
    document.getElementById('gauge').classList.toggle('done', n === steps.length);
  }
  steps.forEach(function (s, i) {
    var box = s.querySelector('.tick');
    box.checked = !!done[s.dataset.step];
    s.classList.toggle('checked', box.checked);
    // A tick in the summary must not also open or close the step.
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    box.addEventListener('change', function () {
      done[s.dataset.step] = box.checked; saved.done = done; save();
      s.classList.toggle('checked', box.checked);
      if (box.checked) { s.open = false; var next = steps[i + 1]; if (next && !done[next.dataset.step]) next.open = true; }
      update();
    });
  });
  // Open the first step not yet done, so the page starts where the reader left off.
  var first = steps.filter(function (s) { return !done[s.dataset.step]; })[0];
  if (first) first.open = true;
  update();
})();
