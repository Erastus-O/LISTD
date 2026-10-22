"""Build the deployable LISTD site: the marketing website with the products alongside it.

    python3 build.py        ->  public/

public/
  index.html, css/, js/, images/   the website (as in website/)
  app/client.html                  Client app   (website: Log in, Get started, Book a service)
  app/pro.html                     Pro app      (website: Become a Pro, Apply to join)
  app/admin.html                   Admin panel
  app/index.html                   redirects to the Client app

The website links into the app with #signup or #signin, which open the matching
screen. In the app, the listd logo links back to the website.
Host public/ as it is on any static host.
"""
import importlib.util, os, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'public')

def load_platform():
    spec = importlib.util.spec_from_file_location('platform_build', os.path.join(HERE, 'platform', 'build.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

if __name__ == '__main__':
    # Keep each product's own dist/ up to date as well.
    for d in ('platform', 'website'):
        subprocess.run([sys.executable, 'build.py'], cwd=os.path.join(HERE, d), check=True)
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'app'))
    shutil.copy(os.path.join(HERE, 'website', 'index.html'), OUT)
    for d in ('css', 'js', 'images'):
        shutil.copytree(os.path.join(HERE, 'website', d), os.path.join(OUT, d))
    plat = load_platform()
    for portal in ('client', 'pro', 'admin'):
        open(os.path.join(OUT, 'app', portal + '.html'), 'w', encoding='utf-8').write(plat.page(portal, site='../index.html'))
    open(os.path.join(OUT, 'app', 'index.html'), 'w', encoding='utf-8').write(
        '<!doctype html>\n<meta charset="utf-8">\n<title>listd</title>\n'
        '<meta http-equiv="refresh" content="0; url=client.html">\n<a href="client.html">Open the listd app</a>\n')
    print('public/  website + app/ (client, pro, admin)')
