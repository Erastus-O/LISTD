"""Smoke test: each single-portal build opens on its own portal with no switcher."""
import os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for name, expect in [('client.html', 'Sign in'), ('pro.html', 'Sign in'), ('admin.html', 'Set up admin sign-in')]:
        p = br.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto('file://' + os.path.join(HERE, '..', 'dist', name)); p.wait_for_timeout(600)
        h1 = p.locator('.a-main h1').first.inner_text(); sw = p.locator('.a-roles').count(); tag = p.locator('.a-top .tag').inner_text()
        print(name, '->', tag, '/', h1, '| switcher:', sw, '| errors:', errs); assert expect in h1 and sw == 0 and not errs
        p.close()
    br.close()
print('OK')
