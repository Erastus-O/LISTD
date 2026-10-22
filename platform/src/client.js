/* ===================== Client portal ===================== */
function clientNav() { return [['home', 'home', 'Dashboard'], ['jobs', 'file', 'Requests'], ['properties', 'key', 'Properties'], ['invoices', 'invoice', 'Invoices'], ['payments', 'pound', 'Payments'], ['settings', 'settings', 'Settings']]; }
function me() { return D.clients[S.clientId] || null; }
function myJobs() { return list('jobs').filter(function (j) { return j.clientId === S.clientId; }).sort(byNew); }
function myProps() { return list('properties').filter(function (p) { return p.clientId === S.clientId && p.active !== false; }).sort(byNew); }
function clientOnboarded() { var c = me(); return c && c.onboarding && c.onboarding.status === 'DONE'; }
function clientNeeds(j) { var co = (j.changeOrders || []).some(function (c) { return c.status === 'ISSUED'; }), sc = j.scheduleChange && j.scheduleChange.status === 'PROPOSED' && !j.scheduleChange.clientOk; return ['QUOTED', 'AWAITING_PAYMENT', 'NEEDS_INFORMATION', 'CLIENT_REVIEW'].indexOf(j.status) >= 0 || co || sc || (j.status === 'COMPLETED' && !j.rating); }

/* ---------- onboarding (save & resume) ---------- */
var CL_STEPS = ['Account type', 'Profile', 'Billing', 'First property', 'Review'];
function vClientOnboard() {
  var c = me(), step = c.onboarding.step || 1, h = '<div class="a-page" style="max-width:780px"><div class="a-head"><div><h1>' + (step === 1 ? 'Welcome, ' + esc(String(c.name || '').split(' ')[0]) : 'Finish setting up') + '</h1><p>' + (step === 1 ? 'A few details so we can set up your account. Your progress is saved as you go.' : 'Your progress is saved. Pick up where you left off.') + '</p></div></div><div class="a-steps">' + CL_STEPS.map(function (s, i) { return '<span class="' + (i + 1 === step ? 'on' : i + 1 < step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('') + '</div>';
  if (step === 1) {
    h += '<form class="a-card a-form" data-form="cl-ob1"><fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px"><legend class="ld-label" style="margin-bottom:8px">Which best describes you?</legend><div class="a-choice">' + Object.keys(SEGMENTS).map(function (k, i) { var t = SEGMENTS[k]; return '<label class="a-opt"><input type="radio" name="segment" value="' + k + '"' + (i === 0 ? ' checked' : '') + '><span class="ic" style="--c:var(--brand-subtle);color:var(--brand-text)">' + ic(t.icon, 20) + '</span><b>' + t.label + '</b><span>' + t.d + '</span></label>'; }).join('') + '</div></fieldset>' +
      '<label class="ld-check"><input type="checkbox" name="authority" required><span>I’m authorised to book services and arrange access for the properties I add</span></label>' +
      '<div class="a-actions"><button class="ld-btn ld-btn-primary ld-btn-lg" type="submit">Continue</button></div></form>';
  } else if (step === 2) {
    var s = c.segment, isOrg = s !== 'LANDLORD';
    h += '<form class="a-card a-form" data-form="cl-ob2"><h3>' + SEGMENTS[s].label + ' profile</h3>' +
      (s === 'LANDLORD' ? field('ob-ls', 'Are you letting as', sel('ob-ls', 'landlordType', [['individual', 'An individual'], ['business', 'A business / company']], c.landlordType || 'individual')) + field('ob-org', 'Business name <small>Only if letting as a business</small>', inp('ob-org', 'orgName', c.orgName)) : field('ob-org', (s === 'ESTATE_AGENT' ? 'Agency name' : s === 'HOUSING_ASSOCIATION' ? 'Association name' : 'Organisation name'), inp('ob-org', 'orgName', c.orgName, 'required'))) +
      (s === 'PROPERTY_MANAGER_DEVELOPER' ? field('ob-md', 'You are a', sel('ob-md', 'mdRole', [['manager', 'Property manager'], ['developer', 'Developer'], ['both', 'Both']], c.mdRole || 'manager')) : '') +
      (s === 'ESTATE_AGENT' ? field('ob-br', 'Branch <small>Optional</small>', inp('ob-br', 'branch', c.branch)) : '') +
      field('ob-ph', 'Phone', inp('ob-ph', 'phone', c.phone, 'type="tel" autocomplete="tel"')) +
      '<div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>';
  } else if (step === 3) {
    var b = c.billing || {};
    h += '<form class="a-card a-form" data-form="cl-ob3"><h3>Billing contact</h3><p class="a-muted">Receipts go here. Card details are only taken on the secure checkout page.</p><div class="two">' + field('ob-bn', 'Contact name', inp('ob-bn', 'bname', b.name || c.name, 'required')) + field('ob-be', 'Billing email', inp('ob-be', 'bemail', b.email || c.email, 'type="email" required')) + '</div>' +
      field('ob-ba', 'Billing address', inp('ob-ba', 'baddr', b.address, 'required autocomplete="street-address"')) + '<div class="two">' + field('ob-bc', 'Town / city', inp('ob-bc', 'bcity', b.city, 'required')) + field('ob-bp', 'Postcode', inp('ob-bp', 'bpc', b.postcode, 'required autocapitalize="characters"')) + '</div>' +
      '<div class="a-actions"><button class="ld-btn ld-btn-secondary" type="button" data-act="ob-back">Back</button><button class="ld-btn ld-btn-primary" type="submit">Save & continue</button></div></form>';
  } else if (step === 4) {
    h += '<form class="a-card a-form" data-form="prop" data-ob="1"><h3>Add your first property</h3>' + propFields(null) + '<div class="a-actions"><button class="ld-btn ld-btn-secondary" type="button" data-act="ob-back">Back</button><button class="ld-btn ld-btn-primary" type="submit">Save property & continue</button></div></form>';
  } else {
    var p = myProps()[0] || {};
    h += '<div class="a-card"><h3>Check your details</h3><dl class="a-kv"><dt>Account type</dt><dd>' + esc(SEGMENTS[c.segment].label) + (c.mdRole ? ' (' + esc(c.mdRole) + ')' : '') + '</dd><dt>Name</dt><dd>' + esc(c.name) + '</dd>' + (c.orgName ? '<dt>Organisation</dt><dd>' + esc(c.orgName) + '</dd>' : '') + '<dt>Billing</dt><dd>' + esc((c.billing || {}).name) + ', ' + esc((c.billing || {}).email) + '</dd><dt>First property</dt><dd>' + esc(p.label || p.address || '—') + '</dd></dl><div class="a-actions"><button class="ld-btn ld-btn-secondary" data-act="ob-back">Back</button><button class="ld-btn ld-btn-primary ld-btn-lg" data-act="cl-ob-finish">Finish setup</button></div></div>';
  }
  return h + '</div>';
}

/* ---------- property ---------- */
function propFields(p) {
  p = p || { furnishing: 'unfurnished', bedrooms: 1, bathrooms: 1, type: 'Flat', access: {}, contact: {} };
  var a = p.access || {}, ct = p.contact || {};
  return '<div class="two">' + field('p-lbl', 'Label', inp('p-lbl', 'label', p.label, 'required placeholder="e.g. Pulteney St Flat 3"')) + field('p-type', 'Property type', sel('p-type', 'type', ['Flat', 'House', 'Studio', 'HMO', 'Maisonette', 'Bungalow', 'Office', 'Block'], p.type)) + '</div>' +
    field('p-addr', 'Full service address', inp('p-addr', 'address', p.address, 'required autocomplete="street-address"')) +
    '<div class="two">' + field('p-pc', 'Postcode', inp('p-pc', 'postcode', p.postcode, 'required autocapitalize="characters"')) + field('p-furn', 'Furnishing', sel('p-furn', 'furnishing', [['unfurnished', 'Unfurnished'], ['part', 'Part furnished'], ['furnished', 'Fully furnished']], p.furnishing)) + '</div>' +
    '<div class="two">' + field('p-bed', 'Bedrooms', inp('p-bed', 'bedrooms', p.bedrooms, 'type="number" min="0" max="20" required'), 'Use 0 for a studio.') + field('p-bath', 'Bathrooms', inp('p-bath', 'bathrooms', p.bathrooms, 'type="number" min="0" max="10" required')) + '</div>' +
    '<div class="two">' + field('p-occ', 'Occupancy', sel('p-occ', 'occupancy', [['vacant', 'Vacant'], ['occupied', 'Occupied'], ['unknown', 'Not sure']], p.occupancy || 'vacant')) + field('p-am', 'Access method', sel('p-am', 'accessMethod', [['keysafe', 'Key safe'], ['agent', 'Collect keys from agent/office'], ['occupant', 'Occupant lets Pro in'], ['concierge', 'Concierge / building manager'], ['other', 'Other']], a.method || 'keysafe')) + '</div>' +
    field('p-acode', 'Access codes & key instructions <small>Protected: only shown to the assigned Pro close to the visit</small>', inp('p-acode', 'accessCodes', a.codes, 'autocomplete="off"')) +
    '<h3 style="margin-top:6px">Authorised access contact</h3><div class="two">' + field('p-cn', 'Name', inp('p-cn', 'cname', ct.name, 'required')) + field('p-cp', 'Phone', inp('p-cp', 'cphone', ct.phone, 'type="tel" required')) + '</div>' + field('p-cr', 'Role <small>e.g. tenant, concierge, agent</small>', inp('p-cr', 'crole', ct.role)) +
    '<div class="two">' + field('p-park', 'Parking <small>Optional</small>', inp('p-park', 'parking', p.parking)) + field('p-haz', 'Hazards or accessibility needs <small>Optional</small>', inp('p-haz', 'hazards', p.hazards)) + '</div>';
}
function propModal(p) { return '<form class="a-modal a-form" data-form="prop" data-id="' + (p ? p.id : '') + '" role="dialog" aria-modal="true" aria-labelledby="pm-h"><div class="a-row sb"><h2 id="pm-h">' + (p ? 'Edit property' : 'Add a property') + '</h2><button type="button" class="ld-iconbtn" data-act="close" aria-label="Close">' + ic('close', 20) + '</button></div>' + propFields(p) + (p ? '<p class="a-fine">Changes don’t alter past job records.</p>' : '') + '<div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">' + (p ? 'Save changes' : 'Add property') + '</button><button class="ld-btn ld-btn-secondary" type="button" data-act="close">Cancel</button></div></form>'; }
function propFromForm(fd) { var v = function (n) { return String(fd.get(n) || '').trim(); }; return { label: v('label'), type: v('type'), address: v('address'), postcode: v('postcode').toUpperCase(), furnishing: v('furnishing'), bedrooms: +v('bedrooms'), bathrooms: +v('bathrooms'), occupancy: v('occupancy'), access: { method: v('accessMethod'), codes: v('accessCodes') }, contact: { name: v('cname'), phone: v('cphone'), role: v('crole') }, parking: v('parking'), hazards: v('hazards') }; }

/* ---------- dashboard / lists ---------- */
function vClientHome() {
  var c = me(), jobs = myJobs(), need = jobs.filter(clientNeeds), open = jobs.filter(function (j) { return OPEN_STATES.indexOf(j.status) >= 0; });
  var h = '<div class="a-page"><div class="a-head"><div><h1>Hello, ' + esc((c.name || '').split(' ')[0]) + '</h1><p>' + esc(SEGMENTS[c.segment].label) + (c.orgName ? ' · ' + esc(c.orgName) : '') + '</p></div><button class="ld-btn ld-btn-primary ld-btn-lg" data-go="new">' + ic('plus', 18) + 'New request</button></div>';
  h += '<div class="a-grid k">' + stat('Open requests', open.length) + stat('Needs your action', need.length) + stat('Properties', myProps().length) + stat('Completed', jobs.filter(function (j) { return j.status === 'COMPLETED'; }).length) + '</div>';
  if (need.length) h += '<section class="a-sec"><h2>Needs your action</h2><div class="a-jobs">' + need.map(function (j) { return jobRow(j, 'client'); }).join('') + '</div></section>';
  h += '<section class="a-sec"><h2>Recent requests <button class="ld-btn ld-btn-ghost ld-btn-sm" data-go="jobs">View all</button></h2>' + (jobs.length ? '<div class="a-jobs">' + jobs.slice(0, 6).map(function (j) { return jobRow(j, 'client'); }).join('') + '</div>' : empty('file', 'No requests yet', 'Request a check-in, check-out or maintenance for one of your properties.', '<button class="ld-btn ld-btn-primary" data-go="new">New request</button>')) + '</section>';
  return h + '</div>';
}
function filterBar(groups) { return '<div class="a-filter" role="group" aria-label="Filter">' + Object.keys(groups).map(function (k) { return '<button type="button" data-act="filter" data-f="' + k + '" aria-pressed="' + (S.filter === k) + '">' + groups[k] + '</button>'; }).join('') + '</div>'; }
function vClientJobs() {
  var f = S.filter, jobs = myJobs().filter(function (j) { if (f === 'open') return OPEN_STATES.indexOf(j.status) >= 0; if (f === 'action') return clientNeeds(j); if (f === 'done') return j.status === 'COMPLETED' || j.status === 'CANCELLED'; return true; });
  return '<div class="a-page"><div class="a-head"><div><h1>Requests</h1><p>Every request from submission to completed report.</p></div><button class="ld-btn ld-btn-primary" data-go="new">' + ic('plus', 18) + 'New request</button></div>' + filterBar({ all: 'All', open: 'Open', action: 'Needs action', done: 'Closed' }) + (jobs.length ? '<div class="a-jobs">' + jobs.map(function (j) { return jobRow(j, 'client'); }).join('') + '</div>' : empty('file', 'Nothing here', 'Requests you make appear here with their live status.', '')) + '</div>';
}
function vClientProps() {
  var props = myProps();
  return '<div class="a-page"><div class="a-head"><div><h1>Properties</h1></div><button class="ld-btn ld-btn-primary" data-act="add-prop">' + ic('plus', 18) + 'Add property</button></div>' + (props.length ? '<div class="a-grid">' + props.map(function (p) {
    var n = list('jobs').filter(function (j) { return j.propertyId === p.id; }).length;
    return '<button class="a-card click" data-go="property" data-id="' + p.id + '" style="text-align:left"><div class="a-row sb"><span class="ld-badge ld-badge-brand">' + ic('home', 14) + esc(p.type) + '</span><span class="a-fine">' + n + ' request' + (n === 1 ? '' : 's') + '</span></div><h3>' + esc(p.label) + '</h3><span class="a-muted">' + esc(p.address) + ', ' + esc(p.postcode) + '</span><span class="a-fine">' + esc(p.bedrooms) + ' bed · ' + esc(p.bathrooms) + ' bath · ' + esc({ unfurnished: 'Unfurnished', part: 'Part furnished', furnished: 'Furnished' }[p.furnishing]) + '</span></button>';
  }).join('') + '</div>' : empty('home', 'No properties yet', 'Add a property to start booking.', '<button class="ld-btn ld-btn-primary" data-act="add-prop">Add a property</button>')) + '</div>';
}
function vProperty() {
  var p = D.properties[S.params.id]; if (!p) return '<div class="a-page">' + empty('home', 'Property not found', '', '') + '</div>';
  var jobs = list('jobs').filter(function (j) { return j.propertyId === p.id; }).sort(byNew), a = p.access || {}, ct = p.contact || {};
  var disputes = [], ratings = []; jobs.forEach(function (j) { (j.disputes || []).forEach(function (d) { disputes.push([j, d]); }); if (j.rating) ratings.push(j); });
  var canSeeCodes = S.role === 'client' || (S.role === 'admin' && S.revealed && S.revealed[p.id]);
  return '<div class="a-page"><button class="a-back" data-act="back">' + ic('arrow-left', 16) + 'Back</button><div class="a-head"><div><h1>' + esc(p.label) + '</h1><p>' + esc(p.address) + ', ' + esc(p.postcode) + '</p></div>' + (S.role === 'client' ? '<div class="a-row"><button class="ld-btn ld-btn-primary" data-act="new-for" data-id="' + p.id + '">Request a service</button><button class="ld-btn ld-btn-secondary" data-act="edit-prop" data-id="' + p.id + '">Edit</button></div>' : '') + '</div>' +
    '<div class="a-big"><div style="display:grid;gap:18px;min-width:0"><section class="a-sec"><h2>History</h2>' + (jobs.length ? '<div class="a-jobs">' + jobs.map(function (j) { return jobRow(j, S.role); }).join('') + '</div>' : empty('file', 'No requests yet', 'Requests for this property will be listed here.', '')) + '</section>' +
    (disputes.length || ratings.length ? '<div class="a-card"><h3>Complaints & feedback</h3>' + disputes.map(function (x) { return '<p><b>' + esc(x[0].ref) + '</b> · ' + esc(x[1].category) + ' · ' + esc(x[1].status === 'RESOLVED' ? 'Resolved' : 'Open') + '<br><span class="a-muted">' + esc(x[1].text) + '</span></p>'; }).join('') + ratings.map(function (j) { return '<p><b>' + esc(j.ref) + '</b> · ' + stars(j.rating.score) + (j.rating.text && !j.rating.hidden ? ' <span class="a-muted">“' + esc(j.rating.text) + '”</span>' : '') + '</p>'; }).join('') + '</div>' : '') + '</div>' +
    '<aside class="a-sticky"><div class="a-card"><h3>Details</h3><dl class="a-kv"><dt>Type</dt><dd>' + esc(p.type) + '</dd><dt>Rooms</dt><dd>' + esc(p.bedrooms) + ' bed · ' + esc(p.bathrooms) + ' bath</dd><dt>Occupancy</dt><dd>' + esc(p.occupancy) + '</dd><dt>Access</dt><dd>' + esc(a.method) + '</dd><dt>Codes</dt><dd>' + (canSeeCodes ? esc(a.codes || '—') : '•••• ' + (S.role === 'admin' ? '<button class="ld-btn ld-btn-ghost ld-btn-sm" data-act="reveal" data-id="' + p.id + '">Reveal (audited)</button>' : '')) + '</dd><dt>Contact</dt><dd>' + esc(ct.name) + ' · ' + esc(ct.phone) + (ct.role ? ' (' + esc(ct.role) + ')' : '') + '</dd>' + (p.hazards ? '<dt>Hazards</dt><dd>' + esc(p.hazards) + '</dd>' : '') + '</dl></div></aside></div></div>';
}

/* ---------- request wizard ---------- */
var WZ = ['Property', 'Service', 'Scope', 'Photos & access', 'Date', 'Review'];
function wizInit(propId, linkedId) { var lj = linkedId ? D.jobs[linkedId] : null; S.wiz = { step: 1, propertyId: propId || (lj && lj.propertyId) || (myProps()[0] || {}).id, type: null, kind: null, scope: { clean: 'general', severity: 'medium', inventory: 'yes' }, photoIds: [], date: '', slot: 'morning', linkedId: linkedId || null }; }
function vClientNew() {
  if (!myProps().length) return '<div class="a-page"><div class="a-head"><div><h1>New request</h1></div></div>' + empty('home', 'Add a property first', 'Requests are made for a property.', '<button class="ld-btn ld-btn-primary" data-act="add-prop">Add a property</button>') + '</div>';
  if (!S.wiz) wizInit(); var w = S.wiz, p = D.properties[w.propertyId] || myProps()[0]; w.propertyId = p.id;
  var h = '<div class="a-page" style="max-width:820px"><div class="a-head"><div><h1>New request</h1><p>Check-In, Check-Out, Repairs & Damages or Cleaning. LISTD sends you a quote, or an invoice for repairs, before anything is charged.</p></div></div>' + (w.linkedId ? '<div class="a-banner">' + ic('info', 20) + '<div><b>Linked to ' + esc(D.jobs[w.linkedId].ref) + '</b><p>This is a separate request for the same property.</p></div></div>' : '') + '<div class="a-steps">' + WZ.map(function (s, i) { return '<span class="' + (i + 1 === w.step ? 'on' : i + 1 < w.step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('') + '</div><form class="a-card a-form" data-form="wiz">';
  var nav = function (lbl) { return '<div class="a-actions">' + (w.step > 1 ? '<button class="ld-btn ld-btn-secondary" type="button" data-act="wiz-back">Back</button>' : '') + '<button class="ld-btn ld-btn-primary' + (w.step === 6 ? ' ld-btn-lg' : '') + '" type="submit">' + (lbl || 'Continue' + ic('arrow-right', 18)) + '</button></div>'; };
  if (w.step === 1) h += field('w-prop', 'Property', sel('w-prop', 'propertyId', myProps().map(function (x) { return [x.id, x.label + ' — ' + x.address + ', ' + x.postcode]; }), w.propertyId)) + nav();
  else if (w.step === 2) {
    var cur = w.type === 'MAINTENANCE' ? w.kind : w.type;
    h += '<fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px"><legend class="ld-label" style="margin-bottom:8px">Service</legend><div class="a-choice a-choice-2">' + ['CHECK_IN', 'CHECK_OUT', 'REPAIRS_DAMAGES', 'CLEANING'].map(function (t) { var s = SVC[t]; return '<label class="a-opt"><input type="radio" name="service" value="' + t + '" required' + (cur === t ? ' checked' : '') + '><span class="ic" style="--c:' + s.c + '">' + ic(s.icon, 20) + '</span><b>' + s.label + '</b><span>' + s.d + '</span></label>'; }).join('') + '</div></fieldset>' + nav();
  } else if (w.step === 3) {
    var sc = w.scope;
    if (w.type === 'CHECK_IN' || w.type === 'CHECK_OUT') {
      h += field('w-rooms', 'Rooms and areas to inspect', area('w-rooms', 'rooms', sc.rooms || ('Entrance, living room, kitchen, ' + p.bedrooms + ' bedroom(s), ' + p.bathrooms + ' bathroom(s), exterior'), 'required'));
      if (w.type === 'CHECK_IN') h += field('w-inv', 'Inventory needed?', sel('w-inv', 'inventory', [['yes', 'Yes, full inventory'], ['condition', 'Condition only']], sc.inventory));
      else { var base = findBaseline(p.id); h += base ? '<div class="a-banner" style="--t:var(--success-subtle);--c:var(--success)">' + ic('inventory', 20) + '<div><b>Baseline found: check-in ' + esc(base.ref) + '</b><p>The check-out will be compared with it.</p></div></div>' : '<div class="a-banner" style="--t:var(--warning-subtle);--c:var(--warning)">' + ic('warning', 20) + '<div><b>No baseline check-in on record</b><p>The report will say clearly that a comparison isn’t available.</p></div></div>'; }
      h += field('w-keys', 'Key arrangements', inp('w-keys', 'keys', sc.keys, 'required placeholder="e.g. 2 sets to hand over to tenant"')) + field('w-occ', 'Occupant name <small>Optional; a contact record, not an account</small>', inp('w-occ', 'occupant', sc.occupant));
    } else if (w.kind === 'CLEANING') {
      h += '<fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px"><legend class="ld-label" style="margin-bottom:8px">Type of clean</legend><div class="a-choice">' + Object.keys(CLEANS).map(function (c) { return '<label class="a-opt"><input type="radio" name="clean" value="' + c + '"' + (sc.clean === c ? ' checked' : '') + '><b>' + CLEANS[c].label + '</b><span>' + CLEANS[c].d + '</span></label>'; }).join('') + '</div></fieldset>' +
        field('w-cond', 'Current condition', sel('w-cond', 'condition', [['vacant-tidy', 'Vacant and tidy'], ['vacant-dirty', 'Vacant, needs work'], ['occupied', 'Occupied']], sc.condition)) + field('w-cn', 'Exclusions or special requests <small>Optional</small>', area('w-cn', 'notes', sc.notes));
    } else {
      h += '<div class="two">' + field('w-cat', 'Category', sel('w-cat', 'category', settings().repairCategories, sc.category)) + field('w-loc', 'Location in the property', inp('w-loc', 'location', sc.location, 'required placeholder="e.g. Kitchen sink"')) + '</div>' +
        field('w-desc', 'Describe the issue and symptoms', area('w-desc', 'description', sc.description, 'required')) + field('w-sev', 'Severity', sel('w-sev', 'severity', Object.keys(SEVERITY).map(function (k) { return [k, SEVERITY[k]]; }), sc.severity)) +
        '<div class="a-banner" style="--t:var(--danger-subtle);--c:var(--danger)">' + ic('warning', 20) + '<div><b>LISTD isn’t an emergency service</b><p>For gas leaks, electrical danger or flooding, make the property safe and call the relevant emergency line first. Choosing “Unsafe” flags the request to LISTD straight away.</p></div></div>';
    }
    h += nav();
  } else if (w.step === 4) {
    var ph = w.photoIds.map(function (id) { return D.evidence[id]; }).filter(Boolean);
    h += '<div class="ld-field"><span class="ld-label">Photos <small>' + (w.kind === 'REPAIRS_DAMAGES' ? 'Photos of the issue help LISTD quote accurately' : 'Optional') + '</small></span>' + photoGrid(ph) + '<div class="a-row">' + upBtn({ wiz: 1, stage: 'OTHER' }, 'Add photos') + '</div></div>' +
      (w.kind === 'REPAIRS_DAMAGES' ? field('w-nop', 'If you can’t add photos, why? ', inp('w-nop', 'noPhotoReason', w.scope.noPhotoReason)) : '') +
      field('w-acc', 'Access notes for this visit', area('w-acc', 'access', w.scope.access || '', 'placeholder="Who will be present, parking, alarm"'), 'Access codes stay on the property record and are only shown to the assigned Pro.') + nav();
  } else if (w.step === 5) {
    var minD = new Date(); minD.setDate(minD.getDate() + 1);
    h += '<div class="two">' + field('w-date', 'Preferred date', inp('w-date', 'date', w.date, 'type="date" required min="' + minD.toISOString().slice(0, 10) + '"')) + field('w-slot', 'Preferred window', sel('w-slot', 'slot', Object.keys(WINDOWS).map(function (k) { return [k, WINDOWS[k][0] + ', ' + WINDOWS[k][1] + '–' + WINDOWS[k][2]]; }), w.slot)) + '</div><p class="a-fine">LISTD confirms the exact slot when a Pro accepts.</p>' + nav();
  } else {
    var key = w.type === 'MAINTENANCE' ? w.kind : w.type;
    h += '<div class="a-summary"><div class="line"><span>Request</span><b>' + esc(SVC[w.type === 'MAINTENANCE' ? w.kind : w.type].label) + (w.kind === 'CLEANING' ? ' · ' + CLEANS[w.scope.clean].label : '') + '</b></div><div class="line"><span>Property</span><b>' + esc(p.label) + '</b></div><div class="line"><span>Preferred</span><b>' + winLabel(w) + '</b></div><div class="line"><span>Photos</span><b>' + w.photoIds.length + '</b></div><div class="line tot"><span>Price</span><span>Quoted by LISTD</span></div></div>' +
      '<div class="a-banner">' + ic('info', 20) + '<div><b>What happens next</b><p>LISTD reviews your request and sends an itemised quote. Nothing is charged until you accept and pay it. ' + (key === 'CHECK_OUT' ? '' : '') + '</p></div></div>' + nav('Submit request');
  }
  return h + '</form></div>';
}

/* ---------- payments ---------- */
function vClientPayments() {
  var rows = []; myJobs().forEach(function (j) { (j.payments || []).forEach(function (p) { rows.push({ j: j, kind: p.coId ? 'Change order' : qWord(j, true) + ' v' + p.quoteV, amt: p.amountP, st: p.status, at: p.at, ref: p.ref }); }); (j.refunds || []).forEach(function (r) { rows.push({ j: j, kind: 'Refund', amt: -r.amountP, st: r.status, at: r.at, ref: r.ref, reason: r.reason }); }); });
  rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  var paid = rows.filter(function (r) { return r.amt > 0 && r.st === 'SUCCEEDED'; }).reduce(function (a, r) { return a + r.amt; }, 0), ref = rows.filter(function (r) { return r.amt < 0; }).reduce(function (a, r) { return a - r.amt; }, 0);
  return '<div class="a-page"><div class="a-head"><div><h1>Payments</h1><p>Test mode: payments are simulated. Download a receipt for any job.</p></div></div><div class="a-grid k">' + stat('Paid', P(paid)) + stat('Refunded', P(ref)) + stat('Net', P(paid - ref)) + '</div>' +
    (rows.length ? '<div class="a-tw"><table><thead><tr><th>Date</th><th>Ref</th><th>Item</th><th>Status</th><th>Provider ref</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + fdate(r.at, true) + '</td><td class="num"><a href="#" data-act="open-job" data-id="' + r.j.id + '">' + esc(r.j.ref) + '</a></td><td>' + esc(r.kind) + (r.reason ? '<div class="a-fine">' + esc(r.reason) + '</div>' : '') + '</td><td>' + badge(r.st === 'SUCCEEDED' ? 'Succeeded' : 'Failed', r.st === 'SUCCEEDED' ? 'success' : 'danger') + '</td><td class="a-fine num">' + esc(r.ref) + '</td><td class="r">' + P(r.amt) + '</td><td><button class="ld-btn ld-btn-ghost ld-btn-sm" data-act="receipt" data-id="' + r.j.id + '">Receipt</button></td></tr>'; }).join('') + '</tbody></table></div>' : empty('pound', 'No payments yet', 'Payments appear once you pay a quote.', '')) + '</div>';
}

/* ---------- account ---------- */
function vClientAccount() {
  var c = me(), b = c.billing || {};
  return '<div class="a-page" style="max-width:760px"><div class="a-head"><div><h1>Account</h1></div></div><div class="a-card"><dl class="a-kv"><dt>Name</dt><dd>' + esc(c.name) + '</dd><dt>Email</dt><dd>' + esc(c.email) + '</dd><dt>Account type</dt><dd>' + esc(SEGMENTS[c.segment].label) + '</dd>' + (c.orgName ? '<dt>Organisation</dt><dd>' + esc(c.orgName) + '</dd>' : '') + '<dt>Billing address</dt><dd>' + esc(b.name) + ', ' + esc(b.address) + ', ' + esc(b.city) + ' ' + esc(b.postcode) + '</dd><dt>Joined</dt><dd>' + fdate(c.createdAt) + '</dd></dl><p class="a-fine">Your account type can only be changed by LISTD.</p></div>' + signOutCard() + '</div>';
}

/* ---------- invoices (Repairs & Damages) ---------- */
function vClientInvoices() {
  var all = invoices(S.clientId), due = all.filter(function (x) { return x.st === 'APPROVAL' || x.st === 'PAYMENT'; }), dueP = due.reduce(function (a, x) { return a + x.amt; }, 0);
  var h = '<div class="a-page"><div class="a-head"><div><h1>Invoices</h1><p>Invoices for repairs. LISTD prices the work from the damage assessed. Pay an invoice to book the repair. Test mode: no card is charged.</p></div></div>';
  if (due.length) h += banner('pound', due.length + ' invoice' + (due.length > 1 ? 's' : '') + ' to pay: ' + P(dueP), 'Open an invoice to see the itemised labour and materials before you pay.', '', 'warning');
  if (!all.length) return h + empty('invoice', 'No invoices yet', 'When you report a repair, LISTD assesses the damage and sends you an invoice here.', '<button class="ld-btn ld-btn-primary" data-go="new">Report a repair</button>') + '</div>';
  h += '<div class="a-tw"><table><thead><tr><th>Invoice</th><th>For</th><th>Issued</th><th>Due / paid</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>' + all.map(function (x) {
    var s = INV_ST[x.st] || [x.st, ''], p = x.j.propSnapshot || {}, dp = x.paidAt ? 'Paid ' + fdate(x.paidAt) : x.due && (x.st === 'APPROVAL' || x.st === 'PAYMENT') ? 'Due ' + fdate(x.due) : '—';
    var act = x.st === 'APPROVAL' ? (x.co ? '<button type="button" class="ld-btn ld-btn-primary ld-btn-sm" data-act="co-accept" data-id="' + x.j.id + '" data-co="' + x.coId + '">Pay</button>' : '<button type="button" class="ld-btn ld-btn-primary ld-btn-sm" data-act="inv-pay" data-id="' + x.j.id + '">Pay</button>') : x.st === 'PAYMENT' ? '<button type="button" class="ld-btn ld-btn-primary ld-btn-sm" data-act="pay" data-id="' + x.j.id + '">Pay</button>' : x.paidAt ? '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="receipt" data-id="' + x.j.id + '">' + ic('download', 16) + ' Receipt</button>' : '';
    return '<tr class="click" data-act="open-job" data-id="' + x.j.id + '"><td class="num nw"><b>' + esc(x.no) + '</b></td><td><b>' + esc(p.label || '') + '</b><div class="a-fine">' + esc(x.co ? x.what : [((x.j.scope || {}).category), ((x.j.scope || {}).location)].filter(Boolean).join(' · ') || x.what) + '</div></td><td class="nw">' + fdate(x.issued) + '</td><td class="nw">' + dp + '</td><td class="r">' + P(x.amt) + '</td><td>' + badge(s[0], s[1]) + '</td><td class="r">' + act + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  return h + '</div>';
}
