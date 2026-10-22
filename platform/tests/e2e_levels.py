"""Pro levels, training library and applications.

Admin adds trainings (PDF upload + link) -> Pro applies to join -> Admin can't start them at
Level 4 without training, approves at Level 1 -> Pro applies for Level 2 -> approved ->
Pro completes the Level 4 trainings -> applies for Level 4 -> approved -> eligible for inspections.
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
    def pro(): return ev("() => { var x = Object.values(D.pros)[0]; return { level: proLevel(x), status: x.status }; }")
    try:
        p.goto(APP); W(500)
        # ---- admin: trainings
        role('admin')
        opt(p, '#au-name', 'Ops Admin'); p.fill('#au-email', 'ops@listd.test'); p.fill('#au-password', 'Admin2026!'); opt(p, '#au-confirm', 'Admin2026!')
        p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1200)
        p.fill('#au-code', ev("() => totp(S.auth.secret)")); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); W(900)
        nav('training'); shot('L01-training-empty')
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Check-in inventory standards'); p.fill('#tr-desc', 'How LISTD writes rooms, items and condition.')
        p.locator('input[data-up*=training]').set_input_files(PDF); W(900)
        check(p.locator('.a-modal .a-upfile').count() == 1, 'PDF uploaded and shown in the dialog before saving'); shot('L01b-add-dialog', False)
        p.select_option('#tr-level', '4'); p.fill('#tr-min', '20'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Meter readings and keys'); p.fill('#tr-link', 'https://example.com/meters-video'); p.select_option('#tr-level', '4'); p.fill('#tr-min', '12'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Large property inspections'); p.fill('#tr-link', 'https://example.com/large'); p.select_option('#tr-level', '5'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        p.click('[data-act=t-new]'); W(); p.fill('#tr-title', 'Draft safety guide'); p.fill('#tr-link', 'https://example.com/draft'); p.select_option('#tr-level', '0'); p.uncheck('#tr-pub'); p.locator('form[data-form=training-add] button[type=submit]').click(); W()
        check(ev("() => Object.values(D.trainings).length") == 4 and p.locator('.a-modal').count() == 0, '4 trainings saved, dialog closed')
        check(ev("() => liveTrainings().length") == 3, 'draft is not live')
        shot('L02-training-library')
        # ---- pro joins
        role('pro')
        p.click('[data-act=auth-mode][data-m=signup]'); W(); opt(p, '#au-name', 'Sam Patel'); p.fill('#au-email', 'sam@example.test'); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); optc(p, 'input[name=terms]')
        p.click('form[data-form=auth-signup] button[type=submit]'); W(1500)
        p.fill('#pr-name', 'Sam Patel'); p.fill('#pr-ph', '07700 900002'); p.fill('#pr-pc', 'BA1 2AB'); btn('Save & continue')
        for s in ['CHECK_IN', 'CHECK_OUT', 'CLEANING']: p.check('input[name=skills][value=%s]' % s)
        p.fill('#pr-cov', 'BA'); btn('Save & continue')
        for d in range(7): p.check('input[name=days][value="%d"]' % d)
        for s in ['morning', 'afternoon']: p.check('input[name=slots][value=%s]' % s)
        btn('Save & continue')
        for i in range(3): p.locator('input[data-up]').nth(i).set_input_files(IMG); W(500)
        btn('Continue'); p.fill('#pr-l4', '1234'); btn('Save & continue'); p.check('#pob-terms'); btn('Submit for review')
        check(ev("() => Object.values(D.applications).filter(a => a.kind === 'JOIN' && a.status === 'PENDING').length") == 1, 'join application recorded')
        # ---- admin: table, applications, detail
        role('admin'); nav('pros'); shot('L03-pros-table')
        check(p.locator('.a-side [data-go=pros] .cnt').text_content() == '1', 'Pros nav shows 1 application waiting')
        check(p.locator('.a-clip tbody tr').count() == 1, 'Pros table lists the Pro')
        p.click('[data-act=ptab][data-t=apps]'); W(); shot('L04-applications')
        check(p.locator('.a-main tbody tr:has-text("Joining LISTD")').count() == 1, 'applications tab shows the join application')
        p.locator('.a-main tbody tr').first.click(); W(); shot('L05-pro-detail')
        for sec in ['pd-personal', 'pd-work', 'pd-level', 'pd-apps', 'pd-training', 'pd-docs']:
            check(p.locator('#' + sec).count() == 1, 'detail has ' + sec)
        check(p.locator('#pd-docs tbody tr:has-text("Uploaded")').count() == 3, '3 documents shown as uploaded')
        p.select_option('form[data-form=pro-review] select[name=level]', '4'); p.locator('form[data-form=pro-review] button[value=APPROVED]').click(); W()
        check(pro()['status'] == 'PENDING' and 'training' in toast(), 'cannot start at Level 4 without training: ' + toast())
        p.select_option('form[data-form=pro-review] select[name=level]', '1'); p.locator('form[data-form=pro-review] button[value=APPROVED]').click(); W()
        check(pro() == {'level': 1, 'status': 'APPROVED'}, 'approved at Level 1')
        check(ev("() => Object.values(D.applications)[0].status") == 'APPROVED', 'join application marked approved')
        # direct level 4 is blocked by training
        p.select_option('form[data-form=set-level] select[name=level]', '4'); p.fill('form[data-form=set-level] input[name=reason]', 'Experienced'); p.locator('form[data-form=set-level] button').click(); W()
        check(pro()['level'] == 1, 'direct Level 4 blocked without training')
        # eligibility
        check(ev("() => requiredLevel({ type: 'CHECK_IN', propSnapshot: { bedrooms: 2 } })") == 4 and ev("() => requiredLevel({ type: 'CHECK_OUT', propSnapshot: { bedrooms: 4 } })") == 5 and ev("() => requiredLevel({ type: 'MAINTENANCE', kind: 'CLEANING', scope: { clean: 'deep' } })") == 3, 'required levels by job type')
        check('Needs Level 4' in ev("() => String(eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 2 } }, null))"), 'Level 1 Pro not eligible for check-in')
        # policies: relax L2-L4 job/rating rules for the test
        nav('policies')
        for k in ['2', '3', '4']: p.fill('#pol-lv_%s_jobs' % k, '0'); p.fill('#pol-lv_%s_rating' % k, '0')
        p.fill('#pol-why', 'Test thresholds'); p.locator('form[data-form=policies] button[type=submit]').click(); W()
        check(ev("() => lvRule(4).minJobs") == 0, 'level rules saved in policies')
        # ---- pro: training page, apply L2
        role('pro'); nav('training'); shot('L06-pro-training')
        check(p.locator('form[data-form=apply-level] button[type=submit]').is_enabled(), 'Level 2 apply enabled when rules met')
        p.fill('#ap-note', 'Ready for general cleans'); p.locator('form[data-form=apply-level] button[type=submit]').click(); W()
        check(ev("() => Object.values(D.applications).filter(a => a.kind === 'LEVEL' && a.status === 'PENDING').length") == 1, 'level 2 application sent')
        shot('L07-pro-applied')
        role('admin'); nav('pros'); p.click('[data-act=ptab][data-t=apps]'); W(); p.locator('.a-main tbody tr').first.click(); W()
        p.locator('form[data-form=app-decide] button[value=APPROVE]').click(); W()
        check(pro()['level'] == 2, 'Level 2 approved')
        p.select_option('form[data-form=set-level] select[name=level]', '3'); p.fill('form[data-form=set-level] input[name=reason]', 'Strong deep-clean record'); p.locator('form[data-form=set-level] button').click(); W()
        check(pro()['level'] == 3, 'Admin set Level 3 directly')
        # ---- pro: L4 blocked until trainings done
        role('pro'); nav('training')
        check(not p.locator('form[data-form=apply-level] button[type=submit]').is_enabled(), 'Level 4 apply disabled until trainings done')
        for i in range(2):
            p.locator('.a-tgroup:has-text("Needed for Level 4") .a-trow').nth(i).click(); W()
            if i == 0: shot('L08-pro-training-view')
            p.check('#td-confirm'); p.locator('form[data-form=training-done] button').click(); W(); p.click('.a-main [data-act=back]'); W()
        check(ev("() => Object.keys(Object.values(D.pros)[0].trainings || {}).length") == 2, '2 trainings completed')
        p.locator('form[data-form=apply-level] button[type=submit]').click(); W()
        role('admin'); nav('pros'); p.click('[data-act=ptab][data-t=all]'); W(); p.locator('.a-clip tbody tr').first.click(); W(); shot('L09-pro-detail-l4-app')
        p.locator('form[data-form=app-decide] button[value=APPROVE]').click(); W()
        check(pro()['level'] == 4, 'Level 4 approved after training')
        check(ev("() => eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 2 } }, null)") is True, 'Level 4 Pro eligible for check-in')
        check('Needs Level 5' in ev("() => String(eligible(Object.values(D.pros)[0], { type: 'CHECK_IN', district: 'BA1', propSnapshot: { bedrooms: 5 } }, null))"), 'large property needs Level 5')
        shot('L10-pro-detail-final')
        nav('training'); shot('L11-training-admin')
        # archive & unpublish
        p.locator('[data-act=t-status][data-s=ARCHIVED]').first.click(); W()
        check(ev("() => Object.values(D.trainings).filter(t => t.status === 'ARCHIVED').length") == 1, 'training archived')
        role('pro'); nav('training'); p.set_viewport_size({'width': 390, 'height': 844}); W(400); shot('L12-pro-training-mobile')
        role('admin'); ev("() => { S.ptab = 'all'; go('pros'); }"); W(300); shot('L13-pros-mobile')
        p.set_viewport_size({'width': 1280, 'height': 900})
    except Exception as e:
        errs.append('EXC ' + str(e)); shot('L99-error')
    print('FAILS', fails); print('ERRORS', errs)
    br.close()
