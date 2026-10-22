/* ===================== Shell, routing & events ===================== */
var HIST = [];
function go(view, params) { HIST.push([S.view, S.params]); if (HIST.length > 40) HIST.shift(); S.view = view; S.params = params || {}; S.filter = 'all'; S.modal = null; if (view !== 'requests') S.qIdx = null; render(); window.scrollTo(0, 0); }
function back() { var h = HIST.pop(); if (h) { S.view = h[0]; S.params = h[1]; } else { S.view = 'home'; S.params = {}; } S.modal = null; render(); window.scrollTo(0, 0); }

function accounts(role) { var col = role === 'pro' ? 'pros' : 'clients'; return list(col).filter(function (a) { return ENV.mode !== 'db' || ENV.canAdmin || a.ownerUid === ENV.uid; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }
/* Single-portal builds (client.html / pro.html / admin.html) set window.LISTD_PORTAL and hide the portal switcher. */
var PORTAL = window.LISTD_PORTAL || null;
function ensureAccount() {
  if (PORTAL) S.role = PORTAL;
  if (ENV.mode === 'connecting' || !ENV.ready) return;
  if (!AUTH.loaded) { if (!AUTH.loading) authLoad(); return; }
  syncSessions();
  if (S.role === 'admin' && !ENV.canAdmin && !PORTAL) S.role = 'client';
}
function topBar() {
  var roles = [['client', 'home', 'Client'], ['pro', 'verified-pro', 'Pro']]; if (ENV.canAdmin) roles.push(['admin', 'settings', 'Admin']);
  var who = S.role === 'client' && me() ? (me().orgName || me().name) : S.role === 'pro' && meP() ? (meP().name || meP().email) : S.role === 'admin' && S.adminOk ? ((myStaff() || {}).name || 'LISTD admin') : '';
  var unread = ENV.mode === 'connecting' || (S.role !== 'admin' && !who) ? 0 : myInbox().filter(function (n) { return !n.read; }).length;
  return '<header class="a-top"><div class="in"><span class="ld-logo" aria-label="listd">listd</span><span class="tag">' + ({ admin: 'Admin', pro: 'Pro', client: 'Client' })[S.role] + '</span>' + (PORTAL ? '<span style="margin-left:auto"></span>' : '<div class="a-roles" role="group" aria-label="Portal">' + roles.map(function (r) { return '<button type="button" data-act="role" data-r="' + r[0] + '" aria-pressed="' + (S.role === r[0]) + '">' + ic(r[1], 16) + '<span>' + r[2] + '</span></button>'; }).join('') + '</div>') + (who ? (S.role === 'admin' && !staffRole() ? '' : '<button type="button" class="a-bell" id="a-bell" data-act="notif" aria-haspopup="dialog" aria-controls="notif-panel" aria-expanded="' + !!S.notif + '" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '">' + ic('bell', 20) + (unread ? '<span>' + unread + '</span>' : '') + '</button><button type="button" class="a-who" data-go="settings" title="Settings">' + esc(who) + '</button>') + '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm a-signout" data-act="signout">Sign out</button>' : '') + '</div></header>' +
    '<div class="a-mode" role="note">' + (ENV.mode === 'connecting' ? 'Connecting…' : 'Test mode: payments, refunds and payouts are simulated. No real money moves.' + (ENV.mode === 'local' ? ' Data is saved in this browser only.' : '')) + '</div>';
}
function signedIn() { return S.role === 'admin' ? ENV.canAdmin && S.adminOk : S.role === 'pro' ? !!meP() : !!me(); }
function onboarded() { return S.role === 'admin' || (S.role === 'pro' ? proOnboarded() : clientOnboarded()); }
function navItems() { if (!signedIn() || !onboarded()) return []; return S.role === 'admin' ? adminNav().filter(function (n) { return viewAllowed(n[0]); }) : S.role === 'pro' ? proNav() : clientNav(); }
function badgeFor(v) {
  var n = 0;
  if (S.role === 'client' && v === 'jobs') n = myJobs().filter(clientNeeds).length;
  if (S.role === 'client' && v === 'invoices') n = invoices(S.clientId).filter(function (x) { return x.st === 'APPROVAL' || x.st === 'PAYMENT'; }).length;
  if (S.role === 'pro' && v === 'offers') n = myOffers().length;
  if (v === 'inbox') n = myInbox().filter(function (x) { return !x.read; }).length;
  if (S.role === 'admin') { if (v === 'pros') n = pendingApps().length; if (v === 'invoicing') n = toInvoice().length; if (v === 'reviews') n = list('jobs').filter(function (x) { return x.status === 'ADMIN_REVIEW'; }).length; if (v === 'disputes') n = list('jobs').filter(function (x) { return openDispute(x); }).length; if (v === 'assign') n = list('jobs').filter(function (x) { return x.status === 'READY_FOR_ASSIGNMENT' && !currentOffer(x); }).length; if (v === 'requests') n = list('jobs').filter(function (x) { return x.status === 'SUBMITTED'; }).length; }
  return n ? '<span class="cnt">' + n + '</span>' : '';
}
function whoBlock() {
  if (S.role === 'client') { var c = me(); return '<div class="who"><b>' + esc(c.orgName || c.name) + '</b><span>' + esc(SEGMENTS[c.segment].label) + '</span></div>'; }
  if (S.role === 'pro') { var p = meP(), st = proStats(p.id); return '<div class="who"><b>' + esc(p.name) + '</b><span>Level ' + st.level + ' · ' + esc(st.levelName) + '</span></div>'; }
  return '<div class="who"><b>LISTD operations</b><span>' + esc((STAFF_ROLES[staffRole()] || { label: 'Admin' }).label) + '</span></div>';
}
/* notifications slide-in panel (opened from the bell, top right) */
function notifToggle(open, silent) {
  S.notif = !!open; renderNotif();
  var bell = document.getElementById('a-bell'); if (bell) bell.setAttribute('aria-expanded', String(S.notif));
  if (S.notif) { var c = document.querySelector('#notif-panel .a-npanel-x'); if (c) c.focus({ preventScroll: true }); }
  else if (!silent && bell) bell.focus({ preventScroll: true });
}
function renderNotif() {
  var root = document.getElementById('notif-root');
  if (!root) { root = document.createElement('div'); root.id = 'notif-root'; root.innerHTML = '<div class="a-ndim" data-act="notif-close"></div><aside class="a-npanel" id="notif-panel" role="dialog" aria-modal="true" aria-labelledby="np-h" aria-hidden="true"><div class="a-npanel-in"></div></aside>'; document.body.appendChild(root); }
  if (S.notif && !(signedIn() && onboarded())) S.notif = false;
  var panel = root.querySelector('.a-npanel'), open = !!S.notif;
  root.classList.toggle('open', open); panel.setAttribute('aria-hidden', String(!open)); if ('inert' in panel) panel.inert = !open;
  document.documentElement.classList.toggle('a-noscroll', open);
  if (!open && !root.dataset.filled) return;
  var ns = myInbox(), un = ns.filter(function (n) { return !n.read; }).length, inner = root.querySelector('.a-npanel-in'), keepScroll = inner.querySelector('.a-nlist') ? inner.querySelector('.a-nlist').scrollTop : 0, act = document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.id || document.activeElement.className : null;
  inner.innerHTML = '<div class="a-npanel-h"><div><h2 id="np-h">Notifications</h2><span class="a-fine">' + (un ? un + ' unread' : 'All caught up') + '</span></div><div class="a-row" style="gap:6px">' + (un ? '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="read-all">Mark all read</button>' : '') + '<button type="button" class="ld-iconbtn a-npanel-x" data-act="notif-close" aria-label="Close notifications">' + ic('close', 20) + '</button></div></div>' +
    (ns.length ? '<div class="a-nlist">' + ns.slice(0, 100).map(function (n) { return '<button type="button" class="a-note-row' + (n.read ? '' : ' unread') + '" data-act="note" data-id="' + n.id + '">' + (n.read ? '<i class="r" aria-hidden="true"></i>' : '<i aria-label="Unread"></i>') + '<span>' + esc(n.text) + '<small>' + fdate(n.at, true) + (n.jobId && D.jobs[n.jobId] ? ' · ' + esc(D.jobs[n.jobId].ref) : '') + '</small></span></button>'; }).join('') + '</div>' : '<div class="a-nempty">' + empty('bell', 'You’re all caught up', 'Updates on quotes, offers, reports and payments appear here.', '') + '</div>');
  root.dataset.filled = '1';
  var l = inner.querySelector('.a-nlist'); if (l) l.scrollTop = keepScroll;
  if (act) { var f = inner.querySelector('[data-id="' + act + '"]') || inner.querySelector('.' + String(act).split(' ').pop()); if (f) f.focus({ preventScroll: true }); }
}
function vInbox() {
  var ns = myInbox();
  return '<div class="a-page" style="max-width:760px"><div class="a-head"><div><h1>Notifications</h1></div>' + (ns.some(function (n) { return !n.read; }) ? '<button class="ld-btn ld-btn-secondary ld-btn-sm" data-act="read-all">Mark all read</button>' : '') + '</div>' + (ns.length ? '<div class="a-card" style="padding:0">' + ns.slice(0, 100).map(function (n) { return '<button class="a-note-row' + (n.read ? '' : ' unread') + '" data-act="note" data-id="' + n.id + '">' + (n.read ? '' : '<i aria-label="Unread"></i>') + '<span>' + esc(n.text) + '<small>' + fdate(n.at, true) + '</small></span></button>'; }).join('') + '</div>' : empty('bell', 'You’re all caught up', 'Updates on quotes, offers, reports and payments appear here.', '')) + '</div>';
}
function mainView() {
  if (ENV.mode === 'connecting') return '<div class="a-page">' + empty('activity', 'Loading', 'Connecting to live data.', '') + '</div>';
  var v = S.view;
  if (S.role === 'admin') {
    if (!ENV.canAdmin) return '<div class="a-page">' + empty('lock', 'Admin access only', 'The admin panel is for LISTD staff with edit access to this workspace.', '') + '</div>';
    if (!S.adminOk) return vAuth();
    ensureStaff(); if (!staffRole()) return vStaffBlocked(); if (!viewAllowed(v)) return vNoAccess();
    return ({ job: vJob, requests: vAdminRequests, assign: vAdminAssign, reviews: vAdminReviews, disputes: vAdminDisputes, invoicing: vAdminInvoicing, finance: vAdminFinance, pros: vAdminPros, pro: vAdminPro, training: function () { return S.params.id ? vTraining() : vAdminTraining(); }, clients: vAdminClients, properties: vAdminProps, property: vProperty, policies: vAdminPolicies, audit: vAdminAudit, inbox: vInbox, settings: vSettings }[v] || vAdminHome)();
  }
  if (!AUTH.loaded) return vAuth();
  if (S.role === 'pro') { if (!meP()) return vAuth(); if (!proOnboarded()) return vProOnboard(); return ({ job: vJob, offers: vProOffers, schedule: vProSchedule, training: function () { return S.params.id ? vTraining() : vProTraining(); }, earnings: vProEarnings, account: vSettings, settings: vSettings, inbox: vInbox }[v] || vProHome)(); }
  if (!me()) return vAuth(); if (!clientOnboarded()) return vClientOnboard();
  return ({ job: vJob, jobs: vClientJobs, properties: vClientProps, property: vProperty, new: vClientNew, payments: vClientPayments, invoices: vClientInvoices, account: vSettings, settings: vSettings, inbox: vInbox }[v] || vClientHome)();
}

/* ---------- modals ---------- */
function mShell(form, title, body, submit, tone) { return '<form class="a-modal a-form" data-form="' + form + '" role="dialog" aria-modal="true" aria-labelledby="m-h"><div class="a-row sb"><h2 id="m-h">' + esc(title) + '</h2><button type="button" class="ld-iconbtn" data-act="close" aria-label="Close">' + ic('close', 20) + '</button></div>' + body + '<div class="a-actions"><button class="ld-btn ' + (tone || 'ld-btn-primary') + '" type="submit">' + esc(submit) + '</button><button class="ld-btn ld-btn-secondary" type="button" data-act="close">Cancel</button></div></form>'; }
function modalView() {
  var m = S.modal; if (!m) return ''; var j = m.id ? D.jobs[m.id] : null, inner = '';
  var evs = (m.ev || []).map(function (id) { return D.evidence[id]; }).filter(Boolean);
  switch (m.type) {
    case 'prop': inner = propModal(m.pid ? D.properties[m.pid] : null); break;
    case 'training': inner = trainingModal(); break;
    case 'invoice': inner = invModal(); break;
    case 'invite': inner = inviteModal(); break;
    case 'staff': inner = staffModal(); break;
    case 'dispute': inner = mShell('m-dispute', j.status === 'COMPLETED' ? 'Raise a complaint' : 'Raise a dispute', '<p class="a-muted">' + (S.role === 'client' ? 'Payout to the Pro is frozen while LISTD reviews.' : 'LISTD will review and contact both parties.') + '</p>' + field('md-cat', 'Category', sel('md-cat', 'category', S.role === 'pro' ? ['Access or safety', 'Scope disagreement', 'Payment', 'Client conduct', 'Other'] : ['Quality of work', 'Report accuracy', 'Missed or late visit', 'Damage', 'Pro conduct', 'Other'], '')) + field('md-t', 'What happened?', area('md-t', 'text', '', 'required')) + photoGrid(evs) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'OTHER', area: 'dispute', modal: 1 }, 'Add evidence') + '</div>', 'Open dispute', 'ld-btn-danger'); break;
    case 'resched': inner = mShell('m-resched', 'Request a new time', '<p class="a-muted">Current: ' + winLabel(j.window) + '. It stays booked until the client and Pro both agree' + (hoursFrom(winStart(j.window)) <= settings().rescheduleHours ? ', and LISTD reviews it because it’s short notice' : '') + '.</p><div class="two">' + field('mr-d', 'New date', inp('mr-d', 'date', '', 'type="date" required min="' + new Date().toISOString().slice(0, 10) + '"')) + field('mr-s', 'Window', sel('mr-s', 'slot', Object.keys(WINDOWS).map(function (k) { return [k, WINDOWS[k][0] + ' ' + WINDOWS[k][1] + '–' + WINDOWS[k][2]]; }), j.window.slot)) + '</div>' + field('mr-r', 'Reason', inp('mr-r', 'reason', '', 'required')), 'Send request'); break;
    case 'cancel': inner = mShell('m-cancel', 'Cancel this request?', '<p>' + (paidP(j) ? 'Work hasn’t started, so you’ll get a full refund of ' + P(paidP(j) - refundedP(j)) + ' (test mode).' : 'Nothing has been charged.') + '</p>' + field('mc-r', 'Reason', inp('mc-r', 'reason', '', 'required')), 'Cancel request', 'ld-btn-danger'); break;
    case 'cancel-req': inner = mShell('m-cancel-req', 'Ask LISTD to cancel', '<p class="a-muted">' + (S.role === 'pro' ? 'LISTD will reassign or rearrange the job.' : 'Work has started, so LISTD reviews the outcome and any refund.') + '</p>' + field('mq-r', 'Reason', inp('mq-r', 'reason', '', 'required')), 'Send request'); break;
    case 'q-reject': inner = mShell('m-q-reject', 'Decline this quote?', '<p class="a-muted">LISTD can revise it.</p>' + field('mj-r', 'What would you like changed?', inp('mj-r', 'reason', '')), 'Decline quote'); break;
    case 'r-correct': inner = mShell('m-correct', 'Request corrections', '<p class="a-muted">The review timer pauses. The Pro updates the report and LISTD releases a new version.</p>' + field('mx-t', 'What needs correcting?', area('mx-t', 'text', '', 'required')), 'Send request'); break;
    case 'offer-no': inner = mShell('m-offer-no', 'Decline offer', field('mo-r', 'Reason <small>Optional</small>', inp('mo-r', 'reason', '')), 'Decline offer'); break;
    case 'co-propose': inner = mShell('m-co', 'Propose extra work', '<p class="a-muted">Don’t start extra work until the client approves and pays for it.</p>' + field('mco-d', 'What extra work is needed and why?', area('mco-d', 'desc', '', 'required')) + field('mco-e', 'Your cost estimate £', inp('mco-e', 'estimate', '', 'type="number" min="1" step="0.01" required')) + photoGrid(evs) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'OTHER', area: 'change-order', modal: 1 }, 'Add evidence') + '</div>', 'Send to LISTD'); break;
    case 'unsafe': inner = mShell('m-unsafe', 'Stop work: unsafe', '<p class="a-muted">Make the area safe and leave if needed. LISTD will put the job on hold and decide next steps.</p>' + field('mu-r', 'What is unsafe?', area('mu-r', 'reason', '', 'required')), 'Stop & alert LISTD', 'ld-btn-danger'); break;
  }
  return '<div class="a-scrim" data-act="scrim">' + inner + '</div>';
}

/* ---------- render ---------- */
var lastKey = '';
function viewKey() { return [S.role, S.clientId, S.proId, (S.auth || {}).mode || '', S.view, JSON.stringify(S.params), S.wiz ? S.wiz.step : '', S.modal ? S.modal.type + S.modal.id : '', me() ? me().onboarding.step : '', meP() ? meP().onboarding.step : ''].join('|'); }
function render() {
  var root = document.getElementById('app'); if (!root) return;
  if (S.picking && Date.now() - S.picking < 180000) { clearTimeout(S.pickT); S.pickT = setTimeout(scheduleRender, 3000); return; }
  ensureAccount();
  var key = viewKey(), keep = {}, act = document.activeElement, actId = act && act.id, sel_ = null, sy = window.scrollY;
  if (key === lastKey) {
    root.querySelectorAll('input[id],textarea[id],select[id]').forEach(function (el) { if (el.type === 'file' || el.dataset.rf || el.dataset.rfsel || el.dataset.mna) return; keep[el.id] = el.type === 'checkbox' || el.type === 'radio' ? { c: el.checked } : { v: el.value }; });
    root.querySelectorAll('input[type=radio]:checked').forEach(function (el) { keep['radio:' + el.name] = el.value; });
    root.querySelectorAll('details').forEach(function (el, i) { keep['details:' + i] = el.open ? 1 : 0; });
    try { if (act && act.selectionStart != null) sel_ = [act.selectionStart, act.selectionEnd]; } catch (e) {}
  }
  var nav = navItems(), cur = S.view === 'job' ? (S.role === 'pro' ? 'schedule' : S.role === 'admin' ? 'requests' : 'jobs') : S.view === 'property' ? 'properties' : S.view === 'pro' ? 'pros' : S.view === 'new' ? 'jobs' : S.view;
  var navHtml = nav.map(function (n) { return '<button type="button" class="a-nav" data-go="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + ic(n[1], 20) + '<span>' + n[2] + '</span>' + badgeFor(n[0]) + '</button>'; }).join('');
  var tabs = nav.filter(function (n) { return ['home', 'jobs', 'new', 'offers', 'schedule', 'requests', 'assign', 'reviews', 'settings', 'payments', 'earnings', 'finance'].indexOf(n[0]) >= 0; }).slice(0, 5);
  root.innerHTML = topBar() + '<div class="a-shell' + (nav.length ? '' : ' solo') + '">' + (nav.length ? '<aside class="a-side" aria-label="Sections">' + whoBlock() + '<nav>' + navHtml + '</nav></aside>' : '') + '<main class="a-main" id="main">' + mainView() + '</main></div>' + (nav.length ? '<nav class="a-tabs" aria-label="Sections">' + tabs.map(function (n) { return '<button type="button" class="a-nav" data-go="' + n[0] + '"' + (cur === n[0] ? ' aria-current="page"' : '') + '>' + ic(n[1], 20) + '<span>' + n[2].split(' ')[0] + '</span></button>'; }).join('') + '<button type="button" class="a-nav" data-act="more" aria-expanded="' + !!S.more + '">' + ic('menu', 20) + '<span>More</span></button></nav>' + (S.more ? '<div class="a-more" role="menu">' + navHtml + '</div>' : '') : '') + modalView() ;
  if (key === lastKey) {
    Object.keys(keep).forEach(function (id) {
      if (id.indexOf('radio:') === 0) { var r = root.querySelector('input[type=radio][name="' + id.slice(6) + '"][value="' + keep[id] + '"]'); if (r) r.checked = true; return; }
      if (id.indexOf('details:') === 0) { var dd = root.querySelectorAll('details')[+id.slice(8)]; if (dd) dd.open = !!keep[id]; return; }
      var el = document.getElementById(id); if (!el) return; if ('c' in keep[id]) el.checked = keep[id].c; else if (el.value !== keep[id].v) el.value = keep[id].v;
    });
    if (actId) { var f = document.getElementById(actId); if (f) { f.focus({ preventScroll: true }); if (sel_) try { f.setSelectionRange(sel_[0], sel_[1]); } catch (e) {} } }
    window.scrollTo(0, sy);
  } else if (S.modal) { var first = root.querySelector('.a-modal input:not([type=file]),.a-modal textarea,.a-modal select'); if (first) first.focus(); }
  else { var h1 = root.querySelector('.a-main h1'); if (h1 && lastKey) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } }
  bindUploads(root);
  lastKey = key;
  renderNotif();
  if (S.modal && S.modal.type === 'invoice') invCalc(root.querySelector('form[data-form=inv-create]'));
}
var rq = 0, sweepT = 0; function scheduleRender() { if (!rq) rq = requestAnimationFrame(function () { rq = 0; render(); }); clearTimeout(sweepT); sweepT = setTimeout(sweep, 1500); }
listeners.push(scheduleRender);
setInterval(function () { sweep(); scheduleRender(); }, 60000);

/* ---------- click actions ---------- */
function reason(f) { return String(new FormData(f).get('reason') || '').trim(); }
document.addEventListener('click', function (e) {
  var g = e.target.closest('[data-go]');
  if (g && !g.disabled) { e.preventDefault(); S.more = false; if (g.dataset.go === 'new' && S.view !== 'new') S.wiz = null; var gp = {}; if (g.dataset.id) gp.id = g.dataset.id; if (g.dataset.tab) gp.tab = g.dataset.tab; if (g.dataset.go === 'settings') { S.mfaSetup = null; S.mfaOff = false; } go(g.dataset.go, gp); return; }
  var a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  var act = a.dataset.act, id = a.dataset.id, j = id ? D.jobs[id] : null;
  if (act === 'scrim') { if (e.target === a) { S.modal = null; render(); } return; }
  e.preventDefault();
  var M = function (type, extra) { S.modal = Object.assign({ type: type, id: id, ev: [] }, extra || {}); render(); };
  switch (act) {
    case 'role': if (PORTAL) break; S.auth = null; S.authErr = ''; S.role = a.dataset.r; S.view = 'home'; S.params = {}; S.modal = null; S.signup = false; S.more = false; HIST = []; persistUI(); render(); break;
    case 'more': S.more = !S.more; render(); break;
    case 'auth-mode': authMode(a.dataset.m, { email: (document.getElementById('au-email') || {}).value || '' }); break;
    case 'pw-toggle': var pf = document.getElementById(a.dataset.for); if (pf) { var show = pf.type === 'password'; pf.type = show ? 'text' : 'password'; a.setAttribute('aria-pressed', String(show)); a.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); pf.focus(); } break;
    case 'signout': signOut(); break;
    case 'mfa-cancel': S.mfaSetup = null; S.mfaOff = false; render(); break;
    case 'signout-others': signOutOthers(); break;
    case 'export-data': exportData(); break;
    case 'cancel-deletion': patchDoc(S.role === 'pro' ? 'pros' : 'clients', S.role === 'pro' ? S.proId : S.clientId, { deletion: null }); toast('Request withdrawn'); break;
    case 'open-job': go('job', { id: id }); break;
    case 'back': back(); break;
    case 'filter': S.filter = a.dataset.f; render(); break;
    case 'queue': S.qIdx = +a.dataset.q; go('requests'); S.qIdx = +a.dataset.q; render(); break;
    case 'wq': S.wq = a.dataset.q; render(); var t = document.getElementById('wq-' + S.wq); if (t) t.focus(); break;
    case 'queue-clear': S.qIdx = null; render(); break;
    case 'ptab': S.ptab = a.dataset.t; render(); break;
    case 'itab': S.itab = a.dataset.t; render(); break;
    case 'tshow': S.tshow = a.dataset.t; render(); break;
    case 't-unup': S.tUp = null; render(); break;
    case 't-status': cmdTrainingStatus(a.dataset.id, a.dataset.s) && toast({ PUBLISHED: 'Training published', DRAFT: 'Saved as draft', ARCHIVED: 'Training archived' }[a.dataset.s]); break;
    case 'app-withdraw': cmdWithdrawApp(id) && toast('Application withdrawn'); break;
    case 'cal-prev': case 'cal-next': case 'cal-today': case 'cal-go': (function () { var t = new Date(), cur = S.calM || (t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2)), y = +cur.slice(0, 4), mo = +cur.slice(5, 7) - 1; if (act === 'cal-today') { S.calM = null; } else if (act === 'cal-go') { S.calM = a.dataset.m; } else { var d = new Date(y, mo + (act === 'cal-next' ? 1 : -1), 1); S.calM = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); } render(); })(); break;
    case 'close': if (S.modal && S.modal.type === 'training') S.tUp = null; S.modal = null; render(); break;
    case 't-new': S.tUp = null; S.modal = { type: 'training' }; render(); break;
    case 'pro-add': if (!staffGuard('pros', 'add Pros')) break; S.modal = { type: 'invite' }; render(); break;
    case 'staff-add': S.modal = { type: 'staff' }; render(); break;
    case 'staff-transfer': S.modal = { type: 'staff', kind: 'transfer', id: id }; render(); break;
    case 'staff-remove': cmdStaffRemove(id) && toast('Access removed'); break;
    case 'inv-copy': (function () { var p = D.pros[S.modal.done.id], t = 'Hi ' + (p.firstName || p.name) + ', you’re invited to join LISTD as a Pro. Open ' + inviteLink(S.modal.done.code) + ', choose Pro, then Accept an invitation. Code: ' + S.modal.done.code + ' (use ' + p.email + '). Expires ' + fdate(p.invite.expiresAt) + '.'; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Invitation copied'); }, function () { toast('Copy isn’t available here. Select the code and link instead.'); }); })(); break;
    case 'pro-resend': cmdResendInvite(id).then(function (r) { if (r) { S.modal = { type: 'invite', done: r }; render(); } }); break;
    case 'pro-uninvite': cmdCancelInvite(id) && toast('Invitation cancelled'); break;
    case 'inv-new': S.modal = { type: 'invoice', cid: a.dataset.c || '', jid: a.dataset.j || '', n: 2 }; render(); break;
    case 'inv-add': S.modal.n = (S.modal.n || 2) + 1; render(); invCalc(document.querySelector('form[data-form=inv-create]')); break;
    case 'inv-rm': (function () { var f = document.querySelector('form[data-form=inv-create]'), k = +a.dataset.i, n = S.modal.n; for (var i = k; i < n - 1; i++) ['ld', 'lq', 'lu'].forEach(function (x) { document.getElementById('inv-' + x + '-' + i).value = document.getElementById('inv-' + x + '-' + (i + 1)).value; }); S.modal.n = n - 1; render(); invCalc(document.querySelector('form[data-form=inv-create]')); })(); break;
    case 'note': var n = D.notes[id]; if (!n.read) patchDoc('notes', id, { read: true }); if (n.jobId && D.jobs[n.jobId]) { notifToggle(false, true); go('job', { id: n.jobId }); } break;
    case 'notif': notifToggle(!S.notif); break;
    case 'notif-close': notifToggle(false); break;
    case 'read-all': myInbox().filter(function (x) { return !x.read; }).forEach(function (x) { patchDoc('notes', x.id, { read: true }); }); break;
    /* onboarding */
    case 'ob-back': patchDoc('clients', S.clientId, { onboarding: { status: 'IN_PROGRESS', step: Math.max(1, me().onboarding.step - 1) } }); break;
    case 'cl-ob-finish': patchDoc('clients', S.clientId, { onboarding: { status: 'DONE', step: 5, doneAt: now() } }); S.view = 'home'; toast('You’re all set'); break;
    case 'pob-back': patchDoc('pros', S.proId, { onboarding: { status: 'IN_PROGRESS', step: Math.max(2, meP().onboarding.step - 1) } }); break;
    case 'pob-docs': var p = meP(), req = DOCS.filter(function (d) { return d[2] || (d[0] === 'INSURANCE' && (p.skills || []).indexOf('REPAIRS_DAMAGES') >= 0); }), missing = req.filter(function (d) { return !(p.docs || []).some(function (x) { return x.type === d[0]; }); }); if (missing.length) { toast('Upload: ' + missing.map(function (d) { return d[1]; }).join(', ')); return; } patchDoc('pros', S.proId, { onboarding: { status: 'IN_PROGRESS', step: 6 } }); break;
    case 'pob-submit': var tc = document.getElementById('pob-terms'); if (!tc || !tc.checked) { toast('Agree to the Pro terms to submit.'); if (tc) tc.focus(); return; } patchDoc('pros', S.proId, { consent: Object.assign({}, meP().consent, { terms: now() }), onboarding: { status: 'SUBMITTED', step: 7, submittedAt: now() }, status: 'PENDING' }); if (!pendingApp(S.proId, 'JOIN')) setDoc('applications', uid(), { proId: S.proId, kind: 'JOIN', from: 0, to: 1, status: 'PENDING', createdAt: now() }); notify('admin', 'Pro application from ' + meP().name + ' to review'); S.view = 'home'; toast('Application submitted'); break;
    case 'pob-edit': patchDoc('pros', S.proId, { onboarding: { status: 'IN_PROGRESS', step: 2 } }); break;
    /* properties & wizard */
    case 'add-prop': M('prop'); break;
    case 'edit-prop': S.modal = { type: 'prop', pid: id }; render(); break;
    case 'new-for': wizInit(id); go('new'); break;
    case 'linked': wizInit(null, id); go('new'); break;
    case 'wiz-back': S.wiz.step = Math.max(1, S.wiz.step - 1); render(); break;
    case 'reveal': S.revealed = S.revealed || {}; S.revealed[id] = 1; audit('property.reveal_access', 'property', id, 'Admin viewed access codes'); render(); break;
    /* client */
    case 'q-accept': cmdAcceptQuote(j); break;
    case 'inv-pay': if (cmdAcceptQuote(j) && cmdPay(D.jobs[j.id])) toast('Invoice paid (test)'); break;
    case 'q-reject': M('q-reject'); break;
    case 'pay': if (cmdPay(j)) toast('Payment confirmed (test)'); break;
    case 'pay-fail': cmdPay(j, true); toast('Payment failed (simulated). Booking not confirmed.'); break;
    case 'r-accept': if (cmdAcceptReport(j, 'EXPLICIT')) toast('Report accepted'); break;
    case 'r-correct': M('r-correct'); break;
    case 'dispute': M('dispute'); break;
    case 'resched': M('resched'); break;
    case 'cancel': M('cancel'); break;
    case 'cancel-req': M('cancel-req'); break;
    case 'sc-yes': cmdRespondChange(j, true); break;
    case 'sc-no': cmdRespondChange(j, false); break;
    case 'co-accept': cmdCOReply(j, a.dataset.co, true) && toast('Extra work approved and paid (test)'); break;
    case 'co-decline': cmdCOReply(j, a.dataset.co, false); break;
    case 'star': S.rate = S.rate || {}; S.rate[id] = +a.dataset.n; render(); break;
    case 'receipt': downloadReceipt(j); break;
    case 'dl-report': downloadReport(j); break;
    case 'rv': S.params = Object.assign({}, S.params, { rv: +a.dataset.v }); render(); break;
    /* pro */
    case 'offer-yes': if (cmdOfferReply(j, true)) toast('Job accepted and scheduled'); break;
    case 'offer-no': M('offer-no'); break;
    case 'clock-in': if (cmdClockIn(j, (S.clockPhoto || {})[id])) { delete S.clockPhoto[id]; toast('Clocked in'); } break;
    case 'cond': var d = draftOf(j), it = d.rooms[+a.dataset.r].items[+a.dataset.i]; it.cond = it.cond === a.dataset.c ? '' : a.dataset.c; saveDraft(id); render(); break;
    case 'grade': var dg = draftOf(j), ig = dg.rooms[+a.dataset.r].items[+a.dataset.i]; ig.cond = ig.cond === a.dataset.g ? '' : a.dataset.g; saveDraft(id); render(); break;
    case 'iact': draftOf(j).rooms[+a.dataset.r].items[+a.dataset.i].action = a.dataset.a; saveDraft(id); render(); break;
    case 'vet': var dv = draftOf(j); if (a.dataset.path === 'summary') dv.summaryVetted = true; else { var ks = a.dataset.path.split('.'), o = dv; ks.forEach(function (k2) { o = o[k2]; }); o.vetted = true; o.vettedAt = now(); } saveDraft(id); render(); break;
    case 'rm-item': var dr = draftOf(j); dr.rooms[+a.dataset.r].items.splice(+a.dataset.i, 1); saveDraft(id); render(); break;
    case 'add-row': var da = draftOf(j); da[a.dataset.list].push(a.dataset.list === 'alarms' ? { id: uid(), name: 'Smoke Alarms', location: '', result: '' } : { id: uid(), name: 'Other Keys', desc: '', source: '', vetted: false }); saveDraft(id); render(); break;
    case 'rm-row': draftOf(j)[a.dataset.list].splice(+a.dataset.i, 1); saveDraft(id); render(); break;
    case 'ai-item': aiDescribeItem(id, a.dataset.room, a.dataset.item); break;
    case 'ai-room': aiRoomSuggest(id, a.dataset.room); break;
    case 'ai-meter': aiMeter(id, a.dataset.m); break;
    case 'ai-keys': aiKeys(id, a.dataset.k); break;
    case 'ai-summary': aiSummary(id); break;
    case 'find': var d3 = draftOf(j); d3.rooms[+a.dataset.r].items[+a.dataset.i].find = a.dataset.f; saveDraft(id); render(); break;
    case 'all-good': var d2 = draftOf(j), cnt = 0; d2.rooms.forEach(function (rm) { rm.items.forEach(function (x) { if (!x.cond) { x.cond = 'good'; cnt++; } }); }); saveDraft(id); render(); toast(cnt + ' item' + (cnt === 1 ? '' : 's') + ' set to Good'); break;
    case 'submit-report': clearTimeout(saveT[id]); if (cmdSubmitReport(j)) { toast('Report submitted to LISTD'); window.scrollTo(0, 0); } break;
    case 'co-propose': M('co-propose'); break;
    case 'unsafe': M('unsafe'); break;
    /* admin */
    case 'q-add': readQuoteForm(a.closest('form'), j).lines.push({ d: '', q: 1, u: 0 }); render(); break;
    case 'q-rm': var qd = readQuoteForm(a.closest('form'), j); qd.lines.splice(+a.dataset.i, 1); render(); break;
    case 'q-calc': readQuoteForm(a.closest('form'), j); render(); break;
    case 'revoke': cmdRevoke(j, 'Offer withdrawn by LISTD'); break;
    case 'release': cmdReleaseReport(j) && toast('Report released to client'); break;
    case 'admin-complete': if (cmdAcceptReport(j, 'ADMIN')) audit('job.complete', 'job', id, 'Completed on client’s behalf'); break;
    case 'investigate': cmdDisputeRespond(j, 'LISTD is investigating.'); break;
    case 'payout': if (!staffGuard('finance', 'release payouts')) break; cmdReleasePayout(j) && toast('Payout released (test)'); break;
    case 'cancel-req-done': upd(j, { cancelRequest: Object.assign({}, j.cancelRequest, { done: true }) }, 'Cancellation request handled', 'admin'); audit('cancel_request.handled', 'job', id, j.cancelRequest.reason); break;
  }
});

/* ---------- inputs ---------- */
document.addEventListener('input', function (e) {
  var el = e.target;
  if (el.dataset.pw) pwLive(el);
  if (el.dataset.rf) { var j = D.jobs[el.dataset.id]; if (!j) return; setPath(draftOf(j), el.dataset.rf, el.value); saveDraft(j.id); }
  if (el.closest && el.closest('form[data-form=inv-create]')) invCalc(el.closest('form'));
  if (el.dataset.filt === 'search') { S.search = el.value; clearTimeout(el._t); el._t = setTimeout(render, 250); }
});
document.addEventListener('change', async function (e) {
  var el = e.target;
  if (settingsChange(el)) return;
  if (el.dataset.filt && el.dataset.filt !== 'search') { S[el.dataset.filt] = el.value; render(); return; }
  if (el.dataset.staffrole) { if (el.value) cmdStaffRole(el.dataset.staffrole, el.value) && toast('Role updated'); return; }
  if (el.id === 'inv-c') { S.modal.cid = el.value; S.modal.jid = ''; S.modal.pid = ''; render(); return; }
  if (el.id === 'inv-j') { S.modal.jid = el.value; render(); invCalc(document.querySelector('form[data-form=inv-create]')); return; }
  if (el.id === 'of-pro') { var fe = document.getElementById('of-fee'), pr0 = D.pros[el.value]; if (fe && pr0 && +fe.dataset.sub) fe.value = (Math.round(+fe.dataset.sub * lvRule(proLevel(pr0)).sharePct / 100) / 100).toFixed(2); return; }
  if (el.dataset.rfsel) { var jr = D.jobs[el.dataset.id]; setPath(draftOf(jr), el.dataset.rfsel, el.value); saveDraft(jr.id); render(); return; }
  if (el.dataset.mna) { var jm = D.jobs[el.dataset.id]; draftOf(jm).meters[+el.dataset.mna].na = el.checked; saveDraft(jm.id); render(); return; }
  if (el.dataset.ck) { var j = D.jobs[el.dataset.id]; draftOf(j).checklist[+el.dataset.ck].done = el.checked; saveDraft(j.id); render(); return; }
  if (el.dataset.docexp) { var p0 = meP(); patchDoc('pros', S.proId, { docs: (p0.docs || []).map(function (d) { return (d.type === 'DBS' || d.type === 'INSURANCE') ? Object.assign({}, d, { expires: el.value }) : d; }), docExpiry: el.value }); return; }
});
async function handleUpload(el) {
  S.picking = 0;
  {
    var files = Array.prototype.slice.call(el.files || []); if (!files.length) { scheduleRender(); return; }
    var meta = JSON.parse(el.dataset.up); el.disabled = true;
    if (meta.training) { await trainingFile(files[0]); render(); return; }
    toast('Uploading…');
    var flags = { wiz: meta.wiz, doc: meta.doc, clock: meta.clock, modal: meta.modal, ai: meta.ai, room: meta.room }; delete meta.wiz; delete meta.clock; delete meta.modal; delete meta.ai; delete meta.room;
    if (flags.wiz) { meta.area = 'request'; }
    if (flags.doc) { meta = { proId: S.proId, category: 'verification', docType: flags.doc, allowPdf: true }; }
    var ids = await addFiles(meta, files);
    if (ids.length) {
      if (flags.wiz && S.wiz) S.wiz.photoIds = S.wiz.photoIds.concat(ids);
      if (flags.doc) { var p = meP(), docs = (p.docs || []).filter(function (d) { return d.type !== flags.doc; }); docs.push({ type: flags.doc, fileId: ids[0], name: files[0].name, expires: (flags.doc === 'DBS' || flags.doc === 'INSURANCE') ? (p.docExpiry || '') : '', at: now() }); patchDoc('pros', S.proId, { docs: docs }); }
      if (flags.ai && aiOn()) { if (flags.ai === 'item') aiDescribeItem(meta.jobId, flags.room, meta.item, files); else if (flags.ai === 'meter') aiMeter(meta.jobId, meta.item, files); else if (flags.ai === 'keys') aiKeys(meta.jobId, meta.item, files); }
      if (flags.clock) { S.clockPhoto = S.clockPhoto || {}; S.clockPhoto[meta.jobId + (flags.clock === 'out' ? ':out' : '')] = ids[ids.length - 1]; }
      if (flags.modal && S.modal) S.modal.ev = (S.modal.ev || []).concat(ids);
    }
    el.value = ''; el.disabled = false; render();
  }
}
/* File inputs get a direct handler so a re-render while the camera/file picker is open can't lose the photos. */
function bindUploads(root) { root.querySelectorAll('input[type=file][data-up]').forEach(function (el) { el.onchange = function () { handleUpload(el); }; el.oncancel = function () { S.picking = 0; scheduleRender(); }; }); }
document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.a-up')) S.picking = Date.now(); }, true);
window.addEventListener('focus', function () { if (S.picking) setTimeout(function () { if (S.picking && Date.now() - S.picking > 1500) { S.picking = 0; scheduleRender(); } }, 2000); });
document.addEventListener('keydown', function (e) {
  var tb = e.target.closest && e.target.closest('.a-wqtabs [role=tab]');
  if (tb && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) { var all = Array.prototype.slice.call(document.querySelectorAll('.a-wqtabs [role=tab]')), i = all.indexOf(tb); i = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length; e.preventDefault(); all[i].click(); return; } if (e.key === 'Escape' && S.notif && !S.modal) { notifToggle(false); return; } if (e.key === 'Escape' && (S.modal || S.more)) { S.modal = null; S.more = false; render(); } });

/* ---------- forms ---------- */
document.addEventListener('submit', function (e) {
  var f = e.target, kind = f.dataset.form; if (!kind) return; e.preventDefault();
  if (kind.indexOf('auth-') === 0) { authSubmit(kind, f); return; }
  if (['set-email', 'mfa-on', 'mfa-off', 'set-admin', 'set-notify'].indexOf(kind) >= 0) { settingsSubmit(kind, f); return; }
  var fd = new FormData(f), v = function (n) { return String(fd.get(n) || '').trim(); }, id = f.dataset.id, j = id ? D.jobs[id] : null, mj = S.modal && S.modal.id ? D.jobs[S.modal.id] : null;
  var close = function () { S.modal = null; render(); };
  switch (kind) {
    /* client onboarding */
    case 'cl-ob1': if (!fd.get('authority')) { toast('Confirm you’re authorised to book for your properties.'); return; } patchDoc('clients', S.clientId, { segment: v('segment'), consent: Object.assign({}, me().consent, { authority: now() }), onboarding: { status: 'IN_PROGRESS', step: 2 } }); break;
    case 'cl-ob2': patchDoc('clients', S.clientId, { orgName: v('orgName'), landlordType: fd.get('landlordType') ? v('landlordType') : null, mdRole: fd.get('mdRole') ? v('mdRole') : null, branch: v('branch'), phone: v('phone'), onboarding: { status: 'IN_PROGRESS', step: 3 } }); break;
    case 'cl-ob3': patchDoc('clients', S.clientId, { billing: { name: v('bname'), email: v('bemail'), address: v('baddr'), city: v('bcity'), postcode: v('bpc').toUpperCase() }, onboarding: { status: 'IN_PROGRESS', step: 4 } }); break;
    case 'prop':
      var body = propFromForm(fd), pid = f.dataset.id;
      if (pid) { patchDoc('properties', pid, body); close(); toast('Property updated'); }
      else { pid = uid(); setDoc('properties', pid, Object.assign(body, { clientId: S.clientId, active: true, createdAt: now() })); if (f.dataset.ob) patchDoc('clients', S.clientId, { onboarding: { status: 'IN_PROGRESS', step: 5 } }); else { if (S.wiz) S.wiz.propertyId = pid; close(); toast('Property added'); } }
      break;
    case 'wiz':
      var w = S.wiz;
      if (w.step === 1) w.propertyId = v('propertyId');
      else if (w.step === 2) { var sv = v('service'); if (!SVC[sv]) { toast('Choose a service.'); return; } w.type = sv === 'REPAIRS_DAMAGES' || sv === 'CLEANING' ? 'MAINTENANCE' : sv; w.kind = w.type === 'MAINTENANCE' ? sv : null; }
      else if (w.step === 3) { ['rooms', 'inventory', 'keys', 'occupant', 'clean', 'condition', 'notes', 'category', 'location', 'description', 'severity'].forEach(function (k) { if (fd.has(k)) w.scope[k] = v(k); }); if (w.scope.severity === 'unsafe') toast('Flagged as unsafe. LISTD will see this first.'); }
      else if (w.step === 4) { w.scope.access = v('access'); if (fd.has('noPhotoReason')) w.scope.noPhotoReason = v('noPhotoReason'); if (w.kind === 'REPAIRS_DAMAGES' && !w.photoIds.length && !w.scope.noPhotoReason) { toast('Add a photo, or say why you can’t.'); return; } }
      else if (w.step === 5) { w.date = v('date'); w.slot = v('slot'); }
      else { var nid = cmdSubmit(w); if (nid) { S.wiz = null; go('job', { id: nid }); toast('Request submitted'); } return; }
      w.step++; render(); window.scrollTo(0, 0); break;
    case 'respond': cmdRespond(j, v('answer')); break;
    case 'add-item': var dI = draftOf(j); dI.rooms[+f.dataset.r].items.push(mkItem(v('name').slice(0, 60))); saveDraft(id); render(); break;
    case 'add-room': var dR = draftOf(j); dR.rooms.push({ id: uid(), name: v('name').slice(0, 60).toUpperCase(), ext: !!fd.get('ext'), items: fd.get('ext') ? [] : ['Door', 'Ceiling', 'Walls', 'Flooring', 'Lighting', 'Additional Items'].map(mkItem) }); saveDraft(id); render(); break;
    case 'rate': cmdRate(j, (S.rate || {})[id] || 0, v('text')) && toast('Thanks for your rating'); break;
    case 'msg': if (cmdMessage(j, v('body'))) { f.reset(); var ta = f.querySelector('textarea'); if (ta) ta.value = ''; } break;
    case 'dispute-resp': cmdDisputeRespond(j, v('text')); break;
    /* modals */
    case 'm-dispute': if (cmdOpenDispute(mj, v('category'), v('text'), S.modal.ev)) { close(); toast('Dispute opened'); } break;
    case 'm-resched': var nw = { date: v('date'), slot: v('slot') }; if (hoursFrom(winStart(nw)) <= 0) { toast('Choose a future time.'); return; } if (cmdProposeChange(mj, nw, v('reason'))) { close(); toast('Reschedule requested'); } break;
    case 'm-cancel': if (cmdCancel(mj, v('reason'))) { close(); toast('Request cancelled'); } break;
    case 'm-cancel-req': cmdCancelRequest(mj, v('reason')); close(); toast('Sent to LISTD'); break;
    case 'm-q-reject': cmdRejectQuote(mj, v('reason')); close(); break;
    case 'm-correct': cmdCorrection(mj, v('text')); close(); toast('Correction requested'); break;
    case 'm-offer-no': cmdOfferReply(mj, false, v('reason')); close(); toast('Offer declined'); break;
    case 'm-co': if (cmdProposeCO(mj, v('desc'), toP(v('estimate')), S.modal.ev)) { close(); toast('Sent to LISTD for pricing'); } break;
    case 'm-unsafe': cmdCancelRequest(mj, 'UNSAFE — ' + v('reason')); notify('admin', mj.ref + ': Pro reports unsafe conditions', mj.id); close(); toast('LISTD alerted'); break;
    /* pro onboarding */
    case 'pr-ob1': var prid = uid(); setDoc('pros', prid, { name: v('name'), email: v('email'), status: 'DRAFT', consent: { terms: now() }, ownerUid: ENV.uid || null, onboarding: { status: 'IN_PROGRESS', step: 2 }, createdAt: now() }); S.proId = prid; S.signup = false; persistUI(); render(); break;
    case 'pr-ob2': if (!v('name')) { toast('Enter your full name.'); return; } patchDoc('pros', S.proId, { name: v('name'), bizType: v('bizType'), bizName: v('bizName'), phone: v('phone'), home: v('home').toUpperCase(), onboarding: { status: 'IN_PROGRESS', step: 3 } }); break;
    case 'pr-ob3': var sk = fd.getAll('skills'); if (!sk.length) { toast('Choose at least one service.'); return; } patchDoc('pros', S.proId, { skills: sk, coverage: v('coverage').toUpperCase().split(/[,\s]+/).filter(Boolean), onboarding: { status: 'IN_PROGRESS', step: 4 } }); break;
    case 'pr-ob4': var days = fd.getAll('days').map(Number), slots = fd.getAll('slots'); if (!days.length || !slots.length) { toast('Choose at least one day and window.'); return; } patchDoc('pros', S.proId, { availability: { days: days, slots: slots }, onboarding: { status: 'IN_PROGRESS', step: 5 } }); break;
    case 'pr-ob6': patchDoc('pros', S.proId, { payout: { holder: v('holder'), last4: v('last4'), ready: true, mode: 'test', at: now() }, onboarding: { status: 'IN_PROGRESS', step: 7 } }); break;
    case 'pro-profile': var sk2 = fd.getAll('skills'), dys = fd.getAll('days').map(Number), sls = fd.getAll('slots'); if (!sk2.length) { toast('Choose at least one service.'); return; } if (!dys.length || (f.querySelector('[name=slots]') && !sls.length)) { toast('Choose at least one day and time window.'); return; } patchDoc('pros', S.proId, { skills: sk2, coverage: v('coverage').toUpperCase().split(/[,\s]+/).filter(Boolean), availability: { days: dys, slots: sls.length ? sls : (meP().availability || {}).slots || [] } }); toast('Saved'); break;
    case 'set-account': patchDoc('clients', S.clientId, { name: v('name'), phone: v('phone'), orgName: fd.has('orgName') ? v('orgName') : me().orgName || '', mdRole: fd.has('mdRole') ? v('mdRole') : me().mdRole || null, branch: fd.has('branch') ? v('branch') : me().branch || '' }); toast('Account updated'); break;
    case 'set-billing': patchDoc('clients', S.clientId, { billing: { name: v('bname'), email: v('bemail'), address: v('baddr'), city: v('bcity'), postcode: v('bpc').toUpperCase() } }); toast('Billing details saved'); break;
    case 'set-pro': patchDoc('pros', S.proId, { name: v('name'), phone: v('phone'), bizType: v('bizType'), bizName: v('bizName'), home: v('home').toUpperCase() }); toast('Profile saved'); break;
    case 'set-payout': if (!/^\d{4}$/.test(v('last4'))) { toast('Enter the last 4 digits.'); return; } patchDoc('pros', S.proId, { payout: { holder: v('holder'), last4: v('last4'), ready: true, mode: 'test', at: now() } }); toast('Payout account saved'); break;
    case 'delete-request': var dcol = S.role === 'pro' ? 'pros' : 'clients', did = S.role === 'pro' ? S.proId : S.clientId; patchDoc(dcol, did, { deletion: { at: now(), reason: v('reason') } }); notify('admin', (myProfile().orgName || myProfile().name) + ' asked to close their ' + (S.role === 'pro' ? 'Pro' : 'client') + ' account'); audit('account.deletion_requested', S.role, did, v('reason') || 'No reason given'); toast('Request sent to LISTD'); break;
    case 'clock-out': if (cmdClockOut(j, (S.clockPhoto || {})[id + ':out'], v('breakMin'), v('notes'), v('exception'))) toast('Clocked out'); break;
    /* admin */
    case 'quote': var qd = readQuoteForm(f, j); if (qd.lines.some(function (l) { return !l.d; })) { toast('Every line needs a description.'); return; } if (cmdIssueQuote(j, JSON.parse(JSON.stringify(qd)))) { delete S.qd[id]; toast(qWord(j, true) + ' issued'); } break;
    case 'ask': cmdAskInfo(j, reason(f)); break;
    case 'offer': var ow = { date: v('date'), slot: v('slot') }, fee = toP(v('fee')), aq = acceptedQuote(j); if (cmdOffer(j, v('proId'), ow, fee)) { if (aq && fee !== aq.proFeeP) audit('offer.fee_change', 'job', id, 'Pro fee changed from quote', { fromP: aq.proFeeP, toP: fee }); toast('Offer sent'); } break;
    case 'revoke': cmdRevoke(j, reason(f)); break;
    case 'return': cmdReturnReport(j, reason(f)) && toast('Returned to Pro'); break;
    case 'att-ok': upd(j, { attendance: Object.assign({}, j.attendance, { review: 'EXCEPTION_APPROVED' }) }, 'Attendance exception approved: ' + reason(f), 'admin'); audit('attendance.exception_approve', 'job', id, reason(f)); break;
    case 'hold': cmdHold(j, reason(f)); break;
    case 'resume': cmdResume(j, reason(f)); break;
    case 'admin-cancel': cmdCancel(j, reason(f), toP(v('refund'))) && toast('Job cancelled'); break;
    case 'refund': if (!staffGuard('finance', 'issue refunds')) return; cmdRefund(j, toP(v('amount')), reason(f)) && toast('Refund issued (test)'); break;
    case 'hide-rating': upd(j, { rating: Object.assign({}, j.rating, { hidden: true, hiddenReason: reason(f) }) }, 'Rating hidden by LISTD', 'admin'); audit('rating.hide', 'job', id, reason(f)); break;
    case 'resolve': if (!staffGuard('disputes', 'resolve disputes')) return; cmdResolveDispute(j, v('outcome'), v('reason'), toP(v('refund')), toP(v('feeAdj'))) && toast('Dispute resolved'); break;
    case 'co-issue': cmdIssueCO(j, f.dataset.co, toP(v('total')), toP(v('fee'))) && toast('Sent to client'); break;
    case 'pro-review': if (!staffGuard('pros', 'review Pros')) return;
      var dec = e.submitter ? e.submitter.value : '', r = v('reason'), pr = D.pros[id], lv = Math.min(5, Math.max(1, +v('level') || proLevel(pr)));
      if (dec !== 'APPROVED' && !r) { toast('Give a reason so the Pro knows what to do.'); return; }
      if (dec === 'APPROVED' && pr.status === 'PENDING') { var gt = trainingGate(pr, lv); if (gt !== true) { toast(gt); return; } }
      var part = { status: dec, review: { decision: dec, reason: r, at: now() } }; if (dec === 'RESUBMIT' || dec === 'REJECTED') part.onboarding = Object.assign({}, pr.onboarding, { status: 'SUBMITTED' });
      if (dec === 'APPROVED' && pr.status === 'PENDING') { part.level = lv; part.levelOverride = null; part.levelHistory = (pr.levelHistory || []).concat([{ from: 0, to: lv, reason: 'Starting level on approval' + (r ? ': ' + r : ''), at: now() }]); }
      var ja = pendingApp(id, 'JOIN'); if (ja && pr.status === 'PENDING' && dec !== 'SUSPENDED') patchDoc('applications', ja.id, { status: dec === 'APPROVED' ? 'APPROVED' : dec === 'RESUBMIT' ? 'CHANGES' : 'REJECTED', decision: { by: ENV.uid || 'admin', reason: r || (dec === 'APPROVED' ? 'Approved at Level ' + lv : ''), at: now() } });
      patchDoc('pros', id, part); audit('pro.review', 'pro', id, r || 'Approved', { decision: dec, level: part.level }); notify('p:' + id, dec === 'APPROVED' ? (pr.status === 'SUSPENDED' ? 'Your account has been reinstated.' : 'You’re approved at Level ' + lv + ' (' + LEVEL_INFO[lv].name + '). Offers will appear on your dashboard.') : dec === 'SUSPENDED' ? 'Your account has been suspended.' : 'Your application needs attention: ' + r); toast('Saved'); break;
    case 'set-level': cmdSetLevel(id, +v('level'), v('reason')) && (toast('Level updated'), f.reset()); break;
    case 'app-decide': cmdDecideApp(id, (e.submitter && e.submitter.value) === 'APPROVE', v('reason')) && toast('Decision saved'); break;
    case 'apply-level': cmdApplyLevel(v('note')) && toast('Application sent to LISTD'); break;
    case 'training-done': if (!fd.get('confirm')) { toast('Confirm you’ve finished the training.'); return; } cmdCompleteTraining(id) && toast('Training completed'); break;
    case 'staff-invite': if (cmdStaffInvite(v('name'), v('email'), v('role'))) { S.modal = null; toast('Staff member added'); render(); } break;
    case 'staff-transfer': if (!fd.get('confirm')) { toast('Tick the box to confirm.'); return; } if (cmdStaffTransfer(S.modal.id)) { S.modal = null; toast('Ownership transferred'); render(); } break;
    case 'pro-invite': cmdInvitePro(v('first'), v('email')).then(function (r) { if (r) { S.modal = { type: 'invite', done: r }; render(); toast('Invitation created'); } }); break;
    case 'inv-create': var nj = cmdCreateInvoice(f); if (nj) { S.modal = null; toast('Invoice ' + invNo(D.jobs[nj.id], (D.jobs[nj.id].quotes || []).length) + ' sent to client'); render(); } break;
    case 'training-add': if (trainingAdd(fd)) { S.modal = null; toast('Training added'); render(); } break;
    case 'policies': if (!staffGuard('policies', 'change policies')) return;
      var g = {}, cur = settings().guide; Object.keys(cur).forEach(function (k) { g[k] = {}; Object.keys(cur[k]).forEach(function (fk) { g[k][fk] = fd.has('g_' + k + '_' + fk) ? toP(v('g_' + k + '_' + fk)) : cur[k][fk]; }); });
      var ns = { company: { name: v('coName') || 'LISTD Inventory', address: v('coAddr'), phone: v('coPhone'), email: v('coEmail') }, guide: g, quoteValidityDays: Math.max(1, +v('quoteValidityDays') || 7), offerValidityHours: Math.max(1, +v('offerValidityHours') || 12), reviewHours: Math.max(1, +v('reviewHours') || 48), rescheduleHours: Math.max(0, +v('rescheduleHours') || 24), proFeePct: Math.min(100, Math.max(0, +v('proFeePct') || 0)), repairCategories: v('repairCategories').split(',').map(function (x) { return x.trim(); }).filter(Boolean), levels: [1, 2, 3, 4, 5].map(function (k) { var r = lvRule(k); return { minJobs: fd.has('lv_' + k + '_jobs') ? Math.max(0, Math.round(+v('lv_' + k + '_jobs') || 0)) : r.minJobs, minRating: fd.has('lv_' + k + '_rating') ? Math.min(5, Math.max(0, +v('lv_' + k + '_rating') || 0)) : r.minRating, sharePct: fd.has('lv_' + k + '_share') ? Math.min(100, Math.max(0, +v('lv_' + k + '_share') || 0)) : r.sharePct }; }) };
      setDoc('settings', 'policy', ns); audit('policy.update', 'policy', 'policy', v('reason'), ns); toast('Policies saved'); f.querySelector('[name=reason]').value = ''; break;
  }
});

boot();
