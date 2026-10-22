/* ===================== Lifecycle commands (guarded transitions) ===================== */
function J(id) { return D.jobs[id]; }
function deny(msg) { toast(msg); return false; }
function upd(j, part, text, role) { if (text) part.history = hist(j, text, role); return patchDoc('jobs', j.id, part); }
function mine(j) { return (S.role === 'client' && j.clientId === S.clientId) || (S.role === 'pro' && j.proId === S.proId) || S.role === 'admin'; }
function replaceIn(arr, i, obj) { var a = (arr || []).slice(); a[i] = Object.assign({}, a[i], obj); return a; }

/* ---- request capture ---- */
function cmdSubmit(w) {
  var p = D.properties[w.propertyId]; if (!p || p.clientId !== S.clientId) return deny('Choose one of your properties.');
  if (w.type === 'MAINTENANCE' && !KINDS[w.kind]) return deny('Choose Repairs & Damages or Cleaning.');
  if (w.type !== 'MAINTENANCE') w.kind = null;
  var scope = Object.assign({}, w.scope); if (w.kind !== 'CLEANING') delete scope.clean;
  var base = w.type === 'CHECK_OUT' ? findBaseline(p.id) : null;
  var id = uid(), j = { ref: nextRef(), clientId: S.clientId, propertyId: p.id, district: district(p.postcode), type: w.type, kind: w.kind, scope: scope, window: { date: w.date, slot: w.slot },
    propSnapshot: { label: p.label, address: p.address, postcode: p.postcode, type: p.type, bedrooms: p.bedrooms, bathrooms: p.bathrooms, furnishing: p.furnishing },
    baselineId: base ? base.id : null, linkedId: w.linkedId || null, status: 'SUBMITTED', quotes: [], payments: [], refunds: [], offers: [], reports: [], disputes: [], changeOrders: [], info: [], createdAt: now(), updatedAt: now(),
    history: [{ at: now(), role: 'client', text: 'Request submitted' + (w.type === 'CHECK_OUT' ? (base ? '. Baseline: check-in ' + base.ref : '. No baseline check-in on record — comparison unavailable') : '') }] };
  (w.photoIds || []).forEach(function (eid) { patchDoc('evidence', eid, { jobId: id }); });
  setDoc('jobs', id, j); notify('admin', 'New ' + SVC[svcKey(j)].label + ' request ' + j.ref + ' to quote', id);
  return id;
}
function cmdAskInfo(j, q) { if (['SUBMITTED', 'NEEDS_INFORMATION', 'QUOTED'].indexOf(j.status) < 0) return deny('Clarification is only possible before payment.'); var info = (j.info || []).concat([{ at: now(), q: q, a: '' }]); upd(j, { status: 'NEEDS_INFORMATION', info: info }, 'LISTD asked: ' + q, 'admin'); audit('request.ask_info', 'job', j.id, q); notifyJob(j, 'client', j.ref + ': LISTD needs more information'); return true; }
function cmdRespond(j, a) { if (j.status !== 'NEEDS_INFORMATION') return false; var info = (j.info || []).slice(); info[info.length - 1] = Object.assign({}, info[info.length - 1], { a: a, aAt: now() }); upd(j, { status: 'SUBMITTED', info: info }, 'Client replied: ' + a, 'client'); notify('admin', j.ref + ': client replied', j.id); return true; }

/* ---- quotes and payment (test mode) ---- */
function cmdIssueQuote(j, q, reason) {
  if (['SUBMITTED', 'NEEDS_INFORMATION', 'QUOTED', 'AWAITING_PAYMENT'].indexOf(j.status) < 0) return deny('A quote can only be issued before payment.');
  if (paidP(j) > 0) return deny('Already paid. Use a change order for extra work.');
  var t = quoteTotal(q); if (t.total <= 0) return deny('The quote total must be more than £0.');
  if (q.proFeeP < 0 || q.proFeeP > t.total) return deny('The Pro fee must be between £0 and the client total.');
  var quotes = (j.quotes || []).map(function (x) { return (x.status === 'ISSUED' || x.status === 'ACCEPTED') ? Object.assign({}, x, { status: 'SUPERSEDED' }) : x; });
  var v = quotes.length + 1; quotes.push(Object.assign({}, q, { v: v, subP: t.sub, totalP: t.total, status: 'ISSUED', issuedAt: now(), expiresAt: addH(now(), (q.validDays || settings().quoteValidityDays) * 24) }));
  upd(j, { quotes: quotes, status: 'QUOTED' }, qWord(j, true) + ' v' + v + ' issued: ' + P(t.total), 'admin');
  audit('quote.issue', 'job', j.id, reason || 'Quote issued', { v: v, totalP: t.total, proFeeP: q.proFeeP }); notifyJob(j, 'client', j.ref + ': your ' + qWord(j) + ' is ready (' + P(t.total) + ')'); return true;
}
function cmdAcceptQuote(j) {
  var q = curQuote(j); if (!q || q.status !== 'ISSUED' || j.status !== 'QUOTED') return deny('This quote is no longer current.');
  if (hoursFrom(q.expiresAt) <= 0) return deny('This quote has expired. LISTD will reissue it.');
  var quotes = j.quotes.map(function (x) { return x.v === q.v ? Object.assign({}, x, { status: 'ACCEPTED', acceptedAt: now() }) : x; });
  upd(j, { quotes: quotes, status: 'AWAITING_PAYMENT' }, qWord(j, true) + ' v' + q.v + (isInv(j) ? ' approved' : ' accepted'), 'client'); return true;
}
function cmdRejectQuote(j, why) { var q = curQuote(j); if (!q || j.status !== 'QUOTED') return false; var quotes = j.quotes.map(function (x) { return x.v === q.v ? Object.assign({}, x, { status: 'REJECTED', reason: why }) : x; }); upd(j, { quotes: quotes, status: 'SUBMITTED' }, 'Quote v' + q.v + ' declined' + (why ? ': ' + why : ''), 'client'); notify('admin', j.ref + ': quote declined', j.id); return true; }
/* Simulated hosted checkout. One logical operation per quote version; repeat clicks never double-charge. */
function cmdPay(j, fail) {
  var q = acceptedQuote(j); if (!q || j.status !== 'AWAITING_PAYMENT') return deny('Nothing to pay right now.');
  if (hoursFrom(q.expiresAt) <= 0) return deny('This quote expired before payment. LISTD will reissue it.');
  var op = 'pay:' + j.id + ':q' + q.v, pays = (j.payments || []).slice();
  if (pays.some(function (p) { return p.op === op && p.status === 'SUCCEEDED'; })) return deny('Already paid.');
  pays.push({ id: uid(), op: op, quoteV: q.v, amountP: q.totalP, status: fail ? 'FAILED' : 'SUCCEEDED', ref: 'test_' + uid(), at: now() });
  if (fail) { upd(j, { payments: pays }, 'Test payment failed. Booking not confirmed', 'client'); return true; }
  upd(j, { payments: pays, status: 'READY_FOR_ASSIGNMENT', readyAt: now() }, 'Payment of ' + P(q.totalP) + ' confirmed (test mode)', 'client');
  notify('admin', j.ref + ': paid, ready to assign', j.id); return true;
}

/* ---- offers and schedule ---- */
function covers(pro, d) { var cov = (pro.coverage || []).map(function (x) { return String(x).toUpperCase().trim(); }).filter(Boolean); if (!cov.length) return false; d = String(d || '').toUpperCase(); return cov.some(function (c) { return d === c || (d.indexOf(c) === 0 && /^[A-Z]+$/.test(c) && /\d/.test(d.charAt(c.length))); }); }
function conflicts(proId, w, exceptId) { return list('jobs').filter(function (x) { return x.id !== exceptId && x.proId === proId && ['SCHEDULED', 'IN_PROGRESS'].indexOf(x.status) >= 0 && x.window && x.window.date === w.date && x.window.slot === w.slot; })[0] || null; }
function eligible(pro, j, w) {
  if (!pro) return 'No Pro selected';
  if (pro.status !== 'APPROVED') return 'Not approved';
  if ((pro.skills || []).indexOf(svcKey(j)) < 0) return 'Missing ' + SKILLS[svcKey(j)].label + ' skill';
  var need = requiredLevel(j); if (need && proLevel(pro) < need) return 'Needs Level ' + need + ' (' + LEVEL_INFO[need].name + ')';
  if (!covers(pro, j.district)) return 'Does not cover ' + j.district;
  var exp = (pro.docs || []).filter(function (d) { return d.expires && d.expires < new Date().toISOString().slice(0, 10); }); if (exp.length) return 'Expired document: ' + exp[0].type;
  var day = w && w.date ? new Date(w.date + 'T12:00:00').getDay() : null; if (day != null && pro.availability && pro.availability.days && pro.availability.days.indexOf(day) < 0) return 'Not available that day';
  if (w && conflicts(pro.id, w, j.id)) return 'Already booked in that window';
  return true;
}
function cmdOffer(j, proId, w, feeP) {
  if (j.status !== 'READY_FOR_ASSIGNMENT') return deny('Only paid jobs waiting for a Pro can be offered.');
  if (currentOffer(j)) return deny('There is already an open offer on this job.');
  var pro = D.pros[proId], ok = eligible(pro, j, w); if (ok !== true) return deny(ok);
  var start = winStart(w); if (start && hoursFrom(start) <= 0) return deny('Choose a future slot.');
  var exp = addH(now(), settings().offerValidityHours); if (start && start < exp) exp = start;
  var offers = (j.offers || []).concat([{ id: uid(), proId: proId, window: w, feeP: feeP, status: 'OFFERED', at: now(), expiresAt: exp }]);
  upd(j, { offers: offers }, 'Offered to ' + pro.name + ' for ' + winLabel(w), 'admin'); audit('offer.create', 'job', j.id, 'Offer to ' + pro.name, { feeP: feeP }); notify('p:' + proId, 'New job offer ' + j.ref + ' · ' + P(feeP), j.id); return true;
}
function cmdOfferReply(j, accept, reason) {
  var o = currentOffer(j), i = (j.offers || []).indexOf(o);
  if (!o || o.proId !== S.proId) return deny('This offer is no longer open.');
  if (hoursFrom(o.expiresAt) <= 0) { upd(j, { offers: replaceIn(j.offers, i, { status: 'EXPIRED' }) }, 'Offer to ' + D.pros[o.proId].name + ' expired', 'pro'); return deny('This offer has expired.'); }
  if (!accept) { upd(j, { offers: replaceIn(j.offers, i, { status: 'DECLINED', reason: reason || '', repliedAt: now() }) }, D.pros[o.proId].name + ' declined the offer' + (reason ? ': ' + reason : ''), 'pro'); notify('admin', j.ref + ': offer declined', j.id); return true; }
  var ok = eligible(D.pros[S.proId], j, o.window); if (ok !== true) return deny(ok);
  upd(j, { offers: replaceIn(j.offers, i, { status: 'ACCEPTED', repliedAt: now() }), proId: S.proId, window: o.window, status: 'SCHEDULED', scheduledAt: now(), agreedFeeP: o.feeP }, D.pros[S.proId].name + ' accepted. Scheduled for ' + winLabel(o.window), 'pro');
  notifyJob(j, 'client admin', j.ref + ': Pro confirmed for ' + winLabel(o.window)); return true;
}
function cmdRevoke(j, reason) {
  var o = currentOffer(j); if (o) { upd(j, { offers: replaceIn(j.offers, j.offers.indexOf(o), { status: 'REVOKED', reason: reason }) }, 'Offer revoked: ' + reason, 'admin'); notify('p:' + o.proId, j.ref + ': offer withdrawn', j.id); audit('offer.revoke', 'job', j.id, reason); return true; }
  if (j.status !== 'SCHEDULED') return deny('Reassignment after work starts needs a hold and handover.');
  var i = -1; (j.offers || []).forEach(function (x, k) { if (x.status === 'ACCEPTED') i = k; });
  var old = j.proId; upd(j, { offers: i >= 0 ? replaceIn(j.offers, i, { status: 'REVOKED', reason: reason }) : j.offers, proId: null, status: 'READY_FOR_ASSIGNMENT' }, 'Assignment revoked: ' + reason, 'admin');
  notify('p:' + old, j.ref + ': you were removed from this job', j.id); notifyJob(j, 'client', j.ref + ': LISTD is reassigning your Pro'); audit('assignment.revoke', 'job', j.id, reason); return true;
}
function cmdProposeChange(j, w, reason) {
  if (j.status !== 'SCHEDULED') return deny('Only scheduled jobs can be rescheduled.');
  var short = hoursFrom(winStart(j.window)) <= settings().rescheduleHours;
  var by = S.role, sc = { id: uid(), by: by, window: w, reason: reason, clientOk: by === 'client', proOk: by === 'pro', adminOk: !short || by === 'admin', short: short, status: 'PROPOSED', at: now() };
  if (by === 'admin') { sc.adminOk = true; }
  upd(j, { scheduleChange: sc }, ({ client: 'Client', pro: 'Pro', admin: 'LISTD' })[by] + ' proposed moving to ' + winLabel(w) + (short ? ' (short notice: LISTD review)' : ''), by);
  notifyJob(j, by === 'client' ? 'pro admin' : by === 'pro' ? 'client admin' : 'client pro', j.ref + ': reschedule proposed to ' + winLabel(w)); return true;
}
function cmdRespondChange(j, ok) {
  var sc = j.scheduleChange; if (!sc || sc.status !== 'PROPOSED') return false;
  if (!ok) { upd(j, { scheduleChange: Object.assign({}, sc, { status: 'DECLINED' }) }, 'Reschedule declined. Original slot stands', S.role); notifyJob(j, 'client pro admin', j.ref + ': reschedule declined'); return true; }
  var n = Object.assign({}, sc); if (S.role === 'client') n.clientOk = true; if (S.role === 'pro') n.proOk = true; if (S.role === 'admin') n.adminOk = true;
  if (n.clientOk && n.proOk && n.adminOk) {
    var c = conflicts(j.proId, n.window, j.id); if (c) return deny('The Pro is already booked in that window.');
    n.status = 'CONFIRMED'; upd(j, { scheduleChange: n, window: n.window }, 'Rescheduled to ' + winLabel(n.window), S.role); notifyJob(j, 'client pro', j.ref + ': rescheduled to ' + winLabel(n.window));
  } else upd(j, { scheduleChange: n }, ({ client: 'Client', pro: 'Pro', admin: 'LISTD' })[S.role] + ' agreed to the new slot', S.role);
  return true;
}

/* ---- attendance and reports ---- */
function cmdClockIn(j, photoId) { if (j.status !== 'SCHEDULED' || j.proId !== S.proId) return deny('You can only clock in to your own scheduled job.'); if (!photoId) return deny('Take an arrival photo to clock in.'); upd(j, { status: 'IN_PROGRESS', attendance: { inAt: now(), inPhoto: photoId }, reportDraft: j.reportDraft || newReport(j) }, 'Pro clocked in', 'pro'); notifyJob(j, 'client', j.ref + ': your Pro has arrived'); return true; }
function cmdClockOut(j, photoId, breakMin, notes, exceptionReason) {
  var a = j.attendance || {}; if (!a.inAt) return deny('Clock in first.'); if (a.outAt) return deny('Already clocked out.');
  if (!photoId && !exceptionReason) return deny('Add a completion photo, or give a reason it isn’t possible.');
  var mins = (Date.now() - new Date(a.inAt).getTime()) / 60000; breakMin = Math.max(0, +breakMin || 0); if (breakMin > mins) return deny('Breaks can’t be longer than the time on site (' + Math.floor(mins) + ' min).');
  upd(j, { attendance: Object.assign({}, a, { outAt: now(), outPhoto: photoId || null, breakMin: breakMin, notes: notes || '', exception: exceptionReason || '', review: exceptionReason ? 'EXCEPTION_PENDING' : 'OK' }) }, 'Pro clocked out' + (exceptionReason ? ' (photo exception: ' + exceptionReason + ')' : ''), 'pro'); return true;
}
function cmdSubmitReport(j) {
  if (['IN_PROGRESS', 'CORRECTION_REQUIRED'].indexOf(j.status) < 0 || j.proId !== S.proId) return deny('This report can’t be submitted now.');
  if (!(j.attendance && j.attendance.outAt)) return deny('Clock out before submitting the report.');
  var err = validateReport(j); if (err) return deny(err);
  var reps = (j.reports || []).slice(); reps.push({ v: reps.length + 1, sections: JSON.parse(JSON.stringify(S.drafts[j.id] || j.reportDraft)), status: 'SUBMITTED', submittedAt: now(), baselineId: j.baselineId || null, template: svcKey(j) + '-v1' });
  upd(j, { reports: reps, reportDraft: reps[reps.length - 1].sections, status: 'ADMIN_REVIEW' }, 'Report v' + reps.length + ' submitted for LISTD review', 'pro'); delete S.drafts[j.id];
  notify('admin', j.ref + ': report ready to review', j.id); return true;
}
function cmdReturnReport(j, reason) { if (j.status !== 'ADMIN_REVIEW') return false; var r = latestReport(j); upd(j, { reports: replaceIn(j.reports, j.reports.length - 1, { status: 'RETURNED', returnReason: reason }), status: 'CORRECTION_REQUIRED' }, 'Report v' + r.v + ' returned to Pro: ' + reason, 'admin'); audit('report.return', 'job', j.id, reason); notifyJob(j, 'pro', j.ref + ': report needs changes'); return true; }
function cmdReleaseReport(j, reason) {
  if (j.status !== 'ADMIN_REVIEW') return false;
  var due = addH(now(), settings().reviewHours), reps = j.reports.map(function (r, i) { return i === j.reports.length - 1 ? Object.assign({}, r, { status: 'RELEASED', releasedAt: now(), reviewDueAt: due }) : (r.status === 'RELEASED' ? Object.assign({}, r, { status: 'SUPERSEDED' }) : r); });
  upd(j, { reports: reps, status: 'CLIENT_REVIEW', reviewDueAt: due }, 'Report v' + reps[reps.length - 1].v + ' released to client. Review window ' + settings().reviewHours + 'h', 'admin');
  audit('report.release', 'job', j.id, reason || 'Report complete'); notifyJob(j, 'client', j.ref + ': your report is ready to review'); return true;
}
function cmdAcceptReport(j, mode) {
  if (j.status !== 'CLIENT_REVIEW') return deny('This report is not awaiting review.');
  if (openDispute(j)) return deny('Resolve the open dispute first.');
  var offers = (j.offers || []).map(function (o) { return o.status === 'ACCEPTED' ? Object.assign({}, o, { status: 'FINISHED' }) : o; });
  upd(j, { status: 'COMPLETED', offers: offers, completion: { mode: mode || 'EXPLICIT', at: now() }, reviewDueAt: null }, mode === 'AUTO' ? 'Auto-completed after the review window closed with no correction or dispute' : mode === 'ADMIN' ? 'Completed by LISTD' : 'Client accepted the report', mode === 'AUTO' ? 'admin' : S.role);
  notifyJob(j, 'pro admin', j.ref + ': completed'); return true;
}
function cmdCorrection(j, text) { if (j.status !== 'CLIENT_REVIEW') return false; upd(j, { status: 'CORRECTION_REQUIRED', reviewDueAt: null, corrections: (j.corrections || []).concat([{ at: now(), by: 'client', text: text }]) }, 'Client requested corrections: ' + text, 'client'); notifyJob(j, 'pro admin', j.ref + ': client requested corrections'); return true; }

/* ---- disputes, holds, cancellation, refunds, payouts ---- */
function cmdOpenDispute(j, cat, text, evIds) {
  if (openDispute(j)) return deny('A dispute is already open on this job.');
  var paidOut = j.settlement && j.settlement.status === 'PAID';
  var d = { id: uid(), by: S.role, category: cat, text: text, evidence: evIds || [], status: 'OPEN', responses: [], at: now(), postSettlement: !!paidOut };
  upd(j, { disputes: (j.disputes || []).concat([d]), reviewDueAt: j.status === 'CLIENT_REVIEW' ? null : j.reviewDueAt, reviewPausedAt: j.status === 'CLIENT_REVIEW' ? now() : null }, (S.role === 'pro' ? 'Pro' : 'Client') + ' opened a dispute (' + cat + ')' + (paidOut ? '. Payout already made; recorded as a complaint' : '. Payout frozen'), S.role);
  notifyJob(j, S.role === 'pro' ? 'client admin' : 'pro admin', j.ref + ': dispute opened'); return true;
}
function cmdDisputeRespond(j, text) { var d = openDispute(j); if (!d) return false; var ds = j.disputes.map(function (x) { return x.id === d.id ? Object.assign({}, x, { responses: x.responses.concat([{ by: S.role, text: text, at: now() }]), status: S.role === 'admin' ? 'INVESTIGATING' : x.status }) : x; }); upd(j, { disputes: ds }, ({ client: 'Client', pro: 'Pro', admin: 'LISTD' })[S.role] + ' responded to the dispute', S.role); return true; }
function cmdResolveDispute(j, outcome, reason, refundP, feeAdjP) {
  var d = openDispute(j); if (!d) return false; if (!reason) return deny('Record the reason for the outcome.');
  refundP = Math.max(0, refundP || 0); var avail = paidP(j) - refundedP(j);
  if ((outcome === 'PARTIAL_REFUND' || outcome === 'FULL_REFUND') && refundP <= 0) refundP = outcome === 'FULL_REFUND' ? avail : 0;
  if (refundP > avail) return deny('Refunds can’t exceed the ' + P(avail) + ' still captured.');
  var part = { disputes: j.disputes.map(function (x) { return x.id === d.id ? Object.assign({}, x, { status: 'RESOLVED', outcome: outcome, reason: reason, refundP: refundP, closedAt: now() }) : x; }) };
  if (refundP) part.refunds = (j.refunds || []).concat([{ id: uid(), amountP: refundP, reason: 'Dispute: ' + reason, status: 'SUCCEEDED', ref: 'test_rf_' + uid(), at: now(), disputeId: d.id }]);
  if (feeAdjP) part.feeAdjP = (j.feeAdjP || 0) - Math.abs(feeAdjP);
  if (outcome === 'REWORK') { part.status = 'CORRECTION_REQUIRED'; part.reviewDueAt = null; }
  if (outcome === 'CANCEL') part.status = 'CANCELLED';
  if (j.status === 'CLIENT_REVIEW' && outcome !== 'REWORK' && outcome !== 'CANCEL') part.reviewDueAt = addH(now(), settings().reviewHours);
  upd(j, part, 'Dispute resolved: ' + ({ NO_REFUND: 'no refund', PARTIAL_REFUND: 'partial refund ' + P(refundP), FULL_REFUND: 'full refund ' + P(refundP), REWORK: 'correction / rework required', CANCEL: 'cancelled' + (refundP ? ', refund ' + P(refundP) : '') })[outcome] + '. ' + reason, 'admin');
  audit('dispute.resolve', 'job', j.id, reason, { outcome: outcome, refundP: refundP, feeAdjP: feeAdjP || 0 }); notifyJob(j, 'client pro', j.ref + ': dispute resolved'); return true;
}
function cmdHold(j, reason) { var ok = ['SCHEDULED', 'IN_PROGRESS', 'ADMIN_REVIEW', 'CLIENT_REVIEW', 'CORRECTION_REQUIRED']; if (ok.indexOf(j.status) < 0) return deny('This job can’t be put on hold in its current state.'); upd(j, { status: 'ON_HOLD', resumeStatus: j.status, hold: { reason: reason, at: now() }, reviewDueAt: null }, 'Placed on hold: ' + reason, 'admin'); audit('job.hold', 'job', j.id, reason); notifyJob(j, 'client pro', j.ref + ': on hold'); return true; }
function cmdResume(j, reason) { if (j.status !== 'ON_HOLD') return false; var to = j.resumeStatus || 'SCHEDULED', part = { status: to, hold: null }; if (to === 'CLIENT_REVIEW') part.reviewDueAt = addH(now(), settings().reviewHours); upd(j, part, 'Resumed: ' + reason, 'admin'); audit('job.resume', 'job', j.id, reason); notifyJob(j, 'client pro', j.ref + ': resumed'); return true; }
function cmdCancel(j, reason, refundP) {
  if (j.status === 'COMPLETED' || j.status === 'CANCELLED') return deny('This job is closed.');
  var started = !!(j.attendance && j.attendance.inAt), part = { status: 'CANCELLED', cancel: { by: S.role, reason: reason, at: now() } };
  if (S.role === 'client' && started) return deny('Work has started. Send LISTD a cancellation request instead.');
  var avail = paidP(j) - refundedP(j); if (refundP == null) refundP = started ? 0 : avail;
  if (refundP > avail) return deny('Refund can’t exceed ' + P(avail) + '.');
  if (refundP > 0) part.refunds = (j.refunds || []).concat([{ id: uid(), amountP: refundP, reason: 'Cancellation: ' + reason, status: 'SUCCEEDED', ref: 'test_rf_' + uid(), at: now() }]);
  part.offers = (j.offers || []).map(function (o) { return o.status === 'OFFERED' || o.status === 'ACCEPTED' ? Object.assign({}, o, { status: 'REVOKED' }) : o; });
  part.quotes = (j.quotes || []).map(function (q) { return q.status === 'ISSUED' ? Object.assign({}, q, { status: 'SUPERSEDED' }) : q; });
  upd(j, part, 'Cancelled by ' + ({ client: 'client', admin: 'LISTD', pro: 'Pro' })[S.role] + ': ' + reason + (refundP ? '. Refund ' + P(refundP) + ' (test)' : ''), S.role);
  if (S.role === 'admin') audit('job.cancel', 'job', j.id, reason, { refundP: refundP }); notifyJob(j, 'client pro admin', j.ref + ': cancelled'); return true;
}
function cmdCancelRequest(j, reason) { upd(j, { cancelRequest: { by: S.role, reason: reason, at: now() } }, ({ client: 'Client', pro: 'Pro' })[S.role] + ' asked LISTD to cancel: ' + reason, S.role); notify('admin', j.ref + ': cancellation requested', j.id); return true; }
function cmdRefund(j, amountP, reason) { var avail = paidP(j) - refundedP(j); if (amountP <= 0 || amountP > avail) return deny('Refund must be between £0.01 and ' + P(avail) + '.'); if (!reason) return deny('Give a reason.'); upd(j, { refunds: (j.refunds || []).concat([{ id: uid(), amountP: amountP, reason: reason, status: 'SUCCEEDED', ref: 'test_rf_' + uid(), at: now() }]) }, 'Refund ' + P(amountP) + ' issued (test): ' + reason, 'admin'); audit('refund.create', 'job', j.id, reason, { amountP: amountP }); notifyJob(j, 'client', j.ref + ': refund of ' + P(amountP) + ' issued'); return true; }
function cmdReleasePayout(j) {
  var s = settlement(j); if (s.status !== 'ELIGIBLE') return deny('Not eligible: ' + (s.why || 'nothing payable'));
  var op = 'payout:' + j.id; if (j.settlement && j.settlement.op === op && j.settlement.status === 'PAID') return deny('Already paid.');
  upd(j, { settlement: { status: 'PAID', amountP: s.amountP, op: op, ref: 'test_tr_' + uid(), paidAt: now() } }, 'Pro payout ' + P(s.amountP) + ' transferred (test mode)', 'admin');
  audit('payout.release', 'job', j.id, 'Payout released', { amountP: s.amountP }); notifyJob(j, 'pro', j.ref + ': payout ' + P(s.amountP) + ' sent'); return true;
}

/* ---- change orders ---- */
function cmdProposeCO(j, desc, estP, evIds) { if (['IN_PROGRESS', 'SCHEDULED'].indexOf(j.status) < 0 || j.proId !== S.proId) return deny('Change orders can be proposed on your active job.'); upd(j, { changeOrders: (j.changeOrders || []).concat([{ id: uid(), desc: desc, estimateP: estP, evidence: evIds || [], status: 'PROPOSED', at: now() }]) }, 'Pro proposed extra work: ' + desc, 'pro'); notify('admin', j.ref + ': change order to price', j.id); return true; }
function cmdIssueCO(j, coId, totalP, feeP) { var i = (j.changeOrders || []).findIndex(function (c) { return c.id === coId; }); if (i < 0 || j.changeOrders[i].status !== 'PROPOSED') return false; if (totalP <= 0 || feeP < 0 || feeP > totalP) return deny('Check the price and Pro fee.'); upd(j, { changeOrders: replaceIn(j.changeOrders, i, { status: 'ISSUED', totalP: totalP, proFeeP: feeP, issuedAt: now() }) }, 'Change order priced at ' + P(totalP), 'admin'); audit('change_order.issue', 'job', j.id, j.changeOrders[i].desc, { totalP: totalP, feeP: feeP }); notifyJob(j, 'client', j.ref + ': extra work needs your approval'); return true; }
function cmdCOReply(j, coId, accept) {
  var i = (j.changeOrders || []).findIndex(function (c) { return c.id === coId; }), c = j.changeOrders[i]; if (!c || c.status !== 'ISSUED') return false;
  if (!accept) { upd(j, { changeOrders: replaceIn(j.changeOrders, i, { status: 'DECLINED' }) }, 'Client declined extra work. Original scope stands', 'client'); notifyJob(j, 'pro admin', j.ref + ': change order declined'); return true; }
  var op = 'pay:' + j.id + ':co' + coId; if ((j.payments || []).some(function (p) { return p.op === op && p.status === 'SUCCEEDED'; })) return deny('Already paid.');
  upd(j, { changeOrders: replaceIn(j.changeOrders, i, { status: 'PAID', paidAt: now() }), payments: (j.payments || []).concat([{ id: uid(), op: op, coId: coId, amountP: c.totalP, status: 'SUCCEEDED', ref: 'test_' + uid(), at: now() }]) }, 'Client approved and paid ' + P(c.totalP) + ' for extra work (test mode)', 'client');
  notifyJob(j, 'pro admin', j.ref + ': extra work approved — go ahead'); return true;
}

/* ---- ratings & messages ---- */
function cmdRate(j, score, text) { if (j.status !== 'COMPLETED' || j.rating) return deny('You can rate once, after completion.'); upd(j, { rating: { score: score, text: text || '', at: now(), hidden: false } }, 'Client rated the service ' + score + '/5', 'client'); return true; }
function cmdMessage(j, body) { if (!body.trim()) return false; setDoc('messages', uid(), { jobId: j.id, by: S.role, author: S.role === 'pro' ? S.proId : S.role === 'client' ? S.clientId : 'admin', body: body.trim(), at: now(), createdAt: now() }); notifyJob(j, S.role === 'client' ? 'pro admin' : S.role === 'pro' ? 'client admin' : 'client pro', j.ref + ': new message'); return true; }

/* ---- timed rules: offer expiry, quote expiry and review auto-completion ---- */
var sweeping = false;
function sweep() {
  if (sweeping || ENV.mode === 'connecting') return; sweeping = true;
  try {
    list('jobs').forEach(function (j) {
      var mineJ = S.role === 'admin' || (S.role === 'client' && j.clientId === S.clientId) || (S.role === 'pro' && ((j.offers || []).some(function (o) { return o.proId === S.proId; })));
      if (!mineJ) return;
      var o = currentOffer(j); if (o && hoursFrom(o.expiresAt) <= 0) { upd(j, { offers: replaceIn(j.offers, j.offers.indexOf(o), { status: 'EXPIRED' }) }, 'Offer to ' + (D.pros[o.proId] || {}).name + ' expired', 'admin'); return; }
      var q = curQuote(j);
      if (q && (j.status === 'QUOTED' || j.status === 'AWAITING_PAYMENT') && hoursFrom(q.expiresAt) <= 0 && !paidP(j)) { upd(j, { quotes: j.quotes.map(function (x) { return x.v === q.v ? Object.assign({}, x, { status: 'EXPIRED' }) : x; }), status: 'SUBMITTED' }, 'Quote v' + q.v + ' expired before payment. Awaiting reissue', 'admin'); notify('admin', j.ref + ': quote expired', j.id); return; }
      if (j.status === 'CLIENT_REVIEW' && j.reviewDueAt && hoursFrom(j.reviewDueAt) <= 0 && !openDispute(j)) cmdAcceptReport(j, 'AUTO');
    });
  } finally { sweeping = false; }
}
