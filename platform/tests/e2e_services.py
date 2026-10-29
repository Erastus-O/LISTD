"""Six services and multi-select booking: a client picks several services at once -> one linked request per
service, each with only its own details; baselines for mid-term/check-out; Pro eligibility by skill and level."""
import os, datetime
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
APP = 'file://' + os.path.join(HERE, '..', 'dist', 'listd-platform.html')
OUT = os.path.join(HERE, 'out', 'shots') + '/'; os.makedirs(OUT, exist_ok=True)
D1 = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()
res = []; errs = []
def check(ok, m): res.append((ok, m)); print(('PASS ' if ok else 'FAIL ') + m, flush=True)
with sync_playwright() as pw:
    br = pw.chromium.launch(); p = br.new_page(viewport={'width': 1280, 'height': 900})
    p.on('pageerror', lambda e: errs.append(str(e)))
    W = lambda ms=300: p.wait_for_timeout(ms)
    def btn(t): p.locator('.a-main button:has-text("%s")' % t).first.click(); W()
    def submit(): p.locator('.a-main form[data-form=wiz] button[type=submit]').click(); W()
    p.goto(APP); W(600)
    p.click('[data-act=auth-mode][data-m=signup]'); W(); p.fill('#au-name', 'Ada Okafor'); p.fill('#au-email', 'ada@example.test'); p.fill('#au-password', 'Listd2026!'); p.fill('#au-confirm', 'Listd2026!'); p.check('input[name=terms]')
    p.click('form[data-form=auth-signup] button[type=submit]'); W(1500)
    p.click('label.a-opt:has(input[value=LANDLORD])'); p.check('input[name=authority]'); btn('Continue')
    p.fill('#ob-ph', '07700 900000'); btn('Save & continue'); p.fill('#ob-ba', '1 Test Road'); p.fill('#ob-bc', 'Bath'); p.fill('#ob-bp', 'ba1 1aa'); btn('Save & continue')
    p.fill('#p-lbl', 'Pulteney Flat 3'); p.fill('#p-addr', 'Flat 3, 22 Pulteney Street, Bath'); p.fill('#p-pc', 'ba2 4ds'); p.fill('#p-bed', '2'); p.select_option('#p-furn', 'furnished'); p.fill('#p-acode', 'Key safe 4821'); p.fill('#p-cn', 'Jo Tenant'); p.fill('#p-cp', '07700 900001'); btn('Save property'); btn('Finish setup')
    p.evaluate("go('new')"); W(); submit()
    labels = p.locator('.a-multi .a-opt b').all_inner_texts()
    check(labels == ['Inventory', 'Check-In', 'Mid-Term', 'Check-Out', 'Repairs & Maintenance', 'Cleaning'], 'six services offered in order: ' + ', '.join(labels))
    for k in ['INVENTORY', 'MID_TERM', 'REPAIRS_DAMAGES', 'CLEANING']: p.click('label.a-opt:has(input[value=%s])' % k)
    check(p.locator('#w-svc-count').inner_text() == '4 selected', 'selection count updates')
    p.screenshot(path=OUT + 'sv1-services.png', full_page=True)
    submit()
    check(p.locator('.a-wsec').count() == 3, 'details step shows inspections, cleaning and repairs sections')
    p.fill('#w-keys', '1 set in key safe'); p.fill('#w-occ', 'Jo Tenant'); p.click('label.a-opt:has(input[name=clean][value=deep])'); p.fill('#w-loc', 'Bathroom'); p.fill('#w-desc', 'Cracked basin, leaking'); p.screenshot(path=OUT + 'sv2-details.png', full_page=True)
    submit(); p.fill('#w-nop', 'Will show the Pro on site'); submit()
    p.fill('#w-date', D1); p.fill('#w-sn', 'Inventory and deep clean before move-in'); submit(); p.screenshot(path=OUT + 'sv3-review.png', full_page=True)
    check('Book 4 services' in p.locator('form[data-form=wiz] button[type=submit]').inner_text(), 'review offers to book 4 services')
    submit(); W(600)
    jobs = p.evaluate("() => Object.values(D.jobs).sort((a,b)=>a.ref.localeCompare(b.ref)).map(j => [svcKey(j), j.groupId, Object.keys(j.scope).sort().join(',')])")
    check(len(jobs) == 4 and len(set(j[1] for j in jobs)) == 1 and jobs[0][1], 'four linked requests share one booking: ' + str([j[0] for j in jobs]))
    sc = {j[0]: j[2] for j in jobs}
    check('description' in sc['REPAIRS_DAMAGES'] and 'clean' not in sc['REPAIRS_DAMAGES'] and 'clean' in sc['CLEANING'] and 'description' not in sc['CLEANING'] and 'rooms' in sc['INVENTORY'] and 'clean' not in sc['INVENTORY'], 'each request keeps only its own details')
    check(p.evaluate("() => Object.values(D.jobs).every(j => j.scope.schedNote)"), 'timing note on every request')
    check(p.evaluate("() => S.view") == 'jobs', 'client lands on their requests list')
    p.evaluate("() => go('job', { id: Object.values(D.jobs).find(j => svcKey(j) === 'CLEANING').id })"); W()
    check(p.locator('.a-grpchip').count() == 3, 'job page shows the other services booked together'); p.screenshot(path=OUT + 'sv4-job.png', full_page=True)
    # rules
    r = p.evaluate("""() => {
      var inv = Object.values(D.jobs).find(j => j.type === 'INVENTORY'), mt = Object.values(D.jobs).find(j => j.type === 'MID_TERM');
      var pro = { id: 'pz', status: 'APPROVED', skills: ['INVENTORY', 'MID_TERM'], coverage: ['BA'], levels: { CLERK: 1 }, docs: [] };
      var big = Object.assign({}, inv, { propSnapshot: Object.assign({}, inv.propSnapshot, { bedrooms: 5 }) });
      var a = String(eligible(pro, big, null)); pro.levels.CLERK = 3; var b = eligible(pro, big, null); pro.skills = ['CHECK_IN']; var c = String(eligible(pro, mt, null));
      return [requiredLevel(inv), requiredLevel(big), a, b, c, guideLines(inv)[0].d, isInspK('MID_TERM'), comparesK('MID_TERM'), signoffK('CHECK_IN'), signoffK('MID_TERM')]; }""")
    check(r[0] == 1 and r[1] == 3, 'inspections need a Pro Clerk level by property size')
    check('Needs Pro Clerk · Level 3' in r[2] and r[3] is True and 'Missing' in r[4], 'eligibility checks role level and the new skills')
    check(r[5].startswith('Inventory & Condition · 2 bedrooms'), 'rate card line for inventory: ' + r[5])
    check(r[6:] == [True, True, True, False], 'mid-term compares with baseline; check-in and check-out have sign-off')
    # baseline: released inventory becomes the check-out / mid-term baseline
    b = p.evaluate("""() => { var inv = Object.values(D.jobs).find(j => j.type === 'INVENTORY'); D.jobs[inv.id].reports = [{ v: 1, status: 'RELEASED', sections: { v3: true, rooms: [] } }];
      var x = findBaseline(inv.propertyId, null, 'CHECK_OUT'), y = findBaseline(inv.propertyId, null, 'CHECK_IN'), z = findBaseline(inv.propertyId, null, 'MID_TERM'); return [x && x.ref, y && y.ref, z && z.ref, inv.ref]; }""")
    check(b[0] == b[3] and b[1] == b[3] and b[2] == b[3], 'released inventory is the baseline for check-in, mid-term and check-out')
    # pro onboarding shows the six skills
    print('FAILS', [m for ok, m in res if not ok]); print('ERRORS', errs); br.close()
