"""Build the LISTD platform into single-file HTML apps.

    python3 build.py

Writes to dist/:
  listd-platform.html  all three portals with a Client / Pro / Admin switcher (the published app)
  client.html          Client portal only
  pro.html             Pro portal only
  admin.html           Admin panel only

Each file is self-contained: CSS, icon sprite and JavaScript are inlined.
"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
def read(*p): return open(os.path.join(HERE, *p), encoding='utf-8').read()

SRC = ['core.js', 'auth.js', 'actions.js', 'client.js', 'job.js', 'pro.js', 'settings.js', 'inspect.js', 'pdf.js', 'admin.js', 'levels.js', 'staff.js', 'app.js']
CSS = ['tokens.css', 'components.css', 'app.css']
TITLES = {None: 'listd Platform', 'client': 'listd for Clients', 'pro': 'listd for Pros', 'admin': 'listd Admin'}

def page(portal, site=None):
    """site: URL of the marketing website; when set, the app's logo links back to it."""
    css = '\n'.join(read('styles', f) for f in CSS)
    js = '\n'.join(read('src', f) for f in SRC)
    flag = '' if portal is None else '<script>window.LISTD_PORTAL = %r;</script>\n' % portal
    if site: flag += '<script>window.LISTD_SITE = %r;</script>\n' % site
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<title>%s</title>\n<meta name="description" content="LISTD property services platform">\n'
            '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Raleway:ital,wght@0,500;0,600;0,700;1,500&family=Rammetto+One&display=swap">\n'
            '<style>\n%s\nbody{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-sans)}\n</style>\n</head>\n<body>\n%s\n<div id="app"></div>\n%s<script>\n%s\n</script>\n</body>\n</html>\n'
            % (TITLES[portal], css, read('assets', 'icons.svg.html'), flag, js))

if __name__ == '__main__':
    os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
    for portal, name in [(None, 'listd-platform.html'), ('client', 'client.html'), ('pro', 'pro.html'), ('admin', 'admin.html')]:
        out = page(portal)
        open(os.path.join(HERE, 'dist', name), 'w', encoding='utf-8').write(out)
        print('dist/%s  %d KB' % (name, len(out) // 1024))
