"""Build two deployable copies of the Chitransh static site.

netlify/  : served at the domain root (chitranshh.netlify.app) - primary, indexed by Google
ghpages/  : served under /chitraansh/ on its-agent-nyx.github.io - mirror, canonical -> Netlify
"""
import json, os, re, shutil, sys
from datetime import date

# usage: python3 build_sites.py <patched-export-dir> <out-dir>
SRC = sys.argv[1]
OUT = sys.argv[2]
OG_IMAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'og-image.jpg')
PRIMARY = 'https://chitranshh.netlify.app/'
MIRROR = 'https://its-agent-nyx.github.io/chitraansh/'
TITLE = 'Chitransh — Kayastha matrimony'
DESC = ('Chitransh is a demonstration Kayastha house of alliance. Glide the palace through '
        'twelve lineages and meet fictional profiles of women and men.')
TODAY = date.today().isoformat()
TEXT_EXT = ('.html', '.js', '.css', '.txt', '.json', '.xml')


def head_tags(site_url):
    og = site_url + 'og-image.jpg'
    ld = {
        '@context': 'https://schema.org',
        '@graph': [
            {'@type': 'WebSite', 'name': 'Chitransh', 'alternateName': 'Chitransh Kayastha Matrimony',
             'url': PRIMARY, 'description': DESC, 'inLanguage': 'en-IN'},
            {'@type': 'Organization', 'name': 'Chitransh', 'url': PRIMARY,
             'logo': PRIMARY + 'brand/emblem.png'},
        ],
    }
    return '\n'.join([
        f'<link rel="canonical" href="{PRIMARY}"/>',
        '<meta name="robots" content="index, follow"/>',
        '<meta name="keywords" content="Kayastha matrimony, Chitransh, Chitragupta, Srivastava, Mathur, Saxena, Nigam, Bhatnagar, Asthana, Karna, Ambashtha, Kulshreshtha, Gaur, Surajdhwaj, Valmik"/>',
        '<meta property="og:type" content="website"/>',
        '<meta property="og:site_name" content="Chitransh"/>',
        f'<meta property="og:title" content="{TITLE}"/>',
        f'<meta property="og:description" content="{DESC}"/>',
        f'<meta property="og:url" content="{PRIMARY}"/>',
        f'<meta property="og:image" content="{og}"/>',
        '<meta property="og:image:width" content="1200"/>',
        '<meta property="og:image:height" content="630"/>',
        '<meta property="og:image:alt" content="Chitransh palace courtyard with the Chitransh emblem"/>',
        '<meta property="og:locale" content="en_IN"/>',
        '<meta name="twitter:card" content="summary_large_image"/>',
        f'<meta name="twitter:title" content="{TITLE}"/>',
        f'<meta name="twitter:description" content="{DESC}"/>',
        f'<meta name="twitter:image" content="{og}"/>',
        '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>',
    ])


def add_head(path, tags):
    s = open(path, encoding='utf-8').read()
    if 'property="og:title"' in s:
        return
    i = s.index('</head>')
    open(path, 'w', encoding='utf-8').write(s[:i] + tags + s[i:])


def rebase(root, base):
    """Prefix absolute asset paths with the GitHub Pages sub-path."""
    pats = [('"/_next/', f'"{base}_next/'), ('"/lineage/', f'"{base}lineage/'),
            ('"/brand/', f'"{base}brand/'), ('"/fonts/', f'"{base}fonts/'),
            ('"/icon.png', f'"{base}icon.png'), ('"/favicon.ico', f'"{base}favicon.ico')]
    n = 0
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith(TEXT_EXT):
                continue
            p = os.path.join(dp, f)
            s = open(p, encoding='utf-8', errors='surrogateescape').read()
            t = s
            for a, b in pats:
                t = t.replace(a, b)
            if t != s:
                n += 1
                open(p, 'w', encoding='utf-8', errors='surrogateescape').write(t)
    return n


def build(name, site_url, base):
    dst = os.path.join(OUT, name)
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(SRC, dst)
    shutil.copy(OG_IMAGE, os.path.join(dst, 'og-image.jpg'))
    for page in ('index.html',):
        add_head(os.path.join(dst, page), head_tags(site_url))
    if name == 'netlify':
        open(os.path.join(dst, 'robots.txt'), 'w').write(
            f'User-agent: *\nAllow: /\n\nSitemap: {PRIMARY}sitemap.xml\n')
        open(os.path.join(dst, 'sitemap.xml'), 'w').write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url><loc>{PRIMARY}</loc><lastmod>{TODAY}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n'
            '</urlset>\n')
    else:
        open(os.path.join(dst, '.nojekyll'), 'w').write('')   # keep the _next folder
        print('rebased files:', rebase(dst, base))
    print('built', name)


build('netlify', PRIMARY, '/')
build('ghpages', MIRROR, '/chitraansh/')
