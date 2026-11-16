#!/usr/bin/env python3
"""Render a page from this skill to MP4 at 60 fps by calling window.renderAt(t) per frame.
Needs network (three.js from CDN), playwright + chromium, ffmpeg. NOT runnable in the Claude container.
Usage: python3 scripts/export_mp4.py page.html out.mp4 [fps=60]"""
import os, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright
src, out = sys.argv[1], sys.argv[2]; fps = int(sys.argv[3]) if len(sys.argv) > 3 else 60
d = tempfile.mkdtemp()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 540, 'height': 960}, device_scale_factor=2)
    pg.goto('file://' + os.path.abspath(src)); pg.wait_for_function('window.renderAt'); pg.wait_for_timeout(2000)
    n = int(pg.evaluate('LEN') * fps)
    for i in range(n):
        pg.evaluate(f'renderAt({i}/{fps})'); pg.wait_for_timeout(30)
        pg.locator('#stage').screenshot(path=f'{d}/f_{i:05d}.png')
    b.close()
subprocess.run(['ffmpeg', '-y', '-framerate', str(fps), '-i', f'{d}/f_%05d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', out], check=True)
print('wrote', out, '(no audio: add voice over separately)')
