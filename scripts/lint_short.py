#!/usr/bin/env python3
"""Lint a page made with threejs-cinematic-short. Usage: python3 scripts/lint_short.py out.html
Checks: mandatory @hanzvibes credit, publishing constraints, syntax (node --check), flicker traps, caption word rate."""
import re, subprocess, sys, tempfile, os

def lint(p):
    t = open(p, encoding='utf-8').read(); err = []; warn = []
    if 'id="wm"' not in t or t.count('@hanzvibes') < 2: err.append('credit: need #wm watermark AND end-card line with @hanzvibes')
    if 'by @hanzvibes' not in t: err.append('credit: end card must say "by @hanzvibes"')
    for u in re.findall(r'<script[^>]+src="([^"]+)"', t):
        if not re.match(r'https://(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/npm/|cdn\.tailwindcss\.com|code\.jquery\.com)', u): err.append('script host not allowed: ' + u)
        if 'three' in u and not re.search(r'r128|0\.128\.0', u): err.append('three.js not pinned to r128: ' + u)
    for u in re.findall(r'<link[^>]+href="([^"]+)"', t):
        if not u.startswith(('https://fonts.googleapis.com', 'https://fonts.gstatic.com')): err.append('stylesheet host not allowed: ' + u)
    if 'viewport-fit=cover' not in t: err.append('missing viewport meta with viewport-fit=cover')
    for bad in ('localStorage', 'sessionStorage', 'api.anthropic.com', '<form'):
        if bad in t: err.append('not allowed in hosted page: ' + bad)
    if re.search(r'\.bub\{[^}]*transition:(?!none)', t): warn.append('flicker: .bub has a CSS transition (bubble lags the head); use transition:none')
    if re.search(r'camP\.lerp\(tp,\s*a\)|\.lerp\([^)]*,\s*\.0\d\)', t): warn.append('judder: per-frame camera lerp is frame-rate dependent; use shot keyframes with sm(cl((t-t0)/1.4,0,1))')
    if re.search(r'(?<!parts)\.visible\s*=\s*t\s*[<>]=?', t): warn.append('pop: visible toggled by time; use a scale/opacity envelope (pop) instead')
    if re.search(r'\*\s*\.0(2[5-9]|[3-9])\s*;\s*col\*=fade', t): warn.append('grain looks heavy; keep about .012')
    if 'id="go"' not in t or 'id="snd"' not in t: warn.append('voice over: start overlay #go and mute button #snd missing (only OK if the user asked for a silent short)')
    if 'id="gui"' not in t: warn.append('player: gallery-style controls #gui missing (old #bar text buttons are deprecated)')
    if 'id="bar"' in t: warn.append('player: old fixed #bar found; use the gallery-style #gui controls')
    if not re.search(r'LEN\s*=', t): err.append('no LEN (loop length) found')
    for a, b, s, k in re.findall(r"\[([\d.]+),([\d.]+),'([^']+)',(\d)\]", t):
        r = len(s.split()) / (float(b) - float(a))
        if r > 2.6: warn.append(f'caption too fast ({r:.1f} words/s, max 2.5): {s}')
    m = re.findall(r'<script>(.*?)</script>', t, re.S)
    if m:
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False); f.write(m[-1]); f.close()
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True); os.unlink(f.name)
        if r.returncode: err.append('syntax error: ' + r.stderr.strip().splitlines()[0])
    else: err.append('no inline <script> found')
    return err, warn

if __name__ == '__main__':
    bad = 0
    for p in sys.argv[1:]:
        e, w = lint(p); bad += len(e)
        print(('FAIL ' if e else 'OK   ') + p)
        for x in e: print('  error:', x)
        for x in w: print('  warn: ', x)
    sys.exit(1 if bad else 0)
