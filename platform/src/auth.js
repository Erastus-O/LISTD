/* ===================== Sign in, sign up, password reset, Admin MFA ===================== */
/* Credentials never go in the shared database. In the published app they live in the signed-in
   Claude user's private store (data/users/<id>/auth), which no other viewer — not even the owner —
   can read; locally they live in this browser. Passwords are salted and hashed (PBKDF2-SHA256);
   Admin sign-in also needs a 6-digit code from an authenticator app (TOTP). */
var AUTH = { accounts: [], loaded: false, loading: false, fails: 0, lockUntil: 0, pending: null };
var AUTH_LOCAL = 'listd-auth-v1', SESS_KEY = 'listd-session-v1';
var SESSION_HOURS = { client: 12, pro: 12, admin: 8 }, KEEP_DAYS = 30;
var QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

function b64(buf) { var s = '', b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function unb64(str) { var s = atob(str), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
function randBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
async function hashPw(pw, saltB64) {
  var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
function sameStr(a, b) { if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function pwRules(pw) { return [[pw.length >= 8, 'At least 8 characters'], [/[A-Za-z]/.test(pw), 'A letter'], [/\d/.test(pw), 'A number']]; }
function pwOk(pw) { return pwRules(pw).every(function (r) { return r[0]; }); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

/* ---- TOTP (RFC 6238) ---- */
var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(bytes) { var bits = 0, val = 0, out = ''; for (var i = 0; i < bytes.length; i++) { val = (val << 8) | bytes[i]; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(str) { str = str.replace(/=+$/, '').replace(/\s/g, '').toUpperCase(); var bits = 0, val = 0, out = []; for (var i = 0; i < str.length; i++) { var idx = B32.indexOf(str[i]); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function totp(secret, step) {
  var counter = Math.floor(Date.now() / 30000) + (step || 0), msg = new Uint8Array(8);
  for (var i = 7; i >= 0; i--) { msg[i] = counter & 255; counter = Math.floor(counter / 256); }
  var key = await crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)), o = h[19] & 15;
  var code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
async function totpOk(secret, code) { code = String(code || '').replace(/\D/g, ''); if (code.length !== 6) return false; for (var s = -1; s <= 1; s++) if (await totp(secret, s) === code) return true; return false; }

/* ---- storage ---- */
function authPath() { return 'data/users/' + ENV.uid + '/auth'; }
async function authLoad() {
  AUTH.loading = true;
  if (ENV.mode === 'db' && ENV.uid) { try { var snap = await ENV.db.doc(authPath()).get(); AUTH.accounts = snap.exists ? (snap.data().accounts || []) : []; } catch (e) { AUTH.accounts = []; AUTH.error = true; } }
  else AUTH.accounts = lsGet(AUTH_LOCAL) || [];
  AUTH.loaded = true; AUTH.loading = false; syncSessions(); scheduleRender();
}
function authSave() {
  if (ENV.mode === 'db' && ENV.uid) return queued('auth', function () { return ENV.db.doc(authPath()).set({ accounts: AUTH.accounts }); }).catch(function () { toast('Couldn’t save your sign-in details. Try again.'); });
  lsSet(AUTH_LOCAL, AUTH.accounts); return Promise.resolve();
}
function sessGet(store) { try { return JSON.parse(store.getItem(SESS_KEY) || '{}'); } catch (e) { return {}; } }
function sessPut(store, v) { try { store.setItem(SESS_KEY, JSON.stringify(v)); } catch (e) {} }
function session(role) {
  var s = sessGet(window.sessionStorage)[role] || sessGet(window.localStorage)[role];
  if (!s || !s.exp || s.exp < Date.now()) return null;
  var acc = AUTH.accounts.filter(function (a) { return a.id === s.accountId; })[0];
  if (!acc || acc.sessionVersion !== s.v) return null;
  return s;
}
function startSession(acc, keep) {
  var hours = acc.role === 'admin' ? SESSION_HOURS.admin : keep ? KEEP_DAYS * 24 : SESSION_HOURS[acc.role];
  var s = { accountId: acc.id, profileId: acc.profileId, v: acc.sessionVersion, exp: Date.now() + hours * 3600000 };
  [window.localStorage, window.sessionStorage].forEach(function (st) { var all = sessGet(st); delete all[acc.role]; sessPut(st, all); });
  var store = keep && acc.role !== 'admin' ? window.localStorage : window.sessionStorage, all = sessGet(store); all[acc.role] = s; sessPut(store, all);
  syncSessions();
}
function endSession(role) { [window.localStorage, window.sessionStorage].forEach(function (st) { var all = sessGet(st); delete all[role]; sessPut(st, all); }); syncSessions(); }
function syncSessions() {
  var c = session('client'), p = session('pro');
  S.clientId = c ? c.profileId : null; S.proId = p ? p.profileId : null; S.adminOk = !!session('admin');
}
function authAcc(role, email) { email = normEmail(email); return AUTH.accounts.filter(function (a) { return a.role === role && a.email === email; })[0] || null; }
async function newAccount(role, email, pw, profileId) {
  var salt = b64(randBytes(16)), acc = { id: uid(), role: role, email: normEmail(email), salt: salt, hash: await hashPw(pw, salt), profileId: profileId || null, sessionVersion: 1, createdAt: now() };
  return acc;
}
function unlinkedProfiles(role) {
  var col = role === 'pro' ? 'pros' : 'clients', linked = AUTH.accounts.map(function (a) { return a.profileId; });
  return list(col).filter(function (x) { return linked.indexOf(x.id) < 0 && x.status !== 'INVITED' && !(x.invite && x.invite.cancelledAt) && (ENV.mode !== 'db' || x.ownerUid === ENV.uid); });
}

/* ---- screens ---- */
var AUTH_COPY = {
  client: { h: 'Every property service, one trusted record.', b: ['Book check-ins, check-outs, repairs and cleaning in minutes', 'Pay securely and only sign off when you’re happy', 'Timestamped photo reports for every visit'] },
  pro: { h: 'Get matched with verified work near you.', b: ['Offers that match your skills and area', 'Clear scope, fee and access details upfront', 'Paid when the client signs off'] },
  admin: { h: 'LISTD operations', b: ['Invite-only access for LISTD staff', 'Two-step sign-in with an authenticator app', 'Every privileged action is logged'] }
};
function pwField(id, label, auto, extra) {
  return '<div class="ld-field"><div class="a-row sb"><label class="ld-label" for="' + id + '">' + label + '</label>' + (extra || '') + '</div><div class="ld-control"><input class="ld-input" id="' + id + '" name="' + id.replace(/^au-/, '') + '" type="password" required autocomplete="' + auto + '"' + (auto === 'new-password' && !/confirm/.test(id) ? ' data-pw="1" aria-describedby="' + id + '-rules"' : '') + '><button type="button" class="a-eye" data-act="pw-toggle" data-for="' + id + '" aria-label="Show password" aria-pressed="false">' + ic('eye', 18) + '</button></div>' +
    (auto === 'new-password' && !/confirm/.test(id) ? '<ul class="a-pwrules" id="' + id + '-rules">' + pwRules('').map(function (r) { return '<li>' + ic('check', 14) + r[1] + '</li>'; }).join('') + '</ul>' : '') + '</div>';
}
function authErr() { return S.authErr ? '<p class="a-autherr" id="au-err" role="alert" tabindex="-1">' + ic('error', 16) + '<span>' + esc(S.authErr) + '</span></p>' : ''; }
function vAuth() {
  if (!AUTH.loaded) return '<div class="a-page">' + empty('lock', 'Loading', 'Checking your sign-in.', '') + '</div>';
  var role = S.role, A = S.auth || {}, mode = A.mode, copy = AUTH_COPY[role];
  if (!mode) mode = role === 'admin' && !AUTH.accounts.some(function (a) { return a.role === 'admin'; }) ? 'admin-setup' : 'signin';
  var name = { client: 'client', pro: 'Pro', admin: 'admin' }[role], f = '';
  if (mode === 'signin') {
    var lockLeft = Math.ceil((AUTH.lockUntil - Date.now()) / 1000), claim = role !== 'admin' ? unlinkedProfiles(role) : [];
    f = '<h1>Sign in</h1><p class="a-muted">' + (role === 'admin' ? 'LISTD staff only.' : 'Welcome back to LISTD' + (role === 'pro' ? ' for Pros.' : '.')) + '</p>' + authErr() + (claim.length ? '<div class="a-authnote"><b>Already set up a profile here?</b><p>' + claim.length + ' ' + name + ' profile' + (claim.length > 1 ? 's were' : ' was') + ' created before sign-in was added. Set a password to keep using ' + (claim.length > 1 ? 'them' : 'it') + '.</p><button type="button" class="ld-btn ld-btn-secondary ld-btn-sm" data-act="auth-mode" data-m="claim">Set up sign-in</button></div>' : '') +
      '<form class="a-form" data-form="auth-signin" novalidate>' + field('au-email', 'Email', inp('au-email', 'email', A.email || '', 'type="email" required autocomplete="username" autocapitalize="none" spellcheck="false"')) +
      pwField('au-password', 'Password', 'current-password', '<button type="button" class="a-linkbtn" data-act="auth-mode" data-m="forgot">Forgot password?</button>') +
      (role !== 'admin' ? '<label class="ld-check"><input type="checkbox" id="au-keep" name="keep" checked><span>Keep me signed in on this device<small>For 30 days. Untick on a shared computer.</small></span></label>' : '') +
      '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit"' + (lockLeft > 0 ? ' disabled' : '') + '>' + (lockLeft > 0 ? 'Too many attempts. Try again in ' + lockLeft + 's' : 'Sign in') + '</button></form>' +
      (role === 'admin' ? '<p class="a-fine">Admin access is by invitation. Ask a LISTD admin to add you as an editor of this workspace.</p><p class="a-authalt">Joining the LISTD team? <button type="button" class="a-linkbtn" data-act="auth-mode" data-m="admin-setup">Set up your admin sign-in</button></p>' : '<p class="a-authalt">' + (role === 'pro' ? 'Want to work with LISTD? ' : 'New to LISTD? ') + '<button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signup">' + (role === 'pro' ? 'Apply as a Pro' : 'Create an account') + '</button></p>' + (role === 'pro' ? '<p class="a-authalt">Invited by LISTD? <button type="button" class="a-linkbtn" data-act="auth-mode" data-m="invite">Accept an invitation</button></p>' : ''));
  } else if (mode === 'signup') {
    f = '<h1>' + (role === 'pro' ? 'Apply to join LISTD' : 'Create your account') + '</h1><p class="a-muted">' + (role === 'pro' ? 'Create your sign-in with your email and a password. You’ll add your name, skills, area and documents next.' : 'Start with your sign-in details. You’ll tell us about your business and first property next.') + '</p>' + authErr() +
      '<form class="a-form" data-form="auth-signup" novalidate>' + (role === 'pro' ? '' : field('au-name', 'Full name', inp('au-name', 'name', A.name || '', 'required autocomplete="name"'))) + field('au-email', 'Email', inp('au-email', 'email', A.email || '', 'type="email" required autocomplete="email" autocapitalize="none" spellcheck="false"')) +
      pwField('au-password', 'Create a password', 'new-password') + (role === 'pro' ? '' : pwField('au-confirm', 'Confirm password', 'new-password') +
      '<label class="ld-check"><input type="checkbox" id="au-terms" name="terms" required><span>I agree to the LISTD terms and privacy notice<small>Test mode: placeholders until legal terms are approved.</small></span></label>') +
      '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Create account</button></form><p class="a-authalt">Already have an account? <button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Sign in</button></p>';
  } else if (mode === 'forgot') {
    f = '<h1>Reset your password</h1><p class="a-muted">Enter the email you sign in with.</p>' + authErr() + '<form class="a-form" data-form="auth-forgot" novalidate>' + field('au-email', 'Email', inp('au-email', 'email', A.email || '', 'type="email" required autocomplete="username"')) + '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Continue</button></form><p class="a-authalt"><button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Back to sign in</button></p>';
  } else if (mode === 'reset') {
    var acc = AUTH.accounts.filter(function (a) { return a.id === A.accountId; })[0];
    f = '<h1>Choose a new password</h1><p class="a-muted">For ' + esc(acc ? acc.email : '') + '. ' + (ENV.mode === 'db' ? 'Email delivery isn’t connected yet, so resets are done here. Only you can see this, because you’re signed in to Claude as the owner of this account.' : 'Email delivery isn’t connected yet, so resets are done on this device.') + '</p>' + authErr() +
      '<form class="a-form" data-form="auth-reset" novalidate>' + pwField('au-password', 'New password', 'new-password') + pwField('au-confirm', 'Confirm new password', 'new-password') + (acc && acc.mfa ? field('au-code', 'Authenticator code', inp('au-code', 'code', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" required')) : '') +
      '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Save new password</button></form><p class="a-fine">Saving signs you out on every other device.</p>';
  } else if (mode === 'claim') {
    var ps = unlinkedProfiles(role);
    f = '<h1>Set up sign-in</h1><p class="a-muted">Choose your profile, then set the email and password you’ll sign in with.</p>' + authErr() + '<form class="a-form" data-form="auth-claim" novalidate><fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend class="ld-label" style="margin-bottom:6px">Profile</legend>' + ps.map(function (x, i) { return '<label class="a-opt"><input type="radio" name="profile" value="' + x.id + '"' + (i === 0 ? ' checked' : '') + '><b>' + esc(x.orgName || x.name) + '</b><span>' + esc(x.email || '') + '</span></label>'; }).join('') + '</fieldset>' +
      field('au-email', 'Email', inp('au-email', 'email', (ps[0] || {}).email || '', 'type="email" required autocomplete="username"')) + pwField('au-password', 'Create a password', 'new-password') + pwField('au-confirm', 'Confirm password', 'new-password') +
      '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Save and sign in</button></form><p class="a-authalt"><button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Back to sign in</button></p>';
  } else if (mode === 'invite') {
    f = '<h1>Accept your invitation</h1><p class="a-muted">Enter the code from your LISTD invitation and the email it was sent to, then create a password. This verifies your email.</p>' + authErr() +
      '<form class="a-form" data-form="auth-invite" novalidate>' + field('au-code', 'Invitation code', inp('au-code', 'code', A.code || '', 'required autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345" class="num"')) + field('au-email', 'Email', inp('au-email', 'email', A.email || '', 'type="email" required autocomplete="username" autocapitalize="none" spellcheck="false"')) +
      pwField('au-password', 'Create a password', 'new-password') + '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Verify and continue</button></form><p class="a-authalt">Already set up? <button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Sign in</button></p>';
  } else if (mode === 'admin-setup') {
    f = '<h1>Set up admin sign-in</h1><p class="a-muted">You have admin access to this workspace. Create your sign-in, then link an authenticator app.</p>' + authErr() + '<form class="a-form" data-form="auth-admin-setup" novalidate>' + field('au-name', 'Full name', inp('au-name', 'name', '', 'required autocomplete="name"')) + field('au-email', 'Work email', inp('au-email', 'email', '', 'type="email" required autocomplete="email"')) + pwField('au-password', 'Create a password', 'new-password') + pwField('au-confirm', 'Confirm password', 'new-password') + '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Continue</button></form>' + (AUTH.accounts.some(function (a) { return a.role === 'admin'; }) ? '<p class="a-authalt"><button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Back to sign in</button></p>' : '');
  } else if (mode === 'mfa-setup') {
    var sec = A.secret, uri = 'otpauth://totp/LISTD:' + encodeURIComponent(A.email) + '?secret=' + sec + '&issuer=LISTD&digits=6&period=30';
    f = '<h1>Link an authenticator app</h1><p class="a-muted">Scan the code with Google Authenticator, Microsoft Authenticator or 1Password, or enter the key by hand.</p>' + authErr() +
      '<div class="a-qr" id="au-qr" data-uri="' + esc(uri) + '">' + (AUTH.qrSvg || '<span class="a-fine">Loading QR code…</span>') + '</div><div class="ld-field"><span class="ld-label">Setup key</span><code class="a-key" id="au-key">' + sec.replace(/(.{4})/g, '$1 ').trim() + '</code></div>' +
      '<form class="a-form" data-form="auth-mfa-setup" novalidate>' + field('au-code', 'Enter the 6-digit code from the app', inp('au-code', 'code', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" required pattern="[0-9]{6}"')) + '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Verify and finish</button></form>';
    loadQr(uri);
  } else if (mode === 'mfa') {
    f = '<h1>Two-step verification</h1><p class="a-muted">Enter the 6-digit code from your authenticator app.</p>' + authErr() + '<form class="a-form" data-form="auth-mfa" novalidate>' + field('au-code', 'Authenticator code', inp('au-code', 'code', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" required pattern="[0-9]{6}"')) + '<button class="ld-btn ld-btn-primary ld-btn-lg ld-btn-full" type="submit">Verify</button></form><p class="a-authalt"><button type="button" class="a-linkbtn" data-act="auth-mode" data-m="signin">Use a different account</button></p>';
  }
  return '<div class="a-auth"><aside class="a-authbrand"><div class="a-authglass"><span class="ld-logo ld-logo-white">listd</span>' + (role !== 'client' ? '<span class="a-authtag">' + (role === 'pro' ? 'for Pros' : 'Admin') + '</span>' : '') + '<h2>' + esc(copy.h) + '</h2><ul>' + copy.b.map(function (b) { return '<li>' + ic('check', 18) + esc(b) + '</li>'; }).join('') + '</ul><p class="a-fine">' + (ENV.mode === 'db' ? 'Your sign-in details are stored privately to your Claude account.' : 'Demo mode: accounts are saved in this browser only.') + '</p></div></aside><div class="a-authpanel"><div class="a-authcard">' + f + '</div></div></div>';
}
function loadQr(uri) {
  if (AUTH.qrFor === uri) return; AUTH.qrFor = uri; AUTH.qrSvg = '';
  var draw = function () { try { var q = window.qrcode(0, 'M'); q.addData(uri); q.make(); AUTH.qrSvg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code for your authenticator app' }); } catch (e) { AUTH.qrSvg = '<span class="a-fine">Enter the setup key below in your app.</span>'; } var el = document.getElementById('au-qr'); if (el) el.innerHTML = AUTH.qrSvg; };
  if (window.qrcode) return draw();
  var s = document.createElement('script'); s.src = QR_URL; s.onload = draw; s.onerror = function () { AUTH.qrSvg = '<span class="a-fine">QR code unavailable. Enter the setup key below in your app.</span>'; var el = document.getElementById('au-qr'); if (el) el.innerHTML = AUTH.qrSvg; }; document.head.appendChild(s);
}
function authFail(msg) { S.authErr = msg; render(); var el = document.getElementById('au-err'); if (el) el.focus && el.focus(); }
function authMode(m, extra) { S.auth = Object.assign({ mode: m }, extra || {}); S.authErr = ''; render(); }

/* ---- handlers ---- */
async function authSubmit(kind, f) {
  var fd = new FormData(f), v = function (n) { return String(fd.get(n) || '').trim(); }, role = S.role, email = normEmail(v('email')), pw = String(fd.get('password') || '');
  var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (kind === 'auth-signin') {
      if (Date.now() < AUTH.lockUntil) return authFail('Too many attempts. Wait a moment and try again.');
      if (!email || !pw) return authFail('Enter your email and password.');
      var acc = authAcc(role, email), ok = acc ? sameStr(await hashPw(pw, acc.salt), acc.hash) : (await hashPw(pw, b64(randBytes(16))), false);
      if (!acc && role !== 'admin') {
        /* same person, other portal: reuse their verified password to open this portal */
        var other = AUTH.accounts.filter(function (x) { return x.email === email && x.role !== role; }), twin = null;
        for (var oi = 0; oi < other.length; oi++) if (sameStr(await hashPw(pw, other[oi].salt), other[oi].hash)) { twin = other[oi]; break; }
        if (twin) {
          var mineP = unlinkedProfiles(role), prof = mineP.filter(function (x) { return normEmail(x.email) === email; })[0] || (mineP.length === 1 ? mineP[0] : null);
          if (prof) { var na = await newAccount(role, email, pw, prof.id); AUTH.accounts.push(na); await authSave(); startSession(na, !!fd.get('keep')); S.auth = null; S.authErr = ''; S.view = 'home'; HIST = []; render(); toast('Signed in. Your ' + (role === 'pro' ? 'Pro' : 'client') + ' profile is now linked to this login.'); return; }
          S.auth = { mode: 'signup', email: email, name: twin.name || '' };
          return authFail('This email has a ' + ({ client: 'client', pro: 'Pro', admin: 'admin' })[twin.role] + ' account, but no ' + (role === 'pro' ? 'Pro' : 'client') + ' account yet. Create one below. You can use the same password.');
        }
      }
      if (!ok) { AUTH.fails++; if (AUTH.fails >= 5) { AUTH.lockUntil = Date.now() + 30000; AUTH.fails = 0; setTimeout(render, 30500); } S.auth = { mode: 'signin', email: email }; return authFail('Email or password is incorrect.'); }
      AUTH.fails = 0;
      if (role === 'admin' || acc.mfa) { AUTH.pending = acc.id; AUTH.pendingKeep = !!fd.get('keep'); return authMode('mfa'); }
      if (!(role === 'pro' ? D.pros[acc.profileId] : D.clients[acc.profileId])) return authFail('This account’s profile was removed. Contact LISTD.');
      startSession(acc, !!fd.get('keep')); S.auth = null; S.authErr = ''; S.view = 'home'; HIST = []; render(); toast('Signed in'); return;
    }
    if (kind === 'auth-signup' || kind === 'auth-claim' || kind === 'auth-admin-setup') {
      var name = v('name'), confirm = String(fd.get('confirm') || '');
      S.auth = Object.assign({}, S.auth, { name: name, email: email });
      var proUp = kind === 'auth-signup' && role === 'pro';
      if (kind !== 'auth-claim' && !proUp && !name) return authFail('Enter your full name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authFail('Enter a valid email address.');
      if (!pwOk(pw)) return authFail('Your password needs at least 8 characters, including a letter and a number.');
      if (!proUp && pw !== confirm) return authFail('The passwords don’t match.');
      if (kind === 'auth-signup' && !proUp && !fd.get('terms')) return authFail('Agree to the terms to continue.');
      if (authAcc(role, email)) return authFail('An account with this email already exists. Sign in instead.');
      if (kind === 'auth-admin-setup') { var adm = await newAccount('admin', email, pw, null); adm.name = name; AUTH.pending = adm; return authMode('mfa-setup', { email: email, secret: b32enc(randBytes(20)) }); }
      var pid = kind === 'auth-claim' ? v('profile') : uid();
      if (kind === 'auth-signup') {
        if (role === 'pro') setDoc('pros', pid, { name: name, email: email, status: 'DRAFT', consent: {}, ownerUid: ENV.uid || null, onboarding: { status: 'IN_PROGRESS', step: 2 }, createdAt: now() });
        else setDoc('clients', pid, { name: name, email: email, consent: { terms: now() }, ownerUid: ENV.uid || null, onboarding: { status: 'IN_PROGRESS', step: 1 }, createdAt: now() });
      }
      var a2 = await newAccount(role, email, pw, pid); AUTH.accounts.push(a2); await authSave();
      startSession(a2, true); S.auth = null; S.authErr = ''; S.view = 'home'; HIST = []; render(); toast(kind === 'auth-signup' ? 'Account created' : 'Sign-in set up'); return;
    }
    if (kind === 'auth-mfa-setup') {
      if (!(await totpOk(S.auth.secret, v('code')))) return authFail('That code didn’t match. Check the time on your phone and try the newest code.');
      var ad = AUTH.pending; ad.mfa = { secret: S.auth.secret, at: now() }; AUTH.accounts.push(ad); await authSave(); AUTH.pending = null;
      audit('admin.mfa_enrolled', 'admin', ad.id, ad.email); startSession(ad, false); S.auth = null; S.authErr = ''; S.view = 'home'; render(); toast('Two-step verification is on'); return;
    }
    if (kind === 'auth-mfa') {
      var am = AUTH.accounts.filter(function (a) { return a.id === AUTH.pending; })[0]; if (!am) return authMode('signin');
      if (!(await totpOk(am.mfa.secret, v('code')))) return authFail('That code didn’t match. Try the newest code.');
      if (am.role !== 'admin' && !(am.role === 'pro' ? D.pros[am.profileId] : D.clients[am.profileId])) return authFail('This account’s profile was removed. Contact LISTD.');
      AUTH.pending = null; if (!am.mfa) return authMode('signin'); startSession(am, am.role !== 'admin' && AUTH.pendingKeep); if (am.role === 'admin') audit('admin.sign_in', 'admin', am.id, am.email); S.auth = null; S.authErr = ''; S.view = 'home'; render(); toast('Signed in'); return;
    }
    if (kind === 'auth-invite') {
      var code = normCode(v('code')); S.auth = { mode: 'invite', code: code, email: email };
      if (code.length !== 9) return authFail('Enter the 8-character code from your invitation.');
      var hh = await sha256(code), ip = list('pros').filter(function (x) { return x.invite && x.invite.hash === hh; })[0];
      if (!ip || ip.status !== 'INVITED') return authFail('That code isn’t valid. Check your invitation email, or ask LISTD to send a new one.');
      if (hoursFrom(ip.invite.expiresAt) <= 0) return authFail('This invitation has expired. Ask LISTD to send a new one.');
      if (normEmail(ip.email) !== email) return authFail('Use the email address your invitation was sent to.');
      if (authAcc('pro', email)) return authFail('A Pro account with this email already exists. Sign in instead.');
      if (!pwOk(pw)) return authFail('Your password needs at least 8 characters, including a letter and a number.');
      var ia = await newAccount('pro', email, pw, ip.id); AUTH.accounts.push(ia); await authSave();
      patchDoc('pros', ip.id, { status: 'DRAFT', ownerUid: ENV.uid || null, emailVerifiedAt: now(), invite: Object.assign({}, ip.invite, { hash: null, acceptedAt: now() }) });
      notify('admin', (ip.firstName || ip.name) + ' accepted their Pro invitation');
      try { if (/invite=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      startSession(ia, true); S.role = 'pro'; persistUI(); S.auth = null; S.authErr = ''; S.view = 'home'; HIST = []; render(); toast('Email verified. Welcome to LISTD'); return;
    }
    if (kind === 'auth-forgot') {
      var fa = authAcc(role, email); S.auth = { mode: 'forgot', email: email };
      if (!fa) return authFail('We couldn’t find a ' + ({ client: 'client', pro: 'Pro', admin: 'admin' })[role] + ' account with that email' + (ENV.mode === 'db' ? ' on this Claude login.' : ' on this device.'));
      return authMode('reset', { accountId: fa.id });
    }
    if (kind === 'auth-reset') {
      var ra = AUTH.accounts.filter(function (a) { return a.id === S.auth.accountId; })[0]; if (!ra) return authMode('signin');
      if (!pwOk(pw)) return authFail('Your password needs at least 8 characters, including a letter and a number.');
      if (pw !== String(fd.get('confirm') || '')) return authFail('The passwords don’t match.');
      if (ra.mfa && !(await totpOk(ra.mfa.secret, v('code')))) return authFail('That authenticator code didn’t match.');
      ra.salt = b64(randBytes(16)); ra.hash = await hashPw(pw, ra.salt); ra.sessionVersion = (ra.sessionVersion || 1) + 1; await authSave(); syncSessions();
      authMode('signin', { email: ra.email }); toast('Password updated. Sign in with your new password.'); return;
    }
    if (kind === 'auth-change') {
      var sess = session(role), ca = sess && AUTH.accounts.filter(function (a) { return a.id === sess.accountId; })[0]; if (!ca) return;
      if (!sameStr(await hashPw(String(fd.get('current') || ''), ca.salt), ca.hash)) { toast('Your current password is incorrect.'); return; }
      var np = String(fd.get('newpw') || ''); if (!pwOk(np)) { toast('New password needs 8+ characters with a letter and a number.'); return; }
      ca.salt = b64(randBytes(16)); ca.hash = await hashPw(np, ca.salt); ca.sessionVersion = (ca.sessionVersion || 1) + 1; await authSave(); startSession(ca, !!sessGet(window.localStorage)[role]); f.reset(); toast('Password changed. Other devices are signed out.'); return;
    }
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
}
function signOut() { var r = S.role; endSession(r); S.view = 'home'; S.params = {}; S.drafts = {}; S.wiz = null; S.modal = null; HIST = []; S.auth = { mode: 'signin' }; render(); toast('Signed out'); }
function securityCard() {
  var s = session(S.role), a = s && AUTH.accounts.filter(function (x) { return x.id === s.accountId; })[0]; if (!a) return '';
  return '<form class="a-card a-form" data-form="auth-change" novalidate><h3>Sign-in & security</h3><dl class="a-kv"><dt>Signed in as</dt><dd>' + esc(a.email) + '</dd>' + (a.mfa ? '<dt>Two-step</dt><dd>Authenticator app</dd>' : '') + '</dl><div class="two">' + pwField('au-current', 'Current password', 'current-password').replace('name="current"', 'name="current"') + pwField('au-newpw', 'New password', 'new-password') + '</div><div class="a-actions"><button class="ld-btn ld-btn-secondary" type="submit">Change password</button><button class="ld-btn ld-btn-ghost" type="button" data-act="signout">Sign out</button></div></form>';
}
function pwLive(el) {
  var ul = document.getElementById(el.id + '-rules'); if (!ul) return;
  pwRules(el.value).forEach(function (r, i) { var li = ul.children[i]; if (li) li.classList.toggle('ok', r[0]); });
}

/* open the invitation screen when the app is opened from an invitation link (#invite=CODE or ?invite=CODE) */
function inviteFromUrl() { try { var m = String(location.hash + '&' + location.search).match(/invite=([A-Za-z0-9-]{8,9})/); if (m && (!window.LISTD_PORTAL || window.LISTD_PORTAL === 'pro')) { S.role = 'pro'; S.auth = { mode: 'invite', code: normCode(m[1]) }; } } catch (e) {} }
