"""Website ↔ app: website CTAs open the right app screen, and the app logo links back to the website. Needs `python3 build.py` at the repo root."""
import os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..', '..', 'public'))
with sync_playwright() as pw:
    br = pw.chromium.launch(); p = br.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    def h1(): p.wait_for_timeout(600); return p.locator('.a-main h1').first.inner_text()
    def check(link, path, portal, title):
        p.goto('file://' + os.path.join(SITE, 'index.html')); href = p.locator('a', has_text=link).first.get_attribute('href')
        p.goto('file://' + os.path.join(SITE, href)); got = h1(); tag = p.locator('.a-top .tag').inner_text()
        print(link, '->', href, '|', tag, '/', got); assert href == path and tag.lower() == portal and title in got, got
    check('Get started', 'app/client.html#signup', 'client', 'Create')
    check('Log in', 'app/client.html#signin', 'client', 'Sign in')
    check('Book a service', 'app/client.html#signup', 'client', 'Create')
    check('Apply to join', 'app/pro.html#signup', 'pro', 'Apply')
    p.locator('.a-top a.ld-logo').click(); p.wait_for_timeout(600)
    print('logo ->', p.url); assert p.url.endswith('/public/') or p.url.endswith('/public/index.html'), p.url
    assert not errs, errs
    br.close()
print('OK')
