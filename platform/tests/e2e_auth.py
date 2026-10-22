"""Sign-up, sign-in, sign-out, lockout, password reset, Admin two-step, and set-up for older profiles."""
import os
from playwright.sync_api import sync_playwright
def opt(p, sel, val):
    if p.locator(sel).count(): p.fill(sel, val)
def optc(p, sel):
    if p.locator(sel).count(): p.check(sel)
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
APP = 'file://' + os.path.join(HERE, '..', 'dist', 'listd-platform.html')
errs = []; n = [0]
def log(m): n[0] += 1; print(n[0], m, flush=True)
with sync_playwright() as pw:
    br = pw.chromium.launch(); p = br.new_page(viewport={'width': 1280, 'height': 900})
    p.on('pageerror', lambda e: errs.append(str(e)))
    W = lambda ms=300: p.wait_for_timeout(ms)
    h1 = lambda: p.locator('.a-main h1').first.inner_text()
    err = lambda: (p.locator('#au-err').inner_text() if p.locator('#au-err').count() else '')
    def shot(name): p.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)
    def role(r): p.click('[data-act=role][data-r=%s]' % r); W()
    def signin(email, pwd, keep=True):
        p.fill('#au-email', email); p.fill('#au-password', pwd)
        if p.locator('input[name=keep]').count(): p.locator('input[name=keep]').set_checked(keep)
        p.click('form[data-form=auth-signin] button[type=submit]'); W(1200)
    p.goto(APP); W(600); shot('a1-signin'); log('first screen: ' + h1())
    assert h1() == 'Sign in'
    # sign up: validation then success
    p.click('[data-act=auth-mode][data-m=signup]'); W(); shot('a2-signup')
    opt(p, '#au-name', 'Ada Okafor'); p.fill('#au-email', 'ada@example.test'); p.fill('#au-password', 'short'); opt(p, '#au-confirm', 'short'); optc(p, 'input[name=terms]')
    p.click('form[data-form=auth-signup] button[type=submit]'); W(800); log('weak password: ' + err())
    p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026?'); p.click('form[data-form=auth-signup] button[type=submit]'); W(800); log('mismatch: ' + err())
    opt(p, '#au-confirm', 'Listd2026!'); p.click('form[data-form=auth-signup] button[type=submit]'); W(1500); log('after sign-up: ' + h1())
    stored = p.evaluate("() => JSON.stringify(localStorage.getItem('listd-auth-v1'))"); assert 'Listd2026' not in stored; log('password stored only as a hash: True')
    # sign out, wrong password, lockout
    p.click('.a-top [data-act=signout]'); W(); log('signed out -> ' + h1())
    signin('ada@example.test', 'wrongpass1'); log('wrong password: ' + err())
    signin('nobody@example.test', 'Listd2026!'); log('unknown email: ' + err())
    for _ in range(3): signin('ada@example.test', 'wrongpass1')
    log('lockout: ' + p.locator('form[data-form=auth-signin] button[type=submit]').inner_text() + ' | ' + err() + ' | lockUntil-now=' + str(p.evaluate('AUTH.lockUntil - Date.now()')))
    p.evaluate("() => { AUTH.lockUntil = 0; render(); }"); W()
    signin('ada@example.test', 'Listd2026!'); log('correct password -> ' + h1())
    # duplicate sign-up blocked
    p.click('.a-top [data-act=signout]'); W(); p.click('[data-act=auth-mode][data-m=signup]'); W()
    opt(p, '#au-name', 'Ada'); p.fill('#au-email', 'ADA@example.test'); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); optc(p, 'input[name=terms]'); p.click('form[data-form=auth-signup] button[type=submit]'); W(1200); log('duplicate: ' + err())
    # forgot / reset
    p.click('[data-act=auth-mode][data-m=signin]'); W(); p.click('[data-act=auth-mode][data-m=forgot]'); W(); p.fill('#au-email', 'ada@example.test'); p.click('form[data-form=auth-forgot] button[type=submit]'); W(); shot('a3-reset'); log('reset screen: ' + h1())
    p.fill('#au-password', 'NewPass2026'); opt(p, '#au-confirm', 'NewPass2026'); p.click('form[data-form=auth-reset] button[type=submit]'); W(1500)
    signin('ada@example.test', 'Listd2026!'); log('old password after reset: ' + err())
    signin('ada@example.test', 'NewPass2026'); log('new password -> ' + h1())
    # Pro: separate session
    role('pro'); log('pro portal -> ' + h1())
    p.click('[data-act=auth-mode][data-m=signup]'); W(); opt(p, '#au-name', 'Sam Patel'); p.fill('#au-email', 'sam@example.test'); p.fill('#au-password', 'ProPass2026'); opt(p, '#au-confirm', 'ProPass2026'); optc(p, 'input[name=terms]'); p.click('form[data-form=auth-signup] button[type=submit]'); W(1500); log('pro after sign-up -> ' + h1())
    role('client'); log('client still signed in -> ' + h1())
    # Admin: set-up with authenticator, then sign out and sign in with code
    role('admin'); shot('a4-admin-setup'); log('admin first visit -> ' + h1())
    opt(p, '#au-name', 'Ops Admin'); p.fill('#au-email', 'ops@listd.test'); p.fill('#au-password', 'Admin2026!'); opt(p, '#au-confirm', 'Admin2026!'); p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1300); shot('a5-mfa-setup'); log('mfa setup -> ' + h1())
    p.fill('#au-code', '000000'); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); W(600); log('bad code: ' + err())
    p.fill('#au-code', p.evaluate("() => totp(S.auth.secret)")); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); W(900); log('admin -> ' + h1())
    secret = p.evaluate("() => AUTH.accounts.find(a => a.role === 'admin').mfa.secret")
    p.click('.a-top [data-act=signout]'); W(); signin('ops@listd.test', 'Admin2026!'); log('after password -> ' + h1()); shot('a6-mfa')
    p.fill('#au-code', p.evaluate("s => totp(s)", secret)); p.click('form[data-form=auth-mfa] button[type=submit]'); W(900); log('admin signed in -> ' + h1())
    # older profile (created before sign-in existed) can be claimed
    p.evaluate("() => { setDoc('clients', 'legacy1', { name: 'Old Landlord', email: 'old@example.test', segment: 'LANDLORD', onboarding: { status: 'DONE', step: 5 }, createdAt: now() }); }")
    role('client'); p.click('.a-top [data-act=signout]'); W(); log('claim prompt shown: %s' % bool(p.locator('[data-act=auth-mode][data-m=claim]').count()))
    p.click('[data-act=auth-mode][data-m=claim]'); W(); p.check('input[name=profile][value=legacy1]'); p.fill('#au-email', 'old@example.test'); p.fill('#au-password', 'OldPass2026'); opt(p, '#au-confirm', 'OldPass2026'); p.click('form[data-form=auth-claim] button[type=submit]'); W(1500); log('claimed -> ' + h1())
    # mobile layout
    p.set_viewport_size({'width': 390, 'height': 844}); p.click('.a-top [data-act=signout]'); W(); shot('a7-mobile-signin')
    print('ERRORS', errs); br.close()
