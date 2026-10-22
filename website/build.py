"""Build a single self-contained copy of the website (CSS, JS and images inlined).

    python3 build.py        ->  dist/listd-website.html

index.html + css/ + js/ + images/ is the editable source and can be hosted as it is.
The single-file build is handy for previews and for hosts that only take one file.
"""
import base64, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
def read(p, mode='r'): return open(os.path.join(HERE, p), mode).read()
html = read('index.html')
html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', lambda m: '<style>\n' + read(m.group(1)) + '\n</style>', html)
html = re.sub(r'<script src="(js/[^"]+)"></script>', lambda m: '<script>\n' + read(m.group(1)) + '\n</script>', html)
def img(m):
    p = m.group(1); ext = p.rsplit('.', 1)[1].lower(); mime = 'jpeg' if ext in ('jpg', 'jpeg') else ext
    return 'src="data:image/%s;base64,%s"' % (mime, base64.b64encode(read(p, 'rb')).decode())
html = re.sub(r'src="(images/[^"]+)"', img, html)
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
open(os.path.join(HERE, 'dist', 'listd-website.html'), 'w').write(html)
print('dist/listd-website.html', len(html), 'bytes')
