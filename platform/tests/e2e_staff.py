"""Admin Users & roles: first admin is Main admin; Main admin adds Sub-admin/Operations; Operations sees only its
sections; unknown staff wait for a role; role change; ownership transfer."""
import os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
APP = 'file://' + os.path.join(HERE, '..', 'dist', 'listd-platform.html')
OUT = os.path.join(HERE, 'out', 'shots') + '/'; os.makedirs(OUT, exist_ok=True)
res = []; errs = []
def check(ok, m): res.append((ok, m)); print(('PASS ' if ok else 'FAIL ') + m, flush=True)
with sync_playwright() as pw:
    br = pw.chromium.launch(); p = br.new_page(viewport={'width': 1280, 'height': 900})
    p.on('pageerror', lambda e: errs.append(str(e)))
    W = lambda ms=300: p.wait_for_timeout(ms)
    def setup(name, email):
        p.fill('#au-name', name); p.fill('#au-email', email); p.fill('#au-password', 'Admin2026!'); p.fill('#au-confirm', 'Admin2026!')
        p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1200)
        p.fill('#au-code', p.evaluate("() => totp(S.auth.secret)")); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); W(900)
    def signin(email):
        p.fill('#au-email', email); p.fill('#au-password', 'Admin2026!'); p.click('form[data-form=auth-signin] button[type=submit]'); W(1200)
        p.fill('#au-code', p.evaluate("e => totp(AUTH.accounts.find(x => x.role === 'admin' && x.email === e).mfa.secret)", email)); p.click('form[data-form=auth-mfa] button[type=submit]'); W(900)
    def signout(): p.evaluate('signOut()'); W()
    def nav(): return [x.strip() for x in p.locator('.a-side .a-nav span:first-of-type').all_inner_texts()]
    def team(): p.evaluate("go('settings', { tab: 'team' })"); W()
    p.goto(APP); W(600); p.click('[data-act=role][data-r=admin]'); W()
    setup('Jesu Owner', 'owner@listd.test')
    check(p.evaluate('staffRole()') == 'MAIN', 'first admin is the Main admin')
    team(); p.screenshot(path=OUT + 'r1-team.png', full_page=True)
    check(p.locator('[data-act=staff-add]').count() == 1, 'Main admin sees Add staff member')
    for nm, em, r in [('Ola Ops', 'ops@listd.test', 'OPS'), ('Sade Sub', 'sub@listd.test', 'SUB')]:
        p.click('[data-act=staff-add]'); W(); p.fill('#sti-name', nm); p.fill('#sti-email', em); p.click('.a-modal label.a-opt:has(input[value=%s])' % r); p.click('form[data-form=staff-invite] button[type=submit]'); W()
    p.screenshot(path=OUT + 'r2-team-invited.png', full_page=True)
    check(p.evaluate("staffList().filter(x => x.status === 'INVITED').length") == 2, 'two staff invited')
    # Operations joins
    signout(); p.click('[data-act=auth-mode][data-m=admin-setup]'); W(); setup('Ola Ops', 'ops@listd.test')
    check(p.evaluate('staffRole()') == 'OPS', 'invited staff gets their role on sign-in setup')
    n = nav(); p.screenshot(path=OUT + 'r3-ops.png')
    check(all(x in n for x in ['Overview', 'Requests', 'Assignments', 'Report reviews', 'Invoicing', 'Clients']) and not any(x in n for x in ['Finance', 'Pros', 'Training', 'Catalogue & policies', 'Audit log', 'Disputes']), 'Operations nav: ' + ', '.join(n))
    p.evaluate("go('finance')"); W(); check('don’t have access' in p.locator('.a-main').inner_text(), 'Operations blocked from Finance')
    team(); check(p.locator('[data-act=staff-add]').count() == 0 and p.locator('[data-staffrole]').count() == 0, 'Operations can view the team but not change it')
    # someone not invited waits for a role
    signout(); p.click('[data-act=auth-mode][data-m=admin-setup]'); W(); setup('New Person', 'new@listd.test')
    check(p.evaluate('staffRole()') is None and 'Waiting for a role' in p.locator('.a-main').inner_text(), 'uninvited admin waits for a role'); p.screenshot(path=OUT + 'r4-pending.png')
    # Main admin gives them a role, then transfers ownership to Operations user
    signout(); signin('owner@listd.test'); team()
    pid = p.evaluate("staffList().find(x => x.email === 'new@listd.test').id")
    p.select_option('[data-staffrole="%s"]' % pid, 'SUB'); W()
    check(p.evaluate("D.staff['%s'].role + ':' + D.staff['%s'].status" % (pid, pid)) == 'SUB:ACTIVE', 'Main admin assigns Sub-admin to waiting staff')
    oid = p.evaluate("staffList().find(x => x.email === 'ops@listd.test').id")
    p.click('[data-act=staff-transfer][data-id="%s"]' % oid); W(); p.check('#stt-ok'); p.click('form[data-form=staff-transfer] button[type=submit]'); W()
    check(p.evaluate("D.staff['%s'].role" % oid) == 'MAIN' and p.evaluate('staffRole()') == 'SUB', 'ownership transferred; previous owner becomes Sub-admin')
    check(p.evaluate("staffList().filter(x => x.role === 'MAIN').length") == 1, 'exactly one Main admin')
    n = nav(); check('Catalogue & policies' not in n and 'Finance' in n, 'Sub-admin nav: no policies, has finance')
    team(); p.screenshot(path=OUT + 'r5-team-final.png', full_page=True)
    print('FAILS', [m for ok, m in res if not ok]); print('ERRORS', errs); br.close()
