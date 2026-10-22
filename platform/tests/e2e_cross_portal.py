"""Signing in to the Pro portal with a client login: links an existing Pro profile, or points to Pro sign-up."""
import os
from playwright.sync_api import sync_playwright
def opt(p, sel, val):
    if p.locator(sel).count(): p.fill(sel, val)
def optc(p, sel):
    if p.locator(sel).count(): p.check(sel)
HERE = os.path.dirname(os.path.abspath(__file__))
APP = 'file://' + os.path.join(HERE, '..', 'dist', 'listd-platform.html')
res = []
with sync_playwright() as pw:
    br = pw.chromium.launch(); errs = []
    for case in ['profile', 'none']:
        p = br.new_page(viewport={'width': 1280, 'height': 860}); p.on('pageerror', lambda e: errs.append(str(e)))
        W = lambda ms=300: p.wait_for_timeout(ms)
        p.goto(APP); W(600)
        p.click('[data-act=auth-mode][data-m=signup]'); W(); opt(p, '#au-name', 'Jo Bloggs'); p.fill('#au-email', 'jo@example.test'); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); optc(p, 'input[name=terms]')
        p.click('form[data-form=auth-signup] button[type=submit]'); W(1500)
        if case == 'profile': p.evaluate("() => setDoc('pros', 'oldpro', { name: 'Jo Bloggs', email: 'jo@example.test', status: 'APPROVED', onboarding: { status: 'SUBMITTED', step: 7 }, skills: ['CLEANING'], createdAt: now() })"); W()
        p.click('[data-act=role][data-r=pro]'); W()
        p.fill('#au-email', 'jo@example.test'); p.fill('#au-password', 'Listd2026!'); p.click('form[data-form=auth-signin] button[type=submit]'); W(1500)
        if case == 'profile': res.append(('linked existing Pro profile', p.evaluate('S.proId') == 'oldpro'))
        else: res.append(('no Pro profile -> sign-up with message', p.locator('form[data-form=auth-signup]').count() == 1 and 'no Pro account' in (p.locator('#au-err').text_content() or '') and p.input_value('#au-email') == 'jo@example.test'))
        p.close()
    p = br.new_page(viewport={'width': 1280, 'height': 860}); p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(APP); p.wait_for_timeout(600)
    p.evaluate("() => setDoc('pros', 'oldpro', { name: 'Jo Bloggs', email: 'jo@example.test', status: 'APPROVED', onboarding: { status: 'SUBMITTED', step: 7 }, createdAt: now() })")
    p.click('[data-act=role][data-r=pro]'); p.wait_for_timeout(400); p.click('[data-act=auth-mode][data-m=claim]'); p.wait_for_timeout(300)
    pre = p.input_value('#au-email'); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); p.click('form[data-form=auth-claim] button[type=submit]'); p.wait_for_timeout(1500)
    res.append(('Set up sign-in: email prefilled and Save and sign in works', pre == 'jo@example.test' and p.evaluate('S.proId') == 'oldpro'))
    for r in res: print(('PASS ' if r[1] else 'FAIL ') + r[0])
    print('ERRORS', errs); br.close()
