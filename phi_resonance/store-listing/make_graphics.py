"""Make Phi Resonance's Google Play graphics: framed phone screenshots and the feature graphic.

Created: 2026-10-19
Last updated: 2026-10-19
Version: 1.1

Usage, from phi_resonance/:

    python store-listing/make_graphics.py [raw_dir]

raw_dir holds full-screen captures from the phone, taken over USB with
`adb exec-out screencap -p > raw_main.png` and so on, named as in SHOTS below. Without raw_dir, the
crops kept in store-listing/screens/ are used again.

- Each capture loses the phone's status bar and navigation bar (rows TOP to BOTTOM are kept, moved
  down by SHIFT for a shot that needs it), and the crop is saved as screens/<name>.jpg.
- Each crop is then set in a 1080 x 1920 frame (9:16) with its caption. Google Play rejects
  screenshots more than twice as tall as they are wide, and the Pixel 9's are 2.24 times.
- The feature graphic is 1024 x 500.
- Everything is drawn as HTML in Microsoft Edge (headless) with the app's own fonts from www/fonts/,
  then saved without transparency, as Play wants.

Revision history:
- 2026-10-19 v1.0: initial
- 2026-10-19 v1.1: the Presets shot was retaken with the app's one-link footer; SHIFT moves its crop
  47 rows down
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'play')
SCREENS = os.path.join(HERE, 'screens')
FONTS = os.path.join(APP, 'www', 'fonts', 'fonts.css')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

TOP, BOTTOM = 125, 2265        # rows of a 1080 x 2424 Pixel 9 capture between the system bars

# rows to move a shot's crop down. Scrolled to its end, the Library sits 47 rows lower since the footer
# became one line (build_page.py v1.4), which brings the stage's lower edge into the top of the crop.
SHIFT = {'6-presets': 47}

# name, raw capture, title, caption
SHOTS = [
    ('1-session', 'raw_main.png', 'SOUND SESSIONS', 'Binaural, isochronic and drone tones, layered on \u03c6'),
    ('2-composer', 'raw_composer.png', 'THE COMPOSER', 'Music grown from your sound, peaking at the golden section'),
    ('3-breath', 'raw_breath.png', 'BREATHE', 'A breath guide to follow, at your own pace'),
    ('4-visual-beat', 'raw_fullflash.png', 'VISUAL BEAT', 'Full-screen colour in step with the beat'),
    ('5-together', 'raw_stageflash.png', 'TOGETHER', 'The breath guide and the flashes on the main screen'),
    ('6-presets', 'raw_library.png', 'PRESETS', 'Start from a preset, then save your own settings'),
]

FRAME = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{fonts}">
<style>
  html, body {{ margin: 0; width: 1080px; height: 1920px; overflow: hidden; }}
  body {{
    background:
      radial-gradient(ellipse 85% 42% at 50% 40%, rgba(255, 170, 0, 0.10), transparent 70%),
      radial-gradient(ellipse 120% 55% at 50% 105%, rgba(70, 120, 255, 0.12), transparent 70%),
      #05050f;
    font-family: 'Rajdhani', sans-serif;
    display: flex; flex-direction: column; align-items: center;
  }}
  .title {{
    margin-top: 72px; font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 62px;
    letter-spacing: 7px; color: #ffb300;
    text-shadow: -1px 0 0 rgba(255, 64, 96, 0.55), 1px 0 0 rgba(64, 220, 255, 0.55), 0 0 22px rgba(255, 170, 0, 0.5);
  }}
  .sub {{ margin-top: 14px; font-size: 38px; font-weight: 500; color: #d4cfe4; letter-spacing: 0.4px; }}
  .shot {{
    margin-top: 40px; height: 1580px; border-radius: 34px;
    border: 2px solid rgba(255, 170, 0, 0.35);
    box-shadow: 0 0 60px rgba(255, 170, 0, 0.16), 0 30px 80px rgba(0, 0, 0, 0.6);
  }}
</style></head><body>
  <div class="title">{title}</div>
  <div class="sub">{sub}</div>
  <img class="shot" src="{shot}">
</body></html>
"""

FEATURE = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{fonts}">
<style>
  html, body {{ margin: 0; width: 1024px; height: 500px; overflow: hidden; }}
  body {{
    position: relative;
    background:
      radial-gradient(ellipse 48% 70% at 50% 46%, rgba(255, 170, 0, 0.16), transparent 72%),
      radial-gradient(ellipse 90% 80% at 50% 120%, rgba(70, 120, 255, 0.16), transparent 70%),
      #05050f;
  }}
  svg {{ position: absolute; inset: 0; }}
  .tag {{
    position: absolute; left: 0; right: 0; top: 150px; text-align: center;
    font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 82px; letter-spacing: 6px; color: #ffb300;
    text-shadow: -2px 0 0 rgba(255, 64, 96, 0.6), 2px 0 0 rgba(64, 220, 255, 0.6), 0 0 26px rgba(255, 170, 0, 0.6);
  }}
  .phi {{ font-family: 'Segoe UI', sans-serif; font-weight: 700; }}
  .line {{
    position: absolute; left: 0; right: 0; top: 268px; text-align: center;
    font-family: 'Rajdhani', sans-serif; font-weight: 600; font-size: 40px; letter-spacing: 1px; color: #ece8f6;
  }}
  .small {{
    position: absolute; left: 0; right: 0; top: 330px; text-align: center;
    font-family: 'Orbitron', sans-serif; font-weight: 600; font-size: 19px; letter-spacing: 5px; color: rgba(255, 190, 80, 0.85);
  }}
</style></head><body>
  <svg width="1024" height="500" viewBox="0 0 1024 500">
    <g fill="none" stroke="#ffaa00">
      {rings}
    </g>
    <path d="M 132 452 Q 512 120 892 452" fill="none" stroke="rgba(255, 170, 0, 0.30)" stroke-width="2"/>
    <circle cx="208" cy="392" r="7" fill="#8fd3ff"/>
    <circle cx="208" cy="392" r="16" fill="rgba(143, 211, 255, 0.25)"/>
  </svg>
  <div class="tag"><span class="phi">\u03c6</span> RESONANCE</div>
  <div class="line">A sound lab for calm and focus</div>
  <div class="small">BINAURAL \u00b7 ISOCHRONIC \u00b7 DRONE \u00b7 COMPOSER</div>
</body></html>
"""


def render(html, out, w, h):
    """Draw an HTML page to an RGB PNG of exactly w x h with headless Edge."""
    tmp = tempfile.mkdtemp(prefix='phi-store-')
    try:
        page = os.path.join(HERE, '_render.html')   # beside the screens, so relative paths work
        io.open(page, 'w', encoding='utf-8').write(html)
        shot = os.path.join(tmp, 'shot.png')
        subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=1', '--window-size=%d,%d' % (w, h),
                        '--virtual-time-budget=5000', '--user-data-dir=' + os.path.join(tmp, 'profile'),
                        '--screenshot=' + shot, 'file:///' + page.replace('\\', '/')],
                       capture_output=True)
        # msedge.exe returns before its headless worker has written the file: wait for it to settle
        last = -1
        for _ in range(160):
            size = os.path.getsize(shot) if os.path.exists(shot) else -1
            if size > 0 and size == last:
                break
            last = size
            time.sleep(0.25)
        else:
            raise RuntimeError('Edge wrote no screenshot for ' + out)
        im = Image.open(shot).convert('RGB')
        assert im.size == (w, h), (out, im.size)
        im.save(out, optimize=True)
        os.remove(page)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCREENS, exist_ok=True)
    raw_dir = sys.argv[1] if len(sys.argv) > 1 else None
    fonts = os.path.relpath(FONTS, HERE).replace('\\', '/')
    for name, raw, title, sub in SHOTS:
        crop = os.path.join(SCREENS, name + '.jpg')
        if raw_dir:
            im = Image.open(os.path.join(raw_dir, raw)).convert('RGB')
            assert im.size == (1080, 2424), (raw, im.size)
            shift = SHIFT.get(name, 0)
            im.crop((0, TOP + shift, 1080, BOTTOM + shift)).save(crop, quality=94)
        html = FRAME.format(fonts=fonts, title=title, sub=sub, shot='screens/%s.jpg' % name)
        render(html, os.path.join(OUT, 'phone-%s.png' % name), 1080, 1920)
        print('phone', name)
    rings = '\n      '.join('<circle cx="512" cy="250" r="%d" stroke-opacity="%.2f" stroke-width="1.5"/>'
                           % (r, max(0.05, 0.28 - i * 0.03)) for i, r in enumerate(range(60, 560, 46)))
    render(FEATURE.format(fonts=fonts, rings=rings), os.path.join(OUT, 'feature-graphic.png'), 1024, 500)
    print('feature graphic')
    shutil.copyfile(os.path.join(APP, 'www', 'icons', 'icon-512.png'), os.path.join(OUT, 'icon-512.png'))
    print('icon')


if __name__ == '__main__':
    main()
