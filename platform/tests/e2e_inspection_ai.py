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
    br=pw.chromium.launch(); p=br.new_page(viewport={'width':1280,'height':900}, accept_downloads=True)
    p.route('**/jspdf.umd.min.js', lambda route: route.fulfill(path=os.environ.get('JSPDF_PATH','jspdf.umd.min.js'), content_type='application/javascript'))
    p.add_init_script('''(function(){ var calls=[]; window.__aiCalls=calls; var f=async function(prompt){ calls.push('text'); return {text:'The property is in good overall condition with light wear consistent with use. The hallway walls need maintenance investigation.'}; };
      f.limits=async function(){ return {images:{maxCount:4}}; };
      f.json=async function(prompt,o){ calls.push(prompt.slice(0,40)); await new Promise(r=>setTimeout(r,150));
        if(prompt.indexOf('Read it exactly')>=0) return {reading:'5305.20 CUBIC FEET',serial:'No.564348',location:'Side walk leading to Garden Flat on the wall. (Right hand side)',confidence:'high',check:'Confirm the last digit.'};
        if(prompt.indexOf('overview shots')>=0) return [{name:'Wardrobe',description:'White double wardrobe with two hinged doors and chrome handles.'}];
        if(prompt.indexOf('test each key')>=0) return {description:'Two sets of tenant keys on metal rings, one with an orange tag; each set has a cylinder and a mortice key. Minor cosmetic wear.',confidence:'high',check:'Test each key.'};
        var m=prompt.match(/show "([^"]+)" in/); var nm=m?m[1]:'item'; return {description:'White painted '+nm.toLowerCase()+' with standard fittings.',condition: (nm==='Walls'||nm==='Toilet'||nm==='Oven')?'Minor scuff marks and some discolouration in places, otherwise intact.':'',grade: prompt.indexOf('"weathered"')>=0?'weathered':'good',action: nm==='Walls'?'maintenance':(nm==='Toilet'||nm==='Oven')?'cleaning':'',confidence:'medium',check:'Check for marks behind the door.'}; };
      window.__listdSampleMock=f; })();''')
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

        log('AI on: ' + str(p.evaluate("aiOn()")))
        n=p.locator('input[data-up*="\\"ai\\":\\"item\\""]').count(); log('item inputs %d'%n)
        for i in range(n):
            p.locator('input[data-up*="\\"ai\\":\\"item\\""]').nth(i).set_input_files(IMG); p.wait_for_timeout(260)
        p.wait_for_timeout(1500); log('ai calls %d'%p.evaluate("__aiCalls.length"))
        log('DBG ' + str(p.evaluate("() => { var j=Object.values(D.jobs).find(x=>x.ref==='LJ-1001'); var d=draftOf(j), out=[]; d.rooms.forEach(function(rm){ rm.items.forEach(function(it){ var n=evFor({jobId:j.id,item:it.id}).length; if(!it.source) out.push(rm.name+'/'+it.name+':'+n); }); }); return out; }")))
        shot(p,'30-ai-drafts')
        # room suggest on bedroom 1
        p.locator('input[data-up*="\\"item\\":\\"room\\""]').nth(2).set_input_files(IMG); W(500); p.locator('[data-act=ai-room]').first.click(); W(800)
        # meters
        p.locator('input[data-up*="\\"ai\\":\\"meter\\""]').nth(0).set_input_files(IMG); W(800)
        p.fill('#mt-1-reading','515127'); p.locator('input[data-mna="2"]').check(); W()
        p.select_option('#al-0-r', index=2); p.fill('#al-0-l','Living Room'); p.fill('#al-1-l','Entrance & Hallway'); p.select_option('#al-2-r', index=1); p.fill('#al-2-l','Kitchen'); W(900)
        p.evaluate("() => { var j=Object.values(D.jobs).find(x=>x.ref==='LJ-1001'); var d=draftOf(j); d.schedule.forEach(function(r,i){ if(i>0) r.value = SCHED_OPTS[r.kind][r.kind==='clean'?1:r.kind==='ext'?0:2]; }); d.schedule[2].note='Toilet requires further cleaning most importantly'; saveDraft(j.id); render(); }"); W()
        p.locator('input[data-up*="\\"ai\\":\\"keys\\""]').first.set_input_files(IMG); W(800)
        p.locator('[data-act=ai-summary]').click(); W(800)
        # try submit before vetting
        up('input[data-up*="clock-out"]'); p.locator('form[data-form=clock-out] button[type=submit]').click(); W()
        p.locator('[data-act=submit-report]').click(); W(); log('blocked toast: ' + p.locator('#toast').inner_text())
        # edit one AI desc and vet everything
        p.locator('textarea[id^="d-"]').first.fill('Timber front door with blue exterior, white interior, two obscure glass panels.'); W(900)
        cnt=0
        while p.locator('[data-act=vet]').count() and cnt<200:
            p.locator('[data-act=vet]').first.click(); p.wait_for_timeout(60); cnt+=1
        log('vetted %d'%cnt); W(900); shot(p,'31-vetted')
        btn('Submit report'); log('insp submitted '+str(state('LJ-1001')) + ' toast: ' + p.locator('#toast').inner_text())
        role('admin'); openref('LJ-1001'); btn('Release to client')
        role('client'); openref('LJ-1001'); shot(p,'32-client-insp')
        with p.expect_download(timeout=120000) as dl: p.locator('[data-act=dl-report]').first.click()
        path=B+'shots/report.pdf'; dl.value.save_as(path); log('downloaded ' + dl.value.suggested_filename)
    except Exception as ex:
        print('FAIL', ex); shot(p,'zz-fail')
    print('ERRORS', errs)
    br.close()
