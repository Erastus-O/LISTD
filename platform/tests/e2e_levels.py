"""Pro roles, levels, standards check, training and applications.

Admin adds role trainings -> Pro (Clerk + Cleaner) joins -> Admin can't start them at Pro Clerk Level 2
without training, approves at Level 1 in both roles -> standards check passed early -> Pro applies for
Pro Cleaner Level 2 -> approved -> Pro completes the Clerk trainings -> Pro Clerk Level 2 -> eligible for
larger inspections. Then an open job near the Pro is accepted from the Jobs page.
"""
import os
from playwright.sync_api import sync_playwright
def opt(p, sel, val):
    if p.locator(sel).count(): p.fill(sel, val)
def optc(p, sel):
    if p.locator(sel).count(): p.check(sel)
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, 'out') + '/'
os.makedirs(B + 'shots', exist_ok=True)
APP = 'file://' + os.path.join(HERE, '..', 'dist', 'listd-platform.html')
IMG = os.path.join(HERE, 'sample-photo.jpg')
PDF = B + 'training.pdf'
open(PDF, 'wb').write(b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
errs = []; step = [0]; fails = []
def log(m): step[0] += 1; print(step[0], m, flush=True)
def check(ok, m):
    log(('PASS ' if ok else 'FAIL ') + m)
    if not ok: fails.append(m)

with sync_playwright() as pw:
    br = pw.chromium.launch(); p = br.new_page(viewport={'width': 1280, 'height': 900})
    p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
    p.on('pageerror', lambda e: errs.append(str(e)))
    W = lambda ms=250: p.wait_for_timeout(ms)
    def shot(n, full=True): p.screenshot(path=B + 'shots/' + n + '.png', full_page=full)
    def role(r): p.click('[data-act=role][data-r=%s]' % r); W()
    def nav(v): p.click('.a-side [data-go=%s]' % v); W()
    def btn(t): p.locator('.a-main button:has-text("%s")' % t).first.click(); W()
    def ev(js): return p.evaluate(js)
    def toast(): return (p.locator('#toast').text_content() or '').strip()
    def pro(): return ev("() => { var x = Object.values(D.pros)[0]; return { clerk: proLevel(x, 'CLERK'), cleaner: proLevel(x, 'CLEANER'), status: x.status }; }")
    try:
        p.goto(APP); W(500)
        # ---- admin: trainings for roles and levels
        role('admin')
        opt(p, '#au-name', 'Ops Admin'); p.fill('#au-email', 'ops@listd.test'); p.fill('#au-password', 'Admin2026!'); opt(p, '#au-confirm', 'Admin2026!')
        p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1200)
        W(900)
        nav('training'); shot('L01-training-empty')
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Check-in inventory standards'); p.fill('#tr-desc', 'How LISTD writes rooms, items and condition.')
        p.locator('input[data-up*=training]').set_input_files(PDF); W(900)
        check(p.locator('.a-modal .a-upfile').count() == 1, 'PDF uploaded and shown in the dialog before saving'); shot('L01b-add-dialog', False)
        p.select_option('#tr-level', 'CLERK:2'); p.fill('#tr-min', '20'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Meter readings and keys'); p.fill('#tr-link', 'https://example.com/meters-video'); p.select_option('#tr-level', 'CLERK:2'); p.fill('#tr-min', '12'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Large property inspections'); p.fill('#tr-link', 'https://example.com/large'); p.select_option('#tr-level', 'CLERK:3'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Draft safety guide'); p.fill('#tr-link', 'https://example.com/draft'); p.select_option('#tr-level', '0'); p.uncheck('#tr-pub'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        check(ev("() => Object.values(D.trainings).length") == 4 and p.locator('.a-modal').count() == 0, '4 trainings saved, dialog closed')
        check(ev("() => liveTrainings().length") == 3, 'draft is not live')
        check(ev("() => Object.values(D.trainings).filter(t => t.role === 'CLERK' && t.level === 2).length") == 2, 'trainings saved against Pro Clerk Level 2')
        shot('L02-training-library')
        # ---- pro joins as Clerk + Cleaner
        role('pro')
        p.click('[data-act=auth-mode][data-m=signup]'); W(); opt(p, '#au-name', 'Sam Patel'); p.fill('#au-email', 'sam@example.test'); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); optc(p, 'input[name=terms]')
        p.click('form[data-form=auth-signup] button[type=submit]'); W(1500)
        p.fill('#pr-name', 'Sam Patel'); p.fill('#pr-ph', '07700 900002'); p.fill('#pr-pc', 'BA1 2AB'); btn('Save & continue')
        check(p.locator('.a-rolegrp').count() == 3, 'services grouped by Pro Clerk, Pro Cleaner and Pro Trades')
        for s in ['CHECK_IN', 'CHECK_OUT', 'CLEANING']: p.check('input[name=skills][value=%s]' % s)
        p.fill('#pr-cov', 'BA'); btn('Save & continue')
        for d in range(7): p.check('input[name=days][value="%d"]' % d)
        for s in ['morning', 'afternoon']: p.check('input[name=slots][value=%s]' % s)
        btn('Save & continue')
        check('Professional indemnity' in p.locator('.a-main').inner_text() and 'needed as a Pro Clerk' in p.locator('.a-main').inner_text(), 'Pro Clerks are asked for professional indemnity insurance')
        for i in range(4): p.locator('input[data-up]').nth(i).set_input_files(IMG); W(500)
        btn('Continue'); check('Professional indemnity' in toast(), 'onboarding blocked until professional indemnity is uploaded: ' + toast())
        p.locator('input[data-up]').nth(4).set_input_files(IMG); W(500)
        btn('Continue'); p.fill('#pr-l4', '1234'); btn('Save & continue'); p.check('#pob-terms'); btn('Submit for review')
        check(ev("() => Object.values(D.applications).filter(a => a.kind === 'JOIN' && a.status === 'PENDING').length") == 1, 'join application recorded')
        check(ev("() => proRoles(Object.values(D.pros)[0]).join(',')") == 'CLERK,CLEANER', 'Pro holds the Clerk and Cleaner roles')
        # ---- admin: table, applications, detail
        role('admin'); nav('pros'); shot('L03-pros-table')
        check(p.locator('.a-side [data-go=pros] .cnt').text_content() == '1', 'Pros nav shows 1 application waiting')
        check(p.locator('.a-clip tbody tr').count() == 1, 'Pros table lists the Pro')
        p.click('[data-act=ptab][data-t=apps]'); W(); shot('L04-applications')
        check(p.locator('.a-main tbody tr:has-text("Joining LISTD")').count() == 1, 'applications tab shows the join application')
        p.locator('.a-main tbody tr').first.click(); W(); shot('L05-pro-detail')
        for sec in ['pd-personal', 'pd-work', 'pd-level', 'pd-apps', 'pd-training', 'pd-docs']:
            check(p.locator('#' + sec).count() == 1, 'detail has ' + sec)
        check(p.locator('#pd-docs tbody tr:has-text("Uploaded")').count() == 5, '5 documents shown as uploaded')
        check(p.locator('#pd-docs tbody tr:has-text("Trade certificates"):has-text("Not needed")').count() == 1, 'trade certificates not needed without the Trades role')
        p.select_option('form[data-form=pro-review] select[name=level_CLERK]', '2'); p.locator('form[data-form=pro-review] button[value=APPROVED]').click(); W()
        check(pro()['status'] == 'PENDING' and 'training' in toast(), 'cannot start at Pro Clerk Level 2 without training: ' + toast())
        p.select_option('form[data-form=pro-review] select[name=level_CLERK]', '1'); p.locator('form[data-form=pro-review] button[value=APPROVED]').click(); W()
        check(pro() == {'clerk': 1, 'cleaner': 1, 'status': 'APPROVED'}, 'approved at Level 1 in both roles')
        check(ev("() => Object.values(D.applications)[0].status") == 'APPROVED', 'join application marked approved')
        check('Pro Clerk · Level 1' in p.locator('.a-prohead').inner_text() and 'New to LISTD' in p.locator('.a-prohead').inner_text(), 'badges read "Pro Clerk · Level 1" with New to LISTD')
        # direct Clerk level 2 is blocked by training
        p.select_option('#pd-level-CLERK form[data-form=set-level] select[name=level]', '2'); p.fill('#pd-level-CLERK form[data-form=set-level] input[name=reason]', 'Experienced'); p.locator('#pd-level-CLERK form[data-form=set-level] button').click(); W()
        check(pro()['clerk'] == 1, 'direct Pro Clerk Level 2 blocked without training')
        # eligibility by role level
        check(ev("() => requiredLevel({ type: 'CHECK_IN', propSnapshot: { bedrooms: 2 } })") == 1 and ev("() => requiredLevel({ type: 'CHECK_OUT', propSnapshot: { bedrooms: 4 } })") == 2 and ev("() => requiredLevel({ type: 'MAINTENANCE', kind: 'CLEANING', scope: { clean: 'deep' } })") == 3, 'required levels by job type')
        check(ev("() => eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 2 } }, null)") is True, 'Pro Clerk Level 1 eligible for a 2-bedroom check-in')
        check('Needs Pro Clerk · Level 2' in ev("() => String(eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 3 } }, null))"), 'a 3-bedroom check-in needs Pro Clerk Level 2')
        check('Needs Pro Cleaner · Level 3' in ev("() => String(eligible(Object.values(D.pros)[0], { type: 'MAINTENANCE', kind: 'CLEANING', scope: { clean: 'deep' }, district: 'BA1' }, null))"), 'a deep clean needs Pro Cleaner Level 3')
        # standards check: experienced Pro passes it early in both roles
        for r in ['CLEANER', 'CLERK']:
            p.fill('#pd-level-%s form[data-form=std-pass] input[name=reason]' % r, '5 years experience, references checked'); p.locator('#pd-level-%s form[data-form=std-pass] button' % r).click(); W()
        check(ev("() => standardsCheck(Object.values(D.pros)[0], 'CLEANER').passed && standardsCheck(Object.values(D.pros)[0], 'CLERK').passed") is True, 'standards check passed early in both roles')
        # policies: relax level 2-3 job/rating rules for the test
        nav('settings'); p.fill('#pp-ph', '07700 900456'); p.locator('form[data-form=price-phone] button[type=submit]').click(); W(500)
        _c = __import__('re').search(r'(\d{6})', p.locator('.a-modal .a-banner').inner_text()).group(1); p.fill('#pc-code', _c); p.locator('form[data-form=price-code] button[type=submit]').click(); W(500)
        nav('policies')
        for k in ['2', '3']: p.fill('#pol-lv_%s_jobs' % k, '0'); p.fill('#pol-lv_%s_rating' % k, '0')
        p.fill('#pol-why', 'Test thresholds'); p.locator('form[data-form=policies] button[type=submit]').click(); W()
        check(ev("() => lvRule(2).minJobs") != 0 and p.locator('.a-modal').count() == 1, 'policy change waits for the code to the Main admin phone')
        _c = __import__('re').search(r'(\d{6})', p.locator('.a-modal .a-banner').inner_text()).group(1); p.fill('#pc-code', _c); p.locator('form[data-form=price-code] button[type=submit]').click(); W(500)
        check(ev("() => lvRule(2).minJobs") == 0, 'level rules saved in policies')
        # ---- pro: training page, apply for Pro Cleaner Level 2
        role('pro'); nav('training'); shot('L06-pro-training')
        check(p.locator('.a-lvcard').count() == 2, 'one card per role')
        cl = '#role-CLEANER form[data-form=apply-level] '
        check(p.locator(cl + 'button[type=submit]').is_enabled(), 'Pro Cleaner Level 2 apply enabled when rules met')
        p.fill(cl + 'input[name=note]', 'Ready for end of tenancy cleans'); p.locator(cl + 'button[type=submit]').click(); W()
        check(ev("() => Object.values(D.applications).filter(a => a.kind === 'LEVEL' && a.role === 'CLEANER' && a.status === 'PENDING').length") == 1, 'Pro Cleaner Level 2 application sent')
        shot('L07-pro-applied')
        role('admin'); nav('pros'); p.click('[data-act=ptab][data-t=apps]'); W(); p.locator('.a-main tbody tr').first.click(); W()
        p.locator('form[data-form=app-decide] button[value=APPROVE]').click(); W()
        check(pro()['cleaner'] == 2 and pro()['clerk'] == 1, 'Pro Cleaner Level 2 approved, Clerk unchanged')
        p.select_option('#pd-level-CLEANER form[data-form=set-level] select[name=level]', '3'); p.fill('#pd-level-CLEANER form[data-form=set-level] input[name=reason]', 'Strong deep-clean record'); p.locator('#pd-level-CLEANER form[data-form=set-level] button').click(); W()
        check(pro()['cleaner'] == 3, 'Admin set Pro Cleaner Level 3 directly')
        # ---- pro: Clerk Level 2 blocked until trainings done
        role('pro'); nav('training')
        ck = '#role-CLERK form[data-form=apply-level] '
        check(not p.locator(ck + 'button[type=submit]').is_enabled(), 'Pro Clerk Level 2 apply disabled until trainings done')
        for i, t in enumerate(['Check-in inventory standards', 'Meter readings and keys']):
            p.locator('.a-tgroup:has-text("Needed as a Pro Clerk") .a-trow:has-text("%s")' % t).click(); W()
            if i == 0: shot('L08-pro-training-view')
            p.check('#td-confirm'); p.locator('form[data-form=training-done] button').click(); W(); p.click('.a-main [data-act=back]'); W()
        check(ev("() => Object.keys(Object.values(D.pros)[0].trainings || {}).length") == 2, '2 trainings completed')
        p.locator(ck + 'button[type=submit]').click(); W()
        role('admin'); nav('pros'); p.click('[data-act=ptab][data-t=all]'); W(); p.locator('.a-clip tbody tr').first.click(); W(); shot('L09-pro-detail-l4-app')
        p.locator('form[data-form=app-decide] button[value=APPROVE]').click(); W()
        check(pro()['clerk'] == 2, 'Pro Clerk Level 2 approved after training')
        check(ev("() => eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 3 } }, null)") is True, 'Pro Clerk Level 2 eligible for a 3-bedroom check-in')
        check('Needs Pro Clerk · Level 3' in ev("() => String(eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 5 } }, null))"), 'large property needs Pro Clerk Level 3')
        check(ev("() => proRate('CLERK', 2)") == 2000 and ev("() => proRate('CLEANER', 3)") == 1600, 'hourly rate per role and level')
        shot('L10-pro-detail-final')
        nav('training'); shot('L11-training-admin')
        # ---- open jobs: a paid job near the Pro, accepted from the Jobs page
        ev("""() => { var d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
          setDoc('jobs', 'jopen', { id: 'jopen', ref: 'LJ-9001', clientId: 'cx', propertyId: 'px', propSnapshot: { label: 'Open Flat', address: '1 Open St', postcode: 'BA1 1AA', bedrooms: 2, bathrooms: 1 }, district: 'BA1', type: 'MAINTENANCE', kind: 'CLEANING', scope: { clean: 'standard' }, window: { date: d, slot: 'morning' }, status: 'READY_FOR_ASSIGNMENT',
            quotes: [{ v: 1, status: 'ACCEPTED', lines: [{ d: 'Clean', q: 1, u: 8000 }], totalP: 8000, proFeeP: 5000, proBase: { attendP: 500, minutes: 120, allowP: 0, role: 'CLEANER', level: 1 } }], payments: [{ status: 'SUCCEEDED', amountP: 8000 }], offers: [], history: [], createdAt: now() }); }""")
        role('pro'); nav('offers'); W(400)
        check(p.locator('.a-sec:has-text("Open jobs near you") .a-job').count() == 1, 'open job listed for the Pro')
        p.locator('.a-sec:has-text("Open jobs near you") .a-job').first.click(); W()
        p.locator('[data-act=take-open]').click(); W()
        check(ev("() => [D.jobs.jopen.status, D.jobs.jopen.proId === Object.values(D.pros)[0].id, D.jobs.jopen.agreedFeeP]") == ['SCHEDULED', True, 3700], 'Pro accepted the open job at their Pro Cleaner Level 3 rate')
        # archive & unpublish
        role('admin'); nav('training')
        p.locator('[data-act=t-status][data-s=ARCHIVED]').first.click(); W()
        check(ev("() => Object.values(D.trainings).filter(t => t.status === 'ARCHIVED').length") == 1, 'training archived')
        role('pro'); nav('training'); p.set_viewport_size({'width': 390, 'height': 844}); W(400); shot('L12-pro-training-mobile')
        role('admin'); ev("() => { S.ptab = 'all'; go('pros'); }"); W(300); shot('L13-pros-mobile')
        p.set_viewport_size({'width': 1280, 'height': 900})
    except Exception as e:
        errs.append('EXC ' + str(e)); shot('L99-error')
    print('FAILS', fails); print('ERRORS', errs)
    br.close()
