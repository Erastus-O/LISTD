/* ===================== Settings (Client, Pro and Admin) ===================== */
var THEME_KEY = 'listd-theme';
function applyTheme(t) { var r = document.documentElement; if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme'); }
applyTheme(lsGet(THEME_KEY));
var NOTIFY_TOPICS = {
  client: [['quotes', 'Quotes and payments', 'New quotes, payment confirmations and refunds'], ['schedule', 'Scheduling', 'Pro confirmed, reschedule requests and arrival'], ['reports', 'Reports', 'Reports ready to review and review reminders'], ['messages', 'Messages', 'New messages on your jobs'], ['disputes', 'Disputes', 'Updates and outcomes']],
  pro: [['offers', 'Job offers', 'New offers and offers about to expire'], ['schedule', 'Scheduling', 'Reschedule requests and changes'], ['reports', 'Report reviews', 'Reports returned for correction'], ['payouts', 'Payouts', 'Payouts released to you'], ['messages', 'Messages', 'New messages on your jobs'], ['account', 'Account', 'Verification and document reminders']],
  admin: [['queue', 'Work queues', 'New requests, reports to review, change orders'], ['disputes', 'Disputes', 'New disputes and responses'], ['finance', 'Finance', 'Payouts ready and payment issues'], ['pros', 'Pro applications', 'New applications to verify']]
};
function settingsTabs() {
  if (S.role === 'admin') return [['account', 'user', 'Account'], ['team', 'users', 'Users & roles'], ['security', 'lock', 'Sign-in & security'], ['notifications', 'bell', 'Notifications'], ['appearance', 'eye', 'Appearance']];
  if (S.role === 'pro') return [['profile', 'user', 'Profile'], ['work', 'calendar', 'Work & availability'], ['documents', 'file', 'Documents'], ['payouts', 'pound', 'Payout account'], ['security', 'lock', 'Sign-in & security'], ['notifications', 'bell', 'Notifications'], ['appearance', 'eye', 'Appearance'], ['privacy', 'escrow', 'Privacy & data']];
  return [['account', 'user', 'Account'], ['billing', 'pound', 'Billing'], ['security', 'lock', 'Sign-in & security'], ['notifications', 'bell', 'Notifications'], ['appearance', 'eye', 'Appearance'], ['privacy', 'escrow', 'Privacy & data']];
}
function myAuthAccount() { var s = session(S.role); return s ? AUTH.accounts.filter(function (a) { return a.id === s.accountId; })[0] || null : null; }
function myProfile() { return S.role === 'client' ? me() : S.role === 'pro' ? meP() : null; }
function vSettings() {
  var tabs = settingsTabs(), tab = S.params.tab && tabs.some(function (t) { return t[0] === S.params.tab; }) ? S.params.tab : tabs[0][0];
  var body = ({ team: setTeam, account: setAccount, billing: setBilling, profile: setProProfile, work: setWork, documents: setDocs, payouts: setPayouts, security: setSecurity, notifications: setNotify, appearance: setAppearance, privacy: setPrivacy })[tab]();
  return '<div class="a-page"><div class="a-head"><div><h1>Settings</h1><p>' + esc(S.role === 'admin' ? 'Your admin account' : S.role === 'pro' ? 'Your Pro account, work and payouts' : 'Your LISTD account') + '</p></div></div><div class="a-settings"><nav class="a-settabs" aria-label="Settings sections">' + tabs.map(function (t) { return '<button type="button" class="a-settab" data-go="settings" data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + ic(t[1], 18) + '<span>' + t[2] + '</span></button>'; }).join('') + '</nav><div class="a-setbody">' + body + '</div></div></div>';
}
function secHeadS(title, sub) { return '<div class="a-sethead"><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>'; }

/* ---- client ---- */
function setAccount() {
  if (S.role === 'admin') { var a = myAuthAccount() || {}; return secHeadS('Account', 'Your LISTD staff account.') + '<form class="a-card a-form" data-form="set-admin"><div class="two">' + field('st-name', 'Full name', inp('st-name', 'name', a.name || '', 'required autocomplete="name"')) + field('st-em', 'Sign-in email', inp('st-em', 'x', a.email || '', 'disabled')) + '</div><p class="a-fine">Change your sign-in email under Sign-in & security.</p><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save</button></div></form>'; }
  var c = me(), isOrg = c.segment && c.segment !== 'LANDLORD';
  return secHeadS('Account', 'Your details and account type.') + '<form class="a-card a-form" data-form="set-account"><div class="two">' + field('st-name', 'Full name', inp('st-name', 'name', c.name, 'required autocomplete="name"')) + field('st-phone', 'Phone', inp('st-phone', 'phone', c.phone, 'type="tel" autocomplete="tel"')) + '</div>' +
    (c.segment ? field('st-org', isOrg ? 'Organisation name' : 'Business name <small>Optional</small>', inp('st-org', 'orgName', c.orgName, isOrg ? 'required' : '')) : '') +
    (c.segment === 'PROPERTY_MANAGER_DEVELOPER' ? field('st-md', 'You are a', sel('st-md', 'mdRole', [['manager', 'Property manager'], ['developer', 'Developer'], ['both', 'Both']], c.mdRole || 'manager')) : '') +
    (c.segment === 'ESTATE_AGENT' ? field('st-br', 'Branch <small>Optional</small>', inp('st-br', 'branch', c.branch)) : '') +
    '<dl class="a-kv"><dt>Account type</dt><dd>' + esc(c.segment ? SEGMENTS[c.segment].label : '—') + '</dd><dt>Sign-in email</dt><dd>' + esc((myAuthAccount() || {}).email || c.email) + '</dd><dt>Member since</dt><dd>' + fdate(c.createdAt) + '</dd></dl><p class="a-fine">Only LISTD can change your account type. Change your sign-in email under Sign-in & security.</p><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save changes</button></div></form>';
}
function setBilling() {
  var c = me(), b = c.billing || {};
  return secHeadS('Billing', 'Where receipts are sent. Card details are only taken on the secure checkout page.') + '<form class="a-card a-form" data-form="set-billing"><div class="two">' + field('sb-n', 'Billing contact', inp('sb-n', 'bname', b.name || c.name, 'required')) + field('sb-e', 'Billing email', inp('sb-e', 'bemail', b.email || c.email, 'type="email" required')) + '</div>' + field('sb-a', 'Address', inp('sb-a', 'baddr', b.address, 'required autocomplete="street-address"')) + '<div class="two">' + field('sb-c', 'Town / city', inp('sb-c', 'bcity', b.city, 'required')) + field('sb-p', 'Postcode', inp('sb-p', 'bpc', b.postcode, 'required autocapitalize="characters"')) + '</div><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save billing details</button><button class="ld-btn ld-btn-ghost" type="button" data-go="payments">View payments & receipts</button></div></form>';
}
/* ---- pro ---- */
function setProProfile() {
  var p = meP();
  return secHeadS('Profile', 'How you appear to clients and LISTD.') + '<div class="a-card"><div class="a-row">' + avatar(p.name, p.status === 'APPROVED', 'lg') + '<div><h3>' + esc(p.name) + '</h3><span class="a-muted">' + esc(p.email) + '</span></div>' + badge({ APPROVED: 'Approved', PENDING: 'Under review', RESUBMIT: 'Changes requested', REJECTED: 'Not approved', SUSPENDED: 'Suspended', DRAFT: 'Draft' }[p.status], p.status === 'APPROVED' ? 'success' : 'warning') + '</div>' + proStatusBanner(p) + '</div>' +
    '<form class="a-card a-form" data-form="set-pro"><div class="two">' + field('sp-name', 'Full name', inp('sp-name', 'name', p.name, 'required autocomplete="name"')) + field('sp-ph', 'Phone', inp('sp-ph', 'phone', p.phone, 'type="tel" required')) + '</div><div class="two">' + field('sp-bt', 'Working as', sel('sp-bt', 'bizType', [['sole', 'Sole trader / individual'], ['ltd', 'Limited company']], p.bizType || 'sole')) + field('sp-bn', 'Trading or company name <small>Optional</small>', inp('sp-bn', 'bizName', p.bizName)) + '</div>' + field('sp-home', 'Home postcode', inp('sp-home', 'home', p.home, 'autocapitalize="characters"')) + '<div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save profile</button></div></form>';
}
function setWork() {
  var p = meP(), av = p.availability || { days: [], slots: [] };
  return secHeadS('Work & availability', 'LISTD only offers you jobs that match these.') + '<form class="a-card a-form" data-form="pro-profile"><fieldset class="a-checks" style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Services</legend>' + Object.keys(SKILLS).map(function (k) { return '<label class="ld-check"><input type="checkbox" name="skills" value="' + k + '"' + ((p.skills || []).indexOf(k) >= 0 ? ' checked' : '') + '><span>' + SKILLS[k].label + '</span></label>'; }).join('') + '</fieldset>' + field('pp-cov', 'Postcode districts you cover', inp('pp-cov', 'coverage', (p.coverage || []).join(', ')), 'Separate with commas. An area like BS covers every BS district.') +
    '<fieldset style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Working days</legend><div class="a-row">' + DAYS.map(function (d, i) { return '<label class="ld-check" style="grid-template-columns:20px auto"><input type="checkbox" name="days" value="' + i + '"' + ((av.days || []).indexOf(i) >= 0 ? ' checked' : '') + '><span>' + d + '</span></label>'; }).join('') + '</div></fieldset>' +
    '<fieldset style="border:0;padding:0;margin:0"><legend class="ld-label" style="margin-bottom:8px">Time windows</legend><div class="a-row">' + Object.keys(WINDOWS).map(function (w) { return '<label class="ld-check" style="grid-template-columns:20px auto"><input type="checkbox" name="slots" value="' + w + '"' + ((av.slots || []).indexOf(w) >= 0 ? ' checked' : '') + '><span>' + WINDOWS[w][0] + ' ' + WINDOWS[w][1] + '–' + WINDOWS[w][2] + '</span></label>'; }).join('') + '</div></fieldset><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save</button></div></form>';
}
function setDocs() {
  var p = meP();
  return secHeadS('Documents', 'Only LISTD reviewers can see these. Expired documents pause new offers.') + '<div class="a-card a-form">' + DOCS.map(function (d) { var have = (p.docs || []).filter(function (x) { return x.type === d[0]; })[0], exp = have && have.expires && have.expires < new Date().toISOString().slice(0, 10); return '<div class="a-item" style="grid-template-columns:minmax(0,1fr) auto"><span class="nm">' + d[1] + (have ? '<br><span class="a-fine">' + esc(have.name) + (have.expires ? ' · expires ' + fdate(have.expires) : '') + '</span>' + (exp ? ' ' + badge('Expired', 'danger') : '') : '<br><span class="a-fine">Not uploaded</span>') + '</span>' + upBtn({ doc: d[0], allowPdf: true }, have ? 'Replace' : 'Upload', false) + '</div>'; }).join('') + field('pr-dexp', 'DBS or insurance expiry date', inp('pr-dexp', 'expires', p.docExpiry || '', 'type="date" data-docexp="1"')) + '</div>';
}
function setPayouts() {
  var p = meP(), po = p.payout || {};
  return secHeadS('Payout account', 'Where your earnings are sent.') + '<form class="a-card a-form" data-form="set-payout"><div class="a-banner" style="--t:var(--warning-subtle);--c:var(--warning)">' + ic('info', 20) + '<div><b>Test mode</b><p>In the live product this opens the payment provider’s secure page. Don’t enter real bank details here.</p></div></div><div class="two">' + field('po-h', 'Account holder', inp('po-h', 'holder', po.holder || p.name, 'required')) + field('po-l', 'Last 4 digits <small>Test value</small>', inp('po-l', 'last4', po.last4, 'required inputmode="numeric" pattern="[0-9]{4}" maxlength="4"')) + '</div><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save payout account</button><button class="ld-btn ld-btn-ghost" type="button" data-go="earnings">View earnings</button></div></form>';
}
/* ---- shared ---- */
function setSecurity() {
  var a = myAuthAccount(); if (!a) return '<p class="a-muted">Sign in again to manage security.</p>';
  var on = !!a.mfa, setup = S.mfaSetup, off = S.mfaOff, adminLocked = S.role === 'admin';
  var h = secHeadS('Sign-in & security', 'Keep your account safe.');
  h += '<form class="a-card a-form" data-form="set-email"><h3>Sign-in email</h3><p class="a-muted">Currently <b>' + esc(a.email) + '</b>.</p><div class="two">' + field('se-new', 'New email', inp('se-new', 'email', '', 'type="email" required autocomplete="email"')) + pwField('se-pw', 'Current password', 'current-password').replace('name="se-pw"', 'name="password"') + '</div><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="submit">Change email</button></div></form>';
  h += '<form class="a-card a-form" data-form="auth-change" novalidate><h3>Password</h3><div class="two">' + pwField('au-current', 'Current password', 'current-password') + pwField('au-newpw', 'New password', 'new-password') + '</div><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="submit">Change password</button></div><p class="a-fine">Changing your password signs you out on other devices.</p></form>';
  h += '<div class="a-card a-form"><div class="a-row sb"><div><h3>Two-factor authentication</h3><p class="a-muted" style="margin:4px 0 0">' + (adminLocked ? 'Always on for admins.' : 'Ask for a 6-digit code from an authenticator app each time you sign in.') + '</p></div><label class="ld-switch"><input type="checkbox" role="switch" data-twofa="1" aria-label="Two-factor authentication"' + ((on || setup) ? ' checked' : '') + (adminLocked ? ' disabled' : '') + '><span class="t"></span><span>' + (on ? 'On' : setup ? 'Setting up' : 'Off') + '</span></label></div>';
  if (setup) {
    var uri = 'otpauth://totp/LISTD:' + encodeURIComponent(a.email) + '?secret=' + setup.secret + '&issuer=LISTD&digits=6&period=30';
    h += '<div class="a-mfabox"><p>Scan this with Google Authenticator, Microsoft Authenticator or 1Password, or enter the key by hand. Then enter the 6-digit code to turn it on.</p><div class="a-qr" id="au-qr">' + (AUTH.qrFor === uri && AUTH.qrSvg ? AUTH.qrSvg : '<span class="a-fine">Loading QR code…</span>') + '</div><code class="a-key">' + setup.secret.replace(/(.{4})/g, '$1 ').trim() + '</code><form class="a-row" data-form="mfa-on" novalidate><label class="sr-only" for="mf-code">6-digit code</label><input class="a-note" style="max-width:160px" id="mf-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required><button class="ld-btn ld-btn-primary ld-btn-sm" type="submit">Turn on</button><button class="ld-btn ld-btn-ghost ld-btn-sm" type="button" data-act="mfa-cancel">Cancel</button></form></div>';
    loadQr(uri);
  } else if (off) {
    h += '<form class="a-mfabox a-form" data-form="mfa-off" novalidate><p>Enter your password to turn off two-factor authentication.</p>' + pwField('mo-pw', 'Password', 'current-password').replace('name="mo-pw"', 'name="password"') + '<div class="a-actions"><button class="ld-btn ld-btn-danger ld-btn-sm" type="submit">Turn off</button><button class="ld-btn ld-btn-ghost ld-btn-sm" type="button" data-act="mfa-cancel">Keep it on</button></div></form>';
  } else if (on) h += '<p class="a-fine">' + ic('success', 14) + ' Turned on ' + fdate(a.mfa.at, true) + '.</p>';
  h += '</div>';
  h += '<div class="a-card"><h3>Sessions</h3><p class="a-muted">Signed in on this device' + (sessGet(window.localStorage)[S.role] ? ' and remembered for 30 days' : '') + '.</p><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="button" data-act="signout-others">Sign out of all other devices</button><button class="ld-btn ld-btn-ghost" type="button" data-act="signout">Sign out</button></div></div>';
  return h;
}
function notifyPrefs() { var src = S.role === 'admin' ? (myAuthAccount() || {}) : (myProfile() || {}); return (src.prefs && src.prefs.notify) || {}; }
function setNotify() {
  var pr = notifyPrefs(), topics = NOTIFY_TOPICS[S.role];
  return secHeadS('Notifications', 'Choose what we email you about. In-app notifications are always on so nothing is missed.') + '<form class="a-card a-form" data-form="set-notify"><div class="a-banner">' + ic('info', 20) + '<div><b>Email isn’t connected yet</b><p>Your choices are saved and will apply as soon as email delivery is switched on.</p></div></div><div class="a-tw"><table><thead><tr><th>Topic</th><th class="r">In-app</th><th class="r">Email</th></tr></thead><tbody>' + topics.map(function (t) { var em = pr[t[0]] !== false; return '<tr><td><b>' + esc(t[1]) + '</b><div class="a-fine">' + esc(t[2]) + '</div></td><td class="r">' + ic('check', 16) + '<span class="sr-only">Always on</span></td><td class="r"><label class="ld-switch"><input type="checkbox" role="switch" name="n_' + t[0] + '"' + (em ? ' checked' : '') + ' aria-label="Email me about ' + esc(t[1]) + '"><span class="t"></span></label></td></tr>'; }).join('') + '</tbody></table></div><div class="a-actions"><button class="ld-btn ld-btn-primary" type="submit">Save preferences</button></div></form>';
}
function setAppearance() {
  var cur = lsGet(THEME_KEY) || 'system';
  return secHeadS('Appearance', 'Saved on this device.') + '<div class="a-card a-form"><fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px"><legend class="ld-label" style="margin-bottom:8px">Theme</legend><div class="a-choice">' + [['system', 'Match my device', 'Light or dark, following your device settings'], ['light', 'Light', 'Cream background and dark text'], ['dark', 'Dark', 'Easier on the eyes at night']].map(function (t) { return '<label class="a-opt"><input type="radio" name="theme" value="' + t[0] + '" data-theme-set="1"' + (cur === t[0] ? ' checked' : '') + '><b>' + t[1] + '</b><span>' + t[2] + '</span></label>'; }).join('') + '</div></fieldset><p class="a-fine">Dates and times are shown in UK time (Europe/London).</p></div>';
}
function setPrivacy() {
  var p = myProfile() || {};
  return secHeadS('Privacy & data', 'Your information and how to leave LISTD.') + '<div class="a-card"><h3>Download your data</h3><p class="a-muted">A file with your profile, ' + (S.role === 'client' ? 'properties, requests, quotes, payments and reports' : 'jobs, reports, attendance and earnings') + '. Verification documents and other people’s private details aren’t included.</p><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="button" data-act="export-data">' + ic('download', 16) + 'Download my data</button></div></div>' +
    '<div class="a-card a-form"><h3>Close your account</h3>' + (p.deletion ? '<div class="a-banner" style="--t:var(--warning-subtle);--c:var(--warning)">' + ic('clock', 20) + '<div><b>Request sent ' + fdate(p.deletion.at, true) + '</b><p>LISTD will contact you. Records needed for payments and reports are kept for as long as the law requires.</p></div></div><div class="a-actions"><button class="ld-btn ld-btn-ghost ld-btn-sm" type="button" data-act="cancel-deletion">Withdraw request</button></div>' : '<p class="a-muted">LISTD reviews closure requests so open jobs and payments can be settled first. Financial and report records are kept for as long as the law requires.</p><form class="a-form" data-form="delete-request">' + field('dr-r', 'Reason <small>Optional</small>', area('dr-r', 'reason', '', 'rows="2"')) + '<div class="a-actions"><button class="ld-btn ld-btn-danger" type="submit">Request account closure</button></div></form>') + '</div>' +
    '<div class="a-card"><h3>Legal</h3><p class="a-muted">Terms of service and privacy notice: placeholders until legal terms are approved. You agreed on ' + fdate((p.consent || {}).terms, true) + '.</p></div>';
}
async function exportData() {
  var out = { exportedAt: now(), role: S.role }, mine;
  if (S.role === 'client') { mine = list('jobs').filter(function (j) { return j.clientId === S.clientId; }); out.profile = me(); out.properties = myProps(); }
  else { mine = list('jobs').filter(function (j) { return j.proId === S.proId; }).map(function (j) { var c = JSON.parse(JSON.stringify(j)); delete c.quotes; delete c.payments; delete c.refunds; return c; }); out.profile = JSON.parse(JSON.stringify(meP())); delete out.profile.docs; }
  out.jobs = mine; out.messages = list('messages').filter(function (m) { return mine.some(function (j) { return j.id === m.jobId; }); });
  var data = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), name = 'listd-my-data-' + new Date().toISOString().slice(0, 10) + '.json';
  if (ENV.downloads) { try { await ENV.downloads.save({ filename: name, data: data }); return; } catch (e) { if (e && e.code === 'declined') return; } }
  var a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
async function settingsSubmit(kind, f) {
  var fd = new FormData(f), v = function (n) { return String(fd.get(n) || '').trim(); }, a = myAuthAccount(), btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (kind === 'set-email') {
      var em = normEmail(v('email'));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Enter a valid email address.');
      if (!sameStr(await hashPw(String(fd.get('password') || ''), a.salt), a.hash)) return toast('Your password is incorrect.');
      if (authAcc(S.role, em)) return toast('That email is already used by another account.');
      a.email = em; await authSave();
      if (S.role === 'client') patchDoc('clients', S.clientId, { email: em }); else if (S.role === 'pro') patchDoc('pros', S.proId, { email: em });
      f.reset(); render(); return toast('Sign-in email changed to ' + em);
    }
    if (kind === 'mfa-on') {
      if (!(await totpOk(S.mfaSetup.secret, v('code')))) return toast('That code didn’t match. Try the newest code from your app.');
      a.mfa = { secret: S.mfaSetup.secret, at: now() }; S.mfaSetup = null; await authSave(); render(); return toast('Two-factor authentication is on');
    }
    if (kind === 'mfa-off') {
      if (!sameStr(await hashPw(String(fd.get('password') || ''), a.salt), a.hash)) return toast('Your password is incorrect.');
      delete a.mfa; S.mfaOff = false; await authSave(); render(); return toast('Two-factor authentication is off');
    }
    if (kind === 'set-admin') { a.name = v('name'); await authSave(); render(); return toast('Saved'); }
    if (kind === 'set-notify') {
      var pr = {}; NOTIFY_TOPICS[S.role].forEach(function (t) { pr[t[0]] = !!fd.get('n_' + t[0]); });
      if (S.role === 'admin') { a.prefs = Object.assign({}, a.prefs, { notify: pr }); await authSave(); }
      else patchDoc(S.role === 'pro' ? 'pros' : 'clients', S.role === 'pro' ? S.proId : S.clientId, { prefs: Object.assign({}, (myProfile() || {}).prefs, { notify: pr }) });
      return toast('Notification preferences saved');
    }
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
}
function settingsChange(el) {
  if (el.dataset.twofa) {
    var a = myAuthAccount(); if (!a || S.role === 'admin') return;
    if (el.checked && !a.mfa) { S.mfaOff = false; S.mfaSetup = { secret: b32enc(randBytes(20)) }; }
    else if (!el.checked && a.mfa) { S.mfaSetup = null; S.mfaOff = true; }
    else if (!el.checked) S.mfaSetup = null;
    render(); var c = document.getElementById(S.mfaSetup ? 'mf-code' : 'mo-pw'); if (c) c.focus(); return true;
  }
  if (el.dataset.themeSet) { lsSet(THEME_KEY, el.value === 'system' ? null : el.value); applyTheme(el.value); toast('Theme updated'); return true; }
  return false;
}
async function signOutOthers() { var a = myAuthAccount(); if (!a) return; var keep = !!sessGet(window.localStorage)[S.role]; a.sessionVersion = (a.sessionVersion || 1) + 1; await authSave(); startSession(a, keep); toast('Signed out of all other devices'); }
