/* ===================== Pricing (pilot framework, 24 Oct 2026) =====================
   One service standard. Clients pay for the service, its complexity (once) and urgency (separately).
   Inspections: fixed rate card by size + one furnishing adjustment + clearly explained room adjustments.
   Maintenance: cleaning is estimated, then quoted; repairs are a fixed task price or a paid diagnosis.
   Pro pay comes from workload, then the selling price is checked against a contribution floor.
   All figures are pilot prices to test, editable by the Main admin under Pricing. Money is in pence. */
var SIZE_LABEL = ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', '4 bedrooms'];
var SCHED = {
  /* Flex (−£10 for flexible dates) was removed on 25 Oct 2026; older bookings may still show it */
  flex: { label: 'Flex (no longer offered)', promise: '', tag: '' },
  standard: { label: 'Standard', promise: 'Any date more than two working days ahead.', tag: 'Base price' },
  priority: { label: 'Priority', promise: 'Any date within two working days, subject to a confirmed Pro. Applied automatically from the date.', tag: '+£30' }
};
var FURNISH = { unfurnished: 'Unfurnished', part: 'Part-furnished', furnished: 'Normally furnished', heavy: 'Heavily furnished or very detailed' };
/* when each report or completion record is due after the visit; Priority speeds up the appointment, not the report */
var REPORT_DUE = { INVENTORY: 'Report within 2 working days of the visit', CHECK_IN: 'Report within 1 working day of the visit', MID_TERM: 'Report within 2 working days of the visit', CHECK_OUT: 'Report within 2 working days of the visit', CLEANING: 'Before-and-after photos on the day', REPAIRS_DAMAGES: 'Completion photos and notes on the day' };
var CLEAN_ADDONS = { oven: 'Oven clean', fridge: 'Fridge and freezer inside', cupboards: 'Inside cupboards', carpets: 'Carpet clean (per room)', windowsOut: 'Exterior windows' };
var DEFAULT_PRICING = {
  area: 'Bristol',
  rates: { INVENTORY: [8500, 10000, 12000, 14000, 16000], CHECK_IN: [6000, 6000, 6500, 7000, 7500], COMBO: [11000, 12500, 14500, 16500, 18500], CHECK_OUT: [7500, 9000, 11000, 13000, 15000], MID_TERM: [6000, 6500, 7500, 8500, 9500] },
  furnish: { part: 1000, furnishedSmall: 2000, furnishedLarge: 3000 },
  extraRoomP: 1000, outbuildingP: 1500, outdoorP: 1500,
  sched: { flexOffP: 1000, priorityP: 3000, priorityProP: 2000, flexDays: 5, standardDays: 2, priorityDays: 2, flexOpen: false, priorityOpen: true },
  floor: { minP: 2500, pct: 25 },
  costs: { payPct: 1.5, payFixedP: 20, opsP: 500, reworkPct: 3 },
  pro: { attendP: 1000, furnishSharePct: 50, rateByLevel: [1400, 1500, 1600, 2000, 2200], minutes: { INVENTORY: [75, 30], CHECK_IN: [45, 5], CHECK_IN_COMBO: [40, 5], MID_TERM: [45, 10], CHECK_OUT: [65, 25] } },
  clean: { hourP: 2600, consumablesP: 800, kitP: 500, spreadPct: 15, hours: { standard: [1.5, 0.75, 0.5], deep: [3, 1.5, 1], eot: [3.5, 1.5, 1] }, officeM2PerHour: 60, officeMinH: 2, cond: { 'vacant-tidy': 1, 'vacant-dirty': 1.25, occupied: 1.1 }, minP: { standard: 6000, deep: 11000, eot: 12000, office: 6000 }, addons: { oven: 3500, fridge: 1500, cupboards: 2000, carpets: 2500 }, addonH: { oven: 1, fridge: 0.5, cupboards: 0.75, carpets: 0.75 } },
  repairs: { diagnosisP: 5000, diagnosisProP: 2500, labourProPct: 75 },
  rebate: { tier1: 10, pct: 5, tier2: 25 },
  taxPct: 0
};
function pricing() { var s = (D.settings || {}).pricing || {}, d = DEFAULT_PRICING, o = {}; Object.keys(d).forEach(function (k) { o[k] = s[k] == null ? d[k] : (typeof d[k] === 'object' && !Array.isArray(d[k]) ? Object.assign({}, d[k], s[k]) : s[k]); }); return o; }
function pounds(p) { return '£' + Math.round(p / 100); }
function sizeIdx(beds) { beds = Math.max(0, Math.round(+beds || 0)); return beds >= 5 ? -1 : beds; }
function sizeLabel(beds) { var i = sizeIdx(beds); return i < 0 ? '5+ bedrooms' : SIZE_LABEL[i]; }
/* working days (Mon–Fri) */
function isoDay(d) { return d.toISOString().slice(0, 10); }
function addWorkDays(from, n) { var d = new Date((from || isoDay(new Date())) + 'T12:00:00'); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return isoDay(d); }
function workDaysUntil(date, from) { if (!date) return 0; var a = new Date((from || isoDay(new Date())) + 'T12:00:00'), b = new Date(date + 'T12:00:00'), n = 0; while (a < b) { a.setDate(a.getDate() + 1); if (a.getDay() % 6) n++; } return n; }
/* the date decides the scheduling option: within priorityDays working days is Priority, later is Standard */
function schedForDate(date, from) { return date && workDaysUntil(date, from) <= pricing().sched.priorityDays ? 'priority' : 'standard'; }
function schedWindowOk(mode, dates, from) {
  var pr = pricing().sched; dates = (dates || []).filter(Boolean);
  if (mode === 'flex') return 'Flex scheduling is no longer offered. Choose Standard or Priority.';
  if (!dates.length) return 'Choose a date.';
  var wd = workDaysUntil(dates[0], from);
  if (mode === 'priority') { if (!pr.priorityOpen) return 'Priority isn’t available right now.'; if (wd < 1 || wd > pr.priorityDays) return 'Priority appointments are within ' + pr.priorityDays + ' working days.'; return true; }
  if (wd <= pr.priorityDays) return 'Dates within ' + pr.priorityDays + ' working days are Priority bookings.'; return true;
}
function L(d, u, tag, q) { return { d: d, q: q || 1, u: Math.round(u), tag: tag || 'svc' }; }
function schedLine(mode) { var s = pricing().sched; return mode === 'priority' ? L('Priority appointment (within ' + s.priorityDays + ' working days)', s.priorityP, 'urgency') : null; }
function furnishAdj(furn, beds) { var f = pricing().furnish; if (furn === 'part') return f.part; if (furn === 'furnished') return (+beds || 0) >= 3 ? f.furnishedLarge : f.furnishedSmall; return 0; }
/* expected internal floor area for a size; much larger properties are reviewed before pricing */
function areaUnusual(prop) { var a = +prop.area || 0, b = Math.max(0, +prop.bedrooms || 0); return a > 0 && a > (40 + 30 * b) * 1.5; }
function proRate(level) { var r = pricing().pro.rateByLevel; return r[Math.min(5, Math.max(1, level || 4)) - 1]; }
function minutesFor(key, beds) { var m = pricing().pro.minutes[key] || [60, 10]; return m[0] + m[1] * Math.max(0, +beds || 0); }
/* Pro fees are rounded to the nearest 50p so every offer reads as a clean figure */
function feeFromBase(b, level) { if (!b) return 0; return Math.round(((b.attendP || 0) + (b.minutes || 0) / 60 * proRate(level || b.level) + (b.allowP || 0)) / 50) * 50; }
/* how a Pro fee is built, line by line, for the Pro and for LISTD */
function feeParts(b, level) {
  if (!b) return []; level = level || b.level; var r = proRate(level), out = [], m = b.minutes || 0;
  if (b.attendP) out.push([b.kitOnly ? 'Kit allowance' : 'Attendance allowance', b.attendP]);
  if (m) out.push(['Expected time: ' + ((m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? m % 60 + 'm' : '')).trim() + ' at ' + P(r) + '/h (Level ' + level + ')', Math.round(m / 60 * r)]);
  (b.allow || []).forEach(function (a) { out.push([a[0], a[1]]); });
  if (!b.allow && b.allowP) out.push(['Complexity and urgency allowances', b.allowP]);
  var sum = out.reduce(function (a, x) { return a + x[1]; }, 0), fee = feeFromBase(b, level); if (fee !== sum) out.push(['Rounding to the nearest 50p', fee - sum]);
  return out;
}

/* ---- inspections ---- */
function priceInspection(k, prop, o) {
  o = o || {}; var pr = pricing(), beds = +prop.bedrooms || 0, i = sizeIdx(beds), lines = [], why = [];
  if (i < 0) why.push('5+ bedrooms are quoted individually');
  if (prop.furnishing === 'heavy') why.push('heavily furnished or very detailed inventories are quoted individually');
  if (areaUnusual(prop)) why.push('the floor area is large for the bedroom count, so LISTD reviews it first');
  if (why.length) return { custom: why.join('; ') };
  var combo = o.combo === 'INVENTORY', comboCI = o.combo === 'CHECK_IN', label = { INVENTORY: 'Inventory & Condition', CHECK_IN: 'Check-in handover', MID_TERM: 'Mid-term inspection', CHECK_OUT: 'Check-out' }[k];
  /* same visit: the Inventory + Check-in price is split as two positive lines (inventory part + standalone check-in) */
  if (combo) lines.push(L(label + ' · ' + SIZE_LABEL[i] + ' · same visit as the check-in (Inventory + Check-in ' + pounds(pr.rates.COMBO[i]) + ' together)', pr.rates.COMBO[i] - pr.rates.CHECK_IN[i]));
  else if (comboCI) lines.push(L(label + ' · ' + SIZE_LABEL[i] + ' · same visit as the inventory', pr.rates[k][i]));
  else lines.push(L(label + ' · ' + SIZE_LABEL[i], pr.rates[k][i]));
  var allow = 0, items = [], extra = Math.max(0, (+prop.bathrooms || 1) - 1) + Math.max(0, (+prop.kitchens || 1) - 1) + Math.max(0, +prop.receptions || 0);
  if (!comboCI) {
    var fa = furnishAdj(prop.furnishing, beds); if (fa) { lines.push(L('Furnishing: ' + FURNISH[prop.furnishing].toLowerCase(), fa)); allow += fa * pr.pro.furnishSharePct / 100; items.push(['Furnishing allowance (' + FURNISH[prop.furnishing].toLowerCase() + ')', Math.round(fa * pr.pro.furnishSharePct / 100)]); }
    if (extra) { lines.push(L('Additional bathroom, kitchen or reception room', pr.extraRoomP, 'svc', extra)); allow += extra * pr.extraRoomP / 2; items.push(['Extra rooms allowance (' + extra + ')', Math.round(extra * pr.extraRoomP / 2)]); }
    if (prop.outbuildings) { lines.push(L('Outbuildings', pr.outbuildingP)); allow += pr.outbuildingP / 2; items.push(['Outbuildings allowance', Math.round(pr.outbuildingP / 2)]); }
    if (prop.outdoor) { lines.push(L('Extensive outdoor areas', pr.outdoorP)); allow += pr.outdoorP / 2; items.push(['Outdoor areas allowance', Math.round(pr.outdoorP / 2)]); }
    var sl = schedLine(o.sched); if (sl) { lines.push(sl); if (o.sched === 'priority') { allow += pr.sched.priorityProP; items.push(['Priority allowance', pr.sched.priorityProP]); } }
  }
  var mins = minutesFor(comboCI ? 'CHECK_IN_COMBO' : k, beds);
  return { lines: lines, proBase: { attendP: comboCI ? 0 : pr.pro.attendP, minutes: mins, allowP: Math.round(allow), allow: items, level: 4 }, durationMin: Math.round(mins / 15) * 15, why: '' };
}

/* ---- cleaning: preliminary estimate, then a fixed approved quote ---- */
function cleanIncl(t) { return ({ standard: [], deep: ['oven', 'fridge', 'cupboards'], eot: ['oven', 'fridge', 'cupboards'], office: [] })[t] || []; }
function cleanHours(prop, sc) {
  var c = pricing().clean, t = sc.clean || 'standard', h;
  if (t === 'office') h = Math.max(c.officeMinH, (+sc.areaM2 || +prop.area || 120) / c.officeM2PerHour);
  else { var m = c.hours[t] || c.hours.standard; h = m[0] + m[1] * Math.max(0, +prop.bedrooms || 0) + m[2] * Math.max(0, (+prop.bathrooms || 1) - 1); h *= c.cond[sc.condition] || 1; }
  (sc.addons || []).forEach(function (a) { if (c.addonH[a] && cleanIncl(t).indexOf(a) < 0) h += c.addonH[a] * (a === 'carpets' ? Math.max(1, +sc.carpetRooms || 1) : 1); });
  return Math.round(h * 4) / 4;
}
function priceCleaning(prop, sc, o) {
  o = o || {}; var c = pricing().clean, t = sc.clean || 'standard', ty = CLEANS[t] || CLEANS.standard, h = cleanHours(prop, sc), lines = [];
  var labour = Math.max(c.minP[t] || 6000, Math.round(h * c.hourP));
  lines.push(L(ty.label + ' · ' + (t === 'office' ? (+sc.areaM2 || +prop.area || 120) + ' m²' : sizeLabel(prop.bedrooms)) + ' · about ' + h + ' cleaner-hours', labour));
  lines.push(L('Equipment and consumables', c.consumablesP));
  (sc.addons || []).forEach(function (a) { if (cleanIncl(t).indexOf(a) >= 0) return; if (a === 'windowsOut') return; var n = a === 'carpets' ? Math.max(1, +sc.carpetRooms || 1) : 1; lines.push(L(CLEAN_ADDONS[a], c.addons[a], 'svc', n)); });
  var sl = schedLine(o.sched); if (sl) lines.push(sl);
  var sub = lines.reduce(function (a, l) { return a + l.q * l.u; }, 0), sp = c.spreadPct / 100;
  return { lines: lines, hours: h, estLowP: Math.floor(sub * (1 - sp) / 500) * 500, estHighP: Math.ceil(sub * (1 + sp) / 500) * 500, needsQuote: (sc.addons || []).indexOf('windowsOut') >= 0 || t === 'office',
    proBase: { attendP: c.kitP, kitOnly: true, minutes: Math.round(h * 60), allowP: o.sched === 'priority' ? pricing().sched.priorityProP : 0, allow: o.sched === 'priority' ? [['Priority allowance', pricing().sched.priorityProP]] : [], level: t === 'deep' ? 3 : t === 'standard' ? 1 : 2 }, durationMin: Math.round(h * 60 / 15) * 15 };
}

/* ---- repairs: fixed task price where the scope is known; a paid diagnosis where it isn't ---- */
function priceDiagnosis() { var r = pricing().repairs; return { lines: [L('Diagnostic visit: find the cause and price the repair. Credited against the repair if you go ahead', r.diagnosisP)], proFeeP: r.diagnosisProP, durationMin: 60 }; }
function repairProFee(lines) { var pct = pricing().repairs.labourProPct / 100; return Math.round(lines.reduce(function (a, l) { var v = l.q * l.u; return a + (/^materials/i.test(l.d) || l.tag === 'materials' ? v : l.tag === 'urgency' ? pricing().sched.priorityProP : l.tag === 'sched' ? 0 : v * pct); }, 0)); }

/* ---- contribution: what is left after direct delivery costs (excluding tax) ---- */
function contribution(revP, proP) {
  var c = pricing().costs, f = pricing().floor, pay = Math.round(revP * c.payPct / 100 + c.payFixedP), rw = Math.round(revP * c.reworkPct / 100), costs = pay + c.opsP + rw, v = revP - proP - costs, floorP = Math.max(f.minP, Math.round(revP * f.pct / 100));
  return { revP: revP, proP: proP, payP: pay, opsP: c.opsP, reworkP: rw, costsP: costs, contribP: v, pct: revP ? v / revP * 100 : 0, floorP: floorP, ok: v >= floorP };
}
function contribBox(revP, proP, note) {
  var x = contribution(revP, proP);
  return '<div class="a-summary"><div class="line"><span>Service revenue (excl. tax)</span><b>' + P(x.revP) + '</b></div><div class="line"><span>Pro fee</span><b>' + P(-x.proP) + '</b></div><div class="line"><span>Payment, operations and rework allowance</span><b>' + P(-x.costsP) + '</b></div><div class="line tot"><span>Job contribution</span><span>' + P(x.contribP) + ' · ' + Math.round(x.pct * 10) / 10 + '%</span></div><div class="line"><span>Floor (' + pounds(pricing().floor.minP) + ' or ' + pricing().floor.pct + '%, whichever is higher)</span><b>' + (x.ok ? badge('Above floor', 'success') : badge('Below floor', 'danger')) + '</b></div>' + (note ? '<p class="a-fine">' + note + '</p>' : '') + '</div>';
}

/* ---- portfolio pricing: earned by completed eligible jobs in a calendar month ---- */
function monthKey(iso) { return String(iso || now()).slice(0, 7); }
function eligibleFeeP(q) { if (!q) return 0; return (q.lines || []).reduce(function (a, l) { return a + (l.tag === 'urgency' || l.tag === 'materials' || l.tag === 'credit' || /^materials/i.test(l.d) ? 0 : Math.round(l.q * l.u)); }, 0); }
function completedAt(j) { var h = (j.history || []).filter(function (x) { return /completed|signed off|approved the report|auto-complete/i.test(x.text); }).slice(-1)[0]; return j.completedAt || (h && h.at) || j.updatedAt; }
function portfolio(clientId, mk) {
  mk = mk || monthKey(); var r = pricing().rebate, c = D.clients[clientId] || {};
  var jobs = list('jobs').filter(function (j) { return j.clientId === clientId && j.status === 'COMPLETED' && monthKey(completedAt(j)) === mk; });
  var elig = 0, cap = 0; jobs.forEach(function (j) { var q = acceptedQuote(j); if (!q) return; var e = eligibleFeeP(q); elig += e; var x = contribution(q.subP, proFeeP(j)); cap += Math.max(0, Math.min(Math.round(e * r.pct / 100), x.contribP - x.floorP)); });
  var n = jobs.length, tier = n >= r.tier2 ? 'negotiated' : n >= r.tier1 ? 'rebate' : 'standard';
  var paid = (c.rebates || []).filter(function (x) { return x.month === mk; }).reduce(function (a, x) { return a + x.amountP; }, 0);
  return { month: mk, count: n, tier: tier, eligibleP: elig, rebateP: tier === 'rebate' ? cap : 0, paidP: paid, jobs: jobs, toNext: tier === 'standard' ? r.tier1 - n : tier === 'rebate' ? r.tier2 - n : 0 };
}
/* negotiated portfolio rate (25+ jobs a month): a percentage off eligible service fees, never below the contribution floor */
function portfolioLine(clientId, lines, proP) {
  var c = D.clients[clientId] || {}, pct = +c.portfolioPct || 0; if (!pct) return null;
  var elig = lines.reduce(function (a, l) { return a + (l.tag === 'svc' ? l.q * l.u : 0); }, 0), sub = lines.reduce(function (a, l) { return a + l.q * l.u; }, 0), x = contribution(sub, proP);
  var off = Math.min(Math.round(elig * pct / 100), Math.max(0, x.contribP - x.floorP)); return off > 0 ? L('Portfolio rate (' + pct + '% agreed)', -off, 'portfolio') : null;
}

/* ---- the quote for a job: used for instant inspection quotes and to prefill the Admin quote builder ---- */
function quoteFor(j) {
  var p = Object.assign({}, D.properties[j.propertyId] || {}, j.propSnapshot || {}), k = svcKey(j), sc = j.scope || {}, r;
  if (isInspK(k)) { r = priceInspection(k, p, { combo: sc.sameVisit ? (k === 'INVENTORY' ? 'INVENTORY' : k === 'CHECK_IN' ? 'CHECK_IN' : null) : null, sched: sc.sched }); if (r.custom) return { custom: r.custom, lines: [L(SVC[k].label + ' · ' + sizeLabel(p.bedrooms) + ' (custom quote)', 0)], proFeeP: 0, durationMin: 120 }; }
  else if (k === 'CLEANING') r = priceCleaning(p, sc, { sched: sc.sched });
  else if (sc.repairMode === 'diagnose') return Object.assign({ diagnosis: true }, priceDiagnosis());
  else { var sl = schedLine(sc.sched); return { lines: [L('Labour: ' + (sc.category || 'repair'), 0), L('Materials', 0, 'materials')].concat(sl ? [sl] : []), proFeeP: 0, durationMin: 120, custom: 'priced from the damage assessed' }; }
  var fee = feeFromBase(r.proBase), pl = portfolioLine(j.clientId, r.lines, fee); if (pl) r.lines.push(pl);
  return { lines: r.lines, proBase: r.proBase, proFeeP: fee, durationMin: r.durationMin, estLowP: r.estLowP, estHighP: r.estHighP, needsQuote: r.needsQuote };
}
function withTax(q) { var t = pricing().taxPct; if (!t) return q; var sub = q.lines.reduce(function (a, l) { return a + Math.round(l.q * l.u); }, 0); return Object.assign(q, { taxP: Math.round(sub * t / 100), taxNote: 'VAT ' + t + '%' }); }
/* instant fixed quote for inspections and diagnosis visits. Custom cases wait for LISTD. */
function cmdAutoQuote(j) {
  var k = svcKey(j); if (!(isInspK(k) || (k === 'REPAIRS_DAMAGES' && (j.scope || {}).repairMode === 'diagnose'))) return false;
  var r = quoteFor(j); if (r.custom) { upd(j, {}, 'LISTD will confirm the price: ' + r.custom, 'system'); return false; }
  var q = withTax({ lines: r.lines, taxP: 0, taxNote: '', discP: 0, proFeeP: r.proFeeP, proBase: r.proBase || null, durationMin: r.durationMin, exclusions: '', validDays: settings().quoteValidityDays, auto: true });
  var t = quoteTotal(q), quotes = [Object.assign({}, q, { v: 1, subP: t.sub, totalP: t.total, status: 'ISSUED', issuedAt: now(), expiresAt: addH(now(), q.validDays * 24) })];
  upd(j, { quotes: quotes, status: 'QUOTED' }, qWord(j, true) + ' v1 issued from the LISTD rate card: ' + P(t.total), 'system');
  notifyJob(j, 'client', j.ref + ': your fixed ' + qWord(j) + ' is ready (' + P(t.total) + ')'); return true;
}

/* ---- client-facing price preview in the request wizard ---- */
function wizPreview(w, p) {
  var rows = [], fixed = 0, est = [0, 0], same = wizHas(w, 'INVENTORY') && wizHas(w, 'CHECK_IN') && w.scope.sameVisit !== false;
  w.services.forEach(function (k) {
    var fake = { propertyId: p.id, propSnapshot: p, type: svcType(k), kind: svcType(k) === 'MAINTENANCE' ? k : null, clientId: S.clientId, scope: Object.assign({}, w.scope, { sched: w.sched, sameVisit: same && (k === 'INVENTORY' || k === 'CHECK_IN') }) }, r = quoteFor(fake);
    var sub = (r.lines || []).reduce(function (a, l) { return a + Math.round(l.q * l.u); }, 0), tax = pricing().taxPct ? Math.round(sub * pricing().taxPct / 100) : 0;
    if (k === 'CLEANING') { est[0] += r.estLowP; est[1] += r.estHighP; rows.push({ k: k, txt: 'Estimate ' + P(r.estLowP) + '–' + P(r.estHighP), note: 'Fixed quote before you pay' + (r.needsQuote ? '. Office and exterior-window cleans are always quoted' : ''), lines: r.lines }); }
    else if (k === 'REPAIRS_DAMAGES') rows.push({ k: k, txt: r.diagnosis ? P(sub + tax) + ' diagnostic visit' : 'Fixed price after assessment', note: r.diagnosis ? 'Credited against the repair if you go ahead. Extra work always needs your approval first' : 'An itemised invoice to approve before the repair is booked', lines: r.diagnosis ? r.lines : [] });
    else if (r.custom) rows.push({ k: k, txt: 'LISTD confirms the price', note: r.custom.charAt(0).toUpperCase() + r.custom.slice(1), lines: [] });
    else { fixed += sub + tax; rows.push({ k: k, txt: P(sub + tax), note: REPORT_DUE[k] + (tax ? '. Includes VAT' : ''), lines: r.lines }); }
    if (r.diagnosis) fixed += sub + tax;
  });
  return { rows: rows, fixedP: fixed, est: est, same: same };
}
function previewTable(pv) {
  return '<div class="a-tw a-fit"><table class="a-pv"><thead><tr><th>Service</th><th class="r">Price</th></tr></thead><tbody>' + pv.rows.map(function (r) {
    return '<tr><td>' + svcTag({ type: svcType(r.k), kind: r.k }) + (r.lines.length ? '<div class="a-pvl">' + r.lines.map(function (l) { return '<span>' + esc(l.d) + (l.q !== 1 ? ' × ' + l.q : '') + '</span><span class="num">' + P(Math.round(l.q * l.u)) + '</span>'; }).join('') + '</div>' : '') + '<div class="a-fine">' + esc(r.note) + '</div></td><td class="r nw"><b>' + esc(r.txt) + '</b></td></tr>';
  }).join('') + (pv.fixedP ? '<tr><td><b>Fixed now</b>' + (pv.est[1] ? '<div class="a-fine">Plus cleaning, quoted before you pay</div>' : '') + '</td><td class="r"><b>' + P(pv.fixedP) + '</b></td></tr>' : '') + '</tbody></table></div>';
}

/* ---- pilot measures (Admin › Pricing) ---- */
function svcGroup(j) { var k = svcKey(j); return isInspK(k) ? 'Inspections' : k === 'CLEANING' ? 'Cleaning' : 'Repairs'; }
function pilotStats() {
  var jobs = list('jobs'), g = {}, qs = { issued: 0, acc: 0, rej: 0, exp: 0, reasons: {} }, of = { acc: 0, dec: 0, exp: 0 }, pri = { n: 0, ok: 0 }, flex = { n: 0, saveP: 0 }, corr = 0, disp = 0, perClient = {};
  ['Inspections', 'Cleaning', 'Repairs'].forEach(function (k) { g[k] = { n: 0, revP: 0, contribP: 0, below: 0, mins: 0, expMins: 0, timed: 0 }; });
  jobs.forEach(function (j) {
    (j.quotes || []).forEach(function (q) { if (q.status === 'SUPERSEDED') return; qs.issued++; if (q.status === 'ACCEPTED') qs.acc++; if (q.status === 'REJECTED') { qs.rej++; var r = (q.reason || 'No reason given').trim(); qs.reasons[r] = (qs.reasons[r] || 0) + 1; } if (q.status === 'EXPIRED' || (q.status === 'ISSUED' && hoursFrom(q.expiresAt) <= 0)) qs.exp++; });
    (j.offers || []).forEach(function (o) { if (o.status === 'ACCEPTED') of.acc++; else if (o.status === 'DECLINED') of.dec++; else if (o.status === 'EXPIRED') of.exp++; });
    if (paidP(j) > 0) perClient[j.clientId] = (perClient[j.clientId] || 0) + 1;
    var sc = j.scope || {}, aq = acceptedQuote(j);
    if (sc.sched === 'priority' && paidP(j) > 0) { pri.n++; if (j.window && j.window.date && workDaysUntil(j.window.date, String(j.createdAt).slice(0, 10)) <= pricing().sched.priorityDays && j.proId) pri.ok++; }
    if (sc.sched === 'flex' && aq) { flex.n++; flex.saveP += pricing().sched.flexOffP; }
    if ((j.history || []).some(function (h) { return /correction/i.test(h.text); })) corr++;
    disp += (j.disputes || []).length;
    if (!aq || !paidP(j)) return;
    var G = g[svcGroup(j)], x = contribution(aq.subP, proFeeP(j)); G.n++; G.revP += aq.subP; G.contribP += x.contribP; if (!x.ok) G.below++;
    var a = j.attendance || {}; if (a.inAt && a.outAt) { G.timed++; G.mins += (new Date(a.outAt) - new Date(a.inAt)) / 60000 - (+a.breakMin || 0); G.expMins += aq.durationMin || 0; }
  });
  var cl = Object.keys(perClient); return { g: g, qs: qs, of: of, pri: pri, flex: flex, corr: corr, disp: disp, clients: cl.length, repeat: cl.filter(function (c) { return perClient[c] > 1; }).length };
}
function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; }
function vAdminPricing() {
  var pr = pricing(), st = pilotStats(), n = function (name, v, step, a) { return '<input class="a-mini num" type="number" min="' + (a == null ? 0 : a) + '" step="' + (step || 1) + '" name="' + name + '" id="pr-' + name + '" value="' + v + '" aria-label="' + name + '">'; }, gp = function (name, p) { return n(name, (p / 100).toFixed(2), 0.01, -1000); };
  var h = '<div class="a-page"><div class="a-head"><div><h1>Pricing</h1><p>Pilot prices for ' + esc(pr.area) + ': one service standard, one complexity adjustment, urgency priced separately. Replace the assumptions with real results as the pilot runs.</p></div></div>';
  h += '<section class="a-sec"><h2>Pilot measures</h2><div class="a-grid k">' + stat('Quote acceptance', pct(st.qs.acc, st.qs.acc + st.qs.rej + st.qs.exp)) + stat('Pro offer acceptance', pct(st.of.acc, st.of.acc + st.of.dec + st.of.exp)) + stat('Priority fulfilled', st.pri.n ? st.pri.ok + ' of ' + st.pri.n : '—') + stat('Repeat clients', st.clients ? st.repeat + ' of ' + st.clients : '—') + '</div>' +
    '<div class="a-tw"><table><thead><tr><th>Service group</th><th class="r">Paid jobs</th><th class="r">Revenue (excl. tax)</th><th class="r">Contribution</th><th class="r">Avg %</th><th class="r">Below floor</th><th class="r">Actual vs expected time</th></tr></thead><tbody>' + Object.keys(st.g).map(function (k) { var x = st.g[k]; return '<tr><td><b>' + k + '</b></td><td class="r num">' + x.n + '</td><td class="r">' + P(x.revP) + '</td><td class="r">' + P(x.contribP) + '</td><td class="r num">' + (x.revP ? Math.round(x.contribP / x.revP * 1000) / 10 + '%' : '—') + '</td><td class="r num">' + (x.below ? '<b style="color:var(--danger)">' + x.below + '</b>' : 0) + '</td><td class="r num">' + (x.timed ? Math.round(x.mins / x.timed) + ' / ' + Math.round(x.expMins / x.timed) + ' min' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<div class="a-grid two-col"><div class="a-card"><h3>Quote outcomes</h3><p class="a-fine">' + st.qs.issued + ' issued · ' + st.qs.acc + ' accepted · ' + st.qs.rej + ' declined · ' + st.qs.exp + ' expired</p>' + (Object.keys(st.qs.reasons).length ? '<ul class="a-list">' + Object.keys(st.qs.reasons).sort(function (a, b) { return st.qs.reasons[b] - st.qs.reasons[a]; }).slice(0, 6).map(function (r) { return '<li>' + esc(r) + ' <span class="a-fine">× ' + st.qs.reasons[r] + '</span></li>'; }).join('') + '</ul>' : '<p class="a-muted">No declined quotes yet.</p>') + '</div><div class="a-card"><h3>Quality and scheduling</h3><dl class="a-kv"><dt>Corrections</dt><dd>' + st.corr + ' jobs</dd><dt>Complaints and disputes</dt><dd>' + st.disp + '</dd><dt>Priority bookings</dt><dd>' + st.pri.n + '</dd></dl><p class="a-fine">Review inspections, cleaning and repairs separately. Change rates where actual effort exceeds assumptions.</p></div></div></section>';
  var mk = monthKey(), cls = list('clients').map(function (c) { return [c, portfolio(c.id, mk)]; }).filter(function (x) { return x[1].count; });
  h += '<section class="a-sec"><h2>Portfolio pricing · ' + MON[+mk.slice(5) - 1] + ' ' + mk.slice(0, 4) + '</h2><p class="a-fine">1–' + (pr.rebate.tier1 - 1) + ' completed jobs: standard prices. ' + pr.rebate.tier1 + '–' + (pr.rebate.tier2 - 1) + ': up to ' + pr.rebate.pct + '% rebate on eligible service fees (not materials, exceptional travel or urgency premiums). ' + pr.rebate.tier2 + '+: a negotiated rate, set on the client below. Rebates never cut Pro pay or take a job below the contribution floor.</p>' +
    (cls.length ? '<div class="a-tw"><table><thead><tr><th>Client</th><th class="r">Completed</th><th>Tier</th><th class="r">Eligible fees</th><th class="r">Rebate due</th><th class="r">Recorded</th><th></th></tr></thead><tbody>' + cls.map(function (x) { var c = x[0], p = x[1], due = Math.max(0, p.rebateP - p.paidP); return '<tr><td><b>' + esc(c.orgName || c.name) + '</b></td><td class="r num">' + p.count + '</td><td>' + badge({ standard: 'Standard', rebate: 'Rebate', negotiated: 'Negotiated' }[p.tier], p.tier === 'standard' ? '' : 'brand') + '</td><td class="r">' + P(p.eligibleP) + '</td><td class="r">' + P(p.rebateP) + '</td><td class="r">' + P(p.paidP) + '</td><td class="r">' + (due > 0 ? '<button class="ld-btn ld-btn-secondary ld-btn-sm" data-act="rebate" data-id="' + c.id + '" data-m="' + mk + '" data-p="' + due + '">Record ' + P(due) + ' rebate</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : empty('pound', 'No completed jobs this month', 'Clients appear here as their jobs complete.', '')) + '</section>';
  /* rate card editor */
  var R = pr.rates, main = isMainAdmin(), ph = pricePhone(), locked = !main || !ph;
  h += '<section class="a-sec"><h2>Prices</h2>' + (!main ? banner('lock', 'Only the Main admin can change prices', 'You can see the current prices. Ask the Main admin if something needs to change.', '', 'brand') : !ph ? banner('lock', 'Confirm a phone before changing prices', 'Price changes need a 6-digit code sent to the Main admin’s mobile number. Add it in My settings › Account.', '', 'warning') : '') + (main && !ph ? '<div class="a-actions"><button type="button" class="ld-btn ld-btn-secondary" data-go="settings" data-sec="account">' + ic('user', 18) + 'Add your mobile number</button></div>' : '') + '</section>';
  h += '<form class="a-card a-form" data-form="pricing"><fieldset class="a-fs"' + (locked ? ' disabled' : '') + '><h3>Inspection rate card <small class="a-fine">Standard scheduling, unfurnished, ordinary properties in the service area</small></h3><div class="a-tw"><table class="a-pg"><thead><tr><th>Size</th><th>Inventory &amp; Condition</th><th>Standalone check-in</th><th>Inventory + check-in, same visit</th><th>Mid-term</th><th>Check-out</th></tr></thead><tbody>' + SIZE_LABEL.map(function (s, i) { return '<tr><td class="sub">' + s + '</td>' + ['INVENTORY', 'CHECK_IN', 'COMBO', 'MID_TERM', 'CHECK_OUT'].map(function (k) { return '<td>' + gp('r_' + k + '_' + i, R[k][i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '<tr><td class="sub">5+ bedrooms</td><td colspan="5" class="a-fine">Custom quote</td></tr></tbody></table></div>' +
    '<h3>One complexity adjustment</h3><div class="a-prg">' + field('pr-fp', 'Part-furnished (£)', gp('f_part', pr.furnish.part)) + field('pr-fs', 'Furnished, studio–2 bed (£)', gp('f_small', pr.furnish.furnishedSmall)) + field('pr-fl', 'Furnished, 3–4 bed (£)', gp('f_large', pr.furnish.furnishedLarge)) + field('pr-xr', 'Each extra bathroom, kitchen or reception (£)', gp('x_room', pr.extraRoomP)) + field('pr-ob', 'Outbuildings (£)', gp('x_out', pr.outbuildingP)) + field('pr-od', 'Extensive outdoor areas (£)', gp('x_outdoor', pr.outdoorP)) + '</div><p class="a-fine">Included: the selected bedrooms, one kitchen, one bathroom, one living room and ordinary hallways. Heavily furnished, 5+ bedrooms and unusually large properties go to a custom quote. No per-bedroom fee on top of the size price.</p>' +
    '<h3>Scheduling options</h3><div class="a-prg">' + field('pr-po', 'Priority premium (£)', gp('s_pri', pr.sched.priorityP)) + field('pr-pp', 'Of which to the Pro (£)', gp('s_pripro', pr.sched.priorityProP)) + field('pr-pd', 'Priority: dates within (working days)', n('s_prid', pr.sched.priorityDays), 'Later dates are Standard.') + '</div>' +
    '<label class="a-check"><input type="checkbox" name="s_priOpen"' + (pr.sched.priorityOpen ? ' checked' : '') + '> Offer Priority now <span class="a-fine">Turn off when Pro capacity isn’t there</span></label>' +
    '<h3>Pro fees from workload</h3><p class="a-fine">Pro fee = attendance allowance + expected on-site and reporting time × the Pro’s hourly rate + approved complexity and urgency allowances. The fee is agreed before the Pro accepts.</p><div class="a-prg">' + field('pr-at', 'Attendance allowance (£)', gp('p_att', pr.pro.attendP)) + field('pr-fsh', 'Pro share of complexity adjustments (%)', n('p_fsh', pr.pro.furnishSharePct)) + [1, 2, 3, 4, 5].map(function (l) { return field('pr-rl' + l, 'Level ' + l + ' hourly rate (£)', gp('p_rate_' + l, pr.pro.rateByLevel[l - 1])); }).join('') + '</div>' +
    '<div class="a-tw"><table><thead><tr><th>Expected minutes (on site + report)</th><th>Base</th><th>Each bedroom</th></tr></thead><tbody>' + [['INVENTORY', 'Inventory & Condition'], ['CHECK_IN', 'Standalone check-in'], ['CHECK_IN_COMBO', 'Check-in in the same visit'], ['MID_TERM', 'Mid-term'], ['CHECK_OUT', 'Check-out']].map(function (x) { var m = pr.pro.minutes[x[0]]; return '<tr><td class="sub">' + x[1] + '</td><td>' + n('m_' + x[0] + '_0', m[0]) + '</td><td>' + n('m_' + x[0] + '_1', m[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<h3>Cleaning</h3><div class="a-prg">' + field('pr-ch', 'Client price per cleaner-hour (£)', gp('c_hour', pr.clean.hourP)) + field('pr-cc', 'Equipment and consumables (£)', gp('c_cons', pr.clean.consumablesP)) + field('pr-ck', 'Pro kit allowance (£)', gp('c_kit', pr.clean.kitP)) + field('pr-cs', 'Estimate range (±%)', n('c_spread', pr.clean.spreadPct)) + Object.keys(pr.clean.minP).map(function (t) { return field('pr-cm-' + t, 'Minimum · ' + CLEANS[t].label + ' (£)', gp('c_min_' + t, pr.clean.minP[t])); }).join('') + Object.keys(pr.clean.addons).map(function (a) { return field('pr-ca-' + a, CLEAN_ADDONS[a] + ' (£)', gp('c_add_' + a, pr.clean.addons[a])); }).join('') + '</div>' +
    '<h3>Repairs &amp; Damages</h3><div class="a-prg">' + field('pr-dg', 'Diagnostic visit (£)', gp('d_fee', pr.repairs.diagnosisP)) + field('pr-dp', 'Diagnostic visit Pro fee (£)', gp('d_pro', pr.repairs.diagnosisProP)) + field('pr-lp', 'Pro share of labour (%)', n('d_lab', pr.repairs.labourProPct)) + '</div>' +
    '<h3>Contribution and costs</h3><div class="a-prg">' + field('pr-fm', 'Floor (£)', gp('k_min', pr.floor.minP)) + field('pr-fpc', 'Floor (% of revenue)', n('k_pct', pr.floor.pct)) + field('pr-pyp', 'Payment cost (%)', n('k_pay', pr.costs.payPct, 0.1)) + field('pr-pyf', 'Payment cost per job (£)', gp('k_payf', pr.costs.payFixedP)) + field('pr-ops', 'Support and reporting per job (£)', gp('k_ops', pr.costs.opsP)) + field('pr-rw', 'Rework allowance (%)', n('k_rw', pr.costs.reworkPct, 0.1)) + '</div>' +
    '<h3>Portfolio pricing and tax</h3><div class="a-prg">' + field('pr-t1', 'Rebate from (jobs a month)', n('b_t1', pr.rebate.tier1)) + field('pr-rp', 'Rebate up to (%)', n('b_pct', pr.rebate.pct)) + field('pr-t2', 'Negotiated from (jobs a month)', n('b_t2', pr.rebate.tier2)) + field('pr-vat', 'VAT on services (%)', n('t_vat', pr.taxPct), 'Confirm the tax treatment before publishing final totals.') + field('pr-area', 'Service area', inp('pr-area', 'area', pr.area)) + '</div>' +
    (main ? field('pr-why', 'Reason for change', inp('pr-why', 'reason', '', 'required'), 'Recorded in the audit log. Issued quotes keep their prices.') + '<div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">' + ic('lock', 18) + 'Save pricing</button>' + (ph ? '<span class="a-fine">We’ll send a code to ' + esc(maskPhone(ph)) + ' to confirm.</span>' : '') + '</div>' : '') + '</fieldset></form>';
  return h + '</div>';
}
function readPricingForm(fd) {
  var pr = JSON.parse(JSON.stringify(pricing())), v = function (n) { return fd.get(n); }, pp = function (n, d) { return fd.has(n) ? toP(v(n)) : d; }, nn = function (n, d) { return fd.has(n) ? Math.max(0, +v(n) || 0) : d; };
  ['INVENTORY', 'CHECK_IN', 'COMBO', 'MID_TERM', 'CHECK_OUT'].forEach(function (k) { pr.rates[k] = pr.rates[k].map(function (x, i) { return pp('r_' + k + '_' + i, x); }); });
  pr.furnish = { part: pp('f_part', pr.furnish.part), furnishedSmall: pp('f_small', pr.furnish.furnishedSmall), furnishedLarge: pp('f_large', pr.furnish.furnishedLarge) };
  pr.extraRoomP = pp('x_room', pr.extraRoomP); pr.outbuildingP = pp('x_out', pr.outbuildingP); pr.outdoorP = pp('x_outdoor', pr.outdoorP);
  pr.sched = { flexOffP: pp('s_flex', pr.sched.flexOffP), priorityP: pp('s_pri', pr.sched.priorityP), priorityProP: pp('s_pripro', pr.sched.priorityProP), flexDays: nn('s_flexd', pr.sched.flexDays), standardDays: nn('s_stdd', pr.sched.standardDays), priorityDays: Math.max(1, nn('s_prid', pr.sched.priorityDays)), priorityOpen: fd.has('s_priOpen'), flexOpen: false };
  pr.pro.attendP = pp('p_att', pr.pro.attendP); pr.pro.furnishSharePct = Math.min(100, nn('p_fsh', pr.pro.furnishSharePct)); pr.pro.rateByLevel = [1, 2, 3, 4, 5].map(function (l) { return pp('p_rate_' + l, pr.pro.rateByLevel[l - 1]); });
  Object.keys(pr.pro.minutes).forEach(function (k) { pr.pro.minutes[k] = [nn('m_' + k + '_0', pr.pro.minutes[k][0]), nn('m_' + k + '_1', pr.pro.minutes[k][1])]; });
  pr.clean.hourP = pp('c_hour', pr.clean.hourP); pr.clean.consumablesP = pp('c_cons', pr.clean.consumablesP); pr.clean.kitP = pp('c_kit', pr.clean.kitP); pr.clean.spreadPct = nn('c_spread', pr.clean.spreadPct);
  Object.keys(pr.clean.minP).forEach(function (t) { pr.clean.minP[t] = pp('c_min_' + t, pr.clean.minP[t]); }); Object.keys(pr.clean.addons).forEach(function (a) { pr.clean.addons[a] = pp('c_add_' + a, pr.clean.addons[a]); });
  pr.repairs = { diagnosisP: pp('d_fee', pr.repairs.diagnosisP), diagnosisProP: pp('d_pro', pr.repairs.diagnosisProP), labourProPct: Math.min(100, nn('d_lab', pr.repairs.labourProPct)) };
  pr.floor = { minP: pp('k_min', pr.floor.minP), pct: Math.min(90, nn('k_pct', pr.floor.pct)) };
  pr.costs = { payPct: nn('k_pay', pr.costs.payPct), payFixedP: pp('k_payf', pr.costs.payFixedP), opsP: pp('k_ops', pr.costs.opsP), reworkPct: nn('k_rw', pr.costs.reworkPct) };
  pr.rebate = { tier1: Math.max(1, nn('b_t1', pr.rebate.tier1)), pct: Math.min(50, nn('b_pct', pr.rebate.pct)), tier2: Math.max(2, nn('b_t2', pr.rebate.tier2)) };
  pr.taxPct = Math.min(30, nn('t_vat', pr.taxPct)); pr.area = String(v('area') || pr.area).trim() || pr.area;
  return pr;
}
function cmdSavePricing(pr, reason, verified) { if (!isMainAdmin()) return deny('Only the Main admin can change prices.'); if (!verified) return deny('Confirm the change with the code sent to the Main admin’s phone.'); setDoc('settings', 'policy', Object.assign({}, D.settings || {}, { pricing: pr })); audit('pricing.update', 'policy', 'pricing', reason, { area: pr.area, verified: 'code to ' + maskPhone(pricePhone()) }); return true; }
function cmdRecordRebate(clientId, mk, amountP) {
  if (!staffGuard('finance', 'record rebates')) return false; var c = D.clients[clientId], p = portfolio(clientId, mk), due = Math.max(0, p.rebateP - p.paidP); if (!c || due <= 0) return deny('No rebate is due.');
  var amt = Math.min(due, amountP || due), rb = (c.rebates || []).concat([{ id: uid(), month: mk, amountP: amt, jobs: p.count, ref: 'test_rb_' + uid(), at: now() }]);
  patchDoc('clients', clientId, { rebates: rb }); audit('rebate.record', 'client', clientId, 'Portfolio rebate ' + mk, { amountP: amt, jobs: p.count }); notify('c:' + clientId, 'Portfolio rebate of ' + P(amt) + ' for ' + p.count + ' completed jobs (test mode)'); return true;
}
function cmdClientRate(clientId, pctV, reason, verified) { if (!isMainAdmin()) return deny('Only the Main admin can set negotiated rates.'); if (!verified) return deny('Confirm the change with the code sent to the Main admin’s phone.'); var v = Math.min(30, Math.max(0, +pctV || 0)); patchDoc('clients', clientId, { portfolioPct: v }); audit('client.portfolio_rate', 'client', clientId, reason || 'Negotiated rate', { pct: v, verified: 'code to ' + maskPhone(pricePhone()) }); return true; }
function portfolioCard(clientId) {
  var pr = pricing(), p = portfolio(clientId), c = D.clients[clientId] || {}, r = pr.rebate, all = (c.rebates || []);
  var msg = p.tier === 'standard' ? (p.toNext > 0 ? p.toNext + ' more completed job' + (p.toNext === 1 ? '' : 's') + ' this month to earn up to a ' + r.pct + '% rebate on service fees.' : '') : p.tier === 'rebate' ? 'You’re earning up to a ' + r.pct + '% rebate on eligible service fees this month' + (p.rebateP ? ' (' + P(p.rebateP) + ' so far)' : '') + '. ' + p.toNext + ' more for a negotiated portfolio rate.' : 'You qualify for a negotiated portfolio rate. LISTD will be in touch' + (c.portfolioPct ? '; your agreed rate is ' + c.portfolioPct + '% off service fees' : '') + '.';
  return '<div class="a-card"><h3>' + ic('star', 18) + ' Portfolio pricing</h3><p><b>' + p.count + '</b> completed job' + (p.count === 1 ? '' : 's') + ' in ' + MON[+p.month.slice(5) - 1] + '. ' + esc(msg) + '</p><p class="a-fine">No subscription. Rebates apply to service fees only, not materials, exceptional travel or Priority premiums.</p>' + (all.length ? '<dl class="a-kv">' + all.map(function (x) { return '<dt>' + esc(MON[+x.month.slice(5) - 1] + ' ' + x.month.slice(0, 4)) + '</dt><dd>' + P(x.amountP) + ' rebate · ' + x.jobs + ' jobs</dd>'; }).join('') + '</dl>' : '') + '</div>';
}

/* ---- Price changes: Main admin only, confirmed with a 6-digit code sent to the Main admin's phone ----
   Test mode has no SMS provider, so the text that would be sent is shown in the code dialog, labelled as such.
   Production: generate, send (SMS provider) and check the code on the server; never send it to the browser. */
var CODE_TTL_MIN = 10, CODE_TRIES = 5, CODE_RESEND_S = 30;
function mainStaff() { return staffList().filter(function (x) { return x.role === 'MAIN' && x.status === 'ACTIVE'; })[0] || null; }
function isMainAdmin() { return S.role === 'admin' && staffRole() === 'MAIN'; }
function pricePhone() { var m = mainStaff(); return m && m.priceCodePhone || ''; }
function maskPhone(p) { var d = String(p || '').replace(/\D/g, ''); return d ? '•••• ' + d.slice(-4) : ''; }
function normPhone(p) { var d = String(p || '').replace(/[^\d+]/g, ''); if (/^0\d{10}$/.test(d)) d = '+44' + d.slice(1); if (/^44\d{10}$/.test(d)) d = '+' + d; return /^\+\d{10,15}$/.test(d) ? d : ''; }
function sixDigits() { var b = randBytes(4), n = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]; return String(n % 1000000).padStart(6, '0'); }
var CODE_WHY = { pricing: 'approve a change to LISTD prices', 'client-rate': 'approve a negotiated client rate', policies: 'approve a change to catalogue & policies', 'staff-invite': 'approve adding a staff member', 'staff-role': 'approve a staff role change', 'staff-remove': 'approve removing staff access', 'staff-transfer': 'approve handing over the Main admin role', phone: 'confirm this phone for key decisions', 'phone-old': 'confirm you want to change the phone for key decisions' };
/* a command guarded by a key-decision code runs only inside priceCodeDone, with S.keyPass set to its purpose */
function keyPass(p) { return S.keyPass === p; }
function keyDecision(purpose, payload) { if (!isMainAdmin()) return deny('Only the Main admin can do this.'); if (!pricePhone()) { toast('Add your mobile number under My settings › Account first. Key decisions need a code sent to it.'); return false; } return sendPriceCode(purpose, pricePhone(), payload); }
async function sendPriceCode(purpose, phone, payload) {
  if (!isMainAdmin()) return deny('Only the Main admin can do this.');
  if (!phone) return deny('Add and confirm your mobile number under My settings › Account first.');
  var code = sixDigits(), m = mainStaff();
  S.priceCode = { purpose: purpose, phone: phone, payload: payload || {}, hash: await sha256(code + '|' + purpose + '|' + phone), exp: Date.now() + CODE_TTL_MIN * 60000, tries: 0, sentAt: Date.now() };
  S.smsOutbox = { to: maskPhone(phone), text: 'LISTD: ' + code + ' is your code to ' + CODE_WHY[purpose] + '. It expires in ' + CODE_TTL_MIN + ' minutes. LISTD will never ask you for it.' };
  audit('pricing.code_sent', 'staff', m ? m.id : '', CODE_WHY[purpose], { to: maskPhone(phone) });
  S.modal = { type: 'price-code' }; render(); return true;
}
async function verifyPriceCode(code) {
  var x = S.priceCode; if (!x) return deny('Send a new code.');
  if (Date.now() > x.exp) { S.priceCode = null; return deny('That code has expired. Send a new one.'); }
  if (x.tries >= CODE_TRIES) { S.priceCode = null; return deny('Too many attempts. Send a new code.'); }
  x.tries++;
  if ((await sha256(String(code || '').replace(/\D/g, '') + '|' + x.purpose + '|' + x.phone)) !== x.hash) { audit('pricing.code_failed', 'staff', (mainStaff() || {}).id || '', CODE_WHY[x.purpose], { tries: x.tries }); return deny('That code didn’t match. ' + (CODE_TRIES - x.tries) + ' attempt' + (CODE_TRIES - x.tries === 1 ? '' : 's') + ' left.'); }
  S.priceCode = null; S.smsOutbox = null; return x;
}
function priceCodeModal() {
  var x = S.priceCode || {};
  return mShell('price-code', 'Enter the code sent to ' + esc(maskPhone(x.phone)), '<p class="a-muted">We’ve sent a 6-digit code to ' + esc(maskPhone(x.phone)) + ' to ' + esc(CODE_WHY[x.purpose] || 'confirm this change') + '. It expires in ' + CODE_TTL_MIN + ' minutes.</p>' +
    field('pc-code', 'Code', inp('pc-code', 'code', '', 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus')) +
    (S.smsOutbox ? '<div class="a-banner" style="--t:var(--warning-subtle);--c:var(--warning)">' + ic('chat', 20) + '<div><b>Test mode: text message to ' + esc(S.smsOutbox.to) + '</b><p>' + esc(S.smsOutbox.text) + '</p><p class="a-fine">No SMS provider is connected, so the message is shown here instead of being sent.</p></div></div>' : '') +
    '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="price-resend" style="justify-self:start">Resend code</button>', 'Confirm');
}
async function priceCodeDone(x) {
  var m = mainStaff(); S.modal = null;
  if (x.purpose === 'phone-old') return sendPriceCode('phone', x.payload.newPhone, x.payload);
  if (x.purpose === 'phone') { patchDoc('staff', m.id, { priceCodePhone: x.phone, priceCodePhoneAt: now() }); audit('security.phone_set', 'staff', m.id, 'Phone for key decisions confirmed', { to: maskPhone(x.phone) }); toast('Phone confirmed. Key decisions now need a code sent to ' + maskPhone(x.phone) + '.'); render(); return true; }
  var P0 = x.payload, ok = false; S.keyPass = x.purpose;
  try {
    if (x.purpose === 'policies') { ok = cmdSavePolicies(P0.ns, P0.reason); if (ok) toast('Policies saved'); }
    else if (x.purpose === 'staff-invite') { ok = cmdStaffInvite(P0.name, P0.email, P0.role); if (ok) toast('Staff member added'); }
    else if (x.purpose === 'staff-role') { ok = cmdStaffRole(P0.id, P0.role); if (ok) toast('Role updated'); }
    else if (x.purpose === 'staff-remove') { ok = cmdStaffRemove(P0.id); if (ok) toast('Access removed'); }
    else if (x.purpose === 'staff-transfer') { ok = cmdStaffTransfer(P0.id); if (ok) toast('Ownership transferred'); }
  } finally { S.keyPass = null; }
  if (ok !== false || x.purpose === 'policies') { render(); return true; }
  if (x.purpose === 'pricing') { if (cmdSavePricing(x.payload.pr, x.payload.reason, true)) toast('Pricing saved'); render(); return true; }
  if (x.purpose === 'client-rate') { if (cmdClientRate(x.payload.clientId, x.payload.pct, x.payload.reason, true)) toast('Negotiated rate saved'); render(); return true; }
}
function pricePhoneCard() {
  var ph = pricePhone();
  return '<form class="a-card a-form" data-form="price-phone"><h3>' + ic('lock', 18) + ' Mobile number for key decisions</h3><p class="a-fine">As Main admin, key decisions need a 6-digit code sent to this phone: price changes and negotiated rates, catalogue & policies, and adding, changing, removing or handing over staff roles.' + (ph ? ' Changing it needs a code to the current phone first.' : '') + '</p>' + (ph ? '<p><b>' + esc(maskPhone(ph)) + '</b> · confirmed ' + fdate((mainStaff() || {}).priceCodePhoneAt) + '</p>' : '') +
    '<div class="two">' + field('pp-ph', ph ? 'New mobile number' : 'Mobile number', inp('pp-ph', 'phone', '', 'type="tel" autocomplete="tel" required placeholder="07700 900000"')) + '</div><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="submit">' + (ph ? 'Change phone' : 'Send code to confirm') + '</button></div></form>';
}

function cmdSavePolicies(ns, reason) { if (!isMainAdmin()) return deny('Only the Main admin can change catalogue & policies.'); if (!keyPass('policies')) return deny('Confirm with the code sent to the Main admin’s phone.'); ns = Object.assign({}, D.settings || {}, ns); setDoc('settings', 'policy', ns); audit('policy.update', 'policy', 'policy', reason, Object.assign({ verified: 'code to ' + maskPhone(pricePhone()) }, ns)); var f = document.querySelector('form[data-form=policies] [name=reason]'); if (f) f.value = ''; return true; }
