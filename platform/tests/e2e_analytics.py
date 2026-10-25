"""Admin Analytics: contribution bridge, driver tree, levers ranked by impact, funnel, service mix, trend, access."""
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
    p.goto(APP); W(600); p.click('[data-act=role][data-r=admin]'); W()
    if p.locator('#au-name').count(): p.fill('#au-name', 'Ops')
    p.fill('#au-email', 'o@l.t'); p.fill('#au-password', 'Admin2026!')
    if p.locator('#au-confirm').count(): p.fill('#au-confirm', 'Admin2026!')
    p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1500)
    p.evaluate("go('analytics')"); W()
    check('No paid jobs' in p.locator('.a-main').inner_text(), 'empty state before any paid jobs')
    m = p.evaluate("""() => {
      setDoc('clients', 'c1', { name: 'Ada', orgName: 'Okafor Lettings', segment: 'LANDLORD', onboarding: { status: 'DONE', step: 5 }, createdAt: now() });
      setDoc('pros', 'p1', { name: 'Sam R.', status: 'APPROVED', coverage: ['BS'], skills: [], level: 4, createdAt: now() }); setDoc('pros', 'p2', { name: 'Amara K.', status: 'APPROVED', coverage: ['BA'], skills: [], level: 3, createdAt: now() });
      setDoc('clients', 'c2', { name: 'Ben', segment: 'ESTATE_AGENT', onboarding: { status: 'DONE', step: 5 }, createdAt: now() });
      var DIST = { j1: 'BS6', j2: 'BS8', j3: 'BA1', j4: 'BS6', j5: 'SN1', j6: 'BS3', j7: 'B1', j8: 'BS6' };
      var mk = (id, type, kind, c, sub, fee, st, extra) => { var q = { v: 1, lines: [{ d: 'Service', q: 1, u: sub, tag: 'svc' }], subP: sub, totalP: sub, taxP: 0, proFeeP: fee, durationMin: 90, status: st === 'REJ' ? 'REJECTED' : st === 'ISS' ? 'ISSUED' : 'ACCEPTED', issuedAt: now(), acceptedAt: now(), expiresAt: addH(now(), 100), reason: st === 'REJ' ? 'Too expensive' : '' };
        var paid = ['PAID', 'DONE', 'REF'].indexOf(st) >= 0; setDoc('jobs', id, Object.assign({ ref: id, district: DIST[id], clientId: c, propertyId: 'p', type: type, kind: kind, scope: {}, window: {}, status: st === 'DONE' ? 'COMPLETED' : st === 'REF' ? 'CANCELLED' : paid ? 'READY_FOR_ASSIGNMENT' : st === 'REJ' || st === 'ISS' ? 'SUBMITTED' : 'SUBMITTED', quotes: st === 'NONE' ? [] : [q], payments: paid ? [{ status: 'SUCCEEDED', amountP: sub, at: now() }] : [], refunds: st === 'REF' ? [{ amountP: sub, at: now() }] : [], agreedFeeP: fee, createdAt: now(), history: [] }, extra || {})); };
      mk('j1', 'INVENTORY', null, 'c1', 12000, 5500, 'DONE'); mk('j2', 'CHECK_OUT', null, 'c1', 11000, 4800, 'DONE'); mk('j3', 'CHECK_IN', null, 'c2', 6500, 2500, 'DONE');
      mk('j4', 'MAINTENANCE', 'CLEANING', 'c2', 17500, 11000, 'PAID'); mk('j5', 'MAINTENANCE', 'REPAIRS_DAMAGES', 'c1', 9000, 6000, 'REF');
      mk('j6', 'INVENTORY', null, 'c2', 14000, 6500, 'REJ'); mk('j7', 'CHECK_OUT', null, 'c1', 13000, 5000, 'ISS'); mk('j8', 'MID_TERM', null, 'c2', 7500, 3000, 'NONE');
      var dsp = (st) => ({ id: uid(), category: 'Damage disputed', status: st, at: now(), closedAt: st === 'RESOLVED' ? now() : null, outcome: st === 'RESOLVED' ? 'PARTIAL_REFUND' : null, refundP: st === 'RESOLVED' ? 2000 : 0, responses: [] });
      D.jobs.j1.disputes = [dsp('RESOLVED')]; D.jobs.j2.disputes = [dsp('RESOLVED')]; D.jobs.j3.disputes = [dsp('OPEN')];
      Object.assign(D.jobs.j1, { proId: 'p1', scheduledAt: now(), window: { date: isoDay(new Date()), slot: 'morning' }, offers: [{ proId: 'p1', status: 'ACCEPTED', at: now() }], rating: { score: 5 } });
      Object.assign(D.jobs.j2, { proId: 'p1', scheduledAt: now(), offers: [{ proId: 'p1', status: 'ACCEPTED', at: now() }] });
      Object.assign(D.jobs.j3, { proId: 'p2', scheduledAt: now(), offers: [{ proId: 'p2', status: 'DECLINED', at: now() }, { proId: 'p2', status: 'ACCEPTED', at: now() }] });
      Object.assign(D.jobs.j4, { proId: 'p2', scheduledAt: now() });
      var x = anModel('d90'); return { C: x.C, paid: x.paid, net: x.net, d: x.d, top: anLevers(x).map(l => l.k), recon: Math.round(anContrib(x.d)) }; }""")
    check(m['paid'] == 5 and m['net'] == 12000 + 11000 + 6500 + 17500, 'paid jobs and net revenue after refunds: ' + str(m['net']))
    check(abs(m['recon'] - m['C']) <= 2, 'driver formula reproduces contribution (%s vs %s)' % (m['recon'], m['C']))
    check(len(m['top']) == 9, 'all nine drivers ranked: ' + ', '.join(m['top']))
    p.evaluate("render()"); W(500)
    t = p.locator('.a-main').inner_text()
    check('Biggest levers' not in t and 'How the drivers combine' in t and 'Booking funnel' in t and 'Contribution by service' in t, 'analytics sections render')
    pv = p.evaluate("() => { var h = [...document.querySelectorAll('.an-chart')].find(e => /Paid jobs by outcome/.test(e.innerText)); return h ? h.innerText : ''; }")
    check('60%' in pv and 'Completed' in pv and 'Paid, then cancelled' in pv, 'paid vs completed donut: 3 of 5 paid jobs completed')
    check(p.locator('svg.an-cols').count() == 4, 'paid and completed by month bar chart')
    t3 = p.locator('.a-main').inner_text()
    check('Disputes' in t3 and 'Raised vs settled' in t3 and '67%' in p.evaluate("() => [...document.querySelectorAll('.an-chart')].find(e => /Raised vs settled/.test(e.innerText)).innerText"), 'disputes: 3 raised, 2 settled (67%)')
    iv = p.evaluate("() => { var e = [...document.querySelectorAll('.an-chart')].find(e => /Paid vs unpaid invoices by month/.test(e.innerText)); return e ? [e.innerText, e.querySelectorAll('rect').length, e.querySelector('text.tl') ? e.querySelector('text.tl').textContent : ''] : ['', 0, ''] }")
    check('Unpaid' in iv[0] and iv[1] >= 1 and 'paid' in iv[2], 'paid vs unpaid invoices by month: bars in £ with % paid: ' + iv[2])
    pr = p.evaluate("() => [...document.querySelectorAll('.a-sec')].find(e => /Pro performance/.test(e.innerText)).innerText")
    check('Sam R.' in pr and 'Amara K.' in pr and 'Productivity rate' in pr and 'completion rate' in pr.lower() and 'Completed jobs by Pro' not in pr and 'CORRECTIONS' not in pr.upper(), 'Pro performance: tiles and productivity chart, no per-Pro chart or table')
    check(p.locator('.an-donut svg').count() == 5 and p.locator('.an-donut path').count() >= 5, 'three pie charts render')
    check(p.locator('svg.an-cols').count() == 4 and p.locator('svg.an-cols rect').count() >= 6, 'two bar charts render')
    mp = p.evaluate("() => [document.querySelectorAll('.an-map .pt').length, document.querySelectorAll('.an-map .pt.gap').length, /no Pro cover/.test(document.querySelector('.an-loc').innerText)]")
    check(mp[0] == 6 and mp[1] == 2 and mp[2], 'map shows 6 districts and flags 2 without Pro cover: ' + str(mp))
    p.select_option('#an-zoom', 'core'); W(400); check(p.locator('.an-map .pt').count() == 4, 'map zooms to Bristol & Bath'); p.locator('.an-loc').screenshot(path=OUT + 'an3-map.png'); p.select_option('#an-zoom', 'all'); W(300)
    check(p.locator('.an-levers').count() == 0, 'Biggest levers section removed')
    vals = p.evaluate("() => anLevers(anModel('d90')).map(l => l.gain)"); check(vals == sorted(vals, reverse=True), 'levers sorted by contribution gained')
    check(p.locator('.an-node .rk').count() == 9, 'every driver in the tree carries its impact rank')
    p.screenshot(path=OUT + 'an1-desktop.png', full_page=True)
    p.select_option('#an-per', 'all'); W(); check(p.evaluate("S.anPer") == 'all', 'period filter works')
    ro = p.evaluate("() => { var mm = myStaff(); D.staff[mm.id] = Object.assign({}, mm, { role: 'OPS' }); go('analytics'); var r = /don’t have access/.test(document.querySelector('.a-main').innerText); D.staff[mm.id] = Object.assign({}, D.staff[mm.id], { role: 'MAIN' }); render(); return r; }")
    check(ro, 'Operations staff cannot open Analytics')
    p.set_viewport_size({'width': 390, 'height': 900}); p.evaluate("go('analytics')"); W(400)
    check(p.evaluate("document.documentElement.scrollWidth") <= 392, 'Analytics fits a phone'); p.screenshot(path=OUT + 'an2-mobile.png', full_page=True)
    print('FAILS', [m for ok, m in res if not ok]); print('ERRORS', errs); br.close()
