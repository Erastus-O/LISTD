/* ===================== Admin › Analytics: what drives the bottom line =====================
   Contribution (what LISTD keeps after direct delivery costs) is broken into the drivers that multiply into it:

     Contribution = Paid jobs × Contribution per paid job − Rebates
     Paid jobs    = Requests × Quoted rate × Quote acceptance × Payment conversion
     Contribution per paid job = Avg revenue × (1 − Refund rate) × (1 − Pro fee share) − Direct cost per job

   Each driver is improved by 10% in the helpful direction, holding the others still, and the change in
   contribution ranks it. Leading indicators under each driver explain what moves it. */
var AN_PERIODS = { d30: ['Last 30 days', 30], d90: ['Last 90 days', 90], d365: ['Last 12 months', 365], all: ['All time', 0] };
function anJobs(per) { var d = (AN_PERIODS[per] || AN_PERIODS.d90)[1], from = d ? Date.now() - d * 86400000 : 0; return list('jobs').filter(function (j) { return !from || new Date(j.createdAt).getTime() >= from; }); }
function anRebates(per) { var d = (AN_PERIODS[per] || AN_PERIODS.d90)[1], from = d ? Date.now() - d * 86400000 : 0, t = 0; list('clients').forEach(function (c) { (c.rebates || []).forEach(function (r) { if (!from || new Date(r.at).getTime() >= from) t += r.amountP; }); }); return t; }
function median(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function anModel(per) {
  var jobs = anJobs(per), cs = pricing().costs, N = jobs.length, quoted = 0, decided = 0, accepted = 0, paid = 0, completed = 0, cancelled = 0, gross = 0, refunds = 0, fees = 0, direct = 0, prio = 0, prioP = 0, upliftP = 0, discP = 0, disputes = 0, corrections = 0, expired = 0, declined = 0;
  var qHrs = [], payHrs = [], assignHrs = [], timeRatio = [], svc = {}, months = {}, clients = {}, levels = {}, reasons = {};
  jobs.forEach(function (j) {
    var qs = j.quotes || [], aq = acceptedQuote(j), paidJ = paidP(j) > 0, k = svcKey(j);
    if (qs.length) { quoted++; var q1 = qs[0]; if (q1.issuedAt) qHrs.push((new Date(q1.issuedAt) - new Date(j.createdAt)) / 3600000); }
    var last = qs.filter(function (q) { return q.status !== 'SUPERSEDED'; }).slice(-1)[0];
    if (last && (last.status === 'ACCEPTED' || last.status === 'REJECTED' || last.status === 'EXPIRED' || (last.status === 'ISSUED' && hoursFrom(last.expiresAt) <= 0))) decided++;
    if (last && last.status === 'REJECTED') { declined++; var rr = (last.reason || 'No reason given').trim(); reasons[rr] = (reasons[rr] || 0) + 1; }
    if (last && (last.status === 'EXPIRED' || (last.status === 'ISSUED' && hoursFrom(last.expiresAt) <= 0))) expired++;
    if (aq) accepted++;
    if (j.status === 'CANCELLED') cancelled++;
    if (j.status === 'COMPLETED') completed++;
    disputes += (j.disputes || []).length; if ((j.history || []).some(function (h) { return /correction/i.test(h.text); })) corrections++;
    if (!paidJ) return;
    paid++;
    var tax = aq ? aq.taxP || 0 : 0, g = paidP(j) - tax, rf = refundedP(j), fee = j.status === 'CANCELLED' && !(j.settlement && j.settlement.status === 'PAID') ? 0 : proFeeP(j), net = g - rf;
    var cost = Math.round(g * cs.payPct / 100 + cs.payFixedP) + cs.opsP + Math.round(Math.max(0, net) * cs.reworkPct / 100);
    gross += g; refunds += rf; fees += fee; direct += cost;
    if (aq) { (aq.lines || []).forEach(function (l) { var v = Math.round(l.q * l.u); if (l.tag === 'urgency') { prio++; prioP += v; } else if (/^Furnishing|^Additional|^Outbuildings|^Extensive/.test(l.d)) upliftP += v; else if (l.tag === 'portfolio' || v < 0) discP -= v; }); discP += aq.discP || 0; }
    var pa = (j.payments || []).filter(function (x) { return x.status === 'SUCCEEDED'; })[0], acc = aq && aq.acceptedAt; if (pa && acc) payHrs.push((new Date(pa.at) - new Date(acc)) / 3600000);
    if (j.readyAt && j.scheduledAt) assignHrs.push((new Date(j.scheduledAt) - new Date(j.readyAt)) / 3600000);
    var at = j.attendance || {}; if (at.inAt && at.outAt && aq && aq.durationMin) timeRatio.push(((new Date(at.outAt) - new Date(at.inAt)) / 60000 - (+at.breakMin || 0)) / aq.durationMin);
    var contrib = net - fee - cost;
    var S_ = svc[k] = svc[k] || { n: 0, rev: 0, c: 0 }; S_.n++; S_.rev += net; S_.c += contrib;
    var mk = monthKey(j.createdAt), M = months[mk] = months[mk] || { rev: 0, c: 0, n: 0 }; M.rev += net; M.c += contrib; M.n++;
    clients[j.clientId] = (clients[j.clientId] || 0) + 1;
    if (j.proId && D.pros[j.proId]) { var lv = proLevel(D.pros[j.proId]); levels[lv] = (levels[lv] || 0) + 1; }
  });
  var reb = anRebates(per), net = gross - refunds, cIds = Object.keys(clients);
  var d = {
    N: N, q: N ? quoted / N : 0, a: quoted ? accepted / quoted : 0, p: accepted ? paid / accepted : 0,
    arpj: paid ? gross / paid : 0, r: gross ? refunds / gross : 0, f: net ? fees / net : 0, c: paid ? direct / paid : 0, b: reb
  };
  var C = net - fees - direct - reb;
  return { d: d, C: C, gross: gross, refunds: refunds, net: net, fees: fees, direct: direct, rebates: reb, paid: paid, quoted: quoted, accepted: accepted, completed: completed, cancelled: cancelled, svc: svc, months: months,
    ind: { qHrs: median(qHrs), payHrs: median(payHrs), assignHrs: median(assignHrs), timeRatio: median(timeRatio), prioShare: paid ? prio / paid : 0, prioP: prioP, upliftP: upliftP, discP: discP, disputes: disputes, corrections: corrections, expired: expired, declined: declined, reasons: reasons,
      clients: cIds.length, repeat: cIds.filter(function (c) { return clients[c] > 1; }).length, cancelRate: N ? cancelled / N : 0, levels: levels } };
}
function anContrib(d) { var paid = d.N * d.q * d.a * d.p; return paid * (d.arpj * (1 - d.r) * (1 - d.f) - d.c) - d.b; }
var AN_DRIVERS = [
  ['N', 'Bookings', 'up', 'How many bookings clients make.'],
  ['q', 'Bookings quoted', 'up', 'Share of bookings that receive a price.'],
  ['a', 'Quote acceptance', 'up', 'Share of priced bookings that clients accept.'],
  ['p', 'Payment conversion', 'up', 'Share of accepted quotes that are paid.'],
  ['arpj', 'Average revenue per paid job', 'up', 'Revenue per paid job, excluding tax.'],
  ['r', 'Refund rate', 'down', 'Share of revenue refunded.'],
  ['f', 'Pro fee share', 'down', 'Pro fees as a share of net revenue.'],
  ['c', 'Direct cost per job', 'down', 'Payment, support and rework allowance per paid job.'],
  ['b', 'Rebates', 'down', 'Portfolio rebates recorded in the period.']
];
function anFmt(k, v) { if (k === 'N') return String(Math.round(v)); if (k === 'arpj' || k === 'c' || k === 'b') return P(v); return Math.round(v * 1000) / 10 + '%'; }
function anLevers(m) {
  var base = anContrib(m.d);
  return AN_DRIVERS.map(function (x) {
    var d2 = Object.assign({}, m.d), k = x[0];
    d2[k] = x[2] === 'up' ? (k === 'q' || k === 'a' || k === 'p' ? Math.min(1, d2[k] * 1.1) : d2[k] * 1.1) : d2[k] * 0.9;
    return { k: k, label: x[1], dir: x[2], what: x[3], value: m.d[k], gain: Math.round(anContrib(d2) - base) };
  }).sort(function (a, b) { return b.gain - a.gain; });
}
function anIndicators(k, m) {
  var I = m.ind, h = function (v) { return v == null ? '—' : v < 48 ? Math.round(v * 10) / 10 + ' h' : Math.round(v / 24 * 10) / 10 + ' days'; }, topR = Object.keys(I.reasons).sort(function (a, b) { return I.reasons[b] - I.reasons[a]; })[0];
  return ({
    N: [['Clients booking', I.clients], ['Repeat clients', I.clients ? I.repeat + ' of ' + I.clients : '—'], ['Cancelled bookings', Math.round(I.cancelRate * 100) + '%']],
    q: [['Median time to price', h(I.qHrs)], ['Waiting for a price now', list('jobs').filter(function (j) { return j.status === 'SUBMITTED'; }).length]],
    a: [['Declined', I.declined], ['Expired before a decision', I.expired], ['Top decline reason', topR ? '“' + topR + '”' : '—']],
    p: [['Median time from accept to pay', h(I.payHrs)], ['Accepted, not yet paid', list('jobs').filter(function (j) { return j.status === 'AWAITING_PAYMENT'; }).length]],
    arpj: [['Priority share of paid jobs', Math.round(I.prioShare * 100) + '%'], ['Priority premiums', P(I.prioP)], ['Furnishing and room adjustments', P(I.upliftP)], ['Discounts and portfolio rates', P(I.discP)]],
    r: [['Disputes and complaints', I.disputes], ['Cancellations', m.cancelled]],
    f: [['Paid jobs by Pro level', Object.keys(I.levels).sort().map(function (l) { return 'L' + l + ': ' + I.levels[l]; }).join(' · ') || '—'], ['Median Pro time vs expected', I.timeRatio == null ? '—' : Math.round(I.timeRatio * 100) + '%'], ['Median time to assign a Pro', h(I.assignHrs)]],
    c: [['Jobs needing corrections', I.corrections], ['Assumed per job', P(pricing().costs.opsP) + ' support + ' + pricing().costs.payPct + '% payment + ' + pricing().costs.reworkPct + '% rework']],
    b: [['Portfolio rebates', P(m.rebates)]]
  })[k] || [];
}
function anBars(rows, opt) {
  opt = opt || {}; var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); }).concat([1]));
  return '<div class="an-bars" role="list">' + rows.map(function (r) { var w = Math.max(r.v ? 2 : 0, Math.round(Math.abs(r.v) / max * 100)); return '<div class="an-bar" role="listitem" title="' + esc(r.label + ': ' + r.txt) + '"><span class="l">' + esc(r.label) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span><span class="t"><i style="width:' + w + '%"' + (r.v < 0 ? ' class="neg"' : '') + '></i></span><span class="v num">' + esc(r.txt) + '</span></div>'; }).join('') + '</div>';
}
function vAdminAnalytics() {
  var per = S.anPer || 'd90', m = anModel(per), lv = anLevers(m), rank = {}; lv.forEach(function (x, i) { rank[x.k] = i + 1; });
  var h = '<div class="a-page an"><div class="a-head"><div><h1>Analytics</h1><p>What drives LISTD’s bottom line, ranked by impact. Contribution is what LISTD keeps after Pro fees, payment, support and rework costs, refunds and rebates. It still has to cover overheads.</p></div><div><label class="sr-only" for="an-per">Period</label><select class="a-mini" id="an-per" data-filt="anPer">' + Object.keys(AN_PERIODS).map(function (k) { return '<option value="' + k + '"' + (k === per ? ' selected' : '') + '>' + AN_PERIODS[k][0] + '</option>'; }).join('') + '</select></div></div>';
  if (!m.paid) return h + empty('chart', 'No paid jobs in this period', 'Analytics fill in as clients pay for jobs. Try a longer period.', '') + '</div>';
  /* headline + bridge */
  h += '<section class="a-sec"><div class="an-hero a-card"><div><span class="k">Contribution · ' + esc(AN_PERIODS[per][0].toLowerCase()) + '</span><span class="v num">' + P(m.C) + '</span><span class="a-fine">' + (m.net ? Math.round(m.C / m.net * 1000) / 10 + '% of net revenue · ' : '') + m.paid + ' paid jobs · ' + P(m.paid ? m.C / m.paid : 0) + ' a job</span></div>' +
    anBars([{ label: 'Revenue (excl. tax)', v: m.gross, txt: P(m.gross) }, { label: 'Refunds', v: -m.refunds, txt: P(-m.refunds) }, { label: 'Pro fees', v: -m.fees, txt: P(-m.fees) }, { label: 'Payment, support and rework', v: -m.direct, txt: P(-m.direct) }, { label: 'Rebates', v: -m.rebates, txt: P(-m.rebates) }, { label: 'Contribution', v: m.C, txt: P(m.C) }]) + '</div></section>';
  h += vAnalyticsCharts(per, m);
  h += vAnalyticsOps(per);
  /* funnel, service mix, trend */
  var fun = [['Bookings', m.d.N], ['Priced', m.quoted], ['Accepted', m.accepted], ['Paid', m.paid], ['Completed', m.completed]];
  var sv = Object.keys(m.svc).map(function (k) { var x = m.svc[k]; return { label: SVC[k].label, sub: x.n + ' paid · ' + (x.rev ? Math.round(x.c / x.rev * 100) : 0) + '% margin', v: x.c, txt: P(x.c) }; }).sort(function (a, b) { return b.v - a.v; });
  var mk = Object.keys(m.months).sort().slice(-6), tr = mk.map(function (k) { var x = m.months[k]; return { label: MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4), sub: x.n + ' paid', v: x.c, txt: P(x.c) }; });
  h += '<div class="a-grid two-col"><section class="a-card"><h3>Booking funnel</h3><p class="a-fine">Where bookings drop out before they earn anything.</p>' + anBars(fun.map(function (f, i) { return { label: f[0], v: f[1], txt: f[1] + (i ? ' · ' + (fun[i - 1][1] ? Math.round(f[1] / fun[i - 1][1] * 100) : 0) + '%' : '') }; })) + '</section>' +
    '<section class="a-card"><h3>Contribution by service</h3><p class="a-fine">Which services earn the most after delivery costs.</p>' + anBars(sv) + '</section></div>';
  /* driver tree */
  var nd = function (k, extra) { var x = AN_DRIVERS.filter(function (z) { return z[0] === k; })[0]; return '<div class="an-node"><span class="rk num" title="Impact rank">#' + rank[k] + '</span><b>' + esc(x[1]) + '</b><span class="num">' + anFmt(k, m.d[k]) + '</span>' + (extra || '') + '</div>'; };
  var paidJobs = m.d.N * m.d.q * m.d.a * m.d.p, perJob = m.d.arpj * (1 - m.d.r) * (1 - m.d.f) - m.d.c;
  h += '<section class="a-sec"><h2>How the drivers combine <small class="a-fine">Ranked by impact: #1 gains the most contribution from a 10% improvement</small></h2><div class="an-tree a-card">' +
    '<div class="an-root"><div class="an-node an-top"><b>Contribution</b><span class="num">' + P(m.C) + '</span><small>= Paid jobs × Contribution per job − Rebates</small></div></div>' +
    '<div class="an-branches"><div class="an-branch"><div class="an-node an-mid"><b>Paid jobs</b><span class="num">' + Math.round(paidJobs) + '</span><small>= Bookings × Quoted × Accepted × Paid</small></div><div class="an-leaves">' + nd('N') + nd('q') + nd('a') + nd('p') + '</div></div>' +
    '<div class="an-branch"><div class="an-node an-mid"><b>Contribution per paid job</b><span class="num">' + P(perJob) + '</span><small>= Avg revenue × (1 − Refunds) × (1 − Pro fees) − Direct cost</small></div><div class="an-leaves">' + nd('arpj') + nd('r') + nd('f') + nd('c') + '</div></div>' +
    '<div class="an-branch an-narrow"><div class="an-node an-mid"><b>Less</b><span class="num">' + P(m.rebates) + '</span><small>Taken off the total</small></div><div class="an-leaves">' + nd('b') + '</div></div></div></div></section>';
  h += '<p class="a-fine">Figures use paid jobs booked in the period. Direct costs use the assumptions on the Pricing page; replace them with real payment and support costs as the pilot runs. The ranking is a sensitivity estimate, not a forecast.</p>';
  return h + '</div>';
}

/* ---------- charts: bars, pies (donuts) and the location map ---------- */
var AN_CAT = ['var(--an-1)', 'var(--an-2)', 'var(--an-3)', 'var(--an-4)', 'var(--an-5)', 'var(--an-6)'];
function anArc(cx, cy, r0, r1, a0, a1) {
  var f = function (r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }, big = a1 - a0 > Math.PI ? 1 : 0, p0 = f(r1, a0), p1 = f(r1, a1), p2 = f(r0, a1), p3 = f(r0, a0);
  return 'M' + p0 + 'A' + r1 + ',' + r1 + ' 0 ' + big + ' 1 ' + p1 + 'L' + p2 + 'A' + r0 + ',' + r0 + ' 0 ' + big + ' 0 ' + p3 + 'Z';
}
/* donut: slices [{label, v}] in a fixed order; colour follows the slice's slot, values and shares in the legend */
function anDonut(title, note, slices, centre) {
  slices = slices.filter(function (s) { return s.v > 0; }); var tot = slices.reduce(function (a, s) { return a + s.v; }, 0);
  if (!tot) return '<section class="a-card an-chart"><h3>' + esc(title) + '</h3><p class="a-muted">Nothing to show for this period.</p></section>';
  var a = 0, gap = slices.length > 1 ? 0.012 : 0, paths = slices.map(function (s, i) { var a0 = a, a1 = a + s.v / tot * Math.PI * 2; a = a1; var x = s.v / tot; return '<path d="' + (x >= 0.9999 ? anArc(60, 60, 36, 56, 0, Math.PI * 1.9999) : anArc(60, 60, 36, 56, a0 + gap, a1 - gap)) + '" fill="' + AN_CAT[s.slot != null ? s.slot : i] + '"><title>' + esc(s.label + ': ' + s.txt + ' (' + Math.round(x * 100) + '%)') + '</title></path>'; }).join('');
  return '<section class="a-card an-chart"><h3>' + esc(title) + '</h3>' + (note ? '<p class="a-fine">' + esc(note) + '</p>' : '') + '<div class="an-donut"><svg viewBox="0 0 120 120" role="img" aria-label="' + esc(title) + '">' + paths + '<text x="60" y="57" text-anchor="middle" class="c1">' + esc(centre[0]) + '</text><text x="60" y="71" text-anchor="middle" class="c2">' + esc(centre[1]) + '</text></svg>' +
    '<ul class="an-legend">' + slices.map(function (s, i) { return '<li><i style="background:' + AN_CAT[s.slot != null ? s.slot : i] + '"></i><span>' + esc(s.label) + '</span><b class="num">' + esc(s.txt) + '</b><small class="num">' + Math.round(s.v / tot * 100) + '%</small></li>'; }).join('') + '</ul></div></section>';
}
/* vertical bar chart with one or two series on one axis */
function anColumns(title, note, cats, series, fmt, ints, tops) {
  if (!cats.length) return '<section class="a-card an-chart"><h3>' + esc(title) + '</h3><p class="a-muted">Nothing to show for this period.</p></section>';
  var W = 560, H = 220, pl = 52, pb = 34, pt = tops ? 24 : 12, max = Math.max.apply(null, [1].concat(series.reduce(function (a, s) { return a.concat(s.vals); }, []))), min = Math.min.apply(null, [0].concat(series.reduce(function (a, s) { return a.concat(s.vals); }, [])));
  var nice = function (v) { var e = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))), m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; }, top = ints ? Math.max(4, Math.ceil(max / 4) * 4) : nice(max), bot = min < 0 ? -nice(-min) : 0, y = function (v) { return pt + (top - v) / (top - bot) * (H - pt - pb); };
  var bw = (W - pl - 8) / cats.length, inner = Math.min(28, (bw - 10) / series.length), g = '';
  for (var t = 0; t <= 4; t++) { var v = bot + (top - bot) * t / 4; g += '<line x1="' + pl + '" x2="' + (W - 4) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="gl"/><text x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="ax">' + esc(fmt(v, true)) + '</text>'; }
  cats.forEach(function (c, i) {
    var x0 = pl + i * bw + (bw - inner * series.length - 2 * (series.length - 1)) / 2;
    series.forEach(function (s, k) { var v = s.vals[i] || 0, yy = y(Math.max(0, v)), hh = Math.abs(y(v) - y(0)); g += '<rect x="' + (x0 + k * (inner + 2)) + '" y="' + yy + '" width="' + inner + '" height="' + Math.max(v ? 1 : 0, hh) + '" rx="3" fill="' + s.c + '"><title>' + esc(c + ' · ' + s.name + ': ' + fmt(v)) + '</title></rect>'; });
    g += '<text x="' + (pl + i * bw + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" class="ax">' + esc(c) + '</text>';
    if (tops && tops[i]) { var ty = y(Math.max.apply(null, series.map(function (s) { return s.vals[i] || 0; }))) - 6; g += '<text x="' + (pl + i * bw + bw / 2) + '" y="' + Math.max(pt + 8, ty) + '" text-anchor="middle" class="tl">' + esc(tops[i]) + '</text>'; }
  });
  g += '<line x1="' + pl + '" x2="' + (W - 4) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="base"/>';
  return '<section class="a-card an-chart"><h3>' + esc(title) + '</h3>' + (note ? '<p class="a-fine">' + esc(note) + '</p>' : '') + (series.length > 1 ? '<ul class="an-legend row">' + series.map(function (s) { return '<li><i style="background:' + s.c + '"></i><span>' + esc(s.name) + '</span></li>'; }).join('') + '</ul>' : '') + '<svg class="an-cols" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">' + g + '</svg>' +
    '<details class="an-tab"><summary>Show as a table</summary><div class="a-tw a-fit"><table><thead><tr><th></th>' + series.map(function (s) { return '<th class="r">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' + cats.map(function (c, i) { return '<tr><td>' + esc(c) + '</td>' + series.map(function (s) { return '<td class="r num">' + esc(fmt(s.vals[i] || 0)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details></section>';
}
/* approximate centres of postcode districts (and areas, as a fallback) for the location map */
var PC_LL = { BS1: [51.454, -2.593], BS2: [51.462, -2.572], BS3: [51.438, -2.602], BS4: [51.432, -2.560], BS5: [51.463, -2.548], BS6: [51.472, -2.600], BS7: [51.484, -2.583], BS8: [51.456, -2.622], BS9: [51.492, -2.628], BS10: [51.510, -2.610], BS11: [51.497, -2.680], BS13: [51.413, -2.612], BS14: [51.413, -2.560], BS15: [51.461, -2.500], BS16: [51.483, -2.510], BS20: [51.480, -2.760], BS21: [51.437, -2.853], BS22: [51.358, -2.940], BS23: [51.345, -2.976], BS24: [51.330, -2.940], BS30: [51.440, -2.470], BS31: [51.410, -2.497], BS32: [51.543, -2.560], BS34: [51.522, -2.572], BS35: [51.605, -2.530], BS36: [51.527, -2.490], BS37: [51.540, -2.420], BS39: [51.330, -2.550], BS40: [51.360, -2.720], BS41: [51.420, -2.660], BS48: [51.430, -2.750], BS49: [51.375, -2.830],
  BA1: [51.393, -2.370], BA2: [51.370, -2.355], BA3: [51.290, -2.480], BA5: [51.210, -2.650], BA11: [51.230, -2.320], BA14: [51.320, -2.205], BA15: [51.345, -2.250], SN1: [51.560, -1.780], SN2: [51.580, -1.790], SN3: [51.560, -1.740], SN5: [51.570, -1.830], SN14: [51.460, -2.200], SN15: [51.460, -2.120], GL1: [51.860, -2.240], GL50: [51.900, -2.080], GL12: [51.610, -2.360],
  _BS: [51.46, -2.59], _BA: [51.36, -2.36], _SN: [51.56, -1.78], _GL: [51.86, -2.24], _TA: [51.02, -3.10], _EX: [50.72, -3.53], _PL: [50.37, -4.14], _B: [52.48, -1.89], _CF: [51.48, -3.18], _NP: [51.59, -3.00], _SP: [51.07, -1.80], _BH: [50.72, -1.88], _DT: [50.71, -2.44], _TQ: [50.46, -3.53], _WR: [52.19, -2.22], _HR: [52.06, -2.72], _CV: [52.41, -1.51], _WS: [52.59, -1.98], _WV: [52.59, -2.13], _DY: [52.51, -2.09] };
var PC_TOWNS = [['Bristol', 51.454, -2.587], ['Bath', 51.381, -2.359], ['Weston-super-Mare', 51.346, -2.977], ['Swindon', 51.558, -1.781], ['Gloucester', 51.864, -2.244], ['Cardiff', 51.481, -3.179], ['Birmingham', 52.486, -1.890], ['Chippenham', 51.458, -2.117]];
function pcLL(d) { d = String(d || '').toUpperCase(); if (PC_LL[d]) return PC_LL[d]; var a = (d.match(/^[A-Z]+/) || [''])[0]; return PC_LL['_' + a] || null; }
function anAreas(per) {
  var by = {}; anJobs(per).forEach(function (j) {
    var d = j.district || district((j.propSnapshot || {}).postcode); if (!d) return; var x = by[d] = by[d] || { d: d, n: 0, paid: 0, rev: 0, c: 0 }; x.n++;
    if (paidP(j) > 0) { var aq = acceptedQuote(j), net = paidP(j) - (aq ? aq.taxP || 0 : 0) - refundedP(j), cs = pricing().costs, fee = j.status === 'CANCELLED' ? 0 : proFeeP(j); x.paid++; x.rev += net; x.c += net - fee - (Math.round(net * cs.payPct / 100 + cs.payFixedP) + cs.opsP + Math.round(Math.max(0, net) * cs.reworkPct / 100)); }
  });
  var pros = list('pros').filter(function (p) { return p.status === 'APPROVED'; });
  return Object.keys(by).map(function (k) { var x = by[k]; x.ll = pcLL(k); x.pros = pros.filter(function (p) { return covers(p, k); }).length; return x; }).sort(function (a, b) { return b.n - a.n; });
}
function anMap(areas) {
  var pts = areas.filter(function (a) { return a.ll; }); if (!pts.length) return '<p class="a-muted">No postcodes to map yet.</p>';
  var la = pts.map(function (p) { return p.ll[0]; }), lo = pts.map(function (p) { return p.ll[1]; }), pad = 0.08;
  var n = Math.max.apply(null, la) + pad, s = Math.min.apply(null, la) - pad, e = Math.max.apply(null, lo) + pad, w = Math.min.apply(null, lo) - pad;
  var k = Math.cos((n + s) / 2 * Math.PI / 180), spanX = (e - w) * k, spanY = n - s; if (spanX < spanY * 1.6) { var cx = (e + w) / 2, nx = spanY * 1.6 / k / 2; e = cx + nx; w = cx - nx; spanX = (e - w) * k; } else { var cy = (n + s) / 2, ny = spanX / 1.6 / 2; n = cy + ny; s = cy - ny; spanY = n - s; }
  var W = 640, H = 400, X = function (l) { return (l - w) * k / spanX * W; }, Y = function (l) { return (n - l) / spanY * H; }, mx = Math.max.apply(null, pts.map(function (p) { return p.n; }));
  var g = ''; for (var i = 1; i < 8; i++) { g += '<line x1="' + (W * i / 8) + '" x2="' + (W * i / 8) + '" y1="0" y2="' + H + '" class="gl"/>'; if (i < 5) g += '<line y1="' + (H * i / 5) + '" y2="' + (H * i / 5) + '" x1="0" x2="' + W + '" class="gl"/>'; }
  PC_TOWNS.forEach(function (t) { var x = X(t[2]), y = Y(t[1]); if (x > 10 && x < W - 10 && y > 10 && y < H - 10) g += '<circle cx="' + x + '" cy="' + y + '" r="2.5" class="town"/><text x="' + (x + 6) + '" y="' + (y - 6) + '" class="townl">' + t[0] + '</text>'; });
  pts.slice().sort(function (a, b) { return b.n - a.n; }).forEach(function (p) { var r = 6 + 16 * Math.sqrt(p.n / mx), x = X(p.ll[1]), y = Y(p.ll[0]); g += '<g class="pt' + (p.pros ? '' : ' gap') + '"><circle cx="' + x + '" cy="' + y + '" r="' + r + '"/><title>' + esc(p.d + ': ' + p.n + ' requests, ' + p.paid + ' paid, ' + P(p.rev) + ' revenue, ' + P(p.c) + ' contribution, ' + (p.pros ? p.pros + ' Pro' + (p.pros > 1 ? 's' : '') + ' cover it' : 'no Pro covers it')) + '</title></g>'; if (r > 11 || pts.length < 12) g += '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" class="ptl">' + esc(p.d) + '</text>'; });
  return '<svg class="an-map" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of requests by postcode district">' + g + '</svg><ul class="an-legend row"><li><i class="dot"></i><span>Requests (bubble size)</span></li><li><i class="dot gap"></i><span>' + ic('warning', 14) + ' No approved Pro covers this area</span></li><li><span class="a-fine">Approximate postcode-district centres</span></li></ul>';
}
function vAnalyticsCharts(per, m) {
  var order = ['INVENTORY', 'CHECK_IN', 'MID_TERM', 'CHECK_OUT', 'REPAIRS_DAMAGES', 'CLEANING'], h = '';
  var bySvc = order.map(function (k, i) { var x = m.svc[k] || { rev: 0 }; return { label: SVC[k].label, v: Math.max(0, x.rev), txt: P(x.rev), slot: i }; });
  var seg = {}; anJobs(per).forEach(function (j) { if (!(paidP(j) > 0)) return; var c = D.clients[j.clientId] || {}, s = c.segment || 'LANDLORD', aq = acceptedQuote(j); seg[s] = (seg[s] || 0) + paidP(j) - (aq ? aq.taxP || 0 : 0) - refundedP(j); });
  var segs = Object.keys(SEGMENTS).map(function (k, i) { return { label: SEGMENTS[k].label, v: Math.max(0, seg[k] || 0), txt: P(seg[k] || 0), slot: i }; });
  var where = [{ label: 'Pro fees', v: m.fees, txt: P(m.fees) }, { label: 'Payment, support and rework', v: m.direct, txt: P(m.direct) }, { label: 'Refunds', v: m.refunds, txt: P(m.refunds) }, { label: 'Rebates', v: m.rebates, txt: P(m.rebates) }, { label: 'Contribution', v: Math.max(0, m.C), txt: P(m.C) }].map(function (s, i) { s.slot = i; return s; });
  h += '<section class="a-sec"><h2>Mix</h2><div class="a-grid an-3">' + anDonut('Revenue by service', 'Net revenue from paid jobs.', bySvc, [P(m.net), 'net revenue']) + anDonut('Revenue by client type', 'Who the revenue comes from.', segs, [String(m.ind.clients), m.ind.clients === 1 ? 'client' : 'clients']) + anDonut('Where each £ of revenue goes', 'Gross revenue, excluding tax.', where, [m.gross ? Math.round(m.C / m.gross * 100) + '%' : '—', 'kept']) + '</div></section>';
  var mk = Object.keys(m.months).sort().slice(-6), cats = mk.map(function (k) { return MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4); });
  var cnt = order.map(function (k) { return anJobs(per).filter(function (j) { return svcKey(j) === k; }).length; });
  h += '<section class="a-sec"><h2>Trends</h2><div class="a-grid two-col">' + anColumns('Revenue and contribution by month', 'Paid jobs, by the month they were booked.', cats, [{ name: 'Net revenue', c: 'var(--an-1)', vals: mk.map(function (k) { return m.months[k].rev; }) }, { name: 'Contribution', c: 'var(--an-2)', vals: mk.map(function (k) { return m.months[k].c; }) }], function (v, ax) { return ax ? '£' + Math.round(v / 100) : P(v); }) +
    anColumns('Bookings by service', 'Every booking in the period, paid or not.', order.map(function (k) { return SVC[k].label.replace('Repairs & Maintenance', 'Repairs'); }), [{ name: 'Bookings', c: 'var(--an-1)', vals: cnt }], function (v) { return String(Math.round(v)); }, true) + '</div></section>';
  /* paid vs completed */
  var pj = anJobs(per).filter(function (j) { return paidP(j) > 0; }), pc = { done: 0, open: 0, canc: 0 }, pm = {};
  pj.forEach(function (j) { var st = j.status === 'COMPLETED' ? 'done' : j.status === 'CANCELLED' ? 'canc' : 'open'; pc[st]++; var k = monthKey(j.createdAt), x = pm[k] = pm[k] || { paid: 0, done: 0 }; x.paid++; if (st === 'done') x.done++; });
  var pmk = Object.keys(pm).sort().slice(-6);
  h += '<section class="a-sec"><h2>Paid vs completed</h2><div class="a-grid two-col">' + anDonut('Paid jobs by outcome', 'Of the jobs paid for in the period, how many are completed.', [{ label: 'Completed', v: pc.done, txt: String(pc.done), slot: 0 }, { label: 'Paid, not yet completed', v: pc.open, txt: String(pc.open), slot: 1 }, { label: 'Paid, then cancelled', v: pc.canc, txt: String(pc.canc), slot: 2 }], [pj.length ? Math.round(pc.done / pj.length * 100) + '%' : '—', 'completed']) +
    anColumns('Paid and completed jobs by month', 'Jobs by the month they were booked. Completion rate: ' + pmk.map(function (k) { return MON[+k.slice(5) - 1] + ' ' + (pm[k].paid ? Math.round(pm[k].done / pm[k].paid * 100) : 0) + '%'; }).join(' · ') + '.', pmk.map(function (k) { return MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4); }), [{ name: 'Paid', c: 'var(--an-1)', vals: pmk.map(function (k) { return pm[k].paid; }) }, { name: 'Completed', c: 'var(--an-2)', vals: pmk.map(function (k) { return pm[k].done; }) }], function (v) { return String(Math.round(v)); }, true) + '</div></section>';
  var areas = anAreas(per), gaps = areas.filter(function (a) { return !a.pros; });
  h += '<section class="a-sec"><h2>Locations</h2><div class="an-loc"><div class="a-card">' + '<div class="a-row sb"><h3>Where the work is</h3><label class="sr-only" for="an-zoom">Map area</label><select class="a-mini" id="an-zoom" data-filt="anZoom">' + [['all', 'All areas'], ['core', 'Bristol & Bath']].map(function (o) { return '<option value="' + o[0] + '"' + ((S.anZoom || 'all') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div><p class="a-fine">Requests by postcode district. Hover a bubble for revenue, contribution and Pro coverage.</p>' + anMap(S.anZoom === 'core' ? areas.filter(function (a) { return /^(BS|BA)\d/.test(a.d); }) : areas) + '</div><div class="a-card"><h3>Top areas by contribution</h3>' +
    anBars(areas.slice().sort(function (a, b) { return b.c - a.c; }).slice(0, 8).map(function (a) { return { label: a.d, sub: a.n + ' request' + (a.n === 1 ? '' : 's') + ' · ' + (a.pros ? a.pros + ' Pro' + (a.pros > 1 ? 's' : '') : 'no Pro cover'), v: a.c, txt: P(a.c) }; })) +
    (gaps.length ? '<div class="a-banner" style="--t:var(--warning-subtle);--c:var(--warning)">' + ic('warning', 20) + '<div><b>' + gaps.length + ' area' + (gaps.length > 1 ? 's have' : ' has') + ' demand but no Pro cover</b><p>' + esc(gaps.slice(0, 6).map(function (a) { return a.d + ' (' + a.n + ')'; }).join(', ')) + '. Jobs there wait longer to be assigned or can’t be fulfilled, which lowers payment conversion and repeat bookings.</p></div></div>' : '') + '</div></div></section>';
  return h;
}

/* ---------- disputes, invoices and Pro performance ---------- */
function anInPer(per, iso) { var d = (AN_PERIODS[per] || AN_PERIODS.d90)[1]; return !d || (iso && new Date(iso).getTime() >= Date.now() - d * 86400000); }
function anHrs(v) { return v == null ? '—' : v < 48 ? Math.round(v * 10) / 10 + ' h' : Math.round(v / 24 * 10) / 10 + ' days'; }
function vAnalyticsOps(per) {
  var h = '', jobs = list('jobs');
  /* disputes */
  var ds = []; jobs.forEach(function (j) { (j.disputes || []).forEach(function (d) { if (anInPer(per, d.at)) ds.push({ j: j, d: d }); }); });
  var settled = ds.filter(function (x) { return x.d.status === 'RESOLVED'; }), open = ds.length - settled.length, refundP = settled.reduce(function (a, x) { return a + (x.d.refundP || 0); }, 0);
  var tts = median(settled.filter(function (x) { return x.d.closedAt; }).map(function (x) { return (new Date(x.d.closedAt) - new Date(x.d.at)) / 3600000; })), done = jobs.filter(function (j) { return j.status === 'COMPLETED' && anInPer(per, j.createdAt); }).length;
  var outc = {}; settled.forEach(function (x) { var o = x.d.outcome || 'OTHER'; outc[o] = (outc[o] || 0) + 1; });
  var OUT = { NO_REFUND: 'No refund', PARTIAL_REFUND: 'Partial refund', FULL_REFUND: 'Full refund', REWORK: 'Correction or rework', CANCEL: 'Job cancelled', OTHER: 'Other' };
  h += '<section class="a-sec"><h2>Disputes</h2><div class="a-grid k">' + stat('Raised', ds.length) + stat('Settled', settled.length, ds.length ? Math.round(settled.length / ds.length * 100) + '% of raised' : '') + stat('Still open', open) + stat('Median time to settle', anHrs(tts)) + '</div><div class="a-grid two-col">' +
    anDonut('Raised vs settled', 'Disputes and complaints raised in the period.', [{ label: 'Settled', v: settled.length, txt: String(settled.length), slot: 0 }, { label: 'Open or under investigation', v: open, txt: String(open), slot: 1 }], [ds.length ? Math.round(settled.length / ds.length * 100) + '%' : '—', 'settled']) +
    '<section class="a-card an-chart"><h3>How disputes were settled</h3><p class="a-fine">' + (done ? Math.round(ds.length / done * 1000) / 10 + ' disputes per 100 completed jobs. ' : '') + 'Refunded through disputes: ' + P(refundP) + '.</p>' + (settled.length ? anBars(Object.keys(outc).sort(function (a, b) { return outc[b] - outc[a]; }).map(function (o) { return { label: OUT[o] || o, v: outc[o], txt: String(outc[o]) }; })) : '<p class="a-muted">No disputes settled in this period.</p>') +
    (ds.length ? '<h4 style="margin-top:8px">By reason</h4>' + anBars((function () { var c = {}; ds.forEach(function (x) { var k = x.d.category || 'Other'; c[k] = (c[k] || 0) + 1; }); return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (k) { return { label: k, v: c[k], txt: String(c[k]) }; }); })()) : '') + '</section></div></section>';
  /* invoices (repairs) */
  var inv = invoices().filter(function (x) { return anInPer(per, x.issued); }), paidI = inv.filter(function (x) { return ['PAID', 'PART', 'REFUNDED'].indexOf(x.st) >= 0; }), due = inv.filter(function (x) { return x.st === 'APPROVAL' || x.st === 'PAYMENT'; }), over = inv.filter(function (x) { return x.st === 'EXPIRED'; }), closedI = inv.filter(function (x) { return x.st === 'DECLINED' || x.st === 'CLOSED'; });
  var sum = function (a) { return a.reduce(function (t, x) { return t + x.amt; }, 0); }, tpay = median(paidI.filter(function (x) { return x.paidAt && x.issued; }).map(function (x) { return (new Date(x.paidAt) - new Date(x.issued)) / 3600000; }));
  var ivg = {}; paidI.concat(due, over).forEach(function (x) { var k = monthKey(x.issued), g = ivg[k] = ivg[k] || { paid: 0, unpaid: 0 }; if (paidI.indexOf(x) >= 0) g.paid += x.amt; else g.unpaid += x.amt; }); var ivm = Object.keys(ivg).sort().slice(-12);
  h += '<section class="a-sec"><h2>Invoices</h2><div class="a-grid k">' + stat('Issued', inv.length, P(sum(inv))) + stat('Paid', paidI.length, P(sum(paidI))) + stat('Unpaid', due.length + over.length, P(sum(due) + sum(over)) + (over.length ? ' · ' + over.length + ' expired' : '')) + stat('Median time to pay', anHrs(tpay)) + '</div><div>' +
    anColumns('Paid vs unpaid invoices by month', 'Invoice value by the month it was issued. The label above each month is the share of that month’s invoice value that has been paid.', ivm.map(function (k) { return MON[+k.slice(5) - 1] + ' ' + k.slice(2, 4); }), [{ name: 'Paid', c: 'var(--an-1)', vals: ivm.map(function (k) { return ivg[k].paid; }) }, { name: 'Unpaid', c: 'var(--an-2)', vals: ivm.map(function (k) { return ivg[k].unpaid; }) }], function (v, ax) { return ax ? '£' + Math.round(v / 100) : P(v); }, false, ivm.map(function (k) { var t = ivg[k].paid + ivg[k].unpaid; return t ? Math.round(ivg[k].paid / t * 100) + '% paid' : ''; }))+ '</div></section>';
  /* Pro performance */
  var pros = list('pros').filter(function (p) { return p.status === 'APPROVED' || p.status === 'SUSPENDED'; }), days = (AN_PERIODS[per] || AN_PERIODS.d90)[1];
  var rows = pros.map(function (p) {
    var of = { n: 0, acc: 0 }, mine = [], ontime = 0, timed = 0, ratio = [], corr = 0, disp = 0, earned = 0, rate = [], first = null;
    jobs.forEach(function (j) {
      (j.offers || []).forEach(function (o) { if (o.proId === p.id && anInPer(per, o.at)) { of.n++; if (o.status === 'ACCEPTED') of.acc++; } });
      if (j.proId !== p.id || !anInPer(per, j.scheduledAt || j.createdAt)) return; mine.push(j);
      var t = j.scheduledAt || j.createdAt; if (!first || t < first) first = t;
      var a = j.attendance || {}, st = winStart(j.window); if (a.inAt && st) { timed++; if (new Date(a.inAt) <= new Date(new Date(st).getTime() + 15 * 60000)) ontime++; }
      var aq = acceptedQuote(j); if (a.inAt && a.outAt && aq && aq.durationMin) ratio.push(((new Date(a.outAt) - new Date(a.inAt)) / 60000 - (+a.breakMin || 0)) / aq.durationMin);
      if ((j.history || []).some(function (x) { return /correction/i.test(x.text); })) corr++; disp += (j.disputes || []).length;
      var s = settlement(j); if (s.status === 'PAID' || s.status === 'ELIGIBLE') earned += s.amountP; if (j.rating && !j.rating.hidden) rate.push(j.rating.score);
    });
    var done = mine.filter(function (j) { return j.status === 'COMPLETED'; }).length, wk = Math.max(1, (days || Math.max(7, (Date.now() - new Date(first || now())) / 86400000)) / 7);
    return { p: p, offers: of.n, offerRate: of.n ? of.acc / of.n : null, assigned: mine.length, done: done, doneRate: mine.length ? done / mine.length : null, ontime: timed ? ontime / timed : null, ratio: median(ratio), corr: corr, disp: disp, rating: rate.length ? rate.reduce(function (a, b) { return a + b; }, 0) / rate.length : null, earned: earned, perWeek: done / wk };
  }).filter(function (r) { return r.offers || r.assigned; }).sort(function (a, b) { return b.done - a.done || b.perWeek - a.perWeek; });
  var pc = function (v) { return v == null ? '—' : Math.round(v * 100) + '%'; };
  var tot = rows.reduce(function (a, r) { a.o += r.offers; a.oa += r.offerRate == null ? 0 : r.offerRate * r.offers; a.as += r.assigned; a.d += r.done; return a; }, { o: 0, oa: 0, as: 0, d: 0 });
  h += '<section class="a-sec"><h2>Pro performance</h2>' + (rows.length ? '<div class="a-grid k">' + stat('Active Pros', rows.length) + stat('Offer acceptance', tot.o ? Math.round(tot.oa / tot.o * 100) + '%' : '—') + stat('Completion rate', tot.as ? Math.round(tot.d / tot.as * 100) + '%' : '—', tot.d + ' of ' + tot.as + ' assigned jobs') + stat('Productivity', Math.round(rows.reduce(function (a, r) { return a + r.perWeek; }, 0) / rows.length * 10) / 10, 'completed jobs per Pro per week') + '</div>' +
    '<div>' + '<section class="a-card an-chart"><h3>Productivity rate</h3><p class="a-fine">Completed jobs per week' + (days ? ' over the period' : ' since their first job') + '.</p>' + anBars(rows.slice(0, 8).map(function (r) { return { label: r.p.name || 'Pro', sub: proStats(r.p.id).levelName, v: r.perWeek, txt: Math.round(r.perWeek * 10) / 10 + ' / week' }; })) + '</section></div>' : empty('verified-pro', 'No Pro activity in this period', 'Pros appear here once they receive offers or jobs.', '')) + '</section>';
  return h;
}
