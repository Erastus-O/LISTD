import sys, json, datetime
from playwright.sync_api import sync_playwright
def opt(p, sel, val):
    if p.locator(sel).count(): p.fill(sel, val)
def optc(p, sel):
    if p.locator(sel).count(): p.check(sel)
import os
HERE=os.path.dirname(os.path.abspath(__file__))
B=os.path.join(HERE,'out')+'/'
os.makedirs(B+'shots',exist_ok=True)
APP='file://'+os.path.join(HERE,'..','dist','listd-platform.html')
IMG=os.path.join(HERE,'sample-photo.jpg')
errs=[]; step=[0]
D1=(datetime.date.today()+datetime.timedelta(days=3)).isoformat()
D2=(datetime.date.today()+datetime.timedelta(days=5)).isoformat()
def shot(p,n): p.screenshot(path=B+'shots/'+n+'.png',full_page=True)
def log(m): step[0]+=1; print(step[0], m, flush=True)
with sync_playwright() as pw:
    br=pw.chromium.launch(); p=br.new_page(viewport={'width':1280,'height':900})
    p.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_' not in m.text else None)
    p.on('pageerror', lambda e: errs.append(str(e)))
    W=lambda ms=250: p.wait_for_timeout(ms)
    def role(r): p.click('[data-act=role][data-r=%s]'%r); W()
    def nav(v): p.click('.a-side [data-go=%s]'%v); W()
    def btn(t): p.locator('.a-main button:has-text("%s"), .a-modal button:has-text("%s")'%(t,t)).first.click(); W()
    def submit(): p.locator('.a-main form[data-form=wiz] button[type=submit]').click(); W()
    def up(sel): p.locator(sel).first.set_input_files(IMG); W(500)
    def state(ref): return p.evaluate("r => { var j = Object.values(D.jobs).find(x => x.ref === r); return j ? [j.status, (j.payments||[]).length, j.settlement && j.settlement.status, (j.disputes||[]).map(d=>d.status).join(), (j.refunds||[]).reduce((a,x)=>a+x.amountP,0)] : null }", ref)
    def openref(ref): p.evaluate("r => { var j = Object.values(D.jobs).find(x => x.ref === r); go('job',{id:j.id}); }", ref); W()
    def signup(name, email):
        p.click('[data-act=auth-mode][data-m=signup]'); W(); opt(p, '#au-name', name); p.fill('#au-email', email); p.fill('#au-password', 'Listd2026!'); opt(p, '#au-confirm', 'Listd2026!'); optc(p, 'input[name=terms]')
        p.click('form[data-form=auth-signup] button[type=submit]'); p.wait_for_timeout(1500)
    def admin_setup():
        opt(p, '#au-name', 'Ops Admin'); p.fill('#au-email', 'ops@listd.test'); p.fill('#au-password', 'Admin2026!'); opt(p, '#au-confirm', 'Admin2026!')
        p.click('form[data-form=auth-admin-setup] button[type=submit]'); p.wait_for_timeout(1200)
        p.fill('#au-code', p.evaluate("() => totp(S.auth.secret)")); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); p.wait_for_timeout(900)
    try:
        p.goto(APP); W(500); shot(p,'00-signin')
        # ---- client onboarding
        signup('Ada Okafor','ada@example.test'); p.click('label.a-opt:has(input[value=LANDLORD])'); p.check('input[name=authority]'); btn('Continue'); log('client step1')
        shot(p,'01-ob2'); p.fill('#ob-ph','07700 900000'); btn('Save & continue')
        p.fill('#ob-ba','1 Test Road'); p.fill('#ob-bc','Bath'); p.fill('#ob-bp','ba1 1aa'); btn('Save & continue')
        p.fill('#p-lbl','Pulteney Flat 3'); p.fill('#p-addr','Flat 3, 22 Pulteney Street, Bath'); p.fill('#p-pc','ba2 4ds'); p.fill('#p-bed','2'); p.select_option('#p-furn','furnished'); p.fill('#p-acode','Key safe 4821'); p.fill('#p-cn','Jo Tenant'); p.fill('#p-cp','07700 900001'); shot(p,'02-ob-prop'); btn('Save property')
        shot(p,'03-ob-review'); btn('Finish setup'); log('client onboarded')
        # ---- check-in request
        nav('jobs'); p.locator('.a-main [data-go=new]').first.click(); W(); submit(); p.click('label.a-opt:has(input[value=CHECK_IN])'); submit(); p.fill('#w-keys','2 sets to tenant'); submit(); submit(); p.fill('#w-date',D1); submit(); shot(p,'04-wiz-review'); submit(); log('check-in submitted '+str(state('LJ-1001')))
        # ---- admin quote
        role('admin'); admin_setup(); shot(p,'05-admin-home'); openref('LJ-1001'); shot(p,'06-quote-builder'); btn('Issue quote to client'); log('quoted '+str(state('LJ-1001')))
        role('client'); openref('LJ-1001'); shot(p,'07-client-quote'); btn('Accept quote'); btn('Simulate a failed payment'); log('failed pay '+str(state('LJ-1001'))); p.locator('[data-act=pay]').click(); W(); log('paid '+str(state('LJ-1001'))); p.locator('[data-act=pay]').count()==0 or log('PAY BUTTON STILL THERE')
        # ---- pro onboarding
        role('pro'); signup('Sam Patel','sam@example.test')
        p.fill('#pr-name', 'Sam Patel'); p.fill('#pr-ph','07700 900002'); p.fill('#pr-pc','BA1 2AB'); btn('Save & continue')
        for s in ['CHECK_IN','CHECK_OUT','REPAIRS_DAMAGES','CLEANING']: p.check('input[name=skills][value=%s]'%s)
        p.fill('#pr-cov','BA2, BS'); btn('Save & continue')
        for d in range(7): p.check('input[name=days][value="%d"]'%d)
        for s in ['morning','afternoon','evening']: p.check('input[name=slots][value=%s]'%s)
        btn('Save & continue')
        for i in range(4): p.locator('input[data-up]').nth(i).set_input_files(IMG); W(500)
        shot(p,'08-pro-docs'); btn('Continue'); p.fill('#pr-l4','1234'); btn('Save & continue'); shot(p,'09-pro-submit'); p.check('#pob-terms'); btn('Submit for review'); log('pro submitted')
        role('admin'); nav('pros'); shot(p,'10-admin-pros'); p.locator('.a-main tr.click').first.click(); W(); shot(p,'10b-admin-pro'); p.select_option('form[data-form=pro-review] select[name=level]','4'); p.locator('form[data-form=pro-review] button[value=APPROVED]').first.click(); W(); log('pro approved at level '+str(p.evaluate("() => proLevel(Object.values(D.pros)[0])")))
        openref('LJ-1001'); p.select_option('#of-pro', index=1); p.fill('#of-date',D1); shot(p,'11-offer'); btn('Send offer'); log('offered')
        role('pro'); nav('offers'); p.locator('.a-main .a-job').first.click(); W(); shot(p,'12-pro-offer'); btn('Accept job'); log('accepted '+str(state('LJ-1001')))
        up('input[data-up*="clock-in"]'); btn('Clock in'); log('clocked in '+str(state('LJ-1001')))
        # fill the LISTD Inventory report: a photo for every room, a description for every item
        for i in range(p.locator('input[data-up*="\\"item\\":\\"room\\""]').count()):
            p.locator('input[data-up*="\\"item\\":\\"room\\""]').nth(i).set_input_files(IMG); W(300)
        p.evaluate("""() => { var j=Object.values(D.jobs).find(x=>x.ref==='LJ-1001'), d=draftOf(j);
          d.schedule.forEach(function(r,i){ if(i>0) r.value = SCHED_OPTS[r.kind][r.kind==='clean'?1:r.kind==='ext'?0:2]; });
          d.rooms.forEach(function(rm){ rm.items.forEach(function(it){ it.desc = 'White painted ' + it.name.toLowerCase() + '.'; }); });
          d.meters.forEach(function(m){ m.na = true; }); d.keys[0].desc = 'Two sets of tenant keys.'; saveDraft(j.id); render(); }""")
        W(900)
        up('input[data-up*="clock-out"]'); p.locator('form[data-form=clock-out] button[type=submit]').click(); W(); shot(p,'13-pro-report'); btn('Submit report'); log('report submitted '+str(state('LJ-1001')))
        role('admin'); nav('reviews'); p.locator('.a-main tr.click').first.click(); W(); shot(p,'14-admin-review'); p.fill('form[data-form=return] input','Add a note on the hallway scuff'); p.locator('form[data-form=return] button').click(); W(); log('returned '+str(state('LJ-1001')))
        role('pro'); openref('LJ-1001'); p.locator('textarea[id^="c-"]').first.fill('Small scuff by lock'); W(900); btn('Submit report'); log('resubmitted '+str(state('LJ-1001')))
        role('admin'); openref('LJ-1001'); btn('Release to client'); log('released '+str(state('LJ-1001')))
        role('client'); openref('LJ-1001'); shot(p,'15-client-review'); btn('Request corrections'); p.fill('#mx-t','Please add gas reading'); btn('Send request'); log('correction '+str(state('LJ-1001')))
        role('pro'); openref('LJ-1001'); p.locator('[data-mna="0"]').uncheck(); W(); p.fill('#mt-0-reading','11872'); W(900); btn('Submit report'); role('admin'); openref('LJ-1001'); btn('Release to client')
        role('client'); openref('LJ-1001'); btn('Accept report'); p.click('[data-act=star][data-n="5"]'); p.locator('form[data-form=rate] button[type=submit]').click(); W(); shot(p,'16-client-complete'); log('completed '+str(state('LJ-1001')))
        role('admin'); nav('finance'); shot(p,'17-finance'); p.locator('[data-act=payout]').first.click(); W(); log('payout '+str(state('LJ-1001')))
        # ---- check-out with baseline
        role('client'); nav('jobs'); p.locator('.a-main [data-go=new]').first.click(); W(); submit(); p.click('label.a-opt:has(input[value=CHECK_OUT])'); submit(); shot(p,'18-checkout-baseline'); base_ok=p.locator('text=Baseline found').count(); p.fill('#w-keys','Collect 2 sets'); submit(); submit(); p.fill('#w-date',D2); submit(); submit(); log('check-out submitted, baseline banner=%d'%base_ok)
        # ---- repairs with change order + dispute
        nav('jobs'); p.locator('.a-main [data-go=new]').first.click(); W(); submit(); p.click('label.a-opt:has(input[value=REPAIRS_DAMAGES])'); shot(p,'18a-wiz-service'); submit(); p.fill('#w-loc','Kitchen sink'); p.fill('#w-desc','Tap drips constantly'); submit(); up('input[data-up]'); submit(); p.fill('#w-date',D2); submit(); submit(); log('repair submitted '+str(state('LJ-1003')))
        role('admin'); openref('LJ-1003'); p.fill('input[name=l_u_0]','60'); p.fill('input[name=l_u_1]','15'); btn('Recalculate'); p.fill('#q-fee','55'); btn('Issue invoice to client')
        role('client'); openref('LJ-1003'); shot(p,'18b-client-invoice'); nav('invoices'); shot(p,'18c-client-invoices'); p.locator('.a-main [data-act=inv-pay]').first.click(); W(); log('invoice paid '+str(state('LJ-1003')))
        role('admin'); openref('LJ-1003'); p.select_option('#of-pro', index=1); btn('Send offer')
        role('pro'); openref('LJ-1003'); btn('Accept job'); up('input[data-up*="clock-in"]'); btn('Clock in')
        btn('Propose extra work'); p.fill('#mco-d','Replace corroded isolation valve'); p.fill('#mco-e','30'); btn('Send to LISTD'); log('CO proposed')
        role('admin'); openref('LJ-1003'); p.locator('form[data-form=co-issue] button').click(); W()
        role('client'); openref('LJ-1003'); shot(p,'19-co-client'); p.locator('[data-act=co-accept]').click(); W(); log('CO paid '+str(state('LJ-1003')))
        role('pro'); openref('LJ-1003'); p.fill('#rf-diagnosis','Worn cartridge and corroded valve'); p.fill('#rf-work','Replaced cartridge and valve'); p.fill('#rf-summary','Fixed'); W(900)
        up('input[data-up*="BEFORE"]'); up('input[data-up*="AFTER"]'); up('input[data-up*="clock-out"]'); p.locator('form[data-form=clock-out] button[type=submit]').click(); W(); btn('Submit report')
        role('admin'); openref('LJ-1003'); btn('Release to client')
        role('client'); openref('LJ-1003'); p.locator('[data-act=dispute]').first.click(); W(); p.fill('#md-t','Still drips slightly'); btn('Open dispute'); log('disputed '+str(state('LJ-1003')))
        role('admin'); openref('LJ-1003'); shot(p,'20-admin-dispute'); p.select_option('#rs-o','PARTIAL_REFUND'); p.fill('#rs-amt','20'); p.fill('#rs-r','Minor drip confirmed from photos'); btn('Record outcome'); log('resolved '+str(state('LJ-1003')))
        role('client'); openref('LJ-1003'); btn('Accept report'); role('admin'); openref('LJ-1003'); p.locator('[data-act=payout]').first.click(); W(); log('repair payout '+str(state('LJ-1003'))+' fee='+str(p.evaluate("proFeeP(Object.values(D.jobs).find(x=>x.ref==='LJ-1003'))")))
        # ---- cleaning, auto-complete
        role('client'); nav('jobs'); p.locator('.a-main [data-go=new]').first.click(); W(); submit(); p.click('label.a-opt:has(input[value=CLEANING])'); submit(); p.click('label.a-opt:has(input[value=deep])'); submit(); submit(); p.fill('#w-date',D2); p.select_option('#w-slot','afternoon'); submit(); submit()
        role('admin'); openref('LJ-1004'); btn('Issue quote to client'); role('client'); openref('LJ-1004'); btn('Accept quote'); p.locator('[data-act=pay]').click(); W()
        role('admin'); openref('LJ-1004'); p.select_option('#of-pro', index=1); p.select_option('#of-slot','afternoon'); btn('Send offer')
        role('pro'); openref('LJ-1004'); btn('Accept job'); up('input[data-up*="clock-in"]'); btn('Clock in')
        cks=p.locator('input[data-ck]').count()
        for i in range(cks-1): p.locator('input[data-ck="%d"]'%i).check(); W(80)
        p.fill('#na-%d'%(cks-1),'No furniture to move'); p.fill('#rf-summary','Deep clean done'); W(900)
        up('input[data-up*="BEFORE"]'); up('input[data-up*="AFTER"]'); p.fill('#co-ex','Camera failed'); p.locator('form[data-form=clock-out] button[type=submit]').click(); W(); btn('Submit report'); log('clean submitted '+str(state('LJ-1004')))
        role('admin'); openref('LJ-1004'); p.fill('form[data-form=att-ok] input','Accepted, after photos present'); p.locator('form[data-form=att-ok] button').click(); W(); btn('Release to client')
        p.evaluate("() => { var j=Object.values(D.jobs).find(x=>x.ref==='LJ-1004'); D.jobs[j.id].reviewDueAt=new Date(Date.now()-1000).toISOString(); sweep(); }"); W(500); log('auto-complete '+str(state('LJ-1004'))+' mode='+p.evaluate("Object.values(D.jobs).find(x=>x.ref==='LJ-1004').completion.mode"))
        nav('invoicing'); shot(p,'20b-invoicing'); log('invoices %d (%s)' % (p.locator('.a-clip tbody tr').count(), p.evaluate("() => invoices().map(x => x.no + ':' + x.st).join(', ')"))); nav('home'); shot(p,'21-admin-home'); nav('finance'); shot(p,'22-finance'); nav('audit'); shot(p,'23-audit'); nav('policies'); shot(p,'24-policies')
        role('pro'); nav('earnings'); shot(p,'25-earnings')
        role('client'); nav('payments'); shot(p,'26-payments'); openref('LJ-1001'); shot(p,'27-client-checkin')
        # mobile
        p.set_viewport_size({'width':390,'height':844}); W(); shot(p,'28-m-job'); role('pro'); p.click('.a-tabs [data-go=home]'); W(); shot(p,'29-m-pro')
        log('ALL ' + json.dumps([state('LJ-100%d'%i) for i in range(1,5)]))
    except Exception as ex:
        print('FAIL', ex); shot(p,'zz-fail')
    print('ERRORS', errs)
    br.close()
