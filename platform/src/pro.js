/* ===================== Pro portal ===================== */
function proNav() { return [['home', 'home', 'Dashboard'], ['offers', 'bell', 'Offers'], ['schedule', 'calendar', 'Schedule'], ['training', 'training', 'Training & level'], ['earnings', 'pound', 'Earnings'], ['settings', 'settings', 'Settings']]; }
function meP() { return D.pros[S.proId] || null; }
function proOnboarded() { var p = meP(); return p && p.onboarding && p.onboarding.status === 'SUBMITTED'; }
function myOffers() { return list('jobs').filter(function (j) { var o = currentOffer(j); return o && o.proId === S.proId && hoursFrom(o.expiresAt) > 0; }); }
function myWork() { return list('jobs').filter(function (j) { return j.proId === S.proId; }).sort(function (a, b) { return String((a.window || {}).date).localeCompare(String((b.window || {}).date)); }); }
var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DOCS = [['ID', 'Photo ID (passport or driving licence)', true], ['RTW', 'Right to work evidence', true], ['DBS', 'Basic DBS certificate', true], ['INSURANCE', 'Public liability insurance', false]];

/* ---------- onboarding ---------- */
var PR_STEPS = ['Account', 'Details', 'Skills & area', 'Availability', 'Documents', 'Payouts', 'Submit'];
function vProOnboard() {
  var p = meP(), step = p ? (p.onboarding.step || 2) : 1;
  var h = '<div class="a-page" style="max-width:780px"><div class="a-head"><div><h1>' + (p ? 'Finish your Pro application' : 'Join LISTD as a Pro') + '</h1><p>' + (p ? 'Progress is saved. You can come back any time.' : 'Inspectors, cleaners and maintenance Pros. Approved Pros receive job offers near them.') + '</p></div></div><div class="a-steps">' + PR_STEPS.map(function (s, i) { return '<span class="' + (i + 1 === step ? 'on' : i + 1 < step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('') + '</div>';
  var back = '<button class="ld-btn ld-btn-secondary" type="button" data-act="pob-back">Back</button>';
  if (step === 1) h += '<form class="a-card a-form" data-form="pr-ob1"><div class="two">' + field('pr-name', 'Full name', inp('pr-name', 'name', '', 'required autocomplete="name"')) + field('pr-email', 'Email', inp('pr-email', 'email', '', 'type="email" required autocomplete="email"')) + '</div><label class="ld-check"><input type="checkbox" name="terms" required><span>I agree to the LISTD Pro terms and privacy notice<small>Test mode placeholders.</small></span></label><div class="a-actions"><button class="ld-btn ld-btn-primary ld-btn-lg" type="submit">Create account & continue</button></div></form>';
  else if (step === 2) h += '<form class="a-card a-form" data-form="pr-ob2"><h3>About you</h3>' + field('pr-name', 'Full name', inp('pr-name', 'name', p.name, 'required autocomplete="name"'), 'As it appears on your photo ID.') + field('pr-bt', 'Working as', sel('pr-bt', 'bizType', [['sole', 'Sole trader / individual'], ['ltd', 'Limited company']], p.bizType || 'sole')) + field('pr-bn', 'Trading or company name <small>Optional for sole traders</small>', inp('pr-bn', 'bizName', p.bizName)) + '<div class="two">' + field('pr-ph', 'Phone', inp('pr-ph', 'phone', p.phone, 'type="tel" required')) + field('pr-pc', 'Home postcode', inp('pr-pc', 'home', p.home, 'required autocapitalize="characters"')) + '</div><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>';
  else if (step === 3) h += '<form class="a-card a-form" data-form="pr-ob3"><fieldset class="a-checks" style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Services you can deliver</legend>' + Object.keys(SKILLS).map(function (k) { return '<label class="ld-check"><input type="checkbox" name="skills" value="' + k + '"' + ((p.skills || []).indexOf(k) >= 0 ? ' checked' : '') + '><span>' + SKILLS[k].label + '</span></label>'; }).join('') + '</fieldset><p class="a-fine">Everyone starts at Level 1 (light cleans) and moves up by applying. Inspections open at Level 4, after the required training. Repairs are approved separately.</p>' + field('pr-cov', 'Postcode districts you cover', inp('pr-cov', 'coverage', (p.coverage || []).join(', '), 'required placeholder="BA1, BA2, BS"'), 'Separate with commas. An area like BS covers every BS district.') + '<div class="a-actions">' + back + '<button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>';
  else if (step === 4) { var av = p.availability || { days: [1, 2, 3, 4, 5], slots: ['morning', 'afternoon'] }; h += '<form class="a-card a-form" data-form="pr-ob4"><fieldset style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Days you usually work</legend><div class="a-row">' + DAYS.map(function (d, i) { return '<label class="ld-check" style="grid-template-columns:20px auto"><input type="checkbox" name="days" value="' + i + '"' + (av.days.indexOf(i) >= 0 ? ' checked' : '') + '><span>' + d + '</span></label>'; }).join('') + '</div></fieldset><fieldset style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Windows</legend><div class="a-row">' + Object.keys(WINDOWS).map(function (w) { return '<label class="ld-check" style="grid-template-columns:20px auto"><input type="checkbox" name="slots" value="' + w + '"' + (av.slots.indexOf(w) >= 0 ? ' checked' : '') + '><span>' + WINDOWS[w][0] + '</span></label>'; }).join('') + '</div></fieldset><div class="a-actions">' + back + '<button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>'; }
  else if (step === 5) {
    h += '<div class="a-card a-form"><h3>Verification documents</h3><p class="a-muted">Upload a clear photo or PDF of each. Only LISTD reviewers can see these; they never appear in service reports.</p>' + DOCS.map(function (d) { var have = (p.docs || []).filter(function (x) { return x.type === d[0]; })[0]; return '<div class="a-item" style="grid-template-columns:minmax(0,1fr) auto"><span class="nm">' + d[1] + (d[2] ? '' : ' <small class="a-fine">(needed for repairs)</small>') + (have ? '<br><span class="a-fine">' + ic('success', 14) + ' ' + esc(have.name) + (have.expires ? ' · expires ' + fdate(have.expires) : '') + '</span>' : '') + '</span>' + upBtn({ doc: d[0], allowPdf: true }, have ? 'Replace' : 'Upload', false) + '</div>'; }).join('') +
      field('pr-dexp', 'DBS or insurance expiry date <small>If applicable</small>', inp('pr-dexp', 'expires', (p.docs || []).reduce(function (a, d) { return a || d.expires; }, ''), 'type="date" data-docexp="1"')) + '<div class="a-actions">' + back + '<button class="ld-btn ld-btn-primary" data-act="pob-docs">Continue</button></div></div>';
  } else if (step === 6) h += '<form class="a-card a-form" data-form="pr-ob6"><h3>Payout account</h3><p class="a-muted">In the live product this opens the payment provider’s secure onboarding. In test mode, confirm the details below. Don’t enter real bank details.</p>' + field('pr-ah', 'Account holder name', inp('pr-ah', 'holder', (p.payout || {}).holder || p.name, 'required')) + field('pr-l4', 'Last 4 digits of account <small>Test value</small>', inp('pr-l4', 'last4', (p.payout || {}).last4, 'required inputmode="numeric" pattern="[0-9]{4}" maxlength="4"')) + '<div class="a-actions">' + back + '<button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>';
  else h += '<div class="a-card"><h3>Ready to submit</h3><dl class="a-kv"><dt>Name</dt><dd>' + esc(p.name) + '</dd><dt>Services</dt><dd>' + (p.skills || []).map(function (s) { return SKILLS[s].label; }).join(', ') + '</dd><dt>Coverage</dt><dd>' + esc((p.coverage || []).join(', ')) + '</dd><dt>Availability</dt><dd>' + (p.availability.days || []).map(function (d) { return DAYS[d]; }).join(', ') + '</dd><dt>Documents</dt><dd>' + (p.docs || []).length + ' uploaded</dd><dt>Payouts</dt><dd>Account ending ' + esc((p.payout || {}).last4) + ' (test)</dd></dl><label class="ld-check"><input type="checkbox" id="pob-terms"' + (p.consent && p.consent.terms ? ' checked' : '') + '><span>I agree to the LISTD Pro terms and privacy notice<small>Test mode: placeholders until legal terms are approved.</small></span></label><div class="a-actions">' + back + '<button class="ld-btn ld-btn-primary ld-btn-lg" data-act="pob-submit">Submit for review</button></div></div>';
  return h + '</div>';
}
function proStatusBanner(p) {
  if (p.status === 'PENDING') return banner('verified-pro', 'Application under review', 'LISTD is checking your documents. You’ll start receiving offers once approved.', '', 'warning');
  if (p.status === 'RESUBMIT' || p.status === 'REJECTED') return banner('warning', p.status === 'REJECTED' ? 'Application not approved' : 'Please update your application', esc(p.review && p.review.reason || ''), '<button class="ld-btn ld-btn-primary ld-btn-sm" data-act="pob-edit">Update application</button>', 'danger');
  if (p.status === 'SUSPENDED') return banner('lock', 'Account suspended', 'Contact LISTD to restore access.', '', 'danger');
  var exp = (p.docs || []).filter(function (d) { return d.expires && d.expires < new Date().toISOString().slice(0, 10); }); if (exp.length) return banner('warning', 'A document has expired', 'Upload a current ' + exp[0].type + ' to keep receiving offers.', '<button class="ld-btn ld-btn-secondary ld-btn-sm" data-go="settings" data-tab="documents">Update</button>', 'warning');
  return '';
}

/* ---------- views ---------- */
function vProHome() {
  var p = meP(), ps = proStats(p.id), offers = myOffers(), up = myWork().filter(function (j) { return ['SCHEDULED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'].indexOf(j.status) >= 0; });
  var h = '<div class="a-page"><div class="a-head"><div><h1>Hi, ' + esc(p.name.split(' ')[0]) + '</h1><p>' + (p.skills || []).map(function (s) { return SKILLS[s].label; }).join(' · ') + '</p></div></div>' + proStatusBanner(p);
  h += '<div class="a-grid k">' + stat('Open offers', offers.length) + stat('Upcoming jobs', up.length) + stat('Payable', P(ps.payable)) + stat('Paid to you', P(ps.paid)) + '</div>';
  if (offers.length) h += '<section class="a-sec"><h2>New offers</h2><div class="a-jobs">' + offers.map(function (j) { return jobRow(j, 'pro'); }).join('') + '</div></section>';
  h += '<section class="a-sec"><h2>Your schedule</h2>' + (up.length ? '<div class="a-jobs">' + up.map(function (j) { return jobRow(j, 'pro'); }).join('') + '</div>' : empty('calendar', 'Nothing scheduled', p.status === 'APPROVED' ? 'Offers from LISTD appear on your dashboard. Accept one to add it here.' : 'You’ll receive offers once approved.', '')) + '</section>';
  h += '<div class="a-card"><div class="a-row sb"><div>' + levelBar(ps.level, ps.levelName) + '<p class="a-fine" style="margin-top:6px">' + ps.completed + ' completed jobs · ' + esc(LEVEL_INFO[ps.level].unlocks) + '</p><button type="button" class="ld-btn ld-btn-secondary ld-btn-sm" data-go="training" style="margin-top:8px">' + (ps.level < 5 ? 'How to reach Level ' + (ps.level + 1) : 'Training & level') + '</button></div><div class="a-fine">' + stars(ps.rating || 0) + ' ' + (ps.ratings ? ps.rating.toFixed(1) + ' from ' + ps.ratings + ' rating' + (ps.ratings > 1 ? 's' : '') : 'No ratings yet') + '</div></div></div>';
  return h + '</div>';
}
function vProOffers() { var o = myOffers(); return '<div class="a-page"><div class="a-head"><div><h1>Offers</h1><p>Each offer shows your fee, scope and slot. Accept before it expires.</p></div></div>' + proStatusBanner(meP()) + (o.length ? '<div class="a-jobs">' + o.map(function (j) { return jobRow(j, 'pro'); }).join('') + '</div>' : empty('bell', 'No open offers', 'LISTD offers you jobs that match your skills, area and availability.', '')) + '</div>'; }
function vProSchedule() {
  var w = myWork(), up = w.filter(function (j) { return OPEN_STATES.indexOf(j.status) >= 0; }), past = w.filter(function (j) { return OPEN_STATES.indexOf(j.status) < 0; }).reverse();
  var byDay = {}; up.forEach(function (j) { (byDay[j.window.date] = byDay[j.window.date] || []).push(j); });
  return '<div class="a-page"><div class="a-head"><div><h1>Schedule</h1></div></div>' + (up.length ? Object.keys(byDay).sort().map(function (d) { return '<section class="a-sec"><h2>' + fdate(d) + ' · ' + DAYS[new Date(d + 'T12:00').getDay()] + '</h2><div class="a-jobs">' + byDay[d].map(function (j) { return jobRow(j, 'pro'); }).join('') + '</div></section>'; }).join('') : empty('calendar', 'Nothing scheduled', 'Accepted jobs appear here by day.', '')) + (past.length ? '<section class="a-sec"><h2>Past jobs</h2><div class="a-jobs">' + past.map(function (j) { return jobRow(j, 'pro'); }).join('') + '</div></section>' : '') + '</div>';
}
function vProEarnings() {
  var ps = proStats(S.proId), w = myWork().filter(function (j) { return settlement(j).status !== 'NONE'; });
  return '<div class="a-page"><div class="a-head"><div><h1>Earnings</h1><p>Your agreed fee per job. Payable once the job is completed with no open dispute. Test mode: transfers are simulated.</p></div></div><div class="a-grid k">' + stat('Paid', P(ps.paid)) + stat('Payable', P(ps.payable)) + stat('Pending completion', P(ps.pending)) + '</div>' +
    (w.length ? '<div class="a-tw"><table><thead><tr><th>Ref</th><th>Service</th><th>Date</th><th>Status</th><th class="r">Fee</th></tr></thead><tbody>' + w.map(function (j) { var s = settlement(j); return '<tr class="click" data-act="open-job" data-id="' + j.id + '"><td class="num">' + esc(j.ref) + '</td><td>' + esc(SVC[svcKey(j)].label) + '</td><td>' + fdate(j.window.date) + '</td><td>' + badge({ PAID: 'Paid ' + fdate(s.paidAt), ELIGIBLE: 'Payable', BLOCKED: s.why }[s.status], s.status === 'PAID' ? 'success' : s.status === 'ELIGIBLE' ? 'brand' : 'warning') + '</td><td class="r">' + P(s.amountP) + '</td></tr>'; }).join('') + '</tbody></table></div>' : empty('pound', 'No earnings yet', 'Complete your first job to see it here.', '')) + '</div>';
}
function vProAccount() {
  var p = meP();
  return '<div class="a-page" style="max-width:780px"><div class="a-head"><div><h1>Profile</h1></div></div><div class="a-card"><div class="a-row">' + avatar(p.name, p.status === 'APPROVED', 'lg') + '<div><h3>' + esc(p.name) + '</h3><span class="a-muted">' + esc(p.email) + '</span></div>' + badge({ APPROVED: 'Approved', PENDING: 'Under review', RESUBMIT: 'Changes requested', REJECTED: 'Not approved', SUSPENDED: 'Suspended', DRAFT: 'Draft' }[p.status], p.status === 'APPROVED' ? 'success' : 'warning') + '</div>' + proStatusBanner(p) + '</div>' +
    '<form class="a-card a-form" data-form="pro-profile"><h3>Services & coverage</h3><fieldset class="a-checks" style="border:0;padding:0;margin:0"><legend class="sr-only">Services</legend>' + Object.keys(SKILLS).map(function (k) { return '<label class="ld-check"><input type="checkbox" name="skills" value="' + k + '"' + ((p.skills || []).indexOf(k) >= 0 ? ' checked' : '') + '><span>' + SKILLS[k].label + '</span></label>'; }).join('') + '</fieldset>' + field('pp-cov', 'Postcode districts', inp('pp-cov', 'coverage', (p.coverage || []).join(', '))) + '<fieldset style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Working days</legend><div class="a-row">' + DAYS.map(function (d, i) { return '<label class="ld-check" style="grid-template-columns:20px auto"><input type="checkbox" name="days" value="' + i + '"' + (((p.availability || {}).days || []).indexOf(i) >= 0 ? ' checked' : '') + '><span>' + d + '</span></label>'; }).join('') + '</div></fieldset><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save</button></div></form>' +
    '<div class="a-card a-form"><h3>Documents</h3>' + DOCS.map(function (d) { var have = (p.docs || []).filter(function (x) { return x.type === d[0]; })[0]; return '<div class="a-item" style="grid-template-columns:minmax(0,1fr) auto"><span class="nm">' + d[1] + (have ? '<br><span class="a-fine">' + esc(have.name) + (have.expires ? ' · expires ' + fdate(have.expires) : '') + '</span>' : '<br><span class="a-fine">Not uploaded</span>') + '</span>' + upBtn({ doc: d[0], allowPdf: true }, have ? 'Replace' : 'Upload', false) + '</div>'; }).join('') + '</div>' + signOutCard() + '</div>';
}

/* ---------- job panels ---------- */
function proPanels(j) {
  var h = '', o = currentOffer(j), p = meP();
  if (o && o.proId === S.proId) {
    var ok = eligible(p, j, o.window);
    h += banner('pound', 'Offer: ' + P(o.feeP) + ' for ' + winLabel(o.window), 'Expires ' + fdate(o.expiresAt, true) + ' (' + left(o.expiresAt) + '). Duration about ' + Math.round(((acceptedQuote(j) || {}).durationMin || 60) / 6) / 10 + ' hours.' + (ok !== true ? '<br><b>' + esc(ok) + '</b>' : ''), (ok === true ? '<button class="ld-btn ld-btn-primary" data-act="offer-yes" data-id="' + j.id + '">Accept job</button>' : '') + '<button class="ld-btn ld-btn-secondary" data-act="offer-no" data-id="' + j.id + '">Decline</button>', 'brand');
  }
  if (j.proId !== S.proId) return h;
  if (j.status === 'SCHEDULED') {
    var sel_ = S.clockPhoto && S.clockPhoto[j.id] ? D.evidence[S.clockPhoto[j.id]] : null;
    h += '<div class="a-card a-form" style="border-color:var(--brand)"><h3>' + ic('location', 18) + ' Clock in when you arrive</h3><p class="a-muted">Scheduled ' + winLabel(j.window) + '. Take an arrival photo of the property, then clock in.</p>' + photoGrid(sel_ ? [sel_] : []) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'ATTEND', area: 'clock-in', clock: 'in' }, sel_ ? 'Retake arrival photo' : 'Take arrival photo', false) + '<button class="ld-btn ld-btn-primary" data-act="clock-in" data-id="' + j.id + '"' + (sel_ ? '' : ' disabled') + '>Clock in</button></div></div>';
    h += '<div class="a-actions"><button class="ld-btn ld-btn-secondary ld-btn-sm" data-act="resched" data-id="' + j.id + '">Request a new time</button>' + (j.cancelRequest ? '' : '<button class="ld-btn ld-btn-ghost ld-btn-sm" data-act="cancel-req" data-id="' + j.id + '">Can’t attend</button>') + '</div>';
  }
  h += schedChangePanel(j);
  if (j.status === 'CORRECTION_REQUIRED') { var r = latestReport(j), cr = (j.corrections || []).slice(-1)[0]; h += banner('edit', 'Corrections needed', esc((r && r.returnReason) || (cr && cr.text) || ''), '', 'danger'); }
  if (j.status === 'ADMIN_REVIEW') h += banner('clock', 'Report with LISTD for review', 'You’ll be told if anything needs changing.', '');
  if (j.status === 'CLIENT_REVIEW') h += banner('clock', 'Report released to the client', 'Review window closes ' + fdate(j.reviewDueAt, true) + '.', '');
  if (j.status === 'COMPLETED') { var s = settlement(j); h += banner('success', 'Completed', s.status === 'PAID' ? 'Payout of ' + P(s.amountP) + ' sent ' + fdate(s.paidAt, true) + ' (test).' : s.status === 'ELIGIBLE' ? P(s.amountP) + ' is payable. LISTD releases payouts.' : 'Payout on hold: ' + esc(s.why), '', 'success') + (j.rating && !j.rating.hidden ? '<div class="a-card"><h3>Client rating</h3><p>' + stars(j.rating.score) + (j.rating.text ? ' “' + esc(j.rating.text) + '”' : '') + '</p></div>' : ''); }
  if (j.status === 'ON_HOLD') h += banner('warning', 'On hold', esc(j.hold.reason), '', 'warning');
  if (!openDispute(j) && ['IN_PROGRESS', 'CLIENT_REVIEW', 'COMPLETED', 'CORRECTION_REQUIRED', 'ADMIN_REVIEW'].indexOf(j.status) >= 0) h += '<div class="a-actions"><button class="ld-btn ld-btn-ghost ld-btn-sm" data-act="dispute" data-id="' + j.id + '">Raise an issue with LISTD</button></div>';
  return h;
}
function draftOf(j) {
  if (!S.drafts[j.id]) {
    var src = j.reportDraft || newReport(j);
    if (isInspection(j) && !src.v3) { src = upgradeInspection(j, src); S.drafts[j.id] = src; saveDraft(j.id); return src; }
    S.drafts[j.id] = JSON.parse(JSON.stringify(src));
  }
  return S.drafts[j.id];
}
/* Drafts started in an earlier report format are upgraded to the LISTD Inventory format, keeping any notes already written. */
function upgradeInspection(j, old) {
  var t = newReport(j), notes = {}, nk = function (x) { return String(x).toUpperCase().replace(/&|AND/g, '').replace(/[^A-Z0-9]/g, ''); };
  (old.rooms || []).forEach(function (rm) { (rm.items || []).forEach(function (it) { var n = it.condNote || it.note || ''; if (n || it.desc) notes[nk(rm.name) + '|' + nk(it.name)] = it; }); });
  t.rooms.forEach(function (rm) { rm.items.forEach(function (it) { var o = notes[nk(rm.name) + '|' + nk(it.name)]; if (o) { it.desc = o.desc || ''; it.condNote = o.condNote || o.note || ''; it.find = o.find || ''; } }); });
  var m = old.meters || {}; if (!Array.isArray(m)) { if (m.gas) t.meters[0].reading = m.gas; if (m.electricity) t.meters[1].reading = m.electricity; if (m.water) t.meters[2].reading = m.water; }
  if (typeof old.keys === 'string' && old.keys) t.keys[0].desc = old.keys;
  if (old.summary) t.summary = old.summary;
  return t;
}
var saveT = {};
function saveDraft(id) { clearTimeout(saveT[id]); saveT[id] = setTimeout(function () { var d = S.drafts[id]; if (d) patchDoc('jobs', id, { reportDraft: JSON.parse(JSON.stringify(d)) }); }, 800); }
function setPath(o, path, v) { var ks = path.split('.'), x = o; for (var i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; }
function rf(j, path, val, label, opts) { var id = 'rf-' + path.replace(/\./g, '-'); return field(id, label, (opts && opts.area ? '<div class="ld-control ld-control-area"><textarea class="ld-input" id="' + id + '" rows="2" data-rf="' + path + '" data-id="' + j.id + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>' + esc(val) + '</textarea></div>' : '<div class="ld-control"><input class="ld-input" id="' + id + '" data-rf="' + path + '" data-id="' + j.id + '" value="' + esc(val) + '"' + (opts && opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '></div>')); }

function proWorkBlock(j) {
  var k = svcKey(j), r = draftOf(j), all = evFor({ jobId: j.id }), a = j.attendance || {}, h = '<div class="a-sec"><h2>Report<span class="a-fine">Saved automatically</span></h2>';
  if (k === 'CHECK_IN' || k === 'CHECK_OUT') {
    h += inspEditor(j);
  } else if (k === 'CLEANING') {
    h += '<div class="a-card"><h3>' + CLEANS[j.scope.clean].label + ' checklist</h3><p class="a-fine">Tick each item, or say why it doesn’t apply.</p>' + r.checklist.map(function (c, i) { return '<div class="a-ck" style="flex-wrap:wrap"><input type="checkbox" id="ck-' + i + '" data-ck="' + i + '" data-id="' + j.id + '"' + (c.done ? ' checked' : '') + '><label for="ck-' + i + '" style="flex:1">' + esc(c.t) + '</label>' + (!c.done ? '<input class="ld-input a-note" style="flex-basis:100%" id="na-' + i + '" data-rf="checklist.' + i + '.na" data-id="' + j.id + '" placeholder="Not applicable because…" value="' + esc(c.na) + '" aria-label="Reason not applicable: ' + esc(c.t) + '">' : '') + '</div>'; }).join('') + '</div>' +
      '<div class="a-card a-form"><h3>Before & after photos</h3>' + photoGrid(all.filter(function (e) { return e.stage === 'BEFORE' || e.stage === 'AFTER'; })) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'BEFORE', area: 'clean' }, 'Add before photos') + upBtn({ jobId: j.id, stage: 'AFTER', area: 'clean' }, 'Add after photos') + '</div>' + rf(j, 'exclusions', r.exclusions, 'Exclusions', { area: 1 }) + rf(j, 'issues', r.issues, 'Remaining issues', { area: 1 }) + '</div>';
  } else {
    h += '<div class="a-card a-form"><h3>Repair record</h3>' + rf(j, 'diagnosis', r.diagnosis, 'Diagnosis', { area: 1 }) + rf(j, 'work', r.work, 'Work carried out (authorised scope only)', { area: 1 }) + rf(j, 'materials', r.materials, 'Materials used') + rf(j, 'tests', r.tests, 'Tests done', { ph: 'e.g. ran tap 5 min, no leak' }) + rf(j, 'unresolved', r.unresolved, 'Unresolved issues', { area: 1 }) + photoGrid(all.filter(function (e) { return e.stage === 'BEFORE' || e.stage === 'AFTER'; })) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'BEFORE', area: 'repair' }, 'Add before photos') + upBtn({ jobId: j.id, stage: 'AFTER', area: 'repair' }, 'Add after photos') + '</div></div>';
    h += '<div class="a-actions"><button class="ld-btn ld-btn-secondary ld-btn-sm" data-act="co-propose" data-id="' + j.id + '">Propose extra work</button><button class="ld-btn ld-btn-danger ld-btn-sm" data-act="unsafe" data-id="' + j.id + '">Stop: unsafe to continue</button></div>';
  }
  if (!isInspection(j)) h += '<div class="a-card a-form">' + rf(j, 'summary', r.summary, 'Summary for the client', { area: 1, ph: 'Overall condition and anything that needs attention' }) + '</div>';
  if (!a.outAt) {
    var op = S.clockPhoto && S.clockPhoto[j.id + ':out'] ? D.evidence[S.clockPhoto[j.id + ':out']] : null;
    h += '<form class="a-card a-form" data-form="clock-out" data-id="' + j.id + '"><h3>Clock out</h3><p class="a-muted">On site since ' + fdate(a.inAt, true) + '.</p>' + photoGrid(op ? [op] : []) + '<div class="a-row">' + upBtn({ jobId: j.id, stage: 'ATTEND', area: 'clock-out', clock: 'out' }, op ? 'Retake completion photo' : 'Take completion photo', false) + '</div><div class="two">' + field('co-br', 'Break minutes', inp('co-br', 'breakMin', '0', 'type="number" min="0"')) + field('co-ex', 'No photo possible? Reason <small>Reviewed by LISTD</small>', inp('co-ex', 'exception', '')) + '</div>' + field('co-nt', 'Notes', area('co-nt', 'notes', '', 'rows="2"')) + '<div class="a-actions"><button class="ld-btn ld-btn-secondary" type="submit">Clock out</button></div></form>';
  } else h += '<div class="a-card"><p>' + ic('success', 18) + ' Clocked out ' + fdate(a.outAt, true) + '</p></div>';
  h += '<div class="a-actions"><button class="ld-btn ld-btn-primary ld-btn-lg" data-act="submit-report" data-id="' + j.id + '"' + (a.outAt ? '' : ' disabled') + '>' + ic('signature', 18) + 'Submit report</button>' + (a.outAt ? '' : '<span class="a-fine">Clock out to submit.</span>') + '</div>';
  return h + '</div>';
}
function validateReport(j) {
  var k = svcKey(j), r = draftOf(j), all = evFor({ jobId: j.id });
  if (k === 'CHECK_IN' || k === 'CHECK_OUT') {
    return inspValidate(j);
  } else if (k === 'CLEANING') {
    var miss = r.checklist.filter(function (c) { return !c.done && !String(c.na || '').trim(); }); if (miss.length) return 'Tick or give a reason for every checklist item (' + miss.length + ' left).';
    if (!all.some(function (e) { return e.stage === 'BEFORE'; })) return 'Add at least one before photo.';
    if (!all.some(function (e) { return e.stage === 'AFTER'; })) return 'Add at least one after photo.';
  } else {
    if (!String(r.diagnosis || '').trim()) return 'Add your diagnosis.';
    if (!String(r.work || '').trim()) return 'Describe the work carried out.';
    if (!all.some(function (e) { return e.stage === 'BEFORE'; })) return 'Add at least one before photo.';
    if (!all.some(function (e) { return e.stage === 'AFTER'; })) return 'Add at least one after photo.';
  }
  if (!String(r.summary || '').trim()) return 'Add a summary for the client.';
  return null;
}
function signOutCard() { return securityCard(); }
