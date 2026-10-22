(function () {
  function ic(n, s) { return '<svg class="ld-icon" width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  var VIEWS = ['home', 'how-it-works', 'pricing', 'pros', 'about', 'contact'];
  var views = document.querySelectorAll('[data-view]');
  function closeMenus() {
    document.querySelectorAll('.s-mbtn[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); var p = document.getElementById(b.getAttribute('aria-controls')); if (p) p.hidden = true; });
  }
  function show(v, scrollTo) {
    if (!v) v = 'home';
    var name = VIEWS.indexOf(v) >= 0 ? v : 'notfound';
    views.forEach(function (el) { el.hidden = el.getAttribute('data-view') !== name; });
    document.getElementById('ctaWrap').hidden = name === 'notfound' || name === 'contact';
    document.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('is-current', a.getAttribute('data-nav') === name); if (a.getAttribute('data-nav') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    closeMenus(); drawer(false);
    var titles = { home: 'listd · Property services, on record', 'how-it-works': 'How it works · listd', pricing: 'Pricing · listd', pros: 'For Pros · listd', about: 'About · listd', contact: 'Contact · listd', notfound: 'Page not found · listd' };
    if (scrollTo) { var t = document.getElementById(scrollTo); if (t) { setTimeout(function () { t.scrollIntoView({ block: 'start' }); }, 0); return; } }
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go],[data-scroll]');
    if (!a) return;
    var go = a.getAttribute('data-go'), sc = a.getAttribute('data-scroll');
    e.preventDefault();
    if (go) { try { history.replaceState(null, '', '#' + go); } catch (_) {} show(go, sc); }
    else if (sc) { var t = document.getElementById(sc); if (t) t.scrollIntoView({ block: 'start' }); }
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });

  // mega menus
  document.querySelectorAll('.s-mbtn[aria-controls]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = b.getAttribute('aria-expanded') === 'true';
      closeMenus();
      if (!open) { b.setAttribute('aria-expanded', 'true'); document.getElementById(b.getAttribute('aria-controls')).hidden = false; }
    });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.s-mi')) closeMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var o = document.querySelector('.s-mbtn[aria-expanded="true"]'); closeMenus(); if (o) o.focus(); drawer(false); } });

  // drawer
  var burger = document.getElementById('burger'), dr = document.getElementById('drawer');
  function drawer(open) { dr.hidden = !open; burger.setAttribute('aria-expanded', open ? 'true' : 'false'); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); }
  burger.addEventListener('click', function () { drawer(dr.hidden); });

  // accordions
  document.querySelectorAll('[data-acc]').forEach(function (acc) {
    acc.querySelectorAll(':scope > div > button').forEach(function (btn) {
      var body = btn.nextElementSibling, id = 'acc-' + Math.random().toString(36).slice(2, 8);
      body.id = id; btn.setAttribute('aria-controls', id);
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        acc.querySelectorAll(':scope > div > button').forEach(function (o) { o.setAttribute('aria-expanded', 'false'); o.nextElementSibling.hidden = true; });
        if (!open) { btn.setAttribute('aria-expanded', 'true'); body.hidden = false; }
      });
    });
  });

  // hero service preview
  var SVC = {
    'inventory': { k: 'inventory', label: 'Inventory', icon: 'inventory', title: 'A full schedule of condition, before anyone moves in', points: ['Room-by-room checklist with condition ratings', 'Timestamped photos of every item', 'Digital sign-off both parties trust'], addr: 'Flat 3, 22 Pulteney St, Bath BA2', date: '21 Oct 2026, 09:00', tier: 'priority', status: ['Awaiting sign-off', 'awaiting'], steps: ['done', 'done', 'done', 'current'], pro: ['PS', 'Priya S.', 5, 'Expert'], btn: 'Review report' },
    'check-in': { k: 'checkin', label: 'Check-In', icon: 'check-in', title: 'Move-in day, documented and signed', points: ['Document the property as the tenant arrives', 'Meter readings with photo evidence', 'Tenant signs off on any device'], addr: '9 Gloucester Rd, Bristol BS7', date: '27 Oct 2026, 11:30', tier: 'flex', status: ['Accepted', 'accepted'], steps: ['done', 'done', 'todo', 'todo'], pro: ['JM', 'Jordan M.', 2, 'Junior'], btn: 'Add access notes' },
    'check-out': { k: 'checkout', label: 'Check-Out', icon: 'check-out', title: 'Fair deposit decisions, backed by evidence', points: ['Compared item by item against the inventory', 'Damage marked with scale references', 'Escrow releases when you approve'], addr: '14 Clifton Road, Bristol BS8', date: '24 Oct 2026, 10:00', tier: 'core', status: ['In progress', 'progress'], steps: ['done', 'done', 'current', 'todo'], pro: ['SR', 'Sam R.', 3, 'Standard'], btn: 'Track job' },
    'mid-term': { k: 'midterm', label: 'Mid-Term Inspection', icon: 'inspection', title: 'Catch issues early, with a clear record', points: ['Periodic checks during the tenancy', 'Maintenance issues flagged with photos', 'Shared report for landlord and agent'], addr: '5 Old Market, Swindon SN1', date: '3 Nov 2026, 14:00', tier: 'flex', status: ['Booked', 'booked'], steps: ['done', 'todo', 'todo', 'todo'], pro: null, btn: 'Edit booking' },
    'cleaning': { k: 'cleaning', label: 'Cleaning', icon: 'cleaning', title: 'Between-tenancy cleans, priced by property size', points: ['Light, General or Deep clean', 'Room-by-room checklist for the cleaner', 'Before and after photos on every job'], addr: '41 Redland Grove, Bristol BS6', date: '25 Oct 2026, 08:30', tier: null, clean: 'Deep clean', status: ['Signed off', 'signed'], steps: ['done', 'done', 'done', 'done'], pro: ['AK', 'Amara K.', 4, 'Senior'], btn: 'View photos' }
  };
  var LBL = ['Booked', 'Accepted', 'In progress', 'Delivered'];
  function heroCard(key) {
    var s = SVC[key], v = 'var(--service-' + s.k + ')';
    var tier = s.tier ? '<span class="ld-tier ld-tier-' + s.tier + '">' + s.tier.charAt(0).toUpperCase() + s.tier.slice(1) + '</span>' : '<span class="ld-badge">' + s.clean + '</span>';
    var lv = ''; if (s.pro) { for (var i = 1; i <= 5; i++) lv += '<i class="' + (i <= s.pro[2] ? 'on' : '') + '"></i>'; }
    var rail = s.steps.map(function (st, i) { return '<li class="' + st + '"' + (st === 'current' ? ' aria-current="step"' : '') + '><i aria-hidden="true"></i><b>' + LBL[i] + '</b></li>'; }).join('');
    var pro = s.pro ? '<div class="ld-job-pro"><span class="ld-avatar ld-avatar-sm"><span role="img" aria-label="' + s.pro[1] + '">' + s.pro[0] + '</span><span class="v" title="Verified Pro">' + ic('check', 10) + '</span></span><span><b>' + s.pro[1] + '</b><span class="ld-level"><span aria-hidden="true">' + lv + '</span>Level ' + s.pro[2] + ' · ' + s.pro[3] + '</span></span></div>' : '<span class="s-fine">Notifying verified Pros nearby</span>';
    return '<div class="copy"><span class="ld-tag" style="--t:var(--service-' + s.k + '-subtle);--tx:var(--service-' + s.k + '-text);justify-self:start">' + ic(s.icon, 16) + s.label + '</span><h3>' + s.title + '</h3><ul>' + s.points.map(function (p) { return '<li>' + ic('check', 16) + '<span>' + p + '</span></li>'; }).join('') + '</ul></div>' +
      '<article class="ld-card ld-job" style="--c:' + v + '"><div class="ld-job-top"><span class="ld-tag" style="--t:var(--service-' + s.k + '-subtle);--tx:var(--service-' + s.k + '-text)">' + ic(s.icon, 16) + s.label + '</span><span class="ld-pill" style="--c:var(--status-' + s.status[1] + ')"><i aria-hidden="true"></i>' + s.status[0] + '</span></div>' +
      '<h3>' + s.addr + '</h3><div class="ld-job-meta"><span>' + ic('calendar', 16) + s.date + '</span>' + tier + '</div><ol class="ld-rail" style="--n:4" aria-label="Job progress">' + rail + '</ol>' +
      '<div class="ld-card-foot">' + pro + '<span class="ld-btn ld-btn-secondary ld-btn-sm">' + s.btn + '</span></div></article>';
  }
  var card = document.getElementById('heroCard');
  var tabs = document.querySelectorAll('.s-tabbtn');
  function pick(key) { tabs.forEach(function (t) { var on = t.getAttribute('data-svc') === key; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; }); card.innerHTML = heroCard(key); }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { pick(t.getAttribute('data-svc')); });
    t.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; var n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); n.click(); });
  });
  pick('check-out');

  // toast + copy
  var toast = document.getElementById('toast'), tt = document.getElementById('toastT'), th;
  function say(m) { tt.textContent = m; toast.hidden = false; clearTimeout(th); th = setTimeout(function () { toast.hidden = true; }, 2600); }
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.getElementById(b.getAttribute('data-copy')), txt = el.textContent;
      function sel() { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); say('Selected. Press Ctrl+C to copy'); }
      try { navigator.clipboard.writeText(txt).then(function () { say('Copied ' + txt); }, sel); } catch (_) { sel(); }
    });
  });

  // contact form
  var f = document.getElementById('contactForm'), note = document.getElementById('formNote');
  function setErr(id, msg) {
    var inp = document.getElementById(id), ctl = inp.closest('.ld-control'), fld = inp.closest('.ld-field'), old = fld.querySelector('.ld-error');
    if (old) old.remove();
    ctl.classList.toggle('is-invalid', !!msg); inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) { var s = document.createElement('span'); s.className = 'ld-error'; s.id = id + '-err'; s.innerHTML = ic('error', 16) + msg; fld.appendChild(s); inp.setAttribute('aria-describedby', s.id); } else inp.removeAttribute('aria-describedby');
    return !msg;
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = setErr('cf-name', document.getElementById('cf-name').value.trim() ? '' : 'Enter your name');
    var em = document.getElementById('cf-email').value.trim();
    ok = setErr('cf-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? '' : 'Enter an email address, like name@agency.co.uk') && ok;
    ok = setErr('cf-msg', document.getElementById('cf-msg').value.trim() ? '' : 'Tell us how we can help') && ok;
    if (!ok) { var first = f.querySelector('[aria-invalid="true"]'); if (first) first.focus(); return; }
    note.hidden = false;
    note.innerHTML = '<div class="ld-alert ld-alert-info" role="status">' + ic('info', 20) + '<div><b>Message ready</b><p>This preview site doesn’t send messages yet. Email support@listd.co.uk and we’ll reply within 24–48 hours.</p></div><span></span></div>';
  });

  show(location.hash.slice(1) || 'home');
})();

