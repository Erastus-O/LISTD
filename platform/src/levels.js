/* ===================== Pro levels, training & applications ===================== */
/* Levels 1-3: cleaning. Levels 4-5: inspections and a higher pay share.
   Moving up needs a level application that an Admin approves. Levels 4 and 5 also need every
   training marked for that level (or below) to be completed first; this rule has no override. */

function lvRule(n) { var l = settings().levels || DEFAULT_SETTINGS.levels; return Object.assign({}, DEFAULT_SETTINGS.levels[n - 1], l[n - 1] || {}); }
function requiredLevel(j) {
  var k = svcKey(j);
  if (k === 'CLEANING') return ({ light: 1, general: 2, deep: 3 })[(j.scope || {}).clean] || 1;
  if (k === 'CHECK_IN' || k === 'CHECK_OUT') { var beds = +((j.propSnapshot || {}).bedrooms || propOf(j).bedrooms || 0); return beds >= 4 ? 5 : 4; }
  return 0;
}
function liveTrainings() { return list('trainings').filter(function (t) { return t.status === 'PUBLISHED'; }).sort(function (a, b) { return ((+a.level || 9) - (+b.level || 9)) || String(a.createdAt).localeCompare(String(b.createdAt)); }); }
function trainingsForLevel(n) { return liveTrainings().filter(function (t) { return +t.level >= 2 && +t.level <= n; }); }
function doneAt(p, tid) { var x = (p && p.trainings || {})[tid]; return x && x.at ? x.at : null; }
function missingTrainings(p, n) { return trainingsForLevel(n).filter(function (t) { return !doneAt(p, t.id); }); }
function proApps(proId) { return list('applications').filter(function (a) { return a.proId === proId; }).sort(byNew); }
function pendingApp(proId, kind) { return proApps(proId).filter(function (a) { return a.status === 'PENDING' && (!kind || a.kind === kind); })[0] || null; }
function pendingApps() {
  var real = list('applications').filter(function (a) { return a.status === 'PENDING' && D.pros[a.proId]; });
  /* older Pros submitted before applications were recorded */
  list('pros').forEach(function (p) { if (p.status === 'PENDING' && !real.some(function (a) { return a.proId === p.id && a.kind === 'JOIN'; })) real.push({ id: 'join-' + p.id, proId: p.id, kind: 'JOIN', from: 0, to: 1, status: 'PENDING', createdAt: (p.onboarding || {}).submittedAt || p.createdAt, synthetic: true }); });
  return real.sort(byNew);
}
/* requirements to reach level n */
function levelCheck(p, n) {
  if (n > 5) return null;
  var st = proStats(p.id), r = lvRule(n), cur = proLevel(p), tr = trainingsForLevel(n), td = tr.filter(function (t) { return doneAt(p, t.id); }).length;
  var rows = [
    { k: 'prev', label: 'Hold Level ' + (n - 1), ok: cur >= n - 1, val: 'You’re Level ' + cur },
    { k: 'jobs', label: r.minJobs + ' completed job' + (r.minJobs === 1 ? '' : 's'), ok: st.completed >= r.minJobs, val: st.completed + ' done' }
  ];
  if (r.minRating > 0) rows.push({ k: 'rating', label: 'Average rating of ' + (+r.minRating).toFixed(1) + ' or more', ok: st.rating != null && st.rating >= r.minRating, val: st.rating != null ? st.rating.toFixed(1) + ' from ' + st.ratings : 'No ratings yet' });
  if (n >= 4 || tr.length) rows.push({ k: 'training', label: tr.length ? 'Complete ' + tr.length + ' required training' + (tr.length === 1 ? '' : 's') : 'Required trainings', ok: td === tr.length, val: tr.length ? td + ' of ' + tr.length + ' done' : 'None set yet' });
  rows.push({ k: 'approved', label: 'Approved LISTD Pro', ok: p.status === 'APPROVED', val: p.status === 'APPROVED' ? 'Approved' : 'Not approved yet' });
  return { n: n, rows: rows, ok: rows.every(function (x) { return x.ok; }), trainings: tr, done: td };
}
function reqList(c) { return '<ul class="a-req">' + c.rows.map(function (x) { return '<li class="' + (x.ok ? 'ok' : 'no') + '">' + ic(x.ok ? 'success' : 'minus', 16) + '<span>' + esc(x.label) + '</span><em>' + esc(x.val) + '</em></li>'; }).join('') + '</ul>'; }
function appTitle(a) { return a.kind === 'JOIN' ? 'Joining LISTD' : 'Level ' + a.from + ' → Level ' + a.to; }
function appBadge(a) { return badge({ PENDING: 'Waiting for review', APPROVED: 'Approved', REJECTED: 'Not approved', CHANGES: 'Changes requested', WITHDRAWN: 'Withdrawn' }[a.status] || a.status, a.status === 'APPROVED' ? 'success' : a.status === 'PENDING' ? 'warning' : a.status === 'REJECTED' ? 'danger' : ''); }
function trainSrc(t) { return t.assetId ? '/_blob/' + t.assetId : t.dataUrl || t.url || ''; }
function trainKind(t) { return { video: ['play', 'Video'], pdf: ['file', 'PDF'], link: ['external', 'Link'] }[t.kind] || ['file', 'File']; }
function forLevel(t) { return +t.level >= 2 ? 'Level ' + t.level : 'Optional'; }

/* ---------- commands ---------- */
function cmdApplyLevel(note) {
  var p = meP(), n = proLevel(p) + 1; if (n > 5) return deny('You’re already at the top level.');
  if (pendingApp(p.id, 'LEVEL')) return deny('You already have an application waiting for review.');
  var c = levelCheck(p, n); if (!c.ok) return deny('You don’t meet every requirement for Level ' + n + ' yet.');
  var st = proStats(p.id);
  setDoc('applications', uid(), { proId: p.id, kind: 'LEVEL', from: n - 1, to: n, status: 'PENDING', note: note || '', snapshot: { completed: st.completed, rating: st.rating, ratings: st.ratings, trainings: c.trainings.map(function (t) { return t.id; }) }, createdAt: now() });
  notify('admin', p.name + ' applied for Level ' + n + ' (' + LEVEL_INFO[n].name + ')'); return true;
}
function cmdWithdrawApp(id) { var a = D.applications[id]; if (!a || a.proId !== S.proId || a.status !== 'PENDING') return false; patchDoc('applications', id, { status: 'WITHDRAWN', decision: { reason: 'Withdrawn by Pro', at: now() } }); return true; }
function trainingGate(p, n) { if (n < 4) return true; var m = missingTrainings(p, n); return m.length ? 'Level ' + n + ' needs ' + m.length + ' more training' + (m.length > 1 ? 's' : '') + ' completed first: ' + m.map(function (t) { return t.title; }).join(', ') + '.' : true; }
function applyLevel(p, n, reason, appId) {
  var hist2 = (p.levelHistory || []).concat([{ from: proLevel(p), to: n, reason: reason, appId: appId || null, at: now() }]);
  patchDoc('pros', p.id, { level: n, levelOverride: null, levelHistory: hist2 });
  audit('pro.level', 'pro', p.id, reason, { from: proLevel(p), to: n });
}
function cmdDecideApp(id, approve, reason) {
  var a = D.applications[id]; if (!a || a.status !== 'PENDING' || a.kind !== 'LEVEL') return deny('This application is no longer open.');
  var p = D.pros[a.proId]; if (!p) return false;
  if (!approve && !reason) return deny('Give a reason so the Pro knows what to work on.');
  if (approve) { if (proLevel(p) !== a.from) return deny('This Pro’s level has changed since they applied.'); var g = trainingGate(p, a.to); if (g !== true) return deny(g); applyLevel(p, a.to, reason || 'Level application approved', id); }
  patchDoc('applications', id, { status: approve ? 'APPROVED' : 'REJECTED', decision: { by: ENV.uid || 'admin', reason: reason || '', at: now() } });
  if (!approve) audit('pro.level_reject', 'pro', p.id, reason, { to: a.to });
  notify('p:' + p.id, approve ? 'You’re now Level ' + a.to + ' (' + LEVEL_INFO[a.to].name + '). New job types are open to you.' : 'Your Level ' + a.to + ' application wasn’t approved: ' + reason);
  return true;
}
function cmdSetLevel(proId, n, reason) {
  var p = D.pros[proId]; if (!p) return false; if (!reason) return deny('Give a reason for the level change.');
  if (n === proLevel(p)) return deny('That’s already their level.');
  var g = trainingGate(p, n); if (g !== true) return deny(g);
  applyLevel(p, n, reason); pendingApp(proId, 'LEVEL') && patchDoc('applications', pendingApp(proId, 'LEVEL').id, { status: n >= pendingApp(proId, 'LEVEL').to ? 'APPROVED' : 'REJECTED', decision: { by: ENV.uid || 'admin', reason: 'Level set directly: ' + reason, at: now() } });
  notify('p:' + proId, 'LISTD set your level to Level ' + n + ' (' + LEVEL_INFO[n].name + ').'); return true;
}
function cmdCompleteTraining(tid) { var p = meP(), t = D.trainings[tid]; if (!p || !t) return false; var tr = Object.assign({}, p.trainings || {}); tr[tid] = { at: now(), title: t.title }; patchDoc('pros', p.id, { trainings: tr }); return true; }
function cmdTrainingStatus(tid, status) { var t = D.trainings[tid]; if (!t) return false; patchDoc('trainings', tid, { status: status }); audit('training.' + status.toLowerCase(), 'training', tid, t.title); return true; }

/* training file upload: video or PDF */
var TRAIN_TYPES = { 'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video', 'application/pdf': 'pdf' };
async function trainingFile(file) {
  var kind = TRAIN_TYPES[file.type]; if (!kind) { toast('Use an MP4, WebM or MOV video, or a PDF.'); return; }
  var max = ENV.assets ? 20 : 2.5; if (file.size > max * 1048576) { toast(ENV.assets ? 'Files can be up to 20 MB. For longer videos, add a link instead.' : 'In local demo mode files can be up to 2.5 MB. Add a link instead, or use the published app.'); return; }
  toast('Uploading…');
  try {
    if (ENV.assets) { var u = await ENV.assets.upload(file); S.tUp = { kind: kind, assetId: u.id, name: file.name, size: file.size }; }
    else { var url = await new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); }); S.tUp = { kind: kind, dataUrl: url, name: file.name, size: file.size }; }
    toast(file.name + ' uploaded');
  } catch (e) { toast('The file couldn’t be uploaded. Try again or add a link.'); }
}
function trainingAdd(fd) {
  var v = function (n) { return String(fd.get(n) || '').trim(); }, up = S.tUp, link = v('link');
  if (!v('title')) return deny('Give the training a title.');
  if (!up && !link) return deny('Upload a video or PDF, or add a link.');
  if (link && !/^https:\/\//i.test(link)) return deny('Links must start with https://');
  var doc = { title: v('title'), desc: v('desc'), level: +v('level') || 0, minutes: Math.max(0, +v('minutes') || 0), status: fd.get('publish') ? 'PUBLISHED' : 'DRAFT', createdAt: now() };
  if (up) Object.assign(doc, { kind: up.kind, fileName: up.name, size: up.size }, up.assetId ? { assetId: up.assetId } : { dataUrl: up.dataUrl }); else Object.assign(doc, { kind: 'link', url: link });
  var id = uid(); setDoc('trainings', id, doc); audit('training.create', 'training', id, doc.title, { level: doc.level, kind: doc.kind });
  if (doc.status === 'PUBLISHED') list('pros').filter(function (p) { return p.status === 'APPROVED'; }).forEach(function (p) { notify('p:' + p.id, 'New training: ' + doc.title + (doc.level ? ' (needed for Level ' + doc.level + ')' : '')); });
  S.tUp = null; return true;
}

/* ---------- shared pieces ---------- */
function ladder(cur) {
  return '<ol class="a-ladder">' + [1, 2, 3, 4, 5].map(function (n) { var r = lvRule(n); return '<li class="' + (n === cur ? 'cur' : n < cur ? 'past' : '') + (n >= 4 ? ' insp' : '') + '"><span class="n">' + n + '</span><span class="t"><b>' + esc(LEVEL_INFO[n].name) + '</b><span>' + esc(LEVEL_INFO[n].unlocks) + '</span></span><span class="pay">' + r.sharePct + '%<small>pay share</small></span></li>'; }).join('') + '</ol>';
}
function trainingRow(t, p, go) {
  var k = trainKind(t), d = p ? doneAt(p, t.id) : null;
  return '<button type="button" class="a-trow" data-go="training" data-id="' + t.id + '"><span class="ic">' + ic(k[0], 20) + '</span><span class="t"><b>' + esc(t.title) + '</b><span>' + k[1] + (t.minutes ? ' · ' + t.minutes + ' min' : '') + ' · ' + forLevel(t) + '</span></span>' + (p ? (d ? badge('Completed ' + fdate(d), 'success', 'check') : badge('To do', '')) : '') + ic('chevron-right', 18) + '</button>';
}
function trainingPlayer(t) {
  var src = trainSrc(t);
  if (t.kind === 'video') return '<video class="a-player" controls preload="metadata" src="' + esc(src) + '"></video>';
  if (t.kind === 'pdf') return '<iframe class="a-pdfview" src="' + esc(src) + '" title="' + esc(t.title) + '"></iframe><p><a class="ld-btn ld-btn-secondary ld-btn-sm" href="' + esc(src) + '" target="_blank" rel="noopener" download="' + esc(t.fileName || 'training.pdf') + '">' + ic('download', 16) + ' Open the PDF</a></p>';
  return '<div class="a-card a-linkcard">' + ic('external', 22) + '<div><b>This training is hosted elsewhere</b><p class="a-fine">' + esc(t.url) + '</p></div><a class="ld-btn ld-btn-primary ld-btn-sm" href="' + esc(t.url) + '" target="_blank" rel="noopener">Open training</a></div>';
}

/* ---------- Pro: training & level ---------- */
function vProTraining() {
  var p = meP(), cur = proLevel(p), n = cur + 1, c = levelCheck(p, n), pend = pendingApp(p.id, 'LEVEL'), last = proApps(p.id).filter(function (a) { return a.kind === 'LEVEL' && a.status !== 'PENDING'; })[0], ts = liveTrainings();
  var h = '<div class="a-page" style="max-width:920px"><div class="a-head"><div><h1>Training & level</h1><p>Your level decides which jobs LISTD can offer you and your share of each job’s price.</p></div></div>';
  h += '<div class="a-card a-lvcard"><div class="a-row sb"><div>' + levelBar(cur, LEVEL_INFO[cur].name) + '<p style="margin-top:8px"><b>You can take:</b> ' + esc(LEVEL_INFO[cur].unlocks) + '.</p><p class="a-fine">Pay share: ' + lvRule(cur).sharePct + '% of the job price.</p></div></div>';
  if (c) {
    h += '<div class="a-next"><h3>Next: Level ' + n + ' · ' + esc(LEVEL_INFO[n].name) + '</h3><p class="a-fine">Unlocks ' + esc(LEVEL_INFO[n].unlocks.charAt(0).toLowerCase() + LEVEL_INFO[n].unlocks.slice(1)) + ', at a ' + lvRule(n).sharePct + '% pay share.</p>' + reqList(c);
    if (pend) h += banner('clock', 'Application sent ' + fdate(pend.createdAt), 'LISTD will review it and let you know.', '<button class="ld-btn ld-btn-secondary ld-btn-sm" data-act="app-withdraw" data-id="' + pend.id + '">Withdraw</button>', 'warning');
    else h += '<form class="a-form" data-form="apply-level"><input type="hidden" name="to" value="' + n + '">' + (c.ok ? field('ap-note', 'Anything you’d like LISTD to know? <small>Optional</small>', inp('ap-note', 'note', '', 'maxlength="300"')) : '') + '<div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit"' + (c.ok ? '' : ' disabled') + '>Apply for Level ' + n + '</button>' + (c.ok ? '' : '<span class="a-fine">Complete the items above to apply.</span>') + '</div></form>';
    if (last && last.status === 'REJECTED' && !pend) h += '<p class="a-fine" style="color:var(--danger)">Your last application (' + fdate(last.createdAt) + ') wasn’t approved: ' + esc(last.decision && last.decision.reason || '') + '</p>';
    h += '</div>';
  } else h += '<p class="a-fine" style="margin-top:8px">You’re at the top level.</p>';
  h += '</div>';
  h += '<section class="a-sec"><h2>All levels</h2>' + ladder(cur) + '<p class="a-fine">Repairs & Damages jobs are approved separately as a trade skill and aren’t part of the levels.</p></section>';
  var groups = [[4, 'Needed for Level 4'], [5, 'Needed for Level 5'], [2, 'Needed for Level 2'], [3, 'Needed for Level 3'], [0, 'Optional']];
  h += '<section class="a-sec"><h2>Trainings <span class="a-fine">' + ts.filter(function (t) { return doneAt(p, t.id); }).length + ' of ' + ts.length + ' completed</span></h2>' + (ts.length ? groups.map(function (g) { var x = ts.filter(function (t) { return (+t.level || 0) === g[0]; }); return x.length ? '<div class="a-tgroup"><h3>' + g[1] + '</h3><div class="a-card" style="padding:0">' + x.map(function (t) { return trainingRow(t, p); }).join('') + '</div></div>' : ''; }).join('') : empty('training', 'No trainings yet', 'LISTD will add videos and guides here. You’ll get a notification when one is published.', '')) + '</section>';
  return h + '</div>';
}
function vTraining() {
  var t = D.trainings[S.params.id]; if (!t) return '<div class="a-page">' + empty('training', 'Training not found', 'It may have been removed.', '<button class="ld-btn ld-btn-secondary" data-act="back">Back</button>') + '</div>';
  var k = trainKind(t), h = '<div class="a-page" style="max-width:920px"><button class="a-back" data-act="back">' + ic('arrow-left', 16) + ' Back</button><div class="a-head"><div><h1>' + esc(t.title) + '</h1><p>' + k[1] + (t.minutes ? ' · about ' + t.minutes + ' minutes' : '') + ' · ' + (+t.level >= 2 ? 'Needed for Level ' + t.level : 'Optional') + (S.role === 'admin' && t.status !== 'PUBLISHED' ? ' · ' + (t.status === 'DRAFT' ? 'Draft, not visible to Pros' : 'Archived') : '') + '</p></div></div>';
  if (t.desc) h += '<p>' + esc(t.desc) + '</p>';
  h += trainingPlayer(t);
  if (S.role === 'pro') {
    var d = doneAt(meP(), t.id);
    h += d ? banner('success', 'Completed ' + fdate(d, true), 'This counts towards your level requirements.', '', 'brand') : '<form class="a-card a-form" data-form="training-done" data-id="' + t.id + '"><label class="ld-check"><input type="checkbox" name="confirm" id="td-confirm" required><span>I’ve ' + (t.kind === 'pdf' ? 'read' : 'watched') + ' this training in full and understood it</span></label><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Mark as complete</button></div></form>';
  } else {
    var done = list('pros').filter(function (p) { return doneAt(p, t.id); });
    h += '<section class="a-sec"><h2>Completed by <span class="a-fine">' + done.length + ' Pro' + (done.length === 1 ? '' : 's') + '</span></h2>' + (done.length ? '<div class="a-tw"><table><thead><tr><th>Pro</th><th>Level</th><th>Completed</th></tr></thead><tbody>' + done.map(function (p) { return '<tr class="click" data-go="pro" data-id="' + p.id + '"><td>' + esc(p.name) + '</td><td>Level ' + proLevel(p) + '</td><td>' + fdate(doneAt(p, t.id), true) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="a-muted">No one has completed it yet.</p>') + '</section>';
  }
  return h + '</div>';
}

/* ---------- Admin: Pros table ---------- */
function vAdminPros() {
  var tab = S.ptab || 'all', apps = pendingApps(), q = (S.search || '').toLowerCase();
  var ps = list('pros').filter(function (p) {
    if (S.pst && S.pst !== 'all' && p.status !== S.pst) return false;
    if (S.plv && S.plv !== 'all' && String(proLevel(p)) !== S.plv) return false;
    if (q && [p.name, p.email, p.phone, p.status, (p.coverage || []).join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { var o = { PENDING: 0, RESUBMIT: 1, INVITED: 2, APPROVED: 3, DRAFT: 4, SUSPENDED: 5, REJECTED: 6 }; return ((o[a.status] || 9) - (o[b.status] || 9)) || String(a.name).localeCompare(String(b.name)); });
  var h = '<div class="a-page"><div class="a-head"><div><h1>Pros</h1><p>' + list('pros').length + ' Pros · ' + list('pros').filter(function (p) { return p.status === 'APPROVED'; }).length + ' approved. Select a Pro to see their details, documents, level and training.</p></div><button type="button" class="ld-btn ld-btn-primary" data-act="pro-add">' + ic('plus', 18) + ' Add Pro</button></div>';
  h += '<div class="a-segtabs" role="tablist" aria-label="Pros views"><button type="button" role="tab" data-act="ptab" data-t="all" aria-selected="' + (tab === 'all') + '">All Pros</button><button type="button" role="tab" data-act="ptab" data-t="apps" aria-selected="' + (tab === 'apps') + '">Applications' + (apps.length ? '<span class="cnt">' + apps.length + '</span>' : '') + '</button></div>';
  if (tab === 'apps') {
    var hist3 = list('applications').filter(function (a) { return a.status !== 'PENDING' && D.pros[a.proId]; }).sort(byNew).slice(0, 30);
    h += '<section class="a-sec"><h2>Waiting for review</h2>' + (apps.length ? appTable(apps, true) : empty('verified-pro', 'No applications waiting', 'New Pro applications and level-up requests appear here.', '')) + '</section>';
    if (hist3.length) h += '<section class="a-sec"><h2>Decided</h2>' + appTable(hist3, false) + '</section>';
    return h + '</div>';
  }
  h += '<div class="a-row"><label class="sr-only" for="f-pst">Status</label><select class="a-mini" id="f-pst" data-filt="pst"><option value="all">All statuses</option>' + [['APPROVED', 'Approved'], ['INVITED', 'Invited'], ['PENDING', 'Under review'], ['RESUBMIT', 'Changes requested'], ['DRAFT', 'Application not finished'], ['SUSPENDED', 'Suspended'], ['REJECTED', 'Not approved']].map(function (o) { return '<option value="' + o[0] + '"' + (S.pst === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select><label class="sr-only" for="f-plv">Level</label><select class="a-mini" id="f-plv" data-filt="plv"><option value="all">All levels</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (S.plv === String(n) ? ' selected' : '') + '>Level ' + n + ' · ' + LEVEL_INFO[n].name + '</option>'; }).join('') + '</select><label class="sr-only" for="f-pq">Search</label><input class="a-mini" id="f-pq" data-filt="search" type="search" placeholder="Search name, email, area" value="' + esc(S.search || '') + '"></div>';
  if (!ps.length) return h + empty('verified-pro', list('pros').length ? 'No Pros match' : 'No Pros yet', list('pros').length ? 'Try another filter.' : 'Pros appear here when they start an application.', '') + '</div>';
  var cols = [12, 18, 12, 12, 10, 7, 8, 10, 11];
  var cell = function (html, text, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + ' title="' + esc(text) + '"><span class="clip">' + html + '</span></td>'; };
  h += '<div class="a-tw a-clip"><table><colgroup>' + cols.map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup><thead><tr><th>Pro</th><th>Email</th><th>Level</th><th>Services</th><th>Coverage</th><th class="r">Jobs</th><th class="r">Rating</th><th>Training</th><th>Status</th></tr></thead><tbody>' + ps.map(function (p) {
    var st = proStats(p.id), lv = proLevel(p), nx = lv < 5 ? trainingsForLevel(lv + 1) : [], nd = nx.filter(function (t) { return doneAt(p, t.id); }).length, all = liveTrainings(), ad = all.filter(function (t) { return doneAt(p, t.id); }).length, pa = pendingApp(p.id) || (p.status === 'PENDING' ? { kind: 'JOIN' } : null);
    var svc = (p.skills || []).map(function (s) { return SKILLS[s].label.replace(' inspections', ''); }).join(', ');
    return '<tr class="click" data-go="pro" data-id="' + p.id + '">' + cell('<b>' + esc(p.name || '—') + '</b>', p.name || '') + cell(esc(p.email || '—'), p.email || '') + cell('<span class="a-lvchip">L' + lv + '</span> ' + esc(LEVEL_INFO[lv].name) + (pa && pa.kind === 'LEVEL' ? ' ' + badge('Applied', 'warning') : ''), 'Level ' + lv + ' · ' + LEVEL_INFO[lv].name + (pa && pa.kind === 'LEVEL' ? ' · applied for Level ' + (lv + 1) : '')) + cell(esc(svc || '—'), svc) + cell(esc((p.coverage || []).join(', ') || '—'), (p.coverage || []).join(', ')) + cell(st.completed, st.completed, 'r num') + cell(st.rating != null ? st.rating.toFixed(1) : '—', st.rating != null ? st.rating.toFixed(2) : 'No ratings', 'r num') + cell(all.length ? ad + ' of ' + all.length + (nx.length && lv < 5 ? ' <span class="a-fine">· L' + (lv + 1) + ': ' + nd + '/' + nx.length + '</span>' : '') : '—', all.length ? ad + ' of ' + all.length + ' trainings completed' : 'No trainings published') + cell(proStatusBadge(p), proStatusLabel(p)) + '</tr>';
  }).join('') + '</tbody></table></div>';
  return h + '</div>';
}
function proStatusLabel(p) { if (p.status === 'INVITED') return inviteOpen(p) ? 'Invited' : 'Invite expired'; if (p.status === 'REJECTED' && p.invite && p.invite.cancelledAt) return 'Invite cancelled'; return { APPROVED: 'Approved', PENDING: 'Under review', RESUBMIT: 'Changes requested', REJECTED: 'Not approved', SUSPENDED: 'Suspended', DRAFT: 'Onboarding' }[p.status] || p.status; }
function proStatusBadge(p) { return badge(proStatusLabel(p), p.status === 'APPROVED' ? 'success' : p.status === 'PENDING' ? 'warning' : p.status === 'INVITED' ? (inviteOpen(p) ? 'info' : 'danger') : p.status === 'SUSPENDED' || p.status === 'REJECTED' ? 'danger' : ''); }
function appTable(apps, open) {
  return '<div class="a-tw"><table><thead><tr><th>Pro</th><th>Application</th><th>' + (open ? 'Submitted' : 'Decided') + '</th><th>' + (open ? 'Requirements' : 'Reason') + '</th><th>Status</th></tr></thead><tbody>' + apps.map(function (a) {
    var p = D.pros[a.proId], req = '';
    if (open) { if (a.kind === 'JOIN') { var miss = DOCS.filter(function (d) { return d[2] && !(p.docs || []).some(function (x) { return x.type === d[0]; }); }); req = miss.length ? badge(miss.length + ' document' + (miss.length > 1 ? 's' : '') + ' missing', 'warning') : badge('Documents uploaded', 'success'); } else { var c = levelCheck(p, a.to); req = c.ok ? badge('All met', 'success') : badge(c.rows.filter(function (x) { return !x.ok; }).length + ' not met', 'danger'); } }
    else req = '<span class="a-fine">' + esc((a.decision || {}).reason || '') + '</span>';
    return '<tr class="click" data-go="pro" data-id="' + a.proId + '"><td><b>' + esc(p.name) + '</b><div class="a-fine">' + esc(p.email || '') + '</div></td><td>' + esc(appTitle(a)) + (a.kind === 'LEVEL' ? '<div class="a-fine">' + esc(LEVEL_INFO[a.to].name) + '</div>' : '') + '</td><td>' + fdate(open ? a.createdAt : (a.decision || {}).at || a.updatedAt, true) + '</td><td>' + req + '</td><td>' + appBadge(a) + '</td></tr>';
  }).join('') + '</tbody></table></div>';
}

/* ---------- Admin: one Pro ---------- */
function vAdminPro() {
  var p = D.pros[S.params.id]; if (!p) return '<div class="a-page">' + empty('verified-pro', 'Pro not found', '', '<button class="ld-btn ld-btn-secondary" data-go="pros">All Pros</button>') + '</div>';
  var st = proStats(p.id), lv = proLevel(p), apps = proApps(p.id), join = p.status === 'PENDING' || p.status === 'RESUBMIT', pl = pendingApp(p.id, 'LEVEL'), ts = liveTrainings(), today = new Date().toISOString().slice(0, 10);
  var h = '<div class="a-page"><button class="a-back" data-go="pros">' + ic('arrow-left', 16) + ' All Pros</button>';
  h += '<div class="a-prohead">' + avatar(p.name, p.status === 'APPROVED', 'lg') + '<div class="t"><h1>' + esc(p.name) + '</h1><div class="a-row" style="gap:8px">' + proStatusBadge(p) + levelBar(lv, LEVEL_INFO[lv].name) + '</div></div><div class="a-grid k a-prostats">' + stat('Completed jobs', st.completed) + stat('Active jobs', st.active) + stat('Rating', st.rating != null ? st.rating.toFixed(1) : '—', st.ratings ? st.ratings + ' rating' + (st.ratings > 1 ? 's' : '') : 'No ratings yet') + stat('Paid to Pro', P(st.paid)) + '</div></div>';
  if (p.status === 'INVITED') h += banner('bell', inviteOpen(p) ? 'Invitation sent ' + fdate(p.invite.sentAt, true) : 'Invitation expired', inviteOpen(p) ? 'Waiting for ' + esc(p.firstName || p.name) + ' to accept it and create a password. Expires ' + fdate(p.invite.expiresAt) + '.' : 'Send a new invitation so ' + esc(p.firstName || p.name) + ' can join.', '<button type="button" class="ld-btn ld-btn-primary ld-btn-sm" data-act="pro-resend" data-id="' + p.id + '">' + (inviteOpen(p) ? 'Resend invitation' : 'Send new invitation') + '</button><button type="button" class="ld-btn ld-btn-secondary ld-btn-sm" data-act="pro-uninvite" data-id="' + p.id + '">Cancel invitation</button>', inviteOpen(p) ? 'brand' : 'danger');
  if (p.status === 'PENDING') h += banner('verified-pro', 'New Pro application', 'Check their details and documents below, then approve, ask for changes or decline.', '<a class="ld-btn ld-btn-primary ld-btn-sm" href="#pd-apps">Review application</a>', 'warning');
  if (pl) h += banner('training', 'Applied for Level ' + pl.to + ' · ' + LEVEL_INFO[pl.to].name, 'Sent ' + fdate(pl.createdAt, true) + '.', '<a class="ld-btn ld-btn-primary ld-btn-sm" href="#pd-apps">Review application</a>', 'warning');
  var expd = (p.docs || []).filter(function (d) { return d.expires && d.expires < today; }); if (expd.length) h += banner('warning', 'Expired document: ' + expd.map(function (d) { return d.type; }).join(', '), 'The Pro can’t receive offers until it’s replaced.', '', 'danger');
  h += '<div class="a-pdgrid">';
  /* personal details */
  h += '<section class="a-card" id="pd-personal"><h3>' + ic('user', 18) + ' Personal details</h3><dl class="a-kv"><dt>Full name</dt><dd>' + esc(p.name) + '</dd><dt>Email</dt><dd>' + esc(p.email || '—') + '</dd><dt>Phone</dt><dd>' + esc(p.phone || '—') + '</dd><dt>Home postcode</dt><dd>' + esc(p.home || '—') + '</dd><dt>Working as</dt><dd>' + (p.bizType === 'ltd' ? 'Limited company' : p.bizType ? 'Sole trader / individual' : '—') + (p.bizName ? ' · ' + esc(p.bizName) : '') + '</dd><dt>Joined</dt><dd>' + fdate(p.createdAt) + '</dd><dt>Application sent</dt><dd>' + fdate((p.onboarding || {}).submittedAt, true) + '</dd><dt>Payout account</dt><dd>' + (p.payout && p.payout.ready ? esc(p.payout.holder || '') + ' · ending ' + esc(p.payout.last4) + ' (test)' : 'Not set up') + '</dd></dl></section>';
  /* work */
  var av = p.availability || {};
  h += '<section class="a-card" id="pd-work"><h3>' + ic('calendar', 18) + ' Work preferences</h3><dl class="a-kv"><dt>Services</dt><dd>' + ((p.skills || []).map(function (s) { return SKILLS[s].label; }).join(', ') || '—') + '</dd><dt>Areas covered</dt><dd>' + esc((p.coverage || []).join(', ') || '—') + '</dd><dt>Working days</dt><dd>' + ((av.days || []).map(function (d) { return DAYS[d]; }).join(', ') || '—') + '</dd><dt>Windows</dt><dd>' + ((av.slots || []).map(function (s) { return (WINDOWS[s] || [s])[0]; }).join(', ') || '—') + '</dd><dt>Can be offered</dt><dd>' + esc(LEVEL_INFO[lv].unlocks) + ((p.skills || []).indexOf('REPAIRS_DAMAGES') >= 0 ? ', plus Repairs & Damages' : '') + '</dd></dl></section>';
  h += '</div>';
  /* level */
  var c = levelCheck(p, lv + 1), hist4 = (p.levelHistory || []).slice().reverse();
  h += '<section class="a-card" id="pd-level"><h3>' + ic('star', 18) + ' Level & pay</h3><div class="a-pdlevel"><div>' + levelBar(lv, LEVEL_INFO[lv].name) + '<p style="margin-top:8px">' + esc(LEVEL_INFO[lv].unlocks) + '.</p><p class="a-fine">Pay share ' + lvRule(lv).sharePct + '% of the job price.</p>' + (c ? '<h4>Requirements for Level ' + (lv + 1) + ' · ' + esc(LEVEL_INFO[lv + 1].name) + '</h4>' + reqList(c) : '<p class="a-fine">At the top level.</p>') + '</div>' +
    '<form class="a-form a-subcard" data-form="set-level" data-id="' + p.id + '"><h4>Change level</h4>' + field('sl-' + p.id + '-' + lv, 'New level', sel('sl-' + p.id + '-' + lv, 'level', [1, 2, 3, 4, 5].map(function (n) { var g = trainingGate(p, n); return [n, 'Level ' + n + ' · ' + LEVEL_INFO[n].name + (g !== true ? ' (training not done)' : '')]; }), lv)) + field('slr-' + p.id, 'Reason', inp('slr-' + p.id, 'reason', '', 'required'), 'Recorded in the audit log. Levels 4 and 5 need the required trainings completed.') + '<div class="a-actions"><button class="ld-btn ld-btn-secondary ld-btn-sm" type="submit">Save level</button></div></form></div>' +
    (hist4.length ? '<details><summary>Level history (' + hist4.length + ')</summary><ul class="a-fine">' + hist4.map(function (x) { return '<li>' + fdate(x.at, true) + ': Level ' + x.from + ' → ' + x.to + ' · ' + esc(x.reason) + '</li>'; }).join('') + '</ul></details>' : '') + '</section>';
  /* applications */
  var joinForm = join ? '<form class="a-form a-subcard" data-form="pro-review" data-id="' + p.id + '"><h4>Decide on this application</h4><div class="two">' + field('lv-' + p.id, 'Starting level', sel('lv-' + p.id, 'level', [1, 2, 3, 4, 5].map(function (n) { var g = trainingGate(p, n); return [n, 'Level ' + n + ' · ' + LEVEL_INFO[n].name + (g !== true ? ' (training not done)' : '')]; }), 1)) + field('rv-' + p.id, 'Reason / note <small>Required unless approving</small>', inp('rv-' + p.id, 'reason', '')) + '</div><div class="a-actions"><button class="ld-btn ld-btn-primary ld-btn-sm" name="d" value="APPROVED"' + (p.status === 'PENDING' ? '' : ' disabled title="Waiting for the Pro to resubmit"') + '>Approve</button><button class="ld-btn ld-btn-secondary ld-btn-sm" name="d" value="RESUBMIT">Request changes</button><button class="ld-btn ld-btn-danger ld-btn-sm" name="d" value="REJECTED">Decline</button></div></form>' : '';
  var shown = apps.slice(); if (p.status === 'PENDING' && !apps.some(function (a) { return a.kind === 'JOIN' && a.status === 'PENDING'; })) shown.unshift({ id: 'join-' + p.id, kind: 'JOIN', status: 'PENDING', createdAt: (p.onboarding || {}).submittedAt });
  h += '<section class="a-card" id="pd-apps"><h3>' + ic('verified-pro', 18) + ' Applications</h3>' + (shown.length ? shown.map(function (a) {
    var body = '<div class="a-app"><div class="a-row sb"><div><b>' + esc(appTitle(a)) + '</b>' + (a.kind === 'LEVEL' ? ' <span class="a-fine">' + esc(LEVEL_INFO[a.to].name) + '</span>' : '') + '<div class="a-fine">Sent ' + fdate(a.createdAt, true) + (a.decision && a.decision.at ? ' · decided ' + fdate(a.decision.at, true) : '') + '</div></div>' + appBadge(a) + '</div>';
    if (a.note) body += '<p class="a-fine">Pro’s note: “' + esc(a.note) + '”</p>';
    if (a.decision && a.decision.reason) body += '<p class="a-fine">Decision: ' + esc(a.decision.reason) + '</p>';
    if (a.status === 'PENDING' && a.kind === 'LEVEL') { var ck = levelCheck(p, a.to); body += reqList(ck) + '<form class="a-form" data-form="app-decide" data-id="' + a.id + '">' + field('ad-' + a.id, 'Reason / note <small>Required to decline</small>', inp('ad-' + a.id, 'reason', '')) + '<div class="a-actions"><button class="ld-btn ld-btn-primary ld-btn-sm" name="d" value="APPROVE"' + (trainingGate(p, a.to) === true ? '' : ' disabled title="Required trainings not completed"') + '>Approve Level ' + a.to + '</button><button class="ld-btn ld-btn-danger ld-btn-sm" name="d" value="REJECT">Decline</button></div></form>'; }
    if (a.status === 'PENDING' && a.kind === 'JOIN') body += joinForm;
    return body + '</div>';
  }).join('') : '<p class="a-muted">No applications yet.</p>') + (join && !shown.some(function (a) { return a.kind === 'JOIN' && a.status === 'PENDING'; }) ? joinForm : '') + '</section>';
  /* trainings */
  var tdn = ts.filter(function (t) { return doneAt(p, t.id); }).length;
  h += '<section class="a-card" id="pd-training"><h3>' + ic('training', 18) + ' Trainings <span class="a-fine">' + tdn + ' of ' + ts.length + ' completed</span></h3>' + (ts.length ? '<div class="a-tw"><table><thead><tr><th>Training</th><th>Needed for</th><th>Type</th><th>Status</th></tr></thead><tbody>' + ts.map(function (t) { var d = doneAt(p, t.id); return '<tr class="click" data-go="training" data-id="' + t.id + '"><td><b>' + esc(t.title) + '</b></td><td>' + forLevel(t) + '</td><td>' + trainKind(t)[1] + '</td><td>' + (d ? badge('Completed ' + fdate(d), 'success', 'check') : badge('Not completed', '')) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="a-muted">No trainings published yet. Add them under Training.</p>') + '</section>';
  /* documents */
  h += '<section class="a-card" id="pd-docs"><h3>' + ic('file', 18) + ' Documents <span class="a-fine">Admins only. Never shown in reports.</span></h3><div class="a-tw"><table><thead><tr><th>Document</th><th>File</th><th>Uploaded</th><th>Expires</th><th>Status</th></tr></thead><tbody>' + DOCS.map(function (dd) {
    var d = (p.docs || []).filter(function (x) { return x.type === dd[0]; })[0], e = d && D.evidence[d.fileId], need = dd[2] || (dd[0] === 'INSURANCE' && (p.skills || []).indexOf('REPAIRS_DAMAGES') >= 0);
    var stt = !d ? (need ? badge('Missing', 'danger') : badge('Not needed', '')) : d.expires && d.expires < today ? badge('Expired', 'danger') : badge('Uploaded', 'success');
    return '<tr><td>' + esc(dd[1]) + '</td><td>' + (d ? (e ? '<a href="' + esc(fileSrc(e)) + '" target="_blank" rel="noopener">' + esc(d.name) + '</a>' : esc(d.name)) : '—') + '</td><td>' + (d ? fdate(d.at) : '—') + '</td><td>' + (d && d.expires ? fdate(d.expires) : '—') + '</td><td>' + stt + '</td></tr>';
  }).join('') + '</tbody></table></div></section>';
  /* jobs */
  var js = list('jobs').filter(function (j) { return j.proId === p.id; }).sort(byNew);
  h += '<section class="a-sec" id="pd-jobs"><h2>Jobs</h2>' + (js.length ? jobTable(js.slice(0, 20)) : empty('calendar', 'No jobs yet', 'Jobs this Pro accepts appear here.', '')) + '</section>';
  /* account */
  if (p.status === 'APPROVED' || p.status === 'SUSPENDED') h += '<form class="a-card a-form" data-form="pro-review" data-id="' + p.id + '"><h3>' + ic('lock', 18) + ' Account</h3>' + field('rv-' + p.id, 'Reason', inp('rv-' + p.id, 'reason', '', 'required')) + '<div class="a-actions">' + (p.status === 'APPROVED' ? '<button class="ld-btn ld-btn-danger ld-btn-sm" name="d" value="SUSPENDED">Suspend Pro</button>' : '<button class="ld-btn ld-btn-secondary ld-btn-sm" name="d" value="APPROVED">Reinstate</button>') + '</div></form>';
  return h + '</div>';
}

/* ---------- Admin: Training library ---------- */
function vAdminTraining() {
  var all = list('trainings').filter(function (t) { return S.tshow === 'archived' ? t.status === 'ARCHIVED' : t.status !== 'ARCHIVED'; }).sort(function (a, b) { return ((+a.level || 9) - (+b.level || 9)) || byNew(a, b); }), approved = list('pros').filter(function (p) { return p.status === 'APPROVED'; }), up = S.tUp;
  var h = '<div class="a-page"><div class="a-head"><div><h1>Training</h1><p>Videos and PDFs for Pros. A training marked for Level 4 or 5 must be completed before a Pro can move up to that level.</p></div><button type="button" class="ld-btn ld-btn-primary" data-act="t-new">' + ic('plus', 18) + ' Add training materials</button></div>';
  h += '<section class="a-sec"><h2>Library <span class="a-row" style="gap:6px"><button type="button" class="ld-btn ld-btn-sm ' + (S.tshow === 'archived' ? 'ld-btn-ghost' : 'ld-btn-secondary') + '" data-act="tshow" data-t="">Current</button><button type="button" class="ld-btn ld-btn-sm ' + (S.tshow === 'archived' ? 'ld-btn-secondary' : 'ld-btn-ghost') + '" data-act="tshow" data-t="archived">Archived</button></span></h2>' + (all.length ? '<div class="a-tw"><table><thead><tr><th>Training</th><th>Type</th><th>Needed for</th><th class="r">Length</th><th class="r">Completed by</th><th>Status</th><th></th></tr></thead><tbody>' + all.map(function (t) {
    var n = approved.filter(function (p) { return doneAt(p, t.id); }).length, k = trainKind(t);
    var acts = t.status === 'PUBLISHED' ? '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="t-status" data-id="' + t.id + '" data-s="DRAFT">Unpublish</button>' : t.status === 'DRAFT' ? '<button type="button" class="ld-btn ld-btn-secondary ld-btn-sm" data-act="t-status" data-id="' + t.id + '" data-s="PUBLISHED">Publish</button>' : '<button type="button" class="ld-btn ld-btn-secondary ld-btn-sm" data-act="t-status" data-id="' + t.id + '" data-s="DRAFT">Restore</button>';
    if (t.status !== 'ARCHIVED') acts += '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="t-status" data-id="' + t.id + '" data-s="ARCHIVED">Archive</button>';
    return '<tr><td><a href="#" class="a-tlink" data-go="training" data-id="' + t.id + '"><b>' + esc(t.title) + '</b></a>' + (t.desc ? '<div class="a-fine">' + esc(t.desc.length > 90 ? t.desc.slice(0, 90) + '…' : t.desc) + '</div>' : '') + '</td><td class="nw">' + ic(k[0], 16) + ' ' + k[1] + '</td><td>' + forLevel(t) + '</td><td class="r num">' + (t.minutes ? t.minutes + ' min' : '—') + '</td><td class="r num">' + n + ' of ' + approved.length + '</td><td>' + badge({ PUBLISHED: 'Published', DRAFT: 'Draft', ARCHIVED: 'Archived' }[t.status], t.status === 'PUBLISHED' ? 'success' : '') + '</td><td class="r"><span class="a-row" style="gap:4px;justify-content:flex-end;flex-wrap:nowrap">' + acts + '</span></td></tr>';
  }).join('') + '</tbody></table></div>' : empty('training', S.tshow === 'archived' ? 'Nothing archived' : 'No trainings yet', S.tshow === 'archived' ? 'Archived trainings appear here.' : 'Use Add training materials to upload a video or PDF. Pros see published trainings under Training & level.', '')) + '</section>';
  h += '<section class="a-sec"><h2>Levels</h2>' + '<div class="a-tw"><table><thead><tr><th>Level</th><th>Can take</th><th class="r">Min. jobs</th><th class="r">Min. rating</th><th class="r">Pay share</th><th class="r">Required trainings</th><th class="r">Pros</th></tr></thead><tbody>' + [1, 2, 3, 4, 5].map(function (n) { var r = lvRule(n), req = liveTrainings().filter(function (t) { return +t.level === n; }).length; return '<tr><td class="nw"><span class="a-lvchip">L' + n + '</span> <b>' + esc(LEVEL_INFO[n].name) + '</b></td><td>' + esc(LEVEL_INFO[n].unlocks) + '</td><td class="r num">' + r.minJobs + '</td><td class="r num">' + (r.minRating ? (+r.minRating).toFixed(1) : '—') + '</td><td class="r num">' + r.sharePct + '%</td><td class="r num">' + (n >= 2 ? req : '—') + '</td><td class="r num">' + approved.filter(function (p) { return proLevel(p) === n; }).length + '</td></tr>'; }).join('') + '</tbody></table></div><p class="a-fine">Job, rating and pay-share rules can be changed in Catalogue & policies.</p></section>';
  return h + '</div>';
}
function trainingModal() {
  var up = S.tUp;
  var body = field('tr-title', 'Title', inp('tr-title', 'title', '', 'required maxlength="120" placeholder="e.g. Writing a check-in inventory"')) + field('tr-desc', 'What it covers <small>Optional</small>', area('tr-desc', 'desc', '', 'maxlength="600"')) +
    '<div class="ld-field"><span class="ld-label">Video or PDF</span>' + (up ? '<div class="a-upfile">' + ic(up.kind === 'video' ? 'play' : 'file', 20) + '<span><b>' + esc(up.name) + '</b><span class="a-fine">' + (up.kind === 'video' ? 'Video' : 'PDF') + ' · ' + (up.size < 1048576 ? Math.max(1, Math.round(up.size / 1024)) + ' KB' : (Math.round(up.size / 104857.6) / 10) + ' MB') + '</span></span><button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="t-unup">Remove</button></div>' : '<label class="a-up">' + ic('upload', 18) + 'Upload a video or PDF<input type="file" accept="video/mp4,video/webm,video/quicktime,application/pdf" data-up=\'{"training":1}\'></label><span class="ld-hint">MP4, WebM or MOV video, or PDF, up to ' + (ENV.assets ? '20' : '2.5') + ' MB.' + (ENV.assets ? '' : ' Local demo mode: larger files need the published app.') + '</span>') + '</div>' +
    (up ? '' : field('tr-link', 'Or link to a video <small>Optional, https only</small>', inp('tr-link', 'link', '', 'type="url" placeholder="https://"'), 'Use a link for long videos hosted on YouTube, Vimeo or similar.')) +
    '<div class="two">' + field('tr-level', 'Required for', sel('tr-level', 'level', [[4, 'Level 4 · Inspector'], [5, 'Level 5 · Senior inspector'], [2, 'Level 2 · Experienced cleaner'], [3, 'Level 3 · Senior cleaner'], [0, 'Optional, not required']], 4)) + field('tr-min', 'Length (minutes)', inp('tr-min', 'minutes', '', 'type="number" min="0" step="1"')) + '</div><label class="ld-check"><input type="checkbox" name="publish" id="tr-pub" checked><span>Publish now<small>Approved Pros get a notification. Untick to save as a draft.</small></span></label>';
  return mShell('training-add', 'Add training materials', body, 'Add training');
}

/* ---------- Pro invitations ---------- */
/* Admin adds a Pro with first name + email. LISTD makes a one-time code (only its SHA-256 hash is stored)
   and a link. The Pro opens the link, confirms the code and their email, creates a password, then onboards.
   No email service is connected yet, so the Admin sends the invitation from their own email app. */
var APP_URL = 'https://claude.ai/artifact/Ed8g6GLxSidccdj98sE5aW', INVITE_DAYS = 7;
async function sha256(s) { var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function newCode() { var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = randBytes(8), s = ''; for (var i = 0; i < 8; i++) s += A[b[i] % A.length]; return s.slice(0, 4) + '-' + s.slice(4); }
function normCode(c) { c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c; }
function inviteLink(code) { var base = ENV.mode === 'db' ? APP_URL : String(location.href).split('#')[0]; return base + '#invite=' + code; }
function inviteOpen(p) { return p && p.status === 'INVITED' && p.invite && !p.invite.acceptedAt && hoursFrom(p.invite.expiresAt) > 0; }
function inviteMail(p, code) {
  var first = p.firstName || p.name || 'there', link = inviteLink(code), exp = fdate(p.invite.expiresAt);
  var body = 'Hi ' + first + ',\n\nYou’ve been invited to join LISTD as a Pro.\n\n1. Open this link: ' + link + '\n2. Choose Pro, then "Accept an invitation".\n3. Enter your code ' + code + ' and this email address (' + p.email + '), then create your password.\n\nYou’ll then add your details, skills, area and documents so LISTD can approve you for work.\n\nThis invitation expires on ' + exp + '.\n\nThe LISTD team';
  return 'mailto:' + encodeURIComponent(p.email) + '?subject=' + encodeURIComponent('You’re invited to join LISTD as a Pro') + '&body=' + encodeURIComponent(body);
}
async function cmdInvitePro(first, email) {
  first = String(first || '').trim(); email = normEmail(email);
  if (!first) return deny('Enter the Pro’s first name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return deny('Enter a valid email address.');
  if (list('pros').some(function (p) { return normEmail(p.email) === email && p.status !== 'REJECTED'; })) return deny('A Pro with this email already exists.');
  var code = newCode(), id = uid(), inv = { hash: await sha256(code), sentAt: now(), expiresAt: addH(now(), INVITE_DAYS * 24), by: ENV.uid || 'admin' };
  setDoc('pros', id, { name: first, firstName: first, email: email, status: 'INVITED', invite: inv, consent: {}, onboarding: { status: 'IN_PROGRESS', step: 2 }, ownerUid: null, createdAt: now() });
  audit('pro.invite', 'pro', id, 'Invited ' + email);
  return { id: id, code: code };
}
async function cmdResendInvite(id) {
  var p = D.pros[id]; if (!p || p.status !== 'INVITED') return deny('This invitation can’t be resent.');
  var code = newCode(); await patchDoc('pros', id, { invite: Object.assign({}, p.invite, { hash: await sha256(code), sentAt: now(), expiresAt: addH(now(), INVITE_DAYS * 24) }) });
  audit('pro.invite_resend', 'pro', id, 'New invitation code'); return { id: id, code: code };
}
function cmdCancelInvite(id) { var p = D.pros[id]; if (!p || p.status !== 'INVITED') return false; patchDoc('pros', id, { status: 'REJECTED', invite: Object.assign({}, p.invite, { cancelledAt: now() }), review: { decision: 'REJECTED', reason: 'Invitation cancelled', at: now() } }); audit('pro.invite_cancel', 'pro', id, 'Invitation cancelled'); return true; }
function inviteModal() {
  var m = S.modal;
  if (m.done) {
    var p = D.pros[m.done.id] || {}, link = inviteLink(m.done.code);
    return '<div class="a-modal a-form" role="dialog" aria-modal="true" aria-labelledby="m-h"><div class="a-row sb"><h2 id="m-h">Invitation ready</h2><button type="button" class="ld-iconbtn" data-act="close" aria-label="Close">' + ic('close', 20) + '</button></div>' +
      '<p class="a-muted">Send this to <b>' + esc(p.email) + '</b>. ' + esc(p.firstName || p.name) + ' opens the link, enters the code with their email and creates a password, then continues the normal Pro onboarding. It expires on ' + fdate((p.invite || {}).expiresAt) + '.</p>' +
      '<div class="a-invite"><div><span class="a-fine">Invitation code</span><b class="num" id="inv-code">' + esc(m.done.code) + '</b></div><div><span class="a-fine">Link</span><span class="num" id="inv-link">' + esc(link) + '</span></div></div>' +
      '<p class="a-fine">Email delivery isn’t connected yet, so the invitation is sent from your own email app. The code is shown only now; resend to make a new one.</p>' +
      '<div class="a-actions"><a class="ld-btn ld-btn-primary" href="' + esc(inviteMail(p, m.done.code)) + '" target="_blank" rel="noopener">' + ic('external', 16) + ' Open in email</a><button type="button" class="ld-btn ld-btn-secondary" data-act="inv-copy">Copy invitation</button><button type="button" class="ld-btn ld-btn-ghost" data-act="close">Done</button></div></div>';
  }
  return mShell('pro-invite', 'Add a Pro', '<p class="a-muted">LISTD creates a one-time invitation. The Pro verifies their email by using it to create their password, then completes onboarding as usual.</p>' + field('pi-first', 'First name', inp('pi-first', 'first', '', 'required autocomplete="off"')) + field('pi-email', 'Email address', inp('pi-email', 'email', '', 'type="email" required autocomplete="off" autocapitalize="none" spellcheck="false"'), 'Their personal email. The invitation is sent here.'), 'Create invitation');
}
