/* ===================== LISTD core: data, rules, store ===================== */
var COLS = ['clients', 'pros', 'properties', 'jobs', 'evidence', 'messages', 'notes', 'audit', 'trainings', 'applications', 'staff'];
var D = { clients: {}, pros: {}, properties: {}, jobs: {}, evidence: {}, messages: {}, notes: {}, audit: {}, trainings: {}, applications: {}, staff: {}, settings: null };
var ENV = { mode: 'connecting', db: null, assets: null, user: null, downloads: null, uid: null, canAdmin: false };
var S = { role: 'client', clientId: null, proId: null, view: 'home', params: {}, drafts: {}, wiz: null, modal: null, filter: 'all', ob: {} };
var LS_KEY = 'listd-app-v2', LOCAL_DATA = 'listd-local-data-v2';

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function now() { return new Date().toISOString(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function P(p) { p = Math.round(Number(p) || 0); var neg = p < 0; p = Math.abs(p); return (neg ? '−' : '') + '£' + Math.floor(p / 100).toLocaleString('en-GB') + '.' + String(p % 100).padStart(2, '0'); }
function toP(v) { var n = Number(String(v).replace(/[£,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fdate(iso, withTime) { if (!iso) return '—'; var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); if (isNaN(d)) return esc(iso); var s = d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); if (withTime) s += ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return s; }
function ic(n, s) { return '<svg class="ld-icon" width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
function district(pc) { return String(pc || '').trim().toUpperCase().split(/\s+/)[0] || ''; }
function list(col) { return Object.keys(D[col]).map(function (k) { return D[col][k]; }); }
function byNew(a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); }
function hoursFrom(iso) { return (new Date(iso).getTime() - Date.now()) / 3600000; }
function addH(iso, h) { return new Date(new Date(iso).getTime() + h * 3600000).toISOString(); }
function left(iso) { var h = hoursFrom(iso); if (h <= 0) return 'overdue'; if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min left'; if (h < 48) return Math.round(h) + 'h left'; return Math.round(h / 24) + ' days left'; }

/* ---------- catalogue ---------- */
var SEGMENTS = {
  ESTATE_AGENT: { label: 'Estate agent', icon: 'home', d: 'Coordinate property transitions across landlords.' },
  LANDLORD: { label: 'Landlord', icon: 'key', d: 'Arrange and verify work on your rentals.' },
  PROPERTY_MANAGER_DEVELOPER: { label: 'Property manager / developer', icon: 'users', d: 'Coordinate work across blocks and developments.' },
  HOUSING_ASSOCIATION: { label: 'Housing association', icon: 'escrow', d: 'Maintain homes and trace service outcomes.' }
};
var SKILLS = {
  CHECK_IN: { label: 'Check-in inspections', icon: 'check-in' }, CHECK_OUT: { label: 'Check-out inspections', icon: 'check-out' },
  REPAIRS_DAMAGES: { label: 'Repairs & damages', icon: 'settings' }, CLEANING: { label: 'Cleaning', icon: 'cleaning' }
};
var TYPES = { CHECK_IN: 'Check-In', CHECK_OUT: 'Check-Out', MAINTENANCE: 'Repairs & Cleaning' };
var KINDS = { REPAIRS_DAMAGES: 'Repairs & Damages', CLEANING: 'Cleaning' };
var SVC = {
  CHECK_IN: { label: 'Check-In', icon: 'check-in', c: 'var(--service-checkin)', t: 'var(--service-checkin-subtle)', tx: 'var(--service-checkin-text)', d: 'Condition and inventory inspection at the start of an occupancy.' },
  CHECK_OUT: { label: 'Check-Out', icon: 'check-out', c: 'var(--service-checkout)', t: 'var(--service-checkout-subtle)', tx: 'var(--service-checkout-text)', d: 'End-of-occupancy inspection, compared with the check-in where one exists.' },
  REPAIRS_DAMAGES: { label: 'Repairs & Damages', icon: 'settings', c: 'var(--service-midterm)', t: 'var(--service-midterm-subtle)', tx: 'var(--service-midterm-text)', d: 'Describe the damage. LISTD prices it from the damage assessed and sends you an invoice.' },
  CLEANING: { label: 'Cleaning', icon: 'cleaning', c: 'var(--service-cleaning)', t: 'var(--service-cleaning-subtle)', tx: 'var(--service-cleaning-text)', d: 'Light, General or Deep clean, priced by property size.' }
};
function svcKey(j) { return j.type === 'MAINTENANCE' ? j.kind : j.type; }
var CLEANS = {
  light: { label: 'Light Clean', d: 'A quick refresh where the property has been left in reasonable order.', list: ['Wipe all surfaces and sills', 'Vacuum and mop all floors', 'Empty and clean bins', 'Clean WCs, basins and taps', 'Wipe kitchen worktops and sink'] },
  general: { label: 'General Clean', d: 'A thorough clean throughout the property.', list: ['Kitchen units inside and out', 'Oven and hob cleaned', 'Fridge and freezer cleaned', 'Bathrooms fully cleaned', 'All floors vacuumed and mopped', 'Windows cleaned inside', 'Soft furnishings vacuumed', 'Bins emptied and cleaned'] },
  deep: { label: 'Deep Clean', d: 'A full deep clean of every area, including behind furniture.', list: ['Move furniture and clean behind and under', 'Descale bathrooms, showers and taps', 'Appliances cleaned inside and out', 'Oven fully degreased', 'Skirting boards, doors and frames wiped', 'Windows and frames inside', 'Light fittings and switches cleaned', 'Kitchen units inside and out', 'All floors deep cleaned', 'Detailed finishing throughout'] }
};
var SEVERITY = { low: 'Low: cosmetic or minor', medium: 'Medium: affects use', high: 'High: needs prompt attention', unsafe: 'Unsafe / emergency' };
var COND = { excellent: ['Excellent', 'var(--success-fill)', 'var(--success-subtle)', 4], good: ['Good', 'var(--info-fill)', 'var(--info-subtle)', 3], fair: ['Fair', 'var(--warning-fill)', 'var(--warning-subtle)', 2], poor: ['Poor', 'var(--danger-fill)', 'var(--danger-subtle)', 1], na: ['Not inspected', 'var(--border-strong)', 'var(--surface-sunken)', 0] };
var FIND = { none: 'No change', new: 'New damage', existing: 'Existing', uncertain: 'Uncertain' };
var WINDOWS = { morning: ['Morning', '08:00', '12:00'], afternoon: ['Afternoon', '12:00', '16:00'], evening: ['Evening', '16:00', '19:00'] };
function winLabel(w) { if (!w || !w.date) return '—'; var x = WINDOWS[w.slot] || WINDOWS.morning; return fdate(w.date) + ', ' + x[1] + '–' + x[2]; }
function winStart(w) { return w && w.date ? new Date(w.date + 'T' + (WINDOWS[w.slot] || WINDOWS.morning)[1] + ':00').toISOString() : null; }

var STATUS = {
  SUBMITTED: ['Awaiting quote', 'var(--status-booked)'], NEEDS_INFORMATION: ['More info needed', 'var(--status-awaiting)'], QUOTED: ['Quote ready', 'var(--status-awaiting)'],
  AWAITING_PAYMENT: ['Awaiting payment', 'var(--status-awaiting)'], READY_FOR_ASSIGNMENT: ['Finding a Pro', 'var(--status-booked)'], SCHEDULED: ['Scheduled', 'var(--status-accepted)'],
  IN_PROGRESS: ['In progress', 'var(--status-progress)'], ADMIN_REVIEW: ['Report in LISTD review', 'var(--status-progress)'], CORRECTION_REQUIRED: ['Correction required', 'var(--status-disputed)'],
  CLIENT_REVIEW: ['Ready for your review', 'var(--status-awaiting)'], COMPLETED: ['Completed', 'var(--status-signed)'], ON_HOLD: ['On hold', 'var(--status-disputed)'], CANCELLED: ['Cancelled', 'var(--border-strong)']
};
var OPEN_STATES = ['SUBMITTED', 'NEEDS_INFORMATION', 'QUOTED', 'AWAITING_PAYMENT', 'READY_FOR_ASSIGNMENT', 'SCHEDULED', 'IN_PROGRESS', 'ADMIN_REVIEW', 'CORRECTION_REQUIRED', 'CLIENT_REVIEW', 'ON_HOLD'];
var STARTED = ['IN_PROGRESS', 'ADMIN_REVIEW', 'CORRECTION_REQUIRED', 'CLIENT_REVIEW', 'COMPLETED'];
/* Pro levels. Levels 1-3 are cleaning; Levels 4-5 add inspections and pay more. Repairs & Damages is a trade skill approved separately, outside the levels. */
var LEVEL_INFO = [null,
  { name: 'Cleaner', unlocks: 'Light cleans' },
  { name: 'Experienced cleaner', unlocks: 'Light and General cleans' },
  { name: 'Senior cleaner', unlocks: 'All cleans, including Deep cleans' },
  { name: 'Inspector', unlocks: 'Check-in and check-out inspections (up to 3 bedrooms), plus all cleans' },
  { name: 'Senior inspector', unlocks: 'Inspections on every property size, including 4+ bedrooms, plus all cleans' }];

/* ---------- policies (Admin-configurable) ---------- */
var DEFAULT_SETTINGS = {
  company: { name: 'LISTD Inventory', address: 'Suite 41, 14-15 Triangle South, Clifton, Bristol', phone: '07413065681', email: 'hello@listdinventory.co.uk' },
  quoteValidityDays: 7, offerValidityHours: 12, reviewHours: 48, rescheduleHours: 24, proFeePct: 75,
  levels: [{ minJobs: 0, minRating: 0, sharePct: 60 }, { minJobs: 5, minRating: 4.0, sharePct: 65 }, { minJobs: 15, minRating: 4.3, sharePct: 70 }, { minJobs: 25, minRating: 4.5, sharePct: 75 }, { minJobs: 40, minRating: 4.7, sharePct: 80 }],
  repairCategories: ['Plumbing', 'Electrical', 'Appliances', 'Fixtures & decor', 'Other'],
  guide: { CHECK_IN: { base: 5500, bed: 1000 }, CHECK_OUT: { base: 5500, bed: 1000 }, light: { base: 6000, bed: 1500, bath: 1000 }, general: { base: 9000, bed: 2500, bath: 1500 }, deep: { base: 14000, bed: 4000, bath: 2500 } }
};
function settings() { var s = D.settings || {}, d = DEFAULT_SETTINGS, o = {}; Object.keys(d).forEach(function (k) { o[k] = s[k] != null ? s[k] : d[k]; }); o.guide = Object.assign({}, d.guide, s.guide || {}); return o; }
/* price guide used by Admin to prefill quote lines — not shown to clients as a price */
function guideLines(j) {
  var p = D.properties[j.propertyId] || {}, g = settings().guide, beds = Math.max(0, (+p.bedrooms || 1) - 1), baths = Math.max(0, (+p.bathrooms || 1) - 1), L = [];
  if (j.type === 'CHECK_IN' || j.type === 'CHECK_OUT') { L.push({ d: TYPES[j.type] + ' inspection and report', q: 1, u: g[j.type].base }); if (beds) L.push({ d: 'Additional bedroom', q: beds, u: g[j.type].bed }); }
  else if (j.kind === 'CLEANING') { var c = g[j.scope.clean] || g.general; L.push({ d: CLEANS[j.scope.clean].label, q: 1, u: c.base }); if (beds) L.push({ d: 'Additional bedroom', q: beds, u: c.bed }); if (baths) L.push({ d: 'Additional bathroom', q: baths, u: c.bath }); }
  else L.push({ d: 'Labour: ' + (j.scope.category || 'repair'), q: 1, u: 0 }, { d: 'Materials', q: 1, u: 0 });
  return L;
}
function quoteTotal(q) { var sub = q.lines.reduce(function (a, l) { return a + Math.round(l.q * l.u); }, 0); return { sub: sub, total: Math.max(0, sub + (q.taxP || 0) - (q.discP || 0)) }; }
function curQuote(j) { return (j.quotes || []).filter(function (q) { return q.status === 'ISSUED' || q.status === 'ACCEPTED'; }).slice(-1)[0] || null; }
function acceptedQuote(j) { return (j.quotes || []).filter(function (q) { return q.status === 'ACCEPTED'; }).slice(-1)[0] || null; }
function paidP(j) { return (j.payments || []).filter(function (p) { return p.status === 'SUCCEEDED'; }).reduce(function (a, p) { return a + p.amountP; }, 0); }
function refundedP(j) { return (j.refunds || []).reduce(function (a, r) { return a + r.amountP; }, 0); }
function proFeeP(j) { var q = acceptedQuote(j), f = j.agreedFeeP != null ? j.agreedFeeP : q ? q.proFeeP : 0; (j.changeOrders || []).forEach(function (c) { if (c.status === 'PAID') f += c.proFeeP || 0; }); return f + (j.feeAdjP || 0); }
function openDispute(j) { return (j.disputes || []).filter(function (d) { return d.status !== 'RESOLVED'; })[0] || null; }
function settlement(j) {
  if (j.settlement && j.settlement.status === 'PAID') return j.settlement;
  var pro = D.pros[j.proId], amt = Math.max(0, proFeeP(j));
  if (j.status === 'CANCELLED' && !(j.settlement && j.settlement.status)) return { status: 'NONE', amountP: 0 };
  if (!j.proId) return { status: 'NONE', amountP: 0 };
  if (j.status !== 'COMPLETED') return { status: 'BLOCKED', amountP: amt, why: 'Job not completed' };
  if (openDispute(j)) return { status: 'BLOCKED', amountP: amt, why: 'Open dispute' };
  if (!pro || !pro.payout || !pro.payout.ready) return { status: 'BLOCKED', amountP: amt, why: 'Pro payout account not set up' };
  if (amt <= 0) return { status: 'NONE', amountP: 0 };
  return { status: 'ELIGIBLE', amountP: amt };
}
function currentOffer(j) { return (j.offers || []).filter(function (o) { return o.status === 'OFFERED'; })[0] || null; }
function latestReport(j) { return (j.reports || []).slice(-1)[0] || null; }
function releasedReport(j) { return (j.reports || []).filter(function (r) { return r.status === 'RELEASED'; }).slice(-1)[0] || null; }

function proLevel(p) { var l = p ? +(p.level || p.levelOverride || 1) : 1; return Math.min(5, Math.max(1, l || 1)); }
function proStats(proId) {
  var jobs = list('jobs').filter(function (j) { return j.proId === proId; });
  var done = jobs.filter(function (j) { return j.status === 'COMPLETED'; }), rated = done.filter(function (j) { return j.rating && !j.rating.hidden; });
  var n = done.length, pr = D.pros[proId], lv = proLevel(pr);
  var paid = 0, payable = 0, pending = 0;
  jobs.forEach(function (j) { var s = settlement(j); if (s.status === 'PAID') paid += s.amountP; else if (s.status === 'ELIGIBLE') payable += s.amountP; else if (s.status === 'BLOCKED') pending += s.amountP; });
  return { completed: n, level: lv, levelName: LEVEL_INFO[lv].name, rating: rated.length ? rated.reduce(function (a, j) { return a + j.rating.score; }, 0) / rated.length : null, ratings: rated.length, paid: paid, payable: payable, pending: pending, active: jobs.filter(function (j) { return ['SCHEDULED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'].indexOf(j.status) >= 0; }).length };
}

/* ---------- report templates ---------- */
function inspectionTemplate(prop, j) {
  var furn = prop.furnishing !== 'unfurnished', base = [{ name: 'Entrance & hallway', items: ['Front door & locks', 'Walls', 'Flooring', 'Smoke alarm'] }, { name: 'Living room', items: ['Walls & ceiling', 'Flooring', 'Windows', 'Doors'].concat(furn ? ['Furniture'] : []) }, { name: 'Kitchen', items: ['Walls & ceiling', 'Flooring', 'Units & worktops', 'Oven & hob', 'Fridge / freezer', 'Sink & taps'] }];
  for (var b = 1; b <= Math.max(1, +prop.bedrooms || 1); b++) base.push({ name: 'Bedroom ' + b, items: ['Walls & ceiling', 'Flooring', 'Windows', 'Doors'].concat(furn ? ['Bed & furniture'] : []) });
  for (var w = 1; w <= Math.max(1, +prop.bathrooms || 1); w++) base.push({ name: +prop.bathrooms > 1 ? 'Bathroom ' + w : 'Bathroom', items: ['Walls & tiles', 'Bath / shower', 'Toilet', 'Basin & taps', 'Extractor fan'] });
  base.push({ name: 'Exterior', items: ['Front of property', 'Garden / yard', 'Bins'] });
  var baseline = j && j.baselineId && D.jobs[j.baselineId] ? releasedReport(D.jobs[j.baselineId]) : null, bmap = {};
  if (baseline) baseline.sections.rooms.forEach(function (rm) { bmap[rm.name] = rm; });
  var rooms = base.map(function (r) { return { name: r.name, note: '', items: r.items.map(function (n) { return { name: n, cond: '', note: '', find: '' }; }) }; });
  if (baseline) baseline.sections.rooms.forEach(function (rm) { if (!rooms.some(function (r) { return r.name === rm.name; })) rooms.push({ name: rm.name, note: '', items: rm.items.map(function (it) { return { name: it.name, cond: '', note: '', find: '' }; }) }); });
  return { rooms: rooms, inventory: '', defects: '', meters: { electricity: '', gas: '', water: '', na: '' }, keys: '', occupant: '', summary: '' };
}
function newReport(j) {
  var k = svcKey(j), prop = D.properties[j.propertyId] || {};
  if (k === 'CHECK_IN' || k === 'CHECK_OUT') return inspTemplate(prop, j);
  if (k === 'CLEANING') return { checklist: CLEANS[j.scope.clean || 'general'].list.map(function (t) { return { t: t, done: false, na: '' }; }), exclusions: '', issues: '', summary: '' };
  return { diagnosis: '', work: '', materials: '', tests: '', unresolved: '', summary: '' };
}
function findBaseline(propertyId, beforeIso) {
  return list('jobs').filter(function (j) { return j.propertyId === propertyId && j.type === 'CHECK_IN' && releasedReport(j) && (!beforeIso || j.createdAt < beforeIso); }).sort(byNew)[0] || null;
}

/* ---------- store ---------- */
var listeners = [];
function changed() { listeners.forEach(function (f) { f(); }); }
function localSave() { if (ENV.mode === 'local') lsSet(LOCAL_DATA, D); }
var WQ = {};
function queued(key, fn) { var p = (WQ[key] || Promise.resolve()).then(fn, fn); WQ[key] = p.catch(function () {}); return p; }
function setDoc(col, id, obj) {
  if (col === 'settings') D.settings = obj; else D[col][id] = Object.assign({ id: id }, obj);
  changed();
  if (ENV.mode === 'db') { var body = Object.assign({}, obj); delete body.id; return queued(col + '/' + id, function () { return ENV.db.collection(col).doc(id).set(body); }).catch(writeFail); }
  localSave(); return Promise.resolve();
}
function patchDoc(col, id, part) {
  var cur = D[col][id]; if (!cur) return Promise.resolve();
  part = Object.assign({}, part, { updatedAt: now() });
  D[col][id] = Object.assign({}, cur, part); changed();
  if (ENV.mode === 'db') return queued(col + '/' + id, function () { return ENV.db.collection(col).doc(id).update(part); }).catch(writeFail);
  localSave(); return Promise.resolve();
}
function writeFail(e) { toast(e && e.code === 'quota_exceeded' ? 'Storage is full. Ask an admin to archive old photos.' : (e && (e.code === 'invalid_argument' || e.code === 'permission_denied') ? 'You don’t have permission to make changes here. Ask the owner for access.' : 'Couldn’t save. Check your connection and try again.')); }

/* history, audit and notifications */
function hist(j, text, role) { var tl = (j.history || []).slice(); tl.push({ at: now(), role: role || S.role, text: text }); return tl; }
function audit(action, resType, resId, reason, extra) { setDoc('audit', uid(), { action: action, resType: resType, resId: resId, reason: reason || '', role: S.role, actor: ENV.uid || 'local-admin', extra: extra || null, at: now(), createdAt: now() }); }
function notify(to, text, jobId) { if (!to) return; setDoc('notes', uid(), { to: to, text: text, jobId: jobId || null, read: false, at: now(), createdAt: now() }); }
function notifyJob(j, who, text) { (who.indexOf('client') >= 0) && notify('c:' + j.clientId, text, j.id); (who.indexOf('pro') >= 0 && j.proId) && notify('p:' + j.proId, text, j.id); (who.indexOf('admin') >= 0) && notify('admin', text, j.id); }
function myInbox() { var k = S.role === 'admin' ? 'admin' : S.role === 'pro' ? 'p:' + S.proId : 'c:' + S.clientId; return list('notes').filter(function (n) { return n.to === k; }).sort(byNew); }

async function boot() {
  var st = lsGet(LS_KEY) || {}; S.role = st.role || 'client'; S.clientId = st.clientId || null; S.proId = st.proId || null; inviteFromUrl();
  render();
  var C = window.claude;
  if (!C || !C.use) return goLocal();
  var dbp = C.use('db'), up = C.use('user'), ap = C.use('assets'), dp = C.use('downloads'), sp = C.use('sample');
  var t = setTimeout(goLocal, 11000);
  var db = null; try { db = await dbp; } catch (e) { db = null; }
  clearTimeout(t);
  if (!db) return goLocal();
  ENV.db = db; ENV.mode = 'db';
  try { ENV.user = await up; } catch (e) {}
  try { ENV.assets = await ap; } catch (e) {}
  try { ENV.downloads = await dp; } catch (e) {}
  try { ENV.sample = await sp; } catch (e) {}
  try { ENV.uid = ENV.user ? await ENV.user.id() : null; ENV.canAdmin = ENV.user ? await ENV.user.canEdit() : false; } catch (e) {}
  COLS.forEach(function (col) {
    db.collection(col).onSnapshot(function (snap) { var m = {}; snap.docs.forEach(function (d) { m[d.id] = Object.assign({ id: d.id }, d.data()); }); D[col] = m; changed(); }, function () { toast('Live updates paused. Reload to reconnect.'); });
  });
  db.doc('settings/policy').onSnapshot(function (s) { D.settings = s.exists ? s.data() : null; changed(); }, function () {});
  ENV.ready = true; render();
}
function goLocal() {
  if (ENV.mode === 'db') return;
  ENV.mode = 'local'; ENV.canAdmin = true; ENV.sample = window.__listdSampleMock || null;
  var saved = lsGet(LOCAL_DATA); if (saved) COLS.concat(['settings']).forEach(function (c) { if (saved[c]) D[c] = saved[c]; });
  ENV.ready = true; render();
}
function persistUI() { lsSet(LS_KEY, { role: S.role, clientId: S.clientId, proId: S.proId }); }

/* ---------- files ---------- */
function downscale(file, max, q) {
  return new Promise(function (res, rej) {
    var r = new FileReader(); r.onerror = rej;
    r.onload = function () { var im = new Image(); im.onerror = rej; im.onload = function () { var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(function (b) { res({ blob: b, url: c.toDataURL('image/jpeg', q) }); }, 'image/jpeg', q); }; im.src = r.result; };
    r.readAsDataURL(file);
  });
}
var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
async function addFiles(meta, files) {
  var ids = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var isPdf = f.type === 'application/pdf';
    if (ALLOWED.indexOf(f.type) < 0 && !(isPdf && meta.allowPdf)) { toast(f.name + ': use a JPEG, PNG or WebP image' + (meta.allowPdf ? ' or a PDF' : '') + '.'); continue; }
    if (f.size > (isPdf ? 20 : 10) * 1048576) { toast(f.name + ' is too large (max ' + (isPdf ? 20 : 10) + ' MB).'); continue; }
    var rec = Object.assign({ at: now(), by: S.role === 'pro' ? 'p:' + S.proId : S.role === 'client' ? 'c:' + S.clientId : 'admin', name: f.name, type: isPdf ? 'pdf' : 'image', createdAt: now() }, meta); delete rec.allowPdf;
    try {
      if (isPdf) { if (!ENV.assets) { toast('PDF upload needs the published app. Upload a photo of the document instead.'); continue; } var u = await ENV.assets.upload(f); rec.assetId = u.id; }
      else if (ENV.assets) { var big = await downscale(f, 1600, 0.82); var up = await ENV.assets.upload(big.blob); rec.assetId = up.id; }
      else { var sm = await downscale(f, 560, 0.7); rec.dataUrl = sm.url; }
      var id = uid(); await setDoc('evidence', id, rec); ids.push(id);
    } catch (e) { toast('A file couldn’t be added. Try a smaller image.'); }
  }
  if (ids.length) toast(ids.length + ' file' + (ids.length > 1 ? 's' : '') + ' added');
  return ids;
}
function fileSrc(e) { return !e ? '' : e.assetId ? '/_blob/' + e.assetId : e.dataUrl; }
function evFor(f) { return list('evidence').filter(function (e) { for (var k in f) if (e[k] !== f[k]) return false; return true; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }); }

/* ---------- small UI parts ---------- */
function isInv(j) { return !!j && svcKey(j) === 'REPAIRS_DAMAGES'; }
function qWord(j, cap) { var w = isInv(j) ? 'invoice' : 'quote'; return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
function statusPill(s, j) { var x = STATUS[s] || [s, 'var(--border)']; if (isInv(j) && { SUBMITTED: 1, QUOTED: 1 }[s]) x = [s === 'SUBMITTED' ? 'Being assessed' : 'Invoice ready', x[1]]; return '<span class="ld-pill" style="--c:' + x[1] + '"><i aria-hidden="true"></i>' + esc(x[0]) + '</span>'; }
function svcTag(j) { var k = SVC[svcKey(j)] || SVC.CHECK_IN; return '<span class="ld-tag" style="--t:' + k.t + ';--tx:' + k.tx + '">' + ic(k.icon, 16) + esc(k.label) + '</span>'; }
function condChip(c) { var x = COND[c] || COND.na; return '<span class="ld-cond" style="--c:' + x[1] + ';--t:' + x[2] + '">' + x[0] + '</span>'; }
function badge(text, tone, icon) { return '<span class="ld-badge' + (tone ? ' ld-badge-' + tone : '') + '">' + (icon ? ic(icon, 14) : '') + esc(text) + '</span>'; }
function payLabel(j) { var p = paidP(j), r = refundedP(j); return !p ? 'Not paid' : r >= p ? 'Refunded' : r ? 'Part refunded' : 'Paid'; }
function payBadge(j) { var l = payLabel(j); return badge(l, l === 'Paid' ? 'success' : l === 'Not paid' ? '' : 'info', 'pound'); }
function setBadge(j) { var s = settlement(j); return s.status === 'PAID' ? badge('Pro paid ' + P(s.amountP), 'success', 'escrow') : s.status === 'ELIGIBLE' ? badge('Payout eligible ' + P(s.amountP), 'brand', 'escrow') : s.status === 'BLOCKED' ? badge('Payout blocked', 'warning', 'escrow') : ''; }
function levelBar(lv, name) { var s = ''; for (var i = 1; i <= 5; i++) s += '<i class="' + (i <= lv ? 'on' : '') + '"></i>'; return '<span class="ld-level"><span aria-hidden="true">' + s + '</span>Level ' + lv + ' · ' + esc(name) + '</span>'; }
function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(); }
function avatar(n, verified, size) { return '<span class="ld-avatar' + (size ? ' ld-avatar-' + size : '') + '"><span role="img" aria-label="' + esc(n) + '">' + esc(initials(n)) + '</span>' + (verified ? '<span class="v" title="Verified Pro">' + ic('check', 10) + '</span>' : '') + '</span>'; }
function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += '<span aria-hidden="true" style="color:' + (i <= Math.round(n) ? 'var(--live)' : 'var(--border-strong)') + '">★</span>'; return '<span title="' + (n ? n.toFixed(1) : 'No ratings') + ' out of 5"><span class="sr-only">' + (n ? n.toFixed(1) + ' out of 5' : 'No ratings') + '</span>' + s + '</span>'; }
function empty(icon, title, body, action) { return '<div class="a-empty"><div class="ic">' + ic(icon, 26) + '</div><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p>' + (action || '') + '</div>'; }
function propOf(j) { return D.properties[j.propertyId] || {}; }
function stat(k, v, sub) { return '<div class="a-card a-stat"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span>' + (sub ? '<span class="a-fine">' + sub + '</span>' : '') + '</div>'; }
function jobRow(j, who) {
  var k = SVC[svcKey(j)] || SVC.CHECK_IN, p = propOf(j), sub = [esc(j.ref)];
  if (j.window && j.window.date) sub.push(winLabel(j.window));
  if (who === 'admin' || who === 'pro') { var c = D.clients[j.clientId]; if (c && who === 'admin') sub.push(esc(c.orgName || c.name)); }
  if (who !== 'pro' && j.proId && D.pros[j.proId]) sub.push('Pro: ' + esc(D.pros[j.proId].name));
  var q = curQuote(j), right = who === 'pro' ? (currentOffer(j) && currentOffer(j).proId === S.proId ? P(currentOffer(j).feeP) : j.proId === S.proId ? P(proFeeP(j)) : '') : q ? P(q.totalP) : '';
  var flag = openDispute(j) ? badge('Dispute open', 'danger', 'flag') : '';
  return '<button class="a-job" type="button" data-act="open-job" data-id="' + j.id + '" style="--c:' + k.c + '"><span class="bar"></span><span class="t"><span class="a-row" style="gap:8px">' + svcTag(j) + (j.scope && j.scope.clean ? badge(CLEANS[j.scope.clean].label) : '') + flag + '</span><b>' + esc(p.label || p.address || 'Property') + (p.postcode ? ', ' + esc(p.postcode) : '') + '</b><span>' + sub.join(' · ') + '</span></span><span class="r">' + statusPill(j.status, j) + '<span class="price">' + right + '</span></span></button>';
}
var toastT; function toast(m) { var el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'a-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.hidden = true; document.body.appendChild(el); } el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3600); }
function nextRef() { var n = 1001 + list('jobs').length, r; do { r = 'LJ-' + (n++); } while (list('jobs').some(function (j) { return j.ref === r; })); return r; }
function field(id, label, input, hint) { return '<div class="ld-field"><label class="ld-label" for="' + id + '">' + label + '</label>' + input + (hint ? '<span class="ld-hint">' + hint + '</span>' : '') + '</div>'; }
function inp(id, name, val, attrs) { return '<div class="ld-control"><input class="ld-input" id="' + id + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '></div>'; }
function area(id, name, val, attrs) { return '<div class="ld-control ld-control-area"><textarea class="ld-input" id="' + id + '" name="' + name + '" rows="3" ' + (attrs || '') + '>' + esc(val || '') + '</textarea></div>'; }
function sel(id, name, opts, val, attrs) { return '<div class="ld-control"><select class="ld-select" id="' + id + '" name="' + name + '" ' + (attrs || '') + '>' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>' + ic('chevron-down', 18) + '</div>'; }
function upBtn(meta, label, multiple) { return '<label class="a-up">' + ic('camera', 18) + esc(label) + '<input type="file" accept="image/jpeg,image/png,image/webp' + (meta.allowPdf ? ',application/pdf' : '') + '"' + (multiple === false ? '' : ' multiple') + ' data-up=\'' + esc(JSON.stringify(meta)) + '\'></label>'; }
function photoGrid(ph) {
  if (!ph.length) return '';
  return '<div class="a-photos">' + ph.map(function (e, i) { return e.type === 'pdf' ? '<a class="a-ph pdf" href="' + esc(fileSrc(e)) + '" target="_blank" rel="noopener">' + ic('file', 28) + '<figcaption>' + esc(e.name || 'Document') + '</figcaption></a>' : '<figure class="a-ph"><img src="' + esc(fileSrc(e)) + '" alt="' + esc((e.stage ? e.stage + ' photo' : 'Photo') + (e.area ? ', ' + e.area : '')) + '" loading="lazy">' + ({ BEFORE: 1, AFTER: 1, ATTEND: 1 }[e.stage] ? '<span class="ph">' + ({ BEFORE: 'Before', AFTER: 'After', ATTEND: e.area === 'clock-out' ? 'Clock-out' : 'Arrival' })[e.stage] + '</span>' : '') + '<figcaption>' + fdate(e.at, true) + '</figcaption></figure>'; }).join('') + '</div>';
}
