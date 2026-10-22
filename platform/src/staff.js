/* ===================== Staff, roles and permissions (Admin) ===================== */
/* One Main admin owns the LISTD account. The Main admin adds staff as Sub-admin or Operations.
   Staff records live in the shared `staff` collection; sign-in details stay in each person's private store.
   The page hides what a role can't use and refuses those actions; server-side enforcement needs the production backend. */
var STAFF_ROLES = {
  MAIN: { label: 'Main admin', short: 'Owner', d: 'Owns the LISTD account. Full access, and the only role that can manage staff, roles, policies and ownership.' },
  SUB: { label: 'Sub-admin', short: 'Sub-admin', d: 'Runs the business day to day: requests, Pros and training, invoicing, finance, disputes and the audit log. Can’t change policies or staff.' },
  OPS: { label: 'Operations', short: 'Operations', d: 'Runs the work: requests, quotes and invoices, assignments, report reviews, clients and properties. No money movements, Pro approvals, policies or staff.' }
};
/* which roles can open each Admin section */
var STAFF_AREAS = [
  ['home', 'Overview & work queues', ['MAIN', 'SUB', 'OPS']],
  ['requests', 'Requests, quotes & job pages', ['MAIN', 'SUB', 'OPS']],
  ['assign', 'Assignments & calendar', ['MAIN', 'SUB', 'OPS']],
  ['reviews', 'Report reviews', ['MAIN', 'SUB', 'OPS']],
  ['invoicing', 'Invoicing (repairs)', ['MAIN', 'SUB', 'OPS']],
  ['clients', 'Clients & properties', ['MAIN', 'SUB', 'OPS']],
  ['disputes', 'Disputes & outcomes', ['MAIN', 'SUB']],
  ['finance', 'Finance: refunds & Pro payouts', ['MAIN', 'SUB']],
  ['pros', 'Pros: invitations, approvals & levels', ['MAIN', 'SUB']],
  ['training', 'Training library', ['MAIN', 'SUB']],
  ['audit', 'Audit log', ['MAIN', 'SUB']],
  ['policies', 'Catalogue & policies', ['MAIN']],
  ['team', 'Users & roles', ['MAIN']]
];
var VIEW_AREA = { job: 'requests', property: 'clients', properties: 'clients', pro: 'pros', inbox: 'home', settings: 'home' };
function myAdminAcc() { var s = session('admin'); return s ? AUTH.accounts.filter(function (a) { return a.id === s.accountId; })[0] || null : null; }
function staffList() { return list('staff').filter(function (x) { return x.status !== 'DELETED'; }); }
function myStaff() {
  var a = myAdminAcc(); if (!a) return null;
  return staffList().filter(function (x) { return x.status !== 'INVITED' && ((ENV.uid && x.uid === ENV.uid) || x.accountId === a.id); })[0] || null;
}
function staffRole() { var s = myStaff(); return s && s.status === 'ACTIVE' ? s.role : null; }
function staffCan(area) { var r = staffRole(); if (!r) return false; var x = STAFF_AREAS.filter(function (z) { return z[0] === area; })[0]; return !x || x[2].indexOf(r) >= 0; }
function viewAllowed(v) { return staffCan(VIEW_AREA[v] || v); }
/* runs after an Admin signs in: first admin becomes Main admin; invited staff claim their role; anyone else waits */
var STAFF_SYNC = {};
function ensureStaff() {
  if (S.role !== 'admin' || !S.adminOk || ENV.mode === 'connecting' || !ENV.ready) return;
  var a = myAdminAcc(); if (!a || myStaff() || STAFF_SYNC[a.id]) return;
  STAFF_SYNC[a.id] = 1;
  var all = staffList(), hasMain = all.some(function (x) { return x.role === 'MAIN' && x.status === 'ACTIVE'; });
  var inv = all.filter(function (x) { return x.status === 'INVITED' && normEmail(x.email) === normEmail(a.email); })[0];
  var base = { uid: ENV.uid || null, accountId: a.id, name: a.name || '', email: a.email, joinedAt: now() };
  if (inv) { patchDoc('staff', inv.id, Object.assign(base, { status: 'ACTIVE' })); audit('staff.join', 'staff', inv.id, a.email + ' joined as ' + STAFF_ROLES[inv.role].label); notify('admin', (a.name || a.email) + ' joined as ' + STAFF_ROLES[inv.role].label); return; }
  if (!hasMain) { var id = uid(); setDoc('staff', id, Object.assign(base, { role: 'MAIN', status: 'ACTIVE', createdAt: now() })); audit('staff.owner', 'staff', id, a.email + ' is the Main admin'); return; }
  var pid = uid(); setDoc('staff', pid, Object.assign(base, { role: null, status: 'PENDING', createdAt: now() })); notify('admin', (a.name || a.email) + ' set up admin sign-in and is waiting for a role');
}
function vStaffBlocked() {
  var s = myStaff(), removed = s && s.status === 'REMOVED';
  return '<div class="a-page" style="max-width:640px">' + empty('lock', removed ? 'Your access was removed' : 'Waiting for a role', removed ? 'Ask the Main admin if you need access again.' : 'Your sign-in is set up. The Main admin needs to give you a role (Sub-admin or Operations) before you can use the admin panel.', '<button class="ld-btn ld-btn-secondary" data-act="signout">Sign out</button>') + '</div>';
}
function vNoAccess() { return '<div class="a-page">' + empty('lock', 'You don’t have access to this section', 'Your role is ' + (STAFF_ROLES[staffRole()] || {}).label + '. Ask the Main admin if you need it.', '<button class="ld-btn ld-btn-secondary" data-go="home">Go to overview</button>') + '</div>'; }
function staffGuard(area, what) { if (S.role !== 'admin' || staffCan(area)) return true; toast('Only ' + STAFF_AREAS.filter(function (z) { return z[0] === area; })[0][2].map(function (r) { return STAFF_ROLES[r].label; }).join(' or ') + ' can ' + what + '.'); return false; }

/* ---------- commands (Main admin only) ---------- */
function cmdStaffInvite(name, email, role) {
  if (!staffGuard('team', 'add staff')) return false;
  email = normEmail(email); name = String(name || '').trim();
  if (!name) return deny('Enter their name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return deny('Enter a valid work email.');
  if (!STAFF_ROLES[role] || role === 'MAIN') return deny('Choose Sub-admin or Operations.');
  if (staffList().some(function (x) { return normEmail(x.email) === email && x.status !== 'REMOVED'; })) return deny('Someone with this email is already on the team.');
  var id = uid(); setDoc('staff', id, { name: name, email: email, role: role, status: 'INVITED', invitedBy: (myStaff() || {}).id || null, createdAt: now() });
  audit('staff.invite', 'staff', id, 'Invited ' + email + ' as ' + STAFF_ROLES[role].label); return id;
}
function cmdStaffRole(id, role) {
  if (!staffGuard('team', 'change roles')) return false;
  var x = D.staff[id]; if (!x) return false; if (x.role === 'MAIN') return deny('Transfer ownership to change the Main admin.');
  if (!STAFF_ROLES[role] || role === 'MAIN') return deny('Choose Sub-admin or Operations.');
  patchDoc('staff', id, { role: role, status: x.status === 'PENDING' || x.status === 'REMOVED' ? 'ACTIVE' : x.status });
  audit('staff.role', 'staff', id, (x.email) + ' → ' + STAFF_ROLES[role].label, { from: x.role, to: role }); return true;
}
function cmdStaffRemove(id) {
  if (!staffGuard('team', 'remove staff')) return false;
  var x = D.staff[id]; if (!x) return false; if (x.role === 'MAIN') return deny('The Main admin can’t be removed. Transfer ownership first.');
  if (x.status === 'INVITED') patchDoc('staff', id, { status: 'DELETED' }); else patchDoc('staff', id, { status: 'REMOVED', removedAt: now() });
  audit('staff.remove', 'staff', id, (x.email) + ' removed'); return true;
}
function cmdStaffTransfer(id) {
  if (!staffGuard('team', 'transfer ownership')) return false;
  var x = D.staff[id], me2 = myStaff(); if (!x || !me2 || x.status !== 'ACTIVE' || x.id === me2.id) return deny('Choose an active staff member.');
  patchDoc('staff', id, { role: 'MAIN' }); patchDoc('staff', me2.id, { role: 'SUB' });
  audit('staff.transfer', 'staff', id, 'Main admin transferred to ' + x.email); notify('admin', (x.name || x.email) + ' is now the Main admin'); return true;
}

/* ---------- Settings › Users & roles ---------- */
function setTeam() {
  var main = staffCan('team'), all = staffList().sort(function (a, b) { var o = { MAIN: 0, SUB: 1, OPS: 2 }; return ((o[a.role] != null ? o[a.role] : 3) - (o[b.role] != null ? o[b.role] : 3)) || String(a.name).localeCompare(String(b.name)); }), mine = myStaff();
  var stB = function (x) { return x.status === 'ACTIVE' ? badge('Active', 'success') : x.status === 'INVITED' ? badge('Invited', 'info') : x.status === 'PENDING' ? badge('Needs a role', 'warning') : badge('Removed', ''); };
  var h = '<div class="a-sethead a-row sb"><div><h2>Users & roles</h2><p>' + (main ? 'Give LISTD staff access by role. You’re the Main admin, the sole owner of this account.' : 'Who has access to the admin panel. Only the Main admin can change roles.') + '</p></div>' + (main ? '<button type="button" class="ld-btn ld-btn-primary" data-act="staff-add">' + ic('plus', 18) + ' Add staff member</button>' : '') + '</div>';
  h += '<div class="a-grid k3 a-roles3">' + ['MAIN', 'SUB', 'OPS'].map(function (r) { var n = all.filter(function (x) { return x.role === r && x.status === 'ACTIVE'; }).length; return '<div class="a-card a-rolecard r-' + r.toLowerCase() + '"><div class="a-row sb"><b>' + STAFF_ROLES[r].label + '</b><span class="a-fine">' + n + ' ' + (n === 1 ? 'person' : 'people') + '</span></div><p class="a-fine">' + STAFF_ROLES[r].d + '</p></div>'; }).join('') + '</div>';
  h += '<section class="a-sec"><h3 class="a-subh">Staff</h3><div class="a-tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Since</th>' + (main ? '<th></th>' : '') + '</tr></thead><tbody>' + all.map(function (x) {
    var you = mine && x.id === mine.id, roleCell = x.role === 'MAIN' ? '<b>' + STAFF_ROLES.MAIN.label + '</b>' : main && x.status !== 'REMOVED' ? '<label class="sr-only" for="sr-' + x.id + '">Role for ' + esc(x.name || x.email) + '</label><select class="a-mini" id="sr-' + x.id + '" data-staffrole="' + x.id + '">' + (x.role ? '' : '<option value="">Choose a role</option>') + ['SUB', 'OPS'].map(function (r) { return '<option value="' + r + '"' + (x.role === r ? ' selected' : '') + '>' + STAFF_ROLES[r].label + '</option>'; }).join('') + '</select>' : esc(x.role ? STAFF_ROLES[x.role].label : '—');
    var acts = !main || x.role === 'MAIN' ? '' : (x.status === 'ACTIVE' ? '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm" data-act="staff-transfer" data-id="' + x.id + '">Make Main admin</button>' : '') + (x.status === 'REMOVED' ? '' : '<button type="button" class="ld-btn ld-btn-ghost ld-btn-sm a-danger" data-act="staff-remove" data-id="' + x.id + '">' + (x.status === 'INVITED' ? 'Cancel invite' : 'Remove access') + '</button>');
    return '<tr><td><b>' + esc(x.name || '—') + '</b>' + (you ? ' <span class="a-fine">(you)</span>' : '') + '</td><td>' + esc(x.email || '') + '</td><td>' + roleCell + '</td><td>' + stB(x) + '</td><td class="nw">' + fdate(x.joinedAt || x.createdAt) + '</td>' + (main ? '<td class="r"><span class="a-row" style="gap:4px;justify-content:flex-end;flex-wrap:nowrap">' + acts + '</span></td>' : '') + '</tr>';
  }).join('') + '</tbody></table></div>' + (all.some(function (x) { return x.status === 'INVITED'; }) ? '<p class="a-fine">Invited staff join when they set up admin sign-in with the invited email. They also need edit access to this workspace (Share › Can edit).</p>' : '') + '</section>';
  h += '<section class="a-sec"><h3 class="a-subh">What each role can do</h3><div class="a-tw a-fit"><table class="a-perm"><thead><tr><th>Area</th>' + ['MAIN', 'SUB', 'OPS'].map(function (r) { return '<th class="c">' + STAFF_ROLES[r].label + '</th>'; }).join('') + '</tr></thead><tbody>' + STAFF_AREAS.map(function (z) { return '<tr><td>' + esc(z[1]) + '</td>' + ['MAIN', 'SUB', 'OPS'].map(function (r) { var ok = z[2].indexOf(r) >= 0; return '<td class="c">' + (ok ? '<span class="a-yes" aria-label="Yes">' + ic('check', 16) + '</span>' : '<span class="a-no" aria-label="No">—</span>') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
  return h;
}
function staffModal() {
  var m = S.modal;
  if (m.kind === 'transfer') { var x = D.staff[m.id] || {}; return mShell('staff-transfer', 'Make ' + (x.name || x.email) + ' the Main admin?', '<p class="a-muted">There’s only one Main admin. ' + esc(x.name || x.email) + ' becomes the owner of the LISTD account, and you become a Sub-admin. Only they can change this back.</p><label class="ld-check"><input type="checkbox" name="confirm" id="stt-ok" required><span>I understand I’ll lose owner access</span></label>', 'Transfer ownership', 'ld-btn-danger'); }
  return mShell('staff-invite', 'Add staff member', '<p class="a-muted">They’ll get the role when they set up admin sign-in with this email. They also need edit access to this workspace.</p>' + field('sti-name', 'Full name', inp('sti-name', 'name', '', 'required autocomplete="off"')) + field('sti-email', 'Work email', inp('sti-email', 'email', '', 'type="email" required autocomplete="off" autocapitalize="none" spellcheck="false"')) +
    '<fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend class="ld-label" style="margin-bottom:6px">Role</legend>' + ['SUB', 'OPS'].map(function (r, i) { return '<label class="a-opt"><input type="radio" name="role" value="' + r + '"' + (i === 1 ? ' checked' : '') + '><b>' + STAFF_ROLES[r].label + '</b><span>' + STAFF_ROLES[r].d + '</span></label>'; }).join('') + '</fieldset>', 'Add staff member');
}
