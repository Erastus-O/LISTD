(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  if (!reduce) root.classList.add('m-on');

  // scroll progress + header state
  var bar = document.createElement('div'); bar.className = 'm-scrollbar'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
  var hdr = document.querySelector('.s-hdr'), ticking = false;
  function onScroll() {
    ticking = false;
    var h = document.documentElement.scrollHeight - innerHeight, p = h > 0 ? scrollY / h : 0;
    bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, p)) + ')';
    if (hdr) hdr.classList.toggle('is-scrolled', scrollY > 8);
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // scroll reveal (always ends visible: a safety timer reveals anything still waiting)
  var SEL = '.s-head, .s-life > div, .s-split > *, .s-svcard, .s-fact, .s-tier, .s-step, .s-value, .s-trustlist li, .s-clean, .s-ccard, .s-levels .s-lv, .s-faq, .s-cta, .ld-tablewrap, .s-form, .s-phone, .s-backed .s-in > *';
  var io = null;
  function mark(scope) {
    if (reduce) return;
    var els = (scope || document).querySelectorAll(SEL);
    els.forEach(function (el) {
      if (el.classList.contains('m-rv')) return;
      var sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.setProperty('--m-d', Math.min(sib, 6) * 0.07 + 's');
      el.classList.add('m-rv');
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.95 && r.bottom > 0) el.classList.add('m-in');
      else if (io) io.observe(el); else el.classList.add('m-in');
    });
  }
  if ('IntersectionObserver' in window) io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('m-in'); io.unobserve(e.target); countUp(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  mark();
  setTimeout(function () { document.querySelectorAll('.m-rv:not(.m-in)').forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < innerHeight) el.classList.add('m-in'); }); }, 1600);

  // count-up on fact numbers
  function countUp(el) {
    var v = el.querySelector && el.querySelector('.s-fact .v, .v'); if (!el.classList.contains('s-fact') || !v || v.dataset.done || reduce) return;
    v.dataset.done = '1';
    var txt = v.textContent, nums = txt.match(/\d+/g); if (!nums) return;
    var t0 = performance.now(), dur = 1100;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), i = 0;
      v.textContent = txt.replace(/\d+/g, function (n) { return Math.round(+nums[i++] * e); });
      if (k < 1) requestAnimationFrame(step); else v.textContent = txt;
    })(t0);
  }
  document.querySelectorAll('.s-fact.m-in').forEach(countUp);

  // page (view) transitions + re-reveal
  document.querySelectorAll('[data-view]').forEach(function (v) {
    new MutationObserver(function () {
      if (!v.hidden) { v.classList.remove('m-enter'); void v.offsetWidth; v.classList.add('m-enter'); setTimeout(function () { mark(v); v.querySelectorAll('.m-rv:not(.m-in)').forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < innerHeight) el.classList.add('m-in'); }); }, 30); }
    }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
  });

  // smooth accordions
  document.querySelectorAll('.s-acc-body').forEach(function (b) {
    new MutationObserver(function () {
      if (b.hidden || reduce || !b.animate) return;
      var hgt = b.scrollHeight;
      b.animate([{ height: '0px', opacity: 0 }, { height: hgt + 'px', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }).observe(b, { attributes: true, attributeFilter: ['hidden'] });
  });

  // hero service tabs: animated swap + auto-rotate until the visitor takes over
  var card = document.getElementById('heroCard'), tabs = Array.prototype.slice.call(document.querySelectorAll('.s-tabbtn'));
  if (card) new MutationObserver(function () { card.classList.remove('m-swap'); void card.offsetWidth; card.classList.add('m-swap'); }).observe(card, { childList: true });
  var auto = !reduce, timer = null, DUR = 5200, panel = document.querySelector('.s-panel'), paused = false;
  function cur() { for (var i = 0; i < tabs.length; i++) if (tabs[i].getAttribute('aria-selected') === 'true') return i; return 0; }
  function arm() {
    tabs.forEach(function (t) { t.classList.remove('is-auto'); });
    clearTimeout(timer); if (!auto || paused) return;
    var t = tabs[cur()]; t.style.setProperty('--m-dur', DUR + 'ms'); void t.offsetWidth; t.classList.add('is-auto');
    timer = setTimeout(function () { var n = tabs[(cur() + 1) % tabs.length]; n.dispatchEvent(new MouseEvent('click', { bubbles: true })); arm(); }, DUR);
  }
  function stopAuto(e) { if (e && e.isTrusted === false) return; auto = false; arm(); }
  tabs.forEach(function (t) { t.addEventListener('click', function (e) { if (e.isTrusted) stopAuto(e); }); t.addEventListener('keydown', stopAuto); });
  if (panel) {
    panel.addEventListener('pointerenter', function () { paused = true; arm(); });
    panel.addEventListener('pointerleave', function () { paused = false; arm(); });
  }
  arm();

  // lifecycle stages: highlight cycles through Book, Matched, Track, Deliver; click to choose
  var life = Array.prototype.slice.call(document.querySelectorAll('.s-life > div')), lifeTimer = null, li = 2;
  function lifeSet(i) { life.forEach(function (d, k) { d.classList.toggle('hot', k === i); }); li = i; }
  if (life.length) {
    life.forEach(function (d, k) { d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Highlight stage ' + (k + 1));
      d.addEventListener('click', function () { clearInterval(lifeTimer); lifeSet(k); });
      d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearInterval(lifeTimer); lifeSet(k); } }); });
    if (!reduce) lifeTimer = setInterval(function () { lifeSet((li + 1) % life.length); }, 2600);
  }

  // gentle 3D tilt on hero card and photos (fine pointers only)
  if (!reduce && matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.s-panel-card, .s-evimg img, .s-proimg > img, .s-phone').forEach(function (el) {
      el.classList.add('m-tilt');
      var host = el.parentElement;
      host.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        el.style.transform = 'perspective(1000px) rotateX(' + (-y * 4).toFixed(2) + 'deg) rotateY(' + (x * 5).toFixed(2) + 'deg)';
      });
      host.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
    document.querySelectorAll('.s-band, .s-cta').forEach(function (el) {
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    });
  }

  // Pro level estimator on the For Pros page (real thresholds)
  var LV = [[0, 5, 'L1', 'Trainee', 'Flex tier only, supervised jobs'], [6, 20, 'L2', 'Junior', 'Flex and Core tiers'], [21, 50, 'L3', 'Standard', 'All tiers, independent work'], [51, 100, 'L4', 'Senior', 'Priority jobs, mentoring access'], [101, 9999, 'L5', 'Expert', 'All tiers, tribunal-grade reports']];
  var prosBand = document.querySelector('[data-view="pros"] .s-band .s-in > div:first-child');
  if (prosBand) {
    var w = document.createElement('div'); w.className = 'm-est';
    w.innerHTML = '<label for="m-jobs">Jobs completed on LISTD <output id="m-jobs-out" for="m-jobs">24 jobs</output></label><input id="m-jobs" type="range" min="0" max="120" step="1" value="24" aria-describedby="m-jobs-res"><div class="res" id="m-jobs-res" aria-live="polite"><b></b><span></span></div>';
    prosBand.appendChild(w);
    var inp = w.querySelector('input'), out = w.querySelector('output'), rb = w.querySelector('.res b'), rs = w.querySelector('.res span');
    var rows = document.querySelectorAll('[data-view="pros"] .s-levels .s-lv');
    function upd() {
      var n = +inp.value, idx = 0; for (var i = 0; i < LV.length; i++) if (n >= LV[i][0] && n <= LV[i][1]) idx = i;
      out.textContent = n + (n === 120 ? '+' : '') + (n === 1 ? ' job' : ' jobs');
      rb.textContent = LV[idx][2]; rs.innerHTML = LV[idx][3] + '<small>' + LV[idx][4] + '</small>';
      rows.forEach(function (r, k) { r.classList.toggle('m-on-level', k === idx); });
    }
    inp.addEventListener('input', upd); upd();
  }
})();
