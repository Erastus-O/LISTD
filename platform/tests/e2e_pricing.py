"""Pilot pricing: rate card, one furnishing adjustment, same-visit Inventory + Check-in, scheduling options,
instant fixed quotes, cleaning estimates, repair diagnosis with credit, workload Pro fees, contribution floor,
portfolio rebates and the Admin Pricing page."""
import os, datetime
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
    def btn(t): p.locator('.a-main button:has-text("%s")' % t).first.click(); W()
    def submit(): p.locator('.a-main form[data-form=wiz] button[type=submit]').click(); W()
    p.goto(APP); W(600)
    # ---- engine maths (Standard, unfurnished unless stated) ----
    r = p.evaluate("""() => {
      var T = (k, beds, furn, o) => { var x = priceInspection(k, { bedrooms: beds, bathrooms: 1, furnishing: furn || 'unfurnished' }, o); return x.custom ? 'custom' : x.lines.reduce((a, l) => a + l.q * l.u, 0) / 100; };
      return {
        inv: [0,1,2,3,4].map(b => T('INVENTORY', b)), ci: [0,1,2,3,4].map(b => T('CHECK_IN', b)), co: [0,1,2,3,4].map(b => T('CHECK_OUT', b)),
        combo2: T('INVENTORY', 2, 'unfurnished', { combo: 'INVENTORY' }) + T('CHECK_IN', 2, 'unfurnished', { combo: 'CHECK_IN' }),
        comboF2: T('INVENTORY', 2, 'furnished', { combo: 'INVENTORY' }) + T('CHECK_IN', 2, 'furnished', { combo: 'CHECK_IN' }),
        comboF2P: T('INVENTORY', 2, 'furnished', { combo: 'INVENTORY', sched: 'priority' }) + T('CHECK_IN', 2, 'furnished', { combo: 'CHECK_IN', sched: 'priority' }),
        part1: T('INVENTORY', 1, 'part'), furn3: T('CHECK_OUT', 3, 'furnished'), flex2: T('CHECK_OUT', 2, 'unfurnished', { sched: 'flex' }),
        five: T('INVENTORY', 5), heavy: T('INVENTORY', 2, 'heavy'), bigArea: priceInspection('INVENTORY', { bedrooms: 2, area: 300 }).custom ? 'custom' : 'priced',
        extra: T('INVENTORY', 2, 'unfurnished') !== undefined && priceInspection('INVENTORY', { bedrooms: 2, bathrooms: 2, kitchens: 1, receptions: 1, furnishing: 'unfurnished' }).lines.reduce((a, l) => a + l.q * l.u, 0) / 100,
        fee2: feeFromBase(priceInspection('INVENTORY', { bedrooms: 2, furnishing: 'unfurnished' }).proBase, 4) / 100,
        c120: contribution(12000, 5500), floor: contribution(6000, 2500).floorP / 100,
        days: [workDaysUntil(addWorkDays('2026-10-23', 2), '2026-10-23'), addWorkDays('2026-10-23', 1)],
        clean: (() => { var x = priceCleaning({ bedrooms: 2, bathrooms: 1 }, { clean: 'eot', condition: 'vacant-tidy' }); return [x.hours, x.estLowP / 100, x.estHighP / 100]; })(),
        incl: cleanIncl('deep').join(','), diag: priceDiagnosis().lines[0].u / 100 }; }""")
    check(r['inv'] == [85, 100, 120, 140, 160], 'Inventory & Condition rate card ' + str(r['inv']))
    check(r['ci'] == [60, 60, 65, 70, 75], 'standalone check-in rate card ' + str(r['ci']))
    check(r['co'] == [75, 90, 110, 130, 150], 'check-out rate card ' + str(r['co']))
    check(r['combo2'] == 145, 'Inventory + Check-in same visit, 2 bed = £145 (got %s)' % r['combo2'])
    check(r['comboF2'] == 165 and r['comboF2P'] == 195, 'worked example: furnished £165, Priority £195 (got %s, %s)' % (r['comboF2'], r['comboF2P']))
    check(r['part1'] == 110 and r['furn3'] == 160 and r['flex2'] == 110, 'part-furnished +£10, furnished 3-bed +£30, no Flex discount any more')
    check(r['five'] == 'custom' and r['heavy'] == 'custom' and r['bigArea'] == 'custom', '5+ bedrooms, heavily furnished and unusual floor areas go to a custom quote')
    check(r['extra'] == 140, 'extra bathroom and reception room add £10 each (got %s)' % r['extra'])
    check(r['fee2'] == 55, 'Pro fee from workload: 2-bed inventory £55 (got %s)' % r['fee2'])
    check(r['c120']['contribP'] >= r['c120']['floorP'] and r['floor'] == 25, 'contribution floor: £25 or 25%, whichever is higher')
    check(r['days'] == [2, '2026-10-26'], 'working days skip weekends')
    check(r['clean'][0] == 6.5 and r['clean'][1] < r['clean'][2], 'cleaning estimate from cleaner-hours ' + str(r['clean']))
    check(r['incl'] == 'oven,fridge,cupboards' and r['diag'] == 50, 'deep clean inclusions stated; £50 diagnostic visit')
    # ---- client books Inventory + Check-in (same visit), Priority, furnished 2 bed ----
    p.click('[data-act=auth-mode][data-m=signup]'); W(); p.fill('#au-name', 'Ada Okafor'); p.fill('#au-email', 'ada@example.test'); p.fill('#au-password', 'Listd2026!'); p.fill('#au-confirm', 'Listd2026!'); p.check('input[name=terms]')
    p.click('form[data-form=auth-signup] button[type=submit]'); W(1500)
    p.click('label.a-opt:has(input[value=LANDLORD])'); p.check('input[name=authority]'); btn('Continue')
    p.fill('#ob-ph', '07700 900000'); btn('Save & continue'); p.fill('#ob-ba', '1 Test Road'); p.fill('#ob-bc', 'Bristol'); p.fill('#ob-bp', 'bs6 1aa'); btn('Save & continue')
    p.fill('#p-lbl', 'Redland Flat'); p.fill('#p-addr', '4 Redland Road, Bristol'); p.fill('#p-pc', 'bs6 6ab'); p.fill('#p-bed', '2'); p.select_option('#p-furn', 'furnished'); p.fill('#p-acode', 'Key safe 1234'); p.fill('#p-cn', 'Jo Tenant'); p.fill('#p-cp', '07700 900001'); btn('Save property'); btn('Finish setup')
    p.evaluate("go('new')"); W()
    check(p.input_value('#w-bed') == '2' and p.input_value('#w-bath') == '1' and p.input_value('#w-kit') == '1' and p.input_value('#w-rec') == '0', 'room counts prefilled from the property')
    p.fill('#w-bath', '2'); submit()
    check(p.evaluate("() => D.properties[S.wiz.propertyId].bathrooms") == 2, 'room counts saved to the property')
    p.evaluate("() => { S.wiz.step = 1; render(); }"); W()
    check(p.input_value('#w-frn') == '3' and p.input_value('#w-unf') == '0', 'furnished and unfurnished room counts prefilled (3 of 3 furnished)')
    p.fill('#w-frn', '1'); p.dispatch_event('#w-frn', 'change'); W(200)
    check(p.input_value('#w-unf') == '2', 'unfurnished count follows the furnished count')
    p.fill('#w-bath', '1'); submit()
    check(p.evaluate("() => wizProp(S.wiz).furnishing") == 'part', '1 of 3 rooms furnished counts as part-furnished')
    p.evaluate("() => { S.wiz.step = 1; render(); }"); W(); p.evaluate("() => { document.getElementById('w-frn').value = 1; document.getElementById('w-unf').value = 1; }"); p.evaluate("() => document.querySelector('form[data-form]').requestSubmit()"); W(200)
    check(p.evaluate("S.wiz.step") == 1, 'counts that don’t add up are refused')
    p.fill('#w-frn', '3'); p.fill('#w-unf', '0'); submit()
    for k in ['INVENTORY', 'CHECK_IN']: p.click('label.a-opt:has(input[value=%s])' % k)
    submit(); p.fill('#w-keys', '2 sets'); p.fill('#w-occ', 'Jo Tenant'); submit(); submit()
    check(p.locator('input[name=sched]').count() == 0, 'no manual scheduling choice: the date decides')
    p.fill('#w-date', p.evaluate("() => addWorkDays(isoDay(new Date()), 4)")); p.dispatch_event('#w-date', 'change'); W()
    check('Standard booking' in p.locator('.a-main').inner_text(), 'a date more than 2 working days away is Standard')
    pd = p.evaluate("() => addWorkDays(isoDay(new Date()), 2)"); p.fill('#w-date', pd); p.dispatch_event('#w-date', 'change'); W()
    check('Priority booking' in p.locator('.a-main').inner_text(), 'a date within 2 working days becomes Priority automatically')
    check(p.locator('input[name=sameVisit]').is_checked(), 'same visit offered for inventory + check-in')
    p.screenshot(path=OUT + 'pr1-schedule.png', full_page=True); submit()
    txt = p.locator('.a-pv').inner_text(); p.screenshot(path=OUT + 'pr2-review.png', full_page=True)
    check('£195.00' in txt, 'review shows one visible total of £195 for the furnished Priority visit')
    submit(); W(600)
    js = p.evaluate("() => Object.values(D.jobs).map(j => [j.type, j.status, (curQuote(j) || {}).totalP, !!j.scope.sameVisit, j.scope.sched])")
    check(all(j[1] == 'QUOTED' for j in js) and sum(j[2] for j in js) == 19500 and all(j[3] for j in js), 'fixed quotes issued instantly, totalling £195: ' + str(js))
    check(p.evaluate("() => schedWindowOk('flex', ['2030-01-07','2030-01-08','2030-01-09'])") != True, 'Flex is refused if requested directly')
    # ---- end to end: one checkout for the booking, positive same-visit lines, Pro fee breakdown ----
    ln = p.evaluate("() => Object.values(D.jobs).map(j => curQuote(j).lines.map(l => l.q * l.u))")
    check(all(v > 0 for l in ln for v in l), 'same-visit quotes use positive lines only (no discount line): ' + str(ln))
    p.evaluate("() => go('job', { id: Object.values(D.jobs)[0].id })"); W()
    check(p.locator('[data-act=grp-pay]').count() == 1 and 'Booked together: £195.00' in p.locator('.a-main').inner_text(), 'client sees one £195 checkout for the booking')
    p.locator('[data-act=grp-pay]').click(); W()
    check(p.evaluate("() => Object.values(D.jobs).map(j => [j.status, paidP(j)])") == [['READY_FOR_ASSIGNMENT', 13000], ['READY_FOR_ASSIGNMENT', 6500]], 'one click accepts and pays both quotes (£130 + £65)')
    check(p.evaluate("() => Object.values(D.jobs).map(j => proFeeP(j) % 50)") == [0, 0], 'Pro fees are rounded to 50p')
    parts = p.evaluate("() => { var j = Object.values(D.jobs).find(x => x.type === 'INVENTORY'), b = acceptedQuote(j).proBase; return [feeParts(b, 4).map(x => x[0].split(' (')[0].split(':')[0]), feeParts(b, 4).reduce((a, x) => a + x[1], 0), feeFromBase(b, 4)]; }")
    check(parts[0] == ['Attendance allowance', 'Expected time', 'Furnishing allowance', 'Priority allowance'] and parts[1] == parts[2] == 8500, 'Pro fee breakdown adds up: ' + str(parts))
    # ---- cleaning estimate + diagnosis ----
    p.evaluate("go('new')"); W(); submit(); p.click('label.a-opt:has(input[value=CLEANING])'); p.click('label.a-opt:has(input[value=REPAIRS_DAMAGES])'); submit()
    p.click('label.a-opt:has(input[name=clean][value=eot])'); W(); p.check('input[name=addons][value=carpets]'); W(); p.fill('#w-crp', '2')
    p.fill('#w-loc', 'Kitchen'); p.fill('#w-desc', 'Tap drips, not sure why'); p.click('label.a-opt:has(input[name=repairMode][value=diagnose])')
    submit(); p.fill('#w-nop', 'Will show on site'); submit(); p.fill('#w-date', p.evaluate("() => addWorkDays(isoDay(new Date()), 3)")); submit()
    txt3 = p.locator('.a-pv').inner_text()
    check('Estimate £' in txt3 and '£50.00 diagnostic visit' in txt3, 'cleaning shows an estimate; repair shows the £50 diagnostic visit')
    submit(); W(500)
    st = p.evaluate("() => Object.values(D.jobs).filter(j => j.type === 'MAINTENANCE').map(j => [j.kind, j.status, (curQuote(j) || {}).totalP || 0])")
    check(sorted(st) == sorted([['CLEANING', 'SUBMITTED', 0], ['REPAIRS_DAMAGES', 'QUOTED', 5000]]), 'cleaning waits for a fixed quote; diagnosis invoice issued: ' + str(st))
    # ---- diagnosis credit on the repair change order ----
    cr = p.evaluate("""() => { var j = Object.values(D.jobs).find(x => x.kind === 'REPAIRS_DAMAGES'); S.role = 'client'; cmdAcceptQuote(D.jobs[j.id]); cmdPay(D.jobs[j.id]);
      j = D.jobs[j.id]; D.jobs[j.id].changeOrders = [{ id: 'co1', desc: 'Replace tap cartridge', estimateP: 9000, status: 'PROPOSED', at: now() }]; S.role = 'admin';
      cmdIssueCO(D.jobs[j.id], 'co1', 9000, 5000); var c = D.jobs[j.id].changeOrders[0]; return [c.grossP, c.creditP, c.totalP]; }""")
    check(cr == [9000, 5000, 4000], 'diagnosis fee credited against the repair: ' + str(cr))
    # ---- portfolio rebate ----
    pf = p.evaluate("""() => { var c = Object.values(D.clients)[0], base = Object.values(D.jobs).find(j => j.type === 'INVENTORY');
      for (var i = 0; i < 10; i++) { var q = { v: 1, lines: [{ d: 'Check-out · 2 bedrooms', q: 1, u: 11000, tag: 'svc' }, { d: 'Priority appointment', q: 1, u: 3000, tag: 'urgency' }], subP: 14000, totalP: 14000, proFeeP: 6000, status: 'ACCEPTED' };
        setDoc('jobs', 'pf' + i, Object.assign({}, base, { id: 'pf' + i, ref: 'PF' + i, status: 'COMPLETED', completedAt: now(), quotes: [q], payments: [{ status: 'SUCCEEDED', amountP: 14000 }], proId: null, agreedFeeP: 6000 })); }
      var x = portfolio(c.id); return [x.count, x.tier, x.eligibleP, x.rebateP]; }""")
    check(pf[0] == 10 and pf[1] == 'rebate' and pf[2] == 110000 and pf[3] == 5500, '10 completed jobs earn up to 5% on service fees only, not Priority: ' + str(pf))
    p.evaluate("() => { S.role = 'client'; go('payments'); }"); W(); check('Portfolio pricing' in p.locator('.a-main').inner_text(), 'client sees portfolio progress on Payments')
    # ---- Admin: Pricing page, save, quote builder contribution ----
    p.evaluate("() => { S.role = 'admin'; S.adminOk = true; render(); }"); W()
    if p.locator('#au-email').count():
        if p.locator('#au-name').count(): p.fill('#au-name', 'Ops')
        p.fill('#au-email', 'ops@l.t'); p.fill('#au-password', 'Admin2026!')
        if p.locator('#au-confirm').count(): p.fill('#au-confirm', 'Admin2026!')
        p.click('form[data-form=auth-admin-setup] button[type=submit]'); W(1500)
    p.evaluate("go('pricing')"); W(600); p.screenshot(path=OUT + 'pr3-admin-pricing.png', full_page=True)
    t = p.locator('.a-main').inner_text()
    check('Pilot measures' in t and 'Inspection rate card' in t and 'Portfolio pricing' in t, 'Admin Pricing page shows measures, rebates and the rate card')
    check(p.locator('button[data-act=rebate]').count() == 1, 'rebate due can be recorded')
    p.locator('button[data-act=rebate]').click(); W()
    check(p.evaluate("() => (Object.values(D.clients)[0].rebates || []).length") == 1, 'rebate recorded on the client')
    # ---- price changes: Main admin only, confirmed by a code to the Main admin's phone ----
    check(p.locator('form[data-form=pricing] fieldset[disabled]').count() == 1, 'rate card locked until a phone is confirmed')
    check(p.evaluate("() => cmdSavePricing(pricing(), 'x')") is False, 'saving without a code is refused')
    check(p.locator('form[data-form=price-phone]').count() == 0 and p.locator('.a-main button[data-go=settings]').count() == 1, 'Pricing points to My settings for the phone')
    p.evaluate("go('settings')"); W()
    p.fill('#pp-ph', '07700 900123'); p.locator('form[data-form=price-phone] button[type=submit]').click(); W(500)
    sms = p.locator('.a-modal .a-banner').inner_text(); code = __import__('re').search(r'(\d{6})', sms).group(1)
    check('•••• 0123' in p.locator('.a-modal h2').inner_text() and 'Test mode' in sms, 'code sent to the phone being confirmed (test-mode text shown)')
    p.fill('#pc-code', '000000' if code != '000000' else '111111'); p.locator('form[data-form=price-code] button[type=submit]').click(); W(400)
    check(p.locator('.a-modal').count() == 1 and p.evaluate("() => S.priceCode.tries") == 1, 'wrong code rejected, attempts counted')
    p.fill('#pc-code', code); p.locator('form[data-form=price-code] button[type=submit]').click(); W(500)
    check(p.evaluate("() => pricePhone()") == '+447700900123', 'phone confirmed for price changes')
    p.evaluate("go('pricing')"); W(500)
    p.fill('#pr-r_CHECK_OUT_2', '115'); p.fill('#pr-why', 'Pilot week 1 review'); p.locator('form[data-form=pricing] button[type=submit]').click(); W(500)
    check(p.evaluate("() => pricing().rates.CHECK_OUT[2]") == 11000 and p.locator('.a-modal').count() == 1, 'price change waits for the code')
    p.evaluate("() => { S.priceCode.exp = 0; }"); p.fill('#pc-code', '123456'); p.locator('form[data-form=price-code] button[type=submit]').click(); W(400)
    check(p.evaluate("() => S.priceCode") is None, 'expired code is refused and cleared')
    p.evaluate("() => { S.modal = null; render(); }"); W()
    p.fill('#pr-r_CHECK_OUT_2', '115'); p.fill('#pr-why', 'Pilot week 1 review'); p.locator('form[data-form=pricing] button[type=submit]').click(); W(500)
    sms = p.locator('.a-modal .a-banner').inner_text(); code = __import__('re').search(r'(\d{6})', sms).group(1)
    p.screenshot(path=OUT + 'pr5-price-code.png', full_page=False)
    p.fill('#pc-code', code); p.locator('form[data-form=price-code] button[type=submit]').click(); W(500)
    check(p.evaluate("() => pricing().rates.CHECK_OUT[2]") == 11500, 'rate card edit saved after the code')
    check(p.evaluate("() => Object.values(D.audit).some(a => a.action === 'pricing.update' && /0123/.test(a.extra.verified))"), 'audit log records the verified change')
    check(p.evaluate("() => pricing().sched.priorityOpen") is True, 'Priority capacity toggle kept')
    cid = p.evaluate("() => Object.values(D.clients)[0].id")
    p.evaluate("go('clients')"); W(); check(p.locator('form[data-form=client-rate]').count() == 0 and 'Negotiated rate' not in p.locator('.a-main').inner_text(), 'Clients table has no negotiated rate column')
    p.evaluate("(id) => sendPriceCode('client-rate', pricePhone(), { clientId: id, pct: '4', reason: 'Negotiated portfolio rate' })", cid); W(500)
    sms = p.locator('.a-modal .a-banner').inner_text(); code = __import__('re').search(r'(\d{6})', sms).group(1); p.fill('#pc-code', code); p.locator('form[data-form=price-code] button[type=submit]').click(); W(500)
    check(p.evaluate("(id) => D.clients[id].portfolioPct", cid) == 4, 'negotiated client rate also needs the code')
    # Sub-admin: view only
    ro = p.evaluate("""() => { var m = myStaff(); D.staff[m.id] = Object.assign({}, m, { role: 'SUB' }); go('pricing'); var r = [document.querySelectorAll('form[data-form=pricing] button[type=submit]').length, document.querySelectorAll('form[data-form=price-phone]').length, /Only the Main admin can change prices/.test(document.querySelector('.a-main').innerText), cmdSavePricing(pricing(), 'x', true)];
      D.staff[m.id] = Object.assign({}, D.staff[m.id], { role: 'MAIN' }); render(); return r; }""")
    check(ro == [0, 0, True, False], 'Sub-admin sees prices read-only and cannot save: ' + str(ro))
    cj = p.evaluate("() => Object.values(D.jobs).find(j => j.kind === 'CLEANING').id")
    p.evaluate("(id) => go('job', { id: id })", cj); W(600)
    t2 = p.locator('.a-main').inner_text(); p.screenshot(path=OUT + 'pr4-quote-builder.png', full_page=True)
    check('Job contribution' in t2 and 'client saw an estimate' in t2, 'quote builder shows the estimate and contribution check')
    p.set_viewport_size({'width': 390, 'height': 900}); W(300); p.evaluate("go('pricing')"); W(400)
    check(p.evaluate("document.documentElement.scrollWidth") <= 392, 'Pricing page fits a phone')
    print('FAILS', [m for ok, m in res if not ok]); print('ERRORS', errs); br.close()
