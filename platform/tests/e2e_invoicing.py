"""Admin Create invoice: new repair invoice and invoice for an existing repair request."""
from playwright.sync_api import sync_playwright
def opt(p, sel, val):
    if p.locator(sel).count(): p.fill(sel, val)
def optc(p, sel):
    if p.locator(sel).count(): p.check(sel)
import os
HERE=os.path.dirname(os.path.abspath(__file__))
APP='file://'+os.path.join(HERE,'..','dist','listd-platform.html')
SP=os.path.join(HERE,'out','shots')+'/'
os.makedirs(SP,exist_ok=True)
with sync_playwright() as pw:
    br=pw.chromium.launch(); p=br.new_page(viewport={'width':1280,'height':900}); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)))
    W=lambda ms=250: p.wait_for_timeout(ms)
    p.goto(APP); W(500)
    p.click('[data-act=role][data-r=admin]'); W()
    opt(p, '#au-name', 'Ops'); p.fill('#au-email','o@l.t'); p.fill('#au-password','Admin2026!'); opt(p, '#au-confirm', 'Admin2026!')
    p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1200)
    p.fill('#au-code', p.evaluate("() => totp(S.auth.secret)")); p.click('form[data-form=auth-mfa-setup] button[type=submit]'); W(900)
    p.evaluate("""() => { setDoc('clients','c1',{name:'Ada Okafor',orgName:'Okafor Lettings',segment:'LANDLORD',onboarding:{status:'DONE',step:5},createdAt:now()});
      setDoc('properties','p1',{clientId:'c1',label:'12 Kings Road',address:'12 Kings Road, Bath',postcode:'BA1 1AA',bedrooms:2,bathrooms:1,active:true,createdAt:now()});
      setDoc('jobs','j1',{ref:'LJ-1010',clientId:'c1',propertyId:'p1',type:'MAINTENANCE',kind:'REPAIRS_DAMAGES',status:'SUBMITTED',scope:{category:'Plumbing',location:'Bathroom',description:'Leak under basin',severity:'high'},propSnapshot:{label:'12 Kings Road',postcode:'BA1 1AA',bedrooms:2},window:{date:'',slot:'morning'},quotes:[],payments:[],history:[],createdAt:now()}); }""")
    p.click('.a-side [data-go=invoicing]'); W()
    # 1: new repair invoice from header button
    p.click('.a-head [data-act=inv-new]'); W()
    p.select_option('#inv-c','c1'); W()
    print('requests offered:', p.locator('#inv-j option').count())
    p.select_option('#inv-p','p1'); p.select_option('#inv-cat','Electrical'); p.fill('#inv-loc','Hallway'); p.fill('#inv-desc','Scorched socket, replace and test circuit')
    p.fill('#inv-ld-0','Labour: replace double socket'); p.fill('#inv-lq-0','1.5'); p.fill('#inv-lu-0','40')
    p.fill('#inv-ld-1','Materials: socket and back box'); p.fill('#inv-lu-1','18.50')
    p.click('[data-act=inv-add]'); W(); p.fill('#inv-ld-2','Call-out'); p.fill('#inv-lu-2','25')
    p.fill('#inv-tax','10'); p.fill('#inv-disc','5'); p.fill('#inv-due','5'); W(100)
    print('totals:', p.locator('#inv-sub').text_content(), p.locator('#inv-total').text_content(), 'line0', p.locator('#inv-lt-0').text_content())
    p.screenshot(path=SP+'inv-modal.png', full_page=False)
    p.locator('form[data-form=inv-create] button[type=submit]').click(); W()
    print('toast:', p.locator('#toast').text_content(), 'modal:', p.locator('.a-modal').count())
    print(p.evaluate("() => { var j = Object.values(D.jobs).find(x => x.createdByAdmin); var q = j.quotes[0]; return [j.ref, j.status, q.totalP, q.proFeeP, Math.round(hoursFrom(q.expiresAt)/24), j.scope.category]; }"))
    # 2: from waiting row, link to existing request
    p.locator('.a-main button[data-act=inv-new][data-j]').click(); W()
    print('preselected:', p.input_value('#inv-c'), p.input_value('#inv-j'), 'subcard:', p.locator('.a-modal .a-subcard').count())
    p.fill('#inv-ld-0','Labour: replace basin waste'); p.fill('#inv-lu-0','60'); p.fill('#inv-ld-1','Materials'); p.fill('#inv-lu-1','12')
    p.locator('.a-modal [data-act=inv-rm][data-i="0"]').click(); W()
    print('after remove line0 desc:', p.input_value('#inv-ld-0'), 'rows', p.locator('.a-modal tbody tr').count(), p.locator('#inv-total').text_content())
    p.locator('form[data-form=inv-create] button[type=submit]').click(); W()
    print(p.evaluate("() => [D.jobs.j1.status, D.jobs.j1.quotes[0].totalP]"), 'waiting:', p.evaluate('toInvoice().length'))
    p.screenshot(path=SP+'inv-list.png', full_page=True)
    ok = p.evaluate("() => { var j = Object.values(D.jobs).find(x => x.createdByAdmin); return j.quotes[0].totalP === 10850 && D.jobs.j1.quotes[0].totalP === 1200 && toInvoice().length === 0; }")
    print('RESULT', 'PASS' if ok and not errs else 'FAIL', errs)
